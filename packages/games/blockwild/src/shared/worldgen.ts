/**
 * Deterministic terrain: a pure function of (seed, cx, cz) shared by the server and the browser mesher.
 *
 * Pipeline per chunk:
 * 1. Column shape (18×18 including a 1-block border): continentalness, erosion and ridge noise shape
 *    oceans, plains, hills and mountains; rivers carve valleys; temperature/humidity pick the biome.
 *    Height depends only on continuous noise, so biome borders never form cliffs.
 * 2. Caves: noodle tunnels and cheese caverns from 3D noise sampled on a 4-block lattice and
 *    interpolated, plus rare ravines. Deep caves below y=10 are flooded with lava (mostly) or water.
 * 3. Ores by depth (emeralds in mountains), rare lava lakes in deserts and mountains, trees from this chunk
 *    and its eight neighbours (so canopies never cut at borders), then ground decorations.
 *
 * The sealed Nether corner (see nether.ts) has its own generator; the overworld around it is deep ocean.
 *
 * Only + - * /, Math.floor/sqrt/abs/min/max and integer hashes are used (see noise.ts).
 */
import { B } from './blocks';
import { CHUNK, HEIGHT, NETHER, SEA_LEVEL, SEED_CACHE, SPAWN_X, SPAWN_Z, WORLD } from './constants';
import { CHUNK_CELLS } from './chunk';
import { localIndex, type Vec3 } from './coords';
import { clamp, createRng, curve, fbm2, hash3, lerp, rand2, rand3, ridged2, rngInt, simplex3, smoothstep, subSeed, type Rng } from './noise';
import { generateNetherChunk, isNetherChunk } from './nether';
import { paintStructures, structuresNear } from './structures/index';
import { growTree, TREE_RADIUS, treeCanReplace, type TreeKind } from './trees';

export { growTree, saplingTree, treeCanReplace, type TreeKind } from './trees';

export const BIOME_NAMES = ['ocean', 'deep_ocean', 'beach', 'river', 'plains', 'forest', 'birch_forest', 'taiga', 'snowy_tundra', 'desert', 'mountains', 'snowy_peaks'] as const;
export type BiomeName = typeof BIOME_NAMES[number];
/** Display label plus suggested grass, foliage and water tints (0xRRGGBB) for renderers that tint by biome. */
export const BIOMES: Record<BiomeName, { label: string; grass: number; foliage: number; water: number }> = {
  ocean: { label: 'Ocean', grass: 0x8eb971, foliage: 0x71a74d, water: 0x3f76e4 },
  deep_ocean: { label: 'Deep Ocean', grass: 0x8eb971, foliage: 0x71a74d, water: 0x2f5fc4 },
  beach: { label: 'Beach', grass: 0x91bd59, foliage: 0x77ab2f, water: 0x3f9fe4 },
  river: { label: 'River', grass: 0x8eb971, foliage: 0x71a74d, water: 0x3f76e4 },
  plains: { label: 'Plains', grass: 0x91bd59, foliage: 0x77ab2f, water: 0x3f76e4 },
  forest: { label: 'Forest', grass: 0x79c05a, foliage: 0x59ae30, water: 0x3f76e4 },
  birch_forest: { label: 'Birch Forest', grass: 0x88bb67, foliage: 0x6ba941, water: 0x3f76e4 },
  taiga: { label: 'Taiga', grass: 0x86b783, foliage: 0x68a464, water: 0x287082 },
  snowy_tundra: { label: 'Snowy Tundra', grass: 0x80b497, foliage: 0x60a17b, water: 0x3d57d6 },
  desert: { label: 'Desert', grass: 0xbfb755, foliage: 0xaea42a, water: 0x32a598 },
  mountains: { label: 'Mountains', grass: 0x8ab689, foliage: 0x6da36b, water: 0x3f76e4 },
  snowy_peaks: { label: 'Snowy Peaks', grass: 0x80b497, foliage: 0x60a17b, water: 0x3d57d6 },
};
const BIOME = Object.fromEntries(BIOME_NAMES.map((name, i) => [name, i])) as Record<BiomeName, number>;

/** Cells at or below this height inside caves hold lava or water instead of air. */
const CAVE_WATER = 9;
const SNOW_LINE = 109;
const TREE_LINE = 100;

type Seeds = {
  warpX: number; warpZ: number; cont: number; eros: number; ridge: number; hill: number; detail: number; river: number;
  temp: number; humid: number; jitter: number; entrance: number; ravine: number; ravineMask: number; tunnelA: number;
  tunnelB: number; tunnelC: number; tunnelD: number; tunnelW: number; cavern: number; patch: number; soil: number;
  flower: number; flowerKind: number; decor: number; trees: number; forest: number; ores: number; bedrock: number; lake: number; lava: number;
};
/** A tree root: the trunk starts at (x, y, z); `seed` seeds its Rng. */
export type TreeSpot = { kind: TreeKind; x: number; y: number; z: number; seed: number };
type Tree = TreeSpot;
type Context = Seeds & { treeCache: Map<number, readonly Tree[]> };

