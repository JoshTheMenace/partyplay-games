#!/usr/bin/env python3
"""Generate the entire sprite sheet for phonedig from scratch, procedurally.

There is no source art. Every pixel in assets/sprites.png is computed here from
a seed, which is why this file is long: it is the art.

    python3 scripts/gen-art.py            # write assets/sprites.png + src/sprites.js
    python3 scripts/gen-art.py --help

Two outputs are written in ONE pass so they cannot drift:

  assets/sprites.png  indexed-colour PNG, run through pngquant
  src/sprites.js      FRAMES / CLIPS tables, emitted from the same registry the
                      packer walks, with load()/ready()/has()/draw() preserved

House rules this script enforces on itself, each as a hard failure:

  * Determinism. Only numpy.random.default_rng, seeded per sprite from a stable
    hash of the sprite's name, so adding a sprite cannot perturb its neighbours.
    Same seed, byte-identical PNG.
  * No anti-aliasing. Every pixel is an exact palette entry; the final image is
    asserted to contain no colour outside the palette.
  * Seamless dirt. The band tiles are used as createPattern('repeat'), so each
    one is built from wrap-filtered noise and then wrap-compared edge to edge.
    A seam fails the build.
  * Budget. deploy.sh precaches assets/* unconditionally, so every byte here is
    downloaded before the first offline launch. Over budget exits non-zero.

Style: 16-bit pixel art. Flat fills, hard edges, one light source at the upper
left, palette ramps derived from a single hue per material, ordered (Bayer)
dithering between ramp steps. Shading is not painted by hand — a material map
is drawn with exact shapes and then lit by a gradient-of-the-mask normal, which
is the part a generator does better than a person.
"""

from __future__ import annotations

import argparse
import colorsys
import hashlib
import math
import pathlib
import re
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

# PartyPlay port: copied from phonedig/scripts/gen-art.py, which it reproduced
# byte for byte before any change here. It writes the port's own sheet and a
# TypeScript table, and reads the port's .ts sources for relics and variants.
ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_PNG = ROOT.parents[2] / 'public' / 'games' / 'phonedig' / 'sprites.png'
DEFAULT_JS = ROOT / 'src' / 'sprites.ts'

TILE = 16          # source px per fine cell   (asserted against content.js)
ACTOR = 32         # an actor is 2x2 cells
SHEET_W = 512      # shelf-packer shelf width
PAD = 1            # transparent gutter between frames

# ── colour ────────────────────────────────────────────────────────────────

def hex2rgb(h: str) -> tuple:
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def rgb2hex(c) -> str:
    return '#%02x%02x%02x' % (c[0], c[1], c[2])


def hue_lerp(h: float, target: float, amt: float) -> float:
    """Shortest-path hue interpolation, both args in degrees."""
    d = ((target - h + 180.0) % 360.0) - 180.0
    return (h + d * amt) % 360.0


def ramp(base: str, n: int = 4, spread: float = 0.42, sat: float = 0.24,
         hue_pull: float = 0.16, hi_hue: float = 48.0, lo_hue: float = 268.0):
    """A pixel-art ramp from one base colour: index 0 lightest, n-1 darkest.

    Highlights drift toward warm yellow and desaturate; shadows drift toward
    violet and saturate. Doing it by rule rather than by eye is what keeps the
    whole sheet reading as one palette."""
    r, g, b = [c / 255.0 for c in hex2rgb(base)]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    h *= 360.0
    out = []
    for i in range(n):
        t = (2.0 * i / max(1, n - 1)) - 1.0          # -1 light .. +1 dark
        vv = v * (1.0 - t * spread)
        ss = s * (1.0 + t * sat)
        hh = hue_lerp(h, lo_hue if t > 0 else hi_hue, hue_pull * abs(t))
        vv = min(1.0, max(0.0, vv))
        ss = min(1.0, max(0.0, ss))
        rr, gg, bb = colorsys.hsv_to_rgb(hh / 360.0, ss, vv)
        out.append((int(round(rr * 255)), int(round(gg * 255)), int(round(bb * 255))))
    return out


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


BAYER8 = np.array([
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
], dtype=np.float32) / 64.0


def bayer(h: int, w: int) -> np.ndarray:
    """Tiled Bayer field. 8 divides both 16 and 32, so the pattern is periodic
    across a tile boundary and cannot itself introduce a seam."""
    reps = (int(math.ceil(h / 8.0)), int(math.ceil(w / 8.0)))
    return np.tile(BAYER8, reps)[:h, :w]


def dither_index(t: np.ndarray, n: int, strength: float = 0.9) -> np.ndarray:
    """Continuous lightness (1 bright .. 0 dark) -> ramp index, ordered dither."""
    v = (1.0 - np.clip(t, 0.0, 1.0)) * (n - 1)
    v = v + (bayer(*t.shape) - 0.5) * strength
    return np.clip(np.floor(v + 0.5), 0, n - 1).astype(np.int32)


# ── materials ─────────────────────────────────────────────────────────────
#
# A material is a ramp plus how it reacts to light. The shading pass reads
# nothing else, so a new material is one line.

MATS = {}
_MAT_IDS = {}


def M(name, base, n=4, contrast=0.50, edge=4.6, blur=0.80, base_idx=1,
      outline=None, flat=False):
    """Register a material.

    `base_idx` is the ramp step an unlit interior lands on, and it is an INDEX
    rather than a lightness on purpose: `level` is derived so that a flat
    surface sits exactly on a ramp entry. Off-by-a-half was the whole bug in
    the first pass — every interior fell between two steps and the ordered
    dither turned entire torsos into checkerboard. Dithering should show up
    where the shading actually crosses a step, and nowhere else.

    `contrast` is then read in ramp STEPS: 1/(n-1) of it moves one step, so
    0.50 on a 4-step ramp pushes a lit rim one step up and a shadowed rim one
    step down. `blur` is small so that "rim" means two pixels, not half the
    sprite."""
    mid = len(MATS) + 1
    cols = ramp(base, n)
    if outline is None:
        outline = mix(cols[-1], (14, 10, 18), 0.45)
    MATS[mid] = dict(name=name, ramp=cols, contrast=contrast, edge=edge,
                     blur=blur, level=1.0 - base_idx / float(n - 1),
                     outline=outline, flat=flat)
    _MAT_IDS[name] = mid
    return mid


HELMET = M('helmet', '#dfe8ef', n=4, contrast=0.52)
VISOR = M('visor', '#3f7fd8', n=4, contrast=0.60)
SUIT = M('suit', '#e2542b', n=4, contrast=0.50)
SUITDK = M('suitdk', '#9b2f18', n=3, contrast=0.40)
BOOT = M('boot', '#3150a6', n=4, contrast=0.48)
BRASS = M('brass', '#c8933a', n=4, contrast=0.58)
STEEL = M('steel', '#8a92a2', n=4, contrast=0.50)
DARK = M('dark', '#241c2c', n=2, contrast=0.30, base_idx=0)
GLASSHI = M('glasshi', '#e4f2ff', n=2, contrast=0.18, base_idx=0)

POOKA = M('pooka', '#d63a2e', n=4, contrast=0.52)
GOGGLE = M('goggle', '#f2c62c', n=4, contrast=0.54)
PUPIL = M('pupil', '#2a1d20', n=2, contrast=0.26, base_idx=0)

FYGAR = M('fygar', '#4faa3a', n=4, contrast=0.52)
BELLY = M('belly', '#ecdc7e', n=4, contrast=0.44)
HORN = M('horn', '#e98a24', n=4, contrast=0.52)

# The two deep kinds. Both get a body and ONE contrasting part, which is the
# same budget every other monster here runs on: a Pooka is red plus goggles, a
# Fygar is green plus a belly. A third material per creature is how a 32px
# sprite stops having a silhouette and starts having a paint job.
SHARKM = M('shark', '#6f8fa8', n=4, contrast=0.52)
SHARKPALE = M('sharkpale', '#cfe0e8', n=3, contrast=0.34)
MOLEM = M('mole', '#a37a56', n=4, contrast=0.50)
MOLEPINK = M('molepink', '#e0a89a', n=3, contrast=0.38)

FLAME = M('flame', '#f5871f', n=4, contrast=0.44)
FLAMEHI = M('flamehi', '#ffe27a', n=3, contrast=0.30, base_idx=0)

ROCK = M('rock', '#8d8578', n=5, contrast=0.48, edge=3.4, blur=1.0, base_idx=2)
MATS[ROCK]['ramp'] = ramp('#8d8578', 5, spread=0.50, sat=0.30)   # wider: facets
GHOSTM = M('ghostm', '#bcd8ea', n=4, contrast=0.42)

# The deeper five. Each one's palette is doing a job the mechanic depends on:
# amber cracks say "there is heat and pressure inside this", chitin says
# "armoured", iron says "this is a device, not an animal".
CHITIN = M('chitin', '#4b3f56', n=4, contrast=0.46)
CREAM = M('cream', '#e6dcc0', n=4, contrast=0.44)
IRON = M('iron', '#535a6b', n=4, contrast=0.50)
AMBER = M('amber', '#ffae2b', n=3, contrast=0.30, base_idx=0)

GOLD = M('gold', '#e8b23a', n=4, contrast=0.58)
RUBY = M('ruby', '#d8324f', n=4, contrast=0.58)
EMER = M('emer', '#2fb07a', n=4, contrast=0.56)
VIOLET = M('violet', '#9a5cd8', n=4, contrast=0.56)
SPARKM = M('spark', '#fff2c0', n=3, contrast=0.26, base_idx=0)

# ── the wardrobe ─────────────────────────────────────────────────────────
#
# Materials that exist only to be remapped onto a suit. Nothing in the world
# uses them, so they cost sheet palette and nothing else.
#
# Four purples rather than one, because "purple" spans a wider range than any
# other hue family the sheet carries and a wardrobe with one of them in it
# looks like a mistake next to a wardrobe with four. AMETHYST is the saturated
# one, ORCHID leans magenta, PLUM is nearly black at the low end, and HEATHER
# is desaturated almost to grey — side by side they read as four choices rather
# than four attempts at the same choice. VIOLET above is left alone: it is the
# Wraith Pooka's tint and retuning it would move a monster.
AMETHYST = M('amethyst', '#7b46c9', n=4, contrast=0.54)
ORCHID = M('orchid', '#c451b8', n=4, contrast=0.56)
PLUM = M('plum', '#4a2247', n=3, contrast=0.42)
# The plum SUIT cannot use PLUM as its body. At #4a2247 it is a near-black
# maroon that does not read as purple at all, and it joined Void and Cinder in a
# cluster of three suits separated only by a couple of pixels of visor colour —
# a wardrobe where three of seventeen choices are "dark" is three wasted rungs.
# So the body gets its own wine, and PLUM stays what it is good at: the shadow
# under Amethyst and Orchid, where being nearly black is the point.
WINE = M('wine', '#8c3a6b', n=4, contrast=0.50)
HEATHER = M('heather', '#9c8fb5', n=4, contrast=0.42)
TANGERINE = M('tangerine', '#f0791c', n=4, contrast=0.54)
GLACIER = M('glacier', '#a9d8ea', n=4, contrast=0.44)
RUSTM = M('rustm', '#a5522c', n=4, contrast=0.50)
MUSTARD = M('mustard', '#c9a12e', n=4, contrast=0.50)
VERDIGRIS = M('verdigris', '#3fa89a', n=4, contrast=0.52)
CARBON = M('carbon', '#2b2b30', n=3, contrast=0.34)
CHALK = M('chalk', '#f0ece4', n=3, contrast=0.28)
DUSTM = M('dust', '#a8a096', n=4, contrast=0.38)
CLODM = M('clod', '#8a5c30', n=4, contrast=0.46)


# ── themes ────────────────────────────────────────────────────────────────
#
# One hue family per theme. Bands index into a single 12-step earth ramp, so
# adjacent depth bands share shades and the whole biome reads as one rock.

class Theme:
    def __init__(self, tid, top, bottom, accent, grit, crack, sparkle=0):
        self.id = tid
        self.earth = self._ramp12(top, bottom)
        self.accent = ramp(accent, 4)
        self.grit = grit          # pebble density 0..1
        self.crack = crack        # crack density 0..1
        self.sparkle = sparkle    # loose mineral glints per tile

    @staticmethod
    def _ramp12(top, bottom, n=12):
        a = np.array(hex2rgb(top), np.float64)
        b = np.array(hex2rgb(bottom), np.float64)
        out = []
        for i in range(n):
            f = i / (n - 1.0)
            c = a + (b - a) * f
            # Bow the middle of the ramp toward saturation so a linear blend
            # does not pass through mud.
            h, s, v = colorsys.rgb_to_hsv(*(c / 255.0))
            s = min(1.0, s * (1.0 + 0.22 * math.sin(f * math.pi)))
            r, g, bl = colorsys.hsv_to_rgb(h, s, v)
            out.append((int(round(r * 255)), int(round(g * 255)), int(round(bl * 255))))
        return out

    def band(self, b):
        """4 consecutive shades of the earth ramp, lightest first."""
        i0 = b * 2
        return self.earth[i0:i0 + 4]


THEMES = [
    # topsoil's endpoints are themes.js's first and last band, so the sheet and
    # the procedural fallback palette agree on what topsoil looks like.
    Theme('topsoil', '#a86c33', '#3a2340', '#e8b23a', grit=1.0, crack=0.15),
    Theme('clay', '#bb7047', '#43202a', '#d9744a', grit=0.55, crack=0.40),
    Theme('stone', '#95959d', '#2b2e3c', '#9fb0c4', grit=0.35, crack=0.90),
    Theme('crystal', '#7b8cb6', '#252e50', '#7fe3ea', grit=0.25, crack=0.60, sparkle=4),
    Theme('basalt', '#57535d', '#1c1a24', '#a869e0', grit=0.20, crack=1.0, sparkle=2),
    # A theme with no entry here is not merely un-textured: terrain.js asks for
    # `<theme>.dirt<band>` and falls back to the BARE tile when the sheet has
    # not got it, and the bare tile is topsoil brown. So a new biome added to
    # themes.js and not to this list renders as topsoil no matter what its bands
    # say — which is exactly how Aquifer first shipped into the shot harness,
    # authored blue and drawn brown. Endpoints are themes.js's first and last
    # band, as topsoil's are.
    Theme('aquifer', '#1c3f4a', '#08151b', '#7fd8e0', grit=0.30, crack=0.55, sparkle=3),
    Theme('karst', '#5c4c39', '#211a11', '#d9a066', grit=0.45, crack=0.95, sparkle=1),
]


# ── the drawing surface ───────────────────────────────────────────────────

class Cel:
    """A material map plus a light bias map. Nothing here knows a colour."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.mat = np.zeros((h, w), np.int16)
        self.bias = np.zeros((h, w), np.float32)
        self.alpha = np.ones((h, w), np.float32)

    def _sh(self):
        im = Image.new('L', (self.w, self.h), 0)
        return im, ImageDraw.Draw(im)

    def put(self, im, mat, bias=0.0):
        m = np.asarray(im, dtype=np.uint8) > 127
        self.mat[m] = mat
        self.bias[m] = bias
        return m

    def ell(self, cx, cy, rx, ry, mat, bias=0.0):
        im, d = self._sh()
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
        return self.put(im, mat, bias)

    def rect(self, x0, y0, x1, y1, mat, bias=0.0):
        im, d = self._sh()
        d.rectangle([x0, y0, x1, y1], fill=255)
        return self.put(im, mat, bias)

    def rrect(self, x0, y0, x1, y1, r, mat, bias=0.0):
        # Snapped to whole pixels and with the radius clamped: PIL's
        # rounded_rectangle builds its corner arcs from the corner box and
        # raises outright when a fractional height leaves that box inverted.
        x0, y0 = int(round(x0)), int(round(y0))
        x1, y1 = int(round(x1)), int(round(y1))
        if x1 < x0:
            x0, x1 = x1, x0
        if y1 < y0:
            y0, y1 = y1, y0
        r = int(max(0, min(r, (x1 - x0) // 2, (y1 - y0) // 2)))
        im, d = self._sh()
        if r > 0:
            d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=255)
        else:
            d.rectangle([x0, y0, x1, y1], fill=255)
        return self.put(im, mat, bias)

    def poly(self, pts, mat, bias=0.0):
        im, d = self._sh()
        d.polygon([tuple(p) for p in pts], fill=255)
        return self.put(im, mat, bias)

    def line(self, pts, mat, width=1, bias=0.0):
        im, d = self._sh()
        d.line([tuple(p) for p in pts], fill=255, width=width)
        return self.put(im, mat, bias)

    def px(self, x, y, mat, bias=0.0):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            self.mat[y, x] = mat
            self.bias[y, x] = bias

    def erase(self, mask):
        self.mat[mask] = 0

    def mirror(self):
        """Flip the MATERIAL map, not the finished pixels — so a left-facing
        sprite is lit from the upper left like everything else."""
        c = Cel(self.w, self.h)
        c.mat = self.mat[:, ::-1].copy()
        c.bias = self.bias[:, ::-1].copy()
        c.alpha = self.alpha[:, ::-1].copy()
        return c

    def symmetrise(self):
        """Force exact left/right symmetry — free for a generator, fiddly by
        hand, and it is what makes a front-facing sprite look deliberate."""
        half = self.w // 2
        self.mat[:, half:] = self.mat[:, :half][:, ::-1]
        self.bias[:, half:] = self.bias[:, :half][:, ::-1]

    def shift(self, dx, dy):
        self.mat = np.roll(np.roll(self.mat, dy, 0), dx, 1)
        self.bias = np.roll(np.roll(self.bias, dy, 0), dx, 1)
        if dy > 0:
            self.mat[:dy] = 0
        elif dy < 0:
            self.mat[dy:] = 0
        if dx > 0:
            self.mat[:, :dx] = 0
        elif dx < 0:
            self.mat[:, dx:] = 0


CROSS = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)
LIGHT = (-0.7071, -0.7071)   # direction TO the light, y down


def light_terms(mask, blur):
    sm = ndimage.gaussian_filter(mask.astype(np.float32), blur, mode='nearest')
    gy, gx = np.gradient(sm)
    mag = np.hypot(gx, gy)
    # Outward normal is -grad; lambert with LIGHT collapses to this.
    lam = -(gx * LIGHT[0] + gy * LIGHT[1]) / (mag + 1e-6)
    return lam, mag


def tinted(rgba, colour, amount):
    """Pull an already-rendered frame a fraction of the way toward `colour`.

    Kept as a blend of the finished pixels rather than as a remapped material,
    because a per-theme material would mean authoring a new ramp — and new
    palette entries — for every theme, on a sheet already merging 475 authored
    colours down to 255. Blending reuses the shading that is already there and
    only shifts its hue, which is exactly what "the same stone, lit by this
    biome" should mean."""
    out = rgba.copy()
    a = out[:, :, 3] > 0
    c = np.array(colour, np.float32)
    px = out[:, :, :3].astype(np.float32)
    out[:, :, :3][a] = np.clip(px[a] * (1.0 - amount) + c * amount, 0, 255).astype(np.uint8)
    return out


def render_cel(cel, dither=0.42, outline=True):
    """Light a material map and resolve it to palette colours.

    The dither amplitude is deliberately low. It exists to soften the step
    where a shading ramp crosses from one palette entry to the next; it is not
    a texture. Anything above about 0.5 starts reading as noise laid over the
    art rather than as the material itself."""
    h, w = cel.h, cel.w
    out = np.zeros((h, w, 4), np.uint8)
    for mid in np.unique(cel.mat):
        if mid == 0:
            continue
        mat = MATS[int(mid)]
        m = cel.mat == mid
        cols = np.array(mat['ramp'], np.uint8)
        if mat['flat']:
            out[m, :3] = cols[0]
        else:
            lam, mag = light_terms(m, mat['blur'])
            stren = np.clip(mag * mat['edge'], 0.0, 1.0)
            t = mat['level'] + mat['contrast'] * lam * stren + cel.bias
            idx = dither_index(t, len(cols), dither)
            out[m, :3] = cols[idx[m]]
        out[m, 3] = 255

    if outline:
        solid = cel.mat > 0
        if solid.any():
            inner = ndimage.binary_erosion(solid, CROSS, border_value=0)
            edge = solid & ~inner
            lam, mag = light_terms(solid, 1.0)
            # Selective outlining: the lit upper-left rim keeps its highlight,
            # every other edge gets a dark contour so the silhouette reads
            # against dirt of any colour.
            dark_edge = edge & (lam < 0.20)
            for mid in np.unique(cel.mat[dark_edge]) if dark_edge.any() else []:
                if mid == 0:
                    continue
                sel = dark_edge & (cel.mat == mid)
                out[sel, :3] = np.array(MATS[int(mid)]['outline'], np.uint8)

    a = np.clip(cel.alpha, 0.0, 1.0)
    # Quantise alpha to a handful of levels; a smooth alpha ramp explodes the
    # palette for a difference nobody can see at 32 px.
    levels = np.array([0.0, 0.38, 0.63, 0.82, 1.0])
    qa = levels[np.abs(a[..., None] - levels).argmin(-1)]
    out[..., 3] = (out[..., 3].astype(np.float32) * qa).round().astype(np.uint8)
    out[out[..., 3] == 0] = 0
    return out


