import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSerializable } from '../../../party-contract/src/serializable';
import rules from '../src/server';
import { B, cellId, cellState, DOOR_OPEN, DOOR_UPPER, makeCell } from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource } from '../src/shared/chunk';
import { EDIT_LIMIT, EDIT_LIMIT_TOAST, SEA_LEVEL } from '../src/shared/constants';
import { cellIndex, chunkKey, localIndex } from '../src/shared/coords';
import { I, type Slot } from '../src/shared/items';
import { newBody, stepBody } from '../src/shared/physics';
import { IF, MOB, neutralInput, parseInput, PF, validateSettings, type CmdBody, type Input, type Settings } from '../src/shared/protocol';
import { damagePlayer, explode, hostileDamage } from '../src/sim/combat';
import { createState, setPresence, tickState } from '../src/sim/game';
import { hostileCap, MAX_ANIMALS, newMob, populateChunk } from '../src/sim/mobs';
import { findPath } from '../src/sim/pathfind';
import { primeTnt } from '../src/sim/redstone';
import type { Player, State } from '../src/sim/state';
import { breakBlock, writeCell } from '../src/sim/world';
import { playerView, publicView } from '../src/sim/views';
import { generateChunk } from '../src/shared/worldgen';
import { structuresNear } from '../src/shared/structures/index';

/** Flat test world: bedrock at 0, stone to 59, dirt to 62, grass at 63 (players stand at y = 64). */
const FLAT = (() => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < 60 ? B.stone : y < 63 ? B.dirt : B.grass_block;
  }
  return chunk;
})();
const flat: ChunkSource = () => FLAT;
const X = 2048, Z = 2048, GROUND = 63;

/** A test world spawning at (X, Z); spawn protection is lifted (tests of it restore it). */
function game(players = 1, settings: Partial<Settings> = {}, source: ChunkSource = flat): State {
  const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, color: '#ff5748' })) };
  const state = createState(ctx, { ...validateSettings({}), ...settings }, { source, spawn: [X, GROUND + 1, Z] });
  for (const player of state.players) player.protectedUntil = 0;
  return state;
}
const p = (state: State, i = 0) => state.players[i]!;
/** Held input echoing the player's accepted position (the well-behaved client). */
const hold = (player: Player, extra: Partial<Input> = {}): Input =>
  ({ p: [player.x, player.y, player.z], v: [0, 0, 0], yaw: player.yaw, pitch: player.pitch, f: IF.ON_GROUND, slot: player.slot, mine: null, tpAck: player.tp.n, cmds: [], ...extra });
function run(state: State, inputs: Record<string, Input> = {}, ticks = 1) {
  for (let i = 0; i < ticks; i++) tickState(state, new Map(Object.entries(inputs)), 0.05);
}
let n = 0;
const cmd = (body: CmdBody) => ({ n: ++n, ...body }) as Input['cmds'][number];
/** Run commands for player 0 in one tick (sequence numbers continue from the player's ack). */
function send(state: State, bodies: CmdBody[], extra: Partial<Input> = {}, i = 0) {
  const player = p(state, i);
  n = player.ack;
  run(state, { [player.id]: hold(player, { ...extra, cmds: bodies.map(cmd) }) });
}
const count = (slots: readonly (Slot | null)[], id: number) => slots.reduce((sum, s) => sum + (s?.id === id ? s.n : 0), 0);
const itemsOf = (state: State, id: number) => state.items.filter(item => item.item === id).reduce((sum, item) => sum + item.n, 0);

test('commands run once, in order; rejected commands still advance ack', () => {
  const state = game(), player = p(state);
  player.inv[0] = { id: B.oak_log, n: 2 };
  const input = hold(player, { cmds: [
    { n: 1, t: 'craft', r: 'oak_planks' },
    { n: 2, t: 'break', x: X + 40, y: GROUND, z: Z },
    { n: 3, t: 'craft', r: 'oak_planks' },
  ] });
  run(state, { p0: input });
  assert.equal(player.ack, 3);
  assert.equal(count(player.inv, B.oak_planks), 8);
  assert.equal(count(player.inv, B.oak_log), 0);
  // The client resends unacknowledged commands until it sees the ack: nothing runs twice.
  run(state, { p0: input }, 3);
  assert.equal(count(player.inv, B.oak_planks), 8);
  run(state, { p0: hold(player, { cmds: [{ n: 3, t: 'craft', r: 'oak_planks' }, { n: 4, t: 'craft', r: 'stick' }] }) });
  assert.equal(player.ack, 4);
  assert.equal(count(player.inv, I.stick), 4);
  // Garbage and duplicates are sanitized by parseInput before the server sees them.
  const parsed = parseInput({ p: [X, 64, Z], cmds: [{ n: 9, t: 'close' }, { n: 7, t: 'close' }, { n: 9, t: 'drop', slot: 0 }, { n: 8, t: 'nope' }, null] });
  assert.deepEqual(parsed.cmds.map(c => c.n), [7, 9]);
  assert.equal(parseInput({ x: 1, y: 0 }).f & IF.NO_POS, IF.NO_POS);
});

test('a rejected place leaves edits untouched so the optimistic overlay reverts', () => {
  const state = game(2), player = p(state), other = p(state, 1);
  assert.equal(Math.floor(other.x), X + 1);
  player.inv[0] = { id: B.stone, n: 5 };
  const before = [...state.world.edits], revision = state.revision;
  // Onto the other player's feet, from an empty slot, and out of reach.
  send(state, [{ t: 'place', x: X + 1, y: GROUND, z: Z, face: 3, slot: 0 }, { t: 'place', x: X + 2, y: GROUND, z: Z, face: 3, slot: 4 }, { t: 'place', x: X + 12, y: GROUND, z: Z, face: 3, slot: 0 }]);
  assert.equal(player.ack, 3);
  assert.deepEqual([...state.world.edits], before);
  assert.equal(state.revision, revision);
  assert.equal(count(player.inv, B.stone), 5);
  send(state, [{ t: 'place', x: X + 2, y: GROUND, z: Z, face: 3, slot: 0 }]);
  assert.equal(state.get(X + 2, 64, Z), B.stone);
  assert.equal(count(player.inv, B.stone), 4);
  assert.ok(state.revision > revision);
});

