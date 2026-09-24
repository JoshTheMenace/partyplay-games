/* Contract checks for public/models/karts.glb (DESIGN.md §7) and its previews, read straight from the binary. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHARACTERS, KART_BODIES } from '../src/sim/stats';

const models = fileURLToPath(new URL('../public/models/', import.meta.url));
type Node = { name?: string; children?: number[]; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[] };
type Gltf = { nodes: Node[]; meshes: { primitives: { indices?: number; mode?: number; attributes: { POSITION: number } }[] }[];
  accessors: { count: number; min?: number[]; max?: number[] }[]; materials: { name?: string }[]; cameras?: unknown[]; extensions?: Record<string, unknown> };

const bytes = readFileSync(models + 'karts.glb');
const gltf: Gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
const byName = new Map(gltf.nodes.map((n, i) => [n.name ?? '', i]));
const node = (name: string) => { const i = byName.get(name); assert.ok(i !== undefined, `missing node ${name}`); return gltf.nodes[i]!; };
const parentOf = new Map<number, number>();
gltf.nodes.forEach((n, i) => n.children?.forEach(c => parentOf.set(c, i)));
const parentName = (name: string) => gltf.nodes[parentOf.get(byName.get(name)!) ?? -1]?.name;

type M = number[]; // column-major 4x4
const mul = (a: M, b: M) => Array.from({ length: 16 }, (_, i) => [0, 1, 2, 3].reduce((s, k) => s + a[(k * 4) + (i % 4)]! * b[(i - (i % 4)) + k]!, 0));
function trs(n: Node): M {
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
/** Walk a root's subtree in root space, yielding each node's matrix. */
function* walk(i: number, m: M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]): Generator<[Node, M]> {
  const n = gltf.nodes[i]!; yield [n, m];
  for (const c of n.children ?? []) yield* walk(c, mul(m, trs(gltf.nodes[c]!)));
}
const tris = (root: string) => [...walk(byName.get(root)!)].reduce((s, [n]) => s + (n.mesh === undefined ? 0 : gltf.meshes[n.mesh]!.primitives
  .reduce((t, p) => t + ((p.mode ?? 4) === 4 ? gltf.accessors[p.indices ?? p.attributes.POSITION]!.count / 3 : 0), 0)), 0);
function bounds(root: string) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const [n, m] of walk(byName.get(root)!)) for (const p of n.mesh === undefined ? [] : gltf.meshes[n.mesh]!.primitives) {
    const a = gltf.accessors[p.attributes.POSITION]!;
    for (let c = 0; c < 8; c++) {
      const v = [0, 1, 2].map(k => ((c >> k) & 1 ? a.max! : a.min!)[k]!);
      for (let k = 0; k < 3; k++) { const w = m[k]! * v[0]! + m[4 + k]! * v[1]! + m[8 + k]! * v[2]! + m[12 + k]!; lo[k] = Math.min(lo[k]!, w); hi[k] = Math.max(hi[k]!, w); }
    }
  }
  return { lo, hi };
}
const pos = (name: string) => node(name).translation ?? [0, 0, 0];

test('karts.glb is a small, camera-free binary with the recolourable paint material', () => {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.ok(statSync(models + 'karts.glb').size <= 5 * 1024 * 1024);
  assert.ok(gltf.materials.some(m => m.name === 'kart_paint'));
  assert.equal(gltf.cameras?.length ?? 0, 0);
  assert.equal(gltf.extensions?.KHR_lights_punctual, undefined);
});

test('every kart follows the node contract, axes and size', () => {
  for (const { id } of KART_BODIES) {
    const k = `kart_${id}`;
    for (const part of ['body', 'steering', 'seat', 'exhaust_l', 'exhaust_r', 'wheel_rl', 'wheel_rr']) assert.equal(parentName(`${k}_${part}`), k, part);
    for (const s of ['l', 'r']) { assert.equal(parentName(`${k}_steer_f${s}`), k); assert.equal(parentName(`${k}_wheel_f${s}`), `${k}_steer_f${s}`); }
    const { lo, hi } = bounds(k), width = hi[0]! - lo[0]!, length = hi[2]! - lo[2]!;
    assert.ok(width > 2 && width < 2.4, `${id} width ${width}`);
    assert.ok(length > 2.75 && length < 3.3, `${id} length ${length}`);
    assert.ok(Math.abs(lo[1]!) < .03, `${id} sits on the ground (${lo[1]})`);
    assert.ok(tris(k) <= 6000, `${id} has ${tris(k)} triangles`);
    // +Z forward, driver-left +X: front-left steer pivot is +X/+Z, rear-right wheel −X/−Z, flames at the back.
    const fl = pos(`${k}_steer_fl`), rr = pos(`${k}_wheel_rr`);
    assert.ok(fl[0]! > .5 && fl[2]! > .5 && rr[0]! < -.5 && rr[2]! < -.5, `${id} wheel axes`);
    for (const w of ['steer_fl', 'wheel_rr']) { const b = bounds(`${k}_${w}`); assert.ok([1, 2].every(a => Math.abs(b.hi[a]! + b.lo[a]!) < .03), `${id} ${w} pivot at axle centre`); }
    assert.deepEqual(pos(`${k}_wheel_fl`), [0, 0, 0]);
    assert.ok(pos(`${k}_exhaust_l`)[2]! < -1 && pos(`${k}_exhaust_l`)[0]! > 0 && pos(`${k}_exhaust_r`)[0]! < 0);
    assert.ok(pos(`${k}_seat`)[1]! > .3 && pos(`${k}_steering`)[2]! > pos(`${k}_seat`)[2]!);
  }
});

test('every character follows the node contract and triangle budget', () => {
  assert.equal(CHARACTERS.length, 8);
  CHARACTERS.forEach((_, i) => {
    const c = `char_${i}`;
    for (const part of ['body', 'head', 'arm_l', 'arm_r']) assert.equal(parentName(`${c}_${part}`), c, part);
    assert.ok(pos(`${c}_head`)[1]! > .5 && pos(`${c}_arm_l`)[0]! > 0 && pos(`${c}_arm_r`)[0]! < 0, `${c} pivots`);
    const { lo, hi } = bounds(c);
    assert.ok(hi[1]! > 1.3 && hi[1]! < 2.3 && lo[1]! > -.4, `${c} height ${lo[1]}..${hi[1]}`);
    assert.ok(tris(c) <= 6000, `${c} has ${tris(c)} triangles`);
  });
});

test('previews exist as 256x256 RGBA PNGs', () => {
  const names = [...CHARACTERS.map((_, i) => `char-${i}`), ...KART_BODIES.map(k => `kart-${k.id}`)];
  for (const name of names) {
    const png = readFileSync(`${models}previews/${name}.png`);
    assert.equal(png.toString('ascii', 12, 16), 'IHDR', name);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), png[25]], [256, 256, 6], name);
  }
});
