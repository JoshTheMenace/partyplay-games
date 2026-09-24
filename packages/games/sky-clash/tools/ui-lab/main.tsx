/** Fixture-only harness: mounts the real Sky Clash views inside replicas of the shell containers. ?screen=<name>&n=<fighters> */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from '../../../../party-ui/src/index';
import '../../../../party-ui/src/style.css';
import '../../src/style.css';
import { SkyClashArt } from '../../src/art';
import { DEFAULT_SETTINGS, type FighterKind, type FighterView, type GameEvent, type Settings, type View } from '../../src/model';
import { ControllerView } from '../../src/ui/controller';
import { DisplayView } from '../../src/ui/hud';
import { LobbyView } from '../../src/ui/lobby';
import { ResultsView } from '../../src/ui/results';
import { SettingsView } from '../../src/ui/settings';
import { stageImage } from '../../src/ui/assets';
const q = new URLSearchParams(location.search), screen = q.get('screen') ?? 'index', n = Number(q.get('n') ?? 4), now = Date.now();
const NAMES = ['Alexandria Quinn', 'Bartholomew Kidd', 'Chrysanthemum Jo', 'Dominique Lefebv'], COLORS = ['#ff5748', '#28c6e7', '#ffd24a', '#78d955'];
const KINDS: FighterKind[] = ['mario', 'jigglypuff', 'female-wireframe', 'giga-bowser'];
const fighter = (i: number, extra: Partial<FighterView> = {}): FighterView => ({ id: `p${i}`, name: NAMES[i], color: COLORS[i], fighter: KINDS[i], costume: i % 4, team: null, cpu: i === 3 ? 3 : null, connected: true,
  x: -6 + i * 4, y: 0, vx: 0, vy: 0, facing: 1, grounded: true, state: 'idle', stateFrame: 0, move: null, moveFrame: 0, charge: 0, hitlag: 0,
  damage: [0, 57, 118, 212][i], stocks: [4, 3, 1, 2][i], kos: [3, 1, 0, 2][i], falls: [0, 1, 3, 2][i], shield: 100, jumpsLeft: 1, intangible: false, armored: false, launch: 0, combo: 0, dealt: [284, 131, 76, 190][i], ...extra });
