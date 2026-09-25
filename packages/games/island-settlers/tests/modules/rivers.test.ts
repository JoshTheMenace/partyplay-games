/** Rivers of Catan: river paths and bridge sites, bridges, gold coins, wealth tiles, CPU matches. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESOURCES, type BoardFeature, type Mode, type PickField, type Settings } from '../../src/model';
import { boardIndex } from '../../src/engine/board/lookup';
import { fx } from '../../src/engine/modules/fishing';
import { coins, rx } from '../../src/engine/modules/rivers';
import { shipMoves } from '../../src/engine/legal';
import { placeRoute, setPirate } from '../../src/engine/pieces';
import type { State } from '../../src/engine/state';
import { runMatch } from '../cpu/match';
import { act, answer, command, edit, game, inventory, pub, serializable, unchanged, view } from '../helpers';
import { blank, give, lay, last, settle, toMain } from '../rules/helpers';

type River = Extract<BoardFeature, { kind: 'river' }>;
const RIVERS: Partial<Settings> = { scenarios: ['rivers'] };
const rivers = (s: State) => s.board.features.filter((f): f is River => f.kind === 'river');
const sites = (s: State) => s.board.features.flatMap(f => (f.kind === 'bridge-site' ? [f.edge] : []));
const setCoins = (s: State, values: number[]) =>
  edit(s, n => n.order.forEach((id, i) => { rx(n).coins[id] = values[i]; }));
/** Past setup with an empty board and no coins. */
const fresh = (settings = RIVERS) => {
  const s = blank(game(4, settings));
  setCoins(s, [0, 0, 0, 0]);
  return s;
};

/** A bridge site with a free, non-site edge at one end for `seat`'s road; returns both. */
function approach(s: State) {
  const ix = boardIndex(s.board), all = new Set(sites(s));
  for (const site of sites(s)) {
    const e = ix.edge.get(site)!;
    for (const v of [e.a, e.b]) {
      const inland = (x: string) => ix.edge.get(x)!.tiles.every(t => ix.tile.get(t)!.terrain !== 'sea');
      const road = ix.vertex.get(v)!.edges.find(x => !all.has(x) && inland(x));
      if (road) return { site, road, v };
    }
  }
  throw new Error('no approach');
}

test('board: 2 / 2 / 3 rivers of 4 and 3 hexes run inland from the coast; crossings are bridge sites', () => {
  for (const [seats, lengths, ports] of [[4, [4, 3], 9], [6, [4, 4], 11], [10, [4, 4, 3], 13]] as const) {
    for (const seed of [1, 2, 3]) {
      const s = game(seats, RIVERS, seed), ix = boardIndex(s.board), list = rivers(s);
      assert.deepEqual(list.map(r => r.tiles.length), [...lengths], `${seats} seats seed ${seed}`);
      assert.equal(s.board.ports.length, ports);
      const all = list.flatMap(r => r.tiles);
      for (const r of list) {
        const mouth = ix.edge.get(r.edges[0])!;
        const sea = mouth.tiles.some(t => ix.tile.get(t)!.terrain === 'sea');
        assert.ok(mouth.tiles.includes(r.tiles[0]) && sea, 'the mouth meets the sea');
        r.tiles.slice(1).forEach((t, i) => assert.deepEqual([...ix.edge.get(r.edges[i + 1])!.tiles].sort(),
          [r.tiles[i], t].sort(), 'each crossing joins consecutive river hexes'));
        assert.ok(r.tiles.every(t => RESOURCES.includes(ix.tile.get(t)!.terrain as never)));
        const others = all.filter(t => !r.tiles.includes(t));
        const apart = r.tiles.every(t => ix.tileNeighbors.get(t)!.every(n => !others.includes(n.id)));
        assert.ok(apart, 'rivers stay apart');
      }
      assert.deepEqual(sites(s), list.flatMap(r => r.edges));
      assert.deepEqual(game(seats, RIVERS, seed).board, s.board, 'deterministic');
    }
  }
});

test('bridge sites: no road or ship goes there, in setup or later', () => {
  const s = game(4, RIVERS), all = new Set(sites(s));
  for (let i = 0; i < 40 && s.turn.stage === 'setup'; i++) {
    const seat = s.turn.active!, opt = view(s, seat).build.find(o => o.free && o.targets.length)!;
    assert.ok(opt.targets.every(t => !all.has(t)));
    act(s, seat, { type: 'build', piece: opt.piece as 'road', at: opt.targets[0] });
  }
  for (const id of s.order) assert.ok(view(s, id).build.every(o => o.targets.every(t => !all.has(t))));
});

