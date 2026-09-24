/* Course authoring helper: a lap described as legs (straights and constant-radius arcs), like a
 * turtle drawing the centre line from the start line (origin, `heading` degrees; 0 = +Z). Two `fit` straights get
 * their lengths solved so the loop closes exactly, so radii stay exactly as written. */
import type { TrackPoint } from '../sim/types';

type Edge = 'wall' | 'drop';
export type Leg = {
  go?: number;                                  // straight length in metres
  turn?: number; r?: number;                    // arc: degrees (+ = left) at radius r
  fit?: boolean;                                // straight whose length closes the loop (exactly two per course)
  y?: number;                                   // elevation at the end of the leg (linear along it; else held)
  w?: number; runoffL?: number; runoffR?: number; edgeL?: Edge; edgeR?: Edge;  // sticky from this leg on
  bank?: number;                                // degrees on this leg (+ raises the left edge: right turns), eased in/out over the neighbouring points
  mark?: string;                                // names the start of this leg for Course.at
};
export type Course = { points: TrackPoint[]; length: number; at(mark: string, metres?: number): number };

const RAD = Math.PI / 180;
const arcMove = (h: number, turn: number, r: number) => {
  // Left turn (turn > 0) raises heading; forward (sin h, cos h), left (cos h, -sin h).
  const a = turn * RAD, side = Math.sign(turn), cx = Math.cos(h) * r * side, cz = -Math.sin(h) * r * side;
  return (t: number) => { const hh = h + a * t; return { x: cx - Math.cos(hh) * r * side, z: cz + Math.sin(hh) * r * side, h: hh }; };
};

export function course(legs: Leg[], heading = 0): Course {
  // Pass 1: solve the two fit straights so the displacement sums to zero.
  let h = heading * RAD, x = 0, z = 0, turned = 0;
  const fits: { i: number; ux: number; uz: number }[] = [];
  for (const [i, leg] of legs.entries()) {
    if (leg.turn) { const p = arcMove(h, leg.turn, leg.r ?? 30)(1); x += p.x; z += p.z; h = p.h; turned += leg.turn; }
    else if (leg.fit) fits.push({ i, ux: Math.sin(h), uz: Math.cos(h) });
    else { x += Math.sin(h) * (leg.go ?? 0); z += Math.cos(h) * (leg.go ?? 0); }
  }
  if (Math.abs(Math.abs(turned) - 360) > 1e-6 && Math.abs(turned) > 1e-6) throw Error(`course turns ${turned}°, expected ±360 or 0`);
  const lengths = legs.map(l => l.go ?? 0);
  if (fits.length === 2) {
    const [a, b] = fits, det = a.ux * b.uz - a.uz * b.ux;
    if (Math.abs(det) < .2) throw Error('course fit legs are (nearly) parallel');
    lengths[a.i] = (-x * b.uz + z * b.ux) / det; lengths[b.i] = (-a.ux * z + a.uz * x) / det;
    if (lengths[a.i] < 4 || lengths[b.i] < 4) throw Error(`course fit legs came out ${lengths[a.i].toFixed(1)} / ${lengths[b.i].toFixed(1)} m`);
  } else if (Math.hypot(x, z) > .5) throw Error(`course misses closure by ${Math.hypot(x, z).toFixed(1)} m; add two fit legs`);
  // Pass 2: emit control points with sticky properties.
  const points: TrackPoint[] = [], marks = new Map<string, number>(), banked: { first: number; last: number; bank: number }[] = [];
  const sticky: Pick<TrackPoint, 'w' | 'runoffL' | 'runoffR' | 'edgeL' | 'edgeR'> = {};
  let y = [...legs].reverse().find(l => l.y !== undefined)?.y ?? 0, total = 0;
  h = heading * RAD; x = 0; z = 0;
  points.push({ x: 0, z: 0, y });
  for (const [i, leg] of legs.entries()) {
    for (const key of ['w', 'runoffL', 'runoffR', 'edgeL', 'edgeR'] as const) if (leg[key] !== undefined) (sticky as Record<string, unknown>)[key] = leg[key];
    if (i === 0) Object.assign(points[0], sticky);
    if (leg.mark) marks.set(leg.mark, total);
    const r = leg.r ?? 30, len = leg.turn ? Math.abs(leg.turn * RAD) * r : lengths[i], y0 = y, y1 = leg.y ?? y;
    const n = Math.max(1, Math.ceil(leg.turn ? Math.max(len / 11, Math.abs(leg.turn) / 22) : len / 14));
    const move = leg.turn ? arcMove(h, leg.turn, r) : (t: number) => ({ x: Math.sin(h) * len * t, z: Math.cos(h) * len * t, h });
    if (leg.bank) banked.push({ first: points.length, last: points.length + n - 1, bank: leg.bank });
    for (let k = 1; k <= n; k++) {
      if (i === legs.length - 1 && k === n) break;       // the loop closes on points[0]
      const p = move(k / n);
      points.push({ x: x + p.x, z: z + p.z, y: y0 + (y1 - y0) * k / n, ...sticky, ...(leg.bank ? { bank: leg.bank } : {}) });
    }
    const end = move(1); x += end.x; z += end.z; h = end.h; y = y1;
    total += Math.hypot(len, y1 - y0);
  }
  // Banks ease in and out over the neighbouring points too, so the inside edge never drops away fast enough to hop a kart.
  const P = (i: number) => points[((i % points.length) + points.length) % points.length];
  for (const b of banked) for (const i of [b.first - 1, b.last + 1]) if (P(i).bank === undefined) P(i).bank = b.bank / 2;
  for (const p of points) { p.x = Math.round(p.x * 100) / 100; p.z = Math.round(p.z * 100) / 100; p.y = Math.round((p.y ?? 0) * 100) / 100; }
  return { points, length: total, at: (mark, metres = 0) => {
    const d = marks.get(mark);
    if (d === undefined) throw Error(`unknown course mark ${mark}`);
    return (((d + metres) / total) % 1 + 1) % 1;
  } };
}
