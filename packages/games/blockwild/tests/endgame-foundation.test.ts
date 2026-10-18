/** Endgame foundation (DESIGN.md): ids, blocks, shapes, placement, recipes, the void, protocol, loot registry, save v10 and v9 terrain. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MAX_SAVE_BYTES } from '../../../party-contract/src/index';
import { fillRegion, newRegion, RA, RX } from '../src/client/engine/light';
import { S_AIR, S_END_FRAME, S_FENCE, S_PANE, SHAPE } from '../src/client/engine/tables';
import { ClientWorld } from '../src/client/engine/world';
import { assertSerializable } from '../../../party-contract/src/serializable';
import {
  B, BLOCKS, blockOf, cellState, CHEST_LOOT, chestLoot, DAYLIGHT_INVERTED, faceTexture, FRAME_EYE, isFullCube, isOpaque, lightOf, makeCell, OBSERVER_POWERED, TEXTURE_KEYS,
} from '../src/shared/blocks';
import { CHUNK_CELLS, outsideCell, VoxelWorld, type ChunkSource, type World } from '../src/shared/chunk';
import { dimensionAt, END, END_ARRIVAL, END_CENTER, HEIGHT, inEnd, NETHER, VOID_Y } from '../src/shared/constants';
import { localIndex } from '../src/shared/coords';
import { I } from '../src/shared/ids';
import { SMELTING } from '../src/shared/inventory';
import { itemOf } from '../src/shared/items';
import { LOOT, lootName, lootSeed, rollLoot } from '../src/shared/loot';
import { breakTime, drops, isBreakable } from '../src/shared/mining';
import { newBody, stepBody } from '../src/shared/physics';
import { canSurvive, fenceState, isThrown, placementFor, usesBlock } from '../src/shared/placement';
import { DRAGON_HEAD, DRAGON_PARTS, FX_KINDS, MOB, MOB_TYPES, mobBox, mobBoxes, parseCmd, parseInput, PK, validateSettings, type CmdBody, type Input } from '../src/shared/protocol';
import { craftFromInventory, RECIPES } from '../src/shared/recipes';
import { collisionBoxes, selectionBoxes } from '../src/shared/shapes';
import { fortressesOf } from '../src/shared/structures/fortress';
import { strongholdsOf } from '../src/shared/structures/stronghold';
import { generateChunk } from '../src/shared/worldgen';
import { killMob } from '../src/sim/combat';
import { createState, saveSource, tickState } from '../src/sim/game';
import { newMob } from '../src/sim/mobs';
import { exportSave, parseSave, type SaveSource } from '../src/sim/save';
import type { Player, State } from '../src/sim/state';
import { outcome, playerView, publicView } from '../src/sim/views';
import { writeCell } from '../src/sim/world';

// Helpers ------------------------------------------------------------------------------------------------------------

/** Stone below y = 64, air above, plus overrides keyed "x,y,z". */
const world = (overrides: Record<string, number> = {}): World => ({ getCell: (x, y, z) => overrides[`${x},${y},${z}`] ?? (y < 64 ? B.stone : B.air) });
const FLAT = (() => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < 63 ? B.stone : B.grass_block;
  return chunk;
})();
const flat: ChunkSource = () => FLAT;
const X = 2048, Z = 2048;
const ctx = (names = ['Ada']) => ({ roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: names.map((name, i) => ({ id: `p${i}`, name, color: '#ff5748' })) });
function game(spawn: [number, number, number] = [X, 64, Z], names?: string[]): State {
  const state = createState(ctx(names), validateSettings({ seed: 11 }), { source: flat, spawn });
  for (const player of state.players) player.protectedUntil = 0;
  return state;
}
const hold = (player: Player, cmds: CmdBody[]): Input =>
  ({ p: [player.x, player.y, player.z], v: [0, 0, 0], yaw: player.yaw, pitch: player.pitch, f: 1, slot: player.slot, mine: null, tpAck: player.tp.n, cmds: cmds.map((c, i) => ({ n: player.ack + 1 + i, ...c }) as Input['cmds'][number]) });
