/* Quiz Panic rules: nine trivia questions with Panic Room challenges for the wrong, ghosts, then the Escape the Hotel race. Server only. */
import type { MiniApi, MiniResult, MiniServer, PackPlayer } from '../../core/contract';
import { variant } from '../../core/narration';
import { dealFresh, freshDeck } from '../../core/server/deck';
import { integer, record } from '../../core/server/validate';
import { WORDS, categoryPool, triviaPool, type Category } from './content.server';
import {
  ANSWER, CALL_S, DRINK_S, ESCAPE_BONUS, ESCAPE_MS, EXIT, FINAL, FINAL_INTRO_MS, FINAL_S, FINAL_TURNS, HIDE_S, LONE_PRIZE, MATH_S, MAX_WORD, MEMORIZE_MS,
  MIN_READ_MS, OPTIONS, PANIC_INTRO_MS, POISON_S, PRIZE, QUESTIONS, QUESTION_S, RECALL_S, ROOMS, SCRAMBLE_S, SCRAMBLE_TRIES, SEQUENCE, SUMS, SYMBOLS,
  FLIP_MS, panicBeats, type AnswerReveal, type FinalResult, type Kind, type PanicPublic, type PanicReveal, type Phase, type QuizPrivate, type QuizPublic,
  type Side, type Stage, type Sum,
} from './types';

type Q = { category: string; text: string; options: string[]; correct: number };
type Panic = {
  kind: Kind; stage: Stage; doomed: string[];
  poisoners: string[]; cups: number; poisons: Record<string, number>; drinks: Record<string, number>; poisoned: number[];
  sums: Record<string, Sum[]>; math: Record<string, number[]>;
  sequence: number[]; memory: Record<string, number[]>;
  rooms: Record<string, number>; searched: number[];
  words: Record<string, { word: string; letters: string[] }>; solved: string[]; misses: Record<string, number>; miss: Record<string, string>;
  flips: Side[]; calls: Record<string, Side[]>; safe: string[]; out: string[];
  dead: string[];
};
type Final = {
  turn: number; category: string; items: string[]; fits: boolean[];
  pos: Record<string, number>; ghoul: number; bonus: Record<string, number>;
  picks: Record<string, number[]>; result: FinalResult | null;
};
type Stat = 'right' | 'survived' | 'swaps' | 'deaths';
export type QuizState = {
  ids: string[]; names: Record<string, string>; online: Record<string, boolean>;
  phase: Phase; turn: string; seq: number; at: number; deadline: number; stage: number; hurried: boolean;
  questions: Q[]; q: number; picks: Record<string, number>; answer: AnswerReveal | null;
  alive: Record<string, boolean>; money: Record<string, number>;
  bag: Kind[]; panic: Panic | null; cats: Category[]; final: Final | null;
  stats: Record<Stat, Record<string, number>>; firstDead: string | null;
  winners: string[]; how: 'escaped' | 'furthest' | 'nobody-alive' | null; done: boolean;
};

const KINDS: readonly Kind[] = ['poison', 'math', 'memory', 'hide', 'scramble', 'coin'];
const own = <T>(rec: Record<string, T>, key: string): T | undefined => Object.hasOwn(rec, key) ? rec[key] : undefined;
const has = (rec: Record<string, unknown>, key: string) => Object.hasOwn(rec, key);
const int = (api: MiniApi, lo: number, hi: number) => lo + Math.floor(api.random() * (hi - lo + 1));
const living = (s: QuizState) => s.ids.filter(id => s.alive[id]);
const solve = ({ a, op, b }: Sum) => op === '+' ? a + b : op === '−' ? a - b : a * b;
const top = (ids: string[], value: (id: string) => number) => { const best = Math.max(...ids.map(value)); return ids.filter(id => value(id) === best); };

function go(s: QuizState, api: MiniApi, phase: Phase, span: number) {
  Object.assign(s, { phase, at: api.now, deadline: api.now + span, turn: `t${++s.seq}`, stage: 0, hurried: false });
}
/** Keeps the phase open long enough for a narrator line that just started. */
function hold(s: QuizState, api: MiniApi, spoken: number) { if (spoken) s.deadline = Math.max(s.deadline, api.now + spoken + 800); }

// ---------- main game ----------

