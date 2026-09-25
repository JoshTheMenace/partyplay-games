/**
 * A small runtime texture sheet of 16×16 block tiles and item sprites, plus the 3D meshes built from it:
 * blocks as mini cubes (slabs, stairs) and flat items as MC-style extruded sprites. Held items, dropped items,
 * remote players' hands and particles all sample this one texture.
 */
import { BufferGeometry, DataTexture, Float32BufferAttribute, MeshBasicMaterial, NearestFilter, RGBAFormat, SRGBColorSpace } from 'three';
import { blockOf, faceTexture, makeCell, SLAB_BOTTOM } from '../../shared/blocks';
import { isItem } from '../../shared/items';

/**
 * Pixel source (the art module): 16×16 RGBA (row-major, top row first) for block texture keys and flat item sprites,
 * and whether an item is drawn as a 3D block when held or dropped.
 */
export type SpritePixels = { tile(key: string): Uint8Array | null; item(id: number): Uint8Array | null; cube?(id: number): boolean };
export type Rect = readonly [number, number, number, number];

const CUBE_SHAPES = new Set(['cube', 'slab', 'stairs', 'cactus', 'farmland']);
const SIZE = 512, TILE = 16, PER_ROW = SIZE / TILE, INSET = 0.02 / SIZE;

/** Lazily packed 512×512 sheet (1024 tiles). Tile 0 is solid white for untextured particles. */
export class SpriteSheet {
  readonly data = new Uint8Array(SIZE * SIZE * 4);
  readonly texture = new DataTexture(this.data, SIZE, SIZE, RGBAFormat);
  private readonly rects = new Map<string, Rect | null>();
  private readonly pixels = new Map<string, Uint8Array>();
  private next = 1;
  readonly white: Rect;

  constructor(private readonly source: SpritePixels) {
    this.texture.magFilter = this.texture.minFilter = NearestFilter;
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.white = this.pack('white', new Uint8Array(TILE * TILE * 4).fill(255))!;
  }
  private pack(key: string, px: Uint8Array): Rect | null {
    if (this.next >= PER_ROW * PER_ROW) return null;
    const slot = this.next++, tx = slot % PER_ROW, ty = Math.floor(slot / PER_ROW);
    for (let y = 0; y < TILE; y++) {
      // Texture row 0 is the bottom (v = 0): flip so the sprite's top row sits at the top of its cell.
      const row = (ty * TILE + TILE - 1 - y) * SIZE + tx * TILE;
      this.data.set(px.subarray(y * TILE * 4, (y + 1) * TILE * 4), row * 4);
    }
    this.texture.needsUpdate = true;
    const rect: Rect = [tx * TILE / SIZE + INSET, ty * TILE / SIZE + INSET, (tx + 1) * TILE / SIZE - INSET, (ty + 1) * TILE / SIZE - INSET];
    this.rects.set(key, rect);
    this.pixels.set(key, px);
    return rect;
  }
  private get(key: string, load: () => Uint8Array | null): Rect | null {
    const known = this.rects.get(key);
    if (known !== undefined) return known;
    const px = load();
    if (!px || px.length < TILE * TILE * 4) { this.rects.set(key, null); return null; }
    return this.pack(key, px);
  }
  /** UV rect of a block texture key. */
  tile(key: string) { return this.get(`t:${key}`, () => this.source.tile(key)); }
  /** UV rect of an item's flat sprite. */
  item(id: number) { return this.get(`i:${id}`, () => this.source.item(id)); }
  /** Pixels of a packed tile (`t:<key>`) or item (`i:<id>`). */
  pixelsOf(key: string) { return this.pixels.get(key) ?? null; }
  /** True when an item is drawn as a mini block. */
  isCube(id: number) { return this.source.cube ? this.source.cube(id) : id < 256 && CUBE_SHAPES.has(blockOf(id).shape); }
  /** Random 4×4 texel sub-rect of a tile for break chips (writes into `out`). */
  chip(rect: Rect, rand: () => number, out: number[]) {
    const w = (rect[2] - rect[0]) / 4, h = (rect[3] - rect[1]) / 4, x = rect[0] + Math.floor(rand() * 3) * w + rand() * w, y = rect[1] + Math.floor(rand() * 3) * h + rand() * h;
    out[0] = x; out[1] = y; out[2] = x + w; out[3] = y + h;
  }
}

