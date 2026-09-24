/** Zelda series: Temple and Great Bay. */
import { BoxGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, type BufferGeometry } from 'three';
import { at, gradient, merge, paint, rng, silhouetteGeometry } from '../kit';
import { ridge } from '../decor';
import type { StageModule } from '../index';
import { cloudBank, farPlane, parallax } from './common';
import { balloonPiece, housePiece, slab } from './pieces';

/** A temple column with base and capital, rising from y to y + h. */
const column = (x: number, y: number, z: number, h: number, r: number, stone: string, dark: string) => [
  gradient(at(new CylinderGeometry(r, r * 1.08, h, 12), x, y + h / 2, z), stone, dark, y, y + h), paint(at(new BoxGeometry(r * 2.8, r * .8, r * 2.8), x, y + h, z), stone), paint(at(new BoxGeometry(r * 2.8, r * .8, r * 2.8), x, y + r * .4, z), dark)];

const temple: StageModule = {
  lighting: { sky: '#dcd6f4', ground: '#4a4e8a', key: '#fff2d8', keyIntensity: 1.25, keyDir: [.5, .85, .5], rim: '#efd07d', rimDir: [-.5, .3, -1], ambient: .56 },
  ground: { style: 'stone', cap: '#7aa84a', capDark: '#4f7a34', face: '#c8ba99', faceDeep: '#5a4e5a', line: '#8f7f5f', lip: '#e8f8b8', trim: '#efd07d', capDepth: .22, wave: .6 },
  slab: { style: 'stone', cap: '#d8ccaa', face: '#b8a888', faceDeep: '#6a5e5a', line: '#8f7f5f', lip: '#efd07d', capDepth: .06, wave: 0 },
  shape: { step: .3, round: .4, jag: .2 },
  piece(k, p, ctx) {
    // Pillar-top platforms stand on real columns down to the bridge.
    if (p.kind !== 'platform' || !p.platform.id.startsWith('pillar')) return undefined;
    const w = p.platform.right - p.platform.left, g = new Group(); g.add(slab(w, ctx.slab, .35, .1));
    g.add(new Mesh(k.own(merge(column(0, -p.platform.y, -1.4, p.platform.y - .4, w * .22, '#d8ccaa', '#8f7f5f'))), k.lit())); return g;
  },
  hazard: false,
  build(k, { floor, stage }) {
    const sky = k.sky({ top: '#4a4e8a', mid: '#9aa0d8', bottom: '#f0e0d0', horizon: -.08, sun: { dir: [.5, .25, -1], color: '#fff8e0', halo: '#efd07d', size: .0025, glow: .8 } });
    const view = stage.camera, far = parallax(k, [
      { geo: silhouetteGeometry(ridge(4, -260, 260, floor.top - 10, floor.top + 38, 9, .8), floor.top - 40, -260, '#8a88b8', '#c9c0e0'), follow: .7 },
      { geo: silhouetteGeometry(ridge(8, -160, 160, floor.top - 10, floor.top + 14, 12), floor.top - 40, -120, '#6a7a6a', '#a8b0a0'), follow: .45 }]);
    // Colonnades, broken arches and a Triforce crest behind the courts; a dark back wall makes the cave read as a tunnel.
    const r = rng(6), parts: BufferGeometry[] = [];
    for (let i = 0; i < k.n(14); i++) { const x = view.left + 3 + i * (view.right - view.left - 6) / 13, h = 10 + r() * 8; parts.push(...column(x, floor.top - 8, -12 - (i % 2) * 5, r() < .25 ? h * .5 : h, .8, '#d8ccaa', '#7a6e66')); }
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0]]) parts.push(paint(at(new CylinderGeometry(1.4, 1.4, .3, 3), dx * 1.25, floor.top + 16 + dy * 1.25, -30, Math.PI, 1, 1, 1, Math.PI / 2), '#efd07d'));
    parts.push(paint(at(new BoxGeometry(15.2, 5, .5), 0, floor.top - 3.9, -2.6), '#2a2440'));
    k.batch(parts, k.lit({ haze: ['#c9c0e0', .15] }));
    const clouds = cloudBank(k, { seed: 17, count: 8, z: [-80, -160], y: [floor.top + 6, floor.top + 26], s: [1.4, 2.4], speed: .35, top: '#ffffff', bottom: '#b8b0e0', haze: ['#dcd6f4', .45] });
    return u => { sky.update(u); far(u); clouds(u); };
  },
};

