/**
 * Mineshafts: an underground dirt-floored room with 3 × 3 corridors branching out up to ~90 blocks through crossings and
 * stairs down. Corridors have oak fence posts and plank beams every 4 blocks, plank floors where they cross caves,
 * cobwebs, a few torches, chests in side niches and, rarely, a cave-spider-style spawner smothered in cobwebs.
 */
import { B, CHEST_LOOT, makeCell } from '../blocks';
import { FACING, type Vec3 } from '../coords';
import { createRng, hash3, rand3, rngInt, type Rng } from '../noise';
import { MOB } from '../protocol';
import { surfaceHeight } from '../worldgen';
import { Blueprint, boxesTouch, OP, type Bounds } from './builder';

export type MineshaftPlan = { center: Vec3; bp: Blueprint };
/** Horizontal reach from the start room, the piece budget and the rock kept between a piece and the surface. */
export const MINESHAFT_REACH = 88;
const MAX_PIECES = 44, MAX_DEPTH = 9, COVER = 6;

type Exit = { x: number; y: number; z: number; dir: number; depth: number };
type Shaft = { seed: number; sx: number; sz: number; rng: Rng; bp: Blueprint; pieces: Bounds[]; queue: Exit[] };

export function planMineshaft(seed: number, x: number, z: number): MineshaftPlan | null {
  const rng = createRng(hash3(seed, x, z, 0x3a1f5)), y = rngInt(rng, 26, 42);
  if (surfaceHeight(seed, x, z) < y + 14) return null;
  const shaft: Shaft = { seed, sx: x, sz: z, rng, bp: new Blueprint(), pieces: [], queue: [] };
  room(shaft, x, y, z);
  while (shaft.queue.length && shaft.pieces.length < MAX_PIECES) {
    const exit = shaft.queue.shift()!, roll = rng();
    if (exit.depth > MAX_DEPTH) continue;
    if (roll < 0.62 || exit.depth === 0) corridor(shaft, exit);
    else if (roll < 0.84) crossing(shaft, exit);
    else stairs(shaft, exit);
  }
  return shaft.pieces.length >= 4 ? { center: [x, y, z], bp: shaft.bp } : null;
}

/** Cells of a 3-wide strip: centreline step t from `exit`, offset o across it. */
const along = (exit: Exit, t: number, o: number): [number, number] => {
  const [dx, dz] = FACING[exit.dir]!, [px, pz] = FACING[(exit.dir + 1) & 3]!;
  return [exit.x + dx * t + px * o, exit.z + dz * t + pz * o];
};
function stripBounds(exit: Exit, len: number, y0: number, y1: number, half = 1): Bounds {
  const [ax, az] = along(exit, 0, -half), [bx, bz] = along(exit, len - 1, half);
  return [Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz)];
}
/** A piece fits if it stays in reach, above the deep caves, well under the surface and clear of every other piece. */
function fits(shaft: Shaft, box: Bounds): boolean {
  if (box[1] < 8 || Math.max(Math.abs(box[0] - shaft.sx), Math.abs(box[3] - shaft.sx), Math.abs(box[2] - shaft.sz), Math.abs(box[5] - shaft.sz)) > MINESHAFT_REACH) return false;
  if (shaft.pieces.some(other => boxesTouch(box, other))) return false;
  for (const [x, z] of [[box[0], box[2]], [box[3], box[2]], [box[0], box[5]], [box[3], box[5]], [(box[0] + box[3]) >> 1, (box[2] + box[5]) >> 1]] as const) {
    if (surfaceHeight(shaft.seed, x, z) < box[4] + COVER) return false;
  }
  return true;
}
const carve = (bp: Blueprint, x: number, y: number, z: number) => bp.set(x, y, z, B.air);
/** Plank floor under a walkway cell wherever the rock below is missing (caves). */
const floor = (bp: Blueprint, x: number, y: number, z: number) => bp.op(OP.fill, x, y - 1, z, B.oak_planks);

/** The start: a dirt-floored room with an exit in each wall. */
function room(shaft: Shaft, x: number, y: number, z: number) {
  const { bp, rng } = shaft, hw = rngInt(rng, 3, 5), hd = rngInt(rng, 3, 5);
  for (let dz = -hd; dz <= hd; dz++) for (let dx = -hw; dx <= hw; dx++) {
    bp.set(x + dx, y - 1, z + dz, B.dirt);
    for (let dy = 0; dy < 4; dy++) carve(bp, x + dx, y + dy, z + dz);
  }
  shaft.pieces.push([x - hw, y - 1, z - hd, x + hw, y + 3, z + hd]);
  const exits: [number, number, number][] = [[x + rngInt(rng, 1 - hw, hw - 1), z - hd - 1, 0], [x + hw + 1, z + rngInt(rng, 1 - hd, hd - 1), 1],
    [x + rngInt(rng, 1 - hw, hw - 1), z + hd + 1, 2], [x - hw - 1, z + rngInt(rng, 1 - hd, hd - 1), 3]];
  for (const [ex, ez, dir] of exits) shaft.queue.push({ x: ex, y, z: ez, dir, depth: 0 });
}

