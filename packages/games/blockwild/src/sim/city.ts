/**
 * Caper City's server side, wired into the round: state for a new or loaded world, the per-tick order, the commands
 * it answers, what each screen is sent and the ledger the round ends on. Everything else in this folder hangs off here.
 */
import type { Outcome } from '../../../../party-contract/src/index';
import { B, cellId } from '../shared/blocks';
import { heatTier, ownedValue } from '../shared/city/economy';
import { CITY_BOUNDS, inCity } from '../shared/city/plan';
import { lookVector } from '../shared/coords';
import { takeOne } from '../shared/inventory';
import { I } from '../shared/items';
import { CITY_ID, CITY_PLAYER_ID, encodeNpc, encodeRide, NS, type CityPrivate, type CityView, type Cmd, type LedgerEntry } from '../shared/protocol';
import { addFx, toast, type Player, type State } from './state';
import { callVehicle, enterVehicle, exitVehicle, rideView, scrapVehicle, tickRides } from './city-rides';
import { cityOf, newCityPlayer, newCityState, refreshCrowd, rideOf, seatOf, vehicleOf, whereIs, type CityRecord } from './city-state';
import { bonk, bonkPlayer, goLive, npcView, tickCollisions, tickHeat, tickNpcs } from './city-watch';
import { buy, grabTill, openBoard, openCounter, quitGig, sell, takeGig, tickGigs } from './city-work';

export { wakeAtClinic } from './city-watch';
export type { CityRecord, CityState } from './city-state';

/** Vehicles are sent to a seat within this many blocks, live residents within the mob range. */
const RIDE_RANGE = 96, NPC_RANGE = 72;

/** Give a world its city: called once the players exist. `records` are the saved lives of returning players, by seat. */
export function initCity(state: State, records: readonly (CityRecord | undefined)[] = []) {
  const city = state.city = newCityState(state.settings.seed, state.settings.minutes ?? 0);
  for (const player of state.players) {
    const record = records[player.seat];
    city.players[player.seat] = newCityPlayer(record);
    // Everyone starts with a foam bopper in hand.
    if (!record && !player.inv.some(Boolean)) player.inv[0] = { id: I.bopper, n: 1 };
  }
}
export const cityRecord = (state: State, player: Player): CityRecord => { const { coins, own, flat, plot, stats } = seatOf(state, player); return { coins, own, flat, plot, stats: { ...stats } }; };

/** One tick of the city, after the players have moved and their commands have run. */
export function tickCity(state: State, dt: number) {
  const city = cityOf(state);
  refreshCrowd(state);
  tickRides(state, dt);
  tickNpcs(state, dt);
  tickCollisions(state);
  tickHeat(state, dt);
  tickGigs(state);
  for (const player of state.players) {
    // Coins picked up off the street go straight to the purse.
    const cp = city.players[player.seat]!;
    player.inv.forEach((slot, k) => { if (slot?.id === I.coin) { cp.coins += slot.n; cp.stats.earned += slot.n; player.inv[k] = null; } });
  }
  if (city.endsAt && state.clock >= city.endsAt) state.finished = true;
}

/** True when a player may change the cell: only inside the plot they own. */
export function canBuild(state: State, player: Player, x: number, y: number, z: number): boolean {
  const plot = cityOf(state).plan.plots[seatOf(state, player).plot];
  return !!plot && x >= plot.x0 && x <= plot.x1 && z >= plot.z0 && z <= plot.z1 && y >= plot.y0 && y <= plot.y1;
}
function notYours(state: State, player: Player) {
  const cp = seatOf(state, player);
  if (state.clock - cp.toldAt > 4) { cp.toldAt = state.clock; toast(player, cp.plot >= 0 ? 'That belongs to the city. You can build on your own plot.' : 'That belongs to the city. Buy a plot to build on.'); }
  return false;
}
/** A cream pie flies at whoever the thrower is looking at within nine blocks. */
function throwPie(state: State, player: Player, slot: number): boolean {
  const city = cityOf(state), [lx, , lz] = lookVector(player.yaw, 0);
  let best = -1, bestD = 9;
  const aim = (x: number, z: number) => { const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz); return d > 0.6 && d < bestD && (dx * lx + dz * lz) / d > 0.93 ? d : -1; };
  for (const [i, npc] of city.npcs) { const d = aim(npc.x, npc.z); if (d > 0) { best = i; bestD = d; } }
  for (let cz = Math.floor(player.z - 9) >> 4; cz <= Math.floor(player.z + 9) >> 4; cz++) for (let cx = Math.floor(player.x - 9) >> 4; cx <= Math.floor(player.x + 9) >> 4; cx++) {
    for (const i of city.cells.get(cx + (cz << 12)) ?? []) { const at = whereIs(state, i), d = at ? aim(at.x, at.z) : -1; if (d > 0) { best = i; bestD = d; } }
  }
  player.inv[slot] = takeOne(player.inv[slot] ?? null);
  player.swing++;
  if (best < 0 || !bonk(state, player, best, true)) addFx(state, 'splat', player.x + lx * 6, player.y + 0.4, player.z + lz * 6);
  return true;
}
function useDisguise(state: State, player: Player, slot: number): boolean {
  const cp = seatOf(state, player);
  if (cp.heat <= 0) { toast(player, 'Nobody is looking for you.'); return false; }
  if (state.clock - cp.seenAt < 3) { toast(player, 'Not while they are watching!'); return false; }
  player.inv[slot] = takeOne(player.inv[slot] ?? null);
  cp.heat = Math.max(0, cp.heat - 40);
  if (cp.heat <= 0) cp.spell = 0;
  toast(player, cp.heat > 0 ? 'A false nose and glasses: some of the heat is off.' : 'A false nose and glasses: nobody knows you.');
  addFx(state, 'levelup', player.x, player.y + 1, player.z);
  return true;
}

