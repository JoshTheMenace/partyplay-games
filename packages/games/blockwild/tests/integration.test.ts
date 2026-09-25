/** Cross-feature wiring: a real village end to end, worldgen containers in saves, fire and TNT, sun burning, portal facing. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { B, cellId, cellState, DOOR_OPEN, isLava } from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource } from '../src/shared/chunk';
import { inNether, SEA_LEVEL } from '../src/shared/constants';
import { cellIndex, localIndex, type Vec3 } from '../src/shared/coords';
import { I } from '../src/shared/ids';
import { MOB, validateSettings } from '../src/shared/protocol';
import { structuresNear, villagesNear } from '../src/shared/structures/index';
import { collisionBoxes } from '../src/shared/shapes';
import { generateChunk } from '../src/shared/worldgen';
import { MAX_CHESTS, openScreen } from '../src/sim/containers';
import { createState, saveSource, tickState } from '../src/sim/game';
import { newMob } from '../src/sim/mobs';
import { teleport } from '../src/sim/players';
import { tryIgnite } from '../src/sim/portals';
import { exportSave, parseSave } from '../src/sim/save';
import { openLootChest } from '../src/sim/structures';
import type { State } from '../src/sim/state';
import { playerView } from '../src/sim/views';
import { writeCell } from '../src/sim/world';

const SEED = 11;
const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: [{ id: 'p0', name: 'Ada', color: '#ff5748' }] };
const tick = (state: State, n: number) => { for (let i = 0; i < n; i++) tickState(state, new Map(), 0.05); };
const FLAT = (() => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y < 63 ? B.stone : B.grass_block;
  return chunk;
})();
const flat: ChunkSource = () => FLAT;
const flatGame = () => {
  const state = createState(ctx, validateSettings({ seed: SEED }), { source: flat, spawn: [2048, 64, 2048] });
  state.players[0]!.protectedUntil = 0;
  return state;
};
/** Every cell of a box in the real world, as [x, y, z, cell]. */
function* cells(state: State, [x0, y0, z0, x1, y1, z1]: readonly number[]) {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) yield [x, y, z, state.get(x, y, z)] as const;
}

test('a real village: open doors, a standable centre, villagers by their beds, loot once, and its furnace survives a save', () => {
  const village = structuresNear(SEED, 2056, 2040, 400).find(s => s.kind === 'village')!;
  const [cx, cy, cz] = village.center;
  const state = createState(ctx, validateSettings({ seed: SEED }), { spawn: [cx, cy, cz] }), player = state.players[0]!;
  const info = villagesNear(SEED, cx >> 4, cz >> 4)[0]!;
  assert.equal(collisionBoxes(state.get(cx, cy, cz)).length + collisionBoxes(state.get(cx, cy + 1, cz)).length, 0, 'the centre has standing room');
  assert.ok(collisionBoxes(state.get(cx, cy - 1, cz)).length > 0, 'the centre has ground');
  let doors = 0, chest: Vec3 | null = null, furnace: Vec3 | null = null;
  for (const [x, y, z, cell] of cells(state, info.bounds)) {
    if (cellId(cell) === B.oak_door) {
      doors++;
      assert.ok(cellState(cell) & DOOR_OPEN, 'village doors stand open for villagers');
    }
    if (cellId(cell) === B.chest && !chest) chest = [x, y, z];
    if (cellId(cell) === B.furnace && !furnace) furnace = [x, y, z];
    if (y > SEA_LEVEL) assert.ok(!isLava(cell), 'no lava lakes inside a village');
  }
  assert.ok(doors >= 8 && chest && furnace);
  tick(state, 60);
  const villagers = state.mobs.filter(mob => mob.t === MOB.villager);
  assert.ok(villagers.length >= 3, `${villagers.length} villagers`);
  for (const v of villagers) assert.ok(info.houses.some(h => h.bed.every((c, i) => c === v.home![i])), 'each villager belongs to a house bed');

  // The chest rolls once (as the use command does it); its loot is saved with the chest.
  openLootChest(state, ...chest);
  openScreen(state, player, 'chest', ...chest);
  openLootChest(state, ...chest);
  const loot = state.chests.get(cellIndex(...chest))!.filter(Boolean).length;
  assert.ok(loot > 0 && !(cellState(state.get(...chest)) >> 2 & 7), 'loot rolled and the loot bits cleared');
  // An unedited worldgen furnace gains state when used, and that state must load again.
  openScreen(state, player, 'furnace', ...furnace);
  state.furnaces.get(cellIndex(...furnace))!.slots[1] = { id: I.coal, n: 5 };
  const save = parseSave(JSON.parse(JSON.stringify(exportSave(saveSource(state)))));
  const loaded = createState(ctx, save.settings, { save, spawn: [cx, cy, cz] });
  assert.deepEqual(loaded.furnaces.get(cellIndex(...furnace))!.slots[1], { id: I.coal, n: 5 });
  assert.equal(loaded.chests.get(cellIndex(...chest))!.filter(Boolean).length, loot);
  assert.equal(loaded.mobs.filter(mob => mob.t === MOB.villager).length, villagers.length, 'villagers load back');
});

