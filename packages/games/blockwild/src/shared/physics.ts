import { blockOf, isLava, isWater } from './blocks';
import type { CellReader } from './chunk';
import {
  EYE_HEIGHT, FLY_SPEED, FLY_VERTICAL, GRAVITY, JUMP_VELOCITY, LADDER_SPEED, MAX_SUBSTEP, PLAYER_HEIGHT, PLAYER_WIDTH, SNEAK_EYE_HEIGHT, SNEAK_HEIGHT,
  SNEAK_SPEED, SPRINT_SPEED, STEP_HEIGHT, SWIM_SPEED, TERMINAL_VELOCITY, WALK_SPEED,
} from './constants';
import { collisionBoxes, selectionBoxes } from './shapes';

/** Player body; (x, z) is the footprint centre and y the feet. */
export type Body = { x: number; y: number; z: number; vx: number; vy: number; vz: number; onGround: boolean; inWater: boolean; onLadder: boolean; sneaking: boolean; flying: boolean };
/** forward/strafe in -1..1 (strafe +1 = right); yaw per coords.lookVector. */
export type MoveIntent = { forward: number; strafe: number; jump: boolean; sneak: boolean; sprint: boolean; flyDown: boolean; yaw: number };
export type GameMode = 'survival' | 'creative';

const HALF = PLAYER_WIDTH / 2, EPS = 1e-7, SNEAK_PROBE = 0.05;
export const newBody = (x: number, y: number, z: number): Body => ({ x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, inWater: false, onLadder: false, sneaking: false, flying: false });
export const bodyHeight = (body: Pick<Body, 'sneaking'>) => body.sneaking ? SNEAK_HEIGHT : PLAYER_HEIGHT;
export const eyeHeight = (body: Pick<Body, 'sneaking'>) => body.sneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT;
/** World-space AABB [x0,y0,z0,x1,y1,z1] of a body. */
export const bodyBox = (body: Pick<Body, 'x' | 'y' | 'z' | 'sneaking'>): [number, number, number, number, number, number] =>
  [body.x - HALF, body.y, body.z - HALF, body.x + HALF, body.y + bodyHeight(body), body.z + HALF];

/** Flat list (6 numbers each) of world-space collision boxes for every cell touching the region (plus fences rising from below). */
export function collectBoxes(getCell: CellReader, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: number[] = []): number[] {
  out.length = 0;
  const low = Math.floor(y0);
  for (let y = low - 1; y <= Math.floor(y1); y++) for (let z = Math.floor(z0); z <= Math.floor(z1); z++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
    for (const b of collisionBoxes(getCell(x, y, z))) if (y >= low || b[4] > 1) out.push(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
  }
  return out;
}
/** Movement effects of the cells a region overlaps: `walk` speed multiplier (soul sand, cobweb, lava), `drag` on vertical speed (non-solid cells you are inside), lava contact. */
export type Medium = { walk: number; drag: number; lava: boolean };
export function mediumAt(getCell: CellReader, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: Medium = { walk: 1, drag: 1, lava: false }): Medium {
  out.walk = out.drag = 1;
  out.lava = false;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let z = Math.floor(z0); z < Math.ceil(z1); z++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
    const cell = getCell(x, y, z), block = blockOf(cell);
    if (block.slow >= 1) continue;
    out.walk = Math.min(out.walk, block.slow);
    if (!block.solid) out.drag = Math.min(out.drag, block.slow);
    out.lava ||= isLava(cell);
  }
  return out;
}
/** True if the region overlaps any collision box by more than `tolerance` on every axis. */
export function regionCollides(getCell: CellReader, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tolerance = 0): boolean {
  const boxes = collectBoxes(getCell, x0, y0, z0, x1, y1, z1, scratch);
  for (let i = 0; i < boxes.length; i += 6) {
    if (boxes[i]! < x1 - tolerance && boxes[i + 3]! > x0 + tolerance && boxes[i + 1]! < y1 - tolerance && boxes[i + 4]! > y0 + tolerance && boxes[i + 2]! < z1 - tolerance && boxes[i + 5]! > z0 + tolerance) return true;
  }
  return false;
}
/** True if a body standing at (x, y, z) would be inside solid blocks (tolerance shrinks the test box; the server uses 0.05). */
export const bodyCollides = (getCell: CellReader, body: Pick<Body, 'x' | 'y' | 'z' | 'sneaking'>, tolerance = 0) => regionCollides(getCell, ...bodyBox(body), tolerance);
/** True if any cell overlapping the region matches `test` (partial shapes are tested with selection boxes). */
export function regionTouches(getCell: CellReader, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, test: (cell: number) => boolean): boolean {
  for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let z = Math.floor(z0); z <= Math.floor(z1); z++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
    const cell = getCell(x, y, z);
    if (!test(cell)) continue;
    if (isWater(cell)) return true;
    for (const b of selectionBoxes(cell)) if (x + b[0] < x1 && x + b[3] > x0 && y + b[1] < y1 && y + b[4] > y0 && z + b[2] < z1 && z + b[5] > z0) return true;
  }
  return false;
}
/** True when the eye is inside a water cell (underwater fog, drowning). */
export const eyeInWater = (getCell: CellReader, body: Body) => isWater(getCell(Math.floor(body.x), Math.floor(body.y + eyeHeight(body)), Math.floor(body.z)));