const view = (extra: Partial<View> = {}, fighters = Array.from({ length: n }, (_, i) => fighter(i))): View => ({ turnId: 't1', phase: 'fight', phaseEndsAt: now + 2400, endsAt: now + 272_000, frame: 900, stageId: 'battlefield', stageTick: 900, hazards: true, teams: false, stocks: 4, fighters, projectiles: [], events: [], ...extra });
const ko = (id: number, source: string | undefined, target: string): GameEvent => ({ id, kind: 'ko', frame: 890, x: 0, y: 0, source, target });
const ctx = { roomId: 'r', roundId: 'round-1', viewRole: 'controller' as const, isHost: false, privateView: null, connected: true, serverNowMs: () => Date.now(), setInput: () => {}, releaseInput: () => {}, sendAction: async () => ({ accepted: true }), assetsReady: () => {} };
const seat = (i: number, choice: unknown, ready = false) => ({ id: `p${i}`, name: NAMES[i], color: COLORS[i], connected: i !== 2 || screen !== 'board-offline', ready, lobbyChoice: choice });
const seats = [seat(0, { fighter: 'mario', costume: 1, stage: 'battlefield' }, true), seat(1, { fighter: 'jigglypuff', costume: 0, stage: 'final-destination' }, true), seat(2, { fighter: 'random', costume: 0, stage: 'battlefield' }), seat(3, { fighter: null, costume: 0, stage: null })].slice(0, n);
const lobby = (playerId: string | null, players = seats, settings: Settings = DEFAULT_SETTINGS) => <LobbyView roomId="r" lobbyId="l" players={players} playerId={playerId} isHost={!playerId} settings={settings} connected onChoice={c => console.log('choice', c)} onReady={r => console.log('ready', r)}/>;
function Phone({ children, landscape }: { children: React.ReactNode; landscape?: boolean }) {
  return <main className="kp-shell kp-shell-phone kp-shell-immersive kp-shell-playing"><header className="kp-header"><div className="kp-header-actions"><span className="kp-session-pill">Alexandria <b className="kp-numeral">QX4Z</b></span><button className="kp-btn kp-btn-ghost kp-btn-sm"><span>Full screen</span></button><button className="kp-btn kp-btn-ghost kp-btn-sm"><span>Sound on</span></button></div></header>
    {landscape ? <div className="kp-landscape-controller"><fieldset className="kp-game-viewport">{children}</fieldset></div> : children}</main>;
}
function Display({ children }: { children: React.ReactNode }) {
  return <main className="kp-shell kp-shell-playing"><header className="kp-header"><div className="kp-header-brand"><span className="kp-brand-mark">✦</span><span className="kp-display">Sky Clash</span></div><div className="kp-header-actions"><span className="kp-session-pill"><b className="kp-numeral">QX4Z</b></span><button className="kp-btn kp-btn-ghost kp-btn-sm"><span>Sound on</span></button><button className="kp-btn kp-btn-ghost kp-btn-sm"><span>Room menu</span></button></div></header>{children}</main>;
}
const Scene = ({ children }: { children: React.ReactNode }) => <div className="kp-scene-stage kp-scene-stage-display"><div className="kp-scene-surface" style={{ background: `center / cover url(${stageImage('battlefield')})` }}/><div className="kp-scene-overlay">{children}</div></div>;
function HostLobby() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  return <main className="kp-shell"><header className="kp-header"><div className="kp-header-brand"><span className="kp-brand-mark">✦</span><span className="kp-display">PartyPlay</span></div><div className="kp-header-actions"><span className="kp-session-pill"><b className="kp-numeral">QX4Z</b></span></div></header>
    <div className="kp-room-layout"><aside className="kp-room-rail"><Panel className="kp-join-rail"><p className="kp-eyebrow">Phones, scan to join</p><div style={{ width: 174, height: 174, margin: 'auto', background: '#fff6e5', borderRadius: 12 }}/><div className="kp-code kp-numeral">QX4Z</div></Panel></aside>
      <section className="kp-room-main"><div className="kp-lobby-title"><SkyClashArt/><div><p className="kp-eyebrow">1–4 players · landscape phones</p><h1>Sky Clash</h1><p>Build damage. Send rivals flying.</p></div></div>
        <div className="kp-lobby-launch"><div><p className="kp-eyebrow">2/{seats.length} ready</p><p>Waiting for everyone to be ready.</p></div><button className="kp-btn kp-btn-sun kp-btn-lg"><span>Start game</span></button><button className="kp-btn kp-btn-ghost kp-btn-sm"><span>Settings</span></button></div>
        {screen === 'settings' ? <Panel><SettingsView settings={settings} onChange={setSettings} disabled={false}/></Panel> : lobby(null, seats, { ...settings, cpus: screen === 'board-cpu' ? 3 : 0 })}</section></div></main>;
}
/** Snapshots arrive over time: the first is a silent baseline, the second carries fresh events (KO feed, card shake). */
function LiveHud({ first, next }: { first: View; next?: View }) {
  const [v, setV] = useState(first);
  useEffect(() => { if (!next) return; const t = setTimeout(() => setV(next), 250); return () => clearTimeout(t); }, [next]);
  return <Display><Scene><DisplayView {...ctx} viewRole="display" playerId={null} publicView={v}/></Scene></Display>;
}
const hud = (v: View, next?: View) => <LiveHud first={v} next={next}/>;
const results = (v: View, winners: string[], playerId: string | null) => <Display><Panel className="kp-round-results"><ResultsView outcome={{ complete: true, winners, rows: v.fighters.map((f, i) => ({ playerId: f.id, rank: i + 1 })) }} publicView={v} playerId={playerId}/></Panel></Display>;
const SCREENS: Record<string, () => React.ReactNode> = {
  'lobby-fighter': () => <Phone>{lobby('p3', seats.map((s, i) => i === 3 ? { ...s, lobbyChoice: { fighter: 'marth', costume: 2, stage: null } } : s))}</Phone>,
  'lobby-empty': () => <Phone>{lobby('p3')}</Phone>,
  'lobby-stage': () => <Phone>{lobby('p2', seats.map((s, i) => i === 2 ? { ...s, lobbyChoice: { fighter: 'pikachu', costume: 1, stage: 'battlefield' } } : s))}</Phone>,
  'lobby-ready': () => <Phone>{lobby('p0')}</Phone>,
  board: () => <HostLobby/>, 'board-cpu': () => <HostLobby/>, settings: () => <HostLobby/>,
  controller: () => <Phone landscape><ControllerView {...ctx} playerId="p1" publicView={view()}/></Phone>,
  'controller-ko': () => <Phone landscape><ControllerView {...ctx} playerId="p2" publicView={view({}, [fighter(0), fighter(1), fighter(2, { stocks: 0 }), fighter(3)])}/></Phone>,
  'controller-offline': () => <Phone landscape><ControllerView {...ctx} connected={false} playerId="p0" publicView={view({ phase: 'countdown' })}/></Phone>,
  hud: () => hud(view(), view({ frame: 902, events: [ko(5, 'p0', 'p2'), ko(6, undefined, 'p3'), { id: 7, kind: 'hit', frame: 901, x: 0, y: 0, source: 'p0', target: 'p1', power: .9 }] })),
  'hud-hazard': () => hud(view({ stageId: 'onett', stageTick: 1400 })),
  'hud-count': () => hud(view({ phase: 'countdown', stageId: 'brinstar' })),
  'hud-game': () => hud(view({ phase: 'complete' }, [fighter(0), fighter(1, { stocks: 0 }), fighter(2, { stocks: 0 }), fighter(3, { stocks: 0 })])),
  'hud-max': () => hud(view({ stocks: 5, teams: true }, [0, 1, 2, 3].map(i => fighter(i, { name: ['MMMMMMMMMMMMMMMM', 'WWWWWWWWWWWWWWWW', 'Chrysanthemum Jo', 'Dominique Lefebv'][i], stocks: [5, 4, 1, 0][i], damage: [300, 199, 88, 0][i], team: (i % 2) as 0 | 1, connected: i !== 1 })))),
  'hud-go': () => hud(view({ phase: 'countdown', phaseEndsAt: now + 300 }), view({ frame: 902 })),
  'hud-sd': () => hud(view({}, [fighter(0), fighter(1)]), view({ phase: 'sudden', phaseEndsAt: now + 60_000, frame: 902 }, [fighter(0, { damage: 300, stocks: 1 }), fighter(1, { damage: 300, stocks: 1 })])),
  'hud-sudden': () => hud(view({ phase: 'sudden', phaseEndsAt: now + 41_000, stageId: 'final-destination' }, [fighter(0, { damage: 300, stocks: 1 }), fighter(1, { damage: 300, stocks: 1 })])),
  results: () => results(view({}, Array.from({ length: n }, (_, i) => fighter(i))), ['p0'], null),
  'results-tie': () => results(view({ teams: true }, Array.from({ length: 4 }, (_, i) => fighter(i, { team: (i % 2) as 0 | 1 }))), ['p0', 'p2'], 'p1'),
  'results-phone': () => <Phone><Panel className="kp-round-results"><ResultsView outcome={{ complete: true, winners: ['p0'], rows: [] }} publicView={view()} playerId="p1"/></Panel></Phone>,
  art: () => <div style={{ width: 600, padding: 20 }}><SkyClashArt/></div>,
};
createRoot(document.getElementById('root')!).render(<StrictMode>{(SCREENS[screen] ?? (() => <ul>{Object.keys(SCREENS).map(s => <li key={s}><a href={`?screen=${s}`}>{s}</a></li>)}</ul>))()}</StrictMode>);
