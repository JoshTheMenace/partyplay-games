/** Strongholds on the server (DESIGN.md): thrown eyes of ender, frames and the End portal, travel, silverfish. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { B, cellId, cellState, FRAME_EYE, makeCell } from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource } from '../src/shared/chunk';
import { dimensionAt, EDIT_LIMIT, EDIT_LIMIT_TOAST, NETHER } from '../src/shared/constants';
import { cellIndex, FACING, localIndex } from '../src/shared/coords';
import { I } from '../src/shared/ids';
import { IF, MOB, PK, validateSettings, type CmdBody, type Difficulty, type Input, type Mode } from '../src/shared/protocol';
import { strongholdSites, strongholdsOf } from '../src/shared/structures/stronghold';
import { damageMob } from '../src/sim/combat';
import { throwEye, tickEyes, useEndFrame } from '../src/sim/ender-eyes';
import { createState, tickState } from '../src/sim/game';
import { newMob } from '../src/sim/mobs';
import type { Player, State } from '../src/sim/state';
import { breakBlock, writeCell } from '../src/sim/world';

/** Bedrock at y 0, stone up to 62, grass at 63: players stand at y 64. */
const FLAT = (() => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < 63 ? B.stone : B.grass_block;
  return chunk;
})();
const flat: ChunkSource = () => FLAT;
const X = 2048, Z = 2048, SEED = 11;
function game(mode: Mode = 'survival', difficulty: Difficulty = 'normal', source: ChunkSource | null = flat, spawn: [number, number, number] = [X, 64, Z], seed = SEED): State {
  const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: [{ id: 'p0', name: 'Ada', color: '#ff5748' }] };
  const state = createState(ctx, validateSettings({ seed, mode, difficulty }), { ...source ? { source } : {}, spawn });
  state.players[0]!.protectedUntil = 0;
  return state;
}
const hold = (player: Player, cmds: CmdBody[]): Input =>
  ({ p: [player.x, player.y, player.z], v: [0, 0, 0], yaw: player.yaw, pitch: player.pitch, f: IF.ON_GROUND, slot: player.slot, mine: null, tpAck: player.tp.n, cmds: cmds.map((c, i) => ({ n: player.ack + 1 + i, ...c }) as Input['cmds'][number]) });
const send = (state: State, cmds: CmdBody[] = []) => tickState(state, new Map([['p0', hold(state.players[0]!, cmds)]]), 0.05);
/** Move a player (loading the chunks around), standing on the flat ground. */
function moveTo(state: State, player: Player, x: number, z: number, y = 64) {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) state.get(x + dx * 16, 0, z + dz * 16);
  Object.assign(player, { x, y, z, fallPeak: y, supportY: y });
}
const eyes = (n: number) => ({ id: I.ender_eye, n });
const angle = (ax: number, az: number, bx: number, bz: number) => Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));

// Thrown eyes ---------------------------------------------------------------------------------------------------------

test('thrown eyes glide 12 blocks towards the nearest stronghold from anywhere in the Overworld', () => {
  const state = game('creative'), player = state.players[0]!, rooms = strongholdsOf(SEED);
  player.inv[0] = eyes(1);
  let checked = 0;
  for (let x = 160; x < 4000; x += 330) for (let z = 160; z < 4000; z += 330) {
    if (dimensionAt(x, z) !== 'overworld') continue;
    moveTo(state, player, x + 0.5, z + 0.5);
    state.arrows = [];
    assert.ok(throwEye(state, player, 0), `throw at ${x},${z}`);
    const eye = state.arrows.at(-1)!, goal = state.eyes.flights.get(eye.id)!;
    assert.equal(eye.k, PK.EYE);
    const room = [...rooms].sort((a, b) => Math.hypot(a[0] - x, a[2] - z) - Math.hypot(b[0] - x, b[2] - z))[0]!;
    const gx = goal.x - player.x, gz = goal.z - player.z;
    assert.ok(Math.abs(Math.hypot(gx, gz) - 12) < 1e-6, 'flies 12 blocks');
    // It aims at the door inside the room, at most ~10 blocks from the ring's centre.
    const off = angle(gx, gz, room[0] - x, room[2] - z), d = Math.hypot(room[0] - x, room[2] - z);
    assert.ok(off < Math.atan(10 / d) + 0.005, `from ${x},${z}: off by ${off.toFixed(3)} rad at ${d.toFixed(0)} blocks`);
    assert.ok(goal.y > player.y + 2, 'and rises');
    checked++;
  }
  assert.ok(checked > 100);
  // Within 12 blocks it stops right above the door inside the portal room, so digging down lands on the floor.
  const site = strongholdSites(SEED)[0]!, [lx, , lz] = site.landing;
  moveTo(state, player, lx + 5.5, lz + 3.5);
  state.arrows = [];
  throwEye(state, player, 0);
  const goal = state.eyes.flights.get(state.arrows.at(-1)!.id)!;
  assert.deepEqual([goal.x, goal.z], [lx + 0.5, lz + 0.5]);
});

