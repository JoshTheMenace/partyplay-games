import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_SAVE_BYTES } from '../../../party-contract/src/index';
import { assertSerializable } from '../../../party-contract/src/serializable';
import rules from '../src/server';
import { B, makeCell } from '../src/shared/blocks';
import { EDIT_BYTES, EDIT_LIMIT } from '../src/shared/constants';
import { CHUNK_CELLS } from '../src/shared/chunk';
import { cellIndex } from '../src/shared/coords';
import { emptySlots } from '../src/shared/inventory';
import { I, type Slot } from '../src/shared/items';
import { MOB, validateSettings } from '../src/shared/protocol';
import { MAX_CHESTS, MAX_FURNACES } from '../src/sim/containers';
import { createState, saveSource } from '../src/sim/game';
import { newMob } from '../src/sim/mobs';
import { packEdits, unpackEdits as unpackJournal } from '../src/sim/journal';
import { exportSave, MAX_SAVED_ANIMALS, MAX_SAVED_PLAYERS, MAX_SAVED_VILLAGERS, OLD_SAVE_MESSAGE, parseSave, unpackEdits, type SaveSource } from '../src/sim/save';
import type { State } from '../src/sim/state';
import { writeCell } from '../src/sim/world';

const ctx = (names: string[]) => ({ roomId: 'room', roundId: 'round', seed: 3, nowMs: 0, players: names.map((name, i) => ({ id: `p${i}`, name, color: '#28c6e7' })) });
const damaged = (id: number, d: number): Slot => ({ id, n: 1, d });

const FLAT = new Uint16Array(CHUNK_CELLS).fill(B.stone, 0, 16 * 16 * 64);
const blank = () => createState(ctx(['Ada']), validateSettings({ seed: 5 }), { source: () => FLAT, spawn: [2048, 64, 2048] });
/** Write cells until the building limit refuses one (a refusal right after a measurement is final); returns how many went in. */
function fill(state: State, cell: (i: number) => [number, number, number, number]): number {
  for (let i = 0, refused = false; ; i++) {
    if (writeCell(state, ...cell(i))) { refused = false; continue; }
    if (refused) return state.world.edits.size;
    // The limit is an allowance from the last measurement: let it measure again and try this cell once more.
    refused = true;
    state.clock += 2;
    i--;
  }
}

test('the journal limit follows the packed size: scattered cells stop early, tidy building reaches the cell limit', () => {
  // The worst journal: single cells scattered over the whole world, each a different block (seven raw bytes apiece).
  const worst = blank(), blocks = [B.stone, B.dirt, B.cobblestone, B.oak_planks, B.bricks, B.sandstone, B.terracotta, B.obsidian, B.glass, B.iron_block, B.gold_block, B.coal_block, B.quartz_block, B.end_stone, B.netherrack, B.bookshelf];
  let seed = 12345;
  const random = () => (seed = Math.imul(seed, 1103515245) + 12345 >>> 0) / 2 ** 32;
  const scattered = fill(worst, () => [Math.floor(random() * 4096), 64 + Math.floor(random() * 64), Math.floor(random() * 4096), blocks[Math.floor(random() * 16)]!]);
  const packed = packEdits(worst.world.edits).length;
  console.log(`scattered journal: ${scattered} edits in ${(packed / 1024).toFixed(1)} KiB packed`);
  assert.ok(scattered >= 16384, `any 16,384 edits fit (${scattered})`);
  assert.ok(scattered < EDIT_LIMIT && packed <= EDIT_BYTES, `${packed} bytes`);
  assert.deepEqual([...unpackJournal(packEdits(worst.world.edits))].sort(([a], [b]) => a - b), [...worst.world.edits].sort(([a], [b]) => a - b), 'packing round-trips');
  // What people build: walls, floors and tunnels are runs of the same block.
  const tidy = blank(), built = fill(tidy, i => [2000 + i % 64, 64 + Math.floor(i / 4096), 2000 + Math.floor(i / 64) % 64, i % 4096 < 2048 ? B.oak_planks : B.cobblestone]);
  console.log(`tidy journal: ${built} edits in ${(packEdits(tidy.world.edits).length / 1024).toFixed(1)} KiB packed`);
  assert.equal(built, EDIT_LIMIT);
});

