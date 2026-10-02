import assert from 'node:assert/strict';
import test from 'node:test';
import { createNight, type Night, type NightOptions } from './harness';
import { miniInfo } from '../src/minis/catalog';
import { LINES } from '../src/minis/ballpark/narration';
import { ADULT, FAMILY, QUESTIONS, WANTED, WANTED_ADULT, WANTED_FAMILY } from '../src/minis/ballpark/content.server';
import type { BallparkState } from '../src/minis/ballpark/server';
import { AIM_MS, BET_POINTS, LOCK_MS, REVEAL, TIERS, WANTED_POINTS, WANTED_SIZE, betCopy, possible, tierOf, wins, type BallparkPrivate, type BallparkPublic, type Phase } from '../src/minis/ballpark/types';

const pub = (n: Night) => n.mini<BallparkPublic>();
const me = (n: Night, id: string) => n.miniMe<BallparkPrivate>(id);
const inner = (n: Night) => n.state.mini!.state as BallparkState;
const agentOf = (n: Night) => pub(n).q!.agent;
const rejects = (result: { accepted: boolean; reason?: string }, pattern: RegExp) => { assert.equal(result.accepted, false); assert.match(result.reason!, pattern); };
const at = (n: Night, phase: Phase) => n.until(() => pub(n)?.phase === phase);
const send = (n: Night, id: string, a: Record<string, unknown>) => n.send(id, { turn: pub(n).turn, ...a });

function start(players: number, options: NightOptions = {}) {
  const n = createNight({ players, seed: 5, ...options });
  n.startMini('ballpark');
  return n;
}
/** Swaps the current question for an anonymous one (the deal is random). */
const anonymous = (n: Night) => { inner(n).cur!.q = QUESTIONS.find(q => !q.open && !q.adult)!; };
/** Survey: the listed seats say yes, every other seat says no. */
function survey(n: Night, yes: readonly string[], ids = n.ids) { for (const id of ids) send(n, id, { k: 'answer', yes: yes.includes(id) }); }
/** Survey (all yes unless listed), lock the agent's guess, open the bets. */
function toBets(n: Night, guess: number, yes: readonly string[] = n.ids) {
  survey(n, yes); at(n, 'guess');
  send(n, agentOf(n), { k: 'lock', value: guess }); at(n, 'bet');
}

test('content banks, narration budget and catalog entry', () => {
  assert.ok(FAMILY.length >= 180, `${FAMILY.length} family questions`);
  assert.ok(ADULT.length >= 40, `${ADULT.length} adult questions`);
  assert.ok(QUESTIONS.length >= 220);
  assert.ok(WANTED_FAMILY.length >= 30 && WANTED_ADULT.length >= 5);
  const texts = QUESTIONS.map(q => q.text.toLowerCase());
  assert.equal(new Set(texts).size, texts.length, 'questions are unique');
  assert.equal(new Set(QUESTIONS.map(q => q.id)).size, QUESTIONS.length, 'question ids are unique');
  assert.equal(new Set(WANTED.map(w => w.id)).size, WANTED.length, 'set ids are unique');
  for (const q of QUESTIONS) {
    assert.match(q.text, /\?”?$/, q.text);
    assert.ok(q.text.length <= 90, q.text);
    assert.equal(q.text, q.text.trim().replace(/\s+/g, ' '));
    assert.ok(!(q.open && q.adult), 'adult questions are never on the record');
  }
  assert.ok(QUESTIONS.filter(q => q.open).length >= 30, 'plenty of on-the-record questions');
  for (const w of WANTED) {
    assert.equal(w.items.length, WANTED_SIZE, w.title);
    assert.equal(new Set(w.items).size, WANTED_SIZE, w.title);
    for (const item of w.items) assert.ok(item.length <= 56, item);
  }
  const total = Object.values(LINES).reduce((sum, line) => sum + line.length, 0);
  assert.ok(total <= 250, `narration is ${total} characters`);
  for (const id of Object.keys(LINES)) assert.match(id, /^ballpark\.[a-z0-9.-]+$/);
  for (const line of miniInfo('ballpark')!.intro) assert.ok(Object.hasOwn(LINES, line), line);
});

