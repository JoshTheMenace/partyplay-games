/**
 * Shared ship renderer (TV owner implements the art; phones reuse it). Frozen signatures:
 * drawShip paints hull sprite (tinted by paint mask), rooms, system icons, damage/fire/breach/oxygen, doors, crew and shields
 * into `layout` (from defs/geometry shipLayout). loadShipArt preloads sprites; missing files fall back to procedural hulls.
 */
import type { Crew, RoomState, ShipView, SpeciesId, WeaponKind } from '../contracts';
import { SPECIES, weaponDef } from '../defs/catalog';
import { toScreen, type Box, type ShipLayout } from '../defs/geometry';
import { HULLS, hullDef } from '../defs/hulls';
import { loadBackdrops, loadImage } from './backdrop';
import { SYSTEM_COLORS, drawGlyph } from './glyphs';
import { NOZZLE_X, canvas, hash, proceduralHull } from './hullart';
import { mountPoint, shieldEllipse } from './scene';
export { mountPoint } from './scene';

export type ShipDrawOptions = {
  nowMs: number;
  /** Captain id → color, for crew ownership rings. */ ownerColors: Record<string, string>;
  selectedRoom?: string | null; highlightRooms?: readonly string[]; selectedCrew?: readonly string[];
  /** Phones draw bigger labels and system icons. */ detail?: 'tv' | 'phone' | 'thumb';
};
const art = new Map<string, { hull: HTMLImageElement; paint: HTMLImageElement | null }>();
export const shipArt = (hullId: string) => art.get(hullId) ?? null;
/** Preloads every hull sprite + paint mask and the sector backdrops. Missing files resolve quietly (procedural fallback). */
export async function loadShipArt(assetBase: string, signal?: AbortSignal): Promise<void> {
  await Promise.all([loadBackdrops(assetBase, signal), ...HULLS.map(async h => {
    if (art.has(h.id)) return;
    const [hull, paint] = await Promise.all([loadImage(`${assetBase}ships/${h.id}.png`, signal), loadImage(`${assetBase}ships/${h.id}-paint.png`, signal)]);
    if (hull) art.set(h.id, { hull, paint });
  })]);
}

export const KIND_COLORS: Record<WeaponKind, string> = { laser: '#ff5a44', missile: '#ffb347', beam: '#ff5fd2', ion: '#5cc8ff', flak: '#ffcf6b', support: '#6dff9a' };
const ENEMY_RING = '#ff3b3b', INK = '#05071a';

/** White paint masks may be alpha- or luminance-keyed; normalise to alpha. */
function alphaMask(img: HTMLImageElement) {
  const c = canvas(img.width, img.height), g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height), d = data.data;
  for (let i = 0; i < d.length; i += 4) { d[i + 3] = d[i + 3] * Math.max(d[i], d[i + 1], d[i + 2]) / 255; d[i] = d[i + 1] = d[i + 2] = 255; }
  g.putImageData(data, 0, 0); return c;
}
const tints = new Map<string, HTMLCanvasElement>();
/** Hull sprite multiplied by `paint` through its mask, cached per hull + paint + art source. */
export function hullSprite(hullId: string, paint: string) {
  const loaded = art.get(hullId), key = `${hullId}|${paint}|${loaded ? 1 : 0}`, hit = tints.get(key); if (hit) return hit;
  const src = loaded ? { hull: loaded.hull, paint: loaded.paint && alphaMask(loaded.paint) } : proceduralHull(hullDef(hullId)), w = src.hull.width, h = src.hull.height;
  const out = canvas(w, h), g = out.getContext('2d')!; g.drawImage(src.hull, 0, 0);
  if (src.paint) { const layer = canvas(w, h), l = layer.getContext('2d')!; l.drawImage(src.paint, 0, 0, w, h); l.globalCompositeOperation = 'source-in'; l.fillStyle = paint; l.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'multiply'; g.drawImage(layer, 0, 0); g.globalCompositeOperation = 'destination-in'; g.drawImage(src.hull, 0, 0); }
  if (tints.size > 48) tints.delete(tints.keys().next().value!);
  tints.set(key, out); return out;
}

