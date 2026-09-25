/**
 * Pooled camera-facing particles in one instanced draw call: block chips (textured from the sprite sheet),
 * footstep dust, smoke and explosion puffs, torch flames, crit sparks, splashes, redstone dust, portal motes,
 * lava pops and villager sparkles. State lives in one
 * Float32Array (no per-frame allocation); fading uses screen-door dithering so no sorting is needed.
 * Smoke is a "soft" particle: a round 8×8-texel pixel puff whose rim and fade-out dissolve, instead of a textured square.
 */
import { BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, type Texture } from 'three';
import { isSolid } from '../../shared/blocks';
import type { CellReader } from '../../shared/chunk';
import type { Rect } from './sprites';

const MAX = 900;
// Per-particle fields.
const X = 0, Y = 1, Z = 2, VX = 3, VY = 4, VZ = 5, LIFE = 6, MAXLIFE = 7, SIZE = 8, GRAVITY = 9, R = 10, G = 11, B = 12, U0 = 13, V0 = 14, U1 = 15, V1 = 16, GROW = 17, DRAG = 18, COLLIDE = 19, SOFT = 20;
const STRIDE = 21;

const vertex = /* glsl */`
attribute vec4 aPos; attribute vec4 aUv; attribute vec4 aCol;
varying vec2 vUv; varying vec2 vQuad; varying vec4 vCol; varying float vSoft;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  // A negative size marks a soft puff.
  vec3 p = aPos.xyz + (right * position.x + up * position.y) * abs(aPos.w);
  vSoft = aPos.w < 0.0 ? 1.0 : 0.0;
  vQuad = uv;
  vUv = mix(aUv.xy, aUv.zw, uv);
  vCol = aCol;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const fragment = /* glsl */`
