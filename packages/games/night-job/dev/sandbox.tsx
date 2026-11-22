/* Night Job sandbox: one page that runs the real rules with crew bots and shows any screen of the game.
 *
 *   ?players=32      roster (1–64); more than four makes a crew night          ?mission=velvet|glasshouse|ferry
 *   ?role=display    display | phone | lobby | results                          ?seat=0   whose phone this is
 *   ?scene=chase     stage a moment from scenes.ts on the first crew and hold it (same picture before and after a change)
 *   ?then=clear      with ?scene: end the heist (clear | failed) ?after=2500 ms once the screen is up, to watch the outro
 *   ?t=40            seconds the bots play before the first frame               ?hold=1   stop the clock after ?t
 *   ?cast=2          keep this crew on the shared screen                        ?relaxed=1   ?seed=7
 *   ?drive=1         leave ?seat to the on-screen controls or keyboard instead of a bot
 *   ?mixed=1         every specialist and tool in turn instead of the bots' own dart-pack crew (lobby and results screenshots)
 *   ?fps=2           slow the render loop so screenshots are not starved by software WebGL
 *   ?unmount=6000    tear the TV scene down after that many ms; the page title then says how long the main thread was held
 * Nothing here ships: the platform build never imports dev/. */
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../party-ui/src/style.css';
import { client } from '../src/client';
import { CREW_SIZE, crewOfSeat, crewStarts, type Input, type MissionId, type Role, type Tool } from '../src/model';
import { getMap } from '../src/maps';
import { rules } from '../src/server';
import { createNight } from '../src/sim/night';
import { ownView, type Wire } from '../src/wire';
import { botChoice, crewBot } from '../tools/bot';
import { SCENES, postsLevel, stage } from './scenes';

const query = new URLSearchParams(location.search), number = (key: string, fallback: number) => query.has(key) ? Number(query.get(key)) : fallback;
const scene = query.has('scene') ? SCENES[query.get('scene')!] : null, role = query.get('role') ?? 'display';
const count = Math.max(1, Math.min(64, number('players', scene ? scene.crew.length : 4))), seat = Math.min(count - 1, number('seat', 0));
const settings = rules.validateSettings({ mission: (query.get('mission') ?? scene?.mission ?? 'velvet') as MissionId, difficulty: query.has('relaxed') ? 'relaxed' : 'normal' }), map = getMap(settings.mission);
const FIRST = ['Marguerite', 'Bartholomew', 'Wilhelmina', 'Cornelius', 'Evangeline', 'Fitzgerald', 'Gwendolyn', 'Humphrey'], LAST = ['Vole', 'Finch', 'Stoat', 'Badger', 'Wren', 'Pike', 'Marten', 'Quail'];
const COLORS = ['#ff5748', '#28c6e7', '#78d955', '#b58aff', '#ffd24a', '#ff8ac0', '#4fe0c5', '#ff9a5c', '#9fb4ff', '#e3f08a'];
const ROLES: Role[] = ['cracker', 'scout', 'magpie', 'ghost', 'breacher', 'impostor', 'wire', 'face'], TOOLS: Tool[] = ['smoke', 'tranq', 'medkit', 'shotgun', 'emp', 'decoy'];
const players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `${FIRST[i % 8]} ${LAST[(i * 3 + (i >> 3)) % 8]}`.slice(0, 16), color: i < 10 ? COLORS[i] : `hsl(${(i * 47) % 360} 80% 68%)`, lobbyChoice: scene?.crew[i] ? { role: scene.crew[i][2], tool: scene.crew[i][3] ?? 'smoke' } : query.has('mixed') ? { role: ROLES[i % 8], tool: TOOLS[(i * 5 + 1) % 6] } : botChoice(i - crewStarts(count)[crewOfSeat(count, i)]) }));
const me = role === 'display' ? null : players[seat].id;
if (query.has('fps')) { const real = requestAnimationFrame.bind(window), gap = 1000 / number('fps', 1); window.requestAnimationFrame = callback => setTimeout(() => real(callback), gap) as unknown as number; window.cancelAnimationFrame = id => clearTimeout(id); }

const began = Date.now(), night = createNight({ roomId: 'sandbox', roundId: 'round', seed: number('seed', 7), nowMs: began, players }, settings, scene ? postsLevel(scene) : undefined);
if (scene) stage(scene, night.heists[0], map);
const bots = players.map(p => crewBot(p.id)), held = new Map<string, Input>(), STEP = 1 / 30, ctx = () => ({ nowMs: clock, phase: 'playing' as const });
let clock = began, live: Input = rules.neutralInput(), ticks = 0;
const snap = (): Wire => { if (query.has('cast')) night.cast = Math.min(night.heists.length - 1, number('cast', 0)); night.stamp++; return rules.publicView(night, ctx()); };
function step() {
  if (ticks++ % 3 === 0) {
    const wire = snap();
    for (const [i, p] of players.entries()) {
      if (query.has('drive') && p.id === me) { held.set(p.id, live); continue; }
      const view = ownView(wire, rules.playerView(night, p.id, ctx()), p.id)!, move = bots[i](view); held.set(p.id, rules.parseInput(move.input));
      if (move.tool) try { rules.applyAction(night, p.id, { type: 'tool', heistId: view.heistId }, clock); } catch { /* no charge */ }
    }
  }
  rules.tick(night, held, STEP, clock += STEP * 1000);
}
const frozen = !!scene || query.has('hold'), done = () => rules.outcome(night).complete;
if (!scene) for (let i = 0, n = number('t', 0) * 30; i < n && !done(); i++) step();
if (role === 'results') { if (scene) { for (const s of night.heists) { s.phase = query.has('failed') ? 'failed' : 'clear'; s.elapsed = 312; s.collected = 96; s.endedAt = s.now - 9000; Object.values(s.stats).forEach((v, i) => Object.assign(v, { coins: [41, 30, 17, 8][i], spotted: [2, 0, 1, 3][i], takedowns: [1, 0, 2, 0][i], revives: [0, 2, 0, 0][i], downs: [1, 0, 0, 2][i], tools: [3, 2, 4, 1][i] })); } rules.tick(night, held, STEP, clock += 34); } else while (!done()) step(); }
const skipped = clock - began, wall = performance.now(), now = () => frozen ? clock : began + skipped + (performance.now() - wall);

