/** Donkey Kong series: Kongo Jungle, Jungle Japes, Kongo Jungle 64. */
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, type BufferGeometry } from 'three';
import { at, gradient, paint, rng, type Kit } from '../kit';
import { palm, tree } from '../decor';
import type { StageModule } from '../index';
import { curtain, farPlane, hills, scatter, sparkles } from './common';
import { barrelPiece, housePiece, jaws, slab } from './pieces';

/** A jungle wall: palms and broadleaf trees batched in rows at a depth. */
function canopy(k: Kit, seed: number, y: number, z: number, span: number, count: number, leaves: string, dark: string, trunk: string, haze: [string, number]) {
  const r = rng(seed), parts: BufferGeometry[] = [];
  for (let i = 0; i < k.n(count); i++) {
    const x = -span / 2 + span * (i + r() * .6) / count, h = 7 + r() * 7;
    parts.push(at(r() < .55 ? palm(seed + i, h, trunk, leaves, dark) : tree(seed + i, h, trunk, leaves, dark, 6, h * .32), x, y, z - r() * 8));
  }
  const mesh = k.batch(parts, k.lit({ haze })); mesh.renderOrder = -38; return mesh;
}
const wood = { style: 'planks', cap: '#c89058', capDark: '#a06a38', face: '#8a5a33', faceDeep: '#3a2418', line: '#4a2a14', lip: '#ffd9a0', trim: '#ffcf4a', capDepth: .12, wave: 0 } as const;

const kongoJungle: StageModule = {
  lighting: { sky: '#ffd8a8', ground: '#1f4a3a', key: '#ffcf8a', keyIntensity: 1.2, keyDir: [-.5, .7, .6], rim: '#ff9a4a', rimDir: [.6, .3, -1], ambient: .55 },
  ground: wood, slab: { ...wood, capDepth: .06 },
  shape: { step: .35, round: 1, jag: .5 },
  piece(k, p, ctx) { return p.kind === 'platform' && p.platform.art === 'barrel' ? barrelPiece(k, p.platform.right - p.platform.left, ctx.slab) : undefined; },
  hazard: { style: 'area', color: '#ffcf4a', object: k => jaws(k, 3.4, '#4a9a3a') },
  build(k, { floor }) {
    const sky = k.sky({ top: '#123c3a', mid: '#c87a4a', bottom: '#ffcf8a', horizon: -.02, sun: { dir: [-.5, .02, -1], color: '#fff0c0', halo: '#ff9a4a', size: .004, glow: 1.2 } });
    const fall = curtain(k, { x: 6.5, y: floor.top + 1, z: -44, w: 9, h: 36, light: '#e8fff8', dark: '#3a9a8a', speed: 1.2 });
    const river = farPlane(k, { y: floor.top - 14, lit: '#d8fff0', mid: '#3a9a8a', shade: '#1f5a50', horizon: '#ffcf8a', scale: [.04, .02], speed: .15 });
    hills(k, [[-9, floor.top - 16, -62, 20, 29], [22, floor.top - 16, -62, 20, 27], [-46, floor.top - 16, -84, 40, 20], [58, floor.top - 16, -88, 44, 18]], '#7a9a5a', '#3a4a2a', ['#d8905a', .55]);
    canopy(k, 3, floor.top - 14, -42, 130, 14, '#3f8a4a', '#1a3a2a', '#5a3a24', ['#c87a4a', .4]);
    canopy(k, 9, floor.top - 14, -70, 200, 18, '#2f6a4a', '#122a22', '#3a2a20', ['#c87a4a', .6]);
    // The deck's support trunk and branching roots under the platform.
    const trunk: BufferGeometry[] = [gradient(at(new CylinderGeometry(.9, 1.3, 14, 10), 0, floor.top - 10, -1.6), '#6a4428', '#2a1a10', floor.top - 17, floor.top - 3)];
    for (const s of [-1, 1]) trunk.push(paint(at(new CylinderGeometry(.18, .3, 5, 6), s * 2.4, floor.top - 5.3, -1.2, s * .7), '#4a2e1a'));
    k.batch(trunk, k.lit());
    const flies = sparkles(k, scatter(4, k.n(14), [-14, 14], [floor.top - 3, floor.top + 7], [-6, -14], [.25, .45]), '#ffe07a', .8);
    return u => { sky.update(u); fall(u); river(u); flies(u); };
  },
};

