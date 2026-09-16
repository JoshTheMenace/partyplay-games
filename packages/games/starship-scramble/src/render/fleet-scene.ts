import { FrameMetrics, ResourceScope, SnapshotBuffer } from '../../../../party-runtime/src/index';
import type { CombatEffect, PublicView } from '../contracts';
import { fleetFit, weaponColor, weaponFamily, weaponMount } from './weapons';
import { STAGE, formation, type Slot } from './formation';
const INK = '#05071a', CREAM = '#fff6e5', SKY = '#28c6e7', CORAL = '#ff5748', SUN = '#ffd24a', LIME = '#78d955', GRAPE = '#b58aff';
const DISPLAY = "'Lilita One','Arial Black',Impact,sans-serif", BODY = "Nunito,system-ui,sans-serif";
type Live = CombatEffect & { from: string; to: string; text: string; startedAt: number; duration: number };
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
  private reduced = false;
  private frameHandle = 0;
  private lastFrame = 0;
  private slots: Slot[] = [];
  constructor(private canvas: HTMLCanvasElement, signal?: AbortSignal) {
    this.scope = new ResourceScope(signal);
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
    for (const effect of view.effects) if (!this.seen.has(effect.id)) { this.seen.add(effect.id); this.live.push({ ...effect, from: effect.sourceShipId, to: effect.targetShipId, startedAt: performance.now() + (effect.delayMs ?? 0), duration: this.reduced ? 250 : effect.kind === 'shot' ? Math.max(300, effect.flightMs ?? 550) : DURATION[effect.kind] }); }
    if (this.seen.size > 400) { const keep = new Set(view.effects.map(e => e.id)); this.seen = keep; }
  }
  /** Returns true after a real frame with ships has been drawn; the display uses this for assetsReady. */
  drawn = false;
  private frame(now: number) {
    const start = performance.now(); if (this.lastFrame) this.metrics.record(now - this.lastFrame); this.lastFrame = now;
    const ctx = this.canvas.getContext('2d'); if (!ctx || !this.latest) return;
    const view = this.buffer.sample(performance.timeOrigin + now, blend) ?? this.latest;
    const scale = Math.min(this.canvas.width / STAGE.w, this.canvas.height / STAGE.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, (this.canvas.width - STAGE.w * scale) / 2, (this.canvas.height - STAGE.h * scale) / 2);
    this.slots = formation(view.ships);
    this.drones(ctx, view, now);
    this.effects(ctx, now);
    this.live = this.live.filter(effect => now - effect.startedAt < effect.duration);
    if (view.ships.length) this.drawn = true;
    this.metrics.record(performance.now() - start);
  }
  private slot(id: string) { return this.slots.find(s => s.shipId === id); }
  private text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, options: { font?: string; color?: string; weight?: number; max?: number; align?: CanvasTextAlign } = {}) {
    ctx.font = `${options.weight ?? 800} ${size}px ${options.font ?? BODY}`; ctx.fillStyle = options.color ?? CREAM; ctx.textAlign = options.align ?? 'left'; ctx.textBaseline = 'alphabetic';
    let text = value; if (options.max) while (text.length > 1 && ctx.measureText(text).width > options.max) text = text.slice(0, -2) + '…';
    ctx.shadowColor = INK; ctx.shadowBlur = 0; ctx.shadowOffsetY = 2; ctx.fillText(text, x, y); ctx.shadowOffsetY = 0;
  }
  private drones(ctx: CanvasRenderingContext2D, view: PublicView, now: number) {
    view.drones.forEach((drone, i) => { const target = this.slot(drone.targetShipId), source = this.slot(drone.sourceShipId); if (!target) return; const angle = this.reduced ? i : now / 700 + i * 1.7, cx = target.x + target.w / 2 + Math.cos(angle) * (target.w / 2 + 10), cy = target.y + target.h / 2 + Math.sin(angle) * (target.h / 2 + 8);
      ctx.fillStyle = source?.faction === 'enemy' ? CORAL : LIME; ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx + 7, cy); ctx.lineTo(cx, cy + 7); ctx.lineTo(cx - 7, cy); ctx.closePath(); ctx.fill(); ctx.stroke(); });
  }
  private anchor(slot: Slot, roomId?: string, mountIndex?: number) {
    const ship = this.latest!.ships.find(s => s.id === slot.shipId)!;
    const fit = fleetFit(ship, slot), room = fit.rooms.find(r => r.id === roomId);
    const local = mountIndex !== undefined ? weaponMount(fit, mountIndex, ship.faction).muzzle : room ? { x: room.x + room.w / 2, y: room.y + room.h / 2 } : { x: fit.hull.x + fit.hull.w / 2, y: fit.hull.y + fit.hull.h / 2 };
    return { x: slot.x + local.x, y: slot.y + 50 + local.y };
  }
  private glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius); glow.addColorStop(0, color); glow.addColorStop(1, color + '00');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  }
  private effects(ctx: CanvasRenderingContext2D, now: number) {
    for (const effect of this.live) {
      const t = Math.min(1, (now - effect.startedAt) / effect.duration), from = this.slot(effect.from), to = this.slot(effect.to);
      if (!to || t < 0) continue;
      const end = this.anchor(to, effect.roomId), start = from ? this.anchor(from, undefined, effect.mountIndex ?? 0) : { x: STAGE.w / 2, y: STAGE.h / 2 };
      const family = weaponFamily(effect.weaponId ?? ''), color = weaponColor[family];
      if (effect.kind === 'shot' && from) {
        const angle = Math.atan2(end.y - start.y, end.x - start.x), distance = Math.hypot(end.x - start.x, end.y - start.y);
        ctx.save(); ctx.translate(start.x, start.y); ctx.rotate(angle);
        if (this.reduced) {
          ctx.globalAlpha = .5 * (1 - t); this.glow(ctx, 0, 0, 16, color);
        } else if (family === 'beam') {
          ctx.globalAlpha = Math.sin(t * Math.PI); ctx.lineCap = 'round';
          for (const [width, alpha] of [[14,.12],[6,.45],[2,1]]) { ctx.strokeStyle = width === 2 ? '#fffce9' : color; ctx.globalAlpha = Math.sin(t * Math.PI) * alpha; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(distance, 0); ctx.stroke(); }
          this.glow(ctx, distance, 0, 26, color);
        } else {
          const x = distance * t;
          if (t < .22) { ctx.globalAlpha = 1 - t / .22; this.glow(ctx, 0, 0, 24, color); ctx.globalAlpha = 1; }
          if (family === 'missile' || family === 'boarding') {
            for (let i = 1; i <= 14; i++) { const behind = x - i * 7; if (behind < 0) break; ctx.globalAlpha = .3 * (1 - i / 15); this.glow(ctx, behind, Math.sin(i * 2.3) * i * .35, 3 + i * .65, '#9aaec1'); }
            ctx.globalAlpha = 1; this.glow(ctx, x - 13, 0, 19, '#ff983d');
            ctx.fillStyle = '#ffb04e'; ctx.beginPath(); ctx.moveTo(x-9,-2); ctx.lineTo(x-32-4*Math.sin(t*90),0); ctx.lineTo(x-9,2); ctx.fill();
            ctx.fillStyle = '#e8eee9'; ctx.strokeStyle = '#263849'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x+12,0); ctx.lineTo(x+4,-3); ctx.lineTo(x-8,-3); ctx.lineTo(x-12,-7); ctx.lineTo(x-12,7); ctx.lineTo(x-8,3); ctx.lineTo(x+4,3); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.strokeStyle = '#fa6951'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x+3,-2.5); ctx.lineTo(x+3,2.5); ctx.stroke();
          } else if (family === 'laser' || family === 'flak') {
            ctx.lineCap = 'round'; ctx.shadowColor = color; ctx.shadowBlur = 14;
            ctx.strokeStyle = color; ctx.lineWidth = family === 'flak' ? 4 : 6; ctx.beginPath(); ctx.moveTo(Math.max(0,x-(family === 'flak' ? 14 : 38)),0); ctx.lineTo(x,0); ctx.stroke();
            ctx.shadowBlur = 0; ctx.strokeStyle = '#fff5dc'; ctx.lineWidth = 2; ctx.stroke();
          } else {
            for (let i=5;i>=0;i--) { ctx.globalAlpha = 1-i*.16; this.glow(ctx, Math.max(0,x-i*5),0, family === 'plasma' ? 14-i : 9-i*.7,color); }
            ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x,0,7,12,t*8,0,Math.PI*2); ctx.stroke(); this.glow(ctx,x,0,5,'#f2ffff');
          }
        }
        ctx.restore();
      } else if (effect.kind === 'impact' || effect.kind === 'shield') {
        ctx.save(); ctx.globalAlpha = 1-t;
        const shield = effect.kind === 'shield', tint = shield ? SKY : color, r = 8+t*28;
        this.glow(ctx,end.x,end.y,shield ? 32 : 42,tint);
        ctx.strokeStyle = tint; ctx.lineWidth = shield ? 2 : 1.5; ctx.beginPath(); ctx.arc(end.x,end.y,r,0,Math.PI*2); ctx.stroke();
        if (!shield && !this.reduced) for(let i=0;i<10;i++) { const a=i*2.399, d=10+t*(22+i%3*12); ctx.strokeStyle=i%2 ? '#ffe8b1' : tint; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(end.x+Math.cos(a)*d,end.y+Math.sin(a)*d); ctx.lineTo(end.x+Math.cos(a)*(d+7),end.y+Math.sin(a)*(d+7)); ctx.stroke(); }
        if (shield) { ctx.strokeStyle='#adf4ff'; ctx.beginPath(); for(let i=0;i<=6;i++) { const a=i*Math.PI/3; const x=end.x+Math.cos(a)*15,y=end.y+Math.sin(a)*15; if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y); } ctx.stroke(); }
        ctx.restore();
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
