/**
 * The Ender Dragon fight: the dragon (boss mob), end crystals (object mobs on the pillars), dragon fireballs
 * (projectile k 4), acid clouds and the boss bar.
 *
 * The dragon flies itself at 20 Hz with a turn-rate-limited heading, so every path is a smooth arc: it circles the
 * pillar ring in a lazy figure (phase 0), now and then dives at a player in the End and spits a fireball that bursts into
 * an acid cloud (1), lands on the exit portal pillar (2), perches there breathing acid with its head low enough to hit (3),
 * takes off (4) and, at 0 health, rises and fades for 8 s (5) before the exit portal opens (end.dragonSlain).
 * Its position is clamped to a cylinder above the island, so it can never get stuck below it or leave the region.
 * Crystals heal it from 32 blocks; destroying the healing one hurts it. Clients see crystals beaming via `a = 3`
 * and acid clouds as 'acid' effects (a = radius) that linger ACID_SECONDS.
 */
import { B, cellId, isOpaque, isSolid } from '../shared/blocks';
import { END_CENTER, inEnd } from '../shared/constants';
import type { Vec3 } from '../shared/coords';
import { crystalSpot, endPillars, EXIT_RIM_SIDES, EXIT_PORTAL, EXIT_Y, PERCH_Y, type Pillar } from '../shared/end';
import { bodyBox } from '../shared/physics';
import { DRAGON_HEAD, DRAGON_PHASE, MOB, mobBoxes, PK, type BossView } from '../shared/protocol';
import { raycastBlocks, rayAabb } from '../shared/raycast';
import { damageMob, damagePlayer, hostileDamage, impulse, mobHitBoxes, spawnArrow, type Hit } from './combat';
import { dragonSlain, openExitPortal } from './end';
import { huntable, newMob } from './mobs';
import { DRAGON_HEALTH } from './save';
import { activePlayers, addFx, dist2, playerById, toast, type Mob, type Player, type State } from './state';
import { writeCell, writeCells } from './world';

type Cloud = { x: number; y: number; z: number; until: number; hitAt: number };
/** Dragon fight server state (AI timers, acid clouds, recent strikers), created with the world and not saved. */
export type DragonState = {
  clouds: Cloud[];
  /** Player name → clock of their last hit on the dragon (victory credit: the last 60 s). */
  strikers: Map<string, number>;
  /** Next strafe and perch, the current phase's deadline, the strafe target and whether it has fired. */
  strafeAt: number; perchAt: number; phaseUntil: number; target: string | null; fired: boolean;
  /** The crystal beaming at the dragon (mob id, 0 none), damage taken on this perch, the next breath. */
  beam: number; perchDamage: number; breathAt: number;
};
export const newDragonState = (): DragonState => ({
  clouds: [], strikers: new Map(), strafeAt: 0, perchAt: 0, phaseUntil: 0, target: null, fired: false, beam: 0, perchDamage: 0, breathAt: 0,
});

const P = DRAGON_PHASE;
/** Flight: speeds (m/s), turn rate (rad/s) and the cylinder it lives in (radius around END_CENTER, heights). */
const CIRCLE_SPEED = 12, STRAFE_SPEED = 17, LAND_SPEED = 10, TURN = 1.4, BOUND_R = 150, MIN_Y = PERCH_Y, MAX_Y = 118;
const HEAL_RANGE = 32, CRYSTAL_HIT = 10, FIREBALL_SPEED = 15, FIREBALL_LIFE = 8, BUFFET = 5, DEATH_SECONDS = 8;
export const ACID_RADIUS = 3, ACID_SECONDS = 3, ACID_DAMAGE = 3;
/** Perched damage that makes it take off early, and how long credit for a hit lasts. */
const PERCH_FLINCH = 50, CREDIT_SECONDS = 60, INVULN = 0.5, BREATH = 1.8, GUST_R = 9;
const { x: CX, z: CZ } = END_CENTER;
const clamp = (v: number, lo: number, hi: number) => v < lo ? lo : v > hi ? hi : v;
const wrap = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

