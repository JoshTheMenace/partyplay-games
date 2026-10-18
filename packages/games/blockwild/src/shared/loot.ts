/**
 * Loot tables for generated chests. A chest's loot bits (`chestLoot`) name a table; the server rolls
 * it once, the first time the chest is opened or broken, with `rollLoot(table, lootSeed(worldSeed, cellIndex))`.
 * Pure and deterministic (integer hashes only), so the same world always hides the same treasure.
 * The tables live in `loot/<family>.ts`; this is the registry.
 */
import { CHEST_LOOT } from './blocks';
import { CHEST_SIZE } from './constants';
import { maxStack, type Slot } from './items';
import { DUNGEON } from './loot/dungeon';
import { NETHER_FORTRESS } from './loot/fortress';
import { MINESHAFT } from './loot/mineshaft';
import { STRONGHOLD_CORRIDOR, STRONGHOLD_LIBRARY } from './loot/stronghold';
import type { LootTable } from './loot/table';
import { DESERT_TEMPLE } from './loot/temple';
import { VILLAGE_HOUSE, VILLAGE_SMITH } from './loot/village';
import { createRng, hash3, rngInt } from './noise';
export type { LootEntry, LootTable } from './loot/table';

export type LootName = Exclude<keyof typeof CHEST_LOOT, 'none'>;

export const LOOT: Record<LootName, LootTable> = {
  village_house: VILLAGE_HOUSE, village_smith: VILLAGE_SMITH, desert_temple: DESERT_TEMPLE, mineshaft: MINESHAFT, dungeon: DUNGEON,
  nether_fortress: NETHER_FORTRESS, stronghold_corridor: STRONGHOLD_CORRIDOR, stronghold_library: STRONGHOLD_LIBRARY,
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
