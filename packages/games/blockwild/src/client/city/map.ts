/**
 * The city map: the plan painted once into a canvas at one pixel a block (streets, what stands on every lot, the trade
 * signs of the places that do something), then drawn into the HUD's minimap, the full map and the TV with markers on top.
 */
import { AIRFIELD, BEACH, CITY, CITY_SIZE, footprint, lotCell, QUAY, type CityPlan, type Lot, type LotKind, type PlaceKind } from '../../shared/city/plan';
import { SIGNS } from '../../shared/city/buildings';
import { SIGN_COLORS, SIGN_ICONS } from '../art/city';

/** The world rectangle the map covers (blocks), and its size in pixels. */
export const MAP = { x0: CITY.x0 - QUAY - 14, z0: CITY.z0 - QUAY - 14, w: CITY_SIZE + QUAY + 14 + AIRFIELD.w + 22, h: CITY_SIZE + QUAY + 14 + BEACH + 44 } as const;
const GROUND: Record<LotKind, string> = {
  shop: '#b9b3a3', boutique: '#b9b3a3', office: '#b9b3a3', flats: '#b9b3a3', house: '#8fbf74', warehouse: '#5b5e68', plot: '#86c06a', park: '#6fb863', hall: '#d6cdb4', bank: '#d6cdb4', hotel: '#d6cdb4',
  clinic: '#d6cdb4', watch: '#d6cdb4', school: '#d6cdb4', market: '#d6cdb4', cinema: '#d6cdb4', fair: '#8fbf74', garage: '#5b5e68', depot: '#5b5e68', scrap: '#8a8273', hangar: '#a9abb0',
};
const ROOF: Partial<Record<LotKind, string>> = {
  shop: '#d59a52', boutique: '#c9a987', office: '#7f93ab', flats: '#b0786a', house: '#b5503a', warehouse: '#7d838e', hall: '#f1ead6', bank: '#e9dcbc', hotel: '#e6b89c', clinic: '#f1f1ec', watch: '#3b4f8f',
  school: '#c19a6b', cinema: '#c3b3d8', garage: '#e6e8ea', depot: '#3a8fbf', scrap: '#e0b23c', hangar: '#e6e8ea',
};
/** Context options for every map canvas (see paintCityMap). */
export const SOFT: CanvasRenderingContext2DSettings = { willReadFrequently: true };
const rect = (ctx: CanvasRenderingContext2D, x0: number, z0: number, x1: number, z1: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(Math.min(x0, x1) - MAP.x0, Math.min(z0, z1) - MAP.z0, Math.abs(x1 - x0) + 1, Math.abs(z1 - z0) + 1); };

function paintLot(ctx: CanvasRenderingContext2D, lot: Lot) {
  rect(ctx, lot.x0, lot.z0, lot.x1, lot.z1, GROUND[lot.kind]);
  const local = (u0: number, v0: number, u1: number, v1: number, color: string) => { const [xa, za] = lotCell(lot, u0, v0), [xb, zb] = lotCell(lot, u1, v1); rect(ctx, xa, za, xb, zb, color); };
  const box = footprint(lot), roof = ROOF[lot.kind];
  if (box && roof) { local(box[0], box[1], box[2], box[3], '#00000038'); local(box[0], box[1], box[2] - 1, box[3] - 1, roof); }
  if (lot.kind === 'park') { local(18, 18, 29, 29, '#4d9ad0'); local(23, 0, 24, 47, '#cfc7ad'); local(0, 23, 47, 24, '#cfc7ad'); }
  if (lot.kind === 'plot') rect(ctx, lot.x0 + 5, lot.z0 + 5, lot.x0 + 16, lot.z0 + 16, '#a98f5e');
  if (lot.kind === 'hangar') { local(4, 44, lot.z1 - lot.z0 - 4, 64, '#3a3d46'); for (const u of [120, 200]) local(u, 8, u + 30, 30, '#8fa3b8'); for (const u of [14, 44]) local(u - 4, 20, u + 4, 28, '#3a3d46'); }
}

