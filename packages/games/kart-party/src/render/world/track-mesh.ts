/* Course geometry built from the same samples the physics uses: banked asphalt with painted lines,
 * curbs from curvature, themed aprons, barriers along wall edges, rock drop-offs, bridge decks and
 * pillars for raised road, ramp wedges, animated boost pads, surface zones, start line and grid. */
import * as THREE from 'three';
import { clamp, wrap } from '../../sim/math';
import { forwardDistance, gridSlot, rampHeight, roadHeight, sampleAt, signedDistance, type Track, type TrackSample } from '../../sim/track';
import { onLoopFootprint } from '../loop';
import { Geo } from './geo';
import type { Heightfield } from './heightfield';
import { buildSpaceRibbon } from './space-track';
import type { TextureKit } from './textures';
import type { ThemeStyle } from './theme';

type Span = { d0: number; d1: number };
const inSpan = (track: Track, s: Span, d: number) => s.d0 <= s.d1 ? d >= s.d0 && d <= s.d1 : d >= s.d0 || d <= s.d1;
/** Distances from d0 forward to d1 (wrapping) with at most `step` between rows, both ends included. */
function rowsAlong(track: Track, d0: number, d1: number, step: number) {
  const len = forwardDistance(track, d0, d1) || track.length, n = Math.max(1, Math.ceil(len / step)), out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(d0 + len * i / n);
  return out;
}