function Sandbox() {
  const [snapshot, setSnapshot] = useState<{ wire: Wire; time: number }>(() => ({ wire: snap(), time: clock }));
  const [ready, setReady] = useState(false), abort = useMemo(() => new AbortController(), []), [gone, setGone] = useState(false);
  // ?unmount=6000 tears the scene down after that long and writes how long the main thread was held into the page title.
  useEffect(() => { if (!ready || !query.has('unmount')) return; const timer = setTimeout(() => { const t = performance.now(); abort.abort(); setGone(true); requestAnimationFrame(() => { document.title = `unmounted in ${Math.round(performance.now() - t)} ms`; }); }, number('unmount', 6000)); return () => clearTimeout(timer); }, [ready]);
  useEffect(() => {
    if (frozen) return;
    const timer = setInterval(() => { while (clock < now() && !done()) step(); setSnapshot({ wire: snap(), time: clock }); }, 50);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!scene || !query.has('then') || (role === 'display' && !ready)) return;
    const timer = setTimeout(() => { const s = night.heists[0]; s.phase = query.get('then') as typeof s.phase; s.endedAt = s.now; s.message = s.phase === 'clear' ? 'Clean getaway! The whole crew made it out.' : 'The whole crew is down. Job failed.'; s.messageAt = s.now; clock += 100; setSnapshot({ wire: snap(), time: clock }); }, number('after', 2500));
    return () => clearTimeout(timer);
  }, [ready]);
  if (gone) return <main data-ready="1" data-gone="1"/>;
  if (role === 'lobby') {
    const Lobby = client.LobbyView!, roster = players.map((player, i) => ({ ...player, connected: i % 11 !== 7, ready: i % 5 !== 3 }));
    return <main className={`kp-shell${query.has('seat') ? ' kp-shell-phone' : ''}`} data-ready="1"><Lobby roomId="sandbox" lobbyId="lobby" players={roster as never} playerId={query.has('seat') ? players[seat].id : null} isHost={!query.has('seat')} settings={settings} connected onChoice={() => {}} onReady={() => {}}/></main>;
  }
  if (role === 'results') {
    const Results = client.ResultsView!;
    return <main className={`kp-shell${query.has('seat') ? ' kp-shell-phone' : ''}`} data-ready="1"><div className="kp-panel kp-round-results"><Results outcome={rules.outcome(night)} publicView={snapshot.wire} playerId={query.has('seat') ? players[seat].id : null} isHost={!query.has('seat')}/></div></main>;
  }
  const shared = { roomId: 'sandbox', roundId: 'round', playerId: me, isHost: !me, connected: true, publicView: snapshot.wire, privateView: me ? rules.playerView(night, me, ctx()) : null, serverNowMs: now,
    setInput: (input: Input) => { live = input; }, releaseInput: () => { live = rules.neutralInput(); }, sendAction: async () => { try { rules.applyAction(night, me!, { type: 'tool', heistId: night.heists[night.crewOf.get(me!)!].heistId }, clock); return { accepted: true }; } catch (error) { return { accepted: false, reason: (error as Error).message }; } }, assetsReady: () => {} };
  if (role === 'phone') return <main className="kp-shell kp-shell-phone" data-ready="1" data-crews={Math.ceil(count / CREW_SIZE)}><div className="kp-landscape-controller" style={{ position: 'absolute', inset: 0 }}><client.ControllerView {...shared} viewRole="controller"/></div></main>;
  const Scene = client.SceneView!;
  return <main data-ready={ready || undefined}><div className="kp-scene-stage kp-scene-stage-display" style={{ height: '100dvh', borderRadius: 0 }}>
    <div className="kp-scene-surface"><Scene roundId="round" phase="playing" settings={settings} playerId={null} viewRole="display" isHost connected privateView={null} setInput={() => {}} releaseInput={() => {}} sendAction={async () => ({ accepted: false })}
      players={players} publicView={snapshot.wire} snapshotTime={snapshot.time} signal={abort.signal} serverNowMs={now} onReady={() => setReady(true)} onError={error => { console.error(error); document.title = `scene error: ${error}`; }}/></div>
    <div className="kp-scene-overlay">{ready && <client.DisplayView {...shared} viewRole="display"/>}</div>
  </div></main>;
}
client.prepare({ role: 'display', signal: new AbortController().signal, assetBase: '/games/night-job/' });
createRoot(document.getElementById('root')!).render(<StrictMode><Sandbox/></StrictMode>);
