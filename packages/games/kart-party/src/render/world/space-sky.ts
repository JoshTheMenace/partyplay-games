/* Rainbow Road sky: a nebula/Milky-Way cube baked once on the GPU (expensive noise, drawn with one
 * texture fetch per pixel afterwards), plus live layers on top — anti-aliased twinkling starfield, a spiral
 * galaxy, a bright star with diffraction spikes and shooting stars — a huge ringed planet and the PMREM
 * environment (nebula + the rainbow glow beneath the karts, so paint picks up the road). */
import * as THREE from 'three';
import type { ThemeStyle } from './theme';

/** Shared GLSL: hashes and 3D value noise. */
export const NOISE_GLSL = /* glsl */`
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
  float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * n3(p); p = p * 2.02 + vec3(3.1, 1.7, 5.3); a *= 0.5; } return s; }
`;
const DOME_VERTEX = /* glsl */`varying vec3 vDir;
  void main() { vDir = position; vec4 p = projectionMatrix * vec4(mat3(modelViewMatrix) * position, 1.0); gl_Position = p.xyww; }`;

/** Static deep-space layer (linear HDR): violet-black gradient, domain-warped nebula with filaments and
 * dust lanes, and a Milky Way band. Rendered once into a cube map. */
function bakeMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir; ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = mix(vec3(0.007, 0.003, 0.02), vec3(0.016, 0.006, 0.04), smoothstep(-0.7, 0.9, d.y));
        vec3 q = d * 1.5, w = vec3(fbm3(q + 1.3), fbm3(q + 7.9), fbm3(q + 4.2));
        float n = fbm3(q * 1.3 + w * 1.9), m = smoothstep(0.4, 0.76, n), hue = fbm3(d * 2.1 + w * 1.2);
        vec3 neb = mix(vec3(0.62, 0.05, 0.6), vec3(0.05, 0.2, 0.85), smoothstep(0.36, 0.64, hue));
        neb = mix(neb, vec3(1.0, 0.28, 0.42), smoothstep(0.6, 0.84, n) * 0.55);
        neb = mix(neb, vec3(0.1, 0.75, 0.9), smoothstep(0.66, 0.8, hue) * 0.5);
        col += neb * (m * m * 0.62 + smoothstep(0.28, 0.6, n) * 0.06);
        float fil = pow(1.0 - abs(fbm3(d * 4.6 + w * 2.2) * 2.0 - 1.0), 9.0) * m;
        col += neb * fil * 0.85;
        col *= mix(1.0, 0.3, smoothstep(0.56, 0.74, fbm3(d * 3.7 + 9.0)) * m);
        vec3 N = normalize(vec3(0.35, 0.82, -0.46));
        float bd = dot(d, N), band = exp(-bd * bd / 0.028), bn = fbm3(d * 7.0 + 2.0);
        col += vec3(0.34, 0.26, 0.46) * band * (0.2 + 0.8 * bn * bn) * 0.42;
        col *= 1.0 - band * smoothstep(0.5, 0.7, fbm3(d * 10.0 + 5.0)) * 0.6;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/** Bake the static layer (half-float so the near-black gradients don't band). Caller disposes the target. */
export function bakeSpaceSky(renderer: THREE.WebGLRenderer, size = 512) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const scene = new THREE.Scene(), mat = bakeMaterial(), mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), mat);
  scene.add(mesh);
  new THREE.CubeCamera(0.1, 100, rt).update(renderer, scene);
  mesh.geometry.dispose(); mat.dispose();
  return rt;
}

