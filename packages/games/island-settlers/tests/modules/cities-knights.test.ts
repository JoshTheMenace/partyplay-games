/** Cities & Knights rules: setup, commodities, event die, barbarians, improvements, walls, knights. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMODITIES, type Settings } from '../../src/model';
import { attack } from '../../src/engine/modules/cities-knights/barbarians';
import { drawRound } from '../../src/engine/modules/cities-knights/progress';
import { ck, type CkState } from '../../src/engine/modules/cities-knights/state';
import { placeBuilding, placeUnit, setRobber } from '../../src/engine/pieces';
import { rates } from '../../src/engine/trade';
import type { State } from '../../src/engine/state';
import {
  act, answer, command, edit, game, inventory, pastSetup, pub, rig, serializable, unchanged, view,
} from '../helpers';
import { blank, dice, give, hand, ix, lay, last, settle, toMain, trail } from '../rules/helpers';

const CK: Partial<Settings> = { citiesKnights: true };
const x = (s: State): CkState => ck(s);
const cmd = (s: State, seat: string, id: string) => view(s, seat).commands.find(c => c.id === id);
const knight = (s: State, seat: string, at: string, level = 1, active = false, id = `k-${at}`) =>
  edit(s, n => placeUnit(n, { id, kind: 'knight', seat, at, level, active, cargo: [] }));

/** A blank C&K board in `seat`'s main step, the barbarian ship at the start. */
function stage(seats = 4, settings: Partial<Settings> = {}) {
  const s = blank(game(seats, { ...CK, ...settings }));
  edit(s, n => {
    x(n).position = 0;
    x(n).decks.science = x(n).decks.science.filter(k => k !== 'printer');
    x(n).decks.politics = x(n).decks.politics.filter(k => k !== 'constitution');
  });
  toMain(s);
  edit(s, n => { x(n).position = 0; });
  return { s, a: s.turn.active!, b: s.order.find(id => id !== s.turn.active)! };
}

test('setup: round 2 places a city, the bank stocks commodities, no dev cards or robber yet', () => {
  const s = game(4, CK), stock = inventory(s);
  assert.equal(s.settings.targetPoints, 13);
  for (const g of COMMODITIES) assert.equal(s.bank[g], 12);
  pastSetup(s);
  for (const id of s.order) {
    const mine = Object.values(s.pieces.buildings).filter(b => b.seat === id).map(b => b.kind).sort();
    assert.deepEqual(mine, ['city', 'settlement']);
    assert.equal(COMMODITIES.reduce((n, g) => n + s.seats[id].hand[g], 0), 0, 'setup pays resources only');
  }
  assert.equal(s.pieces.robber, null);
  assert.equal(s.devDeck.length, 0);
  assert.equal(view(s, s.order[0]).build.some(o => o.piece === 'development'), false);
  const path = s.board.features.find(f => f.kind === 'barbarian-path');
  assert.equal(path?.kind === 'barbarian-path' && path.tiles.length, 8);
  assert.deepEqual(inventory(s), stock);
  serializable(s);
});

test('cities on forest, pasture and mountains yield 1 resource + 1 commodity; hills and fields 2', () => {
  const s = blank(game(4, CK)), a = s.turn.active!;
  const v = ix(s).vertex.get(s.board.vertices.find(v => v.tiles.some(t => {
    const tile = ix(s).tile.get(t)!;
    return tile.terrain === 'wood' && tile.number;
  }))!.id)!;
  const tile = v.tiles.map(t => ix(s).tile.get(t)!).find(t => t.terrain === 'wood' && t.number)!;
  settle(s, a, v.id, 'city');
  rig(s, dice(tile.number));
  act(s, a, { type: 'roll' });
  const mine = s.lastRoll!.grants.filter(g => g.seat === a && g.tile === tile.id);
  assert.deepEqual(mine.map(g => [g.good, g.amount]).sort(), [['paper', 1], ['wood', 1]]);
  assert.ok(s.lastRoll!.eventDie);
});

test('event die: gates draw by level and red die; ship faces move the barbarians', () => {
  const { s, a, b } = stage();
  edit(s, n => { x(n).seats[a].improvements.science = 1; x(n).seats[b].improvements.science = 3; });
  edit(s, n => drawRound(n, 'science', 3));
  assert.equal(x(s).seats[a].progress.length, 0, 'level 1 draws on red 1-2 only');
  assert.equal(x(s).seats[b].progress.length, 1);
  edit(s, n => drawRound(n, 'science', 2));
  assert.equal(x(s).seats[a].progress.length, 1);
  assert.ok(pub(s).ext['cities-knights']!.seats[a].progress === 1);
  assert.equal(JSON.stringify(pub(s)).includes(x(s).seats[a].progress[0].id), false, 'card ids stay private');
  edit(s, n => { x(n).seats[b].improvements.science = 0; });
  const before = x(s).position;
  for (let i = 0; i < 40 && x(s).position === before; i++) {
    edit(s, n => { n.turn.stage = 'roll'; n.turn.activeDone = false; n.queue = []; });
    rig(s, dice(5));
    act(s, a, { type: 'roll' });
  }
  assert.equal(s.lastRoll!.eventDie, 'ship');
  assert.equal(x(s).position, before + 1);
});

