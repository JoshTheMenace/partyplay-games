import { hulls } from '../definitions/presentation/index';
import { iconPath } from './cutaway';
/** Compact silhouettes in a 100x60 box, facing right. The eight player hulls derive from their authored cutaway exteriors so icons match the ships players see; enemy fallbacks share the language with sharper edges. */
export const HULL_PATHS: Record<string, string> = {
  ...Object.fromEntries(hulls.map(hull => [hull.id, iconPath(hull.id, { w: Math.max(1, ...hull.rooms.map(r => r.x + r.w)), h: Math.max(1, ...hull.rooms.map(r => r.y + r.h)) })])),
  enemy: 'M2 30 L24 8 H72 L98 30 L72 52 H24 Z M28 20 H66 V40 H28 Z',
  flagship: 'M2 30 L14 16 H40 L48 4 H70 L96 30 L70 56 H48 L40 44 H14 Z M20 22 H60 V38 H20 Z',
};
export const hullPath = (hullId: string, flagship = false) => HULL_PATHS[hullId] ?? HULL_PATHS[flagship ? 'flagship' : 'enemy'];
const cache = new Map<string, Path2D>();
export function hullPath2D(hullId: string, flagship = false) {
  const key = hullId + (flagship ? '!' : '');
  let path = cache.get(key); if (!path) { path = new Path2D(hullPath(hullId, flagship)); cache.set(key, path); }
  return path;
}
/** Draws a silhouette into a box, keeping aspect and the platform's ink outline. */
export function drawHull(ctx: CanvasRenderingContext2D, hullId: string, box: { x: number; y: number; w: number; h: number }, color: string, options: { flagship?: boolean; destroyed?: boolean; facing?: 1 | -1 } = {}) {
  const scale = Math.min(box.w / 100, box.h / 60), facing = options.facing ?? 1;
  ctx.save(); ctx.translate(box.x + box.w / 2, box.y + box.h / 2); ctx.scale(scale * facing, scale); ctx.translate(-50, -30);
  ctx.lineJoin = 'round'; ctx.lineWidth = 4 / scale; ctx.strokeStyle = '#05071a';
  ctx.fillStyle = options.destroyed ? '#3a3f5a' : color; ctx.globalAlpha = options.destroyed ? .55 : 1;
  const path = hullPath2D(hullId, options.flagship); ctx.fill(path, 'nonzero'); ctx.stroke(path);
  ctx.restore();
}
