import assert from 'node:assert/strict';
import test from 'node:test';
import { gridShape, planViewports, splitRects, viewportPixels } from '../src/render/layout';
import { Director, fitFov } from '../src/render/camera';
import type { RaceView, RacerView } from '../src/sim/types';

const area = (r: { w: number; h: number }) => r.w * r.h;
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;

test('split grids tile the whole screen without overlap for 1–10 views', () => {
  for (let n = 1; n <= 10; n++) {
    const rects = splitRects(n), { cols, rows } = gridShape(n);
    assert.equal(rects.length, cols * rows);
    assert.ok(rects.length >= n);
    assert.ok(Math.abs(rects.reduce((s, r) => s + area(r), 0) - 1) < 1e-9, `n=${n} covers the screen`);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.ok(!overlaps(rects[i], rects[j]), `n=${n} cells ${i},${j} overlap`);
  }
  assert.deepEqual(gridShape(2), { cols: 1, rows: 2 }, 'two players are stacked');
  assert.deepEqual(gridShape(4), { cols: 2, rows: 2 });
});

test('split mode: one chase view per TV racer, overview in the 3-player quadrant', () => {
  const one = planViewports('split', ['a'], 'a', null);
  assert.deepEqual(one, [{ rect: { x: 0, y: 0, w: 1, h: 1 }, racerId: 'a', kind: 'chase' }]);
  const two = planViewports('split', ['a', 'b'], null, null);
  assert.deepEqual(two.map(v => [v.racerId, v.rect.y, v.rect.h]), [['a', 0, 0.5], ['b', 0.5, 0.5]]);
  const three = planViewports('split', ['a', 'b', 'c'], null, null);
  assert.deepEqual(three.map(v => v.kind), ['chase', 'chase', 'chase', 'overview']);
  assert.deepEqual(three[3].rect, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  assert.equal(three[3].racerId, null);
  const four = planViewports('split', ['a', 'b', 'c', 'd'], null, null);
  assert.ok(four.every(v => v.kind === 'chase') && four.length === 4);
  const ten = planViewports('split', Array.from({ length: 10 }, (_, i) => `p${i}`), null, null);
  assert.equal(ten.filter(v => v.kind === 'chase').length, 10);
});

test('personal, spectator and controls modes', () => {
  assert.deepEqual(planViewports('personal', ['a', 'b'], 'b', null), [{ rect: { x: 0, y: 0, w: 1, h: 1 }, racerId: 'b', kind: 'chase' }]);
  assert.deepEqual(planViewports('spectator', ['a'], null, 'cpu-1'), [{ rect: { x: 0, y: 0, w: 1, h: 1 }, racerId: 'cpu-1', kind: 'chase' }]);
  assert.deepEqual(planViewports('controls', ['a'], 'a', null), []);
  assert.equal(planViewports('split', [], null, 'x')[0].racerId, 'x', 'no TV racers falls back to a followed view');
});

test('pixel rects: GL origin bottom-left, flush borders, gutter only between views', () => {
  const [top, bottom] = planViewports('split', ['a', 'b'], null, null).map(v => viewportPixels(v.rect, 1280, 720, 4));
  assert.deepEqual(top, { x: 0, y: 362, w: 1280, h: 358 });
  assert.deepEqual(bottom, { x: 0, y: 0, w: 1280, h: 358 });
  const full = viewportPixels({ x: 0, y: 0, w: 1, h: 1 }, 844, 390, 4);
  assert.deepEqual(full, { x: 0, y: 0, w: 844, h: 390 });
  const quad = planViewports('split', ['a', 'b', 'c', 'd'], null, null).map(v => viewportPixels(v.rect, 1280, 720, 4));
  const px = quad.reduce((s, r) => s + r.w * r.h, 0);
  assert.ok(px < 1280 * 720 && px > 1280 * 720 * 0.98, 'gutters take a thin slice');
});

test('fitFov narrows the vertical field only on very wide viewports', () => {
  assert.equal(fitFov(68, 16 / 9), 68);
  const wide = fitFov(68, 1280 / 358);
  assert.ok(wide < 50 && wide > 35, `stacked view vfov ${wide}`);
});

const racer = (id: string, rank: number, extra: Partial<RacerView> = {}) => ({ id, rank, finishTime: null, connected: true, ...extra }) as RacerView;
const race = (racers: RacerView[], phase: RaceView['phase'] = 'racing') => ({ racers, phase }) as RaceView;

test('director follows the leader, holds ≥ 6 s, cuts on disconnect and after a finish', () => {
  const d = new Director(6, 3.5);
  assert.equal(d.update(race([racer('a', 1), racer('b', 2)]), 0), 'a');
  assert.equal(d.update(race([racer('a', 2), racer('b', 1)]), 2), 'a', 'lead change does not cut before the hold');
  assert.equal(d.update(race([racer('a', 2), racer('b', 1)]), 6.1), 'b', 'cuts to the new leader after the hold');
  assert.equal(d.update(race([racer('a', 1), racer('b', 2, { connected: false })]), 6.5), 'a', 'disconnect cuts at once');
  assert.equal(d.update(race([racer('a', 1, { finishTime: 60 }), racer('b', 2)]), 7), 'a', 'finish celebration plays');
  assert.equal(d.update(race([racer('a', 1, { finishTime: 60 }), racer('b', 2)]), 9), 'a');
  assert.equal(d.update(race([racer('a', 1, { finishTime: 60 }), racer('b', 2)]), 10.6), 'b', 'then cuts to the leader still racing');
  assert.equal(d.update(null, 11), null);
});

test('director holds on a disconnected leader when nobody else is racing (no per-frame cuts)', () => {
  const d = new Director(6, 3.5), done = race([racer('a', 1, { finishTime: 50, connected: false }), racer('b', 2, { finishTime: 55 })]);
  assert.equal(d.update(done, 0), 'a');
  const shot = d.shot;
  for (let t = 0.1; t < 3; t += 0.1) { assert.equal(d.update(done, t), 'a'); assert.equal(d.shot, shot, `no re-cut at ${t.toFixed(1)} s`); }
});

// ---- world generation (pure): synthetic figure-eight with an overpass and a drop edge
import { buildTrack, sampleAt } from '../src/sim/track';
import { buildHeightfield } from '../src/render/world/heightfield';
import { placeScenery } from '../src/render/world/scenery';
import { THEMES } from '../src/render/world/theme';
import type { TrackDef } from '../src/sim/types';

const eight: TrackDef = {
  id: 'palm-bay', name: 'Eight', theme: 'beach', tagline: '',
  points: [
    { x: -40, z: -40, y: 10 }, { x: 0, z: 0, y: 10 }, { x: 40, z: 40, y: 9 }, { x: 100, z: 70, edgeR: 'drop' }, { x: 150, z: 0, edgeR: 'drop' }, { x: 100, z: -70 },
    { x: 40, z: -40, y: 0 }, { x: 0, z: 0, y: 0 }, { x: -40, z: 40, y: 0 }, { x: -100, z: 70 }, { x: -150, z: 0, y: 4 }, { x: -100, z: -70, y: 8 },
  ],
  boostPads: [], ramps: [], itemRows: [], gaps: [], zones: [], obstacles: [], landmarks: [],
};

test('heightfield: ground under the road, lower road wins at an overpass, drops fall away', () => {
  const track = buildTrack(eight), hf = buildHeightfield(track, THEMES.beach.terrain, 7);
  const hiD = track.samples.find(s => Math.hypot(s.x, s.z) < 3 && s.y > 7)!, loD = track.samples.find(s => Math.hypot(s.x, s.z) < 3 && s.y < 2)!;
  assert.ok(hiD && loD, 'the figure-eight crosses itself at two heights');
  assert.ok(hf.heightAt(0, 0) <= loD.y, `crossing ground ${hf.heightAt(0, 0).toFixed(2)} sits at the lower road`);
  for (const f of [0.1, 0.3, 0.6, 0.9]) {
    const s = sampleAt(track, f * track.length), g = hf.heightAt(s.x, s.z);
    if (Math.hypot(s.x, s.z) < 25) continue;
    assert.ok(g <= s.y + 0.01 && g > s.y - 1.2, `ground under road at ${f}: ${g.toFixed(2)} vs ${s.y.toFixed(2)}`);
  }
  const drop = track.samples.find(s => s.edgeR === 'drop' && Math.abs(s.x - 125) < 20)!;
  const out = drop.halfWidth + drop.runoffR + 6, gx = drop.x + drop.rx * out, gz = drop.z + drop.rz * out;
  assert.ok(hf.heightAt(gx, gz) < drop.y - 10, 'beyond a drop edge the ground is far enough below for a fall');
});

test('scenery never lands inside the course (road + apron)', () => {
  for (const theme of Object.values(THEMES).filter(t => !t.space)) {
    const track = buildTrack(eight), hf = buildHeightfield(track, theme.terrain, 3), { props } = placeScenery(track, theme, hf, 0, 3);
    assert.ok(props.length > 50, 'a well-dressed world');
    for (const p of props) {
      if (p.scale < 0) continue;                                  // obstacles sit on the course by design
      let inside = false;
      for (const s of track.samples) {
        const lat = (p.x - s.x) * s.rx + (p.z - s.z) * s.rz, along = (p.x - s.x) * (s.tx / Math.hypot(s.tx, s.tz)) + (p.z - s.z) * (s.tz / Math.hypot(s.tx, s.tz));
        if (Math.abs(along) < track.spacing && Math.abs(lat) < s.halfWidth + (lat < 0 ? s.runoffL : s.runoffR) + 0.5) inside = true;
      }
      assert.ok(!inside, `${p.kind} at ${p.x.toFixed(1)},${p.z.toFixed(1)} is inside the course`);
    }
  }
});

test('heightfield: a river gorge is carved under every gap, clear of the approach and landing', async () => {
  const { getTrack } = await import('../src/tracks/index');
  const track = getTrack('mesa-rally'), g = track.gaps[0];
  assert.ok(g, 'mesa rally has a chasm');
  const hf = buildHeightfield(track, THEMES.desert.terrain, 7), mid = sampleAt(track, (g.d0 + g.d1) / 2);
  assert.equal(hf.canyons.length, track.gaps.length);
  assert.ok(hf.heightAt(mid.x, mid.z) < mid.y - 20, 'the gap is a deep pit, not ground at road height');
  for (const d of [g.d0 - 8, g.d1 + 8]) { const s = sampleAt(track, d); assert.ok(Math.abs(hf.heightAt(s.x, s.z) - (s.y - 0.3)) < 1, `ground stays under the road at d=${d.toFixed(0)}`); }
  const c = hf.canyons[0];
  assert.ok(c.u0 < -20 && c.u1 > 20, 'the gorge runs out beyond both sides of the road');
});

// ---- chase framing: the kart sits whole in the lower half at every split-cell shape
import * as THREE from 'three';
import { CameraRig } from '../src/render/camera';
import { createKartState } from '../src/sim/physics';
import { getTrack } from '../src/tracks/index';

test('chase camera keeps the whole kart in the lower half on full, stacked (4:1) and quad cells', () => {
  const palm = getTrack('palm-bay'), s = sampleAt(palm, 100), heights: number[] = [];
  for (const aspect of [16 / 9, 1240 / 310, 640 / 360]) {
    const k = createKartState(s.x, s.y, s.z, s.heading, palm), rig = new CameraRig(palm, () => -100), cam = new THREE.PerspectiveCamera();
    k.vx = Math.sin(s.heading) * 25; k.vz = Math.cos(s.heading) * 25;
    const poses = new Map([['a', { view: { finishTime: null } as RacerView, kart: k }]]), view = { phase: 'racing', time: 20, speedClass: 100, racers: [] } as unknown as RaceView;
    for (let i = 0; i < 90; i++) rig.update(cam, { rect: { x: 0, y: 0, w: 1, h: 1 }, racerId: 'a', kind: 'chase' }, poses, view, null, 1 / 60, i / 60, false, aspect);
    cam.updateMatrixWorld();
    const y = (h: number) => new THREE.Vector3(k.x, k.y + h, k.z).project(cam).y, bottom = y(0), top = y(1.6);
    assert.ok(bottom > -0.8 && top < 0.1, `aspect ${aspect.toFixed(2)}: kart spans ${bottom.toFixed(2)}..${top.toFixed(2)} (NDC)`);
    heights.push(top - bottom);
  }
  assert.ok(heights[1] < heights[0] * 1.25, `stacked cell kart not magnified (${heights.map(h => h.toFixed(2))})`);
});

test('chase camera stays inside the walls when the kart is angled on the apron', async () => {
  const { pointAt, queryTrack } = await import('../src/sim/track');
  const palm = getTrack('palm-bay'), s = sampleAt(palm, 120), lat = s.halfWidth + s.runoffR - 1.6, p = pointAt(palm, 120, lat);
  const k = createKartState(p.x, p.y, p.z, s.heading + 0.7, palm), rig = new CameraRig(palm, () => -100), cam = new THREE.PerspectiveCamera();
  const poses = new Map([['a', { view: { finishTime: null } as RacerView, kart: k }]]), view = { phase: 'racing', time: 20, speedClass: 100, racers: [] } as unknown as RaceView;
  for (let i = 0; i < 60; i++) rig.update(cam, { rect: { x: 0, y: 0, w: 1, h: 1 }, racerId: 'a', kind: 'chase' }, poses, view, null, 1 / 60, i / 60, false, 16 / 9);
  const q = queryTrack(palm, cam.position.x, cam.position.z, k.hint);
  assert.equal(s.edgeR, 'wall');
  assert.ok(Math.abs(q.lateral) < Math.abs(q.edgeLateral) - 0.4, `camera lateral ${q.lateral.toFixed(2)} inside wall at ${q.edgeLateral.toFixed(2)}`);
});

test('Rainbow Road: floating scenery keeps 3D clearance from the ribbon; features read from the track', async () => {
  const { getTrack } = await import('../src/tracks/index');
  const { courseClearance, placeSpaceScenery } = await import('../src/render/world/space-scenery');
  const track = getTrack('rainbow-road');
  assert.ok(THEMES[track.def.theme].space, 'rainbow road uses the space style (no terrain)');
  const props = placeSpaceScenery(track, 0, 5);
  assert.ok(props.filter(p => p.kind.startsWith('asteroid')).length > 60, 'an asteroid field fills the void');
  for (const p of props) {
    if (p.tilt === undefined) continue;             // authored landmarks/obstacles and the far moon; everything generated tumbles
    assert.ok(courseClearance(track, p.x, p.y, p.z) > 3, `${p.kind} at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)} floats clear of the course`);
  }
  assert.deepEqual(placeSpaceScenery(track, 0, 5), props, 'deterministic');
  assert.ok(placeSpaceScenery(track, 2, 5).length < props.length, 'lower tiers scatter less');
});

test('Rainbow Road: bumpers are drawn at the predicted kart clock (moverTime), else at race.time; no flat planet copy', async () => {
  const { getTrack } = await import('../src/tracks/index');
  const { moverPosition } = await import('../src/sim/track');
  const { buildSpaceFeatures } = await import('../src/render/world/space-features');
  const { PropLibrary } = await import('../src/render/world/props');
  const { placeSpaceScenery } = await import('../src/render/world/space-scenery');
  const track = getTrack('rainbow-road'), none = () => null;
  const f = buildSpaceFeatures(track, 0, new PropLibrary({} as never, true, none), none);
  let mesh: THREE.InstancedMesh | null = null;
  f.group.traverse(o => { if (!mesh && o instanceof THREE.InstancedMesh && o.count === track.movers.length && o.instanceColor) mesh = o; });
  const drawn = (i: number) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(mesh!.instanceMatrix.array as Float32Array, i * 16));
  const race = { time: 10, racers: [] } as unknown as RaceView;
  const off = (i: number, t: number) => { const p = moverPosition(track, track.movers[i], t), v = drawn(i); return Math.hypot(p.x - v.x, p.z - v.z); };
  f.update(race, 1, [], 10.2);                                   // 200 ms of prediction lead
  for (let i = 0; i < track.movers.length; i++) assert.ok(off(i, 10.2) < 0.01, `bumper ${i} drawn where it hits the predicted kart`);
  assert.ok(off(0, 10) > 0.5, 'and not at the (older) interpolated view time');
  f.update(race, 2, []);
  assert.ok(off(0, 10) < 0.01, 'no predicted kart: race.time');
  assert.ok(!placeSpaceScenery(track, 0, 5).some(p => p.kind === 'planet_ringed' && p.scale !== -120), 'only the far moon: the hero planet replaces the landmark copy');
});

