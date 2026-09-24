/**
 * Stage Lab: one stage with the real camera, capsule stand-ins, tags and magnifier bubbles, plus a collision overlay.
 * Query: ?stage=<id>&view=spawn|ledge|max|wide|offscreen|card&debug=1&hazard=warn|active&tick=N&quality=low&reduced=1&players=1..4&animate=1&compact=1
 * Sets body[data-ready] once real frames have rendered and body[data-metrics] every second.
 */
import { BackSide, BufferGeometry, CapsuleGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshToonMaterial, PerspectiveCamera, RingGeometry, Scene, Vector3 } from 'three';
import { mountThreeScene, type Quality } from '../../../../party-3d/src/index';
import { ResourceScope } from '../../../../party-runtime/src/index';
import { FIGHTERS, ROSTER, type FighterKind } from '../../src/model';
import { STAGES, STAGE_IDS, stageFrame, type StageId } from '../../src/stages';
import { CameraDirector, applyShot, distanceFor, type Subject } from '../../src/scene/camera';
import { createStageArt } from '../../src/scene/stage/index';
import { BUBBLE_LAYER, DEPTH } from '../../src/scene/stage/kit';
import { createMagnifier, createTags, type TagItem } from '../../src/scene/tags';

const q = new URLSearchParams(location.search), id = (STAGE_IDS.includes(q.get('stage') as StageId) ? q.get('stage') : 'battlefield') as StageId, stage = STAGES[id];
const view = q.get('view') ?? 'spawn', debug = q.get('debug') === '1', quality: Quality = q.get('quality') === 'low' ? 'low' : 'balanced', reduced = q.get('reduced') === '1', animate = q.get('animate') === '1';
const card = view === 'card', players = Math.max(1, Math.min(4, Number(q.get('players') ?? 4)));
if (card) document.body.classList.add('card');
/** First tick in the stage's first minutes where its hazard warns or is active. */
const hazardTick = (want: 'warn' | 'active') => { for (let t = 0; t < 36000; t += 5) { const h = stageFrame(id, t, true).hazard; if (h && (want === 'warn' ? h.warning : h.active)) return t + (want === 'active' ? 20 : 30); } return 0; };
const hz = q.get('hazard');
const startTick = Number(q.get('tick') ?? (hz === 'warn' || hz === 'active' ? hazardTick(hz) : card ? 0 : 240));
const COLORS = ['#ff5748', '#28c6e7', '#78d955', '#ffd24a'];
const scope = new ResourceScope(), scene = new Scene(), camera = new PerspectiveCamera(30, 16 / 9, .5, 2400);
const art = createStageArt(id, scope, quality); scene.add(art.root);
const director = new CameraDirector(stage.camera, art.floor);
let aspect = 16 / 9;

// Capsule stand-ins: toon body, hull outline, head, player ring.
type Dummy = { fighter: FighterKind; x: number; y: number; color: string; label: string; name: string; group: Group };
const dummies: Dummy[] = [], rest = stageFrame(id, startTick, true);
const kinds: FighterKind[] = ['fox', 'marth', 'jigglypuff', 'bowser'].filter(k => (ROSTER as readonly string[]).includes(k)) as FighterKind[];
const ledgeSpots = rest.ledges.map(l => [l.x + l.side * .5, l.y - 1.5] as [number, number]);
const platSpots = rest.platforms.map(p => [(p.left + p.right) / 2, p.y] as [number, number]);
const spots: [number, number][] = view === 'ledge' ? [...ledgeSpots, ...platSpots]
  : view === 'max' ? [[art.floor.left + .4, art.floor.top], [art.floor.right - .4, art.floor.top], ...platSpots]
  : view === 'offscreen' ? [[-1.5, art.floor.top], [stage.blast.right - 1.5, 4], [stage.blast.left + 2, -6], [0, stage.blast.top - 2.5]]
  : view === 'wide' || card ? [] : stage.spawns.map(s => [s[0], s[1]] as [number, number]);
spots.slice(0, view === 'spawn' ? players : 4).forEach(([x, y], i) => {
  const fighter = kinds[i % kinds.length] ?? ROSTER[i], info = FIGHTERS[fighter], group = new Group(), r = info.radius, color = COLORS[i];
  const body = scope.own(new CapsuleGeometry(r, Math.max(.05, info.height - 2 * r), 6, 16)), mesh = new Mesh(body, scope.own(new MeshToonMaterial({ color: info.color })));
  mesh.position.y = info.height / 2; group.add(mesh);
  const hull = new Mesh(body, scope.own(new MeshBasicMaterial({ color: '#05071a', side: BackSide }))); hull.position.y = info.height / 2; hull.scale.setScalar(1.07); group.add(hull);
  const head = new Mesh(scope.own(new CapsuleGeometry(r * .7, .02, 4, 12)), scope.own(new MeshToonMaterial({ color: '#fff0dc' }))); head.position.set(0, info.height - r * .7, r * .5); group.add(head);
  const ring = new Mesh(scope.own(new RingGeometry(r * 1.1, r * 1.45, 32)), scope.own(new MeshBasicMaterial({ color, transparent: true, opacity: .9, depthWrite: false })));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .03; group.add(ring);
  group.position.set(x, y, 0); group.traverse(o => o.layers.enable(BUBBLE_LAYER)); scene.add(group);
  dummies.push({ fighter, x, y, color, group, label: i === 3 ? 'CPU' : `P${i + 1}`, name: i === 3 ? 'CPU 1' : ['Aria', 'Benedikt the Unbreakable', 'Chen'][i] });
});

