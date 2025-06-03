import type { GameRoom } from './definitions';

export const generateRoomCode = (): string => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 10; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
};

export const createUniqueRoomCode = (gameRooms: Map<string, GameRoom>): string => {
    let code: string;
    do {
        code = generateRoomCode();
    } while (gameRooms.has(code));
    return code;
};
