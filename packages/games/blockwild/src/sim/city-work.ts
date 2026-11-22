/**
 * Earning and spending: gigs from job boards (parcel rounds, hot food, cab fares), the counters of shops and services,
 * property, and the tills that can be grabbed. Catalogues and prices live in shared/city/economy.ts so the shop screens
 * show exactly what the server charges.
 */
import { B, cellId } from '../shared/blocks';
import { CATALOG, GIGS, gigOf, heatTier, LOOT, MISCHIEF, TILL, type Offer } from '../shared/city/economy';
import { lotWalk, type Place } from '../shared/city/plan';
import { placeOpen } from '../shared/city/people';
import { RIDES } from '../shared/city/vehicles';
import { hash3 } from '../shared/noise';
import { addItem, countItem } from '../shared/inventory';
import { I, itemName } from '../shared/items';
import { MAX_HEALTH } from '../shared/constants';
import { NS, type GigOffer } from '../shared/protocol';
import { spawnItem } from './entities';
import { addFx, toast, type Player, type State } from './state';
import { callVehicle } from './city-rides';
import { news, rideOf, seatOf } from './city-state';
import { addExtra, earn, mischief } from './city-watch';

const COUNTER_REACH = 7, DROP_REACH = 3.6, DRIVE_REACH = 7;
const far = (ax: number, az: number, bx: number, bz: number) => Math.abs(ax - bx) + Math.abs(az - bz);

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
/** The three gigs a board offers right now (they change every minute). */
function offersAt(state: State, place: Place): GigOffer[] {
  const city = state.city!, { plan } = city, k = gigOf(place.kind), gig = GIGS[k]!, minute = Math.floor(state.clock / 60), offers: GigOffer[] = [];
  const [bx, bz] = place.walk, doors = plan.lots.filter(lot => lot.kind !== 'hangar' && lot.kind !== 'park' && lot.kind !== 'plot');
  for (let n = 0, salt = 0; offers.length < 3 && salt < 60; salt++) {
    const lot = doors[hash3(plan.seed, place.i, minute * 64 + salt, 0x919) % doors.length]!, [x, z] = lotWalk(lot), d = far(bx, bz, x, z);
    // Short, medium and long, so there is always something walkable and something worth a vehicle.
    if (d < [50, 130, 240][n]! || d > [150, 280, 520][n]! * (k === 2 ? 1.4 : 1)) continue;
    offers.push({ k, pay: Math.round(gig.base + d * gig.per * gig.drops), x: Math.round(x), z: Math.round(z), secs: Math.round(d * gig.drops / gig.speed + 25) });
    n++;
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
    const spot = city.plan.places[hash3(city.plan.seed, place.i, Math.floor(state.clock), 0xcab) % city.plan.places.length]!.walk;
    const rider = addExtra(state, spot[0], 64, spot[1], false, player.seat, NS.HAIL);
    rider.until = cp.gig.until;
    Object.assign(cp.gig, { stage: 0, rider: rider.i, x: spot[0], z: spot[1], from: [offer.x + 0.5, offer.z + 0.5] });
  }
  cp.open = -1;
  cp.offers = null;
  toast(player, offer.k === 2 ? 'Fare booked: pick them up, then drive them where they point.' : `${gig.name}: follow the beacon. ${offer.pay} coins on delivery.`);
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
    if (gig.k === 2) {
      if (d > DRIVE_REACH) continue;
      if (!ride || cp.seat !== 0 || RIDES[ride.k]!.seats < 2) { if (state.clock - cp.toldAt > 6) { cp.toldAt = state.clock; toast(player, 'A fare needs a vehicle with a spare seat.'); } continue; }
      if (cp.speed > 3) continue;
      if (gig.stage === 0) {
        city.npcs.delete(gig.rider);
        Object.assign(gig, { stage: 1, rider: -1, x: gig.from[0], z: gig.from[1] });
        addFx(state, 'door', ride.x, ride.y + 1, ride.z, 4);
        toast(player, 'Fare aboard. Mind the kerbs.');
        continue;
      }
    } else if (d > (ride ? DRIVE_REACH : DROP_REACH)) continue;
    if (--gig.drops > 0) {
      // A parcel round has a second door near the first.
      const { plan } = city, doors = plan.lots.filter(lot => lot.kind !== 'hangar' && lot.kind !== 'park' && lot.kind !== 'plot').map(lotWalk).filter(([x, z]) => { const gap = far(x, z, gig.x, gig.z); return gap > 40 && gap < 170; });
      const [x, z] = doors[hash3(plan.seed, player.seat, Math.floor(state.clock), 0xd0) % Math.max(1, doors.length)] ?? gig.from;
      Object.assign(gig, { x, z });
      toast(player, 'Delivered. One more door.');
      addFx(state, 'pickup', player.x, player.y + 1, player.z, I.coin);
      continue;
    }
    // Paid, with a tip for speed.
    const tip = state.clock < gig.until - 20 ? Math.round(gig.pay * 0.15) : 0;
    cp.gig = null;
    cp.stats.gigs++;
    earn(state, player, gig.pay + tip);
    toast(player, `${GIGS[gig.k]!.name} done: ${gig.pay} coins${tip ? ` and a ${tip} coin tip` : ''}.`);
    if (gig.pay + tip >= 80) news(state, `${player.name} earned ${gig.pay + tip} coins on a ${GIGS[gig.k]!.name.toLowerCase()}`);
  }
}

