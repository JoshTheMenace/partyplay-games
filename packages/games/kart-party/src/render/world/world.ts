/* Builds the static world for a course: sky, lights, fog, terrain, sea, track meshes, gantry,
 * scenery and night lighting (lamp halos + light pools). Everything here is owned by the world and
 * released by dispose(). */
import * as THREE from 'three';
import { clamp } from '../../sim/math';
import { sampleAt, type Track } from '../../sim/track';
import type { RaceEvent, RaceView } from '../../sim/types';
import type { KartAssets, QualityTier } from '../types';
import { buildGantry } from './gantry';
import { Geo } from './geo';
import { buildHeightfield, canyonBend, canyonWidth, type Heightfield } from './heightfield';
import { hashString } from './noise';
import { PropLibrary } from './props';
import { instanceScenery, placeScenery, type Lamp } from './scenery';
import { buildSilhouettes, environmentScene, skyMaterial, sunDirection } from './sky';
import { buildSpaceFeatures } from './space-features';
import { buildStation, placeSpaceScenery } from './space-scenery';
import { bakeSpaceSky, buildRingedPlanet, spaceEnvironment, spaceSkyMaterial } from './space-sky';
import { buildTerrain, waterMaterial } from './terrain';
import { TextureKit } from './textures';
import { THEMES, type ThemeStyle } from './theme';
import { buildTrackMeshes } from './track-mesh';

export type World = {
  group: THREE.Group; theme: ThemeStyle; sun: THREE.DirectionalLight; sunDir: THREE.Vector3; hf: Heightfield;
  sky: THREE.Mesh; fog: THREE.Fog;
  update(race: RaceView | null, time: number, events?: readonly RaceEvent[], moverTime?: number): void;
  /** GPU work that needs the renderer (Rainbow Road bakes its nebula sky); call before compiling. */
  prepare(renderer: THREE.WebGLRenderer): void;
  /** Scene captured into the PMREM environment (after prepare). */
  environment(): THREE.Scene;
  dispose(): void;
};

export function buildWorld(track: Track, assets: KartAssets, quality: QualityTier, anisotropy: number): World {
  const theme = THEMES[track.def.theme], seed = hashString(track.def.id), kit = new TextureKit(anisotropy);
  const group = new THREE.Group(); group.name = 'world';
  const hf = buildHeightfield(track, theme.terrain, seed, quality === 2 ? 6 : 4);   // space: only the camera's floor
  const water = theme.water ? waterMaterial(theme, kit) : null, space = !!theme.space;
  const center = new THREE.Vector3(); for (const s of track.samples) center.add(new THREE.Vector3(s.x, s.y, s.z)); center.divideScalar(track.samples.length);
  // Space: the star, the ringed planet and the galaxy are placed relative to the start straight.
  const h0 = track.samples[0].heading, dirAt = (az: number, el: number) => new THREE.Vector3(Math.cos(el) * Math.sin(h0 + az), Math.sin(el), Math.cos(el) * Math.cos(h0 + az));
  const planetDir = dirAt(0.42, 0.16), galaxyDir = dirAt(-1.3, 0.62);

  // Sky + lights.
  const sunDir = space ? dirAt(2.5, 0.66) : sunDirection(theme);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), space ? spaceSkyMaterial(theme, sunDir, galaxyDir) : skyMaterial(theme));
  sky.frustumCulled = false; sky.renderOrder = 1e6; sky.matrixAutoUpdate = false; group.add(sky);
  const hemi = new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity); group.add(hemi);
  const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity); sun.name = 'sun';
  sun.castShadow = quality < 2; sun.shadow.mapSize.set(quality === 0 ? 2048 : 1024, quality === 0 ? 2048 : 1024);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035; sun.shadow.radius = 3;
  const sc = sun.shadow.camera; sc.near = 1; sc.far = 260; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45;
  if (space) sun.position.copy(sunDir);
  group.add(sun, sun.target);
  const fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);

  // Ground, course, scenery.
  if (!space) group.add(buildTerrain(hf, theme, kit, seed, water), buildSilhouettes(theme, center, hf.horizon, kit, seed));
  const river = hf.canyons.length && !space ? waterMaterial(theme, kit) : null;
  if (river && !theme.water) { river.color.set(0x2f9e9c); river.opacity = 0.93; }
  if (river) group.add(riverMesh(hf, river));
  const trackMeshes = buildTrackMeshes(track, theme, hf, kit, water);
  group.add(trackMeshes.group);
  const clone = (name: string) => assets.clone(name);
  const gantry = buildGantry(track, theme, kit, clone); group.add(gantry.group);
  const lib = new PropLibrary(kit, theme.night, clone);
  const { props, lamps } = space ? { props: placeSpaceScenery(track, quality, seed), lamps: [] } : placeScenery(track, theme, hf, quality, seed);
  group.add(instanceScenery(props, lib, quality < 2 && !space));
  if (lamps.length) group.add(lampLights(track, theme, lamps, kit));
  const features = space ? buildSpaceFeatures(track, quality, lib, clone) : null;
  // A distant station for the skyline, unless the course already hangs one nearby as a landmark.
  const station = space && !track.def.landmarks.some(l => l.kind === 'space_station') ? buildStation(track, lib, center, dirAt(-2.3, 0)) : null;
  if (features) group.add(features.group, buildRingedPlanet(center, planetDir, 2600, 470, sunDir));
  if (station) group.add(station);
  let bake: THREE.WebGLCubeRenderTarget | null = null;

  return {
    group, theme, sun, sunDir, hf, sky, fog,
    prepare(renderer) {
      if (!space || bake) return;
      bake = bakeSpaceSky(renderer);
      (sky.material as THREE.ShaderMaterial).uniforms.bake.value = bake.texture;
    },
    environment: () => space && bake ? spaceEnvironment(theme, bake.texture, sunDir, galaxyDir) : environmentScene(theme),
    update(race, time, events = [], moverTime) {
      trackMeshes.pads.uniforms.time.value = time;
      features?.update(race, time, events, moverTime);
      if (station) station.rotation.y = time * 0.02;
      (sky.material as THREE.ShaderMaterial).uniforms.time.value = time;
      if (water?.normalMap) { water.normalMap.offset.set(time * 0.012, time * 0.007); }
      if (river?.normalMap) river.normalMap.offset.set(0, time * 0.09);
      if (race) gantry.update(race, time);
    },
    dispose() {
      group.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
        for (const mat of mats) mat.dispose();
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      });
      lib.dispose(); kit.dispose(); bake?.dispose();
      sun.shadow.map?.dispose();
    },
  };
}

