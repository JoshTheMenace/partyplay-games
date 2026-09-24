/**
 * Shared building blocks for stage art: toon shaders, the sky dome, collision-exact solids and slabs,
 * vertex-colored batching and pooled instanced decor. Every GPU resource is owned by the caller's ResourceScope.
 *
 * Collision contract: a block's art has its walkable top exactly at block.top across [left, right] and its walls
 * exactly at left/right. Decorative shaping (rounded lower corners, jagged undersides) stays inside the rectangle.
 */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, DirectionalLight, DoubleSide, ExtrudeGeometry, FrontSide, Group, HemisphereLight,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, NormalBlending, Object3D, PlaneGeometry, Quaternion, ShaderMaterial, Shape, ShapeGeometry, SphereGeometry,
  SRGBColorSpace, Vector3, type ColorRepresentation, type IUniform, type Material, type PerspectiveCamera,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ResourceScope } from '../../../../../party-runtime/src/index';
import type { Quality } from '../../../../../party-3d/src/index';

/** Structural copies of the Stage API shapes the art needs (see DESIGN.md). */
export type Rect = { left: number; right: number; top: number; bottom: number };
export type BlockLike = Rect & { id: string; ledges: boolean; moving?: boolean };
export type PlatformLike = { id: string; left: number; right: number; y: number };
export type LedgeLike = { block: string; x: number; y: number; side: -1 | 1 };
export type ZoneLike = { left: number; right: number; bottom: number; top: number };
export type HazardLike = { kind: string; label: string; warning: boolean; active: boolean; zones: ZoneLike[]; push: number; angle: number; cycle: number };
export type FrameLike = { blocks: BlockLike[]; platforms: PlatformLike[]; ledges: LedgeLike[]; hazard: HazardLike | null };

export type StageUpdate = {
  /** Fractional stage tick from the presented snapshot; gameplay motion and hazards follow it even under reduced motion. */
  tick: number; hazards: boolean;
  /** Render clock for decorative motion (frozen-ish under reduced motion by each module). */
  seconds: number; dt: number; reduced: boolean; camera: PerspectiveCamera;
  /** Presented fighter feet, for splashes and rustles. */
  fighters: readonly { x: number; y: number; vy: number }[];
};
export type Lighting = { sky: string; ground: string; key: string; keyIntensity: number; keyDir: [number, number, number]; rim: string; rimDir: [number, number, number]; ambient?: number };

