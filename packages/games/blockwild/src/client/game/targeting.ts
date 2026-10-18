/** Pure targeting and interaction rules used by the local player loop. */
import {
  B, BED_HEAD, blockOf, BUTTON_PRESSED, cellId, cellState, DAYLIGHT_INVERTED, DOOR_OPEN, DOOR_UPPER, FRAME_EYE, isAir, LEVER_ON, makeCell, pistonFacing, PISTON_EXTENDED,
} from '../../shared/blocks';
import type { CellReader } from '../../shared/chunk';
import { FACES, FACING, type Vec3 } from '../../shared/coords';
import { I, itemOf } from '../../shared/items';
import { DRAGON_PARTS } from '../../shared/protocol';
import type { BlockHit } from '../../shared/raycast';
import { rayAabb } from '../../shared/raycast';
import { bucketTarget, bucketUse, canSurvive, fenceUpdates, isHoe, isPathable, isShovel, usesBlock, type CellWrite, type PlaceHit } from '../../shared/placement';
import { collisionBoxes } from '../../shared/shapes';
import type { Target } from '../store';

/** One hit box of a mob; `part` indexes `mobBoxes` (the dragon's parts) and rides along on attacks. */
export type MobBox = { id: number; box: readonly [number, number, number, number, number, number]; part?: number };
/** A targeted mob with the part the crosshair hit (the dragon's head, a wing...), when it has several. */
export type MobTarget = Extract<Target, { kind: 'mob' }> & { part?: number };
export type Aim = Exclude<Target, { kind: 'mob' }> | MobTarget;

/** Nearest of the block hit and any mob box within reach (mobs win ties so you can hit a mob in front of grass). */
export function pickTarget(block: BlockHit | null, mobs: Iterable<MobBox>, origin: Readonly<Vec3>, dir: Readonly<Vec3>, reach: number): Aim | null {
  let best: Aim | null = block ? { kind: 'block', x: block.x, y: block.y, z: block.z, face: block.face, cell: block.cell, point: block.point } : null;
  let bestDistance = block ? block.distance : reach;
  for (const mob of mobs) {
    const hit = rayAabb(origin, dir, mob.box, reach);
    if (hit && hit.distance <= bestDistance) {
      bestDistance = hit.distance;
      best = mob.part === undefined ? { kind: 'mob', id: mob.id, distance: hit.distance } : { kind: 'mob', id: mob.id, distance: hit.distance, part: mob.part };
    }
  }
  return best;
}

/**
 * The dragon's posed part boxes written into `out[i].box` (DRAGON_PARTS order), exactly as the shared `mobBoxes` builds them
 * but without allocating, for the interpolated pose drawn this frame.
 */
export function dragonBoxes(x: number, y: number, z: number, yaw: number, pitch: number, out: readonly { readonly box: readonly number[] }[]) {
  const sin = Math.sin(yaw), cos = Math.cos(yaw), flat = Math.cos(pitch), rise = Math.sin(pitch), cy = y + 2;
  DRAGON_PARTS.forEach(({ at: [f, r, u], w, h }, i) => {
    const px = x - sin * f * flat + cos * r, py = cy + (r ? 0 : f * rise) + u, pz = z - cos * f * flat - sin * r, box = out[i]!.box as number[];
    box[0] = px - w; box[1] = py - h; box[2] = pz - w; box[3] = px + w; box[4] = py + h; box[5] = pz + w;
  });
}
/** True when two targets are the same block face (and cell value) or the same mob: skips redundant store updates. */
export function sameTarget(a: Target | null, b: Target | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'mob') return b.kind === 'mob' && a.id === b.id;
  return b.kind === 'block' && a.x === b.x && a.y === b.y && a.z === b.z && a.face === b.face && a.cell === b.cell;
}

