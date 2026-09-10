import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rules, durations } from '../src/server';
import type { State } from '../src/server';
import { prompts } from '../src/content';
import { manifest } from '../src/manifest';
const context = { nowMs: 0, phase: 'playing' as const };
function game(count = 4, seed = 17, rounds = 4) {
  return rules.create({ roomId: 'room', roundId: 'round-id', seed, nowMs: 0, players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Guest ${i}`, color: '#78d955' })) }, { rounds });
}
function answerFor(state: State) {
  const format = state.prompt.format;
  return format.kind === 'number' ? format.min : format.kind === 'choice' ? format.options[0] : 'pancake';
}
function answerAll(state: State) {
  const turnId = state.turnId;
  for (const player of state.players) rules.applyAction(state, player.id, { type: 'answer', turnId, answer: answerFor(state) }, state.deadline - 1);
}
function deadline(state: State) { rules.tick(state, new Map(), 0, state.deadline); }
function toVote(state: State) { answerAll(state); deadline(state); assert.equal(state.phase, 'vote'); }
function voteAll(state: State, catchBluffer: boolean) {
  const turnId = state.turnId;
  for (const player of state.players) rules.applyAction(state, player.id, { type: 'vote', turnId, target: catchBluffer && player.id !== state.blufferId ? state.blufferId : null }, state.deadline - 1);
}
function serialized(state: State) { return JSON.stringify(rules.publicView(state, context)); }

test('manifest and settings declare the supported mode and strict limits', () => {
  assert.deepEqual(manifest.modes, ['shared-display']);
  assert.equal(manifest.players.min, 4); assert.equal(manifest.players.max, 10);
  assert.deepEqual(rules.validateSettings({}), { rounds: 4 });
  for (const raw of [null, [], { rounds: null }, { rounds: 2 }, { rounds: 7 }, { rounds: NaN }, { rounds: 3.5 }, { rounds: '4' }, { rounds: 4, cheats: true }]) assert.throws(() => rules.validateSettings(raw));
  for (const n of [0, 3, 11]) assert.throws(() => game(n));
  assert.equal(rules.neutralInput(), null); assert.equal(rules.parseInput(null), null);
  assert.throws(() => rules.parseInput({}));
});

test('54 original prompts have usable hints, varied formats, and no repetitions', () => {
  assert.equal(prompts.length, 54);
  assert.equal(new Set(prompts.map(p => p.id)).size, prompts.length);
  assert.equal(new Set(prompts.map(p => p.question)).size, prompts.length);
  for (const kind of ['number', 'choice', 'text']) assert.equal(prompts.filter(p => p.format.kind === kind).length, 18);
  for (const p of prompts) {
    assert.ok(p.category.length >= 5); assert.ok(p.question.length > p.category.length);
    if (p.format.kind === 'choice') assert.equal(new Set(p.format.options).size, 4);
    if (p.format.kind === 'number') assert.ok(p.format.min < p.format.max);
    if (p.format.kind === 'text') assert.equal(p.format.maxLength, 48);
  }
});

for (const count of [4, 5, 10]) {
  test(`${count} players finish a normal game, catch on every first clue, and include every score`, () => {
    const state = game(count);
    for (let round = 1; round <= state.settings.rounds; round++) {
      assert.equal(state.round, round); toVote(state); voteAll(state, true);
      assert.equal(state.phase, 'resolution'); assert.equal(state.result?.caught, true);
      assert.equal(state.result?.blufferId, state.blufferId);
      assert.equal(state.result?.awards.find(a => a.playerId === state.blufferId)?.points, 0);
      assert.ok(state.result?.awards.filter(a => a.playerId !== state.blufferId).every(a => a.points === 100));
      deadline(state);
    }
    const outcome = rules.outcome(state);
    assert.equal(outcome.complete, true); assert.equal(outcome.rows.length, count);
    assert.equal(new Set(outcome.rows.map(row => row.playerId)).size, count);
    assert.ok(outcome.winners.length); assert.ok(outcome.rows.every(row => row.rank! >= 1));
    assert.equal(state.cursor, state.settings.rounds);
  });
  test(`${count} players: balanced seeded role rotation and bounded all-missing game`, () => {
    const state = game(count, 29, 6);
    const counts = new Map(state.players.map(p => [p.id, 0]));
    let previous = '';
    const seen = new Set<string>();
    while (state.phase !== 'complete') {
      if (state.phase === 'answer' && state.clue === 1) {
        assert.notEqual(state.blufferId, previous); previous = state.blufferId;
        counts.set(state.blufferId, counts.get(state.blufferId)! + 1);
      }
      if (state.phase === 'answer') { assert.ok(!seen.has(state.prompt.id)); seen.add(state.prompt.id); }
      deadline(state);
    }
    assert.ok(Math.max(...counts.values()) - Math.min(...counts.values()) <= 1);
    assert.equal(seen.size, 18); assert.equal(rules.outcome(state).rows.length, count);
    assert.ok(state.deadline <= 6 * (3 * (durations.answer + durations.discuss + durations.vote) + durations.resolution));
  });
}

test('same seed gives same roles/content; different seeds vary', () => {
  const a = game(10, 23), b = game(10, 23), c = game(10, 24);
  assert.deepEqual(a.roleOrder, b.roleOrder); assert.deepEqual(a.deck, b.deck);
  assert.notDeepEqual(a.roleOrder, c.roleOrder); assert.notDeepEqual(a.deck, c.deck);
  const zero = game(4, 0); assert.equal(new Set(zero.roleOrder).size, 4);
});

test('a large clock jump completes missing-input games without infinite voting', () => {
  const state = game(10, 7, 6);
  rules.tick(state, new Map(), 0, 1e9);
  assert.equal(state.phase, 'complete'); assert.equal(state.round, 6);
  assert.equal(state.cursor, 18);
});

test('strict parsing rejects empty, oversized, NaN, fractional, malformed, and extra fields', () => {
  for (const raw of [null, [], {}, { type: 'answer', turnId: 't', answer: '' }, { type: 'answer', turnId: 't', answer: '   ' }, { type: 'answer', turnId: 't', answer: 'a'.repeat(49) }, { type: 'answer', turnId: 't', answer: NaN }, { type: 'answer', turnId: 't', answer: Infinity }, { type: 'answer', turnId: 't', answer: 1.5 }, { type: 'answer', turnId: 't', answer: 'hi\nthere' }, { type: 'vote', turnId: 't' }, { type: 'vote', turnId: 't', target: false }, { type: 'vote', turnId: '', target: null }, { type: 'vote', turnId: 't', target: null, score: 99 }]) assert.throws(() => rules.parseAction(raw));
  assert.deepEqual(rules.parseAction({ type: 'answer', turnId: 't', answer: '  pear  ' }), { type: 'answer', turnId: 't', answer: 'pear' });
});

test('each format enforces its answer domain and accepts a real response', () => {
  for (const prompt of prompts) {
    const state = game(); state.prompt = prompt;
    const invalid = prompt.format.kind === 'number' ? [-1, prompt.format.max + 1, '3'] : prompt.format.kind === 'choice' ? [0, 'unlisted'] : [3, ''];
    for (const answer of invalid) assert.throws(() => rules.applyAction(state, 'p0', { type: 'answer', turnId: state.turnId, answer }, 0));
    rules.applyAction(state, 'p0', { type: 'answer', turnId: state.turnId, answer: answerFor(state) }, 0);
    assert.equal(state.answers.size, 1);
  }
});

test('duplicate answers cannot change a lock, even with a new transport action ID', () => {
  const state = game();
  const action = { type: 'answer' as const, turnId: state.turnId, answer: answerFor(state) };
  rules.applyAction(state, 'p0', action, 0);
  assert.throws(() => rules.applyAction(state, 'p0', { ...action }, 1), /already locked/);
  assert.equal(state.answers.size, 1);
});

test('wrong phase, invalid seats, stale clues, self-votes, and duplicate votes are rejected', () => {
  const state = game(); const old = state.turnId;
  assert.throws(() => rules.applyAction(state, 'spectator', { type: 'answer', turnId: old, answer: answerFor(state) }, 0));
  assert.throws(() => rules.applyAction(state, 'p0', { type: 'vote', turnId: old, target: 'p1' }, 0), /closed/);
  toVote(state);
  assert.throws(() => rules.applyAction(state, 'p0', { type: 'answer', turnId: state.turnId, answer: answerFor(state) }, state.deadline - 1), /closed/);
  assert.throws(() => rules.applyAction(state, 'p0', { type: 'vote', turnId: state.turnId, target: 'p0' }, state.deadline - 1), /yourself/);
  assert.throws(() => rules.applyAction(state, 'p0', { type: 'vote', turnId: state.turnId, target: 'spectator' }, state.deadline - 1), /participating/);
  const vote = { type: 'vote' as const, turnId: state.turnId, target: null };
  rules.applyAction(state, 'p0', vote, state.deadline - 1);
  assert.throws(() => rules.applyAction(state, 'p0', { ...vote }, state.deadline - 1), /already locked/);
  deadline(state); assert.equal(state.clue, 2);
  assert.throws(() => rules.applyAction(state, 'p0', { type: 'answer', turnId: old, answer: answerFor(state) }, state.deadline - 1), /ended/);
  assert.throws(() => rules.applyAction(state, 'p0', vote, state.deadline - 1), /ended/);
});

test('actions at and after deadline are rejected without changing state', () => {
  const state = game(); const before = serialized(state);
  for (const now of [state.deadline, state.deadline + 1, NaN, Infinity, -1]) assert.throws(() => rules.applyAction(state, 'p0', { type: 'answer', turnId: state.turnId, answer: answerFor(state) }, now));
  assert.equal(serialized(state), before);
  deadline(state);
  assert.ok(state.reveals[0].answers.every(a => a.answer === null));
});

test('tied accusations and wrong consensus each consume one attempt', () => {
  const state = game();
  toVote(state);
  const bluffer = state.blufferId, guests = state.players.filter(p => p.id !== bluffer).map(p => p.id);
  const turnId = state.turnId;
  rules.applyAction(state, guests[0], { type: 'vote', turnId, target: bluffer }, state.deadline - 1);
  rules.applyAction(state, guests[1], { type: 'vote', turnId, target: bluffer }, state.deadline - 1);
  rules.applyAction(state, guests[2], { type: 'vote', turnId, target: guests[0] }, state.deadline - 1);
  rules.applyAction(state, bluffer, { type: 'vote', turnId, target: guests[0] }, state.deadline - 1);
  assert.equal(state.phase, 'answer'); assert.equal(state.clue, 2); assert.equal(state.result, null);
  assert.ok(rules.outcome(state).rows.every(p => p.score === 0), 'pending detection points must not leak correct votes');
  toVote(state);
  const wrong = guests[0], wrongTurn = state.turnId;
  for (const p of state.players) rules.applyAction(state, p.id, { type: 'vote', turnId: wrongTurn, target: p.id === wrong ? null : wrong }, state.deadline - 1);
  assert.equal(state.phase, 'answer'); assert.equal(state.clue, 3);
  toVote(state); voteAll(state, false);
  assert.equal(state.phase, 'resolution'); assert.equal(rules.publicView(state, context).result?.caught, false);
  assert.equal(state.scores.get(bluffer), 500); assert.equal(state.scores.get(guests[0]), 100); assert.equal(state.scores.get(guests[1]), 100);
});

test('no votes means bounded escape, not a repeated ballot', () => {
  const state = game(); const bluffer = state.blufferId;
  for (let clue = 1; clue <= 3; clue++) { toVote(state); deadline(state); }
  assert.equal(state.phase, 'resolution'); assert.equal(state.result?.reason, 'escaped'); assert.equal(state.scores.get(bluffer), 500);
});

test('pre-reveal public/spectator/host packets omit answers, question, roles and future content', () => {
  const state = game(10);
  const privateAnswers = new Map();
  state.prompt = prompts.find(p => p.format.kind === 'text')!;
  for (const p of state.players.slice(0, -1)) {
    const answer = `SECRET${p.id}`; privateAnswers.set(p.id, answer);
    rules.applyAction(state, p.id, { type: 'answer', turnId: state.turnId, answer }, 0);
  }
  const publicPacket = serialized(state);
  assert.ok(!publicPacket.includes(state.prompt.question));
  for (const answer of privateAnswers.values()) assert.ok(!publicPacket.includes(answer));
  for (const field of ['blufferId', 'roleOrder', '"role"', 'deck', 'pending']) assert.ok(!publicPacket.includes(field));
  assert.equal(rules.playerView(state, 'host-watching', context), null);
  assert.equal(rules.playerView(state, 'spectator', context), null);
  for (const player of state.players) {
    const own = rules.playerView(state, player.id, context)!;
    assert.equal(own.role, player.id === state.blufferId ? 'bluffer' : 'guest');
    assert.equal(own.question, own.role === 'bluffer' ? null : state.prompt.question);
    for (const [id, answer] of privateAnswers) if (id !== player.id) assert.ok(!JSON.stringify(own).includes(answer));
    assert.ok(!JSON.stringify(own).includes('roleOrder'));
  }
  const final = state.players.at(-1)!;
  rules.applyAction(state, final.id, { type: 'answer', turnId: state.turnId, answer: 'final answer' }, 1);
  assert.equal(state.phase, 'discuss'); assert.ok(serialized(state).includes(state.prompt.question));
  assert.ok(!serialized(state).includes('blufferId')); assert.ok(!serialized(state).includes('"role"'));
});

test('reconnect preserves only own answer/role/vote; bluffer dropout does not reveal or lower majority', () => {
  const state = game(); const bluffer = state.blufferId;
  rules.applyAction(state, bluffer, { type: 'answer', turnId: state.turnId, answer: answerFor(state) }, 0);
  const own = rules.playerView(state, bluffer, context), before = serialized(state);
  rules.onPresenceChange(state, bluffer, false, 1);
  assert.equal(serialized(state), before); assert.equal(state.phase, 'answer');
  rules.onPresenceChange(state, bluffer, true, 2);
  assert.deepEqual(rules.playerView(state, bluffer, context), own);
  assert.equal(rules.publicView(state, context).majority, 3);
  deadline(state); deadline(state);
  const target = state.players.find(p => p.id !== bluffer)!.id;
  rules.applyAction(state, bluffer, { type: 'vote', turnId: state.turnId, target }, state.deadline - 1);
  const voted = rules.playerView(state, bluffer, context);
  rules.onPresenceChange(state, bluffer, false, state.deadline - 1);
  rules.onPresenceChange(state, bluffer, true, state.deadline - 1);
  assert.deepEqual(rules.playerView(state, bluffer, context), voted);
  assert.ok(!serialized(state).includes('blufferId'));
});

test('intentional resolution reveals only current bluffer and points, then clears for next round', () => {
  const state = game(); toVote(state); voteAll(state, true);
  const view = rules.publicView(state, context);
  assert.equal(view.result?.blufferId, state.blufferId);
  assert.equal(view.result?.awards.length, 4);
  assert.ok(!serialized(state).includes('roleOrder')); assert.ok(!serialized(state).includes('deck'));
  deadline(state);
  assert.equal(rules.publicView(state, context).result, null); assert.equal(state.reveals.length, 0);
  assert.ok(!serialized(state).includes(state.prompt.question));
});

test('projection mutation cannot modify authoritative state', () => {
  const state = game(); state.prompt = prompts.find(p => p.format.kind === 'choice')!;
  const view = rules.publicView(state, context);
  view.players[0].score = 9999; view.players[0].name = 'Changed';
  if (view.format.kind === 'choice') (view.format.options as string[])[0] = 'Changed';
  assert.equal(state.scores.get('p0'), 0); assert.equal(state.players[0].name, 'Guest 0');
  assert.notEqual(state.prompt.format.kind === 'choice' && state.prompt.format.options[0], 'Changed');
  toVote(state); voteAll(state, true);
  const resolved = rules.publicView(state, context); resolved.result!.awards[0].points = 999;
  assert.notEqual(state.result!.awards[0].points, 999);
});

test('final ties use competition ranks and stable participant ordering', () => {
  const state = game(); state.phase = 'complete'; state.scores = new Map([['p0', 300], ['p1', 100], ['p2', 300], ['p3', 0]]);
  const outcome = rules.outcome(state);
  assert.deepEqual(outcome.winners, ['p0', 'p2']); assert.deepEqual(outcome.rows.map(r => r.rank), [1, 3, 1, 4]);
  assert.deepEqual(outcome.rows.map(r => r.playerId), ['p0', 'p1', 'p2', 'p3']);
  const before = serialized(state); rules.tick(state, new Map(), 0, 1e9); assert.equal(serialized(state), before);
});

test('client import graph entry points do not pull in server-only content', () => {
  for (const file of ['client.tsx', 'types.ts', 'manifest.ts']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]\.\/content['"]|from\s+['"]\.\/server['"]/);
  }
});