/** Nine questions from nine different categories (unasked tonight first), options shuffled. */
function deal(api: MiniApi): Q[] {
  const seen = new Set<string>(), out: Q[] = [];
  for (const t of freshDeck(api, triviaPool(api.settings.family), t => t.text)) {
    if (seen.has(t.category)) continue;
    seen.add(t.category); api.used.add(t.text);
    const options = api.shuffle([t.answer, ...t.wrong]);
    out.push({ category: t.category, text: t.text, options, correct: options.indexOf(t.answer) });
    if (out.length === QUESTIONS) break;
  }
  return out;
}

function startQuestion(s: QuizState, api: MiniApi) {
  s.q++; s.picks = {}; s.answer = null; s.panic = null;
  api.music('quiz-panic'); api.sfx('swoosh-in');
  go(s, api, 'question', api.seconds(QUESTION_S));
}

/** Correct players earn PRIZE (LONE_PRIZE when nobody else got it); wrong or silent living players are doomed. Offline players with no answer are skipped. */
function endQuestion(s: QuizState, api: MiniApi) {
  const q = s.questions[s.q - 1]!, right = s.ids.filter(id => own(s.picks, id) === q.correct), lone = right.length === 1 && s.ids.length > 1;
  const earned = Object.fromEntries(right.map(id => [id, lone ? LONE_PRIZE : PRIZE]));
  for (const id of right) { s.money[id]! += earned[id]!; s.stats.right[id]!++; }
  const doomed = living(s).filter(id => !right.includes(id) && (has(s.picks, id) || s.online[id]));
  s.answer = { correct: q.correct, picks: { ...s.picks }, earned, doomed };
  api.music('reveal'); api.sfx('drumroll');
  go(s, api, 'answer', doomed.length ? ANSWER.doomEnd : ANSWER.end);
}

function next(s: QuizState, api: MiniApi) { if (s.q < QUESTIONS) startQuestion(s, api); else startFinal(s, api); }

// ---------- Panic Room ----------

function sums(api: MiniApi): Sum[] {
  const a = int(api, 6, 19), b = int(api, 4, 15), c = int(api, 12, 30), d = int(api, 3, c - 4), e = int(api, 3, 9), f = int(api, 3, 9);
  return api.shuffle([{ a, op: '+', b }, { a: c, op: '−', b: d }, { a: e, op: '×', b: f }] as Sum[]).slice(0, SUMS);
}
function scramble(api: MiniApi, word: string): string[] {
  for (;;) { const letters = api.shuffle([...word]); if (letters.join('') !== word) return letters; }
}

function startPanic(s: QuizState, api: MiniApi, doomed: string[]) {
  if (!s.bag.length) s.bag = api.shuffle(KINDS);
  const kind = s.bag.shift()!, words = dealFresh(api, WORDS, doomed.length, w => `word:${w}`);
  const p: Panic = {
    kind, stage: 'solve', doomed, poisoners: [], cups: 0, poisons: {}, drinks: {}, poisoned: [], sums: {}, math: {}, sequence: [], memory: {},
    rooms: {}, searched: [], words: {}, solved: [], misses: {}, miss: {}, flips: [], calls: {}, safe: [], out: [], dead: [],
  };
  if (kind === 'poison') {
    p.poisoners = living(s).filter(id => !doomed.includes(id) && s.online[id]); p.cups = doomed.length + 1; p.stage = p.poisoners.length ? 'poison' : 'drink';
    if (!p.poisoners.length) p.poisoned = [int(api, 0, p.cups - 1)];
  }
  if (kind === 'math') for (const id of doomed) p.sums[id] = sums(api);
  // Memory: never the same symbol twice in a row.
  if (kind === 'memory') { p.stage = 'memorize'; for (let i = 0; i < SEQUENCE; i++) p.sequence.push(i ? (p.sequence[i - 1]! + int(api, 1, SYMBOLS - 1)) % SYMBOLS : int(api, 0, SYMBOLS - 1)); }
  if (kind === 'hide') p.stage = 'hide';
  if (kind === 'scramble') doomed.forEach((id, i) => { const word = words[i % words.length]!; p.words[id] = { word, letters: scramble(api, word) }; p.misses[id] = 0; });
  if (kind === 'coin') { p.stage = 'call'; for (const id of doomed) p.calls[id] = []; }
  s.panic = p;
  api.music('spooky'); api.sfx('alarm'); api.sfx('thunder');
  go(s, api, 'panic-intro', PANIC_INTRO_MS);
}

