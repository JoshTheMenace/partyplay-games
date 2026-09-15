import test from 'node:test';
import assert from 'node:assert/strict';
import { delays, detectSets, rules } from '../src/server';
import type { State } from '../src/server';
import { manifest } from '../src/manifest';
const context = { nowMs: 0, phase: 'playing' as const };
/** Eight different colors: no ninth card can complete three sets. */
const SAFE = [1, 4, 7, 10, 13, 16, 19, 22];
function game(count = 4, seed = 17) {
  return rules.create({ roomId: 'room', roundId: 'round', seed, nowMs: 0, players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, color: '#78d955' })) }, {});
}
const idAt = (state: State) => state.seats[state.current].id!;
function human(state: State, now = 0) {
  rules.applyAction(state, idAt(state), { type: 'draw', turnId: state.turnId, from: 'deck' }, now);
  rules.applyAction(state, idAt(state), { type: 'discard', turnId: state.turnId, card: state.drawn! }, now);
}
/** Plays safe turns (bots via tick, humans via actions) until the given seat is up. */
function until(state: State, seat: number) {
  let now = 0;
  while (state.current !== seat) {
    state.hands[state.current] = [...SAFE];
    if (state.seats[state.current].bot) { now = state.botAt; rules.tick(state, new Map(), 0, now); now = state.botAt; rules.tick(state, new Map(), 0, now); }
    else human(state, now);
  }
  return now;
}
function roundTrip(value: unknown) { assert.deepEqual(JSON.parse(JSON.stringify(value)), value); }

test('win detection partitions all nine cards into color sets and triples', () => {
  assert.equal(detectSets([1, 2, 3, 1, 2, 3, 7, 8, 9])?.length, 3);
  assert.equal(detectSets([1, 1, 1, 2, 2, 2, 3, 3, 3])?.length, 3);
  assert.deepEqual(detectSets([1, 1, 1, 1, 2, 3, 7, 8, 9])?.map(set => set.type).sort(), ['color', 'color', 'triple']);
  assert.equal(detectSets([22, 23, 24, 24, 24, 24, 10, 11, 12])?.length, 3);
  assert.equal(detectSets([1, 1, 1, 1, 2, 2, 3, 7, 8]), null);
  assert.equal(detectSets([1, 2, 3, 4, 5, 6, 7, 8]), null);
  assert.equal(detectSets([1, 2, 3, 4, 5, 6, 7, 8, 25]), null);
});

test('manifest, settings, actions and roster limits are strict', () => {
  assert.equal(manifest.players.min, 1); assert.equal(manifest.players.max, 4); assert.equal(manifest.supportsSolo, true);
  assert.deepEqual(rules.validateSettings({}), {});
  for (const raw of [null, [], { bots: 3 }]) assert.throws(() => rules.validateSettings(raw));
  for (const n of [0, 5]) assert.throws(() => game(n));
  assert.equal(rules.parseInput(null), null); assert.throws(() => rules.parseInput({}));
  for (const raw of [{ type: 'draw', turnId: 't', from: 4 }, { type: 'draw', turnId: 't', from: 'pile' }, { type: 'draw', turnId: 't', from: 'deck', extra: 1 }, { type: 'discard', turnId: 't', card: 0 }, { type: 'discard', turnId: 't', card: 1.5 }, { type: 'discard', card: 3 }, { type: 'steal', turnId: 't' }]) assert.throws(() => rules.parseAction(raw));
});

test('bots fill empty seats, deals are seeded, and projections keep hands private', () => {
  const state = game(1);
  assert.equal(state.seats.length, 4);
  assert.deepEqual(state.seats.map(seat => seat.bot), [false, true, true, true]);
  assert.equal(new Set(state.seats.map(seat => seat.name)).size, 4);
  assert(state.hands.every(hand => hand.length === 8));
  assert.deepEqual(game(1).hands, state.hands);
  const view = rules.publicView(state, context);
  assert(view.seats.every(seat => seat.hand === undefined && seat.handSize === 8));
  roundTrip(view); roundTrip(rules.playerView(state, 'p0', context));
  assert.equal(rules.playerView(state, 'stranger', context), null);
  assert.deepEqual(rules.outcome(state), { complete: false, winners: [], rows: [{ playerId: 'p0' }] });
});

