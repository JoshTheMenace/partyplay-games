/** Mario series: Princess Peach's Castle, Rainbow Cruise, Mushroom Kingdom, Mushroom Kingdom II. */
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, TorusGeometry, type BufferGeometry } from 'three';
import { at, gradient, massGeometry, merge, paint, rng } from '../kit';
import { puff, tree } from '../decor';
import type { StageModule } from '../index';
import { cloudBank, curtain, drifters, farPlane, hills, scatter, sparkles } from './common';
import { bulletBill, carpetPiece, egg, logPiece, rainbowPiece, slab } from './pieces';

/** A castle tower: cylinder, crenellated cap and red cone roof. */
function spire(x: number, y: number, z: number, h: number, r: number) {
  return [gradient(at(new CylinderGeometry(r, r * 1.08, h, 14), x, y + h / 2, z), '#f3e3c6', '#bfa888', y, y + h),
    paint(at(new CylinderGeometry(r * 1.18, r * 1.18, r * .5, 14), x, y + h, z), '#e8d6b4'), paint(at(new ConeGeometry(r * 1.35, r * 2.6, 14), x, y + h + r * 1.5, z), '#e0474f'),
    paint(at(new BoxGeometry(r * .35, r * .7, .1), x, y + h * .7, z + r * 1.02), '#5b3c52'), paint(at(new SphereGeometry(r * .15, 8, 6), x, y + h + r * 2.85, z), '#ffd24a')];
}

const peachCastle: StageModule = {
  lighting: { sky: '#dff1ff', ground: '#6aa34a', key: '#fff5e0', keyIntensity: 1.25, keyDir: [.4, .9, .5], rim: '#ffe7a8', rimDir: [-.4, .4, -1], ambient: .6 },
  ground: { style: 'stone', cap: '#c9b9a0', capDark: '#a8967a', face: '#efe0c4', faceDeep: '#9a7a6a', line: '#b39f82', lip: '#fffaf0', trim: '#ff5a6e', capDepth: .2, wave: 0 },
  slab: { style: 'stone', cap: '#f2e6d0', face: '#e0474f', faceDeep: '#8c2436', line: '#a8323e', lip: '#ffd24a', capDepth: .08, wave: 0 },
  hints: {
    tower: { style: 'stone', cap: '#e8dcc4', face: '#f6ecd8', faceDeep: '#c8b090', line: '#c2ae8e', lip: '#ffffff', trim: '#e0474f', capDepth: .14, wave: 0 },
    switch: { style: 'metal', cap: '#ffd24a', face: '#e0474f', faceDeep: '#7a1a24', line: '#5a1018', lip: '#fff2a8', trim: '#ffd24a', capDepth: .08, wave: 0 },
  },
  shape: { step: .25, round: .5 },
  hazard: { style: 'lane', color: '#ff6a4a', object: k => bulletBill(k, 2.9, 1.2) },
  build(k, { floor }) {
    const sky = k.sky({ top: '#3f8ff0', mid: '#9ed3ff', bottom: '#e9f7ff', horizon: -.08, sun: { dir: [.4, .3, -1], color: '#fffbe8', halo: '#fff2b8', size: .003, glow: .9 } });
    const moat = farPlane(k, { y: floor.top - 30, lit: '#bfe8ff', mid: '#6fb8e8', shade: '#3f86c8', horizon: '#dff3ff', scale: [.03, .05], speed: .03 });
    const r = rng(3), trees = Array.from({ length: k.n(12) }, (_, i) => at(tree(i, 6 + r() * 3, '#7a5236', '#5cbf4a', '#2f7a3a'), (i - 5.5) * 16 + r() * 6, floor.top - 28, -90 - r() * 40));
    hills(k, [[-80, floor.top - 29, -140, 110, 20], [60, floor.top - 29, -170, 140, 26], [0, floor.top - 29, -100, 80, 10], [130, floor.top - 29, -120, 70, 14]], '#8ad65a', '#3f8a3a', ['#dff1ff', .4], trees);
    // The rest of the castle rises around the roof: flanking spires and the walls falling away beneath.
    const w = (floor.right - floor.left) / 2, keep: BufferGeometry[] = [...spire(-w - 6, floor.top - 22, -26, 32, 2.4), ...spire(w + 7, floor.top - 22, -30, 34, 2.6), ...spire(-w * .45, floor.top - 10, -22, 19, 1.4), ...spire(w * .5, floor.top - 10, -24, 21, 1.5)];
    keep.push(gradient(at(new BoxGeometry(w * 2.3, 20, 10), 0, floor.top - 13.6, -8), '#efe0c4', '#9a7a6a', floor.top - 24, floor.top - 3.6));
    for (let i = 0; i < 9; i++) keep.push(paint(at(new BoxGeometry(.9, 1.6, .1), (i - 4) * w * .25, floor.top - 7, -2.95), '#5b3c52'));
    keep.push(paint(at(new CylinderGeometry(1.4, 1.4, .2, 24), 0, floor.top - 6.5, -2.9, 0, 1, 1, 1, Math.PI / 2), '#ff9cc8'), paint(at(new TorusGeometry(1.4, .18, 5, 24), 0, floor.top - 6.5, -2.85), '#ffd24a'));
    k.batch(keep, k.lit({ haze: ['#dff1ff', .1] }));
    const clouds = cloudBank(k, { seed: 7, count: 8, z: [-60, -120], y: [floor.top - 14, floor.top + 18], s: [1.2, 2.2], speed: .5, top: '#ffffff', bottom: '#b8d8f5', haze: ['#e9f7ff', .3] });
        return u => { sky.update(u); moat(u); clouds(u); };
  },
};

