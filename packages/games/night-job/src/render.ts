/* Night Job renderer. Flat overhead pixel art on a 2D canvas, 16 art pixels per tile.
 * Floors run continuously under thin architectural wall cores, the way a plan drawing reads. Two cached
 * paintings per map+scale: a muted hatched schematic (what the crew knows of the building) and the
 * full-colour interior (what the crew can currently see). Each frame draws the schematic, clips to
 * `view.visible`, draws the colour painting and danger cones through the clip, rims the sight edge, then
 * actors, effects and glyphs. Only what the server projects is drawn: absent guards do not exist here. */
import { visibleCells } from './geometry';
import { ROLES, SIGHT, type Effect, type GuardView, type HeistMap, type ObjectView, type PlayerView, type Point, type Prop, type Room, type View } from './model';

export const TILE = 16;
type G = CanvasRenderingContext2D;
const INK = '#0a0c17', SKIN = '#f0c8a0', OUTLINE = '#0b0d1a';
const SCHEME = { floor: '#1c2030', hatch: '#222738', wall: '#5d6480', edge: '#8b93b3', glass: '#3a4a6a', water: '#182238', prop: '#2a2f44', propEdge: '#414862', text: '#9aa2c2', pill: '#10131fcc' };
const LIT = { wall: '#2b2540', wallTop: '#9c8ccb', wallSide: '#4b4166', wallBase: '#17121f', glass: '#a5dcf0', frame: '#3d5570', water: '#2a62aa', ripple: '#6fb0ec', crack: '#120d1c' };
const FLOORS: Record<Room['floor'], [string, string, string]> = { tile: ['#cfc4b2', '#b9ae9c', '#a3987f'], carpet: ['#7e2f42', '#6c2637', '#c99a5a'], wood: ['#a06a38', '#84522a', '#c48c50'], garden: ['#4a8637', '#3e7430', '#8fc45a'], concrete: ['#7f838a', '#70747c', '#9a9ea6'] };
const hash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;
const hex = (c: string) => c.startsWith('rgb') ? c.match(/[\d.]+/g)!.slice(0, 3).map(Number) : [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
export const mix = (a: string, b: string, t: number) => { const [p, q] = [hex(a), hex(b)]; return `rgb(${p.map((v, i) => Math.round(v + (q[i] - v) * t)).join(',')})`; };
const rgba = (c: string, a: number) => `rgba(${hex(c).join(',')},${a})`;
const px = (g: G, x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const roomAt = (map: HeistMap, x: number, y: number) => map.rooms.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
const cell = (tiles: string[], x: number, y: number) => tiles[y]?.[x] ?? ' ';
const isWall = (t: string) => t === '#' || t === '%';
const joins = (t: string) => isWall(t) || t === '=';
const INSET = 3;

/* ── static world paintings ─────────────────────────────────────────────── */
/** Floors under everything. Wall tiles borrow the room of a neighbouring floor so the plan reads continuous. */
function paintFloor(g: G, map: HeistMap, tiles: string[], x: number, y: number, lit: boolean) {
  const X = x * TILE, Y = y * TILE, h = hash(x, y), t = cell(tiles, x, y);
  if (t === '~') {
    px(g, X, Y, TILE, TILE, lit ? LIT.water : SCHEME.water);
    for (let i = 0; i < 2; i++) px(g, X + 2 + ((h >> (i * 4)) & 7), Y + 3 + i * 7 + ((h >> (i + 9)) & 1), 4, 1, lit ? LIT.ripple : '#263352');
    if (lit && !'~'.includes(cell(tiles, x, y - 1))) px(g, X, Y, TILE, 2, '#8fd0ff88');
    return;
  }
  if (!lit) {
    px(g, X, Y, TILE, TILE, SCHEME.floor);
    g.fillStyle = SCHEME.hatch; for (let i = -TILE; i < TILE; i += 6) for (let k = 0; k < TILE; k++) { const hx = i + k; if (hx >= 0 && hx < TILE) g.fillRect(X + hx, Y + k, 1, 1); }
    return;
  }
  const room = roomAt(map, x, y) ?? roomAt(map, x - 1, y) ?? roomAt(map, x + 1, y) ?? roomAt(map, x, y - 1) ?? roomAt(map, x, y + 1);
  const floor = room?.floor ?? 'concrete', [a, b, c] = FLOORS[floor], tone = room?.tone ?? '#4a4f5c';
  const base = mix(a, tone, .38), alt = mix(b, tone, .42), accent = mix(c, tone, .25);
  px(g, X, Y, TILE, TILE, base);
  switch (floor) {
    case 'tile': px(g, X, Y, 8, 8, alt); px(g, X + 8, Y + 8, 8, 8, alt); px(g, X, Y + 7, TILE, 1, mix(alt, '#000000', .18)); px(g, X + 7, Y, 1, TILE, mix(alt, '#000000', .18)); px(g, X, Y + 15, TILE, 1, mix(alt, '#000000', .25)); px(g, X + 15, Y, 1, TILE, mix(alt, '#000000', .25)); break;
    case 'carpet': { for (let i = 0; i < 4; i++) px(g, X + 2 + (i % 2) * 8 + ((h >> i) & 1), Y + 2 + (i >> 1) * 8 + ((h >> (i + 2)) & 1), 2, 2, alt); if (room && (x === room.x || x === room.x + room.w - 1)) px(g, X + (x === room.x ? 2 : 13), Y, 1, TILE, accent); if (room && (y === room.y || y === room.y + room.h - 1)) px(g, X, Y + (y === room.y ? 2 : 13), TILE, 1, accent); break; }
    case 'wood': { const shift = (y % 2) * 8; for (let i = 0; i < TILE; i += 4) px(g, X, Y + i + 3, TILE, 1, alt); px(g, X + ((shift + 3) % TILE), Y, 1, 4, alt); px(g, X + ((shift + 11) % TILE), Y + 8, 1, 4, alt); px(g, X + ((h >> 2) & 15), Y + ((h >> 6) & 3) * 4 + 1, 2, 1, accent); break; }
    case 'garden': { for (let i = 0; i < 7; i++) px(g, X + ((h >> (i * 2)) & 15), Y + ((h >> (i * 3 + 1)) & 15), 1, 2, i % 3 ? alt : accent); if (!(h % 11)) { px(g, X + 6, Y + 6, 2, 2, ['#f7d35a', '#f08ab0', '#ffffff'][h % 3]); px(g, X + 6, Y + 8, 2, 1, '#2f6a2a'); } break; }
    default: { for (let i = 0; i < 5; i++) px(g, X + ((h >> (i * 3)) & 15), Y + ((h >> (i * 2 + 5)) & 15), 1, 1, alt); if (!(x % 4)) px(g, X, Y, 1, TILE, alt); if (!(y % 4)) px(g, X, Y, TILE, 1, alt); if (!(h % 13)) { px(g, X + 3, Y + 9, 6, 1, mix(base, '#000000', .3)); px(g, X + 8, Y + 10, 3, 1, mix(base, '#000000', .3)); } }
  }
}

/** Thin wall, glass and cracked-wall cores. A core reaches the tile edge only toward another core, so runs join. */
function paintStructure(g: G, tiles: string[], x: number, y: number, lit: boolean) {
  const t = cell(tiles, x, y); if (!joins(t)) return;
  const X = x * TILE, Y = y * TILE, h = hash(x, y);
  const l = joins(cell(tiles, x - 1, y)) ? 0 : INSET, r = joins(cell(tiles, x + 1, y)) ? 0 : INSET, u = joins(cell(tiles, x, y - 1)) ? 0 : INSET, d = joins(cell(tiles, x, y + 1)) ? 0 : INSET;
  const cx = X + l, cy = Y + u, cw = TILE - l - r, ch = TILE - u - d;
  // The plinth marks the whole solid tile, even where the raised wall core is inset.
  px(g, X, Y, TILE, TILE, lit ? '#14101e80' : '#0c0e1a73');
  if (t === '=') {
    px(g, cx, cy, cw, ch, lit ? LIT.frame : SCHEME.glass); px(g, cx + 2, cy + 2, cw - 4, ch - 4, lit ? rgba(LIT.glass, .85) : '#2c3a58');
    if (lit) { px(g, cx + 3, cy + 3, 1, Math.max(1, ch - 7), '#ffffffb0'); px(g, cx + 5, cy + 3, 1, Math.max(1, (ch - 7) >> 1), '#ffffff66'); } else for (let i = 3; i < cw - 2; i += 4) px(g, cx + i, cy + (ch >> 1), 2, 1, SCHEME.edge);
    return;
  }
  if (lit) {
    px(g, cx, cy + 1, cw, ch + 2, LIT.wallBase);
    if (d) px(g, cx - 1, cy + ch, cw + 2, 3, '#00000055');
    px(g, cx, cy, cw, ch, LIT.wall);
    if (u) px(g, cx, cy, cw, 1, LIT.wallTop); if (l) px(g, cx, cy, 1, ch, LIT.wallSide); if (r) px(g, cx + cw - 1, cy, 1, ch, mix(LIT.wall, '#000000', .35)); if (d) px(g, cx, cy + ch - 1, cw, 1, mix(LIT.wall, '#000000', .45));
    if (t === '%') for (let i = 0; i < 4; i++) px(g, cx + 1 + ((h >> i) & 7) % Math.max(1, cw - 2), cy + 1 + ((h >> (i + 3)) % Math.max(1, ch - 2)), 2, 1, LIT.crack);
  } else {
    px(g, cx, cy, cw, ch, SCHEME.wall);
    if (u) px(g, cx, cy, cw, 1, SCHEME.edge); if (l) px(g, cx, cy, 1, ch, SCHEME.edge);
    if (t === '%') for (let i = 0; i < 4; i++) px(g, cx + 1 + ((h >> i) & 7) % Math.max(1, cw - 2), cy + 1 + ((h >> (i + 3)) % Math.max(1, ch - 2)), 2, 1, '#3a3f55');
  }
}

function paintProp(g: G, p: Prop, lit: boolean) {
  const w = (p.w ?? 1) * TILE, h = (p.h ?? 1) * TILE, X = Math.round((p.x - .5) * TILE), Y = Math.round((p.y - .5) * TILE), k = hash(X, Y);
  if (!lit) {
    const inset = p.kind === 'rug' ? 1 : 3; px(g, X + inset, Y + inset, w - inset * 2, h - inset * 2, SCHEME.prop);
    g.strokeStyle = SCHEME.propEdge; g.lineWidth = 1; g.strokeRect(X + inset + .5, Y + inset + .5, w - inset * 2 - 1, h - inset * 2 - 1); return;
  }
  const body = (ix: number, iy: number, iw: number, ih: number, fill: string) => { px(g, ix + 1, iy + 2, iw, ih, '#00000045'); px(g, ix - 1, iy - 1, iw + 2, ih + 2, OUTLINE); px(g, ix, iy, iw, ih, fill); };
  switch (p.kind) {
    case 'rug': { px(g, X + 1, Y + 1, w - 2, h - 2, '#5b2438'); px(g, X + 2, Y + 2, w - 4, h - 4, '#8a3a52'); px(g, X + 4, Y + 4, w - 8, h - 8, '#7a3048'); for (let i = 5; i < w - 5; i += 4) { px(g, X + i, Y + 2, 2, 1, '#e5b96a'); px(g, X + i, Y + h - 3, 2, 1, '#e5b96a'); } for (let i = 5; i < h - 5; i += 4) { px(g, X + 2, Y + i, 1, 2, '#e5b96a'); px(g, X + w - 3, Y + i, 1, 2, '#e5b96a'); } px(g, X + w / 2 - 4, Y + h / 2 - 4, 8, 8, '#c96a80'); px(g, X + w / 2 - 2, Y + h / 2 - 2, 4, 4, '#e5b96a'); px(g, X + w / 2 - 1, Y + h / 2 - 1, 2, 2, '#5b2438'); break; }
    case 'table': { body(X + 2, Y + 2, w - 4, h - 4, '#6b4222'); px(g, X + 3, Y + 3, w - 6, h - 6, '#9a6a3a'); px(g, X + 4, Y + 4, w - 8, 1, '#c59a63'); px(g, X + 4, Y + 4, 1, h - 8, '#c59a63'); if (w >= 32) { px(g, X + w / 2 - 4, Y + h / 2 - 3, 8, 5, '#f2ecd8'); px(g, X + w / 2 - 3, Y + h / 2 - 2, 6, 1, '#c9b9a0'); px(g, X + w / 2 + 5, Y + h / 2 - 6, 2, 4, '#4fbf7a'); px(g, X + w / 2 + 4, Y + h / 2 - 2, 4, 1, '#2f7a3a'); } break; }
    case 'chair': { body(X + 5, Y + 5, 6, 6, '#7a4a28'); px(g, X + 6, Y + 6, 4, 4, '#b07a4a'); px(g, X + 4, Y + 3, 8, 2, '#5c3418'); px(g, X + 5, Y + 4, 6, 1, '#8a5a30'); break; }
    case 'plant': { body(X + 5, Y + 10, 6, 4, '#8a4a2a'); px(g, X + 6, Y + 13, 4, 1, '#5c2e14'); px(g, X + 6, Y + 10, 4, 1, '#b06a3a'); for (const [dx, dy, c] of [[3, 4, '#2f7a3a'], [8, 2, '#3f9a4a'], [5, 7, '#2a6a33'], [10, 6, '#3a8a44'], [7, 0, '#5cb85a']] as const) { px(g, X + dx - 1, Y + dy - 1, 6, 6, OUTLINE); px(g, X + dx, Y + dy, 4, 4, c); } px(g, X + 8, Y + 4, 1, 1, '#a8e37a'); px(g, X + 4, Y + 6, 1, 1, '#a8e37a'); break; }
    case 'sofa': { body(X + 1, Y + 3, w - 2, h - 5, '#3c5f8f'); px(g, X + 1, Y + 3, w - 2, 3, '#2c4a73'); for (let i = 3; i < w - 3; i += 8) { px(g, X + i, Y + 7, 6, h - 10, '#5a83ba'); px(g, X + i + 1, Y + 8, 4, 1, '#7aa0d0'); } px(g, X + 1, Y + 3, 2, h - 5, '#2c4a73'); px(g, X + w - 3, Y + 3, 2, h - 5, '#2c4a73'); break; }
    case 'desk': { body(X + 1, Y + 3, w - 2, h - 5, '#4d3220'); px(g, X + 2, Y + 4, w - 4, h - 7, '#7c5433'); px(g, X + 2, Y + 4, w - 4, 1, '#a07848'); px(g, X + 4, Y + 6, 7, 5, '#efe7d2'); px(g, X + 5, Y + 7, 5, 1, '#9aa'); px(g, X + 5, Y + 9, 4, 1, '#9aa'); px(g, X + w - 12, Y + 5, 8, 6, '#2b3a52'); px(g, X + w - 11, Y + 6, 6, 4, '#4fd8ff'); px(g, X + w - 10, Y + 7, 3, 1, '#c8f4ff'); break; }
    case 'shelf': { body(X + 1, Y + 1, w - 2, h - 2, '#4a2e18'); for (let row = 3; row < h - 3; row += 6) { for (let i = 3; i < w - 3; i += 3) px(g, X + i, Y + row, 2, 4, ['#c74a3a', '#3a7ac7', '#e0b34a', '#4aa86a', '#8a5ac7', '#efe7d2'][(k >> (i + row)) % 6]); px(g, X + 2, Y + row + 4, w - 4, 1, '#2e1a0c'); } break; }
    case 'crate': { body(X + 2, Y + 2, w - 4, h - 4, '#8a6535'); px(g, X + 3, Y + 3, w - 6, h - 6, '#b48a4c'); px(g, X + 3, Y + 3, w - 6, 1, '#d0a866'); g.strokeStyle = '#6a4a22'; g.lineWidth = 1; g.beginPath(); g.moveTo(X + 3.5, Y + 3.5); g.lineTo(X + w - 3.5, Y + h - 3.5); g.moveTo(X + w - 3.5, Y + 3.5); g.lineTo(X + 3.5, Y + h - 3.5); g.stroke(); break; }
    case 'statue': { body(X + 3, Y + 9, 10, 5, '#7f8391'); px(g, X + 4, Y + 10, 8, 1, '#b3b7c4'); px(g, X + 5, Y + 2, 6, 8, OUTLINE); px(g, X + 6, Y + 3, 4, 6, '#cfd3dd'); px(g, X + 7, Y + 1, 2, 2, '#e6e9f0'); px(g, X + 5, Y + 4, 1, 3, '#cfd3dd'); px(g, X + 10, Y + 5, 1, 2, '#cfd3dd'); px(g, X + 7, Y + 4, 1, 3, '#e6e9f0'); break; }
    case 'water': { body(X + 1, Y + 1, w - 2, h - 2, '#5b6a7a'); px(g, X + 3, Y + 3, w - 6, h - 6, '#2f6fb5'); for (let i = 5; i < w - 5; i += 6) px(g, X + i, Y + 6 + (i % 4), 3, 1, '#7fc0f0'); px(g, X + w / 2 - 1, Y + h / 2 - 1, 2, 2, '#c8e8ff'); px(g, X + 2, Y + 2, w - 4, 1, '#8a97a8'); break; }
    case 'bar': { body(X + 1, Y + 4, w - 2, h - 6, '#3a1e12'); px(g, X + 1, Y + 4, w - 2, 3, '#7a4a2a'); px(g, X + 2, Y + 5, w - 4, 1, '#c08a55'); for (let i = 4; i < w - 4; i += 5) { px(g, X + i, Y + 9, 2, 4, ['#4fd8ff', '#ffd24a', '#78d955', '#ff5748'][(k >> i) & 3]); px(g, X + i, Y + 8, 2, 1, '#e8e8f0'); px(g, X + i, Y + 10, 1, 1, '#ffffff80'); } break; }
  }
}

function label(g: G, text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', font = 'Nunito', backdrop?: string) {
  g.font = `900 ${size}px ${font}, sans-serif`; g.textAlign = align; g.textBaseline = 'middle';
  if (backdrop) { const w = g.measureText(text).width + size, h = size * 1.5, bx = align === 'center' ? x - w / 2 : align === 'left' ? x - size / 2 : x - w + size / 2; g.fillStyle = backdrop; g.beginPath(); if (typeof g.roundRect === 'function') g.roundRect(bx, y - h / 2, w, h, h / 2); else g.rect(bx, y - h / 2, w, h); g.fill(); }
  g.fillStyle = '#05071acc'; g.fillText(text, x + 1, y + 1); g.fillStyle = color; g.fillText(text, x, y);
}

/** One offscreen painting of the whole floor at scale `S`, in device pixels. */
function paintWorld(map: HeistMap, tiles: string[], S: number, lit: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = map.width * TILE * S; c.height = map.height * TILE * S;
  const g = c.getContext('2d')!; g.imageSmoothingEnabled = false; g.setTransform(S, 0, 0, S, 0, 0);
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) paintFloor(g, map, tiles, x, y, lit);
  if (lit) for (const r of map.rooms) { const cx = (r.x + r.w / 2) * TILE, cy = (r.y + r.h / 2) * TILE, glow = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(r.w, r.h) * TILE * .65); glow.addColorStop(0, '#fff2cc1f'); glow.addColorStop(.6, '#fff2cc00'); glow.addColorStop(1, '#05071a33'); g.fillStyle = glow; g.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE); }
  for (const prop of map.props) paintProp(g, prop, lit);
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) paintStructure(g, tiles, x, y, lit);
  if (!lit) { g.setTransform(1, 0, 0, 1, 0, 0); for (const r of map.rooms) label(g, r.name, (r.x + r.w / 2) * TILE * S, (r.y + r.h / 2) * TILE * S, Math.max(9, 5 * S), SCHEME.text, 'center', 'Nunito', SCHEME.pill); }
  return c;
}

