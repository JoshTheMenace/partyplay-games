import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cyclicPairs, rules } from '../src/server';
import type { State } from '../src/server';
import { prompts } from '../src/content';

const ctx = { nowMs: 1000, phase: 'playing' as const };
function create(count = 4, seed = 42) {
  return rules.create({ roomId: 'room', roundId: 'game', seed, nowMs: 1000,
    players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, color: 'sun' })) }, rules.validateSettings({}));
}
function tick(state: State, now = state.deadline) { rules.tick(state, new Map(), 0, now); }
function fill(state: State) {
  for (const entry of state.entries) rules.applyAction(state, entry.author, { type: 'answer', questionId: entry.id, turnId: state.turnId, text: `Joke ${entry.id}` }, state.startedAt + 1);
}
function ballot(state: State) { return state.matches[state.matchIndex]!; }
function voters(state: State) { return state.players.filter(player => !ballot(state).entries.some(entry => entry.author === player.id)); }
function vote(state: State, playerId: string, choice: 0 | 1) { rules.applyAction(state, playerId, { type: 'vote', turnId: state.turnId, choice }, state.startedAt + 1); }

for (const count of [3, 4, 7, 10]) {
  test(`${count} players: fair pairings and complete three-round game`, () => {
    const state = create(count);
    let reveals = 0;
    for (let round = 1; round <= 3; round++) {
      assert.equal(state.phase, 'writing'); assert.equal(state.round, round);
      for (const player of state.players) {
        assert.equal(state.entries.filter(entry => entry.author === player.id).length, 2);
        assert.equal(state.matches.filter(match => match.entries.some(entry => entry.author === player.id)).length, 2);
      }
      assert.equal(state.matches.length, count);
      assert.equal(new Set(state.matches.flatMap(match => match.entries.map(entry => entry.id))).size, count * 2);
      for (const match of state.matches) assert.notEqual(match.entries[0].author, match.entries[1].author);
      if (round === 3) assert.equal(new Set(state.entries.map(entry => entry.prompt)).size, 1);
      fill(state); tick(state);
      for (let match = 0; match < count; match++) {
        assert.equal(state.phase, 'voting');
        for (const player of voters(state)) vote(state, player.id, 0);
        tick(state); assert.equal(state.phase, 'reveal'); reveals++;
        const result = ballot(state).reveal!;
        assert.equal(result.points[0], ((count - 2) * 100 + 200) * round);
        assert.equal(result.points[1], 0);
        const scores = state.players.map(player => player.score);
        tick(state, state.startedAt + 1); tick(state, state.startedAt + 2);
        assert.deepEqual(state.players.map(player => player.score), scores);
        tick(state);
      }
    }
    assert.equal(reveals, count * 3); assert.equal(state.phase, 'results');
    const outcome = rules.outcome(state);
    assert.equal(outcome.complete, true); assert.equal(outcome.rows.length, count);
    assert.equal(state.players.reduce((sum, player) => sum + player.score, 0), count * ((count - 2) * 100 + 200) * 6);
    const frozen = JSON.stringify(state); tick(state, state.deadline + 1_000_000); assert.equal(JSON.stringify(state), frozen);
  });
}