export const dragonOf = (state: State) => state.mobs.find(mob => mob.t === MOB.ender_dragon && mob.health > 0);
const crystals = (state: State) => state.mobs.filter(mob => mob.t === MOB.end_crystal && mob.health > 0);
const inEndNow = (player: Player) => player.connected && !player.dead && inEnd(player.x, player.z);
/** Pillar crystals carry their pillar index + 1 in `p` (player-placed ones have 0). */
const pillarOf = (crystal: Mob) => crystal.p - 1;

// ---------------------------------------------------------------------------------------------
// Lifecycle

/** Next strafe (10–25 s, 6–14 s once the crystals are gone) and, if none is due, the next perch. */
function schedule(state: State, d: DragonState) {
  const clock = state.clock, r = state.rand;
  d.strafeAt = clock + (state.end.crystals.length ? 10 + r() * 15 : 6 + r() * 8);
  d.perchAt ||= clock + (40 + r() * 30) * (state.end.crystals.length ? 1 : 0.5);
}

/**
 * Every tick, before mobs: once a player is in the End, spawn the dragon (if `state.end` says it lives) hovering above
 * the island centre with its saved health, and a crystal on every pillar still listed; then check for a respawn ritual.
 */
export function ensureDragon(state: State): void {
  if (!state.players.some(inEndNow)) return;
  const end = state.end, live = crystals(state), pillars = endPillars(state.settings.seed);
  for (const i of end.crystals) if (!live.some(c => pillarOf(c) === i)) {
    const [x, y, z] = crystalSpot(pillars[i]!);
    state.mobs.push(Object.assign(newMob(state, MOB.end_crystal, x, y, z), { p: i + 1, yaw: 0 }));
  }
  if (end.dragon === 'alive' && !state.mobs.some(mob => mob.t === MOB.ender_dragon && mob.health > 0)) {
    const dragon = Object.assign(newMob(state, MOB.ender_dragon, CX + 0.5, 92, CZ + 0.5), { health: end.health, yaw: 0, ph: P.CIRCLING });
    state.mobs.push(dragon);
    state.dragon.perchAt = 0;
    schedule(state, state.dragon);
    // Saved mid-death: the death already happened.
    if (end.health <= 0) finish(state, dragon);
  }
  if (end.dragon === 'dead' && state.ticks % 20 === 0) {
    if (!end.portalActive) openExitPortal(state);
    else tryRespawn(state, live);
  }
}

/**
 * The optional replay: four end crystals placed on the middle of each side of the open exit portal's rim bring the dragon
 * back. The portal closes, the pillar tops are restored to how the world made them and every pillar gets a fresh crystal.
 */
function tryRespawn(state: State, live: Mob[]) {
  const ritual = EXIT_RIM_SIDES.map(([dx, dz]) => live.find(c => pillarOf(c) < 0 && Math.abs(c.x - (CX + dx + 0.5)) < 0.6 && Math.abs(c.z - (CZ + dz + 0.5)) < 0.6 && Math.abs(c.y - EXIT_Y - 1) < 0.6));
  if (ritual.some(c => !c)) return;
  for (const c of ritual) {
    c!.health = 0;
    addFx(state, 'crystal', c!.x, c!.y + 1, c!.z);
  }
  writeCells(state, EXIT_PORTAL.map(([dx, dz]) => [CX + dx, EXIT_Y, CZ + dz, B.air] as const));
  for (const p of endPillars(state.settings.seed)) restorePillarTop(state, p);
  Object.assign(state.end, { dragon: 'alive', health: DRAGON_HEALTH, crystals: endPillars(state.settings.seed).map((_, i) => i), portalActive: false });
  for (const c of live) if (pillarOf(c) >= 0) c.health = 0;
  addFx(state, 'portalOpen', CX + 0.5, EXIT_Y + 1, CZ + 0.5);
  for (const player of state.players) if (inEndNow(player)) toast(player, 'The Ender Dragon returns!');
}
function restorePillarTop(state: State, p: Pillar) {
  const r = p.r + 2;
  for (let y = p.top - 4; y <= p.top + 5; y++) for (let z = p.z - r; z <= p.z + r; z++) for (let x = p.x - r; x <= p.x + r; x++) {
    writeCell(state, x, y, z, state.world.generated(x, y, z));
  }
}

