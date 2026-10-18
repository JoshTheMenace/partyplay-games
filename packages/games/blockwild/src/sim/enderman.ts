/**
 * Endermen: tall neutral teleporters. Looking one in the head (the crosshair ray within 64 blocks, clear line of sight,
 * for half a second) or hitting it provokes it: it screams, stares for a second, then hunts that player, blinking in
 * around them whenever they are far, out of sight or out of reach. It blinks away (up to 32 blocks, onto a safe floor)
 * when water touches it, when anything but a player hurts it, a third of the times a player does, and always instead of
 * taking an arrow. Spawning: rare on overworld nights, rare on soul sand valley floors, common on the End island.
 * Pearl drops (with the pity counter) live in combat.killMob.
 */
import { B, cellId, isLiquid, isOpaque, isSolid, isWater } from '../shared/blocks';
import { dimensionAt, type Dimension } from '../shared/constants';
import { lookVector, type Vec3 } from '../shared/coords';
import { LAVA_SEA } from '../shared/nether';
import { eyeHeight, regionTouches } from '../shared/physics';
import { MOB } from '../shared/protocol';
import { rayAabb } from '../shared/raycast';
import { collisionTop, type Box } from '../shared/shapes';
import { damageMob, damagePlayer, hostileDamage, type Hit } from './combat';
import { cellOf, computePath, followPath, huntable, lineOfSight, newMob, roomFor, SPEED, toward, wander } from './mobs';
import { activePlayers, addFx, dist2, isNight, playerById, type Mob, type Player, type State } from './state';
import { blockLight, isLoaded, surfaceY } from './world';

/** Per-enderman memory: who has been staring at its head and for how long, the post-scream stare, blink and water timers. */
type Ender = { gazer: string | null; gaze: number; stareUntil: number; blinkAt: number; wetAt: number };
/** Enderman server state, created with the world and not saved. */
export type EndermanState = { of: WeakMap<Mob, Ender> };
export const newEndermanState = (): EndermanState => ({ of: new WeakMap() });

export const GAZE_RANGE = 64, GAZE_SECONDS = 0.5, BLINK_RANGE = 32, ENDERMAN_DAMAGE = 7;
const STARE_SECONDS = 1, ANGER_SECONDS = 30, HURT_BLINK = 1 / 4, REACH = 1.2, HEIGHT = 2.9;
/** Floors a blink or a spawn never picks. */
const HAZARDS = new Set<number>([B.lava, B.fire, B.cactus, B.magma_block, B.barrier]);

function ender(state: State, mob: Mob): Ender {
  let memory = state.endermen.of.get(mob);
  if (!memory) state.endermen.of.set(mob, memory = { gazer: null, gaze: 0, stareUntil: 0, blinkAt: 0, wetAt: 0 });
  return memory;
}
/** The head a player must look at (the top 0.55 blocks of the body). */
export const headBox = (mob: Pick<Mob, 'x' | 'y' | 'z'>): Box => [mob.x - 0.3, mob.y + HEIGHT - 0.55, mob.z - 0.3, mob.x + 0.3, mob.y + HEIGHT, mob.z + 0.3];

/** The first huntable player whose crosshair ray meets the head within 64 blocks with nothing opaque in between. */
export function gazer(state: State, mob: Mob): Player | undefined {
  const head = headBox(mob);
  return state.players.find(player => {
    if (!huntable(state, player)) return false;
    const [ex, ey, ez] = [player.x, player.y + eyeHeight(player), player.z], [dx, dy, dz] = lookVector(player.yaw, player.pitch);
    const hit = rayAabb([ex, ey, ez], [dx, dy, dz], head, GAZE_RANGE);
    return !!hit && lineOfSight(state, ex, ey, ez, ex + dx * hit.distance, ey + dy * hit.distance, ez + dz * hit.distance);
  });
}

/** Anger at a player; a fresh provocation screams, and one from a gaze stares back for a second before the hunt. */
function provoke(state: State, mob: Mob, player: Player, stare: boolean) {
  const fresh = mob.target !== player.id || state.clock >= mob.aggroUntil;
  mob.target = player.id;
  mob.aggroUntil = state.clock + ANGER_SECONDS;
  if (!fresh) return;
  addFx(state, 'scream', mob.x, mob.y + 2.6, mob.z);
  ender(state, mob).stareUntil = stare ? state.clock + STARE_SECONDS : 0;
  mob.path = null;
}

/**
 * Feet height on the first floor at or below `y` in the column (scanning `depth` cells): solid, not a hazard, with room
 * for the 2.9-block body and no liquid in it. Null if that floor is unsafe or there is none.
 */
function floorIn(state: State, x: number, y: number, z: number, depth: number): number | null {
  const get = state.getLoaded, top = Math.floor(y);
  for (let by = top; by > top - depth && by >= 0; by--) {
    const below = get(x, by, z);
    if (!isSolid(below) || isSolid(get(x, by + 1, z))) continue;
    const feet = by + collisionTop(below);
    if (HAZARDS.has(cellId(below)) || !roomFor(state, MOB.enderman, x + 0.5, feet, z + 0.5)) return null;
    return regionTouches(get, x + 0.2, feet, z + 0.2, x + 0.8, feet + HEIGHT, z + 0.8, isLiquid) ? null : feet;
  }
  return null;
}

