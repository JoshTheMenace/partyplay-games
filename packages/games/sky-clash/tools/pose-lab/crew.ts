/**
 * Crew Lab: filmstrips of the real simulation drawn by the real crew renderer under the Reaches pipeline (fixtures only, never in a game build).
 * A script drives src/sim/harness for a few fighters; chosen ticks are rendered into cells of one sheet, with the simulation's live hitboxes on top.
 *
 *   /pose-lab/crew.html?kinds=sola,sola&do=0:0.place(-1,1);0:1.place(.8,-1);8:0.press(smash,1,0)&ticks=8,14,20,22,26,34,50&cam=0,1,1.6&cell=420x420
 *   &mode=turn&clip=idle&frame=10&yaws=20,90,160,250      turntable of one pose
 *   &mode=pose&clip=select&frame=0&yaw=30&alpha=1&costumes=0,1,2,3&key=.8   transparent cells, one per costume (portraits, full-body art); key scales the key light
 * Script verbs per fighter index: place(x, facing[, y]) hold(x, y[, buttons+joined]) press(key, aimX, aimY) dmg(percent) free().
 * Options: stage, costumes=0,1, hits=0, cols, scale (device pixels per CSS pixel), quality=low, floor=0. document.body.dataset.ready is set when the sheet is drawn.
 */
import { Color, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SphereGeometry, WebGLRenderer } from 'three';
import { ResourceScope } from '../../../../party-runtime/src/index';
import { clipEnd, sample } from '../../src/anim/core';
import { CREW_DEFS, isCrew, type CrewKind, type StateClip } from '../../src/crew/index';
import { FIGHTERS, type FighterView, type MoveId, type StageId } from '../../src/model';
import { arena } from '../../src/sim/harness';
import { stageFrame } from '../../src/stages';
import { DUSK, createLights } from '../../src/scene/arena/lights';
import { CrewActor } from '../../src/scene/crew/actor';
import { loadCrewModels } from '../../src/scene/crew/model';
import { crewMove } from '../../src/scene/crew/tracks';
import { FighterCache } from '../../src/scene/fighter/cache';
import { createFx } from '../../src/scene/fx';
import { Pipeline, skyEnvironment } from '../../src/scene/pipeline';

const q = new URLSearchParams(location.search), num = (k: string, d: number) => Number(q.get(k) ?? d), list = (k: string, d: string) => (q.get(k) ?? d).split(',').filter(Boolean);
const kinds = list('kinds', 'sola').filter(isCrew) as CrewKind[], costumes = list('costumes', '').map(Number), mode = q.get('mode') ?? 'sim', quality = q.get('quality') === 'low' ? 'low' : 'balanced';
const [CW, CH] = (q.get('cell') ?? '420x420').split('x').map(Number), scale = num('scale', 1), alpha = q.get('alpha') === '1', stageId = (q.get('stage') ?? 'final-destination') as StageId;
const sheet = document.getElementById('sheet') as HTMLCanvasElement, gl = document.getElementById('gl') as HTMLCanvasElement, ctx2 = sheet.getContext('2d')!;

