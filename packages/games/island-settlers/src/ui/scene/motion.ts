/** Easing and loops for the motion table (EXPERIENCE §6). t runs 0 → 1. */
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const easeOutBack = (t: number, c = 1.4) => 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeOut = (t: number) => 1 - (1 - t) ** 2;
export const easeInOutSine = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;

/** A sine loop between lo and hi; a fixed value under reduced motion. */
export const breathe = (now: number, ms: number, lo: number, hi: number, reduced: boolean, still: number) =>
  reduced ? still : lo + (hi - lo) * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / ms));

/** Progress of a timed motion started at `start`, or 1 when done. */
export const progress = (now: number, start: number, ms: number) => clamp01((now - start) / ms);
