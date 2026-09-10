import { useEffect, useRef, useState } from 'react';
import { Scene, Color, OrthographicCamera, HemisphereLight, DirectionalLight, Mesh, BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, MeshStandardMaterial, CanvasTexture, SpriteMaterial, Sprite, Group, InstancedMesh, Object3D } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { SceneViewProps } from '../../../party-ui/src/index';
import { ResourceScope, SnapshotBuffer } from '../../../party-runtime/src/index';
import { mountThreeScene, type SceneMetrics } from '../../../party-3d/src/index';
import { readGraphicsQuality } from './preferences';
import {cookingStatus} from './presentation';
import { INGREDIENTS, KITCHENS, dimensions, hasGust, hasPower, interpolate, layout, type Food, type Item, type Settings, type View } from './model';
export default function Kitchen(props: SceneViewProps<Settings, View>) {
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef(props), buffer = useRef(new SnapshotBuffer<View>()); latest.current = props;
  const [metrics, setMetrics] = useState<SceneMetrics | null>(null);
  useEffect(() => { if (props.publicView && props.snapshotTime !== null) buffer.current.push(props.snapshotTime, props.publicView); }, [props.publicView, props.snapshotTime]);
  useEffect(() => {
    const scope = new ResourceScope(props.signal), scene = new Scene(), size = dimensions(props.players.length), kitchen = props.settings.kitchen ?? 0, level = KITCHENS[kitchen];
    scene.background = new Color(level.theme === 3 ? '#d8d3e8' : '#c6e2d6');
    const camera = new OrthographicCamera(-16, 16, 10, -10, .1, 100); camera.position.set(0, 22, 31); camera.lookAt(0, 0, 0);
    scene.add(new HemisphereLight('#fffbea', '#81958c', 1.7)); const sun = new DirectionalLight('#fff0cc', 2.2); sun.position.set(-12, 22, 10); scene.add(sun);
    const materials = new Map<string, MeshStandardMaterial>();
    const material = (color: string) => { let result = materials.get(color); if (!result) { result = scope.own(new MeshStandardMaterial({ color, roughness: .7 })); materials.set(color, result); } return result; };
    const box = scope.own(new BoxGeometry(1, 1, 1)), rounded = scope.own(new RoundedBoxGeometry(1, 1, 1, 2, .12)), cylinder = scope.own(new CylinderGeometry(1, 1, 1, 16)), sphere = scope.own(new SphereGeometry(1, 12, 8)), ring = scope.own(new TorusGeometry(1, .08, 6, 20)), wedge = scope.own(new CylinderGeometry(1, 1, 1, 3)), faucetArc = scope.own(new TorusGeometry(.32, .07, 6, 12, Math.PI)), ovenArch = scope.own(new TorusGeometry(.58, .17, 6, 18, Math.PI));
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
    for (const x of [-size.halfX - 1.15, size.halfX + 1.15]) for (const z of [-3, 1, 4]) { tube(scene, x, -.15, z, .45, .6, '#c28055'); ball(scene, x, .35, z, .62, .65, .62, '#62966a'); ball(scene, x + .25, .65, z, .4, .4, .4, '#90b879'); }
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
      const fan = new Group(); fan.position.set(x, 1.8, .3); scene.add(fan); tube(fan, 0, 0, 0, .55, .2, '#666d96'); for (let i = 0; i < 4; i++) { const blade = block(fan, 0, .2, 0, 1.3, .1, .2, '#c1c6e4', true); blade.rotation.y = i * Math.PI / 2; } fans.push(fan);
    }
    function food(parent: Group, part: Food, offsetX = 0, offsetZ = 0, scale = 1) {
      const object = new Group(); object.position.set(offsetX, 0, offsetZ); object.scale.setScalar(scale); parent.add(object);
      const base = part.stage === 'burnt' ? '#44392f' : part.stage === 'cooked' ? ({ tomato: '#c64e2e', onion: '#b47c3e', patty: '#79513a', dough: '#da9145' } as Partial<Record<Food['kind'], string>>)[part.kind] ?? INGREDIENTS[part.kind].color : INGREDIENTS[part.kind].color;
      if (part.stage === 'chopped') { for (const [x, z] of [[-.18, -.14], [.17, -.1], [0, .18]]) block(object, x, .09, z, .25, .17, .23, base, true); }
      else if (part.kind === 'lettuce') { ball(object, 0, .2, 0, .33, .25, .33, base); for (let i = 0; i < 3; i++) ball(object, Math.sin(i * 2) * .2, .28, Math.cos(i * 2) * .2, .19, .2, .19, '#9ad261'); }
      else if (part.kind === 'tomato') { ball(object, 0, .23, 0, .32, .28, .32, base); for (let i = 0; i < 3; i++) { const leaf = block(object, 0, .49, 0, .43, .035, .09, '#537945', true); leaf.rotation.y = i * Math.PI / 3; } }
      else if (part.kind === 'onion') { ball(object, 0, .22, 0, .3, .28, .3, base); ball(object, 0, .44, 0, .12, .19, .12, '#ece0b6'); for (const x of [-.06, .06]) { const root = block(object, x, .04, .22, .025, .035, .15, '#d6b184'); root.rotation.y = x * 5; } }
      else if (part.kind === 'patty') { tube(object, 0, .1, 0, .34, .18, base); for (const z of [-.16, 0, .16]) block(object, 0, .21, z, .5, .025, .035, part.stage === 'cooked' ? '#4d332c' : '#d09379'); }
      else if (part.kind === 'cheese') { const slice = new Mesh(wedge, material(base)); slice.position.y = .17; slice.scale.set(.42, .3, .42); slice.rotation.y = Math.PI / 6; object.add(slice); for (const [x, z, r] of [[-.08, .03, .065], [.09, .1, .045], [0, -.13, .04]]) tube(object, x, .325, z, r, .008, '#d8992c'); }
      else { ball(object, 0, .18, 0, .35, part.kind === 'bun' ? .24 : .1, .35, base); if (part.kind === 'bun') for (const x of [-.1, .1]) block(object, x, .4, 0, .045, .025, .1, '#fff0c0'); }
    }
    function itemObject(item: Item) { const group = new Group(); if (item.kind === 'plate') { tube(group, 0, .045, 0, .48, .07, item.dirty ? '#bab6a1' : '#fffaf0'); const rim = new Mesh(ring, material('#e1dbca')); rim.rotation.x = Math.PI / 2; rim.scale.setScalar(.43); rim.position.y = .1; group.add(rim); if (item.dirty) { tube(group, .1, .09, .05, .19, .015, '#947354'); } } item.food.forEach((part, index) => food(group, part, item.kind === 'plate' ? Math.sin(index * 2.1) * .19 : 0, item.kind === 'plate' ? Math.cos(index * 2.1) * .16 : 0, item.kind === 'plate' ? .7 : 1)); return group; }
    const stationArt = new Group(); scene.add(stationArt);
    const fixtures = layout(kitchen, props.players.length).map(station => {
      const group = new Group(), art = new Group(); group.position.set(station.x, 0, station.z); art.position.copy(group.position); scene.add(group); stationArt.add(art);
      const kind = station.kind;
      if (kind !== 'bin') {
        const color = kind === 'crate' || kind === 'board' ? '#b98450' : kind === 'stove' ? '#c65f46' : kind === 'sink' ? '#719daa' : kind === 'serve' ? '#cd674a' : kind === 'return' ? '#7c92a5' : level.accent;
        block(art, 0, .53, 0, 1.66, .92, 1.66, color, true);
        block(art, 0, .13, 0, 1.48, .17, 1.48, '#3e554c', true);
        if (kind !== 'crate' && kind !== 'belt') block(art, 0, 1.02, 0, 1.84, .17, 1.84, kind === 'stove' ? '#303f45' : '#fff7e3', true);
        if (!['crate', 'belt', 'return'].includes(kind)) { block(art, 0, .63, .84, 1.39, .51, .04, kind === 'stove' ? '#344750' : color, true); block(art, 0, .79, .9, .45, .065, .07, '#dce1d4', true); }
      }
      if (kind === 'crate') {
        block(art, 0, 1.03, 0, 1.45, .08, 1.45, '#6b5036');
        for (const y of [.54, .82, 1.15]) { for (const z of [-.83, .83]) block(art, 0, y, z, 1.72, .16, .12, '#d6aa6b', true); for (const x of [-.83, .83]) block(art, x, y, 0, .12, .16, 1.6, '#d6aa6b', true); }
        for (const [x, z, scale] of [[-.38, -.24, 1.04], [.35, -.18, 1.13], [0, .36, 1.08]]) { const produce = new Group(); produce.position.set(x, 1.08, z); art.add(produce); food(produce, { kind: station.ingredient!, stage: 'raw' }, 0, 0, scale); }
      }
      if (kind === 'board') {
        block(art, -.08, 1.16, 0, 1.42, .2, 1.32, '#d7aa6c', true); block(art, -.08, 1.27, 0, 1.3, .025, 1.19, '#edd098', true);
        for (const z of [-.32, .29]) { const score = block(art, -.13, 1.286, z, .48, .006, .018, '#c39b61'); score.rotation.y = -.3; }
        const blade = block(art, .54, 1.34, .05, .32, .09, .67, '#c9dadd', true); blade.rotation.y = -.12;
        block(art, .58, 1.35, .5, .16, .12, .34, '#3c5350', true);
      }
      if (kind === 'stove') {
        tube(art, 0, 1.14, -.08, .68, .09, '#182b31'); const coil = new Mesh(ring, material('#e0903c')); coil.rotation.x = Math.PI / 2; coil.position.set(0, 1.2, -.08); coil.scale.setScalar(.49); art.add(coil);
        tube(art, 0, 1.21, -.08, .48, .06, '#40525b'); block(art, .57, 1.23, -.08, .6, .13, .16, '#24373d', true);
        for (const x of [-.47, 0, .47]) { const knob = tube(art, x, .78, .9, .11, .1, '#e4d9c0'); knob.rotation.x = Math.PI / 2; }
        block(art, 0, .42, .871, 1.07, .24, .025, '#172d34', true);
      }
      if (kind === 'oven') {
        block(art, 0, 1.16, 0, 1.6, .17, 1.55, '#a9573d', true);
        const arch = new Mesh(ovenArch, material('#ce8256')); arch.position.set(0, 1.31, -.04); arch.scale.z = 3.3; art.add(arch);
        for (const x of [-.58, .58]) block(art, x, 1.27, -.04, .34, .24, 1.2, '#c27b51', true);
        block(art, 0, 1.46, -.64, 1.28, .57, .08, '#493329', true); block(art, 0, 1.23, .55, 1.08, .1, .69, '#e3b373', true);
        for (const x of [-.29, .29]) ball(art, x, 1.31, -.52, .15, .06, .12, '#e29343');
        for (const x of [-.62, .62]) for (const y of [1.25, 1.52]) block(art, x, y, .49, .17, .045, .2, '#ecd0a4');
        tube(art, .4, 2.03, -.47, .18, .55, '#a56347'); tube(art, .4, 2.31, -.47, .25, .09, '#db9e6d');
      }
      if (kind === 'belt') {
        block(art, 0, 1.08, 0, 1.48, .14, 1.74, '#2e484b', true);
        for (const x of [-.79, .79]) block(art, x, 1.17, 0, .13, .17, 1.78, '#a6beb9', true);
        for (const z of [-.6, 0, .6]) { const roller = tube(art, 0, 1.17, z, .1, 1.38, '#597775'); roller.rotation.z = Math.PI / 2; for (const x of [-.14, .14]) { const arrow = block(art, x, 1.28, z, .1, .025, .39, '#f1d073', true); arrow.rotation.y = x < 0 ? Math.PI / 4 : -Math.PI / 4; } }
      }
      if (kind === 'sink') {
        block(art, -.1, 1.105, 0, 1.1, .04, 1.16, '#467785', true); block(art, -.1, 1.13, 0, .9, .025, .91, '#8fdae0', true);
        for (const x of [-.76, .56]) block(art, x, 1.2, 0, .16, .22, 1.39, '#c0d4d5', true);
        for (const z of [-.64, .64]) block(art, -.1, 1.2, z, 1.3, .22, .16, '#c0d4d5', true);
        tube(art, .52, 1.43, -.5, .08, .58, '#c3d9da'); const faucet = new Mesh(faucetArc, material('#d0e1df')); faucet.position.set(.2, 1.72, -.5); art.add(faucet);
        tube(art, -.12, 1.67, -.5, .08, .12, '#c3d9da'); tube(art, .71, 1.31, -.39, .09, .1, '#4e9fcd');
        for (const [x, z, r] of [[-.36, -.2, .1], [-.21, -.3, .07], [-.41, -.38, .06]]) ball(art, x, 1.17, z, r, r * .6, r, '#e5ffff');
      }
      const stock: Mesh[] = [];
      if (kind === 'plates' || kind === 'return') {
        if (kind === 'return') { block(art, 0, 1.12, 0, 1.39, .09, 1.33, '#526c81', true); for (const x of [-.7, .7]) block(art, x, 1.3, 0, .12, .39, 1.39, '#7b9db2', true); for (const z of [-.65, .65]) block(art, 0, z < 0 ? 1.33 : 1.22, z, 1.38, z < 0 ? .38 : .17, .12, '#7b9db2', true); }
        else { for (const x of [-.63, .63]) block(art, x, 1.37, -.37, .09, .55, .1, '#b3bcb2', true); block(art, 0, 1.66, -.37, 1.33, .08, .1, '#c5d0c3', true); }
        for (let i = 0; i < 6; i++) stock.push(tube(group, 0, 1.18 + i * .075, 0, .58, .058, kind === 'return' ? '#bba68a' : '#fffefa'));
        const emblem = new Mesh(ring, material(kind === 'return' ? '#a88661' : '#fff8e3')); emblem.position.set(0, .58, .89); emblem.scale.setScalar(.22); art.add(emblem);
        if (kind === 'return') ball(art, .06, .59, .9, .11, .065, .015, '#816443');
      }
      if (kind === 'bin') {
        tube(art, 0, .6, 0, .7, 1.05, '#708f83'); for (const y of [.2, .45, .7, .95]) tube(art, 0, y, 0, .714, .045, '#8fa99a');
        tube(art, 0, 1.16, 0, .73, .11, '#486459'); tube(art, 0, 1.22, 0, .59, .025, '#203a32');
        const lid = tube(art, 0, 1.3, -.38, .72, .07, '#829d8c'); lid.rotation.x = .6; block(art, 0, .12, .76, .43, .09, .24, '#344e44', true);
      }
      if (kind === 'serve') {
        block(art, 0, 1.14, 0, 1.71, .08, 1.51, '#f0cc78', true);
        for (const x of [-.75, .75]) tube(art, x, 1.5, -.7, .045, .83, '#d4af70');
        for (let i = 0; i < 6; i++) block(art, -.75 + i * .3, 1.94, -.65, .3, .1, .5, i % 2 ? '#fff0d2' : '#df7453', true);
        const bell=new Group();bell.position.set(.55,1.24,.35);group.add(bell);group.userData.bell=bell;tube(bell,0,0,0,.26,.09,'#8d6840');ball(bell,0,.13,0,.23,.18,.23,'#efb840');tube(bell,0,.31,0,.055,.09,'#ffe2a2');
      }
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
      const leftFoot = block(body, -.17, .18, .08, .22, .18, .38, '#354c47', true), rightFoot = block(body, .17, .18, .08, .22, .18, .38, '#354c47', true);
      block(body, 0, .59, 0, .65, .7, .48, player.color, true); block(body, 0, .59, .25, .26, .5, .08, '#fff4db', true);
      const skin = ['#f0c49b', '#d6986d', '#935f45', '#c98257'][index % 4]; ball(body, 0, 1.08, 0, .3, .31, .29, skin);
      ball(body, -.11, 1.13, .266, .035, .04, .025, '#263e36'); ball(body, .11, 1.13, .266, .035, .04, .025, '#263e36'); ball(body, 0, 1.02, .29, .055, .05, .04, skin);
      tube(body, 0, 1.4, 0, .32, .25, '#fffdf0');tube(body,0,1.31,0,.33,.08,player.color); ball(body, -.19, 1.58, 0, .24, .23, .24, '#fffdf0'); ball(body, .18, 1.6, 0, .24, .25, .24, '#fffdf0'); ball(body, 0, 1.67, 0, .25, .25, .25, '#fffdf0');
      const hands = [ball(body, -.39, .68, .24, .13, .15, .13, skin), ball(body, .39, .68, .24, .13, .15, .13, skin)];
      const badge = label(root, String(index + 1), 0, 2.1, 0, .9, player.color, '#18362d'); badge.scale.set(.63, .63, 1);
      root.position.set(-size.halfX + 2 + index * (2 * size.halfX - 4) / Math.max(1, props.players.length - 1), 0, size.halfZ - 3);
      return { id: player.id, root, body, hands, leftFoot, rightFoot, item: null as Group | null, signature: '', x: root.position.x, z: root.position.z };
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
      resize(aspect) { const halfW = size.halfX + 2, halfH = Math.max(size.halfZ * .58 + 2.8, halfW / aspect); camera.left = -halfH * aspect; camera.right = halfH * aspect; camera.top = halfH + 1.1; camera.bottom = -halfH + 1.1; camera.updateProjectionMatrix(); },
      frame(now) {
        const view = buffer.current.sample(latest.current.serverNowMs(), interpolate); if (!view) return;if(served!==null&&view.served>served)servedAt=now;served=view.served;
        for (const visual of chefs) { const chef = view.players.find(player => player.id === visual.id); if (!chef) continue; const moving = Math.hypot(chef.x - visual.x, chef.z - visual.z) > .002; visual.x = chef.x; visual.z = chef.z; visual.root.position.set(chef.x, 0, chef.z); visual.body.rotation.y = Math.atan2(chef.facingX, chef.facingZ); visual.body.position.y = !reduced.matches && moving ? Math.abs(Math.sin(now / 90)) * .055 : 0; visual.leftFoot.position.z = .08 + (!reduced.matches && moving ? Math.sin(now / 90) * .1 : 0); visual.rightFoot.position.z = .08 - (!reduced.matches && moving ? Math.sin(now / 90) * .1 : 0); visual.hands.forEach(hand => { hand.position.y = chef.held ? .9 : .68; }); replaceItem(visual, visual.body, chef.held, .86, .6); visual.root.visible = chef.connected; }
        for (const visual of fixtures) { const station = view.stations.find(item => item.id === visual.id)!;const bell=visual.group.userData.bell as Group|undefined;if(bell){const age=(now-servedAt)/450;bell.rotation.z=!reduced.matches&&age<1?Math.sin(age*24)*.22*(1-age):0;} replaceItem(visual, visual.group, station.item, 1.3, station.kind === 'oven' ? .52 : 0); if (visual.item && station.kind === 'oven') visual.item.scale.setScalar(.78); visual.stock.forEach((plate, i) => { plate.visible = i < (station.kind === 'plates' ? view.cleanPlates : view.dirtyPlates); }); visual.barBack.visible = visual.bar.visible = station.progress > 0 || station.fire > 0; const cooker=cookingStatus(station,view.settings.practice),progress = cooker?.progress??(station.fire || station.progress);visual.ready.visible=cooker?.kind==='ready'||cooker?.kind==='warning'; visual.bar.scale.x = 1.2 * progress; visual.bar.position.x = -.6 + .6 * progress; visual.bar.material = material(cooker?.color??(station.fire?'#ff6d3a':'#80cd58')); visual.power.material.color.set(station.powered ? '#a4ff76' : '#a4a4a4'); visual.fire.visible = station.fire > 0; visual.fire.scale.y = reduced.matches ? 1 : 1 + Math.sin(now / 80) * .1; visual.steam.visible = !reduced.matches && (station.kind === 'stove' || station.kind === 'oven') && station.powered && !!station.item && station.heat > 2 && !station.fire; visual.steam.position.y = Math.sin(now / 250) * .08; visual.highlight.visible = view.players.some(chef => chef.connected && chef.target === station.id); if (visual.item && station.working && !reduced.matches) visual.item.position.y = 1.3 + Math.abs(Math.sin(now / 75)) * .06; }
        for (const item of view.loose) { const signature = JSON.stringify(item.item); let object = loose.get(item.item.id); if (!object || object.signature !== signature) { if (object) scene.remove(object.group); object = { group: itemObject(item.item), signature }; loose.set(item.item.id, object); scene.add(object.group); } object.group.position.set(item.x, item.flight ? .7 + Math.sin(item.flight / .55 * Math.PI) * 1.5 : .1, item.z); }
        for (const [id, object] of loose) if (!view.loose.some(item => item.item.id === id)) { scene.remove(object.group); loose.delete(id); }
        bridge.visible = view.hazard !== 'active'; fans.forEach(fan => { if (!reduced.matches) fan.rotation.y = now / (view.hazard === 'active' ? 80 : 700); });
      }, onReady: () => latest.current.onReady(), onError: error => latest.current.onError(error), onMetrics: setMetrics,
    });
    return scope.dispose;
  }, [props.roundId, props.signal]);
  return <><canvas ref={canvas} aria-label="Kitchen Rush 3D kitchen with numbered chefs, ingredient crates, chopping boards, cookers and dish stations"/><details className="kr-metrics" hidden={!new URLSearchParams(location.search).has('metrics')}><summary>Scene stats</summary><pre data-testid="scene-metrics">{metrics ? JSON.stringify(metrics, null, 2) : 'Warming up…'}</pre></details></>;
}
