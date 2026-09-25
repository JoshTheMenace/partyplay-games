import { cellIndex } from '../../shared/coords';
import type { CellWrite } from '../../shared/placement';

/**
 * Optimistic edits over the authoritative journal. Each predicted cell remembers the command that wrote it and is
 * dropped once the server has acknowledged that command: by then the authoritative edits in the same snapshot
 * already hold the accepted result, so a rejected command reverts on its own.
 */
export class EditOverlay {
  private readonly owners = new Map<number, number>();
  /** Cell index → predicted cell value (pass to the engine with the authoritative edits). */
  readonly values = new Map<number, number>();
  /** Bumped on every change so callers can cheaply detect when to re-send to the engine. */
  version = 0;

  set(writes: readonly CellWrite[], n: number) {
    for (const [x, y, z, value] of writes) {
      const index = cellIndex(x, y, z);
      this.owners.set(index, n);
      this.values.set(index, value);
    }
    if (writes.length) this.version++;
  }
  /** Forget every prediction made by commands up to `ack`. Returns true if anything changed. */
  prune(ack: number): boolean {
    let changed = false;
    for (const [index, n] of this.owners) if (n <= ack) {
      this.owners.delete(index);
      this.values.delete(index);
      changed = true;
    }
    if (changed) this.version++;
    return changed;
  }
  get size() { return this.values.size; }
}