export const TAU = Math.PI * 2;
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const smooth = (a: number, b: number, t: number) => { const x = clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
/** Deterministic pseudo-random stream so art is identical on every display. */
export const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
export const mix = (a: ColorRepresentation, b: ColorRepresentation, t: number) => new Color(a).lerp(new Color(b), clamp(t, 0, 1));
/** Front and back faces of solids and slabs (toward the camera is +z); fighters stand at z = 0. */
export const DEPTH = { front: 1.4, back: -2.8, slabFront: 1.05, slabBack: -1.1 };
/** Fighters and ledge-trim layer used by the magnifier pass. */
export const BUBBLE_LAYER = 3;

export const GLSL_NOISE = /* glsl */`
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += noise(p) * a; p *= 2.03; a *= .5; } return v; }`;
const GLSL_LIGHT = /* glsl */`
uniform vec3 uKeyDir, uKey, uSky, uGround, uRim, uRimDir;
vec3 toon(vec3 n, vec3 base, vec3 w){
  float d = dot(n, uKeyDir), band = d > .45 ? 1. : d > .05 ? .68 : .44;
  vec3 v = normalize(cameraPosition - w), amb = mix(uGround, uSky, n.y * .5 + .5);
  float rim = pow(1. - max(dot(n, v), 0.), 2.5) * max(dot(n, uRimDir) + .35, 0.) * (1. - abs(n.y));
  return base * (amb + uKey * band) + uRim * smoothstep(.28, .36, rim) * .5;
}`;
const VERT = /* glsl */`
attribute vec4 aRect; attribute vec2 aLedge;
varying vec3 vW, vL, vN, vC; varying vec4 vRect; varying vec2 vLedge;
void main(){
  vec4 p = vec4(position, 1.); vec3 n = normal; vC = vec3(1.); vRect = aRect; vLedge = aLedge;
  #ifdef USE_COLOR
    vC = color.rgb;
  #endif
  #ifdef USE_INSTANCING
    p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vC *= instanceColor;
  #endif
  vL = p.xyz; vec4 w = modelMatrix * p; vW = w.xyz; vN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** Surface patterns, all in the solid's local coordinates so moving blocks carry their texture. */
export type SurfaceStyle = 'rock' | 'stone' | 'brick' | 'planks' | 'metal' | 'crystal' | 'ice' | 'quilt' | 'lcd' | 'cloud' | 'soil' | 'hull' | 'roof';
export type SurfaceOptions = {
  style: SurfaceStyle; cap: ColorRepresentation; capDark?: ColorRepresentation; face: ColorRepresentation; faceDeep?: ColorRepresentation;
  line?: ColorRepresentation; lip?: ColorRepresentation; trim?: ColorRepresentation; glow?: ColorRepresentation;
  /** How far the cap color (grass, snow, paving) wraps down the front face, in meters, and how wavy its edge is. */
  capDepth?: number; wave?: number; lipWidth?: number; scale?: number; flat?: boolean;
};

const surfaceFragment = /* glsl */`
uniform vec3 uCap, uCapDark, uFace, uFaceDeep, uLine, uLip, uTrim, uGlow; uniform float uCapDepth, uWave, uLipW, uScale, uTime, uFlat;
varying vec3 vW, vL, vN, vC; varying vec4 vRect; varying vec2 vLedge;
${GLSL_NOISE}
${GLSL_LIGHT}
void main(){
  vec3 n = normalize(vN); vec2 q = vL.xy * uScale; float top = vRect.z, bottom = vRect.w, h = max(.01, top - bottom);
  float depth = clamp((top - vL.y) / min(h, 4.), 0., 1.), below = top - vL.y;
  float wave = ((noise(vec2(vL.x * 1.7, vL.z * 1.7 + 3.)) - .5) * .5 + sin(vL.x * 2.3 + vL.z) * .12) * uWave;
  bool isTop = n.y > .55;
  bool cap = isTop || below < uCapDepth + wave;
  vec3 col = mix(uFace, uFaceDeep, smoothstep(.0, 1., depth));
  float glow = 0.;
  #ifdef STYLE_ROCK
    float band = fract(vL.y * 1.2 + fbm(vec2(vL.x * .35, vL.z * .5)) * 1.3);
    col = mix(col, uLine, step(.87, band) * .55); col *= .9 + .2 * noise(q * 3.1 + vL.z);
  #endif
  #ifdef STYLE_SOIL
    col *= .88 + .2 * fbm(q * 2.2 + vL.z); float pebble = step(.8, noise(q * 5.3)); col = mix(col, uLine, pebble * .35);
  #endif
  #ifdef STYLE_STONE
    float row = floor((top - vL.y) * 1.25), sx = vL.x * .6 + hash(vec2(row, 3.)) * 2. + vL.z * .02;
    float seam = max(step(.93, fract((top - vL.y) * 1.25)), step(.965, fract(sx)));
    col *= .86 + .2 * hash(vec2(floor(sx), row)); col = mix(col, uLine, seam * .9);
    col *= .94 + .08 * noise(q * 4.); glow = seam * step(.72, hash(vec2(floor(sx * .5), row))) * (.55 + .45 * sin(uTime * 1.3 + vL.x * .4 - vL.y));
  #endif
  #ifdef STYLE_BRICK
    float row = floor((top - vL.y) * 2.5), bx = vL.x * 1.25 + mod(row, 2.) * .5;
    float mortar = max(step(.86, fract((top - vL.y) * 2.5)), step(.92, fract(bx)));
    col = mix(col, uLine, mortar); col *= .92 + .12 * step(.5, fract(bx * 2.)) * step(.5, fract((top - vL.y) * 5.));
  #endif
  #ifdef STYLE_PLANKS
    float board = floor(vL.y * 3.2), seam = step(.88, fract(vL.y * 3.2));
    col *= .86 + .2 * hash(vec2(board, floor(vL.x * .5 + hash(vec2(board)) * 3.)));
    col = mix(col, uLine, seam * .85); col *= .94 + .06 * sin(vL.x * 9. + noise(q * 2.) * 6.);
    float nail = step(length(fract(vec2(vL.x * .5, vL.y * 3.2)) - vec2(.5, .45)), .04); col = mix(col, uLip, nail * .5);
  #endif
  #ifdef STYLE_HULL
    float board = floor(vL.y * 2.4), seam = step(.9, fract(vL.y * 2.4));
    col *= .9 + .14 * hash(vec2(board, floor(vL.x * .3))); col = mix(col, uLine, seam * .7);
    float port = step(length(vec2(fract(vL.x * .45) - .5, (vL.y - top + .95) * 1.8)), .2) * step(.8, h);
    col = mix(col, uLip, port * .9); glow = port * .6;
  #endif
  #ifdef STYLE_METAL
    float plate = max(step(.97, fract(vL.x * .45 + .5)), step(.95, fract((vL.y - top) * .9)));
    col = mix(col, uLine, plate * .75);
    float rivet = step(length(fract(vec2(vL.x * 1.8, (vL.y - top) * 1.8 + .5)) - .5), .07);
    col = mix(col, uLip, rivet * .55 * (1. - plate));
    float stripe = step(.5, fract((vL.x + vL.y) * .9)) * step(below, .5) * step(.28, below);
    col = mix(col, uTrim, stripe * .8);
  #endif
  #ifdef STYLE_ROOF
    float course = step(.9, fract((top - vL.y) * 1.6)), panel = step(.96, fract(vL.x * .35));
    col *= .9 + .12 * noise(q * 3.); col = mix(col, uLine, max(course, panel) * .6);
    float win = step(.25, fract(vL.x * .7)) * step(fract(vL.x * .7), .75) * step(.3, fract((top - vL.y) * .8)) * step(fract((top - vL.y) * .8), .75) * step(.9, below);
    float lamp = step(.45, hash(floor(vec2(vL.x * .7, (top - vL.y) * .8))));
    col = mix(col, mix(uLine, uGlow, lamp), win * .95); glow = win * lamp * .8;
  #endif
  #ifdef STYLE_CRYSTAL
    vec2 fp = vec2(vL.x * .8 + vL.y * .45, vL.y * 1.3 - vL.x * .25) + vL.z * .3, cell = floor(fp), ff = fract(fp);
    float facet = hash(cell + step(ff.x, ff.y) * 17.);
    col *= .78 + .34 * facet; col = mix(col, uLip, smoothstep(.93, 1., facet) * .35);
    float vein = smoothstep(.03, .0, abs(noise(q * vec2(.9, 1.6) + vL.z * .2) - .5)) * smoothstep(.5, .7, noise(q * .35 + 9.));
    glow = vein * (.6 + .35 * sin(uTime * 1.6 + vL.x * .7));
  #endif
  #ifdef STYLE_ICE
    float streak = smoothstep(.55, .9, noise(vec2(vL.x * 3.5, vL.y * .4 + vL.z)));
    col = mix(col, uLip, streak * .45); col *= .92 + .14 * fbm(q * 1.5);
    float crack = smoothstep(.02, .0, abs(noise(q * 1.3 + 2.) - .5)); col = mix(col, uLine, crack * .6);
  #endif
  #ifdef STYLE_QUILT
    vec2 cq = vec2(vL.x * .9, (top - vL.y) * .9 + vL.z * .1), qc = floor(cq), qf = fract(cq);
    col = mix(col, uLine, step(.5, hash(qc)) * .35);
    float stitch = (step(abs(qf.x - .06), .025) + step(abs(qf.y - .06), .025)) * step(.5, fract((qf.x + qf.y) * 7.));
    col = mix(col, uLip, clamp(stitch, 0., 1.) * .8);
  #endif
  #ifdef STYLE_CLOUD
    col *= .92 + .14 * fbm(q * 1.6 + vL.z);
  #endif
  #ifdef STYLE_LCD
    col = uFace; float dot2 = step(.7, fract(vW.x * 6.)) * step(.7, fract(vW.y * 6.)); col *= 1. - dot2 * .12;
  #endif
  if (cap) {
    col = mix(uCapDark, uCap, isTop ? .7 + .3 * noise(vL.xz * 2.5) : smoothstep(uCapDepth + wave + .08, 0., below));
    #ifdef STYLE_STONE
      if (isTop) col = mix(col, uLine, max(step(.96, fract(vL.x * .7)), step(.93, fract(vL.z * .6))) * .45);
    #endif
    #ifdef STYLE_BRICK
      if (isTop) col = mix(col, uLine, max(step(.94, fract(vL.x * .8)), step(.94, fract(vL.z * .8))) * .5);
    #endif
    #ifdef STYLE_PLANKS
      if (isTop) col = mix(col, uLine, step(.9, fract(vL.z * 1.4 + hash(vec2(floor(vL.x * .4))) * .5)) * .6);
    #endif
    #ifdef STYLE_METAL
      if (isTop) col = mix(col, uLine, max(step(.97, fract(vL.x * .5)), step(.95, fract(vL.z * .45))) * .6);
    #endif
  }
  vec3 lit = uFlat > .5 ? col * vC : toon(n, col * vC, vW);
  // A bright lip along the walkable top edge on front and side faces, so the floor line always reads.
  if (!isTop && below < uLipW) lit = mix(lit, uLip, .85);
  // Grabbable ledges: a trim bracket on the wall and front corner near each exposed top corner.
  float edgeL = vL.x - vRect.x, edgeR = vRect.y - vL.x;
  float mark = vLedge.x * step(edgeL, .34) + vLedge.y * step(edgeR, .34);
  if (mark > 0. && below < .5 && below > uLipW * .5) lit = mix(lit, uTrim, .92);
  lit += uGlow * glow;
  gl_FragColor = vec4(lit, 1.);
  #include <colorspace_fragment>
}`;

let glowCanvas: HTMLCanvasElement | null = null;

export type Kit = ReturnType<typeof createKit>;
export function createKit(scope: ResourceScope, quality: Quality, lighting: Lighting) {
  const root = new Group(), own = <T extends { dispose(): void }>(r: T) => scope.own(r), low = quality === 'low';
  const v3 = (a: readonly number[]) => new Vector3(a[0], a[1], a[2]).normalize(), amb = lighting.ambient ?? .5;
  const light: Record<string, IUniform> = {
    uKeyDir: { value: v3(lighting.keyDir) }, uKey: { value: new Color(lighting.key).multiplyScalar(lighting.keyIntensity * .62) },
    uSky: { value: new Color(lighting.sky).multiplyScalar(amb) }, uGround: { value: new Color(lighting.ground).multiplyScalar(amb * .8) },
    uRim: { value: new Color(lighting.rim) }, uRimDir: { value: v3(lighting.rimDir) },
  };
  // Scene lights for fighters and three.js materials, matched to the shader lighting above (and visible to the magnifier).
  const hemi = new HemisphereLight(lighting.sky, lighting.ground, 1.3 * amb / .5), key = new DirectionalLight(lighting.key, lighting.keyIntensity * 2), rim = new DirectionalLight(lighting.rim, 1.3);
  key.position.set(...lighting.keyDir).multiplyScalar(20); rim.position.set(...lighting.rimDir).multiplyScalar(20);
  for (const l of [hemi, key, rim]) { l.layers.enable(BUBBLE_LAYER); root.add(l); }
  const times: IUniform[] = [];

  const kit = {
    root, low, quality, scope, own, light,
    /** Counts halve on low quality. */
    n: (count: number) => low ? Math.ceil(count / 2) : count,
    add<T extends Object3D>(object: T, parent: Object3D = root): T { parent.add(object); return object; },
    /** Advance every animated shader clock. */
    time(seconds: number) { for (const t of times) t.value = seconds; },
    /** Procedural toon surface for solids and slabs. Geometry must carry aRect/aLedge (see solidGeometry). */
    surface(o: SurfaceOptions) {
      const c = (v: ColorRepresentation | undefined, fallback: ColorRepresentation) => ({ value: new Color(v ?? fallback) }), time = { value: 0 }; times.push(time);
      return own(new ShaderMaterial({
        defines: { [`STYLE_${o.style.toUpperCase()}`]: '' }, vertexShader: VERT, fragmentShader: surfaceFragment,
        uniforms: {
          ...light, uCap: c(o.cap, '#fff'), uCapDark: c(o.capDark, mix(o.cap, '#000', .25)), uFace: c(o.face, '#888'), uFaceDeep: c(o.faceDeep, mix(o.face, '#000', .5)),
          uLine: c(o.line, mix(o.face, '#000', .3)), uLip: c(o.lip, mix(o.cap, '#fff', .45)), uTrim: c(o.trim ?? o.lip, '#ffd24a'), uGlow: c(o.glow, '#000'),
          uCapDepth: { value: o.capDepth ?? .3 }, uWave: { value: o.wave ?? .4 }, uLipW: { value: o.lipWidth ?? .07 }, uScale: { value: o.scale ?? 1 }, uFlat: { value: o.flat ? 1 : 0 }, uTime: time,
        },
      }));
    },
    /** Toon-lit vertex (and instance) colors for props; haze blends toward a distance color. */
    lit(opts: { side?: typeof DoubleSide; transparent?: boolean; opacity?: number; haze?: [ColorRepresentation, number] } = {}) {
      return own(new ShaderMaterial({
        vertexColors: true, side: opts.side ?? FrontSide, transparent: !!opts.transparent, depthWrite: !opts.transparent, vertexShader: VERT,
        uniforms: { ...light, uOpacity: { value: opts.opacity ?? 1 }, uHaze: { value: new Color(opts.haze?.[0] ?? '#000') }, uHazeAmt: { value: opts.haze?.[1] ?? 0 } },
        fragmentShader: /* glsl */`uniform float uOpacity, uHazeAmt; uniform vec3 uHaze; varying vec3 vW, vL, vN, vC; ${GLSL_LIGHT}
          void main(){ vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(mix(toon(n, vC, vW), uHaze, uHazeAmt), uOpacity);
          #include <colorspace_fragment>
          }`,
      }));
    },
    /** Unlit vertex colors: silhouettes, emissive windows, retro sprites. */
    flat(opts: { transparent?: boolean; opacity?: number; additive?: boolean; side?: typeof DoubleSide; depthTest?: boolean } = {}) {
      return own(new MeshBasicMaterial({ vertexColors: true, transparent: !!(opts.transparent || opts.additive), opacity: opts.opacity ?? 1, blending: opts.additive ? AdditiveBlending : NormalBlending, depthWrite: !opts.additive && !opts.transparent, depthTest: opts.depthTest ?? true, side: opts.side ?? DoubleSide, toneMapped: false, fog: false }));
    },
    glowTexture: (() => {
      let texture: CanvasTexture | null = null;
      return () => {
        if (texture) return texture;
        if (!glowCanvas) {
          glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 128;
          const g = glowCanvas.getContext('2d')!, grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
          grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.22, 'rgba(255,255,255,.7)'); grad.addColorStop(.55, 'rgba(255,255,255,.16)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
        }
        texture = own(new CanvasTexture(glowCanvas)); texture.colorSpace = SRGBColorSpace; return texture;
      };
    })(),
    /** Additive glow sprites; fade by darkening the instance color. */
    glows(count: number, renderOrder = 5) {
      const material = own(new MeshBasicMaterial({ map: kit.glowTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
      return kit.pool(new PlaneGeometry(1, 1), material, count, renderOrder);
    },
    /** Additive streaks (meteors, wind lines, spray): bright head at +x, fading tail. */
    streaks(count: number, renderOrder = 4) {
      const material = own(new ShaderMaterial({
        transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
        vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vC; void main(){ vUv = uv; vC = vec3(1.); vec4 p = vec4(position, 1.);
          #ifdef USE_INSTANCING_COLOR
            vC = instanceColor;
          #endif
          #ifdef USE_INSTANCING
            p = instanceMatrix * p;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * p; }`,
        fragmentShader: /* glsl */`varying vec2 vUv; varying vec3 vC; void main(){ float across = 1. - abs(vUv.y * 2. - 1.);
          float a = pow(vUv.x, 2.4) * pow(across, 1.4) + smoothstep(.9, 1., vUv.x) * across * .6; gl_FragColor = vec4(vC * a, 1.); }`,
      }));
      return kit.pool(new PlaneGeometry(1, 1), material, count, renderOrder);
    },
    /** Instanced pool with a tiny transform API; unused instances collapse to zero scale. */
    pool(geometry: BufferGeometry, material: Material, count: number, renderOrder = 0, parent: Object3D = root) {
      const mesh = new InstancedMesh(own(geometry), material, Math.max(1, count)), m = new Matrix4(), q = new Quaternion(), s = new Vector3(), p = new Vector3(), e = new Vector3(0, 0, 1), c = new Color();
      mesh.frustumCulled = false; mesh.renderOrder = renderOrder; parent.add(mesh); scope.defer(() => mesh.dispose());
      const api = {
        mesh, count,
        set(i: number, x: number, y: number, z: number, sx: number, sy = sx, rot = 0, color?: ColorRepresentation | Color, intensity = 1, sz = sx) {
          q.setFromAxisAngle(e, rot); m.compose(p.set(x, y, z), q, s.set(sx, sy, sz)); mesh.setMatrixAt(i, m);
          if (color !== undefined) mesh.setColorAt(i, (color instanceof Color ? c.copy(color) : c.set(color)).multiplyScalar(intensity));
        },
        hide(i: number) { m.makeScale(0, 0, 0); mesh.setMatrixAt(i, m); },
        commit() { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; },
      };
      for (let i = 0; i < Math.max(1, count); i++) { api.hide(i); mesh.setColorAt(i, c.set('#fff')); }
      api.commit(); return api;
    },
    /** One mesh from many painted parts: one draw call. */
    batch(parts: BufferGeometry[], material: Material, parent: Object3D = root) {
      const mesh = new Mesh(own(merge(parts)), material); parent.add(mesh); return mesh;
    },
    /** A camera-following sky dome: vertical gradient, sun or moon, stars and an optional nebula band. */
    sky(o: SkyOptions) {
      const time = { value: 0 }; times.push(time);
      const material = own(new ShaderMaterial({
        depthWrite: false, depthTest: false, side: 1,
        uniforms: {
          uTop: { value: new Color(o.top) }, uMid: { value: new Color(o.mid) }, uBottom: { value: new Color(o.bottom) }, uHorizon: { value: o.horizon ?? 0 },
          uSunDir: { value: v3(o.sun?.dir ?? [0, -1, 0]) }, uSunColor: { value: new Color(o.sun?.color ?? '#000') }, uHalo: { value: new Color(o.sun?.halo ?? o.sun?.color ?? '#000') },
          uSunSize: { value: o.sun?.size ?? 0 }, uSunGlow: { value: o.sun?.glow ?? 0 },
          uStars: { value: o.stars ?? 0 }, uStarColor: { value: new Color(o.starColor ?? '#fff') }, uTime: time, uTwinkle: { value: 1 }, uDrift: { value: o.drift ?? 0 },
          uNebA: { value: new Color(o.nebula?.[0] ?? '#000') }, uNebB: { value: new Color(o.nebula?.[1] ?? '#000') }, uNeb: { value: low ? (o.nebula?.[2] ?? 0) * .6 : o.nebula?.[2] ?? 0 },
        },
        vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
        fragmentShader: /* glsl */`
          uniform vec3 uTop, uMid, uBottom, uSunDir, uSunColor, uHalo, uStarColor, uNebA, uNebB; uniform float uHorizon, uSunSize, uSunGlow, uStars, uTime, uTwinkle, uNeb, uDrift;
          varying vec3 vDir; ${GLSL_NOISE}
          void main(){
            vec3 d = normalize(vDir); float h = d.y;
            vec3 col = mix(uBottom, uMid, smoothstep(uHorizon - .25, uHorizon + .04, h));
            col = mix(col, uTop, smoothstep(uHorizon + .04, uHorizon + .38, h));
            vec2 sp = vec2(atan(d.x, -d.z) + uTime * uDrift, h);
            if (uNeb > 0.) { float nb = fbm(sp * vec2(3., 5.) + vec2(0., 2.)), band = exp(-pow((h - uHorizon - .14 - sp.x * .08) * 4., 2.));
              col += mix(uNebA, uNebB, fbm(sp * 6. + 4.)) * smoothstep(.35, .85, nb) * band * uNeb; }
            if (uStars > 0.) { vec2 uv = sp * 190., cell = floor(uv); float r = hash(cell);
              vec2 f = fract(uv) - .5 - (vec2(hash(cell + 7.1), hash(cell + 3.3)) - .5) * .5;
              float tw = mix(1., .55 + .45 * sin(uTime * (1.5 + r * 5.) + r * 60.), uTwinkle);
              float star = step(1. - .035 * uStars, r) * smoothstep(.16 + .1 * step(.998, r), .0, length(f)) * tw;
              col += uStarColor * star * smoothstep(uHorizon - .04, uHorizon + .18, h) * (.5 + r * .5); }
            if (uSunSize > 0.) { float s = max(dot(d, uSunDir), 0.);
              col += uHalo * (pow(s, 10.) * .32 + pow(s, 60.) * .5) * uSunGlow;
              col = mix(col, uSunColor, smoothstep(1. - uSunSize, 1. - uSunSize * .85, s)); }
            gl_FragColor = vec4(col, 1.);
            #include <colorspace_fragment>
          }`,
      }));
      const dome = new Mesh(own(new SphereGeometry(1000, 48, 24)), material); dome.renderOrder = -100; dome.frustumCulled = false; root.add(dome);
      return { dome, material, update(u: StageUpdate) { dome.position.copy(u.camera.position); material.uniforms.uTwinkle.value = u.reduced ? 0 : 1; } };
    },
    /** Flat backdrop silhouette from a top outline, filled down to `base`, with a vertical tint. */
    silhouette(outline: [number, number][], base: number, z: number, top: ColorRepresentation, bottom: ColorRepresentation, parent: Object3D = root) {
      const mesh = new Mesh(own(silhouetteGeometry(outline, base, z, top, bottom)), kit.flat()); parent.add(mesh); return mesh;
    },
    /** Glowing additive lane used by hazard telegraphs; uAlpha drives it. */
    column(color: ColorRepresentation, stripes = false) {
      const time = { value: 0 }; times.push(time);
      const material = own(new ShaderMaterial({
        transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, defines: stripes ? { STRIPES: '' } : {},
        uniforms: { uColor: { value: new Color(color) }, uAlpha: { value: 0 }, uTime: time, uFlow: { value: 1 }, uSize: { value: new Vector3(1, 1, 0) } },
        vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: /* glsl */`uniform vec3 uColor, uSize; uniform float uAlpha, uTime, uFlow; varying vec2 vUv; ${GLSL_NOISE}
          void main(){
            vec2 m = vUv * uSize.xy; float edge = min(min(m.x, uSize.x - m.x), min(m.y, uSize.y - m.y));
            float border = smoothstep(.16, .02, edge), streak = .45 + .55 * noise(vec2(m.x * 1.4, m.y * 1.2 - uTime * 3. * uFlow));
            float fill = .28 * streak;
            #ifdef STRIPES
              fill += .35 * step(.5, fract((m.x + m.y) * .7 - uTime * .8));
            #endif
            gl_FragColor = vec4(uColor * (border + fill) * uAlpha, 1.); }`,
      }));
      const mesh = new Mesh(own(new PlaneGeometry(1, 1)), material); mesh.renderOrder = 6; mesh.visible = false; root.add(mesh);
      return {
        mesh, material,
        /** Stretch over a zone (clamped to a visible window), at depth z. */
        place(zone: ZoneLike, z: number, alpha: number, bounds: ZoneLike) {
          const l = Math.max(zone.left, bounds.left), r = Math.min(zone.right, bounds.right), b = Math.max(zone.bottom, bounds.bottom), t = Math.min(zone.top, bounds.top);
          mesh.visible = alpha > .01 && r > l && t > b; if (!mesh.visible) return;
          mesh.position.set((l + r) / 2, (b + t) / 2, z); mesh.scale.set(r - l, t - b, 1); material.uniforms.uSize.value.set(r - l, t - b, 0); material.uniforms.uAlpha.value = alpha;
        },
      };
    },
  };
  return kit;
}
export type SkyOptions = { top: string; mid: string; bottom: string; horizon?: number; sun?: { dir: [number, number, number]; color: string; size: number; glow: number; halo?: string }; stars?: number; starColor?: string; nebula?: [string, string, number]; drift?: number };

