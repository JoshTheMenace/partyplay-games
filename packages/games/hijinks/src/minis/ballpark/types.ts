/* Ballpark views, actions, scoring and reveal timing. Shared by server, client, bot and tests: no content banks here. */

export type Phase = 'survey' | 'guess' | 'bet' | 'reveal' | 'scores' | 'tick' | 'pick' | 'wanted';
export type Bet = 'much-lower' | 'lower' | 'higher' | 'much-higher';
export const BETS: readonly Bet[] = ['much-lower', 'lower', 'higher', 'much-higher'];
export const ROUND_NAMES = ['Round 1', 'Round 2 · Long shots', 'Final round'] as const;

/** A "much" bet needs the truth more than this many points away from the agent's guess. */
export const MUCH = 15;
/** Agent points by distance from the truth (first tier that fits). */
export const TIERS = [
  { within: 3, points: 1000, label: 'Bullseye!' }, { within: 7, points: 750, label: 'Red hot!' },
  { within: 12, points: 500, label: 'In the ballpark' }, { within: 20, points: 250, label: 'Warm-ish' },
] as const;
export const BET_POINTS = { plain: 500, much: 1000 } as const;
/** Most Wanted: points per pick by the statement's rank in the room's ticks (1st, 2nd, 3rd). */
export const WANTED_POINTS = [1000, 700, 500] as const;
export const WANTED_SIZE = 9, WANTED_PICKS = 3;
/** Base seconds before the pack's pace setting. The survey scales with the question's length (6–12 s). */
export const GUESS_S = 25, BET_S = 15, TICK_S = 40, PICK_S = 30;
export const surveySeconds = (text: string) => Math.min(12, Math.max(6, Math.round(4 + text.length / 12)));
/** Readable minimum before an all-in phase advances; the beat that holds the agent's LOCKED stamp. */
export const MIN_READ_MS = 1500, LOCK_MS = 1400, SCORES_MS = 7500;
/** The agent's phone sends dial positions at most this often; the server ignores anything faster. */
export const AIM_MS = 250;

export const tierOf = (guess: number, truth: number) => TIERS.findIndex(t => Math.abs(guess - truth) <= t.within);
/** Whether a bet can win at all for this guess (no "lower" than 0 %, no "much higher" from 90 %). */
export function possible(bet: Bet, guess: number): boolean {
  return bet === 'higher' ? guess < 100 : bet === 'lower' ? guess > 0 : bet === 'much-higher' ? guess + MUCH < 100 : guess - MUCH > 0;
}
/** Exactly on the guess loses every bet: the agent nailed it. */
export function wins(bet: Bet, guess: number, truth: number): boolean {
  return bet === 'higher' ? truth > guess : bet === 'lower' ? truth < guess : bet === 'much-higher' ? truth - guess > MUCH : guess - truth > MUCH;
}
/** Phone/TV copy for a bet against a guess, e.g. "Much higher" · "58% or more". */
export function betCopy(bet: Bet, guess: number): { label: string; range: string } {
  const label = { 'much-lower': 'Much lower', lower: 'Lower', higher: 'Higher', 'much-higher': 'Much higher' }[bet];
  const range = bet === 'higher' ? `${guess + 1}% or more` : bet === 'lower' ? `${guess - 1}% or less` : bet === 'much-higher' ? `${guess + MUCH + 1}% or more` : `${guess - MUCH - 1}% or less`;
  return { label, range };
}

/** The question in play. `dial` is the agent's live position while guessing, then the locked guess. */
export type Case = {
  index: number; count: number; text: string; agent: string;
  /** Players who answered the survey (from the guess on). */
  respondents?: number;
  dial: number | null; locked: boolean;
  /** Tagged harmless: the reveal shows who said what. Everything else stays anonymous. */
  open?: true;
};
export type Reveal = {
  truth: number; guess: number; yes: number; no: number;
  /** Fewer than two answers (one would expose its author): the lab made up the number. */
  house?: true;
  /** The agent never touched the dial: the guess defaulted to 50 %. */
  auto?: true;
  /** Open questions only. */
  yesIds?: string[]; noIds?: string[];
  bets: Record<string, Bet>;
  /** Index into TIERS, or -1. */
  tier: number;
  gains: Record<string, number>;
};
export type WantedResult = {
  /** Ticks per statement, ranks (1 = most ticked, competition ranking) and the reveal order (fewest first). */
  counts: number[]; ranks: number[]; order: number[];
  /** Players who filed ticks: the denominator for "4 of 9". */
  filed: number;
  picks: Record<string, number[]>;
  gains: Record<string, number>;
};
export type Wanted = { title: string; items: string[]; result?: WantedResult };

export type BallparkPublic = {
  phase: Phase; round: number; turn: string;
  /** Phase start and end (server ms). */
  at: number; deadline: number;
  scores: Record<string, number>;
  /** Scores before this round (scores phase only). */
  prev?: Record<string, number>;
  /** Survey: answered. Bet: bettors who bet. Tick/pick: filed. Never what anyone chose. */
  done: string[];
  q?: Case;
  result?: Reveal;
  wanted?: Wanted;
};
export type BallparkPrivate = {
  turn: string;
  /** Rounds 1–2: this question's agent or a bettor. */
  role?: 'agent' | 'bettor';
  /** Your own survey answer for this question. */
  answer?: 'yes' | 'no';
  bet?: Bet;
  ticks?: number[]; picks?: number[];
};
export type BallparkAction =
  | { turn: string; k: 'answer'; yes: boolean }
  | { turn: string; k: 'aim'; value: number }
  | { turn: string; k: 'lock'; value: number }
  | { turn: string; k: 'bet'; bet: Bet }
  | { turn: string; k: 'ticks'; ticks: number[] }
  | { turn: string; k: 'picks'; picks: number[] };

// ---------- server-timed beats (ms from the phase start), shared so a reloaded TV lands on the same moment ----------
/** Reveal: bets fly in, the truth needle sweeps from the guess, it lands with the crowds, then the points. */
export const REVEAL = { bets: 300, sweep: 1600, land: 4400, score: 5900, end: 9800 } as const;
/** The sweep: a damped spring from the guess to the truth (0–1 progress → 0–1 travel, overshooting a little). */
export const spring = (p: number) => p >= 1 ? 1 : 1 - Math.exp(-5.5 * p) * Math.cos(8.5 * p);
/** Most Wanted reveal: the six least-ticked quickly, then the top three slowly, then the hunters' totals. */
export function wantedBeats(n = WANTED_SIZE) {
  const reveals = Array.from({ length: n }, (_, i) => i < n - 3 ? 1400 + i * 650 : 1400 + (n - 3) * 650 + (i - (n - 3)) * 1900 + 600);
  const totals = (reveals.at(-1) ?? 0) + 2200;
  return { reveals, totals, end: totals + 6000 };
}
