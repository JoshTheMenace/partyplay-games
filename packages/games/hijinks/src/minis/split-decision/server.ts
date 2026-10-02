/* Split Decision rules: everyone finishes their own dilemma to split the room 50/50 (×1), then writes both sides of a
   would-you-rather (×2), then The Big Split: one dilemma, everyone's take, judged yes/no in a carousel (×3). Server only. */
import type { MiniApi, MiniResult, MiniServer } from '../../core/contract';
import { variant } from '../../core/narration';
import { dealFresh } from '../../core/server/deck';
import { integer, record } from '../../core/server/validate';
import { HOUSE_CLAUSES, HOUSE_OPTIONS, dilemmaPool, finalPool, ratherPool } from './content.server';
import {
  BOLD, FINAL_WRITE_S, LAST_ROUND, MAX_FILL, MIN_READ_MS, RATHER_S, RESULT, SCORES_MS, VOTE_S, WRITE_S, finalBeats, judgeSeconds,
  minority, partsOf, sentence, showBeats, splitPoints, verdictOf,
  type FinalOutcome, type Kind, type Outcome, type Phase, type Side, type SplitPrivate, type SplitPublic, type Verdict,
} from './types';

type Fill = { text: string | null; house: boolean };
/** One author's scenario: a round card, or a take in The Big Split. `votes` maps voters to YES/A (0) or NO/B (1). */
type Scenario = { id: string; author: string; kind: Kind; parts: string[]; fills: Fill[]; votes: Record<string, Side>; outcome: Outcome | null };
type Stat = 'perfect' | 'bold' | 'unanimous';
export type SplitState = {
  ids: string[]; online: Record<string, boolean>;
  phase: Phase; round: number; turn: string; seq: number; at: number; deadline: number; stage: number; hurried: boolean;
  /** Templates dealt for this game (unused tonight first) and the rotating house banks. */
  dilemmas: string[]; rathers: string[]; finalParts: string[]; clauses: string[]; options: string[];
  /** This round's scenarios in presentation order (The Big Split: the takes, in grid order once writing ends). */
  cards: Scenario[]; index: number;
  reveal: FinalOutcome[]; best: string[]; bold: Record<string, number>;
  scores: Record<string, number>; prev: Record<string, number>; stats: Record<Stat, Record<string, number>>;
  done: boolean;
};

const own = <T>(rec: Record<string, T>, key: string): T | undefined => Object.hasOwn(rec, key) ? rec[key] : undefined;
const card = (s: SplitState) => s.cards[s.index]!;
const texts = (c: Scenario) => c.fills.map(f => f.text ?? '');
const writing = (s: SplitState) => s.phase === 'write' || s.phase === 'final-write';
const taskOf = (s: SplitState, id: string) => writing(s) ? s.cards.find(c => c.author === id) : undefined;
const written = (s: SplitState, id: string) => taskOf(s, id)?.fills.every(f => f.text !== null) ?? true;
/** Takes a judge still owes in The Big Split (every take but their own). */
const owed = (s: SplitState, id: string) => s.cards.filter(c => c.author !== id && !Object.hasOwn(c.votes, id));

/** Words that start a catch but never a name: a phone's automatic capital on them is lowered. */
const STARTERS = /^(?:You|Your|Yours|A|An|The|Every\w*|All|It|Its|There|They|Their|People|No|Nobody|Someone|Somebody|My|We|Our|Only|Half|One|Each|Some\w*|Any\w*|This|That|After|When|If|Never|Always)\b/;
/**
 * Trims, collapses whitespace and drops control/bidi characters and the trailing full stop; 1–60 characters. Every blank
 * sits mid-sentence, so a dilemma loses a repeated leading "but" and the phone keyboard's automatic capital is lowered
 * (rather options always start with a verb; a dilemma catch keeps capitals that may start a name).
 */
