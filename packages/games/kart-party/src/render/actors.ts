/* Karts, drivers, item entities, boxes and effects (DESIGN §6 Actors). The world renderer calls
 * update() once per frame, beforeViewport() before drawing each viewport, and cues() for camera feedback.
 * Everything is pooled: steady-state frames allocate nothing. */
import * as THREE from 'three';
import { approach, clamp, lerp, smoothstep } from '../sim/math';
import { ITEM_IDS } from '../sim/items';
import { TOP_SPEED } from '../sim/stats';
import { moverPosition, queryTrack } from '../sim/track';
import type { RaceEvent } from '../sim/types';
import { KartActor, type KartFrame } from './actors/kart';
import { KartExtras, type FxEnv } from './actors/kart-fx';
import { ItemActors } from './actors/items';
import { BlobShadows, NameTag, SpeedLines, TagStack } from './actors/overlays';
import { Fx } from './actors/particles';
import { COLORS, CONFETTI, FX, rainbow, rnd, TIER } from './actors/presets';
import { Skids } from './actors/skids';
import type { Actors, ActorsFactory, CameraCue, FrameInput, RacerPose } from './types';

/** Particle capacity / effect budget / skid quads per quality tier. */
const CAPACITY = [5000, 3500, 1800], BUDGET = [1, .65, .35], SKIDS = [2400, 1600, 800];
const NITRO = new THREE.Color(0x3fb4ff).multiplyScalar(1.4), PAD = new THREE.Color(0xffb020).multiplyScalar(1.4), ROCKET = new THREE.Color(0xff4a10).multiplyScalar(1.5);

type Racer = { kart: KartActor; extras: KartExtras; tag: NameTag; cue: CameraCue; lines: number; confetti: number; trail: number; prevShock: number; kartId: string; camD: number; tagKey: number; tagA: number; lift: Map<string, number> };
const nearest = (a: Racer, b: Racer) => a.tagKey - b.tagKey, tagAt = new THREE.Vector3(), fwd = new THREE.Vector3();
/** View depth of `c` along the camera's forward axis `fwd` (set per viewport). */
const depth = (c: THREE.Vector3, cam: THREE.Vector3) => (c.x - cam.x) * fwd.x + (c.y - cam.y) * fwd.y + (c.z - cam.z) * fwd.z;

