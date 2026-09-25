/**
 * A tiny module-level store between the 3D scene and the DOM (HUD, theatre, seated host).
 * The scene publishes screen points; the host publishes pick spots. No three.js import here,
 * so HUD bundles stay light. Like a notice board both sides pin updates to.
 */
import type { TileId, VertexId } from '../../model';

export type ScreenPoint = { x: number; y: number }; // stage px
/** Host picking on the 3D board: legal spot ids, the keyboard-focused one, and the click handler. */
export type BridgePick = { spots: string[]; focus: string | null; onPick: ((id: string) => void) | null };
export type BridgeState = {
  tiles: Record<TileId, ScreenPoint>;
  vertices: Record<VertexId, ScreenPoint>;
  pxPerWu: number;
  pick: BridgePick;
};

const EMPTY: BridgeState = {
  tiles: {}, vertices: {}, pxPerWu: 0, pick: { spots: [], focus: null, onPick: null },
};
let state = EMPTY;
const listeners = new Set<() => void>();

export const bridge = {
  tileScreen: (id: TileId): ScreenPoint | null => state.tiles[id] ?? null,
  vertexScreen: (id: VertexId): ScreenPoint | null => state.vertices[id] ?? null,
  pxPerWu: () => state.pxPerWu,
  get pick(): BridgePick { return state.pick; },
  /** Immutable snapshot, suitable for useSyncExternalStore. */
  snapshot: () => state,
  /** Merge a partial update and notify subscribers. */
  publish(next: Partial<BridgeState>) {
    state = { ...state, ...next };
    for (const fn of listeners) fn();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  /** Scene unmount or a new round. */
  reset() { bridge.publish(EMPTY); },
};
