import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCES, type Resource } from '../../src/model';
import { rates } from '../../src/engine/trade';
import type { State } from '../../src/engine/state';
import { act, edit, unchanged, view } from '../helpers';
import { conserved, deal, eventsOf, hand, seats, trading } from './helpers';

/** Clear setup buildings so no seat starts on a port. */
const noPorts = (s: State) => (edit(s, n => { n.pieces.buildings = {}; }), s);

/** Give `seat` a settlement on a port of this kind; returns the 2:1 good when asked for one. */
function onPort(s: State, seat: string, kind: 'any' | 'resource'): Resource | null {
  const port = s.board.ports.find(p => (kind === 'any') === (p.good === 'any'))!;
  const v = port.vertices[0];
  edit(s, n => { n.pieces.buildings[v] = { vertex: v, seat, kind: 'settlement' }; });
  return port.good === 'any' ? null : port.good;
}

test('4:1 by default; any number of lots at once', () => {
  const s = noPorts(trading(4)), [a] = seats(s), ore = s.stats.seats[a].gained.ore ?? 0;
  deal(s, { [a]: { wool: 8, grain: 4 } });
  assert.deepEqual(view(s, a).rates, Object.fromEntries(Object.keys(s.bank).map(g => [g, 4])));
  conserved(s, () => act(s, a, { type: 'bank', give: { wool: 8, grain: 4 }, get: { ore: 2, brick: 1 } }));
  assert.deepEqual(hand(s, a), { ore: 2, brick: 1 });
  const e = eventsOf(s, 'bank').at(-1)!;
  assert.deepEqual([e.seat, e.give, e.get], [a, { wool: 8, grain: 4 }, { ore: 2, brick: 1 }]);
  assert.deepEqual([s.stats.seats[a].bankTrades, s.stats.seats[a].gained.ore], [1, ore + 2]);
});

test('4:1, 3:1 and 2:1 mix in one trade from the best rate per good', () => {
  const s = noPorts(trading(4)), [a, b] = seats(s);
  const good = onPort(s, a, 'resource')!, other = RESOURCES.filter(g => g !== good);
  assert.equal(rates(s, a)[good], 2);
  assert.equal(rates(s, b)[good], 4, 'ports belong to the building owner');
  deal(s, { [a]: { [good]: 2, [other[0]]: 4 } });
  conserved(s, () => act(s, a, { type: 'bank', give: { [good]: 2, [other[0]]: 4 }, get: { [other[1]]: 2 } }));
  onPort(s, a, 'any');
  assert.deepEqual([rates(s, a)[good], rates(s, a)[other[0]]], [2, 3]);
  deal(s, { [a]: { [good]: 4, [other[0]]: 3 } });
  conserved(s, () => act(s, a, { type: 'bank', give: { [good]: 4, [other[0]]: 3 }, get: { [other[1]]: 3 } }));
  assert.deepEqual(hand(s, a), { [other[1]]: 3 });
});

test('bank validation: multiples of the rate, lots match get, no overlap, bank must hold get', () => {
  const s = trading(4), [a] = seats(s);
  deal(s, { [a]: { wool: 9, ore: 4 } });
  const bad = [
    [{ wool: 3 }, { ore: 1 }, /lots of its trade rate/], [{ wool: 8 }, { brick: 1 }, /pays for 2 cards/],
    [{ wool: 4 }, { brick: 2 }, /pays for 1 card\./], [{ wool: 4 }, { wool: 1 }, /both sides/],
    [{ wool: 4 }, {}, /both sides/], [{ grain: 4 }, { ore: 1 }, /do not have/],
  ] as const;
  for (const [give, get, message] of bad) unchanged(s, () => act(s, a, { type: 'bank', give, get }), message);
  edit(s, n => { n.seats[a].hand.brick += n.bank.brick; n.bank.brick = 0; });
  unchanged(s, () => act(s, a, { type: 'bank', give: { wool: 4 }, get: { brick: 1 } }), /bank does not have/);
});