/** Paint the whole city once. Returns null where there is no canvas (tests). */
export function paintCityMap(plan: CityPlan): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  // CPU-backed canvases throughout the map: drawing one into another must never wait on the GPU the 3D scene is using.
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', SOFT);
  if (!ctx) return null;
  canvas.width = MAP.w;
  canvas.height = MAP.h;
  ctx.fillStyle = '#2f79ad';
  ctx.fillRect(0, 0, MAP.w, MAP.h);
  const x0 = CITY.x0, z0 = CITY.z0, x1 = x0 + CITY_SIZE - 1, z1 = z0 + CITY_SIZE - 1;
  // The beach, the quay round the grid, the airfield, then the streets.
  rect(ctx, x0 - QUAY, z1 + QUAY, x1 + QUAY, z1 + QUAY + BEACH - 8, '#e6d59a');
  rect(ctx, x0 - QUAY, z0 - QUAY, x1 + QUAY, z1 + QUAY, '#cfc7ad');
  rect(ctx, AIRFIELD.x0 - 4, AIRFIELD.z0 - 4, AIRFIELD.x0 + AIRFIELD.w + 3, AIRFIELD.z0 + AIRFIELD.d + 3, '#cfc7ad');
  rect(ctx, x0, z0, x1, z1, '#9a9ca3');
  for (let k = 0; k <= CITY.n; k++) {
    rect(ctx, x0 + k * CITY.pitch + 3, z0, x0 + k * CITY.pitch + 12, z1, '#3a3d46');
    rect(ctx, x0, z0 + k * CITY.pitch + 3, x1, z0 + k * CITY.pitch + 12, '#3a3d46');
  }
  for (const lot of plan.lots) paintLot(ctx, lot);
  return canvas;
}

/** A place's sign as a small canvas: its trade's colour with the white pixel icon. */
const signs = new Map<PlaceKind, HTMLCanvasElement>();
export function signFor(kind: PlaceKind): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  let sign = signs.get(kind);
  if (!sign) {
    const [icon, band] = SIGNS[kind], ctx = (sign = document.createElement('canvas')).getContext('2d', SOFT)!;
    sign.width = sign.height = 14;
    ctx.fillStyle = SIGN_COLORS[band]!;
    ctx.fillRect(0, 0, 14, 14);
    ctx.fillStyle = '#10142e';
    ctx.fillRect(1, 1, 12, 12);
    ctx.fillStyle = '#fff6e5';
    SIGN_ICONS[icon]!.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') ctx.fillRect(1 + x, 1 + y, 1, 1); }));
    signs.set(kind, sign);
  }
  return sign;
}
/** A place's sign as a data URL, for lists in the UI. */
export const signUrl = (kind: PlaceKind) => signFor(kind)?.toDataURL() ?? '';

export type Marker = { x: number; z: number; color: string; kind: 'self' | 'player' | 'gig' | 'home' | 'plot' | 'hot'; yaw?: number; label?: string };
/**
 * Draw the map into `ctx` (a square of `size` CSS pixels): `span` world blocks across, centred on (cx, cz), north up,
 * with the places' signs and the markers on top (those outside are pinned to the edge). `signs`: draw the trade signs.
 */
export function drawMap(ctx: CanvasRenderingContext2D, base: HTMLCanvasElement, plan: CityPlan, w: number, h: number, cx: number, cz: number, span: number, markers: readonly Marker[], withSigns: boolean) {
  const scale = w / span, left = cx - span / 2, top = cz - (h / scale) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#2f79ad';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(base, left - MAP.x0, top - MAP.z0, span, h / scale, 0, 0, w, h);
  const px = (x: number) => (x - left) * scale, pz = (z: number) => (z - top) * scale, sign = Math.max(10, Math.min(18, scale * 9));
  if (withSigns) for (const place of plan.places) {
    const x = px(place.counter[0]), z = pz(place.counter[1]), icon = signFor(place.kind);
    if (icon && x > -sign && z > -sign && x < w + sign && z < h + sign) ctx.drawImage(icon, Math.round(x - sign / 2), Math.round(z - sign / 2), sign, sign);
  }
  for (const marker of markers) {
    const inside = marker.kind === 'gig' || marker.kind === 'home' || marker.kind === 'plot' ? 9 : -6;
    const x = inside > 0 ? Math.max(inside, Math.min(w - inside, px(marker.x))) : px(marker.x), z = inside > 0 ? Math.max(inside, Math.min(h - inside, pz(marker.z))) : pz(marker.z);
    if (x < -8 || z < -8 || x > w + 8 || z > h + 8) continue;
    ctx.save();
    ctx.translate(x, z);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#05071a';
    ctx.fillStyle = marker.color;
    if (marker.kind === 'self') {
      // An arrowhead pointing where the player faces (yaw 0 is north, turning left as it grows).
      ctx.rotate(-(marker.yaw ?? 0));
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    } else if (marker.kind === 'gig') {
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-5, -5, 10, 10);
      ctx.fillRect(-5, -5, 10, 10);
    } else if (marker.kind === 'home' || marker.kind === 'plot') {
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.lineTo(7, 0); ctx.lineTo(5, 0); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.lineTo(-5, 0); ctx.lineTo(-7, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, marker.kind === 'hot' ? 6 : 4.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
      if (marker.kind === 'hot') { ctx.strokeStyle = '#ff5748'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.stroke(); }
    }
    if (marker.label) {
      ctx.font = '800 11px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeText(marker.label, 0, -10);
      ctx.fillStyle = '#fff6e5';
      ctx.fillText(marker.label, 0, -10);
    }
    ctx.restore();
  }
}
