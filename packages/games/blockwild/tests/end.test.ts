/** The End (DESIGN.md): island terrain, pillars, the fountain, the void, arriving and the exit portal home. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { B, cellId, cellState, fenceConnects, isSolid } from '../src/shared/blocks';
import { CHUNK, EDIT_LIMIT, END, END_ARRIVAL, END_CENTER, VOID_Y } from '../src/shared/constants';
import { cellIndex, localIndex } from '../src/shared/coords';
import { crystalSpot, endPillars, EXIT_PORTAL, EXIT_Y, generateEndChunk, islandColumn, PERCH_Y, PILLAR_RING } from '../src/shared/end';
import { I } from '../src/shared/items';
import { MOB, validateSettings } from '../src/shared/protocol';
import { generateChunk } from '../src/shared/worldgen';
import { arriveInEnd, dragonSlain } from '../src/sim/end';
import { createState, tickState } from '../src/sim/game';
import { newMob } from '../src/sim/mobs';
import type { State } from '../src/sim/state';
import { publicView } from '../src/sim/views';
import { writeCell } from '../src/sim/world';

const SEED = 4242, { x: CX, z: CZ } = END_CENTER;
function game(mode: 'survival' | 'creative' = 'survival'): State {
  const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: [{ id: 'p0', name: 'Ada', color: '#ff5748' }] };
  const state = createState(ctx, validateSettings({ seed: SEED, mode, difficulty: 'normal' }), { spawn: [2048, 90, 2048] });
  state.players[0]!.protectedUntil = 0;
  return state;
}
const run = (state: State, seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) tickState(state, new Map(), 0.05); };
/** A cell of the generated End, read from its chunk. */
const cell = (x: number, y: number, z: number) => generateEndChunk(SEED, x >> 4, z >> 4)[localIndex(x & 15, y, z & 15)]!;

test('End terrain: deterministic, routed from generateChunk, seamless across chunks and fast', () => {
  const a = generateEndChunk(SEED, 240, 240);
  assert.deepEqual(generateEndChunk(SEED, 240, 240), a);
  assert.deepEqual(generateChunk(SEED, 240, 240), a, 'worldgen dispatches End chunks here');
  assert.notDeepEqual(generateEndChunk(SEED + 1, 238, 240), generateEndChunk(SEED, 238, 240), 'the seed shapes the island');
  // Every column of a 6×6-chunk window agrees with the column function, so neighbours always meet.
  for (let cz = 237; cz < 243; cz++) for (let cx = 237; cx < 243; cx++) {
    const chunk = generateEndChunk(SEED, cx, cz);
    for (let lz = 0; lz < CHUNK; lz += 5) for (let lx = 0; lx < CHUNK; lx += 5) {
      const x = cx * CHUNK + lx, z = cz * CHUNK + lz, [bottom, top] = islandColumn(SEED, x, z);
      if (bottom > top || Math.hypot(x - CX, z - CZ) < 50 || Math.abs(z - CZ) < 4 && x > CX + 80) continue;
      assert.equal(chunk[localIndex(lx, top, lz)], B.end_stone);
      assert.equal(chunk[localIndex(lx, top + 1, lz)], B.air, 'open sky above the surface');
      assert.equal(chunk[localIndex(lx, bottom - 1, lz)] ?? B.air, bottom > 0 ? B.air : B.end_stone, 'the void below');
    }
  }
  const times: number[] = [];
  for (let cz = 234; cz < 246; cz++) for (let cx = 234; cx < 246; cx++) {
    const start = performance.now();
    generateEndChunk(SEED, cx, cz);
    times.push(performance.now() - start);
  }
  times.sort((p, q) => p - q);
  assert.ok(times[times.length >> 1]! <= 6, `median ${times[times.length >> 1]} ms`);
});

test('end.ts only uses engine-exact math', () => {
  const source = readFileSync(new URL('../src/shared/end.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Math\.(sin|cos|tan|atan2?|exp|pow|log\w*|random|hypot|cbrt|round|fround)\b/);
  assert.doesNotMatch(source, /[\w)\]] ?\*\* ?[\w(]/, 'uses **');
});

test('on every seed the arrival platform is sunk into the island, never over the void', () => {
  for (const seed of [1, 11, 4242, 777777, 999999]) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const [bottom, top] = islandColumn(seed, END_ARRIVAL.x + dx, END_ARRIVAL.z + dz);
    assert.ok(bottom < END_ARRIVAL.y - 2 && top > END_ARRIVAL.y + 4, `seed ${seed} at ${dx}, ${dz}: ${bottom}–${top}`);
  }
});

