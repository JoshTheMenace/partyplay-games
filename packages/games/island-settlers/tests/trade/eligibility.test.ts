import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presence } from '../../src/engine/index';
import { openRobber } from '../../src/engine/prompts';
import { partners, tradeWhy } from '../../src/engine/trade';
import type { State } from '../../src/engine/state';
import { act, edit, game, pastSetup, unchanged, view } from '../helpers';
import { deal, hand, seats, trading } from './helpers';

const WOOL_FOR_ORE = { type: 'offer', give: { wool: 1 }, want: { ore: 1 }, counterTo: null } as const;
const code = (s: State, id: string) => {
  const w = tradeWhy(s, id);
  return [w.propose?.code ?? null, w.bank?.code ?? null];
};

test('setup and roll: nobody trades yet', () => {
  const s = game(4);
  assert.deepEqual(code(s, s.turn.active!), ['stage', 'stage']);
  pastSetup(s);
  const [a, b] = seats(s);
  deal(s, { [a]: { wool: 4 }, [b]: { wool: 4 } });
  assert.deepEqual(code(s, a), ['roll-first', 'roll-first']);
  assert.deepEqual(partners(s, b), []);
  unchanged(s, () => act(s, b, { ...WOOL_FOR_ORE, to: [a] }), /Nobody can trade/);
  unchanged(s, () => act(s, a, { type: 'bank', give: { wool: 4 }, get: { ore: 1 } }), /Roll first/);
});

test('Standard main: the active seat trades with all; others only with the active seat', () => {
  const s = trading(4), [a, b, c, d] = seats(s);
  deal(s, { [a]: { ore: 1 }, [b]: { wool: 4 }, [c]: { wool: 1 } });
  assert.deepEqual(partners(s, a), [b, c, d].sort((x, y) => s.order.indexOf(x) - s.order.indexOf(y)));
  assert.deepEqual([partners(s, b), view(s, b).partners], [[a], [a]]);
  assert.deepEqual(code(s, b), [null, 'not-your-turn']);
  unchanged(s, () => act(s, b, { ...WOOL_FOR_ORE, to: [c] }), /cannot trade with that player/);
  unchanged(s, () => act(s, b, { type: 'bank', give: { wool: 4 }, get: { ore: 1 } }), /on your turn/);
  act(s, b, { ...WOOL_FOR_ORE, to: [] });
  const o = Object.values(s.offers)[0];
  assert.deepEqual([o.to, o.broadcast], [[a], true], 'a non-active broadcast reaches only the active seat');
  act(s, c, { ...WOOL_FOR_ORE, to: [a] });
  act(s, a, { type: 'respond', offer: o.id, answer: 'accept' });
  const after = [{ wool: 1 }, { wool: 3, ore: 1 }];
  assert.deepEqual([hand(s, a), hand(s, b)], after, 'single recipient: no confirm');
  assert.equal(Object.keys(s.offers).length, 1, 'c still waits (a now lacks ore)');
});

test('5–6 paired build turn: bank only, nobody trades with players', () => {
  const s = trading(5), [a] = seats(s), partner = s.turn.partner!;
  deal(s, { [a]: { wool: 1 }, [partner]: { wool: 4 } });
  act(s, a, { ...WOOL_FOR_ORE, to: [partner] });
  act(s, a, { type: 'end' });
  assert.deepEqual([s.turn.stage, s.offers], ['paired', {}]);
  const bankOnly = { code: 'rule', text: 'Build turns trade with the bank only.' };
  assert.deepEqual(view(s, partner).why.propose, bankOnly);
  assert.deepEqual([view(s, partner).can.bank, partners(s, partner)], [true, []]);
  for (const id of s.order.filter(x => x !== partner)) assert.deepEqual(partners(s, id), []);
  unchanged(s, () => act(s, partner, { ...WOOL_FOR_ORE, to: [] }), /bank only/);
  act(s, partner, { type: 'bank', give: { wool: 4 }, get: { ore: 1 } });
  assert.deepEqual(hand(s, partner), { ore: 1 });
});

