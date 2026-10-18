import assert from 'node:assert/strict';
import { test } from 'node:test';
import { B, cellId, cellState, DAYLIGHT_INVERTED, daylightPower, makeCell, OBSERVER_POWERED, wirePower } from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource } from '../src/shared/chunk';
import { END, NETHER } from '../src/shared/constants';
import { chunkKey, localIndex } from '../src/shared/coords';
import { validateSettings } from '../src/shared/protocol';
import { conducts } from '../src/shared/redstone';
import { createState, tickState } from '../src/sim/game';
import { daylightTarget, tickRedstone } from '../src/sim/redstone';
import type { State } from '../src/sim/state';
import { writeCell } from '../src/sim/world';

// The flat creative world from redstone.test.ts: grass at y = 63, builds stand on dy = 0 around (X, Y, Z).
const FLAT = (() => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < 63 ? B.stone : B.grass_block;
  return chunk;
})();
const flat: ChunkSource = () => FLAT;
const X = 2048, Y = 64, Z = 2048;
const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: [{ id: 'p0', name: 'Ada', color: '#ff5748' }] };
function game(): State {
  const state = createState(ctx, { ...validateSettings({}), mode: 'creative' }, { source: flat, spawn: [X, Y, Z] });
  for (let cx = 120; cx < 136; cx++) for (let cz = 120; cz < 136; cz++) state.animalChunks.add(chunkKey(cx, cz));
  return state;
}
const at = (state: State, dx: number, dy: number, dz: number) => state.get(X + dx, Y + dy, Z + dz);
const id = (state: State, dx: number, dy: number, dz: number) => cellId(at(state, dx, dy, dz));
const bits = (state: State, dx: number, dy: number, dz: number) => cellState(at(state, dx, dy, dz));
const on = (state: State, dx: number, dy: number, dz: number) => (bits(state, dx, dy, dz) & OBSERVER_POWERED) !== 0;
const put = (state: State, dx: number, dy: number, dz: number, block: number, s = 0) => assert.ok(writeCell(state, X + dx, Y + dy, Z + dz, makeCell(block, s)));
const tick = (state: State, n = 1) => { for (let i = 0; i < n; i++) tickState(state, new Map(), 0.05); };
/** The ticks (1-based, within `n`) on which `probe` switched on. */
function rises(state: State, n: number, probe: () => boolean) {
  const out: number[] = [];
  let was = probe();
  for (let t = 1; t <= n; t++) {
    tick(state);
    const now = probe();
    if (now && !was) out.push(t);
    was = now;
  }
  return out;
}
/** Observer facings: the face that watches (0 west, 1 east, 2 down, 3 up, 4 north, 5 south); its back is the opposite. */
const EAST = 1, WEST = 0, UP = 3;

// Observers ------------------------------------------------------------------------------------------------------------

test('an observer sees a crop grow: a 1-redstone-tick pulse from its back lights the lamp behind it', () => {
  const state = game();
  put(state, 2, -1, 0, B.farmland);
  put(state, 2, 0, 0, B.wheat);
  put(state, 1, 0, 0, B.observer, EAST);
  put(state, 0, 0, 0, B.redstone_lamp);
  tick(state, 10);
  assert.ok(!on(state, 1, 0, 0) && id(state, 0, 0, 0) === B.redstone_lamp, 'placing an observer does not fire it');
  put(state, 2, 0, 0, B.wheat, 1); // the same write growth.ts makes
  const timeline = Array.from({ length: 6 }, () => (tick(state), on(state, 1, 0, 0)));
  assert.deepEqual(timeline, [false, true, true, false, false, false], 'on after 2 game ticks, for 2 game ticks');
  assert.equal(id(state, 0, 0, 0), B.redstone_lamp_lit, 'the lamp behind caught the pulse');
  assert.ok(state.fx.some(entry => entry.fx.k === 'observer'), 'with a little effect for the client');
  tick(state, 10);
  assert.equal(id(state, 0, 0, 0), B.redstone_lamp, 'and goes dark again');
});

