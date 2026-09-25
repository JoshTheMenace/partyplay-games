import assert from 'node:assert/strict';
import { axialKey, corners, axialToPoint, distance, neighbors, pips } from '../../src/geometry';
import { DEFAULT_SETTINGS, type Board, type Settings, type Terrain } from '../../src/model';
import { boardIndex, makeBoard, type BoardInput } from '../../src/engine/board';

/** Seeds per map and size tier (acceptance: 500). BOARD_SEEDS=50 for a quick run. */
export const SEEDS = Number(process.env.BOARD_SEEDS ?? 500);
export const TIER_SEATS = [[3, 4], [5, 6], [7, 8, 9, 10]] as const;
export const MAPS: Partial<Settings>[] = [
  { map: 'base' },
  { map: 'seafarers', seafarers: 'new-shores' },
  { map: 'seafarers', seafarers: 'four-islands' },
  { map: 'seafarers', seafarers: 'fog-islands' },
  { map: 'explorers' },
];
export const label = (s: Partial<Settings>) => (s.map === 'seafarers' ? s.seafarers! : s.map!);

/** mulberry32: a tiny seeded generator, independent of the engine's streams. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generate(seats: number, settings: Partial<Settings>, seed: number, extra?: Partial<BoardInput>) {
  const input = { seatCount: seats, settings: { ...DEFAULT_SETTINGS, ...settings }, random: seeded(seed) };
  return makeBoard({ ...input, ...extra });
}

export const count = <T>(items: readonly T[]) =>
  items.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>());

const RESOURCE_TERRAIN = new Set<Terrain>(['wood', 'brick', 'wool', 'grain', 'ore']);

/** Faces as the engine will know them: public tiles with hidden faces filled in. */
type Hidden = Record<string, { terrain: Terrain; number: number }>;

export function faces(board: Board, hidden: Hidden) {
  return new Map(board.tiles.map(t => [axialKey(t), { ...t, ...hidden[t.id] }]));
}

/** ENGINE §8.2 hard constraints 1–5 over every face (hidden included). */
export function assertFair(board: Board, hidden: Hidden, maxCluster: number) {
  const all = faces(board, hidden);
  const at = (a: { q: number; r: number }) => all.get(axialKey(a));
  for (const t of all.values()) {
    const around = neighbors(t).map(at);
    if (t.terrain === 'gold') assert.ok(t.number !== 6 && t.number !== 8, `gold ${t.id} holds ${t.number}`);
    around.forEach((n, i) => {
      if (!n) return;
      if (t.number && n.number) {
        assert.notEqual(t.number, n.number, `equal neighbours ${t.id} ${n.id}`);
        const red = (x: number) => x === 6 || x === 8;
        assert.ok(!(red(t.number) && red(n.number)), `red neighbours ${t.id} ${n.id}`);
        assert.ok(Math.abs(t.number - n.number) !== 10, `2 by 12 at ${t.id} ${n.id}`);
      }
      const third = around[(i + 1) % 6];
      const junction = pips(t.number) + pips(n.number) + pips(third?.number ?? 0);
      assert.ok(junction <= 12, `junction ${t.id} ${n.id} worth ${junction}`);
      if (t.terrain === 'desert') assert.notEqual(n.terrain, 'desert', `touching deserts ${t.id}`);
    });
    if (t.terrain === 'sea' || t.terrain === 'fog') continue;
    const seen = new Set([t.id]), stack = [t];
    while (stack.length) for (const n of neighbors(stack.pop()!).map(at)) {
      if (n && n.terrain === t.terrain && !seen.has(n.id)) { seen.add(n.id); stack.push(n); }
    }
    assert.ok(seen.size <= maxCluster, `${t.terrain} cluster of ${seen.size} at ${t.id}`);
  }
  for (const t of all.values()) {
    const numbered = RESOURCE_TERRAIN.has(t.terrain) || t.terrain === 'gold';
    assert.equal(t.number > 0, numbered, `${t.id} ${t.terrain} number ${t.number}`);
  }
}

/** Graph shape and agreement with geometry.ts; index consistency. */
export function assertGraph(board: Board) {
  const index = boardIndex(board);
  const spots = new Set(board.vertices.map(v => `${v.x.toFixed(3)}:${v.y.toFixed(3)}`));
  assert.equal(spots.size, board.vertices.length);
  assert.equal(new Set(board.edges.map(e => [e.a, e.b].sort().join(' '))).size, board.edges.length);
  assert.equal(new Set(board.tiles.map(t => t.id)).size, board.tiles.length);
  for (const e of board.edges) assert.ok(e.tiles.length >= 1 && e.tiles.length <= 2, `edge ${e.id} tiles`);
  for (const v of board.vertices) assert.ok(v.tiles.length <= 3 && v.edges.length <= 3, `vertex ${v.id}`);
  for (const t of board.tiles) {
    const p = axialToPoint(t);
    assert.ok(distance(p, t) < 1e-9, `tile ${t.id} position`);
    const vs = index.tileVertices.get(t.id)!;
    corners(p).forEach((c, i) => assert.ok(distance(c, index.vertex.get(vs[i])!) < 1e-3, `${t.id}/${i}`));
    index.tileEdges.get(t.id)!.forEach((id, i) => {
      const e = index.edge.get(id)!;
      assert.deepEqual([e.a, e.b].sort(), [vs[i], vs[(i + 1) % 6]].sort(), `edge ${i} of ${t.id}`);
    });
  }
  for (const [v, ns] of index.vertexNeighbors) {
    for (const n of ns) assert.ok(index.vertexNeighbors.get(n)!.includes(v));
  }
  for (const cycle of index.coasts.values()) {
    cycle.forEach((id, i) => {
      const a = index.edge.get(id)!, b = index.edge.get(cycle[(i + 1) % cycle.length])!;
      assert.ok([a.a, a.b].some(v => v === b.a || v === b.b), `coast ${id} is not joined to the next edge`);
    });
  }
  assert.ok(Object.isFrozen(board) && Object.isFrozen(board.tiles[0]), 'board is frozen');
}

/** ENGINE §8.3: ≥ 3 coast edges between ports; no shared or neighbouring vertices. */
export function assertPorts(board: Board) {
  const index = boardIndex(board);
  const vertices = board.ports.flatMap(p => p.vertices);
  assert.equal(new Set(vertices).size, vertices.length, 'ports share a vertex');
  for (const p of board.ports) {
    const others = new Set(board.ports.filter(o => o !== p).flatMap(o => o.vertices));
    for (const v of p.vertices) {
      assert.ok(!index.vertexNeighbors.get(v)!.some(n => others.has(n)), `port ${p.id} neighbours another`);
    }
    const e = index.edge.get(p.edge)!;
    assert.ok(e.land && e.sea && index.tile.get(p.tile)!.terrain === 'sea' && e.tiles.includes(p.tile));
    assert.equal(p.ratio, p.good === 'any' ? 3 : 2);
  }
  for (const cycle of index.coasts.values()) {
    const at = cycle.map((e, i) => (board.ports.some(p => p.edge === e) ? i : -1)).filter(i => i >= 0);
    at.forEach((i, k) => {
      const gap = ((at[(k + 1) % at.length] - i + cycle.length) % cycle.length) || cycle.length;
      assert.ok(gap >= 3, `port gap ${gap}`);
    });
    const goods = at.map(i => board.ports.find(p => p.edge === cycle[i])!.good);
    goods.forEach((g, k) => {
      const next = goods[(k + 1) % goods.length];
      if (goods.length > 1 && g !== 'any') assert.notEqual(g, next, 'equal 2:1 ports in a row');
    });
  }
}