test('the worst legal save stays under 256 KiB and loads back', () => {
  // The fullest journal the limit allows, with chests and furnaces on its first cells.
  const state = blank(), edits = state.world.edits;
  let seed = 99;
  const random = () => (seed = Math.imul(seed, 1103515245) + 12345 >>> 0) / 2 ** 32;
  const count = fill(state, i => [Math.floor(random() * 4096), 64 + Math.floor(random() * 64), Math.floor(random() * 4096), makeCell(i < MAX_CHESTS ? B.chest : i < MAX_CHESTS + MAX_FURNACES ? B.furnace_lit : B.stone_brick_stairs, i % 8)]);
  const chests = [...edits].filter(([, value]) => (value & 255) === B.chest).map(([index]) => index), furnaces = [...edits].filter(([, value]) => (value & 255) === B.furnace_lit).map(([index]) => index);
  assert.deepEqual([chests.length, furnaces.length], [MAX_CHESTS, MAX_FURNACES]);
  // Sixteen characters of three bytes each: the longest name a room hands out.
  const big = 999999999, name = (i: number) => `${'\u4e16'.repeat(14)}${String(i).padStart(2, '0')}`;
  const fullSlots = (n: number) => Array.from({ length: n }, (_, i) => damaged(I.diamond_pickaxe + (i % 5), 1000 + i));
  const players = Array.from({ length: MAX_SAVED_PLAYERS }, (_, i) => ({
    name: name(i), x: 4095.99, y: 127.99, z: 4095.99, yaw: -3.141, pitch: -1.571, health: 19.5, food: 19, saturation: 19.99,
    inv: fullSlots(36), armor: [I.diamond_helmet, I.diamond_chestplate, I.diamond_leggings, I.diamond_boots].map(id => damaged(id, 360)), bed: [4095, 127, 4095] as [number, number, number],
    stats: { mined: big, placed: big, crafted: big, mobs: big, deaths: big, distance: big }, milestones: 2 ** 30,
  }));
  // Every other chunk populated: the bitset that deflates worst is not the full one.
  const source: SaveSource = {
    settings: validateSettings({ seed: 999999, mode: 'creative', difficulty: 'peaceful', keepInventory: false }), worldId: `999999-${'z'.repeat(57)}`, time: 23999, day: big, edits, players,
    chests: new Map(chests.map(i => [i, fullSlots(27)])),
    furnaces: new Map(furnaces.map(i => [i, { slots: [{ id: B.iron_ore, n: 64 }, { id: B.coal_block, n: 64 }, { id: I.iron_ingot, n: 64 }], burn: 799.99, burnMax: 800, cook: 9.99 }])),
    animals: Array.from({ length: MAX_SAVED_ANIMALS }, (_, i) => ({ t: MOB.sheep, x: 4095.99 - i, y: 127.99, z: 4095.99, s: 3 })),
    villagers: Array.from({ length: MAX_SAVED_VILLAGERS }, (_, i) => ({ x: 4095.99 - i, y: 127.99, z: 4095.99, p: 4, home: [4095, 127, 4095 - i] as [number, number, number], uses: Array(8).fill(999999), seed: 2 ** 31 - 1 - i })),
    populated: new Set(Array.from({ length: 65536 }, (_, i) => i).filter(() => random() < 0.5)), stats: { mined: big, placed: big, crafted: big, mobs: big, deaths: big, days: big, dragons: big },
    end: { dragon: 'alive', health: 199.99, crystals: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], portalActive: true, egg: true },
    victory: { day: big, tick: 23999, by: players.map(player => player.name) }, pearlPity: 999999,
  };
  const save = exportSave(source), json = JSON.stringify(save), bytes = Buffer.byteLength(json);
  console.log(`worst-case save: ${(bytes / 1024).toFixed(1)} KiB with ${count} scattered edits and ${MAX_SAVED_PLAYERS} players`);
  assert.ok(bytes < MAX_SAVE_BYTES, `${bytes} bytes`);
  assertSerializable(save);
  const parsed = parseSave(JSON.parse(json));
  assert.equal(parsed.edits.size, count);
  assert.equal(parsed.players.length, MAX_SAVED_PLAYERS);
  assert.equal(parsed.chests.size, MAX_CHESTS);
  assert.equal(parsed.villagers.length, MAX_SAVED_VILLAGERS);
  assert.equal(parsed.victory!.by.length, MAX_SAVED_PLAYERS);
  assert.deepEqual(parsed.players.at(-1)!.armor[3], damaged(I.diamond_boots, 360));
  assert.deepEqual(parsed.chests.get(chests[0]!)![26], damaged(I.diamond_pickaxe + 1, 1026));
});

