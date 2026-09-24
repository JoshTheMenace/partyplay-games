/** Pokémon series: Pokémon Stadium (the big screen and four transformations) and Poké Floats (the balloon parade). */
import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group, Mesh, PlaneGeometry, ShaderMaterial, SphereGeometry, TorusGeometry, type BufferGeometry } from 'three';
import { GLSL_NOISE, at, gradient, massGeometry, merge, paint, rng, type Kit, type SurfaceOptions } from '../kit';
import type { StageModule } from '../index';
import { clock, cloudBank, drifters, farPlane, scatter, sparkles } from './common';
import { slab } from './pieces';

const TYPES = { fire: '#ff6a3a', grass: '#5ad04a', rock: '#b8a07a', water: '#4aa8ff' } as const;
type TypeName = keyof typeof TYPES;
const isType = (s: string | undefined): s is TypeName => !!s && s in TYPES;

/** The stadium bowl: a slanted ring of stands behind the stage with a noisy, cheering crowd. */
function stands(k: Kit) {
  const material = k.own(new ShaderMaterial({
    side: DoubleSide, uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`uniform float uTime; varying vec2 vUv; ${GLSL_NOISE}
      void main(){
        vec2 cell = floor(vec2(vUv.x * 420., vUv.y * 38.)), f = fract(vec2(vUv.x * 420., vUv.y * 38.));
        float h = hash(cell), jump = step(.93, fract(h * 13. + uTime * (.4 + h))) * .12;
        vec3 fan = .5 + .5 * cos(6.283 * (h + vec3(0., .33, .67)));
        float head = smoothstep(.36, .3, length(f - vec2(.5, .42 + jump)));
        vec3 seat = mix(vec3(.13, .16, .26), vec3(.22, .28, .42), step(.5, fract(vUv.y * 38. * .5)));
        vec3 col = mix(seat, mix(fan, vec3(1.), .25), head * step(.25, h));
        float band = smoothstep(.0, .02, abs(fract(vUv.y * 4.) - .5) - .47);
        col = mix(col, vec3(.82, .86, .94), band);
        col = mix(col, vec3(.6, .72, .92), .12);
        gl_FragColor = vec4(col, 1.);
        #include <colorspace_fragment>
      }`,
  }));
  const bowl = k.add(new Mesh(k.own(new CylinderGeometry(96, 58, 34, 72, 1, true, Math.PI / 2, Math.PI)), material)); bowl.position.set(0, 3, -10); bowl.renderOrder = -45;
  return (t: number) => { material.uniforms.uTime.value = t; };
}
/** The big screen: shows a Poké Ball, then flashes the coming type during the warning and holds it while active. */
function screen(k: Kit, x: number, y: number, z: number, w: number, h: number) {
  const material = k.own(new ShaderMaterial({
    uniforms: { uColor: { value: new Color('#3a78e8') }, uType: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 }, uAspect: { value: w / h } },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`uniform vec3 uColor; uniform float uType, uFlash, uTime, uAspect; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - .5) * vec2(uAspect, 1.); float r = length(p);
        vec3 bg = mix(uColor * .55, uColor, smoothstep(.9, 0., r)) + .08 * step(.5, fract(vUv.y * 90.));
        vec3 col = bg;
        float ball = smoothstep(.36, .35, r), band = smoothstep(.035, .025, abs(p.y)), button = smoothstep(.1, .09, r), ring = smoothstep(.13, .12, r);
        vec3 top = uType > .5 ? mix(uColor, vec3(1.), .35) : vec3(.93, .2, .22);
        col = mix(col, p.y > 0. ? top : vec3(.96), ball); col = mix(col, vec3(.08), max(band * ball, ring)); col = mix(col, vec3(.96), button);
        col = mix(col, vec3(1.), uFlash * (.5 + .5 * sin(uTime * 14.)) * .6);
        gl_FragColor = vec4(col, 1.);
        #include <colorspace_fragment>
      }`,
  }));
  const frame = k.batch([gradient(at(new BoxGeometry(w + 1.2, h + 1.2, .8), x, y, z - .5), '#4a5470', '#1a2030', y - h / 2, y + h / 2), paint(at(new BoxGeometry(1.2, 12, .8), x, y - h / 2 - 6, z - 1), '#2a3044')], k.lit());
  frame.renderOrder = -44;
  const panel = k.add(new Mesh(k.own(new PlaneGeometry(w, h)), material)); panel.position.set(x, y, z - .05); panel.renderOrder = -43;
  return material;
}

