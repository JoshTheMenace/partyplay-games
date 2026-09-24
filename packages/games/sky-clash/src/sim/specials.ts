/** Data-driven special engine: runs a kit's phases (src/specials.ts) over the imported special scripts (src/moveset.ts phases). */
import type { FighterKind, MoveId } from '../model';
import { MOVESET, type Move } from '../moveset';
import { P, PARTY_UP_B, byId, clearMove, dropHeld, party, setState, startMove, takeHit } from './common';
import { KITS, type Kit, type Phase, type Shot, type Slot, type Special } from './kits';
import type { Fighter, Projectile, State } from './types';
import { sweepAir, type Env } from './world';
import { aimDir, classify, consume, emit, flick, pressed, random, sign } from './util';

const SLOT_MOVE: Record<Slot, MoveId> = { n: 'nspecial', s: 'sspecial', hi: 'uspecial', lw: 'dspecial' };
export const kitOf = (kind: FighterKind): Kit => KITS[kind] ?? {};
/** Specials without a kit entry play their real phases in script order (Start → base → Loop → End), ending in helpless fall for up-specials. */
const fallbacks = new Map<string, Special>();
function fallback(kind: FighterKind, slot: Slot): Special {
  const key = kind + slot; let sp = fallbacks.get(key);
  if (!sp) {
    const phases = MOVESET[kind][SLOT_MOVE[slot]]?.phases ?? {}, order = ['Start', '', 'Loop', 'End'].filter(k => k in phases);
    const chain = order.length ? order : Object.keys(phases).slice(0, 1).concat(['']).slice(0, 1);
    sp = { start: chain[0]!, phases: Object.fromEntries(chain.map((k, i) => [k, i + 1 < chain.length ? { next: chain[i + 1]! } : {}])), ...(slot === 'hi' ? { helpless: true, lag: 20, once: true } : {}) };
    fallbacks.set(key, sp);
  }
  return sp;
}
export const slotOf = (move: MoveId | null): Slot | null =>
  !move || !move.includes('special') ? null : move.startsWith('n') ? 'n' : move.startsWith('s') ? 's' : move.startsWith('u') ? 'hi' : 'lw';
export function specialOf(f: Fighter): Special | undefined { const slot = slotOf(f.move); return slot ? kitOf(f.kind)[slot] ?? fallback(f.kind, slot) : undefined; }
/** Party recovery: up-special travel (rise speeds, launches, teleports, stalls) scales by PARTY_UP_B; falls stay Melee's. */
const boost = (s: State, f: Fighter) => (party(s) && slotOf(f.move) === 'hi' ? PARTY_UP_B : 1);
export const phaseOf = (f: Fighter): Phase | undefined => specialOf(f)?.phases[f.phase];
/** Damage multiplier of the current move: the special's and the kit's `power` (bonus fighters). */
export const powerOf = (f: Fighter) => (specialOf(f)?.power ?? 1) * (kitOf(f.kind).power ?? 1);
/** The Move whose windows drive this frame: a special's phase script (air variant when airborne), else the move itself. */
export function scriptOf(f: Fighter): Move | undefined {
  if (!f.move) return undefined;
  const move = MOVESET[f.kind][f.move]; if (!move?.phases) return move;
  const name = phaseOf(f)?.script ?? f.phase;
  return (!f.grounded && move.phases[name + 'Air']) || move.phases[name] || (phaseOf(f) ? undefined : move);
}
const within = (w: [number, number] | undefined, t: number) => !!w && t >= w[0] && t < w[1];
export const reflecting = (f: Fighter) => within(phaseOf(f)?.reflect, f.phaseFrame);
export const absorbing = (f: Fighter) => within(phaseOf(f)?.absorb, f.phaseFrame);
export const armored = (f: Fighter) => { const ph = phaseOf(f); return within(ph?.armor, f.phaseFrame) && (f.special.armorTaken ?? 0) < (ph?.armorHp ?? Infinity); };
export const phaseIntangible = (f: Fighter) => within(phaseOf(f)?.intangible, f.phaseFrame);
export function countering(f: Fighter) { const c = phaseOf(f)?.counter; return c && f.phaseFrame >= c[0] && f.phaseFrame < c[1] ? c : undefined; }
export const chargeFraction = (f: Fighter) => { const sp = specialOf(f), max = sp?.charge?.max ?? holdMax(sp); return max ? Math.min(1, (f.special.charge ?? 0) / max) : 0; };
const holdMax = (sp: Special | undefined) => sp ? Math.max(0, ...Object.values(sp.phases).map(p => (p.hold?.charge ? p.hold.max : 0))) : 0;

