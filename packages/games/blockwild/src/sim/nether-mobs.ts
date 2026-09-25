/**
 * Nether mobs on the server: zombified piglins (neutral until provoked, then the whole group within 24
 * blocks hunts the attacker for 30 s), ghasts (drifting flyers that shoot explosive fireballs with line of sight) and
 * the fireballs themselves, which a player can knock back by hitting them.
 */
import { B, cellId, isAir, isFullCube, isLiquid, isSolid } from '../shared/blocks';
import { inNether, NETHER, REACH } from '../shared/constants';
import { lookVector, type Vec3 } from '../shared/coords';
import { LAVA_SEA } from '../shared/nether';
import { bodyBox, eyeHeight, regionCollides } from '../shared/physics';
import { MOB, mobBox } from '../shared/protocol';
import { raycastBlocks, rayAabb } from '../shared/raycast';
import { damageMob, damagePlayer, explode, hostileDamage, mobState, spawnArrow, type Knock } from './combat';
import { BURN_SECONDS, igniteEntity } from './fire';
import { cellOf, computePath, followPath, huntable, lineOfSight, newMob, roomFor, SPEED, toward, wander } from './mobs';
import { moveBody } from './motion';
import { activePlayers, addFx, dist2, playerById, type Arrow, type Mob, type Player, type State } from './state';
import { isLoaded, writeCell } from './world';

/** Nether mob server state, created with the world and not saved. */
export type NetherState = {
  /** The anger deadline each piglin last shared with its group (a new provocation changes `aggroUntil`). */
  provoked: WeakMap<Mob, number>;
};
export const newNetherState = (): NetherState => ({ provoked: new WeakMap() });

const ANGER_RADIUS = 24, ANGER_SECONDS = 30, PIGLIN_DAMAGE = 5;
const GHAST_RANGE = 48, GHAST_SPEED = 2.2, GHAST_CHARGE = 1, FIREBALL_SPEED = 14, FIREBALL_DAMAGE = 6, FIREBALL_LIFE = 10;
/** Nothing spawns closer than this to a player. */
const SPAWN_GAP = 24;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const farFromPlayers = (state: State, x: number, y: number, z: number) => state.players.every(p => !p.connected || dist2(p.x, p.y, p.z, x, y, z) >= SPAWN_GAP * SPAWN_GAP);

// ---------------------------------------------------------------------------------------------
// Spawning

/** Feet height of open floor at or below `y` in a column (a full block below, a piglin's room above, no liquid), or -1. */
function floorAt(state: State, x: number, y: number, z: number): number {
  for (let fy = y; fy > y - 24 && fy > 5; fy--) {
    const get = state.getLoaded;
    if (isFullCube(get(x, fy - 1, z)) && !isLiquid(get(x, fy, z)) && roomFor(state, MOB.zombified_piglin, x + 0.5, fy, z + 0.5)) return fy;
  }
  return -1;
}

/** A group of 2–4 piglins on the floor 24–48 blocks from a player. Returns how many spawned. */
function spawnPiglins(state: State, player: Player, room: number): number {
  const r = state.rand, angle = r() * Math.PI * 2, d = SPAWN_GAP + r() * 24;
  const x = Math.floor(player.x + Math.cos(angle) * d), z = Math.floor(player.z + Math.sin(angle) * d);
  if (!inNether(x, z) || !isLoaded(state, x, z)) return 0;
  const y = floorAt(state, x, clamp(Math.floor(player.y) + Math.floor(r() * 24) - 8, 8, 118), z);
  if (y < 0 || !farFromPlayers(state, x, y, z)) return 0;
  const group = Math.min(room, 2 + Math.floor(r() * 3));
  let spawned = 0;
  for (let i = 0; i < group * 3 && spawned < group; i++) {
    const sx = x + (i ? Math.floor(r() * 5) - 2 : 0), sz = z + (i ? Math.floor(r() * 5) - 2 : 0), sy = floorAt(state, sx, y + 2, sz);
    if (sy < 0 || Math.abs(sy - y) > 2 || !inNether(sx, sz)) continue;
    state.mobs.push(newMob(state, MOB.zombified_piglin, sx + 0.5, sy, sz + 0.5));
    spawned++;
  }
  return spawned;
}