test('the edit limit rejects new cells with the building-limit toast', () => {
  const state = game(), player = p(state);
  for (let i = 0; i < EDIT_LIMIT; i++) state.world.edits.set(cellIndex(i % 4096, 120, Math.floor(i / 4096)), B.stone);
  player.inv[0] = { id: B.stone, n: 5 };
  send(state, [{ t: 'place', x: X + 2, y: GROUND, z: Z, face: 3, slot: 0 }]);
  assert.equal(state.get(X + 2, 64, Z), B.air);
  assert.equal(player.toast?.text, EDIT_LIMIT_TOAST);
});

test('movement validation accepts walking and falling, rejects teleports and noclip', () => {
  const state = game(), player = p(state);
  // Sprint-speed walking.
  for (let i = 0; i < 20; i++) run(state, { p0: hold(player, { p: [player.x + 0.27, player.y, player.z] }) });
  assert.ok(Math.abs(player.x - (X + 0.5 + 20 * 0.27)) < 1e-6);
  assert.equal(player.tp.n, 1);
  assert.ok(player.stats.distance > 5);
  // A 30-block hop is refused with a teleport back.
  const x0 = player.x;
  run(state, { p0: hold(player, { p: [player.x + 30, player.y, player.z] }) });
  assert.ok(Math.abs(player.x - x0) < 0.01);
  assert.equal(player.tp.n, 2);
  // Until the client acknowledges the teleport, its positions are ignored.
  run(state, { p0: hold(player, { p: [player.x + 0.2, player.y, player.z], tpAck: 1 }) });
  assert.ok(Math.abs(player.x - x0) < 0.01);
  run(state, { p0: hold(player, { p: [player.x + 0.2, player.y, player.z] }) });
  assert.ok(Math.abs(player.x - x0 - 0.2) < 0.01);
  // Walking into a wall stops at the wall; jumping through it after standing still is caught by the sweep.
  const wall = Math.floor(player.x) + 2;
  for (let dz = -2; dz <= 2; dz++) for (let y = 64; y <= 66; y++) writeCell(state, wall, y, Math.floor(player.z) + dz, B.stone);
  for (let i = 0; i < 12; i++) run(state, { p0: hold(player, { p: [player.x + 0.25, player.y, player.z] }) });
  assert.ok(player.x + 0.3 <= wall + 0.05, `stopped at the wall (x=${player.x})`);
  assert.ok(player.tp.n > 2);
  run(state, {}, 25);
  const tp = player.tp.n;
  run(state, { p0: hold(player, { p: [wall + 1.5, player.y, player.z] }) });
  assert.ok(player.x < wall);
  assert.equal(player.tp.n, tp + 1);
});

test('a player stuck inside a block may walk out of it, but never on into another block', () => {
  const state = game(), player = p(state);
  for (const [x, y] of [[X, 64], [X, 65], [X + 1, 64], [X + 1, 65]] as const) writeCell(state, x, y, Z, B.stone);
  // Each try waits a second first, so the walking allowance is never what refuses it.
  const tries = (x: number) => { run(state, {}, 20); run(state, { p0: hold(player, { p: [x, 64, player.z] }) }); return player.x; };
  assert.equal(tries(X + 0.9), X + 0.5, 'pushing on into the next block is refused');
  assert.equal(tries(X - 0.1), X - 0.1, 'stepping out into the open is fine');
});

test('movement allowances are spent, not re-granted: no sustained over-speed and no climbing through the air', () => {
  const state = game(), player = p(state);
  run(state, {}, 30);
  // 1.6 m per tick is 32 m/s: the stored lag burst covers a few ticks, then the server snaps the player back.
  for (let i = 0; i < 20; i++) run(state, { p0: hold(player, { p: [player.x + 1.6, player.y, player.z] }) });
  assert.ok(player.x - X < 16, `x advanced ${player.x - X}`);
  assert.ok(player.tp.n > 1);
  // Rising 0.5 m every tick is accepted up to a jump's height above the ground, never beyond.
  for (let i = 0; i < 20; i++) run(state, { p0: hold(player, { p: [player.x, player.y + 0.5, player.z], f: 0 }) });
  assert.ok(player.y <= GROUND + 1 + 1.6, `y ${player.y}`);
});

test('falls are accepted at physics speed and hurt by floor(distance - 3)', () => {
  const state = game(), player = p(state);
  Object.assign(player, { y: 74, fallPeak: 74, onGround: false, movedAt: state.clock });
  const body = newBody(player.x, 74, player.z), still = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, flyDown: false, yaw: 0 };
  for (let i = 0; i < 40 && player.y > 64; i++) {
    stepBody(body, still, 0.05, state.get, 'survival');
    run(state, { p0: hold(player, { p: [body.x, body.y, body.z], f: body.onGround ? IF.ON_GROUND : 0 }) });
  }
  assert.equal(player.tp.n, 1, 'no position was rejected');
  assert.equal(player.y, 64);
  assert.equal(player.health, 13);
});

