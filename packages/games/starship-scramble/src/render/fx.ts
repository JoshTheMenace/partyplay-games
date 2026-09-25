/** Battle effects: a fixed particle pool (no per-frame allocation) plus short-lived effect items spawned by combat events. */
import { canvas } from './hullart';

export const Kind = { Spark: 0, Smoke: 1, Ember: 2, Debris: 3 } as const;
export type Kind = typeof Kind[keyof typeof Kind];
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; grow: number; drag: number; rot: number; vr: number; kind: Kind; color: string };
type Timed = { at: number; dur: number };
export type Item = Timed & (
  | { k: 'boom' | 'glow'; x: number; y: number; r: number; color: string }
  | { k: 'ring'; x: number; y: number; r: number; color: string; w: number }
  | { k: 'text'; x: number; y: number; text: string; color: string; size: number }
  | { k: 'tracer'; x1: number; y1: number; x2: number; y2: number; color: string }
  | { k: 'column'; x: number; y: number; w: number; h: number; color: string }
  | { k: 'flash'; color: string; alpha: number }
  | { k: 'glare' }
  | { k: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { k: 'ripple'; x: number; y: number; rx: number; ry: number; angle: number; color: string }
  | { k: 'streak'; x1: number; y1: number; x2: number; y2: number; color: string; w: number }
  | { k: 'chunk'; img: HTMLCanvasElement; sx: number; sy: number; sw: number; sh: number; x: number; y: number; w: number; h: number; vx: number; vy: number; rot: number; vr: number }
);
type Spawn = Item extends infer I ? I extends Timed ? Omit<I, 'at'> & { at?: number } : never : never;

const glows = new Map<string, HTMLCanvasElement>();
/** Soft radial glow sprite per color, drawn scaled with 'lighter'. */
export function glow(color: string) {
  let c = glows.get(color); if (c) return c;
  c = canvas(96, 96); const g = c.getContext('2d')!, gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(.18, color); gr.addColorStop(.5, color + '66'); gr.addColorStop(1, color + '00'); g.fillStyle = gr; g.fillRect(0, 0, 96, 96);
  glows.set(color, c); return c;
}
let fireball: HTMLCanvasElement | null = null;
/** Opaque fire lobe: white-hot core through orange to a transparent ember edge. */
const fire = () => { if (fireball) return fireball; fireball = canvas(128, 128); const g = fireball.getContext('2d')!, gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, c] of [[0, '#fffbe8'], [.22, '#ffe08a'], [.5, '#ff8a2a'], [.78, 'rgba(190,40,20,.45)'], [1, 'rgba(120,20,10,0)']] as const) gr.addColorStop(o, c);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return fireball; };
const ease = (x: number) => 1 - (1 - x) * (1 - x);

