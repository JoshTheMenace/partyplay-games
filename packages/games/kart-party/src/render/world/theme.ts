/* Art direction per course theme: sky, light, fog, surfaces, terrain and scenery rules. */
import type { ThemeId } from '../../sim/types';

/** Field scatter: `min`/`max` metres beyond the course edge; `water` only below sea level, `shore` near it. */
export type ScatterRule = { kind: string; weight: number; scale: [number, number]; radius: number; min?: number; max?: number; water?: boolean; shore?: boolean; tint?: number };
/** Regular trackside dressing: one prop every `spacing` metres, `offset` metres beyond the edge. */
export type TracksideRule = { kind: string; spacing: number; offset: number; scale: number; sides: 'both' | 'outside' | 'alternate'; straightOnly?: boolean; face: 'road' | 'along' };
export type ThemeStyle = {
  night: boolean;
  /** Rainbow Road: no ground at all — a floating ribbon, space sky, glowing rails and floating scenery (world/space-*.ts). */
  space?: boolean;
  sky: { top: number; horizon: number; bottom: number; sunColor: number; sunSize: number; glow: number; clouds: number; cloudColor: number; stars: number };
  sun: { elevation: number; azimuth: number; color: number; intensity: number };
  hemi: { sky: number; ground: number; intensity: number };
  env: number; exposure: number;
  fog: { color: number; near: number; far: number };
  road: { base: string; speck: string; roughness: number; metalness: number; line: number; lineGlow: number; centre: 'none' | 'white' | 'yellow' };
  curb: [string, string]; curbGlow: number;
  apron: 'sand' | 'dirt' | 'sidewalk' | 'snow';
  wall: { a: string; b: string; height: number; neon: [number, number] | null };
  ramp: [string, string];
  terrain: { low: number; mid: number; high: number; rock: number; shore: number; top: number; amp: number; scale: number; ridged: boolean; sea: number; follow: number };
  water: { level: number; color: number; deep: number } | null;
  cliff: number;
  silhouettes: { kind: 'islands' | 'mesas' | 'skyline' | 'peaks'; near: number; far: number; cap: number };
  scatter: ScatterRule[];
  trackside: TracksideRule[];
  landmarkFallback: string;
};

