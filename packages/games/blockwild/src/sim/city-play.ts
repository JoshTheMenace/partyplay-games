/**
 * Things to do together: street races anyone can start and others join, the bounty on whoever the Watch wants most,
 * the Golden Gull (a game of keep-away the whole room can see), the bank vault that wants more than one pair of hands,
 * and the lock-up a friend can spring you from. Nothing here is saved: all of it lives for a round.
 */
import { heatTier, MISCHIEF } from '../shared/city/economy';
import { CHECK_REACH, cityExtras, type Spot } from '../shared/city/extras';
import { ISLE } from '../shared/city/plan';
import { RIDES } from '../shared/city/vehicles';
import { I } from '../shared/items';
import { EV } from '../shared/protocol';
import { repAdd, stamp } from './city-career';
import { addEvent } from './city-events';
import { news, REP, rideOf, seatOf, type CityEvent, type CityPlayer } from './city-state';
import { earn, mischief, bust } from './city-watch';
import { spawnItem } from './entities';
import { teleport } from './players';
import { addFx, PROTECT_SECONDS, toast, type Player, type State } from './state';

// Street races ---------------------------------------------------------------------------------------------------------
/** A race: forming (0) for JOIN seconds, then running (1) until everyone is home or the stragglers' time is up. */
export type Race = { id: number; course: number; state: number; at: number; seats: number[]; home: number[]; pot: number; closeAt: number };
export const RACE = { join: 20, fee: 10, straggle: 40 } as const;
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
/** The prize for finishing `place` (0 = first) of `field`: a purse that grows with the course and the field, and the pot. */
export const racePrize = (length: number, field: number, place: number, pot: number) => Math.round((length / 14 * (field > 1 ? 1 : 0.5) + pot) * ([0.6, 0.3, 0.1][place] ?? 0) * (field > 1 || place > 0 ? 1 : 1 / 0.6));

