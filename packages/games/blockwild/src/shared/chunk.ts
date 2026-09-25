import { B } from './blocks';
import { CHUNK, EDIT_LIMIT, HEIGHT, WORLD } from './constants';
import { cellIndex, chunkKey, localIndex } from './coords';

/** Cells in one column chunk (16 × 16 × 128). */
export const CHUNK_CELLS = CHUNK * CHUNK * HEIGHT;
/** Reads a cell value (id | state << 8) anywhere, including outside the world. */
export interface World { getCell(x: number, y: number, z: number): number }
export type CellReader = (x: number, y: number, z: number) => number;
/** Generates the untouched terrain for one column chunk; must be pure. */
export type ChunkSource = (cx: number, cz: number) => Uint16Array;

/** Value outside the world: bedrock below, air above, invisible barrier beyond the horizontal edge. */
export function outsideCell(x: number, y: number, z: number): number | null {
  if (x < 0 || z < 0 || x >= WORLD || z >= WORLD) return B.barrier;
  if (y < 0) return B.bedrock;
  if (y >= HEIGHT) return B.air;
  return null;
}

/** Small LRU cache of generated chunks (Map insertion order = recency). */
export class ChunkCache {
  private chunks = new Map<number, Uint16Array>();
  constructor(private generate: ChunkSource, readonly capacity = 256) {}
  get(cx: number, cz: number): Uint16Array {
    const key = chunkKey(cx, cz), hit = this.chunks.get(key);
    if (hit) {
      this.chunks.delete(key);
      this.chunks.set(key, hit);
      return hit;
    }
    const chunk = this.generate(cx, cz);
    this.chunks.set(key, chunk);
    if (this.chunks.size > this.capacity) this.chunks.delete(this.chunks.keys().next().value!);
    return chunk;
  }
  has(cx: number, cz: number) { return this.chunks.has(chunkKey(cx, cz)); }
  get size() { return this.chunks.size; }
  clear() { this.chunks.clear(); }
}

/**
 * Generated terrain plus a sparse edit journal (global cell index → cell value).
 * Writing a cell back to its generated value removes the journal entry.
 */
export class VoxelWorld implements World {
  readonly edits = new Map<number, number>();
  readonly cache: ChunkCache;
  constructor(source: ChunkSource, capacity = 256) {
    this.cache = new ChunkCache(source, capacity);
  }
  /** Terrain value ignoring edits. */
  generated(x: number, y: number, z: number): number {
    const outside = outsideCell(x, y, z);
    if (outside !== null) return outside;
    return this.cache.get(x >> 4, z >> 4)[localIndex(x & 15, y, z & 15)]!;
  }
  getCell(x: number, y: number, z: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (this.edits.size) {
      const outside = outsideCell(x, y, z);
      if (outside !== null) return outside;
      const edited = this.edits.get(cellIndex(x, y, z));
      if (edited !== undefined) return edited;
    }
    return this.generated(x, y, z);
  }
  /** Sets a cell. Returns false (and changes nothing) outside the world or when the edit limit would be exceeded. */
  setCell(x: number, y: number, z: number, value: number): boolean {
    if (outsideCell(x, y, z) !== null) return false;
    const index = cellIndex(x, y, z);
    if (value === this.generated(x, y, z)) {
      this.edits.delete(index);
      return true;
    }
    if (!this.edits.has(index) && this.edits.size >= EDIT_LIMIT) return false;
    this.edits.set(index, value);
    return true;
  }
  /** True if setting these cells would stay within EDIT_LIMIT. */
  canEdit(cells: readonly (readonly [number, number, number, number])[]): boolean {
    let added = 0;
    for (const [x, y, z, value] of cells) if (!this.edits.has(cellIndex(x, y, z)) && value !== this.generated(x, y, z)) added++;
    return this.edits.size + added <= EDIT_LIMIT;
  }
  /** Copy of a chunk with edits applied (for meshing or saves). */
  chunkWithEdits(cx: number, cz: number): Uint16Array {
    const chunk = this.cache.get(cx, cz).slice(), x0 = cx * CHUNK, z0 = cz * CHUNK;
    for (const [index, value] of this.edits) {
      const x = index % WORLD, z = Math.floor(index / WORLD) % WORLD;
      if (x >= x0 && x < x0 + CHUNK && z >= z0 && z < z0 + CHUNK) chunk[localIndex(x - x0, Math.floor(index / (WORLD * WORLD)), z - z0)] = value;
    }
    return chunk;
  }
}

/** Highest y whose cell satisfies `test` in a column, or -1. */
export function topY(world: World, x: number, z: number, test: (cell: number) => boolean): number {
  for (let y = HEIGHT - 1; y >= 0; y--) if (test(world.getCell(x, y, z))) return y;
  return -1;
}
