/** Kirby series: Fountain of Dreams, Green Greens (Whispy on stage), Dream Land (Whispy's wind). */
import { ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, OctahedronGeometry, SphereGeometry, type BufferGeometry } from 'three';
import { at, gradient, merge, paint, rng, silhouetteGeometry, type Kit } from '../kit';
import { puff, ridge } from '../decor';
import type { StageModule } from '../index';
import { clock, cloudBank, curtain, farPlane, hills, scatter, sparkles } from './common';
import { bombBlock } from './pieces';

/** Whispy Woods: trunk with a face and a leafy crown; the mouth is a separate mesh so it can open. */
function whispy(k: Kit, x: number, y: number, z: number, s: number) {
  const g = new Group(), crown: BufferGeometry[] = [], r = rng(5);
  const body = merge([gradient(at(new CylinderGeometry(2.2 * s, 2.8 * s, 9 * s, 14), 0, 4.5 * s, 0), '#a8703a', '#5a3418', 0, 9 * s),
    ...[-1, 1].map(d => paint(at(new SphereGeometry(.42 * s, 10, 8), d * .8 * s, 6 * s, 2.25 * s, 0, 1, 1.5, .5), '#2a1a0a')),
    paint(at(new SphereGeometry(.35 * s, 8, 6), 0, 5 * s, 2.5 * s, 0, 1, 1, 1.2), '#8a5a2a')]);
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; crown.push(gradient(at(new IcosahedronGeometry(2.6 * s, 1), Math.cos(a) * 3 * s, (10.5 + Math.sin(a * 2) * .8 + r()) * s, Math.sin(a) * 1.5 * s), '#6ad04a', '#2a7a2a', 8 * s, 14 * s)); }
  for (let i = 0; i < 6; i++) crown.push(paint(at(new SphereGeometry(.35 * s, 8, 6), (r() - .5) * 7 * s, (9 + r() * 3) * s, 2.8 * s), '#ff4a4a'));
  g.add(new Mesh(k.own(body), k.lit()), new Mesh(k.own(merge(crown)), k.lit()));
  const mouth = new Mesh(k.own(paint(new SphereGeometry(.5 * s, 12, 8), '#2a0a0a')), k.lit()); mouth.position.set(0, 3.8 * s, 2.4 * s); mouth.scale.set(1.4, .35, .4); g.add(mouth);
  g.position.set(x, y, z); k.add(g);
  return { group: g, mouth };
}

const fountain: StageModule = {
  lighting: { sky: '#c8c0ff', ground: '#0e0b2e', key: '#e8e0ff', keyIntensity: 1.1, keyDir: [-.3, .9, .5], rim: '#d7a3ff', rimDir: [.5, .3, -1], ambient: .52 },
  ground: { style: 'stone', cap: '#d8d8f8', capDark: '#a8a8d8', face: '#c4c5ed', faceDeep: '#3a2f78', line: '#8a88c8', lip: '#ffffff', trim: '#ffe890', glow: '#b8a8ff', capDepth: .14, wave: 0 },
  slab: { style: 'crystal', cap: '#f0e8ff', face: '#b8a8f0', faceDeep: '#5a4aa8', line: '#8a7ad8', lip: '#ffe890', glow: '#d7a3ff', capDepth: .06, wave: 0 },
  shape: { step: .3, round: .6 },
  hazard: false,
  build(k, { floor }) {
    const sky = k.sky({ top: '#05041a', mid: '#1c1650', bottom: '#4a3a8a', horizon: -.1, stars: 1, starColor: '#fff8e0', nebula: ['#6a5ad8', '#d7a3ff', .3], sun: { dir: [.45, .3, -1], color: '#fff8d0', halo: '#b8a8ff', size: .0035, glow: .7 } });
    const pool = farPlane(k, { y: floor.top - 9, lit: '#e8e0ff', mid: '#6a5ab8', shade: '#1c1650', horizon: '#4a3a8a', scale: [.04, .06], speed: .05, bands: [.5, .72] });
    // Water pouring from the fountain's rim on both sides of the pillar, and the tiered basin below.
    const falls = [-1, 1].map(s => curtain(k, { x: s * 3.3, y: floor.top - 5, z: .2, w: 2.2, h: 8, light: '#ffffff', dark: '#9a8ae8', speed: 1.8, alpha: .8 }));
    const t = floor.top, basin: BufferGeometry[] = [gradient(at(new CylinderGeometry(9, 10, 1.2, 32), 0, t - 8.6, -3), '#c4c5ed', '#3a2f78', t - 9.2, t - 8), paint(at(new CylinderGeometry(8.4, 8.4, .2, 32), 0, t - 8, -3), '#9a8ae8')];
    // Distant dream castle spires and star-tipped towers.
    for (const [x, h] of [[-40, 26], [-30, 18], [36, 30], [46, 20], [-55, 14], [60, 16]] as const) basin.push(gradient(at(new CylinderGeometry(1.4, 1.8, h, 10), x, t - 10 + h / 2, -80), '#3a2f78', '#141040', t - 10, t - 10 + h), paint(at(new ConeGeometry(2, 5, 10), x, t - 10 + h + 2.5, -80), '#5a4aa8'), paint(at(new IcosahedronGeometry(.9, 0), x, t - 10 + h + 5.6, -80), '#ffe890'));
    k.batch(basin, k.lit({ haze: ['#1c1650', .15] }));
    const glints = sparkles(k, scatter(7, k.n(24), [-18, 18], [t - 9, t + 10], [-4, -30], [.3, .7]), '#fff4c8', .8);
    return u => { sky.update(u); pool(u); for (const f of falls) f(u); glints(u); };
  },
};