const send = (state: State, cmds: CmdBody[]) => tickState(state, new Map([['p0', hold(state.players[0]!, cmds)]]), 0.05);
const fnv = (cells: Uint16Array) => {
  let h = 0x811c9dc5;
  for (const v of cells) {
    h = Math.imul(h ^ (v & 255), 0x01000193);
    h = Math.imul(h ^ (v >> 8), 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

// Ids and blocks -----------------------------------------------------------------------------------------------------

test('ids: endgame blocks 121–145, items 348–353 and mobs 12–16 are fixed; older ids unchanged', () => {
  const blocks = ['nether_brick_fence', 'nether_brick_stairs', 'nether_brick_slab', 'nether_wart', 'end_stone', 'end_stone_bricks', 'end_portal_frame', 'end_portal',
    'dragon_egg', 'iron_bars', 'quartz_pillar', 'chiseled_quartz_block', 'quartz_stairs', 'quartz_slab', 'smooth_quartz', 'quartz_bricks', 'observer', 'daylight_detector',
    'purpur_block', 'purpur_pillar', 'silverfish_stone', 'cracked_end_stone_bricks', 'soul_torch', 'soul_lantern', 'chiseled_stone_bricks'] as const;
  blocks.forEach((name, i) => assert.equal(B[name], 121 + i, name));
  (['blaze_rod', 'blaze_powder', 'ender_pearl', 'ender_eye', 'nether_wart', 'end_crystal'] as const).forEach((name, i) => assert.equal(I[name], 348 + i, name));
  assert.deepEqual(MOB_TYPES.slice(12).map(m => [m.key, MOB[m.key], m.kind]), [
    ['blaze', 12, 'monster'], ['enderman', 13, 'monster'], ['ender_dragon', 14, 'boss'], ['end_crystal', 15, 'object'], ['silverfish', 16, 'monster'],
  ]);
  assert.deepEqual([B.redstone_block, I.diamond_boots, MOB.tnt, B.barrier], [120, 347, 11, 255]);
  assert.equal(new Set(Object.values(B)).size, Object.keys(B).length);
  assert.equal(new Set(Object.values(I)).size, Object.keys(I).length);
  for (const kind of ['eye', 'shatter', 'portalOpen', 'dragonDeath', 'acid', 'crystal', 'pearl', 'blazeShoot', 'scream', 'teleport', 'observer'] as const) assert.ok(FX_KINDS.includes(kind), kind);
  assert.deepEqual(Object.values(PK), [0, 1, 2, 3, 4, 5]);
});

test('new blocks: hardness, tools, drops, light, render and textures', () => {
  for (let id = 121; id <= 145; id++) {
    const block = BLOCKS[id]!;
    assert.ok(block && block.label, `block ${id}`);
    if (block.render !== 'none') for (let face = 0; face < 6; face++) assert.ok(TEXTURE_KEYS.includes(faceTexture(id, face)), `${block.name} face ${face}`);
  }
  const rand = () => 0.5;
  assert.equal(blockOf(B.end_portal_frame).hardness, -1);
  assert.equal(blockOf(B.end_portal).solid, false);
  assert.equal(blockOf(B.end_portal).targetable, false);
  assert.equal(breakTime(B.end_portal_frame, I.diamond_pickaxe, true, false), Infinity);
  assert.deepEqual([isBreakable(B.end_portal_frame, false), isBreakable(B.end_portal_frame, true), isBreakable(B.bedrock, true), isBreakable(B.stone, false)], [false, true, false, true]);
  assert.deepEqual(drops(B.end_stone, 0, rand), [], 'end stone needs a pickaxe');
  assert.deepEqual(drops(B.end_stone, I.wooden_pickaxe, rand), [{ id: B.end_stone, n: 1 }]);
  assert.deepEqual(drops(B.dragon_egg, 0, rand), [{ id: B.dragon_egg, n: 1 }], 'the egg is a trophy anyone can take');
  assert.deepEqual(drops(B.silverfish_stone, I.diamond_pickaxe, rand), []);
  assert.ok(breakTime(B.silverfish_stone, 0, true, false) < 0.5, 'infested bricks crumble almost at once');
  assert.equal(faceTexture(B.silverfish_stone, 4), faceTexture(B.stone_bricks, 4), 'infested bricks look exactly like stone bricks');
  assert.deepEqual(drops(makeCell(B.nether_wart, 2), 0, () => 0), [{ id: I.nether_wart, n: 1 }]);
  assert.deepEqual(drops(makeCell(B.nether_wart, 3), 0, () => 0.99), [{ id: I.nether_wart, n: 4 }]);
  assert.deepEqual([lightOf(B.end_portal_frame), lightOf(makeCell(B.end_portal_frame, FRAME_EYE)), lightOf(B.end_portal), lightOf(B.soul_torch), lightOf(B.soul_lantern)], [1, 3, 15, 10, 10]);
  assert.ok(isOpaque(B.observer) && isFullCube(B.observer), 'observers are full, solid cubes');
  assert.equal(blockOf(B.iron_bars).render, 'cutout');
  assert.notEqual(faceTexture(makeCell(B.end_portal_frame, FRAME_EYE), 3), faceTexture(B.end_portal_frame, 3));
  assert.notEqual(faceTexture(makeCell(B.daylight_detector, DAYLIGHT_INVERTED), 3), faceTexture(B.daylight_detector, 3));
  // Observer: bits 0–2 = the watching face; the back shows whether it is pulsing.
  assert.equal(faceTexture(makeCell(B.observer, 4), 4), 'observer_front');
  assert.equal(faceTexture(makeCell(B.observer, 4), 5), 'observer_back');
  assert.equal(faceTexture(makeCell(B.observer, 4 | OBSERVER_POWERED), 5), 'observer_back_on');
  assert.equal(faceTexture(makeCell(B.quartz_pillar, 1), 0), 'quartz_pillar_top', 'pillars follow their axis like logs');
  assert.equal(itemOf(I.ender_pearl)!.stack, 16);
  assert.equal(itemOf(B.end_portal)?.hidden, true);
  assert.equal(itemOf(I.nether_wart)!.places, B.nether_wart);
  // Chest loot bits widen to 2–5; tables 1–5 keep their bits.
  assert.deepEqual(CHEST_LOOT, { none: 0, village_house: 1, village_smith: 2, desert_temple: 3, mineshaft: 4, dungeon: 5, nether_fortress: 6, stronghold_corridor: 7, stronghold_library: 8 });
  assert.equal(chestLoot(3 | 8 << 2), 8);
  assert.equal(chestLoot(2 | 5 << 2), 5);
});

// Shapes and placement -----------------------------------------------------------------------------------------------

test('panes and nether brick fences store connections and collide per arm', () => {
  const at = (id: number) => ({ '10,64,10': id, '10,64,9': B.iron_bars, '11,64,10': B.stone, '9,64,10': B.oak_fence, '10,64,11': B.nether_brick_fence });
  // Iron bars join bars and full blocks, not fences; nether brick fences join their own kind, never oak fences.
  assert.equal(fenceState(world(at(B.iron_bars)), 10, 64, 10, B.iron_bars), 0b0011);
  assert.equal(fenceState(world(at(B.nether_brick_fence)), 10, 64, 10, B.nether_brick_fence), 0b0110);
  assert.equal(fenceState(world(at(B.oak_fence)), 10, 64, 10, B.oak_fence), 0b1010);
  // An unconnected pane is a 2/16 post; each arm adds a 2/16-thick box reaching its edge; one block tall.
  assert.deepEqual(collisionBoxes(B.iron_bars), [[7 / 16, 0, 7 / 16, 9 / 16, 1, 9 / 16]]);
  const ns = collisionBoxes(makeCell(B.iron_bars, 0b0101));
  assert.equal(ns.length, 3);
  assert.ok(ns.every(box => box[0] === 7 / 16 && box[3] === 9 / 16 && box[4] === 1), 'north–south bars stay 2/16 thick');
  assert.ok(ns.some(box => box[2] === 0) && ns.some(box => box[5] === 1));
  assert.equal(Math.max(...collisionBoxes(makeCell(B.nether_brick_fence, 0b1111)).map(box => box[4])), 1.5, 'nether brick fences block jumps like oak');
  assert.equal(selectionBoxes(makeCell(B.iron_bars, 0b0010)).length, 2);
  // Placing bars joins them and re-connects the bars beside them.
  const writes = placementFor(world({ '10,64,9': makeCell(B.iron_bars, 0), '10,63,10': B.stone }), B.iron_bars, { x: 10, y: 63, z: 10, face: 3 }, 0)!;
  assert.deepEqual(writes, [[10, 64, 10, makeCell(B.iron_bars, 0b0001)], [10, 64, 9, makeCell(B.iron_bars, 0b0100)]]);
  // Frames, eggs, daylight detectors and portals have their own boxes.
  assert.deepEqual(collisionBoxes(B.end_portal_frame).map(box => box[4]), [13 / 16]);
  assert.deepEqual(collisionBoxes(makeCell(B.end_portal_frame, FRAME_EYE)).map(box => box[4]), [13 / 16, 1]);
  assert.deepEqual(collisionBoxes(B.end_portal), [], 'the portal is not solid');
  assert.equal(selectionBoxes(B.end_portal)[0]![4], 12 / 16);
  assert.deepEqual(collisionBoxes(B.daylight_detector), [[0, 0, 0, 1, 6 / 16, 1]]);
  assert.deepEqual(collisionBoxes(B.dragon_egg), [[1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16]]);
});

test('placement: wart on soul sand, observers watch the look, pillars by axis, crystals, eyes and frames', () => {
  const soul = world({ '5,63,5': B.soul_sand });
  assert.ok(canSurvive(soul, 5, 64, 5, B.nether_wart));
  assert.ok(!canSurvive(world(), 5, 64, 5, B.nether_wart), 'not on stone');
  assert.deepEqual(placementFor(soul, I.nether_wart, { x: 5, y: 63, z: 5, face: 3 }, 0), [[5, 64, 5, B.nether_wart]]);
  assert.equal(placementFor(world({ '5,63,5': B.farmland }), I.nether_wart, { x: 5, y: 63, z: 5, face: 3 }, 0), null);
  const place = (item: number, yaw: number, pitch = 0, face = 3) => cellState(placementFor(world({ '6,63,5': B.air }), item, { x: 5, y: 63, z: 5, face }, yaw, pitch)![0]![3]);
  // Observers face where the player looks (their back, the output, faces the player).
  assert.equal(place(B.observer, 0), 4, 'looking north it watches north (-Z)');
  assert.equal(place(B.observer, -Math.PI / 2), 1, 'looking east it watches east');
  assert.equal(place(B.observer, 0, -1.2), 2, 'looking down it watches down');
  assert.equal(place(B.observer, 0, 1.2), 3);
  assert.equal(place(B.quartz_pillar, 0, 0, 1), 1, 'a pillar on a side face lies along X');
  assert.equal(place(B.purpur_pillar, 0, 0, 3), 0);
  assert.equal(placementFor(world(), B.end_portal, { x: 5, y: 63, z: 5, face: 3 }, 0), null, 'portals come from eyes, never items');
  assert.equal(placementFor(world(), I.end_crystal, { x: 5, y: 63, z: 5, face: 3 }, 0), null, 'crystals are mobs placed by use');
  // Right-click routing: eyes into empty frames, crystals onto obsidian and bedrock, detectors toggle.
  assert.ok(usesBlock(B.end_portal_frame, I.ender_eye, false));
  assert.ok(!usesBlock(makeCell(B.end_portal_frame, FRAME_EYE), I.ender_eye, false));
  assert.ok(usesBlock(B.obsidian, I.end_crystal, false) && usesBlock(B.bedrock, I.end_crystal, true));
  assert.ok(!usesBlock(B.stone, I.end_crystal, false));
  assert.ok(usesBlock(B.daylight_detector, 0, false));
  assert.ok(isThrown(I.ender_pearl) && isThrown(I.ender_eye) && !isThrown(I.end_crystal));
});

test('recipes and smelting for the endgame', () => {
  const craft = (inv: [number, number][], id: string) => {
    const slots = Array.from({ length: 36 }, (_, i) => inv[i] ? { id: inv[i]![0], n: inv[i]![1] } : null);
    return craftFromInventory(slots, id, true) ? slots.filter(Boolean) : null;
  };
  assert.deepEqual(craft([[I.blaze_rod, 1]], 'blaze_powder'), [{ id: I.blaze_powder, n: 2 }]);
  assert.deepEqual(craft([[I.blaze_powder, 1], [I.ender_pearl, 1]], 'ender_eye'), [{ id: I.ender_eye, n: 1 }]);
  assert.deepEqual(craft([[B.glass, 7], [I.ender_eye, 1], [B.obsidian, 1]], 'end_crystal'), [{ id: I.end_crystal, n: 1 }]);
  assert.deepEqual(craft([[B.cobblestone, 6], [I.redstone, 2], [I.quartz, 1]], 'observer'), [{ id: B.observer, n: 1 }]);
  assert.deepEqual(craft([[B.glass, 3], [I.quartz, 3], [B.oak_slab, 3]], 'daylight_detector'), [{ id: B.daylight_detector, n: 1 }]);
  assert.deepEqual(craft([[B.nether_bricks, 4], [I.nether_brick, 2]], 'nether_brick_fence'), [{ id: B.nether_brick_fence, n: 6 }]);
  assert.deepEqual(craft([[B.end_stone_bricks, 8], [I.ender_pearl, 1]], 'purpur_block'), [{ id: B.purpur_block, n: 8 }]);
  assert.deepEqual(craft([[I.iron_ingot, 6]], 'iron_bars'), [{ id: B.iron_bars, n: 16 }]);
  assert.deepEqual(craft([[I.coal, 1], [I.stick, 1], [B.soul_sand, 1]], 'soul_torch'), [{ id: B.soul_torch, n: 4 }]);
  for (const [id, n] of [['quartz_pillar', 2], ['quartz_stairs', 4], ['quartz_slab', 6], ['quartz_bricks', 4]] as const) {
    assert.equal(RECIPES.find(r => r.id === id)?.out.n, n, id);
  }
  for (const id of ['nether_brick_stairs', 'nether_brick_slab', 'end_stone_bricks', 'purpur_pillar', 'chiseled_quartz_block', 'soul_lantern', 'chiseled_stone_bricks']) assert.ok(RECIPES.some(r => r.id === id), id);
  assert.equal(new Set(RECIPES.map(r => r.id)).size, RECIPES.length);
  assert.deepEqual([SMELTING.get(B.quartz_block), SMELTING.get(B.end_stone_bricks), SMELTING.get(B.netherrack)], [B.smooth_quartz, B.cracked_end_stone_bricks, I.nether_brick]);
});

// The End and the void -----------------------------------------------------------------------------------------------

test('dimensionAt and the void: below y = 0 is air only in the End, sealed at its inside faces', () => {
  assert.deepEqual([dimensionAt(2048, 2048), dimensionAt(NETHER.x0 + 5, 5), dimensionAt(END.x0 + 5, END.z0 + 5), dimensionAt(4095, 4095), dimensionAt(3583, 4000)],
    ['overworld', 'nether', 'end', 'end', 'overworld']);
  assert.ok(inEnd(END_CENTER.x, END_CENTER.z) && inEnd(END_ARRIVAL.x, END_ARRIVAL.z));
  assert.equal(outsideCell(END.x0 + 50, -1, END.z0 + 50), B.air);
  assert.equal(outsideCell(END.x0 + 50, -500, END.z0 + 50), B.air);
  assert.equal(outsideCell(END.x0, -5, END.z0 + 50), B.barrier);
  assert.equal(outsideCell(END.x0 + 50, -5, END.z0), B.barrier);
  assert.equal(outsideCell(2048, -1, 2048), B.bedrock);
  assert.equal(outsideCell(NETHER.x0 + 5, -1, 5), B.bedrock);
  assert.equal(outsideCell(END.x0 + 50, 5, END.z0 + 50), null);
  // The seal also stands above the world, so nobody pillars up and walks over it (review finding).
  assert.deepEqual([outsideCell(END.x0, HEIGHT, END.z0 + 100), outsideCell(END.x0 + 100, HEIGHT + 40, END.z0)], [B.barrier, B.barrier]);
  assert.deepEqual([outsideCell(END.x0 + 1, HEIGHT, END.z0 + 100), outsideCell(END.x0 - 1, HEIGHT, END.z0 + 100), outsideCell(2048, HEIGHT, 2048)], [B.air, B.air, B.air]);
  const voxels = new VoxelWorld(() => new Uint16Array(CHUNK_CELLS));
  assert.equal(voxels.getCell(END.x0 + 50, -1, END.z0 + 50), B.air);
  assert.equal(voxels.getCell(1000, -1, 1000), B.bedrock);
  assert.equal(voxels.setCell(END.x0 + 50, -1, END.z0 + 50, B.stone), false, 'nobody builds below the world');
  // A body over an empty column falls through y = 0 in the End and lands on bedrock elsewhere.
  const fall = (x: number, z: number) => {
    const body = newBody(x + 0.5, 3, z + 0.5);
    for (let i = 0; i < 60; i++) stepBody(body, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, flyDown: false, yaw: 0 }, 1 / 20, (cx, cy, cz) => voxels.getCell(cx, cy, cz), 'survival');
    return body.y;
  };
  assert.ok(fall(END.x0 + 50, END.z0 + 50) < VOID_Y, 'falls out of the world');
  assert.equal(fall(1000, 1000), 0);
  // Input positions may report bodies deep in the void.
  assert.equal(parseInput({ p: [END.x0 + 50, -150, END.z0 + 50] }).p[1], -150);
});

test('engine: new shapes have their own meshes; the End has no bedrock floor', () => {
  assert.deepEqual([SHAPE[B.air], SHAPE[B.iron_bars], SHAPE[B.end_portal_frame], SHAPE[B.nether_brick_fence]], [S_AIR, S_PANE, S_END_FRAME, S_FENCE]);
  const region = newRegion(), air = () => new Uint16Array(CHUNK_CELLS);
  fillRegion(region, END.x0 / 16 + 4, END.z0 / 16 + 4, air);
  assert.equal(region.cells[RX + 5], B.air, 'below y = 0 is the void');
  fillRegion(region, 128, 128, air);
  assert.equal(region.cells[RA - 1], B.bedrock);
  const client = new ClientWorld();
  assert.deepEqual([client.getCell(END.x0 + 9, -3, END.z0 + 9), client.getCell(9, -3, 9)], [B.air, B.bedrock]);
  assert.deepEqual([client.lightLevels(END.x0 + 9, -3, END.z0 + 9), client.lightLevels(9, -3, 9)], [[15, 0], [0, 0]]);
});

test('mobBoxes: one box for normal mobs; the dragon has eight parts that follow yaw and pitch', () => {
  const zombie = { t: MOB.zombie, x: 10, y: 64, z: 10, yaw: 1 };
  assert.deepEqual(mobBoxes(zombie), [mobBox(zombie)]);
  const dragon = (yaw: number, pt = 0) => mobBoxes({ t: MOB.ender_dragon, x: 100, y: 80, z: 100, yaw, pt });
  const centre = (box: readonly number[]) => [(box[0]! + box[3]!) / 2, (box[1]! + box[4]!) / 2, (box[2]! + box[5]!) / 2].map(v => Math.round(v * 100) / 100 + 0);
  const level = dragon(0);
  assert.equal(level.length, DRAGON_PARTS.length);
  assert.equal(DRAGON_PARTS[DRAGON_HEAD]!.key, 'head');
  assert.deepEqual(centre(level[2]!), [100, 82, 100], 'the body box is the mob type box');
  assert.deepEqual(level[2], mobBox({ t: MOB.ender_dragon, x: 100, y: 80, z: 100 }));
  assert.deepEqual(centre(level[0]!), [100, 82.5, 90], 'yaw 0 faces -Z');
  assert.deepEqual(centre(level[7]!), [100, 82, 110.5], 'the tail trails behind');
  assert.deepEqual(centre(level[4]!), [108, 82.75, 100], 'the right wing is east when facing north');
  const west = dragon(Math.PI / 2);
  assert.deepEqual(centre(west[0]!), [90, 82.5, 100], 'yaw π/2 faces -X');
  assert.deepEqual(centre(west[4]!), [100, 82.75, 92], 'and its right wing is north');
  const [hx, hy] = centre(dragon(0, 0.5)[0]!);
  assert.ok(hy! > 86 && hx === 100, 'pitching up raises the head');
  assert.ok(centre(dragon(0, 0.5)[7]!)[1]! < 82, 'and lowers the tail');
});

test('parseInput keeps a valid attack part and drops a bad one', () => {
  assert.deepEqual(parseCmd({ n: 1, t: 'attack', id: 5, part: 0 }), { n: 1, t: 'attack', id: 5, part: 0 });
  assert.deepEqual(parseCmd({ n: 1, t: 'attack', id: 5, part: 99 }), { n: 1, t: 'attack', id: 5 });
  assert.deepEqual(parseCmd({ n: 1, t: 'attack', id: 5, part: 'head' }), { n: 1, t: 'attack', id: 5 });
  assert.deepEqual(parseCmd({ n: 1, t: 'interact', id: 5, part: 1 }), { n: 1, t: 'interact', id: 5 });
  const input = parseInput({ p: [1, 2, 3], cmds: [{ n: 2, t: 'attack', id: 9, part: 7 }, { n: 1, t: 'useItem', slot: 0 }] });
  assert.deepEqual(input.cmds.map(c => c.t), ['useItem', 'attack']);
  assert.deepEqual(parseInput({ x: 1, y: 0 }).cmds, []);
});

// Server plumbing ----------------------------------------------------------------------------------------------------

test('server: endgame mobs tick through their hooks; views carry dimension, pitch, phase and the boss bar', () => {
  const state = game([END.x0 + 100, 64, END.z0 + 100]), player = state.players[0]!;
  const dragon = Object.assign(newMob(state, MOB.ender_dragon, END_CENTER.x, 90, END_CENTER.z), { pt: 0.25, ph: 1 });
  const pushed = [dragon, newMob(state, MOB.end_crystal, END.x0 + 90, 64, END.z0 + 90), newMob(state, MOB.enderman, END.x0 + 95, 64, END.z0 + 95),
    newMob(state, MOB.blaze, END.x0 + 97, 64, END.z0 + 97), newMob(state, MOB.silverfish, END.x0 + 99, 64, END.z0 + 99)];
  state.mobs.push(...pushed);
  for (let i = 0; i < 40; i++) send(state, []);
  assert.ok(pushed.every(mob => state.mobs.includes(mob)), 'the dragon never despawns, far from players over unloaded chunks');
  assert.equal(state.mobs.filter(m => m.t === MOB.ender_dragon).length, 1, 'one dragon (ensureDragon adopts it)');
  assert.equal(playerView(state, player.id).dimension, 'end');
  const view = publicView(state), pub = view.mobs.find(m => m.id === dragon.id)!;
  assert.equal(typeof pub.pt, 'number');
  assert.equal(typeof pub.ph, 'number');
  assert.equal(view.mobs.find(m => m.t === MOB.enderman)!.ph, undefined);
  assert.equal(view.boss?.name, 'Ender Dragon');
  assert.ok(!('victory' in view));
  assert.equal(view.stats.dragons, 0);
  assertSerializable(view);
  // Victory is published, saved, and credits its slayers in the results.
  state.end.victory = { day: 3, tick: 1234, by: ['Ada'] };
  assert.deepEqual(publicView(state).victory, { day: 3, tick: 1234, by: ['Ada'] });
  state.finished = true;
  assert.match(outcome(state).rows[0]!.label ?? '', /^Dragon slayer/);
});

test('server: blazes drop rods and endermen pearls to players, never missing three kills in a row', () => {
  const state = game(), player = state.players[0]!;
  const loot = (t: number, killer: Player | null) => {
    const mob = newMob(state, t, X + 2, 64, Z);
    state.mobs.push(mob);
    const before = state.items.length;
    killMob(state, mob, killer);
    return state.items.slice(before).map(item => [item.item, item.n]);
  };
  state.rand = () => 0.9;
  assert.deepEqual(loot(MOB.blaze, player), [[I.blaze_rod, 1]]);
  assert.deepEqual(loot(MOB.blaze, null), [], 'only player kills drop rods');
  state.rand = () => 0.1;
  assert.deepEqual(loot(MOB.blaze, player), [[I.blaze_rod, 2]]);
  state.rand = () => 0.9;
  assert.deepEqual(loot(MOB.enderman, player), [[I.ender_pearl, 3]], 'every kill drops pearls');
  state.rand = () => 0.1;
  assert.deepEqual(loot(MOB.enderman, player), [[I.ender_pearl, 1]]);
});

test('server: end crystals go on obsidian or bedrock; creative can break frames; detectors toggle; wart grows', () => {
  const state = game(), player = state.players[0]!, gy = 63;
  writeCell(state, X + 2, gy, Z, B.obsidian);
  writeCell(state, X + 2, gy, Z + 1, B.stone);
  player.inv[0] = { id: I.end_crystal, n: 2 };
  send(state, [{ t: 'use', x: X + 2, y: gy, z: Z + 1, face: 3 }, { t: 'use', x: X + 2, y: gy, z: Z, face: 3 }, { t: 'use', x: X + 2, y: gy, z: Z, face: 3 }]);
  assert.deepEqual(state.mobs.filter(m => m.t === MOB.end_crystal).map(m => [m.x, m.y, m.z]), [[X + 2.5, gy + 1, Z + 0.5]], 'one crystal, on the obsidian only');
  assert.deepEqual(player.inv[0], { id: I.end_crystal, n: 1 });
  writeCell(state, X - 2, gy + 1, Z, B.daylight_detector);
  send(state, [{ t: 'use', x: X - 2, y: gy + 1, z: Z, face: 3 }]);
  assert.equal(cellState(state.get(X - 2, gy + 1, Z)) & DAYLIGHT_INVERTED, DAYLIGHT_INVERTED);
  writeCell(state, X, gy + 1, Z + 2, B.end_portal_frame);
  send(state, [{ t: 'break', x: X, y: gy + 1, z: Z + 2 }]);
  assert.equal(state.get(X, gy + 1, Z + 2), B.end_portal_frame, 'survival cannot break frames');
  const creative = createState(ctx(), validateSettings({ seed: 11, mode: 'creative' }), { source: flat, spawn: [X, 64, Z] });
  writeCell(creative, X, gy + 1, Z + 2, B.end_portal_frame);
  tickState(creative, new Map([['p0', hold(creative.players[0]!, [{ t: 'break', x: X, y: gy + 1, z: Z + 2 }])]]), 0.05);
  assert.equal(creative.get(X, gy + 1, Z + 2), B.air);
  writeCell(state, X + 1, gy, Z - 2, B.soul_sand);
  writeCell(state, X + 1, gy + 1, Z - 2, B.nether_wart);
  state.rand = () => 0;
  for (let i = 0; i < 80 && cellState(state.get(X + 1, gy + 1, Z - 2)) < 3; i++) send(state, []);
  assert.equal(cellState(state.get(X + 1, gy + 1, Z - 2)), 3, 'wart ripens without light or water');
});

test('server: in the End beds explode and nether portals never light', () => {
  const ex = END.x0 + 100, ez = END.z0 + 100, state = game([ex, 64, ez]), player = state.players[0]!;
  writeCell(state, ex + 2, 64, ez, makeCell(B.bed, 1));
  writeCell(state, ex + 3, 64, ez, makeCell(B.bed, 1 | 4));
  const health = player.health;
  state.clock = 1;
  send(state, [{ t: 'use', x: ex + 2, y: 64, z: ez, face: 3 }]);
  assert.ok(player.health < health && player.bed === null, 'the bed blew up');
  // A 2 × 3 obsidian frame beside the player stays dark under flint and steel.
  for (const [dx, dy] of [[0, 0], [1, 0], [2, 0], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4], [0, 1], [0, 2], [0, 3], [3, 1], [3, 2], [3, 3]] as const) writeCell(state, ex + dx, 63 + dy, ez - 2, B.obsidian);
  player.inv[0] = { id: I.flint_and_steel, n: 1 };
  send(state, [{ t: 'use', x: ex + 1, y: 63, z: ez - 2, face: 3 }]);
  assert.notEqual(state.get(ex + 1, 64, ez - 2), B.nether_portal);
});

// Loot ---------------------------------------------------------------------------------------------------------------

test('loot registry: tables 1–5 roll exactly as before the split; the new tables roll', () => {
  const hash = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return (h >>> 0).toString(16).padStart(8, '0'); };
  const rolls = (table: number) => { let s = ''; for (let i = 0; i < 300; i++) s += JSON.stringify(rollLoot(table, lootSeed(11 + i, 123456 + i * 977))); return hash(s); };
  // Recorded from the pre-endgame loot.ts.
  assert.deepEqual([1, 2, 3, 4, 5].map(rolls), ['5ea76573', '3ee1534e', '92f40d05', '994f8b04', '8c470554']);
  assert.equal(rolls(0), 'eab07455', 'no table: empty chests');
  for (const bits of [6, 7, 8]) {
    const name = lootName(bits)!;
    assert.ok(LOOT[name].entries.length > 0, name);
    assert.ok(rollLoot(bits, lootSeed(3, 99)).some(Boolean), name);
  }
  assert.ok(LOOT.stronghold_corridor.entries.some(e => e.item === I.ender_pearl));
});