test('a human turn validates ownership, stale turns and piles, then passes play and counts rounds', () => {
  const state = game(4);
  const seat = state.current, other = `p${(seat + 1) % 4}`, turnId = state.turnId;
  state.hands[seat] = [...SAFE];
  assert.throws(() => rules.applyAction(state, other, { type: 'draw', turnId, from: 'deck' }, 1), /not your turn/);
  assert.throws(() => rules.applyAction(state, idAt(state), { type: 'draw', turnId: 'old', from: 'deck' }, 1), /moved on/);
  assert.throws(() => rules.applyAction(state, idAt(state), { type: 'draw', turnId, from: 0 }, 1), /empty/);
  assert.throws(() => rules.applyAction(state, idAt(state), { type: 'discard', turnId, card: SAFE[0] }, 1), /Draw a card first/);
  rules.applyAction(state, idAt(state), { type: 'draw', turnId, from: 'deck' }, 1);
  assert.equal(state.phase, 'discard');
  assert.throws(() => rules.applyAction(state, idAt(state), { type: 'draw', turnId: state.turnId, from: 'deck' }, 1), /already drew/);
  assert.notEqual(state.turnId, turnId);
  assert.equal(rules.playerView(state, idAt(state), context)!.drawn, state.drawn);
  assert.equal(rules.playerView(state, other, context)!.drawn, null);
  const missing = [...Array(24).keys()].map(i => i + 1).find(id => ![...SAFE, state.drawn].includes(id))!;
  assert.throws(() => rules.applyAction(state, idAt(state), { type: 'discard', turnId: state.turnId, card: missing }, 1), /do not hold/);
  const discarded = state.hands[seat][0];
  rules.applyAction(state, idAt(state), { type: 'discard', turnId: state.turnId, card: discarded }, 1);
  assert.deepEqual(state.piles[seat], [discarded]);
  assert.equal(state.hands[seat].length, 8);
  assert.equal(state.current, (seat + 1) % 4);
  assert.equal(state.phase, 'draw');
  for (let i = 0; i < 3; i++) { state.hands[state.current] = [...SAFE]; human(state); }
  assert.equal(state.round, 2);
});

test('taking a discard that completes three sets wins and reveals every hand', () => {
  const state = game(2);
  until(state, 0);
  state.hands[0] = [1, 2, 3, 4, 5, 6, 7, 8];
  state.piles[1] = [9];
  rules.applyAction(state, 'p0', { type: 'draw', turnId: state.turnId, from: 1 }, 1);
  assert.equal(state.phase, 'won');
  assert.deepEqual(state.piles[1], []);
  const view = rules.publicView(state, { nowMs: 1, phase: 'results' });
  assert.equal(view.winner, 0); assert.equal(view.sets?.length, 3);
  assert(view.seats.every(seat => seat.hand?.length === (seat === view.seats[0] ? 9 : 8)));
  roundTrip(view);
  assert.deepEqual(rules.outcome(state), { complete: true, winners: ['p0'], rows: [{ playerId: 'p0', rank: 1 }, { playerId: 'p1', rank: 2 }] });
  assert.throws(() => rules.applyAction(state, 'p0', { type: 'discard', turnId: state.turnId, card: 1 }, 2), /game is over/);
  rules.tick(state, new Map(), 0, 1e9);
  assert.equal(state.phase, 'won');
});

test('bots draw after a pause, discard after another, and never act on a human turn', () => {
  const state = game(1, 99);
  const now = until(state, 1 % 4 === state.current ? 2 : 1);
  assert(state.seats[state.current].bot);
  state.hands[state.current] = [...SAFE];
  const seat = state.current, at = state.botAt;
  assert(at >= now);
  rules.tick(state, new Map(), 0, at - 1);
  assert.equal(state.phase, 'draw');
  rules.tick(state, new Map(), 0, at);
  assert.equal(state.phase, 'discard'); assert.equal(state.botAt, at + delays.discard);
  rules.tick(state, new Map(), 0, at + delays.discard);
  assert.equal(state.piles[seat].length, 1); assert.notEqual(state.current, seat);
  until(state, 0);
  assert.equal(state.botAt, Infinity);
  rules.tick(state, new Map(), 0, 1e9);
  assert.equal(state.current, 0); assert.equal(state.phase, 'draw');
});

test('a disconnected player is covered by a bot and takes over again on return', () => {
  const state = game(2, 5);
  until(state, 1);
  state.hands[1] = [...SAFE];
  rules.onPresenceChange(state, 'p1', false, 100);
  assert.equal(state.botAt, 100 + delays.draw);
  assert.equal(rules.publicView(state, context).seats[1].away, true);
  rules.tick(state, new Map(), 0, 100 + delays.draw);
  assert.equal(state.phase, 'discard');
  rules.onPresenceChange(state, 'p1', true, 1200);
  assert.equal(state.botAt, Infinity);
  rules.tick(state, new Map(), 0, 1e9);
  assert.equal(state.phase, 'discard');
  rules.applyAction(state, 'p1', { type: 'discard', turnId: state.turnId, card: state.drawn! }, 1300);
  assert.equal(state.current, 2);
  assert.match(state.log.map(entry => entry.text).join('\n'), /left — a bot is covering[\s\S]*is back/);
});
