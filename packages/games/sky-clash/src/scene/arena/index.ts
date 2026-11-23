/**
 * Arena art for the stages of the Reaches. The stage itself is one baked model (tools/blender/crew/<id>.py): a single palette mesh drawn
 * with the crew's lit material plus tiling surface patterns in world space, so stone courses and planks stay crisp at any camera distance.
 * Around it: a painted sky dome, a drifting cloud sea, haze that swallows the far islands, lamp light, and each arena's own motion.
 * Collision still comes from stageFrame(); a test checks the model was built to the same numbers.
 */
import { AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, ConeGeometry, DoubleSide, FogExp2, Group, LineSegments, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight, Points, ShaderChunk, ShaderMaterial, SphereGeometry, Vector4,
  type Object3D, type Scene, type Texture, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ResourceScope } from '../../../../../party-runtime/src/index';
import type { Quality } from '../../../../../party-3d/src/index';
import type { ArenaId } from '../../arenas';
import { STAGES, stageFrame } from '../../stages';
import { mainFloor } from '../camera';
import { keyedLoader } from '../fighter/queue';
import { skyEnvironment, type Grade } from '../pipeline';
import type { StageArt } from '../stage/index';
import type { StageUpdate } from '../stage/kit';
import { DUSK, STORM, createLights, type LightSpec } from './lights';

type Slot = { name: string; rough: number; metal: number; glow: number; kind: number; color: string; pattern: string };
type Meta = { slots: Slot[]; anchors?: Record<string, { at: number[] }>; extras?: { lights?: number[][]; collision?: unknown } };
export type ArenaModel = { id: ArenaId; scene: Object3D; meta: Meta; paint: Texture; detail: Texture; triangles: number };
/** What an arena adds beyond the legacy StageArt: it owns the scene's environment, haze and grade while it is shown. */
export type ArenaArt = StageArt & { enter(scene: Scene, renderer: WebGLRenderer): Partial<Grade>; leave(scene: Scene): void };
type Look = { light: LightSpec; haze: [color: string, density: number]; grade: Partial<Grade>; sky: { top: string; mid: string; horizon: string; sun: string; sunDir: [number, number, number]; stars: number; cloud: string }; sea: { y: number; lit: string; shade: string };
  /** Lamp-light colour for the model's light points, the colour of drifting motes, and rain (0 none .. 1 heavy). */
  lamp: string; lampPower: number; motes: [number, number, number]; rain?: number };
const LOOKS: Record<ArenaId, Look> = {
  'beacon-rock': { light: DUSK, haze: ['#a98aa6', .011], grade: { exposure: 1.0, bloom: .42, vignette: .26, contrast: 1.05, saturation: 1.08, tint: '#fff6ec' },
    sky: { top: '#1c2466', mid: '#5b4f9c', horizon: '#ffb07a', sun: '#ffd9a0', sunDir: [-.55, .1, -.83], stars: .7, cloud: '#ff9c8a' }, sea: { y: -9.5, lit: '#f6b9a0', shade: '#6a5a96' }, lamp: '#ffb060', lampPower: 5.5, motes: [1, .72, .38] },
  bellyard: { light: STORM, haze: ['#2c3850', .02], grade: { exposure: 1.1, bloom: .45, vignette: .34, contrast: 1.08, saturation: 1.05, tint: '#f2f6ff' },
    sky: { top: '#060b16', mid: '#1c2940', horizon: '#4a3a44', sun: '#7a4a34', sunDir: [.5, -.25, -.83], stars: 0, cloud: '#2a3448' }, sea: { y: -11, lit: '#5c4c52', shade: '#121824' }, lamp: '#ff9a4a', lampPower: 2.6, motes: [1, .6, .25], rain: 1 },
};
const URLS = import.meta.glob('../../../assets/stages/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const META = import.meta.glob('../../../assets/models/*.json', { eager: true, import: 'default' }) as Record<string, Meta | undefined>;
const loaded = new Map<ArenaId, ArenaModel>();
export const arenaReady = (id: ArenaId) => loaded.has(id);
/** Download and parse an arena's model once per page; callers share the job, and it is cancelled only when nobody is waiting any more. */
const loader = keyedLoader<ArenaId, ArenaModel>(async (id, signal) => {
  const url = URLS[`../../../assets/stages/${id}.glb`], meta = META[`../../../assets/models/${id}.json`];
  if (!url || !meta) throw new Error(`Sky Clash is missing the ${STAGES[id].name} stage model.`);
  const response = await fetch(url, { signal }); if (!response.ok) throw new Error(`Could not download ${STAGES[id].name} (${response.status}).`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), url.slice(0, url.lastIndexOf('/') + 1)), meshes: Mesh[] = [];
  gltf.scene.updateMatrixWorld(true); gltf.scene.traverse(o => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
  const first = meshes[0]?.material as MeshStandardMaterial | undefined; if (!first?.map || !first.normalMap) throw new Error(`${STAGES[id].name} is missing its baked maps.`);
  const parts = meshes.map(mesh => {
    const name = (mesh.material as MeshStandardMaterial).name.replace(/\.\d+$/, ''), slot = Math.max(0, meta.slots.findIndex(s => s.name === name)), g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
    g.setAttribute('slot', new BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(slot), 1)); return g;
  });
  const merged = mergeGeometries(parts, false)!; merged.computeBoundingSphere();
  for (const g of parts) g.dispose(); for (const m of meshes) m.geometry.dispose();
  const body = new Mesh(merged); body.name = 'arena-body';
  const model: ArenaModel = { id, scene: body, meta, paint: first.map, detail: first.normalMap, triangles: (merged.index?.count ?? 0) / 3 };
  loaded.set(id, model); return model;
});
export const loadArena = (id: ArenaId, signal: AbortSignal): Promise<ArenaModel> => loader.load([id], signal).then(m => m.get(id)!);

