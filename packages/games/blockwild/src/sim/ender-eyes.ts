/**
 * Eyes of ender: thrown eyes (projectile k 3) that lead to the nearest stronghold, eyes placed into end portal frames,
 * opening the portal once a ring of twelve is complete, and travel into the End through it.
 *
 * A thrown eye rises and glides up to 12 blocks towards the nearest stronghold's portal room (Overworld only; elsewhere it
 * just drifts down), hovers for a second, then drops as an item (80%) or shatters (20%). Close to the room it stops right
 * above the room's door, so "dig down where it drops" lands you on the floor inside, never in the lava under the portal.
 */
import type { CellReader } from '../shared/chunk';
import { B, cellId, cellState, FRAME_EYE, frameFacing, isSolid } from '../shared/blocks';
import { dimensionAt, EDIT_LIMIT_TOAST } from '../shared/constants';
import { FACING, lookVector, type Vec3 } from '../shared/coords';
import { I } from '../shared/ids';
import { takeOne } from '../shared/inventory';
import { bodyBox, eyeHeight } from '../shared/physics';
import { PK } from '../shared/protocol';
import { raycastBlocks } from '../shared/raycast';
import { strongholdSites } from '../shared/structures/stronghold';
import { spawnArrow } from './combat';
import { arriveInEnd } from './end';
import { spawnItem } from './entities';
import { addFx, dist2, toast, type Player, type State } from './state';
import { writeCell, writeCells } from './world';

/** A thrown eye's goal (where it glides to and hovers) and whether it survives the trip. */
type Flight = { x: number; y: number; z: number; drop: boolean };
/** Eye server state, created with the world and not saved (eyes in flight are lost on reload, like arrows). */
export type EyeState = { flights: Map<number, Flight> };
export const newEyeState = (): EyeState => ({ flights: new Map() });

/** Glide distance, rise above the eye when far, glide and hover seconds, glide pull (1/s) and top speed (m/s), and the portal's loud radius. */
const RANGE = 12, RISE = 2.5, GLIDE = 1.8, HOVER = 1, PULL = 2.4, TOP_SPEED = 9, LOUD = 64;
export const EYE_DROP_CHANCE = 0.8;

/** Where eyes thrown at (x, z) lead: the door cell inside the nearest stronghold's portal room (by distance to the room). */
export function eyeGoal(seed: number, x: number, z: number): Vec3 {
  const sites = strongholdSites(seed);
  const near = sites.reduce((best, site) => dist2(site.center[0], 0, site.center[2], x, 0, z) < dist2(best.center[0], 0, best.center[2], x, 0, z) ? site : best);
  return near.landing;
}

/** `useItem` with an eye of ender (not aimed at a frame): throw it. One eye in flight per player. */
export function throwEye(state: State, player: Player, slot: number): boolean {
  const stack = player.inv[slot];
  if (stack?.id !== I.ender_eye || player.dead || state.arrows.some(a => a.k === PK.EYE && a.shooter === player.id && a.age !== Infinity)) return false;
  const from: Vec3 = [player.x, player.y + eyeHeight(player), player.z], overworld = dimensionAt(player.x, player.z) === 'overworld';
  let goal: Vec3;
  if (overworld) {
    const [gx, , gz] = eyeGoal(state.settings.seed, player.x, player.z), dx = gx + 0.5 - player.x, dz = gz + 0.5 - player.z, d = Math.hypot(dx, dz) || 1;
    const k = Math.min(RANGE, d) / d;
    goal = [player.x + dx * k, from[1] + (d > RANGE ? RISE : 1), player.z + dz * k];
  } else {
    const [lx, , lz] = lookVector(player.yaw, 0);
    goal = [player.x + lx * 1.5, from[1] + 0.6, player.z + lz * 1.5];
  }
  // Stop short of a wall or ceiling in the way, so the eye (and the item it drops) stays in the open.
  const path: Vec3 = [goal[0] - from[0], goal[1] - from[1], goal[2] - from[2]], length = Math.hypot(...path), hit = raycastBlocks(state.getLoaded, from, path, length, isSolid);
  if (hit) {
    const k = Math.max(0, hit.distance - 0.6) / length;
    goal = [from[0] + path[0] * k, from[1] + path[1] * k, from[2] + path[2] * k];
  }
  const eye = spawnArrow(state, from[0], from[1], from[2], 0, 0, 0, 0, player.id, false, PK.EYE);
  state.eyes.flights.set(eye.id, { x: goal[0], y: goal[1], z: goal[2], drop: !overworld || state.rand() < EYE_DROP_CHANCE });
  if (state.settings.mode === 'survival') player.inv[slot] = takeOne(stack);
  if (!overworld) toast(player, 'The eye drifts down. Strongholds are only in the Overworld.');
  player.swing++;
  return true;
}

