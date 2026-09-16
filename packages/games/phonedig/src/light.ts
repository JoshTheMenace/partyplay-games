/* Lighting: the helmet lamp, per-theme ambient, ambient occlusion at tunnel
 * lips, and additive emitters for fire, the harpoon tip and ore glint.
 *
 * Composited over the terrain and under the HUD. The lamp radius is what the
 * LANTERN upgrade finally buys — it has been purchasable and read by nothing
 * since it was added.
 *
 * ── the cost argument, which drives every choice below ────────────────────
 *
 * This runs on a phone at 60 Hz, so the shape of the pass matters more than the
 * shape of the light. Three rules:
 *
 *  1. ONE offscreen buffer, at HALF device resolution, composited once. A light
 *     mask is smooth by construction, so half resolution is invisible and costs
 *     a quarter of the fill. Upscaling it with smoothing on is not a compromise
 *     — the bilinear filter IS the blur.
 *  2. NO per-cell canvas loop. Ambient occlusion needs to know where the dirt
 *     is, which sounds like 900 fillRects a frame; it is instead 900 BYTES
 *     written into a GW-by-visible-rows ImageData, blitted once and stretched.
 *     Writing 4 KB and issuing one drawImage is roughly a thousandth of the
 *     work, and the stretch gives the falloff away free.
 *  3. Glows are a cached 64px sprite per colour, blitted and scaled. Building a
 *     createRadialGradient per emitter per frame is the classic way to make a
 *     lighting pass cost more than the entire rest of the renderer.
 *
 * ── what the numbers mean ─────────────────────────────────────────────────
 *
 * `state.lightRadius` is in FINE CELLS and already folds in the theme's ambient,
 * the LANTERN tier and any relic. The theme's `ambient` (0..1) is the floor:
 * topsoil 0.55 is a bright afternoon under a thin crust, basalt 0.16 is a hole
 * in the ground with a lamp on your head. That difference is the entire reason
 * this file exists — the five biomes are otherwise five palettes.
 */

import { GRID, idx } from './worldgen';
import type { Ctx, Palette, RenderState, ViewBox } from './render';

const { GW, GH } = GRID;

/* How black the darkest biome may get. 1.0 would make basalt unplayable; the
 * lamp has to reveal, not rescue.
 *
 * 0.74 rather than the 0.88 this shipped with first: at 0.88 basalt plus the
 * occlusion pass came to within a few percent of opaque, and the capture showed
 * a black rectangle with four monsters floating in it. The rule this settles on
 * is that the UNLIT parts of the darkest biome must still be legible enough to
 * navigate — the lamp is what makes them comfortable, not what makes them
 * visible at all. */
const MAX_DARK = 0.74;

/* Extra darkness from ambient occlusion, on top of the ambient floor. Small on
 * purpose: this is applied to every solid cell on screen, so it reads as a
 * global exposure change long before it reads as contact shadow. All it has to
 * do is put a soft edge on a tunnel lip. */
const AO = 0.24;

/* The mask runs at CSS resolution over this — not device resolution; see ensure(). */
const LQ = 2;

let mask: HTMLCanvasElement | null = null, mg: Ctx | null = null;
let ao: HTMLCanvasElement | null = null, aog: Ctx | null = null;
let aoImg: ImageData | null = null;
let mw = 0, mh = 0;
let sizeKey = '';
const glows = new Map();

/* Emitters queued by entities.js this frame, in world (fine cell) coordinates.
 * Cleared at the end of render() so a caller can never leak one into the next
 * frame by forgetting to. */
type Emitter = { x: number; y: number; r: number; c: string; s: number };
const emitters: Emitter[] = [];

export function reset() {
  if (mask) { mask.width = 0; mask.height = 0; }
  if (ao) { ao.width = 0; ao.height = 0; }
  mask = mg = ao = aog = aoImg = null;
  sizeKey = '';
  glows.clear();
  emitters.length = 0;
}

/* Additive point light, world coordinates. */
export function add(x: number, y: number, radius: number, colour: string, strength: number) {
  if (!(radius > 0)) return;
  emitters.push({ x, y, r: radius, c: colour || '#ffffff', s: strength === undefined ? 1 : strength });
}

