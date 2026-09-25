import type { DataArrayTexture } from 'three';

/**
 * Block textures as one 2D array texture, structurally the same as the art atlas (src/client/art/atlas.ts);
 * fallback-atlas.ts builds one with flat colours.
 * - Layers are square RGBA8 images, rows stored top row first (flipY false), colours in sRGB (SRGBColorSpace).
 * - Nearest magnification with mipmaps; the engine never changes sampler state.
 * - `layerOf` covers every key in TEXTURE_KEYS plus optional animation frames 'water_1'.., 'lava_1'.., 'nether_portal_1'..
 *   and 'fire_1'.. (the engine plays every frame it finds, in order, and stops at the first missing one),
 *   'crack_0'..'crack_9' (break stages: dark pixels with alpha) and 'missing' (returned for unknown keys).
 */
export interface BlockAtlas {
  readonly texture: DataArrayTexture;
  layerOf(key: string): number;
}

/** One render layer of a column mesh: 4 vertices per quad, drawn with the shared quad index. */
export type LayerMesh = {
  /** Chunk-local positions (x,z 0..16, y 0..128), 3 floats per vertex. */
  pos: Float32Array;
  /** u*4096, imageY*4096, texture layer, flags (VF_*), 4 per vertex. */
  uvl: Uint16Array;
  /** sky light*17, block light*17, shade*255 (face shade × AO), tint (redstone power*17); 4 per vertex. */
  lt: Uint8Array;
  quads: number;
  minY: number;
  maxY: number;
};
/** Opaque, cutout (alpha tested) and translucent (blended) meshes of one section or column. */
export type Layers = [LayerMesh | null, LayerMesh | null, LayerMesh | null];
export const OPAQUE = 0, CUTOUT = 1, TRANSLUCENT = 2;

/**
 * Vertex flags (uvl.w). WATER, LAVA, PORTAL and FIRE swap in the current animation frame and (except water) glow at full
 * brightness; SURFACE wobbles liquid tops; WIRE tints redstone dust by its power (lt.w = power·17).
 */
export const VF_LEAVES = 1, VF_PLANT = 2, VF_WATER = 4, VF_SURFACE = 8, VF_LAVA = 16, VF_PORTAL = 32, VF_FIRE = 64, VF_WIRE = 128;

export type ToWorker =
  | { type: 'init'; seed: number; layers: Record<string, number>; capacity: number }
  | { type: 'load'; keys: number[] }
  | { type: 'cancel'; keys: number[] }
  | { type: 'drop'; keys: number[] }
  | { type: 'capacity'; capacity: number }
  /** Pairs of [cellIndex, value]; value -1 = back to the generated terrain. */
  | { type: 'edits'; changes: Int32Array };

export type ColumnUpdate = {
  key: number;
  /** Full chunk cells (sent on load). */
  cells?: Uint16Array;
  /** Core light, localIndex order, sky << 4 | block (sent on load and when it changes). */
  light?: Uint8Array;
  /** Replacement meshes (sent on load and when a section changes). */
  layers?: Layers;
};
export type FromWorker =
  | { type: 'update'; load: boolean; columns: ColumnUpdate[] }
  /** Final values of edited cells, pairs of [cellIndex, value]. */
  | { type: 'cells'; changes: Int32Array }
  | { type: 'error'; message: string };