/** Every tick from tickArrows: glide thrown eyes to their goal, bob there, then drop or shatter them. */
export function tickEyes(state: State, dt: number): void {
  const flights = state.eyes.flights;
  for (const eye of state.arrows) {
    if (eye.k !== PK.EYE || eye.age === Infinity) continue;
    const flight = flights.get(eye.id);
    if (!flight) { eye.age = Infinity; continue; }
    eye.age += dt;
    if (eye.age >= GLIDE + HOVER) {
      eye.age = Infinity;
      flights.delete(eye.id);
      if (flight.drop) spawnItem(state, eye.x, eye.y, eye.z, { id: I.ender_eye, n: 1 }, { vx: 0, vy: 1, vz: 0 });
      else addFx(state, 'shatter', eye.x, eye.y, eye.z);
      continue;
    }
    // Ease towards the goal (fast at first, capped), then bob gently while hovering.
    let vx = (flight.x - eye.x) * PULL, vy = (flight.y - eye.y) * PULL, vz = (flight.z - eye.z) * PULL;
    const speed = Math.hypot(vx, vy, vz);
    if (speed > TOP_SPEED) { vx *= TOP_SPEED / speed; vy *= TOP_SPEED / speed; vz *= TOP_SPEED / speed; }
    if (eye.age > GLIDE) vy += Math.sin((eye.age - GLIDE) * 9) * 0.35;
    Object.assign(eye, { vx, vy, vz, x: eye.x + vx * dt, y: eye.y + vy * dt, z: eye.z + vz * dt });
  }
  // Eyes dropped from the projectile list elsewhere (the projectile cap) leave no flight behind.
  if (flights.size) for (const id of flights.keys()) if (!state.arrows.some(a => a.id === id)) flights.delete(id);
}

/** True when the ring of 12 frames around the 3 × 3 portal centred on (cx, y, cz) all hold eyes and face the centre. */
function ringComplete(get: CellReader, cx: number, y: number, cz: number): boolean {
  return FACING.every(([dx, dz], side) => {
    const [px, pz] = FACING[(side + 1) & 3]!;
    for (let k = -1; k <= 1; k++) {
      const cell = get(cx + dx * 2 + px * k, y, cz + dz * 2 + pz * k);
      if (cellId(cell) !== B.end_portal_frame || !(cellState(cell) & FRAME_EYE) || frameFacing(cellState(cell)) !== ((side + 2) & 3)) return false;
    }
    return true;
  });
}
/** The centre of the complete ring the frame at (x, y, z) belongs to (it faces that centre), or null. */
export function findPortalRing(get: CellReader, x: number, y: number, z: number): Vec3 | null {
  const cell = get(x, y, z);
  if (cellId(cell) !== B.end_portal_frame) return null;
  const facing = frameFacing(cellState(cell)), [dx, dz] = FACING[facing]!, [px, pz] = FACING[(facing + 1) & 3]!;
  for (let k = -1; k <= 1; k++) if (ringComplete(get, x + dx * 2 + px * k, y, z + dz * 2 + pz * k)) return [x + dx * 2 + px * k, y, z + dz * 2 + pz * k];
  return null;
}

/**
 * Fill the ring's 3 × 3 middle with end portal (once), with a loud effect and a toast for everyone within 64 blocks.
 * True when it is open (or already was); false when the edit limit is in the way.
 */
function openPortal(state: State, [cx, y, cz]: Vec3): boolean {
  const writes: [number, number, number, number][] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (cellId(state.get(cx + dx, y, cz + dz)) !== B.end_portal) writes.push([cx + dx, y, cz + dz, B.end_portal]);
  if (!writes.length) return true;
  if (!writeCells(state, writes)) return false;
  addFx(state, 'portalOpen', cx + 0.5, y + 0.75, cz + 0.5);
  for (const player of state.players) if (player.connected && dist2(player.x, player.y, player.z, cx + 0.5, y, cz + 0.5) <= LOUD * LOUD) toast(player, 'The End portal is open!');
  return true;
}

/**
 * `use` on an end_portal_frame at (x, y, z): insert the held eye of ender into an empty frame, and open the portal when
 * the ring is complete. The last eye only goes in if the portal can open too, so the edit limit never leaves a full,
 * closed ring.
 */
export function useEndFrame(state: State, player: Player, x: number, y: number, z: number): boolean {
  const cell = state.get(x, y, z), stack = player.inv[player.slot];
  if (cellId(cell) !== B.end_portal_frame || cellState(cell) & FRAME_EYE || stack?.id !== I.ender_eye) return false;
  const placed = writeCell(state, x, y, z, cell | FRAME_EYE << 8), ring = placed && findPortalRing(state.get, x, y, z);
  if (!placed || ring && !openPortal(state, ring)) {
    if (placed) writeCell(state, x, y, z, cell);
    toast(player, EDIT_LIMIT_TOAST);
    return false;
  }
  if (state.settings.mode === 'survival') player.inv[player.slot] = takeOne(stack);
  addFx(state, 'eye', x + 0.5, y + 13 / 16, z + 0.5);
  player.swing++;
  return true;
}

/** True when the player's body overlaps the thin end portal plane (the lower 12/16 of an end_portal cell). */
function touchesEndPortal(get: CellReader, player: Player): boolean {
  const [x0, y0, z0, x1, y1, z1] = bodyBox(player);
  for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let z = Math.floor(z0); z <= Math.floor(z1); z++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
    if (cellId(get(x, y, z)) === B.end_portal && y0 < y + 0.75 && y1 > y) return true;
  }
  return false;
}
/** Every tick after tickPortals: players touching an end portal outside the End travel there (end.arriveInEnd). */
export function tickEndPortalTravel(state: State, _dt: number): void {
  for (const player of state.players) {
    if (!player.connected || player.dead || dimensionAt(player.x, player.z) === 'end') continue;
    if (touchesEndPortal(state.getLoaded, player)) arriveInEnd(state, player);
  }
}
