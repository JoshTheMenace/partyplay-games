/* Quip Clash views, actions and reveal timing. Shared by server, client, bot and tests: no content banks here. */

export const MAX_ANSWER = 80, FINAL_VOTES = 3, LAST_ROUND = 3;
/** Base seconds before the pack's pace setting. */
export const WRITE_S = 75, VOTE_S = 15, FINAL_VOTE_S = 30;
/** Readable minimum before an all-submitted phase advances. */
export const MIN_READ_MS = 1500;
export const ROUND_NAMES = ['Round 1', 'Round 2 · Double points', 'Last Laugh · Triple points'] as const;
export const letter = (i: number) => String.fromCharCode(65 + i);

export type Phase = 'write' | 'show' | 'vote' | 'result' | 'scores' | 'final-write' | 'final-vote' | 'final-result';
export type Answer = { text: string };
/** A matchup answer once revealed: who wrote it, who voted for it and what it scored. */
export type Reveal = { text: string; author: string; voters: string[]; points: number; safety?: true };
export type Match = {
  index: number; count: number; prompt: string;
  /** Both answers, anonymous until the result phase. */
  answers: Answer[];
  /** How many votes are in (never who: the missing voters would give the authors away). */
  votes: number;
  result?: { sides: Reveal[]; winner: number | null; wipe?: true; jinx?: true };
};
export type FinalReveal = { id: string; text: string; author: string; votes: number; voters: string[]; points: number; safety?: true };
export type Final = {
  prompt: string;
  /** Anonymous answers in grid order (empty while writing). Ids are opaque, never player ids. */
  entries: { id: string; text: string }[];
  /** Entries in reveal order (fewest votes first); `winners` are the top authors. */
  result?: { entries: FinalReveal[]; winners: string[] };
};

export type QuipPublic = {
  phase: Phase; round: number; turn: string;
  /** Phase start and end (server ms). Every phase has an end. */
  at: number; deadline: number;
  scores: Record<string, number>;
  /** Scores before this round (scores phase only), for the animated board. */
  prev?: Record<string, number>;
  /** Writing phases: players with every answer in. Final vote: players who voted. Otherwise empty. */
  done: string[];
  match?: Match;
  final?: Final;
};
export type MyPrompt = { slot: number; prompt: string; answer?: string; safety?: true };
export type QuipPrivate = {
  turn: string;
  /** Writing phases: your prompts in slot order. */
  prompts: MyPrompt[];
  /** Matchup phases: you wrote one of these answers, or you get a vote. */
  role?: 'author' | 'voter';
  /** Matchup phases: the side you wrote (author) or voted for (voter). */
  side?: number;
  /** Final: your entry id, and your confirmed votes once cast. */
  mine?: string;
  picks?: string[];
};
export type QuipAction =
  | { turn: string; k: 'answer'; slot: number; text: string }
  | { turn: string; k: 'safety'; slot: number }
  | { turn: string; k: 'vote'; side: number }
  | { turn: string; k: 'picks'; picks: string[] };

// ---------- reveal timing (ms from the phase start), shared so the TV lands on the server's beats ----------
const readMs = (text: string) => 1300 + 28 * text.length;
/** Show phase: prompt at 0, answer A, answer B, then voting opens at the last value. */
export function showBeats(answers: readonly Answer[]): [number, number, number, number] {
  const a = 1800, b = a + readMs(answers[0]?.text ?? ''), end = b + readMs(answers[1]?.text ?? '');
  return [0, a, b, end];
}
/** Result phase: voters fly in, authors revealed, points + winner; a quipwipe or jinx holds a little longer. */
export const RESULT = { voters: 600, authors: 2100, points: 3600, end: 7000, bonus: 2200 } as const;
/** Final result: one entry every `step` ms after `first`, then the winner beat, then a hold. */
export function finalBeats(count: number) {
  const first = 1600, step = count > 6 ? 900 : 1200, winner = first + count * step + 700;
  return { reveals: Array.from({ length: count }, (_, i) => first + i * step), winner, end: winner + 6500 };
}
