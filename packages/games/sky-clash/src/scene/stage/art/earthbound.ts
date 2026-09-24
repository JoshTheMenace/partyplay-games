/** EarthBound series: Onett (main street, the drugstore and cars) and Fourside (rooftops at night and the UFO). */
import { AdditiveBlending, BoxGeometry, ConeGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, Mesh, PlaneGeometry, Shape, ShaderMaterial, SphereGeometry, TorusGeometry, type BufferGeometry, Color } from 'three';
import { at, gradient, massGeometry, merge, paint, rng, type Kit } from '../kit';
import { skyline, tree } from '../decor';
import type { StageModule } from '../index';
import { clock, cloudBank, hills, parallax, scatter, sparkles } from './common';
import { awningPiece, carBody, cranePiece, slab, ufoPiece } from './pieces';

type R = { left: number; right: number; top: number; bottom: number };
/** A grid of window panes on a block's front face (z = front), optionally lit. */
function windows(b: R, cols: number, rows: number, z: number, color: string, from = .18, to = .82) {
  const w = b.right - b.left, h = b.top - b.bottom, parts: BufferGeometry[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = b.left + w * (from + (to - from) * (i + .5) / cols), y = b.bottom + h * (from + (to - from) * (j + .5) / rows);
    parts.push(paint(at(new PlaneGeometry(w * (to - from) / cols * .62, h * (to - from) / rows * .62), x, y, z), color));
  }
  return parts;
}
/** An Onett house for the backdrop: box, pitched roof, door and two windows, rising from y. */
function house(x: number, y: number, z: number, w: number, h: number, wall: string, roof: string) {
  const s = new Shape(); s.moveTo(-w * .6, 0); s.lineTo(w * .6, 0); s.lineTo(0, h * .55); s.closePath();
  const gable = new ExtrudeGeometry(s, { depth: w * .8, bevelEnabled: false }); gable.translate(x, y + h, z - w * .4);
  return [paint(at(new BoxGeometry(w, h, w * .7), x, y + h / 2, z), wall), paint(gable, roof), paint(at(new PlaneGeometry(w * .18, h * .45), x, y + h * .23, z + w * .351), '#6a4a3a'),
    ...[-1, 1].map(d => paint(at(new PlaneGeometry(w * .2, h * .22), x + d * w * .3, y + h * .6, z + w * .351), '#ffe8a8'))];
}

