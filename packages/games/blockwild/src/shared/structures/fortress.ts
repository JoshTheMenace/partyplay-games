/**
 * Nether fortresses (DESIGN.md): 3–4 per world inside the Nether region, at least 64 blocks apart, the first within reach
 * of the Nether point the world spawn maps to (so the first portal most players build leads near one). Each fortress is a
 * 7 × 7 hub crossroads with four arms of MC-like nether brick pieces, in a seeded order:
 * - a 5-wide bridge on arches (piers down into the lava sea) up a short stair to a railed blaze spawner platform;
 * - a bridge into an enclosed castle wing: fence-windowed corridors, a corridor crossing, a loot room, a nether wart garden
 *   and a stair tower with a railed lookout roof (the landmark seen from afar);
 * - a bridge to a second crossroads with crumbling side bridges and either a second spawner platform or a long bridge;
 * - a long bridge that crumbles away over the lava.
 * Bridges and rooms carve their own clearance, so they tunnel through netherrack where they meet it.
 *
 * A fortress is planned once per seed into a cell map (later writes win; nether brick fences join the planned fences and
 * full blocks beside them), then baked into chunk buckets of builder operations (piers first), so every chunk paints exactly
 * its share and the result does not depend on chunk order. Pure and deterministic in the seed (hashes and + - * / only).
 */
import { B, cellId, CHEST_LOOT, isFullCube, makeCell, WART_MATURE } from '../blocks';
import { CHUNK, HEIGHT, NETHER, SEED_CACHE } from '../constants';
import { cellIndex, cellXYZ, chunkKey, FACING, localIndex, type Vec3 } from '../coords';
import { generateNetherChunk } from '../nether';
import { createRng, hash3, rngInt, type Rng } from '../noise';
import { MOB } from '../protocol';
import { findSpawn } from '../worldgen';
import { Blueprint, boundsRect, OP, overlaps, paintOps, type Bounds } from './builder';

export type Fortress = { center: Vec3; bounds: Bounds; spawners: readonly Vec3[] };
type Built = Fortress & { chunks: Map<number, Int32Array> };

/** Soul lanterns on brick posts light bridges, hubs, platforms and the tower roof: blue points that read through the red fog. */
const NB = B.nether_bricks, FENCE = B.nether_brick_fence, AIR = B.air, LAMP = B.soul_lantern;
const SALT = 0xf0a7, GAP = 64;
/** Pieces stay this far inside the Nether's bedrock walls and the world edge (cells beyond are dropped). */
const EDGE = 6, X0 = NETHER.x0 + EDGE, X1 = NETHER.x0 + NETHER.size - 1 - EDGE, Z0 = NETHER.z0 + EDGE, Z1 = NETHER.z0 + NETHER.size - 1 - EDGE;
/** Piers reach down this far (the builder's foundation depth). */
const PIER_DEPTH = 24;

// ---------------------------------------------------------------------------------------------------------------------
// Pieces: a local frame at a piece's entry, a forward along its length, b across it (0 the centre line, + to the right),
// y up from the deck floor (local y 0 is the floor block, players stand at y 1).

type Plan = { rng: Rng; cells: Map<number, number>; piers: Vec3[]; spawners: Vec3[] };

class Piece {
  constructor(readonly plan: Plan, readonly x: number, readonly y: number, readonly z: number, readonly f: number) {}
  at(a: number, y: number, b: number): Vec3 {
    const [fx, fz] = FACING[this.f]!, [rx, rz] = FACING[(this.f + 1) & 3]!;
    return [this.x + a * fx + b * rx, this.y + y, this.z + a * fz + b * rz];
  }
  set(a: number, y: number, b: number, cell: number) {
    const [x, wy, z] = this.at(a, y, b);
    if (wy > 4 && wy < HEIGHT - 5) this.plan.cells.set(cellIndex(x, wy, z), cell);
  }
  box(a0: number, a1: number, y0: number, y1: number, b0: number, b1: number, cell: number) {
    for (let a = a0; a <= a1; a++) for (let y = y0; y <= y1; y++) for (let b = b0; b <= b1; b++) this.set(a, y, b, cell);
  }
  /** A nether brick column from local height y down to the ground (or the lava sea floor). */
  pier(a: number, y: number, b: number) { this.plan.piers.push(this.at(a, y, b)); }
  /** Nether brick stairs climbing towards local facing f (0 forward, 1 right, 2 back, 3 left). */
  stairs(a: number, y: number, b: number, f: number) { this.set(a, y, b, makeCell(B.nether_brick_stairs, (this.f + f) & 3)); }
  /** The piece that continues from local (a, b), turned `turn` quarter-turns clockwise. */
  next(a: number, b: number, turn = 0) {
    const [x, , z] = this.at(a, 0, b);
    return new Piece(this.plan, x, this.y, z, (this.f + turn) & 3);
  }
}

