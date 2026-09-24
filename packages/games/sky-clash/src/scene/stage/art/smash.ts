/** Battlefield, Final Destination and the original Cloudbreak. */
import { Color, CylinderGeometry, IcosahedronGeometry, Mesh, OctahedronGeometry, PlaneGeometry, SphereGeometry, type BufferGeometry } from 'three';
import { at, gradient, merge, mix, paint, rng } from '../kit';
import { island, puff } from '../decor';
import type { StageModule } from '../index';
import { clock, cloudBank, drifters, farPlane, swirl } from './common';

const battlefield: StageModule = {
  lighting: { sky: '#cfc6ff', ground: '#3b2d7a', key: '#fff1e0', keyIntensity: 1.15, keyDir: [.35, .9, .55], rim: '#7ef0ff', rimDir: [-.5, .4, -1], ambient: .56 },
  ground: { style: 'stone', cap: '#a4a6c8', capDark: '#7d80a8', face: '#7c7fa6', faceDeep: '#1f1850', line: '#3f3d78', lip: '#dcd6ff', trim: '#7ef0ff', glow: '#2fc8ff', capDepth: .16, wave: 0 },
  slab: { style: 'stone', cap: '#b4b6d6', capDark: '#8a8db3', face: '#6c6f98', faceDeep: '#3a3272', line: '#4b4a86', lip: '#7ef0ff', glow: '#3fd8ff', capDepth: .08, wave: 0, lipWidth: .06 },
  slabShape: { thickness: .34, taper: .3 },
  shape: { step: .22, round: .6, jag: .25 },
  build(k, { floor }) {
    const sky = k.sky({ top: '#0d0a33', mid: '#4a3a9a', bottom: '#f0a0c8', horizon: -.12, stars: .7, starColor: '#e8f4ff', nebula: ['#3fd8ff', '#b36bff', .35], sun: { dir: [-.3, -.02, -1], color: '#fff6f0', halo: '#ff9ed2', size: .0016, glow: .9 } });
    const vortex = swirl(k, { x: 140, y: 150, z: -520, radius: 170, inner: '#fff0ff', outer: '#3a2c9a', arms: 4, twist: 6, speed: .12, strength: .32 });
    const sea = farPlane(k, { y: -26, lit: '#f7c9e6', mid: '#b98bd9', shade: '#5d4aa6', horizon: '#f0a0c8', bands: [.44, .62] });
    const haze = '#9c86d8';
    const rocks = drifters(k, island(9, 3, 4.5, '#c9cbe8', '#8f93b8', '#2a2360', 9), [haze, .5],
      k.low ? [[-40, 6, -90, 1.4], [46, -4, -110, 1.8], [-8, 18, -150, 1.2]] : [[-40, 6, -90, 1.4], [46, -4, -110, 1.8], [-8, 18, -150, 1.2], [-78, -8, -130, 2.2], [84, 14, -160, 2.4], [20, -12, -70, .7], [-22, 12, -60, .45]]);
    const clouds = cloudBank(k, { seed: 5, count: 7, z: [-40, -80], y: [-22, -12], s: [1.4, 2.6], speed: .5, top: '#ffe0f2', bottom: '#8f74c9', haze: [haze, .4] });
    // Dangling glowing roots under the island: thin wisps only below the collision bottom.
    const r = rng(4), roots: BufferGeometry[] = [], bottom = floor.top - 3.9;
    for (let i = 0; i < 9; i++) { const x = (r() - .5) * 2.6, len = .8 + r() * 1.6; roots.push(paint(at(new CylinderGeometry(.025, .05, len, 4), x, bottom - len / 2 + .2, .2 + r() * .6), mix('#7ef0ff', '#5a4aa0', r() * .5))); }
    roots.push(gradient(at(new OctahedronGeometry(1, 0), 0, bottom - .35, .5, 0, .28, .7, .28), '#bff8ff', '#3fd8ff', bottom - 1, bottom));
    k.batch(roots, k.flat());
    const glows = k.glows(3);
    return u => {
      sky.update(u); vortex.update(u); sea(u); rocks(u); clouds(u);
      const t = clock(u);
      glows.set(0, 0, bottom - .35, .6, 1.8 + Math.sin(t * 2) * .2, undefined, 0, '#3fd8ff', .7); glows.commit();
    };
  },
};

