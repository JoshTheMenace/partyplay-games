/** Barbarian Attack: board, landings, conquest, the 7, defense cards, guards, battles, C&K override. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchaseWhy } from '../../src/engine/legal';
import { barbarianAttack } from '../../src/engine/modules/barbarian-attack';
import { expel } from '../../src/engine/modules/barbarian-attack/battle';
import {
  ba, conquered, facts, invade, invaders, onBoard, setInvaders, supply,
} from '../../src/engine/modules/barbarian-attack/coast';
import { guards, placeGuard } from '../../src/engine/modules/barbarian-attack/guards';
import { purse } from '../../src/engine/modules/deliveries/gold';
import { updateUnit } from '../../src/engine/pieces';
import { scoreParts } from '../../src/engine/score';
import { rates } from '../../src/engine/trade';
import type { State } from '../../src/engine/state';
import type { Settings } from '../../src/model';
import { runMatch } from '../cpu/match';
import { act, answer, command, edit, game, inventory, pub, serializable, unchanged, view } from '../helpers';
import { blank, clear, give, hand, ix, last, lay, settle, toMain } from '../rules/helpers';

const BA: Partial<Settings> = { scenarios: ['barbarian-attack'] };
const fresh = (seats = 4, extra: Partial<Settings> = {}, seed = 7) => game(seats, { ...BA, ...extra }, seed);
const tileNumber = (s: State, t: string) => ix(s).tile.get(t)!.number;
const cmd = (s: State, seat: string, id: string) => view(s, seat).commands.find(c => c.id === id);
/** Coastal hex with a corner no building touches yet, and that corner. */
function openCoast(s: State) {
  for (const t of facts(s).coast) {
    const v = ix(s).tileVertices.get(t)!.find(v => !s.pieces.buildings[v]
      && !ix(s).vertexNeighbors.get(v)!.some(n => s.pieces.buildings[n]));
    if (v) return { t, v };
  }
  throw new Error('no open coast');
}

test('board: the castle replaces the central desert; numbered coast in order; 2 and 12 start invaded', () => {
  const s = fresh(), f = facts(s), castle = ix(s).tile.get(f.castle!)!;
  assert.equal(castle.terrain, 'castle');
  assert.equal(castle.number, 0);
  assert.equal(f.castleEdges.length, 6);
  assert.ok(f.coast.length >= 9 && f.coast.every(t => tileNumber(s, t) > 0 && t !== f.castle));
  assert.ok(!s.board.tiles.some(t => t.terrain === 'desert' && t.island === 0 && t.id === f.castle));
  assert.equal(onBoard(s), [2, 12].filter(n => f.coast.some(t => tileNumber(s, t) === n)).length);
  assert.deepEqual(fresh().board, s.board, 'deterministic');
  assert.equal(s.pieces.robber, null);
  assert.equal(s.profile.devCards, false);
  assert.deepEqual(s.profile.setupPieces, ['settlement', 'city']);
  assert.deepEqual(pub(s).ext['barbarian-attack'], { castle: f.castle, prisoners: ba(s).prisoners });
});

test('a building after setup lands up to 3 barbarians on distinct coastal numbers', () => {
  const s = blank(fresh());
  toMain(s, 8);
  const me = s.turn.active!, { v } = openCoast(s), n = ix(s).vertexNeighbors.get(v)![0];
  const m = ix(s).vertexNeighbors.get(n)!.find(x => x !== v)!;
  const edge = (a: string, b: string) => ix(s).edgeBetween.get(`${a} ${b}`)!;
  settle(s, me, m);
  lay(s, me, [edge(m, n), edge(n, v)]);
  clear(s, me);
  give(s, me, { wood: 1, brick: 1, wool: 1, grain: 1 });
  const stock = inventory(s), before = onBoard(s);
  act(s, me, { type: 'build', piece: 'settlement', at: v });
  const landed = onBoard(s) - before;
  assert.ok(landed >= 0 && landed <= 3);
  assert.match(last(s, 'module')!.text, /Barbarians landed/);
  assert.deepEqual(inventory(s), stock);
});

test('landing skips 7s and repeats, never exceeds 3 per hex, and stops when the supply is empty', () => {
  const s = fresh();
  edit(s, n => { for (let i = 0; i < 40; i++) invade(n, 3, 'test'); });
  assert.ok(facts(s).coast.every(t => invaders(s, t) <= 3));
  assert.ok(supply(s) >= 0);
  edit(s, n => { for (const id of n.order) ba(n).prisoners[id] = 9; });
  const full = onBoard(s);
  edit(s, n => invade(n, 3, 'x'));
  assert.deepEqual([supply(s), onBoard(s)], [0, full]);
});

