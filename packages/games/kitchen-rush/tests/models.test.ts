import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Mesh, Vector3 } from 'three';
import { ResourceScope } from '../../../party-runtime/src/index';
import { chefJoints, loadKitchenModels } from '../src/models';
import { INGREDIENTS, KITCHENS, layout } from '../src/model';

test('authored kit covers every kitchen, food state and chef rig within collision and GPU budgets', async () => {
  const bytes = readFileSync(new URL('../../../../public/games/kitchen-rush/models/kitchen-kit.glb', import.meta.url));
  assert.ok(bytes.length < 4_000_000, 'display-only GLB stays under 4 MB');
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(bytes);
  const scope = new ResourceScope();
  try {
    const model = await loadKitchenModels(scope);
    for (const kind of new Set(KITCHENS.flatMap((_, i) => layout(i, 10).map(s => s.kind)))) {
      const object = model(`station_${kind}`), size = new Box3().setFromObject(object).getSize(new Vector3());
      assert.ok(size.x <= 1.85 && size.z <= 1.86 && size.y < 2.5, `${kind} fits its station footprint`);
    }
    for (const kind of Object.keys(INGREDIENTS)) for (const state of ['raw', 'chopped', 'cooked', 'burnt']) assert.ok(model(`${kind}_${state}`).children.length);
    for (let i = 0; i < 4; i++) {
      const red = model(`chef${i}`, '#ff5748'), blue = model(`chef${i}`, '#28c6e7');
      const rig = chefJoints(red), other = chefJoints(blue);
      rig.arms[0].rotation.x = -1.1;
      assert.equal(Math.abs(other.arms[0].rotation.x), 0, 'chef clones animate independently');
      const size = new Box3().setFromObject(blue).getSize(new Vector3());
      assert.ok(size.x < 1.1 && size.y < 1.9, 'chef stays inside number badge and navigation silhouette');
      const team = (root: typeof red) => { let color = ''; root.traverse(o => { if (o instanceof Mesh && o.material.name === 'TeamColor') color = o.material.color.getHexString(); }); return color; };
      assert.equal(team(red), 'ff5748'); assert.equal(team(blue), '28c6e7');
    }
    const dish = model('dish_pizza'), resources = new Set(); let disposed = 0;
    dish.traverse(o => { if (o instanceof Mesh) resources.add(o.geometry); });
    for (const resource of resources as Set<import('three').BufferGeometry>) resource.addEventListener('dispose', () => disposed++);
    scope.dispose(); scope.dispose(); assert.equal(disposed, resources.size, 'shared geometry disposed once at round teardown');
  } finally { scope.dispose(); globalThis.fetch = previous; }
});