/** Buy offer `index` of the open counter. */
export function buy(state: State, player: Player, index: number): boolean {
  const city = state.city!, cp = seatOf(state, player), place = city.plan.places[cp.open], offer: Offer | undefined = place && CATALOG[place.kind][index];
  if (!place || !offer || cp.offers || !atCounter(player, place) || !staffed(state, place)) return false;
  const price = offer.t === 'cool' ? Math.max(10, Math.ceil(cp.heat) * offer.price) : offer.price, broke = () => { toast(player, `That costs ${price} coins. You have ${cp.coins}.`); return false; };
  switch (offer.t) {
    case 'item': {
      if (cp.coins < price) return broke();
      const inv = player.inv.map(slot => slot && { ...slot });
      if (addItem(inv, offer.id, offer.n) > 0) { toast(player, 'Your pockets are full.'); return false; }
      player.inv.splice(0, inv.length, ...inv);
      break;
    }
    case 'ride':
      if (cp.own >> offer.k & 1) return callVehicle(state, player, offer.k);
      if (cp.coins < price) return broke();
      cp.own |= 1 << offer.k;
      cp.coins -= price;
      callVehicle(state, player, offer.k);
      news(state, `${player.name} bought a ${RIDES[offer.k]!.name}`);
      addFx(state, 'levelup', player.x, player.y + 1, player.z);
      return true;
    case 'flat': {
      if (cp.flat >= 0) { toast(player, 'You already have a flat.'); return false; }
      if (cp.coins < price) return broke();
      const flats = city.plan.lots.filter(lot => lot.kind === 'flats'), nearest = flats.sort((a, b) => far(a.x0, a.z0, player.x, player.z) - far(b.x0, b.z0, player.x, player.z))[0];
      if (!nearest) return false;
      cp.flat = nearest.i;
      toast(player, 'The keys are yours. Heat drains fast at home, and it is marked on your map.');
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
  addFx(state, 'trade', place.counter[0], 65.6, place.counter[1], offer.t === 'item' ? offer.id : I.coin);
  return true;
}
/** Sell the loot in an inventory slot at a pawn shop. */
export function sell(state: State, player: Player, slot: number): boolean {
  const city = state.city!, cp = seatOf(state, player), place = city.plan.places[cp.open], stack = player.inv[slot], value = stack ? LOOT[stack.id] : undefined;
  if (!place || place.kind !== 'pawn' || !stack || !value || !atCounter(player, place) || !staffed(state, place)) return false;
  player.inv[slot] = null;
  earn(state, player, value * stack.n);
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
  mischief(state, player, MISCHIEF.till * (place.kind === 'bank' ? 1.6 : 1), staffed(state, place));
  news(state, `Someone emptied the till at ${place.name}`);
  toast(player, countItem(player.inv, I.swag_bag) ? 'More swag. A pawn shop will take it off your hands.' : 'Swag! Sell it at a pawn shop before the Watch finds it on you.');
  return true;
}