const arenaMetal: SurfaceOptions = { style: 'metal', cap: '#e4eaee', capDark: '#b8c2ca', face: '#8e9aa8', faceDeep: '#2e3648', line: '#5a6678', lip: '#ffffff', trim: '#e84a4a', capDepth: .12, wave: 0 };
const stadium: StageModule = {
  lighting: { sky: '#e8f2ff', ground: '#5a7aa8', key: '#fff8ee', keyIntensity: 1.25, keyDir: [.3, .9, .55], rim: '#9ad0ff', rimDir: [-.5, .35, -1], ambient: .6 },
  ground: arenaMetal, slab: { ...arenaMetal, cap: '#f4f6f8', face: '#e84a4a', faceDeep: '#8a1a24', line: '#a8323e', lip: '#ffffff', capDepth: .06 },
  shape: { step: .25, round: .5, jag: 0 },
  hints: {
    fire: { style: 'rock', cap: '#e8844a', capDark: '#b8542a', face: '#9a4a2a', faceDeep: '#3a1410', line: '#5a2010', lip: '#ffd08a', capDepth: .16, wave: .5 },
    grass: { style: 'soil', cap: '#6ad04a', capDark: '#3a9a2a', face: '#8a6a3a', faceDeep: '#3a2a18', line: '#5a4020', lip: '#d8ffb0', capDepth: .3, wave: .8 },
    rock: { style: 'rock', cap: '#c8bca8', capDark: '#9a8e7a', face: '#8a8070', faceDeep: '#2e2a26', line: '#4a443a', lip: '#f0e8d8', capDepth: .12, wave: .4 },
    water: { style: 'planks', cap: '#e0c890', capDark: '#b89860', face: '#8a6a44', faceDeep: '#2a3a5a', line: '#4a3420', lip: '#fff0c8', capDepth: .08, wave: 0 },
  },
  hazard: false,
  build(k, { floor }) {
    const t0 = floor.top, sky = k.sky({ top: '#2a6ad8', mid: '#8ec4f8', bottom: '#e8f4ff', horizon: -.02, sun: { dir: [.45, .4, -1], color: '#fffbe8', halo: '#fff2c0', size: .002, glow: .8 } });
    const crowd = stands(k), board = screen(k, 0, t0 + 9.5, -44, 17, 9.5);
    const field = farPlane(k, { y: t0 - 9, lit: '#8ae070', mid: '#5ab84a', shade: '#3a8a3a', horizon: '#d8ecff', scale: [.02, .5], speed: 0, bands: [.3, .6] });
    // Floodlight towers and the stage's red-and-white base plinth below the floor.
    const towers: BufferGeometry[] = [], lamp: [number, number, number, number][] = [];
    for (const x of [-46, -24, 24, 46]) { towers.push(gradient(at(new BoxGeometry(1, 30, 1), x, t0 + 4, -58 - Math.abs(x) * .2), '#c8d0e0', '#5a6478', t0 - 11, t0 + 19), paint(at(new BoxGeometry(5, 3, .6), x, t0 + 19, -58 - Math.abs(x) * .2), '#e8ecf4')); lamp.push([x, t0 + 19, -57 - Math.abs(x) * .2, 8]); }
    towers.push(gradient(at(new CylinderGeometry(4.5, 5.5, 5, 32), 0, t0 - 7, -1.5), '#e84a4a', '#8a1a24', t0 - 9.5, t0 - 4.5), paint(at(new TorusGeometry(4.6, .18, 6, 40), 0, t0 - 4.6, -1.5, 0, 1, 1, 1, Math.PI / 2), '#ffffff'));
    k.batch(towers, k.lit({ haze: ['#cfe4ff', .2] }));
    const lights = sparkles(k, lamp, '#fff8d8', .9);
    const clouds = cloudBank(k, { seed: 41, count: 6, z: [-120, -200], y: [t0 + 14, t0 + 30], s: [1.6, 2.6], speed: .3, top: '#ffffff', bottom: '#b8d4f8', haze: ['#e8f4ff', .4] });
    // Terrain vents under the stage glow in the active type's color while it transforms.
    const vents = k.glows(4), tint = new Color();
    return (u, frame) => {
      const t = clock(u); sky.update(u); crowd(t); field(u); lights(u); clouds(u);
      const kind = frame.blocks.map(b => b.art).find(isType) ?? (frame.hazard?.warning && frame.hazard.label.toLowerCase() in TYPES ? frame.hazard.label.toLowerCase() as TypeName : undefined);
      const warn = !!frame.hazard?.warning;
      board.uniforms.uColor.value.set(kind ? TYPES[kind] : '#3a78e8'); board.uniforms.uType.value = kind ? 1 : 0; board.uniforms.uFlash.value = warn && !u.reduced ? 1 : 0; board.uniforms.uTime.value = u.seconds;
      tint.set(kind ? TYPES[kind] : '#9ad0ff');
      for (let i = 0; i < 4; i++) vents.set(i, (i - 1.5) * 3.2, t0 - 4.9, 1.8, kind ? 2.4 + Math.sin(t * 3 + i) * .3 : 1.2, .7, 0, tint, kind ? .7 : .25);
      vents.commit();
    };
  },
};

