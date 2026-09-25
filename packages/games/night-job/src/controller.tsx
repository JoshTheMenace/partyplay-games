/* Landscape phone controller: stick left, Sneak and Tool right, only your thief's immediate status between. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArcadeButton, HoldButton, SteerPad, type GameViewProps, type StickValue } from '../../../party-ui/src/index';
import type { ActionResult } from '../../../party-contract/src/index';
import { COINS_PER_CHARGE, ROLES, SNEAK_STICK, TOOLS, type Action, type EffectKind, type Input, type View } from './model';
import { getMap } from './maps';
import { CoinMeter, Health, Pips, alarmSeconds, tone } from './hud';

type Props = GameViewProps<Input, Action, View, null>;
type Mode = 'idle' | 'sneak' | 'run';
const ZERO: StickValue = { x: 0, y: 0 };

/** Stick and Sneak merge into one complete {x, y, sneak} hold; neutral or any interruption releases it. */
function useComposer(setInput: (input: Input) => void, releaseInput: (() => void) | undefined, enabled: boolean) {
  const state = useRef({ stick: ZERO, sneak: false }), latest = useRef({ setInput, releaseInput, enabled }), [mode, setMode] = useState<Mode>('idle');
  latest.current = { setInput, releaseInput, enabled };
  const composer = useMemo(() => {
    const publish = () => {
      const { stick, sneak } = state.current, moving = !!(stick.x || stick.y);
      setMode(!moving ? 'idle' : sneak || Math.hypot(stick.x, stick.y) < SNEAK_STICK ? 'sneak' : 'run');
      if (!latest.current.enabled || (!moving && !sneak)) latest.current.releaseInput?.(); else latest.current.setInput({ x: stick.x, y: stick.y, sneak });
    };
    return {
      stick(value: StickValue) { state.current.stick = value; publish(); },
      sneak(held: boolean) { state.current.sneak = held; publish(); },
      release() { state.current = { stick: ZERO, sneak: false }; setMode('idle'); latest.current.releaseInput?.(); },
    };
  }, []);
  useEffect(() => {
    const cancel = () => composer.release(), hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel); window.addEventListener('pagehide', cancel); document.addEventListener('visibilitychange', hidden);
    return () => { cancel(); window.removeEventListener('blur', cancel); window.removeEventListener('pagehide', cancel); document.removeEventListener('visibilitychange', hidden); };
  }, [composer]);
  useEffect(() => { if (!enabled) composer.release(); }, [enabled, composer]);
  return { ...composer, mode };
}

/** One acknowledged tool action at a time. The server owns charges; a rejection is shown briefly, never guessed. */
function useTool(sendAction: (action: Action) => Promise<ActionResult>, heistId: string) {
  const [pending, setPending] = useState(false), [feedback, setFeedback] = useState<{ text: string } | null>(null), busy = useRef(false), latest = useRef({ sendAction, heistId });
  latest.current = { sendAction, heistId };
  useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(null), 2200); return () => clearTimeout(timer); }, [feedback]);
  const use = async () => {
    if (busy.current) return;
    busy.current = true; setPending(true);
    try { const result = await latest.current.sendAction({ type: 'tool', heistId: latest.current.heistId }); if (!result.accepted) setFeedback({ text: result.reason ?? 'Tool not used.' }); }
    catch { setFeedback({ text: 'Not sent. Try again.' }); }
    finally { busy.current = false; setPending(false); }
  };
  return { pending, feedback: feedback?.text ?? null, use };
}

/** Vibration per effect kind, most severe first. */
const BUZZ: [EffectKind, number | number[]][] = [['down', [140, 60, 260]], ['hurt', 90], ['spotted', [35, 45, 35]]];
/** Buzz once for the most severe new effect that concerns this thief (Effect.player). */
function useHaptics(view: View, playerId: string | null) {
  const last = useRef({ heist: '', effect: 0 });
  useEffect(() => {
    const top = Math.max(-1, ...view.effects.map(e => e.id)), seen = last.current.heist === view.heistId ? last.current.effect : top;
    const buzz = BUZZ.find(([kind]) => view.effects.some(e => e.id > seen && e.kind === kind && e.player === playerId));
    if (buzz && typeof navigator.vibrate === 'function') navigator.vibrate(buzz[1]);
    last.current = { heist: view.heistId, effect: Math.max(seen, top) };
  }, [view, playerId]);
}

