/** Sector backdrops (Blender renders) with a procedural nebula fallback, painted once per size into a static layer. */
import { hash } from './hullart';

export const BACKDROP_IDS = ['rustbelt', 'veil', 'meridian', 'armada-reach'] as const;
const images = new Map<string, HTMLImageElement | null>();
export const loadImage = (src: string, signal?: AbortSignal) => new Promise<HTMLImageElement | null>(resolve => {
  if (signal?.aborted || typeof Image === 'undefined') return resolve(null);
  const img = new Image(); img.decoding = 'async'; img.onload = () => resolve(img); img.onerror = () => resolve(null);
  signal?.addEventListener('abort', () => resolve(null), { once: true }); img.src = src;
});
export const loadBackdrops = (assetBase: string, signal?: AbortSignal) => Promise.all(BACKDROP_IDS.map(async id => { if (images.has(id)) return; const img = await loadImage(`${assetBase}backdrops/${id}.jpg`, signal); if (!signal?.aborted) images.set(id, img); }));
/** Loaded image, null when missing, undefined while unknown. */
export const backdropImage = (id: string) => images.get(id);

const THEMES: Record<string, [deep: string, mid: string, glow: string, planet: string]> = {
  rustbelt: ['#1a0c10', '#7a3218', '#e0843a', '#8a4a2c'], veil: ['#0f0a24', '#4e2380', '#39b58c', '#3d2a66'],
  meridian: ['#07122a', '#1b4f86', '#5fd0e6', '#2a4f6e'], 'armada-reach': ['#1c0409', '#8c0f2a', '#ff7040', '#5a1420'],
};
/** Paints the full static backdrop (image cover-fit or procedural nebula, distant stars, vignette, header shade). */
export function paintBackdrop(g: CanvasRenderingContext2D, w: number, h: number, id: string) {
  const img = images.get(id), [deep, mid, glow, planet] = THEMES[id] ?? THEMES.rustbelt, seed = id.length * 17;
  g.fillStyle = '#04060f'; g.fillRect(0, 0, w, h);
  if (img) { const s = Math.max(w / img.width, h / img.height); g.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s); }
  else {
    const blob = (x: number, y: number, r: number, color: string, alpha: number) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, color); gr.addColorStop(1, 'transparent'); g.globalAlpha = alpha; g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
    g.fillStyle = deep; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) { const t = i / 26, x = w * (.1 + .8 * hash(seed + i)), y = h * (.5 + Math.sin(t * 6.3 + seed) * .28 + (hash(i * 3.3) - .5) * .3);
      blob(x, y, Math.max(w, h) * (.12 + .22 * hash(i * 7.1)), i % 3 ? mid : glow, .18 + .14 * hash(i * 1.9)); }
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 14; i++) blob(w * hash(i * 4.7 + seed), h * hash(i * 9.1), Math.max(w, h) * (.08 + .12 * hash(i)), '#020308', .55);
    const pr = h * .34, px = w * .5, py = h + pr * .55, pg = g.createRadialGradient(px - pr * .35, py - pr * .6, pr * .05, px, py, pr);
    pg.addColorStop(0, planet); pg.addColorStop(.6, deep); pg.addColorStop(1, '#05060c'); blob(px, py, pr * 1.35, glow, .25);
    g.globalAlpha = .85; g.fillStyle = pg; g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    g.globalAlpha = .55; g.strokeStyle = glow; g.lineWidth = h * .003; g.beginPath(); g.arc(px, py, pr, Math.PI * 1.1, Math.PI * 1.7); g.stroke();
  }
  g.globalAlpha = 1; g.fillStyle = '#fff';
  for (let i = 0; i < (w * h) / 2600; i++) { const b = hash(i * 1.37 + 5); g.globalAlpha = .15 + b * .5; g.fillRect(hash(i * 2.11) * w, hash(i * 3.97) * h, b > .93 ? 2 : 1, b > .93 ? 2 : 1); }
  g.globalAlpha = 1;
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .35, w / 2, h / 2, Math.hypot(w, h) * .62); v.addColorStop(0, 'rgba(2,3,10,0)'); v.addColorStop(1, 'rgba(2,3,10,.72)'); g.fillStyle = v; g.fillRect(0, 0, w, h);
  const top = g.createLinearGradient(0, 0, 0, h * .16); top.addColorStop(0, 'rgba(3,5,16,.8)'); top.addColorStop(1, 'rgba(3,5,16,0)'); g.fillStyle = top; g.fillRect(0, 0, w, h * .16);
}