const greenGreens: StageModule = {
  lighting: { sky: '#fff8d8', ground: '#5aa0d8', key: '#fff4e0', keyIntensity: 1.25, keyDir: [.3, .9, .6], rim: '#ffe890', rimDir: [-.5, .3, -1], ambient: .6 },
  ground: { style: 'soil', cap: '#7ad04a', capDark: '#4a9a2a', face: '#c89a5a', faceDeep: '#6a4a2a', line: '#8a6a3a', lip: '#d8ffb0', trim: '#ffe890', capDepth: .35, wave: .9 },
  slab: { style: 'planks', cap: '#e8c888', face: '#a8783a', faceDeep: '#5a3a1a', line: '#6a4a20', lip: '#fff0c0', capDepth: .05, wave: 0 },
  hints: { 'star-block': { style: 'brick', cap: '#ffe060', capDark: '#e8b830', face: '#ffc830', faceDeep: '#c88a10', line: '#a85a00', lip: '#fff8c0', capDepth: .05, wave: 0 } },
  shape: { step: .4, round: 1.4, jag: .6 },
  hazard: { style: 'drop', color: '#ff6b6b', object: k => bombBlock(k, 1.5) },
  build(k, { floor }) {
    const sky = k.sky({ top: '#3a88d8', mid: '#9ad0f0', bottom: '#f0f8e0', horizon: -.06, sun: { dir: [.4, .35, -1], color: '#fffbe8', halo: '#fff0b0', size: .003, glow: .8 } });
    const t = floor.top, tree = whispy(k, 0, t - 1.5, -5.5, .55);
    hills(k, [[-50, t - 12, -50, 60, 20], [45, t - 12, -60, 70, 24], [-100, t - 12, -80, 70, 16], [100, t - 12, -90, 80, 22]], '#8ae05a', '#3a8a3a', ['#9ad0f0', .25],
      [0, 1, 2, 3, 4, 5].map(i => at(puff(i, 6, 3, '#6ad04a', '#2a7a2a', 5, 1), -60 + i * 24, t - 4 + (i % 2) * 3, -44)));
    const clouds = cloudBank(k, { seed: 29, count: 7, z: [-60, -110], y: [t + 10, t + 22], s: [1.2, 2], speed: .4, top: '#ffffff', bottom: '#c8e0f8', haze: ['#9ad0f0', .3] });
    return u => { sky.update(u); clouds(u); tree.group.rotation.z = Math.sin(clock(u) * .7) * .01; };
  },
};

