/* Sketch Bluff views, actions, title matching and reveal timing. Shared by server, client, bot and tests: no content banks here. */

export const MAX_TITLE = 40, MIN_OPTIONS = 4, MAX_LIKES = 2, SUGGESTIONS = 3;
/** Base seconds before the pack's pace setting. */
export const DRAW_S = 80, TITLE_S = 35, GUESS_S = 20;
/** Readable minimum before an all-submitted phase advances; the guess phase also waits a moment for late likes. */
export const MIN_READ_MS = 1500, LIKE_GRACE_MS = 1500, SCORES_MS = 9000;
/** Points (× the round multiplier, except likes). */
export const FIND_PTS = 1000, ART_PTS = 500, FOOL_PTS = 500, LIKE_PTS = 50;
/** Two rounds (the second doubled) for small rooms, one long gallery for big ones: keeps the night under ~15 minutes. */
export const roundsFor = (players: number) => players <= 5 ? 2 : 1;
export const letter = (i: number) => String.fromCharCode(65 + i);
/** Media key for a drawing: opaque, never a player id. */
export const artKey = (round: number, index: number) => `sb-${round}-${index}`;

/** Comparison form of a title: lower case, letters and digits only, no articles, no plural s. */
export function titleKey(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ')
    .filter(w => w && w !== 'a' && w !== 'an' && w !== 'the').map(w => w.length > 3 ? w.replace(/(es|s)$/, '') : w).join(' ');
}

export type Phase = 'draw' | 'title' | 'guess' | 'reveal' | 'scores';
export type Option = { id: string; text: string };
/**
 * One reveal beat starting at server time `at`. Forgeries and house decoys show only if somebody fell for them; the real
 * title always comes last, then the tally of what the piece earned.
 */
export type Beat =
  | { kind: 'fake'; at: number; id: string; text: string; author: string; fooled: string[]; points: number }
  | { kind: 'house'; at: number; id: string; text: string; fooled: string[] }
  | { kind: 'real'; at: number; id: string; text: string; found: string[]; artist: string; points: number }
  | { kind: 'tally'; at: number; gains: Record<string, number>; likes: Record<string, number> };
/** The piece on the wall: whose art and its drawing's media key. */
export type Piece = { index: number; count: number; artist: string; art: string };

export type SketchPublic = {
  phase: Phase; round: number; rounds: number; turn: string;
  /** Phase start and end (server ms). Every phase has an end. */
  at: number; deadline: number;
  scores: Record<string, number>;
  /** Scores before this round (scores phase only), for the animated board. */
  prev?: Record<string, number>;
  /** Draw: artists whose drawing is in. Title: forgers with a title in. Guess: players who guessed. */
  done: string[];
  /** Gallery phases: the piece on the wall. */
  piece?: Piece;
  /** Guess and reveal: every title in display order (forgeries, the real title, house decoys). Ids are opaque. */
  options?: Option[];
  /** Reveal: beats that have started so far. */
  beats?: Beat[];
  /** Scores: the round's exhibition with real titles. */
  pieces?: { art: string; artist: string; title: string }[];
};
export type SketchPrivate = {
  turn: string;
  /** Draw: your secret prompt. Gallery: the real title, only when the piece on the wall is yours. */
  prompt?: string;
  /** Draw: your drawing is in. */
  drawn?: true;
  /** Gallery: the piece on the wall is yours. */
  artist?: true;
  /** Title: your accepted fake title, and the house titles offered by "Title for me". */
  title?: string; suggestions?: string[];
  /** Guess/reveal: the option you wrote (the real title for the artist), your guess and your likes. */
  mine?: string; pick?: string; likes?: string[];
};
export type SketchAction =
  | { turn: string; k: 'draw'; drawing: unknown }
  | { turn: string; k: 'title'; text: string }
  | { turn: string; k: 'guess'; option: string }
  | { turn: string; k: 'like'; option: string; on: boolean };

// ---------- reveal timing (ms from the reveal start), shared so the TV lands on the server's beats ----------
/** Sub-beats inside a forgery beat: title, who fell for it, verdict. Inside the real beat: title, finders, artist. */
export const FAKE_SUB = [0, 800, 1600] as const, REAL_SUB = [0, 1300, 2700] as const;
export function revealPlan(fakes: number) {
  // The verdict (stamp, author, points) stays up for at least 1.6 s even when nine forgeries are unmasked.
  const lead = 1400, step = fakes > 5 ? 3200 : 3600, real = lead + fakes * step, tally = real + 5200;
  return { fakes: Array.from({ length: fakes }, (_, i) => lead + i * step), real, tally, end: tally + 4800 };
}
