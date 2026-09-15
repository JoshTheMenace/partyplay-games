/* The dirt, rasterised in chunks.
 *
 * A whole-field buffer is not an option any more. At GH=160 and k=2 it would be
 * 640x5120 device pixels — 13 MB, and past the maximum canvas dimension on iOS
 * Safari before 16, whose failure mode is a silently blank dirt layer that
 * works perfectly on desktop. So: one offscreen canvas per 32-row chunk, a ring
 * of however many the viewport needs plus a margin, recycled. Memory is bounded
 * independent of how deep the shaft gets.
 *
 * It is also much faster than what it replaces. The old buildDirt() rasterised
 * all 1568 cells on EVERY frame the player was digging; a chunk rebuild touches
 * 20x32.
 *
 * Dirty tracking is per row, because state.dirtRev is a single global counter
 * and says nothing about where the change was. carve(), the rock-boring loop
 * and any blast bump state.rowRev[r]; a chunk rebuilds when any of its rows has
 * moved past what was drawn.
 */

import { GRID, bandOf, idx } from './worldgen';
import * as sprites from './sprites';
import type { Ctx, Palette, RenderState } from './render';

const { GW, GH, CHUNK_ROWS } = GRID;
const CHUNK_COUNT = Math.ceil(GH / CHUNK_ROWS);

/** One cached raster of CHUNK_ROWS rows, or null if it has not been built. */
type Chunk = { canvas: HTMLCanvasElement; ctx: Ctx; rev: number; serial: number; rows: number };

let chunks: (Chunk | null)[] = [];
let bandPattern: (CanvasPattern | null)[] | null = null;
let cellPx = 0;         // device px per fine cell
/* Fine cells actually in play, which is what a chunk raster is as wide as.
 *
 * NOT GRID.GW. The grids are allocated at the ten-digger maximum and a four-
 * digger shaft uses 62 of those 146 columns; rasterising the full stride would
 * cost 2.4x the pixels and the memory to hold them, for ground nobody can
 * reach. Fixed for a run, so a change of it is a resize and drops every cache. */
let fieldW: number = GW;
let palette: Palette | null = null;
let theme: string | null = null;

/* The sheet carries a tileset PER THEME and aliases the bare `dirt1`..`dirt5`
 * to topsoil. Asking for the alias everywhere would render all five biomes in
 * topsoil's texture — the colours would change and the ground would not, which
 * reads as a palette swap rather than as a different place. Prefer the themed
 * name and fall back to the alias, so a theme the generator has that the sheet
 * does not still draws. */
function tileName(kind: string, b?: number) {
  const themed = theme ? `${theme}.${kind}${b === undefined ? '' : b}` : null;
  const bare = `${kind}${b === undefined ? '' : b}`;
  return themed && sprites.has(themed) ? themed : bare;
}

/* Drop everything. Called on resize, when the cell size changes and every
 * cached raster is the wrong scale. */
export function reset(cell?: number, pal?: Palette, themeId?: string, width?: number) {
  for (const c of chunks) {
    // WebKit reclaims canvas backing stores lazily, so a few rotations would
    // otherwise accumulate full-screen buffers. Zero them before dropping.
    if (c) { c.canvas.width = 0; c.canvas.height = 0; }
  }
  chunks = new Array(CHUNK_COUNT).fill(null);
  bandPattern = null;
  cellPx = Math.max(1, Math.round(cell ?? cellPx));
  palette = pal ?? palette;
  theme = themeId || theme;
  if (width && width > 0) fieldW = Math.min(GW, width);
}

/* Draw each band tile at the chunk's cell size once, then reuse it as a
 * repeating pattern. The cell size is the art's own (see view.ts), so this is a
 * 1:1 copy rather than a resample. Blitting the tile per cell would be thousands of drawImage
 * calls per rebuild; a pattern makes the textured fill one fillRect per run. */
function buildPatterns(ctx: Ctx) {
  bandPattern = [];
  for (let b = 0; b < GRID.BAND_COUNT; b++) {
    const name = tileName('dirt', b + 1);
    if (!sprites.has(name)) { bandPattern = null; return; }
    const c = document.createElement('canvas');
    c.width = cellPx; c.height = cellPx;
    const cg = c.getContext('2d');
    if (!cg) { bandPattern = null; return; }
    cg.imageSmoothingEnabled = false;
    sprites.draw(cg, name, 0, 0, cellPx, cellPx);
    bandPattern.push(ctx.createPattern(c, 'repeat'));
  }
}

/* Stable 0..1 per cell. Must NOT be Math.random: the stain would boil from
 * frame to frame, and two captures of the same state would never match. */