export function ControllerView({ publicView: view, playerId, setInput, releaseInput, sendAction, connected = true }: Props) {
  const me = view.players.find(p => p.id === playerId), idle = !connected || !me || me.down || me.suspended || view.phase === 'clear' || view.phase === 'failed';
  const composer = useComposer(setInput, releaseInput, !idle), tool = useTool(sendAction, view.heistId), map = getMap(view.mission);
  useHaptics(view, playerId);
  if (!me) return <div className="night-job nj-controller nj-watching"><section className="nj-me"><small className="nj-kicker">{map.title}</small><strong className="nj-big">You’re watching this job</strong><p className="nj-hint">Follow the crew on the TV. You join the next heist.</p></section></div>;
  const role = ROLES[me.role], kit = TOOLS[me.tool], toNext = COINS_PER_CHARGE - me.coins % COINS_PER_CHARGE, alarm = alarmSeconds(view);
  const line = tool.feedback ?? (me.hint || (view.phase === 'escape' ? 'Bring everyone to the getaway.' : 'Push into doors, safes and terminals to work on them.'));
  return <div className={`night-job nj-controller${me.down ? ' nj-is-down' : ''}${view.alarm ? ' nj-alarm-on' : ''}`} style={tone(me.color, { '--nj-role': role.color })} data-player-id={me.id} data-seat={me.seat + 1} data-phase={view.phase} data-down={me.down} data-mode={composer.mode} data-heist-id={view.heistId}>
    <div className="nj-stick" data-mode={composer.mode}><SteerPad label="Move" onChange={composer.stick} disabled={idle}/></div>
    {me.down || me.suspended ? <section className="nj-me nj-me-down">
      <small className="nj-kicker">Seat {me.seat + 1} · {role.name}</small>
      <strong className="nj-big">{me.suspended ? 'You left the job' : 'You’re down'}</strong>
      <p className="nj-hint" role="status">{me.suspended ? 'Reconnect for the next heist.' : me.hint || 'Hang on. A teammate can push into you to revive you.'}</p>
      <Health value={me.health}/>
    </section> : <section className="nj-me">
      <header className="nj-me-head"><b className="nj-seat kp-numeral">{me.seat + 1}</b><span className="nj-me-name">{me.name}</span><span className="nj-me-role"><i aria-hidden="true">{role.icon}</i>{role.name}</span></header>
      <Health value={me.health}/>
      <p className={`nj-hint${tool.feedback ? ' nj-hint-error' : ''}`} role="status"><span key={line}>{line}</span></p>
      {me.work && <span className="nj-work" role="progressbar" aria-label={me.work.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(me.work.progress * 100)}><i style={{ width: `${Math.min(1, me.work.progress) * 100}%` }}/><b>{me.work.label}</b></span>}
      <div className="nj-badges">
        {me.carrying && <span className="nj-badge nj-badge-carry">◆ You have the {map.objectiveKind}</span>}
        {view.phase === 'escape' && <span className="nj-badge nj-badge-escape">Getaway open · everyone out</span>}
        {view.alarm && <span className="nj-badge nj-badge-alarm">Alarm {alarm}s</span>}
        {me.hidden && <span className="nj-badge nj-badge-hidden">Hidden</span>}
        {me.disguised && <span className="nj-badge nj-badge-hidden">Disguised</span>}
      </div>
      <footer className="nj-me-kit"><span><i aria-hidden="true">{kit.icon}</i>{kit.name}<Pips charges={me.charges}/></span><span className="nj-me-coins"><CoinMeter coins={me.coins}/>{toNext} to a charge</span></footer>
    </section>}
    <div className="nj-actions">
      <HoldButton label="Sneak" onChange={composer.sneak} disabled={idle}>Sneak</HoldButton>
      <ArcadeButton type="button" tone={me.charges > 0 && !tool.pending ? 'coral' : 'ghost'} className="nj-tool" disabled={idle} aria-busy={tool.pending} aria-label={`Use ${kit.name}, ${me.charges} ${me.charges === 1 ? 'charge' : 'charges'}`} data-tool={me.tool} data-charges={me.charges}
        onPointerDown={event => { if (event.button) return; event.preventDefault(); void tool.use(); }} onClick={event => { if (event.detail === 0) void tool.use(); }}>
        <i aria-hidden="true">{kit.icon}</i><b>{tool.pending ? '…' : kit.name}</b><Pips charges={me.charges}/>
      </ArcadeButton>
    </div>
  </div>;
}