/** At a race's start post, behind a wheel: start it, or join the one forming there. */
export function raceSpot(state: State, player: Player, spot: Spot): boolean {
  const city = state.city!, cp = seatOf(state, player), vehicle = rideOf(state, player), course = cityExtras(state.settings.seed).courses[spot.a]!;
  if (!vehicle || cp.seat !== 0 || RIDES[vehicle.k]!.air || RIDES[vehicle.k]!.sea) { toast(player, 'Races are for wheels: drive up to the flag.'); return false; }
  if (cp.race) { toast(player, 'You are already in a race.'); return false; }
  let race = city.races.find(entry => entry.course === spot.a && entry.state === 0);
  if (!race) {
    if (city.races.some(entry => entry.course === spot.a)) { toast(player, `The ${course.name} is being run. Wait for the flag.`); return false; }
    city.races.push(race = { id: ++city.eventId, course: spot.a, state: 0, at: state.clock + RACE.join, seats: [], home: [], pot: 0, closeAt: 0 });
    addEvent(state, EV.RACE, course.x, course.z, RACE.join, spot.a, race.id);
    news(state, `${player.name} is starting the ${course.name}: ${RACE.join} seconds to join at the flag`);
    addFx(state, 'whistle', course.x, 66, course.z);
  }
  const fee = Math.min(cp.coins, RACE.fee);
  cp.coins -= fee;
  race.pot += fee;
  race.seats.push(player.seat);
  cp.race = race.id;
  cp.lap = 0;
  toast(player, `You are in the ${course.name}. Line up: it starts in ${Math.max(1, Math.ceil(race.at - state.clock))} seconds.`);
  return true;
}
function tickRaces(state: State) {
  const city = state.city!, courses = cityExtras(state.settings.seed).courses;
  for (const race of city.races.slice()) {
    const course = courses[race.course]!, cps = race.seats.map(seat => city.players[seat]!);
    if (race.state === 0) {
      if (state.clock < race.at) continue;
      race.state = 1;
      race.at = state.clock;
      addFx(state, 'whistle', course.x, 66, course.z);
      for (const seat of race.seats) toast(state.players[seat]!, `Go! ${course.name}: ${course.points.length} flags, ${race.seats.length > 1 ? `${race.seats.length} racing` : 'against the clock'}.`);
      continue;
    }
    // Running: a racer takes each flag in order by driving through it.
    race.seats.forEach((seat, k) => {
      const player = state.players[seat]!, cp = cps[k]!, next = course.points[cp.lap];
      if (cp.race !== race.id || !next || !player.connected || Math.hypot(player.x - next[0], player.z - next[1]) > CHECK_REACH) return;
      cp.lap++;
      addFx(state, 'ding', player.x, player.y + 1.5, player.z);
      if (cp.lap < course.points.length) return;
      // Home.
      const place = race.home.push(seat) - 1, prize = racePrize(course.length, race.seats.length, place, race.pot), secs = Math.round((state.clock - race.at) * 10) / 10;
      cp.race = 0;
      if (prize > 0) earn(state, player, prize);
      toast(player, `${ordinal(place + 1)} in the ${course.name} in ${secs} seconds${prize ? `: ${prize} coins` : ''}.`);
      stamp(state, player, 'race');
      addFx(state, 'fanfare', player.x, player.y + 1, player.z);
      if (place === 0) {
        race.closeAt = state.clock + RACE.straggle;
        if (race.seats.length > 1) { cp.stats.wins++; news(state, `${player.name} won the ${course.name} in ${secs} seconds`); }
        else news(state, `${player.name} ran the ${course.name} alone in ${secs} seconds`);
      }
    });
    const over = race.home.length === race.seats.length || race.closeAt && state.clock >= race.closeAt || state.clock - race.at > course.length / 5 + 60 || cps.every((cp, k) => cp.race !== race.id || !state.players[race.seats[k]!]!.connected);
    if (!over) continue;
    for (const cp of cps) if (cp.race === race.id) cp.race = 0;
    city.races.splice(city.races.indexOf(race), 1);
  }
}
/** A racer's place right now (1 = leading): finishers first, then by flags taken, then by how near the next one is. */
function placeIn(state: State, race: Race, seat: number): number {
  const course = cityExtras(state.settings.seed).courses[race.course]!, city = state.city!;
  const score = (s: number) => { const at = race.home.indexOf(s); if (at >= 0) return 1e6 - at; const cp = city.players[s]!, player = state.players[s]!, next = course.points[cp.lap]; return cp.lap * 1000 - (next ? Math.min(999, Math.hypot(player.x - next[0], player.z - next[1])) : 0); };
  const mine = score(seat);
  return 1 + race.seats.filter(other => other !== seat && score(other) > mine).length;
}
/** What a racer's screen is told: [race id, flags taken, place, racers, seconds (to the start if negative, else run), course]. */
export function raceView(state: State, cp: CityPlayer, seat: number): number[] | undefined {
  const race = cp.race ? state.city!.races.find(entry => entry.id === cp.race) : undefined;
  return race && [race.id, cp.lap, placeIn(state, race, seat), race.seats.length, Math.round(race.state ? state.clock - race.at : state.clock - race.at), race.course];
}
/** Every race for the TV: [id, course, state, seconds, ...seats in running order]. */
export const racesView = (state: State): number[][] => state.city!.races.map(race => [race.id, race.course, race.state, Math.round(Math.abs(state.clock - race.at)), ...[...race.seats].sort((a, b) => placeIn(state, race, a) - placeIn(state, race, b))]);

// Bounties -------------------------------------------------------------------------------------------------------------
/** The coins on a wanted head. */
export const bountyFor = (heat: number) => 30 + Math.round(heat * 2);
/** Whoever the Watch wants most has a price on their head, and every map shows where they are. */
function tickBounty(state: State) {
  const city = state.city!;
  let best: Player | null = null;
  if (state.settings.bonks) for (const player of state.players) {
    const cp = city.players[player.seat]!;
    if (player.connected && !player.dead && !cp.cellUntil && heatTier(cp.heat) >= 2 && (!best || cp.heat > city.players[best.seat]!.heat)) best = player;
  }
  let event = city.events.find(entry => entry.k === EV.BOUNTY);
  if (!best) { if (event) event.until = 0; return; }
  if (!event) event = addEvent(state, EV.BOUNTY, best.x, best.z, 5);
  Object.assign(event, { x: best.x, z: best.z, until: state.clock + 3, a: bountyFor(city.players[best.seat]!.heat), b: best.seat });
}
/** One player has bonked another: if the other has a price on their head, that is a citizen's arrest. True when it was. */
export function collectBounty(state: State, hunter: Player, wanted: Player): boolean {
  const city = state.city!, event = city.events.find(entry => entry.k === EV.BOUNTY && entry.b === wanted.seat), cp = seatOf(state, hunter);
  if (!event || heatTier(cp.heat) >= 2) return false;
  const coins = event.a;
  event.until = 0;
  earn(state, hunter, coins);
  cp.stats.bounties++;
  repAdd(cp, REP.WATCH, 6);
  repAdd(cp, REP.MAGPIES, -5);
  stamp(state, hunter, 'bounty');
  news(state, `${hunter.name} handed ${wanted.name} in for a ${coins} coin bounty`);
  bust(state, wanted);
  return true;
}

