/**
 * The city's extras: everything a player can do something at that is not a shop counter (race starts, the spray pad, the
 * bank's alarm and vault, the lock-up, the funfair's stalls), the street race courses, the stunt ramps and the forty
 * golden feathers. All of it is a pure function of the plan, so the chunk generator, the server and every screen agree
 * on where things are without a byte being sent or saved.
 */
import { SEED_CACHE } from '../constants';
import type { Vec3 } from '../coords';
import { hash3 } from '../noise';
import { AIRFIELD, CITY, CITY_SIZE, cityPlan, crossX, crossZ, footprint, GROUND, ISLE, lotSpot, PIER, QUAY, ROOM, SHORE, STOREY, type CityPlan, type Lot } from './plan';

/** What a spot is for. `a` is its number within the kind (a course, a stall). */
export type SpotKind = 'race' | 'paint' | 'alarm' | 'vault' | 'lock' | 'stall' | 'prize';
export type Spot = { i: number; kind: SpotKind; x: number; y: number; z: number; r: number; a: number; label: string };
/** A race: where it starts (and the way the grid faces), its checkpoints in order (the last is the finish) and its length in blocks. */
export type Course = { name: string; x: number; z: number; yaw: number; points: [number, number][]; length: number };
/** A stunt ramp: its low end, the way it climbs (dx, dz a unit step), how many courses long and how wide. */
export type Ramp = { x: number; z: number; dx: number; dz: number; long: number; wide: number };
export const STALLS = ['High Striker', 'Tin Can Alley', 'Lucky Dip'] as const;
export type Extras = {
  spots: Spot[]; courses: Course[]; ramps: Ramp[]; feathers: Vec3[];
  /** The lock-up's cage (inclusive cells) and where a prisoner stands in it. */
  cage: { x0: number; z0: number; x1: number; z1: number; stand: Vec3 };
};
export const FEATHERS = 40, CHECK_REACH = 9;
/** A ramp rises one block every this many along it, to this height. */
export const RAMP_STEP = 3, rampHeight = (k: number) => Math.floor(k / RAMP_STEP) + 1;

/** Courses as intersections (kx, kz) of the street grid, starting and finishing at the first. */
const ROUTES: readonly (readonly [string, readonly (readonly [number, number])[]])[] = [
  ['Brasswick Dash', [[4, 3], [5, 3], [6, 3], [6, 4], [6, 5], [5, 5], [4, 5], [4, 4], [4, 3]]],
  ['Strand Sprint', [[1, 10], [3, 10], [5, 10], [7, 10], [9, 10], [9, 9], [7, 9], [5, 9], [3, 9], [1, 9], [1, 10]]],
  ['Grand Circuit', [[2, 2], [5, 2], [8, 2], [8, 5], [8, 8], [5, 8], [2, 8], [2, 5], [2, 2]]],
  ['Yards Rally', [[7, 1], [9, 1], [9, 3], [7, 3], [7, 5], [5, 5], [5, 3], [7, 3], [7, 1]]],
];
const YAWS = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

function build(seed: number): Extras {
  const plan = cityPlan(seed), spots: Spot[] = [], lot = (kind: Lot['kind']) => plan.lots.find(entry => entry.kind === kind)!;
  const spot = (kind: SpotKind, x: number, z: number, r: number, a: number, label: string, y = GROUND) => spots.push({ i: spots.length, kind, x, y, z, r, a, label });
  const courses = ROUTES.map(([name, route]): Course => {
    const points = route.slice(1).map(([kx, kz]): [number, number] => [crossX(kx), crossZ(kz)]), [sx, sz] = [crossX(route[0]![0]), crossZ(route[0]![1])];
    let length = 0;
    route.slice(1).forEach(([kx, kz], k) => { length += (Math.abs(kx - route[k]![0]) + Math.abs(kz - route[k]![1])) * CITY.pitch; });
    const dx = Math.sign(route[1]![0] - route[0]![0]), dz = Math.sign(route[1]![1] - route[0]![1]);
    return { name, x: sx, z: sz, yaw: YAWS[dz < 0 ? 0 : dx > 0 ? 1 : dz > 0 ? 2 : 3]!, points, length };
  });
  courses.forEach((course, a) => spot('race', course.x, course.z, 11, a, `Start the ${course.name}`));
  const garage = lot('garage'), bank = lot('bank'), watch = lot('watch'), fair = lot('fair');
  spot('paint', ...lotSpot(garage, 24, 5), 4.5, 0, 'Respray at Spray & Pray');
  const [u0, v0, u1] = footprint(bank)!, door = u0 + u1 >> 1;
  spot('alarm', ...lotSpot(bank, door + 7, v0 - 2), 2.6, 0, 'Hold the alarm bell still');
  spot('vault', ...lotSpot(bank, door, v0 + ROOM - 2), 3.2, 0, 'Crack the vault');
  // The lock-up: a cage on the Watch House forecourt, with its lock on the post beside it.
  const [cx0, cz0] = lotSpot(watch, 27, 3), [cx1, cz1] = lotSpot(watch, 32, 8), [sx, sz] = lotSpot(watch, 29, 5);
  spot('lock', ...lotSpot(watch, 25, 5), 2.4, 0, 'Work the lock');
  STALLS.forEach((name, a) => spot('stall', ...lotSpot(fair, 31 + a * 6, 4), 2.6, a, `Play ${name}`));
  spot('prize', ...lotSpot(fair, 10, 6), 3, 0, 'Swap tickets for prizes');
  // Ramps: along the north quay (heading east), down the west quay (heading south) and off the airfield's apron.
  const ramps: Ramp[] = [
    { x: CITY.x0 + 300, z: CITY.z0 - 7, dx: 1, dz: 0, long: 12, wide: 3 },
    { x: CITY.x0 - 7, z: CITY.z0 + 260, dx: 0, dz: 1, long: 12, wide: 3 },
    { x: AIRFIELD.x0 + 36, z: AIRFIELD.z0 + 300, dx: 0, dz: 1, long: 12, wide: 3 },
    { x: CITY.x0 + CITY_SIZE - 120, z: CITY.z0 + CITY_SIZE + 5, dx: -1, dz: 0, long: 12, wide: 3 },
  ];
  return { spots, courses, ramps, feathers: feathers(plan), cage: { x0: Math.floor(Math.min(cx0, cx1)), z0: Math.floor(Math.min(cz0, cz1)), x1: Math.floor(Math.max(cx0, cx1)), z1: Math.floor(Math.max(cz0, cz1)), stand: [sx + 0.5, GROUND, sz + 0.5] } };
}

