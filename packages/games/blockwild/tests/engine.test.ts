import assert from 'node:assert/strict';
import test from 'node:test';
import { B, makeCell, SLAB_BOTTOM, TEXTURE_KEYS } from '../src/shared/blocks';
import { CHUNK_CELLS } from '../src/shared/chunk';
import { CHUNK } from '../src/shared/constants';
import { cellIndex, chunkFromKey, chunkKey, localIndex } from '../src/shared/coords';
import { computeLight, extractCoreLight, extractVolume, fillRegion, newRegion, newVolume, RA, RX, volumeIndex } from '../src/client/engine/light';
import { Mesher } from '../src/client/engine/mesher';
import type { FromWorker, LayerMesh, ToWorker } from '../src/client/engine/types';
import { lightCurve, skyState } from '../src/client/engine/environment';
import { createFallbackAtlas } from '../src/client/engine/fallback-atlas';
import { planColumns } from '../src/client/engine/index';
import { cloudMask } from '../src/client/engine/sky';
import { generateChunk } from '../src/shared/worldgen';

/** A tiny sparse world of column chunks (missing chunks are air). */
function world() {
  const chunks = new Map<number, Uint16Array>();
  const chunk = (cx: number, cz: number) => {
    let found = chunks.get(chunkKey(cx, cz));
    if (!found) chunks.set(chunkKey(cx, cz), found = new Uint16Array(CHUNK_CELLS));
    return found;
  };
  const set = (x: number, y: number, z: number, cell: number) => { chunk(x >> 4, z >> 4)[localIndex(x & 15, y, z & 15)] = cell; };
  const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cell: number) => {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, y, z, cell);
  };
  /** Lit region and mesh volume for chunk (cx, cz). */
  const lit = (cx: number, cz: number) => {
    const region = newRegion(), volume = newVolume();
    fillRegion(region, cx, cz, chunk);
    computeLight(region);
    extractVolume(region, volume);
    return { region, volume, light: extractCoreLight(region) };
  };
  return { set, fill, lit };
}
const layerIndex = new Map(TEXTURE_KEYS.map((key, i) => [key, i]));
const mesher = new Mesher(key => layerIndex.get(key) ?? 0);
const meshOf = (volume: ReturnType<typeof newVolume>, sy: number) => mesher.section(volume, sy);
/** Region index for world coordinates when the region is centred on chunk (cx, cz). */
const regionAt = (cx: number, cz: number, x: number, y: number, z: number) => x - (cx - 1) * CHUNK + RX * (z - (cz - 1) * CHUNK) + RA * (y + 1);
/** Vertices of a mesh as objects, for readable assertions. */
const vertices = (mesh: LayerMesh) => Array.from({ length: mesh.quads * 4 }, (_, v) => ({
  x: mesh.pos[v * 3]!, y: mesh.pos[v * 3 + 1]!, z: mesh.pos[v * 3 + 2]!, sky: mesh.lt[v * 4]! / 17, block: mesh.lt[v * 4 + 1]! / 17, shade: mesh.lt[v * 4 + 2]! / 255,
}));

// Chunk (4, 4) is well inside the test world; world x/z 64..79.
const CX = 4, CZ = 4, X0 = CX * CHUNK, Z0 = CZ * CHUNK;

test('a single cube in open air has six faces; adjacent cubes cull their shared faces', () => {
  const w = world();
  w.set(X0 + 8, 64, Z0 + 8, B.stone);
  assert.equal(meshOf(w.lit(CX, CZ).volume, 4)[0]?.quads, 6);
  w.set(X0 + 9, 64, Z0 + 8, B.stone);
  const [opaque, cutout, translucent] = meshOf(w.lit(CX, CZ).volume, 4);
  assert.equal(opaque?.quads, 10);
  assert.equal(cutout, null);
  assert.equal(translucent, null);
  // Other sections are empty.
  assert.deepEqual(meshOf(w.lit(CX, CZ).volume, 3), [null, null, null]);
});

test('leaves draw faces between each other, glass culls against glass', () => {
  const w = world();
  w.set(X0 + 4, 70, Z0 + 4, B.oak_leaves);
  w.set(X0 + 5, 70, Z0 + 4, B.oak_leaves);
  w.set(X0 + 8, 70, Z0 + 8, B.glass);
  w.set(X0 + 9, 70, Z0 + 8, B.glass);
  const [, cutout] = meshOf(w.lit(CX, CZ).volume, 4);
  assert.equal(cutout?.quads, 12 + 10);
});