const dreamLand: StageModule = {
  lighting: { sky: '#fffbe8', ground: '#73b5bf', key: '#fff6e0', keyIntensity: 1.25, keyDir: [.3, .9, .6], rim: '#a6dd88', rimDir: [-.5, .3, -1], ambient: .62 },
  ground: { style: 'soil', cap: '#a6dd88', capDark: '#6aa84a', face: '#c5a86a', faceDeep: '#6a5a3a', line: '#8a7a4a', lip: '#e8ffd0', trim: '#fff0a0', capDepth: .3, wave: .7 },
  slab: { style: 'planks', cap: '#e8d8a8', face: '#9a7a4a', faceDeep: '#5a4a2a', line: '#6a5a3a', lip: '#fffbe8', capDepth: .05, wave: 0 },
  shape: { step: .4, round: 1.4, jag: .4 },
  hazard: false,
  build(k, { floor }) {
    const sky = k.sky({ top: '#4aa0c8', mid: '#a8e0e0', bottom: '#f8fff0', horizon: -.08 });
    const t = floor.top, tree = whispy(k, 6, t - 16, -70, 1.9);
    k.batch([silhouetteGeometry(ridge(3, -160, 160, t - 4, t + 16, 6, .3), t - 20, -120, '#8ac8a8', '#d8f0e0')], k.flat()).renderOrder = -42;
    hills(k, [[-38, t - 12, -46, 50, 14], [40, t - 12, -50, 56, 16], [-90, t - 12, -70, 60, 18], [95, t - 12, -76, 70, 20]], '#8ad86a', '#4a9a3a', ['#a8e0e0', .2]);
    const clouds = cloudBank(k, { seed: 31, count: 8, z: [-60, -110], y: [t + 6, t + 22], s: [1.2, 2.2], speed: .4, top: '#ffffff', bottom: '#c8e8f0', haze: ['#a8e0e0', .25] });
    const stars = sparkles(k, scatter(3, 5, [-30, 30], [t + 14, t + 22], [-60, -70], [1, 1.6]), '#fff4a0', .5);
    // Whispy's breath: wind streaks and leaves across the whole screen in the push direction.
    const wind = k.streaks(k.n(30), 7), r = rng(4), gusts = Array.from({ length: wind.count }, () => ({ x: r(), y: r() * 12 - 1, z: -3 + r() * 6, v: .6 + r() * .6, len: 1.5 + r() * 2.5 }));
    // Leaves carry the wind on a bright sky, where additive streaks alone would wash out; a few rustle during the warning.
    const leaf = gradient(new OctahedronGeometry(.36, 0).scale(1.5, .5, .9), '#d8f070', '#3a9a2a', -.18, .18), leaves = k.pool(leaf, k.lit(), k.n(26), 8), drift = gusts.slice(0, leaves.count);
    let blow = 0;
    return (u, frame) => {
      sky.update(u); clouds(u); stars(u);
      const h = frame.hazard, push = h?.active ? Math.sign(h.push) || 1 : 0, seconds = u.seconds;
      blow += ((h?.active ? 1 : 0) - blow) * Math.min(1, u.dt * 4);
      tree.mouth.scale.set(1.4 - blow * .5, h?.warning ? .6 + .2 * Math.sin(seconds * 8) : .35 + blow * .9, .4);
      tree.group.scale.setScalar(1 + (h?.warning && !u.reduced ? .015 * Math.sin(seconds * 6) : 0));
      const span = 44, cx = u.camera.position.x;
      gusts.forEach((g, i) => {
        if (blow < .05) { wind.hide(i); return; }
        const x = ((g.x * span + seconds * 26 * g.v * (push || 1)) % span + span) % span - span / 2;
        wind.set(i, cx + x, t + g.y, g.z, g.len, .08, push < 0 ? Math.PI : 0, '#ffffff', .5 * blow);
      });
      wind.commit();
      const stir = Math.max(blow, h?.warning ? .25 : 0);
      drift.forEach((g, i) => {
        if (stir < .05 || i > leaves.count * stir) { leaves.hide(i); return; }
        const x = ((g.x * span + seconds * 18 * g.v * (push || 1)) % span + span) % span - span / 2;
        leaves.set(i, cx + x, t + g.y * .8 + Math.sin(seconds * 3 + i) * .4, 1.2 + g.z * .3, 1, 1, seconds * 6 * g.v + i, undefined, 1, 1);
      });
      leaves.commit();
    };
  },
};

export default { fountain, 'green-greens': greenGreens, 'dream-land': dreamLand } as const;
