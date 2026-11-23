/** The Reaches light rig: sky and ground fill, a warm shadow-casting key and a strong back rim. One description per stage (and the labs). */
import { Color, DirectionalLight, HemisphereLight, type Object3D } from 'three';
import type { Quality } from '../../../../../party-3d/src/index';

export type LightSpec = {
  sky: string; ground: string; fill: number;
  /** Directions point from the subject toward the light. */
  key: { color: string; intensity: number; dir: [number, number, number] }; rim: { color: string; intensity: number; dir: [number, number, number] };
  /** Rectangle of the gameplay plane the shadow map must cover, in meters. */
  shadow: { left: number; right: number; bottom: number; top: number };
  /** The sky the metal reflects; `sun` scales the key light's disc in it (default 1). */
  env: { top: string; horizon: string; ground: string; sun?: number };
};
export function createLights(root: Object3D, spec: LightSpec, quality: Quality = 'balanced') {
  const hemi = new HemisphereLight(new Color(spec.sky), new Color(spec.ground), spec.fill), key = new DirectionalLight(new Color(spec.key.color), spec.key.intensity), rim = new DirectionalLight(new Color(spec.rim.color), spec.rim.intensity);
  const s = spec.shadow, cx = (s.left + s.right) / 2, cy = (s.bottom + s.top) / 2, half = Math.max(s.right - s.left, s.top - s.bottom) / 2 + 2, far = 60;
  key.position.set(cx + spec.key.dir[0] * 30, cy + spec.key.dir[1] * 30, spec.key.dir[2] * 30); key.target.position.set(cx, cy, 0);
  rim.position.set(cx + spec.rim.dir[0] * 30, cy + spec.rim.dir[1] * 30, spec.rim.dir[2] * 30); rim.target.position.set(cx, cy, 0);
  key.castShadow = true; key.shadow.mapSize.setScalar(quality === 'low' ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far }); key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -.0006; key.shadow.normalBias = .03; key.shadow.radius = quality === 'low' ? 1 : 2.5;
  root.add(hemi, key, key.target, rim, rim.target);
  return { hemi, key, rim, dispose() { for (const o of [hemi, key, key.target, rim, rim.target]) o.removeFromParent(); key.shadow.map?.dispose(); key.dispose(); rim.dispose(); hemi.dispose(); } };
}
/** Storm over the Bellyard: cold light from the front, and the furnaces behind throw a hot rim on everything. */
export const STORM: LightSpec = { sky: '#7f9cc4', ground: '#4a3026', fill: 1.0, key: { color: '#d2e2ff', intensity: 2.9, dir: [-.4, .75, .6] }, rim: { color: '#ff9a55', intensity: 2.3, dir: [.3, .3, -.9] },
  shadow: { left: -13, right: 13, bottom: -6, top: 10 }, env: { top: '#1a2638', horizon: '#6a5058', ground: '#241c20', sun: .2 } };
/** Dusk on Beacon Rock: low amber sun from the front left, cool sky from above, a cold-white rim from behind. */
export const DUSK: LightSpec = { sky: '#8fb2ff', ground: '#5a4636', fill: 1.15, key: { color: '#ffd9a8', intensity: 3.1, dir: [-.45, .7, .62] }, rim: { color: '#bfe0ff', intensity: 2.6, dir: [.35, .55, -.85] },
  shadow: { left: -12, right: 12, bottom: -6, top: 10 }, env: { top: '#3b4f9c', horizon: '#f2b488', ground: '#2a2433' } };
