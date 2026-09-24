/** Retro series: Icicle Mountain (Ice Climber's endless climb) and Flat Zone (a Game & Watch LCD screen). */
import { BoxGeometry, CircleGeometry, Color, ConeGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, type BufferGeometry } from 'three';
import { GLSL_NOISE, at, gradient, merge, paint, rng, type SurfaceOptions } from '../kit';
import { ridge } from '../decor';
import type { StageFrame, StageModule } from '../index';
import { cloudBank, looped, particles } from './common';
import { slab } from './pieces';

const ice: SurfaceOptions = { style: 'ice', cap: '#ffffff', capDark: '#d8f0fa', face: '#9fd6ee', faceDeep: '#2f5f8e', line: '#5a90b8', lip: '#e8fbff', trim: '#ffd84a', capDepth: .32, wave: .6 };
/** Distance the mountain has scrolled (mod the treadmill length), read back from a platform so it can never drift from collision. */
const climbed = (frame: StageFrame, start: StageFrame, period: number) => {
  const p = start.platforms[0], now = p && frame.platforms.find(q => q.id === p.id);
  return p && now ? (((p.y - now.y) % period) + period) % period : 0;
};
/** One period of the cliff wall behind the climb: jagged ice boulders on both flanks, snow on their ledges. */
const cliff = (seed: number, span: number, x: number, z: number, top: string, deep: string) => (shift: number) => {
  const r = rng(seed), parts: BufferGeometry[] = [];
  for (let i = 0; i < 14; i++) for (const s of [-1, 1]) {
    const y = shift - span / 2 + (i + r() * .5) * span / 14, size = 2.5 + r() * 3.5, px = s * (x + r() * 6);
    parts.push(gradient(at(new IcosahedronGeometry(size, 0), px, y, z - r() * 6, r() * 3, 1.3, .8, 1), top, deep, y - size, y + size));
    parts.push(paint(at(new BoxGeometry(size * 1.4, .35, size * .9), px - s * size * .2, y + size * .62, z - r() * 3 + size * .3, 0), '#ffffff'));
  }
  return merge(parts);
};
const icicleMountain: StageModule = {
  lighting: { sky: '#f0fbff', ground: '#53778e', key: '#fffaf0', keyIntensity: 1.25, keyDir: [.35, .9, .5], rim: '#a9eeff', rimDir: [-.5, .35, -1], ambient: .62 },
  ground: ice, hints: { ice }, slab: { ...ice, capDepth: .1 },
  shape: { step: .3, round: .7, jag: .5 },
  piece(k, p, ctx) {
    if (p.kind !== 'platform') return undefined;
    // An ice shelf with icicles hanging below it.
    const w = p.platform.right - p.platform.left, r = rng(Math.round(w * 10)), g = new Group(), cones: BufferGeometry[] = [];
    g.add(slab(w, ctx.material('ice', true), .32, .15));
    for (let i = 0; i < Math.max(3, Math.round(w * 1.2)); i++) { const h = .3 + r() * .7; cones.push(gradient(at(new ConeGeometry(.08 + r() * .08, h, 5), -w / 2 + .2 + r() * (w - .4), -.32 - h / 2, (r() - .5) * 1.6, Math.PI), '#e8fbff', '#7ac0e8', -.32 - h, -.32)); }
    g.add(new Mesh(k.own(merge(cones)), k.lit())); return g;
  },
  hazard: false,
  build(k, { floor, frame: start }) {
    const t0 = floor.top, period = 43.2, sky = k.sky({ top: '#3a7ab8', mid: '#a9d8f0', bottom: '#f0fbff', horizon: -.1, sun: { dir: [.4, .45, -1], color: '#ffffff', halo: '#e8f8ff', size: .002, glow: .9 } });
    const near = looped(k, cliff(3, period, 13, -8, '#c8ecfa', '#3a6a9a'), period, k.lit({ haze: ['#d8f0fa', .15] }), 1, -38);
    const far = looped(k, cliff(9, period, 22, -34, '#b8dcf0', '#5a88b0'), period, k.lit({ haze: ['#e0f6ff', .5] }), 1, -39);
    const peaks = k.silhouette(ridge(5, -220, 220, t0 - 10, t0 + 34, 9, 1.2), t0 - 40, -200, '#e8f8ff', '#6a98c0'); peaks.renderOrder = -42;
    const clouds = cloudBank(k, { seed: 81, count: 6, z: [-60, -110], y: [t0 - 10, t0 + 16], s: [1.4, 2.4], speed: .5, top: '#ffffff', bottom: '#b8d8ec', haze: ['#f0fbff', .4] });
    const snow = particles(k, { count: 60, color: '#ffffff', speed: [1.2, 2.4], drift: .8, size: [.18, .3], z: [-6, 4], intensity: .7 });
    return (u, frame) => {
      const d = climbed(frame, start, period);
      sky.update(u); near.set(d); far.set(d * .5); peaks.position.y = -Math.min(d, 6) * .05; clouds(u); snow(u);
    };
  },
};

