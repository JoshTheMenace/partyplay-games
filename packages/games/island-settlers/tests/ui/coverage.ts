/**
 * Test helper (never imported at runtime): which number tokens any piece covers on screen. Every
 * place from places.ts and module-places.ts (riders included) becomes the screen outline of its
 * plan box at the fitted pieceScale; a token counts as covered if any sample of its face falls inside.
 */
import { TOKEN_RADIUS, type Point } from '../../src/geometry';
import type { PublicView } from '../../src/model';
import { tileFace } from '../../src/ui/shared/board';
import { fitCamera, project, type Fit } from '../../src/ui/scene/camera';
import { TOKEN_Y, pieceScale } from '../../src/ui/scene/constants';
import { modulePlaces } from '../../src/ui/scene/module-places';
import { ROUND, boxOf, corePlaces, kindOf, type Place } from '../../src/ui/scene/places';
import { isLand } from '../../src/ui/scene/terrain';

const OUTLINE = 0.014;

function hull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y), out: Point[] = [];
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (const pass of [p, [...p].reverse()]) {
    const start = out.length;
    for (const q of pass) {
      while (out.length >= start + 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
  }
  return out;
}
const inside = (poly: Point[], q: Point) => poly.every((a, i) => {
  const b = poly[(i + 1) % poly.length];
  return (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x) > 1e-9;
});

/** Plan outline of a footprint in local units: box corners, or a 16-gon for round pieces. */
const footprint = (w: number, d: number, round: boolean) => (round
  ? Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)])
  : [[-1, -1], [-1, 1], [1, -1], [1, 1]]).map(([u, v]) => [u * (w / 2 + OUTLINE), v * (d / 2 + OUTLINE)]);

/** Screen outline of a footprint [w along yaw, d across] of height h at (x, base, z); yaw as three.js. */
function silhouette(fit: Fit, x: number, z: number, base: number, box: readonly number[], yaw: number,
  s: number, round = false, up = s) {
  const [w, d, h] = box, c = Math.cos(yaw), n = Math.sin(yaw), pts: Point[] = [];
  for (const [a, b] of footprint(w * s, d * s, round)) for (const y of [0, h * up]) {
    pts.push(project(fit, x + a * c + b * n, base + y, z - a * n + b * c));
  }
  return hull(pts);
}

/** Outlines of a place and its riders at piece scale k. */
function outlines(fit: Fit, p: Place, k: number): Point[][] {
  const s = p.scaled ? k : 1, c = Math.cos(p.yaw), n = Math.sin(p.yaw), [w, d, h] = boxOf(p.node);
  const up = Math.min(s, p.upright ?? s), round = ROUND.has(kindOf(p.node));
  const box = [w * (p.stretch ?? 1), d, h];
  const own = p.node ? [silhouette(fit, p.x, p.y, p.h, box, p.yaw, s, round, up)] : [];
  return [...own, ...(p.riders ?? []).map(r => {
    const x = p.x + (r.dx * c + r.dy * n) * s, z = p.y + (-r.dx * n + r.dy * c) * s;
    return silhouette(fit, x, z, p.h + r.dh * s, boxOf(r.node), p.yaw, s * (r.size ?? 1), ROUND.has(r.node));
  })];
}

/** Sample points on and inside a token's top face, in stage px. */
const tokenPoints = (fit: Fit, t: Point) => [1, 0.6].flatMap(k => Array.from({ length: 48 }, (_, i) => {
  const a = (i / 48) * Math.PI * 2, r = TOKEN_RADIUS * k;
  return project(fit, t.x + Math.cos(a) * r, TOKEN_Y + 0.0175, t.y + Math.sin(a) * r);
}));

export function coveredTokens(view: PublicView, stage: { width: number; height: number }) {
  const fit = fitCamera(view.board, stage, false), k = pieceScale(fit.scale);
  const places = [...corePlaces(view, k), ...modulePlaces(view)];
  const shapes = places.flatMap(p => outlines(fit, p, k).map(poly => ({ id: `${p.id}:${p.node}`, poly })));
  const tokens = view.board.tiles.filter(t => {
    const face = tileFace(view, t.id);
    return face.number > 0 && isLand(face.terrain);
  });
  const covered = tokens.flatMap(t => {
    const by = shapes.find(s => tokenPoints(fit, t).some(q => inside(s.poly, q)));
    return by ? [`${t.id} by ${by.id}`] : [];
  });
  return { fit, scale: k, count: tokens.length, shapes: shapes.length, covered };
}
