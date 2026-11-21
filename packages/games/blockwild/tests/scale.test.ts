/**
 * Big rooms: what each screen is sent, the two-tier edit journal, the bag, the roster and the caps that follow the roster.
 * A flat world keeps these about the netcode and rules, not terrain.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_ROOM_PLAYERS } from '../../../party-contract/src/index';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { SnapshotDecoder, SnapshotEncoder } from '../../../party-contract/src/snapshot-cache';
import { manifest } from '../src/manifest';
import { B } from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource } from '../src/shared/chunk';
import { END_CENTER } from '../src/shared/constants';
import { cellIndex, localIndex } from '../src/shared/coords';
import { I } from '../src/shared/items';
import {
  decodeArrow, decodeFx, decodeItem, decodeMob, decodePlayer, decodeRoster, decodeScene, encodeArrow, encodeFx, encodeItem, encodeMob, encodePlayer, IF, MOB, nearEvery, PF, rosterEvery, tvEvery, validateSettings,
  type Input, type Settings, type View, type Who,
} from '../src/shared/protocol';
import { createState, tickState } from '../src/sim/game';
import { tailCap } from '../src/sim/journal';
import { animalCap, hostileCap, newMob, worldHostileCap } from '../src/sim/mobs';
import { sleepNeed } from '../src/sim/players';
import { addFx, type Player, type State } from '../src/sim/state';
import { playerView, publicView } from '../src/sim/views';
import { writeCell } from '../src/sim/world';
import { sceneOf } from './scene';

const FLAT = (() => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < 63 ? B.stone : B.grass_block;
  return chunk;
})();
const flat: ChunkSource = () => FLAT;
const X = 2048, Z = 2048;
function game(players: number, settings: Partial<Settings> = {}): State {
  const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `Player ${String(i).padStart(2, '0')} of many`.slice(0, 16), color: '#ff5748' })) };
  const state = createState(ctx, { ...validateSettings({}), ...settings }, { source: flat, spawn: [X, 64, Z] });
  for (const player of state.players) player.protectedUntil = 0;
  return state;
}
const move = (player: Player, x: number, z: number, y = 64) => Object.assign(player, { x, y, z, fallPeak: y, supportY: y, tp: { n: 1, x, y, z } });
const hold = (player: Player, extra: Partial<Input> = {}): Input =>
  ({ p: [player.x, player.y, player.z], v: [0, 0, 0], yaw: player.yaw, pitch: player.pitch, f: IF.ON_GROUND, slot: player.slot, mine: null, tpAck: player.tp.n, cmds: [], ...extra });
const run = (state: State, ticks = 1, inputs: Record<string, Input> = {}) => { for (let i = 0; i < ticks; i++) tickState(state, new Map(Object.entries(inputs)), 0.05); };

test('the manifest seats a full room and caches the roster of names with the journal', () => {
  assert.equal(manifest.players.max, MAX_ROOM_PLAYERS);
  assert.deepEqual(manifest.snapshotCache.fields, ['edits', 'who']);
  assert.ok(manifest.prepareTimeoutMs >= 60000, 'one slow phone among 64 must not fail the start');
});

test('wire tuples decode to the entities they were made from', () => {
  const who: Who[] = [['a', 'Ada', '#ff0000'], ['b', 'Bo', '#00ff00']];
  const player = { x: 2048.37, y: 64, z: 2051.5, yaw: -1.57, pitch: 0.25, held: I.iron_pickaxe, swing: 3, hurt: 1, health: 13.5, flags: PF.SNEAKING, armor: [0, 0, 0, 0] as [number, number, number, number] };
  assert.deepEqual(decodePlayer(encodePlayer(1, player), who), { id: 'b', name: 'Bo', color: '#00ff00', ...player });
  assert.equal(encodePlayer(1, player).length, 11, 'no armor, not mining: the short form');
  const mining = { ...player, armor: [I.iron_helmet, 0, 0, I.leather_boots] as [number, number, number, number], mine: [2048, 63, 2050, 4] as [number, number, number, number] };
  assert.deepEqual(decodePlayer(encodePlayer(0, mining), who), { id: 'a', name: 'Ada', color: '#ff0000', ...mining });
  assert.equal(decodePlayer([5, 1, 2, 3, 0, 0, 0, 0, 0, 20, 0], who).name, 'Explorer', 'a seat nobody knows still draws');
  for (const mob of [{ id: 9, t: MOB.cow, x: 1.5, y: 64, z: 2.25, yaw: 0.5, hurt: 0, a: 1 }, { id: 10, t: MOB.sheep, x: 1, y: 2, z: 3, yaw: 0, hurt: 2, a: 0, s: 3 },
    { id: 11, t: MOB.villager, x: 1, y: 2, z: 3, yaw: 0, hurt: 0, a: 0, p: 0 }, { id: 12, t: MOB.villager, x: 1, y: 2, z: 3, yaw: 0, hurt: 0, a: 0, p: 5 },
    { id: 13, t: MOB.ender_dragon, x: 1, y: 2, z: 3, yaw: 1, hurt: 0, a: 1, pt: -0.35, ph: 0 }, { id: 14, t: MOB.ender_dragon, x: 1, y: 2, z: 3, yaw: 1, hurt: 0, a: 1, ph: 5 }]) assert.deepEqual(decodeMob(encodeMob(mob)), mob);
  assert.equal(encodeMob({ id: 9, t: MOB.cow, x: 1.5, y: 64, z: 2.25, yaw: 0.5, hurt: 0, a: 1 }).length, 8);
  const item = { id: 4, item: I.bread, n: 3, x: 1.25, y: 64.5, z: -0 + 7 }, arrow = { id: 5, x: 1, y: 2, z: 3, vx: 12.5, vy: -3, vz: 0.25 };
  assert.deepEqual(decodeItem(encodeItem(item)), item);
  assert.deepEqual(decodeArrow(encodeArrow(arrow)), arrow);
  assert.deepEqual(decodeArrow(encodeArrow({ ...arrow, k: 4 })), { ...arrow, k: 4 });
  for (const fx of [{ id: 7, k: 'break' as const, x: 1, y: 2, z: 3, a: 513 }, { id: 8, k: 'observer' as const, x: 1.5, y: 2, z: 3 }, { id: 9, k: 'lever' as const, x: 1, y: 2, z: 3, a: 0 }]) assert.deepEqual(decodeFx(encodeFx(fx)), fx);
});

test('each screen is sent what is near it; everything else stays off its wire', () => {
  const state = game(64);
  // Two camps a kilometre apart, and one player alone between them.
  state.players.forEach((player, i) => move(player, i < 40 ? X + (i % 8) * 2 : i < 63 ? X + 1000 + (i % 8) * 2 : X + 500, Z + Math.floor(i / 8) * 2));
  const cow = newMob(state, MOB.cow, X + 5, 64, Z + 5), farCow = newMob(state, MOB.cow, X + 1004, 64, Z + 12), dragon = newMob(state, MOB.ender_dragon, END_CENTER.x, 90, END_CENTER.z);
  state.mobs.push(cow, farCow, dragon);
  addFx(state, 'place', X + 3, 64, Z + 3, B.stone);
  addFx(state, 'explode', X + 1100, 64, Z);
  const view = publicView(state), here = sceneOf(state, 'p0'), there = sceneOf(state, 'p45'), alone = sceneOf(state, 'p63');
  assert.equal(here.players.length, 40);
  assert.equal(there.players.length, 23);
  assert.deepEqual(alone.players.map(player => player.id), ['p63'], 'a player always sees themselves');
  assert.deepEqual([here.mobs.map(mob => mob.id), there.mobs.map(mob => mob.id), alone.mobs.length], [[cow.id], [farCow.id], 0]);
  assert.deepEqual([here.fx.map(fx => fx.k), there.fx.map(fx => fx.k)], [['place'], ['explode']], 'effects reach only the screens in earshot (explosions carry further)');
  assert.equal(view.who.length, 64);
  assert.ok(!('players' in view) && !('mobs' in view), 'the public view carries no per-frame entity lists');
  // The dragon is seen from across the End, though not from the overworld.
  move(state.players[63]!, END_CENTER.x + 250, END_CENTER.z + 100, 70);
  assert.deepEqual(sceneOf(state, 'p63').mobs.map(mob => mob.t), [MOB.ender_dragon]);
  for (const player of state.players) assertSerializable(playerView(state, player.id));
  assertSerializable(view);
  // Traffic: one camp of 40 costs each of its phones a few KiB a snapshot; the lone player's snapshot is tiny.
  const bytes = (id: string) => JSON.stringify(playerView(state, id).near ?? playerView({ ...state, ticks: state.ticks + 1 }, id).near).length;
  // A room this size gets its scenes in every second snapshot, seats taking turns.
  assert.deepEqual([0, 1, 2, 3].map(seat => 'near' in playerView(state, `p${seat}`)), state.ticks % 2 ? [false, true, false, true] : [true, false, true, false]);
  assert.ok(bytes('p0') < 3200 && bytes('p63') < 160, `${bytes('p0')} and ${bytes('p63')} bytes`);
});

test('edits ride a short tail and fold into the cached journal once it is old or long', () => {
  const state = game(2), encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder(), policy = manifest.snapshotCache;
  /** What a connected client reconstructs: the journal after the platform's cache, with the tail applied over it. */
  const client = () => {
    const encoded = encoder.encode('round', publicView(state), policy);
    const view = decoder.decode({ roundId: 'round', revision: 0, serverTime: 0, privateView: null, ...encoded } as Parameters<SnapshotDecoder['decode']>[0], policy)!.publicView as View;
    const cells = new Map<number, number>(view.edits);
    for (let i = 0; i < view.recent.length; i += 2) if (view.recent[i + 1]! < 0) cells.delete(view.recent[i]!); else cells.set(view.recent[i]!, view.recent[i + 1]!);
    return { view, cells, cached: encoded.publicCache! };
  };
  // A journal of some size first: the platform patches a journal only when the change is small beside it.
  for (let i = 0; i < 60; i++) writeCell(state, X - 40 + i, 80, Z, B.stone);
  run(state, 31);
  const before = client(), revision = state.revision;
  assert.deepEqual([before.view.recent, before.view.edits.length], [[], 60]);
  writeCell(state, X + 3, 64, Z, B.cobblestone);
  writeCell(state, X + 4, 64, Z, B.torch);
  const fresh = client();
  assert.deepEqual([fresh.view.revision, fresh.cached.reused], [revision, true], 'the journal is not re-read for single edits');
  assert.deepEqual(fresh.view.recent, [cellIndex(X + 3, 64, Z), B.cobblestone, cellIndex(X + 4, 64, Z), B.torch]);
  assert.ok(fresh.view.er > before.view.er);
  assert.deepEqual([...fresh.cells], [...state.world.edits], 'journal + tail is the world');
  // Breaking the torch again restores terrain: the tail says so with −1 until the fold.
  writeCell(state, X + 4, 64, Z, B.air);
  assert.deepEqual(client().view.recent.slice(-2), [cellIndex(X + 4, 64, Z), -1]);
  run(state, 31);
  const folded = client();
  assert.deepEqual([folded.view.revision, folded.view.recent, folded.cached.reused], [revision + 1, [], false], 'a second and a half later the tail is folded in');
  assert.deepEqual(folded.cached.patches?.edits, { set: [[cellIndex(X + 3, 64, Z), B.cobblestone]], remove: [] }, 'as one small patch');
  assert.deepEqual([...folded.cells], [...state.world.edits]);
  // A blast of edits folds at once instead of repeating a long tail in every snapshot.
  run(state, 12);
  for (let i = 0; i < tailCap(state.world.edits.size) + 4; i++) writeCell(state, X - 20 + i, 70, Z + 9, B.stone);
  run(state, 1);
  assert.deepEqual([client().view.recent.length, state.revision], [0, revision + 2]);
  // Steady building never folds more than twice a second.
  const folds = state.revision;
  for (let tick = 0; tick < 40; tick++) { for (let i = 0; i < 12; i++) writeCell(state, X - 30 + tick, 72 + i, Z + 9, B.stone); run(state, 1); }
  assert.ok(state.revision - folds <= 5, `${state.revision - folds} folds in two seconds`);
  assert.deepEqual([...client().cells].sort(([a], [b]) => a - b), [...state.world.edits].sort(([a], [b]) => a - b));
});

