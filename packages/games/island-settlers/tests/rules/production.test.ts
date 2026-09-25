import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCES, type Resource } from '../../src/model';
import { face } from '../../src/engine/legal';
import { harbormaster } from '../../src/engine/modules/harbormaster';
import { setRobber } from '../../src/engine/pieces';
import type { State } from '../../src/engine/state';
import { act, answer, edit, fastForward, game, inventory, pub, rig, view } from '../helpers';
import { blank, dice, give, hand, ix, settle, last } from './helpers';

/** Expected setup payout: one card per adjacent resource hex. */
function payoutOf(s: State, v: string) {
  const out: Partial<Record<Resource, number>> = {};
  for (const t of ix(s).vertex.get(v)!.tiles) {
    const g = face(s, t).terrain as Resource;
    if (RESOURCES.includes(g)) out[g] = (out[g] ?? 0) + 1;
  }
  return out;
}

function roundTwo(s: State, piece: 'settlement' | 'city') {
  fastForward(s, x => x.turn.setup?.round === 2);
  const seat = s.turn.active!, spots = view(s, seat).build.find(o => o.piece === piece)!.targets;
  const kinds = (v: string) => Object.keys(payoutOf(s, v)).length;
  const v = spots.reduce((a, b) => (kinds(b) > kinds(a) ? b : a));
  act(s, seat, { type: 'build', piece, at: v });
  return { seat, v };
}

test('setup round 2: the second settlement pays one resource per adjacent producing hex', () => {
  const s = game(3), stock = inventory(s);
  const { seat, v } = roundTwo(s, 'settlement');
  assert.deepEqual(hand(s, seat), payoutOf(s, v));
  const e = last(s, 'payout');
  assert.ok(e?.kind === 'payout' && e.seat === seat);
  assert.equal(e.grants.length, Object.values(payoutOf(s, v)).reduce((n, x) => n + x!, 0));
  assert.deepEqual(inventory(s), stock);
});

test('setup round 2 with Cities & Knights places a city that pays one resource per hex', () => {
  const s = game(3, { citiesKnights: true });
  const { seat, v } = roundTwo(s, 'city');
  assert.equal(s.pieces.buildings[v].kind, 'city');
  assert.deepEqual(hand(s, seat), payoutOf(s, v), 'no double yield and no commodities');
});

/** Seats on the corners of a numbered resource hex, the bank of that good set to `bank`. */
function hexScene(owners: { seat: number; kind: 'settlement' | 'city' }[], bank: number) {
  const s = blank(game(3));
  const tile = s.board.tiles.find(t => t.number > 0 && RESOURCES.includes(t.terrain as Resource))!;
  const good = tile.terrain as Resource, corners = ix(s).tileVertices.get(tile.id)!;
  owners.forEach((o, i) => settle(s, s.order[o.seat], corners[i * 2], o.kind));
  edit(s, n => {
    setRobber(n, n.board.tiles.find(t => t.terrain === 'desert')!.id);
    n.bank[good] = bank;
  });
  const stock = inventory(s);
  rig(s, dice(tile.number));
  act(s, s.turn.active!, { type: 'roll' });
  assert.deepEqual(inventory(s), stock, 'goods are conserved');
  const got = (seat: number) => s.seats[s.order[seat]].hand[good];
  return { s, tile, good, got, roll: pub(s).lastRoll! };
}

test('production: the bank pays everyone in full when it can', () => {
  const { got, roll, good } = hexScene([{ seat: 0, kind: 'city' }, { seat: 1, kind: 'settlement' }], 5);
  assert.deepEqual([got(0), got(1)], [2, 1]);
  assert.equal(roll.grants.filter(g => g.good === good).length, 2);
  assert.deepEqual(roll.shortages, []);
});

test('production: short with two recipients pays nobody that good', () => {
  const { s, got, roll, good } = hexScene([{ seat: 0, kind: 'city' }, { seat: 1, kind: 'settlement' }], 2);
  assert.deepEqual([got(0), got(1)], [0, 0]);
  assert.deepEqual(roll.shortages, [good]);
  assert.equal(s.bank[good], 2);
});

test('production: short with one recipient pays what is left', () => {
  const { s, got, roll, good } = hexScene([{ seat: 0, kind: 'city' }], 1);
  assert.equal(got(0), 1);
  assert.deepEqual(roll.grants.map(g => g.amount), [1]);
  assert.deepEqual(roll.shortages, []);
  assert.equal(s.bank[good], 0);
});

test('the robber blocks its hex and the yield shows in blocked', () => {
  const s = blank(game(3)), a = s.order[1];
  const tile = s.board.tiles.find(t => t.number > 0 && RESOURCES.includes(t.terrain as Resource))!;
  settle(s, a, ix(s).tileVertices.get(tile.id)![0], 'city');
  edit(s, n => setRobber(n, tile.id));
  rig(s, dice(tile.number));
  act(s, s.turn.active!, { type: 'roll' });
  const roll = pub(s).lastRoll!;
  assert.deepEqual(roll.blocked.filter(b => b.tile === tile.id), [
    { seat: a, tile: tile.id, good: tile.terrain, amount: 2, by: 'robber' },
  ]);
  assert.ok(!roll.grants.some(g => g.tile === tile.id));
  assert.equal(s.stats.seats[a].blocked, 2);
});

test('a 7: discards of floor(n/2) above the limit (module hooks raise it), then a conserving steal', () => {
  const s = blank(game(3, { variants: ['harbormaster'] })), [a, b, c] = s.order;
  harbormaster.discardLimit = (_s, seat) => (seat === c ? 2 : 0);
  try {
    const target = s.board.tiles.find(t => t.number > 0 && t.id !== s.pieces.robber)!;
    settle(s, b, ix(s).tileVertices.get(target.id)![0]);
    give(s, b, { wood: 5, brick: 4 });
    give(s, c, { wool: 5, grain: 4 });
    give(s, a, { ore: 3 });
    assert.equal(pub(s).seats.find(x => x.id === c)!.discardLimit, 9);
    rig(s, [3, 4]);
    act(s, a, { type: 'roll' });
    const chips = pub(s).prompts;
    assert.deepEqual(chips.map(p => [p.seat, p.kind, p.count]), [[b, 'discard', 4]]);
    answer(s, b, 'discard', {}, { cards: { wood: 4 } });
    const stock = inventory(s);
    answer(s, a, 'robber', { tile: target.id });
    assert.equal(s.pieces.robber, target.id);
    assert.equal(Object.values(hand(s, b)).reduce((n, x) => n + x!, 0), 4);
    assert.equal(Object.values(hand(s, a)).reduce((n, x) => n + x!, 0), 4);
    assert.deepEqual(inventory(s), stock);
    const e = last(s, 'robber');
    assert.ok(e?.kind === 'robber' && e.victim === b && e.from !== target.id);
  } finally {
    delete harbormaster.discardLimit;
  }
});
