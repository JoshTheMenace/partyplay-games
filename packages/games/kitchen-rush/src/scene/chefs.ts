// Chef rigs (authored humans, contributor animals or procedural fallbacks) and their procedural animation.
import { Box3, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import type { AnimalKit } from '../assets';
import { RESPAWN_SECONDS, WALK_SPEED, type Chef, type Item } from '../model';
import { chefJoints, type KitchenModels } from '../models';
import type { Kit } from './kit';
import { Shape } from './shapes';

/** Chefs are modelled 1.5 m tall and drawn 18% larger so they read on a TV; collision stays CHEF_RADIUS. */
export const CHEF_SCALE = 1.18, CHEF_HEIGHT = 1.5 * CHEF_SCALE;
const MODEL_HEIGHT = 1.5;
const SKINS = ['#f3cba4', '#d9a47a', '#f7dcc4', '#a8744f', '#e8b890', '#7d5238'];
export type Rig = {
  root: Group; body: Group; head: Object3D; hands: Object3D[]; feet: Object3D[]; hold: Object3D;
  /** 'pivot' rotates exported arm/leg joints; 'float' moves detached hands and feet (Overcooked style). */
  mode: 'pivot' | 'float'; unit: number; handRest: Vector3[]; footRest: Vector3[]; headRest: Vector3;
  // Animation state
  yaw: number; phase: number; vx: number; vz: number; ax: number; az: number; dash: number; pop: number; fallen: boolean; chop: number;
};

function proceduralChef(kit: Kit, color: string, variant: 'chef' | 'chef_f', skin: string) {
  const bake = (shape: Shape, name: string) => { const template = shape.build(kit.materials, name); template.parts.forEach(part => kit.own(part.geometry)); return kit.spawn(template, true); };
  const torso = bake(new Shape()
    .sphere(.3, { at: [0, .47, 0], scale: [1, 1.02, .9], color: '#f8f6f1', segments: 20 })
    .sphere(.3, { at: [0, .4, .07], scale: [.78, .72, .74], color, segments: 20 })
    .torus(.15, .055, { at: [0, .76, .02], rot: [Math.PI / 2, 0, 0], color })
    .sphere(.028, { at: [.1, .62, .245], color: '#d9d4c8' }).sphere(.028, { at: [-.1, .62, .245], color: '#d9d4c8' }), 'chef_torso');
  const tall = variant === 'chef_f';
  const head = new Shape()
    .sphere(.235, { at: [0, .2, 0], color: skin, segments: 20 })
    .sphere(.034, { at: [.085, .23, .2], scale: [1, 1.25, .6], color: '#1e1a1d' }).sphere(.034, { at: [-.085, .23, .2], scale: [1, 1.25, .6], color: '#1e1a1d' })
    .sphere(.012, { at: [.095, .245, .222], color: '#ffffff' }).sphere(.012, { at: [-.075, .245, .222], color: '#ffffff' })
    .sphere(.045, { at: [.14, .15, .175], scale: [1, .6, .5], color: '#f59a8f' }).sphere(.045, { at: [-.14, .15, .175], scale: [1, .6, .5], color: '#f59a8f' })
    .sphere(.03, { at: [0, .17, .235], color: '#e9a482' })
    .cylinder(.17, .16, tall ? .26 : .16, { at: [0, tall ? .5 : .45, 0], color: '#ffffff' })
    .torus(.165, .022, { at: [0, tall ? .39 : .39, 0], rot: [Math.PI / 2, 0, 0], color })
    .sphere(.13, { at: [.08, tall ? .66 : .58, 0], color: '#ffffff' }).sphere(.13, { at: [-.08, tall ? .66 : .58, .02], color: '#ffffff' }).sphere(.12, { at: [0, tall ? .7 : .62, -.06], color: '#ffffff' });
  if (tall) head.sphere(.1, { at: [0, .16, -.2], color: '#5a3322' }).sphere(.19, { at: [0, .27, -.06], scale: [1.05, .5, 1], color: '#5a3322' });
  const hand = () => bake(new Shape().sphere(.085, { color: '#ffffff', scale: [1, .95, 1.05] }), 'chef_hand');
  const foot = () => bake(new Shape().sphere(.1, { at: [0, .045, .02], scale: [1, .55, 1.4], color: '#3a3036' }), 'chef_foot');
  return { torso, head: bake(head, 'chef_head'), hands: [hand(), hand()], feet: [foot(), foot()] };
}

/** Build one chef. Prefers authored `chef`/`chef_f`, then contributor animals, then procedural chefs. */
export function createRig(kit: Kit, models: KitchenModels | null, animals: AnimalKit | null, character: string, color: string, index: number, own: <T extends { dispose(): void }>(r: T) => T): Rig {
  const root = new Group(), body = new Group(), inner = new Group(), hold = new Object3D();
  root.add(body); body.add(inner); hold.position.set(0, .64 * CHEF_SCALE, .4 * CHEF_SCALE); body.add(hold);
  let head: Object3D, hands: Object3D[], feet: Object3D[], mode: Rig['mode'] = 'float', unit = 1;
  const human = character === 'chef_f' ? 'chef_f' : 'chef', animal = ['cat', 'dog', 'iguana', 'axolotl'].includes(character) && animals?.has(`${character}_body`);
  if (animal && animals) {
    const team = own(new MeshStandardMaterial({ color, roughness: .55 }));
    head = new Group(); head.add(animals.create(`${character}_body`)); const tint = animals.create(`${character}_color`); tint.material = team; head.add(tint);
    const pivot = (name: string) => { const mesh = animals.create(name), group = new Group(); group.position.copy(mesh.position); mesh.position.set(0, 0, 0); group.add(mesh); return group; };
    hands = [pivot(`${character}_left_hand`), pivot(`${character}_right_hand`)]; feet = [pivot('chef_left_foot'), pivot('chef_right_foot')];
    inner.add(head, ...hands, ...feet);
  } else if (models?.has(human) && !['cat', 'dog', 'iguana', 'axolotl'].includes(character)) {
    const model = models(human, color); inner.add(model);
    const joints = chefJoints(model); head = joints.head; hands = joints.arms; feet = joints.legs; mode = 'pivot';
  } else {
    const parts = proceduralChef(kit, color, character === 'chef_f' ? 'chef_f' : 'chef', SKINS[index % SKINS.length]);
    head = parts.head; head.position.set(0, .78, 0); hands = parts.hands; feet = parts.feet;
    hands[0].position.set(-.34, .46, .06); hands[1].position.set(.34, .46, .06); feet[0].position.set(-.13, 0, 0); feet[1].position.set(.13, 0, 0);
    inner.add(parts.torso, head, ...hands, ...feet);
  }
  // Normalise height so every chef shares nameplate, hold and collision proportions (`unit`), then enlarge the whole rig.
  const box = new Box3().setFromObject(inner), height = box.max.y - Math.min(0, box.min.y);
  if (height > .2 && Math.abs(height - MODEL_HEIGHT) > .08) unit = MODEL_HEIGHT / height;
  inner.scale.setScalar(unit * CHEF_SCALE);
  // The sun's shadow map is baked once for the static kitchen; chefs ground themselves with blob shadows instead.
  inner.traverse(object => { if (object instanceof Mesh) object.castShadow = false; });
  return {
    root, body, head, hands, feet, hold, mode, unit,
    handRest: hands.map(hand => hand.position.clone()), footRest: feet.map(foot => foot.position.clone()), headRest: head.position.clone(),
    yaw: 0, phase: index, vx: 0, vz: 0, ax: 0, az: 0, dash: 0, pop: 1, fallen: false, chop: 0,
  };
}

const damp = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
function angleTo(from: number, to: number) { let d = (to - from) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }

export type Pose = { chef: Chef; x: number; z: number; vx: number; vz: number; fx: number; fz: number; now: number; t: number; dt: number; still: boolean; held: Item | null };
/**
 * Animate one chef for this frame. `t` is local seconds; `still` (reduced motion) keeps essential state
 * (position, facing, carrying, falling) but drops bobbing, squash, leaning and flourish.
 */
export function animateRig(rig: Rig, pose: Pose) {
  const { chef, dt, t, still } = pose, motion = still ? 0 : 1;
  rig.root.position.set(pose.x, 0, pose.z);
  if (Math.hypot(pose.fx, pose.fz) > .01) { const target = Math.atan2(pose.fx, pose.fz); rig.yaw += angleTo(rig.yaw, target) * (1 - Math.exp(-(still ? 60 : 22) * dt)); }
  rig.root.rotation.y = rig.yaw;
  // Smoothed acceleration in the chef's own frame drives the lean.
  if (dt > 0) { rig.ax = damp(rig.ax, (pose.vx - rig.vx) / dt, 10, dt); rig.az = damp(rig.az, (pose.vz - rig.vz) / dt, 10, dt); }
  rig.vx = pose.vx; rig.vz = pose.vz;
  const speed = Math.hypot(pose.vx, pose.vz), move = clamp(speed / WALK_SPEED, 0, 1.4), sin = Math.sin(rig.yaw), cos = Math.cos(rig.yaw);
  const forward = clamp((rig.ax * sin + rig.az * cos) / 60, -1, 1), side = clamp((rig.ax * cos - rig.az * sin) / 60, -1, 1);
  rig.phase += Math.min(speed, 7) * dt * 3.1;
  rig.dash = damp(rig.dash, chef.dashing ? 1 : 0, chef.dashing ? 30 : 9, dt);
  const step = Math.sin(rig.phase), bounce = Math.abs(Math.cos(rig.phase)) * Math.min(1, move);
  // Squash and stretch: rise on each step, stretch along the dash.
  const stretch = 1 + motion * (.07 * (bounce - .5) * Math.min(1, move) - .1 * rig.dash);
  const long = 1 + motion * .3 * rig.dash, wide = 1 / Math.sqrt(stretch * long);
  // Falling into a gap, then a springy respawn pop.
  const fallFor = chef.respawnAt > 0 ? (pose.now - (chef.respawnAt - RESPAWN_SECONDS * 1000)) / 1000 : -1;
  if (fallFor >= 0) rig.fallen = true;
  else if (rig.fallen) { rig.fallen = false; rig.pop = 0; }
  rig.pop = Math.min(1, rig.pop + dt / .6);
  const pop = still || rig.pop >= 1 ? 1 : 1 - Math.exp(-7 * rig.pop) * Math.cos(13 * rig.pop);
  // A cartoon hop and hang (skipped under reduced motion), then an accelerating drop that shrinks away.
  const hop = still ? 0 : .2, drop = fallFor - hop;
  const sink = fallFor < 0 ? 0 : drop < 0 ? -Math.sin(fallFor / hop * Math.PI) * .3 : Math.min(3, drop * drop * 8 + drop * .5);
  rig.root.visible = drop < .8;
  const shrink = drop > 0 ? Math.max(0, 1 - drop) : 1;
  rig.body.scale.set(wide * pop * shrink, stretch * pop * shrink, long * wide * pop * shrink);
  rig.body.position.y = motion * bounce * .07 - sink;
  rig.body.rotation.set(motion * (move * .1 + forward * .22 + rig.dash * .3) + (chef.connected ? 0 : .25), drop > 0 && !still ? drop * 10 : 0, motion * -side * .18);
  // Head follows with a little lag and nods while working.
  const working = chef.work !== 'none';
  rig.head.rotation.x = motion * (working ? .18 + Math.sin(t * 14) * .06 : -forward * .1) + (chef.connected ? 0 : .4);
  rig.head.rotation.z = motion * (working ? 0 : Math.sin(t * 1.3 + rig.phase * .1) * .04);
  // Feet and legs.
  for (let i = 0; i < 2; i++) {
    const swing = Math.sin(rig.phase + i * Math.PI) * Math.min(1, move);
    if (rig.mode === 'pivot') rig.feet[i].rotation.x = swing * .8 * (still ? .5 : 1);
    else { const rest = rig.footRest[i], u = 1 / rig.unit; rig.feet[i].position.set(rest.x, rest.y + Math.max(0, -Math.cos(rig.phase + i * Math.PI)) * .07 * Math.min(1, move) * u, rest.z + swing * .14 * u); }
  }
  // Hands: carry, chop, wash, spray or swing.
  const carry = !!pose.held, chop = chef.work === 'chop', wash = chef.work === 'wash', spray = chef.work === 'spray' || pose.held?.kind === 'extinguisher';
  if (chop) rig.chop += dt;
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1, swing = -step * Math.min(1, move) * (i ? 1 : -1);
    if (rig.mode === 'pivot') {
      const arm = rig.hands[i];
      if (carry) arm.rotation.set(-1.35 + motion * Math.sin(t * 9) * .03, 0, -side * .12);
      else if (chop) arm.rotation.set(i ? -1.1 + Math.sin(t * 15) * .5 * (still ? .3 : 1) : -.9, 0, 0);
      else if (wash) arm.rotation.set(-1.05 + Math.sin(t * 9 + i * Math.PI) * .22, 0, -side * .1);
      else arm.rotation.set(swing * .55 * motion, 0, side * .06);
      continue;
    }
    const rest = rig.handRest[i];
    let x = rest.x * rig.unit, y = rest.y * rig.unit, z = rest.z * rig.unit;
    if (carry || spray) { x = side * .21; y = .62 + motion * Math.sin(t * 9 + i) * .01; z = .34; if (spray && chef.work === 'spray') { y += motion * Math.sin(t * 40) * .012; } }
    else if (chop) { if (i) { x = .2; y = .74 + Math.abs(Math.sin(t * 7.5)) * .2 * (still ? .3 : 1); z = .42; } else { x = -.18; y = .66; z = .44; } }
    else if (wash) { x = side * .17 + Math.cos(t * 9 + i * Math.PI) * .06 * motion; y = .62 + Math.sin(t * 9 + i * Math.PI) * .04 * motion; z = .42; }
    else { z += swing * .14 * motion; y += motion * (Math.sin(t * 2.2 + i) * .012 + Math.abs(swing) * .03); }
    rig.hands[i].position.set(x / rig.unit, y / rig.unit, z / rig.unit);
  }
  rig.hold.position.set(0, (.64 + motion * bounce * .02) * CHEF_SCALE, .4 * CHEF_SCALE);
  return fallFor;
}
