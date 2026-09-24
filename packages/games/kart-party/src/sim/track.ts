/* Runtime track geometry built from a TrackDef. Pure and deterministic: the server, client
 * prediction, CPU drivers and renderer all read the same samples, so what you see is what collides.
 *
 * A track is a closed centre-line resampled every ~SPACING metres of 3D arc length. Every point on
 * the course is addressed as (d, lateral): d = metres along the lap from the start line,
 * lateral = metres to the driver's right of the centre line. */
import { clamp, headingOf, lerp, wrap, angleDelta, TAU } from './math';
import type { Surface, TrackDef, TrackPoint } from './types';

export const SPACING = 2;
export const CHECKPOINTS = 16;
const DEFAULT_WIDTH = 16, DEFAULT_RUNOFF = 7;

export type TrackSample = {
  x: number; y: number; z: number; d: number;
  tx: number; ty: number; tz: number;       // unit 3D tangent
  rx: number; rz: number;                   // unit horizontal right vector
  heading: number; curvature: number;       // curvature in 1/m on XZ; > 0 turns left, < 0 turns right
  halfWidth: number; bank: number;          // bank in radians; > 0 raises the left edge
  runoffL: number; runoffR: number; edgeL: 'wall' | 'drop'; edgeR: 'wall' | 'drop';
  line: number;                             // racing-line lateral offset
};
type Span = { d0: number; d1: number };
export type TrackBox = { x: number; y: number; z: number; d: number; lateral: number };
export type TrackPad = Span & { lat: number; halfWidth: number };
export type TrackRamp = Span & { lat: number; halfWidth: number; height: number };
export type TrackZone = Span & { latMin: number; latMax: number; surface: 'offroad' | 'ice' | 'water' | 'boost' };
export type TrackObstacle = { x: number; y: number; z: number; d: number; lateral: number; radius: number; kind: string };
export type TrackRing = { d: number; lat: number; height: number; radius: number; x: number; y: number; z: number; heading: number };
export type TrackSpring = Span & { lat: number; halfWidth: number; power: number };
export type TrackGravity = Span & { scale: number };
export type TrackMover = { d: number; lat: number; amp: number; period: number; phase: number; radius: number; kind: string };
/** A resolved loop: footprint from A (d0) to B (d1) along the centre line, loop plane along f (horizontal unit). */
export type TrackLoop = Span & { radius: number; ax: number; ay: number; az: number; bx: number; by: number; bz: number; fx: number; fz: number; rx: number; rz: number };
export type Track = {
  def: TrackDef; length: number; spacing: number; samples: TrackSample[];
  boxes: TrackBox[]; pads: TrackPad[]; ramps: TrackRamp[]; gaps: Span[]; zones: TrackZone[]; obstacles: TrackObstacle[];
  rings: TrackRing[]; springs: TrackSpring[]; gravity: TrackGravity[]; movers: TrackMover[]; loops: TrackLoop[];
  checkpoints: number[];
};
export type TrackQuery = {
  index: number; d: number; lateral: number;
  heading: number; tx: number; tz: number; rx: number; rz: number;
  halfWidth: number; bank: number; centerY: number;
  /** Surface height under the point (road plane continued flat across the apron, plus ramps); null over a gap. */
  ground: number | null; slope: number;     // slope = d(ground)/d(d) along the track (ramps included)
  surface: Surface; ramp: number;           // ramp index or -1
  /** 0 inside the course; -1/1 when past the left/right edge (halfWidth + runoff). */
  beyond: -1 | 0 | 1; edge: 'wall' | 'drop'; edgeLateral: number;  // signed lateral of the nearest edge
};

