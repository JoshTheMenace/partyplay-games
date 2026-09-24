/* Terrain mesh from the heightfield (vertex-coloured by height, slope, shoreline and course
 * distance, multiplied by a detail texture), a flat frame out to the horizon, and the sea. */
import * as THREE from 'three';
import { clamp, smoothstep } from '../../sim/math';
import type { Heightfield } from './heightfield';
import { fbm } from './noise';
import type { TextureKit } from './textures';
import type { ThemeStyle } from './theme';

export function waterMaterial(theme: ThemeStyle, kit: TextureKit) {
  const normal = kit.waterNormal(); normal.repeat.set(1, 1);
  return new THREE.MeshStandardMaterial({ color: theme.water?.color ?? 0x2aa8d8, roughness: 0.08, metalness: 0.05, normalMap: normal, normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.86, envMapIntensity: 1.2 });
}

export function buildTerrain(hf: Heightfield, theme: ThemeStyle, kit: TextureKit, seed: number, water: THREE.MeshStandardMaterial | null): THREE.Group {
  const group = new THREE.Group(); group.name = 'terrain';
  const { nx, nz, cell, minX, minZ, h, out } = hf, T = theme.terrain;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  const c = { low: new THREE.Color(T.low), mid: new THREE.Color(T.mid), high: new THREE.Color(T.high), rock: new THREE.Color(T.rock), shore: new THREE.Color(T.shore), top: new THREE.Color(T.top) };
  const deep = new THREE.Color(theme.water?.deep ?? 0x0a4f8e), tmp = new THREE.Color(), level = theme.water?.level ?? -Infinity;
  const H = (gx: number, gz: number) => h[clamp(gz, 0, nz - 1) * nx + clamp(gx, 0, nx - 1)];
  for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
    const k = gz * nx + gx, x = minX + gx * cell, z = minZ + gz * cell, y = h[k];
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; uv[k * 2] = x / 9; uv[k * 2 + 1] = z / 9;
    const slope = Math.hypot(H(gx + 1, gz) - H(gx - 1, gz), H(gx, gz + 1) - H(gx, gz - 1)) / (2 * cell);
    const patch = fbm(x / 60, z / 60, seed + 5, 3), rel = T.amp > 0 ? clamp((y - (hf.horizon - T.amp * 0.18)) / T.amp, 0, 1.4) : 0;
    tmp.copy(c.low).lerp(c.mid, smoothstep(0.1, 0.45, rel + (patch - 0.5) * 0.35)).lerp(c.high, smoothstep(0.55, 1.0, rel + (patch - 0.5) * 0.2));
    if (T.sea) tmp.lerp(c.low, Math.max(1 - smoothstep(3, 9, out[k]), 1 - smoothstep(level + 0.9, level + 1.9, y), smoothstep(0.62, 0.7, patch)));  // sand by the course, on the beach and in patches
    else tmp.lerp(c.low, (1 - smoothstep(3, 16, out[k])) * 0.7);
    tmp.lerp(c.rock, smoothstep(0.7, 1.2, slope) * (T.ridged && T.amp > 50 ? 0.75 : 1));
    if (T.ridged && T.amp > 50) tmp.lerp(c.top, smoothstep(0.75, 1.1, rel) * (1 - smoothstep(0.6, 1.0, slope)));
    if (y < level + 0.6) tmp.copy(c.shore).lerp(deep, smoothstep(level, level - 9, y));
    // Fake occlusion: trenches and gorges darken with depth below the course's lowest road.
    const shade = (0.93 + patch * 0.14) * (T.sea ? 1 : 1 - 0.4 * smoothstep(3, 26, hf.base - y));
    col[k * 3] = tmp.r * shade; col[k * 3 + 1] = tmp.g * shade; col[k * 3 + 2] = tmp.b * shade;
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); let p = 0;
  for (let gz = 0; gz < nz - 1; gz++) for (let gx = 0; gx < nx - 1; gx++) {
    const a = gz * nx + gx, b = a + 1, d = a + nx, e = d + 1;
    // Rows run +z, columns +x: (a, d, b) winds counter-clockwise seen from above.
    idx[p++] = a; idx[p++] = d; idx[p++] = b; idx[p++] = b; idx[p++] = d; idx[p++] = e;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals(); g.computeBoundingSphere();
  const detail = kit.detail();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.96, metalness: 0, envMapIntensity: 0.6 });
  // Triplanar detail: planar UVs smear into streaks on cliffs and gorge walls.
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTriPos; varying vec3 vTriNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTriPos = (modelMatrix * vec4(position, 1.0)).xyz; vTriNrm = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTriPos; varying vec3 vTriNrm;')
      .replace('#include <map_fragment>', `vec3 triW = pow(abs(normalize(vTriNrm)), vec3(4.0)); triW /= triW.x + triW.y + triW.z;
        diffuseColor *= texture2D(map, vTriPos.zy / 9.0) * triW.x + texture2D(map, vTriPos.xz / 9.0) * triW.y + texture2D(map, vTriPos.xy / 9.0) * triW.z;`);
  };
  mat.customProgramCacheKey = () => 'terrain-triplanar';
  const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; group.add(mesh);

  // Flat frame from the heightfield border out to the horizon at the border height.
  const x0 = minX, z0 = minZ, x1 = minX + (nx - 1) * cell, z1 = minZ + (nz - 1) * cell, F = 6000, y = hf.horizon;
  const edgeCol = new THREE.Color(T.sea ? theme.water?.deep ?? T.low : T.amp > 0 ? T.mid : T.low).lerp(new THREE.Color(theme.fog.color), 0.15);
  const fp = [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, x0 - F, y, z0 - F, x1 + F, y, z0 - F, x1 + F, y, z1 + F, x0 - F, y, z1 + F];
  const frame = new THREE.BufferGeometry();
  frame.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  frame.setAttribute('uv', new THREE.Float32BufferAttribute(fp.flatMap((v, i) => i % 3 === 0 ? [v / 9] : i % 3 === 2 ? [v / 9] : []), 2));
  frame.setIndex([0, 1, 4, 1, 5, 4, 1, 2, 5, 2, 6, 5, 2, 3, 6, 3, 7, 6, 3, 0, 7, 0, 4, 7]); frame.computeVertexNormals();
  const frameMesh = new THREE.Mesh(frame, new THREE.MeshStandardMaterial({ color: edgeCol, map: detail, roughness: 1 }));
  frameMesh.receiveShadow = false; frameMesh.matrixAutoUpdate = false; group.add(frameMesh);
  if (water && theme.water) {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), water);
    sea.rotation.x = -Math.PI / 2; sea.position.set((x0 + x1) / 2, theme.water.level, (z0 + z1) / 2); sea.updateMatrix(); sea.matrixAutoUpdate = false; sea.renderOrder = 1;
    sea.receiveShadow = true; group.add(sea);
    water.normalMap!.repeat.set(9000 / 14, 9000 / 14);
  }
  return group;
}
