/**
 * Voxel engine: streams, lights and meshes the world in a worker, uploads column meshes within a per-frame budget,
 * and draws them with the world shaders under a day/night sky.
 *
 * Think of it as a kitchen: the worker is the cook (terrain, light, meshes), the main thread only plates finished
 * dishes (GPU uploads) and never waits. Edits jump the queue so a placed block appears within a frame or two.
 */
import { Box3, BufferAttribute, BufferGeometry, Color, Fog, Frustum, Group, Matrix4, Mesh, Sphere, Vector3, type PerspectiveCamera } from 'three';
import type { ResourceScope } from '../../../../../party-runtime/src/index';
import { isOpaque, TEXTURE_KEYS } from '../../shared/blocks';
import { CHUNK, CHUNKS, HEIGHT, inNether, WORLD } from '../../shared/constants';
import { cellIndex, chunkFromKey, chunkKey, FACES, localIndex } from '../../shared/coords';
import type { Target } from '../store';
import { AMBIENT, lightCurve, NETHER_AMBIENT, NETHER_FOG_FAR, NETHER_FOG_NEAR, skyState, TORCH_LIGHT } from './environment';
import { newVolume, volumeIndex, type Volume } from './light';
import { createUniforms, createWorldMaterials, GLOWS, type WorldMaterials, type WorldUniforms } from './material';
import { Mesher } from './mesher';
import { BlockOutline, CrackOverlay, type Crack } from './overlays';
import { SkyRenderer } from './sky';
import type { BlockAtlas, ColumnUpdate, FromWorker, LayerMesh, ToWorker } from './types';
import { ClientWorld } from './world';

export { createFallbackAtlas } from './fallback-atlas';
export { BlockOutline, CrackOverlay, type Crack } from './overlays';
export type { BlockAtlas } from './types';
export { ClientWorld } from './world';

export type EngineOptions = {
  seed: number; atlas: BlockAtlas; renderDistance: number; scope: ResourceScope; onError(error: unknown): void;
};

/** Loads queued at the worker (small, so priorities follow the camera) and finished columns awaiting upload. */
const MAX_IN_FLIGHT = 3, MAX_PENDING = 6, UPLOAD_BUDGET_MS = 4, PLAN_INTERVAL = 0.25, READY_RADIUS = 2;
/** Animated textures: base key, the uniform holding the current frame's layer, frames per second. */
const ANIMATED = [['water', 'uWaterLayer', 8], ['lava', 'uLavaLayer', 4], ['nether_portal', 'uPortalLayer', 12], ['fire', 'uFireLayer', 16]] as const;
/** Seconds for the Nether look to fade in or out after crossing its border (a portal trip). */
const NETHER_FADE = 0.6;

/** Uniforms game-side effects share with the world (the atlas, clock and current animation frames). */
export type SharedUniforms = Pick<WorldUniforms, 'uAtlas' | 'uTime' | 'uLavaLayer' | 'uPortalLayer' | 'uFireLayer'>;
/** A block sliding into its cell (piston moves) while the real cell is veiled from the worker's meshes. */
type Slide = { root: Group; index: number; x: number; y: number; z: number; dx: number; dy: number; dz: number; age: number; seconds: number; veil: boolean };
/**
 * A finished slide whose cell was unveiled: its model stays until the worker echoes the unveil (`echoed`) and then sends
 * the column's new mesh, so the block never blinks out in between (or for LINGER seconds at most).
 */
type Linger = { root: Group; index: number; key: number; echoed: boolean; age: number };
const LINGER = 1;

/** Column order: nearest first, columns in view ahead of those behind (distance × 3 when outside the frustum). */
export function planColumns(cx: number, cz: number, radius: number, visible: (cx: number, cz: number) => boolean = () => true) {
  const list: { key: number; score: number }[] = [];
  const limit = (radius + 0.5) ** 2;
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
    const x = cx + dx, z = cz + dz, d = dx * dx + dz * dz;
    if (d > limit || x < 0 || z < 0 || x >= CHUNKS || z >= CHUNKS) continue;
    list.push({ key: chunkKey(x, z), score: d <= 2 || visible(x, z) ? d : d * 3 + 4 });
  }
  return list.sort((a, b) => a.score - b.score).map(entry => entry.key);
}