// The Golden Gull ------------------------------------------------------------------------------------------------------
export const GULL = { seconds: 150, pay: 2, stamp: 30 } as const;
/** The gull event: `a` is its holder's seat + 1 (0: it is sitting where the event is), `b` the seconds this holder has had it. */
export const gullOf = (state: State): CityEvent | undefined => state.city!.events.find(event => event.k === EV.GULL);
export const holdsGull = (state: State, seat: number) => gullOf(state)?.a === seat + 1;
export function startGull(state: State, x: number, z: number, where: string): CityEvent {
  news(state, `The Golden Gull has landed at ${where}. Hold it for coins; bonk the holder to take it`);
  addFx(state, 'squawk', x, 66, z);
  return addEvent(state, EV.GULL, x, z, GULL.seconds);
}
/** The gull changes hands (or is put down: seat −1). */
function passGull(state: State, gull: CityEvent, seat: number) {
  gull.a = seat + 1;
  gull.b = 0;
  const player = state.players[seat];
  if (!player) return;
  addFx(state, 'squawk', player.x, player.y + 2, player.z);
  toast(player, 'You have the Golden Gull! Coins every second you keep it. No vehicles: it will not get in.');
  news(state, `${player.name} has the Golden Gull`);
}
function tickGull(state: State) {
  const city = state.city!, gull = gullOf(state);
  if (!gull) return;
  const holder = gull.a ? state.players[gull.a - 1] : undefined;
  if (holder) {
    const cp = city.players[holder.seat]!;
    // Dropped by anyone knocked out, locked up or gone.
    if (!holder.connected || holder.dead || cp.cellUntil) { gull.a = 0; return; }
    Object.assign(gull, { x: holder.x, z: holder.z });
    if (state.ticks % 20) return;
    gull.b++;
    cp.coins += GULL.pay;
    cp.stats.earned += GULL.pay;
    cp.stats.gull++;
    gull.helpers.set(holder.seat, (gull.helpers.get(holder.seat) ?? 0) + 1);
    if (gull.b >= GULL.stamp) stamp(state, holder, 'gull');
    if (gull.b % 10 === 0) addFx(state, 'squawk', holder.x, holder.y + 2, holder.z);
  } else if (state.ticks % 4 === 0) {
    // Sitting in the street: whoever walks up to it first has it.
    const taker = state.players.find(player => player.connected && !player.dead && !city.players[player.seat]!.ride && Math.hypot(player.x - gull.x, player.z - gull.z) < 2.2);
    if (taker) passGull(state, gull, taker.seat);
  }
}
/** Time: the gull flies off, and the one who kept it longest is named. */
export function gullGone(state: State, gull: CityEvent) {
  const best = [...gull.helpers].sort((a, b) => b[1] - a[1])[0];
  news(state, best ? `The Golden Gull flew off. ${state.players[best[0]]?.name ?? 'Somebody'} kept it longest: ${best[1]} seconds` : 'The Golden Gull flew off. Nobody caught it');
  addFx(state, 'squawk', gull.x, 68, gull.z);
}
/** One player has bonked another: the gull goes with the bonk. */
export function stealGull(state: State, thief: Player, holder: Player): boolean {
  const gull = gullOf(state);
  if (!gull || gull.a !== holder.seat + 1 || seatOf(state, thief).ride) return false;
  passGull(state, gull, thief.seat);
  return true;
}

