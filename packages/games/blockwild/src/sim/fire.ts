/**
 * Fire blocks and burning entities on the server. Fire never spreads: it burns out after 2–6 s unless it sits on
 * netherrack or magma, and it primes TNT it touches. Players and mobs burn on a timer (1 damage a second) set by
 * daylight, lava, fire and fireballs; water puts them out, lava also hurts on contact, and magma hurts anyone standing
 * on it without sneaking.
 */
import { B, cellId, isLava, isWater } from '../shared/blocks';
import type { CellReader } from '../shared/chunk';
import { cellIndex, cellXYZ, FACES } from '../shared/coords';
import { bodyBox } from '../shared/physics';
import { MOB, MOB_TYPES, mobBox } from '../shared/protocol';
import { damageMob, damagePlayer, mobState } from './combat';
import { primeTnt } from './redstone';
import { addFx, type DamageCause, type Mob, type Player, type State } from './state';
import { isLoaded, writeCell } from './world';

/** Fire server state, created with the world and not saved (fire edits re-register through onBlockChanged on load). */
export type FireState = {
  /** Fire cell index → sim time it burns out (re-armed while it sits on netherrack or magma). */
  cells: Map<number, number>;
  /** When each entity next takes its once-a-second burning and magma damage. */
  burnAt: WeakMap<Player | Mob, number>; magmaAt: WeakMap<Player | Mob, number>;
};
export const newFireState = (): FireState => ({ cells: new Map(), burnAt: new WeakMap(), magmaAt: new WeakMap() });

/** Seconds of burning from each source (daylight is for zombies and skeletons in the sun). */
export const BURN_SECONDS = { lava: 15, fire: 8, fireball: 5, daylight: 8 } as const;
/** Fire on these never burns out. */
const ETERNAL = new Set<number>([B.netherrack, B.magma_block]);
/** Nether mobs ignore fire and lava; primed TNT is an object. */
const fireproof = (mob: Mob) => mob.t === MOB.zombified_piglin || mob.t === MOB.ghast || MOB_TYPES[mob.t]!.kind === 'object';
const burnout = (state: State) => state.clock + 2 + state.rand() * 4;

/** Called after every cell write and for each saved edit on load, like portals.onBlockChanged: track fire cells. */
export function onBlockChanged(state: State, x: number, y: number, z: number, old: number, cell: number): void {
  const index = cellIndex(x, y, z);
  if (cellId(cell) === B.fire) {
    if (cellId(old) !== B.fire) state.fire.cells.set(index, burnout(state));
  } else if (cellId(old) === B.fire) state.fire.cells.delete(index);
}

/**
 * Every tick (after tickBurning): prime TNT touching fire, and burn out due fire blocks unless they sit on netherrack or
 * magma. Like redstone, only in loaded chunks: reading a far fire would regenerate its chunk and keep it cached.
 */
export function tickFireBlocks(state: State, _dt: number): void {
  for (const [index, at] of state.fire.cells) {
    const [x, y, z] = cellXYZ(index);
    if (!isLoaded(state, x, z)) continue;
    for (const [dx, dy, dz] of FACES) primeTnt(state, x + dx, y + dy, z + dz);
    if (at > state.clock) continue;
    if (cellId(state.get(x, y, z)) !== B.fire) state.fire.cells.delete(index);
    else if (ETERNAL.has(cellId(state.get(x, y - 1, z)))) state.fire.cells.set(index, burnout(state));
    else writeCell(state, x, y, z, B.air);
  }
}

/** Set a player or mob burning for at least `seconds` (creative players and fireproof mobs never burn). */
export function igniteEntity(state: State, target: Player | Mob, seconds: number): void {
  if ('t' in target ? fireproof(target) : state.settings.mode === 'creative') return;
  target.fire = Math.max(target.fire, seconds);
}

type Contact = { water: boolean; lava: boolean; fire: boolean };
const contact: Contact = { water: false, lava: false, fire: false };
/** Water, lava and fire among the cells a box overlaps. */
function touching(get: CellReader, box: readonly number[]): Contact {
  contact.water = contact.lava = contact.fire = false;
  for (let y = Math.floor(box[1]!); y <= Math.floor(box[4]! - 1e-6); y++) for (let z = Math.floor(box[2]!); z <= Math.floor(box[5]! - 1e-6); z++) {
    for (let x = Math.floor(box[0]!); x <= Math.floor(box[3]! - 1e-6); x++) {
      const cell = get(x, y, z);
      contact.water ||= isWater(cell);
      contact.lava ||= isLava(cell);
      contact.fire ||= cellId(cell) === B.fire;
    }
  }
  return contact;
}

/** Heat for one body: lava and fire contact, the burning countdown, water and magma. */
function heat(state: State, target: Player | Mob, box: readonly number[], standing: boolean, dt: number) {
  const get = 't' in target ? state.getLoaded : state.get, touch = touching(get, box);
  const hurt = (amount: number, cause: DamageCause, message: string) => 't' in target ? damageMob(state, target, amount, null) : damagePlayer(state, target, amount, message, undefined, cause);
  if (touch.lava) {
    hurt(4, 'lava', 'tried to swim in lava');
    igniteEntity(state, target, BURN_SECONDS.lava);
  } else if (touch.water && target.fire > 0) {
    target.fire = 0;
    addFx(state, 'fizz', target.x, target.y + 1, target.z);
  }
  if (touch.fire) igniteEntity(state, target, BURN_SECONDS.fire);
  if (target.fire > 0) {
    target.fire = Math.max(0, target.fire - dt);
    if (state.clock >= (state.fire.burnAt.get(target) ?? 0)) {
      state.fire.burnAt.set(target, state.clock + 1);
      hurt(1, 'fire', touch.lava ? 'tried to swim in lava' : 'burned to death');
    }
  }
  if (standing && cellId(get(target.x, target.y - 0.1, target.z)) === B.magma_block && state.clock >= (state.fire.magmaAt.get(target) ?? 0)) {
    state.fire.magmaAt.set(target, state.clock + 1);
    hurt(1, 'magma', 'discovered the floor was lava');
  }
}

/**
 * Every tick (after tickPortals): count down `player.fire` / `mob.fire` with 1 damage per second (cause 'fire'),
 * extinguish in water, ignite bodies touching lava (4 damage per 0.5 s, cause 'lava', burning 15 s) or fire blocks
 * (burning 8 s), and hurt bodies standing on magma unless sneaking (cause 'magma').
 */
export function tickBurning(state: State, dt: number): void {
  for (const player of state.players) {
    if (!player.connected || player.dead) continue;
    if (state.settings.mode === 'creative') player.fire = 0;
    else heat(state, player, bodyBox(player), player.onGround && !player.sneaking, dt);
  }
  for (const mob of state.mobs) {
    if (mob.health > 0 && !fireproof(mob)) heat(state, mob, mobBox({ t: mob.t, x: mob.x, y: mob.y, z: mob.z, s: mobState(mob) }), mob.onGround, dt);
  }
}