// Collision overlay at z = 0 (blocks red, platforms cyan), block fronts (orange), ledges (yellow), camera and blast (green).
const overlay = new Group(); overlay.visible = debug; scene.add(overlay);
const lines = (count: number, color: string) => { const g = scope.own(new BufferGeometry()); g.setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 3), 3)); const l = new LineSegments(g, scope.own(new LineBasicMaterial({ color, depthTest: false, transparent: true }))); l.renderOrder = 50; l.frustumCulled = false; overlay.add(l); return l; };
const rect = (l: number, r: number, b: number, t: number, z: number) => [l, b, z, r, b, z, r, b, z, r, t, z, r, t, z, l, t, z, l, t, z, l, b, z];
const fill = (line: LineSegments, points: number[]) => { const a = line.geometry.attributes.position as Float32BufferAttribute; (a.array as Float32Array).fill(0); (a.array as Float32Array).set(points.slice(0, a.array.length)); a.needsUpdate = true; };
const blockLines = lines(64 * 8, '#ff3355'), frontLines = lines(64 * 8, '#ffa02b'), platLines = lines(32 * 6, '#33e6ff'), ledgeLines = lines(32 * 4, '#ffe600'), zoneLines = lines(16, '#7cff6b'), hazardLines = lines(8 * 8, '#ffffff');
fill(zoneLines, [...rect(stage.camera.left, stage.camera.right, stage.camera.bottom, stage.camera.top, 0), ...rect(stage.blast.left, stage.blast.right, stage.blast.bottom, stage.blast.top, 0)]);

const root = document.getElementById('stage')!, tags = createTags(root), magnifier = createMagnifier(scene, scope), hud = document.getElementById('hud')!, canvas = document.getElementById('c') as HTMLCanvasElement;
const subjects = (): Subject[] => card ? [...rest.platforms.map(p => ({ x: (p.left + p.right) / 2, y: p.y, height: 1.2 })), ...stage.spawns.map(([x, y]) => ({ x, y, height: 1.2 }))] : dummies.map(d => ({ x: d.x, y: d.y, height: FIGHTERS[d.fighter].height }));
const project = new Vector3(), toScreen = (x: number, y: number, w: number, h: number) => { project.set(x, y, 0).project(camera); return { x: (project.x + 1) / 2 * w, y: (1 - project.y) / 2 * h }; };
let frames = 0, metrics = '';
director.reset(stage.camera, art.floor, aspect, subjects());
mountThreeScene(canvas, {
  signal: scope.signal, scene, camera, quality,
  resize(next) { aspect = next; camera.aspect = next; director.reset(stage.camera, art.floor, aspect, subjects()); },
  frame(now, dt) {
    const seconds = animate ? now / 1000 : 6, tick = animate ? startTick + now / 1000 * 60 : startTick;
    const shot = director.update(subjects(), aspect, dt); applyShot(camera, shot); camera.updateMatrixWorld();
    const frame = art.update({ tick, hazards: true, seconds, dt, reduced, camera, fighters: dummies.map(d => ({ x: d.x, y: d.y, vy: 0 })) });
    if (debug) {
      fill(blockLines, frame.blocks.flatMap(b => rect(b.left, b.right, b.bottom, b.top, 0))); fill(frontLines, frame.blocks.flatMap(b => rect(b.left, b.right, b.bottom, b.top, DEPTH.front)));
      fill(platLines, frame.platforms.flatMap(p => [p.left, p.y, 0, p.right, p.y, 0, p.left, p.y, DEPTH.slabFront, p.right, p.y, DEPTH.slabFront, p.left, p.y - .15, 0, p.left, p.y + .15, 0]));
      fill(ledgeLines, frame.ledges.flatMap(l => [l.x - .3, l.y, 0, l.x + .3, l.y, 0, l.x, l.y - .3, 0, l.x, l.y + .3, 0]));
      fill(hazardLines, (frame.hazard?.zones ?? []).flatMap(z => rect(Math.max(z.left, -60), Math.min(z.right, 60), Math.max(z.bottom, -40), Math.min(z.top, 40), .05)));
    }
    const { width, height } = canvas.getBoundingClientRect();
    const items: TagItem[] = dummies.map((d, i) => ({ id: String(i), label: d.label, name: d.name, color: d.color, x: d.x, y: d.y, height: FIGHTERS[d.fighter].height, damage: [0, 57, 118, 164][i], visible: !card, connected: i !== 2 }));
    const bubbles = tags.update(items, (x, y) => toScreen(x, y, width, height), width, height, q.get('compact') === '1');
    magnifier.set(bubbles.map(b => { const d = dummies[Number(b.id)]; return { bubble: b, x: d.x, y: d.y, height: FIGHTERS[d.fighter].height, color: d.color }; }));
    if (++frames === 10) document.body.dataset.ready = '1';
    const h = frame.hazard;
    hud.textContent = `${stage.name} · ${view}${h ? ` · ${h.label} ${h.warning ? 'WARN' : h.active ? 'ACTIVE' : 'idle'}` : ''} · ${quality}${reduced ? ' · reduced' : ''} · tick ${Math.round(tick)} · width ${(shot.halfH * aspect * 2).toFixed(1)}m d ${distanceFor(shot.halfH).toFixed(1)}\n${metrics}`;
  },
  onReady() {}, onError(error) { document.body.dataset.error = String(error); console.error(error); },
  onMetrics(m) { metrics = `calls ${m.calls} · tris ${(m.triangles / 1000).toFixed(1)}k · geo ${m.geometries} · tex ${m.textures} · p50 ${m.p50Ms.toFixed(1)}ms`; document.body.dataset.metrics = JSON.stringify(m); },
});
Object.assign(window, { lab: { scope, scene, camera, stage, art } });
