/**
 * The Blockwild SceneView (lazy-loaded). Mounts the renderer and hands frames to the game Runtime (first-person
 * play on controller seats, cinematic spectator on the watching display).
 *
 * The world (voxel engine, atlas, item meshes, models) is built for the real seed: the settings seed when fixed
 * (then the spawn area is preloaded before reporting ready, for at most PRELOAD_MS), otherwise the seed in the first
 * public view (ready is reported as soon as a frame renders and the Runtime shows a loading state). A different seed
 * later (play again) rebuilds it. The world is kept in a module-level cache keyed by seed, so a remount after a
 * dropped socket, a loaded save or a replay of the same world reuses every chunk and mesh (edits are re-diffed).
 */
import { useEffect, useRef } from 'react';
import { CanvasTexture, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';
import type { SceneViewProps } from '../../../../party-ui/src/index';
import { ResourceScope } from '../../../../party-runtime/src/index';
import { mountThreeScene } from '../../../../party-3d/src/index';
import { EYE_HEIGHT } from '../shared/constants';
import type { PrivateView, Settings, View } from '../shared/protocol';
import { findSpawn } from '../shared/worldgen';
import { createBlockAtlas, heldAsBlock, itemSprite, texturePixels } from './art/atlas';
import { HostMusic } from './audio/host-music';
import { Sfx } from './audio/sfx';
import { VoxelEngine } from './engine/index';
import { ModelLibrary } from './game/models';
import { Runtime } from './game/runtime';
import { ItemModels, SpriteSheet } from './game/sprites';
import { store } from './store';

const ASSETS = '/games/blockwild/';
/** A parked world (scene unmounted) waits this long for a remount before it is freed. */
const PARK_MS = 90_000;
/**
 * A fixed-seed preload never holds the round past this. The platform fails rounds still preparing after 20 s, and a
 * slow phone may need most of that for the module, atlas and models; the Runtime shows its own loading state after.
 */
const PRELOAD_MS = 5_000;
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const validSeed = (seed: unknown): seed is number => typeof seed === 'number' && Number.isInteger(seed) && seed > 0;

type World = {
  seed: number; scope: ResourceScope; engine: VoxelEngine; sheet: SpriteSheet; items: ItemModels; models: ModelLibrary;
  /** Errors go to whichever SceneView currently shows this world. */
  onError(error: unknown): void;
  parked: ReturnType<typeof setTimeout> | null;
};
let cached: World | null = null;

/** The world for this seed: the cached one when it matches (a remount or reload), otherwise a fresh build. */
function takeWorld(seed: number): World {
  if (cached?.seed === seed) {
    if (cached.parked) clearTimeout(cached.parked);
    cached.parked = null;
    return cached;
  }
  cached?.scope.dispose();
  const scope = new ResourceScope(), art = createBlockAtlas();
  scope.defer(() => art.texture.dispose());
  const engine = new VoxelEngine({ seed, scope, atlas: art, onError: error => world.onError(error), renderDistance: store.get().settings.renderDistance });
  const sheet = new SpriteSheet({ tile: texturePixels, item: itemSprite, cube: heldAsBlock });
  const world: World = { seed, scope, engine, sheet, items: scope.own(new ItemModels(sheet)), models: scope.own(new ModelLibrary()), onError: () => {}, parked: null };
  // Models stream in behind play; entities use procedural stand-ins until then.
  void world.models.load(ASSETS, scope.signal);
  scope.defer(() => { if (world.parked) clearTimeout(world.parked); if (cached === world) cached = null; });
  return cached = world;
}
function parkWorld(world: World) {
  world.onError = () => {};
  if (cached === world && !world.scope.signal.aborted) world.parked = setTimeout(world.scope.dispose, PARK_MS);
}

/** "Loading world…" card that rides in front of the camera until the ground under the player is meshed. */
function loadingCard() {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!;
  canvas.width = 512;
  canvas.height = 96;
  ctx.fillStyle = 'rgba(6,10,28,0.72)';
  ctx.beginPath();
  ctx.roundRect(56, 8, 400, 80, 24);
  ctx.fill();
  ctx.font = '40px "Lilita One", Nunito, system-ui, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Loading world…', 256, 50);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(0.64, 0.12, 1);
  sprite.position.set(0, -0.05, -1);
  sprite.renderOrder = 999;
  return sprite;
}

