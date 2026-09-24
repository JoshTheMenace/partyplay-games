/* Terrain heightfield around a course. Pure and deterministic. Near the course the ground follows the
 * road (flat under the road and apron, embankments beside raised road); beyond `drop` edges it falls
 * into a trench deep enough that falling karts vanish; farther out it becomes themed hills. Where two
 * stretches of road overlap (overpasses) the lower one wins, so the upper one becomes a bridge. */
import { clamp, lerp, smoothstep } from '../../sim/math';
import { forwardDistance, sampleAt, signedDistance, type Track } from '../../sim/track';
import { fbm, ridged } from './noise';
import type { ThemeStyle } from './theme';

export type Heightfield = {
  minX: number; minZ: number; cell: number; nx: number; nz: number;
  h: Float32Array;          // ground height per vertex
  out: Float32Array;        // metres beyond the nearest course edge (negative inside the course)
  base: number;             // just below the lowest road
  horizon: number;          // height of the flat far ground that continues past the border
  canyons: Canyon[];        // river gorges carved across the course under each gap
  heightAt(x: number, z: number): number;
  edgeDistance(x: number, z: number): number;
};

/** A gorge crossing the course at a gap: centre on the road, lateral axis u = road right, walls at
 * |along − bend(u)| = width(u), flat floor with a river; carved from u0 (left, < 0) to u1 (right). */
export type Canyon = { x: number; z: number; ux: number; uz: number; half: number; floor: number; u0: number; u1: number };
export const canyonBend = (_c: Canyon, u: number) => Math.sin(u / 41) * 7 * smoothstep(14, 60, Math.abs(u));
export const canyonWidth = (c: Canyon, u: number) => c.half - 0.6 + Math.max(0, Math.abs(u) - 18) * 0.1;

const REACH = 72, FAR = 999;