const finalDestination: StageModule = {
  lighting: { sky: '#d8ccff', ground: '#28105a', key: '#f4ecff', keyIntensity: 1.1, keyDir: [.3, .9, .5], rim: '#ff7ae6', rimDir: [.5, .3, -1], ambient: .5 },
  ground: { style: 'crystal', cap: '#2c2458', capDark: '#1a1440', face: '#5a3fa0', faceDeep: '#150a38', line: '#2a1a5a', lip: '#ff9df0', trim: '#ffd2fb', glow: '#ff5ee0', capDepth: .22, wave: 0, lipWidth: .09 },
  shape: { step: .5, round: .8, jag: .4 },
  hazard: false,
  build(k, { floor }) {
    const sky = k.sky({ top: '#05031a', mid: '#1c0f45', bottom: '#3a1470', horizon: -.2, stars: 1, starColor: '#f2e8ff', nebula: ['#ff5ee0', '#4a7bff', .8], drift: .002 });
    const warp = swirl(k, { x: 0, y: 12, z: -500, radius: 260, inner: '#ffe6ff', outer: '#4a1a9a', arms: 5, twist: 9, speed: .25, strength: .55 });
    // A ringed planet and slow meteors in the void.
    const planet = k.add(new Mesh(k.own(gradient(new SphereGeometry(40, 32, 18), '#ffb0f0', '#3a1a7a', -40, 40)), k.lit({ haze: ['#1c0f45', .35] })));
    planet.position.set(-150, 60, -520);
    const ringMesh = k.add(new Mesh(k.own(paint(new CylinderGeometry(70, 70, .5, 64, 1, true), '#ff9df0')), k.flat({ transparent: true, opacity: .35 })));
    ringMesh.position.copy(planet.position); ringMesh.rotation.set(.35, 0, .4);
    const meteors = k.streaks(k.n(8)), mr = rng(8), trails = Array.from({ length: meteors.count }, () => ({ x: mr() * 400 - 200, y: mr() * 120 - 20, z: -200 - mr() * 200, v: 20 + mr() * 30, len: 8 + mr() * 14 }));
    // Energy wisps curling under the platform (thin, below the collision bottom only).
    const wisps = k.streaks(6, 3);
    const hue = new Color(), a = new Color('#ff5ee0'), b = new Color('#4a7bff'), c = new Color('#5effd0');
    return u => {
      sky.update(u); warp.update(u); const t = clock(u);
      // The void shifts through three nebula moods over a minute.
      const phase = (t / 20) % 3, i = Math.floor(phase), f = phase - i, cols = [a, b, c];
      hue.copy(cols[i]).lerp(cols[(i + 1) % 3], f); sky.material.uniforms.uNebA.value.copy(hue); sky.material.uniforms.uNebB.value.copy(cols[(i + 2) % 3]);
      warp.material.uniforms.uOut.value.copy(hue).multiplyScalar(.5);
      planet.rotation.y = t * .02;
      trails.forEach((m, j) => { const x = ((m.x + t * m.v) % 400 + 400) % 400 - 200; meteors.set(j, x, m.y - x * .15, m.z, m.len, .35, -.15, '#ffd8ff', .8); });
      meteors.commit();
      for (let j = 0; j < 6; j++) { const s = (t * .4 + j / 6) % 1; wisps.set(j, Math.sin(j * 2.1 + t * .3) * 3, floor.top - 6.6 - s * 3, .2, 2.2, .18, Math.PI / 2 + Math.sin(t + j) * .3, hue, .7 * Math.sin(s * Math.PI)); }
      wisps.commit();
    };
  },
};

