/**
 * Strongholds: three per world, 640–1152 blocks from the world spawn and roughly 120° apart, each an underground maze of
 * MC-like stone-brick pieces grown outwards from its End portal room: straight and stair corridors, turns, crossings, a
 * prison hall, a fountain room, libraries and store rooms, joined by open arches, wooden doors, iron doors with buttons on
 * both sides and iron grates. Pure and deterministic in the seed with engine-exact math only (no trig: the 120° turns are
 * exact constants), like the rest of worldgen.
 *
 * The portal room's position is cheap to compute (`strongholdsOf`, used by eyes of ender and the client's goal chip); the
 * maze is planned only when a chunk near it generates, then baked into chunk buckets like every structure (builder.ts).
 * Every write is a plain `set`, so pieces that cross caves keep their walls.
 */
import { B, CHEST_LOOT, DOOR_UPPER, FRAME_EYE, isFullCube, makeCell } from '../blocks';
import { CHUNK, HEIGHT, SEA_LEVEL, SEED_CACHE, SPAWN_X, SPAWN_Z } from '../constants';
import { cellIndex, cellXYZ, chunkKey, FACING, FACING_FACE, type Vec3 } from '../coords';
import { createRng, hash3, rand3, rngInt, type Rng } from '../noise';
import { MOB } from '../protocol';
import { surfaceHeight } from '../worldgen';
import { Blueprint, boxesTouch, Frame, paintOps, type Bounds } from './builder';

/** Where a stronghold is: its portal room centre (the middle of the 3 × 3 portal, at frame height), a safe floor cell inside the room's door, and the room's facing. */
export type StrongholdSite = { center: Vec3; landing: Vec3; r: number };
export type StrongholdPieceKind = 'portal_room' | 'corridor' | 'stairs' | 'turn' | 'crossing' | 'prison' | 'fountain' | 'library' | 'store_room';
export type StrongholdPiece = { kind: StrongholdPieceKind; bounds: Bounds };
/** A planned stronghold: its pieces, every cell it writes (global cell index → cell, last write wins) and its bounds. */
export type StrongholdPlan = { site: StrongholdSite; pieces: StrongholdPiece[]; cells: Map<number, number>; bounds: Bounds; bp: Blueprint };

export const STRONGHOLD_COUNT = 3, STRONGHOLD_MIN_DIST = 640, STRONGHOLD_MAX_DIST = 1152;
/** No piece reaches farther than this (blocks, either axis) from its portal room centre. */
export const STRONGHOLD_REACH = 84;
const MAX_PIECES = 44, MAX_DEPTH = 9, COVER = 4, MIN_FLOOR = 6, ATTEMPTS = 12, TRIES = 64;
/** cos and sin of 120°. */
const C120 = -0.5, S120 = 0.8660254037844386;

// ---------------------------------------------------------------------------------------------------------------------
// Sites

const siteCache = new Map<number, readonly StrongholdSite[]>();
/**
 * The three sites of a world: a hashed direction turned by 120° twice (each jittered ±14°), at hashed distances. A site
 * under the sea or a river re-rolls its jitter and distance (up to 64 times, keeping the driest) so "dig down where the
 * eye drops" starts on land, not under 30 blocks of water.
 */
