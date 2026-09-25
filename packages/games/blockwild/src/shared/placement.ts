/**
 * Block placement, support and right-click rules shared by the server (authoritative) and the client (prediction).
 * Entity overlap (players/mobs) is checked by the caller against collisionBoxes of the returned cells.
 */
import {
  attachedFace, B, BED_HEAD, blockOf, cellId, cellState, DOOR_UPPER, isFullCube, isLava, isLiquid, isReplaceable, isSolid, isWater, makeCell,
  PISTON_EXTENDED, pistonFacing, SLAB_BOTTOM, SLAB_DOUBLE, SLAB_TOP, STAIRS_TOP,
} from './blocks';
import type { World } from './chunk';
import { HEIGHT, inNether } from './constants';
import { FACES, FACING, FACING_FACE, faceToFacing, facingFromYaw, inWorld, type Vec3 } from './coords';
import { I, itemOf, placesBlock } from './items';

/** The clicked block and face (0..5 = -X,+X,-Y,+Y,-Z,+Z); hy = vertical hit fraction 0..1 on that face. */
export type PlaceHit = { x: number; y: number; z: number; face: number; hy?: number };
/** A cell write [x, y, z, cellValue]. */
export type CellWrite = [number, number, number, number];

/** Seconds of holding "use" to eat food. */
export const EAT_SECONDS = 1.6;
/** Minimum bow draw before a release shoots; full power at 1 s. */
export const BOW_MIN_SECONDS = 0.15;
/** Bow power 0..1 after drawing for `seconds` (MC curve). */
export const bowPower = (seconds: number) => { const f = Math.min(1, Math.max(0, seconds)); return Math.min(1, (f * f + 2 * f) / 3); };

const SOIL = new Set<number>([B.grass_block, B.dirt, B.snowy_grass, B.farmland]);
const CROPS = new Set<number>([B.wheat, B.carrots, B.potatoes]);
const SAPLINGS = new Set<number>([B.oak_sapling, B.birch_sapling, B.spruce_sapling]);
const TILLABLE = new Set<number>([B.grass_block, B.dirt, B.snowy_grass]);
const INTERACTIVE = new Set<number>([B.crafting_table, B.furnace, B.furnace_lit, B.chest, B.bed, B.oak_door, B.lever, B.stone_button, B.oak_button, B.repeater]);
const HOES = new Set<number>([I.wooden_hoe, I.stone_hoe, I.iron_hoe, I.diamond_hoe]);
const SHOVELS = new Set<number>([I.wooden_shovel, I.stone_shovel, I.iron_shovel, I.diamond_shovel]);
const PATHABLE = new Set<number>([B.grass_block, B.dirt]);
const BUCKETS = new Set<number>([I.bucket, I.water_bucket, I.lava_bucket]);
/** Blocks no item may place (buckets, fire from flint and steel, portals from frames, heads from pistons). */
const UNPLACEABLE = new Set<number>([B.water, B.lava, B.farmland, B.fire, B.nether_portal, B.piston_head]);
const AXIS_BY_FACE = [1, 1, 0, 0, 2, 2] as const;

export const isCrop = (id: number) => CROPS.has(id);
export const isSapling = (id: number) => SAPLINGS.has(id);
export const isHoe = (id: number) => HOES.has(id);
export const isTillable = (id: number) => TILLABLE.has(id);
export const isShovel = (id: number) => SHOVELS.has(id);
/** Blocks a shovel turns into dirt_path (with air above). */
export const isPathable = (id: number) => PATHABLE.has(id);
/** Blocks that bone meal can advance. */
export const isGrowable = (cell: number) => (CROPS.has(cellId(cell)) && cellState(cell) < 7) || SAPLINGS.has(cellId(cell)) || cellId(cell) === B.grass_block;

/** A top surface that can hold torches, doors, lanterns and beds: full cubes, top/double slabs, upside-down stairs, pistons not extended upwards. */
export function sturdyTop(cell: number): boolean {
  const block = blockOf(cell), state = cellState(cell);
  if (block.shape === 'slab') return (state & 3) !== SLAB_BOTTOM;
  if (block.shape === 'piston') return !(state & PISTON_EXTENDED) || pistonFacing(state) !== 3;
  if (block.shape === 'stairs') return (state & STAIRS_TOP) !== 0;
  return isFullCube(cell);
}
const nearWater = (world: World, x: number, y: number, z: number) => FACING.some(([dx, dz]) => isWater(world.getCell(x + dx, y, z + dz)));