uniform sampler2D map;
varying vec2 vUv; varying vec2 vQuad; varying vec4 vCol; varying float vSoft;
void main() {
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec4 t = vec4(1.0);
  float alpha = vCol.a;
  if (vSoft > 0.5) {
    // Distance of this texel from the puff centre on an 8×8 grid: solid core, half-dissolved rim.
    float r = length((floor(vQuad * 8.0) + 0.5) / 4.0 - 1.0);
    if (r > 1.0) discard;
    alpha *= r > 0.72 ? 0.45 : 1.0;
    t.rgb = vec3(1.0 - 0.3 * r);
  } else {
    t = texture2D(map, vUv);
  }
  if (t.a < 0.5 || alpha < dither) discard;
  gl_FragColor = vec4(t.rgb * vCol.rgb, 1.0);
  #include <colorspace_fragment>
}`;

export type Tint = readonly [number, number, number];
export const TINTS = {
  smoke: [0.62, 0.62, 0.62], dark: [0.07, 0.07, 0.075], poof: [0.9, 0.9, 0.9], flame: [1, 0.62, 0.18], spark: [1, 0.95, 0.55], splash: [0.35, 0.55, 1], white: [1, 1, 1], heart: [1, 0.3, 0.35],
  redstone: [1, 0.12, 0.08], portal: [0.62, 0.3, 1], lava: [1, 0.45, 0.08], happy: [0.35, 1, 0.45],
} as const satisfies Record<string, Tint>;

export class Particles {
  readonly mesh: Mesh;
  private readonly state = new Float32Array(MAX * STRIDE);
  private readonly pos = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  private readonly uvs = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  private readonly cols = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  private readonly dynamic = [this.pos, this.uvs, this.cols];
  private readonly geometry = new InstancedBufferGeometry();
  private readonly chipRect = [0, 0, 0, 0];
  count = 0;

  constructor(texture: Texture, private readonly white: Rect, private readonly chip: (rect: Rect, rand: () => number, out: number[]) => void) {
    const quad = new BufferGeometry();
    quad.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    quad.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    for (const [name, attribute] of [['aPos', this.pos], ['aUv', this.uvs], ['aCol', this.cols]] as const) {
      attribute.setUsage(DynamicDrawUsage);
      this.geometry.setAttribute(name, attribute);
    }
    this.geometry.instanceCount = 0;
    const material = new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: { map: { value: texture } } });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** Spawn one particle; returns its slot (or -1 when full: the oldest are never evicted mid-effect). */
  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, gravity: number, tint: Tint, light: number, rect: Rect | readonly number[], grow = 0, drag = 0, collide = true, soft = false) {
    if (this.count >= MAX) return -1;
    const s = this.state, o = this.count++ * STRIDE;
    s[o + X] = x; s[o + Y] = y; s[o + Z] = z; s[o + VX] = vx; s[o + VY] = vy; s[o + VZ] = vz;
    s[o + LIFE] = life; s[o + MAXLIFE] = life; s[o + SIZE] = size; s[o + GRAVITY] = gravity;
    s[o + R] = tint[0] * light; s[o + G] = tint[1] * light; s[o + B] = tint[2] * light;
    s[o + U0] = rect[0]!; s[o + V0] = rect[1]!; s[o + U1] = rect[2]!; s[o + V1] = rect[3]!;
    s[o + GROW] = grow; s[o + DRAG] = drag; s[o + COLLIDE] = collide ? 1 : 0; s[o + SOFT] = soft ? 1 : 0;
    return o;
  }
  private chipFrom(rect: Rect) { this.chip(rect, Math.random, this.chipRect); return this.chipRect; }

  /** A block breaking: chips of its texture spread through the cell. */
  breakBlock(x: number, y: number, z: number, rect: Rect | null, light: number) {
    for (let i = 0; i < 36; i++) {
      const px = x + 0.15 + Math.random() * 0.7, py = y + 0.15 + Math.random() * 0.7, pz = z + 0.15 + Math.random() * 0.7;
      this.spawn(px, py, pz, (px - x - 0.5) * 3, (py - y - 0.2) * 3 + 1.5, (pz - z - 0.5) * 3, 0.5 + Math.random() * 0.7, 0.08 + Math.random() * 0.06, 16, TINTS.white, light,
        rect ? this.chipFrom(rect) : this.white);
    }
  }
  /** Small chips flying off the face being mined (one burst per swing). */
  mining(point: readonly number[], face: number, rect: Rect | null, light: number) {
    const nx = face === 0 ? -1 : face === 1 ? 1 : 0, ny = face === 2 ? -1 : face === 3 ? 1 : 0, nz = face === 4 ? -1 : face === 5 ? 1 : 0;
    for (let i = 0; i < 3; i++) {
      this.spawn(point[0]! + nx * 0.03 + (Math.random() - 0.5) * 0.3 * (1 - Math.abs(nx)), point[1]! + ny * 0.03 + (Math.random() - 0.5) * 0.3 * (1 - Math.abs(ny)),
        point[2]! + nz * 0.03 + (Math.random() - 0.5) * 0.3 * (1 - Math.abs(nz)), nx * 1.6 + (Math.random() - 0.5) * 1.2, ny * 1.6 + 0.8 + Math.random() * 1.4, nz * 1.6 + (Math.random() - 0.5) * 1.2,
        0.25 + Math.random() * 0.3, 0.04 + Math.random() * 0.035, 16, TINTS.white, light, rect ? this.chipFrom(rect) : this.white);
    }
  }
  /** Footstep / landing dust from the block underfoot. */
  dust(x: number, y: number, z: number, rect: Rect | null, light: number, amount = 2) {
    for (let i = 0; i < amount; i++) {
      this.spawn(x + (Math.random() - 0.5) * 0.5, y + 0.05, z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 1.2, 0.8 + Math.random(), (Math.random() - 0.5) * 1.2,
        0.35 + Math.random() * 0.3, 0.06 + Math.random() * 0.04, 12, TINTS.white, light, rect ? this.chipFrom(rect) : this.white);
    }
  }
  /** Item crumbs while eating (from the food sprite), in front of the eye. */
  crumbs(x: number, y: number, z: number, dx: number, dz: number, rect: Rect | null, light: number) {
    for (let i = 0; i < 3; i++) {
      this.spawn(x + dx * 0.4, y - 0.15, z + dz * 0.4, dx * 1.2 + (Math.random() - 0.5), 1 + Math.random(), dz * 1.2 + (Math.random() - 0.5), 0.5, 0.06, 14, TINTS.white, light,
        rect ? this.chipFrom(rect) : this.white);
    }
  }
  /** Torch/furnace smoke: a tiny dark puff drifting up (`big`: an explosion cloud; `poof`: a mob vanishing). */
  smoke(x: number, y: number, z: number, light: number, kind: 'wisp' | 'poof' | 'big' = 'wisp') {
    const big = kind === 'big', spread = big ? 3 : kind === 'poof' ? 0.6 : 0.08, size = big ? 0.7 + Math.random() * 0.6 : kind === 'poof' ? 0.22 + Math.random() * 0.12 : 0.08 + Math.random() * 0.04;
    this.spawn(x, y, z, (Math.random() - 0.5) * spread, big ? Math.random() * 2 : 0.35 + Math.random() * 0.2, (Math.random() - 0.5) * spread,
      big ? 0.7 + Math.random() * 0.7 : 0.6 + Math.random() * 0.5, size, big ? -0.3 : -0.15, big ? TINTS.smoke : kind === 'poof' ? TINTS.poof : TINTS.dark, Math.max(0.35, light),
      this.white, big ? 0.5 : 0.03, 2.5, false, true);
  }
  /** A small round flame licking up from a torch tip. */
  flame(x: number, y: number, z: number) {
    this.spawn(x + (Math.random() - 0.5) * 0.04, y, z + (Math.random() - 0.5) * 0.04, 0, 0.06 + Math.random() * 0.08, 0, 0.3 + Math.random() * 0.2, 0.06, 0, TINTS.flame, 1.4, this.white, -0.1, 0, false, true);
  }
  sparks(x: number, y: number, z: number, amount = 10) {
    for (let i = 0; i < amount; i++) {
      this.spawn(x, y, z, (Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5, 0.3 + Math.random() * 0.4, 0.06, 10, TINTS.spark, 1.5, this.white, -0.05, 1.5);
    }
  }
  splash(x: number, y: number, z: number, amount = 14) {
    for (let i = 0; i < amount; i++) {
      this.spawn(x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 2, 2.5 + Math.random() * 2.5, (Math.random() - 0.5) * 2, 0.6, 0.06, 18, TINTS.splash, 1, this.white);
    }
  }
  explosion(x: number, y: number, z: number) {
    for (let i = 0; i < 26; i++) this.smoke(x + (Math.random() - 0.5) * 3, y + Math.random() * 2, z + (Math.random() - 0.5) * 3, 1, 'big');
    this.sparks(x, y + 0.5, z, 20);
  }
  /** A speck of redstone dust drifting up from powered dust or a lit redstone torch (brighter with power 0..1). */
  redstone(x: number, y: number, z: number, power = 1) {
    this.spawn(x, y, z, (Math.random() - 0.5) * 0.1, 0.2 + Math.random() * 0.2, (Math.random() - 0.5) * 0.1, 0.5 + Math.random() * 0.5, 0.045, -0.1, TINTS.redstone, 0.5 + power, this.white, 0, 1, false);
  }
  /** A purple mote that drifts from (x, y, z) into the portal plane at (tx, ty, tz) over about a second. */
  portal(x: number, y: number, z: number, tx: number, ty: number, tz: number) {
    const life = 0.8 + Math.random() * 0.6;
    this.spawn(x, y, z, (tx - x) / life, (ty - y) / life, (tz - z) / life, life, 0.05 + Math.random() * 0.04, 0, TINTS.portal, 1.4, this.white, -0.02, 0, false);
  }
  /** Lava spitting a glowing drop that arcs up and falls back. */
  pop(x: number, y: number, z: number) {
    this.spawn(x, y, z, (Math.random() - 0.5) * 1.5, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 0.5, 0.07, 12, TINTS.lava, 1.6, this.white, 0, 0.2);
  }
  /** Green sparkles around a villager after a trade. */
  happy(x: number, y: number, z: number) {
    for (let i = 0; i < 7; i++) this.spawn(x + (Math.random() - 0.5) * 0.9, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.9, 0, 0.3, 0, 0.8 + Math.random() * 0.4, 0.08, 0, TINTS.happy, 1.3, this.white, 0, 0, false);
  }
  hearts(x: number, y: number, z: number) {
    for (let i = 0; i < 4; i++) this.spawn(x + (Math.random() - 0.5), y + Math.random() * 0.5, z + (Math.random() - 0.5), 0, 0.6, 0, 1, 0.14, 0, TINTS.heart, 1.2, this.white, 0, 0, false);
  }

  /** Integrate, collide with the world, write instance attributes. */
  update(dt: number, getCell: CellReader) {
    const s = this.state, pos = this.pos.array as Float32Array, uvs = this.uvs.array as Float32Array, cols = this.cols.array as Float32Array;
    let i = 0;
    while (i < this.count) {
      const o = i * STRIDE;
      s[o + LIFE]! -= dt;
      if (s[o + LIFE]! <= 0) {
        // Swap the last particle into this slot.
        const last = --this.count * STRIDE;
        if (last !== o) s.copyWithin(o, last, last + STRIDE);
        continue;
      }
      const drag = Math.exp(-s[o + DRAG]! * dt);
      s[o + VX]! *= drag;
      s[o + VZ]! *= drag;
      s[o + VY] = s[o + VY]! * drag - s[o + GRAVITY]! * dt;
      const nx = s[o + X]! + s[o + VX]! * dt, ny = s[o + Y]! + s[o + VY]! * dt, nz = s[o + Z]! + s[o + VZ]! * dt;
      if (s[o + COLLIDE] && isSolid(getCell(Math.floor(nx), Math.floor(ny), Math.floor(nz)))) {
        // Land: stop falling and slide to a halt.
        s[o + VY] = 0;
        s[o + VX]! *= 0.5;
        s[o + VZ]! *= 0.5;
      } else {
        s[o + X] = nx;
        s[o + Y] = ny;
        s[o + Z] = nz;
      }
      s[o + SIZE] = Math.max(0.01, s[o + SIZE]! + s[o + GROW]! * dt);
      const q = i * 4, fade = Math.min(1, s[o + LIFE]! / (s[o + MAXLIFE]! * 0.35));
      pos[q] = s[o + X]!; pos[q + 1] = s[o + Y]!; pos[q + 2] = s[o + Z]!; pos[q + 3] = s[o + SOFT] ? -s[o + SIZE]! : s[o + SIZE]!;
      uvs[q] = s[o + U0]!; uvs[q + 1] = s[o + V0]!; uvs[q + 2] = s[o + U1]!; uvs[q + 3] = s[o + V1]!;
      cols[q] = s[o + R]!; cols[q + 1] = s[o + G]!; cols[q + 2] = s[o + B]!; cols[q + 3] = fade;
      i++;
    }
    this.geometry.instanceCount = this.count;
    if (this.count) {
      for (const attribute of this.dynamic) {
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, this.count * 4);
        attribute.needsUpdate = true;
      }
    }
  }
  dispose() {
    this.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
