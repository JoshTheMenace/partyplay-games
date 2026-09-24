import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Mesh, MeshStandardMaterial, Object3D, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHOPPABLE, INGREDIENTS, PAN_FOODS, POT_FOODS, RECIPES, type Ingredient } from '../src/model';

const glbUrl = new URL('../../../../public/games/kitchen-rush/models/kitchen-kit.glb', import.meta.url);
const bytes = readFileSync(glbUrl);
const manifest = JSON.parse(readFileSync(new URL('../art/asset-manifest.json', import.meta.url), 'utf8'));
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
const assets = new Map(gltf.scene.children.map(object => [object.name, object]));
const get = (name: string) => { const object = assets.get(name); assert.ok(object, `kit has ${name}`); return object; };
const box = (object: Object3D) => new Box3().setFromObject(object);
const meshes = (object: Object3D) => { const list: Mesh[] = []; object.traverse(o => { if (o instanceof Mesh) list.push(o); }); return list; };
const triangles = (object: Object3D) => meshes(object).reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0);
/** GLTFLoader keeps Blender's unique suffixes ("Head.001" → "Head001"); the scene strips them the same way. */
const pivot = (root: Object3D, name: string) => { let found: Object3D | undefined; root.traverse(o => { if (!found && !(o instanceof Mesh) && o.name.replace(/[.\d]/g, '') === name) found = o; }); assert.ok(found, `${root.name} has pivot ${name}`); return found; };