test('ambient occlusion darkens floor corners next to walls', () => {
  const w = world();
  w.fill(X0 - 16, 63, Z0 - 16, X0 + 31, 63, Z0 + 31, B.stone);
  w.set(X0 + 8, 64, Z0 + 8, B.stone);
  w.set(X0 + 8, 64, Z0 + 9, B.stone);
  w.set(X0 + 9, 64, Z0 + 9, B.stone);
  // The top quad of floor cell (9, 63, 8): the L-shaped wall covers its west side and the inner corner at (9, 9).
  const all = vertices(meshOf(w.lit(CX, CZ).volume, 3)[0]!);
  const quad = Array.from({ length: all.length / 4 }, (_, q) => all.slice(q * 4, q * 4 + 4))
    .find(q => q.every(v => v.y === 64) && Math.min(...q.map(v => v.x)) === 9 && Math.min(...q.map(v => v.z)) === 8 && Math.max(...q.map(v => v.x)) === 10 && Math.max(...q.map(v => v.z)) === 9)!;
  const shade = (x: number, z: number) => Math.round(quad.find(v => v.x === x && v.z === z)!.shade * 100) / 100;
  assert.equal(shade(10, 8), 1, 'open corner');
  assert.equal(shade(9, 8), 0.86, 'one wall beside the corner');
  assert.equal(shade(10, 9), 0.86, 'one wall beside the corner');
  assert.equal(shade(9, 9), 0.56, 'inner corner between two walls');
  assert(quad.every(v => v.sky > 12), 'smooth sky light stays bright next to the wall');
});

test('block light falls off by one per block from a torch', () => {
  const w = world();
  w.set(X0 + 8, 40, Z0 + 8, B.torch);
  const { region, light } = w.lit(CX, CZ);
  for (let d = 0; d <= 15; d++) assert.equal(region.block[regionAt(CX, CZ, X0 + 8 + d, 40, Z0 + 8)], Math.max(0, 14 - d), `distance ${d}`);
  // Manhattan distance, including diagonals and across the chunk border (x = 80 is in the next chunk).
  assert.equal(region.block[regionAt(CX, CZ, X0 + 11, 42, Z0 + 6)], 14 - 7);
  assert.equal(region.block[regionAt(CX, CZ, X0 + 17, 40, Z0 + 8)], 14 - 9);
  assert.equal(light[localIndex(8, 40, 8)]! & 15, 14);
  // A wall blocks light: the far side is lit only around the wall's edge.
  w.fill(X0 + 10, 30, Z0, X0 + 10, 50, Z0 + 15, B.stone);
  const walled = w.lit(CX, CZ).region;
  assert.equal(walled.block[regionAt(CX, CZ, X0 + 10, 40, Z0 + 8)], 0);
  assert.equal(walled.block[regionAt(CX, CZ, X0 + 11, 40, Z0 + 8)], 0, 'the wall is 21 tall and 16 wide: the way around is too long');
});

test('sky light: full under open sky, fading under an overhang, dark in a sealed cave', () => {
  const w = world();
  w.fill(X0 - 16, 0, Z0 - 16, X0 + 31, 60, Z0 + 31, B.stone);
  w.fill(X0, 64, Z0, X0 + 15, 64, Z0 + 15, B.stone);
  const { region } = w.lit(CX, CZ);
  const sky = (x: number, y: number, z: number) => region.sky[regionAt(CX, CZ, x, y, z)];
  assert.equal(sky(X0 - 1, 62, Z0 + 8), 15, 'open column');
  assert.equal(sky(X0 + 8, 64, Z0 + 8), 0, 'inside the roof');
  assert.equal(sky(X0 + 8, 65, Z0 + 8), 15, 'on the roof');
  assert.equal(sky(X0, 62, Z0 + 8), 14, 'one block under the roof edge');
  assert.equal(sky(X0 + 4, 62, Z0 + 8), 10);
  assert.equal(sky(X0 + 7, 62, Z0 + 7), 7, 'the middle is lit from the nearest edge, 8 blocks away');
  // Sealed cave far below.
  w.fill(X0 + 4, 20, Z0 + 4, X0 + 6, 22, Z0 + 6, B.air);
  assert.equal(w.lit(CX, CZ).region.sky[regionAt(CX, CZ, X0 + 5, 21, Z0 + 5)], 0);
  // Leaves and water filter light on the way down.
  w.set(X0 - 5, 62, Z0 - 5, B.oak_leaves);
  w.set(X0 - 5, 61, Z0 - 5, B.water);
  const filtered = w.lit(CX, CZ).region;
  assert.equal(filtered.sky[regionAt(CX, CZ, X0 - 5, 62, Z0 - 5)], 14);
  assert.equal(filtered.sky[regionAt(CX, CZ, X0 - 5, 61, Z0 - 5)], 12);
});

