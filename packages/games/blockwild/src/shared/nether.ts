/**
 * Nether terrain. The Nether is the sealed region NETHER of the ordinary world storage; generateChunk
 * dispatches its chunks here. Same determinism rules as worldgen.ts (integer hashes and + - * / only).
 *
 * Shape: one density field, solid where positive. A floor and a ceiling (2D heights, roughened by 3D noise, with
 * stalagmites and stalactites) enclose vast caverns; large 3D blobs add walls and floating islands; hourglass pillars
 * join floor and ceiling. Open cells at or below the lava sea fill with lava. Soul sand valleys raise the floor into flat
 * dry basins. Then surfaces (soul sand, gravel and soul sand shores, magma by the lava), fire and mushrooms, hanging
 * glowstone, quartz and gold ore, lava springs in the walls and the bedrock seal.
 */
import { B } from './blocks';
import { CHUNK_CELLS } from './chunk';
import { CHUNK, inNether, NETHER, SEED_CACHE } from './constants';
import { localIndex } from './coords';
import { createRng, fbm2, hash3, lerp, rand2, rand3, rngInt, simplex2, simplex3, smoothstep, subSeed, type Rng } from './noise';

/** Every open cell at or below this height is lava. */
export const LAVA_SEA = 31;
/** The sealing bedrock walls: column x = WALL_X and row z = WALL_Z (the region's inside faces). */
const WALL_X = NETHER.x0, WALL_Z = NETHER.z0 + NETHER.size - 1;
const X1 = NETHER.x0 + NETHER.size - 1;

/** True for chunks inside the Nether region (cx ≥ 224, cz < 32). */
export const isNetherChunk = (cx: number, cz: number) => inNether(cx * CHUNK, cz * CHUNK);

const NAMES = ['floor', 'ceil', 'shape', 'mass', 'island', 'valley', 'spike', 'pillar', 'shore', 'magma', 'decor', 'glow', 'ores', 'bedrock'] as const;
type Seeds = Record<typeof NAMES[number], number>;
const seedCache = new Map<number, Seeds>();
function seedsFor(seed: number): Seeds {
  let seeds = seedCache.get(seed);
  if (seeds) return seeds;
  seeds = Object.fromEntries(NAMES.map((name, i) => [name, subSeed(seed, 900 + i)])) as Seeds;
  if (seedCache.size >= SEED_CACHE) seedCache.delete(seedCache.keys().next().value!);
  seedCache.set(seed, seeds);
  return seeds;
}

// ---------------------------------------------------------------------------------------------
// Columns: floor and ceiling heights, spikes, valleys, pillars and the thickening towards the region's edges.

type Column = { floor: number; ceil: number; floorSpike: number; ceilSpike: number; valley: number; pillarDist: number; pillarR: number; edge: number };
const PILLAR_CELL = 40;

function columnAt(s: Seeds, x: number, z: number, out: Column): Column {
  const valley = smoothstep(0.22, 0.42, fbm2(s.valley, x, z, 170, 2));
  out.valley = valley;
  out.floor = lerp(25 + fbm2(s.floor, x, z, 110, 3) * 26, 34 + fbm2(s.floor + 1, x, z, 40, 2) * 3, valley);
  out.ceil = Math.min(116, 99 + fbm2(s.ceil, x, z, 80, 3) * 19);
  // Sharp spikes where a fine noise peaks: long stalactites, shorter stalagmites (none in the flat valleys).
  const spike = simplex2(s.spike, x / 5.5, z / 5.5), up = simplex2(s.spike + 1, x / 4.5, z / 4.5);
  out.ceilSpike = spike > 0.5 ? (spike - 0.5) * 44 : 0;
  out.floorSpike = up > 0.62 ? (up - 0.62) * 34 * (1 - valley) : 0;
  // Hourglass pillars: at most one per 40×40 cell, at a hashed spot with a hashed radius.
  const gx = Math.floor((x - NETHER.x0) / PILLAR_CELL), gz = Math.floor(z / PILLAR_CELL);
  out.pillarDist = Infinity;
  out.pillarR = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const h = hash3(s.pillar, gx + dx, gz + dz, 0);
    if ((h & 1023) / 1024 >= 0.45) continue;
    const px = NETHER.x0 + (gx + dx) * PILLAR_CELL + 6 + (h >>> 10) % 28, pz = (gz + dz) * PILLAR_CELL + 6 + (h >>> 16) % 28;
    const d = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz)), r = 3 + (h >>> 24 & 15) / 15 * 5;
    if (d - r < out.pillarDist - out.pillarR) {
      out.pillarDist = d;
      out.pillarR = r;
    }
  }
  const rim = Math.min(x - NETHER.x0, X1 - x, z - NETHER.z0, WALL_Z - z);
  out.edge = (1 - smoothstep(0, 14, rim)) * 6;
  return out;
}

