/**
 * Fighter state machine: Melee's movement and action flow with phone-friendly buffering.
 * Order per frame: timers → hitlag (SDI, then launch with DI/ASDI) → actions from input → physics and collision.
 * stateFrame is 0 on the frame a state starts; moves and special phases count moveFrame/phaseFrame the same way, and
 * script windows use scriptFrame() = that + 1 (Melee's action frame).
 */
import { driftAcceleration } from '../../fidelity/physics';
import { ATTRIBUTES } from '../../fidelity/attributes';
import { UNIT, type FighterState, type MoveId } from '../model';
import { MOVESET, TIMING, type Move, type TimingId } from '../moveset';
import { ASDI, CHARGE_FRAMES, DECAY, SDI, SHIELD_DRAIN, SHIELD_REGEN, SHIELD_MAX, applyDI, MASH, grabFrames } from './formulas';
import { P, PARTY_JUMP, byId, clearMove, dropHeld, endMove, grabRelease, inRange, isAerial, isSmash, isSpecial, isThrow, party, scriptFrame, setState, shieldBreak, startMove, takeHit, toAir } from './common';
import { armored, endSpecial, kitOf, landSpecial, phaseIntangible, phaseOf, scriptOf, startSpecial, stepSpecial, type Motion } from './specials';
import type { Slot } from './kits';
import type { Fighter, State } from './types';
import { approach, classify, clamp, consume, emit, flick, pressed, sign, type Dir } from './util';
import { floorAhead, groundWalls, hangPoint, isOccupied, ledgeInReach, supportAt, sweepAir, type Env, type Surface } from './world';

export const HANG = 300, COYOTE = 5, TECH_WINDOW = 20, TECH_LOCK = 40, POWERSHIELD = 6, RESPAWN_WAIT = 300;
const timing = (f: Fighter, id: TimingId) => TIMING[f.kind][id];
const has = (f: Fighter, m: MoveId) => !!MOVESET[f.kind][m];
const TIMED = new Set<FighterState>(['roll', 'spotdodge', 'airdodge', 'tech', 'getup', 'ledgeclimb']);
const PASSIVE = new Set<FighterState>(['grabbed', 'thrown', 'ledge', 'ledgeclimb', 'out', 'respawn']);

export function stepFighter(s: State, f: Fighter, env: Env, list: Surface[]) {
  f.px = f.x; f.py = f.y;
  if (f.state === 'out') return;
  if (f.invincible > 0) f.invincible--;
  if (f.ledgeCooldown > 0) f.ledgeCooldown--;
  if (f.dropThrough > 0) f.dropThrough--;
  if (f.coyote > 0) f.coyote--;
  if (f.techLock > 0) f.techLock--;
  if (f.state !== 'shield' && f.state !== 'shieldstun') f.shield = Math.min(SHIELD_MAX, f.shield + SHIELD_REGEN);
  if (f.hitlag > 0) {
    f.hitlag--;
    if (f.pending) { sdi(f, env); if (!f.hitlag) launch(f); }
    carry(f, list); flags(f);
    return;
  }
  switch (f.state) {
    case 'grabbed': case 'thrown': held(s, f); flags(f); return;
    case 'ledge': case 'ledgeclimb': ledge(s, f, env, list); flags(f); f.stateFrame++; return;
    case 'respawn': respawn(s, f); flags(f); f.stateFrame++; return;
  }
  const motion = act(s, f, env, list);
  if (!PASSIVE.has(f.state)) physics(s, f, env, list, motion);
  flags(f);
  f.stateFrame++;
}
function flags(f: Fighter) {
  const move = f.move ? scriptOf(f) : undefined, tid = f.phase as TimingId, t = TIMING[f.kind][tid];
  f.intangibleNow = f.invincible > 0 || (!!move && inRange(move.intangible, scriptFrame(f))) || phaseIntangible(f)
    || (TIMED.has(f.state) && !f.move && !!t && inRange(t.intangible, f.stateFrame + 1));
  f.armorNow = armored(f);
}

// ── Hitlag, SDI and launch ────────────────────────────────────────────────
/** Smash DI: each fresh stick push during hitlag nudges the victim 6 Melee units (grounded victims cannot SDI downward). */
function sdi(f: Fighter, env: Env) {
  const mag = Math.hypot(f.sx, f.sy), prev = f.hist[0] ?? [0, 0], prevMag = Math.hypot(prev[0], prev[1]);
  if (mag < .7) { f.sdiDir = -9; return; }
  const a = Math.atan2(f.sy, f.sx), turned = Math.abs(Math.atan2(Math.sin(a - f.sdiDir), Math.cos(a - f.sdiDir))) > .5;
  if (!(prevMag < .7 || f.sdiDir === -9 || turned)) return;
  f.sdiDir = a;
  const d = SDI * UNIT, dx = Math.cos(a) * d, dy = f.grounded ? 0 : Math.sin(a) * d;
  if (f.grounded) f.x = groundWalls(f, env, f.x + dx);
  else { const res = sweepAir(f, env, dx, dy); if (res.landed) { f.grounded = true; f.ground = res.landed.id; } }
}
/** End of hitlag: trajectory DI rotates the launch up to 18°, ASDI shifts 3 units, then knockback velocity takes over. */
function launch(f: Fighter) {
  const pd = f.pending!; f.pending = null; f.sdiDir = -9;
  const angle = applyDI(pd.angle, f.sx, f.sy), rad = angle * Math.PI / 180;
  if (Math.hypot(f.sx, f.sy) > .7) { f.x += f.sx * ASDI * UNIT; if (!f.grounded) f.y += f.sy * ASDI * UNIT; }
  const speed = pd.kb * .03 * UNIT;
  f.kx = Math.cos(rad) * speed; f.ky = Math.sin(rad) * speed; f.vx = 0; f.vy = 0;
  if (f.grounded) {
    if (f.ky < 0 && pd.tumble) f.ky = -f.ky * .8; // grounded meteors bounce off the floor
    else if (f.ky < 0) f.ky = 0;
    if (f.ky > 0) toAir(f, f.state);
  }
  f.launch = speed;
}
function carry(f: Fighter, list: Surface[]) {
  if (!f.grounded) return;
  const s = supportAt(list, f.x, f.y, f.ground);
  if (s) { f.x += s.dx; f.y = s.y; }
}