export function startSpecial(s: State, f: Fighter, slot: Slot): boolean {
  const air = !f.grounded, move = (SLOT_MOVE[slot] + (air ? 'Air' : '')) as MoveId, sp = kitOf(f.kind)[slot] ?? fallback(f.kind, slot);
  if (!MOVESET[f.kind][move] || (sp.groundOnly && air) || (sp.once && air && f.used.includes(slot))) return false;
  const d = aimDir(f), smash = !!sp.smash && !!flick(f, 0);
  if (slot !== 'lw' && Math.abs(d.x) > .3 && sign(d.x) !== f.facing) f.facing = sign(d.x); // side-B aims; neutral- and up-B reverse with the stick
  const stored = f.special.stored ?? 0, oil = sp.bucket && (f.special.bucket ?? 0) >= sp.bucket.count ? Math.min(50, (f.special.oil ?? 0) * sp.bucket.mult) : 0;
  startMove(s, f, move); f.fastFall = false; f.special.armorTaken = 0;
  if (air && sp.once) f.used.push(slot);
  if (air && sp.stall !== undefined && !f.used.includes(slot + '!')) { f.used.push(slot + '!'); f.vy = Math.max(f.vy, sp.stall * (slot === 'hi' ? boost(s, f) : 1)); }
  if (oil) { f.special.bucket = f.special.oil = 0; enterPhase(s, f, sp.bucket!.fire); f.special.counter = oil; return true; }
  if (sp.charge && stored >= sp.charge.max) { f.special.charge = stored; f.special.stored = 0; enterPhase(s, f, sp.charge.fire); }
  else { f.special.charge = sp.charge ? stored : 0; f.special.stored = 0; enterPhase(s, f, smash ? sp.smash! : (air && sp.air) || sp.start); }
  return true;
}
export function enterPhase(s: State, f: Fighter, id: string) {
  const sp = specialOf(f)!, ph = sp.phases[id];
  if (ph?.random) { enterPhase(s, f, ph.random[Math.floor(random(s) * ph.random.length)]!); return; }
  f.phase = id; f.phaseFrame = 0; f.hitIds = [];
  if (ph?.scale) f.special.scale = 1 + (ph.scale - 1) * chargeFraction(f);
  if (ph?.selfDamage) f.damage += ph.selfDamage;
  if (ph?.heal) f.damage = Math.max(0, f.damage - ph.heal);
  if (ph?.detonate) for (const p of s.projectiles) if (p.owner === f.id && p.kind === ph.detonate) explode(s, p);
}
export type Motion = { gravity: number; drift: number; fall: number };
/**
 * Advance one frame of the current special. Returns this frame's air-physics parameters, or null once the special ended.
 * Frame effects (shots, teleports, releases, script self-damage) fire once per frame even if called twice.
 */
