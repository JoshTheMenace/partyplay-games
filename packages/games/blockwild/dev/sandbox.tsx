/* Dev-only harness: runs the authoritative simulation in the page at 20 Hz and feeds its snapshots into the real
 * SceneView and HUD, like the room server would, with no room, lobby or loading barrier.
 *
 * Query: seed (11), mode (survival|creative), time (day ticks, 6000 = noon), view (player|tv), players (seats, 1..64;
 * the extra seats are bots that walk, turn, mine and jump so there is something to watch), scene (pasture: animals,
 * torches and a lantern wall in front of the spawn; crowd: every seat packed round the spawn; plain: nothing added),
 * freeze=1 (the clock stops, so a screenshot is repeatable), yaw / pitch (where seat 0 looks at the start), bots=still.
 * mode=city runs Caper City (scene defaults to plain); at=x,y,z stands seat 0 somewhere else (feet position; y `top` = on the roof there);
 * coins=N and heat=N set seat 0's purse and heat in the city.
 * window.sandbox exposes { state, loading(), tick(n), view() } for automated screenshots.
 */
import '../../../party-ui/src/style.css';
import '../src/client/style.css';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import type { ActionResult } from '../../../party-contract/src/index';
import { hud } from '../src/client/game/hud';
import BlockwildScene from '../src/client/scene';
import { ControllerView } from '../src/client/ui/controller';
import { DisplayView } from '../src/client/ui/display';
import { B, cellId, makeCell } from '../src/shared/blocks';
import { I } from '../src/shared/items';
import { MOB, parseInput, validateSettings, type Input, type PrivateView, type View } from '../src/shared/protocol';
import { createState, tickState } from '../src/sim/game';
import { newMob } from '../src/sim/mobs';
import type { Player } from '../src/sim/state';
import { playerView, publicView } from '../src/sim/views';
import { surfaceY, writeCell } from '../src/sim/world';

const COLORS = ['#ff5748', '#28c6e7', '#78d955', '#b58aff', '#ffd24a', '#ff90ba', '#56decd', '#ffa260', '#97aeff', '#e2ef93'];
const q = new URLSearchParams(location.search), seats = Math.max(1, Math.min(64, Number(q.get('players') ?? 1)));
const settings = validateSettings({ seed: Number(q.get('seed') ?? 11), mode: q.get('mode') ?? 'survival', difficulty: q.get('difficulty') ?? 'peaceful' });
const roster = Array.from({ length: seats }, (_, i) => ({ id: `p${i}`, name: i ? `Explorer ${String(i + 1).padStart(2, '0')}` : 'You', color: COLORS[i % COLORS.length]! }));
const state = createState({ roomId: 'dev', roundId: 'dev-1', players: roster, seed: 7, nowMs: 0 }, settings);
const city = settings.mode === 'city';
const tv = q.get('view') === 'tv', playerId = tv ? null : 'p0', freeze = q.get('freeze') === '1', scene = q.get('scene') ?? (city ? 'plain' : 'pasture');
state.time = Number(q.get('time') ?? 6000);

const GROUND: readonly number[] = [B.grass_block, B.dirt, B.sand, B.stone, B.snowy_grass, B.gravel];
/** The highest ground cell of a column (leaves and plants do not count). */
function ground(x: number, z: number) {
  let y = surfaceY(state.get, x, z);
  while (y > 1 && !GROUND.includes(cellId(state.get(x, y, z)))) y--;
  return y;
}
const put = (player: Player, x: number, z: number, yaw = 0, y = (city ? surfaceY(state.get, x, z) : ground(x, z)) + 1) => { Object.assign(player, { x: x + 0.5, y, z: z + 0.5, yaw, fallPeak: y, supportY: y, tp: { n: 1, x: x + 0.5, y, z: z + 0.5 } }); };
const me = state.players[0]!, at = q.get('at')?.split(',').map(Number);
// at=x,top,z stands on whatever is highest there (a roof).
if (at?.length === 3 && Number.isFinite(at[0]) && Number.isFinite(at[2])) put(me, Math.floor(at[0]!), Math.floor(at[2]!), 0, Number.isFinite(at[1]) ? at[1]! : undefined);
const hx = Math.floor(me.x), hz = Math.floor(me.z);
Object.assign(me, { yaw: Number(q.get('yaw') ?? 0), pitch: Number(q.get('pitch') ?? -0.12) });
if (!city) [{ id: B.torch, n: 32 }, { id: I.iron_pickaxe, n: 1 }, { id: B.oak_planks, n: 64 }, { id: I.iron_sword, n: 1 }, { id: B.cobblestone, n: 64 }, { id: I.bread, n: 8 }, { id: B.lantern, n: 8 }, { id: I.water_bucket, n: 1 }, { id: I.bow, n: 1 }]
  .forEach((slot, i) => { me.inv[i] = slot; });
