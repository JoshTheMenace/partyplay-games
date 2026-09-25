/**
 * Time of day → sun position, sky colours and light colours, plus the GLSL they feed. Shared by the world shader
 * (fog, water reflections), the sky dome and the clouds so terrain melts into the horizon at every hour.
 * Colours are linear RGB.
 */
import { DAY_TICKS } from '../../shared/constants';

export type Rgb = [number, number, number];
export type SkyState = {
  /** Unit vector towards the sun (the moon is opposite). Tick 0 rises in the east (+X), 6000 is overhead. */
  sun: Rgb;
  /** 0 at night, 1 in full day. */
  day: number;
  /** Sunrise/sunset glow strength, 0..1. */
  dusk: number;
  /** Star visibility, 0..1. */
  stars: number;
  zenith: Rgb;
  horizon: Rgb;
  /** Colour and brightness of sky light on blocks. */
  skyLight: Rgb;
  /** Rotation of the celestial sphere (radians). */
  angle: number;
};

const linear = (hex: number): Rgb => [hex >> 16, hex >> 8 & 255, hex & 255].map(c => (c / 255) ** 2.2) as Rgb;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const DAY_ZENITH = linear(0x4a86e0), DAY_HORIZON = linear(0xb4d6f6), NIGHT_ZENITH = linear(0x03050c), NIGHT_HORIZON = linear(0x0c1224);
const DUSK_ZENITH = linear(0x3a4a86), DUSK_HORIZON = linear(0xf0a070);
const DAY_LIGHT: Rgb = [1, 0.98, 0.94], DUSK_LIGHT: Rgb = [0.9, 0.62, 0.45], NIGHT_LIGHT: Rgb = [0.032, 0.042, 0.08];

export function skyState(tick: number): SkyState {
  const angle = ((tick % DAY_TICKS + DAY_TICKS) % DAY_TICKS) / DAY_TICKS * Math.PI * 2;
  const tilt = 0.3, length = Math.hypot(1, tilt);
  const sun: Rgb = [Math.cos(angle) / length, Math.sin(angle) / length, tilt / length];
  const height = sun[1], day = smoothstep(-0.12, 0.28, height), dusk = Math.exp(-(((height + 0.02) / 0.22) ** 2));
  let zenith = mix(NIGHT_ZENITH, DAY_ZENITH, day), horizon = mix(NIGHT_HORIZON, DAY_HORIZON, day);
  zenith = mix(zenith, DUSK_ZENITH, dusk * 0.35);
  horizon = mix(horizon, DUSK_HORIZON, dusk * 0.45);
  const warm = 0.35 + 0.65 * day, dusky: Rgb = [DUSK_LIGHT[0] * warm, DUSK_LIGHT[1] * warm, DUSK_LIGHT[2] * warm];
  const skyLight = mix(mix(NIGHT_LIGHT, DAY_LIGHT, day), dusky, dusk * 0.5);
  return { sun, day, dusk, stars: 1 - smoothstep(-0.25, 0.02, height), zenith, horizon, skyLight, angle };
}

/**
 * MC-style light level curve (level 0..1 → linear brightness): l / (4 − 3l), lifted halfway towards the "bright"
 * gamma setting, then squared into linear space. Keep in sync with `lightCurve` in SKY_GLSL.
 */
export function lightCurve(level: number) {
  const f = level / (4 - 3 * level), bright = 1 - (1 - f) ** 4, g = f + (bright - f) * 0.45;
  return g * g;
}

/** Warm torch/lantern light colour. */
export const TORCH_LIGHT: Rgb = [1, 0.7, 0.4];
/** Brightness floor so unlit caves are near-black rather than pure black. */
export const AMBIENT = 0.012;
/** The Nether: dense dark-red fog (near → far) and a warm red light floor under its sky-less ceiling. */
export const NETHER_FOG_NEAR = linear(0x2a0b08), NETHER_FOG_FAR = linear(0x4a1410);
export const NETHER_AMBIENT: Rgb = [0.18, 0.07, 0.045];
/** Fog density per block in the Nether (exponential), on top of the render-distance edge fade. */
export const NETHER_FOG_DENSITY = 0.02;
const glsl = (c: Rgb) => `vec3(${c.map(v => v.toFixed(5)).join(', ')})`;

/** Uniform declarations and helpers shared by every world/sky shader. */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uDuskColor;
uniform float uDusk;
uniform float uDay;
uniform float uTime;
uniform float uNether;

float lightCurve(float l) {
  float f = l / (4.0 - 3.0 * l);
  float bright = 1.0 - pow(1.0 - f, 4.0);
  float g = mix(f, bright, 0.45);
  return g * g;
}

vec3 skyColor(vec3 d) {
  // Below the horizon the sky holds the horizon haze, so fogged terrain edges never show against it.
  float h = max(d.y, -0.05);
  vec3 c = mix(uHorizon, uZenith, sqrt(max(h, 0.0)));
  float s = max(dot(d, uSunDir), 0.0);
  float band = exp(-abs(h - 0.02) * 6.0);
  c = mix(c, uDuskColor, uDusk * band * (0.25 + 0.75 * pow(s, 4.0)));
  c += vec3(1.0, 0.85, 0.6) * (pow(s, 10.0) * 0.18 + pow(s, 120.0) * 0.4) * (uDay * 0.7 + uDusk * 0.6);
  // The Nether has no sky: everything beyond the fog is its far colour.
  return mix(c, ${glsl(NETHER_FOG_FAR)}, uNether);
}

/** Colour distant terrain fades into: the sky just above the horizon in that direction. */
vec3 fogColor(vec3 d) {
  return skyColor(normalize(vec3(d.x, clamp(d.y, -0.05, 0.08), d.z)));
}
`;
