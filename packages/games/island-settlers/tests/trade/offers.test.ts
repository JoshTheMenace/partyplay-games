import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edit, act, pub, serializable, tick, unchanged, view } from '../helpers';
import { conserved, deal, eventsOf, hand, seats, trading } from './helpers';

const WOOL_FOR_ORE = { type: 'offer', give: { wool: 1 }, want: { ore: 1 }, counterTo: null } as const;
const only = (s: ReturnType<typeof trading>) => Object.values(s.offers);

test('a targeted offer completes the moment its single recipient accepts', () => {
  const s = trading(4), [a, b] = seats(s);
  deal(s, { [a]: { wool: 2 }, [b]: { ore: 1 } });
  conserved(s, () => {
    act(s, a, { type: 'offer', give: { wool: 2 }, want: { ore: 1 }, to: [b], counterTo: null });
    const o = only(s)[0];
    assert.deepEqual([o.to, o.broadcast, o.responses], [[b], false, { [b]: 'pending' }]);
    assert.deepEqual(view(s, b).offers, [{ id: o.id, canAccept: true, canCounter: true, why: null }]);
    act(s, b, { type: 'respond', offer: o.id, answer: 'accept' });
    assert.deepEqual([hand(s, a), hand(s, b), s.offers], [{ ore: 1 }, { wool: 2 }, {}]);
    const done = eventsOf(s, 'trade').at(-1)!;
    const fields = [done.offer, done.seat, done.partner, done.give, done.get];
    assert.deepEqual(fields, [o.id, a, b, { wool: 2 }, { ore: 1 }]);
    assert.deepEqual([s.stats.seats[a].trades, s.stats.seats[b].trades], [1, 1]);
  });
  serializable(s);
});

test('a broadcast needs confirm-trade with a seat that accepted; answers may change', () => {
  const s = trading(4), [a, b, c, d] = seats(s);
  deal(s, { [a]: { brick: 1 }, [b]: { grain: 1 }, [c]: { grain: 1 } });
  conserved(s, () => {
    act(s, a, { type: 'offer', give: { brick: 1 }, want: { grain: 1 }, to: [], counterTo: null });
    const o = only(s)[0];
    assert.deepEqual([o.to, o.broadcast], [[b, c, d], true]);
    assert.equal(eventsOf(s, 'offer').at(-1)!.change, 'posted');
    assert.equal(pub(s).offers[0].responses[d], 'pending', 'the public view never reveals who can pay');
    assert.equal(view(s, d).offers[0].canAccept, false, 'd learns privately that it cannot pay');
    act(s, b, { type: 'respond', offer: o.id, answer: 'accept' });
    act(s, c, { type: 'respond', offer: o.id, answer: 'decline', reason: 'Not while you lead' });
    assert.deepEqual([o.id in s.offers, s.offers[o.id].reasons], [true, { [c]: 'Not while you lead' }]);
    unchanged(s, () => act(s, a, { type: 'confirm-trade', offer: o.id, partner: c }), /accepted/);
    unchanged(s, () => act(s, b, { type: 'confirm-trade', offer: o.id, partner: b }), /no longer open/);
    act(s, b, { type: 'respond', offer: o.id, answer: 'decline' });
    unchanged(s, () => act(s, a, { type: 'confirm-trade', offer: o.id, partner: b }), /accepted/);
    act(s, c, { type: 'respond', offer: o.id, answer: 'accept' });
    assert.deepEqual(s.offers[o.id].reasons, {}, 'a new answer without a reason clears the old one');
    act(s, a, { type: 'confirm-trade', offer: o.id, partner: c });
    assert.deepEqual([hand(s, a), hand(s, c), s.offers], [{ grain: 1 }, { brick: 1 }, {}]);
  });
});