test('bridge: 2 brick + 1 wood beside your road, 3 gold, a road for the longest route; atomic', () => {
  const s = fresh(), [a, b] = s.order, { site, road } = approach(s);
  lay(s, a, [road]);
  toMain(s, 3);
  unchanged(s, () => command(s, a, 'rivers-bridge', { edge: site }), /no longer available|afford/);
  give(s, a, { brick: 2, wood: 1 });
  const stock = inventory(s), cmd = view(s, a).commands.find(c => c.id === 'rivers-bridge')!;
  assert.deepEqual(cmd.cost, { brick: 2, wood: 1 });
  assert.ok(!view(s, b).commands.some(c => c.id === 'rivers-bridge'), 'not on someone else\'s turn');
  command(s, a, 'rivers-bridge', { edge: site });
  assert.deepEqual(s.pieces.routes[site], { edge: site, seat: a, kind: 'road', bridge: true });
  assert.equal(coins(s, a), 3);
  assert.equal(s.seats[a].longestRoute, 2);
  assert.deepEqual(inventory(s), stock, 'cards go to the bank');
  assert.equal(last(s, 'build')?.piece, 'bridge');
});

test('bridge: never past an opponent\'s building, at most 3 per seat, and only with a road left', () => {
  const s = fresh(), [a, b] = s.order, { road, v } = approach(s);
  lay(s, a, [road]);
  settle(s, b, v);
  toMain(s, 3);
  give(s, a, { brick: 2, wood: 1 });
  assert.ok(!view(s, a).commands.some(c => c.id === 'rivers-bridge'), 'blocked by the settlement');
  const s2 = fresh(), [c] = s2.order;
  const bridge = (n: State, edge: string) => placeRoute(n, { edge, seat: c, kind: 'road', bridge: true });
  edit(s2, n => sites(n).slice(0, 3).forEach(edge => bridge(n, edge)));
  lay(s2, c, [approach(s2).road]);
  toMain(s2, 3);
  give(s2, c, { brick: 2, wood: 1 });
  assert.ok(!view(s2, c).commands.some(x => x.id === 'rivers-bridge'), 'three bridges used');
  const s3 = fresh(), [d] = s3.order, near = approach(s3), all = new Set(sites(s3));
  lay(s3, d, [near.road]);
  const spare = s3.board.edges.map(e => e.id).filter(e => !all.has(e) && !s3.pieces.routes[e]).slice(0, 14);
  edit(s3, n => spare.forEach(edge => placeRoute(n, { edge, seat: d, kind: 'road' })));
  toMain(s3, 3);
  give(s3, d, { brick: 2, wood: 1 });
  assert.ok(!view(s3, d).commands.some(x => x.id === 'rivers-bridge'), 'a bridge is one of the 15 roads');
});

test('coins: 1 per road on a river hex edge and per settlement on its corner; not for cities', () => {
  const s = fresh(), [a] = s.order, ix = boardIndex(s.board), river = rivers(s)[0];
  const clear = (x: string) => ix.vertex.get(x)!.edges.every(e => !sites(s).includes(e));
  const corner = ix.tileVertices.get(river.tiles[1])!.find(clear)!;
  settle(s, a, corner);
  toMain(s, 3);
  const edge = view(s, a).build.find(o => o.piece === 'road')!.targets
    .find(e => ix.edge.get(e)!.tiles.some(t => river.tiles.includes(t)))!;
  give(s, a, { brick: 1, wood: 1, grain: 2, ore: 3 });
  act(s, a, { type: 'build', piece: 'road', at: edge });
  assert.equal(coins(s, a), 1);
  act(s, a, { type: 'build', piece: 'city', at: corner });
  assert.equal(coins(s, a), 1, 'a city upgrade earns nothing');
  assert.equal(pub(s).ext.rivers!.coins[a], 1, 'coins are public');
});

test('buy (2 gold, twice a turn), sell at the bank rate, and gold offers to players', () => {
  const s = fresh(), [a, b] = s.order;
  setCoins(s, [7, 1, 1, 1]);
  toMain(s, 3);
  const stock = inventory(s);
  command(s, a, 'rivers-buy', {}, { get: { ore: 1 } });
  command(s, a, 'rivers-buy', {}, { get: { ore: 1 } });
  assert.equal(coins(s, a), 3);
  assert.ok(!view(s, a).commands.some(c => c.id === 'rivers-buy'), 'twice per turn');
  give(s, a, { wool: 4 });
  command(s, a, 'rivers-sell', { good: 'wool' });
  assert.equal(coins(s, a), 4);
  assert.equal(s.seats[a].hand.wool, 0);
  give(s, b, { grain: 1 });
  command(s, a, 'rivers-offer', { seat: b, coins: '2', good: 'grain' });
  answer(s, b, 'rivers/offer', { answer: 'accept' });
  assert.deepEqual([coins(s, a), coins(s, b), s.seats[a].hand.grain], [2, 3, 1]);
  command(s, a, 'rivers-offer', { seat: b, coins: '1', good: 'ore' });
  const offer = view(s, b).prompts.find(p => p.kind === 'rivers/offer')!;
  const pick = offer.command.fields[0];
  assert.deepEqual(pick.kind === 'pick' && pick.options.map(o => o.value), ['decline'], 'b has no ore');
  answer(s, b, 'rivers/offer', { answer: 'decline' });
  assert.equal(coins(s, a), 2);
  assert.deepEqual(inventory(s), stock, 'cards only move between hands and the bank');
});