// ---------------------------------------------------------------------------------------------
// Flight

/** Steer towards a point: heading turns at most `turn` rad/s, pitch eases towards the climb angle; then move and clamp. */
function fly(mob: Mob, tx: number, ty: number, tz: number, speed: number, dt: number, turn = TURN) {
  const dx = tx - mob.x, dy = ty - mob.y, dz = tz - mob.z, flat = Math.hypot(dx, dz);
  if (flat > 0.01) mob.yaw = wrap(mob.yaw + clamp(wrap(Math.atan2(-dx, -dz) - mob.yaw), -turn * dt, turn * dt));
  mob.pt += (clamp(Math.atan2(dy, Math.max(flat, 1)), -0.6, 0.6) - mob.pt) * Math.min(1, dt * 3);
  const step = speed * Math.cos(mob.pt);
  mob.vx = -Math.sin(mob.yaw) * step;
  mob.vz = -Math.cos(mob.yaw) * step;
  mob.vy = speed * Math.sin(mob.pt);
  move(mob, dt);
}
/** Move straight at a point (arriving exactly), easing the heading towards the way it goes. */
function glide(mob: Mob, tx: number, ty: number, tz: number, speed: number, dt: number) {
  const dx = tx - mob.x, dy = ty - mob.y, dz = tz - mob.z, d = Math.hypot(dx, dy, dz), k = d > 0 ? Math.min(speed, d / dt) / d : 0;
  if (Math.hypot(dx, dz) > 0.5) mob.yaw = wrap(mob.yaw + clamp(wrap(Math.atan2(-dx, -dz) - mob.yaw), -TURN * dt, TURN * dt));
  Object.assign(mob, { vx: dx * k, vy: dy * k, vz: dz * k });
  move(mob, dt);
}
function move(mob: Mob, dt: number) {
  let x = mob.x + mob.vx * dt, z = mob.z + mob.vz * dt;
  const d = Math.hypot(x - CX, z - CZ);
  if (d > BOUND_R) {
    x = CX + (x - CX) / d * BOUND_R;
    z = CZ + (z - CZ) / d * BOUND_R;
  }
  Object.assign(mob, { x, y: clamp(mob.y + mob.vy * dt, MIN_Y, MAX_Y), z });
}
const perch = (): Vec3 => [CX + 0.5, PERCH_Y, CZ + 0.5];

/** The lazy figure around the pillar ring: radius 54–78 and height 72–96 wander with the angle. */
function circleTarget(mob: Mob): Vec3 {
  const a = Math.atan2(mob.z - CZ, mob.x - CX) + 0.45, r = 66 + 12 * Math.sin(2 * a);
  return [CX + Math.cos(a) * r, 84 + 12 * Math.sin(3 * a), CZ + Math.sin(a) * r];
}

/** A strafe target: a random survival player in the End (not protected or creative). */
function pickTarget(state: State): Player | undefined {
  const options = state.players.filter(p => inEnd(p.x, p.z) && huntable(state, p));
  return options[Math.floor(state.rand() * options.length)];
}

function setPhase(state: State, mob: Mob, ph: number, seconds: number) {
  mob.ph = ph;
  state.dragon.phaseUntil = state.clock + seconds;
}

