import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import "dotenv/config";
import fetch from 'node-fetch';
import type { Socket, Server as SocketIOServerType } from "socket.io";
import type { CorsOptions } from "cors";
import type { Server as HttpServerType } from "http";
import { Player, GameRoom } from './definitions.js';
import { createUniqueRoomCode } from './utilities.js';

const { NODE_ENV, ORIGIN, PORT } = process.env;

dotenv.config({ path: `.env.${NODE_ENV}` });

// State management | TODO: use redis or database
export const gameRooms = new Map<string, GameRoom>();

// Initialize Express app
const origin = ORIGIN;
const port: number = PORT ? parseInt(PORT) : 3000;

console.log('origin: ', origin, ", port: ", port, ", NODE_ENV: ", NODE_ENV);

// Configure CORS
const corsSettings: CorsOptions = {
    origin: origin,
    credentials: false,
    methods: ['GET'],
}

const app = express();

// Basic middleware
app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
    res.status(200).json({
        message: 'Preferences Game Backend API',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
            health: '/health',
            websocket: 'Socket.IO connection available'
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        activeRooms: gameRooms.size,
        memoryUsage: process.memoryUsage()
    });
});

// Keep-alive function to prevent service from sleeping
const keepAlive = () => {
    if (NODE_ENV === 'production') {
        // Use Render's external URL
        const url = process.env.RENDER_EXTERNAL_URL;

        if (!url) {
            console.log('RENDER_EXTERNAL_URL not found, keep-alive disabled. Make sure you are deploying to Render.');
            return;
        }

        const healthUrl = `${url}/health`;
        console.log(`[${new Date().toISOString()}] Keep-alive initialized, will ping: ${healthUrl}`);

        setInterval(async () => {
            try {
                const response = await fetch(healthUrl);
                if (response.ok) {
                    console.log(`[${new Date().toISOString()}] Keep-alive ping successful`);
                } else {
                    console.log(`[${new Date().toISOString()}] Keep-alive ping failed with status: ${response.status}`);
                }
            } catch (error) {
                console.log(`[${new Date().toISOString()}] Keep-alive ping error:`, error);
            }
        }, 10 * 60 * 1000); // Ping every 10 minutes
    }
};

// Start keep-alive after server starts
setTimeout(keepAlive, 30000); // Start after 30 seconds

// Create HTTP server
const httpServer: HttpServerType = http.createServer(app);

// Initialize Socket.IO
const io: SocketIOServerType = new Server(httpServer, {
    transports: ['websocket', 'polling'],
    cors: corsSettings,
    allowEIO3: true,
    connectTimeout: 120000, // 2 minutes
    pingTimeout: 120000, // 2 minutes
    pingInterval: 15000, // 15 seconds
    connectionStateRecovery: {
        maxDisconnectionDuration: 600000, // 10 minutes
    }
});

// Helper function to reassign host if current host is disconnected
const reassignHostIfNeeded = (roomCode: string, gameRoom: GameRoom) => {
    if (!gameRoom.host) return;

    const currentHost = gameRoom.players.find(p => p.userId === gameRoom.host);
    if (!currentHost || !currentHost.isConnected) {
        // Find first connected player to be new host
        const newHost = gameRoom.players.find(p => p.isConnected);
        if (newHost) {
            // Remove host status from all players
            gameRoom.players.forEach(p => p.isHost = false);
            // Set new host
            newHost.isHost = true;
            gameRoom.host = newHost.userId;

            console.log(`Host reassigned to ${newHost.name} in room ${roomCode}`);
            io.to(roomCode).emit('host-reassigned', {
                newHost: newHost,
                players: gameRoom.players
            });
        }
    }
};

// Grace period (in ms) before an empty room is deleted
const EMPTY_ROOM_CLEANUP_DELAY_MS = 10 * 60 * 1000; // 10 minutes

// Helper function to schedule cleanup of empty rooms after a grace period
const cleanupEmptyRoom = (roomCode: string) => {
    const gameRoom = gameRooms.get(roomCode);
    if (!gameRoom) return false;

    const connectedPlayers = gameRoom.players.filter(p => p.isConnected);

    if (connectedPlayers.length === 0) {
        // If a cleanup timer is already running, don't start another
        if (gameRoom.cleanupTimer) return true;

        console.log(`All players left room ${roomCode}. Scheduling cleanup in ${EMPTY_ROOM_CLEANUP_DELAY_MS / 1000}s...`);
        gameRoom.cleanupTimer = setTimeout(() => {
            // Re-check that no one has reconnected during the grace period
            const room = gameRooms.get(roomCode);
            if (room && room.players.filter(p => p.isConnected).length === 0) {
                console.log(`Grace period expired. Deleting room: ${roomCode}`);
                gameRooms.delete(roomCode);
            }
        }, EMPTY_ROOM_CLEANUP_DELAY_MS);
        return true;
    }
    return false;
};

