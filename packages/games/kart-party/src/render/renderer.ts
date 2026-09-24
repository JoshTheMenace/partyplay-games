/* World renderer: WebGL lifecycle, world + actors, per-viewport cameras and shadows, split-screen
 * scissoring. Modelled on party-3d's lifecycle: models load and shaders compile before the promise
 * resolves; ready() turns true only after a real, non-empty frame; context loss reports onError;
 * dispose() is idempotent. OWNER: render-world agent. */
import * as THREE from 'three';
import { getTrack } from '../tracks/index';
import type { TrackId } from '../sim/types';
import { createActors } from './actors';
import { loadKartAssets } from './assets';
import { CameraRig, type ShotViewport } from './camera';
import { viewportPixels } from './layout';
import type { FrameInput, KartRenderer, QualityTier } from './types';
import { buildWorld } from './world/world';

export type RendererOptions = { track: TrackId; signal: AbortSignal; quality: QualityTier; onError(error: unknown): void };
export type RendererStats = { calls: number; triangles: number; viewports: number; pixelRatio: number; geometries: number; textures: number; tier: QualityTier };
/** The platform-facing KartRenderer plus dev diagnostics. */
export type KartRendererExt = KartRenderer & { stats(): RendererStats };

const DIVIDER = new THREE.Color(0x0b0a14);
const SHADOW_EXTENT: Record<QualityTier, number> = { 0: 46, 1: 36, 2: 36 };

