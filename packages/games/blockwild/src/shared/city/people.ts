/**
 * Caper City's residents: who they are (name, look, home, job, temperament) and where each one is at any moment.
 * A resident's day is a pure function of (seed, resident, day, time): stays (home, a counter, a bench) joined by walks
 * along the sidewalk graph. Nothing here is simulated or stored, so every screen and the server agree on the crowd
 * without sending it, and residents far from every player cost nothing. Integer hashes and + - * / only.
 */
import { DAY_TICKS, SEED_CACHE } from '../constants';
import { hash3 } from '../noise';
import { cityPlan, CITY, CITY_SIZE, footprint, layoutOf, lotSpot, lotWalk, nearestSidewalk, pathLength, sidewalkPath, type CityPlan, type Lot, type Place } from './plan';

/** What a resident is doing (`Pose.act`): drives the animation and the line they say when spoken to. */
export const ACT = { HOME: 0, COMMUTE: 1, WORK: 2, INSIDE: 3, LUNCH: 4, STROLL: 5, REST: 6, PATROL: 7, HOMEWARD: 8, ROUND: 9, BUSK: 10 } as const;
export const JOBS = ['keeper', 'clerk', 'office', 'officer', 'courier', 'hand', 'gardener', 'vendor', 'busker', 'sweeper', 'cabbie', 'medic', 'crew', 'free'] as const;
export type JobKey = typeof JOBS[number];
/** Hats: 0 none, 1 cap, 2 hard hat, 3 chef's toque, 4 brimmed hat, 5 beanie. Hair styles: 0 bald, 1 short, 2 bob, 3 bun. */
export type Look = { skin: number; hair: number; cut: number; top: number; legs: number; hat: number; hatColor: number; bib: number; scale: number };
export type Resident = {
  i: number; name: string; job: JobKey; look: Look;
  /** Lots of the home and the workplace (−1: none), the place worked at (−1 unless a keeper), and the shift in day ticks. */
  home: number; work: number; place: number; from: number; to: number;
  /** Where the work happens (feet); `hidden`: indoors out of sight; `indoor`: in the room behind the lot's doorway. */
  spot: [number, number]; hidden: boolean; indoor: boolean;
  /** Walking speed (m/s) and how far right of the sidewalk's middle they keep. */
  speed: number; side: number;
  /** Most flee when bonked; the brave bonk back. Snitches report mischief from twice as far. */
  brave: boolean; snitch: boolean;
};
type Stay = { t0: number; t1: number; x: number; z: number; yaw: number; act: number; hidden: boolean; path: null };
/** A walk: `path` is flat [x, z, …]; `loop` repeats it for the whole span (a beat); otherwise the walker waits at its end. */
type Walk = { t0: number; t1: number; path: number[]; len: number; act: number; loop: boolean; hidden: false };
type Step = Stay | Walk;
export type Pose = { x: number; z: number; yaw: number; act: number; hidden: boolean; moving: boolean };
export type People = {
  plan: CityPlan; list: Resident[];
  /** Keepers of each place (two shifts), by place index. */
  keepers: number[][];
  /** Day plans, by resident, for one day at a time. */
  days: Map<number, { day: number; steps: Step[] }>;
};

const SKIN = [0xf3d2b4, 0xe2b48c, 0xc98f62, 0xa6703f, 0x7d4f2a, 0x5a371d], HAIR = [0x2a1d12, 0x4a2f18, 0x7a4a22, 0xb5803a, 0xd9b45a, 0x8a8a90, 0xc0503a, 0x1a1a1f];
const TOPS = [0xd8403a, 0xe98f4c, 0xf2c23e, 0x6cc04f, 0x2fa69a, 0x3aa8dc, 0x4a63c8, 0x9b6ee0, 0xe07ab0, 0xf1ead6, 0x6b7280, 0x8a5a3a, 0x355e3b, 0xb5503a];
const LEGS = [0x2b3f73, 0x3a3f4a, 0x5a4632, 0x6b7280, 0x23232a, 0x7a6a52, 0x3f5d7a];
const FIRST = ['Mabel', 'Otis', 'Pearl', 'Hugo', 'Dot', 'Barnaby', 'Nell', 'Rufus', 'Ida', 'Cosmo', 'Fern', 'Gus', 'Posy', 'Walt', 'Tilly', 'Ned', 'Olive', 'Basil', 'Greta', 'Monty', 'Winnie', 'Albie', 'Hattie', 'Lou',
  'Juno', 'Felix', 'Bea', 'Ozzy', 'Marnie', 'Kip', 'Nora', 'Dex', 'Edie', 'Ravi', 'Suki', 'Tomas', 'Amara', 'Yusuf', 'Ingrid', 'Paolo', 'Zadie', 'Kofi', 'Mei', 'Arlo', 'Priya', 'Sven', 'Luz', 'Enzo'];
