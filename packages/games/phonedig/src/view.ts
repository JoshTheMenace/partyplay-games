/* Composition: measure the stage, drive the camera, and call the drawing
 * modules in order. The actual marks are made in terrain.ts and entities.ts.
 *
 * The base camp is gone with the rest of the roguelike shell — there is no
 * between-runs diorama in a party game — so renderBase and the basecamp import
 * went with it. That was the renderer's only tie to the meta layer.
 *
 * Public surface:
 *   init(el)  resize()  layout()  render(state, alpha, stick)
 *
 * Three injection seams exist for tests/shots.html and for nothing else. Screen
 * shake calls Math.random, the hunter ring calls a clock, and the fit reads
 * devicePixelRatio — without a way to pin all three, no two screenshots of the
 * same game state are ever identical and a visual diff is worthless.
 */

import { GRID, TILE, VIS_COLS } from './worldgen';
import { TIER_DPR_CAP, fit } from './fit';
import { THEMES, THEME_BY_ID } from './themes';
import * as cameras from './camera';
import * as terrain from './terrain';
import * as entities from './entities';
import * as anim from './anim';
import type { Ctx, Palette, RenderState, ViewBox } from './render';
import { FALLBACK_PALETTE, readPalette } from './palette';
import * as perf from './perf';

/** What input.js hands the renderer so it can draw the thumbstick. */
export type StickView = {
  active: boolean; cx: number; cy: number; r: number; knobX: number; knobY: number;
};

const { GH } = GRID;

let canvas: HTMLCanvasElement | null = null;
let ctx: Ctx | null = null;
let stage: HTMLElement | null = null;

let L: ViewBox = {
  cssW: 0, cssH: 0, scale: 1, vx: 0, ox: 0, oy: 0, dpr: 1, k: 1,
  visRows: 0, visCols: VIS_COLS, top: 0,
};
/* The document's palette once init() has run; the authored fallbacks until
 * then. Never null, so nothing downstream has to guard it. */
let P: Palette = FALLBACK_PALETTE;
let themeDrawn: string | null = null;
let widthDrawn = 0;

/** One camera per mounted view; module state would give four diggers one. */
const camera = cameras.create();

/* ── injection seams ──────────────────────────────────────────────────── */

let jitter = Math.random;
let clock = () => performance.now();
let dprOverride = 0;
let lastClock = 0;

export function setJitter(fn: (() => number) | null) { jitter = fn || Math.random; }
export function setClock(fn: (() => number) | null) {
  clock = fn || (() => performance.now());
  entities.setClock(clock);
  lastClock = clock();
}
export function setDprOverride(n: number) { dprOverride = n > 0 ? n : 0; }

/* Automatic quality on phones; see fit.ts for why the caps are whole numbers. */
export const QUALITY_TIERS = TIER_DPR_CAP.length;
let qualityTier = 0;
export function setQualityTier(tier: number) {
  const next = Math.max(0, Math.min(QUALITY_TIERS - 1, Math.floor(tier)));
  if (next === qualityTier) return;
  qualityTier = next;
  resize();
}

/* The worn player skin. Cosmetic only — see anim.setSkin. */
/* The suit is per digger now and travels on the entity; see anim.ts. There is
 * nothing global left to set. */

/* ── palette ──────────────────────────────────────────────────────────── */

/* The FIELD is themed; the UI is not.
 *
 * tokens.css stays the single place the app is themed, and it still supplies
 * every colour that is not ground — the player, the monsters, the harpoon, the
 * text. But the five biomes each carry their own five-band ramp, and a biome
 * whose ground is not its own colour is not a biome. So themes.js overrides
 * exactly the ground: bands, sky and cave.
 *
 * Cached per theme id, because this runs on every frame and building an object
 * per frame to hold eighteen strings is work for nothing. */
const themeCache = new Map<string, Palette>();

function paletteFor(themeId: string): Palette {
  let p = themeCache.get(themeId);
  if (p) return p;
  const t = THEME_BY_ID[themeId] || THEMES[0];
  p = { ...P, dirt: t.bands.slice(), sky: t.sky, cave: t.cave, ambient: t.ambient };
  // The shaft wall is the ground it is cut through, a shade under. Deriving it
  // rather than authoring a sixth colour per theme means it can never drift out
  // of step with the bands it sits beside.
  p.wall = t.bands[t.bands.length - 1];
  themeCache.set(themeId, p);
  return p;
}

/* Read once per mount. getComputedStyle every frame forced a style recalc for
 * a token that never changes while a round is on screen. */
