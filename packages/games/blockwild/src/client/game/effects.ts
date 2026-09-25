/**
 * Fire and portal visuals drawn outside the world meshes, sampling the block atlas's current animation frames:
 * flames wrapped around burning entities, and the first-person screen overlays (MC-style flames rising from the
 * bottom corners while burning, the portal swirl building up while standing in a portal, a purple flash on arrival).
 */
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, ShaderMaterial, type Object3D } from 'three';
import type { SharedUniforms } from '../engine/index';
import { damp } from './interp';

const FLAME_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FLAME_FRAGMENT = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uFireLayer;
varying vec2 vUv;
void main() {
  vec4 t = texture(uAtlas, vec3(vUv.x, 1.0 - vUv.y, uFireLayer));
  if (t.a < 0.5) discard;
  gl_FragColor = vec4(t.rgb * 1.15, 1.0);
#include <colorspace_fragment>
}`;

/** Unlit, alpha-tested fire planes (both sides) for burning entities. */
export const flameMaterial = (shared: SharedUniforms) => new ShaderMaterial({
  vertexShader: FLAME_VERTEX, fragmentShader: FLAME_FRAGMENT, side: DoubleSide,
  uniforms: { uAtlas: shared.uAtlas, uFireLayer: shared.uFireLayer },
});

/**
 * Two rows of fire planes around a unit footprint (x, z in -0.5..0.5, y 0..1), one per side plus two diagonals, so a
 * burning body is wrapped in flames from every angle. Scale it to the entity's box.
 */
export function flameGeometry() {
  const pos: number[] = [], uv: number[] = [], index: number[] = [];
  const sides = [[-0.5, -0.5, 0.5, -0.5], [0.5, -0.5, 0.5, 0.5], [0.5, 0.5, -0.5, 0.5], [-0.5, 0.5, -0.5, -0.5], [-0.35, -0.35, 0.35, 0.35], [-0.35, 0.35, 0.35, -0.35]];
  for (const y of [0, 0.5]) for (const [x0, z0, x1, z1] of sides) {
    const base = pos.length / 3;
    pos.push(x0!, y, z0!, x1!, y, z1!, x1!, y + 0.55, z1!, x0!, y + 0.55, z0!);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

const SCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec2 vScreen;
void main() {
  vUv = uv;
  vScreen = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const FIRE_FRAGMENT = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uFireLayer;
uniform float uStrength;
varying vec2 vUv;
varying vec2 vScreen;
void main() {
  vec4 t = texture(uAtlas, vec3(vUv.x, 1.0 - vUv.y, uFireLayer));
  if (t.a < 0.5) discard;
  gl_FragColor = vec4(t.rgb * 1.1, 0.85 * uStrength);
#include <colorspace_fragment>
}`;
const PORTAL_FRAGMENT = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uPortalLayer;
uniform float uTime;
uniform float uStrength;
uniform float uFlash;
uniform float uAspect;
uniform float uStill;
varying vec2 vUv;
varying vec2 vScreen;
void main() {
  vec2 p = vScreen * vec2(uAspect, 1.0);
  float edge = dot(vScreen, vScreen) * 0.5;
  vec3 color = vec3(0.5, 0.18, 0.86);
  float alpha = uStrength * (0.3 + 0.45 * edge);
  if (uStill < 0.5) {
    // The portal's own texture swirling over the view, like MC's nausea overlay.
    vec2 uv = p * 1.3 + vec2(sin(uTime * 0.7 + p.y * 2.0), cos(uTime * 0.6 + p.x * 2.0)) * 0.08 * uStrength;
    vec4 t = textureGrad(uAtlas, vec3(fract(uv), uPortalLayer), dFdx(uv), dFdy(uv));
    color = mix(color, t.rgb * 1.5, 0.75);
    alpha = uStrength * (0.25 + 0.4 * t.a + 0.35 * edge);
  }
  alpha = max(alpha, uFlash * 0.75);
  color = mix(color, vec3(0.85, 0.7, 1.0), uFlash * 0.6);
  gl_FragColor = vec4(color, min(alpha, 0.92));
#include <colorspace_fragment>
}`;

/** A quad in clip space (NDC x0..x1, y0..y1) that ignores the camera: overlays drawn last, on top of everything. */
function screenQuad(x0: number, y0: number, x1: number, y1: number, flipU = false) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0], 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(flipU ? [1, 0, 0, 0, 0, 1, 1, 1] : [0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

/**
 * First-person screen overlays for the local player. `update` eases each effect: flames while burning, the portal
 * swirl with the portal charge (a plain purple fade under reduced motion), and a flash after travelling.
 */
export class ScreenFx {
  private readonly fire: ShaderMaterial;
  private readonly portal: ShaderMaterial;
  private readonly meshes: Mesh[];
  private burn = 0;
  private charge = 0;
  private flashT = 0;

  constructor(private readonly host: Object3D, shared: SharedUniforms, still: boolean) {
    const common = { vertexShader: SCREEN_VERTEX, transparent: true, depthTest: false, depthWrite: false };
    this.fire = new ShaderMaterial({ ...common, fragmentShader: FIRE_FRAGMENT, uniforms: { uAtlas: shared.uAtlas, uFireLayer: shared.uFireLayer, uStrength: { value: 0 } } });
    this.portal = new ShaderMaterial({
      ...common, fragmentShader: PORTAL_FRAGMENT,
      uniforms: { uAtlas: shared.uAtlas, uPortalLayer: shared.uPortalLayer, uTime: shared.uTime, uStrength: { value: 0 }, uFlash: { value: 0 }, uAspect: { value: 1 }, uStill: { value: still ? 1 : 0 } },
    });
    // MC draws the flames as two tall sprites rising from the bottom corners, the right one mirrored.
    this.meshes = [new Mesh(screenQuad(-1.02, -1.08, -0.05, -0.3), this.fire), new Mesh(screenQuad(0.05, -1.08, 1.02, -0.3, true), this.fire), new Mesh(screenQuad(-1, -1, 1, 1), this.portal)];
    this.meshes.forEach((mesh, i) => {
      mesh.frustumCulled = false;
      mesh.renderOrder = 1000 + (i === 2 ? 1 : 0);
      mesh.visible = false;
      host.add(mesh);
    });
  }

  /** A purple flash that fades over a second (arriving through a portal). */
  flash() { this.flashT = 1; }

  update(dt: number, burning: boolean, portal: number, aspect: number) {
    this.burn += ((burning ? 1 : 0) - this.burn) * damp(burning ? 14 : 6, dt);
    this.charge += (portal - this.charge) * damp(6, dt);
    this.flashT = Math.max(0, this.flashT - dt / 1.1);
    const fire = this.fire.uniforms.uStrength!, swirl = this.portal.uniforms;
    fire.value = this.burn;
    swirl.uStrength!.value = this.charge;
    swirl.uFlash!.value = this.flashT * this.flashT;
    swirl.uAspect!.value = aspect;
    this.meshes[0]!.visible = this.meshes[1]!.visible = this.burn > 0.02;
    this.meshes[2]!.visible = this.charge > 0.01 || this.flashT > 0;
  }

  dispose() {
    for (const mesh of this.meshes) { this.host.remove(mesh); mesh.geometry.dispose(); }
    this.fire.dispose();
    this.portal.dispose();
  }
}
