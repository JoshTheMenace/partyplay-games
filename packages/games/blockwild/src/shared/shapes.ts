import {
  attachedFace, B, blockOf, BUTTON_PRESSED, DOOR_OPEN, fenceConnects, pistonFacing, PISTON_EXTENDED, PLATE_PRESSED, PORTAL_Z, SLAB_DOUBLE, SLAB_TOP, STAIRS_TOP,
} from './blocks';

/** Axis-aligned box in block-local coordinates: [x0, y0, z0, x1, y1, z1], within 0..1 (fence collision rises to 1.5). */
export type Box = readonly [number, number, number, number, number, number];

const px = (n: number) => n / 16;
const FULL: Box = [0, 0, 0, 1, 1, 1];
const EMPTY: readonly Box[] = [];
/** Full-height box hugging the edge on horizontal side `dir` (0 N/-Z, 1 E/+X, 2 S/+Z, 3 W/-X) with thickness t. */
function edge(dir: number, t: number, y0 = 0, y1 = 1): Box {
  switch (dir & 3) {
    case 0: return [0, y0, 0, 1, y1, t];
    case 1: return [1 - t, y0, 0, 1, y1, 1];
    case 2: return [0, y0, 1 - t, 1, y1, 1];
    default: return [0, y0, 0, t, y1, 1];
  }
}
/** Half-footprint box on side `dir`, used for the upper step of stairs. */
const half = (dir: number, y0: number, y1: number) => edge(dir, 0.5, y0, y1);

/** Side (0 N, 1 E, 2 S, 3 W) a door panel hugs: closed doors sit opposite their facing; open doors swing 90° clockwise about the hinge. */
export const doorSide = (state: number) => ((state & 3) + (state & DOOR_OPEN ? 3 : 2)) % 4;
const doorBox = (state: number) => edge(doorSide(state), px(3));
/** Wall torches (state 1..4 point N,E,S,W) hug the wall behind them. */
function torchBox(state: number): Box {
  if (state === 0) return [px(6), 0, px(6), px(10), px(10), px(10)];
  const [x0, z0, x1, z1] = [[px(5.5), px(11), px(10.5), 1], [0, px(5.5), px(5), px(10.5)], [px(5.5), 0, px(10.5), px(5)], [px(11), px(5.5), 1, px(10.5)]][(state - 1) & 3]!;
  return [x0, px(3), z0, x1, px(13), z1];
}
const plantBox = (id: number): Box => {
  if (id === B.dandelion || id === B.poppy || id === B.cornflower) return [px(5), 0, px(5), px(11), px(10), px(11)];
  if (id === B.red_mushroom || id === B.brown_mushroom) return [px(5), 0, px(5), px(11), px(6), px(11)];
  if (id === B.sugar_cane || id === B.cobweb) return id === B.cobweb ? FULL : [px(2), 0, px(2), px(14), 1, px(14)];
  return [px(2), 0, px(2), px(14), px(13), px(14)];
};
/**
 * A w × h box of thickness t hugging the side of the cell that touches its support, for something sitting on face
 * `face` (0..5) of the block at `position − FACES[face]` (levers, buttons). Floor/ceiling boxes span w along X, h along Z.
 */
export function onFace(face: number, w: number, h: number, t: number): Box {
  const axis = face >> 1, [u, v] = axis === 1 ? [0, 2] : [axis === 0 ? 2 : 0, 1], box = [0, 0, 0, 1, 1, 1];
  box[axis] = face & 1 ? 0 : 1 - t;
  box[axis + 3] = face & 1 ? t : 1;
  box[u] = (1 - w) / 2;
  box[u + 3] = (1 + w) / 2;
  box[v] = (1 - h) / 2;
  box[v + 3] = (1 + h) / 2;
  return box as unknown as Box;
}
/** The full cell minus a slab of thickness t on face `face` (an extended piston base leaves room for the head's plate). */
function cutFace(face: number, t: number): Box {
  const box = [0, 0, 0, 1, 1, 1], axis = face >> 1;
  if (face & 1) box[axis + 3] = 1 - t;
  else box[axis] = t;
  return box as unknown as Box;
}
/** A piston head: the 4/16 plate on its facing side and the rod back to the base. */
function headBoxes(face: number): readonly Box[] {
  const plate = onFace(face ^ 1, 1, 1, px(4)), rod = [px(6), px(6), px(6), px(10), px(10), px(10)], axis = face >> 1;
  rod[axis] = face & 1 ? 0 : px(4);
  rod[axis + 3] = face & 1 ? px(12) : 1;
  return [plate, rod as unknown as Box];
}
/** Fence post and one arm per connection (N, E, S, W), `height` tall (1.5 collision, 1 selection). */
function fenceBoxes(state: number, height: number): readonly Box[] {
  const boxes: Box[] = [[px(6), 0, px(6), px(10), height, px(10)]];
  const arms: Box[] = [[px(6), 0, 0, px(10), height, px(6)], [px(10), 0, px(6), 1, height, px(10)], [px(6), 0, px(10), px(10), height, 1], [0, 0, px(6), px(6), height, px(10)]];
  arms.forEach((arm, dir) => { if (fenceConnects(state, dir)) boxes.push(arm); });
  return boxes;
}