const MAX = 16;
/** The crew material's palette x paint logic for a static mesh, plus world-space tiling patterns chosen per slot (uKind). */
function arenaMaterial(model: ArenaModel, quality: Quality) {
  const slots = model.meta.slots, pad = <T>(make: (s: Slot | undefined) => T) => Array.from({ length: MAX }, (_, i) => make(slots[i]));
  const u = { uBase: { value: pad(s => new Color(s?.color ?? '#ffffff')) }, uPat: { value: pad(s => new Color(s?.pattern ?? '#ffffff')) }, uSurf: { value: pad(s => new Vector4(s?.rough ?? .8, s?.metal ?? 0, s?.glow ?? 0, s?.kind ?? 0)) }, uDetail: { value: model.detail }, uGlow: { value: 1 } };
  const mat = new MeshStandardMaterial({ color: 0xffffff, map: model.paint, normalMap: quality === 'low' ? null : model.detail });
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute float slot; uniform vec3 uBase[${MAX}]; uniform vec3 uPat[${MAX}]; uniform vec4 uSurf[${MAX}];
varying vec3 vBase; varying vec3 vPat; varying vec4 vSurf; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  int sl = int(slot + .5); vBase = uBase[sl]; vPat = uPat[sl]; vSurf = uSurf[sl]; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vBase; varying vec3 vPat; varying vec4 vSurf; varying vec3 vWPos; uniform sampler2D uDetail; uniform float uGlow;
float aHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float aNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(aHash(i), aHash(i + vec2(1, 0)), f.x), mix(aHash(i + vec2(0, 1)), aHash(i + vec2(1, 1)), f.x), f.y); }
/* Tiling relief per surface kind: returns albedo scale in x and a roughness nudge in y. */
vec2 aPattern(float kind, vec3 P){
  vec3 wn = normalize(cross(dFdx(P), dFdy(P))); bool flat_ = abs(wn.y) > .6; vec2 uv = flat_ ? P.xz : vec2(P.x + P.z * .7, P.y);
  if (kind < .5) return vec2(1., 0.);
  if (kind < 1.5) { vec2 cell = flat_ ? vec2(.86, .62) : vec2(.74, .33); vec2 g = uv / cell; g.x += .5 * mod(floor(g.y), 2.); vec2 f = fract(g), id = floor(g);
    float seam = smoothstep(0., .03, min(f.x, 1. - f.x) * cell.x) * smoothstep(0., .03, min(f.y, 1. - f.y) * cell.y);
    return vec2(mix(.55, 1., seam) * (.88 + .22 * aHash(id)) * (.93 + .1 * aNoise(uv * 9.)), (1. - seam) * .1); }
  if (kind < 2.5) { vec2 g = uv / vec2(1.7, .17); g.x += aHash(vec2(floor(g.y), 3.)); vec2 f = fract(g); float seam = smoothstep(0., .02, min(f.y, 1. - f.y) * .17) * smoothstep(0., .012, min(f.x, 1. - f.x) * 1.7);
    return vec2(mix(.5, 1., seam) * (.85 + .25 * aHash(floor(g))) * (.92 + .1 * sin(uv.x * 40. + aNoise(uv * 3.) * 9.)), 0.); }
  if (kind < 3.5) { vec2 g = uv / .9; vec2 f = fract(g); float seam = smoothstep(0., .018, min(f.x, 1. - f.x) * .9) * smoothstep(0., .018, min(f.y, 1. - f.y) * .9);
    float rivet = 1. - smoothstep(.02, .035, length(fract(g * 4. + .5) - .5) * .225) * 1.; rivet *= step(min(f.x, 1. - f.x), .13) + step(min(f.y, 1. - f.y), .13);
    return vec2(mix(.6, 1., seam) * (.94 + .1 * aHash(floor(g))) + clamp(rivet, 0., 1.) * .18, -.12 * clamp(rivet, 0., 1.)); }
  float band = fract(P.y * 1.15 + aNoise(vec2(P.x, P.z) * .45) * 1.1 + P.x * .08); float crack = smoothstep(.0, .06, band) * smoothstep(1., .9, band);
  return vec2(mix(.6, 1., crack) * (.82 + .32 * aNoise(vec2(P.x + P.z, P.y) * 1.7)), 0.);
}`)
      .replace('#include <map_fragment>', 'vec3 paintTex = texture2D( map, vMapUv ).rgb; float maskTex = texture2D( uDetail, vMapUv ).b; vec2 pat = aPattern( vSurf.w, vWPos );\n  diffuseColor.rgb = mix( vBase, vPat, maskTex ) * paintTex * 2.0 * pat.x;\n  totalEmissiveRadiance += diffuseColor.rgb * vSurf.z * uGlow;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp( vSurf.x * mix( 1.15, .85, paintTex.g ) + pat.y, .05, 1.0 );')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y;')
      .replace('#include <normal_fragment_maps>', ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        'vec3 mapN = vec3( texture2D( normalMap, vNormalMapUv ).xy * 2.0 - 1.0, 0.0 ); mapN.z = sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) );'));
  };
  mat.customProgramCacheKey = () => 'sky-clash-arena-' + quality;
  return { mat, uniforms: u };
}
const SKY_FRAG = /* glsl */`uniform vec3 uTop, uMid, uHorizon, uSun, uSunDir, uCloud; uniform float uTime, uStars; varying vec3 vDir;
float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++) { v += n(p) * a; p = p * 2.03 + 7.1; a *= .5; } return v; }
void main(){
  vec3 d = normalize(vDir); float y = d.y;
  vec3 c = y > .0 ? mix(uHorizon, uMid, smoothstep(0., .22, y)) : uHorizon; c = mix(c, uTop, smoothstep(.16, .75, y));
  float sun = max(0., dot(d, normalize(uSunDir))); c += uSun * (pow(sun, 380.) * 5. + pow(sun, 18.) * .55 + pow(sun, 3.) * .16);
  // Long painted cloud bands near the horizon, lit warm from below by the sun
  vec2 q = vec2(atan(d.x, -d.z) * 2.4 + uTime * .006, y * 9.); float band = fbm(q * vec2(1., 1.8)) * smoothstep(.42, .02, abs(y - .13) * 2.6);
  float cl = smoothstep(.34, .62, band); c = mix(c, mix(uCloud, uSun, .35 + .4 * pow(sun, 2.)), cl * .78);
  float st = step(.9975, h(floor(d.xy * 220. + d.z * 90.))) * smoothstep(.25, .6, y) * uStars; c += vec3(.9, .92, 1.) * st * (.6 + .4 * sin(uTime * 2. + d.x * 80.));
  gl_FragColor = vec4(c, 1.);
}`;
const SEA_FRAG = /* glsl */`uniform vec3 uLit, uShade, uHaze; uniform float uTime; varying vec3 vW;
float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++) { v += n(p) * a; p = p * 2.02 + 3.3; a *= .5; } return v; }
void main(){
  vec2 p = vW.xz * .045 + vec2(uTime * .012, 0.); float a = fbm(p), b = fbm(p * 2.3 + a * 1.4 - uTime * .01);
  float puff = smoothstep(.3, .75, a * .65 + b * .5); vec3 c = mix(uShade, uLit, puff);
  float far = smoothstep(40., 230., length(vW.xz)); c = mix(c, uHaze, far * .92);
  gl_FragColor = vec4(c, 1.);
}`;
const BEAM_FRAG = /* glsl */`uniform vec3 uColor; varying vec2 vUv; void main(){ float along = pow(1. - vUv.y, 1.6), across = pow(sin(vUv.x * 3.14159), 2.); gl_FragColor = vec4(uColor * along * (.35 + .65 * across), along * .5); }`;

export function createArenaArt(id: ArenaId, parent: ResourceScope, quality: Quality): ArenaArt {
  const scope = new ResourceScope(parent.signal), model = loaded.get(id); if (!model) throw new Error(`${STAGES[id].name} was not loaded.`);
  const look = LOOKS[id], stage = STAGES[id], root = new Group(), frame0 = stageFrame(id, 0, false), floor = mainFloor(frame0.blocks); root.name = `arena-${id}`;
  scope.defer(() => root.removeFromParent());
  const { mat, uniforms } = arenaMaterial(model, quality); scope.own(mat);
  const body = new Mesh((model.scene as Mesh).geometry, mat); body.receiveShadow = true; body.castShadow = true; root.add(body);
  const lights = createLights(root, look.light, quality); scope.defer(() => lights.dispose());
  // Sky dome and cloud sea are unlit backdrops; both sit outside the fog so the haze is painted, not computed twice.
  const dome = new Mesh(scope.own(new SphereGeometry(900, 48, 24)), scope.own(new ShaderMaterial({ side: BackSide, depthWrite: false, fog: false, uniforms: { uTop: { value: new Color(look.sky.top) }, uMid: { value: new Color(look.sky.mid) }, uHorizon: { value: new Color(look.sky.horizon) },
    uSun: { value: new Color(look.sky.sun) }, uSunDir: { value: look.sky.sunDir }, uCloud: { value: new Color(look.sky.cloud) }, uTime: { value: 0 }, uStars: { value: look.sky.stars } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }', fragmentShader: SKY_FRAG })));
  dome.renderOrder = -10; dome.frustumCulled = false;
  const sea = new Mesh(scope.own(new PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2)), scope.own(new ShaderMaterial({ fog: false, uniforms: { uLit: { value: new Color(look.sea.lit) }, uShade: { value: new Color(look.sea.shade) }, uHaze: { value: new Color(look.sky.horizon) }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }', fragmentShader: SEA_FRAG })));
  sea.position.y = look.sea.y; sea.renderOrder = -9; root.add(dome, sea);
  // Warm pools of lamp light on the terrace (the balanced tier only: each is a per-pixel light on every lit surface).
  const lamps: PointLight[] = [];
  if (quality !== 'low') for (const [x, y, z] of model.meta.extras?.lights ?? []) { const l = new PointLight(new Color(look.lamp), look.lampPower, 6.5, 1.8); l.position.set(x, y, z + .5); lamps.push(l); root.add(l); }
  // The beacon: two soft beams turning slowly from the tower's lantern room.
  const beam = new Group(), anchor = model.meta.anchors?.beam?.at;
  if (anchor) {
    const geo = scope.own(new ConeGeometry(9, 90, 20, 1, true).translate(0, -45, 0).rotateZ(Math.PI / 2)), bm = scope.own(new ShaderMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false, uniforms: { uColor: { value: new Color('#ffd9a0').multiplyScalar(.9) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }', fragmentShader: BEAM_FRAG }));
    const a = new Mesh(geo, bm), b = new Mesh(geo, bm); b.rotation.y = Math.PI; beam.add(a, b); beam.position.set(anchor[0], anchor[1], anchor[2]); beam.renderOrder = 3; root.add(beam);
  }
  // Drifting motes: embers and dust catching the light.
  const N = quality === 'low' ? 40 : 110, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 26; pos[i * 3 + 1] = -2 + (Math.abs(Math.sin(i * 78.233) * 9631.7) % 1) * 12; pos[i * 3 + 2] = -6 + (Math.abs(Math.sin(i * 39.3) * 517.3) % 1) * 8; seed[i] = i; }
  const moteGeo = scope.own(new BufferGeometry()); moteGeo.setAttribute('position', new BufferAttribute(pos, 3)); moteGeo.setAttribute('seed', new BufferAttribute(seed, 1));
  const moteMat = scope.own(new ShaderMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false, uniforms: { uTime: { value: 0 } },
    vertexShader: 'attribute float seed; uniform float uTime; varying float vA; void main(){ vec3 p = position; p.y += mod(uTime * (.12 + .1 * fract(seed * .37)) + seed, 12.) - 6.; p.x += sin(uTime * .3 + seed) * .6; vA = .35 + .65 * fract(seed * .61); vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (28. + 30. * fract(seed * .13)) / max(1., -mv.z); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - .5) * 2.; gl_FragColor = vec4(vec3(${look.motes.map(v => v.toFixed(3)).join(', ')}) * 1.6, (1. - smoothstep(.2, 1., r)) * vA * .7); }` }));
  const motes = new Points(moteGeo, moteMat); motes.frustumCulled = false; motes.renderOrder = 4; root.add(motes);
  // Rain: slanted streaks falling through the whole view, drawn as short lines so they cost one draw call.
  let rainMat: ShaderMaterial | null = null;
  if (look.rain) {
    const M = quality === 'low' ? 220 : 620, rp = new Float32Array(M * 6), rs = new Float32Array(M * 2), re = new Float32Array(M * 2);
    for (let i = 0; i < M; i++) { const x = (Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1) * 44 - 22, z = (Math.abs(Math.sin(i * 39.3) * 517.3) % 1) * 16 - 11; rp.set([x, 0, z, x, 0, z], i * 6); rs.set([i, i], i * 2); re.set([0, 1], i * 2); }
    const rg = scope.own(new BufferGeometry()); rg.setAttribute('position', new BufferAttribute(rp, 3)); rg.setAttribute('seed', new BufferAttribute(rs, 1)); rg.setAttribute('end', new BufferAttribute(re, 1));
    rainMat = scope.own(new ShaderMaterial({ transparent: true, depthWrite: false, fog: false, uniforms: { uTime: { value: 0 } },
      vertexShader: 'attribute float seed; attribute float end; uniform float uTime; varying float vA; void main(){ vec3 p = position; float sp = 13. + 6. * fract(seed * .37); p.y = 14. - mod(uTime * sp + seed * 7.13, 24.) + end * (.5 + .4 * fract(seed * .71)); p.x += (p.y - 14.) * .18 + end * .09; vA = (.25 + .5 * fract(seed * .61)) * (1. - end * .6); gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }',
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(vec3(.72, .82, 1.), vA * ${(.5 * look.rain).toFixed(2)}); }` }));
    const rain = new LineSegments(rg, rainMat); rain.frustumCulled = false; rain.renderOrder = 4; root.add(rain);
  }
  let env: WebGLRenderTarget | null = null; scope.defer(() => env?.dispose());
  return {
    id, stage, floor, root, dispose: scope.dispose,
    enter(scene, renderer) {
      env ??= skyEnvironment(renderer, look.light.env.top, look.light.env.horizon, look.light.env.ground, { dir: look.light.key.dir, color: `#${new Color(look.light.key.color).multiplyScalar(look.light.env.sun ?? 1).getHexString()}` });
      scene.environment = env.texture; scene.environmentIntensity = .85; scene.fog = new FogExp2(new Color(look.haze[0]), look.haze[1]); scene.background = null; return look.grade;
    },
    leave(scene) { scene.environment = null; scene.fog = null; },
    update(u: StageUpdate) {
      const t = u.reduced ? u.seconds * .15 : u.seconds;
      (dome.material as ShaderMaterial).uniforms.uTime.value = t; (sea.material as ShaderMaterial).uniforms.uTime.value = t; moteMat.uniforms.uTime.value = t; if (rainMat) rainMat.uniforms.uTime.value = u.seconds;
      dome.position.copy(u.camera.position); beam.rotation.y = t * .22; uniforms.uGlow.value = 1 + .08 * Math.sin(t * 3.1);
      lamps.forEach((l, i) => { l.intensity = look.lampPower * (1 + .06 * Math.sin(t * 7 + i * 2.1) + .04 * Math.sin(t * 13.3 + i)); });
      return stageFrame(id, u.tick, u.hazards);
    },
  };
}
