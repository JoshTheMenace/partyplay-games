/**
 * Stage art entry point. Collision-driven pieces (solids, one-way slabs, hazard telegraphs) are built from
 * stageFrame() and follow it every frame at the presented stage tick, even under reduced motion. Each stage module
 * adds its own backdrop, parallax, ambient animation and bespoke hazard art on top.
 */
import { Group, Mesh, type Material, type Object3D } from 'three';
import { ResourceScope } from '../../../../../party-runtime/src/index';
import type { Quality } from '../../../../../party-3d/src/index';
import { STAGES, stageFrame, type Block, type Platform, type StageDef, type StageId } from '../../stages';
import { mainFloor, type Floor } from '../camera';
import { createKit, massGeometry, slabGeometry, stacks, type Kit, type Lighting, type Rect, type SolidShape, type StageUpdate, type SurfaceOptions } from './kit';
import { hazardLayer, type HazardStyle } from './hazards';
import { MODULES } from './art/index';

export type { StageUpdate } from './kit';
export type StageFrame = ReturnType<typeof stageFrame>;
export type SlabShape = { thickness?: number; taper?: number; front?: number; back?: number };
export type BuildContext = { stage: StageDef; frame: StageFrame; floor: Floor; ground: Material; slab: Material; material(hint?: string, platform?: boolean): Material };
/**
 * A custom piece replaces the default art for a block stack or a platform (usually matched by its `art` hint).
 * Blocks: build in world coordinates for the given rects (top first). Platforms: top center at the origin.
 */
export type Piece = { kind: 'block'; block: Block; rects: readonly Rect[]; ledges: [boolean, boolean] } | { kind: 'platform'; platform: Platform };
export type StageModule = {
  lighting: Lighting; ground: SurfaceOptions; shape?: SolidShape; slab?: SurfaceOptions; slabShape?: SlabShape;
  /** Surface overrides by `art` hint, for blocks and platforms alike. */
  hints?: Record<string, SurfaceOptions>;
  /** Hazard telegraph; false when the module draws its own (or has none). */
  hazard?: HazardStyle | false;
  piece?(kit: Kit, piece: Piece, ctx: BuildContext): Object3D | undefined;
  build(kit: Kit, ctx: BuildContext): (u: StageUpdate, frame: StageFrame) => void;
};
export type StageArt = { id: StageId; stage: StageDef; floor: Floor; root: Group; update(u: StageUpdate): StageFrame; dispose(): void };

