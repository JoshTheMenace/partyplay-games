/**
 * Sky and block light (0..15) by breadth-first flood fill.
 *
 * Light never travels more than 15 blocks, so computing it over the 3×3 chunks around a chunk (a 48×48 "region")
 * gives exact values for that chunk plus a one-block border. Every chunk is lit the same way from its own region,
 * so neighbouring chunks always agree at their shared borders without any cross-chunk bookkeeping.
 *
 * Arrays have two extra layers: layer 0 is bedrock (y = -1) and the last layer is open sky (y = 128).
 */
import { B } from '../../shared/blocks';
import { CHUNK, HEIGHT } from '../../shared/constants';
import { EMIT, FILTER_CELL } from './tables';

/** Region width in cells (3 chunks), cells per layer, layers (HEIGHT + floor + ceiling). */
export const RX = 3 * CHUNK, RA = RX * RX, RL = HEIGHT + 2, REGION_CELLS = RA * RL;
/** Padded chunk volume used by the mesher: 18 × 18 cells (chunk ± 1) × RL layers. */
export const PX = CHUNK + 2, PA = PX * PX, VOLUME_CELLS = PA * RL;
/** Index in a padded volume for chunk-local x, z in -1..16 and y in -1..128. */
export const volumeIndex = (x: number, y: number, z: number) => x + 1 + PX * (z + 1 + PX * (y + 1));

/** Growable FIFO ring of cell indices. */
class IndexQueue {
  private data = new Int32Array(1 << 18);
  private head = 0;
  private tail = 0;
  get empty() { return this.head === this.tail; }
  push(index: number) {
    const { data } = this;
    data[this.tail] = index;
    this.tail = (this.tail + 1) & (data.length - 1);
    if (this.tail !== this.head) return;
    // Full: unroll into a ring twice the size.
    const bigger = new Int32Array(data.length * 2);
    bigger.set(data.subarray(this.head));
    bigger.set(data.subarray(0, this.head), data.length - this.head);
    this.head = 0;
    this.tail = data.length;
    this.data = bigger;
  }
  pop() {
    const index = this.data[this.head]!;
    this.head = (this.head + 1) & (this.data.length - 1);
    return index;
  }
}

export type Region = { cells: Uint16Array; sky: Uint8Array; block: Uint8Array; heights: Int16Array; top: number; queue: IndexQueue };
/** Cells and light of one chunk plus a one-block border, ready for meshing. */
export type Volume = { cells: Uint16Array; sky: Uint8Array; block: Uint8Array };

export const newRegion = (): Region => ({
  cells: new Uint16Array(REGION_CELLS), sky: new Uint8Array(REGION_CELLS), block: new Uint8Array(REGION_CELLS),
  heights: new Int16Array(RA), top: 0, queue: new IndexQueue(),
});
export const newVolume = (): Volume => ({ cells: new Uint16Array(VOLUME_CELLS), sky: new Uint8Array(VOLUME_CELLS), block: new Uint8Array(VOLUME_CELLS) });

/** Copies the 3×3 chunks centred on (cx, cz) into the region. `chunkAt` returns null outside the world (barrier). */
export function fillRegion(region: Region, cx: number, cz: number, chunkAt: (cx: number, cz: number) => Uint16Array | null) {
  const { cells } = region;
  let top = 1;
  cells.fill(B.bedrock, 0, RA);
  cells.fill(B.air, REGION_CELLS - RA);
  for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
    const chunk = chunkAt(cx + dx - 1, cz + dz - 1), x0 = dx * CHUNK, z0 = dz * CHUNK;
    for (let y = 0; y < HEIGHT; y++) for (let lz = 0; lz < CHUNK; lz++) {
      const dst = x0 + RX * (z0 + lz + RX * (y + 1));
      if (!chunk) { cells.fill(B.barrier, dst, dst + CHUNK); continue; }
      const src = CHUNK * (lz + CHUNK * y);
      let any = 0;
      for (let lx = 0; lx < CHUNK; lx++) any |= cells[dst + lx] = chunk[src + lx]!;
      if (any && y + 1 > top) top = y + 1;
    }
  }
  region.top = top;
}