export function strongholdSites(seed: number): readonly StrongholdSite[] {
  const hit = siteCache.get(seed);
  if (hit) return hit;
  const rng = createRng(hash3(seed, 0x57a0, 0x6e0d, 0x1d)), sites: StrongholdSite[] = [];
  let a = 0, b = 0;
  do { a = rng() * 2 - 1; b = rng() * 2 - 1; } while (a * a + b * b < 0.04);
  const len = Math.sqrt(a * a + b * b);
  let dx = a / len, dz = b / len;
  for (let i = 0; i < STRONGHOLD_COUNT; i++) {
    let best: [StrongholdSite, number] | null = null;
    for (let tries = 0; tries < TRIES && !(best && best[1] > SEA_LEVEL); tries++) {
      // A small turn by t radians from its Taylor series (|t| ≤ 0.25 keeps it within 1e-5), then renormalised; later
      // tries turn twice as far (±28°).
      const t = (rng() - 0.5) * 0.5, c = 1 - t * t / 2 + t * t * t * t / 24, s = t - t * t * t / 6;
      let jx = dx, jz = dz;
      for (let k = tries < TRIES / 2 ? 1 : 2; k > 0; k--) {
        [jx, jz] = [jx * c - jz * s, jx * s + jz * c];
        const n = Math.sqrt(jx * jx + jz * jz);
        jx /= n; jz /= n;
      }
      const dist = STRONGHOLD_MIN_DIST + 24 + rng() * (STRONGHOLD_MAX_DIST - STRONGHOLD_MIN_DIST - 48);
      const site = siteAt(seed, Math.floor(SPAWN_X + jx * dist), Math.floor(SPAWN_Z + jz * dist), rngInt(rng, 0, 3), rngInt(rng, 16, 40));
      if (!best || site[1] > best[1]) best = site;
    }
    sites.push(best![0]);
    [dx, dz] = [dx * C120 - dz * S120, dx * S120 + dz * C120];
  }
  if (siteCache.size >= SEED_CACHE) siteCache.delete(siteCache.keys().next().value!);
  siteCache.set(seed, sites);
  return sites;
}

/** Portal room centres of a world's strongholds (deterministic from the seed), for eyes of ender, goals and tests. */
export const strongholdsOf = (seed: number): readonly Vec3[] => strongholdSites(seed).map(site => site.center);

/** The portal room frame (11 × 16, ring centre at local (5, 10)) for a ring centred on column (cx, cz). */
function roomFrame(bp: Blueprint, cx: number, y0: number, cz: number, r: number) {
  const probe = new Frame(bp, 0, y0, 0, ROOM_W, ROOM_D, r);
  return new Frame(bp, cx - probe.x(5, 10), y0, cz - probe.z(5, 10), ROOM_W, ROOM_D, r);
}
const ROOM_W = 11, ROOM_D = 16;
/** Floor at hashed y 16–40, lowered so the room keeps 16 blocks of rock under the lowest terrain over it; also that terrain height. */
function siteAt(seed: number, cx: number, cz: number, r: number, y: number): [StrongholdSite, number] {
  const f = roomFrame(new Blueprint(), cx, 0, cz, r), b = f.bounds(0, 0);
  let ground = HEIGHT;
  for (const [x, z] of [[b[0], b[2]], [b[3], b[2]], [b[0], b[5]], [b[3], b[5]], [cx, cz]] as const) ground = Math.min(ground, surfaceHeight(seed, x, z));
  const y0 = Math.max(16, Math.min(y, ground - 16)), landing = f.at(5, 1, 2);
  return [{ center: [cx, y0 + 4, cz], landing: [landing[0], y0 + 1, landing[2]], r }, ground];
}

// ---------------------------------------------------------------------------------------------------------------------
// The maze

/** Doorways: a 3 × 3 arch, a closed wooden door, an iron door with a button on each side, or an iron grate around a 1 × 2 gap. */
type Door = 'open' | 'wood' | 'iron' | 'grate';
/** An exit: the doorway cell in a piece's wall (feet level y), the way out, the depth in the maze and its door. */
type Exit = { x: number; y: number; z: number; dir: number; depth: number; door: Door };

/**
 * A blueprint that also remembers every cell it writes (for doors, buttons, bar connections and tests). Wrapped rather
 * than subclassed: this module sits in the worldgen import cycle, so its top level must not touch Blueprint.
 */
