/* Cameras: per-viewport chase rig (intro swoop, drift framing, FOV/roll/shake, finish swing), the
 * overview "blimp" for a spare split cell, broadcast shots for spectators, and the Director that
 * decides who a watching TV follows. OWNER: render-world agent. */
import * as THREE from 'three';
import { angleDelta, approach, clamp, forwardX, forwardZ, headingOf, lerp, smoothstep, TAU } from '../sim/math';
import { loopPose, pointAt, queryTrack, sampleAt, type Track } from '../sim/track';
import { TOP_SPEED } from '../sim/stats';
import { kartLoop, loopFrame, type LoopFrame } from './loop';
import type { RaceView, RacerView } from '../sim/types';
import type { CameraCue, RacerPose, Viewport } from './types';

export type Shot = 'chase' | 'wide' | 'trackside';
/** A viewport may carry a broadcast shot chosen by the Director (spectator screens only). */
export type ShotViewport = Viewport & { shot?: Shot };
export type HeightAt = (x: number, z: number) => number;

const BASE_FOV = 68, WIDE_ASPECT = 1.95;
const NO_CUE: CameraCue = { shake: 0, fovKick: 0 };
const Y = new THREE.Vector3(0, 1, 0), T1 = new THREE.Vector3(), Q1 = new THREE.Quaternion(), LF = {} as LoopFrame, LC = {} as LoopFrame;
/** Fastest the lens may turn round a loop (rad/s). The ribbon frame peaks near 5 rad/s over the top at 100cc; staying locked to it
 * keeps the kart steady on screen while the world turns over (lagging swings the kart side-on). Reduced motion lags on purpose. */
const LOOP_TURN = 8, LOOP_TURN_CALM = 4;

/** Vertical FOV that keeps the horizontal field sane on very wide viewports (2-player stacked). */
export function fitFov(vfov: number, aspect: number) {
  if (aspect <= WIDE_ASPECT) return vfov;
  const h = 2 * Math.atan(Math.tan(vfov * Math.PI / 360) * WIDE_ASPECT);
  return 2 * Math.atan(Math.tan(h / 2) / aspect) * 180 / Math.PI;
}

export class CameraRig {
  private pos = new THREE.Vector3(); private look = new THREE.Vector3();
  private yaw = 0; private fov = BASE_FOV; private roll = 0; private shakeT = 0;
  private racerId: string | null | undefined = undefined; private shot: Shot | undefined; private kind: Viewport['kind'] | undefined;
  private fresh = true; private hadPose = false; private intro = false; private celebrate = 0; private orbit = 0; private idleT = 0;
  private zoom = 1; private minDist = 0; private kx = 0; private ky = 0; private kz = 0; private q = new THREE.Quaternion();
  private side = new THREE.Vector3(); private camPos = new THREE.Vector3(); private camLook = new THREE.Vector3();
  /** Loop-the-loop: smoothed / target camera up, and how far into loop framing we are (0–1). */
  private up = new THREE.Vector3(0, 1, 0); private upT = new THREE.Vector3(0, 1, 0); private loopW = 0;
  constructor(private readonly track: Track, private readonly heightAt: HeightAt) {}

  /** Force the next update to jump straight to its target (cuts, teleports, remounts). */
  cut() { this.fresh = true; }

