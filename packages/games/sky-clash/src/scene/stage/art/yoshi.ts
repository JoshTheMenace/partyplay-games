/** Yoshi series: Yoshi's Story (cardboard storybook), Yoshi's Island (crayon pastel), Yoshi's Island 64. */
import { BoxGeometry, CircleGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, type BufferGeometry } from 'three';
import { at, gradient, merge, paint, rng, silhouetteGeometry } from '../kit';
import { ridge } from '../decor';
import type { StageModule } from '../index';
import { cloudBank, drifters, hills, scatter } from './common';
import { cloudPiece } from './pieces';

/** A cardboard cutout: a flat shape with a darker offset backing, like layered paper. */
function cutout(outline: [number, number][], base: number, z: number, face: string, edge: string) {
  return [silhouetteGeometry(outline, base, z, face, face), at(silhouetteGeometry(outline.map(([x, y]) => [x + .35, y - .35]), base - .35, z - .15, edge, edge), 0, 0, 0)];
}
/** A cardboard flower: petal disc, center and stem. */
function flower(x: number, y: number, z: number, s: number, petal: string) {
  return [paint(at(new CylinderGeometry(.08 * s, .08 * s, 2 * s, 5), x, y + s, z), '#3a9a3a'), paint(at(new CircleGeometry(.8 * s, 8), x, y + 2.1 * s, z + .05), petal), paint(at(new CircleGeometry(.35 * s, 12), x, y + 2.1 * s, z + .1), '#ffd85a')];
}
/** A Shy Guy on a propeller: red body, white mask. */
const shyGuy = () => merge([gradient(new SphereGeometry(.55, 12, 8), '#ff4a4a', '#b82020', -.5, .5), paint(at(new SphereGeometry(.34, 10, 8), 0, .1, .35, 0, 1, 1, .5), '#ffffff'),
  paint(at(new BoxGeometry(1.6, .06, .2), 0, .9, 0), '#ffd85a'), paint(at(new CylinderGeometry(.04, .04, .4, 4), 0, .7, 0), '#6a4a2a')]);

const yoshiStory: StageModule = {
  lighting: { sky: '#fffaf0', ground: '#8fd0e8', key: '#fff6e0', keyIntensity: 1.25, keyDir: [.3, .9, .6], rim: '#f48faf', rimDir: [-.5, .3, -1], ambient: .64 },
  ground: { style: 'quilt', cap: '#8ad05a', capDark: '#5aa03a', face: '#f7c8a0', faceDeep: '#c07a8a', line: '#f48faf', lip: '#fffaf0', trim: '#ffd85a', capDepth: .3, wave: .5 },
  slab: { style: 'quilt', cap: '#ffd85a', capDark: '#e0a83a', face: '#f48faf', faceDeep: '#b85a7a', line: '#8fd0e8', lip: '#fffaf0', capDepth: .08, wave: 0 },
  shape: { step: .3, round: 1.2, jag: .3 },
  piece(k, p, ctx) { return p.kind === 'platform' && p.platform.art === 'cloud' ? cloudPiece(k, p.platform.right - p.platform.left, ctx.material('cloud', true), 5) : undefined; },
  hints: { cloud: { style: 'cloud', cap: '#ffffff', face: '#f0f4ff', faceDeep: '#c8d8f0', lip: '#ffffff', capDepth: .1, wave: .4 } },
  hazard: false,
  build(k, { floor }) {
    const sky = k.sky({ top: '#6ac0e8', mid: '#b8e8f0', bottom: '#fff2c8', horizon: -.05 });
    const t = floor.top, parts: BufferGeometry[] = [
      ...cutout(ridge(2, -90, 90, t - 4, t + 10, 6, .2), t - 20, -60, '#6ac06a', '#3a7a4a'), ...cutout(ridge(3, -70, 70, t - 6, t + 5, 5, .1), t - 20, -38, '#a8e070', '#6aa04a'),
      ...cutout(ridge(4, -50, 50, t - 8, t - 1, 6, .1), t - 20, -22, '#ffd0a0', '#d08a6a')];
    // The cardboard sun with a smile, and giant flowers stuck in the hills.
    parts.push(paint(at(new CircleGeometry(6, 24), 34, t + 22, -70), '#ffd85a'), paint(at(new CircleGeometry(4.6, 24), 34, t + 22, -69.9), '#ffe890'));
    for (const s of [-1, 1]) parts.push(paint(at(new CircleGeometry(.5, 10), 34 + s * 1.6, t + 23, -69.8), '#6a3a2a'));
    parts.push(paint(at(new BoxGeometry(2.6, .35, .1), 34, t + 20.6, -69.8), '#e0503a'));
    const r = rng(8);
    for (let i = 0; i < k.n(10); i++) parts.push(...flower(-40 + i * 9 + r() * 3, t - 6 + r() * 2, -30 + r() * 4, 1 + r() * .8, ['#ff7aa8', '#ffffff', '#b88aff', '#ff9a4a'][i % 4]));
    k.batch(parts, k.flat()).renderOrder = -40;
    const clouds = cloudBank(k, { seed: 23, count: 7, z: [-50, -80], y: [t + 10, t + 22], s: [1, 1.8], speed: .5, top: '#ffffff', bottom: '#d8e8f8', haze: ['#b8e8f0', .15] });
    const guys = drifters(k, shyGuy(), ['#b8e8f0', .15], scatter(3, k.n(5), [-24, 24], [t + 4, t + 12], [-14, -22], [.8, 1.1]), 1.2);
    return u => { sky.update(u); clouds(u); guys(u); };
  },
};

