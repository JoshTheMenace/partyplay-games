/**
 * Blazes (Nether fortresses): fire spirits that hover a little above the floor, bobbing up and down, and drift slowly
 * (no gravity, a slow sink). A blaze that sees a player within 32 blocks rises to just above their head, closes in to
 * about 10 blocks, glows for a second and fires a volley of 3 small fireballs (projectile k 2: 5 damage, sets the target
 * and the landing spot on fire, never breaks blocks), then cools down for 4–6 s; up close it burns with a touch. A blaze
 * that just spotted someone waits 1.5 s before its first volley.
 * They spawn from fortress spawners (sim/structures.ts) and on fortress floors (spawnFortressMobs). Fire immunity lives
 * with the other fireproof mobs in fire.ts; rods drop in combat.killMob.
 */
import { B, cellId, isAir, isSolid } from '../shared/blocks';
import { FACES, type Vec3 } from '../shared/coords';
import { inNether } from '../shared/constants';
import { bodyBox } from '../shared/physics';
import { MOB, PK } from '../shared/protocol';
import { raycastBlocks, rayAabb } from '../shared/raycast';
import { fortressesOf } from '../shared/structures/fortress';
import { damagePlayer, hostileDamage, spawnArrow } from './combat';
import { BURN_SECONDS, igniteEntity } from './fire';
import { huntable, lineOfSight, newMob, roomFor } from './mobs';
import { moveBody } from './motion';
import { activePlayers, addFx, dist2, playerById, type Arrow, type Mob, type Player, type State } from './state';
import { blockLight, isLoaded, writeCell } from './world';

/** Blaze server state, created with the world and not saved. */
export type BlazeState = Record<string, never>;
export const newBlazeState = (): BlazeState => ({});

const W = 0.6, H = 1.8, EYE = 1.4, SIGHT = 32, KEEP = 10, SPEED = 2.6, DRIFT = 1, SINK = 0.8, RISE = 2;
const CHARGE = 1, SHOT_GAP = 0.3, VOLLEY = 3, COOLDOWN = 4, NOTICE = 1.5, MELEE = 6, FIREBALL_SPEED = 15, FIREBALL_DAMAGE = 5, FIREBALL_LIFE = 5;
/** Fortress spawning: never within 24 blocks of a player, light ≤ 11, blazes capped at 3 + 2 per player in a fortress. */
const SPAWN_GAP = 24, SPAWN_REACH = 48, MAX_LIGHT = 11;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Feet height of the floor under a point (the top of the first solid block within 10 below), or null over a drop. */
function floorUnder(state: State, x: number, y: number, z: number): number | null {
  for (let fy = Math.floor(y); fy > y - 10; fy--) if (isSolid(state.getLoaded(x, fy - 1, z))) return fy;
  return null;
}

/** The nearest huntable player in sight within 32 blocks. */
function findTarget(state: State, mob: Mob): Player | undefined {
  let best = SIGHT * SIGHT, target: Player | undefined;
  for (const player of state.players) {
    const d = dist2(player.x, player.y + 1.5, player.z, mob.x, mob.y + EYE, mob.z);
    if (d < best && huntable(state, player) && lineOfSight(state, mob.x, mob.y + EYE, mob.z, player.x, player.y + 1.5, player.z)) { best = d; target = player; }
  }
  return target;
}

/** Launch one small fireball at the target's chest, a little less accurate far away and scattered wide up close (dodgeable). */
function shoot(state: State, mob: Mob, target: Player) {
  const cx = mob.x, cy = mob.y + EYE, cz = mob.z, d = Math.hypot(target.x - cx, target.z - cz), spread = () => (state.rand() - 0.5) * (0.4 + d * 0.04 + Math.max(0, 8 - d) * 0.12);
  const dx = target.x + spread() - cx, dy = target.y + 1.1 - cy, dz = target.z + spread() - cz, len = Math.hypot(dx, dy, dz) || 1;
  const [ux, uy, uz] = [dx / len, dy / len, dz / len];
  spawnArrow(state, cx + ux * 0.6, cy + uy * 0.6, cz + uz * 0.6, ux * FIREBALL_SPEED, uy * FIREBALL_SPEED, uz * FIREBALL_SPEED, hostileDamage(state, FIREBALL_DAMAGE), mob.id, false, PK.BLAZE_FIREBALL);
}