// ── Actions ───────────────────────────────────────────────────────────────
function act(s: State, f: Fighter, env: Env, list: Surface[]): Motion | null {
  switch (f.state) {
    case 'idle': case 'walk': case 'run': case 'crouch': case 'teeter': case 'turn':
      groundControl(s, f, env, list); return null;
    case 'land':
      if (f.stateFrame >= f.timer) { setState(f, 'idle'); groundControl(s, f, env, list); }
      return null;
    case 'jumpsquat': jumpsquat(s, f, env); return null;
    case 'air': airAction(s, f, env); return airMotion(s, f, env);
    case 'helpless': return null;
    case 'tumble':
      techInput(s, f);
      if (f.hitstun > 0) { if (!--f.hitstun) recoverJump(s, f); return null; }
      f.combo = 0;
      airAction(s, f, env); return airMotion(s, f, env);
    case 'hitstun':
      techInput(s, f);
      if (f.hitstun > 0) { if (!--f.hitstun) recoverJump(s, f); return null; }
      f.combo = 0; f.launch = 0; setState(f, f.grounded ? 'idle' : 'air');
      return null;
    case 'attack': return attack(s, f, env, list);
    case 'airdodge':
      if (f.stateFrame >= f.timer) { f.phase = ''; f.helpless = true; f.helplessLag = 10; setState(f, 'helpless'); }
      return null;
    case 'shield': shield(s, f, env, list); return null;
    case 'shieldstun':
      friction(f);
      if (f.stateFrame >= f.timer) { if (f.held.shield) setState(f, 'shield'); else setState(f, 'land', timing(f, 'guardOff').total); }
      return null;
    case 'roll': case 'spotdodge': case 'tech': case 'getup': timed(s, f); return null;
    case 'knockdown': knockdown(s, f); return null;
    case 'dizzy':
      if (mashed(s, f)) f.timer -= 3;
      if (f.grounded) friction(f);
      if (f.stateFrame >= f.timer && f.grounded) { f.special.asleep = 0; setState(f, 'idle'); }
      return null;
    case 'grab': holding(s, f); return null;
    default: return null;
  }
}
const airMotion = (s: State, f: Fighter, env: Env) => (f.state === 'attack' && isSpecial(f.move) ? stepSpecial(s, f, env, false) : null);
const mashed = (s: State, f: Fighter) => (['attack', 'special', 'jump', 'shield', 'smash', 'grab'] as const).some(k => f.buf[k] === s.frame) || !!flick(f, 0, 1) || !!flick(f, 1, 1);
/** Party recovery: hitstun ending airborne gives back one air jump and the once-per-airtime specials (as a fresh hit does in Melee). */
function recoverJump(s: State, f: Fighter) { if (party(s) && !f.grounded) { f.jumpsLeft = Math.max(f.jumpsLeft, Math.min(1, P(f).jumps - 1)); f.used = []; } }
function techInput(s: State, f: Fighter) { if (pressed(s, f, 'shield')) { consume(f, 'shield'); if (f.techLock <= 0) { f.techPress = s.frame; f.techLock = TECH_LOCK; } } }
const canTech = (s: State, f: Fighter) => s.frame - f.techPress <= TECH_WINDOW;

function groundControl(s: State, f: Fighter, env: Env, list: Surface[]) {
  if (groundAction(s, f, env, list)) return;
  const p = P(f), x = f.sx, ax = Math.abs(x);
  if (f.sy < -.6 && ax < .6) {
    if (platformUnder(f, list) && (flick(f, 1, 4) || (f.state === 'crouch' && pressed(s, f, 'jump')))) { consume(f, 'jump'); dropThrough(f); return; }
    if (f.state !== 'crouch') setState(f, 'crouch');
    friction(f); return;
  }
  if (f.state === 'crouch') setState(f, 'idle');
  const fl = flick(f, 0);
  if (f.state === 'run') { run(s, f, fl); return; }
  if (fl && f.state !== 'turn') { dash(s, f, fl as 1 | -1); return; }
  if (ax > .25) {
    const d = sign(x);
    if (d !== f.facing) { f.facing = d; setState(f, 'turn', p.turnFrames); if (fl) dash(s, f, d); return; }
    if (f.state === 'turn' && f.stateFrame < f.timer) { friction(f); return; }
    if (f.state !== 'walk') setState(f, 'walk');
    f.vx = approach(f.vx, x * p.walk, p.walkAccel * ax + p.walkBase);
    f.runFrames = ax > .9 ? f.runFrames + 1 : 0;
    if (f.runFrames > 12) dash(s, f, d); // forgiving: a held full tilt breaks into a run
    return;
  }
  f.runFrames = 0;
  if (f.state === 'walk' || (f.state === 'turn' && f.stateFrame >= f.timer)) setState(f, 'idle');
  friction(f);
}
function dash(s: State, f: Fighter, d: 1 | -1) {
  const p = P(f); f.facing = d; setState(f, 'run'); f.dashing = p.dashFrames; f.runFrames = 0;
  f.vx = d * Math.max(p.dashInitial, sign(f.vx) === d ? Math.abs(f.vx) : 0);
  emit(s, 'land', f.x, f.y, { source: f.id, power: .15 });
}
function run(s: State, f: Fighter, fl: number) {
  const p = P(f), x = f.sx, ax = Math.abs(x);
  if (f.dashing > 0) {
    f.dashing--;
    if (fl && fl !== f.facing) { dash(s, f, fl as 1 | -1); return; } // dash-dance
    if (ax > .3 && sign(x) === f.facing) f.vx = approach(f.vx, f.facing * p.run * ax, p.dashAccel * ax + p.dashBase);
    else friction(f);
    if (!f.dashing && !(ax > .5 && sign(x) === f.facing)) setState(f, 'idle');
    return;
  }
  if (ax < .3) { setState(f, 'idle'); friction(f); return; }
  if (sign(x) !== f.facing) { f.facing = sign(x); setState(f, 'turn', 12); return; } // run turnaround skid
  f.vx = approach(f.vx, x * p.run, p.dashAccel * ax + p.dashBase);
}
function friction(f: Fighter) { const p = P(f); f.vx = approach(f.vx, 0, p.friction * (Math.abs(f.vx) > p.walk ? 2 : 1)); }
function platformUnder(f: Fighter, list: Surface[]) { const s = f.grounded ? supportAt(list, f.x, f.y, f.ground) : null; return s && !s.solid ? s : null; }
function dropThrough(f: Fighter) { f.dropThrough = 12; toAir(f); f.y -= .02; f.jumpsLeft = P(f).jumps - 1; f.coyote = 0; }

