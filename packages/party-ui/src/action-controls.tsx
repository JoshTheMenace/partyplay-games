import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Smartphone } from 'lucide-react';
import { ArcadeButton, Panel } from './primitives';
export type StickValue = { x: number; y: number };
const ZERO: StickValue = { x: 0, y: 0 };
function useCancellation(reset: () => void, disabled: boolean) {
  const latest = useRef(reset); latest.current = reset;
  useEffect(() => {
    const cancel = () => latest.current(), hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); document.addEventListener('visibilitychange', hidden);
    return () => { cancel(); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => { if (disabled) latest.current(); }, [disabled]);
}
export function HoldButton({ label, onChange, disabled = false, children }: { label: string; onChange(held: boolean): void; disabled?: boolean; children?: ReactNode }) {
  const sources = useRef(new Set<string>()), [held, setHeld] = useState(false);
  const change = (key: string, down: boolean) => { const before = sources.current.size > 0; if (down) sources.current.add(key); else sources.current.delete(key); const after = sources.current.size > 0; if (before !== after) { setHeld(after); onChange(after); } };
  const reset = () => { if (sources.current.size) { sources.current.clear(); setHeld(false); onChange(false); } };
  useCancellation(reset, disabled);
  return <ArcadeButton type="button" className="kp-hold-button" tone={held ? 'lime' : 'sun'} aria-label={label} aria-pressed={held} disabled={disabled}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); change(`p${event.pointerId}`, true); }}
    onPointerUp={event => change(`p${event.pointerId}`, false)} onPointerCancel={event => change(`p${event.pointerId}`, false)} onLostPointerCapture={event => change(`p${event.pointerId}`, false)} onBlur={() => { change(" ", false); change("Enter", false); }}
    onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); change(event.key, true); } }}
    onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); change(event.key, false); } }}>{children ?? label}</ArcadeButton>;
}
export function SteerPad({ label = 'Move', onChange, disabled = false }: { label?: string; onChange(value: StickValue): void; disabled?: boolean }) {
  const [value, setValue] = useState(ZERO), current = useRef(ZERO), pointer = useRef<number | null>(null), keys = useRef(new Set<string>());
  const publish = (next: StickValue) => { if (next.x !== current.current.x || next.y !== current.current.y) { current.current = next; setValue(next); onChange(next); } };
  const reset = () => { pointer.current = null; keys.current.clear(); publish(ZERO); };
  useCancellation(reset, disabled);
  const move = (element: HTMLElement, x: number, y: number) => {
    const box = element.getBoundingClientRect(), radius = Math.max(1, (Math.min(box.width, box.height) - 56) / 2);
    let dx = (x - box.left - box.width / 2) / radius, dy = (y - box.top - box.height / 2) / radius;
    const length = Math.hypot(dx, dy); if (length < .1) { dx = 0; dy = 0; } else if (length > 1) { dx /= length; dy /= length; }
    publish({ x: Math.round(dx * 1000) / 1000, y: Math.round(dy * 1000) / 1000 });
  };
  const key = (name: string, down: boolean) => {
    name = name.toLowerCase(); if (!['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'].includes(name)) return false;
    if (down) keys.current.add(name); else keys.current.delete(name);
    const has = (a: string, b: string) => keys.current.has(a) || keys.current.has(b);
    const x = Number(has('arrowright','d')) - Number(has('arrowleft','a')), y = Number(has('arrowdown','s')) - Number(has('arrowup','w')), length = Math.max(1, Math.hypot(x, y));
    publish({ x: x / length, y: y / length }); return true;
  };
  return <div className="kp-steer-control"><button type="button" className="kp-steer-pad" aria-label={`${label}: drag or use arrow keys or WASD`} disabled={disabled}
    onPointerDown={event => { if (event.button !== 0 || pointer.current !== null) return; event.preventDefault(); event.currentTarget.focus(); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); move(event.currentTarget, event.clientX, event.clientY); }}
    onPointerMove={event => { if (pointer.current === event.pointerId) move(event.currentTarget, event.clientX, event.clientY); }}
    onPointerUp={event => { if (pointer.current === event.pointerId) reset(); }} onPointerCancel={reset} onLostPointerCapture={reset} onBlur={() => { keys.current.clear(); if (pointer.current === null) publish(ZERO); }}
    onKeyDown={event => { if (key(event.key, true)) event.preventDefault(); }} onKeyUp={event => { if (key(event.key, false)) event.preventDefault(); }}>
    <span className="kp-steer-cross" aria-hidden="true">＋</span><span className="kp-steer-knob" aria-hidden="true" style={{ left: `calc(50% + ${value.x} * (50% - 28px))`, top: `calc(50% + ${value.y} * (50% - 28px))` }}/></button><span>{label}</span></div>;
}
export function usePhoneOrientation() {
  const read = () => ({ phone: matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 600, portrait: matchMedia('(orientation: portrait)').matches });
  const [orientation, setOrientation] = useState(read);
  useEffect(() => {
    const update = () => setOrientation(read()), queries = [matchMedia('(pointer: coarse)'), matchMedia('(orientation: portrait)')];
    window.addEventListener('resize', update); queries.forEach(query => query.addEventListener('change', update));
    return () => { window.removeEventListener('resize', update); queries.forEach(query => query.removeEventListener('change', update)); };
  }, []);
  return orientation;
}
export function RotatePrompt() {
  return <section className="kp-landscape-prompt" role="status"><Panel><Smartphone size={64} aria-hidden="true"/><p className="kp-eyebrow">Landscape only</p><h2>Turn your phone sideways</h2><p>Movement on the left. Actions on the right.</p><p>Your controls are released. Turn sideways to continue; the game keeps running.</p></Panel></section>;
}
