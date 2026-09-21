import { useEffect, useRef, type CSSProperties } from 'react';
import { ArcadeButton, Eyebrow, HoldButton, Panel, StatusNotice, SteerPad, ToggleRow, type GameClientModule, type GameViewProps, type LobbyViewProps, type ResultsViewProps, type SettingsViewProps } from '../../../party-ui/src/index';
import { DEFAULT_CHOICE, MISSIONS, ROLES, TOOLS, type Action, type Choice, type HeistMap, type Input, type MissionId, type PlayerView, type Role, type Settings, type Tool, type View } from './model';
import { getMap } from './maps';
import { NightJobScene } from './scene';
import { AudioView } from './audio';
import { AIMED, ToolButton, useComposer, useTool } from './controls';
import { paintPreview } from './render';
import './style.css';

type Props = GameViewProps<Input, Action, View, null>;
const ROLE_IDS = Object.keys(ROLES) as Role[], TOOL_IDS = Object.keys(TOOLS) as Tool[], MISSION_IDS = Object.keys(MISSIONS) as MissionId[];
const mapFor = (mission?: MissionId) => getMap(mission ?? 'velvet') ?? getMap('velvet');
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const healthStyle = (health: number) => ({ width: `${Math.max(0, Math.min(100, health))}%`, background: health > 50 ? 'var(--kp-lime)' : health > 25 ? 'var(--kp-sun)' : 'var(--kp-coral)' });
const tone = (color: string) => ({ '--nj-color': color }) as CSSProperties;
const objectiveText = (view: View, map: HeistMap) => view.phase === 'infiltrate' ? map.objective : view.phase === 'escape' ? 'Get the whole crew to the getaway' : view.phase === 'clear' ? 'Clean getaway' : 'The crew was caught';
const status = (p: PlayerView) => !p.connected ? 'Offline' : p.suspended ? 'Left the job' : p.down ? 'Down · needs rescue' : p.work ? p.work.label : p.hidden ? 'Hidden' : p.disguised ? 'Disguised' : null;

function Preview({ map }: { map: HeistMap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) paintPreview(ref.current, map); }, [map]);
  return <canvas ref={ref} className="nj-preview" aria-hidden="true"/>;
}

function CrewCard({ p, index }: { p: PlayerView; index: number }) {
  const role = ROLES[p.role], state = status(p);
  return <article className={`nj-crew-card${p.down ? ' nj-down' : ''}`} style={tone(p.color)} aria-label={`${p.name}, ${role.name}`} data-player-id={p.id} data-x={p.x.toFixed(2)} data-y={p.y.toFixed(2)} data-health={Math.round(p.health)} data-down={p.down} data-charges={p.charges} data-coins={p.coins} data-hidden={p.hidden}>
    <b className="nj-seat kp-numeral">{index + 1}</b>
    <div className="nj-crew-body"><span className="nj-name">{p.name}</span><span className="nj-role" style={tone(role.color)}><i aria-hidden="true">{role.icon}</i>{role.name}{p.hidden && <em> · hidden</em>}{p.disguised && <em> · disguised</em>}</span>
      <span className="nj-health" role="img" aria-label={`Health ${Math.round(p.health)}`}><i style={healthStyle(p.health)}/></span></div>
    <div className="nj-crew-kit"><span className="nj-tool-chip" aria-label={`${TOOLS[p.tool].name}, ${p.charges} charges`}><i aria-hidden="true">{TOOLS[p.tool].icon}</i>{p.charges}</span><span className="nj-coins" aria-label={`${p.coins} coins`}>◆ {p.coins}<i style={{ width: `${(p.coins % 10) * 10}%` }}/></span></div>
    {state && !p.hidden && !p.disguised && <em className={`nj-state${p.down ? ' nj-state-down' : p.work ? ' nj-state-work' : ''}`}>{state}</em>}
    {p.work && <progress className="nj-work" max={1} value={Math.max(0, Math.min(1, p.work.progress))} aria-label={p.work.label}/>}
  </article>;
}

