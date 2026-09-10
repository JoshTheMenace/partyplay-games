import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rules, type State } from '../src/server';
import { questions } from '../src/content.server';
import { manifest } from '../src/manifest';
import type { Action, Family } from '../src/types';
const viewContext = { nowMs: 0, phase: 'playing' as const };
function create(count = 2, seed = 42) {
  return rules.create({ roomId: 'room', roundId: 'round', seed, nowMs: 1000, players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, color: '#28c6e7' })) }, rules.validateSettings({}));
}
const view = (s: State) => rules.publicView(s, viewContext);
const next = (s: State) => rules.tick(s, new Map(), 0, s.deadline);
const answer = (s: State, choice: number): Action => ({ kind: 'answer', turnId: view(s).turnId, choice });
const rescue = (s: State, value: number | number[]): Action => ({ kind: 'rescue', turnId: view(s).turnId, value });
function toRescue(family: Family, count = 2) {
  const s = create(count); s.families = [family, family, family];
  next(s); next(s); next(s); next(s);
  assert.equal(s.phase, 'rescue');
  return s;
}
function solve(s: State, id: string) {
  if (s.phase === 'quiz' || s.phase === 'finale') rules.applyAction(s, id, answer(s, s.deck[s.phase === 'quiz' ? s.round - 1 : 8 + s.finaleStep - 1].correct), s.started);
  if (s.phase === 'rescue') rules.applyAction(s, id, rescue(s, s.challenge!.solution), s.started);
}
for (const count of [2, 3, 10]) test(`${count} players finish the full quiz/rescue/finale loop with every participant ranked`, () => {
  const s = create(count), phases = new Set(), families = new Set();
  let transitions = 0;
  while (s.phase !== 'results') {
    phases.add(s.phase); if (s.challenge) families.add(s.challenge.family);
    for (const p of s.players) solve(s, p.id);
    next(s); assert.ok(++transitions < 100);
  }
  const result = rules.outcome(s);
  assert.equal(result.complete, true); assert.equal(result.rows.length, count);
  assert.deepEqual(result.winners, s.players.map(p => p.id));
  assert.ok(result.rows.every(r => r.rank === 1 && r.score === 16));
  assert.equal(families.size, 3); assert.equal(phases.size, 9);
  assert.equal(s.started - 1000, 758000);
});
test('settings, player counts and identity validation are strict', () => {
  assert.deepEqual(rules.validateSettings({}), { rounds: 8 });
  for (const raw of [null, [], { rounds: 1 }, { surprise: true }]) assert.throws(() => rules.validateSettings(raw));
  assert.throws(() => create(1)); assert.throws(() => create(11));
  assert.equal(manifest.players.max, 10); assert.deepEqual(manifest.modes, ['shared-display']);
  assert.throws(() => rules.create({ roomId: 'r', roundId: 'r', seed: 1, nowMs: 0, players: [{ id: 'a', name: 'A', color: '' }, { id: 'a', name: 'A', color: '' }] }, { rounds: 8 }));
});
test('the same seed and inputs reproduce state; different seeds vary content', () => {
  const a = create(), b = create();
  for (let i = 0; i < 10; i++) { next(a); next(b); }
  assert.deepEqual(a, b);
  assert.notDeepEqual(create(2, 7).deck, create(2, 8).deck);
  assert.equal(new Set(a.deck.map(q => q.id)).size, 14);
});
test('strict parsing rejects unknown fields, bounds, NaN, oversized sequences and wrong kinds', () => {
  for (const bad of [null, [], {}, { kind: 'other', turnId: 'x' }, { kind: 'answer', turnId: '', choice: 0 }, ...[-1, 4, NaN, Infinity, 1.5, '1'].map(choice => ({ kind: 'answer', turnId: 'x', choice })), { kind: 'answer', turnId: 'x', choice: 0, score: 100 }, ...[-1, 1000, NaN, [], [0, 1, 2], [0, 0, 0, 0, 0, 0], [0, 0, 0, 4]].map(value => ({ kind: 'rescue', turnId: 'x', value }))]) assert.throws(() => rules.parseAction(bad));
  assert.equal(rules.parseInput(null), null); assert.throws(() => rules.parseInput({}));
});
test('phase, identity, duplicate, obsolete and exact-deadline actions cannot change state', () => {
  const s = create(); assert.throws(() => rules.applyAction(s, 'p0', answer(s, 0), s.started));
  next(s); const first = answer(s, 0);
  assert.throws(() => rules.applyAction(s, 'spectator', first, s.started));
  assert.throws(() => rules.applyAction(s, 'p0', rescue(s, 0), s.started));
  rules.applyAction(s, 'p0', first, s.deadline - 1);
  const snapshot = structuredClone(s);
  assert.throws(() => rules.applyAction(s, 'p0', answer(s, 1), s.deadline - 1));
  assert.throws(() => rules.applyAction(s, 'p1', first, s.deadline));
  assert.deepEqual(s, snapshot);
  next(s); assert.equal(s.phase, 'quiz-reveal');
  assert.throws(() => rules.applyAction(s, 'p1', first, s.started));
});
test('an answer just before the deadline scores once, without a speed bonus', () => {
  const s = create(); next(s);
  rules.applyAction(s, 'p0', answer(s, s.deck[0].correct), s.started);
  rules.applyAction(s, 'p1', answer(s, s.deck[0].correct), s.deadline - 1);
  next(s); assert.deepEqual(s.players.map(p => p.charge), [3, 3]);
  rules.tick(s, new Map(), 0, s.started + 1); assert.deepEqual(s.players.map(p => p.charge), [3, 3]);
});
test('every wrong answer puts all players into rescue without elimination', () => {
  const s = create(10); next(s);
  for (const p of s.players) rules.applyAction(s, p.id, answer(s, (s.deck[0].correct + 1) % 4), s.started);
  next(s); assert.ok(s.players.every(p => p.needsRescue && p.charge === 0));
  next(s); next(s); for (const p of s.players) solve(s, p.id);
  next(s); assert.ok(s.players.every(p => p.charge === 2));
});
for (const family of ['memory', 'estimate', 'logic'] as const) test(`${family} rescue is solvable, and successful support earns less than rescue`, () => {
  const s = toRescue(family); s.players[1].needsRescue = false;
  for (const p of s.players) solve(s, p.id);
  next(s); assert.deepEqual(s.players.map(p => p.gained), [2, 1]);
  assert.ok(view(s).reveal?.answer);
});
test('closest-number ties award every equal closest guess; absent submissions cannot win', () => {
  const s = toRescue('estimate', 3), target = s.challenge!.solution as number;
  rules.applyAction(s, 'p0', rescue(s, target - 2), s.started);
  rules.applyAction(s, 'p1', rescue(s, target + 2), s.started);
  next(s); assert.deepEqual(s.players.map(p => p.gained), [2, 2, 0]);
});
test('wrong memory and logic submissions earn zero and cannot be replaced', () => {
  for (const family of ['memory', 'logic'] as const) {
    const s = toRescue(family), target = s.challenge!.solution;
    const wrong = Array.isArray(target) ? target.map(n => (n + 1) % 4) : (target + 1) % 4;
    rules.applyAction(s, 'p0', rescue(s, wrong), s.started);
    assert.throws(() => solve(s, 'p0')); next(s); assert.equal(s.players[0].gained, 0);
  }
});
test('rescue payloads must match their active family', () => {
  for (const family of ['memory', 'estimate', 'logic'] as const) {
    const s = toRescue(family);
    assert.throws(() => rules.applyAction(s, 'p0', rescue(s, family === 'memory' ? 0 : [0, 0, 0, 0]), s.started));
    if (family === 'logic') assert.throws(() => rules.applyAction(s, 'p0', rescue(s, 5), s.started));
  }
});
test('all disconnected players still reach results and remain in the outcome', () => {
  const s = create(10);
  for (const p of s.players) rules.onPresenceChange(s, p.id, false, s.started);
  let ticks = 0; while (s.phase !== 'results') { next(s); assert.ok(++ticks < 100); }
  assert.equal(rules.outcome(s).rows.length, 10); assert.equal(rules.outcome(s).winners.length, 10);
  assert.ok(s.players.every(p => p.charge === 0 && p.distance === 0));
});
test('reconnect preserves only the reconnecting player’s locked answer', () => {
  const s = create(); next(s); rules.applyAction(s, 'p0', answer(s, 2), s.started);
  rules.onPresenceChange(s, 'p0', false, s.started);
  assert.throws(() => rules.applyAction(s, 'p0', answer(s, 1), s.started));
  rules.onPresenceChange(s, 'p0', true, s.started);
  assert.equal(rules.playerView(s, 'p0', viewContext).answer, 2);
  assert.equal(rules.playerView(s, 'p1', viewContext).answer, null);
  assert.throws(() => rules.playerView(s, 'watching-host', viewContext));
  assert.throws(() => rules.applyAction(s, 'p0', answer(s, 1), s.started));
});
test('answer keys, bank, seed and future challenges never appear in serialized recipient snapshots', () => {
  const s = create(3); next(s);
  const packet = JSON.stringify({ publicView: view(s), privateView: rules.playerView(s, 'p0', viewContext) });
  for (const secret of ['"correct"', '"solution"', '"deck"', '"rng"', s.deck[1].prompt, s.deck[0].explanation, s.deck[0].source]) assert.ok(!packet.includes(secret), secret);
  assert.equal(view(s).challenge, null); assert.equal(view(s).reveal, null);
  next(s); assert.equal(view(s).reveal!.answer, s.deck[0].options[s.deck[0].correct]);
});
test('memory is intentionally revealed only during briefing, then omitted from all projections', () => {
  const s = create(); s.families = ['memory', 'logic', 'estimate']; next(s); next(s); next(s);
  assert.deepEqual(view(s).challenge!.sequence, s.challenge!.solution);
  next(s); assert.equal(view(s).challenge!.sequence, null);
  assert.ok(!JSON.stringify(view(s)).includes('solution'));
  assert.equal(rules.playerView(s, 'p0', viewContext).answer, null);
});
test('projections and incoming memory arrays cannot mutate authoritative state', () => {
  const s = toRescue('memory'), value = [...s.challenge!.solution as number[]];
  rules.applyAction(s, 'p0', rescue(s, value), s.started); value[0] = 99;
  const own = rules.playerView(s, 'p0', viewContext); (own.answer as number[])[0] = 88;
  const publicView = view(s); publicView.players[0].charge = 500; publicView.challenge!.options[0] = 'changed';
  assert.notEqual((s.players[0].answer as number[])[0], 99); assert.notEqual((s.players[0].answer as number[])[0], 88);
  assert.equal(s.players[0].charge, 0); assert.equal(s.challenge!.options[0], 'Sun');
});
test('finale boosts are fixed at question start and a zero-charge player can win', () => {
  const s = create(); while (s.phase !== 'finale-intro') next(s);
  s.players[0].distance = 4; s.players[1].distance = 0;
  next(s); assert.deepEqual(s.players.map(p => p.boost), [false, true]);
  for (let step = 0; step < 6; step++) { solve(s, 'p1'); next(s); next(s); }
  assert.equal(s.phase, 'results'); assert.deepEqual(rules.outcome(s).winners, ['p1']);
  assert.equal(s.players[1].charge, 0); assert.equal(s.players[1].distance, 14);
});
test('finale tied distance shares rank even with different charge; every rank is deterministic', () => {
  const s = create(3); while (s.phase !== 'results') next(s);
  s.players[0].distance = 9; s.players[1].distance = 9; s.players[2].distance = 4; s.players[1].charge = 20;
  const result = rules.outcome(s); assert.deepEqual(result.winners, ['p0', 'p1']);
  assert.deepEqual(result.rows.map(r => r.rank), [1, 1, 3]); assert.deepEqual(result, rules.outcome(s));
});
test('late ticks open one complete phase, while invalid clocks are rejected', () => {
  const s = create(); rules.tick(s, new Map(), 0, s.deadline + 999999);
  assert.equal(s.phase, 'quiz'); assert.equal(s.deadline - s.started, 30000);
  assert.throws(() => rules.tick(s, new Map(), 0, NaN));
  assert.throws(() => rules.applyAction(s, 'p0', answer(s, 0), s.started - 1));
});
test('the bank has 60 original, attributed, unambiguous four-option questions', () => {
  assert.equal(questions.length, 60); assert.equal(new Set(questions.map(q => q.id)).size, 60);
  assert.equal(new Set(questions.map(q => q.prompt)).size, 60);
  assert.equal(new Set(questions.map(q => q.category)).size, 6);
  for (const q of questions) { assert.equal(q.options.length, 4); assert.equal(new Set(q.options).size, 4); assert.ok(q.explanation.length > 8); assert.ok(q.source.startsWith('https://')); assert.ok(q.options[q.correct]); }
});
test('client and manifest runtime imports cannot reach the answer bank', () => {
  for (const file of ['client.tsx', 'manifest.ts', 'types.ts']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.ok(!/from ['"].*(?:content\.server|\/server)['"]/.test(source));
  }
  const source = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  assert.ok(!/Math\.random|Date\.now/.test(source));
});
test('every phase honors its full deadline and accepts actions only during answer phases', () => {
  const s = create(); let count = 0;
  while (s.phase !== 'results') {
    const phase = s.phase, deadline = s.deadline;
    rules.tick(s, new Map(), 0, deadline - 1); assert.equal(s.phase, phase);
    const action = phase === 'rescue' ? rescue(s, s.challenge!.solution) : answer(s, 0);
    if (!['quiz', 'rescue', 'finale'].includes(phase)) assert.throws(() => rules.applyAction(s, 'p0', action, deadline - 1));
    assert.throws(() => rules.applyAction(s, 'p0', action, deadline));
    next(s); assert.notEqual(s.phase, phase); assert.ok(++count < 100);
  }
  const done = structuredClone(s); rules.tick(s, new Map(), 0, s.lastNow);
  assert.deepEqual(s, done); assert.throws(() => rules.applyAction(s, 'p0', answer(s, 0), s.started));
});
test('later memory rounds require five symbols and reject incomplete sequences', () => {
  const s = create(); s.families = ['memory', 'memory', 'memory'];
  while (!(s.phase === 'rescue' && s.round === 5)) next(s);
  assert.equal((s.challenge!.solution as number[]).length, 5);
  assert.throws(() => rules.applyAction(s, 'p0', rescue(s, [0, 0, 0, 0]), s.started));
  solve(s, 'p0'); next(s); assert.equal(s.players[0].gained, 2);
});
test('generated logic has one valid valve and estimates stay inside submission bounds across seeds', () => {
  for (let seed = 0; seed < 100; seed++) {
    for (const family of ['logic', 'estimate'] as const) {
      const s = create(2, seed); s.families = [family, family, family]; next(s); next(s); next(s);
      const c = s.challenge!;
      if (family === 'logic') {
        const [low, high] = [...c.prompt.matchAll(/(?:greater than|less than) (\d+)/g)].map(match => Number(match[1]));
        const valid = c.options.map(Number).filter(n => n % 2 === 0 && n > low && n < high);
        assert.equal(valid.length, 1); assert.equal(Number(c.options[c.solution as number]), valid[0]);
      } else assert.ok((c.solution as number) >= 0 && (c.solution as number) <= 999);
    }
  }
});
test('all phase snapshots exclude unrevealed future questions and challenge solutions', () => {
  const s = create(3);
  while (s.phase !== 'results') {
    const v = view(s), current = s.phase.startsWith('finale') ? 8 + Math.max(0, s.finaleStep - 1) : s.round - 1;
    for (const p of s.players) {
      const packet = JSON.stringify({ publicView: v, privateView: rules.playerView(s, p.id, viewContext) });
      for (const q of s.deck.slice(current + 1)) assert.ok(!packet.includes(q.prompt));
      for (const key of ['"solution":', '"correct":', '"deck":', '"rng":', '"families":']) assert.ok(!packet.includes(key));
    }
    next(s);
  }
});
for (const phase of ['quiz', 'rescue', 'finale'] as const) test(`${phase} ends early only after all submissions and six seconds; its reveal keeps full reading time`, () => {
  const s = create(3); while (s.phase !== phase) next(s);
  const stale = phase === 'rescue' ? rescue(s, s.challenge!.solution) : answer(s, 0);
  for (const p of s.players) solve(s, p.id);
  rules.tick(s, new Map(), 0, s.started + 5999); assert.equal(s.phase, phase);
  const opening = s.started;
  rules.tick(s, new Map(), 0, opening + 6000); assert.equal(s.phase, `${phase}-reveal`);
  const gained = s.players.map(p => p.gained);
  assert.throws(() => rules.applyAction(s, 'p0', stale, s.started));
  rules.tick(s, new Map(), 0, s.deadline - 1); assert.equal(s.phase, `${phase}-reveal`);
  assert.deepEqual(s.players.map(p => p.gained), gained);
});
test('a disconnected non-submitter keeps their reconnect opportunity until the full deadline', () => {
  const s = create(3); next(s); solve(s, 'p0'); solve(s, 'p1');
  rules.onPresenceChange(s, 'p2', false, s.started);
  rules.tick(s, new Map(), 0, s.started + 6000); assert.equal(s.phase, 'quiz');
  rules.onPresenceChange(s, 'p2', true, s.lastNow); solveAtCurrentTime();
  function solveAtCurrentTime() { rules.applyAction(s, 'p2', answer(s, s.deck[0].correct), s.lastNow); }
  rules.tick(s, new Map(), 0, s.lastNow); assert.equal(s.phase, 'quiz-reveal');
  assert.ok(s.players.every(p => p.charge === 3));
});
test('a quick complete match preserves every briefing and reveal and reaches identical tied results', () => {
  const s = create(3);
  while (s.phase !== 'results') {
    const active = ['quiz', 'rescue', 'finale'].includes(s.phase);
    for (const p of s.players) solve(s, p.id);
    rules.tick(s, new Map(), 0, active ? s.started + 6000 : s.deadline);
  }
  assert.equal(s.started - 1000, 382000);
  assert.ok(rules.outcome(s).rows.every(row => row.rank === 1 && row.score === 16));
});
