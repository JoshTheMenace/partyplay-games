/** Star Fox series: Corneria (the Great Fox over the city) and Venom (the Great Fox in the storm). */
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, type BufferGeometry } from 'three';
import { at, gradient, massGeometry, merge, paint, rng } from '../kit';
import { skyline } from '../decor';
import type { StageModule } from '../index';
import { clock, cloudBank, drifters, particles, scatter, sparkles } from './common';
import { arwing, beam } from './pieces';

const hull = { style: 'metal', cap: '#c8d4e0', capDark: '#9aa8b8', face: '#b8c8d6', faceDeep: '#3a4a5a', line: '#6a7a8a', lip: '#ffffff', trim: '#ff7a3a', capDepth: .1, wave: 0 } as const;
/** Great Fox engines and antennae, in world space at the hull's rect. */
function greatFox(rects: readonly { left: number; right: number; top: number; bottom: number }[], glow: string) {
  const b = rects[0], parts: BufferGeometry[] = [];
  for (const y of [.3, .65]) parts.push(gradient(at(new CylinderGeometry(.55, .7, 1.6, 12), b.left + 1.4, b.bottom + (b.top - b.bottom) * y, -3.4, Math.PI / 2), '#8a9aaa', '#3a4a5a', -1, 1), paint(at(new CylinderGeometry(.42, .42, .1, 12), b.left + .6, b.bottom + (b.top - b.bottom) * y, -3.4, Math.PI / 2), glow));
  for (let i = 0; i < 4; i++) parts.push(paint(at(new BoxGeometry(.08, .9 + i * .2, .08), b.left + 3 + i * 2.4, b.top + .45 + i * .1, -2.6), '#8a9aaa'));
  return merge(parts);
}

const corneria: StageModule = {
  lighting: { sky: '#e8f4ff', ground: '#4a78b8', key: '#fff6e8', keyIntensity: 1.25, keyDir: [.4, .9, .5], rim: '#ff7a3a', rimDir: [-.5, .3, -1], ambient: .56 },
  ground: hull, hints: { ship: hull, fin: { ...hull, face: '#a8b8c8', trim: '#3a6ae8', capDepth: .05 } },
  piece(k, p, ctx) {
    if (p.kind === 'platform' && p.platform.art === 'arwing') return arwing(k, p.platform.right - p.platform.left, ctx.slab);
    if (p.kind === 'block' && p.block.id === 'hull') { const g = new Group(); g.add(new Mesh(massGeometry(p.rects, ...p.ledges, { round: .8 }), ctx.material('ship')), new Mesh(k.own(greatFox(p.rects, '#6ad8ff')), k.lit())); return g; }
    return undefined;
  },
  hazard: { style: 'lane', color: '#ff4a4a', fill: false, object: k => beam(k, 10.2, '#ff5a4a') },
  build(k, { floor }) {
    const sky = k.sky({ top: '#3a6ab8', mid: '#a8ccef', bottom: '#f0f6ff', horizon: -.12, sun: { dir: [.5, .3, -1], color: '#ffffff', halo: '#ffe8c8', size: .002, glow: .8 } });
    // Corneria City far below: towers with lit windows, in hazy layers.
    const city = [skyline(3, -220, 220, floor.top - 40, 6, 22, -140, '#8aa8c8', '#fff4d0', .3, 6), skyline(5, -140, 140, floor.top - 40, 8, 28, -80, '#6a88b0', '#fff0c0', .35, 5)];
    for (const [i, g] of city.entries()) k.batch([g], k.lit({ haze: ['#c8dcef', .55 - i * .15] })).renderOrder = -40;
    const clouds = cloudBank(k, { seed: 33, count: 8, z: [-30, -70], y: [floor.top - 16, floor.top - 4], s: [1.2, 2.2], speed: -3, top: '#ffffff', bottom: '#b8cce0', haze: ['#e8f4ff', .3] });
    const wing = drifters(k, merge([gradient(at(new ConeGeometry(.35, 3.2, 8), 0, 0, 0, Math.PI / 2), '#f0f4ff', '#8a9ab8', -.5, .5), paint(at(new BoxGeometry(1.4, .06, 2.4), -.2, -.05, 0), '#e8eef8'), paint(at(new BoxGeometry(.5, .5, .06), -1, .2, .9, .5), '#3a6ae8')]), ['#e8f4ff', .35], scatter(6, k.n(4), [-40, 40], [floor.top + 6, floor.top + 18], [-40, -70], [.9, 1.2]), 2);
    return u => { sky.update(u); clouds(u); wing(u); };
  },
};

