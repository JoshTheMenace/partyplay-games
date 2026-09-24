/* Rainbow Road ribbon, built from the same rows as every other course so it sits exactly where the
 * physics drives: seven glossy emissive colour bands with flowing light pulses and sparkle, dark glass
 * aprons, a glowing underside + soft halo so the ribbon reads against space from above and below,
 * energy guard rails on wall edges, bright lines on drop edges and chasing marker lights. No pillars. */
import * as THREE from 'three';
import { forwardDistance, sampleAt, type Track, type TrackSample } from '../../sim/track';
import { onLoopFootprint } from '../loop';
import { Geo } from './geo';
import { buildSpaceLoops } from './space-loop';
import { NOISE_GLSL, RAINBOW_GLSL } from './space-sky';

type Put = (o: number[], s: TrackSample, lat: number, dy: number, u: number, v: number) => void;
export type RibbonCtx = {
  track: Track; rows: number[]; R: TrackSample[]; H: number; time: { value: number };
  skipGap(r: number): boolean; put: Put; edgeOf(s: TrackSample, side: -1 | 1): number; kindOf(s: TrackSample, side: -1 | 1): 'wall' | 'drop';
};
const THICK = 0.45;
const FOG_ADD = /* glsl */`#ifdef USE_FOG
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth); gl_FragColor.rgb *= 1.0 - fogFactor;
  #endif`;

