import assert from 'node:assert/strict';
import { test } from 'node:test';
import { B, cellId, cellState, DOOR_OPEN, makeCell, PISTON_EXTENDED, PLATE_PRESSED, repeaterDelay, REPEATER_POWERED, wirePower } from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource } from '../src/shared/chunk';
import { chunkKey, localIndex } from '../src/shared/coords';
import { I } from '../src/shared/items';
import { IF, MOB, validateSettings, type CmdBody, type Input } from '../src/shared/protocol';
import { conducts, WIRE_UP, wirePoints, wireShape, wireTint } from '../src/shared/redstone';
import { spawnItem } from '../src/sim/entities';
import { createState, saveSource, tickState } from '../src/sim/game';
import { newMob } from '../src/sim/mobs';
import { primeTnt, tickRedstone, useRedstoneBlock } from '../src/sim/redstone';
import { exportSave, parseSave } from '../src/sim/save';
import type { State } from '../src/sim/state';
import { breakBlock, writeCell } from '../src/sim/world';

// A flat creative test world ------------------------------------------------------------------------------------------

/** Bedrock at 0, stone to 62, grass at 63: builds stand on y = 64. */
const FLAT = (() => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < 63 ? B.stone : B.grass_block;
  return chunk;
})();
const flat: ChunkSource = () => FLAT;
/** Every position below is relative to (X, Y, Z): the player stands there, builds sit on the grass at dy = 0. */
const X = 2048, Y = 64, Z = 2048;
const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: [{ id: 'p0', name: 'Ada', color: '#ff5748' }] };

/** Creative (explosions don't hurt the player) and no herds (nothing wanders onto plates). */
function game(): State {
  const state = createState(ctx, { ...validateSettings({}), mode: 'creative' }, { source: flat, spawn: [X, Y, Z] });
  for (let cx = 120; cx < 136; cx++) for (let cz = 120; cz < 136; cz++) state.animalChunks.add(chunkKey(cx, cz));
  return state;
}
const at = (state: State, dx: number, dy: number, dz: number) => state.get(X + dx, Y + dy, Z + dz);
const id = (state: State, dx: number, dy: number, dz: number) => cellId(at(state, dx, dy, dz));
const bits = (state: State, dx: number, dy: number, dz: number) => cellState(at(state, dx, dy, dz));
const power = (state: State, dx: number, dy: number, dz: number) => wirePower(bits(state, dx, dy, dz));
const lit = (state: State, dx: number, dy: number, dz: number) => id(state, dx, dy, dz) === B.redstone_lamp_lit;
function put(state: State, dx: number, dy: number, dz: number, block: number, s = 0) {
  assert.ok(writeCell(state, X + dx, Y + dy, Z + dz, makeCell(block, s)));
}
/** A straight east-running line of dust on the ground. */
function dust(state: State, x0: number, x1: number, dz: number, dy = 0) {
  for (let dx = x0; dx <= x1; dx++) put(state, dx, dy, dz, B.redstone_wire);
}
function tick(state: State, n = 1) {
  for (let i = 0; i < n; i++) tickState(state, new Map(), 0.05);
}
/** Ticks until `done` holds (at most `limit`), or -1. */
function ticksUntil(state: State, done: () => boolean, limit = 100) {
  for (let n = 1; n <= limit; n++) {
    tick(state);
    if (done()) return n;
  }
  return -1;
}
/** Right-click a lever, button or repeater (the hook the `use` command calls). */
const flip = (state: State, dx: number, dy: number, dz: number) => assert.ok(useRedstoneBlock(state, state.players[0]!, X + dx, Y + dy, Z + dz));
/** One tick in which the player sends real commands. */
function send(state: State, cmds: CmdBody[]) {
  const p = state.players[0]!;
  const input: Input = { p: [p.x, p.y, p.z], v: [0, 0, 0], yaw: p.yaw, pitch: p.pitch, f: IF.ON_GROUND, slot: p.slot, mine: null, tpAck: p.tp.n,
    cmds: cmds.map((c, i) => ({ n: p.ack + 1 + i, ...c }) as Input['cmds'][number]) };
  tickState(state, new Map([['p0', input]]), 0.05);
}
const tntMobs = (state: State) => state.mobs.filter(mob => mob.t === MOB.tnt);
const fxOf = (state: State, k: string) => state.fx.map(entry => entry.fx).filter(fx => fx.k === k);

