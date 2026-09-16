import { ATTRIBUTES } from './attributes';
import { foxData } from './fox-data';
export const foxAttributes = foxData.attributes;
const f = Math.fround;
// Source: ftcommon.c at foxData.source.decompCommit. Values are game units/frame.
// These scalar helpers are not the fighter state machine or a complete engine port.
export function fallVelocity(velocity: number, gravity: number, terminal: number): number {
  return Math.max(f(f(velocity) - f(gravity)), -f(terminal));
}
export function frictionAcceleration(velocity: number, friction: number): number {
  return Math.abs(friction) >= Math.abs(velocity) ? -velocity : velocity > 0 ? -friction : friction;
}
export function driftAcceleration(velocity: number, stick: number, attributes: typeof ATTRIBUTES[keyof typeof ATTRIBUTES] | typeof foxAttributes = foxAttributes): number {
  if (!Number.isFinite(velocity) || !Number.isFinite(stick) || Math.abs(stick) > 1) throw new RangeError('Expected finite velocity and stick in [-1, 1]');
  const a = attributes, v = f(velocity), x = f(stick), target = f(x * a.air_drift_max);
  let accel = f(f(x * a.air_drift_stick_mul) + (x > 0 ? a.aerial_drift_base : -a.aerial_drift_base));
  if (!target) return frictionAcceleration(v, a.aerial_friction);
  if (!(f(v * accel) < 0)) {
    if (accel > 0 && f(v + accel) > target) {
      accel = -a.aerial_friction;
      if (f(v + accel) < target) accel = f(target - v);
      if (f(v + accel) > a.air_max_horizontal_velocity) accel = f(a.air_max_horizontal_velocity - v);
    } else if (accel <= 0 && f(v + accel) < target) {
      accel = a.aerial_friction;
      if (f(v + accel) > target) accel = f(target - v);
      if (f(v + accel) < -a.air_max_horizontal_velocity) accel = f(-a.air_max_horizontal_velocity - v);
    }
  }
  return accel;
}
export type AirSample = { frame: number; x: number; y: number; vx: number; vy: number };
export function traceAir(initialVy: number, stick = 0, frames = 90): AirSample[] {
  if (!Number.isFinite(initialVy) || !Number.isInteger(frames) || frames < 1 || frames > 600) throw new RangeError('Invalid air trace');
  let x = 0, y = 0, vx = 0, vy = f(initialVy);
  const result = [{ frame: 0, x, y, vx, vy }];
  for (let frame = 1; frame <= frames; frame++) {
    vx = f(vx + driftAcceleration(vx, stick));
    vy = fallVelocity(vy, foxAttributes.gravity, foxAttributes.terminal_velocity);
    x = f(x + vx); y = f(y + vy); result.push({ frame, x, y, vx, vy });
  }
  return result;
}