const LAST = ['Quince', 'Tumble', 'Bramble', 'Pickle', 'Wobble', 'Fennel', 'Thistle', 'Crumpet', 'Marlow', 'Biscuit', 'Puddle', 'Sprocket', 'Mallow', 'Tinker', 'Gribble', 'Nettle', 'Dabble', 'Pocket', 'Wicket', 'Bumble',
  'Clover', 'Pepper', 'Twine', 'Hobble', 'Larkin', 'Sorrel', 'Fidget', 'Button', 'Mumble', 'Skettle', 'Dapple', 'Crinkle', 'Poppet', 'Juniper', 'Rumble', 'Whistle', 'Barley', 'Trundle', 'Noodle', 'Parsnip',
  'Okafor', 'Lindqvist', 'Tanaka', 'Moreau', 'Castillo', 'Novak', 'Haddad', 'Banerjee'];
/** Uniforms by job: [top, legs, hat, hat colour, bib]; −1 keeps the resident's own. */
const UNIFORM: Partial<Record<JobKey, readonly [number, number, number, number, number]>> = {
  keeper: [-1, -1, 0, 0, 0xf1ead6], officer: [0x26386e, 0x1c2648, 1, 0x1c2648, 0xe6b93a], courier: [0x2fa69a, 0x3a3f4a, 1, 0x2fa69a, 0], hand: [0xe98f4c, 0x3f5d7a, 2, 0xf2c23e, 0xf2c23e],
  gardener: [0x6cc04f, 0x5a4632, 4, 0xd9c27a, 0x355e3b], vendor: [0xf1ead6, -1, 3, 0xffffff, 0xd8403a], sweeper: [0xb7d94a, 0x3a3f4a, 5, 0xe98f4c, 0], cabbie: [0xf2c23e, 0x23232a, 1, 0x23232a, 0],
  medic: [0xf7f7f2, 0xf7f7f2, 0, 0, 0xd8403a], crew: [0x3a3f4a, 0x3a3f4a, 1, 0x3aa8dc, 0], clerk: [0xf1ead6, 0x3a3f4a, 0, 0, 0x4a63c8],
};
/** Walking pace: ticks per block at 1 m/s. */
const TICK = 20;
const walkTicks = (len: number, speed: number) => Math.ceil(len / speed * TICK);

function lookOf(seed: number, i: number, job: JobKey): Look {
  const h = (salt: number) => hash3(seed, i, salt, 0x100c), uniform = UNIFORM[job], hat = h(5) % 100;
  const look: Look = {
    skin: SKIN[h(1) % SKIN.length]!, hair: HAIR[h(2) % HAIR.length]!, cut: 1 + h(3) % 3 - (h(3) % 17 === 0 ? 1 : 0), top: TOPS[h(4) % TOPS.length]!, legs: LEGS[h(6) % LEGS.length]!,
    hat: hat < 12 ? 1 : hat < 18 ? 5 : hat < 22 ? 4 : 0, hatColor: TOPS[h(7) % TOPS.length]!, bib: 0, scale: 0.92 + (h(8) % 17) / 100,
  };
  if (!uniform) return look;
  const [top, legs, cap, capColor, bib] = uniform;
  return { ...look, top: top < 0 ? look.top : top, legs: legs < 0 ? look.legs : legs, hat: cap || (job === 'keeper' ? 0 : look.hat), hatColor: cap ? capColor : look.hatColor, bib };
}

/** The doorway of a lot's building (standing just inside it), or the lot's front edge for open ground. */
const lotDoor = (lot: Lot): [number, number] => { const { door } = layoutOf(lot); return lotSpot(lot, door[0], footprint(lot) ? door[1] : 0); };