test('neighbouring chunks agree on light and faces at their shared border', () => {
  const w = world();
  // Irregular terrain with caves and torches across chunks 3..6.
  let seed = 7;
  const random = () => (seed = Math.imul(seed ^ (seed >>> 15), 2246822519) + 1 >>> 0) / 4294967296;
  for (let x = 3 * CHUNK; x < 7 * CHUNK; x++) for (let z = 3 * CHUNK; z < 6 * CHUNK; z++) {
    const top = 58 + Math.floor(random() * 6);
    for (let y = 0; y <= top; y++) w.set(x, y, z, random() < 0.08 && y > 40 ? B.air : B.stone);
    if (random() < 0.02) w.set(x, top + 1, z, B.torch);
    if (random() < 0.03) w.fill(x, top + 3, z, x, top + 3, z + 2, B.oak_leaves);
  }
  const a = w.lit(CX, CZ), b = w.lit(CX + 1, CZ);
  let compared = 0;
  for (let y = 0; y < 128; y++) for (let z = Z0 - 1; z <= Z0 + 16; z++) for (const x of [X0 + 15, X0 + 16]) {
    const ai = regionAt(CX, CZ, x, y, z), bi = regionAt(CX + 1, CZ, x, y, z);
    assert.equal(a.region.sky[ai], b.region.sky[bi], `sky at ${x},${y},${z}`);
    assert.equal(a.region.block[ai], b.region.block[bi], `block at ${x},${y},${z}`);
    compared++;
  }
  assert.equal(compared, 128 * 18 * 2);
  // The border column of A's mesh volume is B's core.
  for (let y = 0; y < 128; y++) for (let z = 0; z < 16; z++) {
    assert.equal(a.volume.sky[volumeIndex(16, y, z)], b.light[localIndex(0, y, z)]! >> 4);
    assert.equal(a.volume.block[volumeIndex(16, y, z)], b.light[localIndex(0, y, z)]! & 15);
  }
  // Two cubes touching across the border: each chunk mesh keeps five faces.
  const v = world();
  v.set(X0 + 15, 90, Z0 + 3, B.stone);
  v.set(X0 + 16, 90, Z0 + 3, B.stone);
  assert.equal(meshOf(v.lit(CX, CZ).volume, 5)[0]?.quads, 5);
  assert.equal(meshOf(v.lit(CX + 1, CZ).volume, 5)[0]?.quads, 5);
});

