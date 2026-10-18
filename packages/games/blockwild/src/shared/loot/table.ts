/** Loot table building blocks shared by the per-family table files and the registry in ../loot.ts. */

/** One weighted entry: `min..max` of `item`. */
export type LootEntry = { item: number; min: number; max: number; weight: number };
/** A table rolls `rolls[0]..rolls[1]` weighted entries. */
export type LootTable = { rolls: readonly [number, number]; entries: readonly LootEntry[] };

export const e = (item: number, min: number, max: number, weight: number): LootEntry => ({ item, min, max, weight });
