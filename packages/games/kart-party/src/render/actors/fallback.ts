/* Primitive stand-ins that follow the karts.glb / props.glb node contract (DESIGN §7) exactly, so the
 * rig code is identical whether or not the Blender assets loaded. Parts are baked into a few
 * vertex-coloured meshes per rigid node (cheap draw calls). Templates are built once per page and
 * shared: callers clone() them (geometry + materials shared; the rig clones materials it tints). */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHARACTERS } from '../../sim/stats';
import type { KartBodyId } from '../../sim/types';

type V3 = [number, number, number];
type Piece = [geometry: THREE.BufferGeometry, color: number | string, position?: V3, rotation?: V3, scale?: V3];
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();

/** Bake pieces (transform + flat colour) into one vertex-coloured geometry. */
export function bake(pieces: Piece[]): THREE.BufferGeometry {
  const parts = pieces.map(([g, color, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]]) => {
    const geo = (g.index ? g.toNonIndexed() : g.clone());
    for (const key of Object.keys(geo.attributes)) if (key !== 'position' && key !== 'normal') geo.deleteAttribute(key);
    geo.applyMatrix4(m4.compose(new THREE.Vector3(...p), q.setFromEuler(e.set(...r)), new THREE.Vector3(...s)));
    c.set(color);
    const n = geo.getAttribute('position').count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  });
  const merged = mergeGeometries(parts)!;
  parts.forEach(p => p.dispose());
  merged.computeBoundingSphere(); merged.computeBoundingBox();
  return merged;
}
const box = (w: number, h: number, d: number, r = .08) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - .001, h / 2 - .001, d / 2 - .001));
const sphere = (r = 1, w = 18, h = 12) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt: number, rb: number, h: number, seg = 18) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r: number, h: number, seg = 14) => new THREE.ConeGeometry(r, h, seg);
const torus = (r: number, t: number, seg = 22) => new THREE.TorusGeometry(r, t, 8, seg);
const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 10);

const mats = new Map<string, THREE.Material>();
function material(key: string, make: () => THREE.Material) { let m = mats.get(key); if (!m) mats.set(key, m = make()); return m; }
const trim = () => material('trim', () => new THREE.MeshStandardMaterial({ name: 'kart_trim', vertexColors: true, roughness: .55, metalness: .05 }));
const metal = () => material('metal', () => new THREE.MeshStandardMaterial({ name: 'kart_metal', vertexColors: true, roughness: .28, metalness: .85 }));
const paint = () => material('paint', () => new THREE.MeshStandardMaterial({ name: 'kart_paint', vertexColors: true, roughness: .32, metalness: .25 }));
const glow = () => material('glow', () => new THREE.MeshStandardMaterial({ name: 'glow', vertexColors: true, roughness: .4, emissive: 0xffffff, emissiveIntensity: .35 }));
const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, name = '') => { const m = new THREE.Mesh(geo, mat); m.name = name; return m; };
const node = (name: string, x = 0, y = 0, z = 0, ...children: THREE.Object3D[]) => { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); if (children.length) g.add(...children); return g; };

/* ---------------- karts ---------------- */
type KartSpec = { len: number; wid: number; frontR: number; rearR: number; frontW: number; rearW: number; axleF: number; axleR: number; trackF: number; trackR: number; seatZ: number };
const SPECS: Record<KartBodyId, KartSpec> = {
  zoomer: { len: 2.55, wid: 1.45, frontR: .33, rearR: .4, frontW: .3, rearW: .38, axleF: .98, axleR: -.92, trackF: .9, trackR: .92, seatZ: -.3 },
  bolt: { len: 2.8, wid: 1.3, frontR: .3, rearR: .38, frontW: .26, rearW: .4, axleF: 1.1, axleR: -.98, trackF: .86, trackR: .9, seatZ: -.32 },
  tank: { len: 2.5, wid: 1.65, frontR: .38, rearR: .47, frontW: .36, rearW: .46, axleF: .95, axleR: -.9, trackF: .98, trackR: 1.0, seatZ: -.28 },
};
const DARK = 0x23262e, SEAT = 0x2b2f3a, WHITE = 0xf4f4f0, CHROME = 0xd9dde3, GUN = 0x555b66, RUBBER = 0x1b1c20;

