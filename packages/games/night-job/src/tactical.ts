/* The phone's own picture on a crew night: a 2D floor plan that follows your thief. Canvas only, so phones never
 * load three.js. Unseen rooms stay blueprint; what the crew sees is drawn lit, cut off sharply by walls and closed
 * doors and fading back to blueprint at the edge of sight. Draws only what the crew's View holds. */
import { SnapshotBuffer } from '../../../party-runtime/src/index';
import { buildGrid, castRay, doorObjects, sightPolygon, type Grid } from './geometry';
import { floorAt } from './level';
import { getMap } from './maps';
import { RADIUS, ROLES, SIGHT, TIMING, cameraAngle, type EffectKind, type HeistMap, type Noise, type Point, type Prop, type Shot, type View } from './model';
import { paintPreview } from './preview';
import { createPoses, type Pose } from './render/interp';

const INK = '#05071a', CREAM = '#fff6e5', GOLD = '#ffd24a', WALL_TOP = '#474253', WALL_FACE = '#c9b69a', RIM = '#f7e6c2', SKIN = '#e9b98f';
const LABEL: Partial<Record<EffectKind, string>> = { coin: '#ffd65a', safe: '#ffd65a', charge: '#ffd65a', objective: '#ffd65a', escape: '#7dffc0', hurt: '#ff6a5a', down: '#ff6a5a', spotted: '#ff6a5a', alarm: '#ff6a5a', hack: '#7df3ff', emp: '#7df3ff', unlock: '#ffe08a', rescue: '#7dffb0', heal: '#7dffb0', bail: '#7dffb0', takedown: '#f888cd', decoy: '#c49cff', smoke: '#d8d4e8' };
const NOISE: Record<Noise['kind'], [string, number]> = { step: ['#d8ecff', 650], loud: ['#ffae4a', 1000], decoy: ['#c49cff', 1100], scream: ['#ff7ab8', 1000], alarm: ['#ff3b3b', 1200] };
const SHOT: Record<Shot['kind'], string> = { guard: '#ff5a3a', tranq: '#8dffa8', shotgun: '#ffd27a' };
const LOOK = { calm: '255,217,138', alert: '255,154,46', chase: '255,46,42', charmed: '255,122,208', civilian: '207,230,255' };
const CIVILIAN = ['#e0b44c', '#5fa8d8', '#c65b7c', '#7fbf6a', '#b98ae0', '#e08a4c'], CARS = ['#c0392b', '#2f6fb3', '#d9a520', '#3f8f6a'];
const shade = (hex: string, k: number) => { const n = parseInt(hex.slice(1), 16), f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f(n >> 8 & 255)},${f(n & 255)})`; };
const hash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
type G = CanvasRenderingContext2D;
const dot = (g: G, c: string, x: number, y: number, r: number) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
const box = (g: G, c: string, x: number, y: number, w: number, h: number, r = .06) => { g.fillStyle = c; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
const line = (g: G, c: string, width: number, ...p: number[]) => { g.strokeStyle = c; g.lineWidth = width; g.beginPath(); for (let i = 0; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.stroke(); };

/** One piece of furniture seen from above, in its placed footprint. */
function prop(g: G, p: Prop) {
  const odd = p.rot % 2 !== 0, w = odd ? p.h : p.w, h = odd ? p.w : p.h, a = -w / 2 + .08, b = -h / 2 + .08, iw = w - .16, ih = h - .16, r = Math.min(iw, ih) / 2;
  g.save(); g.translate(p.x + p.w / 2, p.y + p.h / 2); g.rotate(p.rot * Math.PI / 2);
  if (p.solid && p.kind !== 'lamp') box(g, 'rgba(0,0,0,.3)', a + .07, b + .11, iw, ih, .12);
  switch (p.kind) {
    case 'desk': box(g, '#6e4527', a, b, iw, ih); box(g, '#1d2230', -.26, b + .06, .52, .16, .03); box(g, '#f2ead8', .3, 0, .22, .16, .02); break;
    case 'chair': box(g, '#3f3446', -.22, -.2, .44, .42, .1); box(g, '#54466a', -.22, -.26, .44, .14, .06); break;
    case 'table': if (w === h) { dot(g, '#7a4a2a', 0, 0, r); dot(g, '#94603a', -.05, -.06, r * .7); } else { box(g, '#7a4a2a', a, b, iw, ih, .1); box(g, '#94603a', a + .08, b + .08, iw - .16, ih - .22, .08); } break;
    case 'sofa': box(g, '#8c2f45', a, b, iw, ih, .14); box(g, '#6f2135', a, b, iw, .24, .1); for (let i = 1; i < Math.round(iw); i++) line(g, '#6f2135', .03, a + i * iw / Math.round(iw), b + .26, a + i * iw / Math.round(iw), b + ih - .04); break;
    case 'bed': box(g, '#efefef', a, b, iw, ih, .1); box(g, '#4a6fa5', a, b + ih * .38, iw, ih * .62, .1); box(g, '#ffffff', a + .1, b + .08, iw - .2, .3, .08); break;
    case 'shelf': case 'bookcase': box(g, p.kind === 'shelf' ? '#6a5a48' : '#4a2f1e', a, b, iw, ih, .04); for (let i = 0; i < Math.round(iw * 4); i++) box(g, ['#8c2f45', '#2f5b8c', '#c9a24a', '#3f7a4a'][(i + p.x) % 4], a + .05 + i * .24, b + .1, .17, ih - .2, .02); break;
    case 'crate': box(g, '#a57a42', a, b, iw, ih, .04); line(g, '#7a5530', .06, a, b, a + iw, b + ih); line(g, '#7a5530', .06, a + iw, b, a, b + ih); g.strokeStyle = '#7a5530'; g.lineWidth = .07; g.strokeRect(a + .03, b + .03, iw - .06, ih - .06); break;
    case 'barrel': dot(g, '#6e4a2c', 0, 0, r); dot(g, '#2a2a30', 0, 0, r * .82); dot(g, '#7d5632', 0, 0, r * .7); break;
    case 'plant': dot(g, '#b86a3c', 0, 0, .2); for (let i = 0; i < 5; i++) dot(g, i % 2 ? '#3f9a4c' : '#2f7a3c', Math.cos(i * 1.26) * .2, Math.sin(i * 1.26) * .2, .17); break;
    case 'tree': dot(g, '#2c6a36', 0, 0, .5); for (let i = 0; i < 6; i++) dot(g, i % 2 ? '#3f9a4c' : '#357f40', Math.cos(i * 1.05) * .26, Math.sin(i * 1.05) * .26, .22); dot(g, '#4fae5b', -.08, -.1, .16); break;
    case 'statue': box(g, '#77778a', -.32, -.32, .64, .64, .05); dot(g, '#c9c9d6', 0, 0, .21); dot(g, '#e6e6f0', -.05, -.06, .1); break;
    case 'rug': box(g, '#8c2338', -w / 2 + .06, -h / 2 + .06, w - .12, h - .12, .04); g.strokeStyle = '#d9a94a'; g.lineWidth = .06; g.strokeRect(-w / 2 + .2, -h / 2 + .2, w - .4, h - .4); g.fillStyle = '#d9a94a'; g.beginPath(); g.moveTo(0, -h * .28); g.lineTo(w * .28, 0); g.lineTo(0, h * .28); g.lineTo(-w * .28, 0); g.fill(); dot(g, '#8c2338', 0, 0, Math.min(w, h) * .09); break;
    case 'bar': case 'counter': box(g, '#4a2f1c', a, b, iw, ih, .05); box(g, p.kind === 'bar' ? '#8a5a36' : '#d9d2c2', a + .06, b + .06, iw - .12, ih - .12, .04); if (p.kind === 'bar') for (let i = 0; i < Math.round(iw * 2); i++) dot(g, ['#7fd0a0', '#e0b44c', '#c65b7c'][i % 3], a + .25 + i * .5, 0, .07); break;
    case 'piano': box(g, '#17171c', a, b, iw, ih, .12); box(g, '#f2f2f2', a + .1, b + ih - .24, iw - .2, .15, .02); break;
    case 'slot': box(g, '#b3222f', a, b, iw, ih, .08); box(g, '#ffd24a', -.24, -.26, .48, .3, .04); dot(g, '#b3222f', 0, -.11, .07); break;
    case 'roulette': box(g, '#1f6b3a', a, b, iw, ih, .12); dot(g, '#d9a94a', -w / 4, 0, r * .86); dot(g, '#5a1a22', -w / 4, 0, r * .74); dot(g, '#d9a94a', -w / 4, 0, r * .16); break;
    case 'cards': box(g, '#1f7a45', a, b, iw, ih, .36); box(g, '#f2ead8', -.1, -.08, .1, .14, .02); box(g, '#f2ead8', .06, -.02, .1, .14, .02); break;
    case 'locker': box(g, '#51607a', a, b, iw, ih, .04); for (let i = 0; i < 3; i++) line(g, '#34405a', .04, a + .14, b + .2 + i * .12, a + iw - .14, b + .2 + i * .12); break;
    case 'fountain': dot(g, '#b9b9c4', 0, 0, r); dot(g, '#3fb6c9', 0, 0, r * .8); dot(g, '#8fe2f0', -.1, -.12, r * .35); dot(g, '#b9b9c4', 0, 0, r * .2); break;
    case 'car': case 'van': box(g, p.kind === 'van' ? '#e8e4d8' : CARS[(p.x * 7 + p.y) % CARS.length], a, b, iw, ih, p.kind === 'van' ? .16 : .26); box(g, '#9fd8ec', iw * .14, b + .1, iw * .18, ih - .2, .06); box(g, 'rgba(0,0,0,.18)', a + .12, b + .12, iw * .5, ih - .24, .06); break;
    case 'boat': g.fillStyle = '#e8e4d8'; g.beginPath(); g.moveTo(a, b + .1); g.lineTo(a + iw * .7, b); g.lineTo(a + iw, 0); g.lineTo(a + iw * .7, b + ih); g.lineTo(a, b + ih - .1); g.closePath(); g.fill(); box(g, '#c9a66b', a + .15, b + .25, iw * .55, ih - .5, .1); box(g, '#2f6fb3', a + .3, b + .4, iw * .25, ih - .8, .06); break;
    case 'lamp': dot(g, 'rgba(255,207,138,.35)', 0, 0, .42); dot(g, '#3a3a44', 0, 0, .14); dot(g, '#ffe6b0', 0, 0, .08); break;
    case 'painting': box(g, '#c9a24a', -.36, -.5, .72, .1, .02); box(g, '#7a3a4a', -.3, -.48, .6, .06, .01); break;
    case 'server': box(g, '#1c2433', a, b, iw, ih, .04); for (let i = 0; i < 3; i++) { dot(g, '#7dffb0', -.2 + i * .2, -.12, .04); dot(g, '#7df3ff', -.2 + i * .2, .1, .04); } break;
    case 'bench': box(g, '#8a5f3a', a, b + ih * .15, iw, ih * .7, .05); for (let i = 1; i < 3; i++) line(g, '#6a4628', .03, a, b + ih * .15 + i * ih * .23, a + iw, b + ih * .15 + i * ih * .23); break;
    case 'flowerbed': box(g, '#4a3424', a, b, iw, ih, .1); box(g, '#3f8a45', a + .08, b + .08, iw - .16, ih - .16, .1); for (let i = 0; i < Math.round(iw * ih * 4); i++) dot(g, ['#ff8ab8', '#ffd24a', '#ffffff'][i % 3], a + .2 + (i * .37) % (iw - .3), b + .2 + (i * .61) % (ih - .3), .07); break;
    case 'container': box(g, (p.x + p.y) % 2 ? '#b5542f' : '#2f6f8f', a, b, iw, ih, .04); for (let i = 1; i < Math.round(iw * 4); i++) line(g, 'rgba(0,0,0,.22)', .03, a + i * .25, b + .04, a + i * .25, b + ih - .04); break;
  }
  g.restore();
}

/** The building as the crew sees it, lights on: T pixels per tile. Doors, loot and anything with a state are drawn live on top. */
function paintLit(canvas: HTMLCanvasElement, map: HeistMap, T: number) {
  const g = canvas.getContext('2d')!, { width: W, height: H } = map, at = (x: number, y: number) => map.tiles[y]?.[x] ?? ' ', wall = (x: number, y: number) => '#% '.includes(at(x, y));
  canvas.width = W * T; canvas.height = H * T; g.scale(T, T);
  let seed = 9; const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at(x, y); if (c === ' ') continue;
    if (c === '~') { g.fillStyle = '#123f4c'; g.fillRect(x, y, 1.02, 1.02); for (let k = 0; k < 2; k++) line(g, 'rgba(120,200,215,.4)', .04, x + .1 + rnd() * .3, y + .3 + k * .4, x + .35 + rnd() * .2, y + .24 + k * .4, x + .7, y + .3 + k * .4); continue; }
    const [kind, colour] = floorAt(map, x, y), dark = shade(colour, .84), light = shade(colour, 1.1);
    g.fillStyle = kind === 'checker' && (x + y) % 2 ? '#2c2a33' : kind === 'tile' && (x + y) % 2 ? shade(colour, .93) : colour; g.fillRect(x, y, 1.02, 1.02);
    if (kind === 'wood') for (let k = 0; k < 3; k++) { g.fillStyle = dark; g.fillRect(x, y + k / 3, 1, .03); g.fillRect(x + ((x * 3 + k * 5) % 7) / 7, y + k / 3, .03, 1 / 3); }
    else if (kind === 'deck') for (let k = 0; k < 3; k++) { g.fillStyle = dark; g.fillRect(x + k / 3, y, .035, 1); }
    else if (kind === 'carpet') { g.fillStyle = light; g.beginPath(); g.moveTo(x + .5, y + .36); g.lineTo(x + .64, y + .5); g.lineTo(x + .5, y + .64); g.lineTo(x + .36, y + .5); g.fill(); dot(g, dark, x, y, .07); dot(g, dark, x + 1, y, .07); dot(g, dark, x, y + 1, .07); dot(g, dark, x + 1, y + 1, .07); }
    else if (kind === 'grass') for (let k = 0; k < 4; k++) { const tx = x + rnd(), ty = y + rnd(); line(g, k % 2 ? light : dark, .04, tx, ty, tx + .04, ty - .14); }
    else if (kind === 'marble') { line(g, dark, .025, x + rnd() * .4, y, x + .5 + rnd() * .4, y + 1); g.fillStyle = dark; g.fillRect(x, y, 1, .025); g.fillRect(x, y, .025, 1); }
    else if (kind === 'tile') { g.fillStyle = shade(colour, .72); g.fillRect(x, y, 1, .03); g.fillRect(x, y, .03, 1); }
    else for (let k = 0; k < 3; k++) dot(g, k % 2 ? light : dark, x + rnd(), y + rnd(), .03);
  }
  // Contact shade under the north wall of every room, then furniture, then the walls themselves.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!wall(x, y) && at(x, y) !== '~' && wall(x, y - 1)) { const shadow = g.createLinearGradient(0, y, 0, y + .45); shadow.addColorStop(0, 'rgba(8,10,30,.42)'); shadow.addColorStop(1, 'rgba(8,10,30,0)'); g.fillStyle = shadow; g.fillRect(x, y, 1, .45); }
  for (const p of map.props) prop(g, p);
  for (const o of map.objects) {
    if (o.kind === 'vent') { box(g, '#2a2f3c', o.x - .34, o.y - .34, .68, .68, .05); for (let k = 0; k < 4; k++) line(g, '#8a94ab', .05, o.x - .24, o.y - .21 + k * .14, o.x + .24, o.y - .21 + k * .14); }
    else if (o.kind === 'hide') { if (at(Math.floor(o.x), Math.floor(o.y)) === ',' || floorAt(map, Math.floor(o.x), Math.floor(o.y))[0] === 'grass') for (let k = 0; k < 6; k++) dot(g, k % 2 ? '#2f7a3c' : '#3f9a4c', o.x + Math.cos(k * 1.05) * .2, o.y + Math.sin(k * 1.05) * .2, .2); else { box(g, '#5a3a24', o.x - .4, o.y - .36, .8, .72, .05); line(g, '#3a2414', .04, o.x, o.y - .34, o.x, o.y + .34); dot(g, '#d9a94a', o.x - .08, o.y, .04); dot(g, '#d9a94a', o.x + .08, o.y, .04); } }
    else if (o.kind === 'objective') { box(g, 'rgba(0,0,0,.3)', o.x - .3, o.y - .24, .68, .68, .08); box(g, '#b9b2a4', o.x - .36, o.y - .36, .72, .72, .08); box(g, '#8f8778', o.x - .26, o.y - .26, .52, .52, .06); }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at(x, y), across = '#%=wd'.includes(at(x - 1, y)) && '#%=wd'.includes(at(x + 1, y));
    if (c === '#' || c === '%') {
      const face = !'#% '.includes(at(x, y + 1)), top = face ? .7 : 1;
      g.fillStyle = WALL_TOP; g.fillRect(x, y, 1.02, top + .02);
      if (face) { g.fillStyle = c === '%' ? '#b8a58a' : WALL_FACE; g.fillRect(x, y + .7, 1.02, .3); g.fillStyle = 'rgba(40,30,30,.45)'; g.fillRect(x, y + .95, 1.02, .05); }
      g.fillStyle = RIM;
      if (!wall(x, y - 1)) g.fillRect(x, y, 1.02, .05);
      if (!wall(x - 1, y)) g.fillRect(x, y, .05, top);
      if (!wall(x + 1, y)) g.fillRect(x + .95, y, .05, top);
      if (face) g.fillRect(x, y + .66, 1.02, .05);
      if (c === '%') { line(g, '#1d1b24', .05, x + .3, y + .1, x + .5, y + .4, x + .38, y + .62, x + .6, y + .92); line(g, '#1d1b24', .035, x + .5, y + .4, x + .74, y + .5); }
    } else if (c === '=') {
      if (across) { box(g, '#3c4250', x, y + .4, 1, .2, 0); box(g, 'rgba(181,236,255,.75)', x, y + .44, 1, .12, 0); line(g, '#ffffff', .03, x + .2, y + .47, x + .5, y + .47); }
      else { box(g, '#3c4250', x + .4, y, .2, 1, 0); box(g, 'rgba(181,236,255,.75)', x + .44, y, .12, 1, 0); line(g, '#ffffff', .03, x + .47, y + .2, x + .47, y + .5); }
    } else if (c === 'w') { if (across) box(g, '#8a7f70', x, y + .34, 1, .32, 0); else box(g, '#8a7f70', x + .34, y, .32, 1, 0); }
  }
  // Warm pools: each room's own light, and every lamp.
  g.globalCompositeOperation = 'soft-light';
  const pool = (x: number, y: number, r: number, colour: string, alpha: number) => { const grad = g.createRadialGradient(x, y, 0, x, y, r); grad.addColorStop(0, colour); grad.addColorStop(1, `${colour}00`); g.globalAlpha = alpha; g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2); g.globalAlpha = 1; };
  for (const room of map.rooms) {
    g.save(); g.beginPath(); g.rect(room.x, room.y, room.w, room.h); g.clip();
    const nx = Math.max(1, Math.round(room.w / 5)), ny = Math.max(1, Math.round(room.h / 5));
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) pool(room.x + room.w * (i + .5) / nx, room.y + room.h * (j + .5) / ny, Math.max(room.w / nx, room.h / ny) * .8, room.light, .5);
    g.restore();
  }
  for (const p of map.props) if (p.kind === 'lamp') pool(p.x + .5, p.y + .5, 3.2, '#ffcf8a', .9);
  g.globalCompositeOperation = 'source-over';
}

/** A person from above: feet, shoulders, head and whatever they wear on it. Drawn facing +x, a little larger than life so it reads on a phone. */
function person(g: G, body: string, hat: string | null, stride: number, cap = false) {
  g.scale(1.25, 1.25);
  dot(g, '#141624', .03 + stride, -.14, .085); dot(g, '#141624', .03 - stride, .14, .085);
  g.fillStyle = body; g.strokeStyle = INK; g.lineWidth = .045; g.beginPath(); g.ellipse(0, 0, .19, .31, 0, 0, 7); g.fill(); g.stroke();
  dot(g, SKIN, .05, 0, .165); g.stroke();
  if (cap) { g.fillStyle = hat!; g.beginPath(); g.arc(.03, 0, .17, 0, 7); g.fill(); g.beginPath(); g.ellipse(.2, 0, .09, .14, 0, 0, 7); g.fill(); }
  else if (hat) { g.fillStyle = hat; g.beginPath(); g.arc(.05, 0, .168, Math.PI * .5, Math.PI * 1.5); g.fill(); }
}

export type TacticalSource = { view: View | null; time: number; me: string | null; now: number };
/** Starts drawing `live()` every frame; returns the stop function. `time` is the snapshot's server time, `now` the server clock. */
export function mountTactical(canvas: HTMLCanvasElement, live: () => TacticalSource) {
  const g = canvas.getContext('2d')!, light = document.createElement('canvas'), l = light.getContext('2d')!, lit = document.createElement('canvas'), blue = document.createElement('canvas');
  const buffer = new SnapshotBuffer<View>(100, 16, { adaptive: { minMs: 75, maxMs: 150 }, monotonic: true, resetGapMs: 500 }), poses = createPoses(), reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const walk = new Map<string, { x: number; y: number; phase: number }>(), aims = new Map<string, number>(), swing: number[] = [], cam = { x: 0, y: 0, set: false };
  let map: HeistMap | null = null, grid: Grid | null = null, gridKey = '', heist = '', pushed: View | null = null, w = 1, h = 1, dpr = 1, scale = 24, raf = 0, last = performance.now(), stopped = false;
  const resize = () => { const box = canvas.getBoundingClientRect(); w = Math.max(1, box.width); h = Math.max(1, box.height); dpr = Math.min(devicePixelRatio || 1, 2); for (const c of [canvas, light]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); } scale = Math.max(18, Math.min(40, h / 14, w / 22)); };
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
  const world = (c: G) => c.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (w / 2 - cam.x * scale), dpr * (h / 2 - cam.y * scale));
  const screen = (c: G) => c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sx = (x: number) => (x - cam.x) * scale + w / 2, sy = (y: number) => (y - cam.y) * scale + h / 2;
  const text = (s: string, x: number, y: number, size: number, fill: string, font = "'Lilita One', 'Arial Black', sans-serif") => { g.font = `${size}px ${font}`; g.lineWidth = Math.max(3, size * .24); g.strokeStyle = INK; g.strokeText(s, x, y); g.fillStyle = fill; g.fillText(s, x, y); };
  const fan = (points: readonly Point[]) => { const path = new Path2D(); points.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)); path.closePath(); return path; };
  const stride = (id: string, pose: Pose, rate: number, reduced: boolean) => { const s = walk.get(id) ?? { x: pose.x, y: pose.y, phase: 0 }; walk.set(id, s); s.phase += Math.hypot(pose.x - s.x, pose.y - s.y) * rate; s.x = pose.x; s.y = pose.y; return reduced ? 0 : Math.sin(s.phase) * .11; };
  const workPoint = (view: View, id: string): Point | null => {
    if (id === 'objective' && view.objective.taken) return view.objective;
    if (id.startsWith('revive-')) return poses.poses.get(id.slice(7)) ?? null;
    if (id.startsWith('wall-')) { const [, x, y] = id.split('-').map(Number); return { x: x + .5, y: y + .5 }; }
    return map!.objects.find(o => o.id === id) ?? null;
  };

  function frame(nowMs: number) {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const source = live(), raw = source.view, dt = Math.min(.1, (nowMs - last) / 1000), t = nowMs / 1000, reduced = reducedQuery.matches; last = nowMs;
    if (!raw || document.hidden) return;
    if (raw.heistId !== heist) {
      heist = raw.heistId; buffer.clear(); poses.clear(); walk.clear(); aims.clear(); cam.set = false; pushed = null; map = getMap(raw.mission);
      paintLit(lit, map, Math.round(Math.min(48, scale * dpr))); paintPreview(blue, map, true);
    }
    if (raw !== pushed) { pushed = raw; buffer.push(source.time, raw, nowMs); }
    const view = poses.sample(blend => buffer.sample(source.now, blend), raw), now = poses.now, m = map!, me = view.players.find(p => p.id === source.me), mine = me && poses.poses.get(me.id);
    const key = view.doors + view.broken.length;
    if (key !== gridKey || !grid) { gridKey = key; grid = buildGrid(m, view.doors, view.broken); }
    // Camera: on your thief, held inside the building.
    const hw = w / scale / 2, hh = h / scale / 2, hold = (v: number, half: number, size: number) => size <= half * 2 ? size / 2 : Math.max(half - 1, Math.min(size + 1 - half, v));
    const tx = hold(mine?.x ?? m.width / 2, hw, m.width), ty = hold(mine?.y ?? m.height / 2, hh, m.height), k = cam.set && !reduced ? 1 - Math.exp(-dt * 9) : 1;
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.set = true;
    const seen = (x: number, y: number, pad = 1) => Math.abs(x - cam.x) < hw + pad && Math.abs(y - cam.y) < hh + pad;

    // Blueprint everywhere, with the loot still lying there.
    screen(g); g.fillStyle = '#081330'; g.fillRect(0, 0, w, h); world(g); g.imageSmoothingEnabled = true; g.drawImage(blue, 0, 0, m.width, m.height);
    m.coins.forEach((c, i) => { if (view.coins[i] === '1' && seen(c.x, c.y)) dot(g, 'rgba(255,210,74,.5)', c.x, c.y, .09); });

    // Light: every thief's sight polygon, full strength near them and fading at the edge of sight. Overlaps only ever add.
    screen(l); l.globalCompositeOperation = 'source-over'; l.clearRect(0, 0, w, h); world(l);
    for (const p of view.players) {
      const pose = poses.poses.get(p.id); if (p.suspended || !pose) continue;
      const grad = l.createRadialGradient(pose.x, pose.y, 0, pose.x, pose.y, RADIUS.crewSight); grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.6, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,.12)');
      l.fillStyle = grad; l.fill(fan(sightPolygon(grid, pose, RADIUS.crewSight, view.smoke, now, -Math.PI, Math.PI, 72)));
    }
    l.globalCompositeOperation = 'source-in'; l.drawImage(lit, 0, 0, m.width, m.height);
    // Everything below belongs to the lit world and shows only where the crew sees.
    l.globalCompositeOperation = 'source-atop';
    for (const i of view.broken) { const x = i % m.width, y = Math.floor(i / m.width), [, colour] = floorAt(m, x, y); l.fillStyle = shade(colour, .8); l.fillRect(x, y, 1.02, 1.02); for (let n = 0; n < 5; n++) dot(l, n % 2 ? WALL_FACE : WALL_TOP, x + .2 + (n * .37) % .6, y + .2 + (n * .53) % .6, .07); }
    doorObjects(m).forEach((o, i) => {
      const state = view.doors[i] ?? 'c'; if (!seen(o.x, o.y)) return;
      if (o.kind === 'window') { if (state !== 'b') { if (o.horizontal) box(l, 'rgba(181,236,255,.8)', o.x - .5, o.y - .07, 1, .14, 0); else box(l, 'rgba(181,236,255,.8)', o.x - .07, o.y - .5, .14, 1, 0); } else for (let n = 0; n < 4; n++) dot(l, 'rgba(181,236,255,.8)', o.x - .3 + n * .2, o.y + (n % 2 ? .22 : -.2), .05); return; }
      swing[i] = (swing[i] ?? 0) + ((state === 'o' ? 1.4 : 0) - (swing[i] ?? 0)) * (reduced ? 1 : 1 - Math.exp(-dt * 10));
      if (state === 'b') return;
      l.save(); l.translate(o.horizontal ? o.x - .5 : o.x, o.horizontal ? o.y : o.y - .5); l.rotate((o.horizontal ? 0 : Math.PI / 2) - swing[i]);
      box(l, '#7a4a26', 0, -.09, 1, .18, .04); box(l, '#a36a3a', .05, -.05, .9, .1, .03); dot(l, state === 'l' ? '#ff4a3a' : GOLD, .78, 0, state === 'l' ? .11 : .06);
      l.restore();
    });
    for (const o of m.objects) {
      if (!seen(o.x, o.y, 8)) continue;
      const s = view.objects.find(x => x.id === o.id), state = s?.state ?? 'ready';
      if (o.kind === 'safe') { box(l, 'rgba(0,0,0,.3)', o.x - .3, o.y - .26, .7, .7, .06); box(l, '#5b6475', o.x - .38, o.y - .38, .76, .76, .08); if (state === 'ready') { dot(l, '#2c323f', o.x, o.y, .2); dot(l, '#c9d2e0', o.x, o.y, .11); line(l, '#2c323f', .04, o.x, o.y, o.x + .08, o.y - .08); } else { box(l, '#171a22', o.x - .26, o.y - .26, .52, .52, .04); line(l, '#8a94ab', .08, o.x - .38, o.y + .38, o.x - .62, o.y + .1); } }
      else if (o.kind === 'terminal') { box(l, '#2a3140', o.x - .38, o.y - .3, .76, .6, .06); box(l, state === 'ready' ? '#7df3ff' : '#1b2533', o.x - .28, o.y - .2, .56, .34, .03); if (state === 'ready' && !reduced) line(l, '#0d3b47', .03, o.x - .2, o.y - .1 + .1 * Math.sin(t * 3), o.x + .2, o.y - .1 + .1 * Math.sin(t * 3)); }
      else if (o.kind === 'medkit' && state === 'ready') { box(l, '#f2f2f2', o.x - .24, o.y - .2, .48, .4, .06); box(l, '#e0344a', o.x - .05, o.y - .14, .1, .28, 0); box(l, '#e0344a', o.x - .14, o.y - .05, .28, .1, 0); }
      else if (o.kind === 'camera' || o.kind === 'laser') {
        const f = o.facing ?? 0, on = state === 'ready';
        if (o.kind === 'laser') { const d = castRay(grid!, o.x, o.y, Math.cos(f), Math.sin(f), 40); if (on) { line(l, 'rgba(255,42,58,.35)', .22, o.x + Math.cos(f) * .5, o.y + Math.sin(f) * .5, o.x + Math.cos(f) * d, o.y + Math.sin(f) * d); line(l, `rgba(255,${reduced ? 90 : 90 + 60 * Math.sin(t * 9)},90,1)`, .06, o.x + Math.cos(f) * .5, o.y + Math.sin(f) * .5, o.x + Math.cos(f) * d, o.y + Math.sin(f) * d); } }
        else if (on) { const a = cameraAngle(o, now), meter = Math.min(1, (s?.progress ?? 0) * 4), cone = sightPolygon(grid!, o, SIGHT.cameraRange, view.smoke, now, a - SIGHT.cameraHalfAngle, a + SIGHT.cameraHalfAngle, 16); l.fillStyle = `rgba(${Math.round(127 + 128 * meter)},${Math.round(227 - 168 * meter)},${Math.round(255 - 177 * meter)},${.22 + .2 * meter})`; l.fill(fan(cone)); }
        dot(l, on ? '#ff3b4e' : '#5a6272', o.x + Math.cos(f) * .5, o.y + Math.sin(f) * .5, .13);
      } else if (o.kind === 'objective' && !view.objective.taken) { dot(l, 'rgba(255,211,107,.4)', o.x, o.y, .62 + (reduced ? 0 : .06 * Math.sin(t * 3))); l.fillStyle = GOLD; l.beginPath(); l.moveTo(o.x, o.y - .26); l.lineTo(o.x + .22, o.y); l.lineTo(o.x, o.y + .26); l.lineTo(o.x - .22, o.y); l.fill(); }
    }
    m.coins.forEach((c, i) => { if (view.coins[i] !== '1' || !seen(c.x, c.y)) return; const spin = reduced ? 1 : Math.abs(Math.cos(t * 2.4 + c.x * 1.7 + c.y * .9)); l.fillStyle = '#b8842e'; l.beginPath(); l.ellipse(c.x, c.y + .03, .13 * (.35 + .65 * spin), .13, 0, 0, 7); l.fill(); l.fillStyle = GOLD; l.beginPath(); l.ellipse(c.x, c.y, .12 * (.35 + .65 * spin), .12, 0, 0, 7); l.fill(); });
    for (const n of view.npcs) {
      const pose = poses.poses.get(n.id); if (!pose || n.state === 'stunned') continue;
      const look = n.state === 'chase' ? 'chase' : n.state === 'charmed' || n.state === 'panic' ? 'charmed' : n.kind === 'civilian' ? 'civilian' : n.state === 'patrol' ? 'calm' : 'alert', range = n.kind === 'civilian' ? SIGHT.civilianRange : SIGHT.guardRange;
      const grad = l.createRadialGradient(pose.x, pose.y, 0, pose.x, pose.y, range), strong = look === 'chase' ? .34 : look === 'alert' ? .36 : look === 'calm' ? .3 : look === 'civilian' ? .07 : .16;
      grad.addColorStop(0, `rgba(${LOOK[look]},${strong})`); grad.addColorStop(1, `rgba(${LOOK[look]},${strong * .25})`);
      const cone = fan(sightPolygon(grid, pose, range, view.smoke, now, pose.facing - SIGHT.guardHalfAngle, pose.facing + SIGHT.guardHalfAngle, 20));
      l.fillStyle = grad; l.fill(cone); l.strokeStyle = `rgba(${LOOK[look]},${look === 'chase' ? .9 : look === 'civilian' ? .22 : .55})`; l.lineWidth = .05; l.stroke(cone);
    }
    screen(g); g.drawImage(light, 0, 0, w, h); world(g);

    // Landmarks every thief knows from the plan: the getaway, and the goods wherever they are lying.
    const exit = m.objects.find(o => o.kind === 'exit')!, escape = view.phase === 'escape', beat = reduced ? .5 : .5 + .5 * Math.sin(t * (escape ? 6 : 2));
    g.strokeStyle = `rgba(92,255,176,${escape ? .7 + .3 * beat : .45 + .15 * beat})`; g.lineWidth = .09; g.setLineDash([.32, .22]); g.lineDashOffset = reduced ? 0 : -t * .5; g.beginPath(); g.arc(exit.x, exit.y, RADIUS.exit, 0, 7); g.stroke(); g.setLineDash([]);
    if (escape) dot(g, `rgba(92,255,176,${.08 + .1 * beat})`, exit.x, exit.y, RADIUS.exit);
    if (view.objective.taken && !view.objective.carrier) { dot(g, `rgba(255,211,107,${.3 + .2 * beat})`, view.objective.x, view.objective.y, .6); g.fillStyle = GOLD; g.beginPath(); g.moveTo(view.objective.x, view.objective.y - .24); g.lineTo(view.objective.x + .2, view.objective.y); g.lineTo(view.objective.x, view.objective.y + .24); g.lineTo(view.objective.x - .2, view.objective.y); g.fill(); }
    for (const i of view.intel) {
      g.strokeStyle = '#6fd8ff'; g.lineWidth = .06; g.globalAlpha = reduced ? .8 : .6 + .3 * Math.sin(t * 4 + i.x);
      if (i.kind === 'camera' || i.kind === 'laser') { g.beginPath(); g.arc(i.x, i.y, .3, 0, 7); g.stroke(); line(g, '#6fd8ff', .05, i.x, i.y, i.x + Math.cos(i.facing) * (i.kind === 'laser' ? 2 : 1.2), i.y + Math.sin(i.facing) * (i.kind === 'laser' ? 2 : 1.2)); }
      else { g.beginPath(); g.ellipse(i.x, i.y, .2, .32, i.facing, 0, 7); g.stroke(); line(g, '#6fd8ff', .05, i.x, i.y, i.x + Math.cos(i.facing) * .6, i.y + Math.sin(i.facing) * .6); }
      g.globalAlpha = 1;
    }
    for (const n of view.noises) { const [colour, ms] = NOISE[n.kind], age = now - n.at; if (age < 0 || age > ms) continue; const q = age / ms; g.globalAlpha = (1 - q) ** 1.5; g.strokeStyle = colour; g.lineWidth = .07; g.beginPath(); g.arc(n.x, n.y, .3 + (n.radius - .3) * (1 - (1 - q) ** 3), 0, 7); g.stroke(); g.globalAlpha = 1; }
    if (view.alarm && view.alarm.until > now) { const q = (now % 1100) / 1100; g.globalAlpha = 1 - q; g.strokeStyle = '#ff3b3b'; g.lineWidth = .1; g.beginPath(); g.arc(view.alarm.x, view.alarm.y, .3 + 2.9 * q, 0, 7); g.stroke(); g.globalAlpha = 1; }

    // Guards, dogs and bystanders the crew can see.
    for (const n of view.npcs) {
      const pose = poses.poses.get(n.id); if (!pose) continue;
      const stunned = n.state === 'stunned', chase = n.state === 'chase', ring = stunned ? '#6f7f9f' : chase ? '#ff2e2a' : n.state === 'patrol' ? '#ffd98a' : n.kind === 'civilian' ? '#cfe6ff' : '#ff9a2e';
      if (!n.aiming) aims.delete(n.id); else if (!aims.has(n.id)) aims.set(n.id, now);
      if (n.aiming) { const q = Math.min(1, (now - aims.get(n.id)!) / TIMING.aim); line(g, 'rgba(255,74,58,.4)', .16, pose.x, pose.y, n.aiming.x, n.aiming.y); line(g, '#ffe2d8', .06, pose.x, pose.y, n.aiming.x, n.aiming.y); g.strokeStyle = '#ff4a3a'; g.lineWidth = .08; g.beginPath(); g.arc(n.aiming.x, n.aiming.y, .7 - .3 * q, 0, 7); g.stroke(); }
      dot(g, 'rgba(0,0,0,.3)', pose.x + .04, pose.y + .08, .38); g.strokeStyle = ring; g.lineWidth = .07; g.beginPath(); g.arc(pose.x, pose.y, .48, 0, 7); g.stroke();
      g.save(); g.translate(pose.x, pose.y); g.rotate(pose.facing + (stunned ? Math.PI / 2 : n.state === 'panic' && !reduced ? Math.sin(t * 30) * .12 : 0)); if (stunned) g.globalAlpha = .8;
      if (n.kind === 'dog') { const step = stride(n.id, pose, 14, reduced); g.fillStyle = '#6a4a30'; g.strokeStyle = INK; g.lineWidth = .04; g.beginPath(); g.ellipse(-.04, 0, .3, .16, 0, 0, 7); g.fill(); g.stroke(); dot(g, '#7d5a3c', .27, 0, .14); g.stroke(); dot(g, '#3a2818', .2, -.12, .06); dot(g, '#3a2818', .2, .12, .06); line(g, '#6a4a30', .07, -.32, 0, -.46, step * 1.5); }
      else person(g, n.kind === 'guard' ? '#27407a' : CIVILIAN[hash(n.id) % CIVILIAN.length], n.kind === 'guard' ? '#16244d' : '#3a2a22', n.moving ? stride(n.id, pose, n.state === 'panic' ? 13 : 9, reduced) : 0, n.kind === 'guard');
      g.restore();
    }
    for (const s of view.smoke) {
      if (s.until <= now) continue;
      const grow = Math.min(1, (now - s.born) / 450), fade = Math.min(1, (s.until - now) / 1200), life = (1 - (1 - grow) ** 3) * fade;
      for (let i = 0; i < 9; i++) { const a = i * 2.39996 + s.born * .001, d = s.radius * (i ? .3 + .45 * ((i * 7) % 5) / 4 : 0), drift = reduced ? 0 : Math.sin(t * .7 + i) * .1; dot(g, `rgba(${200 + (i * 11) % 30},${196 + (i * 7) % 30},${222},${.5 * life})`, s.x + Math.cos(a) * d + drift, s.y + Math.sin(a) * d, s.radius * (.5 + .22 * ((i * 3) % 4) / 3) * life); }
    }
    // The crew. Your own thief wears a second, breathing ring.
    for (const p of view.players) {
      const pose = poses.poses.get(p.id); if (p.suspended || !pose) continue;
      const self = p.id === source.me, role = ROLES[p.role].color;
      if (p.carrying) dot(g, `rgba(255,210,74,${.35 + .15 * beat})`, pose.x, pose.y, .62);
      dot(g, 'rgba(0,0,0,.32)', pose.x + .04, pose.y + .08, .4);
      g.strokeStyle = p.down ? '#ff3b30' : p.color; g.lineWidth = .09; g.globalAlpha = p.hidden ? .5 : 1; g.beginPath(); g.arc(pose.x, pose.y, .5, 0, 7); g.stroke();
      if (self) { g.strokeStyle = CREAM; g.lineWidth = .08; g.beginPath(); g.arc(pose.x, pose.y, .68 + (reduced ? 0 : .06 * Math.sin(t * 4)), 0, 7); g.stroke(); }
      g.save(); g.translate(pose.x, pose.y); g.rotate(pose.facing + (p.down ? Math.PI / 2 : 0)); g.globalAlpha = p.hidden ? .45 : p.connected ? 1 : .6;
      person(g, p.disguised ? '#27407a' : shade(role, .5), p.disguised ? '#16244d' : role, p.moving ? stride(p.id, pose, 9, reduced) : 0, p.disguised);
      if (p.carrying) { g.fillStyle = GOLD; g.beginPath(); g.moveTo(-.2, -.12); g.lineTo(-.08, 0); g.lineTo(-.2, .12); g.lineTo(-.32, 0); g.fill(); }
      g.restore(); g.globalAlpha = 1;
      if (p.role === 'magpie' && !p.down) { const a = t * 2.1 + p.seat; dot(g, '#1d1b24', pose.x + Math.cos(a) * .75, pose.y + Math.sin(a) * .75, .1); dot(g, '#f2f2f2', pose.x + Math.cos(a) * .75 + .04, pose.y + Math.sin(a) * .75, .05); }
    }
    for (const s of view.shots) {
      const age = now - s.at, ms = s.kind === 'shotgun' ? 320 : 260; if (age < 0 || age > ms) continue;
      g.globalAlpha = 1 - age / ms;
      if (s.kind === 'shotgun') { const base = Math.atan2(s.to.y - s.from.y, s.to.x - s.from.x); for (let i = -2; i <= 2; i++) line(g, SHOT.shotgun, .08, s.from.x, s.from.y, s.from.x + Math.cos(base + i * Math.PI / 14) * 4.2, s.from.y + Math.sin(base + i * Math.PI / 14) * 4.2); }
      else line(g, SHOT[s.kind], s.kind === 'guard' ? .1 : .06, s.from.x, s.from.y, s.to.x, s.to.y);
      g.globalAlpha = 1;
    }

    // Screen space: icons over heads, work rings, floating words, and arrows to what is off the screen.
    screen(g); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const u = scale / 26;
    for (const n of view.npcs) {
      const pose = poses.poses.get(n.id); if (!pose) continue;
      const x = sx(pose.x), y = sy(pose.y) - 24 * u;
      if (n.state === 'stunned') { text('z z', x, y, 13 * u, '#e4f2ff'); continue; }
      if (n.state === 'charmed') { text('♥', x, y, 16 * u, '#ff7ad0', 'Nunito, sans-serif'); continue; }
      if (n.state === 'panic') { text('!!', x, y, 16 * u, '#ff8ad8'); continue; }
      const chase = n.state === 'chase'; if (!chase && n.state === 'patrol' && n.suspicion < .05) continue;
      const colour = chase ? '#ff3b30' : n.state === 'suspicious' || n.state === 'patrol' ? '#ffd23a' : '#ff9a2e', q = chase ? 1 : Math.max(.15, n.suspicion), r = 10 * u * (chase && !reduced ? 1 + .12 * Math.max(0, Math.sin(t * 14)) : 1);
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = 'rgba(5,7,26,.85)'; g.fill(); g.save(); g.clip(); g.fillStyle = colour; g.fillRect(x - r, y + r - 2 * r * q, 2 * r, 2 * r * q); g.restore(); g.strokeStyle = colour; g.lineWidth = 2 * u; g.stroke();
      text(chase ? '!' : '?', x, y + 1, 13 * u, '#ffffff');
    }
    for (const p of view.players) {
      const pose = poses.poses.get(p.id); if (p.suspended || !pose) continue;
      if (p.work && !p.down) { const at = workPoint(view, p.work.target) ?? pose, x = sx(at.x), y = sy(at.y) - 4 * u; g.lineCap = 'round'; g.beginPath(); g.arc(x, y, 13 * u, 0, 7); g.strokeStyle = 'rgba(5,7,26,.75)'; g.lineWidth = 7 * u; g.stroke(); g.beginPath(); g.arc(x, y, 13 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, p.work.progress))); g.strokeStyle = p.color; g.lineWidth = 4 * u; g.stroke(); }
      const x = sx(pose.x), y = sy(pose.y) - 25 * u, r = 8.5 * u;
      g.beginPath(); g.arc(x, y, r + 2, 0, 7); g.fillStyle = INK; g.fill(); g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = p.down ? '#ff3b30' : p.color; g.fill();
      g.font = `${11 * u}px 'Lilita One', sans-serif`; g.fillStyle = p.down ? '#fff' : INK; g.fillText(p.down ? '+' : String(p.seat + 1), x, y + 1);
      // Your own thief always wears a marker; it also says YOU for the first seconds.
      if (p.id === source.me) { const bob = reduced ? 0 : Math.sin(t * 4) * 2 * u, top = y - r - 5 * u + bob; g.fillStyle = CREAM; g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.moveTo(x, top); g.lineTo(x - 6 * u, top - 8 * u); g.lineTo(x + 6 * u, top - 8 * u); g.closePath(); g.fill(); g.stroke(); if (view.elapsed < 6) text('YOU', x, top - 17 * u, 11 * u, CREAM); }
    }
    const stack: number[] = [];
    for (const e of view.effects) {
      const age = (now - e.at) / 1000; if (!e.label || age < 0 || age > 1.4) continue;
      let x = sx(e.x), y = sy(e.y) - 34 * u - (1 - (1 - Math.min(1, age / 1.2)) ** 3) * 18 * u;
      for (let i = 0; i < stack.length; i += 2) if (Math.abs(stack[i] - x) < 60 * u && Math.abs(stack[i + 1] - y) < 13 * u) { y = stack[i + 1] - 14 * u; i = -2; }
      stack.push(x, y); x = Math.max(40, Math.min(w - 40, x));
      g.globalAlpha = age > 1 ? Math.max(0, 1 - (age - 1) / .4) : 1; text(e.label, x, y, 13 * u, LABEL[e.kind] ?? CREAM); g.globalAlpha = 1;
    }
    const pin = (p: Point, colour: string, label: string) => {
      const x = sx(p.x), y = sy(p.y), top = 50, pad = 22; if (x > pad && x < w - pad && y > top && y < h - pad) return;
      const dx = x - w / 2, dy = y - h / 2, q = Math.min((w / 2 - pad) / Math.abs(dx || 1e-6), (dy < 0 ? h / 2 - top : h / 2 - pad) / Math.abs(dy || 1e-6)), ex = w / 2 + dx * q, ey = h / 2 + dy * q, a = Math.atan2(dy, dx);
      g.fillStyle = colour; g.beginPath(); g.moveTo(ex + Math.cos(a) * 17, ey + Math.sin(a) * 17); g.lineTo(ex + Math.cos(a + 2.2) * 12, ey + Math.sin(a + 2.2) * 12); g.lineTo(ex + Math.cos(a - 2.2) * 12, ey + Math.sin(a - 2.2) * 12); g.fill();
      g.beginPath(); g.arc(ex, ey, 11, 0, 7); g.fillStyle = INK; g.fill(); g.strokeStyle = colour; g.lineWidth = 2.5; g.stroke(); g.font = "12px 'Lilita One', sans-serif"; g.fillStyle = colour; g.fillText(label, ex, ey + 1);
    };
    if (!view.objective.carrier) pin(view.objective.taken ? view.objective : m.objects.find(o => o.kind === 'objective')!, GOLD, '◆');
    if (view.objective.taken) pin(exit, '#5cffb0', '➜');
    for (const p of view.players) { const pose = poses.poses.get(p.id); if (pose && p.id !== source.me && !p.suspended) pin(pose, p.down ? '#ff3b30' : p.color, p.down ? '+' : String(p.seat + 1)); }
    const danger = view.alarm && view.alarm.until > now ? .16 + (reduced ? .06 : .1 * (.5 + .5 * Math.sin(t * 7))) : 0, hurt = me && !me.down && me.health <= 35 ? .2 : 0;
    if (danger || hurt || me?.down) { const edge = g.createRadialGradient(w / 2, h / 2, h * .35, w / 2, h / 2, Math.max(w, h) * .62); edge.addColorStop(0, 'rgba(255,40,40,0)'); edge.addColorStop(1, `rgba(255,40,40,${me?.down ? .42 : Math.max(danger, hurt)})`); g.fillStyle = edge; g.fillRect(0, 0, w, h); }
  }
  raf = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(raf); observer.disconnect(); };
}
