/** Container slots (bevelled MC-style buttons), the cursor-follow held stack and desktop tooltips. */
import { useEffect, useRef, type ReactNode } from 'react';
import { itemName, type Slot } from '../../shared/items';
import type { ClickTarget } from '../../shared/protocol';
import { clickSlot } from '../game/predict';
import { createStore, store } from '../store';
import { itemDetails, wear, wearColor } from './format';
import { ItemIcon } from './icons';
import { clickButton, type SlotGesture } from './input';
import { useStore } from './state';

/** Slot contents: icon, stack count and durability bar. */
export function SlotFace({ slot }: { slot: Slot | null }) {
  if (!slot) return null;
  const left = wear(slot);
  return <>
    <ItemIcon id={slot.id}/>
    {slot.n > 1 && <b className="bw-count">{slot.n}</b>}
    {left !== null && <i className="bw-wear" aria-hidden="true"><i style={{ width: `${left * 100}%`, background: wearColor(left) }}/></i>}
  </>;
}
export const slotLabel = (slot: Slot | null) => slot ? `${itemName(slot.id)}${slot.n > 1 ? `, ${slot.n}` : ''}` : 'Empty slot';

/** Hovered slot for the desktop tooltip (mouse only); `owner` is the hovered button, so its tooltip follows its contents. */
const hover = createStore<{ slot: Slot | null; owner?: object }>({ slot: null });
const LONG_PRESS_MS = 380, MOVE_CANCEL_PX = 12;

type SlotButtonProps = { slot: Slot | null; onAct(button: 0 | 1 | 2): void; label?: string; selected?: boolean; hint?: ReactNode; className?: string };
/**
 * One interactive slot. Mouse: left / right / shift-click act on press (MC feel). Touch: tap = left (or quick move while
 * the Quick move toggle is on), long-press = right-click split. Keyboard: Enter/Space = left, Shift+Enter = quick move.
 */
export function SlotButton({ slot, onAct, label, selected, hint, className = '' }: SlotButtonProps) {
  const press = useRef<{ id: number; x: number; y: number; timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null), owner = useRef({}).current;
  const act = (gesture: SlotGesture) => {
    const button = clickButton(gesture, store.get().quickMove);
    if (button !== null) onAct(button);
  };
  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancel, []);
  useEffect(() => { if (hover.get().owner === owner) hover.set({ slot, owner }); }, [slot]);
  return <button type="button" className={`bw-slot ${className}`} aria-label={label ?? slotLabel(slot)} aria-pressed={selected}
    onContextMenu={event => event.preventDefault()}
    onPointerEnter={event => { if (event.pointerType === 'mouse') hover.set({ slot, owner }); }}
    onPointerLeave={() => { if (hover.get().owner === owner) hover.set({ slot: null, owner: undefined }); }}
    onPointerDown={event => {
      if (event.pointerType === 'mouse') {
        event.preventDefault();
        act({ pointer: 'mouse', button: event.button, shift: event.shiftKey, longPress: false });
        return;
      }
      cancel();
      const pointer = event.pointerType;
      const timer = setTimeout(() => {
        if (!press.current) return;
        press.current.fired = true;
        navigator.vibrate?.(12);
        act({ pointer, button: 0, shift: false, longPress: true });
      }, LONG_PRESS_MS);
      press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, timer, fired: false };
    }}
    onPointerMove={event => {
      const p = press.current;
      if (p && p.id === event.pointerId && Math.hypot(event.clientX - p.x, event.clientY - p.y) > MOVE_CANCEL_PX) cancel();
    }}
    onPointerUp={event => {
      const p = press.current;
      if (!p || p.id !== event.pointerId) return;
      const fired = p.fired;
      cancel();
      if (!fired) act({ pointer: event.pointerType, button: 0, shift: false, longPress: false });
    }}
    onPointerCancel={cancel}
    onClick={event => { if (event.detail === 0) act({ pointer: 'keyboard', button: 0, shift: event.shiftKey, longPress: false }); }}>
    <SlotFace slot={slot}/>{!slot && hint}
  </button>;
}

/** A row-major grid of container slots bound to a click target. */
export function SlotGrid({ slots, target, from = 0, count = slots.length - from, columns = 9, className = '', hints }: {
  slots: readonly (Slot | null)[]; target: ClickTarget; from?: number; count?: number; columns?: number; className?: string; hints?: Readonly<Record<number, ReactNode>>;
}) {
  return <div className={`bw-slots ${className}`} style={{ gridTemplateColumns: `repeat(${columns}, var(--bw-slot))` }}>
    {Array.from({ length: count }, (_, k) => {
      const i = from + k;
      return <SlotButton key={i} slot={slots[i] ?? null} hint={hints?.[i]} onAct={b => clickSlot(target, i, b)}/>;
    })}
  </div>;
}

/** The held (cursor) stack follows the mouse or last touch point; with an empty cursor the mouse shows item tooltips. */
export function FloatingLayer() {
  const cursor = useStore(store, s => s.cursor), hovered = useStore(hover, s => s.slot), layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (event: PointerEvent) => layer.current?.style.setProperty('transform', `translate(${event.clientX}px, ${event.clientY}px)`);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', move);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', move);
      hover.set({ slot: null, owner: undefined });
    };
  }, []);
  return <div className="bw-float" ref={layer} aria-hidden="true">
    {cursor ? <span className="bw-held"><SlotFace slot={cursor}/></span>
      : hovered && <span className="bw-tooltip"><b>{itemName(hovered.id)}</b>{itemDetails(hovered).map(line => <small key={line}>{line}</small>)}</span>}
  </div>;
}
