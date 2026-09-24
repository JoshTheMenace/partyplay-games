/* Actors renderer checks that run without WebGL: the GLB rig contract (orientation, pivots), the
 * primitive fallback, pose-driven animation and a full createActors frame loop with every event and
 * entity kind (pooling, camera cues, disposal). Visual quality is checked in the dev harness. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createActors } from '../src/render/actors';
import { buildKartModel, KartActor } from '../src/render/actors/kart';
import { TagStack } from '../src/render/actors/overlays';
import { kartAssets } from '../src/render/assets';
import type { FrameInput, KartAssets, RacerPose } from '../src/render/types';
import { createRace, stepRace } from '../src/sim/race';
import { KART_BODIES, CHARACTERS } from '../src/sim/stats';
import { kartFromView, toRaceView } from '../src/sim/view';
import { getTrack } from '../src/tracks/index';
import type { Entity, KartBodyId, RaceEvent, RaceEventType } from '../src/sim/types';

const models = fileURLToPath(new URL('../public/models/', import.meta.url));
const KARTS: KartBodyId[] = KART_BODIES.map(b => b.id);
async function parse(file: string) {
  if (!existsSync(models + file)) return null;
  const b = readFileSync(models + file);
  return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, '')).scene;
}
const glb = Promise.all([parse('karts.glb'), parse('props.glb')]).then(([k, p]) => kartAssets(k, p));
const none = kartAssets(null, null);

function checkRig(assets: KartAssets, expectGlb: boolean) {
  for (const kart of KARTS) for (let c = 0; c < CHARACTERS.length; c++) {
    const m = buildKartModel(assets, kart, c);
    assert.equal(m.fromGlb, expectGlb, `${kart}: model source`);
    assert.ok(m.steerL && m.steerR && m.steering && m.head && m.armL && m.armR, `${kart}/char_${c}: every pivot resolved`);
    assert.equal(m.wheels.length, 4);
    const [fl, fr, rl, rr] = m.contacts;
    assert.ok(fl.z > rl.z + 1 && fr.z > rr.z + 1, `${kart}: front wheels ahead (+Z forward)`);
    assert.ok(fl.x > 0 && fr.x < 0 && rl.x > 0 && rr.x < 0, `${kart}: driver-right is -X`);
    const size = new THREE.Box3().setFromObject(m.model).getSize(new THREE.Vector3());
    assert.ok(size.x > 1.4 && size.x < 3 && size.z > 2 && size.z < 3.8 && size.y < 3.2, `${kart}: plausible kart size ${size.toArray().map(v => v.toFixed(2))}`);
    assert.ok(m.exhausts.every(e => e.z < 0), `${kart}: exhausts at the back`);
  }
}

test('primitive fallback follows the karts.glb node contract', () => checkRig(none, false));

test('karts.glb loads, is oriented +Z forward / -X right and has every rig pivot', async t => {
  const assets = await glb;
  if (!assets.karts) return t.skip('karts.glb missing');
  checkRig(assets, true);
  for (const name of ['item_box', 'peel', 'bouncer_shell', 'seeker_shell', 'bomb', 'comet', 'drone']) assert.ok(assets.clone(name) || !assets.props, `props.glb has ${name}`);
});

test('clone shares geometry with the library', async () => {
  const assets = await glb, name = assets.props ? 'cone' : null;
  if (!name) return;
  const a = assets.clone(name)!, b = assets.clone(name)!;
  const geo = (o: THREE.Object3D) => { let g: THREE.BufferGeometry | null = null; o.traverse(x => { if (!g && x instanceof THREE.Mesh) g = x.geometry; }); return g; };
  assert.ok(geo(a) && geo(a) === geo(b));
  assert.equal(none.clone('cone'), null);
});

/* ---------- animation ---------- */
const track = getTrack('palm-bay');
function makeRace() {
  const race = createRace({ track: 'palm-bay', laps: 3, speedClass: 100, difficulty: 'normal', gridSize: 8, items: 'normal', views: 'auto' }, [], 3, 'tv');
  for (let i = 0; i < 60 * 6; i++) stepRace(race, new Map(), 1 / 60);   // countdown over, pack moving
  return race;
}
const yawOf = (o: THREE.Object3D) => new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ').y;
const frame = { dt: 1 / 60, time: 0, track, reducedMotion: false };

