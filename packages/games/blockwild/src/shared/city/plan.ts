/**
 * Caper City's plan: the street grid, what stands on every lot, the places with a function (shops, the depot, the Watch
 * House…), the sidewalk graph residents walk, the traffic lanes and the parking bays. Everything is a pure function of the
 * seed (integer hashes and + - * / only, like worldgen) and is shared by the chunk generator, the server and every screen.
 *
 * The grid: N × N city blocks of LOT cells separated by road corridors ROAD wide, so a corridor is exactly one chunk and
 * a block is three. Corridor k lies west (north) of block k. Across a corridor: sidewalk 3, parking 2, lane 3, lane 3,
 * parking 2, sidewalk 3; traffic keeps right. The zoning map is fixed; the seed varies what is built on it.
 */
import { SEED_CACHE } from '../constants';
import { FACING, type Vec3 } from '../coords';
import { hash2, hash3 } from '../noise';

export const CITY = { x0: 1728, z0: 1728, n: 10, pitch: 64, road: 16, lot: 48 } as const;
/** Feet height of every street, sidewalk and ground floor (the top of cell GROUND − 1). */
export const GROUND = 64;
export const CITY_SIZE = CITY.n * CITY.pitch + CITY.road;
/** The island: the grid plus a quay; east of it the airfield strip, south of it the beach. */
export const QUAY = 12, AIRFIELD = { x0: CITY.x0 + CITY_SIZE + 4, z0: CITY.z0 + 96, w: 72, d: 400 } as const, BEACH = 44;
/** Where players and vehicles may be: the island and the water around it (the shared movement code clamps to this). */
export const CITY_BOUNDS = { x0: CITY.x0 - 96, z0: CITY.z0 - 96, x1: CITY.x0 + CITY_SIZE + 176, z1: CITY.z0 + CITY_SIZE + 176, top: 122 } as const;
export const inCity = (x: number, z: number) => x >= CITY_BOUNDS.x0 && x <= CITY_BOUNDS.x1 && z >= CITY_BOUNDS.z0 && z <= CITY_BOUNDS.z1;
export const clampToCity = (v: number, axis: 0 | 2) => Math.max(axis ? CITY_BOUNDS.z0 : CITY_BOUNDS.x0, Math.min(axis ? CITY_BOUNDS.z1 : CITY_BOUNDS.x1, v));

/** What a lot holds. */
export type LotKind = 'shop' | 'boutique' | 'office' | 'flats' | 'house' | 'warehouse' | 'plot' | 'park' | 'hall' | 'bank' | 'hotel' | 'clinic' | 'watch' | 'school'
  | 'market' | 'cinema' | 'fair' | 'garage' | 'depot' | 'scrap' | 'hangar';
/** Places a player can do something at. */
export type PlaceKind = 'food' | 'gizmo' | 'hardware' | 'pawn' | 'realtor' | 'cabs' | 'depot' | 'dealer' | 'scrap' | 'clinic' | 'watch' | 'bank' | 'hall' | 'airfield';
export const PLACE_KINDS: readonly PlaceKind[] = ['food', 'gizmo', 'hardware', 'pawn', 'realtor', 'cabs', 'depot', 'dealer', 'scrap', 'clinic', 'watch', 'bank', 'hall', 'airfield'];
export const DISTRICTS = ['Brasswick', 'Pennymarket', 'Quillside', 'Larkrise', 'Cinder Yards', 'Mossback Park', 'Sunny Strand', 'Gullwing Field'] as const;

/**
 * A lot: inclusive world cells, the side its front is on (0..3 = N, E, S, W, the FACING order), what stands there and a
 * style number the painters take their variety from. `floors` counts storeys above the ground floor.
 */
export type Lot = { i: number; bx: number; bz: number; x0: number; z0: number; x1: number; z1: number; face: number; kind: LotKind; floors: number; style: number; place: number; name: string };
/**
 * A place: where its keeper stands (`counter`), where a customer stands (`front`), the doorway cell and the sidewalk
 * point outside it; `board` is its job board block and `till` its cash till (cell coordinates), when it has them.
 */
