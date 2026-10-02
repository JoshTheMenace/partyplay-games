/* Timing, draft and send helpers shared by every Hijinks screen. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionResult } from '../../../../../party-contract/src/index';

/** Re-renders every `ms` and returns the current server time from `now()`. */
export function useNow(now: () => number, ms = 250): number {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(n => n + 1), ms); return () => clearInterval(id); }, [ms]);
  return now();
}

/**
 * How many steps of a server-timed reveal have started: steps are millisecond offsets from `startAt`.
 * Deterministic from server time, so a reloaded TV lands on the same beat. Example: useTimeline(view.revealAt, [0, 1500, 3000], now).
 */
export function useTimeline(startAt: number, steps: readonly number[], now: () => number, ms = 100): number {
  const t = useNow(now, ms) - startAt;
  return steps.filter(offset => t >= offset).length;
}

/** Smoothly counts toward `target` (ease-out). Jumps instantly under reduced motion. */
export function useCountUp(target: number, ms = 900): number {
  const [value, setValue] = useState(target), shown = useRef(target);
  useEffect(() => {
    const from = shown.current;
    if (from === target || matchMedia('(prefers-reduced-motion: reduce)').matches) { shown.current = target; setValue(target); return; }
    const start = performance.now(); let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      shown.current = Math.round(from + (target - from) * (1 - (1 - k) ** 3)); setValue(shown.current);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

const DRAFT = 'hj:draft:';
const read = <T,>(key: string, fallback: T): T => { try { const raw = sessionStorage.getItem(DRAFT + key); return raw === null ? fallback : JSON.parse(raw) as T; } catch { return fallback; } };
/** Draft state persisted in sessionStorage under `key` (scope it by sessionKey + turn). Returns [value, set, clear]. */
export function useDraft<T>(key: string, initial: T): [T, (value: T) => void, () => void] {
  const [state, setState] = useState(() => ({ key, value: read(key, initial) })), fallback = useRef(initial);
  fallback.current = initial;
  const value = state.key === key ? state.value : read(key, initial);
  const set = useCallback((next: T) => { setState({ key, value: next }); try { sessionStorage.setItem(DRAFT + key, JSON.stringify(next)); } catch { /* storage full or blocked: keep in memory */ } }, [key]);
  const clear = useCallback(() => { setState({ key, value: fallback.current }); try { sessionStorage.removeItem(DRAFT + key); } catch { /* ignore */ } }, [key]);
  return [value, set, clear];
}

export type SendState = { status: 'idle' | 'pending' | 'accepted' | 'rejected'; reason?: string };
/** Runs `send`, reporting pending → accepted/rejected (with the server's reason) through `set`. Resolves true when accepted. */
export async function sendWithState(send: () => Promise<ActionResult>, set: (state: SendState) => void): Promise<boolean> {
  set({ status: 'pending' });
  try {
    const result = await send();
    set(result.accepted ? { status: 'accepted' } : { status: 'rejected', reason: result.reason || 'That didn’t go through. Try again.' });
    return result.accepted;
  } catch (error) {
    set({ status: 'rejected', reason: error instanceof Error && error.message ? error.message : 'Connection hiccup. Try again.' });
    return false;
  }
}
/** Component-scoped sendWithState: ignores taps while pending and stops updating after unmount. */
export function useSend(): [SendState, (send: () => Promise<ActionResult>) => Promise<boolean>, () => void] {
  const [state, setState] = useState<SendState>({ status: 'idle' }), busy = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = useCallback(async (send: () => Promise<ActionResult>) => {
    if (busy.current) return false;
    busy.current = true;
    try { return await sendWithState(send, next => { if (alive.current) setState(next); }); } finally { busy.current = false; }
  }, []);
  return [state, run, useCallback(() => setState({ status: 'idle' }), [])];
}