  update(camera: THREE.PerspectiveCamera, vp: ShotViewport, poses: ReadonlyMap<string, RacerPose>, race: RaceView, cue: CameraCue | null, dt: number, time: number, reducedMotion: boolean, aspect: number) {
    const shot = vp.shot ?? 'chase';
    if (vp.racerId !== this.racerId || shot !== this.shot || vp.kind !== this.kind) { this.racerId = vp.racerId; this.shot = shot; this.kind = vp.kind; this.fresh = true; this.celebrate = 0; }
    const pose = vp.racerId ? poses.get(vp.racerId) : undefined;
    // The kart appearing (race created after the scene was ready) re-arms the intro swoop.
    if (!!pose !== this.hadPose) { this.hadPose = !!pose; this.fresh = true; }
    let fov = BASE_FOV; this.upT.copy(Y);
    // Wide cells (2-player stacked) narrow the vertical FOV, which would magnify the kart: pull back to compensate.
    this.zoom = clamp(Math.tan(BASE_FOV * Math.PI / 360) / Math.tan(fitFov(BASE_FOV, aspect) * Math.PI / 360), 1, 2); this.minDist = 0;
    if (vp.kind === 'overview') fov = this.overview(poses, race, time);
    else if (!pose) fov = this.establishing(time, dt);
    else if (shot === 'trackside') fov = this.trackside(pose);
    else fov = this.chase(pose, race, cue ?? NO_CUE, dt, reducedMotion, shot === 'wide');
    const snap = this.fresh; this.fresh = false;
    // Round a loop the target is smooth but spins fast (the ribbon curls tightly at the top): track it almost rigidly.
    const w = this.loopW, posRate = vp.kind === 'overview' ? 1.6 : shot === 'trackside' ? 60 : lerp(28, 80, w);
    if (snap || this.pos.distanceToSquared(this.camPos) > 45 * 45) { this.pos.copy(this.camPos); this.look.copy(this.camLook); this.fov = fov; this.up.copy(this.upT); }
    else {
      const a = approach(posRate, dt), b = approach(vp.kind === 'overview' ? 2.5 : lerp(24, 80, w), dt);
      this.pos.x += (this.camPos.x - this.pos.x) * a; this.pos.z += (this.camPos.z - this.pos.z) * a;
      this.pos.y += (this.camPos.y - this.pos.y) * approach(vp.kind === 'overview' ? 1.6 : lerp(7, 80, w), dt);   // height normally lags (bumps, jumps)
      this.look.lerp(this.camLook, b); this.fov += (fov - this.fov) * approach(4, dt);
      this.up.lerp(this.upT, approach(lerp(5, reducedMotion ? 12 : 60, w), dt)).normalize();   // reduced motion: a gentler, lagging roll
    }
    // Never let the chase lens creep up onto its own kart (hard stops, bumps from behind).
    const ox = this.pos.x - this.kx, oz = this.pos.z - this.kz, od = Math.hypot(ox, oz);
    if (od < this.minDist && od > 1e-3) { this.pos.x = this.kx + ox / od * this.minDist; this.pos.z = this.kz + oz / od * this.minDist; }
    // Keep the lens above the ground (hills behind a kart cresting a jump).
    const floor = this.heightAt(this.pos.x, this.pos.z) + 1.1;
    if (this.pos.y < floor && this.loopW < .01) this.pos.y = floor;
    camera.position.copy(this.pos);
    const shake = reducedMotion || !cue ? 0 : Math.min(cue.shake, 1.5);
    if (shake > 0.001) {
      this.shakeT += dt;
      const s = this.shakeT * 31;
      camera.position.x += (Math.sin(s * 1.3) + Math.sin(s * 2.9)) * shake * 0.09;
      camera.position.y += (Math.sin(s * 1.7 + 1) + Math.sin(s * 3.3)) * shake * 0.07;
    }
    camera.up.copy(this.up); camera.lookAt(this.look);
    // Round a loop, cap how fast the lens turns and orbit it about the kart so the kart keeps its place in frame.
    if (this.loopW > .01 && !snap) {
      T1.set(this.kx, this.ky, this.kz).sub(camera.position).applyQuaternion(Q1.copy(camera.quaternion).invert());
      camera.quaternion.copy(this.q.rotateTowards(camera.quaternion, (reducedMotion ? LOOP_TURN_CALM : LOOP_TURN) * dt));
      camera.position.set(this.kx, this.ky, this.kz).sub(T1.applyQuaternion(this.q));
    }
    this.q.copy(camera.quaternion);
    if (this.roll) camera.rotateZ(this.roll);
    camera.fov = fitFov(this.fov, aspect); camera.aspect = aspect; camera.updateProjectionMatrix();
  }

