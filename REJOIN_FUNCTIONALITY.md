# Player Rejoin Functionality

This document describes the rejoin functionality implemented to allow users to reconnect to game rooms after being disconnected.

## Overview

The rejoin functionality allows players to rejoin a game room after an unexpected disconnection, preserving their game state including score, rankings, and host status.

## Key Features

### 1. Player State Preservation

- Players are marked as `isConnected: false` instead of being removed when disconnected
- All player data (score, rankings, host status) is preserved during disconnection
- When all players leave or disconnect, the room remains available for **10 minutes** before being deleted
- If any player rejoins within the 10-minute grace period, the cleanup timer is canceled and the room stays active

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

### 5. Room Cleanup Grace Period

- When all players leave or disconnect, a **10-minute grace period** begins
- If any player rejoins within the grace period, the timer is cancelled and the room is preserved
- After 10 minutes with no reconnections, the room is permanently deleted
- Only one cleanup timer runs per room at a time (duplicate timers are prevented)
- Ensures players have time to rejoin after brief network issues or accidental disconnections

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
  isConnected?: boolean;
  roundScore?: number;
}
```

### GameRoom Interface Updates

```typescript
interface GameRoom {
  code: string;
  players: Player[];
  host?: string;
  game: Game;
  cleanupTimer?: ReturnType<typeof setTimeout>;  // Tracks the 10-minute grace period timer
}
```

### Room Cleanup Logic

- When the last connected player leaves or disconnects, a 10-minute cleanup timer is started
- If a player rejoins during the grace period, the timer is cancelled (`cancelRoomCleanup`)
- After the grace period expires, the room is deleted only if no players have reconnected
- Duplicate timers are prevented — if a timer is already running, a new one won't be started
- The `cleanupTimer` field on `GameRoom` tracks the pending timeout

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

- Room not found during rejoin attempt (room may have been deleted after the 10-minute grace period)
- Multiple players with same userId (shouldn't happen with good client-side UUID generation)
- Host disconnection and reassignment
- All players disconnecting (10-minute grace period before room cleanup)
- Player rejoining during the grace period (cleanup timer is cancelled)

## Benefits

1. **Improved User Experience**: Players don't lose progress due to network issues
2. **Game Continuity**: Games can continue even with temporary disconnections  
3. **Robust Host Management**: Always ensures there's a connected host
4. **Graceful Cleanup**: 10-minute grace period prevents premature room deletion while still cleaning up abandoned rooms
5. **Transparent Reconnection**: Seamless experience for players rejoining

## Testing

To test the rejoin functionality:

1. Create a room and join with a player
2. Simulate disconnection (close browser tab or disconnect network)
3. Reconnect and try to join the same room with the same userId
4. Verify that player data (score, rankings) is preserved
5. Test host reassignment by having the host disconnect and another player rejoin
6. Test grace period: have all players leave, then rejoin within 10 minutes — room should still exist
7. Test cleanup: have all players leave and wait more than 10 minutes — room should be deleted