test('shapes: plants, water surface, slabs, stairs, torches', () => {
  const w = world();
  w.fill(X0 - 16, 60, Z0 - 16, X0 + 31, 60, Z0 + 31, B.grass_block);
  w.set(X0 + 1, 61, Z0 + 1, B.poppy);
  w.set(X0 + 3, 61, Z0 + 1, B.torch);
  const [, cutout] = meshOf(w.lit(CX, CZ).volume, 3);
  assert.equal(cutout?.quads, 4 + 5, 'cross = 2 planes × 2 sides; floor torch = 4 sides + top');
  const poppy = vertices(cutout!).slice(0, 16);
  assert(poppy.every(v => v.sky === 15), 'plants take the light of their own cell');

  const water = world();
  water.fill(X0 - 16, 50, Z0 - 16, X0 + 31, 50, Z0 + 31, B.stone);
  water.set(X0 + 5, 51, Z0 + 5, B.water);
  const [, , translucent] = meshOf(water.lit(CX, CZ).volume, 3);
  // Four sides + top (seen from above and below); the bottom sits on stone.
  assert.equal(translucent?.quads, 6);
  assert.equal(Math.max(...vertices(translucent!).map(v => v.y)), 51 + 14 / 16);

  const slab = world();
  slab.set(X0 + 5, 70, Z0 + 5, makeCell(B.oak_slab, SLAB_BOTTOM));
  slab.set(X0 + 6, 70, Z0 + 5, makeCell(B.oak_slab, SLAB_BOTTOM));
  slab.set(X0 + 9, 70, Z0 + 9, makeCell(B.oak_stairs, 0));
  const [opaque] = meshOf(slab.lit(CX, CZ).volume, 4);
  // Two joined slabs: 2 × 6 − 2 shared sides; stairs: slab 5 + raised half 5 + exposed half top 1.
  assert.equal(opaque?.quads, 10 + 11);
  assert.equal(Math.max(...vertices(opaque!).filter(v => v.x <= 7 && v.z <= 6).map(v => v.y)), 70.5);

  const farm = world();
  farm.fill(X0 - 16, 60, Z0 - 16, X0 + 31, 60, Z0 + 31, B.dirt);
  farm.set(X0 + 5, 60, Z0 + 5, B.farmland);
  const sunken = vertices(meshOf(farm.lit(CX, CZ).volume, 3)[0]!).filter(v => v.y > 60.9 && v.y < 61);
  assert.equal(sunken.length, 4);
  assert(sunken.every(v => v.sky === 15), 'the sunken farmland top is sky-lit, not black');
});

test('column streaming order: nearest first, the view before what is behind, clipped to the world', () => {
  const plan = planColumns(100, 100, 6);
  assert.equal(plan[0], chunkKey(100, 100));
  const distance = (key: number) => { const [x, z] = chunkFromKey(key); return Math.hypot(x - 100, z - 100); };
  assert(plan.every((key, i) => i === 0 || distance(plan[i - 1]!) <= distance(key)), 'sorted by distance without a frustum');
  assert(plan.every(key => distance(key) <= 6.5));
  // Looking east (+x): an east column at distance 5 comes before a west one at distance 3.
  const east = planColumns(100, 100, 6, x => x >= 100);
  assert(east.indexOf(chunkKey(105, 100)) < east.indexOf(chunkKey(97, 100)));
  // The world edge: no negative chunks.
  assert(planColumns(0, 0, 4).every(key => chunkFromKey(key).every(c => c >= 0)));
});

test('day cycle: sunrise in the east, bright noon, starry night, glowing sunset', () => {
  const noon = skyState(6000), midnight = skyState(18000), sunrise = skyState(0), sunset = skyState(12000);
  assert(noon.sun[1] > 0.9 && noon.day === 1 && noon.stars === 0);
  assert(midnight.sun[1] < -0.9 && midnight.day === 0 && midnight.stars === 1);
  assert(sunrise.sun[0] > 0.9, 'the sun rises in the east (+X)');
  assert(sunset.sun[0] < -0.9 && sunset.dusk > 0.9);
  assert(noon.skyLight[0] > 5 * midnight.skyLight[0], 'nights are properly dark');
  assert.deepEqual(skyState(30000), skyState(6000));
  // The MC light curve: 0 → 0, 15 → 1, monotonic, and level 7 well under half brightness.
  assert.equal(lightCurve(0), 0);
  assert.equal(lightCurve(1), 1);
  for (let l = 1; l <= 15; l++) assert(lightCurve(l / 15) > lightCurve((l - 1) / 15));
  assert(lightCurve(7 / 15) < 0.25);
});

test('fallback atlas covers every texture key, crack stage and water frame', () => {
  const atlas = createFallbackAtlas(), missing = atlas.layerOf('missing');
  const layers = new Set(TEXTURE_KEYS.map(key => atlas.layerOf(key)));
  assert.equal(layers.size, TEXTURE_KEYS.length);
  assert(!layers.has(missing));
  for (let s = 0; s < 10; s++) assert.notEqual(atlas.layerOf(`crack_${s}`), missing);
  assert.notEqual(atlas.layerOf('water_1'), missing);
  assert.equal(atlas.layerOf('no_such_texture'), missing);
  assert.equal(atlas.texture.image.depth, missing + 1);
  const cover = cloudMask().reduce((sum, v) => sum + v, 0) / 1024;
  assert(cover > 0.15 && cover < 0.6, `cloud cover ${cover}`);
});