const slotFor = (d: Dir): Slot => (d === 'up' ? 'hi' : d === 'down' ? 'lw' : d === 'neutral' ? 'n' : 's');
/** Special direction: party mode reads up generously (up-right is still an up-special). */
const specialSlot = (s: State, f: Fighter): Slot => slotFor(classify(f, undefined, party(s)));
function special(s: State, f: Fighter, env: Env, slot: Slot): boolean {
  consume(f, 'special');
  if (!startSpecial(s, f, slot)) return false;
  stepSpecial(s, f, env, false); return true;
}
function groundAction(s: State, f: Fighter, env: Env, list: Surface[]): boolean {
  if (pressed(s, f, 'jump')) { consume(f, 'jump'); jumpStart(f); return true; }
  if (pressed(s, f, 'grab') || (f.held.shield && pressed(s, f, 'attack'))) {
    consume(f, 'grab', 'attack', 'shield');
    startMove(s, f, f.state === 'run' && has(f, 'dashgrab') ? 'dashgrab' : 'grab'); return true;
  }
  if (pressed(s, f, 'special') && special(s, f, env, specialSlot(s, f))) return true;
  if (pressed(s, f, 'smash')) { consume(f, 'smash', 'attack'); smash(s, f); return true; }
  if (pressed(s, f, 'attack')) { consume(f, 'attack'); groundAttack(s, f); return true; }
  if (f.held.shield || pressed(s, f, 'shield')) { consume(f, 'shield'); shieldStart(s, f, list); return true; }
  return false;
}
function pick(f: Fighter, ...moves: MoveId[]): MoveId { return moves.find(m => has(f, m)) ?? moves.at(-1)!; }
function groundAttack(s: State, f: Fighter) {
  const d = classify(f), a = f.aim.y || f.sy;
  if (f.state === 'run' && d !== 'up' && d !== 'down') { startMove(s, f, 'dash'); return; }
  if (d === 'back') f.facing = (-f.facing) as 1 | -1;
  if (d === 'neutral' && pressed(s, f, 'jump')) return;
  const move: MoveId = d === 'up' ? 'utilt' : d === 'down' ? 'dtilt' : d === 'neutral' ? 'jab1' : pick(f, a > .35 ? 'ftiltHi' : a < -.35 ? 'ftiltLw' : 'ftilt', 'ftilt');
  startMove(s, f, has(f, move) ? move : 'jab1');
}
function smash(s: State, f: Fighter) {
  const d = classify(f), a = f.aim.y || f.sy;
  if (d === 'back') f.facing = (-f.facing) as 1 | -1;
  const move: MoveId = d === 'up' ? 'usmash' : d === 'down' ? 'dsmash' : pick(f, a > .35 ? 'fsmashHi' : a < -.35 ? 'fsmashLw' : 'fsmash', 'fsmash');
  startMove(s, f, move);
}
function jumpStart(f: Fighter) { setState(f, 'jumpsquat', P(f).jumpsquat); f.shortHop = !f.held.jump; f.aerialQueued = false; }
/** Jumpsquat: releasing Jump before it ends (or Jump + Attack together) is a short hop; up-special and up-smash cancel it. */
function jumpsquat(s: State, f: Fighter, env: Env) {
  const p = P(f);
  if (!f.held.jump) f.shortHop = true;
  if (pressed(s, f, 'special') && specialSlot(s, f) === 'hi' && special(s, f, env, 'hi')) return;
  if (pressed(s, f, 'smash') && classify(f) === 'up') { consume(f, 'smash', 'attack'); startMove(s, f, 'usmash'); return; }
  if (pressed(s, f, 'attack') || pressed(s, f, 'smash')) { f.shortHop = true; f.aerialQueued = true; }
  friction(f);
  if (f.stateFrame < f.timer) return;
  f.vx = clamp(f.vx * p.jumpMomentum + f.sx * p.jumpH, -p.jumpHMax, p.jumpHMax);
  f.vy = f.shortHop ? p.shortHop : p.fullHop;
  toAir(f); f.jumpsLeft = p.jumps - 1; f.fastFall = false; f.coyote = 0;
  emit(s, 'jump', f.x, f.y, { source: f.id, power: f.shortHop ? .3 : .5 });
  if (f.aerialQueued) { consume(f, 'attack', 'smash'); aerial(s, f); }
}
/** Air options (also from tumble once hitstun ends): jumps, air dodge, specials, aerials. */
function airAction(s: State, f: Fighter, env: Env): boolean {
  const p = P(f);
  if (pressed(s, f, 'jump')) {
    if (f.coyote > 0) {
      consume(f, 'jump'); f.coyote = 0; f.vy = p.fullHop; f.vx = clamp(f.vx + f.sx * p.jumpH, -p.jumpHMax, p.jumpHMax);
      setState(f, 'air'); emit(s, 'jump', f.x, f.y, { source: f.id, power: .5 }); return true;
    }
    if (f.jumpsLeft > 0) {
      consume(f, 'jump'); f.jumpsLeft--; f.fastFall = false; f.kx = f.ky = 0; f.launch = 0;
      const k = party(s) ? PARTY_JUMP : 1;
      f.vy = p.airJumpV * k * (1 - p.airJumpDecay * (p.jumps - 2 - f.jumpsLeft)); f.vx = f.sx * p.airJumpH * k;
      setState(f, 'air'); emit(s, 'airjump', f.x, f.y, { source: f.id, power: .4 }); return true;
    }
    // Party: Jump with no jumps left is the up-special (aimed by the live stick).
    if (party(s) && !f.helpless) { consume(f, 'jump'); f.aim = { x: f.sx, y: f.sy }; if (special(s, f, env, 'hi')) return true; }
  }
  if (pressed(s, f, 'shield') && !f.airdodged) { consume(f, 'shield'); airdodge(s, f); return true; }
  if (pressed(s, f, 'special') && special(s, f, env, specialSlot(s, f))) return true;
  if (pressed(s, f, 'attack') || pressed(s, f, 'smash') || pressed(s, f, 'grab')) { consume(f, 'attack', 'smash', 'grab'); aerial(s, f); return true; }
  return false;
}
function aerial(s: State, f: Fighter) {
  const d = classify(f);
  startMove(s, f, d === 'up' ? 'uair' : d === 'down' ? 'dair' : d === 'forward' ? 'fair' : d === 'back' ? 'bair' : 'nair');
}
/** Melee air dodge: 3.1 units/frame along the stick, decaying ×0.9 without gravity, then helpless fall. */
function airdodge(s: State, f: Fighter) {
  f.airdodged = true; f.fastFall = false; f.phase = 'airdodge'; setState(f, 'airdodge', timing(f, 'airdodge').total);
  const m = Math.hypot(f.sx, f.sy), v = 3.1 * UNIT;
  f.vx = m > .3 ? f.sx / m * v : 0; f.vy = m > .3 ? f.sy / m * v : 0; f.kx = f.ky = 0;
  emit(s, 'dodge', f.x, f.y + P(f).height / 2, { source: f.id });
}

