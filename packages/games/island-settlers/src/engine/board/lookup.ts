import { axialKey, neighbors } from '../../geometry';
import type { Board, Edge, EdgeId, Port, Tile, TileId, Vertex, VertexId } from '../../model';

/** O(1) lookups over an immutable board. Build with `boardIndex` (cached per board object). */
export type BoardIndex = {
  tile: Map<TileId, Tile>;
  vertex: Map<VertexId, Vertex>;
  edge: Map<EdgeId, Edge>;
  /** Axial key (`q:r`) → tile. */
  cell: Map<string, Tile>;
  /** Existing neighbours in DIRECTIONS order. */
  tileNeighbors: Map<TileId, Tile[]>;
  /** Corners 0..5 (geometry `corner` order). */
  tileVertices: Map<TileId, VertexId[]>;
  /** Edge i joins corners i and i + 1. */
  tileEdges: Map<TileId, EdgeId[]>;
  vertexNeighbors: Map<VertexId, VertexId[]>;
  /** `${a} ${b}` (either order) → edge. */
  edgeBetween: Map<string, EdgeId>;
  portAt: Map<VertexId, Port>;
  /** Island number → its outer coast as a clockwise cycle of land/sea edges. */
  coasts: Map<number, EdgeId[]>;
};

type Parts = Pick<Board, 'tiles' | 'vertices' | 'edges' | 'ports'>;

/** Which corner (0..5, geometry `corner` order) of `tile` the vertex sits on. */
const cornerOf = (tile: Tile, v: Vertex) =>
  (Math.round((Math.atan2(v.y - tile.y, v.x - tile.x) * 3) / Math.PI - 0.5) + 12) % 6;

export function indexBoard({ tiles, vertices, edges, ports }: Parts): BoardIndex {
  const tile = new Map(tiles.map(t => [t.id, t])), vertex = new Map(vertices.map(v => [v.id, v]));
  const cell = new Map(tiles.map(t => [axialKey(t), t]));
  const tileVertices = new Map(tiles.map(t => [t.id, Array<VertexId>(6)]));
  const tileEdges = new Map(tiles.map(t => [t.id, Array<EdgeId>(6)]));
  const corner = new Map<string, number>();
  for (const v of vertices) for (const id of v.tiles) {
    const i = cornerOf(tile.get(id)!, v);
    tileVertices.get(id)![i] = v.id;
    corner.set(`${id} ${v.id}`, i);
  }
  const edgeBetween = new Map<string, EdgeId>();
  for (const e of edges) {
    edgeBetween.set(`${e.a} ${e.b}`, e.id);
    edgeBetween.set(`${e.b} ${e.a}`, e.id);
    for (const id of e.tiles) {
      const a = corner.get(`${id} ${e.a}`)!, b = corner.get(`${id} ${e.b}`)!;
      tileEdges.get(id)![(a + 1) % 6 === b ? a : b] = e.id;
    }
  }
  const edge = new Map(edges.map(e => [e.id, e]));
  return {
    tile, vertex, edge, cell, tileVertices, tileEdges, edgeBetween,
    tileNeighbors: new Map(tiles.map(t => [t.id, neighbors(t).flatMap(a => cell.get(axialKey(a)) ?? [])])),
    vertexNeighbors: new Map(vertices.map(v => [v.id, v.edges.map(id => {
      const e = edge.get(id)!;
      return e.a === v.id ? e.b : e.a;
    })])),
    portAt: new Map(ports.flatMap(p => p.vertices.map(v => [v, p] as const))),
    coasts: coasts(tile, vertex, edges),
  };
}

/** An island's clockwise coast (island 0 is the home island); empty when it has none. */
export const coastCycle = (index: BoardIndex, island = 0): EdgeId[] => index.coasts.get(island) ?? [];

const cache = new WeakMap<Board, BoardIndex>();

export function boardIndex(board: Board): BoardIndex {
  let index = cache.get(board);
  if (!index) cache.set(board, (index = indexBoard(board)));
  return index;
}

/** Island number → the longest closed walk of its land/sea edges, clockwise, from the north. */
function coasts(tile: Map<TileId, Tile>, vertex: Map<VertexId, Vertex>, edges: readonly Edge[]) {
  const byIsland = new Map<number, Edge[]>();
  for (const e of edges) {
    const [a, b] = e.tiles.map(id => tile.get(id)!);
    const land = !b ? undefined : a.terrain === 'sea' ? b : b.terrain === 'sea' ? a : undefined;
    if (land && land.island >= 0 && land.terrain !== 'sea') {
      byIsland.set(land.island, [...(byIsland.get(land.island) ?? []), e]);
    }
  }
  const result = new Map<number, EdgeId[]>();
  for (const [island, coast] of byIsland) {
    const cycle = outerCycle(coast, vertex);
    if (cycle.length) result.set(island, cycle);
  }
  return result;
}

function outerCycle(coast: readonly Edge[], vertex: Map<VertexId, Vertex>): EdgeId[] {
  const at = new Map<VertexId, Edge[]>();
  for (const e of coast) for (const v of [e.a, e.b]) at.set(v, [...(at.get(v) ?? []), e]);
  const used = new Set<EdgeId>();
  let best: Edge[] = [];
  for (const start of coast) {
    if (used.has(start.id)) continue;
    const cycle: Edge[] = [];
    let edge: Edge | undefined = start, v = start.b;
    while (edge) {
      used.add(edge.id);
      cycle.push(edge);
      edge = at.get(v)!.find(e => !used.has(e.id));
      if (edge) v = edge.a === v ? edge.b : edge.a;
    }
    if (v === start.a && cycle.length > best.length) best = cycle;
  }
  const mids = best.map(e => {
    const a = vertex.get(e.a)!, b = vertex.get(e.b)!;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  });
  const next = (i: number) => mids[(i + 1) % mids.length];
  const area = mids.reduce((sum, p, i) => sum + p.x * next(i).y - next(i).x * p.y, 0);
  if (area < 0) { best.reverse(); mids.reverse(); } // y grows south: a positive area is clockwise
  let north = 0;
  mids.forEach((p, i) => {
    const top = mids[north];
    if (p.y < top.y - 1e-6 || (Math.abs(p.y - top.y) < 1e-6 && p.x < top.x)) north = i;
  });
  return [...best.slice(north), ...best.slice(0, north)].map(e => e.id);
}
