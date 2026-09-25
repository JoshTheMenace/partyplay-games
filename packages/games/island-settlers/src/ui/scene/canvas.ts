/**
 * Canvas textures: number tokens, harbour plaques, the emblem atlas, seat pins, spot marks, fishing
 * signs, the river ribbon and the sea gradient (EXPERIENCE §1.1, §1.4–§1.6). Each is drawn once per
 * round and cached by key.
 */
import { CanvasTexture, SRGBColorSpace } from 'three';
import { pips } from '../../geometry';
import type { Resource } from '../../model';
import { EMBLEMS, EMBLEM_PATHS } from '../shared/emblems';
import { ICON_PATHS } from '../shared/icon-paths';
import { GOOD_META } from '../shared/labels';
import { SEATS } from '../shared/seats';
import type { ResourceScope } from '../../../../../party-runtime/src/index';
import { CREAM, INK } from './constants';

const RED = '#c62a22', FONT = '"Lilita One", "Arial Black", sans-serif';
export const ATLAS = { columns: 5, rows: 2 } as const;

type Paint = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** Font size whose digits are `px` tall. */
function digitFont(ctx: CanvasRenderingContext2D, px: number) {
  ctx.font = `100px ${FONT}`;
  const m = ctx.measureText('0123456789');
  const size = (100 * px) / Math.max(1, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
  ctx.font = `${size}px ${FONT}`;
}

/** Draw text centred on (x, y) with digit height px, squeezed to maxWidth. */
function numeral(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, max: number) {
  digitFont(ctx, px);
  const width = ctx.measureText(text).width, squeeze = Math.min(1, max / width);
  ctx.save();
  ctx.translate(x, y + px / 2);
  ctx.scale(squeeze, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function emblem(ctx: CanvasRenderingContext2D, index: number, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fill(new Path2D(EMBLEM_PATHS[EMBLEMS[index % EMBLEMS.length]]));
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Token face: 256 px = 0.58 wu, so 1 wu ≈ 441 px. */
const paintToken = (n: number): Paint => (ctx, w) => {
  const c = w / 2, wu = w / 0.58, ink = n === 6 || n === 8 ? RED : INK;
  ctx.fillStyle = CREAM;
  ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 0.016 * wu;
  ctx.beginPath(); ctx.arc(c, c, c - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = ink;
  numeral(ctx, String(n), c, c - 0.035 * wu, 0.22 * wu, 0.4 * wu);
  const count = pips(n), pitch = 0.058 * wu;
  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    ctx.arc(c + (i - (count - 1) / 2) * pitch, c + 0.13 * wu, 0.022 * wu, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** Plaque face 0.72 × 0.40 wu: cream, resource band on the left, the ratio. */
const paintPlaque = (good: Resource | 'any', ratio: number): Paint => (ctx, w, h) => {
  const wu = w / 0.72, line = 0.02 * wu;
  roundRect(ctx, line / 2, line / 2, w - line, h - line, 0.08 * wu);
  ctx.fillStyle = CREAM; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = good === 'any' ? INK : GOOD_META[good].color;
  ctx.fillRect(0, 0, 0.1 * wu + line, h);
  ctx.restore();
  ctx.strokeStyle = INK; ctx.lineWidth = line; ctx.stroke();
  ctx.fillStyle = INK;
  numeral(ctx, `${ratio}:1`, (0.1 * wu + w) / 2, h / 2, 0.18 * wu, 0.54 * wu);
};

/** Emblems in white on a 5 × 2 grid of 128 px cells; the decal shader tints them ink. */
const paintAtlas: Paint = ctx => {
  ctx.fillStyle = '#fff';
  EMBLEMS.forEach((_, i) =>
    emblem(ctx, i, (i % ATLAS.columns) * 128 + 64, Math.floor(i / ATLAS.columns) * 128 + 64, 104));
};

/** Seat chip: seat fill, ink ring, ink emblem (victim pins). */
const paintChip = (seat: number): Paint => (ctx, w) => {
  const c = w / 2;
  ctx.fillStyle = SEATS[seat % SEATS.length].body;
  ctx.beginPath(); ctx.arc(c, c, c * 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = w * 0.08; ctx.stroke();
  ctx.fillStyle = INK;
  emblem(ctx, seat, c, c, w * 0.5);
};

/** Cream mark with an ink edge: a dot for corners, a dash for edges. */
const paintSpot = (dash: boolean): Paint => (ctx, w, h) => {
  const line = h * 0.16;
  if (dash) roundRect(ctx, line, line, w - 2 * line, h - 2 * line, h / 2);
  else { ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - line, 0, Math.PI * 2); }
  ctx.fillStyle = CREAM; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = line; ctx.stroke();
};

/** Fishing sign decal (0.26 × 0.30 wu): an ink fish over its numbers at 0.12 wu digits (EXPERIENCE §1.5). */
const paintFishSign = (numbers: number[]): Paint => (ctx, w, h) => {
  const wu = h / 0.3;
  ctx.fillStyle = INK;
  ctx.save();
  ctx.translate(w / 2 - 0.05 * wu, 0.02 * wu);
  ctx.scale((0.1 * wu) / 24, (0.1 * wu) / 24);
  ctx.fill(new Path2D(ICON_PATHS.fish), 'evenodd');
  ctx.restore();
  numeral(ctx, numbers.join('·'), w / 2, h - 0.1 * wu, 0.12 * wu, w * 0.94);
};

/** River ribbon: dark banks, water, and a light centre dash that scrolls along u. */
const paintRiver: Paint = (ctx, w, h) => {
  ctx.fillStyle = '#25689a'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#4fa6d9'; ctx.fillRect(0, h * 0.14, w, h * 0.72);
  ctx.fillStyle = '#bfe4f7'; roundRect(ctx, w * 0.1, h * 0.44, w * 0.45, h * 0.12, h * 0.06); ctx.fill();
};

const paintOcean: Paint = (ctx, w) => {
  const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  g.addColorStop(0, '#1d6b9e'); g.addColorStop(0.55, '#155a88'); g.addColorStop(1, '#0b2d4f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
};

export function textures(scope: ResourceScope) {
  const cache = new Map<string, CanvasTexture>();
  /** decal: GLB decal quads use glTF UVs (v = 0 at the image top), so the canvas must not flip. */
  const make = (key: string, w: number, h: number, paint: Paint, decal = false) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    paint(canvas.getContext('2d')!, w, h);
    const texture = scope.own(new CanvasTexture(canvas));
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    texture.flipY = !decal;
    cache.set(key, texture);
    return texture;
  };
  return {
    token: (n: number) => make(`token${n}`, 256, 256, paintToken(n)),
    plaque: (good: Resource | 'any', ratio: number) =>
      make(`plaque${good}${ratio}`, 288, 160, paintPlaque(good, ratio)),
    atlas: () => make('atlas', 640, 256, paintAtlas, true),
    chip: (seat: number) => make(`chip${seat}`, 128, 128, paintChip(seat)),
    dot: () => make('dot', 64, 64, paintSpot(false)),
    dash: () => make('dash', 128, 32, paintSpot(true)),
    ocean: () => make('ocean', 512, 512, paintOcean),
    fishSign: (numbers: number[]) => make(`fish${numbers.join(',')}`, 224, 256, paintFishSign(numbers), true),
    river: () => make('river', 64, 32, paintRiver),
  };
}
export type Textures = ReturnType<typeof textures>;
