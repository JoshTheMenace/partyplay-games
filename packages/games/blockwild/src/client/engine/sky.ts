/**
 * Sky dome (gradient, square sun and moon, twinkling stars) and a drifting layer of blocky 3D clouds at y = 140.
 * Both read the shared world uniforms, so they always match the fog and water reflections. In the Nether the dome
 * shows only the fog colour and the clouds hide.
 */
import { BackSide, BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, SphereGeometry, type Object3D } from 'three';
import { SKY_GLSL } from './environment';
import type { WorldUniforms } from './material';

const CLOUD_Y = 140, CLOUD_CELL = 12, CLOUD_THICK = 4, CLOUD_GRID = 32, CLOUD_PERIOD = CLOUD_CELL * CLOUD_GRID, CLOUD_SPEED = 0.6;

const DOME_VERTEX = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = position;
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = clip.xyww;
  gl_Position.z *= 0.99999;
}`;

const DOME_FRAGMENT = /* glsl */ `
uniform float uStars;
uniform float uAngle;
in vec3 vDir;
${SKY_GLSL}

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

/** Square MC-style body: returns 1 inside a square of half-size r around direction c. */
vec2 square(vec3 d, vec3 c, float r) {
  float along = dot(d, c);
  if (along <= 0.0) return vec2(0.0, 99.0);
  vec3 u = normalize(cross(c, vec3(0.0, 0.0, 1.0)));
  vec3 v = cross(u, c);
  vec2 p = vec2(dot(d, u), dot(d, v)) / along;
  return vec2(step(max(abs(p.x), abs(p.y)), r), length(p));
}

void main() {
  vec3 d = normalize(vDir);
  vec3 color = skyColor(d);
  float horizon = smoothstep(-0.04, 0.04, d.y);
  // Stars ride the celestial sphere: rotate by the time of day around the sun's axis.
  if (uStars > 0.01 && d.y > -0.1) {
    float c = cos(uAngle), s = sin(uAngle);
    vec3 r = vec3(c * d.x + s * d.y, -s * d.x + c * d.y, d.z);
    vec3 a = abs(r);
    vec2 uv = a.x > a.y && a.x > a.z ? r.yz / a.x : a.y > a.z ? r.xz / a.y : r.xy / a.z;
    vec3 face = sign(r) * step(max(a.x, max(a.y, a.z)) - 0.0001, a);
    vec2 cell = floor(uv * 90.0);
    float h = hash(vec3(cell, dot(face, vec3(1.0, 2.0, 3.0))));
    if (h > 0.985) {
      vec2 centre = cell + 0.5 + (vec2(hash(vec3(cell, 7.0)), hash(vec3(cell, 9.0))) - 0.5) * 0.5;
      float dist = length(uv * 90.0 - centre);
      float twinkle = 0.7 + 0.3 * sin(uTime * (1.5 + h * 40.0) + h * 100.0);
      color += vec3(0.85, 0.9, 1.0) * smoothstep(0.35, 0.05, dist) * (h - 0.985) * 66.0 * twinkle * uStars * horizon;
    }
  }
  vec2 sun = square(d, uSunDir, 0.085);
  color += vec3(1.0, 0.93, 0.75) * exp(-sun.y * 9.0) * 0.35 * horizon * (uDay + uDusk);
  color = mix(color, vec3(1.6, 1.45, 1.1), sun.x * horizon);
  vec2 moon = square(d, -uSunDir, 0.055);
  if (moon.x > 0.0) {
    vec3 u = normalize(cross(-uSunDir, vec3(0.0, 0.0, 1.0)));
    vec2 p = floor(vec2(dot(d, u), dot(d, cross(u, -uSunDir))) / dot(d, -uSunDir) / 0.055 * 4.0);
    float crater = hash(vec3(p, 3.0)) > 0.7 ? 0.78 : 1.0;
    color = mix(color, vec3(0.82, 0.86, 0.95) * crater, horizon * (0.35 + 0.65 * uStars));
  }
  color += vec3(0.7, 0.8, 1.0) * exp(-moon.y * 7.0) * 0.08 * uStars * horizon;
  // No sun, moon or stars in the Nether: only its fog colour.
  color = mix(color, skyColor(d), uNether);
  gl_FragColor = vec4(color, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

const CLOUD_VERTEX = /* glsl */ `
in float shade;
out float vShade;
out vec3 vWorld;
void main() {
  vShade = shade;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const CLOUD_FRAGMENT = /* glsl */ `
uniform vec3 uSkyLight;
uniform float uFogFar;
in float vShade;
in vec3 vWorld;
${SKY_GLSL}
void main() {
  vec3 toFrag = vWorld - cameraPosition;
  float distance = length(toFrag.xz);
  vec3 lit = mix(vec3(0.022, 0.027, 0.048), vec3(1.0), uDay) + uDuskColor * uDusk * 0.5;
  vec3 color = lit * vShade;
  float fade = 1.0 - smoothstep(uFogFar * 1.2, uFogFar * 2.6 + 80.0, distance);
  color = mix(fogColor(normalize(toFrag)), color, 0.35 + 0.65 * fade);
  gl_FragColor = vec4(color, 0.8 * fade);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

/** Deterministic cloud cover on a wrapping CLOUD_GRID² grid: blobs from two octaves of hashed value noise. */
export function cloudMask(): Uint8Array {
  const hash = (x: number, z: number, seed: number) => {
    const h = Math.imul((x & (CLOUD_GRID - 1)) * 73856093 ^ (z & (CLOUD_GRID - 1)) * 19349663 ^ seed * 83492791, 0x27d4eb2d);
    return ((h ^ h >>> 15) >>> 0) / 4294967296;
  };
  const noise = (x: number, z: number, scale: number, seed: number) => {
    const fx = x / scale, fz = z / scale, x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
    const period = CLOUD_GRID / scale, at = (a: number, b: number) => hash(((a % period) + period) % period * scale, ((b % period) + period) % period * scale, seed);
    const top = at(x0, z0) + (at(x0 + 1, z0) - at(x0, z0)) * tx, bottom = at(x0, z0 + 1) + (at(x0 + 1, z0 + 1) - at(x0, z0 + 1)) * tx;
    return top + (bottom - top) * tz;
  };
  const mask = new Uint8Array(CLOUD_GRID * CLOUD_GRID);
  for (let z = 0; z < CLOUD_GRID; z++) for (let x = 0; x < CLOUD_GRID; x++) {
    mask[x + z * CLOUD_GRID] = noise(x, z, 8, 1) * 0.7 + noise(x, z, 2, 2) * 0.3 > 0.56 ? 1 : 0;
  }
  return mask;
}

/** Cloud boxes over 3×3 wrapped tiles with shared inner faces removed. Per-vertex `shade` = face brightness. */
function cloudGeometry() {
  const mask = cloudMask(), positions: number[] = [], shades: number[] = [], index: number[] = [];
  const filled = (x: number, z: number) => mask[((x % CLOUD_GRID) + CLOUD_GRID) % CLOUD_GRID + ((z % CLOUD_GRID) + CLOUD_GRID) % CLOUD_GRID * CLOUD_GRID] === 1;
  const quad = (corners: number[][], shade: number) => {
    const base = positions.length / 3;
    for (const corner of corners) {
      positions.push(...corner);
      shades.push(shade);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const size = CLOUD_GRID * 3;
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    if (!filled(x, z)) continue;
    const x0 = x * CLOUD_CELL, x1 = x0 + CLOUD_CELL, z0 = z * CLOUD_CELL, z1 = z0 + CLOUD_CELL, y0 = 0, y1 = CLOUD_THICK;
    quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], 1);
    quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], 0.7);
    if (!filled(x - 1, z)) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], 0.8);
    if (!filled(x + 1, z)) quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], 0.8);
    if (!filled(x, z - 1)) quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], 0.9);
    if (!filled(x, z + 1)) quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0.9);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('shade', new BufferAttribute(new Float32Array(shades), 1));
  geometry.setIndex(index);
  return geometry;
}