type Plan = Blueprint & { cells: Map<number, number>; at(x: number, y: number, z: number): number | undefined };
function newPlan(): Plan {
  const bp = new Blueprint(), op = bp.op.bind(bp), cells = new Map<number, number>();
  return Object.assign(bp, {
    cells,
    at: (x: number, y: number, z: number) => cells.get(cellIndex(x, y, z)),
    op(code: number, x: number, y: number, z: number, cell = 0) {
      op(code, x, y, z, cell);
      if (y >= 1 && y < HEIGHT) cells.set(cellIndex(x, y, z), cell);
    },
  });
}
type Gen = { seed: number; site: StrongholdSite; rng: Rng; bp: Plan; pieces: StrongholdPiece[]; queue: Exit[]; doors: Exit[]; count: Partial<Record<StrongholdPieceKind, number>> };

/** Stone bricks, a fifth mossy, a tenth cracked and a few infested (silverfish stone), hashed per cell. */
function brick(seed: number, x: number, y: number, z: number) {
  const r = rand3(seed ^ 0x5b1c, x, y, z);
  return r < 0.02 ? B.silverfish_stone : r < 0.2 ? B.mossy_stone_bricks : r < 0.3 ? B.cracked_stone_bricks : B.stone_bricks;
}
/** Fill local box with bricks (`solid`) or with brick walls around air (the box's outer faces are the walls). */
function shell(g: Gen, f: Frame, y0: number, y1: number, solid = false) {
  for (let y = y0; y <= y1; y++) for (let v = 0; v < f.d; v++) for (let u = 0; u < f.w; u++) {
    const wall = solid || y === y0 || y === y1 || u === 0 || v === 0 || u === f.w - 1 || v === f.d - 1;
    f.set(u, y, v, wall ? brick(g.seed, f.x(u, v), f.y0 + y, f.z(u, v)) : B.air);
  }
}
const isAirAt = (g: Gen, f: Frame, u: number, y: number, v: number) => g.bp.at(f.x(u, v), f.y0 + y, f.z(u, v)) === B.air;

/** A w × d frame whose front wall (v = 0) holds the exit's doorway at local u; it extends in the exit's direction. */
function frameAt(bp: Blueprint, exit: Exit, w: number, d: number, u: number) {
  const r = (exit.dir + 2) & 3, probe = new Frame(bp, 0, exit.y - 1, 0, w, d, r);
  return new Frame(bp, exit.x - probe.x(u, 0), exit.y - 1, exit.z - probe.z(u, 0), w, d, r);
}
/** A piece fits within reach, above the bedrock, under enough rock, and without overlapping another piece's inside (walls may be shared). */
function fits(g: Gen, box: Bounds): boolean {
  const [cx, , cz] = g.site.center;
  if (box[1] < MIN_FLOOR - 1 || Math.max(cx - box[0], box[3] - cx, cz - box[2], box[5] - cz) > STRONGHOLD_REACH) return false;
  const inner: Bounds = [box[0] + 1, box[1] + 1, box[2] + 1, box[3] - 1, box[4] - 1, box[5] - 1];
  if (g.pieces.some(piece => boxesTouch(inner, piece.bounds))) return false;
  for (const [x, z] of [[box[0], box[2]], [box[3], box[2]], [box[0], box[5]], [box[3], box[5]], [(box[0] + box[3]) >> 1, (box[2] + box[5]) >> 1]] as const) {
    if (surfaceHeight(g.seed, x, z) < box[4] + COVER) return false;
  }
  return true;
}
/** Reserve a piece of w × d with walls from local y0 to y1 behind `exit`; null when it does not fit. */
function claim(g: Gen, exit: Exit, kind: StrongholdPieceKind, w: number, d: number, u: number, y0: number, y1: number): Frame | null {
  const f = frameAt(g.bp, exit, w, d, u), bounds = f.bounds(y0, y1);
  if (!fits(g, bounds)) return null;
  g.pieces.push({ kind, bounds });
  g.count[kind] = (g.count[kind] ?? 0) + 1;
  return f;
}
/** Queue an exit through local wall cell (u, v) at local feet height y, leaving towards local facing `f`. */
function exitAt(g: Gen, frame: Frame, u: number, y: number, v: number, f: number, depth: number, door: Door = 'open') {
  g.queue.push({ x: frame.x(u, v), y: frame.y0 + y, z: frame.z(u, v), dir: frame.dir(f), depth, door });
}
/** Exits ahead (back wall centre) and to the sides (side wall centres) of a w × d piece, each with probability p. */
function branch(g: Gen, f: Frame, depth: number, p: number, ahead = true) {
  if (ahead && g.rng() < p) exitAt(g, f, f.w >> 1, 1, f.d - 1, 2, depth);
  if (g.rng() < p) exitAt(g, f, 0, 1, f.d >> 1, 3, depth);
  if (g.rng() < p) exitAt(g, f, f.w - 1, 1, f.d >> 1, 1, depth);
}
const chest = (f: Frame, u: number, y: number, v: number, facing: number, loot: number) => f.facing(B.chest, u, y, v, facing, loot << 2);

