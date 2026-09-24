import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Quaternion, Scene, Vector3, type Bone } from 'three';
import { MOVE_SOURCES, POSES, ROSTER, type FighterKind, type FighterState, type FighterView, type LiveHit, type MoveId } from '../src/model';
import { MOVESET, PHYSICS } from '../src/moveset';
import { FighterActor, type ActorContext } from '../src/scene/fighter/actor';
import { pose, type Clock, type MoveInfo } from '../src/scene/fighter/animate';
import { FighterCache } from '../src/scene/fighter/cache';
import { FAMILIES, styleOf } from '../src/scene/fighter/library';
import { moveInfo, overrides } from '../src/scene/fighter/moves';
import { BASE, finite } from '../src/scene/fighter/pose';
import { prepareModel } from '../src/scene/fighter/prepare';
import { keyedLoader } from '../src/scene/fighter/queue';
import { Rig } from '../src/scene/fighter/rig';
import { mannequin } from '../tools/pose-lab/mannequin';

const STATES = ['idle', 'walk', 'run', 'turn', 'crouch', 'jumpsquat', 'air', 'land', 'attack', 'hitstun', 'tumble', 'shield', 'shieldstun', 'dizzy', 'roll', 'spotdodge', 'airdodge',
  'helpless', 'ledge', 'ledgeclimb', 'grab', 'grabbed', 'thrown', 'knockdown', 'getup', 'tech', 'teeter', 'respawn', 'out'] as const satisfies readonly FighterState[];
// Compile-time: the list above names every FighterState.
const everyState: Exclude<FighterState, typeof STATES[number]> extends never ? true : false = true;
/** One fighter per body treatment: humanoid, round, giant hand, flat, sword, quadruped runner, wireframe, bag, heavy. */
const BODIES: FighterKind[] = ['mario', 'kirby', 'master-hand', 'game-watch', 'link', 'pikachu', 'female-wireframe', 'sandbag', 'bowser', 'jigglypuff', 'samus', 'peach'];
const clock = (f: number, seconds = 1): Clock => ({ state: f, move: f, seconds, gait: (f * .037) % 1, airJump: f });
const anim = (o: Partial<FighterView> = {}) => ({ state: 'idle', move: null, grounded: true, vx: 0, vy: 0, facing: 1, charge: 0, launch: 0, shield: 100, intangible: false, hitlag: 0, stateFrame: 0, ...o }) as FighterView;
const view = (kind: FighterKind, o: Partial<FighterView> = {}): FighterView => ({ id: 'p1', name: 'P1', color: '#ff5050', fighter: kind, costume: 0, team: null, cpu: null, connected: true,
  x: 0, y: 0, vx: 0, vy: 0, facing: 1, grounded: true, state: 'idle', stateFrame: 0, move: null, moveFrame: 0, charge: 0, hitlag: 0, damage: 0, stocks: 4, kos: 0, falls: 0, shield: 100,
  jumpsLeft: 1, intangible: false, armored: false, launch: 0, combo: 0, ...o });
const ctx = (dt = 1 / 60, seconds = 1): ActorContext => ({ dt, seconds, reduced: false, cameraDistance: 14, platforms: [{ left: -8, right: 8, y: 0 }] });
const actorFor = (kind: FighterKind, cache = new FighterCache(), o: Partial<FighterView> = {}) =>
  new FighterActor({ view: view(kind, o), model: prepareModel(kind, mannequin(kind, undefined, { sword: kind === 'link', scarf: true }), []), cache });