/** A 5 × 5 × 5 pocket of open air around a cell (room for a ghast). */
function openPocket(state: State, x: number, y: number, z: number): boolean {
  for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (!isAir(state.getLoaded(x + dx, y + dy, z + dz))) return false;
  return true;
}

/** A ghast in open cavern air 32–64 blocks from a player. Returns 1 if it spawned. */
function spawnGhast(state: State, player: Player): number {
  const r = state.rand, angle = r() * Math.PI * 2, d = 32 + r() * 32;
  const x = Math.floor(player.x + Math.cos(angle) * d), y = 40 + Math.floor(r() * 60), z = Math.floor(player.z + Math.sin(angle) * d);
  if (!inNether(x - 2, z - 2) || !inNether(x + 2, z + 2) || !isLoaded(state, x, z) || !openPocket(state, x, y, z) || !farFromPlayers(state, x, y, z)) return 0;
  state.mobs.push(newMob(state, MOB.ghast, x + 0.5, y - 1.5, z + 0.5));
  return 1;
}

/**
 * Once a second (in tickMobs, right after the overworld spawn pass, never in peaceful): piglin groups and ghasts
 * around players inside the Nether, with their own caps (piglins 4 + 4 per player there, up to 20; ghasts 1 + 1 per
 * player, up to 4). Day and night don't matter here.
 */
export function spawnNetherMobs(state: State): void {
  const players = activePlayers(state).filter(player => inNether(player.x, player.z));
  if (!players.length) return;
  const alive = (t: number) => state.mobs.filter(mob => mob.t === t && mob.health > 0).length;
  const piglinCap = Math.min(20, 4 + 4 * players.length), ghastCap = Math.min(4, 1 + players.length);
  let piglins = alive(MOB.zombified_piglin), ghasts = alive(MOB.ghast);
  for (const player of players) {
    if (piglins < piglinCap && state.rand() < 0.5) piglins += spawnPiglins(state, player, piglinCap - piglins);
    if (ghasts < ghastCap && state.rand() < 0.15) ghasts += spawnGhast(state, player);
  }
}

// ---------------------------------------------------------------------------------------------
// Zombified piglins

/** A fresh provocation (damageMob just moved `aggroUntil`): every piglin within 24 blocks joins in for 30 s. */
function shareAnger(state: State, mob: Mob) {
  if (state.nether.provoked.get(mob) === mob.aggroUntil) return;
  const until = state.clock + ANGER_SECONDS;
  for (const other of state.mobs) {
    if (other.t !== MOB.zombified_piglin || other.health <= 0 || dist2(other.x, other.y, other.z, mob.x, mob.y, mob.z) > ANGER_RADIUS * ANGER_RADIUS) continue;
    other.target = mob.target;
    other.aggroUntil = until;
    state.nether.provoked.set(other, until);
  }
}