/** Shared-screen HUD: mission, stopwatch, loot and crew around the floor. Measured so the canvas centres in the gap. */
function Display({ publicView: view }: Props) {
  const map = mapFor(view.mission), root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current, stage = element?.closest<HTMLElement>('.kp-scene-stage'); if (!element || !stage) return;
    const head = element.querySelector<HTMLElement>('.nj-top')!, foot = element.querySelector<HTMLElement>('.nj-crew')!;
    const fit = () => { stage.style.setProperty('--nj-head', `${head.offsetHeight + 4}px`); stage.style.setProperty('--nj-foot', `${foot.offsetHeight + 4}px`); };
    const observer = new ResizeObserver(fit); observer.observe(head); observer.observe(foot); fit();
    return () => { observer.disconnect(); stage.style.removeProperty('--nj-head'); stage.style.removeProperty('--nj-foot'); };
  }, []);
  return <div ref={root} className={`night-job nj-hud${view.alarm ? ' nj-alarm-on' : ''}`} data-phase={view.phase} data-elapsed={Math.floor(view.elapsed)} data-collected={view.collected} data-total={view.totalLoot} data-alarm={view.alarm} data-heist-id={view.heistId}>
    <header className="nj-top">
      <div className="nj-mission"><Eyebrow>{map.title}</Eyebrow><strong key={view.phase} className="nj-objective">{objectiveText(view, map)}</strong></div>
      <div className="nj-stats">
        <div className="nj-stat"><small>Time</small><b className="kp-numeral">{clock(view.elapsed)}</b></div>
        <div className="nj-stat"><small>Loot</small><b className="kp-numeral">{view.collected}<span>/{view.totalLoot}</span></b></div>
        <div key={`${view.phase}${view.alarm}`} className={`nj-phase nj-phase-${view.phase}`} role="status">{view.alarm ? 'Alarm!' : view.phase === 'escape' ? 'Escape' : view.phase === 'infiltrate' ? 'Quiet' : view.phase}</div>
      </div>
      <p className="nj-message" role="status">{view.message}</p>
    </header>
    <footer className="nj-crew">{view.players.map((p, i) => <CrewCard key={p.id} p={p} index={i}/>)}</footer>
  </div>;
}

/** The phone is the controller and nothing else: movement left, Sneak and Tool right, your thief's status between. */
function Controller({ publicView: view, playerId, setInput, releaseInput, sendAction, connected = true }: Props) {
  const me = view.players.find(p => p.id === playerId), seat = view.players.findIndex(p => p.id === playerId), composer = useComposer(setInput, releaseInput, connected), tool = useTool(sendAction, view.heistId), map = mapFor(view.mission);
  if (!me) return <StatusNotice>Watching the crew on the TV. You join the next job.</StatusNotice>;
  const role = ROLES[me.role], state = status(me), idle = !connected || me.down || me.suspended;
  const line = tool.feedback ?? (me.down ? 'You’re down. A teammate must push toward you.' : state === 'Hidden' ? 'Hidden. Stay still until the guard gives up.' : state) ?? (view.phase === 'escape' ? 'Goods secured. Bring everyone to the getaway.' : 'Watch the TV. Push into doors, safes and terminals to work on them.');
  return <div className={`night-job nj-controller${view.alarm ? ' nj-alarm-on' : ''}${me.down ? ' nj-down' : ''}`} style={{ ...tone(me.color), '--nj-role': role.color } as CSSProperties} data-player-id={me.id} data-seat={seat + 1} data-x={me.x.toFixed(2)} data-y={me.y.toFixed(2)} data-phase={view.phase} data-down={me.down} data-hidden={me.hidden} data-health={Math.round(me.health)} data-charges={me.charges} data-coins={me.coins} data-heist-id={view.heistId}>
    <div className="nj-ctl-top" role="status"><span className="nj-ctl-objective"><small>{map.title}</small><strong key={view.phase}>{objectiveText(view, map)}</strong></span><b className="kp-numeral">{clock(view.elapsed)}</b><span className={`nj-ctl-phase nj-phase-${view.phase}`}>{view.alarm ? 'Alarm!' : `◆ ${view.collected}/${view.totalLoot}`}</span></div>
    <div className="nj-ctl-left"><SteerPad onChange={composer.stick} disabled={idle}/></div>
    <div className="nj-me" role="status">
      <header className="nj-me-head"><b className="nj-seat kp-numeral">{seat + 1}</b><span className="nj-me-name">{me.name}</span><span className="nj-me-role"><i aria-hidden="true">{role.icon}</i>{role.name}</span></header>
      <span className="nj-health" role="img" aria-label={`Health ${Math.round(me.health)}`}><i style={healthStyle(me.health)}/></span>
      <p key={line} className={`nj-me-line${tool.feedback ? ' nj-me-error' : me.down ? ' nj-me-down' : me.hidden ? ' nj-me-hidden' : ''}`}>{line}</p>
      {me.work && <progress className="nj-work" max={1} value={Math.max(0, Math.min(1, me.work.progress))} aria-label={me.work.label}/>}
      <footer className="nj-me-kit"><span><i aria-hidden="true">{TOOLS[me.tool].icon}</i>{TOOLS[me.tool].name} · {me.charges}</span><span className="nj-coins">◆ {me.coins} · {10 - me.coins % 10} to a charge<i style={{ width: `${(me.coins % 10) * 10}%` }}/></span></footer>
    </div>
    <div className="nj-ctl-right"><HoldButton label="Sneak" onChange={composer.sneak} disabled={idle}>Sneak</HoldButton>
      <ToolButton tool={me.tool} charges={me.charges} pending={tool.pending} disabled={idle} onUse={aim => void tool.use(aim)}/>
      {AIMED.includes(me.tool) && <small className="nj-aim-hint">Drag the tool to aim</small>}</div>
  </div>;
}