test('printer and constitution score publicly on draw; a fifth card forces a discard off-turn', () => {
  const { s, a, b } = stage();
  edit(s, n => { x(n).seats[b].improvements.politics = 5; x(n).decks.politics.unshift('constitution'); });
  edit(s, n => drawRound(n, 'politics', 1));
  assert.equal(x(s).seats[b].points, 1);
  assert.ok(pub(s).seats.find(p => p.id === b)!.parts.some(p => p.key === 'progress-vp'));
  for (let i = 0; i < 5; i++) edit(s, n => drawRound(n, 'politics', 1));
  assert.equal(x(s).seats[b].progress.length, 5);
  const keep = view(s, b).prompts.find(p => p.kind === 'cities-knights/keep')!;
  assert.equal(keep.scope, 'self');
  const deck = x(s).decks.politics.length, first = keep.command.fields[0];
  answer(s, b, 'cities-knights/keep', { card: first.kind === 'pick' ? first.options[0].value : '' });
  assert.equal(x(s).seats[b].progress.length, 4);
  assert.equal(x(s).decks.politics.length, deck + 1, 'the card goes under its deck');
  // The active seat may hold five until its turn ends.
  edit(s, n => { x(n).seats[a].improvements.trade = 5; for (let i = 0; i < 5; i++) drawRound(n, 'trade', 1); });
  assert.equal(view(s, a).prompts.length, 0);
  act(s, a, { type: 'end' });
  assert.ok(view(s, a).prompts.some(p => p.kind === 'cities-knights/keep'));
  assert.equal(s.turn.active, a, 'the turn waits for the discard');
});

test('barbarians repelled: a unique top defender scores; knights go inactive; the robber arrives', () => {
  const { s, a, b } = stage();
  const [v1, v2, k1, k2] = trail(s, 6).vertices.filter((_, i) => i % 2 === 0);
  settle(s, a, v1, 'city');
  settle(s, b, v2, 'city');
  knight(s, a, k1, 2, true);
  knight(s, b, k2, 1, true);
  edit(s, attack);
  assert.equal(x(s).seats[a].defender, 1);
  assert.equal(last(s, 'barbarians')!.result, 'defended');
  assert.ok(Object.values(s.pieces.units).every(u => !u.active));
  assert.equal(s.pieces.robber, x(s).start);
  assert.ok(s.pieces.robber, 'the robber starts on the desert');
  assert.equal(x(s).position, 0);
});

test('barbarians repelled with a tie: tied defenders each pick a deck', () => {
  const { s, a, b } = stage();
  const [v1, k1, k2] = trail(s, 4).vertices.filter((_, i) => i % 2 === 0);
  settle(s, a, v1, 'city');
  knight(s, a, k1, 1, true);
  knight(s, b, k2, 1, true);
  edit(s, attack);
  assert.equal(view(s, a).prompts[0].kind, 'cities-knights/defense-draw');
  answer(s, a, 'cities-knights/defense-draw', { track: 'trade' });
  answer(s, b, 'cities-knights/defense-draw', { track: 'politics' });
  assert.deepEqual([x(s).seats[a].progress.length + x(s).seats[a].points, x(s).seats[a].defender], [1, 0]);
});

test('barbarians win: the weakest lose a city (their choice), walls fall, metropolises are safe', () => {
  const { s, a, b } = stage();
  const t = trail(s, 10).vertices.filter((_, i) => i % 2 === 0);
  settle(s, a, t[0], 'city');
  settle(s, a, t[1], 'city');
  edit(s, n => placeBuilding(n, { ...n.pieces.buildings[t[0]], wall: true }));
  edit(s, n => placeBuilding(n, { vertex: t[2], seat: b, kind: 'city', metropolis: 'science' }));
  settle(s, b, t[3], 'city');
  knight(s, b, t[4], 1, true);
  const c = s.order.find(id => id !== a && id !== b)!;
  edit(s, attack);
  assert.equal(last(s, 'barbarians')!.result, 'pillaged');
  assert.deepEqual(last(s, 'barbarians')!.losers, [a], `${c} has no city, ${b} has a knight`);
  unchanged(s, () => answer(s, a, 'cities-knights/pillage', { city: t[2] }));
  answer(s, a, 'cities-knights/pillage', { city: t[0] });
  assert.equal(s.pieces.buildings[t[0]].kind, 'settlement');
  assert.equal(s.pieces.buildings[t[0]].wall, undefined);
  assert.equal(s.pieces.buildings[t[2]].metropolis, 'science');
});

