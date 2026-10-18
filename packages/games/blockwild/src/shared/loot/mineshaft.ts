/** Mineshaft niche chests. */
import { B } from '../ids';
import { I } from '../items';
import { e, type LootTable } from './table';

export const MINESHAFT: LootTable = { rolls: [3, 6], entries: [
  e(I.bread, 1, 3, 14), e(B.torch, 4, 12, 14), e(I.coal, 3, 8, 10), e(I.iron_ingot, 1, 5, 10), e(I.redstone, 4, 9, 6),
  e(I.gold_ingot, 1, 3, 5), e(I.iron_pickaxe, 1, 1, 2), e(I.diamond, 1, 2, 2),
] };
