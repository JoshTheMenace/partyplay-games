/* Shirt Show views, actions, scoring and reveal timing. Shared by server, client, bot and tests: no content banks here. */
import { DRAWING_COLORS, type Drawing } from '../../../../../party-contract/src/index';

export const ROUNDS = 2, MAX_DESIGNS = 4, MAX_SLOGANS = 6, MAX_SLOGAN = 40, HAND = 3;
/** A design needs this many ink points in total (no stray-tap dots on the runway). */
export const MIN_INK = 6;
export const inkOf = (d: Drawing) => d.strokes.reduce((n, s) => n + s.points.length, 0);
/** Base seconds before the pack's pace setting. */
export const DRAW_S = 75, WRITE_S = 50, MAKE_S = 60, VOTE_S = 13, FINAL_VOTE_S = 20;
/** Readable minimum before an all-submitted phase advances. */
export const MIN_READ_MS = 1500;
/** Shirts each player makes: two in small rooms so the ring has enough challengers. */
export const shirtsFor = (players: number) => players <= 4 ? 2 : 1;
/** Points per vote for a shirt's maker and for each borrowed part, the round champion's bonus and the final's. */
export const PTS = { maker: 100, part: 50, champ: 500, finalMaker: 200, finalPart: 100, finalWin: 1000 } as const;

export type Pos = 'top' | 'bottom';
export const SHIRT_COLORS = [
  { name: 'Snow', hex: '#f4efe4', light: true }, { name: 'Midnight', hex: '#1f2238', light: false },
  { name: 'Ring red', hex: '#dd3a32', light: false }, { name: 'Royal', hex: '#2c59cf', light: false },
  { name: 'Gold', hex: '#f3b92a', light: true }, { name: 'Hot pink', hex: '#f45fa9', light: true },
] as const;

/** Drawings travel compactly: per stroke [ink index, width ×1000, x0, y0, x1, y1…] with coordinates in thousandths. */
export type Packed = number[][];
export const pack = (d: Drawing): Packed => d.strokes.map(s => [DRAWING_COLORS.indexOf(s.color as typeof DRAWING_COLORS[number]), Math.round(s.width * 1000), ...s.points.flatMap(p => [Math.round(p.x * 1000), Math.round(p.y * 1000)])]);

export type Phase = 'draw' | 'write' | 'make' | 'show' | 'vote' | 'result' | 'champ' | 'final-show' | 'final-vote' | 'final-result';
/** A finished shirt. `design` is the media key of its packed drawing. */
export type ShirtView = { id: string; design: string; slogan: string; color: number; pos: Pos };
/** Who made the shirt and whose parts it wears (null = a house design or slogan). `auto`: stitched by the house at time-up. */
export type Credits = { maker: string; artist: string | null; writer: string | null; auto?: true };
export type Pts = { maker: number; artist: number; writer: number };
export type ClashResult = { voters: [string[], string[]]; winner: 0 | 1; tie?: true; credits: [Credits, Credits]; points: [Pts, Pts] };
/** King of the hill: side 0 is the shirt holding the ring (with `streak` wins), side 1 the challenger. */
export type Bout = { index: number; count: number; sides: [ShirtView, ShirtView]; streak: number; votes: number; result?: ClashResult & { streak: number } };
export type Final = { sides: [ShirtView, ShirtView]; credits: [Credits, Credits]; wins: [number, number]; votes: number; result?: ClashResult & { tiebreak?: true; bonus: number } };
export type Champ = { shirt: ShirtView; credits: Credits; wins: number; bonus: number };

export type ShirtPublic = {
  phase: Phase; round: number; turn: string;
  /** Phase start and end (server ms). */
  at: number; deadline: number;
  scores: Record<string, number>;
  /** Scores before this round (champ phase), for the animated board. */
  prev?: Record<string, number>;
  /** Draw/write: players who are finished. Make: players with every shirt in. */
  done: string[];
  /** Draw: designs per player. Write: slogans per player. Counts only, never content. */
  counts?: Record<string, number>;
  /** Make: shirts the room owes in total, and how many are sewn. */
  sewn?: [number, number];
  /** Write: a few helper prompts for the TV marquee. */
  sparks?: string[];
  bout?: Bout;
  /** Battle: shirts knocked out this round (oldest first) and challengers still waiting. */
  ko?: ShirtView[]; left?: number;
  champ?: Champ;
  final?: Final;
};
export type Hand = { designs: string[]; slogans: { id: string; text: string }[]; reroll: { design: boolean; slogan: boolean } };
export type ShirtPrivate = {
  turn: string;
  /** Draw: designs you sent this round. Write: your slogans. `finished` once you are done (or full). */
  designs?: number; slogans?: string[]; finished?: true;
  /** Draw: drawing ideas. Write: slogan helper prompts. */
  ideas?: string[];
  /** Make: shirts you owe, shirts you sent and your current hand. */
  need?: number; made?: ShirtView[]; hand?: Hand;
  /** Battle and final: the sides you made (no voting there) and your vote. */
  mine?: (0 | 1)[]; vote?: 0 | 1;
};
export type ShirtAction =
  | { turn: string; k: 'design'; drawing: Drawing }
  | { turn: string; k: 'slogan'; text: string }
  | { turn: string; k: 'done' }
  | { turn: string; k: 'reroll'; what: 'design' | 'slogan' }
  | { turn: string; k: 'shirt'; design: string; slogan: string; color: number; pos: Pos }
  | { turn: string; k: 'vote'; side: 0 | 1 };

// ---------- server-timed beats (ms from the phase start) so a reloaded TV lands on the same moment ----------
/** Show: the first bout of a round walks both shirts out; later bouts only the challenger. */
export const showMs = (index: number) => index === 0 ? 4200 : 3000;
export const RESULT = { voters: 500, credits: 1700, winner: 2900, end: 6400 } as const;
export const CHAMP_MS = 9000;
export const FINAL_SHOW_MS = 6500;
export const FINAL_RESULT = { voters: 1500, credits: 3200, winner: 5000, end: 12000 } as const;
