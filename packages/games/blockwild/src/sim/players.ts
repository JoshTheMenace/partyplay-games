/** Player lifecycle: movement validation, environment (fall, water), survival stats, death/respawn and sleeping. */
import { B, blockOf, cellId, isSolid, isWater } from '../shared/blocks';
import { FLY_SPEED, FLY_VERTICAL, inNether, JUMP_VELOCITY, MAX_AIR, MAX_FOOD, MAX_HEALTH, SPRINT_SPEED, TERMINAL_VELOCITY } from '../shared/constants';
import type { Vec3 } from '../shared/coords';
import { emptyInventory, emptySlots } from '../shared/inventory';
import { bodyBox, bodyCollides, collectBoxes, eyeInWater, newBody, regionCollides, regionTouches } from '../shared/physics';
import { IF, MOB_TYPES, q2, q3, type Input } from '../shared/protocol';
import { damagePlayer, exhaust, explode } from './combat';
import { activePlayers, addFx, canSleep, PROTECT_SECONDS, toast, type Player, type State } from './state';
import { breakBlock, standNear } from './world';

export function newPlayer(id: string, name: string, color: string, spawn: Vec3): Player {
  return {
    id, name, color, connected: true, x: spawn[0], y: spawn[1], z: spawn[2], yaw: 0, pitch: 0,
    sneaking: false, flying: false, slot: 0, onGround: true, inWater: false, eyeInWater: false, movedAt: 0, walkBudget: 0, supportY: spawn[1], slack: 0, slackUntil: 0,
    // tp.n starts at 1 so a fresh client adopts the server spawn before its positions are accepted.
    tp: { n: 1, x: spawn[0], y: spawn[1], z: spawn[2] }, imp: { n: 0, vx: 0, vy: 0, vz: 0 }, fallPeak: spawn[1],
    health: MAX_HEALTH, food: MAX_FOOD, saturation: 5, exhaustion: 0, air: MAX_AIR, regenAt: 0, starveAt: 0, drownAt: 0,
    invulnUntil: 0, lastDamage: 0, protectedUntil: PROTECT_SECONDS, dead: false, deathMessage: '', bed: null, sleeping: false, sleepSince: 0,
    inv: emptyInventory(), cursor: null, grid: emptySlots(4), out: null, screen: null, armor: emptySlots(4), fire: 0, portal: 0, portalLock: false,
    ack: 0, mine: null, breakTokens: 3, attackAt: -1,
    useStart: -1, swing: 0, hurt: 0, swingAt: 0, toast: null, stats: { mined: 0, placed: 0, crafted: 0, mobs: 0, deaths: 0, distance: 0 }, milestones: 0,
  };
}

/**
 * Move a player on the server and tell the client (it applies `tp` once per new n and echoes it in `tpAck`).
 * The fall restarts here; ground and water state follow the new spot (mid-air snap-backs keep the old support height).
 * A `yaw` also turns the player (portal arrivals face out of the portal).
 */
export function teleport(state: State, player: Player, x: number, y: number, z: number, yaw?: number) {
  player.x = q2(x);
  player.y = q2(y);
  player.z = q2(z);
  player.tp = { n: player.tp.n + 1, x: player.x, y: player.y, z: player.z };
  if (yaw !== undefined) player.tp.yaw = player.yaw = q3(yaw);
  player.movedAt = state.clock;
  player.fallPeak = player.y;
  updateEnvironment(state, player);
}

type Get = State['get'];
/** Body (standing or crouched) fits without overlapping collision by more than 0.05. */
const fits = (get: Get, x: number, y: number, z: number) => !bodyCollides(get, { x, y, z, sneaking: false }, 0.05) || !bodyCollides(get, { x, y, z, sneaking: true }, 0.05);
const supported = (get: Get, x: number, y: number, z: number) => regionCollides(get, x - 0.3, y - 0.08, z - 0.3, x + 0.3, y + 0.01, z + 0.3);
/** A thin chest-height column along the move must stay clear: catches passing through walls in one burst. */
function sweepBlocked(get: Get, from: Player, x: number, y: number, z: number): boolean {
  const dx = x - from.x, dy = y - from.y, dz = z - from.z, steps = Math.ceil(Math.hypot(dx, dy, dz) / 0.25);
  for (let i = 1; i < steps; i++) {
    const t = i / steps, px = from.x + dx * t, py = from.y + dy * t + 0.9, pz = from.z + dz * t;
    if (regionCollides(get, px - 0.05, py, pz - 0.05, px + 0.05, py + 0.3, pz + 0.05)) return true;
  }
  return false;
}

