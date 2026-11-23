/**
 * More ways to earn and spend: fishing, busking, hats, owning a business, the garage (a tune-up and a respray),
 * golden feathers and stunt jumps. Gigs from job boards, the service vehicles' included, are in city-work.ts.
 */
import { isSolid, isWater } from '../shared/blocks';
import { BITE, BIZ, BIZ_CUT, BIZ_EVERY, FEATHER_COINS, FISH, HATS, SPRAY, STUNT, tunePrice } from '../shared/city/economy';
import { cityExtras, FEATHERS } from '../shared/city/extras';
import type { Place } from '../shared/city/plan';
import { paintOf, RIDE, RIDES } from '../shared/city/vehicles';
import { lookVector } from '../shared/coords';
import { addItem } from '../shared/inventory';
import { I, itemName } from '../shared/items';
import { NS } from '../shared/protocol';
import { repAdd, stamp } from './city-career';
import { crowdNear, MAX_BIZ, news, REP, rideOf, seatOf, type CityPlayer } from './city-state';
import { earn, goLive } from './city-watch';
import { addFx, toast, type Player, type State } from './state';

// Fishing --------------------------------------------------------------------------------------------------------------
/** The water a player's line would land in: the first open water three to eight blocks the way they face. Deep = the sea proper. */
function water(state: State, player: Player): { x: number; z: number; deep: boolean } | null {
  const [lx, , lz] = lookVector(player.yaw, 0);
  for (let d = 3; d <= 8; d++) {
    const x = player.x + lx * d, z = player.z + lz * d;
    for (let y = Math.floor(player.y); y >= Math.floor(player.y) - 4; y--) {
      const cell = state.get(Math.floor(x), y, Math.floor(z));
      if (isWater(cell)) return { x, z, deep: isWater(state.get(Math.floor(x), y - 3, Math.floor(z))) };
      if (isSolid(cell)) break;
    }
  }
  return null;
}
/** Use with a rod in hand: cast, or strike when the float has dipped. */
export function fish(state: State, player: Player): boolean {
  const cp = seatOf(state, player);
  if (cp.ride && Math.abs(cp.speed) > 1.5) { toast(player, 'Hold her steady to fish.'); return false; }
  player.swing++;
  if (cp.fish === 2) {
    // On the hook.
    const deep = cp.fishDeep, roll = state.rand() * FISH.reduce((sum, row) => sum + row[deep ? 3 : 2], 0);
    let at = 0, caught = FISH[0]!;
    for (const row of FISH) { at += row[deep ? 3 : 2]; if (roll < at) { caught = row; break; } }
    cp.fish = 0;
    const inv = player.inv.map(slot => slot && { ...slot });
    if (addItem(inv, caught[0], 1) > 0) { toast(player, 'Your pockets are full: it flops back in.'); return false; }
    player.inv.splice(0, inv.length, ...inv);
    addFx(state, 'reel', cp.fishX, 63.2, cp.fishZ, caught[0]);
    if (caught[0] === I.old_boot) { toast(player, 'An old boot. The pawn shop might give you something for it.'); return true; }
    cp.stats.fish++;
    toast(player, `A ${itemName(caught[0])}! The bait hut pays ${caught[1]} coins for one.`);
    stamp(state, player, 'fish');
    if (caught[0] === I.golden_guppy) news(state, `${player.name} landed a Golden Guppy`);
    return true;
  }
  if (cp.fish === 1) { cp.fish = 0; toast(player, 'Reeled in too soon: wait for the float to dip.'); return true; }
  const spot = water(state, player);
  if (!spot) { toast(player, 'Face some water to cast: the pier, a quay, the park pond.'); return false; }
  Object.assign(cp, { fish: 1, fishAt: state.clock + BITE.wait + state.rand() * BITE.spread, fishX: spot.x, fishZ: spot.z, fishDeep: spot.deep, fishFrom: [player.x, player.z] });
  addFx(state, 'cast', spot.x, 63.1, spot.z);
  return true;
}
function tickFishing(state: State, player: Player, cp: CityPlayer) {
  if (!cp.fish) return;
  // Walk off, put the rod away or get knocked about and the line comes in.
  if (player.inv[player.slot]?.id !== I.fishing_rod || Math.hypot(player.x - cp.fishFrom[0], player.z - cp.fishFrom[1]) > 2.5 || player.dead || state.clock < cp.dizzyUntil) { cp.fish = 0; return; }
  if (state.clock < cp.fishAt) return;
  if (cp.fish === 1) { cp.fish = 2; cp.fishAt = state.clock + BITE.window; addFx(state, 'bite', cp.fishX, 63.1, cp.fishZ); }
  else { cp.fish = 0; toast(player, 'It got away. Use the moment the float dips.'); }
}

