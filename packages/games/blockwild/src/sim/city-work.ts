/**
 * Earning and spending: gigs from job boards (parcel rounds, hot food, cab fares), the counters of shops and services,
 * property, and the tills that can be grabbed. Catalogues and prices live in shared/city/economy.ts so the shop screens
 * show exactly what the server charges.
 */
import { B, cellId } from '../shared/blocks';
import { BIZ, CATALOG, GIGS, gigOf, heatTier, MISCHIEF, sellPrice, TILL, type Offer } from '../shared/city/economy';
import type { CityPlan, Place } from '../shared/city/plan';
import { placeOpen } from '../shared/city/people';
import { RIDES } from '../shared/city/vehicles';
import { hash3 } from '../shared/noise';
import { addItem, countItem } from '../shared/inventory';
import { I, itemName } from '../shared/items';
import { MAX_HEALTH } from '../shared/constants';
import { NS, type GigOffer } from '../shared/protocol';
import { spawnItem } from './entities';
import { addFx, toast, type Player, type State } from './state';
import { priceFor, repAdd, stamp } from './city-career';
import { onSale, startFire, whereabouts } from './city-events';
import { robbed, saleAt, wear } from './city-jobs';
import { callVehicle, DUTY } from './city-rides';
import { doorsOf, news, REP, rideOf, seatOf } from './city-state';
import { addExtra, earn, mischief } from './city-watch';

const COUNTER_REACH = 7, DROP_REACH = 3.6, DRIVE_REACH = 7;
const far = (ax: number, az: number, bx: number, bz: number) => Math.abs(ax - bx) + Math.abs(az - bz);
export const businessPrice = (place: Place) => BIZ[place.kind]?.[0] ?? 0;

/** A place's keeper is at the counter and not seeing stars. */
function staffed(state: State, place: Place): boolean {
  const city = state.city!;
  return placeOpen(city.people, place.i, state.day, state.time) && !city.people.keepers[place.i]!.some(i => city.npcs.has(i));
}
const atCounter = (player: Player, place: Place) => Math.hypot(player.x - place.front[0], player.z - place.front[1]) <= COUNTER_REACH || Math.hypot(player.x - place.counter[0], player.z - place.counter[1]) <= COUNTER_REACH;