// The bank vault -------------------------------------------------------------------------------------------------------
/** Cracking takes this long alone (each extra pair of hands works as fast again); the bell rings this long after it starts unless held; the vault then stays shut this long. */
export const VAULT = { seconds: 22, bell: 7, shut: 360, bars: 6 } as const;
export type Vault = { progress: number; bellAt: number; rung: boolean; shutUntil: number; crew: Set<number> };
export const newVault = (): Vault => ({ progress: 0, bellAt: 0, rung: false, shutUntil: 0, crew: new Set() });
const holding = (state: State, what: string) => state.players.filter(player => player.connected && !player.dead && state.city!.players[player.seat]!.hold?.what === what);
/** Start (or stop) a hold at a spot: cracking the vault, holding the alarm bell still, working the lock-up's lock. */
export function holdSpot(state: State, player: Player, spot: Spot): boolean {
  const city = state.city!, cp = seatOf(state, player);
  if (cp.ride) return false;
  if (cp.hold?.what === spot.kind) { cp.hold = null; return true; }
  if (spot.kind === 'vault' && state.clock < city.vault.shutUntil) { toast(player, `The vault is on a time lock: ${Math.ceil((city.vault.shutUntil - state.clock) / 60)} minutes yet.`); return false; }
  if (spot.kind === 'lock' && !state.players.some(other => city.players[other.seat]!.cellUntil > state.clock)) { toast(player, 'Nobody is in the lock-up.'); return false; }
  cp.hold = { what: spot.kind, key: spot.i, done: 0, at: state.clock };
  toast(player, spot.kind === 'vault' ? 'Cracking… stay close. A friend on the alarm bell keeps it quiet; more hands are quicker.' : spot.kind === 'alarm' ? 'You have the bell. Stay put and it stays quiet.' : 'Working the lock… stay close.');
  return true;
}
function tickHolds(state: State, dt: number) {
  const city = state.city!, extras = cityExtras(state.settings.seed), vault = city.vault;
  for (const player of state.players) {
    const cp = city.players[player.seat]!, hold = cp.hold;
    if (!hold) continue;
    const spot = extras.spots[hold.key];
    // Step away, get knocked silly or get nabbed and the hold is lost.
    if (!spot || !player.connected || player.dead || cp.cellUntil || state.clock < cp.dizzyUntil || Math.hypot(player.x - spot.x, player.z - spot.z) > spot.r + 1.5) { cp.hold = null; continue; }
    hold.done += dt;
    if (hold.what !== 'lock' || hold.done < LOCK_SECONDS) continue;
    // The lock gives: everyone inside is out, free of their fines.
    cp.hold = null;
    const freed = state.players.filter(other => city.players[other.seat]!.cellUntil > state.clock);
    for (const other of freed) { release(state, other, 0); toast(other, `${player.name} sprang you from the lock-up! No fine.`); }
    if (!freed.length) continue;
    stamp(state, player, 'spring');
    repAdd(cp, REP.MAGPIES, 6);
    repAdd(cp, REP.WATCH, -8);
    mischief(state, player, 45, true);
    news(state, `${player.name} sprang ${freed.map(other => other.name).slice(0, 3).join(' and ')} from the lock-up`);
  }
  const crew = holding(state, 'vault'), bell = holding(state, 'alarm');
  if (!crew.length) { if (vault.progress > 0 && vault.progress < 1) vault.progress = Math.max(0, vault.progress - dt * 0.05); vault.bellAt = 0; vault.rung = false; return; }
  const spot = extras.spots[seatOf(state, crew[0]!).hold!.key]!;
  if (!vault.bellAt) { vault.bellAt = state.clock + VAULT.bell; addEvent(state, EV.VAULT, spot.x, spot.z, 3, 0, 0); news(state, 'Somebody is at the vault of Brasswick Savings'); }
  for (const player of [...crew, ...bell]) vault.crew.add(player.seat);
  const event = city.events.find(entry => entry.k === EV.VAULT);
  if (event) Object.assign(event, { until: state.clock + 2, a: Math.round(vault.progress * 100), b: vault.rung ? 1 : 0 });
  // The bell: held still it never rings; let go, it rings when its time comes and the whole crew is hot.
  if (bell.length) vault.bellAt = Math.max(vault.bellAt, state.clock + 1.5);
  else if (!vault.rung && state.clock >= vault.bellAt) {
    vault.rung = true;
    news(state, 'ALARM at Brasswick Savings! The Watch is on its way');
    for (const player of crew) mischief(state, player, 48, true);
  }
  if (vault.rung && state.ticks % 24 === 0) addFx(state, 'alarm', spot.x, 66, spot.z);
  vault.progress += dt * crew.length / VAULT.seconds;
  if (vault.progress < 1) return;
  // Open: gold on the floor for whoever is quick, and the vault shuts on its time lock.
  const names = [...vault.crew].map(seat => state.players[seat]?.name).filter(Boolean);
  for (let k = 0; k < VAULT.bars; k++) spawnItem(state, spot.x + (state.rand() - 0.5) * 2, spot.y + 1, spot.z + (state.rand() - 0.5) * 2, { id: I.gold_bar, n: 1 }, { scatter: true });
  for (const seat of vault.crew) { const player = state.players[seat]!, cp = city.players[seat]!; repAdd(cp, REP.MAGPIES, 15); cp.hold = null; if (!vault.rung) mischief(state, player, MISCHIEF.till, true); stamp(state, player, 'vault'); }
  news(state, `${names.slice(0, 4).join(', ')} cracked the vault at Brasswick Savings`);
  addFx(state, 'fanfare', spot.x, spot.y + 1, spot.z);
  Object.assign(vault, { progress: 0, bellAt: 0, rung: false, shutUntil: state.clock + VAULT.shut, crew: new Set() });
}
/** A hold's progress for the screen doing it (0..1), or undefined. */
export function holdView(state: State, cp: CityPlayer): number | undefined {
  if (!cp.hold) return undefined;
  return Math.round(Math.min(1, cp.hold.what === 'vault' ? state.city!.vault.progress : cp.hold.what === 'lock' ? cp.hold.done / LOCK_SECONDS : 1) * 100) / 100;
}