/** Neutral wandering; once provoked, chase and hit the attacker with a golden sword. */
function piglin(state: State, mob: Mob): [number, number] {
  const speed = SPEED[mob.t]!;
  if (mob.target !== null && state.clock < mob.aggroUntil) shareAnger(state, mob);
  const target = mob.target !== null && state.clock < mob.aggroUntil ? playerById(state, mob.target) : undefined;
  let desired: [number, number];
  if (target && huntable(state, target) && dist2(target.x, 0, target.z, mob.x, 0, mob.z) < 40 * 40) {
    const dx = target.x - mob.x, dz = target.z - mob.z, dy = target.y - mob.y, dist = Math.hypot(dx, dz), reach = 1.2;
    mob.yaw = Math.atan2(-dx, -dz);
    if (state.clock >= mob.repathAt) computePath(state, mob, cellOf(target.x, target.y, target.z));
    if (dist < reach + 0.2 && dy > -1.5 && dy < 1.95 && state.clock >= mob.cooldown) {
      damagePlayer(state, target, hostileDamage(state, PIGLIN_DAMAGE), 'was slain by a Zombified Piglin', { x: mob.x, z: mob.z, strength: 5, up: 3.5 }, 'mob');
      mob.cooldown = state.clock + 1;
      mob.attackUntil = state.clock + 0.4;
    }
    desired = dist < reach ? [0, 0] : dist < 2.5 && Math.abs(dy) < 1.5 ? toward(mob, target.x, target.z, speed) : followPath(mob, speed) ?? (dist < 6 ? toward(mob, target.x, target.z, speed) : [0, 0]);
  } else {
    // Calm (or the target is gone): wander, and publish as calm.
    if (!target || state.clock >= mob.aggroUntil) mob.target = null;
    if (state.clock >= mob.thinkAt) {
      mob.thinkAt = state.clock + 0.4 + state.rand() * 0.2;
      wander(state, mob);
    }
    desired = followPath(mob, speed * 0.5) ?? [0, 0];
  }
  mob.a = state.clock < mob.attackUntil ? 2 : Math.hypot(desired[0], desired[1]) > 0.3 ? 1 : 0;
  return desired;
}

// ---------------------------------------------------------------------------------------------
// Ghasts

const GHAST_W = 4, GHAST_H = 4;
/** A clear straight flight from the ghast's position to a goal (sampled every block). */
function clearFlight(state: State, mob: Mob, goal: Vec3): boolean {
  const dx = goal[0] - mob.x, dy = goal[1] - mob.y, dz = goal[2] - mob.z, steps = Math.ceil(Math.hypot(dx, dy, dz));
  for (let i = 1; i <= steps; i++) {
    const x = mob.x + dx * i / steps, y = mob.y + dy * i / steps, z = mob.z + dz * i / steps;
    if (regionCollides(state.getLoaded, x - GHAST_W / 2, y, z - GHAST_W / 2, x + GHAST_W / 2, y + GHAST_H, z + GHAST_W / 2)) return false;
  }
  return true;
}
/** A random reachable drift goal within 16 blocks (8 up or down), inside the Nether and above the lava. */
function driftGoal(state: State, mob: Mob): Vec3 | null {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = state.rand, goal: Vec3 = [
      clamp(mob.x + (r() - 0.5) * 32, NETHER.x0 + 6, NETHER.x0 + NETHER.size - 6), clamp(mob.y + (r() - 0.5) * 16, LAVA_SEA + 3, 110),
      clamp(mob.z + (r() - 0.5) * 32, NETHER.z0 + 6, NETHER.z0 + NETHER.size - 6),
    ];
    if (clearFlight(state, mob, goal)) return goal;
  }
  return null;
}

