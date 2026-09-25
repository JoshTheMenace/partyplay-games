/** Flat lookup tables over cell values for the light and mesh hot loops (no per-block objects). */
import { BLOCKS, isOpaque, lightFilter, type Shape } from '../../shared/blocks';

const SHAPES: readonly Shape[] = ['air', 'cube', 'cross', 'crop', 'torch', 'slab', 'stairs', 'ladder', 'door', 'bed', 'cactus', 'lantern', 'farmland', 'liquid',
  'portal', 'fire', 'fence', 'cage', 'wire', 'lever', 'button', 'plate', 'repeater', 'piston', 'piston_head'];
export const S_AIR = 0, S_CUBE = 1, S_CROSS = 2, S_CROP = 3, S_TORCH = 4, S_SLAB = 5, S_STAIRS = 6, S_LADDER = 7;
export const S_DOOR = 8, S_BED = 9, S_CACTUS = 10, S_LANTERN = 11, S_FARMLAND = 12, S_LIQUID = 13;
export const S_PORTAL = 14, S_FIRE = 15, S_FENCE = 16, S_CAGE = 17, S_WIRE = 18, S_LEVER = 19, S_BUTTON = 20, S_PLATE = 21, S_REPEATER = 22, S_PISTON = 23, S_PISTON_HEAD = 24;
/** Render layer + 1 per block id (0 = never drawn). */
export const R_NONE = 0, R_OPAQUE = 1, R_CUTOUT = 2, R_TRANSLUCENT = 3;

/** 1 when the cell value is a full opaque cube (hides faces, casts AO, blocks light). */
export const OPAQUE_CELL = new Uint8Array(65536);
/** Light lost when entering the cell (15 = blocks light). */
export const FILTER_CELL = new Uint8Array(65536);
export const EMIT = new Uint8Array(256);
export const SHAPE = new Uint8Array(256);
export const RENDER = new Uint8Array(256);

for (let id = 0; id < 256; id++) {
  const block = BLOCKS[id];
  if (!block) continue;
  EMIT[id] = block.light;
  SHAPE[id] = SHAPES.indexOf(block.shape);
  RENDER[id] = ['none', 'opaque', 'cutout', 'translucent'].indexOf(block.render);
  for (let state = 0; state < 256; state++) {
    const cell = id | state << 8;
    OPAQUE_CELL[cell] = isOpaque(cell) ? 1 : 0;
    FILTER_CELL[cell] = lightFilter(cell);
  }
}
