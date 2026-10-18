/**
 * Nether fortress loot-room chests (MC-like): mostly gold and iron, nether wart to start a garden, obsidian and flint and
 * steel for a way home; gold or iron armor pieces, diamonds and golden apples are rare finds.
 */
import { B } from '../ids';
import { I } from '../items';
import { e, type LootTable } from './table';

export const NETHER_FORTRESS: LootTable = { rolls: [2, 5], entries: [
  e(I.gold_ingot, 1, 3, 15), e(I.iron_ingot, 1, 5, 12), e(I.nether_wart, 3, 7, 10), e(B.obsidian, 2, 4, 5), e(I.flint_and_steel, 1, 1, 5),
  e(I.golden_chestplate, 1, 1, 3), e(I.golden_helmet, 1, 1, 2), e(I.golden_leggings, 1, 1, 2), e(I.iron_chestplate, 1, 1, 2), e(I.iron_helmet, 1, 1, 2),
  e(I.diamond, 1, 3, 3), e(I.golden_apple, 1, 1, 2),
] };
