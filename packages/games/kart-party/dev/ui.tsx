/* Dev-only UI mock page (not part of the platform build): renders the real UI components over mock data.
 *   /games/kart-party/ui.html?s=hud&views=1&mode=split&state=final     HUD over a fake scene
 *   ?s=ctl&mode=controls|personal[&tier=2&item=peel&roll=1&trail=1]    controller
 *   ?s=lobby&me=1&n=6   ?s=results&n=10   ?s=settings   ?s=howto        menus
 *   ?s=live&players=3&auto=1                                           real 3D sandbox + HUD */
import { createRoot } from 'react-dom/client';
import { useEffect, useState, type ReactNode } from 'react';
import '../../../party-ui/src/style.css';
import '../src/ui/kart.css';
import { rules } from '../src/server';
import { decodeRaceView } from '../src/net/wire';
import { botInput } from '../src/sim/ai';
import type { ItemId, Race, Settings } from '../src/sim/types';
import type { ViewRect } from '../src/render/types';
import { splitRects } from '../src/render/layout';
import type { RosterPlayer } from '../../../party-contract/src/protocol';
import { SharedHud, ViewportHud } from '../src/ui/Hud';
import { Controller } from '../src/ui/Controller';
import { Lobby } from '../src/ui/Lobby';
import { Results } from '../src/ui/Results';
import { SettingsPanel } from '../src/ui/Settings';
import { Instructions } from '../src/ui/Instructions';
import { ItemIcon, ITEM_NAMES } from '../src/ui/icons';

const q = new URLSearchParams(location.search), num = (k: string, d: number) => Number(q.get(k) ?? d);
const NAMES = ['Maximilian Storm', 'Alexandria Quinn', 'Bartholomew Lee', 'Jo', 'Christopher Rays', 'Anastasia Belle', 'Sam', 'Wolfgang Amadeus', 'Gwendolyn Parker', 'WWWWWWWWWWWWWWWW'];
const COLORS = ['#ff5748', '#28c6e7', '#78d955', '#b58aff', '#ffd24a', '#ff8fc8', '#3fe0c5', '#ff9a1f', '#9fe8ff', '#e3e9f7'];
const humans = Math.max(1, Math.min(10, num('views', num('n', 1))));
const players = Array.from({ length: humans }, (_, i) => ({ id: `p${i}`, name: NAMES[i], color: COLORS[i], lobbyChoice: { character: (i * 3) % 8, kart: (['zoomer', 'bolt', 'tank'] as const)[i % 3] } }));
const settings: Settings = rules.validateSettings({ track: q.get('track') ?? 'palm-bay', laps: 3, gridSize: 10, views: q.get('mode') === 'personal' ? 'personal' : 'tv' });

function makeRace(seconds: number): Race {
  const race = rules.create({ roomId: 'ui', roundId: 'ui', players, seed: num('seed', 3), nowMs: 0 }, settings);
  for (let i = 0; i < Math.round(seconds * 60); i++) rules.tick(race, new Map(race.racers.filter(r => !r.bot).map(r => [r.id, botInput(race, r)] as const)), 1 / 60, i * 16.7);
  return race;
}
function scenario(race: Race) {
  const me = race.racers.find(r => r.id === 'p0')!, st = q.get('state') ?? '';
  if (q.get('item')) { me.item = q.get('item') as ItemId; me.itemCount = me.item === 'triple-nitro' ? 3 : 1; me.rollT = 0; }
  if (q.get('roll')) { me.rollT = 1; me.item = 'bomb'; }
  if (q.get('trail')) me.trailing = true;
  if (q.has('time')) { race.time = num('time', 0); if (race.time < 0) race.phase = 'countdown'; }
  if (q.get('tier')) { me.drift = 1; me.driftTier = num('tier', 1) as 0 | 1 | 2 | 3; me.driftCharge = [0.5, 1.6, 2.9, 4][me.driftTier]; }
  if (st === 'final') { me.lap = race.laps; me.lapStart = race.time - .5; }
  if (st === 'lap') { me.lap = 2; me.lapStart = race.time - .5; }
  if (st === 'ink') me.inkT = 3;
  if (st === 'respawn') me.respawnT = 1;
  if (st === 'finish') { me.finishTime = 132.47; me.rank = 2; }
  if (st === 'wrong') { me.vx = -Math.sin(me.heading) * 20; me.vz = -Math.cos(me.heading) * 20; }
  race.racers.forEach((r, i) => { if (r.id !== 'p0' && i % 3 === 0) { r.item = (['peel', 'shield', 'super', 'comet'] as const)[i % 4]; } });
}