# ── noise ─────────────────────────────────────────────────────────────────

def tileable_noise(w, h, rng, sigmas=(0.9, 2.0, 4.0), weights=(1.0, 0.6, 0.35)):
    """Periodic fractal noise. gaussian_filter(mode='wrap') is exactly periodic,
    so the result tiles by construction rather than by touch-up."""
    base = rng.standard_normal((h, w)).astype(np.float32)
    acc = np.zeros((h, w), np.float32)
    for s, k in zip(sigmas, weights):
        f = ndimage.gaussian_filter(base, s, mode='wrap')
        f = (f - f.mean()) / (f.std() + 1e-6)
        acc += k * f
    acc = (acc - acc.min()) / (np.ptp(acc) + 1e-6)
    return acc


def free_noise(w, h, rng, sigmas=(0.8, 1.8), weights=(1.0, 0.6)):
    base = rng.standard_normal((h, w)).astype(np.float32)
    acc = np.zeros((h, w), np.float32)
    for s, k in zip(sigmas, weights):
        f = ndimage.gaussian_filter(base, s, mode='reflect')
        f = (f - f.mean()) / (f.std() + 1e-6)
        acc += k * f
    acc = (acc - acc.min()) / (np.ptp(acc) + 1e-6)
    return acc


def wrap_draw(w, h, fn):
    """Run a PIL draw callback nine times at tile offsets, so anything it draws
    wraps around the edges instead of being clipped by them."""
    im = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(im)
    for oy in (-h, 0, h):
        for ox in (-w, 0, w):
            fn(d, ox, oy)
    return np.asarray(im, np.uint8) > 127


# ── terrain ───────────────────────────────────────────────────────────────

def dirt_tile(theme, band, rng):
    """One band tile: flat colour, granular speckle, pebbles, cracks.

    The first version leaned on low-frequency noise plus a fat ordered dither
    and the result was camouflage — a 16 px motif you could pick out across a
    4x4 tiling. Two changes fixed it. The noise octaves are now all shorter
    than the tile, so no single blob is tile-sized and there is nothing for the
    eye to lock onto; and the ramp quantisation is nearly undithered, so the
    tile is FLAT COLOUR broken by discrete grain, which is what soil looks
    like at this size. Texture now comes from objects — speckle, pebbles,
    cracks — rather than from a haze laid over everything."""
    w = h = TILE
    cols = np.array(theme.band(band), np.uint8)

    # High-frequency octaves ONLY. An octave whose blobs are a third of the
    # tile wide gives the eye a shape to recognise, and since there is exactly
    # one tile per band — terrain.js builds a single createPattern from it —
    # that shape reappears every 32 screen pixels across the entire field and
    # the ground reads as wallpaper. Keep every feature down at one or two
    # pixels and the repeat has nothing to latch onto.
    n = tileable_noise(w, h, rng, sigmas=(0.55, 1.1), weights=(1.0, 0.5))
    n = np.clip((n - 0.5) * 1.25 + 0.5, 0.0, 1.0)
    # Nearly no dither: let the ramp step where the noise steps.
    idx = dither_index(n, len(cols), 0.30)

    # Granular speckle. Per-pixel and so tileable for free, and it is what
    # carries the texture now that nothing larger is allowed to.
    sp = rng.random((h, w))
    idx = np.where(sp < 0.13, np.maximum(idx - 1, 0), idx)
    idx = np.where(sp > 0.87, np.minimum(idx + 1, len(cols) - 1), idx)

    # Pebbles: a lit cap over a darker body, which is the smallest thing that
    # reads as a solid object embedded in soil rather than as more noise.
    #
    # Pebbles and cracks are RELATIVE modulations, never absolute shades.
    #
    # This is the single most important line in the file for how the game
    # looks. Setting a pebble to "the darkest entry" makes it the same shade
    # wherever it lands, which makes it a landmark, which — one tile per band —
    # tiles it across the whole screen as visible paisley. Nudging the shade
    # that is ALREADY there by one step instead means a pebble is only ever a
    # local contrast, it inherits the noise underneath it, and no two of its
    # repeats look alike enough to line up. Same feature, same density, and the
    # grid stops being findable.
    def bump(mask, delta):
        idx[mask] = np.clip(idx[mask] + delta, 0, len(cols) - 1)

    ngrit = int(round(2 + 3 * theme.grit))
    for i in range(ngrit):
        cx, cy = int(rng.integers(0, w)), int(rng.integers(0, h))
        r = float(rng.uniform(1.0, 1.8))
        body = wrap_draw(w, h, lambda d, ox, oy, cx=cx, cy=cy, r=r:
                         d.ellipse([cx + ox - r, cy + oy - r, cx + ox + r, cy + oy + r], fill=255))
        cap = wrap_draw(w, h, lambda d, ox, oy, cx=cx, cy=cy, r=r:
                        d.ellipse([cx + ox - r, cy + oy - r,
                                   cx + ox + r - 1.2, cy + oy + r - 1.2], fill=255))
        bump(body, +1)
        bump(cap, -2)

    # Cracks, denser as the rock gets harder. One pixel, one step darker.
    ncrack = int(round(1 + 3 * theme.crack))
    for i in range(ncrack):
        x0, y0 = int(rng.integers(0, w)), int(rng.integers(0, h))
        ang = float(rng.uniform(0, math.pi * 2))
        ln = float(rng.uniform(3.0, 6.0))
        x1, y1 = x0 + math.cos(ang) * ln, y0 + math.sin(ang) * ln
        cr = wrap_draw(w, h, lambda d, ox, oy:
                       d.line([x0 + ox, y0 + oy, x1 + ox, y1 + oy], fill=255, width=1))
        bump(cr, +1)

    out = np.zeros((h, w, 4), np.uint8)
    out[..., :3] = cols[idx]
    out[..., 3] = 255

    # Mineral glint, for the biomes whose whole identity is what is IN the
    # rock. Deliberately washed most of the way toward the band's own lightest
    # shade: a full-strength accent pixel here is the ONE thing that turns a
    # tiling into a visible lattice, because it lands at the same spot in every
    # repeat and nothing else in the tile is bright enough to hide it. The ore
    # overlays carry the loud version of this, per cell, where it belongs.
    for i in range(theme.sparkle):
        x, y = int(rng.integers(0, w)), int(rng.integers(0, h))
        out[y, x, :3] = mix(tuple(int(v) for v in cols[0]), theme.accent[1], 0.28)
    return out


def seam_report(rgb):
    """Wrap-compare the edges. A tile that does not tile shows up as a step at
    the wrap that is far larger than a typical interior step."""
    a = rgb[..., :3].astype(np.int32)
    col_seam = np.abs(a[:, -1] - a[:, 0]).mean()
    col_int = np.abs(a[:, 1:] - a[:, :-1]).mean()
    row_seam = np.abs(a[-1, :] - a[0, :]).mean()
    row_int = np.abs(a[1:, :] - a[:-1, :]).mean()
    return col_seam, col_int, row_seam, row_int


LIT = (250, 244, 232)
SHADE = (26, 18, 30)


def lip_tile(theme, side, rng):
    """The lit / shadowed rim where solid ground meets an open tunnel.

    Alpha overlays, blitted on any solid face touching open ground, so they are
    tinted by whatever band is underneath. Light from the upper left: the top
    and left faces catch it, the bottom and right faces are in shadow. This is
    the difference between a tunnel that looks carved and a hole punched in a
    colour field.

    The lit faces are NOT white. A white rim at high alpha reads as a drawn
    border — a dotted line around the hole — which is precisely the failure
    this overlay exists to avoid. Instead the crest is painted in the theme's
    own lightest earth, so it reads as soil catching the light, and only the
    falloff behind it is neutral. The shadowed faces are the reverse and can be
    neutral, because a shadow has no hue of its own."""
    w = h = TILE
    rows = np.zeros((h, w, 4), np.float32)   # rgb + alpha, before orientation

    lit = side in 'NW'
    # Every face gets a solid one-pixel CREST and then a falloff behind it.
    # Seen in the game, a lit crest with only a soft gradient opposite it did
    # not read as a carved tunnel — it read as a tunnel with a bright floor and
    # no ceiling, because a 40%-alpha shadow over dark earth is very nearly
    # nothing. The shadowed faces need the same hard first pixel the lit ones
    # have; it is the hard line on all four sides that says "cut", and the
    # asymmetry then lives in the falloff rather than in whether an edge
    # exists at all.
    if side == 'N':
        crest, ca, falloff = theme.earth[0], 1.0, [0.38, 0.20, 0.09]
    elif side == 'W':
        crest, ca, falloff = theme.earth[1], 0.88, [0.28, 0.12]
    elif side == 'S':
        crest, ca, falloff = SHADE, 0.82, [0.46, 0.24, 0.10]
    else:
        crest, ca, falloff = SHADE, 0.70, [0.34, 0.16]

    r0 = 0
    if crest is not None:
        # A solid one-pixel crest, with a few pixels of grain a row behind it
        # so the line is uneven the way a dug edge is.
        for x in range(w):
            rows[0, x, :3] = crest
            rows[0, x, 3] = ca
        for i in range(6):
            x = int(rng.integers(0, w))
            rows[1, x, :3] = theme.earth[2] if lit else SHADE
            rows[1, x, 3] = 0.70 if lit else 0.63
        r0 = 1

    for i, a in enumerate(falloff):
        y = r0 + i
        if y >= h:
            break
        for x in range(w):
            if rows[y, x, 3] > 0:
                continue
            rows[y, x, :3] = LIT if lit else SHADE
            rows[y, x, 3] = a

    # Loose crumbs a row or two further in, so the rim frays into the dirt
    # instead of stopping on a ruled line.
    for i in range(4):
        x = int(rng.integers(0, w))
        y = r0 + len(falloff) - int(rng.integers(0, 2))
        if 0 <= y < h and rows[y, x, 3] == 0:
            rows[y, x, :3] = theme.earth[2] if lit else SHADE
            rows[y, x, 3] = 0.34

    if side in 'WE':
        rows = rows.transpose(1, 0, 2)
    if side == 'S':
        rows = rows[::-1]
    if side == 'E':
        rows = rows[:, ::-1]

    out = np.zeros((h, w, 4), np.uint8)
    out[..., :3] = np.round(rows[..., :3]).astype(np.uint8)
    # The alphas above are already a short discrete list by construction, so
    # there is nothing to quantise — every (colour, alpha) pair here is one
    # palette entry and there are about twenty of them for the whole game.
    out[..., 3] = np.round(rows[..., 3] * 255).astype(np.uint8)
    out[out[..., 3] == 0] = 0
    return out


def ore_tile(theme, grade, rng):
    """Mineral seam drawn into a dirt cell. Grade drives density and brightness;
    every fleck is a lit top-left pixel over a dark body, which is the whole
    trick that makes 3 px read as a lump of metal."""
    w = h = TILE
    out = np.zeros((h, w, 4), np.uint8)
    acc = theme.accent
    count = (4, 7, 11)[grade - 1]
    ang = float(rng.uniform(0.5, 1.1))       # veins run down-right
    if rng.random() < 0.5:
        ang = math.pi - ang
    cx, cy = float(rng.uniform(4, 12)), float(rng.uniform(3, 13))
    for i in range(count):
        t = (i / max(1, count - 1)) - 0.5
        x = cx + math.cos(ang) * t * 15.0 + float(rng.uniform(-1.6, 1.6))
        y = cy + math.sin(ang) * t * 15.0 + float(rng.uniform(-1.6, 1.6))
        r = 1 if grade == 1 else (1 if rng.random() < 0.55 else 2)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy > r * r + (0 if r == 1 else 1):
                    continue
                xx, yy = int(round(x + dx)), int(round(y + dy))
                if not (0 <= xx < w and 0 <= yy < h):
                    continue
                lit = (dx <= 0 and dy <= 0)
                out[yy, xx, :3] = acc[0] if lit else acc[2]
                out[yy, xx, 3] = 255
        if grade == 3:
            xx, yy = int(round(x)), int(round(y))
            if 0 <= xx < w and 0 <= yy < h:
                out[yy, xx, :3] = acc[0]
                out[yy, xx, 3] = 255
    return out


# ── the player ────────────────────────────────────────────────────────────
#
# A stout astronaut-miner: white domed helmet, blue visor, orange-red pressure
# suit, blue boots, brass harpoon pump.

"""Helmet rule, applied in all three views.

The first pass drew the visor as one big ellipse filling the dome, and the
result read as a cyclops rather than as a head: the eye WAS the head, so there
was no skull to hang a silhouette on. The fix is three separate shapes that
each do one job — a white dome that owns the outline, a NARROW horizontal visor
band sunk into its lower half, and a bright rim arc across the upper left. At
32 px the band is four rows tall and never touches the top of the dome, which
is what leaves room for a head to exist above the glass.
"""

HELM_R = 6.3      # dome radius: smaller than half the torso width, on purpose


def _dome(c, hx, hy, facing=0, visor=True, crack=0):
    """Domed helmet with a rim highlight and, optionally, a visor band."""
    c.ell(hx, hy, HELM_R, HELM_R - 0.2, HELMET)
    # Rim highlight: the upper-left arc, forced to the top of the ramp. The
    # shading pass would find some of this on its own; stating it explicitly
    # keeps it identical across every frame, which is what stops the head
    # flickering during a walk cycle.
    c.line([(hx - 4.6, hy - 3.4), (hx - 3.0, hy - 5.0), (hx - 0.6, hy - 5.8)],
           HELMET, bias=0.42)
    if visor:
        vx = hx + facing * 1.9
        # A band, not a blob: wide, four rows tall, sunk below the crown.
        c.rrect(vx - 4.2, hy - 0.6, vx + 4.2, hy + 3.0, 1, VISOR)
        # Glass has one hard specular corner and nothing else.
        c.rect(vx - 3.2, hy + 0.2, vx - 1.8, hy + 0.8, GLASSHI)
        if crack:
            c.line([(vx - 1, hy - 0.4), (vx + 1, hy + 1.4), (vx - 1, hy + 2.8)], DARK)
    else:
        # Back of the head: a seam and a small valve off to one side. A vent
        # block in the middle of the dome reads as a face, which is the last
        # thing a rear view needs.
        c.line([(hx - 3.0, hy + 2.0), (hx + 3.0, hy + 2.0)], STEEL)
        c.rect(hx + 2.0, hy - 0.4, hx + 3.0, hy + 0.6, STEEL)


def player_side(step, lean=0, arm=0, pump=1, hurt=0):
    """Facing right. `step` 0..3 is the walk phase.

    The trunk stops at row 22 and the legs run 22..27 under it, so there is a
    visible thigh between belt and boot. An earlier version had the torso reach
    row 25 and the boots start at 27, which left two pixels of leg and made the
    whole figure read as a box balanced on shoes."""
    c = Cel(ACTOR, ACTOR)
    bob = (0, -1, 0, -1)[step % 4]
    fwd = (3, 0, -3, 0)[step % 4]      # leading leg
    back = (-3, 0, 3, 0)[step % 4]
    y = bob + hurt
    L = lean

    # far leg first so the near one overlaps it
    c.rrect(11 + back + L, 21 + y, 14 + back + L, 27 + y, 1, SUITDK)
    c.rrect(10 + back + L, 26 + y, 16 + back + L, 30 + y, 1, BOOT, bias=-0.24)
    # Air tank: solid, and OVERLAPPING the trunk rather than beside it. Drawn
    # as a hollow rounded box with a dark stripe down it, the rim shading closed
    # the middle and it read as a handbag hooked over his shoulder.
    c.rrect(4 + L, 13 + y, 10 + L, 21 + y, 2, STEEL)
    c.rect(5 + L, 16 + y, 8 + L, 17 + y, DARK)
    # trunk: shoulders, then a slightly wider chest
    c.rrect(9 + L, 12 + y, 19 + L, 16 + y, 2, SUIT)
    c.rrect(8 + L, 15 + y, 20 + L, 22 + y, 2, SUIT)
    c.rect(8 + L, 20 + y, 20 + L, 21 + y, SUITDK)            # belt
    # near leg
    c.rrect(14 + fwd + L, 21 + y, 18 + fwd + L, 27 + y, 1, SUIT)
    c.rrect(13 + fwd + L, 26 + y, 19 + fwd + L, 30 + y, 1, BOOT)
    # collar, then the dome sunk into it
    c.rect(11 + L, 10 + y, 19 + L, 13 + y, STEEL)
    _dome(c, 15 + L, 7 + y, facing=1, crack=hurt)
    # arm + brass pump
    ax = 17 + L + arm
    c.rrect(ax, 15 + y, ax + 4, 18 + y, 1, SUIT)
    c.rrect(ax + 3, 15 + y, ax + 5, 18 + y, 1, BOOT)         # glove
    if pump:
        p0 = ax + 4
        c.rrect(p0, 14 + y, min(30, p0 + 6), 17 + y, 1, BRASS)
        c.rect(min(31, p0 + 6), 15 + y, min(31, p0 + 7), 16 + y, STEEL)
    return c


def _player_upright(step, back_view, rod):
    """Shared body for the two camera-facing poses.

    Everything below the neck is mirrored exactly, then the asymmetric props
    (visor, pump) are drawn on top — so the stance is provably symmetric and
    the character still has a handedness."""
    c = Cel(ACTOR, ACTOR)
    bob = (0, -1, 0, -1)[step % 4]
    sp = (4, 2, 4, 3)[step % 4]         # stance width
    y = bob
    c.rrect(16 - sp - 4, 21 + y, 16 - sp, 27 + y, 1, SUIT)   # thigh
    c.rrect(16 - sp - 5, 26 + y, 16 - sp + 1, 30 + y, 1, BOOT)
    c.rrect(10, 12 + y, 22, 16 + y, 2, SUIT)                 # shoulders
    c.rrect(9, 15 + y, 23, 22 + y, 2, SUIT)                  # chest
    c.rect(9, 20 + y, 23, 21 + y, SUITDK)                    # belt
    c.rect(9, 15 + y, 11, 17 + y, SUITDK)                    # shoulder pad
    c.rrect(6, 14 + y, 9, 19 + y, 1, SUIT)                   # arm
    c.rrect(6, 18 + y, 9, 21 + y, 1, BOOT)                   # glove
    if back_view:
        c.rrect(11, 13 + y, 21, 20 + y, 2, STEEL)            # air tank
        c.rect(13, 13 + y, 13, 19 + y, DARK)                 # strap
    c.rect(11, 10 + y, 21, 13 + y, STEEL)                    # collar
    c.symmetrise()
    if not back_view:
        # Chest lamp. The torso is a large flat field of one colour and needs
        # one focal point, or the eye has nothing to land on between the visor
        # and the belt.
        c.rect(15, 16 + y, 17, 18 + y, STEEL)
        c.px(15, 16 + y, GLASSHI)
    _dome(c, 16, 7 + y, facing=0, visor=not back_view)
    if rod is not None:
        # The pump, held vertically at his side, OUTSIDE the mirrored arm so it
        # is not buried by it, with a gripping hand at its midpoint. Without
        # the hand the rod floats next to the sprite and reads as a stray stick
        # rather than as something he is carrying.
        r0, r1 = rod
        c.rrect(24, r0 + y, 27, r1 + y, 1, BRASS)
        c.rect(24, max(r0 + y, r1 + y - 1), 27, min(31, r1 + y), STEEL)
        gm = (r0 + r1) // 2 + y
        c.rect(23, gm, 28, gm + 1, BOOT)      # two rows only: the rod must show
    return c


def player_front(step, rod=(16, 24)):
    return _player_upright(step, False, rod)


def player_back(step, rod=(16, 24)):
    return _player_upright(step, True, rod)


def player_death(i):
    c = Cel(ACTOR, ACTOR)
    if i == 0:
        return player_side(1, lean=-1, arm=-2)
    if i == 1:
        c = player_side(0, lean=-2, arm=-3, hurt=1)
        c.shift(0, 1)
        return c
    if i == 2:                              # tipping over
        c.rrect(15, 16, 27, 27, 3, SUIT)
        c.rect(15, 24, 27, 26, SUITDK)
        c.rrect(20, 27, 26, 30, 1, BOOT)
        c.rect(14, 17, 17, 24, STEEL)
        _dome(c, 10, 20, facing=1)
        return c
    if i == 3:                              # helmet parts company
        c.rrect(15, 22, 26, 30, 3, SUIT)
        c.rect(18, 12, 20, 14, STEEL)
        c.rect(24, 9, 25, 10, STEEL)
        _dome(c, 9, 24, facing=-1)
        return c
    if i == 4:
        c.ell(9, 27, 5.2, 4.0, HELMET)
        c.rrect(15, 26, 24, 30, 2, SUITDK)
        for (x, y) in ((13, 18), (20, 14), (26, 19), (17, 10), (24, 24)):
            c.rect(x, y, x + 1, y + 1, STEEL)
        return c
    c.ell(10, 28, 4.2, 2.8, HELMET)
    for (x, y) in ((18, 26), (22, 28), (25, 25), (15, 29)):
        c.px(x, y, STEEL)
    return c