// ---------------------------------------------------------------------------------------------
// 3D noise on a 4-block lattice (5 × 5 columns × 33 levels), interpolated per cell.

/** Values per lattice point: surface roughness, massive walls, floating islands. */
const LK = 3, LEVELS = 33, SZ = 5 * LK, SY = 25 * LK;
const lattice = new Float64Array(25 * LEVELS * LK);
function fillLattice(s: Seeds, x0: number, z0: number) {
  for (let gy = 0; gy < LEVELS; gy++) for (let gz = 0; gz < 5; gz++) for (let gx = 0; gx < 5; gx++) {
    const x = x0 + gx * 4, y = gy * 4, z = z0 + gz * 4, at = gx * LK + gz * SZ + gy * SY;
    lattice[at] = simplex3(s.shape, x / 64, y / 30, z / 64) * 0.65 + simplex3(s.shape + 1, x / 22, y / 13, z / 22) * 0.35;
    lattice[at + 1] = y > 32 && y < 112 ? simplex3(s.mass, x / 115, y / 58, z / 115) : -1;
    lattice[at + 2] = y > 36 && y < 104 ? simplex3(s.island, x / 58, y / 21, z / 58) * 0.8 + simplex3(s.island + 1, x / 17, y / 9, z / 17) * 0.2 : -1;
  }
}
function trilerp(at: number, fx: number, fy: number, fz: number) {
  const v = lattice;
  const c00 = lerp(v[at]!, v[at + LK]!, fx), c10 = lerp(v[at + SY]!, v[at + LK + SY]!, fx);
  const c01 = lerp(v[at + SZ]!, v[at + LK + SZ]!, fx), c11 = lerp(v[at + SY + SZ]!, v[at + LK + SY + SZ]!, fx);
  return lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz);
}

/** Density at a cell (solid where > 0), from its column and the lattice cell it sits in. */
function density(col: Column, y: number, at: number, fx: number, fy: number, fz: number): number {
  const shape = trilerp(at, fx, fy, fz);
  const floor = (col.floor + col.floorSpike - y) / 7, ceil = (y - col.ceil + col.ceilSpike) / 7;
  let d = Math.max(floor, ceil) + shape * lerp(1.1, 0.5, col.valley) + col.edge;
  if (d > 0) return d;
  if (y > 32 && y < 112) {
    d = Math.max(d, (trilerp(at + 1, fx, fy, fz) - 0.42) * 6);
    const band = smoothstep(38, 52, y) * (1 - smoothstep(88, 100, y));
    if (band > 0) d = Math.max(d, (trilerp(at + 2, fx, fy, fz) - 0.4) * 7 * band - (1 - band));
  }
  if (col.pillarDist < col.pillarR * 2.4) {
    const taper = 1 + 1.3 * (1 - smoothstep(0, 24, Math.min(y - col.floor, col.ceil - y)));
    d = Math.max(d, (col.pillarR * taper * (0.85 + 0.3 * shape) - col.pillarDist) / 1.5);
  }
  return d;
}

// ---------------------------------------------------------------------------------------------
// Chunk generation

