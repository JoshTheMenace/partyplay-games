/**
 * The End's terrain (x, z ∈ [3584, 4096)): one end stone island over the void, obsidian pillars with crystals, the exit
 * portal fountain and the arrival platform. Same cross-engine math rules as worldgen (+ - * /, floor, sqrt, integer hashes).
 *
 * Shape: a domed island of radius ≈ 96 around END_CENTER whose outline is eroded by noise, with a rounded underside that
 * hangs deep into the void at the centre. An eastern lobe always holds the arrival platform, sunk into a small cave with
 * a stairway up to the surface (so nobody arrives over the void). Ten obsidian pillars stand on a ring of radius 42,
 * each with one bedrock block on top for its crystal; the two shortest wear iron bar cages. At the centre the bedrock
 * exit portal fountain waits for the dragon to fall.
 */
import { B, makeCell } from './blocks';
import { CHUNK_CELLS } from './chunk';
import { CHUNK, END, END_ARRIVAL, END_CENTER, HEIGHT, inEnd, SEED_CACHE } from './constants';
import { localIndex, type Vec3 } from './coords';
import { createRng, fbm2, lerp, smoothstep, subSeed } from './noise';

export const isEndChunk = (cx: number, cz: number) => inEnd(cx * CHUNK, cz * CHUNK);

/** The fountain: its bowl floor is bedrock at EXIT_Y - 1; portal cells, rim and the pillar's foot are at EXIT_Y. */
export const EXIT_Y = 64;
/** The central pillar is 4 tall (EXIT_Y..EXIT_Y + 3); the dragon perches and the egg sits on top of it. */
export const PERCH_Y = EXIT_Y + 4;
/** The 20 cells of the exit portal: the 5×5 bowl with rounded corners, minus the central pillar ([dx, dz] from the centre). */
export const EXIT_PORTAL: readonly (readonly [number, number])[] = (() => {
  const cells: [number, number][] = [];
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if ((dx || dz) && !(Math.abs(dx) === 2 && Math.abs(dz) === 2)) cells.push([dx, dz]);
  return cells;
})();
/** Where 4 end crystals on the rim respawn the dragon: the middle of each side ([dx, dz]; the crystal stands on top). */
export const EXIT_RIM_SIDES: readonly (readonly [number, number])[] = [[0, -3], [3, 0], [0, 3], [-3, 0]];
const isRim = (dx: number, dz: number) => {
  const ax = Math.abs(dx), az = Math.abs(dz);
  return ax === 3 && az <= 1 || az === 3 && ax <= 1 || ax === 2 && az === 2;
};

/** Pillars stand on this ring around END_CENTER. */
export const PILLAR_RING = 42;
/** One obsidian pillar: centre column, radius, and the height of its bedrock cap (the crystal floats on top). */
export type Pillar = { x: number; z: number; r: number; top: number; caged: boolean };
// cos and sin of 0°, 36°, ... 324° written as literals so every engine agrees.
const COS = [1, 0.809017, 0.309017, -0.309017, -0.809017, -1, -0.809017, -0.309017, 0.309017, 0.809017];
const SIN = [0, 0.587785, 0.951057, 0.951057, 0.587785, 0, -0.587785, -0.951057, -0.951057, -0.587785];
const pillarCache = new Map<number, readonly Pillar[]>();
/**
 * The ten pillars, in ring order (save `end.crystals` indexes them). Sizes come from a seeded shuffle of ten ranks:
 * rank k has radius 2 + ⌊k / 3⌋ and its cap at y 76 + 3k; ranks 0 and 1 (the two shortest) are caged.
 */
