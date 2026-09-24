/* Procedural canvas textures (no image downloads): asphalt, aprons, curbs, walls, ramps, checker,
 * terrain detail, lit windows, glows and a water normal map. All tile seamlessly. */
import * as THREE from 'three';
import { hash2 } from './noise';
import type { ThemeStyle } from './theme';

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
const periodic = (x: number, y: number, p: number, seed: number) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (n: number) => ((n % p) + p) % p;
  const a = hash2(m(xi), m(yi), seed), b = hash2(m(xi + 1), m(yi), seed), c = hash2(m(xi), m(yi + 1), seed), d = hash2(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
/** Tileable fractal noise over a [0,1)² texture: `cells` base cells per side. */
const tileFbm = (u: number, v: number, cells: number, seed: number, oct = 4) => {
  let s = 0, a = 0.5, n = 0, c = cells;
  for (let i = 0; i < oct; i++) { s += periodic(u * c, v * c, c, seed + i * 7) * a; n += a; a *= 0.5; c *= 2; }
  return s / n;
};
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

export class TextureKit {
  private made: THREE.Texture[] = [];
  constructor(private readonly anisotropy: number) {}

  canvas(w: number, h: number, draw: Draw, srgb = true, repeat = true) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d')!, w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.anisotropy; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    this.made.push(t); return t;
  }
  /** Per-pixel painter: fn(u, v) → [r, g, b] (0–255). */
  pixels(w: number, h: number, fn: (u: number, v: number, out: number[]) => void, srgb = true) {
    return this.canvas(w, h, (ctx) => {
      const img = ctx.createImageData(w, h), px = img.data, out = [0, 0, 0];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        fn(x / w, y / h, out); const k = (y * w + x) * 4;
        px[k] = out[0]; px[k + 1] = out[1]; px[k + 2] = out[2]; px[k + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }, srgb);
  }

  asphalt(road: ThemeStyle['road']) {
    const [r, g, b] = rgb(road.base), [sr, sg, sb] = rgb(road.speck);
    return this.pixels(512, 512, (u, v, o) => {
      const blot = tileFbm(u, v, 4, 11, 4), grain = hash2(u * 512, v * 512, 5), speck = grain > 0.93 ? (grain - 0.93) * 14 : 0;
      const f = 0.86 + blot * 0.24 + (grain - 0.5) * 0.12;
      o[0] = Math.min(255, r * f + (sr - r) * speck); o[1] = Math.min(255, g * f + (sg - g) * speck); o[2] = Math.min(255, b * f + (sb - b) * speck);
    });
  }
  apron(kind: ThemeStyle['apron']) {
    if (kind === 'sidewalk') return this.pixels(256, 256, (u, v, o) => {
      const gu = (u * 4) % 1, gv = (v * 4) % 1, seam = Math.min(gu, 1 - gu, gv, 1 - gv) < 0.04 ? 0.62 : 1;
      const tile = hash2(Math.floor(u * 4), Math.floor(v * 4), 3) * 0.12, n = hash2(u * 256, v * 256, 8) * 0.08;
      const f = seam * (0.9 + tile + n); o[0] = 88 * f; o[1] = 92 * f; o[2] = 108 * f;
    });
    const pal: Record<string, [number[], number[]]> = { sand: [[236, 214, 160], [214, 186, 128]], dirt: [[196, 128, 82], [160, 96, 60]], snow: [[240, 246, 255], [205, 220, 240]] };
    const [a, c] = pal[kind];
    return this.pixels(256, 256, (u, v, o) => {
      const n = tileFbm(u, v, 5, 21, 4), ripple = kind === 'sand' ? Math.sin((v * 9 + tileFbm(u, v, 3, 4, 2) * 2.2) * Math.PI * 2) * 0.06 : 0;
      const grain = hash2(u * 256, v * 256, 2), pebble = kind === 'dirt' && grain > 0.965 ? -0.25 : 0, sparkle = kind === 'snow' && grain > 0.985 ? 0.12 : 0;
      const t = Math.min(1, Math.max(0, n * 1.4 - 0.2 + ripple)), f = 1 + (grain - 0.5) * 0.08 + pebble + sparkle;
      for (let i = 0; i < 3; i++) o[i] = Math.min(255, (a[i] + (c[i] - a[i]) * t) * f);
    });
  }
  /** Two-colour stripes along v (curbs), each stripe half the texture. */
  stripes(a: string, b: string, bevel = true) {
    return this.canvas(64, 128, (ctx, w, h) => {
      ctx.fillStyle = a; ctx.fillRect(0, 0, w, h / 2); ctx.fillStyle = b; ctx.fillRect(0, h / 2, w, h / 2);
      if (bevel) { const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(0.2, 'rgba(0,0,0,0)'); g.addColorStop(0.8, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.2)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    });
  }
  /** Barrier panels: u runs along the wall (one texture = two panels), v up the face. */
  wall(a: string, b: string) {
    return this.canvas(256, 64, (ctx, w, h) => {
      ctx.fillStyle = a; ctx.fillRect(0, 0, w / 2, h); ctx.fillStyle = b; ctx.fillRect(w / 2, 0, w / 2, h);
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(0, h - 7, w, 7); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(0, 0, w, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(w / 2 - 2, 0, 3, h); ctx.fillRect(w - 2, 0, 3, h);
    });
  }
  /** Ramp deck: forward-pointing chevrons (v runs up the ramp). */
  chevrons(a: string, b: string) {
    return this.canvas(128, 128, (ctx, w, h) => {
      ctx.fillStyle = b; ctx.fillRect(0, 0, w, h); ctx.fillStyle = a;
      for (let k = -1; k < 2; k++) { const y = k * h / 2; ctx.beginPath(); ctx.moveTo(0, y + h * 0.5); ctx.lineTo(w / 2, y + h * 0.1); ctx.lineTo(w, y + h * 0.5); ctx.lineTo(w, y + h * 0.78); ctx.lineTo(w / 2, y + h * 0.38); ctx.lineTo(0, y + h * 0.78); ctx.closePath(); ctx.fill(); }
    });
  }
  checker(cols = 8, rows = 2) {
    const t = this.canvas(cols * 16, rows * 16, (ctx) => { for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { ctx.fillStyle = (x + y) % 2 ? '#15151c' : '#f6f6f6'; ctx.fillRect(x * 16, y * 16, 16, 16); } });
    t.magFilter = THREE.NearestFilter; return t;
  }
  /** Greyscale detail noise multiplied into vertex-coloured terrain. */
  detail() {
    return this.pixels(256, 256, (u, v, o) => { const n = tileFbm(u, v, 6, 31, 5), g = hash2(u * 256, v * 256, 9); const f = 200 + (n - 0.5) * 90 + (g - 0.5) * 26; o[0] = o[1] = o[2] = Math.max(0, Math.min(255, f)); });
  }
  /** Rock face for cliffs and drop-offs: strata bands. */
  rock(hex: number) {
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    // Sediment strata: flat layers of varying tone with a slight wobble, weathering streaks and fine grain.
    return this.pixels(256, 256, (u, v, o) => {
      const n = tileFbm(u, v, 4, 41, 4), t = v * 7 + (n - 0.5) * 0.9 + 7, layer = Math.floor(t), tone = 0.72 + 0.34 * hash2(layer % 7, 0, 43);
      const lip = t % 1 < 0.1 ? 0.8 : 1, streak = 0.9 + 0.2 * periodic(u * 24, 0, 24, 61);
      const f = tone * lip * streak * (0.88 + tileFbm(u, v, 16, 53, 2) * 0.24); o[0] = Math.min(255, r * f); o[1] = Math.min(255, g * f); o[2] = Math.min(255, b * f);
    });
  }
  /** Lit window grid (emissive), used by fallback buildings and the skyline. */
  windows(seed: number, lit = 0.45) {
    return this.canvas(128, 256, (ctx, w, h) => {
      ctx.fillStyle = '#0c0e18'; ctx.fillRect(0, 0, w, h);
      const warm = ['#ffd27a', '#ffe9b0', '#9fe8ff', '#ffb45e', '#fff6d8'];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) {
        const r = hash2(x, y, seed); if (r > lit) continue;
        ctx.fillStyle = warm[Math.floor(hash2(x, y, seed + 1) * warm.length)]; ctx.globalAlpha = 0.55 + r;
        ctx.fillRect(x * 16 + 3, y * 16 + 4, 10, 9);
      }
      ctx.globalAlpha = 1;
    });
  }
  /** Soft radial glow (alpha in the colour channels for additive blending). */
  glow() {
    return this.canvas(128, 128, (ctx, w, h) => { const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }, true, false);
  }
  /** Tangent-space normal map from tileable noise, for water ripples. */
  waterNormal() {
    const size = 256, height = (u: number, v: number) => tileFbm(u, v, 8, 51, 4);
    return this.pixels(size, size, (u, v, o) => {
      const e = 1 / size, dx = (height(u + e, v) - height(u - e, v)) * 6, dy = (height(u, v + e) - height(u, v - e)) * 6, l = Math.hypot(dx, dy, 1);
      o[0] = (-dx / l * 0.5 + 0.5) * 255; o[1] = (-dy / l * 0.5 + 0.5) * 255; o[2] = (1 / l * 0.5 + 0.5) * 255;
    }, false);
  }
  /** Banner with the game name (gantry). */
  banner(text: string, bg: string, fg: string) {
    return this.canvas(1024, 128, (ctx, w, h) => {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 32) for (let y = 0; y < 2; y++) { ctx.fillStyle = (x / 32 + y) % 2 ? '#111' : '#fff'; ctx.fillRect(x, y * 14, 32, 14); ctx.fillRect(x, h - 28 + y * 14, 32, 14); }
      ctx.fillStyle = fg; ctx.font = '900 64px "Lilita One", "Arial Black", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + 2);
    }, true, false);
  }
  /** Stadium crowd: dense dots of shirt colours. */
  crowd() {
    return this.canvas(256, 128, (ctx, w, h) => {
      ctx.fillStyle = '#3a3f55'; ctx.fillRect(0, 0, w, h);
      const shirts = ['#ff5748', '#28c6e7', '#ffd23f', '#78d955', '#b58aff', '#ffffff', '#ff8fc8', '#ff9a3c'];
      for (let row = 0; row < 8; row++) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, row * 16 + 13, w, 3);
        for (let x = 0; x < 32; x++) { ctx.fillStyle = shirts[Math.floor(hash2(x, row, 4) * shirts.length)]; ctx.fillRect(x * 8 + 1, row * 16 + 5, 6, 8); ctx.fillStyle = '#f1c7a0'; ctx.fillRect(x * 8 + 2, row * 16 + 1, 4, 4); } }
    });
  }
  /** Corner warning board: white chevrons pointing toward +u. */
  arrowBoard(bg: string) {
    return this.canvas(256, 128, (ctx, w, h) => {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ffffff';
      for (let k = 0; k < 3; k++) { const x = 30 + k * 72; ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x + 34, 20); ctx.lineTo(x + 70, h / 2); ctx.lineTo(x + 34, h - 20); ctx.lineTo(x, h - 20); ctx.lineTo(x + 36, h / 2); ctx.closePath(); ctx.fill(); }
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, w - 8, h - 8);
    }, true, false);
  }
  /** Billboard art: bold stripes and a slogan. */
  billboard(seed: number) {
    const sets = [['#ff3d7f', '#ffd23f', 'ZOOM!'], ['#1ee8ff', '#2a1f66', 'TURBO'], ['#78d955', '#ffffff', 'DRIFT'], ['#ff9a3c', '#2b2b3a', 'PARTY']];
    const [a, b, text] = sets[seed % sets.length];
    return this.canvas(256, 128, (ctx, w, h) => {
      ctx.fillStyle = a; ctx.fillRect(0, 0, w, h); ctx.fillStyle = b;
      for (let i = -2; i < 10; i++) { ctx.beginPath(); ctx.moveTo(i * 40, h); ctx.lineTo(i * 40 + 20, h); ctx.lineTo(i * 40 + 60, 0); ctx.lineTo(i * 40 + 40, 0); ctx.fill(); }
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 8; ctx.font = '900 62px "Lilita One", "Arial Black", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeText(text, w / 2, h / 2); ctx.fillText(text, w / 2, h / 2);
    }, true, false);
  }
  dispose() { for (const t of this.made.splice(0)) t.dispose(); }
}