export class Effects {
  private pool: Particle[] = Array.from({ length: 1400 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, grow: 0, drag: 0, rot: 0, vr: 0, kind: Kind.Spark as Kind, color: '#fff' }));
  private n = 0;
  private items: Item[] = [];
  private shakes = new Map<string, { amp: number; at: number }>();
  /** Particle count multiplier (reduced motion lowers it). */ density = 1;
  constructor(private now: () => number) {}
  add(spec: Spawn) { this.items.push({ ...spec, at: spec.at ?? this.now() } as Item); }
  burst(x: number, y: number, count: number, kind: Kind, color: string, speed: number, life: number, size: number) {
    for (let i = 0, n = Math.round(count * this.density); i < n && this.n < this.pool.length; i++) {
      const p = this.pool[this.n++], a = Math.random() * Math.PI * 2, v = speed * (.3 + Math.random() * .7);
      p.x = x; p.y = y; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v; p.max = p.life = life * (.6 + Math.random() * .6); p.size = size * (.6 + Math.random() * .8);
      p.kind = kind; p.color = color; p.rot = a; p.vr = (Math.random() - .5) * 10; p.drag = kind === Kind.Smoke ? 1.6 : kind === Kind.Spark ? 2.6 : .6; p.grow = kind === Kind.Smoke ? size * 1.8 : 0;
    }
  }
  shake(key: string, amp: number) { const s = this.shakes.get(key); if (!s || s.amp * this.decay(s) < amp) this.shakes.set(key, { amp, at: this.now() }); }
  private decay(s: { at: number }) { return Math.max(0, 1 - (this.now() - s.at) / 450); }
  /** Current shake offset for a ship id (or 'screen'), written into `out`. */
  offset(key: string, out: { x: number; y: number }) {
    const s = this.shakes.get(key), k = s ? this.decay(s) : 0, t = this.now();
    if (!s || !k) { if (s) this.shakes.delete(key); out.x = out.y = 0; return out; }
    out.x = Math.sin(t * .09) * s.amp * k * k; out.y = Math.cos(t * .113) * s.amp * k * k; return out;
  }
  step(dt: number) {
    const s = dt / 1000;
    for (let i = 0; i < this.n;) { const p = this.pool[i]; p.life -= dt;
      if (p.life <= 0) { this.pool[i] = this.pool[--this.n]; this.pool[this.n] = p; continue; }
      const d = Math.exp(-p.drag * s); p.vx *= d; p.vy *= d; p.x += p.vx * s; p.y += p.vy * s; p.rot += p.vr * s; p.size += p.grow * s; i++; }
    const now = this.now(); let w = 0; for (const it of this.items) if (now < it.at + it.dur) this.items[w++] = it; this.items.length = w;
  }
  draw(ctx: CanvasRenderingContext2D, u: number, width: number, height: number) {
    const now = this.now();
    for (const it of this.items) {
      const t = (now - it.at) / it.dur; if (t < 0) continue;
      ctx.globalAlpha = 1;
      switch (it.k) {
        case 'boom': { const e = ease(Math.min(1, t * 1.8)), fade = (1 - t) ** 1.3, r = it.r;
          ctx.globalAlpha = fade; for (let i = 0; i < 5; i++) { const a = i * 1.26 + it.x * .1, d = r * .42 * e, rr = r * (.5 + .12 * (i % 3)) * (.35 + .65 * e);
            ctx.drawImage(fire(), it.x + Math.cos(a) * d - rr, it.y + Math.sin(a) * d - rr, rr * 2, rr * 2); }
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = fade * .7; ctx.drawImage(glow(it.color), it.x - r * 1.9, it.y - r * 1.9, r * 3.8, r * 3.8);
          if (t < .3) { ctx.globalAlpha = 1 - t / .3; ctx.drawImage(glow('#fff2c0'), it.x - r, it.y - r, r * 2, r * 2); }
          ctx.globalCompositeOperation = 'source-over'; break; }
        case 'glow': { const r = it.r * (.6 + .4 * ease(t)); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - t; ctx.drawImage(glow(it.color), it.x - r, it.y - r, r * 2, r * 2); ctx.globalCompositeOperation = 'source-over'; break; }
        case 'ring': ctx.globalAlpha = 1 - t; ctx.strokeStyle = it.color; ctx.lineWidth = it.w * (1 - t) + 1; ctx.beginPath(); ctx.arc(it.x, it.y, it.r * ease(t), 0, Math.PI * 2); ctx.stroke(); break;
        case 'text': { const pop = t < .12 ? .6 + t / .12 * .5 : t < .2 ? 1.1 - (t - .12) / .08 * .1 : 1; ctx.globalAlpha = t > .6 ? 1 - (t - .6) / .4 : 1;
          ctx.font = `${Math.round(it.size * pop)}px 'Lilita One', 'Arial Black', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
          const y = it.y - ease(t) * 46 * u; ctx.lineWidth = Math.max(3, it.size * .2); ctx.strokeStyle = '#05071a'; ctx.strokeText(it.text, it.x, y); ctx.fillStyle = it.color; ctx.fillText(it.text, it.x, y); break; }
        case 'tracer': { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - t; ctx.strokeStyle = it.color; ctx.lineWidth = 2.5 * u + 1; const k = Math.min(1, t * 3);
          ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x1 + (it.x2 - it.x1) * k, it.y1 + (it.y2 - it.y1) * k); ctx.stroke(); ctx.globalCompositeOperation = 'source-over'; break; }
        case 'column': { ctx.globalCompositeOperation = 'lighter'; const a = Math.sin(Math.PI * t), w = it.w * (.5 + .5 * a), top = it.y - it.h;
          ctx.globalAlpha = a * .9; ctx.drawImage(glow(it.color), it.x - w, top - it.h * .3, w * 2, it.h * 1.6); ctx.drawImage(glow('#ffffff'), it.x - w * .25, top, w * .5, it.h * 1.1);
          ctx.fillStyle = '#ffffff'; for (let i = 0; i < 10; i++) { const f = (t * 1.8 + i / 10) % 1; ctx.globalAlpha = a * (1 - f); ctx.fillRect(it.x + Math.sin(i * 2.4 + now * .008) * w * .6, it.y - f * it.h, 2.5 * u + 1, 2.5 * u + 1); }
          ctx.globalCompositeOperation = 'source-over'; break; }
        case 'flash': ctx.globalAlpha = it.alpha * (1 - t) * (1 - t); ctx.fillStyle = it.color; ctx.fillRect(0, 0, width, height); break;
        case 'glare': { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.sin(Math.PI * t) * .9; const r = Math.max(width, height);
          ctx.drawImage(glow('#ffb347'), width - r * .6, -r * .6, r * 1.2, r * 1.2); ctx.globalCompositeOperation = 'source-over'; break; }
        case 'rect': ctx.globalAlpha = (1 - t) * .7; ctx.fillStyle = it.color; ctx.fillRect(it.x, it.y, it.w, it.h); break;
        case 'ripple': { ctx.globalCompositeOperation = 'lighter'; const spread = .25 + t * 1.1, k = 1 + t * .05;
          ctx.globalAlpha = (1 - t) * .95; ctx.strokeStyle = it.color; ctx.lineWidth = (6 * (1 - t) + 1.5) * u + 1;
          ctx.beginPath(); ctx.ellipse(it.x, it.y, it.rx * k, it.ry * k, 0, it.angle - spread, it.angle + spread); ctx.stroke();
          ctx.globalAlpha = (1 - t) * .35; ctx.lineWidth = 1.5 * u + .5; ctx.beginPath(); ctx.ellipse(it.x, it.y, it.rx * (1 + t * .12), it.ry * (1 + t * .12), 0, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1 - t; const px = it.x + Math.cos(it.angle) * it.rx, py = it.y + Math.sin(it.angle) * it.ry, r = 40 * u * (1 - t * .5);
          ctx.drawImage(glow(it.color), px - r, py - r, r * 2, r * 2); ctx.globalCompositeOperation = 'source-over'; break; }
        case 'streak': { const k = ease(Math.min(1, t * 1.25)), x = it.x1 + (it.x2 - it.x1) * k, y = it.y1 + (it.y2 - it.y1) * k, a = Math.atan2(it.y2 - it.y1, it.x2 - it.x1);
          ctx.globalAlpha = Math.min(1, (1 - t) * 3); ctx.strokeStyle = it.color; ctx.lineCap = 'round'; ctx.lineWidth = it.w;
          ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * it.w * 6, y - Math.sin(a) * it.w * 6); ctx.lineTo(x, y); ctx.stroke(); ctx.lineCap = 'butt'; break; }
        case 'chunk': { const s = (now - it.at) / 1000; ctx.globalAlpha = Math.max(0, 1 - t * t);
          ctx.save(); ctx.translate(it.x + it.vx * s, it.y + it.vy * s); ctx.rotate(it.rot + it.vr * s); ctx.drawImage(it.img, it.sx, it.sy, it.sw, it.sh, -it.w / 2, -it.h / 2, it.w, it.h); ctx.restore(); break; }
      }
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < this.n; i++) {
      const p = this.pool[i], a = p.life / p.max; ctx.globalAlpha = p.kind === Kind.Smoke ? a * .45 : Math.min(1, a * 1.5); ctx.fillStyle = ctx.strokeStyle = p.color;
      if (p.kind === Kind.Spark) { ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = p.size; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * .035, p.y - p.vy * .035); ctx.stroke(); ctx.globalCompositeOperation = 'source-over'; }
      else if (p.kind === Kind.Debris) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size, -p.size * .5, p.size * 2, p.size); ctx.restore(); }
      else { if (p.kind === Kind.Ember) ctx.globalCompositeOperation = 'lighter'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; }
    }
    ctx.globalAlpha = 1;
  }
}
