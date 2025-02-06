"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var socket_io_1 = require("socket.io");
var cors_1 = require("cors");
require("dotenv/config");
var http_1 = require("http");
var origin = process.env.ORIGIN;
console.log('origin: ', origin, process.env.PORT);
// State management | TODO: use redis or database
var gameRooms = new Map();
// Express setup
var app = (0, express_1.default)();
var corsSettings = {
    origin: origin,
    credentials: true,
    methods: ['GET', 'POST'],
};
app.use((0, cors_1.default)(corsSettings));
var httpServer = (0, http_1.createServer)(app);
var io = new socket_io_1.Server(httpServer, {
    transports: ['websocket'],
    cors: {
        origin: origin,
        methods: ["GET", "POST"],
        credentials: true,
    }
});
// Helper functions
var generateRoomCode = function () {
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var result = '';
    for (var i = 0; i < 10; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
};
var createUniqueRoomCode = function () {
    var code;
    do {
        code = generateRoomCode();
    } while (gameRooms.has(code));
    return code;
};
io.use(function (socket, next) {
    console.log('New socket connection:', socket.id);
    next();
});
// Socket.IO event handlers
io.on('connection', function (socket) {
    io.emit('connected!!!!!!', socket.id); // not needed
    console.log("connected with transport ".concat(socket.nsp.name, " and id ").concat(socket.id));
    // Create a new room
    socket.on('createRoom', function () {
        var roomCode = createUniqueRoomCode();
        gameRooms.set(roomCode, {
            code: roomCode,
            players: [],
            host: socket.id
        });
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        console.log('Room created:', roomCode);
    });
    socket.on('message', function (data) {
        console.log('Message received:', data);
        io.emit('message', data);
    });
    // Join an existing room
    socket.on('joinRoom', function (roomCode) {
        var room = gameRooms.get(roomCode);
        if (!room) {
            socket.emit('error', 'Room not found');
            console.log('Room not found');
            return;
        }
        socket.join(roomCode);
        socket.emit('roomJoined', {
            code: roomCode,
            players: room.players
        });
        console.log('roomJoined');
    });
    // Submit player name
    socket.on('submitName', function (_a) {
        var roomCode = _a.roomCode, playerName = _a.playerName, playerId = _a.playerId;
        var room = gameRooms.get(roomCode);
        if (!room) {
            socket.emit('error', 'Room not found');
            console.log('Room not found');
            return;
        }
        // Check for duplicate names
        if (room.players.some(function (p) { return p.name.toLowerCase() === playerName.toLowerCase(); })) {
            socket.emit('error', 'Name already taken');
            console.log('Name already taken');
            return;
        }
        // Add player to room
        var newPlayer = {
            id: playerId,
            name: playerName
        };
        room.players.push(newPlayer);
        gameRooms.set(roomCode, room);
        // Notify all players in the room
        io.to(roomCode).emit('playerJoined', room.players);
    });
    // submitRanking
    socket.on('submitRanking', function (_a) {
        var roomCode = _a.roomCode, ranking = _a.ranking, playerId = _a.playerId;
        var room = gameRooms.get(roomCode);
        if (!room) {
            socket.emit('error', 'Room not found');
            console.log('Room not found');
            return;
        }
        io.to(roomCode).emit('submittedRanking', {
            ranking: ranking,
            playerId: playerId,
        });
    });
    // Leave room
    socket.on('leaveRoom', function (roomCode) {
        var room = gameRooms.get(roomCode);
        console.log('leavingRoom', roomCode);
        if (room) {
            // Remove player from room
            room.players = room.players.filter(function (p) { return p.id !== socket.id; });
            if (room.players.length === 0) {
                // Delete room if empty
                gameRooms.delete(roomCode);
            }
            else {
                // Update room state
                gameRooms.set(roomCode, room);
                // Notify remaining players
                io.to(roomCode).emit('playerLeft', room.players);
                console.log('playerLeft', room.players);
            }
        }
        console.log('left room: ', roomCode);
        socket.leave(roomCode);
    });
    // Handle disconnection
    socket.on('disconnect', function () {
        console.log("Client disconnected: ".concat(socket.id));
        // Find and clean up any rooms this socket was in
        gameRooms.forEach(function (room, code) {
            if (room.players.some(function (p) { return p.id === socket.id; })) {
                room.players = room.players.filter(function (p) { return p.id !== socket.id; });
                if (room.players.length === 0) {
                    gameRooms.delete(code);
                }
                else {
                    gameRooms.set(code, room);
                    console.log('playerLeft: ', room.players);
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
io.on('connect_error', function (err) {
    console.error('Socket.IO error:', err);
});
// Start server
var PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
// const PORT = 3001;
httpServer.listen(PORT, function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        console.log("Server running on port ".concat(PORT));
        return [2 /*return*/];
    });
}); });
httpServer.on('clientError', function (err, socket) {
    // socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    console.error('Client error:', err);
});
httpServer.on('tlsClientError', function (err, socket) {
    // socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    console.error('TLS client error:', err.message, err.cause);
});
httpServer.on('connect', function (socket) {
    console.log('Client connected', socket);
});
httpServer.on('connection', function (socket) {
    console.log('Client connection', socket);
});
httpServer.on('request', function (req, res) {
    console.log('Client request', req, res);
});
httpServer.on('error', function (err) {
    console.error('Server error:', err);
});