// ── Attacks ───────────────────────────────────────────────────────────────
function attack(s: State, f: Fighter, env: Env, list: Surface[]): Motion | null {
  if (isSpecial(f.move)) return stepSpecial(s, f, env, true);
  const m = MOVESET[f.kind][f.move!];
  if (!m) { endMove(f); return null; }
  // Charged smashes freeze on the charge frame while the button is held (up to 60 frames, ×1.367 damage).
  if (m.charge && isSmash(f.move) && f.moveFrame + 1 === m.charge.frame && (f.held.attack || f.held.smash) && f.charge < CHARGE_FRAMES) f.charge++;
  else f.moveFrame++;
  const t = f.moveFrame + 1;
  if ((f.move === 'jab1' || f.move === 'jab2') && pressed(s, f, 'attack') && t >= (m.followup ?? lastHit(m))) {
    const next: MoveId | null = f.move === 'jab1' ? (has(f, 'jab2') ? 'jab2' : has(f, 'jabRapid') ? 'jabRapid' : null) : has(f, 'jab3') ? 'jab3' : has(f, 'jabRapid') ? 'jabRapid' : null;
    if (next) { consume(f, 'attack'); startMove(s, f, next); return null; }
  }
  if (f.move === 'jabRapid' && m.windows.length && t >= m.total && (f.held.attack || pressed(s, f, 'attack'))) { consume(f, 'attack'); f.moveFrame = 0; f.hitIds = []; }
  if (isThrow(f.move) && f.holding) {
    if (m.turn !== undefined && t === m.turn && m.turn !== m.release) f.facing = (-f.facing) as 1 | -1;
    if (t === (m.release ?? 1)) throwRelease(s, f, m);
  }
  if (f.move === 'pummel' && !f.holding) { endMove(f); return null; }
  if (m.iasa !== undefined && t >= m.iasa && !f.holding && (f.grounded ? groundAction(s, f, env, list) : airAction(s, f, env))) return null; // a pummel's IASA must not start a new move while still holding
  if (t > m.total) { if (f.move === 'pummel' && f.holding) { clearMove(f); setState(f, 'grab'); f.stateFrame = 4; } else endMove(f); return null; }
  if (f.grounded) f.vx = approach(f.vx, 0, P(f).friction * (f.move === 'dash' ? .5 : 1));
  return null;
}
const lastHit = (m: Move) => m.windows.at(-1)?.to ?? m.total;
/** Throw release: the held fighter takes the throw command's knockback in the thrower's (possibly reversed) facing. */
function throwRelease(s: State, f: Fighter, m: Move) {
  const v = byId(s, f.holding); f.holding = null;
  if (!v || !m.throw) return;
  if (m.turn !== undefined && m.turn === m.release) f.facing = (-f.facing) as 1 | -1;
  v.grabbedBy = null; v.y = f.y + .05; v.grounded = false; v.ground = null;
  takeHit(s, v, m.throw, f.facing, f, { move: f.move ?? undefined });
  f.hitlag = 0;
  emit(s, 'throw', v.x, v.y + P(v).height / 2, { source: f.id, target: v.id, move: f.move ?? undefined, power: .6 });
}

