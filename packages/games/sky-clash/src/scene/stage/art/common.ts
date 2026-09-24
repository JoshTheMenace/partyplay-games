/** Helpers shared by stage modules: palette lighting, far layers, drifting clouds and a generic fallback. */
import { AdditiveBlending, Color, Mesh, PlaneGeometry, ShaderMaterial, SphereGeometry, type BufferGeometry, type ColorRepresentation, type Material } from 'three';
import type { Palette } from '../../../stages';
import { GLSL_NOISE, at, gradient, mix, rng, type Kit, type Lighting, type StageUpdate } from '../kit';
import { puff } from '../decor';
import type { StageModule } from '../index';

export const lightingFrom = (p: Palette, o: Partial<Lighting> = {}): Lighting => ({
  sky: p.light, ground: p.skyBottom, key: '#fff4e0', keyIntensity: 1.2, keyDir: [.4, .85, .6], rim: p.accent, rimDir: [-.5, .35, -1], ambient: .55, ...o,
});
/** Decorative clock: slowed to a crawl under reduced motion. */
export const clock = (u: StageUpdate) => u.reduced ? u.seconds * .08 : u.seconds;

/** Drifting cloud banks at a depth band, instanced, wrapping around the camera. */
export function cloudBank(k: Kit, o: { seed: number; count: number; z: [number, number]; y: [number, number]; s: [number, number]; speed: number; top: ColorRepresentation; bottom: ColorRepresentation; haze: [ColorRepresentation, number]; width?: number; height?: number; span?: number }) {
  const r = rng(o.seed), span = o.span ?? 200, count = k.n(o.count);
  const items = Array.from({ length: count }, () => ({ x: -span / 2 + r() * span, y: o.y[0] + r() * (o.y[1] - o.y[0]), z: o.z[0] + r() * (o.z[1] - o.z[0]), s: o.s[0] + r() * (o.s[1] - o.s[0]), v: .6 + r() * .6 }));
  const pool = k.pool(puff(o.seed, o.width ?? 9, o.height ?? 2.2, o.top, o.bottom, 7, k.low ? 0 : 1), k.lit({ haze: o.haze }), count, -20);
  return (u: StageUpdate) => {
    const t = clock(u);
    items.forEach((c, i) => {
      const x = ((c.x + t * o.speed * c.v + span / 2) % span + span) % span - span / 2 + u.camera.position.x * .3;
      pool.set(i, x, c.y + Math.sin(t * .2 + i) * .3, c.z, c.s, c.s * .9, 0, undefined, 1, c.s);
    });
    pool.commit();
  };
}
/** A far horizontal plane (sea, lava lake, cloud sea, city glow) with a toon noise shader. */
export function farPlane(k: Kit, o: { y: number; lit: ColorRepresentation; mid: ColorRepresentation; shade: ColorRepresentation; horizon: ColorRepresentation; scale?: [number, number]; speed?: number; glow?: number; bands?: [number, number] }) {
  const material = k.own(new ShaderMaterial({
    uniforms: { uLit: { value: new Color(o.lit) }, uMid: { value: new Color(o.mid) }, uShade: { value: new Color(o.shade) }, uHorizon: { value: new Color(o.horizon) }, uTime: { value: 0 },
      uScale: { value: o.scale ?? [.018, .034] }, uSpeed: { value: o.speed ?? .012 }, uBands: { value: o.bands ?? [.46, .64] }, uDetail: { value: k.low ? 0 : 1 } },
    vertexShader: /* glsl */`varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`uniform vec3 uLit, uMid, uShade, uHorizon; uniform float uTime, uSpeed, uDetail; uniform vec2 uScale, uBands; varying vec3 vW; ${GLSL_NOISE}
      void main(){
        vec2 p = vW.xz * uScale + vec2(uTime * uSpeed, 0.);
        float c = noise(p) * .55 + noise(p * 2.3 + 7.) * .3 + noise(p * 5.1 - uTime * uSpeed * 2.) * .15 * uDetail;
        vec3 col = mix(uShade, uMid, smoothstep(uBands.x - .03, uBands.x + .03, c)); col = mix(col, uLit, smoothstep(uBands.y - .03, uBands.y + .03, c));
        col = mix(col, uHorizon, smoothstep(60., 650., length(vW.xz - cameraPosition.xz)));
        gl_FragColor = vec4(col, 1.);
        #include <colorspace_fragment>
      }`,
  }));
  const mesh = k.add(new Mesh(k.own(new PlaneGeometry(3000, 3000)), material)); mesh.rotation.x = -Math.PI / 2; mesh.position.y = o.y; mesh.renderOrder = -50;
  return (u: StageUpdate) => { material.uniforms.uTime.value = clock(u); mesh.position.x = u.camera.position.x; };
}
/** Silhouette layers that parallax with the camera (moved by a fraction of camera x). */
export function parallax(k: Kit, layers: { geo: BufferGeometry; follow: number }[]) {
  const meshes = layers.map(l => ({ mesh: k.add(new Mesh(k.own(l.geo), k.flat())), follow: l.follow }));
  for (const m of meshes) m.mesh.renderOrder = -40;
  return (u: StageUpdate) => { for (const m of meshes) m.mesh.position.x = u.camera.position.x * m.follow; };
}

/** Palette-only art for stages without a bespoke module yet. */
export const generic = (family = 'sky'): StageModule => ({
  lighting: { sky: '#e8e1ff', ground: '#6b3d8f', key: '#fff4e0', keyIntensity: 1.2, keyDir: [.4, .85, .6], rim: '#ffb347', rimDir: [-.5, .35, -1], ambient: .55 },
  ground: { style: family === 'space' ? 'crystal' : 'rock', cap: '#f4e6cc', face: '#c98f78', faceDeep: '#43256b' },
  build(k, { stage }) {
    const p = stage.palette, sky = k.sky({ top: p.skyTop, mid: p.skyBottom, bottom: mix(p.skyBottom, p.fog, .5).getStyle(), horizon: -.05, stars: .3 });
    const clouds = cloudBank(k, { seed: 3, count: 8, z: [-60, -90], y: [-14, 10], s: [1.4, 2.4], speed: .4, top: p.light, bottom: p.fog, haze: [p.fog, .5] });
    return u => { sky.update(u); clouds(u); };
  },
});
/** An additive spiral disc (vortex, galaxy, warp tunnel mouth) facing the camera at depth z. */
export function swirl(k: Kit, o: { x: number; y: number; z: number; radius: number; inner: ColorRepresentation; outer: ColorRepresentation; arms?: number; twist?: number; speed?: number; strength?: number }) {
  const material = k.own(new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uIn: { value: new Color(o.inner) }, uOut: { value: new Color(o.outer) }, uTime: { value: 0 }, uArms: { value: o.arms ?? 3 }, uTwist: { value: o.twist ?? 5 }, uK: { value: o.strength ?? 1 } },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv * 2. - 1.; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`uniform vec3 uIn, uOut; uniform float uTime, uArms, uTwist, uK; varying vec2 vUv; ${GLSL_NOISE}
      void main(){
        float r = length(vUv), a = atan(vUv.y, vUv.x);
        float arm = sin(a * uArms + log(r + .02) * uTwist - uTime), n = noise(vec2(a * 3. + uTime * .1, r * 6. - uTime * .3));
        float v = smoothstep(.1, .9, arm * .5 + .5) * (.55 + .45 * n) * smoothstep(1., .25, r) + smoothstep(.35, 0., r) * .9;
        gl_FragColor = vec4(mix(uIn, uOut, smoothstep(0., .8, r)) * v * uK, 1.);
      }`,
  }));
  const mesh = k.add(new Mesh(k.own(new PlaneGeometry(o.radius * 2, o.radius * 2)), material)); mesh.position.set(o.x, o.y, o.z); mesh.renderOrder = -60;
  return { mesh, material, update(u: StageUpdate) { material.uniforms.uTime.value = clock(u) * (o.speed ?? .15); } };
}
/** Floating pieces drifting at several depths, bobbing and turning slowly: [x, y, z, scale]. */
export function drifters(k: Kit, geo: BufferGeometry, haze: [ColorRepresentation, number], spots: readonly (readonly [number, number, number, number])[], bob = .5) {
  const pool = k.pool(geo, k.lit({ haze }), spots.length, -30);
  return (u: StageUpdate) => {
    const t = clock(u);
    spots.forEach(([x, y, z, s], i) => pool.set(i, x + Math.sin(t * .05 + i) * 2, y + Math.sin(t * .3 + i * 1.7) * bob, z, s, s, Math.sin(t * .1 + i) * .08));
    pool.commit();
  };
}
/** A scrolling waterfall or light curtain: vertical plane with streaked foam. */
export function curtain(k: Kit, o: { x: number; y: number; z: number; w: number; h: number; light: ColorRepresentation; dark: ColorRepresentation; speed?: number; alpha?: number }) {
  const material = k.own(new ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uLight: { value: new Color(o.light) }, uDark: { value: new Color(o.dark) }, uTime: { value: 0 }, uSpeed: { value: o.speed ?? 1 }, uAlpha: { value: o.alpha ?? 1 }, uAspect: { value: o.w / o.h } },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`uniform vec3 uLight, uDark; uniform float uTime, uSpeed, uAlpha, uAspect; varying vec2 vUv; ${GLSL_NOISE}
      void main(){ vec2 p = vec2(vUv.x * uAspect * 6., vUv.y * 3. + uTime * uSpeed);
        float s = noise(vec2(p.x, p.y * .35)) * .6 + noise(p * vec2(2., .8)) * .4, wob = noise(vec2(vUv.y * 8. + uTime * uSpeed, 1.)) * .06;
        float edge = smoothstep(wob, .14 + wob, vUv.x) * smoothstep(1. - wob, .86 - wob, vUv.x) * smoothstep(1., .9, vUv.y) * smoothstep(0., .12, vUv.y);
        vec3 col = mix(uDark, uLight, smoothstep(.45, .6, s)); col = mix(col, vec3(1.), smoothstep(.75, .8, s) * .6);
        gl_FragColor = vec4(col, uAlpha * edge);
        #include <colorspace_fragment>
      }`,
  }));
  const mesh = k.add(new Mesh(k.own(new PlaneGeometry(o.w, o.h)), material)); mesh.position.set(o.x, o.y, o.z); mesh.renderOrder = -35;
  return (u: StageUpdate) => { material.uniforms.uTime.value = clock(u); };
}
/** Rounded toon hills (or dunes, snowbanks) as one batched lit mesh: [x, y, z, width, height]. */
export function hills(k: Kit, spots: readonly (readonly [number, number, number, number, number])[], top: ColorRepresentation, bottom: ColorRepresentation, haze: [ColorRepresentation, number], extra: BufferGeometry[] = []) {
  const parts = spots.map(([x, y, z, w, h]) => gradient(at(new SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), x, y, z, 0, w / 2, h, Math.min(w, 30) * .25), top, bottom, y, y + h));
  const mesh = k.batch([...parts, ...extra], k.lit({ haze })); mesh.renderOrder = -40; return mesh;
}
/** Falling or rising particles (rain, snow, embers, petals) around the camera, as additive streaks. */
export function particles(k: Kit, o: { count: number; color: ColorRepresentation; speed: [number, number]; drift?: number; size: [number, number]; z: [number, number]; spread?: [number, number]; seed?: number; intensity?: number }) {
  const r = rng(o.seed ?? 31), count = k.n(o.count), streaks = k.streaks(count, 8), [w, h] = o.spread ?? [40, 26];
  const items = Array.from({ length: count }, () => ({ x: r() * w, y: r() * h, z: o.z[0] + r() * (o.z[1] - o.z[0]), v: o.speed[0] + r() * (o.speed[1] - o.speed[0]), s: o.size[0] + r() * (o.size[1] - o.size[0]), p: r() * 6 }));
  const angle = Math.atan2(o.speed[0] < 0 ? 1 : -1, o.drift ?? 0);
  return (u: StageUpdate) => {
    const t = u.reduced ? 0 : u.seconds, cx = u.camera.position.x - w / 2, cy = u.camera.position.y - h / 2;
    items.forEach((p, i) => {
      const y = ((p.y - t * p.v) % h + h) % h, x = ((p.x + t * (o.drift ?? 0) + Math.sin(t + p.p) * .3) % w + w) % w;
      streaks.set(i, cx + x, cy + y, p.z, p.s, p.s * .12 + .03, angle, o.color, o.intensity ?? .6);
    });
    streaks.commit();
  };
}
/** Twinkling glow points (fireflies, sparkles, city lights): [x, y, z, size]. */
export function sparkles(k: Kit, spots: readonly (readonly [number, number, number, number])[], color: ColorRepresentation, intensity = .8) {
  const glows = k.glows(spots.length, 3);
  return (u: StageUpdate) => {
    const t = clock(u);
    spots.forEach(([x, y, z, s], i) => glows.set(i, x + Math.sin(t * .7 + i) * .3, y + Math.sin(t * .9 + i * 2) * .3, z, s * (.75 + .25 * Math.sin(t * 3 + i * 1.3)), undefined, 0, color, intensity));
    glows.commit();
  };
}
/** Deterministic spots scattered in a box: [x, y, z, size]. */
export const scatter = (seed: number, count: number, x: [number, number], y: [number, number], z: [number, number], s: [number, number]) => {
  const r = rng(seed); return Array.from({ length: count }, () => [x[0] + r() * (x[1] - x[0]), y[0] + r() * (y[1] - y[0]), z[0] + r() * (z[1] - z[0]), s[0] + r() * (s[1] - s[0])] as const);
};
/** A decor layer built as three copies of one tile (tile(shift) must repeat every `span`), so it can scroll forever along x or y. */
export function looped(k: Kit, tile: (shift: number) => BufferGeometry, span: number, material: Material, axis: 0 | 1 = 0, renderOrder = -40) {
  const mesh = k.batch([-1, 0, 1].map(i => tile(i * span)), material); mesh.renderOrder = renderOrder;
  return { mesh, set(offset: number, base = 0) { mesh.position.setComponent(axis, base - (((offset % span) + span) % span)); } };
}