test('a 7 before the first attack: discards only, the robber stays off the board', () => {
  const s = blank(game(4, CK)), a = s.turn.active!;
  give(s, a, { wood: 5, brick: 5 });
  rig(s, [3, 4]);
  act(s, a, { type: 'roll' });
  answer(s, a, 'discard', {}, { cards: { wood: 5 } });
  assert.equal(pub(s).robberChoices.length, 0);
  assert.equal(s.turn.stage, 'main');
});

test('improvements: cost, city needed, level 4 takes the metropolis, 5 takes it from a level-4 holder', () => {
  const { s, a, b } = stage();
  assert.equal(cmd(s, a, 'ck:improve:science'), undefined, 'needs a city');
  const [v1, v2, v3] = trail(s, 4).vertices.filter((_, i) => i % 2 === 0);
  settle(s, a, v1, 'city');
  settle(s, b, v2, 'city');
  settle(s, b, v3, 'city');
  assert.deepEqual(cmd(s, a, 'ck:improve:science')!.cost, { paper: 1 });
  unchanged(s, () => command(s, a, 'ck:improve:science'), /afford/);
  give(s, a, { paper: 10 });
  for (let i = 0; i < 4; i++) command(s, a, 'ck:improve:science');
  assert.equal(x(s).seats[a].improvements.science, 4);
  assert.equal(s.pieces.buildings[v1].metropolis, 'science');
  assert.equal(hand(s, a).paper, undefined);
  assert.ok(view(s, a).parts.some(p => p.key === 'metropolis' && p.points === 2));
  assert.deepEqual(pub(s).hud.find(h => h.key === 'metropolis-science'),
    { kind: 'holder', key: 'metropolis-science', label: 'Science metropolis', seat: a, icon: 'science' });
  edit(s, n => { x(n).seats[b].improvements.science = 4; n.turn.active = b; n.turn.activeDone = false; });
  give(s, b, { paper: 5 });
  const up = cmd(s, b, 'ck:improve:science')!;
  assert.equal(up.fields[0].key, 'city', 'two cities: the new holder picks one');
  command(s, b, 'ck:improve:science', { city: v3 });
  assert.equal(s.pieces.buildings[v1].metropolis, undefined);
  assert.equal(s.pieces.buildings[v3].metropolis, 'science');
  assert.equal(cmd(s, b, 'ck:improve:science'), undefined, 'track complete');
});

test('level 3 abilities: Trading House 2:1 commodities; Aqueduct pays a seat that got nothing', () => {
  const { s, a, b } = stage();
  const [v1, v2] = trail(s, 2).vertices.filter((_, i) => i % 2 === 0);
  settle(s, a, v1, 'city');
  settle(s, b, v2, 'city');
  assert.equal(rates(s, a).cloth, 4);
  edit(s, n => { x(n).seats[a].improvements.trade = 3; x(n).seats[b].improvements.science = 3; });
  assert.deepEqual([rates(s, a).cloth, rates(s, a).coin, rates(s, a).wood], [2, 2, 4]);
  const quiet = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].find(n => !ix(s).vertex.get(v2)!.tiles
    .some(t => ix(s).tile.get(t)!.number === n))!;
  edit(s, n => { n.turn.stage = 'roll'; n.queue = []; x(n).position = 0; });
  rig(s, dice(quiet));
  act(s, a, { type: 'roll' });
  assert.ok(view(s, b).prompts.some(p => p.kind === 'cities-knights/aqueduct'));
  const before = inventory(s);
  answer(s, b, 'cities-knights/aqueduct', {}, { cards: { ore: 1 } });
  assert.equal(s.seats[b].hand.ore >= 1, true);
  assert.deepEqual(inventory(s), before);
});

test('city walls: 2 brick, +2 discard limit each, at most 3', () => {
  const { s, a } = stage();
  const cities = trail(s, 8).vertices.filter((_, i) => i % 2 === 0);
  for (const v of cities) settle(s, a, v, 'city');
  give(s, a, { brick: 8 });
  for (const v of cities.slice(0, 3)) command(s, a, 'ck:wall', { city: v });
  assert.equal(pub(s).seats.find(p => p.id === a)!.discardLimit, 13);
  assert.equal(cmd(s, a, 'ck:wall'), undefined, 'three walls is the maximum');
  assert.equal(last(s, 'build')!.piece, 'wall');
});