test('wealth: all start Poor (-2); a unique richest seat is Wealthiest (+1); ties hold nothing', () => {
  const s = fresh(), [a, b, c, d] = s.order;
  const part = (id: string, key: string) => view(s, id).parts.find(p => p.key === key)?.points;
  assert.deepEqual(s.order.map(id => part(id, 'poor')), [-2, -2, -2, -2]);
  assert.equal(s.awards.wealthiest, null);
  setCoins(s, [3, 1, 1, 2]);
  assert.equal(s.awards.wealthiest, a);
  assert.equal(last(s, 'award')?.award, 'wealthiest');
  const parts = [part(a, 'wealthiest'), part(b, 'poor'), part(c, 'poor'), part(d, 'poor')];
  assert.deepEqual(parts, [1, -2, -2, undefined]);
  assert.deepEqual(pub(s).ext.rivers!.poorest, [b, c]);
  setCoins(s, [3, 3, 1, 2]);
  assert.equal(s.awards.wealthiest, null, 'a tie returns the tile');
  assert.ok(pub(s).hud.some(h => h.key === 'wealthiest'));
  assert.ok(pub(s).seats.every(x => x.badges.some(g => g.key === 'coins')));
  for (const k of ['barbarian-attack', 'deliveries'] as const) {
    const t = game(4, { scenarios: ['rivers', k] }), id = t.order[0];
    assert.ok(!view(t, id).parts.some(p => p.key === 'poor'), `${k}: Poor costs no VP (official sheet)`);
  }
});

test('with Fishing: 6 fish build a bridge (official combination)', () => {
  const s = fresh({ scenarios: ['fishing', 'rivers'] }), [a] = s.order, { site, road } = approach(s);
  lay(s, a, [road]);
  edit(s, n => {
    const x = fx(n);
    for (const id of ['k1', 'k2']) x.hands[a].push({ id, value: x.deck.splice(x.deck.indexOf(3), 1)[0] });
  });
  toMain(s, 3);
  command(s, a, 'rivers-fish-bridge', { edge: site });
  assert.equal(s.pieces.routes[site]?.bridge, true);
  assert.equal(coins(s, a), 3);
});

for (const mode of ['standard', 'connect'] as const) {
  test(`CPU matches (${mode}, 4 and 10 seats) finish by target; goods conserved`, () => {
    for (const seats of [4, 10]) for (const seed of [1, 2]) {
      const r = runMatch({ seats, seed, settings: { ...RIVERS, mode: mode as Mode } });
      assert.deepEqual(r.rejected.slice(0, 3), [], `${seats} seats seed ${seed}`);
      assert.equal(r.reason, 'target', `${seats} seats seed ${seed}: ${r.reason} after ${r.rounds} rounds`);
      assert.deepEqual(inventory(r.s), inventory(game(seats, { ...RIVERS, mode }, seed)));
      serializable(r.s);
    }
  });
}

test('with Seafarers: a ship on a river hex edge pays 1 gold to sail away (official combination)', () => {
  const s = fresh({ ...RIVERS, map: 'seafarers' }), a = s.turn.active!, ix = boardIndex(s.board);
  const water = (t: string) => ix.tile.get(t)!.terrain === 'sea';
  const e = s.board.edges.find(x => !sites(s).includes(x.id) && x.tiles.some(water)
    && x.tiles.some(t => rivers(s).some(r => r.tiles.includes(t))))!;
  settle(s, a, e.a);
  lay(s, a, [e.id], 'ship');
  edit(s, n => setPirate(n, null));
  toMain(s, 3);
  assert.equal(shipMoves(s, a).length, 0, 'no free move off the river');
  assert.ok(!view(s, a).commands.some(c => c.id === 'rivers-ship'), 'no gold, no move');
  edit(s, n => { rx(n).coins[a] = 1; });
  const f = view(s, a).commands.find(c => c.id === 'rivers-ship')!.fields[0] as PickField;
  const to = (f.options[0].then![0] as PickField).options[0].value;
  command(s, a, 'rivers-ship', { from: e.id, to });
  assert.deepEqual([s.pieces.routes[to]?.kind, s.pieces.routes[e.id], coins(s, a)], ['ship', undefined, 0]);
  assert.equal(rx(s).toll, undefined);
});