test('an eye rises, hovers about a second, then drops as an item (~80%) or shatters; one in flight per player', () => {
  const state = game('creative'), player = state.players[0]!;
  player.inv[0] = eyes(1);
  moveTo(state, player, X + 0.5, Z + 0.5);
  let dropped = 0, shattered = 0;
  for (let i = 0; i < 200; i++) {
    state.items = [];
    const fx = state.fxId;
    assert.ok(throwEye(state, player, 0));
    assert.equal(throwEye(state, player, 0), false, 'one eye at a time');
    const eye = state.arrows.at(-1)!, goal = state.eyes.flights.get(eye.id)!, start = eye.y;
    let top = start, t = 0, landedAt = -1;
    while (eye.age !== Infinity && t < 5) {
      tickEyes(state, 0.05);
      t += 0.05;
      top = Math.max(top, eye.y);
      if (landedAt < 0 && Math.hypot(eye.x - goal.x, eye.y - goal.y, eye.z - goal.z) < 0.6) landedAt = t;
    }
    state.arrows = state.arrows.filter(a => a.age !== Infinity);
    assert.ok(top > start + 2 && landedAt > 0.8 && landedAt < 2, `glides up and arrives (${landedAt.toFixed(2)} s)`);
    assert.ok(t > 2.6 && t < 3, `hovers before falling (${t.toFixed(2)} s)`);
    if (state.items.some(item => item.item === I.ender_eye)) dropped++;
    if (state.fx.some(entry => entry.fx.id > fx && entry.fx.k === 'shatter')) shattered++;
  }
  assert.equal(dropped + shattered, 200);
  assert.ok(dropped >= 140 && dropped <= 180, `${dropped} of 200 dropped`);
  assert.equal(player.inv[0]!.n, 1, 'creative keeps its eye');
  assert.equal(state.eyes.flights.size, 0);
});

test('outside the Overworld an eye just drifts down and drops; survival spends the eye', () => {
  const state = game(), player = state.players[0]!;
  player.inv[0] = eyes(2);
  moveTo(state, player, NETHER.x0 + 100.5, NETHER.z0 + 100.5);
  assert.ok(throwEye(state, player, 0));
  assert.equal(player.inv[0]!.n, 1);
  assert.match(player.toast!.text, /only in the Overworld/);
  for (let i = 0; i < 70; i++) tickEyes(state, 0.05);
  const item = state.items.find(it => it.item === I.ender_eye)!;
  assert.ok(item && Math.hypot(item.x - player.x, item.z - player.z) < 2.5);
});

// Frames and the portal -----------------------------------------------------------------------------------------------

/** An empty ring of 12 frames on the flat ground around (cx, 64, cz), facing its centre (`wrong` turns one around). */
function ring(state: State, cx: number, cz: number, wrong = -1) {
  const frames: [number, number, number][] = [];
  FACING.forEach(([dx, dz], side) => {
    const [px, pz] = FACING[(side + 1) & 3]!;
    for (let k = -1; k <= 1; k++) frames.push([cx + dx * 2 + px * k, 64, cz + dz * 2 + pz * k]);
  });
  frames.forEach(([x, y, z], i) => writeCell(state, x, y, z, makeCell(B.end_portal_frame, (Math.floor(i / 3) + (i === wrong ? 0 : 2)) & 3)));
  return frames;
}
const portalCells = (state: State, cx: number, cz: number) => {
  let n = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (cellId(state.get(cx + dx, 64, cz + dz)) === B.end_portal) n++;
  return n;
};
const opened = (state: State) => state.fx.filter(entry => entry.fx.k === 'portalOpen').length;