/** Arch underside depth along a bridge (period 8): two-thick piers at 0–1, the arch rising to the deck between them. */
const ARCH = [4, 4, 4, 3, 2, 2, 3, 4];

/** A 5-wide bridge: a two-layer deck on arches, low fenced walls with lantern posts over the piers, clearance cut 5 high. */
function bridge(p: Piece, len: number, crumble = false) {
  for (let a = 0; a < len; a++) {
    const k = a % 8, gone = crumble ? (a - len + 6) / 6 : 0;
    for (let b = -2; b <= 2; b++) {
      p.box(a, a, 1, 5, b, b, AIR);
      if (gone > 0 && p.plan.rng() < gone) continue;
      const edge = Math.abs(b) === 2;
      if (k < 2 && !edge) {
        p.box(a, a, -1, 0, b, b, NB);
        p.pier(a, -2, b);
      } else p.box(a, a, -ARCH[k]!, 0, b, b, NB);
      if (!edge) continue;
      p.set(a, 1, b, NB);
      p.set(a, 2, b, k === 0 ? NB : FENCE);
      if (k === 0) p.set(a, 3, b, LAMP);
    }
  }
}

/** An open 7 × 7 crossroads with corner posts, a thick underside on a central pier; exits on all four sides. */
function crossing(p: Piece) {
  p.box(0, 6, 1, 5, -3, 3, AIR);
  p.box(0, 6, -1, 0, -3, 3, NB);
  p.box(1, 5, -3, -2, -2, 2, NB);
  for (let a = 2; a <= 4; a++) for (let b = -1; b <= 1; b++) p.pier(a, -4, b);
  for (const a of [0, 6]) for (const b of [-3, 3]) {
    p.box(a, a, 1, 3, b, b, NB);
    p.set(a, 4, b, LAMP);
    p.pier(a, -2, b);
  }
  return { ahead: p.next(7, 0), left: p.next(3, -4, 3), right: p.next(3, 4, 1), back: p.next(-1, 0, 2) };
}

/** An enclosed box: floor (two layers), walls `h` high, a roof, hollow inside; piers under the side walls every 4 blocks. */
function shell(p: Piece, a0: number, a1: number, b0: number, b1: number, h: number, openEnds = false) {
  p.box(a0, a1, -1, 0, b0, b1, NB);
  p.box(a0, a1, h + 1, h + 1, b0, b1, NB);
  for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
    const side = b === b0 || b === b1;
    p.box(a, a, 1, h, b, b, side || !openEnds && (a === a0 || a === a1) ? NB : AIR);
    if (side && ((a - a0) % 4 === 0 || a === a1)) p.pier(a, -2, b);
  }
}
/** A doorway 3 wide and 4 high through the wall row at local a (or column at b for side doors). */
const door = (p: Piece, a: number, b0 = -1, b1 = 1) => p.box(a, a, 1, 4, b0, b1, AIR);

/** An enclosed corridor (3 wide inside) with pairs of fence windows every 4 blocks. */
function corridor(p: Piece, len: number) {
  shell(p, 0, len - 1, -2, 2, 4, true);
  for (let a = 2; a < len - 1; a += 4) for (const b of [-2, 2]) p.box(a, a, 2, 3, b, b, FENCE);
}

/** A 5 × 5 enclosed corridor crossing: doors ahead, left and right. */
function corridorCrossing(p: Piece) {
  shell(p, 0, 4, -2, 2, 4);
  door(p, 0);
  door(p, 4);
  for (const b of [-2, 2]) p.box(1, 3, 1, 4, b, b, AIR);
  return { ahead: p.next(5, 0), left: p.next(2, -3, 3), right: p.next(2, 3, 1) };
}