test('pure rules: agent tiers, bets, possible bets and copy', () => {
  for (const [miss, points] of [[0, 1000], [3, 1000], [4, 750], [7, 750], [8, 500], [12, 500], [13, 250], [20, 250], [21, 0], [80, 0]] as const) {
    const tier = tierOf(50, 50 + miss);
    assert.equal(tier >= 0 ? TIERS[tier]!.points : 0, points, `miss ${miss}`);
    assert.equal(tierOf(50 + miss, 50), tier, 'symmetric');
  }
  assert.ok(wins('higher', 40, 41) && !wins('higher', 40, 40) && !wins('lower', 40, 40), 'exactly on the guess loses both ways');
  assert.ok(wins('much-higher', 40, 56) && !wins('much-higher', 40, 55), 'much means more than 15 away');
  assert.ok(wins('much-lower', 40, 24) && !wins('much-lower', 40, 25));
  assert.ok(wins('higher', 40, 90), 'a plain bet still wins on a big miss');
  assert.ok(!possible('lower', 0) && !possible('higher', 100) && !possible('much-lower', 15) && possible('much-lower', 16) && !possible('much-higher', 85) && possible('much-higher', 84));
  assert.deepEqual(betCopy('much-higher', 40), { label: 'Much higher', range: '56% or more' });
});

test('full games with bots: 3, 6 and 10 players; every player is the agent once per round', async () => {
  for (const players of [3, 6, 10]) {
    const n = start(players, { seed: players }), begin = n.now, agents: string[][] = [[], []];
    let last = '';
    const watch = () => { const v = pub(n); if (v?.q && v.phase === 'survey' && v.turn !== last) { last = v.turn; agents[v.round - 1]!.push(v.q.agent); } };
    const bot = await import('../src/minis/ballpark/bot').then(m => m.bot);
    const tracked: typeof bot = input => { watch(); return bot(input); };
    const { result, rejected } = n.runMini(tracked);
    assert.deepEqual(rejected, [], `${players}p bots were never rejected`);
    assert.deepEqual([...agents[0]!].sort(), [...n.ids].sort(), 'round 1: everyone once');
    if (players <= 6) assert.deepEqual([...agents[1]!].sort(), [...n.ids].sort(), 'round 2: everyone again');
    else assert.equal(agents[1]!.length, 3, 'round 2: three questions with seven or more');
    assert.deepEqual(Object.keys(result.scores).sort(), [...n.ids].sort());
    for (const score of Object.values(result.scores)) assert.ok(score >= 0 && score % 50 === 0, `${score}`);
    const top = Math.max(...Object.values(result.scores));
    assert.deepEqual(result.winners, n.ids.filter(id => result.scores[id] === top));
    assert.match(result.headline!, /^This room said yes \d+% of the time\.$/);
    assert.ok(n.now - begin < 15 * 60_000, 'fits the time budget even with bots');
    n.toMenu(); assert.equal(n.state.phase, 'menu');
  }
});

test('round 2 with seven or more players: the three lowest connected scorers take the dial', () => {
  for (const offline of [false, true]) {
    const n = start(7);
    n.until(() => pub(n).phase === 'scores');
    const s = inner(n);
    s.ids.forEach((id, i) => { s.scores[id] = [900, 100, 500, 0, 700, 300, 200][i]!; });
    if (offline) n.connect('p3', false);
    n.until(() => pub(n).round === 2 && pub(n).phase === 'survey');
    assert.equal(pub(n).q!.count, 3, 'still three questions');
    assert.deepEqual([agentOf(n), ...inner(n).queue], offline ? ['p1', 'p6', 'p5'] : ['p3', 'p1', 'p6'], 'lowest first');
  }
});