// Geometry builders ---------------------------------------------------------------------------------------------
type Buffers = { pos: number[]; uv: number[]; col: number[] };
/** Quad from 4 corners (counter-clockwise seen from the front) with a UV rect and brightness. */
function quad(b: Buffers, corners: readonly number[], rect: Rect, shade: number, flipU = false) {
  const [u0, v0, u1, v1] = rect, us = flipU ? [u1, u0, u0, u1] : [u0, u1, u1, u0], vs = [v0, v0, v1, v1];
  for (const i of [0, 1, 2, 0, 2, 3]) {
    b.pos.push(corners[i * 3]!, corners[i * 3 + 1]!, corners[i * 3 + 2]!);
    b.uv.push(us[i]!, vs[i]!);
    b.col.push(shade, shade, shade);
  }
}
function finish(b: Buffers) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(b.pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(b.uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(b.col, 3));
  g.computeBoundingSphere();
  return g;
}
/** MC-style face brightness: -X,+X,-Y,+Y,-Z,+Z. */
export const FACE_SHADE = [0.62, 0.62, 0.5, 1, 0.8, 0.8] as const;

/** Axis-aligned box (local 0..1 coords, centred later) with per-face UV rects cropped to the box extent. */
function box(b: Buffers, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, rects: readonly Rect[]) {
  const crop = (r: Rect, a0: number, a1: number, c0: number, c1: number): Rect => [r[0] + (r[2] - r[0]) * a0, r[1] + (r[3] - r[1]) * c0, r[0] + (r[2] - r[0]) * a1, r[1] + (r[3] - r[1]) * c1];
  const faces: [number, number[], Rect][] = [
    [0, [x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], crop(rects[0]!, z0, z1, y0, y1)],
    [1, [x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1], crop(rects[1]!, 1 - z1, 1 - z0, y0, y1)],
    [2, [x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], crop(rects[2]!, x0, x1, z0, z1)],
    [3, [x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], crop(rects[3]!, x0, x1, 1 - z1, 1 - z0)],
    [4, [x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0], crop(rects[4]!, 1 - x1, 1 - x0, y0, y1)],
    [5, [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], crop(rects[5]!, x0, x1, y0, y1)],
  ];
  for (const [face, corners, rect] of faces) quad(b, corners, rect, FACE_SHADE[face]!);
}

/** A box in block-local coordinates with the same UV rect on every face (crack overlays). */
export function boxGeometry(b: readonly number[], rect: Rect) {
  const buffers: Buffers = { pos: [], uv: [], col: [] };
  box(buffers, b[0]!, b[1]!, b[2]!, b[3]!, b[4]!, b[5]!, [rect, rect, rect, rect, rect, rect]);
  return finish(buffers);
}

/** Mini block centred on the origin, 1 unit wide. Handles cubes, slabs and stairs. */
export function blockGeometry(block: number, rects: readonly Rect[]) {
  const b: Buffers = { pos: [], uv: [], col: [] }, shape = blockOf(block).shape;
  if (shape === 'slab') box(b, 0, 0, 0, 1, 0.5, 1, rects);
  else if (shape === 'stairs') {
    box(b, 0, 0, 0, 1, 0.5, 1, rects);
    box(b, 0, 0.5, 0, 1, 1, 0.5, rects);
  } else if (shape === 'cactus') box(b, 1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16, rects);
  else box(b, 0, 0, 0, 1, shape === 'farmland' ? 15 / 16 : 1, 1, rects);
  for (let i = 0; i < b.pos.length; i++) b.pos[i]! -= 0.5;
  return finish(b);
}

