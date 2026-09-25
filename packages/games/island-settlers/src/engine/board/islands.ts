import {
  axialKey, axialToPoint, hexDistance, neighbors, spiral, type Axial, type Point,
} from '../../geometry';
import { shuffled } from './util';

/**
 * Grows a compact random blob of `size` cells from `seed`: frontier cells touching more of the
 * blob are likelier. Returns null when `blocked` walls it in first.
 */
export function growIsland(
  seed: Axial, size: number, random: () => number, blocked: (a: Axial) => boolean,
): Axial[] | null {
  if (blocked(seed)) return null;
  const cells = new Map([[axialKey(seed), seed]]);
  while (cells.size < size) {
    const frontier = new Map<string, { cell: Axial; weight: number }>();
    for (const c of cells.values()) for (const n of neighbors(c)) {
      const key = axialKey(n);
      if (cells.has(key) || frontier.has(key) || blocked(n)) continue;
      frontier.set(key, { cell: n, weight: neighbors(n).filter(m => cells.has(axialKey(m))).length ** 2 });
    }
    const options = [...frontier.values()];
    if (!options.length) return null;
    let roll = random() * options.reduce((sum, o) => sum + o.weight, 0);
    const next = options.find(o => (roll -= o.weight) < 0) ?? options[options.length - 1];
    cells.set(axialKey(next.cell), next.cell);
  }
  return [...cells.values()];
}

export type IslandSpec = {
  /** Cells the islands keep away from (the home island, or the centre cell). */
  around: readonly Axial[];
  sizes: readonly number[];
  /** Hex distance from `around`: at least `near`, at most `far`. */
  near: number;
  far: number;
  /** Islands may touch each other (fog blobs); otherwise one sea hex stays between them. */
  touch: boolean;
};

/**
 * Seeds evenly around `around` (random rotation) and grows one island per size.
 * An attempt that cannot fit every island is retried; null after 30 attempts.
 */
export function placeIslands(spec: IslandSpec, random: () => number): Axial[][] | null {
  const reach = new Map([...distances(spec.around, spec.far)].filter(([, d]) => d >= spec.near));
  const centre = centroid(spec.around);
  const seeds = shuffled([...reach].filter(([, d]) => d <= spec.near + 1).map(([k]) => fromKey(k)), random)
    .map(cell => ({ cell, angle: angleAround(centre, cell) }));
  for (let attempt = 0; attempt < 30; attempt++) {
    const taken = new Set<string>(), islands: Axial[][] = [];
    const offset = random() * 2 * Math.PI, count = spec.sizes.length;
    const blocked = (a: Axial) => !reach.has(axialKey(a)) || taken.has(axialKey(a))
      || (!spec.touch && neighbors(a).some(n => taken.has(axialKey(n))));
    for (const [i, size] of spec.sizes.entries()) {
      const target = offset + (2 * Math.PI * i) / count;
      const gap = (a: number) => Math.abs(Math.atan2(Math.sin(a - target), Math.cos(a - target)));
      const seed = seeds.filter(s => !blocked(s.cell)).sort((a, b) => gap(a.angle) - gap(b.angle))[0];
      const cells = seed && growIsland(seed.cell, size, random, blocked);
      if (!cells) break;
      for (const c of cells) taken.add(axialKey(c));
      islands.push(cells);
    }
    if (islands.length === count) return islands;
  }
  return null;
}

export function fromKey(key: string): Axial {
  const [q, r] = key.split(':').map(Number);
  return { q, r };
}

export function centroid(cells: readonly Axial[]): Point {
  const sum = cells.map(axialToPoint).reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / cells.length, y: sum.y / cells.length };
}

export const angleAround = (centre: Point, a: Axial) => {
  const p = axialToPoint(a);
  return Math.atan2(p.y - centre.y, p.x - centre.x);
};

/** Axial key → hex distance to the nearest of `cells`, for every cell up to `far` away. */
export function distances(cells: readonly Axial[], far: number): Map<string, number> {
  const result = new Map<string, number>();
  for (const c of spiral({ q: 0, r: 0 }, far + 6)) {
    const d = Math.min(...cells.map(a => hexDistance(a, c)));
    if (d <= far) result.set(axialKey(c), d);
  }
  return result;
}
