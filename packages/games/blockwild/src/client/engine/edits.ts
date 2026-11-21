/**
 * The edits a client currently shows: the consolidated journal, the server's recent tail over it and the optimistic
 * overlay on top. The journal list keeps its identity between consolidations, so most updates only walk the tail and
 * the overlay; a new list is diffed once. Edits are also indexed by chunk for installing freshly loaded columns.
 */
import { WORLD } from '../../shared/constants';
import { chunkKey } from '../../shared/coords';

const chunkOf = (index: number) => chunkKey((index % WORLD) >> 4, (Math.floor(index / WORLD) % WORLD) >> 4);

export class EditLayers {
  private baseList: unknown = null;
  private base = new Map<number, number>();
  /** Tail and overlay as last applied: cell index → value, or −1 for "generated terrain". */
  private top = new Map<number, number>();
  private readonly effective = new Map<number, number>();
  private readonly chunks = new Map<number, Map<number, number>>();

  /** The edited value of a cell, or undefined where the terrain shows. */
  get(index: number) { return this.effective.get(index); }
  /** Edited cells of one chunk (cell index → value). */
  inChunk(key: number): ReadonlyMap<number, number> | undefined { return this.chunks.get(key); }

  /**
   * Take new layers and return what changed as flat [cell index, value, …] pairs (value −1: back to terrain).
   * `recent` is flat [index, value, …] as the server sends it; the overlay wins over it.
   */
  update(base: readonly (readonly [number, number])[], recent: readonly number[], overlay: ReadonlyMap<number, number>): number[] {
    const top = new Map<number, number>(), touched = new Set<number>(this.top.keys());
    for (let i = 0; i < recent.length; i += 2) top.set(recent[i]!, recent[i + 1]!);
    for (const [index, value] of overlay) top.set(index, value);
    for (const index of top.keys()) touched.add(index);
    if (base !== this.baseList) {
      const next = new Map<number, number>(base as readonly [number, number][]);
      for (const [index, value] of next) if (this.base.get(index) !== value) touched.add(index);
      for (const index of this.base.keys()) if (!next.has(index)) touched.add(index);
      this.base = next;
      this.baseList = base;
    }
    this.top = top;
    const changes: number[] = [];
    for (const index of touched) {
      const over = top.get(index), value = over === undefined ? this.base.get(index) : over < 0 ? undefined : over;
      if (this.effective.get(index) === value) continue;
      const key = chunkOf(index);
      let chunk = this.chunks.get(key);
      if (value === undefined) {
        this.effective.delete(index);
        chunk?.delete(index);
        if (chunk && !chunk.size) this.chunks.delete(key);
      } else {
        this.effective.set(index, value);
        if (!chunk) this.chunks.set(key, chunk = new Map());
        chunk.set(index, value);
      }
      changes.push(index, value ?? -1);
    }
    return changes;
  }
}
