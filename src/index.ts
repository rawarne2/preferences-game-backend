import type { Socket, Server as SocketIOServerType } from "socket.io";
import type { CorsOptions } from "cors";
import type { Server as HttpServerType } from "http";
const dotenv = require('dotenv');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');

dotenv.config({ path: `.env.${process.env.NODE_ENV}` });

const app = express();

const origin = process.env.ORIGIN;
console.log('origin: ', origin, process.env.PORT)

// Types
interface Player {
    id: string;
    name: string;
}

interface GameRoom {
    code: string;
    players: Player[];
    host: string; // Socket ID of room creator
}

// State management | TODO: use redis or database
const gameRooms = new Map<string, GameRoom>();


const corsSettings: CorsOptions = {
    origin: origin,
    credentials: true,
    methods: ['GET', 'POST'],

}
app.use(cors(corsSettings));

// Health check endpoint for ALB
app.get('/health', (_: any, res: any) => {
    res.status(200).send('OK');
});

const httpServer: HttpServerType = http.createServer(app);

const io: SocketIOServerType = new Server(httpServer, {
    transports: ['websocket'],
    cors: corsSettings,
    // Allow connection upgrades behind ALB
    allowEIO3: true,
    path: '/socket.io/'
});


// Helper functions
const generateRoomCode = (): string => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 10; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
};

const createUniqueRoomCode = (): string => {
    let code: string;
    do {
        code = generateRoomCode();
    } while (gameRooms.has(code));
    return code;
};

io.use((socket: Socket, next) => {
    console.log('New socket connection:', socket.id);
    next();
});

// Socket.IO event handlers
io.on('connection', (socket: Socket) => {
    io.emit('connected!!!!!!', socket.id); // not needed
    // Create a new room
    socket.on('createRoom', () => {
        const roomCode = createUniqueRoomCode();
        gameRooms.set(roomCode, {
            code: roomCode,
            players: [],
            host: socket.id
        });

        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        console.log('Room created:', roomCode);
    });

    socket.on('message', (data) => {
        console.log('Message received:', data);
        io.emit('message', data);
    });

    // Join an existing room
    socket.on('joinRoom', (roomCode: string) => {
        const room = gameRooms.get(roomCode);

        if (!room) {
            socket.emit('error', 'Room not found');
            console.log('Room not found')
            return;
        }

        socket.join(roomCode);
        socket.emit('roomJoined', {
            code: roomCode,
            players: room.players
        });
        console.log('roomJoined')
    });

    // Submit player name
    socket.on('submitName', ({ roomCode, playerName, playerId }: {
        roomCode: string;
        playerName: string;
        playerId: string;
    }) => {
        const room = gameRooms.get(roomCode);

        if (!room) {
            socket.emit('error', 'Room not found');
            console.log('Room not found')
            return;
        }

        // Check for duplicate names
        if (room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) {
            socket.emit('error', 'Name already taken');
            console.log('Name already taken')
            return;
        }

        // Add player to room
        const newPlayer: Player = {
            id: playerId,
            name: playerName
        };

        room.players.push(newPlayer);
        gameRooms.set(roomCode, room);

        // Notify all players in the room
        io.to(roomCode).emit('playerJoined', room.players);
    });

    // submitRanking
    socket.on('submitRanking', ({ roomCode, ranking, playerId }: {
        roomCode: string;
        ranking: string[];
        playerId: string;
    }) => {
        const room = gameRooms.get(roomCode);

        if (!room) {
            socket.emit('error', 'Room not found');
            console.log('Room not found')
            return;
        }

        io.to(roomCode).emit('submittedRanking', {
            ranking: ranking,
            playerId: playerId,
        })
    })

    // Leave room
    socket.on('leaveRoom', (roomCode: string) => {
        const room = gameRooms.get(roomCode);
        console.log('leavingRoom', roomCode)

        if (room) {
            // Remove player from room
            room.players = room.players.filter(p => p.id !== socket.id);

            if (room.players.length === 0) {
                // Delete room if empty
                gameRooms.delete(roomCode);
            } else {
                // Update room state
                gameRooms.set(roomCode, room);
                // Notify remaining players
                io.to(roomCode).emit('playerLeft', room.players);
                console.log('playerLeft', room.players)
            }
        }
        console.log('left room: ', roomCode)

        socket.leave(roomCode);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);

        // Find and clean up any rooms this socket was in
        gameRooms.forEach((room, code) => {
            if (room.players.some(p => p.id === socket.id)) {
                room.players = room.players.filter(p => p.id !== socket.id);

                if (room.players.length === 0) {
                    gameRooms.delete(code);
                } else {
                    gameRooms.set(code, room);
                    console.log('playerLeft: ', room.players)
                    io.to(code).emit('playerLeft', room.players);
                }
            }

            // If host disconnects, notify players
            if (room.host === socket.id) {
                console.log('Host has disconnected');
                io.to(code).emit('error', 'Host has disconnected');
            }
        });
    });
});

io.on('connect_error', (err) => {
    console.error('Socket.IO error:', err);
})

// Start server
const PORT: number = process.env.PORT ? parseInt(process.env.PORT) : 3001;
// const PORT = 3001;

httpServer.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
})

httpServer.on('clientError', (err, socket) => {
    // socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    console.error('Client error:', err);
})

httpServer.on('tlsClientError', (err, socket) => {
    // socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    console.error('TLS client error:', err.message, err.cause);
})

httpServer.on('connect', (socket) => {
    console.log('Client connected', socket.headers);
})

httpServer.on('connection', (socket) => {
    console.log('Client connection');
})

httpServer.on('request', (req, res) => {
    console.log('Client request', req.url, res.statusCode);
})

httpServer.on('error', (err) => {
    console.error('Server error:', err);
})

module.exports = httpServer