const rainbowCruise: StageModule = {
  lighting: { sky: '#ffe3f4', ground: '#8a7bd8', key: '#fff6e8', keyIntensity: 1.2, keyDir: [.3, .9, .6], rim: '#ffb3e0', rimDir: [.5, .3, -1], ambient: .62 },
  ground: { style: 'hull', cap: '#e8c08a', capDark: '#c79a62', face: '#9a5a36', faceDeep: '#4a2a3a', line: '#6a3a24', lip: '#ffe0a0', trim: '#ffd24a', glow: '#ffcf6a', capDepth: .16, wave: 0 },
  slab: { style: 'planks', cap: '#e8c08a', face: '#8a4a2a', faceDeep: '#4a2418', line: '#5a2a18', lip: '#ffe0a0', capDepth: .06, wave: 0 },
  hints: { 'rainbow-block': { style: 'quilt', cap: '#fff6a8', face: '#ff9ed2', faceDeep: '#9a78e0', line: '#7ee8ff', lip: '#ffffff', trim: '#ffd24a', capDepth: .14, wave: 0 } },
  piece(k, p, ctx) {
    if (p.kind === 'platform' && p.platform.art === 'rainbow') return rainbowPiece(k, p.platform.right - p.platform.left);
    if (p.kind === 'platform' && p.platform.id.startsWith('sail')) {
      const w = p.platform.right - p.platform.left, g = new Group(); g.add(slab(w, ctx.slab, .16, .04));
      g.add(new Mesh(k.own(merge([gradient(at(new BoxGeometry(w * .8, 2.4, .06), 0, -1.35, -1.2), '#fff8f4', '#ffb3d6', -2.6, 0), paint(at(new CylinderGeometry(.1, .12, 5.5, 8), 0, -2.6, -1.4), '#7a4a2a')])), k.lit()));
      return g;
    }
    if (p.kind === 'block' && p.block.id === 'deck') {
      // The hull with a golden prow and railings; built in world space at the deck's rect.
      const b = p.block, g = new Group(), parts: BufferGeometry[] = [];
      g.add(new Mesh(massGeometry(p.rects, ...p.ledges, { round: 1.1 }), ctx.material('ship')));
      for (let x = b.left + .4; x < b.right - .2; x += .8) parts.push(paint(at(new CylinderGeometry(.04, .04, .55, 5), x, b.top + .27, -2.5), '#ffd24a'));
      parts.push(paint(at(new BoxGeometry(b.right - b.left - .4, .08, .08), (b.left + b.right) / 2, b.top + .55, -2.5), '#ffd24a'));
      g.add(new Mesh(k.own(merge(parts)), k.lit())); return g;
    }
    return undefined;
  },
  hazard: false,
  build(k, { floor }) {
    const sky = k.sky({ top: '#6fa8ff', mid: '#ffc4e8', bottom: '#fff1c9', horizon: -.05, sun: { dir: [-.3, .15, -1], color: '#fffdf0', halo: '#ffe0a8', size: .002, glow: .8 } });
    const bands = ['#ff5a5a', '#ff9f43', '#ffe45c', '#6ee06a', '#4fc3ff', '#6a7bff', '#b36bff'], arc = (x: number, y: number, z: number, radius: number, band: number) => bands.map((c, i) => paint(at(new TorusGeometry(radius - i * band, band * .5, 3, 64, Math.PI), x, y, z), c));
    k.batch([...arc(-40, floor.top - 30, -200, 70, 3.2), ...arc(80, floor.top - 22, -260, 45, 2.4)], k.flat({ transparent: true, opacity: .6 })).renderOrder = -45;
    const sea = farPlane(k, { y: floor.top - 30, lit: '#ffffff', mid: '#ffd6ec', shade: '#c9a8f0', horizon: '#fff1c9', speed: .06 });
    const blocks = drifters(k, merge([paint(new BoxGeometry(2, 2, 2), '#ffc83d'), paint(at(new BoxGeometry(.5, 1, .1), 0, .1, 1.02), '#8a4a00')]), ['#ffe3f4', .4], scatter(4, k.n(7), [-80, 80], [-8, 18], [-50, -100], [.6, 1.1]));
    const fast = cloudBank(k, { seed: 21, count: 9, z: [-22, -45], y: [floor.top - 12, floor.top + 16], s: [.8, 1.6], speed: -6, top: '#ffffff', bottom: '#f5b8e0', haze: ['#ffe3f4', .2] });
    const slow = cloudBank(k, { seed: 22, count: 7, z: [-80, -140], y: [floor.top - 20, floor.top + 30], s: [1.8, 3], speed: -1.5, top: '#fff8fc', bottom: '#d8b0f0', haze: ['#ffe3f4', .45] });
    return u => { sky.update(u); sea(u); blocks(u); fast(u); slow(u); };
  },
};