test('mining needs the right time and tool; drops follow tool tiers', () => {
  const state = game(), player = p(state), sx = X + 1, sz = Z;
  writeCell(state, sx, 64, sz, B.stone);
  player.inv[0] = { id: I.wooden_pickaxe, n: 1 };
  const mine: [number, number, number] = [sx, 64, sz];
  run(state, { p0: hold(player, { mine }) });
  run(state, { p0: hold(player, { mine }) }, 2);
  // 0.15 s into a 1.125 s break (server floor 0.525 s): too fast.
  send(state, [{ t: 'break', x: sx, y: 64, z: sz }], { mine });
  assert.equal(state.get(sx, 64, sz), B.stone);
  run(state, { p0: hold(player, { mine }) }, 8);
  send(state, [{ t: 'break', x: sx, y: 64, z: sz }], { mine });
  assert.equal(state.get(sx, 64, sz), B.air);
  assert.equal(state.world.edits.size, 0, 'breaking back to generated air removes the edit');
  assert.equal(itemsOf(state, B.cobblestone), 1);
  assert.equal(player.inv[0]?.d, 1);
  assert.equal(player.stats.mined, 1);
  // Iron ore with a wooden pickaxe breaks but drops nothing; a stone pickaxe drops the ore.
  for (const [tool, expected] of [[I.wooden_pickaxe, 0], [I.stone_pickaxe, 1]] as const) {
    writeCell(state, sx, 64, sz, B.iron_ore);
    player.inv[0] = { id: tool, n: 1 };
    state.items = [];
    run(state, { p0: hold(player, { mine }) }, 100);
    send(state, [{ t: 'break', x: sx, y: 64, z: sz }], { mine });
    assert.equal(state.get(sx, 64, sz), B.air);
    assert.equal(itemsOf(state, B.iron_ore), expected);
  }
  // Bedrock never breaks.
  send(state, [{ t: 'break', x: Math.floor(player.x), y: 0, z: Math.floor(player.z) }]);
  assert.equal(state.get(player.x, 0, player.z), B.bedrock);
});

test('creative breaks are instant but rate limited, and never drop items', () => {
  const state = game(1, { mode: 'creative' });
  const breaks: CmdBody[] = Array.from({ length: 8 }, (_, i) => ({ t: 'break', x: X + 1 + (i % 2), y: GROUND - Math.floor(i / 2), z: Z }));
  send(state, breaks);
  const broken = breaks.filter(b => b.t === 'break' && state.get(b.x, b.y, b.z) === B.air).length;
  assert.ok(broken >= 3 && broken <= 5, `broke ${broken}`);
  assert.equal(state.items.length, 0);
});

test('placement orients logs, doors and beds and respects supports', () => {
  const state = game(), player = p(state);
  writeCell(state, X + 1, 64, Z, B.stone);
  player.inv[0] = { id: B.oak_log, n: 4 };
  player.inv[1] = { id: I.oak_door, n: 2 };
  player.inv[2] = { id: I.bed, n: 1 };
  player.inv[3] = { id: B.torch, n: 4 };
  player.inv[4] = { id: I.wheat_seeds, n: 4 };
  send(state, [
    { t: 'place', x: X + 1, y: 64, z: Z, face: 1, slot: 0 },
    { t: 'place', x: X + 1, y: GROUND, z: Z + 2, face: 3, slot: 1 },
    { t: 'place', x: X + 3, y: GROUND, z: Z + 2, face: 3, slot: 2 },
    { t: 'place', x: X + 1, y: 64, z: Z, face: 4, slot: 3 },
    { t: 'place', x: X - 1, y: GROUND, z: Z, face: 3, slot: 4 },
  ]);
  assert.equal(state.get(X + 2, 64, Z), makeCell(B.oak_log, 1), 'log placed on an east face lies along X');
  assert.equal(cellId(state.get(X + 1, 64, Z + 2)), B.oak_door);
  assert.equal(cellState(state.get(X + 1, 65, Z + 2)) & DOOR_UPPER, DOOR_UPPER);
  assert.equal(cellId(state.get(X + 3, 64, Z + 2)), B.bed);
  assert.equal(cellId(state.get(X + 3, 64, Z + 1)), B.bed, 'bed head extends the way the player looks (north)');
  assert.equal(state.get(X + 1, 64, Z - 1), makeCell(B.torch, 1), 'wall torch on the north face points north');
  assert.equal(state.get(X - 1, 64, Z), B.air, 'seeds need farmland');
  assert.equal(count(player.inv, I.wheat_seeds), 4);
  // Removing the stone pops the wall torch off (support cascade).
  breakBlock(state, X + 1, 64, Z);
  assert.equal(state.get(X + 1, 64, Z - 1), B.air);
  assert.equal(itemsOf(state, B.torch), 1);
  // Doors toggle both halves; breaking one half removes both.
  send(state, [{ t: 'use', x: X + 1, y: 65, z: Z + 2, face: 5 }]);
  assert.equal(cellState(state.get(X + 1, 64, Z + 2)) & DOOR_OPEN, DOOR_OPEN);
  assert.equal(cellState(state.get(X + 1, 65, Z + 2)) & DOOR_OPEN, DOOR_OPEN);
  breakBlock(state, X + 1, 64, Z + 2);
  assert.equal(state.get(X + 1, 65, Z + 2), B.air);
});