test('a conquered hex produces nothing, blocks building on it, and its buildings score nothing', () => {
  const s = blank(fresh());
  const { t, v } = openCoast(s), me = s.turn.active!;
  settle(s, me, v, 'city');
  edit(s, n => setInvaders(n, t, 3));
  assert.ok(conquered(s, t));
  assert.equal(barbarianAttack.blocksTile!(s, t), 'barbarians');
  toMain(s, tileNumber(s, t));
  const roll = last(s, 'roll')!;
  assert.ok(roll.blocked.some(b => b.tile === t && b.by === 'barbarians'));
  assert.ok(!roll.grants.some(g => g.tile === t));
  const corners = ix(s).tileVertices.get(t)!, sides = ix(s).tileEdges.get(t)!;
  const spots = view(s, me).build.flatMap(o => o.targets);
  assert.ok(!spots.some(x => corners.includes(x) || sides.includes(x)));
  const land = ix(s).vertex.get(v)!.tiles.filter(x => ix(s).tile.get(x)!.terrain !== 'sea');
  if (land.every(x => x === t)) {
    assert.deepEqual(scoreParts(s, me).find(p => p.key === 'conquered')?.points, -2);
  }
});

test('ports next to conquered buildings do not trade', () => {
  const s = blank(fresh()), me = s.order[0];
  const lands = (v: string) => ix(s).vertex.get(v)!.tiles.filter(t => ix(s).tile.get(t)!.terrain !== 'sea');
  const port = s.board.ports.find(p => p.vertices.some(v => lands(v).length === 1))!;
  const v = port.vertices.find(x => lands(x).length === 1)!, land = lands(v)[0];
  settle(s, me, v);
  const good = port.good === 'any' ? 'wood' : port.good;
  assert.equal(rates(s, me)[good], port.ratio);
  edit(s, n => setInvaders(n, land, 3));
  if (tileNumber(s, land) > 0) assert.equal(rates(s, me)[good], 4);
});

test('a 7: discards first, then the roller robs a player of their choice (no robber)', () => {
  const s = blank(fresh()), me = s.turn.active!, victim = s.order.find(id => id !== me)!;
  give(s, victim, { ore: 9 });
  give(s, me, { wool: 1 });
  const stock = inventory(s);
  edit(s, n => { n.diceDeck = [[3, 4]]; n.lastTotal = null; });
  act(s, me, { type: 'roll' });
  assert.ok(view(s, victim).prompts.some(p => p.kind === 'discard'));
  assert.ok(!view(s, me).prompts.some(p => p.kind === 'barbarian-attack/steal'));
  answer(s, victim, 'discard', {}, { cards: { ore: 4 } });
  const p = view(s, me).prompts.find(q => q.kind === 'barbarian-attack/steal')!;
  assert.equal(p.scope, 'table');
  unchanged(s, () => act(s, me, { type: 'answer', prompt: p.id, picks: { victim: me }, cards: {} }));
  answer(s, me, 'barbarian-attack/steal', { victim });
  assert.equal(hand(s, me).ore, 1);
  assert.equal(last(s, 'steal')!.victim, victim);
  assert.ok(!JSON.stringify(last(s, 'steal')).includes('ore'), 'the public event hides the good');
  assert.deepEqual(inventory(s), stock);
});

test('defense cards: paid at once, the deck is conserved, Knighthood places a guard on a castle edge', () => {
  const s = blank(fresh()), me = s.turn.active!;
  toMain(s, 8);
  give(s, me, { wool: 2, grain: 2, ore: 2 });
  const stock = inventory(s);
  command(s, me, 'ba-card');
  assert.deepEqual(inventory(s), stock);
  assert.equal(hand(s, me).ore, 1);
  assert.equal(ba(s).deck.length + ba(s).discard.length, 26);
  edit(s, n => {
    for (const id of Object.keys(n.prompts)) delete n.prompts[id];
    ba(n).deck = ['knighthood'];
  });
  command(s, me, 'ba-card');
  const spots = view(s, me).prompts[0].command.fields[0];
  assert.ok(spots.kind === 'pick' && spots.options.every(o => facts(s).castleEdges.includes(o.value)));
  answer(s, me, 'barbarian-attack/knight', { edge: spots.options[0].value });
  assert.equal(guards(s, me).length, 1);
  unchanged(s, () => command(s, me, 'ba-card'), /afford/);
});