// Saves --------------------------------------------------------------------------------------------------------------

test('save v10 round-trips the End, the victory, dragons and the pearl pity; v9 saves load with a fresh End', () => {
  const live = game([X, 64, Z], ['Ada', 'Bo']);
  Object.assign(live.end, { dragon: 'dead', health: 0, crystals: [2, 7], portalActive: true, egg: true, victory: { day: 5, tick: 777, by: ['Ada', 'Bo'] } });
  live.pearlPity = 2;
  live.stats.dragons = 1;
  writeCell(live, X + 3, 64, Z, B.end_portal_frame | FRAME_EYE << 8);
  const save = exportSave(saveSource(live)), json = JSON.stringify(save);
  assert.equal(save.version, 10);
  assert.deepEqual(save.end, { dragon: 'dead', health: 0, crystals: [2, 7], portalActive: true, egg: true });
  assert.deepEqual([save.victory, save.pearlPity, save.stats.dragons], [{ day: 5, tick: 777, by: ['Ada', 'Bo'] }, 2, 1]);
  const loaded = createState(ctx(['Ada', 'Bo']), parseSave(JSON.parse(json)).settings, { source: flat, save: parseSave(JSON.parse(json)) });
  assert.deepEqual(exportSave(saveSource(loaded)), JSON.parse(json), 'export → load → export is stable');
  assert.deepEqual(loaded.end.victory, { day: 5, tick: 777, by: ['Ada', 'Bo'] });
  assert.equal(loaded.get(X + 3, 64, Z), B.end_portal_frame | FRAME_EYE << 8);

  // The same world as version 9 wrote it: no End, no victory, no pity, no dragons stat.
  const v9 = JSON.parse(json);
  v9.version = 9;
  delete v9.end;
  delete v9.victory;
  delete v9.pearlPity;
  delete v9.stats.dragons;
  const old = parseSave(v9), fresh = createState(ctx(['Ada']), old.settings, { source: flat, save: old });
  assert.deepEqual([fresh.end.dragon, fresh.end.health, fresh.end.crystals, fresh.end.portalActive, fresh.end.egg, fresh.end.victory], ['alive', 200, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], false, false, null]);
  assert.deepEqual([fresh.pearlPity, fresh.stats.dragons], [0, 0]);
  assert.equal(fresh.world.edits.size, live.world.edits.size, 'every v9 edit survives');

  const broken = (patch: (raw: Record<string, unknown>) => void) => { const raw = JSON.parse(json); patch(raw); return () => parseSave(raw); };
  assert.throws(broken(raw => { raw.end = { ...save.end, dragon: 'sleeping' }; }), /damaged \(end\)/);
  assert.throws(broken(raw => { raw.end = { ...save.end, crystals: [1, 1] }; }), /damaged \(end\)/);
  assert.throws(broken(raw => { raw.end = { ...save.end, health: 201 }; }), /damaged \(end\)/);
  assert.throws(broken(raw => { raw.victory = { day: 1, tick: 99999, by: [] }; }), /damaged \(victory\)/);
  assert.throws(broken(raw => { delete raw.pearlPity; }), /damaged \(pearls\)/);
  assert.throws(broken(raw => { delete raw.end; }), /damaged \(end\)/);
});