const venom: StageModule = {
  lighting: { sky: '#ffd0c8', ground: '#1a0e1e', key: '#ffb8a0', keyIntensity: 1.05, keyDir: [.3, .9, .5], rim: '#ff897b', rimDir: [-.5, .3, -1], ambient: .48 },
  ground: { ...hull, cap: '#8a94a0', capDark: '#6a7480', face: '#7a8894', faceDeep: '#1a1420', line: '#4a5260', lip: '#ffd0c8', trim: '#ff897b' },
  hints: { ship: { ...hull, cap: '#8a94a0', capDark: '#6a7480', face: '#7a8894', faceDeep: '#1a1420', line: '#4a5260', lip: '#ffd0c8', trim: '#ff897b' }, wing: { ...hull, cap: '#9aa4b0', face: '#6a7480', faceDeep: '#2a2430', trim: '#ff897b', capDepth: .04 } },
  slab: { ...hull, cap: '#9aa4b0', face: '#6a7480', faceDeep: '#2a2430', capDepth: .04 },
  piece(k, p, ctx) { return p.kind === 'platform' && p.platform.art === 'arwing' ? arwing(k, p.platform.right - p.platform.left, ctx.slab) : undefined; },
  hazard: { style: 'lane', color: '#ff4a4a', fill: false, object: k => beam(k, 10.2, '#ff5a4a') },
  build(k, { floor }) {
    const sky = k.sky({ top: '#12060e', mid: '#6a3048', bottom: '#d8704a', horizon: -.1, nebula: ['#ff897b', '#6a3048', .5], drift: .004 });
    const towers: BufferGeometry[] = [], r = rng(12);
    for (let i = 0; i < k.n(18); i++) { const x = -150 + i * 17 + r() * 8, h = 10 + r() * 30; towers.push(gradient(at(new ConeGeometry(2 + r() * 3, h, 5), x, floor.top - 30 + h / 2, -90 - r() * 40), '#3a2030', '#12060e', floor.top - 30, floor.top - 30 + h)); }
    k.batch(towers, k.lit({ haze: ['#6a3048', .5] })).renderOrder = -40;
    const storm = cloudBank(k, { seed: 37, count: 10, z: [-30, -80], y: [floor.top - 14, floor.top + 18], s: [1.4, 2.6], speed: -5, top: '#8a4a5a', bottom: '#2a1020', haze: ['#6a3048', .35] });
    const rain = particles(k, { count: 50, color: '#ffd0c8', speed: [22, 30], drift: -8, size: [.8, 1.4], z: [-2, -12], intensity: .35 });
    const lights = sparkles(k, [[-9, floor.top + .2, 1.45, .35], [-4, floor.top + .2, 1.45, .35], [4, floor.top + .2, 1.45, .35], [9, floor.top + .2, 1.45, .35]], '#ff5a4a', .7);
    return u => {
      sky.update(u); storm(u); rain(u); lights(u);
      // Occasional lightning washes the sky (never under reduced motion).
      const t = clock(u), flash = u.reduced ? 0 : Math.max(0, Math.sin(t * .9) * Math.sin(t * 2.3) - .9) * 8;
      sky.material.uniforms.uMid.value.set('#6a3048').lerp(sky.material.uniforms.uStarColor.value, Math.min(1, flash));
    };
  },
};

export default { corneria, venom } as const;