test('the bag is sent until the client confirms its revision, and again when it changes', () => {
  const state = game(1), player = state.players[0]!;
  player.inv[0] = { id: B.dirt, n: 3 };
  const first = playerView(state, 'p0');
  assert.deepEqual([first.bag?.inv[0], first.bag?.rev], [{ id: B.dirt, n: 3 }, first.bagRev]);
  run(state, 1, { p0: hold(player) });
  assert.ok(playerView(state, 'p0').bag, 'no confirmation yet: sent again');
  run(state, 1, { p0: hold(player, { bag: first.bagRev }) });
  const quiet = playerView(state, 'p0');
  assert.deepEqual([quiet.bag, quiet.bagRev], [undefined, first.bagRev]);
  // What is left besides the scene (whose size is the neighbourhood's) is small and fixed.
  const rest = JSON.stringify({ ...quiet, near: undefined }).length;
  assert.ok(rest < 330, `${rest} bytes besides the scene while nothing changes`);
  player.inv[0]!.n = 2;
  const changed = playerView(state, 'p0');
  assert.deepEqual([changed.bag?.inv[0]?.n, changed.bagRev > first.bagRev], [2, true]);
  // A client that lost its state (reconnect, new scene) says 0 and gets the bag back.
  run(state, 1, { p0: hold(player, { bag: changed.bagRev }) });
  assert.equal(playerView(state, 'p0').bag, undefined);
  run(state, 1, { p0: hold(player, { bag: 0 }) });
  assert.ok(playerView(state, 'p0').bag);
});