// The lock-up ----------------------------------------------------------------------------------------------------------
/** Seconds in the cage if nothing is done, and to work its lock from outside. */
export const CELL_SECONDS = 40, LOCK_SECONDS = 4;
/** Nabbed: into the cage with the fine still to settle (pay it, work it off, sit it out for half, or be sprung). */
export function lockUp(state: State, player: Player, fine: number) {
  const cp = seatOf(state, player), [x, y, z] = cityExtras(state.settings.seed).cage.stand;
  cp.cellUntil = state.clock + CELL_SECONDS;
  cp.fine = fine;
  teleport(state, player, x + (player.seat % 3 - 1) * 0.8, y, z + (Math.floor(player.seat / 3) % 3 - 1) * 0.8);
}
/** Out of the cage and onto the Watch House steps, `fine` coins lighter. */
function release(state: State, player: Player, fine: number) {
  const cp = seatOf(state, player), [x, y, z] = state.city!.plan.jail;
  cp.cellUntil = 0;
  cp.coins -= Math.min(cp.coins, fine);
  cp.fine = 0;
  teleport(state, player, x + (player.seat % 5 - 2) * 0.9, y, z + (player.seat % 3 - 1) * 0.9);
  player.protectedUntil = state.clock + PROTECT_SECONDS;
}
/** A prisoner's choice: 0 pay the fine and walk, 1 community service (no fine: the next gig's pay goes to the city). */
export function cellChoice(state: State, player: Player, choice: number): boolean {
  const cp = seatOf(state, player);
  if (!cp.cellUntil) return false;
  if (choice === 1) { cp.service++; release(state, player, 0); toast(player, 'Community service: your next gig is for the city, unpaid. Then you are square.'); return true; }
  if (choice !== 0) return false;
  const fine = cp.fine;
  release(state, player, fine);
  toast(player, `Fine paid: ${fine} coins. Off you go.`);
  return true;
}
function tickCells(state: State) {
  for (const player of state.players) {
    const cp = state.city!.players[player.seat]!;
    if (!cp.cellUntil || state.clock < cp.cellUntil) continue;
    const half = Math.round(cp.fine / 2);
    release(state, player, half);
    toast(player, `Time served. Half the fine stands: ${half} coins.`);
  }
}

/** Races, the bounty, the gull, holds and the lock-up, once a tick. */
export function tickPlay(state: State, dt: number) {
  tickRaces(state);
  tickGull(state);
  tickHolds(state, dt);
  if (state.ticks % 20 === 3) {
    tickBounty(state);
    tickCells(state);
    // Setting foot on Gull Rock is its own stamp.
    for (const player of state.players) if (player.connected && player.onGround && (player.x - ISLE.x) ** 2 + (player.z - ISLE.z) ** 2 < 21 * 21) stamp(state, player, 'island');
  }
}
