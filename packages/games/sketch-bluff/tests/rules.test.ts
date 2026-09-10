import assert from 'node:assert/strict';
import test from 'node:test';
import { rules, normalizeCaption } from '../src/server';
import type { State } from '../src/server';
import { prompts } from '../src/content';
import { manifest } from '../src/manifest';
import { MAX_MESSAGE_BYTES } from '../../../party-contract/src/index';
import type { Action } from '../src/types';
import type { Drawing } from '../../../party-contract/src/index';
const viewContext = { nowMs: 0, phase: 'playing' as const };
const drawing: Drawing = { strokes: [{ color: '#28c6e7', width: 0.012, points: [{ x: 0.123, y: 0.987 }, { x: 0.762, y: 0.321 }] }] };
function create(count = 3, length: 'standard' | 'short' = 'short', seed = 101): State {
  return rules.create({ roomId: 'room', roundId: 'round', seed, nowMs: 100, players: Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `Artist ${index}`, color: '#28c6e7' })) }, rules.validateSettings({ length }));
}
function submit(state: State, playerId: string, payload: Omit<Action, 'turnId'> | Record<string, unknown>) {
  rules.applyAction(state, playerId, { ...payload, turnId: state.turnId } as Action, state.deadline - 1);
}
function drawAll(state: State) { for (const player of state.players) submit(state, player.id, { type: 'drawing', drawing }); }
function captionAll(state: State, caption = 'a breakfast emergency') {
  for (const player of state.players) if (player.id !== state.exhibits[state.exhibit]!.artistId) submit(state, player.id, { type: 'caption', text: caption });
}
function deadline(state: State) { rules.tick(state, new Map(), 0.1, state.deadline); }
function publicPacket(state: State) { return JSON.stringify(rules.publicView(state, viewContext)); }
function privatePacket(state: State, playerId: string) { return JSON.stringify({ public: rules.publicView(state, viewContext), private: rules.playerView(state, playerId, viewContext) }); }

test('manifest declares only the implemented player range and modes; original content has 60 unique prompts', () => {
  assert.deepEqual(manifest.players, { min: 3, max: 10 }); assert.deepEqual(manifest.modes, ['shared-display']);
  assert.equal(prompts.length, 60); assert.equal(new Set(prompts.map(normalizeCaption)).size, 60);
});

test('strict settings, roster, input and action parsing', () => {
  assert.equal(rules.validateSettings({}).length, 'standard');
  for (const raw of [null, [], { unknown: 1 }, { length: 'long' }, { drawingSeconds: NaN }, { captionSeconds: 0 }, { voteSeconds: 10.5 }]) assert.throws(() => rules.validateSettings(raw));
  for (const count of [0, 2, 11]) assert.throws(() => create(count));
  assert.throws(() => rules.create({ roomId: 'r', roundId: 'r', nowMs: 0, seed: 1, players: Array(3).fill({ id: 'same', name: 'a', color: 'x' }) }, rules.validateSettings({})));
  assert.equal(rules.parseInput(null), null); assert.equal(rules.neutralInput(), null); assert.throws(() => rules.parseInput({}));
  for (const raw of [null, [], {}, { type: 'no', turnId: 't' }, { type: 'caption', turnId: 't', text: '' }, { type: 'caption', turnId: 't', text: 'x'.repeat(101) }, { type: 'caption', turnId: 't', text: 'hidden\u200b' }, { type: 'vote', turnId: 't', choiceId: 'x', score: 10000 }]) assert.throws(() => rules.parseAction(raw));
});