/** Every-tick AI of the dragon (bosses think wherever they are). Returns null: it flies itself. */
export function thinkDragon(state: State, mob: Mob, dt: number): [number, number] | null {
  const d = state.dragon, clock = state.clock;
  mob.fire = 0;
  mob.a = mob.ph === P.PERCHED ? 0 : clock < mob.attackUntil ? 2 : 1;
  switch (mob.ph) {
    case P.CIRCLING: {
      fly(mob, ...circleTarget(mob), CIRCLE_SPEED, dt);
      if (clock >= d.perchAt) setPhase(state, mob, P.LANDING, 30);
      else if (clock >= d.strafeAt) {
        const target = pickTarget(state);
        if (target) {
          Object.assign(d, { target: target.id, fired: false });
          setPhase(state, mob, P.STRAFING, 14);
        } else d.strafeAt = clock + 4;
      }
      break;
    }
    case P.STRAFING: {
      const target = d.target ? playerById(state, d.target) : undefined;
      if (!target || !inEnd(target.x, target.z) || !huntable(state, target) || clock >= d.phaseUntil) {
        schedule(state, d);
        setPhase(state, mob, P.CIRCLING, 0);
        break;
      }
      // Dive at the player from above and fire once in range; then pull away past them for 3 s.
      if (d.fired) fly(mob, ...circleTarget(mob), STRAFE_SPEED, dt);
      else {
        fly(mob, target.x, target.y + 12, target.z, STRAFE_SPEED, dt);
        // After 5 s of diving it fires even without a clear view (at a player hiding in a hole), bursting on the cover.
        const blind = clock > d.phaseUntil - 9;
        if (dist2(mob.x, 0, mob.z, target.x, 0, target.z) < 30 * 30 && Math.abs(mob.y - target.y) < 40 && shoot(state, mob, target, blind)) {
          d.fired = true;
          d.phaseUntil = clock + 3;
        }
      }
      break;
    }
    case P.LANDING: {
      // A high approach, a slowing spiral down to the pillar, then a straight glide onto it.
      const [px, py, pz] = perch(), flat = Math.hypot(px - mob.x, pz - mob.z);
      if (flat > 8) fly(mob, px, flat < 30 ? py + 4 : py + 18, pz, Math.min(LAND_SPEED, 3 + flat * 0.4), dt, flat < 30 ? TURN * 2 : TURN);
      else glide(mob, px, py, pz, 5, dt);
      if (Math.hypot(px - mob.x, py - mob.y, pz - mob.z) < 0.01 || clock >= d.phaseUntil) {
        Object.assign(mob, { x: px, y: py, z: pz, vx: 0, vy: 0, vz: 0 });
        Object.assign(d, { perchDamage: 0, breathAt: clock + 1.5 });
        setPhase(state, mob, P.PERCHED, 6 + state.rand() * 4);
        landingGust(state);
      }
      break;
    }
    case P.PERCHED: {
      perched(state, mob, dt);
      if (clock >= d.phaseUntil || d.perchDamage >= PERCH_FLINCH) setPhase(state, mob, P.TAKING_OFF, 8);
      break;
    }
    case P.TAKING_OFF: {
      fly(mob, CX + 0.5 - Math.sin(mob.yaw) * 40, 92, CZ + 0.5 - Math.cos(mob.yaw) * 40, 9, dt);
      if (mob.y > 84 || clock >= d.phaseUntil) {
        d.perchAt = 0;
        schedule(state, d);
        setPhase(state, mob, P.CIRCLING, 0);
      }
      break;
    }
    case P.DYING: {
      Object.assign(mob, { vx: 0, vy: 1.5, vz: 0, pt: mob.pt * 0.95, yaw: wrap(mob.yaw + dt * 0.8) });
      move(mob, dt);
      if (clock >= d.phaseUntil) finish(state, mob);
      return null;
    }
  }
  heal(state, mob);
  buffet(state, mob);
  state.end.health = mob.health;
  return null;
}

/**
 * The landing's wing gust (no damage) pushes players near the fountain out from under the body, to where the lowered
 * head (about 9 blocks out) is in front of them at eye height.
 */
function landingGust(state: State) {
  for (const p of state.players) {
    const dx = p.x - CX - 0.5, dz = p.z - CZ - 0.5, d = Math.hypot(dx, dz);
    if (inEndNow(p) && d < GUST_R && Math.abs(p.y - EXIT_Y) < 8) impulse(state, p, dx / (d || 1) * 11, 5, dz / (d || 1) * 11);
  }
}

