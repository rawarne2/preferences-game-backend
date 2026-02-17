# Preferences Game Backend

Backed service for Preferences game that uses TypeScript, Express, and Socket.io.

## Keep-Alive Functionality

This service includes built-in keep-alive functionality to prevent it from sleeping on Render.

### How it works

1. **Health Check Endpoint**: Available at `/health` - returns server status and metrics
2. **Auto Keep-Alive**: In production, the service automatically pings itself every 10 minutes
3. **Render Integration**: Automatically uses Render's `RENDER_EXTERNAL_URL` environment variable

### Render Deployment

The service automatically detects when deployed to Render by using the `RENDER_EXTERNAL_URL` environment variable that Render provides automatically. No additional configuration is needed.

### Manual Keep-Alive Options

If you need additional monitoring or want to use external services:

1. **External Service**: Use services like UptimeRobot, Pingdom, or cron-job.org to ping your `/health` endpoint every 10-15 minutes

2. **Cron Job**: Set up a cron job to ping your service:

```bash
# Add to crontab (runs every 10 minutes)
*/10 * * * * curl -s https://preferences-game-backend.onrender.com/health > /dev/null
```

### Monitoring

The service logs keep-alive pings to help with debugging:

```
[2023-12-07T10:00:00.000Z] Keep-alive ping successful
```

## API Endpoints

- `GET /` - Basic API information
- `GET /health` - Health check and server metrics
- WebSocket connection for real-time game functionality

## Development

```bash
npm install
npm run dev
```

## Production

```bash
npm run build
npm start
```

## Running with Docker Compose

Docker is **optional**. Use it if you prefer running the app in a container (e.g. to match another service or avoid installing Node locally). Otherwise, use the Development or Production commands above.

**Start the app (builds and runs in foreground):**

```bash
docker compose up --build
```

**Start in the background:**

```bash
docker compose up --build -d
```

**Stop:**

```bash
docker compose down
```

The Compose setup uses `Dockerfile.dev`, runs `npm run dev`, and exposes port 3000 with `NODE_ENV=development` and `ORIGIN=http://localhost:5173`.

--------------------------------

# **Socket.IO Backend Contract**

This contract defines the **event names**, **payloads**, and **expected responses** for both client and server based on the actual implementation.

---

## **Client → Server Events**

### 1. `create-room`

- **Payload:**

  ```json
  {
    "userId": "string"  // optional persistent user ID
  }
  ```

- **Server Response:**  
  Emits `room-created` to the creator.

---

### 2. `join-room`

- **Payload:**

  ```json
  {
    "roomCode": "string",
    "name": "string",
    "userId": "string"
  }
  ```

- **Server Response:**  
  Emits `player-joined` to all in the room (for new players) or `player-rejoined` (for returning players).

---

### 3. `get-room-status`

- **Payload:**

  ```json
  "roomCode"  // string
  ```

- **Server Response:**  
  Emits `room-status` with room details or `room-status-error` if room not found.

---

### 4. `start-game`

- **Payload:**

  ```json
  {
    "roomCode": "string",
    "totalRounds": number,
    "currentCards": ["string", ...]
  }
  ```

- **Server Response:**  
  Emits `game-started` to all in the room.

---

### 5. `next-turn`

- **Payload:**

  ```json
  {
    "roomCode": "string",
    "currentCards": ["string", ...]
  }
  ```

- **Server Response:**  
  Emits `increment-turn` to all in the room or `next-turn-error` if room not found.

---

### 6. `submit-rankings`

- **Payload:**

  ```json
  {
    "roomCode": "string",
    "rankings": ["string", "string", "string", "string", "string"],
    "userId": "string"
  }
  ```

- **Server Response:**  
  Emits `rankings-submitted` to all in the room with updated game state.

---

### 7. `leave-room`

- **Payload:**

  ```json
  "roomCode"  // string
  ```

