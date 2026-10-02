/* Airlock rules: up to seven crew tests on the way to Earth. Hidden aliens get a near-miss prompt; anyone can push the airlock
   button to space suspects on a unanimous vote. Server only. */
import { parseDrawing, type Drawing } from '../../../../../party-contract/src/index';
import type { MiniApi, MiniResult, MiniServer } from '../../core/contract';
import { variant } from '../../core/narration';
import { freshDeck } from '../../core/server/deck';
import { integer, record } from '../../core/server/validate';
import { pairKey, pairPool, type Pair } from './content.server';
import {
  BRIEF_MS, DISCUSS_S, KINDS, MAX_ANSWER, MAX_PUSHES, MIN_READ_MS, MIN_RESUME_MS, POINTS, RATING_MAX, TESTS, TEST_S, VOTE_S,
  aliensFor, artKey, endBeats, resultBeats, verdictBeats, type AirPrivate, type AirPublic, type Ending, type Kind, type Phase, type Value, type Vote,
} from './types';

type Test = { pair: Pair; answers: Record<string, Value>; arts: Record<string, Drawing>; hacked: boolean; scanned: string[]; ready: string[] };
type Ballot = { by: string; suspects: string[]; votes: Record<string, Vote>; voters: string[]; eject: boolean; resume: number };
export type AirState = {
  ids: string[]; online: Record<string, boolean>; aliens: string[];
  phase: Phase; turn: string; seq: number; at: number; deadline: number; stage: number; hurried: boolean;
  /** The kind of each of the seven tests, the undealt pairs per kind (unused tonight first) and the tests so far. */
  order: Kind[]; decks: Record<Kind, Pair[]>; tests: Test[];
  /** Button pushes used per player; the aliens' one team hack; crew who used their one scan. */
  pushes: Record<string, number>; hacker: string | null; scans: string[];
  ballot: Ballot | null; ending: Ending | null;
  scores: Record<string, number>; prev: Record<string, number>; suspected: Record<string, number>;
  done: boolean;
};

const own = <T>(rec: Record<string, T>, key: string): T | undefined => Object.hasOwn(rec, key) ? rec[key] : undefined;
const test = (s: AirState) => s.tests.at(-1)!;
const isAlien = (s: AirState, id: string) => s.aliens.includes(id);

/** Trims, collapses whitespace and drops control/bidi characters; 1–40 characters. */
function clean(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > MAX_ANSWER * 4) throw new Error(`Keep it under ${MAX_ANSWER} characters.`);
  const text = raw.replace(/[\p{Cc}‪-‮⁦-⁩]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Type an answer first.');
  if (text.length > MAX_ANSWER) throw new Error(`Keep it under ${MAX_ANSWER} characters.`);
  return text;
}

function go(s: AirState, api: MiniApi, phase: Phase, span: number) {
  Object.assign(s, { phase, at: api.now, deadline: api.now + span, turn: `t${++s.seq}`, stage: 0, hurried: false });
}
/** Keeps the phase open long enough for a narrator line that just started. */
function hold(s: AirState, api: MiniApi, spoken: number) { if (spoken) s.deadline = Math.max(s.deadline, api.now + spoken + 800); }
/** Runs `play(stage)` once for every beat (ms from the phase start) that has been reached. */
function beats(s: AirState, api: MiniApi, at: readonly number[], play: (stage: number) => void) {
  while (s.stage < at.length && api.now - s.at >= at[s.stage]!) play(s.stage++);
}

/** Every kind once (never opening on a drawing), then two more quick ones: seven tests. */
function testOrder(api: MiniApi): Kind[] {
  const first = api.shuffle(KINDS);
  if (first[0] === 'draw') [first[0], first[1]] = [first[1]!, first[0]];
  return [...first, ...api.shuffle(KINDS.filter(k => k !== 'draw' && k !== first.at(-1))).slice(0, TESTS - KINDS.length)];
}