test('a world saved by version 10 (before this format) still loads with everything in it', async () => {
  const { readFileSync } = await import('node:fs'), old = JSON.parse(readFileSync(new URL('./fixtures/v10-save.json', import.meta.url), 'utf8'));
  assert.equal(old.version, 10);
  const loaded = rules.loadSave!(ctx(['Host', 'Pocket Explorer']), old, validateSettings({})).state;
  assert.deepEqual([loaded.settings.seed, Math.floor(loaded.time), loaded.world.edits.size], [11, 18000, 16]);
  assert.deepEqual(loaded.players.map(player => player.inv[0]), [{ id: B.torch, n: 32 }, { id: I.diamond_pickaxe, n: 1 }]);
  assert.equal(loaded.mobs.filter(mob => mob.t <= MOB.chicken && mob.t >= MOB.cow).length, 6, 'its animals come along');
  assert.equal((rules.exportSave!(loaded) as { version: number }).version, 11, 'and it saves in the new format');
});

/** A world with some history: edits, containers, a bed, animals, inventories and stats. */
function playedWorld(): State {
  const state = rules.create(ctx(['Ada', 'Bo', 'Cy']), validateSettings({ seed: 4242, keepInventory: false }));
  const [x, y, z] = state.spawn.map(Math.floor) as [number, number, number];
  writeCell(state, x + 3, y, z, B.chest);
  writeCell(state, x + 3, y, z + 1, B.furnace);
  writeCell(state, x + 3, y + 1, z + 1, B.torch);
  writeCell(state, x - 3, y, z, makeCell(B.bed, 2));
  writeCell(state, x - 3, y, z + 1, makeCell(B.bed, 6));
  state.chests.set(cellIndex(x + 3, y, z), Object.assign(emptySlots(27), { 4: { id: B.oak_log, n: 12 }, 26: damaged(I.iron_sword, 17) }));
  state.furnaces.set(cellIndex(x + 3, y, z + 1), { slots: [{ id: B.sand, n: 5 }, { id: I.coal, n: 3 }, { id: B.glass, n: 2 }], burn: 41.5, burnMax: 80, cook: 3.25 });
  const [ada, bo] = state.players as [State['players'][number], State['players'][number]];
  ada.inv[0] = damaged(I.stone_pickaxe, 30);
  ada.inv[8] = { id: B.torch, n: 33 };
  Object.assign(ada, { health: 14, food: 11, saturation: 2.5, bed: [x - 3, y, z], milestones: 5, yaw: 1.234, pitch: -0.5 });
  ada.stats.mined = 40;
  bo.inv[20] = { id: I.bread, n: 3 };
  const lamb = newMob(state, MOB.sheep, x + 5.25, y, z + 2.5, true);
  lamb.sheared = true;
  state.mobs.push(lamb, newMob(state, MOB.cow, x - 5.5, y, z - 4.5), newMob(state, MOB.zombie, x, y, z + 9));
  Object.assign(state, { time: 13555, day: 4 });
  state.stats.mined = 40;
  return state;
}