/** Full-colour floor plan for lobby and settings cards, one canvas pixel per art pixel. */
export function paintPreview(canvas: HTMLCanvasElement, map: HeistMap) {
  canvas.width = map.width * TILE; canvas.height = map.height * TILE;
  const g = canvas.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(paintWorld(map, map.tiles, 1, true), 0, 0);
  for (const o of map.objects) drawObject(g, { ...o, state: 'ready', until: 0 }, map.tiles, true, 0, true, 'infiltrate');
  for (const l of map.loot) drawLoot(g, l, true, 0, true);
}

/* ── dynamic drawing (art-pixel space under the S transform) ────────────── */
const doorHorizontal = (tiles: string[], o: Point) => joins(cell(tiles, Math.floor(o.x) - 1, Math.floor(o.y))) && joins(cell(tiles, Math.floor(o.x) + 1, Math.floor(o.y)));
function drawObject(g: G, o: ObjectView, tiles: string[], lit: boolean, t: number, calm: boolean, phase: View['phase']) {
  const X = Math.floor(o.x) * TILE, Y = Math.floor(o.y) * TILE, off = o.state === 'disabled', grey = (c: string) => lit ? c : SCHEME.edge;
  const boxed = (ix: number, iy: number, iw: number, ih: number, fill: string) => { if (lit) { px(g, ix + 1, iy + 2, iw, ih, '#00000045'); px(g, ix - 1, iy - 1, iw + 2, ih + 2, OUTLINE); } px(g, ix, iy, iw, ih, fill); };
  switch (o.kind) {
    case 'door': {
      const open = o.state === 'open', wood = grey('#8a5a2e'), light = grey('#c48d4f'), dark = grey('#5a3618');
      if (doorHorizontal(tiles, o)) {
        if (open) { px(g, X, Y + INSET, 3, TILE - INSET * 2, wood); px(g, X + 13, Y + INSET, 3, TILE - INSET * 2, wood); px(g, X + 3, Y - 7, 3, 10, wood); px(g, X + 3, Y - 7, 1, 10, light); }
        else { px(g, X, Y + INSET, TILE, TILE - INSET * 2, wood); px(g, X, Y + INSET, TILE, 1, light); px(g, X, Y + TILE - INSET - 1, TILE, 1, dark); px(g, X + 7, Y + INSET + 1, 1, TILE - INSET * 2 - 2, dark); px(g, X + 10, Y + 7, 2, 2, grey('#ffd24a')); }
      } else if (open) { px(g, X + INSET, Y, TILE - INSET * 2, 3, wood); px(g, X + INSET, Y + 13, TILE - INSET * 2, 3, wood); px(g, X - 7, Y + 3, 10, 3, wood); px(g, X - 7, Y + 3, 10, 1, light); }
      else { px(g, X + INSET, Y, TILE - INSET * 2, TILE, wood); px(g, X + INSET, Y, 1, TILE, light); px(g, X + TILE - INSET - 1, Y, 1, TILE, dark); px(g, X + INSET + 1, Y + 7, TILE - INSET * 2 - 2, 1, dark); px(g, X + 7, Y + 10, 2, 2, grey('#ffd24a')); }
      return;
    }
    case 'safe': { boxed(X + 3, Y + 3, 10, 10, grey('#4f5563')); px(g, X + 4, Y + 4, 8, 8, grey(o.state === 'ready' ? '#7c8391' : '#2a2f3a')); px(g, X + 4, Y + 4, 8, 1, grey('#a3a9b8')); if (o.state === 'ready') { px(g, X + 7, Y + 7, 2, 2, grey('#e8ecf5')); px(g, X + 6, Y + 6, 1, 1, grey('#ffd24a')); px(g, X + 11, Y + 6, 1, 4, grey('#ffd24a')); } else if (o.state === 'open') { px(g, X + 5, Y + 5, 6, 6, grey('#ffd24a')); px(g, X + 6, Y + 6, 2, 2, '#fff6c0'); px(g, X + 12, Y + 3, 3, 10, grey('#4f5563')); } return; }
    case 'terminal': { boxed(X + 3, Y + 4, 10, 8, grey('#2a2f3c')); px(g, X + 4, Y + 5, 8, 5, lit ? (off ? '#171a24' : o.state === 'open' ? '#8cff6a' : '#3ee6ff') : SCHEME.edge); if (lit && !off) { px(g, X + 5, Y + 6 + (calm ? 0 : Math.floor(t / 300) % 3), 6, 1, '#ffffff90'); px(g, X + 5, Y + 6, 2, 1, '#ffffffcc'); } px(g, X + 6, Y + 12, 4, 2, grey('#3a4050')); return; }
    case 'camera': { boxed(X + 5, Y + 5, 6, 6, grey('#3a3f52')); px(g, X + 6, Y + 6, 4, 4, grey('#5a6075')); px(g, X + 7, Y + 7, 2, 2, lit ? (off ? '#333' : calm || Math.floor(t / 500) % 2 ? '#ff2d3a' : '#7a1520') : SCHEME.edge); return; }
    case 'laser': { boxed(X + 5, Y + 5, 6, 6, grey('#3a2f3f')); px(g, X + 7, Y + 7, 2, 2, lit ? (off ? '#552' : '#ff2d3a') : SCHEME.edge); return; }
    case 'objective': {
      if (o.state !== 'ready') { g.strokeStyle = grey('#a08a40'); g.lineWidth = 1; g.setLineDash([2, 2]); g.strokeRect(X + 3.5, Y + 4.5, 9, 7); g.setLineDash([]); return; }
      if (lit) { g.save(); g.globalCompositeOperation = 'lighter'; const glow = g.createRadialGradient(X + 8, Y + 8, 1, X + 8, Y + 8, 12); glow.addColorStop(0, 'rgba(255,210,74,.45)'); glow.addColorStop(1, 'rgba(255,210,74,0)'); g.fillStyle = glow; g.fillRect(X - 4, Y - 4, 24, 24); g.restore(); }
      boxed(X + 3, Y + 5, 10, 7, grey('#c9962e')); px(g, X + 4, Y + 6, 8, 5, grey('#ffd24a')); px(g, X + 6, Y + 3, 4, 2, grey('#8a5a1a')); px(g, X + 7, Y + 8, 2, 1, grey('#8a5a1a')); px(g, X + 4, Y + 6, 8, 1, grey('#fff1a8'));
      if (lit) { const s = calm ? 0 : Math.sin(t / 200); px(g, X + 12 + (s > .3 ? 1 : 0), Y + 3, 1, 1, '#fff'); px(g, X + 2, Y + 11 - (s < -.3 ? 1 : 0), 1, 1, '#fff'); if (s > .6) px(g, X + 8, Y + 1, 1, 1, '#fff'); } return;
    }
    case 'exit': {
      const escape = phase === 'escape', c = grey(escape ? '#9dff70' : '#78d955'), pulse = calm ? 0 : Math.floor(t / (escape ? 220 : 400)) % 3;
      if (lit) { g.fillStyle = escape ? 'rgba(120,217,85,.22)' : 'rgba(120,217,85,.12)'; g.fillRect(X - TILE, Y - TILE, TILE * 3, TILE * 3); }
      g.strokeStyle = lit ? (escape ? 'rgba(157,255,112,.95)' : 'rgba(120,217,85,.7)') : SCHEME.edge; g.lineWidth = 1; g.setLineDash([3, 2]); g.lineDashOffset = calm ? 0 : -Math.floor(t / 80) % 5; g.strokeRect(X - TILE + 1.5, Y - TILE + 1.5, TILE * 3 - 3, TILE * 3 - 3); g.setLineDash([]); g.lineDashOffset = 0;
      for (const [dx, dy, ax, ay] of [[-TILE + 2, 0, 1, 0], [TILE * 2 - 4, 0, -1, 0], [0, -TILE + 2, 0, 1], [0, TILE * 2 - 4, 0, -1]] as const) for (let i = 0; i < 3; i++) { const k = (i + pulse) % 3, bx = X + 7 + dx + ax * k * 3, by = Y + 7 + dy + ay * k * 3; if (k === 0 || lit) px(g, bx, by, 2, 2, k === 0 ? grey('#fff6e5') : c); }
      px(g, X + 5, Y + 5, 6, 6, grey(escape ? '#9dff70' : '#5fbf45')); px(g, X + 7, Y + 7, 2, 2, grey('#fff6e5')); return;
    }
    case 'medkit': { boxed(X + 4, Y + 5, 8, 7, grey(o.state === 'ready' ? '#f2f2f4' : '#6a6c72')); if (o.state === 'ready') { px(g, X + 7, Y + 6, 2, 5, grey('#ff2d3a')); px(g, X + 5, Y + 8, 6, 1, grey('#ff2d3a')); } return; }
    case 'hide': {
      if (lit) { g.fillStyle = OUTLINE; g.beginPath(); g.arc(X + 8, Y + 9, 8, 0, 7); g.fill(); for (const [dx, dy, c] of [[1, 5, '#2b6a35'], [7, 2, '#3a8a44'], [4, 8, '#2f7a3a'], [9, 8, '#3f9a4a'], [5, 4, '#57b05a']] as const) { g.fillStyle = c; g.beginPath(); g.arc(X + dx + 3, Y + dy + 3, 4, 0, 7); g.fill(); } px(g, X + 6, Y + 6, 1, 1, '#a8e37a'); px(g, X + 11, Y + 4, 1, 1, '#a8e37a'); }
      else { g.fillStyle = SCHEME.prop; g.beginPath(); g.arc(X + 8, Y + 8, 6, 0, 7); g.fill(); g.strokeStyle = SCHEME.propEdge; g.stroke(); } return;
    }
    case 'vent': { boxed(X + 3, Y + 3, 10, 10, grey('#3b3f4d')); for (let i = 5; i < 12; i += 3) px(g, X + 4, Y + i, 8, 1, grey('#1c1f28')); return; }
  }
}

