/**
 * The fleet broadcast: a battle of several wings on one TV. Every wing's engagement is a tile (allies left, its enemies right), ships are
 * hull sprites with a hull bar and shield ring, and the Flagship gets a panel of its own. The room only sends hull, shields and state per
 * ship plus the shots in flight (PublicView.fleet), so impacts, damage numbers and explosions are drawn from the difference between snapshots.
 */
import { WING_COLORS, wingLetter, wingName, type FleetShip, type PublicView } from '../contracts';
import { shipLayout, type Box, type ShipLayout } from '../defs/geometry';
import { hullDef } from '../defs/hulls';
import { BACKDROP_IDS, backdropImage, loadBackdrops, paintBackdrop } from './backdrop';
import { Effects, Kind, glow } from './fx';
import { hash } from './hullart';
import { drawShot, type Shot } from './projectiles';
import { KIND_COLORS, hullPlan } from './ship';

export type FleetLayout = { width: number; height: number; unit: number; /** Shot and effect scale: 1 when a tile is about a quarter of a 1080p screen. */ scale: number; tiles: { wing: number; box: Box }[]; boss: Box | null; ships: Record<string, ShipLayout> };
/** Columns that show `n` tiles largest in a w × h area (a tile wants to be about twice as wide as it is tall). */
export function gridColumns(n: number, w: number, h: number) {
  let best = 1, size = 0;
  for (let cols = 1; cols <= n; cols++) { const s = Math.min(w / cols, h / Math.ceil(n / cols) * 2); if (s > size + .5) { size = s; best = cols; } }
  return best;
}
/** Ships of one side stand in one column (up to two) or two, or in a single row when they have the tile to themselves; each keeps a strip under it for its bar and name. */
function formation(list: readonly FleetShip[], region: Box, facing: 1 | -1, out: Record<string, ShipLayout>, row = false) {
  const cols = row ? list.length : list.length > 2 ? 2 : 1, rows = Math.ceil(list.length / cols), w = region.w / cols, h = region.h / rows;
  list.forEach((ship, i) => { const col = facing === 1 ? cols - 1 - i % cols : i % cols, row = Math.floor(i / cols);
    out[ship.id] = shipLayout(hullDef(ship.hullId), { x: region.x + col * w + w * .04, y: region.y + row * h, w: w * .92, h: h * .8 }, facing); });
}
/** Pure geometry, shared with tests: tiles in wing order, the Flagship's panel on the right when there is one. */
export function fleetLayout(ships: readonly FleetShip[], wings: number, width: number, height: number): FleetLayout {
  const unit = Math.min(width / 1920, height / 1080), top = Math.max(height * .1, 84 * unit), pad = 12 * unit, flagship = ships.filter(s => s.wing < 0), out: Record<string, ShipLayout> = {};
  const area = { x: pad, y: top, w: (flagship.length ? width * .7 : width) - pad * 2, h: height - top - pad }, cols = gridColumns(wings, area.w, area.h), rows = Math.ceil(wings / cols);
  const tw = area.w / cols, th = area.h / rows, label = Math.min(40 * unit, th * .17);
  // A short last row sits centred.
  const tiles = Array.from({ length: wings }, (_, wing) => { const row = Math.floor(wing / cols), inset = (cols - Math.min(cols, wings - row * cols)) * tw / 2;
    return { wing, box: { x: area.x + inset + wing % cols * tw + pad / 2, y: area.y + row * th + pad / 2, w: tw - pad, h: th - pad } }; });
  for (const { wing, box } of tiles) {
    const inner = { x: box.x, y: box.y + label, w: box.w, h: box.h - label }, side = (faction: FleetShip['faction']) => ships.filter(s => s.wing === wing && s.faction === faction).sort((a, b) => a.slot - b.slot);
    // A wing with no squad of its own (it only faces the Flagship) spreads across its tile.
    if (!side('enemy').length) formation(side('ally'), inner, 1, out, true);
    else { formation(side('ally'), { ...inner, w: inner.w * .47 }, 1, out); formation(side('enemy'), { ...inner, x: inner.x + inner.w * .53, w: inner.w * .47 }, -1, out); }
  }
  const boss = flagship.length ? { x: width * .7, y: top + pad / 2, w: width * .3 - pad, h: height - top - pad * 1.5 } : null;
  if (boss) flagship.forEach((ship, i) => { out[ship.id] = shipLayout(hullDef(ship.hullId), { x: boss.x + boss.w * .03, y: boss.y + boss.h * (.24 + i * .3), w: boss.w * .94, h: boss.h * .44 }, -1); });
  return { width, height, unit, scale: Math.max(.34, Math.min(1, th / (480 * unit))), tiles, boss, ships: out };
}