async function main() {
  const scope = new ResourceScope(new AbortController().signal), renderer = new WebGLRenderer({ canvas: gl, antialias: false, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(scale); renderer.setSize(CW, CH, false); renderer.setClearColor(0x000000, 0);
  const pipe = new Pipeline(renderer, quality); pipe.alpha = alpha;
  const scene = new Scene(), camera = new PerspectiveCamera(30, CW / CH, .1, 400), cache = scope.own(new FighterCache()), fx = createFx(scene, scope, { hdr: true });
  if (alpha) document.documentElement.style.background = document.body.style.background = 'transparent';
  const lights = createLights(scene, DUSK, quality), env = skyEnvironment(renderer, DUSK.env.top, DUSK.env.horizon, DUSK.env.ground, { dir: DUSK.key.dir, color: DUSK.key.color }); scene.environment = env.texture;
  lights.key.intensity *= num('key', 1); lights.rim.intensity *= num('rim', 1);
  if (!alpha) scene.background = new Color('#232a44');
  const frame0 = stageFrame(stageId, 0, false), floorY = frame0.blocks[0].top;
  if (q.get('floor') !== '0' && !alpha) {
    const floor = new Mesh(new PlaneGeometry(80, 12).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: '#59607a', roughness: .92 })); floor.position.y = floorY; floor.receiveShadow = true; scene.add(floor);
    const wall = new Mesh(new PlaneGeometry(80, 40), new MeshStandardMaterial({ color: '#2a3152', roughness: 1 })); wall.position.set(0, floorY + 20, -6); scene.add(wall);
  }
  const models = await loadCrewModels([...new Set(kinds)], scope.signal);
  const base = (i: number, kind: CrewKind): FighterView => ({ id: `p${i}`, name: `P${i + 1}`, color: ['#ff5748', '#28c6e7', '#78d955', '#ffd24a'][i % 4], fighter: kind, costume: costumes[i] ?? 0, team: null, cpu: null, connected: true,
    x: 0, y: floorY, vx: 0, vy: 0, facing: 1, grounded: true, state: 'idle', stateFrame: 0, move: null, moveFrame: 0, charge: 0, hitlag: 0, damage: 0, stocks: 3, kos: 0, falls: 0, shield: 100, jumpsLeft: 1, intangible: false, armored: false, launch: 0, combo: 0 });
  const actors = kinds.map((kind, i) => { const a = new CrewActor({ view: base(i, kind), model: models.get(kind)!, def: CREW_DEFS[kind], cache, quality }); scene.add(a.group); return a; });
  const hitMat = new MeshBasicMaterial({ color: '#ff3355', transparent: true, opacity: .32, depthTest: false }), hitGeo = new SphereGeometry(1, 20, 12), hitPool: Mesh[] = [];
  const showHits = (views: readonly FighterView[]) => {
    const hits = q.get('hits') === '0' ? [] : views.flatMap(v => v.hits ?? []);
    while (hitPool.length < hits.length) { const m = new Mesh(hitGeo, hitMat); m.renderOrder = 50; scene.add(m); hitPool.push(m); }
    hitPool.forEach((m, i) => { const h = hits[i]; m.visible = !!h; if (h) { m.position.set(h.x, h.y, .6); m.scale.setScalar(h.r); } });
  };
  const cells: { label: string; draw(): void }[] = [];
  const cam = (cx: number, cy: number, halfH: number, yaw = 0, pitch = .06) => {
    const d = halfH / Math.tan(15 * Math.PI / 180); camera.position.set(cx + Math.sin(yaw) * d, cy + d * pitch, Math.cos(yaw) * d); camera.lookAt(cx, cy, 0); camera.updateMatrixWorld();
    lights.key.position.set(cx + DUSK.key.dir[0] * 30, cy + DUSK.key.dir[1] * 30, DUSK.key.dir[2] * 30); lights.key.target.position.set(cx, cy, 0); lights.key.target.updateMatrixWorld();
  };
  const [camX, camY, camH] = list('cam', `0,${floorY + 1},1.5`).map(Number), follow = q.get('follow');

  if (mode === 'sim') {
    // A match with one fighter is over at once, so a lone subject gets an unseen sparring partner parked at the far edge.
    const solo = kinds.length === 1, a = arena({ fighters: solo ? [kinds[0], kinds[0]] : kinds, stage: stageId }); if (solo) a.place(1, frame0.blocks[0].right - .4, { facing: -1 });
    const script = (q.get('do') ?? '').split(';').filter(Boolean).map(s => { const m = /^(\d+):(\d+)\.(\w+)\((.*)\)$/.exec(s.trim()); if (!m) throw new Error('Bad step ' + s); return { tick: +m[1], i: +m[2], verb: m[3], args: m[4].split(',').map(x => x.trim()) }; });
    const ticks = list('ticks', '0').map(Number), last = Math.max(...ticks), seen = new Set<number>(); let prev: FighterView[] = [];
    for (let t = 0; t <= last; t++) {
      for (const s of script.filter(s => s.tick === t)) {
        const n = (k: number, d = 0) => (s.args[k] === undefined || s.args[k] === '' ? d : Number(s.args[k]));
        if (s.verb === 'place') { const f = a.place(s.i, n(0), { facing: (n(1, 1) >= 0 ? 1 : -1) }); if (s.args[2]) { f.y = floorY + n(2); f.grounded = false; f.ground = null; f.state = 'air'; } }
        else if (s.verb === 'hold') { const b = (s.args[2] ?? '').split('+'); a.hold(s.i, { x: n(0), y: n(1), attack: b.includes('attack'), special: b.includes('special'), jump: b.includes('jump'), shield: b.includes('shield'), smash: b.includes('smash') }); }
        else if (s.verb === 'press') a.press(s.i, s.args[0] as 'attack', { x: n(1), y: n(2) });
        else if (s.verb === 'dmg') a.f(s.i).damage = n(0);
        else if (s.verb === 'free') a.hold(s.i, { x: 0, y: 0, attack: false, special: false, jump: false, shield: false, smash: false });
      }
      if (t > 0) a.tick();
      const view = a.view();
      for (const e of view.events) if (!seen.has(e.id)) { seen.add(e.id); fx.event(e, view); }
      view.fighters.forEach((f, i) => actors[i]?.update(f, prev[i], { dt: t ? 1 / 60 : 0, seconds: t / 60, reduced: false, cameraDistance: 14, platforms: [...frame0.blocks, ...frame0.platforms] }));
      fx.projectiles(view.projectiles, t / 60); fx.update(t ? 1 / 60 : 0, false); prev = view.fighters;
      if (ticks.includes(t)) {
        const f = view.fighters[follow ? Number(follow) : 0], label = `t${t} ${view.fighters.map(v => `${v.move ?? v.state}${v.move ? ':' + v.moveFrame : ''}${v.hitlag ? ' lag' + v.hitlag : ''} ${Math.round(v.damage)}%`).join(' | ')}`;
        showHits(view.fighters); cam(follow ? f.x : camX, follow ? f.y + 1 : camY, camH); pipe.render(scene, camera); cells.push(snapshot(label));
      }
    }
  } else {
    const kind = kinds[0], def = CREW_DEFS[kind], name = q.get('clip') ?? 'idle', move = q.get('move') as MoveId | null, m = move ? crewMove(def, move, q.get('phase') ?? undefined, q.get('air') !== '1') : undefined;
    const clip = m?.clip ?? def.states[name as StateClip], frames = mode === 'turn' ? [num('frame', 0)] : list('frames', String(num('frame', 0))).map(Number), yaws = mode === 'turn' ? list('yaws', '20,90,160,250').map(Number) : [num('yaw', 0)];
    console.log('clip length', clipEnd(clip));
    for (const costume of mode === 'pose' && costumes.length ? costumes : [costumes[0] ?? 0]) for (const f of frames) for (const yaw of yaws) {
      // Warm the springs by walking up to the frame, then view from the asked angle (yaw 0 looks at the fighter's front).
      for (let k = Math.max(0, f - 30); k <= f; k++) actors[0].update({ ...base(0, kind), costume, facing: 1 }, undefined, { dt: 1 / 60, seconds: k / 60, reduced: false, cameraDistance: 14, platforms: alpha ? [] : [...frame0.blocks], pose: sample(clip, k) } as never);   // no floor under a cut-out: no ring, no shadow
      actors[0].group.rotation.y = 0; actors[0].group.updateMatrixWorld(true);
      cam(camX, camY, camH, yaw * Math.PI / 180, num('pitch', .06)); showHits([]); pipe.render(scene, camera); cells.push(snapshot(mode === 'turn' ? `${name} yaw ${yaw}` : `${move ?? name} f${f}`));
    }
  }
  const cols = Math.min(cells.length, num('cols', 6)), rows = Math.ceil(cells.length / cols), pad = alpha ? 0 : 18;
  sheet.width = cols * CW * scale; sheet.height = rows * (CH + pad) * scale; sheet.style.width = `${cols * CW}px`; sheet.style.height = `${rows * (CH + pad)}px`;
  if (!alpha) { ctx2.fillStyle = '#10131f'; ctx2.fillRect(0, 0, sheet.width, sheet.height); }
  cells.forEach((c, i) => { ctx2.save(); ctx2.translate((i % cols) * CW * scale, Math.floor(i / cols) * (CH + pad) * scale); c.draw(); if (!alpha) { ctx2.fillStyle = '#cfd6ff'; ctx2.font = `${11 * scale}px system-ui`; ctx2.fillText(c.label, 6 * scale, (CH + 13) * scale); } ctx2.restore(); });
  document.title = `${FIGHTERS[kinds[0]].name} lab`; document.body.dataset.ready = '1';

  function snapshot(label: string) { const copy = document.createElement('canvas'); copy.width = gl.width; copy.height = gl.height; copy.getContext('2d')!.drawImage(gl, 0, 0); return { label, draw: () => ctx2.drawImage(copy, 0, 0) }; }
}
main().catch(e => { console.error(e); document.body.dataset.error = String(e?.stack ?? e); });