test('drawing payload bounds use shared sanitizer and fit the transport envelope', () => {
  const maximum: Drawing = { strokes: Array.from({ length: 24 }, () => ({ color: '#28c6e7', width: 0.012, points: Array.from({ length: 20 }, () => ({ x: 0.123456, y: 0.999999 })) })) };
  const parsed = rules.parseAction({ type: 'drawing', turnId: 'round:1:0:drawing', drawing: maximum });
  assert.equal(parsed.type, 'drawing');
  if (parsed.type !== 'drawing') throw new Error('Wrong action');
  assert.equal(parsed.drawing.strokes[0]!.points[0]!.x, 0.123);
  assert.ok(Buffer.byteLength(JSON.stringify({ type: 'game.action', roundId: 'round', actionId: 'action', payload: parsed })) < MAX_MESSAGE_BYTES);
  const bad = [
    { strokes: Array(25).fill(drawing.strokes[0]) },
    { strokes: [{ ...drawing.strokes[0], points: Array(481).fill({ x: 0, y: 0 }) }] },
    { strokes: [{ ...drawing.strokes[0], width: NaN }] },
    { strokes: [{ ...drawing.strokes[0], width: 0.041 }] },
    { strokes: [{ ...drawing.strokes[0], color: 'red' }] },
    { strokes: [{ ...drawing.strokes[0], points: [{ x: Infinity, y: 0 }] }] },
    { strokes: [{ ...drawing.strokes[0], points: [{ x: -0.1, y: 0 }] }] },
    { strokes: [{ ...drawing.strokes[0], points: [] }] },
  ];
  for (const raw of bad) assert.throws(() => rules.parseAction({ type: 'drawing', turnId: 't', drawing: raw }));
});

test('serialized public, spectator and other-player snapshots conceal prompts and private drafts', () => {
  const state = create();
  submit(state, 'p0', { type: 'save-draft', drawing });
  for (const art of state.art) assert.ok(!publicPacket(state).includes(art.prompt));
  assert.ok(!publicPacket(state).includes('0.987'));
  for (const player of state.players) {
    const packet = privatePacket(state, player.id);
    for (const art of state.art) if (art.artistId !== player.id) assert.ok(!packet.includes(art.prompt));
    if (player.id !== 'p0') assert.ok(!packet.includes('0.987'));
  }
  assert.deepEqual(rules.playerView(state, 'p0', viewContext).draft, drawing);
  assert.throws(() => rules.playerView(state, 'spectator', viewContext));
  const projection = rules.playerView(state, 'p0', viewContext); projection.draft!.strokes.length = 0;
  assert.equal(state.art[0]!.draft!.strokes.length, 1);
});

test('reconnect preserves only the authenticated player own draft and submission', () => {
  const state = create(); submit(state, 'p0', { type: 'save-draft', drawing });
  rules.onPresenceChange(state, 'p0', false, 102);
  assert.throws(() => submit(state, 'p0', { type: 'drawing', drawing }));
  rules.onPresenceChange(state, 'p0', true, 103);
  assert.deepEqual(rules.playerView(state, 'p0', viewContext).draft, drawing);
  submit(state, 'p0', { type: 'drawing', drawing });
  rules.onPresenceChange(state, 'p0', false, 104); rules.onPresenceChange(state, 'p0', true, 105);
  assert.equal(rules.playerView(state, 'p0', viewContext).submitted, true);
  assert.equal(rules.playerView(state, 'p1', viewContext).draft, null);
});

test('submission duplicates, invalid seats, wrong phases, nonfinite and deadline actions reject without mutation', () => {
  const state = create(); const turnId = state.turnId;
  submit(state, 'p0', { type: 'drawing', drawing });
  for (const payload of [{ type: 'drawing', drawing }, { type: 'save-draft', drawing }, { type: 'caption', text: 'hello' }, { type: 'vote', choiceId: 'choice-1' }]) assert.throws(() => submit(state, 'p0', payload));
  assert.throws(() => submit(state, 'outsider', { type: 'drawing', drawing }));
  for (const now of [NaN, Infinity, -1, state.deadline]) assert.throws(() => rules.applyAction(state, 'p1', { type: 'drawing', turnId, drawing }, now));
  assert.throws(() => rules.applyAction(state, 'p1', { type: 'drawing', turnId: 'stale', drawing }, 101));
  submit(state, 'p1', { type: 'drawing', drawing }); submit(state, 'p2', { type: 'drawing', drawing });
  assert.throws(() => rules.applyAction(state, 'p1', { type: 'drawing', turnId, drawing }, 101));
  const artist = state.exhibits[0]!.artistId;
  assert.throws(() => submit(state, artist, { type: 'caption', text: 'my secret' }));
  const writers = state.players.filter(player => player.id !== artist);
  submit(state, writers[0]!.id, { type: 'caption', text: 'one decoy' });
  assert.throws(() => submit(state, writers[0]!.id, { type: 'caption', text: 'changed decoy' }));
  submit(state, writers[1]!.id, { type: 'caption', text: 'two decoy' });
  assert.throws(() => submit(state, artist, { type: 'vote', choiceId: state.choices[0]!.id }));
  assert.throws(() => submit(state, writers[0]!.id, { type: 'vote', choiceId: 'missing' }));
  submit(state, writers[0]!.id, { type: 'vote', choiceId: state.choices[0]!.id });
  const before = JSON.stringify(state);
  assert.throws(() => submit(state, writers[0]!.id, { type: 'vote', choiceId: state.choices[1]!.id }));
  assert.equal(JSON.stringify(state), before);
});