// Busking --------------------------------------------------------------------------------------------------------------
/** One note on the kazoo. People near stop to listen, and as the tune warms up some of them tip. */
export function toot(state: State, player: Player): boolean {
  const city = state.city!, cp = seatOf(state, player);
  if (cp.ride || state.clock - cp.tootAt < 0.3) return false;
  // Starting somewhere new is a fresh pitch; a pitch gets played out.
  if (Math.hypot(player.x - cp.pitch[0], player.z - cp.pitch[1]) > 40) cp.pitch = [player.x, player.z, 0];
  cp.tune = Math.min(1, Math.max(0, cp.tune - (state.clock - cp.tootAt) * 0.08) + 0.14);
  cp.tootAt = state.clock;
  addFx(state, 'toot', player.x, player.y + 1.6, player.z, cp.notes++ & 7);
  player.swing++;
  const fresh = Math.max(0.15, 1 - cp.pitch[2]! / 90);
  let listeners = 0;
  crowdNear(city, player.x, player.z, 10, i => {
    if (listeners >= 5 || city.people.list[i]!.job === 'officer') return;
    const live = city.npcs.get(i);
    if (live && live.s !== NS.STAND) return;
    listeners++;
    if (!live && state.rand() < 0.35) goLive(state, i, NS.STAND, 5, player.seat);
    if (state.rand() > 0.22 * cp.tune * fresh) return;
    const coins = 1 + Math.floor(state.rand() * 3);
    earn(state, player, coins);
    cp.stats.tips += coins;
    cp.pitch[2]! += coins;
    if (cp.stats.tips % 10 < coins) repAdd(cp, REP.FOLK, 1);
    stamp(state, player, 'busk');
  });
  return true;
}