export type Place = { i: number; kind: PlaceKind; lot: number; name: string; door: [number, number]; walk: [number, number]; counter: [number, number]; front: [number, number]; board?: Vec3; till?: Vec3 };
/** A parking bay: where a parked vehicle's centre sits, its heading and what the seed parked there (kind −1 = empty). */
export type Bay = { x: number; z: number; yaw: number; kind: number; paint: number };
/** A sidewalk corner: block (bx, bz), corner 0..3 = NW, NE, SE, SW. */
export type Corner = { x: number; z: number };
/** A buildable plot: the lot it is in and its inclusive build box. */
export type Plot = { lot: number; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number };

export type CityPlan = {
  seed: number; lots: Lot[]; places: Place[]; bays: Bay[]; plots: Plot[];
  /** Lots of each block (index bz * N + bx). */
  blockLots: number[][];
  /** Where a new player stands: the middle of the town hall plaza. */
  spawn: Vec3;
  /** The Watch House steps and the clinic door: where the caught and the knocked-out wake up. */
  jail: Vec3; clinic: Vec3;
  /** Places by kind. */
  byKind(kind: PlaceKind): Place[];
};

const N = CITY.n;
/** West (north) edge of block b's interior, and of corridor k. */
export const blockAt = (b: number) => b * CITY.pitch + CITY.road;
export const blockX = (bx: number) => CITY.x0 + blockAt(bx);
export const blockZ = (bz: number) => CITY.z0 + blockAt(bz);
/** Centre of intersection (kx, kz) of corridors, k in 0..N. */
export const crossX = (kx: number) => CITY.x0 + kx * CITY.pitch + CITY.road / 2;
export const crossZ = (kz: number) => CITY.z0 + kz * CITY.pitch + CITY.road / 2;

/**
 * The zoning map, north row first. H houses, A flats, S shops, O offices, I warehouses, PK park, PL plots, and one-block
 * landmarks: TH town hall plaza, BK bank, HO hotel, CL clinic, PD Watch House, SC school, MK market, CI cinema, FR fairground,
 * GA garage and dealer, DP Zip Post depot, SY scrapyard.
 */
const ZONES = [
  'H  H  H  A  A  S  A  I  I  I ',
  'H  PL H  A  S  S  O  GA DP I ',
  'H  H  A  S  O  O  O  S  SY I ',
  'A  A  S  O  TH BK O  S  A  I ',
  'A  S  O  PK HO O  CL S  A  A ',
  'SC S  O  PK O  PD S  A  A  H ',
  'H  A  S  S  O  S  MK A  H  H ',
  'H  PL A  S  CI S  A  A  H  PL',
  'H  H  A  A  S  S  A  H  H  H ',
  'H  H  A  FR S  A  S  A  H  H ',
].map(row => row.match(/\S+/g)!);
export const zoneAt = (bx: number, bz: number) => ZONES[bz]?.[bx] ?? '';
const LANDMARK: Record<string, [LotKind, PlaceKind | null, string]> = {
  TH: ['hall', 'hall', 'Town Hall'], BK: ['bank', 'bank', 'Brasswick Savings'], HO: ['hotel', null, 'The Gilded Pigeon Hotel'], CL: ['clinic', 'clinic', 'Patch-Up Clinic'],
  PD: ['watch', 'watch', 'The Watch House'], SC: ['school', null, 'Larkrise School'], MK: ['market', 'food', 'Pennymarket Square'], CI: ['cinema', null, 'The Flicker Palace'],
  FR: ['fair', null, 'Strand Funfair'], GA: ['garage', 'dealer', 'Wheel Deal Motors'], DP: ['depot', 'depot', 'Zip Post Depot'], SY: ['scrap', 'scrap', 'Scrap & Swap'], PK: ['park', null, 'Mossback Park'],
};
/** District of a block, for names and the map. */
export function districtAt(bx: number, bz: number): typeof DISTRICTS[number] {
  const zone = zoneAt(bx, bz);
  if (zone === 'PK') return 'Mossback Park';
  if (zone === 'I' || zone === 'DP' || zone === 'SY' || zone === 'GA') return 'Cinder Yards';
  if (zone === 'O' || zone === 'TH' || zone === 'BK' || zone === 'HO' || zone === 'PD' || zone === 'CL') return 'Brasswick';
  if (zone === 'S' || zone === 'MK' || zone === 'CI') return bz >= 8 ? 'Sunny Strand' : 'Pennymarket';
  if (zone === 'FR') return 'Sunny Strand';
  return zone === 'A' ? 'Quillside' : 'Larkrise';
}

