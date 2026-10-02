/* Bracket Brawl views, actions, scoring and reveal timing. Shared by server, client, bot and tests: no content banks here. */

export const MAX_ANSWER = 50, BRACKETS = 3;
export const KINDS = ['standard', 'blind', 'smackdown'] as const;
export type Kind = typeof KINDS[number];
export const KIND_NAMES: Record<Kind, string> = { standard: 'Standard', blind: 'Blind', smackdown: 'Smackdown' };
/** Base seconds before the pack's pace setting. Early bracket rounds vote faster; semifinals and the final get longer. */
export const WRITE_S = 60, PREDICT_S = 20, VOTE_S = 10, QUICK_VOTE_S = 8;
/** Readable minimum before an all-submitted phase advances. */
export const MIN_READ_MS = 1500;
/** Answers each player writes: two in small rooms, so the bracket isn't mostly house answers. */
export const answersFor = (players: number) => players <= 4 ? 2 : 1;
/** Bracket slots: 8, or 16 once the room's answers no longer fit (house answers fill the rest). */
export const sizeFor = (players: number) => players * answersFor(players) > 8 ? 16 : 8;
export const roundsOf = (size: number) => Math.round(Math.log2(size));
/** Round `r` (1-based) of a bracket with `rounds` rounds. */
export function roundName(r: number, rounds: number) {
  const left = rounds - r;
  return left === 0 ? 'Final' : left === 1 ? 'Semifinals' : left === 2 ? 'Quarterfinals' : 'Round of 16';
}
export const voteSeconds = (r: number, rounds: number) => r >= rounds - 1 ? VOTE_S : QUICK_VOTE_S;
/**
 * Points (rebalanced 2026-10-02 so earlier brackets still matter). A matchup win pays `win` to its author (Smackdown votes
 * count double: wins ×2); every round your predicted champion wins pays `oracle`; the bracket champion's author gets
 * `champ × bracket rounds` (300 for 8 slots, 400 for 16), the same in every bracket.
 */
export const PTS = { win: 100, oracle: 100, champ: 100 } as const;
export const weight = (kind: Kind) => kind === 'smackdown' ? 2 : 1;
/** Entries are numbered by bracket position: e0 is the top seed line of the left wing. */
export const seedOf = (id: string) => Number(id.slice(1)) + 1;

export type Phase = 'write' | 'twist' | 'predict' | 'stage' | 'vote' | 'result' | 'champ' | 'scores';
/** A bracket entry. Its author (`by`) or `house` appears once it is knocked out, and for every entry at the champion reveal. */
export type Slot = { id: string; text: string; by?: string; house?: true };
/** One matchup. Sides are entry ids once known. `winner` and the vote counts appear from the result phase on. */
export type Bout = { sides: [string | null, string | null]; winner?: 0 | 1; votes?: [number, number]; flip?: true };
export type Champ = { entry: string; by?: string; house?: true; bonus: number; oracles: string[]; oracle: number };

export type BrawlPublic = {
  phase: Phase; bracket: number; kind: Kind; turn: string;
  /** Phase start and end (server ms). Every phase has an end. */
  at: number; deadline: number;
  /** Banked scores: points won inside a bracket stay hidden until its champion is crowned. */
  scores: Record<string, number>;
  /** Scores before this bracket (champ and scores phases), for the animated board. */
  prev?: Record<string, number>;
  /** Write: players with every answer in. Predict: players who picked. Otherwise empty. */
  done: string[];
  /** The prompt. Blind brackets keep it secret until the twist; Smackdown shows part one here. */
  prompt?: string;
  /** Blind: the category everyone answers. */
  hint?: string;
  /** Smackdown: this bracket round's judging question (part two), from its stage banner on. */
  judge?: string;
  size: number; rounds: number;
  /** Current bracket round (1-based) from the stage banner on; 0 before the first match. */
  round: number;
  /** Entries in seed order (empty while writing). */
  entries: Slot[];
  /** Matchups per round (round 1 first). */
  bouts: Bout[][];
  /** Vote and result: the live matchup and how many votes are in (never who). */
  match?: { index: number; votes: number };
  champ?: Champ;
};
export type MyAnswer = { slot: number; text?: string; house?: true };
export type BrawlPrivate = {
  turn: string;
  /** Write: your answer slots in order (house = the House filled in for you). */
  answers: MyAnswer[];
  /** Your entry ids in this bracket. */
  mine: string[];
  /** Your predicted champion. */
  pick?: string;
  /** Vote and result: you wrote a side of this matchup, or you get a vote. */
  role?: 'author' | 'voter';
  vote?: 0 | 1;
  /** Points you have won in this bracket so far (kept from the room until the champion is crowned). */
  earned: number;
};
export type BrawlAction =
  | { turn: string; k: 'answer'; slot: number; text: string }
  | { turn: string; k: 'predict'; entry: string }
  | { turn: string; k: 'vote'; side: 0 | 1 };

// ---------- server-timed beats (ms from the phase start) so a reloaded TV lands on the same moment ----------
const readMs = (text: string) => 900 + 24 * text.length;
/** Vote phase: side A lands, side B lands, then the TV says "vote now" (votes count from the first beat). */
export function showBeats(a: string, b: string) {
  const first = 500, second = first + readMs(a);
  return { a: first, b: second, open: second + readMs(b) };
}
/** Result: tally bars, an optional coin flip, the knockout verdict, the bracket line lighting up, then a hold. */
export function resultBeats(flip: boolean, final: boolean) {
  const verdict = 1500 + (flip ? 2600 : 0), advance = verdict + 900;
  return { tally: 300, flip: 1500, verdict, advance, end: advance + (final ? 2600 : 1500) };
}
export const STAGE_MS = 2800, JUDGE_MS = 4600, TWIST_MS = 6500, SCORES_MS = 8000;
export const TWIST = { reveal: 1800 } as const;
export const CHAMP = { answer: 500, author: 2000, oracles: 3600, unmask: 4800, end: 10500 } as const;
