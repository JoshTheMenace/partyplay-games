/**
 * Combat effects for the display scene.
 *
 *   const fx = createFx(scene, scope);
 *   for (const e of newEvents) fx.event(e, view);     // each event id once
 *   fx.track(view.fighters);                          // optional: FighterActors under `scene` already feed dust, fast-fall glints and launch trails
 *   fx.projectiles(view.projectiles, seconds);        // every frame
 *   fx.update(dt, reduced);                           // every frame
 *   const kick = fx.cameraKick();                     // {x, y, zoom, flash, flashColor}: add to the camera, draw the flash
 *
 * Everything is pooled: two particle draws, a few KO columns, and one mesh per live projectile. Reduced motion turns
 * off shake, zoom punches and screen flashes and thins particles.
 */
import { AdditiveBlending, Color, DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, type Object3D } from 'three';
import type { ResourceScope } from '../../../../../party-runtime/src/index';
import type { FighterView, GameEvent, HitEffect, ProjectileView, View } from '../../model';
import { PHYSICS } from '../../moveset';
import { Particles, type Shape, type Spawn } from './particles';
import { EFFECT_COLOR, ProjectileArt, type Emit } from './projectiles';

export type CameraKick = { x: number; y: number; zoom: number; flash: number; flashColor: string };
export type Fx = {
  event(e: GameEvent, view: View): void;
  projectiles(list: readonly ProjectileView[], seconds: number): void;
  /** A move's authored accent (crew): a lantern flare, a ground burst, a footfall. */
  cue(kind: 'step' | 'flare' | 'burst' | 'swish' | 'ring', x: number, y: number, power: number, color: string): void;
  track(fighters: readonly FighterView[]): void;
  update(dt: number, reduced: boolean): void;
  cameraKick(): CameraKick;
  /** Brighter additive sprites for the HDR pipeline (bloom); off for legacy stages. */
  setHdr(on: boolean): void;
  readonly stats: { particles: number; projectiles: number };
  dispose(): void;
};
/** scene.userData key: FighterActors anywhere under the fx scene report their view each frame (deduplicated with track()). */
export const FX_FEED = 'skyClashFxFeed';
/** scene.userData key for Fx.cue, so crew actors can fire their moves' accents. */
export const FX_CUE = 'skyClashFxCue';
export type FxFeed = (fighter: FighterView) => void;
type RGB = [number, number, number];
type Burst = { speed: number; life: number; size: number; color: RGB; shape: Shape; gravity?: number; drag?: number; dir?: number; spread?: number; grow?: number; spin?: number; alpha?: number; z?: number };
const WHITE: RGB = [1, 1, 1];
const hex = (c: string): RGB => { const k = new Color(c); return [k.r, k.g, k.b]; };
const once = (fn: () => void) => { let done = false; return () => { if (!done) { done = true; fn(); } }; };
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const COLUMN_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const COLUMN_FRAG = `uniform vec3 uColor; uniform float uT; varying vec2 vUv;
void main() {
  float across = 1.0 - pow(abs(vUv.y - .5) * 2.0, 1.6), along = smoothstep(0.0, .12, vUv.x) * (1.0 - smoothstep(.55, 1.0, vUv.x));
  float core = pow(across, 6.0);
  vec3 col = mix(uColor, vec3(1.0), core * .8);
  gl_FragColor = vec4(col, across * along * (1.0 - uT) * 1.4);
}`;

