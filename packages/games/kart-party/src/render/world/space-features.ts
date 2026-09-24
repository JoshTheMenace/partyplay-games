/* Rainbow Road set-piece visuals, read straight from the resolved Track so they match the physics:
 * star rings (pulsing rainbow tori + a faint disc that shows the pass-through zone), spring pads
 * (glowing stars with ripples and a light column), pinball star bumpers placed every frame with
 * moverPosition at the predicted kart's clock — exactly where they hit our own kart — plus their slide grooves, and
 * low-gravity zones (drifting sparkle motes and aurora curtains). Flashes react to ring/spring/bumper events. */
import * as THREE from 'three';
import { forwardDistance, moverPosition, pointAt, sampleAt, type Track } from '../../sim/track';
import type { RaceEvent, RaceView } from '../../sim/types';
import type { QualityTier } from '../types';
import { Geo } from './geo';
import type { PropLibrary } from './props';
import { RAINBOW_GLSL } from './space-sky';

/** `moverTime` (default race.time): the race clock bumpers are placed at — the predicted kart's, see FrameInput. */
export type SpaceFeatures = { group: THREE.Group; update(race: RaceView | null, time: number, events: readonly RaceEvent[], moverTime?: number): void };

const FOG_ADD = `#ifdef USE_FOG
    gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif`;
/** Instanced glow shader: `aFlash` (0–1) and `aSeed` per instance; `vertex` may scale `p` (local position). */
function instGlow(fragment: string, opts: { additive?: boolean; vertex?: string; side?: THREE.Side } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]), fog: true, side: opts.side ?? THREE.FrontSide,
    transparent: !!opts.additive, depthWrite: !opts.additive, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: `attribute float aFlash; attribute float aSeed; uniform float uTime;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vP; varying float vF; varying float vS; varying float vD;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position; vF = aFlash; vS = aSeed; vUv = uv; vP = position;
        ${opts.vertex ?? ''}
        mat4 m = modelMatrix * instanceMatrix; vec4 wp = m * vec4(p, 1.0);
        vN = normalize(mat3(m) * normal); vV = normalize(cameraPosition - wp.xyz); vD = distance(cameraPosition, wp.xyz);
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vP; varying float vF; varying float vS; varying float vD; ${RAINBOW_GLSL}
      #include <fog_pars_fragment>
      void main() { float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        ${fragment}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        ${opts.additive ? FOG_ADD : '#include <fog_fragment>'}
      }`,
  });
}
/** Instanced mesh with per-instance flash + seed attributes. */
function inst(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, flash: THREE.InstancedBufferAttribute) {
  const seed = new Float32Array(n).map((_, i) => (i * 0.618) % 1);
  geo.setAttribute('aFlash', flash); geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  const mesh = new THREE.InstancedMesh(geo, mat, n); mesh.frustumCulled = false; return mesh;
}
function starShape(outer: number, inner: number) {
  const s = new THREE.Shape();
  for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI * 2, r = i % 2 ? inner : outer; if (i) s.lineTo(Math.sin(a) * r, Math.cos(a) * r); else s.moveTo(0, r); }
  return s;
}
/** Road-aligned frame at (d, lat): X = driver-left, Y = road normal (banked), Z = forward. */
const WHITE = new THREE.Color(1, 1, 1), _c = new THREE.Color();
const _r = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _l = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
function roadFrame(track: Track, d: number, lat: number, lift: number, scale: THREE.Vector3, out: THREE.Matrix4, spin = 0) {
  const s = sampleAt(track, d), p = pointAt(track, d, lat);
  _r.set(s.rx, -Math.tan(s.bank), s.rz).normalize(); _f.set(s.tx, s.ty, s.tz).normalize();
  _u.crossVectors(_r, _f).normalize(); _l.copy(_r).negate(); _f.crossVectors(_l, _u).normalize();
  out.makeBasis(_l, _u, _f);
  if (spin) out.multiply(_m.makeRotationY(spin));
  out.scale(scale).setPosition(p.x + _u.x * lift, p.y + _u.y * lift, p.z + _u.z * lift);
  return out;
}