def player_slump(f):
    """A downed digger with the air let out of the suit, at inflation `f`.

    0 is flat on the floor and 1 is pumped up round. One function draws both
    clips — going down plays it towards 0 and a rescue plays it back up — which
    is what makes them read as one suit losing and regaining air, and means the
    poses the clips share dedupe to the same pixels. Anchored to the floor, so
    it swells upward the way something lying on the ground has to. Facing right.

    A helmet cannot deflate, so while the suit is flat the dome has tipped off
    onto its side at the head end; once there is enough suit to sit on, it is
    back on top."""
    c = Cel(ACTOR, ACTOR)
    rx = 13.0 - 2.0 * f
    ry = 2.4 + 8.6 * f
    cy = 29.5 - ry
    if f > 0.35:
        c.rrect(16 - rx - 1, cy - 3, 16 - rx + 4, cy + 3, 2, STEEL)   # tank, behind
    c.ell(16, cy, rx, ry, SUIT)
    if ry > 4:
        by = cy + ry * 0.3
        c.rect(16 - rx + 2, by, 16 + rx - 2, by + 1, SUITDK)          # belt, stretched
    else:
        c.line([(6, cy), (11, cy + 1), (17, cy)], SUITDK)              # a crease in the fabric
    if f > 0.6:
        c.rrect(16 + rx - 2, cy - 1, 16 + rx + 2, cy + 2, 1, SUIT)     # arm, puffed out stiff
        c.rrect(16 + rx + 1, cy - 1, 16 + rx + 3, cy + 2, 1, BOOT)     # glove
    for bx in (10 * f, 1 + 16 * f):                                   # boots: out the end when
        c.rrect(bx, 27, bx + 4, 30, 1, BOOT)                          # flat, under the ball when round
    if f < 0.3:
        c.ell(25, 26, 4.8, 3.6, HELMET)
        c.rrect(23, 25, 29, 27.5, 1, VISOR)
    else:
        _dome(c, 16 + rx * 0.35, cy - ry + 1.5, facing=1)
    return c


def _buckle():
    c = player_side(1, lean=-1, arm=-2, hurt=1)
    c.shift(0, 2)
    return c


# Hit, knees go, then the suit sags to flat. The last four are player_slump()
# at the same inflations the rescue clip passes through, in reverse.
DOWN_POSES = (lambda: player_side(0, lean=-2, arm=-3, hurt=1), _buckle,
              lambda: player_slump(0.7), lambda: player_slump(0.45),
              lambda: player_slump(0.2), lambda: player_slump(0.0))
INFLATE_STEPS = (0.0, 0.2, 0.45, 0.7, 0.85, 1.0)


# ── pooka ─────────────────────────────────────────────────────────────────

def pooka_body(r, step=0, strain=0, mouthy=0):
    """Round red balloon monster with enormous yellow goggles.

    The goggles are the entire read at this size, so they are drawn large — but
    with a hard dark bridge between them and a clear gap either side of it. The
    first pass let two big discs touch and the pair fused into a figure of
    eight, which is a monster with one wide eye and not a monster with goggles."""
    c = Cel(ACTOR, ACTOR)
    cy = 17 - (r - 10.4) * 0.4
    squash = (1.0, 1.06, 1.0, 0.94)[step % 4]
    c.ell(16, cy, r * squash, r / squash, POOKA)

    # feet, in the goggle yellow so the palette stays tight
    fo = (3, 5, 3, 1)[step % 4]
    fy = cy + r / squash - 0.5
    c.ell(16 - fo - 1.5, fy, 2.8, 2.0, HORN, bias=-0.14)
    c.ell(16 + fo + 1.5, fy, 2.8, 2.0, HORN, bias=-0.14)

    # goggle strap, right across the head and off both sides
    c.rect(16 - r * squash, cy - 4.4, 16 + r * squash, cy - 1.4, PUPIL)
    gr = 4.4 + strain * 0.55
    sep = 5.8 + strain * 0.35
    for sx in (-1, 1):
        gx = 16 + sx * sep
        c.ell(gx, cy - 2.4, gr, gr, GOGGLE)
        c.ell(gx, cy - 2.4, gr * 0.92, gr * 0.92, GOGGLE, bias=0.30)   # bright lens
        c.ell(gx + sx * 0.8, cy - 2.2, gr * 0.46, gr * 0.46, PUPIL)
        c.rect(gx - 2.4, cy - 4.6, gx - 1.4, cy - 3.8, GLASSHI)
    # hard bridge, so the two lenses can never read as one shape
    c.rect(15, cy - 4.0, 17, cy - 0.8, PUPIL)

    if strain:
        # Strain seams on the FLANKS only. Drawn across the middle they landed
        # under the goggles and read as face paint, or as tears.
        for sx in (-1, 1):
            x = 16 + sx * (r * 0.72)
            c.line([(x, cy + 1.0), (x - sx * 1.0, cy + 3.0 + strain * 0.6)], PUPIL)
    if mouthy:
        c.ell(16, cy + 5.4, 2.6, 1.8, PUPIL)
        c.rect(15, cy + 4.6, 17, cy + 5.2, GOGGLE)      # bared teeth
    return c


def _burst(i, rng, body_mat, core_mat):
    """One shared four-frame burst, tinted per monster.

    Debris must stay CHUNKY as it fades. The first pass thinned it to single
    pixels by frame two and the pop simply vanished — at 32 px a one-pixel
    fragment at 60% alpha is not an effect, it is nothing."""
    c = Cel(ACTOR, ACTOR)
    n = (14, 12, 9, 6)[i]
    rad = (5.5, 10.0, 13.5, 15.5)[i]
    size = (2.2, 1.8, 1.4, 1.1)[i]
    for k in range(n):
        a = k / n * math.tau + i * 0.42
        rr = rad + float(rng.uniform(-1.4, 1.4))
        c.ell(16 + math.cos(a) * rr, 17 + math.sin(a) * rr, size, size, body_mat)
    if i == 0:
        c.ell(16, 17, 4.0, 4.0, core_mat)
    elif i == 1:
        for k in range(5):
            a = k / 5.0 * math.tau
            c.ell(16 + math.cos(a) * 4.5, 17 + math.sin(a) * 4.5, 1.4, 1.4, core_mat)
    c.alpha[:] = (1.0, 1.0, 0.82, 0.63)[i]
    return c


def pooka_pop(i, rng):
    return _burst(i, rng, POOKA, GOGGLE)


# ── fygar ─────────────────────────────────────────────────────────────────

def fygar_body(step=0, rear=0, inflate=0, mouth=0):
    """Facing right.

    Three things carry "dragon" at 32 px, and the first pass had none of them.

    A SNOUT that leaves the head outline — a muzzle that projects past the
    skull, with a jaw line under it, so the profile has a nose rather than a
    curve. A BELLY of genuinely contrasting value: pale yellow against mid
    green is the difference between a creature and a lump, and it wants to
    reach the underside of the silhouette, not float inside it. And a SPINE
    RIDGE of orange scutes running neck to tail, which does the most work of
    the three because it breaks the top of the outline into teeth and reads
    even when the sprite is two cells tall on a phone."""
    c = Cel(ACTOR, ACTOR)
    bob = (0, -1, 0, -1)[step % 4]
    y = bob - rear
    f = inflate

    # tail, sweeping up and back
    c.poly([(7, 21 + y), (0, 13 + y + (step % 2) * 2), (2, 17 + y), (7, 25 + y)],
           FYGAR, bias=-0.16)
    # hind leg, behind the body
    lo = (2, -1, -2, 1)[step % 4]
    c.rrect(6 + lo, 22 + y, 9 + lo, 27 + y, 1, FYGAR, bias=-0.18)
    c.rrect(5 + lo, 26 + y, 11 + lo, 29 + y, 1, HORN, bias=-0.18)

    # barrel body, sitting low
    c.ell(12, 20 + y, 8.2 + f, 5.4 + f * 0.8, FYGAR)
    # pale belly along the underside, a full value step from the green
    c.ell(12, 23.2 + y + f * 0.3, 6.4 + f * 0.5, 2.6 + f * 0.4, BELLY, bias=0.12)

    # SPINE RIDGE, drawn after the body so it is not swallowed by it, but with
    # each scute's base sunk a pixel INTO the back so it still reads as growing
    # out rather than sitting on. Kept to three pixels: tall spikes at this
    # size become a mohawk that eats the head.
    for sx, sy in ((17, 15), (14, 14), (11, 15), (8, 17)):
        c.poly([(sx - 2, sy + y + 1), (sx, sy + y - 3), (sx + 2, sy + y + 1)], HORN)

    # neck, head, then a muzzle that projects past the skull
    c.rrect(15, 14 + y, 21, 21 + y, 2, FYGAR)
    c.ell(22, 14 + y, 4.6, 4.2, FYGAR)
    c.rrect(25, 13 + y, 30, 16 + y, 1, FYGAR)                 # muzzle
    # Mouth. A closed one is a single dark line INSIDE the muzzle; an open one
    # drops a lower jaw beneath it. Painting the gape straight over the jaw and
    # out to the frame edge — which the first version did — put a black bar
    # through the snout on every inflate and wind-up frame.
    c.rect(26, 16 + y, 30, 16 + y, PUPIL)
    if mouth:
        c.rect(26, 16 + y, 30, 16 + y + mouth, PUPIL)
        c.rect(25, 17 + y + mouth, 30, 18 + y + mouth, BELLY, bias=0.12)
    else:
        c.rect(25, 17 + y, 29, 17 + y, BELLY, bias=0.12)      # jaw
    c.px(29, 14 + y, PUPIL)                                   # nostril
    # brow horns: a stubby pair off the back of the skull, not one long
    # antenna. Two short ones read as horns; one long one reads as an aerial.
    c.poly([(20, 12 + y), (18, 7 + y), (23, 11 + y)], HORN)
    c.poly([(22, 11 + y), (23, 8 + y), (25, 12 + y)], HORN)
    # eye: pale sclera, hard pupil, readable at one pixel of pupil
    c.ell(23.4, 13 + y, 2.0, 1.8, BELLY, bias=0.30)
    c.rect(24, 13 + y, 25, 14 + y, PUPIL)
    # fore leg, in front of the body
    fo = (-2, 1, 2, -1)[step % 4]
    c.rrect(15 + fo, 22 + y, 18 + fo, 27 + y, 1, FYGAR)
    c.rrect(14 + fo, 26 + y, 20 + fo, 29 + y, 1, HORN)
    return c


def fygar_jet(i, rng):
    """A horizontal flame band, drawn to be repeated left to right.

    Three concentric layers — dark orange envelope, orange body, pale core —
    each with its own wave, which is what makes it look like burning gas rather
    than a ribbon. The envelope is widest at the left (the mouth end) and
    tapers, so a row of these repeated reads as one jet with a direction."""
    c = Cel(ACTOR, ACTOR)
    n = free_noise(ACTOR, ACTOR, rng)
    for x in range(ACTOR):
        taper = 1.0 - 0.22 * (x / float(ACTOR - 1))
        outer = (6.6 + 1.9 * math.sin(x * 0.42 + i * 2.1) + n[0, x] * 1.6) * taper
        body = outer - 1.6 - 0.5 * math.sin(x * 0.63 - i * 1.7)
        core = body - 1.8 - 0.4 * math.sin(x * 0.9 + i * 2.4)
        c.rect(x, 16 - outer, x, 16 + outer, FLAME, bias=-0.30)
        if body > 0.6:
            c.rect(x, 16 - body, x, 16 + body, FLAME, bias=0.14)
        if core > 0.5:
            c.rect(x, 16 - core, x, 16 + core, FLAMEHI)
    return c


def ghost_of(base, i):
    """Turn any monster into its own ghost.

    The body goes uniformly pale and only the EYES survive in colour — the
    goggles for a pooka, the pupils for a fygar. Keeping the horns and feet in
    their solid orange, as the first version did, left half the creature
    looking corporeal and the effect read as a recolour rather than as a
    spirit. The silhouette is what identifies the kind; the palette is what
    says intangible."""
    c = Cel(ACTOR, ACTOR)
    m = base.mat > 0
    c.mat[m] = GHOSTM
    keep = (base.mat == PUPIL) | (base.mat == GOGGLE) | (base.mat == AMBER)
    c.mat[keep] = base.mat[keep]
    # A ghost still has to be able to look at you. The pale belly and the eye
    # sclera are the same material, so tell them apart by AREA rather than by
    # maintaining a second map: anything small is an eye and stays bright,
    # anything large is a belly and goes with the rest of the body.
    lbl, n = ndimage.label(base.mat == BELLY)
    for k in range(1, n + 1):
        sel = lbl == k
        if sel.sum() <= 20:
            c.mat[sel] = GLASSHI
    # ragged floating fringe: eat the bottom rows in a wave
    for x in range(ACTOR):
        cut = 3 + int(3.0 * (1 + math.sin(x * 0.7 + i * 1.6)))
        c.mat[ACTOR - cut:, x] = 0
    c.alpha[:] = 0.82
    return c


# ── the deeper five ───────────────────────────────────────────────────────
#
# These are not reskins. Each one hooks a mechanic that is INVISIBLE unless the
# silhouette says it out loud, so the shape is chosen from the rule:
#
#   grub    digs its own tunnels        -> the maw leads, and it is the widest
#                                          thing on the sprite
#   geode   immune to the harpoon       -> no soft surface anywhere; armour
#                                          plate and crystal, low and braced
#   mite    dies in one hit             -> tiny, leggy, and never fills the cell
#   sapper  explodes when killed        -> a bomb, unmistakably; lit fuse
#   warden  takes far more pumping      -> fills the frame edge to edge, flat
#                                          top, no neck. It reads as a wall.

def grub_body(step=0, rear=0):
    """Fat armoured cave grub, maw first. It is the only monster that carves,
    so the mouth is the biggest feature and it leads the silhouette."""
    c = Cel(ACTOR, ACTOR)
    ph = step * math.pi / 2

    # Body first, ALL of it, then the seams on top as one-pixel lines. The
    # first version drew a fat chitin ellipse per segment as it went, and each
    # new segment half-covered the last one's plate — the creature came out as
    # a dark smear with cream slivers in it rather than as a segmented grub.
    seg = []
    for i in range(5):
        x = 4.5 + i * 4.2
        yy = 20.0 + math.sin(ph + i * 0.85) * 1.4
        r = 4.0 + i * 0.55                  # tapers thicker toward the head
        seg.append((x, yy, r))
        c.ell(x, yy, r * 0.95, r, CREAM)
    for (x, yy, r) in seg[1:]:
        c.line([(x - r * 0.95, yy - r * 0.55), (x - r * 0.95, yy + r * 0.55)],
               CHITIN, bias=-0.12)

    # armoured head plate, overlapping the last segment
    hy = seg[-1][1] - rear
    c.ell(25.0, hy, 6.4, 6.4, CHITIN)
    c.ell(25.8, hy, 4.8, 4.8, CREAM)
    # round chewing maw, teeth turning frame to frame
    c.ell(26.6, hy, 3.0, 3.0, PUPIL)
    for k in range(7):
        a = k / 7.0 * math.tau + ph * 0.3
        c.px(26.6 + math.cos(a) * 2.4, hy + math.sin(a) * 2.4, CREAM)
    # stubby legs, alternating
    for i in range(3):
        x = 7 + i * 5
        c.rect(x, 24, x + 1, 26 + ((step + i) % 2), CHITIN)
    return c


def shark_body(step=0, inflate=0.0, strain=0, gape=0, rear=0):
    """Underground shark, nose right.

    `rear` lifts the whole animal off its swim line, the same way fygar_body's
    does, and exists for one reason: the Emberfin variant BREATHES, so the shark
    needs a wind-up pose. A fish cannot rear onto its hind legs, so the read is
    "rises and opens its mouth" rather than the lizard's "sits up" — which is
    also why the windup clip pairs it with `gape` rather than using it alone.

    It spends most of its life submerged, drawn through the ghost treatment, so
    the SILHOUETTE has to carry it: the dorsal fin and the forked tail are the
    two shapes that survive going pale and translucent, and both are drawn a
    size larger than a real animal's for exactly that reason.

    The swim is a travelling wave, not a wag. `step` shifts one phase along the
    body so the nose leads and the tail follows — a tail that swings while the
    head stays nailed down reads as a fish on a stick, which is what the first
    pass looked like."""
    c = Cel(ACTOR, ACTOR)
    ph = step * math.pi / 2
    fat = 1.0 + inflate * 0.16
    cy = 16.0 - rear
    # The tail sweeps and the nose barely moves. Chaining ellipses along a big
    # travelling wave was the first attempt and it came out as a lumpy blue
    # caterpillar: at 32px a body has to be ONE closed shape with a clean
    # outline, and the animation has to live in the parts that hang off it.
    sweep = math.sin(ph) * 3.2
    fin = math.sin(ph + 0.8) * 1.0

    # Tail, behind the body.
    c.poly([(9.0, cy), (2.5, cy - 5.4 + sweep), (6.0, cy + sweep * 0.4),
            (2.5, cy + 5.0 + sweep)], SHARKM, bias=-0.22)

    # Body: one polygon, mass forward, hard taper to the peduncle. Drawn from
    # the nose clockwise so the top line stays straight and the belly curves.
    hy = cy + math.sin(ph) * 0.5
    c.poly([
        (29.0, hy + 0.5),                      # nose
        (24.0, hy - 4.2 * fat),
        (17.0, hy - 6.2 * fat),
        (11.0, hy - 5.0 * fat),
        (8.5, hy - 2.6),                       # peduncle, top
        (8.5, hy + 2.6),                       # peduncle, bottom
        (12.0, hy + 5.6 * fat),
        (19.0, hy + 6.0 * fat),
        (26.0, hy + 3.4 * fat),
    ], SHARKM)

    # Counter-shading: a pale belly band low in the body, following the same
    # outline a little inside it. Thin, or it reads as a white blob.
    c.poly([
        (26.5, hy + 3.0 * fat), (19.0, hy + 5.4 * fat), (12.5, hy + 5.0 * fat),
        (10.0, hy + 2.4), (16.0, hy + 3.2), (23.0, hy + 1.8),
    ], SHARKPALE, bias=0.18)

    # Dorsal, oversized and SOLID, drawn after the body so its edge is clean.
    c.poly([(13.0, hy - 5.6 * fat), (16.0 + fin, hy - 12.4 * fat),
            (20.0, hy - 4.8 * fat)], SHARKM, bias=0.26)
    # Pectoral, swept back and down — two fins is what stops it reading as a bird.
    c.poly([(19.0, hy + 4.6), (14.0 - fin, hy + 10.2), (22.5, hy + 3.4)],
           SHARKM, bias=-0.34)

    # Face, and deliberately only three marks: eye, mouth, gills. Everything
    # else at this size turns the head into noise.
    c.ell(24.6, hy - 2.0, 1.3, 1.3, PUPIL)
    c.px(24.2, hy - 2.5, SHARKPALE, bias=0.5)
    mouth = 1.0 + gape * 1.8
    c.poly([(29.0, hy + 1.2), (23.0, hy + 2.2), (23.4, hy + 2.2 + mouth),
            (28.6, hy + 1.6 + mouth * 0.5)], PUPIL)
    for k in range(3):
        c.px(24.6 + k * 1.6, hy + 1.8, SHARKPALE, bias=0.45)
    for k in range(3):
        gx = 21.0 - k * 1.8
        c.line([(gx, hy - 2.6), (gx - 0.6, hy + 0.8)], SHARKM, bias=-0.44)

    if strain:
        for sx in (0, 1):
            x = 13.0 + sx * 5.0
            c.line([(x, hy - 5.0), (x - 1.0, hy - 7.2 - strain * 0.5)], PUPIL)
    return c


