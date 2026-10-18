/** Desert temple treasure chamber chests. */
import { B } from '../ids';
import { I } from '../items';
import { e, type LootTable } from './table';

export const DESERT_TEMPLE: LootTable = { rolls: [2, 5], entries: [
  e(I.bone, 4, 6, 20), e(I.rotten_flesh, 3, 7, 16), e(I.gold_ingot, 2, 7, 12), e(I.iron_ingot, 1, 5, 12), e(I.emerald, 1, 3, 12),
  e(I.gunpowder, 1, 8, 8), e(B.tnt, 1, 2, 4), e(I.diamond, 1, 3, 4), e(I.golden_apple, 1, 1, 2),
] };
