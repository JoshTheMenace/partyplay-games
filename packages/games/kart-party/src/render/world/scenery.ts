/* Scenery: trackside dressing, corner arrow boards, start-area stands, track landmarks, obstacles and
 * a themed field scatter — never inside the course. Instanced per prop part and spatial chunk so a
 * whole forest costs a handful of draw calls and off-screen chunks are culled. */
import * as THREE from 'three';
import { headingOf, wrap } from '../../sim/math';
import { sampleAt, type Track } from '../../sim/track';
import type { QualityTier } from '../types';
import type { Heightfield } from './heightfield';
import { seeded } from './noise';
import type { PropLibrary } from './props';
import type { ThemeStyle } from './theme';

/** `tilt` rolls/pitches floating props (radians); `centre` hangs the prop by its middle instead of its base; `tint` multiplies its colour. */
export type Placement = { kind: string; x: number; y: number; z: number; yaw: number; scale: number; mirror?: boolean; sy?: number; tilt?: number; centre?: boolean; tint?: number };
export type Lamp = { x: number; y: number; z: number; d: number; lateral: number };

/** Pure placement pass (deterministic per track). */
export function placeScenery(track: Track, theme: ThemeStyle, hf: Heightfield, quality: QualityTier, seed: number): { props: Placement[]; lamps: Lamp[] } {
  const rand = seeded(seed), props: Placement[] = [], lamps: Lamp[] = [], L = track.length;
  const edge = (s: ReturnType<typeof sampleAt>, side: number) => s.halfWidth + (side < 0 ? s.runoffL : s.runoffR);
  const kindAt = (s: ReturnType<typeof sampleAt>, side: number) => side < 0 ? s.edgeL : s.edgeR;
  const gapAt = (d: number) => track.gaps.some(g => g.d0 <= g.d1 ? d >= g.d0 && d <= g.d1 : d >= g.d0 || d <= g.d1);
  const taken: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, r: number) => taken.every(t => (t.x - x) ** 2 + (t.z - z) ** 2 > (t.r + r) ** 2);
  const beside = (d: number, side: number, offset: number) => { const s = sampleAt(track, d), lat = side * (edge(s, side) + offset); return { s, x: s.x + s.rx * lat, z: s.z + s.rz * lat, lat }; };
  const faceRoad = (s: ReturnType<typeof sampleAt>, side: number) => headingOf(-side * s.rx, -side * s.rz);
  const add = (p: Placement, r: number) => { props.push(p); taken.push({ x: p.x, z: p.z, r }); };

  // Start area: grandstands and flags either side of the line.
  for (const side of [-1, 1]) for (const d of [-26, 18]) {
    const b = beside(d, side, 6.5);
    if (kindAt(b.s, side) !== 'wall' || hf.edgeDistance(b.x, b.z) < 4) continue;
    add({ kind: 'crowd_stand', x: b.x, y: hf.heightAt(b.x, b.z), z: b.z, yaw: faceRoad(b.s, side), scale: 1 }, 9);
  }
  // Landmarks authored on the track.
  for (const lm of track.def.landmarks) {
    const d = wrap(lm.at, 1) * L, b = beside(d, lm.side, lm.offset);
    add({ kind: lm.kind, x: b.x, y: hf.heightAt(b.x, b.z) - 0.2, z: b.z, yaw: faceRoad(b.s, lm.side) + (lm.yaw ?? 0) * Math.PI / 180, scale: lm.scale ?? 1 }, 6 * (lm.scale ?? 1));
  }
  // Obstacles collide, so they sit exactly where the physics puts them (scaled to their radius later).
  for (const o of track.obstacles) props.push({ kind: o.kind, x: o.x, y: o.y, z: o.z, yaw: sampleAt(track, o.d).heading, scale: -o.radius });
  // Corner boards on the outside of tight corners, pointing into the turn.
  let last = -Infinity;
  const curv = (d: number) => { let k = 0; for (let o = -10; o <= 10; o += 2) k += sampleAt(track, d + o).curvature; return k / 11; };
  for (let d = 0; d < L; d += 4) {
    const k = curv(d);
    if (Math.abs(k) < 1 / 42 || Math.abs(k) < Math.abs(curv(d - 4)) || Math.abs(k) < Math.abs(curv(d + 4)) || d - last < 45) continue;
    last = d; const out = k > 0 ? 1 : -1;
    for (const off of [-14, -6, 2]) {
      const b = beside(d + off, out, 1.6);
      if (kindAt(b.s, out) !== 'wall' || gapAt(wrap(d + off, L))) continue;
      add({ kind: 'arrow_sign', x: b.x, y: hf.heightAt(b.x, b.z), z: b.z, yaw: b.s.heading + Math.PI, scale: 1, mirror: k > 0 }, 1.5);
    }
  }
  // Regular trackside dressing (street lights, palms, flags...).
  for (const rule of theme.trackside) {
    let n = 0;
    for (let d = rule.spacing * 0.5; d < L - 10; d += rule.spacing, n++) {
      if (d < 40 || d > L - 40) continue;                         // keep the start area clear
      const k = curv(d), sides = rule.sides === 'both' ? [-1, 1] : rule.sides === 'alternate' ? [n % 2 ? 1 : -1] : [k > 0 ? 1 : -1];
      if (rule.straightOnly && Math.abs(k) > 1 / 110) continue;
      for (const side of sides) {
        const b = beside(d, side, rule.offset);
        if (kindAt(b.s, side) !== 'wall' || gapAt(d) || hf.edgeDistance(b.x, b.z) < rule.offset - 1 || !free(b.x, b.z, 1.5)) continue;
        add({ kind: rule.kind, x: b.x, y: hf.heightAt(b.x, b.z), z: b.z, yaw: rule.face === 'road' ? faceRoad(b.s, side) : b.s.heading, scale: rule.scale }, 1.5);
        if (rule.kind === 'street_light' || rule.kind === 'lamp_post') lamps.push({ x: b.x - b.s.rx * side * 2.4, y: b.s.y, z: b.z - b.s.rz * side * 2.4, d, lateral: b.lat - side * 2.4 });
      }
    }
  }
  // Field scatter on a jittered grid; denser near the course where it is seen up close.
  const keep = quality === 0 ? 1 : quality === 1 ? 0.75 : 0.45, total = theme.scatter.reduce((a, r) => a + r.weight, 0);
  const cell = theme.night ? 15 : 9, x0 = hf.minX + 20, z0 = hf.minZ + 20, x1 = hf.minX + (hf.nx - 1) * hf.cell - 20, z1 = hf.minZ + (hf.nz - 1) * hf.cell - 20;
  const water = theme.water?.level ?? -Infinity;
  for (let z = z0; z < z1; z += cell) for (let x = x0; x < x1; x += cell) {
    const px = x + (rand() - 0.5) * cell * 0.9, pz = z + (rand() - 0.5) * cell * 0.9, out = hf.edgeDistance(px, pz), roll = rand(), pick = rand() * total, yaw = rand() * Math.PI * 2, sc = rand();
    const density = out < 6 ? 0 : out < 70 ? 0.42 : out < 180 ? 0.2 : 0.07;
    if (roll > density * keep) continue;
    let acc = 0, rule = theme.scatter[0];
    for (const r of theme.scatter) { acc += r.weight; if (pick <= acc) { rule = r; break; } }
    const y = hf.heightAt(px, pz);
    if (out < (rule.min ?? 6) + rule.radius || out > (rule.max ?? Infinity)) continue;
    if (rule.water ? y > water - 1.2 : y < water + 0.25) continue;
    if (rule.shore && y > water + 2.5) continue;
    const slope = Math.abs(hf.heightAt(px + 2, pz) - hf.heightAt(px - 2, pz)) + Math.abs(hf.heightAt(px, pz + 2) - hf.heightAt(px, pz - 2));
    if (slope > (rule.radius > 5 ? 1.2 : 3) || !free(px, pz, rule.radius * 0.6) || hf.canyons.some(c => y < c.floor + 6)) continue;
    const scale = rule.scale[0] + (rule.scale[1] - rule.scale[0]) * sc;
    const grid = theme.night ? Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2) : yaw;           // city blocks stay square
    add({ kind: rule.kind, x: px, y: rule.water ? water - 0.35 : y - 0.12, z: pz, yaw: grid, scale, sy: theme.night && rule.kind.startsWith('building') ? 0.7 + sc * 0.9 : undefined }, rule.radius * scale * 0.6);
  }
  return { props, lamps };
}

