/**
 * Shared theatre state: the beat queue and the current server time. The mounted Theatre owns it
 * (enqueues events, ticks the clock each frame while anything plays); rail pieces WP-hud mounts
 * (SeatGains, FinaleVp, RankBadge) only read it. Module-level, like shared/bridge.
 */
import { useSyncExternalStore } from 'react';
import type { GameEvent, PublicView } from '../../../model';
import { enqueue, prune, type Beat } from './plan';

export type TheatreState = { beats: Beat[]; now: number };

let state: TheatreState = { beats: [], now: 0 };
const listeners = new Set<() => void>();
const set = (next: TheatreState) => {
  state = next;
  for (const fn of listeners) fn();
};

export const theatre = {
  snapshot: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  enqueue(events: GameEvent[], pub: PublicView, now: number) {
    set({ beats: enqueue(state.beats, events, pub, now), now });
  },
  /** Advances the clock and drops finished beats. */
  tick(now: number) {
    if (now !== state.now) set({ beats: prune(state.beats, now), now });
  },
  reset() { set({ beats: [], now: 0 }); },
};

export const useTheatre = () => useSyncExternalStore(theatre.subscribe, theatre.snapshot, theatre.snapshot);
