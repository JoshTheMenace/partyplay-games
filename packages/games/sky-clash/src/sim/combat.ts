/**
 * Hit detection and resolution, once per frame after every fighter moved: live hitboxes (script windows plus kit
 * inline hits), capsule hurtboxes, shield bubbles, grab boxes, clanks, counters, then all connections at once so
 * simultaneous hits trade. Knockback direction follows the victim's side of the attacker (Melee's reverse hits).
 */
import { ATTRIBUTES } from '../../fidelity/attributes';
import type { HitEffect, Limb, LiveHit } from '../model';
import { TIMING } from '../moveset';
import { chargeMultiplier, hitlagFrames, shieldDamage, shieldstunFrames, staleness } from './formulas';
import { P, alive, allied, byId, creditOf, clearMove, dropHeld, isSmash, scriptFrame, setState, shieldBreak, takeHit } from './common';
import { POWERSHIELD, startGrab } from './fighter';
import { countering, enterPhase, phaseOf, powerOf, scriptOf } from './specials';
import type { Fighter, State } from './types';
import { emit, sign } from './util';

export type Strike = {
  id: number; key: string; x: number; y: number; r: number; limb: Limb; damage: number; angle: number; kbBase: number; kbGrowth: number; fixedKb: number;
  effect: HitEffect; shieldBonus: number; grounded: boolean; airborne: boolean; clank: boolean; grab: boolean;
};
const QUIET = new Set(['grabbed', 'thrown', 'out', 'respawn', 'ledge']);
/** Hitboxes live this frame, in world meters. */
export function strikes(f: Fighter): Strike[] {
  if (!f.move || QUIET.has(f.state)) return [];
  const script = scriptOf(f), t = scriptFrame(f), ph = phaseOf(f), out: Strike[] = [];
  const grab = f.move === 'grab' || f.move === 'dashgrab' || !!ph?.grab;
  const mult = (isSmash(f.move) && f.charge ? chargeMultiplier(f.charge) : 1) * (f.special.scale || 1) * powerOf(f), counter = f.special.counter || 0;
  const dmg = (d: number) => Math.max(d * mult, counter);
  for (const w of script?.windows ?? []) if (t >= Math.max(1, w.from) && t < w.to) for (const h of w.hitboxes) out.push({
    id: h.id, key: `${w.group}`, x: f.x + f.facing * h.x, y: f.y + h.y, r: h.r, limb: h.limb, damage: dmg(h.damage), angle: h.angle, kbBase: h.kbBase, kbGrowth: h.kbGrowth,
    fixedKb: h.fixedKb ?? 0, effect: h.effect ?? 'normal', shieldBonus: h.shieldDamage ?? 0, grounded: h.hitsGrounded !== false, airborne: h.hitsAirborne !== false, clank: h.clank, grab,
  });
  (ph?.hits ?? []).forEach((h, i) => {
    if (f.phaseFrame >= h.from && f.phaseFrame < h.to) out.push({
      id: 8 + i, key: `i${i}`, x: f.x + f.facing * h.x, y: f.y + h.y, r: h.r, limb: 'body', damage: dmg(h.damage), angle: h.angle, kbBase: h.kbBase, kbGrowth: h.kbGrowth,
      fixedKb: h.fixedKb ?? 0, effect: h.effect ?? 'normal', shieldBonus: 0, grounded: true, airborne: true, clank: false, grab,
    });
  });
  return out;
}
export const liveHits = (f: Fighter): LiveHit[] => strikes(f).map(h => ({ x: h.x, y: h.y, r: h.r, limb: h.limb }));