export function buildSpaceFeatures(track: Track, quality: QualityTier, lib: PropLibrary, clone: (name: string) => THREE.Object3D | null): SpaceFeatures {
  const group = new THREE.Group(); group.name = 'space-features';
  const time = { value: 0 }, mats: THREE.ShaderMaterial[] = [];
  const shared = (m: THREE.ShaderMaterial) => { m.uniforms.uTime = time; mats.push(m); return m; };
  const sc = new THREE.Vector3();

  // ---- star rings
  const rings = track.rings, ringFlash = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, rings.length)), 1);
  if (rings.length) {
    const torus = inst(new THREE.TorusGeometry(1, 0.085, 12, 72), shared(instGlow(`
        vec3 c = hue(fract(vUv.x * 2.0 + uTime * 0.35 + vS));
        gl_FragColor = vec4(c * (1.1 + 1.6 * fres) + vec3(0.6 + 0.4 * sin(uTime * 5.0 + vS * 9.0)) * 0.35 + vec3(2.5) * vF, 1.0);`,
      { vertex: 'p *= 1.0 + 0.05 * sin(uTime * 4.0 + aSeed * 6.2832) + aFlash * 0.3;' })), rings.length, ringFlash);
    const disc = inst(new THREE.CircleGeometry(1, 48), shared(instGlow(`
        // Additive glow lands after sRGB encoding, so even a faint fill washes out what lies behind: keep the
        // middle clear (the landing must read through the gap ring) and show the zone only up close.
        float r = length(vUv - 0.5) * 2.0, near = smoothstep(70.0, 18.0, vD);
        float a = smoothstep(1.0, 0.85, r) * pow(r, 6.0) * (0.04 + 0.16 * near) + vF * 0.5 * (1.0 - r * 0.6);
        float sweep = pow(0.5 + 0.5 * sin(r * 14.0 - uTime * 6.0), 8.0) * 0.04 * near * smoothstep(1.0, 0.5, r);
        gl_FragColor = vec4(mix(vec3(1.0, 0.95, 1.0), hue(fract(r * 0.7 - uTime * 0.3 + vS)), r) * (a + sweep), 1.0);`,
      { additive: true, side: THREE.DoubleSide, vertex: 'p *= 1.0 + aFlash * 0.3;' })), rings.length, ringFlash);
    rings.forEach((ring, i) => {
      const s = sampleAt(track, ring.d);
      _f.set(s.tx, s.ty, s.tz).normalize(); _r.set(s.rx, 0, s.rz).normalize(); _u.crossVectors(_r, _f).normalize(); _l.copy(_r).negate(); _f.crossVectors(_l, _u);
      _m.makeBasis(_l, _u, _f).scale(sc.setScalar(ring.radius)).setPosition(ring.x, ring.y, ring.z);
      torus.setMatrixAt(i, _m); disc.setMatrixAt(i, _m);
    });
    disc.renderOrder = 6; group.add(torus, disc);
  }

  // ---- springs
  const springs = track.springs, springFlash = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, springs.length)), 1);
  const springAt = springs.map(s => { const len = forwardDistance(track, s.d0, s.d1); return { d: s.d0 + len / 2, lat: s.lat, size: Math.min(s.halfWidth, len / 2) }; });
  if (springs.length) {
    const flat = (g: THREE.ShapeGeometry) => g.rotateX(-Math.PI / 2).rotateY(Math.PI);
    // Pad: a dark star with glowing coil rings running outward, so it reads on the bright colour bands.
    const pad = inst(flat(new THREE.ShapeGeometry(starShape(1, 0.48))), shared(instGlow(`
        float r = length(vP.xz), beat = pow(0.5 + 0.5 * sin(uTime * 5.0 + vS * 6.2832), 3.0);
        float coil = smoothstep(0.3, 0.46, abs(fract(r * 3.0 - uTime * 1.5) - 0.5));
        vec3 c = vec3(0.07, 0.02, 0.16) + mix(vec3(1.7, 1.5, 0.5), vec3(0.45, 1.8, 1.3), smoothstep(0.1, 0.9, r)) * coil * (0.8 + 0.5 * beat);
        gl_FragColor = vec4(c + vec3(2.0) * vF, 1.0);`, { vertex: 'p.y += 0.02;' })), springs.length, springFlash);
    // Rim: a hot mint star outline around the pad.
    const rimShape = starShape(1.16, 0.56); rimShape.holes.push(starShape(1, 0.48));
    const rim = inst(flat(new THREE.ShapeGeometry(rimShape)), shared(instGlow(`
        float beat = 0.5 + 0.5 * sin(uTime * 5.0 + vS * 6.2832);
        gl_FragColor = vec4(vec3(0.45, 2.2, 1.6) * (0.8 + 0.5 * beat) + vec3(2.0) * vF, 1.0);`, { vertex: 'p.y += 0.02;' })), springs.length, springFlash);
    const ripple = inst(new THREE.PlaneGeometry(3, 3).rotateX(-Math.PI / 2), shared(instGlow(`
        float r = length(vP.xz), a = 0.0;
        for (int k = 0; k < 2; k++) { float t = fract(uTime * 0.9 + float(k) * 0.5 + vS); a += smoothstep(0.08, 0.0, abs(r - (1.0 + t * 0.45))) * (1.0 - t); }
        gl_FragColor = vec4(vec3(1.2, 0.5, 1.4) * (a * 0.8 + vF * smoothstep(1.5, 0.8, r)), 1.0);`, { additive: true, side: THREE.DoubleSide, vertex: 'p.y += 0.05;' })), springs.length, springFlash);
    const column = inst(new THREE.CylinderGeometry(0.85, 1, 1, 24, 1, true).translate(0, 0.5, 0), shared(instGlow(`
        float y = vUv.y, beat = 0.5 + 0.5 * sin(uTime * 5.0 + vS * 6.2832);
        float a = (pow(1.0 - y, 3.0) * (0.03 + 0.05 * beat) + pow(1.0 - y, 1.5) * vF * 0.15) * smoothstep(3.0, 12.0, vD);
        a *= 0.3 + 0.7 * pow(0.5 + 0.5 * sin(vUv.x * 50.27 + y * 6.0 - uTime * 4.0), 4.0);
        gl_FragColor = vec4(vec3(1.4, 0.7, 1.8) * a, 1.0);`, { additive: true, side: THREE.DoubleSide })), springs.length, springFlash);
    springAt.forEach((s, i) => {
      pad.setMatrixAt(i, roadFrame(track, s.d, s.lat, 0.03, sc.setScalar(s.size * 1.1), _m));
      rim.setMatrixAt(i, _m); ripple.setMatrixAt(i, _m);
      column.setMatrixAt(i, roadFrame(track, s.d, s.lat, 0.03, sc.set(s.size * 0.8, 4, s.size * 0.8), _m));
    });
    ripple.renderOrder = column.renderOrder = 6; group.add(pad, rim, ripple, column);
  }

  // ---- movers (pinball star bumpers) and their slide grooves. Bumper = props.glb `star_bumper` (base) +
  // `star_bumper_star` (spinning), or primitives; one InstancedMesh per part. Flashes (kept CPU-side here)
  // brighten the per-instance colour, which multiplies the baked vertex colours, glow parts included.
  const movers = track.movers, moverFlash = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, movers.length)), 1);
  const bumper: { mesh: THREE.InstancedMesh; star: boolean }[] = [];
  let baseR = 1.6, starY = 2.75;
  if (movers.length) {
    const src = clone('star_bumper') ?? lib.primitive('star_bumper'), starNode = src.getObjectByName('star_bumper_star');
    if (starNode) { starY = starNode.position.y; starNode.removeFromParent(); }
    const base = lib.flatten(src), star = lib.flatten(clone('star_bumper_star') ?? lib.primitive('star_bumper_star'));
    baseR = base.radius;
    for (const [t, isStar] of [[base, false], [star, true]] as const) for (const part of t.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, movers.length); mesh.frustumCulled = false; mesh.castShadow = !isStar;
      for (let i = 0; i < movers.length; i++) mesh.setColorAt(i, WHITE);
      bumper.push({ mesh, star: isStar }); group.add(mesh);
    }
    // Grooves: a faint glowing lane across the road where each bumper slides.
    const g = new Geo();
    for (const m of movers) {
      const lo = m.lat - m.amp - m.radius, hi = m.lat + m.amp + m.radius;
      g.grid(2, 9, (row, col, o) => { const d = m.d + (row ? 1 : -1) * m.radius, lat = lo + (hi - lo) * col / 8, p = pointAt(track, d, lat); o[0] = p.x; o[1] = p.y + 0.03; o[2] = p.z; o[3] = lat - lo; o[4] = row; });
    }
    const groove = new THREE.Mesh(g.build()!, new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]), fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      vertexShader: `varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        #include <fog_pars_fragment>
        void main() { float edge = smoothstep(0.35, 0.5, abs(vUv.y - 0.5)), dots = smoothstep(0.3, 0.0, length(vec2(fract(vUv.x / 1.5) - 0.5, (vUv.y - 0.5) * 0.8)));
          gl_FragColor = vec4(vec3(1.0, 0.25, 0.8) * (edge * 0.5 + dots * 0.35 * (0.6 + 0.4 * sin(uTime * 4.0 + vUv.x))), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          ${FOG_ADD}
        }`,
    }));
    shared(groove.material as THREE.ShaderMaterial); groove.renderOrder = 3; groove.matrixAutoUpdate = false;
    group.add(groove);
  }

  // ---- low-gravity zones: rising sparkle motes and aurora curtains either side
  const motePos: number[] = [], moteSeed: number[] = [], aurora = new Geo(), keep = [1, 0.7, 0.4][quality];
  for (const z of track.gravity) {
    const len = forwardDistance(track, z.d0, z.d1), n = Math.round(len * 5 * keep);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n, h = ((i * 0.754877) % 1), d = z.d0 + len * u, s = sampleAt(track, d), w = s.halfWidth + Math.max(s.runoffL, s.runoffR) + 3, lat = (h * 2 - 1) * w;
      const p = pointAt(track, d, lat); motePos.push(p.x, p.y, p.z); moteSeed.push((i * 0.5698403) % 1);
    }
    const rows = Math.max(2, Math.ceil(len / 2) + 1);
    const fade = new THREE.Color();
    for (const side of [-1, 1]) aurora.grid(rows, 2, (r, col, o) => {
      const d = z.d0 + len * r / (rows - 1), s = sampleAt(track, d), e = side * (s.halfWidth + (side < 0 ? s.runoffL : s.runoffR) + 7 + Math.sin(d * 0.045 + side) * 4);
      o[0] = s.x + s.rx * e * (col ? 1.25 : 1); o[1] = s.y + (col ? 18 : 1.5); o[2] = s.z + s.rz * e * (col ? 1.25 : 1); o[3] = d; o[4] = col;
    }, undefined, r => { const t = r / (rows - 1); return fade.setRGB(Math.min(1, t * 6, (1 - t) * 6), 0, 0); });
  }
  if (motePos.length) {
    const n = moteSeed.length, g = new THREE.InstancedBufferGeometry(), quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index; g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(motePos), 3)); g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(new Float32Array(moteSeed), 1));
    g.instanceCount = n;
    const m = shared(new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]), fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec3 iPos; attribute float iSeed; uniform float uTime; varying vec2 vUv; varying vec3 vCol; ${RAINBOW_GLSL}
        #include <fog_pars_vertex>
        void main() {
          float H = 11.0, t = mod(iSeed * H + uTime * (0.5 + iSeed * 0.7), H), fade = smoothstep(0.0, 1.5, t) * smoothstep(H, H - 3.0, t);
          vec3 w = iPos + vec3(sin(uTime * 0.7 + iSeed * 40.0), t + 0.3, cos(uTime * 0.6 + iSeed * 30.0)) * vec3(0.8, 1.0, 0.8);
          float tw = 0.55 + 0.45 * sin(uTime * (2.0 + iSeed * 4.0) + iSeed * 60.0);
          vCol = mix(vec3(0.5, 1.0, 1.3), hue(iSeed), 0.35) * fade * tw * 1.3; vUv = position.xy * 2.0;
          vec4 mvPosition = viewMatrix * vec4(w, 1.0); mvPosition.xy += position.xy * (0.16 + 0.12 * iSeed);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `varying vec2 vUv; varying vec3 vCol;
        #include <fog_pars_fragment>
        void main() { float r = length(vUv), a = pow(max(0.0, 1.0 - r), 2.0) + max(0.0, 1.0 - abs(vUv.x) * 9.0 - abs(vUv.y) * 0.9) * 0.6 + max(0.0, 1.0 - abs(vUv.y) * 9.0 - abs(vUv.x) * 0.9) * 0.6;
          if (a < 0.01) discard; gl_FragColor = vec4(vCol * a, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          ${FOG_ADD}
        }`,
    }));
    const motes = new THREE.Mesh(g, m); motes.frustumCulled = false; motes.renderOrder = 7; motes.matrixAutoUpdate = false; group.add(motes);
  }
  const auroraGeo = aurora.build();
  if (auroraGeo) {
    const m = shared(new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]), fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexColors: true,
      vertexShader: `varying vec2 vUv; varying float vFade;
        #include <fog_pars_vertex>
        void main() { vUv = uv; vFade = color.r; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vFade;
        #include <fog_pars_fragment>
        void main() { float d = vUv.x, y = vUv.y;
          float wave = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(d * 0.05 + uTime * 0.6 + sin(d * 0.017 - uTime * 0.3) * 3.0), 2.0);
          float lower = 0.12 + 0.1 * sin(d * 0.09 + uTime * 0.9), rays = 0.7 + 0.3 * sin(d * 2.3 + uTime * 2.0 + sin(d * 0.21) * 3.0);
          float a = smoothstep(lower, lower + 0.06, y) * exp(-(y - lower) * 3.2) * wave * rays * vFade;
          gl_FragColor = vec4(mix(vec3(0.15, 1.0, 0.55), vec3(0.9, 0.25, 0.9), smoothstep(lower, 0.75, y)) * a * 0.55, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          ${FOG_ADD}
        }`,
    }));
    const curtain = new THREE.Mesh(auroraGeo, m); curtain.renderOrder = 5; curtain.matrixAutoUpdate = false; group.add(curtain);
  }

  let last = 0;
  const flashes = [ringFlash, springFlash, moverFlash];
  const nearest = (list: { x: number; z: number }[], x: number, z: number) => { let best = -1, bd = Infinity; list.forEach((p, i) => { const dd = (p.x - x) ** 2 + (p.z - z) ** 2; if (dd < bd) { bd = dd; best = i; } }); return best; };
  const moverAt: { x: number; y: number; z: number; lateral: number }[] = movers.map(() => ({ x: 0, y: 0, z: 0, lateral: 0 }));
  const springXZ = springAt.map(s => pointAt(track, s.d, s.lat));
  const valid = (v: number | undefined, n: number) => v !== undefined && Number.isInteger(v) && v >= 0 && v < n;
  return {
    group,
    update(race, t, events, moverTime = race?.time ?? 0) {
      const dt = Math.min(0.1, Math.max(0, t - last)); last = t; time.value = t;
      for (const f of flashes) { const a = f.array as Float32Array; let on = false; for (let i = 0; i < a.length; i++) if (a[i] > 0) { a[i] = Math.max(0, a[i] - dt * 3.2); on = true; } if (on) f.needsUpdate = true; }
      if (!race) return;
      const flash = moverFlash.array as Float32Array;
      movers.forEach((m, i) => {
        const p = moverPosition(track, m, moverTime), k = m.radius / baseR;
        moverAt[i].x = p.x; moverAt[i].y = p.y; moverAt[i].z = p.z; moverAt[i].lateral = p.lateral;
        const baseM = roadFrame(track, m.d, p.lateral, 0, sc.setScalar(k), _m).clone(), starM = roadFrame(track, m.d, p.lateral, (starY + 0.12 * Math.sin(t * 3 + i)) * k, sc.setScalar(k * (1 + flash[i] * 0.35)), _m, t * 1.8 + i);
        for (const b of bumper) { b.mesh.setMatrixAt(i, b.star ? starM : baseM); b.mesh.setColorAt(i, _c.setScalar(1 + flash[i] * 2.5)); }
      });
      for (const b of bumper) { b.mesh.instanceMatrix.needsUpdate = true; b.mesh.instanceColor!.needsUpdate = true; }
      for (const ev of events) {
        if (ev.type !== 'ring' && ev.type !== 'spring' && ev.type !== 'bumper') continue;
        const who = race.racers.find(r => r.id === ev.racer), x = ev.x ?? who?.x ?? 0, z = ev.z ?? who?.z ?? 0;
        const [attr, list] = ev.type === 'ring' ? [ringFlash, rings] : ev.type === 'spring' ? [springFlash, springXZ] : [moverFlash, moverAt];
        const i = valid(ev.value, list.length) ? ev.value! : nearest(list, x, z);
        if (i >= 0) { (attr.array as Float32Array)[i] = 1; attr.needsUpdate = true; }
      }
    },
  };
}
