/* The player's input surface: phone controller (TV mode), transparent touch overlay (personal mode) and
 * keyboard/gamepad for a playing host. All sources fold into one held Input (see input.ts); every
 * change goes to setInput AND the input bus so local prediction sees exactly what the server gets. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { GameViewProps } from '../../../../party-ui/src/index';
import { inputBus } from '../input-bus';
import { screenMode } from '../views';
import { PHYSICS } from '../sim/physics';
import type { Action, Input, RaceEventType, RaceView, RacerView } from '../sim/types';
import { InputComposer, keyBinding, keySteer, readPad, steerFromDrag, type HoldKind } from './input';
import { HOLDABLE, ITEM_NAMES, ItemFace } from './icons';
import { character, kartName, ordinalSuffix, Portrait, rankTone, TIER_COLORS } from './common';

type Props = GameViewProps<Input, Action, RaceView, null>;
const TIERS = [0, ...PHYSICS.driftTiers];
/** Haptic patterns (ms) for this racer's own events. */
const BUZZ: Partial<Record<RaceEventType, number | number[]>> = { hit: [60, 40, 90], 'rocket-start': 25, 'boost-pad': 25, wall: 15, ring: [10, 35, 10, 35, 10], spring: [45, 30, 15], bumper: 30, loop: [15, 60, 25, 60, 40] };
/** Capture can throw if the pointer already ended (very fast taps); the hold still works without it. */
const capture = (e: { currentTarget: Element; pointerId: number }) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* already released */ } };
const vibrate = (pattern: number | number[]) => { try { navigator.vibrate?.(pattern); } catch { /* unsupported */ } };

function useCoarsePointer() {
  const query = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
  const [coarse, setCoarse] = useState(!!query?.matches);
  useEffect(() => { if (!query) return; const update = () => setCoarse(query.matches); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  return coarse;
}

/** Owns the composer and every non-touch source plus the release rules. */
function useKartInput(props: Props, me: RacerView | undefined) {
  const latest = useRef(props); latest.current = props;
  const honkAt = useRef(-Infinity), steerKeys = useRef(new Map<string, { dir: number; at: number }>());
  const composer = useMemo(() => new InputComposer(input => { latest.current.setInput(input); inputBus.publish(input); }), []);
  const honk = () => { const now = performance.now(); if (now - honkAt.current < 1500) return; honkAt.current = now; void latest.current.sendAction({ type: 'honk' }).catch(() => {}); };
  /** Cancellation (blur, hidden tab, lost pointer, disconnect): drop the sources, release when nothing is held. */
  const cancel = (prefix = '') => { if ('k:'.startsWith(prefix)) steerKeys.current.clear(); composer.clear(prefix); if (composer.neutral) latest.current.releaseInput?.(); };
  useEffect(() => {
    if (me) composer.seed(me.prevHop, me.prevFire, me.lastSeq);
    composer.flush();
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"], dialog') || document.querySelector('dialog[open]')) return;
      const bind = keyBinding(e.key); if (!bind) return;
      e.preventDefault();
      const down = e.type === 'keydown', source = `k:${e.code || e.key}`;
      if (down && e.repeat) return;
      if ('steer' in bind) {
        if (down) { steerKeys.current.set(source, { dir: bind.steer, at: performance.now() }); if (!keyRaf) keyRaf = requestAnimationFrame(easeKeys); }
        else steerKeys.current.delete(source);
        composer.steer(source, down ? bind.steer * keySteer(0) : 0);
      }
      else if ('hold' in bind) composer.hold(bind.hold, source, down);
      else if (down) honk();
    };
    // Held steering keys ease toward full lock while any is down.
    let keyRaf = 0;
    const easeKeys = () => {
      const now = performance.now();
      for (const [source, k] of steerKeys.current) composer.steer(source, k.dir * keySteer(now - k.at));
      keyRaf = steerKeys.current.size ? requestAnimationFrame(easeKeys) : 0;
    };
    // Gamepad polling runs only while a pad is connected.
    let raf = 0, padHonk = false, hadPads = false;
    const poll = () => {
      const pads = [...(navigator.getGamepads?.() ?? [])].filter(p => p?.connected);
      let steer = 0, drift = false, item = false, brake = false, horn = false;
      for (const pad of pads) { const r = readPad(pad!); steer += r.steer; drift ||= r.drift; item ||= r.item; brake ||= r.brake; horn ||= r.honk; }
      composer.steer('g:steer', steer); composer.hold('drift', 'g:a', drift); composer.hold('item', 'g:x', item); composer.hold('brake', 'g:b', brake);
      if (horn && !padHonk) honk(); padHonk = horn;
      raf = pads.length ? requestAnimationFrame(poll) : 0;
      if (!pads.length && hadPads) cancel('g:');
      hadPads = pads.length > 0;
    };
    const padConnected = () => { if (!raf) raf = requestAnimationFrame(poll); };
    const blur = () => cancel(), hidden = () => { if (document.hidden) cancel(); };
    addEventListener('keydown', onKey); addEventListener('keyup', onKey); addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
    addEventListener('gamepadconnected', padConnected); addEventListener('orientationchange', blur); padConnected();
    return () => {
      removeEventListener('keydown', onKey); removeEventListener('keyup', onKey); removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden);
      removeEventListener('gamepadconnected', padConnected); removeEventListener('orientationchange', blur); cancelAnimationFrame(raf); cancelAnimationFrame(keyRaf); cancel();
    };
  }, []);
  useEffect(() => { if (props.connected === false) cancel(); }, [props.connected]);
  return { composer, honk, cancel };
}

