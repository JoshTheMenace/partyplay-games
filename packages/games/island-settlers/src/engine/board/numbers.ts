import { axialKey, neighbors, pips, type Axial } from '../../geometry';
import { RESOURCES, type Terrain } from '../../model';
import { shuffled } from './util';

/** Base 3–4 token weights, listed by closeness to 7 (the tie-break for leftover tokens). */
const WEIGHTS: readonly [number, number][] = [
  [6, 2], [8, 2], [5, 2], [9, 2], [4, 2], [10, 2], [3, 2], [11, 2], [2, 1], [12, 1],
];

/**
 * `n` tokens in the base proportions (largest remainder). Reproduces the printed sets:
 * 18 → 3–4, 28 → 5–6, 34 → 7–10, and scales them for islands and fog regions.
 */
export function tokenSet(n: number): number[] {
  const quota = WEIGHTS.map(([, w]) => (n * w) / 18);
  const counts = quota.map(Math.floor);
  const order = quota.map((_, i) => i).sort((a, b) => (quota[b] % 1) - (quota[a] % 1) || a - b);
  for (let left = n - counts.reduce((a, b) => a + b, 0), i = 0; left > 0; left--, i++) counts[order[i]]++;
  return WEIGHTS.flatMap(([v], i) => Array<number>(counts[i]).fill(v)).sort((a, b) => a - b);
}

export const isRed = (n: number) => n === 6 || n === 8;

export type NumberCell = Axial & { gold: boolean };

/** Placement order: reds, then 2 and 12 (neither may touch the other), then by pips. */
const rank = (n: number) => (isRed(n) ? 0 : n === 2 || n === 12 ? 1 : 7 - pips(n));

const ringKeys = (a: Axial) => neighbors(a).map(axialKey);

/** §8.2 rules 1–3 for token `n` at `cell`, against the tokens already in `numbers`. */
export function numberFits(
  cell: NumberCell, n: number, numbers: ReadonlyMap<string, number>, ring = ringKeys(cell),
) {
  if (cell.gold && isRed(n)) return false;
  const around = ring.map(k => numbers.get(k) ?? 0);
  return around.every((m, i) => {
    if (m && (m === n || (isRed(m) && isRed(n)) || Math.abs(m - n) === 10)) return false; // 2 by 12
    return pips(n) + pips(m) + pips(around[(i + 1) % 6]) <= 12; // three-hex junction
  });
}

/**
 * Places every token on `cells` (same length) by backtracking in `rank` order. Writes into
 * `numbers`; returns false (leaving `numbers` untouched) when the step budget runs out.
 */
export function placeNumbers(
  cells: readonly NumberCell[], tokens: readonly number[], random: () => number,
  numbers: Map<string, number>, budget = 200,
): boolean {
  const order = shuffled(cells, random).map(cell => ({ cell, key: axialKey(cell), ring: ringKeys(cell) }));
  const sorted = [...tokens].sort((a, b) => rank(a) - rank(b) || a - b);
  let steps = 0;
  // Equal tokens take cells in increasing order, so each set of choices is tried once.
  const go = (i: number, from: number): boolean => {
    if (i === sorted.length) return true;
    if (++steps > budget) return false;
    const n = sorted[i];
    for (let j = i > 0 && sorted[i - 1] === n ? from : 0; j < order.length; j++) {
      const { cell, key, ring } = order[j];
      if (numbers.has(key) || !numberFits(cell, n, numbers, ring)) continue;
      numbers.set(key, n);
      if (go(i + 1, j + 1)) return true;
      numbers.delete(key);
    }
    return false;
  };
  return go(0, 0);
}

/**
 * Soft score (lower is better): variance of total pips per resource, plus a penalty for
 * each red token a resource holds beyond its fair share.
 */
export function balance(faces: Iterable<{ terrain: Terrain; number: number }>) {
  const totals = new Map<Terrain, number>(RESOURCES.map(r => [r, 0]));
  const reds = new Map<Terrain, number>(RESOURCES.map(r => [r, 0]));
  let redCount = 0;
  for (const { terrain, number } of faces) {
    if (!totals.has(terrain)) continue;
    totals.set(terrain, totals.get(terrain)! + pips(number));
    if (isRed(number)) { reds.set(terrain, reds.get(terrain)! + 1); redCount++; }
  }
  const values = [...totals.values()], mean = values.reduce((a, b) => a + b, 0) / 5;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / 5;
  const fair = Math.ceil(redCount / 5);
  return variance + 8 * [...reds.values()].reduce((a, v) => a + Math.max(0, v - fair), 0);
}