test('the roster and the TV feed arrive a few times a second in a big room, live in a small one', () => {
  assert.deepEqual([1, 8, 9, 16, 17, 64].map(tvEvery), [1, 1, 2, 2, 4, 4]);
  assert.deepEqual([1, 16, 17, 64].map(nearEvery), [1, 1, 2, 2]);
  assert.deepEqual([1, 10, 11, 64].map(rosterEvery), [4, 4, 10, 10]);
  const state = game(32);
  state.players.forEach((player, i) => move(player, X + i * 300 % 3000, Z + i * 7));
  let rosters = 0, feeds = 0, last: View | undefined;
  for (let tick = 0; tick < 40; tick++) {
    run(state, 1, Object.fromEntries(state.players.map(player => [player.id, hold(player)])));
    const view = publicView(state);
    rosters += view.roster ? 1 : 0;
    feeds += view.tv ? 1 : 0;
    if (view.roster && view.tv) last = view;
  }
  assert.deepEqual([rosters, feeds], [4, 10]);
  const roster = last!.roster!.map(decodeRoster), focus = last!.tv!.focus, subject = state.players[focus]!;
  assert.equal(roster.length, 32);
  assert.deepEqual([roster[5]!.seat, roster[5]!.x, roster[5]!.health], [5, state.players[5]!.x, 20]);
  // The feed is the scene around the followed seat, the same tuples that seat's own screen gets.
  const feed = decodeScene(last!.tv!, last!.who);
  assert.ok(feed.players.some(player => player.id === subject.id));
  assert.ok(feed.players.every(player => Math.hypot(player.x - subject.x, player.z - subject.z) <= 64));
  // Every phone is sent the feed as well, so a crowd round the followed player is cut to the nearest 24.
  const crowd = game(64);
  run(crowd, 4);
  const packed = publicView(crowd).tv!;
  assert.deepEqual([packed.p.length, packed.p.some(tuple => tuple[0] === packed.focus)], [24, true]);
  // The camera moves on after 18 seconds, to a connected, living player.
  const visited = new Set<number>([focus]);
  state.players[(focus + 1) % 32]!.connected = false;
  state.players[(focus + 2) % 32]!.dead = true;
  for (let tick = 0; tick < 20 * 40; tick++) { run(state, 1); visited.add(state.focus); }
  assert.deepEqual([...visited], [focus, (focus + 3) % 32, (focus + 4) % 32]);
  const empty = game(2);
  for (const player of empty.players) player.connected = false;
  run(empty, 1);
  assert.equal(publicView(empty).tv?.focus, -1);
});

