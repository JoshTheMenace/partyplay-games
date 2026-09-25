import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANIMATION_FRAMES, ANIMATIONS, ARMOR_BOXES, ARMOR_SHEET, armorGeometry, armorSheet, ATLAS_KEYS, createBlockAtlas, frameKey, frameLayers,
  heldAsBlock, iconCell, itemSprite, layerOf, redstoneTint, texturePixels,
} from '../src/client/art/atlas';
import { B } from '../src/shared/ids';
import { ARMOR_MATERIALS, I } from '../src/shared/items';

const texels = (px: Uint8Array) => Array.from({ length: px.length / 4 }, (_, i) => [px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!, px[i * 4 + 3]!] as const);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

test('lava, portal and fire animate like water: contiguous, distinct frames', () => {
  const atlas = createBlockAtlas();
  for (const key of ['water', 'lava', 'nether_portal', 'fire']) {
    const layers = frameLayers(key);
    assert.equal(layers.length, ANIMATION_FRAMES, key);
    layers.forEach((layer, f) => { assert.equal(layer, layerOf(key) + f); assert.equal(ATLAS_KEYS[layer], frameKey(key, f)); });
    assert.deepEqual(atlas.animations[key], layers);
    const frames = layers.map(layer => texturePixels(ATLAS_KEYS[layer]!));
    frames.forEach((frame, f) => assert.ok(!same(frame, frames[(f + 1) % frames.length]!), `${key} frame ${f} moves`));
    assert.ok(ANIMATIONS[key]!.fps > 0);
  }
  atlas.texture.dispose();
});

test('expansion textures carry the transparency their render mode needs', () => {
  const alphas = (key: string) => texels(texturePixels(key)).map(t => t[3]);
  assert.ok(alphas('lava').every(a => a === 255), 'lava is opaque');
  assert.ok(alphas('nether_portal').every(a => a >= 140 && a < 255), 'the portal is translucent everywhere');
  for (const key of ['fire', 'cobweb', 'monster_spawner', 'red_mushroom', 'redstone_dust_dot', 'redstone_dust_line', 'lever', 'redstone_torch', 'iron_door_top']) {
    const clear = alphas(key).filter(a => a === 0).length;
    assert.ok(clear > 8 && clear < 250, `${key}: ${clear} clear texels`);
  }
  for (const key of ['redstone_dust_dot', 'redstone_dust_line']) assert.ok(texels(texturePixels(key)).every(([r, g, b, a]) => !a || (r === g && g === b)), `${key} is greyscale for tinting`);
  assert.ok(redstoneTint(15) > redstoneTint(0) && (redstoneTint(15) >> 16) > 200, 'power brightens the dust');
  assert.ok(!same(texturePixels('repeater'), texturePixels('repeater_on')) && !same(texturePixels('redstone_lamp'), texturePixels('redstone_lamp_on')));
});

test('block items draw as readable icons', () => {
  assert.ok(!heldAsBlock(B.lever) && itemSprite(B.lever).some((v, i) => i % 4 === 3 && v > 0), 'the lever uses its own sprite');
  assert.equal(iconCell(B.piston) >> 8, 3, 'pistons face up in their icon');
  for (const id of [B.oak_fence, B.tnt, B.monster_spawner, B.stone_button, B.sticky_piston]) assert.ok(heldAsBlock(id));
  for (const id of [B.redstone_torch, B.cobweb, B.brown_mushroom, I.redstone, I.iron_door, I.repeater]) assert.ok(!heldAsBlock(id));
});

test('armor sheets: every material paints every box, with a visor opening and a distinct palette', () => {
  const sheets = ARMOR_MATERIALS.map(m => armorSheet(m));
  sheets.forEach(sheet => assert.equal(sheet.data.length, ARMOR_SHEET.w * ARMOR_SHEET.h * 4));
  assert.equal(new Set(sheets.map(s => Buffer.from(s.data).toString('base64'))).size, ARMOR_MATERIALS.length);
  for (const [m, sheet] of sheets.entries()) for (const box of ARMOR_BOXES) {
    const [ox, oy] = box.uv, [, h, d] = box.size;
    let solid = 0;
    for (let v = 0; v < h; v++) for (let u = 0; u < d; u++) if (sheet.alpha(ox + u, oy + d + v)) solid++; // left side face
    assert.ok(solid === d * h || (box.slot === 0 && solid > 0), `${ARMOR_MATERIALS[m]} slot ${box.slot} ${box.pivot} side is painted`);
  }
  const helmet = armorSheet('iron'), [hx, hy] = ARMOR_BOXES[0]!.uv;
  assert.equal(helmet.alpha(hx + 8 + 2, hy + 8 + 4), 0, 'the helmet leaves the eyes visible');
  assert.deepEqual([...new Set(ARMOR_BOXES.map(b => b.slot))], [0, 1, 2, 3]);
});

test('armor geometry wraps each box with UVs inside its own sheet region', () => {
  for (const box of ARMOR_BOXES) {
    const geometry = armorGeometry(box, 1), uv = geometry.getAttribute('uv'), [ox, oy] = box.uv, [w, h, d] = box.size;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i) * ARMOR_SHEET.w, v = uv.getY(i) * ARMOR_SHEET.h;
      assert.ok(u >= ox - 1e-6 && u <= ox + 2 * (w + d) + 1e-6 && v >= oy - 1e-6 && v <= oy + d + h + 1e-6, `${box.pivot} uv ${u},${v}`);
    }
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox!;
    assert.deepEqual([min.x, min.y, min.z].map(n => +n.toFixed(3)), box.origin.map(n => +(n - box.inflate).toFixed(3)));
    assert.deepEqual([max.x, max.y, max.z].map(n => +n.toFixed(3)), box.origin.map((n, a) => +(n + box.size[a]! + box.inflate).toFixed(3)));
    geometry.dispose();
  }
  // The front (−Z) face of the chestplate samples the front rect of its unwrap.
  const chest = ARMOR_BOXES.find(b => b.slot === 1 && b.pivot === 'body')!, g = armorGeometry(chest, 1), uv = g.getAttribute('uv'), [ox, oy] = chest.uv;
  for (let i = 20; i < 24; i++) {
    const u = uv.getX(i) * ARMOR_SHEET.w, v = uv.getY(i) * ARMOR_SHEET.h;
    assert.ok(u >= ox + 4 - 1e-6 && u <= ox + 12 + 1e-6 && v >= oy + 4 - 1e-6 && v <= oy + 16 + 1e-6, `front face uv ${u},${v}`);
  }
  g.dispose();
});
