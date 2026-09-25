/**
 * Fixed TV and seated-host regions (EXPERIENCE §3.1 and §4.9). Everything is in stage units:
 * 1u = stage height / 980, so the layout scales with the stage and the board window never
 * moves when a panel appears. px minimums (rail widths, dock height) are converted to u.
 */
export type Rect = { left: number; top: number; width: number; height: number };
export type RegionName = 'dice' | 'banner' | 'rail' | 'left' | 'strip' | 'board' | 'dock';

export const STAGE_U = 980;
const GAP = 16, TOP = 120, BAR = 88;

/** px per u for a stage measured in px. */
export const unit = (stage: { height: number }) => stage.height / STAGE_U;

/** A rect in u converted to stage px. */
export const toPx = (rect: Rect, stage: { height: number }): Rect => {
  const u = unit(stage);
  return { left: rect.left * u, top: rect.top * u, width: rect.width * u, height: rect.height * u };
};

/** stage is in px; the result is in u. host adds the controller dock and lifts the strip above it. */
export function regions(
  stage: { width: number; height: number }, host: boolean,
): Record<RegionName, Rect | null> {
  const u = unit(stage), width = stage.width / u;
  const rail = Math.max(360, 250 / u), left = Math.max(300, 200 / u), right = rail + 2 * GAP;
  const dock = host ? Math.max(150, 120 / u) : 0;
  const strip = host ? 48 : 64, stripTop = host ? STAGE_U - GAP - dock - 8 - strip : STAGE_U - GAP - strip;
  const boardBottom = host ? stripTop - 8 : STAGE_U - 96;
  const box = (l: number, t: number, w: number, h: number): Rect =>
    ({ left: l, top: t, width: Math.max(0, w), height: Math.max(0, h) });
  return {
    dice: box(GAP, GAP, 248, BAR),
    banner: box(280, GAP, width - 280 - right, BAR),
    rail: box(width - rail - GAP, GAP, rail, STAGE_U - 2 * GAP),
    left: box(GAP, TOP, left, boardBottom - TOP),
    strip: box(GAP, stripTop, width - GAP - right, strip),
    board: box(left + 2 * GAP, TOP, width - left - 2 * GAP - right, boardBottom - TOP),
    dock: host ? box(GAP, STAGE_U - GAP - dock, width - GAP - right, dock) : null,
  };
}

/** Inline style for a region: absolute position in u (the HUD root defines --u). */
export const regionStyle = (rect: Rect) => ({
  position: 'absolute' as const,
  left: `calc(${rect.left} * var(--u))`, top: `calc(${rect.top} * var(--u))`,
  width: `calc(${rect.width} * var(--u))`, height: `calc(${rect.height} * var(--u))`,
});