/** Melee burn, or the charge-and-volley cycle (`charge` counts up, `fuse` counts the shots of the current volley). */
function attack(state: State, mob: Mob, target: Player, dt: number) {
  const dy = target.y - mob.y, flat = Math.hypot(target.x - mob.x, target.z - mob.z);
  if (flat < 1.4 && dy > -2 && dy < 2) {
    if (state.clock >= mob.attackUntil + 0.6) {
      damagePlayer(state, target, hostileDamage(state, MELEE), 'was burned by a Blaze', { x: mob.x, z: mob.z, strength: 4, up: 3 }, 'mob');
      igniteEntity(state, target, BURN_SECONDS.fireball);
      mob.attackUntil = state.clock + 0.4;
    }
    return;
  }
  if (state.clock < mob.cooldown) return;
  if (mob.charge === 0) addFx(state, 'blazeShoot', mob.x, mob.y + EYE, mob.z);
  mob.charge += dt;
  while (mob.fuse < VOLLEY && mob.charge >= CHARGE + mob.fuse * SHOT_GAP) {
    shoot(state, mob, target);
    mob.fuse++;
    mob.attackUntil = state.clock + 0.3;
  }
  if (mob.fuse >= VOLLEY) Object.assign(mob, { charge: 0, fuse: 0, cooldown: state.clock + COOLDOWN + state.rand() * 2 });
}

/**
 * Every tick for each live, loaded blaze within 80 blocks of a player (mobs.ts CUSTOM_AI). Blazes fly themselves (null).
 * Animation `a`: 3 glowing before a volley, 2 shooting or burning, 1 drifting, 0 hovering.
 */