const level = (ship: ShipView, room: RoomState) => room.ionMs > 0 ? 0 : Math.min(ship.levels[room.system!] ?? room.tier - room.damage, room.tier - room.damage);
const glyphColor = (ship: ShipView, room: RoomState) => !room.tier ? '#6d7896' : room.ionMs > 0 ? '#86d8ff' : level(ship, room) <= 0 ? '#ff4d4d' : room.damage ? '#ffb13b' : SYSTEM_COLORS[room.system!];
let hatch: HTMLCanvasElement | null = null;
const hatchPattern = (g: CanvasRenderingContext2D) => {
  if (!hatch) { hatch = canvas(10, 10); const h = hatch.getContext('2d')!; h.strokeStyle = 'rgba(255,60,60,.9)'; h.lineWidth = 2.2; h.beginPath(); for (const o of [-10, 0, 10]) { h.moveTo(o, 10); h.lineTo(o + 10, 0); } h.stroke(); }
  return g.createPattern(hatch, 'repeat')!;
};

type Base = { ship: ShipView; layout: ShipLayout; key: string; canvas: HTMLCanvasElement; scale: number };
const bases = new Map<string, Base>();
/** The ship's static layer (sprite, rooms, doors, glyphs, pips, turrets) at device resolution, rebuilt only when its state changes. */
function baseFor(ctx: CanvasRenderingContext2D, ship: ShipView, layout: ShipLayout, detail: string): Base {
  const id = `${ship.id}|${detail}`, prev = bases.get(id), m = ctx.getTransform(), scale = Math.min(3, Math.max(1, Math.round(Math.hypot(m.c, m.d) * 4) / 4));
  if (prev && prev.ship === ship && prev.layout === layout && prev.scale === scale) return prev;
  const key = [scale, layout.cell.toFixed(2), layout.facing, ship.hullId, ship.paint, art.has(ship.hullId), ship.weapons.map(w => +w.powered).join(''),
    ship.rooms.map(r => `${r.tier}${r.damage}${+(r.ionMs > 0)}${+r.breach}${r.oxygen < 70 ? Math.floor(r.oxygen / 10) : 'k'}${level(ship, r)}`).join()].join('|');
  if (prev && prev.key === key) { prev.ship = ship; prev.layout = layout; return prev; }
  const { sprite, cell, hull } = layout, c = prev?.canvas ?? canvas(1, 1); c.width = Math.ceil(sprite.w * scale) + 2; c.height = Math.ceil(sprite.h * scale) + 2;
  const g = c.getContext('2d')!; g.setTransform(scale, 0, 0, scale, -sprite.x * scale, -sprite.y * scale);
  g.save(); if (layout.facing === -1) { g.translate(sprite.x * 2 + sprite.w, 0); g.scale(-1, 1); }
  g.drawImage(hullSprite(ship.hullId, ship.paint), sprite.x, sprite.y, sprite.w, sprite.h); g.restore();
  const boxes = ship.rooms.map(r => [r, layout.rooms[r.id]] as const).filter((e): e is readonly [RoomState, Box] => !!e[1]);
  for (const [r, b] of boxes) {
    g.fillStyle = 'rgba(16,24,50,.7)'; g.fillRect(b.x, b.y, b.w, b.h);
    if (r.system && r.tier) { g.fillStyle = SYSTEM_COLORS[r.system]; g.globalAlpha = .08; g.fillRect(b.x, b.y, b.w, b.h); g.globalAlpha = 1; }
    g.strokeStyle = 'rgba(150,180,255,.09)'; g.lineWidth = 1; g.beginPath();
    for (let x = b.x + cell; x < b.x + b.w - 1; x += cell) { g.moveTo(x, b.y); g.lineTo(x, b.y + b.h); }
    for (let y = b.y + cell; y < b.y + b.h - 1; y += cell) { g.moveTo(b.x, y); g.lineTo(b.x + b.w, y); }
    g.stroke();
    if (r.oxygen < 70) { g.fillStyle = `rgba(255,86,150,${((70 - r.oxygen) / 70 * .5).toFixed(3)})`; g.fillRect(b.x, b.y, b.w, b.h); }
    if (r.damage) { g.globalAlpha = r.damage >= r.tier ? .7 : .45; g.fillStyle = hatchPattern(g); g.fillRect(b.x, b.y, b.w, b.h); g.globalAlpha = 1; }
    if (r.breach) { const cx = b.x + b.w * .5, cy = b.y + b.h * .5, rr = cell * .3; g.fillStyle = '#020207'; g.beginPath();
      for (let i = 0; i < 11; i++) { const a = i / 11 * Math.PI * 2, d = rr * (.7 + .5 * hash(i + b.x)); g.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d * .8); }
      g.closePath(); g.fill(); g.strokeStyle = '#ff8a4a'; g.lineWidth = 1.2; g.stroke(); }
  }
  g.strokeStyle = INK; g.lineWidth = Math.max(2, cell * .12); for (const [, b] of boxes) g.strokeRect(b.x, b.y, b.w, b.h);
  for (const [r, b] of boxes) { g.strokeStyle = r.damage ? 'rgba(255,90,90,.85)' : 'rgba(176,204,255,.6)'; g.lineWidth = 1.2; g.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3); }
  for (const d of hull.doors) { const p = toScreen(layout, d.x, d.y), long = cell * .5, thin = Math.max(3, cell * .14);
    g.fillStyle = '#f0b04a'; g.strokeStyle = INK; g.lineWidth = 1; const [w, h] = d.vertical ? [thin, long] : [long, thin]; g.fillRect(p.x - w / 2, p.y - h / 2, w, h); g.strokeRect(p.x - w / 2, p.y - h / 2, w, h); }
  const big = detail === 'phone', thumb = detail === 'thumb';
  if (!thumb || cell >= 12) for (const [r, b] of boxes) {
    if (!r.system) continue;
    const s = Math.min(cell * (big ? .95 : .8), Math.min(b.w, b.h) * (big ? .72 : .64)), cx = b.x + b.w / 2, cy = b.y + b.h / 2 - (thumb ? 0 : s * .14), color = glyphColor(ship, r), lv = level(ship, r);
    g.globalAlpha = r.tier ? 1 : .45; drawGlyph(g, r.system, cx, cy, s, color); g.globalAlpha = 1;
    if (thumb || !r.tier) continue;
    const gap = cell * .05, pw = Math.min(cell * .2, (b.w * .86 - gap * (r.tier - 1)) / r.tier), ph = Math.max(3, cell * .12), x0 = cx - (r.tier * pw + (r.tier - 1) * gap) / 2, py = cy + s * .52 + cell * .03;
    for (let i = 0; i < r.tier; i++) { g.fillStyle = r.ionMs > 0 ? '#5cc8ff' : i < lv ? SYSTEM_COLORS[r.system] : i >= r.tier - r.damage ? '#ff4d4d' : '#2a3350';
      g.fillRect(x0 + i * (pw + gap), py, pw, ph); g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(x0 + i * (pw + gap), py, pw, ph); }
    if (big) { const x = b.x + b.w - cell * .1, y = b.y + cell * .06; g.font = `${Math.round(cell * .4)}px 'Lilita One', sans-serif`; g.textAlign = 'right'; g.textBaseline = 'top'; g.lineWidth = 3; g.strokeStyle = INK; g.fillStyle = color;
      g.strokeText(String(lv), x, y); g.fillText(String(lv), x, y); }
  }
  ship.weapons.forEach((w, i) => { const p = mountPoint(layout, i), f = layout.facing;
    g.fillStyle = w.powered ? '#98a3bb' : '#4a5263'; g.strokeStyle = INK; g.lineWidth = 1.2;
    g.beginPath(); g.roundRect(f === 1 ? p.x : p.x - cell * .52, p.y - cell * .07, cell * .52, cell * .14, cell * .04); g.fill(); g.stroke();
    g.fillStyle = w.powered ? '#5a6479' : '#343a48'; g.beginPath(); g.arc(p.x, p.y, cell * .19, 0, Math.PI * 2); g.fill(); g.stroke(); });
  const next = { ship, layout, key, canvas: c, scale };
  bases.delete(id); if (bases.size > 32) bases.delete(bases.keys().next().value!); bases.set(id, next); return next;
}
/** The last static layer drawn for a ship (used to slice wreck debris), or null. */
export const shipLayer = (shipId: string, detail = 'tv') => bases.get(`${shipId}|${detail}`) ?? null;

