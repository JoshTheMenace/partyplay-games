/** Kind-specific projectile visuals, interpolated from mount (q = 0) to target room or shield edge (q = 1). */
import type { WeaponDef, WeaponKind } from '../contracts';
import { glow } from './fx';

export type Pt = { x: number; y: number };
export type Shot = { kind: WeaponKind; support: WeaponDef['support']; color: string; seed: number; from: Pt; to: Pt;
  /** Perpendicular bend of the path (missiles arc). */ bend: number; /** Fraction of from→to where a shield stops it (1 = reaches the room). */ stop: number; /** Beam sweep points across rooms. */ chain: Pt[] | null };

/** Fraction along from→to where the segment enters the ellipse, or 1 if it does not (or starts inside). */
export function ellipseEntry(from: Pt, to: Pt, e: { x: number; y: number; rx: number; ry: number }) {
  const dx = (to.x - from.x) / e.rx, dy = (to.y - from.y) / e.ry, fx = (from.x - e.x) / e.rx, fy = (from.y - e.y) / e.ry;
  const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - 1, disc = b * b - 4 * a * c;
  if (c <= 0 || disc < 0) return 1;
  const s = (-b - Math.sqrt(disc)) / (2 * a); return s > 0 && s < 1 ? s : 1;
}
const P: Pt = { x: 0, y: 0 }, Q: Pt = { x: 0, y: 0 };
/** Point at q (0..1 of the visible path) on the shot's bent path. */
function at(s: Shot, q: number, out: Pt) {
  const ex = s.from.x + (s.to.x - s.from.x) * s.stop, ey = s.from.y + (s.to.y - s.from.y) * s.stop;
  const cx = (s.from.x + ex) / 2 - (ey - s.from.y) * s.bend, cy = (s.from.y + ey) / 2 + (ex - s.from.x) * s.bend, a = (1 - q) * (1 - q), b = 2 * (1 - q) * q, c = q * q;
  out.x = a * s.from.x + b * cx + c * ex; out.y = a * s.from.y + b * cy + c * ey; return out;
}
function along(pts: Pt[], f: number, out: Pt) {
  const segs = pts.length - 1; if (segs < 1) { out.x = pts[0].x; out.y = pts[0].y; return out; }
  const x = Math.min(segs - 1e-6, Math.max(0, f * segs)), i = Math.floor(x), t = x - i;
  out.x = pts[i].x + (pts[i + 1].x - pts[i].x) * t; out.y = pts[i].y + (pts[i + 1].y - pts[i].y) * t; return out;
}
const line = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number, color: string, alpha: number) => {
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
const sprite = (ctx: CanvasRenderingContext2D, color: string, x: number, y: number, r: number, alpha = 1) => { ctx.globalAlpha = alpha; ctx.drawImage(glow(color), x - r, y - r, r * 2, r * 2); };

export function drawShot(ctx: CanvasRenderingContext2D, s: Shot, q: number, now: number, u: number) {
  const p = at(s, q, P), back = at(s, Math.max(0, q - .03), Q), dx = p.x - back.x, dy = p.y - back.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  ctx.save(); ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
  switch (s.kind) {
    case 'laser': { const L = 46 * u; line(ctx, p.x - ux * L, p.y - uy * L, p.x, p.y, 11 * u, s.color, .45); line(ctx, p.x - ux * L * .7, p.y - uy * L * .7, p.x, p.y, 3.5 * u, '#ffffff', .95); sprite(ctx, s.color, p.x, p.y, 16 * u, .8); break; }
    case 'ion': { sprite(ctx, '#5cc8ff', p.x, p.y, 30 * u); sprite(ctx, '#ffffff', p.x, p.y, 9 * u);
      ctx.strokeStyle = '#bff0ff'; ctx.lineWidth = 1.6 * u; ctx.globalAlpha = .9; ctx.beginPath();
      for (let a = 0; a < 3; a++) { const r0 = now * .012 + a * 2.1 + s.seed; ctx.moveTo(p.x + Math.cos(r0) * 7 * u, p.y + Math.sin(r0) * 7 * u);
        for (let k = 1; k <= 3; k++) { const r = r0 + k * .45, d = (7 + k * 4 + Math.sin(now * .05 + k + a) * 3) * u; ctx.lineTo(p.x + Math.cos(r) * d, p.y + Math.sin(r) * d); } }
      ctx.stroke(); break; }
    case 'flak': for (let i = 0; i < 4; i++) { const off = (i - 1.5) * 22 * u * q, x = p.x - uy * off + ux * Math.sin(i * 2.3) * 12 * u, y = p.y + ux * off + uy * Math.sin(i * 2.3) * 12 * u, r = now * .02 + i;
      sprite(ctx, s.color, x, y, 18 * u, .85); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.fillStyle = '#d9c9a0'; ctx.strokeStyle = '#05071a'; ctx.lineWidth = 1;
      ctx.beginPath(); for (let k = 0; k < 3; k++) ctx.lineTo(x + Math.cos(r + k * 2.1) * 7 * u, y + Math.sin(r + k * 2.1) * 7 * u); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.globalCompositeOperation = 'lighter'; } break;
    case 'missile': {
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#b8bfcc';
      for (let k = 14; k >= 1; k--) { const t = q - k * .018; if (t <= 0) continue; const c = at(s, t, Q); ctx.globalAlpha = .3 * (1 - k / 15); ctx.beginPath(); ctx.arc(c.x + Math.sin(k * 1.7 + s.seed) * k * .4 * u, c.y + Math.cos(k * 1.3) * k * .4 * u, (2.5 + k * .8) * u, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalCompositeOperation = 'lighter'; const flick = 1 + .3 * Math.sin(now * .09 + s.seed);
      sprite(ctx, '#ff9a3a', p.x - ux * 14 * u, p.y - uy * 14 * u, 16 * u * flick, .9); sprite(ctx, '#ffffff', p.x - ux * 11 * u, p.y - uy * 11 * u, 5 * u, .9);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(uy, ux)); ctx.strokeStyle = '#05071a'; ctx.lineWidth = 1.2;
      ctx.fillStyle = '#7d8699'; ctx.beginPath(); ctx.moveTo(-10 * u, -6 * u); ctx.lineTo(-5 * u, 0); ctx.lineTo(-10 * u, 6 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e4e8ef'; ctx.beginPath(); ctx.roundRect(-11 * u, -3 * u, 18 * u, 6 * u, 3 * u); ctx.fill(); ctx.stroke();
      ctx.fillStyle = s.color; ctx.beginPath(); ctx.moveTo(5 * u, -3 * u); ctx.quadraticCurveTo(12 * u, 0, 5 * u, 3 * u); ctx.closePath(); ctx.fill(); ctx.stroke(); break; }
    case 'beam': {
      const blocked = s.stop < 1, first = blocked ? at(s, 1, Q) : s.chain?.[0] ?? s.to;
      if (q < .4) { line(ctx, s.from.x, s.from.y, first.x, first.y, 1.6 * u, s.color, .15 + q * 1.2); sprite(ctx, s.color, s.from.x, s.from.y, (10 + q * 30) * u, .9); break; }
      const f = (q - .4) / .6, end = blocked || !s.chain ? first : along(s.chain, f, Q), wob = 1 + .15 * Math.sin(now * .06);
      if (!blocked && s.chain) { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = .75; ctx.strokeStyle = '#ffb070'; ctx.lineWidth = 4 * u; ctx.beginPath(); ctx.moveTo(s.chain[0].x, s.chain[0].y);
        for (let i = 1, n = s.chain.length - 1; i <= n && i < f * n; i++) ctx.lineTo(s.chain[i].x, s.chain[i].y); ctx.lineTo(end.x, end.y); ctx.stroke(); ctx.globalCompositeOperation = 'lighter'; }
      line(ctx, s.from.x, s.from.y, end.x, end.y, 16 * u * wob, s.color, .35); line(ctx, s.from.x, s.from.y, end.x, end.y, 6 * u, s.color, .9); line(ctx, s.from.x, s.from.y, end.x, end.y, 2.2 * u, '#ffffff', 1);
      sprite(ctx, s.color, end.x, end.y, 26 * u * wob); sprite(ctx, s.color, s.from.x, s.from.y, 18 * u); break; }
    case 'support': {
      if (s.support === 'shield') { sprite(ctx, '#5ff2ff', p.x, p.y, 26 * u); ctx.strokeStyle = '#c8fbff'; ctx.lineWidth = 2.4 * u; ctx.globalAlpha = 1; ctx.beginPath();
        for (let k = 0; k < 6; k++) { const a = now * .004 + k * Math.PI / 3; ctx.lineTo(p.x + Math.cos(a) * 11 * u, p.y + Math.sin(a) * 11 * u); } ctx.closePath(); ctx.stroke(); break; }
      const color = s.support === 'heal' ? '#8dffc8' : '#6dff9a';
      for (let k = 0; k < 16; k++) { const t = q - k * .022; if (t <= 0) break; const c = at(s, t, Q), w = Math.sin(now * .02 + k * .9 + s.seed) * 7 * u; ctx.globalAlpha = 1 - k / 16; ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(c.x - uy * w, c.y + ux * w, (4.4 - k * .2) * u + .5, 0, Math.PI * 2); ctx.fill(); }
      sprite(ctx, color, p.x, p.y, 20 * u);
      if (s.support === 'heal') { ctx.globalAlpha = 1; ctx.fillStyle = '#ffffff'; ctx.fillRect(p.x - 5 * u, p.y - 1.5 * u, 10 * u, 3 * u); ctx.fillRect(p.x - 1.5 * u, p.y - 5 * u, 3 * u, 10 * u); }
      break; }
  }
  ctx.restore();
}
