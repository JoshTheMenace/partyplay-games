import { axialToPoint, corners, pointKey } from '../../geometry';
import type { Edge, Tile, Vertex } from '../../model';
import { isLand } from './util';

const round = (n: number) => Math.round(n * 1e4) / 1e4 + 0; // + 0 turns -0 into 0

/**
 * Vertices and edges by merging shared corners (ported from legacy `board.ts`). Tile corner i
 * is `v` index i; the edge between corners i and i + 1 is tile edge i. Flags start false.
 */
export function buildGraph(tiles: readonly Tile[]) {
  const vertices: Vertex[] = [], edges: Edge[] = [];
  const vertexAt = new Map<string, Vertex>(), edgeAt = new Map<string, Edge>();
  for (const tile of tiles) {
    const ids = corners(axialToPoint(tile)).map(p => {
      const key = pointKey(p);
      let v = vertexAt.get(key);
      if (!v) {
        v = { id: `v${vertices.length}`, x: round(p.x), y: round(p.y), tiles: [], edges: [], coast: false };
        vertexAt.set(key, v);
        vertices.push(v);
      }
      v.tiles.push(tile.id);
      return v;
    });
    ids.forEach((a, i) => {
      const b = ids[(i + 1) % 6], key = a.id < b.id ? `${a.id} ${b.id}` : `${b.id} ${a.id}`;
      let e = edgeAt.get(key);
      if (!e) {
        e = { id: `e${edges.length}`, a: a.id, b: b.id, tiles: [], land: false, sea: false };
        edgeAt.set(key, e);
        edges.push(e);
        a.edges.push(e.id);
        b.edges.push(e.id);
      }
      e.tiles.push(tile.id);
    });
  }
  return { vertices, edges };
}

/** Land/sea/coast flags from current terrain. Fog counts as neither, so it leaks nothing. */
export function setFlags(tiles: readonly Tile[], vertices: readonly Vertex[], edges: readonly Edge[]) {
  const terrain = new Map(tiles.map(t => [t.id, t.terrain]));
  const land = (id: string) => isLand(terrain.get(id)!), sea = (id: string) => terrain.get(id) === 'sea';
  for (const e of edges) { e.land = e.tiles.some(land); e.sea = e.tiles.some(sea); }
  for (const v of vertices) v.coast = v.tiles.some(land) && v.tiles.some(sea);
}