/** Stamp a constant vertex color and drop attributes that do not merge. */
export function paint(g: BufferGeometry, color: ColorRepresentation | Color): BufferGeometry {
  const geometry = g.index ? g.toNonIndexed() : g, c = color instanceof Color ? color : new Color(color), count = geometry.attributes.position.count, data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) data.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new BufferAttribute(data, 3));
  for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'color'].includes(name)) geometry.deleteAttribute(name);
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  if (geometry !== g) g.dispose();
  return geometry;
}
/** Vertical vertex-color gradient between two y values. */
export function gradient(g: BufferGeometry, top: ColorRepresentation, bottom: ColorRepresentation, y0: number, y1: number) {
  const a = new Color(bottom), b = new Color(top), p = g.attributes.position, data = new Float32Array(p.count * 3), c = new Color();
  for (let i = 0; i < p.count; i++) { c.copy(a).lerp(b, clamp((p.getY(i) - y0) / (y1 - y0 || 1), 0, 1)); data.set([c.r, c.g, c.b], i * 3); }
  g.setAttribute('color', new BufferAttribute(data, 3)); return g;
}
const KEEP = ['position', 'normal', 'color', 'aRect', 'aLedge'];
export function merge(parts: BufferGeometry[]) {
  const ready = parts.map(g => g.attributes.color || g.attributes.aRect ? (g.index ? g.toNonIndexed() : g) : paint(g, '#fff'));
  for (const g of ready) for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name)) g.deleteAttribute(name);
  const merged = mergeGeometries(ready); if (!merged) throw new Error('Stage geometry could not be merged.');
  for (const g of ready) g.dispose();
  return merged;
}
/** Place a geometry and return it (chainable for batching). */
export const at = (g: BufferGeometry, x: number, y: number, z: number, rz = 0, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0) => {
  g.scale(sx, sy, sz); if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g;
};
export function silhouetteGeometry(outline: [number, number][], base: number, z: number, top: ColorRepresentation, bottom: ColorRepresentation) {
  const shape = new Shape(); shape.moveTo(outline[0][0], base);
  for (const [x, y] of outline) shape.lineTo(x, y);
  shape.lineTo(outline.at(-1)![0], base); shape.closePath();
  const g = new ShapeGeometry(shape, 1), hi = Math.max(...outline.map(p => p[1]));
  gradient(g, top, bottom, base, hi); g.translate(0, 0, z); return g;
}