function drawLoot(g: G, p: Point, lit: boolean, t: number, calm: boolean) {
  const X = Math.round(p.x * TILE), Y = Math.round(p.y * TILE) + (calm ? 0 : Math.round(Math.sin(t / 350 + p.x * 3) * .6)), twinkle = !calm && Math.sin(t / 230 + p.x * 7 + p.y * 3) > .92;
  if (!lit) { px(g, X - 1, Y - 2, 3, 1, SCHEME.edge); px(g, X - 2, Y - 1, 5, 1, SCHEME.edge); px(g, X - 1, Y, 3, 1, SCHEME.edge); px(g, X, Y + 1, 1, 1, SCHEME.edge); return; }
  px(g, X - 2, Y + 2, 5, 1, '#00000040');
  px(g, X - 1, Y - 3, 3, 1, '#fff1a8'); px(g, X - 3, Y - 2, 7, 1, '#ffd24a'); px(g, X - 2, Y - 1, 5, 1, '#e8b52a'); px(g, X - 1, Y, 3, 1, '#c9962e'); px(g, X, Y + 1, 1, 1, '#a07520'); px(g, X - 2, Y - 2, 1, 1, '#ffffff');
  if (twinkle) { px(g, X, Y - 6, 1, 3, '#ffffffcc'); px(g, X - 1, Y - 5, 3, 1, '#ffffffcc'); }
}

