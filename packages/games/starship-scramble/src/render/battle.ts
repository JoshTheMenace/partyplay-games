/** The TV battle canvas: static backdrop layer + a per-frame layer with stars, ships, projectiles and event effects. */
import type { CombatEvent, Crew, Projectile, PublicView, ShipView } from '../contracts';
import { systemDef, weaponDef } from '../defs/catalog';
import { neighbors, roomAtPoint } from '../defs/geometry';
import { BACKDROP_IDS, backdropImage, loadBackdrops, paintBackdrop } from './backdrop';
import { Effects, Kind, glow } from './fx';
import { hash } from './hullart';
import { drawShot, ellipseEntry, type Pt, type Shot } from './projectiles';
import { arrivalMs, mountPoint, roomCenter, shieldEllipse, type SceneLayout } from './scene';
import { KIND_COLORS, crewScreen, drawShip, shipLayer, type ShipDrawOptions } from './ship';

export type BattleInput = { view: PublicView; scene: SceneLayout; highlight?: readonly { shipId: string; roomIds: readonly string[] }[]; selectedCrew?: readonly string[] };
type Pose = { x: number; y: number; show: boolean; stretch: number; alpha: number; streak: number; flash: number };
const NONE: Crew[] = [], ORIGIN: Pt = { x: 0, y: 0 }, ENEMY_LASER = '#ff4436';
const def = (id?: string) => { try { return id ? weaponDef(id) : null; } catch { return null; } };
const hex = (c: string) => /^#[0-9a-f]{6}$/i.test(c) ? c : '#ff5a44';
const easeOut = (x: number) => 1 - (1 - x) ** 3;

export class BattleRenderer {
  private fx = new Effects(() => performance.now());
  private input: BattleInput | null = null;
  private clock = { id: '', t: 0, at: 0, shown: -Infinity };
  private primed = false;
  private seen = new Set<string>();
  private left = new Map<string, number>();
  private escapedAt = 0;
  private crew = new Map<string, Crew[]>();
  /** Crew who just left the view by dying: drawn fading out for a moment. */
  private ghosts = new Map<string, [Crew, number]>();
  /** Floating-text stacking per ship, so one volley's callouts never print over each other. */
  private lanes = new Map<string, { at: number; n: number }>();
  private ships = new Map<string, ShipView>();
  private highlight = new Map<string, readonly string[]>();
  private poses = new Map<string, Pose>();
  private shots = new Map<string, Shot & { rooms: string[]; placed: boolean }>();
  private opts: ShipDrawOptions = { nowMs: 0, ownerColors: {}, detail: 'tv' };
  private stars: Float32Array[] = [];
  private w = 0; private h = 0; private dpr = 1; private bgKey = ''; private last = 0; private raf = 0;
  private reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  private tmp = { x: 0, y: 0 };
  hover: { shipId: string; roomId: string } | null = null;
  constructor(private bg: HTMLCanvasElement, private main: HTMLCanvasElement, private assetBase: string) { this.raf = requestAnimationFrame(this.frame); }
  dispose() { cancelAnimationFrame(this.raf); }

