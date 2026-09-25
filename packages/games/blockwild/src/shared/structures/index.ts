/**
 * Overworld structures: villages, desert temples, mineshafts and dungeons, painted by worldgen.
 * Everything here is pure and deterministic in the seed (integer hashes and + - * / only, like worldgen).
 *
 * Placement uses MC-style region grids: each structure type splits the world into cells of `spacing` chunks, and each
 * cell has at most one start at a hashed chunk offset (within `spacing − separation`), kept if its planner accepts the
 * biome and terrain. A start is planned once per seed into chunk-bucketed paint operations (see builder.ts) and cached,
 * so `paintStructures` only replays the bucket of the chunk being generated. Dungeons are per-chunk features instead.
 */
import { B } from '../blocks';
import { CHUNK, HEIGHT, NETHER, SEED_CACHE, WORLD } from '../constants';
import { cellIndex, chunkKey, localIndex, type Vec3 } from '../coords';
import { createRng, hash3 } from '../noise';
import { TREE_RADIUS } from '../trees';
import { growTree, treesNear } from '../worldgen';
import { OP, paintOps, type Blueprint, type Bounds } from './builder';
import { paintDungeon } from './dungeon';
import { MINESHAFT_REACH, planMineshaft } from './mineshaft';
import { APPROACH as TEMPLE_APPROACH, planTemple } from './temple';
import { planVillage, VILLAGE_REACH, type Village } from './village';

export type { Bounds } from './builder';
export type { Village } from './village';
export type StructureKind = 'village' | 'desert_temple' | 'mineshaft';
/** A planned structure: its kind, a representative centre (beside the village well, the temple hall, the mineshaft room) and its bounds. */
export type StructureInfo = { kind: StructureKind; center: Vec3; bounds: Bounds };

type Plan = { center: Vec3; bp: Blueprint; village?: Village };
type Built = StructureInfo & { chunks: Map<number, Int32Array>; village?: Village };
type Grid = {
  kind: StructureKind; spacing: number; separation: number; salt: number;
  /** Farthest any piece reaches from the start column (blocks). */
  reach: number;
  /** Surface structures clear the trees rooted inside their bounds. */
  clearTrees: boolean;
  plan(seed: number, x: number, z: number): Plan | null;
};
let gridTable: readonly Grid[] | undefined;
/**
 * The region grids in painting order: underground first, so surface structures win where they meet. Built on first use:
 * this module sits in an import cycle with worldgen (which calls paintStructures), so its top level reads no imports.
 */
const grids = () => gridTable ??= [
  { kind: 'mineshaft', spacing: 13, separation: 3, salt: 0x3a1f, reach: MINESHAFT_REACH + 8, clearTrees: false, plan: planMineshaft },
  { kind: 'desert_temple', spacing: 32, separation: 8, salt: 0x7e3b, reach: 12 + TEMPLE_APPROACH, clearTrees: true, plan: planTemple },
  { kind: 'village', spacing: 32, separation: 8, salt: 0x51a9, reach: VILLAGE_REACH + 4, clearTrees: true, plan: planVillage },
];
const gridOf = (kind: StructureKind) => grids().find(g => g.kind === kind)!;
/** Keep structures this far from the world rim and the Nether region's walls. */
const MARGIN = 24;

// ---------------------------------------------------------------------------------------------------------------------
// Starts and the per-seed cache