test('an observer sees blocks placed and broken, and a lamp toggling, but not its sides or back', () => {
  const state = game();
  put(state, 1, 0, 0, B.observer, EAST);
  tick(state, 5);
  put(state, 2, 0, 0, B.cobblestone);
  assert.deepEqual(rises(state, 10, () => on(state, 1, 0, 0)), [2], 'placing');
  put(state, 2, 0, 0, B.air);
  assert.deepEqual(rises(state, 10, () => on(state, 1, 0, 0)), [2], 'breaking');
  put(state, 1, 0, 1, B.stone);
  put(state, 0, 0, 0, B.stone);
  put(state, 1, 1, 0, B.stone);
  assert.deepEqual(rises(state, 10, () => on(state, 1, 0, 0)), [], 'sides, back and top are ignored');
  // A lever-driven lamp in front: the observer fires when it lights and again when it goes dark.
  put(state, 2, 0, 0, B.redstone_lamp);
  put(state, 3, 0, 0, B.lever, 3);
  tick(state, 5);
  const lever = (s: number) => put(state, 3, 0, 0, B.lever, s);
  lever(3 | 8);
  assert.equal(rises(state, 10, () => on(state, 1, 0, 0)).length, 1, 'lamp on');
  lever(3);
  assert.equal(rises(state, 20, () => on(state, 1, 0, 0)).length, 1, 'lamp off');
});

test('an observer strongly powers the block behind it, so dust past that block reads 15', () => {
  const state = game();
  put(state, 1, 0, 0, B.observer, EAST);
  put(state, 0, 0, 0, B.stone);
  put(state, -1, 0, 0, B.redstone_wire);
  put(state, -2, 0, 0, B.redstone_wire);
  tick(state, 5);
  put(state, 2, 0, 0, B.oak_planks);
  const peak = Math.max(...Array.from({ length: 6 }, () => (tick(state), wirePower(bits(state, -1, 0, 0)))));
  assert.equal(peak, 15);
  assert.ok(!conducts(makeCell(B.observer, EAST)), 'observers do not conduct power themselves (MC)');
  tick(state, 5);
  assert.equal(wirePower(bits(state, -2, 0, 0)), 0, 'and the dust drops back to 0');
});

test('two observers face to face make the tutorial clock: on 1 redstone tick, off 1, forever', () => {
  const state = game();
  put(state, 1, 0, 0, B.observer, EAST);
  put(state, 2, 0, 0, B.observer, WEST); // the first one sees this placement and starts the loop
  put(state, 0, 0, 0, B.redstone_lamp);
  tick(state, 10);
  const pulses = rises(state, 80, () => on(state, 1, 0, 0));
  const gaps = pulses.slice(1).map((t, i) => t - pulses[i]!);
  assert.ok(gaps.length >= 18 && gaps.every(gap => gap === 4), `a pulse every 2 redstone ticks (${gaps})`);
  // Breaking either observer stops it.
  put(state, 2, 0, 0, B.air);
  tick(state, 10);
  assert.deepEqual(rises(state, 40, () => on(state, 1, 0, 0)), []);
});

test('a piston moving an observer makes it pulse exactly once (no flying-machine loop)', () => {
  const state = game();
  put(state, 0, 0, 0, B.piston, EAST);
  put(state, 1, 0, 0, B.observer, UP); // watches the air above; its back faces the ground
  tick(state, 5);
  put(state, -1, 0, 0, B.redstone_block);
  let pulses = 0, was = false;
  for (let t = 0; t < 40; t++) {
    tick(state);
    const now = id(state, 2, 0, 0) === B.observer && on(state, 2, 0, 0);
    if (now && !was) pulses++;
    was = now;
  }
  assert.equal(id(state, 1, 0, 0), B.piston_head);
  assert.equal(pulses, 1, 'one pulse on arrival');
  assert.ok(!on(state, 2, 0, 0));
});

