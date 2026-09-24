/* Dev-only harness for the actors renderer (not part of the platform build). A minimal three.js scene
 * (sky, sun, ground, the real track ribbon) with karts driven by scripted RacerPoses so every effect can
 * be triggered on demand. Open /games/kart-party/actors.html?scene=showcase|drive|items|respawn|finish
 * &split=1|2&q=0|1|2&t=<seconds offset>&cam=side|chase|box|front|face|blast&kart=zoomer|bolt|tank&focus=<racer>&tier=0-3&stop=<t: freeze time for stills>. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createActors } from '../src/render/actors';
import { kartAssets, loadKartAssets } from '../src/render/assets';
import type { FrameInput, QualityTier, RacerPose, Viewport } from '../src/render/types';
import { rules } from '../src/server';
import { pointAt, sampleAt } from '../src/sim/track';
import { kartFromView, toRaceView } from '../src/sim/view';
import { getTrack } from '../src/tracks/index';
import type { Entity, KartBodyId, KartState, RaceEvent, RaceView, TrackId } from '../src/sim/types';

const q = new URLSearchParams(location.search), sceneName = q.get('scene') ?? 'showcase', split = Number(q.get('split') ?? 1), quality = Number(q.get('q') ?? 0) as QualityTier;
const offset = Number(q.get('t') ?? 0), stop = Number(q.get('stop') ?? Infinity), camMode = q.get('cam') ?? (sceneName === 'items' ? 'box' : split > 1 ? 'chase' : 'side');
const track = getTrack((q.get('track') ?? 'palm-bay') as TrackId), n = track.samples.length;
const canvas = document.getElementById('c') as HTMLCanvasElement, hud = document.getElementById('hud')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = quality < 2; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.setScissorTest(true);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff); scene.fog = new THREE.Fog(0x9fd8ff, 80, 420);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .6;
scene.add(new THREE.HemisphereLight(0xcfeaff, 0x8a7a5a, 1.1));
const sun = new THREE.DirectionalLight(0xfff1d8, 2.6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .03;
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
scene.add(sun, sun.target);
// Ground + track ribbon (road with white edges) so karts sit on the real course geometry.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0xe3cf98, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -.05; ground.receiveShadow = true; scene.add(ground);
{
  const pos: number[] = [], col: number[] = [], idx: number[] = [], road = new THREE.Color(0x4a4d55), edge = new THREE.Color(0xf4f4f4), apron = new THREE.Color(0xc9b27c);
  const lanes = [[-1, apron, 7], [-1, edge, 0], [-1, road, -.6], [1, road, -.6], [1, edge, 0], [1, apron, 7]] as const;
  for (let i = 0; i <= n; i++) {
    const s = track.samples[i % n];
    for (const [side, c, extra] of lanes) {
      const lat = side * (s.halfWidth + extra), y = s.y - Math.max(-s.halfWidth, Math.min(s.halfWidth, lat)) * Math.tan(s.bank) + .01;
      pos.push(s.x + s.rx * lat, y, s.z + s.rz * lat); col.push(c.r, c.g, c.b);
    }
    if (i < n) for (let l = 0; l < lanes.length - 1; l++) { const a = i * lanes.length + l, b = a + lanes.length; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const ribbon = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, side: THREE.DoubleSide })); ribbon.receiveShadow = true; scene.add(ribbon);
}

// Race + poses.
const kartParam = q.get('kart') as KartBodyId | null;
const players = [{ id: 'p0', name: 'You', color: '#ff5748', lobbyChoice: { character: Number(q.get('char') ?? 1), kart: kartParam ?? 'zoomer' } }, { id: 'p1', name: 'Player 2', color: '#28c6e7' }];
const race = rules.create({ roomId: 'dev', roundId: 'dev', players, seed: 3, nowMs: 0 }, rules.validateSettings({ gridSize: 8, track: track.def.id }));
race.racers.forEach((r, i) => { r.character = i; if (kartParam) r.kart = kartParam; else r.kart = (['zoomer', 'bolt', 'tank'] as const)[i % 3]; r.color = ['#ff5748', '#28c6e7', '#78d955', '#b58aff', '#ffc53a', '#ff7ac8', '#38e0c0', '#ffffff'][i]; });
race.phase = 'racing'; race.time = 10;
const view: RaceView = toRaceView(race);
const poses = new Map<string, RacerPose>(view.racers.map(r => [r.id, { view: r, kart: kartFromView(r) }]));
const ids = view.racers.map(r => r.id);
let serial = 0;
const events: RaceEvent[] = [];
const fire = (type: RaceEvent['type'], racer: string, extra: Partial<RaceEvent> = {}) => events.push({ id: ++serial, t: 0, type, racer, ...extra });

function place(k: KartState, d: number, lat: number, speed: number, yaw = 0) {
  const s = sampleAt(track, d), p = pointAt(track, d, lat);
  k.x = p.x; k.y = p.y; k.z = p.z; k.d = s.d; k.lateral = lat; k.heading = s.heading + yaw; k.hint = Math.round(s.d / track.spacing) % n;
  k.vx = Math.sin(s.heading) * speed; k.vz = Math.cos(s.heading) * speed; k.vy = 0; k.grounded = true; k.surface = 'road';
}
const reset = (k: KartState) => { Object.assign(k, { drift: 0, driftTier: 0, driftCharge: 0, boostT: 0, boostPower: 0, starT: 0, shieldT: 0, shockT: 0, inkT: 0, spinT: 0, tumbleT: 0, respawnT: 0, invulnT: 0, slipCharge: 0, slipT: 0, steer: 0 }); };
const cyc = (t: number, period: number) => ((t % period) + period) % period;
const edge = (t: number, dt: number, period: number, at = 0) => { const a = cyc(t - dt - at, period), b = cyc(t - at, period); return b < a; };

let entities: Entity[] = [];
function script(t: number, dt: number) {
  const base = 40 + t * 20;                          // formation distance along the lap
  entities = [];
  ids.forEach((id, i) => {
    const pose = poses.get(id)!, k = pose.kart; reset(k); pose.view.finishTime = null; pose.view.trailing = false; pose.view.item = null;
    if (sceneName === 'showcase' || sceneName === 'drive') {
      const row = Math.floor(i / 2), side = i % 2 ? 1 : -1, d = base - row * 7.5, lat = side * 3.4;
      const turn = sceneName === 'drive' ? Math.sin(t * .8 + i) : 0;
      place(k, d, lat + turn * 2, 22);
      switch (i) {
        case 0: place(k, d, lat, 22, -.18); k.drift = 1; k.steer = .6; k.driftTier = (q.has('tier') ? Number(q.get('tier')) : Math.min(3, Math.floor(cyc(t, 4)))) as 0 | 1 | 2 | 3;
          if (edge(t, dt, 4, 3.99)) fire('mini-turbo', id, { value: 3 });
          break;
        case 1: place(k, d, lat, 22, .18); k.drift = -1; k.driftTier = 2; k.steer = -.5; break;
        case 2: k.boostT = 1; k.boostPower = .35; k.slipCharge = 1; if (edge(t, dt, 3)) fire('boost-pad', id); break;
        case 3: k.starT = 5; break;
        case 4: k.shieldT = 8; pose.view.trailing = true; pose.view.item = 'bouncer'; if (edge(t, dt, 5, 4.5)) fire('shield-pop', id); break;
        case 5: k.shockT = 3 - cyc(t, 3); break;
        case 6: { const c = cyc(t, 2.5); if (c < 1.4) { k.tumbleT = 1.4 - c; k.grounded = false; k.y += Math.max(0, 6 * c - 14 * c * c) ; } if (edge(t, dt, 2.5)) fire('hit', id); break; }
        case 7: { const c = cyc(t, 2); if (c < 1) k.spinT = 1 - c; k.inkT = 3; pose.view.trailing = true; pose.view.item = 'peel'; break; }
      }
      // periodic hops
      if (i === 2) { const c = cyc(t, 1.7); if (c < .5) { k.grounded = false; k.y += 4.2 * c - 8.4 * c * c; k.vy = 4.2 - 16.8 * c; } }
    } else if (sceneName === 'items') {
      place(k, 260 + i * 3, -5 + (i % 3) * 5, 0);
    } else if (sceneName === 'respawn') {
      const c = cyc(t, 3.4), d = 120 + i * 9;
      place(k, d, (i % 2 ? 1 : -1) * 3, i ? 18 : 0);
      if (i === 0) { k.lastSafeD = d + 30; if (c < 1.6) { k.respawnT = 1.6 - c; k.y -= 6; } else if (c < 2.8) { place(k, d + 30, sampleAt(track, d + 30).line, 10); k.invulnT = 2.8 - c; } else place(k, d + 30, sampleAt(track, d + 30).line, 10); }
    } else if (sceneName === 'finish') {
      place(k, 30 + i * 6, (i % 2 ? 1 : -1) * 3, 8);
      pose.view.finishTime = 60 + i;
      if (edge(t, dt, 4)) fire('finish', id, { value: i + 1 });
    }
    pose.view.rank = i + 1;
  });
  if (sceneName === 'items') {
    const row = track.boxes.filter(b => Math.abs(b.d - track.boxes[4].d) < 1), start = track.boxes.indexOf(row[0]);
    view.boxes = track.boxes.map((_, i) => { const c = cyc(t + i * .7, 3.2); return i >= start && i < start + row.length && c > 1.2 && c < 2.6 ? 2.6 - c : 0; });
    const b0 = track.boxes[start], s = sampleAt(track, b0.d + 14), right = (lat: number, dd = 14) => pointAt(track, b0.d + dd, lat);
    const e = (id: number, kind: Entity['kind'], x: number, y: number, z: number, vx = 0, vz = 0, fuse = 0): Entity => ({ id, kind, owner: 'cpu-0', x, y, z, vx, vy: 0, vz, t: 0, hint: -1, d: 0, target: null, bounces: 0, fuse });
    const p1 = right(-4), p2 = right(4 * Math.sin(t * 2), 18 + cyc(t * 20, 30)), p3 = right(0, 30 - cyc(t * 16, 26)), p4 = right(3, 24);
    entities.push(e(1, 'peel', p1.x, p1.y, p1.z), e(2, 'bouncer', p2.x, p2.y, p2.z, Math.sin(s.heading) * 40, Math.cos(s.heading) * 40), e(3, 'seeker', p3.x, p3.y + .2, p3.z, -Math.sin(s.heading) * 30, -Math.cos(s.heading) * 30));
    const bc = cyc(t, 3); if (bc < 2.6) entities.push(e(4, 'bomb', p4.x, p4.y + Math.max(0, 5 * bc - 6 * bc * bc), p4.z, 0, 0, Math.max(.05, 2.4 - bc)));
    if (bc >= 2.6 && bc < 2.9) entities.push(e(6, 'blast', p4.x, p4.y, p4.z));
    const cc = cyc(t, 4), p5 = right(-2, -30 + cc * 60);
    entities.push(e(5, 'comet', p5.x, p5.y + 1.5, p5.z, Math.sin(s.heading) * 60, Math.cos(s.heading) * 60));
    void s;
  }
  view.entities = entities;
}

const assets = q.has('noglb') ? kartAssets(null, null) : await loadKartAssets(new AbortController().signal);   // noglb: primitive fallbacks
const actors = createActors({ track, scene, assets, quality });
const cams = [new THREE.PerspectiveCamera(68, 1, .1, 1500), new THREE.PerspectiveCamera(68, 1, .1, 1500)];
const focus = ids[Number(q.get('focus') ?? 0)] ?? ids[0];
const viewports: Viewport[] = split > 1 ? [{ rect: { x: 0, y: 0, w: 1, h: .5 }, racerId: focus, kind: 'chase' }, { rect: { x: 0, y: .5, w: 1, h: .5 }, racerId: ids[2], kind: 'chase' }] : [{ rect: { x: 0, y: 0, w: 1, h: 1 }, racerId: focus, kind: 'chase' }];
const t0 = performance.now();
let last = t0, frames = 0;
function aim(cam: THREE.PerspectiveCamera, racerId: string, t: number) {
  const k = poses.get(racerId)!.kart, fx = Math.sin(k.heading), fz = Math.cos(k.heading), s = sampleAt(track, k.d);
  const cue = actors.cues(racerId);
  cam.fov = 68 + cue.fovKick; cam.updateProjectionMatrix();
  const sh = cue.shake * .35, jx = (Math.random() - .5) * sh, jy = (Math.random() - .5) * sh;
  if (camMode === 'chase') { cam.position.set(k.x - fx * 6.5 + jx, k.y + 2.6 + jy, k.z - fz * 6.5); cam.lookAt(k.x + fx * 6, k.y + .8, k.z + fz * 6); }
  else if (camMode === 'box') { const b = track.boxes[4], p = pointAt(track, b.d + 34, 9); cam.position.set(p.x, p.y + 5, p.z); cam.lookAt(b.x, b.y + 1, b.z); void s; }
  else if (camMode === 'orbit') {   // follows the drawn kart (not the sim pose), e.g. while the drone carries it
    const root = actors.group.getObjectByName(`racer:${racerId}`)!, p = root.position, a = Number(q.get('yaw') ?? 2.2) + s.heading;
    cam.position.set(p.x + Math.sin(a) * 8, p.y + 3.5, p.z + Math.cos(a) * 8); cam.lookAt(p.x, p.y + 1.6, p.z);
  }
  else if (camMode === 'blast') { const b = track.boxes[4], p = pointAt(track, b.d + 50, -6), c = pointAt(track, b.d + 20, 2); cam.position.set(p.x, p.y + 4, p.z); cam.lookAt(c.x, c.y + 2, c.z); }
  else if (camMode === 'face') { cam.position.set(k.x + fx * 3.4 - s.rx * 1.2, k.y + 1.7, k.z + fz * 3.4 - s.rz * 1.2); cam.lookAt(k.x, k.y + 1.2, k.z); }
  else if (camMode === 'front') { cam.position.set(k.x + fx * 7 - s.rx * 3, k.y + 2.2, k.z + fz * 7 - s.rz * 3); cam.lookAt(k.x, k.y + .9, k.z); }
  else { const mid = sampleAt(track, 40 + t * 20 - 12), p = pointAt(track, mid.d + 6, -19); cam.position.set(p.x, p.y + 6.5, p.z); const c = pointAt(track, mid.d, 0); cam.lookAt(c.x, c.y + 1, c.z); }
  sun.position.set(k.x + 30, k.y + 60, k.z + 20); sun.target.position.set(k.x, k.y, k.z);
}
function frame(now: number) {
  const raw = offset + (now - t0) / 1000, t = Math.min(raw, stop), dt = raw > stop ? 0 : Math.min(.1, (now - last) / 1000); last = now;
  script(t, dt);
  const input: FrameInput = { race: view, poses, viewports, quality, reducedMotion: false, time: t, dt, newEvents: events.splice(0) };
  actors.update(input);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * renderer.getPixelRatio())) renderer.setSize(W, H, false);
  viewports.forEach((vp, i) => {
    const cam = cams[i], x = vp.rect.x * W, y = (1 - vp.rect.y - vp.rect.h) * H, w = vp.rect.w * W, h = vp.rect.h * H;
    cam.aspect = w / h; aim(cam, vp.racerId!, t);
    renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h);
    actors.beforeViewport(vp.racerId, cam);
    renderer.render(scene, cam);
  });
  frames++;
  if (frames % 15 === 0) hud.textContent = `${sceneName} t=${t.toFixed(1)} q=${quality} calls=${renderer.info.render.calls} tris=${renderer.info.render.triangles} glb=${!!assets.karts}/${!!assets.props}`;
  (window as unknown as { __kart: { ready: boolean } }).__kart = { ready: frames > 2 };
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __actors: unknown }).__actors = { actors, poses, view, renderer };
