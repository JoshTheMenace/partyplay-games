/** Deliveries: depots, wagons, movement costs and tolls, cargo, road barbarians, 2/12, combinations. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchaseWhy } from '../../src/engine/legal';
import { facts, invaders } from '../../src/engine/modules/barbarian-attack/coast';
import { depots, dl, PAY } from '../../src/engine/modules/deliveries/depots';
import { raiders, trips, wagon } from '../../src/engine/modules/deliveries/wagon';
import { placeUnit, updateUnit } from '../../src/engine/pieces';
import { scoreParts } from '../../src/engine/score';
import type { State } from '../../src/engine/state';
import type { CargoKind, Settings } from '../../src/model';
import { runMatch } from '../cpu/match';
import {
  act, answer, command, edit, game, inventory, pastSetup, pub, rig, serializable, unchanged, view,
} from '../helpers';
import { blank, clear, give, hand, inland, ix, lay, last, toMain } from '../rules/helpers';

const DL: Partial<Settings> = { scenarios: ['deliveries'] };
const fresh = (seats = 4, extra: Partial<Settings> = {}, seed = 9) => game(seats, { ...DL, ...extra }, seed);
const cmd = (s: State, seat: string, id: string) => view(s, seat).commands.find(c => c.id === id);
const tokens = (s: State) => Object.values(dl(s).decks).flat().length
  + s.order.reduce((n, id) => n + (wagon(s, id)?.cargo.length ?? 0) + dl(s).delivered[id], 0);

/** Put `seat`'s wagon on `at` with `cargo` and `mp` movement points. */
const park = (s: State, seat: string, at: string, cargo: CargoKind[] = [], mp = 4) => edit(s, n => {
  updateUnit(n, `w-${seat}`, { at, cargo });
  dl(n).mp[seat] = mp;
});

/** A 3-edge inland walk away from depots and raiders: corners [a, b, c, d]. */
function walk(s: State): string[] {
  const bad = new Set(depots(s).keys()), blocked = raiders(s);
  for (const a of inland(s)) {
    const out = [a];
    while (out.length < 4) {
      const at = out.at(-1)!, next = ix(s).vertexNeighbors.get(at)!.find(v => !out.includes(v) && !bad.has(v)
        && inland(s).includes(v) && !blocked.has(ix(s).edgeBetween.get(`${at} ${v}`)!));
      if (!next) break;
      out.push(next);
    }
    if (out.length === 4 && !out.some(v => bad.has(v))) return out;
  }
  throw new Error('no walk');
}
const edge = (s: State, a: string, b: string) => ix(s).edgeBetween.get(`${a} ${b}`)!;

test('board: three depots on inland home corners, clear of ports; the castle depot on the BA castle', () => {
  const s = fresh(), found = s.board.features.filter(f => f.kind === 'depot');
  assert.deepEqual(found.map(f => f.kind === 'depot' && f.depot).sort(), ['castle', 'glassworks', 'quarry']);
  const ports = new Set(s.board.ports.flatMap(p => p.vertices));
  for (const f of found) if (f.kind === 'depot') {
    const v = ix(s).vertex.get(f.vertex)!;
    assert.ok(v.tiles.length === 3 && !ports.has(v.id));
    assert.ok(v.tiles.every(t => ix(s).tile.get(t)!.island === 0));
  }
  assert.deepEqual(fresh().board, s.board, 'deterministic');
  const both = fresh(4, { scenarios: ['barbarian-attack', 'deliveries'] });
  const castle = both.board.features.find(f => f.kind === 'depot' && f.depot === 'castle');
  assert.ok(castle?.kind === 'depot' && castle.tile === facts(both).castle);
});

test('setup: a wagon on each round-2 city, 5 gold, road barbarians spread; no robber or longest road', () => {
  const s = fresh();
  pastSetup(s);
  for (const id of s.order) {
    const w = wagon(s, id)!;
    const b = s.pieces.buildings[w.at];
    assert.deepEqual([b?.kind, b?.seat, w.level], ['city', id, 1]);
    assert.equal(dl(s).gold[id], 5);
  }
  const edges = [...raiders(s).keys()].map(e => ix(s).edge.get(e)!), corners = edges.flatMap(e => [e.a, e.b]);
  assert.equal(edges.length, 3);
  assert.equal(new Set(corners).size, 6);
  assert.equal(s.pieces.robber, null);
  assert.equal(s.profile.longestRoad, false);
  assert.ok(!view(s, s.turn.active!).build.some(o => o.targets.some(t => depots(s).has(t))));
});

