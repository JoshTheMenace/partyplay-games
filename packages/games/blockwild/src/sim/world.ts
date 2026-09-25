/** World access for the simulation: fast readers, edits with bookkeeping, block breaking with support cascades, light and spawn queries. */
import { B, BED_HEAD, blockOf, cellId, cellState, chestLoot, DOOR_UPPER, isOpaque, isSolid, isWater, lightOf } from '../shared/blocks';
import { outsideCell, type CellReader, type VoxelWorld } from '../shared/chunk';
import { HEIGHT } from '../shared/constants';
import { cellIndex, chunkKey, FACES, FACING, localIndex, type Vec3 } from '../shared/coords';
import type { Slot } from '../shared/items';
import { drops as miningDrops } from '../shared/mining';
import { bodyCollides } from '../shared/physics';
import { canSurvive, fenceUpdates, isCrop, isSapling, type CellWrite } from '../shared/placement';
import { collisionTop } from '../shared/shapes';
import { spawnItem } from './entities';
import { onBlockChanged as fireChanged } from './fire';
import { onBlockChanged as portalChanged } from './portals';
import { onBlockChanged as redstoneChanged } from './redstone';
import { addFx, type State } from './state';
import { openLootChest } from './structures';

/** Cell reader with a one-chunk memo. With `loadedOnly`, chunks that are not cached read as barrier instead of generating. */
export function makeReader(world: VoxelWorld, loadedOnly: boolean): CellReader {
  let key = -1, chunk: Uint16Array | null = null;
  return (x, y, z) => {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const outside = outsideCell(x, y, z);
    if (outside !== null) return outside;
    if (world.edits.size) {
      const edited = world.edits.get(cellIndex(x, y, z));
      if (edited !== undefined) return edited;
    }
    const cx = x >> 4, cz = z >> 4, k = chunkKey(cx, cz);
    if (k !== key) {
      if (loadedOnly && !world.cache.has(cx, cz)) return B.barrier;
      chunk = world.cache.get(cx, cz);
      key = k;
    }
    return chunk![localIndex(x & 15, y, z & 15)]!;
  };
}
export const isLoaded = (state: State, x: number, z: number) => state.world.cache.has(Math.floor(x) >> 4, Math.floor(z) >> 4);

const tracksGrowth = (cell: number) => {
  const id = cellId(cell);
  return isCrop(id) && cellState(cell) < 7 || isSapling(id) || id === B.sugar_cane || id === B.farmland;
};
const isFurnace = (id: number) => id === B.furnace || id === B.furnace_lit;

/** Index a cell's light emission and growth ticks (also used when loading saves). */
export function indexCell(state: State, index: number, x: number, z: number, cell: number) {
  const key = chunkKey(x >> 4, z >> 4), light = lightOf(cell);
  let lights = state.lights.get(key);
  if (light) {
    if (!lights) state.lights.set(key, lights = new Map());
    lights.set(index, light);
  } else if (lights?.delete(index) && !lights.size) state.lights.delete(key);
  if (tracksGrowth(cell)) state.growables.add(index);
  else state.growables.delete(index);
}

/** Tell the feature modules a cell changed (every write, and every saved edit while a world loads). */
export function blockChanged(state: State, x: number, y: number, z: number, old: number, value: number) {
  portalChanged(state, x, y, z, old, value);
  fireChanged(state, x, y, z, old, value);
  redstoneChanged(state, x, y, z, old, value);
}

/**
 * Write one cell with all bookkeeping (revision, lights, growth, containers, resting items, neighbouring fence
 * connections) and notify the feature hooks. Every simulation write goes through here. False when the edit limit is hit.
 */
export function writeCell(state: State, x: number, y: number, z: number, value: number): boolean {
  const old = state.get(x, y, z);
  if (old === value) return true;
  if (!state.world.setCell(x, y, z, value)) return false;
  state.revision++;
  const index = cellIndex(x, y, z);
  indexCell(state, index, x, z, value);
  const oldId = cellId(old), newId = cellId(value);
  if (oldId === B.chest && newId !== B.chest) {
    dropStacks(state, x + 0.5, y + 0.5, z + 0.5, state.chests.get(index) ?? []);
    state.chests.delete(index);
  }
  if (isFurnace(oldId) && !isFurnace(newId)) {
    dropStacks(state, x + 0.5, y + 0.5, z + 0.5, state.furnaces.get(index)?.slots ?? []);
    state.furnaces.delete(index);
  }
  for (const item of state.items) if (Math.abs(item.x - x - 0.5) < 1.6 && Math.abs(item.y - y - 0.5) < 1.6 && Math.abs(item.z - z - 0.5) < 1.6) item.resting = false;
  if (oldId !== newId) for (const [fx, fy, fz, fence] of fenceUpdates({ getCell: state.get }, x, y, z)) writeCell(state, fx, fy, fz, fence);
  blockChanged(state, x, y, z, old, value);
  return true;
}
/** Write several cells all-or-nothing (false when the edit limit would be exceeded). */
export function writeCells(state: State, writes: readonly CellWrite[]): boolean {
  if (!state.world.canEdit(writes)) return false;
  for (const [x, y, z, value] of writes) writeCell(state, x, y, z, value);
  return true;
}

export function dropStacks(state: State, x: number, y: number, z: number, stacks: readonly (Slot | null)[]) {
  for (const stack of stacks) if (stack && stack.n > 0) spawnItem(state, x, y, z, stack, { scatter: true });
}