/**
 * Whether the block `cell` at (x, y, z) still has the support it needs (torches, ladders, plants, doors, beds...).
 * The server breaks blocks that fail this after a neighbour changes; placement uses the same rules.
 */
export function canSurvive(world: World, x: number, y: number, z: number, cell = world.getCell(x, y, z)): boolean {
  const id = cellId(cell), state = cellState(cell), block = blockOf(cell);
  const below = world.getCell(x, y - 1, z), belowId = cellId(below);
  if (CROPS.has(id)) return belowId === B.farmland;
  switch (block.shape) {
    case 'torch': {
      if (state === 0) return sturdyTop(below);
      // A wall torch points away from the block it hangs on.
      const [dx, dz] = FACING[(state - 1) & 3]!;
      return isFullCube(world.getCell(x - dx, y, z - dz));
    }
    case 'ladder': {
      const [dx, dz] = FACING[state & 3]!;
      return isFullCube(world.getCell(x - dx, y, z - dz));
    }
    case 'door': {
      if (state & DOOR_UPPER) {
        const lower = world.getCell(x, y - 1, z);
        return cellId(lower) === id && !(cellState(lower) & DOOR_UPPER);
      }
      const upper = world.getCell(x, y + 1, z);
      return sturdyTop(below) && cellId(upper) === id && (cellState(upper) & DOOR_UPPER) !== 0;
    }
    case 'bed': {
      const [dx, dz] = FACING[state & 3]!, head = (state & BED_HEAD) !== 0, sign = head ? -1 : 1;
      const other = world.getCell(x + dx * sign, y, z + dz * sign);
      return cellId(other) === B.bed && ((cellState(other) & BED_HEAD) !== 0) !== head;
    }
    case 'cactus': return belowId === B.sand || belowId === B.cactus;
    case 'lantern': case 'plate': case 'wire': case 'repeater': return sturdyTop(below);
    case 'lever': case 'button': {
      const [dx, dy, dz] = FACES[attachedFace(state)]!;
      return isFullCube(world.getCell(x - dx, y - dy, z - dz));
    }
    case 'fire': return isSolid(below);
    case 'cross':
      if (id === B.cobweb) return true;
      if (id === B.red_mushroom || id === B.brown_mushroom) return isFullCube(below);
      if (id === B.sugar_cane) return belowId === B.sugar_cane || (SOIL.has(belowId) || belowId === B.sand) && nearWater(world, x, y - 1, z);
      if (id === B.dead_bush) return belowId === B.sand || belowId === B.dirt || belowId === B.terracotta || belowId === B.grass_block;
      return SOIL.has(belowId) || belowId === B.sand && id === B.short_grass;
  }
  return true;
}

/** Where a placement lands: the clicked cell if replaceable (tall grass), else its neighbour across `face`. */
export function placeTarget(world: World, hit: PlaceHit): [number, number, number, number] {
  if (isReplaceable(world.getCell(hit.x, hit.y, hit.z))) return [hit.x, hit.y, hit.z, 3];
  const [dx, dy, dz] = FACES[hit.face]!;
  return [hit.x + dx, hit.y + dy, hit.z + dz, hit.face];
}
const free = (world: World, x: number, y: number, z: number) => inWorld(x, y, z) && isReplaceable(world.getCell(x, y, z));

/** Fence connection bits (N, E, S, W) for a fence at (x, y, z): it joins fences and full cubes beside it. */
export function fenceState(world: World, x: number, y: number, z: number): number {
  let state = 0;
  FACING.forEach(([dx, dz], dir) => {
    const cell = world.getCell(x + dx, y, z + dz);
    if (cellId(cell) === B.oak_fence || isFullCube(cell) && cellId(cell) !== B.barrier) state |= 1 << dir;
  });
  return state;
}
/** Writes that re-connect the fences beside (x, y, z) after that cell changed (empty when none change). */
export function fenceUpdates(world: World, x: number, y: number, z: number): CellWrite[] {
  const writes: CellWrite[] = [];
  for (const [dx, dz] of FACING) {
    const nx = x + dx, nz = z + dz, cell = world.getCell(nx, y, nz);
    if (cellId(cell) !== B.oak_fence) continue;
    const state = fenceState(world, nx, y, nz);
    if (state !== cellState(cell)) writes.push([nx, y, nz, makeCell(B.oak_fence, state)]);
  }
  return writes;
}
/** `writes` plus the neighbouring fence updates they cause (so prediction and the server agree on every changed cell). */
function withFences(world: World, writes: CellWrite[] | null): CellWrite[] | null {
  if (!writes) return null;
  const after: World = { getCell: (x, y, z) => writes.find(w => w[0] === x && w[1] === y && w[2] === z)?.[3] ?? world.getCell(x, y, z) };
  return [...writes, ...writes.flatMap(([x, y, z]) => fenceUpdates(after, x, y, z))];
}

