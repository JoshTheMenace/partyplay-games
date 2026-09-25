/** Tiny deterministic pixel toolkit used by every Blockwild texture and sprite. Pure: no DOM, no three.js. */
export const TILE = 16;
/** Colour as 0xRRGGBB. */
export type Rgb = number;
export type Palette = Readonly<Record<string, Rgb>>;

export const clamp = (v: number, lo = 0, hi = 1) => v < lo ? lo : v > hi ? hi : v;
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => {
  const c = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (c(16) << 16) | (c(8) << 8) | c(0);
};
/** Multiply brightness (f > 1 lightens, clipped). */
export const shade = (c: Rgb, f: number): Rgb => {
  const ch = (shift: number) => Math.min(255, Math.round(((c >> shift) & 255) * f));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
/** Pick from a dark→light ramp with t in 0..1. */
export const pick = (ramp: readonly Rgb[], t: number): Rgb => ramp[Math.min(ramp.length - 1, Math.max(0, Math.floor(t * ramp.length)))]!;

/** Integer hash → [0, 1). */
export function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export const seedOf = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };
/** Seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smooth = (t: number) => t * t * (3 - 2 * t);
const wrap = (v: number, n: number) => ((v % n) + n) % n;
/** Value noise that tiles every 16 px; `cell`/`cellY` are the lattice spacings (must divide 16). */
export function tnoise(x: number, y: number, seed: number, cell = 4, cellY = cell): number {
  const nx = TILE / cell, ny = TILE / cellY, gx = x / cell, gy = y / cellY, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = smooth(gx - x0), fy = smooth(gy - y0);
  const v = (i: number, j: number) => hash(wrap(i, nx), wrap(j, ny), seed);
  const top = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * fx, bottom = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * fx;
  return top + (bottom - top) * fy;
}

/** RGBA pixel buffer (row-major, top row first). */
export class Pix {
  readonly data: Uint8Array;
  constructor(readonly w = TILE, readonly h = TILE) { this.data = new Uint8Array(w * h * 4); }
  private at(x: number, y: number) { return (wrap(Math.round(y), this.h) * this.w + wrap(Math.round(x), this.w)) * 4; }
  /** Set a pixel; coordinates wrap so tiling details stay seamless. */
  set(x: number, y: number, rgb: Rgb, a = 255) {
    const i = this.at(x, y), d = this.data;
    d[i] = (rgb >> 16) & 255; d[i + 1] = (rgb >> 8) & 255; d[i + 2] = rgb & 255; d[i + 3] = a;
    return this;
  }
  /** Set only inside the canvas (no wrap), for sprites. */
  put(x: number, y: number, rgb: Rgb, a = 255) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.set(x, y, rgb, a); return this; }
  rgb(x: number, y: number): Rgb { const i = this.at(x, y), d = this.data; return (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!; }
  alpha(x: number, y: number) { return this.data[this.at(x, y) + 3]!; }
  clear(x: number, y: number) { this.data[this.at(x, y) + 3] = 0; return this; }
  fill(fn: (x: number, y: number) => Rgb | null, a = 255) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const c = fn(x, y); if (c !== null) this.set(x, y, c, a); }
    return this;
  }
  /** Re-colour existing pixels. */
  map(fn: (c: Rgb, x: number, y: number) => Rgb) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.alpha(x, y)) this.set(x, y, fn(this.rgb(x, y), x, y), this.alpha(x, y));
    return this;
  }
  rect(x0: number, y0: number, w: number, h: number, c: Rgb | ((x: number, y: number) => Rgb)) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, typeof c === 'number' ? c : c(x, y));
    return this;
  }
  /** Stamp ASCII art: each char maps through the palette; '.' and unknown chars are skipped, ' ' clears. */
  draw(rows: readonly string[], palette: Palette, ox = 0, oy = 0) {
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === ' ') this.put(ox + x, oy + y, 0, 0);
      else if (palette[ch] !== undefined) this.put(ox + x, oy + y, palette[ch]!);
    }));
    return this;
  }
  copy() { const p = new Pix(this.w, this.h); p.data.set(this.data); return p; }
  /** Fill colour of fully transparent pixels from opaque neighbours so filtering/mipmaps never bleed black. */
  bleed() {
    const d = this.data, src = d.slice();
    for (let pass = 0; pass < 4; pass++) {
      const next = src.slice();
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        const i = this.at(x, y);
        if (src[i + 3] || next[i + 3]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const j = this.at(x + dx, y + dy);
          if (src[j + 3]) { r += src[j]!; g += src[j + 1]!; b += src[j + 2]!; n++; }
        }
        if (n) { next[i] = r / n; next[i + 1] = g / n; next[i + 2] = b / n; next[i + 3] = 1; }
      }
      src.set(next);
    }
    for (let i = 0; i < d.length; i += 4) if (!d[i + 3]) { d[i] = src[i]!; d[i + 1] = src[i + 1]!; d[i + 2] = src[i + 2]!; }
    return this;
  }
}