/** The root: 11 × 16 × 10 with stairs up to a raised platform holding the 12-frame ring over lava, a silverfish spawner on the landing. */
function portalRoom(g: Gen) {
  const { site, seed } = g, f = roomFrame(g.bp, site.center[0], site.center[1] - 4, site.center[2], site.r);
  g.pieces.push({ kind: 'portal_room', bounds: f.bounds(0, 9) });
  shell(g, f, 0, 9);
  for (let v = 7; v <= 14; v++) for (let u = 1; u <= 9; u++) for (let y = 1; y <= 3; y++) f.set(u, y, v, brick(seed, f.x(u, v), f.y0 + y, f.z(u, v)));
  for (let u = 4; u <= 6; u++) {
    f.stairs(B.stone_brick_stairs, u, 1, 4, 2);
    f.set(u, 1, 5, B.stone_bricks); f.stairs(B.stone_brick_stairs, u, 2, 5, 2);
    f.box(u, 1, 6, u, 2, 6, B.stone_bricks); f.stairs(B.stone_brick_stairs, u, 3, 6, 2);
  }
  f.box(4, 3, 9, 6, 3, 11, B.lava);
  // Twelve frames facing the ring's centre; each holds an eye 75% of the time, never all twelve.
  const frames: [number, number, number][] = [];
  for (let k = 4; k <= 6; k++) frames.push([k, 8, 2], [k, 12, 0], [3, k + 5, 1], [7, k + 5, 3]);
  const eyes = frames.map(([u, , v]) => rand3(seed ^ 0xe7e, f.x(u, v), f.y0, f.z(u, v)) < 0.75);
  if (eyes.every(Boolean)) eyes[0] = false;
  frames.forEach(([u, v, facing], i) => f.facing(B.end_portal_frame, u, 4, v, facing, eyes[i] ? FRAME_EYE : 0));
  f.set(5, 4, 7, makeCell(B.monster_spawner, MOB.silverfish));
  // Chiseled trim on the platform's front edge, iron-bar windows high on the side walls, torches kept away from the spawner.
  for (const u of [1, 2, 3, 7, 8, 9]) f.set(u, 3, 7, B.chiseled_stone_bricks);
  for (const v of [3, 4, 5, 9, 10, 11]) for (let y = 5; y <= 6; y++) { f.set(0, y, v, B.iron_bars); f.set(10, y, v, B.iron_bars); }
  f.torch(1, 4, 1, 1); f.torch(9, 4, 1, 3); f.torch(1, 7, 14, 1); f.torch(9, 7, 14, 3);
  exitAt(g, f, 5, 1, 0, 0, 0, 'open');
}