/** Teleport to a safe floor `min`–`radius` blocks around a point (±`lift` vertically), in the same dimension. */
function blink(state: State, mob: Mob, around: Vec3, radius: number, min: number, lift: number): boolean {
  const r = state.rand, home = dimensionAt(mob.x, mob.z);
  for (let attempt = 0; attempt < 16; attempt++) {
    const angle = r() * Math.PI * 2, d = min + r() * (radius - min);
    const x = Math.floor(around[0] + Math.cos(angle) * d), z = Math.floor(around[2] + Math.sin(angle) * d);
    if (dimensionAt(x, z) !== home || !isLoaded(state, x, z)) continue;
    const feet = floorIn(state, x, around[1] + (r() * 2 - 1) * lift, z, lift * 2 + 4);
    if (feet === null) continue;
    addFx(state, 'teleport', mob.x, mob.y + 1.45, mob.z);
    Object.assign(mob, { x: x + 0.5, y: feet, z: z + 0.5, vx: 0, vy: 0, vz: 0, fallPeak: feet, path: null, lastX: x + 0.5, lastZ: z + 0.5 });
    addFx(state, 'teleport', mob.x, mob.y + 1.45, mob.z);
    return true;
  }
  return false;
}
const blinkAway = (state: State, mob: Mob) => blink(state, mob, [mob.x, mob.y, mob.z], BLINK_RANGE, 4, 16);

/** Hunting: stare, then walk in and hit (7), blinking in around the target when it is far, hidden or out of reach. */
function hunt(state: State, mob: Mob, target: Player, memory: Ender): [number, number] {
  const clock = state.clock, dx = target.x - mob.x, dz = target.z - mob.z, dy = target.y - mob.y, dist = Math.hypot(dx, dz);
  mob.yaw = Math.atan2(-dx, -dz);
  if (dist2(target.x, target.y, target.z, mob.x, mob.y, mob.z) < 32 * 32) mob.aggroUntil = Math.max(mob.aggroUntil, clock + 10);
  if (clock < memory.stareUntil) {
    mob.a = 3;
    return [0, 0];
  }
  const hidden = !lineOfSight(state, mob.x, mob.y + 2.6, mob.z, target.x, target.y + 1.5, target.z);
  if (clock >= memory.blinkAt && (dist > 10 || Math.abs(dy) > 3 || hidden || mob.stuck > 0.5)) {
    memory.blinkAt = clock + (blink(state, mob, [target.x, target.y, target.z], 5, 2, 3) ? 2 + state.rand() * 2 : 0.5);
    return [0, 0];
  }
  if (clock >= mob.repathAt) computePath(state, mob, cellOf(target.x, target.y, target.z));
  if (dist < REACH + 0.2 && dy > -1.5 && dy < HEIGHT && clock >= mob.cooldown) {
    damagePlayer(state, target, hostileDamage(state, ENDERMAN_DAMAGE), 'was slain by an Enderman', { x: mob.x, z: mob.z, strength: 5, up: 3.5 }, 'mob');
    mob.cooldown = clock + 1;
    mob.attackUntil = clock + 0.4;
  }
  const speed = SPEED[mob.t]!;
  const desired = dist < REACH ? [0, 0] as [number, number]
    : dist < 2.5 && Math.abs(dy) < 1.5 ? toward(mob, target.x, target.z, speed) : followPath(mob, speed) ?? (dist < 6 ? toward(mob, target.x, target.z, speed) : [0, 0]);
  mob.a = clock < mob.attackUntil ? 2 : Math.hypot(desired[0], desired[1]) > 0.3 ? 1 : 0;
  return desired;
}

/**
 * Every tick for each live, loaded enderman within 80 blocks of a player (mobs.ts CUSTOM_AI): water, the dawn despawn,
 * gaze and anger, then hunting or a slow wander. Returns the walking velocity (null when it has just gone).
 */
