/** Client game support for the endgame: dragon parts targeting, new uses and throws, rigs, entity animation, sounds and shake. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Scene, type Object3D } from 'three';
import { B, DAYLIGHT_INVERTED, FRAME_EYE, makeCell } from '../src/shared/blocks';
import { I } from '../src/shared/items';
import { DRAGON_HEAD, DRAGON_PHASE, MOB, mobBoxes, MS, PK, type PubMob, type View } from '../src/shared/protocol';
import { heldAsBlock, itemSprite, texturePixels } from '../src/client/art/atlas';
import { mobRange, mobSynth } from '../src/client/audio/sounds';
import { ViewEffects, type ViewState } from '../src/client/game/camera';
import { Entities, type DragonCue, type EntityEmit } from '../src/client/game/entities';
import { ModelLibrary } from '../src/client/game/models';
import { ItemModels, SpriteSheet } from '../src/client/game/sprites';
import { blockUse, dragonBoxes, pickTarget, useWrites, type MobBox } from '../src/client/game/targeting';

const view = (mobs: PubMob[], arrows: View['arrows'] = []): View => ({
  seed: 1, mode: 'survival', time: 0, day: 1, players: [], mobs, items: [], arrows, edits: [], revision: 0, fx: [],
  stats: { mined: 0, placed: 0, crafted: 0, mobs: 0, deaths: 0, days: 0, dragons: 0 },
} as unknown as View);
const mob = (id: number, t: number, patch: Partial<PubMob> = {}): PubMob => ({ id, t, x: 3840, y: 80, z: 3840, yaw: 0, hurt: 0, a: 0, ...patch });

/**
 * Entities fed snapshots 50 ms apart, sampled `frames` times while the render clock crawls through them (animation runs at
 * 60 fps); returns them with what they emitted.
 */
function run(views: View[], frames = 30, viewer: readonly [number, number, number] = [3840, 80, 3840]) {
  const scene = new Scene(), models = new ModelLibrary(), items = new ItemModels(new SpriteSheet({ tile: texturePixels, item: itemSprite, cube: heldAsBlock }));
  const entities = new Entities(scene, models, items, (_x, _y, _z, out) => { out[0] = out[1] = out[2] = 0.6; return out; }, () => true, null);
  const emitted = new Set<EntityEmit>(), cues: DragonCue[] = [];
  entities.viewer = viewer;
  entities.onEmit = kind => emitted.add(kind);
  entities.onDragon = cue => cues.push(cue);
  views.forEach((v, i) => entities.push(v, i * 50, i * 50));
  const span = (views.length - 1) * 50;
  for (let i = 0; i < frames; i++) entities.update(100 + span * (i + 1) / frames, 1 / 60);
  return { entities, emitted, cues, scene };
}
const pivot = (entities: Entities, id: number, name: string) => {
  let found: Object3D | undefined;
  entities.mobs.get(id)!.rig.root.traverse(node => { if (!found && node.name === name) found = node; });
  return found!;
};

test('the dragon is targeted part by part, with the same boxes the server checks', () => {
  const pose = { t: MOB.ender_dragon, x: 3840, y: 90, z: 3830, yaw: 0.7, pt: -0.3 };
  const out = mobBoxes(pose).map(() => ({ box: [0, 0, 0, 0, 0, 0] }));
  dragonBoxes(pose.x, pose.y, pose.z, pose.yaw, pose.pt, out);
  out.forEach(({ box }, i) => box.forEach((v, j) => assert.ok(Math.abs(v - mobBoxes(pose)[i]![j]!) < 1e-9, `part ${i}`)));
  // Looking straight at the head from in front: the head part wins over the body behind it.
  const parts: MobBox[] = mobBoxes(pose).map((box, part) => ({ id: 9, part, box }));
  const head = mobBoxes(pose)[DRAGON_HEAD]!, centre = [(head[0] + head[3]) / 2, (head[1] + head[4]) / 2, (head[2] + head[5]) / 2] as const;
  const eye: [number, number, number] = [centre[0] - Math.sin(0.7) * 4, centre[1], centre[2] - Math.cos(0.7) * 4], dir: [number, number, number] = [Math.sin(0.7), 0, Math.cos(0.7)];
  const hit = pickTarget(null, parts, eye, dir, 6), single = pickTarget(null, [{ id: 4, box: [0, 0, 0, 1, 1, 1] }], [0.5, 0.5, -2], [0, 0, 1], 5);
  assert.equal(hit?.kind === 'mob' && hit.part, DRAGON_HEAD);
  assert.ok(single?.kind === 'mob' && !('part' in single), 'single-box mobs carry no part');
});

