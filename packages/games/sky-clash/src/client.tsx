import { Lobby } from './lobby';
import { StagePreview, StageCard, FighterChoices, FighterDetails } from './selection';
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArcadeButton, Countdown, Eyebrow, HoldButton, Modal, Panel, StatusNotice, SteerPad, TextInput, ToggleRow, type GameClientModule, type GameViewProps, type StickValue } from '../../../party-ui/src/index';
import { FIGHTERS, ROSTER, neutralInput, type Action, type Fighter, type FighterKind, type Input, type Presses, type Settings, type View } from './model';
import { STAGE_IDS, getStage, stageFrame, type StageId } from './stages';
import './style.css';
import { AudioView } from './audio-view';
const loadScene = () => import('./scene'), Arena = lazy(loadScene);
type Props = GameViewProps<Input, Action, View, null>;
type Button = 'jump' | 'attack' | 'special' | 'smash' | 'shield';
const BUTTONS: Button[] = ['jump', 'attack', 'special', 'smash', 'shield'], COUNTED = ['jump', 'attack', 'special', 'smash'] as const;
const SLOTS = ['Special', 'Side + Special', 'Up + Special', 'Down + Special'];
const kindLabel = (kind: FighterKind) => FIGHTERS[kind].name + (FIGHTERS[kind].bonus ? ' · bonus' : '');
const SOURCED = ROSTER.filter(kind => !FIGHTERS[kind].bonus).length, BONUS = ROSTER.length - SOURCED;
function StageSettings({ settings, onChange, disabled }: { settings: Settings; onChange(settings: Settings): void; disabled: boolean }) {
  const hazards = settings.hazards ?? true;
  return <div className="sky-clash-settings">
    <div className="sc-set-fields">
      <label>Match time<select value={settings.seconds} disabled={disabled} onChange={event => onChange({ ...settings, seconds: Number(event.target.value) })}><option value={60}>1 minute</option><option value={300}>5 minutes</option><option value={600}>10 minutes</option><option value={900}>15 minutes</option><option value={1800}>30 minutes</option><option value={0}>Unlimited</option></select></label>
      <label>Stocks<select value={settings.stocks} disabled={disabled} onChange={event => onChange({ ...settings, stocks: Number(event.target.value) })}><option value={1}>1 life</option><option value={3}>3 lives</option><option value={5}>5 lives</option></select></label>
      <ToggleRow label="Map hazards" checked={hazards} disabled={disabled} onChange={value => onChange({ ...settings, hazards: value })}/>
      <p className="kp-muted">Hazards off removes hazard damage and wind. Moving platforms still move.</p>
    </div>
    <p className="kp-muted">Players choose fighters and vote for maps in the lobby before tapping Ready. Start game locks the votes. Most votes wins; ties are drawn at random.</p>
  </div>;
}
const MOVE_KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'], KEY_ACTIONS: Record<string, Button> = { j: 'attack', k: 'jump', l: 'special', i: 'smash', shift: 'shield', ' ': 'jump' };
const tone = (color: string) => ({ '--sc-color': color }) as CSSProperties;
const damageColor = (damage: number) => damage <= 0 ? 'var(--kp-cream)' : `hsl(${Math.max(0, 46 - Math.min(1, damage / 160) * 46)} 100% ${62 - Math.min(1, damage / 160) * 8}%)`;
const shieldFraction = (f: Fighter) => Math.max(0, Math.min(1, f.shield / 100));
function MenuHeader({ title, subtitle, view, serverNowMs }: { title: string; subtitle: string; view: View; serverNowMs: Props['serverNowMs'] }) {
  return <header className="sc-menu-header"><div><h2>{title}</h2><p>{subtitle}</p></div><div className="sc-clock"><Eyebrow>{view.phase === 'vote' ? 'Vote closes' : 'Auto-pick'}</Eyebrow><Countdown deadline={view.phaseEndsAt} serverNowMs={serverNowMs}/></div></header>;
}
function MapVoteDisplay({ view }: { view: View }) {
  const counts = STAGE_IDS.map(id => ({ id, count: view.mapVotes.filter(v => v.stageId === id).length })).filter(v => v.count).sort((a, b) => b.count - a.count);
  return <section className="sc-select sc-vote-display" aria-live="polite"><h2>Vote for your map</h2><p>{view.mapVotes.length} of {view.players.length} votes · Most votes wins · Ties drawn randomly</p><div className="sc-vote-leaders">{counts.length ? counts.map(v => <article key={v.id}><StagePreview id={v.id}/><strong>{getStage(v.id).name}</strong><span>{v.count} vote{v.count === 1 ? '' : 's'}</span></article>) : <p>All 30 maps are on your phone. Pick one and confirm your vote.</p>}</div><p>{view.players.map(p => `${p.name}: ${view.mapVotes.some(v => v.playerId === p.id) ? 'voted' : p.connected ? 'choosing' : 'offline'}`).join(' · ')}</p></section>;
}
function MapVote({ view, me, connected, sendAction, serverNowMs }: { view: View; me: Fighter; connected: boolean; sendAction: Props['sendAction']; serverNowMs: Props['serverNowMs'] }) {
  const vote = view.mapVotes.find(v => v.playerId === me.id), [preview, setPreview] = useState<StageId>('cloudbreak'), [query, setQuery] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState(''), [details, setDetails] = useState(false);
  const shown = vote?.stageId ?? preview, stage = getStage(shown), list = STAGE_IDS.filter(id => `${getStage(id).name} ${getStage(id).source ?? ''}`.toLowerCase().includes(query.toLowerCase().trim()));
  const confirm = async () => { setPending(true); setError(''); const result = await sendAction({ turnId: view.turnId, stage: shown }); if (!result.accepted) { setPending(false); setError(result.reason ?? 'Vote not accepted. Try again.'); } };
  return <Panel className="sky-clash-controller sc-menu sc-vote-phone">
    <MenuHeader title="Vote for a map" subtitle={`${view.mapVotes.length}/${view.players.length} voted · Most votes wins`} view={view} serverNowMs={serverNowMs}/>
    <div className="sc-menu-tools"><TextInput type="search" aria-label="Search maps" placeholder="Search 30 maps" value={query} disabled={!!vote} onChange={event => setQuery(event.target.value)}/><span className="kp-muted">Ties: random</span></div>
    <div className="sc-map-tiles" role="group" aria-label="Maps" tabIndex={0}>{list.map(id => <button className={`sc-map-tile${shown === id ? ' sc-tile-on' : ''}`} type="button" key={id} style={tone(getStage(id).color)} aria-label={getStage(id).name} aria-pressed={shown === id} disabled={!!vote && id !== shown} onClick={() => setPreview(id)}><StagePreview id={id}/><strong>{getStage(id).name}</strong><small>{view.mapVotes.filter(v => v.stageId === id).length} votes</small></button>)}{!list.length && <p>No maps match that search.</p>}</div>
    <footer className="sc-menu-footer" style={tone(stage.color)}><button className="sc-more" onClick={() => setDetails(true)} aria-label={`Details for ${stage.name}`}><strong>{stage.name}</strong><small>Details</small></button>{vote ? <span className="sc-confirmed" role="status">Vote locked · waiting</span> : <ArcadeButton tone="lime" disabled={!connected || pending} onClick={() => void confirm()}>{pending ? 'Sending…' : 'Vote for this map'}</ArcadeButton>}{error && <p className="sc-menu-error" role="alert">{error}</p>}</footer>
    {details && <Modal title={stage.name} onClose={() => setDetails(false)}><StageCard choice={shown} hazards={view.hazards}/></Modal>}
  </Panel>;
}
const Pips = ({ count, label, max = count }: { count: number; label: string; max?: number }) => <span className="sc-pips" role="img" aria-label={`${count} ${label}`}>{Array.from({ length: Math.max(max, count) }, (_, i) => <i key={i} className={i < count ? 'sc-pip-on' : undefined}/>)}</span>;
function FighterCard({ f, index }: { f: Fighter; index: number }) {
  const out = f.mode === 'out' || f.stocks <= 0;
  return <article className={`sc-card${out ? ' sc-card-out' : ''}`} style={tone(f.color)} aria-label={`Player ${index + 1} ${f.name}`}>
    <b className="sc-num kp-numeral">{index + 1}</b>
    <div className="sc-card-body"><span className="sc-name">{f.name}</span><span className="sc-kind">{kindLabel(f.kind)}{f.connected ? '' : ' · offline'}{out ? ' · out' : ''}</span></div>
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
  const selecting = view.phase === 'select', deadline = view.phase === 'fight' ? view.endsAt : view.phaseEndsAt, stage = getStage(view.stageId), hazard = view.phase === 'fight' ? stageFrame(view.stageId, view.stageTick, view.hazards).hazard : null;
  return <div className={`sky-clash-display sc-phase-${view.phase}`}>
    <header className="sc-top">
      <div className="sc-brand"><span className="kp-display">Sky Clash</span><small>{selecting ? 'Choose fighters first' : view.phase === 'vote' ? 'Vote for a map' : stage.name}</small></div>
      {hazard && (hazard.warning || hazard.active) && <p className={`sc-hazard ${hazard.active ? 'sc-hazard-active' : 'sc-hazard-warn'}`} role="status">{hazard.active ? hazard.label : `${hazard.label} soon`}</p>}
      <div className="sc-clock"><Eyebrow>{selecting ? 'Picks lock in' : view.phase === 'vote' ? 'Voting closes' : view.phase === 'countdown' ? 'Fight starts in' : view.phase === 'fight' ? 'Time left' : 'Match over'}</Eyebrow>{view.phase === 'complete' ? <output className="kp-numeral">0</output> : view.phase === 'fight' && !view.endsAt ? <output aria-label="Unlimited time">∞</output> : <Countdown deadline={deadline} serverNowMs={serverNowMs}/>}</div>
    </header>
    {selecting && <section className="sc-select" aria-live="polite"><h2 className="kp-title">Choose your fighter</h2><ul>{view.players.map((f, i) => <li key={f.id} className={f.chosen ? 'sc-picked' : undefined} style={tone(f.color)}><b className="kp-numeral">{i + 1}</b><span className="sc-name">{f.name}</span><strong>{f.chosen ? kindLabel(f.kind) : f.connected ? 'Choosing…' : 'Offline'}</strong></li>)}</ul><p>Browse fighters on your phone, then lock in. Map voting is next.</p></section>}
    {view.phase === 'vote' && <MapVoteDisplay view={view}/>}
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
  const [pick, setPick] = useState<{ kind: FighterKind; reason?: string } | null>(null), [preview, setPreview] = useState<FighterKind>(me?.kind ?? ROSTER[0]), [details, setDetails] = useState(false);
  const startKind = me?.kind ?? ROSTER[0];
  useEffect(() => { setPick(null); setPreview(startKind); setDetails(false); }, [view.turnId, startKind]);
  if (!me) return <Panel className="sky-clash-controller"><StatusNotice>You are watching this match. You will be in the next one.</StatusNotice></Panel>;
  const choose = async (kind: FighterKind) => { setPick({ kind }); const result = await sendAction({ turnId: view.turnId, kind }); if (!result.accepted) setPick({ kind, reason: result.reason ?? 'That pick was not accepted. Try again.' }); };
  const head = <header className="sc-me" style={tone(me.color)}><b className="sc-num kp-numeral">{index + 1}</b><div className="sc-me-body"><strong className="sc-name">{me.name}</strong><span>{kindLabel(me.kind)}</span></div>{fighting && <span className="sc-damage kp-numeral" style={{ color: damageColor(me.damage) }}>{Math.round(me.damage)}<small>%</small></span>}<Pips count={me.stocks} label="stocks left"/><div className="sc-clock"><Eyebrow>{view.phase === 'select' ? 'Picks lock' : view.phase === 'countdown' ? 'Starts' : 'Left'}</Eyebrow>{view.phase === 'fight' && !view.endsAt ? <output aria-label="Unlimited time">∞</output> : <Countdown deadline={view.phase === 'fight' ? view.endsAt : view.phaseEndsAt} serverNowMs={serverNowMs}/>}</div></header>;
  if (view.phase === 'select') {
    const pending = !!pick && !pick.reason && !me.chosen, shown = me.chosen ? me.kind : preview, f = FIGHTERS[shown];
    return <Panel className="sky-clash-controller sc-select-phone sc-menu">
      <MenuHeader title="Choose your fighter" subtitle={`${me.name} · Map vote next`} view={view} serverNowMs={serverNowMs}/>
      <FighterChoices value={shown} disabled={me.chosen} onChange={setPreview}/>
      <footer className="sc-menu-footer" style={tone(f.color)}>
        <button className="sc-more" onClick={() => setDetails(true)} aria-label={`Details for ${f.name}`}><strong>{f.name}</strong><small>Details</small></button>
        {me.chosen ? <span className="sc-confirmed" role="status">Locked in · waiting</span> : <ArcadeButton tone="lime" disabled={!connected || pending} aria-busy={pending} onClick={() => void choose(shown)}>{pending ? 'Sending…' : `Lock in ${f.name}`}</ArcadeButton>}
        {pick?.reason && <p className="sc-menu-error" role="alert">{pick.reason}</p>}
      </footer>
      {details && <FighterDetails kind={shown} onClose={() => setDetails(false)}/>}
    </Panel>;
  }
  if (view.phase === 'vote') return <MapVote key={view.turnId} view={view} me={me} connected={connected} sendAction={sendAction} serverNowMs={serverNowMs}/>;
  if (out || view.phase === 'complete') return <Panel className="sky-clash-controller sc-watching">{head}<h2 className="kp-title">{view.phase === 'complete' ? 'Match over' : 'Knocked out'}</h2><StatusNotice>{view.phase === 'complete' ? 'Results are on the shared display.' : 'You are out of stocks. Watch the display until the match ends.'}</StatusNotice>
    <ul className="sc-standings">{view.players.map((f, i) => <li key={f.id} style={tone(f.color)}><b className="kp-numeral">{i + 1}</b><span className="sc-name">{f.name}</span><Pips count={f.stocks} label="stocks left"/><span className="kp-numeral">{f.stocks > 0 ? `${Math.round(f.damage)}%` : 'OUT'}</span></li>)}</ul></Panel>;
  const maxJumps = FIGHTERS[me.kind].jumps, jumpsLeft = Math.max(0, Math.min(maxJumps, me.jumps)), charging = me.mode === 'attack' && me.charge > 0, specials = FIGHTERS[me.kind].specials;
  return <Panel className="sky-clash-controller sc-fight">{head}
    <div className="sc-status" aria-live="off">
      <span className="sc-stat"><small>Jumps</small><Pips count={jumpsLeft} max={maxJumps} label="jumps ready"/></span>
      <span className={`sc-stat${me.recoveryUsed ? ' sc-stat-used' : ''}`}><small>Recovery</small><strong>{me.recoveryUsed ? 'Used' : 'Ready'}</strong></span>
      <span className="sc-stat sc-shield-stat"><small>Shield</small><span className="sc-shield-bar" role="meter" aria-label="Shield strength" aria-valuenow={Math.round(shieldFraction(me) * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${shieldFraction(me) * 100}%` }}/></span></span>
      {charging && <span className="sc-stat sc-stat-go"><small>Charge</small><span className="sc-shield-bar sc-charge-bar" role="meter" aria-label="Smash charge" aria-valuenow={Math.round(me.charge / 60 * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${me.charge / 60 * 100}%` }}/></span></span>}
      <span className="sc-stat"><small>Map</small><strong className="sc-stat-map">{getStage(view.stageId).name}</strong></span>
      {view.phase === 'countdown' && <span className="sc-stat sc-stat-go"><strong>Get ready…</strong></span>}
      {!connected && <span className="sc-stat sc-stat-used"><strong>Reconnecting</strong></span>}
    </div>
    <div className="sc-pad">
      <SteerPad label="Move" onChange={input.move} disabled={!enabled}/>
      <dl className="sc-hints sc-specials" aria-label={`${FIGHTERS[me.kind].name} specials`}>{specials.map((name, i) => <div key={SLOTS[i]}><dt>{['Neutral', 'Side', 'Up', 'Down'][i]}</dt><dd>{name}</dd></div>)}</dl>
      <div className="sc-cluster">
        <div className="sc-row"><div className="sc-act sc-act-shield"><HoldButton label="Shield" onChange={input.button('shield')} disabled={!enabled}/></div><div className="sc-act sc-act-smash"><HoldButton label="Smash" onChange={input.button('smash')} disabled={!enabled}/></div><div className="sc-act sc-act-special"><HoldButton label="Special" onChange={input.button('special')} disabled={!enabled}/></div></div>
        <div className="sc-row sc-row-main"><div className="sc-act sc-act-jump"><HoldButton label="Jump" onChange={input.button('jump')} disabled={!enabled}/></div><div className="sc-act sc-act-attack"><HoldButton label="Attack" onChange={input.button('attack')} disabled={!enabled}/></div></div>
      </div>
    </div>
    <p className="sc-keys kp-muted">Keyboard: arrows / WASD move · J attack · I smash · K or Space jump · L special · Shift shield</p>
  </Panel>;
}
export const client: GameClientModule<Input, Action, Settings, View, null> = {
  AudioView,
  allowPortraitController: view => !view || view.phase === 'select' || view.phase === 'vote',
  SceneView: props => <Suspense fallback={null}><Arena {...props}/></Suspense>,
  immersivePhone: true, LobbyView: Lobby, DisplayView: Display, ControllerView: Controller,
  SettingsView: StageSettings,
  InstructionsView: ({ role }) => <><h2>Launch your rivals off the map.</h2><p>Choose one of {ROSTER.length} fighters and vote for one of {STAGE_IDS.length} maps while waiting in the lobby, then tap Ready. The host starts when everyone is ready; most votes wins, with random tie breaking. Matches default to 15 minutes; Unlimited plays until one fighter remains. The host can switch hazards off. Hits build damage, and higher damage means farther launches. Fly past the edge of the sky and you lose a stock. The last fighter standing wins; if time runs out, most stocks wins, then lowest damage.</p>{role !== 'display' && <><p>Move with the left pad. Attack strikes where you tilt, on the ground or in the air. Smash is a heavier hit: hold it to charge, release to swing. Tap Jump for a short hop, hold for a full jump, press again in the air for your extra jumps. Down in the air fast-falls or drops through a floating platform.</p><p>Special alone, with side, up or down, uses your fighter's four specials; your phone lists them by name once you pick. Up + Special is usually your recovery. Shield blocks on the ground; in the air it dodges once, and you fall until you land. Jump straight out of shield.</p></>}<p className="kp-muted">{SOURCED} fighters use imported movement and normal-attack data. Collisions, specials and animation are reconstructions, {BONUS} bonus fighters borrow another fighter's movement profile, and every model is a newly made replacement. Arenas other than Cloudbreak are authored adaptations inspired by classic layouts, not exact recreations.</p></>,
  ResultsView: ({ outcome, publicView: view }) => {
    const rows = [...outcome.rows].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)), winners = outcome.winners.map(id => view.players.find(p => p.id === id)?.name ?? 'Player');
    return <div className="sky-clash-results"><Eyebrow>{getStage(view.stageId).name}</Eyebrow><h1>{winners.length === 1 ? `${winners[0]} rules the sky` : winners.length > 1 ? `${winners.join(' and ')} share the sky` : 'Time!'}</h1>
      <ol>{rows.map(row => { const f = view.players.find(p => p.id === row.playerId); if (!f) return null; const i = view.players.indexOf(f); return <li key={row.playerId} className={outcome.winners.includes(row.playerId) ? 'sc-winner' : undefined} style={tone(f.color)}><span className="sc-rank kp-numeral">#{row.rank ?? '–'}</span><b className="sc-num kp-numeral">{i + 1}</b><div className="sc-card-body"><span className="sc-name">{f.name}</span><span className="sc-kind">{kindLabel(f.kind)}</span></div><dl><div><dt>Stocks</dt><dd>{f.stocks}</dd></div><div><dt>KOs</dt><dd>{f.kos}</dd></div><div><dt>Falls</dt><dd>{f.falls}</dd></div><div><dt>Damage</dt><dd>{Math.round(f.damage)}%</dd></div></dl></li>; })}</ol></div>;
  },
  prepare: ({ role, signal }) => role === 'display' ? loadScene().then(module => module.loadFighterAssets(signal)).then(() => undefined) : undefined, dispose() {},
};
export default client;