function flood(region: Region, light: Uint8Array) {
  const { cells, queue } = region;
  while (!queue.empty) {
    const i = queue.pop(), level = light[i]!;
    if (level <= 1) continue;
    const x = i % RX, rest = (i - x) / RX, z = rest % RX, layer = (rest - z) / RX;
    for (let side = 0; side < 6; side++) {
      let n: number;
      if (side === 0) { if (x === 0) continue; n = i - 1; }
      else if (side === 1) { if (x === RX - 1) continue; n = i + 1; }
      else if (side === 2) { if (z === 0) continue; n = i - RX; }
      else if (side === 3) { if (z === RX - 1) continue; n = i + RX; }
      else if (side === 4) { if (layer <= 1) continue; n = i - RA; }
      else { if (layer >= RL - 2) continue; n = i + RA; }
      const filter = FILTER_CELL[cells[n]!]!;
      if (filter >= 15) continue;
      const value = level - 1 - filter;
      if (value > light[n]!) {
        light[n] = value;
        queue.push(n);
      }
    }
  }
}

/** Computes sky and block light for the whole region (exact for the centre chunk and its one-block border). */
export function computeLight(region: Region) {
  const { cells, sky, block, heights, top, queue } = region;
  sky.fill(15);
  sky.fill(0, 0, RA);
  block.fill(0);
  // Sky: straight down without loss through air, losing `filter` through leaves/water; heights = lowest full-sky layer.
  for (let column = 0; column < RA; column++) {
    let level = 15, height = top + 1;
    for (let layer = top; layer >= 1; layer--) {
      const i = column + layer * RA;
      if (level > 0) {
        const filter = FILTER_CELL[cells[i]!]!;
        level = filter >= 15 ? 0 : Math.max(0, level - filter);
      }
      sky[i] = level;
      if (level === 15) height = layer;
    }
    heights[column] = height;
  }
  // Seed only cells that can brighten a neighbour: below the highest neighbouring full-sky layer, while still lit.
  for (let z = 0; z < RX; z++) for (let x = 0; x < RX; x++) {
    const column = x + RX * z;
    let start = heights[column]!;
    if (x > 0) start = Math.max(start, heights[column - 1]!);
    if (x < RX - 1) start = Math.max(start, heights[column + 1]!);
    if (z > 0) start = Math.max(start, heights[column - RX]!);
    if (z < RX - 1) start = Math.max(start, heights[column + RX]!);
    for (let layer = Math.min(start, RL - 2) - 1; layer >= 1; layer--) {
      const i = column + layer * RA, level = sky[i]!;
      if (level < 2) break;
      if (brightens(cells, sky, i - RA, level) || x > 0 && brightens(cells, sky, i - 1, level) || x < RX - 1 && brightens(cells, sky, i + 1, level)
        || z > 0 && brightens(cells, sky, i - RX, level) || z < RX - 1 && brightens(cells, sky, i + RX, level)) queue.push(i);
    }
  }
  flood(region, sky);
  for (let i = RA; i < (top + 1) * RA; i++) {
    const emit = EMIT[cells[i]! & 255]!;
    if (emit) {
      block[i] = emit;
      queue.push(i);
    }
  }
  flood(region, block);
}
const brightens = (cells: Uint16Array, light: Uint8Array, n: number, level: number) => {
  const filter = FILTER_CELL[cells[n]!]!;
  return filter < 15 && light[n]! < level - 1 - filter;
};

/** Copies the centre chunk plus a one-block border (cells and light) into a mesh volume. */
export function extractVolume(region: Region, out: Volume) {
  for (let layer = 0; layer < RL; layer++) for (let z = 0; z < PX; z++) {
    const src = CHUNK - 1 + RX * (CHUNK - 1 + z + RX * layer), dst = PX * (z + PX * layer);
    out.cells.set(region.cells.subarray(src, src + PX), dst);
    out.sky.set(region.sky.subarray(src, src + PX), dst);
    out.block.set(region.block.subarray(src, src + PX), dst);
  }
}

/** Centre chunk light in chunk localIndex order, packed sky << 4 | block. */
export function extractCoreLight(region: Region, out = new Uint8Array(CHUNK * CHUNK * HEIGHT)) {
  for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < CHUNK; z++) {
    const src = CHUNK + RX * (CHUNK + z + RX * (y + 1)), dst = CHUNK * (z + CHUNK * y);
    for (let x = 0; x < CHUNK; x++) out[dst + x] = region.sky[src + x]! << 4 | region.block[src + x]!;
  }
  return out;
}
