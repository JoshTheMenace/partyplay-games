/* Kitchen Rush sandbox: one page that runs the real rules with crew bots and shows any screen of the game.
 *
 *   ?players=32      crew size (1–64)                 ?level=2        kitchen index
 *   ?role=display    display | phone | host | lobby | results         ?seat=0   whose phone or host screen this is
 *   ?t=40            seconds of service to play before the first frame (bots cook at full speed)
 *   ?hold=1          stop the clock after ?t (a still kitchen for screenshots)       ?seconds=180   service length
 *   ?drive=1         leave ?seat to the on-screen controls or keyboard instead of a bot           ?relaxed=1
 *   ?fail=1          pretend this phone could not draw its kitchen (classic controller fallback)
 *   ?fire=2          set the first two stoves of every kitchen alight after ?t (effect screenshots)
 *   ?fps=0.5         slow the render loop so screenshots are not starved by software WebGL
 * Nothing here ships: the platform build never imports dev/. */
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../party-ui/src/style.css';
import { client } from '../src/client';
import { CHARACTERS, lineSizes, type Input, type Settings } from '../src/model';
import { phoneScene } from '../src/phone-scene';
import { lineView, rules } from '../src/server';
import type { Wire } from '../src/wire';
import { botInput } from '../tests/helpers/bot';

const query = new URLSearchParams(location.search), number = (key: string, fallback: number) => query.has(key) ? Number(query.get(key)) : fallback;
const count = Math.max(1, Math.min(64, number('players', 4))), role = query.get('role') ?? 'display', seat = Math.min(count - 1, number('seat', 0));
const settings = rules.validateSettings({ level: number('level', 0), seconds: number('seconds', 180), relaxed: query.has('relaxed') }) as Settings;
const FIRST = ['Angelina', 'Benedict', 'Cordelia', 'Dominick', 'Evelynne', 'Fletcher', 'Gwynneth', 'Humphrey'], LAST = ['Appleby', 'Bramble', 'Crumpet', 'Dawdler', 'Everett', 'Fizzgig', 'Gumdrop', 'Hopwood'];
const COLORS = ['#ff5748', '#28c6e7', '#78d955', '#b58aff', '#ffd24a', '#ff8ac0', '#4fe0c5', '#ff9a5c', '#9fb4ff', '#e3f08a'];
const players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `${FIRST[i % 8]} ${LAST[(i >> 3) % 8]}`, color: i < 10 ? COLORS[i] : `hsl(${(i * 47) % 360} 80% 68%)`, lobbyChoice: { character: CHARACTERS[i % CHARACTERS.length].id } }));
const me = role === 'display' ? null : players[seat].id, host = role === 'host';
if (query.has('fail')) phoneScene.fail();
// ?fps=0.5 slows the render loop (software WebGL under load takes seconds a frame, which starves screenshots).
if (query.has('fps')) { const real = requestAnimationFrame.bind(window), gap = 1000 / number('fps', 1); window.requestAnimationFrame = callback => setTimeout(() => real(callback), gap) as unknown as number; window.cancelAnimationFrame = id => clearTimeout(id); }

// The service runs on its own clock: wall time after the skipped opening, so screens interpolate as they would live.
const began = Date.now(), service = rules.create({ roomId: 'sandbox', roundId: 'round', seed: number('seed', 7), nowMs: began, players }, settings);
// Kitchens share a seed and bots are deterministic, so each kitchen's bots get a different pace or the race would be a dead heat.
const held = new Map<string, Input>(), DT = 1 / 60;
let clock = began, live: Input = rules.neutralInput();
function step() {
  for (const kitchen of service.lines) { const view = lineView(kitchen); for (const chef of kitchen.players) held.set(chef.id, query.has('drive') && chef.id === me ? live : botInput(view, kitchen.map, chef.id, { speed: 1 - kitchen.line * .05, dash: kitchen.line % 3 !== 2 })); }
  for (let i = 0; i < 3; i++) rules.tick(service, held, DT, clock += DT * 1000);
}
for (let i = 0, n = number('t', 0) * 20; i < n; i++) step();
for (const kitchen of service.lines) for (let n = number('fire', 0), i = 0; n > 0 && i < kitchen.map.tiles.length; i++) if (kitchen.map.tiles[i].kind === 'stove' || kitchen.map.tiles[i].kind === 'oven') { kitchen.slots[i].fire = 1; n--; }
const skipped = clock - began, wall = performance.now(), now = () => query.has('hold') ? clock : began + skipped + (performance.now() - wall);

