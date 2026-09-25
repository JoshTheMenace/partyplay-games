/** Client game support for the expansion: predicted uses and breaks, armor and outfits, overlays, sounds and wobble. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Scene } from 'three';
import { B, BUTTON_PRESSED, DOOR_UPPER, LEVER_ON, makeCell, PISTON_EXTENDED, repeaterDelay } from '../src/shared/blocks';
import type { CellReader } from '../src/shared/chunk';
import { I } from '../src/shared/items';
import { newBody } from '../src/shared/physics';
import type { PrivateView } from '../src/shared/protocol';
import { SOUND_FILES, mobPitch, mobSynth, mobVoice } from '../src/client/audio/sounds';
import { ViewEffects, type ViewState } from '../src/client/game/camera';
import { ScreenFx } from '../src/client/game/effects';
import { ARMOR_BOXES } from '../src/client/art/atlas';
import { attach, detach, ModelLibrary, PROFESSIONS, villagerModel, wearArmor } from '../src/client/game/models';
import { replay } from '../src/client/game/predict';
import { blockUse, breakWrites, useWrites } from '../src/client/game/targeting';

/** Stone below y = 64, air above, plus overrides keyed "x,y,z". */
const world = (overrides: Record<string, number> = {}): CellReader => (x, y, z) => overrides[`${x},${y},${z}`] ?? (y < 64 ? B.stone : B.air);
const pv = (patch: Partial<PrivateView> = {}): PrivateView => ({
  ack: 0, tp: { n: 0, x: 0, y: 0, z: 0 }, imp: { n: 0, vx: 0, vy: 0, vz: 0 }, inv: Array(36).fill(null), cursor: null, grid: Array(4).fill(null), out: null,
  screen: null, health: 20, food: 20, saturation: 5, air: 300, dead: false, spawn: [0, 64, 0], mode: 'survival', keepInventory: true,
  armor: [null, null, null, null], armorPoints: 0, dimension: 'overworld', ...patch,
});

test('right-click classes for the new blocks and items follow the shared rules', () => {
  assert.equal(blockUse(B.lever, B.air, 0, false), 'lever');
  assert.equal(blockUse(B.oak_button, B.air, B.dirt, false), 'button');
  assert.equal(blockUse(B.repeater, B.air, 0, false), 'repeater');
  assert.equal(blockUse(B.lever, B.air, B.dirt, true), null, 'sneaking with a block places against a lever');
  assert.equal(blockUse(B.grass_block, B.air, I.iron_shovel, false), 'path');
  assert.equal(blockUse(B.grass_block, B.dirt, I.iron_shovel, false), null, 'no path under a block');
  assert.equal(blockUse(B.stone, B.air, I.flint_and_steel, false), 'ignite');
  assert.equal(blockUse(B.tnt, B.air, I.flint_and_steel, false), 'tnt');
  assert.equal(blockUse(B.stone, B.air, I.lava_bucket, false), 'bucket');
  assert.equal(blockUse(B.iron_door, B.iron_door, 0, false), null, 'iron doors ignore hands');
});