/** Live sky dome. `forEnv` drops the pin-point layers (the PMREM capture only needs the colour field). */
export function spaceSkyMaterial(theme: ThemeStyle, sunDir: THREE.Vector3, galaxyDir: THREE.Vector3, forEnv = false) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { bake: { value: null as THREE.Texture | null }, sunDir: { value: sunDir.clone() }, galaxyDir: { value: galaxyDir.clone() }, sunColor: { value: new THREE.Color(theme.sky.sunColor) },
      time: { value: 0 }, live: { value: forEnv ? 0 : 1 } },
    vertexShader: DOME_VERTEX,
    fragmentShader: `uniform samplerCube bake; uniform vec3 sunDir, galaxyDir, sunColor; uniform float time, live; varying vec3 vDir;
      ${NOISE_GLSL}
      vec3 stars(vec3 d, float scale, float density, float gain) {
        vec3 p = d * scale, c = floor(p), f = fract(p);
        float h = h31(c);
        if (h > density) return vec3(0.0);
        vec3 o = vec3(h31(c + 11.1), h31(c + 23.7), h31(c + 37.3)) * 0.6 + 0.2;
        float px = length(fwidth(p)) * 0.9, size = 0.07 + 0.08 * h31(c + 5.3), r = max(size, px);
        float core = smoothstep(r, 0.0, length(f - o)) * (size * size) / (r * r);
        float br = 0.35 + 2.4 * pow(h31(c + 7.7), 4.0), tw = 0.6 + 0.4 * sin(time * (1.3 + 3.5 * h31(c + 9.1)) + h * 90.0);
        vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.86, 0.72), h31(c + 2.2));
        tint = mix(tint, vec3(1.0, 0.62, 0.95), step(0.88, h31(c + 3.3)));
        return tint * core * br * tw * gain;
      }
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = textureCube(bake, d).rgb;
        // Spiral galaxy.
        float gd = dot(d, galaxyDir);
        if (gd > 0.9 && live > 0.5) {
          vec3 e1 = normalize(cross(galaxyDir, vec3(0.0, 1.0, 0.0))), e2 = cross(e1, galaxyDir);
          vec2 q = vec2(dot(d, e1), dot(d, e2)) / 0.24; q = mat2(0.8, -0.6, 0.6, 0.8) * q; q.y /= 0.45;
          float r = length(q), a = atan(q.y, q.x + 1e-4);   // atan(0, 0) is NaN on some GPUs
          float arms = pow(0.5 + 0.5 * cos(2.0 * a - 6.5 * log(r + 0.03)), 2.5), disk = exp(-r * 3.2), core = exp(-r * r * 40.0);
          float clumps = 0.6 + 0.8 * n3(vec3(q * 9.0, 1.0));
          vec3 g = mix(vec3(0.35, 0.45, 1.0), vec3(1.0, 0.72, 0.92), disk) * (disk * arms * clumps * 1.3 + disk * 0.18) + vec3(1.0, 0.88, 0.75) * core * 1.8;
          col += g * smoothstep(0.9, 0.93, gd) * 0.85;
        }
        // The system's star: soft glow, disk and four diffraction spikes.
        float sd = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 60.0) * 0.12 + pow(sd, 8.0) * 0.035);
        if (sd > 0.985) {
          vec3 s1 = normalize(cross(sunDir, vec3(0.0, 1.0, 0.0))), s2 = cross(s1, sunDir);
          vec2 q = vec2(dot(d, s1), dot(d, s2));
          col += sunColor * (exp(-abs(q.x) * 900.0) * exp(-abs(q.y) * 22.0) + exp(-abs(q.y) * 900.0) * exp(-abs(q.x) * 22.0)) * 1.6 * live;
        }
        if (live > 0.5) {
          col += stars(d, 110.0, 0.09, 1.5) + stars(d, 260.0, 0.2, 0.85) + stars(d, 620.0, 0.3, 0.45);
          // Shooting stars: three independent cycles, each visible for a short streak.
          for (int i = 0; i < 3; i++) {
            float fi = float(i), P = 4.5 + fi * 2.7, tt = time / P + fi * 0.37, cyc = floor(tt), ph = fract(tt);
            if (ph > 0.16) continue;
            float k = ph / 0.16, az = h21(vec2(cyc, fi)) * 6.2832, el = mix(0.12, 0.9, h21(vec2(fi + 3.0, cyc)));
            vec3 s0 = vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));
            if (dot(d, s0) < 0.9) continue;
            vec3 tA = normalize(cross(s0, vec3(0.0, 1.0, 0.0))), tB = cross(tA, s0);
            float ang = -0.35 - h21(vec2(cyc + 7.0, fi)) * 0.8, sgn = h21(vec2(fi, cyc + 1.0)) > 0.5 ? 1.0 : -1.0;
            vec3 dir = tA * cos(ang) * sgn + tB * sin(ang);
            vec3 v = d - s0; float x = dot(v, dir), y = dot(v, normalize(cross(dir, s0)));
            float head = k * 0.36, tail = head - 0.09, w = max(0.0012, length(fwidth(d)) * 0.8);
            float body = step(tail, x) * step(x, head) * pow(clamp((x - tail) / 0.09, 0.0, 1.0), 2.0);
            col += vec3(0.85, 0.9, 1.0) * body * smoothstep(w, 0.0, abs(y)) * sin(k * 3.1416) * 2.2;
          }
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** A banded gas giant with a lit, planet-shadowed ring system, `dist` metres out along `dir`. */
export function buildRingedPlanet(center: THREE.Vector3, dir: THREE.Vector3, dist: number, radius: number, sunDir: THREE.Vector3) {
  const group = new THREE.Group(); group.name = 'ringed-planet';
  const pos = center.clone().addScaledVector(dir, dist), tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, 0.6, 0.28));
  const planet = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48), new THREE.ShaderMaterial({
    fog: false, uniforms: { sunDir: { value: sunDir.clone() } },
    vertexShader: `varying vec3 vN; varying vec3 vL; varying vec3 vW;
      void main() { vL = normalize(position); vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 sunDir; varying vec3 vN; varying vec3 vL; varying vec3 vW; ${NOISE_GLSL}
      void main() {
        vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
        float wob = n3(vL * 3.0) * 0.55 + n3(vL * 11.0) * 0.18, b = vL.y * 10.0 + wob * 1.7;
        float s = 0.5 + 0.5 * sin(b), s2 = 0.5 + 0.5 * sin(b * 2.6 + 1.3);
        vec3 col = mix(mix(vec3(0.2, 0.08, 0.55), vec3(0.75, 0.12, 0.42), s), mix(vec3(1.0, 0.42, 0.18), vec3(1.0, 0.75, 0.5), s2), smoothstep(0.3, 0.85, s * 0.6 + s2 * 0.4));
        float spot = smoothstep(0.16, 0.08, length((vL - normalize(vec3(0.7, -0.25, 0.66))) * vec3(1.0, 1.8, 1.0)));
        col = mix(col, vec3(0.95, 0.35, 0.3), spot * 0.8);
        float ndl = dot(n, sunDir), lit = smoothstep(-0.2, 0.75, ndl);
        vec3 c = col * (0.015 + 0.8 * lit);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 2.6);
        c += vec3(0.45, 0.5, 1.0) * fres * (0.12 + 0.9 * smoothstep(-0.35, 0.5, ndl));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  const inner = radius * 1.35, outer = radius * 2.45;
  const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 160, 1), new THREE.ShaderMaterial({
    fog: false, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { sunDir: { value: sunDir.clone() }, center: { value: pos.clone() }, R: { value: radius }, inner: { value: inner }, outer: { value: outer } },
    vertexShader: `varying vec3 vW; varying vec2 vP; void main() { vP = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 sunDir, center; uniform float R, inner, outer; varying vec3 vW; varying vec2 vP;
      void main() {
        float r = (length(vP) - inner) / (outer - inner);
        float bands = 0.55 + 0.25 * sin(r * 95.0) + 0.2 * sin(r * 31.0 + 1.0);
        bands *= smoothstep(0.0, 0.06, r) * smoothstep(1.0, 0.9, r) * (1.0 - 0.9 * smoothstep(0.035, 0.0, abs(r - 0.63)));
        vec3 col = mix(vec3(1.0, 0.8, 0.66), vec3(0.62, 0.5, 0.95), r);
        vec3 p = vW - center; float t = dot(-p, sunDir);
        float shadow = t > 0.0 && length(p + sunDir * t) < R ? 0.12 : 1.0;
        gl_FragColor = vec4(col * bands * shadow * 0.95, bands * 0.8);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  for (const m of [planet, ring]) { m.position.copy(pos); m.quaternion.copy(tilt); m.frustumCulled = false; }
  ring.rotateX(-Math.PI / 2);
  planet.renderOrder = -5; ring.renderOrder = 5;
  group.add(planet, ring);
  group.traverse(o => { o.updateMatrix(); o.matrixAutoUpdate = false; });
  return group;
}

/** Environment capture: the nebula field, the star, and a rainbow floor so kart paint reflects the road. */
export function spaceEnvironment(theme: ThemeStyle, bake: THREE.Texture, sunDir: THREE.Vector3, galaxyDir: THREE.Vector3): THREE.Scene {
  const scene = new THREE.Scene(), sky = spaceSkyMaterial(theme, sunDir, galaxyDir, true);
  sky.uniforms.bake.value = bake;
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), sky));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; ${RAINBOW_GLSL}
      void main() { float u = clamp((vUv.x - 0.5) * 3.0 + 0.5, 0.0, 1.0); gl_FragColor = vec4(rainbow(u) * 0.55 * smoothstep(0.5, 0.2, abs(vUv.y - 0.5)), 1.0); }`,
  }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.5; scene.add(floor);
  const sun = new THREE.Mesh(new THREE.CircleGeometry(1.4, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.sun.color).multiplyScalar(3), side: THREE.DoubleSide }));
  sun.position.copy(sunDir).multiplyScalar(8); sun.lookAt(0, 0, 0); scene.add(sun);
  return scene;
}

/** Seven road bands, left (red) to right (violet), linear HDR-ish colours. */
export const RAINBOW_GLSL = /* glsl */`
  vec3 rainbow(float u) {
    float b = clamp(floor(u * 7.0), 0.0, 6.0);
    return b < 0.5 ? vec3(1.0, 0.07, 0.16) : b < 1.5 ? vec3(1.0, 0.36, 0.02) : b < 2.5 ? vec3(1.0, 0.82, 0.05)
      : b < 3.5 ? vec3(0.12, 0.9, 0.22) : b < 4.5 ? vec3(0.04, 0.62, 1.0) : b < 5.5 ? vec3(0.22, 0.2, 1.0) : vec3(0.72, 0.16, 1.0);
  }
  vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
`;
