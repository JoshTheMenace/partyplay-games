/**
 * Caper City terrain: `generateCityChunk(seed, cx, cz)` is the city's `generateChunk`. A chunk is ground, sea or beach
 * by column, then its streets and street furniture, then every lot that reaches into it (buildings.ts paints through a
 * canvas clipped to the chunk, so nothing depends on which chunk generates first). Pure and engine-exact like worldgen.
 */
import { B, makeCell } from '../blocks';
import { CHUNK_CELLS } from '../chunk';
import { CHUNK } from '../constants';
import { localIndex } from '../coords';
import { hash3 } from '../noise';
import { Canvas, paintLot } from './buildings';
import { AIRFIELD, BEACH, CITY, CITY_SIZE, cityPlan, GROUND, QUAY } from './plan';

const N = CITY.n, TOP = GROUND - 1, SEA_TOP = 62, SEABED = 56;
const ASPHALT = B.asphalt, LINE_Z = makeCell(B.asphalt, 1), LINE_X = makeCell(B.asphalt, 2), ZEBRA_Z = makeCell(B.asphalt, 3), ZEBRA_X = makeCell(B.asphalt, 4), BAY = makeCell(B.asphalt, 5);
const PAVE = B.pavement, PLAZA = makeCell(B.pavement, 1), KERB = makeCell(B.pavement, 2);
/** Rail posts joined along X (east and west) or along Z. */
const RAIL_X = makeCell(B.steel_post, 2 | 8), RAIL_Z = makeCell(B.steel_post, 1 | 4);

/** Position of a coordinate in the street grid: the corridor it is in (−1 inside a block) and its offset there, or the block and offset. */
function gridOf(local: number): { road: number; block: number; at: number } {
  const k = Math.floor(local / CITY.pitch), at = local - k * CITY.pitch;
  return at < CITY.road ? { road: k, block: -1, at } : { road: -1, block: k, at: at - CITY.road };
}
/** The pier runs south from the beach at this x for this many blocks. */
export const PIER = { x0: CITY.x0 + 6 * CITY.pitch + CITY.road + 20, w: 7, d: 78 } as const;
const SOUTH = CITY.z0 + CITY_SIZE + QUAY;
/** Land (true) or sea, and how deep into the beach a column is (0 = not beach). */
function shore(x: number, z: number): { land: boolean; beach: number } {
  const lx = x - CITY.x0, lz = z - CITY.z0, inX = lx >= -QUAY && lx < CITY_SIZE + QUAY;
  if (inX && lz >= -QUAY && lz < CITY_SIZE + QUAY) return { land: true, beach: 0 };
  if (x >= AIRFIELD.x0 - 4 && x < AIRFIELD.x0 + AIRFIELD.w + 4 && z >= AIRFIELD.z0 - 4 && z < AIRFIELD.z0 + AIRFIELD.d + 4) return { land: true, beach: 0 };
  if (inX && z >= SOUTH && z < SOUTH + BEACH) return { land: false, beach: z - SOUTH + 1 };
  return { land: false, beach: 0 };
}

/** Street furniture along one sidewalk: [offset along the block front, kind]. Trees and lamps alternate so light falls between canopies. */
const FURNITURE: readonly (readonly [number, 'lamp' | 'tree' | 'bin' | 'mailbox' | 'bench'])[] = [[2, 'lamp'], [6, 'bin'], [13, 'tree'], [24, 'lamp'], [28, 'bench'], [34, 'tree'], [38, 'mailbox'], [45, 'lamp']];