const STATE_VIEW: Partial<Record<FighterState, Partial<FighterView>>> = {
  walk: { vx: .06 }, run: { vx: .15 }, turn: { vx: -.05 }, air: { grounded: false, vy: .1 }, hitstun: { vx: -.12, vy: .08, launch: .14, grounded: false }, tumble: { vx: .15, vy: .12, launch: .2, grounded: false },
  shieldstun: { shield: 20 }, roll: { vx: .08 }, airdodge: { grounded: false, vx: .05, vy: -.05 }, helpless: { grounded: false, vy: -.05 }, ledge: { grounded: false, ledgeSide: 1 },
  thrown: { grounded: false, vx: .1, vy: .1 }, getup: { vx: .04 }, tech: { vx: .06 }, respawn: { intangible: true }, dizzy: { asleep: true },
};
const finiteBones = (actor: FighterActor) => actor.rig.bonesDriven.every(b => b.matrixWorld.elements.every(Number.isFinite) && b.quaternion.toArray().every(Number.isFinite));
const angles = (bones: readonly Bone[]) => bones.map(b => b.getWorldQuaternion(new Quaternion()));

test('every FighterState resolves to a finite pose for every body treatment', () => {
  assert.equal(everyState, true);
  for (const kind of BODIES) {
    const style = styleOf(kind);
    for (const state of STATES) for (const f of [0, 1, 3, 7, 15, 30, 90]) {
      const { pose: p, meta } = pose(anim({ state, stateFrame: f, ...STATE_VIEW[state] }), clock(f, f / 60), style, null);
      assert.ok(finite(p), `${kind} ${state} f${f}`);
      assert.ok(meta.blend >= 4 && meta.blend <= 6, `${kind} ${state} blends in 4–6 frames`);
      assert.ok(meta.fade >= 0 && meta.fade <= 1);
    }
  }
});

test('every Pose family has authored anticipation, strike and follow-through', () => {
  for (const name of POSES) {
    const fam = FAMILIES[name];
    assert.ok(fam, name);
    if (name === 'taunt') continue; // per-style taunts
    const info: MoveInfo = { pose: name, limb: 'handR', total: 32, start: 8, end: 14, charge: null };
    for (const kind of BODIES) {
      const style = styleOf(kind), at = (f: number) => pose(anim({ state: 'attack', move: 'jab1' }), clock(f), style, info).pose;
      for (let f = 0; f <= 34; f++) assert.ok(finite(at(f)), `${kind} ${name} f${f}`);
      const moved = (a: Float32Array, b: Float32Array) => a.some((x, i) => Math.abs(x - b[i]) > 1e-3);
      assert.ok(moved(at(0), at(7)), `${kind} ${name}: anticipation moves`);
      assert.ok(moved(at(7), at(10)), `${kind} ${name}: strike differs from wind-up`);
    }
  }
});

test('every imported move of every fighter animates without NaN, keyed to its own frame data', () => {
  let moves = 0;
  for (const kind of ROSTER) {
    const style = styleOf(kind);
    for (const id of Object.keys(MOVE_SOURCES) as MoveId[]) {
      const def = MOVESET[kind][id]; if (!def) continue;
      const info = moveInfo(kind, id); moves++;
      assert.ok(info.start < info.end && info.end <= info.total + 1, `${kind} ${id} phases`); // a charge lead-in is all wind-up (end = total + 1)
      if (def.windows.length) assert.equal(info.start, Math.min(def.windows[0].from, info.total - 1), `${kind} ${id} strike starts on the first active frame`);
      for (let f = 0; f <= info.total + 2; f += 2) for (const grounded of [true, false]) {
        const p = pose(anim({ state: 'attack', move: id, grounded, charge: info.charge !== null ? .5 : 0 }), clock(f), style, info).pose;
        assert.ok(finite(p), `${kind} ${id} f${f}`);
      }
    }
  }
  assert.ok(moves > 33 * 30, `${moves} moves`);
});