function stageSpan(s: QuizState, api: MiniApi, stage: Stage) {
  const kind = s.panic!.kind;
  return stage === 'memorize' ? MEMORIZE_MS : stage === 'flip' ? FLIP_MS : api.seconds(
    stage === 'poison' ? POISON_S : stage === 'drink' ? DRINK_S : stage === 'recall' ? RECALL_S : stage === 'hide' ? HIDE_S : stage === 'call' ? CALL_S : kind === 'math' ? MATH_S : SCRAMBLE_S);
}
function begin(s: QuizState, api: MiniApi, stage: Stage) {
  s.panic!.stage = stage;
  go(s, api, 'panic', stageSpan(s, api, stage));
}

/** Coin players still in the game: not yet safe (two wins) or out (two losses). */
const flipping = (p: Panic) => p.doomed.filter(id => !p.safe.includes(id) && !p.out.includes(id));
/** Players this stage is waiting for (submitted players drop out; timed stages wait for nobody). */
function actors(s: QuizState): string[] {
  const p = s.panic!;
  switch (p.stage) {
    case 'poison': return p.poisoners.filter(id => !has(p.poisons, id));
    case 'drink': return p.doomed.filter(id => !has(p.drinks, id));
    case 'solve': return p.kind === 'math' ? p.doomed.filter(id => !has(p.math, id)) : p.doomed.filter(id => !p.solved.includes(id) && p.misses[id]! < SCRAMBLE_TRIES);
    case 'recall': return p.doomed.filter(id => !has(p.memory, id));
    case 'hide': return p.doomed.filter(id => !has(p.rooms, id));
    case 'call': return flipping(p).filter(id => p.calls[id]!.length === p.flips.length);
    default: return [];
  }
}
/** Who the TV shows as finished this stage. */
function finished(s: QuizState): string[] {
  const p = s.panic!, waiting = actors(s);
  const cast = p.stage === 'poison' ? p.poisoners : p.stage === 'call' ? flipping(p) : ['memorize', 'flip'].includes(p.stage) ? [] : p.doomed;
  return cast.filter(id => !waiting.includes(id));
}

function endStage(s: QuizState, api: MiniApi) {
  const p = s.panic!, random = <T>(items: readonly T[]) => items[int(api, 0, items.length - 1)]!, cups = [...Array(p.cups).keys()];
  switch (p.stage) {
    case 'poison': {
      // At least one poisoned cup and always at least one safe cup.
      p.poisoned = [...new Set(Object.values(p.poisons))].sort((a, b) => a - b);
      if (!p.poisoned.length) p.poisoned = [random(cups)];
      if (p.poisoned.length === p.cups) p.poisoned.splice(int(api, 0, p.cups - 1), 1);
      api.sfx('splat');
      return begin(s, api, 'drink');
    }
    case 'drink': for (const id of p.doomed) if (!has(p.drinks, id)) p.drinks[id] = random(cups); break;
    case 'memorize': api.sfx('whoosh'); return begin(s, api, 'recall');
    case 'hide': {
      for (const id of p.doomed) if (!has(p.rooms, id)) p.rooms[id] = int(api, 0, ROOMS - 1);
      p.searched = api.pick([...Array(ROOMS).keys()], int(api, 2, 3));
      break;
    }
    case 'call': {
      const flip: Side = api.random() < .5 ? 'H' : 'T';
      for (const id of flipping(p)) if (p.calls[id]!.length === p.flips.length) p.calls[id]!.push(api.random() < .5 ? 'H' : 'T');
      p.flips.push(flip);
      for (const id of flipping(p)) {
        const wins = p.calls[id]!.filter((c, i) => c === p.flips[i]).length, losses = p.flips.length - wins;
        if (wins >= 2) p.safe.push(id); else if (losses >= 2) p.out.push(id);
      }
      api.sfx('whoosh');
      return begin(s, api, 'flip');
    }
    case 'flip': if (flipping(p).length) return begin(s, api, 'call'); break;
  }
  panicReveal(s, api);
}

function panicReveal(s: QuizState, api: MiniApi) {
  const p = s.panic!;
  p.dead = p.doomed.filter(id => {
    switch (p.kind) {
      case 'poison': return p.poisoned.includes(p.drinks[id]!);
      case 'math': { const given = own(p.math, id); return !given || p.sums[id]!.some((sum, i) => solve(sum) !== given[i]); }
      case 'memory': { const seq = own(p.memory, id); return !seq || seq.some((x, i) => x !== p.sequence[i]); }
      case 'hide': return p.searched.includes(p.rooms[id]!);
      case 'scramble': return !p.solved.includes(id);
      case 'coin': return p.out.includes(id);
    }
  });
  for (const id of p.doomed) {
    if (p.dead.includes(id)) { s.alive[id] = false; s.stats.deaths[id]!++; s.firstDead ??= id; } else s.stats.survived[id]!++;
  }
  api.sfx('drumroll');
  go(s, api, 'panic-reveal', panicBeats(p.kind, revealCount(p)).end);
}
const revealCount = (p: Panic) => p.kind === 'poison' ? p.cups : p.kind === 'hide' ? p.searched.length : p.doomed.length;

