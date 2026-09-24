/**
 * Pose Lab: contact sheets of fighters frozen at chosen frames, rendered with the real FighterActor.
 *   ?kind=mario&sheet=states            every FighterState at a key frame
 *   ?kind=fox&sheet=moves&page=0        every move, four columns: anticipation / strike / active / follow-through
 *   ?kind=fox&sheet=moves&list=fsmash,nspecial   the same for chosen moves
 *   ?kind=kirby&sheet=poses&page=1      every Pose family on synthetic frame data
 *   ?kind=link&move=fsmash&frame=12     one frozen frame, large (&frames=10,12,14 for a strip; &phase=Loop for a special phase)
 *   ?kind=mario&live=attack:fsmash      loop one state/move in real time
 * &src=mannequin forces the procedural stand-in; &costume=2 picks a costume; &hits=0 hides the hitbox spheres. window.__poseLab = 'ready' | 'error: …'.
 */
import { AmbientLight, Box3, BoxGeometry, Color, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Scene, SphereGeometry, Vector3, WebGLRenderer } from 'three';
import { FIGHTERS, MOVE_SOURCES, POSES, type FighterKind, type FighterState, type FighterView, type LiveHit, type MoveId } from '../../src/model';
import { MOVESET, PHYSICS } from '../../src/moveset';
import { FighterActor, FighterCache, loadFighterModels, modelUrl } from '../../src/scene/fighter';
import type { MoveInfo } from '../../src/scene/fighter/animate';
import { moveInfo, overrides } from '../../src/scene/fighter/moves';
import { prepareModel, type FighterModel } from '../../src/scene/fighter/prepare';
import { drawFx, fxCells } from './fx-sheet';
import { mannequin } from './mannequin';

const q = new URLSearchParams(location.search), kind = (q.get('kind') ?? 'mario') as FighterKind, costume = Number(q.get('costume') ?? 0);
const CW = Number(q.get('cw') ?? 200), CH = Number(q.get('ch') ?? 250), COLS = Number(q.get('cols') ?? 8);
type Cell = { label: string; frames: number; at: (f: number) => Partial<FighterView>; ledge?: boolean; info?: MoveInfo };
const P = PHYSICS[kind], H = FIGHTERS[kind].height;

function hitsAt(move: MoveId, f: number, facing: 1 | -1, x: number, y: number): LiveHit[] {
  const w = MOVESET[kind][move]?.windows.find(w => f >= w.from && f < w.to);
  return w ? w.hitboxes.map(h => ({ x: x + facing * h.x, y: y + h.y, r: h.r, limb: h.limb ?? 'body' })) : [];
}
const moveCell = (move: MoveId, f: number, label: string, air = false, phase?: string): Cell => ({ label, frames: f, at: i => ({ state: 'attack', move, moveFrame: i, stateFrame: i, grounded: !air, y: air ? 1 : 0,
  hits: phase ? [] : hitsAt(move, i, 1, 0, air ? 1 : 0), ...(phase ? { movePhase: phase, charge: moveInfo(kind, move, phase).hold ? .7 : 0 } : {}) }) });
const st = (state: FighterState, frames: number, extra: Partial<FighterView> = {}, label: string = state): Cell => ({ label, frames, at: i => ({ state, stateFrame: i, ...extra }) });
const AIR = new Set(['nair', 'fair', 'bair', 'uair', 'dair', 'nspecialAir', 'sspecialAir', 'uspecialAir', 'dspecialAir']);