export function buildHeightfield(track: Track, style: ThemeStyle['terrain'], seed: number, cell = 4, margin = 300): Heightfield {
  const S = track.samples;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, minY = Infinity;
  for (const s of S) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); minY = Math.min(minY, s.y); }
  const minX = Math.floor((x0 - margin) / cell) * cell, minZ = Math.floor((z0 - margin) / cell) * cell;
  const nx = Math.ceil((x1 + margin - minX) / cell) + 1, nz = Math.ceil((z1 + margin - minZ) / cell) + 1, count = nx * nz;
  const b1 = new Float32Array(count).fill(Infinity), b2 = new Float32Array(count).fill(Infinity);
  const i1 = new Int32Array(count).fill(-1), i2 = new Int32Array(count).fill(-1);
  const far = (a: number, b: number) => Math.abs(((S[a].d - S[b].d + track.length * 1.5) % track.length) - track.length / 2) > 60;
  // Splat every sample onto nearby vertices, keeping the nearest sample and the nearest from another stretch.
  const r = Math.ceil(REACH / cell);
  S.forEach((s, j) => {
    const cx = Math.round((s.x - minX) / cell), cz = Math.round((s.z - minZ) / cell);
    for (let gz = Math.max(0, cz - r); gz <= Math.min(nz - 1, cz + r); gz++) for (let gx = Math.max(0, cx - r); gx <= Math.min(nx - 1, cx + r); gx++) {
      const k = gz * nx + gx, dx = minX + gx * cell - s.x, dz = minZ + gz * cell - s.z, dd = dx * dx + dz * dz;
      if (dd > REACH * REACH) continue;
      if (dd < b1[k]) { if (i1[k] >= 0 && far(j, i1[k])) { b2[k] = b1[k]; i2[k] = i1[k]; } b1[k] = dd; i1[k] = j; }
      else if (dd < b2[k] && far(j, i1[k])) { b2[k] = dd; i2[k] = j; }
    }
  });
  const base = minY - 0.3, cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2;
  // Coarse inverse-distance field of nearby road height: hills rise with raised road (mountain roads
  // climb the mountain) instead of standing on tall embankments. The city keeps a flat street grid.
  const C = 16, cnx = Math.ceil((nx - 1) * cell / C) + 1, cnz = Math.ceil((nz - 1) * cell / C) + 1, wy = new Float32Array(cnx * cnz), ww = new Float32Array(cnx * cnz);
  if (style.follow > 0) for (let j = 0; j < S.length; j += 2) {
    const s = S[j], cx = Math.round((s.x - minX) / C), cz = Math.round((s.z - minZ) / C), R = 16;
    for (let gz = Math.max(0, cz - R); gz <= Math.min(cnz - 1, cz + R); gz++) for (let gx = Math.max(0, cx - R); gx <= Math.min(cnx - 1, cx + R); gx++) {
      const d2 = ((minX + gx * C - s.x) ** 2 + (minZ + gz * C - s.z) ** 2) / (45 * 45), w = 1 / (1 + d2 * d2), k = gz * cnx + gx;
      wy[k] += w * s.y; ww[k] += w;
    }
  }
  const lift = (x: number, z: number) => {
    if (style.follow <= 0) return 0;
    const fx = clamp((x - minX) / C, 0, cnx - 1.001), fz = clamp((z - minZ) / C, 0, cnz - 1.001), gx = Math.floor(fx), gz = Math.floor(fz), tx = fx - gx, tz = fz - gz;
    const at = (k: number) => ww[k] > 1e-4 ? (wy[k] / ww[k] - base) * Math.min(1, ww[k] * 4) : 0, k = gz * cnx + gx;
    return style.follow * lerp(lerp(at(k), at(k + 1), tx), lerp(at(k + cnx), at(k + cnx + 1), tx), tz);
  };
  // Beach: the course sits on an island whose coast wanders 60–200 m beyond the furthest road.
  const radius = Math.max(...S.map(s => Math.hypot(s.x - cxm, s.z - czm)));
  const horizon = style.sea ? base - 20.5 : base + style.amp * 0.18;
  const natural = (x: number, z: number, out: number) => {
    const n = style.ridged ? ridged(x * style.scale, z * style.scale, seed, 5) * 1.25 - 0.2 : fbm(x * style.scale, z * style.scale, seed, 5);
    const grow = smoothstep(6, 150, out);
    let h = base + lift(x, z) + (n - 0.42) * style.amp * (0.12 + 0.88 * grow) + fbm(x / 23, z / 23, seed + 9, 2) * 1.2 - 0.6;
    if (style.sea) {
      const a = Math.atan2(z - czm, x - cxm), coast = radius + 60 + fbm(Math.cos(a) * 1.6 + 7, Math.sin(a) * 1.6 + 3, seed + 4, 3) * 150;
      h -= clamp((Math.hypot(x - cxm, z - czm) - coast) / 60, 0, 1) * 20;
    }
    // Fade into the flat far ground at the border.
    const edge = Math.min(x - minX, minX + (nx - 1) * cell - x, z - minZ, minZ + (nz - 1) * cell - z);
    return lerp(horizon, h, smoothstep(0, 120, edge));
  };
  const candidate = (x: number, z: number, j: number, out: { out: number }) => {
    const s = S[j], lat = (x - s.x) * s.rx + (z - s.z) * s.rz, left = lat < 0, along = (x - s.x) * s.rz - (z - s.z) * s.rx;
    // Past the end of a stretch the lateral offset alone would read as "on the road": use true distance.
    const edge = s.halfWidth + (left ? s.runoffL : s.runoffR), o = (Math.abs(along) > track.spacing ? Math.hypot(lat, along) : Math.abs(lat)) - edge;
    const roadY = s.y - clamp(lat, -s.halfWidth, s.halfWidth) * Math.tan(s.bank) - 0.3;
    out.out = o;
    const nat = natural(x, z, Math.max(o, 0));
    if ((left ? s.edgeL : s.edgeR) === 'drop') {
      if (o <= 0.25) return roadY;
      const trench = roadY - 22 * smoothstep(0.25, 3.5, o);
      return lerp(trench, Math.min(nat, roadY - 7), smoothstep(16, 64, o));
    }
    if (o <= 2.5) return roadY;
    return Math.min(lerp(roadY, nat, smoothstep(2.5, 34, o)), roadY + (o - 2.5) * 0.7);
  };
  const h = new Float32Array(count), outs = new Float32Array(count), tmp = { out: 0 };
  for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
    const k = gz * nx + gx, x = minX + gx * cell, z = minZ + gz * cell;
    if (i1[k] < 0) { h[k] = natural(x, z, FAR); outs[k] = FAR; continue; }
    const ha = candidate(x, z, i1[k], tmp), oa = tmp.out;
    if (i2[k] >= 0 && far(i1[k], i2[k])) {
      const hb = candidate(x, z, i2[k], tmp), ob = tmp.out;
      // Overlap (overpass): the lower surface wins; otherwise the nearer course edge decides.
      h[k] = oa < 3 && ob < 3 ? Math.min(ha, hb) : oa <= ob ? ha : hb; outs[k] = Math.min(oa, ob);
    } else { h[k] = ha; outs[k] = oa; }
  }
  // Gorges under gaps: run out both sides until another stretch of road comes near, then shallow out.
  const canyons: Canyon[] = track.gaps.map(g => {
    const len = forwardDistance(track, g.d0, g.d1), mid = g.d0 + len / 2, c = sampleAt(track, mid), bound = (x: number, z: number) => Math.min(x - minX, minX + (nx - 1) * cell - x, z - minZ, minZ + (nz - 1) * cell - z) > 130;
    const reach = (side: number) => {
      let u = c.halfWidth + 6;
      for (; u < 320; u += 4) {
        const x = c.x + c.rx * u * side, z = c.z + c.rz * u * side;
        if (!bound(x, z) || S.some(o => Math.abs(signedDistance(track, o.d, mid)) > 50 && (o.x - x) ** 2 + (o.z - z) ** 2 < (o.halfWidth + 34) ** 2)) break;
      }
      return u * side;
    };
    return { x: c.x, z: c.z, ux: c.rx, uz: c.rz, half: len / 2, floor: c.y - 28, u0: reach(-1), u1: reach(1) };
  });
  for (const cy of canyons) for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
    const k = gz * nx + gx, dx = minX + gx * cell - cy.x, dz = minZ + gz * cell - cy.z, u = dx * cy.ux + dz * cy.uz, end = u < 0 ? -cy.u0 : cy.u1;
    if (Math.abs(u) > end) continue;
    const a = Math.abs(dx * cy.uz - dz * cy.ux - canyonBend(cy, u)), w = canyonWidth(cy, u);
    if (a >= w) continue;
    // Flat river bed with low banks, rising to the surrounding ground over the last 50 m.
    const bed = cy.floor + smoothstep(w * 0.45, w, a) * 2.5 + fbm(u / 9, a / 9, seed + 21, 2) * 1.2;
    h[k] = Math.min(h[k], lerp(bed, h[k], smoothstep(end - 50, end, Math.abs(u))));
  }
  const bilinear = (arr: Float32Array, x: number, z: number, fallback: number) => {
    const fx = (x - minX) / cell, fz = (z - minZ) / cell;
    if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return fallback;
    const gx = Math.floor(fx), gz = Math.floor(fz), tx = fx - gx, tz = fz - gz, k = gz * nx + gx;
    return lerp(lerp(arr[k], arr[k + 1], tx), lerp(arr[k + nx], arr[k + nx + 1], tx), tz);
  };
  return { minX, minZ, cell, nx, nz, h, out: outs, base, horizon, canyons,
    heightAt: (x, z) => bilinear(h, x, z, horizon), edgeDistance: (x, z) => bilinear(outs, x, z, FAR) };
}
