/**
 * Worn-armor art: one 64×64 skin sheet per material and the boxes it wraps, sized for the humanoid GLB rigs
 * (art/build_models.py: 32 px tall, pivots head (0,24,0), body (0,12,0), arms (±6,22,0), legs (±2,12,0), front −Z).
 *
 *   for (const box of ARMOR_BOXES) if (worn[box.slot]) rig.pivots[box.pivot]?.add(new Mesh(armorGeometry(box), material));
 *   material: MeshLambertMaterial({ map: new DataTexture(armorSheet(m).data, 64, 64) (sRGB, nearest), alphaTest: 0.5 })
 *
 * Sheet rows are top-first and UVs assume flipY = false (the DataTexture default). Cut-outs (helmet visor, open box
 * ends) are transparent, so use alphaTest. Chestplate boxes sit outside leggings (inflate 1 vs 0.5), like MC.
 */
import { BoxGeometry, Float32BufferAttribute } from 'three';
import type { ARMOR_MATERIALS } from '../../shared/items';
import { hash, Pix, pick, type Rgb } from './pixels';

export type ArmorMaterial = typeof ARMOR_MATERIALS[number];
export type ArmorPivot = 'head' | 'body' | 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r';
/** One armor box in rig pixels relative to its pivot; `uv` is the top-left of its MC-style unwrap in the sheet. */
export type ArmorBox = {
  readonly slot: 0 | 1 | 2 | 3; readonly pivot: ArmorPivot; readonly origin: readonly [number, number, number];
  readonly size: readonly [number, number, number]; readonly inflate: number; readonly uv: readonly [number, number];
};
export const ARMOR_SHEET = { w: 64, h: 64 } as const;
/** Metres per rig pixel of the player model (1.8 m / 32 px). */
export const RIG_SCALE = 1.8 / 32;

const box = (slot: ArmorBox['slot'], pivot: ArmorPivot, origin: ArmorBox['origin'], size: ArmorBox['size'], inflate: number, uv: ArmorBox['uv']): ArmorBox => ({ slot, pivot, origin, size, inflate, uv });
export const ARMOR_BOXES: readonly ArmorBox[] = [
  box(0, 'head', [-4, 0, -4], [8, 8, 8], 1, [0, 0]),
  box(1, 'body', [-4, 0, -2], [8, 12, 4], 1, [32, 0]),
  box(1, 'arm_l', [-2, -6, -2], [4, 8, 4], 1, [0, 16]), box(1, 'arm_r', [-2, -6, -2], [4, 8, 4], 1, [0, 16]),
  box(2, 'body', [-4, 0, -2], [8, 4, 4], 0.5, [16, 16]),
  box(2, 'leg_l', [-2, -10, -2], [4, 10, 4], 0.5, [40, 16]), box(2, 'leg_r', [-2, -10, -2], [4, 10, 4], 0.5, [40, 16]),
  box(3, 'leg_l', [-2, -12, -2], [4, 5, 4], 1, [16, 28]), box(3, 'leg_r', [-2, -12, -2], [4, 5, 4], 1, [16, 28]),
];

type Face = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
/** MC-style unwrap: row 0 = [ d | top w | bottom w ], row 1 = [ left d | front w | right d | back w ] (as build_models.py). */
function faceRects({ size: [w, h, d], uv: [ox, oy] }: ArmorBox): Record<Face, [number, number, number, number]> {
  return { top: [ox + d, oy, w, d], bottom: [ox + d + w, oy, w, d], left: [ox, oy + d, d, h], front: [ox + d, oy + d, w, h], right: [ox + d + w, oy + d, d, h], back: [ox + 2 * d + w, oy + d, w, h] };
}

/** W highlight, L light, M mid, D dark; trim accents the rims. */
const PALETTES: Record<ArmorMaterial, { ramp: readonly Rgb[]; trim: Rgb }> = {
  leather: { ramp: [0x5a3216, 0x7a4622, 0x94582c, 0xa86a38, 0xc08450], trim: 0xe0c08a },
  golden: { ramp: [0x8a5a08, 0xc98f16, 0xe4ad22, 0xf4c93a, 0xfff0a0], trim: 0xfff8d8 },
  iron: { ramp: [0x5e6268, 0x8d9197, 0xb4b8be, 0xd6d9dd, 0xf6f7f8], trim: 0xffffff },
  diamond: { ramp: [0x0f5e5a, 0x1f958b, 0x33cabe, 0x72f2e6, 0xd8fffb], trim: 0xf0fffe },
};
/** Brightness (0 dark .. 1 light, ≥ 0.95 = trim) of one texel, or null where the piece is open. */
type Paint = (face: Face, u: number, v: number, w: number, h: number) => number | null;
const side = (face: Face) => face !== 'top' && face !== 'bottom';