type Pose = { x: number; y: number; moving: boolean; dir: number };
/** A 15px figure anchored at the feet: outlined legs, body and head. `frame` swings the walk. */
function figure(g: G, X: number, Y: number, body: string, dir: number, frame: number, head = SKIN, trim = mix(body, '#ffffff', .25)) {
  const shade = mix(body, '#000000', .35), lift = frame ? 1 : 0;
  px(g, X - 4, Y - 15, 9, 16, OUTLINE);
  px(g, X - 3, Y - 2 - lift, 2, 2 + lift, shade); px(g, X + 1, Y - 2 - (frame ? 0 : 1), 2, 2 + (frame ? 0 : 1), shade);
  px(g, X - 3, Y - 9, 7, 7, body); px(g, X - 3, Y - 3, 7, 1, shade); px(g, X - 3 + (dir > 0 ? 6 : 0), Y - 8, 1, 4, trim); px(g, X - 3 + (dir > 0 ? 0 : 6), Y - 8, 1, 5, shade);
  px(g, X + (dir > 0 ? 3 : -4), Y - 8 + (frame ? 2 : 0), 1, 3, mix(head, '#000000', .1));
  px(g, X - 2, Y - 14, 5, 5, head); px(g, X - 2, Y - 10, 5, 1, mix(head, '#000000', .25));
}
export function drawPlayer(g: G, p: PlayerView, pose: Pose, t: number, calm: boolean) {
  const X = Math.round(pose.x * TILE), Y = Math.round(pose.y * TILE), role = ROLES[p.role], color = p.disguised ? '#2e3f8f' : role.color, frame = pose.moving && !calm ? Math.floor(t / 130) % 2 : 0, d = pose.dir;
  g.save();
  if (p.suspended) g.globalAlpha = .3; else if (p.hidden) g.globalAlpha = .45;
  g.fillStyle = '#00000060'; g.beginPath(); g.ellipse(X, Y, 6, 2.5, 0, 0, 7); g.fill();
  if (!p.suspended) { g.globalCompositeOperation = 'lighter'; const glow = g.createRadialGradient(X, Y - 6, 1, X, Y - 6, 13); glow.addColorStop(0, rgba(role.color, .3)); glow.addColorStop(1, rgba(role.color, 0)); g.fillStyle = glow; g.fillRect(X - 14, Y - 20, 28, 28); g.globalCompositeOperation = 'source-over'; }
  g.strokeStyle = p.color; g.lineWidth = 1.5; g.beginPath(); g.ellipse(X, Y, 7.5, 3.5, 0, 0, 7); g.stroke();
  if (p.hidden) { g.strokeStyle = '#a8e37a'; g.lineWidth = 1; g.setLineDash([2, 2]); g.beginPath(); g.arc(X, Y - 6, 11, 0, 7); g.stroke(); g.setLineDash([]); }
  if (p.down) {
    px(g, X - 8, Y - 6, 15, 7, OUTLINE); px(g, X - 7, Y - 5, 9, 5, color); px(g, X - 7, Y - 1, 9, 1, mix(color, '#000000', .3)); px(g, X + (d > 0 ? 2 : -7), Y - 5, 5, 5, SKIN); px(g, X + (d > 0 ? 2 : -7), Y - 3, 5, 1, mix(SKIN, '#000000', .2));
    const r = 9 + (calm ? 0 : Math.sin(t / 250) * 1.5); g.strokeStyle = 'rgba(255,87,72,.9)'; g.lineWidth = 1.5; g.beginPath(); g.arc(X, Y - 2, r, 0, 7); g.stroke();
    px(g, X - 2, Y - 18, 4, 8, OUTLINE); px(g, X - 4, Y - 16, 8, 4, OUTLINE); px(g, X - 1, Y - 17, 2, 6, '#ff5748'); px(g, X - 3, Y - 15, 6, 2, '#ff5748');
    g.restore(); return;
  }
  if (pose.moving) { const tail = mix(color, '#000000', .3); px(g, X + (d > 0 ? -6 : 4), Y - 8 + frame, 3, 3, OUTLINE); px(g, X + (d > 0 ? -5 : 4), Y - 7 + frame, 2, 2, tail); }
  figure(g, X, Y, color, d, frame);
  px(g, X - 2, Y - 13, 5, 1, '#0b0d1a'); px(g, X + (d > 0 ? 1 : -2), Y - 13, 1, 1, '#ffffff'); px(g, X + (d > 0 ? 1 : -2), Y - 13, 1, 1, '#ffffff');
  const hat = (c: string) => { px(g, X - 3, Y - 16, 7, 2, OUTLINE); px(g, X - 2, Y - 15, 5, 1, c); };
  if (p.disguised) { hat('#1d2a63'); px(g, X + (d > 0 ? 2 : -4), Y - 14, 3, 1, '#1d2a63'); px(g, X - 1, Y - 8, 3, 3, '#e8ecf5'); }
  else switch (p.role) {
    case 'cracker': hat(mix(color, '#000000', .4)); px(g, X + (d > 0 ? 2 : -4), Y - 14, 3, 1, mix(color, '#000000', .4)); break;
    case 'scout': px(g, X - 3, Y - 14, 7, 3, OUTLINE); px(g, X - 2, Y - 13, 2, 1, '#7fe0ff'); px(g, X + 1, Y - 13, 2, 1, '#7fe0ff'); px(g, X - 2, Y - 16, 5, 2, '#1a1a2a'); break;
    case 'magpie': { hat('#2a2a3a'); px(g, X - 1, Y - 17, 3, 2, '#2a2a3a'); px(g, X + (d > 0 ? -3 : 2), Y - 18, 1, 3, '#ffd65a'); const a = calm ? 0 : t / 500, bx = X + Math.round(Math.cos(a) * 10), by = Y - 13 + Math.round(Math.sin(a) * 4), wing = calm ? 0 : Math.floor(t / 120) % 2; px(g, bx - 2, by - 1, 5, 4, OUTLINE); px(g, bx - 1, by, 3, 2, '#2a2f44'); px(g, bx - 2, by - wing, 1, 1, '#2a2f44'); px(g, bx + 2, by - wing, 1, 1, '#2a2f44'); px(g, bx + (Math.cos(a) > 0 ? 2 : -2), by, 1, 1, '#ffd65a'); break; }
    case 'ghost': hat(mix(color, '#000000', .5)); px(g, X - 3, Y - 14, 1, 5, mix(color, '#000000', .5)); px(g, X + 3, Y - 14, 1, 5, mix(color, '#000000', .5)); break;
    case 'breacher': hat('#ffd24a'); px(g, X - 1, Y - 17, 3, 1, '#ffd24a'); px(g, X + (d > 0 ? -6 : 4), Y - 9, 3, 6, OUTLINE); px(g, X + (d > 0 ? -5 : 4), Y - 8, 2, 5, mix(color, '#000000', .4)); break;
    case 'impostor': px(g, X - 3, Y - 20, 7, 6, OUTLINE); px(g, X - 2, Y - 19, 5, 4, '#111320'); px(g, X - 3, Y - 15, 7, 1, '#111320'); px(g, X - 2, Y - 18, 5, 1, '#3a3350'); px(g, X - 1, Y - 9, 3, 4, '#f4f4f8'); px(g, X, Y - 9, 1, 2, '#c9303a'); break;
    case 'wire': { const ax = X + (d > 0 ? 2 : -2); px(g, ax - 1, Y - 20, 3, 7, OUTLINE); px(g, ax, Y - 19, 1, 5, '#99dc65'); px(g, ax, Y - 20, 1, 1, calm || Math.floor(t / 400) % 2 ? '#e8ffcf' : '#4a8a2a'); px(g, X - 3, Y - 14, 7, 1, '#2a2a3a'); break; }
    case 'face': hat('#d8502a'); px(g, X + (d > 0 ? -4 : 3), Y - 15, 2, 8, OUTLINE); px(g, X + (d > 0 ? -4 : 3), Y - 14, 2, 7, '#d8502a'); px(g, X - 1, Y - 17, 3, 1, '#d8502a'); break;
  }
  if (p.work) {
    const r = 10, from = -Math.PI / 2, to = from + Math.PI * 2 * Math.max(0, Math.min(1, p.work.progress));
    g.strokeStyle = 'rgba(5,7,26,.75)'; g.lineWidth = 3; g.beginPath(); g.arc(X, Y - 6, r, 0, 7); g.stroke();
    g.strokeStyle = '#ffd24a'; g.lineWidth = 2; g.beginPath(); g.arc(X, Y - 6, r, from, to); g.stroke();
    if (!calm && Math.floor(t / 90) % 2) { const sx = X + (d > 0 ? 8 : -8), sy = Y - 8 - (Math.floor(t / 45) % 3); px(g, sx, sy, 1, 1, '#fff6e5'); px(g, sx + (d > 0 ? 1 : -1), sy - 1, 1, 1, '#ffd24a'); }
  }
  g.restore();
}