/** Floating steering zone: wherever the thumb lands is centre; horizontal travel steers. If the thumb
 * overshoots, the centre follows it so reversing direction never needs a long swipe back. */
function SteerZone({ composer, cancel }: { composer: InputComposer; cancel(prefix?: string): void }) {
  const [touch, setTouch] = useState<{ id: number; ox: number; oy: number; dx: number; r: number } | null>(null);
  const ref = useRef(touch); ref.current = touch;
  const end = (id: number, cancelled: boolean) => {
    if (ref.current?.id !== id) return;
    setTouch(null); ref.current = null;
    if (cancelled) cancel('t:steer'); else composer.steer('t:steer', 0);
  };
  const t = touch, steer = t ? steerFromDrag(t.dx, t.r) : 0;
  return <div className="kp2-steer" aria-label="Steering area: drag left or right" role="application"
    onPointerDown={e => {
      if (ref.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault(); capture(e);
      const box = e.currentTarget.getBoundingClientRect(), r = Math.max(44, Math.min(72, box.height * .19));
      const next = { id: e.pointerId, ox: e.clientX - box.left, oy: e.clientY - box.top, dx: 0, r };
      ref.current = next; setTouch(next);
    }}
    onPointerMove={e => {
      const cur = ref.current; if (cur?.id !== e.pointerId) return;
      const box = e.currentTarget.getBoundingClientRect(), x = e.clientX - box.left;
      let ox = cur.ox, dx = x - ox;
      if (Math.abs(dx) > cur.r) { ox = x - Math.sign(dx) * cur.r; dx = Math.sign(dx) * cur.r; }
      const next = { ...cur, ox, dx }; ref.current = next; setTouch(next);
      composer.steer('t:steer', steerFromDrag(dx, cur.r));
    }}
    onPointerUp={e => end(e.pointerId, false)} onPointerCancel={e => end(e.pointerId, true)} onLostPointerCapture={e => end(e.pointerId, true)}>
    {t ? <span className="kp2-stick" style={{ left: t.ox, top: t.oy, '--r': `${t.r}px` } as CSSProperties}>
      <span className="kp2-stick-track"/><span className="kp2-stick-knob" style={{ transform: `translate(calc(-50% + ${t.dx}px), -50%)`, '--lean': steer } as CSSProperties}/>
    </span> : <span className="kp2-stick kp2-stick-idle" aria-hidden="true"><span className="kp2-stick-track"/><span className="kp2-stick-knob"/><span className="kp2-stick-hint">◀ steer ▶</span></span>}
  </div>;
}

/** Hold button with pointer capture; multiple pointers may hold it at once. */
function PadButton({ kind, composer, cancel, onTap, onHeld, label, className, style, children }: {
  kind?: HoldKind; onHeld?(held: boolean): void; composer: InputComposer; cancel(prefix?: string): void; onTap?(): void; label: string; className: string; style?: CSSProperties; children: ReactNode;
}) {
  const [held, setHeldCount] = useState(0), pointers = useRef(new Set<number>());
  const setHeld = (n: number) => { setHeldCount(n); onHeld?.(n > 0); };
  const up = (id: number, cancelled: boolean) => {
    if (!pointers.current.delete(id)) return;
    setHeld(pointers.current.size);
    if (!kind) return;
    if (cancelled) cancel(`t:${kind}:${id}`); else composer.hold(kind, `t:${kind}:${id}`, false);
  };
  return <button type="button" tabIndex={-1} aria-label={label} aria-pressed={kind ? held > 0 : undefined} className={`kp2-pad ${className} ${held ? 'is-held' : ''}`} style={style}
    onContextMenu={e => e.preventDefault()}
    onPointerDown={e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); capture(e); pointers.current.add(e.pointerId); setHeld(pointers.current.size);
      if (kind) composer.hold(kind, `t:${kind}:${e.pointerId}`, true); else onTap?.();
    }}
    onPointerUp={e => up(e.pointerId, false)} onPointerCancel={e => up(e.pointerId, true)} onLostPointerCapture={e => up(e.pointerId, true)}>{children}</button>;
}