export default function BlockwildScene(props: SceneViewProps<Settings, View, PrivateView>) {
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const scope = new ResourceScope(props.signal), element = canvas.current!;
    const fail = (error: unknown) => { if (!scope.signal.aborted) latest.current.onError(error); };
    try {
      const scene = new Scene(), camera = new PerspectiveCamera(75, 1, 0.05, 1200);
      scene.background = new Color(0x070b1c);
      // Terrain lights itself in the engine shader; these lights only give entity models their face shading (their
      // colours are already scaled by the world light where they stand).
      const sun = new DirectionalLight(0xffffff, 0.9), card = loadingCard();
      sun.position.set(0.4, 1, 0.25);
      camera.add(card);
      scene.add(camera, sun, new HemisphereLight(0xffffff, 0x9a9486, 1.9));
      scope.defer(() => { card.material.map?.dispose(); card.material.dispose(); });
      const sfx = new Sfx(scope, `${ASSETS}sounds/`), music = props.isHost ? new HostMusic(scope) : null;

      let current: { world: World; runtime: Runtime; scope: ResourceScope } | null = null;
      const use = (seed: number) => {
        if (current) { current.scope.dispose(); parkWorld(current.world); }
        const world = takeWorld(seed), runScope = new ResourceScope(scope.signal), { engine } = world;
        world.onError = fail;
        scene.add(engine.root);
        scene.fog = engine.fog;
        runScope.defer(() => { scene.remove(engine.root); scene.fog = null; });
        // Stream the spawn area first (the same search the server runs); the Runtime moves to the player once known.
        const spawn = findSpawn(seed);
        spawn[0] += 0.5;
        spawn[2] += 0.5;
        camera.position.set(spawn[0], spawn[1] + EYE_HEIGHT, spawn[2]);
        const runtime = new Runtime({
          scene, camera, canvas: element, engine, sheet: world.sheet, items: world.items, models: world.models, scope: runScope, seed, spawn, sfx, music,
          props: () => latest.current,
        });
        current = { world, runtime, scope: runScope };
        return world;
      };
      scope.defer(() => { if (current) { current.scope.dispose(); parkWorld(current.world); } });

      // A fixed seed preloads the spawn area before reporting ready; a random one reports after the first frame.
      let loaded = !validSeed(props.settings.seed), rendered = false;
      const ready = () => { if (loaded && rendered && !scope.signal.aborted) latest.current.onReady(); };
      const preloaded = () => { loaded = true; ready(); };
      if (!loaded) {
        use(props.settings.seed).engine.ready().then(preloaded, fail);
        setTimeout(preloaded, PRELOAD_MS);
      }
      mountThreeScene(element, {
        signal: scope.signal, scene, camera, quality: coarse() ? 'low' : 'balanced',
        resize(aspect) { camera.aspect = aspect; camera.updateProjectionMatrix(); },
        frame: (now, dt) => {
          const seed = latest.current.publicView?.seed;
          if (validSeed(seed) && seed !== current?.world.seed) use(seed);
          current?.runtime.frame(now, dt);
          card.visible = !current || current.runtime.loading;
        },
        onReady: () => { rendered = true; ready(); },
        onError: fail,
      });
    } catch (error) {
      fail(error);
      scope.dispose();
    }
    return scope.dispose;
  }, [props.roundId, props.signal]);
  return <canvas ref={canvas} className="bw-canvas" aria-label="Blockwild world" tabIndex={-1}/>;
}
