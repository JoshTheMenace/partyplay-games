import { blockOf } from './blocks';
import type { CellReader } from './chunk';
import type { Vec3 } from './coords';
import { selectionBoxes, type Box } from './shapes';

/** A ray hit on a block: the cell, the face hit (0..5 = -X,+X,-Y,+Y,-Z,+Z), the world-space hit point and distance. */
export type BlockHit = { x: number; y: number; z: number; face: number; cell: number; point: Vec3; distance: number };
export type AabbHit = { distance: number; face: number };

/**
 * Slab test of a ray against a world-space box [x0,y0,z0,x1,y1,z1]. `dir` need not be normalised; distance is in units of |dir|.
 * A ray starting inside the box hits at distance 0 on the face it is heading towards.
 */
export function rayAabb(origin: Readonly<Vec3>, dir: Readonly<Vec3>, box: Box, maxDistance = Infinity): AabbHit | null {
  let near = -Infinity, far = Infinity, face = -1, exitFace = -1;
  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis]!, d = dir[axis]!, lo = box[axis]!, hi = box[axis + 3]!;
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const t0 = (lo - o) / d, t1 = (hi - o) / d;
    const enter = Math.min(t0, t1), exit = Math.max(t0, t1);
    // Entering through the min side means the hit face points negative along this axis.
    if (enter > near) { near = enter; face = axis * 2 + (d > 0 ? 0 : 1); }
    if (exit < far) { far = exit; exitFace = axis * 2 + (d > 0 ? 1 : 0); }
    if (near > far) return null;
  }
  if (far < 0 || near > maxDistance) return null;
  return near >= 0 ? { distance: near, face } : { distance: 0, face: exitFace };
}

/**
 * Voxel DDA from `origin` along `dir` (normalised internally) up to `maxDistance`, testing each cell's selection boxes.
 * `accept` can skip cells (defaults to targetable blocks).
 */
export function raycastBlocks(getCell: CellReader, origin: Readonly<Vec3>, dir: Readonly<Vec3>, maxDistance: number, accept: (cell: number) => boolean = cell => blockOf(cell).targetable): BlockHit | null {
  const length = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(length > 0)) return null;
  const d: Vec3 = [dir[0] / length, dir[1] / length, dir[2] / length];
  const cell: Vec3 = [Math.floor(origin[0]), Math.floor(origin[1]), Math.floor(origin[2])];
  const step: Vec3 = [0, 0, 0], next: Vec3 = [Infinity, Infinity, Infinity], delta: Vec3 = [Infinity, Infinity, Infinity];
  for (let axis = 0; axis < 3; axis++) {
    const v = d[axis]!;
    if (v === 0) continue;
    step[axis] = v > 0 ? 1 : -1;
    delta[axis] = Math.abs(1 / v);
    const boundary = v > 0 ? cell[axis]! + 1 : cell[axis]!;
    next[axis] = (boundary - origin[axis]!) / v;
  }
  let travelled = 0;
  while (travelled <= maxDistance) {
    const value = getCell(cell[0], cell[1], cell[2]);
    if (accept(value)) {
      let best: AabbHit | null = null;
      for (const b of selectionBoxes(value)) {
        const hit = rayAabb(origin, d, [cell[0] + b[0], cell[1] + b[1], cell[2] + b[2], cell[0] + b[3], cell[1] + b[4], cell[2] + b[5]], maxDistance);
        if (hit && (!best || hit.distance < best.distance)) best = hit;
      }
      if (best) {
        const t = best.distance;
        return { x: cell[0], y: cell[1], z: cell[2], face: best.face, cell: value, distance: t, point: [origin[0] + d[0] * t, origin[1] + d[1] * t, origin[2] + d[2] * t] };
      }
    }
    const axis = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : (next[1] < next[2] ? 1 : 2);
    travelled = next[axis]!;
    cell[axis] += step[axis]!;
    next[axis] += delta[axis]!;
  }
  return null;
}