export const createActors: ActorsFactory = ({ track, scene, assets, quality }) => {
  const group = new THREE.Group(); group.name = 'kart-actors';
  const fx = new Fx(CAPACITY[quality]), skids = new Skids(SKIDS[quality]), items = new ItemActors(track, assets, fx);
  const shadows = new BlobShadows(64), lines = new SpeedLines(56);
  group.add(skids.mesh, shadows.mesh, items.group, fx.group, lines.mesh);
  scene.add(group);
  const racers = new Map<string, Racer>();
  const kartFrame: KartFrame = { dt: 0, time: 0, track, reducedMotion: false };
  const env: FxEnv = { fx, dt: 0, time: 0, theme: track.def.theme, reducedMotion: false };
  const shadowAlpha = quality === 2 ? 1 : .7;
  let viewportCount = 1, reduced = false, time = 0, frameDt = 0;
  const tagOrder: Racer[] = [], stack = new TagStack();
  const idle: CameraCue = { shake: 0, fovKick: 0 };
  const shake = (id: string | undefined, amount: number) => { const r = id ? racers.get(id) : undefined; if (r) r.cue.shake = Math.min(1, Math.max(r.cue.shake, amount)); };
  const kick = (id: string, deg: number) => { const r = racers.get(id); if (r) r.cue.fovKick = Math.max(r.cue.fovKick, deg); };
  const itemShadow = (x: number, y: number, z: number, s: number, h: number) => shadows.add(x, y, z, s, s, 0, h, undefined, shadowAlpha);
  items.onBlast = (x, _y, z, radius) => { for (const [id, r] of racers) { const d = Math.hypot(r.kart.root.position.x - x, r.kart.root.position.z - z); if (d < radius * 3.5) shake(id, .9 * (1 - d / (radius * 3.5))); } };

  function sync(frame: FrameInput) {
    for (const rv of frame.race.racers) {
      const existing = racers.get(rv.id);
      if (existing && existing.kartId === `${rv.kart}:${rv.character}`) continue;
      if (existing) remove(rv.id);
      const kart = new KartActor(assets, rv.id, rv.kart, rv.character, quality < 2);
      group.add(kart.root);
      const tag = new NameTag(); group.add(tag.sprite);
      racers.set(rv.id, { kart, extras: new KartExtras(kart, assets, group), tag, cue: { shake: 0, fovKick: 0 }, lines: 0, confetti: 0, trail: 0, prevShock: 0, kartId: `${rv.kart}:${rv.character}`, camD: 0, tagKey: 0, tagA: 0, lift: new Map() });
    }
    if (racers.size > frame.race.racers.length) for (const id of racers.keys()) if (!frame.race.racers.some(r => r.id === id)) remove(id);
  }
  function remove(id: string) {
    const r = racers.get(id); if (!r) return;
    r.kart.dispose(); r.extras.dispose(); r.tag.dispose(); skids.forget(`${id}:`); racers.delete(id);
  }

  function onEvent(ev: RaceEvent, frame: FrameInput) {
    const r = racers.get(ev.racer), K = r?.kart, pose = frame.poses.get(ev.racer);
    const at = K?.center;
    switch (ev.type) {
      case 'hit': if (K && at) {
        shake(ev.racer, .85); K.kick(-2);
        for (let i = fx.burst(30); i > 0; i--) { const a = Math.random() * Math.PI * 2, u = rnd(-.3, 1); fx.emit(FX.burst, at.x, at.y + .4, at.z, Math.cos(a) * rnd(4, 10), u * 8 + 2, Math.sin(a) * rnd(4, 10), COLORS.spark, 1.3, 1, K.groundY); }
        for (let i = fx.burst(12); i > 0; i--) fx.emit(FX.sparkle, at.x + rnd(-1, 1), at.y + rnd(0, 1.5), at.z + rnd(-1, 1), rnd(-3, 3), rnd(2, 5), rnd(-3, 3), COLORS.gold, rnd(1, 1.8));
        fx.emit(FX.ring, at.x, at.y + .5, at.z, 0, 0, 0, COLORS.hot, 1.4);
      } break;
      case 'bump': {
        const o = ev.other ? racers.get(ev.other)?.kart : undefined;
        if (K && at) {
          const x = o ? (at.x + o.center.x) / 2 : at.x, y = o ? (at.y + o.center.y) / 2 : at.y, z = o ? (at.z + o.center.z) / 2 : at.z;
          for (let i = fx.burst(14); i > 0; i--) fx.emit(FX.impact, x, y, z, rnd(-6, 6) + (pose?.kart.vx ?? 0) * .5, rnd(1, 5), rnd(-6, 6) + (pose?.kart.vz ?? 0) * .5, COLORS.spark, 1.2, 1, K.groundY);
          fx.emit(FX.flare, x, y, z, 0, 0, 0, COLORS.hot, 1.2);
          shake(ev.racer, .3); shake(ev.other, .3); K.kick(-1.2); o?.kick(-1.2);
        }
      } break;
      case 'wall': if (K && pose) {
        const side = pose.kart.lateral >= 0 ? 1 : -1, x = ev.x ?? K.center.x + K.right.x * side * 1.1, z = ev.z ?? K.center.z + K.right.z * side * 1.1;
        for (let i = fx.burst(22); i > 0; i--) fx.emit(FX.impact, x, K.center.y, z, pose.kart.vx * .6 + rnd(-3, 3), rnd(1, 5), pose.kart.vz * .6 + rnd(-3, 3), COLORS.spark, 1.2, 1, K.groundY);
        for (let i = fx.burst(5); i > 0; i--) fx.emit(FX.smoke, x, K.center.y, z, rnd(-1, 1), 1, rnd(-1, 1), COLORS.smoke);
        shake(ev.racer, .38); K.kick(-1);
      } break;
      case 'mini-turbo': if (r && K) {
        const col = TIER[clamp(ev.value ?? 1, 1, 3)]; r.extras.tint(col, .5 + (ev.value ?? 1) * .3);
        for (let wi = 2; wi < 4; wi++) {
          const c = K.contact[wi];
          for (let i = fx.burst(18 + (ev.value ?? 1) * 6); i > 0; i--) fx.emit(FX.burst, c.x, c.y + .1, c.z, -K.forward.x * rnd(2, 7) + rnd(-3, 3), rnd(2, 6), -K.forward.z * rnd(2, 7) + rnd(-3, 3), col, 1.2, 1, c.y);
          fx.emit(FX.ring, c.x, c.y + .2, c.z, 0, 0, 0, col, .9);
        }
        kick(ev.racer, 1.5 + (ev.value ?? 1));
      } break;
      case 'boost-pad': if (r && K) { r.extras.tint(PAD, 1); for (let i = fx.burst(16); i > 0; i--) fx.emit(FX.sparkle, K.center.x + rnd(-1, 1), K.center.y + rnd(-.3, .8), K.center.z + rnd(-1, 1), pose ? pose.kart.vx * .3 : 0, rnd(1, 3), pose ? pose.kart.vz * .3 : 0, COLORS.gold, 1.2); } break;
      case 'rocket-start': if (r && K) {
        r.extras.tint(ROCKET, 1.3); kick(ev.racer, 5);
        for (const e of K.exhaust) for (let i = fx.burst(24); i > 0; i--) fx.emit(FX.fire, e.x, e.y, e.z, -K.forward.x * rnd(4, 9) + rnd(-2, 2), rnd(0, 2), -K.forward.z * rnd(4, 9) + rnd(-2, 2), COLORS.fire, .45);
      } break;
      case 'stall': if (K) for (const e of K.exhaust) for (let i = fx.burst(16); i > 0; i--) fx.emit(FX.smoke, e.x, e.y, e.z, -K.forward.x * rnd(1, 3), rnd(1, 3), -K.forward.z * rnd(1, 3), COLORS.darkSmoke, 1.6); break;
      case 'trick': if (K && at) { K.trick(); for (let i = fx.burst(18); i > 0; i--) fx.emit(FX.sparkle, at.x + rnd(-1.2, 1.2), at.y + rnd(0, 1.5), at.z + rnd(-1.2, 1.2), pose ? pose.kart.vx * .8 : 0, rnd(0, 2), pose ? pose.kart.vz * .8 : 0, rainbow(Math.random(), .65, 2), rnd(1, 1.6)); } break;
      case 'slipstream': if (K && at && pose) for (let i = fx.burst(30); i > 0; i--) { const a = Math.random() * Math.PI * 2; fx.emit(FX.wind, at.x + Math.cos(a) * 1.4, at.y + .3 + Math.sin(a), at.z + Math.sin(a) * 1.4, pose.kart.vx * .2, 0, pose.kart.vz * .2, COLORS.wind, 1.4); } break;
      case 'pickup': if (K) K.kick(1.2); break;
      case 'item': if (r && K && at) {
        const item = ITEM_IDS[ev.value ?? -1];
        if (item === 'nitro' || item === 'triple-nitro') r.extras.tint(NITRO, 1.4);
        if (item === 'super') for (let i = fx.burst(40); i > 0; i--) { const a = Math.random() * Math.PI * 2; fx.emit(FX.sparkle, at.x, at.y + .5, at.z, Math.cos(a) * rnd(3, 7), rnd(1, 6), Math.sin(a) * rnd(3, 7), rainbow(Math.random(), .65, 2.2), rnd(1.2, 2)); }
        if (item === 'shield') fx.emit(FX.ring, at.x, at.y + .4, at.z, 0, 0, 0, COLORS.shield, 1.6);
        if (item === 'ink') for (let i = fx.burst(26); i > 0; i--) fx.emit(FX.ink, at.x, at.y + 1.2, at.z, rnd(-3, 3), rnd(5, 10), rnd(-3, 3), COLORS.ink, 1.6, 1.2, K.groundY);
      } break;
      case 'shield-pop': if (K && at) {
        for (let i = fx.burst(34); i > 0; i--) { const a = Math.random() * Math.PI * 2, u = rnd(-1, 1), sp = rnd(5, 9), h = Math.sqrt(1 - u * u); fx.emit(FX.shard, at.x + Math.cos(a) * h * 1.7, at.y + .3 + u * 1.7, at.z + Math.sin(a) * h * 1.7, Math.cos(a) * h * sp, u * sp + 2, Math.sin(a) * h * sp, COLORS.shield, .9, .8, K.groundY); }
        fx.emit(FX.ring, at.x, at.y + .3, at.z, 0, 0, 0, COLORS.shield, 1.8); shake(ev.racer, .35);
      } break;
      case 'explode': if (ev.x !== undefined && ev.z !== undefined) items.explode(ev.x, queryTrack(track, ev.x, ev.z).ground ?? K?.groundY ?? 0, ev.z, ev.value ?? 7); break;
      case 'finish': if (r) r.confetti = 2.6; break;
      // Rainbow Road: star ring (flash + rainbow burst), spring (starburst + launch trail), pinball bumper.
      case 'ring': if (r && K && at) {
        r.extras.tint(rainbow(Math.random(), .6, 1.6), 1.1); kick(ev.racer, 4); shake(ev.racer, .2);
        fx.emit(FX.flash, at.x, at.y + .6, at.z, 0, 0, 0, COLORS.hot, 2.4); fx.emit(FX.bigRing, at.x, at.y + .6, at.z, 0, 0, 0, COLORS.gold, .7);
        const vx = pose?.kart.vx ?? 0, vz = pose?.kart.vz ?? 0, n = fx.burst(40);
        for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; fx.emit(FX.sparkle, at.x, at.y + .6, at.z, vx * .7 + Math.cos(a) * rnd(4, 8), Math.sin(a) * rnd(3, 6) + 1, vz * .7 + Math.sin(a) * rnd(4, 8), rainbow(i / n, .62, 2.2), rnd(1.1, 1.8)); }
      } break;
      case 'spring': if (r && K && at) {
        r.trail = 1.4; kick(ev.racer, 3); shake(ev.racer, .35); K.kick(2);
        fx.emit(FX.flash, at.x, K.groundY + .3, at.z, 0, 0, 0, COLORS.spring, 2.6); fx.emit(FX.bigRing, at.x, K.groundY + .2, at.z, 0, 0, 0, COLORS.spring, .6);
        const n = fx.burst(30);
        for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; fx.emit(FX.sparkle, at.x, K.groundY + .3, at.z, Math.cos(a) * rnd(6, 11), rnd(1, 4), Math.sin(a) * rnd(6, 11), i % 2 ? COLORS.gold : COLORS.pinball, rnd(1.2, 2)); }
      } break;
      case 'bumper': if (K && at) {
        // Contact point on the bumper's rim (value = mover index; placed exactly as the physics does).
        const m = track.movers[ev.value ?? -1] ?? track.movers[0]; if (!m) break;
        const b = moverPosition(track, m, frame.moverTime ?? frame.race.time), nx = at.x - b.x, nz = at.z - b.z, nl = Math.hypot(nx, nz) || 1, x = b.x + nx / nl * m.radius, y = b.y + m.radius * .6, z = b.z + nz / nl * m.radius;
        fx.emit(FX.flash, x, y, z, 0, 0, 0, COLORS.pinball, 3); fx.emit(FX.bigRing, x, y, z, 0, 0, 0, COLORS.pinball, .6); fx.emit(FX.ring, x, y, z, 0, 0, 0, COLORS.gold, 1.6);
        for (let i = fx.burst(26); i > 0; i--) fx.emit(FX.impact, x, y, z, nx / nl * rnd(4, 10) + rnd(-4, 4), rnd(1, 6), nz / nl * rnd(4, 10) + rnd(-4, 4), i % 2 ? COLORS.pinball : COLORS.spark, 1.3, 1, K.groundY);
        shake(ev.racer, .55); K.kick(-1.6);
      } break;
      case 'honk': if (K && at) { K.kick(1.8); fx.emit(FX.ring, at.x, at.y + 1.2, at.z, 0, 0, 0, COLORS.white, .8); } break;
      default: break;
    }
  }

  /** Loop entry: FOV punch, a rainbow ring round the kart and a sparkle burst in the kart's frame. */
  function enterLoop(r: Racer) {
    const K = r.kart, at = K.center; r.cue.fovKick = Math.max(r.cue.fovKick, 6); shake(K.id, .25); r.extras.tint(rainbow(Math.random(), .6, 1.6), 1.2);
    fx.emit(FX.bigRing, at.x, at.y, at.z, 0, 0, 0, COLORS.gold, .7);
    const n = fx.burst(36);
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, c = Math.cos(a) * rnd(3, 6), s = Math.sin(a) * rnd(3, 6); fx.emit(FX.sparkle, at.x, at.y, at.z, K.right.x * c + K.up.x * s, K.right.y * c + K.up.y * s, K.right.z * c + K.up.z * s, rainbow(i / n, .62, 2.2), rnd(1.1, 1.7)); }
  }

  function strike(K: KartActor) {
    // Lightning bolt from the sky: a jagged chain of glow particles, flash and sparks at the kart.
    const top = 26; let x = K.center.x + rnd(-3, 3), z = K.center.z + rnd(-3, 3);
    const steps = 16;
    for (let s = 0; s <= steps; s++) {
      const u = s / steps, tx = lerp(x, K.center.x, u), tz = lerp(z, K.center.z, u), y = K.center.y + top * (1 - u);
      const jx = s && s < steps ? rnd(-.9, .9) : 0, jz = s && s < steps ? rnd(-.9, .9) : 0;
      for (let k = 0; k < 3; k++) fx.emit(FX.bolt, tx + jx + (k - 1) * .05, y - k * top / steps / 3, tz + jz, 0, 0, 0, k === 1 ? COLORS.zapCore : COLORS.zap, 1);
      x = lerp(x, tx + jx, .5); z = lerp(z, tz + jz, .5);
    }
    fx.emit(FX.flare, K.center.x, K.center.y + .5, K.center.z, 0, 0, 0, COLORS.zapCore, 4);
    fx.emit(FX.ring, K.center.x, K.groundY + .2, K.center.z, 0, 0, 0, COLORS.zap, 2);
    for (let i = fx.burst(24); i > 0; i--) fx.emit(FX.burst, K.center.x, K.center.y, K.center.z, rnd(-8, 8), rnd(2, 9), rnd(-8, 8), COLORS.zap, 1, 1, K.groundY);
  }

  const actors: Actors = {
    group,
    update(frame) {
      const dt = frameDt = frame.dt; time = frame.time; reduced = frame.reducedMotion; viewportCount = frame.viewports.length;
      fx.budget = BUDGET[frame.quality];
      kartFrame.dt = env.dt = dt; kartFrame.time = env.time = time; kartFrame.reducedMotion = env.reducedMotion = reduced;
      sync(frame);
      const top = TOP_SPEED[frame.race.speedClass] ?? 29;
      shadows.begin();
      for (const [id, r] of racers) {
        const pose: RacerPose | undefined = frame.poses.get(id);
        r.kart.root.visible = !!pose;
        if (!pose) continue;
        const K = r.kart, k = pose.kart;
        K.update(pose, kartFrame);
        if (K.boostStarted) r.cue.fovKick = Math.max(r.cue.fovKick, 2 + K.boostStarted * 4);   // transient punch; the camera adds the sustained boost FOV
        if (K.landed > 5) r.cue.shake = Math.max(r.cue.shake, clamp((K.landed - 5) / 14, 0, .45));
        if (k.shockT > 0 && r.prevShock <= 0) { strike(K); shake(id, .6); }
        if (K.loopEntered) enterLoop(r);
        r.prevShock = k.shockT;
        // Skids: rear wheels while drifting or spinning on a solid surface.
        const marking = k.grounded && !K.looping && !K.respawning && K.airHeight < .2 && (k.drift !== 0 || k.spinT > 0 || (k.stallT <= 0 && k.boostT > 0 && K.speed < 10)) && (k.surface === 'road' || k.surface === 'boost' || k.surface === 'ice');
        for (let wi = 2; wi < 4; wi++) { const c = K.contact[wi]; skids.mark(`${id}:${wi}`, marking, c.x, c.y, c.z, K.right.x, K.right.z, time); }
        const speedRatio = K.speed / top;
        // Speed lines only near/above top speed; a boost strengthens them but never shows them on its own.
        r.lines = lerp(r.lines, K.looping ? .9 : smoothstep(.88, 1.35, speedRatio) * (k.boostT > 0 ? .85 : .45), approach(4, dt));
        // Loop: rainbow streaks peel off the rear wheels all the way round.
        if (K.looping) for (let wi = 2; wi < 4; wi++) { const c = K.contact[wi]; for (let i = fx.n(60, dt); i > 0; i--) fx.emit(FX.trail, c.x + rnd(-.2, .2), c.y + rnd(-.2, .2), c.z + rnd(-.2, .2), k.vx * .15, k.vy * .15, k.vz * .15, rainbow(time * .9 + wi * .5 + rnd(0, .1), .55, 1.5), rnd(1, 1.5), 2.2); }
        // Blob shadow (hidden while the drone carries the kart high up, and in a loop where there is no ground below).
        const sh = K.respawning ? K.root.position.y - K.groundY : K.airHeight;
        if ((!K.respawning || sh < 6) && !K.looping) shadows.add(K.root.position.x, K.respawning ? K.root.position.y - sh : K.groundY, K.root.position.z, 2.3, 3.2, k.heading, sh, K.airHeight < .5 ? K.groundNormal : undefined, shadowAlpha);
        if (r.confetti > 0) {
          r.confetti -= dt;
          const n = fx.n(r.confetti > 2.3 ? 900 : 70, dt);
          for (let i = 0; i < n; i++) fx.emit(FX.confetti, K.center.x + rnd(-3, 3), K.center.y + rnd(2.5, 6), K.center.z + rnd(-3, 3), k.vx * .6 + rnd(-3, 3), rnd(-1, 4), k.vz * .6 + rnd(-3, 3), CONFETTI[(Math.random() * CONFETTI.length) | 0], rnd(.8, 1.4));
        }
        if (r.trail > 0) {
          r.trail -= dt;
          if (K.airHeight > .3) for (let i = fx.n(110, dt); i > 0; i--) fx.emit(FX.trail, K.center.x + rnd(-.5, .5), K.center.y + rnd(-.2, .4), K.center.z + rnd(-.5, .5), rnd(-.6, .6), rnd(-.4, .4), rnd(-.6, .6), rainbow(time * .8 + rnd(0, .15), .55, 1.3), rnd(1.1, 1.7), 1.6);
        }
        r.tag.set(pose.view.name, pose.view.color, pose.view.rank);
      }
      for (const ev of frame.newEvents) onEvent(ev, frame);
      for (const [id, r] of racers) { const pose = frame.poses.get(id); if (pose) r.extras.update(pose, env); }
      items.update(frame.race, time, dt);
      items.forEachShadow(itemShadow);
      shadows.end();
      fx.update(dt); skids.update(time);
      for (const r of racers.values()) { r.cue.shake *= Math.exp(-5 * dt); r.cue.fovKick *= Math.exp(-3.5 * dt); }
    },
    beforeViewport(racerId, camera) {
      camera.updateMatrixWorld();
      const own = racerId ? racers.get(racerId) : undefined;
      lines.set(own && !reduced ? own.lines : 0, camera.aspect, time);
      const split = viewportCount > 1, cam = camera.position, oc = own?.kart.center;
      // Rivals more than ~1.4–2.8 m nearer the lens than our kart (by view depth) dither out so none fills a
      // corner or covers it; alongside our kart they stay solid. With no kart followed: anything within 4 m.
      camera.getWorldDirection(fwd);
      const lo = oc ? depth(oc, cam) - 2.8 : 4;
      for (const [id, r] of racers) {
        const c = r.kart.center, d = Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z), f = id === racerId ? 1 : smoothstep(lo, lo + 1.4, depth(c, cam));
        r.kart.fade(f); r.kart.pivot.visible = !r.kart.hidden && f > .03;
        r.camD = d; r.tagA = split && id !== racerId && r.kart.root.visible ? (1 - smoothstep(70, 120, d)) * smoothstep(3, 6, d) * f : 0;
        if (r.tagA > .02) tagOrder.push(r); else r.tag.place(0, 0, 0, 0);
      }
      // Tags that would cover a nearer one stack above it (up to 3 rows, eased per view) or hide.
      if (!tagOrder.length) return;
      const key = racerId ?? '';
      for (const r of tagOrder) r.tagKey = r.camD + (r.lift.get(key) ?? 0) * 5;   // hysteresis: a stacked tag must get 5 m nearer to drop back
      tagOrder.sort(nearest); stack.n = 0;
      const P = camera.projectionMatrix.elements;
      for (const r of tagOrder) { tagAt.copy(r.kart.root.position).addScaledVector(r.kart.normal, 2.35).project(camera); stack.add(tagAt.x, tagAt.z < 1 ? tagAt.y : 99, r.tag.width * .17 * P[0]); }
      stack.solve(.8 * .085 * P[5]);
      for (let i = 0; i < tagOrder.length; i++) {
        const r = tagOrder[i], row = stack.row[i], cur = r.lift.get(key) ?? Math.max(row, 0), p = tagAt.copy(r.kart.root.position).addScaledVector(r.kart.normal, 2.35);
        const lift = row < 0 ? cur : cur + (row - cur) * approach(14, frameDt);
        r.lift.set(key, lift); r.tag.place(p.x, p.y, p.z, row < 0 ? 0 : r.tagA, lift * .8);
      }
      tagOrder.length = 0;
    },
    cues(racerId) {
      const r = racers.get(racerId);
      if (!r || reduced) return idle;
      return r.cue;
    },
    dispose() {
      for (const id of racers.keys()) remove(id);
      items.dispose(); fx.dispose(); skids.dispose(); shadows.dispose(); lines.dispose();
      group.removeFromParent();
    },
  };
  return actors;
};