const inSpan = (track: Track, s: Span, d: number) => s.d0 <= s.d1 ? d >= s.d0 && d <= s.d1 : d >= s.d0 || d <= s.d1;
/** Forward distance from `from` to `to` around the lap, in [0, length). */
export const forwardDistance = (track: Track, from: number, to: number) => wrap(to - from, track.length);
/** Signed shortest distance from `from` to `to` around the lap, in [-length/2, length/2). */
export const signedDistance = (track: Track, from: number, to: number) => { const f = forwardDistance(track, from, to); return f > track.length / 2 ? f - track.length : f; };

function catmull(p0: number, p1: number, p2: number, p3: number, t0: number, t1: number, t2: number, t3: number, t: number) {
  // Barry–Goldman evaluation of a non-uniform (centripetal) Catmull-Rom segment between p1 and p2.
  const a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1, a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2, a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3;
  const b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2, b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3;
  return (t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2;
}
const ease = (a: number, b: number, t: number) => lerp(a, b, t * t * (3 - 2 * t));

export function buildTrack(def: TrackDef): Track {
  const pts = def.points, n = pts.length;
  if (n < 4) throw Error(`${def.id}: a track needs at least four control points.`);
  const P = (i: number) => pts[wrap(i, n)];
  const knot = (a: TrackPoint, b: TrackPoint) => Math.sqrt(Math.hypot(b.x - a.x, (b.y ?? 0) - (a.y ?? 0), b.z - a.z)) || 1e-3;
  // Dense raw samples along each spline segment.
  const raw: { x: number; y: number; z: number; w: number; bank: number; rl: number; rr: number; el: 'wall' | 'drop'; er: 'wall' | 'drop'; s: number }[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    const steps = 48;
    for (let k = 0; k < steps; k++) {
      const u = k / steps, t = lerp(t1, t2, u);
      const x = catmull(p0.x, p1.x, p2.x, p3.x, t0, t1, t2, t3, t), z = catmull(p0.z, p1.z, p2.z, p3.z, t0, t1, t2, t3, t);
      const y = catmull(p0.y ?? 0, p1.y ?? 0, p2.y ?? 0, p3.y ?? 0, t0, t1, t2, t3, t);
      const prev = raw[raw.length - 1];
      if (prev) s += Math.hypot(x - prev.x, y - prev.y, z - prev.z);
      raw.push({ x, y, z, s, w: ease(p1.w ?? DEFAULT_WIDTH, p2.w ?? DEFAULT_WIDTH, u), bank: ease(p1.bank ?? 0, p2.bank ?? 0, u) * Math.PI / 180,
        rl: ease(p1.runoffL ?? DEFAULT_RUNOFF, p2.runoffL ?? DEFAULT_RUNOFF, u), rr: ease(p1.runoffR ?? DEFAULT_RUNOFF, p2.runoffR ?? DEFAULT_RUNOFF, u),
        el: (u < .5 ? p1.edgeL : p2.edgeL) ?? 'wall', er: (u < .5 ? p1.edgeR : p2.edgeR) ?? 'wall' });
    }
  }
  const last = raw[raw.length - 1], first = raw[0];
  const length = s + Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z);
  const count = Math.max(16, Math.round(length / SPACING)), spacing = length / count;
  // Uniform resampling by arc length.
  const samples: TrackSample[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = i * spacing;
    while (j < raw.length - 1 && raw[j + 1].s < target) j++;
    const a = raw[j], b = raw[j + 1] ?? { ...first, s: length }, t = b.s > a.s ? clamp((target - a.s) / (b.s - a.s), 0, 1) : 0;
    const pick = <K extends 'el' | 'er'>(key: K) => (t < .5 ? a[key] : b[key]);
    samples.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), d: target, tx: 0, ty: 0, tz: 1, rx: -1, rz: 0, heading: 0, curvature: 0,
      halfWidth: lerp(a.w, b.w, t) / 2, bank: lerp(a.bank, b.bank, t), runoffL: lerp(a.rl, b.rl, t), runoffR: lerp(a.rr, b.rr, t), edgeL: pick('el'), edgeR: pick('er'), line: 0 });
  }
  for (let i = 0; i < count; i++) {
    const a = samples[wrap(i - 1, count)], b = samples[wrap(i + 1, count)], c = samples[i];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz) || 1, flat = Math.hypot(dx, dz) || 1;
    c.tx = dx / len; c.ty = dy / len; c.tz = dz / len; c.rx = -dz / flat; c.rz = dx / flat; c.heading = headingOf(dx, dz);
  }
  for (let i = 0; i < count; i++) samples[i].curvature = angleDelta(samples[wrap(i - 1, count)].heading, samples[wrap(i + 1, count)].heading) / (2 * spacing);
  const track: Track = { def, length, spacing, samples, boxes: [], pads: [], ramps: [], gaps: [], zones: [], obstacles: [], rings: [], springs: [], gravity: [], movers: [], loops: [], checkpoints: [] };
  computeRacingLine(track);
  const at = (f: number) => wrap(f, 1) * length;
  track.gaps = def.gaps.map(g => ({ d0: at(g.from), d1: at(g.to) }));
  track.zones = def.zones.map(z => ({ d0: at(z.from), d1: at(z.to), latMin: z.latMin, latMax: z.latMax, surface: z.surface }));
  track.pads = def.boostPads.map(p => ({ d0: at(p.at), d1: wrap(at(p.at) + (p.length ?? 6), length), lat: p.lat, halfWidth: (p.width ?? 4) / 2 }));
  track.ramps = def.ramps.map(r => ({ d0: at(r.at), d1: wrap(at(r.at) + (r.length ?? 8), length), lat: r.lat, halfWidth: r.width / 2, height: r.height ?? 1.6 }));
  track.obstacles = def.obstacles.map(o => { const p = pointAt(track, at(o.at), o.lat); return { x: p.x, y: p.y, z: p.z, d: at(o.at), lateral: o.lat, radius: o.radius, kind: o.kind }; });
  for (const row of def.itemRows) {
    const d = at(row.at), sample = sampleAt(track, d), boxes = row.count ?? 4, usable = Math.max(0, sample.halfWidth - 2.2);
    for (let k = 0; k < boxes; k++) {
      const lateral = boxes === 1 ? 0 : lerp(-usable, usable, k / (boxes - 1)), p = pointAt(track, d, lateral);
      track.boxes.push({ x: p.x, y: p.y + 1.1, z: p.z, d, lateral });
    }
  }
  track.rings = (def.rings ?? []).map(r => { const d = at(r.at), p = pointAt(track, d, r.lat); return { d, lat: r.lat, height: r.height, radius: r.radius ?? 3.2, x: p.x, y: p.y + r.height, z: p.z, heading: p.heading }; });
  track.springs = (def.springs ?? []).map(s => ({ d0: at(s.at), d1: wrap(at(s.at) + (s.length ?? 5), length), lat: s.lat, halfWidth: (s.width ?? 5) / 2, power: s.power ?? 15 }));
  track.gravity = (def.gravity ?? []).map(g => ({ d0: at(g.from), d1: at(g.to), scale: g.scale }));
  track.movers = (def.movers ?? []).map(m => ({ d: at(m.at), lat: m.lat, amp: m.amp, period: m.period, phase: m.phase ?? 0, radius: m.radius, kind: m.kind }));
  track.loops = (def.loops ?? []).map(l => {
    const d0 = at(l.at), d1 = wrap(d0 + (l.length ?? 40), length), a = sampleAt(track, d0), b = sampleAt(track, d1), tilt = (l.tilt ?? 28) * Math.PI / 180;
    const cx = b.x - a.x, cz = b.z - a.z, cl = Math.hypot(cx, cz) || 1, ux = cx / cl, uz = cz / cl;
    // The loop plane leans `tilt` toward the driver's left, so the way out passes beside the way in.
    const fx = ux * Math.cos(tilt) + uz * Math.sin(tilt), fz = uz * Math.cos(tilt) - ux * Math.sin(tilt);
    return { d0, d1, radius: l.radius ?? 11, ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, fx, fz, rx: -uz, rz: ux };
  });
  track.checkpoints = Array.from({ length: CHECKPOINTS }, (_, i) => i * length / CHECKPOINTS);
  return track;
}