test('saves round-trip exactly and loading never touches the live world', () => {
  const live = playedWorld(), save = rules.exportSave!(live), snapshot = JSON.stringify(save);
  assert.equal(typeof save, 'object');
  const { state, settings } = rules.loadSave!(ctx(['Ada', 'Bo', 'Cy']), JSON.parse(snapshot), validateSettings({}));
  assert.equal(settings.seed, 4242);
  assert.equal(settings.keepInventory, false);
  assert.deepEqual(rules.exportSave!(state), JSON.parse(snapshot), 'export → load → export is stable');
  const sorted = (edits: Map<number, number>) => [...edits].sort((a, b) => a[0] - b[0]);
  assert.deepEqual(sorted(state.world.edits), sorted(live.world.edits));
  assert.deepEqual(state.players[0]!.inv, live.players[0]!.inv);
  assert.equal(state.players[0]!.health, 14);
  assert.deepEqual(state.players[0]!.bed, live.players[0]!.bed);
  assert.equal(state.mobs.length, 2, 'animals persist, monsters do not');
  assert.ok(state.lights.size > 0, 'loaded torches are indexed as light sources');
  // Mutating the loaded world leaves the live one alone.
  state.players[0]!.inv[0] = null;
  state.chests.clear();
  writeCell(state, 100, 100, 100, B.stone);
  assert.equal(JSON.stringify(rules.exportSave!(live)), snapshot);
});

test('loading visits saved edits chunk by chunk, so each chunk generates once even past the cache size', () => {
  // 700 chunks (more than the 640-chunk cache) with an edit on each of 3 levels: y-first order would regenerate most of them.
  const edits = new Map<number, number>();
  for (let i = 0; i < 700; i++) for (let y = 70; y < 73; y++) edits.set(cellIndex(1600 + (i % 28) * 16, y, 1600 + Math.floor(i / 28) * 16), B.cobblestone);
  const live = rules.create(ctx(['Ada']), validateSettings({ seed: 5 })), source = { ...saveSource(live), edits };
  const save = parseSave(JSON.parse(JSON.stringify(exportSave(source))));
  let generated = 0;
  createState(ctx(['Ada']), save.settings, { save, source: () => { generated++; return new Uint16Array(CHUNK_CELLS); }, spawn: [2048, 64, 2048] });
  assert.ok(generated <= 700 + 50, `${generated} chunk generations for 700 edited chunks`);
});

test('stacks held on the cursor or in the crafting grid are saved in the inventory', () => {
  const live = rules.create(ctx(['Ada']), validateSettings({})), player = live.players[0]!;
  player.inv[0] = { id: B.oak_log, n: 1 };
  player.cursor = { id: B.oak_log, n: 8 };
  player.grid = [null, { id: I.diamond, n: 5 }, null, null];
  const loaded = rules.loadSave!(ctx(['Ada']), rules.exportSave!(live), validateSettings({})).state.players[0]!;
  assert.deepEqual(loaded.inv.slice(0, 2), [{ id: B.oak_log, n: 9 }, { id: I.diamond, n: 5 }]);
  assert.deepEqual([player.inv[0], player.cursor, player.grid[1]], [{ id: B.oak_log, n: 1 }, { id: B.oak_log, n: 8 }, { id: I.diamond, n: 5 }], 'live state untouched');
});