/**
 * City rules for a command: true or false when the city handled it, null to let the ordinary rules run (inventory
 * clicks, eating, dropping, and building on an owned plot).
 */
export function cityCommand(state: State, player: Player, cmd: Cmd): boolean | null {
  const city = cityOf(state), cp = seatOf(state, player);
  if (player.dead) return null;
  if (state.clock < cp.dizzyUntil && cmd.t !== 'close' && cmd.t !== 'click') return false;
  switch (cmd.t) {
    case 'break':
      if (cellId(state.get(cmd.x, cmd.y, cmd.z)) === B.till && !canBuild(state, player, cmd.x, cmd.y, cmd.z)) return Math.hypot(cmd.x + 0.5 - player.x, cmd.z + 0.5 - player.z) < 6 && grabTill(state, player, cmd.x, cmd.y, cmd.z);
      return canBuild(state, player, cmd.x, cmd.y, cmd.z) ? null : notYours(state, player);
    case 'place': return canBuild(state, player, cmd.x, cmd.y, cmd.z) ? null : notYours(state, player);
    case 'use':
      if (cellId(state.get(cmd.x, cmd.y, cmd.z)) === B.job_board) return Math.hypot(cmd.x + 0.5 - player.x, cmd.z + 0.5 - player.z) < 7 && openBoard(state, player, cmd.x, cmd.y, cmd.z);
      return canBuild(state, player, cmd.x, cmd.y, cmd.z) ? null : false;
    case 'useItem': {
      const id = player.inv[cmd.slot]?.id;
      return id === I.cream_pie ? throwPie(state, player, cmd.slot) : id === I.disguise_kit ? useDisguise(state, player, cmd.slot) : null;
    }
    case 'attack':
      if (cp.ride) return false;
      player.swing++;
      if (cmd.id >= CITY_PLAYER_ID) { const other = state.players[cmd.id - CITY_PLAYER_ID]; return !!other && bonkPlayer(state, player, other); }
      return cmd.id >= CITY_ID && bonk(state, player, cmd.id - CITY_ID);
    case 'interact': {
      if (cmd.id < CITY_ID) return enterVehicle(state, player, cmd.id);
      if (cmd.id >= CITY_PLAYER_ID) return false;
      // A keeper at their counter opens it; anyone else stops for a word.
      const i = cmd.id - CITY_ID, at = whereIs(state, i), resident = city.people.list[i];
      if (!at || Math.hypot(at.x - player.x, at.z - player.z) > 7) return false;
      const place = resident && resident.place >= 0 ? city.plan.places[resident.place] : undefined;
      if (place && !at.live && Math.hypot(at.x - place.counter[0], at.z - place.counter[1]) < 1) return openCounter(state, player, place);
      if (!at.live) goLive(state, i, NS.STAND, 3.5, player.seat);
      return true;
    }
    case 'craft': case 'creative': case 'trade': return false;
    case 'click': return cmd.w === 'grid' || cmd.w === 'out' ? false : null;
    case 'city':
      switch (cmd.a) {
        case 'exit': return !!cp.ride && exitVehicle(state, player);
        case 'horn': { const ride = rideOf(state, player); if (ride) addFx(state, 'horn', ride.x, ride.y + 1, ride.z, ride.k); return !!ride; }
        case 'open': { const place = city.plan.places[cmd.i ?? -1]; return !!place && openCounter(state, player, place); }
        case 'shut': cp.open = -1; cp.offers = null; return true;
        case 'buy': return buy(state, player, cmd.i ?? -1);
        case 'sell': return sell(state, player, cmd.i ?? -1);
        case 'gig': return takeGig(state, player, cmd.i ?? -1);
        case 'quit': return quitGig(state, player);
        case 'call': return callVehicle(state, player, cmd.i ?? -1);
        case 'scrap': return scrapVehicle(state, player);
        case 'pay': case 'heal': case 'grab': return false;
      }
  }
  return null;
}

