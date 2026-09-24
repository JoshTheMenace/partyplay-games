/**
 * Projectiles and stage hazards. Projectiles fly, fall, bounce or slide along floors, and meet fighters in this order:
 * reflector → absorber → counter → shield (powershield reflects) → body. Hazards strike fighters inside their zones.
 */
import type { HitEffect } from '../model';
import { P, alive, allied, byId, creditOf, setState, shieldBreak, takeHit } from './common';
import { hurtDistance, inShield, powershielding, shielding } from './combat';
import { hitlagFrames, shieldDamage, shieldstunFrames } from './formulas';
import { absorbing, countering, enterPhase, explode, phaseOf, reflecting } from './specials';
import type { Fighter, Projectile, State } from './types';
import { emit, sign } from './util';
import type { Env, Surface } from './world';

const REFLECT = 1.5, REFLECT_CAP = 40;
/** The shot's current owner (it changes on reflect) is on f's side. */
const friendly = (s: State, p: Projectile, f: Fighter) => { const o = byId(s, p.owner); return o ? allied(s, o, f) : s.teams && f.team === p.team; };
const HAZARD_EFFECT: Record<string, HitEffect> = { acid: 'fire', bomb: 'fire', 'bullet-bill': 'fire', laser: 'electric' };
export function stepProjectiles(s: State, env: Env, list: Surface[]) {
  if (!s.projectiles.length) return;
  const blast = env.stage.blast;
  for (const p of s.projectiles) {
    p.life--;
    const owner = byId(s, p.owner);
    // Guided shots (PK Thunder, PK Flash, Din's Fire) live only while their owner stays in the special, turning toward the stick.
    if ((p.steer || p.self !== undefined) && (!owner || owner.move !== p.move)) { p.life = 0; p.blast = undefined; continue; }
    if (p.steer && owner && Math.hypot(owner.sx, owner.sy) > .4) {
      const sp = Math.hypot(p.vx, p.vy), a = Math.atan2(p.vy, p.vx), d = Math.atan2(Math.sin(Math.atan2(owner.sy, owner.sx) - a), Math.cos(Math.atan2(owner.sy, owner.sx) - a));
      const b = a + Math.max(-p.steer, Math.min(p.steer, d)); p.vx = Math.cos(b) * sp; p.vy = Math.sin(b) * sp;
    }
    if (p.rehit && p.life % p.rehit === 0) p.hitIds = [];
    if (p.homing) {
      const t = s.fighters.filter(f => alive(f) && !friendly(s, p, f)).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (t) { const sp = Math.hypot(p.vx, p.vy), a = Math.atan2(t.y + P(t).height / 2 - p.y, t.x - p.x); p.vx += Math.cos(a) * p.homing; p.vy += Math.sin(a) * p.homing; const k = sp / Math.max(1e-6, Math.hypot(p.vx, p.vy)); p.vx *= k; p.vy *= k; }
    }
    if (p.boomerang && owner && p.life < p.boomerang / 2) {
      const sp = Math.hypot(p.vx, p.vy), a = Math.atan2(owner.y + P(owner).height / 2 - p.y, owner.x - p.x);
      p.vx += (Math.cos(a) * sp - p.vx) * .12; p.vy += (Math.sin(a) * sp - p.vy) * .12;
      if (Math.hypot(owner.x - p.x, owner.y + P(owner).height / 2 - p.y) < .6) p.life = 0;
    }
    p.vy -= p.gravity;
    const nx = p.x + p.vx, ny = p.y + p.vy;
    const floor = list.find(q => p.x >= q.left && p.x <= q.right && p.y - p.r >= q.y - .05 && ny - p.r <= q.y);
    if (floor && p.vy <= 0) {
      if (p.ground) { p.y = floor.y + p.r; p.vy = 0; p.x = nx; }
      else if (p.bounce) { p.y = floor.y + p.r; p.vy = Math.max(.06, -p.vy * p.bounce); p.x = nx; }
      else p.life = 0;
    } else { p.x = nx; p.y = ny; }
    if (p.ground && !floor && p.vy === 0) p.vy = -.01;
    for (const b of env.blocks) if (p.x > b.left && p.x < b.right && p.y < b.top - .05 && p.y > b.bottom) { if (p.bounce) { p.vx = -p.vx; p.x += p.vx * 2; } else p.life = 0; }
    if (p.x < blast.left || p.x > blast.right || p.y < blast.bottom || p.y > blast.top) p.life = 0;
    if (p.life <= 0 && p.blast) explode(s, p);
    if (p.life > 0) contact(s, p, owner);
  }
  s.projectiles = s.projectiles.filter(p => p.life > 0);
}
function contact(s: State, p: Projectile, owner: Fighter | undefined) {
  for (const f of s.fighters) {
    if (p.life <= 0) return;
    if (f.id === p.owner) { if (p.self !== undefined && s.frame - (p.born ?? s.frame) >= 10 && f.move === p.move && f.phase !== p.self && hurtDistance(f, p.x, p.y) <= p.r) selfHit(s, f, p); continue; }
    if (!alive(f) || f.state === 'respawn' || f.intangibleNow || p.hitIds.includes(f.id) || friendly(s, p, f)) continue;
    const guard = shielding(f) && inShield(f, p.x, p.y, p.r);
    if (!guard && hurtDistance(f, p.x, p.y) > p.r + (reflecting(f) || absorbing(f) ? .45 : 0)) continue;
    if (p.reflectable && (reflecting(f) || (guard && powershielding(f)))) {
      const was = p.owner; p.owner = f.id; p.team = f.team; p.vx = (reflecting(f) ? f.facing : -sign(p.vx)) * Math.abs(p.vx) * (reflecting(f) ? REFLECT : 1); p.vy = -p.vy * .5;
      if (reflecting(f)) p.damage = Math.min(REFLECT_CAP, p.damage * REFLECT);
      p.hitIds = [was]; p.life = Math.max(p.life, 60);
      emit(s, reflecting(f) ? 'reflect' : 'parry', p.x, p.y, { source: f.id, target: was, power: .5 });
      continue;
    }
    if (p.absorbable && absorbing(f)) {
      if (phaseOf(f)?.bucket) { f.special.bucket = Math.min(3, (f.special.bucket ?? 0) + 1); f.special.oil = (f.special.oil ?? 0) + p.damage; } else f.damage = Math.max(0, f.damage - p.damage * 1.5);
      p.life = 0; emit(s, 'absorb', p.x, p.y, { source: f.id, power: .4 }); return;
    }
    const c = countering(f);
    if (c) { f.facing = sign(p.x - f.x); enterPhase(s, f, c[2]); f.special.counter = c[3] ? p.damage * c[3] : 0; p.life = 0; emit(s, 'counter', f.x, f.y + P(f).height / 2, { source: f.id, power: .6 }); return; }
    if (guard) {
      f.shield -= shieldDamage(p.damage); f.hitlag = Math.max(f.hitlag, hitlagFrames(p.damage));
      if (f.shield > 0) setState(f, 'shieldstun', shieldstunFrames(p.damage));
      emit(s, 'shield', p.x, p.y, { source: p.owner, target: f.id, power: Math.min(1, p.damage / 20), damage: Math.round(p.damage * 10) / 10 });
      if (f.shield <= 0) shieldBreak(s, f);
      p.life = 0; return;
    }
    if (p.blast) { explode(s, p); return; } // bombs, eggs, PK Flash: touching a fighter sets off the blast, which strikes next frame
    const dir = Math.abs(p.vx) > .01 ? sign(p.vx) : sign(f.x - p.x);
    if (p.stun !== undefined) { // Disable: only a grounded foe facing the shot is frozen
      if (f.grounded && f.facing === -sign(p.vx)) takeHit(s, f, { ...p, damage: 0 }, dir, owner ?? null, { move: p.move, x: p.x, y: p.y, stuck: p.stun });
      p.life = 0; return;
    }
    if (p.flinch) takeHit(s, f, p, dir, owner ?? null, { move: p.move, x: p.x, y: p.y });
    else { // non-flinching shots (Fox's laser) only add damage
      f.damage = Math.min(999, f.damage + p.damage); f.lastHitBy = p.owner; f.lastHitFrame = s.frame; if (owner) creditOf(s, owner).dealt += p.damage;
      emit(s, 'hit', p.x, p.y, { source: p.owner, target: f.id, effect: p.effect, move: p.move, power: .1, damage: Math.round(p.damage * 10) / 10 });
    }
    p.hits++;
    if (p.pillar) { const [life, damage] = p.pillar; Object.assign(p, { vx: 0, vy: 0, gravity: 0, ground: false, life, damage, kbBase: 5, kbGrowth: 20, angle: 90, pierce: true, reflectable: false, pillar: undefined, rehit: 6, r: p.r * 1.6 }); p.hitIds.push(f.id); }
    else if (p.pierce) p.hitIds.push(f.id); else p.life = 0;
  }
}
/** A guided shot striking its owner: the owner is launched along the shot's travel (PK Thunder 2) or sets off the big hit (Thunder). */
function selfHit(s: State, f: Fighter, p: Projectile) {
  f.special.launchA = Math.atan2(p.vy, p.vx); p.life = 0; enterPhase(s, f, p.self!); f.phaseFrame = -1; // the phase's frame 0 plays on the owner's next step
  emit(s, 'hit', p.x, p.y, { source: f.id, target: f.id, effect: p.effect, move: p.move, power: .5, damage: 0 });
}