// ---------- Escape the Hotel ----------

function startFinal(s: QuizState, api: MiniApi) {
  // Nobody left alive: the hotel needs a guest, so the richest ghost (or tied ghosts) get their bodies back.
  if (!living(s).length) for (const id of top(s.ids, id => s.money[id]!)) s.alive[id] = true;
  const alive = living(s), bonus = Object.fromEntries(alive.map(id => {
    const rank = 1 + alive.filter(o => s.money[o]! > s.money[id]!).length;
    return [id, rank === 1 ? 2 : rank === 2 ? 1 : 0];
  }));
  s.final = { turn: 0, category: '', items: [], fits: [], pos: Object.fromEntries(s.ids.map(id => [id, s.alive[id] ? 2 + bonus[id]! : 0])), ghoul: 0, bonus, picks: {}, result: null };
  s.panic = null; s.answer = null;
  api.music('quiz-panic'); api.sfx('gong'); api.sfx('thunder');
  go(s, api, 'final-intro', FINAL_INTRO_MS); hold(s, api, api.say('quiz-panic.escape'));
}

function finalTurn(s: QuizState, api: MiniApi) {
  const f = s.final!, cat = s.cats[f.turn]!, fit = api.random() < .25 ? 1 : api.random() < .6 ? 2 : 3;
  const items = api.shuffle([...api.pick(cat.yes, fit).map(text => ({ text, fit: true })), ...api.pick(cat.no, 3 - fit).map(text => ({ text, fit: false }))]);
  Object.assign(f, { turn: f.turn + 1, category: cat.name, items: items.map(i => i.text), fits: items.map(i => i.fit), picks: {}, result: null });
  api.music('quiz-panic'); api.sfx('swoosh-in');
  go(s, api, 'final-question', api.seconds(FINAL_S));
}

/** Moves (every correct pick = 1 space, any wrong pick = 0), ghost body swaps, escapes, then the ghoul catches stragglers. */
function scoreFinal(s: QuizState, api: MiniApi) {
  const f = s.final!, from = { ...f.pos }, ghostsBefore = s.ids.filter(id => !s.alive[id]), ghoulFrom = f.ghoul;
  const moves = Object.fromEntries(s.ids.map(id => { const p = own(f.picks, id) ?? []; return [id, p.some(i => !f.fits[i]) ? 0 : p.length]; }));
  for (const id of s.ids) f.pos[id] = Math.min(EXIT, f.pos[id]! + moves[id]!);
  const swaps: FinalResult['swaps'] = [], rank = (a: string, b: string) => f.pos[a]! - f.pos[b]! || s.money[a]! - s.money[b]!;
  for (const ghost of [...ghostsBefore].sort((a, b) => rank(b, a))) {
    const last = living(s).sort(rank)[0];
    if (last === undefined || f.pos[ghost]! <= f.pos[last]!) continue;
    s.alive[ghost] = true; s.alive[last] = false; s.stats.swaps[ghost]!++; s.stats.deaths[last]!++;
    swaps.push({ ghost, living: last });
  }
  const escaped = living(s).filter(id => f.pos[id]! >= EXIT), caught: string[] = [];
  if (escaped.length) { s.winners = top(escaped, id => s.money[id]!); s.how = 'escaped'; }
  else {
    f.ghoul = f.turn - 1;
    if (f.ghoul > 0) for (const id of living(s)) if (f.pos[id]! <= f.ghoul) { s.alive[id] = false; s.stats.deaths[id]!++; caught.push(id); }
  }
  f.result = { fits: [...f.fits], picks: Object.fromEntries(Object.entries(f.picks).map(([id, p]) => [id, [...p]])), moves, from, ghostsBefore, ghoulFrom, swaps, caught, escaped };
  api.music('reveal');
  go(s, api, 'final-answer', FINAL.end);
}

function finish(s: QuizState, api: MiniApi) {
  const f = s.final!, alive = living(s);
  if (!s.how) {
    const pool = alive.length ? alive : s.ids;
    s.winners = top(top(pool, id => f.pos[id]!), id => s.money[id]!);
    s.how = alive.length ? 'furthest' : 'nobody-alive';
  }
  api.music('quiz-panic'); api.sfx('fanfare'); api.sfx('win');
  go(s, api, 'final-end', ESCAPE_MS); hold(s, api, api.say(variant('host.winner', api.random)));
}