/** A small dead-end room with one or two loot chests against the back wall, facing the door. */
function lootRoom(p: Piece) {
  shell(p, 0, 6, -3, 3, 4);
  door(p, 0);
  for (const b of [-3, 3]) p.box(3, 3, 2, 3, b, b, FENCE);
  p.box(6, 6, 2, 3, 0, 0, FENCE);
  const chest = makeCell(B.chest, ((p.f + 2) & 3) | CHEST_LOOT.nether_fortress << 2);
  p.set(5, 1, -2, chest);
  if (p.plan.rng() < 0.6) p.set(5, 1, 2, chest);
}

/** A tall room with two raised soul sand beds of nether wart (mostly mature), edged by stairs, and fence windows. */
function wartGarden(p: Piece) {
  shell(p, 0, 10, -5, 5, 6);
  door(p, 0);
  for (const a of [3, 7]) for (const b of [-5, 5]) p.box(a, a, 3, 4, b, b, FENCE);
  for (const b of [-2, 2]) p.box(10, 10, 3, 4, b, b, FENCE);
  for (const s of [-1, 1]) {
    for (let a = 2; a <= 8; a++) {
      p.stairs(a, 1, 2 * s, s > 0 ? 1 : 3);
      for (const b of [3 * s, 4 * s]) {
        p.set(a, 1, b, B.soul_sand);
        p.set(a, 2, b, makeCell(B.nether_wart, p.plan.rng() < 0.75 ? WART_MATURE : rngInt(p.plan.rng, 1, 2)));
      }
    }
    for (const a of [1, 9]) p.box(a, a, 1, 1, Math.min(2 * s, 4 * s), Math.max(2 * s, 4 * s), NB);
  }
}

/** The ring of cells around the tower's 3 × 3 central column (b, a), clockwise from the doorway. */
const RING: readonly [number, number][] = [[0, 1], [1, 1], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [1, 5], [0, 5], [-1, 5], [-2, 5], [-2, 4], [-2, 3], [-2, 2], [-2, 1], [-1, 1]];
const TOWER = 11;
/** A 7 × 7 tower: stairs spiral 11 up around a central column to a lookout roof railed with fences. */
function stairTower(p: Piece) {
  shell(p, 0, 6, -3, 3, TOWER - 1);
  door(p, 0);
  p.box(2, 4, 1, TOWER - 1, -1, 1, NB);
  for (let k = 1; k <= TOWER; k++) {
    const [b, a] = RING[k]!, [pb, pa] = RING[k - 1]!;
    p.stairs(a, k, b, a > pa ? 0 : b > pb ? 1 : a < pa ? 2 : 3);
  }
  for (const k of [TOWER - 3, TOWER - 2, TOWER - 1]) p.set(RING[k]![1], TOWER, RING[k]![0], AIR);
  for (const y of [3, 7]) {
    for (const b of [-3, 3]) p.box(3, 3, y, y + 1, b, b, FENCE);
    p.box(6, 6, y, y + 1, 0, 0, FENCE);
  }
  p.box(0, 6, TOWER + 1, TOWER + 4, -3, 3, AIR);
  for (let a = 0; a <= 6; a++) for (let b = -3; b <= 3; b++) {
    if (a > 0 && a < 6 && b > -3 && b < 3) continue;
    const corner = (a === 0 || a === 6) && Math.abs(b) === 3;
    p.box(a, a, TOWER + 1, corner ? TOWER + 2 : TOWER + 1, b, b, corner ? NB : FENCE);
    if (corner) p.set(a, TOWER + 3, b, LAMP);
  }
}

/** A short stair up from a bridge to a raised 9 × 9 platform railed with fences, a blaze spawner in the middle. */
function spawnerPlatform(p: Piece) {
  for (let k = 0; k < 3; k++) {
    p.box(k, k, 1, k + 6, -2, 2, AIR);
    p.box(k, k, 0, k, -2, 2, NB);
    for (let b = -1; b <= 1; b++) p.stairs(k, k + 1, b, 0);
    for (const b of [-2, 2]) p.box(k, k, k + 1, k + 2, b, b, NB);
    p.pier(k, -1, 0);
  }
  p.box(3, 11, 4, 8, -4, 4, AIR);
  p.box(3, 11, 2, 3, -4, 4, NB);
  for (let a = 3; a <= 11; a++) for (let b = -4; b <= 4; b++) {
    const corner = (a === 3 || a === 11) && Math.abs(b) === 4;
    if (corner) {
      p.box(a, a, 4, 5, b, b, NB);
      p.set(a, 6, b, LAMP);
    }
    else if ((a === 3 && Math.abs(b) > 1) || a === 11 || Math.abs(b) === 4) p.set(a, 4, b, FENCE);
    if ((a - 3) % 4 === 0 && b % 4 === 0) p.pier(a, 1, b);
  }
  p.set(7, 4, 0, makeCell(B.monster_spawner, MOB.blaze));
  p.plan.spawners.push(p.at(7, 4, 0));
}