type Seen = { hull: number; shields: number; status: FleetShip['status']; phase: number; goneAt: number };
const center = (l: ShipLayout) => ({ x: l.grid.x + l.grid.w / 2, y: l.grid.y + l.grid.h / 2 });
const ENEMY_BOLT = '#ff4436';

export class FleetRenderer {
  private fx = new Effects(() => performance.now());
  private view: PublicView | null = null; private layout: FleetLayout | null = null;
  private seen = new Map<string, Seen>(); private shots = new Map<string, Shot>();
  private clock = { id: '', t: 0, at: 0, shown: -Infinity };
  private w = 0; private h = 0; private dpr = 1; private bgKey = ''; private last = 0; private raf = 0; private tmp = { x: 0, y: 0 };
  private reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  constructor(private bg: HTMLCanvasElement, private main: HTMLCanvasElement, private assetBase: string) { this.raf = requestAnimationFrame(this.frame); }
  dispose() { cancelAnimationFrame(this.raf); }
  resize(w: number, h: number) {
    this.w = w; this.h = h; this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    for (const c of [this.bg, this.main]) { c.width = Math.round(w * this.dpr); c.height = Math.round(h * this.dpr); }
    this.bgKey = ''; this.paintBg();
  }
  private get motion() { return !this.reduced?.matches; }
  private paintBg() {
    const v = this.view, id = v?.combat?.objective === 'boss' ? 'armada-reach' : v?.map.sectorId ?? 'rustbelt', img = backdropImage(id), key = `${this.w}|${this.h}|${id}|${!!img}`;
    if (img === undefined && (BACKDROP_IDS as readonly string[]).includes(id)) void loadBackdrops(this.assetBase).then(() => { this.bgKey = ''; this.paintBg(); });
    if (key === this.bgKey || !this.w) return; this.bgKey = key;
    const g = this.bg.getContext('2d')!; g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); paintBackdrop(g, this.w, this.h, id);
    g.fillStyle = 'rgba(3,5,16,.38)'; g.fillRect(0, 0, this.w, this.h);
  }
  /** A new snapshot: compare each ship with what was last seen and stage the effects for what changed. */
  set(view: PublicView, layout: FleetLayout) {
    const first = !this.view, combat = view.combat, now = performance.now(), u = layout.unit * layout.scale, play = !first && !document.hidden;
    if (view === this.view && layout === this.layout) return;
    if (combat) { if (combat.id !== this.clock.id) { this.seen.clear(); this.shots.clear(); Object.assign(this.clock, { id: combat.id, shown: -Infinity }); } this.clock.t = combat.t; this.clock.at = now; }
    this.view = view; this.layout = layout; this.paintBg();
    for (const ship of view.fleet?.ships ?? []) {
      const was = this.seen.get(ship.id), l = layout.ships[ship.id]; this.seen.set(ship.id, { hull: ship.hull, shields: ship.shields, status: ship.status, phase: ship.phase, goneAt: was?.goneAt ?? (ship.status === 'active' ? 0 : -Infinity) });
      if (!was || !l || !play) continue;
      const { x, y } = center(l), k = ship.wing < 0 ? 2.2 : 1, at = { x: x + (hash(now + ship.slot) - .5) * l.grid.w * .6, y: y + (hash(now * 1.3) - .5) * l.grid.h * .6 };
      if (ship.phase !== was.phase) { this.fx.add({ k: 'flash', color: '#ff2f55', alpha: .45, dur: 1000 }); this.fx.add({ k: 'ring', x, y, r: l.sprite.w * .8, color: '#ffd24a', w: 9 * u, dur: 900 }); this.fx.shake('screen', 9 * layout.unit); }
      else if (ship.hull < was.hull && ship.status === 'active') { const d = was.hull - ship.hull;
        this.fx.add({ k: 'boom', x: at.x, y: at.y, r: (16 + 5 * Math.min(d, 6)) * u * k, color: '#ff8a2a', dur: 520 }); this.fx.burst(at.x, at.y, 5 + 2 * Math.min(d, 6), Kind.Spark, '#ffd27a', 420 * u, 420, 2.2 * u);
        this.fx.add({ k: 'text', x: at.x, y: at.y - 12 * u, text: `-${d}`, color: ship.faction === 'ally' ? '#ff8a7a' : '#ffd24a', size: (20 + 2 * Math.min(d, 6)) * u * Math.sqrt(k), dur: 900 }); this.fx.shake(ship.id, (2 + d) * u); }
      else if (ship.hull > was.hull) this.fx.burst(x, y, 8, Kind.Ember, '#6dff9a', 80 * u, 700, 2 * u);
      if (ship.shields < was.shields && ship.status === 'active') this.fx.add({ k: 'ripple', x, y, rx: l.sprite.w * .52, ry: l.sprite.h * .5, angle: ship.faction === 'ally' ? 0 : Math.PI, color: '#6fe0ff', dur: 520 });
      if (ship.status !== was.status && ship.status !== 'active') { this.seen.get(ship.id)!.goneAt = now;
        if (ship.status === 'destroyed') { this.fx.add({ k: 'boom', x, y, r: l.sprite.w * .42, color: '#ffa040', dur: 900 }); this.fx.add({ k: 'ring', x, y, r: l.sprite.w * .8, color: '#ffe2b0', w: 6 * u, dur: 700 });
          this.fx.burst(x, y, 26, Kind.Spark, '#ffd27a', 520 * u, 800, 2.6 * u); this.fx.burst(x, y, 10, Kind.Debris, '#4c5362', 200 * u, 1800, 4 * u); this.fx.burst(x, y, 8, Kind.Smoke, '#4a4d57', 60 * u, 1800, 9 * u);
          this.fx.shake('screen', (ship.faction === 'ally' ? 5 : 3) * layout.unit * k); }
      }
    }
    const live = new Set(view.fleet?.shots.map(s => s.id)); for (const id of this.shots.keys()) if (!live.has(id)) this.shots.delete(id);
  }
  private sprite(ship: FleetShip, l: ShipLayout) { return hullPlan(ship.hullId, ship.paint, l.sprite.w * this.dpr, l.facing); }
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const view = this.view, L = this.layout, dt = Math.min(50, now - (this.last || now)); this.last = now;
    if (!view?.fleet || !L || L.width !== this.w || L.height !== this.h) return;
    const ctx = this.main.getContext('2d')!, combat = view.combat, u = L.unit, su = u * L.scale, motion = this.motion, ships = new Map(view.fleet.ships.map(s => [s.id, s]));
    const t = combat ? this.clock.shown = Math.max(this.clock.shown, combat.paused ? this.clock.t : this.clock.t + Math.min(250, now - this.clock.at)) : 0;
    this.fx.density = motion ? 1 : .4; this.fx.step(dt);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.w, this.h);
    if (motion) { const s = this.fx.offset('screen', this.tmp); ctx.translate(s.x, s.y); }
    const colors = new Map(view.captains.map(c => [c.id, c])), font = (px: number) => `${Math.max(9, Math.round(px))}px 'Lilita One', 'Arial Black', sans-serif`;
    const intro = combat ? Math.min(1, Math.max(0, (t - (combat.introUntilMs - 2600)) / 900)) : 1;
    for (const { wing, box } of L.tiles) {
      const here = view.fleet.ships.filter(s => s.wing === wing), allies = here.filter(s => s.faction === 'ally'), foes = here.filter(s => s.faction === 'enemy' && s.status === 'active').length, flying = allies.filter(s => s.status === 'active');
      const color = WING_COLORS[wing % WING_COLORS.length], strength = allies.reduce((n, s) => n + (s.status === 'active' ? s.hull / s.maxHull : 0), 0) / Math.max(1, allies.length), label = Math.min(40 * u, box.h * .17);
      const boss = view.fleet.ships.some(s => s.wing < 0 && s.status === 'active'), state = !flying.length ? 'LOST' : !foes && !boss && combat ? 'CLEAR' : foes ? `${foes} hostile${foes > 1 ? 's' : ''}` : '';
      ctx.fillStyle = 'rgba(7,11,34,.62)'; ctx.strokeStyle = color; ctx.globalAlpha = 1; ctx.lineWidth = Math.max(1.5, 2.5 * u);
      ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, 14 * u); ctx.fill(); ctx.globalAlpha = state === 'LOST' ? .3 : .75; ctx.stroke(); ctx.globalAlpha = 1;
      if (flying.length && strength < .35) { ctx.save(); ctx.globalAlpha = .12 + (motion ? .1 * Math.sin(now * .008 + wing) : 0); ctx.fillStyle = '#ff2d55'; ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, 14 * u); ctx.fill(); ctx.restore(); }
      ctx.font = font(label * .74); ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = color; ctx.fillText(`${wingLetter(wing)} · ${wingName(wing).toUpperCase()}`, box.x + 12 * u, box.y + label * .58);
      if (state) { ctx.textAlign = 'right'; ctx.fillStyle = state === 'CLEAR' ? '#9be36b' : state === 'LOST' ? '#ff7a6a' : '#c6cdf2'; ctx.font = font(label * .56); ctx.fillText(state, box.x + box.w - 12 * u, box.y + label * .58); }
    }
    if (L.boss) { const b = L.boss; ctx.fillStyle = 'rgba(40,6,16,.6)'; ctx.strokeStyle = '#ff2d55'; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 16 * u); ctx.fill(); ctx.stroke(); }
    for (const ship of view.fleet.ships) {
      const l = L.ships[ship.id], was = this.seen.get(ship.id); if (!l) continue;
      const gone = ship.status !== 'active' ? Math.min(1, (now - (was?.goneAt ?? 0)) / 600) : 0, shake = this.fx.offset(ship.id, this.tmp), seed = hash(ship.slot * 7 + ship.wing * 3 + (ship.faction === 'ally' ? 0 : 11));
      const ox = shake.x + (motion ? Math.sin(now * .0006 + seed * 6) * 3 * su : 0) + (ship.status === 'fled' ? l.facing * -gone * gone * l.sprite.w * 2 : 0) + (1 - intro) * -l.facing * this.w * .25, oy = shake.y + (motion ? Math.sin(now * .001 + seed * 9) * 2.5 * su : 0);
      const { x, y } = center(l), alpha = (ship.status === 'destroyed' ? (1 - gone) * .9 : ship.status === 'fled' ? 1 - gone : ship.cloaked ? .4 : 1) * intro;
      if (alpha > .02) {
        ctx.globalAlpha = alpha;
        if (ship.status === 'active') { const len = l.cell * 1.6 * (1 + .15 * Math.sin(now * .03 + seed * 20)); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha * .7;
          ctx.drawImage(glow(ship.faction === 'ally' ? '#5aaaff' : '#ff7846'), l.sprite.x + ox + (l.facing === 1 ? l.cell * .7 - len : l.sprite.w - l.cell * .7), y + oy - l.cell * .9, len, l.cell * 1.8); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = alpha; }
        ctx.drawImage(this.sprite(ship, l), l.sprite.x + ox, l.sprite.y + oy, l.sprite.w, l.sprite.h);
        if (ship.fires && ship.status === 'active') { ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < Math.min(4, ship.fires); i++) { const r = l.cell * (1.1 + .25 * Math.sin(now * .02 + i * 2 + seed * 9));
          ctx.globalAlpha = alpha * .8; ctx.drawImage(glow('#ff7a1a'), x + ox + (hash(i + seed * 5) - .5) * l.grid.w * .7 - r, y + oy + (hash(i * 3 + seed) - .5) * l.grid.h * .6 - r, r * 2, r * 2); } ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = alpha; }
        if (ship.shields > 0 && ship.status === 'active') { ctx.strokeStyle = 'rgba(120,220,255,.6)'; ctx.lineWidth = Math.max(1, l.cell * .07); const a = now * .0008 + seed * 6;
          ctx.beginPath(); ctx.ellipse(x + ox, y + oy, l.sprite.w * .52, l.sprite.h * .5, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = 'rgba(220,250,255,.9)'; ctx.beginPath(); ctx.ellipse(x + ox, y + oy, l.sprite.w * .52, l.sprite.h * .5, 0, a, a + .8); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      // Bar and name: allies carry their captain's colour and name, enemies a red bar.
      const cap = ship.captainId ? colors.get(ship.captainId) : null, frac = Math.max(0, ship.hull / Math.max(1, ship.maxHull)), big = ship.wing < 0, bw = big ? l.sprite.w * .8 : Math.min(l.sprite.w * .72, l.grid.w * 1.2), bh = Math.max(3, (big ? 14 : 7) * su), bx = x - bw / 2, by = l.sprite.y + l.sprite.h * (big ? .96 : .9);
      ctx.globalAlpha = intro * (ship.status === 'active' ? 1 : .45);
      ctx.fillStyle = '#05071a'; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2); ctx.fillStyle = '#1a2046'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = ship.status !== 'active' ? '#6d7896' : frac > .5 ? '#78d955' : frac > .25 ? '#ffd24a' : '#ff5748'; ctx.fillRect(bx, by, bw * (ship.status === 'active' ? frac : 0), bh);
      const size = big ? 30 * u : Math.max(9, Math.min(17 * u, l.cell * .62)), name = ship.status === 'destroyed' ? 'DESTROYED' : ship.status === 'fled' ? 'ESCAPED' : cap?.name ?? (big ? ship.name : '');
      if (name && (big || l.cell * 1.6 >= 9)) { ctx.font = font(size); ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = '#05071a'; ctx.fillStyle = ship.status !== 'active' ? '#ff9a8a' : cap?.color ?? '#ffb3aa';
        ctx.strokeText(name, x, by + bh + 2 * u); ctx.fillText(name, x, by + bh + 2 * u); }
      if (big && ship.status === 'active') { ctx.font = font(22 * u); ctx.fillStyle = '#fff6e5'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'center'; ctx.strokeText(`${Math.max(0, ship.hull)} / ${ship.maxHull} hull · ${ship.shields} shield${ship.shields === 1 ? '' : 's'}`, x, by - 4 * u); ctx.fillText(`${Math.max(0, ship.hull)} / ${ship.maxHull} hull · ${ship.shields} shield${ship.shields === 1 ? '' : 's'}`, x, by - 4 * u);
        if (ship.phases) { ctx.font = font(26 * u); ctx.fillStyle = '#ffd24a'; ctx.textBaseline = 'top'; ctx.strokeText(`PHASE ${ship.phase + 1} OF ${ship.phases}`, x, L.boss!.y + 14 * u); ctx.fillText(`PHASE ${ship.phase + 1} OF ${ship.phases}`, x, L.boss!.y + 14 * u); } }
      ctx.globalAlpha = 1;
    }
    for (const p of view.fleet.shots) {
      const q = (t - p.launchMs) / Math.max(1, p.arriveMs - p.launchMs), from = L.ships[p.fromShipId], to = L.ships[p.toShipId], a = ships.get(p.fromShipId);
      if (q < 0 || q >= 1 || !from || !to || ships.get(p.toShipId)?.status !== 'active') continue;
      let s = this.shots.get(p.id);
      if (!s) { const c0 = center(from), c1 = center(to), seed = hash(p.launchMs * .001 + c0.y) * 10;
        this.shots.set(p.id, s = { kind: p.kind, support: undefined, seed, stop: 1, chain: null, bend: p.kind === 'missile' ? (hash(seed) - .5) * .5 : 0,
          color: p.kind === 'laser' ? (a?.faction === 'ally' ? a.paint : ENEMY_BOLT) : KIND_COLORS[p.kind],
          from: { x: c0.x + from.facing * from.grid.w * .4, y: c0.y + (hash(seed + 2) - .5) * from.grid.h * .5 }, to: { x: c1.x + (hash(seed + 3) - .5) * to.grid.w * .5, y: c1.y + (hash(seed + 4) - .5) * to.grid.h * .5 } }); }
      drawShot(ctx, s, q, now, su * (ships.get(p.toShipId)!.wing < 0 ? 1.1 : .8));
    }
    this.fx.draw(ctx, su, this.w, this.h);
  };
}