const caches = new Map<number, Map<string, Built | null>>();
/** Planned structures kept per seed (up to ~140 KB each; a player's surroundings touch about 17 grid cells at a time). */
const BUILT_CAP = 64;
function cacheFor(seed: number) {
  let cache = caches.get(seed);
  if (!cache) {
    if (caches.size >= SEED_CACHE) caches.delete(caches.keys().next().value!);
    caches.set(seed, cache = new Map());
  }
  return cache;
}
/** The start column of grid cell (gx, gz): the centre of a hashed chunk in the cell. */
function startOf(seed: number, grid: Grid, gx: number, gz: number): [number, number] {
  const h = hash3(seed ^ grid.salt, gx, gz, 0x5eed), span = grid.spacing - grid.separation;
  return [(gx * grid.spacing + h % span) * CHUNK + 8, (gz * grid.spacing + (h >>> 16) % span) * CHUNK + 8];
}
const clearOfEdges = (b: Bounds) => b[0] >= MARGIN && b[2] >= MARGIN && b[3] < WORLD - MARGIN && b[5] < WORLD - MARGIN
  && !(b[3] >= NETHER.x0 - MARGIN && b[2] < NETHER.z0 + NETHER.size + MARGIN);

/** The structure started in grid cell (gx, gz), planned and baked once per seed (null when the cell has none). */
function built(seed: number, grid: Grid, gx: number, gz: number): Built | null {
  const cache = cacheFor(seed), key = `${grid.salt}:${gx}:${gz}`, hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const [x, z] = startOf(seed, grid, gx, gz);
  let result: Built | null = null;
  const plan = clearOfEdges([x - grid.reach, 0, z - grid.reach, x + grid.reach, 0, z + grid.reach]) ? grid.plan(seed, x, z) : null;
  if (plan && plan.bp.ops.length) {
    const bounds = plan.bp.bounds;
    // Temples stay out of villages (both are desert structures on the same spacing).
    const clash = grid.kind === 'desert_temple' && near(seed, gridOf('village'), bounds[0], bounds[2], bounds[3], bounds[5]).length > 0;
    if (!clash && clearOfEdges(bounds)) result = { kind: grid.kind, center: plan.center, bounds, chunks: plan.bp.bake(), ...plan.village ? { village: plan.village } : {} };
  }
  if (cache.size >= BUILT_CAP) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}

