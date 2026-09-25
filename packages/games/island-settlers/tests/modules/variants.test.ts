/** Friendly Robber and Harbormaster: rule units, projections and CPU matches. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Mode, Variant } from '../../src/model';
import { boardIndex } from '../../src/engine/board/lookup';
import { setInvaders } from '../../src/engine/modules/barbarian-attack/coast';
import { harborPoints } from '../../src/engine/modules/harbormaster';
import { setRobber } from '../../src/engine/pieces';
import type { State } from '../../src/engine/state';
import { runMatch } from '../cpu/match';
import { act, edit, game, inventory, pub, rig, serializable, view } from '../helpers';
import { blank, last, settle } from '../rules/helpers';

const variant = (v: Variant, seats = 4) => blank(game(seats, { variants: [v] }));
const choices = (s: State, seat: string) => pub(s).robberChoices.find(c => c.seat === seat)!.tiles;

/** Corners (none touching a desert) that together touch every other land hex. */
function cover(s: State) {
  const ix = boardIndex(s.board), land = s.board.tiles.filter(t => !['sea', 'desert'].includes(t.terrain));
  const left = new Set(land.map(t => t.id)), ok = s.board.vertices.filter(v =>
    v.tiles.every(t => ix.tile.get(t)!.terrain !== 'desert'));
  const out: string[] = [];
  while (left.size) {
    const gain = (x: (typeof ok)[number]) => x.tiles.filter(t => left.has(t)).length;
    const v = ok.reduce((a, b) => (gain(b) > gain(a) ? b : a));
    out.push(v.id);
    v.tiles.forEach(t => left.delete(t));
  }
  return out;
}

test('friendly robber: hexes touching a seat with 2 VP or less are closed; it is never robbed', () => {
  const s = variant('friendly-robber'), [a, b, c] = s.order, ix = boardIndex(s.board);
  const tiles = s.board.tiles.filter(t => t.number > 0 && t.id !== s.pieces.robber), weak = tiles[0];
  const corners = (id: string) => ix.tileVertices.get(id)!, spot = corners(weak.id)[0];
  const strong = tiles.find(t => t !== weak && !corners(t.id).includes(spot))!;
  settle(s, b, spot);
  settle(s, c, corners(strong.id).find(v => !corners(weak.id).includes(v))!);
  const apart = (t: { id: string }, x: { id: string }) => !corners(x.id).some(v => corners(t.id).includes(v));
  const far = tiles.find(t => apart(t, weak) && apart(t, strong))!;
  for (const v of corners(far.id).filter((_, i) => i % 2)) settle(s, c, v);
  edit(s, n => { n.seats[b].hand.ore = 1; n.seats[c].hand.ore = 1; n.bank.ore -= 2; });
  assert.deepEqual(pub(s).ext['friendly-robber']!.safe.sort(), s.order.filter(id => id !== c).sort());
  assert.ok(pub(s).seats.find(x => x.id === b)!.badges.some(g => g.key === 'safe'));
  rig(s, [3, 4]);
  act(s, a, { type: 'roll' });
  const legal = choices(s, a);
  assert.ok(!legal.some(t => t.tile === weak.id), 'the weak seat\'s hex is closed');
  assert.deepEqual(legal.find(t => t.tile === strong.id)!.victims, [c]);
  const cmd = view(s, a).prompts[0].command.fields[0];
  const listed = cmd.kind === 'pick' && cmd.options.some(o => o.value === weak.id);
  assert.equal(listed, false, 'the phone and CPU see the same list');
});