/** Resolves once models are loaded, the scene is built and shaders compiled. The first render() then draws a visible frame. */
export async function createKartRenderer(canvas: HTMLCanvasElement, options: RendererOptions): Promise<KartRendererExt> {
  const { signal } = options;
  const abort = () => new DOMException('Scene preparation aborted.', 'AbortError');
  if (signal.aborted) throw abort();
  const track = getTrack(options.track);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  let disposed = false, failed = false, readyFlag = false;
  const fail = (error: unknown) => { if (disposed || failed) return; failed = true; options.onError(error); };
  const onLost = (e: Event) => { e.preventDefault(); fail(new Error('Graphics context lost. Return to the lobby and start again.')); };
  canvas.addEventListener('webglcontextlost', onLost);
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || '', line = Number(/0:(\d+)/.exec(log)?.[1] ?? 0), src = (gl.getShaderSource(gl.getShaderInfoLog(fs) ? fs : vs) ?? '').split('\n');
    console.error('Kart shader error', log, src.slice(Math.max(0, line - 6), line + 2).join('\n'));
    fail(new Error('A shader could not compile. Try another browser.'));
  };
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setScissorTest(true); renderer.info.autoReset = true;

  let world: ReturnType<typeof buildWorld> | null = null, actors: ReturnType<typeof createActors> | null = null, envRT: THREE.WebGLRenderTarget | null = null;
  const scene = new THREE.Scene();
  const dispose = () => {
    if (disposed) return; disposed = true;
    signal.removeEventListener('abort', dispose);
    try { actors?.dispose(); } catch (e) { console.error(e); }
    world?.dispose(); envRT?.dispose();
    canvas.removeEventListener('webglcontextlost', onLost);
    renderer.dispose(); renderer.forceContextLoss();
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    const assets = await loadKartAssets(signal);
    if (signal.aborted || disposed) throw abort();
    let tier: QualityTier = options.quality;
    world = buildWorld(track, assets, tier, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
    renderer.toneMappingExposure = world.theme.exposure;
    scene.add(world.group); scene.fog = world.fog;
    world.prepare(renderer);
    const pmrem = new THREE.PMREMGenerator(renderer), envScene = world.environment();
    envRT = pmrem.fromScene(envScene, 0.015, 0.1, 100); pmrem.dispose();
    envScene.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
    scene.environment = envRT.texture; scene.environmentIntensity = world.theme.env;
    actors = createActors({ track, scene, assets, quality: tier });
    if (!actors.group.parent) scene.add(actors.group);
    const cameras: THREE.PerspectiveCamera[] = [], rigs: CameraRig[] = [];
    const cameraFor = (i: number) => {
      while (cameras.length <= i) { cameras.push(new THREE.PerspectiveCamera(68, 16 / 9, 0.3, 4200)); rigs.push(new CameraRig(track, world!.hf.heightAt)); }
      return cameras[i];
    };
    // Warm-up: compile every program from a camera on the grid.
    const warm = cameraFor(0), s0 = track.samples[track.samples.length - 20];
    warm.position.set(s0.x, s0.y + 3, s0.z); warm.lookAt(track.samples[4].x, track.samples[4].y, track.samples[4].z); warm.updateMatrixWorld();
    await renderer.compileAsync(scene, warm);
    if (signal.aborted || disposed) throw abort();

    const dev = (globalThis as { __kart?: Record<string, unknown> }).__kart;
    if (dev) { dev.scene = scene; dev.renderer = renderer; dev.THREE = THREE; dev.track = track; dev.cameras = cameras; }
    const w = world, a = actors, px = { x: 0, y: 0, w: 0, h: 0 }, focus = new THREE.Vector3(), dir = new THREE.Vector3();
    const lightRight = new THREE.Vector3(), lightUp = new THREE.Vector3();
    lightRight.crossVectors(new THREE.Vector3(0, 1, 0), w.sunDir).normalize(); lightUp.crossVectors(w.sunDir, lightRight).normalize();
    let width = 0, height = 0, ratio = 0, extent = 0; const stats: RendererStats = { calls: 0, triangles: 0, viewports: 0, pixelRatio: 1, geometries: 0, textures: 0, tier };
    const applyTier = (next: QualityTier) => {
      if (next === tier) return;
      const size = next === 0 ? 2048 : 1024;
      if (w.sun.shadow.mapSize.x !== size) { w.sun.shadow.map?.dispose(); w.sun.shadow.map = null; w.sun.shadow.mapSize.set(size, size); }
      w.sun.castShadow = next < 2; tier = next;
    };
    const fitShadow = (camera: THREE.PerspectiveCamera, overview: boolean) => {
      const e = overview ? 120 : SHADOW_EXTENT[tier];
      if (e !== extent) { const c = w.sun.shadow.camera; c.left = c.bottom = -e; c.right = c.top = e; c.updateProjectionMatrix(); extent = e; }
      camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
      focus.copy(camera.position).addScaledVector(dir, e * 0.62);
      // Snap to shadow texels in light space so edges don't shimmer as the camera moves.
      const texel = (2 * e) / w.sun.shadow.mapSize.x, r = Math.round(focus.dot(lightRight) / texel) * texel - focus.dot(lightRight), u = Math.round(focus.dot(lightUp) / texel) * texel - focus.dot(lightUp);
      focus.addScaledVector(lightRight, r).addScaledVector(lightUp, u);
      w.sun.target.position.copy(focus); w.sun.position.copy(focus).addScaledVector(w.sunDir, 130);
      w.sun.updateMatrixWorld(); w.sun.target.updateMatrixWorld();   // scene matrices update only on the first viewport
    };

    return {
      ready: () => readyFlag && !failed && !disposed,
      stats: () => stats,
      dispose,
      render(frame: FrameInput) {
        if (disposed || failed) return;
        try {
          const cw = canvas.clientWidth, ch = canvas.clientHeight;
          if (cw <= 0 || ch <= 0 || frame.viewports.length === 0) return;
          applyTier(frame.quality);
          const dpr = Math.min(window.devicePixelRatio || 1, tier === 0 ? 2 : tier === 1 ? 1.5 : 1);
          if (cw !== width || ch !== height || dpr !== ratio) { width = cw; height = ch; ratio = dpr; renderer.setPixelRatio(dpr); renderer.setSize(cw, ch, false); }
          const W = Math.round(cw * dpr), H = Math.round(ch * dpr), gutter = frame.viewports.length > 1 ? Math.max(2, Math.round(3 * dpr)) : 0;
          w.update(frame.race, frame.time, frame.newEvents, frame.moverTime);
          a.update(frame);
          renderer.setViewport(0, 0, cw, ch); renderer.setScissor(0, 0, cw, ch);
          renderer.setClearColor(DIVIDER, 1); renderer.clear();
          let calls = 0, tris = 0;
          for (let i = 0; i < frame.viewports.length; i++) {
            const vp = frame.viewports[i];
            viewportPixels(vp.rect, W, H, gutter, px);
            const camera = cameraFor(i), aspect = px.w / px.h;
            rigs[i].update(camera, vp as ShotViewport, frame.poses, frame.race, vp.racerId ? a.cues(vp.racerId) : null, frame.dt, frame.time, frame.reducedMotion, aspect);
            const fc = dev?.freeCam as { pos: number[]; look: number[]; fov: number } | null | undefined;
            if (fc && i === 0) { camera.position.fromArray(fc.pos); camera.lookAt(fc.look[0], fc.look[1], fc.look[2]); camera.fov = fc.fov; camera.updateProjectionMatrix(); }
            camera.updateMatrixWorld();
            if (w.sun.castShadow) fitShadow(camera, vp.kind === 'overview');
            a.beforeViewport(vp.racerId, camera);
            // setViewport/setScissor take CSS pixels; divide the device-pixel rect back out.
            renderer.setViewport(px.x / dpr, px.y / dpr, px.w / dpr, px.h / dpr); renderer.setScissor(px.x / dpr, px.y / dpr, px.w / dpr, px.h / dpr);
            scene.matrixWorldAutoUpdate = i === 0;   // one world-matrix pass per frame, not per viewport
            renderer.render(scene, camera);
            calls = Math.max(calls, renderer.info.render.calls); tris = Math.max(tris, renderer.info.render.triangles);
          }
          stats.calls = calls; stats.triangles = tris; stats.viewports = frame.viewports.length; stats.pixelRatio = dpr; stats.geometries = renderer.info.memory.geometries; stats.textures = renderer.info.memory.textures; stats.tier = tier;
          readyFlag = true;
        } catch (error) { fail(error); }
      },
    };
  } catch (error) { dispose(); throw error; }
}