function DriftFace({ me }: { me?: RacerView }) {
  const drifting = !!me && me.drift !== 0, tier = drifting ? me!.driftTier : 0;
  const progress = !drifting ? 0 : tier >= 3 ? 1 : Math.max(0, Math.min(1, (me!.driftCharge - TIERS[tier]) / (TIERS[tier + 1] - TIERS[tier])));
  return <>
    {drifting && <svg className="kp2-drift-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" pathLength="100" strokeDasharray={`${progress * 100} 100`}
      stroke={TIER_COLORS[Math.min(3, tier + 1)]}/></svg>}
    <span className="kp2-pad-label">Drift</span><small>hop</small>
  </>;
}

function Countdown({ race }: { race: RaceView }) {
  const t = race.time;
  const text = t < -3 ? 'Ready' : t < 0 ? String(Math.ceil(-t)) : 'GO!';
  return <span className={`kp2-ctl-count ${t >= 0 ? 'is-go' : ''}`} key={text}>{text}</span>;
}

function Status({ race, me }: { race: RaceView; me: RacerView }) {
  const c = character(me.character), lap = Math.max(1, Math.min(race.laps, me.lap));
  return <div className="kp2-status" aria-live="polite">
    <span className="kp2-status-me"><Portrait index={me.character} size="2.6rem"/><span><b style={{ color: me.color }}>{me.name}</b><small>{c.name} · {kartName(me.kart)}</small></span></span>
    {me.finishTime !== null
      ? <span className="kp2-status-cell kp2-status-finish"><small>Finished</small><b className="kp-numeral">{me.rank}<sup>{ordinalSuffix(me.rank)}</sup></b></span>
      : <>
        <span className={`kp2-status-cell kp2-rank-${rankTone(me.rank)}`}><small>Place</small><b className="kp-numeral">{me.rank}<sup>{ordinalSuffix(me.rank)}</sup><i>/{race.racers.length}</i></b></span>
        <span className="kp2-status-cell"><small>Lap</small><b className="kp-numeral">{lap}<i>/{race.laps}</i></b></span>
      </>}
    <span className="kp2-status-cell kp2-status-item"><small>Item</small><b>{me.rollT > 0 ? 'Rolling…' : me.item ? ITEM_NAMES[me.item] : '—'}</b></span>
  </div>;
}

