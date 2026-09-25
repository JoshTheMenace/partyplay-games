import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Command, PublicView, Settings, Unit } from '../../src/model';
import { boardIndex } from '../../src/engine/board/lookup';
import { placeBuilding, placeUnit, reveal, updateUnit } from '../../src/engine/pieces';
import type { State } from '../../src/engine/state';
import type { ExplorersState } from '../../src/engine/modules/explorers/state';
import { ships } from '../../src/engine/modules/explorers/state';
import { destinations, fogNear, navigable } from '../../src/engine/modules/explorers/sea';
import { settleable } from '../../src/engine/modules/explorers/rules';
import {
  act, answer, command, edit, game, inventory, pastSetup, pub, rig, serializable, unchanged, view,
} from '../helpers';
import { give, last, toMain } from '../rules/helpers';

const EP = (extra: Partial<Settings> = {}) => ({ map: 'explorers' as const, ...extra });
const ext = (s: State) => s.ext.explorers as ExplorersState;
const find = (s: State, seat: string, prefix: string) =>
  view(s, seat).commands.find(c => c.id.startsWith(`explorers/${prefix}`));
const heading = (c: Command, key: string) => {
  const f = c.fields[0];
  return f.kind === 'pick' ? f.options.find(o => o.value === key) : undefined;
};
const edges = (c: Command, key: string) => {
  const f = heading(c, key)?.then?.[0];
  return f?.kind === 'pick' ? f.options.map(o => o.value) : [];
};
/** Past setup and in the first main step. */
function started(seats = 4, extra: Partial<Settings> = {}) {
  const s = game(seats, EP(extra));
  pastSetup(s);
  for (const p of Object.values(s.prompts)) { // a C&K round-2 harbor may still be launching its ship
    const f = view(s, p.seat).prompts[0].command.fields[0];
    answer(s, p.seat, p.kind, { at: f.kind === 'pick' ? f.options[0].value : '' });
  }
  toMain(s);
  return s;
}
/** Put a ship for `seat` on `edge` with `cargo`. */
const launch = (s: State, seat: string, edge: string, cargo: Unit['cargo'] = []) => {
  edit(s, n => placeUnit(n, { id: `t${edge}`, kind: 'expedition', seat, at: edge, level: 2, active: true, cargo }));
  return `t${edge}`;
};