export class SkyRenderer {
  private readonly dome: Mesh;
  /** Depth-only pass then colour pass, so overlapping cloud boxes blend once. */
  private readonly clouds: [Mesh, Mesh];
  private drift = 0;

  constructor(private readonly scene: Object3D, uniforms: WorldUniforms) {
    const shader = (vertexShader: string, fragmentShader: string, extra: ConstructorParameters<typeof ShaderMaterial>[0] = {}) =>
      new ShaderMaterial({ vertexShader, fragmentShader, uniforms, ...extra });
    this.dome = new Mesh(new SphereGeometry(1, 32, 16), shader(DOME_VERTEX, DOME_FRAGMENT, { side: BackSide, depthWrite: false, depthTest: false }));
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    const geometry = cloudGeometry();
    this.clouds = [
      new Mesh(geometry, shader(CLOUD_VERTEX, CLOUD_FRAGMENT, { transparent: true, colorWrite: false })),
      new Mesh(geometry, shader(CLOUD_VERTEX, CLOUD_FRAGMENT, { transparent: true, depthWrite: false })),
    ];
    this.clouds.forEach((mesh, i) => {
      mesh.frustumCulled = false;
      mesh.renderOrder = 10 + i;
    });
    scene.add(this.dome, ...this.clouds);
  }

  /** Keeps the dome around the camera and the cloud tiles centred on it while they drift west to east (none in the Nether). */
  update(cameraX: number, cameraZ: number, dt: number, nether = false) {
    for (const mesh of this.clouds) mesh.visible = !nether;
    this.drift = (this.drift + dt * CLOUD_SPEED) % CLOUD_PERIOD;
    const x = Math.floor((cameraX - this.drift) / CLOUD_PERIOD) * CLOUD_PERIOD + this.drift - CLOUD_PERIOD;
    const z = Math.floor(cameraZ / CLOUD_PERIOD) * CLOUD_PERIOD - CLOUD_PERIOD;
    for (const mesh of this.clouds) mesh.position.set(x, CLOUD_Y, z);
  }

  dispose() {
    this.scene.remove(this.dome, ...this.clouds);
    this.dome.geometry.dispose();
    (this.dome.material as ShaderMaterial).dispose();
    this.clouds[0].geometry.dispose();
    for (const mesh of this.clouds) (mesh.material as ShaderMaterial).dispose();
  }
}