/**
 * Cells written when placing `item` on `hit` while looking along `yaw` (and `pitch`, for pistons), or null if the
 * placement is not allowed. Handles slab merging, log axes, facing blocks, wall torches/ladders, levers and buttons on
 * any face, pistons in six directions, repeaters, two-block doors and beds, plant support and fence connections
 * (including neighbouring fences). Buckets go through the `use` command (`bucketUse`), not here.
 */
export function placementFor(world: World, item: number, hit: PlaceHit, yaw: number, pitch = 0): CellWrite[] | null {
  return withFences(world, placeCells(world, item, hit, yaw, pitch));
}
function placeCells(world: World, item: number, hit: PlaceHit, yaw: number, pitch: number): CellWrite[] | null {
  const block = placesBlock(item);
  if (!block || UNPLACEABLE.has(block)) return null;
  const def = blockOf(block), clicked = world.getCell(hit.x, hit.y, hit.z);
  if (!blockOf(clicked).targetable) return null;
  // Slab onto the matching half of the same slab: merge into a double slab in place.
  if (def.shape === 'slab' && cellId(clicked) === block) {
    const half = cellState(clicked) & 3;
    if (half === SLAB_BOTTOM && hit.face === 3 || half === SLAB_TOP && hit.face === 2) return [[hit.x, hit.y, hit.z, makeCell(block, SLAB_DOUBLE)]];
  }
  const [x, y, z, face] = placeTarget(world, hit);
  if (!inWorld(x, y, z)) return null;
  const current = world.getCell(x, y, z);
  if (def.shape === 'slab' && cellId(current) === block && (cellState(current) & 3) !== SLAB_DOUBLE) return [[x, y, z, makeCell(block, SLAB_DOUBLE)]];
  if (!isReplaceable(current)) return null;
  // Torches, plants and other non-solid shapes cannot sit in water or lava.
  if (isLiquid(current) && !def.solid) return null;
  const upper = face !== 3 && face !== 2 && (hit.hy ?? 0) > 0.5;
  const look = facingFromYaw(yaw);
  const single = (state = 0): CellWrite[] | null => canSurvive(world, x, y, z, makeCell(block, state)) ? [[x, y, z, makeCell(block, state)]] : null;

  switch (def.shape) {
    case 'slab': return single(face === 2 || upper ? SLAB_TOP : SLAB_BOTTOM);
    case 'stairs': return single(look | (face === 2 || upper ? STAIRS_TOP : 0));
    case 'torch': {
      if (face === 3) return single(0);
      const facing = faceToFacing(face);
      return facing >= 0 ? single(1 + facing) : null;
    }
    case 'ladder': {
      const facing = faceToFacing(face);
      return facing >= 0 ? single(facing) : null;
    }
    case 'door':
      if (!sturdyTop(world.getCell(x, y - 1, z)) || y + 1 >= HEIGHT || !free(world, x, y + 1, z)) return null;
      return [[x, y, z, makeCell(block, look)], [x, y + 1, z, makeCell(block, look | DOOR_UPPER)]];
    case 'bed': {
      const [dx, dz] = FACING[look]!, hx = x + dx, hz = z + dz;
      if (!free(world, hx, y, hz) || !sturdyTop(world.getCell(x, y - 1, z)) || !sturdyTop(world.getCell(hx, y - 1, hz))) return null;
      return [[x, y, z, makeCell(block, look)], [hx, y, hz, makeCell(block, look | BED_HEAD)]];
    }
    case 'cactus': return FACING.some(([dx, dz]) => isSolid(world.getCell(x + dx, y, z + dz))) ? null : single();
    // Levers and buttons sit on the clicked face; floor and ceiling levers also remember which way the player looked.
    case 'lever': return single(face | (face === 2 || face === 3 ? look << 4 : 0));
    case 'button': return single(face);
    // A repeater's output points away from the player; a piston's head points at them (up or down when looking steeply).
    case 'repeater': return single(look);
    case 'piston': return single(pitch < -0.8 ? 3 : pitch > 0.8 ? 2 : FACING_FACE[(look + 2) % 4]);
    case 'fence': return single(fenceState(world, x, y, z));
  }
  if (def.state === 'axis') return single(AXIS_BY_FACE[face]);
  if (def.state === 'facing') return single((look + 2) % 4);
  return single();
}