const cloudbreak: StageModule = {
  lighting: { sky: '#c9b0f0', ground: '#6b3d8f', key: '#ffe6c8', keyIntensity: 1.25, keyDir: [.45, .85, .65], rim: '#ffa46b', rimDir: [.5, .35, -1], ambient: .55 },
  ground: { style: 'rock', cap: '#f4e6cc', capDark: '#e2c6a4', face: '#d8a083', faceDeep: '#43256b', line: '#9c5d78', lip: '#fff1dc', trim: '#ffb347', capDepth: .3 },
  slab: { style: 'rock', cap: '#f4e6cc', capDark: '#e6cfb0', face: '#c98f78', faceDeep: '#7a4a8a', line: '#9c5d78', lip: '#ffb347', capDepth: .1, lipWidth: .06 },
  shape: { step: .35, round: 1.2, jag: .5 },
  build(k, { floor }) {
    const sky = k.sky({ top: '#261a63', mid: '#ef8f8f', bottom: '#ffcf96', horizon: -.07, sun: { dir: [.34, -.035, -1], color: '#fff3d6', halo: '#ffab63', size: .0022, glow: 1.25 }, stars: .3, starColor: '#ffe8f4' });
    const sea = farPlane(k, { y: -20, lit: '#ffd9b8', mid: '#e59aa8', shade: '#8a5c9e', horizon: '#ffc59a' });
    const haze = '#e7a0b2';
    const isles = drifters(k, island(13, 6, 9, '#f0c8a8', '#b77a86', '#4f3470'), [haze, .55], [[-62, 3, -120, 1.8], [48, 9, -150, 2.4], [95, -2, -135, 1.5], [-26, 13, -70, .8], [27, -6, -55, .6], [-100, 12, -160, 2]].slice(0, k.low ? 4 : 6) as [number, number, number, number][]);
    const low = cloudBank(k, { seed: 11, count: 7, z: [-55, -80], y: [-18, -9], s: [1.6, 2.6], speed: .5, top: '#ffe3d6', bottom: '#b77aa6', haze: [haze, .55] });
    const high = cloudBank(k, { seed: 13, count: 4, z: [-60, -90], y: [14, 22], s: [1.2, 2], speed: .35, top: '#ffd9cf', bottom: '#a978b0', haze: [haze, .5] });
    const near = cloudBank(k, { seed: 12, count: 5, z: [-14, -26], y: [-12, -7.5], s: [.7, 1.2], speed: .9, top: '#fff4ea', bottom: '#c483aa', haze: [haze, .18] });
    // Low ruins and shrubs behind the floor's back edge; lamps glow on two of them.
    const props: BufferGeometry[] = [], w = (floor.right - floor.left) / 2;
    for (const [f, h] of [[-.92, 1.1], [-.83, .55], [.84, .8], [.93, 1.35]] as const) props.push(paint(at(new CylinderGeometry(.26, .3, h, 8), f * w, floor.top + h / 2, -2.2), '#efd9bc'), paint(at(new CylinderGeometry(.34, .34, .12, 8), f * w, floor.top + h + .06, -2.2), '#ffc27a'));
    for (const [f, s] of [[-.68, .55], [-.6, .4], [-.15, .35], [.27, .5], [.33, .32], [.7, .45]] as const) props.push(gradient(at(new IcosahedronGeometry(s, 1), f * w, floor.top + s * .55, -2.3, 0, 1.3, .85, 1), '#b98be0', '#5c3a86', floor.top - .1, floor.top + s * 1.2));
    k.batch(props, k.lit());
    const under: BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) under.push(at(puff(40 + i, 2.4, .45, '#fff4f0', '#e0a8c8', 4), (i - 2) * 1.6, floor.top - 3.9, .5 + (i % 3) * .3, 0, 1, .4, 1));
    k.batch(under, k.lit({ haze: [haze, .1] }));
    const glows = k.glows(2), birds = k.pool(merge([paint(at(new PlaneGeometry(.9, .12), -.4, 0, 0, .35), '#3a2450'), paint(at(new PlaneGeometry(.9, .12), .4, 0, 0, -.35), '#3a2450')]), k.flat(), k.low ? 1 : 5, -30);
    return u => {
      sky.update(u); sea(u); isles(u); low(u); high(u); near(u); const t = clock(u);
      [[-.92, 1.35], [.93, 1.6]].forEach(([f, y], i) => glows.set(i, f * w, floor.top + y, -2, 1.6 + Math.sin(t * 2.3 + i) * .12, undefined, 0, '#ffb35c', .8)); glows.commit();
      for (let i = 0; i < birds.count; i++) { const x = -120 + ((t * .012 + i * .04) % 1) * 240 + i * 3, flap = Math.sin(t * 5 + i) * .35; birds.set(i, x, 14 + i * 1.2 + Math.sin(t * .5 + i) * .6, -90 - i * 4, 1.6, 1.6 * (1 - Math.abs(flap)), flap * .3); }
      birds.commit();
    };
  },
};

export default { battlefield, 'final-destination': finalDestination, cloudbreak } as const;