// ---- loop-the-loop presentation (DESIGN §9.1): everything is read from loopPose
test('loop frame sits flat on the swept lane, upside down at the top; θ comes from d, so interpolated karts turn smoothly', async () => {
  const { forwardDistance, loopPose } = await import('../src/sim/track');
  const { kartLoop, loopFrame, onLoopFootprint } = await import('../src/render/loop');
  const track = getTrack('rainbow-road'), l = track.loops[0], len = forwardDistance(track, l.d0, l.d1);
  assert.ok(l, 'Rainbow Road has a loop');
  for (let th = 0; th < 6.3; th += 0.25) {
    const F = loopFrame(l, th, 2), p = loopPose(l, th, 2);
    assert.ok(Math.abs(F.fx * p.tx + F.fy * p.ty + F.fz * p.tz - 1) < 1e-9 && Math.hypot(F.x - p.x, F.y - p.y, F.z - p.z) < 1e-9, 'position and forward are loopPose');
    assert.ok(Math.abs(F.ux * l.rx + F.uz * l.rz) < 1e-9 && Math.abs(F.ux * F.fx + F.uy * F.fy + F.uz * F.fz) < 1e-9, `θ ${th.toFixed(2)}: up is the ribbon normal (⟂ lane and tangent)`);
    assert.ok(F.ux * p.ux + F.uy * p.uy + F.uz * p.uz > 0.5, 'on the centre side');
  }
  assert.ok(loopFrame(l, Math.PI, 0).uy < -0.8, 'upside down at the top');
  assert.ok(Math.abs(kartLoop(track, { loop: 0.1, d: l.d0 + len / 4 })!.theta - Math.PI / 2) < 1e-6, 'θ from d, not the stale snapshot field');
  assert.equal(kartLoop(track, { loop: 0, d: l.d0 + 5 }), null);
  assert.ok(onLoopFootprint(track, l.d0 + len / 2) && !onLoopFootprint(track, l.d0 - 1) && !onLoopFootprint(track, l.d1 + 1), 'footprint span');
});