type Track = { x: number; y: number; fx: number; fy: number; tx: number; ty: number; at: number; ship: string };
const tracks = new Map<string, Track>(), deaths = new Map<string, number>();
/** Crew positions ease between 10 Hz snapshots. */
function crewPoint(m: Crew, now: number) {
  let p = tracks.get(m.id);
  if (!p || p.ship !== m.shipId) { if (tracks.size > 400) tracks.clear(); tracks.set(m.id, p = { x: m.x, y: m.y, fx: m.x, fy: m.y, tx: m.x, ty: m.y, at: now, ship: m.shipId }); }
  else if (p.tx !== m.x || p.ty !== m.y) { p.fx = p.x; p.fy = p.y; p.tx = m.x; p.ty = m.y; p.at = now; }
  const k = Math.min(1, (now - p.at) / 110); p.x = p.fx + (p.tx - p.fx) * k; p.y = p.fy + (p.ty - p.fy) * k;
  return p;
}
/** Last drawn screen position of a crew member (for death flashes). */
export const crewScreen = (layout: ShipLayout, crewId: string) => { const p = tracks.get(crewId); return p ? toScreen(layout, p.x, p.y) : null; };
/** Face and crown (hair, crystal, carapace, flame) per species; bodies use the species colour. */
const HEAD: Record<SpeciesId, [face: string, crown: string]> = { human: ['#f3d2b3', '#4a2f24'], bastion: ['#e4dbf7', '#8d78c4'], skitter: ['#dff5b8', '#4f7a30'], ember: ['#ffd7a6', '#ff6a3a'] };
const speciesColor = Object.fromEntries(SPECIES.map(s => [s.id, s.color])) as Record<SpeciesId, string>;

