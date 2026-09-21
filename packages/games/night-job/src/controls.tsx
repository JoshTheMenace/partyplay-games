/* Phone input. Stick and Sneak merge into one complete {x, y, sneak} held state; neutral releases the hold.
 * Tool use is a reliable action with an optional drag-to-aim direction. */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArcadeButton, type StickValue } from '../../../party-ui/src/index';
import type { ActionResult } from '../../../party-contract/src/index';
import { TOOLS, type Action, type Input, type Point, type Tool } from './model';

const ZERO: StickValue = { x: 0, y: 0 };
export type Composer = { stick(value: StickValue): void; sneak(held: boolean): void; release(): void };
export function useComposer(setInput: (input: Input) => void, releaseInput: (() => void) | undefined, enabled: boolean): Composer {
  const state = useRef({ stick: ZERO, sneak: false }), latest = useRef({ setInput, releaseInput, enabled }); latest.current = { setInput, releaseInput, enabled };
  const composer = useMemo<Composer>(() => {
    const publish = () => {
      const { stick, sneak } = state.current;
      if (!latest.current.enabled || (!stick.x && !stick.y && !sneak)) latest.current.releaseInput?.(); else latest.current.setInput({ x: stick.x, y: stick.y, sneak });
    };
    return {
      stick(value) { state.current.stick = value; publish(); },
      sneak(held) { state.current.sneak = held; publish(); },
      release() { state.current = { stick: ZERO, sneak: false }; latest.current.releaseInput?.(); },
    };
  }, []);
  useEffect(() => {
    const cancel = () => composer.release(), hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); document.addEventListener('visibilitychange', hidden);
    return () => { cancel(); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); document.removeEventListener('visibilitychange', hidden); };
  }, [composer]);
  useEffect(() => { if (!enabled) composer.release(); }, [enabled, composer]);
  return composer;
}

export const AIMED: readonly Tool[] = ['tranq', 'shotgun'];
/** One acknowledged tool action at a time. The server owns charges; a rejection is shown, never guessed. */
export function useTool(sendAction: (action: Action) => Promise<ActionResult>, heistId: string) {
  const [pending, setPending] = useState(false), [feedback, setFeedback] = useState<string | null>(null), busy = useRef(false);
  const latest = useRef({ sendAction, heistId }); latest.current = { sendAction, heistId };
  useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(null), 2500); return () => clearTimeout(timer); }, [feedback]);
  const use = async (aim?: Point) => {
    if (busy.current) return; busy.current = true; setPending(true);
    try { const result = await latest.current.sendAction({ type: 'tool', heistId: latest.current.heistId, ...(aim ? { aim } : {}) }); if (!result.accepted) setFeedback(result.reason ?? 'Tool not used.'); }
    finally { busy.current = false; setPending(false); }
  };
  return { pending, feedback, use };
}

/** Tap to use; for aimed tools drag off the button and release to choose a direction. Enter/Space use the facing direction. */
export function ToolButton({ tool, charges, pending, disabled, onUse }: { tool: Tool; charges: number; pending: boolean; disabled: boolean; onUse(aim?: Point): void }) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null), [aim, setAim] = useState<Point | null>(null), aimed = AIMED.includes(tool);
  const finish = (event: React.PointerEvent<HTMLButtonElement>, fire: boolean) => {
    if (start.current?.id !== event.pointerId) return;
    const dx = event.clientX - start.current.x, dy = event.clientY - start.current.y, length = Math.hypot(dx, dy); start.current = null; setAim(null);
    if (fire && !disabled && !pending) onUse(aimed && length > 14 ? { x: dx / length, y: dy / length } : undefined);
  };
  return <span className={`nj-tool-wrap${aim ? ' nj-aiming' : ''}`} style={aim ? { '--nj-aim': `${Math.atan2(aim.y, aim.x)}rad` } as CSSProperties : undefined}>
    <ArcadeButton type="button" tone={pending ? 'ghost' : charges > 0 ? 'coral' : 'ghost'} className="nj-tool" disabled={disabled} aria-busy={pending} aria-label={`Use ${TOOLS[tool].name}, ${charges} charges${aimed ? ', drag to aim' : ''}`} data-tool={tool} data-charges={charges} data-pending={pending}
      onPointerDown={event => { if (event.button !== 0 || start.current) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); start.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; }}
      onPointerMove={event => { if (start.current?.id === event.pointerId && aimed) { const dx = event.clientX - start.current.x, dy = event.clientY - start.current.y; setAim(Math.hypot(dx, dy) > 14 ? { x: dx, y: dy } : null); } }}
      onPointerUp={event => finish(event, true)} onPointerCancel={event => finish(event, false)} onLostPointerCapture={event => finish(event, false)}
      onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat && !disabled && !pending) onUse(); } }} onClick={event => event.preventDefault()}>
      <i aria-hidden="true">{TOOLS[tool].icon}</i><b>{pending ? '…' : TOOLS[tool].name}</b><small aria-hidden="true" className="nj-pips">{Array.from({ length: Math.max(charges, 3) }, (_, i) => <em key={i} className={i < charges ? 'nj-pip-on' : undefined}/>)}</small><small>{charges} {charges === 1 ? 'charge' : 'charges'}</small>
    </ArcadeButton>
    {aim && <span className="nj-aim-arrow" aria-hidden="true"/>}
  </span>;
}
