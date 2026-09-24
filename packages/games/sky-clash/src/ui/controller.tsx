import { useEffect, useRef } from 'react';
import { HoldButton, StatusNotice, SteerPad, type GameViewProps, type StickValue } from '../../../../party-ui/src/index';
import { FIGHTERS, type Action, type FighterView, type Input, type Presses, type View } from '../model';
import { getStage } from '../stages';
import { Portrait, StockIcons, costumeOf, costumeTone } from './assets';
import { DIRECTIONS, damageColor } from './data';
import { InputEncoder, KEY_BUTTONS, MOVE_KEYS, keyStick, type Button } from './input';
import { placements, seats } from './standings';
import { SwipeButton } from './swipe-button';
type Props = GameViewProps<Input, Action, View, null>;
const buzz = (pattern: number | number[]) => { try { navigator.vibrate?.(pattern); } catch { /* Haptics are optional. */ } };
const loadPresses = (key: string): Partial<Presses> | undefined => { try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? undefined; } catch { return undefined; } };
/**
 * Composes pad, buttons and keyboard into one complete Input. Counters persist per round in sessionStorage and rise to the
 * server echo, so a reload never counts below what the server consumed. Holds release on blur, hidden tab, disable and unmount.
 */
function useFightInput(enabled: boolean, storageKey: string, echo: Presses | undefined, setInput: (i: Input) => void, releaseInput?: () => void) {
  const encoder = useRef<InputEncoder | null>(null); encoder.current ??= new InputEncoder(loadPresses(storageKey));
  const enc = encoder.current; enc.sync(echo);
  const pad = useRef<StickValue>({ x: 0, y: 0 }), keys = useRef(new Set<string>()), landing = useRef(false), touching = useRef(false), released = useRef(true), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ enabled, setInput, releaseInput }); latest.current = { enabled, setInput, releaseInput };
  const push = (force = false) => {
    if (!latest.current.enabled || !force && released.current && enc.neutral()) return;
    released.current = false; latest.current.setInput(enc.input());
    try { sessionStorage.setItem(storageKey, JSON.stringify(enc.presses)); } catch { /* Optional storage. */ }
    clearTimeout(timer.current); const until = enc.deferredUntil;
    if (until !== null) timer.current = setTimeout(() => { if (enc.tick(performance.now())) push(); }, Math.max(0, until - performance.now()) + 1);
  };
  const cancel = () => { clearTimeout(timer.current); enc.release(); pad.current = { x: 0, y: 0 }; keys.current.clear(); if (!released.current) { released.current = true; latest.current.releaseInput?.(); } };
  const stick = () => { const p = pad.current, touch = !!(p.x || p.y), v = touch || !keys.current.size ? p : keyStick(keys.current); enc.stick(v.x, v.y, performance.now(), !touch || !touching.current ? 'key' : landing.current ? 'touch' : 'slide'); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null, name = event.key.toLowerCase(), down = event.type === 'keydown';
      if (!latest.current.enabled || event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, textarea, select, dialog, [contenteditable="true"]')) return;
      if (MOVE_KEYS[name]) { if (target?.closest('.kp-steer-pad')) return; event.preventDefault(); if (down) { if (event.repeat) return; keys.current.add(name); } else keys.current.delete(name); stick(); push(); return; }
      const action = KEY_BUTTONS[name]; if (!action || (name === ' ' && target?.closest('button'))) return;
      event.preventDefault(); if (event.repeat) return;
      if (action === 'grab') { if (down) { enc.grab(); push(true); } return; }
      enc.button(action, down, performance.now(), 'key'); push();
    };
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey); window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', hidden);
    return () => { cancel(); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => { if (!enabled) cancel(); }, [enabled]);
  return {
    // Flicks count only for a thumb sliding on the pad: never its landing sample, and never keys pressed on the focused pad.
    padZone: { onPointerDownCapture: () => { landing.current = touching.current = true; }, onPointerDown: () => { landing.current = false; }, onPointerUp: () => { touching.current = false; }, onPointerCancel: () => { touching.current = false; } },
    move: (v: StickValue) => { pad.current = v; stick(); push(); },
    button: (name: Button) => (down: boolean, swipe?: { x: number; y: number }) => { enc.button(name, down, performance.now(), 'touch', swipe); if (down) buzz(swipe ? 12 : 6); push(); },
    /** Dedicated Grab (Melee's Z): one press, so dash and pivot grabs never need two right-thumb buttons. */
    grab: (down: boolean) => { if (!down) return; enc.grab(); buzz(6); push(true); },
  };
}
/** Short haptics for your own hits taken and KOs. The first snapshot is a baseline, so reconnects stay quiet. */
function useHaptics(view: View, me: string) {
  const seen = useRef<{ turn: string; id: number } | null>(null);
  useEffect(() => {
    const max = view.events.reduce((m, e) => Math.max(m, e.id), -1), last = seen.current?.turn === view.turnId ? seen.current.id : null;
    if (last !== null) for (const e of view.events) if (e.id > last && e.target === me) { if (e.kind === 'ko') buzz([40, 30, 90]); else if (e.kind === 'hit') buzz(Math.round(12 + 38 * (e.power ?? .3))); else if (e.kind === 'shieldbreak') buzz([30, 20, 30]); }
    seen.current = { turn: view.turnId, id: Math.max(last ?? -1, max) };
  }, [view, me]);
}
function MeStrip({ me, view, connected, note, legend }: { me: FighterView; view: View; connected: boolean; note?: string; legend?: string }) {
  const out = me.stocks <= 0;
  return <header className="sc-me" style={costumeTone(me.fighter, me.costume, { '--sc-player': me.color })}>
    <Portrait kind={me.fighter} costume={me.costume} className="sc-me-portrait"/>
    <div className="sc-me-id"><strong>{me.name}</strong><small>{FIGHTERS[me.fighter].name} · {costumeOf(me.fighter, me.costume).name}</small></div>
    <StockIcons f={me} max={view.stocks}/>
    {note ? <span className="sc-me-note">{note}</span> : legend && <span className="sc-legend">{legend}</span>}
    {!connected && <span className="sc-me-badge" role="status">Reconnecting…</span>}
    <span className="sc-me-damage kp-numeral" style={{ color: out ? undefined : damageColor(me.damage) }} aria-label={out ? 'Out' : `${Math.round(me.damage)} percent damage`}>{out ? 'OUT' : <>{Math.round(me.damage)}<small>%</small></>}</span>
  </header>;
}
export function ControllerView({ publicView: view, playerId, roundId, setInput, releaseInput, connected = true }: Props) {
  const me = view.fighters.find(f => f.id === playerId), live = !!me && me.stocks > 0 && view.phase !== 'complete';
  const enabled = live && connected;
  const input = useFightInput(enabled, `sky-clash.presses:${roundId}:${playerId}`, me?.presses, setInput, releaseInput);
  useHaptics(view, playerId ?? '');
  if (!me) return <section className="sky-clash-controller sc-watch"><div className="sc-watch-body"><h2 className="kp-title">You’re watching</h2><StatusNotice>You joined after this match began. Enjoy it on the big screen; you’ll fight in the next one.</StatusNotice></div></section>;
  if (!live) {
    const place = placements(seats(view)).find(p => p.f.id === me.id)?.place, done = view.phase === 'complete';
    return <section className="sky-clash-controller sc-watch"><MeStrip me={me} view={view} connected={connected}/>
      <div className="sc-watch-body"><h2 className="kp-title">{done ? place === 1 ? 'Victory!' : 'Game!' : 'Knocked out!'}</h2>
        <p>{done ? `You placed #${place ?? '–'}. Results are coming up on the big screen.` : `Out of stocks${place ? ` · #${place}` : ''}. Cheer from the sidelines until the match ends.`}</p>
        <p className="sc-watch-stats"><span><b className="kp-numeral">{me.kos}</b> KOs</span><span><b className="kp-numeral">{me.falls}</b> falls</span>{me.dealt !== undefined && <span><b className="kp-numeral">{Math.round(me.dealt)}%</b> dealt</span>}</p></div></section>;
  }
  const specials = FIGHTERS[me.fighter].specials;
  const note = view.phase === 'countdown' ? 'Get ready!' : view.phase === 'sudden' ? 'Sudden death!' : me.state === 'respawn' ? 'Respawning' : !me.connected ? 'Offline' : undefined;
  return <section className="sky-clash-controller sc-fight" aria-label={`${me.name} controls on ${getStage(view.stageId).name}`}>
    <MeStrip me={me} view={view} connected={connected} note={note} legend="Swipe: Special ↑ recovers · Attack smashes"/>
    <div className="sc-controls">
      <div className="sc-pad-zone" {...input.padZone}><SteerPad label="Move" onChange={input.move} disabled={!enabled}/></div>
      <dl className="sc-move-hint" aria-label={`${FIGHTERS[me.fighter].name} specials`}>{specials.map((name, i) => <div key={i}><dt aria-label={DIRECTIONS[i].label}>{DIRECTIONS[i].arrow}</dt><dd>{name}</dd></div>)}</dl>
      <div className="sc-cluster">
        <div className="sc-btn sc-btn-shield"><HoldButton label="Shield" onChange={input.button('shield')} disabled={!enabled}/></div>
        <div className="sc-btn sc-btn-grab"><HoldButton label="Grab" onChange={input.grab} disabled={!enabled}/></div>
        <div className="sc-btn sc-btn-jump"><HoldButton label="Jump" onChange={input.button('jump')} disabled={!enabled}/></div>
        <div className="sc-btn sc-btn-special"><SwipeButton label="Special" onChange={input.button('special')} disabled={!enabled}/></div>
        <div className="sc-btn sc-btn-attack"><SwipeButton label="Attack" onChange={input.button('attack')} disabled={!enabled}/></div>
      </div>
    </div>
  </section>;
}
