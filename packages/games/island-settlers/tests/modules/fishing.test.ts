/** Fishing on Catan: grounds and lake, fish tokens and the old boot, every fish spend, CPU matches. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESOURCES, type BoardFeature, type Mode, type Settings } from '../../src/model';
import { boardIndex } from '../../src/engine/board/lookup';
import { FISH_CAP, fx, payment, type FishToken } from '../../src/engine/modules/fishing';
import { robberTiles } from '../../src/engine/legal';
import { setRobber } from '../../src/engine/pieces';
import type { State } from '../../src/engine/state';
import { runMatch } from '../cpu/match';
import { act, command, edit, game, inventory, pub, rig, serializable, unchanged, view } from '../helpers';
import { blank, dice, give, settle, toMain } from '../rules/helpers';

type Ground = Extract<BoardFeature, { kind: 'fishing-ground' }>;
const FISHING = { scenarios: ['fishing' as const] };
const grounds = (s: State) => s.board.features.filter((f): f is Ground => f.kind === 'fishing-ground');
const TOKENS = (s: State) => (s.order.length >= 7 ? 58 : s.order.length >= 5 ? 43 : 29) + 1;

/** Every token is in the supply, the discard pile, a hand or the boot holder's area. */
function fishCount(s: State) {
  const x = fx(s);
  const held = Object.values(x.hands).reduce((n, h) => n + h.length, 0);
  return x.deck.length + x.discard.length + held + (x.boot ? 1 : 0);
}

/** Past setup with an empty board and no fish anywhere but the supply. */
function fresh(seats = 4, mode: Mode = 'standard') {
  const s = blank(game(seats, { ...FISHING, mode }));
  edit(s, n => {
    const x = fx(n);
    for (const id of n.order) { x.deck.push(...x.hands[id].map(t => t.value)); x.hands[id] = []; }
    x.deck.push(...x.discard, ...(x.boot ? [0] : []));
    Object.assign(x, { discard: [], boot: null });
  });
  return s;
}

/** Move tokens of these values from the supply into `seat`'s hand. */
const fish = (s: State, seat: string, values: number[]) => edit(s, n => {
  const x = fx(n);
  for (const v of values) {
    x.deck.splice(x.deck.indexOf(v), 1);
    x.hands[seat].push({ id: `t${n.serial++}`, value: v });
  }
});

test('board: 6 / 8 / 10 coastal grounds on 3-corner sea hexes, an inland lake, ports untouched', () => {
  for (const [seats, count, ports] of [[4, 6, 9], [6, 8, 11], [10, 10, 13]]) for (const seed of [1, 2, 3]) {
    const s = game(seats, FISHING, seed), ix = boardIndex(s.board), all = grounds(s);
    const coast = all.filter(g => g.id !== 'lake'), lake = all.find(g => g.id === 'lake')!;
    assert.equal(coast.length, count, `${seats} seats seed ${seed}`);
    assert.equal(s.board.ports.length, ports, 'fishing never costs a port');
    const used = coast.flatMap(g => g.vertices);
    assert.equal(new Set(used).size, used.length, 'grounds share no corner');
    for (const g of coast) {
      assert.equal(ix.tile.get(g.tile)!.terrain, 'sea');
      assert.equal(g.vertices.length, 3);
      assert.ok(g.vertices.every(v => ix.tileVertices.get(g.tile)!.includes(v)));
      assert.ok(g.vertices.every(v => ix.vertex.get(v)!.tiles.some(t => ix.tile.get(t)!.terrain !== 'sea')));
    }
    assert.equal(new Set(coast.map(g => g.numbers[0])).size, 6, 'every number 4-10 has a ground');
    assert.ok(coast.every(g => [4, 5, 6, 8, 9, 10].includes(g.numbers[0])));
    const t = ix.tile.get(lake.tile)!;
    assert.deepEqual([t.terrain, t.number, lake.numbers], ['lake', 0, [2, 3, 11, 12]]);
    assert.ok(ix.tileNeighbors.get(t.id)!.every(n => n.terrain !== 'sea'), 'the lake is inland');
    assert.deepEqual(game(seats, FISHING, seed).board, s.board, 'deterministic');
  }
});

test('board: no lake with Rivers, T&B or Fog Islands (official sheets); by the oasis with Caravans', () => {
  const combos: Partial<Settings>[] = [
    { scenarios: ['fishing', 'rivers'] }, { scenarios: ['fishing', 'deliveries'] },
    { scenarios: ['fishing'], map: 'seafarers', seafarers: 'fog-islands' },
  ];
  for (const extra of combos) {
    assert.ok(!grounds(game(4, extra)).some(g => g.id === 'lake'), JSON.stringify(extra));
  }
  const s = game(4, { scenarios: ['fishing', 'caravans'] }), ix = boardIndex(s.board);
  const lake = grounds(s).find(g => g.id === 'lake')!;
  const oasis = s.board.tiles.find(t => t.terrain === 'oasis')!;
  assert.ok(ix.tileNeighbors.get(oasis.id)!.some(t => t.id === lake.tile));
});

