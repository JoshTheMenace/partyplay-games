/**
 * Host picking on the 3D board (EXPERIENCE §4.9). The controller panels still render their 2D map, but
 * into a hidden element (the controller's MapHost portal). That hidden map stays the single source of
 * truth for the legal spots and what a pick does; this hook mirrors its `[data-spot]` buttons into
 * `bridge.pick`, so the scene draws them, and forwards board clicks and ←/→/Enter back as clicks.
 * Like a remote control: the TV board is the screen, the hidden map is the receiver.
 */
import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../shared/bridge';
import { spotHint, stepSpot } from './logic';

type Spots = { ids: string[]; labels: Record<string, string>; selected: string | null };
const NONE: Spots = { ids: [], labels: {}, selected: null };

function read(source: HTMLElement): Spots {
  const els = [...source.querySelectorAll<Element>('[data-spot]')];
  return {
    ids: els.map(el => el.getAttribute('data-spot')!),
    labels: Object.fromEntries(els.map(el => [el.getAttribute('data-spot'), el.getAttribute('aria-label')])),
    selected: els.find(el => el.hasAttribute('data-selected'))?.getAttribute('data-spot') ?? null,
  };
}

const same = (a: Spots, b: Spots) => a.selected === b.selected && a.ids.join() === b.ids.join()
  && a.ids.every(id => a.labels[id] === b.labels[id]);

/** Typing, dialogs and modified keys keep their own keys. */
const busyKey = (e: KeyboardEvent) => e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey
  || (e.target instanceof Element && !!e.target.closest('input, textarea, select, dialog'));

export function useBoardPick(source: HTMLElement | null) {
  const [spots, setSpots] = useState(NONE), [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!source) return;
    const sync = () => { const next = read(source); setSpots(old => (same(old, next) ? old : next)); };
    const observer = new MutationObserver(sync);
    observer.observe(source, { subtree: true, childList: true, attributes: true });
    sync();
    return () => observer.disconnect();
  }, [source]);

  const pick = useCallback((id: string) => {
    setFocus(null); // the selection now carries the ring; the next ←/→ starts from it
    const spot = source?.querySelector(`[data-spot="${CSS.escape(id)}"]`);
    spot?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, [source]);
  const live = focus !== null && spots.ids.includes(focus) ? focus : null;
  const key = spots.ids.join();
  useEffect(() => {
    const onPick = spots.ids.length ? pick : null;
    bridge.publish({ pick: { spots: spots.ids, focus: live ?? spots.selected, onPick } });
    // `key` stands for the ids array, which is rebuilt on every DOM change.
  }, [key, live, spots.selected, pick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => bridge.publish({ pick: { spots: [], focus: null, onPick: null } }), []);

  useEffect(() => {
    if (!spots.ids.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (busyKey(e)) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.(); // Enter then selects, not a focused button
        setFocus(stepSpot(spots.ids, live ?? spots.selected, e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key === 'Enter' && live && (e.target === document.body || !(e.target instanceof Element))) {
        e.preventDefault();
        pick(live);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spots, live, pick]);

  const shown = live ?? spots.selected;
  return { count: spots.ids.length, hint: spotHint(spots.ids, shown, shown ? spots.labels[shown] : null) };
}