test('saves load players lost in the void, and a pre-End save leaves nothing behind in the End corner', () => {
  const live = game([X, 64, Z], ['Ada', 'Bo']), [ada, bo] = live.players as [Player, Player];
  // Review: a player who fell through the void died around y −430; that save used to be refused as damaged.
  Object.assign(ada, { x: END.x0 + 200.5, y: -430, z: END.z0 + 200.5, dead: true });
  // In v9 the End corner was overworld: a house, a bed and a player standing there.
  writeCell(live, END.x0 + 10, 70, END.z0 + 10, B.oak_planks);
  Object.assign(bo, { x: END.x0 + 10.5, y: 71, z: END.z0 + 10.5, bed: [END.x0 + 12, 64, END.z0 + 10] });
  const json = JSON.stringify(exportSave(saveSource(live)));
  const loaded = createState(ctx(['Ada', 'Bo']), parseSave(JSON.parse(json)).settings, { source: flat, save: parseSave(JSON.parse(json)) });
  assert.ok(loaded.players[0]!.y >= 0 && Math.abs(loaded.players[0]!.x - X) < 16, `Ada comes back at the world spawn (${[loaded.players[0]!.x, loaded.players[0]!.y]})`);
  assert.deepEqual([loaded.world.edits.size, loaded.players[1]!.bed], [live.world.edits.size, bo.bed], 'v10 keeps End builds and beds');

  const v9 = JSON.parse(json);
  v9.version = 9;
  for (const key of ['end', 'victory', 'pearlPity']) delete v9[key];
  delete v9.stats.dragons;
  const old = createState(ctx(['Ada', 'Bo']), parseSave(v9).settings, { source: flat, save: parseSave(v9) }), oldBo = old.players[1]!;
  assert.equal(old.world.edits.size, live.world.edits.size - 1, 'the edit in the End corner is dropped');
  assert.ok(oldBo.bed === null && dimensionAt(oldBo.x, oldBo.z) === 'overworld', 'Bo loads at the world spawn without the End bed');
});