/** Perched on the portal pillar: head lowered, turning to the nearest player in the End and breathing acid at them. */
function perched(state: State, mob: Mob, dt: number) {
  const d = state.dragon;
  Object.assign(mob, { vx: 0, vy: 0, vz: 0 });
  mob.pt += (-0.35 - mob.pt) * Math.min(1, dt * 2);
  let nearest: Player | undefined, best = 24 * 24;
  for (const p of state.players) {
    const d2 = dist2(p.x, p.y, p.z, mob.x, mob.y, mob.z);
    if (inEnd(p.x, p.z) && huntable(state, p) && d2 < best) { best = d2; nearest = p; }
  }
  if (!nearest) return;
  mob.yaw = wrap(mob.yaw + clamp(wrap(Math.atan2(-(nearest.x - mob.x), -(nearest.z - mob.z)) - mob.yaw), -dt, dt));
  if (state.clock < d.breathAt) return;
  d.breathAt = state.clock + BREATH;
  mob.attackUntil = state.clock + 1;
  // The breath reaches up to 12 blocks out from the head, towards the player, and lingers where it lands.
  const head = mobHitBoxes(mob)[DRAGON_HEAD]!, hx = (head[0] + head[3]) / 2, hz = (head[2] + head[5]) / 2;
  const dx = nearest.x - hx, dz = nearest.z - hz, reach = Math.min(1, 12 / (Math.hypot(dx, dz) || 1));
  addCloud(state, hx + dx * reach, nearest.y + 1, hz + dz * reach);
}

/** The nearest crystal within 32 blocks beams at the dragon, healing 1 health every 0.5 s. */
function heal(state: State, mob: Mob) {
  if (state.ticks % 10 !== 0) return;
  let beam: Mob | undefined, best = HEAL_RANGE * HEAL_RANGE;
  for (const c of crystals(state)) {
    const d2 = dist2(c.x, c.y + 1, c.z, mob.x, mob.y + 2, mob.z);
    if (d2 < best) { best = d2; beam = c; }
  }
  state.dragon.beam = beam?.id ?? 0;
  for (const c of crystals(state)) c.a = c === beam ? 3 : 0;
  if (beam) mob.health = Math.min(DRAGON_HEALTH, mob.health + 1);
}

/** Players inside the body or wings are knocked away (5 damage, armor applies). */
function buffet(state: State, mob: Mob) {
  const boxes = mobBoxes({ t: mob.t, x: mob.x, y: mob.y, z: mob.z, yaw: mob.yaw, pt: mob.pt }).slice(2, 5);
  for (const player of state.players) {
    if (!player.connected || player.dead) continue;
    const [x0, y0, z0, x1, y1, z1] = bodyBox(player);
    if (!boxes.some(b => x0 < b[3] + 0.3 && x1 > b[0] - 0.3 && y0 < b[4] + 0.3 && y1 > b[1] - 0.3 && z0 < b[5] + 0.3 && z1 > b[2] - 0.3)) continue;
    damagePlayer(state, player, hostileDamage(state, BUFFET), 'was swatted by the Ender Dragon', { x: mob.x, z: mob.z, strength: 12, up: 7 }, 'mob');
  }
}

/**
 * Fire a dragon fireball from the head at a player's feet when the head can see them (or `blind`). With the crystals
 * gone it is a pair, 2 blocks either side of the player.
 */