const contexts = new Map<number, Context>();
function context(seed: number): Context {
  let ctx = contexts.get(seed);
  if (ctx) return ctx;
  const names = ['warpX', 'warpZ', 'cont', 'eros', 'ridge', 'hill', 'detail', 'river', 'temp', 'humid', 'jitter', 'entrance', 'ravine', 'ravineMask',
    'tunnelA', 'tunnelB', 'tunnelC', 'tunnelD', 'tunnelW', 'cavern', 'patch', 'soil', 'flower', 'flowerKind', 'decor', 'trees', 'forest', 'ores', 'bedrock', 'lake', 'lava'] as const;
  const seeds = Object.fromEntries(names.map((name, i) => [name, subSeed(seed, i + 1)])) as Seeds;
  ctx = { ...seeds, treeCache: new Map() };
  if (contexts.size >= SEED_CACHE) contexts.delete(contexts.keys().next().value!);
  contexts.set(seed, ctx);
  return ctx;
}

// ---------------------------------------------------------------------------------------------
// Columns

/** Base height by continentalness: deep ocean, shelf, coast, lowlands, uplands. */
const CONTINENT: readonly (readonly [number, number])[] = [
  [-1, 30], [-0.55, 36], [-0.3, 46], [-0.17, 55], [-0.1, 60], [-0.05, 62.5], [0, 64], [0.15, 67], [0.35, 72], [0.6, 80], [1, 86],
];

type Column = { h: number; biome: number; temp: number; humid: number };
const scratch: Column = { h: 0, biome: 0, temp: 0, humid: 0 };

/** Shapes one column. Writes height, biome index, temperature and humidity into `out`. */
function column(ctx: Context, x: number, z: number, out: Column): Column {
  const wx = x + fbm2(ctx.warpX, x, z, 500, 2) * 80, wz = z + fbm2(ctx.warpZ, x, z, 500, 2) * 80;
  let c = fbm2(ctx.cont, wx, wz, 1300, 5) * 1.5;
  // A guaranteed continent around spawn and open ocean along the world rim.
  const sx = (x - SPAWN_X) / 550, sz = (z - SPAWN_Z) / 550;
  c += 0.3 * clamp(1 - (sx * sx + sz * sz));
  c -= 1.4 * (1 - smoothstep(32, 240, Math.min(x, z, WORLD - 1 - x, WORLD - 1 - z)));
  // Deep ocean around the sealed Nether corner, so nobody stumbles onto its bedrock wall.
  const nx = Math.max(0, NETHER.x0 - x), nz = Math.max(0, z - (NETHER.z0 + NETHER.size - 1));
  c -= 1.6 * (1 - smoothstep(48, 280, Math.sqrt(nx * nx + nz * nz)));

  const e = fbm2(ctx.eros, wx, wz, 900, 3) * 1.4;
  const land = smoothstep(-0.1, 0.06, c);
  const ridge = ridged2(ctx.ridge, wx, wz, 300, 5, 0.5);
  const mountain = smoothstep(0.02, 0.4, c) * smoothstep(-0.12, -0.55, e);
  const temp = clamp(fbm2(ctx.temp, x, z, 1100, 3) * 1.9 + fbm2(ctx.jitter, x, z, 60, 3) * 0.12, -1, 1);
  const humid = clamp(fbm2(ctx.humid, x, z, 900, 3) * 1.9 + fbm2(ctx.jitter + 1, x, z, 60, 3) * 0.12, -1, 1);
  const dune = smoothstep(0.35, 0.5, temp) * smoothstep(-0.1, -0.25, humid) * land;

  const hillAmp = lerp(2.5, 15, smoothstep(0.35, -0.35, e)) * land * land * (1 - 0.7 * dune);
  let h = curve(CONTINENT, c)
    + fbm2(ctx.hill, x, z, 170, 4) * hillAmp
    + fbm2(ctx.detail, x, z, 36, 2) * (0.6 + 1.2 * land)
    + mountain * (4 + ridge * ridge * 80)
    + (1 - Math.abs(fbm2(ctx.detail + 7, x, z * 0.55, 34, 1))) * 3.5 * dune;

  // Lowland lakes: shallow basins that fill to sea level.
  const lake = smoothstep(0.5, 0.68, fbm2(ctx.lake, x, z, 200, 3)) * land * (1 - smoothstep(66, 78, h)) * (1 - dune);
  if (lake > 0) h = lerp(h, SEA_LEVEL - 4, lake);

  // Rivers: zero lines of a warped noise field, fading out in the high mountains.
  const rv = Math.abs(fbm2(ctx.river, wx * 0.8 + wz * 0.2, wz, 560, 2, 0.4));
  const strength = land * (1 - smoothstep(0.35, 0.8, mountain));
  let river = false;
  if (strength > 0 && h > SEA_LEVEL - 2) {
    const channel = 0.02, valley = 0.075 + 0.05 * mountain;
    let target = h;
    if (rv < channel) target = SEA_LEVEL - 1.5 - 4 * (1 - rv / channel);
    else if (rv < valley) target = lerp(SEA_LEVEL + 0.5, h, smoothstep(channel, valley, rv));
    h = lerp(h, target, strength);
    river = rv < channel * 1.2 && strength > 0.5;
  }
  if (h > 110) h = 110 + (h - 110) * 0.45;
  const height = Math.floor(Math.min(h, HEIGHT - 6));

  const cold = temp - Math.max(0, height - 90) * 0.02;
  let biome: number;
  if (height < SEA_LEVEL - 1 && c < -0.05) biome = height < 44 ? BIOME.deep_ocean : BIOME.ocean;
  else if (river) biome = BIOME.river;
  else if (height <= SEA_LEVEL + 2 && c < 0.02 && mountain < 0.2) biome = BIOME.beach;
  else if (mountain > 0.35 && height > 84) biome = height >= SNOW_LINE - 3 ? BIOME.snowy_peaks : BIOME.mountains;
  else if (cold < -0.55) biome = BIOME.snowy_tundra;
  else if (cold < -0.25) biome = BIOME.taiga;
  else if (temp > 0.35 && humid < -0.1) biome = BIOME.desert;
  else if (humid > 0.4 && temp < 0.3) biome = BIOME.birch_forest;
  else if (humid > 0.08) biome = BIOME.forest;
  else biome = BIOME.plains;
  out.h = height;
  out.biome = biome;
  out.temp = cold;
  out.humid = humid;
  return out;
}

