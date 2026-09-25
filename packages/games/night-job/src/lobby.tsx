/* Briefing, crew picker, mission settings and instructions. */
import { useEffect, useRef } from 'react';
import { ArcadeButton, Panel, StatusNotice, ToggleRow, type InstructionsViewProps, type LobbyViewProps, type SettingsViewProps } from '../../../party-ui/src/index';
import { DEFAULT_CHOICE, MISSIONS, ROLES, TOOLS, type Choice, type HeistMap, type MissionId, type Role, type Settings, type Tool } from './model';
import { getMap } from './maps';
import { paintPreview } from './preview';
import { tone } from './hud';

const ROLE_IDS = Object.keys(ROLES) as Role[], TOOL_IDS = Object.keys(TOOLS) as Tool[], MISSION_IDS = Object.keys(MISSIONS) as MissionId[];
const choiceOf = (raw: unknown) => raw as Choice | undefined;

export function Preview({ map, label }: { map: HeistMap; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true; const paint = () => { if (live && ref.current) paintPreview(ref.current, map); };
    paint(); void document.fonts?.ready.then(paint);
    return () => { live = false; };
  }, [map]);
  return <canvas ref={ref} className="nj-preview" role="img" aria-label={label ?? `Blueprint of ${map.title}`}/>;
}

export function LobbyView({ players, playerId, settings, connected, error, onChoice, onReady }: LobbyViewProps<Settings>) {
  const map = getMap(settings?.mission ?? 'velvet'), me = players.find(p => p.id === playerId), choice = choiceOf(me?.lobbyChoice) ?? DEFAULT_CHOICE, sent = useRef(false);
  const missing = !!me && me.lobbyChoice === undefined && !me.ready, ready = players.filter(p => p.ready).length;
  useEffect(() => { if (missing && connected && !sent.current) { sent.current = true; onChoice(DEFAULT_CHOICE); } }, [missing, connected, onChoice]);
  if (!me) return <Panel className="night-job nj-lobby nj-briefing">
    <div className="nj-dossier">
      <small className="nj-kicker">Tonight’s job · {settings?.difficulty === 'relaxed' ? 'Relaxed' : 'Normal'}</small>
      <h2>{map.title}</h2><p className="nj-sub">{map.subtitle}</p><p className="nj-story">{map.briefing}</p>
      <p className="nj-target"><b>Objective</b>{map.objective}, then get the whole crew to the getaway.</p>
    </div>
    <figure className="nj-blueprint"><Preview map={map}/></figure>
    <ol className="nj-roster" aria-label="Crew">
      {players.map((p, i) => { const c = choiceOf(p.lobbyChoice); return <li key={p.id} style={tone(p.color)} data-ready={p.ready}>
        <b className="nj-seat kp-numeral">{i + 1}</b><span className="nj-name">{p.name}</span>
        <span className="nj-pick-line">{c ? <><i aria-hidden="true" style={{ color: ROLES[c.role].color }}>{ROLES[c.role].icon}</i>{ROLES[c.role].name}<span className="nj-dot">·</span><i aria-hidden="true">{TOOLS[c.tool].icon}</i>{TOOLS[c.tool].name}</> : 'Choosing…'}</span>
        <em>{p.ready ? 'Ready' : p.connected ? 'Picking' : 'Offline'}</em>
      </li>; })}
      {Array.from({ length: Math.max(0, 4 - players.length) }, (_, i) => <li key={`open${i}`} className="nj-open"><b className="nj-seat kp-numeral">{players.length + i + 1}</b><span>Open seat · scan the code to join</span></li>)}
    </ol>
  </Panel>;
  const locked = me.ready || !connected;
  return <Panel className="night-job nj-lobby nj-pick" style={tone(ROLES[choice.role].color)}>
    <header className="nj-pick-head"><div><small className="nj-kicker">{map.title}</small><h2>{me.ready ? `Ready, ${me.name}.` : 'Pick your specialist'}</h2></div><span className="nj-ready-count kp-numeral">{ready}/{players.length} ready</span></header>
    {error && <StatusNotice tone="error">{error}</StatusNotice>}
    <div className="nj-roles" role="radiogroup" aria-label="Specialist">{ROLE_IDS.map(id => <button type="button" role="radio" key={id} aria-checked={choice.role === id} aria-description={ROLES[id].description} disabled={locked} className="nj-role-card" style={tone(ROLES[id].color)} onClick={() => onChoice({ role: id, tool: choice.tool })}>
      <i aria-hidden="true">{ROLES[id].icon}</i><strong>{ROLES[id].name}</strong>
      <span className="nj-taken" aria-hidden="true">{players.filter(p => p.id !== me.id && choiceOf(p.lobbyChoice)?.role === id).map(p => <b key={p.id} style={{ background: p.color }}/>)}</span>
    </button>)}</div>
    <p className="nj-pick-desc" aria-hidden="true"><b>{ROLES[choice.role].name}</b> {ROLES[choice.role].description}</p>
    <div className="nj-tools" role="radiogroup" aria-label="Tool, 2 charges, plus 1 every 10 coins you grab">{TOOL_IDS.map(id => <button type="button" role="radio" key={id} aria-checked={choice.tool === id} aria-description={TOOLS[id].description} disabled={locked} className="nj-tool-card" onClick={() => onChoice({ role: choice.role, tool: id })}>
      <i aria-hidden="true">{TOOLS[id].icon}</i><strong>{TOOLS[id].name}</strong>
    </button>)}</div>
    <footer className="nj-pick-foot"><p><b>{ROLES[choice.role].name}</b> with the <b>{TOOLS[choice.tool].name}</b>: {TOOLS[choice.tool].description}<span> 2 charges, +1 every 10 coins you grab.</span></p>
      {me.ready ? <ArcadeButton tone="ghost" disabled={!connected} onClick={() => onReady(false)}>Not ready</ArcadeButton> : <ArcadeButton tone="lime" size="lg" disabled={!connected} onClick={() => onReady(true)}>Ready</ArcadeButton>}</footer>
  </Panel>;
}

