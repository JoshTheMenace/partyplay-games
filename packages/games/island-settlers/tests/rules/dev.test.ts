import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCES, type DevKind } from '../../src/model';
import { devDeck } from '../../src/engine/dev';
import type { State } from '../../src/engine/state';
import { act, edit, game, inventory, rig, rob, tick, unchanged, view } from '../helpers';
import { blank, give, hand, settle, inland, toMain, last } from './helpers';

/** Advance one step of the turn cycle: roll, end the main step, or end the paired turn. */
function step(s: State) {
  const t = s.turn;
  if (t.stage === 'roll') { rig(s, [1, 2]); return act(s, t.active!, { type: 'roll' }); }
  act(s, t.stage === 'paired' ? t.partner! : t.active!, { type: 'end' });
}

/** Run the cycle until `seat` owns `stage`. */
function until(s: State, seat: string, stage: 'roll' | 'paired') {
  const owner = () => (stage === 'roll' ? s.turn.active : s.turn.partner);
  do step(s); while (!(s.turn.stage === stage && owner() === seat));
}

const hold = (s: State, seat: string, kind: DevKind) => edit(s, n => {
  n.seats[seat].dev.push({ id: `x${kind}${n.serial++}`, kind, boughtAt: -1 });
});
const card = (s: State, seat: string, kind: DevKind) => view(s, seat).dev.find(c => c.kind === kind)!;
const play = (s: State, seat: string, kind: DevKind, goods: (typeof RESOURCES)[number][] = []) =>
  act(s, seat, { type: 'play-dev', card: card(s, seat, kind).id, goods });

test('deck sizes follow the table size', () => {
  const count = (n: number, k: DevKind) => devDeck(n).filter(x => x === k).length;
  assert.deepEqual([4, 6, 8, 10].map(n => devDeck(n).length), [25, 34, 39, 47]);
  assert.deepEqual([4, 6, 8, 10].map(n => [count(n, 'knight'), count(n, 'victory'), count(n, 'monopoly')]),
    [[14, 5, 2], [20, 5, 3], [24, 6, 3], [28, 7, 4]]);
});

test('dev timing: never the opportunity it was bought, one per opportunity, allowed before the roll', () => {
  const s = blank(game(3)), a = s.turn.active!;
  toMain(s);
  give(s, a, { wool: 2, grain: 2, ore: 2 });
  edit(s, n => { n.devDeck.push('knight', 'knight'); });
  act(s, a, { type: 'buy-dev' });
  act(s, a, { type: 'buy-dev' });
  assert.deepEqual(view(s, a).dev.map(c => c.why?.code), ['bought-this-turn', 'bought-this-turn']);
  assert.equal(s.stats.seats[a].devBought, 2);
  until(s, a, 'roll');
  assert.ok(view(s, a).dev.every(c => c.playable));
  play(s, a, 'knight');
  assert.equal(s.seats[a].knights, 1);
  assert.equal(view(s, a).can.roll, false, 'the knight robber comes first');
  unchanged(s, () => act(s, a, { type: 'roll' }), /open decision/);
  rob(s, a);
  assert.deepEqual(view(s, a).dev.map(c => c.why?.code), ['one-per-turn']);
  act(s, a, { type: 'roll' });
  assert.equal(s.turn.stage, 'main');
});

test('Road Building before the roll blocks the roll until both free roads are placed', () => {
  const s = blank(game(3)), a = s.turn.active!;
  settle(s, a, inland(s)[0]);
  hold(s, a, 'road-building');
  play(s, a, 'road-building');
  const road = view(s, a).build.find(o => o.piece === 'road')!;
  assert.equal(road.free, 2);
  assert.equal(road.why, null, 'free routes need no cards');
  unchanged(s, () => act(s, a, { type: 'roll' }), /free roads/);
  for (let i = 0; i < 2; i++) {
    const at = view(s, a).build.find(o => o.piece === 'road')!.targets[0];
    act(s, a, { type: 'build', piece: 'road', at });
  }
  assert.deepEqual(hand(s, a), {});
  assert.equal(s.seats[a].freeRoutes, 0);
  act(s, a, { type: 'roll' });
});

test('Year of Plenty and Monopoly are bounded by the bank and conserve cards', () => {
  const s = blank(game(3)), [a, b, c] = s.order;
  hold(s, a, 'plenty');
  hold(s, a, 'monopoly');
  hold(s, a, 'plenty');
  toMain(s);
  play(s, a, 'plenty', ['ore', 'ore']);
  assert.equal(s.seats[a].hand.ore, 2);
  until(s, a, 'roll');
  toMain(s);
  give(s, b, { wool: 3 });
  give(s, c, { wool: 2, wood: 1 });
  const stock = inventory(s), before = s.seats[a].hand.wool;
  play(s, a, 'monopoly', ['wool']);
  assert.equal(s.seats[a].hand.wool, before + 5);
  const e = last(s, 'dev-play');
  assert.ok(e?.kind === 'dev-play' && e.count === 5);
  assert.deepEqual(e.taken, { [b]: 3, [c]: 2 });
  assert.deepEqual(inventory(s), stock);
  assert.ok(s.seats[b].inbox.some(x => x.tone === 'loss' && x.cards.wool === 3));
  until(s, a, 'roll');
  toMain(s);
  edit(s, n => {
    for (const g of RESOURCES) n.bank[g] = 0;
    n.bank.wood = 1;
  });
  unchanged(s, () => play(s, a, 'plenty', ['wood', 'wood']), /Choose two resources|does not have/);
  play(s, a, 'plenty', ['wood']);
  assert.equal(s.bank.wood, 0);
});

test('a paired opportunity is a new one for dev cards, and a Knight is allowed in it', () => {
  const s = blank(game(5)), p1 = s.order[0], partner = s.turn.partner!;
  toMain(s);
  hold(s, partner, 'knight');
  act(s, p1, { type: 'end' });
  assert.equal(s.turn.stage, 'paired');
  play(s, partner, 'knight');
  rob(s, partner);
  assert.equal(s.seats[partner].knights, 1);
  give(s, partner, { wool: 1, grain: 1, ore: 1 });
  edit(s, n => { n.devDeck.push('monopoly'); });
  act(s, partner, { type: 'buy-dev' });
  assert.equal(card(s, partner, 'monopoly').why?.code, 'bought-this-turn');
  until(s, partner, 'roll');
  assert.equal(card(s, partner, 'monopoly').playable, true, 'the next opportunity may play it');
});

test('Connect: a card bought in a round is playable from the next round', () => {
  const s = blank(game(3, { mode: 'connect' })), x = s.order[1];
  toMain(s);
  assert.equal(s.turn.stage, 'round');
  give(s, x, { wool: 1, grain: 1, ore: 1 });
  edit(s, n => { n.devDeck.push('knight'); });
  act(s, x, { type: 'buy-dev' });
  assert.equal(card(s, x, 'knight').why?.code, 'bought-this-turn');
  for (const id of s.order) act(s, id, { type: 'end' });
  tick(s, s.now + 5000);
  assert.equal(s.turn.round, 2);
  toMain(s);
  assert.equal(card(s, x, 'knight').playable, true);
});