test('crafting table, furnace smelting over time and shared chests', () => {
  const state = game(2), player = p(state), other = p(state, 1);
  player.inv[0] = { id: B.crafting_table, n: 1 };
  player.inv[1] = { id: B.furnace, n: 1 };
  player.inv[2] = { id: B.chest, n: 1 };
  send(state, [
    { t: 'place', x: X - 1, y: GROUND, z: Z, face: 3, slot: 0 },
    { t: 'place', x: X - 1, y: GROUND, z: Z - 1, face: 3, slot: 1 },
    { t: 'place', x: X - 1, y: GROUND, z: Z + 1, face: 3, slot: 2 },
  ]);
  // A pickaxe through the 3×3 grid.
  player.inv[3] = { id: B.oak_planks, n: 3 };
  player.inv[4] = { id: I.stick, n: 2 };
  send(state, [
    { t: 'use', x: X - 1, y: 64, z: Z, face: 3 },
    { t: 'click', w: 'inv', i: 3, b: 0 }, { t: 'click', w: 'grid', i: 0, b: 1 }, { t: 'click', w: 'grid', i: 1, b: 1 }, { t: 'click', w: 'grid', i: 2, b: 1 },
    { t: 'click', w: 'inv', i: 4, b: 0 }, { t: 'click', w: 'grid', i: 4, b: 1 }, { t: 'click', w: 'grid', i: 7, b: 1 },
  ]);
  assert.equal(player.screen?.kind, 'table');
  assert.deepEqual(player.out, { id: I.wooden_pickaxe, n: 1 });
  send(state, [{ t: 'click', w: 'out', i: 0, b: 2 }]);
  assert.equal(count(player.inv, I.wooden_pickaxe), 1);
  assert.ok(player.grid.every(slot => !slot));
  assert.equal(player.stats.crafted, 1);
  assert.match(player.toast?.text ?? '', /pickaxe/i);

  // Furnace: shift-click ore to the input and coal to the fuel slot; two ingots after 20 s.
  player.inv[5] = { id: B.iron_ore, n: 2 };
  player.inv[6] = { id: I.coal, n: 1 };
  send(state, [{ t: 'use', x: X - 1, y: 64, z: Z - 1, face: 3 }, { t: 'click', w: 'inv', i: 5, b: 2 }, { t: 'click', w: 'inv', i: 6, b: 2 }]);
  assert.equal(player.screen?.kind, 'furnace');
  run(state, {}, 20);
  assert.equal(cellId(state.get(X - 1, 64, Z - 1)), B.furnace_lit);
  assert.equal(playerView(state, 'p0').screen?.cookMax, 10);
  run(state, {}, 400);
  const furnace = state.furnaces.get(cellIndex(X - 1, 64, Z - 1))!;
  assert.deepEqual(furnace.slots[2], { id: I.iron_ingot, n: 2 });
  assert.equal(furnace.slots[0], null);
  send(state, [{ t: 'click', w: 'screen', i: 2, b: 2 }]);
  assert.equal(count(player.inv, I.iron_ingot), 2);

  // Chest contents are shared between players and spill when the chest breaks.
  player.inv[7] = { id: B.dirt, n: 10 };
  send(state, [{ t: 'use', x: X - 1, y: 64, z: Z + 1, face: 3 }, { t: 'click', w: 'inv', i: 7, b: 2 }]);
  send(state, [{ t: 'use', x: X - 1, y: 64, z: Z + 1, face: 3 }], {}, 1);
  assert.equal(other.screen?.kind, 'chest');
  assert.deepEqual(playerView(state, 'p1').screen?.slots[0], { id: B.dirt, n: 10 });
  breakBlock(state, X - 1, 64, Z + 1);
  run(state);
  assert.equal(other.screen, null);
  assert.equal(itemsOf(state, B.dirt), 10);
  assert.equal(state.chests.size, 0);
});

test('hoes till, seeds plant, bone meal grows, buckets move water', () => {
  const state = game(), player = p(state);
  player.inv[0] = { id: I.wooden_hoe, n: 1 };
  player.inv[1] = { id: I.wheat_seeds, n: 3 };
  player.inv[2] = { id: I.bone_meal, n: 3 };
  player.inv[3] = { id: I.bucket, n: 1 };
  send(state, [{ t: 'use', x: X + 2, y: GROUND, z: Z, face: 3 }], { slot: 0 });
  assert.equal(cellId(state.get(X + 2, GROUND, Z)), B.farmland);
  send(state, [{ t: 'place', x: X + 2, y: GROUND, z: Z, face: 3, slot: 1 }], { slot: 1 });
  assert.equal(cellId(state.get(X + 2, 64, Z)), B.wheat);
  send(state, [{ t: 'use', x: X + 2, y: 64, z: Z, face: 3 }], { slot: 2 });
  assert.ok(cellState(state.get(X + 2, 64, Z)) >= 2);
  assert.equal(count(player.inv, I.bone_meal), 2);
  writeCell(state, X + 1, 64, Z + 2, B.water);
  send(state, [{ t: 'use', x: X + 1, y: GROUND, z: Z + 2, face: 3 }], { slot: 3 });
  assert.equal(state.get(X + 1, 64, Z + 2), B.air);
  assert.deepEqual(player.inv[3], { id: I.water_bucket, n: 1 });
  send(state, [{ t: 'use', x: X + 1, y: GROUND, z: Z - 2, face: 3 }], { slot: 3 });
  assert.equal(state.get(X + 1, 64, Z - 2), B.water);
  assert.deepEqual(player.inv[3], { id: I.bucket, n: 1 });
});

test('eating needs a real hold; food restores hunger and saturation', () => {
  const state = game(), player = p(state);
  player.food = 10;
  player.inv[0] = { id: I.bread, n: 2 };
  send(state, [{ t: 'useItem', slot: 0 }]);
  assert.equal(player.food, 10, 'instant eat rejected');
  run(state, { p0: hold(player, { f: IF.ON_GROUND | IF.USING }) }, 32);
  send(state, [{ t: 'useItem', slot: 0 }], { f: IF.ON_GROUND | IF.USING });
  assert.equal(player.food, 15);
  assert.equal(count(player.inv, I.bread), 1);
});

test('sleeping skips the night once every connected player is in bed', () => {
  const state = game(2), [a, b] = state.players as [Player, Player];
  state.time = 14000;
  a.inv[0] = { id: I.bed, n: 1 };
  send(state, [{ t: 'place', x: X - 2, y: GROUND, z: Z + 2, face: 3, slot: 0 }]);
  send(state, [{ t: 'use', x: X - 2, y: 64, z: Z + 2, face: 3 }]);
  assert.ok(a.sleeping);
  assert.deepEqual(a.bed, [X - 2, 64, Z + 2]);
  assert.equal(publicView(state).sleeping, 1);
  run(state, {}, 60);
  assert.ok(state.time > 14000, 'one player awake: the night goes on');
  setPresence(state, b.id, false);
  run(state, {}, 2);
  assert.ok(state.time < 100);
  assert.equal(state.day, 1);
  assert.equal(a.sleeping, false);
  assert.equal(state.stats.days, 1);
});