test('friendly robber: if every hex is protected, the desert (no steal); failing that, anywhere', () => {
  const s = variant('friendly-robber'), [a] = s.order;
  const desert = s.board.tiles.find(t => t.terrain === 'desert')!.id, spots = cover(s);
  assert.ok(spots.length <= 8, `${spots.length} corners`);
  spots.forEach((v, i) => settle(s, s.order[i % 4], v));
  const elsewhere = s.board.tiles.find(t => t.number > 0)!.id;
  edit(s, n => setRobber(n, elsewhere));
  rig(s, [3, 4]);
  act(s, a, { type: 'roll' });
  assert.deepEqual(choices(s, a).map(t => t.tile), [desert]);
  const s2 = variant('friendly-robber'), [a2] = s2.order;
  cover(s2).forEach((v, i) => settle(s2, s2.order[i % 4], v));
  edit(s2, n => {
    setRobber(n, desert);
    for (const id of n.order) { n.seats[id].hand.wool = 1; n.bank.wool--; }
  });
  rig(s2, [3, 4]);
  act(s2, a2, { type: 'roll' });
  const all = choices(s2, a2);
  assert.ok(all.length > 1, 'with the robber on the only desert, every hex stays legal');
  assert.ok(all.every(t => t.victims.length === 0), 'but nobody with 2 VP or less is robbed');
});

test('harbormaster: 1 per settlement and 2 per city on a port; 3 takes it; only more takes it away', () => {
  const s = variant('harbormaster'), [a, b] = s.order, ports = s.board.ports;
  settle(s, a, ports[0].vertices[0]);
  settle(s, a, ports[1].vertices[0]);
  assert.equal(harborPoints(s, a), 2);
  assert.equal(s.awards.harbormaster, null);
  settle(s, a, ports[0].vertices[0], 'city');
  assert.equal(harborPoints(s, a), 3);
  assert.equal(s.awards.harbormaster, a);
  assert.deepEqual(last(s, 'award'), { ...last(s, 'award')!, award: 'harbormaster', seat: a, from: null });
  assert.equal(view(s, a).parts.find(p => p.key === 'harbormaster')!.points, 2);
  settle(s, b, ports[2].vertices[0], 'city');
  settle(s, b, ports[3].vertices[0]);
  assert.equal(s.awards.harbormaster, a, 'a tie keeps the holder');
  settle(s, b, ports[4].vertices[0]);
  assert.equal(s.awards.harbormaster, b);
  assert.deepEqual(pub(s).ext.harbormaster!.points[b], 4);
  assert.ok(pub(s).hud.some(h => h.kind === 'holder' && h.key === 'harbormaster' && h.seat === b));
  assert.ok(pub(s).seats.find(x => x.id === b)!.badges.some(g => g.key === 'harbor' && g.value === 4));
});

test('harbormaster counts building VP: a metropolis 4, a conquered building nothing', () => {
  const s = variant('harbormaster'), [a] = s.order, v = s.board.ports[0].vertices[0];
  settle(s, a, v, 'city');
  edit(s, n => { n.pieces.buildings[v].metropolis = 'trade'; });
  assert.equal(harborPoints(s, a), 4);
  const t = blank(game(4, { variants: ['harbormaster'], scenarios: ['barbarian-attack'] })), [b] = t.order;
  const w = t.board.ports[0].vertices[0];
  settle(t, b, w, 'city');
  assert.equal(harborPoints(t, b), 2);
  edit(t, n => { for (const tile of boardIndex(n.board).vertex.get(w)!.tiles) setInvaders(n, tile, 3); });
  assert.equal(harborPoints(t, b), 0);
});

const MODES: Mode[] = ['standard', 'connect'];
for (const v of ['friendly-robber', 'harbormaster'] as const) for (const mode of MODES) {
  test(`CPU matches (${v}, ${mode}, 4 and 10 seats) finish by target; goods conserved`, () => {
    for (const seats of [4, 10]) {
      const settings = { variants: [v], mode }, r = runMatch({ seats, seed: 3, settings });
      assert.deepEqual(r.rejected.slice(0, 3), [], `${seats} seats`);
      assert.equal(r.reason, 'target', `${seats} seats: ${r.reason} after ${r.rounds} rounds`);
      assert.deepEqual(inventory(r.s), inventory(game(seats, settings, 3)));
      serializable(r.s);
    }
  });
}
