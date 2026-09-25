import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIECE_LIMITS, type Purchase } from '../../src/model';
import { isLandTile } from '../../src/engine/legal';
import type { State } from '../../src/engine/state';
import { act, game, unchanged, view } from '../helpers';
import { blank, clear, give, hand, inland, ix, lay, settle, toMain, trail } from './helpers';

const option = (s: State, seat: string, piece: Purchase) => view(s, seat).build.find(o => o.piece === piece)!;
const rich = { wood: 9, brick: 9, wool: 9, grain: 9, ore: 9 };

test('setup: any land corner obeying the distance rule, then a route touching the new settlement', () => {
  const s = game(3), a = s.turn.active!;
  const land = s.board.vertices.filter(v => v.tiles.some(t => isLandTile(s, t))).map(v => v.id);
  assert.deepEqual(new Set(option(s, a, 'settlement').targets), new Set(land));
  assert.equal(option(s, a, 'settlement').free, 1);
  assert.deepEqual(option(s, a, 'road').targets, [], 'no route before the settlement');
  const v = inland(s)[0];
  act(s, a, { type: 'build', piece: 'settlement', at: v });
  const edges = ix(s).vertex.get(v)!.edges;
  assert.deepEqual(new Set(option(s, a, 'road').targets), new Set(edges));
  const far = s.board.edges.find(e => !edges.includes(e.id) && e.land)!.id;
  unchanged(s, () => act(s, a, { type: 'build', piece: 'road', at: far }), /not available/);
  const coast = edges.find(e => ix(s).edge.get(e)!.sea);
  const ship = () => act(s, a, { type: 'build', piece: 'ship', at: coast! });
  if (coast) unchanged(s, ship, /No legal spot|not available/);
  act(s, a, { type: 'build', piece: 'road', at: edges[0] });
  const b = s.turn.active!, spots = option(s, b, 'settlement').targets;
  const near = [v, ...ix(s).vertexNeighbors.get(v)!];
  assert.ok(near.every(n => !spots.includes(n)), 'distance rule');
  assert.deepEqual(hand(s, a), {}, 'setup placements are free');
});

test('main: settlements need an own road and the distance rule; roads grow from own pieces only', () => {
  const s = blank(game(3)), a = s.turn.active!, b = s.order[1];
  const { vertices: v, edges } = trail(s, 4);
  settle(s, a, v[0]);
  lay(s, a, edges.slice(0, 2));
  toMain(s);
  give(s, a, rich);
  const spots = option(s, a, 'settlement').targets;
  assert.deepEqual(spots, [v[2]], 'only the far end of the road, two steps out');
  const roads = option(s, a, 'road').targets, own = new Set([v[0], v[1], v[2]]);
  assert.ok(roads.includes(edges[2]));
  assert.ok(roads.every(e => { const x = ix(s).edge.get(e)!; return own.has(x.a) || own.has(x.b); }));
  settle(s, b, v[2]);
  assert.ok(!option(s, a, 'road').targets.includes(edges[2]), 'an opponent settlement stops the road');
  assert.deepEqual(option(s, a, 'settlement').why?.code, 'no-spot');
  unchanged(s, () => act(s, a, { type: 'build', piece: 'settlement', at: v[1] }), /No legal spot/);
  act(s, a, { type: 'build', piece: 'road', at: option(s, a, 'road').targets[0] });
  assert.equal(s.seats[a].hand.wood, 8, 'a paid road costs wood and brick');
});

test('city upgrades replace an own settlement; piece limits and costs give reasons', () => {
  const s = blank(game(3)), a = s.turn.active!;
  const spots: string[] = [];
  for (const v of inland(s)) if (spots.every(o => !ix(s).vertexNeighbors.get(o)!.includes(v))) spots.push(v);
  for (const v of spots.slice(0, 5)) settle(s, a, v);
  toMain(s);
  clear(s, a);
  assert.deepEqual(option(s, a, 'city').why, { code: 'cost', text: 'Need 2 grain, 3 ore' });
  assert.deepEqual(option(s, a, 'city').missing, { grain: 2, ore: 3 });
  assert.equal(option(s, a, 'settlement').why?.code, 'no-pieces');
  give(s, a, { grain: 8, ore: 12 });
  assert.deepEqual(new Set(option(s, a, 'city').targets), new Set(spots.slice(0, 5)));
  for (const v of spots.slice(0, 4)) act(s, a, { type: 'build', piece: 'city', at: v });
  assert.equal(s.pieces.buildings[spots[0]].kind, 'city');
  const left = view(s, a).build;
  assert.equal(left.find(o => o.piece === 'city')!.left, 0);
  assert.equal(left.find(o => o.piece === 'city')!.why?.code, 'no-pieces');
  assert.equal(left.find(o => o.piece === 'settlement')!.left, PIECE_LIMITS.settlements - 1);
  assert.deepEqual(hand(s, a), {}, 'four cities cost 8 grain and 12 ore');
});

test('roads run out at 15; other seats and the roll stage get turn reasons', () => {
  const s = blank(game(3)), a = s.turn.active!, b = s.order[1];
  assert.equal(option(s, a, 'road').why?.code, 'roll-first');
  assert.equal(option(s, b, 'road').why?.code, 'not-your-turn');
  lay(s, a, s.board.edges.filter(e => e.land).slice(0, 15).map(e => e.id));
  toMain(s);
  give(s, a, rich);
  assert.equal(option(s, a, 'road').left, 0);
  assert.deepEqual(option(s, a, 'road').targets, []);
  assert.equal(option(s, a, 'road').why?.code, 'no-pieces');
});