/** One index buffer for every column mesh (4 vertices per quad), grown on demand. */
class QuadIndex {
  attribute = QuadIndex.build(16384);
  static build(quads: number) {
    const index = new Uint32Array(quads * 6);
    for (let q = 0, v = 0; q < index.length; q += 6, v += 4) index.set([v, v + 1, v + 2, v, v + 2, v + 3], q);
    return new BufferAttribute(index, 1);
  }
  get(quads: number) {
    if (quads * 6 > this.attribute.count) this.attribute = QuadIndex.build(Math.max(quads, this.attribute.count / 3));
    return this.attribute;
  }
}

type Column = { cx: number; cz: number; meshes: (Mesh | null)[] };
/** Linear fog colour for entities in the Nether. */
const NETHER_HAZE = new Color(...NETHER_FOG_NEAR).lerp(new Color(...NETHER_FOG_FAR), 0.6);
/** Layers of an animated texture: the base key, then 'key_1', 'key_2'... until the atlas has no more. */
export function animationFrames(atlas: BlockAtlas, key: string): number[] {
  const missing = atlas.layerOf('missing'), frames = [atlas.layerOf(key)];
  for (let f = 1; f < 64; f++) {
    const layer = atlas.layerOf(`${key}_${f}`);
    if (layer === missing) break;
    frames.push(layer);
  }
  return frames;
}

export class VoxelEngine {
  readonly world = new ClientWorld();
  /** Everything the engine draws. Add it to the rendered scene and set `scene.fog = engine.fog`; it can move between scenes. */
  readonly root = new Group();
  /** Fog matching the world shader's, for entity materials. */
  readonly fog = new Fog(0xffffff, 60, 96);
  readonly seed: number;
  readonly outline: BlockOutline;
  readonly crackOverlay: CrackOverlay;
  /** Matches the game runtime's `Visuals` shape. */
  readonly visuals: { outline(target: Target | null): void; cracks(list: readonly Crack[]): void };
  /** Atlas, clock and animation frames for flames and portal overlays drawn outside the world meshes. */
  readonly shared: SharedUniforms;

  private readonly worker: Worker;
  private readonly uniforms: WorldUniforms;
  private readonly materials: WorldMaterials;
  private readonly sky: SkyRenderer;
  private readonly index = new QuadIndex();
  private readonly columns = new Map<number, Column>();
  private readonly inFlight = new Set<number>();
  /** Loaded columns waiting for an upload slot, oldest first. */
  private readonly pending = new Map<number, ColumnUpdate>();
  /** Layers of every frame per ANIMATED entry. */
  private readonly frames: number[][];
  private readonly slides: Slide[] = [];
  private readonly lingering: Linger[] = [];
  /** Cells shown as air to the worker while a slide covers them (count of slides per cell). */
  private readonly veiled = new Map<number, number>();
  private cellMesher: Mesher | null = null;
  private cellVolume: Volume | null = null;
  private readonly frustum = new Frustum();
  private readonly box = new Box3();
  private readonly matrix = new Matrix4();
  private readonly corner = [new Vector3(), new Vector3()] as const;
  private readonly cameraPosition = new Vector3();
  private radius: number;
  private plan: number[] = [];
  private planCentre = -1;
  private planAge = Infinity;
  /** Effective edits (authoritative + overlay) last sent to the worker. */
  private effective = new Map<number, number>();
  private daylight = 1;
  private readonly scratch: [number, number, number] = [0, 0, 0];
  private readyResolve: (() => void) | null = null;
  private readonly readyPromise: Promise<void>;
  private disposed = false;

