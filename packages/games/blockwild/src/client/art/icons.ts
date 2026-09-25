/**
 * UI icons and held-item pixels. Blocks render as shaded isometric mini-blocks by ray-casting their real selection
 * boxes (so slabs, stairs and cactus look right); everything else is a flat 16×16 sprite shown with
 * `image-rendering: pixelated`.
 */
import { BLOCKS, blockOf, faceTexture, makeCell, type Shape } from '../../shared/blocks';
import { itemForBlock, itemOf } from '../../shared/items';
import { selectionBoxes, type Box } from '../../shared/shapes';
import { Pix } from './pixels';
import { pngDataUrl } from './png';
import { hasSprite, paintSprite } from './sprites';
import { paintTexture } from './textures';

export const ICON_SIZE = 64;
const FLAT: ReadonlySet<Shape> = new Set(['cross', 'crop', 'torch', 'ladder', 'door', 'lantern']);
/** Item actually drawn for an id (hidden technical blocks show their item: wheat crop → seeds, water → bucket). */
const shown = (id: number) => id > 0 && id < 256 ? itemForBlock(id) : id;
/** Sprite key for items drawn flat from a hand-made sprite (every non-block item, plus block items like the lever). */
const spriteOf = (item: number) => { const key = itemOf(item)?.key ?? ''; return item >= 256 || hasSprite(key) ? key : null; };

/** True when the item should be drawn as a small 3D block (in hand, dropped); false for flat sprites. */
export function heldAsBlock(id: number): boolean {
  const item = shown(id), block = item < 256 ? BLOCKS[item] : undefined;
  return !!block && block.render !== 'none' && !FLAT.has(block.shape) && spriteOf(item) === null;
}
/** Icon states: facing blocks show their front (south, the icon's left face), pistons face up, fences run east–west. */
const ICON_STATE: Partial<Record<Shape, number>> = { piston: 3, fence: 2 | 8 };
/** Cell value used to draw a block item (stairs rise away from the viewer). */
export function iconCell(id: number): number {
  const item = shown(id), block = blockOf(item);
  return makeCell(item, ICON_STATE[block.shape] ?? (block.state === 'facing' && block.shape !== 'stairs' ? 2 : 0));
}
const px = (n: number) => n / 16;
/** Icon geometry where the selection box would read poorly: a fence is two posts and two rails; a button is enlarged. */
const ICON_BOXES: Partial<Record<Shape, readonly Box[]>> = {
  button: [[px(3), px(5), px(5), px(13), px(11), px(11)]],
  fence: [[px(1), 0, px(6), px(5), 1, px(10)], [px(11), 0, px(6), px(15), 1, px(10)], [0, px(11), px(7), 1, px(14), px(9)], [0, px(5), px(7), 1, px(8), px(9)]],
};

/** 16×16 RGBA pixels for an item: its sprite, the flat block texture, or the side texture for full blocks. */
export function itemSprite(id: number): Uint8Array {
  const item = shown(id), sprite = spriteOf(item);
  if (sprite !== null) return paintSprite(sprite).data;
  return paintTexture(faceTexture(iconCell(item), heldAsBlock(item) ? 5 : 4)).data;
}

// Screen mapping: sx = CX + (x - z) * A, sy = CY + (x + z) * HB - y * C (2:1 dimetric), depth grows toward the viewer.
const A = 28, HB = 14, C = 32, CX = 32, CY = 2 + C, DEPTH_Y = (2 * HB) / C;
const SHADE = [0.5, 0.64, 0.45, 1, 0.5, 0.82];
type Hit = { depth: number; face: number; u: number; v: number };

/** Ray-cast one pixel against a box: returns the nearest face with an opaque texel. */
function castBox(cell: number, box: readonly number[], sx: number, sy: number, best: Hit | null): Hit | null {
  const [x0, y0, z0, x1, y1, z1] = box as [number, number, number, number, number, number];
  const U = (sx - CX) / A, e = 1e-6;
  const inside = (x: number, y: number, z: number) => x >= x0 - e && x <= x1 + e && y >= y0 - e && y <= y1 + e && z >= z0 - e && z <= z1 + e;
  const consider = (face: number, x: number, y: number, z: number, u: number, v: number) => {
    if (!inside(x, y, z)) return;
    const depth = x + z + DEPTH_Y * y;
    if (best && depth <= best.depth) return;
    const tex = paintTexture(faceTexture(cell, face)), tx = Math.min(15, Math.max(0, Math.floor(u * 16))), ty = Math.min(15, Math.max(0, Math.floor(v * 16)));
    if (tex.alpha(tx, ty)) best = { depth, face, u: tx, v: ty };
  };
  for (const [face, y] of [[3, y1], [2, y0]] as const) {
    const V = (sy - CY + y * C) / HB, x = (U + V) / 2, z = (V - U) / 2;
    consider(face, x, y, z, x, z);
  }
  for (const [face, x] of [[1, x1], [0, x0]] as const) {
    const z = x - U, y = ((x + z) * HB - (sy - CY)) / C;
    consider(face, x, y, z, face ? 1 - z : z, 1 - y);
  }
  for (const [face, z] of [[5, z1], [4, z0]] as const) {
    const x = z + U, y = ((x + z) * HB - (sy - CY)) / C;
    consider(face, x, y, z, face === 5 ? x : 1 - x, 1 - y);
  }
  return best;
}

/** 64×64 isometric mini-block with MC-style face shading (top bright, left mid, right dark). */
export function blockIconPixels(cell: number): Pix {
  const p = new Pix(ICON_SIZE, ICON_SIZE), boxes = ICON_BOXES[blockOf(cell).shape] ?? selectionBoxes(cell);
  for (let py = 0; py < ICON_SIZE; py++) for (let px = 0; px < ICON_SIZE; px++) {
    let hit: Hit | null = null;
    for (const box of boxes) hit = castBox(cell, box, px + 0.5, py + 0.5, hit);
    if (!hit) continue;
    const tex = paintTexture(faceTexture(cell, hit.face)), c = tex.rgb(hit.u, hit.v), f = SHADE[hit.face]!;
    const ch = (shift: number) => Math.min(255, Math.round(((c >> shift) & 255) * f));
    p.put(px, py, (ch(16) << 16) | (ch(8) << 8) | ch(0), tex.alpha(hit.u, hit.v));
  }
  return p;
}

const icons = new Map<number, string>();
/** Cached PNG data URL for an item icon (64×64 isometric block or 16×16 sprite; render with image-rendering: pixelated). */
export function itemIcon(id: number): string {
  let url = icons.get(id);
  if (!url) {
    if (heldAsBlock(id)) { const p = blockIconPixels(iconCell(id)); url = pngDataUrl(p.w, p.h, p.data); }
    else url = pngDataUrl(16, 16, itemSprite(id));
    icons.set(id, url);
  }
  return url;
}