const yoshiIsland: StageModule = {
  lighting: { sky: '#fff8e0', ground: '#6ba7d0', key: '#fff4e0', keyIntensity: 1.2, keyDir: [.3, .9, .6], rim: '#ffc571', rimDir: [-.5, .3, -1], ambient: .64 },
  ground: { style: 'soil', cap: '#b8cf78', capDark: '#88a858', face: '#e8b888', faceDeep: '#a07a8a', line: '#c89878', lip: '#fff8e0', trim: '#ffc571', capDepth: .35, wave: .8 },
  hints: { cloud: { style: 'cloud', cap: '#ffffff', face: '#f8f8ff', faceDeep: '#d0d8f0', lip: '#ffffff', capDepth: .1, wave: .4 }, 'spin-block': { style: 'metal', cap: '#ffe060', face: '#ffc830', faceDeep: '#b87a10', line: '#8a5a00', lip: '#fff8c0', trim: '#ffffff', capDepth: .05, wave: 0 } },
  shape: { round: 2, jag: .6 },
  piece(k, p, ctx) {
    if (p.kind !== 'platform') return undefined;
    const w = p.platform.right - p.platform.left;
    if (p.platform.art === 'cloud') return cloudPiece(k, w, ctx.material('cloud', true), 9);
    if (p.platform.art === 'spin-block') {
      // A row of square spin blocks, top flush at y = 0.
      const n = Math.max(1, Math.round(w / .95)), size = w / n, g = new Group();
      g.add(new Mesh(k.own(merge(Array.from({ length: n }, (_, i) => merge([paint(at(new BoxGeometry(size * .96, size * .96, 1.2), -w / 2 + (i + .5) * size, -size / 2, 0), '#ffc830'), paint(at(new BoxGeometry(size * .5, size * .5, .02), -w / 2 + (i + .5) * size, -size / 2, .61), '#fff0a0')])))), k.lit()));
      return g;
    }
    return undefined;
  },
  hazard: false,
  build(k, { floor }) {
    const sky = k.sky({ top: '#6ba7d0', mid: '#bfe0f0', bottom: '#fff4e0', horizon: -.08 });
    const t = floor.top, r = rng(14), dots: BufferGeometry[] = [];
    // Crayon hills dotted with flowers, and pastel mountains far behind.
    for (let i = 0; i < k.n(14); i++) dots.push(...flower(-34 + r() * 68, t - 12 + r() * 2, -18 - r() * 4, .7 + r() * .4, ['#ffffff', '#ffb0d0', '#fff0a0'][i % 3]));
    k.batch([silhouetteGeometry(ridge(6, -150, 150, t, t + 22, 7, .6), t - 20, -120, '#b8c8e8', '#e8f0ff')], k.flat()).renderOrder = -42;
    hills(k, [[-30, t - 12, -32, 34, 14], [0, t - 12, -38, 30, 10], [30, t - 12, -30, 38, 16], [-65, t - 12, -40, 40, 12], [68, t - 12, -44, 36, 10]], '#a8d878', '#6aa04a', ['#bfe0f0', .15]);
    k.batch(dots, k.flat()).renderOrder = -39;
    const clouds = cloudBank(k, { seed: 25, count: 8, z: [-50, -90], y: [t + 6, t + 20], s: [1, 1.8], speed: .4, top: '#ffffff', bottom: '#e0e8ff', haze: ['#bfe0f0', .15] });
    return u => { sky.update(u); clouds(u); };
  },
};