export function Controller(props: Props) {
  const { publicView: race, playerId, isHost } = props;
  const me = race.racers.find(r => r.id === playerId);
  const mode = screenMode(race.viewMode, playerId, isHost), coarse = useCoarsePointer();
  const { composer, honk, cancel } = useKartInput(props, me);
  // Haptics and the bumper flash for this racer's own moments.
  const seen = useRef<number | null>(null);
  const [bump, setBump] = useState(0);   // id of the bumper knock currently flashing
  useEffect(() => {
    const last = race.events.at(-1)?.id ?? 0;
    if (seen.current !== null) for (const e of race.events) if (e.id > seen.current) {
      if (e.racer !== playerId) continue;
      const buzz = e.type === 'mini-turbo' ? 12 + 10 * (e.value ?? 1) : BUZZ[e.type];
      if (buzz) vibrate(buzz);
      if (e.type === 'bumper') setBump(e.id);
    }
    seen.current = Math.max(seen.current ?? 0, last);
  }, [race.events]);
  useEffect(() => { if (!bump) return; const t = setTimeout(() => setBump(0), 450); return () => clearTimeout(t); }, [bump]);
  const [holdingItem, setHoldingItem] = useState(false);
  const touch = mode === 'controls' || coarse;
  if (!me) return <div className="kp2-ctl kp2-ctl-keys"/>;
  if (!touch) return <div className="kp2-ctl kp2-ctl-keys" data-mode={mode}/>;
  const trailing = me.trailing, holdable = !!me.item && me.rollT <= 0 && HOLDABLE.includes(me.item);
  const tier = me.drift !== 0 ? me.driftTier : -1, finished = me.finishTime !== null;
  const itemCaption = trailing ? 'let go to drop' : me.rollT > 0 ? '' : holdable ? 'tap · hold to trail' : me.item ? 'tap to use' : 'grab a box';
  return <div className={`kp2-ctl kp2-ctl-${mode === 'controls' ? 'full' : 'overlay'}`} data-mode={mode} style={{ '--me': me.color } as CSSProperties}>
    <SteerZone composer={composer} cancel={cancel}/>
    {mode === 'controls' && <Status race={race} me={me}/>}
    {mode === 'controls' && bump > 0 && <div key={bump} className="kp2-hud-bump"/>}
    {mode === 'controls' && <div className="kp2-ctl-center" aria-live="polite">
      {race.time < 1 && <Countdown race={race}/>}
      {race.time < 0 && <span className="kp2-ctl-tip">Press DRIFT just before GO for a rocket start</span>}
      {finished && <span className="kp2-ctl-tip">Nice driving! Watch the big screen.</span>}
    </div>}
    <div className="kp2-cluster">
      <PadButton kind="drift" composer={composer} cancel={cancel} label="Drift and hop (hold)" className={`kp2-drift ${tier >= 0 ? `is-drifting tier-${tier}` : ''} ${me.boostT > 0 ? 'is-boost' : ''}`}><DriftFace me={me}/></PadButton>
      <PadButton kind="item" composer={composer} cancel={cancel} onHeld={setHoldingItem} label={me.item ? `Use ${ITEM_NAMES[me.item]}${holdable ? ' (hold to trail behind)' : ''}` : 'Item (empty)'}
        className={`kp2-item ${me.item || me.rollT > 0 ? '' : 'is-empty'} ${trailing || (holdingItem && holdable) ? 'is-trailing' : ''} ${me.rollT > 0 ? 'is-rolling' : ''}`}>
        <span className="kp2-item-face">{me.item || me.rollT > 0 ? <ItemFace racer={me}/> : <span className="kp2-pad-label">Item</span>}</span>{itemCaption && <small>{itemCaption}</small>}
      </PadButton>
      <PadButton kind="brake" composer={composer} cancel={cancel} label="Brake and reverse (hold)" className="kp2-brake"><span className="kp2-pad-label">Brake</span></PadButton>
      <PadButton composer={composer} cancel={cancel} onTap={honk} label="Honk" className="kp2-honk">
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 13h5l9-6v18l-9-6H4z" fill="currentColor"/><path d="M22 11q4 5 0 10M25 8q7 8 0 16" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round"/></svg>
      </PadButton>
    </div>
  </div>;
}
