/**
 * Fighter materials. Each fighter's meshes are merged at load into a few palette meshes whose vertices carry a material
 * slot, so one toon draw and one outline draw cover a whole fighter. Costumes, glow, rim, hit flash and dithered fading
 * are uniforms: nothing recompiles when a costume changes or a fighter vanishes.
 */
import { BackSide, Color, DataTexture, MeshBasicMaterial, MeshToonMaterial, NearestFilter, RedFormat, Vector3, type Texture } from 'three';

export const MAX_SLOTS = 16;
export type FighterUniforms = {
  uPalette: { value: Color[] }; uGlow: { value: number[] }; uEye: { value: number[] };
  uFlash: { value: Color }; uFlashAmt: { value: number }; uRimColor: { value: Color }; uRim: { value: number };
  uFade: { value: number }; uOutline: { value: number }; uOutlineColor: { value: Vector3 };
};
export const fighterUniforms = (): FighterUniforms => ({
  uPalette: { value: Array.from({ length: MAX_SLOTS }, () => new Color(1, 1, 1)) }, uGlow: { value: Array.from({ length: MAX_SLOTS }, () => 0) }, uEye: { value: Array.from({ length: MAX_SLOTS }, () => 0) },
  uFlash: { value: new Color(1, 1, 1) }, uFlashAmt: { value: 0 }, uRimColor: { value: new Color(1, 1, 1) }, uRim: { value: .22 },
  uFade: { value: 0 }, uOutline: { value: .012 }, uOutlineColor: { value: new Vector3(.08, .06, .12) },
});

/** Three light bands plus a highlight: readable forms on a TV without muddy mid-tones. */
export function toonGradient(): Texture {
  const tex = new DataTexture(new Uint8Array([92, 160, 222, 255]), 4, 1, RedFormat);
  tex.minFilter = tex.magFilter = NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  return tex;
}

const DITHER = `
float skyBayer(vec2 p) { vec2 q = mod(floor(p), 4.0); int i = int(q.x) + int(q.y) * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.); return (m[i] + .5) / 16.; }`;
const VERT_HEAD = `#include <common>
attribute float slot;
uniform vec3 uPalette[${MAX_SLOTS}];
uniform float uGlow[${MAX_SLOTS}];
varying vec3 vPal;
varying float vGlowAmt;`;

export function toonMaterial(u: FighterUniforms, gradient: Texture, opts: { translucent?: boolean } = {}) {
  const mat = new MeshToonMaterial({ color: 0xffffff, gradientMap: gradient, transparent: !!opts.translucent, opacity: opts.translucent ? .62 : 1, depthWrite: true });
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', VERT_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  int sl = int(slot + .5); vPal = uPalette[sl]; vGlowAmt = uGlow[sl];');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vPal; varying float vGlowAmt;
uniform vec3 uFlash; uniform float uFlashAmt; uniform vec3 uRimColor; uniform float uRim; uniform float uFade;${DITHER}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'if (uFade > 0.0 && uFade >= skyBayer(gl_FragCoord.xy)) discard;\n  vec4 diffuseColor = vec4( diffuse * vPal, opacity );')
      .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive + vPal * vGlowAmt;')
      .replace('#include <opaque_fragment>', `float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 4.0);
  outgoingLight += uRimColor * rimF * uRim;
  outgoingLight = mix(outgoingLight, uFlash, uFlashAmt);
  #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'sky-clash-toon' + (opts.translucent ? '-t' : '');
  return mat;
}

/** Inverted hull pushed along smoothed normals; width in model meters (set per frame from camera distance). */
export function outlineMaterial(u: FighterUniforms, opts: { translucent?: boolean } = {}) {
  const mat = new MeshBasicMaterial({ color: 0xffffff, side: BackSide, transparent: !!opts.translucent, opacity: opts.translucent ? .5 : 1 });
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 onormal; attribute float slot;
uniform vec3 uPalette[${MAX_SLOTS}]; uniform float uEye[${MAX_SLOTS}]; uniform float uOutline; uniform vec3 uOutlineColor;
varying vec3 vLine;`)
      .replace('#include <project_vertex>', `vec3 on = onormal;
  #ifdef USE_SKINNING
    on = (skinMatrix * vec4(on, 0.0)).xyz;
  #endif
  int sl = int(slot + .5);
  transformed += normalize(on) * uOutline;
  transformed *= 1.0 - step(.5, uEye[sl]);
  vLine = mix(uOutlineColor, uPalette[sl] * .3, .25);
  #include <project_vertex>`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vLine; uniform float uFade;${DITHER}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'if (uFade > 0.0 && uFade >= skyBayer(gl_FragCoord.xy)) discard;\n  vec4 diffuseColor = vec4( vLine, opacity );');
  };
  mat.customProgramCacheKey = () => 'sky-clash-outline' + (opts.translucent ? '-t' : '');
  return mat;
}