/** Drift, pick the nearest visible player within 48 blocks, charge for 1 s (face open, a cry) and fire. */
function ghast(state: State, mob: Mob, dt: number): null {
  const cy = mob.y + GHAST_H / 2;
  if (state.clock >= mob.thinkAt) {
    mob.thinkAt = state.clock + 0.5 + state.rand() * 0.3;
    let best = GHAST_RANGE * GHAST_RANGE, target: Player | undefined;
    for (const player of state.players) {
      const d = dist2(player.x, player.y + 1.5, player.z, mob.x, cy, mob.z);
      if (d < best && huntable(state, player) && lineOfSight(state, mob.x, cy, mob.z, player.x, player.y + 1.5, player.z)) { best = d; target = player; }
    }
    mob.target = target?.id ?? null;
    const goal = mob.goal;
    if (!goal || dist2(goal[0], goal[1], goal[2], mob.x, mob.y, mob.z) < 4 || state.rand() < 0.05) mob.goal = driftGoal(state, mob);
  }
  const target = mob.target === null ? undefined : playerById(state, mob.target);
  if (target && huntable(state, target)) {
    mob.yaw = Math.atan2(-(target.x - mob.x), -(target.z - mob.z));
    if (state.clock >= mob.cooldown) {
      if (mob.charge === 0) addFx(state, 'ghast', mob.x, cy, mob.z);
      mob.charge += dt;
      if (mob.charge >= GHAST_CHARGE) {
        shootFireball(state, mob, target);
        mob.charge = 0;
        mob.cooldown = state.clock + 2.5 + state.rand() * 1.5;
        mob.attackUntil = state.clock + 0.5;
      }
    }
  } else mob.charge = Math.max(0, mob.charge - dt);
  mob.a = mob.charge > 0 ? 3 : state.clock < mob.attackUntil ? 2 : 0;
  // Flight: ease towards the drift goal (slower while fighting), no gravity; bumping into anything picks a new goal.
  const goal = mob.goal, speed = target ? GHAST_SPEED * 0.5 : GHAST_SPEED;
  let [vx, vy, vz] = [0, 0, 0];
  if (goal) {
    const dx = goal[0] - mob.x, dy = goal[1] - mob.y, dz = goal[2] - mob.z, d = Math.hypot(dx, dy, dz) || 1;
    [vx, vy, vz] = [dx / d * speed, dy / d * speed, dz / d * speed];
    if (!target) mob.yaw = Math.atan2(-dx, -dz);
  }
  const k = Math.min(1, dt * 2);
  mob.vx += (vx - mob.vx) * k;
  mob.vy += (vy - mob.vy) * k;
  mob.vz += (vz - mob.vz) * k;
  const hit = moveBody(state.getLoaded, mob, GHAST_W, GHAST_H, dt);
  if (hit.hitX || hit.hitY || hit.hitZ) mob.goal = null;
  return null;
}

function shootFireball(state: State, mob: Mob, target: Player) {
  const cx = mob.x, cy = mob.y + GHAST_H / 2, cz = mob.z, spread = () => (state.rand() - 0.5) * 0.6;
  const dx = target.x + spread() - cx, dy = target.y + 1.2 - cy, dz = target.z + spread() - cz, d = Math.hypot(dx, dy, dz) || 1;
  const [ux, uy, uz] = [dx / d, dy / d, dz / d];
  spawnArrow(state, cx + ux * 2.6, cy + uy * 2.6, cz + uz * 2.6, ux * FIREBALL_SPEED, uy * FIREBALL_SPEED, uz * FIREBALL_SPEED, hostileDamage(state, FIREBALL_DAMAGE), mob.id, false, 1);
}

/**
 * Every tick for each live, loaded zombified piglin and ghast within 80 blocks of a player (instead of the built-in AI).
 * Piglins return their walking velocity; ghasts fly themselves and return null.
 */
export function thinkNetherMob(state: State, mob: Mob, dt: number): [number, number] | null {
  return mob.t === MOB.ghast ? ghast(state, mob, dt) : piglin(state, mob);
}

// ---------------------------------------------------------------------------------------------
// Fireballs

/** The first body a fireball's step crosses: players for ghast fireballs, mobs for ones a player knocked back. */
function fireballTarget(state: State, ball: Arrow, step: Vec3): { player?: Player; mob?: Mob; t: number } | null {
  const origin: Vec3 = [ball.x, ball.y, ball.z], grow = (box: readonly number[]) => [box[0]! - 0.3, box[1]! - 0.3, box[2]! - 0.3, box[3]! + 0.3, box[4]! + 0.3, box[5]! + 0.3] as const;
  let best: { player?: Player; mob?: Mob; t: number } | null = null;
  if (typeof ball.shooter === 'number') {
    for (const player of state.players) {
      if (player.dead || !player.connected || state.settings.mode === 'creative') continue;
      const hit = rayAabb(origin, step, grow(bodyBox(player)), 1);
      if (hit && (!best || hit.distance < best.t)) best = { player, t: hit.distance };
    }
  } else for (const mob of state.mobs) {
    if (mob.health <= 0) continue;
    const hit = rayAabb(origin, step, grow(mobBox({ t: mob.t, x: mob.x, y: mob.y, z: mob.z, s: mobState(mob) })), 1);
    if (hit && (!best || hit.distance < best.t)) best = { mob, t: hit.distance };
  }
  return best;
}

