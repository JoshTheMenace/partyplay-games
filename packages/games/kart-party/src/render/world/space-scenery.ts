/* Rainbow Road scenery: nothing stands on ground — track landmarks hover beside the ribbon, star
 * crystals float along it, and an asteroid field (with satellites and small ringed moons) fills the
 * void above and below, always clear of the course in 3D. Pure and deterministic per track. */
import * as THREE from 'three';
import { clamp, headingOf, wrap } from '../../sim/math';
import { loopPose, sampleAt, type Track } from '../../sim/track';
import { loopHalfWidth } from '../loop';
import type { QualityTier } from '../types';
import { seeded } from './noise';
import type { PropLibrary } from './props';
import type { Placement } from './scenery';

/** 3D clearance from the course: metres from (x, y, z) to the nearest point of any road + apron or loop hoop (≥ 0). */
export function courseClearance(track: Track, x: number, y: number, z: number) {
  let best = Infinity;
  for (const s of track.samples) {
    const dx = x - s.x, dz = z - s.z, c = clamp(dx * s.rx + dz * s.rz, -(s.halfWidth + s.runoffL), s.halfWidth + s.runoffR);
    best = Math.min(best, (dx - s.rx * c) ** 2 + (dz - s.rz * c) ** 2 + (y - s.y) ** 2);
  }
  for (const l of track.loops) for (let th = 0, hw = loopHalfWidth(track, l); th < 6.3; th += 0.05) {
    const p = loopPose(l, th, 0), dx = x - p.x, dz = z - p.z, c = clamp(dx * l.rx + dz * l.rz, -hw, hw);
    best = Math.min(best, (dx - l.rx * c) ** 2 + (dz - l.rz * c) ** 2 + (y - p.y) ** 2);
  }
  return Math.max(0, Math.sqrt(best) - track.spacing / 2);
}

export function placeSpaceScenery(track: Track, quality: QualityTier, seed: number): Placement[] {
  const rand = seeded(seed), props: Placement[] = [], L = track.length, S = track.samples;
  const edge = (s: ReturnType<typeof sampleAt>, side: number) => s.halfWidth + (side < 0 ? s.runoffL : s.runoffR);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of S) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y); }
  // Landmarks authored on the track hover by their middle, a little below road level.
  for (const lm of track.def.landmarks) {
    if (lm.kind === 'planet_ringed') continue;     // the shaded hero planet (space-sky) is the course's planet; a flat copy nearby cheapens it
    const d = wrap(lm.at, 1) * L, s = sampleAt(track, d), lat = lm.side * (edge(s, lm.side) + lm.offset);
    props.push({ kind: lm.kind, x: s.x + s.rx * lat, y: s.y - 1.5, z: s.z + s.rz * lat, yaw: headingOf(-lm.side * s.rx, -lm.side * s.rz) + (lm.yaw ?? 0) * Math.PI / 180, scale: lm.scale ?? 1, centre: true });
  }
  // Obstacles collide, so they sit exactly where the physics puts them (scaled to their radius).
  for (const o of track.obstacles) props.push({ kind: o.kind, x: o.x, y: o.y, z: o.z, yaw: sampleAt(track, o.d).heading, scale: -o.radius });
  // Star crystals drifting beside the ribbon.
  for (let d = 30, n = 0; d < L - 20; d += 38, n++) {
    const side = n % 2 ? 1 : -1, s = sampleAt(track, d), lat = side * (edge(s, side) + 5 + rand() * 7), x = s.x + s.rx * lat, z = s.z + s.rz * lat, y = s.y - 4 + rand() * 7;
    if (courseClearance(track, x, y, z) < 3.5) continue;
    props.push({ kind: 'star_crystal', x, y, z, yaw: rand() * 6.28, scale: 0.8 + rand() * 0.7, tilt: (rand() - 0.5) * 0.8, centre: true });
  }
  // The field: asteroids mostly below and far out (the sky above stays open), a few satellites nearer,
  // one small ringed moon far away. Distance darkens and cools them so the course stays the brightest thing.
  const count = [150, 110, 70][quality], pad = 560, near = new THREE.Color(0xc4bce0), far = new THREE.Color(0x4a3f78), c = new THREE.Color();
  for (let i = 0, tries = 0; i < count && tries < count * 8; tries++) {
    const below = rand() < 0.62, x = x0 - pad + rand() * (x1 - x0 + pad * 2), z = z0 - pad + rand() * (z1 - z0 + pad * 2);
    const y = below ? y0 - 25 - rand() ** 0.7 * 220 : y0 - 20 + rand() * (y1 - y0 + 160);
    const clear = courseClearance(track, x, y, z), k = Math.min(1, clear / 420), sat = !below && rand() < 0.08 && clear > 35 && clear < 170;
    const scale = sat ? 1.3 + rand() * 0.8 : (0.4 + k * 4.5) * (0.35 + rand() * 0.65);
    if (clear < 16 + scale * 4 || (!below && !sat && clear < 110)) continue;
    props.push({ kind: sat ? 'satellite' : rand() < 0.5 ? 'asteroid_a' : 'asteroid_b', x, y, z, yaw: rand() * 6.28, scale, tilt: (rand() - 0.5) * 2.4, centre: true, tint: c.copy(near).lerp(far, k).getHex() });
    i++;
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  props.push({ kind: 'planet_ringed', x: cx + Math.sin(4.2) * 1900, y: y0 - 260, z: cz + Math.cos(4.2) * 1900, yaw: 1, scale: -120, centre: true, tint: 0x8a78b8 });
  return props;
}

/** The distant space station: its own small group so it can turn slowly. */
export function buildStation(track: Track, lib: PropLibrary, center: THREE.Vector3, dir: THREE.Vector3) {
  let y1 = -Infinity; for (const s of track.samples) y1 = Math.max(y1, s.y);
  const t = lib.template('space_station'), group = new THREE.Group(), k = 90 / Math.max(10, t.height);
  for (const part of t.parts) group.add(new THREE.Mesh(part.geometry, part.material));
  group.scale.setScalar(k); group.position.copy(center).addScaledVector(dir, 900); group.position.y = y1 + 70;
  group.rotation.set(0.35, 0, 0.2);
  return group;
}
