/**
 * Villagers and trading on the server. Villages spawn one villager per house bed; by day
 * they stroll the village roads, at dusk they walk home and stand indoors, they run from monsters and watch nearby
 * players. Offers come from shared/trades.ts (profession + seed); `uses` counts each offer until the dawn restock.
 * Villager mobs are saved in the save's `villagers` list (profession `p`, `home`, offer `uses`, `seed`).
 */
import { B, cellId } from '../shared/blocks';
import type { Vec3 } from '../shared/coords';
import { addItem, removeItem } from '../shared/inventory';
import { hash3 } from '../shared/noise';
import { MOB, MOB_TYPES, type Screen, type TradeOffer } from '../shared/protocol';
import { villagesNear, type Village } from '../shared/structures/index';
import { offersFor, PROFESSIONS } from '../shared/trades';
import { openScreen } from './containers';
import { cellOf, computePath, followPath, lineOfSight, newMob, SPEED } from './mobs';
import { MAX_SAVED_VILLAGERS } from './save';
import { addFx, dist2, type Mob, type Player, type State } from './state';
import { isLoaded, standNear, surfaceY } from './world';

/** Village server state (not saved): each villager's village centre, found once from its home. */
export type VillageState = { centres: Map<number, Vec3> };
export const newVillageState = (): VillageState => ({ centres: new Map() });

/** Roaming radius around the village centre, monster alarm radius, player watching radius, zombie hunting radius. */
const ROAM = 32, FLEE = 8, WATCH = 6, HUNT = 16;
const isVillager = (mob: Mob) => mob.t === MOB.villager && mob.health > 0;
/** Villagers head home a little before nightfall and come out at dawn. */
const bedtime = (time: number) => time >= 12000 && time < 23500;
const inside = (b: readonly number[], [x, y, z]: Vec3) => x >= b[0]! && x <= b[3]! && y >= b[1]! && y <= b[4]! && z >= b[2]! && z <= b[5]!;
const busy = (mob: Mob) => !!mob.path && mob.pathIndex < mob.path.length;

/**
 * Called once per chunk the first time it is populated near players (the persisted bitset shared with animal herds,
 * so reloading never repopulates): one villager beside each village bed in this chunk, profession and seed hashed
 * from the bed so a world always grows the same villagers. `villages` defaults to the structures' villagesNear.
 */
export function spawnVillagers(state: State, cx: number, cz: number, villages: readonly Village[] = villagesNear(state.settings.seed, cx, cz)): void {
  const seed = state.settings.seed;
  for (const village of villages) for (const { bed } of village.houses) {
    const [bx, by, bz] = bed, living = state.mobs.filter(isVillager);
    if (bx >> 4 !== cx || bz >> 4 !== cz || living.length >= MAX_SAVED_VILLAGERS || living.some(m => m.home?.every((v, i) => v === bed[i]))) continue;
    const [x, y, z] = standNear(state, [bx + 0.5, by, bz + 0.5], 1);
    const mob = Object.assign(newMob(state, MOB.villager, x, y, z), { p: hash3(seed, bx, by, bz) % PROFESSIONS.length, home: [bx, by, bz] as Vec3, seed: hash3(seed + 1, bx, by, bz) >>> 1 });
    state.mobs.push(mob);
    state.villages.centres.set(mob.id, village.center);
  }
}

/** The centre a villager roams around: its home village's well, else its home, else where it first stood. */
function centreOf(state: State, mob: Mob): Vec3 {
  let centre = state.villages.centres.get(mob.id);
  if (!centre) {
    const home = mob.home ?? cellOf(mob.x, mob.y, mob.z);
    centre = villagesNear(state.settings.seed, home[0] >> 4, home[2] >> 4).find(v => inside(v.bounds, home))?.center ?? home;
    state.villages.centres.set(mob.id, centre);
  }
  return centre;
}