/** Elastic-band minimum-curvature line: each point is pulled toward its neighbours' midpoint. */
function computeRacingLine(track: Track) {
  const S = track.samples, n = S.length, line = new Float64Array(n);
  for (let iter = 0; iter < 300; iter++) {
    for (let i = 0; i < n; i++) {
      const a = S[wrap(i - 3, n)], b = S[wrap(i + 3, n)], la = line[wrap(i - 3, n)], lb = line[wrap(i + 3, n)], c = S[i];
      const mx = (a.x + a.rx * la + b.x + b.rx * lb) / 2, mz = (a.z + a.rz * la + b.z + b.rz * lb) / 2;
      const want = (mx - c.x) * c.rx + (mz - c.z) * c.rz, limit = Math.max(0, c.halfWidth - 2.5);
      line[i] = clamp(lerp(line[i], want, .5), -limit, limit);
    }
  }
  for (let i = 0; i < n; i++) S[i].line = line[i];
}

/** Interpolated centre-line sample at distance d (fields that are discrete come from the nearer sample). */
export function sampleAt(track: Track, d: number): TrackSample {
  const S = track.samples, n = S.length, f = wrap(d, track.length) / track.spacing, i = Math.floor(f) % n, t = f - Math.floor(f), a = S[i], b = S[(i + 1) % n];
  const flat = Math.hypot(lerp(a.tx, b.tx, t), lerp(a.tz, b.tz, t)) || 1, tx = lerp(a.tx, b.tx, t), tz = lerp(a.tz, b.tz, t);
  return { ...(t < .5 ? a : b), x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), d: wrap(d, track.length), tx, ty: lerp(a.ty, b.ty, t), tz,
    rx: -tz / flat, rz: tx / flat, heading: headingOf(tx, tz), curvature: lerp(a.curvature, b.curvature, t), halfWidth: lerp(a.halfWidth, b.halfWidth, t),
    bank: lerp(a.bank, b.bank, t), runoffL: lerp(a.runoffL, b.runoffL, t), runoffR: lerp(a.runoffR, b.runoffR, t), line: lerp(a.line, b.line, t) };
}