test('pose drives wheels, steering, drift yaw and hop squash', async () => {
  const assets = await glb, view = toRaceView(makeRace()).racers[0], kart = kartFromView(view);
  const actor = new KartActor(assets, view.id, view.kart, view.character, false), P = actor.parts;
  const pose: RacerPose = { view, kart };
  Object.assign(kart, { vx: Math.sin(kart.heading) * 20, vz: Math.cos(kart.heading) * 20, grounded: true, steer: 1, drift: 0 });
  const before = P.wheels[2].node.quaternion.clone();
  for (let i = 0; i < 30; i++) { frame.time += frame.dt; actor.update(pose, frame); }
  assert.ok(P.wheels[2].node.quaternion.angleTo(before) > .1, 'rear wheel spins with speed');
  assert.ok(yawOf(P.steerL!.node) - yawOf({ quaternion: P.steerL!.rest } as THREE.Object3D) < -.2, 'steering right turns the front wheels toward -X');
  // Drift right: the body swings its nose further right (negative yaw) ~25°.
  Object.assign(kart, { drift: 1, steer: .5 });
  for (let i = 0; i < 60; i++) { frame.time += frame.dt; actor.update(pose, frame); }
  const yaw = yawOf(actor.pivot);
  assert.ok(yaw < -.3 && yaw > -.6, `drift yaw ${yaw.toFixed(2)} rad`);
  assert.ok(yawOf(P.steerL!.node) - yawOf({ quaternion: P.steerL!.rest } as THREE.Object3D) > 0, 'front wheels counter-steer in a drift');
  // Hop: leaving the ground upward stretches the kart, landing squashes it.
  Object.assign(kart, { drift: 0, grounded: false, vy: 4 }); actor.update(pose, frame);
  for (let i = 0; i < 4; i++) actor.update(pose, frame);
  assert.ok(actor.pivot.scale.y > 1.02, 'hop stretches');
  Object.assign(kart, { vy: -8 }); actor.update(pose, frame);
  Object.assign(kart, { grounded: true, vy: 0 }); actor.update(pose, frame);
  for (let i = 0; i < 3; i++) actor.update(pose, frame);
  assert.ok(actor.pivot.scale.y < .98, 'landing squashes');
  // Finish: arms go up.
  const rest = P.armL!.node.quaternion.clone();
  view.finishTime = 90;
  for (let i = 0; i < 90; i++) { frame.time += frame.dt; actor.update(pose, frame); }
  assert.ok(P.armL!.node.quaternion.angleTo(rest) > 1.2, 'arms raised after finishing');
  actor.dispose();
});

/* ---------- full frame loop ---------- */
test('createActors runs every event and entity kind, pools objects and disposes cleanly', async () => {
  const assets = await glb, race = makeRace(), scene = new THREE.Scene();
  const actors = createActors({ track, scene, assets, quality: 1 });
  assert.equal(actors.group.parent, scene);
  const view = toRaceView(race), poses = new Map<string, RacerPose>(view.racers.map(r => [r.id, { view: r, kart: kartFromView(r) }]));
  const a = view.racers[0].id, b = view.racers[1].id, cam = new THREE.PerspectiveCamera(68, 16 / 9, .1, 1000);
  const types: RaceEventType[] = ['hit', 'bump', 'wall', 'boost-pad', 'mini-turbo', 'trick', 'rocket-start', 'stall', 'slipstream', 'pickup', 'item', 'shield-pop', 'explode', 'thunder', 'comet', 'lap', 'final-lap', 'finish', 'respawn', 'fall', 'honk', 'overtake'];
  let id = 1e6, time = 10;
  const ent = (kind: Entity['kind'], n: number): Entity => ({ id: n, kind, owner: a, x: view.racers[0].x + 5, y: view.racers[0].y, z: view.racers[0].z + 5, vx: 20, vy: 0, vz: 0, t: 0, hint: -1, d: 0, target: null, bounces: kind === 'blast' ? 7 : 0, fuse: 1 });
  const step = (events: RaceEvent[] = []) => {
    time += 1 / 60;
    const f: FrameInput = { race: view, poses, viewports: [{ rect: { x: 0, y: 0, w: 1, h: .5 }, racerId: a, kind: 'chase' }, { rect: { x: 0, y: .5, w: 1, h: .5 }, racerId: b, kind: 'chase' }], quality: 1, reducedMotion: false, time, dt: 1 / 60, newEvents: events };
    actors.update(f); actors.beforeViewport(a, cam); actors.beforeViewport(b, cam);
  };
  step();
  view.entities = (['peel', 'bouncer', 'seeker', 'bomb', 'comet', 'blast'] as const).map((k, i) => ent(k, i + 1));
  for (const k of poses.values()) Object.assign(k.kart, { drift: 1, driftTier: 3, boostT: 1, boostPower: .35, starT: 2, shieldT: 5, shockT: 2.5, inkT: 2, slipCharge: 1 });
  step(types.map(type => ({ id: id++, t: time, type, racer: a, other: b, value: type === 'explode' ? 7 : type === 'item' ? 0 : 2, x: view.racers[0].x, z: view.racers[0].z })));
  assert.ok(actors.cues(a).shake > 0, 'hits shake the camera');
  assert.ok(actors.cues(a).fovKick > 0, 'mini-turbos kick the FOV');
  for (let i = 0; i < 30; i++) step();
  const count = () => { let n = 0; actors.group.traverse(() => { n++; }); return n; };
  const settled = count();
  for (let i = 0; i < 120; i++) step();
  assert.equal(count(), settled, 'steady frames add no scene objects');
  // Box pickup: the box scales away while its timer runs.
  view.boxes = view.boxes.map((_, i) => i === 0 ? 2.5 : 0); step();
  view.entities = []; for (let i = 0; i < 5; i++) step();
  assert.equal(count(), settled, 'retired entities are pooled (hidden), not removed');
  // Reduced motion: no camera cues.
  const f: FrameInput = { race: view, poses, viewports: [], quality: 1, reducedMotion: true, time, dt: 1 / 60, newEvents: [{ id: id++, t: time, type: 'hit', racer: a }] };
  actors.update(f);
  assert.deepEqual(actors.cues(a), { shake: 0, fovKick: 0 });
  actors.dispose();
  assert.equal(actors.group.parent, null);
});