// ── Bodies ────────────────────────────────────────────────────────────────
/** Vertical capsule from the feet to the head (lower while crouching or lying down). */
export function hurtDistance(f: Fighter, x: number, y: number): number {
  const p = P(f), h = p.height * (f.state === 'crouch' ? .6 : f.state === 'knockdown' ? .35 : 1), r = Math.min(p.radius, h / 2);
  const lo = f.y + r, hi = f.y + h - r, dy = y < lo ? y - lo : y > hi ? y - hi : 0;
  return Math.hypot(x - f.x, dy) - r;
}
/** The shield bubble the renderer draws: centered at 0.48 × height, radius shieldSize × (0.3 + 0.7 × HP). */
export const shieldCenter = (f: Fighter) => ({ x: f.x, y: f.y + P(f).height * .48, r: P(f).shieldSize * (.3 + .7 * Math.max(0, f.shield) / 100) });
export const shielding = (f: Fighter) => f.state === 'shield' || f.state === 'shieldstun';
export const inShield = (f: Fighter, x: number, y: number, r: number) => { const c = shieldCenter(f); return Math.hypot(x - c.x, y - c.y) < c.r + r; };
export const powershielding = (f: Fighter) => f.state === 'shield' && f.shieldFrame <= POWERSHIELD;
const hittable = (f: Fighter) => alive(f) && f.state !== 'respawn' && !f.intangibleNow;
const dirOf = (a: { x: number }, t: Fighter, fallback: 1 | -1): 1 | -1 => (Math.abs(t.x - a.x) > .05 ? sign(t.x - a.x) : fallback);
const staledDamage = (a: Fighter, damage: number) => (a.move && !a.move.includes('throw') ? damage * staleness(a.staled ? a.stale.slice(1) : a.stale, a.move) : damage);
function stale(a: Fighter) { if (a.move && !a.staled) { a.stale.unshift(a.move); a.stale.length = Math.min(a.stale.length, 9); a.staled = true; } }

