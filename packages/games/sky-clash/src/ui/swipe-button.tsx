import { useEffect, useRef, useState } from 'react';
import { ArcadeButton } from '../../../../party-ui/src/index';
import { SWIPE, readSwipe } from './input';
type Dir = { x: number; y: number };
const ARROWS = [['up', '▲'], ['right', '▶'], ['down', '▼'], ['left', '◀']] as const;
const side = (d: Dir) => Math.abs(d.x) > Math.abs(d.y) ? d.x > 0 ? 'right' : 'left' : d.y > 0 ? 'down' : 'up';
/**
 * A hold button that also reads swipes: a tap presses with no direction (the stick aims it), a swipe or flick presses with
 * the swipe's unit direction. The press waits up to SWIPE.tap ms for a still thumb. Pointer capture keeps the thumb; the hold
 * releases on pointerup, pointercancel, lost capture, blur, resize, a hidden tab, disable and unmount. Space/Enter work like a tap.
 */
export function SwipeButton({ label, onChange, disabled = false }: { label: string; onChange(held: boolean, swipe?: Dir): void; disabled?: boolean }) {
  const touch = useRef<{ id: number; x: number; y: number; at: number; dx: number; dy: number; down: boolean } | null>(null), keys = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined), [held, setHeld] = useState<string | null>(null);
  const latest = useRef(onChange); latest.current = onChange;
  const press = (swipe?: Dir) => { setHeld(swipe ? side(swipe) : 'tap'); latest.current(true, swipe); };
  const decide = (up = false) => {
    const t = touch.current; if (!t || t.down) return;
    const r = readSwipe(t.dx, t.dy, performance.now() - t.at, up); if (!r) return;
    clearTimeout(timer.current); t.down = true; press(r === 'tap' ? undefined : r);
  };
  const end = (id?: number) => {
    const t = touch.current; if (!t || id !== undefined && id !== t.id) return;
    clearTimeout(timer.current); touch.current = null; if (t.down) { setHeld(null); latest.current(false); }
  };
  const reset = () => { end(); if (keys.current.size) { keys.current.clear(); setHeld(null); latest.current(false); } };
  const key = (name: string, down: boolean) => {
    const before = keys.current.size; if (down) keys.current.add(name); else keys.current.delete(name);
    if (!before && keys.current.size && !touch.current) press(); else if (before && !keys.current.size && !touch.current) { setHeld(null); latest.current(false); }
  };
  const resetRef = useRef(reset); resetRef.current = reset;
  useEffect(() => {
    const cancel = () => resetRef.current(), hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); document.addEventListener('visibilitychange', hidden);
    return () => { cancel(); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => { if (disabled) resetRef.current(); }, [disabled]);
  return <ArcadeButton type="button" className="kp-hold-button sc-swipe" tone={held ? 'lime' : 'sun'} aria-label={label} aria-pressed={!!held} data-swipe={held ?? undefined} disabled={disabled}
    onPointerDown={e => {
      if (e.button !== 0 || touch.current || keys.current.size) return;
      e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
      touch.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), dx: 0, dy: 0, down: false };
      timer.current = setTimeout(() => { decide(); if (touch.current && !touch.current.down) timer.current = setTimeout(decide, SWIPE.max - SWIPE.tap); }, SWIPE.tap);
    }}
    onPointerMove={e => { const t = touch.current; if (t?.id !== e.pointerId) return; t.dx = e.clientX - t.x; t.dy = e.clientY - t.y; decide(); }}
    onPointerUp={e => { if (touch.current?.id !== e.pointerId) return; decide(true); end(e.pointerId); }}
    onPointerCancel={e => end(e.pointerId)} onLostPointerCapture={e => end(e.pointerId)} onBlur={() => { keys.current.clear(); if (!touch.current && held) { setHeld(null); latest.current(false); } }}
    onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) key(e.key, true); } }}
    onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); key(e.key, false); } }}>
    {ARROWS.map(([name, arrow]) => <i key={name} className={`sc-arrow sc-arrow-${name}`} aria-hidden="true">{arrow}</i>)}<b>{label}</b>
  </ArcadeButton>;
}
