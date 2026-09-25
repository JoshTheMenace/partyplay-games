/**
 * World shaders. One uniform set is shared by the opaque, cutout and translucent chunk materials, the sky and the
 * clouds; `setTime`/`update` write it once per frame.
 */
import { Color, ShaderMaterial, Vector3, Vector4, type DataArrayTexture, type IUniform } from 'three';
import { AMBIENT, NETHER_AMBIENT, NETHER_FOG_DENSITY, NETHER_FOG_FAR, NETHER_FOG_NEAR, SKY_GLSL, TORCH_LIGHT, type Rgb } from './environment';
import { VF_FIRE, VF_LAVA, VF_LEAVES, VF_PLANT, VF_PORTAL, VF_SURFACE, VF_WATER, VF_WIRE } from './types';

/** Point glows (fireballs, primed TNT) that add warm light to nearby terrain. */
export const GLOWS = 4;

export type WorldUniforms = {
  uAtlas: IUniform<DataArrayTexture>;
  uTime: IUniform<number>;
  uSunDir: IUniform<Vector3>;
  uZenith: IUniform<Color>;
  uHorizon: IUniform<Color>;
  uDuskColor: IUniform<Color>;
  uDusk: IUniform<number>;
  uDay: IUniform<number>;
  uStars: IUniform<number>;
  uAngle: IUniform<number>;
  uSkyLight: IUniform<Color>;
  uTorch: IUniform<Color>;
  /** Current animation frame layers. */
  uWaterLayer: IUniform<number>;
  uLavaLayer: IUniform<number>;
  uPortalLayer: IUniform<number>;
  uFireLayer: IUniform<number>;
  uFogNear: IUniform<number>;
  uFogFar: IUniform<number>;
  uUnderwater: IUniform<number>;
  uWaterFog: IUniform<Color>;
  /** 0 overworld … 1 Nether (eased while travelling). */
  uNether: IUniform<number>;
  /** xyz position, w radius (0 = off) and colour of each glow. */
  uGlow: IUniform<Vector4[]>;
  uGlowColor: IUniform<Color[]>;
};

export const createUniforms = (atlas: DataArrayTexture): WorldUniforms => ({
  uAtlas: { value: atlas }, uTime: { value: 0 }, uSunDir: { value: new Vector3(0, 1, 0) },
  uZenith: { value: new Color() }, uHorizon: { value: new Color() }, uDuskColor: { value: new Color(1, 0.36, 0.1) }, uDusk: { value: 0 },
  uDay: { value: 1 }, uStars: { value: 0 }, uAngle: { value: 0 }, uSkyLight: { value: new Color(1, 1, 1) }, uTorch: { value: new Color(...TORCH_LIGHT) },
  uWaterLayer: { value: 0 }, uLavaLayer: { value: 0 }, uPortalLayer: { value: 0 }, uFireLayer: { value: 0 },
  uFogNear: { value: 60 }, uFogFar: { value: 96 }, uUnderwater: { value: 0 }, uWaterFog: { value: new Color(0.02, 0.07, 0.18) }, uNether: { value: 0 },
  uGlow: { value: Array.from({ length: GLOWS }, () => new Vector4(0, -100, 0, 0)) }, uGlowColor: { value: Array.from({ length: GLOWS }, () => new Color(0, 0, 0)) },
});

const vec3 = (c: Rgb) => `vec3(${c.map(v => v.toFixed(5)).join(', ')})`;
const GLOWING = VF_LAVA | VF_PORTAL | VF_FIRE;

