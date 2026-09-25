import { axialKey, neighbors, type Axial } from '../../geometry';
import type { Resource, Terrain } from '../../model';
import type { CellPlan, GenContext, PlanCell, Tier } from './types';

/**
 * Rows of hexes whose centres all line up on one vertical axis (like the printed frame).
 * Widths must change by ±1 per row; `top` is the first row's r.
 */
export function rows(widths: readonly number[], top: number): Axial[] {
  const twice = (((widths[0] + top - 1) % 2) + 2) % 2 === 0 ? 0 : -1; // twice the axis q
  return widths.flatMap((w, i) => {
    const r = top + i, start = Math.floor((twice - w + 1 - r) / 2);
    return Array.from({ length: w }, (_, k) => ({ q: start + k, r }));
  });
}

type Shape = [widths: number[], top: number];
/** 3–4: hexagon radius 2 (19). 5–6: 3-4-5-6-5-4-3 (30). 7–10: hexagon radius 3 (37). */
export const BASE_SHAPES: Record<Tier, Shape> = {
  0: [[3, 4, 5, 4, 3], -2], 1: [[3, 4, 5, 6, 5, 4, 3], -3], 2: [[4, 5, 6, 7, 6, 5, 4], -3],
};
/** Seafarers home islands: 16 / 24 / 30 hexes. */
export const HOME_SHAPES: Record<Tier, Shape> = {
  0: [[3, 4, 5, 4], -2], 1: [[4, 5, 6, 5, 4], -2], 2: BASE_SHAPES[1],
};

export const mix = (counts: Partial<Record<Terrain, number>>): Terrain[] =>
  Object.entries(counts).flatMap(([t, n]) => Array<Terrain>(n).fill(t as Terrain));

export const BASE_MIX: Record<Tier, Terrain[]> = {
  0: mix({ wood: 4, wool: 4, grain: 4, brick: 3, ore: 3, desert: 1 }),
  1: mix({ wood: 6, wool: 6, grain: 6, brick: 5, ore: 5, desert: 2 }),
  2: mix({ wood: 8, wool: 7, grain: 7, brick: 6, ore: 6, desert: 3 }),
};
export const HOME_MIX: Record<Tier, Terrain[]> = {
  0: mix({ wood: 3, wool: 3, grain: 3, brick: 3, ore: 3, desert: 1 }),
  1: mix({ wood: 5, wool: 5, grain: 5, brick: 4, ore: 4, desert: 1 }),
  2: BASE_MIX[1],
};

/** Port goods per size (ENGINE §8.1): 3:1 ports are 'any'. */
export const PORT_GOODS: Record<Tier, (Resource | 'any')[]> = {
  0: ['any', 'any', 'any', 'any', 'wood', 'brick', 'wool', 'grain', 'ore'],
  1: ['any', 'any', 'any', 'any', 'any', 'wool', 'wool', 'wood', 'brick', 'grain', 'ore'],
  2: ['any', 'any', 'any', 'any', 'any', 'any', 'wood', 'wood', 'wool', 'wool', 'brick', 'grain', 'ore'],
};

const RESOURCE_ORDER: Resource[] = ['wood', 'wool', 'grain', 'brick', 'ore'];

/** `count` resource terrains spread as evenly as possible, starting from a random resource. */
export function resourceMix(count: number, random: () => number): Terrain[] {
  const start = Math.floor(random() * 5);
  return Array.from({ length: count }, (_, i) => RESOURCE_ORDER[(start + i) % 5]);
}

/** Split `total` into `parts` near-equal sizes, larger first. */
export const split = (total: number, parts: number) =>
  Array.from({ length: parts }, (_, i) => Math.floor(total / parts) + (i < total % parts ? 1 : 0));

export const island = (cells: readonly Axial[], index: number): PlanCell[] =>
  cells.map(c => ({ q: c.q, r: c.r, island: index }));

export function basePlan(ctx: GenContext): CellPlan {
  const cells = island(rows(...BASE_SHAPES[ctx.tier]), 0);
  return { regions: [{ cells, mix: BASE_MIX[ctx.tier] }], sea: [], frame: 1, ports: 'home' };
}

/**
 * Every cell within `rings` of `cells`, then pockets (empty cells touching ≥ 3 tiles) filled,
 * so the ocean has no holes. Returns only the added cells.
 */
export function oceanAround(cells: readonly Axial[], rings: number): Axial[] {
  const all = new Map(cells.map(c => [axialKey(c), c]));
  const added: Axial[] = [];
  const add = (c: Axial) => { all.set(axialKey(c), c); added.push(c); };
  for (let ring = 0; ring < rings; ring++) {
    for (const c of Array.from(all.values())) for (const n of neighbors(c)) if (!all.has(axialKey(n))) add(n);
  }
  const pending = Array.from(all.values());
  while (pending.length) for (const n of neighbors(pending.pop()!)) {
    if (all.has(axialKey(n)) || neighbors(n).filter(m => all.has(axialKey(m))).length < 3) continue;
    add(n);
    pending.push(n);
  }
  return added;
}