// ── Poké Floats: collision-exact balloon figures (floors at their tops, walls at their sides) ──
const balloon = (cap: string, face: string, deep: string, lip = '#ffffff'): SurfaceOptions => ({ style: 'cloud', cap, capDark: face, face, faceDeep: deep, lip, trim: '#ffe45c', capDepth: .18, wave: .2, lipWidth: .05 });
const FLOATS: Record<string, SurfaceOptions> = {
  squirtle: balloon('#9ad8f8', '#5aa8e0', '#2a5a9a'), onix: { style: 'rock', cap: '#c8c4cc', capDark: '#9a96a4', face: '#8a8698', faceDeep: '#3a3848', line: '#5a5668', lip: '#f0eef8', trim: '#ffe45c', capDepth: .1, wave: .3 },
  poliwag: balloon('#8ab0f8', '#4a70d8', '#1a2a7a'), porygon: { style: 'quilt', cap: '#ff9ab8', capDark: '#e06a90', face: '#4ac8e8', faceDeep: '#1a5a8a', line: '#ff7aa0', lip: '#ffffff', trim: '#ffe45c', capDepth: .14, wave: 0 },
  snorlax: balloon('#f4e6c4', '#3a7a8a', '#123a48', '#fff8e8'),
};
const eyes = (x: number, y: number, z: number, gap: number, s: number, white = '#ffffff') => [-1, 1].flatMap(d => [paint(at(new SphereGeometry(s, 10, 8), x + d * gap, y, z, 0, 1, 1.2, .5), white), paint(at(new SphereGeometry(s * .5, 8, 6), x + d * gap, y - s * .1, z + s * .3), '#1a1a2a')]);
/** Decoration for a float block, in world space at its first rect; the collision mass itself is drawn by massGeometry. */
function floatDecor(art: string, b: { left: number; right: number; top: number; bottom: number }): BufferGeometry[] {
  const cx = (b.left + b.right) / 2, w = b.right - b.left, h = b.top - b.bottom, cy = (b.top + b.bottom) / 2;
  switch (art) {
    case 'squirtle': return [gradient(at(new SphereGeometry(1, 24, 12), cx - w * .1, cy, -2.6, 0, w * .42, h * .9, 1.4), '#c89048', '#6a4020', b.bottom, b.top), paint(at(new SphereGeometry(1, 18, 10), cx + w * .1, cy, -2.3, 0, w * .25, h * .6, 1), '#fff0b8'),
      paint(at(new CylinderGeometry(.5, .8, 1.6, 10), b.right + .3, cy, -1.2, Math.PI / 2 + .4), '#5aa8e0')];
    case 'onix': return b.top > 0 ? [paint(at(new ConeGeometry(.3, 1.4, 6), cx + w * .15, b.top + .5, -1.6), '#8a8698'), ...eyes(cx + w * .3, cy + h * .2, 1.45, .45, .28, '#f8f8f0')] : [];
    case 'poliwag': return [paint(at(new SphereGeometry(1, 20, 12), cx, cy, -1.8, 0, w * .32, h * .6, 1.4), '#f4f4ff'), paint(at(new TorusGeometry(.7, .12, 6, 24), cx, cy, -.4), '#1a2a4a'), paint(at(new TorusGeometry(.35, .1, 6, 20), cx, cy, -.35), '#1a2a4a'), ...eyes(cx - w * .12, b.top - .5, 1.45, .7, .32)];
    case 'porygon': return [paint(at(new BoxGeometry(.9, .6, .6), b.left + .2, cy, 1.5), '#ff9ab8'), ...eyes(b.left + w * .3, b.top - .45, 1.45, .35, .22)];
    case 'snorlax': return [paint(at(new SphereGeometry(1, 20, 12), cx, b.top - .3, -2.2, 0, w * .42, h * .7, 1.6), '#f4e6c4'),
      ...[-1, 1].map(d => paint(at(new SphereGeometry(1, 12, 8), cx + d * (w / 2 - 1), cy, 1.5, 0, .9, .8, .6), '#3a7a8a'))];
    default: return [];
  }
}
const pokeFloats: StageModule = {
  lighting: { sky: '#fff0fa', ground: '#8a78c8', key: '#fff6ec', keyIntensity: 1.2, keyDir: [.3, .9, .6], rim: '#ffaace', rimDir: [.5, .3, -1], ambient: .62 },
  ground: FLOATS.squirtle, slab: balloon('#ffffff', '#ffc8e0', '#b88aa8'), hints: FLOATS,
  piece(k, p, ctx) {
    if (p.kind === 'platform') {
      const pl = p.platform, w = pl.right - pl.left, g = new Group(); g.add(slab(w, ctx.slab, .2, .1));
      // The float part that carries each top: Squirtle's head, Poliwag's tail fin, Snorlax's belly.
      const decor = pl.id.startsWith('squirtle') ? [gradient(at(new SphereGeometry(w * .5, 24, 14), 0, -w * .5, -2.4), '#9ad8f8', '#3a78c0', -w, 0), ...eyes(0, -w * .35, -2.4 + w * .45, w * .18, w * .1)]
        : pl.id.startsWith('poliwag') ? [gradient(at(new SphereGeometry(1, 16, 10), 0, -.9, -1.8, 0, w * .5, .9, .5), '#8ab0f8', '#4a70d8', -1.8, 0)]
        : pl.id.startsWith('snorlax') ? [gradient(at(new SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0, -1.6, -2, 0, w * .5, 1.6, 1.4), '#fff4dc', '#d8c8a0', -1.6, 0)] : [];
      if (decor.length) g.add(new Mesh(k.own(merge(decor)), k.lit()));
      return g;
    }
    const art = p.block.art;
    if (!art || !(art in FLOATS)) return undefined;
    const g = new Group(), round = art === 'porygon' ? .08 : art === 'onix' ? .7 : 1.1;
    g.add(new Mesh(massGeometry(p.rects, ...p.ledges, { round, jag: 0, seed: art.length }), ctx.material(art)));
    const decor = floatDecor(art, p.rects[0]);
    if (decor.length) g.add(new Mesh(k.own(merge(decor)), k.lit()));
    return g;
  },
  hazard: false,
  build(k, { floor }) {
    const t0 = floor.top, sky = k.sky({ top: '#3a4a98', mid: '#c8a8e8', bottom: '#ffd8ec', horizon: -.06, stars: .25, starColor: '#fff4ff', sun: { dir: [-.4, .12, -1], color: '#fff8f0', halo: '#ffc8e0', size: .0025, glow: 1 } });
    const sea = farPlane(k, { y: t0 - 26, lit: '#ffffff', mid: '#ffd6ec', shade: '#b8a0e0', horizon: '#ffd8ec', speed: .08, scale: [.012, .03] });
    // Far balloons in the parade: Poké Balls and pastel blimps drifting past at several depths.
    const r = rng(7), ball = merge([paint(new SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#ff5a6a'), paint(at(new SphereGeometry(1, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0, 0, 0), '#ffffff'),
      paint(new TorusGeometry(1, .08, 5, 24, Math.PI * 2), '#2a2a3a'), paint(at(new CylinderGeometry(.28, .28, .1, 12), 0, 0, 1, Math.PI / 2, 1, 1, 1, Math.PI / 2), '#ffffff'), paint(at(new CylinderGeometry(.02, .02, 5, 3), 0, -3.4, 0), '#8a7aa8')]);
    const balls = drifters(k, ball, ['#e8c8f0', .35], scatter(r() * 99 | 0, k.n(9), [-90, 90], [t0 - 8, t0 + 22], [-50, -130], [1.4, 3.2]), 1.4);
    const low = cloudBank(k, { seed: 51, count: 8, z: [-30, -70], y: [t0 - 16, t0 - 8], s: [1.4, 2.4], speed: -2.2, top: '#ffffff', bottom: '#e0b8e0', haze: ['#ffd8ec', .3] });
    const high = cloudBank(k, { seed: 52, count: 5, z: [-80, -140], y: [t0 + 12, t0 + 26], s: [1.4, 2.4], speed: -1, top: '#fff8ff', bottom: '#c8b0e8', haze: ['#ffd8ec', .45] });
    const twinkles = sparkles(k, scatter(4, k.n(16), [-30, 30], [t0 - 4, t0 + 14], [-20, -40], [.4, .9]), '#fff0a0', .6);
    return u => { sky.update(u); sea(u); balls(u); low(u); high(u); twinkles(u); };
  },
};

export default { stadium, 'poke-floats': pokeFloats } as const;