export function generateCityChunk(seed: number, cx: number, cz: number): Uint16Array {
  const cells = new Uint16Array(CHUNK_CELLS), x0 = cx * CHUNK, z0 = cz * CHUNK, layer = CHUNK * CHUNK;
  cells.fill(B.bedrock, 0, layer);
  cells.fill(B.stone, layer, layer * (SEABED - 3));
  const canvas = new Canvas(cells, x0, z0);
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const x = x0 + lx, z = z0 + lz, { land, beach } = shore(x, z);
    if (!land) {
      // The beach slopes from the promenade into the water; beyond it the seabed lies flat under six blocks of sea.
      const sand = beach ? Math.max(SEABED, TOP - (beach >> 3)) : SEABED;
      for (let y = SEABED - 3; y <= sand; y++) cells[localIndex(lx, y, lz)] = B.sand;
      for (let y = sand + 1; y <= SEA_TOP; y++) cells[localIndex(lx, y, lz)] = B.water;
      continue;
    }
    for (let y = SEABED - 3; y < TOP - 4; y++) cells[localIndex(lx, y, lz)] = B.stone;
    for (let y = TOP - 4; y < TOP; y++) cells[localIndex(lx, y, lz)] = B.dirt;
    cells[localIndex(lx, TOP, lz)] = surface(x, z);
  }
  const gx = gridOf(x0 - CITY.x0), gz = gridOf(z0 - CITY.z0), inGridX = x0 >= CITY.x0 && x0 < CITY.x0 + CITY_SIZE, inGridZ = z0 >= CITY.z0 && z0 < CITY.z0 + CITY_SIZE;
  if (inGridX && inGridZ) {
    if (gx.road >= 0 && gz.block >= 0) furnish(canvas, seed, x0, z0, gx.road, gz.block, gz.at, true);
    else if (gz.road >= 0 && gx.block >= 0) furnish(canvas, seed, x0, z0, gz.road, gx.block, gx.at, false);
    else if (gx.block >= 0 && gz.block >= 0 && gx.block < N && gz.block < N) {
      const plan = cityPlan(seed);
      for (const index of plan.blockLots[gz.block * N + gx.block]!) paintLot(canvas, plan, plan.lots[index]!);
    }
  } else edges(canvas, seed, x0, z0);
  return cells;
}

/** The paving of a land column. */
function surface(x: number, z: number): number {
  const lx = x - CITY.x0, lz = z - CITY.z0;
  if (lx < 0 || lz < 0 || lx >= CITY_SIZE || lz >= CITY_SIZE) return lz >= CITY_SIZE && lz < CITY_SIZE + QUAY && lx >= 0 && lx < CITY_SIZE ? B.oak_planks : PLAZA;
  const u = lx % CITY.pitch, v = lz % CITY.pitch, roadX = u < CITY.road, roadZ = v < CITY.road;
  if (!roadX && !roadZ) return PAVE;
  const side = (o: number) => o < 3 || o > 12;
  if (roadX && roadZ) return side(u) && side(v) ? PAVE : side(v) ? ZEBRA_Z : side(u) ? ZEBRA_X : ASPHALT;
  // Along a street: sidewalk with a kerb stone, a parking strip, and a dashed centre line between the two lanes.
  const across = roadX ? u : v, along = roadX ? v - CITY.road : u - CITY.road;
  if (side(across)) return across === 2 || across === 13 ? KERB : PAVE;
  if (across === 8) return along & 2 ? ASPHALT : roadX ? LINE_Z : LINE_X;
  return (across < 5 || across > 10) && (along === 2 || along === 13 || along === 24 || along === 35 || along === 45) ? BAY : ASPHALT;
}

/**
 * Lamps, trees, bins, mailboxes and benches on both sidewalks of the corridor chunk at (x0, z0). `vertical`: a north–south
 * avenue (corridor `road`, beside block row `block`); `start` is the chunk's offset along the block front.
 */