/** Builds one stage's art into a child scope; dispose releases everything it created. */
export function createStageArt(id: StageId, parent: ResourceScope, quality: Quality): StageArt {
  const scope = new ResourceScope(parent.signal), mod = MODULES[id], kit = createKit(scope, quality, mod.lighting), stage = STAGES[id];
  const frame0 = stageFrame(id, 0, false), fixed = frame0.blocks.filter(b => !b.moving), floor = mainFloor(fixed.length ? fixed : frame0.blocks);
  const ground = kit.surface(mod.ground), slab = mod.slab ? kit.surface(mod.slab) : ground, cache = new Map<string, Material>();
  const material = (hint?: string, platform = false) => {
    const o = hint ? mod.hints?.[hint] : undefined;
    if (!o) return platform ? slab : ground;
    if (!cache.has(hint!)) cache.set(hint!, kit.surface(o));
    return cache.get(hint!)!;
  };
  const ctx: BuildContext = { stage, frame: frame0, floor, ground, slab, material };
  kit.root.name = `stage-${id}`;
  scope.defer(() => kit.root.removeFromParent());
  const ledged = (frame: StageFrame, b: Block): [boolean, boolean] => [frame.ledges.some(l => l.block === b.id && l.side < 0), frame.ledges.some(l => l.block === b.id && l.side > 0)];
  const solid = (b: Block, rects: readonly Rect[], frame: StageFrame): Object3D => {
    const ledges = ledged(frame, b);
    return mod.piece?.(kit, { kind: 'block', block: b, rects, ledges }, ctx) ?? new Mesh(massGeometry(rects, ...ledges, { seed: Math.round(b.top * 13 + b.left), ...mod.shape }), material(b.art));
  };
  const owned = (obj: Object3D) => { obj.traverse(o => { if (o instanceof Mesh) scope.defer(() => o.geometry.dispose()); }); return kit.add(obj); };

  // Static solids: stacks of flush blocks with the same hint merge into single collision-exact masses.
  for (const hint of new Set(fixed.map(b => b.art))) for (const stack of stacks(fixed.filter(b => b.art === hint))) owned(solid(stack[0], stack, frame0)).name = `block:${stack[0].id}`;

  // Moving solids and platforms: built on first sight, offset (or rebuilt when resized) to their current rect.
  type Live = { obj: Object3D; x: number; y: number; w: number; h: number; dispose(): void };
  const movers = new Map<string, Live>(), slabs = new Map<string, Live>();
  const build = (obj: Object3D, x: number, y: number, w: number, h: number): Live => {
    const child = new ResourceScope(scope.signal); kit.add(obj);
    obj.traverse(o => { if (o instanceof Mesh) child.defer(() => o.geometry.dispose()); });
    return { obj, x, y, w, h, dispose: () => { obj.removeFromParent(); child.dispose(); } };
  };
  const moverOf = (b: Block, frame: StageFrame) => { const g = new Group(); g.name = `block:${b.id}`; g.add(solid(b, [b], frame)); return build(g, b.left, b.bottom, b.right - b.left, b.top - b.bottom); };
  const slabOf = (p: Platform) => { const obj = mod.piece?.(kit, { kind: 'platform', platform: p }, ctx) ?? new Mesh(slabGeometry(p.right - p.left, mod.slabShape), material(p.art, true)); obj.name = `platform:${p.id}`; return build(obj, 0, 0, p.right - p.left, 0); };
  scope.defer(() => { for (const l of [...movers.values(), ...slabs.values()]) l.dispose(); });
  const sync = (frame: StageFrame) => {
    const seen = new Set<string>();
    for (const b of frame.blocks) {
      if (!b.moving) continue;
      seen.add(b.id);
      const w = b.right - b.left, h = b.top - b.bottom;
      let live = movers.get(b.id);
      if (live && (Math.abs(w / live.w - 1) > .25 || Math.abs(h / live.h - 1) > .25)) { live.dispose(); live = undefined; }
      if (!live) movers.set(b.id, live = moverOf(b, frame));
      // Geometry is in world space at its build rect: translate by the change, scaling about the bottom-left for small resizes.
      live.obj.visible = true; live.obj.scale.set(w / live.w, h / live.h, 1);
      live.obj.position.set(b.left - live.x * live.obj.scale.x, b.bottom - live.y * live.obj.scale.y, 0);
    }
    for (const p of frame.platforms) {
      seen.add(`p:${p.id}`);
      let live = slabs.get(p.id);
      if (live && Math.abs(p.right - p.left - live.w) > .01) { live.dispose(); live = undefined; }
      if (!live) slabs.set(p.id, live = slabOf(p));
      live.obj.visible = true; live.obj.position.set((p.left + p.right) / 2, p.y, 0);
    }
    for (const [key, live] of movers) if (!seen.has(key)) live.obj.visible = false;
    for (const [key, live] of slabs) if (!seen.has(`p:${key}`)) live.obj.visible = false;
  };

  const hazard = mod.hazard === false ? null : hazardLayer(kit, stage, mod.hazard ?? { style: 'area' });
  const step = mod.build(kit, ctx);
  sync(frame0);
  return {
    id, stage, floor, root: kit.root, dispose: scope.dispose,
    update(u) {
      const frame = stageFrame(id, u.tick, u.hazards);
      kit.time(u.reduced ? u.seconds * .2 : u.seconds); sync(frame); hazard?.(u, frame.hazard); step(u, frame);
      return frame;
    },
  };
}
