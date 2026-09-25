/** Axis-separated AABB movement for mobs and item entities (the same Y-X-Z sweep as player physics, any box size). */
import type { CellReader } from '../shared/chunk';
import { collectBoxes } from '../shared/physics';

export type Mover = { x: number; y: number; z: number; vx: number; vy: number; vz: number; onGround: boolean };
export type MoveResult = { hitX: boolean; hitY: boolean; hitZ: boolean };

const EPS = 1e-7, boxes: number[] = [];
function clip(box: number[], axis: number, distance: number): number {
  const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
  for (let i = 0; i < boxes.length && distance !== 0; i += 6) {
    if (boxes[i + a1 + 3]! <= box[a1]! + EPS || boxes[i + a1]! >= box[a1 + 3]! - EPS) continue;
    if (boxes[i + a2 + 3]! <= box[a2]! + EPS || boxes[i + a2]! >= box[a2 + 3]! - EPS) continue;
    if (distance > 0 && boxes[i + axis]! >= box[axis + 3]! - EPS) distance = Math.min(distance, Math.max(0, boxes[i + axis]! - box[axis + 3]!));
    else if (distance < 0 && boxes[i + axis + 3]! <= box[axis]! + EPS) distance = Math.max(distance, Math.min(0, boxes[i + axis + 3]! - box[axis]!));
  }
  return distance;
}

/** Sweep `box` by (dx, dy, dz) in Y-X-Z order against the cells around it; returns the applied displacement. */
function sweep(get: CellReader, box: number[], dx: number, dy: number, dz: number): [number, number, number] {
  collectBoxes(get, Math.min(box[0]!, box[0]! + dx) - EPS, Math.min(box[1]!, box[1]! + dy) - EPS, Math.min(box[2]!, box[2]! + dz) - EPS,
    Math.max(box[3]!, box[3]! + dx) + EPS, Math.max(box[4]!, box[4]! + dy) + EPS, Math.max(box[5]!, box[5]! + dz) + EPS, boxes);
  const my = clip(box, 1, dy);
  box[1] += my; box[4] += my;
  const mx = clip(box, 0, dx);
  box[0] += mx; box[3] += mx;
  const mz = clip(box, 2, dz);
  box[2] += mz; box[5] += mz;
  return [mx, my, mz];
}

/**
 * Move a feet-centred box (footprint `width`, `height`) by its velocity × dt against block collision.
 * Sub-steps keep each move under half a block so fast knockback cannot tunnel. Zeroes blocked velocity components.
 * With `stepHeight`, a grounded body blocked sideways steps up onto anything that low (paths, sills, slabs), like players.
 */
export function moveBody(get: CellReader, body: Mover, width: number, height: number, dt: number, stepHeight = 0): MoveResult {
  const result: MoveResult = { hitX: false, hitY: false, hitZ: false };
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(body.vx), Math.abs(body.vy), Math.abs(body.vz)) * dt / 0.45));
  const h = width / 2, step = dt / steps;
  let grounded = false;
  for (let s = 0; s < steps; s++) {
    const dx = body.vx * step, dy = body.vy * step, dz = body.vz * step;
    let box = [body.x - h, body.y, body.z - h, body.x + h, body.y + height, body.z + h];
    const start = box.slice();
    let [mx, my, mz] = sweep(get, box, dx, dy, dz), landed = dy < 0 && Math.abs(my - dy) > EPS;
    if (stepHeight && dy <= 0 && (body.onGround || landed) && (Math.abs(mx - dx) > EPS || Math.abs(mz - dz) > EPS)) {
      // Rise only as far as the ceiling over the whole move allows (MC), so a tall villager fits under a door lintel.
      const ahead = [Math.min(start[0]!, start[0]! + dx), start[1]!, Math.min(start[2]!, start[2]! + dz), Math.max(start[3]!, start[3]! + dx), start[4]!, Math.max(start[5]!, start[5]! + dz)];
      const up = sweep(get, ahead, 0, stepHeight, 0)[1], stepped = start.slice();
      stepped[1] += up;
      stepped[4] += up;
      const [ax, , az] = sweep(get, stepped, dx, 0, dz), fall = Math.min(dy, 0) - up, down = sweep(get, stepped, 0, fall, 0)[1];
      if (ax * ax + az * az > mx * mx + mz * mz + EPS) {
        box = stepped;
        [mx, my, mz] = [ax, up + down, az];
        landed = Math.abs(down - fall) > EPS;
      }
    }
    body.x = (box[0]! + box[3]!) / 2;
    body.y = box[1]!;
    body.z = (box[2]! + box[5]!) / 2;
    if (landed) grounded = true;
    if (landed || Math.abs(my - dy) > EPS && dy >= 0) {
      body.vy = 0;
      result.hitY = true;
    }
    if (Math.abs(mx - dx) > EPS) { body.vx = 0; result.hitX = true; }
    if (Math.abs(mz - dz) > EPS) { body.vz = 0; result.hitZ = true; }
  }
  body.onGround = grounded;
  return result;
}
