import { MIN_VIS_ROWS, TILE, VIS_COLS } from './worldgen';

/* Automatic quality on phones: each tier caps the backing-store resolution. */
export const TIER_DPR_CAP = [2, 1] as const;

/* Whole-number scale, or the same source pixel is drawn 2px wide here and 3px
 * there — which reads worse than no art at all in a field of hard rectangles.
 *
 * Sized on the VIEWPORT, not on the shaft. The field is as wide as the crew
 * needs — up to seventy-three lanes — but one screen shows VIS_COLS across,
 * which is the width the whole game was tuned at. Fitting the whole shaft
 * instead would zoom a ten-digger level down to nothing. MIN_VIS_ROWS is the
 * floor on how far in we will zoom, so a wide desktop window does not pick an
 * enormous k and show eight rows of dirt.
 *
 * The CSS cell size comes from the full-quality resolution and a quality cap
 * never changes it. Refitting at the capped resolution made the view zoom out
 * when the governor dropped a tier and back in when it restored one: at 1.5 a
 * 390px phone showed 37×66 cells instead of 24×44, and at 1 a 480px screen
 * whose full-quality multiple is 3 could only fall to 1. Instead a tier takes
 * the largest whole multiple under its cap and the resolution that multiple
 * implies, so cells stay whole backing pixels and only sharpness changes. */
export function fit(cssW: number, cssH: number, dpr: number, cap = Infinity) {
  const full = Math.max(1, Math.min(
    Math.floor(Math.round(cssW * dpr) / (VIS_COLS * TILE)),
    Math.floor(Math.round(cssH * dpr) / (MIN_VIS_ROWS * TILE)),
  ));
  const scale = (TILE * full) / dpr;       // CSS px per fine cell, fixed across tiers
  const k = Math.max(1, Math.floor(full * Math.min(1, cap / dpr)));
  return { k, scale, dpr: (TILE * k) / scale };
}

/* The shared screen's fit.
 *
 * Its job is the thing a phone cannot do — let a room see a crew at once — so
 * it takes the largest whole multiple that still shows (nearly) the whole shaft
 * from wall to wall, as long as that leaves eighteen rows to see what is
 * coming. "Nearly" is four fifths: a two-digger shaft that misses fitting a
 * 720p television at double size by a few columns is better drawn large with a
 * camera that pans a little than at half the size between two wide walls. A
 * shaft too wide even for that is shown at whatever keeps thirty rows in view
 * and the camera pans, so a four-digger shaft on a big television is drawn
 * large rather than shrunk until it fits. Whole multiples for the same reason
 * as above. */
export function fitBroadcast(cssW: number, cssH: number, dpr: number, cols: number) {
  const devW = Math.round(cssW * dpr), devH = Math.round(cssH * dpr);
  const across = Math.floor(devW / (Math.max(1, cols) * TILE * 0.8));
  const k = Math.max(1, Math.min(across, Math.floor(devH / (18 * TILE))), Math.floor(devH / (30 * TILE)));
  return { k, scale: (TILE * k) / dpr, dpr };
}
