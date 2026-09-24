// Builds the kitchen world for one round and drives it every frame from interpolated snapshots.
import {
  ACESFilmicToneMapping, Color, DirectionalLight, Fog, Group, HemisphereLight, Matrix4, PCFShadowMap, PerspectiveCamera, PointLight, Quaternion, Scene, Sprite, SpriteMaterial, Vector3,
  type Texture, type WebGLRenderer,
} from 'three';
import type { SceneViewProps } from '../../../../party-ui/src/index';
import type { ResourceScope, SnapshotBuffer } from '../../../../party-runtime/src/index';
import { mountThreeScene, type SceneMetrics } from '../../../../party-3d/src/index';
import { loadKitchenAssets, type AnimalKit } from '../assets';
import { LEVELS, kitchenMap } from '../levels';
import { BELT_SECONDS, INGREDIENTS, WALKABLE, WALK_SPEED, tileAt, type Chef, type GameEvent, type Item, type Settings, type TileState, type View } from '../model';
import { loadKitchenModels, type KitchenModels } from '../models';
import { readGraphicsQuality } from '../preferences';
import { animateRig, createRig, CHEF_HEIGHT, type Pose } from './chefs';
import { buildDiorama } from './diorama';
import { Decals, Particles, SHAPE, WIDGET, Widgets } from './fx';
import { chefOwner, ItemViews, LOOSE } from './items';
import { Instances, Kit } from './kit';
import { cookReadout, EventCursor, type CookReadout, FOV, TILT, fitCamera, initialRackCounts, landingIn, pairSampler, popWobble, spawnFor, stackHeights } from './layout';
import { Shape } from './shapes';
import { dotsTexture, frameTexture as targetFrame, nameplateTexture, popupCanvas, radialTexture, ringTexture as chefRing } from './textures';
import { paletteFor } from './themes';

type Props = SceneViewProps<Settings, View>;
type Latest = { current: Props };
const character = (player: Props['players'][number]) => (player.lobbyChoice as { character?: string } | undefined)?.character ?? 'chef';
const color = (hex: string) => new Color(hex);
const NONE: never[] = [];
function looseById(list: readonly View['loose'][number][], id: number) { for (const entry of list) if (entry.item.id === id) return entry; return undefined; }
const C = {
  dust: color('#e9dccb'), smoke: color('#4a4442'), steam: color('#ffffff'), foam: color('#f6fbff'), water: color('#7fd0f2'), fleck: color('#8fd660'),
  flame: color('#ff7a1c'), ember: color('#ffc23d'), gold: color('#ffd24a'), spark: color('#fff3b0'), purple: color('#c59bff'), grey: color('#7d7d86'),
  green: color('#6ad35a'), black: color('#000000'), amber: color('#ffb020'), red: color('#ff4a3d'), track: color('#2a2f3a'), wash: color('#58c4f5'), white: color('#ffffff'),
};
const CONFETTI = ['#ffd24a', '#ff5a6e', '#3fd3c4', '#8f7bff', '#ffffff', '#7ddc4a'].map(color);
/** Seconds a served plate flies from the chef to the hatch, then slides through it. */
const FLY = .34, SLIDE = .3;

