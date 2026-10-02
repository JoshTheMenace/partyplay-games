/* Airlock views, actions, test kinds, icons and reveal timing. Shared by server, client, bot and tests: no content banks here. */

export type Kind = 'answer' | 'rating' | 'pick' | 'draw' | 'choice';
export const KINDS: readonly Kind[] = ['answer', 'rating', 'pick', 'draw', 'choice'];
/** TV/phone copy per test kind. */
export const KIND: Record<Kind, { name: string; how: string }> = {
  answer: { name: 'Word Scan', how: 'Type a short answer' },
  rating: { name: 'Gut Gauge', how: 'Rate it from 1 to 10' },
  pick: { name: 'Crew Poll', how: 'Pick a crewmate' },
  draw: { name: 'Doodle Scan', how: 'Draw it, fast' },
  choice: { name: 'Icon Test', how: 'Pick one of four' },
};
/** Choice-test pictures (drawn in art.tsx). */
export const ICONS = {
  rocket: 'Rocket', planet: 'Planet', robot: 'Robot', cat: 'Cat', dog: 'Dog', fish: 'Fish', pizza: 'Pizza', cake: 'Cake', coffee: 'Coffee',
  icecream: 'Ice cream', donut: 'Doughnut', guitar: 'Guitar', book: 'Book', crown: 'Crown', umbrella: 'Umbrella', sun: 'Sun', moon: 'Moon',
  tree: 'Tree', cactus: 'Cactus', flower: 'Flower', car: 'Car', boat: 'Boat', tent: 'Tent', house: 'House', ghost: 'Ghost', gift: 'Gift',
  heart: 'Heart', ball: 'Beach ball', sock: 'Sock', snowman: 'Snowman', phone: 'Phone', music: 'Music',
} as const;
export type IconId = keyof typeof ICONS;

/** Seven tests to Earth; two button pushes per player; one alien per 4–6 players, two from 7. */
export const TESTS = 7, MAX_PUSHES = 2, MAX_ANSWER = 40, RATING_MAX = 10;
export const aliensFor = (players: number) => players >= 7 ? 2 : 1;
/** Base seconds before the pack's pace setting. */
export const TEST_S: Record<Kind, number> = { answer: 35, rating: 20, pick: 20, draw: 20, choice: 15 };
export const DISCUSS_S = 25, VOTE_S = 10;
/** Readable minimum before an all-in phase advances; a failed push hands back at least this much discussion. */
export const MIN_READ_MS = 1500, MIN_RESUME_MS = 10_000;
export const POINTS = { win: 1000, push: 500, survive: 500 } as const;

export type Phase = 'brief' | 'test' | 'results' | 'discuss' | 'vote' | 'verdict' | 'end';
export type Role = 'crew' | 'alien';
export type Vote = 'airlock' | 'abort';
/** Text (answer), 1–10 (rating), a player id (pick), a drawing media key (draw) or 0–3 (choice). */
export type Value = string | number;
/** One player's answer; no `value` = no answer. */
export type Answer = { player: string; value?: Value };
/** The test as the crew saw it, with everyone's answers in roster order. */
export type Board = { kind: Kind; prompt: string; icons?: IconId[]; answers: Answer[] };
/** A push names one suspect. It takes as many ABORT votes as there are aliens aboard to save them. */
export type Ballot = { by: string; suspect: string; saves: number };
export type Verdict = Ballot & {
  /** Every eligible voter in roster order; `auto` = didn't vote, counted as abort. */
  votes: { player: string; vote: Vote; auto?: true }[];
  eject: boolean;
  /** The spaced suspect's true role (eject only). */
  role?: Role;
};
export type Ending = {
  winner: 'crew' | 'aliens'; how: 'caught' | 'framed' | 'arrived';
  aliens: string[];
  /** Tests completed on the way. */
  survived: number;
  /** The pusher whose ejection ended the game. */
  by?: string;
  /** Crewmates who pushed an alien out, one entry per alien. */
  heroes: string[];
  gains: Record<string, number>;
};

export type AirPublic = {
  phase: Phase; turn: string;
  /** Phase start and end (server ms). Every phase has an end. */
  at: number; deadline: number;
  /** Current test (1–7; 0 during the briefing) and the kind of each test so far. */
  test: number; tests: number; kinds: Kind[];
  /** How many aliens this game has (never who) and the aliens already spaced (public once their role is revealed). */
  aliens: number; out: string[];
  /** Test: answered. Discuss: ready. Vote: voted. Otherwise empty. */
  done: string[];
  /** Button pushes left per player. */
  pushes: Record<string, number>;
  scores: Record<string, number>;
  /** Results to verdict: the crew's prompt and everyone's answers. */
  board?: Board;
  /** Vote: who pushed, who is in the airlock and how many ABORTs save them. */
  ballot?: Ballot;
  verdict?: Verdict;
  end?: Ending;
  /** Scores before the ending (end phase only). */
  prev?: Record<string, number>;
};
export type AirPrivate = {
  turn: string;
  role: Role;
  /** Your fellow aliens (aliens only; empty for crew). */
  allies: string[];
  /** Your version of the current test (aliens get the near-miss prompt) and, for an Icon Test, its four pictures. */
  prompt?: string; icons?: IconId[];
  /** Scanned this test (an alien's team hack or a crewmate's own scan): the crew's real prompt. Same field for both roles. */
  intercepted?: string;
  /** Scan button available (crew: your own one scan; aliens: the team's one hack). */
  scan: boolean;
  answer?: Value;
  ready?: true;
  vote?: Vote;
};
export type AirAction =
  | { turn: string; k: 'answer'; value: Value }
  | { turn: string; k: 'draw'; drawing: unknown }
  | { turn: string; k: 'scan' }
  | { turn: string; k: 'ready' }
  | { turn: string; k: 'push'; suspect: string }
  | { turn: string; k: 'vote'; vote: Vote };

/** Media key for a drawing: test number and seat. */
export const artKey = (test: number, seat: number) => `al-${test}-${seat}`;

// ---------- server-timed beats (ms from the phase start), shared so a reloaded TV lands on the same moment ----------
export const BRIEF_MS = 10_000;
/** Results: the crew's prompt drops in, answers flip one by one, then the summary. */
export function resultBeats(n: number) {
  const step = n > 6 ? 420 : 620, cards = Array.from({ length: n }, (_, i) => 1600 + i * step), summary = cards.at(-1)! + 900;
  return { cards, summary, end: summary + 2600 };
}
/** Verdict: votes flip one by one, the outcome, then (eject only) the spaced suspect's true role. */
export function verdictBeats(voters: number, eject: boolean) {
  const votes = Array.from({ length: voters }, (_, i) => 900 + i * 380), outcome = votes.at(-1)! + 1000;
  const roles = eject ? [outcome + 3000] : [];
  return { votes, outcome, roles, end: eject ? roles[0]! + 4200 : outcome + 3800 };
}
/** Ending: the aliens are unmasked one by one, the winners banner, then the scores. */
export function endBeats(aliens: number) {
  const unmask = Array.from({ length: aliens }, (_, i) => 1400 + i * 1300), banner = unmask.at(-1)! + 1400, scores = banner + 2600;
  return { unmask, banner, scores, end: scores + 7000 };
}
