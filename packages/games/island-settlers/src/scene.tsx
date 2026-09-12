import { useEffect, useRef, useState } from 'react';
import { BoxGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OrthographicCamera, PlaneGeometry, Quaternion, RingGeometry, Scene, SphereGeometry, Sprite, SpriteMaterial, Vector3, type BufferGeometry, type Material } from 'three';
import type { SceneViewProps } from '../../../party-ui/src/index';
import { ResourceScope } from '../../../party-runtime/src/index';
import { mountThreeScene, type SceneMetrics } from '../../../party-3d/src/index';
import type { Board, PublicView, Settings, Tile } from './model';
import { RESOURCE_META, TERRAIN_META, boardBounds, boardCenter, edgeGeometry, hashUnit, indexBoard, pips, pushOutward } from './presentation';
import { ExpansionLayers } from './scene-layers';

/** Fractions of the stage the HTML HUD covers; the camera frames the board inside the remaining window. */
/** Fallback HUD fractions used until the real HUD panels can be measured from the DOM. */
const HUD = { top: .14, bottom: .2, left: .02, right: .16 }, TILT = .5, LAND = .34, INK = '#05071a';
const LABEL_PX = 54, PORT_PX = 28, SIGN_PATH = new Map<string, Path2D>();
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const FACE_ROTATION: Record<number, Quaternion> = { 1: new Quaternion(), 6: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI), 2: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2), 5: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2), 3: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2), 4: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2) };
const easeOutBack = (t: number) => { const c = 1.70158, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
const yawFor = (dx: number, dz: number) => Math.atan2(-dz, dx);

export default function IslandScene(props: SceneViewProps<Settings, PublicView>) {
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef(props); latest.current = props;
  const [metrics, setMetrics] = useState<SceneMetrics | null>(null);
  useEffect(() => {
    const scope = new ResourceScope(props.signal), scene = new Scene(), reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let quality: 'low' | 'balanced' = 'balanced'; try { if (localStorage.getItem('party.sceneQuality') === 'low') quality = 'low'; } catch { /* Default quality. */ }
    scene.background = new Color('#0a3a5f');
    const camera = new OrthographicCamera(-10, 10, 10, -10, .1, 400);
    scene.add(new HemisphereLight('#fff7e0', '#3a6f9a', 1.9)); const sun = new DirectionalLight('#fff1cf', 2.1); sun.position.set(-14, 26, 16); scene.add(sun); const fill = new DirectionalLight('#9fd6ff', .6); fill.position.set(18, 10, -12); scene.add(fill);
    const materials = new Map<string, MeshStandardMaterial>(), material = (color: string, flat = false) => { const key = color + (flat ? 'f' : ''); let found = materials.get(key); if (!found) { found = scope.own(new MeshStandardMaterial({ color, roughness: .82, metalness: 0, flatShading: flat })); materials.set(key, found); } return found; };
    const geo = { hex: scope.own(new CylinderGeometry(.955, 1, 1, 6)), sea: scope.own(new CylinderGeometry(.99, .99, .05, 6)), box: scope.own(new BoxGeometry(1, 1, 1)), cone: scope.own(new ConeGeometry(.5, 1, 7)), cylinder: scope.own(new CylinderGeometry(.5, .5, 1, 10)), sphere: scope.own(new SphereGeometry(.5, 10, 8)), nugget: scope.own(new IcosahedronGeometry(.5, 0)), token: scope.own(new CylinderGeometry(.36, .36, .07, 32)), roof: scope.own(new CylinderGeometry(.5, .5, 1, 3)), ring: scope.own(new RingGeometry(.8, .96, 6, 1, Math.PI / 6)), plane: scope.own(new PlaneGeometry(1, 1)) };
    // Ocean placeholder renders before any public view exists so preparation can report readiness.
    const oceanCanvas = document.createElement('canvas'); oceanCanvas.width = oceanCanvas.height = 512; const oc = oceanCanvas.getContext('2d')!; const grad = oc.createRadialGradient(256, 256, 40, 256, 256, 300); grad.addColorStop(0, '#2b8fcb'); grad.addColorStop(.6, '#1c6ba3'); grad.addColorStop(1, '#0c3e66'); oc.fillStyle = grad; oc.fillRect(0, 0, 512, 512);
    const ocean = new Mesh(geo.plane, scope.own(new MeshStandardMaterial({ map: scope.own(new CanvasTexture(oceanCanvas)), roughness: .95 }))); ocean.rotation.x = -Math.PI / 2; ocean.scale.set(160, 160, 1); ocean.position.y = -.02; scene.add(ocean);
    const drift: Mesh[] = []; for (let i = 0; i < 14; i++) { const wave = new Mesh(geo.plane, scope.own(new MeshBasicMaterial({ color: '#dff4ff', transparent: true, opacity: .16 }))); wave.rotation.x = -Math.PI / 2; wave.scale.set(.9 + hashUnit('w' + i) * 1.6, .05, 1); wave.userData.seed = i; wave.position.y = .01; scene.add(wave); drift.push(wave); }
    // Camera framing: fixed overhead with a slight tilt, fitted to the board inside the HUD window.
    // Camera framing: fixed overhead with a slight tilt, fitted to the land inside the window the HTML HUD leaves free.
    let fit = { cx: 0, cz: 0, halfW: 6, halfD: 5, maxH: 1 }, aspect = 16 / 9, hud = { ...HUD }, measuredAt = -Infinity, unitsPerPx = .05;
    const frustum = { left: -10, right: 10, top: 10, bottom: -10 }, target = { ...frustum }, labels: Sprite[] = [], signs: Sprite[] = [];
    const measureHud = () => {
      const element = canvas.current, stage = element?.closest('.kp-scene-stage'); if (!element || !stage) return;
      const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      const box = (selector: string) => stage.querySelector(selector)?.getBoundingClientRect() ?? null;
      const extent = (selector: string, edge: 'left' | 'right') => { const side = stage.querySelector(selector); let x: number | null = null; for (const child of side?.children ?? []) { const r = child.getBoundingClientRect(); if (!r.width || !r.height) continue; x = x === null ? r[edge] : edge === 'right' ? Math.max(x, r.right) : Math.min(x, r.left); } return x; };
      const top = box('.is-top'), rail = box('.is-rail'), left = extent('.is-side-left', 'right'), right = extent('.is-side-right', 'left'), pad = .012;
      hud = { top: top ? clamp((top.bottom - rect.top) / rect.height + pad, .05, .4) : HUD.top, bottom: rail ? clamp((rect.bottom - rail.top) / rect.height + pad, .05, .4) : HUD.bottom, left: left === null ? .02 : clamp((left - rect.left) / rect.width + pad, .02, .35), right: right === null ? .02 : clamp((rect.right - right) / rect.width + pad, .02, .35) };
      unitsPerPx = (frustum.right - frustum.left) / rect.width;
    };
    const applyCamera = () => {
      const projectedHalfH = fit.halfD * Math.cos(TILT) + fit.maxH * Math.sin(TILT), availW = 1 - hud.left - hud.right, availH = 1 - hud.top - hud.bottom;
      const halfH = Math.max(projectedHalfH / availH, fit.halfW / availW / aspect) * 1.02, halfW = halfH * aspect, offsetX = hud.left - hud.right, offsetY = hud.bottom - hud.top;
      target.left = -halfW * (1 + offsetX); target.right = halfW * (1 - offsetX); target.top = halfH * (1 - offsetY); target.bottom = -halfH * (1 + offsetY);
      camera.position.set(fit.cx, Math.cos(TILT) * 90, fit.cz + Math.sin(TILT) * 90); camera.lookAt(fit.cx, 0, fit.cz);
      drift.forEach((wave, i) => wave.position.set(fit.cx + (hashUnit('x' + i) - .5) * (fit.halfW * 2 + 8), .01, fit.cz + (hashUnit('z' + i) - .5) * (fit.halfD * 2 + 8)));
    };
    const settleCamera = (snap: boolean) => {
      const k = snap || reduced.matches ? 1 : .18; let moved = false;
      for (const edge of ['left', 'right', 'top', 'bottom'] as const) { const delta = target[edge] - frustum[edge]; if (Math.abs(delta) > .0005) { frustum[edge] += delta * k; moved = true; } }
      if (!moved && camera.left === frustum.left) return;
      camera.left = frustum.left; camera.right = frustum.right; camera.top = frustum.top; camera.bottom = frustum.bottom; camera.updateProjectionMatrix();
      const rect = canvas.current?.getBoundingClientRect(); if (rect?.width) unitsPerPx = (frustum.right - frustum.left) / rect.width;
      // Camera-facing signs keep a minimum pixel size but never outgrow a hex so neighbouring labels stay apart.
      const label = clamp(LABEL_PX * unitsPerPx, .82, 1.15), sign = clamp(PORT_PX * unitsPerPx, .55, .8);
      for (const sprite of labels) sprite.scale.set(label, label, 1); for (const sprite of signs) { const factor = (sprite.userData.factor as number | undefined) ?? 1; sprite.scale.set(sign * 2 * factor, sign * factor, 1); }
    };
    applyCamera(); settleCamera(true);
    const textCanvas = (draw: (context: CanvasRenderingContext2D) => void, size = 256, height = size) => { const element = document.createElement('canvas'); element.width = size; element.height = height; draw(element.getContext('2d')!); return scope.own(new CanvasTexture(element)); };
    const tokenTextures = new Map<number, CanvasTexture>(), tokenTexture = (n: number) => { let texture = tokenTextures.get(n); if (!texture) { texture = textCanvas(c => { const hot = n === 6 || n === 8; c.fillStyle = '#fff6e5'; c.beginPath(); c.arc(128, 128, 122, 0, Math.PI * 2); c.fill(); c.lineWidth = 8; c.strokeStyle = INK; c.stroke(); c.fillStyle = hot ? '#d8331f' : INK; c.font = `900 164px 'Lilita One','Arial Black',sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(n), 128, 112); for (let i = 0; i < pips(n); i++) { c.beginPath(); c.arc(128 + (i - (pips(n) - 1) / 2) * 27, 212, 10, 0, Math.PI * 2); c.fill(); } }); tokenTextures.set(n, texture); } return texture; };
    const dieTexture = (value: number) => textCanvas(c => { c.fillStyle = '#fff6e5'; c.beginPath(); c.roundRect(4, 4, 120, 120, 22); c.fill(); c.fillStyle = INK; const spots: Record<number, [number, number][]> = { 1: [[64, 64]], 2: [[36, 36], [92, 92]], 3: [[36, 36], [64, 64], [92, 92]], 4: [[36, 36], [92, 36], [36, 92], [92, 92]], 5: [[36, 36], [92, 36], [64, 64], [36, 92], [92, 92]], 6: [[36, 32], [92, 32], [36, 64], [92, 64], [36, 96], [92, 96]] }; for (const [x, y] of spots[value]) { c.beginPath(); c.arc(x, y, 11, 0, Math.PI * 2); c.fill(); } }, 128);
    const tokenSprite = (n: number) => { const texture = tokenTexture(n); const sprite = new Sprite(scope.own(new SpriteMaterial({ map: texture, depthTest: false, transparent: true }))); sprite.center.set(.5, .1); labels.push(sprite); return sprite; };
    /** Compact harbour sign: rate plus the resource glyph, or 3:1 with an "any" star. Legend lives in the HUD. */
    const portSprite = (resource: keyof typeof RESOURCE_META | 'any') => { const meta = resource === 'any' ? null : RESOURCE_META[resource]; const texture = textCanvas(c => { c.fillStyle = meta ? meta.deep : '#1f2757'; c.beginPath(); c.roundRect(4, 4, 248, 120, 34); c.fill(); c.strokeStyle = '#fff6e5'; c.lineWidth = 6; c.stroke(); c.fillStyle = '#fff6e5'; c.font = `900 78px 'Lilita One','Arial Black',sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(meta ? '2:1' : '3:1', 88, 68); const glyph = meta ? meta.glyph : TERRAIN_META.gold.glyph; let path = SIGN_PATH.get(glyph); if (!path) { path = new Path2D(glyph); SIGN_PATH.set(glyph, path); } c.save(); c.translate(160, 22); c.scale(3.5, 3.5); c.fillStyle = meta ? '#fff6e5' : '#ffd24a'; c.fill(path); c.restore(); }, 256, 128); const sprite = new Sprite(scope.own(new SpriteMaterial({ map: texture, depthTest: false, transparent: true }))); sprite.center.set(.5, 0); signs.push(sprite); return sprite; };
    const signSprite = (text: string, background: string) => { const texture = textCanvas(c => { c.fillStyle = background; c.beginPath(); c.roundRect(4, 4, 248, 120, 34); c.fill(); c.strokeStyle = '#fff6e5'; c.lineWidth = 6; c.stroke(); c.fillStyle = '#fff6e5'; c.font = `900 ${text.length > 4 ? 60 : 84}px 'Lilita One','Arial Black',sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 128, 66, 236); }, 256, 128); const sprite = new Sprite(scope.own(new SpriteMaterial({ map: texture, depthTest: false, transparent: true }))); sprite.center.set(.5, 0); signs.push(sprite); return sprite; };
    // Pieces share a handful of geometries; colors come from room seats.
    const piece = (kind: 'road' | 'ship' | 'settlement' | 'city' | 'harbor', color: string) => {
      const group = new Group(), wall = material(color), roof = material('#2b2540'), base = new Mesh(geo.cylinder, material(INK)); base.scale.set(kind === 'city' ? .86 : kind === 'road' || kind === 'ship' ? .36 : .7, .03, kind === 'city' ? .86 : kind === 'road' || kind === 'ship' ? .36 : .7); base.position.y = .015; if (kind !== 'road') group.add(base);
      const block = (g: BufferGeometry, m: Material | Material[], x: number, y: number, z: number, sx: number, sy: number, sz: number) => { const mesh = new Mesh(g, m); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); group.add(mesh); return mesh; };
      if (kind === 'road') { block(geo.box, material(INK), 0, .05, 0, .84, .1, .26); block(geo.box, wall, 0, .1, 0, .78, .12, .2); }
      else if (kind === 'ship') { block(geo.box, wall, 0, .1, 0, .62, .16, .26); block(geo.box, material(INK), 0, .19, 0, .42, .03, .17); block(geo.cylinder, material('#6b4a2b'), 0, .44, 0, .05, .5, .05); block(geo.cone, material('#fff6e5'), .08, .5, 0, .38, .44, .18); }
      else if (kind === 'settlement' || kind === 'harbor') { block(geo.box, wall, 0, .19, 0, .38, .3, .38); const top = block(geo.roof, kind === 'harbor' ? material('#28c6e7') : roof, 0, .45, 0, .46, .44, .46); top.rotation.x = -Math.PI / 2; if (kind === 'harbor') { block(geo.box, material('#8a6136'), 0, .06, .34, .7, .06, .2); for (const x of [-.28, .28]) block(geo.cylinder, material('#5d3f22'), x, .1, .42, .06, .2, .06); } }
      else { block(geo.box, wall, -.08, .19, 0, .54, .32, .4); const top = block(geo.roof, roof, -.12, .46, 0, .46, .4, .46); top.rotation.x = -Math.PI / 2; block(geo.box, wall, .2, .38, .02, .26, .68, .26); block(geo.cone, roof, .2, .84, .02, .36, .24, .36); }
      return group;
    };
    const robber = new Group(); { const body = new Mesh(geo.cylinder, material('#23212f')); body.scale.set(.34, .4, .34); body.position.y = .2; const head = new Mesh(geo.sphere, material('#23212f')); head.scale.setScalar(.3); head.position.y = .52; const shadow = new Mesh(geo.cylinder, material(INK)); shadow.scale.set(.42, .02, .42); robber.add(shadow, body, head); }
    const pirate = piece('ship', '#23212f'); pirate.scale.setScalar(1.35); pirate.visible = false; scene.add(pirate);
    const dice = [0, 1].map(() => { const cube = new Mesh(geo.box, [2, 5, 1, 6, 3, 4].map(value => scope.own(new MeshStandardMaterial({ map: dieTexture(value), roughness: .5 })))); cube.scale.setScalar(.7); cube.visible = false; scene.add(cube); return cube; });
    const index = { current: null as ReturnType<typeof indexBoard> | null }, tiles = new Map<string, { tile: Tile; glow: Mesh }>(), routes = new Map<string, Group>(), buildings = new Map<string, { group: Group; key: string }>();
    const bursts: { mesh: Mesh; start: number }[] = [];
    const burst = (x: number, y: number, z: number, color: string, now: number) => { if (reduced.matches) return; const mesh = new Mesh(geo.ring, scope.own(new MeshBasicMaterial({ color, transparent: true, opacity: .9, depthWrite: false }))); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); mesh.scale.setScalar(.4); scene.add(mesh); bursts.push({ mesh, start: now }); };
    const pops: { object: Object3D; start: number }[] = [], hops: { object: Object3D; from: Vector3; to: Vector3; start: number }[] = [], glows: { mesh: Mesh; start: number }[] = [];
    let layers: ExpansionLayers | null = null, built = false, syncKey = '', lastEvent: number | null = null, roll: { start: number; values: [number, number]; spin: Vector3[] } | null = null, shownDice = '', diceHome = [new Vector3(), new Vector3()];
    const tilePosition = (id: string) => { const tile = index.current?.tiles.get(id); return tile ? new Vector3(tile.x, 0, tile.y) : new Vector3(); };
    type Sink = (key: string, geometry: BufferGeometry, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw?: number) => void;
    const tileRecords = new Map<string, { terrain: Tile['terrain']; number: number; objects: Object3D[] }>();
    /** One tile's hex, token, sign and props. `scatter` batches props into instances at build time; a rebuilt tile gets plain meshes inside `into`. */
    function buildTile(tile: Tile, scatter: Sink, into: Object3D) {
      const objects: Object3D[] = [], add = (object: Object3D) => { into.add(object); objects.push(object); }, finish = () => { tileRecords.set(tile.id, { terrain: tile.terrain, number: tile.number, objects }); return objects; };
        const meta = TERRAIN_META[tile.terrain];
        if (tile.terrain === 'sea' || tile.terrain === 'shoal') { const sea = new Mesh(geo.sea, material(tile.terrain === 'shoal' ? '#6cc3e8' : ['#2f8fcd', '#2a86c4', '#3396d4'][Math.floor(hashUnit(tile.id) * 3)])); sea.position.set(tile.x, .025, tile.y); add(sea); if (tile.terrain === 'shoal') for (let i = 0; i < 3; i++) scatter('shoalrock', geo.sphere, '#dfe9c9', tile.x + Math.cos(i * 2.2) * .4, .04, tile.y + Math.sin(i * 2.2) * .4, .18, .06, .14); if (tile.number > 0 && tile.terrain === 'shoal') { const token = tokenSprite(tile.number); token.position.set(tile.x, .1, tile.y); add(token); } return finish(); }
        const hex = new Mesh(geo.hex, [material(meta.deep), material(meta.color, tile.terrain === 'fog'), material(meta.deep)]); hex.position.set(tile.x, LAND / 2, tile.y); hex.scale.y = LAND; add(hex);
        const glow = new Mesh(geo.ring, scope.own(new MeshBasicMaterial({ color: '#ffd24a', transparent: true, opacity: 0, depthWrite: false }))); glow.rotation.x = -Math.PI / 2; glow.position.set(tile.x, LAND + .02, tile.y); glow.visible = false; add(glow); tiles.set(tile.id, { tile, glow });
        if (tile.number > 0) { const foot = new Mesh(geo.token, material('#e5d3b3')); foot.scale.set(.5, 1, .5); foot.position.set(tile.x, LAND + .035, tile.y); add(foot); const token = tokenSprite(tile.number); token.position.set(tile.x, LAND + .12, tile.y); add(token); }
        // Fog shows only that a hex is unexplored: neutral top, a question sign, never a number or terrain hint.
        if (tile.terrain === 'fog') { const sign = signSprite('?', '#6b7385'); sign.position.set(tile.x, LAND + .1, tile.y); add(sign); }
        const spots = Array.from({ length: 7 }, (_, i) => { const angle = hashUnit(tile.id, i) * Math.PI * 2, radius = .52 + hashUnit(tile.id, i + 20) * .3; return { x: tile.x + Math.cos(angle) * radius, z: tile.y + Math.sin(angle) * radius, s: .7 + hashUnit(tile.id, i + 40) * .6, yaw: hashUnit(tile.id, i + 60) * Math.PI * 2 }; });
        for (const [i, spot] of spots.entries()) switch (tile.terrain) {
          case 'wood': if (i < 6) { scatter('trunk', geo.cylinder, '#6b4a2b', spot.x, LAND + .08 * spot.s, spot.z, .07, .16 * spot.s, .07); scatter('tree' + i % 2, geo.cone, i % 2 ? '#1f7a46' : '#2c9457', spot.x, LAND + .34 * spot.s, spot.z, .3 * spot.s, .5 * spot.s, .3 * spot.s, spot.yaw); } break;
          case 'ore': if (i < 4) { scatter('rock', geo.cone, '#6f7488', spot.x, LAND + .28 * spot.s, spot.z, .34 * spot.s, .62 * spot.s, .34 * spot.s, spot.yaw); scatter('snow', geo.cone, '#f4f6ff', spot.x, LAND + .5 * spot.s, spot.z, .12 * spot.s, .18 * spot.s, .12 * spot.s, spot.yaw); } break;
          case 'brick': if (i < 4) scatter('brick' + i % 2, geo.box, i % 2 ? '#b8532f' : '#c9633d', spot.x, LAND + .1 * spot.s, spot.z, .3 * spot.s, .2 * spot.s, .2 * spot.s, spot.yaw); break;
          case 'wool': if (i < 4) { scatter('sheep', geo.sphere, '#fbf7ee', spot.x, LAND + .11, spot.z, .24, .2, .18, spot.yaw); scatter('head', geo.sphere, '#2b2540', spot.x + Math.cos(spot.yaw) * .12, LAND + .13, spot.z - Math.sin(spot.yaw) * .12, .09, .09, .09); } break;
          case 'grain': if (i < 6) scatter('wheat' + i % 2, geo.box, i % 2 ? '#d9a63a' : '#efc85a', spot.x, LAND + .12 * spot.s, spot.z, .22 * spot.s, .24 * spot.s, .07, spot.yaw); break;
          case 'gold': if (i < 4) scatter('gold', geo.nugget, '#ffd24a', spot.x, LAND + .1 * spot.s, spot.z, .22 * spot.s, .18 * spot.s, .22 * spot.s, spot.yaw); break;
          case 'desert': if (i < 2) scatter('dune', geo.sphere, '#f1dfae', spot.x, LAND, spot.z, .7, .12, .5, spot.yaw); if (i === 3) { scatter('cactus', geo.cylinder, '#5e9e4f', spot.x, LAND + .17, spot.z, .09, .34, .09); scatter('cactus', geo.cylinder, '#5e9e4f', spot.x + .1, LAND + .2, spot.z, .06, .16, .06); } break;
          case 'spice': if (i < 4) { scatter('jar', geo.cylinder, '#c9553a', spot.x, LAND + .12, spot.z, .2, .24, .2); scatter('jarlid', geo.cylinder, '#e9a27a', spot.x, LAND + .26, spot.z, .12, .05, .12); } break;
          case 'lake': if (i === 0) scatter('pond', geo.cylinder, '#3b9ad8', tile.x, LAND + .01, tile.y, 1.3, .02, 1.1); if (i > 0 && i < 4) scatter('lakefish', geo.sphere, '#6cc3e8', tile.x + (hashUnit(tile.id, i) - .5) * .8, LAND + .05, tile.y + (hashUnit(tile.id, i + 7) - .5) * .6, .16, .06, .09, spot.yaw); break;
          case 'swamp': if (i < 5) scatter('reed', geo.cylinder, '#3f5a3c', spot.x, LAND + .2, spot.z, .04, .4, .04); if (i < 2) scatter('puddle', geo.sphere, '#4f7a8a', spot.x + .2, LAND, spot.z, .5, .03, .36, spot.yaw); break;
          case 'oasis': if (i === 0) scatter('pond', geo.cylinder, '#3b9ad8', tile.x, LAND + .01, tile.y, .9, .02, .7); if (i > 0 && i < 4) { scatter('trunk', geo.cylinder, '#6b4a2b', spot.x, LAND + .2, spot.z, .06, .4, .06); scatter('palm', geo.cone, '#4d8f74', spot.x, LAND + .46, spot.z, .44, .16, .44, spot.yaw); } break;
          case 'castle': if (i === 0) { scatter('keep', geo.box, '#b9a58a', tile.x, LAND + .28, tile.y, .7, .56, .7); for (const [dx, dz] of [[-.35, -.35], [.35, -.35], [-.35, .35], [.35, .35]]) { scatter('turret', geo.cylinder, '#a8937a', tile.x + dx, LAND + .36, tile.y + dz, .2, .72, .2); scatter('turretcap', geo.cone, '#7d6b52', tile.x + dx, LAND + .8, tile.y + dz, .24, .18, .24); } } break;
          case 'quarry': if (i < 5) scatter('quarryblock', geo.box, i % 2 ? '#8f847c' : '#b3a79e', spot.x, LAND + .1 * spot.s, spot.z, .3 * spot.s, .2 * spot.s, .26 * spot.s, spot.yaw); break;
          case 'glassworks': if (i === 0) { scatter('kiln', geo.box, '#8a6a52', tile.x, LAND + .22, tile.y, .6, .44, .5); scatter('chimney', geo.cylinder, '#5d3f22', tile.x + .2, LAND + .6, tile.y, .1, .5, .1); scatter('glow', geo.sphere, '#ffa260', tile.x - .1, LAND + .24, tile.y + .27, .14, .14, .06); } if (i > 0 && i < 4) scatter('glass', geo.box, '#b7d8e8', spot.x, LAND + .08, spot.z, .16, .16, .16, spot.yaw); break;
          case 'fog': break;
        }
      return finish();
    }
    const rises: { group: Group; start: number }[] = [];
    /** A fog hex that turns into real terrain rises out of the sea with splash rings. Only public tile data is used. */
    function revealTile(tile: Tile, now: number) {
      const previous = tileRecords.get(tile.id); for (const object of previous?.objects ?? []) object.parent?.remove(object); tiles.delete(tile.id);
      const group = new Group(); scene.add(group);
      buildTile(tile, (key, geometry, color, x, y, z, sx, sy, sz, yaw = 0) => { const mesh = new Mesh(geometry, material(color, true)); mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.scale.set(sx, sy, sz); group.add(mesh); void key; }, group);
      if (reduced.matches) return; group.position.y = -1.3; rises.push({ group, start: now }); burst(tile.x, .03, tile.y, '#dff4ff', now); burst(tile.x, .03, tile.y, '#28c6e7', now + 180);
    }
    function buildBoard(board: Board) {
      index.current = indexBoard(board); const box = boardBounds({ ...board, tiles: board.tiles.filter(tile => tile.terrain !== 'sea') }), instances = new Map<string, { geometry: BufferGeometry; material: Material; transforms: Matrix4[] }>(), helper = new Object3D();
      const scatter: Sink = (key, geometry, color, x, y, z, sx, sy, sz, yaw = 0) => { let bucket = instances.get(key); if (!bucket) { bucket = { geometry, material: material(color, true), transforms: [] }; instances.set(key, bucket); } helper.position.set(x, y, z); helper.rotation.set(0, yaw, 0); helper.scale.set(sx, sy, sz); helper.updateMatrix(); bucket.transforms.push(helper.matrix.clone()); };
      const center = boardCenter(board);
      for (const tile of board.tiles) buildTile(tile, scatter, scene);
      for (const bucket of instances.values()) { const mesh = new InstancedMesh(bucket.geometry, bucket.material, bucket.transforms.length); bucket.transforms.forEach((matrix, i) => mesh.setMatrixAt(i, matrix)); scene.add(mesh); scope.defer(() => mesh.dispose()); }
      for (const port of board.ports) { const a = index.current.vertices.get(port.vertices[0]), b = index.current.vertices.get(port.vertices[1] ?? port.vertices[0]); if (!a || !b) continue; const x = (a.x + b.x) / 2, z = (a.y + b.y) / 2, dock = new Mesh(geo.box, material('#8a6136')); dock.position.set(x, .08, z); dock.scale.set(.7, .1, .28); dock.rotation.y = yawFor(b.x - a.x, b.y - a.y); scene.add(dock); const away = pushOutward(center, x, z, .42), sprite = portSprite(port.resource); sprite.position.set(away.x, .18, away.y); scene.add(sprite); }
      const diceX = box.minX - .1, diceZ = box.maxY + .15; diceHome = [new Vector3(diceX, .35, diceZ), new Vector3(diceX + .95, .35, diceZ + .35)]; dice.forEach((cube, i) => { cube.position.copy(diceHome[i]); cube.visible = true; });
      fit = { cx: (box.minX + box.maxX) / 2, cz: (box.minY + box.maxY) / 2, halfW: (box.maxX - box.minX) / 2 + .9, halfD: (box.maxY - box.minY) / 2 + .8, maxH: 1.2 }; measureHud(); applyCamera(); settleCamera(true);
      scene.add(robber); built = true;
      layers = new ExpansionLayers({ scene, index: index.current, land: LAND, ink: INK, geo: { box: geo.box, cone: geo.cone, cylinder: geo.cylinder, sphere: geo.sphere, ring: geo.ring, nugget: geo.nugget }, material, color: id => latest.current.publicView?.players.find(player => player.id === id)?.color ?? '#fff6e5', pop, sign: signSprite, burst, reduced: () => reduced.matches });
    }
    const pop = (object: Object3D, now: number) => { if (reduced.matches) return; object.scale.setScalar(.001); pops.push({ object, start: now }); };
    function sync(view: PublicView, now: number) {
      const key = `${view.revision}|${view.robber}|${view.pirate}`; if (key === syncKey || !index.current) return; syncKey = key;
      const color = (id: string) => view.players.find(player => player.id === id)?.color ?? '#fff6e5';
      for (const tile of view.board.tiles) { const record = tileRecords.get(tile.id); if (record && (record.terrain !== tile.terrain || record.number !== tile.number)) { index.current.tiles.set(tile.id, tile); revealTile(tile, now); } }
      for (const route of view.routes) if (!routes.has(route.edge)) { const g = edgeGeometry(index.current, route.edge); if (!g) continue; const object = piece(route.kind, color(route.playerId)); object.position.set(g.x, route.kind === 'ship' ? 0 : LAND, g.y); object.rotation.y = yawFor(g.b.x - g.a.x, g.b.y - g.a.y); scene.add(object); routes.set(route.edge, object); pop(object, now); }
      for (const [edge, object] of routes) if (!view.routes.some(route => route.edge === edge)) { scene.remove(object); routes.delete(edge); }
      for (const building of view.buildings) { const key = building.kind + building.playerId, existing = buildings.get(building.vertex); if (existing?.key === key) continue; if (existing) scene.remove(existing.group); const v = index.current.vertices.get(building.vertex); if (!v) continue; const object = piece(building.kind, color(building.playerId)); object.position.set(v.x, LAND, v.y); object.rotation.y = hashUnit(building.vertex) * Math.PI * 2; scene.add(object); buildings.set(building.vertex, { group: object, key }); pop(object, now); }
      for (const [vertex, entry] of buildings) if (!view.buildings.some(building => building.vertex === vertex)) { scene.remove(entry.group); buildings.delete(vertex); }
      const robberTarget = tilePosition(view.robber).add(new Vector3(.45, LAND, .3)); if (robber.position.distanceTo(robberTarget) > .01) { if (reduced.matches || robber.position.lengthSq() === 0) robber.position.copy(robberTarget); else hops.push({ object: robber, from: robber.position.clone(), to: robberTarget, start: now }); }
      pirate.visible = view.pirate !== null; if (view.pirate) { const target = tilePosition(view.pirate); if (pirate.position.distanceTo(target) > .01) { if (reduced.matches || pirate.position.lengthSq() === 0) pirate.position.copy(target); else hops.push({ object: pirate, from: pirate.position.clone(), to: target, start: now }); } }
    }
    const showDice = (values: [number, number]) => dice.forEach((cube, i) => { cube.quaternion.copy(FACE_ROTATION[values[i]] ?? FACE_ROTATION[1]).premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), hashUnit('yaw' + values.join(), i) * Math.PI * 2)); cube.position.copy(diceHome[i]); });
    const production = (view: PublicView, now: number) => { if (!view.dice) return; const total = view.dice[0] + view.dice[1]; for (const { tile, glow } of tiles.values()) if (tile.number === total && tile.id !== view.robber) { glow.visible = true; glows.push({ mesh: glow, start: now }); } };
    function events(view: PublicView, now: number) {
      const last = view.events.at(-1)?.id ?? 0;
      if (lastEvent === null) { lastEvent = last; if (view.dice) { showDice(view.dice); shownDice = view.dice.join(); } return; }
      for (const event of view.events) if (event.id > lastEvent && event.kind === 'roll' && view.dice) { shownDice = view.dice.join(); if (reduced.matches) { showDice(view.dice); production(view, now); } else roll = { start: now, values: view.dice, spin: [0, 1].map(i => new Vector3(hashUnit('sx' + event.id, i) - .5, hashUnit('sy' + event.id, i) - .5, hashUnit('sz' + event.id, i) - .5).normalize()) }; }
      lastEvent = Math.max(lastEvent, last);
      if (!roll && view.dice && view.dice.join() !== shownDice) { shownDice = view.dice.join(); showDice(view.dice); }
    }
    mountThreeScene(canvas.current!, { signal: scope.signal, scene, camera, quality,
      resize(nextAspect) { aspect = nextAspect; measureHud(); applyCamera(); settleCamera(true); },
      frame(now) {
        const view = latest.current.publicView;
        if (view) { if (!built) buildBoard(view.board); sync(view, now); layers?.sync(view, now); events(view, now); }
        layers?.animate(now);
        for (let i = rises.length - 1; i >= 0; i--) { const t = Math.min(1, (now - rises[i].start) / 1100); rises[i].group.position.y = -1.3 * (1 - easeOutBack(Math.min(1, t * 1.05))); if (t >= 1) { rises[i].group.position.y = 0; rises.splice(i, 1); } }
        for (let i = bursts.length - 1; i >= 0; i--) { const t = Math.min(1, Math.max(0, (now - bursts[i].start) / 900)); bursts[i].mesh.scale.setScalar(.4 + t * 2.2); (bursts[i].mesh.material as MeshBasicMaterial).opacity = .9 * (1 - t); if (t >= 1) { scene.remove(bursts[i].mesh); bursts.splice(i, 1); } }
        if (now - measuredAt > 500) { measuredAt = now; const before = JSON.stringify(hud); measureHud(); if (JSON.stringify(hud) !== before) applyCamera(); }
        settleCamera(false);
        for (let i = pops.length - 1; i >= 0; i--) { const t = Math.min(1, (now - pops[i].start) / 480); pops[i].object.scale.setScalar(Math.max(.001, easeOutBack(t))); if (t >= 1) pops.splice(i, 1); }
        for (let i = hops.length - 1; i >= 0; i--) { const hop = hops[i], t = Math.min(1, (now - hop.start) / 650); hop.object.position.lerpVectors(hop.from, hop.to, t); hop.object.position.y += Math.sin(t * Math.PI) * 1.1; if (t >= 1) hops.splice(i, 1); }
        for (let i = glows.length - 1; i >= 0; i--) { const glow = glows[i], t = Math.min(1, (now - glow.start) / 1700); (glow.mesh.material as MeshBasicMaterial).opacity = Math.sin(t * Math.PI) * .95; glow.mesh.scale.setScalar(1 + Math.sin(t * Math.PI) * .08); if (t >= 1) { glow.mesh.visible = false; glows.splice(i, 1); } }
        if (roll) { const t = Math.min(1, (now - roll.start) / 950); dice.forEach((cube, i) => { cube.position.copy(diceHome[i]); cube.position.y += Math.sin(t * Math.PI) * 1.4; cube.position.x -= (1 - t) * 1.4; if (t < 1) cube.quaternion.premultiply(new Quaternion().setFromAxisAngle(roll!.spin[i], .32 * (1 - t) + .04)); }); if (t >= 1) { showDice(roll.values); if (view) production(view, now); roll = null; } }
        if (!reduced.matches) drift.forEach((wave, i) => { wave.position.x += Math.sin(now / 1800 + i) * .004; (wave.material as MeshBasicMaterial).opacity = .1 + Math.sin(now / 1400 + i * 1.7) * .07; });
      },
      onReady: () => latest.current.onReady(), onError: error => latest.current.onError(error), onMetrics: setMetrics,
    });
    scope.defer(() => { scene.clear(); });
    return scope.dispose;
  }, [props.roundId, props.signal]);
  return <><canvas ref={canvas} aria-label="Island Settlers board: hex island with numbered terrain, roads, ships, settlements, cities, the robber and dice"/><details className="is-metrics" hidden={!new URLSearchParams(location.search).has('metrics')}><summary>Scene stats</summary><pre data-testid="scene-metrics">{metrics ? JSON.stringify(metrics, null, 2) : 'Warming up…'}</pre></details></>;
}