function selectionOf(cell: number): readonly Box[] {
  const block = blockOf(cell), state = cell >> 8;
  switch (block.shape) {
    case 'air': case 'liquid': return EMPTY;
    case 'cube': return block.targetable ? [FULL] : EMPTY;
    case 'cross': return [plantBox(block.id)];
    case 'crop': return [[0, 0, 0, 1, px(2 + 2 * Math.min(state, 7)), 1]];
    case 'torch': return [torchBox(state)];
    case 'slab': return [(state & 3) === SLAB_DOUBLE ? FULL : (state & 3) === SLAB_TOP ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1]];
    case 'stairs': return state & STAIRS_TOP ? [[0, 0.5, 0, 1, 1, 1], half(state, 0, 0.5)] : [[0, 0, 0, 1, 0.5, 1], half(state, 0.5, 1)];
    case 'ladder': return [edge((state & 3) + 2, px(3))];
    case 'door': return [doorBox(state)];
    case 'bed': return [[0, 0, 0, 1, px(9), 1]];
    case 'cactus': return [[px(1), 0, px(1), px(15), 1, px(15)]];
    case 'lantern': return [[px(5), 0, px(5), px(11), px(9), px(11)]];
    case 'farmland': return [[0, 0, 0, 1, px(15), 1]];
    case 'portal': return [state & PORTAL_Z ? [px(6), 0, 0, px(10), 1, 1] : [0, 0, px(6), 1, 1, px(10)]];
    case 'fire': return [[0, 0, 0, 1, px(1), 1]];
    case 'fence': return fenceBoxes(state, 1);
    case 'cage': return [FULL];
    case 'wire': return [[0, 0, 0, 1, px(1), 1]];
    case 'lever': return [onFace(attachedFace(state), px(8), px(8), px(10))];
    case 'button': return [onFace(attachedFace(state), px(6), px(4), px(state & BUTTON_PRESSED ? 1 : 2))];
    case 'plate': return [[px(1), 0, px(1), px(15), px(state & PLATE_PRESSED ? 0.5 : 1), px(15)]];
    case 'repeater': return [[0, 0, 0, 1, px(2), 1]];
    case 'piston': return [state & PISTON_EXTENDED ? cutFace(pistonFacing(state), px(4)) : FULL];
    case 'piston_head': return headBoxes(pistonFacing(state));
  }
}
function collisionOf(cell: number): readonly Box[] {
  const block = blockOf(cell);
  if (!block.solid) return EMPTY;
  if (block.id === B.barrier) return [FULL];
  // Cactus is 15/16 tall so standing on it counts as touching it; soul sand sinks you 2/16; fences block jumps.
  if (block.shape === 'cactus') return [[px(1), 0, px(1), px(15), px(15), px(15)]];
  if (block.id === B.soul_sand) return [[0, 0, 0, 1, px(14), 1]];
  if (block.shape === 'fence') return fenceBoxes(cell >> 8, 1.5);
  return selectionOf(cell);
}

const selectionCache = Array.from<readonly Box[] | undefined>({ length: 65536 });
const collisionCache = Array.from<readonly Box[] | undefined>({ length: 65536 });
/** Boxes that block movement (empty for plants, water, torches). Cached per cell value; do not mutate. */
export const collisionBoxes = (cell: number): readonly Box[] => collisionCache[cell & 65535] ??= collisionOf(cell & 65535);
/** Boxes the crosshair can hit and the outline draws (empty for air/water). Cached per cell value; do not mutate. */
export const selectionBoxes = (cell: number): readonly Box[] => selectionCache[cell & 65535] ??= selectionOf(cell & 65535);
/** Height of the highest collision box top (0 when not solid). */
export const collisionTop = (cell: number) => collisionBoxes(cell).reduce((top, box) => Math.max(top, box[4]), 0);
/** Merged outline box (union of selection boxes), or null. */
export function outlineBox(cell: number): Box | null {
  const boxes = selectionBoxes(cell);
  if (!boxes.length) return null;
  const out = [1, 1, 1, 0, 0, 0];
  for (const box of boxes) for (let i = 0; i < 3; i++) { out[i] = Math.min(out[i]!, box[i]!); out[i + 3] = Math.max(out[i + 3]!, box[i + 3]!); }
  return out as unknown as Box;
}
