/** Damage, death, knockback, explosions and arrows for players and mobs. */
import { B, blockOf, cellId, isOpaque, isSolid } from '../shared/blocks';
import { addItem } from '../shared/inventory';
import { I, type Slot } from '../shared/items';
import { eyeHeight } from '../shared/physics';
import { MOB, MOB_TYPES, mobBox, MS, q2 } from '../shared/protocol';
import { raycastBlocks, rayAabb } from '../shared/raycast';
import { damageArmor, reduceDamage } from './armor';
import { closeScreen } from './containers';
import { MAX_ITEMS } from './entities';
import { primeTnt } from './redstone';
import { addFx, isProtected, nextId, playerById, type Arrow, type DamageCause, type Mob, type Player, type State } from './state';
import { breakBlock, dropStacks } from './world';

export const MAX_ARROWS = 32;
const INVULN = 0.5;

/** Server-caused velocity change; the client adds it once per new `imp.n`. Also widens the movement envelope. */
export function impulse(state: State, player: Player, vx: number, vy: number, vz: number) {
  player.imp = { n: player.imp.n + 1, vx: q2(vx), vy: q2(vy), vz: q2(vz) };
  player.slack = Math.max(state.clock < player.slackUntil ? player.slack : 0, Math.hypot(vx, vy, vz) * 0.8 + 1);
  player.slackUntil = state.clock + 2;
}
export function exhaust(player: Player, amount: number) { player.exhaustion += amount; }
/** Monster damage to players: halved (at least 1) on easy. */
export const hostileDamage = (state: State, amount: number) => state.settings.difficulty === 'easy' ? Math.max(1, Math.floor(amount / 2)) : amount;

/** MC-style invulnerability: during the window only a bigger hit lands, for the difference. Returns the damage to apply. */
function absorb(target: { invulnUntil: number; lastDamage: number }, clock: number, amount: number): number {
  if (clock < target.invulnUntil) {
    if (amount <= target.lastDamage) return 0;
    const extra = amount - target.lastDamage;
    target.lastDamage = amount;
    return extra;
  }
  target.lastDamage = amount;
  target.invulnUntil = clock + INVULN;
  return amount;
}
/** Horizontal knockback away from (fromX, fromZ). */
function knockVector(x: number, z: number, fromX: number, fromZ: number, strength: number): [number, number] {
  const dx = x - fromX, dz = z - fromZ, d = Math.hypot(dx, dz) || 1;
  return [dx / d * strength, dz / d * strength];
}

export type Knock = { x: number; z: number; strength: number; up?: number };
/**
 * Damage a player (ignored in creative, while dead or disconnected). `message` completes "<name> …" on death; `cause`
 * decides whether armor helps (armor.reduceDamage, then armor.damageArmor with the same raw amount).
 */
export function damagePlayer(state: State, player: Player, amount: number, message: string, knock?: Knock, cause: DamageCause = 'other'): boolean {
  if (player.dead || !player.connected || state.settings.mode === 'creative' || isProtected(state, player) || amount <= 0) return false;
  const applied = absorb(player, state.clock, amount);
  if (applied <= 0) return false;
  const reduced = reduceDamage(state, player, applied, cause);
  damageArmor(state, player, applied, cause);
  player.health = Math.max(0, player.health - reduced);
  player.hurt++;
  exhaust(player, 0.1);
  if (player.sleeping) player.sleeping = false;
  if (knock) {
    const [vx, vz] = knockVector(player.x, player.z, knock.x, knock.z, knock.strength);
    impulse(state, player, vx, knock.up ?? 4, vz);
  }
  if (player.health <= 0) killPlayer(state, player, message);
  return true;
}

export function killPlayer(state: State, player: Player, message: string) {
  player.health = 0;
  player.dead = true;
  player.sleeping = false;
  player.deathMessage = `${player.name} ${message}`;
  player.mine = null;
  player.useStart = -1;
  closeScreen(state, player);
  if (!state.settings.keepInventory) {
    dropStacks(state, player.x, player.y + 1, player.z, [...player.inv, ...player.armor]);
    player.inv.fill(null);
    player.armor.fill(null);
  }
  player.stats.deaths++;
  state.stats.deaths++;
  addFx(state, 'die', player.x, player.y + 0.9, player.z);
}

