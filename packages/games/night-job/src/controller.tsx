/* Landscape phone controller: stick left, Sneak and Tool right, only your thief's immediate status between. */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArcadeButton, HoldButton, SteerPad, type GameViewProps, type StickValue } from '../../../party-ui/src/index';
import type { ActionResult } from '../../../party-contract/src/index';
import { COINS_PER_CHARGE, CREWS, ROLES, SNEAK_STICK, TOOLS, type Action, type EffectKind, type Input, type View } from './model';
import { getMap } from './maps';
import { Board, CoinMeter, Health, Pips, alarmSeconds, lineStatus, sunrise, tone } from './hud';
import { mountTactical, type TacticalSource } from './tactical';
import { crewOf, decode, ownView, type Own, type Wire } from './wire';

type Props = GameViewProps<Input, Action, Wire, Own>;
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

/** The crew's floor plan, following this seat's thief (crew nights only: with one crew the TV is the map). */
function Plan({ source }: { source: TacticalSource }) {
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef(source); latest.current = source;
  useEffect(() => mountTactical(canvas.current!, () => latest.current), []);
  return <canvas ref={canvas} className="nj-plan" aria-label="Floor plan around your thief: lit where your crew can see, blueprint elsewhere"/>;
}
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

export function ControllerView({ publicView, privateView, playerId, setInput, releaseInput, sendAction, serverNowMs, connected = true }: Props) {
  const night = decode(publicView), view = ownView(publicView, privateView, playerId) ?? night.cast, rival = night.rival;
  const me = view.players.find(p => p.id === playerId), over = view.phase === 'clear' || view.phase === 'failed', idle = !connected || !me || me.down || me.suspended || over;
  const composer = useComposer(setInput, releaseInput, !idle), tool = useTool(sendAction, view.heistId), map = getMap(view.mission);
  useHaptics(view, playerId);
  if (!me) return <div className="night-job nj-controller nj-watching"><section className="nj-me"><small className="nj-kicker">{map.title}</small><strong className="nj-big">You’re watching this job</strong><p className="nj-hint">Follow the {rival ? 'crews' : 'crew'} on the TV. You join the next heist.</p></section></div>;
  const role = ROLES[me.role], kit = TOOLS[me.tool], toNext = COINS_PER_CHARGE - me.coins % COINS_PER_CHARGE, alarm = alarmSeconds(view);
  const line = tool.feedback ?? (me.hint || (view.phase === 'escape' ? 'Bring everyone to the getaway.' : 'Push into doors, safes and terminals to work on them.'));
  const stick = <div className="nj-stick" data-mode={composer.mode}><SteerPad label="Move" onChange={composer.stick} disabled={idle}/></div>;
  const actions = <div className="nj-actions">
    <HoldButton label="Sneak" onChange={composer.sneak} disabled={idle}>Sneak</HoldButton>
    <ArcadeButton type="button" tone={me.charges > 0 && !tool.pending ? 'coral' : 'ghost'} className="nj-tool" disabled={idle} aria-busy={tool.pending} aria-label={`Use ${kit.name}, ${me.charges} ${me.charges === 1 ? 'charge' : 'charges'}`} data-tool={me.tool} data-charges={me.charges}
      onPointerDown={event => { if (event.button) return; event.preventDefault(); void tool.use(); }} onClick={event => { if (event.detail === 0) void tool.use(); }}>
      <i aria-hidden="true">{kit.icon}</i><b>{tool.pending ? '…' : kit.name}</b><Pips charges={me.charges}/>
    </ArcadeButton>
  </div>;
  const data = { 'data-player-id': me.id, 'data-seat': me.seat + 1, 'data-phase': view.phase, 'data-down': me.down, 'data-mode': composer.mode, 'data-heist-id': view.heistId };
  if (rival) {
    // Crew night: the TV is a broadcast, so the phone carries the map and the controls float over it.
    const crew = crewOf(night, playerId), mine = night.lines[crew], name = CREWS[crew].name;
    return <div className={`night-job nj-controller nj-rival${me.down ? ' nj-is-down' : ''}${view.alarm ? ' nj-alarm-on' : ''}`} style={tone(me.color, { '--nj-role': role.color, '--nj-crew': CREWS[crew].color })} {...data} data-crew={crew} data-place={mine.place} data-x={me.x} data-y={me.y}>
      <Plan source={{ view, time: publicView.now, me: playerId, now: serverNowMs() }}/>
      <header className="nj-bar">
        <span className="nj-bar-crew"><b className="nj-seat kp-numeral">{me.seat + 1}</b><span><strong>{name}</strong><small><i aria-hidden="true">{role.icon}</i>{role.name}</small></span></span>
        <span className="nj-bar-vitals"><Health value={me.health}/><span><i aria-hidden="true">{kit.icon}</i><Pips charges={me.charges}/><CoinMeter coins={me.coins}/></span></span>
        <span className="nj-bar-night"><b className="kp-numeral">{ordinal(mine.place)}</b><small className={night.lastCall ? 'nj-last-call' : undefined}>{sunrise(night)}</small></span>
      </header>
      {over || me.suspended ? <section className={`nj-finish nj-finish-${view.phase}`} role="status">
        <small className="nj-kicker">The {name}</small>
        <strong className="nj-big">{me.suspended ? 'You left the job' : view.phase === 'clear' ? 'You’re away!' : 'Out of the night'}</strong>
        <p className="nj-hint">{view.phase === 'clear' ? `${ordinal(mine.place)} so far. Watch the other crews on the TV.` : view.message || 'Watch the other crews on the TV.'}</p>
        <Board night={night} mine={crew}/>
      </section> : <p className={`nj-say${tool.feedback ? ' nj-hint-error' : ''}${me.down ? ' nj-say-down' : ''}`} role="status"><span key={line}>{me.work ? <b style={{ '--p': Math.min(1, me.work.progress) } as CSSProperties}>{me.work.label}</b> : me.down ? me.hint || 'You’re down. A teammate can push into you to revive you.' : line}</span></p>}
      <div className="nj-flags">
        {me.carrying && <span className="nj-badge nj-badge-carry">◆ You have the {map.objectiveKind}</span>}
        {view.phase === 'escape' && !me.carrying && <span className="nj-badge nj-badge-escape">Everyone to the getaway</span>}
        {view.alarm && <span className="nj-badge nj-badge-alarm">Alarm {alarm}s</span>}
        {me.hidden && <span className="nj-badge nj-badge-hidden">Hidden</span>}
        {me.disguised && <span className="nj-badge nj-badge-hidden">Disguised</span>}
        {mine.phase !== 'clear' && mine.phase !== 'failed' && <span className="nj-badge nj-badge-line">{lineStatus(mine, map.objectiveKind)}{mine.bails ? ` · ${mine.bails} bail${mine.bails > 1 ? 's' : ''}` : ''}</span>}
      </div>
      {stick}{actions}
    </div>;
  }
  return <div className={`night-job nj-controller${me.down ? ' nj-is-down' : ''}${view.alarm ? ' nj-alarm-on' : ''}`} style={tone(me.color, { '--nj-role': role.color })} {...data}>
    {stick}
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
    {actions}
  </div>;
}
