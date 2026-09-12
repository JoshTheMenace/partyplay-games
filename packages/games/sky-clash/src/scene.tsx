import { useEffect, useRef } from 'react';
import { BoxGeometry, CanvasTexture, CircleGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshToonMaterial, PerspectiveCamera, PlaneGeometry, RingGeometry, Scene, SphereGeometry, SRGBColorSpace, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SceneViewProps } from '../../../party-ui/src/index';
import { ResourceScope, SnapshotBuffer } from '../../../party-runtime/src/index';
import { mountThreeScene, type Quality } from '../../../party-3d/src/index';
import { FIGHTERS, STAGE, interpolate, type Fighter, type FighterKind, type Impact, type Settings, type View } from './model';
import { Actor, makeCache } from './rig';
const FOV = 36, WORLD = { minX: -STAGE.blastX - .6, maxX: STAGE.blastX + .6, minY: STAGE.blastBottom - .6, maxY: STAGE.blastTop + .6 }, KINDS: FighterKind[] = ['fox', 'falco'];
const MODEL_URLS: Record<FighterKind, string> = { fox: new URL('../assets/fox-replacement.glb', import.meta.url).href, falco: new URL('../assets/falco-replacement.glb', import.meta.url).href };
let shared: Promise<Record<FighterKind, Object3D>> | null = null;
/** Both replacement models load once per page and stay cached; clones share their GPU geometry/materials. Waiting is abortable, a failed load is retried on the next call. */
export function loadFighterAssets(signal: AbortSignal): Promise<Record<FighterKind, Object3D>> {
  shared ??= Promise.all(KINDS.map(async kind => {
    const response = await fetch(MODEL_URLS[kind]); if (!response.ok) throw new Error(`The ${FIGHTERS[kind].name} model could not be loaded (${response.status}).`);
    const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), ''); return [kind, gltf.scene] as const;
  })).then(entries => entries.reduce((all, [kind, model]) => ({ ...all, [kind]: model }), {} as Record<FighterKind, Object3D>)).catch(error => { shared = null; throw error; });
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Scene preparation aborted.', 'AbortError'));
    const abort = () => reject(new DOMException('Scene preparation aborted.', 'AbortError')); signal.addEventListener('abort', abort, { once: true });
    shared!.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function skyTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 512; const g = canvas.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 512); grad.addColorStop(0, '#1d1650'); grad.addColorStop(.38, '#6b3d8f'); grad.addColorStop(.62, '#ff7d5c'); grad.addColorStop(.8, '#ffc27a'); grad.addColorStop(1, '#ffe7b8');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 512); const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; return texture;
}
type Particle = { mesh: Mesh; material: MeshBasicMaterial; vx: number; vy: number; life: number; max: number; spin: number; grow: number };
/** Mirrors the server's initial roster (alternating archetypes on their spawn marks) so warmup and the first frame show real fighters. */
const defaultFighter = (player: { id: string; name: string; color: string }, index: number, count: number): Fighter => ({ ...player, kind: index % 2 ? 'falco' : 'fox', chosen: false, connected: true, x: (index - (count - 1) / 2) * 3.2, y: 0, vx: 0, vy: 0, facing: index < count / 2 ? 1 : -1, grounded: true, damage: 0, stocks: 0, kos: 0, falls: 0, shield: 100, mode: 'idle', move: null, moveFrame: 0, invulnerable: false, jumps: 2, recoveryUsed: false, charge: 0, presses: { jump: 0, attack: 0, special: 0, smash: 0 } });
export default function Arena(props: SceneViewProps<Settings, View>) {
  const canvas = useRef<HTMLCanvasElement>(null), tags = useRef<HTMLDivElement>(null), latest = useRef(props), buffer = useRef(new SnapshotBuffer<View>(40));
  latest.current = props;
  useEffect(() => { if (props.publicView && props.snapshotTime !== null) buffer.current.push(props.snapshotTime, props.publicView); }, [props.publicView, props.snapshotTime]);
  useEffect(() => {
    const scope = new ResourceScope(props.signal), quality: Quality = localStorage.getItem('party.sceneQuality') === 'low' ? 'low' : 'balanced';
    if (!canvas.current || !tags.current) { props.onError(new Error('The arena canvas is unavailable.')); return; }
    const canvasEl = canvas.current, tagsEl = tags.current;
    loadFighterAssets(scope.signal).then(models => { if (!scope.signal.aborted) build(models); }).catch(error => { if (!scope.signal.aborted) { scope.dispose(); latest.current.onError(error); } });
    function build(models: Record<FighterKind, Object3D>) {
      try {
        const scene = new Scene(), cache = makeCache(resource => scope.own(resource)), reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
        scene.background = scope.own(skyTexture());
        const camera = new PerspectiveCamera(FOV, 1, .1, 200); camera.position.set(0, 3, 24); let aspect = 16 / 9;
        scene.add(new HemisphereLight('#ffe2bf', '#4a3778', 1.5)); const sun = new DirectionalLight('#fff1d6', 2.3); sun.position.set(6, 12, 9); scene.add(sun); const fill = new DirectionalLight('#7fb6ff', .6); fill.position.set(-8, 4, 6); scene.add(fill);
        const toon = (color: string) => scope.own(new MeshToonMaterial({ color })), box = scope.own(new BoxGeometry(1, 1, 1)), ball = scope.own(new SphereGeometry(1, 12, 9));
        const block = (parent: Group | Scene, mat: MeshToonMaterial, x: number, y: number, z: number, w: number, h: number, d: number) => { const m = new Mesh(box, mat); m.position.set(x, y, z); m.scale.set(w, h, d); parent.add(m); return m; };
        // Stage: every walkable top face sits exactly on the authoritative platform y.
        const stone = toon('#f4e6cc'), trim = toon('#ffb347'), rock = toon('#4a3a8c'), deepRock = toon('#2d224f'), stageGroup = new Group(); scene.add(stageGroup);
        const [main, ...raised] = STAGE.platforms;
        block(stageGroup, stone, 0, -.3, 0, main.right - main.left, .6, 4.4); block(stageGroup, trim, 0, -.66, 0, main.right - main.left + .2, .16, 4.6);
        const under = new Mesh(scope.own(new CylinderGeometry(7.6, 3.4, 2.8, 9)), rock); under.position.y = -2.1; under.rotation.y = .2; stageGroup.add(under);
        const tip = new Mesh(scope.own(new CylinderGeometry(3.2, .5, 2.4, 7)), deepRock); tip.position.y = -4.6; stageGroup.add(tip);
        for (const x of [main.left + .2, main.right - .2]) { block(stageGroup, trim, x, .45, -1.6, .14, .9, .14); block(stageGroup, toon(x < 0 ? FIGHTERS.fox.color : FIGHTERS.falco.color), x + (x < 0 ? .22 : -.22), .7, -1.6, .42, .28, .04); }
        for (const p of raised) { const w = p.right - p.left, cx = (p.left + p.right) / 2; block(stageGroup, stone, cx, p.y - .16, 0, w, .32, 2.2); block(stageGroup, trim, cx, p.y - .36, 0, w + .1, .1, 2.3); block(stageGroup, rock, cx, p.y - .55, 0, w * .6, .3, 1.4); }
        const puff = toon('#fff2e2'), farPuff = toon('#f6bfa8'), clouds: { group: Group; speed: number; base: number }[] = [];
        const cloud = (x: number, y: number, z: number, size: number, mat: MeshToonMaterial, speed: number) => { const g = new Group(); for (let i = 0; i < 5; i++) { const m = new Mesh(ball, mat); m.position.set((i - 2) * size * .55, Math.sin(i * 1.7) * size * .2, (i % 2) * size * .2); m.scale.set(size * (.7 + (i % 3) * .2), size * .55, size * .6); g.add(m); } g.position.set(x, y, z); scene.add(g); clouds.push({ group: g, speed, base: x }); };
        cloud(-4.5, -3.2, 1.6, 1.4, puff, .12); cloud(3.8, -3.6, 1.2, 1.6, puff, -.1); cloud(0, -5.4, .6, 1.2, puff, .08);
        for (let i = 0; i < 9; i++) cloud(-22 + i * 5.5 + (i % 2) * 2, -3 + (i % 3) * 3.4 + (i % 2) * 1.2, -18 - (i % 4) * 5, 2.4 + (i % 3), farPuff, .25 + (i % 3) * .1);
        const sunDisc = new Mesh(scope.own(new CircleGeometry(4.5, 40)), scope.own(new MeshBasicMaterial({ color: '#fff0c4' }))); sunDisc.position.set(9, 6, -60); scene.add(sunDisc);
        const glowDisc = new Mesh(scope.own(new CircleGeometry(7.5, 40)), scope.own(new MeshBasicMaterial({ color: '#ffb469', transparent: true, opacity: .45 }))); glowDisc.position.set(9, 6, -61); scene.add(glowDisc);
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
        // Laser beams: pooled glowing slabs positioned from the authoritative projectile list.
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
          for (const actor of actors.values()) { const d = Math.hypot(actor.group.position.x - impact.x, actor.group.position.y + STAGE.fighterHeight / 2 - impact.y); if (d < best) { best = d; near = actor; } }
          if (near && impact.kind !== 'block') near.pop = 1;
        };
        const ensureActor = (f: Fighter, index: number) => {
          let actor = actors.get(f.id);
          if (actor && actor.kind !== f.kind) { actor.dispose(); actors.delete(f.id); actor = undefined; }
          if (!actor) { actor = new Actor(f.kind, f.color, models[f.kind], cache); actor.group.position.set(f.x, f.y, 0); actor.attach(actorLayer); actors.set(f.id, actor); }
          actor.group.position.z = index * .05;
          let tag = tagById.get(f.id);
          if (!tag) { tag = document.createElement('div'); tag.className = 'sc-tag'; tag.innerHTML = '<b></b><span></span><i aria-hidden="true"></i>'; tag.style.setProperty('--sc-color', f.color); tagsEl.appendChild(tag); tagById.set(f.id, tag); }
          return { actor, tag };
        };
        const defaults = props.players.map((player, index) => defaultFighter(player, index, props.players.length));
        defaults.forEach((f, index) => { const { actor, tag } = ensureActor(f, index); actor.update(f, f.x, f.y, 0, .1, true, 'select'); (tag.firstElementChild as HTMLElement).textContent = String(index + 1); (tag.children[1] as HTMLElement).textContent = f.name; });
        // Warm every material the fight can show: both models (even if the roster starts with one kind) and all effect meshes.
        const warmers: Actor[] = [];
        for (const kind of KINDS) if (!defaults.some(f => f.kind === kind)) { const warm = new Actor(kind, '#ffffff', models[kind], cache); warm.attach(actorLayer); warm.group.visible = warm.shadow.visible = warm.cue.visible = false; warmers.push(warm); }
        // Clone skeletons (and their GPU bone textures) belong to this round; the page-cached GLB geometry/materials stay.
        scope.defer(() => { for (const tag of tagById.values()) tag.remove(); for (const text of koTexts) text.el.remove(); for (const actor of [...actors.values(), ...warmers]) actor.dispose(); scene.clear(); buffer.current.clear(); });
        // Camera framing: keep the stage readable, follow the fight, and keep off-stage recoveries in view.
        const cam = { x: 0, y: 2.6, half: 7.2 }, project = new Vector3();
        const frameCamera = (fighters: Fighter[], dt: number, reduced: boolean) => {
          let minX = -9.2, maxX = 9.2, minY = -1.6, maxY = 7.2;
          for (const f of fighters) { if (f.mode === 'out') continue; minX = Math.min(minX, f.x - 1.6); maxX = Math.max(maxX, f.x + 1.6); minY = Math.min(minY, f.y - 1.2); maxY = Math.max(maxY, f.y + 3); }
          minX = Math.max(WORLD.minX, minX); maxX = Math.min(WORLD.maxX, maxX); minY = Math.max(WORLD.minY, minY); maxY = Math.min(WORLD.maxY, maxY);
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
            for (const c of clouds) c.group.position.x = reduced ? c.base : c.base + Math.sin(seconds * .05 * c.speed * 4 + c.base) * 1.6;
            const width = canvasEl.clientWidth || 1, height = canvasEl.clientHeight || 1;
            if (raw) for (const impact of raw.impacts) if (impact.id > seenImpact) { seenImpact = impact.id; react(impact, reduced); }
            const fighters = view?.players ?? defaults, seen = new Set<string>(), phase = view?.phase ?? 'select';
            frameCamera(phase === 'select' ? [] : fighters, dt, reduced); camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
            fighters.forEach((f, index) => {
              const { actor, tag } = ensureActor(f, index); seen.add(f.id);
              let x = f.x, y = f.y;
              if (phase === 'select') { x = (index - (fighters.length - 1) / 2) * 3.2; y = 0; }
              if (phase !== 'fight') { const k = 1 - Math.exp(-dt * 9); x = actor.group.position.x + (x - actor.group.position.x) * k; y = actor.group.position.y + (y - actor.group.position.y) * k; }
              const shown: Fighter = phase === 'select' ? { ...f, mode: 'idle', grounded: true, vx: 0, vy: 0, move: null, invulnerable: false, charge: 0, facing: index < fighters.length / 2 ? 1 : -1 } : f;
              actor.update(shown, x, y, seconds, dt, reduced, phase);
              const offstage = f.mode !== 'out' && (Math.abs(f.x) > STAGE.halfWidth + .3 || f.y < -.5), compact = !!view && phase !== 'select';
              tag.hidden = f.mode === 'out'; tag.classList.toggle('sc-tag-danger', offstage); tag.classList.toggle('sc-tag-dim', !f.connected); tag.classList.toggle('sc-tag-pick', phase === 'select' && !f.chosen); tag.classList.toggle('sc-tag-compact', compact);
              (tag.firstElementChild as HTMLElement).textContent = String(index + 1); (tag.children[1] as HTMLElement).textContent = compact ? '' : view ? (f.chosen ? FIGHTERS[f.kind].name : 'Choosing…') : f.name;
              place(tag, x, y + STAGE.fighterHeight + .25, width, height);
            });
            for (const [id, actor] of actors) if (!seen.has(id)) { actor.group.visible = actor.shadow.visible = actor.cue.visible = false; tagById.get(id)?.setAttribute('hidden', ''); }
            const shots = view?.projectiles ?? [];
            beams.forEach((beam, i) => { const shot = shots[i]; beam.visible = !!shot; if (!shot) return; beam.position.set(shot.x, shot.y, .6); beam.scale.set(Math.min(2.4, .9 + Math.abs(shot.vx) * .04), .16, 1); (beam.material as MeshBasicMaterial).color.set(shot.color); ((beam.children[0] as Mesh).material as MeshBasicMaterial).color.set(shot.color); });
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
  return <div className="sky-clash-scene"><canvas ref={canvas} aria-label="Cloudbreak arena"/><div ref={tags} className="sc-tags" aria-hidden="true"/></div>;
}