test('truth collisions and equivalent captions produce unique anonymous choices with no early correctness oracle', () => {
  const state = create(5); drawAll(state);
  const art = state.exhibits[0]!, writers = state.players.filter(player => player.id !== art.artistId);
  submit(state, writers[0]!.id, { type: 'caption', text: `  ${art.prompt.toUpperCase().replaceAll(' ', '  ')}  ` });
  const privateAfter = rules.playerView(state, writers[0]!.id, viewContext);
  assert.equal(privateAfter.submitted, true); assert.equal(Object.hasOwn(privateAfter, 'correct'), false);
  assert.ok(!publicPacket(state).includes(art.prompt));
  submit(state, writers[1]!.id, { type: 'caption', text: ' A Secret  Sausage ' });
  submit(state, writers[2]!.id, { type: 'caption', text: 'a secret sausage' });
  submit(state, writers[3]!.id, { type: 'caption', text: 'A SECRET SAUSAGE' });
  assert.equal(state.phase, 'vote');
  const view = rules.publicView(state, viewContext);
  assert.equal(new Set(view.choices.map(choice => normalizeCaption(choice.text))).size, view.choices.length);
  assert.equal(view.choices.filter(choice => choice.text === normalizeCaption(art.prompt)).length, 1);
  assert.equal(view.choices.filter(choice => choice.text === 'a secret sausage').length, 1);
  for (const choice of view.choices) assert.deepEqual(Object.keys(choice).sort(), ['id', 'text']);
  assert.ok(!publicPacket(state).includes('authors')); assert.ok(!publicPacket(state).includes('truth'));
  for (const player of writers) {
    const packet = privatePacket(state, player.id);
    assert.ok(!packet.includes('authors')); assert.ok(!packet.includes('truth'));
    assert.ok(!packet.includes('"captions"'));
  }
  const trueChoice = state.choices.find(choice => choice.truth)!;
  for (const player of writers) submit(state, player.id, { type: 'vote', choiceId: trueChoice.id });
  assert.equal(state.phase, 'reveal');
  for (const player of writers) assert.equal(state.gains[player.id], 1000);
  assert.equal(state.gains[art.artistId], 1000);
  assert.ok(publicPacket(state).includes('authors'));
});

test('equivalent bluffs reward each other author; self-votes never pay bluff points', () => {
  const state = create(5); drawAll(state); captionAll(state, 'a very wobbly sandwich');
  const writers = state.players.filter(player => player.id !== state.exhibits[0]!.artistId);
  const bluff = state.choices.find(choice => !choice.truth && choice.authors.length)!;
  for (const writer of writers) submit(state, writer.id, { type: 'vote', choiceId: bluff.id });
  assert.equal(state.phase, 'reveal');
  for (const writer of writers) assert.equal(state.gains[writer.id], 1500);
  assert.equal(state.gains[state.exhibits[0]!.artistId], 0);
  const scores = state.players.map(player => player.score);
  deadline(state); assert.deepEqual(state.players.map(player => player.score), scores);
});

test('blank and missing drawings skip; saved-only drafts are never exhibited', () => {
  const state = create();
  submit(state, 'p0', { type: 'drawing', drawing: { strokes: [] } });
  submit(state, 'p1', { type: 'save-draft', drawing });
  submit(state, 'p2', { type: 'drawing', drawing }); deadline(state);
  assert.equal(state.exhibits.length, 1); assert.equal(state.exhibits[0]!.artistId, 'p2'); assert.equal(state.skipped, 2);
});