  private chase(pose: RacerPose, race: RaceView, cue: CameraCue, dt: number, reducedMotion: boolean, wide: boolean) {
    const k = pose.kart, v = pose.view, speed = Math.hypot(k.vx, k.vz), top = TOP_SPEED[race.speedClass] ?? 29;
    const frac = clamp(speed / top, 0, 1.3);
    // Yaw target: kart heading, swung toward the velocity while drifting so the kart shows its side.
    let target = k.heading;
    const hurt = k.spinT > 0 || k.tumbleT > 0 || k.respawnT > 0, lp = kartLoop(this.track, k);
    this.loopW += ((lp ? 1 : 0) - this.loopW) * approach(lp ? 6 : 3, dt);
    if (lp) target = headingOf(lp.loop.bx - lp.loop.ax, lp.loop.bz - lp.loop.az);   // the heading flips over the top: hold the footprint's
    else if (hurt) target = speed > 4 ? headingOf(k.vx, k.vz) : this.yaw;
    else if (k.drift !== 0 && speed > 4) target = k.heading + angleDelta(k.heading, headingOf(k.vx, k.vz)) * 0.6;
    if (this.fresh) this.yaw = target;
    else this.yaw += angleDelta(this.yaw, target) * approach(hurt ? 2 : k.drift ? 4.5 : 6.5, dt);
    const dist = ((wide ? 11 : 6.1) + frac * (wide ? 1.2 : 0.4)) * (1 + (this.zoom - 1) * 0.75), height = ((wide ? 4.8 : 2.5) + frac * 0.15) * (1 + (this.zoom - 1) * 0.5), ahead = wide ? 8 : 6;
    this.kx = k.x; this.ky = k.y + 0.6; this.kz = k.z; this.minDist = dist * 0.8;
    const fx = forwardX(this.yaw), fz = forwardZ(this.yaw);
    this.camPos.set(k.x - fx * dist, k.y + height, k.z - fz * dist);
    this.camLook.set(k.x + fx * ahead, k.y + 0.95, k.z + fz * ahead);
    // Countdown intro: swoop from in front of the kart round to the chase position.
    if (this.fresh) this.intro = race.phase === 'countdown' && race.time < -1.6;
    if (this.intro) {
      const e = smoothstep(-3.2, -0.5, race.time);
      if (e >= 1 || race.phase !== 'countdown') this.intro = false;
      else { this.orbitAround(k.x, k.y, k.z, this.yaw, Math.PI * (1 - e) * 1.0, lerp(4.6, dist, e), lerp(1.2, height, e), e); this.minDist = 0; }
    }
    // Finish: swing round to the front for the celebration, then drift slowly.
    if (v.finishTime !== null && !this.intro) {
      this.celebrate += dt; this.orbit = Math.PI * smoothstep(0.2, 2.6, this.celebrate) + Math.max(0, this.celebrate - 2.6) * 0.12;
      const e = smoothstep(0.2, 2.6, this.celebrate);
      this.orbitAround(k.x, k.y, k.z, this.yaw, this.orbit, lerp(dist, 5.4, e), lerp(height, 1.7, e), 1 - e); this.minDist = 0;
    } else this.celebrate = 0;
    if (lp) this.loopChase(k, lp, dist, height, ahead);
    // Keep the boom inside the walls (kart on the apron or angled at a barrier) so a wall never fills the foreground.
    const q = queryTrack(this.track, this.camPos.x, this.camPos.z, k.hint, k.y), lim = Math.abs(q.edgeLateral) - 0.6;
    if (!lp && q.edge === 'wall' && Math.abs(q.lateral) > lim && Math.abs(k.lateral) < lim) {
      const push = Math.sign(q.lateral) * lim - q.lateral;
      this.camPos.x += q.rx * push; this.camPos.z += q.rz * push;
      this.minDist = Math.min(this.minDist, Math.hypot(this.camPos.x - k.x, this.camPos.z - k.z));
    }
    const motion = reducedMotion ? 0 : 1;
    this.roll += ((-k.steer * 0.045 * Math.min(frac, 1) * (k.drift ? 1.4 : 1)) * motion - this.roll) * approach(5, dt);
    return BASE_FOV + (8 * Math.min(frac, 1.15) + (k.boostT > 0 ? 6 : 0) + cue.fovKick + 6 * this.loopW) * motion;
  }