/** Open a place's counter (a keeper was spoken to). */
export function openCounter(state: State, player: Player, place: Place): boolean {
  const cp = seatOf(state, player);
  if (!atCounter(player, place)) return false;
  if (!staffed(state, place)) { toast(player, `${place.name} is closed. Counters open from 06:30 to 02:00.`); return false; }
  cp.open = place.i;
  cp.offers = null;
  return true;
}
/** Where a cab's fare waits: outside a place 40 to 160 blocks from the stand (the nearest few, for a stand out on its own). */
function fareSpot(plan: CityPlan, stand: Place, salt: number): [number, number] {
  const [sx, sz] = stand.walk, others = plan.places.filter(place => place !== stand).map(place => ({ place, d: far(sx, sz, place.walk[0], place.walk[1]) })).filter(entry => entry.d >= 40).sort((a, b) => a.d - b.d);
  const near = others.filter(entry => entry.d <= 160), pool = near.length >= 3 ? near : others.slice(0, 6);
  return pool[hash3(plan.seed, stand.i, salt, 0xcab) % pool.length]!.place.walk;
}
/** The three gigs a board offers right now (they change every minute): short, medium and long, so there is always something walkable and something worth a vehicle. */
function offersAt(state: State, place: Place): GigOffer[] {
  const city = state.city!, { plan } = city, k = gigOf(place.kind), gig = GIGS[k]!, minute = Math.floor(state.clock / 60), offers: GigOffer[] = [];
  const [bx, bz] = place.walk, doors = doorsOf(plan), reach = k === 2 ? 1.4 : 1;
  for (let n = 0; n < 3; n++) {
    // Whatever lies in the band; from a corner of the city with nothing in it, the nearest doors beyond its near edge.
    const lo = [50, 130, 240][n]!, hi = [150, 280, 520][n]! * reach;
    let band = doors.filter(([x, z]) => { const d = far(bx, bz, x, z); return d >= lo && d <= hi; });
    if (!band.length) band = doors.filter(([x, z]) => far(bx, bz, x, z) >= lo).sort((a, b) => far(bx, bz, a[0], a[1]) - far(bx, bz, b[0], b[1])).slice(0, 8);
    if (!band.length) continue;
    const [x, z] = band[hash3(plan.seed, place.i, minute * 4 + n, 0x919) % band.length]!, d = far(bx, bz, x, z);
    // An ambulance goes out and comes back; a fire waits a while for whoever answers the call.
    const offer: GigOffer = { k, pay: Math.round(gig.base + d * gig.per * gig.drops), x: Math.round(x), z: Math.round(z), secs: Math.round(k === 4 ? d * 2 / gig.speed + 45 : k === 5 ? d / gig.speed + 100 : d * gig.drops / gig.speed + 25) };
    // A cab's fare waits at a kerb a little way from the stand, and the clock allows for the drive out to them as well as the ride.
    if (k === 2) { const pick = fareSpot(plan, place, minute * 4 + n); Object.assign(offer, { pick, secs: Math.round((far(bx, bz, pick[0], pick[1]) + far(pick[0], pick[1], x, z)) / gig.speed + 30) }); }
    offers.push(offer);
  }
  return offers;
}
/** `use` on a job board block. */
export function openBoard(state: State, player: Player, x: number, y: number, z: number): boolean {
  const city = state.city!, cp = seatOf(state, player), place = city.plan.places.find(p => p.board && p.board[0] === x && p.board[1] === y && p.board[2] === z);
  if (!place) return false;
  if (cp.gig) { toast(player, 'Finish the gig you are on first (or drop it from the map).'); return false; }
  cp.open = place.i;
  cp.offers = offersAt(state, place);
  return true;
}
export function takeGig(state: State, player: Player, index: number): boolean {
  const city = state.city!, cp = seatOf(state, player), place = city.plan.places[cp.open], offer = cp.offers?.[index];
  if (!place?.board || !offer || cp.gig || far(player.x, player.z, place.board[0] + 0.5, place.board[2] + 0.5) > 12) return false;
  const gig = GIGS[offer.k]!;
  cp.gig = { k: offer.k, stage: 1, x: offer.x + 0.5, z: offer.z + 0.5, until: state.clock + offer.secs, pay: offer.pay, drops: gig.drops, place: place.i, rider: -1, from: [place.walk[0], place.walk[1]] };
  if (offer.k === 2) {
    // A fare waits at the kerb a little way off: fetch them first.
    const spot = offer.pick ?? fareSpot(city.plan, place, Math.floor(state.clock));
    const rider = addExtra(state, spot[0], 64, spot[1], false, player.seat, NS.HAIL);
    rider.until = cp.gig.until;
    Object.assign(cp.gig, { stage: 0, rider: rider.i, x: spot[0], z: spot[1], from: [offer.x + 0.5, offer.z + 0.5] });
  }
  if (offer.k === 4) {
    // Somebody has come over faint out there: fetch them in the ambulance and bring them back here.
    const patient = addExtra(state, offer.x + 0.5, 64, offer.z + 0.5, false, player.seat, NS.DIZZY);
    patient.until = cp.gig.until;
    Object.assign(cp.gig, { stage: 0, rider: patient.i, from: [place.walk[0], place.walk[1]] });
  }
  if (offer.k === 5) startFire(state, offer.x + 0.5, offer.z + 0.5, whereabouts(city.plan, offer.x, offer.z));
  // The vehicle for the job waits by the board: a bay somebody emptied is stocked again.
  const duty = DUTY[offer.k];
  if (duty !== undefined) city.plan.bays.forEach((bay, index) => { if (bay.kind === duty && far(bay.x, bay.z, place.walk[0], place.walk[1]) < 80) { city.emptied.delete(index); city.emptiedAt.delete(index); } });
  cp.open = -1;
  cp.offers = null;
  toast(player, offer.k === 2 ? 'Fare booked: pick them up, then drive them where they point.' : offer.k === 3 ? 'Bus route: take a Trundler from the yard and stop at every stop.' : offer.k === 4 ? 'Ambulance run: take the Patch Wagon, fetch the patient and bring them back.'
    : offer.k === 5 ? 'Fire call: take an engine and park it by the fire. Water balloons work too.' : `${gig.name}: follow the beacon. ${offer.pay} coins on delivery.`);
  addFx(state, 'craft', player.x, player.y + 1, player.z, I.coin);
  return true;
}
export function quitGig(state: State, player: Player, why = 'Gig dropped.') {
  const city = state.city!, cp = seatOf(state, player);
  if (!cp.gig) return false;
  if (cp.gig.rider >= 0) city.npcs.delete(cp.gig.rider);
  cp.gig = null;
  toast(player, why);
  return true;
}
/** Deliveries, pick-ups and deadlines, a few times a second. */
export function tickGigs(state: State) {
  const city = state.city!;
  for (const player of state.players) {
    const cp = city.players[player.seat]!, gig = cp.gig;
    // Step away from a counter and it closes.
    if (cp.open >= 0 && (state.ticks + player.seat) % 10 === 0) { const place = city.plan.places[cp.open]!; if (far(player.x, player.z, place.front[0], place.front[1]) > 14 && far(player.x, player.z, place.walk[0], place.walk[1]) > 14) { cp.open = -1; cp.offers = null; } }
    if (!gig || !player.connected || (state.ticks + player.seat) % 4) continue;
    if (state.clock > gig.until) { quitGig(state, player, 'Too slow: the gig fell through.'); continue; }
    const ride = rideOf(state, player), d = Math.hypot(player.x - gig.x, player.z - gig.z);
    // A fire call is settled when the fire is out (city-events.ts).
    if (gig.k === 5) continue;
    if (gig.k === 2 || gig.k === 3 || gig.k === 4) {
      if (d > DRIVE_REACH + (gig.k === 3 ? 2 : 0)) continue;
      const need = DUTY[gig.k], right = !!ride && cp.seat === 0 && (need === undefined ? RIDES[ride.k]!.seats >= 2 : ride.k === need);
      if (!right) { if (state.clock - cp.toldAt > 6) { cp.toldAt = state.clock; toast(player, gig.k === 2 ? 'A fare needs a vehicle with a spare seat.' : gig.k === 3 ? 'A bus route needs a Trundler bus: they wait at the depot.' : 'An ambulance run needs the Patch Wagon from the clinic.'); } continue; }
      if (cp.speed > 3) continue;
      if (gig.stage === 0) {
        city.npcs.delete(gig.rider);
        Object.assign(gig, { stage: 1, rider: -1, x: gig.from[0], z: gig.from[1] });
        addFx(state, 'door', ride!.x, ride!.y + 1, ride!.z, 4);
        toast(player, gig.k === 4 ? 'Patient aboard. Back to the clinic, gently.' : 'Fare aboard. Mind the kerbs.');
        continue;
      }
    } else if (d > (ride ? DRIVE_REACH : DROP_REACH)) continue;
    if (--gig.drops > 0) {
      // A parcel round has a second door near the first.
      const { plan } = city, doors = doorsOf(plan).filter(([x, z]) => { const gap = far(x, z, gig.x, gig.z); return gap > 40 && gap < 170; });
      // A bus's last stop is the depot it left from.
      const [x, z] = gig.k === 3 && gig.drops === 1 ? gig.from : doors[hash3(plan.seed, player.seat, Math.floor(state.clock), 0xd0) % Math.max(1, doors.length)] ?? gig.from;
      Object.assign(gig, { x, z });
      toast(player, gig.k === 3 ? gig.drops === 1 ? 'All aboard. Last stop: back to the depot.' : `All aboard. ${gig.drops} stops to go.` : 'Delivered. One more door.');
      addFx(state, gig.k === 3 ? 'ding' : 'pickup', player.x, player.y + 1, player.z, I.coin);
      continue;
    }
    // Paid, with a tip for speed.
    let tip = state.clock < gig.until - 20 ? Math.round(gig.pay * 0.15) : 0;
    if (gig.k === 3 && ride) {
      // Friends riding the bus make the round worth more, and get something for coming along.
      const aboard = ride.riders.filter(seat => seat >= 0).map(seat => state.players[seat]!).filter(Boolean);
      tip += Math.round(gig.pay * Math.min(1, aboard.length * 0.2));
      for (const rider of aboard) { earn(state, rider, 12); toast(rider, `${player.name}'s bus finished its route: 12 coins for riding along.`); }
    }
    if (gig.k === 4) { cp.stats.helped++; repAdd(cp, REP.WATCH, 2); repAdd(cp, REP.FOLK, 3); }
    cp.gig = null;
    cp.stats.gigs++;
    repAdd(cp, REP.FOLK, 1);
    if (cp.service > 0) {
      // Community service: this one was for the city.
      cp.service--;
      repAdd(cp, REP.WATCH, 4);
      toast(player, `${GIGS[gig.k]!.name} done for the city. ${cp.service ? 'One more and you are square.' : 'You are square with the Watch.'}`);
    } else {
      earn(state, player, gig.pay + tip);
      toast(player, `${GIGS[gig.k]!.name} done: ${gig.pay} coins${tip ? ` and ${tip} more on top` : ''}.`);
      if (gig.pay + tip >= 80) news(state, `${player.name} earned ${gig.pay + tip} coins on a ${GIGS[gig.k]!.name.toLowerCase()}`);
    }
    // Stamps after the pay line: each is a line under it.
    for (const key of [gig.k === 3 && ride ? 'bus' : '', gig.k === 4 ? 'medic' : '', 'gig']) if (key) stamp(state, player, key);
  }
}