export function drawGuard(g: G, gd: GuardView, pose: Pose, t: number, calm: boolean) {
  const X = Math.round(pose.x * TILE), Y = Math.round(pose.y * TILE), frame = pose.moving && !calm && gd.alert !== 'stunned' ? Math.floor(t / 150) % 2 : 0, d = pose.dir;
  g.fillStyle = '#00000060'; g.beginPath(); g.ellipse(X, Y, 6, 2.5, 0, 0, 7); g.fill();
  if (gd.alert === 'stunned') { px(g, X - 8, Y - 6, 15, 7, OUTLINE); px(g, X - 7, Y - 5, 9, 5, '#2e3f8f'); px(g, X + 2, Y - 5, 5, 5, SKIN); label(g, 'z', X + 6, Y - 11 + (calm ? 0 : Math.sin(t / 300) * 2), 7, '#9fd0ff'); label(g, 'z', X + 10, Y - 16 + (calm ? 0 : Math.sin(t / 300 + 1) * 2), 5, '#9fd0ff'); return; }
  figure(g, X, Y, gd.charmed ? '#6a4f9a' : '#2e3f8f', d, frame, SKIN, '#c9d2f0');
  px(g, X - 1, Y - 9, 3, 6, gd.charmed ? '#c9a7f0' : '#c9d2f0');
  px(g, X - 3, Y - 16, 7, 2, OUTLINE); px(g, X - 2, Y - 15, 5, 1, '#1d2a63'); px(g, X + (d > 0 ? 2 : -4), Y - 14, 3, 1, '#1d2a63'); px(g, X, Y - 15, 1, 1, '#ffd24a');
  px(g, X - 2, Y - 13, 5, 1, '#1a1c2a'); px(g, X + (d > 0 ? 1 : -2), Y - 13, 1, 1, gd.alert === 'chase' ? '#ff5748' : '#ffffff');
  px(g, X + (d > 0 ? 4 : -5), Y - 7, 2, 2, '#ffe08a');
  const glyph = gd.charmed ? ['♥', '#f888cd'] : gd.alert === 'chase' ? ['!', '#ff5748'] : gd.alert === 'suspicious' ? ['?', '#ffd24a'] : gd.alert === 'search' ? ['?', '#ffa260'] : null;
  if (glyph) { const bounce = gd.alert === 'chase' && !calm ? Math.abs(Math.sin(t / 120)) * 2 : 0; label(g, glyph[0], X, Y - 22 - bounce, 9, glyph[1], 'center', 'Nunito', gd.alert === 'chase' ? '#3a0d12dd' : '#10131fdd'); }
  if (gd.alert === 'suspicious' || gd.alert === 'search') { px(g, X - 5, Y - 30, 10, 3, OUTLINE); px(g, X - 4, Y - 29, Math.round(8 * Math.max(0, Math.min(1, gd.suspicion))), 1, gd.alert === 'search' ? '#ffa260' : '#ffd24a'); }
}