  constructor(private readonly options: EngineOptions) {
    const { atlas, scope } = options;
    this.seed = options.seed;
    this.radius = options.renderDistance;
    this.readyPromise = new Promise(resolve => { this.readyResolve = resolve; });
    this.uniforms = createUniforms(atlas.texture);
    this.materials = createWorldMaterials(this.uniforms);
    this.sky = new SkyRenderer(this.root, this.uniforms);
    this.outline = new BlockOutline(this.root);
    this.crackOverlay = new CrackOverlay(this.root, this.uniforms, key => atlas.layerOf(key), (x, y, z) => this.world.getCell(x, y, z));
    this.visuals = { outline: target => this.outline.set(target), cracks: list => this.crackOverlay.set(list) };
    const u = this.uniforms;
    this.shared = { uAtlas: u.uAtlas, uTime: u.uTime, uLavaLayer: u.uLavaLayer, uPortalLayer: u.uPortalLayer, uFireLayer: u.uFireLayer };

    const missing = atlas.layerOf('missing'), layers: Record<string, number> = { missing };
    for (const key of TEXTURE_KEYS) layers[key] = atlas.layerOf(key);
    this.frames = ANIMATED.map(([key]) => animationFrames(atlas, key));

    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data);
    this.worker.onerror = event => this.fail(new Error(`World worker failed: ${event.message || 'unknown error'}`));
    this.post({ type: 'init', seed: options.seed, layers, capacity: this.capacity() });
    this.applyFog();
    this.setTime(1000);
    scope.defer(() => this.dispose());
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Authoritative edits plus the optimistic overlay (overlay wins). Only changed cells are sent to the worker. */
  setEdits(edits: readonly (readonly [number, number])[], overlay: ReadonlyMap<number, number>) {
    const next = new Map<number, number>();
    for (const [index, value] of edits) next.set(index, value);
    for (const [index, value] of overlay) next.set(index, value);
    const changes: number[] = [];
    for (const [index, value] of next) if (this.effective.get(index) !== value) {
      changes.push(index, this.veiled.has(index) ? 0 : value);
      this.world.write(index, value);
    }
    for (const index of this.effective.keys()) if (!next.has(index)) changes.push(index, this.veiled.has(index) ? 0 : -1);
    this.effective = next;
    if (!changes.length) return;
    const array = Int32Array.from(changes);
    this.post({ type: 'edits', changes: array }, [array.buffer]);
  }

  /** Streams columns around the camera, uploads finished meshes within budget, animates textures, sky, clouds and slides. */
  update(camera: PerspectiveCamera, dt: number) {
    if (this.disposed) return;
    camera.updateMatrixWorld();
    const position = this.cameraPosition.setFromMatrixPosition(camera.matrixWorld), u = this.uniforms, time = u.uTime.value += dt;
    for (let i = 0; i < ANIMATED.length; i++) {
      const [, uniform, fps] = ANIMATED[i]!, frames = this.frames[i]!;
      u[uniform].value = frames[Math.floor(time * fps) % frames.length]!;
    }
    // Everything dimension-related follows the camera (the first-person eye or the TV spectator), fading across a trip.
    const nether = inNether(position.x, position.z) ? 1 : 0, was = u.uNether.value;
    if (was !== nether) {
      u.uNether.value = dt > 0 && Math.abs(nether - was) < 1 ? Math.max(0, Math.min(1, was + Math.sign(nether - was) * dt / NETHER_FADE)) : nether;
      this.applyFog();
    }
    this.sky.update(position.x, position.z, dt, u.uNether.value > 0.5);
    this.updateSlides(dt);

    const cx = Math.floor(position.x / CHUNK), cz = Math.floor(position.z / CHUNK), centre = chunkKey(Math.max(0, Math.min(CHUNKS - 1, cx)), Math.max(0, Math.min(CHUNKS - 1, cz)));
    this.planAge += dt;
    if (centre !== this.planCentre || this.planAge >= PLAN_INTERVAL) {
      this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const [min, max] = this.corner;
      this.plan = planColumns(cx, cz, this.radius, (x, z) => this.frustum.intersectsBox(this.box.set(min.set(x * CHUNK, 0, z * CHUNK), max.set(x * CHUNK + CHUNK, HEIGHT, z * CHUNK + CHUNK))));
      this.planCentre = centre;
      this.planAge = 0;
      this.unloadFar(cx, cz);
    }
    this.requestLoads();
    this.upload();
    if (this.readyResolve) this.checkReady(position.x, position.z);
  }

