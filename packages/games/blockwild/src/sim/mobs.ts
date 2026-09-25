/**
 * Mobs: spawning rules, despawning, AI (chase, melee, archery, pounce, fuse, wander, flee, follow, breed) and physics.
 * Villagers, Nether mobs and primed TNT think in their feature modules (see CUSTOM_AI) and reuse the shared physics.
 */
import { B, cellId, isLiquid, isOpaque, isWater } from '../shared/blocks';
import { inNether, STEP_HEIGHT } from '../shared/constants';
import { chunkKey, type Vec3 } from '../shared/coords';
import { I } from '../shared/items';
import { rand2, rand3 } from '../shared/noise';
import { regionCollides } from '../shared/physics';
import { MOB, MOB_TYPES } from '../shared/protocol';
import { raycastBlocks } from '../shared/raycast';
import { structuresNear } from '../shared/structures/index';
import { damageMob, damagePlayer, explode, hostileDamage, spawnArrow } from './combat';
import { spawnItem } from './entities';
import { BURN_SECONDS, igniteEntity } from './fire';
import { moveBody } from './motion';
import { spawnNetherMobs, thinkNetherMob } from './nether-mobs';
import { findPath } from './pathfind';
import { thinkTnt } from './redstone';
import { activePlayers, addFx, isNight, isProtected, nextId, playerById, type Mob, type Player, type State } from './state';
import { preyFor, spawnVillagers, thinkVillager } from './villagers';
import { blockLight, isLoaded, skyExposed, surfaceY } from './world';

export const MAX_ANIMALS = 48, BABY_SECONDS = 300;
/** Hostile cap: 8 solo, 14 for two, +6 per extra player up to 50; halved on easy and softer on the first day. */
export function hostileCap(state: State) {
  const scale = (state.settings.difficulty === 'easy' ? 0.5 : 1) * (state.day === 0 ? 0.6 : 1);
  return Math.round(Math.min(50, 2 + 6 * activePlayers(state).length) * scale);
}
/** Walking speed per mob type (m/s). */
export const SPEED: readonly number[] = [2.4, 2.5, 3.0, 2.3, 1.4, 1.5, 1.4, 1.4, 1.6, 2.3, 1.2, 0];
/** Every-tick AI of the types owned by feature modules: returns the desired horizontal velocity, or null when it moved the mob itself. */
type CustomAi = (state: State, mob: Mob, dt: number) => [number, number] | null;
const CUSTOM_AI: Partial<Record<number, CustomAi>> = { [MOB.villager]: thinkVillager, [MOB.zombified_piglin]: thinkNetherMob, [MOB.ghast]: thinkNetherMob, [MOB.tnt]: thinkTnt };
const FOOD: Record<number, readonly number[]> = { [MOB.cow]: [I.wheat], [MOB.sheep]: [I.wheat], [MOB.pig]: [I.carrot, I.potato], [MOB.chicken]: [I.wheat_seeds] };
const HOSTILE_WEIGHTS: readonly [number, number][] = [[MOB.zombie, 30], [MOB.skeleton, 25], [MOB.spider, 25], [MOB.creeper, 20]];
const ANIMALS = [MOB.cow, MOB.pig, MOB.sheep, MOB.chicken] as const;
/** Gravity acts before the move, so at 20 Hz a 10 m/s jump peaks at 1.32 blocks: over a ledge or a path-to-sill step, never a fence. */
const JUMP = 10, GRAVITY = 32, CHASE_RANGE = 16, PATH_NODES = 300, PATH_BUDGET = 1500;
/** MC: nothing spawns within 24 blocks of a player; on the first day the world spawn keeps a 32-block safe zone. */
const SPAWN_GAP = 24, SAFE_START = 32;
const isHostile = (mob: Mob) => MOB_TYPES[mob.t]!.hostile;
const isAnimal = (mob: Mob) => MOB_TYPES[mob.t]!.kind === 'animal';
const scaleOf = (mob: Mob) => mob.baby > 0 ? 0.5 : 1;
export const foodFor = (t: number) => FOOD[t] ?? [];