/** Shader for boost pads and boost zones: scrolling forward chevrons with glowing rails. */
export function padMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 } }]), fog: true,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    vertexShader: `varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform float time; varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        float x = abs(vUv.x - 0.5) * 2.0;
        float band = fract(vUv.y + x * 0.45 - time * 2.4);
        float chev = smoothstep(0.02, 0.1, band) * (1.0 - smoothstep(0.42, 0.52, band)) * (1.0 - smoothstep(0.78, 0.84, x));
        float rail = smoothstep(0.84, 0.9, x);
        vec3 col = vec3(0.55, 0.12, 0.02) + vec3(0.25, 0.05, 0.0) * sin(time * 9.0 + vUv.y * 3.0);
        col = mix(col, vec3(1.9, 1.35, 0.25), chev);
        col = mix(col, vec3(2.2, 1.9, 1.0), rail);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

export type TrackMeshes = { group: THREE.Group; pads: THREE.ShaderMaterial; water: THREE.Material | null };

export function buildTrackMeshes(track: Track, theme: ThemeStyle, hf: Heightfield, kit: TextureKit, water: THREE.Material | null): TrackMeshes {
  const group = new THREE.Group(); group.name = 'track';
  const L = track.length, S = track.samples;
  // Gaps and loop footprints (the loop's ribbon replaces the road there) carry no road, lines or pillars.
  const gapAt = (d: number) => track.gaps.some(g => inSpan(track, g, d)) || onLoopFootprint(track, d);
  // Main rows: every sample plus exact gap boundaries, closing back at d = L.
  const ds = new Set<number>(S.map(s => s.d)); ds.add(L);
  for (const g of [...track.gaps, ...track.loops]) { ds.add(g.d0); ds.add(g.d1 || L); }
  const rows = [...ds].sort((a, b) => a - b), R = rows.map(d => sampleAt(track, d));
  const skipGap = (r: number) => gapAt(wrap((rows[r] + rows[r + 1]) / 2, L));
  const ground = (s: TrackSample, lat: number) => s.y - clamp(lat, -s.halfWidth, s.halfWidth) * Math.tan(s.bank);
  const put = (o: number[], s: TrackSample, lat: number, dy: number, u: number, v: number) => { o[0] = s.x + s.rx * lat; o[1] = ground(s, lat) + dy; o[2] = s.z + s.rz * lat; o[3] = u; o[4] = v; };
  const edgeOf = (s: TrackSample, side: -1 | 1) => side < 0 ? -(s.halfWidth + s.runoffL) : s.halfWidth + s.runoffR;
  const kindOf = (s: TrackSample, side: -1 | 1) => side < 0 ? s.edgeL : s.edgeR;
  const bridged = R.map(s => s.y - hf.heightAt(s.x, s.z) > 2.2), space = !!theme.space;

  // ---- materials
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ envMapIntensity: 1, ...p });
  const asphalt = kit.asphalt(theme.road);
  const mats = {
    road: std({ map: asphalt, roughness: theme.road.roughness, metalness: theme.road.metalness, vertexColors: true, envMapIntensity: theme.night ? 0.55 : 1 }),
    paint: std({ color: theme.road.line, emissive: theme.road.line, emissiveIntensity: theme.road.lineGlow, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    centre: std({ color: theme.road.centre === 'yellow' ? 0xffc62a : 0xffffff, emissive: theme.road.centre === 'yellow' ? 0xffb000 : 0xffffff, emissiveIntensity: theme.road.lineGlow, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    curb: (() => { const t = kit.stripes(theme.curb[0], theme.curb[1]); return std({ map: t, emissiveMap: t, roughness: 0.55, emissive: 0xffffff, emissiveIntensity: theme.curbGlow, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }); })(),
    apron: std({ map: kit.apron(theme.apron), roughness: 0.95 }),
    wall: std({ map: kit.wall(theme.wall.a, theme.wall.b), roughness: 0.6, side: THREE.DoubleSide }),
    cliff: std({ map: kit.rock(theme.cliff), roughness: 0.95, side: THREE.DoubleSide }),
    concrete: std({ color: theme.night ? 0x585c70 : 0xc9c4bc, roughness: 0.85, side: THREE.DoubleSide }),
    hazard: std({ map: kit.stripes('#ffc21a', '#1b1b22', false), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    rampDeck: (() => { const t = kit.chevrons(theme.ramp[0], theme.ramp[1]); return std({ map: t, emissiveMap: theme.space ? t : null, roughness: 0.5, emissive: theme.night ? 0xffffff : 0x000000, emissiveIntensity: theme.space ? 1.1 : theme.night ? 0.12 : 0 }); })(),
    rampSide: std({ color: new THREE.Color(theme.ramp[1]).multiplyScalar(0.8), roughness: 0.6, side: THREE.DoubleSide }),
    checker: std({ map: kit.checker(2, 2), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    neonA: new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.wall.neon?.[0] ?? 0xffffff).multiplyScalar(2.2) }),
    neonB: new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.wall.neon?.[1] ?? 0xffffff).multiplyScalar(2.2) }),
    ice: std({ color: 0xcdefff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    offroad: std({ map: kit.apron(theme.apron === 'sidewalk' ? 'dirt' : theme.apron), roughness: 1, color: 0xd8d0c0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  const pads = padMaterial();
  const geos = new Map<THREE.Material, Geo>();
  const geo = (m: THREE.Material) => { let g = geos.get(m); if (!g) geos.set(m, g = new Geo()); return g; };

  // ---- road, aprons, lines
  // Road: slightly worn (darker) along the racing line, fresher toward the edges.
  const wear = [1.06, 1.0, 0.9, 1.0, 1.06], shade = new THREE.Color();
  // Rainbow Road replaces road, aprons, curbs, edges, undersides and gap lips with its floating ribbon.
  if (space) group.add(buildSpaceRibbon({ track, rows, R, H: theme.wall.height, time: pads.uniforms.time, skipGap, put, edgeOf, kindOf }));
  else geo(mats.road).grid(rows.length, 5, (r, c, o) => { const s = R[r], lat = c === 2 ? clamp(s.line, -s.halfWidth + 2, s.halfWidth - 2) : c === 1 || c === 3 ? clamp(s.line + (c - 2) * 3.2, -s.halfWidth + 0.5, s.halfWidth - 0.5) : (c - 2) / 2 * s.halfWidth; put(o, s, lat, 0, lat / 7, rows[r] / 7); }, skipGap, (_r, c) => shade.setScalar(wear[c]));
  for (const side of [-1, 1] as const) {
    if (!space) geo(mats.apron).grid(rows.length, 2, (r, c, o) => { const s = R[r], a = side * s.halfWidth, b = edgeOf(s, side), lat = side < 0 ? (c ? a : b) : (c ? b : a); put(o, s, lat, -0.01, lat / 6, rows[r] / 6); }, skipGap);
    geo(mats.paint).grid(rows.length, 2, (r, c, o) => { const s = R[r], lat = side * (s.halfWidth - 0.55) + (c - 0.5) * 0.32; put(o, s, lat, 0.012, 0, 0); }, skipGap);
  }
  if (theme.road.centre !== 'none') {
    const dash = rowsAlong(track, 0, L - 0.01, 1.5), DS = dash.map(d => sampleAt(track, d));
    geo(mats.centre).grid(dash.length, 2, (r, c, o) => put(o, DS[r], (c - 0.5) * 0.24, 0.012, 0, 0), r => Math.floor(dash[r] / 3) % 2 === 1 || gapAt(dash[r]));
  }

  // ---- curbs on tight corners (inside always, outside when very tight)
  const smoothK = rows.map(d => { let k = 0; for (let o = -8; o <= 8; o += 2) k += sampleAt(track, d + o).curvature; return k / 9; });
  for (const side of space ? [] : [-1, 1] as const) {
    const on = rows.map((_, r) => { const k = smoothK[r] * -side; return (k > 1 / 80 || Math.abs(smoothK[r]) > 1 / 38) && (side < 0 ? R[r].runoffL : R[r].runoffR) >= 1; });
    geo(mats.curb).grid(rows.length, 2, (r, c, o) => {
      const s = R[r], w = Math.min(1.5, side < 0 ? s.runoffL : s.runoffR), a = side * s.halfWidth, b = side * (s.halfWidth + w), lat = side < 0 ? (c ? a : b) : (c ? b : a);
      put(o, s, lat, 0.035, c, rows[r] / 3);
    }, r => !on[r] || !on[r + 1] || skipGap(r));
  }

  // ---- edges: barriers on walls, rock faces on drops, fascia + underside on bridges
  const H = theme.wall.height;
  for (const side of space ? [] : [-1, 1] as const) {
    const wall = (r: number) => kindOf(R[r], side) === 'wall' && kindOf(R[r + 1], side) === 'wall' && !skipGap(r);
    const drop = (r: number) => kindOf(R[r], side) === 'drop' && kindOf(R[r + 1], side) === 'drop' && !skipGap(r);
    const at = (r: number, extra: number, dy: number, o: number[], u: number, v: number) => { const s = R[r], e = edgeOf(s, side); put(o, s, e + side * extra, dy, u, v); };
    // Barrier: inner face, top, outer face (separate strips keep the corners crisp).
    geo(mats.wall).grid(rows.length, 2, (r, c, o) => at(r, c ? 0.08 : 0, c ? H : -0.25, o, rows[r] / 4, c ? 0.05 : 0.95), r => !wall(r));
    geo(mats.wall).grid(rows.length, 2, (r, c, o) => at(r, c ? 0.62 : 0.08, H, o, rows[r] / 4, 0.02), r => !wall(r));
    geo(mats.wall).grid(rows.length, 2, (r, c, o) => at(r, c ? 0.62 : 0.7, c ? H : -0.4, o, rows[r] / 4, c ? 0.05 : 0.95), r => !wall(r));
    if (theme.wall.neon) geo(side < 0 ? mats.neonA : mats.neonB).grid(rows.length, 2, (r, c, o) => at(r, c ? 0.46 : 0.24, H + 0.015, o, 0, 0), r => !wall(r));
    // Drop edge: hazard paint on the lip and a deep rock face (or a short fascia on a bridge).
    geo(mats.hazard).grid(rows.length, 2, (r, c, o) => at(r, c ? -0.55 : 0, 0.014, o, c, rows[r] / 1.6), r => !drop(r));
    geo(mats.cliff).grid(rows.length, 2, (r, c, o) => at(r, 0, c ? -0.01 : bridged[r] ? -1.6 : -18, o, rows[r] / 8, c ? 0 : bridged[r] ? 0.2 : 2.2), r => !drop(r));
    geo(mats.concrete).grid(rows.length, 2, (r, c, o) => at(r, 0.05, c ? -0.3 : -1.6, o, 0, 0), r => !(bridged[r] && bridged[r + 1]) || drop(r) || skipGap(r));
  }
  // Bridge underside.
  if (!space) geo(mats.concrete).grid(rows.length, 2, (r, c, o) => { const s = R[r], e = edgeOf(s, c ? -1 : 1); put(o, s, e, -1.6, 0, 0); }, r => !(bridged[r] && bridged[r + 1]) || skipGap(r));
  // Gap lips: vertical faces where the road stops, plus hazard stripes.
  for (const g of space ? [] : track.gaps) for (const [d, dir] of [[g.d0, 1], [g.d1, -1]] as const) {
    const s = sampleAt(track, d), l = -(s.halfWidth + s.runoffL), r = s.halfWidth + s.runoffR, gg = geo(mats.cliff);
    gg.grid(2, 2, (row, c, o) => put(o, s, c ? r : l, row ? -0.01 : -30, (c ? r : l) / 8, row ? 0 : 3.7));
    const s2 = sampleAt(track, d - dir * 0.8), [a, b] = dir > 0 ? [s2, s] : [s, s2];
    geo(mats.hazard).grid(2, 2, (row, c, o) => { const ss = row ? b : a; put(o, ss, c ? ss.halfWidth : -ss.halfWidth, 0.014, c * ss.halfWidth, row * 0.5); });
  }

  // ---- ramps: striped deck, sides and the lip face
  for (const ramp of track.ramps) {
    const rr = rowsAlong(track, ramp.d0, ramp.d1, 0.5), RS = rr.map(d => sampleAt(track, d)), n = rr.length;
    const top = (i: number, lat: number) => roadHeight(track, rr[i], lat, RS[i]) + rampHeight(ramp, track, i === n - 1 ? ramp.d1 - 1e-4 : wrap(rr[i], L), lat);
    const len = forwardDistance(track, ramp.d0, ramp.d1);
    const P = (i: number, lat: number, y: number, o: number[], u: number, v: number) => { const s = RS[i]; o[0] = s.x + s.rx * lat; o[1] = y; o[2] = s.z + s.rz * lat; o[3] = u; o[4] = v; };
    const lo = ramp.lat - ramp.halfWidth, hi = ramp.lat + ramp.halfWidth, deckV = (i: number) => (i / (n - 1)) * len / 2.4;
    geo(mats.rampDeck).grid(n, 2, (i, c, o) => { const lat = c ? hi : lo; P(i, lat, top(i, lat) + 0.02, o, c, deckV(i)); });
    for (const lat of [lo, hi]) geo(mats.rampSide).grid(n, 2, (i, c, o) => P(i, lat, c ? top(i, lat) + 0.02 : roadHeight(track, rr[i], lat, RS[i]) - 0.05, o, 0, 0));
    geo(mats.rampSide).grid(2, 2, (row, c, o) => { const lat = c ? hi : lo; P(n - 1, lat, row ? top(n - 1, lat) + 0.02 : roadHeight(track, rr[n - 1], lat, RS[n - 1]) - 0.05, o, 0, 0); });
  }

  // ---- boost pads, surface zones, start line and grid
  const padGeo = new Geo();
  for (const p of track.pads) {
    const pr = rowsAlong(track, p.d0, p.d1, 0.5), PS = pr.map(d => sampleAt(track, d)), len = forwardDistance(track, p.d0, p.d1);
    padGeo.grid(pr.length, 2, (i, c, o) => put(o, PS[i], p.lat + (c ? p.halfWidth : -p.halfWidth), 0.025, c, (i / (pr.length - 1)) * len / 2.2));
  }
  for (const z of track.zones) {
    const zr = rowsAlong(track, z.d0, z.d1, 1), ZS = zr.map(d => sampleAt(track, d));
    const target = z.surface === 'boost' ? padGeo : z.surface === 'water' && water ? geo(water) : geo(z.surface === 'ice' ? mats.ice : mats.offroad);
    target.grid(zr.length, 4, (i, c, o) => {
      const s = ZS[i], cuts = [z.latMin, clamp(-s.halfWidth, z.latMin, z.latMax), clamp(s.halfWidth, z.latMin, z.latMax), z.latMax], lat = cuts[c];
      put(o, s, lat, 0.02, z.surface === 'boost' ? (lat - z.latMin) / (z.latMax - z.latMin) : lat / 6, (zr[i] - zr[0]) / (z.surface === 'boost' ? 2.2 : 6));
    });
  }
  const start = rowsAlong(track, L - 1.25, 1.25, 0.5), SS = start.map(d => sampleAt(track, d));
  geo(mats.checker).grid(start.length, 2, (i, c, o) => { const s = SS[i], lat = c ? s.halfWidth : -s.halfWidth; put(o, s, lat, 0.018, lat / 1.6, (i / (start.length - 1)) * 2.5 / 1.6); });
  const paint = geo(mats.paint);
  for (let slot = 0; slot < 10; slot++) {
    const g = gridSlot(track, slot);
    const box = (a0: number, a1: number, l0: number, l1: number) => {
      const s0 = sampleAt(track, g.d + a0), s1 = sampleAt(track, g.d + a1);
      paint.grid(2, 2, (row, c, o) => { const ss = row ? s1 : s0; put(o, ss, g.lateral + (c ? l1 : l0), 0.014, 0, 0); });
    };
    box(1.7, 1.95, -1.35, 1.35); box(0.4, 1.95, -1.35, -1.15); box(0.4, 1.95, 1.15, 1.35);
  }

  // ---- assemble
  const shadowCasters = new Set<THREE.Material>([mats.wall, mats.rampSide, mats.rampDeck]);
  for (const [m, g] of geos) {
    const built = g.build(); if (!built) continue;
    const mesh = new THREE.Mesh(built, m); mesh.receiveShadow = true; mesh.castShadow = shadowCasters.has(m);
    mesh.matrixAutoUpdate = false; group.add(mesh);
  }
  const padBuilt = padGeo.build();
  if (padBuilt) { const m = new THREE.Mesh(padBuilt, pads); m.matrixAutoUpdate = false; group.add(m); }
  // Pillars under raised road, every ~15 m, two per deck on wide roads.
  const pillars: THREE.Matrix4[] = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let d = 4; d < (space ? 0 : L); d += 15) {
    const s = sampleAt(track, d);
    if (!(s.y - hf.heightAt(s.x, s.z) > 3) || gapAt(d)) continue;
    const lats = s.halfWidth > 7 ? [-s.halfWidth * 0.55, s.halfWidth * 0.55] : [0];
    for (const lat of lats) {
      const x = s.x + s.rx * lat, z = s.z + s.rz * lat, topY = ground(s, lat) - 1.5, g = hf.heightAt(x, z) - 1;
      // Never stand a pillar on another stretch of course (the road passing underneath).
      const blocked = S.some(o => Math.abs(signedDistance(track, o.d, d)) > 40 && Math.hypot(o.x - x, o.z - z) < o.halfWidth + Math.max(o.runoffL, o.runoffR) + 2);
      if (topY - g < 1 || blocked) continue;
      q.setFromAxisAngle(up, s.heading);
      pillars.push(m4.compose(new THREE.Vector3(x, (topY + g) / 2, z), q, new THREE.Vector3(1, topY - g, 1)).clone());
    }
  }
  if (pillars.length) {
    const inst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9, 1.1, 1, 10), mats.concrete, pillars.length);
    pillars.forEach((p, i) => inst.setMatrixAt(i, p)); inst.castShadow = inst.receiveShadow = true; inst.computeBoundingSphere(); group.add(inst);
  }
  return { group, pads, water };
}