/** What a removed cell becomes: water when it touches water above or beside (no flow simulation), else air. */
function fillFor(state: State, x: number, y: number, z: number): number {
  if (isWater(state.get(x, y + 1, z))) return B.water;
  return FACING.some(([dx, dz]) => isWater(state.get(x + dx, y, z + dz))) ? B.water : B.air;
}

/**
 * Remove a block: writes the fill, removes the other half of doors/beds, spawns `drops` (default: hand drops),
 * emits the break effect and settles neighbours that lost support. Returns false if the edit limit blocked it.
 */
export function breakBlock(state: State, x: number, y: number, z: number, drops?: readonly Slot[], fx = true): boolean {
  if (cellId(state.get(x, y, z)) === B.chest && chestLoot(cellState(state.get(x, y, z)))) openLootChest(state, x, y, z);
  const cell = state.get(x, y, z), id = cellId(cell), stateBits = cellState(cell);
  const writes: CellWrite[] = [[x, y, z, fillFor(state, x, y, z)]];
  if (blockOf(cell).shape === 'door') {
    const dy = stateBits & DOOR_UPPER ? -1 : 1;
    if (cellId(state.get(x, y + dy, z)) === id) writes.push([x, y + dy, z, B.air]);
  } else if (id === B.bed) {
    const [dx, dz] = FACING[stateBits & 3]!, sign = stateBits & BED_HEAD ? -1 : 1;
    if (cellId(state.get(x + dx * sign, y, z + dz * sign)) === B.bed) writes.push([x + dx * sign, y, z + dz * sign, B.air]);
  }
  if (!writeCells(state, writes)) return false;
  dropStacks(state, x + 0.5, y + 0.3, z + 0.5, drops ?? miningDrops(cell, 0, state.rand));
  if (fx) addFx(state, 'break', x + 0.5, y + 0.5, z + 0.5, cell);
  settle(state, writes.map(([wx, wy, wz]) => [wx, wy, wz]));
  return true;
}

/** Break (with hand drops) every neighbour of the changed cells that can no longer survive, cascading up columns. */
export function settle(state: State, changed: Vec3[]) {
  const queue = [...changed];
  const world = { getCell: state.get };
  for (let budget = 256; queue.length && budget > 0; budget--) {
    const [x, y, z] = queue.shift()!;
    for (const [dx, dy, dz] of FACES) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (ny < 0 || ny >= HEIGHT) continue;
      const cell = state.get(nx, ny, nz), block = blockOf(cell);
      if (block.shape === 'cube' || block.shape === 'air' || block.shape === 'liquid' || canSurvive(world, nx, ny, nz, cell)) continue;
      if (breakBlock(state, nx, ny, nz, undefined, true)) queue.push([nx, ny, nz]);
    }
  }
}

/** Block light at a cell from indexed light sources (Manhattan falloff, walls ignored: slightly generous). */
export function blockLight(state: State, x: number, y: number, z: number): number {
  let best = 0;
  const cx = x >> 4, cz = z >> 4;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const lights = state.lights.get(chunkKey(cx + i, cz + j));
    if (lights) for (const [index, level] of lights) {
      const lx = index % 4096, rest = (index - lx) / 4096, lz = rest % 4096, ly = (rest - lz) / 4096;
      best = Math.max(best, level - Math.abs(lx - x) - Math.abs(ly - y) - Math.abs(lz - z));
    }
  }
  return best;
}
/** True when no opaque block is above (x, y, z). */
export function skyExposed(get: CellReader, x: number, y: number, z: number): boolean {
  for (let yy = Math.max(0, Math.floor(y)); yy < HEIGHT; yy++) if (isOpaque(get(x, yy, z))) return false;
  return true;
}
/** Highest cell at or below `top` that has collision or water in a column (-1 if none). */
export function surfaceY(get: CellReader, x: number, z: number, top = HEIGHT - 1): number {
  for (let y = Math.min(top, HEIGHT - 1); y >= 0; y--) {
    const cell = get(x, y, z);
    if (isSolid(cell) || isWater(cell)) return y;
  }
  return -1;
}
/** Feet position standing on top of the column (x, z), looking down from `top`. */
export function standY(get: CellReader, x: number, z: number, top?: number): number {
  const y = surfaceY(get, x, z, top);
  return y + Math.max(collisionTop(get(x, y, z)), isWater(get(x, y, z)) ? 1 : 0);
}

const SPREAD: readonly [number, number][] = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0]];
/** A free standing spot near `around` (within 3 blocks), for spawning players spread out. Each column is
 *  searched downward from the feet height of `around`, so a spawn under a tree lands on the ground, not the canopy. */
export function standNear(state: State, around: Vec3, index = 0): Vec3 {
  for (let k = 0; k < SPREAD.length; k++) {
    const [dx, dz] = SPREAD[(index + k) % SPREAD.length]!, x = Math.floor(around[0]) + dx, z = Math.floor(around[2]) + dz;
    const y = standY(state.get, x, z, Math.floor(around[1])), spot = { x: x + 0.5, y, z: z + 0.5, sneaking: false };
    if (y > 0 && !isWater(state.get(x, Math.floor(y), z)) && !bodyCollides(state.get, spot)) return [spot.x, y, spot.z];
  }
  return [around[0], around[1], around[2]];
}