/** A 3 × 3 corridor 3–7 long with high wall torches, the odd cobweb and corridor chest, and exits ahead and to the sides. */
function corridor(g: Gen, exit: Exit): boolean {
  let d = rngInt(g.rng, 5, 9), f: Frame | null = null;
  while (d >= 5 && !(f = claim(g, exit, 'corridor', 5, d, 2, 0, 4))) d -= 2;
  if (!f) return false;
  shell(g, f, 0, 4);
  if (g.rng() < 0.5) f.torch(1, 3, 1, 1);
  if (g.rng() < 0.5) f.torch(3, 3, d - 2, 3);
  for (let v = 1; v < d - 1; v++) for (const u of [1, 3]) if (rand3(g.seed + 31, f.x(u, v), f.y0, f.z(u, v)) < 0.06 && isAirAt(g, f, u, 3, v)) f.set(u, 3, v, B.cobweb);
  if (d >= 7 && g.rng() < 0.15) chest(f, 3, 1, d >> 1, 3, CHEST_LOOT.stronghold_corridor);
  if (g.rng() < 0.9) exitAt(g, f, 2, 1, d - 1, 2, exit.depth + 1);
  if (d >= 7) for (const [u, facing] of [[0, 3], [4, 1]] as const) if (g.rng() < 0.35) exitAt(g, f, u, 1, d >> 1, facing, exit.depth + 1);
  return true;
}

/** Five steps down (or four up) in a 3-wide stairwell, landing four blocks lower (higher) for the next piece. */
function stairs(g: Gen, exit: Exit): boolean {
  const down = exit.y - 4 >= MIN_FLOOR && g.rng() < 0.75, y0 = down ? -5 : 0;
  const f = claim(g, exit, 'stairs', 5, 9, 2, y0, y0 + 9);
  if (!f) return false;
  shell(g, f, y0, y0 + 9, true);
  for (let v = 1; v <= 7; v++) {
    const feet = down ? (v <= 1 ? 1 : v <= 6 ? 3 - v : -3) : v <= 1 ? 1 : v <= 5 ? v : 5;
    for (let u = 1; u <= 3; u++) {
      for (let y = feet; y <= feet + 3; y++) f.set(u, y, v, B.air);
      if (down && v >= 2 && v <= 6) f.stairs(B.stone_brick_stairs, u, 2 - v, v, 0);
      if (!down && v >= 2 && v <= 5) f.stairs(B.stone_brick_stairs, u, v - 1, v, 2);
    }
  }
  exitAt(g, f, 2, down ? -3 : 5, 8, 2, exit.depth + 1);
  return true;
}

/** A 3 × 3 corner turning left or right. */
function turn(g: Gen, exit: Exit): boolean {
  const f = claim(g, exit, 'turn', 5, 5, 2, 0, 4);
  if (!f) return false;
  shell(g, f, 0, 4);
  const left = g.rng() < 0.5;
  exitAt(g, f, left ? 0 : 4, 1, 2, left ? 3 : 1, exit.depth + 1);
  return true;
}

/** A tall 9 × 9 crossing around a torch-lit pillar, exits on three sides. */
function crossing(g: Gen, exit: Exit): boolean {
  const f = claim(g, exit, 'crossing', 11, 11, 5, 0, 6);
  if (!f) return false;
  shell(g, f, 0, 6);
  f.box(5, 1, 5, 5, 5, 5, B.stone_bricks);
  f.set(5, 3, 5, B.chiseled_stone_bricks);
  f.torch(4, 3, 5, 3); f.torch(6, 3, 5, 1); f.torch(5, 3, 4, 0); f.torch(5, 3, 6, 2);
  for (const [u, v] of [[1, 1], [9, 1], [1, 9], [9, 9]] as const) f.slab(B.stone_brick_slab, u, 1, v);
  branch(g, f, exit.depth + 1, 0.85);
  return true;
}