const yoshiIsland64: StageModule = {
  lighting: { sky: '#fffaf0', ground: '#8abbd4', key: '#fff2d8', keyIntensity: 1.25, keyDir: [.4, .9, .5], rim: '#f8d390', rimDir: [-.5, .3, -1], ambient: .62 },
  ground: { style: 'soil', cap: '#7ad04a', capDark: '#4a9a2a', face: '#d8a868', faceDeep: '#8a5a3a', line: '#a87848', lip: '#e8ffc0', trim: '#f8d390', capDepth: .4, wave: .9 },
  slab: { style: 'quilt', cap: '#ffffff', face: '#ff9ab8', faceDeep: '#c85a7a', line: '#ffd85a', lip: '#ffffff', capDepth: .06, wave: 0 },
  hints: { cloud: { style: 'cloud', cap: '#ffffff', face: '#f8f8ff', faceDeep: '#d0d8f0', lip: '#ffffff', capDepth: .1, wave: .4 } },
  shape: { step: .4, round: 1.6, jag: .6 },
  piece(k, p, ctx) { return p.kind === 'platform' && p.platform.art === 'cloud' ? cloudPiece(k, p.platform.right - p.platform.left, ctx.material('cloud', true), 13) : undefined; },
  hazard: false,
  build(k, { floor }) {
    const sky = k.sky({ top: '#4a90d0', mid: '#a8d8f0', bottom: '#fff0c8', horizon: -.06, sun: { dir: [-.4, .3, -1], color: '#fffbe8', halo: '#fff0b0', size: .003, glow: .8 } });
    const t = floor.top, r = rng(21), extra: BufferGeometry[] = [];
    // A giant smiling sunflower and palm-topped hills, N64 style.
    extra.push(paint(at(new CylinderGeometry(.5, .6, 16, 8), -18, t - 2, -50), '#4a9a2a'));
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; extra.push(paint(at(new SphereGeometry(1.6, 8, 6), -18 + Math.cos(a) * 3, t + 6 + Math.sin(a) * 3, -49.5, 0, 1, .5, .3), '#ffd84a')); }
    extra.push(paint(at(new SphereGeometry(2.6, 16, 10), -18, t + 6, -49, 0, 1, 1, .4), '#a86a2a'));
    for (const s of [-1, 1]) extra.push(paint(at(new SphereGeometry(.35, 8, 6), -18 + s * .9, t + 6.6, -48), '#2a1a0a'));
    const blooms: BufferGeometry[] = [];
    for (let i = 0; i < k.n(12); i++) blooms.push(...flower(-40 + r() * 80, t - 10 + r() * 3, -22 - r() * 6, .8 + r() * .5, ['#ff5a8a', '#ffffff', '#ffd84a'][i % 3]));
    k.batch(blooms, k.flat()).renderOrder = -39;
    hills(k, [[-40, t - 10, -40, 50, 18], [10, t - 10, -50, 60, 22], [55, t - 10, -38, 40, 14], [-90, t - 10, -70, 70, 20], [90, t - 10, -80, 80, 26]], '#8ae05a', '#3a8a3a', ['#a8d8f0', .2], extra);
    const clouds = cloudBank(k, { seed: 27, count: 8, z: [-60, -110], y: [t + 8, t + 22], s: [1.2, 2.2], speed: .4, top: '#ffffff', bottom: '#d0e0f8', haze: ['#a8d8f0', .25] });
    return u => { sky.update(u); clouds(u); };
  },
};

export default { 'yoshi-story': yoshiStory, 'yoshi-island': yoshiIsland, 'yoshi-island-64': yoshiIsland64 } as const;