test('scoring: agent tiers, bettors, much bets in round 2 and a dead-on guess', () => {
  const n = start(4), agent = agentOf(n), [b1, b2, b3] = n.ids.filter(id => id !== agent);
  anonymous(n);
  toBets(n, 72, n.ids.filter(id => id !== b3)); // 3 of 4 say yes: 75%
  rejects(n.trySend(b1!, { turn: pub(n).turn, k: 'bet', bet: 'much-higher' }), /round 2/);
  send(n, b1!, { k: 'bet', bet: 'higher' }); send(n, b2!, { k: 'bet', bet: 'lower' });
  at(n, 'reveal');
  let r = pub(n).result!;
  assert.deepEqual([r.truth, r.guess, r.yes, r.no, r.tier], [75, 72, 3, 1, 0]);
  assert.deepEqual(r.gains, { [agent]: 1000, [b1!]: 500, [b2!]: 0 }, 'no bet, no entry');
  assert.equal(pub(n).scores[agent], 1000);
  assert.equal(r.yesIds, undefined, 'anonymous by default');

  // A dead-on guess: every bet loses.
  n.until(() => pub(n).phase === 'survey');
  const a2 = agentOf(n), others = n.ids.filter(id => id !== a2);
  toBets(n, 50, [a2, others[0]!]);
  for (const id of others) send(n, id, { k: 'bet', bet: id === others[0] ? 'higher' : 'lower' });
  at(n, 'reveal');
  r = pub(n).result!;
  assert.equal(r.truth, 50); assert.equal(r.gains[a2], 1000);
  for (const id of others) assert.equal(r.gains[id], 0);

  // Round 2: long shots pay double; a plain bet on the same side still pays 500.
  n.until(() => pub(n).round === 2 && pub(n).phase === 'survey');
  const a3 = agentOf(n), [c1, c2, c3] = n.ids.filter(id => id !== a3);
  toBets(n, 10, n.ids.slice(0, 2)); // 50%: 40 above the guess
  rejects(n.trySend(c1!, { turn: pub(n).turn, k: 'bet', bet: 'much-lower' }), /can’t win/);
  send(n, c2!, { k: 'bet', bet: 'much-higher' }); send(n, c3!, { k: 'bet', bet: 'higher' });
  at(n, 'reveal');
  r = pub(n).result!;
  assert.equal(r.gains[a3], 0, 'way off');
  assert.equal(r.gains[c2!], BET_POINTS.much); assert.equal(r.gains[c3!], BET_POINTS.plain);
});

test('missing input: no answers make a house number, an untouched dial defaults to 50, a moved dial is kept', () => {
  const n = start(3, { settings: { timers: 'speedy' } });
  assert.equal(pub(n).phase, 'survey');
  at(n, 'guess');
  assert.equal(pub(n).q!.respondents, 0);
  at(n, 'bet');
  assert.equal(pub(n).q!.dial, 50, 'untouched dial locks at 50');
  at(n, 'reveal');
  const r = pub(n).result!;
  assert.equal(r.house, true); assert.equal(r.auto, true); assert.deepEqual([r.yes, r.no], [0, 0]);
  assert.ok(r.truth >= 0 && r.truth <= 100);
  assert.deepEqual(Object.keys(r.gains), [agentOf(n)], 'missing bets score nothing');

  n.until(() => pub(n).phase === 'guess');
  n.advance(AIM_MS);
  send(n, agentOf(n), { k: 'aim', value: 37 });
  n.until(() => pub(n).phase === 'bet');
  assert.equal(pub(n).q!.dial, 37);
  n.until(() => pub(n).phase === 'reveal');
  assert.equal(pub(n).result!.auto, undefined);

  // A lone answer would expose its author: the lab makes up the number and shows no counts or names.
  n.until(() => pub(n).phase === 'survey');
  inner(n).cur!.q = QUESTIONS.find(q => q.open)!;
  send(n, 'p1', { k: 'answer', yes: true });
  n.until(() => pub(n).phase === 'reveal');
  const lone = pub(n).result!;
  assert.equal(lone.house, true); assert.deepEqual([lone.yes, lone.no, lone.yesIds, lone.noIds], [0, 0, undefined, undefined]);
});