/** Cells that break together with this one (the other half of a door or bed, a piston's head or extended base). */
export function linkedCells(getCell: CellReader, x: number, y: number, z: number, cell: number): [number, number, number][] {
  const id = cellId(cell), state = cellState(cell);
  if (blockOf(cell).shape === 'door') {
    const dy = state & DOOR_UPPER ? -1 : 1;
    return cellId(getCell(x, y + dy, z)) === id ? [[x, y + dy, z]] : [];
  }
  if (id === B.bed) {
    const [dx, dz] = FACING[state & 3]!, sign = state & BED_HEAD ? -1 : 1, px = x + dx * sign, pz = z + dz * sign;
    return cellId(getCell(px, y, pz)) === B.bed ? [[px, y, pz]] : [];
  }
  if (id === B.piston_head || (id === B.piston || id === B.sticky_piston) && state & PISTON_EXTENDED) {
    const face = pistonFacing(state), [dx, dy, dz] = FACES[face]!, sign = id === B.piston_head ? -1 : 1, other = getCell(x + dx * sign, y + dy * sign, z + dz * sign);
    const matches = id === B.piston_head ? cellId(other) === B.piston || cellId(other) === B.sticky_piston : cellId(other) === B.piston_head;
    return matches && pistonFacing(cellState(other)) === face ? [[x + dx * sign, y + dy * sign, z + dz * sign]] : [];
  }
  return [];
}

/**
 * Predicted writes for breaking the block at (x, y, z): the block and its linked cells become air, blocks that lose
 * their support pop off (the server's `settle`, a few steps deep) and neighbouring fences reconnect.
 */
export function breakWrites(getCell: CellReader, x: number, y: number, z: number, cell: number): CellWrite[] {
  const writes: CellWrite[] = [[x, y, z, B.air], ...linkedCells(getCell, x, y, z, cell).map(([lx, ly, lz]): CellWrite => [lx, ly, lz, B.air])];
  const after = (ax: number, ay: number, az: number) => writes.find(w => w[0] === ax && w[1] === ay && w[2] === az)?.[3] ?? getCell(ax, ay, az);
  const world = { getCell: after };
  for (let i = 0; i < writes.length && writes.length < 24; i++) {
    const [wx, wy, wz] = writes[i]!;
    for (const [dx, dy, dz] of FACES) {
      const nx = wx + dx, ny = wy + dy, nz = wz + dz, near = after(nx, ny, nz), shape = blockOf(near).shape;
      if (shape === 'cube' || shape === 'air' || shape === 'liquid' || canSurvive(world, nx, ny, nz, near)) continue;
      writes.push([nx, ny, nz, B.air]);
    }
  }
  return [...writes, ...writes.flatMap(([wx, wy, wz]) => fenceUpdates(world, wx, wy, wz))];
}

/** Predicted result of opening/closing a door: both halves toggle. */
export function doorToggle(getCell: CellReader, x: number, y: number, z: number, cell: number): CellWrite[] {
  const writes: CellWrite[] = [[x, y, z, cell ^ makeCell(0, DOOR_OPEN)]];
  for (const [lx, ly, lz] of linkedCells(getCell, x, y, z, cell)) writes.push([lx, ly, lz, getCell(lx, ly, lz) ^ makeCell(0, DOOR_OPEN)]);
  return writes;
}

const STATIONS = new Set<number>([B.crafting_table, B.furnace, B.furnace_lit, B.chest, B.bed, B.oak_door]);
const CONTROLS = new Map<number, UseKind>([[B.lever, 'lever'], [B.stone_button, 'button'], [B.oak_button, 'button'], [B.repeater, 'repeater']]);
export type UseKind = 'open' | 'door' | 'till' | 'path' | 'bonemeal' | 'bucket' | 'lever' | 'button' | 'repeater' | 'ignite' | 'tnt' | 'eye' | 'crystal' | 'daylight' | null;
/**
 * What right-clicking this block with `held` does as a 'use' command (null = try placing instead). The decision is the
 * server's own `usesBlock`; this only classifies it for prediction. Tilling and paths are predicted only with air above.
 */