function clean(raw: unknown, kind: Kind): string {
  if (typeof raw !== 'string' || raw.length > MAX_FILL * 4) throw new Error(`Keep it under ${MAX_FILL} characters.`);
  let text = raw.replace(/[\p{Cc}‪-‮⁦-⁩]+/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  if (kind === 'dilemma') text = text.replace(/^but\s+/i, '');
  if (kind === 'rather' ? /^[A-Z][a-z]/.test(text) : STARTERS.test(text)) text = text[0]!.toLowerCase() + text.slice(1);
  if (!text) throw new Error('Fill in the blank first.');
  if (text.length > MAX_FILL) throw new Error(`Keep it under ${MAX_FILL} characters.`);
  return text;
}
/** The next house blank for a scenario: rotating, so consecutive fills never repeat, and never one of its other blanks. */
function house(s: SplitState, c: Scenario) {
  const bank = c.kind === 'rather' ? s.options : s.clauses;
  let text: string;
  do { text = bank.shift()!; bank.push(text); } while (c.fills.some(f => f.text?.toLowerCase() === text.toLowerCase()));
  return text;
}

function go(s: SplitState, api: MiniApi, phase: Phase, span: number) {
  Object.assign(s, { phase, at: api.now, deadline: api.now + span, turn: `t${++s.seq}`, stage: 0, hurried: false });
}
/** Keeps the phase open long enough for a narrator line that just started. */
function hold(s: SplitState, api: MiniApi, spoken: number) { if (spoken) s.deadline = Math.max(s.deadline, api.now + spoken + 800); }
/** Runs `play(stage)` once for every beat (ms from the phase start) that has been reached. */
function beats(s: SplitState, api: MiniApi, at: readonly number[], play: (stage: number) => void) {
  while (s.stage < at.length && api.now - s.at >= at[s.stage]!) play(s.stage++);
}
const scenario = (author: string, kind: Kind, parts: string[], i: number): Scenario =>
  ({ id: `c${i}`, author, kind, parts, fills: parts.slice(1).map(() => ({ text: null, house: false })), votes: {}, outcome: null });

/** Rounds 1–2: everyone gets their own template (presentation order shuffled). Round 3: one template for everyone. */
function startRound(s: SplitState, api: MiniApi) {
  s.round++; s.prev = { ...s.scores }; s.index = 0;
  if (s.round > 1) api.sfx('gong');
  if (s.round === LAST_ROUND) {
    s.cards = s.ids.map((id, i) => scenario(id, 'dilemma', [...s.finalParts], i));
    api.music('think'); api.say('host.final-round');
    return go(s, api, 'final-write', api.seconds(FINAL_WRITE_S));
  }
  const kind: Kind = s.round === 1 ? 'dilemma' : 'rather', deck = kind === 'dilemma' ? s.dilemmas : s.rathers;
  s.cards = api.shuffle(s.ids).map((id, i) => scenario(id, kind, partsOf(deck[i]!), i));
  api.music('split-decision');
  if (kind === 'rather') api.say('split-decision.rather');
  go(s, api, 'write', api.seconds(kind === 'dilemma' ? WRITE_S : RATHER_S));
}

/** Time's up or everyone is in: offline players who wrote nothing sit out, house blanks fill the gaps, then the cards play. */
function endWrite(s: SplitState, api: MiniApi) {
  s.cards = s.cards.filter(c => s.online[c.author] || c.fills.some(f => f.text !== null));
  for (const c of s.cards) for (const f of c.fills) if (f.text === null) Object.assign(f, { text: house(s, c), house: true });
  if (s.phase === 'final-write') {
    s.cards = api.shuffle(s.cards).map((c, i) => ({ ...c, id: `e${i}` }));
    api.music('vote'); api.sfx('whoosh'); api.speak(sentence(s.finalParts, ['blank']));
    return go(s, api, 'final-vote', api.seconds(judgeSeconds(Math.max(1, s.cards.length - 1))));
  }
  return s.cards.length ? showCard(s, api) : endRound(s, api);
}

function showCard(s: SplitState, api: MiniApi) {
  api.music('vote'); api.sfx('swoosh-in');
  go(s, api, 'show', showBeats(texts(card(s))).end);
}

function endRound(s: SplitState, api: MiniApi) {
  api.music('split-decision'); api.sfx('whoosh');
  go(s, api, 'scores', SCORES_MS); hold(s, api, api.say('host.scores'));
}

/** Scores one scenario: the author by how evenly the room split (× round, half for house blanks), the minority 50 × round each. */
function settle(s: SplitState, c: Scenario, mult: number) {
  const sides: [string[], string[]] = [s.ids.filter(id => own(c.votes, id) === 0), s.ids.filter(id => own(c.votes, id) === 1)];
  const yes = sides[0].length, no = sides[1].length, isHouse = c.fills.some(f => f.house), raw = splitPoints(yes, no) * mult;
  const points = isHouse ? Math.round(raw / 2) : raw, low = minority(yes, no), bold = low === null ? 0 : BOLD * mult, verdict = verdictOf(yes, no);
  s.scores[c.author]! += points;
  if (verdict === 'perfect') s.stats.perfect[c.author]!++;
  if (verdict === 'unanimous') s.stats.unanimous[c.author]!++;
  if (low !== null) for (const id of sides[low]) { s.scores[id]! += bold; s.stats.bold[id]!++; }
  return { sides, yes, no, points, bold, verdict, isHouse, low };
}

function reveal(s: SplitState, api: MiniApi) {
  const c = card(s), r = settle(s, c, s.round);
  c.outcome = { author: c.author, sides: r.sides, points: r.points, verdict: r.verdict, bold: r.bold, ...(r.isHouse ? { house: true as const } : {}) };
  api.music('reveal');
  go(s, api, 'result', RESULT.end + (r.verdict === 'perfect' || r.verdict === 'unanimous' ? RESULT.bonus : 0));
}

function callout(s: SplitState, api: MiniApi, verdict: Verdict, bold: boolean) {
  if (verdict === 'perfect') { api.sfx('airhorn'); api.sfx('cheer'); hold(s, api, api.say('split-decision.perfect')); }
  else if (verdict === 'unanimous') { api.sfx('record-scratch'); api.sfx('aww'); hold(s, api, api.say('split-decision.unanimous')); }
  else if (verdict === 'silent') { api.sfx('aww'); hold(s, api, api.say('host.no-votes')); }
  else { api.sfx(verdict === 'close' ? 'ooh' : 'boing'); api.sfx('score-up'); if (verdict === 'close' && api.random() < .3) hold(s, api, api.say('host.close')); }
  if (bold) api.sfx('coin');
}

/** The Big Split: every take scored × 3 (minority judges +150 each), revealed fewest points first. */
function finalReveal(s: SplitState, api: MiniApi) {
  s.bold = {};
  s.reveal = s.cards.map(c => {
    const r = settle(s, c, LAST_ROUND);
    if (r.low !== null) for (const id of r.sides[r.low]) s.bold[id] = (s.bold[id] ?? 0) + r.bold;
    return { id: c.id, fill: c.fills[0]!.text!, author: c.author, yes: r.yes, no: r.no, points: r.points, verdict: r.verdict, ...(r.isHouse ? { house: true as const } : {}) };
  }).sort((a, b) => a.points - b.points);
  const top = Math.max(0, ...s.reveal.map(r => r.points));
  s.best = top ? s.reveal.filter(r => r.points === top).map(r => r.author) : [];
  api.music('reveal'); api.sfx('drumroll');
  go(s, api, 'final-result', finalBeats(s.reveal.length).end);
}

export const server: MiniServer<SplitState, SplitPublic, SplitPrivate> = {
  id: 'split-decision',
  create(players, api) {
    const ids = players.map(p => p.id), zero = () => Object.fromEntries(ids.map(id => [id, 0])), family = api.settings.family;
    const s: SplitState = {
      ids, online: Object.fromEntries(players.map(p => [p.id, p.connected])),
      phase: 'write', round: 0, turn: '', seq: 0, at: api.now, deadline: api.now, stage: 0, hurried: false,
      dilemmas: dealFresh(api, dilemmaPool(family), ids.length), rathers: dealFresh(api, ratherPool(family), ids.length),
      finalParts: partsOf(dealFresh(api, finalPool(family), 1)[0]!), clauses: api.shuffle(HOUSE_CLAUSES), options: api.shuffle(HOUSE_OPTIONS),
      cards: [], index: 0, reveal: [], best: [], bold: {},
      scores: zero(), prev: zero(), stats: { perfect: zero(), bold: zero(), unanimous: zero() }, done: false,
    };
    startRound(s, api);
    return s;
  },

  action(s, id, raw, api) {
    if (!s.ids.includes(id)) throw new Error('You are watching this one.');
    const a = record(raw);
    if (a.turn !== s.turn) throw new Error('Too late! The game has moved on.');
    switch (a.k) {
      case 'fill': case 'house': {
        record(a, a.k === 'fill' ? ['turn', 'k', 'slot', 'text'] : ['turn', 'k', 'slot']);
        const task = taskOf(s, id);
        if (!task) throw new Error('No writing right now.');
        const slot = task.fills[integer(a.slot, 0, task.fills.length - 1)]!;
        if (slot.text !== null) throw new Error('That blank is already locked in.');
        if (a.k === 'fill') {
          const text = clean(a.text, task.kind);
          if (task.fills.some(f => f.text?.toLowerCase() === text.toLowerCase())) throw new Error('Make the two options different!');
          slot.text = text; api.sfx('submit');
        } else { Object.assign(slot, { text: house(s, task), house: true }); api.sfx('glitch'); }
        return;
      }
      case 'vote': {
        record(a, ['turn', 'k', 'side']);
        if (s.phase !== 'vote') throw new Error('Voting opens in a moment.');
        const c = card(s);
        if (c.author === id) throw new Error('No voting on your own dilemma!');
        if (Object.hasOwn(c.votes, id)) throw new Error('Your vote is already in.');
        c.votes[id] = integer(a.side, 0, 1) as Side; api.sfx('vote');
        return;
      }
      case 'judge': {
        record(a, ['turn', 'k', 'entry', 'side']);
        if (s.phase !== 'final-vote') throw new Error('Judging is closed.');
        const c = s.cards.find(x => x.id === a.entry);
        if (!c) throw new Error('That take is not on the board.');
        if (c.author === id) throw new Error('No judging your own take!');
        if (Object.hasOwn(c.votes, id)) throw new Error('You already judged that one.');
        c.votes[id] = integer(a.side, 0, 1) as Side; api.sfx('tap');
        if (!owed(s, id).length) api.sfx('vote');
        return;
      }
      default: throw new Error('Unknown move.');
    }
  },

  tick(s, api) {
    const now = api.now, t = now - s.at, online = s.ids.filter(id => s.online[id]);
    switch (s.phase) {
      case 'write': case 'final-write': {
        if (online.length && online.every(id => written(s, id)) && t >= MIN_READ_MS) { api.say('host.everyone-in'); return endWrite(s, api); }
        if (now >= s.deadline) { api.sfx('timeup'); api.say(variant('host.timeup', api.random)); return endWrite(s, api); }
        if (!s.hurried && s.deadline - now <= 10_000 && s.deadline - s.at > 20_000) { s.hurried = true; api.sfx('tick-fast'); api.say(variant('host.hurry', api.random)); }
        return;
      }
      case 'show': {
        const c = card(s), b = showBeats(texts(c));
        beats(s, api, b.fills, stage => {
          api.sfx(stage ? 'pop' : 'sparkle');
          if (stage === b.fills.length - 1) api.speak(sentence(c.parts, texts(c)));
        });
        if (now < s.deadline) return;
        if (s.index === 0 && s.round === 1) api.say('host.vote.2');
        api.sfx('ding');
        return go(s, api, 'vote', api.seconds(VOTE_S));
      }
      case 'vote': {
        const c = card(s), voters = online.filter(id => id !== c.author);
        if ((voters.every(id => Object.hasOwn(c.votes, id)) && t >= 1200) || now >= s.deadline) return reveal(s, api);
        if (!s.hurried && s.deadline - now <= 4000) { s.hurried = true; api.sfx('tick-fast'); }
        return;
      }
      case 'result': {
        const o = card(s).outcome!;
        beats(s, api, [RESULT.slide, RESULT.author, RESULT.points], stage => {
          if (stage === 0) { api.sfx('whoosh'); api.sfx('slide'); }
          if (stage === 1) api.sfx('reveal');
          if (stage === 2) callout(s, api, o.verdict, o.bold > 0);
        });
        if (now < s.deadline) return;
        return ++s.index < s.cards.length ? showCard(s, api) : endRound(s, api);
      }
      case 'scores':
        if (now >= s.deadline) startRound(s, api);
        return;
      case 'final-vote': {
        if ((online.every(id => !owed(s, id).length) && t >= MIN_READ_MS) || now >= s.deadline) return finalReveal(s, api);
        if (!s.hurried && s.deadline - now <= 6000 && s.deadline - s.at > 15_000) { s.hurried = true; api.sfx('tick-fast'); }
        return;
      }
      case 'final-result': {
        const n = s.reveal.length, b = finalBeats(n);
        beats(s, api, [...b.reveals, b.best, b.bold], stage => {
          if (stage < n) api.sfx(s.reveal[stage]!.verdict === 'perfect' ? 'sparkle' : s.reveal[stage]!.points ? 'score-up' : 'pop');
          else if (stage === n) {
            api.sfx('fanfare'); api.sfx('applause');
            hold(s, api, api.say(!s.best.length ? 'host.no-votes' : s.best.length > 1 ? 'host.tie' : variant('host.winner', api.random)));
          } else if (Object.keys(s.bold).length) api.sfx('coin');
        });
        if (now >= s.deadline && s.stage > n + 1) s.done = true;
      }
    }
  },

  presence(s, id, connected) { if (Object.hasOwn(s.online, id)) s.online[id] = connected; },

  publicView(s) {
    const pub: SplitPublic = { phase: s.phase, round: s.round, turn: s.turn, at: s.at, deadline: s.deadline, scores: { ...s.scores }, done: [] };
    if (s.phase === 'scores') pub.prev = { ...s.prev };
    if (writing(s)) pub.done = s.ids.filter(id => taskOf(s, id) && written(s, id));
    if (s.phase === 'final-vote') pub.done = s.ids.filter(id => s.cards.length > 1 && !owed(s, id).length);
    if (s.phase === 'show' || s.phase === 'vote' || s.phase === 'result') {
      const c = card(s), o = c.outcome;
      pub.card = { index: s.index, count: s.cards.length, kind: c.kind, parts: [...c.parts], fills: texts(c), votes: Object.keys(c.votes).length };
      if (s.phase === 'result' && o) pub.card.outcome = { ...o, sides: [[...o.sides[0]], [...o.sides[1]]] };
    }
    if (s.phase === 'final-write' || s.phase === 'final-vote' || s.phase === 'final-result') pub.final = {
      parts: [...s.finalParts], entries: s.phase === 'final-write' ? [] : s.cards.map(c => ({ id: c.id, fill: c.fills[0]!.text! })),
      ...(s.phase === 'final-result' ? { result: { entries: s.reveal.map(r => ({ ...r })), best: [...s.best], bold: { ...s.bold } } } : {}),
    };
    return pub;
  },

  playerView(s, id) {
    const me: SplitPrivate = { turn: s.turn }, task = taskOf(s, id);
    if (task) me.task = { kind: task.kind, parts: [...task.parts], slots: task.fills.map(f => f.text === null ? {} : { text: f.text, ...(f.house ? { house: true as const } : {}) }) };
    if (s.phase === 'show' || s.phase === 'vote' || s.phase === 'result') {
      const c = card(s), side = own(c.votes, id);
      me.role = c.author === id ? 'author' : 'voter';
      if (side !== undefined) me.side = side;
    }
    if (s.phase === 'final-vote' || s.phase === 'final-result') {
      const mine = s.cards.find(c => c.author === id);
      if (mine) me.mine = mine.id;
      me.judged = Object.fromEntries(s.cards.filter(c => Object.hasOwn(c.votes, id)).map(c => [c.id, c.votes[id]!]));
    }
    return me;
  },

  result(s): MiniResult | null {
    if (!s.done) return null;
    const top = Math.max(...s.ids.map(id => s.scores[id]!)), awards: { title: string; playerId: string }[] = [];
    const best = (title: string, rec: Record<string, number>, min = 1) => {
      const max = Math.max(...s.ids.map(id => rec[id]!)), who = s.ids.filter(id => rec[id] === max);
      if (max >= min && who.length === 1) awards.push({ title, playerId: who[0]! });
    };
    best('Master splitter', s.stats.perfect);
    if (s.best.length === 1) awards.push({ title: 'Won The Big Split', playerId: s.best[0]! });
    best('Proud contrarian', s.stats.bold, 2);
    best('United the room', s.stats.unanimous, 2);
    const perfect = s.ids.reduce((sum, id) => sum + s.stats.perfect[id]!, 0);
    const headline = perfect ? `${perfect} perfect split${perfect === 1 ? '' : 's'}! The dimension is stable.` : 'Not one perfect split. This room thinks alike!';
    return { scores: { ...s.scores }, winners: top > 0 ? s.ids.filter(id => s.scores[id] === top) : [], headline, ...(awards.length ? { awards } : {}) };
  },
};
export default server;