type Opening = { job: JobKey; lot: number; place: number; from: number; to: number; spot: [number, number]; hidden: boolean; indoor: boolean };
/** Every job in the city, the ones that keep it running first (they are filled first if homes run short). */
function openings(plan: CityPlan): Opening[] {
  const out: Opening[] = [], lots = plan.lots;
  const add = (job: JobKey, lot: Lot, from: number, to: number, spot: [number, number], hidden = false, place = -1) => out.push({ job, lot: lot.i, place, from, to, spot, hidden, indoor: hidden || place >= 0 && !!footprint(lot) });
  const inside = (job: JobKey, lot: Lot, count: number, from: number, to: number) => { for (let k = 0; k < count; k++) add(job, lot, from + k * 60, to + k * 45, lotDoor(lot), true); };
  // Two shifts behind every counter: 06:30–16:00 and 15:45–02:00.
  for (const place of plan.places) for (const [from, to] of [[500, 10000], [9750, 20000]] as const) add(place.kind === 'clinic' ? 'medic' : place.kind === 'airfield' ? 'crew' : place.kind === 'watch' ? 'officer' : place.kind === 'bank' || place.kind === 'hall' ? 'clerk' : 'keeper', lots[place.lot]!, from, to, place.counter, false, place.i);
  const watch = lots[plan.byKind('watch')[0]!.lot]!;
  // Twelve officers walk beats in three overlapping shifts; they live at the Watch House.
  for (let k = 0; k < 12; k++) add('officer', watch, [0, 7800, 15800][k % 3]!, [8400, 16400, 23400][k % 3]!, lotWalk(watch));
  for (const lot of lots) {
    const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0, at = (fu: number, fv: number): [number, number] => [lot.x0 + 0.5 + Math.floor(w * fu), lot.z0 + 0.5 + Math.floor(d * fv)];
    switch (lot.kind) {
      case 'boutique': inside('keeper', lot, 1, 2000, 12000); break;
      case 'office': inside('office', lot, 3 + lot.floors % 3, 2000, 11000); break;
      case 'warehouse': for (let k = 0; k < 2; k++) add('hand', lot, 1000 + k * 200, 10000, lotSpot(lot, 6 + k * 30, 3)); break;
      case 'depot': for (let k = 0; k < 5; k++) add('courier', lot, 1200 + k * 500, 11500 + k * 300, lotWalk(lot)); break;
      case 'park': for (let k = 0; k < 2; k++) add('gardener', lot, 1500, 10500, at(k ? 0.75 : 0.2, k ? 0.25 : 0.7)); break;
      case 'market': for (let k = 0; k < 6; k++) add('vendor', lot, 1000, 11000, lotSpot(lot, [7, 18, 31, 41, 7, 31][k]!, k < 4 ? 8 : 38)); break;
      case 'hall': for (let k = 0; k < 2; k++) add('busker', lot, 4000 + k * 3000, 12500 + k * 3000, lotSpot(lot, k ? 34 : 13, 14)); break;
      case 'fair': for (let k = 0; k < 3; k++) add('vendor', lot, 9000, 19500, lotSpot(lot, 31 + k * 6, 7)); break;
      case 'hotel': inside('clerk', lot, 3, 1000, 13000); break;
      case 'bank': inside('clerk', lot, 2, 2500, 10500); break;
      case 'school': inside('office', lot, 3, 1800, 9000); break;
      case 'cinema': inside('clerk', lot, 2, 8000, 19000); break;
      case 'clinic': inside('medic', lot, 2, 1000, 12000); break;
      case 'garage': add('hand', lot, 1500, 11000, lotSpot(lot, 40, 8)); break;
      case 'scrap': add('hand', lot, 1500, 11000, lotSpot(lot, 30, 26)); break;
      case 'hangar': add('crew', lot, 1500, 11000, lotSpot(lot, 50, 30)); break;
    }
  }
  for (const cab of plan.byKind('cabs')) add('cabbie', lots[cab.lot]!, 1500, 12500, [cab.walk[0] + 1.5, cab.walk[1] + 1.5]);
  // Sweepers start from their own street: their lot is filled in from their home.
  for (let k = 0; k < 8; k++) out.push({ job: 'sweeper', lot: -1, place: -1, from: 800 + k * 150, to: 9500, spot: [0, 0], hidden: false, indoor: false });
  return out;
}