function extrude(shape: Shape, back: number, front: number, bevel: number) {
  const g = new ExtrudeGeometry(shape, { depth: front - back - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, back + bevel); g.deleteAttribute('uv'); return g;
}
/** Tag a solid's vertices with its rect and ledge flags for the surface shader. */
export function tagSolid(g: BufferGeometry, rect: Rect, ledgeL: boolean, ledgeR: boolean) {
  const n = g.attributes.position.count, r = new Float32Array(n * 4), l = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { r.set([rect.left, rect.right, rect.top, rect.bottom], i * 4); l.set([+ledgeL, +ledgeR], i * 2); }
  g.setAttribute('aRect', new BufferAttribute(r, 4)); g.setAttribute('aLedge', new BufferAttribute(l, 2)); return g;
}
export type SolidShape = { round?: number; jag?: number; seed?: number; front?: number; back?: number; step?: number };
/**
 * A solid mass from a stack of rects (top first, each lower one's top at the previous bottom and inside its x span).
 * Every wall is exactly a collision wall; step corners and the lowest underside round and jag inward only.
 */
export function massGeometry(rects: readonly Rect[], ledgeL: boolean, ledgeR: boolean, o: SolidShape = {}) {
  const rand = rng(o.seed ?? 7), n = rects.length, s = new Shape(), first = rects[0], last = rects[n - 1];
  const stepR = (i: number, inset: number) => Math.max(0, Math.min(o.step ?? .3, (rects[i].top - rects[i].bottom) * .5, inset));
  s.moveTo(first.left, first.top); s.lineTo(first.right, first.top);
  for (let i = 0; i < n - 1; i++) {
    const a = rects[i], r = stepR(i, a.right - rects[i + 1].right);
    if (r > .01) { s.lineTo(a.right, a.bottom + r); s.quadraticCurveTo(a.right, a.bottom, a.right - r, a.bottom); }
    else s.lineTo(a.right, a.bottom);
    s.lineTo(rects[i + 1].right, a.bottom);
  }
  const h = last.top - last.bottom, w = last.right - last.left, R = Math.min(o.round ?? Math.min(h * .45, 1.4), h * .7, w / 2), jag = Math.max(0, Math.min(o.jag ?? 0, h - R - .2));
  s.lineTo(last.right, last.bottom + R); s.quadraticCurveTo(last.right, last.bottom, last.right - R, last.bottom);
  const span = w - 2 * R, steps = span > .8 ? Math.max(2, Math.round(span / .9)) : 1;
  for (let i = 1; i < steps; i++) s.lineTo(last.right - R - span * i / steps, last.bottom + (i % 2 ? rand() * jag : rand() * jag * .3));
  s.lineTo(last.left + R, last.bottom); s.quadraticCurveTo(last.left, last.bottom, last.left, last.bottom + R);
  for (let i = n - 2; i >= 0; i--) {
    const a = rects[i], r = stepR(i, rects[i + 1].left - a.left);
    s.lineTo(rects[i + 1].left, a.bottom);
    if (r > .01) { s.lineTo(a.left + r, a.bottom); s.quadraticCurveTo(a.left, a.bottom, a.left, a.bottom + r); }
    else s.lineTo(a.left, a.bottom);
  }
  s.closePath();
  const bevel = Math.min(.1, (first.top - first.bottom) * .25);
  return tagSolid(extrude(s, o.back ?? DEPTH.back, o.front ?? DEPTH.front, bevel), { left: first.left, right: first.right, top: first.top, bottom: last.bottom }, ledgeL, ledgeR);
}
/** Group static blocks into stacks: a block joins the stack whose lowest rect it sits flush under and inside. */
export function stacks<T extends Rect>(blocks: readonly T[]): T[][] {
  const out: T[][] = [], e = 1e-4;
  for (const b of [...blocks].sort((a, c) => c.top - a.top)) {
    const under = out.find(s => { const l = s[s.length - 1]; return Math.abs(l.bottom - b.top) < e && b.left >= l.left - e && b.right <= l.right + e; });
    if (under) under.push(b); else out.push([b]);
  }
  return out;
}
/** Thin one-way platform: top face exactly at local y = 0, ends exactly at ±width/2. */
export function slabGeometry(width: number, o: { thickness?: number; front?: number; back?: number; taper?: number } = {}) {
  const t = o.thickness ?? .3, w = width / 2, k = Math.min(o.taper ?? .22, w * .3), s = new Shape();
  s.moveTo(-w, 0); s.lineTo(w, 0); s.lineTo(w, -t * .45); s.lineTo(w - k, -t); s.lineTo(-w + k, -t); s.lineTo(-w, -t * .45); s.closePath();
  return tagSolid(extrude(s, o.back ?? DEPTH.slabBack, o.front ?? DEPTH.slabFront, .05), { left: -w, right: w, top: 0, bottom: -t }, false, false);
}