  /** Sun, sky colours, sky light and fog colour for a time of day (ticks, 0 = sunrise). */
  setTime(dayTicks: number) {
    const state = skyState(dayTicks), u = this.uniforms;
    u.uSunDir.value.set(...state.sun);
    u.uZenith.value.setRGB(...state.zenith);
    u.uHorizon.value.setRGB(...state.horizon);
    u.uSkyLight.value.setRGB(...state.skyLight);
    u.uDay.value = state.day;
    u.uDusk.value = state.dusk;
    u.uStars.value = state.stars;
    u.uAngle.value = state.angle;
    this.daylight = (state.skyLight[0] + state.skyLight[1] + state.skyLight[2]) / 3;
    this.applyFog();
  }

  /** Combined 0..1 light (linear, same curve as the world shader) for tinting entities and particles. */
  lightAt(x: number, y: number, z: number) {
    const c = this.lightRgb(x, y, z, this.scratch);
    return (c[0] + c[1] + c[2]) / 3;
  }

  /** Linear light colour at a point, as the world shader lights a block there: warm near torches, blue at night. */
  lightRgb(x: number, y: number, z: number, out: [number, number, number] = [0, 0, 0]) {
    const [sky, block] = this.openLight(x, y, z), s = lightCurve(sky / 15), b = lightCurve(block / 15), daylight = this.uniforms.uSkyLight.value, nether = this.uniforms.uNether.value;
    out[0] = Math.min(1, Math.max(s * daylight.r, b * TORCH_LIGHT[0]) + AMBIENT + (NETHER_AMBIENT[0] - AMBIENT) * nether);
    out[1] = Math.min(1, Math.max(s * daylight.g, b * TORCH_LIGHT[1]) + AMBIENT + (NETHER_AMBIENT[1] - AMBIENT) * nether);
    out[2] = Math.min(1, Math.max(s * daylight.b, b * TORCH_LIGHT[2]) + AMBIENT + (NETHER_AMBIENT[2] - AMBIENT) * nether);
    return out;
  }

  /**
   * Sky and block light at a cell. Opaque cells store none, so a point inside one (break chips, a mob's head in a wall,
   * a pushed block sliding into a filled cell) takes its brightest open side.
   */
  private openLight(x: number, y: number, z: number): [number, number] {
    let [sky, block] = this.world.lightLevels(x, y, z);
    if (isOpaque(this.world.getCell(x, y, z))) for (const [dx, dy, dz] of FACES) {
      const [s, b] = this.world.lightLevels(x + dx, y + dy, z + dz);
      sky = Math.max(sky, s);
      block = Math.max(block, b);
    }
    return [sky, block];
  }

  /** True while the camera is in the Nether (the look has faded in). */
  get inNether() { return this.uniforms.uNether.value > 0.5; }

  /**
   * Point glows lighting nearby terrain this frame (fireballs, primed TNT), `count` entries of 7 numbers each:
   * x, y, z, radius and a linear colour. Beyond GLOWS they are ignored; missing ones switch off.
   */
  setGlows(data: ArrayLike<number>, count: number) {
    const { uGlow, uGlowColor } = this.uniforms;
    for (let i = 0; i < GLOWS; i++) {
      const on = i < count, o = i * 7;
      uGlow.value[i]!.set(on ? data[o]! : 0, on ? data[o + 1]! : -100, on ? data[o + 2]! : 0, on ? data[o + 3]! : 0);
      uGlowColor.value[i]!.setRGB(on ? data[o + 4]! : 0, on ? data[o + 5]! : 0, on ? data[o + 6]! : 0);
    }
  }