test('loop mesh: swept from loopPose, joins the road at both ends, apron tapers into the lane', async () => {
  const { forwardDistance, loopPose, pointAt } = await import('../src/sim/track');
  const { buildSpaceLoops } = await import('../src/render/world/space-loop');
  const { loopHalfWidth } = await import('../src/render/loop');
  const { Geo } = await import('../src/render/world/geo');
  const track = getTrack('rainbow-road'), l = track.loops[0], hw = loopHalfWidth(track, l), geos = new Map<THREE.Material, InstanceType<typeof Geo>>();
  const m = () => new THREE.MeshBasicMaterial(), mats = { road: m(), apron: m(), under: m(), rail: m(), bar: m() };
  const edgeOf = (s: { halfWidth: number; runoffL: number; runoffR: number }, side: -1 | 1) => side < 0 ? -(s.halfWidth + s.runoffL) : s.halfWidth + s.runoffR;
  const group = buildSpaceLoops({ track, H: 1.2, thick: 0.45, mats, geo: mt => { let g = geos.get(mt); if (!g) geos.set(mt, g = new Geo()); return g; }, edgeOf, lights: [], lightD: [], glow: () => new THREE.ShaderMaterial() });
  assert.equal(group.children.length, 2, 'gateway arches + sign');
  const road = geos.get(mats.road)!, rows = road.count / 8, at = (g: InstanceType<typeof Geo>, i: number) => new THREE.Vector3().fromArray(g.pos, i * 3);
  for (let c = 0; c < 8; c++) {
    const lat = (c / 7 * 2 - 1) * hw, a = pointAt(track, l.d0, lat), b = pointAt(track, l.d1, lat), mid = loopPose(l, Math.PI * 2 * 40 / (rows - 1), lat);
    assert.ok(at(road, c).distanceTo(new THREE.Vector3(a.x, a.y, a.z)) < 0.05, 'first row is the road at d0');
    assert.ok(at(road, (rows - 1) * 8 + c).distanceTo(new THREE.Vector3(b.x, b.y, b.z)) < 0.05, 'last row is the road at d1');
    assert.ok(at(road, 40 * 8 + c).distanceTo(new THREE.Vector3(mid.x, mid.y, mid.z)) < 1e-4, 'rows lie on loopPose');
  }
  // Rail base (−thick along the normal) sits at the funnel wall at the mouth, at the lane edge mid-loop.
  const rail = geos.get(mats.rail)!, lat = (i: number) => { const v = at(rail, i * 2), p = loopPose(l, Math.PI * 2 * i / (rows - 1), 0); return (v.x - p.x) * l.rx + (v.z - p.z) * l.rz; };
  assert.ok(Math.abs(Math.abs(lat(0)) - Math.abs(edgeOf(sampleAt(track, l.d0), -1))) < 0.35, `rail starts at the wall (${lat(0).toFixed(2)})`);
  assert.ok(Math.abs(Math.abs(lat(40)) - hw) < 0.35, 'and runs along the lane edge');
  assert.ok(forwardDistance(track, l.d0, l.d1) > 30);
});