test('board: mission faces stay hidden; the council is public; nothing about fog leaks into views', () => {
  const s = game(4, EP()), hidden = Object.entries(s.hidden), v = pub(s);
  const count = (t: string) => hidden.filter(([, f]) => f.terrain === t).length;
  assert.deepEqual([count('gold'), count('shoal'), count('spice')], [6, 6, 6]);
  assert.ok(hidden.filter(([, f]) => f.terrain === 'gold').every(([, f]) => f.feature?.kind === 'lair'));
  assert.deepEqual(hidden.filter(([, f]) => f.terrain === 'shoal').map(([, f]) => f.number).sort(), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(v.board.features.map(f => f.kind), ['council']);
  for (const [t] of hidden) assert.equal(v.board.tiles.find(x => x.id === t)!.terrain, 'fog');
  const json = JSON.stringify([v, ...s.order.map(id => view(s, id))]);
  assert.ok(!/"(lair|spice)"/.test(json) && !json.includes('"shoal"'), 'no hidden terrain or features in views');
  const small = game(4, EP({ missions: ['lairs'] }));
  assert.ok(!small.board.features.length && !Object.values(small.hidden).some(f => f.terrain === 'spice'));
  const none = game(4, EP({ missions: [] }));
  assert.ok(!Object.values(none.hidden).some(f => f.terrain === 'gold'), 'Land Ho! has no gold fields');
  assert.equal(Object.values(game(10, EP()).hidden).filter(f => f.terrain === 'spice').length, 10);
});

test('profile: 3:1 bank, no ports, cards, cities or awards; C&K brings cities back', () => {
  const s = started(), a = s.turn.active!, me = view(s, a);
  assert.deepEqual(me.build.map(o => o.piece), ['road', 'settlement']);
  assert.ok(Object.values(me.rates).every(r => r === 3));
  assert.deepEqual([s.pieces.robber, s.board.ports.length, s.devDeck.length], [null, 0, 0]);
  const ck = started(4, { citiesKnights: true });
  assert.ok(view(ck, ck.turn.active!).build.some(o => o.piece === 'city'));
});

test('setup: harbor on the home coast plus a ship with a settler, then settlement and road that pay', () => {
  const s = game(4, EP()), a = s.turn.active!;
  assert.equal(s.turn.setup!.piece, 'harbor');
  assert.equal(s.turn.setupPlan.filter(p => p.piece === 'road').length, 4, 'no road after the harbor');
  const spots = view(s, a).build.find(o => o.piece === 'settlement')!.targets, ix = boardIndex(s.board);
  assert.ok(spots.length && spots.every(v => ix.vertex.get(v)!.tiles.some(t => ix.tile.get(t)!.terrain === 'sea')));
  act(s, a, { type: 'build', piece: 'settlement', at: spots[0] });
  assert.equal(s.pieces.buildings[spots[0]].kind, 'harbor');
  const p = view(s, a).prompts.find(q => q.kind === 'explorers/launch')!;
  assert.ok(p && s.turn.active !== a, 'the next seat places while this one launches');
  const edge = p.command.fields[0].kind === 'pick' ? p.command.fields[0].options[0].value : '';
  answer(s, a, 'explorers/launch', { at: edge });
  assert.deepEqual(ships(s, a).map(u => [u.at, u.cargo]), [[edge, ['settler']]]);
  pastSetup(s);
  for (const id of s.order) {
    const kinds = Object.values(s.pieces.buildings).filter(b => b.seat === id).map(b => b.kind).sort();
    assert.deepEqual(kinds, ['harbor', 'settlement']);
    assert.equal(ships(s, id).length, 1);
    assert.equal(ext(s).coins[id], 2, 'everyone starts with 2 gold');
  }
  const ck = game(4, EP({ citiesKnights: true }));
  assert.deepEqual(ck.turn.setupPlan.slice(0, 2).map(p => p.piece), ['city', 'road']);
  assert.equal(ck.turn.setupPlan.at(-1)!.piece, 'harbor');
});

test('sailing: up to 4 moves over explored sea; discovering fog pays and ends the move; it locks building', () => {
  const s = started(), a = s.turn.active!, u = ships(s, a)[0];
  const reach = destinations(s, u);
  assert.ok([...reach.values()].every(l => l.path.length <= 4 && l.path.every(e => navigable(s, e))));
  give(s, a, { wood: 1, wool: 1 });
  assert.ok(find(s, a, 'ship') || find(s, a, 'harbor') || find(s, a, 'buy'), 'build commands before moving');
  const sail = find(s, a, `sail:${u.id}`)!, to = edges(sail, 'explore').find(e => fogNear(s, e).length)!;
  assert.ok(to, 'fog within reach of the starting ship');
  const before = { cards: Object.values(s.seats[a].hand).reduce((n, x) => n + x, 0), coins: ext(s).coins[a] };
  const fog = fogNear(s, to);
  command(s, a, sail.id, { heading: 'explore', to });
  assert.ok(fog.every(t => s.pieces.reveals[t]), 'fog at the corners is revealed');
  assert.equal(view(s, a).ext.explorers!.movesLeft[u.id], 0, 'discovery ends the move');
  const cards = Object.values(s.seats[a].hand).reduce((n, x) => n + x, 0);
  assert.ok(cards + ext(s).coins[a] / 2 > before.cards + before.coins / 2, 'discovery pays a card or 2 gold');
  assert.ok(!find(s, a, 'ship') && !find(s, a, 'buy'), 'no building after moving');
  assert.equal(view(s, a).build.find(o => o.piece === 'road')!.why?.code, 'moved');
  assert.ok(last(s, 'move') && last(s, 'reveal'));
});

test('settlers found settlements from the ship; harbors upgrade coastal settlements for 2 grain 2 ore', () => {
  const s = started(), a = s.turn.active!, u = ships(s, a)[0];
  const edge = s.board.edges.find(e => navigable(s, e.id) && [e.a, e.b].some(v => settleable(s, a, v))
    && !Object.values(s.pieces.units).some(w => w.at === e.id))!;
  edit(s, n => updateUnit(n, u.id, { at: edge.id }));
  const settle = find(s, a, `settle:${u.id}`)!, at = [edge.a, edge.b].find(v => settleable(s, a, v))!;
  const vp = view(s, a).vp;
  command(s, a, settle.id, { at });
  assert.equal(s.pieces.buildings[at].kind, 'settlement');
  assert.ok(!s.pieces.units[u.id], 'the ship and settler go back to the supply');
  assert.equal(view(s, a).vp, vp + 1);
  const s2 = started(), b = s2.turn.active!, coast = s2.board.vertices.find(x => x.coast && settleable(s2, b, x.id))!;
  edit(s2, n => placeBuilding(n, { vertex: coast.id, seat: b, kind: 'settlement' }));
  const stock = inventory(s2), harbor = find(s2, b, 'harbor')!;
  unchanged(s2, () => command(s2, b, harbor.id, { at: coast.id }), /afford/);
  give(s2, b, { grain: 2, ore: 2 });
  const points = view(s2, b).vp;
  command(s2, b, harbor.id, { at: coast.id });
  assert.equal(s2.pieces.buildings[coast.id].kind, 'harbor');
  assert.equal(view(s2, b).vp, points + 1);
  assert.deepEqual(inventory(s2), stock, 'paid to the bank');
});

/** Reveal a lair on a hidden gold field and the hidden hexes around it as sea; `edge` joins it to `sea`. */
function lairScene(s: State) {
  const ix = boardIndex(s.board), hidden = (t: string) => !!s.hidden[t];
  const [tile] = Object.entries(s.hidden)
    .find(([t, f]) => f.terrain === 'gold' && ix.tileNeighbors.get(t)!.some(x => hidden(x.id)))!;
  const around = ix.tileNeighbors.get(tile)!.map(x => x.id).filter(hidden), sea = around[0];
  edit(s, n => {
    for (const t of [tile, ...around]) {
      if (!n.pieces.reveals[t]) reveal(n, t, { ...n.hidden[t], terrain: t === tile ? 'gold' : 'sea', number: 0 });
    }
    ext(n).lairs.push({ tile, crews: {}, captured: null, at: 0 });
  });
  const edge = ix.tileEdges.get(tile)!.find(e => ix.edge.get(e)!.tiles.includes(sea))!;
  return { tile, edge, sea };
}

test('lairs: the third crew captures; involved seats get 2 gold and a step, the hero one more', () => {
  const s = started(), [a, b] = [s.turn.active!, s.order.find(id => id !== s.turn.active)!];
  const { tile, edge } = lairScene(s);
  edit(s, n => { ext(n).lairs[0].crews = { [b]: 1 }; });
  const id = launch(s, a, edge, ['crew', 'crew']);
  const coins = { a: ext(s).coins[a], b: ext(s).coins[b] };
  command(s, a, `explorers/crew:${id}`, { tile });
  assert.equal(ext(s).lairs[0].captured, null, 'two crews are not enough');
  command(s, a, `explorers/crew:${id}`, { tile });
  const lair = ext(s).lairs[0];
  assert.ok(lair.captured === a || lair.captured === b);
  assert.deepEqual([ext(s).coins[a] - coins.a, ext(s).coins[b] - coins.b], [2, 2]);
  const steps = [a, b].map(x => ext(s).missions[x].lairs);
  assert.deepEqual(steps.sort(), [1, 2]);
  assert.equal(s.pieces.reveals[tile].number, s.hidden[tile].number, 'the number disc turns up');
  assert.ok(pub(s).seats.find(x => x.id === lair.captured)!.parts.some(p => p.key === 'bonus-lairs'));
  assert.ok(!view(s, a).commands.some(c => c.id.startsWith('explorers/recover')), 'crews leave on a later turn');
});

test('spices and fish: visit a farm, roll a haul, deliver both at the council for mission steps', () => {
  const s = started(), a = s.turn.active!, ix = boardIndex(s.board);
  const hall = s.board.features.find(f => f.kind === 'council')!.tile;
  const [farm] = Object.entries(s.hidden).find(([, f]) => f.terrain === 'spice')!;
  const [shoal] = Object.entries(s.hidden).find(([, f]) => f.terrain === 'shoal')!;
  edit(s, n => { for (const t of [farm, shoal]) reveal(n, t, n.hidden[t]); });
  const byFarm = launch(s, a, ix.tileEdges.get(farm)!.find(e => ix.edge.get(e)!.tiles.length === 2)!, ['crew']);
  command(s, a, `explorers/crew:${byFarm}`, { tile: farm });
  assert.deepEqual(s.pieces.units[byFarm].cargo, ['spice']);
  assert.deepEqual(ext(s).spiceVisits[a], [farm]);
  edit(s, n => { ext(n).hauls.push(shoal); });
  const byShoal = launch(s, a, ix.tileEdges.get(shoal)![0]);
  command(s, a, `explorers/haul:${byShoal}`, { tile: shoal });
  assert.deepEqual(s.pieces.units[byShoal].cargo, ['fish']);
  const atHall = ix.tileEdges.get(hall)!;
  edit(s, n => { updateUnit(n, byFarm, { at: atHall[0] }); updateUnit(n, byShoal, { at: atHall[1] }); });
  command(s, a, `explorers/deliver:${byFarm}`);
  command(s, a, `explorers/deliver:${byShoal}`);
  assert.deepEqual([ext(s).missions[a].spices, ext(s).missions[a].fish], [1, 1]);
  assert.ok(view(s, a).parts.some(p => p.key === 'mission-fish' && p.points === 1));
});

test('gold: a roll that pays nothing gives 1 gold; 2 gold buy a resource, twice a turn; 3 cards sell for 1', () => {
  const s = game(4, EP()), a = () => s.turn.active!;
  pastSetup(s);
  const before = { ...ext(s).coins };
  rig(s, [6, 6]);
  act(s, a(), { type: 'roll' });
  const paid = new Set((s.lastRoll?.grants ?? []).map(g => g.seat));
  for (const id of s.order) assert.equal(ext(s).coins[id] - before[id], paid.has(id) ? 0 : 1, id);
  edit(s, n => { ext(n).coins[a()] = 6; });
  const stock = inventory(s);
  for (let i = 0; i < 2; i++) command(s, a(), 'explorers/buy', {}, { get: { ore: 1 } });
  assert.equal(ext(s).coins[a()], 2);
  assert.ok(!find(s, a(), 'buy'), 'twice per turn');
  assert.deepEqual(inventory(s), stock, 'goods conserved');
  give(s, a(), { wool: 3 });
  const wool = s.seats[a()].hand.wool;
  command(s, a(), 'explorers/sell', { good: 'wool' });
  assert.deepEqual([s.seats[a()].hand.wool, ext(s).coins[a()]], [wool - 3, 3], '3 cards sell for 1 gold (3:1)');
});

test('pirate: a 7 discards, then the roller places its pirate ship on explored sea and robs a ship owner', () => {
  const s = game(4, EP());
  pastSetup(s);
  const a = s.turn.active!, b = s.order.find(id => id !== a)!;
  const { edge, sea } = lairScene(s);
  launch(s, b, edge);
  give(s, b, { wool: 1 });
  rig(s, [3, 4]);
  act(s, a, { type: 'roll' });
  const p = view(s, a).prompts.find(q => q.kind === 'explorers/pirate')!;
  const tiles = p.command.fields[0].kind === 'pick' ? p.command.fields[0].options.map(o => o.value) : [];
  assert.ok(tiles.includes(sea) && tiles.every(t => s.hidden[t] && s.pieces.reveals[t]));
  const stock = inventory(s);
  answer(s, a, 'explorers/pirate', { tile: sea });
  assert.deepEqual([s.pieces.pirate, ext(s).pirate], [sea, a]);
  assert.equal(last(s, 'steal')?.victim, b);
  assert.deepEqual(inventory(s), stock);
});

test('atomic rejections and serializable views', () => {
  const s = started(), a = s.turn.active!, u = ships(s, a)[0];
  unchanged(s, () => command(s, a, `explorers/sail:${u.id}`, { heading: 'any', to: 'e-nowhere' }));
  unchanged(s, () => command(s, a, 'explorers/harbor', { at: 'v0' }));
  unchanged(s, () => command(s, s.order.find(id => id !== a)!, `explorers/sail:${u.id}`, { heading: 'any' }));
  serializable(s);
  const v: PublicView = pub(s);
  assert.ok(v.hud.some(h => h.key === 'missions') && v.seats.every(x => x.badges.some(b => b.key === 'coins')));
  assert.deepEqual(Object.keys(view(s, a).ext.explorers!.movesLeft), ships(s, a).map(x => x.id));
});
