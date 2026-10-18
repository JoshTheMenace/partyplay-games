/**
 * Silverfish: stronghold pests hidden in infested stone bricks (silverfish_stone) and bred by the portal room's spawner.
 * They scurry at players in sight and nip for 1 damage; a hurt silverfish calls for help, cracking the infested bricks
 * around it into more silverfish, but never past 8 silverfish nearby.
 */
import { B, cellId } from '../shared/blocks';
import type { Vec3 } from '../shared/coords';
import { MOB } from '../shared/protocol';
import { damagePlayer, hostileDamage } from './combat';
import { cellOf, computePath, followPath, huntable, lineOfSight, newMob, SPEED, toward, wander } from './mobs';
import { dist2, playerById, type Mob, type State } from './state';
import { breakBlock } from './world';

/** Sight to pick a target, chase range to keep one, bite reach, the help search box (half sizes) and the crowd cap within HELP_COUNT blocks. */
const SIGHT = 12, CHASE = 24, BITE_REACH = 0.9, HELP_XZ = 6, HELP_Y = 3, HELP_COUNT = 8, HELP_CAP = 8;
/** Hurt counts already answered with a call for help. */
const answered = new WeakMap<Mob, number>();

const nearbyFish = (state: State, x: number, y: number, z: number) =>
  state.mobs.filter(m => m.t === MOB.silverfish && m.health > 0 && dist2(m.x, m.y, m.z, x, y, z) <= HELP_COUNT * HELP_COUNT).length;

/** Crack the nearest infested bricks around a hurt silverfish into more silverfish, up to HELP_CAP nearby. */
function callForHelp(state: State, mob: Mob) {
  const bx = Math.floor(mob.x), by = Math.floor(mob.y), bz = Math.floor(mob.z), stones: Vec3[] = [];
  for (let dy = -HELP_Y; dy <= HELP_Y; dy++) for (let dz = -HELP_XZ; dz <= HELP_XZ; dz++) for (let dx = -HELP_XZ; dx <= HELP_XZ; dx++) {
    if (cellId(state.getLoaded(bx + dx, by + dy, bz + dz)) === B.silverfish_stone) stones.push([bx + dx, by + dy, bz + dz]);
  }
  stones.sort((a, b) => dist2(a[0], a[1], a[2], bx, by, bz) - dist2(b[0], b[1], b[2], bx, by, bz));
  let count = nearbyFish(state, mob.x, mob.y, mob.z);
  for (const [x, y, z] of stones) {
    if (count >= HELP_CAP) break;
    if (breakBlock(state, x, y, z, [])) count++;
  }
}

/** The nearest huntable player within sight of the silverfish. */
function spot(state: State, mob: Mob) {
  let best = SIGHT * SIGHT, found: State['players'][number] | undefined;
  for (const player of state.players) {
    const d2 = dist2(player.x, player.y, player.z, mob.x, mob.y, mob.z);
    if (d2 < best && huntable(state, player) && lineOfSight(state, mob.x, mob.y + 0.2, mob.z, player.x, player.y + 1.5, player.z)) { best = d2; found = player; }
  }
  return found;
}

/** Every-tick AI (mobs.ts CUSTOM_AI): desired horizontal velocity. */
export function thinkSilverfish(state: State, mob: Mob, _dt: number): [number, number] | null {
  if ((answered.get(mob) ?? 0) < mob.hurt) {
    answered.set(mob, mob.hurt);
    callForHelp(state, mob);
  }
  const speed = SPEED[mob.t]!;
  let target = mob.target ? playerById(state, mob.target) : undefined;
  if (target && (!huntable(state, target) || dist2(target.x, target.y, target.z, mob.x, mob.y, mob.z) > CHASE * CHASE)) target = undefined;
  if (state.clock >= mob.thinkAt) {
    mob.thinkAt = state.clock + 0.4 + state.rand() * 0.2;
    target ??= spot(state, mob);
    if (!target) wander(state, mob);
    else if (state.clock >= mob.repathAt) computePath(state, mob, cellOf(target.x, target.y, target.z));
  }
  mob.target = target?.id ?? null;
  if (!target) {
    const v = followPath(mob, speed * 0.5) ?? [0, 0];
    mob.a = v[0] || v[1] ? 1 : 0;
    return v;
  }
  const dx = target.x - mob.x, dz = target.z - mob.z, dist = Math.hypot(dx, dz), dy = target.y - mob.y;
  mob.yaw = Math.atan2(-dx, -dz);
  if (dist < BITE_REACH && dy > -1 && dy < 1.2 && state.clock >= mob.cooldown) {
    damagePlayer(state, target, hostileDamage(state, 1), 'was slain by a Silverfish', { x: mob.x, z: mob.z, strength: 2, up: 2 }, 'mob');
    mob.cooldown = state.clock + 1;
    mob.attackUntil = state.clock + 0.3;
  }
  mob.a = state.clock < mob.attackUntil ? 2 : 1;
  if (dist < 0.5) return [0, 0];
  return dist < 2.5 && Math.abs(dy) < 1 ? toward(mob, target.x, target.z, speed) : followPath(mob, speed) ?? (dist < 6 ? toward(mob, target.x, target.z, speed) : [0, 0]);
}

/** A silverfish_stone at (x, y, z) was just broken (by a player, a call for help or an explosion): out comes a silverfish, hunting the nearest player. */
export function onSilverfishStoneBroken(state: State, x: number, y: number, z: number): void {
  if (state.settings.difficulty === 'peaceful') return;
  const fish = newMob(state, MOB.silverfish, x + 0.5, y, z + 0.5);
  const near = state.players.filter(p => huntable(state, p) && dist2(p.x, p.y, p.z, x, y, z) <= CHASE * CHASE)
    .sort((a, b) => dist2(a.x, a.y, a.z, x, y, z) - dist2(b.x, b.y, b.z, x, y, z))[0];
  if (near) Object.assign(fish, { target: near.id, aggroUntil: state.clock + 20 });
  state.mobs.push(fish);
}