test('actors drive every state and move on real bone hierarchies without NaN', () => {
  const cache = new FighterCache();
  for (const kind of BODIES) {
    const actor = actorFor(kind, cache);
    for (const state of STATES) for (let f = 0; f < 24; f++) actor.update(view(kind, { state, stateFrame: f, y: state === 'air' ? 1 : 0, ...STATE_VIEW[state] }), undefined, ctx(1 / 60, f / 60));
    assert.ok(finiteBones(actor), `${kind} states`);
    for (const id of ['jab1', 'fsmash', 'fair', 'dair', 'uspecial', 'grab', 'taunt'] as MoveId[]) {
      const def = MOVESET[kind][id]; if (!def) continue;
      for (let f = 0; f < def.total; f++) {
        const w = def.windows.find(w => f >= w.from && f < w.to), hits: LiveHit[] = w ? w.hitboxes.map(h => ({ x: h.x, y: h.y + (id === 'fair' || id === 'dair' ? 1 : 0), r: h.r, limb: h.limb ?? 'body' })) : [];
        actor.update(view(kind, { state: 'attack', move: id, moveFrame: f, stateFrame: f, hits, hitlag: f === (w?.from ?? -1) ? 4 : 0, grounded: id !== 'fair' && id !== 'dair', y: id === 'fair' || id === 'dair' ? 1 : 0 }), undefined, ctx());
      }
      assert.ok(finiteBones(actor), `${kind} ${id}`);
    }
    actor.dispose();
  }
  cache.dispose();
});

test('two-bone IK lands hands and feet on reachable targets and clamps unreachable ones', () => {
  const rig = new Rig(mannequin('mario')), I = new Matrix4(), tip = new Vector3();
  const shoulder = rig.bones.upperarm_R!.getWorldPosition(new Vector3()), hip = rig.bones.thigh_R!.getWorldPosition(new Vector3());
  const targets: [('handR' | 'footR'), Vector3][] = [
    ['handR', shoulder.clone().add(new Vector3(0, .1, .8 * rig.armLen))], ['handR', shoulder.clone().add(new Vector3(-.2, .5 * rig.armLen, .4 * rig.armLen))],
    ['handR', shoulder.clone().add(new Vector3(0, -.6 * rig.armLen, .3 * rig.armLen))], ['footR', hip.clone().add(new Vector3(0, -.5 * rig.legLen, .6 * rig.legLen))],
    ['footR', hip.clone().add(new Vector3(0, -.3 * rig.legLen, .75 * rig.legLen))],
  ];
  for (const [limb, target] of targets) {
    rig.solve(BASE, I, { reach: { limb, target, weight: 1 } }); rig.model.updateMatrixWorld(true);
    assert.ok(rig.limbTip(limb, tip).distanceTo(target) < .01, `${limb} reaches ${target.toArray().map(n => n.toFixed(2))}: ${tip.distanceTo(target).toFixed(4)}`);
  }
  const far = shoulder.clone().add(new Vector3(0, 0, 5));
  rig.solve(BASE, I, { reach: { limb: 'handR', target: far, weight: 1 } }); rig.model.updateMatrixWorld(true);
  const reach = rig.limbTip('handR', tip).distanceTo(shoulder);
  assert.ok(reach <= rig.armLen * 1.001 && reach > rig.armLen * .98, 'straight arm toward an unreachable target');
  assert.ok(tip.z > shoulder.z + rig.armLen * .95, 'pointing at it');
});