- **Server Response:**  
  Emits `player-left` to all remaining players in the room.

---

### 8. `message`

- **Payload:**

  ```json
  // any data object
  ```

- **Server Response:**  
  Broadcasts `message` to all connected clients.

---

## **Server → Client Events**

### 1. `room-created`

- **Payload:**

  ```json
  {
    "roomCode": "string"
  }
  ```

---

### 2. `player-joined`

- **Payload:**

  ```json
  [Player]  // array of all players in the room
  ```

---

### 3. `player-rejoined`

- **Payload:**

  ```json
  {
    "player": Player,
    "players": [Player]
  }
  ```

---

### 4. `player-left`

- **Payload:**

  ```json
  [Player]  // array of remaining players in the room
  ```

---

### 5. `room-status`

- **Payload:**

  ```json
  {
    "room": GameRoom,
    "connectedPlayers": [Player],
    "disconnectedPlayers": [Player]
  }
  ```

---

### 6. `room-status-error`

- **Payload:**

  ```json
  "string"  // error message
  ```

---

### 7. `game-started`

- **Payload:**

  ```json
  GameRoom  // complete game room state
  ```

---

### 8. `increment-turn`

- **Payload:**

  ```json
  GameRoom  // updated game room state with next turn
  ```

---

### 9. `next-turn-error`

- **Payload:**

  ```json
  "string"  // error message
  ```

---

### 10. `rankings-submitted`

- **Payload:**

  ```json
  GameRoom  // updated game room state with scores
  ```

---

### 11. `submit-rankings-error`

- **Payload:**

  ```json
  "string"  // error message
  ```

---

### 12. `host-reassigned`

- **Payload:**

  ```json
  {
    "newHost": Player,
    "players": [Player]
  }
  ```

---

### 13. `host-disconnected`

- **Payload:**

  ```json
  {
    "hostName": "string",
    "players": [Player]
  }
  ```

---

### 14. `error`

- **Payload:**

  ```json
  "string"  // error message
  ```

---

### 15. `message`

- **Payload:**

  ```json
  // any data object (broadcast from other clients)
  ```

---

## **Type Definitions**

### **Player**

```typescript
{
  userId: string;
  name?: string;
  score: number;
  rankings?: string[];
  isHost?: boolean;
  isConnected?: boolean;
  roundScore?: number;
}
```

### **Game**

```typescript
{
  currentRound: number;
  totalRounds: number;
  targetPlayerIndex: number;
  currentCards: string[];
  targetRankings: string[];
}
```

### **GameRoom**

```typescript
{
  code: string;
  players: Player[];
  host?: string;
  game: Game;
  cleanupTimer?: ReturnType<typeof setTimeout>;  // Tracks 10-minute grace period before room deletion
}
```

---

## **Game Flow & Scoring**

1. **Room Creation**: Host creates room and gets a unique room code
2. **Player Joining**: Players join using room code, first player becomes host
3. **Game Start**: Host starts game with specified rounds and cards
4. **Turn Progression**: Game progresses through players as target players
5. **Rankings Submission**: Target player submits their ranking, others submit predictions
6. **Scoring**: Players get points based on how close their predictions match the target's ranking (max 20 points per round, -1 for each position difference)
7. **Next Turn**: Game moves to next player or next round

## **Connection Management**

- Players are marked as `isConnected: false` when they disconnect but remain in the game
- Players can rejoin and will be marked as `isConnected: true`
- Host is reassigned automatically if current host disconnects
- When all players leave or disconnect, the room remains available for **10 minutes** before being deleted, giving players a chance to rejoin
- If any player rejoins within the 10-minute grace period, the cleanup timer is cancelled
- Players have 2 minutes of inactivity before being disconnected

---

## **Notes**

- All game state is stored in memory (no persistence)
- Host privileges include starting games and managing turns
- Scoring is calculated server-side to prevent cheating
- Room codes are generated to be unique across all active rooms