/** The nearest monster within the alarm radius (zombified piglins only count when angry). */
function threatTo(state: State, mob: Mob): Mob | undefined {
  let best: Mob | undefined, bestD = FLEE * FLEE;
  for (const other of state.mobs) {
    if (other.health <= 0 || !MOB_TYPES[other.t]!.hostile || other.t === MOB.zombified_piglin && state.clock >= other.aggroUntil || Math.abs(other.y - mob.y) > 4) continue;
    const d = dist2(other.x, 0, other.z, mob.x, 0, mob.z);
    if (d < bestD) { best = other; bestD = d; }
  }
  return best;
}

/** A short walk to a random spot near the mob inside the village, preferring the dirt roads. */
function roam(state: State, mob: Mob, [cx, , cz]: Vec3) {
  let goal: Vec3 | null = null;
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(mob.x + (state.rand() - 0.5) * 20), z = Math.floor(mob.z + (state.rand() - 0.5) * 20);
    const y = isLoaded(state, x, z) && Math.hypot(x - cx, z - cz) <= ROAM ? surfaceY(state.getLoaded, x, z, Math.floor(mob.y) + 3) : -1;
    if (y < 0) continue;
    goal = [x, y + 1, z];
    if (cellId(state.getLoaded(x, y, z)) === B.dirt_path) break;
  }
  if (goal) computePath(state, mob, goal, 120);
}

/** A few times a second: pick what to do (flee > run from a hit > go home at night > stay in or wander the village). */
function plan(state: State, mob: Mob) {
  mob.thinkAt = state.clock + 0.4 + state.rand() * 0.2;
  const threat = threatTo(state, mob);
  if (threat) {
    mob.panicUntil = Math.max(mob.panicUntil, state.clock + 1.5);
    const dx = mob.x - threat.x, dz = mob.z - threat.z, d = Math.hypot(dx, dz) || 1;
    if (state.clock >= mob.repathAt) computePath(state, mob, cellOf(mob.x + dx / d * 10, mob.y, mob.z + dz / d * 10), 120);
    return;
  }
  if (state.clock < mob.panicUntil) {
    if (!busy(mob)) computePath(state, mob, cellOf(mob.x + (state.rand() - 0.5) * 14, mob.y, mob.z + (state.rand() - 0.5) * 14), 80);
    return;
  }
  const home = mob.home;
  if (bedtime(state.time) && home) {
    if (Math.hypot(home[0] + 0.5 - mob.x, home[2] + 0.5 - mob.z) < 2 && Math.abs(home[1] - mob.y) < 1.5) mob.path = null;
    else if (!busy(mob) && state.clock >= mob.repathAt) {
      computePath(state, mob, home);
      mob.repathAt = state.clock + 2;
    }
    return;
  }
  const centre = centreOf(state, mob);
  if (Math.hypot(centre[0] + 0.5 - mob.x, centre[2] + 0.5 - mob.z) > ROAM) {
    if (!busy(mob) && state.clock >= mob.repathAt) computePath(state, mob, centre);
  } else if (!busy(mob) && state.rand() < 0.1) roam(state, mob, centre);
}

const nearestPlayer = (state: State, mob: Mob) => state.players.find(p => p.connected && !p.dead && dist2(p.x, p.y, p.z, mob.x, mob.y, mob.z) < WATCH * WATCH);
const trader = (state: State, mob: Mob) => state.players.find(p => p.screen?.kind === 'trade' && p.screen.villager === mob.id);

/**
 * Every tick for each live, loaded villager within 80 blocks of a player: the desired horizontal velocity for the
 * shared walking physics. A villager stands still facing whoever trades with it, and looks at players who come close.
 */
export function thinkVillager(state: State, mob: Mob, _dt: number): [number, number] | null {
  const customer = trader(state, mob);
  if (!customer && state.clock >= mob.thinkAt) plan(state, mob);
  const move = customer ? null : followPath(mob, SPEED[mob.t]! * (state.clock < mob.panicUntil ? 1.5 : 1));
  const watched = customer ?? (move ? undefined : nearestPlayer(state, mob));
  if (watched) mob.yaw = Math.atan2(-(watched.x - mob.x), -(watched.z - mob.z));
  mob.a = move ? 1 : 0;
  return move ?? [0, 0];
}

