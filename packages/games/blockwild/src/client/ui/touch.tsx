/**
 * Landscape touch controls. Everything is written into the polled `touch` object (no re-render per move):
 * a floating joystick on the left (sprint when pushed to the rim), drag-to-look over free screen space, and hold/toggle
 * buttons on the right. Each surface captures its pointer so several thumbs work at once; every hold is released on
 * pointer cancel, lost capture, blur, hidden tab, rotation and unmount.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { resetTouch, touch, type TouchState } from '../store';
import { stickVector } from './input';
import { dropSelected, openMenu, toggleInventory } from './state';

type HoldKey = 'jump' | 'mine' | 'use' | 'flyDown';
const STICK_RADIUS = 54, STICK_ZONE = 1 / 3;

/** A button that holds one or more touch intents while any pointer presses it. */
function HoldButton({ label, keys, className, children }: { label: string; keys: readonly HoldKey[]; className: string; children: ReactNode }) {
  const pointers = useRef(new Set<number>()), [held, setHeld] = useState(false);
  const update = (id: number, down: boolean) => {
    if (down) pointers.current.add(id);
    else pointers.current.delete(id);
    const on = pointers.current.size > 0;
    for (const key of keys) touch[key] = on;
    setHeld(on);
  };
  useEffect(() => () => { for (const key of keys) touch[key] = false; }, []);
  return <button type="button" className={`bw-tbtn ${className}`} aria-label={label} aria-pressed={held}
    onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); update(event.pointerId, true); }}
    onPointerUp={event => update(event.pointerId, false)} onPointerCancel={event => update(event.pointerId, false)} onLostPointerCapture={event => update(event.pointerId, false)}
    onContextMenu={event => event.preventDefault()}>{children}</button>;
}

/** Drop: hold while the button fills to drop one item, keep holding to drop the rest of the stack. A stray tap drops nothing. */
function DropButton() {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]), [stage, setStage] = useState(0);
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; setStage(0); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return <button type="button" className="bw-tbtn bw-tbtn-small bw-tbtn-drop" data-stage={stage} aria-label="Drop: hold to drop one item, keep holding to drop the stack"
    onPointerDown={event => {
      event.currentTarget.setPointerCapture(event.pointerId);
      clear();
      setStage(1);
      timers.current = [setTimeout(() => { dropSelected(false); setStage(2); }, 450), setTimeout(() => { dropSelected(true); setStage(0); }, 1250)];
    }}
    onPointerUp={clear} onPointerCancel={clear} onLostPointerCapture={clear} onContextMenu={event => event.preventDefault()}>Drop</button>;
}

export function TouchControls({ creative }: { creative: boolean }) {
  const [sneak, setSneak] = useState(false), [stick, setStick] = useState<[number, number] | null>(null);
  const knob = useRef<HTMLSpanElement>(null), stickPointer = useRef<{ id: number; x: number; y: number } | null>(null), look = useRef<{ id: number; x: number; y: number } | null>(null);
  const toggleSneak = (on: boolean) => { touch.sneak = on; setSneak(on); };

  useEffect(() => {
    const cancel = () => {
      stickPointer.current = look.current = null;
      setStick(null);
      setSneak(false);
      resetTouch();
    };
    const hidden = () => { if (document.hidden) cancel(); };
    // Browser chrome resizes the page constantly on phones; only a real rotation cancels held controls.
    let landscape = innerWidth > innerHeight;
    const resize = () => { if (landscape !== innerWidth > innerHeight) cancel(); landscape = innerWidth > innerHeight; };
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', cancel);
      document.removeEventListener('visibilitychange', hidden);
      resetTouch();
    };
  }, []);
  // Creative uses the sneak button as a held "fly down"; drop any survival toggle when the mode changes.
  useEffect(() => { toggleSneak(false); }, [creative]);

  const moveStick = (dx: number, dy: number) => {
    const { move, sprint, knob: [kx, ky] } = stickVector(dx, dy, STICK_RADIUS);
    Object.assign(touch, { move, sprint } satisfies Partial<TouchState>);
    knob.current?.style.setProperty('transform', `translate(${kx}px, ${ky}px)`);
  };
  const release = (id: number) => {
    if (stickPointer.current?.id === id) {
      stickPointer.current = null;
      setStick(null);
      Object.assign(touch, { move: [0, 0], sprint: false } satisfies Partial<TouchState>);
    }
    if (look.current?.id === id) look.current = null;
  };

  return <div className="bw-touch">
    <div className="bw-look" aria-hidden="true"
      onPointerDown={event => {
        const box = event.currentTarget.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
        const grab = { id: event.pointerId, x: event.clientX, y: event.clientY };
        if (x < box.width * STICK_ZONE && !stickPointer.current) {
          stickPointer.current = grab;
          setStick([x, y]);
          moveStick(0, 0);
        } else if (!look.current) look.current = grab;
        else return;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const s = stickPointer.current, l = look.current;
        if (s?.id === event.pointerId) moveStick(event.clientX - s.x, event.clientY - s.y);
        else if (l?.id === event.pointerId) {
          touch.lookX += event.clientX - l.x;
          touch.lookY += event.clientY - l.y;
          l.x = event.clientX;
          l.y = event.clientY;
        }
      }}
      onPointerUp={event => release(event.pointerId)} onPointerCancel={event => release(event.pointerId)} onLostPointerCapture={event => release(event.pointerId)}>
      {stick ? <span className="bw-stick" style={{ left: stick[0], top: stick[1] }}><span ref={knob} className="bw-knob"/></span>
        : <span className="bw-stick-hint">Move</span>}
    </div>
    <div className="bw-tcorner">
      <DropButton/>
      <button type="button" className="bw-tbtn bw-tbtn-small" aria-label="Items: open inventory" onClick={toggleInventory}>Items</button>
      <button type="button" className="bw-tbtn bw-tbtn-small" aria-label="Menu" onClick={() => openMenu('pause')}>☰</button>
    </div>
    <div className="bw-tactions">
      <HoldButton label="Mine or attack (hold)" keys={['mine']} className="bw-tbtn-mine">Mine</HoldButton>
      <HoldButton label="Use or place (hold to eat or draw)" keys={['use']} className="bw-tbtn-use">Use</HoldButton>
      <HoldButton label={creative ? 'Jump (double-tap to fly, hold to rise)' : 'Jump'} keys={['jump']} className="bw-tbtn-jump">Jump</HoldButton>
      {creative
        ? <HoldButton label="Sneak or fly down (hold)" keys={['flyDown']} className="bw-tbtn-sneak">Down</HoldButton>
        : <button type="button" className="bw-tbtn bw-tbtn-sneak" aria-label="Sneak" aria-pressed={sneak} onClick={() => toggleSneak(!sneak)}>Sneak</button>}
    </div>
  </div>;
}