const EFFECT_LIFE: Record<Effect['kind'], number> = { coin: 800, alarm: 1100, smoke: 600, heal: 900, shot: 260, unlock: 1000, rescue: 1000, hack: 700, break: 800 };
const EFFECT_COLOR: Record<Effect['kind'], string> = { coin: '#ffd24a', alarm: '#ff5748', smoke: '#d9dce6', heal: '#78d955', shot: '#fff2b0', unlock: '#ffd24a', rescue: '#7fd0ff', hack: '#3ee6ff', break: '#c9a27a' };
function drawEffect(g: G, e: Effect, age: number) {
  const k = Math.min(1, age / EFFECT_LIFE[e.kind]), X = Math.round(e.x * TILE), Y = Math.round(e.y * TILE), c = EFFECT_COLOR[e.kind], h = hash(e.id, e.id * 7);
  g.save(); g.globalAlpha = 1 - k * k;
  switch (e.kind) {
    case 'alarm': { g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.arc(X, Y - 4, 4 + k * 28, 0, 7); g.stroke(); g.lineWidth = 1; g.beginPath(); g.arc(X, Y - 4, 2 + k * 16, 0, 7); g.stroke(); break; }
    case 'unlock': case 'rescue': case 'heal': { g.strokeStyle = c; g.lineWidth = 1.5; g.beginPath(); g.arc(X, Y - 4, 4 + k * 12, 0, 7); g.stroke(); for (let i = 0; i < 6; i++) { const a = i * 1.047 + (h & 3), r = 5 + k * 11; px(g, Math.round(X + Math.cos(a) * r), Math.round(Y - 4 + Math.sin(a) * r), 1, 1, i % 2 ? '#ffffff' : c); } if (e.kind === 'heal') { px(g, X - 1, Y - 14 - k * 8, 2, 6, c); px(g, X - 3, Y - 12 - k * 8, 6, 2, c); } break; }
    case 'coin': { for (let i = 0; i < 4; i++) { const a = i * 1.57 + .78, r = 3 + k * 6; px(g, Math.round(X + Math.cos(a) * r), Math.round(Y - 6 + Math.sin(a) * r), 1, 1, '#fff'); } px(g, X - 1, Y - 3 - k * 10, 3, 1, c); px(g, X, Y - 4 - k * 10, 1, 3, c); break; }
    case 'shot': { g.globalCompositeOperation = 'lighter'; const glow = g.createRadialGradient(X, Y - 5, 1, X, Y - 5, 16); glow.addColorStop(0, 'rgba(255,240,180,.95)'); glow.addColorStop(1, 'rgba(255,200,80,0)'); g.fillStyle = glow; g.fillRect(X - 16, Y - 21, 32, 32); break; }
    case 'smoke': { for (let i = 0; i < 5; i++) { const a = i * 1.26 + h % 7, cx = X + Math.cos(a) * k * 14, cy = Y - 4 + Math.sin(a) * k * 10, puff = g.createRadialGradient(cx, cy, 0, cx, cy, 3 + k * 6); puff.addColorStop(0, 'rgba(230,233,242,.8)'); puff.addColorStop(1, 'rgba(230,233,242,0)'); g.fillStyle = puff; g.beginPath(); g.arc(cx, cy, 3 + k * 6, 0, 7); g.fill(); } break; }
    case 'hack': case 'break': { for (let i = 0; i < 8; i++) { const a = i * .8 + (h & 3), r = k * (12 + (h >> i & 7)); px(g, Math.round(X + Math.cos(a) * r), Math.round(Y - 4 + Math.sin(a) * r + (e.kind === 'break' ? k * k * 12 : 0)), 2, 2, i % 2 ? c : mix(c, '#000000', .4)); } break; }
  }
  g.restore();
  return { X, Y, k, c };
}