test('production: settlement 1 token, city 2; the robber blocks the lake; fish are not cards', () => {
  const s = fresh(), [a, b] = s.order, ground = grounds(s).find(g => g.id !== 'lake')!;
  const lake = grounds(s).find(g => g.id === 'lake')!;
  settle(s, a, ground.vertices[0]);
  settle(s, b, ground.vertices[2], 'city');
  const stock = inventory(s), before = fishCount(s);
  rig(s, dice(ground.numbers[0]));
  act(s, a, { type: 'roll' });
  assert.equal(fx(s).hands[a].length + (fx(s).boot === a ? 1 : 0), 1);
  assert.equal(fx(s).hands[b].length + (fx(s).boot === b ? 1 : 0), 2);
  assert.deepEqual(inventory(s), stock, 'no cards moved');
  assert.equal(fishCount(s), before);
  assert.equal(pub(s).seats.find(x => x.id === b)!.cards, 0, 'fish never count as cards');
  const s2 = fresh(), [c] = s2.order, l2 = grounds(s2).find(g => g.id === 'lake')!;
  settle(s2, c, l2.vertices[0]);
  assert.ok(robberTiles(s2, c, 'robber').includes(l2.tile), 'the robber may enter the lake (T&B p.10)');
  edit(s2, n => setRobber(n, l2.tile));
  rig(s2, dice(3));
  act(s2, c, { type: 'roll' });
  assert.equal(fx(s2).hands[c].length, 0, 'the robber on the lake blocks all four numbers');
  assert.equal(lake.numbers.length, 4);
});

test('supply: 29 tokens + the boot; T&B 5–6 adds 14; 7+ seats double the tokens', () => {
  assert.deepEqual([4, 6, 8].map(n => fishCount(game(n, FISHING))), [30, 44, 59]);
});

test('supply: tokens reshuffle from the discard pile, and nobody holds more than 7', () => {
  const s = fresh(), [a] = s.order, ground = grounds(s).find(g => g.id !== 'lake')!;
  settle(s, a, ground.vertices[1], 'city');
  fish(s, a, [1, 1, 1, 1, 1, 1]);
  edit(s, n => {
    const x = fx(n);
    x.discard.push(...x.deck.filter(v => v));
    x.deck = x.deck.filter(v => !v);
  });
  rig(s, dice(ground.numbers[0]));
  act(s, a, { type: 'roll' });
  assert.equal(fx(s).hands[a].length, FISH_CAP);
  assert.equal(fishCount(s), TOKENS(s));
});

test('setup: a second settlement beside a fishing ground catches one token', () => {
  const s = game(4, FISHING);
  for (let i = 0; i < 200 && s.turn.stage === 'setup'; i++) {
    const seat = s.turn.active!, v = view(s, seat), opt = v.build.find(o => o.free && o.targets.length)!;
    const near = grounds(s).flatMap(g => g.vertices);
    const at = opt.targets.find(t => near.includes(t)) ?? opt.targets[0];
    act(s, seat, { type: 'build', piece: opt.piece as 'road', at });
  }
  const fishers = s.order.filter(id => fx(s).hands[id].length || fx(s).boot === id);
  assert.ok(fishers.length > 0);
  assert.equal(fishCount(s), TOKENS(s));
});

test('payment: least overpayment first, then fewest tokens; extra fish are lost', () => {
  const t = (...v: number[]): FishToken[] => v.map((value, i) => ({ id: `${i}`, value }));
  assert.deepEqual(payment(t(3, 1, 1), 2)!.map(x => x.value), [1, 1]);
  assert.deepEqual(payment(t(3, 2), 2)!.map(x => x.value), [2]);
  assert.deepEqual(payment(t(3), 2)!.map(x => x.value), [3]);
  assert.deepEqual(payment(t(3, 3, 1), 7)!.map(x => x.value), [3, 3, 1]);
  assert.equal(payment(t(1, 1), 3), null);
});

/** A corner on three land hexes that no fishing ground or lake touches. */
const dry = (s: State) => s.board.vertices.filter(v => v.tiles.length === 3 && !v.coast
  && !grounds(s).some(g => g.vertices.includes(v.id))).map(v => v.id);