/** Height of the top terrain block (before caves carve it), which may be below sea level. */
export function surfaceHeight(seed: number, x: number, z: number): number {
  return column(context(seed), Math.floor(x), Math.floor(z), scratch).h;
}
export function biomeAt(seed: number, x: number, z: number): BiomeName {
  return BIOME_NAMES[column(context(seed), Math.floor(x), Math.floor(z), scratch).biome]!;
}

// ---------------------------------------------------------------------------------------------
// Caves

/** Values stored per cave lattice point: two noise pairs whose shared zero lines are tunnels, tunnel width, cavern density. */
const LK = 6;
/**
 * Cave noise at a lattice point (4-block spacing). The raw noise components are stored and interpolated
 * separately (see `tunnelAt`), so tunnel cross-sections stay round instead of breaking into lattice slivers.
 */
function lattice(ctx: Context, gx: number, gy: number, gz: number, out: Float64Array, at: number) {
  const x = gx * 4, y = gy * 4, z = gz * 4;
  out[at] = simplex3(ctx.tunnelA, x / 85, y / 60, z / 85);
  out[at + 1] = simplex3(ctx.tunnelB, x / 85, y / 60, z / 85);
  out[at + 2] = simplex3(ctx.tunnelC, x / 130, y / 80, z / 130);
  out[at + 3] = simplex3(ctx.tunnelD, x / 130, y / 80, z / 130);
  out[at + 4] = 0.11 + 0.04 * simplex3(ctx.tunnelW, x / 160, y / 90, z / 160);
  out[at + 5] = (simplex3(ctx.cavern, x / 110, y / 70, z / 110) * 2 + simplex3(ctx.cavern + 1, x / 40, y / 30, z / 40)) / 3;
}
function trilerp(v: Float64Array, i000: number, sx: number, sy: number, sz: number, fx: number, fy: number, fz: number) {
  const c00 = lerp(v[i000]!, v[i000 + sx]!, fx), c10 = lerp(v[i000 + sy]!, v[i000 + sx + sy]!, fx);
  const c01 = lerp(v[i000 + sz]!, v[i000 + sx + sz]!, fx), c11 = lerp(v[i000 + sy + sz]!, v[i000 + sx + sy + sz]!, fx);
  return lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz);
}
/** Tunnel field at a point inside a lattice cell: positive inside a tunnel, 1 on its centre line. */
function tunnelAt(v: Float64Array, at: number, sx: number, sy: number, sz: number, fx: number, fy: number, fz: number) {
  const a = trilerp(v, at, sx, sy, sz, fx, fy, fz), b = trilerp(v, at + 1, sx, sy, sz, fx, fy, fz);
  const c = trilerp(v, at + 2, sx, sy, sz, fx, fy, fz), d = trilerp(v, at + 3, sx, sy, sz, fx, fy, fz);
  const w = trilerp(v, at + 4, sx, sy, sz, fx, fy, fz);
  return 1 - Math.min(a * a + b * b, (c * c + d * d) * 1.6) / (w * w);
}
/** Minimum tunnel value needed to carve `depth` blocks below the surface: tunnels only break through at entrances. */
const tunnelNeed = (depth: number, entrance: number) => depth < 5 ? (1 - entrance) * (5 - depth) * 0.4 : 0;
function cavernNeed(y: number) {
  return 0.5 + 0.7 * smoothstep(34, 54, y) + 0.7 * (1 - smoothstep(5, 13, y));
}
const entranceAt = (ctx: Context, x: number, z: number) => smoothstep(0.35, 0.65, fbm2(ctx.entrance, x, z, 110, 2));

type Ravine = { dist: number; width: number; bottom: number };
function ravineAt(ctx: Context, x: number, z: number, out: Ravine): Ravine {
  const mask = fbm2(ctx.ravineMask, x, z, 700, 2);
  out.width = mask > 0.48 ? 0.04 * smoothstep(0.48, 0.56, mask) : 0;
  out.dist = out.width ? Math.abs(fbm2(ctx.ravine, x, z, 190, 2, 0.3)) : 1;
  out.bottom = 16 + Math.floor(fbm2(ctx.ravine + 1, x, z, 60, 1) * 6);
  return out;
}
const ravineCarves = (r: Ravine, y: number) => y >= r.bottom && r.dist < r.width * Math.min(1, (y - r.bottom + 2) / 9);
const ravineScratch: Ravine = { dist: 1, width: 0, bottom: 0 };

/**
 * Conservative, chunk-independent test that caves leave the surface block at (x, h, z) in place.
 * It ignores the "keep a roof under water" rule, which only ever prevents carving.
 */
