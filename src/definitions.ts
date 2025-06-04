export interface Player {
    userId: string;
    name?: string;
    score: number;
    rankings?: string[];
    isHost?: boolean;
    isConnected?: boolean;
    roundScore?: number;
}

export interface Game {
    currentRound: number;
    totalRounds: number;
    targetPlayerIndex: number;
    currentCards: string[];
    targetRankings: string[];
    isGameOver?: boolean;
}

export interface GameRoom {
    code: string;
    players: Player[];
    host?: string;
    game: Game;
}

export type Category = 'general' | 'adult' | 'dating' | 'pop-culture';

export type GameState =
    | 'setup'
    | 'targetRanking'
    | 'waitingForRankings'
    | 'groupPrediction'
    | 'review'
    | 'gameOver';
export interface RoomJoinedData {
    code: string;
    players: Player[];
}

export interface SubmittedRankingData {
    ranking: string[];
    userId: string;
}