test('death drops the inventory unless keepInventory; respawn restores the player', () => {
  for (const keepInventory of [true, false]) {
    const state = game(1, { keepInventory }), player = p(state);
    player.inv[0] = { id: B.dirt, n: 12 };
    player.inv[1] = { id: I.stone_sword, n: 1, d: 5 };
    Object.assign(player, { x: X + 6.5, y: 64, z: Z + 6.5 });
    damagePlayer(state, player, 50, 'fell out of the world');
    assert.ok(player.dead);
    assert.equal(player.deathMessage, 'Player 0 fell out of the world');
    assert.equal(count(player.inv, B.dirt), keepInventory ? 12 : 0);
    assert.equal(itemsOf(state, B.dirt), keepInventory ? 0 : 12);
    const view = playerView(state, 'p0');
    assert.equal(view.dead, true);
    assert.equal(publicView(state).players[0]!.flags & PF.DEAD, PF.DEAD);
    // Only respawn (and close) run while dead.
    send(state, [{ t: 'drop', slot: 0 }, { t: 'respawn' }], { f: IF.NO_POS });
    assert.equal(player.dead, false);
    assert.equal(player.health, 20);
    assert.equal(player.tp.n, 2);
    assert.ok(Math.abs(player.x - state.spawn[0]) <= 3 && Math.abs(player.z - state.spawn[2]) <= 3);
    assert.equal(itemsOf(state, B.dirt), keepInventory ? 0 : 12, 'the drop command did not run while dead');
  }
});

test('hostile mobs spawn at night in the dark, never by day or in torchlight', () => {
  const spawnFor = (time: number, torches: boolean) => {
    const state = game();
    state.time = time;
    if (torches) for (let dx = -60; dx <= 60; dx += 10) for (let dz = -60; dz <= 60; dz += 10) writeCell(state, X + dx, 64, Z + dz, B.torch);
    for (let i = 0; i < 400; i++) {
      state.time = time;
      run(state);
    }
    return state.mobs.filter(mob => mob.t <= MOB.creeper).length;
  };
  assert.equal(spawnFor(6000, false), 0);
  assert.ok(spawnFor(16000, false) >= 5);
  assert.equal(spawnFor(16000, true), 0);
  assert.equal(spawnFor(16000, false) <= 5, true, 'solo cap on the first day is 5');
});

test('a creeper hisses, explodes, carves the terrain and knocks the player back', () => {
  const state = game(), player = p(state);
  state.time = 16000;
  const creeper = newMob(state, MOB.creeper, player.x + 2.2, 64, player.z);
  state.mobs.push(creeper);
  const edits = state.world.edits.size;
  for (let i = 0; i < 80 && state.mobs.includes(creeper); i++) run(state);
  assert.ok(!state.mobs.includes(creeper), 'creeper exploded');
  assert.ok(state.world.edits.size > edits + 10, 'blocks destroyed through edits');
  assert.ok(state.fx.some(entry => entry.fx.k === 'explode'));
  assert.ok(player.health < 20 && player.health > 0);
  assert.ok(player.imp.n >= 1);
  // Bedrock survives any blast.
  explode(state, X + 20.5, 1.5, Z + 20.5, 3, 'blew up');
  assert.equal(state.get(X + 20, 0, Z + 20), B.bedrock);
});

test('a TNT chain\'s rubble never pushes chest loot out of the item cap', () => {
  const state = game(1, { mode: 'creative' }), y = GROUND - 3;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) writeCell(state, X + dx, y, Z + dz, B.tnt);
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
    writeCell(state, X + dx, y, Z + dz, B.chest);
    state.chests.set(cellIndex(X + dx, y, Z + dz), Array.from({ length: 27 }, (_, i) => i < 5 ? { id: I.diamond, n: 3 } : null));
  }
  primeTnt(state, X, y, Z);
  run(state, {}, 200);
  assert.equal(itemsOf(state, I.diamond), 60, 'every diamond from the blasted chests survives');
  assert.ok(state.items.length <= 128);
});

test('skeletons shoot arcing arrows and zombies melee', () => {
  const state = game(), player = p(state);
  state.time = 16000;
  state.mobs.push(newMob(state, MOB.skeleton, player.x + 9, 64, player.z));
  let shot = false;
  for (let i = 0; i < 80; i++) {
    run(state);
    shot ||= state.arrows.length > 0;
  }
  assert.ok(shot, 'arrow fired');
  assert.ok(player.hurt > 0, 'player hit');
  const zombieWorld = game(), target = p(zombieWorld);
  zombieWorld.time = 16000;
  zombieWorld.mobs.push(newMob(zombieWorld, MOB.zombie, target.x + 4, 64, target.z));
  run(zombieWorld, {}, 60);
  assert.ok(target.health < 20);
});

test('ground mobs jump up a one-block ledge to reach a player', () => {
  // East of x = 8 in every chunk the ground is one block higher (grass at 64), so the player stands on a ledge.
  const LEDGE = FLAT.slice();
  for (let z = 0; z < 16; z++) for (let x = 8; x < 16; x++) LEDGE[localIndex(x, 64, z)] = B.grass_block;
  const state = game(1, {}, () => LEDGE), target = p(state);
  Object.assign(target, { x: X + 9.5, y: 65, z: Z + 0.5 });
  state.time = 16000;
  const zombie = newMob(state, MOB.zombie, X + 5.5, 64, Z + 0.5);
  state.mobs.push(zombie);
  run(state, { p0: hold(target) }, 200);
  assert.ok(zombie.y >= 65, `zombie climbed (y ${zombie.y.toFixed(2)})`);
  assert.ok(target.health < 20, 'zombie reached and hit the player');
});

test('no monster spawns in a desert temple\'s dark treasure chamber (it would set off the trap unseen)', () => {
  const temple = structuresNear(11, 2345, 2184, 0).find(s => s.kind === 'desert_temple')!, [cx, cy, cz] = temple.center, floor = cy - 14;
  const ctx = { roomId: 'room', roundId: 'round', seed: 1, nowMs: 0, players: [{ id: 'p0', name: 'Ada', color: '#ff5748' }] };
  const state = createState(ctx, validateSettings({ seed: 11 }), { spawn: [cx, cy, cz] }), player = p(state);
  Object.assign(player, { x: cx + 2.5, y: floor, z: cz + 30.5, protectedUntil: 0 });
  Object.assign(state, { time: 16000, day: 1 });
  const idle = { p0: { ...neutralInput() } };
  while (state.ticks % 20 !== 2) run(state, idle);
  // Script the next spawn attempt: 30 blocks north of the player, at their height, on the chamber floor beside the plate.
  const rolls = [0.75, 0.25, 0.9, 0.48, 0.1], rand = state.rand;
  state.rand = () => rolls.shift() ?? rand();
  run(state, idle);
  assert.equal(rolls.length, 0, 'the scripted attempt ran');
  assert.ok(!state.mobs.some(mob => mob.t === MOB.zombie), 'nothing spawned in the chamber');
});