test('eyes fill frames; the twelfth opens the 3 × 3 portal exactly once, whichever frame comes last', () => {
  const cx = X + 10, cz = Z;
  for (let last = 0; last < 12; last++) {
    const state = game(), player = state.players[0]!, frames = ring(state, cx, cz);
    player.inv[0] = eyes(12);
    frames.forEach(([x, y, z], i) => {
      if (i === last) return;
      assert.ok(useEndFrame(state, player, x, y, z));
      assert.ok(cellState(state.get(x, y, z)) & FRAME_EYE);
    });
    assert.equal(portalCells(state, cx, cz), 0, 'eleven eyes open nothing');
    assert.equal(useEndFrame(state, player, ...frames[(last + 1) % 12]!), false, 'a frame takes one eye');
    assert.ok(useEndFrame(state, player, ...frames[last]!));
    assert.equal(portalCells(state, cx, cz), 9);
    assert.equal(opened(state), 1);
    assert.match(player.toast!.text, /End portal is open/);
    assert.equal(player.inv[0], null, 'twelve eyes spent');
    player.inv[0] = eyes(1);
    assert.ok(frames.every(f => !useEndFrame(state, player, ...f)));
    assert.equal(opened(state), 1, 'never opens twice');
  }
});

test('at the edit limit the last eye stays in hand until the portal can open (never a full, closed ring)', () => {
  const cx = X + 10, cz = Z, state = game(), player = state.players[0]!, frames = ring(state, cx, cz);
  player.inv[0] = eyes(12);
  for (const f of frames.slice(1)) assert.ok(useEndFrame(state, player, ...f));
  const filler = Array.from({ length: EDIT_LIMIT - state.world.edits.size }, (_, i) => cellIndex(100 + (i & 1023), 120, 100 + (i >> 10)));
  for (const index of filler) state.world.edits.set(index, B.stone);
  assert.equal(useEndFrame(state, player, ...frames[0]!), false);
  assert.deepEqual([cellState(state.get(...frames[0]!)) & FRAME_EYE, portalCells(state, cx, cz), player.inv[0]!.n], [0, 0, 1]);
  assert.equal(player.toast?.text, EDIT_LIMIT_TOAST);
  for (const index of filler.slice(0, 9)) state.world.edits.delete(index);
  assert.ok(useEndFrame(state, player, ...frames[0]!));
  assert.equal(portalCells(state, cx, cz), 9);
});

test('a ring with a frame facing the wrong way, or a hand without an eye, opens nothing; the use command routes to frames', () => {
  const cx = X + 10, cz = Z, state = game(), player = state.players[0]!, frames = ring(state, cx, cz, 4);
  player.inv[0] = eyes(12);
  for (const f of frames) useEndFrame(state, player, ...f);
  assert.equal(portalCells(state, cx, cz), 0);
  assert.equal(opened(state), 0);
  const fresh = game(), p = fresh.players[0]!, all = ring(fresh, cx, cz);
  p.inv[0] = { id: B.stone, n: 1 };
  assert.equal(useEndFrame(fresh, p, ...all[0]!), false, 'needs an eye');
  p.inv[0] = eyes(12);
  for (const f of all.slice(1)) useEndFrame(fresh, p, ...f);
  // The last eye through the client's `use` command, standing beside that frame.
  const [x, y, z] = all[0]!;
  Object.assign(p, { x: x + 0.5, y: 64, z: z - 1.5, yaw: Math.PI, pitch: -0.6, slot: 0 });
  send(fresh, [{ t: 'use', x, y, z, face: 3 }]);
  assert.equal(portalCells(fresh, cx, cz), 9);
});

