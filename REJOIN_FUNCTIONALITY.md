# Player Rejoin Functionality

This document describes the rejoin functionality implemented to allow users to reconnect to game rooms after being disconnected.

## Overview

The rejoin functionality allows players to rejoin a game room after an unexpected disconnection, preserving their game state including score, rankings, and host status.

## Key Features

### 1. Player State Preservation

- Players are marked as `isConnected: false` instead of being removed when disconnected
- All player data (score, rankings, host status) is preserved during disconnection
- Rooms are deleted immediately when all players are disconnected (no grace period)

### 2. Connection Management

- Socket.IO automatically detects disconnections after 60 seconds of inactivity
- Ping interval: 5 seconds, Ping timeout: 60 seconds
- True disconnections are reliably detected by the Socket.IO heartbeat mechanism

### 3. Rejoining Process

- Players can rejoin using the same `userId` they used originally
- The system detects existing players and updates their connection status
- Host privileges are automatically reassigned if the original host doesn't return

### 4. Host Management

- If the host disconnects, other players are notified via `host-disconnected` event
- When any player rejoins, the system checks if host reassignment is needed
- The first connected player becomes the new host if the original host remains disconnected

### 5. Resource Efficiency

- Empty rooms (no connected players) are deleted immediately
- No memory waste on abandoned rooms
- Optimal for server resource management

## New Socket Events

### Client to Server Events

#### `join-room` (Enhanced)

```typescript
{
  roomCode: string,
  name: string,
  userId: string
}
```

- Now handles both new joins and rejoins
- Detects existing players by `userId` and updates connection status

#### `get-room-status`

```typescript
roomCode: string
```

- Returns current room status including connected/disconnected players

#### `create-room` (Enhanced)

```typescript
{
  userId?: string  // Optional userId for tracking
}
```

### Server to Client Events

#### `player-rejoined`

```typescript
{
  player: Player,
  players: Player[]
}
```

- Emitted when a player successfully rejoins

#### `player-disconnected`

```typescript
{
  disconnectedPlayer: Player,
  players: Player[]
}
```

- Emitted when a player disconnects (but remains in room)

#### `host-disconnected`

```typescript
{
  hostName: string,
  players: Player[]
}
```

- Emitted when the host disconnects

#### `host-reassigned`

```typescript
{
  newHost: Player,
  players: Player[]
}
```

- Emitted when host privileges are transferred

#### `room-status`

```typescript
{
  room: GameRoom,
  connectedPlayers: Player[],
  disconnectedPlayers: Player[]
}
```

- Response to `get-room-status` request

## Implementation Details

### Player Interface Updates

```typescript
interface Player {
  userId: string;
  name?: string;
  score: number;
  rankings?: string[];
  isHost?: boolean;
  isConnected?: boolean;  // New field
  roundScore?: number;
}
```

### Room Cleanup Logic

- Rooms with no connected players are deleted immediately upon last player disconnect
- No grace period or timeout delays
- Efficient memory management with instant cleanup
- Rooms are only preserved while at least one player remains connected

### Host Reassignment Logic

```typescript
// Triggered when:
// 1. A player rejoins
// 2. Need to ensure there's always a connected host

const reassignHostIfNeeded = (roomCode: string, gameRoom: GameRoom) => {
  // Find current host
  // If host is disconnected, assign to first connected player
  // Update host status and notify all players
}
```

## Usage Examples

### Client-side Implementation

```typescript
// Store userId for rejoining
const userId = generateUniqueId();

// Join room
socket.emit('join-room', { roomCode, name: playerName, userId });

// Handle rejoin success
socket.on('player-rejoined', ({ player, players }) => {
  console.log('Successfully rejoined!');
  updatePlayerList(players);
});

// Handle other players rejoining
socket.on('player-rejoined', ({ player }) => {
  showNotification(`${player.name} has rejoined the game`);
});

// Handle disconnections
socket.on('player-disconnected', ({ disconnectedPlayer }) => {
  showNotification(`${disconnectedPlayer.name} has disconnected`);
});

// Handle host changes
socket.on('host-reassigned', ({ newHost }) => {
  showNotification(`${newHost.name} is now the host`);
});
```

### Error Handling

The system handles various edge cases:

- Room not found during rejoin attempt
- Multiple players with same userId (shouldn't happen with good client-side UUID generation)
- Host disconnection and reassignment
- All players disconnecting (room cleanup)

## Benefits

1. **Improved User Experience**: Players don't lose progress due to network issues
2. **Game Continuity**: Games can continue even with temporary disconnections  
3. **Robust Host Management**: Always ensures there's a connected host
4. **Automatic Cleanup**: Prevents memory leaks from abandoned rooms
5. **Transparent Reconnection**: Seamless experience for players rejoining

## Testing

To test the rejoin functionality:

1. Create a room and join with a player
2. Simulate disconnection (close browser tab or disconnect network)
3. Reconnect and try to join the same room with the same userId
4. Verify that player data (score, rankings) is preserved
5. Test host reassignment by having the host disconnect and another player rejoin
