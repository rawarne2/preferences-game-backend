import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import "dotenv/config";
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

// Helper function to clean up empty rooms
const cleanupEmptyRoom = (roomCode: string) => {
    const gameRoom = gameRooms.get(roomCode);
    if (!gameRoom) return false;

    const connectedPlayers = gameRoom.players.filter(p => p.isConnected);

    if (connectedPlayers.length === 0) {
        console.log(`Cleaning up empty room: ${roomCode}`);
        gameRooms.delete(roomCode);
        return true;
    }
    return false;
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

        // if (gameRoom.game.currentRound > gameRoom.game.totalRounds) {
        //     gameRoom.game.isGameOver = true;
        // }

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

    // Leave room
    socket.on('leave-room', (roomCode: string) => {
        console.log('leave-room', roomCode);
        const gameRoom = gameRooms.get(roomCode);
        const userId = socket.data.userId;

        if (gameRoom && userId) {
            // Find and remove/disconnect the player
            const playerIndex = gameRoom.players.findIndex(p => p.userId === userId);

            if (playerIndex !== -1) {
                // Mark player as disconnected
                gameRoom.players[playerIndex].isConnected = false;

                socket.leave(roomCode);
                socket.data = {};

                // Check if room should be cleaned up
                if (cleanupEmptyRoom(roomCode)) {
                    return; // Room was deleted, no need to continue
                }

                // Reassign host if needed
                reassignHostIfNeeded(roomCode, gameRoom);

                io.to(roomCode).emit('player-left', gameRoom.players);
            }
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`Client disconnecting: ${socket.id}`);
        const userId = socket.data.userId;

        if (!userId) {
            return;
        }

        // Find and update player status in rooms
        gameRooms.forEach((room, code) => {
            const playerIndex = room.players.findIndex(p => p.userId === userId);

            if (playerIndex !== -1) {
                // Mark player as disconnected instead of removing them
                room.players[playerIndex].isConnected = false;

                console.log(`Player ${room.players[playerIndex].name} disconnected from room ${code}`);

                // Check if room should be cleaned up
                if (cleanupEmptyRoom(code)) {
                    return; // Room was deleted, no need to continue
                }

                // Emit player left event for remaining connected players
                io.to(code).emit('player-left', room.players);

                // If host disconnects, notify players but don't change host yet
                if (room.host === userId) {
                    console.log('Host has disconnected');
                    io.to(code).emit('host-disconnected', {
                        hostName: room.players[playerIndex].name,
                        players: room.players
                    });
                }

                gameRooms.set(code, room);
            }
        });
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