/** The prison hall: an aisle between four barred cells with iron doors (no buttons: break in or out), lit from the dividers. */
function prison(g: Gen, exit: Exit): boolean {
  const f = claim(g, exit, 'prison', 11, 11, 5, 0, 4);
  if (!f) return false;
  shell(g, f, 0, 4);
  for (const [u0, front, facing] of [[1, 3, 1], [7, 7, 3]] as const) {
    for (let u = u0; u <= u0 + 2; u++) f.box(u, 1, 5, u, 3, 5, B.stone_bricks);
    for (let v = 1; v <= 9; v++) if (v !== 5) for (let y = 1; y <= 3; y++) f.set(front, y, v, B.iron_bars);
    for (const v of [2, 7]) { f.facing(B.iron_door, front, 1, v, facing); f.facing(B.iron_door, front, 2, v, facing, DOOR_UPPER); }
    f.set(u0 === 1 ? 1 : 9, 3, 1, B.cobweb);
    f.set(u0 === 1 ? 1 : 9, 3, 9, B.cobweb);
  }
  f.torch(4, 2, 5, 1); f.torch(6, 2, 5, 3);
  if (g.rng() < 0.85) exitAt(g, f, 5, 1, 10, 2, exit.depth + 1);
  return true;
}

/** A fountain room: a brick basin of water around a chiseled pillar topped with water, exits on three sides. */
function fountain(g: Gen, exit: Exit): boolean {
  const f = claim(g, exit, 'fountain', 11, 11, 5, 0, 7);
  if (!f) return false;
  shell(g, f, 0, 7);
  f.ring(3, 1, 3, 7, 7, B.stone_bricks);
  for (let v = 3; v <= 7; v++) for (let u = 3; u <= 7; u++) if (u === 3 || u === 7 || v === 3 || v === 7) f.slab(B.stone_brick_slab, u, 2, v);
  f.box(4, 0, 4, 6, 0, 6, B.stone_bricks);
  f.box(4, 1, 4, 6, 1, 6, B.water);
  f.box(5, 1, 5, 5, 4, 5, B.chiseled_stone_bricks);
  f.set(5, 5, 5, B.water);
  f.torch(1, 3, 2, 1); f.torch(9, 3, 2, 3); f.torch(1, 3, 8, 1); f.torch(9, 3, 8, 3);
  branch(g, f, exit.depth + 1, 0.8);
  return true;
}

/** A two-storey library: shelves on both floors, a railed oak balcony with ladders, central shelf rows, cobwebs and two chests. Dead end. */
function library(g: Gen, exit: Exit): boolean {
  const f = claim(g, exit, 'library', 15, 13, 7, 0, 10);
  if (!f) return false;
  shell(g, f, 0, 10);
  const wallSide = (u: number, v: number) => u === 1 || u === 13 || v === 1 || v === 11;
  for (let v = 1; v <= 11; v++) for (let u = 1; u <= 13; u++) {
    if (wallSide(u, v)) {
      const door = v === 1 && u >= 6 && u <= 8;
      for (let y = 1; y <= 4; y++) if (!door) f.set(u, y, v, B.bookshelf);
      for (let y = 6; y <= 8; y++) f.set(u, y, v, B.bookshelf);
    }
    const balcony = u <= 3 || u >= 11 || v <= 3 || v >= 9;
    if (balcony) f.set(u, 5, v, B.oak_planks);
    if (balcony && !(u <= 2 || u >= 12 || v <= 2 || v >= 10)) f.fence(u, 6, v);
    if (!balcony && rand3(g.seed + 37, f.x(u, v), f.y0, f.z(u, v)) < 0.05) f.set(u, 9, v, B.cobweb);
    else if (!wallSide(u, v) && balcony && rand3(g.seed + 41, f.x(u, v), f.y0, f.z(u, v)) < 0.06) f.set(u, 4, v, B.cobweb);
  }
  for (const v of [5, 7]) f.box(5, 1, v, 9, 3, v, B.bookshelf);
  for (const [u, facing] of [[2, 1], [12, 3]] as const) for (let y = 1; y <= 6; y++) f.facing(B.ladder, u, y, 10, facing);
  f.torch(4, 3, 5, 3); f.torch(10, 3, 7, 1); f.torch(2, 8, 6, 1); f.torch(12, 8, 6, 3);
  chest(f, 7, 1, 10, 0, CHEST_LOOT.stronghold_library);
  chest(f, 12, 6, 2, 3, CHEST_LOOT.stronghold_library);
  return true;
}

