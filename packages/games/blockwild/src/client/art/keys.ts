/**
 * Atlas layer order, importable from the meshing worker (no painting, no three.js).
 * Layers: every block texture key (sorted), each animated key directly followed by its extra frames
 * (`water_1`.., `lava_1`.., `nether_portal_1`.., `fire_1`..), then the ten crack stages, then a magenta 'missing'
 * layer returned for unknown keys.
 */
import { faceTexture, TEXTURE_KEYS } from '../../shared/blocks';

/**
 * Animated texture keys. Frame f of key K is layer `layerOf(K) + f` (frames are contiguous and loop seamlessly);
 * `fps` is the playback rate the frames were painted for. All animations share one frame count, so a shader can
 * animate any of them with `layer + mod(floor(time * fps), FRAMES)`.
 */
export const ANIMATION_FRAMES = 16;
export const ANIMATIONS: Readonly<Record<string, { readonly frames: number; readonly fps: number }>> = {
  water: { frames: ANIMATION_FRAMES, fps: 8 },
  lava: { frames: ANIMATION_FRAMES, fps: 4 },
  nether_portal: { frames: ANIMATION_FRAMES, fps: 12 },
  fire: { frames: ANIMATION_FRAMES, fps: 16 },
};
export const WATER_FRAMES = ANIMATIONS.water!.frames, CRACK_STAGES = 10;
/** Atlas key of frame f (0-based) of an animated key: frame 0 is the key itself. */
export const frameKey = (key: string, frame: number) => frame ? `${key}_${frame}` : key;
const range = <T>(n: number, item: (i: number) => T) => Array.from({ length: n }, (_, i) => item(i));
export const ATLAS_KEYS: readonly string[] = [
  ...TEXTURE_KEYS.flatMap(key => range(ANIMATIONS[key]?.frames ?? 1, f => frameKey(key, f))),
  ...range(CRACK_STAGES, i => `crack_${i}`),
  'missing',
];
const LAYERS = new Map(ATLAS_KEYS.map((key, layer) => [key, layer]));
export const MISSING_LAYER = ATLAS_KEYS.length - 1;
/** Texture-array layer for a key; unknown keys map to the magenta 'missing' layer. */
export const layerOf = (key: string) => LAYERS.get(key) ?? MISSING_LAYER;
/** Layers of every frame of a key, in order (a single layer for still textures). */
export const frameLayers = (key: string): number[] => range(ANIMATIONS[key]?.frames ?? 1, f => layerOf(frameKey(key, f)));
/** First water frame; frame f of the animation is layer WATER_LAYER + f. */
export const WATER_LAYER = layerOf('water');
/** Crack stage s (0..9) is layer CRACK_LAYER + s. */
export const CRACK_LAYER = layerOf('crack_0');

const faceLayers = new Int16Array(65536 * 6).fill(-1);
/** Layer for face 0..5 (-X,+X,-Y,+Y,-Z,+Z) of a cell value (frame 0 for animated keys), cached for the mesher hot path. */
export function faceLayer(cell: number, face: number): number {
  const i = (cell & 65535) * 6 + face;
  let layer = faceLayers[i]!;
  if (layer < 0) faceLayers[i] = layer = layerOf(faceTexture(cell & 65535, face));
  return layer;
}