function wheelGeometry(r: number, w: number, hub: number) {
  const z90: V3 = [0, 0, Math.PI / 2];
  return bake([[cyl(r, r, w, 22), RUBBER, [0, 0, 0], z90], [torus(r * .82, r * .2, 22), 0x2a2b30, [w * .5, 0, 0], [0, Math.PI / 2, 0]],
    [torus(r * .82, r * .2, 22), 0x2a2b30, [-w * .5, 0, 0], [0, Math.PI / 2, 0]], [cyl(r * .56, r * .56, w + .04, 16), hub, [0, 0, 0], z90],
    [cyl(r * .2, r * .2, w + .08, 10), CHROME, [0, 0, 0], z90]]);
}

function buildKart(id: KartBodyId): THREE.Group {
  const s = SPECS[id], L = s.len, W = s.wid, root = node(`kart_${id}`);
  const paintParts: Piece[] = [], trimParts: Piece[] = [], metalParts: Piece[] = [];
  if (id === 'bolt') {
    paintParts.push([box(W * .8, .3, L * .82, .12), 0xffffff, [0, .42, -.05]], [box(W * .55, .24, .9, .1), 0xffffff, [0, .42, L * .45], [-.12, 0, 0]],
      [cone(.2, .5, 12), 0xffffff, [0, .4, L * .56], [Math.PI / 2, 0, 0], [1.4, 1, .6]], [box(.34, .28, 1.2, .12), 0xffffff, [W * .44, .4, .05]], [box(.34, .28, 1.2, .12), 0xffffff, [-W * .44, .4, .05]],
      [box(1.6, .06, .42, .03), 0xffffff, [0, 1.02, -L * .47]]);
    trimParts.push([box(.08, .5, .2, .03), DARK, [.5, .78, -L * .45]], [box(.08, .5, .2, .03), DARK, [-.5, .78, -L * .45]],
      [box(1.62, .03, .1, .01), WHITE, [0, 1.06, -L * .41]], [box(W * .82, .03, .5, .01), WHITE, [0, .58, .55]]);
  } else if (id === 'tank') {
    paintParts.push([box(W * .88, .42, L * .8, .16), 0xffffff, [0, .5, -.05]], [box(W * .78, .34, .75, .14), 0xffffff, [0, .52, L * .38]],
      [box(.4, .42, 1.25, .14), 0xffffff, [W * .5, .5, 0]], [box(.4, .42, 1.25, .14), 0xffffff, [-W * .5, .5, 0]]);
    trimParts.push([box(W * 1.02, .22, .28, .08), DARK, [0, .36, L * .52]], [box(W * .7, .06, .32, .02), WHITE, [0, .74, L * .36]]);
    metalParts.push([torus(.58, .05, 20), GUN, [0, .78, -.62], [0, 0, 0], [1, 1.25, 1]], [cyl(.05, .05, .9, 8), GUN, [0, .98, L * .5], [0, 0, Math.PI / 2]],
      [cyl(.05, .05, .5, 8), GUN, [.42, .75, L * .5]], [cyl(.05, .05, .5, 8), GUN, [-.42, .75, L * .5]]);
  } else {
    paintParts.push([box(W * .84, .34, L * .8, .14), 0xffffff, [0, .45, -.05]], [box(W * .7, .3, .8, .13), 0xffffff, [0, .46, L * .4], [-.08, 0, 0]],
      [box(.36, .32, 1.3, .14), 0xffffff, [W * .47, .43, .08]], [box(.36, .32, 1.3, .14), 0xffffff, [-W * .47, .43, .08]]);
    trimParts.push([box(W * .95, .18, .24, .08), DARK, [0, .32, L * .53]], [box(.38, .04, 1.1, .01), WHITE, [W * .47, .6, .08]], [box(.38, .04, 1.1, .01), WHITE, [-W * .47, .6, .08]]);
  }
  // Shared: seat, floor pan, engine block, number disc, steering column.
  trimParts.push([box(W * .7, .1, L * .7, .04), DARK, [0, .24, -.05]], [box(.74, .2, .6, .09), SEAT, [0, .66, s.seatZ]], [box(.72, .62, .18, .09), SEAT, [0, .92, s.seatZ - .32], [-.2, 0, 0]],
    [cyl(.035, .035, .62, 8), DARK, [0, .82, s.seatZ + .82], [-.75, 0, 0]], [cyl(.2, .2, .03, 18), WHITE, [0, .6, L * .43 + (id === 'bolt' ? .15 : 0)], [-1.35, 0, 0]]);
  metalParts.push([box(.9, .42, .55, .08), GUN, [0, .62, -L * .41]], [box(.62, .12, .36, .03), CHROME, [0, .88, -L * .41]]);
  const exY = .62, exZ = -L * .5 - .08;
  for (const x of [.28, -.28]) metalParts.push([cyl(.085, .1, .42, 12), CHROME, [x, exY, exZ + .1], [Math.PI / 2, 0, 0]], [cyl(.065, .065, .02, 12), 0x111111, [x, exY, exZ - .12], [Math.PI / 2, 0, 0]]);
  const body = node(`kart_${id}_body`);
  body.add(mesh(bake(paintParts), paint(), 'paint'), mesh(bake(trimParts), trim(), 'trim'), mesh(bake(metalParts), metal(), 'metal'));
  root.add(body);
  // Steering wheel pivot at the top of the column; ring faces the driver.
  const steering = node(`kart_${id}_steering`, 0, 1.04, s.seatZ + .58);
  steering.rotation.x = -.62;
  steering.add(mesh(bake([[torus(.19, .035, 24), DARK], [box(.3, .05, .05, .02), GUN], [cyl(.05, .05, .06, 10), 0xff4040, [0, 0, 0], [Math.PI / 2, 0, 0]]]), trim()));
  root.add(steering, node(`kart_${id}_seat`, 0, .72, s.seatZ), node(`kart_${id}_exhaust_l`, .28, exY, exZ - .14), node(`kart_${id}_exhaust_r`, -.28, exY, exZ - .14));
  const front = wheelGeometry(s.frontR, s.frontW, 0xe8e8ea), rear = wheelGeometry(s.rearR, s.rearW, 0xe8e8ea);
  for (const [side, x] of [['l', 1], ['r', -1]] as const) {
    const wheel = node(`kart_${id}_wheel_f${side}`, 0, 0, 0, mesh(front, trim()));
    root.add(node(`kart_${id}_steer_f${side}`, x * s.trackF, s.frontR, s.axleF, wheel));
    root.add(node(`kart_${id}_wheel_r${side}`, x * s.trackR, s.rearR, s.axleR, mesh(rear, trim())));
  }
  return root;
}

