/** First-person camera effects and the cinematic spectator camera for the watching display. */
import type { PerspectiveCamera } from 'three';
import { isOpaque } from '../../shared/blocks';
import type { CellReader } from '../../shared/chunk';
import { raycastBlocks } from '../../shared/raycast';
import { damp } from './interp';

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export type ViewState = {
  walked: number; onGround: boolean; sprinting: boolean; flying: boolean; underwater: boolean; dead: boolean; sleeping: boolean; baseFov: number;
  /** 0..1 portal charge: the view wobbles and the field of view stretches as it builds (not under reduced motion). */
  portal: number;
};

/** View bob, sprint FOV kick, hurt tilt, portal wobble, death and sleep camera. Allocation-free. */
export class ViewEffects {
  bobPhase = 0;
  bobAmount = 0;
  private fov = 75;
  private hurtT = 1;
  private deathT = 0;
  private wobble = 0;
  private time = 0;
  private readonly still = reducedMotion();

  hurt() { if (!this.still) this.hurtT = 0; }

  /** Place the camera at the eye with yaw/pitch plus effects. */
  apply(camera: PerspectiveCamera, x: number, eyeY: number, z: number, feetY: number, yaw: number, pitch: number, s: ViewState, dt: number) {
    this.bobPhase += s.walked * Math.PI / 1.35;
    this.bobAmount += ((s.onGround && s.walked > 0 && !this.still ? 1 : 0) - this.bobAmount) * damp(8, dt);
    this.hurtT = Math.min(1, this.hurtT + dt / 0.5);
    this.deathT = s.dead ? Math.min(1, this.deathT + dt / 0.8) : 0;
    this.time += dt;
    this.wobble += ((this.still ? 0 : s.portal) - this.wobble) * damp(4, dt);
    const wobble = this.wobble * this.wobble, sway = Math.sin(this.time * 2.3) * 0.07 * wobble;
    const bob = this.still ? 0 : this.bobAmount, bx = Math.sin(this.bobPhase) * 0.045 * bob, by = -Math.abs(Math.cos(this.bobPhase)) * 0.07 * bob;
    const cos = Math.cos(yaw), sin = Math.sin(yaw), death = this.deathT * this.deathT;
    const y = s.sleeping ? feetY + 0.35 : eyeY + (feetY + 0.25 - eyeY) * death;
    camera.position.set(x + cos * bx, y + by, z - sin * bx);
    const hurtRoll = this.hurtT < 1 ? Math.sin(this.hurtT * Math.PI) * 0.22 * (1 - this.hurtT) : 0;
    camera.rotation.set(s.sleeping ? 0.25 : pitch + Math.abs(Math.cos(this.bobPhase)) * 0.008 * bob + Math.cos(this.time * 1.7) * 0.03 * wobble, yaw,
      Math.sin(this.bobPhase) * 0.006 * bob + hurtRoll + death * 0.6 + sway, 'YXZ');
    const target = this.still ? s.baseFov : s.baseFov * (s.sprinting ? (s.flying ? 1.2 : 1.12) : 1) * (s.underwater ? 0.92 : 1) * (1 + 0.16 * wobble + Math.sin(this.time * 3.1) * 0.03 * wobble);
    this.fov += (target - this.fov) * damp(9, dt);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
}

export type Subject = { key: string; x: number; y: number; z: number; yaw: number };
type Shot = 'shoulder' | 'orbit' | 'front' | 'high';
const SHOTS: readonly Shot[] = ['shoulder', 'orbit', 'shoulder', 'front', 'high'];
const SHOT_SECONDS = 20, CUT_DISTANCE = 48;

/**
 * Pure camera placement for a spectator shot around a subject's head (eye height 1.6). Writes [camX, camY, camZ,
 * lookX, lookY, lookZ] into `out`, pulled in towards the head when blocks would hide the subject.
 */
export function shotPose(shot: Shot, s: Subject, time: number, getCell: CellReader, out: number[]) {
  const hx = s.x, hy = s.y + 1.6, hz = s.z, fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
  let cx: number, cy: number, cz: number, lx = hx, ly = hy - 0.2, lz = hz;
  if (shot === 'shoulder') { cx = hx - fx * 4 + rx * 0.9; cy = hy + 0.8; cz = hz - fz * 4 + rz * 0.9; lx = hx + fx * 4; ly = hy - 0.3; lz = hz + fz * 4; }
  else if (shot === 'front') { cx = hx + fx * 3.6 + rx * 0.6; cy = hy + 0.2; cz = hz + fz * 3.6 + rz * 0.6; }
  else if (shot === 'high') { cx = hx - fx * 6; cy = hy + 7; cz = hz - fz * 6; }
  else { const a = time * 0.1; cx = hx + Math.cos(a) * 7; cy = hy + 2.5; cz = hz + Math.sin(a) * 7; }
  // Occlusion: keep the camera on the near side of any opaque block between it and the head.
  const dx = cx - hx, dy = cy - hy, dz = cz - hz, length = Math.hypot(dx, dy, dz);
  const hit = raycastBlocks(getCell, [hx, hy, hz], [dx, dy, dz], length, isOpaque);
  const k = hit ? Math.max(0.8, hit.distance - 0.35) / length : 1;
  out[0] = hx + dx * k; out[1] = hy + dy * k; out[2] = hz + dz * k; out[3] = lx; out[4] = ly; out[5] = lz;
  return out;
}

/**
 * Display camera: follows each player for ~20 s with varied third-person shots (easing between them, cutting
 * across long distances), or drifts in a slow flyover when nobody is playing.
 */
export class Spectator {
  private focus: string | null = null;
  private shotIndex = 0;
  private shotTime = 0;
  private time = 0;
  private started = false;
  private readonly pos = [0, 0, 0];
  private readonly look = [0, 0, 0];
  private readonly want = [0, 0, 0, 0, 0, 0];
  private flyAngle = 0;