test('right-click: eyes go into empty frames, crystals onto obsidian, detectors flip; pearls and eyes are thrown otherwise', () => {
  const frame = makeCell(B.end_portal_frame, 2), at = { x: 1, y: 64, z: 1, face: 3 };
  assert.equal(blockUse(frame, B.air, I.ender_eye, false), 'eye');
  assert.deepEqual(useWrites(() => frame, 'eye', at, I.ender_eye), [[1, 64, 1, makeCell(B.end_portal_frame, 2 | FRAME_EYE)]]);
  assert.equal(blockUse(makeCell(B.end_portal_frame, FRAME_EYE), B.air, I.ender_eye, false), null, 'a filled frame takes no second eye');
  assert.equal(blockUse(B.obsidian, B.air, I.end_crystal, false), 'crystal');
  assert.deepEqual(useWrites(() => B.obsidian, 'crystal', at, I.end_crystal), [], 'the crystal (a mob) is the server\'s to place');
  assert.equal(blockUse(B.daylight_detector, B.air, 0, false), 'daylight');
  assert.deepEqual(useWrites(() => B.daylight_detector, 'daylight', at, 0), [[1, 64, 1, makeCell(B.daylight_detector, DAYLIGHT_INVERTED)]]);
  assert.equal(blockUse(B.stone, B.air, I.ender_pearl, false), null, 'a pearl at a wall is thrown, not used on it');
});

test('every endgame mob animates: blaze rods spin, an angry enderman drops its jaw, silverfish wriggle, crystals turn', () => {
  const mobs = [mob(1, MOB.blaze, { a: 2 }), mob(2, MOB.enderman, { s: MS.ANGRY, x: 3850 }), mob(3, MOB.silverfish, { x: 3860 }), mob(4, MOB.end_crystal, { x: 3870 })];
  const { entities, emitted } = run([view(mobs), view(mobs.map(m => ({ ...m, x: m.x + 0.5 })))], 240);
  assert.notEqual(pivot(entities, 1, 'rods_ring_0').rotation.y, 0);
  assert.ok(pivot(entities, 2, 'jaw').rotation.x < -0.3, 'the jaw hangs open');
  assert.notEqual(pivot(entities, 3, 'seg_1').rotation.y, 0);
  assert.notEqual(pivot(entities, 4, 'frame_outer').rotation.y, 0);
  assert.ok(emitted.has('blaze') && emitted.has('ender'), 'blazes smoke, endermen shed motes');
  assert.ok(entities.glowCount > 0, 'blazes and crystals light the ground');
});

test('glow lights go to the nearest sources (far crystals never starve a blaze by the camera); only creepers and TNT hiss', () => {
  const crystals = Array.from({ length: 10 }, (_, i) => mob(20 + i, MOB.end_crystal, { x: 3800 + i * 8 }));
  const near = [mob(1, MOB.blaze, { x: 100, y: 64, z: 100 }), mob(2, MOB.enderman, { x: 104, y: 64, z: 100 }), mob(3, MOB.creeper, { x: 108, y: 64, z: 100 })];
  const lit = near.map(m => ({ ...m, a: 3 }));
  const { entities } = run([view([...crystals, ...near]), view([...crystals, ...near])], 10, [100, 65, 100]);
  assert.equal(entities.glowCount, 4);
  assert.ok([0, 1, 2, 3].some(i => Math.abs(entities.glows[i * 7]! - 100) < 2), 'the blaze by the camera glows');
  let hisses = 0;
  entities.onFuse = () => hisses++;
  [view([...crystals, ...lit]), view([...crystals, ...lit])].forEach((v, i) => entities.push(v, 200 + i * 50, 200 + i * 50));
  for (let i = 0; i < 10; i++) entities.update(300 + i * 5, 1 / 60);
  assert.equal(hisses, 1, 'the creeper hisses; a staring enderman and a charging blaze do not');
});