test('the island: a domed, eroded disc of end stone hanging over the void, sealed far out by barriers', () => {
  const radii: number[] = [];
  for (let i = 0; i < 72; i++) {
    const angle = i / 72 * Math.PI * 2;
    let r = 0;
    while (r < 200) {
      const [bottom, top] = islandColumn(SEED, Math.floor(CX + Math.cos(angle) * r), Math.floor(CZ + Math.sin(angle) * r));
      if (bottom > top) break;
      r++;
    }
    radii.push(r);
  }
  assert.ok(Math.min(...radii) >= 80 && Math.max(...radii) <= 130, `radius ${Math.min(...radii)}–${Math.max(...radii)}`);
  assert.ok(new Set(radii).size > 10, 'an eroded outline, not a circle');
  const [bottom, top] = islandColumn(SEED, CX + 20, CZ + 20), [edgeBottom, edgeTop] = islandColumn(SEED, CX + 75, CZ);
  assert.ok(top >= 55 && top <= 64 && edgeTop >= 52 && edgeTop <= top, 'a gentle dome');
  assert.ok(top - bottom > 35 && edgeTop - edgeBottom < top - bottom, 'the underside tapers towards the rim');
  for (let y = 0; y < 128; y++) assert.equal(cell(CX + 150, y, CZ), B.air, 'open void beyond the island');
  for (let y = 0; y < 128; y += 9) assert.deepEqual([cell(END.x0, y, CZ), cell(CX, y, END.z0)], [B.barrier, B.barrier], 'the inside faces are barriers');
});

test('ten obsidian pillars on the ring, bedrock caps for the crystals; the two shortest are caged in iron bars', () => {
  const pillars = endPillars(SEED);
  assert.equal(pillars.length, 10);
  assert.deepEqual(endPillars(SEED), pillars, 'deterministic');
  assert.notDeepEqual(endPillars(SEED + 1).map(p => p.top), pillars.map(p => p.top), 'heights are shuffled per seed');
  assert.deepEqual(pillars.map(p => p.top).sort((a, b) => a - b), [76, 79, 82, 85, 88, 91, 94, 97, 100, 103]);
  for (const p of pillars) {
    assert.ok(Math.abs(Math.hypot(p.x - CX, p.z - CZ) - PILLAR_RING) < 1 && p.r >= 2 && p.r <= 5);
    assert.equal(cell(p.x, p.top, p.z), B.bedrock, 'a bedrock cap');
    assert.equal(cell(p.x + p.r, p.top - 1, p.z), B.obsidian);
    assert.equal(cell(p.x, 70, p.z), B.obsidian, 'solid obsidian all the way up (climbable by pillaring beside it)');
    assert.deepEqual(crystalSpot(p), [p.x + 0.5, p.top + 1, p.z + 0.5]);
    for (let y = p.top + 1; y <= p.top + 3; y++) assert.equal(cell(p.x, y, p.z), B.air, 'room for the crystal');
    const bars = cell(p.x + 2, p.top + 2, p.z);
    assert.equal(cellId(bars) === B.iron_bars, p.caged, `pillar at ${p.top} caged: ${p.caged}`);
    if (p.caged) {
      assert.ok(fenceConnects(cellState(bars), 0) && fenceConnects(cellState(bars), 2) && !fenceConnects(cellState(bars), 1), 'bars join along the wall');
      assert.equal(cellId(cell(p.x, p.top + 4, p.z)), B.iron_bars, 'a roof');
    }
  }
  assert.deepEqual(pillars.filter(p => p.caged).map(p => p.top).sort(), [76, 79]);
});

test('the exit portal fountain: bedrock bowl and rim, a 4-tall pillar with torches, inactive until the dragon dies', () => {
  for (const [dx, dz] of EXIT_PORTAL) {
    assert.equal(cell(CX + dx, EXIT_Y - 1, CZ + dz), B.bedrock);
    assert.equal(cell(CX + dx, EXIT_Y, CZ + dz), B.air, 'no portal yet');
  }
  assert.equal(EXIT_PORTAL.length, 20);
  for (const [dx, dz] of [[3, 0], [-3, 1], [0, -3], [2, 2], [-2, -2]]) assert.equal(cell(CX + dx!, EXIT_Y, CZ + dz!), B.bedrock, 'the rim');
  assert.equal(cell(CX + 2, EXIT_Y, CZ + 2), B.bedrock, 'rounded corners');
  for (let y = EXIT_Y; y < PERCH_Y; y++) assert.equal(cell(CX, y, CZ), B.bedrock);
  assert.equal(cell(CX, PERCH_Y, CZ), B.air);
  assert.deepEqual([cell(CX, PERCH_Y - 2, CZ - 1), cell(CX + 1, PERCH_Y - 2, CZ), cell(CX, PERCH_Y - 2, CZ + 1), cell(CX - 1, PERCH_Y - 2, CZ)].map(c => [cellId(c), cellState(c)]),
    [[B.torch, 1], [B.torch, 2], [B.torch, 3], [B.torch, 4]]);
});