// Lever, dust and lamps ------------------------------------------------------------------------------------------------

test('lever → dust → lamp: power falls by one per dust, so 15 dust light a lamp and a 16th does not', () => {
  const state = game();
  // Two rows: lever, 15 dust, lamp (z + 2) and lever, 16 dust, lamp (z + 4).
  for (const [dz, n] of [[2, 15], [4, 16]] as const) {
    put(state, 1, 0, dz, B.lever, 3);
    dust(state, 2, 1 + n, dz);
    put(state, 2 + n, 0, dz, B.redstone_lamp);
  }
  tick(state);
  // The player flips the near lever with a real `use` command; the far one goes through the same hook.
  flip(state, 1, 0, 4);
  send(state, [{ t: 'use', x: X + 1, y: Y, z: Z + 2, face: 3 }]);
  assert.deepEqual(Array.from({ length: 15 }, (_, i) => power(state, 2 + i, 0, 2)), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.ok(lit(state, 17, 0, 2), 'the 15th dust (power 1) still lights the lamp');
  assert.deepEqual([power(state, 17, 0, 4), lit(state, 18, 0, 4)], [0, false], 'the 16th dust is dead');
  assert.deepEqual(fxOf(state, 'lever').map(fx => fx.a), [1, 1]);
  assert.equal(fxOf(state, 'lamp').length, 1);
  // Off: the dust dies at once, the lamp 2 redstone ticks later.
  flip(state, 1, 0, 2);
  tick(state);
  assert.deepEqual([power(state, 2, 0, 2), power(state, 16, 0, 2), lit(state, 17, 0, 2)], [0, 0, true]);
  tick(state, 3);
  assert.ok(lit(state, 17, 0, 2));
  tick(state);
  assert.ok(!lit(state, 17, 0, 2));
  assert.equal(bits(state, 1, 0, 2), 3, 'the lever is off again (attached face kept)');
});

test('torch NOT gate and a torch-on-block inverter tower: each stage takes one redstone tick', () => {
  const state = game();
  // NOT gate: a lever on the west face of a block, a torch on its east face, a lamp beside the torch.
  put(state, 3, 0, -4, B.stone);
  put(state, 2, 0, -4, B.lever, 0);
  put(state, 4, 0, -4, B.redstone_torch, 2);
  put(state, 5, 0, -4, B.redstone_lamp);
  // Tower: block, torch, block, torch, block, torch; each torch strongly powers the block above it.
  for (let i = 0; i < 3; i++) {
    put(state, -4, 2 * i, -4, B.stone);
    put(state, -4, 2 * i + 1, -4, B.redstone_torch, 0);
  }
  put(state, -5, 0, -4, B.lever, 0);
  tick(state, 20);
  const torches = () => [id(state, 4, 0, -4), id(state, -4, 1, -4), id(state, -4, 3, -4), id(state, -4, 5, -4)].map(t => t === B.redstone_torch);
  assert.deepEqual(torches(), [true, true, false, true]);
  assert.ok(lit(state, 5, 0, -4));
  flip(state, 2, 0, -4);
  flip(state, -5, 0, -4);
  const changed: number[][] = [];
  let before = torches();
  for (let n = 1; n <= 10; n++) {
    tick(state);
    const now = torches();
    now.forEach((on, i) => { if (on !== before[i]) (changed[i] ??= []).push(n); });
    if (!lit(state, 5, 0, -4)) (changed[4] ??= []).push(n);
    before = now;
  }
  assert.deepEqual(changed.map(ticks => ticks[0]), [3, 3, 5, 7, 7], 'NOT torch and T1 after 1 rt, T2 after 2, T3 after 3; the lamp dims 2 rt after its torch');
  assert.deepEqual(torches(), [false, false, true, false]);
  assert.ok(changed.slice(0, 4).every(ticks => ticks.length === 1), 'no torch flickers');
});

test('a repeater carries a signal past 15 dust, delays it by its 1–4 redstone ticks and ignores side inputs', () => {
  const state = game();
  // Lever, 15 dust, repeater facing east, 3 dust, lamp.
  put(state, 1, 0, -8, B.lever, 3);
  dust(state, 2, 16, -8);
  put(state, 17, 0, -8, B.repeater, 1);
  dust(state, 18, 20, -8);
  put(state, 21, 0, -8, B.redstone_lamp);
  tick(state);
  for (let delay = 1; delay <= 4; delay++) {
    while (repeaterDelay(bits(state, 17, 0, -8)) !== delay) flip(state, 17, 0, -8);
    flip(state, 1, 0, -8);
    // The dust powers up on the first tick; the repeater answers exactly 2 × delay game ticks later.
    assert.equal(ticksUntil(state, () => lit(state, 21, 0, -8)), 1 + 2 * delay, `delay ${delay}`);
    assert.deepEqual([power(state, 18, 0, -8), power(state, 20, 0, -8)], [15, 13], 'the repeater restarts the line at 15');
    flip(state, 1, 0, -8);
    tick(state, 20);
    assert.ok(!lit(state, 21, 0, -8) && !(bits(state, 17, 0, -8) & REPEATER_POWERED));
  }
  // A redstone block beside the repeater is a side input: ignored.
  put(state, 17, 0, -9, B.redstone_block);
  tick(state, 12);
  assert.ok(!(bits(state, 17, 0, -8) & REPEATER_POWERED) && !lit(state, 21, 0, -8));
});

test('a 1-redstone-tick torch clock burns out after 8 toggles, rests 3 s, then runs again', () => {
  const state = game();
  // Torch on the east face of A, a block above the torch, dust on A: the torch powers the block, the block the dust,
  // the dust A, and A turns the torch off.
  put(state, -8, 0, 8, B.stone);
  put(state, -7, 1, 8, B.stone);
  put(state, -8, 1, 8, B.redstone_wire);
  put(state, -7, 0, 8, B.redstone_torch, 2);
  const toggles: number[] = [];
  let was = true;
  for (let n = 1; n <= 100; n++) {
    tick(state);
    const on = id(state, -7, 0, 8) === B.redstone_torch;
    if (on !== was) toggles.push(n);
    was = on;
  }
  const gaps = toggles.slice(1).map((t, i) => t - toggles[i]!);
  assert.deepEqual(gaps.slice(0, 8), [2, 2, 2, 2, 2, 2, 2, 2], 'toggles every redstone tick');
  assert.equal(gaps[8], 60, 'the 9th toggle (off) burns it out for 60 ticks');
  assert.ok(toggles.length > 10, 'and the clock restarts afterwards');
});

test('dust steps up and down blocks; a block above the step cuts it', () => {
  const state = game();
  // Lever, dust, a block with dust on top, dust, lamp.
  put(state, 1, 0, 12, B.lever, 3);
  put(state, 2, 0, 12, B.redstone_wire);
  put(state, 3, 0, 12, B.stone);
  put(state, 3, 1, 12, B.redstone_wire);
  put(state, 4, 0, 12, B.redstone_wire);
  put(state, 5, 0, 12, B.redstone_lamp);
  flip(state, 1, 0, 12);
  tick(state);
  assert.deepEqual([power(state, 2, 0, 12), power(state, 3, 1, 12), power(state, 4, 0, 12), lit(state, 5, 0, 12)], [15, 14, 13, true]);
  assert.equal(wireShape(state.get, X + 2, Y, Z + 12), 1 << 3 | (1 | WIRE_UP) << 1, 'joins the lever (W) and climbs east');
  // A block over the lower dust cuts the step up.
  put(state, 2, 1, 12, B.stone);
  tick(state, 5);
  assert.deepEqual([power(state, 2, 0, 12), power(state, 3, 1, 12), power(state, 4, 0, 12), lit(state, 5, 0, 12)], [15, 0, 0, false]);
  put(state, 2, 1, 12, B.air);
  tick(state);
  assert.deepEqual([power(state, 3, 1, 12), power(state, 4, 0, 12), lit(state, 5, 0, 12)], [14, 13, true]);
  // A block beside the upper dust, over the far dust, cuts the step down.
  put(state, 4, 1, 12, B.stone);
  tick(state, 5);
  assert.deepEqual([power(state, 3, 1, 12), power(state, 4, 0, 12), lit(state, 5, 0, 12)], [14, 0, false]);
});

test('strong and weak power: dust into a block lights a lamp beside it but powers no dust; a lever on a block powers both', () => {
  const state = game();
  for (const dz of [16, 18]) {
    put(state, 1, 0, dz, B.lever, 3);
    dust(state, 2, 3, dz);
    put(state, 4, 0, dz, B.stone);
    flip(state, 1, 0, dz);
  }
  put(state, 5, 0, 16, B.redstone_lamp);
  put(state, 5, 0, 18, B.redstone_wire);
  // A lever on the west face of a block strongly powers it.
  put(state, 4, 0, 20, B.stone);
  put(state, 3, 0, 20, B.lever, 0);
  put(state, 5, 0, 20, B.redstone_wire);
  put(state, 4, 0, 21, B.redstone_lamp);
  flip(state, 3, 0, 20);
  tick(state);
  assert.ok(lit(state, 5, 0, 16), 'a weakly powered block still activates the lamp beside it');
  assert.equal(power(state, 5, 0, 18), 0, 'but not dust');
  assert.deepEqual([power(state, 5, 0, 20), lit(state, 4, 0, 21)], [15, true], 'a strongly powered block powers dust and lamps');
  assert.ok(conducts(B.stone) && !conducts(B.glass) && !conducts(makeCell(B.piston, 1)));
});

// Pistons --------------------------------------------------------------------------------------------------------------

test('pistons push up to 12 blocks with their states; 13 blocks or an immovable block stop them', () => {
  const state = game();
  const row = (dz: number, blocks: number[]) => {
    put(state, 1, 0, dz, B.piston, 1);
    blocks.forEach((block, i) => put(state, 2 + i, 0, dz, block));
    put(state, 0, 0, dz, B.redstone_block);
  };
  row(-12, Array(12).fill(B.stone));
  row(-14, Array(13).fill(B.stone));
  row(-16, [B.stone, B.obsidian]);
  put(state, 1, 0, -18, B.piston, 1);
  put(state, 2, 0, -18, B.oak_stairs, 2);
  put(state, 0, 0, -18, B.redstone_block);
  tick(state);
  assert.ok(bits(state, 1, 0, -12) & PISTON_EXTENDED);
  assert.deepEqual([id(state, 2, 0, -12), bits(state, 2, 0, -12)], [B.piston_head, 1]);
  assert.deepEqual(Array.from({ length: 12 }, (_, i) => id(state, 3 + i, 0, -12)), Array(12).fill(B.stone));
  assert.ok(fxOf(state, 'piston').some(fx => fx.a === 1 + 8 * 12), 'fx: facing east, 12 blocks moved');
  assert.deepEqual([bits(state, 1, 0, -14) & PISTON_EXTENDED, id(state, 2, 0, -14), id(state, 14, 0, -14)], [0, B.stone, B.stone], '13 blocks: no move');
  assert.deepEqual([bits(state, 1, 0, -16) & PISTON_EXTENDED, id(state, 2, 0, -16)], [0, B.stone], 'obsidian: no move');
  assert.deepEqual([id(state, 3, 0, -18), bits(state, 3, 0, -18)], [B.oak_stairs, 2], 'pushed blocks keep their state');
  // Power off: a normal piston retracts and leaves the blocks where they are.
  put(state, 0, 0, -12, B.air);
  tick(state, 3);
  assert.deepEqual([bits(state, 1, 0, -12) & PISTON_EXTENDED, id(state, 2, 0, -12), id(state, 3, 0, -12)], [0, B.air, B.stone]);
});

test('sticky pistons pull the block back; pushes break torches; breaking the head breaks the piston', () => {
  const state = game();
  put(state, 1, 0, -20, B.sticky_piston, 1);
  put(state, 2, 0, -20, B.cobblestone);
  put(state, 0, 0, -20, B.redstone_block);
  tick(state);
  assert.deepEqual([id(state, 2, 0, -20), bits(state, 2, 0, -20), id(state, 3, 0, -20)], [B.piston_head, 1 | 8, B.cobblestone], 'sticky head');
  // A piston finishes its 2-tick move before it retracts.
  put(state, 0, 0, -20, B.air);
  tick(state, 2);
  assert.deepEqual([bits(state, 1, 0, -20), id(state, 2, 0, -20), id(state, 3, 0, -20)], [1, B.cobblestone, B.air], 'pulled back');
  assert.ok(fxOf(state, 'piston').some(fx => fx.a === 0 + 8), 'fx: moving west, 1 block');
  // Obsidian is never pulled.
  put(state, 2, 0, -20, B.air);
  put(state, 0, 0, -20, B.redstone_block);
  tick(state, 3);
  put(state, 3, 0, -20, B.obsidian);
  put(state, 0, 0, -20, B.air);
  tick(state, 2);
  assert.deepEqual([id(state, 2, 0, -20), id(state, 3, 0, -20)], [B.air, B.obsidian]);
  // A torch in the way breaks and drops.
  put(state, 1, 0, -22, B.piston, 1);
  put(state, 2, 0, -22, B.torch);
  put(state, 0, 0, -22, B.redstone_block);
  tick(state);
  assert.equal(id(state, 2, 0, -22), B.piston_head);
  assert.ok(state.items.some(item => item.item === B.torch));
  // Mining the head takes the piston with it.
  assert.ok(breakBlock(state, X + 2, Y, Z - 22));
  assert.deepEqual([id(state, 1, 0, -22), id(state, 2, 0, -22)], [B.air, B.air]);
  assert.ok(state.items.some(item => item.item === B.piston));
});

test('a piston pushes a player standing in its way', () => {
  const state = game(), player = state.players[0]!;
  put(state, -1, 0, 0, B.piston, 1);
  put(state, -2, 0, 0, B.redstone_block);
  tick(state);
  assert.equal(player.x, X + 1.5, 'moved one block east (tp)');
  assert.equal(id(state, 0, 0, 0), B.piston_head);
  // With bedrock behind them, the player stays put instead of being shoved into it.
  const walled = game(), backed = walled.players[0]!;
  put(walled, 1, 0, 0, B.bedrock);
  put(walled, 1, 1, 0, B.bedrock);
  put(walled, -1, 0, 0, B.piston, 1);
  put(walled, -2, 0, 0, B.redstone_block);
  tick(walled);
  assert.equal(backed.x, X + 0.5, 'not pushed into bedrock');
});

// Doors, plates, tnt ----------------------------------------------------------------------------------------------------

test('a stone button opens an iron door for exactly 1 s; using the iron door does nothing', () => {
  const state = game();
  put(state, 2, 0, 0, B.iron_door, 0);
  put(state, 2, 1, 0, B.iron_door, 8);
  put(state, 2, 0, 1, B.stone);
  put(state, 1, 0, 1, B.stone_button, 0);
  send(state, [{ t: 'use', x: X + 2, y: Y, z: Z, face: 0 }]);
  assert.equal(bits(state, 2, 0, 0) & DOOR_OPEN, 0, 'players cannot open iron doors');
  send(state, [{ t: 'use', x: X + 1, y: Y, z: Z + 1, face: 0 }]);
  assert.ok(bits(state, 2, 0, 0) & DOOR_OPEN && bits(state, 2, 1, 0) & DOOR_OPEN, 'both halves open');
  assert.ok(fxOf(state, 'door').length && fxOf(state, 'button').some(fx => fx.a === 1));
  tick(state, 19);
  assert.ok(bits(state, 2, 0, 0) & DOOR_OPEN);
  tick(state);
  assert.equal(bits(state, 2, 0, 0) & DOOR_OPEN, 0, 'closed 20 ticks after the press');
  assert.equal(bits(state, 1, 0, 1), 0, 'button released');
  // Oak buttons hold for 1.5 s.
  put(state, 3, 0, 1, B.oak_button, 1);
  flip(state, 3, 0, 1);
  tick(state, 29);
  assert.ok(bits(state, 2, 0, 0) & DOOR_OPEN);
  tick(state);
  assert.equal(bits(state, 2, 0, 0) & DOOR_OPEN, 0);
});

test('pressure plates: players and mobs press stone plates, items only oak; release 1 s after the last touch', () => {
  const state = game(), player = state.players[0]!;
  put(state, 6, 0, 0, B.stone_pressure_plate);
  put(state, 6, 0, 3, B.oak_pressure_plate);
  put(state, 6, 0, 6, B.stone_pressure_plate);
  put(state, 7, 0, 0, B.redstone_lamp);
  spawnItem(state, X + 6.5, Y + 0.3, Z + 3.5, { id: B.dirt, n: 1 });
  spawnItem(state, X + 6.5, Y + 0.3, Z + 6.5, { id: B.dirt, n: 1 });
  tick(state, 10);
  assert.deepEqual([bits(state, 6, 0, 3), bits(state, 6, 0, 6)], [PLATE_PRESSED, 0], 'oak feels items, stone does not');
  Object.assign(player, { x: X + 6.5, z: Z + 0.5 });
  tick(state);
  assert.deepEqual([bits(state, 6, 0, 0), lit(state, 7, 0, 0)], [PLATE_PRESSED, true]);
  tick(state, 40);
  assert.equal(bits(state, 6, 0, 0), PLATE_PRESSED, 'held while standing on it');
  Object.assign(player, { x: X + 0.5, z: Z + 0.5 });
  tick(state, 19);
  assert.equal(bits(state, 6, 0, 0), PLATE_PRESSED);
  tick(state);
  assert.equal(bits(state, 6, 0, 0), 0, 'released 20 ticks after the player left');
  state.mobs.push(newMob(state, MOB.zombie, X + 6.5, Y, Z + 0.5));
  tick(state);
  assert.equal(bits(state, 6, 0, 0), PLATE_PRESSED, 'mobs press it too');
});

test('a pressure plate on tnt primes it: the primed tnt pops up, flashes for 4 s and explodes', () => {
  const state = game(), player = state.players[0]!;
  put(state, 10, -1, 0, B.tnt);
  put(state, 10, 0, 0, B.stone_pressure_plate);
  Object.assign(player, { x: X + 10.5, z: Z + 0.5 });
  tick(state);
  const [tnt] = tntMobs(state);
  assert.ok(tnt, 'primed');
  assert.equal(id(state, 10, -1, 0), B.air);
  assert.equal(id(state, 10, 0, 0), B.air, 'the plate lost its support');
  assert.ok(fxOf(state, 'tnt').length);
  Object.assign(player, { x: X + 0.5, z: Z + 0.5 });
  const flash = tnt.a;
  tick(state, 78);
  assert.ok(flash >= 19 && tnt.a <= 1 && tnt.health > 0, 'fuse counts down in `a`');
  tick(state);
  assert.equal(tntMobs(state).length, 0, 'exploded after 80 ticks');
  assert.ok(fxOf(state, 'explode').some(fx => fx.a === 4));
  assert.equal(id(state, 10, -2, 0), B.air, 'crater');
});

test('desert temple trap: a plate over sandstone over tnt fires, and the blast chain-primes the rest', () => {
  const state = game();
  // Floor at dy -1 (sandstone), a 3 × 3 of tnt below it, the plate in the middle.
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    put(state, 14 + dx, -1, dz, B.sandstone);
    put(state, 14 + dx, -2, dz, B.tnt);
  }
  put(state, 14, 0, 0, B.stone_pressure_plate);
  // A zombie wanders onto the plate.
  state.mobs.push(newMob(state, MOB.zombie, X + 14.5, Y, Z + 0.5));
  tick(state);
  assert.equal(tntMobs(state).length, 1, 'only the tnt under the strongly powered sandstone');
  assert.equal(id(state, 14, -2, 0), B.air);
  tick(state, 80);
  assert.ok(tntMobs(state).length >= 5, 'the explosion primes its neighbours with short fuses');
  tick(state, 30);
  assert.equal(tntMobs(state).length, 0);
  assert.equal(Array.from({ length: 9 }, (_, i) => id(state, 13 + (i % 3), -2, Math.floor(i / 3) - 1)).filter(t => t === B.tnt).length, 0, 'all nine went off');
});