const STATIONS = ['counter', 'board', 'stove', 'oven', 'sink', 'rack', 'return', 'serve', 'bin', 'crate', 'belt'];
const ENVIRONMENT = ['wall', 'floor_tile', 'ice_tile', 'gate_plank', 'portal_pad'];
const ITEMS = ['pot', 'pan', 'plate', 'plate_dirty', 'extinguisher'];
const SOUPS = ['soup_tomato', 'soup_onion', 'soup_mixed'];
const ingredients = Object.keys(INGREDIENTS) as Ingredient[];
/** Every food state the rules can produce, apart from burnt which shares one charred model. */
const FOOD_STATES = [
  ...ingredients.map(food => `${food}_raw`),
  ...CHOPPABLE.map(food => `${food}_chopped`),
  ...[...POT_FOODS, ...PAN_FOODS, 'dough'].map(food => `${food}_cooked`),
];
const DISHES = Object.keys(RECIPES).map(id => `dish_${id}`);
const WORKTOPS = ['counter', 'board', 'stove', 'sink', 'rack', 'return', 'serve', 'belt', 'crate'];
/** Theme props the scene's palettes ask for (scene/themes.ts) plus the wall window it hangs on the back row. */
const SCENE_PROPS = ['prop_plant', 'prop_stool', 'prop_topiary', 'prop_lamp', 'prop_barrel', 'prop_buoy', 'prop_crate_stack', 'prop_pine', 'prop_snowman', 'prop_rock', 'prop_cactus', 'prop_lantern', 'prop_basket', 'prop_awning', 'prop_column', 'prop_window'];
/** Height of the first surface a ray dropped from above meets at (x, z). */
const surface = (name: string, x: number, z: number) => {
  const object = get(name); object.updateMatrixWorld(true);
  return new Raycaster(new Vector3(x, 3, z), new Vector3(0, -1, 0)).intersectObject(object, true)[0]?.point.y ?? NaN;
};
const near = (actual: number, expected: number, tolerance: number, what: string) => assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} ≈ ${expected}`);

test('kit file stays within the download budget and matches its manifest', () => {
  assert.ok(bytes.length <= 3_500_000, `GLB is ${bytes.length} bytes`);
  assert.equal(manifest.bytes, bytes.length, 'asset-manifest.json was written by the same build as the GLB');
  for (const [name, object] of assets) assert.equal(manifest.assets[name]?.triangles, triangles(object), `${name} triangle count matches the manifest`);
  assert.equal(gltf.cameras.length, 0, 'no cameras exported');
  let lights = 0; gltf.scene.traverse(o => { if ((o as { isLight?: boolean }).isLight) lights++; });
  assert.equal(lights, 0, 'no lights exported');
});

test('every object in the DESIGN.md naming contract exists as a top-level asset at the origin', () => {
  for (const name of [...STATIONS, ...ENVIRONMENT, ...ITEMS, ...SOUPS, ...FOOD_STATES, 'burnt', ...DISHES, 'chef', 'chef_f']) {
    const object = get(name);
    assert.deepEqual(object.position.toArray(), [0, 0, 0], `${name} is rooted at the origin`);
    assert.ok(meshes(object).length, `${name} has geometry`);
  }
  assert.ok([...assets.keys()].filter(name => name.startsWith('prop_')).length >= 12, 'theme props are included');
  for (const name of SCENE_PROPS) get(name);
  for (const theme of Object.values(manifest.themes) as string[][]) for (const name of theme) get(name);
});

test('tiles fill a 1×1 m footprint on the floor with worktops at COUNTER_HEIGHT', () => {
  for (const name of [...STATIONS, ...ENVIRONMENT]) {
    const { min, max } = box(get(name));
    assert.ok(min.x >= -.515 && max.x <= .515 && min.z >= -.53 && max.z <= .53, `${name} fits its tile (${min.toArray()} … ${max.toArray()})`);
    if (STATIONS.includes(name) || name === 'wall') assert.ok(Math.abs(min.y) < .005, `${name} stands on the floor`);
  }
  for (const name of ['floor_tile', 'ice_tile', 'gate_plank']) assert.ok(Math.abs(box(get(name)).max.y) < .02, `${name} surface is at floor level`);
  assert.ok(Math.abs(box(get('counter')).max.y - .9) < .002, 'plain counter top is exactly 0.9 m');
  for (const name of WORKTOPS) near(surface(name, -.44, name === 'belt' ? .2 : .44), .9, .03, `${name} worktop corner`); // belts have raised side rails
});

test('item rest heights match where the scene places things (scene/layout.ts SURFACE_Y, itemAnchor)', () => {
  near(surface('board', 0, 0), .94, .01, 'food sits on the chopping board');
  near(surface('stove', .134, .134), .93, .006, 'a pot rests on the stove trivet');
  near(surface('belt', .1, .2), .92, .012, 'belt running surface');
  near(surface('crate', 0, 0), .7, .006, 'crate produce floor');
  near(surface('oven', 0, .42), .5, .006, 'oven hearth in front of the mouth, where a plate bakes at z +0.3');
  near(surface('oven', 0, -.1), 1.08, .04, 'dome crown');
  const oven = get('oven'), view = new Vector3(0, Math.sin(58 * Math.PI / 180), Math.cos(58 * Math.PI / 180));
  assert.equal(new Raycaster(new Vector3(0, .56, .3), view).intersectObject(oven, true).length, 0, 'the game camera sees a plate baking in the mouth');
  near(surface('rack', 0, 0), .9, .006, 'plates stack from the worktop');
  near(surface('return', 0, .05), .9, .006, 'dirty stacks sit flush on the return');
  near(surface('pan', 0, 0), .045, .004, 'pan cooking floor (food at 0.05)');
  near(surface('plate', 0, 0), .03, .004, 'plate well (dishes at 0.03)');
  near(surface('pot', 0, 0), .04, .004, 'pot floor (soup disc from 0.04)');
  for (const name of [...STATIONS, 'wall']) assert.ok(box(get(name)).max.y <= 1.55, `${name} stays low enough not to hide a chef behind a front-row tile`);
});

test('carried things rest on y = 0 and stay hand-sized', () => {
  for (const name of [...ITEMS, ...SOUPS, ...FOOD_STATES, 'burnt', ...DISHES]) {
    const { min, max } = box(get(name)), size = max.clone().sub(min);
    assert.ok(Math.abs(min.y) < .003, `${name} base is at y = 0 (${min.y})`);
    const limit = ITEMS.includes(name) ? .7 : name.startsWith('dish_') || name.startsWith('soup_') ? .5 : .44; // scene/kit.ts shrinks food wider than 0.34 × 1.3
    assert.ok(size.x <= limit && size.z <= limit, `${name} is hand-sized (${size.toArray()})`);
  }
  assert.ok(box(get('plate')).max.x >= box(get('dish_pizza')).max.x, 'the largest dish fits on the plate');
});

test('chefs are rigid pivot hierarchies with an independent, tintable TeamColor', () => {
  for (const name of ['chef', 'chef_f']) {
    const source = get(name), height = box(source).max.y;
    near(height, 1.6, .05, `${name} height matches the scene's CHEF_HEIGHT so it is never rescaled`);
    const joints = ['Body', 'Head', 'ArmL', 'ArmR', 'LegL', 'LegR'].map(joint => pivot(source, joint));
    for (const joint of joints) assert.ok(meshes(joint).length, `${joint.name} carries its own mesh`);
    const [, , armL, armR] = joints;
    assert.ok(armL.position.x > 0 && armR.position.x < 0, 'character left is +X');
    const team = meshes(source).filter(mesh => (mesh.material as MeshStandardMaterial).name === 'TeamColor');
    assert.ok(team.length, `${name} has TeamColor parts`);
    assert.ok(team.some(mesh => pivot(source, 'Body').children.includes(mesh)) && team.some(mesh => pivot(source, 'ArmL').children.includes(mesh)), 'jacket and sleeves carry the team colour so it reads from above');
    assert.equal((team[0].material as MeshStandardMaterial).color.getHexString(), 'ffffff', 'TeamColor is white so a tint shows true');

    const a = source.clone(true), b = source.clone(true), at = (o: Object3D) => o.getWorldPosition(new Vector3());
    a.updateMatrixWorld(true);
    const hand = at(meshes(pivot(a, 'ArmR'))[0]), headY = at(pivot(a, 'Head')).y, footY = at(pivot(a, 'LegL')).y;
    pivot(a, 'ArmL').rotation.x = -1.2; a.updateMatrixWorld(true);
    assert.ok(pivot(b, 'ArmL').rotation.x === 0, 'clones animate independently');
    assert.ok(at(meshes(pivot(a, 'ArmR'))[0]).distanceTo(hand) < 1e-9, 'rotating one arm leaves the other alone');
    pivot(a, 'Body').position.y += .05; a.updateMatrixWorld(true);
    assert.ok(Math.abs(at(pivot(a, 'Head')).y - headY - .05) < 1e-9, 'Head rides on Body');
    assert.ok(Math.abs(at(pivot(a, 'LegL')).y - footY) < 1e-9, 'legs stay planted when Body bobs');
  }
});

test('animated children and budgets: triangles and at most three materials per asset', () => {
  for (const [station, child] of [['stove', 'stove_flame'], ['belt', 'belt_surface'], ['bin', 'bin_lid']]) {
    assert.ok(get(station).getObjectByName(child), `${station} has ${child}`);
  }
  for (const [name, object] of assets) {
    const kind = manifest.assets[name].kind as string;
    const budget = kind === 'chef' ? 4000 : ['station', 'env', 'prop'].includes(kind) ? 1500 : 500;
    assert.ok(triangles(object) <= budget, `${name} uses ${triangles(object)} of ${budget} triangles`);
    const materials = new Set(meshes(object).map(mesh => (mesh.material as MeshStandardMaterial).name));
    assert.ok(materials.size <= 3, `${name} uses ${materials.size} materials`);
    for (const mesh of meshes(object)) assert.ok(mesh.geometry.attributes.color, `${mesh.name} carries vertex colours`);
  }
});