/** Stage hazard: a warning event as each occurrence starts, then Melee-formula hits (once per occurrence, or every `rehit` frames) and wind. */
export function stepHazard(s: State, env: Env) {
  const h = env.hazard; if (!h || (!h.warning && !h.active)) return;
  const zone = h.zones[0];
  if (h.warning && s.hazardCycle !== h.cycle && zone) { s.hazardCycle = h.cycle; emit(s, 'hazard-warn', (zone.left + zone.right) / 2, (zone.bottom + zone.top) / 2, { power: .5 }); }
  if (!h.active) return;
  for (const f of s.fighters) {
    if (!alive(f) || f.state === 'respawn' || f.intangibleNow || f.grabbedBy) continue;
    const p = P(f), inside = h.zones.some(z => f.x + p.radius > z.left && f.x - p.radius < z.right && f.y + p.height > z.bottom && f.y < z.top);
    if (!inside) continue;
    if (h.push) f.x += h.push * (f.grounded ? .6 : 1);
    if (!h.damage) continue;
    const mark = h.rehit ? Math.floor(s.frame / h.rehit) : h.cycle;
    if (f.hazardHit === mark + 1) continue;
    f.hazardHit = mark + 1;
    if (shielding(f)) { f.shield -= shieldDamage(h.damage); if (f.shield <= 0) shieldBreak(s, f); emit(s, 'shield', f.x, f.y + p.height / 2, { target: f.id, power: .5 }); continue; }
    takeHit(s, f, { damage: h.damage, angle: h.angle, kbBase: h.kbBase, kbGrowth: h.kbGrowth, effect: HAZARD_EFFECT[h.kind] ?? 'normal' }, 1, null, { kind: 'hazard' });
  }
}