if (q.get('mode') === 'personal') { const real = matchMedia.bind(window); window.matchMedia = (m: string) => m === '(pointer: coarse)' ? { ...real(m), matches: true, addEventListener() {}, removeEventListener() {} } as MediaQueryList : real(m); }
function FakeScene({ children, inline }: { children: ReactNode; inline?: boolean }) {
  return <div style={{ position: inline ? 'absolute' : 'fixed', inset: 0, background: 'linear-gradient(#7fc8ff 0 38%, #ffd9a0 38% 42%, #4f9a55 42% 60%, #555a66 60%)', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', left: '50%', bottom: '10%', width: '18%', aspectRatio: '1.6', transform: 'translateX(-50%)', background: '#ff5748', borderRadius: '30% 30% 12% 12%', border: '4px solid #05071a' }}/>
    {children}
  </div>;
}
const rects = (n: number): ViewRect[] => splitRects(n).slice(0, n);

function Hud() {
  const mode = (q.get('mode') ?? 'split') as 'split' | 'spectator' | 'personal';
  const race = makeRace(num('t', 22)); scenario(race);
  const view = decodeRaceView(rules.publicView(race, { nowMs: 0, phase: 'playing' }));
  const views = mode === 'split' ? humans : 1;
  const seps = views > 1 ? rects(views).map((r, i) => <div key={i} style={{ position: 'absolute', left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, boxShadow: 'inset 0 0 0 2px #05071a' }}/>) : null;
  return <FakeScene>{seps}
    {mode !== 'spectator' && rects(views).map((rect, i) => <ViewportHud key={i} race={view} racer={view.racers.find(r => r.id === `p${i}`)!} rect={rect} viewports={views} showControlsHint={q.has('hint') && i === 0}/>)}
    {splitRects(views).slice(views).map((r, i) => <div key={i} style={{ position: 'absolute', left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, background: i ? '#0b0a14' : '#2a6a3a' }}/>)}
    <SharedHud race={view} followId={mode === 'split' ? null : 'p0'} mode={mode}/>
  </FakeScene>;
}

function Ctl() {
  const mode = q.get('mode') ?? 'controls';
  const [view, setView] = useState(() => { const r = makeRace(num('t', 22)); scenario(r); return decodeRaceView(rules.publicView(r, { nowMs: 0, phase: 'playing' })); });
  const [last, setLast] = useState('');
  useEffect(() => { (window as unknown as { __setView: typeof setView }).__setView = setView; }, []);
  return <main className="kp-shell kp-shell-playing kp-shell-phone kp-shell-immersive">
    <header className="kp-header"><div className="kp-header-actions"><span className="kp-session-pill"><b className="kp-numeral">ABCD</b></span><button className="kp-btn kp-btn-ghost kp-btn-sm"><span>Sound on</span></button></div></header>
    <div className="kp-landscape-controller"><div className="kp-scene-stage kp-scene-stage-controller">
      {mode === 'personal' && <div className="kp-scene-surface"><FakeScene inline>
        <ViewportHud race={view} racer={view.racers.find(r => r.id === 'p0')!} rect={{ x: 0, y: 0, w: 1, h: 1 }} viewports={1}/>
        <SharedHud race={view} followId="p0" mode="personal"/></FakeScene></div>}
      <div className="kp-scene-overlay"><Controller roomId="ui" roundId="ui" playerId="p0" viewRole="controller" isHost={false} publicView={view} privateView={null} connected
        serverNowMs={() => 0} setInput={i => { setLast(JSON.stringify(i)); (window as unknown as { __inputs: unknown[] }).__inputs = [...((window as unknown as { __inputs?: unknown[] }).__inputs ?? []), i]; }}
        releaseInput={() => setLast(l => `${l} released`)} sendAction={async a => { setLast(`action ${JSON.stringify(a)}`); return { accepted: true }; }} assetsReady={() => {}}/></div>
    </div></div>
    {q.has('debug') && <pre style={{ position: 'fixed', left: 8, bottom: 0, margin: 0, font: '11px monospace', color: '#fff', pointerEvents: 'none', zIndex: 30 }}>{last}</pre>}
  </main>;
}

function LobbyMock() {
  const n = num('n', 6), me = q.get('me') !== '0';
  const roster: RosterPlayer[] = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: i === 0 ? 'Alexandria Quinn' : NAMES[i % NAMES.length], color: COLORS[i % 8], connected: i !== 4, ready: i % 2 === 1,
    lobbyChoice: i === 0 && !q.has('pick') ? undefined : i % 3 === 2 ? undefined : { character: (i * 5) % 8, kart: (['zoomer', 'bolt', 'tank'] as const)[i % 3] } }));
  const [players, setPlayers] = useState(roster);
  return <main className="kp-shell"><Lobby roomId="r" lobbyId="l" players={players} playerId={me ? 'p0' : null} isHost={!me} settings={settings} connected
    onChoice={c => setPlayers(ps => ps.map(p => p.id === 'p0' ? { ...p, lobbyChoice: c } : p))} onReady={ready => setPlayers(ps => ps.map(p => p.id === 'p0' ? { ...p, ready } : p))}/></main>;
}