function furnish(c: Canvas, seed: number, x0: number, z0: number, road: number, block: number, start: number, vertical: boolean) {
  for (const [along, kind] of FURNITURE) {
    if (along < start || along >= start + CHUNK) continue;
    for (const kerb of [2, 13]) {
      const h = hash3(seed, road * 97 + block, along + kerb * 131, vertical ? 0x51de : 0x51df);
      // Every street keeps its lamps; the rest thins out by chance so no two streets look the same.
      if (kind !== 'lamp' && h % 100 >= (kind === 'tree' ? 62 : kind === 'bench' ? 40 : 34)) continue;
      // On the kerb stones, clear of the walking line down the middle of the sidewalk.
      const px = vertical ? x0 + kerb : x0 + along - start, pz = vertical ? z0 + along - start : z0 + kerb, y = GROUND;
      switch (kind) {
        case 'lamp':
          c.box(px, y, pz, px, y + 4, pz, B.steel_post);
          c.set(px, y + 5, pz, B.lantern);
          break;
        case 'tree': {
          c.set(px, y - 1, pz, B.dirt);
          c.box(px, y, pz, px, y + 3, pz, h & 256 ? B.birch_log : B.oak_log);
          const leaves = h & 256 ? B.birch_leaves : B.oak_leaves;
          c.box(px - 2, y + 3, pz - 2, px + 2, y + 4, pz + 2, leaves, true);
          c.box(px - 1, y + 5, pz - 1, px + 1, y + 6, pz + 1, leaves, true);
          break;
        }
        case 'bin': c.set(px, y, pz, B.bin); break;
        case 'mailbox': c.set(px, y, pz, B.mailbox); break;
        case 'bench':
          for (const d of [0, 1]) c.set(vertical ? px : px + d, y, vertical ? pz + d : pz, B.oak_slab);
          break;
      }
    }
  }
}

/** Chunks outside the street grid: the quay rail, the pier, the boardwalk and the airfield lot. */
function edges(c: Canvas, seed: number, x0: number, z0: number) {
  const west = CITY.x0 - QUAY, north = CITY.z0 - QUAY, east = CITY.x0 + CITY_SIZE + QUAY - 1;
  const span = (lo: number, hi: number, start: number) => [Math.max(lo, start), Math.min(hi, start + CHUNK - 1)] as const;
  // A rail along the water on the west, north and east quays (the airfield interrupts the east one, the beach is open).
  const [za, zb] = span(north, SOUTH - 1, z0), [xa, xb] = span(west, east, x0);
  if (x0 <= west && west < x0 + CHUNK) c.box(west, GROUND, za, west, GROUND, zb, RAIL_Z);
  if (z0 <= north && north < z0 + CHUNK) c.box(xa, GROUND, north, xb, GROUND, north, RAIL_X);
  if (x0 <= east && east < x0 + CHUNK) for (let z = za; z <= zb; z++) if (z < AIRFIELD.z0 - 4 || z >= AIRFIELD.z0 + AIRFIELD.d + 4) c.set(east, GROUND, z, RAIL_Z);
  // The pier: planks on posts out over the water, with a rail and a lamp every eight blocks.
  for (let z = Math.max(SOUTH, z0); z < Math.min(SOUTH + PIER.d, z0 + CHUNK); z++) {
    c.box(PIER.x0, TOP, z, PIER.x0 + PIER.w - 1, TOP, z, B.oak_planks);
    if (z % 6 === 0) for (const x of [PIER.x0, PIER.x0 + PIER.w - 1]) c.box(x, SEABED, z, x, TOP - 1, z, B.oak_log);
    for (const x of [PIER.x0, PIER.x0 + PIER.w - 1]) c.set(x, GROUND, z, z % 8 === 4 ? B.oak_log : makeCell(B.oak_fence, 1 | 4));
    if (z % 8 === 4) for (const x of [PIER.x0, PIER.x0 + PIER.w - 1]) c.set(x, GROUND + 1, z, B.lantern);
  }
  if (x0 + CHUNK > AIRFIELD.x0 && x0 < AIRFIELD.x0 + AIRFIELD.w && z0 + CHUNK > AIRFIELD.z0 && z0 < AIRFIELD.z0 + AIRFIELD.d) {
    const plan = cityPlan(seed);
    paintLot(c, plan, plan.lots[plan.lots.length - 1]!);
  }
}
