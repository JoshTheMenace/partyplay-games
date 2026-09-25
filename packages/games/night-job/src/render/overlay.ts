/* DPR-aware 2D layer above the scene: seat badges, names, work rings, guard ?/! icons, camera eyes, floating text,
 * sparkles and the alarm vignette. Crisp at TV distance where 3D text would blur. */
import { Vector3, type Camera } from 'three';
import type { Effect, EffectKind, HeistMap, Point, View } from '../model';
import type { Pose } from './interp';

const TEXT: Partial<Record<EffectKind, string>> = { coin: '#ffd65a', safe: '#ffd65a', charge: '#ffd65a', objective: '#ffd65a', escape: '#7dffc0', hurt: '#ff6a5a', down: '#ff6a5a', spotted: '#ff6a5a', alarm: '#ff6a5a', hack: '#7df3ff', emp: '#7df3ff', unlock: '#ffe08a', rescue: '#7dffb0', heal: '#7dffb0', takedown: '#f888cd', decoy: '#c49cff', smoke: '#d8d4e8' };
const SPARKLE: Partial<Record<EffectKind, number>> = { coin: 5, safe: 14, objective: 18, charge: 10, escape: 16, unlock: 6, hack: 6 };
const DISPLAY = "'Lilita One', 'Arial Black', sans-serif", BODY = 'Nunito, system-ui, sans-serif', INK = '#05071a', GOLD = '#ffd24a';
/** Names show at the start of a heist, then only for downed or disconnected thieves. */
const NAME_SECONDS = 6;
type Badge = { x: number; y: number; ax: number; ay: number; named: boolean; p: View['players'][number] };