  /**
   * Animate a block of value `cell` sliding by (dx, dy, dz) into (x, y, z) over `seconds` (pistons). With `veil` the
   * cell there is hidden from the world meshes meanwhile, so the block does not show twice; physics keeps the real cell.
   */
  slide(x: number, y: number, z: number, cell: number, dx: number, dy: number, dz: number, seconds: number, veil: boolean) {
    if (this.disposed || !cell) return;
    const [sky, block] = this.openLight(x, y, z), root = this.cellModel(cell, sky, block), index = cellIndex(x, y, z);
    this.root.add(root);
    this.slides.push({ root, index, x, y, z, dx, dy, dz, age: 0, seconds, veil });
    if (!veil) return;
    this.veiled.set(index, (this.veiled.get(index) ?? 0) + 1);
    this.post({ type: 'edits', changes: Int32Array.from([index, 0]) });
  }

  setRenderDistance(chunks: number) {
    this.radius = Math.max(2, Math.min(12, Math.round(chunks)));
    this.planAge = Infinity;
    this.post({ type: 'capacity', capacity: this.capacity() });
    this.applyFog();
  }

  setUnderwater(on: boolean) {
    this.uniforms.uUnderwater.value = on ? 1 : 0;
    this.applyFog();
  }

  /** Resolves once the columns around the camera (radius 2) are meshed and uploaded. */
  ready() { return this.readyPromise; }

  /** True when the columns within two chunks of (x, z) are meshed and uploaded (a player can appear there). */
  meshedAround(x: number, z: number) {
    const radius = Math.min(READY_RADIUS, this.radius);
    return planColumns(Math.floor(x / CHUNK), Math.floor(z / CHUNK), radius).every(key => this.columns.has(key));
  }

  dispose() {
    if (this.disposed) return;
    for (const slide of [...this.slides, ...this.lingering]) this.disposeModel(slide.root);
    this.slides.length = this.lingering.length = 0;
    this.disposed = true;
    this.worker.terminate();
    for (const key of this.columns.keys()) this.removeColumn(key);
    this.sky.dispose();
    this.outline.dispose();
    this.crackOverlay.dispose();
    for (const material of this.materials) material.dispose();
    this.root.removeFromParent();
    this.world.clear();
    this.readyResolve?.();
    this.readyResolve = null;
  }

  // ── Streaming ─────────────────────────────────────────────────────────────

  private capacity() { return (2 * this.radius + 5) ** 2 + 16; }

  /** World fog uniforms plus the matching `scene.fog` for entity materials. */
  private applyFog() {
    // Loaded terrain reaches at least radius·16 − 8 blocks from the camera; fog finishes just inside that edge.
    const u = this.uniforms, far = this.radius * CHUNK - 8, near = far * 0.68, underwater = u.uUnderwater.value > 0.5, nether = u.uNether.value;
    u.uFogFar.value = far;
    u.uFogNear.value = near;
    // The Nether's dense exponential haze, approximated linearly for entities.
    this.fog.near = underwater ? 0 : near * (1 - nether);
    this.fog.far = underwater ? 18 : far + (Math.min(far, 70) - far) * nether;
    if (underwater) this.fog.color.copy(u.uWaterFog.value).multiplyScalar(0.15 + 0.85 * this.daylight);
    else this.fog.color.copy(u.uHorizon.value).lerp(NETHER_HAZE, nether);
  }

