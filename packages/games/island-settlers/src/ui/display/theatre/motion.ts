/** Small easing and path helpers for the frame-driven theatre (EXPERIENCE §6). */
import type { ScreenPoint } from '../../shared/bridge';

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of linear progress 0..1. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    if (x <= 0 || x >= 1) return clamp01(x);
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 24; i++) {
      t = (lo + hi) / 2;
      if (at(x1, x2, t) < x) lo = t;
      else hi = t;
    }
    return at(y1, y2, t);
  };
}

export const EASE = {
  fly: cubicBezier(0.2, 0.8, 0.2, 1),
  steal: cubicBezier(0.3, 0.7, 0.2, 1),
  out: cubicBezier(0, 0, 0.58, 1),
  inOut: cubicBezier(0.42, 0, 0.58, 1),
  /** easeOutBack with overshoot s (1.70158 is the classic 1.7). */
  back: (x: number, s = 1.70158) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2,
};

/** Point on a quadratic arc from a to b whose control point is the midpoint moved by `bend` px. */
export function arc(a: ScreenPoint, b: ScreenPoint, bend: ScreenPoint, p: number): ScreenPoint {
  const c = { x: (a.x + b.x) / 2 + bend.x, y: (a.y + b.y) / 2 + bend.y };
  const q = 1 - p;
  return { x: q * q * a.x + 2 * q * p * c.x + p * p * b.x, y: q * q * a.y + 2 * q * p * c.y + p * p * b.y };
}

/** Deterministic 0..1 noise from integers (dice tumble faces), so every screen shows the same tumble. */
export const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
