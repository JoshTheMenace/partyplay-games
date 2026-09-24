/**
 * Sky Clash display scene (display role only; client.tsx lazy-imports it so phones never load three.js).
 *
 * Owns the mount, frame loop, snapshot buffering and interpolation, camera, stage art, name tags and offscreen
 * magnifier bubbles. Fighters and effects come from ./fighter and ./fx. Preparation builds the predicted stage with
 * every lobby pick standing on its spawn, so shader warm-up covers what GO will show; the resolved stage replaces it
 * when the first snapshot arrives.
 */
import { useEffect, useRef } from 'react';
import { BackSide, CapsuleGeometry, Group, Mesh, MeshBasicMaterial, MeshToonMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { SceneViewProps } from '../../../../party-ui/src/index';
import { ResourceScope, SnapshotBuffer } from '../../../../party-runtime/src/index';
import { mountThreeScene, type Quality } from '../../../../party-3d/src/index';
import { FIGHTERS, isFighterKind, type FighterKind, type FighterView, type Settings, type View } from '../model';
import { STAGES, type StageId } from '../stages';
import { CameraDirector, EventClock, applyShot, blendView, distanceFor, jumped, predictStage, type Subject } from './camera';
import { FighterActor, FighterCache, loadFighterModels, type FighterModel } from './fighter/index';
import { createFx } from './fx/index';
import { createStageArt, type StageArt } from './stage/index';
import { BUBBLE_LAYER } from './stage/kit';
import { createMagnifier, createTags, type TagItem } from './tags';

/** Loaded with the scene chunk during prepare(); fighter models load inside SceneView once the picks are known. */
export async function loadSceneAssets(signal: AbortSignal) { if (signal.aborted) throw new DOMException('Scene loading was cancelled.', 'AbortError'); }

/** Transform partners whose model must be ready before the special turns one into the other. */
const PARTNERS: Partial<Record<FighterKind, FighterKind>> = { zelda: 'sheik', sheik: 'zelda', popo: 'nana' };
type Actor = { readonly group: Group; readonly height: number; update: FighterActor['update']; reset(): void; dispose(): void };

/** A toon capsule in the fighter's color, used only when its model failed to load, so a match never stalls on an asset. */
class StandIn implements Actor {
  readonly group = new Group();
  readonly height: number;
  private owned: { dispose(): void }[];
  constructor(view: FighterView) {
    const info = FIGHTERS[view.fighter], r = info.radius, body = new CapsuleGeometry(r, Math.max(.05, info.height - 2 * r), 6, 16);
    const toon = new MeshToonMaterial({ color: info.color }), line = new MeshBasicMaterial({ color: '#05071a', side: BackSide });
    const mesh = new Mesh(body, toon), hull = new Mesh(body, line);
    mesh.position.y = hull.position.y = info.height / 2; hull.scale.setScalar(1.07);
    this.group.add(mesh, hull); this.height = info.height; this.owned = [body, toon, line];
  }
  update(view: FighterView) { this.group.visible = view.state !== 'out'; this.group.position.set(view.x, view.y, 0); this.group.rotation.y = view.facing * .6; }
  reset() {}
  dispose() { this.group.removeFromParent(); for (const o of this.owned) o.dispose(); }
}

/** Fighters standing on their spawns before the first snapshot (preparation). */
function previewFighters(stageId: StageId, players: SceneViewProps<Settings, View>['players']): FighterView[] {
  const stage = STAGES[stageId];
  return players.flatMap((p, i) => {
    const choice = p.lobbyChoice as { fighter?: unknown; costume?: unknown } | undefined, [x, y] = stage.spawns[i % stage.spawns.length];
    if (!isFighterKind(choice?.fighter)) return [];
    return [{ id: p.id, name: p.name, color: p.color, fighter: choice.fighter, costume: Number(choice.costume) || 0, team: null, cpu: null, connected: true,
      x, y, vx: 0, vy: 0, facing: x > 0 ? -1 : 1, grounded: true, state: 'idle', stateFrame: 0, move: null, moveFrame: 0, charge: 0, hitlag: 0,
      damage: 0, stocks: 0, kos: 0, falls: 0, shield: 100, jumpsLeft: 1, intangible: false, armored: false, launch: 0, combo: 0 } satisfies FighterView];
  });
}
const readQuality = (): Quality => { try { return localStorage.getItem('party.sceneQuality') === 'low' ? 'low' : 'balanced'; } catch { return 'balanced'; } };

export default function SceneView(props: SceneViewProps<Settings, View>) {
  const canvas = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLDivElement>(null), flash = useRef<HTMLDivElement>(null), latest = useRef(props);
  const buffer = useRef<SnapshotBuffer<View> | null>(null), events = useRef<EventClock | null>(null);
  latest.current = props;
  if (!buffer.current) { buffer.current = new SnapshotBuffer<View>(80, 32, { adaptive: { minMs: 45, maxMs: 120 }, monotonic: true, resetGapMs: 2000 }); events.current = new EventClock(); }
  useEffect(() => {
    if (!props.publicView || props.snapshotTime === null) return;
    buffer.current!.push(props.snapshotTime, props.publicView, performance.now()); events.current!.add(props.publicView.events);
  }, [props.publicView, props.snapshotTime]);

  useEffect(() => {
    const scope = new ResourceScope(props.signal), el = canvas.current, root = overlay.current, flashEl = flash.current;
    if (!el || !root || !flashEl) { props.onError(new Error('The arena canvas is unavailable.')); return scope.dispose; }
    const fail = (error: unknown) => { if (!scope.signal.aborted) { scope.dispose(); latest.current.onError(error); } };
    const models = new Map<FighterKind, FighterModel | null>(), loading = new Map<FighterKind, Promise<void>>();
    const need = (kind: FighterKind): Promise<void> => {
      if (models.has(kind) || loading.has(kind)) return loading.get(kind) ?? Promise.resolve();
      const load = loadFighterModels([kind], scope.signal).then(m => { models.set(kind, m.get(kind) ?? null); }, error => {
        if (scope.signal.aborted) return;
        console.warn(`Sky Clash: showing a stand-in for ${FIGHTERS[kind].name}.`, error); models.set(kind, null);
      }).finally(() => loading.delete(kind));
      loading.set(kind, load); // registered before the partner, so Zelda -> Sheik -> Zelda stops here
      const partner = PARTNERS[kind];
      if (partner) void need(partner);
      return load;
    };
    const first = latest.current, prepared = predictStage(first.settings, first.players), preview = previewFighters(prepared, first.players);
    Promise.all(preview.map(f => need(f.fighter))).then(() => { if (!scope.signal.aborted) build(); }).catch(fail);

    function build() {
      const scene = new Scene(), camera = new PerspectiveCamera(30, 16 / 9, .5, 2400), quality = readQuality(), motion = matchMedia('(prefers-reduced-motion: reduce)');
      const cache = scope.own(new FighterCache()), fx = createFx(scene, scope), tags = createTags(root!), magnifier = createMagnifier(scene, scope), project = new Vector3();
      scope.defer(() => tags.dispose());
      let art: StageArt = createStageArt(prepared, scope, quality), aspect = 16 / 9;
      scene.add(art.root);
      const director = new CameraDirector(art.stage.camera, art.floor, aspect);
      const actors = new Map<string, { actor: Actor; kind: FighterKind; last: FighterView }>();
      scope.defer(() => { for (const a of actors.values()) a.actor.dispose(); actors.clear(); });
      const actorFor = (view: FighterView) => {
        let entry = actors.get(view.id);
        if (entry && entry.kind === view.fighter) return entry;
        if (!models.has(view.fighter)) { void need(view.fighter); return entry; } // keep the old body until a transform partner arrives
        entry?.actor.dispose();
        const model = models.get(view.fighter), actor: Actor = model ? new FighterActor({ view, model, cache }) : new StandIn(view);
        actor.group.traverse(o => o.layers.enable(BUBBLE_LAYER)); scene.add(actor.group);
        actors.set(view.id, entry = { actor, kind: view.fighter, last: view });
        return entry;
      };
      const subjectsOf = (fighters: readonly FighterView[]): Subject[] => fighters.filter(f => f.state !== 'out')
        .map(f => ({ x: f.x, y: f.y, height: actors.get(f.id)?.actor.height ?? FIGHTERS[f.fighter].height, vx: f.vx, vy: f.vy, launch: f.launch }));
      const setStage = (id: StageId, fighters: readonly FighterView[]) => {
        if (id === art.id) return;
        art.dispose(); art = createStageArt(id, scope, quality); scene.add(art.root);
        director.reset(art.stage.camera, art.floor, aspect, subjectsOf(fighters)); el!.setAttribute('aria-label', `${art.stage.name} arena`);
      };
      el!.setAttribute('aria-label', `${art.stage.name} arena`);
      for (const f of preview) actorFor(f);
      director.reset(art.stage.camera, art.floor, aspect, subjectsOf(preview));

      mountThreeScene(el!, {
        signal: scope.signal, scene, camera, quality,
        resize(next) { aspect = next; camera.aspect = next; },
        frame(now, dt) {
          const p = latest.current, reduced = motion.matches, seconds = now / 1000, view = buffer.current!.sample(p.serverNowMs(), blendView) ?? null;
          const fighters = view?.fighters ?? preview;
          setStage(view?.stageId ?? prepared, fighters);
          if (view) for (const e of events.current!.due(view.frame)) { fx.event(e, view); if (e.kind === 'ko' && !reduced) director.punch(e.x, e.y, 1); }
          fx.update(dt, reduced);
          const kick = fx.cameraKick(), shot = director.update(subjectsOf(fighters), aspect, dt, kick);
          applyShot(camera, shot); camera.updateMatrixWorld();
          const frame = art.update({ tick: view?.stageTick ?? 0, hazards: view?.hazards ?? p.settings.hazards, seconds, dt, reduced, camera, fighters });
          const ctx = { dt, seconds, reduced, cameraDistance: distanceFor(shot.halfH), platforms: [...frame.blocks, ...frame.platforms] }, seen = new Set<string>();
          for (const f of fighters) {
            const entry = actorFor(f); if (!entry) continue;
            seen.add(f.id);
            if (jumped(entry.last, f)) entry.actor.reset();
            entry.actor.update(f, entry.last, ctx); entry.last = f;
          }
          for (const [id, entry] of actors) if (!seen.has(id)) { entry.actor.dispose(); actors.delete(id); }
          fx.track(fighters); fx.projectiles(view?.projectiles ?? [], seconds);
          // Overlay: tags, bubbles and the flash, projected with this frame's camera.
          const { width, height } = el!.getBoundingClientRect(), toScreen = (x: number, y: number) => { project.set(x, y, 0).project(camera); return { x: (project.x + 1) / 2 * width, y: (1 - project.y) / 2 * height }; };
          let port = 0;
          const labels = new Map(fighters.filter(f => !f.partner).map(f => [f.id, f.cpu ? f.name : `P${++port}`])), label = (f: FighterView) => labels.get(f.partner ?? f.id) ?? '';
          const items: TagItem[] = fighters.map(f => ({ id: f.id, label: label(f), name: f.name, color: f.color, x: f.x, y: f.y, height: actors.get(f.id)?.actor.height ?? FIGHTERS[f.fighter].height,
            damage: f.damage, visible: f.state !== 'out' && actors.has(f.id), connected: f.connected }));
          const bubbles = tags.update(items, toScreen, width, height, !!view && view.phase !== 'countdown');
          magnifier.set(bubbles.flatMap(b => { const f = fighters.find(x => x.id === b.id), a = actors.get(b.id); return f && a ? [{ bubble: b, x: f.x, y: f.y, height: a.actor.height, color: f.color }] : []; }));
          flashEl!.style.opacity = String(Math.min(.8, kick.flash)); if (kick.flash > 0) flashEl!.style.background = kick.flashColor;
        },
        onReady: () => latest.current.onReady(), onError: fail,
        onMetrics: metrics => { el!.dataset.sceneMetrics = JSON.stringify(metrics); },
      });
    }
    return scope.dispose;
  }, [props.roundId, props.signal]);

  return <div className="sky-clash-scene" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
    <canvas ref={canvas} aria-label="Sky Clash arena" style={{ display: 'block', width: '100%', height: '100%' }}/>
    <div ref={flash} aria-hidden="true" style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', mixBlendMode: 'screen' }}/>
    <div ref={overlay} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}/>
  </div>;
}
