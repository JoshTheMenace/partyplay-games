import type { GameManifest, Outcome } from './index';
export type RoomPhase = 'picker' | 'lobby' | 'preparing' | 'playing' | 'results';
export type RosterPlayer = { id: string; name: string; color: string; connected: boolean; ready: boolean; lobbyChoice?: unknown };
export type RoomView = {
  id: string; code: string; revision: number; phase: RoomPhase; hostId: string; hostConnected: boolean;
  players: RosterPlayer[]; gameId: string | null; settings: unknown; roundId: string | null;
  lobbyId?: string; actionWindow?: number; activePlayerIds: string[]; startAt: number | null; preparationDeadline: number | null; notice: string | null;
};
export type PairPatch = { set: [number, number][]; remove: number[] };
export type PublicCache = { revision: number; reused: boolean; baseRevision?: number; patches?: Record<string, PairPatch> };
export type Snapshot = { roundId: string; revision: number; serverTime: number; publicView: unknown; publicCache?: PublicCache; privateView: unknown | null; outcome?: Outcome };
export type Welcome = { clientId: string; playerId: string | null; token: string; nextActionSequence?: number; room: RoomView; games: GameManifest[] };
export type Wire = { v: '1.0'; type: string; [key: string]: unknown };