const BASE_THEMES: Record<Exclude<ThemeId, 'space'>, ThemeStyle> = {
  beach: {
    night: false,
    sky: { top: 0x0f62d8, horizon: 0x9fd6ff, bottom: 0x8cc8e8, sunColor: 0xfff4d6, sunSize: 0.9985, glow: 0.55, clouds: 0.6, cloudColor: 0xffffff, stars: 0 },
    sun: { elevation: 52, azimuth: 35, color: 0xfff1d8, intensity: 3.1 },
    hemi: { sky: 0xbfe4ff, ground: 0xe6cf9a, intensity: 1.0 },
    env: 0.55, exposure: 1.02,
    fog: { color: 0xa8dbff, near: 170, far: 950 },
    road: { base: '#737479', speck: '#9c9ca4', roughness: 0.86, metalness: 0, line: 0xffffff, lineGlow: 0, centre: 'none' },
    curb: ['#ee3b36', '#ffffff'], curbGlow: 0,
    apron: 'sand',
    wall: { a: '#ffffff', b: '#1f7cf2', height: 1.05, neon: null },
    ramp: ['#1f7cf2', '#ffffff'],
    terrain: { low: 0xf3dca0, mid: 0x74cc48, high: 0x3f9f45, rock: 0xa89a84, shore: 0xf7e8bf, top: 0x6cc35a, amp: 26, scale: 1 / 210, ridged: false, sea: 1, follow: 0.6 },
    water: { level: -1.4, color: 0x1fc4d8, deep: 0x0a6fae },
    cliff: 0xc9a77a,
    silhouettes: { kind: 'islands', near: 0x5fb88a, far: 0x8fcfd8, cap: 0x78c47a },
    scatter: [
      { kind: 'palm_a', weight: 6, scale: [0.9, 1.35], radius: 2, min: 6, max: 90 },
      { kind: 'palm_b', weight: 5, scale: [0.9, 1.3], radius: 2, min: 6, max: 120 },
      { kind: 'rock_beach', weight: 3, scale: [0.7, 2.2], radius: 3, min: 8 },
      { kind: 'umbrella', weight: 2.5, scale: [0.9, 1.1], radius: 2, min: 7, max: 45, shore: true },
      { kind: 'beach_hut', weight: 1, scale: [1, 1.2], radius: 5, min: 12, max: 70 },
      { kind: 'lifeguard_tower', weight: 0.5, scale: [1, 1], radius: 4, min: 10, max: 60, shore: true },
      { kind: 'boat', weight: 2, scale: [0.9, 1.4], radius: 6, min: 20, water: true },
    ],
    trackside: [
      { kind: 'palm_a', spacing: 26, offset: 4, scale: 1.1, sides: 'alternate', face: 'road' },
      { kind: 'flag_pole', spacing: 34, offset: 2.2, scale: 1, sides: 'outside', straightOnly: true, face: 'along' },
    ],
    landmarkFallback: 'beach_hut',
  },
  desert: {
    night: false,
    sky: { top: 0x1f66d0, horizon: 0xffd2a0, bottom: 0xf2c38e, sunColor: 0xffe2b0, sunSize: 0.9982, glow: 0.8, clouds: 0.25, cloudColor: 0xfff1e0, stars: 0 },
    sun: { elevation: 27, azimuth: -60, color: 0xffd9a8, intensity: 3.3 },
    hemi: { sky: 0xffe0b8, ground: 0xc4643a, intensity: 0.95 },
    env: 0.5, exposure: 1.0,
    fog: { color: 0xf6d2a6, near: 180, far: 950 },
    road: { base: '#746862', speck: '#978a82', roughness: 0.9, metalness: 0, line: 0xfff4e0, lineGlow: 0, centre: 'none' },
    curb: ['#ff7418', '#ffffff'], curbGlow: 0,
    apron: 'dirt',
    wall: { a: '#fff1d8', b: '#d8452a', height: 1.05, neon: null },
    ramp: ['#ffb31a', '#3b2a22'],
    terrain: { low: 0xe0925a, mid: 0xd47c45, high: 0xc0643a, rock: 0xa04a2e, shore: 0xe8a66a, top: 0xd68a52, amp: 34, scale: 1 / 170, ridged: true, sea: 0, follow: 0.85 },
    water: null,
    cliff: 0xb45a36,
    silhouettes: { kind: 'mesas', near: 0xc0643f, far: 0xe7a57c, cap: 0xd27a4a },
    scatter: [
      { kind: 'cactus_a', weight: 6, scale: [0.8, 1.4], radius: 1.5, min: 5 },
      { kind: 'cactus_b', weight: 4, scale: [0.8, 1.3], radius: 1.5, min: 5 },
      { kind: 'rock_red_a', weight: 4, scale: [0.8, 2.6], radius: 3, min: 7 },
      { kind: 'rock_red_b', weight: 3, scale: [0.8, 2.4], radius: 3, min: 7 },
      { kind: 'mesa', weight: 0.7, scale: [1.2, 2.6], radius: 26, min: 80 },
      { kind: 'water_tower', weight: 0.25, scale: [1, 1.2], radius: 5, min: 18, max: 80 },
      { kind: 'windmill', weight: 0.35, scale: [1, 1.2], radius: 4, min: 16, max: 90 },
    ],
    trackside: [
      { kind: 'cactus_a', spacing: 32, offset: 5, scale: 1, sides: 'alternate', face: 'road' },
      { kind: 'flag_pole', spacing: 40, offset: 2.2, scale: 1, sides: 'outside', straightOnly: true, face: 'along' },
    ],
    landmarkFallback: 'mesa',
  },
  city: {
    night: true,
    sky: { top: 0x050a22, horizon: 0x3a1f66, bottom: 0x1b1238, sunColor: 0xdfe6ff, sunSize: 0.99965, glow: 0.18, clouds: 0.35, cloudColor: 0x4a3a7a, stars: 1 },
    sun: { elevation: 38, azimuth: 140, color: 0xa9b8ff, intensity: 1.15 },
    hemi: { sky: 0x6a5ad0, ground: 0x2a1a44, intensity: 1.3 },
    env: 0.9, exposure: 1.15,
    fog: { color: 0x241848, near: 90, far: 620 },
    road: { base: '#2c2e3a', speck: '#474a5c', roughness: 0.5, metalness: 0.08, line: 0xf4f7ff, lineGlow: 0.35, centre: 'yellow' },
    curb: ['#ff2bd6', '#1ee8ff'], curbGlow: 0.7,
    apron: 'sidewalk',
    wall: { a: '#6b7086', b: '#545870', height: 1.1, neon: [0x19e6ff, 0xff2bd6] },
    ramp: ['#ffd21a', '#1a1a24'],
    terrain: { low: 0x3a3c4c, mid: 0x34364a, high: 0x2e3042, rock: 0x5d6178, shore: 0x3a3c4c, top: 0x34364a, amp: 0, scale: 1 / 200, ridged: false, sea: 0, follow: 0 },
    water: null,
    cliff: 0x4a4e62,
    silhouettes: { kind: 'skyline', near: 0x1a1640, far: 0x2a2058, cap: 0xffd27a },
    scatter: [
      { kind: 'building_a', weight: 5, scale: [0.9, 1.6], radius: 10, min: 18 },
      { kind: 'building_b', weight: 5, scale: [0.9, 1.7], radius: 10, min: 18 },
      { kind: 'building_c', weight: 4, scale: [0.9, 1.8], radius: 10, min: 20 },
      { kind: 'billboard', weight: 0.8, scale: [1, 1.2], radius: 5, min: 8, max: 40 },
      { kind: 'neon_sign', weight: 1, scale: [1, 1.2], radius: 3, min: 6, max: 30 },
      { kind: 'parked_car', weight: 1.4, scale: [1, 1], radius: 3, min: 5, max: 14 },
    ],
    trackside: [
      { kind: 'street_light', spacing: 26, offset: 1.6, scale: 1, sides: 'alternate', face: 'road' },
    ],
    landmarkFallback: 'building_c',
  },
  snow: {
    night: false,
    sky: { top: 0x1f6fe0, horizon: 0xd8ecff, bottom: 0xd6e8f8, sunColor: 0xfffaf0, sunSize: 0.9986, glow: 0.45, clouds: 0.45, cloudColor: 0xffffff, stars: 0 },
    sun: { elevation: 33, azimuth: 70, color: 0xfff4e8, intensity: 2.7 },
    hemi: { sky: 0xd4e8ff, ground: 0x9fb4cc, intensity: 1.05 },
    env: 0.6, exposure: 0.98,
    fog: { color: 0xe2eefb, near: 150, far: 850 },
    road: { base: '#5f6677', speck: '#8f98aa', roughness: 0.7, metalness: 0.05, line: 0xffffff, lineGlow: 0, centre: 'none' },
    curb: ['#2c6bff', '#ffffff'], curbGlow: 0,
    apron: 'snow',
    wall: { a: '#ffffff', b: '#5fb0ff', height: 1.15, neon: null },
    ramp: ['#46c3ff', '#ffffff'],
    terrain: { low: 0xf1f6fd, mid: 0xe9f1fb, high: 0xffffff, rock: 0x8e9ab0, shore: 0xf1f6fd, top: 0xffffff, amp: 70, scale: 1 / 190, ridged: true, sea: 0, follow: 0.9 },
    water: null,
    cliff: 0x7d8698,
    silhouettes: { kind: 'peaks', near: 0x7f95b8, far: 0xb0c4e0, cap: 0xffffff },
    scatter: [
      { kind: 'pine_a', weight: 8, scale: [0.8, 1.5], radius: 2.5, min: 6 },
      { kind: 'pine_b', weight: 6, scale: [0.8, 1.5], radius: 2.5, min: 6 },
      { kind: 'snow_rock', weight: 3, scale: [0.8, 2.4], radius: 3, min: 7 },
      { kind: 'cabin', weight: 0.6, scale: [1, 1.2], radius: 6, min: 16, max: 80 },
      { kind: 'snowman', weight: 0.6, scale: [0.9, 1.1], radius: 1.5, min: 6, max: 30 },
      { kind: 'ice_crystal', weight: 0.9, scale: [0.8, 1.8], radius: 2, min: 8, max: 60 },
    ],
    trackside: [
      { kind: 'pine_a', spacing: 22, offset: 4.5, scale: 1, sides: 'alternate', face: 'road' },
      { kind: 'flag_pole', spacing: 40, offset: 2.2, scale: 1, sides: 'outside', straightOnly: true, face: 'along' },
    ],
    landmarkFallback: 'cabin',
  },
};

