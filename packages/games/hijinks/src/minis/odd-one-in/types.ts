/* Odd One In views, actions, categories and reveal timing. Shared by server, client, bot and tests: no content banks here. */

export type Category = 'hands' | 'number' | 'point' | 'face';
export const CATEGORIES: readonly Category[] = ['hands', 'number', 'point', 'face'];
/** TV/phone copy per category: the public stem (never the task), how to answer, and the act-it-out cue for the 3-2-1. */
export const CATEGORY: Record<Category, { name: string; stem: string; how: string; act: string; irl: string }> = {
  hands: { name: 'Hands Up', stem: 'Raise your hand if you’ve ever…', how: 'Hand up or hand down?', act: 'Hands up!', irl: 'Raise it for real' },
  number: { name: 'Number Crunch', stem: 'How many…? Or rate it from 0 to 10…', how: 'Pick a number from 0 to 10', act: 'Show your fingers!', irl: 'Hold up your fingers' },
  point: { name: 'Point Blank', stem: 'Point at the player most likely to…', how: 'Pick a player. Yourself counts!', act: 'Point!', irl: 'Point for real' },
  face: { name: 'Face Value', stem: 'Make the face you’d make if…', how: 'Pick a face, then pull it', act: 'Make the face!', irl: 'Pull the face for real' },
};
/** The eight Face Value expressions (drawn in art.tsx). */
export const FACES = [
  { id: 'gasp', label: 'Gasp!' }, { id: 'smug', label: 'Smug' }, { id: 'yuck', label: 'Yuck' }, { id: 'eek', label: 'Eek!' },
  { id: 'joy', label: 'Joy' }, { id: 'huh', label: 'Huh?' }, { id: 'fume', label: 'Fuming' }, { id: 'swoon', label: 'Swoon' },
] as const;
export type FaceId = typeof FACES[number]['id'];
export const NUMBERS = Array.from({ length: 11 }, (_, i) => String(i));
/** What the faker's dossier says instead of the task. */
export const FAKER_BRIEF = 'You’re the faker! Blend in.';
export const TASKS_PER_CASE = 3;
/** Base seconds before the pack's pace setting. */
export const TASK_S = 20, DISCUSS_S = 30, VOTE_S = 20;
/** Readable minimum before an all-in phase advances. */
export const MIN_READ_MS = 1500;
export const POINTS = { correct: 500, team: 100, survive: 500, disguise: 1000 } as const;

export type Phase = 'case' | 'task' | 'reveal' | 'discuss' | 'vote' | 'verdict' | 'closed';
export type Outcome = 'caught' | 'framed' | 'hung';
/** One player's answer: hands 'up'|'down', number '0'…'10', point a player id, face a FaceId. `auto` = no answer, random pick. */
export type Answer = { player: string; value: string; auto?: true };
export type Verdict = {
  /** Voter → suspect. */
  votes: Record<string, string>;
  /** Strictly most votes, or null for a hung jury. */
  accused: string | null;
  outcome: Outcome;
  /** The faker gets away after the last task of the case (revealed on the case-closed screen). */
  escaped?: true;
};
export type CaseFile = {
  faker: string; caught: boolean;
  /** Tasks the faker survived. */
  survived: number;
  /** Points gained this case per player. */
  gains: Record<string, number>;
  /** The faker's answer to each task, with the task. */
  trail: { prompt: string; value: string }[];
};

export type OddPublic = {
  phase: Phase; round: number; rounds: number;
  /** Task number in this case (1–3). */
  task: number; turn: string;
  /** Phase start and end (server ms). */
  at: number; deadline: number;
  category: Category;
  scores: Record<string, number>;
  /** Task: answered. Discuss: ready to vote. Vote: voted. Otherwise empty. */
  done: string[];
  /** Players proven innocent this case (framed). */
  cleared: string[];
  /** The real task: from the reveal on. */
  prompt?: string;
  /** Everyone's answers in roster order: from the reveal on. */
  answers?: Answer[];
  verdict?: Verdict;
  /** Caught on the verdict screen only. */
  faker?: string;
  /** Case closed: the faker, the trail and the gains. */
  closed?: CaseFile;
  /** Scores before this case (closed phase only). */
  prev?: Record<string, number>;
};
export type OddPrivate = {
  turn: string;
  /** Your own role this case. Faker phones render the same layout as task phones. */
  faker: boolean;
  /** Your dossier: the secret task, or FAKER_BRIEF (from the task phase until the reveal). */
  brief?: string;
  /** Your answer once accepted. */
  answer?: string;
  ready?: true;
  /** Your accusation once accepted. */
  vote?: string;
};
export type OddAction =
  | { turn: string; k: 'answer'; value: string }
  | { turn: string; k: 'ready' }
  | { turn: string; k: 'vote'; suspect: string };

// ---------- server-timed beats (ms from the phase start), shared so a reloaded TV lands on the same moment ----------
/** Case intro card. */
export const CASE_MS = 6500;
/** Reveal: 3, 2, 1, then every answer flips at once (act it out!), then the real task drops in. */
export const REVEAL = { counts: [0, 1000, 2000], flip: 3000, prompt: 4800, end: 8000 } as const;
/** Verdict: votes fly in, the accused is spotlit, then the stamp. */
export const VERDICT = { votes: 1200, accused: 3400, stamp: 5200, end: 9800 } as const;
/** Case closed: the faker's mugshot (after a drumroll when they escaped), then the scores. */
export const CLOSED = { faker: 1400, scores: 3600, end: 12000 } as const;

/** Display label for an answer value. */
export function answerLabel(category: Category, value: string, name: (id: string) => string = id => id): string {
  if (category === 'hands') return value === 'up' ? 'Hand up' : 'Hand down';
  if (category === 'face') return FACES.find(f => f.id === value)?.label ?? value;
  return category === 'point' ? name(value) : value;
}