const columns: Column[] = Array.from({ length: CHUNK * CHUNK }, () => ({ floor: 0, ceil: 0, floorSpike: 0, ceilSpike: 0, valley: 0, pillarDist: 0, pillarR: 0, edge: 0 }));
const UP = CHUNK * CHUNK;
const isOpen = (cell: number) => cell === B.air || cell === B.lava;

/**
 * Terrain for a Nether chunk: pure in (seed, cx, cz), ≤ 8 ms median, sealed with bedrock (the full-height walls at
 * x = 3584 and z = 511, a ragged floor y 0–4 and ceiling y 123–127).
 */
export function generateNetherChunk(seed: number, cx: number, cz: number): Uint16Array {
  const s = seedsFor(seed), cells = new Uint16Array(CHUNK_CELLS), x0 = cx * CHUNK, z0 = cz * CHUNK;
  fillLattice(s, x0, z0);
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const col = columnAt(s, x0 + lx, z0 + lz, columns[lx + lz * CHUNK]!), base = (lx >> 2) * LK + (lz >> 2) * SZ, fx = (lx & 3) / 4, fz = (lz & 3) / 4;
    for (let y = 5; y <= 122; y++) {
      const solid = density(col, y, base + (y >> 2) * SY, fx, (y & 3) / 4, fz) > 0;
      cells[localIndex(lx, y, lz)] = solid ? B.netherrack : y <= LAVA_SEA ? B.lava : B.air;
    }
  }
  const rng = createRng(hash3(s.ores, cx, cz, 5));
  veins(cells, rng, B.nether_quartz_ore, 14, 3, 10);
  veins(cells, rng, B.nether_gold_ore, 8, 2, 6);
  surfaces(s, cells, x0, z0);
  glowstone(s, cells, cx, cz);
  lavaSprings(cells, rng);
  seal(s, cells, x0, z0);
  return cells;
}

/** Floor tops: soul sand in valleys, gravel and soul sand shores, magma by the lava; fire and mushrooms on dry floors. */
function surfaces(s: Seeds, cells: Uint16Array, x0: number, z0: number) {
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const x = x0 + lx, z = z0 + lz, col = columns[lx + lz * CHUNK]!;
    const shore = fbm2(s.shore, x, z, 22, 2), magma = fbm2(s.magma, x, z, 9, 2), fire = simplex2(s.decor, x / 11, z / 11);
    for (let y = 121; y >= 6; y--) {
      const i = localIndex(lx, y, lz), top = cells[i + UP]!;
      if (cells[i] !== B.netherrack || !isOpen(top)) continue;
      let layers = 0, block: number = B.netherrack;
      if (col.valley > 0.5 && y > LAVA_SEA) { block = B.soul_sand; layers = 2 + hash3(s.decor, x, y, z) % 3; }
      else if (y >= LAVA_SEA - 1 && y <= LAVA_SEA + 3 && shore > 0.2) { block = shore > 0.45 ? B.soul_sand : B.gravel; layers = 1 + (hash3(s.decor, x, y, z) & 1); }
      if (y <= LAVA_SEA + 2 && y >= 22 && (magma > 0.3 || top === B.lava && rand3(s.magma, x, y, z) < 0.12)) { block = B.magma_block; layers = 1; }
      for (let k = 0; k < layers && cells[i - k * UP] === B.netherrack; k++) cells[i - k * UP] = block;
      if (top !== B.air || y > 120 || cells[i + 2 * UP] !== B.air) continue;
      const r = rand2(s.decor + 1, x, z * 131 + y);
      if (block === B.netherrack && (fire > 0.62 && r < 0.4 || r < 0.0025)) cells[i + UP] = B.fire;
      else if (r > 0.992 && block !== B.magma_block) cells[i + UP] = r > 0.9965 ? B.red_mushroom : B.brown_mushroom;
    }
  }
}

