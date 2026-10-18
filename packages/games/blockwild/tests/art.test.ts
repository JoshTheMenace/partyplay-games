import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { ATLAS_KEYS, atlasPixels, EXTRA_KEYS, createBlockAtlas, CRACK_STAGES, itemIcon, itemSprite, layerOf, MISSING_LAYER, texturePixels, TILE, WATER_FRAMES } from '../src/client/art/atlas';
import { hasSprite } from '../src/client/art/sprites';
import { hasTexture } from '../src/client/art/textures';
import { BLOCK_LIST, faceTexture, makeCell, TEXTURE_KEYS } from '../src/shared/blocks';
import { I, ITEM_LIST, TOOL_TIERS } from '../src/shared/items';
import { DRAGON_PARTS, MOB_TYPES } from '../src/shared/protocol';
import { BLAZE_RINGS, CRYSTAL_PARTS, DRAGON_NECK, DRAGON_TAIL, GHAST_TENTACLES, SILVERFISH_SEGMENTS, VILLAGER_MODELS } from '../src/client/art/models';

const alphaCount = (px: Uint8Array, test: (a: number) => boolean) => { let n = 0; for (let i = 3; i < px.length; i += 4) if (test(px[i]!)) n++; return n; };

test('every block texture key is painted, distinct and has an atlas layer', () => {
  const seen = new Map<string, string>();
  for (const key of TEXTURE_KEYS) {
    assert.ok(hasTexture(key), `no painter for ${key}`);
    const px = texturePixels(key);
    assert.equal(px.length, TILE * TILE * 4);
    assert.notEqual(layerOf(key), MISSING_LAYER, key);
    const hash = Buffer.from(px).toString('base64');
    assert.ok(!seen.has(hash), `${key} is identical to ${seen.get(hash)}`);
    seen.set(hash, key);
  }
  assert.equal(layerOf('no_such_texture'), MISSING_LAYER);
});

test('opaque cubes are fully opaque; leaves and plants have see-through texels', () => {
  for (const block of BLOCK_LIST) {
    if (block.render !== 'opaque' || block.shape !== 'cube') continue;
    for (let face = 0; face < 6; face++) {
      const key = faceTexture(makeCell(block.id), face);
      assert.equal(alphaCount(texturePixels(key), a => a < 255), 0, `${block.name} face ${face} (${key}) has holes`);
    }
  }
  for (const key of ['oak_leaves', 'birch_leaves', 'spruce_leaves', 'short_grass', 'poppy', 'torch', 'wheat_stage7']) {
    const clear = alphaCount(texturePixels(key), a => a === 0);
    assert.ok(clear > 8 && clear < 256, `${key}: ${clear} clear texels`);
  }
});

test('atlas matches the engine contract: layers, cracks and water frames', () => {
  const atlas = createBlockAtlas();
  assert.equal(atlas.texture.image.depth, ATLAS_KEYS.length);
  assert.equal(atlas.texture.image.data!.length, ATLAS_KEYS.length * TILE * TILE * 4);
  assert.equal(atlas.crackLayers.length, CRACK_STAGES);
  assert.equal(atlas.waterFrames.length, WATER_FRAMES);
  atlas.crackLayers.forEach((layer, stage) => assert.equal(ATLAS_KEYS[layer], `crack_${stage}`));
  atlas.waterFrames.forEach((layer, frame) => assert.equal(ATLAS_KEYS[layer], frame ? `water_${frame}` : 'water'));
  const cracks = atlas.crackLayers.map(layer => alphaCount(texturePixels(ATLAS_KEYS[layer]!), a => a > 0));
  cracks.slice(1).forEach((n, i) => assert.ok(n > cracks[i]!, 'crack stages grow'));
  assert.deepEqual(atlasPixels(), atlasPixels(), 'painting is deterministic');
  atlas.texture.dispose();
});

test('every item has a sprite and a cached PNG icon', () => {
  const missing = texturePixels('missing');
  for (const item of ITEM_LIST) {
    if (item.id >= 256) assert.ok(hasSprite(item.key), `no sprite for ${item.key}`);
    const px = itemSprite(item.id);
    assert.equal(px.length, TILE * TILE * 4);
    assert.ok(alphaCount(px, a => a > 0) >= 8, `${item.key} sprite is empty`);
    assert.notDeepEqual(px, missing, `${item.key} uses the missing texture`);
    const url = itemIcon(item.id);
    assert.match(url, /^data:image\/png;base64,/);
    assert.deepEqual([...Buffer.from(url.slice(22), 'base64').subarray(1, 4)].map(c => String.fromCharCode(c)).join(''), 'PNG');
    assert.equal(itemIcon(item.id), url, 'icons are cached');
  }
  const pickaxes = TOOL_TIERS.map(([tier]) => Buffer.from(itemSprite(I[`${tier}_pickaxe`])).toString('base64'));
  assert.equal(new Set(pickaxes).size, TOOL_TIERS.length, 'each tier has its own colours');
});

