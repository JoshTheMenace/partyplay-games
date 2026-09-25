/**
 * Numbers for the TV board (EXPERIENCE §1–§2). World units (wu): hex circumradius 1.
 * Scene axes: x east, y up, z south (world y), so the camera sits south and looks north.
 */
export const LAND_TOP = 0.3;
export const SEA_Y = 0.02;
/** Camera tilt from straight down. */
export const TILT = (32 * Math.PI) / 180;
export const TOKEN_Y = 0.3175;

export const INK = '#05071a';
export const CREAM = '#fff6e5';
export const SUN = '#ffd24a';
export const CORAL = '#ff5748';
export const BEACH = '#e8d6a6';
export const SHELF = '#2b86b8';

/** Draw order: tile < token < routes < buildings < robber < highlights (EXPERIENCE §1.4). */
export const ORDER = { tile: 0, token: 1, route: 2, building: 3, robber: 4, highlight: 5 } as const;

/** Same as manifest.assetBase; the UI may not import the manifest. */
export const MODEL_BASE = '/games/island-settlers/models/';

/** Robber stands toward the north-west edge midpoint; the merchant mirrors it to the north-east. */
export const ROBBER_DIR = { x: -0.5, y: -Math.sqrt(3) / 2 };
export const PIRATE_OFFSET = 0.35;

/** pieceScale from EXPERIENCE §1.7: pieces grow on small boards, tokens and the robber never do. */
export const pieceScale = (pxPerWu: number) => Math.min(1.2, Math.max(1, 80 / Math.max(1, pxPerWu)));

/** FNV-1a hash to [0, 1) for stable prop scatter and sea tint. */
export function hashUnit(seed: string, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}