test('Capture takes a prisoner; Treason pays 2 gold and moves two barbarians', () => {
  const s = blank(fresh()), me = s.turn.active!, [a, b, c] = facts(s).coast;
  edit(s, n => {
    for (const t of facts(n).coast) setInvaders(n, t, 0);
    setInvaders(n, a, 2);
    setInvaders(n, b, 1);
  });
  toMain(s, 8);
  give(s, me, { wool: 2, grain: 2, ore: 2 });
  edit(s, n => { ba(n).deck = ['treason', 'capture']; });
  command(s, me, 'ba-card');
  answer(s, me, 'barbarian-attack/capture', { tile: a });
  assert.equal(ba(s).prisoners[me], 1);
  assert.equal(invaders(s, a), 1);
  command(s, me, 'ba-card');
  assert.equal(purse(s).gold[me], 2);
  const total = onBoard(s);
  answer(s, me, 'barbarian-attack/treason', { tile: a });
  answer(s, me, 'barbarian-attack/treason', { tile: c });
  answer(s, me, 'barbarian-attack/treason', { tile: b });
  const to = view(s, me).prompts[0].command.fields[0];
  assert.ok(to.kind === 'pick' && !to.options.some(o => [a, b, c].includes(o.value)), 'distinct hexes');
  answer(s, me, 'barbarian-attack/treason', { tile: to.options[0].value });
  assert.equal(onBoard(s), total);
  assert.equal(invaders(s, a) + invaders(s, b), 0);
});

test('guards move up to 3 edges (5 for a grain), never onto the castle; moving locks building', () => {
  const s = blank(fresh()), me = s.turn.active!, castle = facts(s).castleEdges;
  edit(s, n => placeGuard(n, me, castle[0], true));
  toMain(s, 8);
  clear(s, me);
  const g = guards(s, me)[0];
  command(s, me, 'ba-move', { guard: g.id });
  const field = view(s, me).prompts[0].command.fields[0];
  assert.ok(field.kind === 'pick' && field.options.every(o => !castle.includes(o.value)));
  assert.ok(field.options.slice(1).every(o => o.label === 'Edge'), 'no grain, no far moves');
  answer(s, me, 'barbarian-attack/move', { edge: field.options[1].value });
  assert.equal(guards(s, me)[0].at, field.options[1].value);
  assert.equal(purchaseWhy(s, me, 'road')?.code, 'moved');
  assert.ok(!view(s, me).commands.some(c => c.id === 'ba-move'), 'one move per guard per turn');
});

test('a castle guard left in place marches out at the end of the turn', () => {
  const s = blank(fresh()), me = s.turn.active!, castle = facts(s).castleEdges;
  edit(s, n => placeGuard(n, me, castle[0], true));
  toMain(s, 8);
  act(s, me, { type: 'end' });
  assert.ok(!castle.includes(guards(s, me)[0].at));
});

test('battle: winners take prisoners (2 = 1 VP), liberate the hex, lose one pair of sides', () => {
  const s = blank(fresh()), [me, other] = s.order, t = facts(s).coast[0], sides = ix(s).tileEdges.get(t)!;
  edit(s, n => {
    for (const x of facts(n).coast) setInvaders(n, x, 0);
    setInvaders(n, t, 3);
    placeGuard(n, me, sides[0], true); placeGuard(n, me, sides[1], true);
    placeGuard(n, other, sides[2], true); placeGuard(n, other, sides[3], true);
  });
  edit(s, n => expel(n));
  assert.equal(invaders(s, t), 0);
  const x = ba(s).prisoners;
  assert.equal(x[me] + x[other], 3);
  assert.ok(x[me] >= 1 && x[other] >= 1);
  const lost = 4 - guards(s).length, gold = purse(s).gold[me] + purse(s).gold[other];
  assert.ok(lost === 1 || lost === 2, 'one die: the guards on one pair of opposite sides');
  assert.equal(gold, lost * 3 + (x[me] === x[other] ? 0 : 3), 'lost guards and the tied loser pay out');
  const b = last(s, 'barbarians')!;
  assert.equal(b.result, 'defended');
  assert.deepEqual(new Set(b.defenders), new Set([me, other]));
  const winner = x[me] === 2 ? me : other;
  assert.equal(scoreParts(s, winner).find(p => p.key === 'prisoners')!.points, 1);
});