/** All scenery drawn through one BatchedMesh per material: every prop kind sharing a finish costs a
 * single (multi-)draw call, and instances are frustum-culled individually. Negative scale = fit radius. */
export function instanceScenery(placements: Placement[], lib: PropLibrary, shadows: boolean): THREE.Group {
  const group = new THREE.Group(); group.name = 'scenery';
  const resolved = placements.map(p => ({ p, t: lib.template(p.kind, !!p.mirror) }));
  const batches = new Map<THREE.Material, { geos: Set<THREE.BufferGeometry>; verts: number; count: number }>();
  for (const { t } of resolved) for (const part of t.parts) {
    let b = batches.get(part.material);
    if (!b) batches.set(part.material, b = { geos: new Set(), verts: 0, count: 0 });
    if (!b.geos.has(part.geometry)) { b.geos.add(part.geometry); b.verts += part.geometry.getAttribute('position').count; }
    b.count++;
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), e = new THREE.Euler(), tint = new THREE.Color();
  for (const [material, b] of batches) {
    const mesh = new THREE.BatchedMesh(b.count, b.verts, b.verts, material), ids = new Map<THREE.BufferGeometry, number>();
    for (const g of b.geos) ids.set(g, mesh.addGeometry(g));
    for (const { p, t } of resolved) {
      const s = p.scale < 0 ? -p.scale / t.radius : p.scale;
      const tilt = p.tilt ?? 0, lift = p.centre ? t.height * s / 2 : 0;
      m.compose(pos.set(p.x, p.y - lift, p.z), q.setFromEuler(e.set(tilt, p.yaw, tilt * 0.7, 'YXZ')), scl.set(s, s * (p.sy ?? 1), s));
      for (const part of t.parts) if (part.material === material) { const id = mesh.addInstance(ids.get(part.geometry)!); mesh.setMatrixAt(id, m); if (p.tint !== undefined) mesh.setColorAt(id, tint.set(p.tint)); }
    }
    // Per-instance culling stays; depth sorting is skipped (opaque props, and it costs CPU in every pass of every viewport).
    mesh.sortObjects = false; mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return group;
}