// ── Flat Zone: flat dark LCD segments on a pale screen; the scenes not showing stay as faint ghosts, like real LCD glass ──
const LCD = { screen: '#b5c4a0', ink: '#353f36' };
const lcdFlat: SurfaceOptions = { style: 'lcd', cap: LCD.ink, capDark: LCD.ink, face: LCD.ink, faceDeep: LCD.ink, line: LCD.ink, lip: '#4a5a48', trim: '#6a7a60', capDepth: 0, wave: 0, flat: true, lipWidth: .03 };
const box = (x: number, y: number, w: number, h: number) => at(new PlaneGeometry(w, h), x, y, 0);
const disc = (x: number, y: number, r: number) => at(new CircleGeometry(r, 16), x, y, 0);
/** A stick figure in the G&W style: head, body, arms at `arm` radians. */
const man = (x: number, y: number, s = 1, arm = .6) => [disc(x, y + 1.55 * s, .22 * s), box(x, y + .95 * s, .36 * s, .8 * s), box(x - .12 * s, y + .3 * s, .14 * s, .6 * s), box(x + .12 * s, y + .3 * s, .14 * s, .6 * s),
  at(new PlaneGeometry(.6 * s, .1 * s), x - .35 * s, y + 1.1 * s, 0, arm), at(new PlaneGeometry(.6 * s, .1 * s), x + .35 * s, y + 1.1 * s, 0, -arm)];