/** The enclosed wing: a corridor to a crossing, a loot room left, the wart garden right and the stair tower ahead. */
function castle(p: Piece) {
  const len = rngInt(p.plan.rng, 9, 12);
  corridor(p, len);
  const hub = corridorCrossing(p.next(len, 0)), flip = p.plan.rng() < 0.5;
  const [rooms, gardens] = flip ? [hub.right, hub.left] : [hub.left, hub.right];
  corridor(rooms, 4);
  lootRoom(rooms.next(4, 0));
  corridor(gardens, 3);
  wartGarden(gardens.next(3, 0));
  corridor(hub.ahead, 6);
  stairTower(hub.ahead.next(6, 0));
}

type Arm = (p: Piece) => void;
const ARMS: readonly Arm[] = [
  p => { const len = rngInt(p.plan.rng, 16, 26); bridge(p, len); spawnerPlatform(p.next(len, 0)); },
  p => { const len = rngInt(p.plan.rng, 14, 20); bridge(p, len); castle(p.next(len, 0)); },
  p => {
    const rng = p.plan.rng, len = rngInt(rng, 14, 22);
    bridge(p, len);
    const exits = crossing(p.next(len, 0)), on = rngInt(rng, 10, 16), second = rng() < 0.5;
    bridge(exits.ahead, on, !second);
    if (second) spawnerPlatform(exits.ahead.next(on, 0));
    for (const side of [exits.left, exits.right]) bridge(side, rngInt(rng, 6, 12), true);
  },
  p => bridge(p, rngInt(p.plan.rng, 24, 40), true),
];

// ---------------------------------------------------------------------------------------------------------------------
// Planning and placement

/**
 * The deck height (44–56) with the most open cavern around a hub, sampled from the Nether terrain of 9 chunks 32 blocks
 * apart, so bridges span the lava sea in the open instead of tunnelling through a wall of netherrack.
 */
function deckHeight(seed: number, x: number, z: number): number {
  const air = new Int32Array(HEIGHT);
  for (let dz = -32; dz <= 32; dz += 32) for (let dx = -32; dx <= 32; dx += 32) {
    const cells = generateNetherChunk(seed, (x + dx) >> 4, (z + dz) >> 4);
    for (let y = 44; y <= 68; y++) for (let i = 0; i < CHUNK * CHUNK; i += 3) if (cells[localIndex(i & 15, y, i >> 4)] === AIR) air[y]!++;
  }
  let best = 52, score = -1;
  for (let deck = 44; deck <= 56; deck++) {
    const open = air[deck + 1]! + air[deck + 2]! + air[deck + 3]! + air[deck + 6]! - Math.abs(deck - 50) * 4;
    if (open > score) { best = deck; score = open; }
  }
  return best;
}

const inside = (x: number, z: number) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;

