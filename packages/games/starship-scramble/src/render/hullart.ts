/** Procedural hull art used until (or instead of) the Blender renders: same sprite convention, a hull image plus a white paint mask. */
import type { HullDef } from '../contracts';
import { SPRITE_MARGIN_X as MX, SPRITE_MARGIN_Y as MY, SPRITE_PPC as P } from '../defs/geometry';

export const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
export const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** Grid-relative x (cells) where engine nozzles end; live plumes start here for both art sources. */
export const NOZZLE_X = -1.25;

type Shape = 'smooth' | 'angular' | 'organic' | 'block' | 'blade';
type Style = { shape: Shape; metal: [string, string]; nose: number; trim?: string; lights?: string };
const RAIDER: Style = { shape: 'angular', metal: ['#b9ab9c', '#4d4038'], nose: 1.3 }, ARMADA: Style = { shape: 'blade', metal: ['#9b9aa6', '#2f2d38'], nose: 1.8, trim: '#e8b64a' };
const STYLES: Record<string, Style> = {
  skiff: RAIDER, raider: RAIDER, gunship: RAIDER, dreadnought: ARMADA, flagship: ARMADA,
  drone: { shape: 'block', metal: ['#a9b3c2', '#3c4452'], nose: .7, lights: '#6fd3ff' }, hive: { shape: 'organic', metal: ['#c1c99a', '#434a26'], nose: 1.2 },
  lifeboat: { shape: 'smooth', metal: ['#c9ced8', '#565d6b'], nose: 1 },
};
const PLAYER: Style = { shape: 'smooth', metal: ['#e2e8f2', '#5d6980'], nose: 1.6 };
const RADIUS: Record<Shape, number> = { smooth: .5, angular: .05, organic: .9, block: .22, blade: .1 };

type Pt = [x: number, y: number, r: number];
function outline(hull: HullDef, style: Style): Pt[] {
  const W = hull.gridW, pad = style.shape === 'block' ? .3 : .38, r = RADIUS[style.shape], top: number[] = [], bot: number[] = [];
  for (let x = 0; x < W; x++) { const cover = hull.rooms.filter(q => x >= q.x && x < q.x + q.w);
    top.push(cover.length ? Math.min(...cover.map(q => q.y)) - pad : top[x - 1] ?? 0); bot.push(cover.length ? Math.max(...cover.map(q => q.y + q.h)) + pad : bot[x - 1] ?? hull.gridH); }
  const helm = hull.rooms.find(q => q.system === 'helm'), cy = helm ? helm.y + helm.h / 2 : hull.gridH / 2, edge = (ys: number[], sign: number) => {
    const pts: Pt[] = []; for (let a = 0; a < W;) { let b = a; while (b < W && ys[b] === ys[a]) b++; pts.push([a ? a + .15 : -.1, ys[a], r], [b - .15, ys[a], r]); a = b; }
    return sign > 0 ? pts : pts.reverse(); };
  const n = style.nose, tip = style.shape === 'blade' || style.shape === 'angular' ? .02 : r;
  return [[-.6, top[0] + .12, .08], ...edge(top, 1), [W + n * .45, top[W - 1] + (cy - top[W - 1]) * .42, r], [W + n, cy, tip],
    [W + n * .45, bot[W - 1] + (cy - bot[W - 1]) * .42, r], ...edge(bot, -1), [-.6, bot[0] - .12, .08]];
}
/** Rounded polygon via arcTo, clamping each radius to its neighbouring segments. */
function trace(g: CanvasRenderingContext2D, pts: Pt[]) {
  const n = pts.length, mid = (a: Pt, b: Pt) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  g.beginPath(); g.moveTo(...(mid(pts[n - 1], pts[0]) as [number, number]));
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n], o = pts[(i + n - 1) % n];
    g.arcTo(p[0], p[1], q[0], q[1], Math.min(p[2], Math.hypot(q[0] - p[0], q[1] - p[1]) * .45, Math.hypot(o[0] - p[0], o[1] - p[1]) * .45)); }
  g.closePath();
}
const fins = (hull: HullDef, pts: Pt[]) => { const top = pts[1][1], bot = pts[pts.length - 2][1], len = hull.gridW > 9 ? 3 : 2.4;
  return [[[.1, top + .1, 0], [-1.1, top - .95, .05], [len, top + .05, 0]], [[.1, bot - .1, 0], [-1.1, bot + .95, .05], [len, bot - .05, 0]]] as Pt[][]; };

