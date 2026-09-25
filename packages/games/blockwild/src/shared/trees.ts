/**
 * Tree shapes shared by world generation and sapling growth. A tree only describes the cells it wants;
 * the caller decides what may be overwritten (see `treeCanReplace`) and clips to its own storage.
 */
import { B, blockOf, cellId } from './blocks';
import { HEIGHT } from './constants';
import { rngInt, type Rng } from './noise';

export type TreeKind = 'oak' | 'fancy_oak' | 'birch' | 'tall_birch' | 'spruce' | 'pine' | 'bush';
export type SetCell = (x: number, y: number, z: number, cell: number) => void;
/** Largest horizontal distance any tree reaches from its trunk. */
export const TREE_RADIUS = 7;

const AXIS_X = 1 << 8, AXIS_Z = 2 << 8;
const LEAVES = new Set<number>([B.oak_leaves, B.birch_leaves, B.spruce_leaves]);
const LOGS = new Set<number>([B.oak_log, B.birch_log, B.spruce_log]);

/** Whether a tree cell may overwrite `existing`: air, plants and saplings always; leaves only by logs. */
export function treeCanReplace(existing: number, cell: number): boolean {
  const id = cellId(existing);
  if (id === B.air) return true;
  if (LEAVES.has(id)) return LOGS.has(cellId(cell));
  if (id === B.water) return false;
  const shape = blockOf(existing).shape;
  return shape === 'cross';
}

/** The tree a sapling grows into. */
export function saplingTree(sapling: number, rng: Rng): TreeKind {
  if (sapling === B.birch_sapling) return rng() < 0.2 ? 'tall_birch' : 'birch';
  if (sapling === B.spruce_sapling) return rng() < 0.3 ? 'pine' : 'spruce';
  return rng() < 0.1 ? 'fancy_oak' : 'oak';
}

/** Emits the cells of a `kind` tree whose trunk starts at (x, y, z) (the cell above the ground). */
export function growTree(kind: TreeKind, x: number, y: number, z: number, rng: Rng, setCell: SetCell): void {
  const set: SetCell = (cx, cy, cz, cell) => { if (cy >= 0 && cy < HEIGHT) setCell(cx, cy, cz, cell); };
  switch (kind) {
    case 'oak': return roundTree(x, y, z, rngInt(rng, 4, 6), B.oak_log, B.oak_leaves, rng, set);
    case 'birch': return roundTree(x, y, z, rngInt(rng, 5, 7), B.birch_log, B.birch_leaves, rng, set);
    case 'tall_birch': return roundTree(x, y, z, rngInt(rng, 8, 11), B.birch_log, B.birch_leaves, rng, set);
    case 'spruce': return spruce(x, y, z, rng, set);
    case 'pine': return pine(x, y, z, rng, set);
    case 'bush': return bush(x, y, z, rng, set);
    case 'fancy_oak': return fancyOak(x, y, z, rng, set);
  }
}

function trunk(x: number, y: number, z: number, height: number, log: number, set: SetCell) {
  for (let i = 0; i < height; i++) set(x, y + i, z, log);
}

/** Leaf disc of radius r; corners are trimmed always (`trim`) or at random. */
function disc(x: number, y: number, z: number, r: number, leaf: number, rng: Rng, set: SetCell, trim: boolean) {
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const corner = Math.abs(dx) === r && Math.abs(dz) === r;
    if (corner && r > 0 && (trim || rng() < 0.5)) continue;
    set(x + dx, y, z + dz, leaf);
  }
}

/** Classic oak/birch: four leaf layers (two wide, two narrow) around the top of the trunk. */
function roundTree(x: number, y: number, z: number, height: number, log: number, leaf: number, rng: Rng, set: SetCell) {
  const top = y + height;
  for (let ly = top - 3; ly <= top; ly++) {
    const r = ly >= top - 1 ? 1 : 2;
    disc(x, ly, z, r, leaf, rng, set, ly === top);
  }
  trunk(x, y, z, height, log, set);
}

