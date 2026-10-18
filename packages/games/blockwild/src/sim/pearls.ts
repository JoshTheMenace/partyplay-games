/**
 * Thrown ender pearls (projectile k 5): an arc under gravity; where one lands (a block or a mob) its thrower appears,
 * takes 5 fall damage (armor doesn't help, spawn protection does) and everyone sees the arrival. A pearl that falls into
 * the void, outlives 20 s or loses its thrower just vanishes, and one that lands where no body fits (or in a dimension
 * its thrower has since left) teleports nobody.
 */
import { isSolid } from '../shared/blocks';
import { dimensionAt } from '../shared/constants';
import { FACES, lookVector, type Vec3 } from '../shared/coords';
import { takeOne } from '../shared/inventory';
import { bodyCollides, eyeHeight } from '../shared/physics';
import { PK } from '../shared/protocol';
import { rayAabb, raycastBlocks } from '../shared/raycast';
import { damagePlayer, mobHitBoxes, spawnArrow } from './combat';
import { teleport } from './players';
import { addFx, playerById, type Arrow, type Player, type State } from './state';

/** Pearl server state: when each player (by id) may throw again. Created with the world and not saved. */
export type PearlState = { readyAt: Map<string, number> };
export const newPearlState = (): PearlState => ({ readyAt: new Map() });

export const PEARL_SPEED = 30, PEARL_GRAVITY = 12, PEARL_COOLDOWN = 1, PEARL_DAMAGE = 5, VOID_Y = -64;

/** `useItem` with an ender pearl in hotbar slot `slot`: throw it along the look (survival uses it up). False while cooling down. */
export function throwPearl(state: State, player: Player, slot: number): boolean {
  if (player.dead || state.clock < (state.pearls.readyAt.get(player.id) ?? 0)) return false;
  state.pearls.readyAt.set(player.id, state.clock + PEARL_COOLDOWN);
  if (state.settings.mode === 'survival') player.inv[slot] = takeOne(player.inv[slot] ?? null);
  const [dx, dy, dz] = lookVector(player.yaw, player.pitch), [ex, ey, ez] = [player.x, player.y + eyeHeight(player), player.z];
  spawnArrow(state, ex + dx * 0.4, ey + dy * 0.4 - 0.1, ez + dz * 0.4, dx * PEARL_SPEED, dy * PEARL_SPEED, dz * PEARL_SPEED, 0, player.id, false, PK.PEARL);
  player.swing++;
  return true;
}

/** Feet offsets tried around a landing point: standing on it, centred on it (walls), hanging under it (ceilings), a little up. */
const FEET = [0.01, -0.9, -1.81, -0.45, 0.5, 1.01];
/**
 * Where a player can stand for a pearl landing at `point`, pushed 0.31 off the hit face (`normal`); null when nothing
 * fits. Floors only try spots above the hit and ceilings only below it, so a pearl never carries anyone through a roof.
 */
function landing(state: State, point: Vec3, normal: Vec3): Vec3 | null {
  const x = point[0] + normal[0] * 0.31, z = point[2] + normal[2] * 0.31;
  for (const feet of FEET) {
    const y = point[1] + feet;
    if (normal[1] * feet >= 0 && !bodyCollides(state.getLoaded, { x, y, z, sneaking: false })) return [x, y, z];
  }
  return null;
}

/** Bring the thrower to a pearl's landing point (if a body fits there) and break the pearl. */
function land(state: State, pearl: Arrow, point: Vec3, normal: Vec3) {
  pearl.age = Infinity;
  const player = typeof pearl.shooter === 'string' ? playerById(state, pearl.shooter) : undefined, spot = landing(state, point, normal);
  addFx(state, 'pearl', ...point);
  // A thrower who changed dimension (a portal, a respawn) while the pearl flew stays where they are.
  if (!player || player.dead || !player.connected || !spot || dimensionAt(player.x, player.z) !== dimensionAt(point[0], point[2])) return;
  if (player.sleeping) player.sleeping = false;
  addFx(state, 'teleport', player.x, player.y + 0.9, player.z);
  teleport(state, player, ...spot);
  addFx(state, 'teleport', player.x, player.y + 0.9, player.z);
  damagePlayer(state, player, PEARL_DAMAGE, 'hit the ground too hard', undefined, 'fall');
}

/** Every tick from tickArrows: fly pearls (`k === 5`) and land them on the first block or mob in their path. */
export function tickPearls(state: State, dt: number): void {
  for (const pearl of state.arrows) {
    if (pearl.k !== PK.PEARL || pearl.age === Infinity) continue;
    pearl.age += dt;
    const thrower = typeof pearl.shooter === 'string' ? playerById(state, pearl.shooter) : undefined;
    if (pearl.age > 20 || pearl.y < VOID_Y || !thrower?.connected) { pearl.age = Infinity; continue; }
    const origin: Vec3 = [pearl.x, pearl.y, pearl.z], step: Vec3 = [pearl.vx * dt, pearl.vy * dt, pearl.vz * dt], length = Math.hypot(...step);
    // The nearest mob box along this tick's step (as a fraction of it), then the first solid block.
    let at = Infinity;
    for (const mob of state.mobs) if (mob.health > 0) for (const box of mobHitBoxes(mob)) at = Math.min(at, rayAabb(origin, step, box, 1)?.distance ?? Infinity);
    const block = length > 0 ? raycastBlocks(state.getLoaded, origin, step, length, isSolid) : null;
    if (block && block.distance <= at * length) land(state, pearl, block.point, [...FACES[block.face]!]);
    else if (at <= 1) land(state, pearl, [pearl.x + step[0] * at, pearl.y + step[1] * at, pearl.z + step[2] * at], [0, 0, 0]);
    if (pearl.age === Infinity) continue;
    pearl.x += step[0];
    pearl.y += step[1];
    pearl.z += step[2];
    const drag = Math.pow(0.99, dt * 20);
    pearl.vx *= drag;
    pearl.vz *= drag;
    pearl.vy = pearl.vy * drag - PEARL_GRAVITY * dt;
  }
}