test('random worlds save their real seed and a stable world id', () => {
  const live = rules.create({ ...ctx(['Ada']), seed: 123456789, nowMs: 1_790_000_000_000 }, validateSettings({}));
  const save = rules.exportSave!(live) as { seed: number; worldId: string };
  assert.equal(save.seed, 123456789 % 999999 + 1);
  assert.equal(save.worldId, `${save.seed}-${(1_790_000_000_000).toString(36)}`);
  const loaded = rules.loadSave!({ ...ctx(['Ada']), seed: 99, nowMs: 5 }, save, validateSettings({}));
  assert.equal(loaded.settings.seed, save.seed, 'loading returns the real seed');
  assert.equal(rules.publicView(loaded.state, { nowMs: 5, phase: 'playing' }).worldId, save.worldId);
  const { worldId: _, ...older } = save;
  assert.equal(parseSave(older).worldId, String(save.seed), 'saves without an id derive one from the seed');
  assert.throws(() => parseSave({ ...save, worldId: 'Bad id!' }), /damaged \(settings\)/);
});

test('players match by unique name; absent players are remembered for next time', () => {
  const save = rules.exportSave!(playedWorld());
  const { state } = rules.loadSave!(ctx(['Bo', 'Newcomer']), save, validateSettings({}));
  assert.deepEqual(state.players[0]!.inv[20], { id: I.bread, n: 3 });
  assert.ok(state.players[1]!.inv.every(slot => !slot), 'unmatched players start fresh');
  const again = rules.exportSave!(state) as { players: { name: string; inv: unknown[] }[] };
  assert.deepEqual(again.players.map(p => p.name), ['Bo', 'Newcomer', 'Ada', 'Cy']);
  const back = rules.loadSave!(ctx(['Ada']), again, validateSettings({})).state;
  assert.deepEqual(back.players[0]!.inv[0], damaged(I.stone_pickaxe, 30));
  // Duplicate names in the room cannot claim a saved player.
  const twins = rules.loadSave!(ctx(['Ada', 'Ada']), save, validateSettings({})).state;
  assert.ok(twins.players.every(p => p.inv.every(slot => !slot)));
});

test('old, foreign, future and damaged saves are rejected with clear messages', () => {
  const load = (raw: unknown) => () => rules.loadSave!(ctx(['Ada']), raw, validateSettings({}));
  for (const version of [1, 2, 7, 8, undefined]) assert.throws(load({ format: 'blockwild', version, seed: 5 }), { message: OLD_SAVE_MESSAGE });
  assert.equal(OLD_SAVE_MESSAGE, 'This world was made with the previous version of Blockwild and cannot be loaded.');
  assert.throws(load({ format: 'kart', version: 8 }), /not a Blockwild world/);
  assert.throws(load(null), /not a Blockwild world/);
  assert.throws(load({ format: 'blockwild', version: 12 }), /newer version/);
  const good = rules.exportSave!(playedWorld()) as Record<string, unknown>;
  const broken = (patch: Record<string, unknown>) => load({ ...good, ...patch });
  assert.throws(broken({ edits: 'AAAA' }), /damaged \(edits\)/);
  assert.throws(broken({ edits: Buffer.from(new Uint8Array([255, 255, 255, 255, 1, 0])).toString('base64') }), /damaged \(edits\)/);
  assert.throws(broken({ time: -1 }), /damaged \(time\)/);
  assert.throws(broken({ players: [{ ...(good.players as object[])[0], inv: [[0, 99999, 1]] }] }), /damaged \(inventory\)/);
  assert.throws(broken({ players: [{ ...(good.players as object[])[0], inv: [[0, B.dirt, 65]] }] }), /damaged \(inventory\)/);
  const edited = [...unpackEdits(good.edits as string)].find(([, value]) => value !== B.chest)![0];
  assert.throws(broken({ chests: [{ i: edited, slots: [] }] }), /damaged \(chests\)/, 'chest records on edits must sit on a chest');
  assert.doesNotThrow(broken({ chests: [{ i: 5, slots: [] }] }), 'unedited cells may be worldgen chests (createState checks the terrain)');
  assert.throws(broken({ animals: [{ t: MOB.creeper, x: 1, y: 70, z: 1, s: 0 }] }), /damaged \(animals\)/);
  assert.throws(broken({ seed: 0 }), /damaged \(settings\)/);
  assert.doesNotThrow(load(good));
});