function startTest(s: AirState, api: MiniApi) {
  const last = s.tests.at(-1);
  if (last) Object.keys(last.arts).forEach(id => api.media.remove(artKey(s.tests.length, s.ids.indexOf(id))));
  const kind = s.order[s.tests.length]!, deck = s.decks[kind];
  if (!deck.length) deck.push(...freshDeck(api, pairPool(kind, api.settings.family), pairKey));
  const pair = deck.shift()!;
  api.used.add(pairKey(pair));
  s.tests.push({ pair, answers: {}, arts: {}, hacked: false, scanned: [], ready: [] });
  s.ballot = null;
  api.music('airlock'); api.sfx('swoosh-in');
  go(s, api, 'test', api.seconds(TEST_S[kind]));
  if (s.tests.length === TESTS) hold(s, api, api.say('host.final-round'));
}

/** Time's up or everyone answered: drawings go public, then the answers flip on the TV. Missing answers stay empty. */
function endTest(s: AirState, api: MiniApi) {
  const t = test(s);
  for (const [id, drawing] of Object.entries(t.arts)) api.media.put(artKey(s.tests.length, s.ids.indexOf(id)), drawing);
  api.music('reveal'); api.sfx('whoosh'); api.speak(t.pair.crew);
  go(s, api, 'results', resultBeats(s.ids.length).end);
}

function discuss(s: AirState, api: MiniApi, span: number) {
  api.music('think-2');
  go(s, api, 'discuss', span);
}

function tally(s: AirState, api: MiniApi) {
  const b = s.ballot!;
  b.voters = s.ids.filter(id => !b.suspects.includes(id) && (s.online[id] || own(b.votes, id)));
  b.eject = b.voters.every(id => own(b.votes, id) === 'airlock');
  api.sfx('drumroll'); api.say(variant('host.votes-in', api.random));
  go(s, api, 'verdict', verdictBeats(b.voters.length, b.eject, b.suspects.length).end);
}

/** Crew win by spacing every alien; aliens win by spacing a human or reaching Earth (+500 per test survived). */
function finish(s: AirState, api: MiniApi, how: Ending['how'], by?: string) {
  const winner = how === 'caught' ? 'crew' : 'aliens', team = s.ids.filter(id => isAlien(s, id) === (winner === 'aliens'));
  const survived = s.tests.length, gains = Object.fromEntries(s.ids.map(id => [id, !team.includes(id) ? 0
    : POINTS.win + (winner === 'aliens' ? survived * POINTS.survive : 0) + (id === by ? POINTS.push : 0)]));
  s.prev = { ...s.scores };
  for (const id of s.ids) s.scores[id]! += gains[id]!;
  s.ending = { winner, how, aliens: [...s.aliens], survived, gains, ...(by && team.includes(by) ? { by } : {}) };
  api.music('reveal');
  go(s, api, 'end', endBeats(s.aliens.length).end);
}