/** A small front-facing figure standing on an ownership floor ring (circle = ally captain colour, diamond = hostile). */
function drawCrew(ctx: CanvasRenderingContext2D, m: Crew, layout: ShipLayout, o: ShipDrawOptions, ring: string) {
  const now = o.nowMs, p = crewPoint(m, now), { x, y } = toScreen(layout, p.x, p.y), r = layout.cell * (o.detail === 'phone' ? .29 : .27), lw = Math.max(1.2, r * .15);
  if (o.detail === 'thumb') { ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(x, y, r * 1.1, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = speciesColor[m.species]; ctx.beginPath(); ctx.arc(x, y, r * .7, 0, Math.PI * 2); ctx.fill(); return; }
  const moving = now - p.at < 110 || m.state === 'walking', bob = moving ? Math.abs(Math.sin(now * .02 + x)) * -r * .22 : 0, fy = y + r * .78;
  if (o.selectedCrew?.includes(m.id)) { ctx.strokeStyle = '#fff6e5'; ctx.lineWidth = 2.5; ctx.globalAlpha = .65 + .35 * Math.sin(now * .01); ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
  ctx.beginPath(); if (m.faction === 'enemy') { ctx.moveTo(x - r * 1.3, fy); ctx.lineTo(x, fy - r * .6); ctx.lineTo(x + r * 1.3, fy); ctx.lineTo(x, fy + r * .6); ctx.closePath(); } else ctx.ellipse(x, fy, r * 1.2, r * .52, 0, 0, Math.PI * 2);
  ctx.fillStyle = ring; ctx.globalAlpha = .35; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = ring; ctx.lineWidth = Math.max(1.6, r * .24); ctx.stroke();
  const by = y + bob, wide = m.species === 'bastion' ? 1.2 : 1, [face, crown] = HEAD[m.species];
  ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.fillStyle = speciesColor[m.species];
  ctx.beginPath(); ctx.roundRect(x - r * .7 * wide, by - r * .12, r * 1.4 * wide, r * .95, [r * .5, r * .5, r * .18, r * .18]); ctx.fill(); ctx.stroke();
  const hy = by - r * .52, hr = r * (m.species === 'bastion' ? .48 : .44);
  ctx.fillStyle = face; ctx.beginPath(); if (m.species === 'bastion') ctx.roundRect(x - hr, hy - hr, hr * 2, hr * 2, hr * .35); else ctx.arc(x, hy, hr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = crown; ctx.beginPath();
  if (m.species === 'ember') { ctx.moveTo(x - hr * .8, hy - hr * .5); ctx.lineTo(x - hr * .3, hy - hr * 1.7); ctx.lineTo(x, hy - hr * .9); ctx.lineTo(x + hr * .4, hy - hr * 1.9); ctx.lineTo(x + hr * .8, hy - hr * .5); ctx.closePath(); }
  else if (m.species === 'bastion') ctx.rect(x - hr, hy - hr, hr * 2, hr * .7); else ctx.arc(x, hy - hr * .15, hr * .98, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();
  if (m.species === 'skitter') { ctx.strokeStyle = crown; ctx.lineWidth = lw * 1.2; ctx.beginPath(); ctx.moveTo(x - hr * .4, hy - hr * .8); ctx.lineTo(x - hr * .9, hy - hr * 1.8); ctx.moveTo(x + hr * .4, hy - hr * .8); ctx.lineTo(x + hr * .9, hy - hr * 1.8); ctx.stroke(); }
  if (m.state === 'repairing' || m.state === 'extinguishing' || m.state === 'fighting') { if (hash(Math.floor(now / 90) + x) > .45) { ctx.fillStyle = m.state === 'fighting' ? '#ff5748' : m.state === 'repairing' ? '#ffd24a' : '#e8f6ff';
    ctx.beginPath(); ctx.arc(x + r * .95, by - r * .3, r * .2, 0, Math.PI * 2); ctx.fill(); } }
  if (m.hp < m.maxHp) { const f = Math.max(0, m.hp / m.maxHp), w = r * 2.1, h = Math.max(3, r * .26), bx = x - w / 2, bY = hy - hr - h - r * .3;
    ctx.fillStyle = INK; ctx.fillRect(bx - 1, bY - 1, w + 2, h + 2); ctx.fillStyle = f > .6 ? '#78d955' : f > .3 ? '#ffd24a' : '#ff5748'; ctx.fillRect(bx, bY, w * f, h); }
}

const unitShield = new WeakMap<CanvasRenderingContext2D, CanvasGradient>();
function drawShields(ctx: CanvasRenderingContext2D, ship: ShipView, layout: ShipLayout, now: number) {
  const layers = ship.shields, temp = ship.tempShield, missing = layers < ship.maxShields, charging = missing && ship.shieldCharge > 0, locked = missing && ship.shieldCharge < 0;
  if (!layers && !temp && !charging && !locked) return;
  const e = shieldEllipse(layout), lw = Math.max(1.4, layout.cell * .05);
  let grad = unitShield.get(ctx); if (!grad) { grad = ctx.createRadialGradient(0, 0, .55, 0, 0, 1); grad.addColorStop(0, 'rgba(90,200,255,0)'); grad.addColorStop(.85, 'rgba(90,200,255,.1)'); grad.addColorStop(1, 'rgba(160,235,255,.26)'); unitShield.set(ctx, grad); }
  if (layers || temp) { ctx.save(); ctx.translate(e.x, e.y); ctx.scale(e.rx, e.ry); ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  ctx.lineWidth = lw;
  for (let i = 0; i < layers + temp; i++) { const k = 1 + i * .045, gold = i >= layers;
    ctx.strokeStyle = gold ? 'rgba(255,214,90,.8)' : 'rgba(120,220,255,.55)'; ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx * k, e.ry * k, 0, 0, Math.PI * 2); ctx.stroke();
    const a = now * .0007 * (i % 2 ? -1 : 1) + i * 2.1; ctx.strokeStyle = gold ? '#fff0b0' : 'rgba(215,248,255,.9)'; ctx.lineWidth = lw * 1.6;
    ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx * k, e.ry * k, 0, a, a + .7); ctx.stroke(); ctx.lineWidth = lw; }
  if (charging) { const k = 1 + layers * .045; ctx.strokeStyle = 'rgba(120,220,255,.35)'; ctx.setLineDash([lw * 2, lw * 2]);
    ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx * k, e.ry * k, 0, -Math.PI / 2, -Math.PI / 2 + Math.min(1, ship.shieldCharge) * Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
  // Negative shieldCharge = recharge locked by ion: a flickering blue ring instead of progress.
  if (locked) { ctx.strokeStyle = `rgba(92,200,255,${(.3 + .25 * Math.sin(now * .03)).toFixed(3)})`; ctx.setLineDash([lw, lw * 3]); ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
}

function drawLiveRooms(ctx: CanvasRenderingContext2D, ship: ShipView, layout: ShipLayout, o: ShipDrawOptions) {
  const now = o.nowMs, cell = layout.cell;
  ship.rooms.forEach((r, i) => {
    const b = layout.rooms[r.id]; if (!b) return;
    if (r.damage) { ctx.fillStyle = 'rgba(255,40,40,1)'; ctx.globalAlpha = hash(Math.floor(now / 85) + i * 9) > .78 ? .2 : .06; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.globalAlpha = 1; }
    if (r.fire > 0) {
      ctx.fillStyle = '#ff6a1a'; ctx.globalAlpha = .13 + .06 * Math.sin(now * .01 + i); ctx.fillRect(b.x, b.y, b.w, b.h); ctx.globalAlpha = 1;
      const def = layout.hull.rooms.find(d => d.id === r.id)!;
      for (let c = 0; c < def.w * def.h; c++) for (let k = 0; k < r.fire; k++) {
        const seed = c * 5 + k * 13 + i, fx = (c % def.w + .25 + .5 * hash(seed)) * cell, fy = (Math.floor(c / def.w) + .75) * cell, x = layout.facing === 1 ? b.x + fx : b.x + b.w - fx, y = b.y + fy;
        const h = cell * (.3 + .1 * r.fire) * (.75 + .3 * Math.sin(now * .017 + seed * 2.3)), w = cell * (.13 + .03 * r.fire), sway = Math.sin(now * .011 + seed) * w * .6;
        for (const [color, s] of [['#ff4d17', 1], ['#ffc53d', .55]] as const) { ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x - w * s, y); ctx.quadraticCurveTo(x - w * s, y - h * s * .5, x + sway * s, y - h * s); ctx.quadraticCurveTo(x + w * s, y - h * s * .5, x + w * s, y); ctx.closePath(); ctx.fill(); }
      }
    }
    if (r.ionMs > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(70,160,255,.14)'; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.strokeStyle = '#9fe2ff'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let a = 0; a < 2; a++) { const seed = Math.floor(now / 60) * 7 + i * 3 + a * 11; let x = b.x + hash(seed) * b.w, y = b.y + hash(seed + 1) * b.h; ctx.moveTo(x, y);
        for (let s = 0; s < 5; s++) { x = Math.min(b.x + b.w, Math.max(b.x, x + (hash(seed + s * 2 + 2) - .5) * cell * .7)); y = Math.min(b.y + b.h, Math.max(b.y, y + (hash(seed + s * 2 + 3) - .5) * cell * .7)); ctx.lineTo(x, y); } }
      ctx.stroke(); ctx.restore(); }
    if (r.breach) { const up = b.y + b.h / 2 < layout.grid.y + layout.grid.h / 2 ? -1 : 1; ctx.fillStyle = '#dfe9ff';
      for (let k = 0; k < 7; k++) { const t = (now / 900 + k / 7) % 1; ctx.globalAlpha = (1 - t) * .5; ctx.beginPath();
        ctx.arc(b.x + b.w / 2 + (hash(k + i) - .5) * cell * .9 * t, b.y + b.h / 2 + up * t * cell * 1.3, cell * (.05 + .12 * t), 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1; }
  });
  const pulse = .5 + .5 * Math.sin(now * .006);
  for (const id of o.highlightRooms ?? []) { const b = layout.rooms[id]; if (!b) continue; ctx.fillStyle = 'rgba(255,210,74,.1)'; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.strokeStyle = `rgba(255,210,74,${(.45 + .45 * pulse).toFixed(3)})`; ctx.lineWidth = 2.5; ctx.strokeRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4); }
  const sel = o.selectedRoom && layout.rooms[o.selectedRoom];
  if (sel) { const k = Math.min(sel.w, sel.h) * .28; ctx.strokeStyle = '#fff6e5'; ctx.lineWidth = 3; ctx.beginPath();
    for (const [x, y, dx, dy] of [[sel.x, sel.y, 1, 1], [sel.x + sel.w, sel.y, -1, 1], [sel.x, sel.y + sel.h, 1, -1], [sel.x + sel.w, sel.y + sel.h, -1, -1]]) { ctx.moveTo(x + dx * k, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * k); }
    ctx.stroke(); }
}

export function drawShip(ctx: CanvasRenderingContext2D, ship: ShipView, crew: readonly Crew[], layout: ShipLayout, options: ShipDrawOptions): void {
  if (!(layout.cell > 0)) return;
  const o = options, now = o.nowMs, base = baseFor(ctx, ship, layout, o.detail ?? 'tv'), { sprite, cell, facing } = layout, alive = ship.status === 'active', cloaked = ship.cloakMs > 0;
  ctx.save(); if (!alive) ctx.globalAlpha = .35; else if (cloaked) ctx.globalAlpha = .4;
  const engines = alive && ship.rooms.find(r => r.system === 'engines'), power = engines ? level(ship, engines) : 0, def = engines && layout.hull.rooms.find(d => d.id === engines.id);
  if (def && power > 0) { ctx.globalCompositeOperation = 'lighter';
    for (let y = def.y; y < def.y + def.h; y++) { const p = toScreen(layout, NOZZLE_X, y + .5), len = cell * (.8 + power * .16) * (1 + .12 * Math.sin(now * .031 + y * 1.7)), cx = p.x - facing * len / 2;
      ctx.fillStyle = ship.faction === 'ally' ? 'rgba(90,170,255,.4)' : 'rgba(255,120,70,.4)'; ctx.beginPath(); ctx.ellipse(cx, p.y, len / 2, cell * .24, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(235,248,255,.85)'; ctx.beginPath(); ctx.ellipse(p.x - facing * len * .22, p.y, len * .24, cell * .1, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over'; }
  ctx.drawImage(base.canvas, sprite.x, sprite.y, base.canvas.width / base.scale, base.canvas.height / base.scale);
  if (cloaked && alive) { ctx.globalCompositeOperation = 'lighter'; const slices = 6, sh = base.canvas.height / slices;
    for (let i = 0; i < slices; i++) { ctx.globalAlpha = .1; ctx.drawImage(base.canvas, 0, i * sh, base.canvas.width, sh, sprite.x + Math.sin(now * .006 + i * 1.3) * cell * .25, sprite.y + i * sh / base.scale, base.canvas.width / base.scale, sh / base.scale); }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = .4; }
  drawLiveRooms(ctx, ship, layout, o);
  if (alive) ship.weapons.forEach((w, i) => { if (!w.powered) return; const p = mountPoint(layout, i), x = p.x + facing * cell * .5, kind = weaponDef(w.defId).kind, ready = w.charge >= 1;
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = KIND_COLORS[kind]; ctx.globalAlpha = (ready ? .45 + .3 * Math.sin(now * .012 + i) : .25) * (cloaked ? .4 : 1);
    ctx.beginPath(); ctx.arc(x, p.y, cell * (.08 + .2 * Math.min(1, w.charge)), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = cloaked ? .4 : 1; ctx.fillStyle = ready ? '#fff' : KIND_COLORS[kind]; ctx.beginPath(); ctx.arc(x, p.y, cell * .06, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; });
  const alpha = ctx.globalAlpha;
  if (alive) for (const m of crew) { const fade = m.state === 'dead' ? 1 - (now - (deaths.get(m.id) ?? deaths.set(m.id, now).get(m.id)!)) / 700 : 1; if (fade <= 0) continue;
    ctx.globalAlpha = alpha * fade; drawCrew(ctx, m, layout, o, m.faction === 'enemy' ? ENEMY_RING : o.ownerColors[m.ownerId ?? ''] ?? '#fff6e5'); }
  ctx.globalAlpha = alpha; if (deaths.size > 400) deaths.clear();
  if (alive) drawShields(ctx, ship, layout, now);
  ctx.restore();
}