test('cyclic pairing has two slots per player without self pairing', () => {
  for (const count of [3, 4, 7, 10]) {
    const ids = Array.from({ length: count }, (_, i) => String(i));
    const pairs = cyclicPairs(ids);
    for (const id of ids) assert.equal(pairs.flat().filter(item => item === id).length, 2);
  }
});
test('self-vote, duplicate answers/votes, wrong phase, wrong turn and other-seat answers are rejected', () => {
  const state = create(); const entry = state.entries[0]!;
  const answer = { type: 'answer' as const, turnId: state.turnId, questionId: entry.id, text: 'A tiny briefcase' };
  assert.throws(() => rules.applyAction(state, 'watching-host', answer, 1001));
  assert.throws(() => rules.applyAction(state, state.players.find(player => player.id !== entry.author)!.id, answer, 1001));
  assert.throws(() => vote(state, entry.author, 0));
  assert.throws(() => rules.applyAction(state, entry.author, { ...answer, turnId: 'previous' }, 1001));
  rules.applyAction(state, entry.author, answer, 1001);
  assert.throws(() => rules.applyAction(state, entry.author, answer, 1002));
  assert.throws(() => rules.applyAction(state, entry.author, { ...answer, type: 'draft' }, 1002));
  for (const other of state.entries.filter(item => item.answer === null)) rules.applyAction(state, other.author, { ...answer, questionId: other.id }, 1002);
  tick(state);
  assert.throws(() => vote(state, ballot(state).entries[0].author, 0));
  const voter = voters(state)[0]!; vote(state, voter.id, 0);
  assert.throws(() => vote(state, voter.id, 1));
  assert.throws(() => rules.applyAction(state, entry.author, answer, state.startedAt + 1));
  tick(state);
  assert.throws(() => vote(state, voter.id, 0));
});
test('ties give vote points without a win bonus; empty ballots give zero', () => {
  const state = create(); fill(state); tick(state);
  const eligible = voters(state); vote(state, eligible[0]!.id, 0); vote(state, eligible[1]!.id, 1); tick(state);
  assert.equal(ballot(state).reveal!.result, 'tie'); assert.deepEqual(ballot(state).reveal!.points, [100, 100]);
  tick(state); tick(state);
  assert.equal(ballot(state).reveal!.result, 'no-votes'); assert.deepEqual(ballot(state).reveal!.points, [0, 0]);
});
test('all missing and disconnected players reach tied results without fabricated entries', () => {
  const state = create(7);
  state.players.forEach(player => rules.onPresenceChange(state, player.id, false, 1001));
  let phases = 0;
  while (state.phase !== 'results' && phases++ < 100) {
    tick(state);
    if (state.phase === 'reveal') {
      assert.equal(ballot(state).reveal!.result, 'missing');
      assert.deepEqual(rules.publicView(state, ctx).matchup!.answers, [null, null]);
    }
  }
  const result = rules.outcome(state);
  assert.equal(result.complete, true); assert.equal(result.winners.length, 7);
  assert.ok(result.rows.every(row => row.score === 0 && row.rank === 1));
});
test('one missing answer skips voting and awards no free win; drafts never submit themselves', () => {
  const state = create(3); const match = ballot(state); const entry = match.entries[0];
  rules.applyAction(state, entry.author, { type: 'draft', questionId: entry.id, turnId: state.turnId, text: 'Private unfinished joke' }, 1001);
  const other = match.entries[1];
  rules.applyAction(state, other.author, { type: 'answer', questionId: other.id, turnId: state.turnId, text: 'An actual joke' }, 1001);
  tick(state);
  assert.equal(state.phase, 'reveal'); assert.equal(entry.answer, null);
  assert.equal(ballot(state).reveal!.result, 'missing'); assert.deepEqual(ballot(state).reveal!.points, [0, 0]);
  assert.ok(!JSON.stringify(rules.publicView(state, ctx)).includes('Private unfinished joke'));
});
test('drafts and assignments survive reconnect only for their owner; answers/votes reveal in stages', () => {
  const state = create(7); const entry = state.entries[0]!;
  rules.applyAction(state, entry.author, { type: 'draft', turnId: state.turnId, questionId: entry.id, text: 'PRIVATE_DRAFT_MARKER' }, 1001);
  const own = rules.playerView(state, entry.author, ctx);
  rules.onPresenceChange(state, entry.author, false, 1002); rules.onPresenceChange(state, entry.author, true, 1003);
  assert.deepEqual(rules.playerView(state, entry.author, ctx), own);
  for (const player of state.players.filter(player => player.id !== entry.author)) assert.ok(!JSON.stringify(rules.playerView(state, player.id, ctx)).includes('PRIVATE_DRAFT_MARKER'));
  assert.deepEqual(rules.playerView(state, 'watching-host', ctx).questions, []);
  const publicWriting = JSON.stringify(rules.publicView(state, ctx));
  assert.ok(!publicWriting.includes(entry.prompt)); assert.ok(!publicWriting.includes('PRIVATE_DRAFT_MARKER'));
  fill(state);
  for (const item of state.entries) assert.ok(!JSON.stringify(rules.publicView(state, ctx)).includes(item.answer!));
  tick(state);
  const publicVoting = rules.publicView(state, ctx);
  assert.equal(publicVoting.matchup!.reveal, null);
  assert.deepEqual(Object.keys(publicVoting.matchup!).sort(), ['answers', 'prompt', 'reveal']);
  const current = ballot(state); const eligible = voters(state); vote(state, eligible[0]!.id, 0);
  assert.equal(rules.playerView(state, eligible[1]!.id, ctx).voted, null);
  assert.equal(rules.publicView(state, ctx).matchup!.reveal, null);
  for (const item of state.entries.filter(item => !current.entries.includes(item))) assert.ok(!JSON.stringify(rules.publicView(state, ctx)).includes(item.answer!));
  tick(state);
  assert.deepEqual(rules.publicView(state, ctx).matchup!.reveal!.authors, current.entries.map(item => item.author));
  assert.deepEqual(rules.publicView(state, ctx).matchup!.reveal!.votes[0], [eligible[0]!.id]);
});
test('strict parsing, bounded settings, roster and clock validation', () => {
  for (const bad of [null, [], { writingSeconds: NaN }, { votingSeconds: 1 }, { revealSeconds: 13 }, { extra: 1 }, { writingSeconds: 30.5 }]) assert.throws(() => rules.validateSettings(bad));
  assert.deepEqual(rules.validateSettings({}), { writingSeconds: 100, votingSeconds: 0, revealSeconds: 6 });
  for (const count of [0, 2, 11]) assert.throws(() => create(count));
  for (const bad of [null, { type: 'vote', turnId: 'x', choice: NaN }, { type: 'vote', turnId: 'x', choice: 2 }, { type: 'vote', turnId: '', choice: 0 }, { type: 'vote', turnId: 'x', choice: 0, playerId: 'p0' }, { type: 'answer', turnId: 'x', questionId: 'q', text: '' }, { type: 'answer', turnId: 'x', questionId: 'q', text: 'x'.repeat(161) }]) assert.throws(() => rules.parseAction(bad));
  assert.throws(() => rules.parseInput({})); assert.equal(rules.parseInput(null), null);
  const state = create(); const entry = state.entries[0]!;
  const answer = { type: 'answer' as const, turnId: state.turnId, questionId: entry.id, text: 'Okay' };
  for (const now of [NaN, Infinity, state.deadline, state.deadline + 1, 0]) assert.throws(() => rules.applyAction(state, entry.author, answer, now));
});
test('seeded content is reproducible, varied and never enters the client dependency graph', () => {
  assert.equal(JSON.stringify(create(10)), JSON.stringify(create(10)));
  assert.notEqual(JSON.stringify(create(10, 41)), JSON.stringify(create(10, 42)));
  assert.ok(prompts.length >= 60); assert.equal(new Set(prompts).size, prompts.length);
  for (const file of ['client.tsx', 'manifest.ts', 'types.ts']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.ok(!/from ['"]\.\/content['"]/.test(source));
    assert.ok(!/from ['"]\.\/server['"]/.test(source));
  }
  const state = create(10); const seen: string[] = [];
  for (let round = 1; round <= 3; round++) {
    seen.push(...new Set(state.entries.map(entry => entry.prompt)));
    tick(state);
    while (state.phase === 'reveal') tick(state);
  }
  assert.equal(seen.length, 21); assert.equal(new Set(seen).size, 21);
});
test('projections are detached and invalid ticks cannot roll the clock backward', () => {
  const state = create(); fill(state);
  const before = JSON.stringify(state);
  for (const now of [0, NaN, Infinity]) tick(state, now);
  assert.equal(JSON.stringify(state), before);
  tick(state); vote(state, voters(state)[0]!.id, 0); tick(state);
  const view = rules.publicView(state, ctx);
  view.players[0]!.score = 99999;
  view.matchup!.reveal!.points[0] = 99999;
  view.matchup!.reveal!.votes[0].push('fake-voter');
  assert.notEqual(state.players[0]!.score, 99999);
  assert.notEqual(ballot(state).reveal!.points[0], 99999);
  assert.ok(!ballot(state).reveal!.votes[0].includes('fake-voter'));
});
test('finale entries are separate and a player must write two different punchlines', () => {
  const state = create(3);
  while (state.round < 3) tick(state);
  const entries = state.entries.filter(entry => entry.author === state.players[0]!.id);
  const action = { type: 'answer' as const, turnId: state.turnId, questionId: entries[0]!.id, text: 'A sleepy stapler' };
  rules.applyAction(state, state.players[0]!.id, action, state.startedAt + 1);
  assert.throws(() => rules.applyAction(state, state.players[0]!.id, { ...action, questionId: entries[1]!.id, text: 'A SLEEPY STAPLER' }, state.startedAt + 1));
  rules.applyAction(state, state.players[0]!.id, { ...action, questionId: entries[1]!.id, text: 'A pancake inspector' }, state.startedAt + 1);
  assert.notEqual(entries[0]!.answer, entries[1]!.answer);
});
test('completed ballots reveal after a readable minimum; absent voters still get the full deadline', () => {
  const state = create(3); fill(state); tick(state);
  vote(state, voters(state)[0]!.id, 0);
  const start = state.startedAt;
  tick(state, start + 3499); assert.equal(state.phase, 'voting');
  tick(state, start + 3500); assert.equal(state.phase, 'reveal');
  assert.equal(ballot(state).reveal!.points[0], 300);
  tick(state); assert.equal(state.phase, 'voting');
  rules.onPresenceChange(state, voters(state)[0]!.id, false, state.startedAt + 1);
  tick(state, state.deadline - 1); assert.equal(state.phase, 'voting');
  tick(state); assert.equal(state.phase, 'reveal');
  assert.equal(ballot(state).reveal!.result, 'no-votes');
});