test('Rainbow Road events: ring flash + burst, spring starburst + launch trail, bumper flash at the bumper', async () => {
  const rr = getTrack('rainbow-road'), race = createRace({ track: 'rainbow-road', laps: 3, speedClass: 100, difficulty: 'normal', gridSize: 4, items: 'normal', views: 'auto' }, [], 3, 'tv');
  for (let i = 0; i < 60 * 5; i++) stepRace(race, new Map(), 1 / 60);
  const scene = new THREE.Scene(), actors = createActors({ track: rr, scene, assets: none, quality: 0 }), view = toRaceView(race);
  const poses = new Map<string, RacerPose>(view.racers.map(r => [r.id, { view: r, kart: kartFromView(r) }])), a = view.racers[0].id;
  const particles = () => { let n = 0; actors.group.traverse(o => { const g = (o as THREE.Mesh).geometry as THREE.InstancedBufferGeometry | undefined; if (g?.isInstancedBufferGeometry && o.parent?.parent === actors.group) n += g.instanceCount; }); return n; };
  let time = 10, id = 5e6;
  const step = (events: RaceEvent[] = []) => { time += 1 / 60; actors.update({ race: view, poses, viewports: [{ rect: { x: 0, y: 0, w: 1, h: 1 }, racerId: a, kind: 'chase' }], quality: 0, reducedMotion: false, time, dt: 1 / 60, newEvents: events }); };
  step();
  for (const type of ['ring', 'spring', 'bumper'] as const) {
    const before = particles();
    step([{ id: id++, t: time, type, racer: a, value: 0 }]); step();
    assert.ok(particles() > before + 10, `${type} spawns an effect burst`);
    for (let i = 0; i < 90; i++) step();
  }
  assert.ok(rr.movers.length > 0 && rr.rings.length > 0 && rr.springs.length > 0, 'the course has every set-piece');
  actors.dispose();
});

test('items off: item boxes are hidden', async () => {
  const assets = await glb, scene = new THREE.Scene(), actors = createActors({ track, scene, assets, quality: 1 });
  const view = toRaceView(makeRace()), poses = new Map<string, RacerPose>(view.racers.map(r => [r.id, { view: r, kart: kartFromView(r) }]));
  const boxes = () => { const v: boolean[] = []; actors.group.traverse(o => { if (o instanceof THREE.InstancedMesh && o.count === track.boxes.length) v.push(o.visible); }); return v; };
  const run = (items: typeof view.items) => actors.update({ race: { ...view, items }, poses, viewports: [], quality: 1, reducedMotion: false, time: 1, dt: 1 / 60, newEvents: [] });
  run('normal'); assert.ok(boxes().length && boxes().every(Boolean), 'boxes drawn with items on');
  run('off'); assert.ok(boxes().every(v => !v), 'boxes hidden with items off');
  actors.dispose();
});

test('name tags stack above nearer ones instead of overlapping', () => {
  const s = new TagStack(), h = .1;
  s.add(0, 0, .2); s.add(.1, .02, .2); s.add(.15, .02, .2); s.add(.05, .01, .2); s.add(1, 0, .2);
  s.solve(h, 3);
  assert.deepEqual(Array.from(s.row.subarray(0, 5)), [0, 1, 2, -1, 0], 'nearest keeps its spot, the next stack up, overflow hides, clear tags stay put');
});

