/* Split Decision views, actions, scoring and reveal timing. Shared by server, client, bot and tests: no content banks here. */

export const MAX_FILL = 60, BLANK = '____', LAST_ROUND = 3;
export const ROUND_NAMES = ['Round 1', 'Round 2 · Would you rather? ×2', 'The Big Split ×3'] as const;
/** Base seconds before the pack's pace setting. */
export const WRITE_S = 60, RATHER_S = 80, VOTE_S = 12, FINAL_WRITE_S = 60;
/** The Big Split carousel: a few seconds per take you judge. */
export const judgeSeconds = (takes: number) => Math.min(50, 10 + 4 * takes);
/** Readable minimum before an all-in phase advances; the scoreboard hold. */
export const MIN_READ_MS = 1500, SCORES_MS = 7500;
/** Author points for the evenest split possible; the floor when anyone dissented; each minority voter's Bold bonus. All × round. */
export const PERFECT = 1000, FLOOR = 100, BOLD = 50;

export type Side = 0 | 1;
export type Kind = 'dilemma' | 'rather';
export type Phase = 'write' | 'show' | 'vote' | 'result' | 'scores' | 'final-write' | 'final-vote' | 'final-result';
export type Verdict = 'perfect' | 'close' | 'lopsided' | 'unanimous' | 'silent';

/** Template text around its blanks: 'You can fly, but ____. Deal?' → ['You can fly, but ', '. Deal?']. */
export const partsOf = (template: string) => template.split(BLANK);
/** The finished sentence, for read-aloud and phone summaries. */
export const sentence = (parts: readonly string[], fills: readonly string[]) => parts.map((p, i) => p + (fills[i] ?? (i < parts.length - 1 ? '…' : ''))).join('');

/**
 * Author points (before the round multiplier): 1000 for the evenest split possible (4–4, or 5–4 with nine voters), scaled
 * down by imbalance, at least 100 when anyone dissented; 0 when unanimous or nobody voted. Rounded to tens.
 */
export function splitPoints(yes: number, no: number): number {
  if (!yes || !no) return 0;
  const n = yes + no, odd = n % 2;
  return Math.max(FLOOR, Math.round(PERFECT * (1 - (Math.abs(yes - no) - odd) / (n - odd)) / 10) * 10);
}
export function verdictOf(yes: number, no: number): Verdict {
  if (!yes && !no) return 'silent';
  if (!yes || !no) return 'unanimous';
  const points = splitPoints(yes, no);
  return points === PERFECT ? 'perfect' : points >= 500 ? 'close' : 'lopsided';
}
/** The side with strictly fewer votes (its voters earn the Bold bonus), or null for ties and unanimous rooms. */
export const minority = (yes: number, no: number): Side | null => !yes || !no || yes === no ? null : yes < no ? 0 : 1;

export type Outcome = {
  author: string;
  /** Voter ids: YES (or option A) first, then NO (or option B). */
  sides: [string[], string[]];
  points: number; verdict: Verdict;
  /** Points each minority voter earned (0 when there was no minority). */
  bold: number;
  /** A blank was filled by the machine: half points. */
  house?: true;
};
export type Card = {
  index: number; count: number; kind: Kind;
  /** Template text around the blanks (one more part than fills). */
  parts: string[]; fills: string[];
  /** How many votes are in (never who: the one missing voter would give the author away). */
  votes: number;
  outcome?: Outcome;
};
export type FinalOutcome = { id: string; fill: string; author: string; yes: number; no: number; points: number; verdict: Verdict; house?: true };
export type Final = {
  parts: string[];
  /** Anonymous takes in grid order (empty while writing). Ids are opaque, never player ids. */
  entries: { id: string; fill: string }[];
  /** Entries in reveal order (fewest points first); `best` are the top authors; `bold` is each judge's total Bold bonus. */
  result?: { entries: FinalOutcome[]; best: string[]; bold: Record<string, number> };
};

export type SplitPublic = {
  phase: Phase; round: number; turn: string;
  /** Phase start and end (server ms). Every phase has an end. */
  at: number; deadline: number;
  scores: Record<string, number>;
  /** Scores before this round (scores phase only). */
  prev?: Record<string, number>;
  /** Writing: players with every blank filled. Final vote: players who judged every take. Otherwise empty. */
  done: string[];
  card?: Card;
  final?: Final;
};
export type Slot = { text?: string; house?: true };
export type SplitPrivate = {
  turn: string;
  /** Writing phases: your scenario and its blanks. */
  task?: { kind: Kind; parts: string[]; slots: Slot[] };
  /** Card phases: you wrote it, or you vote on it (`side` once your vote is in). */
  role?: 'author' | 'voter';
  side?: Side;
  /** The Big Split: your take's id and your verdicts so far (entry id → side). */
  mine?: string;
  judged?: Record<string, Side>;
};
export type SplitAction =
  | { turn: string; k: 'fill'; slot: number; text: string }
  | { turn: string; k: 'house'; slot: number }
  | { turn: string; k: 'vote'; side: Side }
  | { turn: string; k: 'judge'; entry: string; side: Side };

/** The order a phone judges The Big Split: starting after your own take (so phones spread out), never your own. */
export function carousel<T extends { id: string }>(entries: readonly T[], mine?: string): T[] {
  const at = entries.findIndex(e => e.id === mine);
  return [...entries.slice(at + 1), ...entries.slice(0, Math.max(0, at))];
}

// ---------- server-timed beats (ms from the phase start), shared so a reloaded TV lands on the same moment ----------
/** Show phase: the template beams in, each fill materialises, then voting opens at `end`. */
export function showBeats(fills: readonly string[]): { fills: number[]; end: number } {
  const at = fills.reduce<number[]>((list, _, i) => [...list, i ? list[i - 1]! + 900 + 22 * fills[i - 1]!.length : 1500], []);
  return { fills: at, end: Math.min(7500, at.at(-1)! + 1700 + 16 * fills.join('').length) };
}
/** Result: voters slide to their sides, the author is revealed, then points and the verdict; perfect/unanimous hold longer. */
export const RESULT = { slide: 700, author: 2400, points: 3800, end: 7600, bonus: 1600 } as const;
/** The Big Split reveal: one take every `step` ms after `first`, then the splittiest, then the Bold bonuses, then a hold. */
export function finalBeats(count: number) {
  const first = 1800, step = count > 6 ? 950 : 1300, best = first + count * step + 600, bold = best + 2600;
  return { reveals: Array.from({ length: count }, (_, i) => first + i * step), best, bold, end: bold + 5200 };
}
