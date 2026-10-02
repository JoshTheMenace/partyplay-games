/* Quiz Panic views, actions and reveal timing. Shared by server, client, bot and tests: no content banks or answer keys here. */

export const QUESTIONS = 9, OPTIONS = 4, FINAL_TURNS = 8, EXIT = 10, ROOMS = 6, SYMBOLS = 6, SEQUENCE = 5, SUMS = 3, MAX_WORD = 12;
/** Base seconds before the pack's pace setting. */
export const QUESTION_S = 15, POISON_S = 15, DRINK_S = 12, MATH_S = 20, RECALL_S = 15, HIDE_S = 12, SCRAMBLE_S = 20, CALL_S = 8, FINAL_S = 15;
/** Fixed beats (ms): the memory flash is exactly 5 s whatever the pace; the rest are reading and reveal time. */
export const MEMORIZE_MS = 5000, FLIP_MS = 3800, PANIC_INTRO_MS = 7000, FINAL_INTRO_MS = 11000, ESCAPE_MS = 8000, MIN_READ_MS = 1500;
/** Money: every correct answer pays PRIZE (living or ghost); a lone correct answer pays LONE_PRIZE. Escaping pays at least ESCAPE_BONUS. */
export const PRIZE = 1000, LONE_PRIZE = 1500, ESCAPE_BONUS = 5000, SCRAMBLE_TRIES = 3;
export const letter = (i: number) => String.fromCharCode(65 + i);

export type Phase = 'question' | 'answer' | 'panic-intro' | 'panic' | 'panic-reveal' | 'final-intro' | 'final-question' | 'final-answer' | 'final-end';
export type Kind = 'poison' | 'math' | 'memory' | 'hide' | 'scramble' | 'coin';
export type Side = 'H' | 'T';
/** Challenge sub-stages: poison → drink; memorize → recall; call ↔ flip (up to three flips); the rest have one stage. */
export type Stage = 'poison' | 'drink' | 'solve' | 'memorize' | 'recall' | 'hide' | 'call' | 'flip';
export type Sum = { a: number; op: '+' | '−' | '×'; b: number };

export const CHALLENGES: Record<Kind, { name: string; blurb: string; doomed: string }> = {
  poison: { name: 'Poison Punch', blurb: 'The survivors spike the punch. The doomed must pick a cup and drink.', doomed: 'Pick a cup. Hope it’s just punch.' },
  math: { name: 'Mad Math', blurb: 'Three quick sums on your phone. One slip and you’re toast.', doomed: 'Solve all three sums.' },
  memory: { name: 'Memory Lane', blurb: 'Five symbols flash on the TV. Tap them back in order.', doomed: 'Watch the TV, then repeat the sequence.' },
  hide: { name: 'Hide & Shriek', blurb: 'Hide in one of six rooms. The ghoul is going door to door.', doomed: 'Pick a room to hide in.' },
  scramble: { name: 'Scramble', blurb: 'Unscramble a spooky word before the candle burns out.', doomed: 'Unscramble your word.' },
  coin: { name: 'Coin of Fate', blurb: 'Heads or tails? Win two flips out of three to live.', doomed: 'Call the coin. Best two of three.' },
};
export const ROOM_NAMES = ['Ballroom', 'Kitchen', 'Library', 'Boiler Room', 'Attic', 'Room\u00a013'] as const;
export const SYMBOL_NAMES = ['Bat', 'Candle', 'Key', 'Skull', 'Moon', 'Spider'] as const;

