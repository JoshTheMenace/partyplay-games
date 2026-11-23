/**
 * The Reaches render pipeline: the scene goes to an HDR target (4x MSAA), a five-level bloom chain runs at half resolution and
 * below, and one composite pass adds bloom, applies an ACES-style tone curve, a light grade, a vignette and dither, then writes sRGB.
 * Legacy stages bypass it (`direct`) and render exactly as they always did.
 *
 * Cost at 1080p: one MSAA scene pass, 9 small bloom passes (the largest is 960x540) and one full-screen composite. `low` drops MSAA
 * and bloom and keeps only the tone curve.
 */
import { Color, HalfFloatType, LinearFilter, LinearSRGBColorSpace, Mesh, NoToneMapping, OrthographicCamera, PCFSoftShadowMap, PMREMGenerator, PlaneGeometry, Scene, ShaderMaterial, SphereGeometry, BackSide,
  Vector2, WebGLRenderTarget, type Camera, type Texture, type WebGLRenderer } from 'three';
import type { Quality } from '../../../../party-3d/src/index';

const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const DOWN = /* glsl */`uniform sampler2D tMap; uniform vec2 uTexel; uniform float uThreshold; varying vec2 vUv;
vec3 pick(vec2 o){ vec3 c = texture2D(tMap, vUv + o * uTexel).rgb; if (uThreshold > 0.){ float l = max(c.r, max(c.g, c.b)); c *= smoothstep(uThreshold * .7, uThreshold * 1.6, l) * min(1., 6. / max(l, 1e-4)); } return c; }
void main(){ vec3 c = pick(vec2(0.)) * 4. + pick(vec2(-1., -1.)) + pick(vec2(1., -1.)) + pick(vec2(-1., 1.)) + pick(vec2(1., 1.)); gl_FragColor = vec4(c / 8., 1.); }`;
const UP = /* glsl */`uniform sampler2D tMap, tAdd; uniform vec2 uTexel; uniform float uSpread; varying vec2 vUv;
void main(){ vec2 d = uTexel * uSpread; vec3 c = texture2D(tMap, vUv + vec2(-d.x, -d.y)).rgb + texture2D(tMap, vUv + vec2(d.x, -d.y)).rgb + texture2D(tMap, vUv + vec2(-d.x, d.y)).rgb + texture2D(tMap, vUv + vec2(d.x, d.y)).rgb;
  gl_FragColor = vec4(c * .25 + texture2D(tAdd, vUv).rgb, 1.); }`;
const COMPOSITE = /* glsl */`uniform sampler2D tScene, tBloom; uniform float uBloom, uExposure, uVignette, uContrast, uSaturation, uAlpha; uniform vec3 uLift, uTint; varying vec2 vUv;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec4 src = texture2D(tScene, vUv); vec3 c = src.rgb + texture2D(tBloom, vUv).rgb * uBloom;
  c = aces(c * uExposure) * uTint + uLift * (1. - c);
  float l = dot(c, vec3(.2126, .7152, .0722)); c = mix(vec3(l), c, uSaturation); c = (c - .5) * uContrast + .5;
  vec2 q = vUv - .5; c *= 1. - uVignette * smoothstep(.35, .95, length(q * vec2(1., .82)) * 1.35);
  c = mix(c * 12.92, 1.055 * pow(max(c, vec3(0.)), vec3(1. / 2.4)) - .055, step(.0031308, c));
  gl_FragColor = vec4(c + (hash(gl_FragCoord.xy) - .5) / 255., mix(1., src.a, uAlpha));
}`;
export type Grade = { exposure: number; bloom: number; vignette: number; contrast: number; saturation: number; lift: string; tint: string };
export const GRADE: Grade = { exposure: 1, bloom: .4, vignette: .22, contrast: 1.04, saturation: 1.06, lift: '#000000', tint: '#ffffff' };