  /** Moves slides along; finished ones unveil their cells and linger until the worker's new mesh covers them. */
  private updateSlides(dt: number) {
    for (let i = this.lingering.length - 1; i >= 0; i--) if ((this.lingering[i]!.age += dt) > LINGER) this.dropLinger(i);
    for (let i = this.slides.length - 1; i >= 0; i--) {
      const slide = this.slides[i]!, t = Math.min(1, (slide.age += dt) / slide.seconds), left = 1 - t * t * (3 - 2 * t);
      slide.root.position.set(slide.x - slide.dx * left - 1, slide.y - slide.dy * left - 1, slide.z - slide.dz * left - 1);
      if (t < 1) continue;
      this.slides.splice(i, 1);
      const others = slide.veil ? (this.veiled.get(slide.index) ?? 1) - 1 : 0;
      if (!slide.veil || others > 0) {
        if (others > 0) this.veiled.set(slide.index, others);
        this.disposeModel(slide.root);
        continue;
      }
      this.veiled.delete(slide.index);
      this.lingering.push({ root: slide.root, index: slide.index, key: chunkKey(slide.x >> 4, slide.z >> 4), echoed: false, age: 0 });
      this.post({ type: 'edits', changes: Int32Array.from([slide.index, this.effective.get(slide.index) ?? -1]) });
    }
  }
  private dropLinger(i: number) {
    this.disposeModel(this.lingering[i]!.root);
    this.lingering.splice(i, 1);
  }

