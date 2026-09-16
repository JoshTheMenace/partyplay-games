import { loadKitchenAssets } from './assets';
import { useEffect, useRef, useState } from 'react';
import { Scene, Color, OrthographicCamera, HemisphereLight, DirectionalLight, Mesh, BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, MeshStandardMaterial, CanvasTexture, SpriteMaterial, Sprite, Group, InstancedMesh, Object3D } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { SceneViewProps } from '../../../party-ui/src/index';
import { ResourceScope, SnapshotBuffer } from '../../../party-runtime/src/index';
import { mountThreeScene, type SceneMetrics } from '../../../party-3d/src/index';
import { readGraphicsQuality } from './preferences';
import { loadKitchenModels, chefJoints } from './models';
import {cookingStatus} from './presentation';
import { recipeFor, KITCHENS, dimensions, hasGust, hasPower, interpolate, layout, type Food, type Item, type Settings, type View } from './model';
export default function Kitchen(props: SceneViewProps<Settings, View>) {
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef(props), buffer = useRef(new SnapshotBuffer<View>()); latest.current = props;
  const [metrics, setMetrics] = useState<SceneMetrics | null>(null);
  useEffect(() => { if (props.publicView && props.snapshotTime !== null) buffer.current.push(props.snapshotTime, props.publicView); }, [props.publicView, props.snapshotTime]);
  useEffect(() => {
    const scope = new ResourceScope(props.signal), scene = new Scene(), size = dimensions(props.players.length), kitchen = props.settings.kitchen ?? 0, level = KITCHENS[kitchen];
    scope.defer(() => { scene.clear(); buffer.current.clear(); });
    async function build() {
    const animals = props.players.some(player => !['chef', 'chef_f'].includes((player.lobbyChoice as { character?: string } | undefined)?.character ?? 'chef'));
    const [model, characters] = await Promise.all([loadKitchenModels(scope), animals ? loadKitchenAssets(scope) : null]);
    if (scope.signal.aborted) return;
    scene.background = new Color(level.theme === 3 ? '#d8d3e8' : '#c6e2d6');
    const camera = new OrthographicCamera(-16, 16, 10, -10, .1, 100); camera.position.set(0, 22, 31); camera.lookAt(0, 0, 0);
    scene.add(new HemisphereLight('#fffbea', '#81958c', 1.7)); const sun = new DirectionalLight('#fff0cc', 2.2); sun.position.set(-12, 22, 10); scene.add(sun);
    const materials = new Map<string, MeshStandardMaterial>();
    const material = (color: string) => { let result = materials.get(color); if (!result) { result = scope.own(new MeshStandardMaterial({ color, roughness: .7 })); materials.set(color, result); } return result; };
    const box = scope.own(new BoxGeometry(1, 1, 1)), rounded = scope.own(new RoundedBoxGeometry(1, 1, 1, 2, .12)), cylinder = scope.own(new CylinderGeometry(1, 1, 1, 16)), sphere = scope.own(new SphereGeometry(1, 12, 8)), ring = scope.own(new TorusGeometry(1, .08, 6, 20));
    function block(parent: Group | Scene, x: number, y: number, z: number, w: number, h: number, d: number, color: string, round = false) { const mesh = new Mesh(round ? rounded : box, material(color)); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); parent.add(mesh); return mesh; }
    function ball(parent: Group | Scene, x: number, y: number, z: number, w: number, h: number, d: number, color: string) { const mesh = new Mesh(sphere, material(color)); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); parent.add(mesh); return mesh; }
    function tube(parent: Group | Scene, x: number, y: number, z: number, radius: number, height: number, color: string) { const mesh = new Mesh(cylinder, material(color)); mesh.position.set(x, y, z); mesh.scale.set(radius, height, radius); parent.add(mesh); return mesh; }
    function label(parent: Group | Scene, text: string, x: number, y: number, z: number, width = 1.6, background = '#234c3e', foreground = '#fff8e8') {
      const element = document.createElement('canvas'); const number = /^[\d✓!]+$/.test(text); element.width = number ? 96 : 384; element.height = 96; const context = element.getContext('2d')!;
      context.fillStyle = background; context.beginPath(); context.roundRect(4, 4, number ? 88 : 376, 88, number ? 44 : 18); context.fill(); context.fillStyle = foreground; context.font = `1000 ${number ? 68 : 52}px Nunito, sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, number ? 48 : 192, 51, number ? 82 : 360);
      const texture = scope.own(new CanvasTexture(element)), sprite = new Sprite(scope.own(new SpriteMaterial({ map: texture, depthTest: false }))); sprite.position.set(x, y, z); sprite.scale.set(width, number ? width : width / 4, 1); parent.add(sprite); return sprite;
    }
    // A thick toy diorama base and instanced cream/mint tiles keep the large roster scene inexpensive.
    block(scene, 0, -.65, 0, size.halfX * 2 + .6, 1.2, size.halfZ * 2 + .6, '#355c4a', true);
    block(scene, 0, -.08, 0, size.halfX * 2, .2, size.halfZ * 2, '#b1c1a7');
    for (let parity = 0; parity < 2; parity++) {
      const positions: [number, number][] = []; for (let x = -size.halfX; x < size.halfX; x++) for (let z = -size.halfZ; z < size.halfZ; z++) if ((x + z + 50) % 2 === parity) positions.push([x + .5, z + .5]);
      const tiles = new InstancedMesh(box, material(parity ? level.floor : '#e1e9d4'), positions.length), transform = new Object3D();
      positions.forEach(([x, z], index) => { transform.position.set(x, .015, z); transform.scale.set(.97, .06, .97); transform.updateMatrix(); tiles.setMatrixAt(index, transform.matrix); }); scene.add(tiles);
    }
    block(scene, 0, .5, -size.halfZ - .15, size.halfX * 2 + .4, 1.1, .3, level.accent, true);
    for (const x of [-size.halfX - .15, size.halfX + .15]) block(scene, x, .22, 0, .3, .6, size.halfZ * 2, '#e4c99d', true);
    // Low rear windows and awning frame the kitchen without obscuring the work surface.
    for (let x = -size.halfX + 2; x < size.halfX; x += 4) { block(scene, x, 1.45, -size.halfZ - .23, 2.7, 1.5, .18, '#f9f3db', true); block(scene, x, 1.5, -size.halfZ - .1, 2.35, 1.1, .06, '#90c5c4'); block(scene, x, 1.5, -size.halfZ + .01, .08, 1.1, .07, '#fff3d4'); }
    for (let i = 0; i < size.halfX * 2; i++) block(scene, -size.halfX + i + .5, 2.5, -size.halfZ - .1, 1, .16, 1.15, i % 2 ? '#fff5da' : level.accent);
    label(scene, 'KITCHEN RUSH', 0, 3, -size.halfZ - .25, 4.3, '#f2ae51', '#2c4839');
    // Trim, planters and outside stools establish a tiny welcoming restaurant.
    for (const x of [-size.halfX - 1.15, size.halfX + 1.15]) for (const z of [-3, 1, 4]) { const planter = model('planter'); planter.position.set(x, -.45, z); scene.add(planter); }
    if (level.theme === 1 || level.topology === 'bridge') { block(scene, 0, -.72, 0, level.topology === 'bridge' ? 2.2 : .7, .12, size.halfZ * 2 + 5, '#63b9cf'); }
    const bridge = new Group(); scene.add(bridge);
    if (level.topology === 'bridge') {
      block(scene, 0, .06, 0, 2.15, .16, size.halfZ * 2 - 6, '#68bdcc');
      for (const z of [-size.halfZ + 2.5, size.halfZ - 2.5]) for (let i = -2; i <= 2; i++) block(scene, i * .48, .12, z, .44, .15, 2, '#d5a364');
      for (let i = -2; i <= 2; i++) block(bridge, i * .48, .15, 0, .44, .18, 2.1, '#dfb47e');
      for (const z of [-1.12, 1.12]) block(bridge, 0, .25, z, 2.2, .25, .1, '#d1a04f');
      label(scene, 'ALWAYS OPEN', 0, .5, size.halfZ - 2.5, 2.5);
    }
    if (level.theme === 0) for (const x of [-size.halfX - 1.8, size.halfX + 1.8]) { block(scene, x, -.5, 0, 1.2, .2, 4.4, '#d39b64', true); for (const z of [-1.1, 1.1]) { tube(scene, x, -.05, z, .35, .2, '#d9704a'); tube(scene, x, -.3, z, .1, .5, '#57766b'); } }
    if (level.theme === 1) { for (const x of [-size.halfX + .5, size.halfX - .5]) { block(scene, x, 2, -size.halfZ - .6, .15, 3, .15, '#405c68'); label(scene, 'CANAL', x, 2.8, -size.halfZ - .6, 1.8, '#366d85'); } for (let x = -size.halfX; x <= size.halfX; x += 1.6) block(scene, x, -.5, size.halfZ + .6, .15, .55, .15, '#c89c60'); }
    if (level.theme === 2) for (const x of [-size.halfX - .4, size.halfX + .4]) { const gear = new Mesh(ring, material('#ba8956')); gear.position.set(x, .4, -size.halfZ + 1.8); gear.scale.setScalar(.8); gear.rotation.y = Math.PI / 2; scene.add(gear); block(scene, x, -.05, 0, .4, .15, size.halfZ * 2, '#a06e40'); }
    if (level.theme === 3) for (let i = 0; i < 9; i++) { const x = -size.halfX - 5 + i * (size.halfX * 2 + 10) / 8; block(scene, x, -2.5, -size.halfZ - 4 - (i % 2) * 2, 2.5, 3 + i % 3, 2.5, ['#aaa7c7', '#98acba', '#b7a3c0'][i % 3], true); }
    const fans: Group[] = [];
    if (hasGust(level)) for (const x of [-size.halfX - .3, size.halfX + .3]) {
      const fan = model('fan'); fan.position.set(x, 1.8, .3); scene.add(fan); fans.push(fan);
    }
    function food(parent: Group, part: Food, offsetX = 0, offsetZ = 0, scale = 1) {
      const object = model(`${part.kind}_${part.stage}`); object.position.set(offsetX, 0, offsetZ); object.scale.setScalar(scale); parent.add(object);
    }
    function itemObject(item: Item) {
      const group = item.kind === 'plate' ? model(item.dirty ? 'plate_dirty' : 'plate') : new Group();
      const recipe = recipeFor(item);
      if (recipe) { group.add(model(`dish_${recipe.id}`)); return group; }
      item.food.forEach((part, index) => food(group, part, item.kind === 'plate' ? Math.sin(index * 2.1) * .19 : 0, item.kind === 'plate' ? Math.cos(index * 2.1) * .16 : 0, item.kind === 'plate' ? .7 : 1));
      return group;
    }
    const stationArt = new Group(); scene.add(stationArt);
    const fixtures = layout(kitchen, props.players.length).map(station => {
      const group = new Group(), art = new Group(); group.position.set(station.x, 0, station.z); art.position.copy(group.position); scene.add(group); stationArt.add(art);
      const kind = station.kind;
      art.add(model(`station_${kind}`));
      if (kind === 'crate') for (const [x, z] of [[-.36, -.24], [.35, -.18], [0, .36]]) {
        const produce = new Group(); produce.position.set(x, 1.08, z); art.add(produce); food(produce, { kind: station.ingredient!, stage: 'raw' });
      }
      const stock: Group[] = [];
      if (kind === 'plates' || kind === 'return') for (let i = 0; i < 6; i++) {
        const plate = model(kind === 'return' ? 'plate_dirty' : 'plate'); plate.position.y = 1.18 + i * .075; group.add(plate); stock.push(plate);
      }
      if (kind === 'serve') { const bell = model('bell'); bell.position.set(.55, 1.24, .35); group.add(bell); group.userData.bell = bell; }
      const barBack = block(group, 0, 2.04, 0, 1.3, .12, .08, '#345447', true), bar = block(group, -.6, 2.06, .01, 1.2, .07, .09, '#8add63', true); barBack.visible = false; bar.visible = false;
      const fire = new Group(); fire.position.set(0, 1.3, kind === 'oven' ? .52 : 0); for (let i = 0; i < 3; i++) { ball(fire, (i - 1) * .3, .35, 0, .25, .6, .25, '#f29734'); ball(fire, (i - 1) * .3, .15, .15, .15, .35, .15, '#ffe370'); } fire.visible = false; group.add(fire);
      const steam = new Group(); steam.position.z = kind === 'oven' ? .52 : 0; for (let i = 0; i < 3; i++) ball(steam, (i - 1) * .2, 1.6 + i * .17, 0, .09, .18, .09, '#f4f1df'); steam.visible = false; group.add(steam);
      const power = label(group, 'Ⅱ', .65, 1.7, -.6, .45, '#f0ba54', '#263e34'); power.visible = hasPower(level) && (station.kind === 'stove' || station.kind === 'oven');
      const ready=label(group,'✓',-.65,1.75,.6,.5,'#3f7e46');ready.visible=false;
      const highlight = new Mesh(ring, material('#ffd057')); highlight.rotation.x = -Math.PI / 2; highlight.position.y = .12; highlight.scale.setScalar(1.16); highlight.visible = false; group.add(highlight);
      return { id: station.id, group, barBack, bar, fire, steam, highlight, power, ready, stock, item: null as Group | null, signature: '' };
    });
    stationArt.updateMatrixWorld(true);
    const batches = new Map<string, Mesh[]>();
    stationArt.traverse(object => { if (object instanceof Mesh) { const key = `${object.geometry.uuid}:${(object.material as MeshStandardMaterial).uuid}`; const meshes = batches.get(key) ?? []; meshes.push(object); batches.set(key, meshes); } });
    stationArt.clear();
    for (const meshes of batches.values()) { const batch = scope.own(new InstancedMesh(meshes[0].geometry, meshes[0].material, meshes.length)); meshes.forEach((mesh, i) => batch.setMatrixAt(i, mesh.matrixWorld)); stationArt.add(batch); }
    const chefs = props.players.map((player, index) => {
      const root = new Group(), body = new Group(); root.add(body); scene.add(root);
      const shadow = tube(root, 0, .05, 0, .48, .02, player.color); shadow.scale.z = .8;
      const selected = (player.lobbyChoice as { character?: string } | undefined)?.character ?? 'chef';
      const character = model(`chef${selected === 'chef_f' ? 1 : [0, 2, 3][index % 3]}`, player.color); body.add(character);
      let joints = chefJoints(character);
      if (characters && !['chef', 'chef_f'].includes(selected)) {
        body.remove(character);
        const head = new Group(); head.add(characters.create(`${selected}_body`), characters.create(`${selected}_color`, player.color)); body.add(head);
        const pivot = (name: string) => { const mesh = characters.create(name), group = new Group(); group.position.copy(mesh.position); mesh.position.set(0,0,0); group.add(mesh); body.add(group); return group; };
        joints = { head, arms: [pivot(`${selected}_left_hand`), pivot(`${selected}_right_hand`)], legs: [pivot('chef_left_foot'), pivot('chef_right_foot')] };
      }
      const badge = label(root, String(index + 1), 0, 2.1, 0, .9, player.color, '#18362d'); badge.scale.set(.63, .63, 1);
      root.position.set(-size.halfX + 2 + index * (2 * size.halfX - 4) / Math.max(1, props.players.length - 1), 0, size.halfZ - 3);
      return { id: player.id, root, body, joints, item: null as Group | null, signature: '', x: root.position.x, z: root.position.z };
    });
    let served:number|null=null,servedAt=-Infinity;
    const loose = new Map<number, { group: Group; signature: string }>();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)'), quality = readGraphicsQuality();
    const replaceItem = (owner: { item: Group | null; signature: string }, parent: Group, item: Item | null, height: number, forward = 0) => {
      const signature = item ? JSON.stringify(item) : ''; if (signature === owner.signature) return; if (owner.item) parent.remove(owner.item); owner.signature = signature; owner.item = item ? itemObject(item) : null;
      if (owner.item) { owner.item.position.set(0, height, forward); parent.add(owner.item); }
    };
    mountThreeScene(canvas.current!, { signal: scope.signal, scene, camera, quality,
      resize(aspect) { const halfW = size.halfX + 2, halfH = Math.max(size.halfZ * .58 + 2.8, halfW / aspect); camera.left = -halfH * aspect; camera.right = halfH * aspect; camera.top = halfH + 1.1; camera.bottom = -halfH + 1.1; camera.updateProjectionMatrix(); },
      frame(now) {
        const view = buffer.current.sample(latest.current.serverNowMs(), interpolate); if (!view) return;if(served!==null&&view.served>served)servedAt=now;served=view.served;
        for (const visual of chefs) { const chef = view.players.find(player => player.id === visual.id); if (!chef) continue; const moving = Math.hypot(chef.x - visual.x, chef.z - visual.z) > .002; visual.x = chef.x; visual.z = chef.z; visual.root.position.set(chef.x, 0, chef.z); visual.body.rotation.y = Math.atan2(chef.facingX, chef.facingZ); visual.body.position.y = !reduced.matches && moving ? Math.abs(Math.sin(now / 90)) * .055 : 0; const work = !chef.held && view.stations.some(station => station.id === chef.target && station.working);
          const stride = !reduced.matches && moving ? Math.sin(now / 90) * .6 : 0;
          visual.joints.legs.forEach((leg, i) => { leg.rotation.x = i ? -stride : stride; });
          visual.joints.arms.forEach((arm, i) => { arm.rotation.x = chef.held ? -1.15 : work ? -1.05 + (!reduced.matches ? Math.sin(now / 85 + i) * .3 : 0) : (i ? stride : -stride) * .6; });
          visual.joints.head.rotation.z = !reduced.matches && work ? Math.sin(now / 170) * .07 : 0; replaceItem(visual, visual.body, chef.held, .86, .6); visual.root.visible = chef.connected; }
        for (const visual of fixtures) { const station = view.stations.find(item => item.id === visual.id)!;const bell=visual.group.userData.bell as Group|undefined;if(bell){const age=(now-servedAt)/450;bell.rotation.z=!reduced.matches&&age<1?Math.sin(age*24)*.22*(1-age):0;} replaceItem(visual, visual.group, station.item, 1.3, station.kind === 'oven' ? .52 : 0); if (visual.item && station.kind === 'oven') visual.item.scale.setScalar(.78); visual.stock.forEach((plate, i) => { plate.visible = i < (station.kind === 'plates' ? view.cleanPlates : view.dirtyPlates); }); visual.barBack.visible = visual.bar.visible = station.progress > 0 || station.fire > 0; const cooker=cookingStatus(station,view.settings.practice),progress = cooker?.progress??(station.fire || station.progress);visual.ready.visible=cooker?.kind==='ready'||cooker?.kind==='warning'; visual.bar.scale.x = 1.2 * progress; visual.bar.position.x = -.6 + .6 * progress; visual.bar.material = material(cooker?.color??(station.fire?'#ff6d3a':'#80cd58')); visual.power.material.color.set(station.powered ? '#a4ff76' : '#a4a4a4'); visual.fire.visible = station.fire > 0; visual.fire.scale.y = reduced.matches ? 1 : 1 + Math.sin(now / 80) * .1; visual.steam.visible = !reduced.matches && (station.kind === 'stove' || station.kind === 'oven') && station.powered && !!station.item && station.heat > 2 && !station.fire; visual.steam.position.y = Math.sin(now / 250) * .08; visual.highlight.visible = view.players.some(chef => chef.connected && chef.target === station.id); if (visual.item && station.working && !reduced.matches) visual.item.position.y = 1.3 + Math.abs(Math.sin(now / 75)) * .06; }
        for (const item of view.loose) { const signature = JSON.stringify(item.item); let object = loose.get(item.item.id); if (!object || object.signature !== signature) { if (object) scene.remove(object.group); object = { group: itemObject(item.item), signature }; loose.set(item.item.id, object); scene.add(object.group); } object.group.position.set(item.x, item.flight ? .7 + Math.sin(item.flight / .55 * Math.PI) * 1.5 : .1, item.z); }
        for (const [id, object] of loose) if (!view.loose.some(item => item.item.id === id)) { scene.remove(object.group); loose.delete(id); }
        bridge.visible = view.hazard !== 'active'; fans.forEach(fan => { if (!reduced.matches) fan.rotation.y = now / (view.hazard === 'active' ? 80 : 700); });
      }, onReady: () => latest.current.onReady(), onError: error => latest.current.onError(error), onMetrics: setMetrics,
    });
    }
    void build().catch(error => { if (!scope.signal.aborted) { latest.current.onError(error); scope.dispose(); } });
    return scope.dispose;
  }, [props.roundId, props.signal]);
  return <><canvas ref={canvas} aria-label="Kitchen Rush 3D kitchen with numbered chefs, ingredient crates, chopping boards, cookers and dish stations"/><details className="kr-metrics" hidden={!new URLSearchParams(location.search).has('metrics')}><summary>Scene stats</summary><pre data-testid="scene-metrics">{metrics ? JSON.stringify(metrics, null, 2) : 'Warming up…'}</pre></details></>;
}