function ResultsMock() {
  const race = makeRace(num('t', 40));
  race.phase = 'results';
  const order = [...race.racers].sort((a, b) => b.progress - a.progress);
  order.forEach((r, i) => { r.rank = i + 1; r.finishTime = 128.3 + i * 2.71 + (i > 6 ? 5 : 0); r.lapTimes = [44.1 + i * .7, 41.9 + i * .5, 42.3 + i * .9];
    r.stats = { ...r.stats, miniTurbos: 12 - i, purpleTurbos: i % 3, hitsDealt: (i * 7) % 5, hitsTaken: i % 4, overtakes: 9 - i, airTime: 1 + i * .8, tricks: i % 3, itemsUsed: 3 + i % 4, wallHits: i * 2, rocketStart: i === 2, topSpeed: 33 - i * .3 }; });
  if (q.has('dnf')) race.racers.find(r => r.id === 'p0')!.finishTime = null;
  const view = decodeRaceView(rules.publicView(race, { nowMs: 0, phase: 'results' }));
  return <main className="kp-shell"><div className="kp-panel kp-round-results"><Results outcome={rules.outcome(race)} publicView={view} playerId={q.get('me') === '0' ? null : 'p0'}/></div></main>;
}

function SettingsMock() {
  const [s, setS] = useState(settings);
  return <main className="kp-shell" style={{ display: 'grid', placeItems: 'center' }}><div className="kp-dialog kp-dialog-wide" style={{ display: 'block', position: 'static' }}><div className="kp-panel"><h2>Kart Party settings</h2><SettingsPanel settings={s} onChange={setS} disabled={q.has('disabled')}/></div></div></main>;
}

function Icons() {
  return <main className="kp-shell" style={{ display: 'grid', gap: 16 }}>{[128, 64, 32].map(size => <div key={size} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
    {(Object.keys(ITEM_NAMES) as ItemId[]).map(id => <div key={id} style={{ width: size, background: '#141a44', borderRadius: 12, padding: 6 }}><ItemIcon item={id}/>{size > 60 && <small>{ITEM_NAMES[id]}</small>}</div>)}</div>)}</main>;
}
const screens: Record<string, () => ReactNode> = { icons: Icons, hud: Hud, ctl: Ctl, lobby: LobbyMock, results: ResultsMock, settings: SettingsMock, howto: () => <main className="kp-shell"><div className="kp-panel"><Instructions role={(q.get('role') ?? 'controller') as 'controller'}/></div></main> };
const Screen = screens[q.get('s') ?? 'hud'] ?? Hud;
// ?s=live boots the real 3D sandbox (same query params) with the platform stylesheet and fonts, as the shell has them.
if (q.get('s') === 'live') void import('./sandbox');
else createRoot(document.getElementById('root')!).render(<Screen/>);
