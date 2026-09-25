/** CPU-side board lookups and graph walks over the public board (cached per immutable Board). */
import type { Point } from '../geometry';
import type { Board, Edge, Pieces, Port, SeatId, Terrain, Tile, Vertex, VertexId } from '../model';

export type Index = {
  tile: Map<string, Tile>;
  vertex: Map<string, Vertex>;
  edge: Map<string, Edge>;
  /** Neighbouring vertex and the edge leading there. */
  links: Map<VertexId, { to: VertexId; edge: string }[]>;
  tileVertices: Map<string, VertexId[]>;
  tileEdges: Map<string, Edge[]>;
  port: Map<VertexId, Port>;
};

const cache = new WeakMap<Board, Index>();

export function indexOf(board: Board): Index {
  let ix = cache.get(board);
  if (ix) return ix;
  const edge = new Map(board.edges.map(e => [e.id, e])), tileVertices = new Map<string, VertexId[]>();
  const tileEdges = new Map<string, Edge[]>();
  for (const v of board.vertices) {
    for (const t of v.tiles) tileVertices.set(t, [...(tileVertices.get(t) ?? []), v.id]);
  }
  for (const e of board.edges) for (const t of e.tiles) tileEdges.set(t, [...(tileEdges.get(t) ?? []), e]);
  const links = new Map(board.vertices.map(v => [v.id, v.edges.flatMap(id => {
    const e = edge.get(id);
    return e ? [{ to: e.a === v.id ? e.b : e.a, edge: id }] : [];
  })]));
  ix = {
    tile: new Map(board.tiles.map(t => [t.id, t])), vertex: new Map(board.vertices.map(v => [v.id, v])),
    edge, links, tileVertices, tileEdges,
    port: new Map(board.ports.flatMap(p => p.vertices.map(v => [v, p] as const))),
  };
  cache.set(board, ix);
  return ix;
}

/** Terrain and number as the public currently knows them (fog faces come from reveals). */
export function face(pieces: Pieces, t: Tile): { terrain: Terrain; number: number } {
  const r = pieces.reveals[t.id];
  return r ? { terrain: r.terrain, number: r.number } : { terrain: t.terrain, number: t.number };
}

const WATER: ReadonlySet<Terrain> = new Set(['sea', 'fog', 'lake']);
export const isLandVertex = (ix: Index, pieces: Pieces, v: Vertex) =>
  v.tiles.some(id => { const t = ix.tile.get(id); return !!t && !WATER.has(face(pieces, t).terrain); });

/** Free vertex that keeps the distance rule (no building on it or next to it). */
export const openSpot = (ix: Index, pieces: Pieces, v: VertexId) =>
  !pieces.buildings[v] && (ix.links.get(v) ?? []).every(l => !pieces.buildings[l.to]);

/** Vertices my network touches: my buildings plus route ends not held by an opponent. */
export function network(ix: Index, pieces: Pieces, seat: SeatId): VertexId[] {
  const out = new Set<VertexId>();
  for (const b of Object.values(pieces.buildings)) if (b.seat === seat) out.add(b.vertex);
  for (const r of Object.values(pieces.routes)) {
    if (r.seat !== seat) continue;
    const e = ix.edge.get(r.edge);
    for (const v of e ? [e.a, e.b] : []) {
      if (!pieces.buildings[v] || pieces.buildings[v].seat === seat) out.add(v);
    }
  }
  return [...out];
}

export type Mode = 'road' | 'ship';
export type ByMode = Record<Mode, Map<VertexId, number>>;

/**
 * Edge steps from `from` over free edges, never passing through an opponent building, per route
 * kind. With `sea`, ship edges count too, but a path switches between roads and ships only at one
 * of our buildings (Seafarers), or at a start corner with no route of ours.
 */
export function modeDistances(
  ix: Index, pieces: Pieces, seat: SeatId, from: VertexId[], sea: boolean, max = 5,
): ByMode {
  const best: ByMode = { road: new Map(), ship: new Map() }, queue: [VertexId, Mode][] = [];
  const all: Mode[] = sea ? ['road', 'ship'] : ['road'];
  const mine = (v: VertexId) => pieces.buildings[v]?.seat === seat;
  const kinds = (v: VertexId) => (ix.links.get(v) ?? []).flatMap(l => {
    const r = pieces.routes[l.edge];
    return r?.seat === seat ? [r.kind] : [];
  });
  const push = (v: VertexId, m: Mode, d: number) => {
    if (!best[m].has(v)) { best[m].set(v, d); queue.push([v, m]); }
  };
  for (const v of from) {
    const own = kinds(v);
    for (const m of all) if (mine(v) || !own.length || own.includes(m)) push(v, m, 0);
  }
  for (let i = 0; i < queue.length; i++) {
    const [v, m] = queue[i], d = best[m].get(v)!, owner = pieces.buildings[v]?.seat;
    if (d >= max || (owner && owner !== seat && d > 0)) continue;
    for (const l of ix.links.get(v) ?? []) {
      const e = ix.edge.get(l.edge)!;
      if (pieces.routes[l.edge]) continue;
      for (const n of all) if ((n === m || mine(v)) && (n === 'road' ? e.land : e.sea)) push(l.to, n, d + 1);
    }
  }
  return best;
}

/** Fewest edge steps from `from` to each vertex by either route kind (see modeDistances). */
export function distances(ix: Index, pieces: Pieces, seat: SeatId, from: VertexId[], sea: boolean, max = 5) {
  const { road, ship } = modeDistances(ix, pieces, seat, from, sea, max), out = new Map(road);
  for (const [v, d] of ship) if (!out.has(v) || out.get(v)! > d) out.set(v, d);
  return out;
}

/** World position of a tile, vertex, edge or unit id (for "move toward" choices). */
export function positionOf(ix: Index, pieces: Pieces, id: string): Point | null {
  const t = ix.tile.get(id) ?? ix.vertex.get(id);
  if (t) return t;
  const e = ix.edge.get(id);
  if (e) {
    const a = ix.vertex.get(e.a), b = ix.vertex.get(e.b);
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  }
  const u = pieces.units[id];
  return u && u.at !== id ? positionOf(ix, pieces, u.at) : null;
}