if (scene === 'pasture') {
  // The same layout as the QA save fixtures: animals, torches and a lantern wall north of the spawn.
  for (const [dx, dz, t] of [[-3, -6, MOB.cow], [2, -7, MOB.sheep], [-1, -4, MOB.pig], [3, -4, MOB.chicken], [5, -9, MOB.cow], [-5, -9, MOB.sheep]] as const) state.mobs.push(newMob(state, t, hx + dx + 0.5, ground(hx + dx, hz + dz) + 1, hz + dz + 0.5));
  for (const [dx, dz] of [[-2, -3], [2, -5], [-4, -8], [4, -8], [0, -10]] as const) writeCell(state, hx + dx, ground(hx + dx, hz + dz) + 1, hz + dz, makeCell(B.torch, 0));
  for (let i = -2; i <= 2; i++) for (let h = 1; h <= 2; h++) writeCell(state, hx + i, ground(hx + i, hz - 12) + h, hz - 12, B.cobblestone);
  writeCell(state, hx, ground(hx, hz - 11) + 1, hz - 11, B.lantern);
}
state.players.slice(1).forEach((bot, k) => {
  // Bots stand in rows in front of seat 0 (a crowd packs them round the spawn) with something in hand.
  const i = k + 1, row = Math.floor(k / 8), column = k % 8;
  if (scene === 'crowd') put(bot, hx + (column - 4) * 2, hz - 4 - row * 2, Math.PI);
  else put(bot, hx + (k % 2 ? 2 : -2) + (row % 3) * (k % 2 ? 2 : -2), hz - 5 - k * 2, Math.PI);
  if (city) return;
  bot.inv[0] = { id: [I.diamond_pickaxe, I.iron_sword, B.torch, I.bread, I.bow][i % 5]!, n: 1 };
  if (i % 4 === 0) bot.armor[0] = { id: I.iron_helmet, n: 1 };
});
for (const player of state.players) player.protectedUntil = 0;
if (state.city) { const cp = state.city.players[0]!; if (q.has('coins')) cp.coins = Number(q.get('coins')); if (q.has('heat')) { cp.heat = Number(q.get('heat')); cp.hotAt = 0; cp.spell = 2; } }

/** What a bot does this tick: stroll in a small circle, look around, swing now and then, hop sometimes. */
function botStep(bot: Player, i: number, t: number) {
  const phase = t * 0.6 + i * 1.7, walking = Math.sin(t * 0.25 + i) > -0.3;
  if (walking) { bot.x += Math.cos(phase) * 0.07; bot.z += Math.sin(phase) * 0.07; bot.yaw = Math.atan2(-Math.cos(phase), -Math.sin(phase)); if (!city) bot.y = ground(Math.floor(bot.x), Math.floor(bot.z)) + 1; }
  else bot.yaw += Math.sin(t + i) * 0.04;
  bot.pitch = Math.sin(t * 0.7 + i) * 0.3;
  bot.sneaking = i % 7 === 3 && Math.sin(t * 0.4 + i) > 0.6;
  if (Math.floor(t * 2 + i) % 5 === 0 && state.ticks % 10 === 0) bot.swing++;
}

const epoch = performance.now(), serverNowMs = () => performance.now() - epoch;
let held: Input = parseInput(null), frozenTime = state.time;
type Frame = { view: View; pv: PrivateView | null; at: number };
const listeners = new Set<(frame: Frame) => void>();
function tick(count = 1) {
  for (let n = 0; n < count; n++) {
    if (q.get('bots') !== 'still') state.players.slice(1).forEach((bot, k) => botStep(bot, k + 1, state.clock));
    tickState(state, new Map(playerId ? [[playerId, held]] : []), 0.05);
    if (freeze) state.time = frozenTime;
  }
  const frame = { view: structuredClone(publicView(state)), pv: playerId ? structuredClone(playerView(state, playerId)) : null, at: serverNowMs() };
  for (const listener of listeners) listener(frame);
  return frame;
}
let last = tick();
setInterval(() => { last = tick(); }, 50);
Object.assign(window, { sandbox: { state, loading: () => hud.get().loading, tick, view: () => last, setTime(t: number) { state.time = frozenTime = t; } } });

const signal = new AbortController().signal;
const noAction = async (): Promise<ActionResult> => ({ accepted: true });
function Sandbox() {
  const [frame, setFrame] = useState(last);
  useEffect(() => { listeners.add(setFrame); return () => { listeners.delete(setFrame); }; }, []);
  const base = { roomId: 'dev', roundId: 'dev-1', playerId, isHost: true, connected: true, serverNowMs, setInput: (input: unknown) => { held = parseInput(input); }, releaseInput() { held = parseInput(null); }, sendAction: noAction };
  return <>
    <div className="kp-scene-surface">
      <BlockwildScene {...base} phase="playing" settings={settings} viewRole={tv ? 'display' : 'controller'} privateView={frame.pv} players={roster} publicView={frame.view} snapshotTime={frame.at} signal={signal} onReady={() => {}} onError={error => console.error(error)}/>
    </div>
    <div className="kp-scene-overlay">
      {tv ? <DisplayView {...base} viewRole="display" publicView={frame.view} privateView={null} assetsReady={() => {}}/>
        : <ControllerView {...base} viewRole="controller" publicView={frame.view} privateView={frame.pv} assetsReady={() => {}}/>}
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<Sandbox/>);