export function stepSpecial(s: State, f: Fighter, env: Env, advance: boolean): Motion | null {
  const sp = specialOf(f); if (!sp) return null;
  let ph = sp.phases[f.phase] ?? {};
  if (advance) {
    f.phaseFrame++; f.moveFrame++;
    const total = ph.total ?? scriptOf(f)?.total ?? 30;
    if (ph.hold) {
      const held = ph.hold.button === 'attack' ? f.held.attack : ph.hold.button === 'jump' ? f.held.jump : f.held.special;
      if (ph.hold.charge) f.special.charge = Math.min(ph.hold.max, (f.special.charge ?? 0) + 1);
      if (ph.hold.store && pressed(s, f, 'shield')) { consume(f, 'shield'); f.special.stored = f.special.charge ?? 0; endSpecial(s, f, false); return null; }
      if (!held && f.phaseFrame >= (ph.hold.min ?? 0)) enterPhase(s, f, ph.hold.release);
      else if (ph.hold.charge && (f.special.charge ?? 0) >= ph.hold.max) enterPhase(s, f, ph.hold.full ?? ph.hold.release);
      else if (f.phaseFrame >= total) { f.phaseFrame = 0; f.hitIds = []; }
    } else if (f.phaseFrame >= total) {
      if (ph.next !== undefined) enterPhase(s, f, ph.next); else { endSpecial(s, f, true); return null; }
    }
    ph = sp.phases[f.phase] ?? {};
    const t = f.phaseFrame;
    if (ph.tether && t > 1 && !s.projectiles.some(p => p.owner === f.id && p.kind === ph.tether![0])) { enterPhase(s, f, ph.tether[1]); ph = sp.phases[f.phase] ?? {}; }
    if (ph.jumpCancel !== undefined && t >= ph.jumpCancel && pressed(s, f, 'jump')) { endSpecial(s, f, false); return null; }
    if (ph.combo && t >= ph.combo.from && pressed(s, f, 'special')) {
      consume(f, 'special'); const c = ph.combo, d = classify(f);
      enterPhase(s, f, d === 'up' ? c.up : d === 'down' ? c.down : d === 'back' ? c.back ?? c.side : d === 'neutral' ? c.neutral ?? c.side : c.side); ph = sp.phases[f.phase] ?? {};
    } else if (ph.repress && t >= ph.repress.from && (pressed(s, f, 'special') || (ph.repress.attack && pressed(s, f, 'attack')))) {
      consume(f, 'special', 'attack'); enterPhase(s, f, ph.repress.to); ph = sp.phases[f.phase] ?? {};
    }
  }
  const t = f.phaseFrame, script = scriptOf(f);
  if (f.special.fx !== s.frame) {
    f.special.fx = s.frame;
    for (const sh of ph.shots ?? []) if (shotDue(f, sh, t, script)) spawnShot(s, f, sh);
    for (const [at, dmg] of script?.selfDamage ?? []) if (Math.max(1, at) === t + 1) f.damage = Math.min(999, f.damage + dmg);
    if (ph.teleport && t === ph.teleport.at) teleport(f, env, ph.teleport.dist * boost(s, f));
    if (ph.release && t === ph.release.at && f.holding) releaseHeld(s, f, ph.release, powerOf(f));
  }
  return applyMotion(s, f, ph, t);
}
function shotDue(f: Fighter, sh: Shot, t: number, script: Move | undefined) {
  if (sh.at === 'script') return !!script?.shots.includes(t + 1);
  if (!sh.every) return t === sh.at;
  const n = (t - sh.at) / sh.every;
  return t >= sh.at && t <= (sh.until ?? 1e9) && Number.isInteger(n) && (!sh.count || n < Math.max(1, Math.round(chargeFraction(f) * sh.count)));
}
/** Command-grab release (Falcon Dive's blast, Kirby's spit, Yoshi's egg): the held fighter takes the phase's knockback. */
function releaseHeld(s: State, f: Fighter, r: NonNullable<Phase['release']>, power: number) {
  const v = byId(s, f.holding); f.holding = null;
  if (!v || v.grabbedBy !== f.id) return;
  v.grabbedBy = null; v.grounded = false; v.ground = null; v.y += .05;
  if (r.back) v.x = f.x - f.facing * (P(f).radius + P(v).radius) * .8;
  takeHit(s, v, { ...r, damage: r.damage * power }, r.back ? (-f.facing as 1 | -1) : f.facing, f, { move: f.move ?? undefined, stuck: r.stuck });
  emit(s, 'throw', v.x, v.y + P(v).height / 2, { source: f.id, target: v.id, move: f.move ?? undefined, power: .6 });
}
function applyMotion(s: State, f: Fighter, ph: Phase, t: number): Motion {
  const k = boost(s, f), out: Motion = { gravity: 1, drift: k > 1 ? 1 : .6, fall: Infinity };
  for (const raw of ph.motion ?? []) {
    if (t < (raw.from ?? 0) || t >= (raw.to ?? 1e9) || (raw.when && (raw.when === 'ground') !== f.grounded)) continue;
    const m = k === 1 ? raw : { ...raw, vx: raw.vx && raw.vx * k, vy: raw.vy && (raw.vy > 0 ? raw.vy * k : raw.vy), aim: raw.aim && raw.aim * k, launch: raw.launch && raw.launch * k,
      ax: raw.ax && raw.ax * k, ay: raw.ay && raw.ay * k, steer: raw.steer && Math.max(raw.steer * k, Math.min(.09, raw.steer * k * 2)), mash: raw.mash && raw.mash * k, arc: raw.arc && Math.min(45, raw.arc * 2) };
    // Aimed launches follow the live stick, else the press's captured aim (a swipe); `stick` launches need the live stick.
    const d = m.stick || Math.hypot(f.sx, f.sy) >= .3 ? { x: f.sx, y: f.sy } : aimDir(f), held = Math.hypot(d.x, d.y) >= .3;
    if ((m.aim !== undefined || m.launch !== undefined) && t === (m.from ?? 0) && (!m.stick || held)) {
      let a = m.launch !== undefined ? f.special.launchA ?? Math.PI / 2 : held ? Math.atan2(d.y, d.x) : Math.PI / 2;
      if (m.launch !== undefined && held) { const st = Math.atan2(d.y, d.x), dev = Math.atan2(Math.sin(st - a), Math.cos(st - a)); a += Math.max(-.5, Math.min(.5, dev)); } // phone forgiveness: a held stick bends it up to ~30°
      if (m.arc !== undefined) { const lim = m.arc * Math.PI / 180, dev = Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)); a = Math.PI / 2 + Math.max(-lim, Math.min(lim, dev)); }
      if (f.grounded && Math.sin(a) < 0) a = Math.cos(a) >= 0 ? 0 : Math.PI;
      const v = m.launch ?? m.aim!;
      f.vx = Math.cos(a) * v; f.vy = Math.sin(a) * v;
      if (Math.abs(Math.cos(a)) > .3) f.facing = sign(Math.cos(a));
      if (f.vy > 0 && f.grounded) { f.grounded = false; f.ground = null; }
    }
    if (m.vx !== undefined) f.vx = m.vx * f.facing;
    if (m.vy !== undefined) { f.vy = m.vy; if (m.vy > 0 && f.grounded) { f.grounded = false; f.ground = null; } }
    if (m.ax) f.vx += m.ax * f.facing;
    if (m.ay) f.vy += m.ay;
    if (m.brake !== undefined) f.vx *= m.brake;
    if (m.damp !== undefined) { f.vx *= m.damp; f.vy *= m.damp; }
    if (m.steer) f.vx += Math.max(-m.steer * .2, Math.min(m.steer * .2, f.sx * m.steer - f.vx));
    if (m.mash && pressed(s, f, 'special')) { consume(f, 'special'); f.vy = Math.max(f.vy, 0) + m.mash; }
    const launched = m.vy !== undefined || m.aim !== undefined || m.launch !== undefined;
    out.gravity = m.gravity ?? (launched ? 0 : out.gravity);
    out.drift = m.drift ?? (m.steer || m.vx !== undefined || launched ? 0 : out.drift);
    if (m.fall !== undefined) out.fall = m.fall;
  }
  return out;
}
/** Leave the special. `natural` = its last phase finished (helpless, rest and transform apply). */
export function endSpecial(s: State, f: Fighter, natural: boolean) {
  const sp = specialOf(f), ph = sp?.phases[f.phase];
  dropHeld(s, f);
  if (natural && ph?.transform && (f.kind === 'zelda' || f.kind === 'sheik')) {
    f.kind = ph.transform; f.jumpsLeft = Math.min(f.jumpsLeft, P(f).jumps);
    emit(s, 'armor', f.x, f.y + P(f).height / 2, { source: f.id, move: f.move ?? undefined });
  }
  clearMove(f);
  if (natural && ph?.rest) { setState(f, 'dizzy', ph.rest); f.special.asleep = 1; return; }
  if (f.grounded) setState(f, 'idle');
  else if (natural && sp?.helpless) { f.helpless = true; f.helplessLag = sp.lag ?? 10; setState(f, 'helpless'); }
  else setState(f, 'air');
}
/** Landing during a special: continue grounded ('keep'), switch phase, land with lag, or stop. */
export function landSpecial(s: State, f: Fighter) {
  const sp = specialOf(f); if (!sp) return;
  const ph = sp.phases[f.phase], land = ph?.land ?? (sp.helpless ? 'lag' : 'keep');
  if (land === 'keep') return;
  if (land === 'lag') { const lag = sp.lag ?? 10; endSpecial(s, f, false); setState(f, 'land', lag); return; }
  if (land === 'stop') { endSpecial(s, f, false); return; }
  if (land !== f.phase || f.phaseFrame > 0) enterPhase(s, f, land);
}
function teleport(f: Fighter, env: Env, dist: number) {
  const a = Math.hypot(f.sx, f.sy) >= .3 ? Math.atan2(f.sy, f.sx) : Math.PI / 2, dx = Math.cos(a) * dist, dy = f.grounded && Math.sin(a) < 0 ? 0 : Math.sin(a) * dist;
  f.grounded = false; f.ground = null; f.vx = f.vy = 0;
  const res = sweepAir(f, env, dx, dy);
  if (res.landed) { f.grounded = true; f.ground = res.landed.id; }
  if (Math.abs(dx) > .3) f.facing = sign(dx);
}
export function spawnShot(s: State, f: Fighter, sh: Shot) {
  if (sh.max && s.projectiles.filter(p => p.owner === f.id && p.kind === sh.kind).length >= sh.max) return;
  if (s.projectiles.length >= 40) return;
  const frac = sh.charge ? chargeFraction(f) : 1, p = P(f), power = powerOf(f);
  let angle = (sh.angle ?? 0) * Math.PI / 180;
  if (sh.aimed && Math.hypot(f.sx, f.sy) >= .4) angle = Math.max(-1.2, Math.min(1.4, Math.atan2(f.sy, Math.abs(f.sx))));
  const speed = sh.speed * (sh.charge ? .6 + .4 * frac : 1), dir = speed < 0 ? -f.facing : f.facing, x = f.x + f.facing * (sh.x ?? p.radius + .2), y = f.y + (sh.y ?? p.height * .55);
  s.projectiles.push({
    id: ++s.projectileId, owner: f.id, team: f.team, kind: sh.kind, x, y,
    vx: Math.cos(angle) * Math.abs(speed) * dir, vy: Math.sin(angle) * Math.abs(speed), r: (sh.r ?? .25) * (sh.charge ? .55 + .45 * frac : 1), life: sh.life ?? 60,
    effect: sh.effect ?? 'normal', damage: sh.damage * power * (sh.charge ? .15 + .85 * frac : 1), angle: sh.kbAngle ?? 361, kbBase: sh.kbBase ?? 10, kbGrowth: sh.kbGrowth ?? 50, fixedKb: sh.fixedKb ?? 0,
    gravity: sh.gravity ?? 0, bounce: sh.bounce ?? 0, ground: !!sh.ground, reflectable: sh.reflectable ?? true, absorbable: sh.absorbable ?? false,
    pierce: !!sh.pierce, flinch: sh.flinch ?? true, hitIds: [], move: f.move ?? 'nspecial', hits: 0, born: s.frame,
    ...(sh.homing ? { homing: sh.homing } : {}), ...(sh.boomerang ? { boomerang: sh.life ?? 60 } : {}), ...(sh.steer ? { steer: sh.steer } : {}), ...(sh.self !== undefined ? { self: sh.self } : {}),
    ...(sh.blast ? { blast: { ...sh.blast, damage: sh.blast.damage * power } } : {}), ...(sh.pillar ? { pillar: sh.pillar } : {}), ...(sh.stun ? { stun: sh.stun } : {}),
  });
  if (sh.charge && f.special.charge) f.special.charge = 0;
  emit(s, 'projectile', x, y, { source: f.id, move: f.move ?? undefined, effect: sh.effect ?? 'normal' });
}
/** Turn an explosive shot into its still blast; it grows with the shot's age (a full fuse gives the full blast). */
export function explode(s: State, p: Projectile) {
  const b = p.blast; if (!b) return;
  const age = s.frame - (p.born ?? s.frame), grow = .45 + .55 * (p.life <= 0 ? 1 : age / (age + p.life));
  Object.assign(p, { kind: 'explosion', vx: 0, vy: 0, gravity: 0, bounce: 0, ground: false, r: b.r * (.6 + .4 * grow), damage: b.damage * grow, angle: b.angle ?? 361, kbBase: b.kbBase ?? 30,
    kbGrowth: b.kbGrowth ?? 60, life: b.life ?? 8, pierce: true, flinch: true, reflectable: false, absorbable: false, hitIds: [], blast: undefined, steer: undefined, self: undefined });
}