/** Structures of one grid whose bounds intersect the world rectangle [x0, x1] × [z0, z1]. */
function near(seed: number, grid: Grid, x0: number, z0: number, x1: number, z1: number): Built[] {
  const size = grid.spacing * CHUNK, out: Built[] = [];
  for (let gz = Math.max(0, Math.floor((z0 - grid.reach) / size)); gz <= Math.floor((z1 + grid.reach) / size) && gz * size < WORLD; gz++) {
    for (let gx = Math.max(0, Math.floor((x0 - grid.reach) / size)); gx <= Math.floor((x1 + grid.reach) / size) && gx * size < WORLD; gx++) {
      const [sx, sz] = startOf(seed, grid, gx, gz);
      if (sx + grid.reach < x0 || sx - grid.reach > x1 || sz + grid.reach < z0 || sz - grid.reach > z1) continue;
      const b = built(seed, grid, gx, gz);
      if (b && b.bounds[0] <= x1 && b.bounds[3] >= x0 && b.bounds[2] <= z1 && b.bounds[5] >= z0) out.push(b);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Painting

/**
 * Paint every structure piece that intersects chunk (cx, cz) into `cells`, clipped to the chunk. generateChunk calls this
 * for overworld chunks after terrain, ores, trees and decorations: dungeons first (they test this chunk's own caves), then
 * mineshafts, temples and villages. Trees rooted inside a surface structure are removed whole (in every chunk they reach),
 * and each piece clears the plants in its footprint.
 */
export function paintStructures(seed: number, cx: number, cz: number, cells: Uint16Array): void {
  paintDungeon(seed, cx, cz, cells);
  // Surface structures are looked up a tree's reach wider: a tree rooted inside one can spread into this chunk.
  const x0 = cx * CHUNK, z0 = cz * CHUNK, key = chunkKey(cx, cz), margin = (grid: Grid) => grid.clearTrees ? TREE_RADIUS + 1 : 0;
  const here = grids().flatMap(grid => near(seed, grid, x0 - margin(grid), z0 - margin(grid), x0 + CHUNK - 1 + margin(grid), z0 + CHUNK - 1 + margin(grid)).map(b => ({ b, grid })));
  if (!here.length) return;
  const zones = here.filter(({ grid }) => grid.clearTrees).map(({ b }) => b.bounds);
  if (zones.length) clearGrowth(seed, cx, cz, cells, zones);
  for (const { b } of here) {
    const ops = b.chunks.get(key);
    if (ops) paintOps(ops, x0, z0, cells);
  }
}

/**
 * Remove, cell by cell, every tree rooted inside one of the zones (a tree spans chunks, so each chunk erases its part),
 * and the cacti standing inside them (they would hurt anyone walking the streets).
 */
function clearGrowth(seed: number, cx: number, cz: number, cells: Uint16Array, zones: readonly Bounds[]) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  for (const b of zones) {
    for (let z = Math.max(z0, b[2]); z <= Math.min(z0 + CHUNK - 1, b[5]); z++) for (let x = Math.max(x0, b[0]); x <= Math.min(x0 + CHUNK - 1, b[3]); x++) {
      for (let y = b[1]; y <= Math.min(HEIGHT - 1, b[4] + 3); y++) if (cells[localIndex(x - x0, y, z - z0)] === B.cactus) cells[localIndex(x - x0, y, z - z0)] = B.air;
    }
  }
  for (const tree of treesNear(seed, cx, cz)) {
    if (!zones.some(b => tree.x >= b[0] - 1 && tree.x <= b[3] + 1 && tree.z >= b[2] - 1 && tree.z <= b[5] + 1)) continue;
    growTree(tree.kind, tree.x, tree.y, tree.z, createRng(tree.seed), (x, y, z, cell) => {
      const lx = x - x0, lz = z - z0;
      if (lx < 0 || lz < 0 || lx >= CHUNK || lz >= CHUNK) return;
      const i = localIndex(lx, y, lz);
      if (cells[i] === cell) cells[i] = B.air;
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Queries

/** Villages whose bounds intersect chunk (cx, cz): the well, each house bed (foot cell) with the house's bounds, and the village bounds. */
export function villagesNear(seed: number, cx: number, cz: number): readonly Village[] {
  return near(seed, gridOf('village'), cx * CHUNK, cz * CHUNK, cx * CHUNK + CHUNK - 1, cz * CHUNK + CHUNK - 1).map(b => b.village!);
}

/** Planned structures (not dungeons) whose bounds come within `radius` blocks of (x, z), for tests and debugging. */
export function structuresNear(seed: number, x: number, z: number, radius: number): StructureInfo[] {
  return grids().flatMap(grid => near(seed, grid, x - radius, z - radius, x + radius, z + radius))
    .map(({ kind, center, bounds }) => ({ kind, center: [...center] as Vec3, bounds: [...bounds] as Bounds }));
}

/**
 * The cells a structure is certain to leave behind (global cell index → cell value, later writes win), for tests that
 * check the generated world against the plan. Fences appear as a bare `B.oak_fence` (their connections resolve while
 * painting); cells whose last write is conditional (floors over caves, webs into air...) are left out, as are columns
 * shaped by levelling and paths.
 */
export function plannedCells(seed: number, info: StructureInfo): Map<number, number> {
  const cells = new Map<number, number>();
  const b = near(seed, gridOf(info.kind), info.center[0], info.center[2], info.center[0], info.center[2]).find(s => s.center.every((v, i) => v === info.center[i]));
  for (const ops of b?.chunks.values() ?? []) for (let i = 0; i < ops.length; i += 5) {
    const code = ops[i]!, index = cellIndex(ops[i + 1]!, ops[i + 2]!, ops[i + 3]!);
    if (code === OP.set) cells.set(index, ops[i + 4]!);
    else if (code === OP.fence) cells.set(index, B.oak_fence);
    else if (code === OP.solid || code === OP.air || code === OP.fill) cells.delete(index);
  }
  return cells;
}