// ── Shield, dodges, knockdown, grabs ──────────────────────────────────────
function shieldStart(s: State, f: Fighter, list: Surface[]) {
  if (Math.abs(f.sx) > .7 && Math.abs(f.sx) > Math.abs(f.sy)) { roll(s, f, sign(f.sx)); return; }
  if (f.sy < -.7) { if (platformUnder(f, list)) { dropThrough(f); return; } spotdodge(s, f); return; }
  f.shieldFrame = 0; setState(f, 'shield');
}
function shield(s: State, f: Fighter, env: Env, list: Surface[]) {
  f.shieldFrame++; f.shield -= SHIELD_DRAIN; friction(f);
  if (f.shield <= 0) { shieldBreak(s, f); return; }
  if (pressed(s, f, 'jump')) { consume(f, 'jump'); jumpStart(f); return; }
  if (pressed(s, f, 'grab') || pressed(s, f, 'attack')) { consume(f, 'grab', 'attack'); startMove(s, f, 'grab'); return; }
  if (pressed(s, f, 'special') && specialSlot(s, f) === 'hi' && special(s, f, env, 'hi')) return;
  const fx = flick(f, 0, 4), fy = flick(f, 1, 6);
  if (fx) { roll(s, f, fx as 1 | -1); return; }
  if (fy < 0) { if (platformUnder(f, list)) dropThrough(f); else spotdodge(s, f); return; } // shield-drop through platforms with a long window
  if (!f.held.shield && f.stateFrame >= 2) setState(f, 'land', timing(f, 'guardOff').total);
}
function roll(s: State, f: Fighter, dir: 1 | -1) {
  f.phase = dir === f.facing ? 'rollF' : 'rollB'; f.special.rollDir = dir;
  setState(f, 'roll', timing(f, f.phase as TimingId).total); emit(s, 'dodge', f.x, f.y, { source: f.id });
}
function spotdodge(s: State, f: Fighter) { f.phase = 'spotdodge'; setState(f, 'spotdodge', timing(f, 'spotdodge').total); emit(s, 'dodge', f.x, f.y, { source: f.id }); }
/** Rolls, spot dodges, techs and getups (and getup attacks): scripted duration and intangibility, eased travel. */
function timed(s: State, f: Fighter) {
  const dir = f.special.rollDir ?? 0, rolling = f.state === 'roll' || f.phase === 'techF' || f.phase === 'techB' || f.phase === 'getupF' || f.phase === 'getupB';
  const T = Math.max(1, f.timer), k = f.stateFrame / T, dist = rolling ? (f.state === 'roll' ? 1.9 : 1.5) : 0;
  f.vx = dist && k < .75 ? dir * dist * 2 / (T * .75) * (1 - k / .75) : 0;
  if (f.move) { const m = MOVESET[f.kind][f.move]; f.moveFrame++; if (!m || f.moveFrame >= m.total) { clearMove(f); f.phase = ''; setState(f, 'idle'); f.vx = 0; } return; }
  if (f.stateFrame < f.timer) return;
  if (f.state === 'roll' && f.phase === 'rollF') f.facing = (-f.facing) as 1 | -1;
  f.phase = ''; f.vx = 0; setState(f, f.grounded ? 'idle' : 'air');
}
/** Missed tech: bounce, then getup in place, forward, back or attack (or a forced getup after 3 s). */
function knockdown(s: State, f: Fighter) {
  f.vx = approach(f.vx, 0, P(f).friction);
  const bound = timing(f, 'bound').total;
  if (f.stateFrame < bound) return;
  const getup = (phase: TimingId, dir = 0) => { f.phase = phase; f.special.rollDir = dir; setState(f, 'getup', timing(f, phase).total); };
  if (pressed(s, f, 'attack') || pressed(s, f, 'smash')) { consume(f, 'attack', 'smash'); startMove(s, f, has(f, 'getupattack') ? 'getupattack' : 'getupattackD', 'getup'); f.phase = 'getup'; return; }
  if (Math.abs(f.sx) > .5 || pressed(s, f, 'shield')) { consume(f, 'shield'); const d = Math.abs(f.sx) > .5 ? sign(f.sx) : f.facing; getup(d === f.facing ? 'getupF' : 'getupB', d); return; }
  if (pressed(s, f, 'jump') || f.sy > .5 || f.stateFrame >= bound + 180) { consume(f, 'jump'); getup('getup'); }
}
/** Holding a grabbed fighter: pummel, throw by stick (or button + aim), release when the grab timer runs out. */
function holding(s: State, f: Fighter) {
  const v = byId(s, f.holding);
  if (!v || v.grabbedBy !== f.id) { f.holding = null; setState(f, 'idle'); return; }
  friction(f);
  if (--f.grabTimer <= 0) { grabRelease(s, f, v); return; }
  if (f.stateFrame < 4) return;
  if (pressed(s, f, 'attack') && has(f, 'pummel')) { consume(f, 'attack'); startMove(s, f, 'pummel'); return; }
  const d = Math.hypot(f.sx, f.sy) > .6 ? classify(f, { x: f.sx, y: f.sy }) : pressed(s, f, 'smash') || pressed(s, f, 'special') || pressed(s, f, 'grab') ? classify(f) : 'neutral';
  if (d === 'neutral') return;
  consume(f, 'smash', 'special', 'grab');
  const t: MoveId = d === 'up' ? 'uthrow' : d === 'down' ? 'dthrow' : d === 'back' ? 'bthrow' : 'fthrow';
  if (!has(f, t)) return;
  startMove(s, f, t); v.state = 'thrown';
}
/** Grabbed and thrown fighters ride the holder's hand; grabbed ones mash (any button or stick flick) to escape. */
function held(s: State, f: Fighter) {
  const h = byId(s, f.grabbedBy);
  if (!h || h.holding !== f.id) { f.grabbedBy = null; setState(f, f.grounded ? 'idle' : 'air'); return; }
  // A holder knocked out of its grab (pushed off an edge by wind, landing...) lets go instead of holding forever.
  if (h.state !== 'grab' && !(h.state === 'attack' && (h.move === 'pummel' || isThrow(h.move) || isSpecial(h.move)))) { grabRelease(s, h, f); return; }
  const inside = h.kind === 'kirby' && isSpecial(h.move);
  const back = h.move === 'bthrow' && (h.moveFrame + 1) >= Math.max(1, (MOVESET[h.kind].bthrow?.release ?? 2) - 3);
  f.x = h.x + (back ? -h.facing : h.facing) * (inside ? .05 : (P(h).radius + P(f).radius) * .8);
  f.y = h.y + (inside ? .1 : 0); f.grounded = h.grounded; f.ground = h.ground; f.vx = f.vy = f.kx = f.ky = 0; f.facing = (-h.facing) as 1 | -1;
  if (f.state === 'grabbed' && mashed(s, f)) h.grabTimer -= MASH;
  if (f.state === 'grabbed' && h.grabTimer <= 0) {
    if (h.state === 'grab' || h.move === 'pummel') grabRelease(s, h, f);
    else if (isSpecial(h.move)) { endSpecial(s, h, false); f.vx = h.facing * .1; }
  }
  f.stateFrame++;
}
export function startGrab(s: State, f: Fighter, v: Fighter) {
  dropHeld(s, v); clearMove(v); v.pending = null; v.hitstun = 0; v.launch = 0; v.kx = v.ky = v.vx = v.vy = 0; v.ledge = null;
  v.grabbedBy = f.id; setState(v, 'grabbed');
  clearMove(f); f.holding = v.id; f.grabTimer = grabFrames(v.damage); f.vx = 0; setState(f, 'grab');
  emit(s, 'grab', v.x, v.y + P(v).height / 2, { source: f.id, target: v.id });
}

