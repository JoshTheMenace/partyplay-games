import type { Roster, Settings } from '../src/model';
export const ARENA_SEATS: number, ARENA_NAMES: string;
export function arenaCount(players: number): number;
export function dealSeat(index: number, count: number, mode: Settings['mode']): { arena: number; place: number; team: number; slot: number };
export function dealArenas(players: readonly { id: string; name: string; lobbyChoice?: unknown }[], settings: Settings, weaponOrder: readonly string[], noBots: boolean): Roster[][];
export function packInk(grid: Uint8Array): string;
export function unpackInk(text: string, grid: Uint8Array): Uint8Array;
