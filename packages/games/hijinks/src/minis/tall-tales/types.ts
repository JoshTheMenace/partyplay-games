/* Tall Tales views, actions, answer matching and reveal timing. Shared by server, client, bot and tests: no content banks here. */

export const MAX_LIE = 45, LIKES = 2, CATEGORIES = 4, MIN_OPTIONS = 4, QUESTIONS = 7;
/** Base seconds before the pack's pace setting. */
export const PICK_S = 10, WRITE_S = 45, CHOOSE_S = 20;
/** Readable minimum before an all-submitted phase advances; the choose phase also waits for late likes after the last pick. */
export const MIN_READ_MS = 1500, LIKE_GRACE_MS = 2500, PICKED_MS = 1800, ROUND_MS = 4600, SCORES_MS = 8000, FINAL_MS = 11000;
/** Points: finding the truth, each player fooled by your lie (a house-assisted lie earns 25% less), each like. */
export const TRUTH_PTS = 1000, FOOL_PTS = 500, HOUSE_RATE = .75, LIKE_PTS = 50;
export const BLANK = '___';
export const ROUNDS = [
  { name: 'Round 1', mult: 1, blurb: 'Three stories. Every sucker you fool pays 500.' },
  { name: 'Round 2', mult: 2, blurb: 'Double points! Three more stories.' },
  { name: 'The Final Tall Tale', mult: 3, blurb: 'One last story. Triple points!' },
] as const;
/** Questions 0–2 are round 1, 3–5 round 2, 6 is the final. */
export const roundOf = (q: number) => q < 3 ? 1 : q < 6 ? 2 : 3;
export const letter = (i: number) => String.fromCharCode(65 + i);

export type Phase = 'round' | 'pick' | 'write' | 'choose' | 'reveal' | 'scores' | 'final-scores';
export type Option = { id: string; text: string };
export type Author = { id: string; house?: true; points: number };
/** One reveal beat, starting at server time `at`. Lies and house decoys show only if somebody fell for them; the truth is always last. */
export type Beat =
  | { kind: 'lie'; at: number; id: string; text: string; authors: Author[]; fooled: string[] }
  | { kind: 'house'; at: number; id: string; text: string; fooled: string[] }
  | { kind: 'truth'; at: number; id: string; text: string; found: string[]; points: number }
  /** Every liked lie, most liked first (the TV features the top three). */
  | { kind: 'likes'; at: number; top: { id: string; text: string; likes: number; authors: string[] }[] };

export type TallPublic = {
  phase: Phase; turn: string;
  /** Question index 0–6 and its round (1–3). */
  q: number; round: number;
  /** Phase start and end (server ms). */
  at: number; deadline: number;
  scores: Record<string, number>;
  /** Scores before this round (scores phases), for the animated board. */
  prev?: Record<string, number>;
  /** Write: players with a lie filed. Choose: players who picked. Otherwise empty. */
  done: string[];
  /** Pick phase: who chooses, the four teasers and (once chosen) which one. */
  chooser?: string; cats?: string[]; picked?: number;
  /** The true story with its blank (write, choose, reveal). */
  fact?: { teaser: string; text: string };
  /** Choose and reveal: every distinct answer (lies, the truth, house decoys) in display order. Ids are opaque. */
  options?: Option[];
  /** Reveal: beats that have started so far. */
  beats?: Beat[];
};
export type TallPrivate = {
  turn: string;
  /** Pick phase: you choose the story. */
  chooser?: true;
  /** Write: your filed lie (house: picked from the paper's suggestions or filled in at time-up). */
  lie?: string; house?: true;
  /** Write: the two house lies offered after "Lie for me". */
  offers?: string[];
  /** Choose/reveal: option ids you wrote, your pick and your likes. */
  mine?: string[]; choice?: string; likes?: string[];
};
export type TallAction =
  | { turn: string; k: 'pick'; index: number }
  | { turn: string; k: 'lie'; text: string }
  | { turn: string; k: 'help' }
  | { turn: string; k: 'house'; index: number }
  | { turn: string; k: 'choose'; option: string }
  | { turn: string; k: 'like'; option: string; on: boolean };

// ---------- answer matching: case, accents, punctuation, articles, plurals, spacing and simple number words ----------
const ARTICLES = new Set(['a', 'an', 'the']);
const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const NUMBER: Record<string, number> = Object.fromEntries([...UNITS.map((w, i) => [w, i]), ...TENS.flatMap((w, i) => w ? [[w, i * 10]] : [])]);
/** Lower-case word tokens without articles; number words become digits ("twenty one" → "21"). */
export function tokens(text: string): string[] {
  const words = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/(\d),(?=\d{3})/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => w && !ARTICLES.has(w));
  const out: string[] = [];
  let tens = false;
  for (const w of words) {
    const n = Object.hasOwn(NUMBER, w) ? NUMBER[w]! : null;
    if (tens && n !== null && n > 0 && n < 10) { out[out.length - 1] = String(Number(out.at(-1)) + n); tens = false; continue; }
    tens = n !== null && n >= 20;
    out.push(n === null ? w : String(n));
  }
  return out;
}
const forms = (w: string) => new Set([w, w.replace(/ies$/, 'y'), w.replace(/es$/, ''), w.replace(/s$/, '')]);
const sameWord = (a: string, b: string) => { const fa = forms(a); return [...forms(b)].some(f => fa.has(f)); };
/** True when two answers say the same thing after normalising (word spacing is ignored too: "flat foot" = "flatfoot", but "1 5" ≠ "15"). */
export function same(a: string, b: string): boolean {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  return (ta.length === tb.length && ta.every((w, i) => sameWord(w, tb[i]!))) || (![...ta, ...tb].some(w => /\d/.test(w)) && sameWord(ta.join(''), tb.join('')));
}

// ---------- reveal timing: offsets inside a beat, shared so the TV and phones land on the server's beats ----------
/** Lie/house beats: fooled players fly in, then the stamp and author, then points. Shorter when many lies were picked. */
export const LIE_STEPS = { fooled: 700, stamp: 1900, points: 2700 } as const;
export const TRUTH_STEPS = { stamp: 1400, found: 2300 } as const;
export const LEAD_MS = 1800, LIKES_MS = 4600, TRUTH_MS = 5600;
export const lieMs = (count: number) => count > 5 ? 3600 : 4400;
/** When the beat's stamp lands (points are banked then). */
export const stampAt = (b: Beat) => b.at + (b.kind === 'truth' ? TRUTH_STEPS.stamp : b.kind === 'likes' ? 900 : LIE_STEPS.stamp);
