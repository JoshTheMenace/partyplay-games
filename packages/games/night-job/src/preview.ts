/* Crisp 2D blueprint of a public layout for briefings and mission cards. Never draws NPCs (they are server-only). */
import { buildGrid, castRay } from './geometry';
import type { HeistMap, MapObject, Prop } from './model';

const C = 24, INK = '#081330', FLOOR = '#0f2350', YARD = '#0c1d45', LINE = '#dcecff', FAINT = 'rgba(150,196,255,.09)', PROP = 'rgba(175,210,255,.5)', BRASS = '#f0bd5a', RED = '#ff5b5b', GREEN = '#7fe08a', GLASS = '#8fe2ff';
const ROUND: readonly Prop['kind'][] = ['plant', 'tree', 'barrel', 'fountain', 'roulette', 'lamp', 'statue', 'table'];
const WALLS = '#% ';

/** Paints `map` onto `canvas` at 24 px per tile; the element can be scaled freely with CSS. */
export function paintPreview(canvas: HTMLCanvasElement, map: HeistMap) {
  const { width: W, height: H, tiles } = map, g = canvas.getContext('2d');
  canvas.width = W * C; canvas.height = H * C;
  if (!g) return;
  const at = (x: number, y: number) => tiles[y]?.[x] ?? ' ', wall = (x: number, y: number) => WALLS.includes(at(x, y));
  g.fillStyle = INK; g.fillRect(0, 0, W * C, H * C);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at(x, y);
    g.fillStyle = c === '~' ? '#123f73' : c === ',' ? YARD : c === ' ' ? INK : c === '#' || c === '%' ? '#1a3264' : FLOOR;
    g.fillRect(x * C, y * C, C, C);
  }
  for (const r of map.rooms) { g.fillStyle = `${r.tint ?? r.light}14`; g.fillRect(r.x * C, r.y * C, r.w * C, r.h * C); }
  // Drafting grid: faint per tile, stronger every four.
  for (let x = 0; x <= W; x++) line(g, x * C, 0, x * C, H * C, x % 4 ? FAINT : 'rgba(150,196,255,.16)', 1);
  for (let y = 0; y <= H; y++) line(g, 0, y * C, W * C, y * C, y % 4 ? FAINT : 'rgba(150,196,255,.16)', 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at(x, y), X = x * C, Y = y * C;
    if (c === '~') for (let k = 0; k < 2; k++) wave(g, X + 3, Y + 8 + k * 9, C - 6);
    if (c === '=') { g.fillStyle = 'rgba(143,226,255,.16)'; g.fillRect(X, Y, C, C); const h = !'=#%w'.includes(at(x, y - 1)) || !'=#%w'.includes(at(x, y + 1)); for (const o of [-2.5, 2.5]) if (h) line(g, X, Y + C / 2 + o, X + C, Y + C / 2 + o, GLASS, 1.5); else line(g, X + C / 2 + o, Y, X + C / 2 + o, Y + C, GLASS, 1.5); }
    if (!wall(x, y)) continue;
    // Wall outlines only where a wall meets something walkable or see-through.
    const edge = (nx: number, ny: number) => !wall(nx, ny);
    if (edge(x, y - 1)) line(g, X, Y, X + C, Y, LINE, 2.5);
    if (edge(x, y + 1)) line(g, X, Y + C, X + C, Y + C, LINE, 2.5);
    if (edge(x - 1, y)) line(g, X, Y, X, Y + C, LINE, 2.5);
    if (edge(x + 1, y)) line(g, X + C, Y, X + C, Y + C, LINE, 2.5);
    if (c === '%') { g.strokeStyle = BRASS; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X + 6, Y + 4); g.lineTo(X + 12, Y + 10); g.lineTo(X + 9, Y + 14); g.lineTo(X + 17, Y + 20); g.stroke(); }
    else if (c === '#') { g.strokeStyle = 'rgba(220,236,255,.18)'; g.lineWidth = 1; g.beginPath(); for (let k = -C; k < C; k += 6) { g.moveTo(X + Math.max(0, k), Y + Math.max(0, -k)); g.lineTo(X + Math.min(C, C + k), Y + Math.min(C, C - k)); } g.stroke(); }
  }
  for (const p of map.props) prop(g, p);
  const grid = buildGrid(map, '');
  for (const o of map.objects) object(g, o, map, grid);
  for (const coin of map.coins) { g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(coin.x * C, coin.y * C, 3, 0, Math.PI * 2); g.fill(); }
  map.spawns.slice(0, 4).forEach((s, i) => { ring(g, s.x * C, s.y * C, 7, '#fff6e5', 2); g.fillStyle = '#fff6e5'; text(g, String(i + 1), s.x * C, s.y * C + .5, 10, 900); });
  g.textBaseline = 'middle';
  for (const r of map.rooms) {
    const size = Math.min(13, (r.w * C) / Math.max(6, r.name.length) * 1.1);
    g.fillStyle = 'rgba(214,232,255,.62)'; text(g, r.name, (r.x + r.w / 2) * C, (r.y + (r.h > 3 ? .7 : r.h / 2)) * C, size, 800, .16);
  }
}

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, width: number) { g.strokeStyle = color; g.lineWidth = width; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
function ring(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, width: number, dash: number[] = []) { g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
function wave(g: CanvasRenderingContext2D, x: number, y: number, w: number) { g.strokeStyle = '#4b9be6'; g.lineWidth = 1.2; g.beginPath(); for (let i = 0; i <= w; i += 2) g.lineTo(x + i, y + Math.sin(i / 2.2) * 1.6); g.stroke(); }
function text(g: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, weight: number, spacing = 0) {
  g.font = `${weight} ${size}px Nunito, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${spacing}em`; g.fillText(value, x, y);
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0em';
}

function prop(g: CanvasRenderingContext2D, p: Prop) {
  const X = p.x * C, Y = p.y * C, w = p.w * C, h = p.h * C;
  g.strokeStyle = PROP; g.lineWidth = 1.5;
  if (p.kind === 'rug') { g.setLineDash([3, 3]); g.strokeRect(X + 3, Y + 3, w - 6, h - 6); g.setLineDash([]); return; }
  if (p.kind === 'painting') { line(g, X + 4, Y + 2, X + w - 4, Y + 2, BRASS, 2); return; }
  if (ROUND.includes(p.kind)) { g.beginPath(); g.ellipse(X + w / 2, Y + h / 2, w / 2 - 4, h / 2 - 4, 0, 0, Math.PI * 2); g.stroke(); if (p.kind === 'tree' || p.kind === 'fountain') ring(g, X + w / 2, Y + h / 2, Math.min(w, h) / 5, PROP, 1); return; }
  g.beginPath(); g.roundRect(X + 3, Y + 3, w - 6, h - 6, 3); g.stroke();
  if (p.w * p.h > 1 && (p.kind === 'shelf' || p.kind === 'bookcase' || p.kind === 'slot' || p.kind === 'locker' || p.kind === 'counter' || p.kind === 'bar')) for (let i = 1; i < Math.max(p.w, p.h); i++) if (p.w >= p.h) line(g, X + i * C, Y + 5, X + i * C, Y + h - 5, PROP, 1); else line(g, X + 5, Y + i * C, X + w - 5, Y + i * C, PROP, 1);
}

function object(g: CanvasRenderingContext2D, o: MapObject, map: HeistMap, grid: ReturnType<typeof buildGrid>) {
  const x = o.x * C, y = o.y * C, X = x - C / 2, Y = y - C / 2;
  switch (o.kind) {
    case 'door': {
      g.fillStyle = FLOOR; g.fillRect(X, Y, C, C);
      const color = o.locked ? RED : BRASS;
      // Architectural door symbol: a leaf and its swing arc.
      if (o.horizontal) { line(g, X + 2, Y + C / 2, X + 2, Y + C / 2 - C + 4, color, 2); g.strokeStyle = color; g.lineWidth = 1; g.setLineDash([2, 2]); g.beginPath(); g.arc(X + 2, Y + C / 2, C - 4, -Math.PI / 2, 0); g.stroke(); g.setLineDash([]); line(g, X, Y + C / 2, X + C, Y + C / 2, 'rgba(240,189,90,.35)', 1); }
      else { line(g, X + C / 2, Y + 2, X + C / 2 + C - 4, Y + 2, color, 2); g.strokeStyle = color; g.lineWidth = 1; g.setLineDash([2, 2]); g.beginPath(); g.arc(X + C / 2, Y + 2, C - 4, 0, Math.PI / 2); g.stroke(); g.setLineDash([]); line(g, X + C / 2, Y, X + C / 2, Y + C, 'rgba(240,189,90,.35)', 1); }
      if (o.locked) { g.fillStyle = RED; g.fillRect(x - 3, y - 2, 6, 5); ring(g, x, y - 3, 2.5, RED, 1.5); }
      return;
    }
    case 'window': { g.fillStyle = 'rgba(143,226,255,.14)'; g.fillRect(X, Y, C, C); for (const d of [-3, 3]) if (o.horizontal) line(g, X, y + d, X + C, y + d, GLASS, 1.5); else line(g, x + d, Y, x + d, Y + C, GLASS, 1.5); return; }
    case 'safe': { g.strokeStyle = BRASS; g.lineWidth = 2; g.strokeRect(X + 4, Y + 4, C - 8, C - 8); ring(g, x, y, 4, BRASS, 1.5); line(g, x, y, x + 3, y - 3, BRASS, 1.5); return; }
    case 'terminal': { g.strokeStyle = '#6fe7ff'; g.lineWidth = 1.5; g.strokeRect(X + 4, Y + 6, C - 8, C - 12); line(g, X + 7, y, X + C - 9, y, '#6fe7ff', 1.5); line(g, x - 3, Y + C - 5, x + 3, Y + C - 5, '#6fe7ff', 1.5); return; }
    case 'camera': case 'laser': {
      const f = o.facing ?? 0, dx = Math.cos(f), dy = Math.sin(f);
      if (o.kind === 'laser') { const d = castRay(grid, o.x, o.y, dx, dy, 40); g.setLineDash([4, 3]); line(g, x + dx * 6, y + dy * 6, (o.x + dx * d) * C, (o.y + dy * d) * C, 'rgba(255,91,91,.75)', 1.5); g.setLineDash([]); }
      else { g.fillStyle = 'rgba(255,91,91,.14)'; g.beginPath(); g.moveTo(x, y); g.arc(x, y, C * 2.2, f - .5, f + .5); g.closePath(); g.fill(); }
      g.fillStyle = RED; g.beginPath(); g.arc(x + dx * 4, y + dy * 4, 4, 0, Math.PI * 2); g.fill();
      return;
    }
    case 'objective': {
      const glow = g.createRadialGradient(x, y, 2, x, y, C * 1.4); glow.addColorStop(0, 'rgba(255,210,74,.5)'); glow.addColorStop(1, 'rgba(255,210,74,0)');
      g.fillStyle = glow; g.fillRect(x - C * 1.5, y - C * 1.5, C * 3, C * 3);
      g.fillStyle = '#ffd24a'; g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 7, y); g.lineTo(x, y + 8); g.lineTo(x - 7, y); g.closePath(); g.fill();
      g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke(); return;
    }
    case 'exit': {
      const r = 1.8 * C; g.fillStyle = 'rgba(127,224,138,.1)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      ring(g, x, y, r, GREEN, 2, [6, 4]); g.fillStyle = GREEN; text(g, 'GETAWAY', x, y - r - 8 < 8 ? y + r + 8 : y - r - 8, 11, 900, .18); return;
    }
    case 'medkit': { g.fillStyle = '#fff6e5'; g.fillRect(x - 2, y - 7, 4, 14); g.fillRect(x - 7, y - 2, 14, 4); return; }
    case 'hide': {
      const indoor = map.tiles[Math.floor(o.y)]?.[Math.floor(o.x)] === '.';
      g.strokeStyle = GREEN; g.lineWidth = 1.5;
      if (indoor) { g.strokeRect(X + 5, Y + 3, C - 10, C - 6); line(g, x, Y + 3, x, Y + C - 3, GREEN, 1); }
      else { g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.moveTo(x + Math.cos(a) * 7 + 4, y + Math.sin(a) * 7); g.arc(x + Math.cos(a) * 7, y + Math.sin(a) * 7, 4, 0, Math.PI * 2); } g.stroke(); }
      return;
    }
    case 'vent': { g.strokeStyle = '#b9c7e6'; g.lineWidth = 1.5; g.strokeRect(X + 4, Y + 4, C - 8, C - 8); for (let k = 8; k < C - 6; k += 4) line(g, X + 6, Y + k, X + C - 6, Y + k, '#b9c7e6', 1); return; }
  }
}