// Lot geometry ---------------------------------------------------------------------------------------------------------
/** Width of a lot along its front and its depth behind it. */
export const lotWidth = (lot: Lot) => lot.face % 2 ? lot.z1 - lot.z0 + 1 : lot.x1 - lot.x0 + 1;
export const lotDepth = (lot: Lot) => lot.face % 2 ? lot.x1 - lot.x0 + 1 : lot.z1 - lot.z0 + 1;
/** World cell of a lot's local (u, v): u runs along the front, v from the front line into the lot. */
export function lotCell(lot: Lot, u: number, v: number): [number, number] {
  switch (lot.face) {
    case 0: return [lot.x0 + u, lot.z0 + v];
    case 1: return [lot.x1 - v, lot.z0 + u];
    case 2: return [lot.x1 - u, lot.z1 - v];
    default: return [lot.x0 + v, lot.z1 - u];
  }
}
/** Centre of local cell (u, v) as a standing point. */
export const lotSpot = (lot: Lot, u: number, v: number): [number, number] => { const [x, z] = lotCell(lot, u, v); return [x + 0.5, z + 0.5]; };
export const lotAt = (plan: CityPlan, x: number, z: number): Lot | undefined => {
  const bx = Math.floor((x - CITY.x0 - CITY.road) / CITY.pitch), bz = Math.floor((z - CITY.z0 - CITY.road) / CITY.pitch);
  if (bx < 0 || bz < 0 || bx >= N || bz >= N) return undefined;
  return plan.blockLots[bz * N + bx]!.map(i => plan.lots[i]!).find(lot => x >= lot.x0 && x <= lot.x1 + 1 && z >= lot.z0 && z <= lot.z1 + 1);
};

/**
 * Where a lot's building stands, in lot-local cells: `setback` rows of forecourt in front of it, `margin` free columns
 * on each side and `depth` rows deep (0 = to the back of the lot less the margin). Open-air lots have no entry.
 */
const SHAPES: Partial<Record<LotKind, readonly [setback: number, margin: number, depth: number]>> = {
  shop: [1, 0, 15], boutique: [1, 0, 15], office: [2, 1, 0], flats: [3, 1, 0], house: [5, 2, 11], warehouse: [6, 2, 14], hall: [26, 6, 20], bank: [5, 6, 36],
  hotel: [6, 4, 36], clinic: [8, 5, 30], watch: [11, 6, 30], school: [11, 4, 26], cinema: [3, 4, 38], garage: [14, 2, 30], depot: [12, 2, 32], scrap: [8, 15, 10],
};
/** The building's local box [u0, v0, u1, v1] (inclusive), or null for open-air lots (parks, plots, the market, the fair). */
export function footprint(lot: Lot): [number, number, number, number] | null {
  const shape = SHAPES[lot.kind];
  // The airfield's building is its small terminal by the gate.
  if (lot.kind === 'hangar') return [60, 4, 83, 16];
  if (!shape) return null;
  const [setback, margin, depth] = shape, w = lotWidth(lot), d = lotDepth(lot);
  return [margin, setback, w - 1 - margin, depth ? setback + depth - 1 : d - 1 - margin];
}
/**
 * The sidewalk point outside a lot's door: two blocks out from its front edge, on the walking line round its block.
 * The airfield's is across the last avenue from its gate.
 */
export function lotWalk(lot: Lot): [number, number] {
  const [x, z] = lotCell(lot, layoutOf(lot).door[0], 0);
  if (lot.kind === 'hangar') return [blockX(CITY.n - 1) + CITY.lot + 1.5, z + 0.5];
  const [dx, dz] = FACING[lot.face]!;
  return [x + 0.5 + dx * 2, z + 0.5 + dz * 2];
}
/** Depth of the room behind a building's door, and the storey heights (ground floor, then each floor above). */
export const ROOM = 11, STOREY = { ground: 5, upper: 4 } as const;
/**
 * Where things stand in a lot (local cells): the doorway (two cells wide: `door` and the cell to its right), the counter
 * row with the keeper behind it and the customer before it, the till on the counter and the job board on the front wall.
 * Open-air lots keep their counter in the middle of the ground.
 */
