/**
 * What is going on in Caper City: the events every screen is told about once a second (a marker on the map, a beacon
 * in the street, a line on the TV). Fires are here; so is the timetable that starts things by itself, so there is
 * always something to converge on. Nothing here is saved: a loaded city starts quiet.
 */
import { GIGS } from '../shared/city/economy';
import { CITY, districtAt, lotAt, type CityPlan } from '../shared/city/plan';
import { RIDE } from '../shared/city/vehicles';
import { addItem } from '../shared/inventory';
import { I, itemName } from '../shared/items';
import { EV } from '../shared/protocol';
import { repAdd, stamp } from './city-career';
import { SOAK_REACH } from './city-fun';
import { gullGone, gullOf, startGull } from './city-play';
import { doorsOf, news, REP, type CityEvent } from './city-state';
import { earn } from './city-watch';
import { spawnItem } from './entities';
import { addFx, toast, type Player, type State } from './state';

/** A fire burns this long if nobody comes; an engine's hose reaches this far and takes this much off a second; a balloon this much at once. */
const FIRE_SECONDS = 240, HOSE_REACH = 14, HOSE_RATE = 13, BALLOON = 26, FIRE_POT = 60;

export function addEvent(state: State, k: number, x: number, z: number, seconds: number, a = 0, b = 0): CityEvent {
  const city = state.city!, event: CityEvent = { id: ++city.eventId, k, x, z, until: state.clock + seconds, a, b, helpers: new Map(), quietAt: state.clock };
  city.events.push(event);
  return event;
}
export const eventsOf = (state: State, k: number) => state.city!.events.filter(event => event.k === k);
/** A fire breaks out at (x, z). */
export function startFire(state: State, x: number, z: number, where: string): CityEvent {
  news(state, `Fire at ${where}! Water balloons and fire engines wanted`);
  addFx(state, 'alarm', x, 66, z);
  return addEvent(state, EV.FIRE, x, z, FIRE_SECONDS, 100);
}

function tickFires(state: State, dt: number) {
  const city = state.city!;
  for (const fire of city.events) {
    if (fire.k !== EV.FIRE) continue;
    const help = (seat: number, amount: number) => { fire.helpers.set(seat, (fire.helpers.get(seat) ?? 0) + amount); fire.a -= amount; fire.quietAt = state.clock; };
    for (const splash of city.splashes) if (Math.hypot(splash.x - fire.x, splash.z - fire.z) <= SOAK_REACH + 1.5) help(splash.by, BALLOON);
    // An engine standing near with somebody aboard plays its hose on the fire by itself.
    for (const engine of city.vehicles) {
      if (engine.k !== RIDE.squirt || Math.abs(engine.v) > 1.5 || Math.hypot(engine.x - fire.x, engine.z - fire.z) > HOSE_REACH) continue;
      const crew = [engine.driver, ...engine.riders].filter(seat => seat >= 0);
      if (!crew.length) continue;
      for (const seat of crew) help(seat, HOSE_RATE * dt / crew.length);
      if (state.ticks % 8 === 0) addFx(state, 'hose', fire.x + (state.rand() - 0.5) * 2, 65.5, fire.z + (state.rand() - 0.5) * 2);
    }
    // Left alone it builds back up.
    if (state.clock - fire.quietAt > 2) fire.a = Math.min(100, fire.a + 2 * dt);
    if (fire.a > 0) continue;
    // Out: the pot is shared by what each did, and everyone who helped is a hero.
    const total = [...fire.helpers.values()].reduce((sum, amount) => sum + amount, 0) || 1, names: string[] = [];
    for (const [seat, amount] of fire.helpers) {
      const player = state.players[seat], cp = city.players[seat];
      if (!player || !cp) continue;
      names.push(player.name);
      earn(state, player, Math.max(5, Math.round(FIRE_POT * amount / total)));
      cp.stats.helped++;
      repAdd(cp, REP.FOLK, 4);
      repAdd(cp, REP.WATCH, 2);
      stamp(state, player, 'hero');
      // A fire call from the board pays out here.
      if (cp.gig?.k === 5 && Math.hypot(cp.gig.x - fire.x, cp.gig.z - fire.z) < 6) {
        earn(state, player, cp.gig.pay);
        cp.stats.gigs++;
        toast(player, `${GIGS[5].name} done: ${cp.gig.pay} coins.`);
        stamp(state, player, 'gig');
        cp.gig = null;
      }
    }
    news(state, names.length ? `${names.slice(0, 3).join(', ')} put the fire out` : 'The fire burned itself out');
    addFx(state, 'fanfare', fire.x, 66, fire.z);
    fire.until = 0;
  }
}