export function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  const mission = settings?.mission ?? 'velvet', difficulty = settings?.difficulty ?? 'normal';
  return <div className="night-job nj-settings">
    <div className="nj-missions" role="radiogroup" aria-label="Heist">{MISSION_IDS.map(id => <button type="button" role="radio" key={id} aria-checked={mission === id} disabled={disabled} className="nj-mission-card" onClick={() => onChange({ mission: id, difficulty })}>
      <Preview map={getMap(id)}/><strong>{MISSIONS[id].title}</strong><small>{MISSIONS[id].subtitle}</small>
    </button>)}</div>
    <p className="nj-brief">{getMap(mission).briefing}</p>
    <ToggleRow label="Relaxed · guards hurt and notice less" checked={difficulty === 'relaxed'} disabled={disabled} onChange={relaxed => onChange({ mission, difficulty: relaxed ? 'relaxed' : 'normal' })}/>
  </div>;
}

export const InstructionsView = ({ role }: InstructionsViewProps) => <div className="night-job nj-instructions">
  <h2>Steal it. Then get everyone out.</h2>
  <ul>
    <li><b>Sight is everything.</b> Lit rooms are what your crew can see right now. Guards outside that light are invisible, so move carefully.</li>
    <li><b>One stick does it all.</b> Push into doors, safes, terminals, windows, vents and hiding spots to work on them. A light push sneaks silently; a full push runs and makes noise.</li>
    <li><b>Spotted?</b> A red line means a guard is aiming. Break line of sight with a door, a corner or smoke. Push into a downed teammate to revive them.</li>
    <li><b>Coins are fuel.</b> Every 10 coins you grab refills a tool charge. Loot you leave behind adds 3 seconds each to the final time.</li>
  </ul>
  <p className="kp-muted">{role === 'display' ? 'This screen shows the building. Phones are the controllers.' : 'Stick on the left. Hold Sneak and tap your Tool on the right. Watch the TV.'}</p>
</div>;
