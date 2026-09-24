import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { CHARACTERS, CHOPPABLE, INGREDIENTS, PAN_FOODS, POT_FOODS, RECIPES, type Ingredient } from '../src/model';

const root = new URL('../../../../public/games/kitchen-rush/', import.meta.url);
const icons = new URL('icons/', root);
const ingredients = Object.keys(INGREDIENTS) as Ingredient[];
/** Food icons for every state the rules can produce; burnt has one charred look under every ingredient name. */
const FOOD_ICONS = [
  ...ingredients.map(food => `food_${food}_raw`),
  ...CHOPPABLE.map(food => `food_${food}_chopped`),
  ...[...POT_FOODS, ...PAN_FOODS, 'dough'].map(food => `food_${food}_cooked`),
  ...ingredients.map(food => `food_${food}_burnt`), 'food_burnt',
];
const REQUIRED = [
  ...FOOD_ICONS,
  ...Object.keys(RECIPES).map(id => `dish_${id}`),
  ...['plate', 'plate_dirty', 'pot', 'pan', 'extinguisher'].map(item => `item_${item}`),
  ...CHARACTERS.map(({ id }) => `character_${id}`),
];

/** Width, height, colour type and the top-left pixel's alpha (row 0, pixel 0 is unaffected by PNG filters). */
function png(bytes: Buffer) {
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  const idat: Buffer[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.subarray(at + 4, at + 8).toString();
    if (type === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const pixels = inflateSync(Buffer.concat(idat)), depth = bytes[24];
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25], cornerAlpha: depth === 8 ? pixels[4] : pixels.readUInt16BE(7) };
}

test('every HUD icon exists as a 256×256 transparent PNG', () => {
  for (const name of REQUIRED) {
    const file = new URL(`${name}.png`, icons);
    assert.ok(existsSync(file), `${name}.png exists`);
    const { width, height, colourType, cornerAlpha } = png(readFileSync(file));
    assert.deepEqual([width, height, colourType], [256, 256, 6], `${name} is 256×256 RGBA`);
    assert.equal(cornerAlpha, 0, `${name} has a transparent background`);
  }
});

test('no stale food, dish or plate icons outlive the models they showed', () => {
  const expected = new Set(REQUIRED);
  const stale = readdirSync(icons).filter(file => /^(food|dish|item|plate)_/.test(file) && !expected.has(file.replace(/\.png$/, '')));
  assert.deepEqual(stale, []);
});

test('the contributor animal kit keeps its 18 meshes alongside the human kit', () => {
  const bytes = readFileSync(new URL('models/kitchen-rush.glb', root));
  assert.ok(bytes.length < 1_200_000, 'animal-only GLB stays under 1.2 MB');
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const names = new Set(json.nodes.map((node: { name: string }) => node.name));
  for (const animal of ['cat', 'dog', 'iguana', 'axolotl']) for (const part of ['body', 'color', 'left_hand', 'right_hand']) assert.ok(names.has(`${animal}_${part}`), `${animal}_${part}`);
  for (const foot of ['chef_left_foot', 'chef_right_foot']) assert.ok(names.has(foot), foot);
});