function build(seed: number): People {
  const plan = cityPlan(seed), list: Resident[] = [], homes: { lot: Lot; walk: [number, number] }[] = [];
  for (const lot of plan.lots) if (lot.kind === 'house' || lot.kind === 'flats') for (let k = lot.kind === 'house' ? 2 : 6; k > 0; k--) homes.push({ lot, walk: lotWalk(lot) });
  const taken = new Uint8Array(homes.length), keepers: number[][] = plan.places.map(() => []), watch = plan.byKind('watch')[0]!;
  const resident = (home: Lot, job: JobKey, o: Opening | null): Resident => {
    const i = list.length, h = (salt: number) => hash3(seed, i, salt, 0x9e09);
    const person: Resident = {
      i, name: `${FIRST[h(1) % FIRST.length]} ${LAST[h(2) % LAST.length]}`, job, look: lookOf(seed, i, job), home: home.i, work: o?.lot ?? -1, place: o?.place ?? -1, from: o?.from ?? 0, to: o?.to ?? 0,
      // Officers stride: a beat is a long walk.
      spot: o?.spot ?? [0, 0], hidden: o?.hidden ?? false, indoor: o?.indoor ?? false, speed: (job === 'officer' ? 1.75 : 1.35) + (h(3) % 40) / 100, side: 0.25 + (h(4) % 40) / 100, brave: h(5) % 100 < 15, snitch: h(6) % 100 < 20,
    };
    list.push(person);
    return person;
  };
  for (const o of openings(plan)) {
    // Officers live at the Watch House; everyone else takes the nearest free home to the job.
    if (o.job === 'officer' && o.place < 0) { resident(plan.lots[watch.lot]!, 'officer', o); continue; }
    let best = -1, bestD = Infinity;
    const [wx, wz] = o.lot < 0 ? [CITY.x0 + (hash3(seed, list.length, 1, 0x5eeb) % CITY_SIZE), CITY.z0 + (hash3(seed, list.length, 2, 0x5eeb) % CITY_SIZE)] : lotWalk(plan.lots[o.lot]!);
    for (let k = 0; k < homes.length; k++) {
      if (taken[k]) continue;
      // A little noise so one block of flats does not staff one whole street.
      const d = Math.abs(homes[k]!.walk[0] - wx) + Math.abs(homes[k]!.walk[1] - wz) + hash3(seed, k, list.length, 0x4a11) % 90;
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best < 0) break;
    taken[best] = 1;
    const person = resident(homes[best]!.lot, o.job, o);
    if (o.lot < 0) { person.work = person.home; person.spot = homes[best]!.walk; }
    if (o.place >= 0) keepers[o.place]!.push(person.i);
  }
  homes.forEach((home, k) => { if (!taken[k]) resident(home.lot, 'free', null); });
  return { plan, list, keepers, days: new Map() };
}