let fontCache: string | null = null;
function fontData() {
  return fontCache ??= getComputedStyle(document.documentElement)
    .getPropertyValue('--font-data').trim() || 'monospace';
}

/* ── layout ───────────────────────────────────────────────────────────── */

export function init(el: HTMLCanvasElement, box?: HTMLElement | null) {
  canvas = el;
  ctx = canvas.getContext('2d', { alpha: false });
  /* The element to MEASURE, handed in rather than looked up.
   *
   * Upstream reads document.getElementById('stage') because its page owns one.
   * A party client mounts this canvas inside the room shell's own scene stage,
   * which has no such id, and a renderer that reaches into the document for a
   * particular element is a renderer that only works in one page. Defaults to
   * the canvas itself, which is always the right size. */
  stage = box ?? el.parentElement ?? el;
  P = readPalette();
  fontCache = null;
  entities.setClock(clock);
  /* Hand the palette over immediately, not just on the first render. The menu
   * can draw a monster silhouette (the bestiary's fallback for a kind with no
   * sheet art) before a single frame of the game has been rendered, and without
   * this that call has no colours and quietly declines to draw. */
  entities.setView({ ox: 0, oy: 0, scale: 1, top: 0 }, P);
  lastClock = clock();
  resize();
}

export function layout() { return L; }

/* Call before a frame's events are emitted, so a world change clears the old
 * world's effects and animation rather than the new world's first ones. */
export function syncWorld(state: Pick<RenderState, 'worldKey' | 'levelSerial'>) {
  return entities.syncWorld(state.worldKey, state.levelSerial);
}

/* Let go of the canvas and every cached raster.
 *
 * This module is a SINGLETON — one canvas, one camera, one set of terrain
 * chunks — which is right for a page that shows one shaft and wrong the moment
 * a second view mounts without the first having stood down. So a mount that
 * finds itself replaced calls this, and the next init() starts from nothing
 * rather than from the previous mount's half-state. */
export function dispose() {
  canvas = null;
  ctx = null;
  stage = null;
  themeDrawn = null;
  widthDrawn = 0;
  fontCache = null;
  qualityTier = 0;
  camera.reset();
  terrain.reset();
  entities.reset();
  anim.reset();
}

export function resize() {
  if (!stage || !canvas || !ctx) return;
  const rect = stage.getBoundingClientRect();
  const cssW = Math.max(1, Math.floor(rect.width));
  const cssH = Math.max(1, Math.floor(rect.height));
  // Cap at 2: a 3x panel costs 2.25x the fill rate for art nobody can tell
  // apart at arm's length.
  const { k, scale, dpr } = dprOverride
    ? fit(cssW, cssH, dprOverride)
    : fit(cssW, cssH, Math.min(window.devicePixelRatio || 1, perf.dprCap || 2), TIER_DPR_CAP[qualityTier]);
  const devW = Math.round(cssW * dpr);
  const devH = Math.round(cssH * dpr);

  /* Two origins, and the distinction is the whole of the horizontal camera.
   *
   * `vx` is where the VIEWPORT starts on screen: fixed, and what the gutters,
   * the depth gauge and the off-screen markers anchor to. `ox` is where world
   * x=0 falls, which the camera moves. Everything that draws an entity goes
   * through ox, so the pan costs those call sites nothing. */
  const visCols = cssW > cssH ? cssW / scale : Math.min(cssW / scale, VIS_COLS);
  const vx = Math.round(((cssW - visCols * scale) / 2) * dpr) / dpr;

  L = {
    cssW, cssH, scale, vx, ox: vx, oy: 0, dpr, k,
    visRows: cssH / scale,
    visCols,
    top: L.top,
  };

  canvas.width = devW;
  canvas.height = devH;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;

  // The theme palette is not known here; render() re-resets on the next frame.
  themeDrawn = null;
  widthDrawn = 0;
  terrain.reset(TILE, P);
}

/* ── the gutter ───────────────────────────────────────────────────────────
 *
 * Integer scale never fills the width exactly. The remainder is 15-22% of a
 * phone and half of a laptop, and there is no arithmetic that makes it go away
 * — so it is drawn as the SIDE OF THE SHAFT: the same strata the player is
 * digging through, continued out past the field, scrolling with the camera.
 *
 * That is the whole trick. Dead black bars read as something the developer
 * forgot; rock that moves with the world reads as the wall you are cutting
 * between. The right-hand strip then has somewhere to put the depth gauge,
 * which is the one piece of information the scrolling view took away. */
