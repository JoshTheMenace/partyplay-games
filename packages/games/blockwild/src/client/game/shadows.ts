/**
 * Soft round shadows under players, mobs and dropped items: one instanced quad each, laid on the ground below the
 * body. They are what makes a figure stand on the world instead of in front of it. A body in the air keeps its
 * shadow on the ground, smaller and fainter the higher it is.
 */
import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, ShaderMaterial } from 'three';

const VERTEX = /* glsl */ `
attribute float strength;
varying vec2 vUv;
varying float vStrength;
void main() {
  vUv = uv;
  vStrength = strength;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vStrength;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  gl_FragColor = vec4(0.0, 0.0, 0.0, (1.0 - smoothstep(0.3, 1.0, d)) * vStrength);
}`;
/** How far a shadow falls, and how dark it is right under a standing body. */
export const SHADOW_REACH = 5, SHADOW_STRENGTH = 0.5;

export class Shadows {
  readonly mesh: InstancedMesh;
  private readonly strength: InstancedBufferAttribute;
  private readonly matrix = new Matrix4();
  private count = 0;

  constructor(private readonly capacity = 256) {
    const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.strength = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.strength.setUsage(DynamicDrawUsage);
    geometry.setAttribute('strength', this.strength);
    // Drawn just above the ground it lies on (polygon offset, so it never fights the terrain for depth).
    const material = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
  }

  begin() { this.count = 0; }
  /** A shadow for a body `width` wide whose feet are `height` blocks above the ground at (x, ground, z). */
  add(x: number, ground: number, z: number, width: number, height: number) {
    if (this.count >= this.capacity || height >= SHADOW_REACH) return;
    const lift = Math.max(0, height) / SHADOW_REACH, size = width * 1.5 * (1 - lift * 0.45);
    this.matrix.makeScale(size, 1, size).setPosition(x, ground + 0.015, z);
    this.mesh.setMatrixAt(this.count, this.matrix);
    this.strength.array[this.count++] = SHADOW_STRENGTH * (1 - lift) ** 1.5;
  }
  end() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.strength.needsUpdate = true;
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