test('disconnects: offline agents wait their turn, an agent who drops auto-locks, nobody waits for the absent', () => {
  const n = start(5), first = agentOf(n), waiting = inner(n).queue[0]!;
  n.connect(waiting, false);
  survey(n, [], n.ids.filter(id => id !== waiting));
  n.advance(MIN_READ());
  assert.equal(pub(n).phase, 'guess', 'the offline player was not waited for');
  send(n, first, { k: 'lock', value: 30 });
  n.advance(LOCK_MS + 100);
  assert.equal(pub(n).phase, 'bet');
  for (const id of n.ids) if (id !== first && id !== waiting) send(n, id, { k: 'bet', bet: 'lower' });
  n.advance(1300);
  assert.equal(pub(n).phase, 'reveal', 'bets close without the offline player');
  n.until(() => pub(n).phase === 'survey');
  assert.notEqual(agentOf(n), waiting, 'the offline agent is skipped for now');
  assert.ok(inner(n).queue.includes(waiting), '…but keeps their turn');
  const dropper = agentOf(n);
  survey(n, n.ids); at(n, 'guess');
  n.connect(dropper, false);
  n.advance(MIN_READ() + 200);
  assert.equal(pub(n).q!.locked, true, 'the dropped agent auto-locked');
  n.connect(dropper, true);
  assert.equal(me(n, dropper).turn, pub(n).turn);

  // Everyone drops at once: phases wait for their buzzers instead of racing ahead.
  n.until(() => pub(n).phase === 'survey');
  const { turn, deadline } = pub(n);
  for (const id of n.ids) n.connect(id, false);
  n.advance(deadline - n.now - 100);
  assert.equal(pub(n).turn, turn, 'the survey waits for its buzzer');
});
const MIN_READ = () => 1600;

test('validation: stale turns, phases, roles, duplicates, values and strict fields', () => {
  const n = start(4), turn = pub(n).turn, agent = agentOf(n), bettor = n.ids.find(id => id !== agent)!;
  rejects(n.trySend('p0', { turn: 'old', k: 'answer', yes: true }), /moved on/);
  rejects(n.trySend('p0', { turn, k: 'answer', yes: 'yes' }), /on or off/);
  rejects(n.trySend('p0', { turn, k: 'answer', yes: true, extra: 1 }), /Unknown field/);
  rejects(n.trySend('p0', { turn, k: 'dance' }), /Unknown move/);
  rejects(n.trySend(agent, { turn, k: 'lock', value: 40 }), /not live/);
  rejects(n.trySend(bettor, { turn, k: 'bet', bet: 'higher' }), /closed/);
  n.send('p0', { turn, k: 'answer', yes: true });
  rejects(n.trySend('p0', { turn, k: 'answer', yes: false }), /already in/);
  survey(n, n.ids, n.ids.filter(id => id !== 'p0'));
  at(n, 'guess');
  const guess = pub(n).turn;
  rejects(n.trySend(bettor, { turn: guess, k: 'aim', value: 40 }), /Only the agent/);
  rejects(n.trySend(agent, { turn: guess, k: 'aim', value: 101 }), /0 to 100/);
  rejects(n.trySend(agent, { turn: guess, k: 'aim', value: 4.5 }), /whole number/);
  n.advance(AIM_MS);
  n.send(agent, { turn: guess, k: 'aim', value: 40 });
  n.send(agent, { turn: guess, k: 'aim', value: 90 });
  assert.equal(pub(n).q!.dial, 40, 'updates faster than the throttle are ignored, not rejected');
  n.advance(AIM_MS);
  n.send(agent, { turn: guess, k: 'aim', value: 0 });
  assert.equal(pub(n).q!.dial, 0);
  n.send(agent, { turn: guess, k: 'lock', value: 0 });
  rejects(n.trySend(agent, { turn: guess, k: 'aim', value: 5 }), /already locked/);
  rejects(n.trySend(agent, { turn: guess, k: 'lock', value: 5 }), /already locked/);
  at(n, 'bet');
  const bet = pub(n).turn;
  rejects(n.trySend(agent, { turn: bet, k: 'bet', bet: 'higher' }), /no betting on yourself/);
  rejects(n.trySend(bettor, { turn: bet, k: 'bet', bet: 'lower' }), /can’t win/);
  rejects(n.trySend(bettor, { turn: bet, k: 'bet', bet: 'sideways' }), /higher or lower/);
  n.send(bettor, { turn: bet, k: 'bet', bet: 'higher' });
  rejects(n.trySend(bettor, { turn: bet, k: 'bet', bet: 'higher' }), /already in/);
  assert.equal(me(n, bettor).bet, 'higher'); assert.equal(me(n, agent).role, 'agent'); assert.equal(me(n, bettor).role, 'bettor');
  at(n, 'reveal');
  rejects(n.trySend(bettor, { turn: bet, k: 'bet', bet: 'higher' }), /moved on/);
});

