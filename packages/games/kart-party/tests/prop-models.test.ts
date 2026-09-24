import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* Contract checks for public/models/props.glb (built by art/props/build_props.py, DESIGN §7). */
type Node = { name?: string; children?: number[]; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[] };
type Gltf = {
  scene?: number; scenes: { nodes: number[] }[]; nodes: Node[]; extensionsUsed?: string[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number; material?: number }[] }[];
  accessors: { count: number; min?: number[]; max?: number[] }[];
  materials: { name: string; alphaMode?: string }[]; images?: unknown[]; textures?: unknown[]; cameras?: unknown[];
};

const bytes = readFileSync(new URL('../public/models/props.glb', import.meta.url));
const gltf: Gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));

const THEMES = {
  common: ['item_box', 'start_gantry', 'cone', 'tire_stack', 'barrier', 'arrow_sign', 'crowd_stand', 'balloon_arch', 'lamp_post', 'flag_pole'],
  items: ['peel', 'bouncer_shell', 'seeker_shell', 'bomb', 'comet', 'drone'],
  beach: ['palm_a', 'palm_b', 'umbrella', 'beach_hut', 'lifeguard_tower', 'rock_beach', 'boat'],
  desert: ['cactus_a', 'cactus_b', 'rock_red_a', 'rock_red_b', 'mesa', 'water_tower', 'windmill'],
  city: ['building_a', 'building_b', 'building_c', 'street_light', 'neon_sign', 'billboard', 'parked_car'],
  snow: ['pine_a', 'pine_b', 'snow_rock', 'cabin', 'snowman', 'ice_crystal'],
  space: ['planet_ringed', 'asteroid_a', 'asteroid_b', 'space_station', 'satellite', 'star_crystal', 'star_bumper', 'ring_gate', 'spring_pad'],
};
const CHILDREN: Record<string, string[]> = {
  item_box: ['item_box_mark'], bomb: ['bomb_fuse'], flag_pole: ['flag_pole_flag'], windmill: ['windmill_rotor'],
  drone: ['drone_rotor_fl', 'drone_rotor_fr', 'drone_rotor_rl', 'drone_rotor_rr'], star_bumper: ['star_bumper_star'],
};
const ALL = Object.values(THEMES).flat();
const TREES = new Set(['palm_a', 'palm_b', 'pine_a', 'pine_b', 'cactus_a', 'cactus_b']);

const roots = new Map(gltf.scenes[gltf.scene ?? 0].nodes.map(i => [gltf.nodes[i].name, gltf.nodes[i]] as const));
const subtree = (n: Node): Node[] => [n, ...(n.children ?? []).flatMap(i => subtree(gltf.nodes[i]))];
const tris = (n: Node) => subtree(n).reduce((sum, m) => sum + (m.mesh === undefined ? 0 : gltf.meshes[m.mesh].primitives
  .reduce((s, p) => s + (p.indices === undefined ? gltf.accessors[p.attributes.POSITION].count : gltf.accessors[p.indices].count) / 3, 0)), 0);
/** Axis-aligned bounds of a root (children are translation-only by construction; asserted below). */
function bounds(root: Node) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const walk = (n: Node, off: number[]) => {
    const o = off.map((v, i) => v + (n.translation?.[i] ?? 0));
    if (n.mesh !== undefined) for (const p of gltf.meshes[n.mesh].primitives) {
      const a = gltf.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], a.min![i] + o[i]); hi[i] = Math.max(hi[i], a.max![i] + o[i]); }
    }
    for (const c of n.children ?? []) walk(gltf.nodes[c], o);
  };
  walk(root, [0, 0, 0]);
  return { lo, hi };
}

test('props.glb stays within the 4 MB budget and needs no textures, cameras or loader extensions', () => {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'GLB magic');
  assert.ok(bytes.length <= 4 * 1024 * 1024, `${bytes.length} bytes`);
  assert.ok(!gltf.images?.length && !gltf.textures?.length && !gltf.cameras?.length);
  for (const ext of gltf.extensionsUsed ?? []) assert.equal(ext, 'KHR_materials_emissive_strength');
  for (const m of gltf.meshes) for (const p of m.primitives) assert.ok((p.mode ?? 4) === 4 && p.attributes.NORMAL !== undefined);
});