export function createOverlay(canvas: HTMLCanvasElement) {
  const g = canvas.getContext('2d')!, v = new Vector3(), badges: Badge[] = [], stack: Effect[] = [], placed: number[] = [];
  let w = 0, h = 0, sx = 0, sy = 0;
  const project = (camera: Camera, x: number, y: number, z: number) => { v.set(x, y, z).project(camera); sx = (v.x + 1) / 2 * w; sy = (1 - v.y) / 2 * h; return v.z < 1 && sx > -80 && sy > -80 && sx < w + 80 && sy < h + 80; };
  const circle = (x: number, y: number, r: number) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); };
  const text = (s: string, x: number, y: number, size: number, fill: string, font = DISPLAY, stroke = INK) => {
    g.font = `${size}px ${font}`; g.lineWidth = Math.max(3, size * .22); g.strokeStyle = stroke; g.strokeText(s, x, y); g.fillStyle = fill; g.fillText(s, x, y);
  };
  const star = (x: number, y: number, r: number) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, d = i % 2 ? r * .35 : r; g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); } g.closePath(); g.fill(); };
  const ring = (x: number, y: number, r: number, k: number, colour: string, width: number) => {
    g.lineCap = 'round'; circle(x, y, r); g.strokeStyle = 'rgba(5,7,26,.75)'; g.lineWidth = width + 4; g.stroke();
    g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, k))); g.strokeStyle = colour; g.lineWidth = width; g.stroke();
  };
  /** A round gauge filling bottom-up with colour k (0..1). */
  const gauge = (x: number, y: number, r: number, k: number, colour: string) => {
    circle(x, y, r); g.fillStyle = 'rgba(5,7,26,.85)'; g.fill();
    g.save(); circle(x, y, r); g.clip(); g.fillStyle = colour; g.fillRect(x - r, y + r - 2 * r * k, r * 2, 2 * r * k); g.restore();
  };
  /** Camera eye: an almond that fills red as the camera's detection meter rises. */
  const eye = (x: number, y: number, r: number, k: number) => {
    const almond = () => { g.beginPath(); g.moveTo(x - r, y); g.quadraticCurveTo(x, y - r * 1.15, x + r, y); g.quadraticCurveTo(x, y + r * 1.15, x - r, y); g.closePath(); };
    almond(); g.fillStyle = 'rgba(5,7,26,.88)'; g.fill();
    g.save(); almond(); g.clip(); g.fillStyle = '#ff3b4e'; g.fillRect(x - r, y + r * .6 - r * 1.2 * k, r * 2, r * 1.2 * k); g.restore();
    almond(); g.strokeStyle = '#ff6b7a'; g.lineWidth = Math.max(2, r * .16); g.stroke();
    circle(x, y, r * .3); g.fillStyle = '#ffffff'; g.fill();
  };
  /** World point a thief's work refers to (crew.ts target ids): objects, the dropped objective, a teammate, a wall. */
  const workPoint = (view: View, map: HeistMap, poses: ReadonlyMap<string, Pose>, id: string): (Point & { lift: number }) | null => {
    if (id === 'objective' && view.objective.taken) return { x: view.objective.x, y: view.objective.y, lift: .4 };
    if (id.startsWith('revive-')) { const q = poses.get(id.slice(7)); return q ? { x: q.x, y: q.y, lift: .6 } : null; }
    if (id.startsWith('wall-')) { const [, x, y] = id.split('-').map(Number); return { x: x + .5, y: y + .5, lift: 1.7 }; }
    const o = map.objects.find(o => o.id === id); return o ? { x: o.x, y: o.y, lift: 1.1 } : null;
  };

  return {
    resize(width: number, height: number, dpr: number) { w = width; h = height; canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); },
    draw(view: View | null, map: HeistMap, camera: Camera, poses: ReadonlyMap<string, Pose>, now: number, t: number, reduced: boolean, tilePx: number, scale: number) {
      g.clearRect(0, 0, w, h);
      if (!view) return;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const u = Math.max(.8, Math.min(2.2, h / 760)) * Math.max(.9, Math.min(1.25, tilePx / 48)), r = 14 * u;
      if (view.alarm && view.alarm.until > now) {
        // Edge-only vignette: an ellipse matching the screen, clear across the middle of the map.
        const beat = reduced ? .6 : .5 + .5 * Math.sin(t * 7), grad = g.createRadialGradient(0, 0, h * .38, 0, 0, h * .72);
        grad.addColorStop(0, 'rgba(255,40,40,0)'); grad.addColorStop(1, `rgba(255,40,40,${.18 + beat * .14})`);
        g.save(); g.translate(w / 2, h / 2); g.scale(w / h, 1); g.fillStyle = grad; g.fillRect(-h / 2, -h / 2, h, h); g.restore();
      }
      // Half-finished work other thieves can pick up; a camera's progress is its detection meter instead.
      for (const o of view.objects) {
        if (o.progress <= 0 || o.progress >= 1 || o.state !== 'ready') continue;
        const m = map.objects.find(x => x.id === o.id); if (!m) continue;
        if (m.kind !== 'camera') { if (project(camera, m.x, 1.1, m.y)) ring(sx, sy, 15 * u, o.progress, '#fff6e5', 4 * u); continue; }
        const f = m.facing ?? 0, pop = o.progress > .5 && !reduced ? 1 + .15 * Math.abs(Math.sin(t * 12)) : 1;
        if (project(camera, m.x + Math.cos(f) * .7, 1.7, m.y + Math.sin(f) * .7)) eye(sx, sy - 8 * u, 15 * u * pop, o.progress);
      }
      for (const n of view.npcs) {
        const p = poses.get(n.id); if (!p || !project(camera, p.x, 1.2 * scale, p.y)) continue;
        const bob = reduced ? 0 : Math.sin(t * 5 + p.x) * 2, x = sx, y = sy - 14 * u + bob;
        if (n.state === 'stunned') { for (let i = 0; i < 3; i++) { const k = reduced ? i / 3 : ((t * .8 + i / 3) % 1); g.globalAlpha = 1 - k; text('z', x + 11 * u * i - 10 * u + (reduced ? 0 : Math.sin(k * 6) * 3), y - k * 26 * u, (16 + i * 4) * u, '#e4f2ff', DISPLAY); } g.globalAlpha = 1; continue; }
        if (n.state === 'charmed') { text('♥', x, y, 22 * u, '#ff7ad0', BODY); continue; }
        if (n.state === 'panic') { text('!!', x, y, 22 * u, '#ff8ad8'); continue; }
        const chase = n.state === 'chase', alert = chase || n.state === 'suspicious' || n.state === 'investigate' || n.state === 'search';
        if (!alert && n.suspicion < .05) continue;
        const colour = chase ? '#ff3b30' : n.state === 'suspicious' || n.state === 'patrol' ? '#ffd23a' : '#ff9a2e', k = chase ? 1 : Math.max(.15, n.suspicion);
        const pop = chase && !reduced ? 1 + .12 * Math.max(0, Math.sin(t * 14)) : 1, rr = 15 * u * pop;
        gauge(x, y, rr, k, colour); circle(x, y, rr); g.strokeStyle = colour; g.lineWidth = 2.5 * u; g.stroke();
        text(chase ? '!' : '?', x, y + 1, 19 * u * pop, '#ffffff');
      }
      // Seat badges float above each thief's head on a short tail; overlapping badges are nudged apart.
      badges.length = 0;
      for (const p of view.players) {
        const pose = poses.get(p.id); if (p.suspended || !pose) continue;
        if (p.work && !p.down) { const at = workPoint(view, map, poses, p.work.target) ?? { x: pose.x, y: pose.y, lift: .9 }; if (project(camera, at.x, at.lift, at.y)) ring(sx, sy, 17 * u, p.work.progress, p.color, 5 * u); }
        if (project(camera, pose.x, (p.down ? .45 : 1.05) * scale, pose.y)) badges.push({ x: sx, y: sy - r - 12 * u, ax: sx, ay: sy, named: view.elapsed < NAME_SECONDS || p.down || !p.connected, p });
      }
      for (let pass = 0; pass < 4; pass++) for (let i = 0; i < badges.length; i++) for (let j = i + 1; j < badges.length; j++) {
        const a = badges[i], b = badges[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), ux = d > .01 ? dx / d : 1, uy = d > .01 ? dy / d : 0;
        const min = 2 * r + 8 * u + (a.named || b.named ? 20 * u * Math.abs(uy) : 0); // leave room for a name above
        if (d >= min) continue;
        const push = (min - d) / 2;
        a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
      }
      for (const { x, y, ax, ay, named, p } of badges) {
        const fill = p.down ? '#ff3b30' : p.color, pulse = reduced ? 1 : .6 + .4 * Math.sin(t * 8);
        g.globalAlpha = p.connected ? 1 : .55;
        if (p.down) { circle(x, y, r * 1.9); g.fillStyle = `rgba(255,59,48,${.25 * pulse})`; g.fill(); }
        // Tail: a wedge from the badge to the head it labels.
        const a = Math.atan2(ay - y, ax - x), tip = Math.min(Math.hypot(ax - x, ay - y), r + 11 * u), px = -Math.sin(a) * r * .5, py = Math.cos(a) * r * .5;
        g.beginPath(); g.moveTo(x + px, y + py); g.lineTo(x + Math.cos(a) * tip, y + Math.sin(a) * tip); g.lineTo(x - px, y - py); g.closePath();
        g.fillStyle = fill; g.fill(); g.strokeStyle = INK; g.lineWidth = 2.5 * u; g.stroke();
        if (p.carrying) { circle(x, y, r + 7 * u + (reduced ? 0 : 1.5 * u * Math.sin(t * 4))); g.fillStyle = GOLD; g.fill(); }
        circle(x, y, r + 2.5 * u); g.fillStyle = INK; g.fill(); circle(x, y, r); g.fillStyle = fill; g.fill();
        text(p.down ? '+' : String(p.seat + 1), x, y + 1, (p.down ? 22 : 19) * u, p.down ? '#ffffff' : INK, DISPLAY, 'rgba(0,0,0,0)');
        if (p.carrying) { circle(x + r * .95, y - r * .8, 8 * u); g.fillStyle = INK; g.fill(); text('★', x + r * .95, y - r * .8 + .5, 11 * u, GOLD, BODY, 'rgba(0,0,0,0)'); }
        if (named) {
          g.font = `800 ${12.5 * u}px ${BODY}`; const label = p.connected ? p.name : `${p.name} …`, lw = Math.min(g.measureText(label).width, 140 * u);
          g.fillStyle = 'rgba(5,7,26,.72)'; g.beginPath(); g.roundRect(x - lw / 2 - 5 * u, y - r - 21 * u, lw + 10 * u, 17 * u, 8 * u); g.fill();
          g.fillStyle = '#fff6e5'; g.fillText(label, x, y - r - 12 * u, 140 * u);
        }
        g.globalAlpha = 1;
      }
      // Floating text and sparkles, driven purely by effect age. Overlapping texts stack upward; repeats merge.
      stack.length = 0; placed.length = 0;
      for (const e of view.effects) {
        const age = (now - e.at) / 1000; if (age < 0 || age > 1.5 || !project(camera, e.x, 1.05 * scale, e.y)) continue;
        const sparks = SPARKLE[e.kind] ?? 0, colour = TEXT[e.kind] ?? '#fff6e5';
        if (sparks && age < .8) {
          g.fillStyle = colour; g.globalAlpha = 1 - age / .8;
          for (let i = 0; i < sparks; i++) { const a = i * 2.39996 + e.id, d = (18 + (i * 13) % 22) * u * (1 - (1 - age / .8) ** 2) * 1.6; star(sx + Math.cos(a) * d, sy + Math.sin(a) * d * .8 + age * age * 40 * u, (4 + (i % 3) * 1.5) * u * (1 - age / .8)); }
          g.globalAlpha = 1;
        }
        if (!e.label) continue;
        if (stack.some(o => o.label === e.label && Math.abs(o.at - e.at) < 500 && Math.abs(o.x - e.x) + Math.abs(o.y - e.y) < 2)) continue;
        stack.push(e);
        const k = Math.min(1, age / .15), rise = (1 - (1 - Math.min(1, age / 1.2)) ** 3) * 30 * u;
        let y = sy - 2 * r - 34 * u - rise;
        let bumps = 0;
        for (let i = 0; i < placed.length; i += 2) if (Math.abs(placed[i] - sx) < 80 * u && Math.abs(placed[i + 1] - y) < 21 * u) { y = placed[i + 1] - 22 * u; i = -2; bumps++; }
        if (bumps > 3) continue; // at most four texts in one pile
        placed.push(sx, y);
        g.globalAlpha = age > 1.1 ? Math.max(0, 1 - (age - 1.1) / .4) : 1;
        text(e.label, sx, y, 18 * u * (reduced ? 1 : .6 + .4 * k + .15 * Math.sin(k * Math.PI)), colour);
        g.globalAlpha = 1;
      }
    },
  };
}