test('animals can be sheared, fed and bred', () => {
  const state = game(), player = p(state);
  const sheep = newMob(state, MOB.sheep, player.x + 1.5, 64, player.z);
  const cowA = newMob(state, MOB.cow, player.x - 1.5, 64, player.z + 1), cowB = newMob(state, MOB.cow, player.x - 2.5, 64, player.z + 1);
  state.mobs.push(sheep, cowA, cowB);
  player.inv[0] = { id: I.shears, n: 1 };
  player.inv[1] = { id: I.wheat, n: 2 };
  send(state, [{ t: 'interact', id: sheep.id }], { slot: 0 });
  assert.ok(sheep.sheared);
  assert.ok(itemsOf(state, B.white_wool) >= 1);
  send(state, [{ t: 'interact', id: cowA.id }, { t: 'interact', id: cowB.id }], { slot: 1 });
  assert.equal(count(player.inv, I.wheat), 0);
  run(state, {}, 60);
  const babies = state.mobs.filter(mob => mob.t === MOB.cow && mob.baby > 0);
  assert.equal(babies.length, 1);
});

test('idle mobs stay still, far hostiles despawn even in evicted chunks, and herds wait out the animal cap', () => {
  const state = game(), far = X + 200;
  // Overlapping cows beyond the 80-block simulation range are not pushed apart (nothing would damp the push).
  const herd = Array.from({ length: 4 }, () => newMob(state, MOB.cow, far, 64, Z));
  const zombie = newMob(state, MOB.zombie, far, 64, Z + 8);
  state.mobs.push(...herd, zombie);
  assert.ok(!state.world.cache.has(far >> 4, Z >> 4));
  run(state, {}, 60);
  assert.ok(herd.every(cow => state.mobs.includes(cow) && cow.vx === 0 && cow.vz === 0));
  assert.ok(!state.mobs.includes(zombie), 'a hostile 200 blocks away despawns although its chunk is not loaded');
  // At the cap, chunks that would hold a herd stay unrolled and fill once there is room again.
  state.mobs = Array.from({ length: MAX_ANIMALS }, () => newMob(state, MOB.cow, X, 64, Z));
  const chunks = Array.from({ length: 100 }, (_, i) => [140 + i % 10, 140 + Math.floor(i / 10)] as const);
  for (const [cx, cz] of chunks) { state.world.cache.get(cx, cz); populateChunk(state, cx, cz); }
  const waiting = chunks.filter(([cx, cz]) => !state.animalChunks.has(chunkKey(cx, cz)));
  assert.ok(waiting.length > 0 && waiting.length < chunks.length, `${waiting.length} herd chunks waiting`);
  state.mobs = [];
  for (const [cx, cz] of waiting) populateChunk(state, cx, cz);
  assert.ok(state.mobs.length > 0 && waiting.every(([cx, cz]) => state.animalChunks.has(chunkKey(cx, cz))));
});

test('disconnected players freeze, cannot be hurt and are flagged offline', () => {
  const state = game(2), player = p(state, 1);
  setPresence(state, player.id, false);
  const x = player.x;
  run(state, { p1: hold(player, { p: [player.x + 0.2, player.y, player.z] }) });
  assert.equal(player.x, x);
  assert.equal(damagePlayer(state, player, 5, 'was hurt'), false);
  assert.equal(publicView(state).players[1]!.flags & PF.OFFLINE, PF.OFFLINE);
  setPresence(state, player.id, true);
  run(state, { p1: hold(player, { p: [player.x + 0.2, player.y, player.z] }) });
  assert.ok(player.x > x);
});

test('views pass the live JSON contract after a busy session', () => {
  const state = game(3);
  state.time = 16000;
  const [a, b] = state.players as [Player, Player];
  a.inv[0] = { id: B.furnace, n: 1 };
  a.inv[1] = { id: I.iron_sword, n: 1, d: 3 };
  send(state, [{ t: 'place', x: X - 1, y: GROUND, z: Z, face: 3, slot: 0 }, { t: 'use', x: X - 1, y: 64, z: Z, face: 3 }, { t: 'drop', slot: 1 }]);
  const lamb = newMob(state, MOB.sheep, X + 5, 64, Z + 5, true);
  lamb.sheared = true;
  state.mobs.push(lamb, newMob(state, MOB.skeleton, X + 8, 64, Z));
  damagePlayer(state, b, 40, 'was squashed');
  run(state, { p0: hold(a, { mine: [X, GROUND, Z] }) }, 40);
  lamb.sheared = true; // grazing may have regrown its wool
  const pub = publicView(state);
  assertSerializable(pub);
  for (const player of state.players) assertSerializable(playerView(state, player.id));
  assertSerializable(rules.outcome(state));
  assert.ok(pub.fx.length > 0 && pub.mobs.some(mob => mob.s === 3));
  assert.ok(pub.players[0]!.mine, 'crack progress is public');
  assert.equal(playerView(state, 'p1').deathMessage, 'Player 1 was squashed');
  assert.equal('deathMessage' in playerView(state, 'p0'), false);
  rules.finish!(state, 0);
  const outcome = rules.outcome(state);
  assert.equal(outcome.complete, true);
  assert.deepEqual(outcome.winners, ['p0', 'p1', 'p2']);
});

