import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Countdown, Eyebrow, HoldButton, Panel, StatusNotice, SteerPad, type GameClientModule, type GameViewProps, type StickValue } from '../../../party-ui/src/index';
import { FIGHTERS, neutralInput, type Action, type Fighter, type FighterKind, type Input, type Presses, type Settings, type View } from './model';
import './style.css';
const loadScene = () => import('./scene'), Arena = lazy(loadScene);
type Props = GameViewProps<Input, Action, View, null>;
type Button = 'jump' | 'attack' | 'special' | 'smash' | 'shield';
const BUTTONS: Button[] = ['jump', 'attack', 'special', 'smash', 'shield'], COUNTED = ['jump', 'attack', 'special', 'smash'] as const, KINDS: FighterKind[] = ['fox', 'falco'];
const MOVE_KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'], KEY_ACTIONS: Record<string, Button> = { j: 'attack', k: 'jump', l: 'special', i: 'smash', shift: 'shield', ' ': 'jump' };
const tone = (color: string) => ({ '--sc-color': color }) as CSSProperties;
const damageColor = (damage: number) => damage <= 0 ? 'var(--kp-cream)' : `hsl(${Math.max(0, 46 - Math.min(1, damage / 160) * 46)} 100% ${62 - Math.min(1, damage / 160) * 8}%)`;
const shieldFraction = (f: Fighter) => Math.max(0, Math.min(1, f.shield / 100));
const num = (value: number) => String(parseFloat(value.toPrecision(4)));
/** Sourced attributes that separate the two fighters; values come straight from the public data. */
const statRows = (kind: FighterKind): [string, string][] => { const f = FIGHTERS[kind]; return [['Ground speed', num(f.speed)], ['Jump', num(f.jump)], ['Weight', num(f.weight)], ['Gravity', num(f.gravity)]]; };
const Pips = ({ count, label, max = count }: { count: number; label: string; max?: number }) => <span className="sc-pips" role="img" aria-label={`${count} ${label}`}>{Array.from({ length: Math.max(max, count) }, (_, i) => <i key={i} className={i < count ? 'sc-pip-on' : undefined}/>)}</span>;
function FighterCard({ f, index }: { f: Fighter; index: number }) {
  const out = f.mode === 'out' || f.stocks <= 0;
  return <article className={`sc-card${out ? ' sc-card-out' : ''}`} style={tone(f.color)} aria-label={`Player ${index + 1} ${f.name}`}>
    <b className="sc-num kp-numeral">{index + 1}</b>
    <div className="sc-card-body"><span className="sc-name">{f.name}</span><span className="sc-kind">{FIGHTERS[f.kind].name}{f.connected ? '' : ' · offline'}{out ? ' · out' : ''}</span></div>
    <span className="sc-damage kp-numeral" style={{ color: out ? undefined : damageColor(f.damage) }}>{out ? 'OUT' : <>{Math.round(f.damage)}<small>%</small></>}</span>
    <div className="sc-card-foot"><Pips count={f.stocks} label="stocks left"/><span className="sc-kos">{f.kos} KO{f.kos === 1 ? '' : 's'}</span></div>
  </article>;
}
function Display({ publicView: view, serverNowMs }: Props) {
  const [banner, setBanner] = useState<string | null>(null), previous = useRef(view.phase), roster = useRef(view.players); roster.current = view.players;
  useEffect(() => {
    if (previous.current === view.phase) return; previous.current = view.phase;
    const text = view.phase === 'fight' ? 'FIGHT!' : view.phase === 'complete' ? (roster.current.filter(p => p.stocks > 0).length <= 1 ? 'GAME!' : 'TIME!') : null;
    if (!text) return; setBanner(text); const timer = setTimeout(() => setBanner(null), 1300); return () => clearTimeout(timer);
  }, [view.phase]);
  const selecting = view.phase === 'select', deadline = view.phase === 'fight' ? view.endsAt : view.phaseEndsAt;
  return <div className={`sky-clash-display sc-phase-${view.phase}`}>
    <header className="sc-top">
      <div className="sc-brand"><span className="kp-display">Sky Clash</span><small>Cloudbreak</small></div>
      <div className="sc-clock"><Eyebrow>{selecting ? 'Picks lock in' : view.phase === 'countdown' ? 'Fight starts in' : view.phase === 'fight' ? 'Time left' : 'Match over'}</Eyebrow>{view.phase === 'complete' ? <output className="kp-numeral">0</output> : <Countdown deadline={deadline} serverNowMs={serverNowMs}/>}</div>
    </header>
    {selecting && <section className="sc-select" aria-live="polite"><h2 className="kp-title">Choose your fighter</h2><ul>{view.players.map((f, i) => <li key={f.id} className={f.chosen ? 'sc-picked' : undefined} style={tone(f.color)}><b className="kp-numeral">{i + 1}</b><span className="sc-name">{f.name}</span><strong>{f.chosen ? FIGHTERS[f.kind].name : f.connected ? 'Choosing…' : 'Offline'}</strong></li>)}</ul><p>{FIGHTERS.fox.name}: {FIGHTERS.fox.description} {FIGHTERS.falco.name}: {FIGHTERS.falco.description} Pick on your phone.</p></section>}
    {view.phase === 'countdown' && <div className="sc-count kp-title" aria-live="polite"><Countdown deadline={view.phaseEndsAt} serverNowMs={serverNowMs}/></div>}
    {banner && <div className="sc-banner kp-title" role="status">{banner}</div>}
    <footer className="sc-cards">{view.players.map((f, i) => <FighterCard key={f.id} f={f} index={i}/>)}</footer>
  </div>;
}
/** Complete held state plus monotonic press counters, coalesced by the shell at 20 Hz. Counters never drop below the server's acknowledged value. */
function useFightInput(me: Fighter | undefined, enabled: boolean, setInput: (input: Input) => void, releaseInput?: () => void) {
  const blank = (): Record<Button, boolean> => ({ jump: false, attack: false, special: false, smash: false, shield: false });
  const held = useRef(neutralInput()), buttons = useRef(blank()), keys = useRef(blank()), pad = useRef<StickValue>({ x: 0, y: 0 }), moveKeys = useRef(new Set<string>()), presses = useRef<Presses | null>(null);
  const latest = useRef({ me, enabled, setInput, releaseInput }); latest.current = { me, enabled, setInput, releaseInput };
  const counters = () => { const ack = latest.current.me?.presses ?? neutralInput().presses, local = presses.current ?? (presses.current = { ...ack }); for (const key of COUNTED) local[key] = Math.max(local[key], ack[key]); return local; };
  const update = () => {
    if (!latest.current.enabled) return;
    const local = counters(), next = { ...held.current };
    for (const name of BUTTONS) next[name] = buttons.current[name] || keys.current[name];
    for (const name of COUNTED) if (next[name] && !held.current[name]) local[name] += 1;
    let { x, y } = pad.current; // Input axes match the pad: +X right, +Y down.
    if (!x && !y) { const has = (...names: string[]) => names.some(n => moveKeys.current.has(n)); x = Number(has('arrowright', 'd')) - Number(has('arrowleft', 'a')); y = Number(has('arrowdown', 's')) - Number(has('arrowup', 'w')); const length = Math.max(1, Math.hypot(x, y)); x /= length; y /= length; }
    held.current = { ...next, x, y, presses: { ...local } }; latest.current.setInput(held.current);
  };
  const cancel = () => { buttons.current = blank(); keys.current = blank(); moveKeys.current.clear(); pad.current = { x: 0, y: 0 }; held.current = { ...neutralInput(), presses: { ...counters() } }; latest.current.releaseInput?.(); };
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancel(); };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null; if (target?.closest('input, textarea, select, [contenteditable="true"]') || !latest.current.enabled) return;
      const name = event.key.toLowerCase(), down = event.type === 'keydown';
      if (MOVE_KEYS.includes(name)) { if (target?.closest('.kp-steer-pad')) return; event.preventDefault(); if (down) moveKeys.current.add(name); else moveKeys.current.delete(name); update(); return; }
      const action = KEY_ACTIONS[name]; if (!action || (name === ' ' && target?.closest('button'))) return;
      event.preventDefault(); if (keys.current[action] !== down) { keys.current[action] = down; update(); }
    };
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey); window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); document.addEventListener('visibilitychange', hidden);
    return () => { cancel(); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => { if (!enabled) cancel(); }, [enabled]);
  return { move: (value: StickValue) => { pad.current = value; update(); }, button: (name: Button) => (down: boolean) => { buttons.current[name] = down; update(); } };
}
function Controller({ publicView: view, playerId, setInput, releaseInput, sendAction, serverNowMs, connected = true }: Props) {
  const index = view.players.findIndex(p => p.id === playerId), me = view.players[index] as Fighter | undefined;
  const out = !!me && (me.mode === 'out' || me.stocks <= 0), fighting = view.phase === 'fight' || view.phase === 'countdown';
  const enabled = !!me && connected && fighting && !out, input = useFightInput(me, enabled, setInput, releaseInput);
  const [pick, setPick] = useState<{ kind: FighterKind; reason?: string } | null>(null);
  useEffect(() => setPick(null), [view.turnId]);
  if (!me) return <Panel className="sky-clash-controller"><StatusNotice>You are watching this match. You will be in the next one.</StatusNotice></Panel>;
  const choose = async (kind: FighterKind) => { setPick({ kind }); const result = await sendAction({ turnId: view.turnId, kind }); if (!result.accepted) setPick({ kind, reason: result.reason ?? 'That pick was not accepted. Try again.' }); };
  const head = <header className="sc-me" style={tone(me.color)}><b className="sc-num kp-numeral">{index + 1}</b><div className="sc-me-body"><strong className="sc-name">{me.name}</strong><span>{FIGHTERS[me.kind].name}</span></div>{fighting && <span className="sc-damage kp-numeral" style={{ color: damageColor(me.damage) }}>{Math.round(me.damage)}<small>%</small></span>}<Pips count={me.stocks} label="stocks left"/><div className="sc-clock"><Eyebrow>{view.phase === 'select' ? 'Picks lock' : view.phase === 'countdown' ? 'Starts' : 'Left'}</Eyebrow><Countdown deadline={view.phase === 'fight' ? view.endsAt : view.phaseEndsAt} serverNowMs={serverNowMs}/></div></header>;
  if (view.phase === 'select') {
    const pending = !!pick && !pick.reason && !me.chosen;
    return <Panel className="sky-clash-controller sc-select-phone">{head}
      <h2 className="kp-title">{me.chosen ? 'Locked in' : 'Choose your fighter'}</h2>
      <div className="sc-choices">{KINDS.map(kind => { const f = FIGHTERS[kind], locked = me.chosen && me.kind === kind, pendingHere = pending && pick?.kind === kind; return <button key={kind} type="button" className={`sc-choice sc-choice-${kind}${locked ? ' sc-choice-locked' : ''}`} style={tone(f.color)} disabled={!connected || me.chosen || pending} aria-pressed={locked} onClick={() => void choose(kind)}>
        <span className="sc-choice-art" aria-hidden="true"><i/><i/><i/><i/></span><span className="sc-choice-text"><Eyebrow>{f.title}</Eyebrow><strong className="kp-display">{f.name}</strong><span>{f.description}</span><dl className="sc-choice-stats">{statRows(kind).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="kp-numeral">{value}</dd></div>)}</dl></span>
        <span className="sc-choice-state">{locked ? 'Locked ✓' : pendingHere ? 'Sending…' : 'Pick'}</span></button>; })}</div>
      {me.chosen ? <StatusNotice tone="success">{FIGHTERS[me.kind].name} is locked in. The fight starts when everyone has picked or time runs out.</StatusNotice> : pick?.reason ? <StatusNotice tone="error">{pick.reason}</StatusNotice> : <p className="kp-muted">No pick before the timer ends gives you {FIGHTERS[me.kind].name}.</p>}
    </Panel>;
  }
  if (out || view.phase === 'complete') return <Panel className="sky-clash-controller sc-watching">{head}<h2 className="kp-title">{view.phase === 'complete' ? 'Match over' : 'Knocked out'}</h2><StatusNotice>{view.phase === 'complete' ? 'Results are on the shared display.' : 'You are out of stocks. Watch the display until the match ends.'}</StatusNotice>
    <ul className="sc-standings">{view.players.map((f, i) => <li key={f.id} style={tone(f.color)}><b className="kp-numeral">{i + 1}</b><span className="sc-name">{f.name}</span><Pips count={f.stocks} label="stocks left"/><span className="kp-numeral">{f.stocks > 0 ? `${Math.round(f.damage)}%` : 'OUT'}</span></li>)}</ul></Panel>;
  const jumpsLeft = Math.max(0, Math.min(2, me.jumps)), charging = me.mode === 'attack' && me.charge > 0;
  return <Panel className="sky-clash-controller sc-fight">{head}
    <div className="sc-status" aria-live="off">
      <span className="sc-stat"><small>Jumps</small><Pips count={jumpsLeft} max={2} label="jumps ready"/></span>
      <span className={`sc-stat${me.recoveryUsed ? ' sc-stat-used' : ''}`}><small>Recovery</small><strong>{me.recoveryUsed ? 'Used' : 'Ready'}</strong></span>
      <span className="sc-stat sc-shield-stat"><small>Shield</small><span className="sc-shield-bar" role="meter" aria-label="Shield strength" aria-valuenow={Math.round(shieldFraction(me) * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${shieldFraction(me) * 100}%` }}/></span></span>
      {charging && <span className="sc-stat sc-stat-go"><small>Charge</small><span className="sc-shield-bar sc-charge-bar" role="meter" aria-label="Smash charge" aria-valuenow={Math.round(me.charge / 60 * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${me.charge / 60 * 100}%` }}/></span></span>}
      {view.phase === 'countdown' && <span className="sc-stat sc-stat-go"><strong>Get ready…</strong></span>}
      {!connected && <span className="sc-stat sc-stat-used"><strong>Reconnecting</strong></span>}
    </div>
    <div className="sc-pad">
      <SteerPad label="Move" onChange={input.move} disabled={!enabled}/>
      <p className="sc-hints">Tilt + Attack aims. Hold Smash to charge. Up + Special recovers. Shield in the air dodges.</p>
      <div className="sc-cluster">
        <div className="sc-row"><div className="sc-act sc-act-shield"><HoldButton label="Shield" onChange={input.button('shield')} disabled={!enabled}/></div><div className="sc-act sc-act-smash"><HoldButton label="Smash" onChange={input.button('smash')} disabled={!enabled}/></div><div className="sc-act sc-act-special"><HoldButton label="Special" onChange={input.button('special')} disabled={!enabled}/></div></div>
        <div className="sc-row sc-row-main"><div className="sc-act sc-act-jump"><HoldButton label="Jump" onChange={input.button('jump')} disabled={!enabled}/></div><div className="sc-act sc-act-attack"><HoldButton label="Attack" onChange={input.button('attack')} disabled={!enabled}/></div></div>
      </div>
    </div>
    <p className="sc-keys kp-muted">Keyboard: arrows / WASD move · J attack · I smash · K or Space jump · L special · Shift shield</p>
  </Panel>;
}
export const client: GameClientModule<Input, Action, Settings, View, null> = {
  SceneView: props => <Suspense fallback={null}><Arena {...props}/></Suspense>,
  DisplayView: Display, ControllerView: Controller,
  SettingsView: ({ settings, onChange, disabled }) => <div className="kp-row sky-clash-settings"><label>Match time<select value={settings.seconds} disabled={disabled} onChange={event => onChange({ ...settings, seconds: Number(event.target.value) })}><option value={60}>1 minute</option><option value={120}>2 minutes</option><option value={180}>3 minutes</option></select></label><label>Stocks<select value={settings.stocks} disabled={disabled} onChange={event => onChange({ ...settings, stocks: Number(event.target.value) })}><option value={1}>1 life</option><option value={3}>3 lives</option><option value={5}>5 lives</option></select></label></div>,
  InstructionsView: ({ role }) => <><h2>Launch your rivals off Cloudbreak.</h2><p>Pick {FIGHTERS.fox.name} or {FIGHTERS.falco.name} on your phone. Hits build damage, and higher damage means farther launches. Fly past the edge of the sky and you lose a stock. The last fighter standing wins; if time runs out, most stocks wins, then lowest damage.</p>{role !== 'display' && <><p>Move with the left pad. Attack strikes where you tilt, on the ground or in the air. Smash is a heavier hit: hold it to charge, release to swing. Tap Jump for a short hop, hold for a full jump, press again in the air for a second jump. Down in the air fast-falls or drops through a floating platform.</p><p>Special fires a laser. Side + Special dashes, up + Special is your fire recovery and aims with the pad, down + Special raises a reflector that bounces lasers. Shield blocks on the ground; in the air it dodges once, and you fall until you land. Jump straight out of shield.</p></>}<p className="kp-muted">Movement and attack numbers come from published original parameter data. Collisions, specials and animation are reconstructions, and both fighters are newly made replacement models.</p></>,
  ResultsView: ({ outcome, publicView: view }) => {
    const rows = [...outcome.rows].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)), winners = outcome.winners.map(id => view.players.find(p => p.id === id)?.name ?? 'Player');
    return <div className="sky-clash-results"><Eyebrow>Cloudbreak</Eyebrow><h1>{winners.length === 1 ? `${winners[0]} rules the sky` : winners.length > 1 ? `${winners.join(' and ')} share the sky` : 'Time!'}</h1>
      <ol>{rows.map(row => { const f = view.players.find(p => p.id === row.playerId); if (!f) return null; const i = view.players.indexOf(f); return <li key={row.playerId} className={outcome.winners.includes(row.playerId) ? 'sc-winner' : undefined} style={tone(f.color)}><span className="sc-rank kp-numeral">#{row.rank ?? '–'}</span><b className="sc-num kp-numeral">{i + 1}</b><div className="sc-card-body"><span className="sc-name">{f.name}</span><span className="sc-kind">{FIGHTERS[f.kind].name}</span></div><dl><div><dt>Stocks</dt><dd>{f.stocks}</dd></div><div><dt>KOs</dt><dd>{f.kos}</dd></div><div><dt>Falls</dt><dd>{f.falls}</dd></div><div><dt>Damage</dt><dd>{Math.round(f.damage)}%</dd></div></dl></li>; })}</ol></div>;
  },
  prepare: ({ role, signal }) => role === 'display' ? loadScene().then(module => module.loadFighterAssets(signal)).then(() => undefined) : undefined, dispose() {},
};
export default client;
