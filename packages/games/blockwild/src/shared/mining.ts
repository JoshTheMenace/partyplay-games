/**
 * Mining rules shared by the server (validation, drops) and the client (crack animation, predicted timing).
 * The server accepts a break after `breakTime * 0.6 - 0.15` seconds of mining the same block (see src/sim/commands.ts).
 */
import { B, blockOf } from './blocks';
import { I, itemOf, type Slot } from './items';

/** Cobwebs give string only to swords and shears (and both cut through them fast). */
const cutsWeb = (cell: number, held: number) => (cell & 255) === B.cobweb && (itemOf(held)?.tool?.kind === 'sword' || held === I.shears);

/** True if `held` (item id, 0 = hand) gets drops from the cell (tier/tool requirement). */
export function canHarvest(cell: number, held: number): boolean {
  const block = blockOf(cell);
  if (block.id === B.cobweb) return cutsWeb(cell, held);
  if (block.tier === 0) return true;
  const tool = itemOf(held)?.tool;
  return !!tool && tool.kind === block.tool && tool.tier >= block.tier;
}

/** Mining speed multiplier of `held` against the cell (1 for hand / wrong tool). */
export function toolSpeed(cell: number, held: number): number {
  const block = blockOf(cell), tool = itemOf(held)?.tool;
  if (cutsWeb(cell, held)) return 15;
  if (!tool) return 1;
  if (tool.kind === 'shears') return block.tool === 'shears' ? (block.sound === 'wool' ? 5 : 15) : 1;
  if (tool.kind === 'sword') return block.tool === 'shears' ? 1.5 : 1;
  return tool.kind === block.tool ? tool.speed : 1;
}

/**
 * Seconds to break the cell (MC formula): hardness * (harvestable ? 1.5 : 5) / speed, ×5 when airborne, ×5 underwater.
 * 0 = instant, Infinity = unbreakable.
 */
export function breakTime(cell: number, held: number, onGround: boolean, inWater: boolean): number {
  const hardness = blockOf(cell).hardness;
  if (hardness < 0) return Infinity;
  if (hardness === 0) return 0;
  let seconds = hardness * (canHarvest(cell, held) ? 1.5 : 5) / toolSpeed(cell, held);
  if (!onGround) seconds *= 5;
  if (inWater) seconds *= 5;
  return seconds;
}

/** Crack stage 0..9 for a mining progress 0..1. */
export const crackStage = (progress: number) => Math.max(0, Math.min(9, Math.floor(progress * 10)));

const SHEARABLE = new Set<number>([B.oak_leaves, B.birch_leaves, B.spruce_leaves, B.short_grass, B.fern, B.dead_bush]);
/** Items dropped when a player breaks the cell with `held`. `rand` returns 0..1 (the server's seeded RNG). */
export function drops(cell: number, held: number, rand: () => number): Slot[] {
  const block = blockOf(cell);
  if (held === I.shears && SHEARABLE.has(block.id)) return [{ id: block.id, n: 1 }];
  if (!canHarvest(cell, held)) return [];
  const out: Slot[] = [];
  for (const d of block.drops(cell >> 8)) {
    if (d.chance < 1 && rand() >= d.chance) continue;
    const n = d.min + Math.floor(rand() * (d.max - d.min + 1));
    if (n > 0) out.push({ id: d.item, n });
  }
  return out;
}
