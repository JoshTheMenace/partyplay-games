import { axialKey, neighbors, type Axial } from '../../geometry';
import type { Terrain } from '../../model';
import { distinct, without } from './util';

/** Size of the same-terrain group `cell` would join (cell included). */
export function clusterSize(cell: Axial, terrain: Terrain, placed: ReadonlyMap<string, Terrain>): number {
  const seen = new Set([axialKey(cell)]);
  const stack = [cell];
  while (stack.length) {
    for (const n of neighbors(stack.pop()!)) {
      const key = axialKey(n);
      if (seen.has(key) || placed.get(key) !== terrain) continue;
      seen.add(key);
      stack.push(n);
    }
  }
  return seen.size;
}

/** §8.2 rules 4–5: no same-terrain group over `maxCluster` (sea exempt), no touching deserts. */
export function terrainFits(
  cell: Axial, t: Terrain, placed: ReadonlyMap<string, Terrain>, maxCluster: number,
) {
  if (t === 'sea') return true;
  if (t === 'desert' && neighbors(cell).some(n => placed.get(axialKey(n)) === 'desert')) return false;
  return clusterSize(cell, t, placed) <= maxCluster;
}

/**
 * Assigns `mix` to `cells` (one each) by randomised backtracking. Writes into `placed` and
 * returns true, or leaves `placed` untouched and returns false when the step budget runs out.
 */
export function placeTerrain(
  cells: readonly Axial[], mix: readonly Terrain[], maxCluster: number,
  random: () => number, placed: Map<string, Terrain>, budget = 2000,
): boolean {
  let steps = 0;
  const go = (i: number, left: readonly Terrain[]): boolean => {
    if (i === cells.length) return true;
    if (++steps > budget) return false;
    const key = axialKey(cells[i]);
    for (const t of distinct(left, random)) {
      if (!terrainFits(cells[i], t, placed, maxCluster)) continue;
      placed.set(key, t);
      if (go(i + 1, without(left, t))) return true;
      placed.delete(key);
    }
    return false;
  };
  return go(0, mix);
}
