/* Sky dome (gradient, sun/moon, drifting clouds, stars), the distant silhouette ring that hides the
 * terrain edge, and the PMREM environment captured from that sky. */
import * as THREE from 'three';
import { hash2, noise2, ridged } from './noise';
import type { ThemeStyle } from './theme';
import type { TextureKit } from './textures';

const smooth = (a: number, b: number, n: number) => { const t = Math.min(1, Math.max(0, (n - a) / (b - a))); return t * t * (3 - 2 * t); };

export function sunDirection(theme: ThemeStyle) {
  const el = theme.sun.elevation * Math.PI / 180, az = theme.sun.azimuth * Math.PI / 180;
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

export function skyMaterial(theme: ThemeStyle, forEnv = false) {
  const s = theme.sky, c = (n: number) => new THREE.Color(n);
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: c(s.top) }, horizon: { value: c(s.horizon) }, bottom: { value: c(s.bottom) }, sunDir: { value: sunDirection(theme) },
      sunColor: { value: c(s.sunColor) }, cloudColor: { value: c(s.cloudColor) }, sunSize: { value: s.sunSize }, glow: { value: s.glow },
      clouds: { value: forEnv ? s.clouds * 0.6 : s.clouds }, stars: { value: forEnv ? 0 : s.stars }, time: { value: 0 }, disk: { value: forEnv ? 0.35 : 1 },
    },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = position; vec4 p = projectionMatrix * vec4(mat3(modelViewMatrix) * position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 top, horizon, bottom, sunDir, sunColor, cloudColor; uniform float sunSize, glow, clouds, stars, time, disk; varying vec3 vDir;
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += vnoise(p) * a; p = p * 2.03 + 17.1; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir); float y = d.y, sd = max(dot(d, sunDir), 0.0);
        vec3 col = y > 0.0 ? mix(horizon, top, 1.0 - pow(1.0 - clamp(y, 0.0, 1.0), 4.0)) : mix(horizon, bottom, smoothstep(0.0, -0.2, y));
        col += sunColor * glow * (pow(sd, 6.0) * 0.45 + pow(sd, 48.0) * 0.6);
        col = mix(col, sunColor * 4.0, smoothstep(sunSize, sunSize + 0.00025, sd) * disk);
        if (y > 0.0 && clouds > 0.0) {
          vec2 uv = d.xz / (y + 0.14) * 1.35 + vec2(time * 0.006, time * 0.0025);
          float n = fbm(uv), cover = 1.0 - clouds * 0.62;
          float c = smoothstep(cover, cover + 0.22, n) * smoothstep(0.0, 0.2, y);
          float shade = mix(0.72, 1.08, smoothstep(cover, cover + 0.35, fbm(uv + sunDir.xz * 0.06)));
          vec3 cc = cloudColor * shade + sunColor * pow(sd, 5.0) * 0.35;
          col = mix(col, cc, c * 0.92);
        }
        if (stars > 0.0 && y > 0.02) {
          vec3 p = d * 260.0; vec3 cell = floor(p); float h = h21(cell.xy + cell.z * 7.13);
          float star = step(0.9965, h) * smoothstep(0.02, 0.25, y) * (0.55 + 0.45 * sin(time * 2.0 + h * 90.0));
          col += vec3(0.9, 0.92, 1.0) * star * stars * 1.4;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Two rings of distant silhouettes (mountains, mesas, islands or a lit skyline) around the course. */
export function buildSilhouettes(theme: ThemeStyle, center: THREE.Vector3, base: number, kit: TextureKit, seed: number): THREE.Group {
  const group = new THREE.Group(); group.name = 'silhouettes';
  const sil = theme.silhouettes, horizon = new THREE.Color(theme.fog.color);
  const rings = sil.kind === 'skyline' ? [{ r: 820, tint: 0.2, scale: 1 }, { r: 1250, tint: 0.5, scale: 1.4 }] : [{ r: 1150, tint: 0.35, scale: 1 }, { r: 1700, tint: 0.6, scale: 1.6 }];
  rings.forEach((ring, ri) => {
    const N = sil.kind === 'skyline' ? 260 : 220, pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
    const bodyCol = new THREE.Color(ri ? sil.far : sil.near).lerp(horizon, ring.tint), capCol = new THREE.Color(sil.cap).lerp(horizon, ring.tint * 0.8), foot = horizon.clone();
    let bh = 0;
    const heightAt = (i: number) => {
      const a = i / N, u = a * 24 + ri * 50;
      switch (sil.kind) {
        case 'peaks': return (ridged(u * 0.55, ri * 3.1, seed, 4) * 1.4 - 0.1) * 230 * ring.scale + 40;
        case 'mesas': { const n = noise2(u * 0.7, ri * 7, seed), plateau = n > 0.52 ? 1 : n > 0.44 ? (n - 0.44) / 0.08 : 0; return (plateau * (70 + noise2(u * 0.2, 3, seed) * 60) + noise2(u * 3, 1, seed) * 10 + 8) * ring.scale; }
        case 'islands': { const n = noise2(u * 0.5, ri * 5, seed + 3); return Math.max(0, n - 0.45) * 330 * ring.scale; }
        default: { if (i % Math.max(1, Math.floor(1 + hash2(i, ri, seed) * 3)) === 0) bh = (30 + hash2(i, ri + 9, seed) ** 2 * 150) * ring.scale; return bh; }
      }
    };
    for (let i = 0; i <= N; i++) {
      const a = i / N * Math.PI * 2, x = center.x + Math.sin(a) * ring.r, z = center.z + Math.cos(a) * ring.r, h = heightAt(i % N);
      // Three rows (haze foot, body, crest) so snow caps only tint the upper part of each peak.
      const ySkirt = base - 60, yMid = base + h * 0.62, yTop = base + h, k = pos.length / 3, u = i * ring.r * Math.PI * 2 / N / 36;
      const capMix = sil.kind === 'peaks' ? smooth(120, 200, h / ring.scale) : sil.kind === 'islands' ? 1 : 0, top = bodyCol.clone().lerp(capCol, capMix);
      pos.push(x, ySkirt, z, x, yMid, z, x, yTop, z);
      col.push(foot.r, foot.g, foot.b, bodyCol.r, bodyCol.g, bodyCol.b, top.r, top.g, top.b);
      uv.push(u, (ySkirt - base) / 72, u, (yMid - base) / 72, u, h / 72);
      if (i < N) for (const r of [0, 1]) idx.push(k + r, k + 3 + r, k + 1 + r, k + 1 + r, k + 3 + r, k + 4 + r);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const skyline = sil.kind === 'skyline';
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, map: skyline ? kit.windows(40 + ri, 0.4) : null, color: skyline ? new THREE.Color(ri ? 1.6 : 2.4, ri ? 1.6 : 2.4, ri ? 1.9 : 2.6) : 0xffffff });
    if (skyline) { const cols = g.getAttribute('color') as THREE.BufferAttribute; for (let i = 0; i < cols.count; i++) { const c = i % 3 ? bodyCol : foot; cols.setXYZ(i, c.r * 0.6 + 0.12, c.g * 0.6 + 0.1, c.b * 0.6 + 0.16); } }
    const mesh = new THREE.Mesh(g, m); mesh.renderOrder = -10; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; group.add(mesh);
  });
  return group;
}

/** Scene used only to capture the PMREM environment: the sky, plus neon glows for night courses. */
export function environmentScene(theme: ThemeStyle): THREE.Scene {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMaterial(theme, true)); scene.add(sky);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.hemi.ground).multiplyScalar(0.55) }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -2; scene.add(ground);
  if (theme.night) {
    const cols = [0xff2bd6, 0x19e6ff, 0x7a5cff, 0xff2bd6, 0x19e6ff, 0x7a5cff];
    cols.forEach((c, i) => { const a = i / cols.length * Math.PI * 2, q = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.6), side: THREE.DoubleSide })); q.position.set(Math.sin(a) * 8, 1.4 + (i % 2), Math.cos(a) * 8); q.lookAt(0, 1, 0); scene.add(q); });
  }
  return scene;
}
