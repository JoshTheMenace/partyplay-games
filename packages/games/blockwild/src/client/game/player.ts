/** Client-authoritative local body: shared physics at fixed 1/60 s steps with render interpolation. */
import type { CellReader } from '../../shared/chunk';
import { bodyCollides, eyeHeight, newBody, stepBody, type Body, type GameMode, type MoveIntent } from '../../shared/physics';

export const STEP = 1 / 60;
const MAX_STEPS = 10;

/** Auto jump: on the ground, walking into a ledge taller than a step (0.6) but at most one block, with headroom to clear it. */
export function wantsAutoJump(b: Body, intent: MoveIntent, getCell: CellReader): boolean {
  if (!b.onGround || b.flying || b.inWater || b.onLadder || b.sneaking) return false;
  const sin = Math.sin(intent.yaw), cos = Math.cos(intent.yaw);
  const dx = -sin * intent.forward + cos * intent.strafe, dz = -cos * intent.forward - sin * intent.strafe, length = Math.hypot(dx, dz);
  if (length < 0.3) return false;
  const ahead = { x: b.x + dx / length * 0.6, y: b.y + 0.61, z: b.z + dz / length * 0.6, sneaking: false };
  return bodyCollides(getCell, ahead) && !bodyCollides(getCell, { ...ahead, y: b.y + 1.01 }) && !bodyCollides(getCell, { ...b, y: b.y + 1.01 });
}

export class LocalPlayer {
  readonly body: Body;
  /** Position before the latest fixed step, for interpolation. */
  readonly prev = { x: 0, y: 0, z: 0 };
  /** Interpolated feet position for rendering. */
  readonly render = { x: 0, y: 0, z: 0 };
  /** Smoothed eye height above the feet (sneak drop and step-up easing). */
  eye: number;
  /** Horizontal distance walked on the ground this frame (footsteps, view bob). */
  walked = 0;
  private acc = 0;
  private stepLag = 0;

  constructor(x: number, y: number, z: number) {
    this.body = newBody(x, y, z);
    this.eye = eyeHeight(this.body);
    this.snap();
  }
  /** Jump the render state to the body (after spawn/teleport). */
  snap() {
    const { x, y, z } = this.body;
    Object.assign(this.prev, { x, y, z });
    Object.assign(this.render, { x, y, z });
    this.acc = 0;
    this.stepLag = 0;
  }

  /** Advance by a frame's dt. Returns false when the ground under the player is not loaded yet (physics paused). */
  update(dt: number, intent: MoveIntent, getCell: CellReader, mode: GameMode, loaded: boolean, autoJump = false): boolean {
    const b = this.body;
    this.walked = 0;
    if (!loaded) {
      this.acc = 0;
      return false;
    }
    this.acc = Math.min(this.acc + dt, STEP * MAX_STEPS);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      const { x, y, z, onGround } = b;
      this.prev.x = x;
      this.prev.y = y;
      this.prev.z = z;
      stepBody(b, autoJump && !intent.jump && wantsAutoJump(b, intent, getCell) ? { ...intent, jump: true } : intent, STEP, getCell, mode);
      const rise = b.y - y;
      // A step-up (slab, stair) lifts the body instantly; ease the camera over it instead.
      if (onGround && b.onGround && rise > 0.05 && rise <= 0.61) this.stepLag = Math.min(this.stepLag + rise, 0.6);
      if (onGround && b.onGround) this.walked += Math.hypot(b.x - x, b.z - z);
    }
    const t = this.acc / STEP;
    this.render.x = this.prev.x + (b.x - this.prev.x) * t;
    this.render.y = this.prev.y + (b.y - this.prev.y) * t;
    this.render.z = this.prev.z + (b.z - this.prev.z) * t;
    this.stepLag *= Math.exp(-14 * dt);
    this.eye += (eyeHeight(b) - this.eye) * (1 - Math.exp(-18 * dt));
    return true;
  }
  /** World-space eye height for the camera (render position, smoothed eye, step easing). */
  eyeY() { return this.render.y + this.eye - this.stepLag; }
}