export function layoutOf(lot: Lot) {
  const box = footprint(lot), w = lotWidth(lot);
  if (!box) { const u = w >> 1, v = lotDepth(lot) >> 1; return { door: [u, 0] as const, counterV: v, keeper: [u, v + 1] as const, customer: [u, v - 2] as const, till: [u + 1, v] as const, board: [u + 3, v] as const }; }
  const u = (box[0] + box[2]) >> 1, v = box[1];
  return { door: [u, v] as const, counterV: v + 7, keeper: [u, v + 8] as const, customer: [u, v + 5] as const, till: [u + 1, v + 7] as const, board: [u + 3, v] as const };
}

// Names ----------------------------------------------------------------------------------------------------------------
const SHOP_NAMES: Record<string, readonly string[]> = {
  food: ['Big Spoon Diner', 'Crumb & Co.', 'The Noodle Nook', 'Hot Plate', 'Dough Re Mi', 'Sip & Dip Café', 'Pickle Parlour', 'The Toasty Goat', 'Fork Yeah', 'Gravy Train', 'Bun Intended', 'Soup Loop'],
  gizmo: ['Gizmo & Daughters', 'Whatsit Works', 'The Gadget Hatch', 'Sprocket Pocket'],
  hardware: ['Bricks & Bits', 'Nuts About Bolts', 'The Plank Bank', 'Hammer Time Supply'],
  pawn: ['Second Chance Pawn', 'Odd Lots', 'The Magpie Nest', 'No Questions Emporium'],
  realtor: ['Keys & Deeds', 'Nook & Cranny Homes', 'Front Door Friends'],
  cabs: ['Hopper Cabs', 'Zig Zag Taxi', 'Beeline Cabs'],
  boutique: ['Thimble & Thread', 'Petal Pushers', 'The Sock Drawer', 'Ink & Quill Books', 'Snip Snip Barbers', 'Tick Tock Clocks', 'Hat Trick', 'Button Moon', 'The Kite Cupboard', 'Wobbly Records',
    'Fern & Fable', 'Mitten Kitten Knits', 'Lamp Champ', 'The Candle Corner', 'Bubble & Scrub Laundry', 'Teacup Antiques'],
};
const pickName = (list: readonly string[], seed: number, a: number, b: number) => list[hash3(seed, a, b, 0x7a3) % list.length]!;

// Planning -------------------------------------------------------------------------------------------------------------
/** The functional shop kinds a shop block must hold, in the order its lots take them (the rest are boutiques). */
const SHOP_MIX: readonly PlaceKind[] = ['gizmo', 'hardware', 'cabs', 'pawn', 'realtor'];
/** Vehicle kinds the seed parks at the kerb, weighted towards the small ones (indexes into shared/city/vehicles.ts). */
const PARKED: readonly number[] = [1, 1, 1, 0, 2, 3, 1, 6, 5, 0, 2, 1];