function cells(): Cell[] {
  const live = q.get('live'), move = q.get('move') as MoveId | null;
  if (move && q.get('frames')) return q.get('frames')!.split(',').map(f => moveCell(move, Number(f), `${move}${q.get('phase') ? '.' + q.get('phase') : ''} f${f}`, AIR.has(move), q.get('phase') ?? undefined));
  if (move) return [moveCell(move, Number(q.get('frame') ?? 10), `${move} f${q.get('frame') ?? 10}`, AIR.has(move))];
  if (live) return [];
  const sheet = q.get('sheet') ?? 'states', page = Number(q.get('page') ?? 0);
  if (sheet === 'states') return [
    st('idle', 20), st('idle', 45, {}, 'idle (breath)'), st('walk', 12, { vx: P.walk * .9 }, 'walk a'), st('walk', 30, { vx: P.walk * .9 }, 'walk b'),
    st('run', 4, { vx: P.run }, 'dash'), st('run', 26, { vx: P.run }, 'run a'), st('run', 38, { vx: P.run }, 'run b'), st('turn', 3, { vx: -P.run * .5 }, 'turn skid'),
    st('crouch', 10), st('teeter', 30), st('jumpsquat', 2), st('air', 4, { grounded: false, y: 1, vy: P.fullHop * .9 }, 'rise'),
    st('air', 20, { grounded: false, y: 1, vy: 0 }, 'apex'), st('air', 30, { grounded: false, y: 1, vy: -P.terminal }, 'fall'), st('air', 30, { grounded: false, y: 1, vy: -P.fastFall }, 'fast fall'),
    { label: 'air jump', frames: 10, at: i => ({ state: 'air', stateFrame: i + 30, grounded: false, y: 1, vy: .05, jumpsLeft: i < 2 ? 1 : 0 }) },
    st('land', 2), st('hitstun', 6, { vx: -.12, vy: .06, launch: .14 }, 'hit (front)'), st('hitstun', 6, { vx: .1, vy: .08, launch: .12 }, 'hit (back)'), st('tumble', 24, { grounded: false, y: 1, vx: -.15, vy: .1, launch: .2 }),
    st('shield', 8, { shield: 90 }), st('shieldstun', 3, { shield: 20 }, 'shield low'), st('dizzy', 40), st('roll', 12, { vx: .08 }),
    st('spotdodge', 8), st('airdodge', 10, { grounded: false, y: 1, vx: .06, vy: -.03 }), st('helpless', 20, { grounded: false, y: 1, vy: -.05 }),
    { label: 'ledge', frames: 20, ledge: true, at: i => ({ state: 'ledge', stateFrame: i, x: .22, y: -H * .98, facing: -1, grounded: false, ledgeSide: 1 }) },
    { label: 'ledge climb', frames: 12, ledge: true, at: i => ({ state: 'ledgeclimb', stateFrame: i, x: .22, y: -H * .7, facing: -1, grounded: false }) },
    st('grab', 10), st('grabbed', 10, { grounded: false, y: .15 }), st('thrown', 12, { grounded: false, y: 1, vx: .1, vy: .1 }),
    st('knockdown', 30), st('getup', 6, {}, 'getup a'), st('getup', 15, {}, 'getup b'), st('tech', 10), st('respawn', 30, { intangible: true }), st('idle', 20, { intangible: true }, 'intangible'),
    st('idle', 20, { charge: .8 }, 'charge glow'),
  ];
  if (sheet === 'moves') {
    const ids = (Object.keys(MOVE_SOURCES) as MoveId[]).filter(m => MOVESET[kind][m]), per = Number(q.get('per') ?? 8);
    const list = q.get('list') ? q.get('list')!.split(',') as MoveId[] : ids.slice(page * per, page * per + per);
    // Specials with several script phases (charge start / loop / release) get a row per phase.
    return list.flatMap(m => (Object.keys(MOVESET[kind][m]?.phases ?? {}).length > 1 ? Object.keys(MOVESET[kind][m]!.phases!).slice(0, 3) : [undefined]).flatMap(ph => {
      const i = moveInfo(kind, m, ph), air = AIR.has(m), n = ph ? `${m}.${ph}` : m, cap = (f: number) => Math.min(f, i.total - 1);
      return [moveCell(m, cap(Math.max(0, Math.round(i.start * .8))), `${n} wind`, air, ph), moveCell(m, cap(i.start + 1), `${n} strike`, air, ph), moveCell(m, cap(Math.round((i.start + i.end) / 2)), `${n} active`, air, ph), moveCell(m, cap(Math.round(i.end + (i.total - i.end) * .3)), `${n} follow`, air, ph)];
    }));
  }
  // Pose families on synthetic frame data (start 8, end 14, total 32).
  const per = Number(q.get('per') ?? 10), poses = POSES.slice(page * per, page * per + per);
  return poses.flatMap(pose => {
    const info: MoveInfo = { pose, limb: 'handR', total: 32, start: 8, end: 14, charge: null };
    const c = (f: number, tag: string): Cell => ({ label: `${pose} ${tag}`, frames: f, info, at: i => ({ state: 'attack', move: 'jab1', moveFrame: i, stateFrame: i }) });
    return [c(6, 'wind'), c(9, 'strike'), c(12, 'active'), c(20, 'follow')];
  });
}