const scratch: number[] = [], sweep: number[] = [], medium: Medium = { walk: 1, drag: 1, lava: false }, AIR: Medium = { walk: 1, drag: 1, lava: false };
/** Clip a move of `distance` along `axis` for `box` against `boxes` (the standard voxel sweep: tunnelling-proof). */
function clip(boxes: number[], box: number[], axis: number, distance: number): number {
  const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
  for (let i = 0; i < boxes.length && distance !== 0; i += 6) {
    if (boxes[i + a1 + 3]! <= box[a1]! + EPS || boxes[i + a1]! >= box[a1 + 3]! - EPS) continue;
    if (boxes[i + a2 + 3]! <= box[a2]! + EPS || boxes[i + a2]! >= box[a2 + 3]! - EPS) continue;
    if (distance > 0 && boxes[i + axis]! >= box[axis + 3]! - EPS) distance = Math.min(distance, Math.max(0, boxes[i + axis]! - box[axis + 3]!));
    else if (distance < 0 && boxes[i + axis + 3]! <= box[axis]! + EPS) distance = Math.max(distance, Math.min(0, boxes[i + axis + 3]! - box[axis]!));
  }
  return distance;
}
const shift = (box: number[], axis: number, distance: number) => { box[axis] += distance; box[axis + 3] += distance; };

/** Move `box` by (dx, dy, dz) in Y, X, Z order against collisions; returns the applied displacement. */
function moveBox(getCell: CellReader, box: number[], dx: number, dy: number, dz: number): [number, number, number] {
  collectBoxes(getCell, Math.min(box[0]!, box[0]! + dx) - EPS, Math.min(box[1]!, box[1]! + dy) - EPS, Math.min(box[2]!, box[2]! + dz) - EPS,
    Math.max(box[3]!, box[3]! + dx) + EPS, Math.max(box[4]!, box[4]! + dy) + EPS, Math.max(box[5]!, box[5]! + dz) + EPS, sweep);
  const y = clip(sweep, box, 1, dy);
  shift(box, 1, y);
  const x = clip(sweep, box, 0, dx);
  shift(box, 0, x);
  const z = clip(sweep, box, 2, dz);
  shift(box, 2, z);
  return [x, y, z];
}

/** Sneak edge guard: shrink a horizontal move until solid ground stays within STEP_HEIGHT under the feet. */
function guardEdges(getCell: CellReader, box: number[], dx: number, dz: number): [number, number] {
  const supported = (ox: number, oz: number) => regionCollides(getCell, box[0]! + ox, box[1]! - STEP_HEIGHT, box[2]! + oz, box[3]! + ox, box[1]!, box[5]! + oz);
  const shrink = (v: number) => Math.abs(v) <= SNEAK_PROBE ? 0 : v - Math.sign(v) * SNEAK_PROBE;
  if (!supported(0, 0)) return [dx, dz];
  while (dx !== 0 && !supported(dx, 0)) dx = shrink(dx);
  while (dz !== 0 && !supported(0, dz)) dz = shrink(dz);
  while (dx !== 0 && dz !== 0 && !supported(dx, dz)) { dx = shrink(dx); dz = shrink(dz); }
  return [dx, dz];
}

const approach = (value: number, target: number, rate: number, dt: number) => value + (target - value) * (1 - Math.exp(-rate * dt));