/** A store room: a workbench, a furnace and one or two corridor-loot chests along the back wall. Dead end. */
function storeRoom(g: Gen, exit: Exit): boolean {
  const f = claim(g, exit, 'store_room', 9, 9, 4, 0, 5);
  if (!f) return false;
  shell(g, f, 0, 5);
  f.set(1, 1, 7, B.crafting_table);
  f.facing(B.furnace, 7, 1, 7, 0);
  chest(f, 3, 1, 7, 0, CHEST_LOOT.stronghold_corridor);
  if (g.rng() < 0.6) chest(f, 5, 1, 7, 0, CHEST_LOOT.stronghold_corridor);
  f.set(7, 1, 1, B.oak_planks); f.slab(B.oak_slab, 7, 2, 1);
  f.torch(1, 3, 3, 1); f.torch(7, 3, 4, 3);
  if (g.rng() < 0.5) f.set(1, 4, 1, B.cobweb);
  return true;
}

type Builder = (g: Gen, exit: Exit) => boolean;
/** Piece table: builder, weight, cap per stronghold, the door it gets and the count the maze must reach. */
const PIECES: readonly { kind: StrongholdPieceKind; build: Builder; weight: number; cap: number; door?: Door; need?: number }[] = [
  { kind: 'corridor', build: (g, exit) => corridor(g, exit), weight: 34, cap: 99 },
  { kind: 'stairs', build: stairs, weight: 12, cap: 99 },
  { kind: 'turn', build: turn, weight: 10, cap: 99 },
  { kind: 'crossing', build: crossing, weight: 11, cap: 6 },
  { kind: 'prison', build: prison, weight: 6, cap: 1, door: 'iron', need: 1 },
  { kind: 'fountain', build: fountain, weight: 5, cap: 1, need: 1 },
  { kind: 'library', build: library, weight: 6, cap: 2, door: 'wood', need: 1 },
  { kind: 'store_room', build: storeRoom, weight: 8, cap: 3, need: 2 },
];
const DOORS: readonly Door[] = ['open', 'open', 'open', 'wood', 'iron', 'iron', 'grate'];

/** Build one piece behind `exit` (corridors first out of the portal room; missing required rooms are favoured). */
function grow(g: Gen, exit: Exit): boolean {
  const options = PIECES.filter(p => (g.count[p.kind] ?? 0) < p.cap && (exit.depth > 0 || p.kind === 'corridor'));
  const weight = (p: typeof PIECES[number]) => p.weight * (p.need && (g.count[p.kind] ?? 0) < p.need && exit.depth >= 2 ? 4 : 1);
  let roll = g.rng() * options.reduce((sum, p) => sum + weight(p), 0);
  const pick = options.find(p => (roll -= weight(p)) < 0) ?? options[0]!;
  if (exit.depth > 0) exit.door = pick.door ?? DOORS[Math.floor(g.rng() * DOORS.length)]!;
  if (pick.build(g, exit)) return true;
  if (exit.depth > 0) exit.door = 'open';
  return corridor(g, exit);
}

/** Paint each joined doorway into the shared wall (see Door), buttons only where the cell beside the door is free. */
function paintDoor(g: Gen, exit: Exit) {
  const { x, y, z, dir } = exit, [px, pz] = FACING[(dir + 1) & 3]!, bp = g.bp;
  if (exit.door === 'open' || exit.door === 'grate') {
    for (let o = -1; o <= 1; o++) for (let dy = 0; dy < 3; dy++) bp.set(x + px * o, y + dy, z + pz * o, exit.door === 'open' || o === 0 && dy < 2 ? B.air : B.iron_bars);
    return;
  }
  const id = exit.door === 'wood' ? B.oak_door : B.iron_door;
  bp.set(x, y, z, makeCell(id, dir));
  bp.set(x, y + 1, z, makeCell(id, dir | DOOR_UPPER));
  if (exit.door === 'iron') for (const side of [dir, (dir + 2) & 3]) {
    const [sx, sz] = FACING[side]!;
    const o = [1, -1].find(k => bp.at(x + px * k + sx, y + 1, z + pz * k + sz) === B.air);
    // A button on the wall beside the door powers that wall block, which opens the door next to it.
    if (o !== undefined) bp.set(x + px * o + sx, y + 1, z + pz * o + sz, makeCell(B.stone_button, FACING_FACE[side]));
  }
}