export function endPillars(seed: number): readonly Pillar[] {
  let pillars = pillarCache.get(seed);
  if (pillars) return pillars;
  const rng = createRng(subSeed(seed, 1200)), ranks = COS.map((_, i) => i);
  for (let i = ranks.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ranks[i], ranks[j]] = [ranks[j]!, ranks[i]!];
  }
  pillars = ranks.map((k, i) => ({
    x: END_CENTER.x + Math.floor(PILLAR_RING * COS[i]! + 0.5), z: END_CENTER.z + Math.floor(PILLAR_RING * SIN[i]! + 0.5),
    r: 2 + Math.floor(k / 3), top: 76 + 3 * k, caged: k < 2,
  }));
  if (pillarCache.size >= SEED_CACHE) pillarCache.delete(pillarCache.keys().next().value!);
  pillarCache.set(seed, pillars);
  return pillars;
}
/** Where a pillar's crystal floats (the crystal mob's feet: on top of the bedrock cap). */
export const crystalSpot = (pillar: Pillar): Vec3 => [pillar.x + 0.5, pillar.top + 1, pillar.z + 0.5];
const inDisc = (dx: number, dz: number, r: number) => dx * dx + dz * dz <= r * r + r;
/** Iron bars of a caged pillar's cage: walls one block outside the crystal on the cap level and 3 above, plus a roof. */
const inCage = (dx: number, dy: number, dz: number) =>
  Math.abs(dx) <= 2 && Math.abs(dz) <= 2 && (dy === 4 || dy >= 0 && dy < 4 && (Math.abs(dx) === 2 || Math.abs(dz) === 2));

/** The arrival platform: a 5×5 obsidian floor at END_ARRIVAL.y with 3 air above, and the stairway climbing west from it. */
const PLATFORM = { x0: END_ARRIVAL.x - 2, x1: END_ARRIVAL.x + 2, z0: END_ARRIVAL.z - 2, z1: END_ARRIVAL.z + 2, y: END_ARRIVAL.y };
const STAIR_Z0 = END_ARRIVAL.z - 1, STAIR_Z1 = END_ARRIVAL.z + 1;
export const ISLAND_RADIUS = 96;

type Seeds = { edge: number; top: number; under: number };
const seedCache = new Map<number, Seeds>();
function seedsFor(seed: number): Seeds {
  let seeds = seedCache.get(seed);
  if (seeds) return seeds;
  seeds = { edge: subSeed(seed, 1201), top: subSeed(seed, 1202), under: subSeed(seed, 1203) };
  if (seedCache.size >= SEED_CACHE) seedCache.delete(seedCache.keys().next().value!);
  seedCache.set(seed, seeds);
  return seeds;
}

/**
 * The island's [bottom, top] at a column (inclusive; bottom > top where there is none). The outline radius wanders by
 * ±12 with an eastern lobe of +22 over the arrival platform; the top is a gentle dome (63 at the flat centre, ≈ 57 at the
 * rim) roughened away from the fountain; the underside is a rounded bowl hanging down to y ≈ 2.
 */
export function islandColumn(seed: number, x: number, z: number): [number, number] {
  const s = seedsFor(seed), dx = x - END_CENTER.x, dz = z - END_CENTER.z, d = Math.sqrt(dx * dx + dz * dz);
  const lobe = dx > 0 ? 22 * (1 - smoothstep(0, 30, Math.abs(dz))) * smoothstep(40, 80, dx) : 0;
  const radius = ISLAND_RADIUS + fbm2(s.edge, x, z, 34, 3) * 12 + lobe;
  if (d >= radius) return [1, 0];
  const t = d / radius, flat = smoothstep(6, 14, d);
  const top = Math.floor(lerp(63, 57 + 6 * (1 - t * t) + fbm2(s.top, x, z, 20, 2) * 2.2, flat));
  const depth = 3 + 58 * Math.sqrt(1 - t) + fbm2(s.under, x, z, 16, 2) * 5 * flat;
  return [Math.max(1, Math.floor(top - depth)), top];
}

