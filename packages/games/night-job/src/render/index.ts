/* Night Job TV renderer: builds the scene once per round and presents interpolated snapshots. Lazy-loaded by
 * scene.tsx so phones never download three.js. */
import { Color, DirectionalLight, Group, HemisphereLight, PerspectiveCamera, Scene, type WebGLRenderer } from 'three';
import { mountThreeScene, type SceneMetrics } from '../../../../party-3d/src/index';
import { SnapshotBuffer, type ResourceScope } from '../../../../party-runtime/src/index';
import type { SceneViewProps } from '../../../../party-ui/src/index';
import { buildGrid, sightPolygon, type Grid } from '../geometry';
import { getMap } from '../maps';
import { RADIUS, type Point, type Settings, type View } from '../model';
import { ACTOR_SCALE, createActors } from './actors';
import { createEffects } from './effects';
import { createFog, paintLight } from './fog';
import { createPoses } from './interp';
import { loadKit } from './kit';
import { createOverlay } from './overlay';
import { createWorld } from './world';

const FOV = 30, TILT = 15 * Math.PI / 180, MIN_TILES = 14, MARGIN = 1;
type Props = SceneViewProps<Settings, View, null>;

export async function mountNightJob(canvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement, live: () => Props, scope: ResourceScope) {
  const fonts = Promise.all(["32px 'Lilita One'", '800 16px Nunito'].map(f => document.fonts.load(f)));
  const [kit] = await Promise.all([loadKit(scope), Promise.race([fonts, new Promise(r => setTimeout(r, 1500))]).catch(() => undefined)]);
  scope.signal.throwIfAborted();
  const first = live(), map = getMap(first.publicView?.mission ?? first.settings?.mission ?? 'velvet');
  const scene = new Scene(), camera = new PerspectiveCamera(FOV, 16 / 9, 1, 300), fog = createFog(map, scope, paintLight(map, scope));
  scene.background = new Color('#040816');
  const hemi = new HemisphereLight('#dfe6ff', '#3a2c26', 1.5), sun = new DirectionalLight('#fff0d8', 1.6); sun.position.set(-5, 14, 8);
  const coneRoot = new Group(), world = createWorld(map, kit, fog, scope), actors = createActors(kit, fog, scope, coneRoot, map.objectiveKind), effects = createEffects(scope);
  scene.add(hemi, sun, world.root, coneRoot, actors.root, effects.root);
  scope.defer(() => scene.clear());
  const overlay = createOverlay(overlayCanvas), poses = createPoses(), reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const buffer = new SnapshotBuffer<View>(100, 32, { adaptive: { minMs: 75, maxMs: 150 }, monotonic: true, resetGapMs: 500 });
  scope.listen(document, 'visibilitychange', () => { if (document.hidden) buffer.clear(); });

  let grid: Grid = buildGrid(map, '', []), gridDoors = '', gridBroken = 0, gridVersion = 0;
  let heist: string | null = null, lastTime: number | null = null, lastDt = 0, reduced = reducedQuery.matches, frameNo = 0;
  let cssW = 1, cssH = 1, hudTop = 0, hudBottom = 0, establish = 0, framed = false;
  const cam = { x: map.width / 2, z: map.height / 2, h: map.height }, goal = { ...cam }, sight = { key: NaN, origins: [] as Point[] };
  scene.onBeforeRender = (renderer: WebGLRenderer) => fog.render(renderer, lastDt, reduced);

  /* Exact band framing for a tilted perspective camera. A ground point Δ tiles toward the camera from the look
   * target projects at tan = −Δ·cosθ / (d − Δ·sinθ); solving for the band's top and bottom edges gives the camera
   * distance per tile of visible depth and where the look target sits relative to the framed region. */
  const lens = { dPerH: 1, near: 1, widthPerH: 1 };
  function measureLens() {
    const tan = Math.tan(FOV * Math.PI / 360), s = Math.sin(TILT), c = Math.cos(TILT), top = (1 - 2 * hudTop / cssH) * tan, bottom = (-1 + 2 * hudBottom / cssH) * tan;
    const far = top / (top * s - c), near = bottom / (bottom * s - c);
    lens.dPerH = 1 / Math.max(.05, near - far); lens.near = near; lens.widthPerH = 2 * lens.dPerH * (1 - near * s) * (cssW / cssH) * tan;
  }
  /** Centre and visible depth (tiles) that frame every active thief, clamped to the map. */
  function target(view: View | null) {
    const whole = Math.max(map.height + MARGIN * 2, (map.width + MARGIN * 2) / lens.widthPerH);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of view?.players ?? []) { const q = poses.poses.get(p.id); if (p.suspended || !q) continue; x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.y); z1 = Math.max(z1, q.y); }
    if (x0 > x1) { goal.x = map.width / 2; goal.z = map.height / 2; goal.h = whole; return goal; }
    const h = Math.min(whole, Math.max(MIN_TILES, z1 - z0 + 6, (x1 - x0 + 7) / lens.widthPerH)), hw = h * lens.widthPerH / 2;
    const clamp = (v: number, half: number, size: number) => size + MARGIN * 2 <= half * 2 ? size / 2 : Math.max(half - MARGIN, Math.min(size + MARGIN - half, v));
    goal.x = clamp((x0 + x1) / 2, hw, map.width); goal.z = clamp((z0 + z1) / 2, h / 2, map.height); goal.h = h; return goal;
  }

  function sightUpdate(view: View, now: number) {
    let key = gridVersion * 7919, n = 0, moved = false;
    for (const s of view.smoke) if (s.until > now) key += s.born % 100000 + 17;
    for (const p of view.players) { if (p.suspended) continue; const q = poses.poses.get(p.id) ?? p, o = sight.origins[n++]; if (!o || Math.abs(o.x - q.x) + Math.abs(o.y - q.y) > .02) moved = true; }
    if (!moved && key === sight.key && n === sight.origins.length) return;
    sight.key = key; sight.origins = view.players.filter(p => !p.suspended).map(p => { const q = poses.poses.get(p.id) ?? p; return { x: q.x, y: q.y }; });
    fog.setSight(sight.origins.map(origin => ({ origin, points: sightPolygon(grid, origin, RADIUS.crewSight, view.smoke, now) })));
  }

  const hud = () => {
    const stage = canvas.closest<HTMLElement>('.kp-scene-stage'); if (!stage) return;
    const read = (name: string) => parseFloat(stage.style.getPropertyValue(name) || getComputedStyle(stage).getPropertyValue(name)) || 0;
    hudTop = read('--nj-hud-top'); hudBottom = read('--nj-hud-bottom'); canvas.dataset.band = `${hudTop} ${hudBottom} ${cssH} ${cam.h.toFixed(1)}`;
  };

  mountThreeScene(canvas, {
    signal: scope.signal, scene, camera,
    resize(aspect) {
      const box = canvas.getBoundingClientRect(); cssW = box.width; cssH = box.height;
      camera.aspect = aspect; camera.updateProjectionMatrix(); overlay.resize(cssW, cssH, Math.min(devicePixelRatio || 1, 2)); hud(); measureLens();
    },
    frame(nowMs, dt) {
      const p = live(), raw = p.publicView, t = nowMs / 1000;
      reduced = reducedQuery.matches; lastDt = dt; if (++frameNo % 20 === 0) { hud(); measureLens(); }
      if (raw) {
        if (raw.heistId !== heist) { heist = raw.heistId; buffer.clear(); poses.clear(); framed = false; }
        if (p.snapshotTime !== null && p.snapshotTime !== lastTime) { lastTime = p.snapshotTime; buffer.push(p.snapshotTime, raw, nowMs); }
      }
      const view = raw ? poses.sample(blend => buffer.sample(p.serverNowMs(), blend), raw) : null, now = view ? poses.now : p.serverNowMs();
      if (view && (view.doors !== gridDoors || view.broken.length !== gridBroken)) { gridDoors = view.doors; gridBroken = view.broken.length; grid = buildGrid(map, view.doors, view.broken); gridVersion++; }
      if (view) sightUpdate(view, now);
      let intel: Set<string> | null = null;
      for (const i of view?.intel ?? []) if (i.kind === 'camera' || i.kind === 'laser') for (const o of map.objects) if ((o.kind === 'camera' || o.kind === 'laser') && Math.abs(o.x - i.x) + Math.abs(o.y - i.y) < 1) (intel ??= new Set()).add(o.id);
      world.sync(view, grid, now, dt, reduced, intel ?? EMPTY);
      // Actors grow as the camera pulls back so a thief stays findable when the crew splits up.
      const scale = ACTOR_SCALE * Math.min(1.4, Math.max(1, Math.sqrt(cam.h / MIN_TILES)));
      actors.sync(view, poses.poses, grid, gridVersion, now, t, dt, reduced, scale);
      const shake = effects.sync(view, now, t, dt, reduced, camera.quaternion);
      const alarm = !!view?.alarm && view.alarm.until > now;
      fog.shared.njAlarm.value += ((alarm ? (reduced ? .12 : .09 + .04 * Math.sin(t * 7)) : 0) - fog.shared.njAlarm.value) * Math.min(1, dt * 8);

      // Camera: frame the crew inside the HUD band; a slow establishing push-in when a heist starts.
      if (view && !framed) { framed = true; establish = reduced ? 0 : 2.8; Object.assign(cam, target(null)); }
      target(view); establish = Math.max(0, establish - dt);
      const k = 1 - Math.exp(-dt * (establish > 0 ? .9 : reduced ? 6 : 2.4));
      cam.x += (goal.x - cam.x) * k; cam.z += (goal.z - cam.z) * k; cam.h += (goal.h - cam.h) * k;
      const d = cam.h * lens.dPerH, tz = cam.z + cam.h / 2 - lens.near * d, sx = shake * Math.sin(t * 47), sz = shake * Math.cos(t * 39);
      camera.position.set(cam.x + sx, Math.cos(TILT) * d, tz + Math.sin(TILT) * d + sz);
      camera.near = d * .3; camera.far = d * 3; camera.updateProjectionMatrix(); camera.lookAt(cam.x + sx, 0, tz + sz);
      overlay.draw(view, map, camera, poses.poses, now, t, reduced, (cssH - hudTop - hudBottom) / cam.h, scale);
    },
    onReady: () => { canvas.dataset.kit = kit.source.glb.length ? `glb:${kit.source.glb.length} procedural:${kit.source.procedural.length}` : 'procedural'; live().onReady(); },
    onError: error => live().onError(error),
    onMetrics: (m: SceneMetrics) => { canvas.dataset.metrics = JSON.stringify(m); canvas.dataset.procedural = kit.source.procedural.join(' '); },
  });
}
const EMPTY: ReadonlySet<string> = new Set();