export function newMob(state: State, t: number, x: number, y: number, z: number, baby = false): Mob {
  const type = MOB_TYPES[t]!, clock = state.clock;
  return {
    id: nextId(state), t, x, y, z, vx: 0, vy: 0, vz: 0, yaw: state.rand() * Math.PI * 2 - Math.PI, health: type.health, onGround: false, inWater: false, fallPeak: y,
    hurt: 0, invulnUntil: 0, lastDamage: 0, a: 0, attackUntil: 0, baby: baby ? BABY_SECONDS : 0, sheared: false,
    target: null, aggroUntil: 0, thinkAt: clock + state.rand() * 0.5, path: null, pathIndex: 0, repathAt: 0, goal: null, stuck: 0, lastX: x, lastZ: z,
    fuse: 0, cooldown: clock + 1, charge: 0, panicUntil: 0, loveUntil: 0, breedAt: 0, eggAt: clock + 300 + state.rand() * 300,
    ambientAt: clock + 5 + state.rand() * 15, fire: 0, persistent: type.kind === 'animal' || type.kind === 'villager',
    seed: Math.floor(state.rand() * 2 ** 31), p: 0, home: null, uses: [], prey: null,
  };
}

/** Room for a mob body at (x, y, z): no collision and no water at the feet. */
export function roomFor(state: State, t: number, x: number, y: number, z: number, baby = false) {
  const type = MOB_TYPES[t]!, half = type.w * (baby ? 0.25 : 0.5), h = type.h * (baby ? 0.5 : 1);
  return !regionCollides(state.getLoaded, x - half, y, z - half, x + half, y + h, z + half) && !isLiquid(state.getLoaded(x, y, z));
}

/**
 * Animals appear with terrain: each grassy chunk near players rolls once (deterministically) for a small herd.
 * A herd chunk found while the world is at the animal cap stays unrolled, so it can still fill once animals are gone.
 */
export function populateChunk(state: State, cx: number, cz: number) {
  const key = chunkKey(cx, cz), seed = state.settings.seed, herd = rand2(seed + 101, cx, cz) < 0.1;
  if (state.animalChunks.has(key) || herd && state.mobs.filter(isAnimal).length >= MAX_ANIMALS) return;
  state.animalChunks.add(key);
  spawnVillagers(state, cx, cz);
  if (!herd) return;
  const t = ANIMALS[Math.floor(rand2(seed + 102, cx, cz) * ANIMALS.length)]!, count = 2 + Math.floor(rand2(seed + 103, cx, cz) * 3);
  for (let i = 0; i < count; i++) {
    if (state.mobs.filter(isAnimal).length >= MAX_ANIMALS) return;
    const x = cx * 16 + Math.floor(rand3(seed + 104, cx, i, cz) * 16), z = cz * 16 + Math.floor(rand3(seed + 105, cx, i, cz) * 16);
    const y = surfaceY(state.getLoaded, x, z);
    if (cellId(state.getLoaded(x, y, z)) !== B.grass_block || !roomFor(state, t, x + 0.5, y + 1, z + 0.5)) continue;
    state.mobs.push(newMob(state, t, x + 0.5, y + 1, z + 0.5));
  }
}

function pickHostile(state: State): number {
  let roll = state.rand() * 100;
  for (const [t, weight] of HOSTILE_WEIGHTS) if ((roll -= weight) < 0) return t;
  return MOB.zombie;
}
/** By day, overhangs and tree cover are not dark enough: the spot and the columns two blocks around it must be roofed. */
const SKY_AROUND: readonly [number, number][] = [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]];
function dark(state: State, x: number, y: number, z: number, night: boolean) {
  return blockLight(state, x, y, z) === 0 && (night || !SKY_AROUND.some(([dx, dz]) => skyExposed(state.getLoaded, x + dx, y, z + dz)));
}
/** Desert temples are sealed tombs: a monster spawned in the dark treasure chamber would set off the TNT trap unseen. */
const inTemple = (state: State, x: number, y: number, z: number) =>
  structuresNear(state.settings.seed, x, z, 0).some(s => s.kind === 'desert_temple' && y >= s.bounds[1] && y <= s.bounds[4]);
/**
 * Once a second: try a few dark spots 24–48 blocks from each player (never within 24 blocks of anyone, never inside the
 * first day's safe zone around the world spawn or a desert temple, and by day never where a player could watch it appear).
 */