  resize(w: number, h: number) {
    this.w = w; this.h = h; this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    for (const c of [this.bg, this.main]) { c.width = Math.round(w * this.dpr); c.height = Math.round(h * this.dpr); }
    this.stars = [90, 50, 24].map((n, layer) => { const a = new Float32Array(n * 3), k = n * w * h / (1920 * 1080);
      for (let i = 0; i < a.length && i < k * 3; i += 3) { a[i] = hash(i + layer * 999) * w; a[i + 1] = hash(i * 1.7 + layer * 77) * h; a[i + 2] = (.6 + hash(i * 3.1) * .9) * (layer + 1) * .8; }
      return a; });
    this.bgKey = ''; this.paintBg();
  }
  /** Combat ms extrapolated from the last snapshot (frozen while paused, capped at 250 ms, never running backwards). */
  time(now: number) {
    const c = this.clock, combat = this.input?.view.combat; if (!combat) return 0;
    return c.shown = Math.max(c.shown, combat.paused ? c.t : c.t + Math.min(250, now - c.at));
  }
  set(input: BattleInput) {
    const prev = this.input?.view, view = input.view, now = performance.now(), combat = view.combat; this.input = input;
    this.highlight = new Map(input.highlight?.map(h => [h.shipId, h.roomIds]));
    this.opts.selectedCrew = input.selectedCrew;
    if (view === prev) return;
    if (combat) { if (combat.id !== this.clock.id) for (const m of [this.left, this.poses, this.ghosts, this.lanes]) m.clear();
      if (combat.id !== this.clock.id || combat.t < this.clock.shown - 500) Object.assign(this.clock, { id: combat.id, shown: -Infinity }); this.clock.t = combat.t; this.clock.at = now; }
    this.opts.ownerColors = Object.fromEntries(view.captains.map(c => [c.id, c.color]));
    const here = new Set(view.crew.map(m => m.id));
    for (const list of this.crew.values()) for (const m of list) if (!here.has(m.id) && m.state !== 'dead' && this.ships.get(m.shipId)?.status === 'active') this.ghosts.set(m.id, [{ ...m, state: 'dead' }, now]);
    for (const [id, [, at]] of this.ghosts) if (now - at > 1000) this.ghosts.delete(id);
    this.crew = new Map(); for (const m of [...view.crew, ...[...this.ghosts.values()].map(g => g[0])]) (this.crew.get(m.shipId) ?? this.crew.set(m.shipId, []).get(m.shipId)!).push(m);
    for (const s of view.ships) { const was = this.ships.get(s.id); if (s.status !== 'active' && (!was || was.status === 'active')) this.left.set(s.id, was ? now : -Infinity); if (s.status === 'active') this.left.delete(s.id); }
    this.ships = new Map(view.ships.map(s => [s.id, s]));
    if (combat?.outcome === 'escaped' && prev?.combat?.outcome !== 'escaped') this.escapedAt = prev ? now : -Infinity; else if (combat?.outcome !== 'escaped') this.escapedAt = 0;
    const live = new Set(combat?.projectiles.map(p => p.id)); for (const id of this.shots.keys()) if (!live.has(id)) this.shots.delete(id);
    // Muzzle flashes come from new projectiles (the full list), so the capped event window can never drop one.
    // A hidden tab pauses the frame loop, so stale effects are only marked seen; they would otherwise all burst at once on return.
    const play = this.primed && !document.hidden, since = (combat?.t ?? 0) - 1500;
    for (const p of combat?.projectiles ?? []) if (!this.seen.has(p.id)) { this.seen.add(p.id); if (play) this.muzzle(p); }
    for (const e of combat?.events ?? []) if (!this.seen.has(e.id)) { this.seen.add(e.id); if (play && e.atMs >= since) this.event(e, view); }
    this.primed = true; if (this.seen.size > 800) this.seen = new Set([...combat?.events ?? [], ...combat?.projectiles ?? []].map(e => e.id));
    this.paintBg();
  }
  /** The ship room under a scene point, if any. */
  pick(px: number, py: number) {
    for (const [id, s] of Object.entries(this.input?.scene.ships ?? {})) { const p = this.poses.get(id); if (!p?.show) continue;
      const roomId = roomAtPoint(s.layout, px - p.x, py - p.y); if (roomId) return { shipId: id, roomId }; }
    return null;
  }
  private get motion() { return !this.reduced?.matches; }
  private backdropId() { const v = this.input?.view; return v?.combat?.objective === 'boss' ? 'armada-reach' : v?.map.sectorId ?? 'rustbelt'; }
  private paintBg() {
    const id = this.backdropId(), hazard = this.input?.view.combat?.hazard ?? 'none', img = backdropImage(id), key = `${this.w}|${this.h}|${this.dpr}|${id}|${hazard}|${!!img}`;
    if (img === undefined && (BACKDROP_IDS as readonly string[]).includes(id)) void loadBackdrops(this.assetBase).then(() => { this.bgKey = ''; this.paintBg(); });
    if (key === this.bgKey || !this.w) return; this.bgKey = key;
    const g = this.bg.getContext('2d')!; g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); paintBackdrop(g, this.w, this.h, id);
    const tint = { nebula: 'rgba(170,80,230,.75)', 'ion-storm': 'rgba(70,150,255,.6)', solar: 'rgba(255,150,60,.5)' }[hazard as string];
    if (tint) { g.globalCompositeOperation = 'soft-light'; g.fillStyle = tint; g.fillRect(0, 0, this.w, this.h); g.globalCompositeOperation = 'source-over'; }
  }
  private off(shipId: string): Pt { return this.poses.get(shipId) ?? ORIGIN; }
  private pos(shipId: string, roomId?: string): Pt | null {
    const s = this.input?.scene.ships[shipId]; if (!s) return null; const c = roomCenter(s.layout, roomId), p = this.off(shipId);
    return { x: c.x + p.x, y: c.y + p.y };
  }
  private muzzle(p: Projectile) {
    const sl = this.input!.scene.ships[p.fromShipId], u = this.input!.scene.unit; if (!sl) return;
    const m = mountPoint(sl.layout, p.mount), o = this.off(p.fromShipId), x = m.x + o.x + sl.layout.facing * sl.layout.cell * .55, y = m.y + o.y;
    this.fx.add({ k: 'glow', x, y, r: 26 * u, color: KIND_COLORS[p.kind], dur: 260 }); this.fx.burst(x, y, 5, Kind.Spark, '#ffe0a0', 220 * u, 240, 2 * u);
  }
  /** Event semantics (src/sim): shipId is the affected ship, fromShipId the shooter or source; weaponId is a weapon def id. */
  private event(e: CombatEvent, view: PublicView) {
    const fx = this.fx, u = this.input!.scene.unit, at = this.pos(e.shipId, e.roomId), ship = this.ships.get(e.shipId), layout = this.input!.scene.ships[e.shipId]?.layout;
    if (!at || !ship || !layout) return;
    const src = e.fromShipId ? this.pos(e.fromShipId) : null, text = (text: string, color: string, size = 30) => {
      const now = performance.now(), l = this.lanes.get(e.shipId), n = l && now - l.at < 700 ? (l.n + 1) % 4 : 0; this.lanes.set(e.shipId, { at: now, n });
      fx.add({ k: 'text', x: at.x, y: at.y - (20 + n * 34) * u, text, color, size: size * u, dur: 1300 }); };
    const flash = (color: string) => { const b = e.roomId && layout.rooms[e.roomId], p = this.off(e.shipId); if (b) fx.add({ k: 'rect', x: b.x + p.x, y: b.y + p.y, w: b.w, h: b.h, color, dur: 600 }); };
    switch (e.type) {
      case 'hit': { const a = e.amount ?? 1;
        fx.add({ k: 'boom', x: at.x, y: at.y, r: (30 + 12 * a) * u, color: '#ff8a2a', dur: 700 }); fx.add({ k: 'ring', x: at.x, y: at.y, r: (40 + 14 * a) * u, color: '#ffd9a0', w: 5 * u, dur: 420 });
        fx.burst(at.x, at.y, 16 + 6 * a, Kind.Spark, '#ffd27a', 620 * u, 560, 2.8 * u); fx.burst(at.x, at.y, 4 + 2 * a, Kind.Debris, '#59606f', 200 * u, 1100, 3.5 * u); fx.burst(at.x, at.y, 5, Kind.Smoke, '#5b5f6b', 50 * u, 1400, 7 * u);
        if (a > 0) text(`-${a}`, '#ff6a55', 30 + 5 * a); fx.shake(e.shipId, (3 + 2.5 * a) * u); if (a >= 3) fx.shake('screen', 7 * u); break; }
      case 'miss': { text('MISS', '#e8eefc', 26); if (src) { const dx = at.x - src.x, dy = at.y - src.y, d = Math.hypot(dx, dy) || 1, kind = def(e.weaponId)?.kind ?? 'laser';
        fx.add({ k: 'streak', x1: at.x, y1: at.y, x2: at.x + dx / d * 600 * u, y2: at.y + dy / d * 600 * u, color: kind === 'laser' ? ENEMY_LASER : KIND_COLORS[kind], w: 4 * u, dur: 650 }); } break; }
      case 'shield': { const el = shieldEllipse(layout), p = this.off(e.shipId), cx = el.x + p.x, cy = el.y + p.y, from = src ?? { x: cx - layout.facing * 100, y: cy };
        const angle = Math.atan2((from.y - cy) / el.ry, (from.x - cx) / el.rx);
        fx.add({ k: 'ripple', x: cx, y: cy, rx: el.rx, ry: el.ry, angle, color: '#6fe0ff', dur: 700 }); fx.burst(cx + Math.cos(angle) * el.rx, cy + Math.sin(angle) * el.ry, 10, Kind.Spark, '#bff4ff', 300 * u, 380, 2 * u); break; }
      case 'intercept': { const d = this.pos(e.shipId, ship.rooms.find(r => r.system === 'defense')?.id) ?? at, to = src ?? { x: d.x - layout.facing * 200 * u, y: d.y }, x = d.x + (to.x - d.x) * .3, y = d.y + (to.y - d.y) * .3;
        fx.add({ k: 'tracer', x1: d.x, y1: d.y, x2: x, y2: y, color: '#ff8fc7', dur: 260 }); fx.add({ k: 'boom', x, y, r: 24 * u, color: '#ffb347', dur: 420, at: performance.now() + 90 }); fx.burst(x, y, 10, Kind.Spark, '#ffd27a', 360 * u, 420, 2 * u);
        fx.add({ k: 'text', x, y: y - 26 * u, text: 'INTERCEPTED', color: '#ff9fd0', size: 20 * u, dur: 1100 }); break; }
      case 'fire': flash('#ff7a1a'); fx.burst(at.x, at.y, 12, Kind.Ember, '#ff9a3a', 120 * u, 900, 2.5 * u); break;
      case 'breach': flash('#0a0a14'); fx.burst(at.x, at.y, 10, Kind.Debris, '#6b7282', 260 * u, 1200, 3 * u); text('BREACH', '#ffb08a', 22); break;
      case 'ion': flash('#4aa8ff'); fx.burst(at.x, at.y, 12, Kind.Spark, '#9fe2ff', 280 * u, 400, 1.8 * u); break;
      case 'system-down': { flash('#ff2a2a'); const r = ship.rooms.find(q => q.id === e.roomId); if (r?.system) text(`${systemDef(r.system).name.toUpperCase()} DOWN`, '#ff5d5d', 22); break; }
      case 'repair': case 'heal': { const kind = e.type === 'heal' ? def(e.weaponId)?.support : null; fx.burst(at.x, at.y, 14, Kind.Ember, kind === 'shield' ? '#5ff2ff' : '#6dff9a', 110 * u, 900, 2.4 * u);
        if (kind === 'shield') text('SHIELD +1', '#8ff6ff', 24); else if (kind && e.amount) text(`+${e.amount} ${kind === 'heal' ? 'HP' : 'HULL'}`, '#78f08a', 26); break; }
      case 'crew-death': { const c = e.crewId ? crewScreen(layout, e.crewId) : null, p = this.off(e.shipId), x = c ? c.x + p.x : at.x, y = c ? c.y + p.y : at.y;
        fx.add({ k: 'glow', x, y, r: 30 * u, color: '#ff5d5d', dur: 420 }); fx.add({ k: 'ring', x, y, r: 26 * u, color: '#ffffff', w: 3 * u, dur: 420 }); break; }
      case 'teleport': fx.add({ k: 'column', x: at.x, y: at.y + layout.cell * .5, w: layout.cell * 1.1, h: layout.cell * 2.2, color: '#c6a0ff', dur: 900 }); break; // emitted once per end
      case 'explode': this.explode(e.shipId, layout, u); break;
      case 'flee': case 'cloak': { const c = this.pos(e.shipId)!; fx.add({ k: 'ring', x: c.x, y: c.y, r: layout.sprite.w * .6, color: e.type === 'cloak' ? '#b9c4ff' : '#9fd8ff', w: 6 * u, dur: 700 }); break; }
      case 'phase': { const c = this.pos(e.shipId)!; fx.add({ k: 'flash', color: '#ff2f55', alpha: .5, dur: 1100 }); fx.add({ k: 'ring', x: c.x, y: c.y, r: layout.sprite.w * .8, color: '#ffd24a', w: 10 * u, dur: 900 });
        fx.add({ k: 'boom', x: c.x, y: c.y, r: layout.sprite.h * .8, color: '#ff4a6a', dur: 900 }); fx.shake('screen', 10 * u); fx.shake(e.shipId, 12 * u); break; }
      case 'hazard': { const hz = view.combat?.hazard;
        if (hz === 'solar') fx.add({ k: 'glare', dur: 1800 });
        else if (hz === 'ion-storm') fx.add({ k: 'flash', color: '#7fc8ff', alpha: .25, dur: 500 });
        else fx.add({ k: 'streak', x1: at.x - 500 * u, y1: at.y - 700 * u, x2: at.x, y2: at.y, color: '#b9a08a', w: 7 * u, dur: 520 }); break; }
    }
  }
  /** Multi-stage explosion: staggered fireballs over the rooms, the hull breaking into drifting sprite slices, flash and shake. */
  private explode(shipId: string, layout: SceneLayout['ships'][string]['layout'], u: number) {
    const fx = this.fx, now = performance.now(), p = this.off(shipId), rooms = Object.values(layout.rooms), cx = layout.grid.x + layout.grid.w / 2 + p.x, cy = layout.grid.y + layout.grid.h / 2 + p.y;
    rooms.forEach((b, i) => fx.add({ k: 'boom', x: b.x + b.w / 2 + p.x, y: b.y + b.h / 2 + p.y, r: (34 + 30 * hash(i)) * u, color: i % 2 ? '#ff7a2a' : '#ffb347', dur: 620, at: now + i * 90 }));
    fx.add({ k: 'boom', x: cx, y: cy, r: layout.sprite.w * .45, color: '#ffa040', dur: 1100, at: now + 650 }); fx.add({ k: 'ring', x: cx, y: cy, r: layout.sprite.w * .9, color: '#ffe2b0', w: 10 * u, dur: 900, at: now + 650 });
    fx.add({ k: 'flash', color: '#fff4dc', alpha: .35, dur: 600, at: now + 650 });
    fx.burst(cx, cy, 60, Kind.Spark, '#ffd27a', 700 * u, 900, 3 * u); fx.burst(cx, cy, 24, Kind.Debris, '#4c5362', 260 * u, 2600, 5 * u); fx.burst(cx, cy, 16, Kind.Smoke, '#4a4d57', 70 * u, 2600, 12 * u); fx.burst(cx, cy, 30, Kind.Ember, '#ff8a3a', 160 * u, 1800, 2.5 * u);
    fx.shake('screen', 14 * u); fx.shake(shipId, 16 * u);
    const layer = shipLayer(shipId); if (!layer) return;
    const img = document.createElement('canvas'), { sprite } = layout; img.width = layer.canvas.width; img.height = layer.canvas.height;
    const g = img.getContext('2d')!; g.drawImage(layer.canvas, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(24,10,6,.62)'; g.fillRect(0, 0, img.width, img.height);
    const cols = 4, rows = 2, sw = img.width / cols, sh = img.height / rows, w = sprite.w / cols, h = sprite.h / rows;
    for (let i = 0; i < cols * rows; i++) { const c = i % cols, r = Math.floor(i / cols), x = sprite.x + p.x + (c + .5) * w, y = sprite.y + p.y + (r + .5) * h, dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1, v = (30 + 50 * hash(i + 3)) * u;
      fx.add({ k: 'chunk', img, sx: c * sw, sy: r * sh, sw, sh, x, y, w, h, vx: dx / d * v, vy: dy / d * v, rot: 0, vr: (hash(i * 5) - .5) * .9, dur: 4200 }); }
  }
  private pose(ship: ShipView, t: number, now: number, u: number): Pose {
    const p = this.poses.get(ship.id) ?? this.poses.set(ship.id, { x: 0, y: 0, show: true, stretch: 1, alpha: 1, streak: 0, flash: 0 }).get(ship.id)!, combat = this.input!.view.combat!;
    const facing = ship.faction === 'ally' ? 1 : -1, seed = hash(ship.slot + (facing === 1 ? 0 : 10) + ship.id.length), motion = this.motion, shake = this.fx.offset(ship.id, this.tmp);
    p.x = (motion ? Math.sin(now * .0005 + seed * 6) * 6 * u : 0) + shake.x; p.y = (motion ? Math.sin(now * .0009 + seed * 9) * 5 * u : 0) + shake.y;
    p.show = true; p.stretch = 1; p.alpha = 1; p.streak = 0; p.flash = 0;
    const arrive = arrivalMs(combat, ship), w = (t - arrive + 650) / 650;
    if (t < arrive + 350) { if (w <= 0) p.show = false; else if (w < 1) { const k = 1 - easeOut(w); p.x -= facing * k * this.w * .8; p.stretch = 1 + k * 3; p.streak = k; } else p.flash = 1 - (t - arrive) / 350; }
    const gone = this.left.get(ship.id), leaving = ship.status === 'fled' ? gone : ship.faction === 'ally' && this.escapedAt ? this.escapedAt : undefined;
    if (ship.status === 'destroyed') p.show = false;
    else if (leaving !== undefined) { const k = (now - leaving) / 700; if (k >= 1 || !isFinite(k)) p.show = false; else { const dir = ship.status === 'fled' ? -facing : facing; p.x += dir * k * k * this.w; p.stretch = 1 + k * 4; p.streak = k; p.alpha = 1 - k * .5; } }
    return p;
  }
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const input = this.input, dt = Math.min(50, now - (this.last || now)); this.last = now;
    if (!input || !this.w || !this.h || input.scene.width !== this.w || input.scene.height !== this.h) return; // skip frames whose layout lags a resize
    const { view, scene } = input, combat = view.combat, ctx = this.main.getContext('2d')!, u = scene.unit, motion = this.motion, t = this.time(now);
    this.fx.density = motion ? 1 : .4; this.fx.step(dt);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.w, this.h);
    if (motion) { const s = this.fx.offset('screen', this.tmp); ctx.translate(s.x, s.y); }
    this.drawAmbience(ctx, now, u, motion, combat?.hazard ?? 'none');
    const o = this.opts; o.nowMs = now;
    for (const ship of view.ships) {
      const sl = scene.ships[ship.id]; if (!sl || !combat) continue;
      const p = this.pose(ship, t, now, u); if (!p.show) continue;
      const { layout } = sl, cx = layout.grid.x + layout.grid.w / 2, cy = layout.grid.y + layout.grid.h / 2;
      if (p.streak > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = p.streak; const len = layout.sprite.w * (1 + p.streak * 3), dir = ship.faction === 'ally' ? 1 : -1;
        ctx.drawImage(glow('#9fd8ff'), cx + p.x - (dir === 1 ? len : 0), cy + p.y - layout.sprite.h * .25, len, layout.sprite.h * .5); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
      ctx.save(); ctx.globalAlpha = p.alpha; ctx.translate(cx + p.x, cy + p.y); ctx.scale(p.stretch, 1); ctx.translate(-cx, -cy);
      o.selectedRoom = this.hover?.shipId === ship.id ? this.hover.roomId : null; o.highlightRooms = this.highlight.get(ship.id);
      drawShip(ctx, ship, this.crew.get(ship.id) ?? NONE, layout, o); ctx.restore();
      if (p.flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = p.flash; const r = layout.sprite.h * 1.2; ctx.drawImage(glow('#bfe6ff'), cx + p.x - r, cy + p.y - r, r * 2, r * 2); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
    }
    if (combat) for (const pr of combat.projectiles) {
      const q = (t - pr.launchMs) / Math.max(1, pr.arriveMs - pr.launchMs), a = this.ships.get(pr.fromShipId), b = this.ships.get(pr.toShipId), sa = scene.ships[pr.fromShipId], sb = scene.ships[pr.toShipId];
      if (q < 0 || q >= 1 || !b || !sb || !this.poses.get(b.id)?.show) continue;
      const pa = this.poses.get(pr.fromShipId), pb = this.poses.get(b.id)!;
      let s = this.shots.get(pr.id);
      if (!s) { const w = def(pr.weaponId), kind = w?.kind ?? pr.kind; this.shots.set(pr.id, s = { kind: pr.kind, support: w?.support, seed: hash(pr.id.length * 13 + pr.launchMs * .001) * 10, from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, stop: 1, chain: null, placed: false,
        color: kind === 'laser' ? (a?.faction === 'ally' ? hex(a.paint) : ENEMY_LASER) : w?.support === 'shield' ? '#5ff2ff' : KIND_COLORS[kind],
        bend: pr.kind === 'missile' ? (hash(pr.launchMs) - .5) * .5 : pr.fromShipId === pr.toShipId ? .7 : 0, rooms: this.beamRooms(b, pr.roomId, w?.beamRooms ?? 1) }); }
      // A shot keeps flying from its last muzzle position after its shooter explodes or warps away.
      if (sa && pa?.show) { const m = mountPoint(sa.layout, pr.mount); s.from.x = m.x + pa.x + sa.layout.facing * sa.layout.cell * .5; s.from.y = m.y + pa.y; s.placed = true; } else if (!s.placed) continue;
      const c = roomCenter(sb.layout, pr.roomId), rb = sb.layout.rooms[pr.roomId];
      s.to.x = c.x + pb.x + (rb ? (hash(s.seed) - .5) * rb.w * .5 : 0); s.to.y = c.y + pb.y + (rb ? (hash(s.seed + 1) - .5) * rb.h * .5 : 0);
      const e = shieldEllipse(sb.layout), shielded = b.shields + b.tempShield > 0 && pr.kind !== 'missile' && pr.kind !== 'support';
      s.stop = shielded ? ellipseEntry(s.from, s.to, { x: e.x + pb.x, y: e.y + pb.y, rx: e.rx, ry: e.ry }) : 1;
      s.chain = pr.kind === 'beam' ? s.rooms.map(id => { const r = roomCenter(sb.layout, id); return { x: r.x + pb.x, y: r.y + pb.y }; }) : null;
      drawShot(ctx, s, q, now, u);
    }
    this.fx.draw(ctx, u, this.w, this.h);
  };
  /** The rooms a beam sweeps: the target room, then unvisited door neighbours. */
  private beamRooms(ship: ShipView, roomId: string, n: number) {
    const hull = this.input!.scene.ships[ship.id].layout.hull, out = [roomId];
    while (out.length < n) { const next = neighbors(hull, out[out.length - 1]).find(id => !out.includes(id)); if (!next) break; out.push(next); }
    return out;
  }
  private drawAmbience(ctx: CanvasRenderingContext2D, now: number, u: number, motion: boolean, hazard: string) {
    const time = motion ? now / 1000 : 0;
    this.stars.forEach((a, layer) => { const speed = [7, 18, 44][layer] * u; ctx.fillStyle = ['#8fa3d8', '#c9d6ff', '#ffffff'][layer]; ctx.globalAlpha = [.4, .5, .55][layer]; ctx.beginPath();
      for (let i = 0; i < a.length; i += 3) { if (!a[i + 2]) continue; const x = ((a[i] - time * speed) % this.w + this.w) % this.w, s = a[i + 2] * u + .4; ctx.rect(x, a[i + 1], layer === 2 && motion ? s * 2.2 : s, s); }
      ctx.fill(); });
    ctx.globalAlpha = 1;
    if (hazard === 'asteroids') for (let i = 0; i < 9; i++) {
      const r = (10 + 22 * hash(i * 3.3)) * u, span = this.w + 200 * u, x = ((hash(i) * span - time * (12 + 20 * hash(i * 7)) * u) % span + span) % span - 100 * u, y = this.h * (.15 + .8 * hash(i * 9.1)), rot = time * (hash(i * 2) - .5);
      ctx.fillStyle = '#2e2926'; ctx.strokeStyle = '#6e5f53'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let k = 0; k < 8; k++) { const a = rot + k * Math.PI / 4, d = r * (.7 + .3 * hash(i * 11 + k)); ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); }
      ctx.closePath(); ctx.fill(); ctx.stroke(); }
    if (hazard === 'ion-storm' && motion) { const cycle = Math.floor(now / 3700), ph = now % 3700; if (ph < 180 && hash(cycle) > .3) { let x = hash(cycle * 3) * this.w, y = 0;
      ctx.strokeStyle = '#bfe6ff'; ctx.globalAlpha = 1 - ph / 180; ctx.lineWidth = 2 * u + .5; ctx.beginPath(); ctx.moveTo(x, y); while (y < this.h * .7) { x += (hash(x + y) - .5) * 80 * u; y += this.h * .037; ctx.lineTo(x, y); } ctx.stroke(); ctx.globalAlpha = 1; } }
    if (hazard === 'solar') { const r = Math.max(this.w, this.h) * .9; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .12 + (motion ? .05 * Math.sin(now * .0015) : 0);
      ctx.drawImage(glow('#ff9a3a'), this.w - r * .5, -r * .5, r, r); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
  }
}
