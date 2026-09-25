import type { Terrain } from '../../model';
import { shuffle as shuffled } from '../rng';

export { pick, shuffle as shuffled } from '../rng';

/** Distinct values in a random order (so equal tokens or terrains are tried once). */
export const distinct = <T>(items: readonly T[], random: () => number): T[] =>
  shuffled([...new Set(items)], random);

/** Remove one occurrence of `value` from a multiset. */
export function without<T>(items: readonly T[], value: T): T[] {
  const i = items.indexOf(value);
  return [...items.slice(0, i), ...items.slice(i + 1)];
}

export const isLand = (t: Terrain) => t !== 'sea' && t !== 'fog';
export const NUMBERED: ReadonlySet<Terrain> = new Set(['wood', 'brick', 'wool', 'grain', 'ore', 'gold']);
