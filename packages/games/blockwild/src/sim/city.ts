/**
 * Caper City's server side, wired into the round: state for a new or loaded world, the per-tick order, the commands
 * it answers, what each screen is sent and the ledger the round ends on. Everything else in this folder hangs off here.
 */
import type { Outcome } from '../../../../party-contract/src/index';
import { B, cellId } from '../shared/blocks';
import { heatTier, ownedValue, START_COINS } from '../shared/city/economy';
import { stampCount } from '../shared/city/passport';
import { CITY_BOUNDS, inCity } from '../shared/city/plan';
import { I } from '../shared/items';
import { CITY_ID, CITY_PLAYER_ID, encodeNpc, encodeRide, NS, type CityPrivate, type CityView, type Cmd, type LedgerEntry } from '../shared/protocol';
import { addFx, toast, type Player, type State } from './state';
import { callVehicle, enterVehicle, exitVehicle, rideView, scrapVehicle, tickRides } from './city-rides';
import { cityOf, newCityPlayer, newCityState, recordOf, refreshCrowd, rideOf, seatOf, vehicleOf, whereIs, type CityRecord } from './city-state';
import { bonk, bonkPlayer, earn, goLive, npcView, tickCollisions, tickHeat, tickNpcs } from './city-watch';
import { careerOf, stamp } from './city-career';
import { eventsView, PARCEL_COINS, tickEvents } from './city-events';
import { give, mayGlide, tickFun, useGadget } from './city-fun';
import { bizValue, buyBusiness, respray, tickJobs, tune, useTool } from './city-jobs';
import { cellChoice, gullOf, holdSpot, holdView, racesView, raceSpot, raceView, tickPlay } from './city-play';
import { errandProgress, playStall, say, takePrize, talkTo, tickStory } from './city-story';
import { CITY_GUIDE } from '../shared/city/story';
import { spotNear } from '../shared/city/extras';
import { cityExtras } from '../shared/city/extras';
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
    const cp = city.players[player.seat] = newCityPlayer(record);
    // A business has one owner: the first seat to claim it keeps it (two saves could disagree).
    cp.biz = cp.biz.filter(place => city.plan.places[place] && !city.owners.has(place));
    for (const place of cp.biz) city.owners.set(place, player.seat);
    // Everyone starts with a foam bopper in hand.
    if (!record && !player.inv.some(Boolean)) player.inv[0] = { id: I.bopper, n: 1 };
  }
}
export const cityRecord = (state: State, player: Player): CityRecord => recordOf(seatOf(state, player));

/** One tick of the city, after the players have moved and their commands have run. */
export function tickCity(state: State, dt: number) {
  const city = cityOf(state);
  for (const player of state.players) city.players[player.seat]!.toastN = player.toast?.n ?? 0;
  refreshCrowd(state);
  tickRides(state, dt);
  tickNpcs(state, dt);
  tickCollisions(state);
  tickHeat(state, dt);
  tickGigs(state);
  tickEvents(state, dt);
  tickJobs(state);
  tickPlay(state, dt);
  tickStory(state);
  tickFun(state);
  for (const player of state.players) {
    // Coins picked up off the street go straight to the purse.
    const cp = city.players[player.seat]!;
    player.inv.forEach((slot, k) => {
      if (slot?.id === I.coin) { cp.coins += slot.n; cp.stats.earned += slot.n; player.inv[k] = null; }
      // A parcel off the back of a van: the depot pays a finder's fee on the spot.
      else if (slot?.id === I.lost_parcel) { earn(state, player, slot.n * PARCEL_COINS); player.inv[k] = null; }
    });
  }
  if (state.ticks % 20 === 5) for (const player of state.players) {
    const cp = city.players[player.seat]!;
    if (cp.stats.flew >= 100) stamp(state, player, 'fly');
    if (worthOf(state, player) >= 2000) stamp(state, player, 'tycoon');
  }
  if (city.endsAt && state.clock >= city.endsAt) finishCity(state);
}
/** End the round: the ledger is a cached field of the view, so the cache key moves with it. */
export function finishCity(state: State) {
  if (state.finished) return;
  state.finished = true;
  state.revision++;
}
/** Eating in the city (the ordinary rules did the eating). */
export function cityAte(state: State, player: Player) { stamp(state, player, 'snack'); }
export { careerOf };

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
const featherCount = (feathers: readonly number[]) => { let n = 0; for (const half of feathers) for (let bits = half; bits; bits &= bits - 1) n++; return n; };

