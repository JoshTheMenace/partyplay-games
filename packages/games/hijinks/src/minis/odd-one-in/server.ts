/* Odd One In rules: 3–4 cases, each with one secret faker and one category; up to three tasks until the faker is caught. Server only. */
import type { MiniApi, MiniResult, MiniServer } from '../../core/contract';
import { freshDeck } from '../../core/server/deck';
import { record } from '../../core/server/validate';
import { taskPool } from './content.server';
import {
  CASE_MS, CATEGORIES, CLOSED, DISCUSS_S, FACES, FAKER_BRIEF, MIN_READ_MS, NUMBERS, POINTS, REVEAL, TASKS_PER_CASE, TASK_S, VERDICT, VOTE_S,
  type Answer, type CaseFile, type Category, type OddPrivate, type OddPublic, type Phase, type Verdict,
} from './types';

type Task = { prompt: string; answers: Record<string, Answer>; ready: string[]; votes: Record<string, string>; verdict: Verdict | null };
type File = { category: Category; faker: string; tasks: Task[]; survived: number; cleared: string[] };
type Stat = 'correct' | 'survived' | 'suspected';
export type OddState = {
  ids: string[]; online: Record<string, boolean>;
  phase: Phase; round: number; rounds: number; turn: string; seq: number; at: number; deadline: number; stage: number; hurried: boolean;
  /** One category per case, and each category's undealt tasks (unused tonight first, in random order). */
  categories: Category[]; decks: Record<Category, string[]>;
  /** Times each player has been the faker, and the last faker (never twice in a row). */
  fakes: Record<string, number>; last: string | null;
  file: File; closed: CaseFile | null;
  scores: Record<string, number>; prev: Record<string, number>; stats: Record<Stat, Record<string, number>>; caught: number;
  done: boolean;
};

const own = <T>(rec: Record<string, T>, key: string): T | undefined => Object.hasOwn(rec, key) ? rec[key] : undefined;
const task = (s: OddState) => s.file.tasks.at(-1)!;
const options = (s: OddState): readonly string[] => ({ hands: ['up', 'down'], number: NUMBERS, point: s.ids, face: FACES.map(f => f.id) })[s.file.category];

function go(s: OddState, api: MiniApi, phase: Phase, span: number) {
  Object.assign(s, { phase, at: api.now, deadline: api.now + span, turn: `t${++s.seq}`, stage: 0, hurried: false });
}
/** Keeps the phase open long enough for a narrator line that just started. */
function hold(s: OddState, api: MiniApi, spoken: number) { if (spoken) s.deadline = Math.max(s.deadline, api.now + spoken + 800); }
/** Runs `play(stage)` once for every beat (ms from the phase start) that has been reached. */
function beats(s: OddState, api: MiniApi, at: readonly number[], play: (stage: number) => void) {
  while (s.stage < at.length && api.now - s.at >= at[s.stage]!) play(s.stage++);
}

/** Least-used connected player who wasn't the faker last case (falls back to anyone but the last faker). */
function chooseFaker(s: OddState, api: MiniApi) {
  const fresh = (ids: string[]) => ids.filter(id => id !== s.last);
  const pool = [fresh(s.ids.filter(id => s.online[id])), fresh(s.ids), s.ids].find(ids => ids.length)!;
  const least = Math.min(...pool.map(id => s.fakes[id]!));
  return api.pick(pool.filter(id => s.fakes[id] === least), 1)[0]!;
}

function startCase(s: OddState, api: MiniApi) {
  s.round++;
  const faker = chooseFaker(s, api);
  s.fakes[faker]!++; s.last = faker; s.closed = null;
  s.file = { category: s.categories[s.round - 1]!, faker, tasks: [], survived: 0, cleared: [] };
  api.music('odd-one-in'); api.sfx('typewriter'); api.sfx('stamp');
  go(s, api, 'case', CASE_MS);
  if (s.round === s.rounds && s.round > 1) hold(s, api, api.say('host.final-round'));
}