export function blockUse(cell: number, above: number, held: number, sneaking: boolean): UseKind {
  if (!usesBlock(cell, held, sneaking)) return null;
  const id = cellId(cell);
  if (STATIONS.has(id) && (!sneaking || !held)) return id === B.oak_door ? 'door' : 'open';
  if (CONTROLS.has(id) && (!sneaking || !held)) return CONTROLS.get(id)!;
  if (id === B.daylight_detector && (!sneaking || !held)) return 'daylight';
  if (held === I.ender_eye) return 'eye';
  if (held === I.end_crystal) return 'crystal';
  if (isHoe(held)) return cellId(above) === B.air ? 'till' : null;
  if (isShovel(held) && isPathable(id)) return cellId(above) === B.air ? 'path' : null;
  if (held === I.flint_and_steel) return id === B.tnt ? 'tnt' : 'ignite';
  return held === I.bone_meal ? 'bonemeal' : 'bucket';
}

/**
 * Predicted cell writes of a 'use' (the server's rules): levers flip, buttons press, repeaters cycle their delay, hoes
 * till, shovels make paths, flint and steel lights fire across the clicked face, buckets fill or pour, daylight detectors
 * flip to inverted and eyes of ender drop into frames. Empty when the result is the server's alone (opening screens,
 * portals, priming TNT, bone meal, end crystals).
 */
export function useWrites(getCell: CellReader, kind: UseKind, hit: PlaceHit, held: number): CellWrite[] {
  const { x, y, z } = hit, cell = getCell(x, y, z), state = cellState(cell), world = { getCell };
  switch (kind) {
    case 'lever': return [[x, y, z, cell ^ LEVER_ON << 8]];
    case 'button': return state & BUTTON_PRESSED ? [] : [[x, y, z, cell | BUTTON_PRESSED << 8]];
    case 'repeater': return [[x, y, z, makeCell(B.repeater, state & ~12 | ((state >> 2) + 1 & 3) << 2)]];
    case 'daylight': return [[x, y, z, cell ^ DAYLIGHT_INVERTED << 8]];
    case 'eye': return [[x, y, z, cell | FRAME_EYE << 8]];
    case 'till': return [[x, y, z, B.farmland]];
    case 'path': return [[x, y, z, B.dirt_path]];
    case 'ignite': {
      const [dx, dy, dz] = FACES[hit.face]!, tx = x + dx, ty = y + dy, tz = z + dz;
      // Inside an obsidian frame the server may light a portal instead: leave that to it.
      if (!isAir(getCell(tx, ty, tz)) || !canSurvive(world, tx, ty, tz, B.fire) || cellId(getCell(tx, ty - 1, tz)) === B.obsidian) return [];
      return [[tx, ty, tz, B.fire]];
    }
    case 'bucket': return bucketUse(world, held, ...bucketTarget(world, held, hit))?.writes ?? [];
  }
  return [];
}

/** True when right-click with this item starts a held use (eating or drawing a bow). */
export function holdUse(held: number, food: number, creative: boolean, hasArrows: boolean): 'eat' | 'bow' | null {
  const item = itemOf(held);
  if (item?.food && (food < 20 || held === I.golden_apple) && !creative) return 'eat';
  if (held === I.bow && (hasArrows || creative)) return 'bow';
  return null;
}

/** True if any written cell's collision boxes would overlap one of the body boxes (placement must not trap anyone). */
export function writesHitBodies(writes: readonly CellWrite[], bodies: Iterable<readonly number[]>): boolean {
  for (const body of bodies) for (const [x, y, z, cell] of writes) for (const b of collisionBoxes(cell)) {
    if (x + b[0] < body[3]! && x + b[3] > body[0]! && y + b[1] < body[4]! && y + b[4] > body[1]! && z + b[2] < body[5]! && z + b[5] > body[2]!) return true;
  }
  return false;
}
