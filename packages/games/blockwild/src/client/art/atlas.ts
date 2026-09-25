/**
 * Blockwild art entry point. `createBlockAtlas()` uploads every painted 16×16 texture as one layer of a
 * `THREE.DataArrayTexture` (nearest magnification, GPU-generated mipmaps, sRGB). Layer order lives in ./keys so the
 * meshing worker can map texture keys to layers without painting anything.
 *
 * Texture notes for the mesher (expansion blocks):
 * - Animated: water, lava, nether_portal, fire (`ANIMATIONS`; frame f = layerOf(key) + f, 16 frames, suggested fps).
 *   Lava is opaque; the portal is translucent (alpha 150–240); fire is cutout with flames rising from the bottom row.
 * - redstone_dust_dot / redstone_dust_line are greyscale: multiply by `redstoneTint(power)`. The line runs along u
 *   through rows 6–9 (use half of it per connection, rotated for Z); the dot is the centre blob.
 * - repeater / repeater_on (top face): the output points to the image top (north, facing 0); rotate by facing × 90°.
 *   Torch sockets are painted at rows 3–5 (front) and 10–12 (back, the delay torch).
 * - redstone_torch(_off) and lever share the torch layout (stick at x 7–8, rows 6–15; head at rows 6–8).
 * - piston_side: rows 0–3 are the wooden head (toward the facing), row 4 a dark seam, rows 5–15 the stone body, so an
 *   extended base (12/16) or a head plate (4/16) samples the right part with positional UVs rotated to the facing.
 * - iron_door_top/bottom follow the oak door layout (windows in the top half are transparent).
 * - Armor skins for worn armor live in ./armor (`ARMOR_BOXES`, `armorSheet`, `armorGeometry`).
 */
import { DataArrayTexture, NearestFilter, NearestMipmapLinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import { ANIMATIONS, ATLAS_KEYS, CRACK_LAYER, CRACK_STAGES, frameLayers, layerOf, WATER_FRAMES, WATER_LAYER } from './keys';
import { TILE } from './pixels';
import { paintTexture } from './textures';

export { ANIMATION_FRAMES, ANIMATIONS, ATLAS_KEYS, CRACK_LAYER, CRACK_STAGES, faceLayer, frameKey, frameLayers, layerOf, MISSING_LAYER, WATER_FRAMES, WATER_LAYER } from './keys';
export { ARMOR_BOXES, ARMOR_SHEET, armorGeometry, armorSheet, RIG_SCALE, type ArmorBox, type ArmorMaterial, type ArmorPivot } from './armor';
export { GHAST_TENTACLES, VILLAGER_MODELS } from './models';
export { redstoneTint } from './textures';
export { blockIconPixels, heldAsBlock, ICON_SIZE, iconCell, itemIcon, itemSprite } from './icons';
export { TILE } from './pixels';

/** Structurally satisfies the engine's BlockAtlas ({ texture, layerOf }); sample the 16×16×N array with (u, v, layer). */
export interface BlockAtlas {
  readonly texture: DataArrayTexture;
  /** Layer for any atlas key ('crack_0'.., 'water_1'.., 'missing'); unknown keys map to 'missing'. */
  layerOf(key: string): number;
  readonly keys: readonly string[];
  /** Layers of the ten break stages, in order. */
  readonly crackLayers: readonly number[];
  /** Water animation frames, in order ('water', 'water_1'..). */
  readonly waterFrames: readonly number[];
  /** Frame layers of every animated key (water, lava, nether_portal, fire), in order. */
  readonly animations: Readonly<Record<string, readonly number[]>>;
}
const range = (start: number, n: number) => Array.from({ length: n }, (_, i) => start + i);

/** RGBA pixels of one atlas texture (16×16, row 0 = top). Handy for break particles. Do not mutate. */
export const texturePixels = (key: string): Uint8Array => paintTexture(key).data;

/** Every layer's pixels back to back. Transparent texels take their neighbours' colour so mipmaps never fringe dark. */
export function atlasPixels(): Uint8Array {
  const size = TILE * TILE * 4, out = new Uint8Array(size * ATLAS_KEYS.length);
  ATLAS_KEYS.forEach((key, layer) => out.set(paintTexture(key).copy().bleed().data, layer * size));
  return out;
}

/** Build a fresh atlas texture (the caller owns and disposes it). */
export function createBlockAtlas(): BlockAtlas {
  const texture = new DataArrayTexture(atlasPixels(), TILE, TILE, ATLAS_KEYS.length);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const animations = Object.fromEntries(Object.keys(ANIMATIONS).map(key => [key, frameLayers(key)]));
  return { texture, layerOf, keys: ATLAS_KEYS, crackLayers: range(CRACK_LAYER, CRACK_STAGES), waterFrames: range(WATER_LAYER, WATER_FRAMES), animations };
}