test('10 players and 50 mobs tick well inside the 5 ms budget', () => {
  const seed = 260923, state = game(10, { seed }, (cx, cz) => generateChunk(seed, cx, cz));
  state.time = 16000;
  const players = state.players;
  players.forEach((player, i) => {
    const angle = i / players.length * Math.PI * 2;
    Object.assign(player, { x: state.spawn[0] + Math.cos(angle) * 20, z: state.spawn[2] + Math.sin(angle) * 20 });
    const y = standYAt(state, player.x, player.z);
    Object.assign(player, { y, fallPeak: y, tp: { n: 1, x: player.x, y, z: player.z } });
  });
  run(state, {}, 120);
  state.mobs = state.mobs.filter(mob => mob.t > MOB.creeper);
  for (let i = 0; state.mobs.filter(mob => mob.t <= MOB.creeper).length < 50; i++) {
    const player = players[i % players.length]!, angle = i * 2.4, d = 5 + (i % 9);
    const x = player.x + Math.cos(angle) * d, z = player.z + Math.sin(angle) * d;
    state.mobs.push(newMob(state, i % 4, x, standYAt(state, x, z), z));
  }
  const inputs = () => Object.fromEntries(players.map((player, i) => {
    const angle = state.clock + i;
    return [player.id, hold(player, { p: [player.x + Math.cos(angle) * 0.2, player.y, player.z + Math.sin(angle) * 0.2] })];
  }));
  run(state, inputs(), 20);
  const times: number[] = [];
  for (let i = 0; i < 200; i++) {
    for (const player of players) Object.assign(player, { health: 20, dead: false });
    const input = new Map(Object.entries(inputs()));
    const start = performance.now();
    tickState(state, input, 0.05);
    times.push(performance.now() - start);
  }
  times.sort((x, y) => x - y);
  const mean = times.reduce((sum, t) => sum + t, 0) / times.length, p95 = times[Math.floor(times.length * 0.95)]!;
  console.log(`tick: mean ${mean.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, mobs ${state.mobs.length}, chunks ${state.world.cache.size}`);
  assert.ok(mean < 5, `mean tick ${mean.toFixed(2)} ms`);
});
function standYAt(state: State, x: number, z: number) {
  for (let y = 126; y > 0; y--) if (state.get(x, y, z) !== B.air && cellId(state.get(x, y, z)) !== B.water && state.get(x, y + 1, z) === B.air) return y + 1;
  return 90;
}

test('players spawn on the ground under a canopy, not on top of the leaves', () => {
  const canopy = FLAT.slice();
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) canopy[localIndex(x, 66, z)] = canopy[localIndex(x, 67, z)] = B.oak_leaves;
  const state = game(3, {}, () => canopy);
  assert.deepEqual(state.players.map(player => player.y), [GROUND + 1, GROUND + 1, GROUND + 1]);
});

test('spawn and respawn protection: no damage, ignored by monsters, reported in the private view', () => {
  const state = game(), player = p(state);
  player.protectedUntil = 5;
  assert.equal(playerView(state, 'p0').protectedTicks, 100);
  assert.equal(damagePlayer(state, player, 5, 'was hurt'), false);
  state.time = 16000;
  const zombie = newMob(state, MOB.zombie, player.x + 3, 64, player.z);
  state.mobs.push(zombie);
  run(state, {}, 60);
  assert.equal(player.health, 20, 'the zombie ignores a protected player');
  assert.equal(zombie.target, null);
  run(state, {}, 100);
  assert.equal('protectedTicks' in playerView(state, 'p0'), false, 'omitted once protection ends');
  assert.ok(player.health < 20, 'then monsters attack');
  damagePlayer(state, player, 50, 'fell');
  const camper = newMob(state, MOB.skeleton, state.spawn[0] + 6, 64, state.spawn[2]), far = newMob(state, MOB.zombie, state.spawn[0] + 30, 64, state.spawn[2]);
  state.mobs.push(camper, far);
  send(state, [{ t: 'respawn' }], { f: IF.NO_POS });
  assert.ok(playerView(state, 'p0').protectedTicks! > 90, 'respawning protects again');
  assert.ok(!state.mobs.includes(camper) && state.mobs.includes(far), 'monsters camping the respawn point despawn');
  assert.equal(damagePlayer(state, player, 5, 'was hurt'), false);
});

test('spawn protection holds while the client is still loading (no position), then runs out', () => {
  const state = game(), player = p(state);
  player.protectedUntil = state.clock + 5;
  run(state, { p0: { ...neutralInput() } }, 200);
  assert.ok(playerView(state, 'p0').protectedTicks! > 90, 'ten seconds of loading keep the player protected');
  run(state, {}, 120);
  assert.equal('protectedTicks' in playerView(state, 'p0'), false, 'without loading input it lapses');
});

test('hostile caps scale with players and difficulty; easy halves monster damage', () => {
  const cap = (players: number, day: number, difficulty: Settings['difficulty'] = 'normal') => {
    const state = game(players, { difficulty });
    state.day = day;
    return hostileCap(state);
  };
  assert.deepEqual([cap(1, 0), cap(1, 1), cap(2, 1), cap(10, 1)], [5, 8, 14, 50]);
  assert.deepEqual([cap(1, 1, 'easy'), cap(2, 1, 'easy')], [4, 7]);
  const easy = game(1, { difficulty: 'easy' }), normal = game();
  assert.deepEqual([hostileDamage(easy, 3), hostileDamage(easy, 2), hostileDamage(normal, 3)], [1, 1, 3]);
  for (const world of [easy, normal]) {
    world.time = 16000;
    world.mobs.push(newMob(world, MOB.zombie, p(world).x + 1.2, 64, p(world).z));
    for (let i = 0; i < 40 && p(world).health === 20; i++) run(world);
  }
  assert.equal(p(easy).health, 19);
  assert.equal(p(normal).health, 17);
});

