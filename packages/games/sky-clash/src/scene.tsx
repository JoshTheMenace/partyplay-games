import { useEffect, useRef } from 'react';
import { DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, RingGeometry, Scene, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SceneViewProps } from '../../../party-ui/src/index';
import { ResourceScope, SnapshotBuffer } from '../../../party-runtime/src/index';
import { mountThreeScene, type Quality } from '../../../party-3d/src/index';
import { FIGHTERS, ROSTER, interpolate, type Fighter, type FighterKind, type Impact, type Settings, type View } from './model';
import { getStage, spawnPoint, stageFrame, type Platform, type StageId } from './stages';
import { createStageScene } from './stage-scene';
import { Actor, makeCache } from './rig';
const FOV = 36;
// Vite sees every replacement model through the glob; each kind resolves to its hashed URL (or fails loudly if the asset is absent).
const MODEL_FILES = import.meta.glob('../assets/*-replacement.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const modelUrl = (kind: FighterKind) => MODEL_FILES[`../assets/${kind}-replacement.glb`];
const modelCache = new Map<FighterKind, Object3D>(), inflight = new Map<FighterKind, Promise<Object3D>>();
const abortable = <T,>(promise: Promise<T>, signal: AbortSignal) => new Promise<T>((resolve, reject) => {
  const abort = () => reject(new DOMException('Scene preparation aborted.', 'AbortError'));
  if (signal.aborted) return abort(); signal.addEventListener('abort', abort, { once: true });
  promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
});
/** One shared parse per kind per page; clones share the GPU geometry/materials. A failed load is forgotten so the next call retries. */
export function loadFighterModel(kind: FighterKind, signal: AbortSignal): Promise<Object3D> {
  const cached = modelCache.get(kind); if (cached) return Promise.resolve(cached);
  let pending = inflight.get(kind);
  if (!pending) {
    pending = (async () => {
      const url = modelUrl(kind); if (!url) throw new Error(`No model is bundled for ${FIGHTERS[kind].name}.`);
      const response = await fetch(url); if (!response.ok) throw new Error(`The ${FIGHTERS[kind].name} model could not be loaded (${response.status}).`);
      const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), ''); modelCache.set(kind, gltf.scene); return gltf.scene;
    })().finally(() => inflight.delete(kind));
    inflight.set(kind, pending);
  }
  return abortable(pending, signal);
}
/** Preloads the whole roster with bounded concurrency so the display is ready before the first pick can happen. */
export async function loadFighterAssets(signal: AbortSignal, concurrency = 4): Promise<void> {
  const queue = [...ROSTER];
  await Promise.all(Array.from({ length: concurrency }, async () => { while (queue.length) { const kind = queue.shift()!; await loadFighterModel(kind, signal); } }));
}
export const cachedModel = (kind: FighterKind) => modelCache.get(kind);
type Particle = { mesh: Mesh; material: MeshBasicMaterial; vx: number; vy: number; life: number; max: number; spin: number; grow: number };
/** Mirrors the server's initial roster (seats alternate these two defaults on their stage spawn points) so warmup and the first frame show real fighters. Only these kinds are warmed. */
const DEFAULT_KINDS: FighterKind[] = ['fox', 'falco'];
const defaultFighter = (player: { id: string; name: string; color: string }, index: number, count: number, stageId: StageId): Fighter => { const spawn = spawnPoint(stageId, index, count); return { ...player, kind: DEFAULT_KINDS[index % DEFAULT_KINDS.length], chosen: false, connected: true, x: spawn.x, y: spawn.y, vx: 0, vy: 0, facing: spawn.x <= 0 ? 1 : -1, grounded: true, damage: 0, stocks: 0, kos: 0, falls: 0, shield: 100, mode: 'idle', move: null, moveFrame: 0, invulnerable: false, jumps: 2, recoveryUsed: false, charge: 0, presses: { jump: 0, attack: 0, special: 0, smash: 0 } }; };
/** The stage shown before any snapshot: the host's fixed choice, or Cloudbreak while a random pick is still unresolved. */
export const preparedStage = (settings: Settings | null | undefined): StageId => settings?.stage && settings.stage !== 'random' ? settings.stage : 'cloudbreak';
/** A fighter is in danger when nothing solid can catch it: no surface below its column, or it has fallen under the lowest surface. */
export function offstage(f: Fighter, platforms: readonly Platform[]) {
  if (f.mode === 'out') return false;
  const lowest = Math.min(...platforms.map(p => p.y));
  return f.y < lowest - .5 || !platforms.some(p => f.x >= p.left - .3 && f.x <= p.right + .3 && p.y <= f.y + .05);
}
export default function Arena(props: SceneViewProps<Settings, View>) {
  const canvas = useRef<HTMLCanvasElement>(null), tags = useRef<HTMLDivElement>(null), latest = useRef(props), buffer = useRef(new SnapshotBuffer<View>(40));
  latest.current = props;
  useEffect(() => { if (props.publicView && props.snapshotTime !== null) buffer.current.push(props.snapshotTime, props.publicView); }, [props.publicView, props.snapshotTime]);
  useEffect(() => {
    const scope = new ResourceScope(props.signal), quality: Quality = localStorage.getItem('party.sceneQuality') === 'low' ? 'low' : 'balanced';
    if (!canvas.current || !tags.current) { props.onError(new Error('The arena canvas is unavailable.')); return; }
    const canvasEl = canvas.current, tagsEl = tags.current;
    loadFighterAssets(scope.signal).then(() => { if (!scope.signal.aborted) build(); }).catch(error => { if (!scope.signal.aborted) { scope.dispose(); latest.current.onError(error); } });
    function build() {
      try {
        const scene = new Scene(), cache = makeCache(resource => scope.own(resource)), reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
        const camera = new PerspectiveCamera(FOV, 1, .1, 200); camera.position.set(0, 3, 24); let aspect = 16 / 9;
        scene.add(new HemisphereLight('#ffe2bf', '#4a3778', 1.5)); const sun = new DirectionalLight('#fff1d6', 2.3); sun.position.set(6, 12, 9); scene.add(sun); const fill = new DirectionalLight('#7fb6ff', .6); fill.position.set(-8, 4, 6); scene.add(fill);
        // Stage art is owned by the stage scene module; it is rebuilt when the authoritative stage changes (e.g. a random pick resolving).
        let stageId = preparedStage(latest.current.settings), stageArt = createStageScene(scene, stageId);
        const setStage = (next: StageId) => { if (next === stageId) return; stageArt.dispose(); stageId = next; stageArt = createStageScene(scene, next); canvasEl.setAttribute('aria-label', `${getStage(next).name} arena`); };
        scope.defer(() => stageArt.dispose()); canvasEl.setAttribute('aria-label', `${getStage(stageId).name} arena`);
        // Impact effects: a bounded pool of sparks and rings.
        const plane = scope.own(new PlaneGeometry(1, 1)), ring = scope.own(new RingGeometry(.6, .8, 40)), particles: Particle[] = [];
        for (let i = 0; i < 64; i++) { const material = scope.own(new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide })), mesh = new Mesh(i % 8 === 0 ? ring : plane, material); mesh.visible = false; scene.add(mesh); particles.push({ mesh, material, vx: 0, vy: 0, life: 0, max: 1, spin: 0, grow: 0 }); }
        let shake = 0, seenImpact = 0;
        const spawn = (x: number, y: number, color: string, count: number, speed: number, size: number, life: number, ringSize: number) => {
          let sparks = count, rings = ringSize ? 1 : 0;
          for (const p of particles) {
            if (p.life > 0) continue; const isRing = p.mesh.geometry === ring;
            if (isRing) { if (!rings) continue; rings--; } else { if (!sparks) continue; sparks--; }
            const angle = Math.random() * Math.PI * 2, v = isRing ? 0 : speed * (.4 + Math.random() * .8);
            p.mesh.visible = true; p.mesh.position.set(x, y, .8); p.material.color.set(color); p.material.opacity = 1; p.vx = Math.cos(angle) * v; p.vy = Math.sin(angle) * v + (isRing ? 0 : 1.5);
            p.life = p.max = isRing ? life * .6 : life * (.6 + Math.random() * .6); p.spin = (Math.random() - .5) * 12; p.grow = isRing ? ringSize : 0; p.mesh.scale.setScalar(isRing ? .4 : size * (.5 + Math.random())); p.mesh.rotation.set(0, 0, angle);
            if (!sparks && !rings) break;
          }
        };
        // Projectiles: pooled glowing slabs positioned from the authoritative list (thin beams for pilots, spinning orbs otherwise).
        const beams = Array.from({ length: 24 }, () => { const core = new Mesh(plane, scope.own(new MeshBasicMaterial({ transparent: true, opacity: .95, depthWrite: false, side: DoubleSide }))), glow = new Mesh(plane, scope.own(new MeshBasicMaterial({ transparent: true, opacity: .35, depthWrite: false, side: DoubleSide }))); core.add(glow); glow.scale.set(1.25, 2.6, 1); core.visible = false; scene.add(core); return core; });
        const koTexts: { el: HTMLDivElement; x: number; y: number }[] = [];
        const actors = new Map<string, Actor>(), tagById = new Map<string, HTMLDivElement>(), actorLayer = new Group(); scene.add(actorLayer);
        const react = (impact: Impact, reduced: boolean) => {
          const scale = reduced ? .45 : 1;
          if (impact.kind === 'block') spawn(impact.x, impact.y, '#dff6ff', Math.round(6 * scale), 4, .2, .35, 2.2);
          else if (impact.kind === 'break') spawn(impact.x, impact.y, impact.color, Math.round(18 * scale), 6, .34, .7, 3.5);
          else if (impact.kind === 'ko') {
            spawn(impact.x, impact.y, impact.color, Math.round(26 * scale), 12, .5, .9, 9); spawn(impact.x, impact.y, '#fff6e5', Math.round(10 * scale), 5, .8, .5, 0); if (!reduced) shake = 1;
            const el = document.createElement('div'); el.className = 'sc-ko kp-title'; el.textContent = 'KO!'; el.style.color = impact.color; tagsEl.appendChild(el); const entry = { el, x: impact.x, y: impact.y }; koTexts.push(entry);
            const timer = setTimeout(() => { el.remove(); koTexts.splice(koTexts.indexOf(entry), 1); }, 1100); scope.defer(() => clearTimeout(timer));
          } else spawn(impact.x, impact.y, impact.color, Math.round(10 * scale), 7, .28, .45, 2);
          let near: Actor | undefined, best = 1.8;
          for (const actor of actors.values()) { const d = Math.hypot(actor.group.position.x - impact.x, actor.group.position.y + actor.height / 2 - impact.y); if (d < best) { best = d; near = actor; } }
          if (near && impact.kind !== 'block') near.pop = 1;
        };
        const ensureActor = (f: Fighter, index: number) => {
          let actor = actors.get(f.id);
          const model = cachedModel(f.kind);
          if (!model) { void loadFighterModel(f.kind, scope.signal).catch(() => {}); return null; } // keeps rendering the previous kind until the new model is cached
          if (actor && actor.kind !== f.kind) { actor.dispose(); actors.delete(f.id); actor = undefined; }
          if (!actor) { actor = new Actor(f.kind, f.color, model, cache); actor.group.position.set(f.x, f.y, 0); actor.attach(actorLayer); actors.set(f.id, actor); }
          actor.group.position.z = index * .05;
          let tag = tagById.get(f.id);
          if (!tag) { tag = document.createElement('div'); tag.className = 'sc-tag'; tag.innerHTML = '<b></b><span></span><i aria-hidden="true"></i>'; tag.style.setProperty('--sc-color', f.color); tagsEl.appendChild(tag); tagById.set(f.id, tag); }
          return { actor, tag };
        };
        // Warm only the actual default roster (plus every effect mesh) on the prepared stage's real spawn points.
        const defaults = () => props.players.map((player, index) => defaultFighter(player, index, props.players.length, stageId));
        const restPlatforms = stageFrame(stageId, 0, false).platforms;
        defaults().forEach((f, index) => { const entry = ensureActor(f, index); if (!entry) return; entry.actor.update(f, f.x, f.y, 0, .1, true, 'select', restPlatforms); (entry.tag.firstElementChild as HTMLElement).textContent = String(index + 1); (entry.tag.children[1] as HTMLElement).textContent = f.name; });
        // Clone skeletons (and their GPU bone textures) belong to this round; the page-cached GLB geometry/materials stay.
        scope.defer(() => { for (const tag of tagById.values()) tag.remove(); for (const text of koTexts) text.el.remove(); for (const actor of actors.values()) actor.dispose(); scene.clear(); buffer.current.clear(); });
        // Camera framing: the current surfaces (moving ones included) plus every live fighter, clamped to the stage's blast bounds.
        const cam = { x: 0, y: 2.6, half: 7.2 }, project = new Vector3();
        const frameCamera = (fighters: Fighter[], platforms: readonly Platform[], dt: number, reduced: boolean) => {
          const stage = getStage(stageId), live = fighters.filter(f => f.mode !== 'out'), focus = live.length && ['countdown', 'fight'].includes(latest.current.publicView?.phase ?? '');
          // Wide arenas need a group camera: retain an overview for setup, then expand only as fighters spread out.
          let minX = focus ? Math.min(...live.map(f => f.x)) - 5 : Math.min(...platforms.map(p => p.left)) - 1.2, maxX = focus ? Math.max(...live.map(f => f.x)) + 5 : Math.max(...platforms.map(p => p.right)) + 1.2;
          let minY = focus ? Math.min(...live.map(f => f.y)) - 2.5 : Math.min(...platforms.map(p => p.y)) - 1.6, maxY = focus ? Math.max(...live.map(f => f.y + FIGHTERS[f.kind].height)) + 2.5 : Math.max(...platforms.map(p => p.y)) + 2.6;
          for (const f of fighters) { if (f.mode === 'out') continue; minX = Math.min(minX, f.x - 1.6); maxX = Math.max(maxX, f.x + 1.6); minY = Math.min(minY, f.y - 1.2); maxY = Math.max(maxY, f.y + FIGHTERS[f.kind].height + 1.1); }
          minX = Math.max(-stage.blastX - .6, minX); maxX = Math.min(stage.blastX + .6, maxX); minY = Math.max(stage.blastBottom - .6, minY); maxY = Math.min(stage.blastTop + .6, maxY);
          const halfW = (maxX - minX) / 2, halfH = (maxY - minY) / 2, half = Math.max(halfH, halfW / aspect) * 1.04 + .3, y = (minY + maxY) / 2 - half * .16;
          const k = 1 - Math.exp(-dt * 3.2); cam.x += ((minX + maxX) / 2 - cam.x) * k; cam.y += (y - cam.y) * k; cam.half += (half * 1.16 - cam.half) * k;
          shake = Math.max(0, shake - dt * 3.2); const jolt = reduced ? 0 : shake * shake * .35;
          camera.position.set(cam.x + (Math.random() - .5) * jolt, cam.y + (Math.random() - .5) * jolt, cam.half / Math.tan(FOV * Math.PI / 360)); camera.lookAt(cam.x, cam.y, 0);
        };
        const place = (tag: HTMLDivElement, x: number, y: number, w: number, h: number) => {
          project.set(x, y, 0).project(camera); let sx = (project.x + 1) / 2 * w, sy = (1 - project.y) / 2 * h; const margin = 34, off = sx < margin || sx > w - margin || sy < margin || sy > h - margin;
          const dx = sx - w / 2, dy = sy - h / 2; sx = Math.min(w - margin, Math.max(margin, sx)); sy = Math.min(h - margin, Math.max(margin, sy));
          tag.style.transform = `translate(-50%,-100%) translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`; tag.classList.toggle('sc-tag-off', off);
          if (off) (tag.lastElementChild as HTMLElement).textContent = Math.abs(dx) * h > Math.abs(dy) * w ? (dx > 0 ? '▶' : '◀') : dy > 0 ? '▼' : '▲';
        };
        mountThreeScene(canvasEl, { signal: scope.signal, scene, camera, quality,
          resize(next) { aspect = next; camera.aspect = next; camera.updateProjectionMatrix(); },
          frame(now, dt) {
            const seconds = now / 1000, reduced = reducedQuery.matches, current = latest.current, raw = current.publicView, view = buffer.current.sample(current.serverNowMs(), interpolate) ?? raw;
            if (view) setStage(view.stageId); else setStage(preparedStage(current.settings));
            // Gameplay geometry always follows the authoritative stage clock; reduced motion only calms the decorative layer.
            const tick = view?.stageTick ?? 0, hazards = view?.hazards ?? current.settings?.hazards ?? true, live = stageFrame(stageId, tick, hazards), platforms = live.platforms;
            stageArt.update(tick, hazards, reduced);
            const width = canvasEl.clientWidth || 1, height = canvasEl.clientHeight || 1;
            if (raw) for (const impact of raw.impacts) if (impact.id > seenImpact) { seenImpact = impact.id; react(impact, reduced); }
            const fighters = view?.players ?? defaults(), seen = new Set<string>(), phase = view?.phase ?? 'select';
            frameCamera(phase === 'select' ? [] : fighters, platforms, dt, reduced); camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
            fighters.forEach((f, index) => {
              const entry = ensureActor(f, index); if (!entry) return; const { actor, tag } = entry; seen.add(f.id);
              let x = f.x, y = f.y;
              if (phase === 'select') { const spot = spawnPoint(stageId, index, fighters.length, tick); x = spot.x; y = spot.y; }
              if (phase !== 'fight') { const k = 1 - Math.exp(-dt * 9); x = actor.group.position.x + (x - actor.group.position.x) * k; y = actor.group.position.y + (y - actor.group.position.y) * k; }
              const shown: Fighter = phase === 'select' ? { ...f, mode: 'idle', grounded: true, vx: 0, vy: 0, move: null, invulnerable: false, charge: 0, facing: x <= 0 ? 1 : -1 } : f;
              actor.update(shown, x, y, seconds, dt, reduced, phase, platforms);
              const danger = phase === 'fight' && offstage(f, platforms), compact = !!view && phase !== 'select';
              tag.hidden = f.mode === 'out'; tag.classList.toggle('sc-tag-danger', danger); tag.classList.toggle('sc-tag-dim', !f.connected); tag.classList.toggle('sc-tag-pick', phase === 'select' && !f.chosen); tag.classList.toggle('sc-tag-compact', compact);
              (tag.firstElementChild as HTMLElement).textContent = String(index + 1); (tag.children[1] as HTMLElement).textContent = compact ? '' : view ? (f.chosen ? FIGHTERS[f.kind].name : 'Choosing…') : f.name;
              place(tag, x, y + actor.height + .25, width, height);
            });
            for (const [id, actor] of actors) if (!seen.has(id)) { actor.group.visible = actor.shadow.visible = actor.cue.visible = false; tagById.get(id)?.setAttribute('hidden', ''); }
            const shots = view?.projectiles ?? [];
            beams.forEach((beam, i) => { const shot = shots[i]; beam.visible = !!shot; if (!shot) return; const pilot = actors.get(shot.owner)?.style === 'pilot'; beam.position.set(shot.x, shot.y, .6); if (pilot) { beam.scale.set(Math.min(2.4, .9 + Math.abs(shot.vx) * .04), .16, 1); beam.rotation.z = 0; } else { beam.scale.set(.45, .45, 1); beam.rotation.z = reduced ? Math.PI / 4 : seconds * 7; } (beam.material as MeshBasicMaterial).color.set(shot.color); ((beam.children[0] as Mesh).material as MeshBasicMaterial).color.set(shot.color); });
            for (const text of koTexts) { project.set(text.x, text.y + 1, 0).project(camera); text.el.style.transform = `translate(-50%,-50%) translate(${((project.x + 1) / 2 * width).toFixed(1)}px,${((1 - project.y) / 2 * height).toFixed(1)}px)`; }
            for (const p of particles) { if (p.life <= 0) continue; p.life -= dt; if (p.life <= 0) { p.mesh.visible = false; continue; } const t = p.life / p.max; p.material.opacity = t; if (p.grow) p.mesh.scale.setScalar(.4 + (1 - t) * p.grow); else { if (!reduced) { p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.vy -= 9 * dt; p.mesh.rotation.z += p.spin * dt; } p.mesh.scale.multiplyScalar(1 - dt * .8); } }
          },
          onReady: () => latest.current.onReady(), onError: error => latest.current.onError(error),
          onMetrics: metrics => { canvasEl.dataset.sceneMetrics = JSON.stringify(metrics); },
        });
      } catch (error) { scope.dispose(); latest.current.onError(error); }
    }
    return scope.dispose;
  }, [props.roundId, props.signal]);
  return <div className="sky-clash-scene"><canvas ref={canvas} aria-label="Sky Clash arena"/><div ref={tags} className="sc-tags" aria-hidden="true"/></div>;
}