test('predicted uses: levers flip, buttons press once, repeaters cycle, paths, fire and buckets', () => {
  const lever = makeCell(B.lever, 3), get = world({ '1,64,1': lever, '2,64,1': makeCell(B.stone_button, 1 | BUTTON_PRESSED), '3,64,1': makeCell(B.repeater, 3 << 2) });
  assert.deepEqual(useWrites(get, 'lever', { x: 1, y: 64, z: 1, face: 3 }, 0), [[1, 64, 1, lever | LEVER_ON << 8]]);
  assert.deepEqual(useWrites(get, 'button', { x: 2, y: 64, z: 1, face: 1 }, 0), [], 'already pressed');
  const [[, , , cycled]] = useWrites(get, 'repeater', { x: 3, y: 64, z: 1, face: 3 }, 0) as [[number, number, number, number]];
  assert.equal(repeaterDelay(cycled >> 8), 1, 'delay 4 wraps to 1');
  assert.deepEqual(useWrites(get, 'path', { x: 0, y: 63, z: 0, face: 3 }, I.iron_shovel), [[0, 63, 0, B.dirt_path]]);
  assert.deepEqual(useWrites(get, 'ignite', { x: 5, y: 63, z: 5, face: 3 }, I.flint_and_steel), [[5, 64, 5, B.fire]]);
  assert.deepEqual(useWrites(world({ '5,63,5': B.obsidian }), 'ignite', { x: 5, y: 63, z: 5, face: 3 }, I.flint_and_steel), [], 'maybe a portal frame: the server decides');
  // Water poured onto lava makes obsidian; an empty bucket aimed at lava (from the cell in front) scoops it up.
  const pool = world({ '7,64,7': B.lava });
  assert.deepEqual(useWrites(pool, 'bucket', { x: 7, y: 63, z: 7, face: 3 }, I.water_bucket), [[7, 64, 7, B.obsidian]]);
  assert.deepEqual(useWrites(pool, 'bucket', { x: 7, y: 65, z: 7, face: 2 }, I.bucket), [[7, 64, 7, B.air]]);
});

test('predicted breaks pop unsupported redstone parts, take linked halves and reconnect fences', () => {
  // A lever on the east face of (4, 64, 4), dust on top of it, a fence beside it.
  const get = world({ '4,64,4': B.stone, '5,64,4': makeCell(B.lever, 1), '4,65,4': B.redstone_wire, '4,64,5': makeCell(B.oak_fence, 1) });
  const writes = breakWrites(get, 4, 64, 4, B.stone);
  assert.deepEqual(writes.slice(0, 3).map(w => w.slice(0, 3)).sort(), [[4, 64, 4], [4, 65, 4], [5, 64, 4]].sort());
  assert.ok(writes.some(([x, y, z, cell]) => x === 4 && y === 64 && z === 5 && cell === makeCell(B.oak_fence, 0)), 'the fence lets go of the broken block');
  const piston = world({ '0,64,0': makeCell(B.piston, 3 | PISTON_EXTENDED), '0,65,0': makeCell(B.piston_head, 3) });
  assert.deepEqual(breakWrites(piston, 0, 65, 0, makeCell(B.piston_head, 3)).map(w => w.slice(0, 3)), [[0, 65, 0], [0, 64, 0]]);
  const door = world({ '2,64,2': makeCell(B.iron_door, 0), '2,65,2': makeCell(B.iron_door, DOOR_UPPER) });
  assert.deepEqual(breakWrites(door, 2, 64, 2, makeCell(B.iron_door, 0)).map(w => w.slice(0, 3)), [[2, 64, 2], [2, 65, 2]]);
});

test('armor clicks and right-click equipping are predicted like the server does them', () => {
  const view = pv({ inv: [{ id: I.iron_helmet, n: 1 }, { id: I.diamond_boots, n: 1 }, ...Array(34).fill(null)], armor: [null, null, null, { id: I.leather_boots, n: 1 }] });
  const next = replay(view, [{ n: 1, t: 'click', w: 'inv', i: 0, b: 2 }, { n: 2, t: 'useItem', slot: 1 }], false);
  assert.deepEqual(next.armor.map(slot => slot?.id ?? 0), [I.iron_helmet, 0, 0, I.diamond_boots]);
  assert.deepEqual(next.inv.slice(0, 2), [null, { id: I.leather_boots, n: 1 }], 'the old boots come back to the hand slot');
});