/** Iron bars join their neighbours: other bars and full cubes of the plan (unknown rock beyond stays unjoined). */
function connectBars(bp: Plan) {
  for (const [index, cell] of bp.cells) {
    if ((cell & 255) !== B.iron_bars) continue;
    const [x, y, z] = cellXYZ(index);
    let bits = 0;
    FACING.forEach(([dx, dz], dir) => {
      const n = bp.at(x + dx, y, z + dz);
      if (n !== undefined && ((n & 255) === B.iron_bars || isFullCube(n))) bits |= 1 << dir;
    });
    if (bits !== cell >> 8) bp.set(x, y, z, makeCell(B.iron_bars, bits));
  }
}

const meets = (g: Gen) => PIECES.every(p => (g.count[p.kind] ?? 0) >= (p.need ?? 0)) && g.pieces.length >= 14;
/** Plan stronghold `index` of a world: up to 12 seeded attempts at a maze that has every required room (the best attempt otherwise). */
export function planStronghold(seed: number, index: number): StrongholdPlan {
  const site = strongholdSites(seed)[index]!;
  let best: Gen | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const g: Gen = { seed, site, rng: createRng(hash3(seed, index, attempt, 0x5719)), bp: newPlan(), pieces: [], queue: [], doors: [], count: {} };
    portalRoom(g);
    while (g.queue.length && g.pieces.length < MAX_PIECES) {
      const exit = g.queue[0]!;
      if (exit.depth <= MAX_DEPTH && grow(g, exit)) g.doors.push(exit);
      g.queue.shift();
    }
    const score = (x: Gen) => PIECES.filter(p => (x.count[p.kind] ?? 0) >= (p.need ?? 0)).length * 100 + x.pieces.length;
    if (!best || score(g) > score(best)) best = g;
    if (meets(g)) break;
  }
  const g = best!;
  for (const exit of g.doors) paintDoor(g, exit);
  connectBars(g.bp);
  return { site, pieces: g.pieces, cells: g.bp.cells, bounds: g.bp.bounds, bp: g.bp };
}

// ---------------------------------------------------------------------------------------------------------------------
// Painting

/** Baked strongholds (chunk buckets), least recently used last; a few are enough (a player is near one at a time). */
const baked = new Map<string, Map<number, Int32Array>>();
const BAKED_CAP = 8;
function bakedOf(seed: number, index: number) {
  const key = `${seed}:${index}`, hit = baked.get(key);
  if (hit) {
    baked.delete(key);
    baked.set(key, hit);
    return hit;
  }
  const chunks = planStronghold(seed, index).bp.bake();
  if (baked.size >= BAKED_CAP) baked.delete(baked.keys().next().value!);
  baked.set(key, chunks);
  return chunks;
}

/** Paint the stronghold pieces that intersect overworld chunk (cx, cz) into `cells` (after the other structures). */
export function paintStronghold(seed: number, cx: number, cz: number, cells: Uint16Array): void {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  strongholdSites(seed).forEach(({ center: [sx, , sz] }, index) => {
    if (x0 + CHUNK - 1 < sx - STRONGHOLD_REACH || x0 > sx + STRONGHOLD_REACH || z0 + CHUNK - 1 < sz - STRONGHOLD_REACH || z0 > sz + STRONGHOLD_REACH) return;
    const ops = bakedOf(seed, index).get(chunkKey(cx, cz));
    if (ops) paintOps(ops, x0, z0, cells);
  });
}
