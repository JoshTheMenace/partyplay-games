import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Box3 } from 'three';
import { ResourceScope } from '../../../party-runtime/src/index';
import { loadKitchenAssets } from '../src/assets';
import { CHARACTERS, INGREDIENTS, KITCHENS, RECIPES, layout } from '../src/model';
import { setAssetBase } from '../src/asset-url';
const publicRoot = new URL('../../../../public/games/kitchen-rush/', import.meta.url);
const bytes = readFileSync(new URL('models/kitchen-rush.glb', publicRoot));

test('Blender pack covers every stage, food state, chef part and matching HUD icon', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(bytes);
  const scope = new ResourceScope();
  try {
    const kit = await loadKitchenAssets(scope);
    for (const count of [1,10]) for (const [index] of KITCHENS.entries()) for (const station of layout(index,count)) {
      const object = kit.create(`station_${station.kind}`), box = new Box3().setFromObject(object);
      assert(box.min.y >= -.001, `${station.kind} is grounded`);
      assert(box.max.x - box.min.x <= 1.9 && box.max.z - box.min.z <= 1.9, `${station.kind} fits its station footprint`);
    }
    for (const kind of Object.keys(INGREDIENTS)) for (const stage of ['raw','chopped','cooked','burnt']) {
      assert(kit.create(`food_${kind}_${stage}`).geometry.attributes.color.count > 0);
      assert(existsSync(new URL(`icons/food_${kind}_${stage}.png`,publicRoot)));
    }
    for (const recipe of RECIPES) { kit.create(`dish_${recipe.id}`); assert(existsSync(new URL(`icons/dish_${recipe.id}.png`,publicRoot))); }
    for (const id of ['chef', 'chef_f']) for (const part of ['body','left_hand','right_hand']) for (const suffix of ['', '_1', '_2', '_3']) kit.create(`${id}_${part}${suffix}`);
    for (const { id } of CHARACTERS) {
      for (const part of ['body','color','left_hand','right_hand']) kit.create(`${id}_${part}`);
      const height = new Box3().setFromObject(kit.create(`${id}_body`)); assert(height.max.y > 1.6 && height.max.y < 2.1, `${id} stands about chef height`);
      assert(existsSync(new URL(`icons/character_${id}.png`,publicRoot)), `${id} has a picker portrait`);
    }
    for (const part of ['left_foot','right_foot']) assert(kit.create(`chef_${part}`).position.y > 0);
    const first = kit.create('station_stove'), second = kit.create('station_stove');
    assert.notEqual(first,second); assert.equal(first.geometry,second.geometry); assert.equal(first.material,second.material);
    let disposals=0; first.geometry.addEventListener('dispose',()=>disposals++);
    scope.dispose();scope.dispose();assert.equal(disposals,1);
  } finally { scope.dispose(); globalThis.fetch = previous; }
});

test('asset loader honors the canonical base and fails on HTTP error or cancellation', async () => {
  const previous = globalThis.fetch;
  const scope = new ResourceScope();
  try {
    setAssetBase('/custom/kitchen/');
    globalThis.fetch = async (url, options) => { assert.equal(url,'/custom/kitchen/models/kitchen-rush.glb'); assert.equal(options?.signal,scope.signal); return new Response('',{status:404}); };
    await assert.rejects(loadKitchenAssets(scope),/404/);
    globalThis.fetch = async () => new Response(bytes);
    scope.dispose(); await assert.rejects(loadKitchenAssets(scope),{name:'AbortError'});
  } finally { scope.dispose();setAssetBase('/games/kitchen-rush/');globalThis.fetch = previous; }
});
