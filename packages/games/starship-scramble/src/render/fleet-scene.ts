import { FrameMetrics, ResourceScope, SnapshotBuffer } from '../../../../party-runtime/src/index';
import type { CombatEffect, PublicView, ShipSummary } from '../contracts';
import { STAGE, formation, type Slot } from './formation';
import { drawHull } from './hulls';
const INK = '#05071a', CREAM = '#fff6e5', SKY = '#28c6e7', CORAL = '#ff5748', SUN = '#ffd24a', LIME = '#78d955', GRAPE = '#b58aff';
const DISPLAY = "'Lilita One','Arial Black',Impact,sans-serif", BODY = "Nunito,system-ui,sans-serif";
type Live = { id: string; kind: CombatEffect['kind']; from: string; to: string; text: string; startedAt: number; duration: number };
const DURATION: Record<CombatEffect['kind'], number> = { shot: 650, impact: 500, shield: 550, teleport: 900, repair: 800, destroyed: 1400, warning: 1500 };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function blend(a: PublicView, b: PublicView, t: number): PublicView {
  return { ...b, ships: b.ships.map(ship => { const before = a.ships.find(s => s.id === ship.id); return before ? { ...ship, hull: lerp(before.hull, ship.hull, t), shield: lerp(before.shield, ship.shield, t) } : ship; }) };
}
/** Canvas 2D fleet overview. Interpolates authoritative snapshots and replays bounded server effects; it never predicts outcomes. */
export class FleetScene {
  readonly metrics = new FrameMetrics();
  private scope: ResourceScope;
  private buffer = new SnapshotBuffer<PublicView>(120);
  private latest: PublicView | null = null;
  private live: Live[] = [];
  private seen = new Set<string>();
  private stars: { x: number; y: number; r: number }[] = [];
  private reduced = false;
  private frameHandle = 0;
  private lastFrame = 0;
  private slots: Slot[] = [];
  private captains = new Map<string, { name: string; color: string }>();
  constructor(private canvas: HTMLCanvasElement, signal?: AbortSignal) {
    this.scope = new ResourceScope(signal);
    let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    this.stars = Array.from({ length: 140 }, () => ({ x: rand() * STAGE.w, y: rand() * STAGE.h, r: .6 + rand() * 1.6 }));
    const motion = matchMedia('(prefers-reduced-motion: reduce)'); this.reduced = motion.matches;
    this.scope.listen(motion, 'change', () => { this.reduced = motion.matches; });
    const resize = () => { const box = canvas.getBoundingClientRect(), ratio = Math.min(2, devicePixelRatio || 1); canvas.width = Math.max(1, Math.round(box.width * ratio)); canvas.height = Math.max(1, Math.round(box.height * ratio)); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(canvas); this.scope.defer(() => observer.disconnect());
    const loop = (now: number) => { this.frame(now); this.frameHandle = requestAnimationFrame(loop); };
    this.frameHandle = requestAnimationFrame(loop); this.scope.defer(() => cancelAnimationFrame(this.frameHandle));
  }
  dispose() { this.scope.dispose(); }
  /** Called once per snapshot; `now` is the client's serverNowMs reading at receipt. */
  setView(view: PublicView, now: number) {
    this.latest = view; this.buffer.push(now, view);
    this.captains = new Map(view.captains.map(c => [c.id, { name: c.name, color: c.color }]));
    for (const effect of view.effects) if (!this.seen.has(effect.id)) { this.seen.add(effect.id); this.live.push({ id: effect.id, kind: effect.kind, from: effect.sourceShipId, to: effect.targetShipId, text: effect.text, startedAt: performance.now(), duration: this.reduced ? 250 : DURATION[effect.kind] }); }
    if (this.seen.size > 400) { const keep = new Set(view.effects.map(e => e.id)); this.seen = keep; }
  }
  /** Returns true after a real frame with ships has been drawn; the display uses this for assetsReady. */
  drawn = false;
  private frame(now: number) {
    const start = performance.now(); if (this.lastFrame) this.metrics.record(now - this.lastFrame); this.lastFrame = now;
    const ctx = this.canvas.getContext('2d'); if (!ctx || !this.latest) return;
    const view = this.buffer.sample(performance.timeOrigin + now, blend) ?? this.latest;
    const scale = Math.min(this.canvas.width / STAGE.w, this.canvas.height / STAGE.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = INK; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, (this.canvas.width - STAGE.w * scale) / 2, (this.canvas.height - STAGE.h * scale) / 2);
    const sky = ctx.createRadialGradient(640, 0, 40, 640, 0, 900); sky.addColorStop(0, '#1a2a6c'); sky.addColorStop(.55, '#0b1030'); sky.addColorStop(1, INK);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, STAGE.w, STAGE.h);
    ctx.fillStyle = '#fff6e5aa'; for (const star of this.stars) { const twinkle = this.reduced ? 1 : .6 + .4 * Math.sin(now / 900 + star.x); ctx.globalAlpha = twinkle * .8; ctx.beginPath(); ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1;
    this.slots = formation(view.ships);
    for (const slot of this.slots) { const ship = view.ships.find(s => s.id === slot.shipId)!; if (slot.faction === 'allied') this.allyCard(ctx, slot, ship, view); else this.enemyCard(ctx, slot, ship, view); }
    this.drones(ctx, view, now);
    this.effects(ctx, now);
    this.live = this.live.filter(effect => now - effect.startedAt < effect.duration);
    if (view.ships.length) this.drawn = true;
    this.metrics.record(performance.now() - start);
  }
  private slot(id: string) { return this.slots.find(s => s.shipId === id); }
  private bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, value: number, max: number, color: string) {
    ctx.fillStyle = '#05071a'; ctx.fillRect(x, y, w, h); ctx.fillStyle = color; ctx.fillRect(x + 2, y + 2, Math.max(0, (w - 4) * Math.max(0, Math.min(1, value / Math.max(1, max)))), h - 4);
    ctx.strokeStyle = '#fff6e540'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
  }
  private pips(ctx: CanvasRenderingContext2D, x: number, y: number, shield: number) {
    const whole = Math.floor(shield + 1e-6), fraction = shield - whole, count = Math.max(whole + (fraction > 0 ? 1 : 0), 1);
    for (let i = 0; i < Math.min(8, Math.max(count, whole)); i++) { ctx.globalAlpha = i < whole ? 1 : i === whole && fraction > 0 ? .3 + fraction * .6 : .18; ctx.fillStyle = SKY; ctx.beginPath(); ctx.roundRect(x + i * 20, y, 16, 8, 3); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  private text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, options: { font?: string; color?: string; weight?: number; max?: number; align?: CanvasTextAlign } = {}) {
    ctx.font = `${options.weight ?? 800} ${size}px ${options.font ?? BODY}`; ctx.fillStyle = options.color ?? CREAM; ctx.textAlign = options.align ?? 'left'; ctx.textBaseline = 'alphabetic';
    let text = value; if (options.max) while (text.length > 1 && ctx.measureText(text).width > options.max) text = text.slice(0, -2) + '…';
    ctx.shadowColor = INK; ctx.shadowBlur = 0; ctx.shadowOffsetY = 2; ctx.fillText(text, x, y); ctx.shadowOffsetY = 0;
  }
  private card(ctx: CanvasRenderingContext2D, slot: Slot, accent: string, dim: boolean) {
    const fill = ctx.createLinearGradient(slot.x, slot.y, slot.x, slot.y + slot.h); fill.addColorStop(0, dim ? '#0b103099' : '#1c2458e6'); fill.addColorStop(1, dim ? '#05071a99' : '#0b1030e6');
    ctx.fillStyle = fill; ctx.strokeStyle = dim ? '#fff6e522' : accent + '99'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(slot.x, slot.y, slot.w, slot.h, 14); ctx.fill(); ctx.stroke();
    if (!dim) { ctx.save(); ctx.beginPath(); ctx.roundRect(slot.x, slot.y, slot.w, slot.h, 14); ctx.clip(); const glow = ctx.createRadialGradient(slot.faction === 'allied' ? slot.x + 56 : slot.x + slot.w - 90, slot.y + slot.h / 2, 4, slot.faction === 'allied' ? slot.x + 56 : slot.x + slot.w - 90, slot.y + slot.h / 2, 110); glow.addColorStop(0, accent + '33'); glow.addColorStop(1, accent + '00'); ctx.fillStyle = glow; ctx.fillRect(slot.x, slot.y, slot.w, slot.h); ctx.restore(); }
  }
  private alerts(ctx: CanvasRenderingContext2D, ship: ShipSummary, x: number, y: number, max: number) {
    const shown = ship.alerts.slice(0, 2), extra = ship.alerts.length - shown.length;
    if (ship.status !== 'active') { this.text(ctx, ship.status === 'destroyed' ? 'Destroyed' : ship.status === 'escaped' ? 'Escaped' : ship.status === 'surrendered' ? 'Surrendered' : 'Abandoned', x, y, 14, { color: CORAL, max }); return; }
    if (!shown.length) return;
    this.text(ctx, shown.join(' · ') + (extra > 0 ? ` +${extra}` : ''), x, y, 14, { color: CORAL, max });
  }
  private allyCard(ctx: CanvasRenderingContext2D, slot: Slot, ship: ShipSummary, view: PublicView) {
    const owner = ship.ownerCaptainId ? this.captains.get(ship.ownerCaptainId) : null, dead = ship.status !== 'active';
    this.card(ctx, slot, ship.color, dead);
    drawHull(ctx, ship.hullId, { x: slot.x + 8, y: slot.y + 22, w: 96, h: 72 }, ship.color, { destroyed: dead });
    this.text(ctx, ship.name, slot.x + 112, slot.y + 30, 17, { max: 236 });
    if (owner) { ctx.fillStyle = owner.color; ctx.beginPath(); ctx.arc(slot.x + 120, slot.y + 46, 6, 0, Math.PI * 2); ctx.fill(); this.text(ctx, owner.name, slot.x + 132, slot.y + 51, 14, { color: '#a9b3e6', max: 216 }); }
    if (!dead) { this.bar(ctx, slot.x + 112, slot.y + 58, 236, 12, ship.hull, ship.maxHull, ship.hull < ship.maxHull / 3 ? CORAL : LIME); this.pips(ctx, slot.x + 112, slot.y + 76, ship.shield); }
    const target = ship.targetShipId ? view.ships.find(s => s.id === ship.targetShipId) : null;
    if (target && !dead) { const label = this.slot(target.id)?.label ?? target.name; this.text(ctx, `→ ${label}`, slot.x + slot.w - 10, slot.y + 30, 15, { color: SUN, align: 'right' }); }
    this.alerts(ctx, ship, slot.x + 112, slot.y + 104, 236);
    if (dead) { const survivors = view.captains.find(c => c.id === ship.ownerCaptainId)?.crewCount ?? 0; this.text(ctx, survivors ? `${survivors} crew survive elsewhere` : 'No crew remain', slot.x + 112, slot.y + 76, 14, { color: '#a9b3e6', max: 236 }); }
  }
  private enemyCard(ctx: CanvasRenderingContext2D, slot: Slot, ship: ShipSummary, view: PublicView) {
    const dead = ship.status !== 'active', accent = slot.flagship ? GRAPE : CORAL;
    this.card(ctx, slot, accent, dead);
    this.text(ctx, slot.label, slot.x + 12, slot.y + 34, 24, { font: DISPLAY, weight: 400, color: accent });
    drawHull(ctx, ship.hullId, { x: slot.x + 62, y: slot.y + 8, w: slot.flagship ? 176 : 130, h: slot.flagship ? 84 : 70 }, dead ? '#3a3f5a' : slot.flagship ? '#8c5a3c' : '#b2542f', { flagship: slot.flagship, destroyed: dead, facing: -1 });
    this.text(ctx, ship.name.replace(/^E\d+\s*[·:-]\s*/, ''), slot.x + 12, slot.y + 106, 15, { max: 226, color: '#a9b3e6' });
    if (!dead) { this.bar(ctx, slot.x + 12, slot.y + 112, 226, 10, ship.hull, ship.maxHull, ship.hull < ship.maxHull / 3 ? SUN : CORAL); this.pips(ctx, slot.x + 12, slot.y + 128, ship.shield); }
    const target = ship.targetShipId ? this.slot(ship.targetShipId) : null;
    if (target && !dead) this.text(ctx, `→ ${target.label}`, slot.x + slot.w - 10, slot.y + 34, 14, { color: SUN, align: 'right', max: 90 });
    if (ship.escapeAtMs !== null && !dead) this.text(ctx, `Escaping ${Math.max(0, Math.ceil((ship.escapeAtMs - view.timeMs) / 1000))}s`, slot.x + slot.w - 10, slot.y + 106, 14, { color: SUN, align: 'right' });
    this.alerts(ctx, ship, slot.x + 12, slot.y + 146, 226);
  }
  private drones(ctx: CanvasRenderingContext2D, view: PublicView, now: number) {
    view.drones.forEach((drone, i) => { const target = this.slot(drone.targetShipId), source = this.slot(drone.sourceShipId); if (!target) return; const angle = this.reduced ? i : now / 700 + i * 1.7, cx = target.x + target.w / 2 + Math.cos(angle) * (target.w / 2 + 10), cy = target.y + target.h / 2 + Math.sin(angle) * (target.h / 2 + 8);
      ctx.fillStyle = source?.faction === 'enemy' ? CORAL : LIME; ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx + 7, cy); ctx.lineTo(cx, cy + 7); ctx.lineTo(cx - 7, cy); ctx.closePath(); ctx.fill(); ctx.stroke(); });
  }
  private anchor(slot: Slot, side: 'in' | 'out') { const inward = slot.faction === 'allied' ? slot.x + slot.w : slot.x; return { x: side === 'in' ? inward : slot.x + slot.w / 2, y: slot.y + slot.h / 2 }; }
  private effects(ctx: CanvasRenderingContext2D, now: number) {
    for (const effect of this.live) {
      const t = Math.min(1, (now - effect.startedAt) / effect.duration), from = this.slot(effect.from), to = this.slot(effect.to);
      if (!to) continue;
      const end = this.anchor(to, 'in'), start = from ? this.anchor(from, 'in') : { x: STAGE.w / 2, y: STAGE.h / 2 };
      const hostile = from?.faction === 'enemy';
      if (effect.kind === 'shot' && from) {
        const x = lerp(start.x, end.x, t), y = lerp(start.y, end.y, t) - Math.sin(t * Math.PI) * 24;
        ctx.strokeStyle = hostile ? CORAL : SUN; ctx.lineWidth = 3; ctx.globalAlpha = .5; ctx.beginPath(); ctx.moveTo(lerp(start.x, x, .7), lerp(start.y, y, .7)); ctx.lineTo(x, y); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = hostile ? CORAL : SUN; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      } else if (effect.kind === 'impact' || effect.kind === 'shield') {
        const color = effect.kind === 'shield' ? SKY : CORAL, r = 18 + t * 30; ctx.globalAlpha = 1 - t; ctx.strokeStyle = color; ctx.lineWidth = 4;
        ctx.beginPath(); if (effect.kind === 'shield') ctx.ellipse(to.x + to.w / 2, to.y + to.h / 2, to.w / 2 + 8, to.h / 2 + 8, 0, 0, Math.PI * 2); else ctx.arc(end.x, end.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
        if (t < .6 && effect.kind === 'impact') this.text(ctx, effect.text, end.x, end.y - 30, 14, { color: CREAM, align: 'center', max: 160 });
      } else if (effect.kind === 'teleport' && from) {
        ctx.strokeStyle = GRAPE; ctx.lineWidth = 3; ctx.setLineDash([8, 8]); ctx.lineDashOffset = -t * 120; ctx.globalAlpha = 1 - t * .6;
        ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.quadraticCurveTo((start.x + end.x) / 2, Math.min(start.y, end.y) - 60, end.x, end.y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        this.text(ctx, effect.text, (start.x + end.x) / 2, Math.min(start.y, end.y) - 40, 14, { color: GRAPE, align: 'center' });
      } else if (effect.kind === 'repair') {
        ctx.globalAlpha = 1 - t; ctx.strokeStyle = LIME; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(to.x - 4 - t * 8, to.y - 4 - t * 8, to.w + 8 + t * 16, to.h + 8 + t * 16, 16); ctx.stroke(); ctx.globalAlpha = 1;
        this.text(ctx, effect.text, to.x + to.w / 2, to.y - 8, 14, { color: LIME, align: 'center', max: to.w });
      } else if (effect.kind === 'destroyed') {
        const cx = to.x + to.w / 2, cy = to.y + to.h / 2; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, d = t * 90; ctx.globalAlpha = 1 - t; ctx.fillStyle = i % 2 ? SUN : CORAL; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 10 * (1 - t) + 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1; if (t < .7) this.text(ctx, effect.text || 'Destroyed', cx, cy - 20, 20, { font: DISPLAY, weight: 400, color: CORAL, align: 'center' });
      } else if (effect.kind === 'warning') {
        ctx.globalAlpha = .6 + .4 * Math.sin(t * Math.PI * 4); ctx.fillStyle = SUN; ctx.strokeStyle = INK; ctx.lineWidth = 2; const x = to.x + to.w - 26, y = to.y + 8;
        ctx.beginPath(); ctx.moveTo(x + 10, y); ctx.lineTo(x + 20, y + 18); ctx.lineTo(x, y + 18); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
        this.text(ctx, effect.text, to.x + to.w / 2, to.y - 6, 14, { color: SUN, align: 'center', max: to.w });
      }
    }
  }
}