test('stepping into an open portal takes the player to the End; hovering above the plane does not', () => {
  const cx = X + 10, cz = Z, state = game(), player = state.players[0]!, frames = ring(state, cx, cz);
  player.inv[0] = eyes(12);
  for (const f of frames) useEndFrame(state, player, ...f);
  Object.assign(player, { x: cx + 0.5, y: 64.8, z: cz + 0.5, fallPeak: 64.8, supportY: 64.8 });
  send(state);
  assert.equal(dimensionAt(player.x, player.z), 'overworld', 'above the 12/16 plane');
  Object.assign(player, { y: 64.3, fallPeak: 64.3 });
  send(state);
  assert.equal(dimensionAt(player.x, player.z), 'end');
});

// Silverfish ----------------------------------------------------------------------------------------------------------

const fishes = (state: State) => state.mobs.filter(m => m.t === MOB.silverfish && m.health > 0);

test('breaking infested bricks releases a silverfish that hunts the nearest player (none in peaceful), and drops nothing', () => {
  for (const difficulty of ['normal', 'peaceful'] as const) {
    const state = game('survival', difficulty);
    writeCell(state, X + 3, 64, Z, B.silverfish_stone);
    assert.ok(breakBlock(state, X + 3, 64, Z));
    assert.equal(state.items.length, 0);
    assert.equal(fishes(state).length, difficulty === 'peaceful' ? 0 : 1);
    if (difficulty === 'normal') assert.equal(fishes(state)[0]!.target, 'p0');
  }
});

test('silverfish scurry to a player and nip for 1', () => {
  const state = game(), player = state.players[0]!;
  state.mobs.push(newMob(state, MOB.silverfish, X + 5.5, 64, Z + 0.5));
  const hits: number[] = [];
  let health = player.health;
  for (let i = 0; i < 120; i++) {
    send(state);
    if (player.health < health) hits.push(health - player.health);
    health = player.health;
  }
  assert.ok(hits.length >= 2, `bites ${hits.length}`);
  assert.ok(hits.every(h => h === 1), `bite damage ${hits}`);
});

test('a hurt silverfish calls the hidden ones out of nearby infested bricks, never past 8 around', () => {
  const state = game(), player = state.players[0]!;
  for (let y = 60; y <= 63; y++) for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) writeCell(state, X + 8 + dx, y, Z + dz, B.silverfish_stone);
  const fish = newMob(state, MOB.silverfish, X + 8.5, 64, Z + 0.5);
  state.mobs.push(fish);
  damageMob(state, fish, 1, player);
  send(state);
  const near = (mob: { x: number; y: number; z: number }) => fishes(state).filter(m => Math.hypot(m.x - mob.x, m.y - mob.y, m.z - mob.z) <= 8).length;
  assert.equal(near(fish), 8, 'calls up to 8');
  for (const other of fishes(state).slice(0, 4)) damageMob(state, other, 1, player);
  send(state);
  assert.ok(fishes(state).every(m => near(m) <= 8), 'still at most 8 around any of them');
  assert.ok(fishes(state).length <= 12);
});

test('the portal room spawner breeds silverfish in a real generated stronghold', () => {
  const seed = 4242, site = strongholdSites(seed)[0]!, [lx, ly, lz] = site.landing;
  const state = game('survival', 'normal', null, [lx + 0.5, ly, lz + 0.5], seed), player = state.players[0]!;
  Object.assign(player, { x: lx + 0.5, y: ly, z: lz + 0.5, fallPeak: ly, supportY: ly });
  // Keep the spawner due every tick (it waits 10–40 s after a cycle): this checks the room has dark floor in view of it.
  for (let i = 0; i < 200 && !fishes(state).length; i++) {
    for (const index of state.structures.spawners.keys()) state.structures.spawners.set(index, state.clock);
    send(state);
  }
  assert.ok(fishes(state).length > 0, 'silverfish spawned');
  const [cx, cy, cz] = site.center;
  assert.ok(fishes(state).every(m => Math.abs(m.x - cx) < 12 && Math.abs(m.z - cz) < 12 && Math.abs(m.y - cy) < 4), 'inside the portal room');
});