/** Returns hull + paint mask canvases sized (gridW+2·MX)×(gridH+2·MY)·SPRITE_PPC, nose facing +x. */
export function proceduralHull(hull: HullDef) {
  const style = STYLES[hull.id] ?? PLAYER, w = (hull.gridW + 2 * MX) * P, h = (hull.gridH + 2 * MY) * P, pts = outline(hull, style), wings = style.shape === 'block' || style.shape === 'organic' ? [] : fins(hull, pts);
  const body = canvas(w, h), paint = canvas(w, h), g = body.getContext('2d')!, m = paint.getContext('2d')!;
  for (const c of [g, m]) c.setTransform(P, 0, 0, P, MX * P, MY * P);
  const metal = g.createLinearGradient(0, -.5, 0, hull.gridH + .5); metal.addColorStop(0, style.metal[0]); metal.addColorStop(.55, style.metal[1]); metal.addColorStop(1, '#141824');
  g.lineJoin = m.lineJoin = 'round';
  for (const fin of wings) { trace(g, fin); g.fillStyle = metal; g.fill(); g.strokeStyle = '#05071a'; g.lineWidth = .08; g.stroke(); trace(m, fin); m.fillStyle = '#fff'; m.fill(); }
  const engines = hull.rooms.find(q => q.system === 'engines');
  if (engines) for (let y = engines.y; y < engines.y + engines.h; y++) {
    g.beginPath(); g.roundRect(NOZZLE_X, y + .16, 2, .68, .18); g.fillStyle = metal; g.fill(); g.strokeStyle = '#05071a'; g.lineWidth = .07; g.stroke();
    g.beginPath(); g.ellipse(NOZZLE_X + .08, y + .5, .12, .3, 0, 0, Math.PI * 2); g.fillStyle = '#1a1e2c'; g.fill(); }
  trace(g, pts); g.fillStyle = metal; g.fill();
  g.save(); g.clip();
  const shine = g.createLinearGradient(0, -.4, 0, hull.gridH * .45); shine.addColorStop(0, 'rgba(255,255,255,.35)'); shine.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = shine; g.fillRect(-2, -2, hull.gridW + 5, hull.gridH * .45 + 2);
  g.strokeStyle = 'rgba(10,12,24,.28)'; g.lineWidth = .035;
  for (let i = 0; i < hull.gridW * 3; i++) { const x = hash(i + hull.gridW) * (hull.gridW + 2) - 1, y = hash(i * 3.1 + hull.gridH) * (hull.gridH + 1.4) - .7; g.strokeRect(x, y, .5 + hash(i * 7.7) * 1.4, .3 + hash(i * 1.3) * .5); }
  if (style.shape === 'organic') for (let x = -.4; x < hull.gridW + 1; x += .7) { g.beginPath(); g.ellipse(x, hull.gridH / 2, .5, hull.gridH * .75, 0, -.9, .9); g.strokeStyle = 'rgba(30,40,10,.45)'; g.lineWidth = .1; g.stroke(); }
  g.restore();
  g.fillStyle = '#10141f'; for (const q of hull.rooms) g.fillRect(q.x - .06, q.y - .06, q.w + .12, q.h + .12);
  trace(g, pts); g.strokeStyle = '#05071a'; g.lineWidth = .1; g.stroke();
  if (style.trim) { g.save(); trace(g, pts); g.clip(); trace(g, pts); g.strokeStyle = style.trim; g.lineWidth = .34; g.globalAlpha = .9; g.stroke(); g.restore(); trace(g, pts); g.strokeStyle = '#05071a'; g.lineWidth = .06; g.stroke(); }
  if (style.lights) { g.fillStyle = style.lights; for (const y of [pts[1][1] + .12, pts[pts.length - 2][1] - .2]) g.fillRect(.3, y, hull.gridW - .6, .08); }
  const helm = hull.rooms.find(q => q.system === 'helm'), cy = helm ? helm.y + helm.h / 2 : hull.gridH / 2, glass = g.createLinearGradient(0, cy - .3, 0, cy + .3);
  glass.addColorStop(0, '#d9f4ff'); glass.addColorStop(1, '#2b5a86'); g.beginPath(); g.ellipse(hull.gridW + style.nose * .22, cy, .42, .24, 0, 0, Math.PI * 2); g.fillStyle = glass; g.fill(); g.lineWidth = .06; g.stroke();
  m.save(); trace(m, pts); m.clip(); trace(m, pts); m.strokeStyle = '#fff'; m.lineWidth = .62; m.stroke(); m.fillStyle = '#fff'; m.fillRect(hull.gridW - .2, -2, 4, hull.gridH + 4); m.restore();
  m.globalCompositeOperation = 'destination-out'; for (const q of hull.rooms) m.fillRect(q.x - .06, q.y - .06, q.w + .12, q.h + .12);
  m.beginPath(); m.ellipse(hull.gridW + style.nose * .22, cy, .48, .3, 0, 0, Math.PI * 2); m.fill();
  return { hull: body, paint };
}
