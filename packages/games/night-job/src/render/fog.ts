/* The blueprint fog. Crew sight polygons are rasterised into a map-space visibility target, blurred for a
 * soft edge and eased over time; every world material samples it (onBeforeCompile) and shows the lit room where
 * it is seen and a navy blueprint where it is not. The same patch applies the baked map-space light pools. */
import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, LinearFilter, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
  Vector2, Vector4, WebGLRenderTarget, type Material, type WebGLRenderer, type IUniform, type Texture,
} from 'three';
import type { ResourceScope } from '../../../../party-runtime/src/index';
import type { HeistMap, Point } from '../model';

const PX = 16, MAX_POINTS = 2400;
export type FogOptions = {
  /** Tiles to step along the surface normal before sampling (walls borrow the room they face). */
  reach?: number; keep?: number; grid?: number; line?: number; fog?: number; floor?: number;
  /** 0 always, 1 only where seen (floor = alpha when unseen), 2 only where unseen. */
  fade?: number; top?: number; light?: number; convert?: number; tint?: string;
};
export type FogUniforms = { njA: IUniform<Vector4>; njB: IUniform<Vector4>; njC: IUniform<Vector4>; njTint: IUniform<Color> };

const VERTEX_HEAD = 'varying vec3 vNjW;\nvarying vec3 vNjN;\n';
const VERTEX_BODY = `
vec4 njW = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
njW = instanceMatrix * njW;
#endif
vNjW = (modelMatrix * njW).xyz;
#ifdef NJ_NORMAL
vNjN = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz);
#else
vNjN = vec3(0.0, 1.0, 0.0);
#endif`;
const SPIN = `
#ifdef NJ_SPIN
float njS = njSpin + instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * .9;
mat3 njR = mat3(cos(njS), 0., -sin(njS), 0., 1., 0., sin(njS), 0., cos(njS)) * mat3(1., 0., 0., 0., .5, -.866, 0., .866, .5);
#endif`;
const FRAGMENT_HEAD = `varying vec3 vNjW;\nvarying vec3 vNjN;\nuniform sampler2D njVis;\nuniform sampler2D njLight;\nuniform vec2 njMap;\nuniform float njAlarm;\nuniform vec4 njA;\nuniform vec4 njB;\nuniform vec4 njC;\nuniform vec3 njTint;\n`;
const TINT = `
#if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
{ vec3 c = vColor.rgb; float hi = max(c.r, max(c.g, c.b)), sat = hi - min(c.r, min(c.g, c.b));
  float m = (1.0 - smoothstep(.04, .12, sat)) * smoothstep(.45, .6, hi);
  diffuseColor.rgb = mix(diffuseColor.rgb, njTint * (.55 + .6 * hi), m * step(.001, distance(njTint, vec3(1.0)))); }
#endif`;
const FRAGMENT_BODY = `
vec2 njUv = (vNjW.xz + vNjN.xz * njA.x) / njMap;
float njV = texture2D(njVis, njUv).r, njTop = step(.5, njB.w) * step(.5, vNjN.y);
if (njTop > .5) {
  // Wall tops light up fully with the room beside them: sample past the wall face, clear of the blurred edge.
  vec2 o = vec2(1.3, 0.0) / njMap;
  njV = max(max(texture2D(njVis, njUv + o.xy).r, texture2D(njVis, njUv - o.xy).r), max(texture2D(njVis, njUv + o.yx).r, texture2D(njVis, njUv - o.yx).r));
}
njV = mix(1.0, njV, njB.x);
// Tops skip the baked light (dark inside walls) so they read as cut-away plaster rather than holes.
vec3 njL = mix(vec3(1.0), texture2D(njLight, (vNjW.xz + vNjN.xz * max(njA.x, .35)) / njMap).rgb * 2.0, njC.x * (1.0 - njTop));
vec3 njLit = outgoingLight * njL;
float njLum = dot(diffuseColor.rgb, vec3(.299, .587, .114));
vec3 njBp = vec3(.006, .016, .05) + vec3(.03, .075, .2) * (njLum * .8 + .12) * (.7 + .45 * max(vNjN.y, 0.0));
vec2 njF = abs(fract(vNjW.xz) - .5);
float njG = 1.0 - smoothstep(0.0, length(fwidth(vNjW.xz)) * 1.2, .5 - max(njF.x, njF.y));
vec2 njF4 = abs(fract(vNjW.xz * .25) - .5);
float njG4 = 1.0 - smoothstep(0.0, length(fwidth(vNjW.xz * .25)) * 1.2, .5 - max(njF4.x, njF4.y));
njBp += vec3(.035, .09, .24) * max(njG * .55, njG4) * njA.z;
if (njB.w > .5 && vNjN.y > .5) njBp += vec3(.02, .05, .13) * step(.8, fract((vNjW.x + vNjW.z) * 5.0));
njBp = mix(njBp, vec3(.28, .55, 1.0), njA.w);
njBp = mix(njBp, njBp * .4 + diffuseColor.rgb * .7, njA.y);
njBp = mix(njBp, vec3(njBp.b * 1.1 + .03, njBp.g * .18, njBp.b * .22), njAlarm);
float njEdge = njV * (1.0 - njV) * 4.0;
outgoingLight = mix(mix(njLit, njBp, njC.y), njLit, njV) + vec3(1.0, .75, .45) * njEdge * njEdge * .07 * njB.x * njC.y;
diffuseColor.a *= njB.z < .5 ? 1.0 : njB.z < 1.5 ? mix(njB.y, 1.0, njV) : (1.0 - njV) * njB.y;
#include <opaque_fragment>`;