/** Spruce: layered cone of alternating rings topped with a single leaf. */
function spruce(x: number, y: number, z: number, rng: Rng, set: SetCell) {
  const height = rngInt(rng, 6, 9), bare = rngInt(rng, 1, 2), maxR = rngInt(rng, 2, 3), top = y + height;
  set(x, top + 1, z, B.spruce_leaves);
  let r = 0, limit = 1;
  for (let ly = top; ly >= y + bare; ly--) {
    ring(x, ly, z, r, B.spruce_leaves, set);
    if (r >= limit) {
      r = limit > 1 ? 1 : 0;
      limit = Math.min(limit + 1, maxR);
    } else r++;
  }
  trunk(x, y, z, height, B.spruce_log, set);
}

/** Pine: tall bare trunk with a narrow crown. */
function pine(x: number, y: number, z: number, rng: Rng, set: SetCell) {
  const height = rngInt(rng, 8, 12), crown = rngInt(rng, 3, 5), top = y + height;
  set(x, top + 1, z, B.spruce_leaves);
  for (let ly = top; ly > top - crown; ly--) ring(x, ly, z, ly === top || ly === top - crown + 1 ? 1 : 2, B.spruce_leaves, set);
  trunk(x, y, z, height, B.spruce_log, set);
}

/** Round (diamond-softened) ring used by conifers. */
function ring(x: number, y: number, z: number, r: number, leaf: number, set: SetCell) {
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dz * dz <= r * r + (r > 1 ? 1 : r)) set(x + dx, y, z + dz, leaf);
  }
}

/** Small shrub: one log wrapped in leaves. */
function bush(x: number, y: number, z: number, rng: Rng, set: SetCell) {
  disc(x, y, z, 2, B.oak_leaves, rng, set, true);
  disc(x, y + 1, z, 1, B.oak_leaves, rng, set, rng() < 0.5);
  set(x, y, z, B.oak_log);
}

/** Leaf blob: an ellipsoid a little flatter than it is wide, with a ragged edge. */
function blob(x: number, y: number, z: number, r: number, rng: Rng, set: SetCell) {
  const r2 = r * r;
  for (let dy = -1; dy <= 2; dy++) {
    const layer = dy === 2 || dy === -1 ? r - 1 : r;
    for (let dz = -layer; dz <= layer; dz++) for (let dx = -layer; dx <= layer; dx++) {
      const d = dx * dx + dz * dz + dy * dy * 1.5;
      if (d <= r2 && (d < r2 - r || rng() < 0.7)) set(x + dx, y + dy, z + dz, B.oak_leaves);
    }
  }
}

/** Large oak: tall trunk, several upward branches ending in leaf blobs. */
function fancyOak(x: number, y: number, z: number, rng: Rng, set: SetCell) {
  const height = rngInt(rng, 8, 12), branches = rngInt(rng, 3, 5), logs: [number, number, number, number][] = [];
  blob(x, y + height, z, 3, rng, set);
  for (let b = 0; b < branches; b++) {
    let dx = rng() * 2 - 1, dz = rng() * 2 - 1;
    const len = Math.sqrt(dx * dx + dz * dz) || 1, reach = 2 + rng() * 2.5;
    dx = dx / len * reach;
    dz = dz / len * reach;
    const by = y + Math.floor(height * (0.5 + rng() * 0.35)), rise = rngInt(rng, 1, 3);
    const axis = Math.abs(dx) > Math.abs(dz) ? AXIS_X : AXIS_Z;
    for (let s = 1; s <= 4; s++) {
      const t = s / 4;
      logs.push([x + Math.floor(dx * t + 0.5), by + Math.floor(rise * t + 0.5), z + Math.floor(dz * t + 0.5), axis]);
    }
    const [ex, ey, ez] = logs[logs.length - 1]!;
    blob(ex, ey + 1, ez, rngInt(rng, 2, 3), rng, set);
  }
  for (const [lx, ly, lz, axis] of logs) set(lx, ly, lz, B.oak_log | axis);
  trunk(x, y, z, height, B.oak_log, set);
}
