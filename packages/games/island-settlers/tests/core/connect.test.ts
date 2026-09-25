import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONNECT_MIN_OPEN_SECONDS } from '../../src/model';
import { openRobber } from '../../src/engine/prompts';
import type { State } from '../../src/engine/state';
import { act, edit, game, pastSetup, pub, rig, rob, tick, unchanged, view } from '../helpers';

function openWindow(seats: number) {
  const s = game(seats, { mode: 'connect', roundSeconds: 60 });
  pastSetup(s);
  rig(s, [2, 3]);
  act(s, s.turn.active!, { type: 'roll' });
  assert.equal(s.turn.stage, 'round');
  return s;
}

const MIN = CONNECT_MIN_OPEN_SECONDS * 1000;
const round = (s: State) => s.turn.round;

test('the window closes on all-ready after the minimum open time', () => {
  const s = openWindow(4), opened = s.turn.openedAt, r = round(s);
  assert.equal(pub(s).now.title, `Round ${r}: everyone plays`);
  for (const id of s.order) act(s, id, { type: 'end' });
  assert.equal(pub(s).now.detail, '4 of 4 done');
  tick(s, opened + MIN - 1);
  assert.equal(s.turn.stage, 'round');
  tick(s, opened + MIN);
  assert.equal(round(s), r + 1);
  assert.equal(s.turn.stage, 'roll');
  assert.equal(s.turn.active, s.order[1], 'the captain rotates');
});

test('the window closes at its deadline; offline seats count as ready', () => {
  const s = openWindow(3), opened = s.turn.openedAt, r = round(s);
  act(s, s.order[0], { type: 'end' });
  s.order.slice(1, 2).forEach(id => edit(s, n => { n.seats[id].connected = false; }));
  tick(s, opened + 59_999);
  assert.equal(s.turn.stage, 'round', 'one connected seat is still playing');
  tick(s, opened + 60_000);
  assert.equal(round(s), r + 1);
  assert.ok(s.events.some(e => e.kind === 'auto' && e.seat === s.order[2]));
});

test('a Knight (self robber prompt) in Connect does not block other seats', () => {
  const s = openWindow(4);
  const [knight, other] = s.order;
  edit(s, n => openRobber(n, knight, 'self'));
  unchanged(s, () => act(s, knight, { type: 'end' }), /Finish your open decision/);
  assert.doesNotThrow(() => view(s, other));
  assert.throws(() => act(s, other, { type: 'build', piece: 'road', at: s.board.edges[0].id }), (e: Error) =>
    !/Finish your open decision|Waiting for other players/.test(e.message));
  act(s, other, { type: 'end' });
  assert.equal(s.seats[other].ready, true);
  rob(s, knight);
  act(s, knight, { type: 'end' });
});