type MobDrop = [item: number, min: number, max: number, chance?: number];
const MOB_DROPS: Record<number, MobDrop[]> = {
  [MOB.zombie]: [[I.rotten_flesh, 0, 2]],
  [MOB.skeleton]: [[I.bone, 0, 2], [I.arrow, 0, 2]],
  [MOB.spider]: [[I.string, 0, 2]],
  [MOB.creeper]: [[I.gunpowder, 0, 2]],
  [MOB.cow]: [[I.beef, 1, 3], [I.leather, 0, 2]],
  [MOB.pig]: [[I.porkchop, 1, 3]],
  [MOB.sheep]: [[I.mutton, 1, 2]],
  [MOB.chicken]: [[I.chicken, 1, 1], [I.feather, 0, 2]],
  [MOB.zombified_piglin]: [[I.rotten_flesh, 0, 1], [I.gold_nugget, 0, 1], [I.gold_ingot, 1, 1, 0.025]],
  [MOB.ghast]: [[I.gunpowder, 0, 2]],
};
export const mobState = (mob: Mob) => (mob.sheared ? MS.SHEARED : 0) | (mob.baby > 0 ? MS.BABY : 0);

/** Damage a mob; attackers make hostiles angry and animals panic. Objects (primed TNT) take no damage. */
export function damageMob(state: State, mob: Mob, amount: number, attacker: Player | null, knock?: Knock): boolean {
  if (mob.health <= 0 || amount <= 0 || MOB_TYPES[mob.t]!.kind === 'object') return false;
  const applied = absorb(mob, state.clock, amount);
  if (applied <= 0) return false;
  mob.health -= applied;
  mob.hurt++;
  addFx(state, 'hurtMob', mob.x, mob.y + 0.5, mob.z, mob.t);
  if (knock) {
    const [vx, vz] = knockVector(mob.x, mob.z, knock.x, knock.z, knock.strength);
    mob.vx = vx;
    mob.vz = vz;
    mob.vy = Math.max(mob.vy, knock.up ?? 4.5);
  }
  if (attacker) {
    if (MOB_TYPES[mob.t]!.hostile) { mob.target = attacker.id; mob.aggroUntil = state.clock + 20; }
    else mob.panicUntil = state.clock + 5;
  }
  if (mob.health <= 0) killMob(state, mob, attacker);
  return true;
}
export function killMob(state: State, mob: Mob, killer: Player | null) {
  mob.health = 0;
  addFx(state, 'die', mob.x, mob.y + 0.5, mob.z, mob.t);
  if (mob.baby <= 0) {
    const drops: Slot[] = [];
    for (const [item, min, max, chance = 1] of MOB_DROPS[mob.t] ?? []) {
      if (chance < 1 && state.rand() >= chance) continue;
      const n = min + Math.floor(state.rand() * (max - min + 1));
      if (n > 0) drops.push({ id: item, n });
    }
    if (mob.t === MOB.sheep && !mob.sheared) drops.push({ id: B.white_wool, n: 1 });
    dropStacks(state, mob.x, mob.y + 0.5, mob.z, drops);
  }
  if (killer) {
    killer.stats.mobs++;
    state.stats.mobs++;
  }
}