/** Survival: highest rise above the last supported height (a 1.27-block jump plus margin). */
const MAX_RISE = 1.6;
/**
 * Horizontal distance a player may cover now: a bucket filling at 1.35× top speed since the last accepted move,
 * holding at most a 1.1 s lag burst plus 0.6 m. Spending it (not re-granting a fixed allowance per update) keeps
 * sustained speed honest.
 */
function walkBudget(state: State, player: Player) {
  const rate = (state.settings.mode === 'creative' ? FLY_SPEED : SPRINT_SPEED) * 1.35;
  return Math.min(rate * 1.1 + 0.6, player.walkBudget + rate * (state.clock - player.movedAt));
}

/** A body box moving from `player` to (x, y, z) would newly overlap a block (by more than 0.05) that it does not touch now. */
function entersBlock(get: Get, player: Player, x: number, y: number, z: number): boolean {
  const from = bodyBox(player), to = bodyBox({ x, y, z, sneaking: player.sneaking }), boxes = collectBoxes(get, ...to);
  const overlaps = (i: number, box: readonly number[], t: number) =>
    boxes[i]! < box[3]! - t && boxes[i + 3]! > box[0]! + t && boxes[i + 1]! < box[4]! - t && boxes[i + 4]! > box[1]! + t && boxes[i + 2]! < box[5]! - t && boxes[i + 5]! > box[2]! + t;
  for (let i = 0; i < boxes.length; i += 6) if (overlaps(i, to, 0.05) && !overlaps(i, from, 0)) return true;
  return false;
}

/**
 * Accept a client position inside a generous, mode-aware speed envelope (lag bursts up to 1 s, terminal-velocity falls,
 * impulse slack, no climbing through the air in survival) that does not end inside or pass through blocks. Players
 * already stuck (the world changed around them) may move within or out of the blocks they overlap, never into new ones.
 */
export function validMove(state: State, player: Player, x: number, y: number, z: number): boolean {
  const get = state.get, creative = state.settings.mode === 'creative';
  const elapsed = Math.min(state.clock - player.movedAt, 1) + 0.1, slack = state.clock < player.slackUntil ? player.slack : 0;
  const horizontal = Math.hypot(x - player.x, z - player.z), dy = y - player.y;
  if (horizontal > walkBudget(state, player) + slack) return false;
  if (dy > (creative ? FLY_VERTICAL * 1.35 : JUMP_VELOCITY) * elapsed + 1.3 + slack) return false;
  if (!creative && dy > 0 && y > player.supportY + MAX_RISE + slack) return false;
  if (-dy > TERMINAL_VELOCITY * elapsed + 2 + slack) return false;
  if (!fits(get, player.x, player.y, player.z)) return !entersBlock(get, player, x, y, z);
  return fits(get, x, y, z) && !sweepBlocked(get, player, x, y, z);
}

/** Apply the look/slot/flags of an input and validate its position (teleporting back on rejection). */
export function applyMovement(state: State, player: Player, input: Input) {
  if (input.f & IF.NO_POS) return;
  player.yaw = input.yaw;
  player.pitch = input.pitch;
  player.slot = input.slot;
  player.sneaking = (input.f & IF.SNEAK) !== 0;
  player.flying = state.settings.mode === 'creative' && (input.f & IF.FLYING) !== 0;
  if (player.dead || player.sleeping || input.tpAck < player.tp.n) return;
  const [x, y, z] = input.p;
  if (x === player.x && y === player.y && z === player.z) return;
  if (!validMove(state, player, x, y, z)) {
    teleport(state, player, player.x, player.y, player.z);
    return;
  }
  const walked = Math.hypot(x - player.x, z - player.z), wasGrounded = player.onGround;
  player.stats.distance += walked;
  if (player.inWater) exhaust(player, 0.01 * walked);
  else if (input.f & IF.SPRINT && wasGrounded) exhaust(player, 0.1 * walked);
  if (wasGrounded && y > player.y + 0.05 && !player.inWater) exhaust(player, input.f & IF.SPRINT ? 0.2 : 0.05);
  player.walkBudget = Math.max(0, walkBudget(state, player) - walked);
  player.x = x;
  player.y = y;
  player.z = z;
  player.movedAt = state.clock;
  updateEnvironment(state, player);
}