test('monsters keep 24 blocks from players, 32 from the first-day spawn, and never appear in view by day', () => {
  const nights = (day: number) => {
    const state = game();
    state.day = day;
    const spawns: [number, number][] = [];
    for (let i = 0; i < 600; i++) {
      state.time = 16000;
      const before = new Set(state.mobs);
      run(state);
      for (const mob of state.mobs) if (!before.has(mob) && mob.t <= MOB.creeper) spawns.push([mob.x - state.spawn[0], mob.z - state.spawn[2]]);
      state.mobs = state.mobs.filter(mob => mob.t > MOB.creeper);
    }
    return spawns;
  };
  const first = nights(0), later = nights(1);
  const near = (spawns: [number, number][], r: number) => spawns.filter(([dx, dz]) => dx * dx + dz * dz < r * r).length;
  assert.ok(first.length > 5 && near(first, 32) === 0, 'the first night keeps 32 blocks around the world spawn clear');
  assert.ok(near(later, 32) > 0 && near(later, 24) === 0, 'later nights only keep the 24-block player gap');
  // By day, a dark roofed area spawns monsters only once walls hide it from the player.
  const byDay = (walls: boolean) => {
    const state = game();
    state.day = 1;
    for (let x = X + 20; x <= X + 60; x++) for (let z = Z - 20; z <= Z + 20; z++) {
      const edge = x === X + 20 || x === X + 60 || z === Z - 20 || z === Z + 20;
      writeCell(state, x, 66, z, B.stone);
      if (walls && edge) { writeCell(state, x, 64, z, B.stone); writeCell(state, x, 65, z, B.stone); }
    }
    let spawned = 0;
    for (let i = 0; i < 800; i++) {
      state.time = 6000;
      run(state);
      spawned += state.mobs.filter(mob => mob.t <= MOB.creeper).length;
      state.mobs = state.mobs.filter(mob => mob.t > MOB.creeper);
    }
    return spawned;
  };
  assert.equal(byDay(false), 0, 'open-sided shelter: the player would watch them appear');
  assert.ok(byDay(true) > 0, 'walled-in darkness spawns by day');
});

test('dusk and nightfall toasts, a wake command, keepInventory and seeds in the views', () => {
  const state = game(2), [a, b] = state.players as [Player, Player];
  state.time = 11499.5;
  run(state, {}, 1);
  assert.match(playerView(state, 'p0').toast!.text, /sun is setting/);
  state.time = 12999.5;
  run(state, {}, 1);
  assert.equal(playerView(state, 'p1').toast!.text, 'Night falls. Monsters roam in the dark.');
  const peaceful = game(1, { difficulty: 'peaceful' });
  peaceful.time = 12999.5;
  run(peaceful, {}, 1);
  assert.equal(p(peaceful).toast, null, 'no monster warning in peaceful');
  state.time = 14000;
  a.inv[0] = { id: I.bed, n: 1 };
  send(state, [{ t: 'place', x: X - 2, y: GROUND, z: Z + 2, face: 3, slot: 0 }, { t: 'use', x: X - 2, y: 64, z: Z + 2, face: 3 }]);
  assert.ok(a.sleeping);
  assert.match(a.toast!.text, /1\/2 in bed/);
  send(state, [{ t: 'wake' }]);
  assert.equal(a.sleeping, false);
  assert.ok(Math.hypot(a.x - (X - 1.5), a.z - (Z + 2.5)) < 3.5, 'stands beside the bed');
  assert.equal(b.sleeping, false);
  assert.equal(playerView(state, 'p0').keepInventory, true);
  assert.equal(playerView(game(1, { keepInventory: false }), 'p0').keepInventory, false);
  const view = publicView(state);
  assert.equal(view.seed, 8, 'seed 0 picks the real seed from the round seed');
  assert.equal(view.worldId, '8-0');
  assert.equal(publicView(game(1, { seed: 4242 })).seed, 4242);
});

test('worldgen sugar cane, crops and saplings grow near players', () => {
  const shore = (() => {
    const chunk = new Uint16Array(CHUNK_CELLS);
    for (let y = 0; y <= SEA_LEVEL; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < SEA_LEVEL ? B.dirt : B.grass_block;
    chunk[localIndex(4, SEA_LEVEL, 4)] = B.water;
    chunk[localIndex(5, SEA_LEVEL, 4)] = B.sand;
    chunk[localIndex(5, SEA_LEVEL + 1, 4)] = B.sugar_cane;
    return chunk;
  })();
  const state = game(1, {}, () => shore), cane = [X + 5, SEA_LEVEL + 1, Z + 4] as const;
  assert.ok(state.growables.has(cellIndex(...cane)), 'generated cane is registered');
  writeCell(state, X + 8, SEA_LEVEL, Z + 10, B.farmland);
  writeCell(state, X + 8, SEA_LEVEL + 1, Z + 10, makeCell(B.wheat, 0));
  writeCell(state, X + 12, SEA_LEVEL + 1, Z + 12, B.oak_sapling);
  state.rand = () => 0.001;
  for (let i = 0; i < 6; i++) {
    state.time = 6000;
    run(state, {}, 20);
  }
  assert.equal(cellId(state.get(cane[0], cane[1] + 2, cane[2])), B.sugar_cane, 'cane grows to three tall');
  assert.notEqual(cellId(state.get(cane[0], cane[1] + 3, cane[2])), B.sugar_cane);
  assert.ok(cellState(state.get(X + 8, SEA_LEVEL + 1, Z + 10)) >= 5, 'wheat ripens');
  assert.notEqual(cellId(state.get(X + 12, SEA_LEVEL + 1, Z + 12)), B.oak_sapling, 'the sapling became a tree');
});

test('mob paths respect door panels: closed doors block, open doors let them through', () => {
  // A wall along z = 5 with a doorway at x = 5, facing south (state 2): closed, the panel hugs the north side.
  const door = (open: boolean) => (x: number, y: number, z: number) => {
    if (y < 1) return B.stone;
    if (z === 5 && y <= 3) return x === 5 && y <= 2 ? makeCell(B.oak_door, 2 | (open ? DOOR_OPEN : 0) | (y === 2 ? DOOR_UPPER : 0)) : B.stone;
    return x < 0 || x > 10 || z < 0 || z > 10 ? B.stone : B.air;
  };
  const route = (open: boolean) => findPath(door(open), [5, 1, 2], [5, 1, 8], { height: 2, maxNodes: 500, range: 24 });
  assert.equal(route(false).reached, false);
  const opened = route(true);
  assert.ok(opened.reached && opened.path.some(([x, , z]) => x === 5 && z === 5), 'walks through the doorway');
});