/** The roof of a lot's building (feet height) and a point on it a few cells in from its back corner. */
function roofOf(lot: Lot): Vec3 {
  const [u0, v0, u1, v1] = footprint(lot)!, [x, z] = lotSpot(lot, u0 + 2 + (lot.style >>> 3) % Math.max(1, u1 - u0 - 6), v1 - 2 - (lot.style >>> 7) % Math.max(1, Math.min(6, v1 - v0 - 4)));
  return [x, GROUND + STOREY.ground + lot.floors * STOREY.upper, z];
}
/**
 * Forty feathers: sixteen on the roofs of shops and flats with a fire escape up the back, the rest tucked into the
 * city's corners. The index is the bit in a player's saved record, so the list only ever grows at its end.
 */
function feathers(plan: CityPlan): Vec3[] {
  const out: Vec3[] = [], lots = plan.lots, of = (kind: Lot['kind']) => lots.filter(lot => lot.kind === kind), at = (lot: Lot, u: number, v: number, y = 0): Vec3 => { const [x, z] = lotSpot(lot, u, v); return [x, GROUND + y, z]; };
  // Roofs: every shop has a ladder; flats too. One in a spread of blocks, chosen by the seed.
  const climbable = [...of('shop'), ...of('flats')], step = Math.floor(climbable.length / 16);
  for (let k = 0; k < 16; k++) out.push(roofOf(climbable[k * step + hash3(plan.seed, k, 7, 0xfea) % step]!));
  const hall = of('hall')[0]!, bank = of('bank')[0]!, fair = of('fair')[0]!, scrap = of('scrap')[0]!, market = of('market')[0]!, school = of('school')[0]!, hotel = of('hotel')[0]!, cinema = of('cinema')[0]!, clinic = of('clinic')[0]!, depot = of('depot')[0]!;
  const parks = of('park'), field = lots[plan.field]!, west = CITY.x0 - QUAY + 2, north = CITY.z0 - QUAY + 2, east = CITY.x0 + CITY_SIZE + QUAY - 3;
  const [bu0, bv0, bu1] = footprint(bank)!;
  out.push(
    at(hall, 24, 3), at(bank, (bu0 + bu1 >> 1) + 1, bv0 + ROOM + 3), at(fair, 24, 37, 1), at(scrap, 6, 40), at(market, 24, 24), at(school, 44, 44), at(hotel, 2, 44), at(cinema, 44, 44), at(clinic, 44, 2), at(depot, 44, 5),
    at(parks[0]!, 4, 4), at(parks[1] ?? parks[0]!, 43, 43), at(field, 20, 60), at(field, 380, 54), at(field, 135, 20),
    [west + 0.5, GROUND, north + 0.5], [east + 0.5, GROUND, north + 0.5], [west + 0.5, GROUND, SHORE - 3.5],
    [PIER.x0 + 3.5, GROUND, SHORE + PIER.d + 2.5], [CITY.x0 + 60.5, GROUND - 1, SHORE + 20.5],
    // Gull Rock: by the lighthouse door, up on its gallery, on the jetty and on the far beach.
    [ISLE.x + 4.5, GROUND + 3, ISLE.z + 0.5], [ISLE.x + 0.5, GROUND + 19, ISLE.z + 3.5], [ISLE.x + 1.5, GROUND, ISLE.z - ISLE.r - 8.5], [ISLE.x - 14.5, GROUND + 1, ISLE.z + 12.5],
  );
  return out.slice(0, FEATHERS);
}

const cache = new Map<number, Extras>();
export function cityExtras(seed: number): Extras {
  let extras = cache.get(seed);
  if (!extras) {
    if (cache.size >= SEED_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(seed, extras = build(seed));
  }
  return extras;
}
/** The spot within reach of (x, z), nearest first. */
export function spotNear(extras: Extras, x: number, y: number, z: number): Spot | undefined {
  let best: Spot | undefined, bestD = Infinity;
  for (const spot of extras.spots) { const d = Math.hypot(spot.x - x, spot.z - z); if (d <= spot.r && Math.abs(spot.y - y) < 4 && d < bestD) { best = spot; bestD = d; } }
  return best;
}