test('chase camera rides a loop: stays off the ribbon, rolls with it, keeps the kart framed, then levels out', async () => {
  const { loopPose } = await import('../src/sim/track');
  const { loopFrame, loopHalfWidth } = await import('../src/render/loop');
  const track = getTrack('rainbow-road'), l = track.loops[0], hw = loopHalfWidth(track, l), TAU = Math.PI * 2, len = l.d1 - l.d0;
  const ribbon: THREE.Vector3[] = [];
  for (let i = 0; i <= 400; i++) for (let j = 0; j <= 8; j++) { const p = loopPose(l, TAU * i / 400, (j / 4 - 1) * hw); ribbon.push(new THREE.Vector3(p.x, p.y, p.z)); }
  for (const lat of [0, hw - 1.2]) {
    const s0 = sampleAt(track, l.d0 - 40), k = createKartState(s0.x, s0.y, s0.z, s0.heading, track), rig = new CameraRig(track, () => -1000), cam = new THREE.PerspectiveCamera();
    const poses = new Map([['a', { view: { finishTime: null } as RacerView, kart: k }]]), view = { phase: 'racing', time: 20, speedClass: 100, racers: [] } as unknown as RaceView;
    const road = (d: number) => { const s = sampleAt(track, d); Object.assign(k, { x: s.x + s.rx * lat, y: s.y, z: s.z + s.rz * lat, d, lateral: lat, heading: s.heading, vx: Math.sin(s.heading) * 18, vy: 0, vz: Math.cos(s.heading) * 18, loop: 0 }); };
    let th = -2, topUp = 0, after = 0;
    for (let f = 0; f < 60 * 8 && after < 90; f++) {
      if (th < 0) { road(l.d0 + th * 18); th += 0.3 / 18; }
      else if (th < TAU) { const p = loopPose(l, th, lat); Object.assign(k, { x: p.x, y: p.y, z: p.z, d: l.d0 + len * th / TAU, lateral: lat, heading: p.heading, vx: p.tx * 18, vy: p.ty * 18, vz: p.tz * 18, loop: th }); th += 0.3 / p.dsdTheta; }
      else { road(l.d1 + (th - TAU) * 18); th += 0.3 / 18; after++; }
      rig.update(cam, { rect: { x: 0, y: 0, w: 1, h: 1 }, racerId: 'a', kind: 'chase' }, poses, view, null, 1 / 60, f / 60, false, 16 / 9);
      if (th < 0.05) continue;
      cam.updateMatrixWorld();
      const clear = Math.min(...ribbon.map(p => p.distanceTo(cam.position))), ndc = new THREE.Vector3(k.x, k.y, k.z).project(cam);
      if (th < TAU) assert.ok(clear > 0.5, `lat ${lat} θ ${th.toFixed(2)}: camera ${clear.toFixed(2)} m off the ribbon`);
      assert.ok(Math.abs(ndc.x) < 0.6 && ndc.y > -0.9 && ndc.y < 0.2 && ndc.z < 1, `lat ${lat} θ ${th.toFixed(2)}: kart framed (${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)})`);
      if (Math.abs(th - Math.PI) < 0.05) { const F = loopFrame(l, th, lat); topUp = cam.up.x * F.ux + cam.up.y * F.uy + cam.up.z * F.uz; }
    }
    assert.ok(topUp > 0.9, `camera up follows the ribbon over the top (${topUp.toFixed(2)})`);
    assert.ok(cam.up.y > 0.98, 'and is level again after the exit');
  }
});