function Lobby({ players, playerId, settings, connected, error, onChoice, onReady }: LobbyViewProps<Settings>) {
  const map = mapFor(settings?.mission), me = players.find(p => p.id === playerId), choice = (me?.lobbyChoice as Choice | undefined) ?? DEFAULT_CHOICE, sent = useRef(false);
  const missing = !!me && me.lobbyChoice === undefined && !me.ready;
  useEffect(() => { if (missing && connected && !sent.current) { sent.current = true; onChoice(DEFAULT_CHOICE); } }, [missing, connected, onChoice]);
  const ready = players.filter(p => p.ready).length;
  if (!me) return <Panel className="night-job nj-lobby nj-briefing">
    <div className="nj-brief-copy"><Eyebrow>Tonight’s job</Eyebrow><h2>{map.title}</h2><p className="nj-sub">{map.subtitle}</p><p>{map.briefing}</p><p><strong>Objective:</strong> {map.objective}. Then get the whole crew to the getaway.</p><p className="kp-muted">This screen shows the floor. Phones are the controls.</p></div>
    <Preview map={map}/>
    <ul className="nj-seats" aria-label="Crew">{players.map((p, i) => { const c = p.lobbyChoice as Choice | undefined; return <li key={p.id} style={tone(p.color)}><b className="kp-numeral">{i + 1}</b><span>{p.name}</span><small>{c ? `${ROLES[c.role].name} · ${TOOLS[c.tool].name}` : 'Choosing…'}</small><em>{p.ready ? 'Ready' : p.connected ? 'Picking' : 'Offline'}</em></li>; })}
      {!players.length && <li className="nj-empty">Phones scan the code to join the crew.</li>}</ul>
  </Panel>;
  return <Panel className="night-job nj-lobby nj-pick" style={tone(ROLES[choice.role].color)}>
    <header className="nj-pick-head"><div><Eyebrow>{map.title}</Eyebrow><h2>{me.ready ? `Ready, ${me.name}.` : 'Pick your specialist'}</h2></div><span className="nj-ready-count">{ready}/{players.length} ready</span></header>
    {error && <StatusNotice tone="error">{error}</StatusNotice>}
    <div className="nj-roles" role="radiogroup" aria-label="Specialist">{ROLE_IDS.map(id => <button type="button" role="radio" key={id} aria-checked={choice.role === id} disabled={me.ready || !connected} className="nj-role-card" style={tone(ROLES[id].color)} onClick={() => onChoice({ role: id, tool: choice.tool })}><i aria-hidden="true">{ROLES[id].icon}</i><strong>{ROLES[id].name}</strong><small>{ROLES[id].description}</small></button>)}</div>
    <div className="nj-tools" role="radiogroup" aria-label="Tool">{TOOL_IDS.map(id => <button type="button" role="radio" key={id} aria-checked={choice.tool === id} disabled={me.ready || !connected} className="nj-tool-card" onClick={() => onChoice({ role: choice.role, tool: id })}><i aria-hidden="true">{TOOLS[id].icon}</i><strong>{TOOLS[id].name}</strong><small>{TOOLS[id].description}</small></button>)}</div>
    <footer className="nj-pick-foot"><p>{ROLES[choice.role].name} with the {TOOLS[choice.tool].name.toLowerCase()}. Every ten coins you pick up refills a charge. The TV shows the floor; your phone is the controller.</p>
      {me.ready ? <ArcadeButton tone="ghost" disabled={!connected} onClick={() => onReady(false)}>Not ready · change</ArcadeButton> : <ArcadeButton tone="lime" size="lg" disabled={!connected} onClick={() => onReady(true)}>Ready to play</ArcadeButton>}</footer>
  </Panel>;
}