/** Per piece and box: which texels are solid and how bright. */
function piece(armor: ArmorBox, material: ArmorMaterial): Paint {
  const limb = armor.pivot !== 'body' && armor.pivot !== 'head';
  switch (armor.slot) {
    case 0: return (face, u, v, w, h) => {
      if (face === 'bottom') return null;
      if (face === 'front') {
        if (v < 3) return v === 2 ? 0.25 : 0.7;
        if (u === 0 || u === w - 1) return 0.45;
        return material !== 'leather' && (u === 3 || u === 4) && v < 6 ? 0.6 : null; // nose guard
      }
      if (face === 'top') return u === 3 || u === 4 ? 0.9 : 0.6;
      if (material === 'leather' && face !== 'back' && v > 5) return null;
      return v === h - 1 ? 0.2 : v === 0 ? 0.8 : 0.5;
    };
    case 1: return limb
      ? (face, _u, v, _w, h) => face === 'bottom' ? null : face === 'top' ? 0.85 : v === h - 1 ? 0.2 : v < 2 ? 0.75 : 0.5 // pauldron
      : (face, u, v, w, h) => {
        if (!side(face)) return face === 'bottom' ? null : u > 1 && u < w - 2 ? 0.25 : 0.7;
        if (v === 0) return 0.85;
        if (v === h - 1) return 0.15;
        if (face === 'front' && (u === 3 || u === 4)) return v % 3 === 1 ? 0.8 : 0.35;
        return v === 5 || v === 6 ? 0.65 : 0.5;
      };
    case 2: return limb
      ? (face, _u, v, _w, h) => !side(face) ? null : v === 4 || v === 5 ? (face === 'front' ? 0.85 : 0.65) : v === h - 1 ? 0.25 : 0.45
      : (face, u, v) => !side(face) ? null : v === 0 || v === 3 ? 0.25 : face === 'front' && (u === 3 || u === 4) ? 0.95 : 0.6; // belt + buckle
    case 3: return (face, _u, v, _w, h) => face === 'top' ? null : face === 'bottom' ? 0.05 : v === 0 ? 0.8 : v === h - 1 ? 0.1 : face === 'front' && v >= h - 3 ? 0.7 : 0.45;
  }
}

const sheets = new Map<ArmorMaterial, Pix>();
/** 64×64 RGBA armor skin for a material (rows top-first). Cached; do not mutate. */
export function armorSheet(material: ArmorMaterial): Pix {
  let sheet = sheets.get(material);
  if (sheet) return sheet;
  sheets.set(material, sheet = new Pix(ARMOR_SHEET.w, ARMOR_SHEET.h));
  const { ramp, trim } = PALETTES[material], seed = material.length * 131;
  for (const armor of ARMOR_BOXES) {
    const paint = piece(armor, material);
    for (const [face, [rx, ry, rw, rh]] of Object.entries(faceRects(armor)) as [Face, [number, number, number, number]][]) {
      for (let v = 0; v < rh; v++) for (let u = 0; u < rw; u++) {
        const t = paint(face, u, v, rw, rh);
        if (t === null) continue;
        const grain = (hash(rx + u, ry + v, seed) - 0.5) * (material === 'leather' ? 0.25 : 0.2);
        sheet.put(rx + u, ry + v, t >= 0.95 ? trim : pick(ramp, t + grain));
      }
    }
  }
  return sheet;
}

/** Image axes per BoxGeometry face (+X, −X, +Y, −Y, +Z, −Z): [face, u axis, u sign, v axis, v sign] as seen from outside. */
const AXES: readonly [Face, number, number, number, number][] = [
  ['right', 2, -1, 1, -1], ['left', 2, 1, 1, -1], ['top', 0, -1, 2, -1], ['bottom', 0, -1, 2, 1], ['back', 0, 1, 1, -1], ['front', 0, -1, 1, -1],
];
/** A ready BoxGeometry for an armor box, positioned relative to its pivot (in metres) with UVs into the sheet. */
export function armorGeometry(armor: ArmorBox, scale = RIG_SCALE): BoxGeometry {
  const dims = armor.size.map(s => (s + armor.inflate * 2) * scale), geometry = new BoxGeometry(dims[0], dims[1], dims[2]);
  const pos = geometry.getAttribute('position'), uv = new Float32Array(pos.count * 2), rects = faceRects(armor);
  for (let i = 0; i < pos.count; i++) {
    const [face, ua, us, va, vs] = AXES[i >> 2]!, [rx, ry, rw, rh] = rects[face], n = (axis: number) => pos.getComponent(i, axis) / dims[axis]!;
    uv[i * 2] = (rx + (0.5 + us * n(ua)) * rw) / ARMOR_SHEET.w;
    uv[i * 2 + 1] = (ry + (0.5 + vs * n(va)) * rh) / ARMOR_SHEET.h;
  }
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  const [ox, oy, oz] = armor.origin, [w, h, d] = armor.size;
  return geometry.translate((ox + w / 2) * scale, (oy + h / 2) * scale, (oz + d / 2) * scale);
}