test('a counter goes to the proposer, marks the parent, and completes on their accept', () => {
  const s = trading(4), [a, b, c] = seats(s);
  deal(s, { [a]: { wool: 3, ore: 1 }, [b]: { ore: 2 } });
  act(s, a, { type: 'offer', give: { wool: 3 }, want: { ore: 1 }, to: [], counterTo: null });
  const parent = only(s)[0].id;
  const counter = { type: 'offer', give: { ore: 1 }, want: { wool: 1 }, counterTo: parent } as const;
  unchanged(s, () => act(s, b, { ...counter, to: [c] }), /goes back/);
  act(s, b, { ...counter, to: [] });
  act(s, b, { ...counter, want: { wool: 2 }, to: [a] });
  const counters = only(s).filter(o => o.counterTo === parent);
  assert.equal(counters.length, 1, 'one live counter per seat per parent');
  assert.deepEqual([counters[0].to, s.offers[parent].responses[b]], [[a], 'counter']);
  conserved(s, () => act(s, a, { type: 'respond', offer: counters[0].id, answer: 'accept' }));
  assert.deepEqual([hand(s, a), hand(s, b)], [{ wool: 1, ore: 2 }, { ore: 1, wool: 2 }]);
  assert.equal(s.offers[parent], undefined, 'a can no longer pay 3 wool, so the parent is invalid');
  assert.equal(eventsOf(s, 'offer').at(-1)!.change, 'invalid');
});

test('closing a parent closes its counters and a closed counter frees the parent answer', () => {
  const s = trading(4), [a, b, c] = seats(s);
  deal(s, { [a]: { wool: 1 }, [b]: { ore: 1 }, [c]: { ore: 1 } });
  act(s, a, { type: 'offer', give: { wool: 1 }, want: { ore: 1 }, to: [], counterTo: null });
  const parent = only(s)[0].id;
  act(s, b, { type: 'offer', give: { ore: 1 }, want: { wool: 1 }, to: [], counterTo: parent });
  act(s, b, { type: 'withdraw', offer: only(s)[1].id });
  assert.equal(s.offers[parent].responses[b], 'pending');
  act(s, c, { type: 'offer', give: { ore: 1 }, want: { wool: 1 }, to: [], counterTo: parent });
  unchanged(s, () => act(s, b, { type: 'withdraw', offer: parent }), /no longer open/);
  act(s, a, { type: 'withdraw', offer: parent });
  assert.deepEqual(s.offers, {});
  assert.deepEqual(eventsOf(s, 'offer').slice(-2).map(e => e.change), ['withdrawn', 'withdrawn']);
});

test('one live offer per seat: a new one withdraws the old', () => {
  const s = trading(4), [a, b] = seats(s);
  deal(s, { [a]: { wool: 2 }, [b]: { ore: 2 } });
  act(s, a, { type: 'offer', give: { wool: 1 }, want: { ore: 1 }, to: [b], counterTo: null });
  const first = only(s)[0].id;
  act(s, a, { type: 'offer', give: { wool: 2 }, want: { ore: 1 }, to: [b], counterTo: null });
  assert.deepEqual(only(s).map(o => o.give), [{ wool: 2 }]);
  assert.ok(eventsOf(s, 'offer').some(e => e.offer === first && e.change === 'withdrawn'));
});

test('at most 12 open offers', () => {
  const s = trading(10, { mode: 'connect', roundSeconds: 120 }), ids = s.order;
  deal(s, Object.fromEntries(ids.map(id => [id, { wool: 1, brick: 3 }])));
  for (const id of ids) act(s, id, { ...WOOL_FOR_ORE, to: [] });
  const parents = only(s).map(o => o.id);
  act(s, ids[0], { type: 'offer', give: { brick: 1 }, want: { grain: 1 }, to: [], counterTo: parents[1] });
  act(s, ids[0], { type: 'offer', give: { brick: 1 }, want: { grain: 1 }, to: [], counterTo: parents[2] });
  assert.equal(only(s).length, 12);
  unchanged(s, () => act(s, ids[0], { type: 'offer', give: { brick: 1 }, want: { grain: 1 }, to: [],
    counterTo: parents[3] }), /Too many open offers/);
  act(s, ids[0], { type: 'offer', give: { brick: 1 }, want: { grain: 2 }, to: [], counterTo: parents[2] });
  assert.equal(only(s).length, 12, 'replacing your own counter is not blocked by the cap');
});