function substep(body: Body, intent: MoveIntent, dt: number, getCell: CellReader, mode: GameMode) {
  if (mode !== 'creative') body.flying = false;
  // Stay crouched under a low ceiling.
  body.sneaking = !body.flying && (intent.sneak || body.sneaking && regionCollides(getCell, ...bodyBox({ ...body, sneaking: false })));
  const [x0, y0, z0, x1, y1, z1] = bodyBox(body), reach = 0.02;
  body.inWater = regionTouches(getCell, x0, y0, z0, x1, y1, z1, isWater);
  // Ladders are tested slightly wider so pressing flush against one still counts.
  body.onLadder = !body.flying && regionTouches(getCell, x0 - reach, y0, z0 - reach, x1 + reach, y1, z1 + reach, cell => blockOf(cell).climbable);
  // Soul sand slows walking; cobwebs and lava also hold you up. Lava swims like (slower) water.
  const { walk, drag, lava } = body.flying ? AIR : mediumAt(getCell, x0, y0, z0, x1, y1, z1, medium), liquid = body.inWater || lava;

  // Horizontal: accelerate towards the wished velocity (exponential approach keeps it frame-rate independent).
  let forward = intent.forward, strafe = intent.strafe;
  const magnitude = Math.hypot(forward, strafe);
  if (magnitude > 1) { forward /= magnitude; strafe /= magnitude; }
  const sin = Math.sin(intent.yaw), cos = Math.cos(intent.yaw);
  const speed = (body.flying ? FLY_SPEED : liquid ? SWIM_SPEED : body.sneaking ? SNEAK_SPEED : intent.sprint && forward > 0 ? SPRINT_SPEED : WALK_SPEED) * walk;
  const wishX = (-sin * forward + cos * strafe) * speed, wishZ = (-cos * forward - sin * strafe) * speed;
  const under = blockOf(getCell(Math.floor(body.x), Math.floor(body.y - 0.05), Math.floor(body.z)));
  const rate = body.flying ? 10 : liquid ? 6 : body.onGround ? (under.friction > 0.9 ? 1.5 : 20) : 5;
  body.vx = approach(body.vx, wishX, rate, dt);
  body.vz = approach(body.vz, wishZ, rate, dt);

  // Vertical.
  if (body.flying) {
    body.vy = approach(body.vy, intent.jump ? FLY_VERTICAL : intent.flyDown || intent.sneak ? -FLY_VERTICAL : 0, 12, dt);
  } else if (liquid && !body.onLadder) {
    // Sink slowly; water quickly brakes a fast fall. Hold jump to swim up.
    body.vy = intent.jump ? approach(body.vy, 3, 8, dt) : approach(body.vy, -2, body.vy < -2 ? 8 : 2, dt);
  } else {
    if (intent.jump && body.onGround) body.vy = JUMP_VELOCITY;
    body.vy = Math.max(body.vy - GRAVITY * dt, -TERMINAL_VELOCITY);
    if (body.onLadder) {
      body.vy = Math.max(body.vy, -LADDER_SPEED);
      if (intent.jump) body.vy = LADDER_SPEED;
      else if (body.sneaking) body.vy = Math.max(body.vy, 0);
    }
  }
  if (drag < 1) body.vy = Math.max(-8 * drag, Math.min(8 * drag, body.vy));

  const box = bodyBox(body);
  let dx = body.vx * dt, dz = body.vz * dt;
  const dy = body.vy * dt;
  if (body.onGround && body.sneaking && !body.flying) [dx, dz] = guardEdges(getCell, box, dx, dz);
  const start = box.slice();
  let moved = moveBox(getCell, box, dx, dy, dz);
  const blocked = moved[0] !== dx || moved[2] !== dz;
  // Step up onto slabs and half-height blocks (never full blocks: STEP_HEIGHT < 1).
  if (blocked && dy <= 0 && (body.onGround || moved[1] !== dy) && !body.flying) {
    const stepped = start.slice(), up = moveBox(getCell, stepped, 0, STEP_HEIGHT, 0)[1];
    const across = moveBox(getCell, stepped, dx, 0, dz), down = moveBox(getCell, stepped, 0, -up + Math.min(dy, 0), 0)[1];
    if (across[0] * across[0] + across[2] * across[2] > moved[0] * moved[0] + moved[2] * moved[2] + EPS) {
      for (let i = 0; i < 6; i++) box[i] = stepped[i]!;
      moved = [across[0], up + down, across[2]];
    }
  }
  body.x = (box[0]! + box[3]!) / 2;
  body.y = box[1]!;
  body.z = (box[2]! + box[5]!) / 2;
  const hitX = moved[0] !== dx, hitZ = moved[2] !== dz, hitY = Math.abs(moved[1] - dy) > EPS;
  body.onGround = hitY && dy < 0 || (moved[1] > EPS && dy <= 0);
  if (hitX) body.vx = 0;
  if (hitZ) body.vz = 0;
  if (hitY) body.vy = 0;
  if (body.onGround && body.flying) body.flying = false;
  if (hitX || hitZ) {
    if (body.onLadder && !body.sneaking) body.vy = LADDER_SPEED;
    else if (liquid && intent.jump) body.vy = 4.5 * drag;
  }
}

/**
 * Advance a body by dt seconds (sub-stepped at MAX_SUBSTEP). Deterministic for the same inputs; used by
 * client prediction and anything on the server that needs to simulate a player-sized body.
 */
export function stepBody(body: Body, intent: MoveIntent, dt: number, getCell: CellReader, mode: GameMode): void {
  const total = Math.min(Math.max(dt, 0), 0.5), steps = Math.max(1, Math.ceil(total / MAX_SUBSTEP - 1e-9));
  for (let i = 0; i < steps; i++) substep(body, intent, total / steps, getCell, mode);
}