test('the dragon flies smoothly: placed at its body centre, banking, wings beating, tail trailing; a crystal beams to it', () => {
  const dragon = (x: number, yaw: number, ph = DRAGON_PHASE.CIRCLING) => mob(7, MOB.ender_dragon, { x, y: 85, yaw, pt: 0.1, ph });
  const crystal = mob(8, MOB.end_crystal, { x: 3830, y: 90, z: 3840, a: 3 }), far = mob(9, MOB.end_crystal, { x: 3700, y: 90, z: 3700 });
  const { entities, cues } = run([view([dragon(3840, 0), crystal, far]), view([dragon(3841, 0.2), crystal, far])], 120);
  const actor = entities.mobs.get(7)!;
  assert.ok(Math.abs(actor.rig.root.position.y - (actor.y + 2)) < 1e-6, 'the root sits at the body centre');
  assert.ok(Math.abs(actor.rig.root.rotation.z) > 0.01, 'it banks into the turn');
  assert.notEqual(pivot(entities, 7, 'wing_l').rotation.z, 0);
  assert.notEqual(pivot(entities, 7, 'tail_5').rotation.y, 0, 'the tail lags behind the turn');
  assert.ok(cues.includes('flap'), 'wing beats are heard');
  assert.equal([...entities.mobBoxes()].filter(box => box.id === 7).length, 8, 'eight targetable parts');
  assert.ok(entities.mobs.get(8)!.beam?.visible, 'the healing crystal (a = 3) beams to it');
  assert.ok(!entities.mobs.get(9)!.beam?.visible, 'the others do not');
  assert.ok(entities.dragon, 'the runtime can find the dragon for camera shake');
});

test('the dragon perches with a roar and a thud, then dies in light and dissolves', () => {
  const at = (ph: number) => mob(7, MOB.ender_dragon, { ph });
  const perch = run([view([at(DRAGON_PHASE.LANDING)]), view([at(DRAGON_PHASE.LANDING)]), view([at(DRAGON_PHASE.PERCHED)])], 60);
  assert.ok(perch.cues.includes('land') && perch.cues.includes('roar'));
  assert.ok(perch.emitted.has('breath'), 'it breathes acid while perched');
  const death = run([view([at(DRAGON_PHASE.DYING)]), view([at(DRAGON_PHASE.DYING)])], 400);
  const actor = death.entities.mobs.get(7)!;
  assert.ok(actor.pose!.beams!.visible && actor.pose!.beams!.children.filter(b => b.visible).length > 5, 'beams of light grow out of it');
  assert.ok(actor.rig.materials.every(m => m.material.opacity < 1), 'it is fading away');
  assert.equal([...death.entities.mobBoxes()].length, 0, 'a dying dragon cannot be targeted');
  assert.ok(death.emitted.has('dying'));
});

test('thrown eyes of ender and pearls fly as their spinning item with a trail', () => {
  const arrows = [PK.EYE, PK.PEARL].map((k, i) => ({ id: i + 1, x: 3840, y: 80, z: 3840 + i, vx: 1, vy: 0, vz: 0, k }));
  const { entities, emitted, scene } = run([view([], arrows), view([], arrows.map(a => ({ ...a, x: a.x + 0.5 })))]);
  assert.ok(emitted.has('eye') && emitted.has('pearl'));
  let meshes = 0;
  scene.traverse(node => { if ((node as { isMesh?: boolean }).isMesh) meshes++; });
  assert.ok(meshes >= 2);
  entities.dispose();
});

test('new mob voices are synthesized; the dragon carries far; the view shakes and settles', () => {
  for (const key of ['blaze', 'enderman', 'silverfish', 'ender_dragon']) assert.ok(mobSynth(key), key);
  assert.equal(mobRange('ender_dragon'), 128);
  const effects = new ViewEffects(), camera = new PerspectiveCamera(), s: ViewState = { walked: 0, onGround: true, sprinting: false, flying: false, underwater: false, dead: false, sleeping: false, baseFov: 75, portal: 0 };
  effects.apply(camera, 0, 1.6, 0, 0, 0, 0, s, 1 / 60);
  const still = camera.position.clone();
  effects.shake(1);
  effects.apply(camera, 0, 1.6, 0, 0, 0, 0, s, 0.05);
  assert.ok(camera.position.distanceTo(still) > 0.001, 'shaking');
  for (let i = 0; i < 90; i++) effects.apply(camera, 0, 1.6, 0, 0, 0, 0, s, 1 / 60);
  assert.ok(camera.position.distanceTo(still) < 1e-6, 'settled');
});