test('the worst legal v10 save stays under 256 KiB', () => {
  const edits = new Map<number, number>();
  for (let i = 0; i < 16384; i++) edits.set(4095 - (i % 4096) + 4096 * (4095 - (Math.floor(i / 4096) % 16) + 4096 * (127 - Math.floor(i / 4096 / 16))), makeCell(i < 64 ? B.chest : i < 96 ? B.furnace_lit : B.stone_brick_stairs, 7));
  const indices = [...edits.keys()], big = 999999999, name = (i: number) => `${'W'.repeat(62)}${String(i).padStart(2, '0')}`;
  const fullSlots = (n: number) => Array.from({ length: n }, (_, i) => ({ id: I.diamond_pickaxe + (i % 5), n: 1, d: 1000 + i }));
  const source: SaveSource = {
    settings: validateSettings({ seed: 999999, mode: 'creative', difficulty: 'peaceful', keepInventory: false }), worldId: `999999-${'z'.repeat(57)}`, time: 23999, day: big, edits,
    players: Array.from({ length: 24 }, (_, i) => ({
      name: name(i), x: 4095.99, y: 127.99, z: 4095.99, yaw: -3.141, pitch: -1.571, health: 19.5, food: 19, saturation: 19.99, inv: fullSlots(36),
      armor: [I.diamond_helmet, I.diamond_chestplate, I.diamond_leggings, I.diamond_boots].map(id => ({ id, n: 1, d: 360 })), bed: [4095, 127, 4095] as [number, number, number],
      stats: { mined: big, placed: big, crafted: big, mobs: big, deaths: big, distance: big }, milestones: 2 ** 30, dead: false,
    })),
    chests: new Map(indices.slice(0, 64).map(i => [i, fullSlots(27)])),
    furnaces: new Map(indices.slice(64, 96).map(i => [i, { slots: [{ id: B.iron_ore, n: 64 }, { id: B.coal_block, n: 64 }, { id: I.iron_ingot, n: 64 }], burn: 799.99, burnMax: 800, cook: 9.99 }])),
    animals: Array.from({ length: 48 }, (_, i) => ({ t: MOB.sheep, x: 4095.99 - i, y: 127.99, z: 4095.99, s: 3 })),
    villagers: Array.from({ length: 64 }, (_, i) => ({ x: 4095.99 - i, y: 127.99, z: 4095.99, p: 4, home: [4095, 127, 4095 - i] as [number, number, number], uses: Array(8).fill(999999), seed: 2 ** 31 - 1 - i })),
    populated: new Set(Array.from({ length: 65536 }, (_, i) => i)), stats: { mined: big, placed: big, crafted: big, mobs: big, deaths: big, days: big, dragons: big },
    end: { dragon: 'alive', health: 199.99, crystals: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], portalActive: true, egg: true },
    victory: { day: big, tick: 23999, by: Array.from({ length: 24 }, (_, i) => name(i)) }, pearlPity: 999999,
  };
  const save = exportSave(source), bytes = Buffer.byteLength(JSON.stringify(save));
  console.log(`worst-case v10 save: ${(bytes / 1024).toFixed(1)} KiB`);
  assert.ok(bytes < MAX_SAVE_BYTES, `${bytes} bytes`);
  assert.equal(parseSave(JSON.parse(JSON.stringify(save))).victory!.by.length, 24);
});

