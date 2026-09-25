/** Growth near players: crops, saplings (shared tree generator), sugar cane, farmland moisture, and bone meal. */
import { B, cellId, cellState, isAir, isWater, makeCell } from '../shared/blocks';
import { CHUNK, HEIGHT, SEA_LEVEL } from '../shared/constants';
import { cellIndex, cellXYZ, inWorld, localIndex } from '../shared/coords';
import { isCrop, isSapling, type CellWrite } from '../shared/placement';
import { growTree, saplingTree, treeCanReplace } from '../shared/trees';
import { addFx, type State } from './state';
import { blockLight, isLoaded, skyExposed, writeCell, writeCells } from './world';

const LOGS = new Set<number>([B.oak_log, B.birch_log, B.spruce_log]);
const FLOWERS = [B.dandelion, B.poppy, B.cornflower] as const;
/** Mean seconds per growth step. */
const CROP_WET = 35, CROP_DRY = 80, SAPLING = 40, CANE = 45;
const GROWTH_RANGE = 96;

/** Grow a sapling at (x, y, z) into a tree; false if a trunk cell is blocked or the edit limit is reached. */
export function growTreeAt(state: State, x: number, y: number, z: number, sapling: number): boolean {
  const writes: CellWrite[] = [];
  let blocked = false;
  growTree(saplingTree(sapling, state.rand), x, y, z, state.rand, (cx, cy, cz, cell) => {
    if (!inWorld(cx, cy, cz)) return;
    if (treeCanReplace(state.get(cx, cy, cz), cell)) writes.push([cx, cy, cz, cell]);
    else if (LOGS.has(cellId(cell))) blocked = true;
  });
  return !blocked && writes.length > 0 && writeCells(state, writes);
}

/** Crops and saplings need daylight from the open sky or a nearby light (block light ≥ 9). */
function lit(state: State, x: number, y: number, z: number) {
  const day = state.time < 12500 || state.time >= 23500;
  return day && skyExposed(state.get, x, y + 1, z) || blockLight(state, x, y, z) >= 9;
}
function moist(state: State, x: number, y: number, z: number) {
  for (let dy = 0; dy <= 1; dy++) for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) if (isWater(state.get(x + dx, y + dy, z + dz))) return true;
  return false;
}
const nearPlayer = (state: State, x: number, z: number) => state.players.some(p => p.connected && Math.abs(p.x - x) < GROWTH_RANGE && Math.abs(p.z - z) < GROWTH_RANGE);

/** Register a freshly generated chunk's sugar cane (worldgen plants it on shore ground at sea level) for growth. */
export function trackCane(growables: Set<number>, cx: number, cz: number, cells: Uint16Array): Uint16Array {
  const y = SEA_LEVEL + 1;
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    if (cells[localIndex(lx, y, lz)] === B.sugar_cane) growables.add(cellIndex(cx * CHUNK + lx, y, cz * CHUNK + lz));
  }
  return cells;
}

/** Once per second: roll growth for every tracked growable in loaded chunks near a connected player. */
export function tickGrowth(state: State) {
  if (state.ticks % 20 !== 7 || !state.growables.size) return;
  const r = state.rand;
  // Snapshot: growth writes add and remove entries while we iterate.
  for (const index of Array.from(state.growables)) {
    const [x, y, z] = cellXYZ(index);
    if (!isLoaded(state, x, z) || !nearPlayer(state, x, z)) continue;
    const cell = state.get(x, y, z), id = cellId(cell), stage = cellState(cell);
    if (!isCrop(id) && !isSapling(id) && id !== B.sugar_cane && id !== B.farmland) state.growables.delete(index);
    else if (isCrop(id)) {
      const wet = (cellState(state.get(x, y - 1, z)) & 1) === 1;
      if (r() < 1 / (wet ? CROP_WET : CROP_DRY) && lit(state, x, y, z)) writeCell(state, x, y, z, makeCell(id, Math.min(7, stage + 1)));
    } else if (isSapling(id)) {
      if (r() >= 1 / SAPLING || !lit(state, x, y, z)) continue;
      if (stage === 0) writeCell(state, x, y, z, makeCell(id, 1));
      else growTreeAt(state, x, y, z, id);
    } else if (id === B.sugar_cane) {
      if (cellId(state.get(x, y - 1, z)) === B.sugar_cane || r() >= 1 / CANE) continue;
      let top = y;
      while (top < y + 2 && cellId(state.get(x, top + 1, z)) === B.sugar_cane) top++;
      if (top < y + 2 && top + 1 < HEIGHT && isAir(state.get(x, top + 1, z))) writeCell(state, x, top + 1, z, B.sugar_cane);
    } else if (id === B.farmland && r() < 0.2) {
      const wet = moist(state, x, y, z) ? 1 : 0;
      if (wet !== (stage & 1)) writeCell(state, x, y, z, makeCell(B.farmland, wet));
    }
  }
}

/** Bone meal: advance crops 2–5 stages, give saplings a 45% growth roll, scatter grass and flowers on grass. */
export function applyBoneMeal(state: State, x: number, y: number, z: number): boolean {
  const cell = state.get(x, y, z), id = cellId(cell), stage = cellState(cell), r = state.rand;
  let changed = false;
  if (isCrop(id) && stage < 7) changed = writeCell(state, x, y, z, makeCell(id, Math.min(7, stage + 2 + Math.floor(r() * 4))));
  else if (isSapling(id)) changed = r() < 0.45 ? growTreeAt(state, x, y, z, id) || true : writeCell(state, x, y, z, makeCell(id, 1));
  else if (id === B.grass_block) {
    for (let i = 0; i < 24; i++) {
      const gx = x + Math.floor(r() * 7) - 3, gz = z + Math.floor(r() * 7) - 3;
      if (cellId(state.get(gx, y, gz)) !== B.grass_block || !isAir(state.get(gx, y + 1, gz))) continue;
      const plant = r() < 0.8 ? B.short_grass : FLOWERS[Math.floor(r() * FLOWERS.length)]!;
      changed = writeCell(state, gx, y + 1, gz, plant) || changed;
    }
  }
  if (changed) addFx(state, 'place', x + 0.5, y + 0.5, z + 0.5, state.get(x, y, z));
  return changed;
}