/** The villager a player's open trade screen belongs to (alive), if any. */
function tradingWith(state: State, player: Player): Mob | undefined {
  const id = player.screen?.kind === 'trade' ? player.screen.villager : undefined;
  return id === undefined ? undefined : state.mobs.find(mob => mob.id === id && isVillager(mob));
}

/** A player's `interact` on a villager: open its trade screen (it stops to face them). */
export function openTrade(state: State, player: Player, villager: Mob): boolean {
  openScreen(state, player, 'trade', Math.floor(villager.x), Math.floor(villager.y), Math.floor(villager.z), villager.id);
  villager.path = null;
  addFx(state, 'mob', villager.x, villager.y + 1.6, villager.z, MOB.villager);
  return true;
}

/**
 * A `trade` command while the trade screen is open: pay from the inventory and receive the goods, once or (with
 * `max`) until the offer, the payment or the inventory space runs out. Each attempt runs on a copy, so a trade
 * whose goods would not fit changes nothing.
 */
export function runTrade(state: State, player: Player, index: number, max: boolean): boolean {
  const villager = tradingWith(state, player), offer = villager && offersFor(villager.p, villager.seed)[index];
  if (!villager || !offer) return false;
  const used = villager.uses[index] ?? 0;
  let done = 0;
  while (used + done < offer.max && (max || done === 0)) {
    const inv = player.inv.map(slot => slot && { ...slot });
    if (!removeItem(inv, offer.buy.id, offer.buy.n) || offer.buyB && !removeItem(inv, offer.buyB.id, offer.buyB.n) || addItem(inv, offer.sell.id, offer.sell.n) > 0) break;
    player.inv.splice(0, inv.length, ...inv);
    done++;
  }
  if (!done) return false;
  for (let i = villager.uses.length; i < index; i++) villager.uses[i] = 0;
  villager.uses[index] = used + done;
  addFx(state, 'trade', villager.x, villager.y + 1.6, villager.z, offer.sell.id);
  return true;
}

/** Once at each dawn (by time or by sleeping): every offer is fully stocked again. */
export function restock(state: State): void {
  for (const mob of state.mobs) if (mob.t === MOB.villager) mob.uses = [];
}

/** The PrivateView screen for a player whose open screen is 'trade': the villager's offers with their remaining uses. */
export function tradeScreen(state: State, player: Player): Screen | null {
  const villager = tradingWith(state, player);
  if (!villager) return null;
  const offers = offersFor(villager.p, villager.seed).map((offer, i): TradeOffer => {
    const view: TradeOffer = { buy: { ...offer.buy }, sell: { ...offer.sell }, left: Math.max(0, offer.max - (villager.uses[i] ?? 0)) };
    if (offer.buyB) view.buyB = { ...offer.buyB };
    return view;
  });
  const [x, y, z] = cellOf(villager.x, villager.y, villager.z);
  return { kind: 'trade', x, y, z, slots: [], offers, villager: villager.id, profession: villager.p };
}

/**
 * A zombie without a player target asks for prey: it keeps chasing its villager while within 24 blocks, else picks
 * the nearest one it can see within 16 blocks.
 */
export function preyFor(state: State, zombie: Mob): Mob | null {
  const current = zombie.prey === null ? undefined : state.mobs.find(mob => mob.id === zombie.prey && isVillager(mob));
  if (current && dist2(current.x, current.y, current.z, zombie.x, zombie.y, zombie.z) < 24 * 24) return current;
  let best: Mob | null = null, bestD = HUNT * HUNT;
  for (const mob of state.mobs) {
    if (!isVillager(mob)) continue;
    const d = dist2(mob.x, mob.y, mob.z, zombie.x, zombie.y, zombie.z);
    if (d < bestD && lineOfSight(state, zombie.x, zombie.y + 1.6, zombie.z, mob.x, mob.y + 1.5, mob.z)) { best = mob; bestD = d; }
  }
  return best;
}