test('knights: recruit on your route, block rival roads and settlement sites, act from next turn', () => {
  const { s, a, b } = stage();
  const t = trail(s, 4), [v0, v1, v2, v3, v4] = t.vertices, [e0, e1, e2, e3] = t.edges;
  settle(s, a, v0);
  lay(s, a, [e0, e1]);
  settle(s, b, v4);
  lay(s, b, [e3, e2]);
  const spare = ix(s).vertex.get(v2)!.edges.find(e => e !== e1 && e !== e2)!;
  const roads = () => {
    edit(s, n => { n.turn.active = b; });
    const r = view(s, b).build.find(o => o.piece === 'road')!;
    edit(s, n => { n.turn.active = a; });
    return r.targets;
  };
  assert.ok(roads().includes(spare));
  assert.ok(view(s, a).build.find(o => o.piece === 'settlement')!.targets.includes(v2));
  give(s, a, { wool: 2, ore: 2, grain: 2 });
  const recruit = cmd(s, a, 'ck:recruit')!.fields[0];
  assert.ok(recruit.kind === 'pick' && recruit.options.some(o => o.value === v2));
  assert.ok(recruit.options.every(o => o.value !== v3), 'only corners on your routes');
  unchanged(s, () => command(s, a, 'ck:recruit', { at: v3 }));
  command(s, a, 'ck:recruit', { at: v2 });
  const k = Object.values(s.pieces.units).find(u => u.kind === 'knight' && u.seat === a)!;
  assert.deepEqual([k.at, k.level, k.active], [v2, 1, false]);
  assert.equal(roads().includes(spare), false, 'no road past a rival knight');
  assert.equal(view(s, a).build.find(o => o.piece === 'settlement')!.targets.includes(v2), false);
  command(s, a, `ck:activate:${k.id}`);
  assert.equal(s.pieces.units[k.id].active, true);
  assert.equal(cmd(s, a, `ck:move:${k.id}`), undefined, 'activated this turn: no action yet');
  edit(s, n => { x(n).knights[k.id].activated = -1; });
  command(s, a, `ck:move:${k.id}`, { at: v1 });
  assert.deepEqual([s.pieces.units[k.id].at, s.pieces.units[k.id].active], [v1, false]);
  assert.equal(last(s, 'move')!.piece, 'knight');
  assert.ok(roads().includes(spare), 'the way is open again');
});

test('knights: promotion limits, displacement and retreat, chasing the robber', () => {
  const { s, a, b } = stage();
  const t = trail(s, 6), v = t.vertices;
  settle(s, a, v[0]);
  lay(s, a, t.edges.slice(0, 3));
  settle(s, b, v[6]);
  lay(s, b, t.edges.slice(3));
  knight(s, a, v[1], 2, true, 'ka');
  knight(s, b, v[3], 1, false, 'kb');
  give(s, a, { wool: 3, ore: 3 });
  assert.equal(cmd(s, a, 'ck:promote:ka'), undefined, 'mighty knights need politics 3');
  edit(s, n => { x(n).seats[a].improvements.politics = 3; });
  command(s, a, 'ck:promote:ka');
  assert.equal(s.pieces.units.ka.level, 3);
  assert.equal(cmd(s, a, 'ck:promote:ka'), undefined, 'once per turn and at most level 3');
  const move = cmd(s, a, 'ck:move:ka')!;
  assert.ok(move.fields[0].kind === 'pick' && move.fields[0].options.some(o => o.value === v[3]));
  command(s, a, 'ck:move:ka', { at: v[3] });
  assert.equal('kb' in s.pieces.units, false);
  const retreat = view(s, b).prompts.find(p => p.kind === 'cities-knights/retreat')!;
  assert.ok(retreat.command.fields[0].kind === 'pick' && retreat.command.fields[0].options.length);
  answer(s, b, 'cities-knights/retreat', { at: v[4] });
  assert.deepEqual([s.pieces.units.kb.at, s.pieces.units.kb.active], [v[4], false]);
  // Chase the robber from a hex next to a ready knight.
  const tile = ix(s).vertex.get(v[1])!.tiles.find(id => ix(s).tile.get(id)!.terrain !== 'sea')!;
  knight(s, a, v[1], 1, true, 'kc');
  edit(s, n => { setRobber(n, tile); x(n).attacks = 1; });
  give(s, b, { grain: 1 });
  const chase = cmd(s, a, 'ck:chase:kc')!;
  const hex = chase.fields[0].kind === 'pick' ? chase.fields[0].options[0].value : '';
  command(s, a, 'ck:chase:kc', { tile: hex });
  assert.equal(s.pieces.robber, hex);
  assert.equal(s.pieces.units.kc.active, false);
});