// ── Resolution ────────────────────────────────────────────────────────────
type Contact = { a: Fighter; t: Fighter; st: Strike; kind: 'hit' | 'shield' | 'grab' | 'counter' };
export function resolveCombat(s: State) {
  const live = new Map<Fighter, Strike[]>();
  for (const f of s.fighters) { const list = f.hitlag > 0 ? [] : strikes(f); if (list.length) live.set(f, list); }
  if (!live.size) return;
  clanks(s, live);
  const contacts: Contact[] = [];
  for (const [a, list] of live) for (const t of s.fighters) {
    if (!hittable(t) || allied(s, t, a)) continue;
    const pummel = a.move === 'pummel' || !!phaseOf(a)?.pummel;
    if (pummel ? t.grabbedBy !== a.id : t.grabbedBy === a.id) continue;
    for (const st of list) {
      if (a.hitIds.includes(t.id + ':' + st.key) || (!st.grounded && t.grounded) || (!st.airborne && !t.grounded)) continue;
      if (st.grab) {
        if (t.holding || t.grabbedBy || t.state === 'ledgeclimb' || (!t.grounded && t.y - a.y > 1) || hurtDistance(t, st.x, st.y) > st.r) continue;
        contacts.push({ a, t, st, kind: 'grab' }); break;
      }
      if (shielding(t) && inShield(t, st.x, st.y, st.r)) { contacts.push({ a, t, st, kind: 'shield' }); break; }
      if (hurtDistance(t, st.x, st.y) > st.r) continue;
      contacts.push({ a, t, st, kind: countering(t) ? 'counter' : 'hit' }); break;
    }
  }
  const struck = new Set<Fighter>();
  for (const c of contacts) if (c.kind === 'counter') counter(s, c.a, c.t, c.st);
  for (const c of contacts) if (c.kind === 'hit') { hit(s, c.a, c.t, c.st); struck.add(c.t); }
  for (const c of contacts) if (c.kind === 'shield') guard(s, c.a, c.t, c.st);
  // Hits beat grabs on the same frame; two fighters grabbing each other both whiff.
  for (const c of contacts) if (c.kind === 'grab' && !struck.has(c.a) && !struck.has(c.t) && !c.t.holding && !c.t.grabbedBy && !c.a.grabbedBy && !contacts.some(o => o.kind === 'grab' && o.a === c.t && o.t === c.a)) grab(s, c.a, c.t);
}
/** Grounded attacks whose clanking hitboxes meet: within 9% both rebound, otherwise only the weaker does. */
function clanks(s: State, live: Map<Fighter, Strike[]>) {
  const list = [...live.keys()];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i]!, b = list[j]!;
    if (!a.grounded || !b.grounded || allied(s, a, b) || a.hitIds.includes('clank:' + b.id)) continue;
    const sa = live.get(a) ?? [], sb = live.get(b) ?? [];
    let pair: [Strike, Strike] | null = null;
    for (const x of sa) for (const y of sb) if (!pair && x.clank && y.clank && !x.grab && !y.grab && Math.hypot(x.x - y.x, x.y - y.y) < x.r + y.r) pair = [x, y];
    if (!pair) continue;
    const [x, y] = pair, diff = x.damage - y.damage, lag = hitlagFrames(Math.min(x.damage, y.damage));
    a.hitIds.push('clank:' + b.id, b.id + ':' + x.key); b.hitIds.push('clank:' + a.id, a.id + ':' + y.key);
    a.hitlag = Math.max(a.hitlag, lag); b.hitlag = Math.max(b.hitlag, lag);
    if (diff <= 9) { rebound(a); live.delete(a); }
    if (diff >= -9) { rebound(b); live.delete(b); }
    emit(s, 'clash', (x.x + y.x) / 2, (x.y + y.y) / 2, { source: a.id, target: b.id, power: Math.min(1, (x.damage + y.damage) / 30) });
  }
}
function rebound(f: Fighter) { clearMove(f); setState(f, 'land', Math.round(ATTRIBUTES[f.kind].clank_animation_length || TIMING[f.kind].rebound.total)); f.vx = -f.facing * .04; }
function hit(s: State, a: Fighter, t: Fighter, st: Strike) {
  a.hitIds.push(t.id + ':' + st.key);
  const ph = phaseOf(a), damage = staledDamage(a, st.damage), move = a.move ?? undefined;
  stale(a);
  if (a.move === 'pummel' || ph?.pummel) { // pummels (and bites, shocks) only add damage; the victim stays held
    t.damage = Math.min(999, t.damage + damage); creditOf(s, a).dealt += damage; t.lastHitBy = a.id; t.lastHitFrame = s.frame;
    a.hitlag = t.hitlag = Math.min(8, hitlagFrames(damage));
    emit(s, 'hit', st.x, st.y, { source: a.id, target: t.id, effect: st.effect, move, power: .2, damage: Math.round(damage * 10) / 10 });
    return;
  }
  takeHit(s, t, { ...st, damage }, dirOf(a, t, a.facing), a, { move, attackerLag: true, x: st.x, y: st.y, sleep: ph?.sleep, stuck: ph?.bury && t.grounded ? ph.bury : undefined });
  if (ph?.reverse) t.facing = (-t.facing) as 1 | -1;
  if (ph?.onHit !== undefined && a.move) enterPhase(s, a, ph.onHit); // phase ids may be the empty string (the base script)
}
function guard(s: State, a: Fighter, t: Fighter, st: Strike) {
  a.hitIds.push(t.id + ':' + st.key);
  const damage = staledDamage(a, st.damage), dir = dirOf(a, t, a.facing), lag = hitlagFrames(damage);
  stale(a);
  a.hitlag = Math.max(a.hitlag, lag); t.hitlag = Math.max(t.hitlag, lag);
  if (powershielding(t)) { emit(s, 'parry', st.x, st.y, { source: t.id, target: a.id, power: .6 }); return; }
  t.shield -= shieldDamage(damage, st.shieldBonus);
  if (t.shield <= 0) { shieldBreak(s, t); return; }
  setState(t, 'shieldstun', shieldstunFrames(damage)); t.kx = dir * Math.min(.14, .02 + damage * .0045);
  if (a.grounded) a.kx = -dir * Math.min(.08, damage * .002);
  emit(s, 'shield', st.x, st.y, { source: a.id, target: t.id, power: Math.min(1, damage / 20), damage: Math.round(damage * 10) / 10 });
}
function counter(s: State, a: Fighter, t: Fighter, st: Strike) {
  const c = countering(t)!;
  a.hitIds.push(t.id + ':' + st.key); a.hitlag = Math.max(a.hitlag, 18);
  t.facing = sign(a.x - t.x); enterPhase(s, t, c[2]); t.special.counter = c[3] ? st.damage * c[3] : 0; t.invincible = Math.max(t.invincible, 10);
  emit(s, 'counter', t.x, t.y + P(t).height / 2, { source: t.id, target: a.id, power: .7 });
}
function grab(s: State, a: Fighter, t: Fighter) {
  const ph = phaseOf(a);
  if (ph?.grab && a.move) { // command grab (inhale, Falcon Dive...): hold the victim inside the special
    dropHeld(s, t); clearMove(t); t.pending = null; t.hitstun = 0; t.kx = t.ky = t.vx = t.vy = 0; t.ledge = null;
    t.grabbedBy = a.id; setState(t, 'grabbed'); a.holding = t.id; a.grabTimer = 240; enterPhase(s, a, ph.grab);
    emit(s, 'grab', t.x, t.y + P(t).height / 2, { source: a.id, target: t.id });
    return;
  }
  startGrab(s, a, t);
}
/** Free an attacker's victim if the holder was knocked away (called after hits). */
export function orphanCheck(s: State) {
  for (const f of s.fighters) if (f.grabbedBy && byId(s, f.grabbedBy)?.holding !== f.id) { f.grabbedBy = null; if (f.state === 'grabbed' || f.state === 'thrown') setState(f, f.grounded ? 'idle' : 'air'); }
}