test('state changes cross-fade: no pops, settled within the blend window', () => {
  const actor = actorFor('mario'), bones = actor.rig.bonesDriven;
  for (let f = 0; f < 30; f++) actor.update(view('mario', { stateFrame: f }), undefined, ctx(1 / 60, f / 60));
  const steps: number[] = [];
  let prev = angles(bones);
  for (let f = 0; f < 12; f++) {
    actor.update(view('mario', { state: 'crouch', stateFrame: f }), undefined, ctx(1 / 60, (30 + f) / 60));
    const now = angles(bones); steps.push(Math.max(...now.map((q, i) => q.angleTo(prev[i])))); prev = now;
  }
  // The same switch without blending, for scale.
  const snap = actorFor('mario');
  snap.update(view('mario', { stateFrame: 29 }), undefined, ctx(0, 29 / 60));
  const before = angles(bones.map(b => snap.rig.bones[b.name as 'hips']!)); snap.reset();
  snap.update(view('mario', { state: 'crouch', stateFrame: 11 }), undefined, ctx(0, 41 / 60));
  const jump = Math.max(...before.map((q, i) => q.angleTo(snap.rig.bones[bones[i].name as 'hips']!.getWorldQuaternion(new Quaternion()))));
  assert.ok(jump > .3, `crouch is a real change (${jump.toFixed(2)} rad)`);
  assert.ok(steps[0] < jump * .45, `first blended frame moves ${steps[0].toFixed(3)} of ${jump.toFixed(3)} rad`);
  assert.ok(Math.max(...steps.slice(7)) < .05, `settled after the blend (${steps.slice(7).map(s => s.toFixed(3))})`);
});

test('props appear only for the moves that use them', () => {
  const actor = actorFor('kirby'), prop = actor.rig.bones.prop!;
  actor.update(view('kirby'), undefined, ctx(0));
  assert.ok(prop.scale.x < .01, 'Kirby hides the hammer at rest');
  for (let f = 0; f < 8; f++) actor.update(view('kirby', { state: 'attack', move: 'sspecial', moveFrame: f, stateFrame: f }), undefined, ctx());
  assert.equal(prop.scale.x, 1, 'Hammer shown for Side Special');
  for (let f = 0; f < 8; f++) actor.update(view('kirby', { stateFrame: f }), undefined, ctx());
  assert.ok(prop.scale.x < .01, 'and tucked away after');
  const link = actorFor('link');
  link.update(view('link'), undefined, ctx(0));
  assert.equal(link.rig.bones.prop!.scale.x, 1, 'swords stay drawn');
});

test('lying poses rest the mesh on the floor, round bodies included', () => {
  for (const kind of ['mario', 'kirby', 'bowser'] as FighterKind[]) {
    const actor = actorFor(kind);
    for (let f = 0; f < 40; f++) actor.update(view(kind, { state: 'knockdown', stateFrame: f, x: 1, y: .5 }), undefined, ctx(1 / 60, f / 60));
    const low = (actor as unknown as { lowest(): number }).lowest();
    assert.ok(Math.abs(low - .5) < .03, `${kind} lowest point ${low.toFixed(3)}`);
  }
});

test('actors sit in a scene, recolor per costume, feed fx and dispose cleanly', () => {
  const scene = new Scene(), seen: string[] = [];
  scene.userData.skyClashFxFeed = (f: FighterView) => seen.push(f.state);
  const actor = actorFor('mario'); scene.add(actor.group);
  actor.update(view('mario', { costume: 1 }), undefined, ctx());
  actor.update(view('mario', { state: 'run', vx: PHYSICS.mario.run }), undefined, ctx());
  assert.deepEqual(seen, ['idle', 'run']);
  actor.update(view('mario', { state: 'out' }), undefined, ctx());
  assert.equal(actor.group.visible, false);
  actor.dispose();
  assert.equal(scene.children.length, 0);
});

test('model loading shares jobs, bounds concurrency and cancels unneeded work', async () => {
  let active = 0, peak = 0, runs = 0, aborted = 0;
  const loader = keyedLoader<string, string>((key, signal) => new Promise((resolve, reject) => {
    runs++; active++; peak = Math.max(peak, active);
    const t = setTimeout(() => { active--; resolve(key.toUpperCase()); }, 5);
    signal.addEventListener('abort', () => { clearTimeout(t); active--; aborted++; reject(new Error('aborted')); });
  }), 3);
  const a = new AbortController(), b = new AbortController();
  const [x, y] = await Promise.all([loader.load(['a', 'b', 'c', 'd', 'e', 'a'], a.signal), loader.load(['a', 'e'], b.signal)]);
  assert.deepEqual([...x.values()], ['A', 'B', 'C', 'D', 'E']); assert.equal(y.get('e'), 'E');
  assert.equal(runs, 5, 'one job per key'); assert.ok(peak <= 3, `peak ${peak}`);
  await loader.load(['a'], new AbortController().signal); assert.equal(runs, 5, 'cached for the page');
  const c = new AbortController(), pending = loader.load(['f', 'g'], c.signal); c.abort();
  await assert.rejects(pending);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(aborted, 2, 'started jobs nobody needs are aborted');
  assert.equal(loader.running, 0);
  assert.equal((await loader.load(['f'], new AbortController().signal)).get('f'), 'F', 'a cancelled key can load later');
});