function spawnHostiles(state: State) {
  const players = activePlayers(state), cap = hostileCap(state), get = state.getLoaded, r = state.rand, night = isNight(state.time);
  // The Nether has its own spawning (nether-mobs.ts) and caps.
  let hostiles = state.mobs.filter(mob => isHostile(mob) && !inNether(mob.x, mob.z)).length;
  for (const player of players) for (let attempt = 0; attempt < 3 && hostiles < cap && !inNether(player.x, player.z); attempt++) {
    const angle = r() * Math.PI * 2, d = 24 + r() * 24, x = Math.floor(player.x + Math.cos(angle) * d), z = Math.floor(player.z + Math.sin(angle) * d);
    if (!isLoaded(state, x, z) || inNether(x, z)) continue;
    const surface = surfaceY(get, x, z);
    let y = r() < 0.5 ? surface + 1 : Math.min(surface, Math.floor(player.y) + Math.floor(r() * 25) - 12);
    for (let scan = 0; scan < 12 && y > 1 && !(isOpaque(get(x, y - 1, z)) && !isOpaque(get(x, y, z))); scan++) y--;
    const t = pickHostile(state), sx = x + 0.5, sz = z + 0.5;
    if (!isOpaque(get(x, y - 1, z)) || !roomFor(state, t, sx, y, sz)) continue;
    if (state.players.some(p => p.connected && (p.x - sx) ** 2 + (p.y - y) ** 2 + (p.z - sz) ** 2 < SPAWN_GAP ** 2)) continue;
    if (state.day === 0 && (state.spawn[0] - sx) ** 2 + (state.spawn[2] - sz) ** 2 < SAFE_START ** 2) continue;
    if (!dark(state, x, y, z, night) || inTemple(state, x, y, z)) continue;
    if (!night && players.some(p => lineOfSight(state, p.x, p.y + 1.6, p.z, sx, y + 1, sz))) continue;
    state.mobs.push(newMob(state, t, sx, y, sz));
    hostiles++;
  }
}