/** A straight 3 × 3 corridor of 2–5 sections of 4 blocks, with supports, webs, torches and sometimes a chest or spawner. */
function corridor(shaft: Shaft, exit: Exit) {
  const { bp, rng, seed } = shaft, y = exit.y;
  let len = 4 * rngInt(rng, 2, 5);
  while (len >= 4 && !fits(shaft, stripBounds(exit, len, y - 1, y + 2))) len -= 4;
  if (len < 4) return;
  shaft.pieces.push(stripBounds(exit, len, y - 1, y + 2));
  for (let t = 0; t < len; t++) for (let o = -1; o <= 1; o++) {
    const [x, z] = along(exit, t, o);
    floor(bp, x, y, z);
    for (let dy = 0; dy < 3; dy++) carve(bp, x, y + dy, z);
    if (t % 4 === 2) {
      if (o) { bp.op(OP.fence, x, y, z, B.oak_fence); bp.op(OP.fence, x, y + 1, z, B.oak_fence); }
      bp.set(x, y + 2, z, B.oak_planks);
    } else if (rand3(seed + 17, x, y, z) < 0.045) {
      // Webs hang along the walls and under the ceiling, leaving the middle of the walkway passable.
      bp.set(x, y + (o ? hash3(seed, x, y, z) % 3 : 2), z, B.cobweb);
    }
  }
  for (let t = 2; t + 1 < len; t += 4) if (rng() < 0.3) {
    const [x, z] = along(exit, t + 1, 0);
    bp.set(x, y + 2, z, makeCell(B.torch, 1 + exit.dir));
  }
  if (rng() < 0.28) {
    const t = 4 * rngInt(rng, 0, len / 4 - 1) + (rng() < 0.5 ? 0 : 1), side = rng() < 0.5 ? 2 : -2, [x, z] = along(exit, t, side);
    floor(bp, x, y, z);
    bp.set(x, y, z, makeCell(B.chest, ((exit.dir + (side > 0 ? 3 : 1)) & 3) | CHEST_LOOT.mineshaft << 2));
  }
  if (rng() < 0.05 && len >= 8) spiderNest(shaft, exit, len >> 1);
  if (rng() < 0.93) {
    const [x, z] = along(exit, len, 0);
    shaft.queue.push({ x, y, z, dir: exit.dir, depth: exit.depth + 1 });
  }
  if (len >= 12 && rng() < 0.45) {
    const side = rng() < 0.5 ? 1 : 3, [x, z] = along(exit, (len >> 1) & ~3, side === 1 ? 2 : -2);
    shaft.queue.push({ x, y, z, dir: (exit.dir + side) & 3, depth: exit.depth + 1 });
  }
}

/** A spider spawner in the middle of a corridor, the air around it thick with cobwebs. */
function spiderNest(shaft: Shaft, exit: Exit, t0: number) {
  const { bp, seed } = shaft, y = exit.y;
  for (let t = t0 - 2; t <= t0 + 2; t++) for (let o = -1; o <= 1; o++) for (let dy = 0; dy < 3; dy++) {
    const [x, z] = along(exit, t, o);
    if (t % 4 !== 2 && rand3(seed + 19, x, y + dy, z) < 0.55) bp.set(x, y + dy, z, B.cobweb);
  }
  const [x, z] = along(exit, t0 % 4 === 2 ? t0 + 1 : t0, 0);
  bp.set(x, y, z, makeCell(B.monster_spawner, MOB.spider));
}

/** A 5 × 5 crossing with plank pillars in its corners and exits ahead and to both sides. */
function crossing(shaft: Shaft, exit: Exit) {
  const { bp, rng } = shaft, y = exit.y, [cx, cz] = along(exit, 2, 0), box: Bounds = [cx - 2, y - 1, cz - 2, cx + 2, y + 2, cz + 2];
  if (!fits(shaft, box)) return;
  shaft.pieces.push(box);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
    floor(bp, cx + dx, y, cz + dz);
    for (let dy = 0; dy < 3; dy++) bp.set(cx + dx, y + dy, cz + dz, corner ? B.oak_planks : B.air);
  }
  if (rng() < 0.4) bp.set(cx, y + 2, cz, B.oak_planks);
  for (const turn of [0, 1, 3]) if (rng() < 0.8) {
    const dir = (exit.dir + turn) & 3, [dx, dz] = FACING[dir]!;
    shaft.queue.push({ x: cx + dx * 3, y, z: cz + dz * 3, dir, depth: exit.depth + 1 });
  }
}

/** Five steps down, then a corridor onwards from the bottom. */
function stairs(shaft: Shaft, exit: Exit) {
  const { bp } = shaft, y = exit.y, box = stripBounds(exit, 5, y - 6, y + 2);
  if (y - 5 < 12 || !fits(shaft, box)) return;
  shaft.pieces.push(box);
  for (let k = 0; k < 5; k++) for (let o = -1; o <= 1; o++) {
    const [x, z] = along(exit, k, o), yk = y - 1 - k;
    floor(bp, x, yk, z);
    for (let dy = 0; dy < 4; dy++) carve(bp, x, yk + dy, z);
  }
  const [x, z] = along(exit, 5, 0);
  shaft.queue.push({ x, y: y - 5, z, dir: exit.dir, depth: exit.depth + 1 });
}