test('spends: robber off, steal, resource, dev card; each pays the cheapest tokens and conserves', () => {
  const s = fresh(), [a, b] = s.order, v = dry(s)[0];
  const tile = boardIndex(s.board).vertex.get(v)!.tiles[0];
  settle(s, a, v);
  edit(s, n => setRobber(n, tile));
  fish(s, a, [3, 3, 3, 3, 2, 2, 1]);
  give(s, b, { ore: 1 });
  toMain(s, 3);
  const stock = inventory(s), ids = () => view(s, a).commands.map(c => c.id);
  assert.deepEqual(ids().filter(id => id.startsWith('fishing-')).sort(),
    ['fishing-dev', 'fishing-resource', 'fishing-robber', 'fishing-route', 'fishing-steal']);
  const robberHint = view(s, a).commands.find(c => c.id === 'fishing-robber')!.hint;
  assert.ok(robberHint > 0.7, 'the robber sits on my hex');
  command(s, a, 'fishing-robber');
  assert.equal(s.pieces.robber, null);
  command(s, a, 'fishing-steal', { victim: b });
  assert.equal(s.seats[a].hand.ore, 1);
  command(s, a, 'fishing-resource', {}, { get: { grain: 1 } });
  assert.equal(s.seats[a].hand.grain, 1);
  assert.deepEqual(inventory(s), stock);
  assert.deepEqual(fx(s).discard, [2, 3, 3, 1], 'paid 2, 3 and 3+1');
  command(s, a, 'fishing-dev');
  assert.deepEqual(fx(s).hands[a], [], '3+3+2 paid 7: the extra fish is lost');
  assert.equal(s.seats[a].dev.length, 1);
  unchanged(s, () => command(s, a, 'fishing-steal', { victim: b }), /no longer available/);
});

test('spends: 5 fish owe a free road; the off-board robber re-enters on a 7', () => {
  const s = fresh(), [a] = s.order;
  settle(s, a, dry(s)[0]);
  fish(s, a, [3, 2]);
  toMain(s, 3);
  command(s, a, 'fishing-route');
  assert.equal(s.seats[a].freeRoutes, 1);
  const road = view(s, a).build.find(o => o.piece === 'road')!;
  assert.equal(road.free, 1);
  act(s, a, { type: 'build', piece: 'road', at: road.targets[0] });
  assert.equal(s.seats[a].freeRoutes, 0);
  edit(s, n => setRobber(n, null));
  act(s, a, { type: 'end' });
  rig(s, [3, 4]);
  act(s, s.turn.active!, { type: 'roll' });
  const prompts = view(s, s.turn.active!).prompts;
  assert.ok(prompts.some(p => p.kind === 'robber'), 'an off-board robber still enters');
});

test('old boot: +1 to the target, passed only to a seat with at least your points', () => {
  const s = fresh(), [a, b, c] = s.order;
  settle(s, a, s.board.vertices[0].id);
  settle(s, b, s.board.vertices.at(-1)!.id);
  edit(s, n => { const x = fx(n); x.deck.splice(x.deck.indexOf(0), 1); x.boot = a; });
  assert.equal(view(s, a).target, s.settings.targetPoints + 1);
  assert.ok(pub(s).seats.find(x => x.id === a)!.badges.some(x => x.key === 'boot'));
  toMain(s, 3);
  const cmd = view(s, a).commands.find(x => x.id === 'fishing-boot')!;
  const options = cmd.fields[0].kind === 'pick' ? cmd.fields[0].options.map(o => o.value) : [];
  assert.deepEqual(options, [b], `${c} has fewer points`);
  unchanged(s, () => command(s, a, 'fishing-boot', { seat: c }));
  command(s, a, 'fishing-boot', { seat: b });
  assert.equal(fx(s).boot, b);
  assert.equal(view(s, b).target, s.settings.targetPoints + 1);
  assert.equal(view(s, a).target, s.settings.targetPoints);
});

test('privacy and timing: counts are public, values private; spends only on your own turn', () => {
  const s = fresh(), [a, b] = s.order;
  fish(s, a, [3, 1]);
  assert.equal(pub(s).ext.fishing!.fish[a], 2);
  assert.ok(!JSON.stringify(pub(s)).includes('"value":3'));
  assert.deepEqual(view(s, a).ext.fishing!.fish.map(t => t.value), [3, 1]);
  assert.deepEqual(view(s, b).ext.fishing!.fish, []);
  assert.ok(!JSON.stringify(view(s, b)).includes('"value":3'));
  toMain(s, 3);
  fish(s, b, [3]);
  assert.ok(!view(s, b).commands.some(c => c.module === 'fishing'), 'not your turn');
  unchanged(s, () => command(s, b, 'fishing-resource', {}, { get: { wood: 1 } }));
  serializable(s);
  assert.ok(RESOURCES.length);
});

for (const mode of ['standard', 'connect'] as const) {
  test(`CPU matches (${mode}, 4 and 10 seats) finish by target; goods and fish conserved`, () => {
    for (const seats of [4, 10]) for (const seed of [1, 2]) {
      const r = runMatch({ seats, seed, settings: { ...FISHING, mode } });
      assert.deepEqual(r.rejected.slice(0, 3), [], `${seats} seats seed ${seed}`);
      assert.equal(r.reason, 'target', `${seats} seats seed ${seed}: ${r.reason} after ${r.rounds} rounds`);
      assert.deepEqual(inventory(r.s), inventory(game(seats, { ...FISHING, mode }, seed)));
      assert.equal(fishCount(r.s), TOKENS(r.s));
      serializable(r.s);
    }
  });
}