function bandAt(row: number) {
  const b = Math.floor(row / GRID.BAND_ROWS);
  return b < 0 ? 0 : b > GRID.BAND_COUNT - 1 ? GRID.BAND_COUNT - 1 : b;
}

/* Deterministic per-row jitter. Must NOT be Math.random: the wall would boil
 * from frame to frame, and two screenshots of the same state would differ. */
function rowHash(r: number) {
  let h = Math.imul(r ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function drawWall(g: Ctx, x: number, w: number, top: number, TP: Palette) {
  if (w <= 0) return;
  const first = Math.floor(top);
  const rows = Math.ceil(L.visRows) + 2;

  for (let i = 0; i < rows; i++) {
    const r = first + i;
    if (r < 0 || r >= GH) continue;
    const y = (r - top) * L.scale;
    // Darker than the playfield's own dirt: the wall is out of the light, and
    // the contrast is what stops the eye reading the gutter as playable space.
    g.fillStyle = TP.dirt[bandAt(r)];
    g.fillRect(x, y, w, L.scale + 1);
    g.fillStyle = `rgba(0,0,0,${0.42 + rowHash(r) * 0.14})`;
    g.fillRect(x, y, w, L.scale + 1);
  }

  // Strata: a lighter seam every few rows, offset per band so the layers do not
  // line up into a regular stripe.
  g.globalAlpha = 0.16;
  g.fillStyle = P.text;
  for (let i = 0; i < rows; i++) {
    const r = first + i;
    if (r < 0 || r >= GH || (r + bandAt(r)) % 5 !== 0) continue;
    const y = (r - top) * L.scale;
    const inset = rowHash(r * 7) * w * 0.4;
    g.fillRect(x + inset, y, w - inset, Math.max(1, L.scale * 0.08));
  }
  g.globalAlpha = 1;
}

function drawGutters(g: Ctx, state: RenderState, top: number, TP: Palette) {
  /* Anchored to the VIEWPORT, not to the field. The shaft is now usually wider
   * than the screen, so `ox + GW * scale` is somewhere off the right of the
   * monitor and the right-hand wall would never be drawn — and worse, the rest
   * of the shaft would show through where the wall should be. */
  const right = L.vx + Math.min(L.visCols, state.activeGW) * L.scale;
  const w = L.vx;
  if (w <= 0 && right >= L.cssW) return;

  drawWall(g, 0, w, top, TP);
  drawWall(g, right, L.cssW - right, top, TP);

  // Bevel: a shadow cast onto the field from the left wall and a lit edge on
  // the right, so the playfield reads as recessed between them.
  const b = Math.max(1, L.scale * 0.14);
  const shade = g.createLinearGradient(L.ox, 0, L.ox + b * 2, 0);
  shade.addColorStop(0, 'rgba(0,0,0,0.55)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = shade;
  g.fillRect(L.ox, 0, b * 2, L.cssH);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fillRect(right - b, 0, b, L.cssH);

  drawDepthGauge(g, state, right + b * 2, L.cssW - right - b * 2);
}

/* The depth gauge: what the scrolling view took away.
 *
 * On the old single-screen field you could see the whole level, so "how far
 * down am I" was answered by looking. Now it is not, so it gets a ruler — and
 * the ruler doubles as the air bar, because the two questions a player asks
 * underground are how deep and how long. */
function drawDepthGauge(g: Ctx, state: RenderState, x: number, w: number) {
  if (w < 10) return;
  const pad = 3;
  const top = 10;
  const h = L.cssH - top * 2;
  const wide = w >= 26;
  const cx = Math.round(x + (wide ? 12 : Math.max(pad, w * 0.45))) + 0.5;

  g.strokeStyle = P.border;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx, top);
  g.lineTo(cx, top + h);
  g.stroke();

  const span = GRID.LH;                       // metres in one level
  g.font = `600 ${wide ? 8 : 7}px ${fontData()}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  for (let m = 0; m <= span; m += 10) {
    const y = Math.round(top + (m / span) * h) + 0.5;
    const major = m % 20 === 0;
    g.globalAlpha = major ? 0.5 : 0.28;
    g.strokeStyle = P.text;
    g.beginPath();
    g.moveTo(cx - (major ? 4 : 2), y);
    g.lineTo(cx + (major ? 4 : 2), y);
    g.stroke();
    if (wide && major && m > 0 && m < span) {
      g.globalAlpha = 0.4;
      g.fillStyle = P.text;
      g.fillText(String(state.depth - Math.round(state.player.y / 2) + m), cx + 6, y);
    }
  }
  g.globalAlpha = 1;

  // Where the player is in this level, with the absolute depth alongside.
  const t = Math.min(1, Math.max(0, state.player.y / GH));
  const py = Math.round(top + t * h);
  g.fillStyle = P.accent;
  g.beginPath();
  g.moveTo(cx - 6, py);
  g.lineTo(cx - 1, py - 4);
  g.lineTo(cx - 1, py + 4);
  g.closePath();
  g.fill();

  // Air, as a column climbing beside the ruler. Reading DOWN as it empties, so
  // it drains the same direction the player is heading.
  if (state.airMax > 0) {
    const a = Math.max(0, Math.min(1, state.air / state.airMax));
    const bw = Math.max(3, Math.min(5, w - (wide ? 20 : 8)));
    const bx = wide ? x + 2 : cx + 3;
    g.fillStyle = P.border;
    g.fillRect(bx, top, bw, h);
    g.fillStyle = a < 0.2 ? P.danger : P.air;
    g.globalAlpha = a < 0.2 ? 0.55 + 0.45 * Math.abs(Math.sin(clock() / 160)) : 0.85;
    g.fillRect(bx, top, bw, h * a);
    g.globalAlpha = 1;
  }
}

/* ── off-screen threats ───────────────────────────────────────────────────
 *
 * The camera is the one change in this rebuild that can make the game UNFAIR.
 * Every tuned constant — CHASE_RANGE, GHOST_WIND, ROCK_WOBBLE, the whole HUNT
 * block — was set when the player could see the entire field at once, and the
 * comments in engine.js reason explicitly about deaths being earned. With a
 * scrolling view you can now be killed by something you never saw.
 *
 * The fix is an affordance, not a number. Nothing about the simulation changes:
 * a chevron at the screen edge for the two things that can reach you from off
 * screen — a monster that is hunting, and a rock loose in your column above you.
 * Tuning the constants instead would be treating the symptom, and would undo
 * bot-trial results that are still correct. */
function drawOffscreen(g: Ctx, state: RenderState, top: number) {
  const bot = top + L.visRows;
  // Centre of the VIEWPORT, not of the shaft: with the camera panning, the
  // middle of the field is often not on screen at all.
  const cx = L.vx + Math.min(L.visCols, state.activeGW) * L.scale * 0.5;

  const chevron = (x: number, y: number, dir: number, colour: string, alpha: number) => {
    const s = Math.max(6, L.scale * 0.5);
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = colour;
    g.beginPath();
    g.moveTo(x, y + dir * s);
    g.lineTo(x - s, y - dir * s * 0.2);
    g.lineTo(x + s, y - dir * s * 0.2);
    g.closePath();
    g.fill();
    g.restore();
  };

  const pulse = 0.55 + 0.45 * Math.abs(Math.sin(clock() / 220));

  for (const m of state.monsters) {
    if (m.dying || !m.hunting) continue;   // the dead never reach a client
    const my = m.y + 1;
    if (my >= top && my <= bot) continue;
    const above = my < top;
    const right = L.vx + Math.min(L.visCols, state.activeGW) * L.scale;
    const x = Math.min(right - 12, Math.max(L.vx + 12, sxOf(m.x + 1)));
    chevron(x, above ? 14 : L.cssH - 14, above ? -1 : 1, P.danger, pulse);
  }

  for (const r of state.rocks) {
    if (r.state !== 'wobble' && r.state !== 'falling') continue;
    const ry = r.y + 1;
    if (ry >= top && ry <= bot) continue;
    // Only what is actually over your head. A rock loose two shafts away is
    // not information, it is noise — and noise here would teach the player to
    // ignore the one marker that matters.
    if (Math.abs(r.x - state.player.x) > 2.5) continue;
    const above = ry < top;
    chevron(sxOf(r.x + 1), above ? 14 : L.cssH - 14, above ? -1 : 1, P.rock, 0.85);
  }

  void cx;
}

function sxOf(x: number) { return L.ox + x * L.scale; }

/* ── joystick ─────────────────────────────────────────────────────────── */

/* Deliberately faint. The stick sits on top of live playfield in the bottom-left
 * corner, and anything heavier hides the monsters coming at you from below —
 * which is exactly where they come from. It only has to be findable by a thumb
 * that is already resting on it, not legible from across the room. */
function drawStick(g: Ctx, stick: StickView | null) {
  if (!stick) return;
  const a = stick.active ? 0.3 : 0.14;
  g.save();
  g.globalAlpha = a * 0.25;
  g.fillStyle = P.text;
  g.beginPath();
  g.arc(stick.cx, stick.cy, stick.r, 0, Math.PI * 2);
  g.fill();

  g.globalAlpha = a;
  g.strokeStyle = P.text;
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(stick.cx, stick.cy, stick.r, 0, Math.PI * 2);
  g.stroke();

  g.globalAlpha = stick.active ? 0.6 : 0.3;
  g.fillStyle = P.accent;
  g.beginPath();
  g.arc(stick.knobX, stick.knobY, stick.r * 0.36, 0, Math.PI * 2);
  g.fill();
  g.restore();
}





export function render(state: RenderState, alpha: number, stick: StickView | null = null, reducedMotion = false) {
  if (!ctx) return;
  const g = ctx;
  const a = state.phase === 'play' || state.phase === 'descend' ? alpha : 0;

  /* Crossing into a new biome invalidates every cached terrain chunk — they are
   * rasterised with the band colours baked in. Without this the shaft keeps the
   * previous biome's ground until the player happens to dig through a chunk. */
  const TP = paletteFor(state.theme);
  /* The width belongs in the same test as the theme: both are baked into every
   * cached chunk raster, and a stale one is invisible until you dig into it.
   * The width only ever changes on a new run, but a mounted view outlives a
   * run. */
  if (state.theme !== themeDrawn || state.activeGW !== widthDrawn) {
    themeDrawn = state.theme;
    widthDrawn = state.activeGW;
    /* Rasterised at SOURCE resolution — one art pixel per chunk pixel — and
     * upscaled by an integer at the blit, so the result is pixel-identical to
     * rasterising at screen resolution. It used to be TILE * k: at 2x that made
     * every chunk nine times the pixels, and a chunk is rebuilt whenever a cell
     * in it is cut, which is where the post-snapshot frame spikes came from. */
    terrain.reset(TILE, TP, state.theme, state.activeGW);
    entities.setTheme(state.theme);
  }

  // Real elapsed time, for the camera only. The simulation never sees it.
  const now = clock();
  let realDt = (now - lastClock) / 1000;
  lastClock = now;
  if (!(realDt > 0)) realDt = 0;
  if (realDt > 0.1) realDt = 0.1;

  const px = state.player.px + (state.player.x - state.player.px) * a;
  const py = state.player.py + (state.player.y - state.player.py) * a;
  const snapUnit = 1 / L.k;                 // one device pixel, in world cells
  const visCols = Math.min(L.visCols, state.activeGW);
  L.vx = Math.round((L.cssW - visCols * L.scale) * L.dpr / 2) / L.dpr;
  const cam = camera.follow(state, px, py, visCols, L.visRows, realDt, snapUnit);
  const top = cam.y;
  L.top = top;
  // World origin = viewport origin, less however far the camera has panned.
  L.ox = L.vx - cam.x * L.scale;

  g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  g.fillStyle = TP.cave;
  g.fillRect(0, 0, L.cssW, L.cssH);

  if (!reducedMotion && state.shake > 0) {
    const k = state.shake * L.scale * 1.6;
    g.translate((jitter() - 0.5) * k, (jitter() - 0.5) * k);
  }

  const fieldW = state.activeGW * L.scale;

  // Sky, only where there is one. Below level 1 there is nothing above you but
  // more rock, which is the entire point of starting underground.
  if (state.skyRows > 0) {
    const skyBottom = (state.skyRows - top) * L.scale;
    if (skyBottom > 0) {
      g.fillStyle = TP.sky;
      g.fillRect(L.ox, 0, fieldW, skyBottom);
    }
  }

  const tTerrain = perf.now();
  terrain.render(g, state, top, L.visRows, L.ox, L.oy, L.scale);
  perf.add('terrain', tTerrain);

  entities.setView({ ox: L.ox, oy: L.oy, scale: L.scale, top }, TP);
  const tFont = perf.now();
  const font = fontData();
  perf.add('fontStyle', tFont);
  entities.render(g, state, a, font);

  // Gutters, indicators and the stick sit in screen space, outside the shake:
  // a depth gauge that jitters with a cave-in is unreadable exactly when it
  // matters most.
  g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  const tChrome = perf.now();
  if (!perf.skip('gutters')) drawGutters(g, state, top, TP);
  drawOffscreen(g, state, top);
  drawStick(g, stick);
  perf.add('chrome', tChrome);
}