/* ---------------- characters ---------------- */
function buildCharacter(i: number): THREE.Group {
  const ch = CHARACTERS[i] ?? CHARACTERS[0], col = ch.color, acc = ch.accent, sp = ch.species, root = node(`char_${i}`);
  const dark = 0x1d1b22, pink = 0xff9fb4;
  const bodyParts: Piece[] = [[sphere(1), col, [0, .26, -.02], [0, 0, 0], [.33, .36, .28]], [sphere(1), acc, [0, .24, .12], [0, 0, 0], [.24, .27, .18]]];
  if (sp === 'penguin') bodyParts.push([sphere(1), acc, [0, .24, .1], [0, 0, 0], [.28, .32, .22]]);
  if (sp === 'dino') bodyParts.push([cone(.14, .5, 10), col, [0, .16, -.34], [-1.9, 0, 0]]);
  // Scarf in the kart colour's complement reads well against every body.
  bodyParts.push([torus(.2, .06, 18), 0xffffff, [0, .52, 0], [Math.PI / 2, 0, 0]]);
  root.add(node(`char_${i}_body`, 0, 0, 0, mesh(bake(bodyParts), trim())));
  const head: Piece[] = [[sphere(.3, 22, 16), col, [0, .24, 0]], [sphere(1), acc, [0, .17, .2], [0, 0, 0], [.17, .12, .12]], [sphere(.045), dark, [0, .22, .31]]];
  const eyes = (y: number, z: number, x = .12, r = .075) => { for (const sx of [1, -1]) head.push([sphere(r, 14, 10), 0xffffff, [sx * x, y, z]], [sphere(r * .55, 10, 8), dark, [sx * x, y + .005, z + r * .6]], [sphere(r * .18, 6, 5), 0xffffff, [sx * x + .012, y + .025, z + r * 1.05]]); };
  switch (sp) {
    case 'hamster': eyes(.3, .24); for (const sx of [1, -1]) head.push([sphere(.09), col, [sx * .2, .47, -.02]], [sphere(.055), pink, [sx * .2, .47, .03]], [sphere(.075), 0xffc9b8, [sx * .19, .15, .19]]); break;
    case 'fox': eyes(.3, .24); head.push([sphere(1), acc, [0, .14, .28], [0, 0, 0], [.1, .08, .14]]); for (const sx of [1, -1]) head.push([cone(.1, .28, 4), col, [sx * .17, .54, -.02], [0, 0, -sx * .25]], [cone(.055, .16, 4), acc, [sx * .17, .52, .02], [0, 0, -sx * .25]]); break;
    case 'bear': eyes(.3, .25, .11, .06); for (const sx of [1, -1]) head.push([sphere(.1), col, [sx * .22, .46, -.02]], [sphere(.06), acc, [sx * .22, .46, .03]]); break;
    case 'frog': head.push([sphere(1), acc, [0, .12, .16], [0, 0, 0], [.24, .1, .16]]); for (const sx of [1, -1]) head.push([sphere(.11), col, [sx * .15, .48, .05]], [sphere(.085), 0xffffff, [sx * .15, .5, .12]], [sphere(.045), dark, [sx * .15, .5, .19]]);
      head.push([torus(.12, .012, 16), dark, [0, .13, .27], [0, 0, 0], [1, .4, 1]]); break;
    case 'cat': eyes(.3, .25, .12, .07); for (const sx of [1, -1]) head.push([cone(.1, .22, 4), col, [sx * .18, .52, -.02], [0, 0, -sx * .3]], [cone(.05, .12, 4), pink, [sx * .18, .5, .02], [0, 0, -sx * .3]]); break;
    case 'penguin': eyes(.3, .24); head.push([sphere(1), acc, [0, .22, .12], [0, 0, 0], [.24, .2, .2]], [cone(.07, .2, 8), 0xffa51f, [0, .19, .34], [Math.PI / 2, 0, 0]]); break;
    case 'bunny': eyes(.3, .24); for (const sx of [1, -1]) head.push([sphere(1), col, [sx * .1, .7, -.04], [0, 0, -sx * .12], [.07, .26, .05]], [sphere(1), pink, [sx * .1, .7, -.005], [0, 0, -sx * .12], [.04, .2, .02]]); break;
    default: /* dino */ eyes(.33, .22); head.push([sphere(1), col, [0, .16, .22], [0, 0, 0], [.2, .14, .16]]); for (let k = 0; k < 4; k++) head.push([cone(.06, .16, 6), 0xffd23f, [0, .5 - k * .08, -.12 - k * .08], [-.5 - k * .25, 0, 0]]);
  }
  root.add(node(`char_${i}_head`, 0, .52, 0, mesh(bake(head), trim())));
  // Arms reach forward-down to the steering wheel (hands ~0.55 m ahead of the shoulders).
  for (const [side, x] of [['l', 1], ['r', -1]] as const) {
    const arm = bake([[capsule(.07, .36), col, [0, 0, .22], [Math.PI / 2, 0, 0]], [sphere(.085, 12, 8), acc, [0, 0, .46]]]);
    const pivot = node(`char_${i}_arm_${side}`, x * .27, .42, .02, mesh(arm, trim()));
    pivot.rotation.set(.32, -x * .32, 0);
    root.add(pivot);
  }
  return root;
}