export function thinkBlaze(state: State, mob: Mob, dt: number): null {
  mob.fire = 0;
  if (state.clock >= mob.thinkAt) {
    mob.thinkAt = state.clock + 0.4 + state.rand() * 0.2;
    const was = mob.target;
    mob.target = findTarget(state, mob)?.id ?? null;
    // A blaze that just noticed someone takes a moment before its first volley.
    if (was === null && mob.target !== null) mob.cooldown = Math.max(mob.cooldown, state.clock + NOTICE);
    const goal = mob.goal;
    if (mob.target === null && (!goal || dist2(goal[0], 0, goal[2], mob.x, 0, mob.z) < 1 || state.rand() < 0.05)) {
      mob.goal = [mob.x + (state.rand() - 0.5) * 12, mob.y, mob.z + (state.rand() - 0.5) * 12];
    }
  }
  const target = mob.target === null ? undefined : playerById(state, mob.target);
  const bob = Math.sin(state.clock * 1.3 + mob.seed) * 0.6;
  let vx = 0, vy = 0, vz = 0;
  if (target && huntable(state, target)) {
    const dx = target.x - mob.x, dz = target.z - mob.z, d = Math.hypot(dx, dz) || 1, speed = d > KEEP ? SPEED : d < 3 ? SPEED : 0;
    mob.yaw = Math.atan2(-dx, -dz);
    [vx, vz] = [dx / d * speed, dz / d * speed];
    vy = clamp((target.y + 2 + bob - mob.y) * 1.5, -SINK, RISE);
    attack(state, mob, target, dt);
  } else {
    mob.charge = Math.max(0, mob.charge - dt);
    mob.fuse = 0;
    const goal = mob.goal, floor = floorUnder(state, mob.x, mob.y + 0.5, mob.z);
    if (goal) {
      const dx = goal[0] - mob.x, dz = goal[2] - mob.z, d = Math.hypot(dx, dz) || 1;
      [vx, vz] = [dx / d * DRIFT, dz / d * DRIFT];
      mob.yaw = Math.atan2(-dx, -dz);
    }
    vy = floor === null ? 0 : clamp((floor + 1.2 + bob - mob.y) * 1.2, -SINK, RISE);
  }
  const k = Math.min(1, dt * 4);
  mob.vx += (vx - mob.vx) * k;
  mob.vy += (vy - mob.vy) * k;
  mob.vz += (vz - mob.vz) * k;
  const hit = moveBody(state.getLoaded, mob, W, H, dt);
  if (hit.hitX || hit.hitZ) mob.goal = null;
  mob.a = mob.charge > 0 && mob.fuse === 0 ? 3 : state.clock < mob.attackUntil ? 2 : Math.hypot(mob.vx, mob.vz) > 0.3 ? 1 : 0;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Fortress spawning

/** The highest fortress floor spot from `y` down to `low` in a column: nether bricks below, room above, block light ≤ 11. */
function fortressFloor(state: State, t: number, x: number, y: number, z: number, low: number): number {
  for (let fy = y; fy >= low; fy--) {
    if (cellId(state.getLoaded(x, fy - 1, z)) === B.nether_bricks && roomFor(state, t, x + 0.5, fy, z + 0.5) && blockLight(state, x, fy, z) <= MAX_LIGHT) return fy;
  }
  return -1;
}

/**
 * Once a second (tickMobs, never in peaceful): for each player inside a fortress's bounds, maybe one blaze (2 in 3) or
 * zombified piglin on a fortress floor 24–48 blocks away inside the same bounds, MC's fortress spawning. Blazes are capped
 * at 3 + 2 per player in the Nether, up to 10, within 128 blocks of the fortress's hub.
 */
export function spawnFortressMobs(state: State): void {
  const players = activePlayers(state).filter(p => inNether(p.x, p.z));
  if (!players.length) return;
  const fortresses = fortressesOf(state.settings.seed), r = state.rand, cap = Math.min(10, 3 + 2 * players.length);
  for (const player of players) {
    const fort = fortresses.find(({ bounds: b }) => player.x >= b[0] && player.x <= b[3] + 1 && player.z >= b[2] && player.z <= b[5] + 1);
    if (!fort || r() < 0.5) continue;
    const [x0, y0, z0, x1, y1, z1] = fort.bounds;
    const blazes = state.mobs.filter(m => m.t === MOB.blaze && m.health > 0 && dist2(m.x, 0, m.z, fort.center[0], 0, fort.center[2]) < 128 * 128).length;
    const t = r() < 2 / 3 ? MOB.blaze : MOB.zombified_piglin;
    if (t === MOB.blaze && blazes >= cap) continue;
    for (let attempt = 0; attempt < 4; attempt++) {
      const angle = r() * Math.PI * 2, d = SPAWN_GAP + r() * (SPAWN_REACH - SPAWN_GAP);
      const x = Math.floor(player.x + Math.cos(angle) * d), z = Math.floor(player.z + Math.sin(angle) * d);
      if (x < x0 || x > x1 || z < z0 || z > z1 || !isLoaded(state, x, z)) continue;
      const y = fortressFloor(state, t, x, Math.min(y1, Math.floor(player.y) + 12), z, Math.max(y0, Math.floor(player.y) - 16));
      if (y < 0 || state.players.some(p => p.connected && dist2(p.x, p.y, p.z, x + 0.5, y, z + 0.5) < SPAWN_GAP * SPAWN_GAP)) continue;
      state.mobs.push(newMob(state, t, x + 0.5, y, z + 0.5));
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Small fireballs

/** The first player a fireball's step crosses (its distance along the step, 0..1). */
function struck(state: State, ball: Arrow, step: Vec3): { player: Player; t: number } | null {
  let best: { player: Player; t: number } | null = null;
  for (const player of state.players) {
    if (player.dead || !player.connected || state.settings.mode === 'creative') continue;
    const b = bodyBox(player), hit = rayAabb([ball.x, ball.y, ball.z], step, [b[0] - 0.15, b[1] - 0.15, b[2] - 0.15, b[3] + 0.15, b[4] + 0.15, b[5] + 0.15], 1);
    if (hit && (!best || hit.distance < best.t)) best = { player, t: hit.distance };
  }
  return best;
}

/**
 * Every tick from tickArrows: fly blaze fireballs (`k === 2`) in a straight line; a player hit takes 5 damage and burns,
 * a block hit lights fire on the open face above a solid top (no block damage); gone after 5 s or at a barrier.
 */
export function tickBlazeFireballs(state: State, dt: number): void {
  for (const ball of state.arrows) {
    if (ball.k !== PK.BLAZE_FIREBALL || ball.age === Infinity) continue;
    ball.age += dt;
    if (ball.age > FIREBALL_LIFE) { ball.age = Infinity; continue; }
    const step: Vec3 = [ball.vx * dt, ball.vy * dt, ball.vz * dt], length = Math.hypot(...step);
    const body = struck(state, ball, step), block = length > 0 ? raycastBlocks(state.getLoaded, [ball.x, ball.y, ball.z], step, length, isSolid) : null;
    if (body && (!block || body.t * length <= block.distance)) {
      ball.age = Infinity;
      damagePlayer(state, body.player, ball.damage, 'was fireballed by a Blaze', { x: ball.x - ball.vx, z: ball.z - ball.vz, strength: 3, up: 2 }, 'fireball');
      igniteEntity(state, body.player, BURN_SECONDS.fireball);
      addFx(state, 'ignite', body.player.x, body.player.y + 1, body.player.z);
    } else if (block) {
      ball.age = Infinity;
      if (cellId(block.cell) === B.barrier) continue;
      const [fx, fy, fz] = FACES[block.face]!, x = block.x + fx, y = block.y + fy, z = block.z + fz;
      if (isAir(state.get(x, y, z)) && isSolid(state.get(x, y - 1, z))) writeCell(state, x, y, z, B.fire);
      addFx(state, 'ignite', block.point[0], block.point[1], block.point[2]);
    } else {
      ball.x += step[0];
      ball.y += step[1];
      ball.z += step[2];
    }
  }
}
