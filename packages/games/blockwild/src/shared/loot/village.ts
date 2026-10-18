/** Village chests: houses and the blacksmith. */
import { B } from '../ids';
import { I } from '../items';
import { e, type LootTable } from './table';

export const VILLAGE_HOUSE: LootTable = { rolls: [3, 7], entries: [
  e(I.bread, 1, 4, 12), e(I.apple, 1, 5, 10), e(I.wheat_seeds, 2, 6, 10), e(I.wheat, 2, 7, 8), e(I.potato, 1, 5, 6), e(I.carrot, 1, 4, 6),
  e(B.oak_sapling, 1, 2, 5), e(B.torch, 2, 6, 4), e(I.emerald, 1, 1, 2),
] };
export const VILLAGE_SMITH: LootTable = { rolls: [3, 7], entries: [
  e(I.iron_ingot, 1, 5, 12), e(I.bread, 1, 3, 12), e(I.coal, 2, 6, 8), e(B.obsidian, 3, 7, 5), e(I.emerald, 1, 3, 5),
  e(I.iron_helmet, 1, 1, 3), e(I.iron_chestplate, 1, 1, 3), e(I.iron_leggings, 1, 1, 3), e(I.iron_boots, 1, 1, 3),
  e(I.iron_pickaxe, 1, 1, 4), e(I.iron_sword, 1, 1, 4), e(I.iron_axe, 1, 1, 3),
] };