test('7–10 concurrent partner: bank only, and Player 1 cannot trade with them', () => {
  const s = trading(7), [a, b] = seats(s), partner = s.turn.partner!;
  deal(s, { [a]: { wool: 1 }, [partner]: { wool: 4 } });
  assert.ok(!partners(s, a).includes(partner) && partners(s, a).includes(b));
  assert.deepEqual([code(s, partner), partners(s, partner)], [['rule', null], []]);
  unchanged(s, () => act(s, a, { ...WOOL_FOR_ORE, to: [partner] }), /cannot trade with that player/);
  act(s, a, { ...WOOL_FOR_ORE, to: [] });
  assert.ok(!Object.values(s.offers)[0].to.includes(partner));
  act(s, partner, { type: 'bank', give: { wool: 4 }, get: { grain: 1 } });
  act(s, a, { type: 'end' });
  assert.deepEqual([s.turn.stage, s.offers], ['main', {}], 'the partner still builds; player trades closed');
  assert.deepEqual(partners(s, b), []);
});

test('Connect: seats in the window trade; done or offline seats are not offered to', () => {
  const s = trading(4, { mode: 'connect', roundSeconds: 120 }), [a, b, c, d] = s.order;
  deal(s, { [a]: { wool: 2 }, [b]: { ore: 1 }, [c]: { wool: 1 }, [d]: { ore: 1 } });
  assert.deepEqual(partners(s, c), [a, b, d]);
  act(s, a, { ...WOOL_FOR_ORE, to: [] });
  act(s, c, { ...WOOL_FOR_ORE, to: [d] });
  act(s, b, { type: 'end' });
  presence(s, d, false, s.now);
  assert.deepEqual([partners(s, a), partners(s, b)], [[c], []]);
  assert.deepEqual(code(s, b), ['stage', 'stage']);
  act(s, c, { type: 'end' });
  assert.equal(Object.values(s.offers).some(o => o.from === c), false, 'done withdraws your own offers');
  const o = Object.values(s.offers)[0];
  act(s, b, { type: 'respond', offer: o.id, answer: 'accept' });
  act(s, a, { type: 'confirm-trade', offer: o.id, partner: b });
  const after = [{ wool: 1, ore: 1 }, { wool: 1 }];
  assert.deepEqual([hand(s, a), hand(s, b)], after, 'a done seat may still answer');
});

test('a table prompt holds single-recipient completion; own prompts and movement block proposing', () => {
  const s = trading(4), [a, b, c] = seats(s);
  deal(s, { [a]: { wool: 2 }, [b]: { ore: 1 }, [c]: { ore: 1 } });
  act(s, a, { ...WOOL_FOR_ORE, to: [b] });
  act(s, c, { ...WOOL_FOR_ORE, give: { ore: 1 }, want: { wool: 1 }, to: [a] });
  edit(s, n => openRobber(n, a, 'table'));
  const [single] = view(s, b).offers;
  assert.deepEqual([single.canAccept, single.why?.code], [false, 'prompt']);
  unchanged(s, () => act(s, b, { type: 'respond', offer: single.id, answer: 'accept' }), /Waiting for other/);
  assert.deepEqual(code(s, a), ['prompt', 'prompt']);
  act(s, b, { type: 'respond', offer: single.id, answer: 'decline' });
  edit(s, n => { n.prompts = {}; });
  s.profile = { ...s.profile, movementLocksBuilding: true };
  edit(s, n => { n.seats[a].moved = true; });
  assert.deepEqual(code(s, a), ['moved', 'moved']);
  assert.deepEqual(s.offers, {}, 'a moving seat cannot trade, so its open offers close');
});

test('a seat that started moving can still decline, but not accept', () => {
  const s = trading(4, { mode: 'connect', scenarios: ['deliveries'] }), [a, b, c] = seats(s);
  deal(s, { [a]: { wool: 1 }, [b]: { ore: 1 }, [c]: { ore: 1 } });
  act(s, a, { ...WOOL_FOR_ORE, to: [] });
  const o = Object.values(s.offers)[0].id;
  edit(s, n => { n.seats[b].moved = true; });
  unchanged(s, () => act(s, b, { type: 'respond', offer: o, answer: 'accept' }), /cannot trade/);
  act(s, b, { type: 'respond', offer: o, answer: 'decline', reason: 'Busy' });
  assert.equal(s.offers[o].responses[b], 'decline');
});