/** Do what a spot is for (the player must be standing at it). */
function useSpot(state: State, player: Player, index: number): boolean {
  const spot = cityExtras(state.settings.seed).spots[index];
  if (!spot || Math.hypot(spot.x - player.x, spot.z - player.z) > spot.r + 2.5) return false;
  switch (spot.kind) {
    case 'paint': return respray(state, player);
    case 'race': return raceSpot(state, player, spot);
    case 'vault': case 'alarm': case 'lock': return holdSpot(state, player, spot);
    default: return false;
  }
}

/**
 * City rules for a command: true or false when the city handled it, null to let the ordinary rules run (inventory
 * clicks, eating, dropping, and building on an owned plot).
 */
export function cityCommand(state: State, player: Player, cmd: Cmd): boolean | null {
  const city = cityOf(state), cp = seatOf(state, player);
  if (player.dead) return null;
  if (state.clock < cp.dizzyUntil && cmd.t !== 'close' && cmd.t !== 'click') return false;
  // Locked up: nothing but the choice of how to get out (and looking through the pockets).
  if (cp.cellUntil && !(cmd.t === 'city' && (cmd.a === 'cell' || cmd.a === 'shut')) && cmd.t !== 'close' && cmd.t !== 'click') return false;
  switch (cmd.t) {
    case 'break':
      if (cellId(state.get(cmd.x, cmd.y, cmd.z)) === B.till && !canBuild(state, player, cmd.x, cmd.y, cmd.z)) return Math.hypot(cmd.x + 0.5 - player.x, cmd.z + 0.5 - player.z) < 6 && grabTill(state, player, cmd.x, cmd.y, cmd.z);
      return canBuild(state, player, cmd.x, cmd.y, cmd.z) ? null : notYours(state, player);
    case 'place': return canBuild(state, player, cmd.x, cmd.y, cmd.z) ? null : notYours(state, player);
    case 'use':
      if (cellId(state.get(cmd.x, cmd.y, cmd.z)) === B.job_board) return Math.hypot(cmd.x + 0.5 - player.x, cmd.z + 0.5 - player.z) < 7 && openBoard(state, player, cmd.x, cmd.y, cmd.z);
      return canBuild(state, player, cmd.x, cmd.y, cmd.z) ? null : false;
    case 'useItem': return useTool(state, player, cmd.slot) ?? useGadget(state, player, cmd.slot);
    case 'attack':
      if (cp.ride) return false;
      player.swing++;
      if (cmd.id >= CITY_PLAYER_ID) { const other = state.players[cmd.id - CITY_PLAYER_ID]; return !!other && bonkPlayer(state, player, other); }
      // The people with errands take a bop in good part (and nothing comes of it).
      if (cmd.id >= CITY_ID + CITY_GUIDE) { toast(player, 'They duck. "Cheeky."'); return false; }
      return cmd.id >= CITY_ID && bonk(state, player, cmd.id - CITY_ID);
    case 'interact': {
      if (cmd.id < CITY_ID) return enterVehicle(state, player, cmd.id);
      if (cmd.id >= CITY_PLAYER_ID) return false;
      if (cmd.id >= CITY_ID + CITY_GUIDE) return talkTo(state, player, cmd.id - CITY_ID - CITY_GUIDE);
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
        case 'give': return give(state, player, cmd.i ?? -1, cmd.j ?? 0);
        case 'biz': return buyBusiness(state, player, city.plan.places[cp.open]);
        case 'tune': return tune(state, player, cmd.i ?? -1);
        case 'spot': return useSpot(state, player, cmd.i ?? -1);
        case 'cell': return cellChoice(state, player, cmd.i ?? -1);
        case 'say': return say(state, player, cmd.i ?? 1);
        case 'stall': {
          // Stalls are played, and prizes taken (i = 10 + prize), standing at the fair.
          const spot = spotNear(cityExtras(state.settings.seed), player.x, player.y, player.z), i = cmd.i ?? -1;
          if (i >= 10) return spot?.kind === 'prize' && takePrize(state, player, i - 10);
          return spot?.kind === 'stall' && spot.a === i && playStall(state, player, i, cmd.j ?? 0);
        }
        case 'pay': case 'heal': case 'grab': case 'wear': return false;
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

const worthOf = (state: State, player: Player) => { const cp = seatOf(state, player); return cp.coins + ownedValue(cp.own, cp.flat, cp.plot, bizValue(state, cp)); };
export function cityPublic(state: State): CityView | undefined {
  const city = cityOf(state);
  if (state.ticks % 20 && !state.finished) return undefined;
  const view: CityView = { board: state.players.map(player => { const cp = city.players[player.seat]!; return [player.seat, cp.coins, heatTier(cp.heat), worthOf(state, player), stampCount(cp.stamps), cp.stats.fish, cp.stats.wins, Math.round(cp.stats.jump)]; }) };
  view.ev = eventsView(state);
  if (city.races.length) view.races = racesView(state);
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
  if (cp.open >= 0) { view.open = cp.open; const owner = city.owners.get(cp.open); if (owner !== undefined) view.owner = owner; }
  const race = raceView(state, cp, player.seat), hold = holdView(state, cp);
  if (race) view.race = race;
  if (hold !== undefined) view.hold = hold;
  if (cp.cellUntil) view.cell = [Math.max(0, Math.ceil(cp.cellUntil - state.clock)), cp.fine];
  const errand = errandProgress(state, cp);
  if (cp.talk >= 0) view.talk = cp.talk;
  if (errand && cp.errand) view.errand = [cp.errand.who, errand[0], errand[1]];
  if (cp.fish) view.fish = [cp.fish, Math.round(cp.fishX * 10) / 10, Math.round(cp.fishZ * 10) / 10];
  if (cp.offers) view.offers = cp.offers;
  if (state.clock < cp.dizzyUntil) view.dizzy = Math.ceil((cp.dizzyUntil - state.clock) * 20);
  if (!cp.ride && mayGlide(state, player)) view.chute = 1;
  if (state.clock < cp.waryUntil) view.wary = 1;
  return view;
}
export const cityLedger = (state: State): LedgerEntry[] => state.players.map(player => {
  const cp = seatOf(state, player), s = cp.stats;
  return { id: player.id, worth: worthOf(state, player), coins: cp.coins, earned: s.earned, gigs: s.gigs, bonks: s.bonks, busts: s.busts, escapes: s.escapes, peak: s.peak, drove: Math.round(s.drove), flew: Math.round(s.flew), kos: s.kos,
    fish: s.fish, wins: s.wins, jump: Math.round(s.jump), tips: s.tips, helped: s.helped, bounties: s.bounties, stamps: stampCount(cp.stamps), feathers: featherCount(cp.feathers), gull: Math.round(s.gull) };
});
/** The seat the TV should follow: whoever the Watch wants most, if anyone. */
export function hottestSeat(state: State): number {
  const gull = gullOf(state);
  if (gull?.a) return gull.a - 1;
  let best = -1, heat = 9;
  for (const player of state.players) { const cp = cityOf(state).players[player.seat]!; if (player.connected && !player.dead && cp.heat > heat) { best = player.seat; heat = cp.heat; } }
  return best;
}
/** The round's result: everyone ranked by net worth; the richest wins. */
export function cityOutcome(state: State): Outcome {
  const ledger = cityLedger(state), top = Math.max(0, ...ledger.map(entry => entry.worth)), first = ledger.filter(entry => entry.worth === top);
  // The room repeats the outcome in every results snapshot, twenty times a second, and a player id is 36 characters. Once a
  // round is over the City Ledger (sent once, in the cached part of the view) says who came where, so the rows are left out,
  // and a round nobody made anything of has no winners rather than a roomful of them.
  const rows = state.finished ? [] : ledger.map(entry => ({ playerId: entry.id, score: entry.worth }));
  return { complete: state.finished, winners: state.finished && top > START_COINS && first.length <= 4 ? first.map(entry => entry.id) : [], rows };
}
/** A move is inside the city's bounds (and under its ceiling). */
export const moveInCity = (x: number, y: number, z: number) => inCity(x, z) && y <= CITY_BOUNDS.top + 2;