const VERTEX = /* glsl */ `
in vec4 uvl;
in vec4 lt;
uniform float uTime;
uniform float uWaterLayer;
uniform float uLavaLayer;
uniform float uPortalLayer;
uniform float uFireLayer;
out vec3 vTex;
out vec4 vLight;
out vec3 vWorld;
flat out int vFlags;

void main() {
  int flags = int(uvl.w + 0.5);
  vec4 world = modelMatrix * vec4(position, 1.0);
  if ((flags & ${VF_LEAVES}) != 0) {
    float p = world.x * 0.6 + world.z * 0.4 + world.y * 0.3;
    world.xyz += vec3(sin(uTime * 1.7 + p), sin(uTime * 2.1 + p * 1.7) * 0.5, cos(uTime * 1.3 + p * 1.3)) * 0.022;
  }
  if ((flags & ${VF_PLANT}) != 0) {
    float p = world.x * 0.35 + world.z * 0.55;
    if ((flags & ${VF_FIRE}) != 0) {
      // Flame tips flicker: fast, small and out of step between neighbouring planes.
      p = world.x * 3.1 + world.z * 2.3;
      world.xyz += vec3(sin(uTime * 9.0 + p), sin(uTime * 7.0 + p * 1.3) * 1.5, cos(uTime * 11.0 + p * 0.7)) * 0.035;
    } else world.xz += vec2(sin(uTime * 1.9 + p), sin(uTime * 1.5 + p * 1.7)) * 0.05 + sin(uTime * 0.7 + p * 0.2) * vec2(0.035, 0.02);
  }
  if ((flags & ${VF_SURFACE}) != 0) {
    float p = world.x * 0.9 + world.z * 0.7;
    world.y -= (flags & ${VF_LAVA}) != 0 ? 0.03 + 0.018 * sin(uTime * 0.7 + p) : 0.045 + 0.04 * sin(uTime * 1.6 + p);
  }
  float layer = uvl.z;
  if ((flags & ${VF_WATER}) != 0) layer = uWaterLayer;
  else if ((flags & ${VF_LAVA}) != 0) layer = uLavaLayer;
  else if ((flags & ${VF_PORTAL}) != 0) layer = uPortalLayer;
  else if ((flags & ${VF_FIRE}) != 0) layer = uFireLayer;
  vTex = vec3(uvl.xy / 4096.0, layer);
  vLight = lt;
  vWorld = world.xyz;
  vFlags = flags;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FRAGMENT = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform vec3 uSkyLight;
uniform vec3 uTorch;
uniform float uFogNear;
uniform float uFogFar;
uniform float uUnderwater;
uniform vec3 uWaterFog;
uniform vec4 uGlow[${GLOWS}];
uniform vec3 uGlowColor[${GLOWS}];
in vec3 vTex;
in vec4 vLight;
in vec3 vWorld;
flat in int vFlags;
${SKY_GLSL}

void main() {
  vec4 tex;
  if ((vFlags & ${VF_PORTAL}) != 0) {
    // Portal swirl: a slow wave through the tiling texture (explicit gradients avoid seams where fract wraps).
    vec2 swirl = vec2(sin(vWorld.y * 1.7 + uTime * 1.3 + vWorld.x), cos(vWorld.y * 1.3 - uTime * 1.1 + vWorld.z)) * 0.06;
    tex = textureGrad(uAtlas, vec3(fract(vTex.xy + swirl), vTex.z), dFdx(vTex.xy), dFdy(vTex.xy));
  } else tex = texture(uAtlas, vTex);
#ifdef CUTOUT
  // Keep thin leaves and plants from dissolving in the distance: boost alpha as the mip level rises.
  vec2 footprint = fwidth(vTex.xy * 16.0);
  float lod = max(0.0, log2(max(footprint.x, footprint.y)));
  if (tex.a * (1.0 + lod * 0.4) < 0.5) discard;
#endif
  float skyLevel = lightCurve(vLight.x);
  vec3 light = max(skyLevel * uSkyLight, lightCurve(vLight.y) * uTorch) + mix(vec3(${AMBIENT}), ${vec3(NETHER_AMBIENT)}, uNether);
  for (int k = 0; k < ${GLOWS}; k++) {
    vec3 d = vWorld - uGlow[k].xyz;
    float f = max(0.0, 1.0 - dot(d, d) / max(uGlow[k].w * uGlow[k].w, 1e-4));
    light += uGlowColor[k] * f * f;
  }
  float shade = pow(vLight.z, 1.6);
  if ((vFlags & ${VF_WIRE}) != 0) {
    // Redstone dust: the texture's brightness tinted from dark red (unpowered) to bright red-orange (power 15), MC's ramp.
    float p = vLight.w;
    vec3 dust = vec3(p > 0.0 ? 0.4 + 0.6 * p : 0.3, max(0.0, p * p * 0.7 - 0.5), max(0.0, p * p * 0.6 - 0.7));
    tex.rgb = max(tex.r, max(tex.g, tex.b)) * pow(dust, vec3(2.2));
    light = max(light, vec3(0.3 * p));
  }
  if ((vFlags & ${GLOWING}) != 0) {
    // Lava, fire and portals light themselves (sky light never tints them); lava's crust shimmers slowly.
    light = vec3(1.0);
    shade = mix(shade, 1.0, 0.65);
    if ((vFlags & ${VF_LAVA}) != 0) {
      // A lava sea must not read as a grid: far lava fades to its tile's average colour (no texel pattern or moiré), and
      // darker drifting crust patches tens of blocks across (warped sines, so no lattice) vary it.
      vec2 footprint = fwidth(vTex.xy * 16.0);
      tex.rgb = mix(tex.rgb, textureLod(uAtlas, vTex, 4.0).rgb, smoothstep(0.5, 2.0, log2(max(max(footprint.x, footprint.y), 1e-3))));
      float crust = sin(vWorld.x * 0.19 + sin(vWorld.z * 0.13) * 2.0 + uTime * 0.05) * sin(vWorld.z * 0.23 + sin(vWorld.x * 0.11) * 2.0 - uTime * 0.04);
      shade *= (0.9 + 0.1 * sin(vWorld.x * 1.3 + uTime * 0.9) * sin(vWorld.z * 1.7 - uTime * 0.7)) * (0.7 + 0.3 * crust);
    }
  }
  vec3 color = tex.rgb * light * shade;
  float alpha = 1.0;
  vec3 toFrag = vWorld - cameraPosition;
  vec3 view = normalize(toFrag);
#ifdef TRANSLUCENT
  alpha = tex.a * ((vFlags & ${VF_PORTAL}) != 0 ? 0.78 : 0.82);
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if ((vFlags & ${VF_WATER}) != 0 && abs(normal.y) > 0.7 && uUnderwater < 0.5 && view.y < 0.0) {
    // Water surface: sky reflection by Fresnel and a sun glint, both only where the sky reaches.
    vec3 ripple = normalize(vec3(
      sin(vWorld.x * 3.1 + uTime * 2.0) * 0.035 + sin(vWorld.z * 4.3 - uTime * 1.7) * 0.025, 1.0,
      cos(vWorld.z * 2.7 + uTime * 1.8) * 0.035 + cos(vWorld.x * 3.7 - uTime * 1.3) * 0.025));
    vec3 reflected = reflect(view, ripple);
    float fresnel = 0.03 + 0.97 * pow(1.0 - max(dot(-view, ripple), 0.0), 5.0);
    vec3 sky = skyColor(reflected) * (0.25 + 0.75 * skyLevel);
    color = mix(color, sky, fresnel * 0.85);
    alpha = mix(alpha, 1.0, fresnel * 0.7);
    color += vec3(1.0, 0.9, 0.7) * pow(max(dot(reflected, uSunDir), 0.0), 350.0) * 5.0 * uDay * skyLevel;
  }
#endif
  float fog;
  vec3 haze;
  if (uUnderwater > 0.5) {
    fog = 1.0 - exp(-length(toFrag) * 0.08);
    haze = uWaterFog * (0.15 + 0.85 * uSkyLight);
    color *= vec3(0.4, 0.65, 1.0);
  } else {
    fog = smoothstep(uFogNear, uFogFar, length(toFrag.xz));
    haze = fogColor(view);
    if (uNether > 0.0) {
      // Nether: dense haze that deepens from dark to brighter red with distance.
      float thick = max(fog, 1.0 - exp(-length(toFrag) * ${NETHER_FOG_DENSITY}));
      fog = mix(fog, thick, uNether);
      haze = mix(haze, mix(${vec3(NETHER_FOG_NEAR)}, ${vec3(NETHER_FOG_FAR)}, thick), uNether);
    }
  }
  gl_FragColor = vec4(mix(color, haze, fog), alpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

export type WorldMaterials = readonly [opaque: ShaderMaterial, cutout: ShaderMaterial, translucent: ShaderMaterial];

export function createWorldMaterials(uniforms: WorldUniforms): WorldMaterials {
  const make = (define: string | null, transparent = false) => new ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, defines: define ? { [define]: 1 } : {}, transparent,
  });
  return [make(null), make('CUTOUT'), make('TRANSLUCENT', true)];
}