test('flint and steel primes tnt; primeTnt refuses anything else', () => {
  const state = game(), player = state.players[0]!;
  put(state, 2, 0, 0, B.tnt);
  player.inv[0] = { id: I.flint_and_steel, n: 1 };
  send(state, [{ t: 'use', x: X + 2, y: Y, z: Z, face: 0 }]);
  assert.equal(tntMobs(state).length, 1);
  assert.equal(tntMobs(state)[0]!.fuse, 79);
  assert.equal(primeTnt(state, X + 2, Y - 1, Z), false, 'grass is not tnt');
});

// Saves and budgets -----------------------------------------------------------------------------------------------------

test('a loaded save picks redstone back up: lamps stay lit, buttons release, clocks keep ticking', () => {
  const state = game();
  put(state, 1, 0, 2, B.lever, 3);
  put(state, 2, 0, 2, B.redstone_lamp);
  flip(state, 1, 0, 2);
  put(state, 4, 0, 2, B.stone);
  put(state, 3, 0, 2, B.stone_button, 0);
  flip(state, 3, 0, 2);
  // The burnout-free torch clock from the tutorials needs a slower loop: a torch on A, a delay-4 repeater back into A.
  put(state, -8, 0, 8, B.stone);
  put(state, -8, 0, 9, B.redstone_wire);
  put(state, -8, 0, 10, B.redstone_wire);
  put(state, -7, 0, 10, B.repeater, 3 | 3 << 2);
  put(state, -6, 0, 10, B.redstone_wire);
  put(state, -6, 0, 9, B.redstone_wire);
  put(state, -6, 0, 8, B.redstone_wire);
  put(state, -7, 0, 8, B.redstone_torch, 2);
  tick(state, 7);
  assert.ok(lit(state, 2, 0, 2));
  const saved = parseSave(JSON.parse(JSON.stringify(exportSave(saveSource(state)))));
  const loaded = createState({ ...ctx, roundId: 'r2' }, saved.settings, { source: flat, save: saved, spawn: [X, Y, Z] });
  let toggles = 0, was = id(loaded, -7, 0, 8), lamp = true;
  for (let n = 0; n < 60; n++) {
    tick(loaded);
    lamp &&= lit(loaded, 2, 0, 2);
    if (id(loaded, -7, 0, 8) !== was) toggles++;
    was = id(loaded, -7, 0, 8);
  }
  assert.ok(lamp, 'the lever-powered lamp never flickers after the load');
  assert.equal(bits(loaded, 3, 0, 2), 0, 'the pressed button released');
  assert.ok(toggles >= 4 && toggles <= 8, `the clock runs (${toggles} toggles in 3 s)`);
});