/** Standard-lit material with shader hooks (keeps env reflections, sun specular and kart shadows). */
function hooked(params: THREE.MeshStandardMaterialParameters, key: string, time: { value: number }, map: string, emissive: string) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRb;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRb = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vRb; uniform float uTime;\n${NOISE_GLSL}\n${RAINBOW_GLSL}`)
      .replace('#include <map_fragment>', map).replace('#include <emissivemap_fragment>', emissive);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

/** Unlit glow shader (fog-aware; additive variants fade to black in fog instead of to the fog colour). */
function glow(fragment: string, opts: { additive?: boolean; colors?: boolean; time: { value: number } }) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]), fog: true, side: THREE.DoubleSide, vertexColors: !!opts.colors,
    transparent: !!opts.additive, depthWrite: !opts.additive, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: `varying vec2 vUv; varying vec3 vCol;
      #include <fog_pars_vertex>
      void main() { vUv = uv; vCol = vec3(1.0);
        #ifdef USE_COLOR
          vCol = color;
        #endif
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vCol; ${RAINBOW_GLSL}
      #include <fog_pars_fragment>
      void main() { ${fragment}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        ${opts.additive ? FOG_ADD : '#include <fog_fragment>'}
      }`,
  });
}

export function buildSpaceRibbon(c: RibbonCtx): THREE.Group {
  const { track, rows, R, put, edgeOf, kindOf, skipGap, H, time } = c, group = new THREE.Group(); group.name = 'rainbow-ribbon';
  const road = hooked({ color: 0xffffff, roughness: 0.55, metalness: 0, envMapIntensity: 0.22 }, 'rainbow-road', time, `
      float u = vRb.x, v = vRb.y, f = fract(u * 7.0);
      vec3 band = rainbow(u);
      float seam = smoothstep(0.0, 0.05, f) * smoothstep(1.0, 0.95, f);
      diffuseColor.rgb = band * mix(0.02, 0.08, seam);`, `
      float ch = fract(v / 26.0 - abs(u - 0.5) * 0.8 - uTime * 0.8), pulse = smoothstep(0.0, 0.035, ch) * smoothstep(0.22, 0.035, ch);
      float flow = 0.5 + 0.5 * sin(v * 0.6 - uTime * 6.0 + u * 4.0);
      vec2 sc = vec2(u * 60.0, v * 1.6), cell = floor(sc), fp = fract(sc) - 0.5 - (vec2(h21(cell + 3.1), h21(cell + 7.7)) - 0.5) * 0.5;
      float sh = h21(cell), tw = step(0.8, sh) * pow(max(0.0, sin(uTime * (2.0 + 3.0 * sh) + sh * 70.0)), 6.0);
      float spark = tw * smoothstep(0.3, 0.0, length(fp * vec2(1.0, 2.0)));
      totalEmissiveRadiance = band * (0.4 * seam + 0.05 + pulse * 0.9 + flow * 0.06) + vec3(spark) * 2.6;`);
  const apron = hooked({ color: 0xffffff, roughness: 0.18, metalness: 0.2, envMapIntensity: 1.3 }, 'rainbow-apron', time, `
      vec2 g = abs(fract(vRb / vec2(1.2, 3.0)) - 0.5);
      float line = smoothstep(0.47, 0.5, max(g.x, g.y));
      diffuseColor.rgb = vec3(0.035, 0.02, 0.09) + vec3(0.06, 0.03, 0.14) * line;`, `
      vec2 sc = vRb * vec2(3.0, 1.5), cell = floor(sc), fp = fract(sc) - 0.5;
      float sh = h21(cell), tw = step(0.86, sh) * pow(max(0.0, sin(uTime * (1.5 + 2.0 * sh) + sh * 50.0)), 4.0);
      vec2 gg = abs(fract(vRb / vec2(1.2, 3.0)) - 0.5);
      totalEmissiveRadiance = vec3(0.1, 0.05, 0.3) * smoothstep(0.46, 0.5, max(gg.x, gg.y)) * 0.6 + vec3(0.8, 0.7, 1.0) * tw * smoothstep(0.25, 0.0, length(fp)) * 1.6;`);
  const pulseGlsl = `float p = fract(vUv.y / 26.0 - uTime * 0.8), pulse = smoothstep(0.0, 0.035, p) * smoothstep(0.22, 0.035, p);`;
  const under = glow(`${pulseGlsl} gl_FragColor = vec4(rainbow(clamp(vUv.x, 0.0, 0.999)) * (0.26 + 0.34 * pulse), 1.0);`, { time });
  const halo = glow(`${pulseGlsl} float a = vCol.r * vCol.r; gl_FragColor = vec4(rainbow(clamp(vUv.x, 0.0, 0.999)) * a * (0.3 + 0.35 * pulse), 1.0);`, { additive: true, colors: true, time });
  const rail = glow(`vec3 c = hue(fract(vUv.x / 110.0 - uTime * 0.04)) * 0.85 + 0.15;
      float a = 0.035 + 0.55 * pow(vUv.y, 7.0) + 0.16 * pow(1.0 - vUv.y, 5.0);
      float scan = smoothstep(0.86, 1.0, fract(vUv.x / 4.0 - uTime * 1.5)) * 0.3 * (1.0 - vUv.y * 0.6);
      float hexes = smoothstep(0.42, 0.5, abs(fract(vUv.x / 1.1 + (fract(vUv.y * 3.0) > 0.5 ? 0.5 : 0.0)) - 0.5)) * 0.08;
      gl_FragColor = vec4(c * (a + scan + hexes), 1.0);`, { additive: true, time });
  const bar = glow(`gl_FragColor = vec4((hue(fract(vUv.x / 110.0 - uTime * 0.04)) * 0.9 + 0.15) * 1.25, 1.0);`, { time });
  const edge = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 2.1, 2.6), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const m of [under, halo, rail, bar]) m.uniforms.uTime = time;
  const geos = new Map<THREE.Material, Geo>(), geo = (m: THREE.Material) => { let g = geos.get(m); if (!g) geos.set(m, g = new Geo()); return g; };
  const across = (s: TrackSample, lat: number) => (lat + s.halfWidth) / (2 * s.halfWidth);

  // Road: one quad column per colour band. Aprons: dark glass either side.
  geo(road).grid(rows.length, 8, (r, col, o) => { const s = R[r], lat = (col / 7 * 2 - 1) * s.halfWidth; put(o, s, lat, 0, col / 7, rows[r]); }, skipGap);
  for (const side of [-1, 1] as const) geo(apron).grid(rows.length, 2, (r, col, o) => {
    const s = R[r], a = side * s.halfWidth, b = edgeOf(s, side), lat = side < 0 ? (col ? a : b) : (col ? b : a); put(o, s, lat, -0.005, lat, rows[r]);
  }, skipGap);
  // Underside, side fascia and the halo below: the ribbon glows from every angle.
  geo(under).grid(rows.length, 4, (r, col, o) => {
    const s = R[r], lat = [edgeOf(s, 1), s.halfWidth, -s.halfWidth, edgeOf(s, -1)][col];
    put(o, s, lat, -THICK, across(s, lat), rows[r]);
  }, skipGap);
  for (const side of [-1, 1] as const) geo(under).grid(rows.length, 2, (r, col, o) => { const s = R[r], e = edgeOf(s, side); put(o, s, e, col ? 0 : -THICK, side < 0 ? 0 : 0.999, rows[r]); }, skipGap);
  const haloCol = [new THREE.Color(0, 0, 0), new THREE.Color(1, 0, 0), new THREE.Color(1, 0, 0), new THREE.Color(0, 0, 0)];
  geo(halo).grid(rows.length, 4, (r, col, o) => {
    const s = R[r], lats = [edgeOf(s, -1) - 7, edgeOf(s, -1), edgeOf(s, 1), edgeOf(s, 1) + 7], lat = lats[col];
    put(o, s, lat, -THICK - 0.35, across(s, lat), rows[r]);
  }, skipGap, (_r, col) => haloCol[col]);

  // Edges: energy fence + bright bar on walls, glowing lip line on drops.
  const lights: number[] = [], lightD: number[] = [];
  for (const side of [-1, 1] as const) {
    const wall = (r: number) => kindOf(R[r], side) === 'wall' && kindOf(R[r + 1], side) === 'wall' && !skipGap(r);
    const drop = (r: number) => kindOf(R[r], side) === 'drop' && kindOf(R[r + 1], side) === 'drop' && !skipGap(r);
    const at = (r: number, extra: number, dy: number, o: number[], u: number, v: number) => { const s = R[r]; put(o, s, edgeOf(s, side) + side * extra, dy, u, v); };
    geo(rail).grid(rows.length, 2, (r, col, o) => at(r, 0, col ? H : -THICK, o, rows[r], col ? 1 : 0), r => !wall(r));
    geo(bar).grid(rows.length, 2, (r, col, o) => at(r, side < 0 ? (col ? -0.02 : 0.22) : (col ? 0.22 : -0.02), H, o, rows[r], 0), r => !wall(r));
    geo(bar).grid(rows.length, 2, (r, col, o) => at(r, -0.02, col ? H : H - 0.14, o, rows[r], 0), r => !wall(r));
    geo(edge).grid(rows.length, 2, (r, col, o) => at(r, side < 0 ? (col ? -0.38 : 0) : (col ? 0 : -0.38), 0.02, o, 0, 0), r => !drop(r));
    // Marker lights every 2.5 m: on top of rails, and just inside drop lips.
    for (let d = 1; d < track.length; d += 2.5) {
      const s = sampleAt(track, d), k = kindOf(s, side);
      if (track.gaps.some(g => forwardDistance(track, g.d0, d) < forwardDistance(track, g.d0, g.d1)) || onLoopFootprint(track, d)) continue;
      const lat = edgeOf(s, side) - side * (k === 'wall' ? 0.1 : 0.2), y = s.y - Math.max(-s.halfWidth, Math.min(s.halfWidth, lat)) * Math.tan(s.bank) + (k === 'wall' ? H + 0.08 : 0.12);
      lights.push(s.x + s.rx * lat, y, s.z + s.rz * lat); lightD.push(d + (k === 'wall' ? 0 : 1000));
    }
  }
  // Gap lips: the ribbon ends in a bright line and a glowing cut face.
  for (const g of track.gaps) for (const [d, dir] of [[g.d0, 1], [g.d1, -1]] as const) {
    const s = sampleAt(track, d), s2 = sampleAt(track, d - dir * 0.45), l = edgeOf(s, -1), rr = edgeOf(s, 1);
    geo(under).grid(2, 2, (row, col, o) => put(o, s, col ? rr : l, row ? 0 : -THICK, across(s, col ? rr : l), d));
    const [a, b] = dir > 0 ? [s2, s] : [s, s2];
    geo(edge).grid(2, 2, (row, col, o) => { const ss = row ? b : a; put(o, ss, col ? edgeOf(ss, 1) : edgeOf(ss, -1), 0.02, 0, 0); });
  }
  group.add(buildSpaceLoops({ track, H, thick: THICK, mats: { road, apron, under, rail, bar }, geo, edgeOf, lights, lightD, glow: f => { const m = glow(f, { time }); m.uniforms.uTime = time; return m; } }));
  for (const [m, g] of geos) {
    const built = g.build(); if (!built) continue;
    const mesh = new THREE.Mesh(built, m); mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = m === road || m === apron;
    if (m === halo || m === rail) mesh.renderOrder = 3;
    group.add(mesh);
  }
  group.add(markerLights(lights, lightD, time));
  return group;
}

/** Instanced billboard glows: chasing marker lights along the edges (d ≥ 1000 marks a drop-edge light). */
function markerLights(pos: number[], ds: number[], time: { value: number }) {
  const n = ds.length, g = new THREE.InstancedBufferGeometry(), quad = new THREE.PlaneGeometry(1, 1);
  g.index = quad.index; g.setAttribute('position', quad.getAttribute('position'));
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('iD', new THREE.InstancedBufferAttribute(new Float32Array(ds), 1));
  g.instanceCount = n;
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]), fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 iPos; attribute float iD; uniform float uTime; varying vec2 vUv; varying vec3 vCol; ${RAINBOW_GLSL}
      #include <fog_pars_vertex>
      void main() {
        float drop = step(999.0, iD), d = iD - drop * 1000.0, ph = fract(d / 12.0 - uTime * 1.3);
        float b = 0.25 + 1.3 * smoothstep(0.78, 1.0, ph);
        vCol = mix(hue(fract(d / 110.0 - uTime * 0.04)) * 0.9 + 0.12, vec3(0.6, 0.95, 1.2), drop * 0.6) * b; vUv = position.xy * 2.0;
        vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0); mvPosition.xy += position.xy * (0.4 + 0.2 * b);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `varying vec2 vUv; varying vec3 vCol;
      #include <fog_pars_fragment>
      void main() { float r = length(vUv), a = pow(max(0.0, 1.0 - r), 2.2); if (a < 0.01) discard; gl_FragColor = vec4(vCol * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        ${FOG_ADD}
      }`,
  });
  m.uniforms.uTime = time;
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 4; mesh.matrixAutoUpdate = false;
  return mesh;
}