test('a full room spawns side by side, not stacked', () => {
  const state = game(64), cells = new Set(state.players.map(player => `${Math.floor(player.x)},${Math.floor(player.z)}`));
  assert.equal(cells.size, 64);
  assert.ok(state.players.every(player => Math.hypot(player.x - state.spawn[0], player.z - state.spawn[2]) < 8));
  assert.deepEqual(state.players.map(player => player.seat), Array.from({ length: 64 }, (_, i) => i));
});

test('half a crowd in bed passes the night; a small group still needs everyone', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 10, 32, 64].map(sleepNeed), [1, 2, 3, 2, 3, 5, 16, 32]);
  const state = game(10);
  state.time = 14000;
  const bed = (count: number) => state.players.forEach((player, i) => Object.assign(player, { sleeping: i < count, sleepSince: state.clock - 3, bed: [X + i, 64, Z + 5] }));
  state.players.forEach((_, i) => writeCell(state, X + i, 64, Z + 5, B.bed));
  bed(4);
  run(state, 1);
  assert.deepEqual([state.day, publicView(state).sleeping, publicView(state).sleepNeed], [0, 4, 5]);
  bed(5);
  run(state, 1);
  assert.deepEqual([state.day, state.players.some(player => player.sleeping)], [1, false], 'morning, and everyone is up');
});