test('armor (the art skins) and villager outfits attach to the rig pivots, join its tint materials and come off cleanly', () => {
  const library = new ModelLibrary(), rig = library.instance('player'), before = rig.materials.length;
  const worn = wearArmor(rig, [I.iron_helmet, I.iron_chestplate, I.golden_leggings, I.diamond_boots]);
  assert.equal(worn.meshes.length, ARMOR_BOXES.length);
  assert.equal(wearArmor(library.instance('player'), [0, 0, 0, 0]).meshes.length, 0);
  assert.equal(wearArmor(library.instance('player'), [I.leather_helmet, 0, 0, 0]).meshes.length, 1);
  assert.equal(rig.materials.length, before + ARMOR_BOXES.length);
  assert.ok(worn.meshes.every(mesh => mesh.parent !== null && (mesh.material as { map: unknown }).map));
  // The helmet is inflated past the 8 px head it covers.
  const helmet = worn.meshes[0]!;
  helmet.geometry.computeBoundingBox();
  assert.ok(helmet.geometry.boundingBox!.max.x - helmet.geometry.boundingBox!.min.x > 8 * rig.unit);
  detach(rig, worn);
  assert.equal(rig.materials.length, before);
  assert.ok(worn.meshes.every(mesh => mesh.parent === null));
  assert.deepEqual([0, 1, 4, 9].map(villagerModel), ['villager', 'villager_librarian', 'villager_cleric', 'villager'], 'one model per profession, farmer by default');
  assert.equal(new Set(PROFESSIONS.map(job => job.robe)).size, PROFESSIONS.length, 'every profession has its own robe');
  const villager = library.instance('villager');
  assert.ok(villager.materials.some(m => m.shirt), 'the robe takes the profession colour');
  assert.ok(attach(villager, PROFESSIONS[0]!.pieces).meshes.length > 0);
  const ghast = library.instance('ghast');
  assert.ok(ghast.pivots.face_idle && ghast.pivots.face_shoot && ghast.pivots.leg_8);
  library.dispose();
});

test('screen overlays: flames while burning, the portal swirl with its charge, a fading flash after travel', () => {
  const host = new Scene(), shared = { uAtlas: { value: null as never }, uTime: { value: 0 }, uLavaLayer: { value: 0 }, uPortalLayer: { value: 1 }, uFireLayer: { value: 2 } };
  const fx = new ScreenFx(host, shared, false), visible = () => host.children.map(child => child.visible);
  fx.update(0.1, false, 0, 1.6);
  assert.deepEqual(visible(), [false, false, false]);
  for (let i = 0; i < 10; i++) fx.update(0.05, true, 0.8, 1.6);
  assert.deepEqual(visible(), [true, true, true]);
  for (let i = 0; i < 40; i++) fx.update(0.05, false, 0, 1.6);
  assert.deepEqual(visible(), [false, false, false]);
  fx.flash();
  fx.update(0.05, false, 0, 1.6);
  assert.equal(visible()[2], true, 'the arrival flash shows');
  for (let i = 0; i < 30; i++) fx.update(0.05, false, 0, 1.6);
  assert.equal(visible()[2], false, 'and fades within about a second');
  fx.dispose();
  assert.equal(host.children.length, 0);
});

test('the view wobbles and widens while a portal charges', () => {
  const effects = new ViewEffects(), camera = new PerspectiveCamera(75, 1.6, 0.05, 100), body = newBody(0, 64, 0);
  const state: ViewState = { walked: 0, onGround: true, sprinting: false, flying: false, underwater: false, dead: false, sleeping: false, baseFov: 75, portal: 0 };
  for (let i = 0; i < 20; i++) effects.apply(camera, body.x, 65.6, body.z, 64, 0, 0, state, 0.05);
  const still = camera.fov;
  state.portal = 1;
  for (let i = 0; i < 40; i++) effects.apply(camera, body.x, 65.6, body.z, 64, 0, 0, state, 0.05);
  assert.ok(camera.fov > still + 5, `fov ${camera.fov}`);
});

test('new mob voices: zombified piglins grunt lower with zombie samples; villagers and ghasts are synthesized', () => {
  const grunt = mobVoice('zombified_piglin', 1);
  assert.ok(grunt && SOUND_FILES.includes(grunt));
  assert.ok(mobPitch('zombified_piglin') < 1);
  assert.equal(mobSynth('villager'), 'villager');
  assert.equal(mobSynth('ghast'), 'ghast');
  assert.equal(mobVoice('tnt', 0), null);
  assert.equal(mobSynth('tnt'), null);
});