/** One question as players see it: the answer key is never public before the reveal. */
export type Question = { category: string; text: string; options: string[] };
export type AnswerReveal = {
  correct: number;
  /** Option picked by each player who answered. */
  picks: Record<string, number>;
  /** Money earned this question. */
  earned: Record<string, number>;
  /** Living players heading for the Panic Room. */
  doomed: string[];
};
/** Panic Room reveal: who died, plus the per-challenge details the TV animates. */
export type PanicReveal = {
  dead: string[];
  /** poison: cup each doomed player drank, the poisoned cups and who poisoned each. */
  drinks?: Record<string, number>; poisoned?: number[]; poisoners?: Record<string, number>;
  /** math: each doomed player's sums and given answers (missing = null). */
  sums?: Record<string, { sum: Sum; answer: number; given: number | null }[]>;
  /** memory: the sequence and each doomed player's attempt. */
  sequence?: number[]; attempts?: Record<string, number[]>;
  /** hide: rooms chosen and the rooms the ghoul searched, in search order. */
  rooms?: Record<string, number>; searched?: number[];
  /** scramble: each doomed player's word and whether they solved it. */
  words?: Record<string, string>; solved?: string[];
};
export type PanicPublic = {
  kind: Kind; stage: Stage;
  doomed: string[];
  /** Poison: living players who spike the cups. */
  poisoners?: string[];
  cups?: number;
  /** Memory: the sequence, only during the memorize stage. */
  sequence?: number[];
  /** Coin: flips so far and each doomed player's calls for those flips. `alive`/`dead` fill as players are decided. */
  flips?: Side[]; calls?: Record<string, Side[]>; safe?: string[]; out?: string[];
  reveal?: PanicReveal;
};
export type FinalResult = {
  /** Which of the three items fit the category. */
  fits: boolean[];
  picks: Record<string, number[]>;
  /** Spaces moved this turn (0 after any wrong pick). */
  moves: Record<string, number>;
  /** Positions and ghosts before this turn, for the animation. */
  from: Record<string, number>; ghostsBefore: string[]; ghoulFrom: number;
  /** Body swaps (ghost revived, living player ghosted), living players the ghoul caught, and escapees. */
  swaps: { ghost: string; living: string }[]; caught: string[]; escaped: string[];
};
export type FinalPublic = {
  /** Final turn 1–8. */
  turn: number;
  category: string; items: string[];
  pos: Record<string, number>; ghoul: number;
  /** Start positions explained on the intro (money rank bonus 0–2 for the living). */
  bonus?: Record<string, number>;
  result?: FinalResult;
  /** Final end: the winners and how they won. */
  winners?: string[]; how?: 'escaped' | 'furthest' | 'nobody-alive';
};

export type QuizPublic = {
  phase: Phase; turn: string;
  /** Phase start and end (server ms). Every phase has an end. */
  at: number; deadline: number;
  /** Question 1–9 (main game). */
  q: number; total: number;
  money: Record<string, number>;
  /** Dead players, roster order. */
  ghosts: string[];
  /** Players who have submitted this stage. */
  done: string[];
  question?: Question;
  answer?: AnswerReveal;
  panic?: PanicPublic;
  final?: FinalPublic;
};
/** Your private view. Only ever your own data. */
export type QuizPrivate = {
  turn: string; alive: boolean;
  /** Question phases: your locked option. */
  pick?: number;
  /** Panic: what you do now ('watch' = nothing to submit this stage). */
  task?: 'poison' | 'drink' | 'math' | 'memory' | 'hide' | 'scramble' | 'coin' | 'watch';
  doomed?: true;
  /** Poison/drink: your cup. Hide: your room. */
  cup?: number; room?: number;
  /** Math: your three sums and your locked answers. */
  sums?: Sum[]; answers?: number[];
  /** Memory: your locked sequence. */
  memory?: number[];
  /** Scramble: your shuffled letters, solved flag, wrong tries and last wrong guess. */
  letters?: string[]; solved?: true; misses?: number; miss?: string;
  /** Coin: your calls so far (one per flip). */
  calls?: Side[];
  /** Final: your locked picks (item indexes). */
  items?: number[];
};
export type QuizAction =
  | { turn: string; k: 'answer'; option: number }
  | { turn: string; k: 'cup'; cup: number }
  | { turn: string; k: 'math'; answers: number[] }
  | { turn: string; k: 'memory'; seq: number[] }
  | { turn: string; k: 'room'; room: number }
  | { turn: string; k: 'word'; text: string }
  | { turn: string; k: 'call'; side: Side }
  | { turn: string; k: 'items'; picks: number[] };

// ---------- reveal timing (ms from the phase start), shared so a reloaded TV lands on the server's beats ----------
/** Answer reveal: who picked what, the right answer, the money, then the Panic Room call (only when someone is doomed). */
export const ANSWER = { picks: 900, correct: 2600, money: 3900, doom: 5300, end: 6900, doomEnd: 8600 } as const;
/** Panic reveal: one beat per cup / searched room / doomed player, then the verdict and a hold. */
export function panicBeats(kind: Kind, count: number) {
  const first = kind === 'coin' ? 600 : 1300, step = kind === 'hide' ? 1700 : kind === 'poison' ? 1000 : 800;
  const steps = Array.from({ length: kind === 'coin' ? 0 : count }, (_, i) => first + i * step), verdict = first + steps.length * step + 500;
  return { steps, verdict, end: verdict + 4800 };
}
/** Final turn reveal: items one by one, moves, body swaps, then the ghoul's step. */
export const FINAL = { items: [700, 1500, 2300], move: 3400, swap: 5000, ghoul: 6200, end: 8200 } as const;