export function createFx(scene: Object3D, scope: ResourceScope, opts: { hdr?: boolean } = {}): Fx {
  const add = new Particles(1400, true), norm = new Particles(700, false);
  add.gain = opts.hdr ? 1.2 : 1;
  scene.add(add.points, norm.points);
  const art = new ProjectileArt(scene);
  let seed = 0x2545f491;
  const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 100000) / 100000; };
  let reduced = false, trauma = 0, punch = 0, flash = 0, flashColor = '#ffffff', clock = 0;
  const emit: Emit = { add, norm, rand, reduced };
  const tracked = new Map<string, { state: string; vy: number; grounded: boolean; effect: HitEffect; t: number; at: number }>();

  // KO blast columns: stretched glowing planes shot back along the launch line.
  const columnGeo = new PlaneGeometry(1, 1).translate(.5, 0, 0);
  const columns = Array.from({ length: 4 }, () => {
    const mat = new ShaderMaterial({ vertexShader: COLUMN_VERT, fragmentShader: COLUMN_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, uniforms: { uColor: { value: new Color() }, uT: { value: 1 } } });
    const mesh = new Mesh(columnGeo, mat); mesh.visible = false; mesh.renderOrder = 21; mesh.frustumCulled = false; scene.add(mesh);
    return { mesh, mat, t: 1, life: 1, len: 1 };
  });
  let nextColumn = 0;

  const n = (count: number) => Math.max(1, Math.round(count * (reduced ? .4 : 1)));
  const spawn = (p: Spawn) => (p.shape === 'puff' || p.shape === 'leaf' || p.shape === 'coin' ? norm : add).spawn(p);
  function burst(x: number, y: number, count: number, o: Burst) {
    for (let i = 0; i < n(count); i++) {
      const a = o.dir === undefined ? rand() * Math.PI * 2 : o.dir + (rand() - .5) * (o.spread ?? 1.4), s = o.speed * (.45 + .75 * rand());
      spawn({ x, y, z: o.z ?? .35 + rand() * .1, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: o.life * (.7 + .5 * rand()), size: o.size * (.7 + .6 * rand()), color: o.color, shape: o.shape,
        gravity: o.gravity, drag: o.drag ?? 5, grow: o.grow, angle: o.shape === 'spark' || o.shape === 'shard' ? a : rand() * 6.28, spin: o.spin ? (rand() - .5) * o.spin : 0, alpha: o.alpha });
    }
  }
  const ring = (x: number, y: number, size: number, color: RGB, life = .25, grow = 2.6, alpha = .7) => add.spawn({ x, y, z: .4, life, size, grow, color, shape: 'ring', alpha });
  const glow = (x: number, y: number, size: number, color: RGB, life = .1, alpha = 1) => add.spawn({ x, y, z: .45, life, size: size * .45, grow: .3, color, shape: 'glow', alpha: alpha * .8 });
  const dust = (x: number, y: number, count: number, dir: number, spread: number, speed = 2.2, size = .38) => burst(x, y + .06, Math.ceil(count * .7), { speed: speed * .8, life: .42, size: size * .55, color: [.8, .78, .76], shape: 'puff', dir, spread, drag: 4, grow: 1.6, gravity: -.5, alpha: .34, z: .3 });
  const kick = (power: number) => { if (reduced) return; trauma = Math.min(1, trauma + power * .7); if (power > .6) punch = Math.max(punch, .05 + .08 * (power - .6) / .4); };
  const screen = (amount: number, color = '#ffffff') => { if (reduced) return; if (amount > flash) { flash = amount; flashColor = color; } };

  /**
   * Shape first, then glow: a white-hot core for two frames, a starburst and streaks thrown along the launch line, one shock ring, a few heavy
   * shards, then the element's own signature (flames that rise, a crescent for blades, forks for lightning). Sized by damage and power.
   */
  function hitSpark(effect: HitEffect, x: number, y: number, power: number, damage: number, angle: number) {
    const s = Math.min(1.8, .5 + damage / 22 + power * .5), c = EFFECT_COLOR[effect] ?? EFFECT_COLOR.normal, hot = mixc(c, WHITE, .5), dir = angle * Math.PI / 180;
    add.spawn({ x, y, z: .5, life: .06, size: .3 * s, grow: .8, color: mixc(c, WHITE, .8), shape: 'glow', alpha: .8 });
    add.spawn({ x, y, z: .5, life: .12, size: .8 * s, grow: .7, color: hot, shape: 'burst', angle: dir, alpha: .5 });
    ring(x, y, .3 * s, mixc(c, WHITE, .3), .2, 3.6, .45);
    for (let i = 0; i < n(3 + 6 * s); i++) { const a = dir + (rand() - .5) * 2.2, sp = (6 + 8 * rand()) * s; add.spawn({ x, y, z: .45, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .14 + .1 * rand(), size: (.3 + .35 * rand()) * s, color: i % 2 ? hot : c, shape: 'streak', angle: a, drag: 6, alpha: .7 }); }
    burst(x, y, 2 + 5 * s, { speed: 5 * s, life: .45, size: .16 * s, color: mixc(c, WHITE, .2), shape: 'shard', dir, spread: 2.6, drag: 2, gravity: 9, spin: 14, alpha: .9 });
    switch (effect) {
      case 'fire': burst(x, y, 4 + 4 * s, { speed: 2.2, life: .42, size: .34 * s, color: [1, .5, .12], shape: 'flame', dir: Math.PI / 2, spread: 1.6, drag: 2, gravity: -3, grow: -.5, alpha: .85 });
        burst(x, y, 6, { speed: 3, life: .75, size: .07, color: [1, .75, .3], shape: 'glow', dir: Math.PI / 2, spread: 2.4, drag: 1.5, gravity: -2 }); break;
      case 'slash': add.spawn({ x, y, z: .5, life: .15, size: 1.5 * s, grow: .4, color: [.85, .95, 1], shape: 'crescent', angle: dir + Math.PI, alpha: .9 }); break;
      case 'electric': for (let i = 0; i < n(6); i++) add.spawn({ x: x + (rand() - .5) * .4 * s, y: y + (rand() - .5) * .4 * s, z: .5, life: .08 + .05 * rand(), size: 1.1 * s, color: [.75, .92, 1], shape: 'streak', angle: rand() * 6.28, alpha: .9 }); ring(x, y, .5 * s, [.7, .9, 1], .12, 3, .5); break;
      case 'ice': burst(x, y, 6 + 4 * s, { speed: 4 * s, life: .5, size: .2 * s, color: [.78, .93, 1], shape: 'shard', gravity: 7, spin: 10 }); burst(x, y, 6, { speed: 1.2, life: .8, size: .07, color: [.95, .98, 1], shape: 'glow', gravity: 1.2 }); break;
      case 'darkness': burst(x, y, 4 + 4 * s, { speed: 2 * s, life: .5, size: .34 * s, color: [.12, .02, .18], shape: 'puff', grow: 1, alpha: .7 }); break;
      case 'water': burst(x, y, 8 + 6 * s, { speed: 4.5 * s, life: .5, size: .12 * s, color: [.4, .7, 1], shape: 'glow', gravity: 12, dir, spread: 2 }); break;
      case 'star': burst(x, y, 4 + 4 * s, { speed: 4.5 * s, life: .45, size: .3 * s, color: [1, .9, .35], shape: 'star', spin: 10 }); break;
      case 'psychic': for (let i = 0; i < 2; i++) ring(x, y, .4 * s, [1, .45, .95], .3 + i * .08, 3 + i, .6); break;
      case 'magic': for (let i = 0; i < n(8 + 4 * s); i++) { const a = rand() * 6.28, sp = 3.5 * s * rand(); add.spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .5, size: .2 * s, color: hex(`hsl(${Math.floor(rand() * 360)}, 90%, 70%)`), shape: rand() > .5 ? 'star' : 'streak', angle: a, drag: 4, spin: 6 }); } break;
      case 'coin': burst(x, y, 3 + 3 * s, { speed: 5, life: .7, size: .24 * s, color: [1, .78, .15], shape: 'coin', gravity: 14, dir: Math.PI / 2, spread: 1.6, spin: 20 }); break;
      case 'sleep': burst(x, y, 5 + 3 * s, { speed: 1.2, life: .9, size: .22 * s, color: [1, .72, .92], shape: 'bubble', gravity: -1.5, drag: 1 }); break;
      case 'grass': burst(x, y, 6 + 4 * s, { speed: 4 * s, life: .8, size: .2 * s, color: [.4, .78, .25], shape: 'leaf', gravity: 3, spin: 12, drag: 3 }); break;
    }
  }

  function koBlast(x: number, y: number, angle: number, color: string) {
    const c = columns[nextColumn++ % columns.length], a = angle * Math.PI / 180;
    // The column erupts from the blast zone back toward the stage, like Melee's KO explosion.
    c.mesh.position.set(x, y, .5); c.mesh.rotation.set(0, 0, a + Math.PI); c.t = 0; c.life = .9; c.len = 16; c.mesh.visible = true;
    c.mat.uniforms.uColor.value.set(color).lerp(new Color('#ffffff'), .25);
    const col = hex(color);
    burst(x, y, 30, { speed: 16, life: .6, size: .7, color: mixc(col, WHITE, .5), shape: 'spark', dir: a + Math.PI, spread: 1.4, drag: 3 });
    burst(x, y, 14, { speed: 9, life: .9, size: .8, color: [1, .92, .5], shape: 'star', dir: a + Math.PI, spread: 2, drag: 2.5, spin: 8 });
    glow(x, y, 6, mixc(col, WHITE, .5), .3); add.spawn({ x, y, z: .5, life: .3, size: 4, grow: .6, color: mixc(col, WHITE, .6), shape: 'burst', angle: a + Math.PI, alpha: .9 });
    kick(1); screen(.55, color);
  }

  /** Per-fighter transitions: dash/skid dust, fast-fall glint, launch trails. Once per fighter per fx frame. */
  function feed(f: FighterView) {
    const last = tracked.get(f.id), P = PHYSICS[f.fighter];
    if (!last) { tracked.set(f.id, { state: f.state, vy: f.vy, grounded: f.grounded, effect: 'normal', t: 0, at: clock }); return; }
    if (last.at === clock) return;
    last.at = clock;
    if (f.state === 'out') { last.state = f.state; return; }
    if (f.state === 'run' && last.state !== 'run') dust(f.x - f.facing * .3, f.y, 4, f.facing > 0 ? Math.PI : 0, .6, 2.8);
    if (f.state === 'turn' && last.state !== 'turn') dust(f.x + f.facing * .2, f.y, 5, f.facing > 0 ? 0 : Math.PI, .7, 3.2);
    // Fast-fall glint (Melee's spark as the fall snaps to fast-fall speed).
    const ff = -(P?.fastFall ?? .19) * .97;
    if (!f.grounded && f.vy <= ff && last.vy > ff) add.spawn({ x: f.x, y: f.y + (P?.height ?? 1.7) * .55, z: .6, life: .22, size: 1.1, grow: -.5, color: [1, 1, .9], shape: 'spark', angle: .4 });
    // Launch trails: smoke puffs behind strong launches, colored sparks for the strongest.
    const speed = Math.hypot(f.vx, f.vy);
    if ((f.state === 'hitstun' || f.state === 'tumble') && f.launch > .06 && speed > .05) {
      last.t += 1;
      const h = (P?.height ?? 1.7) * .5, strong = f.launch > .16;
      if (!reduced || last.t % 2 === 0) norm.spawn({ x: f.x, y: f.y + h, z: .1, life: strong ? .55 : .38, size: .2 + f.launch * .9, grow: 1.5, color: [.86, .87, .92], alpha: .3, shape: 'puff' });
      if (strong) add.spawn({ x: f.x + (rand() - .5) * .3, y: f.y + h + (rand() - .5) * .3, z: .2, life: .22, size: .9, color: mixc(EFFECT_COLOR[last.effect] ?? EFFECT_COLOR.normal, WHITE, .3), shape: 'streak', angle: Math.atan2(f.vy, f.vx), alpha: .7 });
    } else last.t = 0;
    last.state = f.state; last.vy = f.vy; last.grounded = f.grounded;
  }
  scene.userData[FX_FEED] = feed as FxFeed;
  const cue: Fx['cue'] = (kind, x, y, power, color) => {
    const c = hex(color), hot = mixc(c, WHITE, .65);
    if (kind === 'flare') { add.spawn({ x, y, z: .5, life: .09, size: .7 * power, grow: 1, color: hot, shape: 'glow', alpha: .9 }); add.spawn({ x, y, z: .5, life: .2, size: 1.7 * power, grow: .4, color: c, shape: 'burst', angle: rand() * 1.5, alpha: .7 });
      burst(x, y, 6 * power, { speed: 3, life: .6, size: .08, color: hot, shape: 'glow', drag: 2, gravity: -2.5 }); }
    else if (kind === 'burst') { ring(x, y + .05, .5 * power, c, .3, 4.5, .7); burst(x, y + .1, 8 * power, { speed: 5, life: .4, size: .36 * power, color: c, shape: 'flame', dir: Math.PI / 2, spread: 2.2, drag: 3, gravity: -3, grow: -.4, alpha: .85 });
      burst(x, y + .1, 8 * power, { speed: 6, life: .7, size: .07, color: hot, shape: 'glow', dir: Math.PI / 2, spread: 2.6, drag: 1.5, gravity: -1 }); dust(x - .3, y, 3, Math.PI * .9, .5, 2.8); dust(x + .3, y, 3, Math.PI * .1, .5, 2.8); kick(.3 * power); }
    else if (kind === 'swish') {
      for (let i = 0; i < n(3 + 2 * power); i++) { const a = rand() * 6.28; add.spawn({ x: x + Math.cos(a) * .2 * power, y: y + Math.sin(a) * .2 * power, z: .5, vx: Math.cos(a) * 5 * power, vy: Math.sin(a) * 5 * power, life: .22 + .1 * rand(), size: (.7 + .5 * rand()) * power, grow: .5, color: i % 2 ? hot : c, shape: 'crescent', angle: a + Math.PI, drag: 5, alpha: .8 }); }
      for (let i = 0; i < n(6 * power); i++) { const a = rand() * 6.28, sp = (5 + 6 * rand()) * power; add.spawn({ x, y, z: .45, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .18 + .1 * rand(), size: .5 * power, color: hot, shape: 'streak', angle: a, drag: 6, alpha: .6 }); }
    }
    else if (kind === 'ring') { ring(x, y, .3 * power, hot, .28, 5.2, .8); ring(x, y, .5 * power, c, .42, 4.2, .55); ring(x, y, .75 * power, c, .58, 3.4, .32); add.spawn({ x, y, z: .5, life: .08, size: .5 * power, grow: 1, color: hot, shape: 'glow', alpha: .8 });
      burst(x, y, 6 * power, { speed: 4, life: .5, size: .06, color: hot, shape: 'glow', drag: 2 }); kick(.3 * power); }
    else if (kind === 'step') { dust(x - .15, y, 2, Math.PI * .9, .6, 2 * power); dust(x + .15, y, 2, Math.PI * .1, .6, 2 * power); }
  };
  scene.userData[FX_CUE] = cue;

  return {
    stats: { get particles() { return add.count + norm.count; }, get projectiles() { return art.count; } },
    event(e, view) {
      const target = e.target ? view.fighters.find(f => f.id === e.target) : undefined, source = e.source ? view.fighters.find(f => f.id === e.source) : undefined;
      const power = e.power ?? .3, angle = e.angle ?? 45, color = target?.color ?? source?.color ?? '#ffffff';
      switch (e.kind) {
        case 'hit': case 'hazard': {
          hitSpark(e.effect ?? 'normal', e.x, e.y, power, e.damage ?? 8, angle); kick(power);
          if (power > .75) screen(.18 * power);
          if (target) { const t = tracked.get(target.id); if (t) t.effect = e.effect ?? 'normal'; }
          break;
        }
        case 'shield': ring(e.x, e.y, .9, hex(color), .3, 1.6); burst(e.x, e.y, 5, { speed: 4, life: .2, size: .25, color: mixc(hex(color), WHITE, .5), shape: 'spark' }); kick(power * .4); break;
        case 'parry': glow(e.x, e.y, 2.4, [.85, .95, 1], .16); ring(e.x, e.y, .6, [.7, .95, 1], .3, 4); burst(e.x, e.y, 12, { speed: 8, life: .3, size: .4, color: [.9, 1, 1], shape: 'spark' }); screen(.3, '#dff6ff'); kick(.35); break;
        case 'shieldbreak': ring(e.x, e.y, 1.2, hex(color), .5, 3); burst(e.x, e.y, 24, { speed: 9, life: .6, size: .45, color: mixc(hex(color), WHITE, .4), shape: 'shard', gravity: 8 }); screen(.35, color); kick(.8); break;
        case 'ko': koBlast(e.x, e.y, angle, color); break;
        case 'star-ko': add.spawn({ x: e.x, y: e.y, z: -2, life: .9, size: 1.4, grow: -.9, color: [1, 1, .8], shape: 'star', spin: 6 }); glow(e.x, e.y, 2, [1, 1, .8], .4); break;
        case 'jump': dust(e.x - .25, e.y, 3, Math.PI, .8); dust(e.x + .25, e.y, 3, 0, .8); break;
        case 'airjump': ring(e.x, e.y - .1, .5, [.95, .95, 1], .3, 1.8); break;
        case 'land': dust(e.x - .3, e.y, 4, Math.PI * .95, .6, 2.6 * (.6 + power)); dust(e.x + .3, e.y, 4, Math.PI * .05, .6, 2.6 * (.6 + power)); break;
        case 'tech': glow(e.x, e.y + .6, 1.6, [1, 1, 1], .12); burst(e.x, e.y + .6, 8, { speed: 5, life: .25, size: .35, color: [1, 1, .9], shape: 'star', spin: 10 }); dust(e.x, e.y, 5, Math.PI / 2, 3); break;
        case 'clash': glow(e.x, e.y, 1.8, [1, .95, .7], .12); burst(e.x, e.y, 14, { speed: 9, life: .25, size: .35, color: [1, .9, .4], shape: 'spark' }); ring(e.x, e.y, .5, [1, 1, .8], .2, 3); kick(.45); break;
        case 'projectile': glow(e.x, e.y, .8, mixc(EFFECT_COLOR[e.effect ?? 'normal'], WHITE, .5), .08); break;
        case 'grab': glow(e.x, e.y, .7, [1, 1, 1], .08, .6); break;
        case 'throw': dust(e.x, e.y, 5, Math.PI / 2, 2.6); burst(e.x, e.y + .7, 6, { speed: 5, life: .2, size: .3, color: [1, .9, .6], shape: 'spark' }); kick(power * .5); break;
        case 'ledge': burst(e.x, e.y, 5, { speed: 2.5, life: .3, size: .22, color: [1, 1, .85], shape: 'spark' }); break;
        case 'respawn': burst(e.x, e.y, 18, { speed: 3, life: .9, size: .3, color: mixc(hex(color), WHITE, .5), shape: 'star', dir: Math.PI / 2, spread: 1.2, drag: 1, spin: 6 }); glow(e.x, e.y + 1, 3, hex(color), .5, .6); break;
        case 'counter': glow(e.x, e.y, 2, [.6, .8, 1], .14); ring(e.x, e.y, .8, [.7, .85, 1], .3, 2.5); kick(.5); screen(.2, '#cfe3ff'); break;
        case 'reflect': ring(e.x, e.y, .7, [.5, .95, 1], .25, 2); burst(e.x, e.y, 10, { speed: 6, life: .22, size: .3, color: [.6, 1, 1], shape: 'shard' }); break;
        case 'absorb': for (let i = 0; i < n(14); i++) { const a = rand() * 6.28; add.spawn({ x: e.x + Math.cos(a) * 1.2, y: e.y + Math.sin(a) * 1.2, vx: -Math.cos(a) * 4, vy: -Math.sin(a) * 4, life: .3, size: .3, color: [.6, 1, .7], shape: 'glow' }); } break;
        case 'armor': glow(e.x, e.y, 1.6, [1, .6, .2], .12); ring(e.x, e.y, .6, [1, .7, .3], .2, 2); break;
        case 'dodge': glow(e.x, e.y + .8, 1.4, [.8, .9, 1], .12, .4); break;
        case 'hazard-warn': ring(e.x, e.y, 1.5, [1, .3, .2], .6, 1); break;
        case 'taunt': burst(e.x, e.y + 1.2, 5, { speed: 1.5, life: .7, size: .3, color: [1, .95, .6], shape: 'star', dir: Math.PI / 2, spread: 2, drag: 1, spin: 4 }); break;
        case 'sudden-death': screen(.5, '#ffffff'); break;
        case 'swing': break;
      }
    },
    track(fighters) { for (const f of fighters) feed(f); },
    cue, setHdr(on) { add.gain = on ? 1.2 : 1; },
    projectiles(list, seconds) { emit.reduced = reduced; art.update(list, seconds, emit); },
    update(dt, reducedMotion) {
      reduced = reducedMotion; clock += dt;
      add.update(dt); norm.update(dt);
      for (const c of columns) if (c.mesh.visible) {
        c.t = Math.min(1, c.t + dt / c.life); c.mat.uniforms.uT.value = c.t;
        const e = 1 - (1 - Math.min(1, c.t * 4)) ** 3; c.mesh.scale.set(c.len * e, 1.2 + 2.2 * Math.min(1, c.t * 3) * (1 - c.t * .6), 1);
        if (c.t >= 1) c.mesh.visible = false;
      }
      trauma = Math.max(0, trauma - dt * 1.8); punch *= Math.exp(-dt * 7); flash = Math.max(0, flash - dt * 2.8);
      if (reduced) { trauma = 0; punch = 0; flash = 0; }
    },
    cameraKick() {
      const t = trauma * trauma, s = clock * 38;
      return { x: t * .45 * (Math.sin(s) * .6 + Math.sin(s * 2.3 + 1) * .4), y: t * .35 * (Math.sin(s * 1.7 + 2) * .6 + Math.sin(s * 3.1) * .4), zoom: punch, flash, flashColor };
    },
    dispose: scope.defer(once(() => { add.dispose(); norm.dispose(); art.dispose(); columnGeo.dispose(); for (const c of columns) { c.mat.dispose(); c.mesh.removeFromParent(); } tracked.clear(); if (scene.userData[FX_FEED] === feed) delete scene.userData[FX_FEED]; if (scene.userData[FX_CUE] === cue) delete scene.userData[FX_CUE]; })),
  };
}
