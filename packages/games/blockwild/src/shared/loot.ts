/**
 * Loot tables for generated chests. A chest's loot bits (`chestLoot`) name a table; the server rolls
 * it once, the first time the chest is opened or broken, with `rollLoot(table, lootSeed(worldSeed, cellIndex))`.
 * Pure and deterministic (integer hashes only), so the same world always hides the same treasure.
 */
import { B, CHEST_LOOT } from './blocks';
import { CHEST_SIZE } from './constants';
import { I, maxStack, type Slot } from './items';
import { createRng, hash3, rngInt } from './noise';

export type LootName = Exclude<keyof typeof CHEST_LOOT, 'none'>;
/** One weighted entry: `min..max` of `item`. */
export type LootEntry = { item: number; min: number; max: number; weight: number };
/** A table rolls `rolls[0]..rolls[1]` weighted entries. */
export type LootTable = { rolls: readonly [number, number]; entries: readonly LootEntry[] };

const e = (item: number, min: number, max: number, weight: number): LootEntry => ({ item, min, max, weight });

export const LOOT: Record<LootName, LootTable> = {
  village_house: { rolls: [3, 7], entries: [
    e(I.bread, 1, 4, 12), e(I.apple, 1, 5, 10), e(I.wheat_seeds, 2, 6, 10), e(I.wheat, 2, 7, 8), e(I.potato, 1, 5, 6), e(I.carrot, 1, 4, 6),
    e(B.oak_sapling, 1, 2, 5), e(B.torch, 2, 6, 4), e(I.emerald, 1, 1, 2),
  ] },
  village_smith: { rolls: [3, 7], entries: [
    e(I.iron_ingot, 1, 5, 12), e(I.bread, 1, 3, 12), e(I.coal, 2, 6, 8), e(B.obsidian, 3, 7, 5), e(I.emerald, 1, 3, 5),
    e(I.iron_helmet, 1, 1, 3), e(I.iron_chestplate, 1, 1, 3), e(I.iron_leggings, 1, 1, 3), e(I.iron_boots, 1, 1, 3),
    e(I.iron_pickaxe, 1, 1, 4), e(I.iron_sword, 1, 1, 4), e(I.iron_axe, 1, 1, 3),
  ] },
  desert_temple: { rolls: [2, 5], entries: [
    e(I.bone, 4, 6, 20), e(I.rotten_flesh, 3, 7, 16), e(I.gold_ingot, 2, 7, 12), e(I.iron_ingot, 1, 5, 12), e(I.emerald, 1, 3, 12),
    e(I.gunpowder, 1, 8, 8), e(B.tnt, 1, 2, 4), e(I.diamond, 1, 3, 4), e(I.golden_apple, 1, 1, 2),
  ] },
  mineshaft: { rolls: [3, 6], entries: [
    e(I.bread, 1, 3, 14), e(B.torch, 4, 12, 14), e(I.coal, 3, 8, 10), e(I.iron_ingot, 1, 5, 10), e(I.redstone, 4, 9, 6),
    e(I.gold_ingot, 1, 3, 5), e(I.iron_pickaxe, 1, 1, 2), e(I.diamond, 1, 2, 2),
  ] },
  dungeon: { rolls: [3, 6], entries: [
    e(I.bread, 1, 1, 16), e(I.wheat, 1, 4, 16), e(I.redstone, 1, 4, 12), e(I.gunpowder, 1, 8, 10), e(I.string, 1, 8, 10), e(I.bone, 1, 8, 10),
    e(I.iron_ingot, 1, 4, 10), e(I.gold_ingot, 1, 4, 5), e(I.bucket, 1, 1, 8), e(I.golden_apple, 1, 1, 2),
  ] },
};
const NAMES = Object.keys(LOOT) as LootName[];
/** The table named by a chest's loot bits (undefined for 0 or unknown bits). */
export const lootName = (bits: number): LootName | undefined => NAMES.find(name => CHEST_LOOT[name] === bits);

/** The roll seed for the chest at global cell index `index` of a world. */
export const lootSeed = (worldSeed: number, index: number) => hash3(worldSeed, index, 0x10075eed, 7);

/**
 * Roll a table (by name or loot bits) into 27 chest slots: each roll picks a weighted entry and drops its stack into a
 * random empty slot (MC scatters loot through the chest). Unknown tables give an empty chest.
 */
export function rollLoot(table: LootName | number, seed: number): (Slot | null)[] {
  const slots = Array<Slot | null>(CHEST_SIZE).fill(null), name = typeof table === 'number' ? lootName(table) : table;
  if (!name) return slots;
  const def = LOOT[name], rng = createRng(seed), total = def.entries.reduce((sum, entry) => sum + entry.weight, 0);
  for (let roll = rngInt(rng, def.rolls[0], def.rolls[1]); roll > 0; roll--) {
    let pick = rng() * total, entry = def.entries[0]!;
    for (const candidate of def.entries) if ((pick -= candidate.weight) < 0) { entry = candidate; break; }
    const n = Math.min(maxStack(entry.item), rngInt(rng, entry.min, entry.max));
    for (let tries = 0; tries < CHEST_SIZE; tries++) {
      const i = Math.floor(rng() * CHEST_SIZE);
      if (slots[i]) continue;
      slots[i] = { id: entry.item, n };
      break;
    }
  }
  return slots;
}