/** A fireball's impact: direct damage and burning for the body hit, a power-1 explosion, and fire on a third of the open floor around. */
function burst(state: State, ball: Arrow, x: number, y: number, z: number, body?: { player?: Player; mob?: Mob }) {
  ball.age = Infinity;
  const knock: Knock = { x: x - ball.vx, z: z - ball.vz, strength: 5, up: 3 }, thrower = typeof ball.shooter === 'string' ? playerById(state, ball.shooter) ?? null : null;
  if (body?.player) {
    damagePlayer(state, body.player, ball.damage, 'was fireballed by a Ghast', knock, 'fireball');
    igniteEntity(state, body.player, BURN_SECONDS.fireball);
  }
  if (body?.mob) {
    // A ghast struck by a returned fireball dies outright, as in MC.
    damageMob(state, body.mob, body.mob.t === MOB.ghast ? 1000 : ball.damage, thrower, knock);
    igniteEntity(state, body.mob, BURN_SECONDS.fireball);
  }
  explode(state, x, y, z, 1, 'was fireballed by a Ghast');
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const fx = bx + dx, fy = by + dy, fz = bz + dz;
    if (isAir(state.get(fx, fy, fz)) && isSolid(state.get(fx, fy - 1, fz)) && state.rand() < 1 / 3) writeCell(state, fx, fy, fz, B.fire);
  }
}

/**
 * Every tick (after tickMobs, before tickArrows): fly fireballs (`k === 1`) in a straight line, burst them on the first
 * body or block they reach, and drop them after 10 s or at the edge of the loaded world.
 */
export function tickFireballs(state: State, dt: number): void {
  for (const ball of state.arrows) {
    if (ball.k !== 1 || ball.age === Infinity) continue;
    ball.age += dt;
    if (ball.age > FIREBALL_LIFE) { ball.age = Infinity; continue; }
    const step: Vec3 = [ball.vx * dt, ball.vy * dt, ball.vz * dt], length = Math.hypot(...step);
    const body = fireballTarget(state, ball, step), block = length > 0 ? raycastBlocks(state.getLoaded, [ball.x, ball.y, ball.z], step, length, isSolid) : null;
    if (body && (!block || body.t * length <= block.distance)) burst(state, ball, ball.x + step[0] * body.t, ball.y + step[1] * body.t, ball.z + step[2] * body.t, body);
    else if (block && cellId(block.cell) === B.barrier) ball.age = Infinity;
    else if (block) {
      // Burst just in front of the face it hit, so the blast centre is in the open.
      const back = Math.max(0, block.distance - 0.2) / length;
      burst(state, ball, ball.x + step[0] * back, ball.y + step[1] * back, ball.z + step[2] * back);
    } else {
      ball.x += step[0];
      ball.y += step[1];
      ball.z += step[2];
    }
  }
}

/**
 * An `attack` command whose id is not a live mob: if it is a fireball in reach, send it back along the player's look
 * (now it hurts mobs, not players) and return true.
 */
export function deflectFireball(state: State, player: Player, id: number): boolean {
  const ball = state.arrows.find(arrow => arrow.id === id && arrow.k === 1 && arrow.age !== Infinity);
  const eyeY = player.y + eyeHeight(player), reach = REACH[state.settings.mode] + 1.5;
  if (!ball || dist2(player.x, eyeY, player.z, ball.x, ball.y, ball.z) > reach * reach) return false;
  const [lx, ly, lz] = lookVector(player.yaw, player.pitch), speed = Math.max(FIREBALL_SPEED, Math.hypot(ball.vx, ball.vy, ball.vz));
  Object.assign(ball, { vx: lx * speed, vy: ly * speed, vz: lz * speed, shooter: player.id, age: 0 });
  player.swing++;
  addFx(state, 'hit', ball.x, ball.y, ball.z);
  return true;
}
