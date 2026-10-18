/** Stronghold chests: store rooms and corridors (pearls, iron, food, a rare diamond or golden apple) and libraries (paper, books, a rare pearl). */
import { I } from '../items';
import { e, type LootTable } from './table';

export const STRONGHOLD_CORRIDOR: LootTable = { rolls: [2, 4], entries: [
  e(I.ender_pearl, 1, 1, 10), e(I.iron_ingot, 1, 5, 10), e(I.bread, 1, 3, 15), e(I.apple, 1, 3, 15), e(I.redstone, 4, 9, 5),
  e(I.gold_ingot, 1, 3, 5), e(I.iron_sword, 1, 1, 2), e(I.iron_pickaxe, 1, 1, 2), e(I.iron_helmet, 1, 1, 1), e(I.iron_boots, 1, 1, 1),
  e(I.diamond, 1, 3, 3), e(I.golden_apple, 1, 1, 1),
] };
export const STRONGHOLD_LIBRARY: LootTable = { rolls: [2, 6], entries: [
  e(I.book, 1, 3, 20), e(I.paper, 2, 7, 20), e(I.ender_pearl, 1, 1, 3),
] };