// GLB models -------------------------------------------------------------------------------------------------------
type Gltf = {
  nodes: { name?: string; translation?: number[]; children?: number[]; mesh?: number }[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
  images?: unknown[]; samplers?: { magFilter?: number }[]; materials?: { name?: string; emissiveTexture?: unknown }[];
};
const MODELS = resolve(import.meta.dirname, '../../../../public/games/blockwild/models');
const HUMANOID = ['head', 'body', 'arm_l', 'arm_r', 'leg_l', 'leg_r'], QUAD = ['head', 'body', 'leg_fl', 'leg_fr', 'leg_bl', 'leg_br'];
const REQUIRED: Record<string, string[]> = {
  player: HUMANOID, zombie: HUMANOID, skeleton: HUMANOID, creeper: QUAD, cow: QUAD, pig: QUAD, sheep: [...QUAD, 'wool'],
  chicken: HUMANOID, spider: ['head', 'body', ...Array.from({ length: 8 }, (_, i) => `leg_${i}`)],
  ...Object.fromEntries(VILLAGER_MODELS.map(key => [key, ['head', 'body', 'leg_l', 'leg_r', 'arms', 'nose']])),
  zombified_piglin: [...HUMANOID, 'item'], ghast: ['body', 'face_shoot', ...GHAST_TENTACLES], tnt: ['body'],
  blaze: ['head', 'body', ...BLAZE_RINGS], enderman: [...HUMANOID, 'jaw'], silverfish: SILVERFISH_SEGMENTS, end_crystal: ['base', ...CRYSTAL_PARTS],
  ender_dragon: ['body', 'head', 'jaw', ...DRAGON_NECK, ...DRAGON_TAIL, 'wing_l', 'wing_r', 'wingtip_l', 'wingtip_r', ...QUAD.slice(2)],
};
/** The dragon is the showpiece, with a bigger budget. */
const BUDGET: Record<string, number> = { ender_dragon: 150 * 1024 };
const mobKey = (key: string) => key.startsWith('villager') ? 'villager' : key;

function readGlb(key: string): Gltf {
  const bytes = readFileSync(`${MODELS}/${key}.glb`);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${key} magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${key} version`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${key} length`);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.toString('ascii', 16, 20), 'JSON');
  return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)) as Gltf;
}
/** World-space vertical bounds and node origins (models use translations only, no rest rotations). */
function layout(gltf: Gltf) {
  let minY = Infinity, maxY = -Infinity;
  const origin = new Map<string, number[]>();
  const visit = (index: number, base: number[]) => {
    const node = gltf.nodes[index]!, t = node.translation ?? [0, 0, 0], at = base.map((v, i) => v + t[i]!);
    if (node.name) origin.set(node.name, at);
    if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh]!.primitives) {
      const accessor = gltf.accessors[primitive.attributes.POSITION]!;
      minY = Math.min(minY, at[1]! + accessor.min![1]!);
      maxY = Math.max(maxY, at[1]! + accessor.max![1]!);
    }
    for (const child of node.children ?? []) visit(child, at);
  };
  const children = new Set(gltf.nodes.flatMap(n => n.children ?? []));
  gltf.nodes.forEach((_, i) => { if (!children.has(i)) visit(i, [0, 0, 0]); });
  return { minY, maxY, origin };
}

test('entity models exist, parse as GLB, carry the pivot nodes and fit the budget', () => {
  for (const [key, pivots] of Object.entries(REQUIRED)) {
    const size = statSync(`${MODELS}/${key}.glb`).size;
    assert.ok(size <= (BUDGET[key] ?? 80 * 1024), `${key}.glb is ${size} bytes`);
    const gltf = readGlb(key), names = new Set(gltf.nodes.map(n => n.name));
    for (const pivot of pivots) assert.ok(names.has(pivot), `${key} lacks node ${pivot}`);
    assert.ok((gltf.images?.length ?? 0) > 0, `${key} embeds its pixel-art texture`);
    assert.ok(gltf.samplers?.every(s => s.magFilter === 9728), `${key} textures use nearest filtering`);
    const { minY, maxY, origin } = layout(gltf);
    const height = key === 'player' ? 1.8 : MOB_TYPES.find(m => m.key === mobKey(key))!.h;
    // Spider legs rest horizontally (the client tilts them down to the ground), so only its body sets minY.
    // Ghast tentacles hang below its 4 m hitbox, so only the body (y 0..4) is checked.
    if (key === 'ghast') assert.ok(minY < -1.5 && Math.abs(origin.get('tentacle_0')![1]!) < 0.01, `ghast tentacles hang from y=0 (got ${minY})`);
    else assert.ok(key === 'spider' ? minY > 0 && minY < 0.4 : Math.abs(minY) < 0.01, `${key} feet at y=0 (got ${minY})`);
    assert.ok(maxY > height * 0.85 && maxY < height * 1.2, `${key} is ${maxY.toFixed(2)} m tall, expected about ${height}`);
    if (pivots.includes('leg_fl')) assert.ok(origin.get('leg_fl')![2]! < origin.get('leg_bl')![2]!, `${key} faces -Z`);
    const left = origin.get(pivots.includes('arm_l') ? 'arm_l' : pivots.includes('leg_fl') ? 'leg_fl' : pivots.includes('leg_l') ? 'leg_l' : 'leg_0');
    if (left) assert.ok(left[0]! < 0, `${key} character-left pivots sit at -X`);
    if (pivots.includes('nose')) assert.ok(origin.get('nose')![2]! < origin.get('head')![2]!, `${key} faces -Z (nose in front)`);
  }
  assert.ok(readGlb('player').materials?.some(m => m.name === 'shirt'), 'player shirt material is tintable');
  const sword = layout(readGlb('zombified_piglin')).origin, hand = sword.get('item')!, arm = sword.get('arm_r')!;
  assert.ok(hand[0] === arm[0] && hand[1]! < arm[1]!, 'the piglin sword sits in its right hand');
  assert.ok(readGlb('tnt').materials?.some(m => m.name === 'tnt'), 'primed TNT has a flashable tnt material');
});