const base = (): FighterView => ({ id: 'p1', name: 'P1', color: FIGHTERS[kind].color, fighter: kind, costume, team: null, cpu: null, connected: true, x: 0, y: 0, vx: 0, vy: 0, facing: 1, grounded: true,
  state: 'idle', stateFrame: 0, move: null, moveFrame: 0, charge: 0, hitlag: 0, damage: 0, stocks: 4, kos: 0, falls: 0, shield: 100, jumpsLeft: 1, intangible: false, armored: false, launch: 0, combo: 0 });

async function model(): Promise<[FighterModel, string]> {
  if (q.get('src') !== 'mannequin' && modelUrl(kind)) { const m = await loadFighterModels([kind], new AbortController().signal); return [m.get(kind)!, 'glb']; }
  return [prepareModel(kind, mannequin(kind, undefined, { sword: ['link', 'young-link', 'marth', 'roy'].includes(kind), scarf: true }), []), 'mannequin'];
}

async function main() {
  if (q.get('fx')) {
    const list = fxCells(), rows = Math.ceil(list.length / COLS), renderer = new WebGLRenderer({ canvas: document.getElementById('c') as HTMLCanvasElement, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(COLS * CW, rows * CH + 28); renderer.setScissorTest(true);
    document.getElementById('title')!.textContent = 'Sky Clash FX sheet';
    drawFx(renderer, list, COLS, CW, CH);
    list.forEach((cell, i) => { const el = document.createElement('div'); el.className = 'label'; el.textContent = cell.label; el.style.left = `${(i % COLS) * CW + 4}px`; el.style.top = `${28 + Math.floor(i / COLS) * CH + 4}px`; document.body.appendChild(el); });
    (window as { __poseLab?: string }).__poseLab = 'ready';
    return;
  }
  const [m, src] = await model(), list = cells(), live = q.get('live');
  const one = !!live || (!!q.get('move') && !q.get('frames')), rows = one ? 1 : Math.ceil(list.length / COLS), cols = one ? 1 : Math.min(COLS, list.length);
  const cw = one ? 720 : CW, ch = one ? 820 : CH, top = 28;
  const renderer = new WebGLRenderer({ canvas: document.getElementById('c') as HTMLCanvasElement, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(cols * cw, rows * ch + top); renderer.setScissorTest(true);
  document.getElementById('title')!.textContent = `${FIGHTERS[kind].name} · ${q.get('sheet') ?? (live ? 'live' : 'frame')} ${q.get('page') ?? ''} · ${src} · ${m.triangles | 0} tris · slots ${m.slots.join(' ')}`;
  const scene = new Scene(); scene.background = new Color('#2a3050');
  scene.add(new HemisphereLight('#dfe8ff', '#4a3a5a', 1.2), new AmbientLight('#ffffff', .25));
  const key = new DirectionalLight('#ffffff', 2.4); key.position.set(3, 6, 8); scene.add(key);
  const rim = new DirectionalLight('#9fc4ff', 1); rim.position.set(-4, 3, -6); scene.add(rim);
  const floor = new Mesh(new BoxGeometry(6, .3, 2), new MeshStandardMaterial({ color: '#5b6a8a' })); floor.position.set(0, -.15, 0); scene.add(floor);
  const ledgeFloor = new Mesh(new BoxGeometry(3, 2, 2), new MeshStandardMaterial({ color: '#5b6a8a' })); ledgeFloor.position.set(-1.5, -1, 0); scene.add(ledgeFloor);
  const cache = new FighterCache(), actor = new FighterActor({ view: base(), model: m, cache }); scene.add(actor.group);
  const hitMat = new MeshBasicMaterial({ color: '#ff3048', transparent: true, opacity: .35, depthWrite: false }), hitGeo = new SphereGeometry(1, 16, 10);
  const hitPool: Mesh[] = [];
  const cam = new PerspectiveCamera(30, cw / ch, .05, 100);
  const floors = [{ left: -3, right: 3, y: 0 }], ledgeFloors = [{ left: -3, right: 0, top: 0 }];
  const draw = (cell: Cell, i: number, secondsBase: number) => {
    const ledge = !!cell.ledge; floor.visible = !ledge; ledgeFloor.visible = ledge;
    actor.reset();
    let view = base();
    for (let f = 0; f <= cell.frames; f++) {
      view = { ...base(), ...cell.at(f) };
      if (cell.info) patchInfo(cell.info);
      actor.update(view, undefined, { dt: f ? 1 / 60 : 0, seconds: secondsBase + f / 60, reduced: false, cameraDistance: 14, platforms: ledge ? ledgeFloors : floors });
    }
    unpatch();
    const hits = q.get('hits') === '0' ? [] : view.hits ?? [];
    hits.forEach((h, k) => { const s = hitPool[k] ?? (hitPool[k] = new Mesh(hitGeo, hitMat)); s.position.set(h.x, h.y, 0); s.scale.setScalar(h.r); s.visible = true; scene.add(s); });
    for (let k = hits.length; k < hitPool.length; k++) hitPool[k].visible = false;
    const bb = new Box3().setFromObject(actor.group), c = bb.getCenter(new Vector3()), size = bb.getSize(new Vector3());
    const span = Math.max(H * 1.25, size.y * 1.1, size.x * 1.1 * ch / cw), d = span / (2 * Math.tan(15 * Math.PI / 180));
    cam.position.set(c.x, c.y + span * .12, d); cam.lookAt(c.x, c.y, 0); cam.aspect = cw / ch; cam.updateProjectionMatrix();
    const col = i % cols, row = Math.floor(i / cols), y = (rows - 1 - row) * ch;
    renderer.setViewport(col * cw, y, cw, ch); renderer.setScissor(col * cw, y, cw, ch); renderer.render(scene, cam);
    return [col * cw, top + row * ch] as const;
  };
  if (live) {
    const [state, mv] = live.split(':') as [FighterState, MoveId | undefined];
    const total = mv ? moveInfo(kind, mv).total + 20 : 90;
    renderer.setAnimationLoop(t => {
      const f = Math.floor(t / (1000 / 60)) % total;
      draw(mv ? moveCell(mv, f, mv, AIR.has(mv)) : st(state, f, state === 'run' ? { vx: P.run } : state === 'walk' ? { vx: P.walk } : {}), 0, 0);
    });
    (window as { __poseLab?: string }).__poseLab = 'ready';
    return;
  }
  list.forEach((cell, i) => {
    const [x, y] = draw(cell, i, 1);
    const el = document.createElement('div'); el.className = 'label'; el.textContent = cell.label; el.style.left = `${x + 4}px`; el.style.top = `${y + 4}px`; document.body.appendChild(el);
  });
  (window as { __poseLab?: string }).__poseLab = 'ready';
}

// Synthetic frame data for the poses sheet: route the actor's move lookups to the cell's info.
function patchInfo(info: MoveInfo) { overrides.get = () => info; }
function unpatch() { overrides.get = null; }

main().catch(error => { console.error(error); (window as { __poseLab?: string }).__poseLab = `error: ${error?.message ?? error}`; });