const cache = new Map<number, People>();
/** The residents of a seed's city. */
export function cityPeople(seed: number): People {
  let people = cache.get(seed);
  if (!people) {
    if (cache.size >= SEED_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(seed, people = build(seed));
  }
  return people;
}

// A day ------------------------------------------------------------------------------------------------------------------
const HAUNTS = new WeakMap<CityPlan, Lot[]>();
/** Somewhere to idle near (x, z): a park bench, the plaza, the market or the fair, whichever of the two nearest `pickBy` picks. */
function haunt(plan: CityPlan, x: number, z: number, pickBy: number): [number, number] {
  let lots = HAUNTS.get(plan);
  if (!lots) HAUNTS.set(plan, lots = plan.lots.filter(lot => lot.kind === 'park' || lot.kind === 'hall' || lot.kind === 'market' || lot.kind === 'fair'));
  const far = (lot: Lot) => Math.abs((lot.x0 + lot.x1) / 2 - x) + Math.abs((lot.z0 + lot.z1) / 2 - z);
  const lot = [...lots].sort((a, b) => far(a) - far(b))[pickBy & 1]!, k = (pickBy >>> 8) % 8;
  if (lot.kind === 'park') { const [u, v] = [[15, 21], [15, 26], [32, 21], [32, 26], [21, 15], [26, 15], [21, 32], [26, 32]][k]!; return lotSpot(lot, u!, v!); }
  if (lot.kind === 'hall') return lotSpot(lot, 10 + k * 4, 9 + (k & 1) * 4);
  return lotSpot(lot, 8 + k * 4, 22 + (k & 3));
}
/** The path from a lot's sidewalk on to a point in it (through the doorway when the point is indoors), and the way back out. */
const inward = (lot: Lot, x: number, z: number, indoor: boolean) => indoor && footprint(lot) ? [...lotDoor(lot), x, z] : [x, z];
const outward = (lot: Lot, x: number, z: number, indoor: boolean) => indoor && footprint(lot) ? [x, z, ...lotDoor(lot)] : [x, z];
/** How far apart two points are along the streets, near enough for planning a day. */
const blocks = (ax: number, az: number, bx: number, bz: number) => (Math.abs(ax - bx) + Math.abs(az - bz)) * 1.1 + 24;
/** Nobody walks further than this for lunch or a breather. */
const STROLL = 150;

function planDay(people: People, r: Resident, day: number): Step[] {
  const { plan } = people, seed = plan.seed, steps: Step[] = [], h = (salt: number) => hash3(seed, r.i * 31 + day, salt, 0xda7);
  const home = plan.lots[r.home]!, [hx, hz] = lotWalk(home), door = lotDoor(home);
  // `t` is the clock, (x, z) the sidewalk point the resident is at or will rejoin, `exit` the way there from where they stand.
  let t = 0, x = hx, z = hz, exit: number[] = [door[0], door[1]];
  const stay = (until: number, sx: number, sz: number, act: number, hidden: boolean, yaw = 0) => {
    const t1 = Math.min(DAY_TICKS, until);
    if (t1 > t) { steps.push({ t0: t, t1, x: sx, z: sz, yaw, act, hidden, path: null }); t = t1; }
  };
  /** Walk from where they stand, along the sidewalks to (tx, tz) and on through `tail`; `out` is the way back to (tx, tz). */
  const walk = (tx: number, tz: number, act: number, tail: number[] = [], out: number[] = []) => {
    const path = [...exit, ...sidewalkPath(x, z, tx, tz), ...tail], len = pathLength(path), t1 = Math.min(DAY_TICKS, t + walkTicks(len, r.speed));
    if (t1 > t) steps.push({ t0: t, t1, path, len, act, loop: false, hidden: false });
    t = t1;
    x = tx;
    z = tz;
    exit = out;
  };
  /** Walk a closed round as many whole times as fit before `until` (so it ends where it began, at its first stop). */
  const round = (until: number, stops: [number, number][], act: number) => {
    const path: number[] = [];
    stops.forEach(([sx, sz], k) => { const [nx, nz] = stops[(k + 1) % stops.length]!, leg = sidewalkPath(sx, sz, nx, nz); path.push(...(k ? leg.slice(2) : leg)); });
    const len = pathLength(path), lap = walkTicks(len, r.speed), laps = Math.floor((until - t) / lap);
    if (laps < 1) return;
    steps.push({ t0: t, t1: t + laps * lap, path, len, act, loop: true, hidden: false });
    t += laps * lap;
  };
  const homeTicks = (fx: number, fz: number) => walkTicks(blocks(fx, fz, hx, hz), r.speed);
  /** There is time to walk to (tx, tz), stay a while and still be home before the day ends. */
  const fits = (tx: number, tz: number, linger: number) => t + walkTicks(blocks(x, z, tx, tz), r.speed) + linger + homeTicks(tx, tz) < DAY_TICKS - 300;
  const goHome = () => { walk(hx, hz, ACT.HOMEWARD, door); stay(DAY_TICKS, door[0], door[1], ACT.HOME, true); };
  /** A breather at a haunt nearby, if the day has room for it. */
  const leisure = (linger: number) => {
    const [lx, lz] = haunt(plan, x, z, h(11 + steps.length)), [sx, sz] = nearestSidewalk(lx, lz);
    if (blocks(x, z, sx, sz) > STROLL * 1.6 || !fits(sx, sz, linger)) return;
    walk(sx, sz, ACT.STROLL, [lx, lz], [lx, lz]);
    stay(t + linger, lx, lz, ACT.REST, false, h(12) % 628 / 100);
  };
  if (r.job === 'free') {
    // A late start, a breather or two, a look in at a shop nearby, home by evening.
    stay(1500 + h(1) % 3500, door[0], door[1], ACT.HOME, true);
    leisure(1800 + h(2) % 2500);
    const shops = plan.places.filter(place => blocks(x, z, place.walk[0], place.walk[1]) < STROLL), shop = shops[h(3) % Math.max(1, shops.length)];
    if (shop && fits(shop.walk[0], shop.walk[1], 500)) { walk(shop.walk[0], shop.walk[1], ACT.STROLL); stay(t + 300 + h(4) % 400, x, z, ACT.REST, false, h(5) % 628 / 100); }
    if (h(6) & 1) leisure(1500 + h(7) % 2000);
    goHome();
    return steps;
  }
  const work = plan.lots[r.work]!, [wx, wz] = lotWalk(work), [sx, sz] = r.spot;
  stay(Math.max(0, r.from - walkTicks(blocks(hx, hz, wx, wz), r.speed) - h(1) % 250), door[0], door[1], ACT.HOME, true);
  if (r.job === 'officer' && r.place < 0) {
    // A beat round one block within three of the Watch House (a different one each day), out and back before the shift ends.
    const near = (b: number, salt: number) => Math.max(0, Math.min(CITY.n - 1, b - 3 + h(salt) % 7)), bx = near(home.bx, 2), bz = near(home.bz, 3);
    const x0 = CITY.x0 + bx * CITY.pitch + CITY.road - 1.5, z0 = CITY.z0 + bz * CITY.pitch + CITY.road - 1.5, far = CITY.lot + 3;
    const beat: [number, number][] = [[x0, z0], [x0 + far, z0], [x0 + far, z0 + far], [x0, z0 + far]];
    walk(x0, z0, ACT.PATROL);
    round(r.to - homeTicks(x0, z0), beat, ACT.PATROL);
    goHome();
    return steps;
  }
  if (r.job === 'courier' || r.job === 'sweeper') {
    // Couriers call at doors near the depot and come back to it; sweepers circle their own block.
    const stops: [number, number][] = [];
    if (r.job === 'courier') {
      stops.push([wx, wz]);
      const doors = plan.lots.filter(lot => lot.kind !== 'hangar' && blocks(wx, wz, ...lotWalk(lot)) < 260);
      for (let k = 0; k < 4; k++) stops.push(lotWalk(doors[h(20 + k) % doors.length]!));
    } else { const bx0 = CITY.x0 + home.bx * CITY.pitch + CITY.road - 1.5, bz0 = CITY.z0 + home.bz * CITY.pitch + CITY.road - 1.5, s = CITY.lot + 3; stops.push([bx0, bz0], [bx0 + s, bz0], [bx0 + s, bz0 + s], [bx0, bz0 + s]); }
    walk(stops[0]![0], stops[0]![1], ACT.COMMUTE);
    round(r.to, stops, ACT.ROUND);
    goHome();
    return steps;
  }
  const act = r.hidden ? ACT.INSIDE : r.job === 'busker' ? ACT.BUSK : ACT.WORK, at: [number, number] = r.hidden ? lotDoor(work) : [sx, sz];
  const tail = r.hidden ? lotDoor(work) : inward(work, sx, sz, r.indoor), out = r.hidden ? lotDoor(work) : outward(work, sx, sz, r.indoor);
  // Behind a counter they face the street.
  const facing = [0, -Math.PI / 2, Math.PI, Math.PI / 2][work.face]!;
  walk(wx, wz, ACT.COMMUTE, tail, out);
  // Day workers break for lunch at a counter nearby that sells food; the keepers' two shifts work straight through.
  const lunchAt = r.to - r.from > 7000 && r.place < 0 ? 5600 + h(6) % 900 : -1, food = nearestFood(plan, wx, wz);
  if (lunchAt > t + 600 && blocks(wx, wz, food.walk[0], food.walk[1]) < STROLL) {
    stay(lunchAt, at[0], at[1], act, r.hidden, facing);
    const spread = (h(7) % 9 - 4) * 0.9, lot = plan.lots[food.lot]!, fx = food.front[0] + (lot.face % 2 ? 0 : spread), fz = food.front[1] + (lot.face % 2 ? spread : 0);
    walk(food.walk[0], food.walk[1], ACT.LUNCH, inward(lot, fx, fz, true), outward(lot, fx, fz, true));
    stay(t + 500 + h(8) % 400, fx, fz, ACT.LUNCH, false, [Math.PI, Math.PI / 2, 0, -Math.PI / 2][lot.face]!);
    walk(wx, wz, ACT.COMMUTE, tail, out);
  }
  stay(r.to, at[0], at[1], act, r.hidden, facing);
  if (h(9) % 3) leisure(900 + h(10) % 1500);
  goHome();
  return steps;
}
function nearestFood(plan: CityPlan, x: number, z: number): Place {
  let best = plan.byKind('food')[0]!, bestD = Infinity;
  for (const place of plan.byKind('food')) { const d = Math.abs(place.walk[0] - x) + Math.abs(place.walk[1] - z); if (d < bestD) { bestD = d; best = place; } }
  return best;
}

/** A resident's steps for a day (planned once per resident per day). */
export function dayOf(people: People, r: Resident, day: number): readonly Step[] {
  let entry = people.days.get(r.i);
  if (!entry || entry.day !== day) people.days.set(r.i, entry = { day, steps: planDay(people, r, day) });
  return entry.steps;
}

/** Where a resident is at `time` (day ticks) on `day`, written into `out`. */
export function residentAt(people: People, r: Resident, day: number, time: number, out: Pose): Pose {
  const steps = dayOf(people, r, day);
  let step = steps[steps.length - 1]!;
  for (const candidate of steps) if (time < candidate.t1) { step = candidate; break; }
  out.act = step.act;
  out.hidden = step.hidden;
  if (!step.path) {
    out.x = step.x; out.z = step.z; out.yaw = step.yaw; out.moving = false;
    return out;
  }
  const { path, len } = step, walked = Math.max(0, time - step.t0) / TICK * r.speed;
  let along = step.loop && len > 0 ? walked % len : Math.min(walked, len);
  out.moving = step.loop || walked < len;
  for (let i = 2; i < path.length; i += 2) {
    const ax = path[i - 2]!, az = path[i - 1]!, dx = path[i]! - ax, dz = path[i + 1]! - az, d = Math.hypot(dx, dz);
    if (along > d && i < path.length - 2) { along -= d; continue; }
    const f = d > 0 ? Math.min(1, along / d) : 0, nx = d > 0 ? dx / d : 0, nz = d > 0 ? dz / d : 0;
    // Keep right of the line walked, easing onto it at both ends of the walk so doorways are met squarely.
    const ease = step.loop ? 1 : Math.min(1, walked / 3, Math.max(0, len - walked) / 3), side = r.side * ease;
    out.x = ax + dx * f - nz * side;
    out.z = az + dz * f + nx * side;
    out.yaw = Math.atan2(-nx, -nz);
    return out;
  }
  out.x = path[path.length - 2]!; out.z = path[path.length - 1]!; out.yaw = 0;
  return out;
}

/** True while one of a place's keepers stands at its counter (the place is open for business). */
export function placeOpen(people: People, place: number, day: number, time: number): boolean {
  const pose: Pose = { x: 0, z: 0, yaw: 0, act: 0, hidden: false, moving: false };
  return people.keepers[place]!.some(i => { const r = people.list[i]!; residentAt(people, r, day, time, pose); return pose.act === ACT.WORK && !pose.moving && !pose.hidden; });
}
/** What a resident says they are doing, for the card shown when spoken to. */
export function describe(people: People, r: Resident, act: number): string {
  const work = r.work >= 0 ? people.plan.lots[r.work]!.name || 'work' : '', job = JOB_NAMES[r.job];
  switch (act) {
    case ACT.COMMUTE: return `${job}, on the way to ${work || 'work'}`;
    case ACT.WORK: case ACT.INSIDE: return `${job} at ${work || 'work'}`;
    case ACT.LUNCH: return `${job}, out for lunch`;
    case ACT.STROLL: return r.job === 'free' ? 'Out for a stroll' : `${job}, off the clock`;
    case ACT.REST: return r.job === 'free' ? 'Watching the world go by' : `${job}, taking a breather`;
    case ACT.PATROL: return 'Officer of the Watch, walking the beat';
    case ACT.HOMEWARD: return `${job === 'Resident' ? 'Heading' : `${job}, heading`} home`;
    case ACT.ROUND: return r.job === 'courier' ? 'Zip Post courier, on a round' : 'Street sweeper, keeping it tidy';
    case ACT.BUSK: return 'Busker, playing for coins';
    default: return job;
  }
}
export const JOB_NAMES: Record<JobKey, string> = {
  keeper: 'Shopkeeper', clerk: 'Clerk', office: 'Office worker', officer: 'Officer of the Watch', courier: 'Courier', hand: 'Yard hand', gardener: 'Gardener', vendor: 'Stallholder', busker: 'Busker',
  sweeper: 'Street sweeper', cabbie: 'Cab driver', medic: 'Medic', crew: 'Ground crew', free: 'Resident',
};