function cellHash(c: number, r: number) {
  let h = Math.imul((c * 73856093) ^ (r * 19349663), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function chunkAt(i: number): Chunk {
  const had = chunks[i];
  if (had) return had;
  const rows = Math.min(CHUNK_ROWS, GH - i * CHUNK_ROWS);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, fieldW * cellPx);
  canvas.height = Math.max(1, rows * cellPx);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser has no 2D canvas.');
  const c: Chunk = { canvas, ctx, rev: -1, serial: -1, rows };
  chunks[i] = c;
  return c;
}

/* A chunk's dirty key: the SUM of its rows' revisions, not the maximum.
 *
 * The maximum is wrong and fails silently. Carving a row that is BEHIND another
 * row in the same chunk does not move the maximum, so the chunk is never
 * rebuilt and the tunnel you just cut stays painted as solid ground. Digging
 * straight down through one chunk misses 93 rebuilds out of 96, because after
 * the first row is cut three times every fresh row below it starts at 1 against
 * a maximum of 3.
 *
 * The symptom is not "terrain is stale", it is "I am walking through solid
 * rock and cannot see my own tunnel" — and then the whole chunk pops into view
 * at once when some row finally overtakes the maximum, which reads as the
 * tunnel appearing behind you in pieces.
 *
 * A sum moves on every single bump, which is the actual requirement: any change
 * anywhere in the chunk must change the key. */
function dirtyRev(state: RenderState, i: number) {
  const r0 = i * CHUNK_ROWS;
  const r1 = Math.min(GH, r0 + CHUNK_ROWS);
  let sum = 0;
  for (let r = r0; r < r1; r++) sum += state.rowRev[r];
  return sum;
}

/* Rasterise one chunk.
 *
 * Per row, solid cells merge into runs — about 40 fillRects for a whole chunk
 * rather than one per cell. With a sheet the fill is a repeating band tile and
 * a lip is blitted on every cell face that touches open ground; the lip is what
 * makes a tunnel read as carved rather than as a hole punched in a colour
 * field, and it costs a perimeter's work rather than an area's. */
function build(state: RenderState, i: number) {
  const c = chunkAt(i);
  const g = c.ctx;
  const r0 = i * CHUNK_ROWS;
  const r1 = Math.min(GH, r0 + CHUNK_ROWS);
  const dirt = state.dirt;
  const cs = cellPx;

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.canvas.width, c.canvas.height);
  g.imageSmoothingEnabled = false;

  const sheet = sprites.ready();
  if (sheet && !bandPattern) buildPatterns(g);
  const usePattern = sheet && bandPattern;

  for (let r = r0; r < r1; r++) {
    const y = (r - r0) * cs;
    const band = bandOf(r);
    g.fillStyle = (usePattern && bandPattern?.[band]) || palette?.dirt[band] || '#7a4b23';
    let run = -1;
    for (let col = 0; col <= fieldW; col++) {
      const solid = col < fieldW && dirt[idx(col, r)] === 1;
      if (solid && run < 0) run = col;
      else if (!solid && run >= 0) {
        g.fillRect(run * cs, y, (col - run) * cs, cs);
        run = -1;
      }
    }
  }

  /* The damp plume above a sealed air pocket.
   *
   * This is the ONLY thing that makes air findable. Measured before it existed:
   * 48 pockets generated, 1 taken across twelve runs — a one-lane shaft in a
   * ten-lane field simply never intersects a one-node bubble, so the pocket was
   * hidden from the game rather than from the player. The plume rises SIX lane
   * rows because the player is descending and has to read the tell before they
   * are level with what it points at.
   *
   * Drawn as a wash over the band fill rather than as its own tile: it has to
   * survive being recoloured by five biomes and being dimmed by the lamp
   * falloff, and a wash does both for free where a fixed sprite would fight the
   * palette. Painted before the lips so a tunnel edge still cuts cleanly across
   * it. */
  const hint = state.pocketHint;
  if (hint) {
    /* MULTIPLY, not a wash over the top.
     *
     * The first version painted a flat blue-grey rectangle per cell and read as
     * fog — a hard-edged grey box sitting on the dirt rather than dirt that is
     * wet. Water does not add a colour to ground, it darkens it and deepens its
     * colour, and multiply is exactly that: the band texture stays visible
     * through it, and it works unchanged across all five biome palettes instead
     * of fighting each one.
     *
     * The edges are broken up per cell from the same row hash the shaft wall
     * uses. A plume is a staircase of whole cells, and at 16pt a staircase of
     * identical alphas reads as a rectangle somebody drew; varying it makes the
     * same cells read as a stain. */
    g.save();
    g.globalCompositeOperation = 'multiply';
    for (let r = r0; r < r1; r++) {
      const y = (r - r0) * cs;
      for (let col = 0; col < fieldW; col++) {
        const i = idx(col, r);
        const h = hint[i];
        if (!h || dirt[i] !== 1) continue;
        const jitter = cellHash(col, r);
        const a = (h > 1 ? 0.34 : 0.13) + jitter * 0.07;
        g.fillStyle = `rgba(120,170,205,${a})`;
        g.fillRect(col * cs, y, cs, cs);
      }
    }
    g.restore();

    /* Bubbles sit ON TOP, additively, and only at full strength — so the
     * pocket's own node reads as the source and the plume as the trail to it.
     * These are the part that has to survive the lamp falloff from two lanes
     * away, which is the whole reason the tell exists. */
    for (let r = r0; r < r1; r++) {
      const y = (r - r0) * cs;
      for (let col = 0; col < fieldW; col++) {
        const i = idx(col, r);
        if (hint[i] < 2 || dirt[i] !== 1) continue;
        const jitter = cellHash(col, r);
        g.fillStyle = 'rgba(200,238,255,0.5)';
        const b = Math.max(1, Math.round(cs * 0.1));
        g.fillRect(col * cs + Math.round(cs * (0.2 + jitter * 0.3)),
                   y + Math.round(cs * (0.22 + jitter * 0.2)), b, b);
        g.fillRect(col * cs + Math.round(cs * (0.55 + jitter * 0.25)),
                   y + Math.round(cs * (0.58 + jitter * 0.24)), b, b);
      }
    }
  }

  if (usePattern) {
    const at = (col: number, r: number) => (col < 0 || col >= fieldW || r < 0 || r >= GH ? 1 : dirt[idx(col, r)]);
    const lipN = tileName('lipN'), lipS = tileName('lipS');
    const lipW = tileName('lipW'), lipE = tileName('lipE');
    for (let r = r0; r < r1; r++) {
      const y = (r - r0) * cs;
      for (let col = 0; col < fieldW; col++) {
        if (dirt[idx(col, r)] !== 1) continue;
        const x = col * cs;
        if (at(col, r - 1) === 0) sprites.draw(g, lipN, x, y, cs, cs);
        if (at(col, r + 1) === 0) sprites.draw(g, lipS, x, y, cs, cs);
        if (at(col - 1, r) === 0) sprites.draw(g, lipW, x, y, cs, cs);
        if (at(col + 1, r) === 0) sprites.draw(g, lipE, x, y, cs, cs);
      }
    }
  }

  c.rev = dirtyRev(state, i);
  c.serial = state.levelSerial;
}

