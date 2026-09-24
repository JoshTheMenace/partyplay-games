/** Metroid series: Brinstar (rising acid) and Brinstar Depths (Kraid). */
import { BoxGeometry, Color, ConeGeometry, Mesh, ShaderMaterial, SphereGeometry, type BufferGeometry } from 'three';
import { GLSL_NOISE, at, gradient, merge, paint, rng, silhouetteGeometry, smooth, type Kit, type StageUpdate } from '../kit';
import { crystals, ridge } from '../decor';
import type { StageModule } from '../index';
import { clock, farPlane, parallax, scatter, sparkles } from './common';

/** A glowing liquid body whose surface sits at `level` (acid, lava): front face plus a bubbling top. */
function liquid(k: Kit, hot: string, cool: string, width: number) {
  const material = k.own(new ShaderMaterial({
    uniforms: { uHot: { value: new Color(hot) }, uCool: { value: new Color(cool) }, uTime: { value: 0 }, uAlarm: { value: 0 } },
    vertexShader: /* glsl */`varying vec3 vW; varying vec3 vN; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`uniform vec3 uHot, uCool; uniform float uTime, uAlarm; varying vec3 vW; varying vec3 vN; ${GLSL_NOISE}
      void main(){
        float n = noise(vec2(vW.x * .6 + uTime * .3, vW.z * .8 + vW.y * .5 - uTime * .6)) * .6 + noise(vW.xz * 2.1 + uTime) * .4;
        float top = step(.5, vN.y), depth = clamp(-vW.y * .06, 0., 1.);
        vec3 col = mix(uHot, uCool, depth * (1. - top)); col = mix(col, vec3(1., .95, .7), smoothstep(.7, .78, n) * (.5 + top * .5));
        col *= 1. + uAlarm * (.35 + .35 * sin(uTime * 14.));
        gl_FragColor = vec4(col, 1.);
        #include <colorspace_fragment>
      }`,
  }));
  const mesh = k.add(new Mesh(k.own(at(new BoxGeometry(width, 30, 7), 0, -15, -1.5)), material)); mesh.renderOrder = 2;
  return { mesh, set(level: number, alarm: number, u: StageUpdate) { mesh.position.set(u.camera.position.x, level, 0); material.uniforms.uTime.value = clock(u); material.uniforms.uAlarm.value = alarm; } };
}
/** Organic cavern growths: bulbous stalks with glowing tips. */
function growths(seed: number, count: number, y: number, z: [number, number], span: number, stalk: string, tip: string) {
  const r = rng(seed), parts: BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const x = (r() - .5) * span, h = 2 + r() * 6, zz = z[0] + r() * (z[1] - z[0]);
    parts.push(gradient(at(new ConeGeometry(.5 + r() * .6, h, 7), x, y + h / 2, zz, (r() - .5) * .4), stalk, '#1a0a1e', y, y + h), paint(at(new SphereGeometry(.4 + r() * .4, 10, 8), x, y + h, zz), tip));
  }
  return merge(parts);
}

const brinstar: StageModule = {
  lighting: { sky: '#ffc9a8', ground: '#3a1030', key: '#ffb890', keyIntensity: 1.1, keyDir: [.3, .8, .6], rim: '#ff8455', rimDir: [-.5, .2, -1], ambient: .5 },
  ground: { style: 'rock', cap: '#b86a7a', capDark: '#8a4a5a', face: '#736088', faceDeep: '#2a0a2a', line: '#4a2a4a', lip: '#ffc9a8', trim: '#ff8455', capDepth: .22, wave: .8 },
  hints: { flesh: { style: 'cloud', cap: '#e88aa8', capDark: '#b8587a', face: '#c8587a', faceDeep: '#6a1a3a', lip: '#ffd0d8', capDepth: .12, wave: .6 } },
  shape: { step: .4, round: 1, jag: .8 },
  hazard: false,
  build(k, { floor, stage }) {
    const sky = k.sky({ top: '#12040f', mid: '#3a1030', bottom: '#8a3a3a', horizon: -.15 });
    const walls = parallax(k, [
      { geo: silhouetteGeometry(ridge(3, -200, 200, floor.top + 6, floor.top + 24, 16, 1.2), floor.top - 40, -90, '#2a0a22', '#4a1a3a'), follow: .5 },
      { geo: silhouetteGeometry(ridge(5, -120, 120, floor.top - 6, floor.top + 6, 18, 1.4), floor.top - 30, -45, '#4a1a3a', '#6a2a4a'), follow: .3 }]);
    k.batch([growths(4, k.n(20), floor.top - 8, [-18, -32], 60, '#8a3a5a', '#ffb070')], k.lit({ haze: ['#3a1030', .25] })).renderOrder = -30;
    const orbs = sparkles(k, scatter(5, k.n(14), [-20, 20], [floor.top - 2, floor.top + 10], [-14, -28], [.5, 1.1]), '#ff9a5a', .7);
    const acid = liquid(k, '#ffb040', '#a02a10', 140), rest = stage.blast.bottom * .5, bubbles = k.glows(k.n(24), 6), br = rng(12), spots = Array.from({ length: bubbles.count }, () => [br() * 2 - 1, br()] as const);
    return (u, frame) => {
      sky.update(u); walls(u); orbs(u);
      const h = frame.hazard, z = h?.zones[0];
      acid.set(z ? z.top : Math.max(rest, -4.8), h?.warning ? 1 : h?.active ? .35 : 0, u);
      // Warning: acid bubbles boil up past the stage's edges, so the rise is telegraphed even while the pool is below the frame.
      spots.forEach(([fx, p], i) => {
        if (!h?.warning) { bubbles.hide(i); return; }
        const s = ((p + u.seconds * (.35 + p * .3)) % 1), x = u.camera.position.x + fx * 16;
        bubbles.set(i, x, floor.top - 7 + s * 6.7, 2, .9 + .6 * Math.sin(s * Math.PI), undefined, 0, '#ffb040', Math.sin(s * Math.PI));
      });
      bubbles.commit();
    };
  },
};

/** Kraid: a huge horned reptile head and shoulders, rising behind the stage. */
function kraid(k: Kit) {
  const parts: BufferGeometry[] = [gradient(at(new SphereGeometry(9, 22, 16), 0, 0, 0, 0, 1, 1.2, .7), '#5a8a3a', '#1a2a12', -10, 10),
    gradient(at(new SphereGeometry(6, 18, 12), 0, 11, 1, 0, 1.1, .9, .8), '#6a9a3a', '#2a3a1a', 6, 16)];
  for (const s of [-1, 1]) {
    parts.push(paint(at(new SphereGeometry(1.2, 10, 8), s * 2.4, 12, 5.2), '#ffe040'), paint(at(new ConeGeometry(.9, 4, 6), s * 4.5, 16.5, 0, -s * .5), '#e8e0c0'));
    for (let i = 0; i < 3; i++) parts.push(paint(at(new ConeGeometry(.7, 2.6, 6), s * (3 + i * 2.2), 4 - i * 2.2, 6, -s * 1.4), '#e8e0c0'));
  }
  parts.push(paint(at(new BoxGeometry(6, 1.2, 1), 0, 8.6, 5.4), '#3a0a0a'));
  for (let i = 0; i < 5; i++) parts.push(paint(at(new ConeGeometry(.3, .9, 4), -2 + i, 9.1, 5.7, Math.PI), '#ffffff'));
  return new Mesh(k.own(merge(parts)), k.lit({ haze: ['#283a46', .25] }));
}
const depths: StageModule = {
  lighting: { sky: '#d8f0c0', ground: '#0a1016', key: '#e0ffb8', keyIntensity: 1.05, keyDir: [.3, .9, .5], rim: '#ff7a3a', rimDir: [.3, -.2, -1], ambient: .5 },
  ground: { style: 'rock', cap: '#5a5048', capDark: '#3a342e', face: '#4a4640', faceDeep: '#0a0a0c', line: '#2a2622', lip: '#c8e0a0', trim: '#b2e357', capDepth: .12, wave: .5 },
  slab: { style: 'rock', cap: '#6a6052', face: '#4a4640', faceDeep: '#1a2418', line: '#2a3a2a', lip: '#b2e357', capDepth: .08, wave: .3 },
  shape: { step: .4, round: 1, jag: .9 },
  hazard: false,
  build(k, { floor }) {
    const sky = k.sky({ top: '#05080a', mid: '#1e2733', bottom: '#6a3a1a', horizon: -.18 });
    const lava = farPlane(k, { y: floor.top - 14, lit: '#ffe07a', mid: '#ff7a2a', shade: '#8a1a0a', horizon: '#3a1a0a', scale: [.04, .06], speed: .05, bands: [.5, .68] });
    const walls = parallax(k, [{ geo: silhouetteGeometry(ridge(7, -200, 200, floor.top + 4, floor.top + 26, 14, 1.3), floor.top - 30, -80, '#0a1016', '#283a46'), follow: .5 }]);
    k.batch([crystals(3, k.n(10), 3, '#b2e357', '#2a4a1a')], k.lit()).position.set(-9, floor.top - 7, -16);
    const boss = k.add(kraid(k)); boss.position.set(0, floor.top - 22, -34);
    const embers = sparkles(k, scatter(6, k.n(12), [-18, 18], [floor.top - 10, floor.top + 4], [-8, -20], [.3, .6]), '#ff9a3a', .8);
    let rise = 0;
    return (u, frame) => {
      sky.update(u); lava(u); walls(u); embers(u);
      const h = frame.hazard, target = h?.active ? 1 : h?.warning ? .7 : 0;
      rise += (target - rise) * Math.min(1, u.dt * 1.5);
      boss.position.y = floor.top - 22 + smooth(0, 1, rise) * 14 + Math.sin(clock(u) * .8) * .3;
      boss.rotation.z = h?.active && !u.reduced ? Math.sin(u.seconds * 10) * .03 : 0;
    };
  },
};

export default { brinstar, 'brinstar-depths': depths } as const;
