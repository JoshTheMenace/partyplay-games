/** Cities & Knights combination rules with Seafarers, Explorers & Pirates and Rivers (official notes). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PickField, Settings } from '../../src/model';
import { isLandTile } from '../../src/engine/legal';
import { attack } from '../../src/engine/modules/cities-knights/barbarians';
import { reach, recruitSites, shipVeto } from '../../src/engine/modules/cities-knights/knights';
import { ck, sx } from '../../src/engine/modules/cities-knights/state';
import { ext } from '../../src/engine/modules/explorers/state';
import { coins, rx } from '../../src/engine/modules/rivers';
import { placeUnit, reveal } from '../../src/engine/pieces';
import type { State } from '../../src/engine/state';
import { act, answer, command, edit, game, pastSetup, rig, view } from '../helpers';
import { blank, clear, give, ix, lay, settle, toMain } from '../rules/helpers';

const CK = { citiesKnights: true };

test('Seafarers: a ship may not sail from under the knight it connects; knights travel by ship', () => {
  const s = blank(game(4, { ...CK, map: 'seafarers' })), a = s.turn.active!;
  const e2 = s.board.edges.find(e => e.sea && !e.land && s.board.edges.some(f => f.id !== e.id && f.sea && !f.land
    && (f.a === e.a || f.b === e.a)))!;
  const e1 = s.board.edges.find(f => f.id !== e2.id && f.sea && !f.land && (f.a === e2.a || f.b === e2.a))!;
  const v0 = e1.a === e2.a ? e1.b : e1.a;
  settle(s, a, v0);
  lay(s, a, [e1.id, e2.id], 'ship');
  assert.equal(shipVeto(s, a, e2.id), false);
  edit(s, n => placeUnit(n, { id: 'k', kind: 'knight', seat: a, at: e2.b, level: 1, active: true, cargo: [] }));
  assert.equal(shipVeto(s, a, e2.id), true);
  assert.ok(reach(s, a, v0).open.includes(e2.a), 'knights move along ships');
});

test('Explorers & Pirates: Bishop activates the pirate fleet instead of the robber', () => {
  const s = game(4, { ...CK, map: 'explorers' });
  pastSetup(s);
  const sea = Object.keys(s.hidden).find(t => s.hidden[t].terrain === 'sea')!;
  edit(s, n => { n.prompts = {}; n.queue = []; Object.assign(n.turn, { stage: 'main', activeDone: false }); });
  edit(s, n => reveal(n, sea, n.hidden[sea]));
  const a = s.turn.active!;
  edit(s, n => { sx(n, a).progress.push({ id: 'b1', kind: 'bishop', track: 'politics' }); });
  command(s, a, 'ck:play:b1');
  assert.ok(Object.values(s.prompts).some(p => p.kind === 'explorers/pirate' && p.seat === a));
});

/** E&P + C&K past setup (round-2 harbor ships launched) and in the first main step. */
function explorers(extra: Partial<Settings> = {}) {
  const s = game(4, { ...CK, map: 'explorers', ...extra });
  pastSetup(s);
  for (const p of Object.values(s.prompts)) {
    const f = view(s, p.seat).prompts[0].command.fields[0] as PickField;
    answer(s, p.seat, p.kind, { at: f.options[0].value });
  }
  toMain(s);
  return s;
}
const fog = (s: State, v: string) => ix(s).vertex.get(v)!.tiles.some(t => s.hidden[t] && !s.pieces.reveals[t]);

