import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FACTS } from '../src/content.server';
import { manifest } from '../src/manifest';
import { isTruth, normalize, rules } from '../src/server';
import type { State } from '../src/server';
const ctx = { nowMs: 1000, phase: 'playing' as const };
function start(count = 3, seed = 42) { return rules.create({ roomId: 'test', roundId: 'round-1', players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Curator ${i}`, color: '#b58aff' })), seed, nowMs: 1000 }, rules.validateSettings({})); }
function view(state: State) { return rules.publicView(state, ctx); }
function lie(state: State, player: string, text: string, now = state.openedAt + 1) { rules.applyAction(state, player, { type: 'lie', turnId: view(state).turnId, text }, now); }
function vote(state: State, player: string, optionId: string, now = state.openedAt + 1) { rules.applyAction(state, player, { type: 'vote', turnId: view(state).turnId, optionId }, now); }
function advance(state: State) { rules.tick(state, new Map(), 0, state.deadline); }
function truth(state: State) { return state.options.find(option => option.truth)!.id; }
test('manifest advertises only implemented counts, mode and orientation', () => {
  assert.equal(manifest.id, 'tall-tales'); assert.deepEqual(manifest.players, { min: 3, max: 10 }); assert.deepEqual(manifest.modes, ['shared-display']); assert.equal(manifest.orientation.controller, 'portrait');
});
test('36 valid original fact records carry authoritative evidence, aliases and distinct false decoys', () => {
  assert.ok(FACTS.length >= 35); assert.equal(new Set(FACTS.map(f => f.id)).size, FACTS.length);
  assert.equal(new Set(FACTS.map(f => f.prompt)).size, FACTS.length);
  for (const fact of FACTS) {
    assert.equal((fact.prompt.match(/_____/g) ?? []).length, 1, fact.id);
    assert.ok(fact.answer.length > 0 && fact.answer.length <= 80); assert.ok(fact.explanation.length >= 20);
    assert.ok(['science.nasa.gov', 'animals.sandiegozoo.org', 'oceanservice.noaa.gov'].includes(new URL(fact.sourceUrl).hostname));
    assert.equal(fact.verifiedOn, '2026-09-08');
    assert.equal(new Set(fact.decoys.map(normalize)).size, 2);
    for (const decoy of fact.decoys) assert.equal(isTruth(fact, decoy), false, `${fact.id}: ${decoy}`);
    for (const answer of [fact.answer, ...fact.aliases]) { assert.ok(normalize(answer)); assert.ok(isTruth(fact, `  ${answer.toUpperCase()}!!!  `), `${fact.id}: ${answer}`); }
  }
});
test('normalization merges punctuation, accents, articles, whitespace and basic numeric aliases', () => {
  assert.equal(normalize('  The Móon-rock! '), normalize('moon rock')); assert.equal(normalize('Seven'), normalize('7'));
  const fact = FACTS.find(f => f.id === 'venus-clouds')!;
  assert.ok(isTruth(fact, 'SULPHURIC-ACID')); assert.ok(isTruth(fact, 'the H2SO4'));
  assert.ok(isTruth(FACTS.find(f => f.id === 'uranus-king')!, 'George the third'));
});
test('settings, input and action parsing reject unknown fields, malformed values and oversized text', () => {
  assert.deepEqual(rules.validateSettings({}), { pace: 'standard' }); assert.deepEqual(rules.validateSettings({ pace: 'relaxed' }), { pace: 'relaxed' });
  for (const settings of [null, [], { pace: NaN }, { pace: 'fast' }, { rounds: 1 }]) assert.throws(() => rules.validateSettings(settings));
  assert.equal(rules.neutralInput(), null); assert.equal(rules.parseInput(null), null); assert.throws(() => rules.parseInput({}));
  for (const action of [null, [], {}, { type: 'lie', turnId: 2, text: 'hello' }, { type: 'lie', turnId: 'x', text: 'a'.repeat(81) }, { type: 'lie', turnId: 'x', text: '!!!' }, { type: 'lie', turnId: 'x', text: 'a\u200bb' }, { type: 'lie', turnId: 'x', text: 'hello', score: 1000 }, { type: 'vote', turnId: 'x', optionId: NaN }, { type: 'vote', turnId: 'x', optionId: 'truth' }]) assert.throws(() => rules.parseAction(action));
});
test('min, max and odd rosters produce complete deterministic games and tied correct outcomes', () => {
  for (const count of [3, 5, 10]) {
    const state = start(count); let previousScore = 0;
    assert.equal(new Set(state.deck.map(f => f.sourceUrl)).size, 7);
    for (let i = 0; i < 7; i++) {
      assert.equal(view(state).round, i + 1); assert.equal(state.phase, 'writing');
      state.players.forEach((player, j) => lie(state, player.id, `plausible fiction ${j}`));
      assert.equal(state.phase, 'writing', 'all submissions retain a fair fixed window');
      advance(state); assert.equal(state.phase, 'voting');
      state.players.forEach(player => vote(state, player.id, truth(state)));
      advance(state); previousScore += i === 6 ? 1000 : 500;
      assert.ok(state.players.every(p => p.score === previousScore));
      assert.equal(view(state).reveal!.answer, state.deck[i]!.answer);
      const scores = state.players.map(p => p.score); rules.tick(state, new Map(), 0, state.openedAt + 1); assert.deepEqual(state.players.map(p => p.score), scores);
      advance(state);
    }
    const outcome = rules.outcome(state); assert.equal(outcome.complete, true); assert.equal(outcome.rows.length, count); assert.equal(outcome.winners.length, count); assert.ok(outcome.rows.every(row => row.score === 4000 && row.rank === 1));
    assert.equal(state.deadline - 1000, 595000);
    advance(state); assert.deepEqual(rules.outcome(state), outcome); rules.dispose(state);
  }
  assert.deepEqual(start(5, 77), start(5, 77)); assert.notDeepEqual(start(5, 77).deck, start(5, 78).deck);
});
test('invalid rosters never silently truncate or create duplicate seats', () => {
  for (const count of [0, 2, 11]) assert.throws(() => start(count));
  const players = Array.from({ length: 3 }, () => ({ id: 'same', name: 'same', color: 'same' }));
  assert.throws(() => rules.create({ players, seed: 1, nowMs: 0, roomId: 'r', roundId: 'g' }, { pace: 'standard' }));
});
test('multiple normalized bluff authors share full credit and cannot vote for their merged lie', () => {
  const state = start(5);
  lie(state, 'p1', ' Moon-Rocks '); lie(state, 'p0', 'the móon rocks'); lie(state, 'p2', 'intergalactic jam');
  advance(state);
  const bluff = state.options.find(option => option.authors.includes('p0'))!;
  assert.deepEqual(bluff.authors, ['p0', 'p1']); assert.equal(state.options.filter(o => normalize(o.text) === normalize('moon rocks')).length, 1);
  assert.throws(() => vote(state, 'p0', bluff.id)); assert.throws(() => vote(state, 'p1', bluff.id));
  vote(state, 'p2', bluff.id); vote(state, 'p3', bluff.id); vote(state, 'p0', truth(state)); vote(state, 'p1', truth(state));
  advance(state);
  assert.deepEqual(state.players.map(p => p.score), [1100, 1100, 0, 0, 0]);
  assert.deepEqual(rules.outcome(state).rows.map(row => row.rank), [1, 1, 3, 3, 3]);
});
test('a player who accidentally writes truth may replace it until deadline without earning a bonus', () => {
  const state = start();
  assert.throws(() => lie(state, 'p0', state.deck[0]!.answer), /matches the truth/);
  assert.equal(rules.playerView(state, 'p0', ctx)!.lie, null); assert.equal(view(state).submitted, 0);
  lie(state, 'p0', 'questionable marmalade', state.deadline - 1);
  assert.equal(view(state).submitted, 1); assert.equal(state.players[0]!.score, 0);
  assert.throws(() => lie(state, 'p0', 'replacement'), /already filed/);
  advance(state); vote(state, 'p0', truth(state)); advance(state); assert.equal(state.players[0]!.score, 500);
});
test('every answer alias is rejected as a bluff with no submission consumed', () => {
  for (const fact of FACTS) {
    const state = start(); state.deck[0] = fact;
    for (const alias of [fact.answer, ...fact.aliases]) assert.throws(() => lie(state, 'p0', alias), /matches the truth/, fact.id);
    assert.equal(view(state).submitted, 0);
  }
});
test('no submitted lies still offers truth plus two false archive choices and reaches all-zero tied results', () => {
  const state = start(10);
  for (let i = 0; i < 7; i++) { advance(state); assert.equal(state.options.length, 3); assert.ok(state.options.every(o => o.authors.length === 0)); advance(state); advance(state); }
  assert.equal(rules.outcome(state).winners.length, 10); assert.ok(rules.outcome(state).rows.every(row => row.score === 0 && row.rank === 1));
});
test('a bluff matching an archive decoy receives ownership without creating another copy', () => {
  const state = start(); const decoy = state.deck[0]!.decoys[0]; lie(state, 'p0', decoy); advance(state);
  assert.equal(state.options.length, 3); const option = state.options.find(o => normalize(o.text) === normalize(decoy))!;
  assert.deepEqual(option.authors, ['p0']); vote(state, 'p1', option.id); advance(state); assert.equal(state.players[0]!.score, 300);
});
test('early, late, obsolete, invalid-seat and duplicate actions reject without mutation', () => {
  const state = start(); const initial = JSON.stringify(state);
  assert.throws(() => vote(state, 'p0', 'option-0'));
  assert.throws(() => lie(state, 'spectator', 'nonsense'));
  for (const now of [NaN, Infinity, state.openedAt - 1, state.deadline, state.deadline + 1]) assert.throws(() => lie(state, 'p0', 'nonsense', now));
  assert.throws(() => rules.applyAction(state, 'p0', { type: 'lie', turnId: 'old', text: 'nonsense' }, 1001)); assert.equal(JSON.stringify(state), initial);
  lie(state, 'p0', 'nonsense'); assert.throws(() => lie(state, 'p0', 'second lie'));
  advance(state); assert.throws(() => lie(state, 'p1', 'late lie')); assert.throws(() => vote(state, 'p1', 'option-99'));
  assert.throws(() => vote(state, 'p1', truth(state), state.deadline)); vote(state, 'p1', truth(state)); assert.throws(() => vote(state, 'p1', truth(state)));
  const oldTurn = view(state).turnId; advance(state); assert.throws(() => vote(state, 'p2', truth(state))); advance(state);
  assert.throws(() => rules.applyAction(state, 'p2', { type: 'lie', turnId: oldTurn, text: 'stale' }, state.openedAt + 1));
});
test('presence changes preserve private submissions and do not block deadlines', () => {
  const state = start(); lie(state, 'p0', 'deep fried dust'); const before = rules.playerView(state, 'p0', ctx);
  rules.onPresenceChange(state, 'p0', false, 1002); assert.deepEqual(rules.playerView(state, 'p0', ctx), before);
  advance(state); vote(state, 'p0', truth(state)); const voted = rules.playerView(state, 'p0', ctx);
  rules.onPresenceChange(state, 'p0', true, state.openedAt + 2); assert.deepEqual(rules.playerView(state, 'p0', ctx), voted);
  state.players.forEach(p => rules.onPresenceChange(state, p.id, false, state.openedAt + 3)); advance(state); advance(state); assert.equal(state.phase, 'writing');
});
test('serialized public and per-seat projections contain no answer keys, future content or other private submissions', () => {
  const state = start(); state.deck[0] = { ...state.deck[0]!, answer: 'secret truth material', aliases: ['secret answer alias'], sourceUrl: 'https://example.org/secret-evidence', explanation: 'secret explanation' };
  state.deck[1] = { ...state.deck[1]!, prompt: 'future secret question' };
  lie(state, 'p0', 'private player zero'); lie(state, 'p1', 'private player one');
  const packet = JSON.stringify({ public: view(state), private: rules.playerView(state, 'p2', ctx) });
  for (const secret of ['secret truth material', 'secret answer alias', 'secret-evidence', 'secret explanation', 'future secret question', 'private player zero', 'private player one']) assert.ok(!packet.includes(secret), secret);
  assert.equal(rules.playerView(state, 'spectator', ctx), null);
  assert.equal(rules.playerView(state, 'p0', ctx)!.lie, 'private player zero');
  advance(state); const ballot = view(state); assert.equal(ballot.reveal, null);
  assert.ok(ballot.options.some(option => option.text === 'secret truth material'));
  assert.ok(ballot.options.every(option => Object.keys(option).sort().join(',') === 'id,text'));
  assert.ok(!JSON.stringify(ballot).includes('authors')); assert.ok(!JSON.stringify(ballot).includes('secret answer alias'));
  vote(state, 'p0', truth(state)); assert.equal(rules.playerView(state, 'p1', ctx)!.votedOptionId, null);
  advance(state); assert.equal(view(state).reveal!.answer, 'secret truth material'); assert.ok(!JSON.stringify(view(state)).includes('future secret question'));
  const publicCopy = view(state); publicCopy.players[0]!.score = 99999; publicCopy.reveal!.options[0]!.authors.push('intruder');
  assert.notEqual(state.players[0]!.score, 99999); assert.ok(state.options.every(o => !o.authors.includes('intruder')));
});
test('client and manifest have no runtime dependency on server content', () => {
  for (const file of ['client.tsx', 'manifest.ts', 'types.ts']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.ok(!/from\s+['"].*(?:content\.server|\/server)['"]/.test(source));
  }
});
test('a delayed tick opens one full new window; relaxed settings fit the target duration', () => {
  const state = start(); const delayed = state.deadline + 600000; rules.tick(state, new Map(), 0, delayed);
  assert.equal(state.phase, 'voting'); assert.equal(state.deadline, delayed + 25000);
  const relaxed = start(); relaxed.settings = { pace: 'relaxed' }; let phases = 0;
  while (relaxed.phase !== 'complete') { advance(relaxed); phases++; assert.ok(phases <= 21); }
  assert.ok(relaxed.deadline - 1000 < 720000);
});
test('finale doubles fooled-rival points, includes nonvoters in results, and ranks deterministically', () => {
  const state = start(5);
  for (let i = 0; i < 6; i++) { advance(state); advance(state); advance(state); }
  lie(state, 'p0', 'velvet croutons'); lie(state, 'p1', 'VELVET-CROUTONS'); advance(state);
  const bluff = state.options.find(o => o.authors.includes('p0'))!;
  vote(state, 'p2', bluff.id); vote(state, 'p3', truth(state)); advance(state); advance(state);
  assert.deepEqual(state.players.map(p => p.score), [600, 600, 0, 1000, 0]);
  assert.deepEqual(rules.outcome(state).winners, ['p3']);
  assert.deepEqual(rules.outcome(state).rows.map(row => [row.playerId, row.rank]), [['p3', 1], ['p0', 2], ['p1', 2], ['p2', 4], ['p4', 4]]);
});
test('Unicode compatibility expansion cannot bypass the text limit', () => {
  assert.throws(() => rules.parseAction({ type: 'lie', turnId: 'x', text: 'ﬃ'.repeat(40) }));
});
test('starting a rematch creates fresh isolated state for the same participants', () => {
  const first = start(); lie(first, 'p0', 'blue custard'); advance(first); vote(first, 'p0', truth(first)); advance(first);
  const second = start(); assert.equal(second.players[0]!.score, 0); assert.equal(view(second).submitted, 0); assert.equal(rules.playerView(second, 'p0', ctx)!.lie, null);
  assert.equal(first.players[0]!.score, 500);
});