// Hats, businesses and the garage ---------------------------------------------------------------------------------------
export function wear(state: State, player: Player, hat: number): boolean {
  const cp = seatOf(state, player);
  if (!HATS[hat]) return false;
  cp.hat = hat;
  toast(player, `A ${HATS[hat]!.name.toLowerCase()} suits you.`);
  if (hat) stamp(state, player, 'hat');
  return true;
}
/** What a seat's businesses are worth in the ledger (what was paid for them). */
export const bizValue = (state: State, cp: CityPlayer) => cp.biz.reduce((sum, place) => sum + (BIZ[state.city!.plan.places[place]?.kind ?? 'bank']?.[0] ?? 0), 0);
/** Buy the business whose counter is open: it pays out every minute and takes a cut of what other players spend there. */
export function buyBusiness(state: State, player: Player, place: Place | undefined): boolean {
  const city = state.city!, cp = seatOf(state, player), deal = place && BIZ[place.kind];
  if (!place || !deal) return false;
  const owner = city.owners.get(place.i);
  if (owner !== undefined) { toast(player, owner === player.seat ? 'This one is already yours.' : `${state.players[owner]?.name ?? 'Somebody'} owns ${place.name}.`); return false; }
  if (cp.biz.length >= MAX_BIZ) { toast(player, `Three businesses is all one person can run.`); return false; }
  if (cp.coins < deal[0]) { toast(player, `${place.name} costs ${deal[0]} coins. You have ${cp.coins}.`); return false; }
  cp.coins -= deal[0];
  cp.biz.push(place.i);
  city.owners.set(place.i, player.seat);
  toast(player, `${place.name} is yours: ${deal[1]} coins a minute, and a cut of what others spend here.`);
  news(state, `${player.name} bought ${place.name}`);
  addFx(state, 'fanfare', player.x, player.y + 1, player.z);
  stamp(state, player, 'boss');
  return true;
}
/** Another player spent `price` at a place: its owner takes a cut. */
export function saleAt(state: State, place: Place, buyer: Player, price: number) {
  const owner = state.city!.owners.get(place.i), boss = owner === undefined ? undefined : state.players[owner];
  if (!boss || boss === buyer || price <= 0) return;
  const cut = Math.max(1, Math.round(price * BIZ_CUT));
  seatOf(state, boss).coins += cut;
  seatOf(state, boss).stats.earned += cut;
  if (boss.connected) toast(boss, `${buyer.name} spent ${price} at ${place.name}: ${cut} coins to you.`);
}
/** Somebody emptied the till of an owned business: the owner hears of it and goes without the next payout. */
export function robbed(state: State, place: Place, thief: Player) {
  const city = state.city!, owner = city.owners.get(place.i), boss = owner === undefined ? undefined : state.players[owner];
  if (!boss || boss === thief) return;
  city.skipPay.add(place.i);
  toast(boss, `${thief.name} emptied the till at your ${place.name}!`);
}
function payBusinesses(state: State) {
  const city = state.city!;
  city.payAt = state.clock + BIZ_EVERY;
  for (const player of state.players) {
    const cp = city.players[player.seat]!;
    let total = 0;
    for (const place of cp.biz) { if (city.skipPay.has(place)) continue; total += BIZ[city.plan.places[place]?.kind ?? 'bank']?.[1] ?? 0; }
    if (!total || !player.connected) continue;
    cp.coins += total;
    cp.stats.earned += total;
    toast(player, `Your business${cp.biz.length > 1 ? 'es' : ''} paid in ${total} coins.`);
  }
  city.skipPay.clear();
}
/** The dealer's tune-up for an owned vehicle kind: a quicker top speed, for good. */
export function tune(state: State, player: Player, k: number): boolean {
  const cp = seatOf(state, player), kind = RIDES[k], price = tunePrice(k), place = state.city!.plan.places[cp.open];
  if (!kind || place?.kind !== 'dealer' && place?.kind !== 'airfield' && place?.kind !== 'bait' || !(cp.own >> k & 1) || cp.tuned >> k & 1) return false;
  if (cp.coins < price) { toast(player, `A tune-up for the ${kind.name} costs ${price} coins. You have ${cp.coins}.`); return false; }
  cp.coins -= price;
  cp.tuned |= 1 << k;
  toast(player, `Your ${kind.name} is tuned: quicker at the top end, wherever you call it.`);
  addFx(state, 'ding', player.x, player.y + 1, player.z);
  return true;
}
const PAINT_NAMES = ['red', 'blue', 'yellow', 'green', 'cream', 'black', 'orange', 'purple'];
/** The spray pad: a new colour for the vehicle driven. A driver nobody is watching sheds heat with the old paint. */
export function respray(state: State, player: Player): boolean {
  const cp = seatOf(state, player), vehicle = rideOf(state, player);
  if (!vehicle || cp.seat !== 0) { toast(player, 'Drive a vehicle onto the pad for a respray.'); return false; }
  if (paintOf(vehicle.k, 0) === paintOf(vehicle.k, 1)) { toast(player, 'That one wears its livery: no respray.'); return false; }
  if (cp.coins < SPRAY.price) { toast(player, `A respray costs ${SPRAY.price} coins. You have ${cp.coins}.`); return false; }
  cp.coins -= SPRAY.price;
  vehicle.paint = (vehicle.paint + 1 + Math.floor(state.rand() * 6)) % 8;
  if (vehicle.owner === player.seat) cp.paint = vehicle.paint;
  const unseen = state.clock - cp.seenAt > 3;
  if (cp.heat > 0 && unseen) { cp.heat = Math.max(0, cp.heat - SPRAY.cools); if (cp.heat <= 0) cp.spell = 0; }
  toast(player, `Resprayed ${PAINT_NAMES[vehicle.paint]}.${cp.heat > 0 && !unseen ? ' They watched you do it, mind.' : unseen ? ' The Watch is looking for the old colour.' : ''}`);
  addFx(state, 'smoke', vehicle.x, vehicle.y + 1, vehicle.z, 1.5);
  stamp(state, player, 'spray');
  return true;
}