/** SMB hills: rounded mounds with dark spots, flat and bright like the NES. */
function smbHills(seed: number, y: number, z: number) {
  const r = rng(seed), parts: BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const x = -90 + i * 36 + r() * 10, h = 8 + r() * 10, w = h * 1.5;
    parts.push(paint(at(new SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), x, y, z, 0, w / 2, h, 3), '#3aa83a'));
    for (let j = 0; j < 3; j++) parts.push(paint(at(new CylinderGeometry(.9, .9, .2, 10), x + (j - 1) * w * .15, y + h * (.35 + (j % 2) * .25), z + 1.6, 0, 1, 1.6, 1, Math.PI / 2), '#1e6a1e'));
  }
  return merge(parts);
}
const mushroomKingdom: StageModule = {
  lighting: { sky: '#e8f0ff', ground: '#6b8cff', key: '#ffffff', keyIntensity: 1.3, keyDir: [.3, .9, .5], rim: '#ffe0a0', rimDir: [-.5, .3, -1], ambient: .62 },
  ground: { style: 'brick', cap: '#e09a52', capDark: '#b8662a', face: '#c84c0c', faceDeep: '#6a2400', line: '#2a0a00', lip: '#ffd0a0', trim: '#ffd24a', capDepth: .22, wave: 0 },
  slab: { style: 'metal', cap: '#ffb050', face: '#e07820', faceDeep: '#7a3a00', line: '#5a2a00', lip: '#fff2c0', trim: '#ffd24a', capDepth: .06, wave: 0 },
  hints: {
    question: { style: 'metal', cap: '#ffd24a', face: '#ffb52a', faceDeep: '#a85a00', line: '#6a2a00', lip: '#fff2c0', trim: '#ffffff', capDepth: .06, wave: 0 },
    pipe: { style: 'metal', cap: '#5ae05a', face: '#1eb51e', faceDeep: '#0a5a0a', line: '#0a4a0a', lip: '#b8ffb0', trim: '#b8ffb0', capDepth: .45, wave: 0 },
  },
  shape: { round: .05, step: .02 },
  piece(k, p) {
    if (p.kind !== 'block' || p.block.art !== 'pipe') return undefined;
    // A pipe: body inset inside the collision rect, lip flush with its walls and top.
    const b = p.block, cx = (b.left + b.right) / 2, half = (b.right - b.left) / 2, h = b.top - b.bottom;
    const g = merge([gradient(at(new CylinderGeometry(half * .86, half * .86, h - .55, 20), cx, b.bottom + (h - .55) / 2, 0), '#3ad83a', '#0a6a0a', b.bottom, b.top), gradient(at(new CylinderGeometry(half, half, .55, 20), cx, b.top - .275, 0), '#7af07a', '#1eb51e', b.top - .55, b.top)]);
    return new Mesh(k.own(g), k.lit());
  },
  hazard: false,
  build(k, { floor }) {
    const sky = k.sky({ top: '#5c7cff', mid: '#6b8cff', bottom: '#8aa6ff', horizon: -.1 });
    k.batch([smbHills(3, floor.top - 12, -70)], k.flat()).renderOrder = -40;
    const clouds = drifters(k, puff(9, 7, 2, '#ffffff', '#e8eeff', 5, 2), ['#6b8cff', .05], scatter(2, k.n(7), [-90, 90], [floor.top + 8, floor.top + 20], [-60, -80], [1, 1.6]), .2);
    const bushes = hills(k, scatter(5, 6, [-60, 60], [floor.top - 12, floor.top - 12], [-40, -44], [5, 9]).map(([x, y, z, s]) => [x, y, z, s * 1.4, s * .5] as const), '#6ad06a', '#2a8a2a', ['#6b8cff', .1]);
    bushes.renderOrder = -39;
    return u => { sky.update(u); clouds(u); };
  },
};