/** Road-plane height at (d, lateral): banked across the road, flat across the apron. Ramps are not included. */
export function roadHeight(track: Track, d: number, lateral: number, sample = sampleAt(track, d)) {
  const clamped = clamp(lateral, -sample.halfWidth, sample.halfWidth);
  return sample.y - clamped * Math.tan(sample.bank);
}

export function rampHeight(ramp: TrackRamp, track: Track, d: number, lateral: number) {
  if (Math.abs(lateral - ramp.lat) > ramp.halfWidth || !inSpan(track, ramp, d)) return 0;
  const len = forwardDistance(track, ramp.d0, ramp.d1) || 1;
  return ramp.height * forwardDistance(track, ramp.d0, d) / len;
}

/** World point at (d, lateral) on the road surface (ramps excluded). */
export function pointAt(track: Track, d: number, lateral: number) {
  const s = sampleAt(track, d);
  return { x: s.x + s.rx * lateral, y: roadHeight(track, d, lateral, s), z: s.z + s.rz * lateral, heading: s.heading };
}

const dist2 = (s: TrackSample, x: number, z: number, y?: number) => (s.x - x) ** 2 + (s.z - z) ** 2 + (y === undefined ? 0 : ((s.y - y) * 2) ** 2);
/** Nearest sample index. With a hint the search walks locally (stable on bridges/overpasses);
 * without one, or after losing track, it scans globally, weighting height differences. */
