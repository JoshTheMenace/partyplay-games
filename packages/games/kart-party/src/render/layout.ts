/* Viewport layout: the single source of rectangles for both the WebGL scissor and the HUD overlays.
 * Rects are normalised with y measured from the top (CSS convention). OWNER: render-world agent. */
import type { ScreenMode } from '../views';
import type { ViewRect, Viewport } from './types';

const FULL: ViewRect = { x: 0, y: 0, w: 1, h: 1 };

/** Grid shape for n split views: 1 full, 2 stacked, 3–4 as 2×2, then wider grids for forced TV mode. */
export function gridShape(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 1, rows: 2 };
  if (n <= 4) return { cols: 2, rows: 2 };
  if (n <= 6) return { cols: 3, rows: 2 };
  if (n <= 9) return { cols: 3, rows: 3 };
  return { cols: 4, rows: 3 };
}

/** Every cell of the split grid in reading order (may contain more cells than views). */
export function splitRects(n: number): ViewRect[] {
  const { cols, rows } = gridShape(n), rects: ViewRect[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) rects.push({ x: c / cols, y: r / rows, w: 1 / cols, h: 1 / rows });
  return rects;
}

/** Viewports for this device. Split: one chase view per TV racer in stable order, and an overview
 * camera in the first spare cell (the 3-player 4th quadrant). Personal/spectator: one full view. */
export function planViewports(mode: ScreenMode, racerIds: readonly string[], ownId: string | null, followId: string | null): Viewport[] {
  if (mode === 'controls') return [];
  if (mode === 'personal') return [{ rect: FULL, racerId: ownId, kind: 'chase' }];
  if (mode === 'spectator' || racerIds.length === 0) return [{ rect: FULL, racerId: followId, kind: 'chase' }];
  const ids = racerIds.slice(0, 10), rects = splitRects(ids.length);
  const views: Viewport[] = ids.map((racerId, i) => ({ rect: rects[i], racerId, kind: 'chase' }));
  if (rects.length > ids.length) views.push({ rect: rects[ids.length], racerId: null, kind: 'overview' });
  return views;
}

export type PixelRect = { x: number; y: number; w: number; h: number };
/** Device-pixel rect for WebGL (origin bottom-left). Interior edges are inset by half a gutter so
 * split views are separated by a thin divider of the clear colour; canvas borders stay flush. */
export function viewportPixels(rect: ViewRect, width: number, height: number, gutter: number, out: PixelRect = { x: 0, y: 0, w: 0, h: 0 }): PixelRect {
  const g = gutter / 2, eps = 1e-6;
  const left = rect.x * width + (rect.x > eps ? g : 0), right = (rect.x + rect.w) * width - (rect.x + rect.w < 1 - eps ? g : 0);
  const top = rect.y * height + (rect.y > eps ? g : 0), bottom = (rect.y + rect.h) * height - (rect.y + rect.h < 1 - eps ? g : 0);
  out.x = Math.round(left); out.w = Math.max(1, Math.round(right) - out.x);
  out.y = Math.round(height - bottom); out.h = Math.max(1, Math.round(height - top) - out.y);
  return out;
}