test('equal strength does not win; views are serializable and never show the deck', () => {
  const s = blank(fresh()), me = s.order[0], t = facts(s).coast[0], sides = ix(s).tileEdges.get(t)!;
  edit(s, n => {
    setInvaders(n, t, 2);
    for (const e of sides.slice(0, 2)) placeGuard(n, me, e, true);
  });
  edit(s, n => expel(n));
  assert.equal(invaders(s, t), 2);
  serializable(s);
  for (const id of s.order) assert.ok(!JSON.stringify(view(s, id)).includes('"deck"'));
  assert.ok(pub(s).hud.some(h => h.key === 'ba-invaders'));
  assert.ok(pub(s).seats.every(x => x.badges.some(b => b.key === 'prisoners')));
});

test('gold buys one resource for 2 gold, twice per turn', () => {
  const s = blank(fresh()), me = s.turn.active!;
  toMain(s, 8);
  edit(s, n => { purse(n).gold[me] = 6; });
  const stock = inventory(s);
  for (let i = 0; i < 2; i++) command(s, me, 'tb-gold', {}, { cards: { ore: 1 } });
  assert.equal(hand(s, me).ore, 2);
  assert.equal(purse(s).gold[me], 2);
  assert.ok(!cmd(s, me, 'tb-gold'));
  assert.deepEqual(inventory(s), stock);
});

test('with C&K: coastal attacks replace the ship; recruit, activate, promote; 3 prisoners per VP', () => {
  const s = blank(fresh(4, { citiesKnights: true })), me = s.turn.active!;
  assert.equal(s.profile.coastalBarbarians, true);
  toMain(s, 8);
  give(s, me, { wool: 2, ore: 2, grain: 1 });
  const recruit = cmd(s, me, 'ba-recruit')!, edge = recruit.fields[0];
  assert.ok(edge.kind === 'pick');
  command(s, me, 'ba-recruit', { edge: edge.options[0].value });
  const g = guards(s, me)[0];
  assert.equal(g.active, false);
  command(s, me, 'ba-activate', { guard: g.id });
  command(s, me, 'ba-promote', { guard: g.id });
  assert.deepEqual([guards(s, me)[0].active, guards(s, me)[0].level], [true, 2]);
  const t = facts(s).coast[0], sides = ix(s).tileEdges.get(t)!;
  edit(s, n => { setInvaders(n, t, 1); updateUnit(n, g.id, { at: sides[0] }); ba(n).prisoners[me] = 2; });
  edit(s, n => expel(n));
  assert.equal(ba(s).prisoners[me], 3);
  assert.equal(scoreParts(s, me).find(p => p.key === 'prisoners')!.points, 1);
  const before = onBoard(s);
  edit(s, n => barbarianAttack.beforeProduce!(n, {
    seat: me, dice: [2, 6], total: 8, eventDie: 'ship', grants: [], blocked: [], shortages: [], gold: {},
  }));
  assert.ok(onBoard(s) - before <= facts(s).coast.filter(t => tileNumber(s, t) === 8).length, 'one per 8 hex');
});

const MATCHES: [number, 'standard' | 'connect'][] = [
  [4, 'standard'], [4, 'connect'], [10, 'standard'], [10, 'connect'],
];
for (const [seats, mode] of MATCHES) {
  test(`CPU match: ${seats} seats ${mode} finishes by target with goods conserved`, () => {
    for (const seed of [3, 4]) {
      const r = runMatch({ seats, seed, settings: { ...BA, mode } });
      assert.deepEqual(r.rejected.slice(0, 3), [], `seed ${seed}`);
      assert.equal(r.reason, 'target', `seed ${seed}: ${r.reason} after ${r.rounds} rounds`);
      assert.ok(r.rounds <= (mode === 'standard' ? 60 : 110), `seed ${seed}: ${r.rounds} rounds`);
      assert.deepEqual(inventory(r.s), inventory(fresh(seats, { mode }, seed)));
      serializable(r.s);
    }
  });
}

test('CPU match: with Cities & Knights and with Deliveries, 4 seats finish by target', () => {
  const combos: Partial<Settings>[] = [
    { citiesKnights: true }, { scenarios: ['barbarian-attack', 'deliveries'] },
  ];
  for (const extra of combos) {
    const r = runMatch({ seats: 4, seed: 5, settings: { ...BA, ...extra } });
    assert.deepEqual(r.rejected.slice(0, 3), []);
    assert.equal(r.reason, 'target', `${JSON.stringify(extra)}: ${r.reason} after ${r.rounds} rounds`);
  }
});