function shoot(state: State, mob: Mob, target: Player, blind = false): boolean {
  const head = mobHitBoxes(mob)[DRAGON_HEAD]!, hx = (head[0] + head[3]) / 2, hy = (head[1] + head[4]) / 2, hz = (head[2] + head[5]) / 2;
  const dx = target.x - hx, dy = target.y + 0.3 - hy, dz = target.z - hz, flat = Math.hypot(dx, dz) || 1;
  if (!blind && raycastBlocks(state.getLoaded, [hx, hy, hz], [dx, dy, dz], Math.hypot(dx, dy, dz) - 1, isOpaque)) return false;
  for (const side of state.end.crystals.length ? [0] : [-2, 2]) {
    const ax = dx - dz / flat * side, az = dz + dx / flat * side, len = Math.hypot(ax, dy, az) || 1;
    spawnArrow(state, hx, hy, hz, ax / len * FIREBALL_SPEED, dy / len * FIREBALL_SPEED, az / len * FIREBALL_SPEED, 0, mob.id, false, PK.DRAGON_FIREBALL);
  }
  addFx(state, 'fireball', hx, hy, hz);
  mob.attackUntil = state.clock + 0.6;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Damage and death

/**
 * All damage to the dragon or an end crystal (melee, arrows, explosions) comes here instead of the default rules.
 * Crystals break from any damage with a power 6 blast. The dragon only takes player damage (never explosions, fire or
 * its own acid), ×1.5 on the head, with the usual 0.5 s invulnerability, and none while dying. True when damage landed.
 */
export function onDragonDamaged(state: State, mob: Mob, amount: number, attacker: Player | null, hit: Hit): boolean {
  if (mob.t === MOB.end_crystal) {
    destroyCrystal(state, mob, attacker);
    return true;
  }
  if (mob.ph === P.DYING || !attacker || amount <= 0) return false;
  return hurtDragon(state, mob, amount * (hit.part === DRAGON_HEAD ? 1.5 : 1), attacker);
}

function hurtDragon(state: State, mob: Mob, amount: number, attacker: Player | null): boolean {
  // MC-style invulnerability: during the window only a bigger hit lands, for the difference.
  let applied = amount;
  if (state.clock < mob.invulnUntil) {
    if (amount <= mob.lastDamage) return false;
    applied = amount - mob.lastDamage;
  } else mob.invulnUntil = state.clock + INVULN;
  mob.lastDamage = amount;
  mob.health = Math.max(0, mob.health - applied);
  mob.hurt++;
  addFx(state, 'hurtMob', mob.x, mob.y + 2, mob.z, mob.t);
  if (attacker) state.dragon.strikers.set(attacker.name, state.clock);
  if (mob.ph === P.PERCHED) state.dragon.perchDamage += applied;
  if (mob.health <= 0) {
    // Dying: it stays in the world (health 1, untouchable) for the 8 s animation; the boss bar reads 0.
    Object.assign(mob, { health: 1, attackUntil: 0 });
    state.end.health = 0;
    setPhase(state, mob, P.DYING, DEATH_SECONDS);
    addFx(state, 'dragonDeath', mob.x, mob.y + 2, mob.z);
  }
  return true;
}

function finish(state: State, mob: Mob) {
  mob.health = 0;
  addFx(state, 'die', mob.x, mob.y + 2, mob.z, mob.t);
  const recent = [...state.dragon.strikers].filter(([, at]) => state.clock - at <= CREDIT_SECONDS).map(([name]) => name);
  state.dragon.strikers.clear();
  state.dragon.clouds = [];
  dragonSlain(state, recent);
}

/** A crystal breaks: a power 6 blast, its pillar loses it, and if it was healing the dragon the dragon takes 10. */
function destroyCrystal(state: State, crystal: Mob, attacker: Player | null) {
  crystal.health = 0;
  const end = state.end, dragon = dragonOf(state);
  if (pillarOf(crystal) >= 0) end.crystals = end.crystals.filter(i => i !== pillarOf(crystal));
  addFx(state, 'crystal', crystal.x, crystal.y + 1, crystal.z);
  if (dragon && state.dragon.beam === crystal.id && dragon.ph !== P.DYING) {
    state.dragon.beam = 0;
    dragon.invulnUntil = 0;
    hurtDragon(state, dragon, CRYSTAL_HIT, attacker);
  }
  blast(state, crystal.x, crystal.y + 1, crystal.z, 6);
}

/**
 * A crystal's explosion: no block damage (the island and pillars stay whole), knockback within 2 × power and damage
 * that fades with distance (≈ 13 point blank, 10 at melee reach, armor applies) so a crystal broken by hand hurts but
 * is survivable; chains to other crystals in reach. The dragon is unaffected.
 */
function blast(state: State, x: number, y: number, z: number, power: number) {
  addFx(state, 'explode', x, y, z, power);
  const reach = power * 2;
  const impact = (tx: number, ty: number, tz: number) => {
    const d = Math.hypot(tx - x, ty - y, tz - z);
    if (d >= reach) return 0;
    const hidden = raycastBlocks(state.get, [x, y, z], [tx - x, ty - y, tz - z], d, isOpaque);
    return (1 - d / reach) * (hidden ? 0.3 : 1);
  };
  for (const player of state.players) {
    const k = player.dead ? 0 : impact(player.x, player.y + 0.9, player.z);
    if (k > 0) damagePlayer(state, player, Math.floor(k * k * 16 + 1), 'was blown up by an End Crystal', { x, z, strength: k * 14, up: k * 8 }, 'explosion');
  }
  for (const mob of state.mobs) {
    const k = mob.health > 0 && mob.t !== MOB.ender_dragon ? impact(mob.x, mob.y + 0.5, mob.z) : 0;
    if (k > 0) damageMob(state, mob, Math.floor(k * k * 16 + 1), null, { x, z, strength: k * 12, up: k * 8 });
  }
}

/** Every-tick AI of an end crystal near a player: it spins (its beam, `a` = 3, is set by the dragon). Never walks. */
export function thinkCrystal(_state: State, mob: Mob, dt: number): [number, number] | null {
  mob.yaw = wrap(mob.yaw + dt * 1.5);
  mob.fire = 0;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Fireballs and acid

function addCloud(state: State, x: number, y: number, z: number) {
  // Settle onto the floor below (up to 6 blocks).
  let cy = Math.floor(y);
  for (let i = 0; i < 6 && !isSolid(state.get(x, cy - 1, z)); i++) cy--;
  state.dragon.clouds.push({ x, y: cy, z, until: state.clock + ACID_SECONDS, hitAt: state.clock });
  addFx(state, 'acid', x, cy, z, ACID_RADIUS);
}

/** Every tick from tickArrows: fly dragon fireballs (`k === 4`) and run lingering acid clouds. */
export function tickAcid(state: State, dt: number): void {
  for (const ball of state.arrows) {
    if (ball.k !== PK.DRAGON_FIREBALL || ball.age === Infinity) continue;
    ball.age += dt;
    if (ball.age > FIREBALL_LIFE) { ball.age = Infinity; continue; }
    const step: Vec3 = [ball.vx * dt, ball.vy * dt, ball.vz * dt], length = Math.hypot(...step);
    let t = Infinity;
    for (const player of state.players) {
      if (player.dead || !player.connected) continue;
      const b = bodyBox(player), hit = rayAabb([ball.x, ball.y, ball.z], step, [b[0] - 0.3, b[1] - 0.3, b[2] - 0.3, b[3] + 0.3, b[4] + 0.3, b[5] + 0.3], 1);
      if (hit) t = Math.min(t, hit.distance);
    }
    const block = raycastBlocks(state.get, [ball.x, ball.y, ball.z], step, length, isSolid);
    if (block && cellId(block.cell) !== B.barrier) t = Math.min(t, Math.max(0, block.distance - 0.3) / length);
    else if (block) { ball.age = Infinity; continue; }
    if (t <= 1) {
      ball.age = Infinity;
      addCloud(state, ball.x + step[0] * t, ball.y + step[1] * t, ball.z + step[2] * t);
      continue;
    }
    ball.x += step[0];
    ball.y += step[1];
    ball.z += step[2];
  }
  const d = state.dragon;
  if (!d.clouds.length) return;
  d.clouds = d.clouds.filter(cloud => state.clock < cloud.until);
  for (const cloud of d.clouds) {
    if (state.clock < cloud.hitAt) continue;
    cloud.hitAt = state.clock + 1;
    for (const player of state.players) {
      if (player.dead || !player.connected || player.y < cloud.y - 1.5 || player.y > cloud.y + 2.5) continue;
      if ((player.x - cloud.x) ** 2 + (player.z - cloud.z) ** 2 > ACID_RADIUS * ACID_RADIUS) continue;
      damagePlayer(state, player, hostileDamage(state, ACID_DAMAGE), "was killed by the dragon's breath", undefined, 'mob');
    }
  }
}

/** The boss bar while the dragon lives (or dies) and a player is in the End. */
export function bossView(state: State): BossView | undefined {
  const dragon = dragonOf(state);
  if (!dragon || !activePlayers(state).some(p => inEnd(p.x, p.z))) return undefined;
  return { name: 'Ender Dragon', health: dragon.ph === P.DYING ? 0 : Math.ceil(dragon.health), max: DRAGON_HEALTH, crystals: state.end.crystals.length };
}

