import { useEffect, useRef, useState } from 'react';
import { Scene, Color, OrthographicCamera, HemisphereLight, DirectionalLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, CanvasTexture, SpriteMaterial, Sprite, Group, InstancedMesh, Object3D } from 'three';
import { loadKitchenAssets } from './assets';
import type { SceneViewProps } from '../../../party-ui/src/index';
import { ResourceScope, SnapshotBuffer } from '../../../party-runtime/src/index';
import { mountThreeScene, type SceneMetrics } from '../../../party-3d/src/index';
import { readGraphicsQuality } from './preferences';
import {cookingStatus} from './presentation';
import { recipeFor, KITCHENS, dimensions, hasGust, hasPower, interpolate, layout, type Food, type Item, type Settings, type View } from './model';
export default function Kitchen(props: SceneViewProps<Settings, View>) {
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef(props), buffer = useRef(new SnapshotBuffer<View>()); latest.current = props;
  const [metrics, setMetrics] = useState<SceneMetrics | null>(null);
  useEffect(() => { if (props.publicView && props.snapshotTime !== null) buffer.current.push(props.snapshotTime, props.publicView); }, [props.publicView, props.snapshotTime]);
  useEffect(() => {
    const scope = new ResourceScope(props.signal), scene = new Scene(), size = dimensions(props.players.length), kitchen = props.settings.kitchen ?? 0, level = KITCHENS[kitchen];
    void (async () => {
    const kit = await loadKitchenAssets(scope);
    scene.background = new Color(level.theme === 3 ? '#d8d3e8' : '#c6e2d6');
    const camera = new OrthographicCamera(-16, 16, 10, -10, .1, 100); camera.position.set(0, 22, 31); camera.lookAt(0, 0, 0);
    scene.add(new HemisphereLight('#fffbea', '#81958c', 1.7)); const sun = new DirectionalLight('#fff0cc', 2.2); sun.position.set(-12, 22, 10); scene.add(sun);
    const material = kit.tint;
    const box = kit.geometry('tile'), rounded = kit.geometry('block'), cylinder = kit.geometry('cylinder'), ring = kit.geometry('ring');
    function block(parent: Group | Scene, x: number, y: number, z: number, w: number, h: number, d: number, color: string, round = false) { const mesh = new Mesh(round ? rounded : box, material(color)); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); parent.add(mesh); return mesh; }
    function tube(parent: Group | Scene, x: number, y: number, z: number, radius: number, height: number, color: string) { const mesh = new Mesh(cylinder, material(color)); mesh.position.set(x, y, z); mesh.scale.set(radius, height, radius); parent.add(mesh); return mesh; }
    function prop(parent: Group | Scene, name: string, x: number, y: number, z: number) { const mesh = kit.create(name); mesh.position.set(x, y, z); parent.add(mesh); return mesh; }
    function label(parent: Group | Scene, text: string, x: number, y: number, z: number, width = 1.6, background = '#234c3e', foreground = '#fff8e8') {
      const element = document.createElement('canvas'); const number = /^[\d✓!]+$/.test(text); element.width = number ? 96 : 384; element.height = 96; const context = element.getContext('2d')!;
      context.fillStyle = background; context.beginPath(); context.roundRect(4, 4, number ? 88 : 376, 88, number ? 44 : 18); context.fill(); context.fillStyle = foreground; context.font = `1000 ${number ? 68 : 52}px Nunito, sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, number ? 48 : 192, 51, number ? 82 : 360);
      const texture = scope.own(new CanvasTexture(element)), sprite = new Sprite(scope.own(new SpriteMaterial({ map: texture, depthTest: false }))); sprite.position.set(x, y, z); sprite.scale.set(width, number ? width : width / 4, 1); parent.add(sprite); return sprite;
    }
    // A thick toy diorama base and instanced cream/mint tiles keep the large roster scene inexpensive.
    // Side patios widen the base so outdoor dressing stands on the diorama. They scale with the kitchen,
    // sit a step below its floor, and are paved in a muted shade of the stage accent with a dark kerb.
    const shell = size.halfX * 2 + .6, patio = Math.max(1.6, size.halfX * .14), hex = (color: Color) => '#' + color.getHexString();
    const paving = hex(new Color(level.accent).lerp(new Color('#6f675c'), .55)), seam = hex(new Color(paving).multiplyScalar(.82));
    block(scene, 0, -.65, 0, shell + patio * 2 + .3, 1.2, size.halfZ * 2 + .6, '#355c4a', true);
    for (const side of [-1, 1]) {
      const x = side * (shell + patio) / 2;
      block(scene, x, -.1, 0, patio, .1, size.halfZ * 2 + .3, paving);
      for (let z = -size.halfZ + 1; z < size.halfZ; z += 1.25) block(scene, x, -.045, z, patio - .1, .012, .04, seam);
      block(scene, side * (shell / 2 + patio - .04), -.02, 0, .08, .16, size.halfZ * 2 + .3, '#4a4038');
    }
    block(scene, 0, -.08, 0, size.halfX * 2, .2, size.halfZ * 2, '#b1c1a7');
    for (let parity = 0; parity < 2; parity++) {
      const positions: [number, number][] = []; for (let x = -size.halfX; x < size.halfX; x++) for (let z = -size.halfZ; z < size.halfZ; z++) if ((x + z + 50) % 2 === parity) positions.push([x + .5, z + .5]);
      const tiles = scope.own(new InstancedMesh(box, material(parity ? level.floor : '#e1e9d4'), positions.length)), transform = new Object3D();
      positions.forEach(([x, z], index) => { transform.position.set(x, .015, z); transform.scale.set(.97, .06, .97); transform.updateMatrix(); tiles.setMatrixAt(index, transform.matrix); }); scene.add(tiles);
    }
    for (const x of [-size.halfX - .15, size.halfX + .15]) block(scene, x, .22, 0, .3, .6, size.halfZ * 2, '#efe0c4', true);
    // A continuous back wall: 4-unit modules stretched to the roster width and closed by corner pillars.
    // The wainscot takes the stage accent softened toward plaster so it does not compete with the crates.
    const wallZ = -size.halfZ - .15, modules = Math.round(shell / 4), stretch = shell / modules / 4, wainscot = hex(new Color(level.accent).lerp(new Color('#f6ead2'), .4));
    for (let i = 0; i < modules; i++) { const x = -shell / 2 + (i + .5) * shell / modules; prop(scene, 'wall_section', x, 0, wallZ).scale.x = stretch; const panel = kit.create('wall_wainscot', wainscot); panel.position.set(x, 0, wallZ); panel.scale.x = stretch; scene.add(panel); }
    for (const side of [-1, 1]) prop(scene, 'wall_pillar', side * (shell / 2 + .1), 0, wallZ);
    // The awning hangs off the wall top on brackets, one tinted stripe per unit, below a mounted sign.
    const stripes = Math.round(shell), stripe = shell / stripes;
    for (let i = 0; i < stripes; i++) { const canopy = kit.create('awning', i % 2 ? '#fff5da' : level.accent); canopy.position.set(-shell / 2 + (i + .5) * stripe, 3.22, wallZ + .2); canopy.scale.x = stripe; scene.add(canopy); }
    for (let x = -shell / 2 + 1.5; x < shell / 2 - 1; x += 3) prop(scene, 'awning_bracket', x, 3.22, wallZ + .16);
    prop(scene, 'sign_board', 0, 3.34, wallZ + .05);
    label(scene, 'KITCHEN RUSH', 0, 4.06, wallZ + .2, 4.4, 'transparent', '#ffe6ad');
    // Patio dressing, sized to read beside the stations: a low garden wall continues the frontage,
    // a hedge planter sits at each end and the centrepiece suits the stage.
    for (const side of [-1, 1]) {
      const x = side * (shell + patio) / 2;
      block(scene, x, .38, wallZ, patio, .86, .28, '#f1e3c8', true); block(scene, x, .84, wallZ, patio + .08, .1, .36, '#e3b578', true);
      for (const z of [-size.halfZ + 2.1, size.halfZ - 1.5]) prop(scene, 'planter_box', x, -.05, z).scale.setScalar(1.35);
      // The diner keeps just its planters; the other settings add a centrepiece.
      const centrepiece = [null, 'lamp', 'barrels', 'vent'][level.theme];
      if (centrepiece) { const piece = prop(scene, centrepiece, x, -.05, .6); piece.rotation.y = side > 0 ? Math.PI : 0; piece.scale.setScalar(1.45); }
    }
    const bridge = new Group(); scene.add(bridge);
    if (level.topology === 'bridge') {
      block(scene, 0, .06, 0, 2.15, .16, size.halfZ * 2 - 6, '#68bdcc');
      for (const z of [-size.halfZ + 2.5, size.halfZ - 2.5]) for (let i = -2; i <= 2; i++) block(scene, i * .48, .12, z, .44, .15, 2, '#d5a364');
      prop(bridge, 'bridge', 0, .03, 0);
      // Painted flat on the back crossing's planks. As a sprite it ignored depth and floated over the dish stations,
      // and the front crossing is hidden under that station row; nothing stands in front of the back one.
      const painted = label(scene, 'ALWAYS OPEN', 0, 0, 0, 2.2); scene.remove(painted);
      const decal = new Mesh(scope.own(new PlaneGeometry(2.2, .55)), scope.own(new MeshBasicMaterial({ map: painted.material.map, transparent: true })));
      decal.rotation.x = -Math.PI / 2; decal.position.set(0, .21, -size.halfZ + 3); scene.add(decal);
    }
    // Clockwork stages mount a gear face-on on each corner pillar.
    if (level.theme === 2) for (const side of [-1, 1]) { const gear = kit.create('gear'); gear.position.set(side * (shell / 2 + .1), 2.3, wallZ + .34); gear.scale.setScalar(.5); gear.rotation.x = Math.PI / 2; scene.add(gear); }
    if (level.theme === 3) for (let i = 0; i < 9; i++) { const x = -size.halfX - 5 + i * (size.halfX * 2 + 10) / 8; block(scene, x, -2.5, -size.halfZ - 4 - (i % 2) * 2, 2.5, 3 + i % 3, 2.5, ['#aaa7c7', '#98acba', '#b7a3c0'][i % 3], true); }
    const fans: Mesh[] = [];
    // Gust stages stand their fans on poles on the patios instead of floating over the side rails.
    if (hasGust(level)) for (const side of [-1, 1]) { const x = side * (shell + patio) / 2, z = size.halfZ - 3.2; block(scene, x, .78, z, .1, 1.66, .1, '#4d5d63'); fans.push(prop(scene, 'fan', x, 1.6, z)); }
    function food(parent: Group, part: Food, offsetX = 0, offsetZ = 0, scale = 1) {
      const object = kit.create(`food_${part.kind}_${part.stage}`); object.position.set(offsetX, 0, offsetZ); object.scale.setScalar(scale); parent.add(object);
    }
    function itemObject(item: Item) {
      const group = new Group(), recipe = item.kind === 'plate' && !item.dirty ? recipeFor(item) : null;
      if (recipe) { group.add(kit.create(`dish_${recipe.id}`)); return group; }
      if (item.kind === 'plate') group.add(kit.create(item.dirty ? 'plate_dirty' : 'plate_clean'));
      const contents = new Group(); contents.position.y = item.kind === 'plate' ? .1 : 0; group.add(contents);
      item.food.forEach((part, index) => food(contents, part, item.kind === 'plate' ? Math.sin(index * 2.1) * .19 : 0, item.kind === 'plate' ? Math.cos(index * 2.1) * .16 : 0, item.kind === 'plate' ? .7 : 1)); return group;
    }
    const stationArt = new Group(); scene.add(stationArt);
    const fixtures = layout(kitchen, props.players.length).map(station => {
      const group = new Group(), art = new Group(); group.position.set(station.x, 0, station.z); art.position.copy(group.position); scene.add(group); stationArt.add(art);
      const kind = station.kind;
      art.add(kit.create(`station_${kind}`));
      if (kind === 'crate') for (const [x, z, scale] of [[-.38, -.24, 1.04], [.35, -.18, 1.13], [0, .36, 1.08]]) { const produce = new Group(); produce.position.set(x, 1.05, z); art.add(produce); food(produce, { kind: station.ingredient!, stage: 'raw' }, 0, 0, scale); }
      const stock: Mesh[] = [];
      if (kind === 'plates' || kind === 'return') for (let i = 0; i < 6; i++) { const plate = prop(group, kind === 'return' ? 'plate_dirty' : 'plate_clean', 0, 1.18 + i * .085, 0); plate.scale.setScalar(1.12); stock.push(plate); }
      if (kind === 'serve') group.userData.bell = prop(group, 'bell', .55, 1.24, .35);
      const barBack = block(group, 0, 2.04, 0, 1.3, .12, .08, '#345447', true), bar = block(group, -.6, 2.06, .01, 1.2, .07, .09, '#8add63', true); barBack.visible = false; bar.visible = false;
      const fire = prop(group, 'fire', 0, 1.3, kind === 'oven' ? .52 : 0); fire.visible = false;
      const steam = prop(group, 'steam', 0, 1.3, kind === 'oven' ? .52 : 0); steam.visible = false;
      const power = label(group, 'Ⅱ', .65, 1.7, -.6, .45, '#f0ba54', '#263e34'); power.visible = hasPower(level) && (station.kind === 'stove' || station.kind === 'oven');
      const ready=label(group,'✓',-.65,1.75,.6,.5,'#3f7e46');ready.visible=false;
      const highlight = new Mesh(ring, material('#ffd057')); highlight.position.y = .12; highlight.scale.setScalar(1.16); highlight.visible = false; group.add(highlight);
      return { id: station.id, group, barBack, bar, fire, steam, highlight, power, ready, stock, item: null as Group | null, signature: '' };
    });
    stationArt.updateMatrixWorld(true);
    const batches = new Map<string, Mesh[]>();
    stationArt.traverse(object => { if (object instanceof Mesh) { const key = `${object.geometry.uuid}:${(object.material as MeshStandardMaterial).uuid}`; const meshes = batches.get(key) ?? []; meshes.push(object); batches.set(key, meshes); } });
    stationArt.clear();
    for (const meshes of batches.values()) { const batch = scope.own(new InstancedMesh(meshes[0].geometry, meshes[0].material, meshes.length)); meshes.forEach((mesh, i) => batch.setMatrixAt(i, mesh.matrixWorld)); stationArt.add(batch); }
    // A chef wears the cook its player picked. Body, accents and hands swap together; the clogs are shared.
    // Human cooks keep the seat's skin tone. The colour circle and number badge stay, so duplicates are told apart.
    function dress<T extends { color: string; skin: string; character: string; outfit: Group; hands: Mesh[] }>(visual: T, character: string) {
      const suffix = character === 'chef' || character === 'chef_f' ? visual.skin : '';
      visual.outfit.clear(); visual.hands = [kit.create(`${character}_left_hand${suffix}`), kit.create(`${character}_right_hand${suffix}`)];
      visual.outfit.add(kit.create(`${character}_body${suffix}`), kit.create(`${character}_color`, visual.color), ...visual.hands); visual.character = character; return visual;
    }
    const chefs = props.players.map((player, index) => {
      const root = new Group(), body = new Group(), outfit = new Group(); body.add(outfit); root.add(body); scene.add(root);
      const shadow = tube(root, 0, .05, 0, .48, .02, player.color); shadow.scale.z = .8;
      const leftFoot = kit.create('chef_left_foot'), rightFoot = kit.create('chef_right_foot'); body.add(leftFoot, rightFoot);
      const badge = label(root, String(index + 1), 0, 2.1, 0, .9, player.color, '#18362d'); badge.scale.set(.63, .63, 1);
      root.position.set(-size.halfX + 2 + index * (2 * size.halfX - 4) / Math.max(1, props.players.length - 1), 0, size.halfZ - 3);
      return dress({ id: player.id, color: player.color, skin: index % 4 ? `_${index % 4}` : '', character: '', outfit, root, body, hands: [] as Mesh[], leftFoot, rightFoot, item: null as Group | null, signature: '', x: root.position.x, z: root.position.z }, 'chef');
    });
    let served:number|null=null,servedAt=-Infinity;
    const loose = new Map<number, { group: Group; signature: string }>();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)'), quality = readGraphicsQuality();
    scope.defer(() => { scene.clear(); buffer.current.clear(); });
    const replaceItem = (owner: { item: Group | null; signature: string }, parent: Group, item: Item | null, height: number, forward = 0) => {
      const signature = item ? JSON.stringify(item) : ''; if (signature === owner.signature) return; if (owner.item) parent.remove(owner.item); owner.signature = signature; owner.item = item ? itemObject(item) : null;
      if (owner.item) { owner.item.position.set(0, height, forward); parent.add(owner.item); }
    };
    mountThreeScene(canvas.current!, { signal: scope.signal, scene, camera, quality,
      resize(aspect) { const halfW = (shell / 2 + patio + .15) * 1.06, halfH = Math.max(size.halfZ * .58 + 3.1, halfW / aspect); camera.left = -halfH * aspect; camera.right = halfH * aspect; camera.top = halfH + 1.3; camera.bottom = -halfH + 1.3; camera.updateProjectionMatrix(); },
      frame(now) {
        const view = buffer.current.sample(latest.current.serverNowMs(), interpolate); if (!view) return;if(served!==null&&view.served>served)servedAt=now;served=view.served;
        for (const visual of chefs) { const chef = view.players.find(player => player.id === visual.id); if (!chef) continue; if ((chef.character ?? 'chef') !== visual.character) dress(visual, chef.character ?? 'chef'); const moving = Math.hypot(chef.x - visual.x, chef.z - visual.z) > .002; visual.x = chef.x; visual.z = chef.z; visual.root.position.set(chef.x, 0, chef.z); visual.body.rotation.y = Math.atan2(chef.facingX, chef.facingZ); visual.body.position.y = !reduced.matches && moving ? Math.abs(Math.sin(now / 90)) * .055 : 0; visual.leftFoot.position.z = .08 + (!reduced.matches && moving ? Math.sin(now / 90) * .1 : 0); visual.rightFoot.position.z = .08 - (!reduced.matches && moving ? Math.sin(now / 90) * .1 : 0); visual.hands.forEach(hand => { hand.position.y = chef.held ? .9 : .68; }); replaceItem(visual, visual.body, chef.held, .86, .6); visual.root.visible = chef.connected; }
        for (const visual of fixtures) { const station = view.stations.find(item => item.id === visual.id)!;const bell=visual.group.userData.bell as Group|undefined;if(bell){const age=(now-servedAt)/450;bell.rotation.z=!reduced.matches&&age<1?Math.sin(age*24)*.22*(1-age):0;} replaceItem(visual, visual.group, station.item, 1.3, station.kind === 'oven' ? .52 : 0); if (visual.item && station.kind === 'oven') visual.item.scale.setScalar(.78); visual.stock.forEach((plate, i) => { plate.visible = i < (station.kind === 'plates' ? view.cleanPlates : view.dirtyPlates); }); visual.barBack.visible = visual.bar.visible = station.progress > 0 || station.fire > 0; const cooker=cookingStatus(station,view.settings.practice),progress = cooker?.progress??(station.fire || station.progress);visual.ready.visible=cooker?.kind==='ready'||cooker?.kind==='warning'; visual.bar.scale.x = 1.2 * progress; visual.bar.position.x = -.6 + .6 * progress; visual.bar.material = material(cooker?.color??(station.fire?'#ff6d3a':'#80cd58')); visual.power.material.color.set(station.powered ? '#a4ff76' : '#a4a4a4'); visual.fire.visible = station.fire > 0; visual.fire.scale.y = reduced.matches ? 1 : 1 + Math.sin(now / 80) * .1; visual.steam.visible = !reduced.matches && (station.kind === 'stove' || station.kind === 'oven') && station.powered && !!station.item && station.heat > 2 && !station.fire; visual.steam.position.y = 1.3 + Math.sin(now / 250) * .08; visual.highlight.visible = view.players.some(chef => chef.connected && chef.target === station.id); if (visual.item && station.working && !reduced.matches) visual.item.position.y = 1.3 + Math.abs(Math.sin(now / 75)) * .06; }
        for (const item of view.loose) { const signature = JSON.stringify(item.item); let object = loose.get(item.item.id); if (!object || object.signature !== signature) { if (object) scene.remove(object.group); object = { group: itemObject(item.item), signature }; loose.set(item.item.id, object); scene.add(object.group); } object.group.position.set(item.x, item.flight ? .7 + Math.sin(item.flight / .55 * Math.PI) * 1.5 : .1, item.z); }
        for (const [id, object] of loose) if (!view.loose.some(item => item.item.id === id)) { scene.remove(object.group); loose.delete(id); }
        bridge.visible = view.hazard !== 'active'; fans.forEach(fan => { if (!reduced.matches) fan.rotation.y = now / (view.hazard === 'active' ? 80 : 700); });
      }, onReady: () => latest.current.onReady(), onError: error => latest.current.onError(error), onMetrics: setMetrics,
    });
    })().catch(error => { if (!scope.signal.aborted) { scope.dispose(); latest.current.onError(error); } });
    return scope.dispose;
  }, [props.roundId, props.signal]);
  return <><canvas ref={canvas} aria-label="Kitchen Rush 3D kitchen with numbered chefs, ingredient crates, chopping boards, cookers and dish stations"/><details className="kr-metrics" hidden={!new URLSearchParams(location.search).has('metrics')}><summary>Scene stats</summary><pre data-testid="scene-metrics">{metrics ? JSON.stringify(metrics, null, 2) : 'Warming up…'}</pre></details></>;
}