test('3–4 seats: no 2 or 12 discs, and those rolls reroll; 5–6 keep both; BA lands a barbarian', () => {
  const s = blank(fresh()), discs = (x: State) => x.board.tiles.filter(t => [2, 12].includes(t.number));
  assert.deepEqual(discs(s), []);
  const six = blank(fresh(6));
  assert.ok(discs(six).length >= 2, 'T&B 5–6: the 2 and 12 discs are used');
  rig(six, [1, 1]);
  act(six, six.turn.active!, { type: 'roll' });
  assert.equal(last(six, 'roll')!.total, 2, 'and a 2 is not rerolled');
  rig(s, [1, 1]);
  act(s, s.turn.active!, { type: 'roll' });
  assert.ok(![2, 12].includes(last(s, 'roll')!.total));
  const b = blank(fresh(4, { scenarios: ['barbarian-attack', 'deliveries'] }));
  const two = facts(b).coast.find(t => ix(b).tile.get(t)!.number === 2);
  const before = two ? invaders(b, two) : 0;
  rig(b, [1, 1]);
  act(b, b.turn.active!, { type: 'roll' });
  assert.equal(last(b, 'roll')!.total, 2);
  if (two) assert.equal(invaders(b, two), Math.min(3, before + 1));
});

test('the development deck is the scenario\'s own: Knights, Road Building and Victory Points only', () => {
  const tally = (s: State) =>
    Object.fromEntries([...new Set(s.devDeck)].map(k => [k, s.devDeck.filter(x => x === k).length]));
  assert.deepEqual(tally(fresh()), { knight: 16, 'road-building': 3, victory: 3 });
  assert.equal(fresh(6).devDeck.length, 34, 'scaled by 1.5 for 5–6 seats');
});

test('movement: own road 1 MP, rival road 1 MP + 1 gold to its owner, open land 2, barbarians +2', () => {
  const s = blank(fresh()), [me, rival] = s.order, [a, b, c, d] = walk(s);
  toMain(s, 8);
  lay(s, me, [edge(s, a, b)]);
  lay(s, rival, [edge(s, b, c)]);
  park(s, me, a);
  const map = trips(s, me, 4);
  assert.deepEqual([map.get(b)?.mp, map.get(c)?.mp, map.get(c)?.gold, map.get(d)?.mp], [1, 2, 1, 4]);
  const gold = dl(s).gold[me] + dl(s).gold[rival];
  command(s, me, 'dl-move', { to: d });
  assert.deepEqual([wagon(s, me)!.at, dl(s).mp[me], dl(s).gold[me]], [d, 0, 4]);
  assert.equal(dl(s).gold[me] + dl(s).gold[rival], gold, 'tolls move gold between seats');
  assert.equal(purchaseWhy(s, me, 'road')?.code, 'moved');
  assert.equal(s.events.filter(e => e.kind === 'move' && e.piece === 'wagon').length >= 3, true);
  park(s, me, a);
  const at = edge(s, a, b);
  edit(s, n => placeUnit(n, { id: 'raider-x', kind: 'raider', seat: null, at, level: 0, active: true, cargo: [] }));
  assert.equal(trips(s, me, 9).get(b)?.mp, 3);
  unchanged(s, () => command(s, me, 'dl-move', { to: 'nowhere' }));
});

test('depots: entering ends the move, delivers a wanted cargo (1 VP, gold by level), then picks up', () => {
  const s = blank(fresh()), me = s.turn.active!;
  const [[v, kind]] = [...depots(s)].filter(([, k]) => k === 'quarry');
  toMain(s, 8);
  const next = ix(s).vertexNeighbors.get(v)![0];
  park(s, me, next, ['tools'], 6);
  const all = tokens(s);
  edit(s, n => updateUnit(n, `w-${me}`, { level: 3 }));
  const deck = dl(s).decks[kind].length, gold = dl(s).gold[me];
  command(s, me, 'dl-drive');
  assert.deepEqual([wagon(s, me)!.at, dl(s).mp[me], dl(s).delivered[me]], [v, 0, 1]);
  assert.equal(dl(s).gold[me], gold + PAY[2] - (s.pieces.routes[edge(s, next, v)] ? 1 : 0));
  assert.equal(wagon(s, me)!.cargo.length, 1);
  assert.equal(dl(s).decks[kind].length, deck - 1);
  assert.equal(tokens(s), all, 'cargo tokens are conserved');
  assert.equal(scoreParts(s, me).find(p => p.key === 'deliveries')!.points, 1);
  assert.equal(pub(s).ext.deliveries!.delivered[me], 1);
});

test('upgrades cost resources, lock after moving, and the last one is worth 1 VP', () => {
  const s = blank(fresh()), me = s.turn.active!;
  toMain(s, 8);
  clear(s, me);
  give(s, me, { wood: 7, wool: 4, ore: 4 });
  const stock = inventory(s);
  for (let i = 0; i < 4; i++) command(s, me, 'dl-upgrade');
  assert.equal(wagon(s, me)!.level, 5);
  assert.deepEqual(hand(s, me), { wood: 1 });
  assert.deepEqual(inventory(s), stock);
  assert.ok(scoreParts(s, me).some(p => p.key === 'wagon' && p.points === 1));
  assert.ok(!cmd(s, me, 'dl-upgrade'));
});