/** Buy offer `index` of the open counter. */
export function buy(state: State, player: Player, index: number): boolean {
  const city = state.city!, cp = seatOf(state, player), place = city.plan.places[cp.open], offer: Offer | undefined = place && CATALOG[place.kind][index];
  if (!place || !offer || cp.offers || !atCounter(player, place) || !staffed(state, place)) return false;
  // Friends of the town pay less at its counters; anyone its shopkeepers are wary of pays more.
  const price = offer.t === 'cool' ? Math.max(10, Math.ceil(cp.heat) * offer.price) : offer.t === 'item' || offer.t === 'hat' || offer.t === 'heal' ? Math.max(1, Math.round(priceFor(state, cp, offer.price) * (onSale(state, place.i) ? 0.5 : 1))) : offer.price, broke = () => { toast(player, `That costs ${price} coins. You have ${cp.coins}.`); return false; };
  switch (offer.t) {
    case 'item': {
      if (cp.coins < price) return broke();
      const inv = player.inv.map(slot => slot && { ...slot });
      if (addItem(inv, offer.id, offer.n) > 0) { toast(player, 'Your pockets are full.'); return false; }
      player.inv.splice(0, inv.length, ...inv);
      break;
    }
    case 'hat':
      if (cp.hat === offer.k) { toast(player, 'You are wearing it.'); return false; }
      if (cp.coins < price) return broke();
      wear(state, player, offer.k);
      break;
    case 'ride':
      if (cp.own >> offer.k & 1) return callVehicle(state, player, offer.k);
      if (cp.coins < price) return broke();
      cp.own |= 1 << offer.k;
      cp.coins -= price;
      callVehicle(state, player, offer.k);
      news(state, `${player.name} bought a ${RIDES[offer.k]!.name}`);
      addFx(state, 'levelup', player.x, player.y + 1, player.z);
      stamp(state, player, 'owner');
      saleAt(state, place, player, price);
      return true;
    case 'flat': {
      if (cp.flat >= 0) { toast(player, 'You already have a flat.'); return false; }
      if (cp.coins < price) return broke();
      const flats = city.plan.lots.filter(lot => lot.kind === 'flats'), nearest = flats.sort((a, b) => far(a.x0, a.z0, player.x, player.z) - far(b.x0, b.z0, player.x, player.z))[0];
      if (!nearest) return false;
      cp.flat = nearest.i;
      toast(player, 'The keys are yours. Heat drains fast at home, and it is marked on your map.');
      stamp(state, player, 'home');
      news(state, `${player.name} bought a flat`);
      break;
    }
    case 'plot': {
      if (cp.plot >= 0) { toast(player, 'You already own a plot.'); return false; }
      if (cp.coins < price) return broke();
      const taken = new Set(city.players.map(other => other.plot)), free = city.plan.plots.map((plot, k) => ({ plot, k })).filter(({ k }) => !taken.has(k));
      const nearest = free.sort((a, b) => far(a.plot.x0, a.plot.z0, player.x, player.z) - far(b.plot.x0, b.plot.z0, player.x, player.z))[0];
      if (!nearest) { toast(player, 'Every plot in the city is sold.'); return false; }
      cp.plot = nearest.k;
      toast(player, 'The deed is yours: build what you like between the lamp posts. It is marked on your map.');
      stamp(state, player, 'land');
      news(state, `${player.name} bought a plot of land`);
      break;
    }
    case 'heal':
      if (player.health >= MAX_HEALTH) { toast(player, 'You are in fine shape already.'); return false; }
      if (cp.coins < price) return broke();
      player.health = MAX_HEALTH;
      break;
    case 'cool':
      if (cp.heat <= 0) { toast(player, 'Your slate is clean.'); return false; }
      if (heatTier(cp.heat) > 2) { toast(player, 'Too hot for that: they would nab you on the spot.'); return false; }
      if (cp.coins < price) return broke();
      Object.assign(cp, { heat: 0, spell: 0 });
      toast(player, 'Slate wiped clean.');
      break;
  }
  cp.coins -= price;
  saleAt(state, place, player, price);
  addFx(state, 'trade', place.counter[0], 65.6, place.counter[1], offer.t === 'item' ? offer.id : I.coin);
  return true;
}
/** Sell what is in an inventory slot at a counter that buys it: loot at a pawn shop, the catch at the bait hut or a diner. */
export function sell(state: State, player: Player, slot: number): boolean {
  const city = state.city!, cp = seatOf(state, player), place = city.plan.places[cp.open], stack = player.inv[slot], value = stack && place ? sellPrice(cp.rep[REP.MAGPIES]!, place.kind, stack.id) : 0;
  if (!place || !stack || !value || !atCounter(player, place) || !staffed(state, place)) return false;
  player.inv[slot] = null;
  earn(state, player, value * stack.n);
  if (place.kind === 'pawn' && value > 2) repAdd(cp, REP.MAGPIES, 2);
  toast(player, `Sold ${stack.n} × ${itemName(stack.id)} for ${value * stack.n} coins.`);
  return true;
}
/** Mining a till empties it: a swag bag to fence at a pawn shop, and plenty of heat if the keeper is watching. */
export function grabTill(state: State, player: Player, x: number, y: number, z: number): boolean {
  const city = state.city!, place = city.plan.places.find(p => p.till && p.till[0] === x && p.till[1] === y && p.till[2] === z);
  if (!place || cellId(state.get(x, y, z)) !== B.till) return false;
  if (state.clock < (city.tills.get(place.i) ?? 0)) { toast(player, 'This till is empty. Give it a few minutes.'); return false; }
  city.tills.set(place.i, state.clock + TILL.refill);
  const bags = place.kind === 'bank' ? 3 : 1, loose = Math.round((TILL.min + state.rand() * (TILL.max - TILL.min)) * 0.25);
  spawnItem(state, x + 0.5, y + 1, z + 0.5, { id: I.swag_bag, n: bags }, { scatter: true });
  spawnItem(state, x + 0.5, y + 1, z + 0.5, { id: I.coin, n: Math.min(64, loose) }, { scatter: true });
  addFx(state, 'coins', x + 0.5, y + 1, z + 0.5, loose);
  // A keeper at the counter always sees it; otherwise it takes a passer-by.
  const cp = seatOf(state, player);
  // Seen at it, and the town's shopkeepers remember for a while.
  if (mischief(state, player, MISCHIEF.till * (place.kind === 'bank' ? 1.6 : 1), staffed(state, place))) { cp.waryUntil = state.clock + 180; repAdd(cp, REP.FOLK, -6); }
  repAdd(cp, REP.MAGPIES, 4);
  robbed(state, place, player);
  news(state, `Someone emptied the till at ${place.name}`);
  toast(player, countItem(player.inv, I.swag_bag) ? 'More swag. A pawn shop will take it off your hands.' : 'Swag! Sell it at a pawn shop before the Watch finds it on you.');
  return true;
}