// The timetable ---------------------------------------------------------------------------------------------------------
/** What a lost parcel is worth, how long a spill, a sale, a blackout and a crate last, and how far a blackout reaches. */
export const PARCEL_COINS = 12;
const SPILL = { parcels: 10, seconds: 75 }, SALE_SECONDS = 90, DARK = { seconds: 80, reach: 110 }, CRATE_SECONDS = 150;
const CRATE_LOOT: readonly (readonly [number, number])[] = [[I.cream_pie, 4], [I.water_balloon, 4], [I.smoke_puff, 2], [I.parasol, 1], [I.kazoo, 1], [I.disguise_kit, 1], [I.banana_peel, 4]];
/** A street address for the news: the name of what stands there, or the district. */
export const whereabouts = (plan: CityPlan, x: number, z: number) => lotAt(plan, x, z)?.name
  || districtAt(Math.max(0, Math.min(CITY.n - 1, Math.floor((x - CITY.x0 - CITY.road) / CITY.pitch))), Math.max(0, Math.min(CITY.n - 1, Math.floor((z - CITY.z0 - CITY.road) / CITY.pitch))));
/** A door 70 to 300 blocks from one of the players who are about: near enough to reach, far enough to be a trip. */
function somewhere(state: State): [number, number] | null {
  const active = state.players.filter(player => player.connected && !player.dead);
  if (!active.length) return null;
  const from = active[Math.floor(state.rand() * active.length)]!, doors = doorsOf(state.city!.plan).filter(([x, z]) => { const d = Math.hypot(x - from.x, z - from.z); return d > 70 && d < 300; });
  return doors[Math.floor(state.rand() * doors.length)] ?? null;
}
const tellAll = (state: State, text: string) => { for (const player of state.players) if (player.connected) toast(player, text); };
/** A delivery van has shed its load: parcels lie along the pavement for whoever gets there first. */
export function startSpill(state: State, x: number, z: number): CityEvent {
  const name = whereabouts(state.city!.plan, x, z);
  for (let k = 0; k < SPILL.parcels; k++) spawnItem(state, x + (state.rand() - 0.5) * 16, 65, z + (state.rand() - 0.5) * 3, { id: I.lost_parcel, n: 1 }, { scatter: true, delay: 1 });
  news(state, `A Zip Post van has shed its load by ${name}: finders keepers`);
  return addEvent(state, EV.SPILL, x, z, SPILL.seconds, SPILL.parcels);
}
/** A crate has come down under a parachute: the first one to it has what is inside. */
export function startCrate(state: State, x: number, z: number): CityEvent {
  news(state, `A crate has come down by ${whereabouts(state.city!.plan, x, z)}: first there opens it`);
  return addEvent(state, EV.CRATE, x, z, CRATE_SECONDS);
}
function openCrate(state: State, crate: CityEvent, player: Player) {
  const [id, n] = CRATE_LOOT[Math.floor(state.rand() * CRATE_LOOT.length)]!, coins = 60 + Math.floor(state.rand() * 81);
  earn(state, player, coins);
  const inv = player.inv.map(slot => slot && { ...slot }), fits = addItem(inv, id, n) === 0;
  if (fits) player.inv.splice(0, inv.length, ...inv);
  toast(player, `The crate! ${coins} coins${fits ? ` and ${n > 1 ? `${n} × ` : 'a '}${itemName(id)}` : ''}.`);
  news(state, `${player.name} got to the crate first`);
  addFx(state, 'fanfare', crate.x, 66, crate.z);
  crate.until = 0;
}
/** A shop's happy hour: everything on its counter at half price. `b` is the place. */
export function startSale(state: State): CityEvent | null {
  const city = state.city!, shops = city.plan.places.filter(place => place.kind === 'food' || place.kind === 'gizmo' || place.kind === 'hats' || place.kind === 'hardware'), shop = shops[Math.floor(state.rand() * shops.length)];
  if (!shop) return null;
  news(state, `Half price at ${shop.name} for ${SALE_SECONDS} seconds`);
  return addEvent(state, EV.SALE, shop.walk[0], shop.walk[1], SALE_SECONDS, 0, shop.i);
}
export const onSale = (state: State, place: number) => state.city!.events.some(event => event.k === EV.SALE && event.b === place);
/** The lamps go out over a few blocks: witnesses and officers there see half as far. */
export function startBlackout(state: State, x: number, z: number): CityEvent {
  news(state, `The lamps are out round ${whereabouts(state.city!.plan, x, z)}: the Watch can hardly see there`);
  return addEvent(state, EV.BLACKOUT, x, z, DARK.seconds, DARK.reach);
}
/** How far eyes carry at (x, z): half as far in a blackout. */
export const sightAt = (state: State, x: number, z: number) => state.city!.events.some(event => event.k === EV.BLACKOUT && (event.x - x) ** 2 + (event.z - z) ** 2 < DARK.reach ** 2) ? 0.5 : 1;
/** Start the next thing: something different each time, and the gull only when there is somebody to take it off. */
function tickTimetable(state: State) {
  const city = state.city!, active = state.players.filter(player => player.connected).length;
  if (state.clock < city.nextEventAt || !active) return;
  city.nextEventAt = state.clock + 75 + state.rand() * 45;
  const going = new Set(city.events.map(event => event.k)), at = somewhere(state);
  if (!at) return;
  const kinds = [EV.SPILL, EV.CRATE, EV.SALE, EV.FIRE, EV.BLACKOUT, ...active > 1 ? [EV.GULL, EV.GULL] : []].filter(k => !going.has(k) && k !== city.lastEvent);
  const k = kinds[Math.floor(state.rand() * kinds.length)];
  if (k === undefined) return;
  city.lastEvent = k;
  if (k === EV.SPILL) startSpill(state, at[0], at[1]);
  else if (k === EV.CRATE) startCrate(state, at[0], at[1]);
  else if (k === EV.SALE) startSale(state);
  else if (k === EV.FIRE) startFire(state, at[0], at[1], whereabouts(city.plan, at[0], at[1]));
  else if (k === EV.BLACKOUT) startBlackout(state, at[0], at[1]);
  else if (!gullOf(state)) startGull(state, at[0], at[1], whereabouts(city.plan, at[0], at[1]));
  tellAll(state, `In the city: ${city.news?.[1] ?? 'something is up'}`);
}