/**
 * Extruded sprite: front and back quads plus a one-texel-deep side wall wherever an opaque pixel borders a
 * transparent one. 1 unit square in the XY plane centred on the origin, `depth` thick along Z.
 */
export function extrudedGeometry(px: Uint8Array, rect: Rect, depth = 1 / 16) {
  const b: Buffers = { pos: [], uv: [], col: [] }, z0 = -depth / 2, z1 = depth / 2, s = 1 / TILE;
  quad(b, [-0.5, -0.5, z1, 0.5, -0.5, z1, 0.5, 0.5, z1, -0.5, 0.5, z1], rect, 1);
  quad(b, [0.5, -0.5, z0, -0.5, -0.5, z0, -0.5, 0.5, z0, 0.5, 0.5, z0], rect, 0.8, true);
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < TILE && y < TILE && px[(y * TILE + x) * 4 + 3]! >= 128;
  const du = (rect[2] - rect[0]) / TILE, dv = (rect[3] - rect[1]) / TILE;
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    if (!solid(x, y)) continue;
    // Pixel (x, y) spans [x0, x1] × [y0, y1] with y flipped (top row at +0.5).
    const x0 = -0.5 + x * s, x1 = x0 + s, y1 = 0.5 - y * s, y0 = y1 - s;
    const u = rect[0] + (x + 0.5) * du, v = rect[3] - (y + 0.5) * dv, texel: Rect = [u, v, u, v];
    if (!solid(x - 1, y)) quad(b, [x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], texel, 0.7);
    if (!solid(x + 1, y)) quad(b, [x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1], texel, 0.7);
    if (!solid(x, y - 1)) quad(b, [x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], texel, 0.9);
    if (!solid(x, y + 1)) quad(b, [x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], texel, 0.55);
  }
  return finish(b);
}

export type ItemModel = { geometry: BufferGeometry; cube: boolean };

/** Geometry per item id (cached): mini cubes for block items with a solid shape, extruded sprites otherwise. */
export class ItemModels {
  private readonly cache = new Map<number, ItemModel | null>();
  private readonly materials: MeshBasicMaterial[] = [];
  constructor(readonly sheet: SpriteSheet) {}

  model(id: number): ItemModel | null {
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;
    const model = isItem(id) ? this.build(id) : null;
    this.cache.set(id, model);
    return model;
  }
  private build(id: number): ItemModel | null {
    if (id < 256 && this.sheet.isCube(id)) {
      const block = blockOf(id), cell = makeCell(id, block.shape === 'slab' ? SLAB_BOTTOM : block.state === 'facing' && block.shape !== 'stairs' ? 2 : 0);
      const rects = [0, 1, 2, 3, 4, 5].map(face => this.sheet.tile(faceTexture(cell, face)) ?? this.sheet.white);
      return { geometry: blockGeometry(id, rects), cube: true };
    }
    // Flat items (and plants, torches, doors) are extruded from their sprite.
    const rect = this.sheet.item(id), px = rect && this.sheet.pixelsOf(`i:${id}`);
    return rect && px ? { geometry: extrudedGeometry(px, rect), cube: false } : null;
  }
  /**
   * Shared unlit material at one of 32 brightness steps (spaced finer in the dark), so dropped and held items follow
   * the world light linearly, like the terrain shader, without per-entity materials.
   */
  material(light: number): MeshBasicMaterial {
    const level = Math.round(Math.sqrt(Math.max(0, Math.min(1, light))) * 31);
    let material = this.materials[level];
    if (!material) {
      material = new MeshBasicMaterial({ map: this.sheet.texture, vertexColors: true, alphaTest: 0.5 });
      material.color.setScalar(Math.max(0.012, (level / 31) ** 2));
      this.materials[level] = material;
    }
    return material;
  }
  dispose() {
    for (const model of this.cache.values()) model?.geometry.dispose();
    for (const m of this.materials) m?.dispose();
    this.sheet.texture.dispose();
  }
}