/**
 * Whether a right-click on `cell` while holding `held` is a `use` command (open a table/furnace/chest, sleep, toggle
 * a door, till, bone meal, buckets) rather than a `place`. Sneaking with an item in hand skips block interactions.
 */
export function usesBlock(cell: number, held: number, sneaking: boolean): boolean {
  const id = cellId(cell);
  if (INTERACTIVE.has(id) && (!sneaking || !held)) return true;
  if (HOES.has(held)) return TILLABLE.has(id);
  if (SHOVELS.has(held) && PATHABLE.has(id)) return true;
  if (held === I.bone_meal) return isGrowable(cell);
  return held === I.flint_and_steel || BUCKETS.has(held);
}

/** A bucket use: the cell writes (possibly none), the item that replaces the held bucket, and the effect to play. */
export type BucketUse = { writes: CellWrite[]; item: number; fx: 'splash' | 'fizz' };
/** Cell a bucket acts on for a click: across the clicked face, or the clicked cell itself when pouring into grass and the like. */
export function bucketTarget(world: World, held: number, hit: PlaceHit): Vec3 {
  const [dx, dy, dz] = FACES[hit.face]!, clicked = world.getCell(hit.x, hit.y, hit.z);
  return held !== I.bucket && isReplaceable(clicked) && !isLiquid(clicked) ? [hit.x, hit.y, hit.z] : [hit.x + dx, hit.y + dy, hit.z + dz];
}
/**
 * Fill or empty a bucket at (x, y, z); null when nothing happens. An empty bucket takes water (a source with two or more
 * water neighbours stays, MC's infinite water) or lava. Water meeting lava makes obsidian: pouring water onto lava, water
 * poured beside or above lava (that lava hardens), lava poured onto water or under/beside it. Water evaporates in the Nether.
 */
export function bucketUse(world: World, held: number, x: number, y: number, z: number): BucketUse | null {
  if (!inWorld(x, y, z)) return null;
  const cell = world.getCell(x, y, z);
  if (held === I.bucket) {
    if (isLava(cell)) return { writes: [[x, y, z, B.air]], item: I.lava_bucket, fx: 'splash' };
    if (!isWater(cell)) return null;
    const infinite = FACING.filter(([dx, dz]) => isWater(world.getCell(x + dx, y, z + dz))).length >= 2;
    return { writes: infinite ? [] : [[x, y, z, B.air]], item: I.water_bucket, fx: 'splash' };
  }
  const water = held === I.water_bucket;
  if (!water && held !== I.lava_bucket || !isReplaceable(cell) || (water ? isWater(cell) : isLava(cell))) return null;
  if (water ? isLava(cell) : isWater(cell)) return { writes: [[x, y, z, B.obsidian]], item: I.bucket, fx: 'fizz' };
  if (water && inNether(x, z)) return { writes: [], item: I.bucket, fx: 'fizz' };
  // Water spreads sideways and down; lava is hardened by water arriving from above or beside.
  const around: Vec3[] = [...FACING.map(([dx, dz]): Vec3 => [x + dx, y, z + dz]), water ? [x, y - 1, z] : [x, y + 1, z]];
  const meets = around.filter(([ax, ay, az]) => (water ? isLava : isWater)(world.getCell(ax, ay, az)));
  if (!water) return { writes: [[x, y, z, meets.length ? B.obsidian : B.lava]], item: I.bucket, fx: meets.length ? 'fizz' : 'splash' };
  return { writes: [[x, y, z, B.water], ...meets.map(([ax, ay, az]): CellWrite => [ax, ay, az, B.obsidian])], item: I.bucket, fx: meets.length ? 'fizz' : 'splash' };
}
/** Whether holding right-click with this item is a timed use (eat or draw a bow) finished by `useItem`. */
export const isHeldUse = (held: number, food: number) => held === I.bow || !!itemOf(held)?.food && (food < 20 || held === I.golden_apple);