export function locate(track: Track, x: number, z: number, hint = -1, y?: number): number {
  const S = track.samples, n = S.length;
  if (hint >= 0 && hint < n) {
    let best = hint, bestD = dist2(S[hint], x, z, y);
    for (const dir of [1, -1]) {
      let i = hint;
      for (let k = 0; k < 64; k++) { i = wrap(i + dir, n); const dd = dist2(S[i], x, z, y); if (dd < bestD) { bestD = dd; best = i; } else if (k > 6) break; }
    }
    const reach = S[best].halfWidth + Math.max(S[best].runoffL, S[best].runoffR) + 12;
    if (bestD <= reach * reach) return best;
  }
  let best = 0, bestD = Infinity;
  for (let i = 0; i < n; i++) { const dd = dist2(S[i], x, z, y); if (dd < bestD) { bestD = dd; best = i; } }
  return best;
}

export function queryTrack(track: Track, x: number, z: number, hint = -1, y?: number): TrackQuery {
  const S = track.samples, n = S.length, index = locate(track, x, z, hint, y);
  // Project onto whichever adjacent segment is closer.
  let d = 0, best = Infinity;
  for (const i of [wrap(index - 1, n), index]) {
    const a = S[i], b = S[(i + 1) % n], sx = b.x - a.x, sz = b.z - a.z, len2 = sx * sx + sz * sz || 1;
    const t = clamp(((x - a.x) * sx + (z - a.z) * sz) / len2, 0, 1), px = a.x + sx * t, pz = a.z + sz * t, dd = (x - px) ** 2 + (z - pz) ** 2;
    if (dd < best) { best = dd; d = wrap(a.d + t * track.spacing, track.length); }
  }
  const s = sampleAt(track, d), lateral = (x - s.x) * s.rx + (z - s.z) * s.rz;
  const edgeLateral = lateral < 0 ? -(s.halfWidth + s.runoffL) : s.halfWidth + s.runoffR;
  const beyond: -1 | 0 | 1 = Math.abs(lateral) > Math.abs(edgeLateral) ? (lateral < 0 ? -1 : 1) : 0;
  const gap = track.gaps.some(g => inSpan(track, g, d));
  let ramp = -1, rampH = 0, slope = s.ty / (Math.hypot(s.tx, s.tz) || 1);
  track.ramps.forEach((r, i) => { const h = rampHeight(r, track, d, lateral); if (h > 0 || (Math.abs(lateral - r.lat) <= r.halfWidth && inSpan(track, r, d))) { ramp = i; rampH = h; slope += r.height / (forwardDistance(track, r.d0, r.d1) || 1); } });
  let surface: Surface = Math.abs(lateral) <= s.halfWidth ? 'road' : 'offroad';
  for (const zone of track.zones) if (inSpan(track, zone, d) && lateral >= zone.latMin && lateral <= zone.latMax) surface = zone.surface;
  for (const pad of track.pads) if (inSpan(track, pad, d) && Math.abs(lateral - pad.lat) <= pad.halfWidth) surface = 'boost';
  if (gap && ramp < 0) surface = 'air';
  return { index, d, lateral, heading: s.heading, tx: s.tx / (Math.hypot(s.tx, s.tz) || 1), tz: s.tz / (Math.hypot(s.tx, s.tz) || 1), rx: s.rx, rz: s.rz,
    halfWidth: s.halfWidth, bank: s.bank, centerY: s.y, ground: gap && ramp < 0 ? null : roadHeight(track, d, lateral, s) + rampH, slope, surface, ramp,
    beyond, edge: lateral < 0 ? s.edgeL : s.edgeR, edgeLateral };
}

/** Starting grid: two staggered columns behind the line. Slot 0 is pole. */
export function gridSlot(track: Track, slot: number) {
  const row = Math.floor(slot / 2), side = slot % 2 ? 1 : -1, d = wrap(-8 - row * 6 - (slot % 2) * 3, track.length);
  const s = sampleAt(track, d), lateral = side * Math.min(3.5, s.halfWidth - 2), p = pointAt(track, d, lateral);
  return { ...p, d, lateral };
}