/** The three scenes' pictograms (Fire, Oil Panic, Helmet), in meters on the screen plane. */
function scenes(t: number): BufferGeometry[][] {
  const fire = [box(-10.6, t + 3.5, 2.2, 7), ...[0, 1, 2].flatMap(i => [box(-11.1, t + 1.5 + i * 2, .6, .7), box(-10.1, t + 1.5 + i * 2, .6, .7)]), ...[0, 1, 2].map(i => at(new ConeGeometry(.35, 1.1, 3), -11.2 + i * .6, t + 7.6, 0)),
    ...man(-2.2, t, .9), ...man(2.2, t, .9, -.6), box(0, t + .95, 4.4, .12), box(8.8, t + 1.1, 4, 2.2), disc(7.6, t, .45), disc(10, t, .45), box(8.8, t + 2.5, .8, .5)];
  const oil = [box(-6, t + 9.6, 12, .5), ...[-9, -5, -1, 3].map(x => box(x, t + 8.9, .5, .8)), box(8.6, t + 1.5, 1.4, 3), box(8.6, t + 3.3, .9, .6), ...man(5.6, t, .9), box(5.6, t + 2, 1.2, .5), ...[-7, -3, 1].map(x => disc(x, t + 7.4, .2))];
  const helmet = [box(-10.5, t + 2, 2.4, 4), at(new ConeGeometry(1.9, 1.3, 3), -10.5, t + 4.6, 0), box(10.6, t + 2.2, 2.2, 4.4), box(10.1, t + 1.3, .9, 2.6), ...man(-7.5, t, .8), disc(-7.5, t + 1.78 * .8, .3)];
  return [fire, oil, helmet];
}
const sceneOf = (frame: StageFrame) => frame.platforms.some(p => p.id.startsWith('fire')) ? 0 : frame.platforms.some(p => p.id === 'oil') ? 1 : frame.platforms.some(p => p.id.startsWith('helmet')) ? 2 : -1;
const flatZone: StageModule = {
  lighting: { sky: '#e8f0d8', ground: '#a8b890', key: '#ffffff', keyIntensity: 1, keyDir: [.3, .9, .5], rim: '#e8f0d8', rimDir: [-.5, .3, -1], ambient: .7 },
  ground: lcdFlat, slab: lcdFlat, shape: { round: .02, step: 0, jag: 0 },
  hazard: false,
  build(k, { floor, stage }) {
    const t0 = floor.top, view = stage.camera;
    const sky = k.sky({ top: '#a8b890', mid: '#b5c4a0', bottom: '#c9d6b0', horizon: -.2 });
    // The LCD glass: pale green-grey with a faint pixel grid and a slow diagonal sheen, covering the whole camera box.
    const glass = k.own(new ShaderMaterial({
      uniforms: { uScreen: { value: new Color(LCD.screen) }, uTime: { value: 0 } },
      vertexShader: /* glsl */`varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`uniform vec3 uScreen; uniform float uTime; varying vec3 vW; ${GLSL_NOISE}
        void main(){ vec2 g = fract(vW.xy * 3.); float grid = step(.92, max(g.x, g.y));
          vec3 col = uScreen * (.97 + .05 * noise(vW.xy * .08)) - grid * .025;
          col += .05 * smoothstep(.2, 0., abs(fract((vW.x + vW.y) * .02 - uTime * .01) - .5));
          gl_FragColor = vec4(col, 1.);
          #include <colorspace_fragment>
        }`,
    }));
    const back = k.add(new Mesh(k.own(new PlaneGeometry(view.right - view.left + 60, view.top - view.bottom + 40)), glass));
    back.position.set((view.left + view.right) / 2, (view.bottom + view.top) / 2, -6); back.renderOrder = -60;
    const ink = k.own(new MeshBasicMaterial({ color: LCD.ink, toneMapped: false })), ghost = k.own(new MeshBasicMaterial({ color: LCD.ink, transparent: true, opacity: .07, depthWrite: false, toneMapped: false }));
    const groups = scenes(t0).map(parts => { const m = k.add(new Mesh(k.own(merge(parts)), ghost)); m.position.z = -5.8; m.renderOrder = -50; return m; });
    // Falling tools (Helmet): ghosts blink where they will drop during the warning, solid while they fall.
    const tool = merge([box(0, 0, .25, 1.2), at(new PlaneGeometry(.9, .35), 0, .55, 0)]), tools = k.pool(tool, ink, 3, 3), toolGhost = k.pool(tool.clone(), ghost, 3, 3);
    let shown = -2;
    return (u, frame) => {
      sky.update(u); glass.uniforms.uTime.value = u.reduced ? 0 : u.seconds;
      const scene = sceneOf(frame);
      if (scene !== shown) { shown = scene; groups.forEach((m, i) => { m.material = i === scene ? ink : ghost; m.renderOrder = i === scene ? -49 : -50; }); }
      const h = frame.hazard, blink = u.reduced || Math.sin(u.seconds * 12) > 0;
      for (let i = 0; i < 3; i++) {
        const z = h?.zones[i];
        if (z && h.active) { tools.set(i, (z.left + z.right) / 2, (z.bottom + z.top) / 2, .6, 1, 1, Math.sin(z.bottom) * .6); toolGhost.hide(i); }
        else if (z && h.warning && blink) { toolGhost.set(i, (z.left + z.right) / 2, Math.min(view.top - 1.5, z.bottom + 1), .6, 1.2); tools.hide(i); }
        else { tools.hide(i); toolGhost.hide(i); }
      }
      tools.commit(); toolGhost.commit();
    };
  },
};

export default { 'icicle-mountain': icicleMountain, 'flat-zone': flatZone } as const;