def mole_body(step=0, inflate=0.0, strain=0, dig=0):
    """Karst mole, snout right.

    Built nose-first, because everything that identifies a mole is at the front
    — the pink snout, the two spade paws — and the back half is just a sack of
    fur. The paws are drawn BELOW and AHEAD of the snout with a dark gap
    between the three, which is the whole lesson from the previous version: as
    three pale ellipses at the same value they merged into one lumpy mass and
    the animal read as a potato with a pig's nose on it."""
    c = Cel(ACTOR, ACTOR)
    bob = (0, 1, 0, -1)[step % 4]
    cy = 17.0 + bob * 0.5
    fat = 1.0 + inflate * 0.18

    # Body: ONE wedge, deepest at the shoulder and tapering back to a stub of a
    # tail. Two stacked circles were the first attempt and produced a coconut —
    # a mole is a torpedo that gets its bulk from the digging shoulders, so the
    # outline has to widen toward the FRONT and the back has to come to a point.
    c.poly([
        (23.0, cy - 5.6 * fat),                # shoulder, top
        (14.0, cy - 6.2 * fat),
        (7.0, cy - 3.6 * fat),
        (4.0, cy + 0.4),                       # rump
        (7.0, cy + 4.2 * fat),
        (15.0, cy + 6.0 * fat),
        (23.0, cy + 4.4 * fat),
    ], MOLEM)
    # Velvet. Short strokes ACROSS the body, because a mole's coat has no grain
    # front to back — it is the one animal that reverses into its own tunnel.
    for k in range(5):
        x = 8.0 + k * 3.2
        c.line([(x + 1.0, cy - 5.2), (x, cy - 2.6)], MOLEM, bias=0.28)
    c.ell(6.5, cy + 1.6, 3.0, 3.2, MOLEM, bias=-0.36)      # rump, in shadow

    # Snout: a SHORT blunt cone, and pink only at the very tip. The long even
    # tube the first version drew read as a piece of plumbing.
    sy = cy - 1.4
    c.poly([(21.0, sy - 3.4), (27.4, sy - 1.0), (27.4, sy + 1.4), (21.0, sy + 2.6)],
           MOLEPINK, bias=0.2)
    c.ell(27.4, sy + 0.2, 1.5, 1.8, MOLEPINK, bias=0.44)
    c.px(28.0, sy - 0.4, PUPIL)
    c.px(28.0, sy + 0.8, PUPIL)                            # two nostrils
    c.line([(26.4, sy - 1.6), (29.4, sy - 3.4)], PUPIL)    # whiskers
    c.line([(26.4, sy + 1.6), (29.4, sy + 3.2)], PUPIL)

    # A real eye, small and set back behind the snout.
    c.ell(21.6, cy - 3.4, 1.15, 1.15, PUPIL)
    c.px(21.2, cy - 3.8, CREAM, bias=0.4)

    # Spade paws: TWO of them, held forward under the chin, each a small blade
    # with three claws. Kept narrow and separated by a dark gap — as one wide
    # cream slab they read as a plank the mole was standing on.
    for i in range(2):
        px_ = 19.5 + i * 4.2
        py_ = cy + 5.0 + ((step + i) % 2) - dig * 1.6
        c.poly([(px_ - 2.2, py_ - 1.6), (px_ + 1.8, py_ - 2.0),
                (px_ + 2.4, py_ + 1.2), (px_ - 1.8, py_ + 1.6)], CREAM, bias=0.12)
        c.line([(px_ - 2.4, py_ - 2.0), (px_ + 2.0, py_ - 2.4)], MOLEM, bias=-0.5)
        for k in range(3):                  # claws, splayed forward and down
            cx_ = px_ + 0.2 + k * 1.0
            c.line([(cx_, py_ + 0.6), (cx_ + 1.0, py_ + 2.6)], CREAM, bias=0.45)

    if strain:
        for sx in (0, 1):
            x = 10.0 + sx * 5.0
            c.line([(x, cy - 6.0), (x - 0.8, cy - 8.0 - strain * 0.5)], PUPIL)
    return c


def geode_body(pulse=0, cracked=0):
    """Hunched crystal-shelled lump. Harpoon-immune, and it has to LOOK it:
    every surface is either armour plate or crystal, the stance is braced wide,
    and there is nothing soft to stick a barb into."""
    c = Cel(ACTOR, ACTOR)
    # braced base
    c.rrect(2, 21, 30, 30, 2, ROCK, bias=-0.34)
    # hunched shell
    c.poly([(3, 25), (6, 16), (13, 12), (22, 13), (28, 19), (29, 27)], ROCK)
    c.poly([(6, 16), (13, 12), (16, 20), (7, 22)], ROCK, bias=0.20)   # lit plate
    c.poly([(16, 20), (22, 13), (28, 19), (29, 26)], ROCK, bias=-0.26)
    # crystal spikes out of the back, brightest at the tips
    for (sx, sy, sh, sw) in ((9, 13, 8, 2.4), (14, 10, 10, 2.8),
                             (19, 12, 8, 2.4), (24, 16, 6, 2.0)):
        c.poly([(sx - sw, sy + 2), (sx, sy - sh + 2), (sx + sw, sy + 2)],
               VIOLET, bias=0.05 + pulse * 0.16)
        c.poly([(sx - sw * 0.4, sy + 2), (sx, sy - sh + 2), (sx + sw * 0.2, sy + 1)],
               VIOLET, bias=0.28 + pulse * 0.20)
    # two small bright eyes deep in a crevice
    c.rect(10, 22, 20, 25, PUPIL)
    c.rect(12, 23, 13, 24, AMBER)
    c.rect(17, 23, 18, 24, AMBER)
    if cracked:
        for k in range(cracked):
            x0 = 8 + k * 7
            c.line([(x0, 14), (x0 + 2, 20), (x0 - 1, 26)], ROCK, bias=-0.66)
    return c


def mite_body(step=0, squash=0):
    """Tiny six-legged swarm mite. It must never fill the cell — the whole read
    is "this one is nothing on its own", and that is a size statement before it
    is anything else."""
    c = Cel(ACTOR, ACTOR)
    ph = step * math.pi / 2
    cy = 21 + squash * 3
    ry = max(1.4, 3.6 - squash * 1.6)
    rx = 5.6 + squash * 2.0
    # legs first, three a side, skittering. Long enough to clear the body —
    # tucked under it they simply vanish and the mite reads as a pebble.
    for i in range(3):
        sw = math.sin(ph + i * 1.4)
        for sx in (-1, 1):
            x0 = 16 + sx * (1.0 + i * 2.0)
            c.line([(x0, cy - 1), (x0 + sx * 5.5, cy + 5 + sw * 1.8)], CHITIN)
    c.ell(16, cy, rx, ry, BOOT)
    c.ell(16, cy - ry * 0.35, rx * 0.72, ry * 0.5, BOOT, bias=0.26)  # carapace gloss
    if not squash:
        c.ell(21.5, cy, 3.0, 2.6, BOOT)                               # head
        # Four eyes, as two-pixel bars. Single pixels of amber on a dark blue
        # head are invisible at 32 px, and the eyes are the only thing that
        # says which end is the front.
        c.rect(21, cy - 2, 22, cy - 1, AMBER)
        c.rect(23, cy - 1, 24, cy, AMBER)
        c.rect(21, cy + 1, 22, cy + 1, AMBER)
        c.rect(23, cy + 1, 24, cy + 1, AMBER)
    return c


def sapper_body(fuse=3, glow=0):
    """A bomb with feet. The fuse shortens as it walks, which is the only
    warning the player gets that killing this one next to a seam pays."""
    c = Cel(ACTOR, ACTOR)
    # clawed feet, under the sphere
    for sx in (-1, 1):
        c.rrect(16 + sx * 7 - 2, 26, 16 + sx * 7 + 2, 29, 1, CHITIN)
    # iron sphere
    c.ell(16, 18, 9.4, 9.4, IRON, bias=glow * 0.20)
    # rivets around the rim
    for k in range(8):
        a = k / 8.0 * math.tau + 0.4
        c.px(16 + math.cos(a) * 7.4, 18 + math.sin(a) * 7.4, IRON, bias=0.34)
    # collar and fuse, burning down
    c.rect(14, 7, 18, 10, CHITIN)
    if fuse > 0:
        c.rect(15, 7 - fuse, 16, 8, CHITIN)
        c.ell(15.5, 6.5 - fuse, 1.6, 1.6, AMBER)
        c.px(15, 6 - fuse, SPARKM)
    # two hot eyes
    c.rect(11, 16, 13, 18, AMBER)
    c.rect(19, 16, 21, 18, AMBER)
    return c


def warden_body(step=0, strain=0, facing=1):
    """Heavy stone golem. It blocks a corridor, so it is drawn to fill one:
    edge to edge, flat topped, no neck, fists bigger than its head. If it did
    not read as a wall the player would try to walk past it."""
    c = Cel(ACTOR, ACTOR)
    sw = strain * 0.8
    lo = (1, 0, -1, 0)[step % 4]
    # legs, short and thick
    c.rrect(6 + lo, 24, 13 + lo, 30, 1, ROCK, bias=-0.24)
    c.rrect(18 - lo, 24, 25 - lo, 30, 1, ROCK, bias=-0.24)
    # slab torso, spanning the full width
    c.rrect(1 - sw, 10, 31 + sw, 26, 2, ROCK)
    c.rect(1 - sw, 10, 31 + sw, 14, ROCK, bias=0.22)      # lit shoulder plate
    c.rect(1 - sw, 22, 31 + sw, 26, ROCK, bias=-0.22)     # shadowed underside
    # head, sunk between the shoulders. No neck.
    c.rrect(11, 4, 21, 12, 1, ROCK)
    c.rect(11, 4, 21, 6, ROCK, bias=0.22)
    # Enormous fists. They are the same stone as the torso, so without a hard
    # dark seam against it they merge into the slab and the golem loses its
    # arms — which is most of what says "this thing hits you".
    c.rect(7, 16, 8, 26, ROCK, bias=-0.62)
    c.rect(24, 16, 25, 26, ROCK, bias=-0.62)
    c.rrect(0, 17, 7, 26, 1, ROCK, bias=0.14)
    c.rrect(25, 17, 31, 26, 1, ROCK, bias=-0.10)
    # amber cracks between the plates; they brighten as it strains
    b = 0.0 + strain * 0.10
    c.line([(4, 15), (9, 18), (7, 21)], AMBER, bias=b)
    c.line([(14, 15), (17, 19), (15, 23)], AMBER, bias=b)
    c.line([(23, 14), (26, 18), (24, 22)], AMBER, bias=b)
    if strain:
        c.line([(9, 25), (12, 28)], AMBER, bias=b)
        c.line([(20, 25), (23, 28)], AMBER, bias=b)
    # eyes, deep under the brow
    c.rect(12, 8, 14, 10, PUPIL)
    c.rect(18, 8, 20, 10, PUPIL)
    c.rect(12 + (1 if facing > 0 else 0), 8, 13 + (1 if facing > 0 else 0), 9, AMBER)
    c.rect(18 + (1 if facing > 0 else 0), 8, 19 + (1 if facing > 0 else 0), 9, AMBER)
    return c


def rubble(i, rng, mat):
    """Generic break-apart: chunky angular debris that keeps its mass as it
    fades. Shared by the warden and the geode, which both die by falling to
    bits rather than by popping."""
    c = Cel(ACTOR, ACTOR)
    n = (9, 7, 5, 4)[i]
    spread = (6.0, 10.0, 13.0, 15.0)[i]
    for k in range(n):
        a = k / float(n) * math.tau + i * 0.5
        x = 16 + math.cos(a) * spread
        y = 17 + math.sin(a) * spread * 0.9 + i * 1.2
        r = max(1.5, 4.2 - i * 0.7)
        c.poly([(x - r, y), (x, y - r), (x + r, y + r * 0.4), (x - r * 0.3, y + r)], mat)
    for k in range(7 - i):
        rr = float(rng.uniform(5, 15))
        a = float(rng.uniform(0, math.tau))
        c.ell(16 + math.cos(a) * rr, 17 + math.sin(a) * rr, 1.3, 1.1, DUSTM)
    c.alpha[:] = (1.0, 1.0, 0.82, 0.63)[i]
    return c


# ── silhouette tells ──────────────────────────────────────────────────────
#
# A tinted variant that differs only in HUE is a lie the player cannot read.
# At 32 px, on a phone, under a lamp mask, over dirt that is a different colour
# in each of five biomes, "the blue one is faster" fails as a teaching signal:
# the blue one reads as the red one in different light, and the stat difference
# arrives as an unexplained death. So every variant carries a SHAPE tell too.
#
# The tells are derived from the MATERIAL MASK rather than authored per frame,
# and that is the whole reason this is affordable. A crest anchored to "the
# topmost solid pixel in this column" rides the body through a walk cycle, an
# inflate and a death burst without any body function knowing a variant exists.
# Drawing the same crest by hand would be a hundred drawings per variant, and
# the first time anyone re-tuned a walk cycle they would all come loose.

def _mask_of(c, mats=None):
    if not mats:
        return c.mat > 0
    m = np.zeros(c.mat.shape, bool)
    for k in mats:
        m |= c.mat == k
    return m


def _bbox(m):
    ys, xs = np.nonzero(m)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def _frac_box(m, span):
    """A boolean box covering a fraction of a mask's bounding box."""
    x0, y0, x1, y1 = _bbox(m)
    (fx0, fx1), (fy0, fy1) = span
    box = np.zeros_like(m)
    bx0 = int(round(x0 + (x1 - x0) * fx0))
    bx1 = int(round(x0 + (x1 - x0) * fx1))
    by0 = int(round(y0 + (y1 - y0) * fy0))
    by1 = int(round(y0 + (y1 - y0) * fy1))
    box[by0:by1 + 1, bx0:bx1 + 1] = True
    return box


def tell_crest(c, tint, n=4, h=4, w=2, span=(0.18, 0.82), mats=None, bias=0.0):
    """Spikes standing off the TOP of the silhouette.

    Anchored per column to the topmost solid pixel, so the crest bobs with the
    body instead of floating over it — which is what a fixed offset would do,
    and it looks exactly like a decal."""
    m = _mask_of(c, mats)
    if not m.any():
        return c
    x0, _, x1, _ = _bbox(m)
    for k in range(n):
        f = span[0] + (span[1] - span[0]) * (k / float(max(1, n - 1)))
        x = int(round(x0 + (x1 - x0) * f))
        rows = np.nonzero(m[:, x])[0]
        if not len(rows):
            continue
        top = int(rows[0])
        c.poly([(x - w, top + 1), (x, top - h), (x + w, top + 1)], tint, bias)
    return c


def tell_shell(c, tint, thick=1, mats=None, span=None, bias=0.0):
    """Grow the silhouette by `thick` px and fill the new ring.

    The "heavier" tell: armour, a pressure shell, a thicker carapace. It works
    because the outline pass runs afterwards, so the ring becomes the new dark
    contour and the creature reads as bigger rather than as haloed. `span`
    restricts the ring to a fraction of the bounding box, which is how an
    asymmetric pauldron happens without an asymmetric drawing."""
    m = _mask_of(c, mats)
    if not m.any():
        return c
    ring = ndimage.binary_dilation(m, CROSS, iterations=thick, border_value=0) & ~m
    if span is not None:
        ring &= _frac_box(m, span)
    c.mat[ring] = tint
    c.bias[ring] = bias
    return c


def tell_studs(c, tint, n=6, r=0.80, size=1.0, phase=0.0, mats=None, bias=0.0):
    """Studs, vents or egg sacs around the perimeter.

    Each is found by walking a ray out from the mask centroid until it leaves
    the mask and then stepping back in by `r`, so they sit ON the body at the
    widest point in that direction. Placing them on a circle instead put half
    of them in mid-air on every non-round monster."""
    m = _mask_of(c, mats)
    if not m.any():
        return c
    ys, xs = np.nonzero(m)
    cx, cy = float(xs.mean()), float(ys.mean())
    for k in range(n):
        a = phase + k / float(n) * math.tau
        t = 0.0
        while t < 20.0:
            x = int(round(cx + math.cos(a) * (t + 1.0)))
            y = int(round(cy + math.sin(a) * (t + 1.0)))
            if not (0 <= x < c.w and 0 <= y < c.h and m[y, x]):
                break
            t += 1.0
        if t < 2.0:
            continue
        c.ell(cx + math.cos(a) * t * r, cy + math.sin(a) * t * r, size, size, tint, bias)
    return c


def tell_ram(c, tint, n=3, length=3, side=1, span=(0.0, 1.0), mats=None, bias=0.0):
    """Tusks or blades projecting from the LEADING edge.

    Applied before the mirror, so `side` always means "the way this pose is
    facing". `span` is the vertical slice of the body they come off — without
    it a fygar grows tusks out of its back feet."""
    m = _mask_of(c, mats)
    if not m.any():
        return c
    _, y0, _, y1 = _bbox(m)
    ya = y0 + (y1 - y0) * span[0]
    yb = y0 + (y1 - y0) * span[1]
    for k in range(n):
        y = int(round(ya + (yb - ya) * ((k + 0.5) / float(n))))
        if not (0 <= y < c.h):
            continue
        rr = np.nonzero(m[y])[0]
        if not len(rr):
            continue
        x = int(rr[-1] if side > 0 else rr[0])
        c.poly([(x, y - 1), (x + side * length, y), (x, y + 1)], tint, bias)
    return c


def tell_halo(c, tint, gap=3, mats=None, bias=0.0):
    """A dotted ring one pixel outside the silhouette: a shimmer, not a shell.

    Reads as "this one is not entirely here", which is exactly what a monster
    that walks through solid dirt needs to say before it does it."""
    m = _mask_of(c, mats)
    if not m.any():
        return c
    ring = ndimage.binary_dilation(m, CROSS, border_value=0) & ~m
    ys, xs = np.nonzero(ring)
    for i in range(len(xs)):
        if (int(xs[i]) * 2 + int(ys[i])) % gap == 0:
            c.mat[ys[i], xs[i]] = tint
            c.bias[ys[i], xs[i]] = bias
    return c


def tell_ribs(c, mats, tint, step=3, off=1):
    """Horizontal seams across a material. Pressure-suit ribbing."""
    m = _mask_of(c, mats)
    if not m.any():
        return c
    _, y0, _, y1 = _bbox(m)
    for y in range(y0 + off, y1 + 1, step):
        c.mat[y, m[y]] = tint
    return c


def tell_cage(c, mats, tint, step=3):
    """Vertical bars over a material — a grille across the visor."""
    m = _mask_of(c, mats)
    if not m.any():
        return c
    x0, _, x1, _ = _bbox(m)
    for x in range(x0, x1 + 1, step):
        c.mat[m[:, x], x] = tint
    return c