  constructor(private readonly centre: { x: number; z: number }) {}

  update(camera: PerspectiveCamera, subjects: readonly Subject[], getCell: CellReader, groundY: (x: number, z: number) => number, dt: number) {
    this.time += dt;
    this.shotTime += dt;
    let subject = subjects.find(s => s.key === this.focus);
    if (!subject || this.shotTime > SHOT_SECONDS) {
      const index = subject ? subjects.indexOf(subject) : -1;
      subject = subjects.length ? subjects[(index + 1) % subjects.length] : undefined;
      if (subject && subject.key !== this.focus || this.shotTime > SHOT_SECONDS) this.shotIndex++;
      this.focus = subject?.key ?? null;
      this.shotTime = 0;
    }
    const want = this.want;
    if (subject) {
      this.centre.x = subject.x;
      this.centre.z = subject.z;
      shotPose(SHOTS[this.shotIndex % SHOTS.length]!, subject, this.time, getCell, want);
    } else {
      // Flyover: a slow wide circle above the terrain, looking ahead and down.
      this.flyAngle += dt * 0.025;
      const r = 42, x = this.centre.x + Math.cos(this.flyAngle) * r, z = this.centre.z + Math.sin(this.flyAngle) * r;
      const ax = this.centre.x + Math.cos(this.flyAngle + 0.5) * r, az = this.centre.z + Math.sin(this.flyAngle + 0.5) * r;
      want[0] = x; want[1] = Math.max(groundY(x, z), 62) + 26; want[2] = z;
      want[3] = ax; want[4] = Math.max(groundY(ax, az), 62) + 6; want[5] = az;
    }
    const far = Math.hypot(want[0]! - this.pos[0]!, want[1]! - this.pos[1]!, want[2]! - this.pos[2]!) > CUT_DISTANCE;
    const k = !this.started || far ? 1 : damp(subject ? 2.2 : 1.2, dt), kl = !this.started || far ? 1 : damp(subject ? 3.5 : 1.2, dt);
    for (let i = 0; i < 3; i++) {
      this.pos[i]! += (want[i]! - this.pos[i]!) * k;
      this.look[i]! += (want[i + 3]! - this.look[i]!) * kl;
    }
    this.started = true;
    camera.position.set(this.pos[0]!, this.pos[1]!, this.pos[2]!);
    camera.lookAt(this.look[0]!, this.look[1]!, this.look[2]!);
  }
}
