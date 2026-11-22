/**
 * Headless scale benchmark: how long a tick takes and how many bytes each screen receives per snapshot.
 *
 *   node --import tsx packages/games/blockwild/tools/scale-bench.ts [--players 10,32,64] [--layout cluster|spread|fly] [--edits 0] [--ticks 300] [--mode city]
 *
 * Layouts: `cluster` puts everyone within 24 blocks of the world spawn at night (the worst case for what each phone is
 * sent), `spread` puts players 160 blocks apart (the worst case for chunks and mobs), `fly` is creative players flying
 * outward at full speed (chunk streaming). With `--mode city` the world is Caper City: `cluster` is everyone on the plaza,
 * `spread` one player at every other intersection. The figures are relative: they move with the load on the machine.
 */
import { parseArgs } from 'node:util';
import { SnapshotEncoder } from '../../../party-contract/src/snapshot-cache';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { manifest } from '../src/manifest';
import { B } from '../src/shared/blocks';
import { FLY_SPEED } from '../src/shared/constants';
import { cellIndex } from '../src/shared/coords';
import { IF, validateSettings, type Input } from '../src/shared/protocol';
import { createState, tickState } from '../src/sim/game';
import type { Player, State } from '../src/sim/state';
import { playerView, publicView } from '../src/sim/views';
import { standNear, writeCell } from '../src/sim/world';

const { values: args } = parseArgs({ options: { players: { type: 'string', default: '10,32,64' }, layout: { type: 'string', default: 'cluster' }, edits: { type: 'string', default: '0' }, ticks: { type: 'string', default: '300' }, seed: { type: 'string', default: '11' }, mode: { type: 'string', default: '' } } });
const cityMode = args.mode === 'city';
const layout = args.layout as 'cluster' | 'spread' | 'fly', ticks = Number(args.ticks), edits = Number(args.edits), seed = Number(args.seed);
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
const summary = (times: number[]) => { const s = [...times].sort((a, b) => a - b); return `median ${quantile(s, 0.5).toFixed(2)} · p95 ${quantile(s, 0.95).toFixed(2)} · max ${s.at(-1)!.toFixed(2)} ms`; };
// A well-behaved client: it confirms the bag it was sent, so the bag is not repeated.
const hold = (player: Player, p: [number, number, number], f: number): Input => ({ p, v: [0, 0, 0], yaw: player.yaw, pitch: 0, f, slot: 0, mine: null, tpAck: player.tp.n, cmds: [], bag: player.bagRev });

function place(state: State, player: Player, x: number, z: number, y?: number) {
  const [sx, sy, sz] = y === undefined ? standNear(state, [x, state.spawn[1], z]) : [x, y, z];
  Object.assign(player, { x: sx, y: sy, z: sz, fallPeak: sy, supportY: sy, tp: { n: 1, x: sx, y: sy, z: sz }, protectedUntil: 0 });
}