function startTask(s: OddState, api: MiniApi) {
  const deck = s.decks[s.file.category];
  if (!deck.length) deck.push(...freshDeck(api, taskPool(s.file.category, api.settings.family)));
  const prompt = deck.shift()!;
  api.used.add(prompt);
  s.file.tasks.push({ prompt, answers: {}, ready: [], votes: {}, verdict: null });
  api.music('odd-one-in'); api.sfx('swoosh-in');
  go(s, api, 'task', api.seconds(TASK_S));
}

/** Time's up or everyone answered: missing answers become random picks (flagged), then the 3-2-1 reveal. */
function endTask(s: OddState, api: MiniApi) {
  const t = task(s), pool = options(s);
  for (const id of s.ids) if (!own(t.answers, id)) t.answers[id] = { player: id, value: api.pick(pool, 1)[0]!, auto: true };
  go(s, api, 'reveal', REVEAL.end);
}

/** Strictly most votes on one player accuses them; caught when that is the faker. Survival points wait for the case to close. */
function verdict(s: OddState, api: MiniApi) {
  const t = task(s), f = s.file, tally: Record<string, number> = {};
  for (const suspect of Object.values(t.votes)) tally[suspect] = (tally[suspect] ?? 0) + 1;
  const top = Math.max(0, ...Object.values(tally)), leaders = Object.keys(tally).filter(id => tally[id] === top);
  const accused = top > 0 && leaders.length === 1 ? leaders[0]! : null, outcome = accused === null ? 'hung' : accused === f.faker ? 'caught' : 'framed';
  for (const [voter, suspect] of Object.entries(t.votes)) if (suspect === f.faker) s.stats.correct[voter]!++;
  for (const [id, n] of Object.entries(tally)) if (id !== f.faker) s.stats.suspected[id]! += n;
  if (outcome !== 'caught') { f.survived++; s.stats.survived[f.faker]!++; }
  t.verdict = { votes: { ...t.votes }, accused, outcome, ...(outcome !== 'caught' && f.tasks.length === TASKS_PER_CASE ? { escaped: true as const } : {}) };
  api.music('reveal'); api.sfx('drumroll');
  go(s, api, 'verdict', VERDICT.end);
}

function stamp(s: OddState, api: MiniApi, v: Verdict) {
  if (v.outcome === 'caught') { api.sfx('buzzer'); api.sfx('cheer'); hold(s, api, api.say('odd-one-in.caught')); }
  else if (v.outcome === 'framed') { api.sfx('record-scratch'); api.sfx('aww'); hold(s, api, api.say('odd-one-in.framed')); }
  else { api.sfx('ooh'); hold(s, api, api.say(Object.keys(v.votes).length ? 'host.tie' : 'host.no-votes')); }
}

/** Innocents: +500 per vote that named the faker, plus +100 each when the faker is caught. Faker: 500 per survived task, +1000 for escaping. */
function closeCase(s: OddState, api: MiniApi) {
  const f = s.file, caught = task(s).verdict!.outcome === 'caught';
  const hits = (id: string) => f.tasks.filter(t => own(t.votes, id) === f.faker).length;
  const gains = Object.fromEntries(s.ids.map(id => [id, id === f.faker
    ? f.survived * POINTS.survive + (caught ? 0 : POINTS.disguise)
    : hits(id) * POINTS.correct + (caught ? POINTS.team : 0)]));
  s.prev = { ...s.scores };
  for (const id of s.ids) s.scores[id]! += gains[id]!;
  if (caught) s.caught++;
  s.closed = { faker: f.faker, caught, survived: f.survived, gains, trail: f.tasks.map(t => ({ prompt: t.prompt, value: t.answers[f.faker]!.value })) };
  api.music('odd-one-in');
  go(s, api, 'closed', CLOSED.end);
}