/** Terrain for an End chunk: pure in (seed, cx, cz), well under 6 ms. */
export function generateEndChunk(seed: number, cx: number, cz: number): Uint16Array {
  const cells = new Uint16Array(CHUNK_CELLS), x0 = cx * CHUNK, z0 = cz * CHUNK, UP = CHUNK * CHUNK;
  const set = (x: number, y: number, z: number, cell: number) => {
    if (x >= x0 && x < x0 + CHUNK && z >= z0 && z < z0 + CHUNK && y >= 0 && y < HEIGHT) cells[localIndex(x - x0, y, z - z0)] = cell;
  };
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const x = x0 + lx, z = z0 + lz;
    // The region's inside faces are invisible barriers, far out in the void.
    if (x === END.x0 || z === END.z0) {
      for (let y = 0; y < HEIGHT; y++) cells[lx + lz * CHUNK + y * UP] = B.barrier;
      continue;
    }
    const [bottom, top] = islandColumn(seed, x, z);
    for (let y = bottom; y <= top; y++) cells[lx + lz * CHUNK + y * UP] = B.end_stone;
    // The stairway: 3 wide, one step up per block west of the platform, carved until it reaches open air.
    const k = PLATFORM.x0 - 1 - x;
    if (k >= 0 && k < 24 && z >= STAIR_Z0 && z <= STAIR_Z1) for (let y = PLATFORM.y + 1 + k; y <= Math.min(top, PLATFORM.y + 3 + k); y++) cells[lx + lz * CHUNK + y * UP] = B.air;
  }
  // The arrival platform in its cave (sim/end.ts rebuilds the same cells as edits on every arrival).
  for (let z = PLATFORM.z0; z <= PLATFORM.z1; z++) for (let x = PLATFORM.x0; x <= PLATFORM.x1; x++) {
    set(x, PLATFORM.y, z, B.obsidian);
    for (let y = PLATFORM.y + 1; y <= PLATFORM.y + 3; y++) set(x, y, z, B.air);
  }
  // Pillars: obsidian from inside the island to just below the cap, then the bedrock cap (and a cage on the shortest two).
  for (const p of endPillars(seed)) {
    if (p.x + p.r + 2 < x0 || p.x - p.r - 2 >= x0 + CHUNK || p.z + p.r + 2 < z0 || p.z - p.r - 2 >= z0 + CHUNK) continue;
    for (let dz = -p.r; dz <= p.r; dz++) for (let dx = -p.r; dx <= p.r; dx++) {
      if (!inDisc(dx, dz, p.r)) continue;
      for (let y = 48; y < p.top; y++) set(p.x + dx, y, p.z + dz, B.obsidian);
    }
    set(p.x, p.top, p.z, B.bedrock);
    if (p.caged) for (let dy = 0; dy <= 4; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (!inCage(dx, dy, dz)) continue;
      // Bars connect along the cage (N, E, S, W bits), like placement's fence/pane rule.
      const bits = (inCage(dx, dy, dz - 1) ? 1 : 0) | (inCage(dx + 1, dy, dz) ? 2 : 0) | (inCage(dx, dy, dz + 1) ? 4 : 0) | (inCage(dx - 1, dy, dz) ? 8 : 0);
      set(p.x + dx, p.top + dy, p.z + dz, makeCell(B.iron_bars, bits));
    }
  }
  // The exit portal fountain: bedrock bowl and rim, a 4-tall pillar with a wall torch on each side near its top.
  const { x: ex, z: ez } = END_CENTER;
  if (ex + 4 >= x0 && ex - 4 < x0 + CHUNK && ez + 4 >= z0 && ez - 4 < z0 + CHUNK) {
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
      for (let y = EXIT_Y; y < EXIT_Y + 8; y++) set(ex + dx, y, ez + dz, B.air);
      const bowl = Math.abs(dx) <= 2 && Math.abs(dz) <= 2 && !(Math.abs(dx) === 2 && Math.abs(dz) === 2);
      if (bowl || isRim(dx, dz)) set(ex + dx, EXIT_Y - 1, ez + dz, B.bedrock);
      if (isRim(dx, dz)) set(ex + dx, EXIT_Y, ez + dz, B.bedrock);
    }
    for (let y = EXIT_Y - 1; y < PERCH_Y; y++) set(ex, y, ez, B.bedrock);
    // Torch states 1..4 point N, E, S, W, hanging on the pillar behind them.
    [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dz], i) => set(ex + dx!, PERCH_Y - 2, ez + dz!, makeCell(B.torch, 1 + i)));
  }
  return cells;
}
