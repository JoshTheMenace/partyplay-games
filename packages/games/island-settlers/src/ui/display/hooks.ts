/** Small React hooks for the TV frame: stage size, a 1 Hz server tick, one shared rAF loop, FLIP. */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export type Size = { width: number; height: number };

/** The element's px size, kept current by a ResizeObserver; null until first measured. */
export function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<Size | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize(s => (s?.width === el.clientWidth && s.height === el.clientHeight ? s
      : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Re-renders on every server second boundary, so "0:42" countdowns stay exact. Returns server now. */
export function useSecond(serverNowMs: () => number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let timer = 0;
    const next = () => { timer = window.setTimeout(tick, 1005 - (serverNowMs() % 1000)); };
    const tick = () => { setTick(n => n + 1); next(); };
    next();
    return () => clearTimeout(timer);
  }, [serverNowMs]);
  return serverNowMs();
}

const frames = new Set<{ current: () => void }>();
let raf = 0;
const loop = () => {
  for (const fn of frames) fn.current();
  raf = frames.size ? requestAnimationFrame(loop) : 0;
};

/** Runs `fn` every animation frame through one shared loop (timer rings, EXPERIENCE §6). */
export function useFrame(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    frames.add(ref);
    if (!raf) raf = requestAnimationFrame(loop);
    return () => { frames.delete(ref); };
  }, []);
}

/**
 * FLIP re-sort (the finale rank sort): children carrying `data-flip` glide from their old spot over 500 ms.
 * Like noting where everyone sat before shuffling chairs, then letting each walk to the new chair.
 */
export function useFlip(ref: RefObject<HTMLElement | null>, key: string, reduced: boolean) {
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    for (const el of ref.current?.querySelectorAll<HTMLElement>('[data-flip]') ?? []) {
      const id = el.dataset.flip!, top = el.getBoundingClientRect().top, before = tops.current.get(id);
      tops.current.set(id, top);
      if (before === undefined || before === top || reduced) continue;
      el.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }],
        { duration: 500, easing: 'ease-in-out' });
    }
  }, [ref, key, reduced]);
}
