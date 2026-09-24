/* Renderer contracts shared by the world renderer (render-world agent) and actors (render-actors agent). */
import type * as THREE from 'three';
import type { Track } from '../sim/track';
import type { KartState, RaceEvent, RaceView, RacerView } from '../sim/types';

/** Normalised viewport rectangle; y is measured from the TOP (CSS convention). HUD overlays use the same rects. */
export type ViewRect = { x: number; y: number; w: number; h: number };
export type Viewport = { rect: ViewRect; racerId: string | null; kind: 'chase' | 'overview' };
/** 0 = full (shadows, DPR ≤ 2), 1 = balanced (DPR ≤ 1.5, cheaper shadows), 2 = low (DPR 1, no shadows, fewer particles). */
export type QualityTier = 0 | 1 | 2;
/** Pose actually drawn for a racer this frame (interpolated snapshot, or the locally predicted kart). */
export type RacerPose = { view: RacerView; kart: KartState };
export type FrameInput = {
  race: RaceView;                          // interpolated view (entities/boxes/events current)
  poses: ReadonlyMap<string, RacerPose>;   // every racer's drawn pose, keyed by id
  viewports: readonly Viewport[];
  quality: QualityTier; reducedMotion: boolean;
  time: number; dt: number;                // seconds (performance clock), frame delta (≤ 0.1)
  newEvents: readonly RaceEvent[];         // events first seen this frame (dedupe by id upstream)
  /** Race time the locally predicted kart is drawn at (view time + predictor lead). Movers are placed at this
   * clock so a bumper is drawn where it hits our own kart; defaults to race.time. */
  moverTime?: number;
};
/** Per-viewport camera feedback the actors can request (shake, FOV kick) keyed by racer id. */
export type CameraCue = { shake: number; fovKick: number };

/** Everything that moves: karts + drivers, item entities, item boxes, particles/effects. */
export type Actors = {
  group: THREE.Group;
  update(frame: FrameInput): void;
  /** Called right before each viewport renders (e.g. fade karts too close to that camera, per-view ink). */
  beforeViewport(racerId: string | null, camera: THREE.PerspectiveCamera): void;
  cues(racerId: string): CameraCue;
  dispose(): void;
};
export type ActorsFactory = (ctx: { track: Track; scene: THREE.Scene; assets: KartAssets; quality: QualityTier }) => Actors;

/** Loaded GLB libraries (render-actors agent owns loading; world renderer uses `props`). */
export type KartAssets = { karts: THREE.Group | null; props: THREE.Group | null; clone(name: string): THREE.Object3D | null };

export type KartRenderer = { render(frame: FrameInput): void; ready(): boolean; dispose(): void };