/** Ground/water state from the accepted position; lands falls (damage = fall − 3, softened by hay and beds). */
export function updateEnvironment(state: State, player: Player) {
  const get = state.get, box = bodyBox(player), wasInWater = player.inWater;
  player.onGround = supported(get, player.x, player.y, player.z);
  player.inWater = regionTouches(get, ...box, isWater);
  player.eyeInWater = eyeInWater(get, { ...newBody(player.x, player.y, player.z), sneaking: player.sneaking });
  const onLadder = regionTouches(get, box[0] - 0.02, box[1], box[2] - 0.02, box[3] + 0.02, box[4], box[5] + 0.02, cell => blockOf(cell).climbable);
  if (!(player.onGround || player.inWater || onLadder || player.flying)) {
    player.fallPeak = Math.max(player.fallPeak, player.y);
    return;
  }
  const fall = player.fallPeak - player.y;
  if (player.inWater && !wasInWater && fall > 1.5) addFx(state, 'splash', player.x, player.y, player.z);
  if (player.onGround && !player.inWater && fall > 3) {
    const below = cellId(get(player.x, player.y - 0.1, player.z));
    const damage = Math.floor((fall - 3) * (below === B.hay_bale ? 0.2 : below === B.bed ? 0.5 : 1));
    damagePlayer(state, player, damage, fall > 6 ? 'fell from a high place' : 'hit the ground too hard', undefined, 'fall');
  }
  player.fallPeak = player.supportY = player.y;
}

/** Air, cactus, hunger, regeneration and starvation for one tick. Creative players stay topped up. */
export function survivalTick(state: State, player: Player, dt: number) {
  if (!player.connected || player.dead) return;
  if (state.settings.mode === 'creative') {
    player.health = MAX_HEALTH;
    player.food = MAX_FOOD;
    player.air = MAX_AIR;
    return;
  }
  const { clock } = state, peaceful = state.settings.difficulty === 'peaceful';
  if (player.eyeInWater) {
    player.air = Math.max(0, player.air - dt * 20);
    if (player.air <= 0 && clock >= player.drownAt) {
      player.drownAt = clock + 1;
      damagePlayer(state, player, 2, 'drowned', undefined, 'drown');
    }
  } else player.air = Math.min(MAX_AIR, player.air + dt * 100);
  const box = bodyBox(player);
  if (regionTouches(state.get, box[0] - 0.02, box[1] - 0.02, box[2] - 0.02, box[3] + 0.02, box[4], box[5] + 0.02, cell => cellId(cell) === B.cactus)) {
    damagePlayer(state, player, 1, 'was pricked to death', undefined, 'cactus');
  }
  if (player.exhaustion >= 4) {
    player.exhaustion -= 4;
    if (player.saturation > 0) player.saturation = Math.max(0, player.saturation - 1);
    else if (!peaceful) player.food = Math.max(0, player.food - 1);
  }
  // Regeneration: fast (0.5 s) while full with saturation, slow (4 s) at food >= 18; peaceful heals and feeds every second.
  const fast = player.food >= MAX_FOOD && player.saturation > 0, canRegen = peaceful || player.food >= 18;
  if (!canRegen || player.health >= MAX_HEALTH && (!peaceful || player.food >= MAX_FOOD)) player.regenAt = clock + (peaceful ? 1 : fast ? 0.5 : 4);
  else if (clock >= player.regenAt) {
    player.regenAt = clock + (peaceful ? 1 : fast ? 0.5 : 4);
    player.health = Math.min(MAX_HEALTH, player.health + 1);
    if (peaceful) player.food = Math.min(MAX_FOOD, player.food + 1);
    else exhaust(player, 3);
  }
  if (player.food > 0 || peaceful) player.starveAt = clock + 4;
  else if (clock >= player.starveAt) {
    player.starveAt = clock + 4;
    if (player.health > (state.settings.difficulty === 'easy' ? 1 : 0)) damagePlayer(state, player, 1, 'starved to death', undefined, 'starve');
  }
}

