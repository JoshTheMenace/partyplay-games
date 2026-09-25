/** One clock for scene and HUD animations (EXPERIENCE §3.6 and §6). Times are ms after the roll event. */
import { useSyncExternalStore } from 'react';
import type { GameEvent } from '../../model';

export const ROLL_MS = { land: 450, flash: 450, flyStart: 600, settle: 1440 } as const;
/** Queued animation beyond this skips older items to their end state. */
export const BACKLOG_MS = 2500;
/** After a reload only events this recent are replayed. */
export const REPLAY_WINDOW_MS = 3000;

/** Unseen events recent enough to animate, oldest first. */
export const freshEvents = (events: GameEvent[], lastSeen: number, now: number): GameEvent[] =>
  events.filter(e => e.id > lastSeen && e.at >= now - REPLAY_WINDOW_MS).sort((a, b) => a.id - b.id);

const QUERY = '(prefers-reduced-motion: reduce)';
const media = () => (typeof matchMedia === 'function' ? matchMedia(QUERY) : null);

/** Checked live; false outside the browser. */
export const reducedMotion = () => media()?.matches ?? false;

export function useReducedMotion() {
  return useSyncExternalStore(fn => {
    const m = media();
    m?.addEventListener('change', fn);
    return () => m?.removeEventListener('change', fn);
  }, reducedMotion, () => false);
}