  /** World-shaded meshes of one cell value lit by (sky, block), local origin at (1, 1, 1) (see updateSlides). */
  private cellModel(cell: number, sky: number, block: number) {
    const volume = this.cellVolume ??= newVolume(), mesher = this.cellMesher ??= new Mesher(key => this.options.atlas.layerOf(key));
    const centre = volumeIndex(1, 1, 1), root = new Group();
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const i = volumeIndex(1 + dx, 1 + dy, 1 + dz);
      volume.sky[i] = sky;
      volume.block[i] = block;
    }
    volume.cells[centre] = cell;
    mesher.section(volume, 0).forEach((data, layer) => { if (data) root.add(this.meshOf(data, layer)); });
    volume.cells[centre] = 0;
    return root;
  }
  private disposeModel(root: Group) {
    root.removeFromParent();
    for (const mesh of root.children) this.disposeMesh(mesh as Mesh);
  }

  private requestLoads() {
    const keys: number[] = [];
    for (const key of this.plan) {
      if (this.inFlight.size + keys.length >= MAX_IN_FLIGHT || this.pending.size >= MAX_PENDING) break;
      if (!this.columns.has(key) && !this.inFlight.has(key) && !this.pending.has(key)) keys.push(key);
    }
    if (!keys.length) return;
    for (const key of keys) this.inFlight.add(key);
    this.post({ type: 'load', keys });
  }

  /** Drops columns beyond radius + 1.5 (hysteresis so walking along a border does not thrash) and stale requests. */
  private unloadFar(cx: number, cz: number) {
    const limit = (this.radius + 1.5) ** 2, far = (key: number) => {
      const [x, z] = chunkFromKey(key);
      return (x - cx) ** 2 + (z - cz) ** 2 > limit;
    };
    const drop = [...this.columns.keys(), ...this.pending.keys()].filter(far), cancel = [...this.inFlight].filter(far);
    for (const key of drop) {
      this.removeColumn(key);
      this.pending.delete(key);
    }
    for (const key of cancel) this.inFlight.delete(key);
    if (drop.length || cancel.length) this.post({ type: 'drop', keys: [...drop, ...cancel] });
  }

  private receive(message: FromWorker) {
    if (this.disposed) return;
    if (message.type === 'error') this.fail(new Error(`World worker: ${message.message}`));
    else if (message.type === 'cells') {
      // Final values of edited cells; reverts carry the regenerated terrain value only the worker knows.
      const { changes } = message;
      // The unveil's echo carries the real block (a late echo of the veil itself is air).
      for (const linger of this.lingering) for (let j = 0; j < changes.length && !linger.echoed; j += 2) linger.echoed = changes[j] === linger.index && changes[j + 1] !== 0;
      for (let j = 0; j < changes.length; j += 2) {
        // A veiled cell keeps its real value for physics; only the worker's meshes see it as air.
        if (this.veiled.has(changes[j]!)) continue;
        const index = changes[j]!, value = this.effective.get(index) ?? changes[j + 1]!, x = index % WORLD, z = Math.floor(index / WORLD) % WORLD;
        this.world.write(index, value);
        const waiting = this.pending.get(chunkKey(x >> 4, z >> 4))?.cells;
        if (waiting) waiting[localIndex(x & 15, Math.floor(index / (WORLD * WORLD)), z & 15)] = value;
      }
    } else if (message.load) {
      for (const update of message.columns) {
        // Cancelled while the worker was busy: tell it to forget the column again.
        if (this.inFlight.delete(update.key)) this.pending.set(update.key, update);
        else if (!this.columns.has(update.key)) this.post({ type: 'drop', keys: [update.key] });
      }
      // Keep the worker busy between frames.
      this.requestLoads();
    } else {
      // Edit results skip the budget: the player is waiting to see them. Columns still waiting take the newer meshes.
      for (const update of message.columns) {
        const waiting = this.pending.get(update.key);
        if (!waiting) this.apply(update);
        else this.pending.set(update.key, { ...waiting, layers: update.layers ?? waiting.layers, light: update.light ?? waiting.light });
        for (let i = this.lingering.length - 1; i >= 0; i--) if (this.lingering[i]!.echoed && this.lingering[i]!.key === update.key) this.dropLinger(i);
      }
    }
  }

  private upload() {
    const start = performance.now();
    for (const [key, update] of this.pending) {
      if (performance.now() - start >= UPLOAD_BUDGET_MS) break;
      this.pending.delete(key);
      this.apply(update);
    }
  }

  private apply(update: ColumnUpdate) {
    const { key } = update;
    if (update.cells) {
      this.world.install(key, update.cells, update.light!);
      // Edits sent after the worker built this column arrive later as 'cells'; apply what we already know now.
      const [cx, cz] = chunkFromKey(key);
      for (const [index, value] of this.effective) {
        if ((index % WORLD) >> 4 === cx && (Math.floor(index / WORLD) % WORLD) >> 4 === cz) this.world.write(index, value);
      }
      this.columns.set(key, { cx, cz, meshes: [null, null, null] });
    }
    const column = this.columns.get(key);
    if (!column) return;
    if (update.light && !update.cells) this.world.setLight(key, update.light);
    update.layers?.forEach((mesh, layer) => this.setMesh(column, layer, mesh));
  }

  private setMesh(column: Column, layer: number, data: LayerMesh | null) {
    const old = column.meshes[layer];
    if (old) this.disposeMesh(old);
    column.meshes[layer] = null;
    if (!data) return;
    const mesh = this.meshOf(data, layer);
    mesh.position.set(column.cx * CHUNK, 0, column.cz * CHUNK);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    column.meshes[layer] = mesh;
    this.root.add(mesh);
  }
  private meshOf(data: LayerMesh, layer: number) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.pos, 3));
    geometry.setAttribute('uvl', new BufferAttribute(data.uvl, 4));
    geometry.setAttribute('lt', new BufferAttribute(data.lt, 4, true));
    geometry.setIndex(this.index.get(data.quads));
    geometry.setDrawRange(0, data.quads * 6);
    geometry.boundingBox = new Box3(new Vector3(0, data.minY, 0), new Vector3(CHUNK, data.maxY, CHUNK));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());
    return new Mesh(geometry, this.materials[layer]);
  }

  private disposeMesh(mesh: Mesh) {
    mesh.removeFromParent();
    // The index buffer is shared: detach it so disposing this geometry does not delete it for everyone else.
    mesh.geometry.setIndex(null);
    mesh.geometry.dispose();
  }

  private removeColumn(key: number) {
    const column = this.columns.get(key);
    if (!column) return;
    for (const mesh of column.meshes) if (mesh) this.disposeMesh(mesh);
    this.columns.delete(key);
    this.world.remove(key);
  }

  private checkReady(x: number, z: number) {
    if (!this.meshedAround(x, z)) return;
    this.readyResolve?.();
    this.readyResolve = null;
  }

  private post(message: ToWorker, transfer: Transferable[] = []) {
    if (!this.disposed) this.worker.postMessage(message, transfer);
  }

  private fail(error: Error) {
    if (!this.disposed) this.options.onError(error);
  }
}
