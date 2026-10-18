/** Dungeon (monster room) chests. */
import { I } from '../items';
import { e, type LootTable } from './table';

export const DUNGEON: LootTable = { rolls: [3, 6], entries: [
  e(I.bread, 1, 1, 16), e(I.wheat, 1, 4, 16), e(I.redstone, 1, 4, 12), e(I.gunpowder, 1, 8, 10), e(I.string, 1, 8, 10), e(I.bone, 1, 8, 10),
  e(I.iron_ingot, 1, 4, 10), e(I.gold_ingot, 1, 4, 5), e(I.bucket, 1, 1, 8), e(I.golden_apple, 1, 1, 2),
] };