function MissionSettings({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  const mission = settings?.mission ?? 'velvet', difficulty = settings?.difficulty ?? 'normal';
  return <div className="night-job nj-settings">
    <div className="nj-missions" role="radiogroup" aria-label="Heist">{MISSION_IDS.map(id => { const map = mapFor(id); return <button type="button" role="radio" key={id} aria-checked={mission === id} disabled={disabled} className="nj-mission-card" onClick={() => onChange({ mission: id, difficulty })}><Preview map={map}/><strong>{map.title}</strong><small>{map.subtitle}</small></button>; })}</div>
    <p className="nj-brief">{mapFor(mission).briefing}</p>
    <ToggleRow label="Relaxed · guards hurt less" checked={difficulty === 'relaxed'} disabled={disabled} onChange={relaxed => onChange({ mission, difficulty: relaxed ? 'relaxed' : 'normal' })}/>
  </div>;
}

const Instructions = () => <div className="night-job nj-instructions"><h2>Steal it. Then get everyone out.</h2>
  <p>The TV shows the floor; every phone is a controller. Push against a door, safe or terminal to work on it. Stay out of guards’ sight lines; grey rooms are only what the crew remembers. Coins refill your tool, and the loot you skip costs time on the board.</p>
  <p>Move with the pad on the left. Hold Sneak and tap your Tool on the right. Push toward a downed teammate to revive them. The job is done when the objective is taken and the whole crew stands at the getaway.</p></div>;

function Results({ publicView: view, playerId }: ResultsViewProps<View>) {
  const map = mapFor(view.mission), clear = view.phase === 'clear', missed = view.totalLoot - view.collected;
  return <div className="night-job nj-results" data-phase={view.phase} data-adjusted={view.adjustedSeconds}>
    <Eyebrow>{map.title}</Eyebrow><h1>{clear ? 'Clean getaway.' : 'The job went sideways.'}</h1><p className="nj-sub">{clear ? 'The whole crew made it out.' : view.message}</p>
    <dl className="nj-tally"><div><dt>Time on the job</dt><dd className="kp-numeral">{clock(view.elapsed)}</dd></div><div><dt>Loot</dt><dd className="kp-numeral">{view.collected}<span>/{view.totalLoot}</span></dd></div><div><dt>{missed} missed loot</dt><dd className="kp-numeral">+{missed * 10}s</dd></div><div className="nj-adjusted"><dt>Adjusted time</dt><dd className="kp-numeral">{clock(view.adjustedSeconds)}</dd></div></dl>
    <p className="kp-muted">Each missed loot unit adds ten seconds. {clear ? 'The whole crew shares the result.' : 'No score until the crew gets out.'}</p>
    <ul className="nj-crew-results" aria-label="Crew">{view.players.map((p, i) => <li key={p.id} style={tone(p.color)}><b className="kp-numeral">{i + 1}</b><i aria-hidden="true" style={tone(ROLES[p.role].color)}>{ROLES[p.role].icon}</i><span>{p.name}{p.id === playerId && <small> · You</small>}</span><small>{ROLES[p.role].name} · {TOOLS[p.tool].name} · {p.coins} coins{p.suspended ? ' · left early' : p.down ? ' · down at the end' : ''}</small></li>)}</ul>
  </div>;
}

export const client: GameClientModule<Input, Action, Settings, View, null> = {
  AudioView, immersivePhone: true, SceneView: NightJobScene, LobbyView: Lobby,
  DisplayView: Display, ControllerView: Controller,
  settingsWide: true, SettingsView: MissionSettings, InstructionsView: Instructions, ResultsView: Results,
  prepare() {}, dispose() {},
};
export default client;