export class Pipeline {
  /** Legacy stages render straight to the canvas with no tone mapping. */
  direct = false;
  /** Keep the scene's alpha in the output (transparent portraits from the labs). */
  set alpha(on: boolean) { this.out.uniforms.uAlpha.value = on ? 1 : 0; }
  private scene: WebGLRenderTarget; private mips: WebGLRenderTarget[] = []; private ups: WebGLRenderTarget[] = [];
  private quad = new Mesh(new PlaneGeometry(2, 2)); private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1); private fsq = new Scene();
  private down = new ShaderMaterial({ vertexShader: VERT, fragmentShader: DOWN, depthTest: false, depthWrite: false, uniforms: { tMap: { value: null }, uTexel: { value: new Vector2() }, uThreshold: { value: 0 } } });
  private up = new ShaderMaterial({ vertexShader: VERT, fragmentShader: UP, depthTest: false, depthWrite: false, uniforms: { tMap: { value: null }, tAdd: { value: null }, uTexel: { value: new Vector2() }, uSpread: { value: 1 } } });
  private out = new ShaderMaterial({ vertexShader: VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false, uniforms: { tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uExposure: { value: 1 }, uVignette: { value: 0 },
    uContrast: { value: 1 }, uSaturation: { value: 1 }, uLift: { value: new Color(0) }, uTint: { value: new Color(1, 1, 1) }, uAlpha: { value: 0 } } });
  private size = new Vector2(); private bloom: boolean;
  constructor(private renderer: WebGLRenderer, readonly quality: Quality = 'balanced') {
    this.bloom = quality !== 'low'; this.fsq.add(this.quad); this.quad.frustumCulled = false;
    this.scene = new WebGLRenderTarget(4, 4, { type: HalfFloatType, samples: quality === 'low' ? 0 : 4, colorSpace: LinearSRGBColorSpace, minFilter: LinearFilter, magFilter: LinearFilter });
    for (let i = 0; i < 5; i++) for (const list of [this.mips, this.ups]) list.push(new WebGLRenderTarget(4, 4, { type: HalfFloatType, depthBuffer: false, colorSpace: LinearSRGBColorSpace, minFilter: LinearFilter, magFilter: LinearFilter }));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFSoftShadowMap; renderer.toneMapping = NoToneMapping;
    this.grade(GRADE);
  }
  grade(g: Partial<Grade>) {
    const u = this.out.uniforms, v = { ...GRADE, ...g };
    u.uExposure.value = v.exposure; u.uBloom.value = this.bloom ? v.bloom : 0; u.uVignette.value = v.vignette; u.uContrast.value = v.contrast; u.uSaturation.value = v.saturation; u.uLift.value.set(v.lift); u.uTint.value.set(v.tint);
  }
  private resize() {
    const r = this.renderer, s = r.getDrawingBufferSize(new Vector2());
    if (s.equals(this.size) || !s.x || !s.y) return;
    this.size.copy(s); this.scene.setSize(s.x, s.y);
    for (let i = 0; i < 5; i++) { const w = Math.max(2, s.x >> (i + 1)), h = Math.max(2, s.y >> (i + 1)); this.mips[i].setSize(w, h); this.ups[i].setSize(w, h); }
  }
  private pass(material: ShaderMaterial, target: WebGLRenderTarget | null) { this.quad.material = material; this.renderer.setRenderTarget(target); this.renderer.render(this.fsq, this.cam); }
  render(scene: Scene, camera: Camera) {
    const r = this.renderer;
    if (this.direct) { r.setRenderTarget(null); r.render(scene, camera); return; }
    this.resize();
    r.setRenderTarget(this.scene); r.render(scene, camera);
    let bloom: Texture | null = null;
    if (this.bloom) {
      let src: Texture = this.scene.texture, w = this.size.x, h = this.size.y; const d = this.down.uniforms, u = this.up.uniforms;
      for (let i = 0; i < 5; i++) { d.tMap.value = src; d.uTexel.value.set(1 / w, 1 / h); d.uThreshold.value = i ? 0 : 1.3; this.pass(this.down, this.mips[i]); src = this.mips[i].texture; w = this.mips[i].width; h = this.mips[i].height; }
      let acc: Texture = this.mips[4].texture;
      for (let i = 3; i >= 0; i--) { u.tMap.value = acc; u.tAdd.value = this.mips[i].texture; u.uTexel.value.set(1 / this.mips[i + 1].width, 1 / this.mips[i + 1].height); u.uSpread.value = 1; this.pass(this.up, this.ups[i]); acc = this.ups[i].texture; }
      bloom = acc;
    }
    const o = this.out.uniforms; o.tScene.value = this.scene.texture; o.tBloom.value = bloom ?? this.mips[0].texture;
    this.pass(this.out, null);
  }
  dispose() { this.scene.dispose(); for (const t of [...this.mips, ...this.ups]) t.dispose(); this.quad.geometry.dispose(); this.down.dispose(); this.up.dispose(); this.out.dispose(); }
}

/** A small prefiltered environment from three sky colours, so metal, glass and eyes have something to reflect. The caller owns and disposes it. */
export function skyEnvironment(renderer: WebGLRenderer, top: string, horizon: string, ground: string, sun?: { dir: [number, number, number]; color: string; size?: number }): WebGLRenderTarget {
  const scene = new Scene(), geo = new SphereGeometry(10, 32, 16);
  const mat = new ShaderMaterial({ side: BackSide, depthWrite: false, uniforms: { uTop: { value: new Color(top) }, uHorizon: { value: new Color(horizon) }, uGround: { value: new Color(ground) },
    uSunDir: { value: sun ? sun.dir : [0, 1, 0] }, uSun: { value: new Color(sun?.color ?? '#000000') }, uSunSize: { value: sun?.size ?? .12 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 uTop, uHorizon, uGround, uSunDir, uSun; uniform float uSunSize; varying vec3 vDir;
void main(){ vec3 d = normalize(vDir); vec3 c = d.y > 0. ? mix(uHorizon, uTop, pow(d.y, .55)) : mix(uHorizon, uGround, pow(-d.y, .4));
  c += uSun * smoothstep(1. - uSunSize, 1. - uSunSize * .25, dot(d, normalize(uSunDir))) * 6.; gl_FragColor = vec4(c, 1.); }` });
  scene.add(new Mesh(geo, mat));
  const pmrem = new PMREMGenerator(renderer), target = pmrem.fromScene(scene, 0, .1, 100);
  pmrem.dispose(); geo.dispose(); mat.dispose();
  return target;
}