// ---------- actions ----------

function intList(raw: unknown, length: number | null, lo: number, hi: number, what: string): number[] {
  if (!Array.isArray(raw) || (length !== null && raw.length !== length) || raw.length > 12) throw new Error(`Finish your ${what} first.`);
  return raw.map(x => integer(x, lo, hi));
}

export const server: MiniServer<QuizState, QuizPublic, QuizPrivate> = {
  id: 'quiz-panic',
  create(players: readonly PackPlayer[], api) {
    const ids = players.map(p => p.id), zero = () => Object.fromEntries(ids.map(id => [id, 0]));
    const s: QuizState = {
      ids, names: Object.fromEntries(players.map(p => [p.id, p.name])), online: Object.fromEntries(players.map(p => [p.id, p.connected])),
      phase: 'question', turn: '', seq: 0, at: api.now, deadline: api.now, stage: 0, hurried: false,
      questions: deal(api), q: 0, picks: {}, answer: null, alive: Object.fromEntries(ids.map(id => [id, true])), money: zero(),
      bag: api.shuffle(KINDS), panic: null, cats: dealFresh(api, categoryPool(api.settings.family), FINAL_TURNS, c => `final:${c.name}`), final: null,
      stats: { right: zero(), survived: zero(), swaps: zero(), deaths: zero() }, firstDead: null, winners: [], how: null, done: false,
    };
    startQuestion(s, api);
    return s;
  },

  action(s, id, raw, api) {
    if (!s.ids.includes(id)) throw new Error('You are watching this one.');
    const a = record(raw);
    if (a.turn !== s.turn) throw new Error('Too late! The game has moved on.');
    const p = s.panic, inPanic = s.phase === 'panic' && p !== null;
    switch (a.k) {
      case 'answer': {
        record(a, ['turn', 'k', 'option']);
        if (s.phase !== 'question') throw new Error('No question open right now.');
        if (has(s.picks, id)) throw new Error('Your answer is already locked in.');
        s.picks[id] = integer(a.option, 0, OPTIONS - 1); api.sfx('lock');
        return;
      }
      case 'cup': {
        record(a, ['turn', 'k', 'cup']);
        if (!inPanic || !['poison', 'drink'].includes(p.stage)) throw new Error('No cups on the table right now.');
        const cup = integer(a.cup, 0, p.cups - 1);
        if (p.stage === 'poison') {
          if (!p.poisoners.includes(id)) throw new Error('Only the survivors spike the punch.');
          if (has(p.poisons, id)) throw new Error('You already poisoned a cup.');
          p.poisons[id] = cup; api.sfx('pop');
        } else {
          if (!p.doomed.includes(id)) throw new Error('Only the doomed drink tonight.');
          if (has(p.drinks, id)) throw new Error('You already picked a cup.');
          p.drinks[id] = cup; api.sfx('lock');
        }
        return;
      }
      case 'math': {
        record(a, ['turn', 'k', 'answers']);
        if (!inPanic || p.kind !== 'math' || !p.doomed.includes(id)) throw new Error('No sums for you right now.');
        if (has(p.math, id)) throw new Error('Your answers are already locked in.');
        p.math[id] = intList(a.answers, SUMS, -999, 9999, 'sums'); api.sfx('submit');
        return;
      }
      case 'memory': {
        record(a, ['turn', 'k', 'seq']);
        if (!inPanic || p.stage !== 'recall' || !p.doomed.includes(id)) throw new Error('No sequence to repeat right now.');
        if (has(p.memory, id)) throw new Error('Your sequence is already locked in.');
        p.memory[id] = intList(a.seq, SEQUENCE, 0, SYMBOLS - 1, 'sequence'); api.sfx('submit');
        return;
      }
      case 'room': {
        record(a, ['turn', 'k', 'room']);
        if (!inPanic || p.stage !== 'hide' || !p.doomed.includes(id)) throw new Error('No hiding right now.');
        if (has(p.rooms, id)) throw new Error('You are already hiding.');
        p.rooms[id] = integer(a.room, 0, ROOMS - 1); api.sfx('lock');
        return;
      }
      case 'word': {
        record(a, ['turn', 'k', 'text']);
        if (!inPanic || p.kind !== 'scramble' || !p.doomed.includes(id)) throw new Error('No word to unscramble right now.');
        if (p.solved.includes(id)) throw new Error('You already cracked it!');
        if (p.misses[id]! >= SCRAMBLE_TRIES) throw new Error('Out of tries. Fingers crossed…');
        if (typeof a.text !== 'string' || a.text.length > MAX_WORD * 2) throw new Error('Spell a word first.');
        const guess = a.text.toUpperCase().replace(/[^A-Z]/g, '');
        if (!guess) throw new Error('Spell a word first.');
        if (guess === p.words[id]!.word) { p.solved.push(id); api.sfx('correct'); }
        else { p.misses[id]!++; p.miss[id] = guess.slice(0, MAX_WORD); api.sfx('wrong'); }
        return;
      }
      case 'call': {
        record(a, ['turn', 'k', 'side']);
        if (!inPanic || p.stage !== 'call' || !flipping(p).includes(id)) throw new Error('No coin to call right now.');
        if (a.side !== 'H' && a.side !== 'T') throw new Error('Heads or tails?');
        if (p.calls[id]!.length > p.flips.length) throw new Error('Your call is already in.');
        p.calls[id]!.push(a.side); api.sfx('coin');
        return;
      }
      case 'items': {
        record(a, ['turn', 'k', 'picks']);
        if (s.phase !== 'final-question') throw new Error('No category open right now.');
        if (has(s.final!.picks, id)) throw new Error('Your picks are already locked in.');
        const picks = intList(a.picks, null, 0, 2, 'picks');
        if (new Set(picks).size !== picks.length || picks.length > 3) throw new Error('Pick each item once.');
        s.final!.picks[id] = picks.sort((x, y) => x - y); api.sfx('lock');
        return;
      }
      default: throw new Error('Unknown move.');
    }
  },

  tick(s, api) {
    // Early advances need someone online: if the whole room drops, phases wait for their deadlines instead of racing ahead.
    const now = api.now, t = now - s.at, online = (ids: string[]) => ids.filter(id => s.online[id]), early = t >= MIN_READ_MS && online(s.ids).length > 0;
    const hurry = () => { if (!s.hurried && s.deadline - now <= 5000 && s.deadline - s.at > 9000) { s.hurried = true; api.sfx('tick-fast'); } };
    switch (s.phase) {
      case 'question': {
        if (early && online(s.ids).every(id => has(s.picks, id))) { api.sfx('bell'); return endQuestion(s, api); }
        if (now >= s.deadline) { api.sfx('timeup'); return endQuestion(s, api); }
        return hurry();
      }
      case 'answer': {
        const a = s.answer!, beats = [ANSWER.picks, ANSWER.correct, ANSWER.money, ANSWER.doom];
        if (s.stage < 4 && t >= beats[s.stage]!) {
          s.stage++;
          if (s.stage === 1) api.sfx('whoosh');
          if (s.stage === 2) api.sfx(Object.keys(a.earned).length ? 'correct' : 'wrong');
          if (s.stage === 3 && Object.keys(a.earned).length) { api.sfx('coin'); api.sfx(Object.values(a.earned).includes(LONE_PRIZE) ? 'cheer' : 'score-up'); }
          if (s.stage === 4 && a.doomed.length) { api.sfx('spooky'); api.sfx(a.doomed.length === living(s).length ? 'gasp' : 'heartbeat'); hold(s, api, api.say('quiz-panic.panic')); }
        }
        if (now >= s.deadline) return a.doomed.length ? startPanic(s, api, a.doomed) : next(s, api);
        return;
      }
      case 'panic-intro':
        if (now >= s.deadline) begin(s, api, s.panic!.stage);
        return;
      case 'panic': {
        const stage = s.panic!.stage, timed = stage === 'memorize' || stage === 'flip';
        if ((early && !timed && !online(actors(s)).length) || now >= s.deadline) return endStage(s, api);
        return hurry();
      }
      case 'panic-reveal': {
        const p = s.panic!, beats = panicBeats(p.kind, revealCount(p));
        if (s.stage < beats.steps.length && t >= beats.steps[s.stage]!) {
          const i = s.stage++;
          if (p.kind === 'poison') api.sfx(p.poisoned.includes(i) ? 'splat' : 'pop');
          else if (p.kind === 'hide') { api.sfx('crash'); api.sfx(p.doomed.some(id => p.rooms[id] === p.searched[i]) ? 'gasp' : 'boing'); }
          else api.sfx(p.dead.includes(p.doomed[i]!) ? 'wrong' : 'correct');
        } else if (s.stage === beats.steps.length && t >= beats.verdict) {
          s.stage++;
          if (p.dead.length) { api.sfx('sting'); hold(s, api, api.say('quiz-panic.ghost')); } else { api.sfx('cheer'); api.sfx('applause'); }
        }
        if (now >= s.deadline && s.stage > beats.steps.length) next(s, api);
        return;
      }
      case 'final-intro':
        if (now >= s.deadline) finalTurn(s, api);
        return;
      case 'final-question':
        if ((early && online(s.ids).every(id => has(s.final!.picks, id))) || now >= s.deadline) return scoreFinal(s, api);
        return hurry();
      case 'final-answer': {
        const r = s.final!.result!, beats = [...FINAL.items, FINAL.move, FINAL.swap, FINAL.ghoul];
        if (s.stage < beats.length && t >= beats[s.stage]!) {
          const i = s.stage++;
          if (i < 3) api.sfx(r.fits[i] ? 'ding' : 'buzzer');
          if (i === 3) api.sfx(Object.values(r.moves).some(Boolean) ? 'boing' : 'aww');
          if (i === 4) { if (r.swaps.length) { api.sfx('glitch'); api.sfx('gasp'); } if (r.escaped.length) { api.sfx('fanfare'); api.sfx('cheer'); } }
          if (i === 5 && !r.escaped.length) { api.sfx(r.caught.length ? 'thunder' : 'heartbeat'); if (r.caught.length) hold(s, api, api.say('quiz-panic.ghost')); }
        }
        if (now < s.deadline) return;
        return s.how || !living(s).length || s.final!.turn >= FINAL_TURNS ? finish(s, api) : finalTurn(s, api);
      }
      case 'final-end':
        if (now >= s.deadline) s.done = true;
    }
  },

  presence(s, id, connected) { if (has(s.online, id)) s.online[id] = connected; },

  publicView(s) {
    const pub: QuizPublic = {
      phase: s.phase, turn: s.turn, at: s.at, deadline: s.deadline, q: s.q, total: QUESTIONS, money: { ...s.money },
      ghosts: s.ids.filter(id => !s.alive[id]), done: [],
    };
    if (s.phase === 'question' || s.phase === 'answer') {
      const q = s.questions[s.q - 1]!;
      pub.question = { category: q.category, text: q.text, options: [...q.options] };
      if (s.phase === 'question') pub.done = s.ids.filter(id => has(s.picks, id));
      else pub.answer = { ...s.answer!, picks: { ...s.answer!.picks }, earned: { ...s.answer!.earned }, doomed: [...s.answer!.doomed] };
    }
    const p = s.panic;
    if (p && (s.phase === 'panic-intro' || s.phase === 'panic' || s.phase === 'panic-reveal')) {
      const panic: PanicPublic = { kind: p.kind, stage: p.stage, doomed: [...p.doomed] };
      if (p.kind === 'poison') Object.assign(panic, { poisoners: [...p.poisoners], cups: p.cups });
      if (s.phase === 'panic' && p.stage === 'memorize') panic.sequence = [...p.sequence];
      if (p.kind === 'coin') Object.assign(panic, { flips: [...p.flips], calls: Object.fromEntries(p.doomed.map(id => [id, p.calls[id]!.slice(0, p.flips.length)])), safe: [...p.safe], out: [...p.out] });
      if (s.phase === 'panic') pub.done = finished(s);
      if (s.phase === 'panic-reveal') {
        const reveal: PanicReveal = { dead: [...p.dead] }, pick = <T>(rec: Record<string, T>) => Object.fromEntries(p.doomed.filter(id => has(rec, id)).map(id => [id, rec[id]!]));
        if (p.kind === 'poison') Object.assign(reveal, { drinks: pick(p.drinks), poisoned: [...p.poisoned], poisoners: { ...p.poisons } });
        if (p.kind === 'math') reveal.sums = Object.fromEntries(p.doomed.map(id => [id, p.sums[id]!.map((sum, i) => ({ sum: { ...sum }, answer: solve(sum), given: own(p.math, id)?.[i] ?? null }))]));
        if (p.kind === 'memory') Object.assign(reveal, { sequence: [...p.sequence], attempts: Object.fromEntries(Object.entries(pick(p.memory)).map(([id, seq]) => [id, [...seq]])) });
        if (p.kind === 'hide') Object.assign(reveal, { rooms: pick(p.rooms), searched: [...p.searched] });
        if (p.kind === 'scramble') Object.assign(reveal, { words: Object.fromEntries(p.doomed.map(id => [id, p.words[id]!.word])), solved: [...p.solved] });
        panic.reveal = reveal;
      }
      pub.panic = panic;
    }
    const f = s.final;
    if (f && s.phase.startsWith('final')) {
      pub.final = { turn: f.turn, category: f.category, items: [...f.items], pos: { ...f.pos }, ghoul: f.ghoul };
      if (s.phase === 'final-intro') pub.final.bonus = { ...f.bonus };
      if (s.phase === 'final-question') pub.done = s.ids.filter(id => has(f.picks, id));
      if (s.phase === 'final-answer' && f.result) {
        const r = f.result;
        pub.final.result = { ...r, fits: [...r.fits], picks: Object.fromEntries(Object.entries(r.picks).map(([id, p]) => [id, [...p]])), moves: { ...r.moves }, from: { ...r.from },
          ghostsBefore: [...r.ghostsBefore], swaps: r.swaps.map(x => ({ ...x })), caught: [...r.caught], escaped: [...r.escaped] };
      }
      if (s.phase === 'final-end') Object.assign(pub.final, { winners: [...s.winners], how: s.how! });
    }
    return pub;
  },

  playerView(s, id) {
    const me: QuizPrivate = { turn: s.turn, alive: !!s.alive[id] };
    if ((s.phase === 'question' || s.phase === 'answer') && has(s.picks, id)) me.pick = s.picks[id]!;
    const p = s.panic;
    if (p && (s.phase === 'panic-intro' || s.phase === 'panic' || s.phase === 'panic-reveal')) {
      const doomed = p.doomed.includes(id);
      if (doomed) me.doomed = true;
      const st = p.stage;
      me.task = st === 'poison' ? (p.poisoners.includes(id) ? 'poison' : 'watch') : !doomed ? 'watch'
        : st === 'drink' ? 'drink' : st === 'hide' ? 'hide' : st === 'memorize' || st === 'recall' ? 'memory' : st === 'call' || st === 'flip' ? 'coin' : p.kind === 'math' ? 'math' : 'scramble';
      const cup = own(st === 'poison' ? p.poisons : p.drinks, id), room = own(p.rooms, id), math = own(p.math, id), memory = own(p.memory, id);
      if (p.kind === 'poison' && cup !== undefined) me.cup = cup;
      if (room !== undefined) me.room = room;
      if (doomed && p.kind === 'math') { me.sums = p.sums[id]!.map(x => ({ ...x })); if (math) me.answers = [...math]; }
      if (memory) me.memory = [...memory];
      if (doomed && p.kind === 'scramble') {
        me.letters = [...p.words[id]!.letters]; me.misses = p.misses[id]!;
        if (p.solved.includes(id)) me.solved = true;
        if (has(p.miss, id)) me.miss = p.miss[id]!;
      }
      if (doomed && p.kind === 'coin') me.calls = [...p.calls[id]!];
    }
    if (s.phase.startsWith('final') && s.final && has(s.final.picks, id)) me.items = [...s.final.picks[id]!];
    return me;
  },

  result(s): MiniResult | null {
    if (!s.done) return null;
    const others = s.ids.filter(id => !s.winners.includes(id)), richest = others.length ? Math.max(...others.map(id => s.money[id]!)) : 0;
    const scores = Object.fromEntries(s.ids.map(id => [id, s.money[id]! + (s.winners.includes(id) ? Math.max(ESCAPE_BONUS, richest - s.money[id]! + PRIZE) : 0)]));
    const awards: { title: string; playerId: string }[] = [], unique = (title: string, who: string[]) => { if (who.length === 1) awards.push({ title, playerId: who[0]! }); };
    const best = (title: string, rec: Record<string, number>, min = 1) => { const max = Math.max(...s.ids.map(id => rec[id]!)); if (max >= min) unique(title, s.ids.filter(id => rec[id] === max)); };
    unique('Survivor', s.ids.filter(id => !s.stats.deaths[id]));
    best('Big spender', s.money);
    best('Panic Room regular', s.stats.survived, 2);
    best('Body snatcher', s.stats.swaps);
    if (s.firstDead) awards.push({ title: 'First to fall', playerId: s.firstDead });
    const names = s.winners.map(id => s.names[id]!).join(' & ');
    const headline = s.how === 'escaped' ? `${names} escaped the hotel!` : s.how === 'furthest' ? `${names} got closest to the exit!` : 'The ghoul got everyone!';
    return { scores, winners: [...s.winners], headline, ...(awards.length ? { awards } : {}) };
  },
};
export default server;