test('generated chests past the save cap stay shut instead of growing an unloadable save', () => {
  const state = flatGame(), player = state.players[0]!;
  for (let i = 0; i < MAX_CHESTS; i++) state.chests.set(-1 - i, []);
  writeCell(state, 2050, 64, 2048, B.chest);
  openScreen(state, player, 'chest', 2050, 64, 2048);
  assert.equal(player.screen, null);
  assert.equal(state.chests.size, MAX_CHESTS);
  assert.match(player.toast!.text, /too many chests/);
});

test('fire primes the TNT it touches', () => {
  const state = flatGame();
  writeCell(state, 2052, 64, 2048, B.tnt);
  writeCell(state, 2053, 64, 2048, B.fire);
  tick(state, 1);
  assert.equal(cellId(state.get(2052, 64, 2048)), B.air);
  assert.ok(state.mobs.some(mob => mob.t === MOB.tnt));
});

test('sunlit zombies catch fire on the shared burning timer and keep burning into shade', () => {
  const state = flatGame(), zombie = newMob(state, MOB.zombie, 2060.5, 64, 2048.5);
  state.time = 6000;
  state.mobs.push(zombie);
  tick(state, 21);
  assert.ok(zombie.fire > 7, 'set burning for 8 s');
  writeCell(state, 2060, 66, 2048, B.stone);
  tick(state, 40);
  assert.ok(zombie.fire > 0 && zombie.health < 20, 'still burning under a roof');
});

test('a teleport with a yaw turns the client view (portal arrivals face out of the portal)', () => {
  const state = flatGame(), player = state.players[0]!;
  teleport(state, player, 2050, 64, 2050, 1.5708);
  assert.deepEqual(playerView(state, 'p0').tp, { n: player.tp.n, x: 2050, y: 64, z: 2050, yaw: 1.571 });
  teleport(state, player, 2051, 64, 2050);
  assert.equal(playerView(state, 'p0').tp.yaw, undefined);
});

test('portal arrivals face the side with more room, not a wall two blocks away', () => {
  const state = flatGame(), player = state.players[0]!;
  // A lit 2 × 3 portal (plane along X) with its interior bottom-left at (x, 64, z).
  const portal = (x: number, z: number) => {
    for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) if (i === -1 || i === 2 || j === -1 || j === 3) writeCell(state, x + i, 64 + j, z, B.obsidian);
    assert.ok(tryIgnite(state, x, 64, z));
  };
  portal(2048, 2052);
  portal(3840, 256);
  for (let x = 3837; x <= 3844; x++) for (const y of [64, 65]) writeCell(state, x, y, 258, B.stone);
  Object.assign(player, { x: 2049, y: 64, z: 2052.5 });
  tick(state, 100);
  assert.ok(inNether(player.x, player.z));
  assert.equal(player.tp.yaw, 0, 'faces −z, away from the wall at +2');
});

test('lava lakes never land inside villages or desert temples', () => {
  for (const s of structuresNear(SEED, 2048, 2048, 1200).filter(s => s.kind !== 'mineshaft')) {
    const [x0, , z0, x1, , z1] = s.bounds;
    for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) {
      const chunk = generateChunk(SEED, cx, cz);
      for (let y = SEA_LEVEL + 1; y < 110; y++) for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const x = cx * 16 + lx, z = cz * 16 + lz;
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1) assert.ok(!isLava(chunk[localIndex(lx, y, lz)]!), `${s.kind} at ${s.center} has lava at ${x},${y},${z}`);
      }
    }
  }
});