/** The Moon over Termina: a huge pocked sphere with a scowl. */
function moon(x: number, y: number, z: number, r: number) {
  const parts: BufferGeometry[] = [gradient(at(new SphereGeometry(r, 28, 18), x, y, z), '#f0c890', '#8a5a4a', y - r, y + r)], q = rng(2);
  for (let i = 0; i < 8; i++) parts.push(paint(at(new SphereGeometry(r * (.08 + q() * .08), 10, 6), x + (q() - .5) * r * 1.3, y + (q() - .5) * r * 1.3, z + r * .9, 0, 1, 1, .3), '#b88a6a'));
  for (const s of [-1, 1]) parts.push(paint(at(new SphereGeometry(r * .17, 12, 8), x + s * r * .35, y + r * .1, z + r * .93, 0, 1, 1, .3), '#fff4a0'), paint(at(new SphereGeometry(r * .07, 8, 6), x + s * r * .33, y + r * .08, z + r * .98), '#ff5a2a'));
  parts.push(paint(at(new BoxGeometry(r * .7, r * .08, r * .1), x, y - r * .4, z + r * .92, .12), '#3a1a1a'));
  return merge(parts);
}
const greatBay: StageModule = {
  lighting: { sky: '#e8f8ff', ground: '#2a6f9a', key: '#fff0d0', keyIntensity: 1.2, keyDir: [.3, .9, .6], rim: '#63e2c0', rimDir: [-.5, .3, -1], ambient: .56 },
  ground: { style: 'planks', cap: '#c9a870', capDark: '#a08050', face: '#8a5a3b', faceDeep: '#2a3a4a', line: '#4a2e1c', lip: '#fff0c0', trim: '#63e2c0', capDepth: .1, wave: 0 },
  slab: { style: 'planks', cap: '#d8b880', face: '#8a5a3b', faceDeep: '#4a2e1c', line: '#4a2e1c', lip: '#fff0c0', capDepth: .05, wave: 0 },
  hints: { turtle: { style: 'quilt', cap: '#6ab84a', capDark: '#3a7a2a', face: '#4a8a3a', faceDeep: '#1f4a2a', line: '#8ad86a', lip: '#c8f0a0', trim: '#63e2c0', capDepth: .2, wave: .3 } },
  piece(k, p, ctx) {
    if (p.kind === 'block' && p.block.art === 'turtle') {
      const b = p.block, g = new Group(), cx = (b.left + b.right) / 2, w = b.right - b.left, h = b.top - b.bottom;
      g.add(new Mesh(k.own(merge([gradient(at(new SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), cx, b.bottom, 0, 0, w / 2, h, 1.8), '#6ab84a', '#1f4a2a', b.bottom, b.top),
        paint(at(new SphereGeometry(.7, 12, 8), b.right - .8, b.bottom + .3, 1.3), '#8ab86a'), paint(at(new SphereGeometry(.12, 6, 4), b.right - .5, b.bottom + .55, 1.95), '#1a1a1a')])), k.lit()));
      return g;
    }
    if (p.kind !== 'platform') return undefined;
    const w = p.platform.right - p.platform.left;
    if (p.platform.art === 'lab') return housePiece(k, w, ctx.slab, p.platform.y - .1, '#e8e0d0', '#8a6a4a', '#5a7ab8');
    if (p.platform.art === 'balloon') return balloonPiece(k, w, ctx.slab);
    if (p.platform.id === 'lookout') { const g = new Group(); g.add(slab(w, ctx.slab, .2, .05)); g.add(new Mesh(k.own(merge([-.4, .4].map(f => paint(at(new CylinderGeometry(.1, .12, p.platform.y, 6), f * w, -p.platform.y / 2, -.6), '#6a4428')))), k.lit())); return g; }
    return undefined;
  },
  hazard: { style: 'area', color: '#63e2c0' },
  build(k, { floor }) {
    const sky = k.sky({ top: '#1a4a7a', mid: '#7ac8e0', bottom: '#fff0d0', horizon: -.04, stars: .2 });
    k.batch([moon(-70, floor.top + 42, -260, 30)], k.lit({ haze: ['#7ac8e0', .15] }));
    const sea = farPlane(k, { y: floor.top - 1.3, lit: '#d8fff8', mid: '#3aa8b8', shade: '#1f5a80', horizon: '#fff0d0', scale: [.05, .08], speed: .1, bands: [.5, .7] });
    const cliffs = parallax(k, [{ geo: silhouetteGeometry(ridge(12, -240, 240, floor.top - 1, floor.top + 22, 8, 1), floor.top - 2, -200, '#4a7a8a', '#7ab8c8'), follow: .6 }]);
    const clouds = cloudBank(k, { seed: 19, count: 6, z: [-90, -150], y: [floor.top + 14, floor.top + 30], s: [1.6, 2.6], speed: .3, top: '#fff8e8', bottom: '#8ac0d8', haze: ['#e8f8ff', .4] });
    // Pilings under the pier, down into the water.
    const pier: BufferGeometry[] = [], r = rng(9);
    for (let x = floor.left + .6; x < floor.right; x += 1.4) pier.push(paint(at(new CylinderGeometry(.14, .16, 4, 6), x, floor.top - 3.2, .6 + r() * .4), '#4a2e1c'));
    k.batch(pier, k.lit());
    return u => { sky.update(u); sea(u); cliffs(u); clouds(u); };
  },
};

export default { temple, 'great-bay': greatBay } as const;