test('monster and animal caps follow the company around each player, with a ceiling for the world', () => {
  const solo = game(1), party = game(10), room = game(64);
  for (const state of [solo, party, room]) state.day = 1;
  assert.deepEqual([hostileCap(solo), hostileCap(party), hostileCap(room), worldHostileCap(room)], [8, 50, 50, 144]);
  assert.equal(hostileCap(room, 1), 8, 'a player alone in a full room gets a solo night');
  assert.deepEqual([animalCap(solo), animalCap(party), animalCap(game(32)), animalCap(room)], [48, 48, 136, 160]);
});

test('a full room spread over the world keeps its ground loaded and its ticks cheap', () => {
  const state = game(64);
  state.players.forEach((player, i) => move(player, 200 + (i % 8) * 400, 200 + Math.floor(i / 8) * 400));
  const inputs = Object.fromEntries(state.players.map(player => [player.id, hold(player)]));
  // Chunks stream in within a per-tick budget; give them time, then check that none were pushed out again.
  for (let i = 0; i < 40 && state.world.cache.size < 64 * 49; i++) run(state, 100, inputs);
  run(state, 100, inputs);
  assert.ok(state.world.cache.size >= 64 * 49, `${state.world.cache.size} chunks`);
  assert.ok(state.players.every(player => state.world.cache.has(Math.floor(player.x) >> 4, Math.floor(player.z) >> 4)));
  const times: number[] = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    run(state, 1, inputs);
    publicView(state);
    for (const player of state.players) playerView(state, player.id);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(`64 spread players: tick + 65 views median ${times[50]!.toFixed(2)} ms, p95 ${times[95]!.toFixed(2)} ms`);
  assert.ok(times[50]! < 12, `median ${times[50]} ms`);
});
