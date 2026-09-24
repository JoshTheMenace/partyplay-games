/* Rainbow Road loop-the-loop (DESIGN §9.1): the ribbon's seven glowing bands, flowing pulses, energy rails on
 * both edges, a glowing outer shell and chasing marker lights, swept along loopPose so the hoop is exactly what
 * karts ride; its apron tapers into the lane at both ends. At the mouth: two rainbow arches and a chevron sign. */
import * as THREE from 'three';
import { smoothstep, TAU } from '../../sim/math';
import { forwardDistance, sampleAt, type Track, type TrackSample } from '../../sim/track';
import { loopFrame, loopHalfWidth, type LoopFrame } from '../loop';
import { Geo } from './geo';

export type LoopMats = { road: THREE.Material; apron: THREE.Material; under: THREE.Material; rail: THREE.Material; bar: THREE.Material };
export type LoopCtx = {
  track: Track; H: number; thick: number; mats: LoopMats; geo(m: THREE.Material): Geo;
  edgeOf(s: TrackSample, side: -1 | 1): number; lights: number[]; lightD: number[];
  glow(fragment: string): THREE.ShaderMaterial;
};

export function buildSpaceLoops(c: LoopCtx): THREE.Group {
  const { track, H, thick, mats, geo, edgeOf } = c, group = new THREE.Group(); group.name = 'loops';
  if (!track.loops.length) return group;
  const arch = c.glow(`float p = fract(abs(vUv.y - 0.5) * 3.0 + uTime * 1.1), pulse = smoothstep(0.0, 0.06, p) * smoothstep(0.3, 0.06, p);
      gl_FragColor = vec4(rainbow(clamp(vUv.x, 0.0, 0.999)) * (1.1 + 2.2 * pulse), 1.0);`);
  // Sign: dark glass, a flowing rainbow frame and three columns of chevrons climbing upward.
  // Bold, bright chevrons (one row per panel height) so the sign still reads from the chase camera 40 m back.
  const sign = c.glow(`vec2 q = vUv * vec2(3.0, 1.0); float cx = fract(q.x) - 0.5, y = fract(vUv.y - uTime * 1.1);
      float chev = smoothstep(0.24, 0.16, abs(y - 0.5 + abs(cx) * 0.8)) * step(abs(cx), 0.42);
      float e = min(min(vUv.x, 1.0 - vUv.x) * 7.0, min(vUv.y, 1.0 - vUv.y) * 2.6), frame = smoothstep(0.16, 0.1, e);
      vec3 col = vec3(0.07, 0.02, 0.16) + hue(fract(vUv.x * 0.8 - vUv.y * 0.3 - uTime * 0.35)) * (frame * 1.8 + chev * 2.4);
      gl_FragColor = vec4(col, 1.0);`);
  const archG = new Geo(), signG = new Geo();
  for (const loop of track.loops) {
    const hw = loopHalfWidth(track, loop), len = forwardDistance(track, loop.d0, loop.d1);
    const n = Math.ceil(TAU * (loop.radius + 3) / 0.7) + 1, F: LoopFrame[] = [], V: number[] = [];
    for (let i = 0; i < n; i++) { F.push(loopFrame(loop, TAU * i / (n - 1), 0)); V.push(loop.d0 + len * i / (n - 1)); }
    // Row i at `lat` (along the loop's lateral axis, as loopPose places karts) and `dn` metres along the ribbon normal.
    const put = (o: number[], i: number, lat: number, dn: number, u: number, v: number) => {
      const f = F[i]; o[0] = f.x + loop.rx * lat + f.ux * dn; o[1] = f.y + f.uy * dn; o[2] = f.z + loop.rz * lat + f.uz * dn; o[3] = u; o[4] = v;
    };
    // The lane is the road at the entry; its apron tapers away over the first and last few metres, so the funnel's walls
    // flow straight into the loop rails (a kart that came in wide is eased into the lane there).
    const s0 = sampleAt(track, loop.d0), s1 = sampleAt(track, loop.d1), taper = (i: number) => 1 - smoothstep(0, 0.35, Math.min(TAU * i / (n - 1), TAU - TAU * i / (n - 1)));
    const edge = (i: number, side: -1 | 1) => side * hw + (edgeOf(i < n / 2 ? s0 : s1, side) - side * hw) * taper(i);
    geo(mats.road).grid(n, 8, (i, col, o) => put(o, i, (col / 7 * 2 - 1) * hw, 0, col / 7, V[i]));
    geo(mats.under).grid(n, 2, (i, col, o) => put(o, i, edge(i, col ? -1 : 1), -thick, col ? 0 : 0.999, V[i]));
    for (const side of [-1, 1] as const) {
      const out = (i: number, x: number) => edge(i, side) + side * x;
      geo(mats.apron).grid(n, 2, (i, col, o) => { const lat = (side < 0) === !col ? edge(i, side) : side * hw; put(o, i, lat, -0.005, lat, V[i]); });
      geo(mats.under).grid(n, 2, (i, col, o) => put(o, i, edge(i, side), col ? 0 : -thick, side < 0 ? 0 : 0.999, V[i]));
      geo(mats.rail).grid(n, 2, (i, col, o) => put(o, i, edge(i, side), col ? H : -thick, V[i], col ? 1 : 0));
      geo(mats.bar).grid(n, 2, (i, col, o) => put(o, i, out(i, side < 0 ? (col ? -0.02 : 0.22) : (col ? 0.22 : -0.02)), H, V[i], 0));
      geo(mats.bar).grid(n, 2, (i, col, o) => put(o, i, out(i, -0.02), col ? H : H - 0.14, V[i], 0));
      for (let i = 0; i < n; i += 4) { const o = [0, 0, 0, 0, 0]; put(o, i, out(i, -0.1), H + 0.08, 0, 0); c.lights.push(o[0], o[1], o[2]); c.lightD.push(V[i]); }
    }
    // Gateway: two rainbow arches over the mouth (red outermost, pulses climbing to the crown) and a chevron sign on the first.
    for (const [back, B] of [[1.2, 8.5], [11, 7.6]] as const) {
      const s = sampleAt(track, loop.d0 - back), A = Math.max(-edgeOf(s, -1), edgeOf(s, 1)) + 0.6, W = 1.5;
      const P = (o: number[], phi: number, r: number, along: number, u: number, v: number) => {
        const lat = Math.cos(phi) * (A + r), y = Math.sin(phi) * (B + r);
        o[0] = s.x + s.rx * lat + s.tx * along; o[1] = s.y + y; o[2] = s.z + s.rz * lat + s.tz * along; o[3] = u; o[4] = v;
      };
      const m = 64;
      for (const along of [-0.3, 0.3]) archG.grid(m, 8, (i, col, o) => P(o, Math.PI * i / (m - 1), W * (col / 7 - 0.5), along, 1 - col / 7, i / (m - 1)));
      for (const r of [-W / 2, W / 2]) archG.grid(m, 2, (i, col, o) => P(o, Math.PI * i / (m - 1), r, col ? 0.3 : -0.3, r > 0 ? 0 : 0.999, i / (m - 1)));
      if (back < 2) signG.grid(2, 2, (row, col, o) => {
        const lat = (col - 0.5) * 8; o[0] = s.x + s.rx * lat - s.tx * 0.4; o[1] = s.y + B + W / 2 + 2.9 + (row - 0.5) * 3; o[2] = s.z + s.rz * lat - s.tz * 0.4; o[3] = col; o[4] = row;
      });
    }
  }
  const addMesh = (built: THREE.BufferGeometry | null, m: THREE.Material) => { if (built) { const mesh = new THREE.Mesh(built, m); mesh.matrixAutoUpdate = false; group.add(mesh); } };
  addMesh(archG.build(), arch); addMesh(signG.build(), sign);
  return group;
}