test('budget: a 52-dust repeater clock and a 12-piston sticky door stay under 1 ms per redstone tick', () => {
  const state = game();
  // Clock: torch on A's east face, a 56-cell loop (52 dust, 4 repeaters) back into A's west face; 10 ticks per toggle.
  put(state, 0, 0, -30, B.stone);
  const path: [number, number, number][] = [];
  const go = (n: number, dir: number, from: [number, number]) => { let [x, z] = from; for (let i = 0; i < n; i++) { path.push([x, z, dir]); x += [0, 1, 0, -1][dir]!; z += [-1, 0, 1, 0][dir]!; } };
  go(15, 1, [2, -30]);
  go(6, 2, [16, -29]);
  go(23, 3, [15, -24]);
  go(6, 0, [-7, -25]);
  go(6, 1, [-6, -30]);
  path.forEach(([x, z, dir], i) => put(state, x, 0, z, [10, 24, 38, 46].includes(i) ? B.repeater : B.redstone_wire, [10, 24, 38, 46].includes(i) ? dir : 0));
  put(state, 1, 0, -30, B.redstone_torch, 2);
  // Door: a lever feeding 12 dust, each dust feeding a repeater into a sticky piston holding a stone.
  for (let i = 0; i < 12; i++) {
    put(state, 20 + i, 0, 29, B.stone);
    put(state, 20 + i, 0, 30, B.sticky_piston, 4);
    put(state, 20 + i, 0, 31, B.repeater, 0);
    put(state, 20 + i, 0, 32, B.redstone_wire);
  }
  put(state, 19, 0, 32, B.lever, 3);
  tick(state, 40);
  let samples = 0, total = 0, worst = 0, clock = 0, was = id(state, 1, 0, -30);
  for (let n = 0; n < 400; n++) {
    if (n % 40 === 0) flip(state, 19, 0, 32);
    state.ticks++;
    const start = performance.now();
    tickRedstone(state, 0.05);
    const ms = performance.now() - start;
    if (n >= 40) { samples++; total += ms; worst = Math.max(worst, ms); }
    if (id(state, 1, 0, -30) !== was) clock++;
    was = id(state, 1, 0, -30);
    if (n === 35) assert.ok(Array.from({ length: 12 }, (_, i) => id(state, 20 + i, 0, 29)).every(t => t === B.piston_head), 'the door is open');
    if (n === 75) assert.ok(Array.from({ length: 12 }, (_, i) => id(state, 20 + i, 0, 29)).every(t => t === B.stone), 'and closed again');
  }
  assert.ok(clock >= 38, `the clock toggled ${clock} times`);
  const mean = total / samples;
  console.log(`redstone budget: mean ${mean.toFixed(3)} ms, worst ${worst.toFixed(2)} ms per tick`);
  assert.ok(mean < 1, `mean ${mean.toFixed(3)} ms per tick`);
});

// Shared helpers ---------------------------------------------------------------------------------------------------------

test('shared dust helpers: joins, dots, straight-through lines and tint', () => {
  const cells = new Map<string, number>([['0,0,0', B.redstone_wire], ['1,0,0', B.redstone_wire], ['0,0,-1', makeCell(B.repeater, 0)], ['-1,0,0', makeCell(B.repeater, 0)]]);
  const get = (x: number, y: number, z: number) => cells.get(`${x},${y},${z}`) ?? (y < 0 ? B.stone : B.air);
  assert.equal(wireShape(get, 0, 0, 0), 1 | 2, 'joins the repeater behind it (N-S axis) and the dust east, not the side of the west repeater');
  assert.equal(wirePoints(0), 15, 'a lone dot powers every side');
  assert.equal(wirePoints(2), 2 | 8, 'a single join runs straight through');
  assert.equal(wirePoints(1 | 2), 1 | 2);
  assert.deepEqual(wireTint(0).map(v => +v.toFixed(2)), [0.3, 0, 0]);
  assert.deepEqual(wireTint(15).map(v => +v.toFixed(2)), [1, 0.2, 0]);
});
