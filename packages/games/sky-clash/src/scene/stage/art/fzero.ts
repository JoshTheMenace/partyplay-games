/** F-Zero series: Mute City (the hover pad and the track sliding in) and Big Blue (racers over the rushing track). */
import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, Group, Mesh, PlaneGeometry, ShaderMaterial, SphereGeometry, type BufferGeometry } from 'three';
import { GLSL_NOISE, at, gradient, massGeometry, merge, mix, paint, rng, type Kit, type SurfaceOptions } from '../kit';
import { skyline } from '../decor';
import type { StageModule } from '../index';
import { clock, cloudBank, farPlane, looped, particles, scatter, sparkles } from './common';
import { racer } from './pieces';

/** The racing surface: lane lines, chevrons and energy rails rushing along -x at `speed` m/s. */
function road(k: Kit, o: { width: number; depth: number; base: string; line: string; rail: string }) {
  const material = k.own(new ShaderMaterial({
    uniforms: { uBase: { value: new Color(o.base) }, uLine: { value: new Color(o.line) }, uRail: { value: new Color(o.rail) }, uShift: { value: 0 }, uDepth: { value: o.depth } },
    vertexShader: /* glsl */`varying vec3 vL; void main(){ vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`uniform vec3 uBase, uLine, uRail; uniform float uShift, uDepth; varying vec3 vL; ${GLSL_NOISE}
      void main(){
        float x = vL.x + uShift, z = vL.z / uDepth + .5;
        vec3 col = uBase * (.85 + .15 * noise(vec2(x * .15, z * 6.)));
        float lane = step(.94, fract(z * 3.)) * step(.5, fract(x * .12));
        float chevron = step(.9, fract((x + abs(z - .5) * 6.) * .08)) * step(.2, z) * step(z, .8);
        col = mix(col, uLine, max(lane, chevron * .8));
        float rail = smoothstep(.08, .02, min(z, 1. - z)); col = mix(col, uRail * (1.2 + .4 * step(.5, fract(x * .25))), rail);
        gl_FragColor = vec4(col, 1.);
        #include <colorspace_fragment>
      }`,
  }));
  const mesh = k.add(new Mesh(k.own(new PlaneGeometry(o.width, o.depth).rotateX(-Math.PI / 2)), material));
  return { mesh, set(x: number, y: number, z: number, shift: number) { mesh.position.set(x, y, z); material.uniforms.uShift.value = shift + x; } };
}
/** Periodic city tile for looped(): towers with lit windows and a few neon signs. */
function cityTile(seed: number, span: number, base: number, lo: number, hi: number, z: number, body: string, glass: string, neon: readonly string[], lit = .4) {
  return (shift: number) => {
    const r = rng(seed), parts = [skyline(seed, shift - span / 2, shift + span / 2 - 6, base, lo, hi, z, body, glass, lit, 4)];
    for (let i = 0; i < 6; i++) parts.push(paint(at(new BoxGeometry(2.2 + r() * 2, .7, .1), shift - span / 2 + r() * (span - 8), base + lo * .6 + r() * (hi - lo) * .6, z + 2.1), neon[i % neon.length]));
    return merge(parts);
  };
}
const neonMetal = (cap: string, face: string, deep: string, trim: string): SurfaceOptions => ({ style: 'metal', cap, capDark: mix(cap, '#000', .2).getStyle(), face, faceDeep: deep, line: mix(face, '#000', .35).getStyle(), lip: '#ffffff', trim, glow: trim, capDepth: .1, wave: 0 });

const muteCity: StageModule = {
  lighting: { sky: '#ffd8f0', ground: '#3a2f5a', key: '#ffe8e0', keyIntensity: 1.15, keyDir: [.35, .9, .5], rim: '#ed86ff', rimDir: [-.5, .35, -1], ambient: .55 },
  ground: neonMetal('#c0c8e0', '#7783a6', '#1a1c34', '#ed86ff'), slab: neonMetal('#e0e4f4', '#5a6488', '#1a1c34', '#7ae8ff'),
  hints: { track: { ...neonMetal('#5a6078', '#3a3e58', '#12142a', '#ffcf4a'), style: 'metal', capDepth: .05 } },
  shape: { step: .25, round: .5, jag: 0 },
  piece(k, p, ctx) {
    if (p.kind !== 'block' || p.block.art !== 'track') return undefined;
    // The track segment: a flat road deck with guard posts and neon rails, exactly its collision rect.
    const b = p.rects[0], g = new Group(), parts: BufferGeometry[] = [];
    g.add(new Mesh(massGeometry(p.rects, false, false, { round: .15, jag: 0 }), ctx.material('track')));
    for (let x = b.left + 1; x < b.right; x += 3) parts.push(paint(at(new BoxGeometry(.12, .9, .12), x, b.top + .45, -2.4), '#c0c8e0'));
    parts.push(paint(at(new BoxGeometry(b.right - b.left, .12, .1), (b.left + b.right) / 2, b.top + .85, -2.4), '#ed86ff'), paint(at(new BoxGeometry(b.right - b.left, .08, .06), (b.left + b.right) / 2, b.top - .06, 1.44), '#7ae8ff'));
    g.add(new Mesh(k.own(merge(parts)), k.flat())); return g;
  },
  hazard: { style: 'lane', color: '#ff5ad0', object: k => racer(k, 3.6, '#3a6ae8', '#ffcf4a') },
  build(k, { floor }) {
    const t0 = floor.top, sky = k.sky({ top: '#141630', mid: '#8a3a88', bottom: '#ffb08a', horizon: -.04, stars: .35, starColor: '#ffe8ff', sun: { dir: [.2, .02, -1], color: '#fff0d0', halo: '#ff7ab0', size: .006, glow: 1.3 } });
    const far = looped(k, cityTile(3, 240, t0 - 40, 14, 46, -160, '#3a2f5a', '#ffd8a0', ['#ff5ad0', '#7ae8ff'], .35), 240, k.lit({ haze: ['#8a3a88', .5] }), 0, -42);
    const near = looped(k, cityTile(5, 140, t0 - 30, 10, 34, -70, '#2a2448', '#fff0c0', ['#ff5ad0', '#7ae8ff', '#ffcf4a'], .45), 140, k.lit({ haze: ['#5a2a6a', .25] }), 0, -41);
    const lower = road(k, { width: 400, depth: 16, base: '#3a3e58', line: '#ffcf4a', rail: '#ed86ff' });
    // The pad's thrusters and fins, in world space under the static floor.
    const hw = (floor.right - floor.left) / 2, cx = (floor.left + floor.right) / 2, pad: BufferGeometry[] = [];
    for (const s of [-1, 1]) pad.push(gradient(at(new ConeGeometry(.5, 1.6, 10), cx + s * hw * .55, t0 - 1.9, 0, Math.PI), '#9aa4c0', '#2a2c48', t0 - 2.7, t0 - 1.1), paint(at(new BoxGeometry(1.4, .12, 2.6), cx + s * (hw + .3), t0 - .5, -.6, s * -.3), '#ed86ff'));
    k.batch(pad, k.lit());
    const jets = k.glows(4), traffic = k.streaks(k.n(18), 3), r = rng(9), cars = Array.from({ length: traffic.count }, () => ({ y: t0 - 6 - r() * 16, z: -30 - r() * 90, v: 40 + r() * 60, x: r() * 300, len: 2 + r() * 4, c: ['#ff5ad0', '#7ae8ff', '#ffcf4a'][Math.floor(r() * 3)] }));
    return (u, frame) => {
      const t = clock(u), cam = u.camera.position.x, track = frame.blocks.some(b => b.art === 'track');
      sky.update(u); far.set(t * 6, cam * .85); near.set(t * 14, cam * .6);
      lower.set(cam, t0 - 16, -24, t * 70); lower.mesh.visible = !track;
      for (let i = 0; i < 4; i++) jets.set(i, cx + (i < 2 ? -1 : 1) * hw * .55, t0 - 2.8 - (i % 2) * .4, .2, 1.6 + Math.sin(u.seconds * 30 + i) * (u.reduced ? 0 : .25), 2.4, 0, i % 2 ? '#ffffff' : '#ed86ff', .8);
      jets.commit();
      cars.forEach((c, i) => traffic.set(i, cam + ((c.x - t * c.v) % 300 + 300) % 300 - 150, c.y, c.z, c.len, .18, Math.PI, c.c, .9));
      traffic.commit();
    };
  },
};

/** An F-Zero machine whose flat deck is its collision top: sleek hull, canopy and a glowing booster at the back (-x). */
function machine(b: { left: number; right: number; top: number; bottom: number }, body: string, stripe: string): BufferGeometry[] {
  const cx = (b.left + b.right) / 2, w = b.right - b.left, h = b.top - b.bottom, cy = b.bottom + h * .45;
  return [paint(at(new SphereGeometry(1, 16, 10), cx + w * .15, b.top + .05, -1.6, 0, w * .16, .45, .7), '#9ad8ff'),
    gradient(at(new ConeGeometry(h * .5, w * .3, 8), b.right - w * .15, cy, 1.6, -Math.PI / 2, 1, 1, .5), body, '#1a2438', b.bottom, b.top),
    paint(at(new BoxGeometry(w * .8, h * .18, .06), cx, cy, 1.45), stripe), paint(at(new CylinderGeometry(h * .35, h * .45, .6, 12), b.left + .25, cy, -2.3, Math.PI / 2), '#2a2c3a'),
    ...[-1, 1].map(s => paint(at(new BoxGeometry(w * .25, .08, .9), b.left + w * .2, b.top - .1, s * 1.8, 0, 1, 1, 1, 0, s * .3), stripe))];
}
const CARS: Record<string, [string, string]> = { flyer: ['#3a6ae8', '#ffcf4a'], 'car-l': ['#e84a4a', '#ffffff'], 'car-r': ['#4ac85a', '#ffe45c'] };
const bigBlue: StageModule = {
  lighting: { sky: '#e8f8ff', ground: '#3a5a7a', key: '#fffaf0', keyIntensity: 1.3, keyDir: [.3, .9, .5], rim: '#64ddfa', rimDir: [-.5, .35, -1], ambient: .6 },
  ground: neonMetal('#e0eaf4', '#3a6ae8', '#122048', '#ffcf4a'), slab: neonMetal('#f4f8ff', '#8a9ab8', '#2a3450', '#64ddfa'),
  hints: { car: neonMetal('#e8eef8', '#3a6ae8', '#122048', '#ffcf4a'), 'car-l': neonMetal('#f8e8e8', '#e84a4a', '#4a1018', '#ffffff'), 'car-r': neonMetal('#e8f8e8', '#3aa84a', '#103a18', '#ffe45c') },
  shape: { step: .3, round: .6, jag: 0 },
  piece(k, p, ctx) {
    if (p.kind !== 'block' || p.block.art !== 'car') return undefined;
    const b = p.rects[0], key = p.block.id.startsWith('flyer') ? 'flyer' : p.block.id, [body, stripe] = CARS[key] ?? CARS.flyer, g = new Group();
    g.add(new Mesh(massGeometry(p.rects, ...p.ledges, { round: .45, jag: 0, step: .2 }), ctx.material(key === 'flyer' ? 'car' : key)));
    if (p.block.id !== 'flyer-1') g.add(new Mesh(k.own(merge(machine(b, body, stripe))), k.lit()));
    return g;
  },
  hazard: false,
  build(k, { floor }) {
    const t0 = floor.top, sky = k.sky({ top: '#2a7ad8', mid: '#9ad8f8', bottom: '#f0fbff', horizon: -.1, sun: { dir: [-.35, .35, -1], color: '#ffffff', halo: '#fff4d0', size: .0025, glow: .9 } });
    const sea = farPlane(k, { y: t0 - 34, lit: '#e8fcff', mid: '#4ab8e0', shade: '#1a6aa8', horizon: '#f0fbff', scale: [.02, .03], speed: .4 });
    const city = looped(k, cityTile(7, 260, t0 - 34, 10, 40, -220, '#8aa8c8', '#fff8e0', ['#64ddfa', '#ffcf4a'], .25), 260, k.lit({ haze: ['#d8f0ff', .55] }), 0, -42);
    // The track under the racers: its surface is the top of the hazard zone, with a guard wall below the near edge.
    const track = road(k, { width: 260, depth: 12, base: '#4a5470', line: '#ffffff', rail: '#64ddfa' });
    const wall = k.add(new Mesh(k.own(gradient(new BoxGeometry(260, 3, .4), '#8a9ab8', '#2a3450', -1.5, 1.5)), k.lit())); wall.renderOrder = -10;
    const wind = particles(k, { count: 40, color: '#ffffff', speed: [0, 0], drift: -60, size: [2, 5], z: [-6, 3], spread: [60, 12], intensity: .35 });
    const clouds = cloudBank(k, { seed: 61, count: 8, z: [-60, -140], y: [t0 - 20, t0 + 20], s: [1.4, 2.6], speed: -12, top: '#ffffff', bottom: '#b8d8f0', haze: ['#f0fbff', .35] });
    const boost = k.glows(3);
    const lamps = sparkles(k, scatter(11, k.n(10), [-60, 60], [t0 - 7.3, t0 - 7.3], [-5.8, -5.8], [.5, .8]), '#64ddfa', .6);
    return (u, frame) => {
      const t = clock(u), cam = u.camera.position.x;
      sky.update(u); sea(u); city.set(t * 8, cam * .9); clouds(u); lamps(u);
      const top = frame.hazard?.zones[0]?.top ?? t0 - 7.6;
      track.set(cam, top, -1.5, t * 90); wall.position.set(cam, top - 1.5, 4.4);
      if (!u.reduced) wind(u);
      frame.blocks.filter(b => b.art === 'car' && b.id !== 'flyer-1').slice(0, 3).forEach((b, i) => { boost.set(i, b.left - .6, b.bottom + (b.top - b.bottom) * .45, .3, 1.8 + Math.sin(u.seconds * 40 + i) * (u.reduced ? 0 : .3), 1.1, 0, '#8ad8ff', .9); });
      boost.commit();
    };
  },
};

export default { 'mute-city': muteCity, 'big-blue': bigBlue } as const;