/* ---------------- props ---------------- */
function buildProp(name: string): THREE.Group | null {
  const root = node(name);
  switch (name) {
    case 'peel': {
      const y = 0xffd83a, parts: Piece[] = [[sphere(1), y, [0, .16, 0], [0, 0, 0], [.2, .16, .2]], [cyl(.04, .06, .18, 8), 0x6b4a1f, [0, .36, 0]]];
      for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; parts.push([sphere(1), y, [Math.sin(a) * .28, .07, Math.cos(a) * .28], [.0, a, 0], [.14, .05, .34]], [sphere(1), 0xfff3b0, [Math.sin(a) * .28, .1, Math.cos(a) * .28], [0, a, 0], [.1, .02, .28]]); }
      root.add(mesh(bake(parts), trim()));
      break;
    }
    case 'bouncer_shell': case 'seeker_shell': {
      const shell = name === 'bouncer_shell' ? 0x2fd35c : 0xf0324a, parts: Piece[] = [[sphere(.42, 20, 12), shell, [0, .2, 0], [0, 0, 0], [1, .72, 1]], [torus(.4, .09, 24), WHITE, [0, .2, 0], [Math.PI / 2, 0, 0]], [cyl(.4, .36, .12, 20), 0xfff6dc, [0, .12, 0]]];
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; parts.push([sphere(.12, 8, 6), 0xffffff, [Math.sin(a) * .24, .44, Math.cos(a) * .24], [0, 0, 0], [1, .45, 1]]); }
      if (name === 'seeker_shell') for (const sx of [1, -1]) parts.push([box(.14, .06, .3, .02), 0xffffff, [sx * .5, .22, -.05], [0, 0, sx * .3]]);
      root.add(mesh(bake(parts), trim()));
      break;
    }
    case 'bomb': {
      const parts: Piece[] = [[sphere(.55, 22, 16), 0x22242c, [0, .55, 0]], [cyl(.18, .2, .16, 14), GUN, [0, 1.1, 0]], [cyl(.03, .03, .2, 6), 0xd9b36b, [0, 1.25, .02], [.3, 0, 0]]];
      for (const sx of [1, -1]) parts.push([sphere(.1, 12, 8), 0xffffff, [sx * .16, .7, .48], [0, 0, 0], [1, 1.3, .6]], [sphere(.05, 8, 6), 0x111111, [sx * .16, .7, .54]]);
      for (const sx of [1, -1]) parts.push([sphere(1), 0xffb03a, [sx * .38, .08, .1], [0, 0, 0], [.14, .08, .2]]);
      const body = mesh(bake(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .35, metalness: .2, emissive: 0x000000 }), 'bomb_body');
      root.add(body, node('bomb_fuse', 0, 1.36, .06));
      break;
    }
    case 'comet': {
      root.add(mesh(bake([[new THREE.IcosahedronGeometry(.7, 2), 0xbfe6ff, [0, 1, 0]]]), glow()));
      break;
    }
    case 'drone': {
      const parts: Piece[] = [[box(.9, .26, .9, .1), 0xffcc33, [0, 0, 0]], [box(.5, .12, .5, .05), 0x2a2d35, [0, .17, 0]], [sphere(.12, 12, 8), 0x3ad8ff, [0, -.02, .46]], [cyl(.03, .03, .7, 6), GUN, [0, -.45, 0]],
        [torus(.14, .03, 12), GUN, [0, -.84, 0], [Math.PI / 2, 0, 0]]];
      for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; parts.push([box(.7, .06, .08, .02), 0x2a2d35, [Math.sin(a) * .5, .05, Math.cos(a) * .5], [0, a + Math.PI / 2, 0]], [cyl(.06, .06, .14, 10), 0x2a2d35, [Math.sin(a) * .82, .1, Math.cos(a) * .82]]); }
      root.add(mesh(bake(parts), trim()));
      const rotor = bake([[box(.62, .015, .08, .005), 0xdddddd, [0, 0, 0]], [box(.62, .015, .08, .005), 0xdddddd, [0, 0, 0], [0, Math.PI / 2, 0]]]);
      for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2, r = mesh(rotor, trim(), `drone_rotor_${k}`); r.position.set(Math.sin(a) * .82, .19, Math.cos(a) * .82); root.add(r); }
      for (const ch of root.children) ch.position.y += .98;   // contract: origin at the hook tip
      break;
    }
    default: return null;
  }
  return root;
}

const templates = new Map<string, THREE.Object3D | null>();
/** Cached primitive template for a contract node name (`kart_<id>`, `char_<i>`, item names, `drone`), or null. */
export function fallbackTemplate(name: string): THREE.Object3D | null {
  if (!templates.has(name)) {
    const kart = /^kart_(zoomer|bolt|tank)$/.exec(name), char = /^char_(\d)$/.exec(name);
    const t = kart ? buildKart(kart[1] as KartBodyId) : char ? buildCharacter(Number(char[1])) : buildProp(name);
    t?.traverse(o => { o.castShadow = o instanceof THREE.Mesh; });
    templates.set(name, t);
  }
  return templates.get(name) ?? null;
}
