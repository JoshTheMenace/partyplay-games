import { test } from 'node:test';
import assert from 'node:assert/strict';
import { longestRoute } from '../../src/engine/score';
import type { State } from '../../src/engine/state';
import { act, edit, game, pub, view } from '../helpers';
import { blank, give, inland, ix, lay, settle, toMain, walk, last } from './helpers';

const around = (s: State, v: string) => ix(s).vertexNeighbors.get(v)!;
const centre = (s: State) => inland(s).find(v => around(s, v).every(n => inland(s).includes(n)))!;

test('longest route: a straight line, a fork and a loop with a tail', () => {
  const s = blank(game(3)), [a, b, c] = s.order, used = new Set<string>();
  lay(s, a, walk(s, centre(s), 5, used).edges);
  assert.equal(longestRoute(s, a), 5);
  const x = inland(s).find(v => !used.has(v) && around(s, v).every(n => !used.has(n)))!;
  used.add(x);
  for (const n of [3, 2, 1]) lay(s, b, walk(s, x, n, used).edges);
  assert.equal(longestRoute(s, b), 5, 'a fork counts its two longest branches');
  const tile = s.board.tiles.find(t => ix(s).tileVertices.get(t.id)!.every(v => !used.has(v))
    && ix(s).tileVertices.get(t.id)!.some(v => inland(s).includes(v)))!;
  const ring = ix(s).tileEdges.get(tile.id)!, corners = ix(s).tileVertices.get(tile.id)!;
  for (const v of corners) used.add(v);
  lay(s, c, ring);
  assert.equal(longestRoute(s, c), 6, 'a closed loop');
  const start = corners.find(v => ix(s).vertexNeighbors.get(v)!.some(n => !used.has(n)))!;
  lay(s, c, walk(s, start, 2, used).edges);
  assert.equal(longestRoute(s, c), 8, 'tail plus the whole loop');
});

test('longest route: an opponent settlement splits it; road/ship joints need an own building', () => {
  const s = blank(game(3)), [a, b] = s.order, line = walk(s, centre(s), 7);
  lay(s, a, line.edges);
  assert.equal(longestRoute(s, a), 7);
  settle(s, a, line.vertices[3]);
  assert.equal(longestRoute(s, a), 7, 'an own settlement does not split');
  edit(s, n => { delete n.pieces.buildings[line.vertices[3]]; });
  settle(s, b, line.vertices[3]);
  assert.equal(longestRoute(s, a), 4);
  const t = blank(game(3)), mixed = walk(t, centre(t), 5), me = t.order[0];
  lay(t, me, mixed.edges.slice(0, 3));
  lay(t, me, mixed.edges.slice(3), 'ship');
  assert.equal(longestRoute(t, me), 3, 'no building at the joint');
  settle(t, me, mixed.vertices[3]);
  assert.equal(longestRoute(t, me), 5);
});

test('awards: a tie keeps the holder; a holder who falls behind into a tie leaves nobody', () => {
  const s = blank(game(3)), [a, b, c] = s.order, used = new Set<string>();
  const lineA = walk(s, centre(s), 6, used);
  const free = () => inland(s).find(v => !used.has(v) && around(s, v).some(n => !used.has(n)))!;
  const lineB = walk(s, free(), 6, used), lineC = walk(s, free(), 5, used);
  const holder = () => s.awards['longest-road'];
  lay(s, a, lineA.edges.slice(0, 4));
  assert.equal(holder(), null, 'four is not enough');
  lay(s, a, [lineA.edges[4]]);
  assert.equal(holder(), a);
  lay(s, b, lineB.edges.slice(0, 5));
  assert.equal(holder(), a, 'a tie keeps the holder');
  lay(s, a, [lineA.edges[5]]);
  lay(s, c, lineC.edges);
  settle(s, b, lineA.vertices[3]);
  assert.deepEqual([s.seats[a].longestRoute, s.seats[b].longestRoute, s.seats[c].longestRoute], [3, 5, 5]);
  assert.equal(holder(), null, 'the holder fell behind into a tie');
  const e = last(s, 'award');
  assert.ok(e?.kind === 'award' && e.from === a && e.seat === null);
  lay(s, b, [lineB.edges[5]]);
  assert.equal(holder(), b);
  assert.ok(pub(s).seats.find(x => x.id === b)!.parts.some(p => p.key === 'longest-road' && p.points === 2));
  edit(s, n => { n.seats[a].knights = 3; });
  assert.equal(s.awards['largest-army'], a);
  edit(s, n => { n.seats[c].knights = 3; });
  assert.equal(s.awards['largest-army'], a);
  edit(s, n => { n.seats[c].knights = 4; });
  assert.equal(s.awards['largest-army'], c);
});

/** Four cities and `settlements` settlements on distinct corners. */
function points(s: State, seat: string, settlements: number) {
  const spots = inland(s).filter(v => !s.pieces.buildings[v]).slice(0, 4 + settlements);
  spots.forEach((v, i) => settle(s, seat, v, i < 4 ? 'city' : 'settlement'));
}

test('Standard: points gained off-turn win when the seat\'s next opportunity starts', () => {
  const s = blank(game(3)), [a, b] = s.order;
  toMain(s);
  points(s, b, 2);
  assert.equal(s.turn.stage, 'main', 'not on someone else\'s turn');
  act(s, a, { type: 'end' });
  assert.equal(s.turn.stage, 'finale');
  assert.deepEqual(s.results?.winners, [b]);
  assert.equal(s.results?.reason, 'target');
});

test('a hidden victory point card wins on purchase; results reveal it', () => {
  const s = blank(game(3)), a = s.order[0];
  points(s, a, 1);
  toMain(s);
  give(s, a, { wool: 1, grain: 1, ore: 1 });
  edit(s, n => { n.devDeck.push('victory'); });
  assert.equal(view(s, a).vp, 9);
  act(s, a, { type: 'buy-dev' });
  assert.equal(s.turn.stage, 'finale');
  assert.deepEqual(s.results?.winners, [a]);
  const mine = s.results!.standings.find(r => r.seat === a)!;
  assert.equal(mine.vp, 10);
  assert.ok(mine.parts.some(p => p.key === 'vp-cards' && p.hidden));
  assert.equal(pub(s).seats.find(x => x.id === a)!.vp, 9, 'public VP never includes hidden cards');
});