/** Rainbow Road. Terrain/silhouette/apron fields are unused (no ground); the heightfield built from them
 * only gives the camera a floor under the ribbon. Scatter rules feed the generic placer in tests only. */
const SPACE: ThemeStyle = {
  night: true, space: true,
  sky: { top: 0x05020f, horizon: 0x1a0838, bottom: 0x0a0420, sunColor: 0xfff1e4, sunSize: 0.99975, glow: 0.35, clouds: 0, cloudColor: 0x000000, stars: 1 },
  sun: { elevation: 34, azimuth: 150, color: 0xfff0f6, intensity: 2.6 },
  hemi: { sky: 0x8f82ff, ground: 0xff7ab8, intensity: 1.15 },
  env: 1.0, exposure: 1.08,
  fog: { color: 0x12072a, near: 320, far: 2100 },
  road: { base: '#1a1030', speck: '#ffffff', roughness: 0.3, metalness: 0, line: 0xffffff, lineGlow: 2.2, centre: 'none' },
  curb: ['#ffffff', '#ff4fd8'], curbGlow: 1.1,
  apron: 'sidewalk',
  wall: { a: '#2a1a55', b: '#1a1040', height: 1.1, neon: [0x19e6ff, 0xff2bd6] },
  ramp: ['#ff5fe0', '#1a0f3a'],
  terrain: { low: 0, mid: 0, high: 0, rock: 0, shore: 0, top: 0, amp: 0, scale: 1 / 200, ridged: false, sea: 0, follow: 0 },
  water: null,
  cliff: 0x2a1a55,
  silhouettes: { kind: 'skyline', near: 0, far: 0, cap: 0 },
  scatter: [
    { kind: 'asteroid_a', weight: 5, scale: [0.8, 3], radius: 3, min: 14 },
    { kind: 'asteroid_b', weight: 5, scale: [0.8, 3], radius: 3, min: 14 },
    { kind: 'star_crystal', weight: 1.5, scale: [0.8, 1.6], radius: 2, min: 8, max: 80 },
    { kind: 'satellite', weight: 0.5, scale: [1, 1.4], radius: 4, min: 30 },
  ],
  trackside: [],
  landmarkFallback: 'asteroid_a',
};
export const THEMES: Record<ThemeId, ThemeStyle> = { ...BASE_THEMES, space: SPACE };
