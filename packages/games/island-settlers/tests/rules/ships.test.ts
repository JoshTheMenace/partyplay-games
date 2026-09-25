import { test } from 'node:test';
import assert from 'node:assert/strict';
import { face } from '../../src/engine/legal';
import { setPirate } from '../../src/engine/pieces';
import type { State } from '../../src/engine/state';
import { act, edit, game, unchanged, view } from '../helpers';
import { blank, give, ix, lay, settle, toMain, last } from './helpers';

const sea = (s: State, e: string) => ix(s).edge.get(e)!.tiles.some(t => face(s, t).terrain === 'sea');
const far = (s: State, e: string) => !ix(s).edge.get(e)!.tiles.includes(s.pieces.pirate!);

/** A coastal settlement with a two-ship line heading out to sea, away from the pirate. */
function harbour(s: State, seat: string) {
  for (const c of s.board.vertices.filter(v => v.coast)) {
    for (const e1 of c.edges.filter(e => sea(s, e) && far(s, e))) {
      const x = ix(s).edge.get(e1)!, w = x.a === c.id ? x.b : x.a;
      const e2 = ix(s).vertex.get(w)!.edges.find(e => e !== e1 && sea(s, e) && far(s, e) && !ix(s).edge.get(e)!.land);
      if (!e2) continue;
      settle(s, seat, c.id);
      lay(s, seat, [e1, e2], 'ship');
      return { c: c.id, w, e1, e2 };
    }
  }
  throw new Error('no harbour');
}

test('ships: sea routes grow from own ships or buildings; only the open end moves, once per opportunity', () => {
  const s = blank(game(4, { map: 'seafarers' })), a = s.turn.active!;
  const { w, e1, e2 } = harbour(s, a);
  toMain(s);
  give(s, a, { wood: 3, wool: 3, brick: 3 });
  const ship = view(s, a).build.find(o => o.piece === 'ship')!;
  assert.ok(ship.targets.length && ship.targets.every(e => sea(s, e)));
  const roads = view(s, a).build.find(o => o.piece === 'road')!.targets;
  assert.ok(!roads.some(e => { const x = ix(s).edge.get(e)!; return x.a === w || x.b === w; }), 'no joint at sea');
  const moves = view(s, a).shipMoves;
  assert.deepEqual(moves.map(m => m.from), [e2], 'the ship tied to the settlement stays');
  assert.ok(!moves[0].to.includes(e2) && !moves[0].to.includes(e1));
  const to = moves[0].to[0];
  act(s, a, { type: 'move-ship', from: e2, to });
  assert.equal(s.pieces.routes[to]?.kind, 'ship');
  assert.equal(s.pieces.routes[e2], undefined);
  const e = last(s, 'move');
  assert.ok(e?.kind === 'move' && e.from === e2 && e.to === to && e.piece === 'ship');
  assert.deepEqual(view(s, a).shipMoves, [], 'one move per opportunity');
  unchanged(s, () => act(s, a, { type: 'move-ship', from: to, to: e2 }), /cannot move/);
});

test('ships next to the pirate can neither be built nor moved', () => {
  const s = blank(game(4, { map: 'seafarers' })), a = s.turn.active!;
  const { e2 } = harbour(s, a);
  const tile = ix(s).edge.get(e2)!.tiles.find(t => face(s, t).terrain === 'sea')!;
  edit(s, n => setPirate(n, tile));
  toMain(s);
  give(s, a, { wood: 3, wool: 3 });
  assert.deepEqual(view(s, a).shipMoves, []);
  const spots = view(s, a).build.find(o => o.piece === 'ship')!.targets;
  assert.ok(spots.every(e => !ix(s).edge.get(e)!.tiles.includes(tile)));
});
