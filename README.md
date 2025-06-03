# preferences-game-backend

Backed service for Preferences game that uses TypeScript, Express, and  Socket.io.

Do not use this code for any reason other than evaluating this task on DataAnnotation.

## Running the server

```bash
npm run dev
```

--------------------------------

Here’s a **sample backend contract** for your socket.io server. This contract defines the **event names**, **payloads**, and **expected responses** for both client and server.

---

# **Socket.IO Backend Contract**

---

## **Client → Server Events**

### 1. `create-room`

- **Payload:**

  ```json
  {
    "userId": "string",        // persistent user ID
    "name": "string"
  }
  ```

- **Server Response:**  
  Emits `room-created` to the creator (and possibly to all in the room).

---

### 2. `join-room`

- **Payload:**

  ```json
  {
    "userId": "string",
    "name": "string",
    "roomCode": "string"
  }
  ```

- **Server Response:**  
  Emits `room-joined` to the joining player, `player-joined` to all in the room.

---

### 3. `rejoin-room`

- **Payload:**

  ```json
  {
    "userId": "string",
    "roomCode": "string"
  }
  ```

- **Server Response:**  
  Emits `reconnect-success` (with full room/game state) to the rejoining player.

---

### 4. `leave-room`

- **Payload:**

  ```json
  {
    "userId": "string",
    "roomCode": "string"
  }
  ```

- **Server Response:**  
  Emits `player-left` to all in the room. If last player, emits `room-deleted`.

---

### 5. `start-game` (host only)

- **Payload:**

  ```json
  {
    "userId": "string",
    "roomCode": "string"
  }
  ```

- **Server Response:**  
  Emits `game-started` to all in the room.

---

### 6. `submit-rankings`

- **Payload:**

  ```json
  {
    "userId": "string",
    "roomCode": "string",
    "rankings": ["string", "string", "string", "string", "string"]
  }
  ```

- **Server Response:**  
  Emits `rankings-submitted` (acknowledgement or updated state).

---

### 7. `submit-prediction`

- **Payload:**

  ```json
  {
    "userId": "string",
    "roomCode": "string",
    "prediction": ["string", "string", "string", "string", "string"]
  }
  ```

- **Server Response:**  
  Emits `prediction-submitted` (acknowledgement or updated state).

---

### 8. `reset-game` (host only)

- **Payload:**

  ```json
  {
    "userId": "string",
    "roomCode": "string"
  }
  ```

- **Server Response:**  
  Emits `game-reset` to all in the room.

---

### 9. `delete-room` (host only)

- **Payload:**

  ```json
  {
    "userId": "string",
    "roomCode": "string"
  }
  ```

- **Server Response:**  
  Emits `room-deleted` to all in the room.

---

## **Server → Client Events**

### 1. `room-created`

- **Payload:**

  ```json
  {
    "roomCode": "string",
    "players": [Player],
    "hostId": "string"
  }
  ```

---

### 2. `room-joined`

- **Payload:**

  ```json
  {
    "roomCode": "string",
    "players": [Player],
    "hostId": "string"
  }
  ```

---

### 3. `player-joined`

- **Payload:**

  ```json
  {
    "players": [Player]
  }
  ```

---

### 4. `player-left`

- **Payload:**

  ```json
  {
    "players": [Player]
  }
  ```

---

### 5. `game-started`

- **Payload:**

  ```json
  {
    "roomState": RoomState
  }
  ```

---

### 6. `rankings-submitted`

- **Payload:**

  ```json
  {
    "userId": "string",
    "status": "ok" | "error",
    "message"?: "string"
  }
  ```

---

### 7. `prediction-submitted`

- **Payload:**

  ```json
  {
    "userId": "string",
    "status": "ok" | "error",
    "message"?: "string"
  }
  ```

---

### 8. `round-reviewed`

- **Payload:**

  ```json
  {
    "targetRankings": ["string", ...],
    "playerScores": [
      {
        "userId": "string",
        "score": number,           // round score for this player
        "diffs": [number, ...]     // per-card diffs for this round
      }
    ]
  }
  ```

---

### 9. `score-updated`

- **Payload:**

  ```json
  {
    "players": [Player]           // with updated total scores
  }
  ```

---

### 10. `game-reset`

- **Payload:**

  ```json
  {
    "roomState": RoomState
  }
  ```

---

### 11. `room-deleted`

- **Payload:**

  ```json
  {
    "roomCode": "string"
  }
  ```

---

### 12. `game-over`

- **Payload:**

  ```json
  {
    "players": [Player],
    "winnerId": "string"
  }
  ```

---

### 13. `reconnect-success`

- **Payload:**

  ```json
  {
    "roomState": RoomState
  }
  ```

---

### 14. `error`

- **Payload:**

  ```json
  {
    "message": "string"
  }
  ```

---

## **Type Definitions**

### **Player**

```json
{
  "userId": "string",
  "name": "string",
  "score": number,
  "isHost": boolean,
  "isOnline": boolean
}
```

### **RoomState**

```json
{
  "roomCode": "string",
  "players": [Player],
  "hostId": "string",
  "gameState": "setup" | "targetRanking" | "groupPrediction" | "review" | "gameOver",
  "currentRound": number,
  "totalRounds": number,
  "targetPlayerIndex": number,
  "currentCards": ["string", ...],
  "targetRankings": ["string", ...],
  "groupPredictions": ["string", ...],
  // ...any other state needed for reconnection
}
```

---

## **Notes & Recommendations**

- All events should include `userId` and `roomCode` for authentication and routing.
- The server should validate host actions (e.g., only host can start/reset/delete).
- On reconnection, the server should send the full `RoomState` so the client can restore UI.
- For scoring, the server should calculate and emit per-player round scores and diffs for the review screen.
- The server should handle room cleanup when all players leave.