const EXPLOSION_PROOF = new Set<number>([B.bedrock, B.obsidian, B.water, B.air, B.barrier]);
/** Explosion (creepers, TNT, fireballs): destroys blocks (edits), chain-primes tnt, damages and knocks back everything within 2 × power. */
export function explode(state: State, x: number, y: number, z: number, power: number, source: string) {
  const r = Math.ceil(power), cells: [number, number, number, number][] = [];
  for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const d = Math.hypot(dx, dy, dz);
    if (d > power * (0.7 + 0.6 * state.rand())) continue;
    const bx = Math.floor(x) + dx, by = Math.floor(y) + dy, bz = Math.floor(z) + dz, cell = state.get(bx, by, bz);
    if (EXPLOSION_PROOF.has(cellId(cell)) || blockOf(cell).hardness < 0) continue;
    cells.push([bx, by, bz, d]);
  }
  cells.sort((a, b) => a[3] - b[3]);
  for (const [bx, by, bz] of cells) {
    const cell = state.get(bx, by, bz);
    if (EXPLOSION_PROOF.has(cellId(cell))) continue;
    if (cellId(cell) === B.tnt && primeTnt(state, bx, by, bz, 10 + Math.floor(state.rand() * 20))) continue;
    // Like MC, only 1/power of blasted blocks drop, ignoring tool tiers. These bonus drops stop at the item cap, so a
    // TNT chain's rubble never pushes out the chest contents or death drops the first blasts scattered.
    const drops: Slot[] = state.items.length < MAX_ITEMS && state.rand() < 1 / power ? blockOf(cell).drops(cell >> 8).filter(d => d.chance >= 1 && d.min > 0).map(d => ({ id: d.item, n: d.min })) : [];
    if (!breakBlock(state, bx, by, bz, drops, false)) break;
  }
  addFx(state, 'explode', x, y, z, power);
  const reach = power * 2, blocked = (cell: number) => isOpaque(cell);
  const exposure = (tx: number, ty: number, tz: number) => raycastBlocks(state.get, [x, y, z], [tx - x, ty - y, tz - z], Math.hypot(tx - x, ty - y, tz - z), blocked) ? 0 : 1;
  const hurt = (d: number, exposed: number) => {
    const impact = (1 - d / reach) * exposed;
    // MC uses 7 × 2·power; half that keeps point-blank blasts survivable for the unarmored party player (armor cuts it further).
    return { impact, damage: Math.floor((impact * impact + impact) / 2 * 7 * power + 1) };
  };
  for (const player of state.players) {
    if (player.dead) continue;
    const cy = player.y + 0.9, d = Math.hypot(player.x - x, cy - y, player.z - z);
    if (d >= reach) continue;
    const exposed = (exposure(player.x, player.y + 0.3, player.z) + exposure(player.x, player.y + eyeHeight(player), player.z)) / 2;
    const { impact, damage } = hurt(d, exposed);
    if (impact <= 0) continue;
    damagePlayer(state, player, hostileDamage(state, damage), source, { x, z, strength: impact * 14, up: impact * 9 }, 'explosion');
  }
  for (const mob of state.mobs) {
    if (mob.health <= 0) continue;
    const d = Math.hypot(mob.x - x, mob.y + 0.5 - y, mob.z - z);
    if (d >= reach) continue;
    const { impact, damage } = hurt(d, exposure(mob.x, mob.y + 0.5, mob.z));
    if (impact > 0) damageMob(state, mob, damage, null, { x, z, strength: impact * 12, up: impact * 8 });
  }
}

/** Spawn an arrow, or with k = 1 a ghast fireball (moved by nether-mobs.tickFireballs). Returns it. */
export function spawnArrow(state: State, x: number, y: number, z: number, vx: number, vy: number, vz: number, damage: number, shooter: string | number, pickup: boolean, k = 0): Arrow {
  const arrow: Arrow = { id: nextId(state), x, y, z, vx, vy, vz, age: 0, stuck: false, damage, shooter, pickup, k };
  state.arrows.push(arrow);
  if (state.arrows.length > MAX_ARROWS) state.arrows.splice(0, state.arrows.length - MAX_ARROWS);
  addFx(state, k ? 'fireball' : 'bow', x, y, z);
  return arrow;
}

