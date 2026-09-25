/** Game-loop state the HUD reads that is not part of the foundation store (read-only for UI code). */
import type { Screen, Slot } from '../../shared/protocol';
import { createStore } from '../store';

export type HudState = {
  /** Monotonic counter, incremented whenever the local player takes damage: flash the red vignette on change. */
  hurt: number;
  /** Eye is under water (tint + air bubbles). */
  underwater: boolean;
  /** 0..1 progress of the current eat / bow draw, 0 when not using an item. */
  using: number;
  /** The open container screen with predicted slot contents (chest/furnace/table), or null. */
  screen: Screen | null;
  /** The world around the local player is still loading (the player is frozen; the scene shows a loading card). */
  loading: boolean;
  /** Worn armor (head, chest, legs, feet) with pending clicks predicted, like `screen`. */
  armor: (Slot | null)[];
};
export const hud = createStore<HudState>({ hurt: 0, underwater: false, using: 0, screen: null, loading: false, armor: [null, null, null, null] });