  /** Loop framing: the boom trails `dist` metres back ALONG the ribbon and stands `height` off it on its normal, so it stays
   * inside the loop even where the path curls tight over the top (a rigid boom would poke out through the ribbon); it
   * looks at the kart, and camera up follows the ribbon normal so the world turns over. Before the entry the boom sits on
   * the road; over the last stretch it hands back to the ordinary chase boom, so both ends are seamless. */
  private loopChase(k: RacerPose['kart'], { loop, theta }: NonNullable<ReturnType<typeof kartLoop>>, dist: number, height: number, ahead: number) {
    const F = loopFrame(loop, theta, k.lateral, LF), lat = k.lateral * 0.6, s0 = loopPose(loop, 0, 0).dsdTheta;
    let b = theta - dist / F.dsdTheta; b = theta - 2 * dist / (F.dsdTheta + loopPose(loop, Math.max(0, b), 0).dsdTheta);
    if (b >= 0) { const C = loopFrame(loop, b, lat, LC); T1.set(C.x + C.ux * height, C.y + C.uy * height, C.z + C.uz * height); }
    else { const p = pointAt(this.track, loop.d0 + b * s0, lat); T1.set(p.x, p.y + height, p.z); }
    this.kx = F.x; this.ky = F.y + F.uy * 0.6; this.kz = F.z;
    const w = smoothstep(TAU - 0.9, TAU, theta), a = ahead * 0.5;
    this.camPos.lerp(T1, 1 - w);
    this.camLook.lerp(T1.set(F.x + F.fx * a + F.ux * 0.95, F.y + F.fy * a + F.uy * 0.95, F.z + F.fz * a + F.uz * 0.95), 1 - w);
    this.upT.set(F.ux, F.uy, F.uz); this.minDist = 0;
  }

  /** Orbit `angle` radians round the kart from directly behind; `mix` blends the look target from the kart toward the chase look point. */
  private orbitAround(x: number, y: number, z: number, yaw: number, angle: number, radius: number, height: number, mix: number) {
    const h = yaw + Math.PI + angle;
    this.camPos.set(x + forwardX(h) * radius, y + height, z + forwardZ(h) * radius);
    this.camLook.set(lerp(x, this.camLook.x, mix), lerp(y + 0.9, this.camLook.y, mix), lerp(z, this.camLook.z, mix));
  }

  /** Broadcast camera parked beside the course ahead of the kart; re-parks once the kart passes. */
  private trackside(pose: RacerPose) {
    const k = pose.kart, L = this.track.length;
    const passed = this.fresh || ((k.d - this.orbit + L * 1.5) % L) - L / 2 > 14;
    if (passed) {
      this.orbit = (k.d + 55) % L;                 // d of the camera stand
      const s = sampleAt(this.track, this.orbit), side = s.curvature > 0 ? 1 : -1;
      const p = pointAt(this.track, this.orbit, side * (s.halfWidth + (side > 0 ? s.runoffR : s.runoffL) + 2.5));
      this.side.set(p.x, Math.max(p.y, this.heightAt(p.x, p.z)) + 3.2, p.z); this.fresh = true;
    }
    this.camPos.copy(this.side); this.camLook.set(k.x, k.y + 0.8, k.z); this.roll = this.loopW = 0;
    const dist = Math.hypot(k.x - this.side.x, k.z - this.side.z);
    return clamp(2 * Math.atan(9 / Math.max(dist, 1)) * 180 / Math.PI, 16, 60);
  }

