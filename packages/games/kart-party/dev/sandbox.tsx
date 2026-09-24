/* Dev-only harness: runs the authoritative race locally at 60 Hz and feeds 20 Hz snapshots into the
 * real SceneView, like the room server would. Query: track, players (humans 1–4, extra humans are
 * driven by the CPU), cpus, view (split|personal|spectator), laps, cc, seed, host=0 for a watching
 * TV, auto=1 to let the CPU drive human 1, metrics=1 for a frame/draw-call overlay. Keyboard drives human 1: arrows/A-D steer, Shift drift, Space brake, E item.
 * window.__kart exposes { race, view(), setInput(), step(seconds) } for automated screenshots. */
import '../../../party-ui/src/style.css';
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState } from 'react';
import KartScene from '../src/scene';
import { rules } from '../src/server';
import { botInput } from '../src/sim/ai';
import { inputBus } from '../src/input-bus';
import { decodeRaceView, type RaceWire } from '../src/net/wire';
import { HeldInputChannel } from '../../../party-client/src/held-input';
import type { Input, RaceView, Settings } from '../src/sim/types';

const q = new URLSearchParams(location.search), humans = Math.max(1, Math.min(10, Number(q.get('players') ?? 1)));
const settings: Settings = rules.validateSettings({ track: q.get('track') ?? 'palm-bay', laps: Number(q.get('laps') ?? 3), speedClass: Number(q.get('cc') ?? 100),
  gridSize: humans + Number(q.get('cpus') ?? 7), views: q.get('view') === 'personal' || q.get('view') === 'spectator' ? 'personal' : 'tv' });
const players = Array.from({ length: humans }, (_, i) => ({ id: `p${i}`, name: i ? `Player ${i + 1}` : 'You', color: ['#ff5748', '#28c6e7', '#78d955', '#b58aff'][i % 4] }));
const race = rules.create({ roomId: 'dev', roundId: 'dev-1', players, seed: Number(q.get('seed') ?? 7), nowMs: 0 }, settings);
const input: Input = { ...rules.neutralInput() };
let serverInput: Input = { ...rules.neutralInput() };
const playerId = q.get('host') === '0' || q.get('view') === 'spectator' ? null : 'p0';
const epoch = performance.now(), serverNowMs = () => performance.now() - epoch;
const latency = Number(q.get('latency') ?? 0), jitter = Number(q.get('jitter') ?? 0);
const link = () => { let last = 0; return (fn: () => void) => { const now = performance.now(), at = last = Math.max(last, now + latency / 2 + Math.random() * jitter); if (at <= now) fn(); else setTimeout(fn, at - now); }; };
const uplink = link(), downlink = link();
const held = new HeldInputChannel((kind, v) => uplink(() => { serverInput = kind === 'state' ? rules.parseInput(v) : { ...rules.neutralInput(), seq: serverInput.seq }; }));
setInterval(() => held.flush(performance.now()), 50);
const send = () => { input.seq++; held.set({ ...input }, performance.now()); inputBus.publish({ ...input }); };
// Like the room, the countdown only starts once the scene reports ready (paused=1 keeps it frozen).
let simulated = 0, paused = true;
const holdPaused = q.get('paused') === '1';
const auto = q.get('auto') === '1';
const truth: { t: number; x: number; z: number; heading: number }[] = [];
const listeners = new Set<(v: RaceView, t: number) => void>();
function advance(ms: number) {
  for (let i = 0; i < Math.round(ms / (1000 / 60)); i++) {
    // auto=1: the CPU drives human 1 through the real input path, so prediction sees exactly what the "server" gets.
    if (auto && playerId) { Object.assign(input, botInput(race, race.racers.find(r => r.id === 'p0')!), { seq: input.seq }); send(); }
    const inputs = new Map(race.racers.filter(r => !r.bot).map(r => [r.id, r.id === 'p0' && playerId ? serverInput : botInput(race, r)] as const));
    rules.tick(race, inputs, 1 / 60, simulated); simulated += 1000 / 60;
    const me = race.racers.find(r => r.id === 'p0')!; truth.push({ t: race.time, x: me.x, z: me.z, heading: me.heading }); if (truth.length > 1200) truth.shift();
  }
}
// The sim is locked to the wall clock (60 Hz ticks), snapshots go out at 20 Hz through the wire codec.
let simClock = performance.now();
setInterval(() => { const now = performance.now(), steps = paused ? 0 : Math.floor((now - simClock) * 60 / 1000); advance(steps * 1000 / 60); simClock = paused ? now : simClock + steps * 1000 / 60; }, 4);
setInterval(() => {
  const wire = JSON.stringify(rules.publicView(race, { nowMs: simulated, phase: 'playing' })), at = serverNowMs();
  downlink(() => { const view = decodeRaceView(JSON.parse(wire) as RaceWire); listeners.forEach(l => l(view, at)); });
}, 50);
const keys = new Set<string>();
const key = (e: KeyboardEvent) => {
  const k = e.key.toLowerCase(), down = e.type === 'keydown';
  if (down) keys.add(k); else keys.delete(k);
  input.steer = Number(keys.has('arrowright') || keys.has('d')) - Number(keys.has('arrowleft') || keys.has('a'));
  if (k === 'shift') { if (down && !input.drift) input.hop = (input.hop + 1) % 256; input.drift = down; }
  if (k === ' ') input.brake = down;
  if (k === 'e') { if (down && !input.item) input.fire = (input.fire + 1) % 256; input.item = down; }
  send();
};
addEventListener('keydown', key); addEventListener('keyup', key);
(window as unknown as { __kart: unknown }).__kart = { race, settings, truth, view: () => decodeRaceView(rules.publicView(race, { nowMs: simulated, phase: 'playing' })), setInput: (v: Partial<Input>) => { Object.assign(input, v); send(); }, step: (s: number) => advance(s * 1000), pause: (p: boolean) => { paused = p; }, ready: false };

function App() {
  const [view, setView] = useState<{ v: RaceView; t: number } | null>(null), signal = useMemo(() => new AbortController().signal, []);
  useEffect(() => { const l = (v: RaceView, t: number) => setView({ v, t }); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return <KartScene roundId="dev-1" phase={view ? 'playing' : 'preparing'} settings={settings} playerId={playerId} viewRole={playerId ? 'controller' : 'display'} isHost connected
    privateView={null} setInput={v => { Object.assign(input, v); send(); }} releaseInput={() => { Object.assign(input, rules.neutralInput(), { seq: input.seq }); send(); }} sendAction={async () => ({ accepted: true })}
    players={players} publicView={view?.v ?? null} snapshotTime={view?.t ?? null} signal={signal} serverNowMs={serverNowMs}
    onReady={() => { (window as unknown as { __kart: { ready: boolean } }).__kart.ready = true; paused = holdPaused; console.log('scene ready'); }} onError={e => console.error('scene error', e)}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