for (const count of [3, 5, 10]) {
  test(`complete normal standard game with ${count} players, exact ranks and deterministic replay`, () => {
    function play() {
      const state = create(count, 'standard'); let steps = 0;
      while (state.phase !== 'results' && steps++ < 100) {
        if (state.phase === 'drawing') drawAll(state);
        else if (state.phase === 'caption') captionAll(state);
        else if (state.phase === 'vote') {
          const truth = state.choices.find(choice => choice.truth)!;
          for (const player of state.players) if (player.id !== state.exhibits[state.exhibit]!.artistId) submit(state, player.id, { type: 'vote', choiceId: truth.id });
        } else deadline(state);
      }
      assert.equal(state.phase, 'results'); return state;
    }
    const state = play(), outcome = rules.outcome(state);
    assert.equal(outcome.rows.length, count); assert.equal(outcome.winners.length, count);
    for (const row of outcome.rows) { assert.equal(row.rank, 1); assert.equal(row.score, state.galleries * (count - 1) * 1250); }
    assert.deepEqual(state, play());
  });
  test(`all ${count} disconnected seats progress through bounded deadlines to complete results`, () => {
    const state = create(count, 'standard'); drawAll(state);
    for (const player of state.players) rules.onPresenceChange(state, player.id, false, 102);
    let steps = 0; while (state.phase !== 'results' && steps++ < 100) deadline(state);
    assert.equal(state.phase, 'results'); assert.ok(steps < 100); assert.equal(rules.outcome(state).rows.length, count);
    for (const row of rules.outcome(state).rows) assert.equal(row.score, 0);
  });
}

test('zero submissions across every deadline still finishes, and result actions reject', () => {
  const state = create(3, 'standard'); deadline(state); deadline(state);
  assert.equal(state.phase, 'results'); assert.equal(state.skipped, 6);
  assert.throws(() => submit(state, 'p0', { type: 'drawing', drawing }));
  assert.throws(() => rules.tick(state, new Map(), 1, NaN));
  assert.throws(() => rules.onPresenceChange(state, 'unknown', true, 200));
  rules.dispose(state);
});

test('mixed votes award guess, bluff and artist separately and rank all players', () => {
  const state = create(); drawAll(state); captionAll(state);
  const artist = state.exhibits[0]!.artistId, writers = state.players.filter(player => player.id !== artist);
  submit(state, writers[0]!.id, { type: 'vote', choiceId: state.choices.find(choice => choice.truth)!.id });
  submit(state, writers[1]!.id, { type: 'vote', choiceId: state.choices.find(choice => choice.authors.length)!.id });
  assert.equal(state.gains[writers[0]!.id], 1500); assert.equal(state.gains[writers[1]!.id], 0); assert.equal(state.gains[artist], 250);
  assert.deepEqual(rules.outcome(state).rows.map(row => [row.playerId, row.rank]), [[writers[0]!.id, 1], [artist, 2], [writers[1]!.id, 3]]);
});

test('caption drafts, authors and future prompts stay private until the intended reveal', () => {
  const state = create(5); drawAll(state);
  const artist = state.exhibits[0]!.artistId, writers = state.players.filter(player => player.id !== artist);
  submit(state, writers[0]!.id, { type: 'caption', text: 'a secret dancing turnip' });
  assert.ok(!publicPacket(state).includes('a secret dancing turnip'));
  assert.ok(!privatePacket(state, writers[1]!.id).includes('a secret dancing turnip'));
  for (const art of state.art) assert.ok(!publicPacket(state).includes(art.prompt));
  rules.onPresenceChange(state, writers[0]!.id, false, 102); rules.onPresenceChange(state, writers[0]!.id, true, 103);
  assert.equal(rules.playerView(state, writers[0]!.id, viewContext).caption, 'a secret dancing turnip');
  deadline(state);
  assert.ok(publicPacket(state).includes('a secret dancing turnip'));
  for (const art of state.art) if (art.artistId !== artist) assert.ok(!publicPacket(state).includes(art.prompt));
  assert.ok(!publicPacket(state).includes('authors')); assert.ok(!publicPacket(state).includes('voters'));
  const projection = rules.publicView(state, viewContext); projection.drawing!.strokes.length = 0;
  assert.equal(state.exhibits[0]!.drawing!.strokes.length, 1);
});

test('caption normalization includes tabs, newlines and compatibility characters', () => {
  const parsed = rules.parseAction({ type: 'caption', turnId: 't', text: '  A\tVERY\nOdd   Day  ' });
  assert.equal(parsed.type === 'caption' && parsed.text, 'A VERY Odd Day');
  assert.equal(normalizeCaption('Ａ very ODD day'), normalizeCaption('a very odd day'));
});