function build(seed: number): CityPlan {
  const lots: Lot[] = [], places: Place[] = [], plots: Plot[] = [], blockLots: number[][] = [];
  const addLot = (bx: number, bz: number, lx0: number, lz0: number, lx1: number, lz1: number, face: number, kind: LotKind, floors: number, name = ''): Lot => {
    const lot: Lot = { i: lots.length, bx, bz, x0: blockX(bx) + lx0, z0: blockZ(bz) + lz0, x1: blockX(bx) + lx1, z1: blockZ(bz) + lz1, face, kind, floors, style: hash3(seed, bx * 64 + lx0, bz * 64 + lz0, 0x51) >>> 0, place: -1, name };
    lots.push(lot);
    blockLots[bz * N + bx]!.push(lot.i);
    return lot;
  };
  /** A place in a lot. Its sidewalk point is straight out from the doorway (the lot's front edge is the block's edge). */
  const addPlace = (lot: Lot, kind: PlaceKind, name: string, board = false): Place => {
    const layout = layoutOf(lot), till = lotCell(lot, layout.till[0], layout.till[1]);
    const place: Place = {
      i: places.length, kind, lot: lot.i, name, door: lotCell(lot, layout.door[0], layout.door[1]), walk: lotWalk(lot),
      counter: lotSpot(lot, layout.keeper[0], layout.keeper[1]), front: lotSpot(lot, layout.customer[0], layout.customer[1]), till: [till[0], GROUND + 1, till[1]],
    };
    if (board) { const at = lotCell(lot, layout.board[0], layout.board[1]); place.board = [at[0], GROUND + 1, at[1]]; }
    lot.place = place.i;
    lot.name = name;
    places.push(place);
    return place;
  };
  /** Three lots along the north side and three along the south (16 × 22 each), with a service alley between. */
  const rows = (bx: number, bz: number, each: (lx0: number, lz0: number, lx1: number, lz1: number, face: number, slot: number) => void) => {
    for (let k = 0; k < 3; k++) each(k * 16, 0, k * 16 + 15, 21, 0, k);
    for (let k = 0; k < 3; k++) each(k * 16, 26, k * 16 + 15, 47, 2, 3 + k);
  };
  let shopBlocks = 0;
  for (let bz = 0; bz < N; bz++) for (let bx = 0; bx < N; bx++) {
    blockLots[bz * N + bx] = [];
    const zone = zoneAt(bx, bz), h = hash2(seed + 7, bx, bz), mark = LANDMARK[zone];
    if (mark) {
      const [kind, use, name] = mark, face = zone === 'PD' || zone === 'CL' || zone === 'GA' ? 3 : zone === 'DP' || zone === 'SY' ? 2 : zone === 'BK' ? 3 : 0;
      const lot = addLot(bx, bz, 0, 0, 47, 47, face, kind, kind === 'hotel' ? 9 : kind === 'bank' ? 3 : 1, name);
      // The depot, the town hall (parcels to post from the plaza) and the market carry job boards.
      if (use) addPlace(lot, use, name, zone === 'DP' || zone === 'TH' || zone === 'MK');
      continue;
    }
    switch (zone) {
      case 'S': {
        const block = shopBlocks++;
        rows(bx, bz, (lx0, lz0, lx1, lz1, face, slot) => {
          // Every shop block has food and two more trades; which ones turns with the block, so each district has them all.
          const use = slot === 0 ? 'food' : slot === 4 ? SHOP_MIX[(block * 2 + 1) % SHOP_MIX.length]! : slot === 2 ? SHOP_MIX[(block * 2 + 2) % SHOP_MIX.length]! : null;
          const lot = addLot(bx, bz, lx0, lz0, lx1, lz1, face, use ? 'shop' : 'boutique', 1 + hash3(seed, bx, bz, slot) % 3);
          if (use) addPlace(lot, use, pickName(SHOP_NAMES[use]!, seed, lot.i, block), use === 'food' || use === 'cabs');
          else lot.name = pickName(SHOP_NAMES.boutique!, seed, lot.i, 3);
        });
        break;
      }
      case 'O':
        if (h & 1) for (const [lz0, face] of [[0, 0], [26, 2]] as const) addLot(bx, bz, 0, lz0, 47, lz0 + 21, face, 'office', 6 + hash3(seed, bx, bz, lz0) % 8);
        else for (const [lx0, lz0, face] of [[0, 0, 0], [26, 0, 0], [0, 26, 2], [26, 26, 2]] as const) addLot(bx, bz, lx0, lz0, lx0 + 21, lz0 + 21, face, 'office', 5 + hash3(seed, bx + lx0, bz, lz0) % 9);
        break;
      case 'A':
        if (h & 1) for (const [lz0, face] of [[0, 0], [28, 2]] as const) addLot(bx, bz, 0, lz0, 47, lz0 + 19, face, 'flats', 3 + hash3(seed, bx, bz, lz0) % 4);
        else for (const [lx0, lz0, face] of [[0, 0, 0], [26, 0, 0], [0, 26, 2], [26, 26, 2]] as const) addLot(bx, bz, lx0, lz0, lx0 + 21, lz0 + 21, face, 'flats', 3 + hash3(seed, bx + lx0, bz, lz0) % 5);
        break;
      case 'H': rows(bx, bz, (lx0, lz0, lx1, lz1, face, slot) => { addLot(bx, bz, lx0, lz0, lx1, lz1, face, 'house', hash3(seed, bx, bz, slot) % 2); }); break;
      case 'I': for (const [lz0, face] of [[0, 0], [26, 2]] as const) addLot(bx, bz, 0, lz0, 47, lz0 + 21, face, 'warehouse', 1); break;
      case 'PL':
        for (const [lx0, lz0, face] of [[0, 0, 0], [26, 0, 0], [0, 26, 2], [26, 26, 2]] as const) {
          const lot = addLot(bx, bz, lx0, lz0, lx0 + 21, lz0 + 21, face, 'plot', 0, `Plot ${plots.length + 1}`);
          plots.push({ lot: lot.i, x0: lot.x0 + 5, z0: lot.z0 + 5, x1: lot.x0 + 16, z1: lot.z0 + 16, y0: GROUND - 1, y1: GROUND + 22 });
        }
        break;
    }
  }
  // The airfield is a lot of its own outside the grid (its hangar faces the avenue to its west).
  blockLots.push([]);
  const field: Lot = { i: lots.length, bx: N, bz: 2, x0: AIRFIELD.x0, z0: AIRFIELD.z0, x1: AIRFIELD.x0 + AIRFIELD.w - 1, z1: AIRFIELD.z0 + AIRFIELD.d - 1, face: 3, kind: 'hangar', floors: 1, style: hash2(seed, 0xa1, 0xf1), place: -1, name: 'Gullwing Field' };
  lots.push(field);
  blockLots[N * N]!.push(field.i);
  const gate = layoutOf(field);
  places.push({ i: places.length, kind: 'airfield', lot: field.i, name: field.name, door: lotCell(field, gate.door[0], gate.door[1]), walk: lotWalk(field),
    counter: lotSpot(field, gate.keeper[0], gate.keeper[1]), front: lotSpot(field, gate.customer[0], gate.customer[1]) });
  field.place = places.length - 1;

  // Parking bays: four along each side of every road segment, plus the bays at places (fixed kinds).
  const bays: Bay[] = [];
  const park = (x: number, z: number, yaw: number, district: string) => {
    const h = hash3(seed, Math.floor(x), Math.floor(z), 0xca7), full = h % 100 < (district === 'Brasswick' || district === 'Pennymarket' ? 16 : district === 'Cinder Yards' ? 12 : 9);
    bays.push({ x, z, yaw, kind: full ? PARKED[(h >>> 8) % PARKED.length]! : -1, paint: (h >>> 16) % 8 });
  };
  for (let k = 0; k <= N; k++) for (let b = 0; b < N; b++) for (const along of [8, 19, 29, 40]) {
    const district = districtAt(Math.min(N - 1, k), b), cx = CITY.x0 + k * CITY.pitch, cz = CITY.z0 + k * CITY.pitch;
    // North–south corridor k beside block row b: southbound bays on the west strip, northbound on the east.
    park(cx + 4, blockZ(b) + along, Math.PI, district);
    park(cx + 12, blockZ(b) + along, 0, district);
    // East–west corridor k beside block column b: westbound on the north strip, eastbound on the south.
    park(blockX(b) + along, cz + 4, Math.PI / 2, districtAt(b, Math.min(N - 1, k)));
    park(blockX(b) + along, cz + 12, -Math.PI / 2, districtAt(b, Math.min(N - 1, k)));
  }
  /** Bays on a place's forecourt (lot-local cells), nose towards the street. */
  const fixed = (place: Place | undefined, kind: number, offsets: readonly (readonly [number, number])[], paint = 0) => {
    if (!place) return;
    const lot = lots[place.lot]!;
    for (const [u, v] of offsets) { const [x, z] = lotSpot(lot, u, v); bays.push({ x, z, yaw: [0, -Math.PI / 2, Math.PI, Math.PI / 2][lot.face]!, kind, paint }); }
  };
  const first = (kind: PlaceKind) => places.find(place => place.kind === kind);
  fixed(first('watch'), 7, [[5, 4], [10, 4], [38, 4]]);
  fixed(first('depot'), 3, [[6, 5], [11, 5]], 2);
  fixed(first('dealer'), 5, [[6, 6]], 1);
  fixed(first('dealer'), 6, [[12, 6]], 3);
  fixed(first('dealer'), 0, [[36, 6]], 4);
  fixed(first('dealer'), 2, [[42, 6]], 5);
  fixed(first('clinic'), 3, [[6, 3]], 5);
  for (const cab of places.filter(place => place.kind === 'cabs')) {
    // A cab stand claims the two kerb bays nearest its door for cabs.
    const near = bays.map((bay, index) => ({ index, d: Math.hypot(bay.x - cab.walk[0], bay.z - cab.walk[1]) })).sort((a, b) => a.d - b.d).slice(0, 2);
    for (const { index } of near) Object.assign(bays[index]!, { kind: 4, paint: 0 });
  }
  // Two scooters wait on the plaza either side of where everyone starts: wheels within a few steps of the first minute.
  const hall = lots.find(lot => lot.kind === 'hall')!;
  for (const u of [18, 31]) { const [x, z] = lotSpot(hall, u, 12); bays.push({ x, z, yaw: [0, -Math.PI / 2, Math.PI, Math.PI / 2][hall.face]!, kind: 0, paint: u & 7 }); }
  // The airfield: a helicopter on each pad and a plane outside each hangar, noses north along the apron.
  for (const [u, v, kind, paint] of [[14, 24, 8, 0], [44, 24, 8, 2], [135, 37, 9, 1], [215, 37, 9, 3]] as const) { const [x, z] = lotSpot(field, u, v); bays.push({ x, z, yaw: 0, kind, paint }); }

  const watch = first('watch')!, clinic = first('clinic')!, [sx, sz] = lotSpot(hall, 24, 12);
  const kinds = new Map<PlaceKind, Place[]>();
  for (const place of places) kinds.set(place.kind, [...kinds.get(place.kind) ?? [], place]);
  return {
    seed, lots, places, bays, plots, blockLots,
    spawn: [sx, GROUND, sz], jail: [watch.walk[0], GROUND, watch.walk[1]], clinic: [clinic.walk[0], GROUND, clinic.walk[1]],
    byKind: kind => kinds.get(kind) ?? [],
  };
}

