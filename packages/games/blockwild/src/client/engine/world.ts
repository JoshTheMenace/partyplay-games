import { B } from '../../shared/blocks';
import { outsideCell, type World } from '../../shared/chunk';
import { cellXYZ, chunkKey, localIndex } from '../../shared/coords';

type Column = { cells: Uint16Array; light: Uint8Array };

/**
 * Main-thread copy of the loaded chunks, for physics, raycasts and entity lighting.
 * Unloaded chunks read as `barrier` (solid, invisible, untargetable) so nobody falls through the world while it streams.
 */
export class ClientWorld implements World {
  private columns = new Map<number, Column>();
  private lastKey = -1;
  private last: Column | undefined;

  private column(cx: number, cz: number) {
    const key = chunkKey(cx, cz);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.last = this.columns.get(key);
    }
    return this.last;
  }
  getCell(x: number, y: number, z: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const outside = outsideCell(x, y, z);
    if (outside !== null) return outside;
    const column = this.column(x >> 4, z >> 4);
    return column ? column.cells[localIndex(x & 15, y, z & 15)]! : B.barrier;
  }
  /** True once the column containing (x, z) has arrived. */
  isLoaded(x: number, z: number) { return !!this.column(Math.floor(x) >> 4, Math.floor(z) >> 4); }
  /** Sky and block light 0..15 at a cell ([15, 0] above the world or when not loaded). */
  lightLevels(x: number, y: number, z: number): [number, number] {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const column = y >= 0 && y < 128 ? this.column(x >> 4, z >> 4) : undefined;
    if (!column) return [y < 0 ? 0 : 15, 0];
    const packed = column.light[localIndex(x & 15, y, z & 15)]!;
    return [packed >> 4, packed & 15];
  }

  /** Engine internals. */
  install(key: number, cells: Uint16Array, light: Uint8Array) {
    this.columns.set(key, { cells, light });
    this.lastKey = -1;
  }
  setLight(key: number, light: Uint8Array) {
    const column = this.columns.get(key);
    if (column) column.light = light;
  }
  remove(key: number) {
    this.columns.delete(key);
    this.lastKey = -1;
  }
  has(key: number) { return this.columns.has(key); }
  /** Writes a cell by global index if its column is loaded. */
  write(index: number, value: number) {
    const [x, y, z] = cellXYZ(index), column = this.columns.get(chunkKey(x >> 4, z >> 4));
    if (column) column.cells[localIndex(x & 15, y, z & 15)] = value;
  }
  clear() {
    this.columns.clear();
    this.lastKey = -1;
  }
}