const onett: StageModule = {
  lighting: { sky: '#fff4e0', ground: '#6a5a7a', key: '#ffe8c8', keyIntensity: 1.25, keyDir: [.45, .85, .55], rim: '#ffd178', rimDir: [-.5, .35, -1], ambient: .58 },
  ground: { style: 'stone', cap: '#9a98a4', capDark: '#7a7884', face: '#d8b898', faceDeep: '#7a5a5a', line: '#a88a78', lip: '#e8e4ec', trim: '#ffd178', capDepth: .28, wave: 0 },
  slab: { style: 'planks', cap: '#e8d8b8', face: '#9a6a4a', faceDeep: '#4a3028', line: '#5a3a2a', lip: '#fff4e0', capDepth: .05, wave: 0 },
  hints: {
    building: { style: 'brick', cap: '#8a8490', capDark: '#6a6470', face: '#c86a4a', faceDeep: '#6a2a2a', line: '#8a3a2a', lip: '#f0e0d0', trim: '#ffd178', capDepth: .18, wave: 0 },
    house: { style: 'planks', cap: '#7a6a8a', capDark: '#5a4a6a', face: '#a8c8e8', faceDeep: '#5a6a8a', line: '#7890b0', lip: '#ffffff', trim: '#ffd178', capDepth: .16, wave: 0 },
    roof: { style: 'roof', cap: '#c85a4a', capDark: '#9a3a2a', face: '#b84a3a', faceDeep: '#6a2a2a', line: '#8a2a1a', lip: '#ffd0a0', glow: '#ffe8a8', capDepth: .08, wave: 0 },
  },
  shape: { step: .3, round: .5, jag: .2 },
  piece(k, p, ctx) {
    if (p.kind === 'platform') {
      const pl = p.platform, w = pl.right - pl.left;
      if (pl.art === 'awning') return awningPiece(k, w, '#e84a4a', '#fff4e0');
      if (pl.art !== 'roof') return undefined;
      // The house's gable roof under the ridge platform, kept behind the fighters (z < 0).
      const s = new Shape(), drop = Math.max(.6, pl.y - 3.68); s.moveTo(-w * .5 - 1.3, -drop); s.lineTo(w * .5 + 1.3, -drop); s.lineTo(w * .5, 0); s.lineTo(-w * .5, 0); s.closePath();
      const roof = new ExtrudeGeometry(s, { depth: 2.2, bevelEnabled: false }); roof.translate(0, 0, -2.8);
      const g = new Group(); g.add(slab(w, ctx.material('roof', true), .14, .04), new Mesh(k.own(merge([paint(roof, '#c85a4a'), paint(at(new BoxGeometry(.5, 1.2, .5), w * .3, -.1, -1.8), '#8a4a3a')])), k.lit())); return g;
    }
    const b = p.rects[0], art = p.block.art;
    if (art !== 'building' && art !== 'house') return undefined;
    const g = new Group(), front = 1.42, parts: BufferGeometry[] = art === 'building'
      ? [...windows(b, 3, 2, front, '#bfe8ff', .12, .88), paint(at(new BoxGeometry((b.right - b.left) * .7, .6, .12), (b.left + b.right) / 2, b.top - .45, front + .02), '#2a5ab8'), paint(at(new PlaneGeometry((b.right - b.left) * .6, .3), (b.left + b.right) / 2, b.top - .45, front + .09), '#ffffff')]
      : [...windows(b, 2, 1, front, '#ffe8a8', .15, .85), paint(at(new PlaneGeometry(.9, 1.7), (b.left + b.right) / 2, b.bottom + .85, front + .01), '#7a4a3a')];
    g.add(new Mesh(massGeometry(p.rects, ...p.ledges, { round: .12, jag: 0, step: .05 }), ctx.material(art)), new Mesh(k.own(merge(parts)), k.flat()));
    return g;
  },
  hazard: { style: 'lane', color: '#ffd178', object: k => carBody(k, 3.4, 1.6, '#e84a4a') },
  build(k, { floor }) {
    const t0 = floor.top, sky = k.sky({ top: '#5a7ac8', mid: '#b8c8e8', bottom: '#ffe0b8', horizon: -.06, sun: { dir: [.5, .2, -1], color: '#fff6e0', halo: '#ffd8a0', size: .003, glow: 1 } });
    const r = rng(17), town: BufferGeometry[] = [];
    for (let i = 0; i < k.n(12); i++) town.push(...house(-66 + i * 12 + r() * 4, t0 - 2, -30 - (i % 3) * 6, 5 + r() * 2.5, 3.5 + r() * 2, ['#f0e0c0', '#c8e0f0', '#f0c8c8', '#e0f0c8'][i % 4], ['#c85a4a', '#5a7aa8', '#8a5a9a', '#4a8a5a'][i % 4]));
    for (let i = 0; i < k.n(10); i++) town.push(at(tree(40 + i, 5 + r() * 3, '#7a5236', '#6ab84a', '#2f7a3a'), -60 + i * 13 + r() * 5, t0 - 2, -24 - r() * 16));
    // Telephone poles and wires along the far sidewalk.
    for (let i = 0; i < 6; i++) town.push(paint(at(new CylinderGeometry(.12, .14, 7, 6), -40 + i * 16, t0 + 3.5, -6), '#6a4a3a'), paint(at(new BoxGeometry(2, .12, .12), -40 + i * 16, t0 + 6.6, -6), '#6a4a3a'));
    for (let i = 0; i < 5; i++) for (const y of [6.5, 6.1]) town.push(paint(at(new BoxGeometry(16, .03, .03), -32 + i * 16, t0 + y - .25, -6), '#2a2a3a'));
    hills(k, [[-70, t0 - 3, -90, 90, 22], [30, t0 - 3, -110, 120, 30], [110, t0 - 3, -80, 70, 18]], '#8ac86a', '#4a7a4a', ['#c8d0e8', .45], town);
    const clouds = cloudBank(k, { seed: 71, count: 7, z: [-80, -140], y: [t0 + 10, t0 + 24], s: [1.4, 2.4], speed: .4, top: '#ffffff', bottom: '#e8c8b8', haze: ['#ffe0b8', .35] });
    // Road markings: the dashed centre line along the street top.
    const lines: BufferGeometry[] = [];
    for (let x = floor.left + 1; x < floor.right - 1; x += 2.4) lines.push(paint(at(new PlaneGeometry(1.2, .14).rotateX(-Math.PI / 2), x, t0 + .004, .7), '#ffe070'));
    k.batch(lines, k.flat());
    return u => { sky.update(u); clouds(u); };
  },
};
/** Searchlight beams sweeping the night sky from behind the skyline. */
function searchlights(k: Kit, spots: readonly [number, number, number][]) {
  const material = k.own(new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, uniforms: { uColor: { value: new Color('#a4a2ff') } },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`uniform vec3 uColor; varying vec2 vUv; void main(){ float a = (1. - vUv.y) * pow(1. - abs(vUv.x * 2. - 1.), 2.) * .35; gl_FragColor = vec4(uColor * a, 1.); }`,
  }));
  const beams = spots.map(([x, y, z]) => { const m = k.add(new Mesh(k.own(new PlaneGeometry(6, 120).translate(0, 60, 0)), material)); m.position.set(x, y, z); m.renderOrder = -44; return m; });
  return (t: number) => beams.forEach((m, i) => { m.rotation.z = Math.sin(t * .25 + i * 2.1) * .45; });
}
const fourside: StageModule = {
  lighting: { sky: '#8a8ad8', ground: '#141c3c', key: '#d8d8ff', keyIntensity: 1.05, keyDir: [-.3, .85, .6], rim: '#a4a2ff', rimDir: [.5, .35, -1], ambient: .5 },
  ground: { style: 'roof', cap: '#6a6a88', capDark: '#4a4a66', face: '#4a4e72', faceDeep: '#0c1024', line: '#1a1e3a', lip: '#b8b8e0', trim: '#ffe890', glow: '#ffe890', capDepth: .1, wave: 0 },
  hints: {
    building: { style: 'roof', cap: '#6a6a88', capDark: '#4a4a66', face: '#4a4e72', faceDeep: '#0c1024', line: '#1a1e3a', lip: '#b8b8e0', trim: '#ffe890', glow: '#ffe890', capDepth: .1, wave: 0 },
    ufo: { style: 'metal', cap: '#e0e4f0', face: '#9a9ab8', faceDeep: '#3a3a5a', line: '#6a6a8a', lip: '#ffffff', trim: '#a4a2ff', capDepth: .04, wave: 0 },
  },
  slab: { style: 'metal', cap: '#ffd84a', face: '#c89a1a', faceDeep: '#5a4010', line: '#6a4a10', lip: '#fff4b0', trim: '#2a2a3a', capDepth: .05, wave: 0 },
  shape: { round: .1, step: .05, jag: 0 },
  piece(k, p, ctx) {
    if (p.kind === 'platform') {
      const w = p.platform.right - p.platform.left;
      return p.platform.art === 'crane' ? cranePiece(k, w, ctx.slab) : p.platform.art === 'ufo' ? ufoPiece(k, w, ctx.material('ufo', true)) : undefined;
    }
    // Rooftop clutter behind the fighters: vents, a water tower, an antenna and a helipad ring on the tower.
    const b = p.rects[0], cx = (b.left + b.right) / 2, w = b.right - b.left, g = new Group(), parts: BufferGeometry[] = [];
    if (p.block.id === 'tower') parts.push(paint(new TorusGeometry(1.2, .08, 4, 32).rotateX(Math.PI / 2).scale(1, .1, 1).translate(cx, b.top + .01, -.8), '#ffe890'), paint(at(new BoxGeometry(.9, .02, .12), cx, b.top + .01, -.8), '#ffe890'),
      paint(at(new CylinderGeometry(.05, .08, 6, 5), cx + w * .35, b.top + 3, -2.4), '#8a8aa8'), paint(at(new SphereGeometry(.18, 8, 6), cx + w * .35, b.top + 6, -2.4), '#ff4a4a'));
    if (p.block.id === 'west') parts.push(gradient(at(new CylinderGeometry(1.1, 1.1, 2, 12), cx - w * .2, b.top + 2.2, -2.2), '#8a6a4a', '#4a3a2a', b.top + 1.2, b.top + 3.2), paint(at(new ConeGeometry(1.25, .8, 12), cx - w * .2, b.top + 3.6, -2.2), '#5a4a3a'),
      ...[-1, 1].map(d => paint(at(new BoxGeometry(.12, 1.2, .12), cx - w * .2 + d * .8, b.top + .6, -2.2), '#3a3a4a')));
    if (p.block.id === 'east') parts.push(...[-.3, .1].map(f => paint(at(new BoxGeometry(1.4, .9, 1.2), cx + f * w, b.top + .45, -2), '#8a8ea8')));
    g.add(new Mesh(massGeometry(p.rects, ...p.ledges, { round: .1, jag: 0, step: .05 }), ctx.material('building')));
    if (parts.length) g.add(new Mesh(k.own(merge(parts)), k.lit()));
    return g;
  },
  hazard: false,
  build(k, { floor }) {
    const t0 = floor.top, sky = k.sky({ top: '#04061a', mid: '#141c4a', bottom: '#3a2a6a', horizon: -.12, stars: .9, starColor: '#fff8e0', sun: { dir: [-.45, .35, -1], color: '#fff4c8', halo: '#a4a2ff', size: .004, glow: .6 } });
    const layers = [skyline(3, -260, 260, t0 - 60, 30, 90, -180, '#1a2046', '#ffe890', .3, 8), skyline(5, -180, 180, t0 - 50, 24, 70, -100, '#222a58', '#ffe890', .4, 6), skyline(8, -120, 120, t0 - 40, 20, 46, -45, '#2a3264', '#fff0b0', .45, 5)];
    const far = parallax(k, layers.map((geo, i) => ({ geo, follow: .7 - i * .2 })));
    const beams = searchlights(k, [[-50, t0 - 20, -150], [40, t0 - 20, -170], [110, t0 - 20, -160]]);
    const glow = sparkles(k, scatter(19, k.n(18), [-40, 40], [t0 - 10, t0 + 12], [-30, -60], [.4, .9]), '#ff6a6a', .6);
    return u => { const t = clock(u); sky.update(u); far(u); beams(t); glow(u); };
  },
};

export default { onett, fourside } as const;
