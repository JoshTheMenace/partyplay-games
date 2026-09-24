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
  track(fighters: readonly FighterView[]): void;
  update(dt: number, reduced: boolean): void;
  cameraKick(): CameraKick;
  readonly stats: { particles: number; projectiles: number };
  dispose(): void;
};
/** scene.userData key: FighterActors anywhere under the fx scene report their view each frame (deduplicated with track()). */
export const FX_FEED = 'skyClashFxFeed';
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

export function createFx(scene: Object3D, scope: ResourceScope): Fx {
  const add = new Particles(1400, true), norm = new Particles(700, false);
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
  const ring = (x: number, y: number, size: number, color: RGB, life = .25, grow = 2.6) => add.spawn({ x, y, z: .4, life, size, grow, color, shape: 'ring' });
  const glow = (x: number, y: number, size: number, color: RGB, life = .1, alpha = 1) => add.spawn({ x, y, z: .45, life, size, grow: .3, color, shape: 'glow', alpha });
  const dust = (x: number, y: number, count: number, dir: number, spread: number, speed = 2.2, size = .38) => burst(x, y + .08, count, { speed, life: .45, size, color: [.86, .84, .8], shape: 'puff', dir, spread, drag: 4, grow: 1.2, gravity: -.6, alpha: .75, z: .3 });
  const kick = (power: number) => { if (reduced) return; trauma = Math.min(1, trauma + power * .7); if (power > .6) punch = Math.max(punch, .05 + .08 * (power - .6) / .4); };
  const screen = (amount: number, color = '#ffffff') => { if (reduced) return; if (amount > flash) { flash = amount; flashColor = color; } };

  /** Hit sparks per effect, sized by power and damage, flung along the launch angle. */
  function hitSpark(effect: HitEffect, x: number, y: number, power: number, damage: number, angle: number) {
    const s = Math.min(2.2, .55 + damage / 16 + power * .6), c = EFFECT_COLOR[effect] ?? EFFECT_COLOR.normal, dir = angle * Math.PI / 180;
    glow(x, y, 1.3 * s, mixc(c, WHITE, .6), .11); ring(x, y, .45 * s, mixc(c, WHITE, .3), .22, 3);
    const sparks = (count: number, color: RGB, shape: Shape = 'spark', extra: Partial<Burst> = {}) =>
      burst(x, y, count, { speed: 7 * s, life: .26, size: .32 * s, color, shape, dir, spread: 2.4, drag: 7, ...extra });
    switch (effect) {
      case 'fire': sparks(6 + 8 * s, [1, .55, .15]); burst(x, y, 6 + 6 * s, { speed: 2, life: .5, size: .5 * s, color: [1, .35, .05], shape: 'glow', gravity: -3, grow: .6 }); break;
      case 'electric': sparks(10 + 10 * s, [.7, .9, 1], 'shard', { speed: 10 * s, life: .14 }); burst(x, y, 6, { speed: 3, life: .12, size: .7 * s, color: [1, 1, .7], shape: 'spark' }); break;
      case 'slash': for (let i = 0; i < 3; i++) add.spawn({ x, y, z: .45, life: .16, size: 1.4 * s, grow: .5, color: [.85, .95, 1], shape: 'shard', angle: dir + Math.PI / 2 + (i - 1) * .35 }); sparks(5 + 5 * s, [.8, .95, 1]); break;
      case 'ice': sparks(8 + 8 * s, [.75, .92, 1], 'shard', { gravity: 6 }); burst(x, y, 8, { speed: 1.5, life: .8, size: .12, color: [.95, .98, 1], shape: 'glow', gravity: 1.5 }); break;
      case 'darkness': burst(x, y, 6 + 6 * s, { speed: 2.5 * s, life: .55, size: .6 * s, color: [.12, .02, .18], shape: 'puff', grow: 1, alpha: .8 }); sparks(8 + 6 * s, [.7, .3, 1]); break;
      case 'water': burst(x, y, 10 + 8 * s, { speed: 5 * s, life: .5, size: .22 * s, color: [.35, .65, 1], shape: 'glow', gravity: 12, dir, spread: 2 }); ring(x, y, .6 * s, [.5, .8, 1], .35, 2); break;
      case 'star': burst(x, y, 6 + 6 * s, { speed: 5 * s, life: .45, size: .45 * s, color: [1, .9, .35], shape: 'star', spin: 10 }); break;
      case 'psychic': for (let i = 0; i < 3; i++) add.spawn({ x, y, z: .4, life: .3 + i * .08, size: .5 * s, grow: 3 + i, color: [1, .45, .95], shape: 'ring' }); sparks(4 + 4 * s, [1, .6, 1]); break;
      case 'magic': for (let i = 0; i < n(12 + 8 * s); i++) { const a = rand() * 6.28, sp = 4 * s * rand(); add.spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .5, size: .3 * s, color: hex(`hsl(${Math.floor(rand() * 360)}, 90%, 70%)`), shape: rand() > .5 ? 'star' : 'spark', drag: 4, spin: 6 }); } break;
      case 'coin': burst(x, y, 4 + 4 * s, { speed: 5, life: .7, size: .32 * s, color: [1, .78, .15], shape: 'coin', gravity: 14, dir: Math.PI / 2, spread: 1.6, spin: 20 }); sparks(4, [1, .95, .6]); break;
      case 'sleep': burst(x, y, 6 + 4 * s, { speed: 1.2, life: .9, size: .3 * s, color: [1, .72, .92], shape: 'bubble', gravity: -1.5, drag: 1 }); break;
      case 'grass': burst(x, y, 8 + 6 * s, { speed: 4 * s, life: .8, size: .28 * s, color: [.4, .78, .25], shape: 'leaf', gravity: 3, spin: 12, drag: 3 }); sparks(4, [.8, 1, .6]); break;
      default: sparks(8 + 10 * s, [1, .85, .35]); burst(x, y, 3 + 3 * s, { speed: 12 * s, life: .12, size: .5 * s, color: [1, 1, .85], shape: 'shard', dir, spread: 1.2 });
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
    glow(x, y, 6, mixc(col, WHITE, .5), .3);
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
      if (!reduced || last.t % 2 === 0) norm.spawn({ x: f.x, y: f.y + h, z: .1, life: strong ? .7 : .45, size: .45 + f.launch * 2, grow: 1.1, color: [.92, .92, .95], alpha: .55, shape: 'puff' });
      if (strong) add.spawn({ x: f.x + (rand() - .5) * .3, y: f.y + h + (rand() - .5) * .3, z: .2, life: .3, size: .5, color: mixc(EFFECT_COLOR[last.effect] ?? EFFECT_COLOR.normal, WHITE, .3), shape: 'spark', angle: Math.atan2(f.vy, f.vx) });
    } else last.t = 0;
    last.state = f.state; last.vy = f.vy; last.grounded = f.grounded;
  }
  scene.userData[FX_FEED] = feed as FxFeed;

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
    dispose: scope.defer(once(() => { add.dispose(); norm.dispose(); art.dispose(); columnGeo.dispose(); for (const c of columns) { c.mat.dispose(); c.mesh.removeFromParent(); } tracked.clear(); if (scene.userData[FX_FEED] === feed) delete scene.userData[FX_FEED]; })),
  };
}