/** A free standing spot next to a bed (either half), or null if the bed is gone or boxed in. */
export function besideBed(state: State, bed: Vec3): Vec3 | null {
  const get = state.get, [bx, by, bz] = bed;
  if (cellId(get(bx, by, bz)) !== B.bed) return null;
  for (let r = 1; r <= 2; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) for (const dy of [0, 1, -1]) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const x = bx + dx + 0.5, y = by + dy, z = bz + dz + 0.5;
    if (isSolid(get(x, y - 1, z)) && !isWater(get(x, y, z)) && !bodyCollides(get, { x, y, z, sneaking: false })) return [x, y, z];
  }
  return null;
}
/** Hostiles within this many blocks of a respawning player despawn. */
const RESPAWN_CLEAR = 16;
/** Where a player respawns: beside their bed if it still stands, else the world spawn. */
export function respawnPoint(state: State, player: Player): Vec3 {
  return (player.bed && besideBed(state, player.bed)) || state.spawn;
}

export function respawn(state: State, player: Player): boolean {
  if (!player.dead) return false;
  const bed = player.bed && besideBed(state, player.bed);
  if (player.bed && !bed) {
    player.bed = null;
    toast(player, 'Your home bed was missing or obstructed.');
  }
  const [x, y, z] = bed ?? standNear(state, state.spawn, state.players.indexOf(player));
  Object.assign(player, { dead: false, deathMessage: '', health: MAX_HEALTH, food: MAX_FOOD, saturation: 5, exhaustion: 0, air: MAX_AIR, invulnUntil: state.clock + 1, lastDamage: 0, protectedUntil: state.clock + PROTECT_SECONDS });
  teleport(state, player, x, y, z);
  // Monsters camping the respawn point quietly despawn, so one bad night is not a string of deaths.
  for (const mob of state.mobs) if (MOB_TYPES[mob.t]!.hostile && (mob.x - x) ** 2 + (mob.z - z) ** 2 < RESPAWN_CLEAR ** 2 && Math.abs(mob.y - y) < 8) mob.health = 0;
  return true;
}

/** Use a bed: always sets the respawn point; at night (and with no monsters close) the player lies down. Beds explode in the Nether. */
export function useBed(state: State, player: Player, x: number, y: number, z: number): boolean {
  if (inNether(x, z)) {
    breakBlock(state, x, y, z, []);
    explode(state, x + 0.5, y + 0.5, z + 0.5, 5, 'was killed by [Intentional Game Design]');
    return true;
  }
  player.bed = [x, y, z];
  if (!canSleep(state.time)) {
    toast(player, 'Respawn point set. You can only sleep at night.');
    return true;
  }
  const monsters = state.mobs.some(mob => MOB_TYPES[mob.t]!.hostile && mob.health > 0 && Math.abs(mob.x - x) < 8 && Math.abs(mob.z - z) < 8 && Math.abs(mob.y - y) < 5);
  if (monsters) {
    toast(player, 'You may not rest now; there are monsters nearby.');
    return true;
  }
  player.sleeping = true;
  player.sleepSince = state.clock;
  player.mine = null;
  teleport(state, player, x + 0.5, y + 0.5625, z + 0.5);
  const active = activePlayers(state), asleep = active.filter(p => p.sleeping).length;
  toast(player, active.length > 1 ? `Respawn point set. Sleeping… (${asleep}/${active.length} in bed)` : 'Respawn point set. Sleeping…');
  return true;
}
/** Leave the bed, standing beside it; false when not sleeping. */
export function wake(state: State, player: Player): boolean {
  if (!player.sleeping) return false;
  player.sleeping = false;
  const [x, y, z] = (player.bed && besideBed(state, player.bed)) || [player.x, player.y, player.z];
  teleport(state, player, x, y, z);
  return true;
}
/** Skip to morning once every connected, living player has slept for a moment; wake sleepers at dawn or when their bed breaks. */
export function sleepTick(state: State) {
  for (const player of state.players) if (player.sleeping && (!canSleep(state.time) || !player.bed || cellId(state.get(...player.bed)) !== B.bed)) wake(state, player);
  const active = activePlayers(state);
  if (!active.length || !active.every(player => player.sleeping && state.clock - player.sleepSince >= 2.5)) return;
  state.time = 0;
  state.day++;
  state.stats.days = state.day;
  for (const player of active) {
    wake(state, player);
    addFx(state, 'levelup', player.x, player.y + 1, player.z);
  }
}
