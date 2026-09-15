import type { Color } from './cards';
export type Settings = Record<string, never>;
export type Action = { type: 'draw'; turnId: string; from: 'deck' | number } | { type: 'discard'; turnId: string; card: number };
export type CardSet = { type: 'color'; color: Color; cards: number[] } | { type: 'triple'; cardId: number; cards: number[] };
export type Phase = 'draw' | 'discard' | 'won';
/** hand is present only once the game is won; until then only handSize is public. */
export type Seat = { id: string | null; name: string; color: string; bot: boolean; away: boolean; handSize: number; pile: number[]; hand?: number[] };
export type PublicView = {
  turnId: string; phase: Phase; round: number; current: number; seats: Seat[];
  log: { n: number; text: string }[]; winner: number | null; sets: CardSet[] | null;
};
export type PrivateView = { turnId: string; seat: number; hand: number[]; drawn: number | null } | null;