test('resource cards sell to the bank for 1 gold at the bank rate (T&B p.21)', () => {
  const s = blank(fresh()), me = s.turn.active!;
  toMain(s, 8);
  clear(s, me);
  give(s, me, { wool: 4, ore: 3 });
  const gold = dl(s).gold[me], stock = inventory(s), sell = cmd(s, me, 'tb-sell')!;
  assert.deepEqual((sell.fields[0] as { options: { value: string }[] }).options.map(o => o.value), ['wool']);
  command(s, me, 'tb-sell', { good: 'wool' });
  assert.deepEqual([hand(s, me), dl(s).gold[me]], [{ ore: 3 }, gold + 1]);
  assert.deepEqual(inventory(s), stock, 'the cards go to the bank');
  assert.ok(!cmd(s, me, 'tb-sell'));
});

test('a 7: discards, then the roller moves a road barbarian and robs the road owner', () => {
  const s = blank(fresh()), me = s.turn.active!, victim = s.order.find(id => id !== me)!, [a, b] = walk(s);
  lay(s, victim, [edge(s, a, b)]);
  give(s, victim, { ore: 2 });
  const stock = inventory(s);
  rig(s, [3, 4]);
  act(s, me, { type: 'roll' });
  const p = view(s, me).prompts.find(q => q.kind === 'deliveries/raider')!;
  assert.equal(p.scope, 'table');
  const raider = [...raiders(s).values()][0];
  answer(s, me, 'deliveries/raider', { raider, edge: edge(s, a, b) });
  assert.equal(s.pieces.units[raider].at, edge(s, a, b));
  assert.equal(hand(s, me).ore, 1);
  assert.deepEqual(inventory(s), stock);
});

test('a Knight moves a road barbarian; drive-off needs an upgraded wagon, once per barbarian a turn', () => {
  const s = blank(fresh()), me = s.turn.active!, [a, b] = walk(s);
  edit(s, n => { n.seats[me].dev.push({ id: 'k1', kind: 'knight', boughtAt: -1 }); });
  act(s, me, { type: 'play-dev', card: 'k1', goods: [] });
  assert.equal(view(s, me).prompts[0]?.kind, 'deliveries/raider');
  const raider = [...raiders(s).values()][0];
  answer(s, me, 'deliveries/raider', { raider, edge: edge(s, a, b) });
  toMain(s, 8);
  park(s, me, a);
  assert.ok(!cmd(s, me, 'dl-fight'), 'level 1 cannot drive barbarians off');
  edit(s, n => updateUnit(n, `w-${me}`, { level: 5 }));
  command(s, me, 'dl-fight', { edge: edge(s, a, b) });
  assert.match(last(s, 'module')!.text, /rolled \d against a road barbarian/);
  assert.ok(!view(s, me).commands.some(c => c.id === 'dl-fight'));
});

test('with Cities & Knights an active knight chases a road barbarian; views never show the decks', () => {
  const s = blank(fresh(4, { citiesKnights: true })), me = s.turn.active!;
  toMain(s, 8);
  const [e] = [...raiders(s).keys()], v = ix(s).edge.get(e)!.a;
  edit(s, n => placeUnit(n, { id: 'kx', kind: 'knight', seat: me, at: v, level: 1, active: true, cargo: [] }));
  command(s, me, 'dl-chase', { knight: 'kx' });
  assert.equal(s.pieces.units.kx.active, false);
  const f = view(s, me).prompts[0].command.fields[0];
  assert.ok(f.kind === 'pick' && f.options.length === 1 && f.options[0].value === raiders(s).get(e));
  serializable(s);
  for (const id of s.order) assert.ok(!JSON.stringify(view(s, id)).includes('"decks"'));
  assert.ok(pub(s).hud.some(h => h.key === 'dl-table'));
});

const MATCHES: [number, 'standard' | 'connect'][] = [
  [4, 'standard'], [4, 'connect'], [10, 'standard'], [10, 'connect'],
];
for (const [seats, mode] of MATCHES) {
  test(`CPU match: ${seats} seats ${mode} finishes by target with goods and cargo conserved`, () => {
    for (const seed of [3, 4]) {
      const r = runMatch({ seats, seed, settings: { ...DL, mode } });
      assert.deepEqual(r.rejected.slice(0, 3), [], `seed ${seed}`);
      assert.equal(r.reason, 'target', `seed ${seed}: ${r.reason} after ${r.rounds} rounds`);
      assert.ok(r.rounds <= (mode === 'standard' ? 60 : 110), `seed ${seed}: ${r.rounds} rounds`);
      assert.deepEqual(inventory(r.s), inventory(fresh(seats, { mode }, seed)));
      assert.equal(tokens(r.s), 3 * (seats <= 4 ? 12 : 20));
      assert.ok(Object.values(dl(r.s).delivered).some(n => n > 0), 'wagons deliver');
      serializable(r.s);
    }
  });
}

test('CPU match: Deliveries with Cities & Knights, 4 seats, finishes by target', () => {
  const r = runMatch({ seats: 4, seed: 5, settings: { ...DL, citiesKnights: true } });
  assert.deepEqual(r.rejected.slice(0, 3), []);
  assert.equal(r.reason, 'target', `${r.reason} after ${r.rounds} rounds`);
});