test('privacy: survey answers and ticks never leak; on-the-record questions name names', () => {
  const n = start(4), agent = agentOf(n);
  anonymous(n);
  n.send('p1', { turn: pub(n).turn, k: 'answer', yes: true });
  n.send('p2', { turn: pub(n).turn, k: 'answer', yes: false });
  assert.deepEqual(pub(n).done, ['p1', 'p2'], 'who answered, never what');
  assert.equal(me(n, 'p1').answer, 'yes'); assert.equal(me(n, 'p2').answer, 'no');
  for (const id of ['p0', 'p3']) assert.equal(me(n, id).answer, undefined, `${id} sees nobody else’s answer`);
  const leaks = (json: string) => /"answers"|"yesIds"|"noIds"|"p1":\s*true/.test(json);
  assert.ok(!leaks(JSON.stringify(n.view())));
  for (const id of n.ids) assert.ok(!leaks(JSON.stringify(n.me(id))));
  survey(n, ['p1'], ['p0', 'p3']);
  for (const phase of ['guess', 'bet', 'reveal'] as const) { at(n, phase); assert.ok(!leaks(JSON.stringify(n.view())), phase); }
  assert.deepEqual([pub(n).result!.yes, pub(n).result!.no], [1, 3]);
  assert.ok(agent);

  // An on-the-record question shows who said what.
  const open = createNight({ players: 3, seed: 2 });
  open.startMini('ballpark');
  const s = inner(open), q = QUESTIONS.find(x => x.open)!;
  s.cur!.q = q;
  survey(open, ['p0']); at(open, 'guess'); open.send(agentOf(open), { turn: pub(open).turn, k: 'lock', value: 33 }); at(open, 'reveal');
  assert.equal(pub(open).q!.open, true);
  assert.deepEqual(pub(open).result!.yesIds, ['p0']); assert.deepEqual(pub(open).result!.noIds, ['p1', 'p2']);

  // Most Wanted ticks: counts only, and only at the reveal.
  const w = start(3);
  w.until(() => pub(w).phase === 'tick');
  w.send('p0', { turn: pub(w).turn, k: 'ticks', ticks: [0, 4, 8] });
  assert.deepEqual(me(w, 'p0').ticks, [0, 4, 8]);
  for (const id of ['p1', 'p2']) assert.equal(me(w, id).ticks, undefined);
  assert.ok(!JSON.stringify(w.view()).includes('ticks'));
});