/** Birdo: a pink figure with a red bow and a round snout. */
function birdo(x: number, y: number, z: number) {
  return merge([gradient(at(new SphereGeometry(.7, 14, 10), x, y + .9, z, 0, 1, 1.25, 1), '#ff9ac8', '#d05a90', y, y + 1.8), paint(at(new SphereGeometry(.45, 12, 8), x - .1, y + 2.1, z), '#ff9ac8'),
    paint(at(new CylinderGeometry(.18, .22, .5, 10), x - .55, y + 2.05, z, Math.PI / 2), '#ff7ab0'), paint(at(new SphereGeometry(.22, 8, 6), x + .1, y + 2.55, z, 0, 1.6, .8, .8), '#e0203a'),
    paint(at(new SphereGeometry(.09, 6, 4), x - .3, y + 2.25, z + .35), '#ffffff')]);
}
const mushroomKingdom2: StageModule = {
  lighting: { sky: '#e2f0ff', ground: '#5c94fc', key: '#fff4e0', keyIntensity: 1.25, keyDir: [.4, .9, .5], rim: '#ffd0a0', rimDir: [-.5, .3, -1], ambient: .6 },
  ground: { style: 'soil', cap: '#58c850', capDark: '#2e8a30', face: '#c07838', faceDeep: '#5a2a18', line: '#6a3818', lip: '#b8f090', trim: '#ffd24a', capDepth: .34, wave: .7 },
  slab: { style: 'planks', cap: '#d89858', face: '#9a5a2a', faceDeep: '#5a2a18', line: '#5a3018', lip: '#ffe0a0', capDepth: .06, wave: 0 },
  hints: { carpet: { style: 'quilt', cap: '#ff5a5a', face: '#f0c040', faceDeep: '#a04020', line: '#3050d0', lip: '#ffffff', capDepth: .06, wave: 0 }, log: { style: 'planks', cap: '#c88848', face: '#a86a32', line: '#5a3018', lip: '#e8c080', capDepth: .05, wave: 0 } },
  shape: { round: 1.4, jag: .6 },
  piece(k, p, ctx) {
    if (p.kind !== 'platform') return undefined;
    const w = p.platform.right - p.platform.left;
    return p.platform.art === 'carpet' ? carpetPiece(k, w, ctx.material('carpet', true)) : p.platform.art === 'log' ? logPiece(k, w, ctx.material('log', true)) : undefined;
  },
  hazard: { style: 'lane', color: '#ff7ab0', object: k => egg(k, 1.1) },
  build(k, { floor }) {
    const sky = k.sky({ top: '#3c70e8', mid: '#5c94fc', bottom: '#b8d8ff', horizon: -.06 });
    const fall = curtain(k, { x: 0, y: floor.top - 10, z: -34, w: 12, h: 44, light: '#e0f4ff', dark: '#4a90e0', speed: 1.4, alpha: .92 });
    const pool = farPlane(k, { y: floor.top - 22, lit: '#e8f8ff', mid: '#58a8f0', shade: '#2c68c8', horizon: '#b8d8ff', speed: .05 });
    // Subcon cliffs with red and white sprouts along their tops, flanking the waterfall.
    const r = rng(11), sprouts: BufferGeometry[] = [];
    for (let i = 0; i < k.n(16); i++) { const s = r() < .5 ? -1 : 1, x = s * (12 + r() * 18); sprouts.push(paint(at(new ConeGeometry(.3, 1, 4), x, floor.top + 7.2 - Math.abs(x - s * 20) * .35, -30 + r() * 4), r() < .5 ? '#ff4040' : '#ffffff')); }
    sprouts.push(birdo(10.8, floor.top, -2.6));
    hills(k, [[-22, floor.top - 24, -34, 26, 31], [22, floor.top - 24, -34, 26, 31], [-80, floor.top - 24, -90, 70, 26], [80, floor.top - 24, -90, 70, 22]], '#58c850', '#8a4a24', ['#b8d8ff', .2], sprouts);
    const clouds = cloudBank(k, { seed: 13, count: 6, z: [-70, -110], y: [floor.top + 8, floor.top + 22], s: [1.2, 2], speed: .4, top: '#ffffff', bottom: '#c8dcff', haze: ['#b8d8ff', .3] });
    const spray = sparkles(k, scatter(9, k.n(8), [-6, 6], [floor.top - 22, floor.top - 17], [-32, -32], [1.5, 3]), '#ffffff', .45);
    return u => { sky.update(u); fall(u); pool(u); clouds(u); spray(u); };
  },
};

export default { 'peach-castle': peachCastle, 'rainbow-cruise': rainbowCruise, 'mushroom-kingdom': mushroomKingdom, 'mushroom-kingdom-ii': mushroomKingdom2 } as const;