// Feathers and stunts --------------------------------------------------------------------------------------------------
const featherCount = (feathers: readonly number[]) => { let n = 0; for (const half of feathers) for (let bits = half; bits; bits &= bits - 1) n++; return n; };
function tickFeathers(state: State, player: Player, cp: CityPlayer) {
  const feathers = cityExtras(state.settings.seed).feathers;
  for (let i = 0; i < feathers.length; i++) {
    if (cp.feathers[i >= 20 ? 1 : 0]! >> (i % 20) & 1) continue;
    const [x, y, z] = feathers[i]!;
    if (Math.abs(player.x - x) > 1.8 || Math.abs(player.z - z) > 1.8 || Math.abs(player.y - y) > 2.6) continue;
    cp.feathers[i >= 20 ? 1 : 0]! |= 1 << (i % 20);
    const found = featherCount(cp.feathers);
    earn(state, player, FEATHER_COINS);
    toast(player, `A golden feather! ${found} of ${FEATHERS} found.`);
    addFx(state, 'ding', x, y + 0.5, z);
    if (found >= 5) stamp(state, player, 'feather');
    if (found >= 20) stamp(state, player, 'plume');
    if (found === FEATHERS) news(state, `${player.name} has found every golden feather in the city`);
  }
}
/** A wheeled vehicle that leaves the ground and comes down a long way on is a stunt: coins by the block. */
function tickStunt(state: State, player: Player, cp: CityPlayer) {
  const vehicle = rideOf(state, player), kind = vehicle && RIDES[vehicle.k];
  if (!vehicle || cp.seat !== 0 || !kind || kind.air || kind.sea) { cp.air = null; return; }
  if (!player.onGround && !player.inWater) { cp.air ??= { x: player.x, z: player.z }; return; }
  if (!cp.air) return;
  const far = Math.hypot(player.x - cp.air.x, player.z - cp.air.z);
  cp.air = null;
  if (far < STUNT.least || player.inWater) return;
  const blocks = Math.round(far), record = blocks > cp.stats.jump;
  cp.stats.jump = Math.max(cp.stats.jump, blocks);
  earn(state, player, blocks * STUNT.per);
  toast(player, `Stunt jump: ${blocks} blocks!${record ? ' A personal best.' : ''}`);
  addFx(state, 'fanfare', player.x, player.y + 1, player.z);
  if (blocks >= STUNT.stamp) stamp(state, player, 'stunt');
  if (blocks >= 14) news(state, `${player.name} flew ${blocks} blocks off a ramp in a ${RIDES[vehicle.k]!.name}`);
}

/** Lines, feathers, jumps and payday. */
export function tickJobs(state: State) {
  const city = state.city!;
  for (const player of state.players) {
    if (!player.connected) continue;
    const cp = city.players[player.seat]!;
    tickFishing(state, player, cp);
    tickStunt(state, player, cp);
    if ((state.ticks + player.seat) % 4 === 0 && !player.dead) tickFeathers(state, player, cp);
  }
  if (state.clock >= city.payAt) payBusinesses(state);
}
/** A rod and a kazoo are used like the gadgets: true or false when it was one of them, null otherwise. */
export function useTool(state: State, player: Player, slot: number): boolean | null {
  const id = player.inv[slot]?.id;
  return id === I.fishing_rod ? fish(state, player) : id === I.kazoo ? toot(state, player) : null;
}
/** A stopped service vehicle with nobody in it is not abandoned: it is waiting for its next crew. */
export const isService = (k: number) => k === RIDE.trundler || k === RIDE.squirt || k === RIDE.patch || k === RIDE.clunker;
