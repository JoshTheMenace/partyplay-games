/**
 * Pure camera maths for the phone map. The camera is a centre point in world units plus a zoom
 * over the "fit" scale (zoom 1 shows the whole island). Think of it as a magnifying glass held
 * over a printed board: cx/cy is where the glass sits, zoom is how strong it is.
 */
import { distance, type Point } from '../../geometry';
import type { Bounds } from '../../model';

export type Cam = { cx: number; cy: number; zoom: number };
export type Size = { width: number; height: number };

/** Minimum distance between two tappable spots on screen (EXPERIENCE §4.2, §7 check 16). */
export const SPOT_GAP_PX = 48;
export const MAX_ZOOM = 5;

/** Pixels per world unit when the whole box fits the container. */
export const fitScale = (box: Bounds, size: Size) =>
  Math.max(1e-6, Math.min(size.width / (box.maxX - box.minX), size.height / (box.maxY - box.minY)));

export const home = (box: Bounds): Cam => ({ cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, zoom: 1 });

/** Keeps the zoom in range and the view over the board (centred on an axis that already fits). */
export function clamp(cam: Cam, box: Bounds, size: Size, maxZoom = MAX_ZOOM): Cam {
  const zoom = Math.min(maxZoom, Math.max(1, cam.zoom)), ppu = fitScale(box, size) * zoom;
  const axis = (c: number, min: number, max: number, span: number) => {
    const half = span / ppu / 2;
    return half * 2 >= max - min ? (min + max) / 2 : Math.min(max - half, Math.max(min + half, c));
  };
  return {
    zoom, cx: axis(cam.cx, box.minX, box.maxX, size.width), cy: axis(cam.cy, box.minY, box.maxY, size.height),
  };
}

/** SVG viewBox for a camera: the visible world rectangle. */
export function viewBox(cam: Cam, box: Bounds, size: Size) {
  const ppu = fitScale(box, size) * cam.zoom, w = size.width / ppu, h = size.height / ppu;
  return { x: cam.cx - w / 2, y: cam.cy - h / 2, width: w, height: h, ppu };
}

/** Smallest distance between two distinct points (Infinity with fewer than two). */
export function minGap(points: readonly Point[]) {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = distance(points[i], points[j]);
      if (d > 1e-6 && d < min) min = d;
    }
  }
  return min;
}

/**
 * The camera that makes every pair of spots at least SPOT_GAP_PX apart, centred on the spots.
 * With no crowding it returns the whole-board view.
 */
export function autoZoom(points: readonly Point[], box: Bounds, size: Size): Cam {
  const gap = minGap(points);
  if (!points.length || gap === Infinity) return home(box);
  const zoom = (SPOT_GAP_PX * 1.02) / gap / fitScale(box, size);
  if (zoom <= 1) return home(box);
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const centre = { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
  return clamp({ ...centre, zoom }, box, size, Math.max(MAX_ZOOM, zoom));
}

/** Zoom by `factor` keeping the world point under screen point `at` (container px) fixed. */
export function zoomAt(cam: Cam, factor: number, at: Point, box: Bounds, size: Size, maxZoom = MAX_ZOOM): Cam {
  const before = fitScale(box, size) * cam.zoom;
  const world = { x: cam.cx + (at.x - size.width / 2) / before, y: cam.cy + (at.y - size.height / 2) / before };
  const zoom = Math.min(maxZoom, Math.max(1, cam.zoom * factor)), after = fitScale(box, size) * zoom;
  const next = {
    zoom, cx: world.x - (at.x - size.width / 2) / after, cy: world.y - (at.y - size.height / 2) / after,
  };
  return clamp(next, box, size, maxZoom);
}

/** Pan by a screen delta in px. */
export const panBy = (cam: Cam, dx: number, dy: number, box: Bounds, size: Size, maxZoom = MAX_ZOOM) => {
  const ppu = fitScale(box, size) * cam.zoom;
  return clamp({ ...cam, cx: cam.cx - dx / ppu, cy: cam.cy - dy / ppu }, box, size, maxZoom);
};

/** True when a world point lies inside the visible rectangle, shrunk by `margin` px. */
export function inView(p: Point, cam: Cam, box: Bounds, size: Size, margin = 24) {
  const v = viewBox(cam, box, size), m = margin / v.ppu;
  return p.x >= v.x + m && p.x <= v.x + v.width - m && p.y >= v.y + m && p.y <= v.y + v.height - m;
}