const japes: StageModule = {
  lighting: { sky: '#e8ffd8', ground: '#1a3a2c', key: '#fff4d8', keyIntensity: 1.1, keyDir: [.3, .9, .5], rim: '#5ad0e8', rimDir: [-.5, .3, -1], ambient: .52 },
  ground: { style: 'soil', cap: '#6fae4a', capDark: '#3f7a3a', face: '#7a5634', faceDeep: '#2a1a12', line: '#4a3020', lip: '#b8f090', trim: '#ffcf4a', capDepth: .35, wave: .8 },
  slab: wood,
  shape: { round: 1.2, jag: .8 },
  piece(k, p, ctx) {
    if (p.kind !== 'platform') return undefined;
    const w = p.platform.right - p.platform.left;
    if (p.platform.id === 'center') return housePiece(k, w, ctx.slab, 2.6, '#9a6a3a', '#5a3a1c');
    if (p.platform.id === 'roof') {
      const g = new Group(); g.add(slab(w, ctx.slab, .2, .05));
      g.add(new Mesh(k.own(gradient(at(new ConeGeometry(w * .6, 1.4, 4), 0, -.72, -1.2, 0, 1, 1, .45, 0, Math.PI / 4), '#c8a050', '#6a4a20', -1.4, 0)), k.lit())); return g;
    }
    return undefined;
  },
  hazard: { style: 'area', color: '#ffcf4a', object: k => jaws(k, 3.4, '#3a8a3a') },
  build(k, { floor }) {
    const sky = k.sky({ top: '#0f2a22', mid: '#3d6e4f', bottom: '#a8d8a0', horizon: .02 });
    const fall = curtain(k, { x: 0, y: floor.top + 1, z: -38, w: 11, h: 30, light: '#e8fff8', dark: '#3a8a8a', speed: 1.6 });
    const river = farPlane(k, { y: floor.top - 9, lit: '#e8fff0', mid: '#4ab8c8', shade: '#1f6a70', horizon: '#a8d8a0', scale: [.06, .015], speed: .6 });
    hills(k, [[-14, floor.top - 12, -44, 20, 29], [14, floor.top - 12, -44, 20, 29]], '#4a6a4a', '#1a2a22', ['#3d6e4f', .35]);
    canopy(k, 5, floor.top - 10, -30, 110, 14, '#4a9a4a', '#15361f', '#4a3020', ['#3d6e4f', .35]);
    canopy(k, 7, floor.top - 10, -55, 160, 20, '#3a7a4a', '#0f2a1a', '#2a2018', ['#3d6e4f', .55]);
    hills(k, [[-60, floor.top - 10, -90, 90, 30], [70, floor.top - 10, -100, 100, 36]], '#2f5a3a', '#0f2a1a', ['#3d6e4f', .5]);
    const mist = sparkles(k, scatter(6, k.n(10), [-10, 10], [floor.top - 9, floor.top - 6], [-30, -34], [3, 5]), '#e8fff0', .35);
    return u => { sky.update(u); fall(u); river(u); mist(u); };
  },
};

const kongo64: StageModule = {
  lighting: { sky: '#ffd8b8', ground: '#5a2a3a', key: '#ffb870', keyIntensity: 1.2, keyDir: [.6, .6, .6], rim: '#ff7a8a', rimDir: [-.6, .3, -1], ambient: .55 },
  ground: { ...wood, cap: '#d8a060', face: '#9a6030', faceDeep: '#4a1f2a' }, slab: { ...wood, cap: '#e0b070', capDepth: .06 },
  shape: { step: .35, round: 1.1, jag: .5 },
  piece(k, p, ctx) { return p.kind === 'platform' && p.platform.art === 'barrel' ? barrelPiece(k, p.platform.right - p.platform.left, ctx.slab) : undefined; },
  hazard: false,
  build(k, { floor }) {
    const sky = k.sky({ top: '#3a1a3a', mid: '#c86a6a', bottom: '#ffc080', horizon: -.03, sun: { dir: [.4, .01, -1], color: '#fff0b0', halo: '#ff8a5a', size: .006, glow: 1.3 }, stars: .25 });
    const water = farPlane(k, { y: floor.top - 12, lit: '#ffd8b0', mid: '#b86a6a', shade: '#5a2a4a', horizon: '#ffc080', scale: [.03, .02], speed: .08 });
    // DK's treehouse on the hill behind, and a sunset silhouette jungle.
    const house: BufferGeometry[] = [gradient(at(new BoxGeometry(8, 5, 5), -16, floor.top + 3.5, -38), '#b87840', '#6a3a20', floor.top + 1, floor.top + 6),
      paint(at(new ConeGeometry(6.5, 3.5, 4), -16, floor.top + 7.7, -38, 0, 1, 1, .8, 0, Math.PI / 4), '#c89a50'), paint(at(new BoxGeometry(1.4, 2, .1), -16, floor.top + 2, -35.4), '#2a1a10'),
      paint(at(new CylinderGeometry(.6, 1, 16, 8), -16, floor.top - 7, -38), '#5a3a24')];
    k.batch(house, k.lit({ haze: ['#c86a6a', .25] }));
    canopy(k, 11, floor.top - 12, -45, 180, 18, '#5a4a4a', '#2a1a2a', '#2a1a1a', ['#c86a6a', .55]);
    const flies = sparkles(k, scatter(8, k.n(12), [-16, 16], [floor.top - 2, floor.top + 8], [-8, -16], [.25, .4]), '#ffe07a', .8);
    return u => { sky.update(u); water(u); flies(u); };
  },
};

export default { 'kongo-jungle': kongoJungle, 'jungle-japes': japes, 'kongo-jungle-64': kongo64 } as const;