/** Gravity multiplier at d (1 outside every zone). */
export function gravityScale(track: Track, d: number) { for (const g of track.gravity) if (inSpan(track, g, d)) return g.scale; return 1; }
/** Index of the spring pad under (d, lateral), or -1. */
export function springAt(track: Track, d: number, lateral: number) { return track.springs.findIndex(s => inSpan(track, s, d) && Math.abs(lateral - s.lat) <= s.halfWidth); }
/** Where a mover is at race time `time` (seconds). Physics, CPUs and the renderer all use this, so bumpers are seen where they hit. */
export function moverPosition(track: Track, m: TrackMover, time: number) {
  const lateral = m.lat + m.amp * Math.sin(TAU * (time / m.period + m.phase)), p = pointAt(track, m.d, lateral);
  return { x: p.x, y: p.y, z: p.z, lateral };
}

/** Pose on a loop at angle theta (0 = entry, 2π = exit) and `lateral` metres right of the lane centre. Physics, camera and
 * renderer all use it. Returns position, unit tangent, unit up (toward the loop centre), heading, and ds/dθ (arc metres per radian). */
export function loopPose(loop: TrackLoop, theta: number, lateral: number) {
  // The footprint drift slows over the top and bottom and speeds up on the sides (u' = (1 − 0.5 cos 2θ)/2π): the upside-down
  // part stays nearly round (a constant drift pinches it into a tight curl) while the halves still cross side by side at mid-height.
  const R = loop.radius, s = Math.sin(theta), c = Math.cos(theta), u = theta / TAU - .5 * Math.sin(2 * theta) / (2 * TAU), du = (1 - .5 * Math.cos(2 * theta)) / TAU;
  // The plane's lean eases in over the first quarter turn and out over the last (w: 0 → 1 → 0), so the ribbon leaves and
  // rejoins the road tangent to it (no heading kink at entry or exit); f = along·(rz, −rx) + lean·w·r.
  const q = Math.min(theta, TAU - theta) / (Math.PI / 2), w = q >= 1 ? 1 : q * q * (3 - 2 * q), dw = q >= 1 ? 0 : 6 * q * (1 - q) / (Math.PI / 2) * (theta < Math.PI ? 1 : -1);
  const lean = loop.fx * loop.rx + loop.fz * loop.rz, along = loop.fx * loop.rz - loop.fz * loop.rx;
  const fx = along * loop.rz + lean * w * loop.rx, fz = -along * loop.rx + lean * w * loop.rz;
  const bx = lerp(loop.ax, loop.bx, u), by = lerp(loop.ay, loop.by, u), bz = lerp(loop.az, loop.bz, u);
  const x = bx + fx * R * s + loop.rx * lateral, y = by + R * (1 - c), z = bz + fz * R * s + loop.rz * lateral;
  // d/dθ of the centre path: footprint drift + circle (+ the easing lean).
  let tx = (loop.bx - loop.ax) * du + R * (fx * c + lean * dw * loop.rx * s), ty = (loop.by - loop.ay) * du + R * s, tz = (loop.bz - loop.az) * du + R * (fz * c + lean * dw * loop.rz * s);
  const dsdTheta = Math.hypot(tx, ty, tz) || 1; tx /= dsdTheta; ty /= dsdTheta; tz /= dsdTheta;
  let ux = -fx * s, uy = c, uz = -fz * s;
  const dot = ux * tx + uy * ty + uz * tz; ux -= dot * tx; uy -= dot * ty; uz -= dot * tz;
  const ul = Math.hypot(ux, uy, uz) || 1;
  return { x, y, z, tx, ty, tz, ux: ux / ul, uy: uy / ul, uz: uz / ul, heading: headingOf(tx, tz), dsdTheta };
}