function Sandbox() {
  const [snapshot, setSnapshot] = useState<{ wire: Wire; time: number }>(() => ({ wire: rules.publicView(service, { nowMs: clock, phase: 'playing' }), time: clock }));
  const [ready, setReady] = useState(false), abort = useMemo(() => new AbortController(), []), done = snapshot.wire.rev > 1 || role === 'results';
  useEffect(() => {
    const timer = setInterval(() => {
      if (!query.has('hold')) while (clock < now() && !service.lines[0].complete) step();
      setSnapshot({ wire: rules.publicView(service, { nowMs: clock, phase: 'playing' }), time: clock });
    }, 50);
    return () => clearInterval(timer);
  }, []);
  const lobbyReady = useRef(true);
  if (role === 'lobby') {
    const Lobby = client.LobbyView!, roster = players.map((player, i) => ({ ...player, connected: true, ready: i % 5 !== 3 }));
    return <main className="kp-shell"><Lobby roomId="sandbox" lobbyId="lobby" players={roster} playerId={query.has('seat') ? players[seat].id : null} isHost={!query.has('seat')} settings={settings} connected onChoice={() => {}} onReady={value => { lobbyReady.current = value; }}/></main>;
  }
  if (role === 'results') {
    while (!service.lines[0].complete) step();
    const Results = client.ResultsView!;
    return <main className="kp-shell"><div className="kp-panel kp-round-results"><Results outcome={rules.outcome(service)} publicView={rules.publicView(service, { nowMs: clock, phase: 'results' })} playerId={query.has('seat') ? players[seat].id : null} isHost={!query.has('seat')}/></div></main>;
  }
  const shared = { roomId: 'sandbox', roundId: 'round', playerId: me, isHost: host || role === 'display', connected: true, publicView: snapshot.wire, privateView: me ? rules.playerView(service, me, { nowMs: clock, phase: 'playing' as const }) : null,
    serverNowMs: now, setInput: (input: unknown) => { live = input as Input; }, releaseInput: () => { live = rules.neutralInput(); }, sendAction: async () => ({ accepted: false }), assetsReady: () => {} };
  const View = role === 'display' ? client.DisplayView : host ? client.PersonalView! : client.ControllerView, Scene = client.SceneView!;
  const stage = <div className={`kp-scene-stage kp-scene-stage-${me ? 'controller' : 'display'}`} style={role === 'phone' ? { height: '100%' } : { height: '100dvh', borderRadius: 0 }}>
    <div className="kp-scene-surface"><Scene roundId="round" phase={done ? 'results' : 'playing'} settings={settings} playerId={me} viewRole={me ? 'controller' : 'display'} isHost={shared.isHost} connected privateView={shared.privateView}
      setInput={shared.setInput} releaseInput={shared.releaseInput} sendAction={shared.sendAction} players={players} publicView={snapshot.wire} snapshotTime={snapshot.time} signal={abort.signal} serverNowMs={now}
      onReady={() => setReady(true)} onError={error => { console.error(error); document.title = `scene error: ${error}`; }}/></div>
    <div className="kp-scene-overlay">{ready && <View {...shared} viewRole={me ? (host ? 'personal' : 'controller') : 'display'}/>}</div>
  </div>;
  // A phone sits in the shell's landscape frame, exactly as in a room.
  return <main className={role === 'phone' ? 'kp-shell kp-shell-phone' : undefined} data-ready={ready || undefined} data-lines={lineSizes(count).length}>{role === 'phone' ? <div className="kp-landscape-controller">{stage}</div> : stage}</main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Sandbox/></StrictMode>);