test('Explorers & Pirates: knights never stand beside fog and never travel by ship', () => {
  const s = explorers(), a = s.turn.active!;
  // Reveal one fog hex as land and take a road on it with one corner beside fog and one clear of it.
  const pick = Object.keys(s.hidden).flatMap(t => ix(s).tileEdges.get(t)!.map(e => ({ t, e: ix(s).edge.get(e)! })))
    .find(({ t, e }) => {
      const touching = (v: string) => ix(s).vertex.get(v)!.tiles.some(x => x !== t && s.hidden[x]);
      return touching(e.a) !== touching(e.b);
    })!;
  edit(s, n => reveal(n, pick.t, { terrain: 'wood', number: 5 }));
  lay(s, a, [pick.e.id]);
  const [open, foggy] = fog(s, pick.e.a) ? [pick.e.b, pick.e.a] : [pick.e.a, pick.e.b];
  assert.ok(recruitSites(s, a).includes(open) && !recruitSites(s, a).includes(foggy));
  assert.ok(recruitSites(s, a).every(v => !fog(s, v)));
  // Expedition ships are units, not routes: nothing beyond a ship becomes a knight site.
  const ship = Object.values(s.pieces.units).find(u => u.kind === 'expedition' && u.seat === a)!;
  const road = (v: string) => ix(s).vertex.get(v)!.edges.some(e => s.pieces.routes[e]?.seat === a);
  const far = [ix(s).edge.get(ship.at)!.a, ix(s).edge.get(ship.at)!.b].filter(v => !road(v));
  assert.ok(far.length && far.every(v => !recruitSites(s, a).includes(v)));
  assert.deepEqual(s.profile.routeKinds, ['road']);
});

test('Explorers & Pirates: Medicine also makes a harbor settlement for 1 grain and 1 ore', () => {
  const s = explorers(), a = s.turn.active!;
  const v = s.board.vertices.find(x => x.tiles.some(t => !isLandTile(s, t)) && x.tiles.some(t => isLandTile(s, t))
    && !s.pieces.buildings[x.id] && !ix(s).vertexNeighbors.get(x.id)!.some(n => s.pieces.buildings[n])
    && !fog(s, x.id) && x.tiles.every(t => !s.hidden[t]))!.id;
  settle(s, a, v);
  clear(s, a);
  give(s, a, { grain: 1, ore: 1 });
  edit(s, n => { sx(n, a).progress.push({ id: 'm1', kind: 'medicine', track: 'science' }); });
  const play = view(s, a).commands.find(c => c.id === 'ck:play:m1')!;
  assert.deepEqual(play.cost, { grain: 1, ore: 1 });
  const at = (play.fields[0] as PickField).options.find(o => o.value === v)!;
  assert.deepEqual((at.then![0] as PickField).options.map(o => o.value), ['harbor'], 'a city needs a second ore');
  command(s, a, 'ck:play:m1', { at: v, to: 'harbor' });
  assert.equal(s.pieces.buildings[v].kind, 'harbor');
  assert.deepEqual([s.seats[a].hand.grain, s.seats[a].hand.ore], [0, 0]);
});

test('Explorers & Pirates: the Aqueduct also pays on a 7, with 1 gold', () => {
  const s = explorers(), a = s.turn.active!, b = s.order.find(id => id !== a)!;
  act(s, a, { type: 'end' });
  edit(s, n => { sx(n, b).improvements.science = 3; ck(n).position = 0; });
  const gold = ext(s).coins[b];
  rig(s, [3, 4]);
  act(s, s.turn.active!, { type: 'roll' });
  const p = view(s, b).prompts.find(q => q.kind === 'cities-knights/aqueduct')!;
  assert.match(p.command.detail, /gold/);
  const wood = s.seats[b].hand.wood;
  answer(s, b, 'cities-knights/aqueduct', {}, { cards: { wood: 1 } });
  assert.deepEqual([ext(s).coins[b], s.seats[b].hand.wood], [gold + 1, wood + 1]);
});

test('Rivers: a seat about to be pillaged may pay 5 gold to keep its city', () => {
  const s = blank(game(4, { ...CK, scenarios: ['rivers'] })), [a, b] = s.order;
  const [va, vb] = s.board.vertices.filter(v => v.tiles.every(t => isLandTile(s, t))).map(v => v.id)
    .filter((v, i, all) => i === 0 || !ix(s).vertexNeighbors.get(all[0])!.includes(v));
  settle(s, a, va, 'city');
  settle(s, b, vb, 'city');
  edit(s, n => { rx(n).coins[a] = 5; rx(n).coins[b] = 4; attack(n); });
  assert.equal(s.pieces.buildings[vb].kind, 'settlement', 'no gold, no choice');
  const f = view(s, a).prompts.find(p => p.kind === 'cities-knights/pillage')!.command.fields[0] as PickField;
  assert.deepEqual(f.options.map(o => o.value), [va, 'keep']);
  answer(s, a, 'cities-knights/pillage', { city: 'keep' });
  assert.deepEqual([s.pieces.buildings[va].kind, coins(s, a)], ['city', 0]);
});