// ── Ledges and respawn ────────────────────────────────────────────────────
export function grabLedge(s: State, f: Fighter, ledgeId: string, env: Env) {
  const l = env.ledges.find(e => e.id === ledgeId)!, occupant = isOccupied(l, s.fighters, f);
  if (occupant) { // the arriving grab trumps the hanging fighter
    occupant.ledge = null; clearMove(occupant); toAir(occupant, 'air');
    occupant.vx = l.side * .06; occupant.vy = .12; occupant.ledgeCooldown = 30; occupant.invincible = Math.max(occupant.invincible, 20);
  }
  dropHeld(s, f);
  clearMove(f); f.ledge = l.id; f.ledgeSide = l.side; f.facing = (-l.side) as 1 | -1; setState(f, 'ledge', HANG);
  const h = hangPoint(f, l); f.x = h.x; f.y = h.y; f.vx = f.vy = f.kx = f.ky = 0; f.launch = 0; f.grounded = false; f.ground = null; f.fastFall = false;
  f.jumpsLeft = Math.max(f.jumpsLeft, P(f).jumps - 1); f.helpless = false; f.airdodged = false; f.used = []; f.tumble = false; f.hitstun = 0; f.special.float = 0;
  if (f.ledgeFresh) { f.invincible = Math.max(f.invincible, 30 + timing(f, 'ledgeCatch').total); f.ledgeFresh = false; }
  emit(s, 'ledge', l.x, l.y, { source: f.id, ...(occupant ? { target: occupant.id } : {}) });
}
/** Hanging: climb (toward), jump (Jump/up), roll (Shield), attack (Attack), drop (away/down). Slow variants at 100%+. */
function ledge(s: State, f: Fighter, env: Env, list: Surface[]) {
  const l = env.ledges.find(e => e.id === f.ledge), p = P(f), slow = f.damage >= 100;
  if (!l) { f.ledge = null; clearMove(f); toAir(f, 'air'); return; }
  if (f.state === 'ledge') {
    const h = hangPoint(f, l); f.x = h.x; f.y = h.y;
    if (--f.timer <= 0) { dropLedge(f); return; }
    if (f.stateFrame < timing(f, 'ledgeCatch').total) return;
    const toward = f.sx * -l.side, option = pressed(s, f, 'attack') || pressed(s, f, 'smash') ? 'attack' : pressed(s, f, 'jump') || f.sy > .65 ? 'jump'
      : pressed(s, f, 'shield') ? 'roll' : toward > .6 ? 'climb' : toward < -.6 || f.sy < -.6 ? 'drop' : null;
    if (!option) return;
    consume(f, 'attack', 'smash', 'jump', 'shield');
    if (option === 'drop') { dropLedge(f); return; }
    const id: TimingId = option === 'roll' ? (slow ? 'ledgeRollSlow' : 'ledgeRoll') : option === 'jump' ? (slow ? 'ledgeJumpSlow' : 'ledgeJump') : slow ? 'climbSlow' : 'climb';
    if (option === 'attack') { const m: MoveId = slow && has(f, 'ledgeattackSlow') ? 'ledgeattackSlow' : 'ledgeattack'; startMove(s, f, m, 'ledgeclimb'); f.timer = MOVESET[f.kind][m]?.total ?? 40; }
    else setState(f, 'ledgeclimb', timing(f, id).total);
    f.phase = id; f.special.ledgeOption = ['climb', 'roll', 'jump', 'attack'].indexOf(option);
    f.ledgeTarget = l.x - l.side * (p.radius + (option === 'roll' ? 2.1 : option === 'attack' ? .55 : .3));
    f.special.hangX = f.x; f.special.hangY = f.y;
    return;
  }
  // ledgeclimb: rise to the ledge top, then travel onto the stage.
  if (f.move) f.moveFrame++;
  const T = Math.max(2, f.timer), k = Math.min(1, (f.stateFrame + 1) / T), up = Math.min(1, k / .45), across = Math.max(0, (k - .45) / .55);
  const hx = f.special.hangX ?? f.x, hy = f.special.hangY ?? f.y, edgeX = l.x - l.side * p.radius * .3, option = f.special.ledgeOption ?? 0;
  if (option === 2) { f.x = hx + (edgeX - hx) * up; f.y = hy + (l.y + .15 - hy) * k; }
  else { f.x = across ? edgeX + (f.ledgeTarget - edgeX) * across * (2 - across) : hx + (edgeX - hx) * up; f.y = hy + (l.y - hy) * up; }
  if (f.stateFrame + 1 < T) return;
  f.ledge = null; clearMove(f); f.phase = '';
  if (option === 2) { toAir(f, 'air'); f.vx = -l.side * p.ledgeJumpH; f.vy = p.ledgeJumpV; emit(s, 'jump', f.x, f.y, { source: f.id, power: .5 }); return; }
  const floor = supportAt(list, f.x, l.y, null) ?? list.find(q => Math.abs(q.y - l.y) < .05 && f.x >= q.left - .3 && f.x <= q.right + .3);
  f.x = floor ? clamp(f.x, floor.left, floor.right) : f.x; f.y = l.y; f.grounded = true; f.ground = floor?.id ?? l.block; f.vx = 0; setState(f, 'idle');
}
function dropLedge(f: Fighter) { const side = f.ledgeSide; f.ledge = null; toAir(f, 'air'); f.x += side * .08; f.vy = 0; f.ledgeCooldown = 30; }
/** Respawn halo: descend, then wait until the fighter moves or presses anything (or RESPAWN_WAIT runs out). */
function respawn(s: State, f: Fighter) {
  f.vx = f.vy = f.kx = f.ky = 0;
  const target = f.special.haloY ?? f.y, descending = f.stateFrame < 50;
  f.y = descending ? target + (50 - f.stateFrame) * .06 : target;
  if (descending) return;
  f.respawnTimer--;
  const act = Math.hypot(f.sx, f.sy) > .4 || (['attack', 'special', 'jump', 'shield', 'smash', 'grab'] as const).some(k => pressed(s, f, k));
  if (!act && f.respawnTimer > 0) return;
  toAir(f, 'air'); f.invincible = 120; f.jumpsLeft = P(f).jumps - 1;
}