function arrowHitsEntity(state: State, arrow: Arrow, length: number): { player?: Player; mob?: Mob; distance: number } | null {
  const origin: [number, number, number] = [arrow.x, arrow.y, arrow.z], dir: [number, number, number] = [arrow.vx, arrow.vy, arrow.vz];
  let best: { player?: Player; mob?: Mob; distance: number } | null = null;
  const speed = Math.hypot(arrow.vx, arrow.vy, arrow.vz);
  if (typeof arrow.shooter === 'number') {
    // Mob arrows hit players (co-op: player arrows never hit players).
    for (const player of state.players) {
      if (player.dead || !player.connected || state.settings.mode === 'creative') continue;
      const h = player.sneaking ? 1.5 : 1.8;
      const hit = rayAabb(origin, dir, [player.x - 0.4, player.y, player.z - 0.4, player.x + 0.4, player.y + h, player.z + 0.4], length);
      if (hit && (!best || hit.distance * speed < best.distance)) best = { player, distance: hit.distance * speed };
    }
  } else {
    for (const mob of state.mobs) {
      if (mob.health <= 0) continue;
      const box = mobBox({ t: mob.t, x: mob.x, y: mob.y, z: mob.z, s: mobState(mob) });
      const hit = rayAabb(origin, dir, [box[0] - 0.1, box[1], box[2] - 0.1, box[3] + 0.1, box[4], box[5] + 0.1], length);
      if (hit && (!best || hit.distance * speed < best.distance)) best = { mob, distance: hit.distance * speed };
    }
  }
  return best;
}

export function tickArrows(state: State, dt: number) {
  for (const arrow of state.arrows) {
    if (arrow.k) continue;
    arrow.age += dt;
    if (arrow.stuck) {
      if (arrow.age > 30) arrow.age = Infinity;
      else if (arrow.pickup) for (const player of state.players) {
        if (player.dead || !player.connected || Math.abs(player.x - arrow.x) > 1 || Math.abs(player.z - arrow.z) > 1 || arrow.y < player.y - 0.5 || arrow.y > player.y + 2) continue;
        if (state.settings.mode === 'survival' && addItem(player.inv, I.arrow, 1) > 0) continue;
        addFx(state, 'pickup', arrow.x, arrow.y, arrow.z, I.arrow);
        arrow.age = Infinity;
        break;
      }
      continue;
    }
    if (arrow.age > 8) { arrow.age = Infinity; continue; }
    const speed = Math.hypot(arrow.vx, arrow.vy, arrow.vz), length = speed * dt;
    // Parametric distance along the velocity is in units of |v|, so `rayAabb` distances are fractions of dt.
    const entity = arrowHitsEntity(state, arrow, dt);
    const block = speed > 0 ? raycastBlocks(state.getLoaded, [arrow.x, arrow.y, arrow.z], [arrow.vx, arrow.vy, arrow.vz], length, isSolid) : null;
    if (entity && (!block || entity.distance <= block.distance)) {
      const knock: Knock = { x: arrow.x - arrow.vx, z: arrow.z - arrow.vz, strength: 4, up: 3 };
      if (entity.player) damagePlayer(state, entity.player, arrow.damage, `was shot by ${shooterName(state, arrow)}`, knock, 'arrow');
      if (entity.mob) damageMob(state, entity.mob, arrow.damage, typeof arrow.shooter === 'string' ? playerById(state, arrow.shooter) ?? null : null, knock);
      addFx(state, 'hit', arrow.x, arrow.y, arrow.z);
      arrow.age = Infinity;
      continue;
    }
    if (block) {
      [arrow.x, arrow.y, arrow.z] = block.point;
      arrow.vx = arrow.vy = arrow.vz = 0;
      arrow.stuck = true;
      arrow.age = 0;
      addFx(state, 'hit', arrow.x, arrow.y, arrow.z);
      continue;
    }
    arrow.x += arrow.vx * dt;
    arrow.y += arrow.vy * dt;
    arrow.z += arrow.vz * dt;
    const drag = Math.pow(0.99, dt * 20);
    arrow.vx *= drag;
    arrow.vz *= drag;
    arrow.vy = arrow.vy * drag - 20 * dt;
  }
  if (state.arrows.some(arrow => arrow.age === Infinity)) state.arrows = state.arrows.filter(arrow => arrow.age !== Infinity);
}
function shooterName(state: State, arrow: Arrow) {
  if (typeof arrow.shooter === 'number') return 'Skeleton';
  return (typeof arrow.shooter === 'string' && playerById(state, arrow.shooter)?.name) || 'an arrow';
}
