/**
 * Hand-built boards for fixtures. Not the engine generator: just enough to give the UI real
 * tiles, vertices, edges, ports and features laid out with geometry.ts (ids `q:r`, `v<n>`, `e<n>`).
 */
import type { Board, BoardFeature, Edge, Port, Resource, Terrain, Tile, Vertex } from '../../src/model';
import {
  angle, axialKey, axialToPoint, bounds, corners, midpoint, neighbors, pointKey, spiral, type Axial,
} from '../../src/geometry';

export type Cell = Axial & { terrain: Terrain; number: number; island: number };
export type Size = 'small' | 'medium' | 'large';
type PortGood = Resource | 'any';

/** Seeded PRNG (mulberry32) so every fixture is identical across runs. */
export function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

const many = <T>(spec: [T, number][]): T[] => spec.flatMap(([value, n]) => Array<T>(n).fill(value));

/** Row shape 3-4-5-6-5-4-3 for 5–6 seats (ENGINE §8.1). */
const rows56 = (): Axial[] => [-3, -2, -1, 0, 1, 2, 3].flatMap(r =>
  Array.from({ length: 6 - Math.abs(r) }, (_, i) => ({ q: Math.max(-3, -3 - r) + i, r })));

/** ENGINE §8.1 base layouts: cells, terrain, tokens and port goods per table size. */
const LAYOUTS = {
  small: {
    cells: () => spiral({ q: 0, r: 0 }, 2),
    terrain: many<Terrain>([['wood', 4], ['wool', 4], ['grain', 4], ['brick', 3], ['ore', 3], ['desert', 1]]),
    tokens: many([[2, 1], [3, 2], [4, 2], [5, 2], [6, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 1]]),
    ports: [...many<Resource | 'any'>([['any', 4]]), 'wood', 'brick', 'wool', 'grain', 'ore'],
  },
  medium: {
    cells: rows56,
    terrain: many<Terrain>([['wood', 6], ['wool', 6], ['grain', 6], ['brick', 5], ['ore', 5], ['desert', 2]]),
    tokens: many([[2, 2], [3, 3], [4, 3], [5, 3], [6, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 2]]),
    ports: [...many<Resource | 'any'>([['any', 5], ['wool', 2]]), 'wood', 'brick', 'grain', 'ore'],
  },
  large: {
    cells: () => spiral({ q: 0, r: 0 }, 3),
    terrain: many<Terrain>([['wood', 8], ['wool', 7], ['grain', 7], ['brick', 6], ['ore', 6], ['desert', 3]]),
    tokens: many([[2, 2], [3, 3], [4, 4], [5, 4], [6, 4], [8, 4], [9, 4], [10, 4], [11, 3], [12, 2]]),
    ports: [...many<Resource | 'any'>([['any', 6], ['wood', 2], ['wool', 2]]), 'brick', 'grain', 'ore'],
  },
} satisfies Record<Size, { cells: () => Axial[]; terrain: Terrain[]; tokens: number[]; ports: PortGood[] }>;

export const sizeFor = (seats: number): Size => (seats <= 4 ? 'small' : seats <= 6 ? 'medium' : 'large');

/** Home-island land cells for a base layout, shuffled with a fixed seed. */
export function baseCells(size: Size, seed = 7): Cell[] {
  const random = seeded(seed), layout = LAYOUTS[size];
  const terrain = shuffle([...layout.terrain], random), tokens = shuffle([...layout.tokens], random);
  return layout.cells().map((cell, i) => ({
    ...cell, terrain: terrain[i], island: 0,
    number: terrain[i] === 'desert' ? 0 : tokens.pop()!,
  }));
}

export const portGoods = (size: Size) => [...LAYOUTS[size].ports];

/** Adds the sea frame, merges shared corners into vertices and edges, and spaces ports on the coast. */
export function makeBoard(land: Cell[], ports: (Resource | 'any')[], features: BoardFeature[] = []): Board {
  const seen = new Set(land.map(axialKey));
  const frame = new Map(land.flatMap(neighbors).filter(c => !seen.has(axialKey(c))).map(c => [axialKey(c), c]));
  const sea = [...frame.values()];
  const cells = [...land, ...sea.map(cell => ({ ...cell, terrain: 'sea' as const, number: 0, island: -1 }))];
  const tiles: Tile[] = cells.map(({ q, r, terrain, number, island }) =>
    ({ id: axialKey({ q, r }), q, r, ...axialToPoint({ q, r }), terrain, number, island }));
  const vertices = new Map<string, Vertex>(), edges = new Map<string, Edge>();
  for (const tile of tiles) {
    const ring = corners(tile).map(p => {
      const key = pointKey(p);
      const vertex = vertices.get(key)
        ?? { id: `v${vertices.size}`, x: round(p.x), y: round(p.y), tiles: [], edges: [], coast: false };
      vertices.set(key, vertex);
      vertex.tiles.push(tile.id);
      vertex.coast ||= tile.terrain === 'sea';
      return vertex;
    });
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % 6], key = [a.id, b.id].sort().join('|');
      let edge = edges.get(key);
      if (!edge) {
        edge = { id: `e${edges.size}`, a: a.id, b: b.id, tiles: [], land: false, sea: false };
        edges.set(key, edge);
        a.edges.push(edge.id);
        b.edges.push(edge.id);
      }
      edge.tiles.push(tile.id);
      if (tile.terrain === 'sea') edge.sea = true;
      else edge.land = true;
    });
  }
  const byId = new Map(tiles.map(tile => [tile.id, tile]));
  const vertexList = [...vertices.values()];
  for (const vertex of vertexList) vertex.coast &&= vertex.tiles.some(id => byId.get(id)!.terrain !== 'sea');
  const edgeList = [...edges.values()];
  return {
    tiles, vertices: vertexList, edges: edgeList, features,
    ports: placePorts(edgeList, byId, vertices, ports),
    bounds: bounds(tiles),
  };
}

function placePorts(edges: Edge[], tiles: Map<string, Tile>, vertices: Map<string, Vertex>, goods: PortGood[]) {
  const at = new Map([...vertices.values()].map(v => [v.id, v]));
  const home = (edge: Edge) => edge.tiles.map(id => tiles.get(id)!);
  const coast = edges
    .filter(edge => edge.land && edge.sea && home(edge).some(tile => tile.island === 0))
    .map(edge => ({ edge, turn: angle({ x: 0, y: 0 }, midpoint(at.get(edge.a)!, at.get(edge.b)!)) }))
    .sort((a, b) => a.turn - b.turn);
  const ports: Port[] = [], used = new Set<string>();
  const step = coast.length / goods.length;
  goods.forEach((good, i) => {
    for (let k = Math.floor(i * step); k < coast.length; k++) {
      const { edge } = coast[k];
      if (used.has(edge.a) || used.has(edge.b)) continue;
      used.add(edge.a).add(edge.b);
      const water = home(edge).find(tile => tile.terrain === 'sea')!;
      const ratio = good === 'any' ? 3 : 2;
      ports.push({ id: `port${i}`, edge: edge.id, vertices: [edge.a, edge.b], good, ratio, tile: water.id });
      return;
    }
  });
  return ports;
}

/** 4 decimals, and never -0 (JSON would turn it into 0 and break round-trips). */
const round = (n: number) => Math.round(n * 1e4) / 1e4 || 0;
