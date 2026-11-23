/**
 * Crew fighter models: one GLB per fighter (tools/blender/crew), parsed once per page. Its per-slot primitives are merged into a single
 * skinned mesh whose vertices carry a palette slot, and one lit material draws it: palette x baked paint map, tangent normals and a
 * pattern mask from the detail map, per-slot roughness, metalness and emission. Costumes, rim, flash and fade are uniforms.
 */
import { BufferAttribute, Color, MeshStandardMaterial, ShaderChunk, SkinnedMesh, Vector4, type BufferGeometry, type Mesh, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Quality } from '../../../../../party-3d/src/index';
import type { CrewKind } from '../../crew/roster';
import { keyedLoader } from '../fighter/queue';

export const MAX_SLOTS = 20;
/** Costume written by the model pipeline: base colour and pattern colour per material slot. */
export type CrewCostume = { name: string; colors: Record<string, string>; patterns?: Record<string, string> };
type SlotMeta = { name: string; rough: number; metal: number; spec: number; glow: number };
export type CrewModel = { kind: CrewKind; scene: Object3D; slots: SlotMeta[]; paint: Texture; detail: Texture; costumes: CrewCostume[]; triangles: number };

const URLS = import.meta.glob('../../../assets/fighters/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const COSTUMES = import.meta.glob('../../../assets/costumes/*.json', { eager: true, import: 'default' }) as Record<string, CrewCostume[]>;
const META = import.meta.glob('../../../assets/models/*.json', { eager: true, import: 'default' }) as Record<string, { slots?: SlotMeta[] } | undefined>;
export const crewCostumes = (kind: CrewKind): CrewCostume[] => COSTUMES[`../../../assets/costumes/${kind}.json`] ?? [];

/** Merge every primitive of the skinned body into one geometry with a `slot` attribute (index into the model's slot list). */
export function prepareCrew(kind: CrewKind, scene: Object3D, slots: SlotMeta[], costumes: CrewCostume[]): CrewModel {
  scene.updateMatrixWorld(true);
  const meshes: SkinnedMesh[] = []; scene.traverse(o => { if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh); });
  if (!meshes.length) throw new Error(`The ${kind} model has no skinned mesh.`);
  const first = meshes[0], mat0 = first.material as MeshStandardMaterial, paint = mat0.map, detail = mat0.normalMap;
  if (!paint || !detail) throw new Error(`The ${kind} model is missing its baked maps.`);
  const parts: BufferGeometry[] = meshes.map(mesh => {
    const name = (mesh.material as MeshStandardMaterial).name.replace(/\.\d+$/, ''), slot = Math.max(0, slots.findIndex(s => s.name === name)), g = mesh.geometry.clone();
    for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(key)) g.deleteAttribute(key);
    g.setAttribute('slot', new BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(slot), 1)); return g;
  });
  const merged = mergeGeometries(parts, false); if (!merged) throw new Error(`The ${kind} model could not be merged.`);
  merged.computeBoundingSphere(); merged.computeBoundingBox();
  const body = new SkinnedMesh(merged); body.name = 'crew-body'; body.frustumCulled = false; body.bind(first.skeleton, first.bindMatrix);
  first.parent!.add(body);
  for (const mesh of meshes) { mesh.removeFromParent(); mesh.geometry.dispose(); }
  for (const g of parts) g.dispose();
  return { kind, scene, slots, paint, detail, costumes, triangles: (merged.index?.count ?? merged.getAttribute('position').count) / 3 };
}
const loader = keyedLoader<CrewKind, CrewModel>(async (kind, signal) => {
  const url = URLS[`../../../assets/fighters/${kind}.glb`];
  if (!url) throw new Error(`Sky Clash is missing the ${kind} model.`);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not download the ${kind} model (${response.status}).`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), url.slice(0, url.lastIndexOf('/') + 1));
  return prepareCrew(kind, gltf.scene, META[`../../../assets/models/${kind}.json`]?.slots ?? [], crewCostumes(kind));
});
export const loadCrewModels = (kinds: readonly CrewKind[], signal: AbortSignal) => loader.load(kinds, signal);

// ── Material ─────────────────────────────────────────────────────────────
export type CrewUniforms = {
  uBase: { value: Color[] }; uPat: { value: Color[] }; uSurf: { value: Vector4[] }; uDetail: { value: Texture | null };
  uFlash: { value: Color }; uFlashAmt: { value: number }; uRimColor: { value: Color }; uRim: { value: number }; uFade: { value: number }; uGlow: { value: number }; uLift: { value: number };
};
export const crewUniforms = (model: CrewModel): CrewUniforms => ({
  uBase: { value: Array.from({ length: MAX_SLOTS }, () => new Color(1, 1, 1)) }, uPat: { value: Array.from({ length: MAX_SLOTS }, () => new Color(1, 1, 1)) },
  uSurf: { value: Array.from({ length: MAX_SLOTS }, (_, i) => { const s = model.slots[i]; return new Vector4(s?.rough ?? .8, s?.metal ?? 0, s?.glow ?? 0, s?.spec ?? .3); }) }, uDetail: { value: model.detail },
  uFlash: { value: new Color(1, 1, 1) }, uFlashAmt: { value: 0 }, uRimColor: { value: new Color(.7, .85, 1) }, uRim: { value: .5 }, uFade: { value: 0 }, uGlow: { value: 1 }, uLift: { value: 1 },
});
/** Costume colours into the palette uniforms (unknown slots keep white). */
export function applyCostume(model: CrewModel, u: CrewUniforms, costume: number) {
  const c = model.costumes[costume] ?? model.costumes[0];
  model.slots.forEach((s, i) => { if (i >= MAX_SLOTS) return; u.uBase.value[i].set(c?.colors[s.name] ?? '#ffffff'); u.uPat.value[i].set(c?.patterns?.[s.name] ?? c?.colors[s.name] ?? '#ffffff'); });
}
const DITHER = `float crewBayer(vec2 p) { vec2 q = mod(floor(p), 4.0); int i = int(q.x) + int(q.y) * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.); return (m[i] + .5) / 16.; }`;
export function crewMaterial(model: CrewModel, u: CrewUniforms, quality: Quality = 'balanced') {
  const mat = new MeshStandardMaterial({ color: 0xffffff, map: model.paint, normalMap: quality === 'low' ? null : model.detail, envMapIntensity: 1 });
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute float slot; uniform vec3 uBase[${MAX_SLOTS}]; uniform vec3 uPat[${MAX_SLOTS}]; uniform vec4 uSurf[${MAX_SLOTS}];
varying vec3 vBase; varying vec3 vPat; varying vec4 vSurf;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  int sl = int(slot + .5); vBase = uBase[sl]; vPat = uPat[sl]; vSurf = uSurf[sl];');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vBase; varying vec3 vPat; varying vec4 vSurf; uniform sampler2D uDetail;
uniform vec3 uFlash; uniform float uFlashAmt; uniform vec3 uRimColor; uniform float uRim; uniform float uFade; uniform float uGlow; uniform float uLift;
${DITHER}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'if (uFade > 0.0 && uFade >= crewBayer(gl_FragCoord.xy)) discard;\n  vec4 diffuseColor = vec4( diffuse, opacity );')
      // Palette x paint (0.5 is neutral), with the pattern colour where the detail map's blue channel says so.
      // Emission is added here, after the slot colour is known, so a lantern glows amber and a wind-bead mint (not the material's white).
      .replace('#include <map_fragment>', 'vec3 paintTex = texture2D( map, vMapUv ).rgb; float maskTex = texture2D( uDetail, vMapUv ).b;\n  diffuseColor.rgb = mix( vBase, vPat, maskTex ) * paintTex * 2.0;\n  totalEmissiveRadiance += diffuseColor.rgb * vSurf.z * uGlow;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp( vSurf.x * mix( 1.18, .82, paintTex.g ), .04, 1.0 );')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y;')
      .replace('#include <normal_fragment_maps>', ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        'vec3 mapN = vec3( texture2D( normalMap, vNormalMapUv ).xy * 2.0 - 1.0, 0.0 ); mapN.z = sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) );'))
      // Only emissive slots may exceed white (and so bloom): lit metal and pale cloth are held just under it.
      .replace('#include <opaque_fragment>', `outgoingLight = mix( min( outgoingLight * uLift, vec3( .98 ) ), outgoingLight, step( .01, vSurf.z ) );
  float rimF = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.2 );
  outgoingLight += uRimColor * rimF * uRim * ( .55 + .45 * normal.y ) * ( 1.0 - .6 * metalnessFactor );
  outgoingLight = mix( outgoingLight, uFlash, uFlashAmt );
  #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'sky-clash-crew-' + quality;
  return mat;
}
export type { Mesh };