/** Glowstone clusters hanging from ceilings (MC-style: each new block touches exactly one glowstone), kept inside the chunk. */
function glowstone(s: Seeds, cells: Uint16Array, cx: number, cz: number) {
  const rng = createRng(hash3(s.glow, cx, cz, 1));
  for (let attempt = rngInt(rng, 4, 8); attempt > 0; attempt--) {
    const lx = rngInt(rng, 3, 12), lz = rngInt(rng, 3, 12);
    let y = rngInt(rng, 56, 116);
    while (y < 121 && !(cells[localIndex(lx, y, lz)] === B.air && cells[localIndex(lx, y + 1, lz)] === B.netherrack)) y++;
    if (y >= 121) continue;
    cells[localIndex(lx, y, lz)] = B.glowstone;
    for (let n = 0; n < 160; n++) {
      const x = lx + rngInt(rng, -3, 3), gy = y - rngInt(rng, 0, 7), z = lz + rngInt(rng, -3, 3), i = localIndex(x, gy, z);
      if (cells[i] !== B.air) continue;
      let touching = 0;
      if (x > 0 && cells[i - 1] === B.glowstone) touching++;
      if (x < 15 && cells[i + 1] === B.glowstone) touching++;
      if (z > 0 && cells[i - CHUNK] === B.glowstone) touching++;
      if (z < 15 && cells[i + CHUNK] === B.glowstone) touching++;
      if (cells[i - UP] === B.glowstone) touching++;
      if (cells[i + UP] === B.glowstone) touching++;
      if (touching === 1) cells[i] = B.glowstone;
    }
  }
}

/** Ore veins by random walk, replacing netherrack only (y 10–117). */
function veins(cells: Uint16Array, rng: Rng, ore: number, attempts: number, min: number, max: number) {
  for (let a = 0; a < attempts; a++) {
    let x = rngInt(rng, 1, 14), y = rngInt(rng, 10, 117), z = rngInt(rng, 1, 14);
    for (let n = rngInt(rng, min, max); n > 0; n--) {
      const i = localIndex(x, y, z);
      if (cells[i] === B.netherrack) cells[i] = ore;
      const step = Math.floor(rng() * 6), dir = step & 1 ? 1 : -1;
      if (step < 2) x = Math.min(15, Math.max(0, x + dir));
      else if (step < 4) y = Math.min(117, Math.max(10, y + dir));
      else z = Math.min(15, Math.max(0, z + dir));
    }
  }
}

/** Glowing lava eyes in cavern walls: a netherrack cell open on exactly one side, enclosed everywhere else. */
function lavaSprings(cells: Uint16Array, rng: Rng) {
  for (let a = 0; a < 10; a++) {
    const i = localIndex(rngInt(rng, 1, 14), rngInt(rng, LAVA_SEA + 2, 116), rngInt(rng, 1, 14));
    if (cells[i] !== B.netherrack || cells[i - UP] !== B.netherrack || cells[i + UP] !== B.netherrack) continue;
    const open = [cells[i - 1]!, cells[i + 1]!, cells[i - CHUNK]!, cells[i + CHUNK]!].filter(cell => cell === B.air).length;
    const solid = [cells[i - 1]!, cells[i + 1]!, cells[i - CHUNK]!, cells[i + CHUNK]!].filter(cell => cell === B.netherrack).length;
    if (open === 1 && solid === 3) cells[i] = B.lava;
  }
}

/** Bedrock: ragged floor (y 0–4) and ceiling (y 123–127), full-height walls on the region's inside faces. */
function seal(s: Seeds, cells: Uint16Array, x0: number, z0: number) {
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const x = x0 + lx, z = z0 + lz, wall = x === WALL_X || z === WALL_Z;
    for (let y = 0; y <= 4; y++) cells[localIndex(lx, y, lz)] = wall || y === 0 || rand3(s.bedrock, x, y, z) < 1 - y * 0.2 ? B.bedrock : B.netherrack;
    for (let y = 123; y <= 127; y++) cells[localIndex(lx, y, lz)] = wall || y === 127 || rand3(s.bedrock, x, y, z) < (y - 122) * 0.2 ? B.bedrock : B.netherrack;
    if (wall) for (let y = 5; y <= 122; y++) cells[localIndex(lx, y, lz)] = B.bedrock;
  }
}