def tell_aerial(c, tint, tip=None, dx=6, h=4, mats=None):
    """A whip aerial leaning off the upper-RIGHT shoulder of a mask.

    Off the shoulder rather than off the crown, and that is forced rather than
    chosen: the player's helmet already sits on row 1 of a 32-row cell, so an
    aerial drawn upward from the top of the dome is either clipped away or —
    worse, which is what the first version did — drawn back down across the
    dome, where it reads as a scratch on the helmet instead of a mast. There
    is no room above the head. There are ten free pixels beside it."""
    m = _mask_of(c, mats)
    if not m.any():
        return c
    x0, y0, x1, y1 = _bbox(m)
    ay = min(c.h - 1, y0 + max(1, (y1 - y0) // 4))
    rr = np.nonzero(m[ay])[0]
    if not len(rr):
        return c
    ax = int(rr[-1])
    ty = max(1, ay - h)
    c.line([(ax, ay), (ax + dx, ty)], tint)
    if tip is not None:
        # A DIAMOND, not a pixel. render_cel outlines every edge pixel that is
        # not facing the light, and a lone pixel is nothing but edge — the lamp
        # on the end of the mast came out as a dark speck. Five pixels give the
        # centre one an interior to keep its colour.
        c.ell(ax + dx, ty, 1.2, 1.2, tip)
    return c


def tell_patch(c, mats, tint, span=((0.10, 0.55), (0.30, 0.62))):
    """A scavenged plate riveted over part of a material. Confined to the
    material it patches, so it never touches the silhouette — it is the
    texture half of a rig, and a shell or a bulge is the shape half."""
    m = _mask_of(c, mats)
    if not m.any():
        return c
    c.mat[_frac_box(m, span) & m] = tint
    return c


def seq(*fns):
    """Compose tells. A variant is allowed more than one, but not many more —
    two shape changes read as a different creature, four read as noise."""
    def go(c):
        for f in fns:
            f(c)
        return c
    return go


def retint(c, remap):
    """Re-resolve a material map through different ramps.

    Read from a SNAPSHOT of the map, so a remap may rotate materials around a
    cycle (a -> b, b -> a) without the second rule undoing the first."""
    if remap:
        src = c.mat.copy()
        for a, b in remap.items():
            c.mat[src == a] = b
    return c


# ── props, pickups, vfx ───────────────────────────────────────────────────

def rock_cel(rng, crack=0, split=0):
    """A boulder built from FACETS rather than from noise.

    Per-pixel noise on a rock reads as cottage cheese, which is what the first
    pass produced. A rock at 32 px wants a small number of flat planes, each a
    single ramp step, with the plane orientation deciding the step — so the
    noise here only perturbs which facet a pixel belongs to, never the shade
    directly."""
    c = Cel(ACTOR, ACTOR)
    # Few vertices and a wide radius swing: a boulder wants corners. Nine
    # near-equal vertices produced a smooth potato.
    nv = 7
    pts = []
    for k in range(nv):
        a = k / nv * math.tau + 0.3
        r = 12.2 + float(rng.uniform(-2.8, 2.2))
        pts.append((16 + math.cos(a) * r, 17 + math.sin(a) * r * 0.94))
    c.poly(pts, ROCK)
    m = c.mat == ROCK

    # Three or four flat planes cut by straight chords. Each plane gets one
    # constant bias, so it resolves to one flat colour.
    n = free_noise(ACTOR, ACTOR, rng, sigmas=(1.6,), weights=(1.0,))
    plane = np.zeros((ACTOR, ACTOR), np.float32)
    for k in range(3):
        ang = float(rng.uniform(0, math.pi))
        off = float(rng.uniform(-5, 5))
        yy, xx = np.mgrid[0:ACTOR, 0:ACTOR]
        side = ((xx - 16) * math.cos(ang) + (yy - 17) * math.sin(ang)) > off
        plane += side * float(rng.choice([-0.44, -0.22, 0.26, 0.46]))
    plane += (n - 0.5) * 0.14
    # Snap the plane bias to discrete steps so it cannot dither.
    plane = np.round(plane * 6.0) / 6.0
    c.bias[m] += plane[m]

    if crack:
        c.line([(16, 5), (14, 13), (18, 19), (15, 28)], ROCK, bias=-0.62)
        c.line([(16, 14), (24, 17)], ROCK, bias=-0.62)
    if split:
        c.erase(wrap_draw(ACTOR, ACTOR, lambda d, ox, oy:
                          d.polygon([(15 + ox, -2 + oy), (18 + ox, 14 + oy),
                                     (14 + ox, 20 + oy), (17 + ox, 34 + oy),
                                     (13 + ox, 34 + oy), (11 + ox, oy - 2)], fill=255)))
    return c


def rock_shatter(i, rng):
    if i == 0:
        return rock_cel(rng, crack=1)
    if i == 1:
        return rock_cel(rng, crack=1, split=1)
    c = Cel(ACTOR, ACTOR)
    nchunk = (8, 6, 5)[i - 2]
    spread = (7.5, 11.5, 14.5)[i - 2]
    for k in range(nchunk):
        a = k / nchunk * math.tau + i * 0.4
        x = 16 + math.cos(a) * spread
        y = 17 + math.sin(a) * spread * 0.9
        r = max(1.4, 3.8 - i * 0.6 + float(rng.uniform(-0.5, 0.5)))
        # angular chips, not pebbles
        c.poly([(x - r, y), (x, y - r), (x + r, y + r * 0.4), (x - r * 0.3, y + r)], ROCK)
    for k in range(8 - i):
        rr = float(rng.uniform(6, 15))
        a = float(rng.uniform(0, math.tau))
        c.ell(16 + math.cos(a) * rr, 17 + math.sin(a) * rr, 1.3, 1.1, DUSTM)
    c.alpha[:] = (1.0, 0.82, 0.63)[i - 2]
    return c


def bonus_cel():
    """The surface bonus: a cut ruby in a gold cradle.

    Facets are drawn as explicit polygons with explicit bias, not left to the
    shading pass — a cut stone is the one subject where the light has to come
    off flat planes at hard angles, and a rim-lit blob reads as a jelly."""
    c = Cel(ACTOR, ACTOR)
    # cradle
    c.rrect(8, 23, 24, 28, 2, GOLD)
    c.rect(8, 26, 24, 26, GOLD, bias=-0.45)
    c.rect(11, 28, 21, 29, GOLD, bias=-0.45)
    # crown, table and pavilion as three separate planes
    c.poly([(16, 4), (25, 12), (21, 23), (11, 23), (7, 12)], RUBY)            # body
    c.poly([(16, 4), (25, 12), (16, 15), (7, 12)], RUBY, bias=0.30)          # crown
    c.poly([(16, 15), (25, 12), (21, 23), (16, 23)], RUBY, bias=-0.34)       # right pavilion
    c.poly([(16, 15), (7, 12), (11, 23), (16, 23)], RUBY, bias=0.06)         # left pavilion
    c.line([(16, 4), (16, 15)], RUBY, bias=-0.20)
    c.rect(11, 8, 12, 9, GLASSHI)                                             # specular
    return c


def pickup_cel(kind, rng):
    c = Cel(TILE, TILE)
    if kind == 'ore':
        # A dark host rock with a few BIG nuggets, not a grey lump speckled
        # with single pixels — at 16 px a one-pixel fleck is invisible and the
        # whole pickup reads as another stone.
        c.poly([(1, 10), (3, 4), (9, 1), (14, 6), (13, 13), (5, 15)], ROCK, bias=-0.34)
        for (x, y, r) in ((5, 6, 2), (10, 9, 2), (7, 12, 1)):
            c.ell(x, y, r, r * 0.9, GOLD)
            c.px(x - 1, y - 1, GOLD, bias=0.5)
    elif kind == 'gem':
        c.poly([(8, 1), (14, 6), (8, 15), (2, 6)], EMER)
        c.poly([(8, 1), (8, 15), (2, 6)], EMER, bias=0.18)
        c.line([(8, 1), (5, 7), (8, 15)], EMER, bias=-0.3)
        c.px(5, 4, GLASSHI)
    elif kind == 'relic':
        c.ell(8, 9, 6.0, 6.0, BRASS)
        c.ell(8, 9, 4.0, 4.0, BELLY, bias=0.14)
        c.line([(8, 9), (8, 6)], DARK)
        c.line([(8, 9), (10, 10)], DARK)
        c.rect(7, 1, 9, 3, BRASS)
    else:
        # Crystal cluster: a centred main spire flanked by two shorter ones,
        # sitting on a dark matrix. The first version ran off the top of the
        # tile and had no base, so it read as a torn-off corner.
        c.rect(2, 13, 13, 15, ROCK, bias=-0.40)
        c.poly([(8, 1), (11, 7), (10, 14), (6, 14), (5, 7)], VIOLET)
        c.poly([(8, 1), (8, 14), (6, 14), (5, 7)], VIOLET, bias=0.24)
        c.poly([(4, 5), (6, 9), (5, 14), (2, 14)], VIOLET, bias=-0.16)
        c.poly([(12, 6), (13, 14), (10, 14), (10, 9)], VIOLET, bias=-0.16)
        c.px(7, 4, GLASSHI)
    return c


def relic_cel(rid, rng):
    """One tile per relic, and the SILHOUETTE is the whole job.

    A relic sits on the floor of a sealed chamber and the player decides whether
    to detour for it from across the level, so it has to be identifiable at 16
    source pixels from its outline alone — before the colour resolves, and long
    before any text could be read. That rules out the obvious approach of one
    shape in twelve tints.

    Each is therefore a different OBJECT, chosen so no two share a profile:
    round things, long things, wide things and pointed things are spread across
    the set rather than clustered. Barbed Head in particular gets the most
    aggressive outline in the game, because it is the one whose effect looks
    like a bug when it arrives unannounced — a harpoon that ignores terrain.
    """
    c = Cel(TILE, TILE)

    if rid == 'drill-bit':
        # A bit, point DOWN, with a visible flute. Long and narrow.
        c.poly([(8, 15), (5, 8), (11, 8)], STEEL, bias=0.16)
        c.rect(5, 3, 10, 8, STEEL)
        c.line([(6, 4), (10, 7)], STEEL, bias=-0.34)
        c.line([(6, 6), (10, 9)], STEEL, bias=-0.34)
        c.rect(4, 1, 11, 3, IRON, bias=-0.12)

    elif rid == 'long-lungs':
        # A round-shouldered flask with a narrow neck. The first version was a
        # straight-sided cylinder and read as a plank: without a WAIST at the
        # neck there is nothing to say "vessel" rather than "post".
        c.ell(8, 10, 5.4, 5.0, BRASS)
        c.ell(6.4, 8.6, 2.6, 2.6, BRASS, bias=0.34)     # shoulder highlight
        c.ell(10, 12, 2.4, 2.2, BRASS, bias=-0.38)      # underbelly shadow
        c.rect(6, 2, 9, 6, BRASS, bias=-0.1)            # neck
        c.rect(5, 0, 10, 2, IRON, bias=0.24)            # collar
        c.px(11, 1, IRON, bias=-0.3)                    # valve nub

    elif rid == 'still-air':
        # An hourglass. Nothing else in the set has a waist.
        c.poly([(3, 1), (13, 1), (9, 8), (13, 15), (3, 15), (7, 8)], GLASSHI, bias=0.1)
        c.poly([(4, 2), (12, 2), (8, 8)], CREAM, bias=0.2)     # the sand, upper
        c.poly([(8, 8), (12, 14), (4, 14)], CREAM, bias=-0.1)  # ...and settled
        c.rect(2, 0, 13, 1, BRASS)
        c.rect(2, 15, 13, 15, BRASS)

    elif rid == 'iron-skull':
        # A helm, not a skull: a dome with a hard brow and a dark eye slot. The
        # brow is what stops it reading as the Long Lungs bottle.
        # ROUND on top and OPEN at the bottom, or it is a chest.
        #
        # The straight-sided version shared a trapezoid-with-a-band silhouette
        # with Deep Pockets and read as a treasure chest. A helm is a dome that
        # is WIDER than it is tall, sitting above a dark gap, with the visor
        # slot cut right through the outline rather than painted on the front.
        c.ell(8, 8, 6.6, 5.2, IRON)
        c.ell(8, 6.4, 6.0, 3.4, IRON, bias=0.3)         # lit crown
        c.rect(1, 8, 14, 9, IRON, bias=-0.44)           # brow, hard and flat
        # The slot is the darkest thing on the tile AND it breaks the left and
        # right edges, so the dome reads as a helm in pure silhouette.
        c.rect(0, 10, 15, 12, PUPIL)
        c.rect(7, 10, 8, 12, IRON, bias=-0.05)          # nasal bar, splitting it
        c.poly([(2, 13), (13, 13), (11, 15), (4, 15)], IRON, bias=-0.3)   # cheek guards
        c.line([(8, 3), (8, 8)], IRON, bias=0.4)        # crest ridge

    elif rid == 'emberproof':
        # A COOL hide with a flame breaking its top edge.
        #
        # The first version was an orange flame inset on an orange pelt, so the
        # one identifying feature had nothing to sit against and the whole tile
        # read as an amorphous orange lump — and worse, as the same lump as
        # Deep Pockets two rows away. Two changes: the hide goes grey-brown so
        # the flame has contrast, and the flame RISES OFF the silhouette rather
        # than sitting inside it, so the shape is identifiable in outline alone.
        c.poly([(2, 6), (5, 4), (11, 4), (14, 6), (12, 15), (4, 15)], ROCK, bias=-0.22)
        c.poly([(4, 7), (6, 5), (10, 5), (12, 7), (11, 13), (5, 13)], ROCK, bias=0.14)
        c.px(4, 9, ROCK, bias=-0.4)          # a couple of dark nicks, so it reads
        c.px(11, 11, ROCK, bias=-0.4)        # as worked hide rather than as stone
        # The flame, clearing the top of the pelt.
        c.poly([(8, 0), (10, 3), (9, 6), (7, 6), (6, 3)], FLAME, bias=0.28)
        c.poly([(8, 1), (9, 4), (8, 6), (7, 4)], FLAMEHI, bias=0.5)

    elif rid == 'barbed-head':
        # THE loud one. A harpoon head: a long spear point with two swept barbs
        # and a socket. Nothing else in the set is this spiky or this vertical.
        c.poly([(8, 0), (12, 7), (8, 10), (4, 7)], STEEL, bias=0.22)
        c.poly([(8, 0), (8, 10), (4, 7)], STEEL, bias=-0.3)
        c.poly([(4, 6), (1, 11), (5, 9)], STEEL, bias=0.05)     # left barb
        c.poly([(12, 6), (15, 11), (11, 9)], STEEL, bias=-0.2)  # right barb
        c.rect(6, 10, 9, 15, BRASS)
        c.line([(6, 12), (9, 12)], BRASS, bias=-0.36)

    elif rid == 'wide-bore':
        # A wide collar seen face on: a thick ring with a big open middle. The
        # only piece in the set whose subject is a HOLE.
        # A BRIGHT ring around a black hole. Iron-on-dark left the bore invisible
        # against the chamber floor, so the tile read as a grey disc and shared
        # its outline with the loupe. Brass lifts the annulus well clear of the
        # background, and the ring is thinner so the hole dominates.
        c.ell(8, 8, 7.4, 6.8, BRASS, bias=-0.1)
        c.ell(8, 7.2, 7.0, 5.6, BRASS, bias=0.34)       # lit upper face
        # The hole goes on LAST and stays whole. An earlier version painted a
        # lit inner lip over the top of it, which filled it in — the one thing
        # this relic must not look like is a solid disc.
        c.ell(8, 8, 5.0, 4.4, PUPIL)
        c.ell(8, 6.6, 4.6, 1.6, DARK, bias=0.24)        # a little sky down the bore
        for x, y in ((1, 8), (15, 8), (8, 1), (8, 15)):
            c.px(x, y, IRON, bias=-0.2)                 # bolts, to read as machined

    elif rid == 'ore-lens':
        # A loupe: glass disc, bezel, and a handle going off to one corner. The
        # handle is what makes the circle read as an instrument.
        c.ell(6.5, 6.5, 5.6, 5.6, BRASS)
        c.ell(6.5, 6.5, 4.0, 4.0, GLASSHI, bias=0.24)
        c.line([(6.5, 4), (4.5, 7)], CREAM, bias=0.5)   # specular streak
        c.line([(10, 10), (15, 15)], BRASS, width=3)
        c.px(14, 14, GOLD, bias=0.3)

    elif rid == 'deep-pockets':
        # A satchel: wide trapezoid, a flap, and a buckle. Widest thing here.
        # A HANDLE over the body is what makes a trapezoid a bag. The first
        # version had two vertical ticks in the same colour as the leather and
        # read as a crate — and being orange, as the same object as Emberproof.
        # Now: dark leather, a closed loop above the top edge, and a buckle.
        c.line([(4, 5), (5, 2)], CHITIN, bias=0.1)
        c.line([(5, 2), (11, 2)], CHITIN, bias=0.24)    # the handle, over the top
        c.line([(11, 2), (12, 5)], CHITIN, bias=-0.1)
        c.poly([(1, 7), (15, 7), (13, 15), (3, 15)], HORN, bias=-0.24)
        c.poly([(1, 6), (15, 6), (14, 10), (2, 10)], HORN, bias=0.2)   # the flap
        c.line([(2, 10), (14, 10)], CHITIN, bias=-0.2)  # flap edge, a hard line
        c.rect(7, 9, 9, 12, CHITIN, bias=-0.1)          # strap down the front
        c.px(8, 10, GOLD, bias=0.45)                    # buckle

    elif rid == 'quick-hands':
        # A gauntlet: a cuff and three stubby fingers. Reads as a hand at 16px
        # only because the fingers break the top edge unevenly.
        # STEEL, not chitin, and fingers thick enough to survive.
        #
        # The first version was a dark violet glove on a dark chamber floor with
        # 1px fingers, which at 16px is a featureless blob. Two-pixel fingers
        # with a one-pixel gap give the top edge a real comb profile — the comb
        # IS the read — and steel puts it in the same material family as the
        # other equipment relics instead of hiding.
        c.rrect(3, 7, 12, 15, 2, STEEL)
        c.rect(3, 3, 4, 8, STEEL, bias=0.2)
        c.rect(6, 1, 7, 8, STEEL, bias=0.3)             # middle finger, tallest
        c.rect(9, 3, 10, 8, STEEL, bias=0.14)
        c.rect(12, 6, 13, 9, STEEL, bias=-0.16)         # thumb, off to the side
        c.rect(2, 11, 13, 12, BRASS)                    # cuff band
        c.px(8, 11, GOLD, bias=0.45)
        c.line([(4, 13), (11, 13)], STEEL, bias=-0.34)  # knuckle shadow

    elif rid == 'feather-step':
        # A single feather on the diagonal — the only diagonal subject in the
        # set, which is what separates it at a glance from the drill bit.
        # A feather needs a VANE, not just a shaft with ticks on it. The first
        # version was a bare diagonal line and read as a stick. Two filled
        # polygons either side of the quill, the lit one wider, then the quill
        # drawn back over the top so it still separates them.
        # The two vanes have to be far apart in VALUE or they fuse into one
        # slab and the whole thing reads as a rolled scroll, which is what the
        # first version did. Lit vane near-white, shadow vane pushed right down,
        # and the lower edge NOTCHED — stepped indents survive at 16px where
        # the single-pixel split barbs they replace were invisible.
        c.poly([(12, 3), (13, 7), (10, 10), (8, 12), (6, 12), (5, 11)], CREAM, bias=0.46)
        c.poly([(12, 3), (10, 2), (4, 9), (5, 11)], CREAM, bias=-0.44)
        for k in range(3):                              # notches out of the lit edge
            c.px(11 - k * 2, 8 + k, DARK, bias=-0.3)
            c.px(10 - k * 2, 9 + k, DARK, bias=-0.3)
        c.line([(13, 2), (4, 13)], CREAM, bias=0.5)     # the quill, over both vanes
        c.px(13, 2, GLASSHI, bias=0.5)

    else:  # stone-sense
        # A tuning fork over a dish: two tines and a stem, with a ripple.
        c.rect(4, 1, 5, 8, STEEL, bias=0.2)
        c.rect(10, 1, 11, 8, STEEL, bias=-0.2)
        c.rect(4, 8, 11, 10, STEEL)
        c.rect(7, 10, 8, 14, STEEL, bias=0.1)
        c.ell(8, 14, 6.0, 1.8, ROCK, bias=-0.3)
        c.px(2, 3, SPARKM, bias=0.5)
        c.px(13, 3, SPARKM, bias=0.5)

    return c


def vfx_clod(i, rng):
    """Dirt thrown by a dig. Clods stay chunky and gain gravity as they fade —
    the last frame drifts DOWN rather than just going transparent, which is the
    difference between debris landing and debris evaporating."""
    c = Cel(TILE, TILE)
    n = (5, 6, 5, 4, 3)[i]
    spread = 2.6 + i * 2.1
    for k in range(n):
        a = k / float(n) * math.tau + i * 0.5
        x = 8 + math.cos(a) * spread
        y = 8 + math.sin(a) * spread * 0.8 + i * i * 0.45
        r = max(1.0, 2.4 - i * 0.28)
        c.ell(x, y, r, r * 0.9, CLODM)
    if i < 2:
        # A ring of blobs with nothing in the middle reads as a smoke donut,
        # not as a spray of dirt. The early frames get a core.
        c.ell(8, 8 + i, 2.6 - i * 0.5, 2.3 - i * 0.5, CLODM)
    c.alpha[:] = (1.0, 1.0, 1.0, 0.82, 0.63)[i]
    return c


def vfx_spark(i, rng):
    """Treasure sparkle: a four-point star that blooms and thins. A star, not a
    dot cloud — the shape is the whole signal that this is a REWARD and not
    another kind of debris."""
    c = Cel(TILE, TILE)
    ln = (2.5, 5.0, 7.0, 7.5, 7.5)[i]
    th = (2.0, 1.8, 1.5, 1.2, 1.0)[i]

    def star(length, thick, phase):
        for k in range(4):
            a = k / 4.0 * math.tau + phase
            dx, dy = math.cos(a), math.sin(a)
            c.poly([(8 + dx * length, 8 + dy * length),
                    (8 - dy * thick, 8 + dx * thick),
                    (8 + dy * thick, 8 - dx * thick)], SPARKM)

    star(ln, th, 0.0)
    # A second star at 45 degrees and half the reach: four blunt arms alone
    # read as a plus sign, and eight of unequal length read as a twinkle.
    star(ln * 0.5, max(1.0, th * 0.7), math.pi / 4)
    if i < 2:
        c.ell(8, 8, 2.2 - i * 0.7, 2.2 - i * 0.7, SPARKM)
    c.alpha[:] = (1.0, 1.0, 1.0, 0.82, 0.38)[i]
    return c


def vfx_dust(i, rng):
    """A settling puff: a FILLED cloud that expands and sinks. The first pass
    put the blobs on a circle and it read as a smoke ring."""
    c = Cel(ACTOR, ACTOR)
    r = 3.0 + i * 2.8
    for k in range(9):
        a = k / 9.0 * math.tau + i * 0.33
        rad = r * (0.35 if k % 3 == 0 else 1.0)
        rr = max(1.6, 5.4 - i * 0.55)
        c.ell(16 + math.cos(a) * rad, 17 + math.sin(a) * rad * 0.62 + i * 1.4,
              rr, rr * 0.82, DUSTM)
    c.ell(16, 17 + i * 1.4, max(2.0, 5.0 - i * 0.6), max(1.6, 4.0 - i * 0.5), DUSTM)
    c.alpha[:] = (0.82, 1.0, 0.82, 0.63, 0.38)[i]
    return c


def vfx_ring(i, rng):
    """Shockwave: a thick bright wall that expands and thins to one pixel. Two
    tones, so the ring has a leading edge rather than being a drawn circle."""
    c = Cel(ACTOR, ACTOR)
    r = 4.5 + i * 3.1
    th = max(1.0, 2.6 - i * 0.4)
    c.ell(16, 16, r, r * 0.82, FLAMEHI)
    c.ell(16, 16, r - th * 0.45, (r - th * 0.45) * 0.82, SPARKM)
    inner = wrap_draw(ACTOR, ACTOR, lambda d, ox, oy:
                      d.ellipse([16 - (r - th) + ox, 16 - (r - th) * 0.82 + oy,
                                 16 + (r - th) + ox, 16 + (r - th) * 0.82 + oy], fill=255))
    c.erase(inner)
    c.alpha[:] = (0.82, 1.0, 0.82, 0.63, 0.38)[i]
    return c


# ── the cast, as tables ───────────────────────────────────────────────────
#
# Everything animated — the player, seven monster kinds, every tinted variant
# and every bought skin — is registered by walking ONE structure per family.
# That is the rule that makes variants safe: a variant physically cannot own a
# clip its base kind does not have, cannot name a frame the packer did not
# place, and cannot be forgotten when a clip is added, because there is no
# second list anywhere for it to fall out of.

class Fr:
    """One frame of one clip.

    `fn(rng) -> Cel` draws the pose. `mir` mirrors it on the way out, so the
    tells run on the RIGHT-facing pose and a leading-edge tusk stays on the
    leading edge. `kw` is passed through to render_cel (flames want
    outline=False)."""

    __slots__ = ('name', 'fn', 'mir', 'kw')

    def __init__(self, name, fn, mir=False, **kw):
        self.name, self.fn, self.mir, self.kw = name, fn, mir, kw


def _clip(clip, fps, loop=True, frames=(), body=True, variant=True):
    """`body` false for debris and flame: a crest on a death burst or on a jet
    of fire is nonsense, so those frames take the retint and no tell.

    `variant` false for the ghost clips. A ghost is deliberately uniform pale —
    the silhouette says which kind it is and the palette says intangible — so a
    tinted ghost would be saying the variant is still colour-coded after it has
    stopped being solid, which is the opposite of what the effect means. Seven
    kinds' worth of ghost frames stay out of the sheet for free."""
    return dict(clip=clip, fps=fps, loop=loop, frames=list(frames),
                body=body, variant=variant)


def kind_clips(kind):
    """Every clip of one monster kind, in one list."""
    C = []

    def walk(fn, fps):
        C.append(_clip('walk.R', fps, True,
                       [Fr('walk.R%d' % i, (lambda i: lambda g: fn(i))(i))
                        for i in range(4)]))
        C.append(_clip('walk.L', fps, True,
                       [Fr('walk.L%d' % i, (lambda i: lambda g: fn(i))(i), mir=True)
                        for i in range(4)]))

    def ghost(fn):
        C.append(_clip('ghost', 6, True,
                       [Fr('ghost%d' % i, (lambda i: lambda g: ghost_of(fn(i), i))(i))
                        for i in range(4)], variant=False))

    def windup(fn, n=3):
        """The pose a firebreather holds while it winds up, BOTH ways round.

        It used to be a single non-directional clip, and anim.js selects it with
        no direction — so a Fygar breathing west turned to face east for the
        whole wind-up and then breathed backwards past its own tail. Nothing
        mirrors at blit time (every directional row on this sheet is drawn
        twice), so the fix is a mirrored row, exactly as walk() does it.

        loop=False is load-bearing: anim.js holds the final frame for as long as
        the fire is alight, so this clip IS the breathing pose and not just the
        approach to it. Frame 0 is the neutral body, so it content-hashes onto
        walk.R0/walk.L0 and costs nothing."""
        C.append(_clip('windup.R', 8, False,
                       [Fr('windup.R%d' % i, (lambda i: lambda g: fn(i))(i))
                        for i in range(n)]))
        C.append(_clip('windup.L', 8, False,
                       [Fr('windup.L%d' % i, (lambda i: lambda g: fn(i))(i), mir=True)
                        for i in range(n)]))

    if kind == 'pooka':
        walk(lambda i: pooka_body(10.4, i), 9)
        C.append(_clip('inflate', 6, False, [
            Fr('inflate%d' % (s + 1),
               (lambda s: lambda g: pooka_body(10.4 + s * 1.5, 0, strain=s,
                                               mouthy=1 if s > 1 else 0))(s))
            for s in range(4)]))
        C.append(_clip('pop', 14, False, [
            Fr('pop%d' % i, (lambda i: lambda g: pooka_pop(i, g))(i))
            for i in range(4)], body=False))
        ghost(lambda i: pooka_body(10.4, i))

    elif kind == 'fygar':
        walk(lambda i: fygar_body(i), 9)
        windup(lambda i: fygar_body(0, rear=i, mouth=i))
        # No 'jet' clip. fygar_jet() draws a band of flame to be repeated along
        # a corridor, and nothing repeats it: entities.drawFire() builds the jet
        # procedurally, so it can grow with FIRE_GROW, taper, and flicker
        # against the live length. The frames survived only as something for
        # anim.js to mistake for a pose — it selected them as the Fygar's own
        # sprite while breathing, and the monster turned into a tile of fire.
        # Dead art that looks live is worse than no art; see fygar_jet's note.
        C.append(_clip('inflate', 6, False, [
            Fr('inflate%d' % (s + 1),
               (lambda s: lambda g: fygar_body(0, inflate=s * 1.4, mouth=1))(s))
            for s in range(4)]))
        C.append(_clip('pop', 14, False, [
            Fr('pop%d' % i,
               (lambda i: lambda g: retint(pooka_pop(i, g),
                                           {POOKA: FYGAR, GOGGLE: BELLY}))(i))
            for i in range(4)], body=False))
        ghost(lambda i: fygar_body(i))

    elif kind == 'grub':
        walk(lambda i: grub_body(i), 10)
        C.append(_clip('lunge', 12, False, [
            Fr('lunge%d' % i, (lambda i: lambda g: grub_body(i, rear=(0, 2, 3)[i]))(i))
            for i in range(3)]))
        C.append(_clip('pop', 14, False, [
            Fr('pop%d' % i, (lambda i: lambda g: _burst(i, g, CREAM, CHITIN))(i))
            for i in range(4)], body=False))
        ghost(lambda i: grub_body(i))

    elif kind == 'geode':
        C.append(_clip('idle', 4, True, [
            Fr('idle%d' % i, (lambda i: lambda g: geode_body(pulse=(0, 1, 2, 1)[i]))(i))
            for i in range(4)]))
        C.append(_clip('crack', 10, False, [
            Fr('crack%d' % i, (lambda i: lambda g: geode_body(pulse=2, cracked=i + 1))(i))
            for i in range(3)]))
        C.append(_clip('shatter', 14, False, [
            Fr('shatter%d' % i, (lambda i: lambda g: rubble(i, g, VIOLET))(i))
            for i in range(4)], body=False))

    elif kind == 'mite':
        walk(lambda i: mite_body(i), 16)
        C.append(_clip('squash', 16, False, [
            Fr('squash%d' % i, (lambda i: lambda g: mite_body(0, squash=i + 1))(i))
            for i in range(2)]))
        ghost(lambda i: mite_body(i))

    elif kind == 'sapper':
        walk(lambda i: sapper_body(fuse=3 - (i * 3) // 4), 8)
        C.append(_clip('prime', 8, False, [
            Fr('prime%d' % i,
               (lambda i: lambda g: sapper_body(fuse=max(0, 2 - i), glow=i))(i))
            for i in range(3)]))
        C.append(_clip('boom', 16, False, [
            Fr('boom%d' % i,
               (lambda i: lambda g: _burst(min(3, i), g, FLAME, FLAMEHI))(i),
               outline=False)
            for i in range(4)], body=False))
        ghost(lambda i: sapper_body(3))

    elif kind == 'warden':
        walk(lambda i: warden_body(i, facing=1), 5)
        C.append(_clip('inflate', 6, False, [
            Fr('inflate%d' % (s + 1),
               (lambda s: lambda g: warden_body(0, strain=s + 1))(s))
            for s in range(4)]))
        C.append(_clip('break', 12, False, [
            Fr('break%d' % i, (lambda i: lambda g: rubble(i, g, ROCK))(i))
            for i in range(4)], body=False))
        ghost(lambda i: warden_body(i))

    elif kind == 'shark':
        # Faster than a walker's nine: it swims, and a swim that ticks at
        # walking speed reads as a fish being dragged.
        walk(lambda i: shark_body(i), 12)
        C.append(_clip('inflate', 6, False, [
            Fr('inflate%d' % (s + 1),
               (lambda s: lambda g: shark_body(0, inflate=s * 1.2, strain=s, gape=1))(s))
            for s in range(4)]))
        C.append(_clip('pop', 14, False, [
            Fr('pop%d' % i, (lambda i: lambda g: _burst(i, g, SHARKM, SHARKPALE))(i))
            for i in range(4)], body=False))
        # The Emberfin variant breathes, so the shark needs the firebreather's
        # wind-up. It rises and gapes rather than rearing — see shark_body.
        windup(lambda i: shark_body(0, rear=i, gape=i))
        # The ghost clip matters more here than for any other kind: submerged is
        # a Shark's RESTING state, so this is the silhouette the player sees it
        # in most of the time.
        ghost(lambda i: shark_body(i))

    elif kind == 'mole':
        walk(lambda i: mole_body(i), 8)
        C.append(_clip('dig', 10, True, [
            Fr('dig%d' % i, (lambda i: lambda g: mole_body(i, dig=(0, 1, 2, 1)[i]))(i))
            for i in range(4)]))
        C.append(_clip('inflate', 6, False, [
            Fr('inflate%d' % (s + 1),
               (lambda s: lambda g: mole_body(0, inflate=s * 1.2, strain=s))(s))
            for s in range(4)]))
        C.append(_clip('pop', 14, False, [
            Fr('pop%d' % i, (lambda i: lambda g: _burst(i, g, MOLEM, CREAM))(i))
            for i in range(4)], body=False))
        ghost(lambda i: mole_body(i))

    else:
        raise SystemExit('no clip table for kind ' + kind)
    return C


KINDS = ('pooka', 'fygar', 'grub', 'geode', 'mite', 'sapper', 'warden',
         'shark', 'mole')


def _V(vid, swatch, remap, tell=None, note=''):
    return dict(id=vid, swatch=swatch, remap=remap, tell=tell, note=note)


# Every variant is built out of ramps the sheet ALREADY HAS, and that is a hard
# constraint rather than a stylistic preference. The sheet quantises to 255
# colours because an indexed PNG cannot hold more, and it was already merging
# 320 authored colours down to 255 before any of this landed. A dozen new base
# hues would push the greedy merge into ramps that are currently exact, and the
# damage would land somewhere far away from the thing that caused it. Building
# variants from POOKA's red, BOOT's blue, GHOSTM's ice and so on costs ZERO new
# palette entries — and it is the reason a blue Pooka still looks like it comes
# from the same game as everything around it.
#
# The `note` is the stat the shape is promising. monsters.js owns whether that
# promise is kept; this file owns making the promise legible.
MONSTER_VARIANTS = {
    'pooka': [
        _V('azure', VISOR, {POOKA: VISOR, HORN: GOGGLE},
           lambda c: tell_crest(c, GOGGLE, n=3, h=4, w=2, span=(0.26, 0.74)),
           'blue and finned — the fast one, and the player asked for it by name'),
        _V('basalt', ROCK, {POOKA: ROCK},
           lambda c: tell_shell(c, CHITIN, 1, mats=(ROCK,)),
           'stone-crusted — slower, and takes half again as much pumping'),
        _V('wraith', VIOLET, {POOKA: VIOLET, GOGGLE: EMER},
           lambda c: tell_halo(c, GHOSTM, gap=3),
           'violet, shimmering at the edge — phases twice as often'),
    ],
    'fygar': [
        _V('ember', POOKA, {FYGAR: POOKA, HORN: BRASS, BELLY: HORN},
           lambda c: tell_ram(c, BRASS, n=3, length=3, span=(0.06, 0.52)),
           'red, with a bladed snout — tunnels through dirt, also by request'),
        _V('smoulder', HORN, {FYGAR: HORN, BELLY: GOGGLE, HORN: RUBY},
           lambda c: tell_crest(c, RUBY, n=5, h=3, w=1, span=(0.10, 0.70)),
           'orange, low red frill — quick, and its breath is a short one'),
        _V('slag', CLODM, {FYGAR: CLODM, BELLY: DUSTM, HORN: IRON},
           lambda c: tell_shell(c, ROCK, 1, mats=(CLODM,)),
           'crusted dark brown — shrugs off a blast, and takes some pumping'),
    ],
    'mite': [
        _V('hardshell', EMER, {BOOT: EMER, AMBER: RUBY},
           lambda c: tell_shell(c, STEEL, 1, mats=(EMER,)),
           'a shelled Mite — the one that does not die in a single pump'),
        _V('ashling', VIOLET, {BOOT: VIOLET, AMBER: GLASSHI},
           lambda c: tell_halo(c, GHOSTM, gap=3),
           'pale violet and shimmering — it goes through the wall at you'),
    ],
    'sapper': [
        _V('creeper', RUBY, {IRON: RUBY, CHITIN: IRON, AMBER: SPARKM},
           lambda c: tell_crest(c, IRON, n=4, h=4, w=1, span=(0.14, 0.86)),
           'finned and red, fuse already short — fast and cheap to kill'),
        # AMBER -> RUBY matters more than it looks. The base Sapper's face is
        # two hot amber eyes on dark iron; on a gold casing amber is the same
        # value as the sphere and the bomb goes blank.
        _V('primed', GOLD, {IRON: GOLD, CHITIN: IRON, AMBER: RUBY},
           seq(lambda c: tell_shell(c, IRON, 1, mats=(GOLD,)),
               lambda c: tell_studs(c, IRON, n=8, r=0.90, size=1.2)),
           'a bigger gold bomb — half again the crater'),
        _V('deepcharge', POOKA, {IRON: POOKA, CHITIN: DARK, AMBER: SPARKM},
           seq(lambda c: tell_shell(c, IRON, 1, mats=(POOKA,)),
               lambda c: tell_studs(c, IRON, n=10, r=0.92, size=1.4)),
           'banded and slow — the widest crater in the game'),
    ],
    'warden': [
        _V('ironclad', STEEL, {ROCK: STEEL, AMBER: BOOT},
           lambda c: tell_studs(c, IRON, n=8, r=0.90, size=1.3),
           'riveted steel plate — slower, and harder again to pump out'),
        _V('quarryman', BRASS, {ROCK: BRASS, AMBER: IRON},
           lambda c: tell_ram(c, IRON, n=3, length=3, span=(0.25, 0.85)),
           'brass with breaker blades — this wall walks, and it digs'),
        _V('sentinel', VIOLET, {ROCK: VIOLET, AMBER: GHOSTM},
           seq(lambda c: tell_crest(c, GHOSTM, n=5, h=4, w=2, span=(0.10, 0.90)),
               lambda c: tell_halo(c, GHOSTM, gap=4)),
           'violet, crested, shimmering — the Warden that stopped staying put'),
    ],
    'geode': [
        _V('thunderegg', GOLD, {ROCK: CHITIN, VIOLET: GOLD, AMBER: FLAMEHI},
           lambda c: tell_studs(c, FLAME, n=7, r=0.86, size=1.2),
           'black shell, gold crystal, hot vents — the rock that opens it craters'),
        _V('druse', GHOSTM, {ROCK: STEEL, VIOLET: GHOSTM, AMBER: GOGGLE},
           lambda c: tell_crest(c, GHOSTM, n=4, h=6, w=2, span=(0.20, 0.80)),
           'pale quartz, taller spikes — a blast gets through this one'),
    ],
    'grub': [
        _V('borer', HORN, {CREAM: HORN, CHITIN: IRON},
           seq(lambda c: tell_crest(c, IRON, n=5, h=3, w=1, span=(0.06, 0.60)),
               lambda c: tell_ram(c, IRON, n=3, length=2, span=(0.20, 0.72))),
           'orange, ridged like a bore head — nearly twice the pace'),
        _V('nacre', GHOSTM, {CREAM: GHOSTM, CHITIN: VIOLET},
           lambda c: tell_shell(c, VIOLET, 1, mats=(GHOSTM,)),
           'pearl-shelled — slow, and it soaks up pumps'),
    ],
    # Six variants that spent this whole session drawing as their base kind,
    # because neither kind was in KINDS at all.
    'shark': [
        _V('sandskimmer', GOGGLE, {SHARKM: GOGGLE, SHARKPALE: CREAM},
           lambda c: tell_crest(c, BRASS, n=4, h=2, w=1, span=(0.20, 0.62)),
           'pale sand-yellow, low ridged back — quick, and it bursts easily'),
        _V('hammerhead', IRON, {SHARKM: IRON, SHARKPALE: STEEL},
           lambda c: tell_ram(c, STEEL, n=2, length=4, span=(0.02, 0.34)),
           'grey, with the head spread wide — slow and hard to burst'),
        _V('emberfin', POOKA, {SHARKM: POOKA, SHARKPALE: HORN},
           lambda c: tell_crest(c, FLAME, n=3, h=4, w=1, span=(0.28, 0.66)),
           'red, with a burning dorsal — the one that surfaces and BREATHES'),
    ],
    'mole': [
        _V('pitcher', HORN, {MOLEM: HORN, CREAM: GOGGLE},
           lambda c: tell_studs(c, BRASS, n=5, r=0.72, size=1.0),
           'sandy, knuckled paws — drops more often and moves less'),
        _V('deepdelver', CHITIN, {MOLEM: CHITIN, MOLEPINK: VIOLET},
           lambda c: tell_ram(c, STEEL, n=3, length=3, span=(0.30, 0.78)),
           'near-black, bladed claws — the fast one, and it takes some pumping'),
        _V('deadfall', ROCK, {MOLEM: ROCK, CREAM: DUSTM},
           lambda c: tell_shell(c, IRON, 1, mats=(ROCK,)),
           'grey and stone-crusted — drops one last rock as it bursts'),
    ],
}


# ── the player, and the skins bought with dirt ────────────────────────────

DIRS = ('U', 'R', 'D', 'L')


def player_cel(d, kind, i):
    """One pose.

    The camera-facing views carry the pump as a vertical brass rod at the
    character's side, and its height IS the animation: at rest, thrust up for a
    dig or a shot away from camera, thrust down for one toward it. An earlier
    attempt drew the pump over the crown of the helmet for the up-facing frames
    and it read as a rod through his skull."""
    if kind == 'walk':
        if d == 'R':
            return player_side(i)
        if d == 'L':
            return player_side(i).mirror()
        rod = (16, 24) if i % 2 == 0 else (15, 23)
        return (player_back if d == 'U' else player_front)(i, rod)
    if kind == 'dig':
        arm = (0, 2, 3, 1)[i]
        if d == 'R':
            return player_side(i, lean=1, arm=arm)
        if d == 'L':
            return player_side(i, lean=1, arm=arm).mirror()
        if d == 'U':
            rod = (8 - (i % 2) * 2, 17 - (i % 2) * 2)
            return player_back(i, rod)
        rod = (20 + (i % 2) * 2, 29 + (i % 2) * 2)
        return player_front(i, rod)
    # fire: brace, release, recoil
    arm = (-2, 4, 1)[i]
    lean = (-1, 1, 0)[i]
    if d == 'R':
        return player_side(0, lean=lean, arm=arm)
    if d == 'L':
        return player_side(0, lean=lean, arm=arm).mirror()
    if d == 'U':
        return player_back(0, ((14, 23), (2, 12), (7, 17))[i])
    return player_front(0, ((17, 26), (22, 31), (19, 29))[i])


def player_clips():
    """Every clip the player has — and therefore every clip a SKIN has.

    A skin gets the whole set with no exceptions and no fallback to the
    default. A monster variant can fall back mid-fight and the player will read
    it as one more thing happening; the character the player is holding cannot,
    because a suit that turns orange for the four frames of a dig and back
    again is the single most visible bug this sheet could ship."""
    C = []
    for d in DIRS:
        for kind, n in (('walk', 4), ('dig', 4), ('fire', 3)):
            C.append(_clip('%s.%s' % (kind, d), 10 if kind == 'walk' else 12,
                           kind != 'fire',
                           [Fr('%s.%s%d' % (kind, d, i),
                               (lambda d, k, i: lambda g: player_cel(d, k, i))(d, kind, i))
                            for i in range(n)]))
    C.append(_clip('hurt', 10, True, [
        Fr('hurt0', lambda g: player_side(0, lean=-2, arm=-3, hurt=1)),
        Fr('hurt1', lambda g: player_side(2, lean=-1, arm=-2, hurt=1))]))
    C.append(_clip('death', 6, False, [
        Fr('death%d' % i, (lambda i: lambda g: player_death(i))(i)) for i in range(6)]))
    # Down, and pumped back up. 'down' plays once at its fps and holds flat;
    # 'inflate' is never timed — the view picks its frame from banked pumps.
    for h in ('R', 'L'):
        flip = (lambda c: c.mirror()) if h == 'L' else (lambda c: c)
        C.append(_clip('down.' + h, 8, False, [
            Fr('down.%s%d' % (h, i), (lambda fn, flip: lambda g: flip(fn()))(fn, flip))
            for i, fn in enumerate(DOWN_POSES)]))
        C.append(_clip('inflate.' + h, 12, False, [
            Fr('inflate.%s%d' % (h, i), (lambda f, flip: lambda g: flip(player_slump(f)))(f, flip))
            for i, f in enumerate(INFLATE_STEPS)]))
    return C


def rig_pressure(c):
    """A heavier suit: an extra pixel of shell over the UPPER body, light
    seams across the torso and a grille across the visor. All three come off
    the material mask, so they follow the walk cycle, the recoil and the death
    tumble for free — including the frame where the helmet parts company.

    Two things here are corrections rather than choices. The shell stops at
    62% of the body's height because dilating the legs too closed the gap
    between them and the miner walked around as a single dark block. And the
    seams are STEEL rather than DARK because the suit under them is already
    IRON; dark-on-dark ribbing turned the whole torso into an unreadable
    slab."""
    tell_shell(c, STEEL, 1, mats=(SUIT, SUITDK, HELMET, STEEL),
               span=((0.0, 1.0), (0.0, 0.62)))
    tell_ribs(c, (SUIT,), STEEL, step=4, off=2)
    tell_cage(c, (VISOR,), STEEL, step=3)
    return c


def rig_salvage(c):
    """A rig built out of whatever the mine had lying about: one oversized
    scavenged pauldron, a brass plate across the chest, a mismatched boot and a
    whip aerial. Deliberately ASYMMETRIC, because the default suit is mirrored
    to the pixel and breaking that is most of the read at 32 px."""
    tell_shell(c, ROCK, 1, mats=(SUIT, SUITDK), span=((0.0, 0.45), (0.0, 0.42)))
    tell_patch(c, (SUIT,), BRASS, span=((0.10, 0.55), (0.30, 0.62)))
    tell_aerial(c, STEEL, tip=AMBER, dx=4, h=7, mats=(HELMET,))
    # One boot from somewhere else. Chosen by centroid rather than by
    # coordinates, so it is the same boot in every pose instead of the same
    # pixels in every pose — which is what made the first attempt flicker
    # between feet as the legs crossed.
    m = _mask_of(c, (BOOT,))
    if m.any():
        lbl, n = ndimage.label(m)
        low = [(float(np.nonzero(lbl == k)[1].mean()), k) for k in range(1, n + 1)
               if float(np.nonzero(lbl == k)[0].mean()) > c.h * 0.62]
        if low:
            c.mat[lbl == min(low)[1]] = CHITIN
    return c


# Skin ids are the contract with the shop UI and the skins data table; they are
# emitted into src/sprites.js as SKINS so neither has to hand-copy this list.
#
# A rig runs BEFORE the retint and must therefore only write materials that are
# not KEYS of that skin's remap, or its own additions get recoloured out from
# under it. That is why the pressure shell is STEEL (HELMET->STEEL is fine; the
# key is HELMET) and the salvage pauldron is ROCK (BOOT->ROCK is fine likewise).
SKINS = [
    # Named cobalt, not azure. `azure` is the fast Pooka in monsters.js, and
    # although the two namespaces cannot actually collide — player.<skin>
    # against <kind>.<variant> — a shop selling an Azure suit next to a
    # bestiary entry for an Azure Pooka is a conversation nobody needs.
    dict(id='cobalt', swatch=BOOT, rig=None,
         remap={SUIT: BOOT, SUITDK: IRON, BOOT: BRASS, VISOR: GOLD},
         note='survey blue, brass boots'),
    dict(id='moss', swatch=EMER, rig=None,
         remap={SUIT: EMER, SUITDK: CHITIN, BOOT: HORN, VISOR: GOLD},
         note='lichen green'),
    dict(id='bone', swatch=CREAM, rig=None,
         remap={SUIT: CREAM, SUITDK: ROCK, BOOT: CHITIN, HELMET: CHITIN, VISOR: RUBY},
         note='bleached ceramic over a dark helmet'),
    dict(id='void', swatch=CHITIN, rig=None,
         remap={SUIT: CHITIN, SUITDK: DARK, BOOT: VIOLET, HELMET: IRON, VISOR: EMER},
         note='deep-shift black'),
    # Two materials are deliberately NOT remapped. The boots, because with
    # everything above them in steel and iron the figure stopped reading as a
    # person in a suit and started reading as a robot. And the helmet, because
    # HELMET -> STEEL made the dome the same material as the air tank behind
    # it, and in the two camera-facing views the shell pass then welded them
    # into a single grey egg with no head in it.
    dict(id='pressure', swatch=IRON, rig=rig_pressure,
         remap={SUIT: IRON, SUITDK: CHITIN, VISOR: EMER},
         note='heavy pressure suit — bigger silhouette, ribbed, caged visor'),
    dict(id='salvage', swatch=DUSTM, rig=rig_salvage,
         remap={SUIT: DUSTM, SUITDK: CHITIN, BOOT: ROCK, HELMET: BRASS, VISOR: GOGGLE},
         note='salvaged patchwork rig — one huge pauldron and a whip aerial'),

    # The top rung of the shop ladder, which has been unbuyable since it was
    # written: menu.js hides any rung with no matching sheet id, and there was
    # no 'cinder' here to match. Lit from inside, so the visor is the hot part.
    dict(id='cinder', swatch=AMBER, rig=None,
         remap={SUIT: CHITIN, SUITDK: DARK, BOOT: IRON, HELMET: IRON, VISOR: AMBER},
         note='burnt black shell with a furnace behind the glass'),

    # ── the wardrobe ─────────────────────────────────────────────────────
    #
    # Ten flat-priced suits with no unlock but dirt. None of them takes a `rig`:
    # a rig reshapes the silhouette and has to be drawn and checked in all four
    # camera views, where a remap is a table and costs only palette. These are
    # meant to be a colour choice, and a colour choice is exactly what they are.
    dict(id='amethyst', swatch=AMETHYST, rig=None,
         remap={SUIT: AMETHYST, SUITDK: PLUM, BOOT: CHITIN, HELMET: CHALK, VISOR: GOLD},
         note='deep violet, pale helmet'),
    dict(id='orchid', swatch=ORCHID, rig=None,
         remap={SUIT: ORCHID, SUITDK: PLUM, BOOT: BRASS, HELMET: CHALK, VISOR: EMER},
         note='magenta-violet with brass fittings'),
    dict(id='plum', swatch=WINE, rig=None,
         remap={SUIT: WINE, SUITDK: PLUM, BOOT: CHITIN, HELMET: BRASS, VISOR: GOLD},
         note='wine purple over brass, the deep end of the purple family'),
    dict(id='heather', swatch=HEATHER, rig=None,
         remap={SUIT: HEATHER, SUITDK: CHITIN, BOOT: IRON, HELMET: CREAM, VISOR: AMETHYST},
         note='soft grey-purple, cloth rather than shell'),
    dict(id='tangerine', swatch=TANGERINE, rig=None,
         remap={SUIT: TANGERINE, SUITDK: RUSTM, BOOT: CHITIN, HELMET: CHALK, VISOR: BOOT},
         note='saturated orange under a white helmet'),
    dict(id='glacier', swatch=GLACIER, rig=None,
         remap={SUIT: GLACIER, SUITDK: STEEL, BOOT: STEEL, HELMET: CHALK, VISOR: BOOT},
         note='pale ice blue and chrome'),
    dict(id='rust', swatch=RUSTM, rig=None,
         remap={SUIT: RUSTM, SUITDK: CHITIN, BOOT: IRON, HELMET: DUSTM, VISOR: GOGGLE},
         note='oxide red-brown, scuffed'),
    dict(id='mustard', swatch=MUSTARD, rig=None,
         remap={SUIT: MUSTARD, SUITDK: RUSTM, BOOT: DARK, HELMET: CREAM, VISOR: EMER},
         note='ochre canvas, dark boots'),
    dict(id='verdigris', swatch=VERDIGRIS, rig=None,
         remap={SUIT: VERDIGRIS, SUITDK: CHITIN, BOOT: BRASS, HELMET: BRASS, VISOR: GOLD},
         note='oxidised copper over brass'),
    dict(id='carbon', swatch=CARBON, rig=None,
         remap={SUIT: CARBON, SUITDK: DARK, BOOT: DARK, HELMET: CARBON, VISOR: RUBY},
         note='matte black, red visor'),
]


# ── registry: one structure feeds the packer, FRAMES and CLIPS ────────────

class Registry:
    def __init__(self, seed):
        self.seed = seed
        self.frames = []          # (name, rgba)
        self.by_name = {}
        self.aliases = {}         # alias -> canonical frame name
        self.clips = []           # (name, [frames], fps, loop)
        self._hash = {}           # pixel digest -> first frame with those pixels

    def rng(self, name):
        """A child stream per sprite, keyed on the name — so inserting a sprite
        cannot shift the noise in any other sprite."""
        h = hashlib.blake2b(name.encode(), digest_size=8).digest()
        return np.random.default_rng([self.seed, int.from_bytes(h, 'big')])

    def add(self, name, rgba):
        """Register a frame — or, if those exact pixels are already on the
        sheet, an alias onto them.

        The dedupe is what makes tinted variants cheap enough to be worth
        having. A Sapper variant that recolours its iron shell but not its
        detonation produces four boom frames identical to the base kind's, and
        emitting those again would be pure waste on a sheet that is precached
        before a cold offline first launch. Deciding it by content hash rather
        than by someone noticing is the point: no list to maintain, and it
        stays right when a remap changes."""
        if name in self.by_name or name in self.aliases:
            raise SystemExit('duplicate frame: ' + name)
        rgba = np.ascontiguousarray(rgba.astype(np.uint8))
        key = hashlib.blake2b(b'%dx%d:' % rgba.shape[:2] + rgba.tobytes(),
                              digest_size=16).digest()
        prev = self._hash.get(key)
        if prev is not None:
            self.aliases[name] = prev
            return name
        self._hash[key] = name
        self.by_name[name] = len(self.frames)
        self.frames.append((name, rgba))
        return name

    def cel(self, name, cel, **kw):
        return self.add(name, render_cel(cel, **kw))

    def alias(self, alias, target):
        if target not in self.by_name and target not in self.aliases:
            raise SystemExit('alias %s -> missing %s' % (alias, target))
        self.aliases[alias] = self.aliases.get(target, target)

    def clip(self, name, frames, fps, loop=True):
        for f in frames:
            if f not in self.by_name and f not in self.aliases:
                raise SystemExit('clip %s names missing frame %s' % (name, f))
        self.clips.append((name, list(frames), fps, bool(loop)))


def register_kind(R, kind, var=None):
    """Emit every frame and clip of one monster kind, or of one variant of it.

    The variant path differs from the base path by exactly three things: a
    prefix, a retint and a tell. Everything else — which clips exist, how many
    frames each has, the fps, whether it loops, which poses are mirrored — is
    read from the same table, so the two cannot drift apart."""
    prefix = kind if var is None else '%s.%s' % (kind, var['id'])
    first = None
    for cl in kind_clips(kind):
        if var is not None and not cl['variant']:
            continue
        names = []
        for fr in cl['frames']:
            nm = '%s.%s' % (prefix, fr.name)
            # The rng is keyed on the frame's own name, so a variant's debris
            # scatters differently from the base kind's rather than being the
            # same explosion in another colour.
            c = fr.fn(R.rng(nm))
            if var is not None:
                retint(c, var['remap'])
                if cl['body'] and var['tell']:
                    var['tell'](c)
            if fr.mir:
                c = c.mirror()
            names.append(R.cel(nm, c, **fr.kw))
        R.clip('%s.%s' % (prefix, cl['clip']), names, cl['fps'], loop=cl['loop'])
        if first is None:
            first = names[0]
    # A still for the bestiary and for anything that wants one frame of a kind
    # without knowing its clip names. Derived from the table, so a kind with no
    # walk cycle (the Geode) resolves to its idle without a special case.
    R.alias(prefix, first)
    return prefix


def register_player(R, skin=None):
    """Emit the player, or one skin of the player.

    A rig runs BEFORE the retint: it locates the body by the base materials,
    and the remap that follows only rewrites its own keys, so anything the rig
    added survives. Doing it the other way round meant rig_pressure could not
    find a torso to rib, because SUIT had already become IRON."""
    prefix = 'player' if skin is None else 'player.%s' % skin['id']
    for cl in player_clips():
        names = []
        for fr in cl['frames']:
            nm = '%s.%s' % (prefix, fr.name)
            c = fr.fn(R.rng(nm))
            if skin is not None:
                if skin['rig']:
                    skin['rig'](c)
                retint(c, skin['remap'])
            names.append(R.cel(nm, c, **fr.kw))
        R.clip('%s.%s' % (prefix, cl['clip']), names, cl['fps'], loop=cl['loop'])
    return prefix


def build(seed):
    R = Registry(seed)

    # ── terrain, per theme ────────────────────────────────────────────────
    seams = []
    for th in THEMES:
        for b in range(5):
            nm = '%s.dirt%d' % (th.id, b + 1)
            img = dirt_tile(th, b, R.rng(nm))
            seams.append((nm, seam_report(img)))
            R.add(nm, img)
        for side in 'NSWE':
            R.add('%s.lip%s' % (th.id, side), lip_tile(th, side, R.rng(th.id + 'lip' + side)))
        for g in (1, 2, 3):
            nm = '%s.ore%d' % (th.id, g)
            R.add(nm, ore_tile(th, g, R.rng(nm)))

    # The renderer asks for un-prefixed names today (terrain.js), so the first
    # theme answers to both. Aliases share the packed rect: no extra pixels.
    for b in range(5):
        R.alias('dirt%d' % (b + 1), 'topsoil.dirt%d' % (b + 1))
    for side in 'NSWE':
        R.alias('lip' + side, 'topsoil.lip' + side)
    for g in (1, 2, 3):
        R.alias('ore%d' % g, 'topsoil.ore%d' % g)

    # ── the player, and every skin bought with dirt ──────────────────────
    #
    # `player.<clip>` stays the default and is emitted first, so a save with no
    # skin, a save naming a skin that has since been removed, and a renderer
    # that has never heard of skins all land on exactly the pixels they used to.
    register_player(R)
    for sk in SKINS:
        register_player(R, sk)

    R.alias('playerU', 'player.walk.U0')
    R.alias('playerR', 'player.walk.R0')
    R.alias('playerD', 'player.walk.D0')
    R.alias('playerL', 'player.walk.L0')

    # ── seven monster kinds, and two tinted variants of each ──────────────
    for kind in KINDS:
        register_kind(R, kind)
        for var in MONSTER_VARIANTS[kind]:
            register_kind(R, kind, var)

    # Older un-suffixed names the renderer still asks for by hand.
    R.alias('fygarR', 'fygar.walk.R0')
    R.alias('fygarL', 'fygar.walk.L0')

    # ── shared ghost silhouette ───────────────────────────────────────────
    gsh = []
    for i in range(4):
        c = Cel(ACTOR, ACTOR)
        wob = math.sin(i * math.pi / 2)
        c.ell(16, 15 + wob * 0.6, 10.5, 10.0, GHOSTM)
        c.rect(6, 15, 26, 27, GHOSTM)
        for x in range(ACTOR):
            cut = 2 + int(3.0 * (1 + math.sin(x * 0.75 + i * 1.6)))
            c.mat[ACTOR - cut:, x] = 0
        for sx in (-1, 1):
            c.ell(16 + sx * 4.2, 13, 2.9, 2.9, GOGGLE)
            c.ell(16 + sx * 4.2, 13, 1.4, 1.4, PUPIL)
        c.alpha[:] = 0.82
        gsh.append(R.cel('ghost%d' % i, c))
    R.clip('ghost', gsh, 6)
    R.alias('ghost', 'ghost0')

    # ── rock ──────────────────────────────────────────────────────────────
    #
    # One boulder, then a SLIGHTLY tinted copy per theme.
    #
    # Slightly is the whole design. The complaint the tint answers is real —
    # one grey boulder in seven biomes looks pasted on rather than quarried out
    # of that biome's stone. But a boulder that matches its surroundings is a
    # boulder you do not notice falling, and a falling rock is the most lethal
    # thing in the game. So the tint is a fraction, never a recolour: enough to
    # belong to the biome, never enough to camouflage against it.
    #
    # Registered under the themed name with the bare name aliased to topsoil's,
    # exactly as the dirt tiles above are, so entities.js can ask for the themed
    # frame and fall back without knowing which themes have art.
    rock_img = render_cel(rock_cel(R.rng('rock')))
    R.add('topsoil.rock', rock_img)
    for th in THEMES:
        if th.id == 'topsoil':
            continue
        R.add('%s.rock' % th.id, tinted(rock_img, th.earth[6], 0.22))
    R.alias('rock', 'topsoil.rock')
    sh = [R.cel('rock.shatter%d' % i, rock_shatter(i, R.rng('rock.shatter%d' % i)))
          for i in range(5)]
    R.clip('rock.shatter', sh, 14, loop=False)

    # ── pickups ───────────────────────────────────────────────────────────
    R.cel('bonus', bonus_cel())
    for k in ('ore', 'gem', 'relic', 'crystal'):
        R.cel('pickup.' + k, pickup_cel(k, R.rng('pickup.' + k)))

    # One tile per relic, keyed by the id in content.js so the view can ask for
    # the exact relic lying in the chamber. The list is READ from content.js
    # rather than typed here, for the reason CLAUDE.md gives about the precache
    # list: a hand-copied roster of ids drifts silently, and the failure mode is
    # a relic that quietly draws as the generic brass disc forever.
    #
    # The generic 'pickup.relic' above stays as the fallback, so a relic this
    # function has no branch for still draws something rather than nothing.
    for rid in relic_ids():
        R.cel('pickup.relic.' + rid, relic_cel(rid, R.rng('pickup.relic.' + rid)))

    # ── vfx ───────────────────────────────────────────────────────────────
    for nm, fn, cnt, fps, size in (('clod', vfx_clod, 5, 20, TILE),
                                   ('spark', vfx_spark, 5, 22, TILE),
                                   ('dust', vfx_dust, 5, 16, ACTOR),
                                   ('ring', vfx_ring, 5, 24, ACTOR)):
        fr = [R.cel('vfx.%s%d' % (nm, i), fn(i, R.rng('vfx.%s%d' % (nm, i))), outline=False)
              for i in range(cnt)]
        R.clip('vfx.' + nm, fr, fps, loop=False)

    return R, seams


# ── packing ───────────────────────────────────────────────────────────────

def pack(frames, width=SHEET_W, pad=PAD):
    """Shelf packer. Sorted by height then name, so the layout is a pure
    function of the frame set."""
    order = sorted(range(len(frames)),
                   key=lambda i: (-frames[i][1].shape[0], frames[i][0]))
    x = y = shelf_h = 0
    rects = {}
    for i in order:
        name, img = frames[i]
        h, w = img.shape[:2]
        if x + w > width:
            x = 0
            y += shelf_h + pad
            shelf_h = 0
        rects[name] = (x, y, w, h)
        x += w + pad
        shelf_h = max(shelf_h, h)
    total_h = y + shelf_h
    sheet = np.zeros((total_h, width, 4), np.uint8)
    for name, img in frames:
        rx, ry, w, h = rects[name]
        sheet[ry:ry + h, rx:rx + w] = img
    return sheet, rects


# ── palette ───────────────────────────────────────────────────────────────

def quantise(sheet, max_colors=255):
    """Force the sheet through one palette.

    Everything was drawn in ramp colours already, so this normally only merges
    near-duplicates that different ramps happened to land on. It exists so the
    colour count is a fact the build can assert, not a hope."""
    flat = sheet.reshape(-1, 4)
    opaque = flat[flat[:, 3] > 0]
    cols, counts = np.unique(opaque, axis=0, return_counts=True)
    cols = [tuple(int(v) for v in c) for c in cols]
    counts = list(counts)

    authored = len(cols)
    worst = 0.0
    while len(cols) > max_colors:
        # Merge the closest pair, folding the rarer into the commoner. Greedy
        # and O(n^2) but n is a couple of hundred.
        arr = np.array(cols, np.float32)
        # weight alpha heavily: merging across transparency is very visible
        arr[:, 3] *= 2.0
        d = ((arr[:, None, :] - arr[None, :, :]) ** 2).sum(-1)
        np.fill_diagonal(d, 1e18)
        i, j = np.unravel_index(d.argmin(), d.shape)
        worst = max(worst, float(d[i, j]) ** 0.5)
        if counts[i] < counts[j]:
            i, j = j, i
        counts[i] += counts[j]
        cols.pop(j)
        counts.pop(j)

    pal = np.array(cols, np.int32)
    # map every opaque pixel to the nearest surviving entry
    out = sheet.copy()
    mask = sheet[..., 3] > 0
    px = sheet[mask].astype(np.int32)
    w = np.array([1, 1, 1, 3], np.int32)
    idx = (((px[:, None, :] - pal[None, :, :]) ** 2) * w).sum(-1).argmin(1)
    out[mask] = pal[idx].astype(np.uint8)
    return out, [tuple(int(v) for v in c) for c in pal], authored, worst


# ── emit ──────────────────────────────────────────────────────────────────

JS_HEAD = '''/* Sprite sheet: one PNG, one generated frame table, integer-scaled blitting.
 *
 * GENERATED BY scripts/gen-art.py. Do not hand-edit: the table and the image it
 * describes are written in the same pass so they cannot drift. Change the
 * generator and re-run it.
 *
 * EVERYTHING DEGRADES. If the sheet is missing, still loading, or fails to
 * decode, ready() stays false and the drawing modules fall back to procedural
 * shapes. The game must never be unplayable because art did not arrive — that
 * matters most on a cold offline first launch, which is exactly when a fetch is
 * least likely to succeed.
 */

import { TILE as GRID_TILE, ACTOR as GRID_ACTOR } from './content.js';

export const TILE = %d;
export const ACTOR = %d;

/* The exact size of the atlas this table was written against.
 *
 * Every coordinate below is an offset into ONE specific sprites.png. Pair this
 * table with a different build's image and nothing errors — every blit simply
 * lands on whatever art now occupies those pixels, so monsters wear each
 * other's frames, ground tiles come out wrong and a suit animates as a
 * half-inflated Pooka. It is the most confusing failure this project has,
 * because it looks like a hundred unrelated art bugs at once.
 *
 * load() refuses a sheet whose dimensions do not match these, which turns a
 * silent catastrophe into the plain procedural fallback plus one console error
 * naming the cause. The sheet grows almost every time it is regenerated, so
 * dimensions catch this in practice; they are a smoke alarm, not a checksum. */
export const SHEET_W = %d;
export const SHEET_H = %d;

/* The atlas, addressed BY CONTENT.
 *
 * The query is not a cache-buster in the hopeful sense — it is what makes a
 * mismatched pair impossible to serve. This table and that image are only
 * correct together, and every caching layer between here and the disk treats
 * them as two unrelated files: the service worker holds media cache-first and
 * code network-first, and nginx puts a day's `expires` on images. Any of them
 * can hand back last build's atlas beside this build's coordinates, and the
 * result is not stale art but garbage — every sprite drawn with some other
 * sprite's pixels.
 *
 * With the digest in the URL there is nothing to get wrong. A new sheet is a
 * new URL that no cache has ever seen, and an old sheet keeps its own URL and
 * is simply never asked for again. */
export const SHEET_SHA = '%s';
export const SHEET_SRC = './assets/sprites.png?v=' + SHEET_SHA;

/* frame name -> [sx, sy, sw, sh] in sheet pixels. */
export const FRAMES = Object.freeze({
%s});

/* clip name -> { frames: [...names], fps, loop }.
 *
 * Generated with the frames so an animation can never name a frame the sheet
 * does not contain. `fps` is ignored for clips the view drives by distance
 * travelled rather than by time — see anim.js. */
export const CLIPS = Object.freeze({
%s});

/* Cosmetic player skins the sheet actually contains, in shop order.
 *
 * Emitted from the same table that draws them, so the shop UI and the skins
 * data table can key off what EXISTS rather than off a list someone typed
 * twice. `id` selects clips: 'player.' + id + '.walk.R' and so on, with plain
 * 'player.<clip>' as the default suit. `swatch` is the mid step of that skin's
 * suit ramp, for drawing a shop chip without loading the sheet. */
export const SKINS = Object.freeze([
%s]);

/* Tinted monster variants, by kind: 'pooka.swift.walk.R' and so on.
 *
 * Variants carry every clip of their kind EXCEPT the ghost, which is uniform
 * pale by design — ask for '<kind>.<variant>.<clip>' and fall back to
 * '<kind>.<clip>', which anim.js's pick() already does. */
export const VARIANTS = Object.freeze({
%s});
'''

JS_TAIL = '''
let sheet = null;
let loaded = false;

export function ready() { return loaded; }
export function has(name) { return loaded && !!FRAMES[name]; }

/* Resolves either way — a missing sheet is a normal state, not an error. */
export function load(url = SHEET_SRC) {
  return new Promise((resolve) => {
    if (TILE !== GRID_TILE || ACTOR !== GRID_ACTOR) {
      // The sheet and the grid disagree about how big a cell is. Blitting would
      // stretch every sprite by a non-integer factor, which looks worse than no
      // art at all, so refuse the sheet rather than ship the smear.
      resolve(false);
      return;
    }
    const img = new Image();
    img.onload = () => {
      // A zero-sized decode counts as absent, or every blit draws nothing.
      if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) { resolve(false); return; }
      /* The atlas must be the one this frame table was written against.
       *
       * If it is not, every coordinate above still resolves — to whatever art
       * now sits at those pixels — so the game renders a hundred wrong sprites
       * instead of failing. That is the most confusing bug this project has
       * produced, and it is invisible to the capture harness, which always
       * loads the sheet it just built. The usual cause is a stale sprites.png
       * held by a service worker while sprites.js updated around it.
       *
       * Refusing the sheet drops the game to the procedural silhouettes: plain,
       * but correct, and accompanied by one error naming the real problem. */
      if (img.naturalWidth !== SHEET_W || img.naturalHeight !== SHEET_H) {
        console.error(
          '[sprites] STALE ATLAS: sprites.js expects a %dx%d sheet but got %dx%d. '
          + 'The frame table and the image are from different builds, so every '
          + 'sprite would be drawn with another sprite\\'s pixels. Falling back '
          + 'to procedural art. Clear site data / the service worker and reload.',
          SHEET_W, SHEET_H, img.naturalWidth, img.naturalHeight);
        resolve(false);
        return;
      }
      sheet = img;
      loaded = true;
      resolve(loaded);
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/* Blit a frame. Returns false if the sheet or the frame is missing, so callers
 * can fall through to their procedural path in one `if`. */
export function draw(g, name, dx, dy, dw, dh) {
  if (!loaded) return false;
  const f = FRAMES[name];
  if (!f) return false;
  g.drawImage(sheet, f[0], f[1], f[2], f[3], dx, dy, dw, dh);
  return true;
}
'''


SPRITE_LINE = re.compile(r"sprites\.(?:draw|has)\(")
# A complete literal argument: not the head of a concatenation. terrain.js says
# sprites.has('dirt' + (b + 1)), and matching 'dirt' out of that would report a
# frame nobody actually asks for.
SPRITE_NAME = re.compile(r"'([A-Za-z0-9_.]+)'(?!\s*\+)")


def renderer_expectations(src_dir):
    """Which frame names the rest of src/ actually asks for.

    Read out of the source rather than written down here — a list of "frames
    the renderer needs" maintained by hand in this file is exactly the kind of
    thing that goes stale silently and then ships a sheet the game cannot use.
    Only literal names are visible this way; terrain.js builds its band names
    by concatenation ('dirt' + (b + 1)) and those cannot be seen statically, so
    this is a floor on the requirement, not the whole of it.

    Advisory, never fatal. The generator hard-fails on ITS OWN invariants —
    determinism, seams, palette, byte budget. What another module happens to
    reference today is a different agent's file and a moving target; blocking
    art regeneration on their edit-in-progress would be the wrong coupling."""
    want = set()
    for p in sorted(pathlib.Path(src_dir).glob('*.ts*')):
        if p.name == 'sprites.ts':
            continue
        for line in p.read_text(encoding='utf-8').splitlines():
            # Only what follows the call's opening paren. Scanning the whole
            # line picks up unrelated strings that merely share it, such as the
            # state test in `r.state !== 'breaking' && sprites.draw(g, 'rock'`.
            for m in SPRITE_LINE.finditer(line):
                want.update(SPRITE_NAME.findall(line[m.end():]))
    return want


MONSTER_VARIANT_ID = re.compile(r"\{\s*id:\s*'([A-Za-z0-9_]+)'\s*,\s*name:\s*'")


def relic_ids(src_dir=None):
    """The relic ids content.js actually defines, in table order.

    Read rather than typed, for the reason CLAUDE.md gives about the precache
    list: a hand-copied roster drifts, and here it would drift silently — the
    view falls back to the generic brass disc for a missing frame, so a relic
    whose id was mistyped just quietly never gets its own art.

    Parsed rather than imported for the same reason declared_variants() is:
    this is Python and that is JavaScript. Falls back to an empty list if the
    table cannot be found, which costs the specific art and breaks nothing."""
    p = pathlib.Path(src_dir or (ROOT / 'src')) / 'worldgen.ts'
    if not p.exists():
        return []
    src = p.read_text(encoding='utf-8')
    if 'export const RELICS' not in src:
        return []
    body = src.split('export const RELICS', 1)[1].split(']);', 1)[0]
    return re.findall(r"\{\s*id:\s*'([a-z0-9-]+)'", body)


def declared_variants(src_dir):
    """Which variant ids `monsters.js` actually rolls, per kind.

    The variant roster is a CONTRACT between two files owned by two agents, and
    it is the kind of contract that breaks silently: kindOf() falls back to the
    plain kind for an unknown variant id, and sprites.has() falls back to the
    base kind's frames for a missing one. A typo on either side therefore has
    no symptom at all — the game just quietly stops showing the thing it spent
    a sheet on. Reading their table and diffing it against ours is the only
    thing that makes that visible.

    Advisory, never fatal, for the same reason renderer_expectations() is: a
    half-finished edit in someone else's file must not stop the art building.
    Parsed rather than imported because this is Python and that is JavaScript,
    and adding a JS runtime to the art pipeline for one list would be absurd."""
    p = pathlib.Path(src_dir) / 'monsters.ts'
    if not p.exists():
        return None
    src = p.read_text(encoding='utf-8')
    if 'export const VARIANTS' not in src:
        return None
    body = src.split('export const VARIANTS', 1)[1]
    out = {}
    kind = None
    for line in body.splitlines():
        m = re.match(r"\s*([A-Za-z0-9_]+):\s*Object\.freeze\(\[", line)
        if m:
            kind = m.group(1)
            out.setdefault(kind, [])
        if kind:
            for vid in MONSTER_VARIANT_ID.findall(line):
                out[kind].append(vid)
        if re.match(r"\s*\}\);\s*$", line):
            break
    return out


# The port's sprites.ts is the emitted JS plus exactly these type annotations.
# Each must match once: a silent miss would ship untyped JS into a .ts file.
TS_EDITS = (
    ("import { TILE as GRID_TILE, ACTOR as GRID_ACTOR } from './content.js';",
     "import { TILE as GRID_TILE, ACTOR as GRID_ACTOR } from './worldgen';\n"
     "import type { Ctx } from './render';"),
    ("export const FRAMES = Object.freeze({",
     "/** name -> [sx, sy, sw, sh] into the atlas. Indexed by name at every call\n"
     " *  site, so it is typed as a lookup rather than as 1700 literal keys. */\n"
     "export const FRAMES: Readonly<Record<string, readonly number[]>> = Object.freeze({"),
    ("export const CLIPS = Object.freeze({",
     "export const CLIPS: Readonly<Record<string, { frames: string[]; fps: number; loop: boolean }>> = Object.freeze({"),
    ("let sheet = null;", "let sheet: HTMLImageElement | null = null;"),
    ("export function has(name) {", "export function has(name: string) {"),
    ("export function load(url = SHEET_SRC) {\n  return new Promise((resolve) => {",
     "export function load(url: string = SHEET_SRC): Promise<boolean> {\n  return new Promise<boolean>((resolve) => {"),
    ("export function draw(g, name, dx, dy, dw, dh) {\n  if (!loaded) return false;",
     "export function draw(g: Ctx, name: string, dx: number, dy: number, dw: number, dh: number) {\n  if (!loaded || !sheet) return false;"),
)


def to_ts(js):
    for old, new in TS_EDITS:
        if js.count(old) != 1:
            raise SystemExit('FAIL: sprites.ts conversion expected one %r' % old.splitlines()[0])
        js = js.replace(old, new)
    return js


def js_key(k):
    return k if k.replace('_', 'a').isalnum() else "'%s'" % k


def emit_js(R, rects, sheet_w, sheet_h, sha):
    lines = []
    for name, _ in sorted(R.frames, key=lambda f: f[0]):
        x, y, w, h = rects[name]
        lines.append('  %s: [%d, %d, %d, %d],\n' % (js_key(name), x, y, w, h))
    if R.aliases:
        lines.append('\n  /* Aliases onto the rects above — same pixels under another\n'
                     '   * name: older names the renderer still uses, per-kind stills,\n'
                     '   * and every variant frame whose retint happened to come out\n'
                     '   * identical to the base kind. Costs no sheet space. */\n')
        for a in sorted(R.aliases):
            x, y, w, h = rects[R.aliases[a]]
            lines.append('  %s: [%d, %d, %d, %d],\n' % (js_key(a), x, y, w, h))

    clines = []
    for name, frames, fps, loop in sorted(R.clips):
        fl = ', '.join("'%s'" % f for f in frames)
        clines.append('  %s: { frames: [%s], fps: %d, loop: %s },\n'
                      % (js_key(name), fl, fps, 'true' if loop else 'false'))

    slines = []
    for sk in SKINS:
        slines.append("  { id: '%s', swatch: '%s', note: '%s' },\n"
                      % (sk['id'], rgb2hex(MATS[sk['swatch']]['ramp'][1]),
                         sk['note'].replace("'", "\\'")))

    vlines = []
    for kind in KINDS:
        vs = ', '.join("{ id: '%s', swatch: '%s' }"
                       % (v['id'], rgb2hex(MATS[v['swatch']]['ramp'][1]))
                       for v in MONSTER_VARIANTS[kind])
        vlines.append('  %s: [%s],\n' % (js_key(kind), vs))

    return (JS_HEAD % (TILE, ACTOR, sheet_w, sheet_h, sha,
                       ''.join(lines), ''.join(clines),
                       ''.join(slines), ''.join(vlines)) + JS_TAIL)


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog='gen-art.py',
        description='Generate assets/sprites.png and src/sprites.js procedurally.',
        epilog='Deterministic: the same --seed always produces a byte-identical PNG.',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--seed', type=int, default=20260807,
                    help='master seed; every sprite derives a child stream from it '
                         '(default: %(default)s)')
    ap.add_argument('--png', type=pathlib.Path, default=DEFAULT_PNG,
                    help='output sheet (default: %(default)s)')
    ap.add_argument('--js', type=pathlib.Path, default=DEFAULT_JS,
                    help='output frame table (default: %(default)s)')
    ap.add_argument('--max-bytes', type=int, default=300 * 1024,
                    help='hard ceiling on the shipped PNG; deploy.sh precaches '
                         'assets/* unconditionally so this is downloaded before the '
                         'first offline launch (default: %(default)s)')
    ap.add_argument('--max-colors', type=int, default=255,
                    help='palette size, excluding transparent (default: %(default)s)')
    ap.add_argument('--no-pngquant', action='store_true',
                    help='skip the pngquant pass (for debugging; will likely blow '
                         'the byte budget)')
    ap.add_argument('--dump-frames', type=pathlib.Path, default=None,
                    help='also write every frame as its own PNG into this directory')
    args = ap.parse_args(argv)

    R, seams = build(args.seed)

    # Seamlessness is a build-time fact, not a hope: a band tile is a
    # createPattern('repeat') fill and a 1 px step at the wrap shows up as a
    # grid across the whole field.
    bad = []
    for name, (cs, ci, rs, ri) in seams:
        if cs > ci * 1.7 + 3.0 or rs > ri * 1.7 + 3.0:
            bad.append('%s: col seam %.1f vs %.1f interior, row seam %.1f vs %.1f'
                       % (name, cs, ci, rs, ri))
    if bad:
        print('FAIL: dirt tiles do not tile seamlessly:', file=sys.stderr)
        for b in bad:
            print('  ' + b, file=sys.stderr)
        return 2

    sheet, rects = pack(R.frames)
    sheet, pal, authored, squeeze = quantise(sheet, args.max_colors)

    # No anti-aliasing anywhere: every visible pixel must be a palette entry.
    palset = set(pal)
    vis = sheet[sheet[..., 3] > 0]
    stray = set(tuple(int(v) for v in c) for c in np.unique(vis, axis=0)) - palset
    if stray:
        print('FAIL: %d colours outside the palette' % len(stray), file=sys.stderr)
        return 2

    args.png.parent.mkdir(parents=True, exist_ok=True)
    img = Image.fromarray(sheet, 'RGBA')
    img.save(args.png, optimize=True)

    if not args.no_pngquant:
        if shutil.which('pngquant') is None:
            print('FAIL: pngquant not found', file=sys.stderr)
            return 2
        tmp = args.png.with_suffix('.q.png')
        r = subprocess.run(['pngquant', '--force', '--nofs', '--speed', '1',
                            str(min(256, args.max_colors + 1)),
                            '--output', str(tmp), str(args.png)])
        if r.returncode != 0:
            print('FAIL: pngquant exited %d' % r.returncode, file=sys.stderr)
            return 2
        # pngquant must be lossless where it can be seen — the sheet already
        # has <= 256 exact RGBA values, so any visible change would be
        # dithering or blending, which is the one thing this style forbids.
        # The RGB under a fully transparent pixel is free for it to rewrite.
        got = np.asarray(Image.open(tmp).convert('RGBA'), np.uint8)
        if got.shape != sheet.shape:
            print('FAIL: pngquant resized the sheet', file=sys.stderr)
            return 2
        vis = sheet[..., 3] > 0
        changed = (got[..., 3] != sheet[..., 3])
        changed |= vis & (got[..., :3] != sheet[..., :3]).any(-1)
        if changed.any():
            print('FAIL: pngquant altered %d visible pixels' % int(changed.sum()),
                  file=sys.stderr)
            return 2
        tmp.replace(args.png)

    size = args.png.stat().st_size
    if size > args.max_bytes:
        print('FAIL: %s is %d bytes, budget is %d' % (args.png, size, args.max_bytes),
              file=sys.stderr)
        return 2

    # Hashed here, before the table is written, because the table has to carry
    # the digest of the image it describes.
    digest = hashlib.sha256(args.png.read_bytes()).hexdigest()[:16]
    with Image.open(args.png) as _sheet:
        _sw, _sh = _sheet.size
    args.js.write_text(to_ts(emit_js(R, rects, _sw, _sh, digest)), encoding='utf-8')

    have = set(R.by_name) | set(R.aliases)
    missing = sorted(renderer_expectations(ROOT / 'src') - have)
    if missing:
        print('WARNING: src/ references %d frame(s) this sheet does not have: %s'
              % (len(missing), ', '.join(missing)), file=sys.stderr)

    declared = declared_variants(ROOT / 'src')
    if declared is not None:
        drawn = {k: {v['id'] for v in vs} for k, vs in MONSTER_VARIANTS.items()}
        undrawn = sorted('%s.%s' % (k, v) for k, vs in declared.items()
                         for v in vs if v not in drawn.get(k, ()))
        unrolled = sorted('%s.%s' % (k, v) for k, vs in drawn.items()
                          for v in vs if v not in declared.get(k, ()))
        if undrawn:
            print('WARNING: monsters.js rolls %d variant(s) with no art; they will '
                  'draw as the base kind: %s' % (len(undrawn), ', '.join(undrawn)),
                  file=sys.stderr)
        if unrolled:
            print('WARNING: this sheet draws %d variant(s) monsters.js never rolls, '
                  'so they are dead pixels: %s' % (len(unrolled), ', '.join(unrolled)),
                  file=sys.stderr)

    if args.dump_frames:
        args.dump_frames.mkdir(parents=True, exist_ok=True)
        for name, arr in R.frames:
            Image.fromarray(arr, 'RGBA').save(args.dump_frames / (name.replace('.', '_') + '.png'))

    print('sprites.png  %dx%d  %d frames + %d aliases  %d clips  %.1f KB  sha=%s'
          % (sheet.shape[1], sheet.shape[0], len(R.frames), len(R.aliases),
             len(R.clips), size / 1024.0, digest))
    # The palette line is the one to watch when adding art. An indexed PNG
    # holds 256 entries and no more, so every authored colour past the ceiling
    # is merged into its nearest neighbour — GLOBALLY. That is why adding a
    # variant nudges the dirt: the merge is a property of the whole colour set,
    # not of the thing you added. `squeeze` is the worst merge distance it had
    # to make, in weighted RGBA units. Under about 20 is imperceptible; if a
    # future pass pushes it past that, spend ramps rather than add hues.
    print('palette      %d authored -> %d, worst merge %.1f  (budget %d/%d KB)'
          % (authored, len(pal), squeeze, size / 1024.0, args.max_bytes / 1024))
    print('sprites.js   %d bytes' % args.js.stat().st_size)
    return 0


if __name__ == '__main__':
    sys.exit(main())