test('Most Wanted: tick any, pick exactly three, ranks pay 1000 / 700 / 500 with competition ties', () => {
  const n = start(4);
  n.until(() => pub(n).phase === 'tick');
  assert.equal(pub(n).round, 3); assert.equal(pub(n).wanted!.items.length, WANTED_SIZE);
  const turn = pub(n).turn;
  rejects(n.trySend('p0', { turn, k: 'ticks', ticks: [1, 1] }), /only once/);
  rejects(n.trySend('p0', { turn, k: 'ticks', ticks: [9] }), /0 to 8/);
  rejects(n.trySend('p0', { turn, k: 'picks', picks: [0, 1, 2] }), /closed/);
  // Counts: item 0 ×4, items 1 and 2 ×3 (tied 2nd), item 3 ×1 (4th), the rest 0.
  n.send('p0', { turn, k: 'ticks', ticks: [0, 1, 2, 3] });
  n.send('p1', { turn, k: 'ticks', ticks: [0, 1, 2] });
  n.send('p2', { turn, k: 'ticks', ticks: [0, 1, 2] });
  n.send('p3', { turn, k: 'ticks', ticks: [0] });
  rejects(n.trySend('p3', { turn, k: 'ticks', ticks: [] }), /already filed/);
  n.advance(1600);
  assert.equal(pub(n).phase, 'pick');
  const pick = pub(n).turn, before = { ...pub(n).scores };
  rejects(n.trySend('p0', { turn: pick, k: 'picks', picks: [0, 1] }), /exactly 3/);
  n.send('p0', { turn: pick, k: 'picks', picks: [0, 1, 2] });
  n.send('p1', { turn: pick, k: 'picks', picks: [3, 4, 5] });
  n.send('p2', { turn: pick, k: 'picks', picks: [2, 0, 8] });
  n.connect('p3', false);
  n.advance(1600);
  assert.equal(pub(n).phase, 'wanted');
  const r = pub(n).wanted!.result!;
  assert.deepEqual(r.counts, [4, 3, 3, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(r.ranks, [1, 2, 2, 4, 0, 0, 0, 0, 0]);
  assert.equal(r.filed, 4);
  assert.deepEqual(r.order.slice(-3), [2, 1, 0], 'the most ticked is revealed last');
  assert.deepEqual(r.gains, { p0: 1000 + 700 + 700, p1: 0, p2: 700 + 1000 });
  assert.equal(pub(n).scores.p0, before.p0! + 2400);
  n.until(() => n.state.phase === 'podium');
  assert.ok(n.state.podium!.result.awards?.some(a => a.title === 'Most Wanted hunter' && a.playerId === 'p0'));
  assert.equal(WANTED_POINTS.length, 3);
});

test('ties: equal top scores share the win', () => {
  const n = start(3);
  n.until(() => pub(n).phase === 'wanted');
  const s = inner(n);
  for (const id of s.ids) s.scores[id] = id === 'p2' ? 100 : 2000;
  n.until(() => n.state.phase === 'podium');
  assert.deepEqual(n.state.podium!.result.winners, ['p0', 'p1']);
});

test('family filter and night memory: adult content only with family off; replays deal fresh questions', async () => {
  const adult = new Set(QUESTIONS.filter(q => q.adult).map(q => q.id)), adultSets = new Set(WANTED.filter(w => w.adult).map(w => w.id));
  let seen = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const family = start(10, { seed }), s = inner(family);
    assert.ok([s.cur!.q, ...s.deck].every(q => !adult.has(q.id)), `seed ${seed}`);
    assert.ok(s.sets.every(w => !adultSets.has(w.id)));
    const open = start(10, { seed, settings: { family: false } });
    seen += inner(open).deck.slice(0, 20).filter(q => adult.has(q.id)).length;
  }
  assert.ok(seen > 0, 'adult questions are in the pool with family mode off');

  const n = start(3, { seed: 9 }), asked = new Set<string>();
  const note = () => { const c = inner(n).cur; if (c && n.state.phase === 'mini') asked.add(c.q.id); };
  const bot = await import('../src/minis/ballpark/bot').then(m => m.bot);
  n.runMini(input => { note(); return bot(input); });
  const firstSet = n.state.used.ballpark!.find(k => k.startsWith('w'));
  n.startMini('ballpark');
  const s = inner(n);
  assert.ok(!asked.has(s.cur!.q.id) && s.deck.slice(0, 10).every(q => !asked.has(q.id)), 'second game starts with unused questions');
  assert.notEqual(s.sets[0]!.id, firstSet);
  assert.ok(n.state.used.ballpark!.length >= asked.size + 1);
});

test('reveal timing is server-paced and the phone throttle constant matches the server', () => {
  const n = start(3);
  toBets(n, 40);
  at(n, 'reveal');
  const begin = pub(n).at;
  n.until(() => pub(n).phase !== 'reveal');
  assert.ok(n.now - begin >= REVEAL.end, 'the reveal plays its full choreography');
  assert.ok(AIM_MS >= 250, 'at most four dial updates a second');
});
