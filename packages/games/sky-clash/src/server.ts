import type { GameRules } from '../../../party-contract/src/index';
import { ATTRIBUTES } from '../fidelity/attributes';
import { driftAcceleration, fallVelocity, frictionAcceleration } from '../fidelity/physics';
import { aerialMoves, getMove, type Hitbox } from './moves';
import { STAGE_IDS, getStage, resolveStage, spawnPoint, stageFrame, type StageId, type StageChoice } from './stages';
import { SPECIALS, specialFor } from './specials';
import { ROSTER, FIGHTERS, STAGE, UNIT, VELOCITY, neutralInput, type Action, type LobbyChoice, type Fighter, type Input, type Move, type Presses, type Projectile, type Settings, type View } from './model';

type Combatant = Fighter & {
  hazardHitUntil: number; stun: number; hitstop: number; invuln: number; respawn: number; drop: number; shortHop: boolean;
  squat: number; lag: number; dodge: number; wasShield: boolean; fastFall: boolean; aimX: number; aimY: number;
  hitIds: string[]; pending: Presses; disconnectedAt: number | null; lastHitBy: string | null; lastHitAt: number;
};
type Laser = Projectile & { life: number; damage: number; flinch: boolean; vy: number; gravity: number; bounce: boolean };
export type State = Omit<View, 'players' | 'projectiles'> & { players: Combatant[]; projectiles: Laser[]; settings: Settings; createdAt: number; impactId: number; seed: number };
const buttons = ['jump', 'attack', 'special', 'smash'] as const;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const approach = (value: number, target: number, step: number) => value + clamp(target - value, -step, step);
const f = Math.fround;
const zeroPresses = (): Presses => ({ jump: 0, attack: 0, special: 0, smash: 0 });
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected an object.');
  return raw as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown field.'); }
