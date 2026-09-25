/** Fire and burning (DESIGN.md), beds and water in the Nether. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { B, cellId, makeCell } from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource } from '../src/shared/chunk';
import { NETHER } from '../src/shared/constants';
import { cellIndex, localIndex } from '../src/shared/coords';
import { I } from '../src/shared/ids';
import { IF, MOB, MS, PF, validateSettings, type CmdBody, type Input, type Mode } from '../src/shared/protocol';
import { BURN_SECONDS, igniteEntity } from '../src/sim/fire';
import { createState, tickState } from '../src/sim/game';
import { newMob } from '../src/sim/mobs';
import type { Player, State } from '../src/sim/state';
import { playerView, publicView } from '../src/sim/views';
import { writeCell } from '../src/sim/world';

const FLAT = (() => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < 63 ? B.stone : B.grass_block;
  return chunk;
})();
const flat: ChunkSource = () => FLAT;
const X = 2048, Z = 2048;
function game(mode: Mode = 'survival', spawn: [number, number, number] = [X, 64, Z]): State {
  const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: [{ id: 'p0', name: 'Ada', color: '#ff5748' }] };
  const state = createState(ctx, validateSettings({ seed: 11, mode, difficulty: 'normal' }), { source: flat, spawn });
  // No regeneration (food below 18, not peaceful) so health changes are only damage. Open daylight spawns no monsters.
  Object.assign(state.players[0]!, { protectedUntil: 0, food: 17, x: spawn[0] + 0.5, y: spawn[1], z: spawn[2] + 0.5 });
  return state;
}
const hold = (player: Player, cmds: CmdBody[]): Input =>
  ({ p: [player.x, player.y, player.z], v: [0, 0, 0], yaw: player.yaw, pitch: player.pitch, f: IF.ON_GROUND, slot: player.slot, mine: null, tpAck: player.tp.n, cmds: cmds.map((c, i) => ({ n: player.ack + 1 + i, ...c }) as Input['cmds'][number]) });
const send = (state: State, cmds: CmdBody[]) => tickState(state, new Map([['p0', hold(state.players[0]!, cmds)]]), 0.05);
const run = (state: State, seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) tickState(state, new Map(), 0.05); };

test('fire burns out after 2–6 s, except on netherrack and magma', () => {
  const state = game();
  writeCell(state, X + 3, 64, Z, B.fire);
  writeCell(state, X + 5, 63, Z, B.netherrack);
  writeCell(state, X + 5, 64, Z, B.fire);
  writeCell(state, X + 7, 63, Z, B.magma_block);
  writeCell(state, X + 7, 64, Z, B.fire);
  run(state, 1.9);
  assert.equal(cellId(state.get(X + 3, 64, Z)), B.fire, 'still burning at 1.9 s');
  run(state, 4.2);
  assert.equal(cellId(state.get(X + 3, 64, Z)), B.air, 'burnt out by 6.1 s');
  run(state, 30);
  assert.equal(cellId(state.get(X + 5, 64, Z)), B.fire, 'eternal on netherrack');
  assert.equal(cellId(state.get(X + 7, 64, Z)), B.fire, 'eternal on magma');
  // Mining the netherrack away lets the fire go out soon after (it no longer has support).
  writeCell(state, X + 5, 63, Z, B.stone);
  run(state, 6.1);
  assert.equal(cellId(state.get(X + 5, 64, Z)), B.air);
  assert.equal(state.fire.cells.size, 1);
});

test('fire in unloaded chunks waits: it neither regenerates its chunk nor primes TNT with nobody near', () => {
  const state = game('creative'), [fx, fz] = [X + 600, Z];
  writeCell(state, fx, 63, fz, B.netherrack);
  writeCell(state, fx, 64, fz, B.fire);
  run(state, 0.05);
  state.world.cache.clear();
  // TNT beside it, written straight into the edit journal so its chunk stays unloaded.
  state.world.edits.set(cellIndex(fx + 1, 64, fz), B.tnt);
  run(state, 1);
  assert.ok(!state.world.cache.has(fx >> 4, fz >> 4), 'the far chunk stays unloaded');
  assert.equal(cellId(state.get(fx + 1, 64, fz)), B.tnt, 'no primed TNT far away');
});

test('burning: 1 damage a second for its duration, shown in both views; water puts it out', () => {
  const state = game(), player = state.players[0]!;
  igniteEntity(state, player, BURN_SECONDS.fire);
  run(state, 2.5);
  assert.equal(player.health, 17, 'hits at 0, 1 and 2 s');
  assert.ok(playerView(state, 'p0').burning! > 100);
  assert.ok(publicView(state).players[0]!.flags & PF.BURNING);
  run(state, 6);
  assert.equal(player.fire, 0);
  assert.equal(player.health, 12, 'eight hits over eight seconds');
  assert.equal(playerView(state, 'p0').burning, undefined);
  igniteEntity(state, player, BURN_SECONDS.lava);
  writeCell(state, X, 64, Z, B.water);
  run(state, 0.05);
  assert.equal(player.fire, 0, 'water extinguishes');
  assert.ok(state.fx.some(entry => entry.fx.k === 'fizz'));
});

test('lava: 4 damage every half second and 15 s of burning; fire blocks set you alight', () => {
  const state = game(), player = state.players[0]!;
  writeCell(state, X, 64, Z, B.lava);
  run(state, 0.6);
  assert.equal(player.health, 12, 'two lava hits in 0.6 s');
  assert.ok(player.fire > 14);
  const other = game(), burnt = other.players[0]!;
  writeCell(other, X, 64, Z, B.fire);
  run(other, 0.1);
  assert.ok(burnt.fire > 7.8 && burnt.health === 19, 'standing in fire');
  burnt.health = 1;
  run(other, 1);
  assert.ok(burnt.dead);
  assert.equal(burnt.deathMessage, 'Ada burned to death');
});

test('magma hurts 1 a second unless sneaking; creative players never burn', () => {
  const state = game(), player = state.players[0]!;
  writeCell(state, X, 63, Z, B.magma_block);
  run(state, 2.5);
  assert.equal(player.health, 17);
  player.sneaking = true;
  run(state, 3);
  assert.equal(player.health, 17);
  const creative = game('creative');
  igniteEntity(creative, creative.players[0]!, 8);
  writeCell(creative, X, 64, Z, B.lava);
  run(creative, 1);
  assert.equal(creative.players[0]!.fire, 0);
});

test('mobs burn too, but zombified piglins and ghasts are fireproof', () => {
  const state = game();
  const cow = newMob(state, MOB.cow, X + 4.5, 64, Z + 0.5), piglin = newMob(state, MOB.zombified_piglin, X - 4.5, 64, Z + 0.5);
  state.mobs.push(cow, piglin);
  igniteEntity(state, cow, 3);
  igniteEntity(state, piglin, 3);
  writeCell(state, X - 5, 64, Z, B.lava);
  assert.equal(piglin.fire, 0);
  assert.ok(publicView(state).mobs.find(m => m.id === cow.id)!.s! & MS.BURNING);
  run(state, 2.6);
  assert.ok(cow.health <= 7, `cow at ${cow.health}`);
  assert.equal(piglin.health, 20);
});

test('beds explode in the Nether; water evaporates there', () => {
  const nx = NETHER.x0 + 100, state = game('survival', [nx - 2, 64, 100]), player = state.players[0]!;
  player.inv[0] = { id: I.water_bucket, n: 1 };
  send(state, [{ t: 'use', x: nx - 3, y: 63, z: 102, face: 3 }]);
  assert.equal(cellId(state.get(nx - 3, 64, 102)), B.air, 'no water in the Nether');
  assert.deepEqual(player.inv[0], { id: I.bucket, n: 1 });
  assert.ok(state.fx.some(entry => entry.fx.k === 'fizz'));
  writeCell(state, nx + 2, 64, 100, makeCell(B.bed, 1));
  writeCell(state, nx + 3, 64, 100, makeCell(B.bed, 1 | 4));
  send(state, [{ t: 'use', x: nx + 2, y: 64, z: 100, face: 3 }]);
  assert.notEqual(cellId(state.get(nx + 2, 64, 100)), B.bed);
  assert.notEqual(cellId(state.get(nx + 3, 64, 100)), B.bed, 'both halves go');
  assert.ok(player.health < 20 && player.bed === null, 'the blast hurts and sets no spawn');
  assert.ok(state.fx.some(entry => entry.fx.k === 'explode' && entry.fx.a === 5));
  assert.equal(cellId(state.get(nx + 2, 63, 100)), B.air, 'a crater');
});