/* Draw every chunk the viewport touches, plus one either side so a fast camera
 * never outruns the raster. `top` is the first visible fine row. */
export function render(g: Ctx, state: RenderState, top: number, visRows: number, ox: number, oy: number, scale: number) {
  const first = Math.max(0, Math.floor(top / CHUNK_ROWS) - 1);
  const last = Math.min(CHUNK_COUNT - 1, Math.floor((top + visRows) / CHUNK_ROWS) + 1);

  /* Chunks are rasterised at source resolution and scaled up here by a whole
   * number, so this must be nearest-neighbour. It is off already most frames —
   * resize() turns it off and the lamp puts it back — but "most frames, by
   * coincidence" is how a blurred shaft ships. */
  g.imageSmoothingEnabled = false;
  for (let i = first; i <= last; i++) {
    const c = chunkAt(i);
    /* The level serial as well as the dirty key, and it is not belt-and-braces.
     * startLevel() hands out a FRESH rowRev of zeros, so a chunk the player
     * never touched on the previous level has a stored key of 0 and the new
     * level's key is also 0 — the terrain would match, the chunk would not
     * rebuild, and the new level would open showing the old one's dirt. */
    if (c.serial !== state.levelSerial || c.rev !== dirtyRev(state, i)) build(state, i);
    const y = oy + (i * CHUNK_ROWS - top) * scale;
    g.drawImage(c.canvas, ox, y, fieldW * scale, c.rows * scale);
  }

  // Anything outside the resident window is released, so a deep run does not
  // accumulate one canvas per chunk it has ever passed through.
  for (let i = 0; i < CHUNK_COUNT; i++) {
    if (i >= first && i <= last) continue;
    const c = chunks[i];
    if (!c) continue;
    c.canvas.width = 0; c.canvas.height = 0;
    chunks[i] = null;
  }
}

/* How many chunk canvases are currently resident. Read by the harness. */
export function resident() {
  return chunks.reduce((n, c) => n + (c ? 1 : 0), 0);
}