function spawn(p: Combatant, index: number, count: number, initial = false, stageId: StageId = 'cloudbreak', frame = 0) {
  const point = spawnPoint(stageId, index, count, frame);
  Object.assign(p, { x: point.x, y: point.y + (initial ? 0 : 6.5), hazardHitUntil: frame + (initial ? 0 : 180), vx: 0, vy: 0, facing: index < count / 2 ? 1 : -1,
    damage: 0, grounded: initial, jumps: ATTRIBUTES[p.kind].max_jumps, recoveryUsed: false, shield: 100, mode: initial ? 'idle' : 'respawn', move: null,
    moveFrame: 0, charge: 0, stun: 0, hitstop: 0, invuln: initial ? 0 : 150, invulnerable: !initial, respawn: initial ? 0 : 60,
    squat: 0, lag: 0, dodge: 0, wasShield: false, fastFall: false, aimX: 0, aimY: 1,
    drop: 0, shortHop: false, hitIds: [], pending: zeroPresses(), lastHitBy: null, lastHitAt: 0 });
}
function impact(state: State, kind: View['impacts'][number]['kind'], p: Fighter, now: number) {
  const stage = getStage(state.stageId);
  state.impacts.push({ id: ++state.impactId, kind, x: clamp(p.x, -stage.blastX + .5, stage.blastX - .5), y: clamp(p.y + .7, stage.blastBottom + 1, stage.blastTop - 1), color: p.color, at: now });
  if (state.impacts.length > 24) state.impacts.shift();
}
function fall(state: State, p: Combatant, now: number, forfeit = false) {
  if (!p.stocks) return;
  impact(state, 'ko', p, now);
  const attacker = state.players.find(q => q.id === p.lastHitBy);
  if (attacker && now - p.lastHitAt <= 8000) attacker.kos++;
  p.falls++; p.stocks = forfeit ? 0 : p.stocks - 1;
  if (p.stocks) spawn(p, state.players.indexOf(p), state.players.length, false, state.stageId, state.stageTick);
  else Object.assign(p, { mode: 'out', move: null, vx: 0, vy: 0, pending: zeroPresses() });
}
function startMove(p: Combatant, move: Move) {
  p.move = move; p.moveFrame = 0; p.charge = 0; p.hitIds = []; p.mode = 'attack'; p.invuln = 0; p.fastFall = false;
  if (move === 'rise' || specialFor(p.kind, move)?.travel) { if (!p.grounded || move === 'rise') p.recoveryUsed = true; p.vx *= ATTRIBUTES[p.kind].specials_ground_speed_retention; p.vy = 0; }
}
/** Decomp formula structure with reconstructed PlCo constants; no arbitrary damage/weight multipliers. */
export function launchForce(percent: number, damage: number, weight: number, base: number, growth: number, fixed = 0) {
  const inner = fixed ? 10 * .1 + fixed * 10 * .05 : percent * .1 + percent * damage * .05;
  return Math.min(2500, ((inner * 200 / (weight + 100) * 1.4 + 18) * growth / 100) + base);
}
function attackMove(p: Fighter, input: Input, smash: boolean): Move {
  if (!p.grounded) return input.y < -.45 ? 'upair' : input.y > .45 ? 'downair' : Math.abs(input.x) < .35 ? 'aerial' : input.x * p.facing > 0 ? 'forwardair' : 'backair';
  return smash ? input.y < -.45 ? 'upsmash' : input.y > .45 ? 'downsmash' : 'smash' : input.y < -.45 ? 'upper' : input.y > .45 ? 'sweep' : Math.abs(input.x) > .35 ? 'side' : 'jab';
}
function movePlayer(state: State, p: Combatant, input: Input) {
  for (const key of buttons) if (input.presses[key] > p.presses[key]) { p.presses[key] = input.presses[key]; p.pending[key] = state.frame + 7; }
  const shieldEdge = input.shield && !p.wasShield; p.wasShield = input.shield;
  if (!p.stocks) return;
  if (p.invuln > 0) p.invuln--; p.invulnerable = p.invuln > 0;
  if (p.respawn > 0) { p.respawn--; p.mode = 'respawn'; p.pending = zeroPresses(); return; }
  const surfaces = stageFrame(state.stageId, state.stageTick, false).platforms, previous = stageFrame(state.stageId, state.stageTick - 1, false).platforms;
  // Carry riders before hitstop, then let jumps and edge departures detach naturally.
  if (p.grounded) {
    const support = previous.find(s => Math.abs(p.y - s.y) < .03 && p.x >= s.left && p.x <= s.right), current = surfaces.find(s => s.id === support?.id);
    if (support && current) { p.x += current.left - support.left; p.y += current.y - support.y; }
  }
  if (p.hitstop > 0) { p.hitstop--; return; }
  const a = ATTRIBUTES[p.kind], pressed = (key: keyof Presses) => p.pending[key] >= state.frame && p.pending[key] > 0;
  let launched = false;
  if (p.stun > 0) { p.stun--; p.mode = 'hurt'; }
  else if (p.lag > 0) { p.lag--; p.mode = input.shield && p.grounded && p.shield > 0 ? 'shield' : 'landing'; }
  else if (p.squat > 0) {
    p.mode = 'jumpsquat'; if (!input.jump) p.shortHop = true;
    if (--p.squat === 0) {
      p.vx = clamp(p.vx / VELOCITY * a.ground_to_air_jump_momentum_multiplier + input.x * a.jump_h_initial_velocity, -a.jump_h_max_velocity, a.jump_h_max_velocity) * VELOCITY;
      p.vy = (p.shortHop ? a.hop_v_initial_velocity : a.jump_v_initial_velocity) * VELOCITY;
      p.grounded = false; p.jumps = a.max_jumps - 1; p.fastFall = false; p.mode = 'air'; launched = true;
    }
  } else if (!p.dodge) {
    const guarding = input.shield && p.grounded && !p.move && p.shield > 0 && !pressed('jump');
    p.mode = guarding ? 'shield' : p.grounded ? Math.abs(p.vx) > .3 ? 'run' : 'idle' : 'air';
    if (guarding) {
      p.shield = Math.max(0, p.shield - .47); p.vx = approach(p.vx, 0, a.ground_friction * VELOCITY);
      if (!p.shield) { p.stun = 90; p.mode = 'hurt'; p.pending = zeroPresses(); }
    } else {
      p.shield = Math.min(100, p.shield + .13);
      if (!p.move) {
        if (p.grounded && Math.abs(input.x) > .12) p.facing = Math.sign(input.x);
        if (shieldEdge && !p.grounded && !p.recoveryUsed) {
          p.dodge = 49; p.invuln = 25; p.recoveryUsed = true; p.jumps = 0;
          const length = Math.hypot(input.x, input.y); p.vx = length ? input.x / length * 3.1 * VELOCITY : 0; p.vy = length ? -input.y / length * 3.1 * VELOCITY : 0;
        } else if (pressed('jump') && p.jumps && !p.recoveryUsed) {
          p.pending.jump = 0;
          if (p.grounded) { p.squat = a.jump_startup_time; p.shortHop = !input.jump; p.mode = 'jumpsquat'; }
          else { p.vy = a.jump_v_initial_velocity * a.air_jump_v_multiplier * VELOCITY; p.vx = input.x * a.air_jump_h_multiplier * VELOCITY; p.jumps--; p.fastFall = false; launched = true; }
        } else if ((pressed('special') || input.special && Math.abs(input.x) < .45 && Math.abs(input.y) < .45) && !p.recoveryUsed) {
          startMove(p, input.y < -.45 ? 'rise' : input.y > .45 ? 'reflect' : Math.abs(input.x) > .45 ? 'dash' : 'laser'); p.pending.special = 0;
        } else if (!p.recoveryUsed && (pressed('smash') || input.attack || pressed('attack'))) {
          startMove(p, attackMove(p, input, pressed('smash'))); p.pending.smash = p.pending.attack = 0;
        }
      }
    }
  }
  if (p.grounded && surfaces.some(s => !s.solid && Math.abs(s.y - p.y) < .03 && p.x >= s.left && p.x <= s.right) && input.y > .7 && !p.move && !p.stun && !p.lag && !p.squat && p.mode !== 'shield') { p.grounded = false; p.y -= .12; p.drop = 12; p.jumps = a.max_jumps - 1; }
  if (p.move) {
    p.mode = 'attack'; const spec = getMove(p.kind, p.move), ability = specialFor(p.kind, p.move);
    if (spec.chargeFrame && p.moveFrame === spec.chargeFrame && input.smash && p.charge < 60) p.charge++;
    else p.moveFrame++;
    if (p.move === 'rise' && p.moveFrame <= spec.startup) {
      if (Math.hypot(input.x, input.y) > .25) { const length = Math.hypot(input.x, input.y); p.aimX = input.x / length; p.aimY = -input.y / length; }
      else { p.aimX = 0; p.aimY = 1; }
      p.vx = p.vy = 0;
      if (p.moveFrame === spec.startup) { p.grounded = false; p.jumps = 0; p.vx = p.aimX * SPECIALS[p.kind].rise.travel * VELOCITY; p.vy = p.aimY * SPECIALS[p.kind].rise.travel * VELOCITY; }
    }
    if (p.move !== 'rise' && ability?.travel && p.moveFrame >= spec.startup && p.moveFrame < spec.startup + spec.active) { p.vx = p.facing * ability.travel * VELOCITY; p.vy = 0; }
    if (p.move !== 'rise' && ability?.travel && p.moveFrame === spec.startup + spec.active) p.vx *= .05;
    if (ability && p.moveFrame === spec.startup) {
      p.damage = clamp(p.damage + ability.selfDamage - ability.heal, 0, 999);
      if (ability.projectile && state.projectiles.length < 24) state.projectiles.push({ id: ++state.impactId, owner: p.id,
        x: p.x + p.facing * (FIGHTERS[p.kind].radius + .36), y: p.y + FIGHTERS[p.kind].height * (1.12 / 1.92),
        vx: p.facing * ability.speed, vy: ability.gravity ? 3 : 0, gravity: ability.gravity, bounce: ability.bounce,
        color: FIGHTERS[p.kind].color, life: 100, damage: ability.damage, flinch: ability.flinch });
    }
    if (p.moveFrame >= spec.end) { p.move = null; p.mode = p.grounded ? 'idle' : 'air'; }
  }
  const freeMove = !p.stun && !p.lag && !p.squat && !p.dodge && p.mode !== 'shield' && !['rise', 'dash'].includes(p.move ?? '') && !specialFor(p.kind, p.move)?.travel;
  if (p.dodge) { p.dodge--; p.mode = 'dodge'; p.vx *= .9; p.vy *= .9; }
  else if (p.stun) p.vx = approach(p.vx, 0, .051 * VELOCITY);
  else if (p.grounded) {
    let v = p.vx / VELOCITY;
    if (freeMove && !p.move && Math.abs(input.x) > .12) {
      const dash = Math.abs(input.x) > .75, max = dash ? a.dash_max_velocity : a.walk_max_vel;
      if (dash && (Math.abs(v) < .1 || v * input.x < 0)) v = Math.sign(input.x) * a.dash_initial_velocity;
      else v = approach(v, input.x * max, Math.abs(input.x) * (dash ? a.dash_accel_mul : a.walk_accel_mul) + (dash ? a.dash_accel_base : a.walk_accel_base));
    } else v += frictionAcceleration(v, a.ground_friction);
    p.vx = f(v) * VELOCITY;
  } else if (freeMove && !launched) p.vx = f(f(p.vx / VELOCITY) + driftAcceleration(p.vx / VELOCITY, input.x, a)) * VELOCITY;
  const beforeY = p.y; p.x += p.vx / 60;
  if (p.grounded && !surfaces.some(s => Math.abs(p.y - s.y) < .03 && p.x >= s.left && p.x <= s.right)) { p.grounded = false; p.jumps = Math.min(p.jumps, a.max_jumps - 1); p.squat = 0; }
  if (!p.grounded) {
    const ability = specialFor(p.kind, p.move), specialFlight = !!p.move && (p.move === 'rise' || !!ability?.travel) && p.moveFrame < getMove(p.kind, p.move).startup + getMove(p.kind, p.move).active;
    if (!p.stun && !p.dodge && !specialFlight && !launched) {
      if (input.y > .65 && p.vy < 0) p.fastFall = true;
      p.vy = (p.fastFall ? -a.fast_fall_velocity : fallVelocity(p.vy / VELOCITY, a.gravity, a.terminal_velocity)) * VELOCITY;
    } else if (p.stun) p.vy -= a.gravity * VELOCITY;
    p.y += p.vy / 60;
    if (!specialFlight) {
      const surface = [...surfaces].sort((a,b) => b.y-a.y).find(s => {
        const oldY = previous.find(p => p.id === s.id)!.y;
        return !(p.drop && !s.solid) && beforeY >= oldY - .001 && p.y <= s.y && p.x >= s.left && p.x <= s.right;
      });
      if (surface) {
        let lag: number = a.normal_landing_lag;
        if (p.move && aerialMoves.has(p.move)) {
          const automatic = getMove(p.kind, p.move).autocancel.filter(([frame]) => frame <= p.moveFrame).at(-1)![1];
          const landing = { aerial: a.landingairn_lag, forwardair: a.landingairf_lag, backair: a.landingairb_lag, upair: a.landingairhi_lag, downair: a.landingairlw_lag };
          if (!automatic) lag = landing[p.move as keyof typeof landing];
          p.move = null;
        } else if (p.recoveryUsed) { lag = 20; p.move = null; }
        p.y = surface.y; p.vy = 0; p.grounded = true; p.jumps = a.max_jumps; p.recoveryUsed = false; p.fastFall = false; p.dodge = 0; p.lag = lag;
      }
    }
  }
  if (p.drop > 0) p.drop--;
  p.invulnerable = p.invuln > 0;
}
/** Authored 2D collision anchors replace missing animated bone matrices. Raw radii remain intact. */
export function hitPosition(p: Fighter, move: Move, hit: Hitbox) {
  const anchors: Record<Move, [number, number]> = { jab: [.65, 1.1], side: [.85, .9], upper: [-.2, 1.65], sweep: [.8, .22], smash: [.85, .85], upsmash: [.1, 1.7], downsmash: [hit.id % 2 ? -.85 : .85, .25], aerial: [.25, .85], forwardair: [.85, 1], backair: [-.9, 1], upair: [0, 1.9], downair: [.1, -.05], dash: [.55, .85], rise: [0, .9], laser: [.8, 1.12], reflect: [0, .85] };
  const [x, y] = anchors[move], scale = FIGHTERS[p.kind].height / STAGE.fighterHeight, reach = FIGHTERS[p.kind].style === 'sword' || FIGHTERS[p.kind].style === 'climber' ? 1.4 : 1; return { x: p.x + p.facing * x * scale * reach, y: p.y + y * scale, radius: hit.size * UNIT * (hit.ignoreScale ? 1 : ATTRIBUTES[p.kind].model_scaling) };
}
function contact(target: Fighter, x: number, y: number, radius: number) {
  const body = FIGHTERS[target.kind];
  return Math.hypot(x - target.x, y - clamp(y, target.y + body.radius, target.y + body.height - body.radius)) <= radius + body.radius;
}
function resolve(state: State, source: Combatant, target: Combatant, hit: Hitbox, facing: number, charged: number, now: number, inputs: ReadonlyMap<string, Input>, projectile = false, countered = false) {
  const defense = specialFor(target.kind, target.move), activeDefense = defense && target.moveFrame >= defense.startup && target.moveFrame < defense.startup + defense.active;
  if (activeDefense && defense.counter && !countered && !projectile) {
    target.move = null; target.lag = 18; impact(state, 'block', target, now);
    resolve(state, target, source, { ...hit, damage: Math.max(10, hit.damage * 1.2), angle: 70 }, -facing, 0, now, inputs, false, true); return;
  }
  const damage = hit.damage * (1 + charged / 60 * .4), hitlag = Math.floor(damage / 3 + 3);
  if (!projectile) source.hitstop = hitlag;
  if (target.mode === 'shield') {
    target.shield = Math.max(0, target.shield - Math.max(0, damage + hit.shieldDamage) * 1.67); target.vx += facing * 1.2;
    target.hitstop = hitlag; target.lag = Math.floor(damage * .7 + 3); impact(state, target.shield ? 'block' : 'break', target, now);
    if (!target.shield) { target.stun = 90; target.mode = 'hurt'; target.pending = zeroPresses(); }
    return;
  }
  target.damage = Math.min(999, Math.round((target.damage + damage) * 10) / 10);
  if (activeDefense && defense.armor) { target.hitstop = hitlag; impact(state, 'hit', target, now); target.lastHitBy = source.id; target.lastHitAt = now; return; }
  const force = launchForce(target.damage, damage, FIGHTERS[target.kind].weight, hit.baseKnockback, hit.growth, hit.weightSetKnockback);
  let angle = (hit.angle === 361 ? target.grounded ? force < 32 ? 0 : force > 32.1 ? 44 : (force - 32) * 440 : 45 : hit.angle) * Math.PI / 180;
  const stick = inputs.get(target.id), influence = stick ? clamp(-stick.y * Math.cos(angle) - stick.x * facing * Math.sin(angle), -1, 1) : 0;
  angle += influence * Math.PI / 10;
  target.vx = facing * Math.cos(angle) * force * .03 * VELOCITY; target.vy = Math.sin(angle) * force * .03 * VELOCITY;
  target.stun = Math.max(1, Math.floor(force * .4)); target.hitstop = hitlag; target.mode = 'hurt'; target.grounded = false;
  target.move = null; target.squat = target.lag = target.dodge = 0; target.fastFall = false; target.recoveryUsed = false; target.pending = zeroPresses(); target.lastHitBy = source.id; target.lastHitAt = now;
  impact(state, 'hit', target, now);
}
function hits(state: State, now: number, inputs: ReadonlyMap<string, Input>) {
  // Capture all contacts before resolving: trades are independent of roster order.
  const contacts: { source: Combatant; target: Combatant; hit: Hitbox; facing: number; charge: number; key: string }[] = [];
  for (const source of state.players) {
    if (!source.stocks || source.respawn || source.hitstop || !source.move || specialFor(source.kind, source.move)?.counter) continue;
    const window = getMove(source.kind, source.move).windows.find(w => source.moveFrame >= w.from && source.moveFrame < w.to);
    if (!window) continue;
    for (const target of state.players) {
      const key = `${target.id}:${window.group}`;
      if (source === target || !target.stocks || target.invuln || target.respawn || source.hitIds.includes(key)) continue;
      const hit = window.hitboxes.find(h => {
        if (target.grounded ? !h.hitGrounded : !h.hitAirborne) return false;
        const position = hitPosition(source, source.move!, h); return contact(target, position.x, position.y, position.radius);
      });
      if (hit) contacts.push({ source, target, hit, facing: source.move === 'backair' || source.move === 'downsmash' && target.x * source.facing < source.x * source.facing ? -source.facing : source.facing, charge: source.charge, key });
    }
  }
  for (const { source, target, hit, facing, charge, key } of contacts) { source.hitIds.push(key); resolve(state, source, target, hit, facing, charge, now, inputs); }
}
function projectiles(state: State, now: number, inputs: ReadonlyMap<string, Input>) {
  for (const shot of state.projectiles) {
    shot.life--; const before = shot.x, beforeY = shot.y; shot.x += shot.vx / 60; shot.vy -= shot.gravity / 60; shot.y += shot.vy / 60;
    if (shot.bounce && shot.vy < 0) {
      const surface = stageFrame(state.stageId, state.stageTick, false).platforms.find(p => shot.x >= p.left && shot.x <= p.right && beforeY >= p.y + .1 && shot.y < p.y + .1);
      if (surface) { shot.y = surface.y + .1; shot.vy = 4; }
    }
    const source = state.players.find(p => p.id === shot.owner)!;
    for (const target of state.players) {
      if (target.id === shot.owner || !target.stocks || target.invuln || target.respawn || !contact(target, clamp(target.x, Math.min(before, shot.x), Math.max(before, shot.x)), shot.y, .08)) continue;
      const defense = specialFor(target.kind, target.move), defending = defense && target.moveFrame >= defense.startup && target.moveFrame <= Math.max(18, defense.startup + defense.active);
      if (defending && defense.absorb) { target.damage = Math.max(0, target.damage - shot.damage * 1.5); shot.life = 0; impact(state, 'block', target, now); break; }
      if (defending && defense.reflect) { shot.owner = target.id; shot.vx *= -1.2; shot.damage *= 1.5; shot.color = target.color; shot.x = target.x + Math.sign(shot.vx) * .8; break; }
      if (shot.flinch || target.mode === 'shield') {
        const hit = { ...getMove('falco', 'reflect').windows[0].hitboxes[0], damage: shot.damage, angle: 361, growth: 100, baseKnockback: 0, weightSetKnockback: 0 };
        resolve(state, source, target, hit, Math.sign(shot.vx), 0, now, inputs, true);
      } else { target.damage = Math.min(999, Math.round((target.damage + shot.damage) * 10) / 10); target.lastHitBy = source.id; target.lastHitAt = now; impact(state, 'hit', target, now); }
      shot.life = 0; break;
    }
  }
  state.projectiles = state.projectiles.filter(p => p.life > 0 && Math.abs(p.x) < getStage(state.stageId).blastX);
}
function stageHazards(state: State, now: number) {
  const h = stageFrame(state.stageId, state.stageTick, state.hazards).hazard;
  if (!h?.active) return;
  for (const p of state.players) {
    if (!p.stocks || p.respawn || p.invuln || p.x + FIGHTERS[p.kind].radius < h.x - h.width/2 || p.x - FIGHTERS[p.kind].radius > h.x + h.width/2 || p.y > h.y + h.height || p.y + FIGHTERS[p.kind].height < h.y) continue;
    if (h.kind === 'wind') { p.vx += h.direction * (p.grounded ? .025 : .075); continue; }
    if (state.stageTick < p.hazardHitUntil) continue;
    p.hazardHitUntil = state.stageTick + 60;
    if (p.mode === 'shield' && h.kind !== 'lava') { p.shield = Math.max(0,p.shield-25); if (!p.shield) { p.stun = 90; p.mode = 'hurt'; } impact(state,'block',p,now); continue; }
    p.damage = Math.min(999,p.damage+(h.kind === 'traffic' ? 16 : h.kind === 'lava' ? 14 : 10));
    p.vx = h.kind === 'traffic' ? h.direction * 14 : Math.sign(p.x-h.x) * 5; p.vy = h.kind === 'geyser' ? 17 : 12;
    p.grounded = false; p.stun = 22; p.hitstop = 4; p.move = null; p.squat = p.lag = p.dodge = 0; p.mode = 'hurt'; p.fastFall = false;
    impact(state,'hit',p,now);
  }
}
const scoreOrder = (a: Fighter, b: Fighter) => b.stocks - a.stocks || (a.stocks > 0 ? a.damage - b.damage : b.kos - a.kos);
function lobbyChoice(raw: unknown, ready: boolean): LobbyChoice {
  const v = object(raw); keys(v, ['kind', 'stage']);
  if (v.kind !== null && !ROSTER.includes(v.kind as Fighter['kind']) || v.stage !== null && !STAGE_IDS.includes(v.stage as StageId)) throw new Error('Choose a fighter and map from the roster.');
  if (ready && (!v.kind || !v.stage)) throw new Error('Choose your fighter and map before readying up.');
  return { kind: v.kind as LobbyChoice['kind'], stage: v.stage as LobbyChoice['stage'] };
}
function votedStage(votes: View['mapVotes'], seed: number, fallback: StageId): StageId {
  if (!votes.length) return fallback;
  const tally = STAGE_IDS.map(id => ({ id, count: votes.filter(v => v.stageId === id).length })), high = Math.max(...tally.map(v => v.count)), leaders = tally.filter(v => v.count === high);
  return leaders[(seed >>> 0) % leaders.length].id;
}
export const rules: GameRules<State, Input, Action, Settings, View, null> = {
  validateSettings(raw) {
    const value = object(raw); keys(value, ['seconds', 'stocks', 'stage', 'hazards']);
    const seconds = value.seconds ?? 900, stocks = value.stocks ?? 3;
    if (![0, 60, 120, 180, 300, 600, 900, 1800].includes(seconds as number) || ![1, 3, 5].includes(stocks as number)) throw new Error('Choose an available match time and 1, 3 or 5 stocks.');
    if (value.stage !== undefined && value.stage !== 'random' && !STAGE_IDS.includes(value.stage as StageId)) throw new Error('Choose a stage from the roster.');
    if (value.hazards !== undefined && typeof value.hazards !== 'boolean') throw new Error('Stage hazards must be on or off.');
    return { seconds: seconds as number, stocks: stocks as number, ...(value.stage === undefined ? {} : { stage: value.stage as StageChoice }), ...(value.hazards === undefined ? {} : { hazards: value.hazards as boolean }) };
  },
  parseInput(raw) {
    const value = object(raw); keys(value, ['x', 'y', 'jump', 'attack', 'special', 'smash', 'shield', 'presses']);
    for (const key of ['x', 'y']) if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || Math.abs(value[key] as number) > 1) throw new Error('Invalid movement.');
    for (const key of [...buttons, 'shield']) if (typeof value[key] !== 'boolean') throw new Error('Invalid button.');
    const presses = object(value.presses); keys(presses, [...buttons]);
    for (const key of buttons) if (!Number.isSafeInteger(presses[key]) || (presses[key] as number) < 0 || (presses[key] as number) > 100000) throw new Error('Invalid press count.');
    return { x: value.x as number, y: value.y as number, jump: value.jump as boolean, attack: value.attack as boolean, special: value.special as boolean, smash: value.smash as boolean, shield: value.shield as boolean, presses: { ...presses } as Presses };
  },
  neutralInput,
  parseLobbyChoice: lobbyChoice,
  parseAction(raw) {
    const value = object(raw);
    if (typeof value.turnId !== 'string' || value.turnId.length > 128) throw new Error('Invalid round.');
    if ('stage' in value) {
      keys(value, ['turnId', 'stage']);
      if (!STAGE_IDS.includes(value.stage as StageId)) throw new Error('Choose a map from the roster.');
      return { turnId: value.turnId, stage: value.stage as StageId };
    }
    keys(value, ['turnId', 'kind']);
    if (!ROSTER.includes(value.kind as Fighter['kind'])) throw new Error('Choose a fighter from the roster.');
    return { turnId: value.turnId, kind: value.kind as Fighter['kind'] };
  },
  applyAction(state, id, action, now) {
    if (action.turnId !== state.turnId || now >= state.phaseEndsAt) throw new Error('This selection has ended.');
    const player = state.players.find(p => p.id === id);
    if (!player || !player.connected) throw new Error('Player is unavailable.');
    if ('stage' in action) {
      if (state.phase !== 'vote') throw new Error('Map voting is not open.');
      if (state.mapVotes.some(v => v.playerId === id)) throw new Error('Your vote is already locked in.');
      state.mapVotes.push({ playerId: id, stageId: action.stage }); return;
    }
    if (state.phase !== 'select') throw new Error('Fighter selection has ended.');
    if (player.chosen) throw new Error('Your fighter is already locked in.');
    player.kind = action.kind; player.chosen = true; player.jumps = ATTRIBUTES[action.kind].max_jumps;
  },
  create(ctx, settings) {
    const choices = ctx.players.map(p => p.lobbyChoice === undefined ? null : lobbyChoice(p.lobbyChoice, true)), prepared = choices.every(Boolean);
    const mapVotes = prepared ? ctx.players.map((p, i) => ({ playerId: p.id, stageId: choices[i]!.stage! })) : [];
    const stageId = votedStage(mapVotes, ctx.seed, resolveStage(settings.stage, ctx.seed));
    const players = ctx.players.map((player, index) => {
      const p = { ...player, kind: choices[index]?.kind ?? (index % 2 ? 'falco' : 'fox'), chosen: prepared, connected: true, stocks: settings.stocks, kos: 0, falls: 0,
        presses: zeroPresses(), disconnectedAt: null } as Combatant;
      spawn(p, index, ctx.players.length, true, stageId); return p;
    });
    return { seed: ctx.seed, mapVotes, stageId, stageTick: 0, hazards: settings.hazards ?? true, turnId: ctx.roundId, phase: prepared ? 'countdown' : 'select', phaseEndsAt: ctx.nowMs + (prepared ? 3000 : 60000), endsAt: settings.seconds ? ctx.nowMs + (prepared ? 3000 : 83000) + settings.seconds * 1000 : 0,
      players, impacts: [], projectiles: [], frame: 0, settings: { ...settings }, createdAt: ctx.nowMs, impactId: 0 };
  },
  tick(state, inputs, _dt, now) {
    if (state.phase === 'complete') return;
    state.frame++;
    state.impacts = state.impacts.filter(event => now - event.at < 800);
    if (state.phase === 'select') {
      if (now >= state.phaseEndsAt || now >= state.createdAt + 3000 && state.players.every(p => p.chosen || !p.connected)) {
        for (const p of state.players) p.chosen = true;
        state.phase = 'vote'; state.phaseEndsAt = now + 20000;
      }
      return;
    }
    if (state.phase === 'vote') {
      const connected = state.players.filter(p => p.connected);
      if (now >= state.phaseEndsAt || connected.length > 0 && connected.every(p => state.mapVotes.some(v => v.playerId === p.id))) {
        state.stageId = votedStage(state.mapVotes, state.seed, state.stageId);
        state.players.forEach((p, i) => spawn(p, i, state.players.length, true, state.stageId));
        state.phase = 'countdown'; state.phaseEndsAt = now + 3000; state.endsAt = state.settings.seconds ? state.phaseEndsAt + state.settings.seconds * 1000 : 0;
      }
      return;
    }
    if (state.phase === 'countdown') {
      for (const p of state.players) { for (const key of buttons) p.presses[key] = Math.max(p.presses[key], inputs.get(p.id)?.presses[key] ?? 0); p.pending = zeroPresses(); }
      if (now < state.phaseEndsAt) return;
      state.phase = 'fight'; state.phaseEndsAt = state.endsAt;
    }
    if (state.endsAt && now >= state.endsAt) { state.phase = 'complete'; return; }
    state.stageTick++;
    for (const p of state.players) {
      if (!p.connected && p.disconnectedAt !== null && now - p.disconnectedAt >= 15000) fall(state, p, now, true);
      movePlayer(state, p, p.connected ? inputs.get(p.id) ?? neutralInput() : neutralInput());
    }
    stageHazards(state, now);
    hits(state, now, inputs);
    projectiles(state, now, inputs);
    const stage = getStage(state.stageId);
    for (const p of state.players) if (p.stocks && (Math.abs(p.x) > stage.blastX || p.y < stage.blastBottom || p.y > stage.blastTop)) fall(state, p, now);
    if (state.players.filter(p => p.stocks > 0).length <= 1) state.phase = 'complete';
  },
  onPresenceChange(state, id, connected, now) {
    const p = state.players.find(player => player.id === id); if (!p) return;
    p.connected = connected; p.disconnectedAt = connected ? null : now; p.pending = zeroPresses();
  },
  publicView(state) {
    return { mapVotes: state.mapVotes.map(v => ({ ...v })), stageId: state.stageId, stageTick: state.stageTick, hazards: state.hazards, turnId: state.turnId, phase: state.phase, phaseEndsAt: state.phaseEndsAt, endsAt: state.endsAt, frame: state.frame, impacts: state.impacts.map(e => ({ ...e })), projectiles: state.projectiles.map(({ id, owner, x, y, vx, color }) => ({ id, owner, x, y, vx, color })),
      players: state.players.map(p => ({ id: p.id, name: p.name, color: p.color, kind: p.kind, chosen: p.chosen, connected: p.connected,
        x: p.x, y: p.y, vx: p.vx, vy: p.vy, facing: p.facing, grounded: p.grounded, damage: p.damage, stocks: p.stocks, kos: p.kos, falls: p.falls,
        shield: p.shield, mode: p.mode, move: p.move, moveFrame: p.moveFrame, charge: p.charge, invulnerable: p.invulnerable, jumps: p.jumps, recoveryUsed: p.recoveryUsed, presses: { ...p.presses } })) };
  },
  playerView: () => null,
  outcome(state) {
    const sorted = [...state.players].sort(scoreOrder), best = sorted[0];
    return { complete: state.phase === 'complete', winners: best ? sorted.filter(p => scoreOrder(p, best) === 0).map(p => p.id) : [],
      rows: sorted.map(p => ({ playerId: p.id, rank: sorted.findIndex(q => scoreOrder(p, q) === 0) + 1, score: p.kos, label: `${p.stocks} stocks · ${p.damage}% · ${p.kos} KOs` })) };
  },
  dispose() {},
};
export default rules;