export type Fog = ReturnType<typeof createFog>;
export function createFog(map: HeistMap, scope: ResourceScope, light: Texture) {
  const w = map.width * PX, h = map.height * PX;
  const target = () => scope.own(new WebGLRenderTarget(w, h, { depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter }));
  const raw = target(), mid = target(), sharp = target(), eased = [target(), target()];
  const shared = { njVis: { value: eased[0].texture as Texture }, njLight: { value: light }, njMap: { value: new Vector2(map.width, map.height) }, njAlarm: { value: 0 }, njSpin: { value: 0 } };

  // Sight polygons as triangle fans in map units; the camera maps (0..w, 0..h) to the target.
  const sightScene = new Scene(), sightCamera = new OrthographicCamera(0, map.width, map.height, 0, -1, 1), white = scope.own(new MeshBasicMaterial({ color: '#ffffff', side: DoubleSide }));
  const fans = Array.from({ length: 4 }, () => {
    const g = scope.own(new BufferGeometry()); g.setAttribute('position', new BufferAttribute(new Float32Array(MAX_POINTS * 9), 3)); g.setDrawRange(0, 0);
    const mesh = new Mesh(g, white); mesh.frustumCulled = false; sightScene.add(mesh); return mesh;
  });
  const quadScene = new Scene(), quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new Mesh(scope.own(new PlaneGeometry(2, 2)));
  quadScene.add(quad);
  const pass = (fragment: string, uniforms: Record<string, IUniform>) => scope.own(new ShaderMaterial({ uniforms, depthTest: false, depthWrite: false, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: `varying vec2 vUv;\n${fragment}` }));
  const blur = pass(`uniform sampler2D map; uniform vec2 step;
    void main() { float s = texture2D(map, vUv).r * .2270;
      s += (texture2D(map, vUv + step * 1.385).r + texture2D(map, vUv - step * 1.385).r) * .3162;
      s += (texture2D(map, vUv + step * 3.231).r + texture2D(map, vUv - step * 3.231).r) * .0703;
      gl_FragColor = vec4(vec3(s), 1.0); }`, { map: { value: null }, step: { value: new Vector2() } });
  const ease = pass(`uniform sampler2D from; uniform sampler2D to; uniform float k;
    void main() { float a = texture2D(from, vUv).r, b = texture2D(to, vUv).r; gl_FragColor = vec4(vec3(a + (b - a) * (b > a ? k : k * .6)), 1.0); }`, { from: { value: null }, to: { value: sharp.texture }, k: { value: 1 } });

  let dirty = true, easing = 0, easeK = 1, current = 0, cleared = false;
  const run = (renderer: WebGLRenderer, material: Material, to: WebGLRenderTarget) => { quad.material = material; renderer.setRenderTarget(to); renderer.render(quadScene, quadCamera); };
  return {
    shared,
    /** Replace the crew's sight polygons (one per viewer; star-shaped around its origin). */
    setSight(polygons: readonly { origin: Point; points: readonly Point[] }[]) {
      fans.forEach((mesh, i) => {
        const poly = polygons[i], attr = mesh.geometry.attributes.position as BufferAttribute, a = attr.array as Float32Array;
        let n = 0;
        if (poly) for (let j = 0, m = Math.min(poly.points.length, MAX_POINTS - 1); j < m; j++) {
          const p = poly.points[j], q = poly.points[(j + 1) % poly.points.length];
          a[n++] = poly.origin.x; a[n++] = poly.origin.y; a[n++] = 0; a[n++] = q.x; a[n++] = q.y; a[n++] = 0; a[n++] = p.x; a[n++] = p.y; a[n++] = 0;
        }
        mesh.geometry.setDrawRange(0, n / 3); attr.needsUpdate = true;
      });
      dirty = true;
    },
    /** Called from scene.onBeforeRender: re-rasterise when sight changed, then ease the shown visibility. */
    render(renderer: WebGLRenderer, dt: number, instant: boolean) {
      const previous = renderer.getRenderTarget();
      if (!cleared) { cleared = true; for (const t of [raw, mid, sharp, ...eased]) { renderer.setRenderTarget(t); renderer.setClearColor(0x000000, 1); renderer.clear(); } }
      if (dirty) {
        dirty = false; easing = .8;
        renderer.setRenderTarget(raw); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(sightScene, sightCamera);
        blur.uniforms.map.value = raw.texture; blur.uniforms.step.value.set(1 / w, 0); run(renderer, blur, mid);
        blur.uniforms.map.value = mid.texture; blur.uniforms.step.value.set(0, 1 / h); run(renderer, blur, sharp);
      }
      if (easing > 0) {
        easing -= dt; easeK = instant ? 1 : 1 - Math.exp(-dt * 14);
        ease.uniforms.from.value = eased[current].texture; ease.uniforms.k.value = easeK; current ^= 1; run(renderer, ease, eased[current]);
        shared.njVis.value = eased[current].texture;
      }
      renderer.setRenderTarget(previous);
    },
    /** Adds blueprint/lighting behaviour to a material. Returns its per-material uniforms. */
    patch<T extends Material>(material: T, o: FogOptions = {}): T {
      const own: FogUniforms = {
        njA: { value: new Vector4(o.reach ?? .12, o.keep ?? 0, o.grid ?? 0, o.line ?? 0) },
        njB: { value: new Vector4(o.fog ?? 1, o.floor ?? 0, o.fade ?? 0, o.top ?? 0) },
        njC: { value: new Vector4(o.light ?? 1, o.convert ?? 1, 0, 0) },
        njTint: { value: new Color(o.tint ?? '#ffffff') },
      };
      const normal = material.type !== 'MeshBasicMaterial';
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, shared, own);
        shader.vertexShader = (normal ? '#define NJ_NORMAL\n' : '') + VERTEX_HEAD + 'uniform float njSpin;\n' + shader.vertexShader
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>${SPIN}\n#ifdef NJ_SPIN\nobjectNormal = njR * objectNormal;\n#endif`)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef NJ_SPIN\ntransformed = njR * transformed + vec3(0., .2, 0.);\n#endif')
          .replace('#include <project_vertex>', `#include <project_vertex>${VERTEX_BODY}`);
        shader.fragmentShader = FRAGMENT_HEAD + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>${TINT}`).replace('#include <opaque_fragment>', FRAGMENT_BODY);
      };
      material.customProgramCacheKey = () => `nj${+normal}`;
      material.userData.nj = own;
      return material;
    },
  };
}

/** Map-space light: moonlit ambient, soft pools from each room's light colour and lamps, contact shade by walls. */
export function paintLight(map: HeistMap, scope: ResourceScope) {
  const S = 16, canvas = document.createElement('canvas'), g = canvas.getContext('2d')!;
  canvas.width = map.width * S; canvas.height = map.height * S;
  g.fillStyle = '#3a4668'; g.fillRect(0, 0, canvas.width, canvas.height);
  const pool = (x: number, y: number, r: number, colour: string, alpha: number) => {
    const grad = g.createRadialGradient(x * S, y * S, 0, x * S, y * S, r * S), c = new Color(colour);
    const rgba = (a: number) => `rgba(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0},${a})`;
    grad.addColorStop(0, rgba(alpha)); grad.addColorStop(.55, rgba(alpha * .45)); grad.addColorStop(1, rgba(0));
    g.fillStyle = grad; g.fillRect((x - r) * S, (y - r) * S, r * 2 * S, r * 2 * S);
  };
  for (const room of map.rooms) {
    g.save(); g.beginPath(); g.rect(room.x * S - 4, room.y * S - 4, room.w * S + 8, room.h * S + 8); g.clip();
    g.fillStyle = '#58525e'; g.fillRect(room.x * S, room.y * S, room.w * S, room.h * S);
    g.globalCompositeOperation = 'lighter';
    const nx = Math.max(1, Math.round(room.w / 4.5)), ny = Math.max(1, Math.round(room.h / 4.5));
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) pool(room.x + room.w * (i + .5) / nx, room.y + room.h * (j + .5) / ny, Math.max(room.w / nx, room.h / ny) * .85 + .8, room.light, .34);
    g.restore();
  }
  g.globalCompositeOperation = 'lighter';
  for (const p of map.props) if (p.kind === 'lamp') pool(p.x + .5, p.y + .5, 3.6, '#ffcf8a', .55);
  for (const o of map.objects) if (o.kind === 'exit') pool(o.x, o.y, 3, '#5cffb0', .35);
  // Contact shade: blurred walls multiplied in so floors darken where they meet walls.
  const shade = document.createElement('canvas'), s = shade.getContext('2d')!;
  shade.width = canvas.width; shade.height = canvas.height; s.fillStyle = '#ffffff'; s.fillRect(0, 0, shade.width, shade.height); s.fillStyle = '#48445a';
  map.tiles.forEach((row, y) => [...row].forEach((c, x) => { if ('#% '.includes(c)) s.fillRect(x * S, y * S, S, S); }));
  g.globalCompositeOperation = 'multiply'; g.filter = `blur(${S * .35}px)`; g.drawImage(shade, 0, 0); g.filter = 'none';
  const texture = scope.own(new CanvasTexture(canvas)); texture.flipY = false;
  return texture;
}