test('arriving: the obsidian platform is rebuilt, the player faces the island with 3 s protection, stairs lead up', () => {
  const state = game(), player = state.players[0]!, { x, y, z } = END_ARRIVAL;
  assert.equal(cell(x, y, z), B.obsidian, 'the platform is part of the terrain too');
  writeCell(state, x + 1, y, z, B.air);
  writeCell(state, x, y + 1, z - 1, B.cobblestone);
  arriveInEnd(state, player);
  assert.deepEqual([player.x, player.y, player.z, player.yaw], [x + 0.5, y + 1, z + 0.5, 1.571]);
  assert.deepEqual([state.get(x + 1, y, z), state.get(x, y + 1, z - 1), state.get(x - 2, y, z + 2), state.get(x + 2, y + 3, z - 2)], [B.obsidian, B.air, B.obsidian, B.air]);
  assert.ok(state.clock + 2.9 < player.protectedUntil && player.protectedUntil <= state.clock + 3);
  assert.equal(player.toast?.text.startsWith('Entering the End'), true);
  assert.ok(isSolid(state.get(x, y - 1, z)) && isSolid(state.get(x - 3, y, z)), 'the platform sits inside the island, never over the void');
  // Walk the stairway: one step up per block west until the head is in the open.
  let k = 0;
  for (; k < 24; k++) {
    const sx = x - 3 - k, sy = y + 1 + k;
    if (islandColumn(SEED, sx, z)[1] < sy) break;
    assert.ok(isSolid(state.get(sx, sy - 1, z)) && [0, 1, 2].every(d => state.get(sx, sy + d, z) === B.air), `step ${k}`);
  }
  assert.ok(k > 3 && k < 24, `the stairs reach the surface after ${k} steps`);
  tickState(state, new Map(), 0.05);
  assert.equal(publicView(state).mobs.filter(m => m.t === MOB.ender_dragon).length, 1, 'the dragon wakes when the End is first visited');
  assert.equal(publicView(state).boss?.crystals, 10);
});

test('the void: below y = -64 players take 4 every 0.5 s through armor and protection; everything else is removed', () => {
  const state = game(), player = state.players[0]!;
  arriveInEnd(state, player);
  run(state, 0.1);
  player.armor = [{ id: I.diamond_helmet, n: 1 }, { id: I.diamond_chestplate, n: 1 }, { id: I.diamond_leggings, n: 1 }, { id: I.diamond_boots, n: 1 }];
  player.protectedUntil = state.clock + 10;
  const item = { id: 999, item: B.dirt, n: 1, x: CX + 140, y: VOID_Y - 5, z: CZ, vx: 0, vy: 0, vz: 0, age: 0, pickupAt: 0, owner: null, ownerAt: 0, onGround: false, resting: false };
  const mob = Object.assign(newMob(state, MOB.zombie, CX + 140, VOID_Y - 5, CZ), { persistent: true });
  state.items.push(item);
  state.mobs.push(mob);
  Object.assign(player, { x: CX + 140, y: VOID_Y - 10, z: CZ, food: 10 });
  const before = player.health;
  run(state, 1);
  assert.equal(before - player.health, 8, 'two hits of 4 in one second');
  assert.ok(!state.items.includes(item) && !state.mobs.includes(mob));
  run(state, 2);
  assert.ok(player.dead && /fell out of the world/.test(player.deathMessage));
  const creative = game('creative'), flyer = creative.players[0]!;
  Object.assign(flyer, { x: CX + 140, y: VOID_Y - 10, z: CZ });
  run(creative, 1);
  assert.equal(flyer.health, 20, 'creative is immune');
});

test('after the dragon: the exit portal opens, the egg sits on the pillar, and stepping in goes home', () => {
  const state = game(), player = state.players[0]!;
  arriveInEnd(state, player);
  run(state, 0.1);
  dragonSlain(state, ['Ada']);
  for (const [dx, dz] of EXIT_PORTAL) assert.equal(state.get(CX + dx, EXIT_Y, CZ + dz), B.end_portal);
  assert.equal(state.get(CX, PERCH_Y, CZ), B.dragon_egg);
  assert.deepEqual([state.end.dragon, state.end.portalActive, state.end.egg, state.stats.dragons], ['dead', true, true, 1]);
  assert.deepEqual(state.end.victory?.by, ['Ada']);
  Object.assign(player, { x: CX + 1.5, y: EXIT_Y, z: CZ + 0.5 });
  run(state, 0.1);
  assert.ok(Math.abs(player.x - state.spawn[0]) < 4 && Math.abs(player.z - state.spawn[2]) < 4, 'home at the world spawn');
  assert.equal(player.toast?.text, 'Returning home…');
  assert.equal(publicView(state).boss, undefined);
});

test('an exit portal blocked by the edit limit opens as soon as there is room (never a locked End)', () => {
  const state = game(), player = state.players[0]!;
  arriveInEnd(state, player);
  run(state, 0.1);
  const filler = Array.from({ length: EDIT_LIMIT - state.world.edits.size }, (_, i) => cellIndex(100 + (i & 1023), 120, 100 + (i >> 10)));
  for (const index of filler) state.world.edits.set(index, B.stone);
  dragonSlain(state, ['Ada']);
  assert.deepEqual([state.end.dragon, state.end.portalActive, cellId(state.get(CX + EXIT_PORTAL[0]![0], EXIT_Y, CZ + EXIT_PORTAL[0]![1]))], ['dead', false, B.air]);
  for (const index of filler.slice(0, EXIT_PORTAL.length)) state.world.edits.delete(index);
  run(state, 1.1);
  assert.equal(state.end.portalActive, true);
  for (const [dx, dz] of EXIT_PORTAL) assert.equal(state.get(CX + dx, EXIT_Y, CZ + dz), B.end_portal);
});