// What screens are sent -------------------------------------------------------------------------------------------------
function frameOf(state: State) {
  const city = cityOf(state);
  if (city.frame?.tick === state.ticks) return city.frame;
  const views = city.vehicles.map(rideView);
  return city.frame = { tick: state.ticks, npcs: [...city.npcs.values()].map(npc => encodeNpc(npcView(npc))), rides: views.map(encodeRide), asleep: views.map(view => (view.f & 1) !== 0) };
}
/**
 * The live residents and vehicles round (x, z) for a scene. Parked, empty vehicles change nothing from one snapshot to
 * the next, so they are included only when `parked` (once a second per screen, and at once for a screen that asks).
 */
export function cityScene(state: State, x: number, z: number, parked: boolean): { c?: number[][]; v?: number[][] } {
  const frame = frameOf(state), out: { c?: number[][]; v?: number[][] } = {};
  const near = (tuple: number[], at: number, range: number) => (tuple[at]! - x) ** 2 + (tuple[at + 2]! - z) ** 2 <= range * range;
  const c = frame.npcs.filter(tuple => near(tuple, 1, NPC_RANGE)), v = frame.rides.filter((tuple, k) => (parked || !frame.asleep[k]) && near(tuple, 2, RIDE_RANGE));
  if (c.length) out.c = c;
  if (v.length || parked) out.v = v;
  return out;
}
/** How often a screen is sent the parked vehicles round it (ticks). */
export const PARKED_EVERY = 20;

const worthOf = (state: State, player: Player) => { const cp = seatOf(state, player); return cp.coins + ownedValue(cp.own, cp.flat, cp.plot); };
export function cityPublic(state: State): CityView | undefined {
  const city = cityOf(state);
  if (state.ticks % 20 && !state.finished) return undefined;
  const view: CityView = { board: state.players.map(player => { const cp = city.players[player.seat]!; return [player.seat, cp.coins, heatTier(cp.heat), worthOf(state, player)]; }) };
  if (city.endsAt) view.left = Math.max(0, Math.ceil(city.endsAt - state.clock));
  if (city.news) view.news = [city.news[0], city.news[1]];
  return view;
}
export function cityPrivate(state: State, player: Player): CityPrivate {
  const city = cityOf(state), cp = seatOf(state, player), view: CityPrivate = { coins: cp.coins, heat: Math.round(cp.heat), own: cp.own, flat: cp.flat, plot: cp.plot };
  if (cp.heat > 0 && state.clock - cp.seenAt < 1.5) view.seen = 1;
  if (cp.grab > 0) view.grab = Math.round(Math.min(1, cp.grab / 1.2) * 100) / 100;
  const ride = vehicleOf(city, cp.ride);
  if (ride) view.ride = [ride.id, ride.k, cp.seat];
  if (cp.gig) view.gig = { k: cp.gig.k, stage: cp.gig.stage, x: Math.round(cp.gig.x * 10) / 10, z: Math.round(cp.gig.z * 10) / 10, left: Math.max(0, Math.ceil(cp.gig.until - state.clock)), pay: cp.gig.pay, drops: cp.gig.drops };
  if (cp.open >= 0) view.open = cp.open;
  if (cp.offers) view.offers = cp.offers;
  if (state.clock < cp.dizzyUntil) view.dizzy = Math.ceil((cp.dizzyUntil - state.clock) * 20);
  return view;
}
export const cityLedger = (state: State): LedgerEntry[] => state.players.map(player => {
  const cp = seatOf(state, player), s = cp.stats;
  return { id: player.id, worth: worthOf(state, player), coins: cp.coins, earned: s.earned, gigs: s.gigs, bonks: s.bonks, busts: s.busts, escapes: s.escapes, peak: s.peak, drove: Math.round(s.drove), flew: Math.round(s.flew), kos: s.kos };
});
/** The seat the TV should follow: whoever the Watch wants most, if anyone. */
export function hottestSeat(state: State): number {
  let best = -1, heat = 9;
  for (const player of state.players) { const cp = cityOf(state).players[player.seat]!; if (player.connected && !player.dead && cp.heat > heat) { best = player.seat; heat = cp.heat; } }
  return best;
}
/** The round's result: everyone ranked by net worth; the richest wins. */
export function cityOutcome(state: State): Outcome {
  const ledger = cityLedger(state), top = Math.max(0, ...ledger.map(entry => entry.worth));
  // (No labels: the platform repeats the outcome in every results snapshot, and the City Ledger shows the rest.)
  const rows = ledger.map(entry => ({ playerId: entry.id, score: entry.worth }));
  return { complete: state.finished, winners: state.finished ? ledger.filter(entry => entry.worth === top).map(entry => entry.id) : [], rows };
}
/** A move is inside the city's bounds (and under its ceiling). */
export const moveInCity = (x: number, y: number, z: number) => inCity(x, z) && y <= CITY_BOUNDS.top + 2;