test('rivals well in front of the lens (nearer than our kart) dither out; alongside us they stay solid', async () => {
  const assets = await glb, scene = new THREE.Scene(), actors = createActors({ track, scene, assets, quality: 1 });
  const view = toRaceView(makeRace()), [me, near, beside] = view.racers, poses = new Map<string, RacerPose>(view.racers.map(r => [r.id, { view: r, kart: kartFromView(r) }]));
  const place = (id: string, x: number, z: number) => Object.assign(poses.get(id)!.kart, { x, z, y: me.y });
  place(near.id, me.x, me.z - 3); place(beside.id, me.x + 2.2, me.z - .5);   // camera sits 6.3 m behind us, looking +Z
  const cam = new THREE.PerspectiveCamera(68, 16 / 9, .1, 1000); cam.position.set(me.x, me.y + 2.5, me.z - 6.3); cam.lookAt(me.x, me.y + .9, me.z + 6);
  actors.update({ race: view, poses, viewports: [{ rect: { x: 0, y: 0, w: 1, h: 1 }, racerId: me.id, kind: 'chase' }], quality: 1, reducedMotion: false, time: 1, dt: 1 / 60, newEvents: [] });
  actors.beforeViewport(me.id, cam);
  const shown = (id: string) => (actors.group.getObjectByName(`racer:${id}`)!.children[0]).visible;
  assert.equal(shown(near.id), false, 'kart 3 m in front of the lens is hidden');
  assert.equal(shown(beside.id), true, 'kart alongside ours stays visible');
  assert.equal(shown(me.id), true);
  actors.dispose();
});

test('loop: karts ride the ribbon frame (upside down over the top), cast no ground shadow and leave no skids', async () => {
  const { loopPose } = await import('../src/sim/track');
  const { loopFrame } = await import('../src/render/loop');
  const rr = getTrack('rainbow-road'), l = rr.loops[0], len = l.d1 - l.d0, race = createRace({ track: 'rainbow-road', laps: 3, speedClass: 100, difficulty: 'normal', gridSize: 4, items: 'normal', views: 'auto' }, [], 3, 'tv');
  for (let i = 0; i < 60 * 5; i++) stepRace(race, new Map(), 1 / 60);
  const scene = new THREE.Scene(), actors = createActors({ track: rr, scene, assets: none, quality: 0 }), view = toRaceView(race);
  const poses = new Map<string, RacerPose>(view.racers.map(r => [r.id, { view: r, kart: kartFromView(r) }])), a = view.racers[0].id, k = poses.get(a)!.kart;
  let shadows: THREE.InstancedMesh | null = null, skids: THREE.Mesh | null = null;
  actors.group.traverse(o => { if (o instanceof THREE.InstancedMesh && o.geometry.getAttribute('aAlpha')) shadows = o; });
  skids = actors.group.children[0] as THREE.Mesh;
  const skidDraw = () => (skids!.geometry.getAttribute('aBorn').array as Float32Array).filter(t => t > 0).length;   // quads written
  let time = 10;
  const frame = () => { time += 1 / 60; actors.update({ race: view, poses, viewports: [{ rect: { x: 0, y: 0, w: 1, h: 1 }, racerId: a, kind: 'chase' }], quality: 0, reducedMotion: false, time, dt: 1 / 60, newEvents: [] }); };
  frame(); const grounded = shadows!.count, before = skidDraw();
  for (let th = 0.05; th < Math.PI; th += 0.03) {
    const p = loopPose(l, th, 1);
    Object.assign(k, { x: p.x, y: p.y, z: p.z, d: l.d0 + len * th / (Math.PI * 2), lateral: 1, heading: p.heading, vx: p.tx * 20, vy: p.ty * 20, vz: p.tz * 20, loop: th, grounded: true, drift: 1, driftTier: 2 });
    frame();
  }
  const root = actors.group.getObjectByName(`racer:${a}`)!, up = new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion), F = loopFrame(l, k.loop, 1);
  assert.ok(up.dot(new THREE.Vector3(F.ux, F.uy, F.uz)) > 0.98 && up.y < -0.8, `kart hangs upside down on the ribbon (up ${up.toArray().map(v => v.toFixed(2))})`);
  assert.ok(root.position.distanceTo(new THREE.Vector3(k.x, k.y, k.z)) < 1e-6, 'root sits where the simulation says');
  assert.equal(shadows!.count, grounded - 1, 'no blob shadow under the looping kart');
  assert.equal(skidDraw(), before, 'no skid marks in the loop');
  assert.ok(actors.cues(a).fovKick > 0, 'entry kicks the FOV');
  actors.dispose();
});