test('no overrides leak between tools and the game', () => assert.equal(overrides.get, null));

test('special phases: charges lead into a held coil and release wound up; reflectors and blasters hold the action', () => {
  const start = moveInfo('link', 'nspecial', 'Start'), loop = moveInfo('link', 'nspecial', 'Loop'), end = moveInfo('link', 'nspecial', 'End');
  assert.ok(start.start >= start.total, 'the draw is all anticipation');
  assert.equal(loop.hold, 'wind'); assert.equal(end.windup, true);
  assert.equal(moveInfo('fox', 'dspecial', 'Loop').hold, 'strike'); assert.equal(moveInfo('fox', 'nspecial', 'Loop').hold, 'strike');
  assert.ok(moveInfo('link', 'nspecial').family, 'Link shoots with a bow family');
});

test('Link draws a bow (sword retracted, arrow nocked until release) and holds the bomb until it is thrown', () => {
  const cache = new FighterCache(), actor = new FighterActor({ view: view('link'), model: prepareModel('link', mannequin('link', undefined, { sword: true, scarf: true }), [], 'always'), cache });
  const shown = (name: string) => { let on = false; actor.group.traverse(o => { if (o.name === name) on = o.visible; }); return on; };
  const items = () => (actor as unknown as { held: { count: number } }).held.count;
  for (let f = 0; f < 20; f++) actor.update(view('link', { state: 'attack', move: 'nspecial', movePhase: 'Loop', moveFrame: f, charge: .5 }), undefined, ctx(1 / 60, f / 60));
  assert.equal(items(), 1, 'bow shown');
  assert.ok((actor.rig.bones.prop?.scale.x ?? 0) < .05, 'sword retracted while shooting');
  assert.ok(shown('held-props'));
  const info = moveInfo('link', 'dspecial');
  actor.update(view('link', { state: 'attack', move: 'dspecial', moveFrame: Math.floor(info.start * .6) }), undefined, ctx());
  assert.equal(items(), 1, 'bomb in hand before the throw');
  for (let f = info.start; f < info.start + 3; f++) actor.update(view('link', { state: 'attack', move: 'dspecial', moveFrame: f }), undefined, ctx());
  assert.equal(items(), 0, 'the thrown bomb leaves the hand');
  actor.dispose(); cache.dispose();
});

test('swing trails smear active frames with bounded samples and clear on reset', () => {
  const cache = new FighterCache(), actor = new FighterActor({ view: view('marth'), model: prepareModel('marth', mannequin('marth', undefined, { sword: true }), [], 'always'), cache });
  const trail = (actor as unknown as { trail: { samples: number; mesh: { visible: boolean } } }).trail, info = moveInfo('marth', 'ftilt');
  for (let f = 0; f <= info.start + 2; f++) actor.update(view('marth', { state: 'attack', move: 'ftilt', moveFrame: f }), undefined, ctx(1 / 60, f / 60));
  assert.ok(trail.samples > 2 && trail.samples <= 48 && trail.mesh.visible, `${trail.samples} samples`);
  for (let f = 0; f < 30; f++) actor.update(view('marth'), undefined, ctx(1 / 60, 1 + f / 60));
  assert.equal(trail.mesh.visible, false, 'the smear fades out');
  actor.dispose(); cache.dispose();
});