export const lineOfSight = (state: State, ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
  !raycastBlocks(state.getLoaded, [ax, ay, az], [bx - ax, by - ay, bz - az], Math.hypot(bx - ax, by - ay, bz - az), isOpaque);
/** Survival players a hostile may hunt. */
export const huntable = (state: State, player: Player) => player.connected && !player.dead && state.settings.mode === 'survival' && !isProtected(state, player);

/** Plan an A* path to `goal` (within the shared per-tick node budget); follow it with followPath. */
export function computePath(state: State, mob: Mob, goal: Vec3, maxNodes = PATH_NODES) {
  mob.repathAt = state.clock + 0.5;
  if (state.pathBudget <= 0) return;
  const height = Math.ceil(MOB_TYPES[mob.t]!.h * scaleOf(mob));
  const result = findPath(state.getLoaded, cellOf(mob.x, mob.y, mob.z), goal, { height, maxNodes: Math.min(maxNodes, state.pathBudget), range: 24 });
  state.pathBudget -= result.expanded;
  mob.path = result.path;
  mob.pathIndex = 0;
  mob.goal = goal;
  mob.stuck = 0;
}
/** The cell a body's feet are in; standing on a path, farmland or soul sand (14–15/16 tall) counts as the cell above it. */
export const cellOf = (x: number, y: number, z: number): Vec3 => [Math.floor(x), Math.floor(y + 0.2), Math.floor(z)];

/** Velocity towards the next waypoint (jumping up steps), or null when the path is done. */
export function followPath(mob: Mob, speed: number): [number, number] | null {
  while (mob.path && mob.pathIndex < mob.path.length) {
    const [px, py, pz] = mob.path[mob.pathIndex]!, dx = px + 0.5 - mob.x, dz = pz + 0.5 - mob.z, d = Math.hypot(dx, dz);
    if (d < 0.35 && Math.abs(mob.y - py) < 1.2) { mob.pathIndex++; continue; }
    if (py > mob.y + 0.3 && mob.onGround && d < 1.4) mob.vy = JUMP;
    return [dx / d * speed, dz / d * speed];
  }
  return null;
}
export const toward = (mob: Mob, x: number, z: number, speed: number): [number, number] => {
  const dx = x - mob.x, dz = z - mob.z, d = Math.hypot(dx, dz) || 1;
  return [dx / d * speed, dz / d * speed];
};

/** Now and then, plan a short walk to a random nearby cell. */
export function wander(state: State, mob: Mob) {
  if (mob.path && mob.pathIndex < mob.path.length || state.rand() > 0.12) return;
  const goal = cellOf(mob.x + (state.rand() - 0.5) * 16, mob.y, mob.z + (state.rand() - 0.5) * 16);
  computePath(state, mob, goal, 80);
}

/** Target selection and path planning, a few times per second per mob. */
function think(state: State, mob: Mob) {
  mob.thinkAt = state.clock + 0.4 + state.rand() * 0.2;
  const type = MOB_TYPES[mob.t]!;
  if (type.hostile) {
    const day = !isNight(state.time) && state.time < 12500;
    let target = mob.target ? playerById(state, mob.target) : undefined;
    const aggro = state.clock < mob.aggroUntil;
    if (target && (!huntable(state, target) || (target.x - mob.x) ** 2 + (target.z - mob.z) ** 2 > (aggro ? 40 : 24) ** 2)) target = undefined;
    if (!target && !(mob.t === MOB.spider && day)) {
      let best = CHASE_RANGE * CHASE_RANGE;
      for (const player of state.players) {
        if (!huntable(state, player)) continue;
        const d2 = (player.x - mob.x) ** 2 + (player.y - mob.y) ** 2 + (player.z - mob.z) ** 2;
        if (d2 < best && lineOfSight(state, mob.x, mob.y + type.h * 0.85, mob.z, player.x, player.y + 1.5, player.z)) { best = d2; target = player; }
      }
    }
    mob.target = target?.id ?? null;
    const prey = !target && mob.t === MOB.zombie ? preyFor(state, mob) : null;
    mob.prey = prey?.id ?? null;
    if (prey) {
      if (state.clock >= mob.repathAt) computePath(state, mob, cellOf(prey.x, prey.y, prey.z));
    } else if (target) {
      const goal = cellOf(target.x, target.y, target.z), old = mob.goal;
      const moved = !old || Math.abs(old[0] - goal[0]) + Math.abs(old[1] - goal[1]) + Math.abs(old[2] - goal[2]) > 1;
      if (state.clock >= mob.repathAt && (moved || !mob.path || mob.pathIndex >= mob.path.length)) computePath(state, mob, goal);
    } else wander(state, mob);
    return;
  }
  // Animals.
  if (state.clock < mob.panicUntil) {
    if (!mob.path || mob.pathIndex >= mob.path.length) computePath(state, mob, cellOf(mob.x + (state.rand() - 0.5) * 14, mob.y, mob.z + (state.rand() - 0.5) * 14), 80);
    return;
  }
  if (state.clock < mob.loveUntil) {
    const partner = state.mobs.find(other => other !== mob && other.t === mob.t && other.health > 0 && other.baby <= 0 && state.clock < other.loveUntil && Math.abs(other.x - mob.x) < 8 && Math.abs(other.z - mob.z) < 8);
    if (partner) {
      if (Math.hypot(partner.x - mob.x, partner.z - mob.z) < 1.5) breed(state, mob, partner);
      else computePath(state, mob, cellOf(partner.x, partner.y, partner.z), 80);
      return;
    }
  }
  const food = foodFor(mob.t), tempter = state.players.find(player => player.connected && !player.dead && food.includes(player.inv[player.slot]?.id ?? 0)
    && Math.abs(player.x - mob.x) < 8 && Math.abs(player.z - mob.z) < 8 && Math.abs(player.y - mob.y) < 4);
  if (tempter) {
    mob.goal = [tempter.x, tempter.y, tempter.z];
    mob.path = Math.hypot(tempter.x - mob.x, tempter.z - mob.z) > 2 ? [cellOf(tempter.x, tempter.y, tempter.z)] : null;
    mob.pathIndex = 0;
    return;
  }
  wander(state, mob);
}

function breed(state: State, a: Mob, b: Mob) {
  a.loveUntil = b.loveUntil = 0;
  a.breedAt = b.breedAt = state.clock + 300;
  if (state.mobs.filter(isAnimal).length >= MAX_ANIMALS) return;
  state.mobs.push(newMob(state, a.t, (a.x + b.x) / 2, Math.max(a.y, b.y), (a.z + b.z) / 2, true));
  addFx(state, 'levelup', a.x, a.y + 1, a.z);
}

/** Aim an arrow from (x, y, z) at a point with the low ballistic arc for speed v under gravity g. */
function aim(x: number, y: number, z: number, tx: number, ty: number, tz: number, v: number, spread: number, r: () => number): [number, number, number] {
  const dx = tx - x, dz = tz - z, dy = ty - y, d = Math.hypot(dx, dz) || 1, g = 20;
  const disc = v ** 4 - g * (g * d * d + 2 * dy * v * v);
  const angle = disc >= 0 ? Math.atan((v * v - Math.sqrt(disc)) / (g * d)) : Math.PI / 4;
  const heading = Math.atan2(dz, dx) + (r() - 0.5) * spread, pitch = angle + (r() - 0.5) * spread;
  return [Math.cos(heading) * Math.cos(pitch) * v, Math.sin(pitch) * v, Math.sin(heading) * Math.cos(pitch) * v];
}

/** Per-tick hostile actions; returns the desired horizontal velocity. */
function hostileAct(state: State, mob: Mob, dt: number): [number, number] {
  const speed = SPEED[mob.t]!, chosen = mob.target ? playerById(state, mob.target) : undefined;
  // Targets that died, left or gained protection since the last think are dropped at once (no fuse, no swing).
  const target = chosen && huntable(state, chosen) ? chosen : undefined;
  if (!target) {
    mob.fuse = Math.max(0, mob.fuse - dt);
    const prey = mob.prey === null ? undefined : state.mobs.find(m => m.id === mob.prey && m.health > 0);
    if (prey) return huntPrey(state, mob, prey, speed);
    return followPath(mob, speed * 0.6) ?? [0, 0];
  }
  const dx = target.x - mob.x, dz = target.z - mob.z, dist = Math.hypot(dx, dz), dy = target.y - mob.y;
  const type = MOB_TYPES[mob.t]!, eye = mob.y + type.h * 0.85, easy = state.settings.difficulty === 'easy';
  const sees = () => lineOfSight(state, mob.x, eye, mob.z, target.x, target.y + 1.5, target.z);
  mob.yaw = Math.atan2(-dx, -dz);
  const chase = () => dist < 2.5 && Math.abs(dy) < 1.5 ? toward(mob, target.x, target.z, speed) : followPath(mob, speed) ?? (dist < 6 ? toward(mob, target.x, target.z, speed) : [0, 0]);

  if (mob.t === MOB.creeper) {
    if (dist < 3 && Math.abs(dy) < 2.5 && sees()) {
      if (mob.fuse === 0) addFx(state, 'mob', mob.x, mob.y + 1, mob.z, MOB.creeper);
      mob.fuse += dt;
      if (mob.fuse >= 1.5) {
        mob.health = 0;
        explode(state, mob.x, mob.y + 0.8, mob.z, 3, 'was blown up by a Creeper');
      }
      return [0, 0];
    }
    mob.fuse = Math.max(0, mob.fuse - dt);
    return chase();
  }
  if (mob.t === MOB.skeleton) {
    const seen = dist < 15 && sees();
    mob.charge = seen ? mob.charge + dt : 0;
    if (seen && mob.charge >= 1 && state.clock >= mob.cooldown) {
      const [vx, vy, vz] = aim(mob.x, eye, mob.z, target.x, target.y + 1.1, target.z, 24, easy ? 0.12 : 0.06, state.rand);
      spawnArrow(state, mob.x + vx / 24 * 0.6, eye, mob.z + vz / 24 * 0.6, vx, vy, vz, hostileDamage(state, 3 + Math.floor(state.rand() * 2)), mob.id, false);
      mob.cooldown = state.clock + 1.5 + state.rand();
      mob.charge = 0;
      mob.attackUntil = state.clock + 0.3;
    }
    if (seen && dist < 4) return toward(mob, mob.x - dx, mob.z - dz, speed * 0.8);
    if (seen && dist < 10) return [0, 0];
    return chase();
  }
  if (mob.t === MOB.spider && mob.onGround && dist > 2 && dist < 5 && Math.abs(dy) < 2 && state.clock >= mob.cooldown && sees()) {
    mob.vy = 6;
    mob.cooldown = state.clock + 2.5;
    return toward(mob, target.x, target.z, 7);
  }
  // Melee (zombie, spider).
  const reach = 0.3 + type.w / 2 + 0.6;
  if (dist < reach + 0.2 && dy > -1.5 && dy < type.h && state.clock >= mob.cooldown) {
    damagePlayer(state, target, hostileDamage(state, mob.t === MOB.zombie ? 3 : 2), `was slain by ${mob.t === MOB.zombie ? 'a Zombie' : 'a Spider'}`, { x: mob.x, z: mob.z, strength: 5, up: 3.5 }, 'mob');
    mob.cooldown = state.clock + 1;
    mob.attackUntil = state.clock + 0.4;
  }
  return dist < reach ? [0, 0] : chase();
}

/** A monster chasing and hitting a mob (zombies and villagers). */
function huntPrey(state: State, mob: Mob, prey: Mob, speed: number): [number, number] {
  const dist = Math.hypot(prey.x - mob.x, prey.z - mob.z);
  mob.yaw = Math.atan2(-(prey.x - mob.x), -(prey.z - mob.z));
  if (dist < 1.2 && Math.abs(prey.y - mob.y) < 1.5 && state.clock >= mob.cooldown) {
    damageMob(state, prey, 3, null, { x: mob.x, z: mob.z, strength: 5, up: 3.5 });
    mob.cooldown = state.clock + 1;
    mob.attackUntil = state.clock + 0.4;
  }
  return dist < 1 ? [0, 0] : followPath(mob, speed) ?? (dist < 6 ? toward(mob, prey.x, prey.z, speed) : [0, 0]);
}

function animalAct(state: State, mob: Mob, dt: number): [number, number] {
  const panic = state.clock < mob.panicUntil, speed = SPEED[mob.t]! * (panic ? 2 : mob.goal && !mob.path ? 0 : 1);
  if (mob.baby > 0) mob.baby = Math.max(0, mob.baby - dt);
  if (mob.t === MOB.chicken && mob.baby <= 0 && state.clock >= mob.eggAt) {
    mob.eggAt = state.clock + 300 + state.rand() * 300;
    spawnItem(state, mob.x, mob.y + 0.3, mob.z, { id: I.egg, n: 1 });
  }
  if (mob.t === MOB.sheep && mob.sheared && mob.onGround && state.rand() < dt / 40 && cellId(state.getLoaded(mob.x, mob.y - 0.1, mob.z)) === B.grass_block) mob.sheared = false;
  if (mob.goal && !mob.path) {
    // Following a tempting player: face them and stay close.
    mob.yaw = Math.atan2(-(mob.goal[0] - mob.x), -(mob.goal[2] - mob.z));
    return [0, 0];
  }
  return followPath(mob, speed) ?? [0, 0];
}

/** Integrate one mob: steering towards `desired`, gravity/buoyancy, collision, stuck jumps, fall damage; `animate` sets `a`. */
function physics(state: State, mob: Mob, desired: [number, number], dt: number, animate = true) {
  const type = MOB_TYPES[mob.t]!, scale = scaleOf(mob), get = state.getLoaded;
  mob.inWater = isWater(get(mob.x, mob.y + 0.4 * type.h * scale, mob.z));
  const rate = mob.onGround ? 10 : mob.inWater ? 4 : 1.5, k = Math.min(1, rate * dt);
  mob.vx += (desired[0] - mob.vx) * k;
  mob.vz += (desired[1] - mob.vz) * k;
  if (mob.inWater) mob.vy += (1.2 - mob.vy) * Math.min(1, dt * 3);
  else mob.vy = Math.max(mob.vy - GRAVITY * dt, mob.t === MOB.chicken ? -3 : -78);
  const moving = desired[0] !== 0 || desired[1] !== 0;
  const hit = moveBody(get, mob, type.w * scale, type.h * scale, dt, STEP_HEIGHT);
  if ((hit.hitX || hit.hitZ) && moving) {
    if (mob.t === MOB.spider) mob.vy = 3;
    else if (mob.onGround || mob.inWater) mob.vy = JUMP;
  }
  if (moving && Math.abs(desired[0]) + Math.abs(desired[1]) > 0.1) mob.yaw = Math.atan2(-desired[0], -desired[1]);
  if (mob.onGround || mob.inWater) {
    const fall = mob.fallPeak - mob.y;
    if (mob.onGround && fall > 3 && mob.t !== MOB.chicken) damageMob(state, mob, Math.floor(fall - 3), null);
    mob.fallPeak = mob.y;
  } else mob.fallPeak = Math.max(mob.fallPeak, mob.y);
  if (animate) mob.a = mob.fuse > 0 || mob.charge > 0.4 ? 3 : state.clock < mob.attackUntil ? 2 : Math.hypot(mob.vx, mob.vz) > 0.3 ? 1 : 0;
}

/**
 * Soft push between overlapping mobs so herds and hordes spread out (only mobs whose physics ran, which damps it).
 * A mob walking a path gives way a quarter as much as an idle one, so it can squeeze past through a one-wide door.
 */
const yieldOf = (mob: Mob) => mob.path && mob.pathIndex < mob.path.length ? 1 : 4;
function separate(mobs: readonly Mob[]) {
  for (let i = 0; i < mobs.length; i++) for (let j = i + 1; j < mobs.length; j++) {
    const a = mobs[i]!, b = mobs[j]!;
    const min = (MOB_TYPES[a.t]!.w * scaleOf(a) + MOB_TYPES[b.t]!.w * scaleOf(b)) / 2;
    const dx = b.x - a.x, dz = b.z - a.z;
    if (Math.abs(dx) >= min || Math.abs(dz) >= min || Math.abs(a.y - b.y) > 1.5) continue;
    const d = Math.hypot(dx, dz) || 0.01;
    if (d >= min) continue;
    const push = min - d, nx = dx / d, nz = dz / d, pa = push * yieldOf(a), pb = push * yieldOf(b);
    a.vx -= nx * pa;
    a.vz -= nz * pa;
    b.vx += nx * pb;
    b.vz += nz * pb;
  }
}

export function tickMobs(state: State, dt: number) {
  if (state.settings.difficulty === 'peaceful') state.mobs = state.mobs.filter(mob => !isHostile(mob));
  else if (state.ticks % 20 === 3) {
    spawnHostiles(state);
    spawnNetherMobs(state);
  }
  state.pathBudget = PATH_BUDGET;
  const day = state.time < 12000 || state.time >= 23500, simulated: Mob[] = [];
  for (const mob of state.mobs) {
    if (mob.health <= 0) continue;
    let nearest = Infinity;
    for (const player of state.players) if (player.connected) nearest = Math.min(nearest, (player.x - mob.x) ** 2 + (player.y - mob.y) ** 2 + (player.z - mob.z) ** 2);
    nearest = Math.sqrt(nearest);
    const hostile = isHostile(mob);
    // Despawn before the loaded check: a hostile left in an evicted chunk must not hold a hostile-cap slot forever.
    if (hostile && (nearest > 96 || nearest > 32 && state.rand() < dt / 40)) { mob.health = 0; continue; }
    if (nearest > 80 || !isLoaded(state, mob.x, mob.z)) continue;
    const custom = CUSTOM_AI[mob.t];
    if (!custom && state.clock >= mob.thinkAt) think(state, mob);
    const desired = custom ? custom(state, mob, dt) : hostile ? hostileAct(state, mob, dt) : animalAct(state, mob, dt);
    if (mob.health <= 0) continue;
    if (desired) physics(state, mob, desired, dt, !custom);
    simulated.push(mob);
    // Stuck on a path for a second: plan again after a random pause, so two mobs jammed in one doorway take turns.
    if (mob.path && mob.pathIndex < mob.path.length) {
      mob.stuck = Math.hypot(mob.x - mob.lastX, mob.z - mob.lastZ) < 0.02 ? mob.stuck + dt : 0;
      if (mob.stuck > 1) Object.assign(mob, { path: null, stuck: 0, repathAt: state.clock + state.rand() * 2 });
    }
    mob.lastX = mob.x;
    mob.lastZ = mob.z;
    if (state.ticks % 20 === mob.id % 20) {
      const sunlit = (mob.t === MOB.zombie || mob.t === MOB.skeleton) && day && !mob.inWater && skyExposed(state.getLoaded, mob.x, mob.y + MOB_TYPES[mob.t]!.h, mob.z);
      if (sunlit) igniteEntity(state, mob, BURN_SECONDS.daylight);
    }
    if (state.clock >= mob.ambientAt && MOB_TYPES[mob.t]!.kind !== 'object') {
      mob.ambientAt = state.clock + 8 + state.rand() * 12;
      if (nearest < 16) addFx(state, 'mob', mob.x, mob.y + 1, mob.z, mob.t);
    }
  }
  separate(simulated);
  if (state.mobs.some(mob => mob.health <= 0)) state.mobs = state.mobs.filter(mob => mob.health > 0);
}
