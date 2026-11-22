/* Phonedig sandbox: one page that runs the real rules with playing bots and shows any screen of the game.
 *
 *   ?players=32      diggers in the room (1–64)        ?crew=4       diggers to a crew (the Crews setting)
 *   ?role=display    display | phone | results         ?seat=0       whose phone this is
 *   ?t=40            seconds of digging to play before the first frame (bots at full speed)
 *   ?hold=1          stop the clock after ?t (a still shaft for screenshots)
 *   ?kit=1           stay in the kit-up instead of starting the drill
 *   ?shift=6         minutes on the clock (0 automatic, 99 none)      ?level=1   starting level      ?seed=7
 *   ?drive=1         leave ?seat to the on-screen controls or keyboard instead of a bot
 *   ?skill=0.6       how sharp the bots are, 0–1
 * Nothing here ships: the platform build never imports dev/. */
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../party-ui/src/style.css';
import { client } from '../src/client';
import { manifest } from '../src/manifest';
import type { NetInput, PublicView, Settings } from '../src/model';
import { rules } from '../src/server';
import { SUITS } from '../src/suits';
import { makeRng } from '../src/worldgen';
import { botInput, newMind, sightOf } from '../tests/helpers/bot';

const query = new URLSearchParams(location.search), number = (key: string, fallback: number) => query.has(key) ? Number(query.get(key)) : fallback;
const count = Math.max(1, Math.min(64, number('players', 4))), role = query.get('role') ?? 'display', seat = Math.min(count - 1, number('seat', 0));
const settings = rules.validateSettings({ startLevel: number('level', 1), crewSize: number('crew', 4), shift: number('shift', 0), lives: number('lives', 3) }) as Settings;
const FIRST = ['Angelina', 'Benedict', 'Cordelia', 'Dominick', 'Evelynne', 'Fletcher', 'Gwynneth', 'Humphrey'], LAST = ['Appleby', 'Bramble', 'Crumpet', 'Dawdler', 'Everett', 'Fizzgig', 'Gumdrop', 'Hopwood'];
const COLORS = ['#ff5748', '#28c6e7', '#78d955', '#b58aff', '#ffd24a', '#ff8ac0', '#4fe0c5', '#ff9a5c', '#9fb4ff', '#e3f08a'];
const players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `${FIRST[i % 8]} ${LAST[(i >> 3) % 8]}`, color: i < 10 ? COLORS[i] : `hsl(${(i * 47) % 360} 80% 68%)` }));
const me = role === 'display' ? null : players[seat].id;

// The shift runs on its own clock: wall time after the skipped opening, so screens interpolate as they would live.
const began = Date.now(), round = rules.create({ roomId: 'sandbox', roundId: 'round', seed: number('seed', 7), nowMs: began, players }, settings);
const held = new Map<string, NetInput>(), DT = 1 / 60, random = makeRng(number('seed', 7) ^ 0x51ed), minds = players.map(() => newMind());
let clock = began, live: NetInput = rules.neutralInput(), ticks = 0;
if (!query.has('kit')) {
  players.forEach((player, i) => rules.applyAction(round, player.id, { type: 'kit', turnId: 1, suit: SUITS[(i * 5) % SUITS.length].id }, clock));
  while (round.stage === 'kitup') rules.tick(round, held, DT, clock += DT * 1000);
} else players.forEach((player, i) => { if (i % 3) rules.applyAction(round, player.id, { type: 'kit', turnId: 1, suit: SUITS[(i * 5) % SUITS.length].id }, clock); });
function step() {
  // Bots look three times a second less often than the shaft steps, as a phone's held input does.
  if (ticks++ % 3 === 0 && round.stage === 'dig') {
    for (const crew of round.crews) {
      if (crew.state !== 'dig') continue;
      const sight = sightOf(crew.sim);
      crew.seats.forEach(s => {
        const i = round.seats.indexOf(s);
        held.set(s.id, query.has('drive') && s.id === me ? live : botInput(sight, crew.sim.dirt, s.id, minds[i], { skill: number('skill', 0.8) - crew.index * 0.03, random, side: (s.slot + 0.5) / crew.seats.length }));
      });
    }
  }
  rules.tick(round, held, DT, clock += DT * 1000);
}
for (let i = 0, n = number('t', 0) * 60; i < n && !rules.outcome(round).complete; i++) step();
const skipped = clock - began, wall = performance.now(), now = () => query.has('hold') ? clock : began + skipped + (performance.now() - wall);
const view = (results = false): PublicView => rules.publicView(round, { nowMs: clock, phase: results ? 'results' : 'playing' });

function Sandbox() {
  const [snapshot, setSnapshot] = useState(() => ({ wire: view(), time: clock }));
  const [ready, setReady] = useState(false), [loaded, setLoaded] = useState(false), abort = useMemo(() => new AbortController(), []);
  useEffect(() => { void Promise.resolve(client.prepare?.({ role: me ? 'controller' : 'display', signal: abort.signal, assetBase: manifest.assetBase })).then(() => setLoaded(true)); }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!query.has('hold') && !query.has('kit')) while (clock < now() && !rules.outcome(round).complete) step();
      setSnapshot({ wire: view(), time: clock });
    }, 50);
    return () => clearInterval(timer);
  }, []);
  if (!loaded) return null;
  if (role === 'results') {
    while (!rules.outcome(round).complete && clock - began < 20 * 60000) step();
    const Results = client.ResultsView!;
    return <main className="kp-shell" data-ready><div className="kp-panel kp-round-results"><Results outcome={rules.outcome(round)} publicView={view(true)} playerId={query.has('seat') ? players[seat].id : null} isHost/></div></main>;
  }
  const shared = { roomId: 'sandbox', roundId: 'round', playerId: me, isHost: role === 'display', connected: true, publicView: snapshot.wire, privateView: me ? rules.playerView(round, me, { nowMs: clock, phase: 'playing' as const }) : null,
    serverNowMs: now, setInput: (input: unknown) => { live = input as NetInput; }, releaseInput: () => { live = rules.neutralInput(); }, sendAction: async (action: unknown) => { try { rules.applyAction(round, me ?? '', rules.parseAction(action), clock); return { accepted: true }; } catch (error) { return { accepted: false, reason: String(error) }; } }, assetsReady: () => {} };
  const View = role === 'display' ? client.DisplayView : client.ControllerView, Scene = client.SceneView!;
  const stage = <div className={`kp-scene-stage kp-scene-stage-${me ? 'controller' : 'display'}`} style={{ height: '100dvh', borderRadius: 0 }}>
    <div className="kp-scene-surface"><Scene roundId="round" phase="playing" settings={settings} playerId={me} viewRole={me ? 'controller' : 'display'} isHost={shared.isHost} connected privateView={shared.privateView}
      setInput={shared.setInput} releaseInput={shared.releaseInput} sendAction={shared.sendAction} players={players} publicView={snapshot.wire} snapshotTime={snapshot.time} signal={abort.signal} serverNowMs={now}
      onReady={() => setReady(true)} onError={error => { console.error(error); document.title = `scene error: ${error}`; }}/></div>
    <div className="kp-scene-overlay">{ready && <View {...shared} viewRole={me ? 'controller' : 'display'}/>}</div>
  </div>;
  return <main data-ready={ready || undefined} data-crews={round.crews.length} style={{ height: '100dvh' }}>{stage}</main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Sandbox/></StrictMode>);
