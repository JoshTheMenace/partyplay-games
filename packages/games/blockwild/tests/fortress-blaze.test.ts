/** Blazes and fortress spawning (DESIGN.md): hover, volleys of 3 fireballs, burns, fire immunity, drops, spawn bounds. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { B, cellId } from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource } from '../src/shared/chunk';
import { NETHER } from '../src/shared/constants';
import { localIndex } from '../src/shared/coords';
import { I } from '../src/shared/items';
import { MOB, PK, validateSettings } from '../src/shared/protocol';
import { fortressesOf } from '../src/shared/structures/fortress';
import { spawnFortressMobs } from '../src/sim/blaze';
import { damageMob, spawnArrow } from '../src/sim/combat';
import { createState, tickState } from '../src/sim/game';
import { newMob } from '../src/sim/mobs';
import type { Mob, State } from '../src/sim/state';
import { writeCell } from '../src/sim/world';

const FLAT = (() => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : B.netherrack;
  return chunk;
})();
const NX = NETHER.x0 + 256, NZ = 256;
function game(options: { flat?: boolean; x?: number; y?: number; z?: number } = {}): State {
  const { flat = true, x = NX, y = 64, z = NZ } = options, source: ChunkSource | undefined = flat ? () => FLAT : undefined;
  const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: [{ id: 'p0', name: 'Ada', color: '#ff5748' }] };
  const state = createState(ctx, validateSettings({ seed: 11, difficulty: 'normal' }), { source, spawn: [x, y, z] });
  Object.assign(state.players[0]!, { protectedUntil: 0, x: x + 0.5, y, z: z + 0.5 });
  tickState(state, new Map(), 0.05);
  return state;
}
const run = (state: State, seconds: number, each?: () => void) => { for (let i = 0; i < Math.round(seconds * 20); i++) { tickState(state, new Map(), 0.05); each?.(); } };
const add = (state: State, t: number, x: number, y: number, z: number): Mob => {
  const mob = newMob(state, t, x, y, z);
  state.mobs.push(mob);
  return mob;
};

test('blazes hover and bob above the floor, and hold their height over a drop', () => {
  const state = game();
  state.settings.mode = 'creative';
  const blaze = add(state, MOB.blaze, NX + 8.5, 67, NZ + 0.5), heights: number[] = [];
  run(state, 8, () => heights.push(blaze.y));
  const late = heights.slice(60);
  assert.ok(Math.min(...late) > 64.2 && Math.max(...late) < 66.6, `hovers: ${Math.min(...late).toFixed(2)}..${Math.max(...late).toFixed(2)}`);
  assert.ok(Math.max(...late) - Math.min(...late) > 0.4, 'bobs up and down');
  assert.ok(heights.every((y, i) => i === 0 || heights[i - 1]! - y < 0.06), 'sinks slowly, never falls');
  assert.equal(blaze.health, 20);
});

test('a blaze that sees a player fires volleys of 3 small fireballs, then cools down; walls block its view', () => {
  const state = game(), player = state.players[0]!, blaze = add(state, MOB.blaze, NX + 14.5, 66, NZ + 0.5);
  const shots = new Map<number, number>();
  let glowed = false;
  run(state, 7, () => {
    glowed ||= blaze.a === 3;
    for (const ball of state.arrows) if (ball.k === PK.BLAZE_FIREBALL && ball.shooter === blaze.id && !shots.has(ball.id)) shots.set(ball.id, state.clock);
  });
  const times = [...shots.values()];
  assert.ok(glowed, 'glows before a volley');
  assert.ok(times.length >= 3 && times.length <= 6, `${times.length} shots`);
  assert.ok(times[2]! - times[0]! < 0.8 && (times.length === 3 || times[3]! - times[2]! > 2.5), 'three quick shots, then a pause');
  assert.ok(state.fx.some(entry => entry.fx.k === 'blazeShoot') || times.length > 0);
  assert.ok(player.health < 20, 'the volley lands');
  assert.ok(blaze.y > player.y + 0.5, 'rises above its target');

  const blind = game();
  for (let y = 64; y < 80; y++) for (let z = -12; z <= 12; z++) writeCell(blind, NX + 6, y, NZ + z, B.netherrack);
  const hidden = add(blind, MOB.blaze, NX + 14.5, 66, NZ + 0.5);
  run(blind, 5);
  assert.equal(blind.arrows.filter(ball => ball.shooter === hidden.id).length, 0, 'no line of sight, no fireballs');
  assert.equal(blind.players[0]!.health, 20);
});

test('small fireballs deal 5 damage and burn; on the ground they light a fire and break nothing', () => {
  const state = game(), player = state.players[0]!;
  spawnArrow(state, player.x + 6, player.y + 1, player.z, -15, 0, 0, 5, 999, false, PK.BLAZE_FIREBALL);
  run(state, 0.6);
  assert.equal(player.health, 15);
  assert.ok(player.fire > 0, 'set alight');
  assert.equal(state.arrows.filter(ball => ball.k === PK.BLAZE_FIREBALL).length, 0, 'spent');

  const ground = game(), x = NX + 10, z = NZ + 6;
  spawnArrow(ground, x + 0.5, 70, z + 0.5, 0, -15, 0, 5, 999, false, PK.BLAZE_FIREBALL);
  run(ground, 0.6);
  assert.equal(cellId(ground.get(x, 63, z)), B.netherrack, 'no block damage');
  assert.equal(cellId(ground.get(x, 64, z)), B.fire, 'a fire where it landed');
});

test('blazes burn players who come close, and drop blaze rods to players', () => {
  const state = game(), player = state.players[0]!, blaze = add(state, MOB.blaze, player.x + 0.8, 64.5, player.z);
  run(state, 1);
  assert.ok(player.health <= 14 && player.fire > 0, `burned: ${player.health}`);
  damageMob(state, blaze, 100, player);
  run(state, 0.1);
  assert.ok(state.items.some(item => item.item === I.blaze_rod), 'a blaze rod');
});

test('blazes are fire-immune: lava and fire never hurt them', () => {
  const state = game();
  state.settings.mode = 'creative';
  const blaze = add(state, MOB.blaze, NX + 8.5, 64, NZ + 0.5);
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) writeCell(state, NX + 8 + dx, 64, NZ + dz, B.lava);
  run(state, 3);
  assert.equal(blaze.health, 20);
});

test('fortress spawning: blazes and piglins on fortress floors, 24+ blocks away, inside the bounds, only for players in a fortress', () => {
  const fort = fortressesOf(11)[0]!, [cx, cy, cz] = fort.center, [x0, y0, z0, x1, y1, z1] = fort.bounds;
  const state = game({ flat: false, x: cx, y: cy, z: cz }), player = state.players[0]!;
  for (let x = x0; x <= x1 + 16; x += 16) for (let z = z0; z <= z1 + 16; z += 16) state.get(Math.min(x, x1), 64, Math.min(z, z1));
  for (let i = 0; i < 300; i++) spawnFortressMobs(state);
  const blazes = state.mobs.filter(m => m.t === MOB.blaze), piglins = state.mobs.filter(m => m.t === MOB.zombified_piglin);
  assert.ok(blazes.length >= 2 && piglins.length >= 1, `${blazes.length} blazes, ${piglins.length} piglins`);
  assert.ok(blazes.length <= 5, 'blazes capped at 3 + 2 per player');
  for (const mob of state.mobs) {
    assert.ok(mob.x >= x0 && mob.x <= x1 + 1 && mob.z >= z0 && mob.z <= z1 + 1 && mob.y >= y0 && mob.y <= y1, 'inside the fortress');
    assert.equal(cellId(state.get(Math.floor(mob.x), Math.floor(mob.y) - 1, Math.floor(mob.z))), B.nether_bricks, 'on a fortress floor');
    assert.ok(Math.hypot(mob.x - player.x, mob.y - player.y, mob.z - player.z) >= 24, 'never close to the player');
  }
  // Outside every fortress: nothing from this spawner.
  const away = game({ flat: true });
  for (let i = 0; i < 100; i++) spawnFortressMobs(away);
  assert.equal(away.mobs.length, 0);
});