test('every DESIGN §7 prop is a root node at the origin, animatable parts are named children', () => {
  for (const name of ALL) {
    const n = roots.get(name);
    assert.ok(n, `missing root ${name}`);
    assert.ok(!n.translation && !n.rotation && !n.scale, `${name} root must sit untransformed at the origin`);
    for (const c of subtree(n).slice(1)) assert.ok(!c.rotation && !c.scale, `${c.name} should be translation-only`);
  }
  for (const [parent, kids] of Object.entries(CHILDREN)) {
    const names = (roots.get(parent)!.children ?? []).map(i => gltf.nodes[i].name);
    for (const k of kids) assert.ok(names.includes(k), `${k} under ${parent}`);
  }
});

test('triangle budgets: buildings ≤ 800, trees ≤ 1000, planet ≤ 3000, every other prop ≤ 1500', () => {
  let total = 0;
  for (const name of ALL) {
    const t = tris(roots.get(name)!); total += t;
    const cap = name.startsWith('building_') ? 800 : TREES.has(name) ? 1000 : name === 'planet_ringed' ? 3000 : 1500;
    assert.ok(t > 0 && t <= cap, `${name}: ${t} tris (cap ${cap})`);
  }
  assert.ok(total < 45000, `total ${total}`);
});

test('origins are at ground contact (y up, metres) and props face +Z', () => {
  for (const name of ALL.filter(n => n !== 'ring_gate')) {
    const { lo, hi } = bounds(roots.get(name)!);
    assert.ok(lo[1] <= .06 && lo[1] >= -1.6, `${name} min y ${lo[1].toFixed(2)} should touch the ground`);
    if (name !== 'spring_pad') assert.ok(hi[1] > .3, `${name} has height`);
    if (THEMES.items.includes(name)) assert.ok(Math.abs(lo[1]) <= .06, `${name} item rests on its origin (${lo[1].toFixed(3)})`);
  }
  const light = bounds(roots.get('street_light')!);
  assert.ok(light.hi[2] > 2.5 && light.lo[2] > -.5, 'street_light arm overhangs toward +Z');
  const gantry = bounds(roots.get('start_gantry')!);
  assert.ok(gantry.hi[0] - gantry.lo[0] > 26 && gantry.hi[0] - gantry.lo[0] < 30, 'start_gantry spans ~24 m between pillars');
  const heights = ['building_a', 'building_b', 'building_c'].map(n => bounds(roots.get(n)!).hi[1]);
  for (const h of heights) assert.ok(h >= 20 && h <= 62, `building height ${h}`);
});

test('space gameplay props match their sim footprints', () => {
  const ring = bounds(roots.get('ring_gate')!);  // origin at the hoop centre, disc facing +Z, radius ≈ 3.2 (StarRing default)
  for (const i of [0, 1, 2]) assert.ok(Math.abs(ring.lo[i] + ring.hi[i]) < .2, `ring_gate centred on axis ${i}`);
  for (const i of [0, 1]) assert.ok(ring.hi[i] - ring.lo[i] > 6.4 && ring.hi[i] - ring.lo[i] < 8.5, 'ring_gate ≈ 6.4 m hoop');
  assert.ok(ring.hi[2] - ring.lo[2] < 1, 'ring_gate is a thin hoop facing +Z');
  const pad = bounds(roots.get('spring_pad')!);
  assert.ok(pad.hi[1] <= .25 && pad.hi[0] - pad.lo[0] > 4.5 && pad.hi[0] - pad.lo[0] < 6, 'spring_pad is a flush ~5 m star');
  const bumper = bounds(roots.get('star_bumper')!);
  assert.ok(bumper.hi[0] - bumper.lo[0] > 3 && bumper.hi[0] - bumper.lo[0] < 3.5 && Math.abs(bumper.lo[1]) <= .06, 'star_bumper ~3.2 m base on the ground');
  assert.ok(bounds(roots.get('planet_ringed')!).hi[1] > 60, 'planet_ringed is a big landmark');
});

test('glowing parts use emissive materials; the item box shell is translucent', () => {
  assert.equal(gltf.materials.find(m => m.name === 'item_glass')?.alphaMode, 'BLEND');
  const emissive = new Set(gltf.materials.filter(m => (m as { emissiveFactor?: number[] }).emissiveFactor?.some(v => v > 0)).map(m => m.name));
  for (const m of ['item_mark', 'win_warm', 'win_cyan', 'neon_pink', 'lamp_glow', 'street_glow', 'window_warm', 'comet_core',
    'star_gold', 'bumper_rim', 'ring_glow', 'spring_glow', 'station_window', 'crystal_cyan']) assert.ok(emissive.has(m), m);
});