/** Load, build and mount. Resolves once mounted; readiness is reported by mountThreeScene after the first real frame. */
export async function startKitchen(canvas: HTMLCanvasElement, scope: ResourceScope, latest: Latest, buffer: SnapshotBuffer<View>, onMetrics: (metrics: SceneMetrics) => void) {
  const props = latest.current, players = props.players, settings = props.settings;
  const quality = readGraphicsQuality(), reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const level = LEVELS[settings.level] ?? LEVELS[0], map = kitchenMap(LEVELS[settings.level] ? settings.level : 0, players.length), palette = paletteFor(level.theme);
  // Art is optional: a missing or half-built GLB falls back to procedural models; only an abort stops the build.
  const optional = async <T>(load: Promise<T>) => { try { return await load; } catch (error) { if (scope.signal.aborted) throw error; console.warn('Kitchen Rush art unavailable, using fallback models.', error); return null; } };
  const needsAnimals = players.some(player => ['cat', 'dog', 'iguana', 'axolotl'].includes(character(player)));
  const [models, animals] = await Promise.all([optional<KitchenModels>(loadKitchenModels(scope)), needsAnimals ? optional<AnimalKit>(loadKitchenAssets(scope)) : null]);
  scope.signal.throwIfAborted();

  const own = <T extends { dispose(): void }>(resource: T) => scope.own(resource);
  const kit = new Kit(models, palette); scope.defer(() => kit.dispose());
  const shadows = quality !== 'low', scene = new Scene();
  scope.defer(() => { scene.clear(); buffer.clear(); });
  scene.background = new Color(palette.sky);
  const fog = new Fog(palette.sky, 30, 90); scene.fog = fog;
  const diorama = buildDiorama(map, level, kit, palette, { shadows, lite: quality === 'low' });
  scene.add(diorama.group);

  // ── Lights ──
  scene.add(new HemisphereLight(palette.hemiSky, palette.hemiGround, palette.hemiIntensity));
  const sun = new DirectionalLight(palette.sun, palette.sunIntensity);
  sun.position.set(-map.halfX * .5 - 5, 16, 9); sun.target.position.set(0, 0, 0); scene.add(sun, sun.target);
  if (shadows) {
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .025; sun.shadow.radius = 3;
    const extent = Math.max(map.halfX, map.halfZ) + 4;
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 50 });
  }
  const fill = new DirectionalLight(palette.hemiSky, .5); fill.position.set(8, 6, 12); scene.add(fill);
  // Two pooled flicker lights follow the first fires; a fixed count avoids shader recompiles.
  const fireLights = [0, 1].map(() => { const light = new PointLight('#ff8a2a', 0, 4.5, 1.6); light.position.y = 1.4; scene.add(light); return light; });

  // ── Camera ──
  const camera = new PerspectiveCamera(FOV, 16 / 9, .1, 200), cameraBase = new Vector3(), forward = new Vector3(0, -Math.sin(TILT), -Math.cos(TILT)), cameraUp = new Vector3(0, Math.cos(TILT), -Math.sin(TILT));
  const tanHalf = Math.tan(FOV * Math.PI / 360), right = new Vector3(1, 0, 0);
  /** The HUD-free part of the view in NDC, so popups never rise under the HUD or off the side of the screen. */
  const hudFree = { top: 1, left: -1, right: 1 };
  let labelHeight = .4, cameraDistance = 20;

  // ── Chefs ──
  const rigs = players.map((player, index) => {
    const rig = createRig(kit, models, animals, character(player), player.color, index, own);
    const spawn = spawnFor(map, index); rig.root.position.set(spawn.x, 0, spawn.z);
    const plate = nameplateTexture(index, player.name, player.color);
    const sprite = new Sprite(own(new SpriteMaterial({ map: own(plate.map), depthTest: false, transparent: true })));
    sprite.renderOrder = 25; sprite.center.set(.5, 0); scene.add(rig.root, sprite);
    return { id: player.id, rig, sprite, aspect: plate.aspect, color: new Color(player.color), stepAt: 0, dustAt: 0, hit: 0, below: 0 };
  });

  // ── Dynamic layers ──
  const items = new ItemViews(kit, own); scene.add(items.group);
  const clean = new Instances(kit.template('plate'), 64, own, false), dirty = new Instances(kit.template('plate_dirty'), 48, own, false);
  scene.add(clean.group, dirty.group);
  const soft = new Particles(quality === 'low' ? 400 : 1200, false), glow = new Particles(quality === 'low' ? 300 : 900, true), widgets = new Widgets(128);
  // Extinguisher foam draws after flames and glow so it visibly smothers a fire.
  const foam = new Particles(quality === 'low' ? 160 : 480, false); foam.mesh.renderOrder = 7;
  own(soft); own(glow); own(foam); own(widgets); scene.add(soft.mesh, glow.mesh, foam.mesh, widgets.mesh);
  const ringTexture = own(chefRing()), frameTexture = own(targetFrame());
  const blobs = new Decals(own(radialTexture(0, 1)), 96, { opacity: .4, tint: '#1c1410' }), dots = new Decals(own(dotsTexture()), 16, { color: true, renderOrder: 4 }), rings = new Decals(ringTexture, 16, { color: true, renderOrder: 3 }), frames = new Decals(frameTexture, 16, { color: true, renderOrder: 4 });
  const heat = new Decals(own(radialTexture(0, 1)), 24, { additive: true, color: true, renderOrder: 4 });
  own(blobs); own(dots); own(rings); own(frames); own(heat); scene.add(blobs.mesh, dots.mesh, rings.mesh, frames.mesh, heat.mesh);
  const popups = Array.from({ length: 6 }, () => {
    const canvasTexture = popupCanvas(); own(canvasTexture.map);
    const sprite = new Sprite(own(new SpriteMaterial({ map: canvasTexture.map, depthTest: false, transparent: true })));
    sprite.renderOrder = 30; sprite.visible = false; scene.add(sprite);
    return { sprite, draw: canvasTexture.draw, aspect: canvasTexture.aspect, age: 1, size: 1, x: 0, y: 0, z: 0 };
  });
  // Every Sprite shares one module-level geometry; each renderer that draws it keeps a dispose listener on it. Disposing it
  // with the round drops those listeners (three re-uploads it next round), or each ended round's renderer and canvas leak.
  own(popups[0].sprite.geometry);
  // Serving: a plate flies from the chef into the hatch, then the hatch bell dings.
  const hatches = map.tiles.filter(tile => tile.kind === 'serve');
  const bellShape = new Shape().cylinder(.1, .1, .025, { at: [0, .0125, 0], color: '#3a2b2b' })
    .lathe([[.094, .02], [.09, .05], [.066, .096], [.03, .12], [0, .124]], { color: '#ffc94a', finish: 'metal' }).cylinder(.016, .016, .04, { at: [0, .14, 0], color: '#ffe28a', finish: 'metal' }).build(kit.materials, 'bell');
  bellShape.parts.forEach(part => own(part.geometry));
  const bells = hatches.map(tile => {
    const anchor = diorama.anchors[tile.index], group = kit.spawn(bellShape), c = Math.cos(anchor.yaw), s = Math.sin(anchor.yaw);
    // Covers the authored hatch's own little bell (local .3, .24) so it can bounce.
    group.position.set(tile.x + .3 * c + .24 * s, .9, tile.z - .3 * s + .24 * c); group.scale.setScalar(1.5); scene.add(group);
    return { tile: tile.index, group, age: 9 };
  });
  const fliers = Array.from({ length: 4 }, () => {
    const group = new Group(); group.visible = false; scene.add(group);
    return { group, age: 9, landed: true, hatch: 0, value: 0, from: new Vector3(), to: new Vector3() };
  });
  const crosses = Array.from({ length: 4 }, () => ({ rig: 0, age: 9 }));
  const doneAt = new Float32Array(map.tiles.length).fill(-9);

  // ── Preparation view: the opening kitchen straight from the map, before the first snapshot ──
  let fakeId = -1;
  const startItem = (kind: Item['kind']): Item => ({ id: fakeId--, kind, parts: [], cook: 0 });
  const racks = map.tiles.filter(tile => tile.kind === 'rack'), rackCounts = initialRackCounts(racks.length, players.length);
  const prepTiles: TileState[] = [
    ...map.tiles.filter(tile => tile.start).map(tile => ({ at: tile.index, item: startItem(tile.start!) })),
    ...racks.map((tile, i) => ({ at: tile.index, count: rackCounts[i] })),
  ];
  const prepChefs = players.map((player, index) => ({ id: player.id, name: player.name, color: player.color, x: spawnFor(map, index).x, z: spawnFor(map, index).z, vx: 0, vz: 0, fx: 0, fz: 1, held: null, work: 'none', target: -1, dashing: false, respawnAt: 0, connected: true }) as unknown as Chef);

  // ── Frame state (all reused; nothing below allocates per frame except rare event handling) ──
  const sample = pairSampler(buffer), cursor = new EventCursor(), position = new Vector3(), rotation = new Quaternion(), identity = new Quaternion(), yawQ = new Quaternion(), up = new Vector3(0, 1, 0), matrix = new Matrix4(), scaleOne = new Vector3(1, 1, 1), flameScale = new Vector3();
  const gateAngles = diorama.gates.map(() => 0), fires: number[] = [], cooking: CookReadout = { state: 'idle', progress: 0 };
  // Plates pushed down (under the feet) settle first, from the top; then plates above heads, from the bottom. Sorting by
  // where plates are shown (not where their chefs stand) keeps a settled stack in order, so two chefs walking side by
  // side do not swap places every frame and slide their names into each other.
  const byPlateY = (a: number, b: number) => plateDir[a] !== plateDir[b] ? plateDir[a] - plateDir[b] : (shownY[a] - shownY[b]) * plateDir[a];
  const pose: Pose = { chef: prepChefs[0], x: 0, z: 0, vx: 0, vz: 0, fx: 0, fz: 1, now: 0, t: 0, dt: 0, still: false, held: null };
  const plateX = new Float32Array(rigs.length), plateY = new Float32Array(rigs.length), plateW = new Float32Array(rigs.length), shownY = new Float32Array(rigs.length), lift = new Float32Array(rigs.length), plateDir = new Int8Array(rigs.length).fill(1), order = rigs.map((_, i) => i);
  let shake = 0, punch = 0, frameTime = 0, emitClock = 0;
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

  const puff = (x: number, y: number, z: number, n: number, tint: Color, size = .22, speed = 1, rise = .4, life = .6) => {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = speed * (.4 + Math.random() * .6); soft.emit({ x, y, z, vx: Math.cos(a) * s, vy: rise * (.5 + Math.random()), vz: Math.sin(a) * s, life: life * (.7 + Math.random() * .6), size, grow: 2, color: tint, alpha: .85, shape: SHAPE.puff, drag: 3 }); }
  };
  const burst = (x: number, y: number, z: number, n: number, tint: Color, shape: number, speed = 2.5, size = .16, gravity = 0, life = .7) => {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = speed * (.5 + Math.random() * .5); glow.emit({ x, y, z, vx: Math.cos(a) * s, vy: 1 + Math.random() * speed, vz: Math.sin(a) * s, life: life * (.6 + Math.random() * .6), size, grow: .4, color: tint, shape, gravity, drag: 2, spin: (Math.random() - .5) * 8 }); }
  };
  const splash = (x: number, y: number, z: number, n = 14) => {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = .8 + Math.random() * 1.6; soft.emit({ x, y, z, vx: Math.cos(a) * s, vy: 2 + Math.random() * 2.5, vz: Math.sin(a) * s, life: .7, size: .09, grow: .6, color: C.water, shape: SHAPE.drop, gravity: 9 }); }
    soft.emit({ x, y: y + .02, z, life: .5, size: .3, grow: 4, color: C.white, alpha: .8, shape: SHAPE.ring });
  };
  const popup = (text: string, x: number, y: number, z: number, tint?: string, size = 1) => {
    const slot = popups.reduce((oldest, item) => item.age > oldest.age ? item : oldest);
    slot.draw(text, tint); slot.age = 0; slot.size = size; slot.x = x; slot.y = y; slot.z = z; slot.sprite.visible = true;
  };
  const rigIndex = (id: string | undefined) => { for (let i = 0; i < rigs.length; i++) if (rigs[i].id === id) return i; return -1; };
  const tileItem = (tiles: readonly TileState[], index: number) => { for (const state of tiles) if (state.at === index) return state.item; return undefined; };
  const confetti = (x: number, y: number, z: number, n: number) => {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2.2; soft.emit({ x, y, z, vx: Math.cos(a) * s, vy: 3 + Math.random() * 3, vz: Math.sin(a) * s, life: 1.2 + Math.random() * .6, size: .2, grow: 1, color: CONFETTI[i % CONFETTI.length], shape: SHAPE.confetti, gravity: 7, drag: 1.6, spin: (Math.random() - .5) * 18 }); }
  };
  /** The plate reaches the hatch: bell, coins, confetti and a small camera punch. */
  function impact(hatch: number, value: number) {
    const tile = map.tiles[hatch], top = diorama.anchors[hatch].top, bell = bells.find(entry => entry.tile === hatch);
    if (bell) {
      bell.age = 0; const { x, y, z } = bell.group.position;
      soft.emit({ x, y: y + .25, z, life: .45, size: .35, grow: 3.5, color: C.gold, alpha: 1, shape: SHAPE.ring });
      soft.emit({ x, y: y + .25, z, life: .6, size: .25, grow: 5, color: C.white, alpha: .8, shape: SHAPE.ring });
    }
    burst(tile.x, top + .35, tile.z, 22, C.gold, SHAPE.spark, 3.4, .24); burst(tile.x, top + .4, tile.z, 10, C.spark, SHAPE.spark, 1.8, .34);
    if (!reducedQuery.matches) confetti(tile.x, top + .5, tile.z, 36);
    popup(`+${value}`, tile.x, top + .75, tile.z, undefined, 2);
    if (!reducedQuery.matches) punch = 1;
  }

  function onEvent(event: GameEvent, view: View) {
    const actor = rigIndex(event.player), hatch = hatches[0];
    // Orders expiring and stars carry no position: they play at the (first) hatch.
    const where = event.x !== undefined && event.z !== undefined ? position.set(event.x, 0, event.z) : actor >= 0 ? position.copy(rigs[actor].rig.root.position) : hatch ? position.set(hatch.x, 0, hatch.z) : null;
    if (!where) return;
    const tile = tileAt(map, where.x, where.z), top = tile ? diorama.anchors[tile.index].top : .02, { x, z } = where, still = reducedQuery.matches;
    switch (event.type) {
      case 'serve': {
        const flier = fliers.reduce((oldest, item) => item.age > oldest.age ? item : oldest), group = flier.group;
        flier.hatch = tile?.kind === 'serve' ? tile.index : hatch?.index ?? 0; flier.value = event.value ?? 0; flier.age = 0; flier.landed = false;
        group.clear(); group.add(kit.spawn(kit.template('plate')));
        if (event.recipe) { const dish = kit.spawn(kit.template(`dish_${event.recipe}`)); dish.position.y = .03; group.add(dish); }
        const anchor = diorama.anchors[flier.hatch];
        flier.to.set(anchor.x, anchor.top, anchor.z);
        if (actor >= 0 && rigs[actor].rig.root.visible) rigs[actor].rig.hold.getWorldPosition(flier.from); else flier.from.set(anchor.x, 1.4, anchor.z + .6);
        group.position.copy(flier.from); group.visible = true;
        break;
      }
      case 'wrong': { const slot = crosses.reduce((oldest, item) => item.age > oldest.age ? item : oldest); slot.age = 0; slot.rig = Math.max(0, actor); puff(x, top + .2, z, 5, C.smoke, .18, .6); break; }
      case 'expire': puff(x, top + .35, z, 16, C.grey, .34, .8, .6, 1.2); break;
      case 'chop': for (let i = 0; i < 14; i++) soft.emit({ x, y: top + .1, z, vx: (Math.random() - .5) * 3, vy: 1.8 + Math.random() * 1.8, vz: (Math.random() - .5) * 3, life: .6, size: .08, color: fleckColor(view.tiles, tile?.index), shape: SHAPE.fleck, gravity: 9, spin: 12 }); burst(x, top + .2, z, 8, C.spark, SHAPE.spark, 1.4, .16); break;
      case 'wash': splash(x, top + .05, z, 8); puff(x, top + .15, z, 4, C.foam, .16, .4, .6); break;
      case 'done': {
        if (tile) { doneAt[tile.index] = frameTime; const item = tileItem(view.tiles, tile.index); if (item) items.bump(item.id); }
        burst(x, top + .45, z, 18, C.spark, SHAPE.spark, 2, .2); burst(x, top + .45, z, 8, C.green, SHAPE.spark, 1.4, .18);
        soft.emit({ x, y: top + .3, z, life: .5, size: .35, grow: 3.2, color: C.white, alpha: .9, shape: SHAPE.ring }); break;
      }
      case 'burn': puff(x, top + .3, z, 14, C.smoke, .32, 1, 1.2, 1.2); break;
      case 'fire': burst(x, top + .2, z, 18, C.flame, SHAPE.flame, 2.2, .3, 0, .6); puff(x, top + .4, z, 10, C.smoke, .35, 1, 1.4, 1.3); if (!still) shake = Math.max(shake, .35); break;
      case 'extinguish': puff(x, top + .2, z, 18, C.steam, .3, 1.4, 1, 1); for (let i = 0; i < 10; i++) foam.emit({ x: x + (Math.random() - .5) * .7, y: top + .05, z: z + (Math.random() - .5) * .7, life: 1.4, size: .2, grow: 1.6, color: C.foam, alpha: 1.4, shape: SHAPE.foam }); break;
      case 'throw': puff(x, .9, z, 4, C.dust, .14, .8, .2, .35); break;
      case 'catch': burst(x, 1.1, z, 12, C.spark, SHAPE.spark, 1.6, .18); soft.emit({ x, y: 1, z, life: .35, size: .3, grow: 3, color: C.white, alpha: .9, shape: SHAPE.ring }); break;
      case 'land': puff(x, top, z, 6, C.dust, .16, 1.2, .2, .45); break;
      case 'place': case 'pickup': soft.emit({ x, y: top + .05, z, life: .28, size: .3, grow: 2.6, color: C.white, alpha: .55, shape: SHAPE.ring }); break;
      case 'splash': if (palette.pit === 'water') splash(x, -.4, z); else puff(x, .05, z, 4, C.dust, .14, 1, .4, .5); break;
      case 'dash': if (!still) puff(x, .05, z, 7, C.dust, .2, 1.6, .25, .45); break;
      case 'fall': if (palette.pit === 'water') splash(x, -.4, z, 20); else puff(x, .05, z, 6, C.dust, .18, 1.4, .5, .6); if (!still) shake = Math.max(shake, .5); break;
      case 'respawn': puff(x, .05, z, 12, C.dust, .22, 2, .3, .5); burst(x, .8, z, 10, C.spark, SHAPE.spark, 1.6); break;
      case 'portal': burst(x, .4, z, 16, C.purple, SHAPE.spark, 1.8, .18); break;
      case 'star': burst(x, 1.4, z, 30, C.gold, SHAPE.spark, 4, .3); popup('★', x, 1.8, z, '#ffd24a', 1.6); break;
      case 'gate': for (const gate of diorama.gates) puff(gate.pivot.position.x, .05, gate.pivot.position.z, 3, C.dust, .2, .8, .2, .5); break;
    }
  }
  function fleckColor(tiles: readonly TileState[], index: number | undefined) {
    const food = index === undefined ? undefined : tileItem(tiles, index)?.parts[0]?.food;
    return C.fleck.set(food ? INGREDIENTS[food].color : '#8fd660');
  }

  let eventView: View;
  const handleEvent = (event: GameEvent) => onEvent(event, eventView);
  function frame(nowMs: number, dt: number) {
    const current = latest.current, still = reducedQuery.matches, t = nowMs / 1000;
    frameTime += dt; emitClock += dt;
    const pair = sample(current.serverNowMs()), live = pair?.b ?? null, previous = pair?.a ?? null, k = pair?.k ?? 0;
    const chefs = live?.players ?? prepChefs, tiles = live?.tiles ?? prepTiles, now = live ? lerp(previous!.now, live.now, k) : 0;
    if (live) { eventView = live; cursor.take(live.events, handleEvent, live.now); }
    const emit = emitClock > 1 / 30; if (emit) emitClock = 0;

    items.begin(); widgets.begin(); blobs.begin(); dots.begin(); rings.begin(); frames.begin(); heat.begin(); clean.begin(); dirty.begin(); diorama.flames.begin();
    // ── Chefs, held items, rings and target frames ──
    for (let i = 0; i < rigs.length; i++) {
      const entry = rigs[i], chef = chefs[i]?.id === entry.id ? chefs[i] : chefs.find(other => other.id === entry.id);
      if (!chef) { entry.rig.root.visible = entry.sprite.visible = false; continue; }
      const before = previous?.players[i]?.id === chef.id ? previous.players[i] : chef;
      const x = lerp(before.x, chef.x, k), z = lerp(before.z, chef.z, k), vx = lerp(before.vx, chef.vx, k), vz = lerp(before.vz, chef.vz, k);
      pose.chef = chef; pose.x = x; pose.z = z; pose.vx = vx; pose.vz = vz; pose.fx = lerp(before.fx, chef.fx, k); pose.fz = lerp(before.fz, chef.fz, k);
      pose.now = now; pose.t = t + i * .37; pose.dt = dt; pose.still = still; pose.held = chef.held;
      const fallFor = animateRig(entry.rig, pose);
      const rig = entry.rig, standing = fallFor < 0;
      const speed = Math.hypot(vx, vz);
      // A chef busy at a tile up-screen would hide it (and its bar) under their name, so the plate moves under their feet,
      // fading through the switch. Their held item stays clear either way: it sits between the head and the feet.
      const busyUp = standing && chef.target >= 0 && chef.fz < -.5 && (chef.work !== 'none' || speed < .6);
      entry.below = still ? +busyUp : entry.below + (+busyUp - entry.below) * Math.min(1, dt * 10);
      plateDir[i] = entry.below > .5 ? -1 : 1;
      entry.sprite.visible = rig.root.visible;
      entry.sprite.position.set(x, plateDir[i] > 0 ? CHEF_HEIGHT + .12 + rig.body.position.y : .02, z);
      entry.sprite.scale.set(labelHeight * entry.aspect, labelHeight, 1);
      entry.sprite.material.opacity = (chef.connected ? 1 : .45) * Math.abs(entry.below * 2 - 1);
      if (standing) { blobs.add(x, .012, z, .92, .8); rings.add(x, .016, z, 1.1, 1.1, entry.color); }
      if (chef.held && rig.root.visible) {
        rig.root.updateMatrixWorld(true); rig.hold.getWorldPosition(position); rig.hold.getWorldQuaternion(rotation);
        items.place(chef.held, chefOwner(i), position, rotation, 1, dt);
      }
      if (standing && chef.connected && chef.target >= 0 && chef.target < diorama.anchors.length) {
        const anchor = diorama.anchors[chef.target], pulse = still ? 1 : 1 + Math.sin(t * 6 + i) * .03;
        frames.add(map.tiles[chef.target].x, anchor.top, map.tiles[chef.target].z, 1.02 * pulse, 1.02 * pulse, entry.color);
      }
      // Footstep dust, dash trails and work particles.
      if (!still && standing && speed > WALK_SPEED * .6 && frameTime - entry.stepAt > .22) { entry.stepAt = frameTime; puff(x - vx * .06, .05, z - vz * .06, 1, C.dust, .12, .3, .15, .4); }
      if (!still && chef.dashing && frameTime - entry.dustAt > .03) { entry.dustAt = frameTime; puff(x - vx * .05, .08, z - vz * .05, 2, C.dust, .2, .5, .3, .45); }
      const target = chef.target >= 0 ? diorama.anchors[chef.target] : null;
      // Flecks fly on each knife strike (the chop animation hits the board every PI / 7.5 s) and the food squashes.
      const hit = chef.work === 'chop' ? Math.floor((pose.t * 7.5 - (rig.mode === 'pivot' ? Math.PI / 4 : 0)) / Math.PI) : 0;
      if (hit !== entry.hit && target) {
        const tint = fleckColor(tiles, chef.target), food = tileItem(tiles, chef.target);
        if (food) items.bump(food.id);
        for (let n = 0; n < 5; n++) soft.emit({ x: target.x, y: target.top + .1, z: target.z, vx: (Math.random() - .5) * 2.2, vy: 1.4 + Math.random() * 1.2, vz: (Math.random() - .5) * 2.2, life: .5, size: .075, color: tint, shape: SHAPE.fleck, gravity: 9, spin: 12 });
        glow.emit({ x: target.x, y: target.top + .12, z: target.z, life: .12, size: .3, grow: 1.6, color: C.spark, alpha: .8, shape: SHAPE.spark });
      }
      entry.hit = hit;
      if (chef.work === 'wash' && target && emit && Math.random() < .5) { soft.emit({ x: target.x + (Math.random() - .5) * .4, y: target.top + .05, z: target.z + (Math.random() - .5) * .3, vy: .5 + Math.random() * .4, life: .8, size: .08, grow: 1.3, color: C.foam, alpha: .9, shape: SHAPE.drop }); }
      if (chef.work === 'spray' && emit) {
        const fx = Math.sin(rig.yaw), fz = Math.cos(rig.yaw);
        // A bubbly stream from the nozzle; drag stops it (about 0.4 x speed) over the tile ahead, onto the flames. Alpha > 1 holds full opacity longer.
        for (let n = 0; n < 5; n++) foam.emit({ x: x + fx * .5, y: 1.05, z: z + fz * .5, vx: fx * (2.2 + Math.random()) + (Math.random() - .5) * 1.1, vy: Math.random() * .6, vz: fz * (2.2 + Math.random()) + (Math.random() - .5) * 1.1, life: .8, size: .13, grow: 2.6, color: C.foam, alpha: 1.5, shape: SHAPE.foam, drag: 2.4, gravity: 1.2 });
        // Foam piles up on the stations it hits, over any fire, and lingers a moment after the spray stops.
        for (let d = 1; d <= 2; d++) {
          const ahead = tileAt(map, x + fx * d, z + fz * d);
          if (ahead && !WALKABLE.has(ahead.kind) && ahead.kind !== 'void') foam.emit({ x: ahead.x + (Math.random() - .5) * .7, y: diorama.anchors[ahead.index].top + .06, z: ahead.z + (Math.random() - .5) * .7, life: 1.5, size: .16, grow: 1.7, color: C.foam, alpha: 1.5, shape: SHAPE.foam, spin: 1 });
        }
      }
    }

    // ── Tiles: items, stacks, progress, cooking and fire ──
    fires.length = 0;
    for (const state of tiles) {
      const tile = map.tiles[state.at]; if (!tile) continue;
      const anchor = diorama.anchors[state.at];
      if (state.item) {
        const prior = items.ownerOf(state.item.id), slide = prior >= 0 && prior !== tile.index && map.tiles[prior].kind === 'belt' ? Math.min(.8, BELT_SECONDS * .7) : 0;
        items.place(state.item, state.at, position.set(anchor.x, anchor.y, anchor.z), identity, anchor.scale, dt, slide);
      }
      if (state.count && (tile.kind === 'rack' || tile.kind === 'return')) {
        const stack = tile.kind === 'rack' ? clean : dirty, heights = stackHeights(state.count);
        for (let n = 0; n < heights.length; n++) stack.add(matrix.compose(position.set(tile.x, anchor.y + heights[n], tile.z + .05), yawQ.setFromAxisAngle(up, n * 1.1), scaleOne));
      }
      if (state.progress && state.progress > 0 && state.progress < 1) widgets.add(WIDGET.bar, tile.x, anchor.top + .7, tile.z, .84, .19, state.progress, tile.kind === 'sink' ? C.wash : C.green, C.track);
      if (state.fire && state.fire > 0) {
        fires.push(state.at);
        heat.add(tile.x, anchor.top + .012, tile.z, 1.5 * (.7 + state.fire * .4) * (still ? 1 : 1 + Math.sin(t * 17 + state.at) * .06), undefined, C.flame);
        if (emit) {
          // Opaque tongues of flame (readable on light counters) with an additive glowing core and rising smoke.
          const size = .7 + state.fire * .5, n = still ? 1 : 3 + Math.round(state.fire * 2);
          for (let f = 0; f < n; f++) soft.emit({ x: tile.x + (Math.random() - .5) * .55, y: anchor.top + .08, z: tile.z + (Math.random() - .5) * .55, vx: (Math.random() - .5) * .3, vy: 1.3 + Math.random() * state.fire, vz: (Math.random() - .5) * .3, life: .5 + Math.random() * .3, size: (.34 + Math.random() * .2) * size, grow: .35, color: Math.random() < .35 ? C.ember : C.flame, shape: SHAPE.flame, drag: 1 });
          glow.emit({ x: tile.x + (Math.random() - .5) * .3, y: anchor.top + .12, z: tile.z + (Math.random() - .5) * .3, vy: 1, life: .35, size: .3 * size, grow: .5, color: C.ember, alpha: .8, shape: SHAPE.flame });
          if (Math.random() < .45) puff(tile.x, anchor.top + 1, tile.z, 1, C.smoke, .32 * size, .2, .9, 1.4);
        }
      }
      if ((tile.kind === 'stove' || tile.kind === 'oven') && state.item) {
        const readout = cookReadout(state.item, current.settings.relaxed ?? false, cooking), gy = tile.kind === 'oven' ? 1.55 : anchor.top + .8;
        if (readout.state === 'cooking') widgets.add(WIDGET.gauge, anchor.x, gy, anchor.z, .5, .5, readout.progress, C.amber, C.track);
        else if (readout.state === 'done') {
          // The check pops in with a springy overshoot when the food finishes, then bobs gently.
          const size = .5 * (1 + (still ? 0 : popWobble(frameTime - doneAt[state.at], .9)));
          widgets.add(WIDGET.check, anchor.x, gy + (still ? 0 : Math.abs(Math.sin(t * 3)) * .05), anchor.z, size, size, 1, C.green);
        } else if (readout.state === 'warn') {
          // A hard, quickening heartbeat and a red glow on the worktop: this is about to burn.
          const beat = still ? .6 : Math.abs(Math.sin(t * (6 + readout.progress * 8))) ** 3, size = .52 + beat * .3;
          widgets.add(WIDGET.warn, anchor.x, gy + beat * .06, anchor.z, size, size, 1, beat > .4 ? C.red : C.amber);
          heat.add(tile.x, anchor.top + .012, tile.z, .9 + beat * .5, undefined, C.red);
        }
        if (emit && (readout.state === 'cooking' || readout.state === 'done' || readout.state === 'warn') && Math.random() < (readout.state === 'cooking' ? .35 : .6)) {
          soft.emit({ x: anchor.x + (Math.random() - .5) * .2, y: anchor.y + .25, z: anchor.z + (Math.random() - .5) * .2, vx: (Math.random() - .5) * .2, vy: .6 + Math.random() * .4, vz: (Math.random() - .5) * .2, life: 1.3, size: .16, grow: 3, color: readout.state === 'warn' ? C.smoke : C.steam, alpha: readout.state === 'warn' ? .6 : .45, shape: SHAPE.puff, drag: .8 });
        }
        // The burner is lit only while it heats something; it flickers about its own base.
        if (tile.kind === 'stove' && readout.state !== 'idle' && readout.state !== 'burnt') {
          const flick = still ? 1 : 1 + Math.sin(t * 31 + state.at) * .14 + Math.sin(t * 13 + state.at * 2) * .08;
          diorama.flames.add(matrix.compose(position.set(tile.x, diorama.flameY * (1 - flick), tile.z), identity, flameScale.set(1, flick, 1)));
        }
      }
    }
    // Pooled fire lights flicker over the first two fires.
    for (let n = 0; n < fireLights.length; n++) {
      const light = fireLights[n], index = fires[n];
      light.intensity = index === undefined ? 0 : 3.2 + (still ? 0 : Math.sin(t * 23 + n) * .8 + Math.sin(t * 37) * .5);
      if (index !== undefined) light.position.set(map.tiles[index].x, 1.5, map.tiles[index].z);
    }

    // ── Loose (thrown, dropped) items with arcs and shadows ──
    for (const loose of live?.loose ?? NONE) {
      const before = (previous && looseById(previous.loose, loose.item.id)) ?? loose;
      const x = lerp(before.x, loose.x, k), y = lerp(before.y, loose.y, k), z = lerp(before.z, loose.z, k), tile = tileAt(map, x, z);
      const floor = !tile ? 0 : tile.kind === 'void' ? -10 : WALKABLE.has(tile.kind) ? 0 : .905;
      const flying = y > .01 && (loose.vx !== 0 || loose.vz !== 0 || loose.vy !== 0);
      rotation.setFromAxisAngle(up, flying && !still ? t * 9 : 0);
      items.place(loose.item, LOOSE, position.set(x, Math.max(floor, y), z), rotation, 1, dt);
      if (floor > -1) blobs.add(x, floor + .014, z, Math.max(.18, .42 - y * .08), Math.max(.18, .42 - y * .08));
      if (!flying) continue;
      // A dotted ring in the thrower's colour marks where the food will come down, with a sparkle trail behind it.
      const r = landingIn(y, loose.vy), lx = Math.max(-map.halfX, Math.min(map.halfX, x + loose.vx * r)), lz = Math.max(-map.halfZ, Math.min(map.halfZ, z + loose.vz * r));
      const spot = tileAt(map, lx, lz), by = rigIndex(loose.by);
      if (spot && spot.kind !== 'void') dots.add(lx, diorama.anchors[spot.index].top + .004, lz, .78, .78, by >= 0 ? rigs[by].color : C.white, still ? 0 : t * 2.5);
      if (emit && !still) glow.emit({ x, y: Math.max(floor, y) + .1, z, life: .3, size: .16, grow: .3, color: C.spark, alpha: .8, shape: SHAPE.spark });
    }
    serving(dt, still);
    items.end(); widgets.end(); blobs.end(); dots.end(); rings.end(); frames.end(); heat.end(); clean.end(); dirty.end(); diorama.flames.end();

    // ── Gimmicks ──
    const open = live ? live.gatesOpen : true, warning = live?.gateWarning ?? false;
    for (let n = 0; n < diorama.gates.length; n++) {
      const gate = diorama.gates[n];
      gateAngles[n] += ((open ? 0 : 1.25) - gateAngles[n]) * (1 - Math.exp(-(still ? 30 : 7) * dt));
      const wobble = warning && open && !still ? Math.sin(t * 30) * .015 : 0;
      if (gate.alongX) gate.pivot.rotation.z = -gate.sign * (gateAngles[n] + wobble); else gate.pivot.rotation.x = gate.sign * (gateAngles[n] + wobble);
    }
    const lampOn = warning ? Math.sin(t * 14) > 0 : !open;
    diorama.gateLamps.emissive.copy(lampOn ? (open ? C.amber : C.red) : C.black);
    for (const portal of diorama.portals) { portal.rotation.y = still ? 0 : -t * 2.2; if (!still) portal.scale.setScalar(1 + Math.sin(t * 3) * .04); }
    if (!still) { for (const texture of diorama.belts) texture.offset.x -= dt / BELT_SECONDS; if (diorama.sheen) diorama.sheen.offset.x = (t * .12) % 1; }
    if (diorama.water && !still) diorama.water.position.y = Math.sin(t * 1.4) * .02;

    declutter(dt);

    // ── Popups: spring in with an overshoot, rise, hold, then fade ──
    for (const item of popups) {
      if (item.age >= 1) continue;
      item.age = Math.min(1, item.age + dt / 1.5);
      const a = item.age * 1.5, rise = still ? 0 : 1 - (1 - item.age) ** 3, pop = still ? 1 : 1 - Math.exp(-a * 9) * Math.cos(a * 22);
      const height = labelHeight * 1.25 * item.size * pop;
      item.sprite.position.set(item.x, item.y + rise * .8 * item.size, item.z);
      item.sprite.scale.set(height * item.aspect, height, 1);
      // Keep the whole popup inside the HUD-free view (hatches sit on the kitchen's edges).
      const ndc = position.copy(item.sprite.position).project(camera), unit = cameraDistance * tanHalf, halfH = height / 2 / unit, halfW = height * item.aspect / 2 / (unit * camera.aspect);
      const dy = Math.min(0, hudFree.top - .02 - halfH - ndc.y), dx = Math.min(0, hudFree.right - .02 - halfW - ndc.x) + Math.max(0, hudFree.left + .02 + halfW - ndc.x);
      item.sprite.position.addScaledVector(cameraUp, dy * unit).addScaledVector(right, dx * unit * camera.aspect);
      item.sprite.material.opacity = item.age > .75 ? (1 - item.age) / .25 : 1;
      item.sprite.visible = item.age < 1;
    }
    // A clamped step keeps effects coherent through frame stalls (tab switches, slow devices).
    soft.update(Math.min(dt, .05)); glow.update(Math.min(dt, .05)); foam.update(Math.min(dt, .05));

    // ── Camera shake and serve punch (translation only; the orientation is set on resize) ──
    shake = Math.max(0, shake - dt * 1.4); punch = Math.max(0, punch - dt * 3);
    const amount = still ? 0 : shake * shake * .35, push = still ? 0 : punch * punch * cameraDistance * .03;
    camera.position.set(cameraBase.x + Math.sin(t * 53) * amount, cameraBase.y + Math.sin(t * 41 + 1) * amount * .6, cameraBase.z + Math.cos(t * 47) * amount).addScaledVector(forward, push);
  }

  /** Served plates in flight, sliding through the hatch, bouncing bells and "wrong dish" crosses. */
  function serving(dt: number, still: boolean) {
    const fly = still ? 0 : FLY;
    for (const flier of fliers) {
      if (flier.age > fly + SLIDE) continue;
      flier.age += dt;
      const k = fly ? Math.min(1, flier.age / fly) : 1, group = flier.group;
      if (k < 1) {
        // An arc that peaks higher for longer throws, spinning once on the way.
        group.position.lerpVectors(flier.from, flier.to, k); group.position.y += Math.sin(k * Math.PI) * (.5 + flier.from.distanceTo(flier.to) * .12);
        group.rotation.y = k * Math.PI * 2; group.scale.setScalar(1);
      } else {
        if (!flier.landed) { flier.landed = true; impact(flier.hatch, flier.value); }
        // Land with a squash, then shrink away through the hatch.
        const after = flier.age - fly, gone = Math.max(0, (after - .12) / (SLIDE - .12)), wobble = still ? 0 : popWobble(after, .35);
        group.position.copy(flier.to); group.rotation.y = 0;
        group.scale.set((1 - gone) * (1 - wobble * .5), (1 - gone) * (1 + wobble), (1 - gone) * (1 - wobble * .5));
      }
      group.visible = flier.age <= fly + SLIDE;
    }
    for (const bell of bells) {
      bell.age += dt;
      const wobble = still ? 0 : popWobble(bell.age, .55);
      bell.group.scale.set(1.5 * (1 - wobble * .4), 1.5 * (1 + wobble), 1.5 * (1 - wobble * .4));
      bell.group.rotation.z = still || bell.age > 1 ? 0 : Math.sin(bell.age * 38) * Math.exp(-bell.age * 5) * .35;
    }
    for (const cross of crosses) {
      if (cross.age > .9) continue;
      cross.age += dt;
      const { rig } = rigs[cross.rig], size = .55 * (1 + (still ? 0 : popWobble(cross.age, 1.2))), fade = Math.min(1, (.9 - cross.age) / .25);
      // Above the chef's nameplate, so the name stays readable while the X pops.
      widgets.add(WIDGET.cross, rig.root.position.x, CHEF_HEIGHT + .12 + labelHeight + .4 + (still ? 0 : cross.age * .25), rig.root.position.z, size, size, 1, C.red, C.red, fade);
    }
  }

  /** Push overlapping nameplates apart (in plate heights, away from their own chef) so every name stays readable in a crowd. */
  function declutter(dt: number) {
    const h = .072 * 1.08;
    for (let i = 0; i < rigs.length; i++) {
      const { sprite, aspect } = rigs[i];
      position.copy(sprite.position).project(camera);
      plateX[i] = sprite.visible ? position.x : 99; plateY[i] = position.y + plateDir[i] * h / 2; plateW[i] = h * aspect / camera.aspect;
      shownY[i] = plateY[i] + lift[i] * h * plateDir[i];
    }
    order.sort(byPlateY);
    for (let n = 0; n < order.length; n++) {
      const i = order[n], dir = plateDir[i]; let y = plateY[i];
      for (let pass = 0; pass < order.length; pass++) {
        let moved = false;
        for (let m = 0; m < n; m++) {
          const j = order[m], placed = plateY[j] + lift[j] * h * plateDir[j];
          if (Math.abs(plateX[i] - plateX[j]) < (plateW[i] + plateW[j]) / 2 && Math.abs(y - placed) < h) { y = placed + h * dir; moved = true; }
        }
        if (!moved) break;
      }
      lift[i] += ((y - plateY[i]) / h * dir - lift[i]) * Math.min(1, dt * 12);
      rigs[i].sprite.center.y = dir > 0 ? -lift[i] : 1 + lift[i];
    }
  }

  // Configure the renderer (shadows, tone mapping) on its first render; mountThreeScene owns its creation.
  scene.onBeforeRender = (renderer: WebGLRenderer) => {
    // The kitchen is static and chefs use blob shadows, so the sun's shadow map renders once instead of every frame.
    renderer.shadowMap.enabled = shadows; renderer.shadowMap.type = PCFShadowMap; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    // three also shares one DFG lookup texture between renderers and never disposes it (like the Sprite geometry above).
    // Once a standard material has rendered, the round takes ownership of it so ended renderers are not kept alive.
    scene.onBeforeRender = () => {
      const lut = (renderer.properties.get(kit.materials.matte) as { uniforms?: { dfgLUT?: { value: Texture | null } } }).uniforms?.dfgLUT?.value;
      if (lut) { own(lut); scene.onBeforeRender = () => {}; }
    };
  };

  // The client publishes its HUD bands as CSS lengths (possibly calc() with container units). Two hidden probes resolve
  // them to pixels; observing the probes refits the camera when the bands change without the canvas resizing (for
  // example when the HUD mounts after the first frame).
  const probe = (size: string) => {
    const el = (canvas.parentElement ?? document.body).appendChild(document.createElement('div'));
    el.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;${size}`;
    scope.defer(() => el.remove());
    return el;
  };
  const near = probe('width:var(--kr-hud-left);height:var(--kr-hud-top)'), far = probe('width:var(--kr-hud-right);height:var(--kr-hud-bottom)');
  let aspectNow = 0;
  const resize = (aspect: number) => {
    aspectNow = aspect;
    const height = canvas.clientHeight || 720, width = canvas.clientWidth || height * aspect, style = getComputedStyle(canvas), a = near.getBoundingClientRect(), b = far.getBoundingClientRect();
    const band = (name: string, fallback: number, px: number, across = false) =>
      style.getPropertyValue(name).trim() ? Math.max(0, Math.min(across ? .35 : .3, px / (across ? width : height))) : fallback;
    const bands = { hudTop: band('--kr-hud-top', 120 / 720, a.height), hudBottom: band('--kr-hud-bottom', .02, b.height), hudLeft: band('--kr-hud-left', 0, a.width, true), hudRight: band('--kr-hud-right', 0, b.width, true) };
    const fit = fitCamera(map.halfX, map.halfZ, aspect, bands);
    camera.aspect = aspect;
    // A lens shift (view offset) centres the kitchen between side bands without turning the camera.
    if (fit.shift) camera.setViewOffset(aspect, 1, -fit.shift * aspect / 2, 0, aspect, 1); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    hudFree.top = 1 - 2 * bands.hudTop; hudFree.left = -1 + 2 * bands.hudLeft; hudFree.right = 1 - 2 * bands.hudRight;
    cameraBase.set(...fit.position); cameraDistance = fit.distance; fog.near = fit.distance + 8; fog.far = fit.distance + 45;
    camera.position.copy(cameraBase); camera.lookAt(0, 0, fit.targetZ);
    labelHeight = .036 * 2 * fit.distance * tanHalf;
  };
  const bandsChanged = new ResizeObserver(() => { if (aspectNow) resize(aspectNow); });
  bandsChanged.observe(near); bandsChanged.observe(far); scope.defer(() => bandsChanged.disconnect());

  mountThreeScene(canvas, {
    signal: scope.signal, scene, camera, quality, resize,
    frame, onReady: () => latest.current.onReady(), onError: error => latest.current.onError(error), onMetrics,
  });
}
