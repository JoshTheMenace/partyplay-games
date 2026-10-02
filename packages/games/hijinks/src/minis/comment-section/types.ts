/* Comment Section views, actions and reveal timing. Shared by server, client, bot and tests: no content banks here. */

export const MAX_ANSWER = 70, MAX_TWIST = 50;
/** Base seconds before the pack's pace setting. */
export const ANSWER_S = 45, TWIST_S = 60, VOTE_S = 25, FINAL_VOTE_S = 35;
/** Readable minimum before an all-submitted phase advances; fixed card lengths. */
export const MIN_READ_MS = 1500, ROUND_MS = 5200, SCORES_MS = 7500;
/** Twister: 100 × votes × round. Original author: 50 × votes from other players × round ("you've been ruined"). */
export const TWIST_PTS = 100, AUTHOR_PTS = 50;
export const ROUNDS = [
  { name: 'Round 1', mult: 1, votes: 1, blurb: 'Answer honestly. Then ruin a friend.' },
  { name: 'Round 2', mult: 2, votes: 1, blurb: 'Double points. New apps, new victims.' },
  { name: 'The Final Feed', mult: 3, votes: 2, blurb: 'Triple points. Every profile gets a status update. Two votes each.' },
] as const;
export const letter = (i: number) => String.fromCharCode(65 + i);

/** Post formats. Rounds 1–2 deal ten fake apps; the Final Feed is all profile status updates. */
export const KINDS = ['review', 'photo', 'news', 'search', 'job', 'dating', 'forum', 'recipe', 'video', 'chat'] as const;
export type Kind = typeof KINDS[number] | 'status';
/** One dealt format variant: what the twister is asked to write, the label it gets on the post and a decoration line. */
export type Format = { kind: Kind; ask: string; label: string; meta: string };

export type Phase = 'round' | 'answer' | 'twist' | 'feed' | 'vote' | 'results' | 'scores';
export type Reply = { who: string; text: string };
/** A twisted post. `author` wrote the answer to `question` (both public from the feed on); the twister stays secret until the results. */
export type Post = { id: string; author: string; question: string; kind: Kind; label: string; meta: string; twist: string; answer: string; likes: number; replies: Reply[] };
/** One post's verdict. `house`: the author never answered (no consolation points); `auto`: a house twist (half points). */
export type Verdict = { id: string; twister: string; votes: number; voters: string[]; points: number; authorPoints: number; auto?: true; house?: true };

export type CommentPublic = {
  phase: Phase; round: number; turn: string;
  /** Phase start and end (server ms). */
  at: number; deadline: number;
  scores: Record<string, number>;
  /** Scores before this round (scores phase), for the animated board. */
  prev?: Record<string, number>;
  /** Answer/twist: players who posted. Vote: players who voted. Otherwise empty. */
  done: string[];
  /** Feed: how many posts have started (also drives QA screenshots). */
  stage?: number;
  /** Feed: posts that have started, with their server start times. Vote/results: every post in grid order. */
  posts?: Post[]; beats?: number[];
  /** Results: verdicts in reveal order (fewest votes first) and the reported (top) post ids. */
  result?: { verdicts: Verdict[]; reported: string[] };
};
export type CommentPrivate = {
  turn: string;
  /** Answer phase: your question, and your answer once posted (`house` if the house answered for you). */
  question?: string; answer?: string; house?: true;
  /** Twist phase: the answer you are twisting and its format; your twist once posted (`auto` for a house twist). */
  target?: { author: string; answer: string; format: Format };
  twist?: string; auto?: true;
  /** Feed onwards: the post you twisted and the post made from your answer; your confirmed votes. */
  mine?: string; about?: string; votes?: string[];
};
export type CommentAction =
  | { turn: string; k: 'answer'; text: string }
  | { turn: string; k: 'twist'; text: string }
  | { turn: string; k: 'auto' }
  | { turn: string; k: 'vote'; posts: string[] };

// ---------- timing (ms), shared so the TV and phones land on the server's beats ----------
/** Inside one feed post: the context lands at 0, the answer drops in, likes climb, then two replies. */
export const POST = { answer: 1300, likes: 2100, reply1: 2900, reply2: 3900 } as const;
export const FEED_LEAD = 1600;
export const postMs = (p: { twist: string; answer: string }) => Math.min(9000, 4800 + 30 * (p.twist.length + p.answer.length));
/** Results: one verdict every `step` ms after `first`, then the REPORTED beat, then a hold. */
export function revealBeats(count: number) {
  const first = 1500, step = count > 6 ? 950 : 1300, reported = first + count * step + 600;
  return { reveals: Array.from({ length: count }, (_, i) => first + i * step), reported, end: reported + 6500 };
}
/** A social-media handle from a display name: "Gertrude Q. Hooty" → "@gertrudeqhooty". */
export const handle = (name: string) => `@${name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9_]+/g, '').slice(0, 18) || 'user'}`;