/** Everything that is going on, once a tick. */
export function tickEvents(state: State, dt: number) {
  const city = state.city!;
  tickFires(state, dt);
  tickTimetable(state);
  if (state.ticks % 5 === 0) for (const crate of city.events) {
    if (crate.k !== EV.CRATE || state.clock >= crate.until) continue;
    const finder = state.players.find(player => player.connected && !player.dead && Math.hypot(player.x - crate.x, player.z - crate.z) < 2.6);
    if (finder) openCrate(state, crate, finder);
  }
  if (state.ticks % 10 === 0) city.events = city.events.filter(event => {
    if (state.clock < event.until) return true;
    if (event.k === EV.FIRE && event.a > 0) news(state, 'A fire burned itself out before anybody came');
    if (event.k === EV.GULL) gullGone(state, event);
    // What nobody picked up of a spill is swept away.
    if (event.k === EV.SPILL) state.items = state.items.filter(item => item.item !== I.lost_parcel);
    return false;
  });
}
/** The list as screens are sent it: [kind, x, z, seconds left, a, b]. */
export const eventsView = (state: State): number[][] => state.city!.events.map(event => [event.k, Math.round(event.x), Math.round(event.z), Math.max(0, Math.ceil(event.until - state.clock)), Math.round(event.a), event.b]);