// Worldgen compatibility ---------------------------------------------------------------------------------------------

/** Strongholds are mazes around their portal room: chunks this close (in blocks) to one may change. */
const STRONGHOLD_REACH = 256;
/** The deep-ocean fade around the End corner reaches this far (worldgen's 280 plus the tree and cave margins). */
const END_FADE = 300;

test('v9 terrain is byte-identical outside the new structures (so v9 saves keep every edit in place)', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/v9-chunks.json', import.meta.url), 'utf8')) as { seeds: Record<string, [number, number, string][]> };
  let checked = 0, total = 0;
  for (const [key, chunks] of Object.entries(fixture.seeds)) {
    const seed = Number(key), strongholds = strongholdsOf(seed), fortresses = fortressesOf(seed);
    for (const [cx, cz, hash] of chunks) {
      total++;
      const x0 = cx * 16, z0 = cz * 16, x1 = x0 + 15, z1 = z0 + 15;
      const nearStronghold = strongholds.some(([sx, , sz]) => Math.max(0, x0 - sx, sx - x1) ** 2 + Math.max(0, z0 - sz, sz - z1) ** 2 < STRONGHOLD_REACH ** 2);
      const inFortress = fortresses.some(({ bounds: b }) => b[0] - 16 <= x1 && b[3] + 16 >= x0 && b[2] - 16 <= z1 && b[5] + 16 >= z0);
      const nearEnd = Math.max(0, END.x0 - x1) ** 2 + Math.max(0, END.z0 - z1) ** 2 < END_FADE ** 2;
      if (nearStronghold || inFortress || nearEnd) continue;
      assert.equal(fnv(generateChunk(seed, cx, cz)), hash, `seed ${seed} chunk ${cx},${cz} changed`);
      checked++;
    }
  }
  assert.equal(total, 407);
  assert.ok(checked >= total * 0.6, `only ${checked} of ${total} golden chunks are still comparable`);
});