test('worker: loads columns, then an edit re-meshes its column first and relights the neighbour across the border', async () => {
  const messages: FromWorker[] = [];
  const host = globalThis as unknown as { self: { postMessage(message: FromWorker): void; onmessage?: (event: { data: ToWorker }) => void } };
  host.self = { postMessage: message => { messages.push(message); } };
  await import('../src/client/engine/worker');
  const send = (data: ToWorker) => host.self.onmessage!({ data });
  const until = async (test: () => boolean) => {
    for (let i = 0; i < 400 && !test(); i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(test(), `worker timed out: ${JSON.stringify(messages.map(m => m.type === 'error' ? m.message : m.type))}`);
  };
  const seed = 260923, cx = 128, cz = 128, a = chunkKey(cx, cz), b = chunkKey(cx + 1, cz);
  send({ type: 'init', seed, layers: Object.fromEntries(TEXTURE_KEYS.map((key, i) => [key, i])), capacity: 64 });
  send({ type: 'load', keys: [a, b] });
  await until(() => messages.length >= 2);
  const loaded = messages.splice(0).map(m => m.type === 'update' ? m.columns[0]! : assert.fail(m.type));
  assert.deepEqual(loaded.map(c => c.key), [a, b]);
  assert.deepEqual(loaded[0]!.cells, generateChunk(seed, cx, cz));
  assert(loaded[0]!.layers![0]!.quads > 100, 'terrain has opaque faces');

  // Hollow a sealed pocket straddling the border deep underground, with a torch on A's side.
  const x = (cx + 1) * CHUNK - 1, y = 20, z = cz * CHUNK + 8;
  const pocket = [cellIndex(x, y, z), B.torch, cellIndex(x + 1, y, z), B.air];
  send({ type: 'edits', changes: Int32Array.from(pocket) });
  await until(() => messages.some(m => m.type === 'update'));
  const [echo, first] = messages.splice(0);
  assert.deepEqual(echo, { type: 'cells', changes: Int32Array.from(pocket) });
  assert(first?.type === 'update' && !first.load);
  assert.deepEqual(first.columns.map(c => c.key).sort(), [a, b].sort(), 'both columns hold an edited cell: re-meshed in the first pass');
  const lightB = first.columns.find(c => c.key === b)!.light!;
  assert.equal(lightB[localIndex(0, y, 8)]! & 15, 13, 'torch light crossed the border');

  // Reverting restores the generated cells and the neighbour goes dark again.
  send({ type: 'edits', changes: Int32Array.from([pocket[0]!, -1, pocket[2]!, -1]) });
  await until(() => messages.some(m => m.type === 'update'));
  const revert = messages.find(m => m.type === 'cells')!, generated = generateChunk(seed, cx + 1, cz);
  assert(revert.type === 'cells');
  assert.equal(revert.changes[3], generated[localIndex(0, y, 8)]);
  await until(() => messages.filter(m => m.type === 'update').flatMap(m => m.type === 'update' ? m.columns : []).some(c => c.key === b && c.light));
  const relit = messages.flatMap(m => m.type === 'update' ? m.columns : []).find(c => c.key === b && c.light)!.light!;
  assert.equal(relit[localIndex(0, y, 8)]! & 15, 0);

  // A surface torch two blocks from the border: B's cells and faces are untouched, but its light changes, so B
  // follows in a second pass.
  messages.length = 0;
  let top = 127;
  while (!(loaded[0]!.cells![localIndex(13, top, 8)]! & 255)) top--;
  send({ type: 'edits', changes: Int32Array.from([cellIndex(x - 2, top + 1, z), B.torch]) });
  await until(() => messages.filter(m => m.type === 'update').length >= 2);
  const [, primary, secondary] = messages;
  assert(primary?.type === 'update' && secondary?.type === 'update');
  assert.deepEqual(primary.columns.map(c => c.key), [a]);
  assert.deepEqual(secondary.columns.map(c => c.key), [b]);
  assert(secondary.columns[0]!.light && secondary.columns[0]!.layers, 'the neighbour is relit and re-meshed');
});