export const server: MiniServer<AirState, AirPublic, AirPrivate> = {
  id: 'airlock',
  create(players, api) {
    const ids = players.map(p => p.id), zero = () => Object.fromEntries(ids.map(id => [id, 0])), online = ids.filter((_, i) => players[i]!.connected);
    // Aliens come from the connected players when there are enough of them.
    const count = aliensFor(ids.length), aliens = api.pick(online.length > count ? online : ids, count);
    const s: AirState = {
      ids, online: Object.fromEntries(players.map(p => [p.id, p.connected])), aliens: ids.filter(id => aliens.includes(id)),
      phase: 'brief', turn: '', seq: 0, at: api.now, deadline: api.now, stage: 0, hurried: false,
      order: testOrder(api), decks: Object.fromEntries(KINDS.map(k => [k, freshDeck(api, pairPool(k, api.settings.family), pairKey)])) as Record<Kind, Pair[]>, tests: [],
      pushes: zero(), hacker: null, scans: [], ballot: null, ending: null,
      scores: zero(), prev: zero(), suspected: zero(), done: false,
    };
    api.music('airlock'); api.sfx('alarm');
    go(s, api, 'brief', BRIEF_MS);
    return s;
  },

  action(s, id, raw, api) {
    if (!s.ids.includes(id)) throw new Error('You are watching this one.');
    const a = record(raw);
    if (a.turn !== s.turn) throw new Error('Too late! The ship has moved on.');
    const t = s.tests.at(-1);
    switch (a.k) {
      case 'answer': case 'draw': {
        record(a, ['turn', 'k', a.k === 'draw' ? 'drawing' : 'value']);
        if (s.phase !== 'test' || !t) throw new Error('No test right now.');
        if (own(t.answers, id) !== undefined) throw new Error('Your answer is already locked in.');
        const kind = t.pair.kind;
        if ((kind === 'draw') !== (a.k === 'draw')) throw new Error('That’s not this test.');
        if (a.k === 'draw') {
          const drawing = parseDrawing(a.drawing);
          if (!drawing.strokes.length) throw new Error('Draw something first!');
          t.arts[id] = drawing; t.answers[id] = artKey(s.tests.length, s.ids.indexOf(id)); api.sfx('scribble');
          return;
        }
        if (kind === 'pick' && (typeof a.value !== 'string' || !s.ids.includes(a.value))) throw new Error('Pick a crewmate.');
        t.answers[id] = kind === 'answer' ? clean(a.value) : kind === 'rating' ? integer(a.value, 1, RATING_MAX) : kind === 'choice' ? integer(a.value, 0, 3) : a.value as string;
        api.sfx('submit');
        return;
      }
      case 'scan': {
        // Aliens share one hack (the crew's prompt); crew each get one harmless scan. Silent on the TV either way.
        record(a, ['turn', 'k']);
        if (s.phase !== 'test' || !t) throw new Error('Scanners only work during a test.');
        if (isAlien(s, id)) {
          if (s.hacker) throw new Error('Your scan is used up.');
          s.hacker = id; t.hacked = true;
        } else {
          if (s.scans.includes(id)) throw new Error('Your scan is used up.');
          s.scans.push(id); t.scanned.push(id);
        }
        return;
      }
      case 'ready': {
        record(a, ['turn', 'k']);
        if (s.phase !== 'discuss' || !t) throw new Error('Not yet! Talk it over first.');
        if (t.ready.includes(id)) throw new Error('You’re already ready.');
        t.ready.push(id); api.sfx('tap');
        return;
      }
      case 'push': {
        record(a, ['turn', 'k', 'suspects']);
        if (s.phase !== 'discuss') throw new Error('The button only works during a discussion.');
        if (s.pushes[id]! >= MAX_PUSHES) throw new Error('You’ve used both of your button pushes.');
        const suspects = a.suspects, need = s.aliens.length;
        if (!Array.isArray(suspects) || suspects.length !== need) throw new Error(need > 1 ? `Pick ${need} suspects.` : 'Pick one suspect.');
        if (suspects.some(x => typeof x !== 'string' || !s.ids.includes(x))) throw new Error('Pick crewmates in the room.');
        if (new Set(suspects).size !== suspects.length) throw new Error('Pick different suspects.');
        if (suspects.includes(id)) throw new Error('You can’t space yourself!');
        s.pushes[id]!++;
        for (const x of suspects as string[]) s.suspected[x]!++;
        s.ballot = { by: id, suspects: s.ids.filter(x => suspects.includes(x)), votes: { [id]: 'airlock' }, voters: [], eject: false, resume: Math.max(MIN_RESUME_MS, s.deadline - api.now) };
        api.music('vote'); api.sfx('alarm');
        go(s, api, 'vote', api.seconds(VOTE_S));
        hold(s, api, api.say('airlock.button'));
        return;
      }
      case 'vote': {
        record(a, ['turn', 'k', 'vote']);
        const b = s.ballot;
        if (s.phase !== 'vote' || !b) throw new Error('No vote right now.');
        if (b.suspects.includes(id)) throw new Error('You’re in the airlock! Plead your case.');
        if (own(b.votes, id)) throw new Error('Your vote is already in.');
        if (a.vote !== 'airlock' && a.vote !== 'abort') throw new Error('Vote airlock or abort.');
        b.votes[id] = a.vote; api.sfx('vote');
        return;
      }
      default: throw new Error('Unknown move.');
    }
  },

  tick(s, api) {
    const now = api.now, t = now - s.at, online = s.ids.filter(id => s.online[id]), cur = s.tests.at(-1);
    const all = (has: (id: string) => boolean, ids = online, min = MIN_READ_MS) => ids.length > 0 && ids.every(has) && t >= min;
    switch (s.phase) {
      case 'brief':
        if (now >= s.deadline) startTest(s, api);
        return;
      case 'test': {
        if (all(id => own(cur!.answers, id) !== undefined)) { api.sfx('lock'); api.say('host.everyone-in'); return endTest(s, api); }
        if (now >= s.deadline) { api.sfx('timeup'); api.say(variant('host.timeup', api.random)); return endTest(s, api); }
        if (!s.hurried && s.deadline - now <= 5000) { s.hurried = true; api.sfx('tick-fast'); }
        return;
      }
      case 'results': {
        const plan = resultBeats(s.ids.length);
        beats(s, api, [...plan.cards, plan.summary], stage => api.sfx(stage < plan.cards.length ? 'pop' : 'ding'));
        if (now >= s.deadline) { api.sfx('sting'); discuss(s, api, api.seconds(DISCUSS_S)); }
        return;
      }
      case 'discuss':
        if (!s.hurried && s.deadline - now <= 6000) { s.hurried = true; api.sfx('heartbeat'); }
        if (!all(id => cur!.ready.includes(id)) && now < s.deadline) return;
        return s.tests.length < TESTS ? startTest(s, api) : finish(s, api, 'arrived');
      case 'vote': {
        const b = s.ballot!;
        if (all(id => !!own(b.votes, id), online.filter(id => !b.suspects.includes(id)), 1200) || now >= s.deadline) tally(s, api);
        return;
      }
      case 'verdict': {
        const b = s.ballot!, plan = verdictBeats(b.voters.length, b.eject, b.suspects.length);
        beats(s, api, [...plan.votes, plan.outcome, ...plan.roles], stage => {
          if (stage < plan.votes.length) return api.sfx(own(b.votes, b.voters[stage]!) === 'airlock' ? 'stamp' : 'tap');
          if (stage === plan.votes.length) { if (b.eject) { api.sfx('alarm'); api.sfx('whoosh'); } else { api.sfx('buzzer'); api.sfx('aww'); } return; }
          const alien = isAlien(s, b.suspects[stage - plan.votes.length - 1]!);
          api.sfx(alien ? 'glitch' : 'gasp'); api.sfx(alien ? 'cheer' : 'aww');
          hold(s, api, api.say(alien ? 'airlock.alien' : 'airlock.human'));
        });
        if (now < s.deadline) return;
        if (!b.eject) return discuss(s, api, b.resume);
        return finish(s, api, b.suspects.every(id => isAlien(s, id)) ? 'caught' : 'framed', b.by);
      }
      case 'end': {
        const e = s.ending!, plan = endBeats(s.aliens.length);
        beats(s, api, [...plan.unmask, plan.banner, plan.scores], stage => {
          if (stage < plan.unmask.length) return api.sfx('glitch');
          if (stage === plan.unmask.length) {
            api.sfx(e.winner === 'crew' ? 'fanfare' : 'thunder'); api.sfx(e.winner === 'crew' ? 'cheer' : 'boo');
            return hold(s, api, api.say(e.how === 'arrived' ? 'airlock.earth' : variant('host.winner', api.random)));
          }
          api.sfx('score-up');
        });
        if (now >= s.deadline && s.stage > s.aliens.length + 1) s.done = true;
      }
    }
  },

  presence(s, id, connected) { if (Object.hasOwn(s.online, id)) s.online[id] = connected; },

  publicView(s) {
    const t = s.tests.at(-1), b = s.ballot;
    const pub: AirPublic = {
      phase: s.phase, turn: s.turn, at: s.at, deadline: s.deadline, test: s.tests.length, tests: TESTS, kinds: s.tests.map(x => x.pair.kind),
      aliens: s.aliens.length, done: [], pushes: Object.fromEntries(s.ids.map(id => [id, MAX_PUSHES - s.pushes[id]!])), scores: { ...s.scores },
    };
    if (t && s.phase === 'test') pub.done = s.ids.filter(id => own(t.answers, id) !== undefined);
    if (t && s.phase === 'discuss') pub.done = s.ids.filter(id => t.ready.includes(id));
    if (t && ['results', 'discuss', 'vote', 'verdict'].includes(s.phase)) pub.board = {
      kind: t.pair.kind, prompt: t.pair.crew, ...(t.pair.icons ? { icons: [...t.pair.icons] } : {}),
      answers: s.ids.map(id => { const value = own(t.answers, id); return value === undefined ? { player: id } : { player: id, value }; }),
    };
    if (b && s.phase === 'vote') { pub.ballot = { by: b.by, suspects: [...b.suspects] }; pub.done = s.ids.filter(id => !!own(b.votes, id)); }
    if (b && s.phase === 'verdict') pub.verdict = {
      by: b.by, suspects: [...b.suspects], eject: b.eject,
      votes: b.voters.map(id => { const vote = own(b.votes, id); return vote ? { player: id, vote } : { player: id, vote: 'abort' as const, auto: true as const }; }),
      ...(b.eject ? { roles: Object.fromEntries(b.suspects.map(id => [id, isAlien(s, id) ? 'alien' as const : 'crew' as const])) } : {}),
    };
    if (s.ending && s.phase === 'end') { const e = s.ending; Object.assign(pub, { end: { ...e, aliens: [...e.aliens], gains: { ...e.gains } }, prev: { ...s.prev } }); }
    return pub;
  },

  playerView(s, id) {
    const t = s.tests.at(-1), alien = isAlien(s, id);
    const me: AirPrivate = { turn: s.turn, role: alien ? 'alien' : 'crew', allies: alien ? s.aliens.filter(x => x !== id) : [], scan: alien ? !s.hacker : !s.scans.includes(id) };
    if (!t || s.phase === 'brief' || s.phase === 'end') return me;
    me.prompt = alien ? t.pair.alien : t.pair.crew;
    if (t.pair.icons) me.icons = [...t.pair.icons];
    if (alien && t.hacked) me.intercepted = t.pair.crew;
    if (!alien && t.scanned.includes(id)) me.verified = true;
    const answer = own(t.answers, id), vote = s.ballot && own(s.ballot.votes, id);
    if (answer !== undefined) me.answer = answer;
    if (t.ready.includes(id)) me.ready = true;
    if (vote && (s.phase === 'vote' || s.phase === 'verdict')) me.vote = vote;
    return me;
  },

  result(s): MiniResult | null {
    if (!s.done || !s.ending) return null;
    const e = s.ending, winners = s.ids.filter(id => isAlien(s, id) === (e.winner === 'aliens')), awards: { title: string; playerId: string }[] = [];
    if (e.by) awards.push({ title: e.winner === 'crew' ? 'Airlock Hero' : 'Master Framer', playerId: e.by });
    const most = Math.max(...s.ids.map(id => s.suspected[id]!)), usual = s.ids.filter(id => s.suspected[id] === most);
    if (most >= 2 && usual.length === 1) awards.push({ title: 'Most Suspicious', playerId: usual[0]! });
    const ghosts = s.aliens.filter(id => !s.suspected[id]);
    if (ghosts.length === 1 && e.winner === 'aliens') awards.push({ title: 'Perfect Disguise', playerId: ghosts[0]! });
    if (s.hacker) awards.push({ title: 'Sneaky Hacker', playerId: s.hacker });
    const headline = e.how === 'caught' ? (s.aliens.length > 1 ? 'Both aliens got spaced!' : 'The alien got spaced!')
      : e.how === 'framed' ? 'A human got spaced. Aliens win!' : 'The aliens reached Earth!';
    return { scores: { ...s.scores }, winners, headline, ...(awards.length ? { awards } : {}) };
  },
};
export default server;