// Helper function to cancel a pending room cleanup (e.g. when a player rejoins)
const cancelRoomCleanup = (gameRoom: GameRoom) => {
    if (gameRoom.cleanupTimer) {
        clearTimeout(gameRoom.cleanupTimer);
        gameRoom.cleanupTimer = undefined;
        console.log(`Cleanup timer cancelled for room ${gameRoom.code} — player rejoined`);
    }
};

// Socket.IO event handlers
io.on('connection', (socket: Socket) => {
    console.log('New socket connection:', socket.id);

    // Create a new room
    socket.on('create-room', async ({ userId }: { userId?: string } = {}) => {
        const roomCode = createUniqueRoomCode(gameRooms);
        gameRooms.set(roomCode, {
            code: roomCode,
            players: [],
            game: {
                currentCards: [],
                totalRounds: 5,
                targetPlayerIndex: 0,
                currentRound: 1,
                targetRankings: [],
                groupPredictions: [],
            }
        });
        const room = gameRooms.get(roomCode);
        socket.join(roomCode);
        socket.data.gameRoom = room;
        if (userId) {
            socket.data.userId = userId;
        }
        console.log('room-created', { roomCode });
        io.to(roomCode).emit('room-created', { roomCode });
    });

    socket.on('message', (data) => {
        console.log('Message received:', data);
        io.emit('message', data);
    });

    // Get room status
    socket.on('get-room-status', (roomCode: string) => {
        const gameRoom = gameRooms.get(roomCode);
        if (!gameRoom) {
            socket.emit('room-status-error', 'Room not found');
            return;
        }

        socket.emit('room-status', {
            room: gameRoom,
            connectedPlayers: gameRoom.players.filter(p => p.isConnected),
            disconnectedPlayers: gameRoom.players.filter(p => !p.isConnected)
        });
    });

    // Join an existing room
    socket.on('join-room', async ({ roomCode, name, userId }: { roomCode: string, name: string, userId: string }) => {
        const gameRoom = gameRooms.get(roomCode);
        if (!gameRoom) {
            socket.emit('error', 'Room not found');
            return;
        }

        // Check if player is rejoining (existed before but was disconnected)
        const existingPlayerIndex = gameRoom.players.findIndex(p => p.userId === userId);

        if (existingPlayerIndex !== -1) {
            // Player is rejoining - update their connection status
            const existingPlayer = gameRoom.players[existingPlayerIndex];
            existingPlayer.isConnected = true;

            // Cancel any pending room cleanup since a player has returned
            cancelRoomCleanup(gameRoom);

            socket.join(roomCode);
            socket.data.gameRoom = gameRoom;
            socket.data.userId = userId;

            // Check if host needs to be reassigned
            reassignHostIfNeeded(roomCode, gameRoom);

            console.log('Player rejoined:', { userId, name, roomCode });
            io.to(roomCode).emit('player-rejoined', {
                player: existingPlayer,
                players: gameRoom.players
            });
            return;
        }

        // New player joining
        const newPlayer: Player = {
            userId: userId,
            name: name,
            isHost: false,
            score: 0,
            isConnected: true,
        }

        if (!gameRoom.players || gameRoom.players.length === 0) {
            newPlayer.isHost = true;
            gameRoom.host = newPlayer.userId;
            gameRoom.players = [newPlayer];
        } else {
            newPlayer.isHost = false;
            gameRoom.players.push(newPlayer);
        }
        gameRooms.set(roomCode, gameRoom);

        socket.join(roomCode);
        socket.data.gameRoom = gameRoom;
        socket.data.userId = userId;

        const sockets = await io.in(roomCode).fetchSockets();
        const players = sockets[0].data?.gameRoom?.players;
        console.log('player-joined', players);

        io.to(roomCode).emit('player-joined', players);
    });

    socket.on('start-game', (roomCode: string, totalRounds: number, currentCards: string[]) => {
        const gameRoom = gameRooms.get(roomCode);
        if (!gameRoom) {
            socket.emit('error', 'Room not found');
            return;
        }

        gameRoom.game = {
            ...gameRoom.game,
            currentCards,
            totalRounds,
        }
        socket.data.gameRoom = gameRoom;

        io.to(roomCode).emit('game-started', gameRoom);
        console.log('Game started in room:', roomCode, gameRoom);
    });

    socket.on('next-turn', (roomCode: string, currentCards: string[]) => {
        console.log('next-turn', roomCode, currentCards);
        const gameRoom = gameRooms.get(roomCode);
        if (!gameRoom) {
            socket.emit('next-turn-error', 'Game room not found');
            return;
        }

        gameRoom.game.currentCards = currentCards;
        gameRoom.game.targetRankings = [];
        gameRoom.players.forEach((player: Player) => {
            player.rankings = [];
        });
        if (gameRoom.game.targetPlayerIndex + 1 === gameRoom.players.length) { // go to next round
            gameRoom.game.currentRound += 1;
            gameRoom.game.targetPlayerIndex = 0;
        } else { // go to next player in the round
            console.log('going to next player in the round', gameRoom.game.targetPlayerIndex);
            gameRoom.game.targetPlayerIndex += 1;
        }

        if (gameRoom.game.currentRound > gameRoom.game.totalRounds) {
            gameRoom.game.isGameOver = true;
        }

        io.to(roomCode).emit('increment-turn', gameRoom);
        console.log('increment-turn: ', roomCode, gameRoom);
    });
    // submitRanking
    socket.on('submit-rankings', ({ roomCode, rankings, userId }) => {
        // const gameRoom: GameRoom = socket.data.gameRoom;
        const gameRoom = gameRooms.get(roomCode);

        console.log('submit-rankings', { roomCode, rankings, userId, gameRoom });
        if (!gameRoom) {
            socket.emit('submit-rankings-error', 'Game room not found');
            console.error('Game room not found');
            return;
        }

        const playerIndex = gameRoom.players?.findIndex((p: Player) => p.userId === userId);
        if (playerIndex === -1 || playerIndex === undefined) {
            console.error('Player not in room', playerIndex);
            socket.emit('error', 'Player not in room');
            return;
        }

        if (!Array.isArray(rankings) || rankings.length === 0) {
            console.error('Invalid ranking format', rankings);
            socket.emit('error', 'Invalid ranking format');
            return;
        }

        const isTargetPlayer = gameRoom.game?.targetPlayerIndex === playerIndex;
        console.log('playerIndex', playerIndex, isTargetPlayer, gameRoom.players[playerIndex].name);

        // Helper function to calculate score between target rankings and player rankings
        const calculateScore = (targetRankings: string[], playerRankings: string[]): number => {
            if (!targetRankings || !playerRankings || targetRankings.length !== 5 || playerRankings.length !== 5) {
                return 0;
            }
            let score = 20;
            for (let i = 0; i < 5; i++) {
                const targetItem = targetRankings[i];
                const playerPosition = playerRankings.indexOf(targetItem);
                if (playerPosition !== -1) {
                    const diff = Math.abs(i - playerPosition);
                    score -= diff;
                }
            }
            return score;
        };

        // Update rankings for the submitting player
        if (isTargetPlayer) {
            gameRoom.game.targetRankings = rankings;
        } else {
            gameRoom.players[playerIndex].rankings = rankings;
        }

        // Calculate and update scores for all players who have submitted rankings
        if (gameRoom.game.targetRankings && gameRoom.game.targetRankings.length === 5) {
            gameRoom.players.forEach((player: Player, index: number) => {
                // Skip the target player - they don't get scored against themselves
                if (index === gameRoom.game.targetPlayerIndex) {
                    return;
                }

                // Calculate score if this player has submitted rankings
                if (player.rankings && player.rankings.length === 5) {
                    const score = calculateScore(gameRoom.game.targetRankings, player.rankings);
                    player.roundScore = score;
                    player.score += score;
                }
            });
        }

        console.log('rankings-submitted', gameRoom);
        io.to(roomCode).emit('rankings-submitted', gameRoom);
    });

    // Reset game (keep room alive so players can start a new game)
    socket.on('reset-game', (roomCode: string) => {
        const gameRoom = gameRooms.get(roomCode);
        if (!gameRoom) {
            socket.emit('error', 'Room not found');
            return;
        }

        // Reset game state
        gameRoom.game.currentRound = 1;
        gameRoom.game.targetPlayerIndex = 0;
        gameRoom.game.currentCards = [];
        gameRoom.game.targetRankings = [];
        gameRoom.game.groupPredictions = [];
        gameRoom.game.isGameOver = false;

        // Reset every player's score and rankings
        gameRoom.players.forEach((player: Player) => {
            player.score = 0;
            player.roundScore = 0;
            player.rankings = [];
        });

        console.log('game-reset', roomCode, gameRoom);
        io.to(roomCode).emit('game-reset', gameRoom);
    });

    // Leave room — payload: (roomCode) or { roomCode, userId }
    socket.on('leave-room', (payload: string | { roomCode: string; userId?: string }) => {
        const roomCode = typeof payload === 'string' ? payload : payload.roomCode;
        const payloadUserId = typeof payload === 'object' && payload.userId != null ? payload.userId : undefined;
        const gameRoom = gameRooms.get(roomCode);

        if (!gameRoom) {
            socket.emit('error', 'Room not found');
            return;
        }

        const leaverUserId = payloadUserId ?? socket.data.userId;
        if (!leaverUserId) {
            socket.emit('error', 'Could not identify player');
            return;
        }

        const playerIndex = gameRoom.players.findIndex(p => p.userId === leaverUserId);
        if (playerIndex === -1) {
            socket.emit('error', 'Player not in room');
            return;
        }

        const isLeaverSocket = socket.data.userId === leaverUserId;

        // Remove player from the room's players list
        gameRoom.players.splice(playerIndex, 1);
        const updatedPlayers = gameRoom.players;

        // If the host left, assign new host (first remaining player)
        if (gameRoom.host === leaverUserId) {
            gameRoom.host = undefined;
            gameRoom.players.forEach(p => { p.isHost = false; });
            if (gameRoom.players.length > 0) {
                const newHost = gameRoom.players[0];
                newHost.isHost = true;
                gameRoom.host = newHost.userId;
                console.log(`Host reassigned to ${newHost.name} in room ${roomCode} (previous host left)`);
            }
        }

        if (isLeaverSocket) {
            socket.leave(roomCode);
            socket.data = {};
        }

        // If everyone left, schedule room cleanup (10 min); do not delete immediately
        if (updatedPlayers.length === 0) {
            cleanupEmptyRoom(roomCode);
            return;
        }

        io.to(roomCode).emit('player-left', updatedPlayers);
        console.log('leave-room', roomCode, 'remaining:', updatedPlayers.length);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`Client disconnecting: ${socket.id}`);
        const userId = socket.data.userId;
        const gameRoom = socket.data.gameRoom;

        if (!userId || !gameRoom) {
            return;
        }

        const roomCode = gameRoom.code;
        const room = gameRooms.get(roomCode);

        if (!room) {
            return;
        }

        const playerIndex = room.players.findIndex(p => p.userId === userId);
        if (playerIndex !== -1) {
            // Mark player as disconnected instead of removing them
            room.players[playerIndex].isConnected = false;
            console.log(`Player ${room.players[playerIndex].name} disconnected from room ${roomCode}`);

            // Schedule room cleanup if all players are disconnected
            if (cleanupEmptyRoom(roomCode)) {
                io.to(roomCode).emit('player-disconnected', room.players);
                return; // Cleanup scheduled, no need to continue
            }

            // Emit player left event for remaining connected players
            io.to(roomCode).emit('player-disconnected', room.players);

            // If host disconnects, notify players but don't change host yet
            if (room.host === userId) {
                console.log('Host has disconnected');
                io.to(roomCode).emit('host-disconnected', {
                    hostName: room.players[playerIndex].name,
                    players: room.players
                });
            }
            gameRooms.set(roomCode, room);
        }
    });
});


io.on('error', (err) => {
    console.error('Socket.IO error!!!: ', err);
});

// Handle server events
io.on('connect_error', (err) => {
    console.error('Socket.IO error: ', err);
    io.emit('Socket.IO connect_error: ', err);
});

httpServer.listen(port);

// close server
process.on('SIGINT', () => {
    console.log('SIGINT signal received');
    httpServer.close(() => {
        console.log('Server closed');
    });
});

process.on('SIGTERM', () => {
    console.log('SIGTERM signal received');
    httpServer.close(() => {
        console.log('Server closed');
    });
});

io.disconnectSockets();
export default httpServer;