// ── Physics and collision ─────────────────────────────────────────────────
const WALK_OFF = new Set<FighterState>(['walk', 'run', 'turn', 'hitstun', 'tumble', 'land', 'idle', 'teeter', 'crouch', 'shieldstun', 'dizzy']);
function physics(s: State, f: Fighter, env: Env, list: Surface[], motion: Motion | null) {
  if (f.grounded) ground(s, f, env, list, motion); else air(s, f, env, list, motion);
}
function ground(s: State, f: Fighter, env: Env, list: Surface[], motion: Motion | null) {
  const sup = supportAt(list, f.x, f.y, f.ground);
  if (!sup) { toAir(f, airState(f)); air(s, f, env, list, motion); return; }
  f.x += sup.dx; f.y = sup.y; f.ground = sup.id; f.vy = 0; f.ky = 0;
  if (f.kx) f.kx = approach(f.kx, 0, P(f).friction + DECAY * UNIT);
  let nx = groundWalls(f, env, f.x + f.vx + f.kx);
  if (nx < sup.left || nx > sup.right) {
    const next = list.find(q => q !== sup && Math.abs(q.y - sup.y) < .03 && nx >= q.left && nx <= q.right);
    // Walking, running and knockback carry fighters off edges; a slow idle or an attack stops at the edge (teeter).
    const off = WALK_OFF.has(f.state) && (!['idle', 'teeter', 'crouch'].includes(f.state) || Math.abs(f.vx + f.kx) > P(f).walk * .5)
      || (f.state === 'attack' && (Math.abs(f.kx) > .02 || isSpecial(f.move)));
    if (next) f.ground = next.id;
    else if (off) {
      f.x = nx; toAir(f, airState(f)); f.coyote = f.state === 'hitstun' || f.state === 'tumble' ? 0 : COYOTE; f.jumpsLeft = P(f).jumps - 1; return;
    } else { nx = clamp(nx, sup.left, sup.right); f.vx = 0; f.kx = 0; }
  }
  f.x = nx;
  if (f.state === 'idle' || f.state === 'teeter') {
    const edge = !floorAhead(list, f.x + f.facing * P(f).radius * .5, f.y);
    if (edge && f.state === 'idle') setState(f, 'teeter'); else if (!edge && f.state === 'teeter') setState(f, 'idle');
  }
}
const airState = (f: Fighter): FighterState => (['hitstun', 'tumble', 'attack', 'dizzy', 'helpless', 'airdodge'] as FighterState[]).includes(f.state) ? f.state : 'air';
function air(s: State, f: Fighter, env: Env, list: Surface[], motion: Motion | null) {
  const p = P(f), a = ATTRIBUTES[f.kind], st = f.state, sp = isSpecial(f.move);
  if (st === 'airdodge') {
    if (f.stateFrame < 30) { f.vx *= .9; f.vy *= .9; } else gravity(f, 1);
  } else {
    const free = st === 'air' || (st === 'tumble' && f.hitstun <= 0) || st === 'helpless' || st === 'dizzy' || (st === 'attack' && !sp);
    const drift = free ? (st === 'helpless' ? (party(s) ? 1 : .7) : st === 'dizzy' ? 0 : 1) : sp ? motion?.drift ?? .6 : 0;
    if (drift) f.vx += driftAcceleration(f.vx / UNIT, clamp(f.sx * drift, -1, 1), a) * UNIT;
    const canFF = (st === 'air' || (st === 'attack' && !sp) || st === 'helpless' || (st === 'tumble' && f.hitstun <= 0)) && f.vy + f.ky <= 0 && !f.fastFall;
    if (canFF && flick(f, 1) < 0) { f.fastFall = true; f.vy = -p.fastFall; }
    gravity(f, sp ? motion?.gravity ?? 1 : 1);
    if (sp && motion && Number.isFinite(motion.fall)) f.vy = Math.max(f.vy, -motion.fall);
    float(f, st);
  }
  const res = sweepAir(f, env, f.vx + f.kx, f.vy + f.ky, list);
  const kl = Math.hypot(f.kx, f.ky);
  if (kl) { const k = Math.max(0, kl - DECAY * UNIT) / kl; f.kx *= k; f.ky *= k; if (!f.kx && !f.ky) f.launch = 0; }
  const stun = st === 'hitstun' || st === 'tumble';
  if (res.ceiling) {
    if (stun && canTech(s, f)) techSurface(s, f, 'techCeil'); else { f.vy = Math.min(0, f.vy); f.ky = stun ? -f.ky * .8 : Math.min(0, f.ky); }
  }
  if (res.wall) {
    if (stun && canTech(s, f) && kl > .05) techSurface(s, f, 'techWall');
    else { f.kx = stun ? -f.kx * .8 : 0; f.vx = 0; }
  }
  if (res.landed) { land(s, f, res.landed); return; }
  ledgeCheck(s, f, env);
}
/** Peach's float: holding Jump while falling hangs in the air (aerials allowed) until the kit's frames run out or Jump is let go; once per airtime. */
function float(f: Fighter, st: FighterState) {
  const max = kitOf(f.kind).float, t = f.special.float ?? 0;
  if (!max || t >= max) return;
  const can = (st === 'air' || (st === 'attack' && isAerial(f.move))) && !f.fastFall && f.vy + f.ky <= 0;
  if (can && f.held.jump) { f.vy = 0; f.special.float = t + 1; }
  else if (t > 0) f.special.float = max;
}
function gravity(f: Fighter, mult: number) {
  const p = P(f);
  if (f.fastFall) f.vy = -p.fastFall;
  else f.vy = Math.max(f.vy - p.gravity * mult, Math.min(f.vy, -p.terminal));
}
function techSurface(s: State, f: Fighter, id: TimingId) {
  f.kx = f.ky = f.vx = f.vy = 0; f.techPress = -1e9; f.phase = id; setState(f, 'tech', timing(f, id).total); f.hitstun = 0; f.tumble = false; f.launch = 0; f.combo = 0;
  emit(s, 'tech', f.x, f.y + P(f).height / 2, { source: f.id });
}
function land(s: State, f: Fighter, surf: Surface) {
  const p = P(f), impact = -(f.vy + f.ky);
  f.grounded = true; f.ground = surf.id; f.fastFall = false; f.airdodged = false; f.used = []; f.ledgeFresh = true; f.coyote = 0; f.special.float = 0;
  f.jumpsLeft = p.jumps; f.helpless = false;
  const st = f.state;
  if (st === 'attack') {
    if (isSpecial(f.move)) { f.vy = 0; f.ky = 0; landSpecial(s, f); emit(s, 'land', f.x, f.y, { source: f.id, power: .3 }); return; }
    const m = MOVESET[f.kind][f.move!];
    if (m && isAerial(f.move)) {
      // Autocancel windows land with normal lag; otherwise the aerial's landing lag, L-canceled (halved) unless strict mode.
      const last = [...m.autoCancel ?? []].reverse().find(([fr]) => fr <= f.moveFrame + 1), auto = !last || last[1];
      const strict = s.settings.lcancel === 'melee' && s.frame - f.buf.shield > 7;
      const lag = auto || !m.landingLag ? p.landing : strict ? m.landingLag : Math.floor(m.landingLag / 2);
      clearMove(f); setState(f, 'land', lag);
    } else if (!m) { clearMove(f); setState(f, 'land', p.landing); }
  } else if (st === 'airdodge') { f.phase = ''; setState(f, 'land', 10); }
  else if (st === 'helpless') setState(f, 'land', f.helplessLag || 10);
  else if (st === 'hitstun' || st === 'tumble') {
    if (f.tumble && canTech(s, f)) {
      const d = Math.abs(f.sx) > .5 ? sign(f.sx) : 0; f.phase = d === 0 ? 'tech' : d === f.facing ? 'techF' : 'techB'; f.special.rollDir = d;
      f.techPress = -1e9; f.kx = f.ky = f.vx = 0; f.hitstun = 0; f.tumble = false; f.launch = 0; f.combo = 0; setState(f, 'tech', timing(f, f.phase as TimingId).total);
      emit(s, 'tech', f.x, f.y, { source: f.id });
    } else if (f.tumble && impact > .3 && f.bounces < 1) { f.bounces++; f.grounded = false; f.ground = null; f.ky = impact * .5; f.vy = 0; f.y += .01; emit(s, 'land', f.x, f.y, { source: f.id, power: .8 }); return; }
    else if (f.tumble) { f.kx *= .5; f.ky = 0; f.vx = 0; f.hitstun = 0; f.tumble = false; f.launch = 0; f.combo = 0; setState(f, 'knockdown'); emit(s, 'land', f.x, f.y, { source: f.id, power: .7 }); }
    else if (f.hitstun <= 0) setState(f, 'land', p.landing);
  } else if (st === 'air' || st === 'jumpsquat') setState(f, 'land', p.landing);
  f.vy = 0; f.ky = 0; f.bounces = 0;
  emit(s, 'land', f.x, f.y, { source: f.id, power: Math.min(1, impact * 2) });
}
function ledgeCheck(s: State, f: Fighter, env: Env) {
  if (f.ledgeCooldown > 0 || f.sy < -.5 || f.holding || f.grabbedBy) return;
  const ph = isSpecial(f.move) ? phaseOf(f) : undefined, special = !!ph && ph.ledge !== undefined && f.phaseFrame >= ph.ledge;
  const ok = special || ((f.state === 'air' || f.state === 'helpless' || (f.state === 'tumble' && f.hitstun <= 0) || f.state === 'airdodge') && f.vy + f.ky <= .02);
  if (!ok) return;
  for (const l of env.ledges) if (ledgeInReach(f, l)) { grabLedge(s, f, l.id, env); return; }
}
export { endSpecial };