function bench(count: number) {
  const ctx = { roomId: 'bench', roundId: 'bench', seed: 7, nowMs: 0, players: Array.from({ length: count }, (_, i) => ({ id: `player-${String(i).padStart(2, '0')}-0123456789abcdef`.slice(0, 24), name: `Bot ${String(i + 1).padStart(2, '0')} Sixteen Ch`.slice(0, 16), color: '#ff5748' })) };
  const state = createState(ctx, cityMode ? validateSettings({ mode: 'city', seed }) : { ...validateSettings({}), seed, mode: layout === 'fly' ? 'creative' : 'survival' });
  state.time = cityMode ? 6000 : 16000;
  state.players.forEach((player, i) => {
    const angle = i * 2.399963, radius = layout === 'cluster' ? 4 + Math.sqrt(i) * 3 : layout === 'spread' ? 160 * Math.sqrt(i) : 8 + i;
    // City: the plaza, or one player per intersection across the whole grid (road centres are always clear ground).
    if (cityMode) place(state, player, layout === 'cluster' ? state.spawn[0] + (i % 8 - 4) * 1.5 : 1736 + (i % 11) * 64, layout === 'cluster' ? state.spawn[2] + Math.floor(i / 8) * 1.5 - 6 : 1736 + ((i * 3 + Math.floor(i / 11) * 5) % 11) * 64, 64);
    else if (layout === 'fly') { place(state, player, state.spawn[0] + Math.cos(angle) * radius, state.spawn[2] + Math.sin(angle) * radius, 126); player.flying = true; }
    else place(state, player, state.spawn[0] + Math.cos(angle) * radius, state.spawn[2] + Math.sin(angle) * radius);
  });
  for (let i = 0; i < edits; i++) state.world.edits.set(cellIndex(Math.floor(state.spawn[0]) - 60 + i % 120, 100 + Math.floor(i / 14400), Math.floor(state.spawn[2]) - 60 + Math.floor(i / 120) % 120), B.stone);
  state.revision++;
  const step = FLY_SPEED * 0.05;
  const inputs = () => new Map(state.players.map((player, i): [string, Input] => {
    if (layout !== 'fly') return [player.id, hold(player, [player.x, player.y, player.z], IF.ON_GROUND)];
    const angle = i * 2.399963;
    return [player.id, hold(player, [player.x + Math.cos(angle) * step, player.y, player.z + Math.sin(angle) * step], IF.FLYING)];
  }));
  // Warm up: load the chunks, let the night fill with monsters and animals settle.
  const warm = performance.now();
  // (`spread` keeps going until every player's chunks are generated, so the figures are the steady state.)
  for (let i = 0, grown = 0, size = 0; i < (layout === 'fly' ? 20 : 600) || layout === 'spread' && i - grown < 200 && i < 20000; i++) {
    if (state.world.cache.size !== size) { size = state.world.cache.size; grown = i; }
    for (const player of state.players) Object.assign(player, { health: 20, dead: false, food: 20 });
    tickState(state, inputs(), 0.05);
  }
  const warmMs = performance.now() - warm, tickMs: number[] = [], publicMs: number[] = [], privateMs: number[] = [];
  const encoder = new SnapshotEncoder();
  // The baseline every connecting client pays once is not part of the steady traffic measured here.
  encoder.encode('bench', publicView(state), manifest.snapshotCache);
  let publicBytes = 0, privateBytes = 0, privateMax = 0, snapshots = 0;
  for (let i = 0; i < ticks; i++) {
    for (const player of state.players) Object.assign(player, { health: 20, dead: false, food: 20 });
    const input = inputs();
    let start = performance.now();
    tickState(state, input, 0.05);
    tickMs.push(performance.now() - start);
    // One edit a tick while a journal is under test: the tail carries it, and the journal is re-read only when the tail folds.
    if (edits) writeCell(state, Math.floor(state.spawn[0]) + i % 40, 110, Math.floor(state.spawn[2]) + Math.floor(i / 40), B.stone);
    start = performance.now();
    const view = publicView(state), encoded = encoder.encode('bench', view, manifest.snapshotCache);
    assertSerializable(encoded);
    const body = JSON.stringify(encoded);
    publicMs.push(performance.now() - start);
    publicBytes += body.length;
    start = performance.now();
    for (const player of state.players) {
      const mine = playerView(state, player.id);
      assertSerializable(mine);
      const text = JSON.stringify(mine);
      privateBytes += text.length;
      privateMax = Math.max(privateMax, text.length);
    }
    privateMs.push(performance.now() - start);
    snapshots++;
  }
  const perSocket = publicBytes / snapshots + privateBytes / snapshots / count, hz = manifest.simulation.snapshotHz;
  console.log(`\n${count} players · ${layout} · ${state.mobs.length} mobs · ${state.items.length} items · ${state.world.edits.size} edits · ${state.world.cache.size} chunks cached · warm-up ${(warmMs / 1000).toFixed(1)} s${state.city ? ` · city: ${state.city.vehicles.length} vehicles (${state.city.vehicles.filter(v => v.rail).length} in traffic), ${state.city.npcs.size} live residents of ${state.city.people.list.length}` : ''}`);
  console.log(`  tick            ${summary(tickMs)}`);
  console.log(`  public view     ${summary(publicMs)} · ${(publicBytes / snapshots / 1024).toFixed(2)} KiB a snapshot`);
  console.log(`  private views   ${summary(privateMs)} for all ${count} · ${(privateBytes / snapshots / count / 1024).toFixed(2)} KiB each (largest ${(privateMax / 1024).toFixed(2)})`);
  console.log(`  per socket      ${(perSocket / 1024).toFixed(2)} KiB a snapshot · ${(perSocket * hz / 1024).toFixed(0)} KiB/s at ${hz} Hz · whole room ${(perSocket * hz * count / 1024 / 1024).toFixed(2)} MiB/s`);
}
for (const count of args.players!.split(',').map(Number)) bench(count);