export function drawSmoke(g: G, s: Point & { until: number; radius: number }, now: number, t: number, calm: boolean, index: number) {
  const left = s.until - now; if (left <= 0) return;
  const age = 6500 - left, grow = Math.min(1, age / 500), a = Math.min(1, left / 1800) * .8, R = s.radius * TILE * (.55 + .45 * grow), drift = calm ? 0 : t / 5000;
  g.save(); g.globalAlpha = a;
  for (let i = 0; i < 6; i++) {
    const ang = i * 1.05 + drift + index, dist = i ? R * .5 : 0, cx = s.x * TILE + Math.cos(ang) * dist, cy = s.y * TILE + Math.sin(ang) * dist * .8, r = i ? R * .58 : R * .75;
    const puff = g.createRadialGradient(cx - r * .2, cy - r * .2, 0, cx, cy, r); puff.addColorStop(0, i % 2 ? '#e6e9f2d9' : '#f3f4f8d9'); puff.addColorStop(.7, i % 2 ? '#b9bfcf' : '#cfd4e0'); puff.addColorStop(1, 'rgba(160,168,186,0)');
    g.fillStyle = puff; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  }
  g.restore();
}

/* ── the renderer ───────────────────────────────────────────────────────── */
type Painting = { key: string; scheme: HTMLCanvasElement; lit: HTMLCanvasElement };
export function createRenderer(canvas: HTMLCanvasElement) {
  const g = canvas.getContext('2d')!, motion = matchMedia('(prefers-reduced-motion: reduce)');
  let painting: Painting | null = null, W = 0, H = 0, S = 1, lastFrame = 0, shakeUntil = 0, seenEffect = -1, floorWidth = 32 * TILE, floorHeight = 18 * TILE;
  const poses = new Map<string, Pose>(), sightCache = new Map<string, number[]>();
  let sightAt = 0, sightWorld = '';
  /** Danger cones from the shared SIGHT geometry: sneak-safe outer band faint, detection core stronger, near radius solid. */
  const paintSight = (p: Point & { id: string }, facing: number, range: number, wide: number, color: string, view: View, strength: number) => {
    const key = `${p.id}:${range}`;
    let cells = sightCache.get(key);
    if (!cells) {
      cells = visibleCells(view.tiles, view.objects, [p], range).filter(cell => {
        const q = { x: cell % view.tiles[0].length + .5, y: Math.floor(cell / view.tiles[0].length) + .5 }, x = q.x - p.x, y = q.y - p.y, length = x * x + y * y;
        return !view.smoke.some(c => { const k = length ? Math.max(0, Math.min(1, ((c.x - p.x) * x + (c.y - p.y) * y) / length)) : 0; return c.until > view.now && Math.hypot(p.x + k * x - c.x, p.y + k * y - c.y) < c.radius; });
      });
      sightCache.set(key, cells);
    }
    g.save(); g.beginPath();
    for (const cell of cells) g.rect(cell % view.tiles[0].length * TILE, Math.floor(cell / view.tiles[0].length) * TILE, TILE, TILE);
    g.clip(); g.translate(p.x * TILE, p.y * TILE); g.rotate(facing);
    const gradient = g.createRadialGradient(0, 0, 0, 0, 0, range * TILE); gradient.addColorStop(0, rgba(color, strength)); gradient.addColorStop(1, rgba(color, strength * .3)); g.fillStyle = gradient;
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, range * TILE, -Math.acos(wide), Math.acos(wide)); g.closePath(); g.fill();
    g.strokeStyle = rgba(color, strength * 1.6); g.lineWidth = .6; g.stroke();
    if (wide === SIGHT.laser.wide) { g.strokeStyle = color; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 0); g.lineTo(range * TILE, 0); g.stroke(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = rgba(color, .35); g.lineWidth = 3; g.stroke(); }
    g.fillStyle = rgba(color, strength * 1.3); g.beginPath(); g.arc(0, 0, SIGHT.near * TILE, 0, Math.PI * 2); g.fill(); g.restore();
  };
  const resize = () => {
    const box = canvas.parentElement?.getBoundingClientRect(), nativeDpr = Math.min(devicePixelRatio || 1, 2);
    const fit = Math.max(.1, Math.min((box?.width ?? canvas.clientWidth) / floorWidth, (box?.height ?? canvas.clientHeight) / floorHeight));
    // Paint whole art pixels, then let pixelated CSS fit the floor into the available HUD gap.
    const dpr = Math.ceil(fit * nativeDpr) / fit;
    W = Math.max(1, Math.round((box?.width ?? canvas.clientWidth) * dpr)); H = Math.max(1, Math.round((box?.height ?? canvas.clientHeight) * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  };
  const pose = (id: string, x: number, y: number, fx: number, fy: number, dt: number): Pose => {
    const prev = poses.get(id), moving = !!prev && Math.hypot(x - prev.x, y - prev.y) > .012 * Math.max(1, dt / 16);
    const dir = Math.abs(fx) > .05 ? Math.sign(fx) : Math.abs(fy) < .05 && prev ? prev.dir : prev?.dir ?? 1;
    const next = { x, y, moving, dir }; poses.set(id, next); return next;
  };
  function draw(map: HeistMap, view: View | null, _playerId: string | null, serverNow: number, frameNow: number) {
    floorWidth = map.width * TILE; floorHeight = map.height * TILE; resize();
    const dt = lastFrame ? Math.min(100, frameNow - lastFrame) : 16; lastFrame = frameNow;
    const calm = motion.matches, tiles = view?.tiles ?? map.tiles, mapW = map.width * TILE, mapH = map.height * TILE, phase = view?.phase ?? 'infiltrate';
    S = Math.max(1, Math.floor(Math.min(W / mapW, H / mapH)));
    const key = `${map.id}:${S}:${tiles.join('')}`;
    const world = key + (view?.objects.map(o => o.state).join() ?? '') + (view?.smoke.map(c => c.until).join() ?? '');
    if (world !== sightWorld || frameNow - sightAt > 80) { sightCache.clear(); sightAt = frameNow; sightWorld = world; }
    if (painting?.key !== key) painting = { key, scheme: paintWorld(map, tiles, S, false), lit: paintWorld(map, tiles, S, true) };
    let ox = Math.floor((W - mapW * S) / 2), oy = Math.floor((H - mapH * S) / 2);
    if (view) for (const e of view.effects) if (e.id > seenEffect) { seenEffect = e.id; if ((e.kind === 'alarm' || e.kind === 'shot' || e.kind === 'break') && !calm && serverNow - e.at >= 0 && serverNow - e.at < 260) shakeUntil = frameNow + 220; }
    if (!calm && shakeUntil > frameNow) { ox += Math.round(Math.sin(frameNow / 9) * 2 * S); oy += Math.round(Math.cos(frameNow / 7) * 1.5 * S); }
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false; g.fillStyle = INK; g.fillRect(0, 0, W, H);
    g.drawImage(painting.scheme, ox, oy);
    g.setTransform(S, 0, 0, S, ox, oy);
    const t = frameNow, now = serverNow, objects = view?.objects ?? map.objects.map(o => ({ ...o, state: 'ready' as const, until: 0 })), loot = view?.loot ?? map.loot;
    for (const o of objects) drawObject(g, o, tiles, false, t, calm, phase);
    for (const l of loot) drawLoot(g, l, false, t, calm);
    if (view?.visible.length) {
      const sight = new Path2D(), width = tiles[0]?.length ?? map.width; let run: number | null = null, runY = 0, runStart = 0;
      const flush = (x: number) => { if (run !== null) sight.rect(runStart * TILE, runY * TILE, (x - runStart) * TILE, TILE); run = null; };
      for (const c of view.visible) { const x = c % width, y = Math.floor(c / width); if (run !== null && (y !== runY || x !== run + 1)) flush(run + 1); if (run === null) { runStart = x; runY = y; } run = x; }
      if (run !== null) flush(run + 1);
      g.save(); g.clip(sight);
      g.setTransform(1, 0, 0, 1, ox, oy); g.drawImage(painting.lit, 0, 0); g.setTransform(S, 0, 0, S, ox, oy);
      if (!calm) for (const c of view.visible) { const x = c % width, y = Math.floor(c / width); if (tiles[y][x] === '~') { const k = hash(x, y), sh = (Math.floor(t / 400) + (k & 3)) % 4; px(g, x * TILE + 2 + ((k >> 2) & 7), y * TILE + 3 + sh * 3, 3, 1, '#a8ddff99'); } }
      for (const o of objects) drawObject(g, o, tiles, true, t, calm, phase);
      for (const l of loot) drawLoot(g, l, true, t, calm);
      for (const o of objects) if (o.state === 'ready' && (o.kind === 'camera' || o.kind === 'laser')) { const spec = SIGHT[o.kind]; paintSight(o, o.facing ?? 0, spec.range, spec.wide, '#ff5748', view, .16); }
      for (const guard of view.guards) if (guard.alert !== 'stunned' && !guard.charmed) { const hot = guard.alert === 'chase' || guard.alert === 'suspicious', color = hot ? '#ff9a6a' : '#ffe08a'; paintSight(guard, guard.facing, SIGHT.guard.range, SIGHT.guard.wide, color, view, hot ? .1 : .07); paintSight(guard, guard.facing, SIGHT.guard.sneak, SIGHT.guard.wide, color, view, hot ? .14 : .1); }
      g.restore();
      const seen = new Set(view.visible), rim = new Path2D();
      for (const c of view.visible) {
        const x = c % width, y = Math.floor(c / width), X = x * TILE, Y = y * TILE;
        if (!y || !seen.has(c - width)) { rim.moveTo(X, Y); rim.lineTo(X + TILE, Y); }
        if (y === tiles.length - 1 || !seen.has(c + width)) { rim.moveTo(X, Y + TILE); rim.lineTo(X + TILE, Y + TILE); }
        if (!x || !seen.has(c - 1)) { rim.moveTo(X, Y); rim.lineTo(X, Y + TILE); }
        if (x === width - 1 || !seen.has(c + 1)) { rim.moveTo(X + TILE, Y); rim.lineTo(X + TILE, Y + TILE); }
      }
      g.strokeStyle = 'rgba(255,246,229,.16)'; g.lineWidth = 1; g.stroke(rim);
    }
    if (!view) { g.setTransform(1, 0, 0, 1, 0, 0); label(g, map.title, W / 2, oy + mapH * S / 2 - 8 * S, Math.max(12, 7 * S), '#fff6e5', 'center', 'Lilita One'); label(g, 'Casing the joint…', W / 2, oy + mapH * S / 2 + 4 * S, Math.max(10, 4.5 * S), SCHEME.text); return; }
    view.smoke.forEach((s, i) => drawSmoke(g, s, now, t, calm, i));
    for (const m of view.markers) { const X = Math.round(m.x * TILE), Y = Math.round(m.y * TILE), r = 5 + (calm ? 0 : Math.sin(t / 180) * 1.5); g.strokeStyle = ROLES.scout.color; g.lineWidth = 1; g.beginPath(); g.moveTo(X, Y - r); g.lineTo(X + r, Y); g.lineTo(X, Y + r); g.lineTo(X - r, Y); g.closePath(); g.stroke(); label(g, '?', X, Y, 8, ROLES.scout.color); }
    const live = new Set<string>();
    for (const gd of view.guards) { live.add(gd.id); drawGuard(g, gd, pose(gd.id, gd.x, gd.y, Math.cos(gd.facing), Math.sin(gd.facing), dt), t, calm); }
    for (const p of view.players) { live.add(p.id); drawPlayer(g, p, pose(p.id, p.x, p.y, p.facingX, p.facingY, dt), t, calm); }
    for (const id of poses.keys()) if (!live.has(id)) poses.delete(id);
    const labels: { text: string; x: number; y: number; color: string; size: number }[] = [];
    for (const e of view.effects) { const age = now - e.at; if (age < 0 || age > EFFECT_LIFE[e.kind]) continue; const { X, Y, k, c } = drawEffect(g, e, age); if (e.label) labels.push({ text: e.label, x: X, y: Y - 18 - k * 10, color: c, size: 5 }); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const sx = (x: number) => ox + x * S, sy = (y: number) => oy + y * S;
    for (const l of labels) label(g, l.text, sx(l.x), sy(l.y), Math.max(9, l.size * S), l.color, 'center', 'Nunito', '#10131fb0');
    view.players.forEach((p, i) => {
      const X = Math.round(p.x * TILE), Y = Math.round(p.y * TILE);
      if (p.work) label(g, p.work.label, sx(X), Math.max(oy + 7 * S, sy(Y - 32)), Math.max(9, 4.5 * S), '#fff6e5', 'center', 'Nunito', '#10131fcc');
      const badgeX = X + (i % 2 ? -7 : 7), badgeY = Y - 18 - (i > 1 ? 4 : 0), r = Math.max(4, 2.4 * S);
      g.fillStyle = OUTLINE; g.beginPath(); g.arc(sx(badgeX), sy(badgeY), r + 1, 0, 7); g.fill();
      g.fillStyle = p.color; g.beginPath(); g.arc(sx(badgeX), sy(badgeY), r, 0, 7); g.fill(); label(g, String(i + 1), sx(badgeX), sy(badgeY), Math.max(7, 3.2 * S), '#05071a');
    });
  }
  return { draw, resize, dispose() { painting = null; poses.clear(); sightCache.clear(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); } };
}