export const server: MiniServer<OddState, OddPublic, OddPrivate> = {
  id: 'odd-one-in',
  create(players, api) {
    const ids = players.map(p => p.id), zero = () => Object.fromEntries(ids.map(id => [id, 0])), rounds = ids.length >= 6 ? 4 : 3;
    const s: OddState = {
      ids, online: Object.fromEntries(players.map(p => [p.id, p.connected])),
      phase: 'case', round: 0, rounds, turn: '', seq: 0, at: api.now, deadline: api.now, stage: 0, hurried: false,
      categories: api.shuffle(CATEGORIES).slice(0, rounds),
      decks: Object.fromEntries(CATEGORIES.map(c => [c, freshDeck(api, taskPool(c, api.settings.family))])) as Record<Category, string[]>,
      fakes: zero(), last: null, file: { category: 'hands', faker: '', tasks: [], survived: 0, cleared: [] }, closed: null,
      scores: zero(), prev: zero(), stats: { correct: zero(), survived: zero(), suspected: zero() }, caught: 0, done: false,
    };
    startCase(s, api);
    return s;
  },

  action(s, id, raw, api) {
    if (!s.ids.includes(id)) throw new Error('You are watching this one.');
    const a = record(raw);
    if (a.turn !== s.turn) throw new Error('Too late! The game has moved on.');
    const t = s.file.tasks.at(-1);
    switch (a.k) {
      case 'answer': {
        record(a, ['turn', 'k', 'value']);
        if (s.phase !== 'task' || !t) throw new Error('No answers right now.');
        if (own(t.answers, id)) throw new Error('Your answer is already locked in.');
        if (typeof a.value !== 'string' || !options(s).includes(a.value)) throw new Error('Pick one of the options.');
        t.answers[id] = { player: id, value: a.value }; api.sfx('submit');
        return;
      }
      case 'ready': {
        record(a, ['turn', 'k']);
        if (s.phase !== 'discuss' || !t) throw new Error('Not yet! Talk it over first.');
        if (t.ready.includes(id)) throw new Error('You’re already ready to vote.');
        t.ready.push(id); api.sfx('tap');
        return;
      }
      case 'vote': {
        record(a, ['turn', 'k', 'suspect']);
        if (s.phase !== 'vote' || !t) throw new Error('Voting opens in a moment.');
        if (own(t.votes, id)) throw new Error('Your vote is already in.');
        if (typeof a.suspect !== 'string' || !s.ids.includes(a.suspect)) throw new Error('Pick a player in the room.');
        if (a.suspect === id) throw new Error('You can’t accuse yourself!');
        t.votes[id] = a.suspect; api.sfx('vote');
        return;
      }
      default: throw new Error('Unknown move.');
    }
  },

  tick(s, api) {
    const now = api.now, t = now - s.at, online = s.ids.filter(id => s.online[id]), cur = s.file.tasks.at(-1);
    const all = (has: (id: string) => boolean, min = MIN_READ_MS) => online.length > 0 && online.every(has) && t >= min;
    switch (s.phase) {
      case 'case':
        if (now >= s.deadline) startTask(s, api);
        return;
      case 'task': {
        if (all(id => !!own(cur!.answers, id))) { api.sfx('lock'); return endTask(s, api); }
        if (now >= s.deadline) { api.sfx('timeup'); return endTask(s, api); }
        if (!s.hurried && s.deadline - now <= 5000) { s.hurried = true; api.sfx('tick-fast'); }
        return;
      }
      case 'reveal':
        beats(s, api, [...REVEAL.counts, REVEAL.flip, REVEAL.prompt], stage => {
          if (stage < 3) api.sfx('tick');
          else if (stage === 3) { api.sfx('camera'); api.sfx('reveal'); }
          else { api.sfx('pop'); api.speak(cur!.prompt); }
        });
        if (now >= s.deadline) { api.sfx('sting'); go(s, api, 'discuss', api.seconds(DISCUSS_S)); }
        return;
      case 'discuss':
        if (!s.hurried && s.deadline - now <= 8000) { s.hurried = true; api.sfx('heartbeat'); }
        if (all(id => cur!.ready.includes(id)) || now >= s.deadline) { api.music('vote'); api.sfx('ding'); go(s, api, 'vote', api.seconds(VOTE_S)); }
        return;
      case 'vote':
        if (all(id => !!own(cur!.votes, id), 1200) || now >= s.deadline) verdict(s, api);
        return;
      case 'verdict': {
        const v = cur!.verdict!;
        beats(s, api, [VERDICT.votes, VERDICT.accused, VERDICT.stamp], stage => {
          if (stage === 0 && Object.keys(v.votes).length) api.sfx('whoosh');
          if (stage === 1) api.sfx(v.accused ? 'gasp' : 'heartbeat');
          if (stage === 2) stamp(s, api, v);
        });
        if (now < s.deadline) return;
        // Cleared only once the verdict is over, so a "Cleared" tag can't spoil the stamp.
        if (v.outcome === 'framed') s.file.cleared.push(v.accused!);
        return v.outcome === 'caught' || v.escaped ? closeCase(s, api) : startTask(s, api);
      }
      case 'closed': {
        const c = s.closed!;
        beats(s, api, [CLOSED.faker, CLOSED.scores], stage => {
          if (stage === 0) { api.sfx('stamp'); if (!c.caught) { api.sfx('fanfare'); hold(s, api, api.say('odd-one-in.escaped')); } }
          else api.sfx('score-up');
        });
        if (now < s.deadline) return;
        if (s.round < s.rounds) return startCase(s, api);
        s.done = true;
      }
    }
  },

  presence(s, id, connected) { if (Object.hasOwn(s.online, id)) s.online[id] = connected; },

  publicView(s) {
    const f = s.file, t = f.tasks.at(-1), shown = s.phase !== 'case' && s.phase !== 'task' && s.phase !== 'closed';
    const pub: OddPublic = {
      phase: s.phase, round: s.round, rounds: s.rounds, task: Math.max(1, f.tasks.length), turn: s.turn, at: s.at, deadline: s.deadline,
      category: f.category, scores: { ...s.scores }, done: [], cleared: [...f.cleared],
    };
    if (t && s.phase === 'task') pub.done = s.ids.filter(id => !!own(t.answers, id));
    if (t && s.phase === 'discuss') pub.done = s.ids.filter(id => t.ready.includes(id));
    if (t && s.phase === 'vote') pub.done = s.ids.filter(id => !!own(t.votes, id));
    if (t && shown) Object.assign(pub, { prompt: t.prompt, answers: s.ids.map(id => ({ ...t.answers[id]! })) });
    if (t?.verdict && s.phase === 'verdict') {
      pub.verdict = { ...t.verdict, votes: { ...t.verdict.votes } };
      if (t.verdict.outcome === 'caught') pub.faker = f.faker;
    }
    if (s.closed && s.phase === 'closed') Object.assign(pub, { closed: { ...s.closed, gains: { ...s.closed.gains }, trail: s.closed.trail.map(x => ({ ...x })) }, prev: { ...s.prev } });
    return pub;
  },

  playerView(s, id) {
    const t = s.file.tasks.at(-1), faker = id === s.file.faker, me: OddPrivate = { turn: s.turn, faker };
    if (!t || s.phase === 'case') return me;
    if (s.phase === 'task') me.brief = faker ? FAKER_BRIEF : t.prompt;
    const answer = own(t.answers, id), vote = own(t.votes, id);
    if (answer) me.answer = answer.value;
    if (t.ready.includes(id)) me.ready = true;
    if (vote) me.vote = vote;
    return me;
  },

  result(s): MiniResult | null {
    if (!s.done) return null;
    const top = Math.max(...s.ids.map(id => s.scores[id]!)), awards: { title: string; playerId: string }[] = [];
    const best = (title: string, rec: Record<string, number>, min = 1) => {
      const max = Math.max(...s.ids.map(id => rec[id]!)), who = s.ids.filter(id => rec[id] === max);
      if (max >= min && who.length === 1) awards.push({ title, playerId: who[0]! });
    };
    best('Best Detective', s.stats.correct);
    best('Smoothest Faker', s.stats.survived);
    best('Usual Suspect', s.stats.suspected, 2);
    const headline = s.caught === s.rounds ? 'Every faker was caught!' : s.caught ? `${s.caught} of ${s.rounds} fakers caught` : 'Not one faker was caught!';
    return { scores: { ...s.scores }, winners: top > 0 ? s.ids.filter(id => s.scores[id] === top) : [], headline, ...(awards.length ? { awards } : {}) };
  },
};
export default server;