function surfaceIntact(ctx: Context, x: number, z: number, h: number): boolean {
  if (ravineCarves(ravineAt(ctx, x, z, ravineScratch), h)) return false;
  const entrance = entranceAt(ctx, x, z), need = tunnelNeed(0, entrance);
  if (need >= 1) return true;
  const gx = Math.floor(x / 4), gy = Math.floor(h / 4), gz = Math.floor(z / 4), v = new Float64Array(8 * LK);
  for (let i = 0; i < 8; i++) lattice(ctx, gx + (i & 1), gy + (i >> 1 & 1), gz + (i >> 2), v, i * LK);
  return tunnelAt(v, 0, LK, 2 * LK, 4 * LK, (x - gx * 4) / 4, (h - gy * 4) / 4, (z - gz * 4) / 4) <= need;
}

// ---------------------------------------------------------------------------------------------
// Trees

function treeDensity(biome: number, humid: number, forest: number) {
  const temperate = 0.015 + 0.5 * smoothstep(-0.1, 0.2, humid) * (0.25 + 0.75 * forest);
  switch (biome) {
    case BIOME.plains: return 0.02;
    case BIOME.forest: case BIOME.birch_forest: return temperate;
    case BIOME.taiga: return 0.45 * (0.35 + 0.65 * forest);
    case BIOME.snowy_tundra: return 0.035;
    case BIOME.mountains: return 0.07;
    default: return 0;
  }
}
function treeKind(biome: number, roll: number, h: number): TreeKind {
  switch (biome) {
    case BIOME.plains: return roll < 0.55 ? 'oak' : roll < 0.8 ? 'bush' : 'fancy_oak';
    case BIOME.forest: return roll < 0.6 ? 'oak' : roll < 0.68 ? 'fancy_oak' : roll < 0.94 ? 'birch' : 'bush';
    case BIOME.birch_forest: return roll < 0.7 ? 'birch' : roll < 0.95 ? 'tall_birch' : 'oak';
    case BIOME.mountains: return h > 88 || roll < 0.6 ? 'spruce' : roll < 0.8 ? 'pine' : 'oak';
    default: return roll < 0.7 ? 'spruce' : 'pine';
  }
}

/** Trees rooted in a chunk: one candidate per 4×4 cell, kept by biome density. Pure and cached per seed. */
function chunkTrees(ctx: Context, cx: number, cz: number): readonly Tree[] {
  const key = cx * 65536 + cz, hit = ctx.treeCache.get(key);
  if (hit) return hit;
  const trees: Tree[] = [];
  for (let cell = 0; cell < 16; cell++) {
    const r = hash3(ctx.trees, cx * 4 + (cell & 3), cz * 4 + (cell >> 2), 11);
    const x = cx * CHUNK + (cell & 3) * 4 + r % 3, z = cz * CHUNK + (cell >> 2) * 4 + (r >>> 4) % 3;
    const col = column(ctx, x, z, scratch);
    if (col.h <= SEA_LEVEL || col.h >= TREE_LINE) continue;
    const forest = smoothstep(-0.45, 0.15, fbm2(ctx.forest, x, z, 110, 2));
    if ((r >>> 8 & 1023) / 1024 >= treeDensity(col.biome, col.humid, forest)) continue;
    const kind = treeKind(col.biome, (r >>> 18 & 1023) / 1024, col.h);
    if (!surfaceIntact(ctx, x, z, col.h)) continue;
    trees.push({ kind, x, y: col.h + 1, z, seed: hash3(ctx.trees, x, col.h, z) });
  }
  if (ctx.treeCache.size >= 2048) ctx.treeCache.delete(ctx.treeCache.keys().next().value!);
  ctx.treeCache.set(key, trees);
  return trees;
}