/** The river winding along the floor of each gorge (sinks under the ground where the gorge shallows out). */
function riverMesh(hf: Heightfield, mat: THREE.MeshStandardMaterial) {
  const g = new Geo();
  for (const c of hf.canyons) {
    const n = Math.ceil((c.u1 - c.u0) / 3) + 1;
    g.grid(n, 2, (r, col, o) => {
      const u = c.u0 + (c.u1 - c.u0) * r / (n - 1), a = canyonBend(c, u) + (col ? -1 : 1) * canyonWidth(c, u) * 0.55;
      o[0] = c.x + c.ux * u + c.uz * a; o[1] = c.floor + 1; o[2] = c.z + c.uz * u - c.ux * a; o[3] = a / 14; o[4] = u / 14;
    });
  }
  const mesh = new THREE.Mesh(g.build()!, mat); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Night lighting without real lights: additive halos at lamp heads and soft pools on the road. */
function lampLights(track: Track, theme: ThemeStyle, lamps: Lamp[], kit: TextureKit) {
  const group = new THREE.Group(), glow = kit.glow(), warm = new THREE.Color(theme.night ? 0xffd9a0 : 0xfff0d0);
  const pts = new Float32Array(lamps.length * 3);
  lamps.forEach((l, i) => { pts[i * 3] = l.x; pts[i * 3 + 1] = l.y + 7.1; pts[i * 3 + 2] = l.z; });
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const halos = new THREE.Points(pg, new THREE.PointsMaterial({ map: glow, color: warm.clone().multiplyScalar(1.4), size: 5, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
  halos.frustumCulled = false; group.add(halos);
  if (theme.night) {
    const g = new Geo(), R = 7.5;
    for (const l of lamps) {
      const s0 = sampleAt(track, l.d);
      g.grid(5, 5, (r, c, o) => {
        const s = sampleAt(track, l.d + (r - 2) / 2 * R), lat = l.lateral + (c - 2) / 2 * R;
        o[0] = s.x + s.rx * lat; o[1] = s.y - clamp(lat, -s.halfWidth, s.halfWidth) * Math.tan(s.bank) + 0.03; o[2] = s.z + s.rz * lat; o[3] = c / 4; o[4] = r / 4;
      });
      void s0;
    }
    const pool = new THREE.Mesh(g.build()!, new THREE.MeshBasicMaterial({ map: glow, color: warm.clone().multiplyScalar(0.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    pool.renderOrder = 2; group.add(pool);
  }
  return group;
}