  /** High, slowly orbiting aerial view that follows the race leader. */
  private overview(poses: ReadonlyMap<string, RacerPose>, race: RaceView, time: number) {
    let lead: RacerPose | undefined;
    for (const r of race.racers) if (r.rank === 1) lead = poses.get(r.id);
    const s = sampleAt(this.track, lead ? lead.kart.d + 12 : (time * 8) % this.track.length);
    const x = lead ? lead.kart.x : s.x, y = lead ? lead.kart.y : s.y, z = lead ? lead.kart.z : s.z;
    const a = s.heading + Math.PI + Math.sin(time * 0.07) * 0.9;
    this.camPos.set(x + forwardX(a) * 34, y + 30, z + forwardZ(a) * 34);
    this.camLook.set(lerp(x, s.x, 0.5), y, lerp(z, s.z, 0.5)); this.roll = this.loopW = 0;
    return 52;
  }

  /** No racer yet (preparing): a slow crane shot behind the grid looking down the start straight. */
  private establishing(time: number, dt: number) {
    this.idleT += dt;
    const back = sampleAt(this.track, -52), sway = Math.sin(time * 0.25) * 6;
    const fwd = sampleAt(this.track, 12);
    this.camPos.set(back.x + back.rx * sway, back.y + 8.5 - Math.min(this.idleT, 6) * 0.35, back.z + back.rz * sway);
    this.camLook.set(fwd.x, fwd.y + 1.5, fwd.z); this.roll = this.loopW = 0;
    return 60;
  }
}

/** Chooses who a watching TV follows: the leader, held at least `hold` seconds per shot; cuts early
 * when the followed racer disconnects, and a few seconds after they finish (so the finish swing plays). */
export class Director {
  followId: string | null = null;
  shot: Shot = 'chase';
  private since = -Infinity; private finishSeen: number | null = null; private shots = 0;
  constructor(readonly hold = 6, readonly celebrate = 3.5) {}
  reset() { this.followId = null; this.since = -Infinity; this.finishSeen = null; this.shots = 0; this.shot = 'chase'; }
  update(race: RaceView | null, now: number): string | null {
    if (!race || race.racers.length === 0) return this.followId = null;
    let leader: RacerView | null = null, anyLeader = race.racers[0], current: RacerView | null = null, racing = 0;
    for (const r of race.racers) {
      if (r.id === this.followId) current = r;
      if (r.rank < anyLeader.rank) anyLeader = r;
      if (r.finishTime === null && r.connected !== false) { racing++; if (!leader || r.rank < leader.rank) leader = r; }
    }
    leader ??= anyLeader;
    if (current?.finishTime != null && this.finishSeen === null) this.finishSeen = now;
    // A disconnect cuts only when there is someone else to show (else every frame would re-cut to them).
    let cut = !current || (!current.connected && leader.id !== current.id);
    if (!cut && this.finishSeen !== null && racing > 0 && now - this.finishSeen >= this.celebrate) cut = true;
    if (!cut && now - this.since >= this.hold && leader.id !== this.followId && (!current || current.finishTime === null)) cut = true;
    if (cut) { this.followId = leader.id; this.since = now; this.finishSeen = leader.finishTime !== null ? now : null; this.shots++; this.shot = this.pickShot(race); }
    else if (now - this.since >= this.hold * 1.6 && this.finishSeen === null) { this.since = now; this.shots++; this.shot = this.pickShot(race); }
    return this.followId;
  }
  private pickShot(race: RaceView): Shot {
    if (race.phase === 'countdown') return 'chase';
    return (['chase', 'trackside', 'chase', 'wide'] as const)[this.shots % 4];
  }
}