/** Tree roots whose canopy may reach chunk (cx, cz), in a fixed global order. */
export function treesNear(seed: number, cx: number, cz: number): readonly TreeSpot[] {
  const ctx = context(seed), x0 = cx * CHUNK, z0 = cz * CHUNK, out: Tree[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    for (const tree of chunkTrees(ctx, cx + dx, cz + dz)) {
      if (tree.x >= x0 - TREE_RADIUS && tree.x < x0 + CHUNK + TREE_RADIUS && tree.z >= z0 - TREE_RADIUS && tree.z < z0 + CHUNK + TREE_RADIUS) out.push(tree);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ores

type Ore = { id: number; attempts: number; min: number; max: number; size: [number, number] };
export const ORES: readonly Ore[] = [
  { id: B.coal_ore, attempts: 22, min: 5, max: 110, size: [6, 16] },
  { id: B.iron_ore, attempts: 12, min: 5, max: 64, size: [4, 9] },
  { id: B.gold_ore, attempts: 2, min: 5, max: 32, size: [2, 7] },
  { id: B.diamond_ore, attempts: 1, min: 5, max: 16, size: [2, 8] },
  { id: B.gravel, attempts: 5, min: 5, max: 90, size: [12, 30] },
  { id: B.dirt, attempts: 5, min: 5, max: 90, size: [12, 30] },
];
function placeOres(cells: Uint16Array, rng: Rng) {
  for (const ore of ORES) for (let a = 0; a < ore.attempts; a++) {
    let x = rngInt(rng, 1, 14), y = rngInt(rng, ore.min, ore.max), z = rngInt(rng, 1, 14);
    const size = rngInt(rng, ore.size[0], ore.size[1]);
    for (let s = 0; s < size; s++) {
      const i = localIndex(x, y, z);
      if (cells[i] === B.stone) cells[i] = ore.id;
      const step = Math.floor(rng() * 6), dir = step & 1 ? 1 : -1;
      if (step < 2) x = Math.min(15, Math.max(0, x + dir));
      else if (step < 4) y = Math.min(ore.max, Math.max(ore.min, y + dir));
      else z = Math.min(15, Math.max(0, z + dir));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Chunk generation

const GRID = CHUNK + 2;
const gridH = new Int32Array(GRID * GRID), gridBiome = new Uint8Array(GRID * GRID), gridTemp = new Float64Array(GRID * GRID);
const gridHumid = new Float64Array(GRID * GRID);
const FLOWERS = [B.dandelion, B.poppy, B.cornflower];
const FLOWERY = new Set([BIOME.plains, BIOME.forest, BIOME.birch_forest]);

export function generateChunk(seed: number, cx: number, cz: number): Uint16Array {
  if (isNetherChunk(cx, cz)) return generateNetherChunk(seed, cx, cz);
  const ctx = context(seed), cells = new Uint16Array(CHUNK_CELLS), x0 = cx * CHUNK, z0 = cz * CHUNK;

  let maxH = SEA_LEVEL;
  for (let gz = 0; gz < GRID; gz++) for (let gx = 0; gx < GRID; gx++) {
    const col = column(ctx, x0 + gx - 1, z0 + gz - 1, scratch), g = gx + gz * GRID;
    gridH[g] = col.h;
    gridBiome[g] = col.biome;
    gridTemp[g] = col.temp;
    gridHumid[g] = col.humid;
    maxH = Math.max(maxH, col.h);
  }

  // Cave lattice covering this chunk: 5 × 5 columns × ny levels, LK values each.
  const ny = (maxH >> 2) + 2, sz = 5 * LK, sy = 25 * LK, cave = new Float64Array(25 * ny * LK);
  for (let gy = 0; gy < ny; gy++) for (let gz = 0; gz < 5; gz++) for (let gx = 0; gx < 5; gx++) {
    lattice(ctx, (x0 >> 2) + gx, gy, (z0 >> 2) + gz, cave, gx * LK + gz * sz + gy * sy);
  }

  const ravine: Ravine = { dist: 1, width: 0, bottom: 0 };
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const x = x0 + lx, z = z0 + lz, g = lx + 1 + (lz + 1) * GRID, h = gridH[g]!, biome = gridBiome[g]!;
    let slope = 0, hmin = h;
    for (const n of [g - 1, g + 1, g - GRID, g + GRID, g - GRID - 1, g - GRID + 1, g + GRID - 1, g + GRID + 1]) {
      const nh = gridH[n]!;
      hmin = Math.min(hmin, nh);
      if (n === g - 1 || n === g + 1 || n === g - GRID || n === g + GRID) slope = Math.max(slope, Math.abs(nh - h));
    }
    const [top, sub, deep, soil] = surface(ctx, x, z, h, biome, slope, gridTemp[g]!);
    const entrance = entranceAt(ctx, x, z);
    ravineAt(ctx, x, z, ravine);
    const roof = hmin <= SEA_LEVEL ? hmin - 3 : HEIGHT, flood = fbm2(ctx.lava, x, z, 150, 2) > -0.35 ? B.lava : B.water;
    const fx = (lx & 3) / 4, fz = (lz & 3) / 4, base = (lx >> 2) * LK + (lz >> 2) * sz;

    cells[localIndex(lx, 0, lz)] = B.bedrock;
    for (let y = 1; y <= h; y++) {
      const i = localIndex(lx, y, lz);
      if (y <= 3 && rand3(ctx.bedrock, x, y, z) < 1 - y * 0.25) {
        cells[i] = B.bedrock;
        continue;
      }
      const depth = h - y;
      if (y >= 4 && y < roof) {
        let carve = ravine.width > 0 && ravineCarves(ravine, y);
        if (!carve) {
          const need = tunnelNeed(depth, entrance);
          const at = base + (y >> 2) * sy, fy = (y & 3) / 4;
          carve = need < 1 && tunnelAt(cave, at, LK, sy, sz, fx, fy, fz) > need;
          if (!carve && depth > 8) carve = trilerp(cave, at + 5, LK, sy, sz, fx, fy, fz) > cavernNeed(y);
        }
        if (carve) {
          cells[i] = y <= CAVE_WATER ? flood : B.air;
          continue;
        }
      }
      cells[i] = depth === 0 ? top : depth < soil ? sub : depth < soil + 3 ? deep : B.stone;
    }
    if (h < SEA_LEVEL) {
      for (let y = h + 1; y <= SEA_LEVEL; y++) cells[localIndex(lx, y, lz)] = B.water;
      if (gridTemp[g]! + fbm2(ctx.jitter + 2, x, z, 10, 1) * 0.08 < -0.5) cells[localIndex(lx, SEA_LEVEL, lz)] = B.ice;
    }
  }

  placeOres(cells, createRng(hash3(ctx.ores, cx, cz, 3)));
  placeEmeralds(cells, createRng(hash3(ctx.ores, cx, cz, 9)));
  lavaLake(ctx, seed, cells, cx, cz);

  for (const tree of treesNear(seed, cx, cz)) {
    growTree(tree.kind, tree.x, tree.y, tree.z, createRng(tree.seed), (x, y, z, cell) => {
      const lx = x - x0, lz = z - z0;
      if (lx < 0 || lz < 0 || lx >= CHUNK || lz >= CHUNK) return;
      const i = localIndex(lx, y, lz);
      if (treeCanReplace(cells[i]!, cell)) cells[i] = cell;
    });
  }

  decorate(ctx, cells, x0, z0);
  paintStructures(seed, cx, cz, cells);
  return cells;
}

const isMountain = (biome: number) => biome === BIOME.mountains || biome === BIOME.snowy_peaks;
/** Mountains hide single emerald ores in their stone (y 5–100). */
function placeEmeralds(cells: Uint16Array, rng: Rng) {
  for (let a = rngInt(rng, 3, 8); a > 0; a--) {
    const lx = rngInt(rng, 0, 15), lz = rngInt(rng, 0, 15), y = rngInt(rng, 5, 100), i = localIndex(lx, y, lz);
    if (isMountain(gridBiome[lx + 1 + (lz + 1) * GRID]!) && cells[i] === B.stone) cells[i] = B.emerald_ore;
  }
}

/**
 * About one chunk in 16 of desert or mountains tries for a small lava lake: a basin inside the chunk at the lowest ground
 * of its rim, sealed with stone where caves opened it, and skipped near trees, villages and temples or on steep ground.
 */
function lavaLake(ctx: Context, seed: number, cells: Uint16Array, cx: number, cz: number) {
  const r = hash3(ctx.lava, cx, cz, 1);
  if (r % 16 !== 0) return;
  const lx = 5 + (r >>> 8) % 6, lz = 5 + (r >>> 12) % 6, radius = 2.5 + (r >>> 16) % 2, biome = gridBiome[lx + 1 + (lz + 1) * GRID]!;
  if (biome !== BIOME.desert && biome !== BIOME.mountains) return;
  const reach = Math.ceil(radius) + 1, footprint: [number, number, boolean][] = [];
  let level = HEIGHT, top = 0;
  for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
    const d2 = dx * dx + dz * dz, h = gridH[lx + dx + 1 + (lz + dz + 1) * GRID]!;
    if (d2 > (radius + 1) * (radius + 1)) continue;
    footprint.push([lx + dx, lz + dz, d2 <= radius * radius]);
    level = Math.min(level, h);
    top = Math.max(top, h);
  }
  const x = cx * CHUNK + lx, z = cz * CHUNK + lz;
  if (level <= SEA_LEVEL + 1 || top - level > 6 || treesNear(seed, cx, cz).some(t => Math.abs(t.x - x) <= reach + 2 && Math.abs(t.z - z) <= reach + 2)) return;
  if (structuresNear(seed, x, z, reach + 4).some(s => s.kind !== 'mineshaft')) return;
  for (const [px, pz, inside] of footprint) {
    const deep = (px - lx) * (px - lx) + (pz - lz) * (pz - lz) <= (radius - 1.5) * (radius - 1.5) ? 2 : 1;
    for (let y = level - deep; y <= level; y++) {
      const i = localIndex(px, y, pz);
      if (inside && y > level - deep) cells[i] = B.lava;
      else if (cells[i] === B.air || cells[i] === B.water) cells[i] = B.stone;
    }
    if (inside) for (let y = level + 1; y <= gridH[px + 1 + (pz + 1) * GRID]!; y++) cells[localIndex(px, y, pz)] = B.air;
  }
}

/** Surface block, sub-surface block, the layer under that, and sub-surface depth for a column. */
function surface(ctx: Context, x: number, z: number, h: number, biome: number, slope: number, temp: number): [number, number, number, number] {
  const patch = fbm2(ctx.patch, x, z, 26, 2), soil = 3 + (rand2(ctx.soil, x, z) < 0.5 ? 1 : 0);
  if (h < SEA_LEVEL) {
    const depth = SEA_LEVEL - h;
    if (depth <= 6 && patch > 0.4) return [B.clay, B.clay, B.dirt, 2];
    if (patch < -0.35 || (depth > 14 && patch < 0.2)) return [B.gravel, B.gravel, B.stone, 2];
    return [B.sand, B.sand, B.sandstone, soil];
  }
  if (biome === BIOME.desert) return [B.sand, B.sand, B.sandstone, soil + 1];
  if (biome === BIOME.beach || biome === BIOME.river) {
    if (slope >= 3 || patch < -0.45) return [B.gravel, B.gravel, B.stone, 2];
    return [B.sand, B.sand, B.sandstone, soil];
  }
  const mountain = isMountain(biome);
  const snowy = h + fbm2(ctx.jitter + 3, x, z, 12, 1) * 4 >= SNOW_LINE;
  if (slope >= (mountain && h > 92 ? 2 : 3)) return snowy && h >= SNOW_LINE + 6 && slope < 4 ? [B.snow_block, B.stone, B.stone, 1] : [B.stone, B.stone, B.stone, 1];
  if (snowy) return [B.snow_block, B.snow_block, B.dirt, 2];
  if (mountain && patch < -0.5) return [B.gravel, B.gravel, B.stone, 2];
  if (biome === BIOME.snowy_tundra || temp < -0.5 || (mountain && h > SNOW_LINE - 4)) return [B.snowy_grass, B.dirt, B.stone, soil];
  return [B.grass_block, B.dirt, B.stone, soil];
}

/** Ground cover for this chunk's own columns (runs after trees, only into empty air). */
function decorate(ctx: Context, cells: Uint16Array, x0: number, z0: number) {
  const pumpkin = rand2(ctx.decor + 5, x0, z0) < 0.05, melon = rand2(ctx.decor + 6, x0, z0) < 0.04;
  const px = 3 + (hash3(ctx.decor, x0, z0, 7) % 10), pz = 3 + (hash3(ctx.decor, x0, z0, 8) % 10);
  if (rand2(ctx.decor + 7, x0, z0) < 0.2) boulder(ctx, cells, px, pz, x0, z0);
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const x = x0 + lx, z = z0 + lz, g = lx + 1 + (lz + 1) * GRID, h = gridH[g]!, biome = gridBiome[g]!;
    if (h < SEA_LEVEL || h >= HEIGHT - 4) continue;
    const ground = cells[localIndex(lx, h, lz)]!, above = localIndex(lx, h + 1, lz);
    if (cells[above] !== B.air) continue;
    const r = rand2(ctx.decor, x, z), grass = ground === B.grass_block || ground === B.snowy_grass;

    // Sugar cane on the shore: ground at sea level beside open water.
    if (h === SEA_LEVEL && ground !== B.gravel && ground !== B.clay && gridTemp[g]! > -0.4 && r < 0.22
      && (gridH[g - 1]! < SEA_LEVEL || gridH[g + 1]! < SEA_LEVEL || gridH[g - GRID]! < SEA_LEVEL || gridH[g + GRID]! < SEA_LEVEL)
      && fbm2(ctx.flower + 9, x, z, 20, 1) > -0.1) {
      stack(cells, lx, h + 1, lz, B.sugar_cane, 1 + hash3(ctx.decor, x, z, 2) % 3);
      continue;
    }
    if (ground === B.sand && biome === BIOME.desert) {
      if (cactusAt(ctx, x, z) && [g - 1, g + 1, g - GRID, g + GRID].every(n => gridH[n]! <= h)
        && !cactusAt(ctx, x - 1, z) && !cactusAt(ctx, x + 1, z) && !cactusAt(ctx, x, z - 1) && !cactusAt(ctx, x, z + 1)) {
        stack(cells, lx, h + 1, lz, B.cactus, 1 + hash3(ctx.decor, x, z, 3) % 3);
      } else if (r < 0.012) cells[above] = B.dead_bush;
      continue;
    }
    if (!grass) continue;

    const dx = lx - px, dz = lz - pz, near = dx * dx + dz * dz <= 8;
    if (pumpkin && near && r < 0.25 && (biome === BIOME.plains || biome === BIOME.forest || biome === BIOME.taiga)) {
      cells[above] = B.pumpkin | ((hash3(ctx.decor, x, z, 4) & 3) << 8);
      continue;
    }
    if (melon && near && r < 0.3 && biome === BIOME.forest) {
      cells[above] = B.melon;
      continue;
    }
    if (FLOWERY.has(biome)) {
      const flower = flowerAt(ctx, x, z, biome === BIOME.plains ? 0.4 : biome === BIOME.birch_forest ? 0.3 : 0.22);
      if (flower || r < 0.004) {
        cells[above] = flower || FLOWERS[hash3(ctx.flowerKind, x, z, 2) % 3]!;
        continue;
      }
    }
    const lush = gridHumid[g]! * 0.1;
    let grassChance = 0, fernChance = 0;
    if (biome === BIOME.plains) grassChance = 0.3 + lush;
    else if (biome === BIOME.forest || biome === BIOME.birch_forest) grassChance = 0.16 + lush;
    else if (biome === BIOME.taiga) { grassChance = 0.1; fernChance = 0.14; }
    else if (biome === BIOME.snowy_tundra) grassChance = 0.02;
    else if (biome === BIOME.mountains) { grassChance = 0.1; fernChance = 0.03; }
    if (r < fernChance) cells[above] = B.fern;
    else if (r < fernChance + grassChance) cells[above] = B.short_grass;
  }
}
/**
 * Flower meadows: at most one cluster per 11×11 grid cell (kept with probability `chance`), a jittered centre,
 * radius 2–4 and thinning toward the rim. Most clusters are a single kind; some mix in a second.
 */
function flowerAt(ctx: Context, x: number, z: number, chance: number): number {
  const gx = Math.floor(x / 11), gz = Math.floor(z / 11);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const h = hash3(ctx.flower, gx + dx, gz + dz, 1);
    if ((h & 1023) / 1024 >= chance) continue;
    const ox = x - (gx + dx) * 11 - (h >>> 10) % 11, oz = z - (gz + dz) * 11 - (h >>> 14) % 11, r = 2 + (h >>> 18) % 3;
    const d = (ox * ox + oz * oz) / (r * r);
    if (d > 1 || rand2(ctx.flower + 1, x, z) > 0.8 - 0.5 * d) continue;
    const kind = hash3(ctx.flowerKind, gx + dx, gz + dz, 0), mixed = kind & 4 && rand2(ctx.flower + 2, x, z) < 0.3;
    return FLOWERS[(kind % 3 + (mixed ? 1 : 0)) % 3]!;
  }
  return 0;
}
/** Mossy boulder on flat taiga ground, centred on a chunk-local column. */
function boulder(ctx: Context, cells: Uint16Array, lx: number, lz: number, x0: number, z0: number) {
  const g = lx + 1 + (lz + 1) * GRID, h = gridH[g]!;
  if (gridBiome[g] !== BIOME.taiga || h <= SEA_LEVEL || cells[localIndex(lx, h, lz)] !== B.grass_block) return;
  if ([g - 1, g + 1, g - GRID, g + GRID].some(n => Math.abs(gridH[n]! - h) > 1)) return;
  for (let dy = 0; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const r = rand3(ctx.decor + 8, x0 + lx + dx, h + dy, z0 + lz + dz), at = localIndex(lx + dx, h + dy, lz + dz);
    if (dx * dx + dz * dz + dy * dy * 2 > 3.5 + r * 1.5 || cells[at] !== B.air) continue;
    cells[at] = r < 0.7 ? B.mossy_cobblestone : B.cobblestone;
  }
}
const cactusAt = (ctx: Context, x: number, z: number) => rand2(ctx.decor + 3, x, z) < 0.006;
function stack(cells: Uint16Array, lx: number, y: number, lz: number, id: number, count: number) {
  for (let i = 0; i < count && y + i < HEIGHT; i++) {
    const at = localIndex(lx, y + i, lz);
    if (cells[at] !== B.air) return;
    cells[at] = id;
  }
}

// ---------------------------------------------------------------------------------------------
// Spawn

const SPAWN_GROUND = new Set<number>([B.grass_block, B.sand, B.snowy_grass]);
const SPAWN_BIOMES = new Set([BIOME.plains, BIOME.forest, BIOME.birch_forest, BIOME.taiga, BIOME.snowy_tundra, BIOME.desert, BIOME.beach]);
const SPAWN_HAZARDS = new Set<number>([B.water, B.cactus, B.lava]);
/** Preferred spawns have a tree this close (players need wood first) within this search radius. */
const SPAWN_TREE = 12, SPAWN_PREFERRED = 512;

const spawns = new Map<number, Vec3>();
/**
 * World spawn, spiralling out from (SPAWN_X, SPAWN_Z): first open grass with a tree within 12 blocks, else any dry,
 * open grass or sand. Either way nothing hazardous (water, cactus) lies within 3 blocks and eye height is clear for 2.
 * Returns block coordinates [x, feetY, z] (a fresh copy; memoized per seed); stand at x + 0.5, z + 0.5.
 */
export function findSpawn(seed: number): Vec3 {
  let spawn = spawns.get(seed);
  if (!spawn) spawns.set(seed, spawn = searchSpawn(seed));
  return [spawn[0], spawn[1], spawn[2]];
}
function treeNear(ctx: Context, x: number, z: number, r: number) {
  for (let cz = (z - r) >> 4; cz <= (z + r) >> 4; cz++) for (let cx = (x - r) >> 4; cx <= (x + r) >> 4; cx++) {
    if (chunkTrees(ctx, cx, cz).some(tree => (tree.x - x) * (tree.x - x) + (tree.z - z) * (tree.z - z) <= r * r)) return true;
  }
  return false;
}
function searchSpawn(seed: number): Vec3 {
  const ctx = context(seed), chunks = new Map<number, Uint16Array>();
  const cellAt = (x: number, y: number, z: number) => {
    const key = (x >> 4) * 65536 + (z >> 4);
    let chunk = chunks.get(key);
    if (!chunk) chunks.set(key, chunk = generateChunk(seed, x >> 4, z >> 4));
    return chunk[localIndex(x & 15, y, z & 15)]!;
  };
  const open = (cell: number) => cell === B.air || cell === B.short_grass || cell === B.fern || cell === B.dandelion || cell === B.poppy || cell === B.cornflower;
  const safe = (x: number, y: number, z: number) => {
    for (let dy = -1; dy <= 2; dy++) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (SPAWN_HAZARDS.has(cellAt(x + dx, y + dy, z + dz))) return false;
    // A clearing at eye height, so the first view is not a face full of leaves or bark.
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (!open(cellAt(x + dx, y + 2, z + dz))) return false;
    return true;
  };
  /** Feet y of a good spawn at (x, z), or 0. */
  const feetAt = (x: number, z: number, preferred: boolean) => {
    const col = column(ctx, x, z, scratch), y = col.h;
    if (y <= SEA_LEVEL || y > 96 || !SPAWN_BIOMES.has(col.biome) || preferred && !treeNear(ctx, x, z, SPAWN_TREE)) return 0;
    const ground = cellAt(x, y, z), good = SPAWN_GROUND.has(ground) && !(preferred && ground === B.sand);
    return good && open(cellAt(x, y + 1, z)) && cellAt(x, y + 2, z) === B.air && safe(x, y, z) ? y + 1 : 0;
  };
  for (const [preferred, limit] of [[true, SPAWN_PREFERRED], [false, 1024]] as const) for (let r = 0; r <= limit; r += 4) for (let t = -r; t <= r; t += 4) {
    for (const [x, z] of [[SPAWN_X + t, SPAWN_Z - r], [SPAWN_X + r, SPAWN_Z + t], [SPAWN_X - t, SPAWN_Z + r], [SPAWN_X - r, SPAWN_Z - t]] as const) {
      const y = feetAt(x, z, preferred);
      if (y) return [x, y, z];
    }
  }
  return [SPAWN_X, surfaceHeight(seed, SPAWN_X, SPAWN_Z) + 1, SPAWN_Z];
}