/** Plan one fortress whose hub is centred on (x, z): its four arms in a seeded order, baked into chunk buckets. */
function planFortress(seed: number, x: number, z: number, n: number): Built {
  const plan: Plan = { rng: createRng(hash3(seed ^ SALT, x, z, n)), cells: new Map(), piers: [], spawners: [] };
  const rng = plan.rng, deck = deckHeight(seed, x, z), f = rngInt(rng, 0, 3), hub = new Piece(plan, x, deck, z, f).next(-3, 0);
  const exits = crossing(hub), arms = [...ARMS];
  for (let i = arms.length - 1; i > 0; i--) { const j = rngInt(rng, 0, i); [arms[i], arms[j]] = [arms[j]!, arms[i]!]; }
  [exits.ahead, exits.right, exits.back, exits.left].forEach((exit, i) => arms[i]!(exit));
  const bp = new Blueprint();
  // Each pier is two foundation runs, so it reaches the lava sea floor (the second starts where an unfinished first ends).
  for (const [px, py, pz] of plan.piers) if (inside(px, pz)) for (const y of [py, py - PIER_DEPTH]) bp.op(OP.foundation, px, y, pz, NB);
  for (const [index, cell] of plan.cells) {
    const [cx, cy, cz] = cellXYZ(index);
    if (!inside(cx, cz)) continue;
    if (cell !== FENCE) { bp.set(cx, cy, cz, cell); continue; }
    let bits = 0;
    FACING.forEach(([dx, dz], dir) => {
      const near = plan.cells.get(cellIndex(cx + dx, cy, cz + dz)) ?? AIR;
      if (cellId(near) === FENCE || isFullCube(near)) bits |= 1 << dir;
    });
    bp.set(cx, cy, cz, makeCell(FENCE, bits));
  }
  const bounds = bp.bounds;
  bounds[1] = Math.max(1, bounds[1] - PIER_DEPTH + 1);
  return { center: [x, deck + 1, z], bounds, spawners: plan.spawners.filter(([sx, , sz]) => inside(sx, sz)), chunks: bp.bake() };
}

/** The Nether point a portal at the world spawn leads to (portals.ts: 8:1, clamped inside the margin). */
export function netherSpawnPoint(seed: number): [number, number] {
  const [sx, , sz] = findSpawn(seed), clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return [clamp(NETHER.x0 + Math.floor(sx / 8), NETHER.x0 + 8, NETHER.x0 + 503), clamp(NETHER.z0 + Math.floor(sz / 8), 8, 503)];
}

const cache = new Map<number, Built[]>();
/**
 * The fortresses of a world, planned once per seed. The first hub sits 24–60 blocks from the spawn's Nether point (pulled
 * inside the region); 2–3 more go at seeded spots, kept when they fit inside the region and stay 64 blocks from the others.
 */
function fortresses(seed: number): Built[] {
  let list = cache.get(seed);
  if (list) return list;
  const rng = createRng(hash3(seed, SALT, 0, 1)), [tx, tz] = netherSpawnPoint(seed), hold = 64, span = NETHER.size - 2 * hold;
  let dx = 0, dz = 0;
  do { dx = rngInt(rng, -60, 60); dz = rngInt(rng, -60, 60); } while (dx * dx + dz * dz < 24 * 24 || dx * dx + dz * dz > 60 * 60);
  const pull = (v: number, lo: number) => Math.min(lo + span, Math.max(lo, v));
  list = [planFortress(seed, pull(tx + dx, NETHER.x0 + hold), pull(tz + dz, NETHER.z0 + hold), 0)];
  const want = 3 + (rng() < 0.5 ? 1 : 0), fits = (b: Bounds) => b[0] >= X0 && b[3] <= X1 && b[2] >= Z0 && b[5] <= Z1;
  for (let attempt = 0; attempt < 48 && list.length < want; attempt++) {
    const x = NETHER.x0 + hold + rngInt(rng, 0, span), z = NETHER.z0 + hold + rngInt(rng, 0, span);
    if (list.some(f => Math.abs(f.center[0] - x) < 150 && Math.abs(f.center[2] - z) < 150 && (f.center[0] - x) * (f.center[0] - x) + (f.center[2] - z) * (f.center[2] - z) < 150 * 150)) continue;
    const next = planFortress(seed, x, z, list.length);
    if (fits(next.bounds) && !list.some(f => overlaps(boundsRect(f.bounds), boundsRect(next.bounds), GAP))) list.push(next);
  }
  if (cache.size >= SEED_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(seed, list);
  return list;
}

/** Every fortress of a world (deterministic from the seed): hub centre (feet height on the deck), bounds and spawner cells. */
export function fortressesOf(seed: number): readonly Fortress[] {
  return fortresses(seed).map(({ center, bounds, spawners }) => ({ center: [...center] as Vec3, bounds: [...bounds] as Bounds, spawners: spawners.map(s => [...s] as Vec3) }));
}

/** Paint the fortress pieces that intersect Nether chunk (cx, cz) into `cells` (after the Nether terrain). */
export function paintFortress(seed: number, cx: number, cz: number, cells: Uint16Array): void {
  const key = chunkKey(cx, cz);
  for (const fortress of fortresses(seed)) {
    const ops = fortress.chunks.get(key);
    if (ops) paintOps(ops, cx * CHUNK, cz * CHUNK, cells);
  }
}
