/** WP-art bundles: node names, material slots, outlines, pivots and budgets (EXPERIENCE §1.5, §1.8). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

type Node = { name: string; children?: number[]; mesh?: number; translation?: number[] };
type Primitive = { attributes: Record<string, number>; indices: number; material: number };
type Gltf = {
  nodes: Node[]; scenes: { nodes: number[] }[]; materials: { name: string }[];
  meshes: { primitives: Primitive[] }[]; accessors: { count: number; min?: number[]; max?: number[] }[];
};
type Bundle = { tris: number; kb: number; outlined: boolean; nodes: Record<string, [number, number]> };

const dir = new URL('../../../../../public/games/island-settlers/models/', import.meta.url);
const each = (names: string[], prefix: string, value: [number, number]) =>
  Object.fromEntries(names.map(n => [prefix + n, value]));
const props = Object.fromEntries(Object.entries({
  pine: 60, round_tree: 80, sheep: 120, wheat: 60, rock: 40, peak: 150, bricks: 60, kiln: 120, dune: 40,
  cactus: 80, nugget: 40, palm: 120, reeds: 60, spice: 80,
}).map(([n, t]) => [`prop_${n}`, [t, n === 'peak' ? 0.30 : 0.22] as [number, number]]));
// node: [triangle budget including children, spec height (a maximum for props)]
const BUNDLES: Record<string, Bundle> = {
  pieces: { tris: 4500, kb: 120, outlined: true, nodes: {
    settlement: [300, 0.38], city: [520, 0.60], road: [60, 0.10], ship: [620, 0.46], robber: [800, 0.60],
    pirate: [900, 0.62], harbor: [520, 0.46], die: [300, 0.36] } },
  props: { tris: 1500, kb: 60, outlined: false, nodes: { ...props, fog_cloud: [200, 0.22] } },
  expansions: { tris: 12000, kb: 250, outlined: true, nodes: {
    knight_1: [380, 0.28], knight_2: [380, 0.34], knight_3: [380, 0.40], wall: [300, 0.09],
    ...each(['science', 'trade', 'politics'], 'metropolis_', [800, 0.78]), merchant: [500, 0.40],
    wagon: [600, 0.26], settler: [120, 0.14], crew: [120, 0.14], crate_fish: [60, 0.10], sack_spice: [60, 0.10],
    fishing_sign: [60, 0.03], bridge: [200, 0.12], castle: [1500, 0.95], invader: [200, 0.22],
    barbarian_ship: [900, 0.60], ...each(['castle', 'quarry', 'glassworks'], 'depot_', [600, 0.50]) } },
};

const parse = (bytes: Buffer): Gltf => {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF'); assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'header length matches the file');
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'first chunk is JSON');
  return JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
};
const load = (bytes: Buffer) => new Promise<Group>((done, fail) => {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer;
  new GLTFLoader().parse(buffer, '', g => done(g.scene), fail);
});

for (const [bundle, spec] of Object.entries(BUNDLES)) {
  test(`${bundle}.glb carries every node within its budgets`, async () => {
    const bytes = readFileSync(new URL(`${bundle}.glb`, dir)), gltf = parse(bytes);
    assert.ok(bytes.length <= spec.kb * 1024, `${bundle}.glb is ${bytes.length} bytes`);
    const byName = new Map(gltf.nodes.map(n => [n.name, n]));
    const tree = (n: Node): Node[] => [n, ...(n.children ?? []).flatMap(i => tree(gltf.nodes[i]))];
    const prims = (nodes: Node[]) => nodes.flatMap(n => n.mesh === undefined ? [] :
      gltf.meshes[n.mesh].primitives);
    const tris = (nodes: Node[]) => prims(nodes).reduce((n, p) => n + gltf.accessors[p.indices].count / 3, 0);
    const bound = (p: Primitive, end: 'min' | 'max') => gltf.accessors[p.attributes.POSITION][end]![1];
    const roots = gltf.scenes[0].nodes.map(i => gltf.nodes[i].name);
    assert.deepEqual(roots.sort(), Object.keys(spec.nodes).sort(), 'exact root node set');
    let total = 0;
    for (const [name, [budget, height]] of Object.entries(spec.nodes)) {
      const root = byName.get(name)!, nodes = tree(root), count = tris(nodes); total += count;
      assert.ok(count <= budget, `${name}: ${count} tris over ${budget}`);
      assert.equal(root.translation, undefined, `${name} pivots at the origin`);
      assert.equal(byName.has(`${name}_outline`), spec.outlined, `${name} outline child`);
      const body = prims(nodes.filter(x => !x.name.includes('_active')));
      const top = Math.max(...body.map(p => bound(p, 'max')));
      const low = Math.min(...body.map(p => bound(p, 'min')));
      assert.ok(spec.outlined ? Math.abs(top - height) <= 0.03 : top <= height + 1e-6, `${name} height ${top}`);
      assert.ok(low > -0.03, `${name} stands on y = 0 (${low})`);
    }
    assert.ok(total <= spec.tris, `${bundle}: ${total} tris`);
    for (const node of gltf.nodes) for (const p of prims([node])) {
      assert.equal(p.attributes.NORMAL, undefined, 'flat shaded: no normals');
      const decal = node.name.endsWith('_decal');
      assert.equal('TEXCOORD_0' in p.attributes, decal, `${node.name}: UVs on decals only`);
      if (node.name.endsWith('_outline')) assert.match(gltf.materials[p.material].name, /^outline(_cream)?$/);
    }
    const names = new Set(gltf.materials.map(m => m.name));
    for (const slot of spec.outlined ? ['seat', 'seat_dark', 'ink', 'cream', 'outline', 'decal', 'glow'] : [])
      assert.ok(names.has(slot), `material slot ${slot}`);
    const scene = await load(bytes);
    for (const name of byName.keys()) assert.ok(scene.getObjectByName(name), `three.js finds ${name}`);
  });
}

test('toggleable children and emblem decals exist where the runtime expects them', () => {
  const nodes = (bundle: string) =>
    new Set(parse(readFileSync(new URL(`${bundle}.glb`, dir))).nodes.map(n => n.name));
  const expansions = nodes('expansions'), pieces = nodes('pieces');
  const toggles = ['knight_1_active', 'knight_2_active', 'knight_3_active', 'cargo', 'level_1', 'level_2',
    'level_3'];
  for (const n of toggles) assert.ok(expansions.has(n), n);
  for (const n of ['settlement', 'city', 'ship', 'harbor']) assert.ok(pieces.has(`${n}_decal`), n);
});