/* A radial falloff, cached per colour and blitted rather than rebuilt.
 *
 * TWO PROFILES, and they are not interchangeable.
 *
 *   hard  a plateau and then a shoulder. This is the LAMP, punched out of the
 *         darkness mask: a helmet lamp is flat in the middle and dies off
 *         slowly, and a linear ramp reads as a spotlight with a visible edge.
 *   soft  no plateau at all. This is every ADDITIVE emitter, and it has to be
 *         soft because they stack — the player's helmet and the harpoon tip sit
 *         on top of each other the instant the harpoon reels in, and with a
 *         plateau profile the two summed to a white disc with the player
 *         invisible inside it. */
function glow(colour: string, hard?: boolean) {
  const key = hard ? colour + '!' : colour;
  let c = glows.get(key);
  if (c) return c;
  const S = 64;
  c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  if (hard) {
    grad.addColorStop(0, colour);
    grad.addColorStop(0.35, colour);
    grad.addColorStop(0.62, alpha(colour, 0.5));
    grad.addColorStop(0.82, alpha(colour, 0.16));
  } else {
    grad.addColorStop(0, colour);
    grad.addColorStop(0.16, alpha(colour, 0.62));
    grad.addColorStop(0.42, alpha(colour, 0.26));
    grad.addColorStop(0.72, alpha(colour, 0.07));
  }
  grad.addColorStop(1, alpha(colour, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  glows.set(key, c);
  return c;
}

/* Colour -> the same colour at a given alpha. Handles the two forms the palette
 * actually contains (#rgb and #rrggbb) and passes anything else through, so an
 * unexpected token degrades to a hard-edged glow rather than to nothing. */
function alpha(col: string, a: number) {
  if (col[0] !== '#') return col;
  let r, g, b;
  if (col.length === 4) {
    r = parseInt(col[1] + col[1], 16); g = parseInt(col[2] + col[2], 16); b = parseInt(col[3] + col[3], 16);
  } else if (col.length >= 7) {
    r = parseInt(col.slice(1, 3), 16); g = parseInt(col.slice(3, 5), 16); b = parseInt(col.slice(5, 7), 16);
  } else return col;
  return `rgba(${r},${g},${b},${a})`;
}

function ensure(cssW: number, cssH: number, dpr: number, rows: number) {
  const key = `${cssW}x${cssH}x${dpr}x${rows}`;
  if (key === sizeKey && mask) return;
  sizeKey = key;

  /* Sized in CSS pixels, NOT device pixels.
   *
   * The mask is a blurred field of gradients composited with smoothing on, so
   * a 2x display gains nothing visible from rendering it at four times the
   * pixels — and measured, it cost about ten times as much: this pass went from
   * 1 ms a frame at 1x to 10 ms at 2x on a laptop-sized window, and was the
   * largest single reason the game dropped to ~25-40 fps on a HiDPI screen. */
  mw = Math.max(1, Math.round(cssW / LQ));
  mh = Math.max(1, Math.round(cssH / LQ));
  if (!mask) { mask = document.createElement('canvas'); }
  mask.width = mw; mask.height = mh;
  mg = mask.getContext('2d');

  if (!ao) { ao = document.createElement('canvas'); }
  ao.width = GW; ao.height = Math.max(1, rows);
  aog = ao.getContext('2d');
  if (aog) aoImg = aog.createImageData(GW, Math.max(1, rows));
}

/* One radial mask per frame, drawn into an offscreen buffer and composited. */
export function render(g: Ctx, state: RenderState, view: ViewBox, palette: Palette) {
  const cssW = view.cssW, cssH = view.cssH, dpr = view.dpr || 1;
  const sc = view.scale;
  const amb = palette && typeof palette.ambient === 'number' ? palette.ambient : 0.5;
  const dark = Math.max(0, Math.min(1, 1 - amb)) * MAX_DARK;

  const first = Math.floor(view.top);
  const rows = Math.ceil(view.visRows) + 2;
  ensure(cssW, cssH, dpr, rows);
  // ensure() builds both buffers; bail rather than guard every call below.
  if (!mg || !mask) return;

  const fx = view.ox;                       // field left, CSS px
  /* The columns on screen, plus one either side so the stretched occlusion
   * edge samples real neighbours. A phone shows about twenty of a shaft up to
   * seventy-three lanes wide; scanning the rest was pure waste. */
  const c0 = Math.max(0, Math.floor(-fx / sc) - 1);
  const c1 = Math.min(GW, Math.ceil((cssW - fx) / sc) + 1);
  const skyY = state.skyRows > 0 ? Math.max(0, (state.skyRows - view.top) * sc) : 0;

  const k = 1 / LQ;                         // CSS px -> mask px (see ensure)
  const M = (v: number) => v * k;

  mg.setTransform(1, 0, 0, 1, 0, 0);
  mg.clearRect(0, 0, mw, mh);

  if (dark > 0.02) {
    /* The ambient floor, full width and from the sky down.
     *
     * Full width rather than field-width on purpose. The screen shake is a
     * translate applied to this same context, so a mask that stopped exactly at
     * the field edge would leave an unlit strip down one side of the screen for
     * the length of every cave-in — brightest at the moment the player is least
     * able to explain it. The gutters do not care: view.js repaints both of them
     * after this pass. The sky does, so it is excluded; there is nothing to
     * light above the ground. */
    mg.fillStyle = `rgba(0,0,0,${dark})`;
    mg.fillRect(0, M(skyY), mw, mh);

    /* Ambient occlusion. One byte per fine cell, stretched. See rule 2.
     *
     * The value is dirt occupancy, so the stretched result is high inside solid
     * ground and falls off across a cell into open space — which is a soft
     * shadow at every tunnel lip and darkness in the rock the lamp has not
     * reached. It is the single cheapest thing in this file and does more for
     * "you are underground" than the lamp does. */
    const d = state.dirt;
    if (!aoImg || !aog || !ao) return;
    const px = aoImg.data;
    for (let i = 0; i < rows; i++) {
      const r = first + i;
      const solid = r >= 0 && r < GH;
      let w = (i * GW + c0) * 4;
      for (let c = c0; c < c1; c++) {
        px[w] = 0; px[w + 1] = 0; px[w + 2] = 0;
        px[w + 3] = solid ? (d[idx(c, r)] === 1 ? 255 : 0) : 255;
        w += 4;
      }
    }
    if (c1 <= c0) return;
    aog.putImageData(aoImg, 0, 0, c0, 0, c1 - c0, rows);

    /* Drawn across the FULL visible span, sky included, and that is safe rather
     * than sloppy: the sky band is pre-carved, so its occupancy bytes are zero
     * and it contributes no darkness at all. */
    mg.save();
    mg.globalAlpha = AO;
    mg.imageSmoothingEnabled = true;
    mg.drawImage(ao, c0, 0, c1 - c0, rows,
                 M(fx + c0 * sc), M((first - view.top) * sc), M((c1 - c0) * sc), M(rows * sc));
    mg.restore();

    /* The lamp. destination-out, so the light REMOVES darkness rather than
     * adding brightness — the ground keeps its own colour instead of being
     * washed toward white, which is what a multiply-style mask buys over an
     * additive one. */
    mg.globalCompositeOperation = 'destination-out';
    // One lamp per digger. A teammate two tunnels over lights their own ground,
    // which is most of how you find them.
    for (const q of state.players) {
      punch(mg, M(view.ox + (q.x + 1) * sc), M(view.oy + (q.y + 1 - view.top) * sc),
            M((q.lightRadius || state.lightRadius || 8) * sc), 1);
    }

    // Every additive emitter also clears the fog around itself: a Fygar's
    // breath lighting the corridor is most of what makes the corridor read.
    for (const e of emitters) {
      punch(mg, M(view.ox + e.x * sc), M(view.oy + (e.y - view.top) * sc),
            M(e.r * sc), Math.min(1, e.s));
    }
    mg.globalCompositeOperation = 'source-over';

    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(mask, 0, 0, cssW, cssH);
    g.imageSmoothingEnabled = false;
    g.restore();
  }

  /* ── additive pass ───────────────────────────────────────────────────────
   * On the main canvas, over the mask: these are things that GIVE light. */
  g.save();
  g.globalCompositeOperation = 'lighter';

  /* The lamp has to ADD as well as subtract, and that is not belt-and-braces.
   *
   * The mask only removes darkness, so it can brighten dirt and nothing else —
   * a carved cell is painted in the theme's `cave`, which is near black in every
   * biome, and removing darkness from black leaves black. Without this the lamp
   * lit the walls of the shaft and left the shaft itself unlit, which is exactly
   * backwards. Scaled by how dark the biome is, so topsoil gets almost none of
   * it and basalt gets a real pool of light on the ground.
   *
   * This is also where the LANTERN tier becomes legible: the radius comes
   * straight off state.lightRadius, so buying it visibly widens the pool. */
  if (dark > 0.02) {
    for (const q of state.players) {
      blit(g, glow((palette.harpoon as string) || '#ffd88a'),
           view.ox + (q.x + 1) * sc, view.oy + (q.y + 1 - view.top) * sc,
           (q.lightRadius || state.lightRadius || 8) * 0.6 * sc, 0.06 + dark * 0.16);
    }
  }
  for (const e of emitters) {
    blit(g, glow(e.c), view.ox + e.x * sc, view.oy + (e.y - view.top) * sc,
         e.r * sc, e.s);
  }

  /* Ore glint.
   *
   * Ore sits in SOLID dirt and nothing else draws it, so without this the seams
   * the whole economy is built on are invisible until you happen to cut one.
   * Gated on the lamp — the glint fades out past the light — which is exactly
   * what LANTERN should be buying: not "brighter", but "you can see the seam
   * from further away". Grade 3 is eight times grade 1 and reads as such.
   *
   * The scan is over the VISIBLE rows only, which is the view's business, and
   * it is a Uint8Array read per cell with no canvas work unless the cell has
   * ore in it.
   *
   * KEEP IT SUB-CELL. The first version used a glow wider than the cell it sat
   * in, and a six-cell vein rendered as a single cyan fog bank that swallowed
   * the player, the lamp and half the shaft. A glint is a highlight ON a cell,
   * not a light source in the room; the falloff is squared so it concentrates
   * near the lamp instead of hazing the whole lit radius. */
  if (state.ore) {
    /* The BRIGHTEST lamp, not one chosen digger's. A seam lit by whoever is
     * standing next to it is the whole point of the effect, and measuring from
     * a teammate off-screen would light nothing. Each lamp keeps its own reach,
     * so one digger's LANTERN does not widen everyone's. The scan is still
     * bounded by the visible rows and the same blit budget. */
    const lamps = state.players.map(q =>
      [q.x + 1, q.y + 1, q.lightRadius || state.lightRadius || 8] as const);
    const litBy = (cx: number, cy: number) => {
      let best = 0;
      for (const [lx, ly, reach] of lamps) {
        const lit = 1 - Math.hypot(cx - lx, cy - ly) / reach;
        if (lit > best) best = lit;
      }
      return best;
    };
    const oreGlow = glow((palette.ore as string) || '#7fe3ff');
    const t = view.t || 0;
    let budget = 48;
    for (let i = 0; i < rows && budget > 0; i++) {
      const r = first + i;
      if (r < 0 || r >= GH) continue;
      // Only columns in play AND on screen; past them is the edge of the world or off the phone.
      for (let c = c0, end = Math.min(c1, state.activeGW); c < end; c++) {
        const grade = state.ore[idx(c, r)];
        if (!grade) continue;
        const lit = litBy(c + 0.5, r + 0.5);
        if (lit < 0.12) continue;
        /* Twinkle, phased per cell.
         *
         * Without it a vein renders as a regular grid of identical discs —
         * every other cell, same brightness — which reads as a debug overlay
         * rather than as mineral. The phase is a hash of the cell so it is
         * stable frame to frame and identical between two captures; the clock
         * comes down from entities.js, which is the one the harness pins. */
        const ph = cellHash(c, r);
        const tw = 0.62 + 0.38 * Math.sin(t * 2.4 + ph * 6.283);
        blit(g, oreGlow,
             view.ox + (c + 0.5) * sc, view.oy + (r + 0.5 - view.top) * sc,
             sc * (0.22 + grade * 0.07), lit * lit * tw * (0.1 + grade * 0.055));
        if (--budget <= 0) break;
      }
    }
  }
  g.restore();

  emitters.length = 0;
}

/* Stable 0..1 per cell. Must NOT be Math.random: the glints would boil from
 * frame to frame and no two captures of the same state would match. */
function cellHash(c: number, r: number) {
  let h = Math.imul((c * 73856093) ^ (r * 19349663), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function punch(g: Ctx, x: number, y: number, r: number, s: number) {
  if (!(r > 0)) return;
  g.globalAlpha = s;
  g.drawImage(glow('#ffffff', true), x - r, y - r, r * 2, r * 2);
  g.globalAlpha = 1;
}

function blit(g: Ctx, img: CanvasImageSource | null, x: number, y: number, r: number, a: number) {
  if (!img || !(r > 0) || !(a > 0)) return;
  g.globalAlpha = Math.min(1, a);
  g.drawImage(img, x - r, y - r, r * 2, r * 2);
  g.globalAlpha = 1;
}