const plans = new Map<number, CityPlan>();
/** The city of a seed (planned once and kept for as many worlds as a hub runs). */
export function cityPlan(seed: number): CityPlan {
  let plan = plans.get(seed);
  if (!plan) {
    if (plans.size >= SEED_CACHE) plans.delete(plans.keys().next().value!);
    plans.set(seed, plan = build(seed));
  }
  return plan;
}

// Sidewalks ------------------------------------------------------------------------------------------------------------
/** Sidewalk corner nodes: block (bx, bz) × corner 0..3 (NW, NE, SE, SW), 1.5 blocks outside the block's edges. */
export const NODES = N * N * 4;
export const nodeOf = (bx: number, bz: number, corner: number) => (bz * N + bx) * 4 + corner;
export function nodeAt(node: number, out: Corner = { x: 0, z: 0 }): Corner {
  const corner = node & 3, block = node >> 2, bx = block % N, bz = (block - bx) / N, east = corner === 1 || corner === 2, south = corner >= 2;
  out.x = blockX(bx) + (east ? CITY.lot + 1.5 : -1.5);
  out.z = blockZ(bz) + (south ? CITY.lot + 1.5 : -1.5);
  return out;
}
const AROUND = CITY.lot + 3, ACROSS = CITY.road - 3;
/** Neighbours of a corner: the two along its own block, and the crosswalks to the blocks beside it. */
function* links(node: number): Generator<[number, number]> {
  const corner = node & 3, block = node >> 2, bx = block % N, bz = (block - bx) / N;
  yield [(node & ~3) | (corner + 1 & 3), AROUND];
  yield [(node & ~3) | (corner + 3 & 3), AROUND];
  const east = corner === 1 || corner === 2, south = corner >= 2, nx = bx + (east ? 1 : -1), nz = bz + (south ? 1 : -1);
  // Across the avenue: the mirrored corner of the block to the east or west; across the street: to the north or south.
  if (nx >= 0 && nx < N) yield [nodeOf(nx, bz, [1, 0, 3, 2][corner]!), ACROSS];
  if (nz >= 0 && nz < N) yield [nodeOf(bx, nz, [3, 2, 1, 0][corner]!), ACROSS];
}
type Tree = { dist: Float32Array; prev: Int16Array };
const trees = new Map<number, Tree>();
/** Shortest walks from a corner to every other (Dijkstra over 400 nodes, kept per source). */
function treeFrom(source: number): Tree {
  let tree = trees.get(source);
  if (tree) return tree;
  const dist = new Float32Array(NODES).fill(Infinity), prev = new Int16Array(NODES).fill(-1), open = [source];
  dist[source] = 0;
  // The frontier of this lattice stays a few dozen nodes wide, so the nearest is found by looking through it.
  while (open.length) {
    let at = 0;
    for (let k = 1; k < open.length; k++) if (dist[open[k]!]! < dist[open[at]!]!) at = k;
    const best = open[at]!;
    open[at] = open[open.length - 1]!;
    open.pop();
    for (const [next, cost] of links(best)) if (dist[best]! + cost < dist[next]!) { if (dist[next] === Infinity) open.push(next); dist[next] = dist[best]! + cost; prev[next] = best; }
  }
  if (trees.size > 512) trees.delete(trees.keys().next().value!);
  trees.set(source, tree = { dist, prev });
  return tree;
}
/** The two corners at the ends of the sidewalk a point stands on (the block side nearest to it), and that block. */
function sideOf(x: number, z: number): [number, number] {
  const bx = Math.max(0, Math.min(N - 1, Math.floor((x - CITY.x0 - CITY.road / 2) / CITY.pitch))), bz = Math.max(0, Math.min(N - 1, Math.floor((z - CITY.z0 - CITY.road / 2) / CITY.pitch)));
  const lx = x - blockX(bx), lz = z - blockZ(bz), gaps = [lz + 1.5, CITY.lot + 1.5 - lx, CITY.lot + 1.5 - lz, lx + 1.5].map(Math.abs);
  const side = gaps.indexOf(Math.min(...gaps));
  return [nodeOf(bx, bz, side), nodeOf(bx, bz, side + 1 & 3)];
}
const gap = (x: number, z: number, node: number, c = nodeAt(node)) => Math.abs(c.x - x) + Math.abs(c.z - z);
/**
 * A walk along the sidewalks from one sidewalk point to another, as a flat [x, z, …] list that starts and ends at the
 * given points. Both must lie on a block's sidewalk loop (a place's `walk` point does).
 */