test('endgame models: glowing eyes, see-through crystal frames and a dragon sized to its hit boxes', () => {
  const materials = (key: string) => new Set(readGlb(key).materials?.map(m => m.name));
  for (const key of ['enderman', 'ender_dragon']) assert.ok(materials(key).has('eyes'), `${key} has glowing 'eyes'`);
  for (const [key, name] of [['blaze', 'glow'], ['end_crystal', 'glow'], ['end_crystal', 'crystal_glass'], ['ender_dragon', 'wing']] as const) assert.ok(materials(key).has(name), `${key} has '${name}'`);
  assert.ok(readGlb('end_crystal').materials?.find(m => m.name === 'glow')?.emissiveTexture, 'glow materials are emissive');
  const { origin } = layout(readGlb('ender_dragon')), at = (name: string) => origin.get(name)!;
  // Model forward is -Z (DRAGON_PARTS 'at' is [forward, right, up] in blocks).
  const part = (key: string) => DRAGON_PARTS.find(p => p.key === key)!.at;
  assert.ok(Math.abs(-at('head')[2]! - part('head')[0]) < 2.5, `head ${-at('head')[2]!} m forward`);
  assert.ok(at('tail_9')[2]! > -part('tail_2')[0] - 1, 'the tail reaches past the last tail box');
  assert.ok(at('wingtip_l')[0]! < -part('wing_right')[1] + 1 && at('wingtip_r')[0]! > part('wing_right')[1] - 1, 'wings span the wing boxes');
  for (let i = 1; i < DRAGON_NECK.length; i++) assert.ok(at(DRAGON_NECK[i]!)[2]! < at(DRAGON_NECK[i - 1]!)[2]!, 'the neck chains forward');
  for (let i = 1; i < DRAGON_TAIL.length; i++) assert.ok(at(DRAGON_TAIL[i]!)[2]! > at(DRAGON_TAIL[i - 1]!)[2]!, 'the tail chains backward');
  const crystal = layout(readGlb('end_crystal')).origin;
  for (const name of CRYSTAL_PARTS) assert.ok(Math.abs(crystal.get(name)![1]! - 1.5) < 0.01, `${name} floats 1.5 m up`);
});

test('endgame textures: art-only layers, growing wart, see-through bars, a lit observer and a solid portal', () => {
  for (const key of EXTRA_KEYS) { assert.ok(hasTexture(key), key); assert.notEqual(layerOf(key), MISSING_LAYER, key); }
  const solid = (key: string) => alphaCount(texturePixels(key), a => a > 0);
  const brightness = (key: string) => { const px = texturePixels(key); let sum = 0; for (let i = 0; i < px.length; i += 4) sum += px[i]! + px[i + 1]! + px[i + 2]!; return sum; };
  for (let s = 1; s < 4; s++) assert.ok(solid(`nether_wart_stage${s}`) > solid(`nether_wart_stage${s - 1}`), `wart stage ${s} grows`);
  assert.ok(solid('iron_bars') < TILE * TILE / 2, 'iron bars are mostly see-through');
  for (const key of ['end_portal', 'end_stone', 'purpur_block', 'end_sky']) assert.equal(solid(key), TILE * TILE, `${key} is opaque`);
  assert.ok(brightness('observer_back_on') > brightness('observer_back'), 'a pulsing observer lights its back');
  for (const item of ['blaze_rod', 'blaze_powder', 'ender_pearl', 'ender_eye', 'nether_wart', 'end_crystal'] as const) assert.ok(hasSprite(item), item);
});
