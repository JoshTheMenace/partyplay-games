import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Box3 } from 'three';
import { ResourceScope } from '../../../party-runtime/src/index';
import { loadKitchenAssets } from '../src/assets';
import { CHARACTERS, INGREDIENTS, RECIPES } from '../src/model';
import { setAssetBase } from '../src/asset-url';
const root = new URL('../../../../public/games/kitchen-rush/', import.meta.url);
const bytes = readFileSync(new URL('models/kitchen-rush.glb', root));

test('compact animal kit contains the scene rigs and all rendered icons, and disposes once', async () => {
  assert(bytes.length < 1_200_000, 'animal-only GLB stays under 1.2 MB');
  const previous = globalThis.fetch, scope = new ResourceScope();
  globalThis.fetch = async () => new Response(bytes);
  try {
    const kit = await loadKitchenAssets(scope);
    for (const id of ['cat', 'dog', 'iguana', 'axolotl']) {
      for (const part of ['body', 'color', 'left_hand', 'right_hand']) assert(kit.create(`${id}_${part}`).geometry.attributes.color.count > 0);
      const box = new Box3().setFromObject(kit.create(`${id}_body`));
      assert(box.max.y > 1.6 && box.max.y < 2.1, `${id} fits the existing chef height`);
    }
    for (const part of ['left_foot', 'right_foot']) assert(kit.create(`chef_${part}`).position.y > 0);
    for (const { id } of CHARACTERS) assert(existsSync(new URL(`icons/character_${id}.png`, root)));
    for (const kind of Object.keys(INGREDIENTS)) for (const stage of ['raw', 'chopped', 'cooked', 'burnt']) assert(existsSync(new URL(`icons/food_${kind}_${stage}.png`, root)));
    for (const recipe of RECIPES) assert(existsSync(new URL(`icons/dish_${recipe.id}.png`, root)));
    for (const plate of ['clean', 'dirty']) assert(existsSync(new URL(`icons/plate_${plate}.png`, root)));
    const first = kit.create('cat_body'), second = kit.create('cat_body');
    assert.notEqual(first, second); assert.equal(first.geometry, second.geometry);
    let disposals = 0; first.geometry.addEventListener('dispose', () => disposals++);
    scope.dispose(); scope.dispose(); assert.equal(disposals, 1);
  } finally { scope.dispose(); globalThis.fetch = previous; }
});

test('animal loader uses the asset base and rejects failed or aborted loads', async () => {
  const previous = globalThis.fetch, scope = new ResourceScope();
  try {
    setAssetBase('/custom/kitchen/');
    globalThis.fetch = async (url, options) => { assert.equal(url, '/custom/kitchen/models/kitchen-rush.glb'); assert.equal(options?.signal, scope.signal); return new Response('', { status: 404 }); };
    await assert.rejects(loadKitchenAssets(scope), /404/);
    globalThis.fetch = async () => new Response(bytes);
    scope.dispose(); await assert.rejects(loadKitchenAssets(scope), { name: 'AbortError' });
  } finally { scope.dispose(); setAssetBase('/games/kitchen-rush/'); globalThis.fetch = previous; }
});