export function sidewalkPath(ax: number, az: number, bx: number, bz: number): number[] {
  const from = sideOf(ax, az), to = sideOf(bx, bz), path = [ax, az];
  // Same stretch of sidewalk: straight there.
  if (from[0] === to[0] && from[1] === to[1]) return [ax, az, bx, bz];
  let best = Infinity, start = from[0], end = to[0];
  for (const a of from) for (const b of to) {
    const total = gap(ax, az, a) + treeFrom(a).dist[b]! + gap(bx, bz, b);
    if (total < best) { best = total; start = a; end = b; }
  }
  const nodes: number[] = [], prev = treeFrom(start).prev;
  for (let node = end; node >= 0; node = node === start ? -1 : prev[node]!) nodes.push(node);
  const c: Corner = { x: 0, z: 0 };
  for (let i = nodes.length - 1; i >= 0; i--) { nodeAt(nodes[i]!, c); path.push(c.x, c.z); }
  path.push(bx, bz);
  return path;
}
/** The point of the nearest sidewalk loop to (x, z): where someone standing anywhere joins the sidewalks. */
export function nearestSidewalk(x: number, z: number): [number, number] {
  const [a, b] = sideOf(x, z), p = nodeAt(a), q = nodeAt(b), along = p.x === q.x;
  return along ? [p.x, Math.max(Math.min(p.z, q.z), Math.min(Math.max(p.z, q.z), z))] : [Math.max(Math.min(p.x, q.x), Math.min(Math.max(p.x, q.x), x)), p.z];
}
export const pathLength = (path: readonly number[]) => { let total = 0; for (let i = 2; i < path.length; i += 2) total += Math.hypot(path[i]! - path[i - 2]!, path[i + 1]! - path[i - 1]!); return total; };