export function thinkEnderman(state: State, mob: Mob, dt: number): [number, number] | null {
  const memory = ender(state, mob), clock = state.clock;
  // Water hurts and scatters it (as in MC): 1 damage every half second, each hit a blink away.
  if (clock >= memory.wetAt && regionTouches(state.getLoaded, mob.x - 0.3, mob.y, mob.z - 0.3, mob.x + 0.3, mob.y + HEIGHT, mob.z + 0.3, isWater)) {
    memory.wetAt = clock + 0.5;
    damageMob(state, mob, 1, null);
    if (mob.health <= 0) return null;
  }
  // Overworld endermen leave once it is day and nobody is within 32 blocks.
  if (dimensionAt(mob.x, mob.z) === 'overworld' && !isNight(state.time) && state.rand() < dt / 8
    && !state.players.some(p => p.connected && dist2(p.x, p.y, p.z, mob.x, mob.y, mob.z) < 32 * 32)) {
    addFx(state, 'teleport', mob.x, mob.y + 1.45, mob.z);
    mob.health = 0;
    return null;
  }
  let target = mob.target !== null && clock < mob.aggroUntil ? playerById(state, mob.target) : undefined;
  if (target && (!huntable(state, target) || dist2(target.x, target.y, target.z, mob.x, mob.y, mob.z) > GAZE_RANGE ** 2)) target = undefined;
  if (!target) {
    mob.target = null;
    const looker = gazer(state, mob);
    memory.gaze = looker ? (looker.id === memory.gazer ? memory.gaze : 0) + dt : 0;
    memory.gazer = looker?.id ?? null;
    // (A small epsilon: ten 0.05 s ticks sum to just under 0.5.)
    if (looker && memory.gaze >= GAZE_SECONDS - 1e-6) provoke(state, mob, target = looker, true);
  }
  if (target) return hunt(state, mob, target, memory);
  if (clock >= mob.thinkAt) {
    mob.thinkAt = clock + 0.4 + state.rand() * 0.2;
    wander(state, mob);
  }
  const desired = followPath(mob, SPEED[mob.t]! * 0.5) ?? [0, 0];
  mob.a = Math.hypot(desired[0], desired[1]) > 0.3 ? 1 : 0;
  return desired;
}

/**
 * Before an enderman takes damage (combat.damageMob). A player attacker provokes it. Arrows are dodged: it blinks away
 * and takes nothing. Other damage lands; anything but a player's hit (water, fire, falls, blasts) makes it blink away,
 * and a player's hit does a third of the time.
 */
export function onEndermanHurt(state: State, mob: Mob, _amount: number, attacker: Player | null, hit: Hit): boolean {
  if (attacker) provoke(state, mob, attacker, false);
  if (hit.arrow) {
    blinkAway(state, mob);
    return false;
  }
  if (!attacker || state.rand() < HURT_BLINK) blinkAway(state, mob);
  return true;
}

/** Where endermen spawn in each dimension: the cap for `n` players there, the chance per player each second, the column's start height and the floor rule. */
type Rule = { cap: (n: number) => number; chance: number; start: (state: State, player: Player, x: number, z: number) => number; ok: (state: State, floor: number, x: number, feet: number, z: number) => boolean };
const RULES: Record<Dimension, Rule> = {
  // Rare, at night, on any dark floor: the surface or a cave near the player's height.
  overworld: {
    cap: n => 1 + Math.floor(n / 2), chance: 0.05,
    start: (state, player, x, z) => state.rand() < 0.5 ? surfaceY(state.getLoaded, x, z) + 1 : Math.floor(player.y) + Math.floor(state.rand() * 25) - 12,
    ok: (state, floor, x, feet, z) => isNight(state.time) && isOpaque(floor) && blockLight(state, x, Math.floor(feet), z) <= 7,
  },
  // Rare, on the soul sand of valley floors (above the shores).
  nether: {
    cap: n => 1 + Math.floor(n / 2), chance: 0.05,
    start: (state, player) => Math.floor(player.y) + Math.floor(state.rand() * 24) - 8,
    ok: (_state, floor, _x, feet) => cellId(floor) === B.soul_sand && feet > LAVA_SEA + 4,
  },
  // Common, on the island's end stone (never the pillars).
  end: { cap: () => 16, chance: 1, start: (state, _player, x, z) => surfaceY(state.getLoaded, x, z) + 1, ok: (_state, floor) => cellId(floor) === B.end_stone },
};

/** Once a second (tickMobs, not in peaceful): each dimension's players roll for an enderman 24–48 blocks away, under its cap. */
export function spawnEndermen(state: State): void {
  const players = activePlayers(state), r = state.rand;
  for (const dimension of ['overworld', 'nether', 'end'] as const) {
    const here = players.filter(p => dimensionAt(p.x, p.z) === dimension), rule = RULES[dimension];
    let alive = state.mobs.filter(mob => mob.t === MOB.enderman && mob.health > 0 && dimensionAt(mob.x, mob.z) === dimension).length;
    for (const player of here) {
      if (alive >= rule.cap(here.length) || r() >= rule.chance) continue;
      const angle = r() * Math.PI * 2, d = 24 + r() * 24, x = Math.floor(player.x + Math.cos(angle) * d), z = Math.floor(player.z + Math.sin(angle) * d);
      if (dimensionAt(x, z) !== dimension || !isLoaded(state, x, z)) continue;
      const feet = floorIn(state, x, rule.start(state, player, x, z), z, 24);
      if (feet === null || !rule.ok(state, state.getLoaded(x, Math.ceil(feet) - 1, z), x, feet, z)) continue;
      if (state.players.some(p => p.connected && dist2(p.x, p.y, p.z, x + 0.5, feet, z + 0.5) < 24 * 24)) continue;
      state.mobs.push(newMob(state, MOB.enderman, x + 0.5, feet, z + 0.5));
      alive++;
    }
  }
}