test('budget: 400 observer clocks are capped at 256 switch-ons per tick, keep running and stay under 2 ms per tick', () => {
  const state = game();
  const pairs = Array.from({ length: 400 }, (_, i) => [(i % 20) * 3 - 30, Math.floor(i / 20) * 2 - 20] as const);
  for (const [dx, dz] of pairs) {
    put(state, dx, 0, dz, B.observer, EAST);
    put(state, dx + 1, 0, dz, B.observer, WEST);
  }
  tick(state, 20);
  let capped = 0;
  const seen = new Set<number>(), times: number[] = [];
  for (let n = 0; n < 200; n++) {
    state.ticks++;
    const start = performance.now(), fx = state.fxId;
    tickRedstone(state, 0.05);
    times.push(performance.now() - start);
    assert.ok(state.redstone.pulses <= 256 && state.fxId - fx <= 1, 'capped, with at most one observer effect per tick');
    if (state.redstone.pulses === 256) capped++;
    pairs.forEach(([dx, dz], i) => { if (on(state, dx, 0, dz)) seen.add(i); });
  }
  assert.ok(capped > 0, 'the cap was reached (≈ 400 switch-ons are due every other tick)');
  assert.equal(seen.size, pairs.length, 'yet every clock keeps ticking, just later');
  // The median over two-tick windows (the clocks alternate busy and idle ticks), so a preempted tick on a busy machine doesn't count.
  const windows = times.slice(1).map((t, i) => (t + times[i]!) / 2).sort((a, b) => a - b), median = windows[windows.length >> 1]!;
  assert.ok(median < 2, `median ${median.toFixed(3)} ms per tick`);
});

// Daylight detectors -----------------------------------------------------------------------------------------------------

test('a daylight detector follows the sun over a day; inverted it does the opposite', () => {
  const state = game();
  put(state, 1, 0, 0, B.daylight_detector);
  put(state, 2, 0, 0, B.redstone_wire);
  put(state, 1, 0, 2, B.daylight_detector, DAYLIGHT_INVERTED);
  const read = (dz: number) => daylightPower(bits(state, 1, 0, dz));
  const day: number[] = [], inverted: number[] = [];
  for (const time of [0, 1000, 3000, 6000, 9000, 11000, 12000, 15000, 18000, 23000]) {
    state.time = time;
    tick(state, 20); // re-read once a second
    day.push(read(0));
    inverted.push(read(2));
  }
  assert.deepEqual(day.map(p => p > 0), [false, true, true, true, true, true, false, false, false, false], `day curve ${day}`);
  assert.equal(day[3], 15, 'full at noon');
  assert.ok(day[1]! < day[2]! && day[2]! < day[3]! && day[4]! < day[3]!, 'rising then falling');
  assert.deepEqual(inverted, day.map(p => 15 - p), 'inverted gives the opposite');
  assert.equal(wirePower(bits(state, 2, 0, 0)), day.at(-1), 'dust beside it carries the power');
  // A roof blocks it; updates land within a second.
  state.time = 6000;
  tick(state, 20);
  put(state, 1, 3, 0, B.stone);
  tick(state, 20);
  assert.equal(read(0), 0, 'roofed');
});

test('using a daylight detector inverts it; in the Nether and the End it reads 0 either way', () => {
  const state = game();
  state.time = 6000;
  put(state, 1, 0, 0, B.daylight_detector);
  tick(state, 2);
  assert.equal(daylightPower(bits(state, 1, 0, 0)), 15);
  put(state, 1, 0, 0, B.daylight_detector, DAYLIGHT_INVERTED | 15); // what commands.useCommand writes
  tick(state, 2);
  assert.equal(daylightPower(bits(state, 1, 0, 0)), 0, 'inverted at noon reads 0, without waiting a second');
  for (const [x, z] of [[NETHER.x0 + 100, NETHER.z0 + 100], [END.x0 + 256, END.z0 + 256]] as const) {
    for (const time of [0, 6000, 18000]) {
      state.time = time;
      assert.equal(daylightTarget(state, x, 70, z, 0), 0);
      assert.equal(daylightTarget(state, x, 70, z, DAYLIGHT_INVERTED), 0);
    }
  }
});