test('offers expire by the offer timer and when the proposer\'s opportunity ends', () => {
  const s = trading(4), [a, b] = seats(s);
  deal(s, { [a]: { wool: 1 }, [b]: { ore: 1 } });
  act(s, a, { type: 'offer', give: { wool: 1 }, want: { ore: 1 }, to: [b], counterTo: null });
  const o = only(s)[0];
  assert.equal(o.expires, s.now + 45_000);
  tick(s, o.expires! - 1);
  assert.ok(s.offers[o.id]);
  tick(s, o.expires!);
  assert.deepEqual([s.offers, eventsOf(s, 'offer').at(-1)!.change], [{}, 'expired']);
  act(s, a, { type: 'offer', give: { wool: 1 }, want: { ore: 1 }, to: [b], counterTo: null });
  act(s, b, { type: 'offer', give: { ore: 1 }, want: { wool: 1 }, to: [a], counterTo: null });
  act(s, a, { type: 'end' });
  assert.deepEqual(s.offers, {}, 'offers to the active seat close with its turn too');
  assert.deepEqual(eventsOf(s, 'offer').slice(-2).map(e => e.change), ['expired', 'expired']);
});

test('the Off preset posts offers without an expiry', () => {
  const s = trading(3), [a, b] = seats(s);
  s.settings = { ...s.settings, timer: 'off' };
  deal(s, { [a]: { wool: 1 } });
  act(s, a, { type: 'offer', give: { wool: 1 }, want: { ore: 1 }, to: [b], counterTo: null });
  assert.equal(only(s)[0].expires, null);
});

test('auto-invalidation: proposer spends → removed; acceptor spends → pending again', () => {
  const s = trading(4), [a, b, c] = seats(s);
  deal(s, { [a]: { wool: 4 }, [b]: { ore: 1 }, [c]: { ore: 1 } });
  act(s, a, { type: 'offer', give: { wool: 1 }, want: { ore: 1 }, to: [], counterTo: null });
  const o = only(s)[0].id;
  act(s, b, { type: 'respond', offer: o, answer: 'accept' });
  edit(s, n => { n.seats[b].hand.ore = 0; n.bank.ore++; });
  assert.deepEqual([s.offers[o].responses[b], pub(s).offers[0].responses[b]], ['pending', 'pending']);
  assert.deepEqual(view(s, b).offers[0], {
    id: o, canAccept: false, canCounter: true, why: { code: 'cost', text: 'You have 0 ore.' },
  });
  unchanged(s, () => act(s, b, { type: 'respond', offer: o, answer: 'accept' }), /You have 0 ore/);
  act(s, a, { type: 'bank', give: { wool: 4 }, get: { brick: 1 } });
  assert.deepEqual(s.offers, {});
  assert.deepEqual(eventsOf(s, 'offer').at(-1)!.change, 'invalid');
});

test('auto-invalidation: an acceptor who starts moving goes back to pending; others still trade', () => {
  const s = trading(4, { mode: 'connect', roundSeconds: 120 }), [a, b, c] = seats(s);
  deal(s, { [a]: { wool: 1 }, [b]: { ore: 1 }, [c]: { ore: 1 } });
  act(s, a, { ...WOOL_FOR_ORE, to: [] });
  const o = only(s)[0].id;
  act(s, b, { type: 'respond', offer: o, answer: 'accept' });
  edit(s, n => { n.profile.movementLocksBuilding = true; n.seats[b].moved = true; });
  assert.equal(s.offers[o].responses[b], 'pending', 'a stale accept cannot be confirmed');
  unchanged(s, () => act(s, a, { type: 'confirm-trade', offer: o, partner: b }), /accepted/);
  act(s, c, { type: 'respond', offer: o, answer: 'accept' });
  conserved(s, () => act(s, a, { type: 'confirm-trade', offer: o, partner: c }));
  assert.deepEqual([hand(s, a), hand(s, c)], [{ ore: 1 }, { wool: 1 }]);
});

test('offer validation: no gifts, no same good on both sides, must hold give, no unused goods', () => {
  const s = trading(4), [a, b] = seats(s);
  deal(s, { [a]: { wool: 2 } });
  const bad = [
    [{ wool: 1 }, {}, /both sides/], [{}, { ore: 1 }, /both sides/],
    [{ wool: 1 }, { wool: 1, ore: 1 }, /both sides/],
    [{ wool: 3 }, { ore: 1 }, /do not have/], [{ wool: 1 }, { paper: 1 }, /not in this game/],
  ] as const;
  for (const [give, want, message] of bad) {
    unchanged(s, () => act(s, a, { type: 'offer', give, want, to: [b], counterTo: null }), message);
  }
  unchanged(s, () => act(s, a, { ...WOOL_FOR_ORE, to: [a] }), /cannot trade with that player/);
  unchanged(s, () => act(s, a, { ...WOOL_FOR_ORE, to: [b], counterTo: 'o999' }), /no longer open/);
});
