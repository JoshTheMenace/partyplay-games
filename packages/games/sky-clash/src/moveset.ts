/**
 * Per-fighter move tables compiled from the imported Melee command streams (fidelity/actions.ts), plus physics from
 * fidelity/attributes.ts. Browser-safe data: the renderer reads frame data and limbs, the server reads everything.
 *
 * Hitbox anchor model. Melee hitbox offsets are relative to animated bones whose transforms we do not have, so:
 * - bone 0 (TopN, the fighter's root) offsets are used directly: z is forward, y is up (× UNIT × model scale);
 * - any other bone is placed on the move's authored strike ray (ANCHOR: root height and direction in fighter space,
 *   reach as a fraction of height). Melee skeletons list parents before children, so a higher bone id (then a longer
 *   offset) is more distal and sits farther along the ray; the offset length also extends it. Two-sided moves
 *   (down smash, getup attacks) alternate front/back per window. Radii are Melee sizes × UNIT × model scale.
 * Poses and limbs come from content's src/poses-table.ts (POSE_TABLE), so hits[].limb follows it; defaultPose() is the fallback.
 *
 * Frames follow Melee's script counter: frame 1 is an action's first frame (FighterView.moveFrame). A window is live while
 * from <= frame < to (a window from 0 starts on frame 1); `iasa` is the first interruptible frame; the action lasts `total` frames.
 */
import { ACTIONS } from '../fidelity/actions';
import { ATTRIBUTES } from '../fidelity/attributes';
import { decodeHitbox } from '../fidelity/commands';
import { POSE_TABLE } from './poses-table';
import { MOVE_SOURCES, ROSTER, ROSTER_DATA, UNIT, type FighterKind, type HitEffect, type Hitbox, type HitWindow, type Limb, type MoveDef, type MoveId, type Pose } from './model';

export type Hit = Hitbox & { id: number; limb: Limb; clank: boolean; bone: number; onlyGrabbed: boolean; sfx: number };
export type Window = HitWindow & { hitboxes: Hit[]; group: number };
export type ThrowData = { damage: number; angle: number; kbBase: number; kbGrowth: number; fixedKb: number; effect: HitEffect };
export type Move = MoveDef & {
  source: string; limb: Limb; windows: Window[];
  /** Body collision ranges [from, to) from bodyCollisionState commands (1 invincible, 2 intangible). */
  intangible: [number, number][];
  /** Command-variable toggles [frame, flag, value]; special callbacks key movement off these. */
  flags: [number, number, number][];
  /** Frames with a shootitem command (projectile spawn). */
  shots: number[];
  /** Throw knockback (throw command type 0), the release frame (command 0x50 arg 0) and the thrower's reversal (0x50 arg 1, applied before release). */
  throw?: ThrowData; release?: number; turn?: number;
  /** Frame the jab follow-up opens (enableJabFollowup). */
  followup?: number;
  selfDamage: [number, number][];
  /** Every subaction of a special slot keyed by suffix ('' for the base name, 'Start', 'Loop', 'Hold', '2Hi'...). */
  phases?: Record<string, Move>;
};
export type Timing = { total: number; intangible: [number, number][] };

const ELEMENTS: HitEffect[] = ['normal', 'fire', 'electric', 'slash', 'coin', 'ice', 'sleep', 'sleep', 'normal', 'normal', 'normal', 'normal', 'psychic', 'darkness', 'electric', 'grass'];
type Raw = ReturnType<typeof decodeHitbox>;
type Compiled = { total: number; windows: { from: number; to: number; group: number; raw: Raw[] }[]; autoCancel: [number, boolean][]; iasa?: number; charge?: number;
  intangible: [number, number][]; flags: [number, number, number][]; shots: number[]; throw?: ThrowData; release?: number; turn?: number; followup?: number; selfDamage: [number, number][] };

/** Expand timers, bounded loops, calls (op 5, returns) and gotos (op 7) into frame windows. Frame = the action timer (0 on the first frame). */
export function compile(stream: string, frames: number, routines: Readonly<Record<string, string>>): Compiled {
  let frame = 0, group = 0, budget = 4000, bodyFrom = -1, cut = false;
  const active = new Map<number, Raw>(), out: Compiled = { total: Math.max(1, frames), windows: [], autoCancel: [], intangible: [], flags: [], shots: [], selfDamage: [] };
  const advance = (next: number) => {
    if (next > frame && active.size) {
      const raw = [...active.values()], last = out.windows.at(-1);
      if (last && last.to === frame && last.group === group && last.raw.length === raw.length && last.raw.every((r, i) => r === raw[i])) last.to = next;
      else out.windows.push({ from: frame, to: next, group, raw });
    }
    frame = Math.max(frame, next);
  };
  const run = (script: string, depth: number): boolean => {
    // Looping idle/hold actions call or jump back into themselves; stop expanding once nesting or the budget runs out.
    if (depth > 8) return cut = true;
    const cmds = script ? script.split(' ') : [], loops: { at: number; left: number }[] = [];
    for (let i = 0; i < cmds.length; i++) {
      if (--budget < 0) return cut = true;
      const hex = cmds[i], word = parseInt(hex.slice(0, 8), 16) >>> 0, op = word >>> 26, arg = word & 0x3ffffff;
      if (op === 0) return true;
      if (op === 6) return false;
      if (op === 1) advance(frame + arg);
      else if (op === 2) advance(arg);
      else if (op === 3) loops.push({ at: i, left: arg });
      else if (op === 4) { const loop = loops.at(-1); if (loop && --loop.left > 0) i = loop.at; else loops.pop(); }
      else if (op === 5 || op === 7) { const body = routines[String(parseInt(hex.slice(8, 16), 16))]; if (body === undefined) throw new Error('Missing subroutine'); if (run(body, depth + 1) || op === 7) return true; }
      else if (op === 11) { const hit = decodeHitbox(hex); active.set(hit.id, hit); }
      else if (op === 12 || op === 13) { const id = arg >>> 23 & 7, hit = active.get(id); if (hit) active.set(id, op === 12 ? { ...hit, damage: arg & 0x7fffff } : { ...hit, size: Math.fround(.003906 * (arg & 0x7fffff)) }); }
      else if (op === 15) active.delete(arg & 7);
      else if (op === 16) { active.clear(); group++; }
      else if (op === 19) { const flag = word >>> 24 & 3, value = arg & 0xffffff; out.flags.push([frame, flag, value]); if (flag === 0) out.autoCancel.push([frame, !value]); }
      else if (op === 20) { if (arg & 1) out.turn ??= frame; else out.release ??= frame; }
      else if (op === 23) out.iasa ??= frame;
      else if (op === 24) out.shots.push(frame);
      else if (op === 26) { const state = arg & 3; if (state && bodyFrom < 0) bodyFrom = frame; else if (!state && bodyFrom >= 0) { out.intangible.push([bodyFrom, frame]); bodyFrom = -1; } }
      else if (op === 29) out.followup ??= frame;
      else if (op === 34 && !(word >>> 23 & 7)) {
        const b = parseInt(hex.slice(8, 16), 16) >>> 0, c = parseInt(hex.slice(16, 24), 16) >>> 0;
        out.throw = { damage: word & 511, angle: b >>> 23, kbGrowth: b >>> 14 & 511, fixedKb: b >>> 5 & 511, kbBase: c >>> 23, effect: ELEMENTS[c >>> 18 & 15] ?? 'normal' };
      }
      else if (op === 51) out.selfDamage.push([frame, arg & 0xffff]);
      else if (op === 56) out.charge ??= frame;
    }
    return true;
  };
  run(stream, 0);
  if (cut) { frame = Math.min(frame, out.total); out.windows = out.windows.filter(w => w.from < out.total).map(w => ({ ...w, to: Math.min(w.to, out.total) })); }
  else advance(Math.max(frame, out.total));
  if (bodyFrom >= 0) out.intangible.push([bodyFrom, out.total]);
  out.total = Math.max(out.total, frame);
  return out;
}

// ── Default poses and anchors ────────────────────────────────────────────
const SWORD = new Set(['sword']), HAMMER = new Set(['climber']);
/** Engine fallback: pose family and delivering limb for every move, by fighter style. */
export function defaultPose(kind: FighterKind, move: MoveId): { pose: Pose; limb: Limb } {
  const style = ROSTER_DATA[kind].style as string, sword = SWORD.has(style), hammer = HAMMER.has(style), w: Limb = 'weapon';
  const armed: Partial<Record<MoveId, [Pose, Limb]>> = sword ? {
    jab1: ['sword-slash', w], jab2: ['sword-slash', w], jab3: ['sword-thrust', w], ftilt: ['sword-slash', w], ftiltHi: ['sword-slash', w], ftiltLw: ['sword-low', w],
    utilt: ['sword-rising', w], dtilt: ['sword-low', w], dash: ['sword-thrust', w], fsmash: ['sword-overhead', w], fsmashHi: ['sword-overhead', w], fsmashLw: ['sword-overhead', w],
    usmash: ['sword-rising', w], dsmash: ['sword-low', w], nair: ['sword-spin', w], fair: ['sword-slash', w], bair: ['sword-slash', w], uair: ['sword-rising', w], dair: ['sword-down-stab', w],
  } : hammer ? { fsmash: ['hammer-swing', w], usmash: ['hammer-overhead', w], dsmash: ['hammer-swing', w], ftilt: ['hammer-swing', w], fair: ['hammer-overhead', w], dair: ['hammer-overhead', w] } : {};
  const base: Record<MoveId, [Pose, Limb]> = {
    jab1: ['jab', 'handR'], jab2: ['jab-cross', 'handL'], jab3: ['jab-finisher', 'footR'], jabRapid: ['jab-rapid', 'handR'],
    ftilt: ['kick-front', 'footR'], ftiltHi: ['kick-high', 'footR'], ftiltLw: ['kick-low', 'footR'], utilt: ['uppercut', 'handR'], dtilt: ['sweep', 'footR'], dash: ['dash-attack', 'body'],
    fsmash: ['palm-thrust', 'handR'], fsmashHi: ['palm-thrust', 'handR'], fsmashLw: ['palm-thrust', 'handR'], usmash: ['headbutt', 'head'], dsmash: ['sweep', 'footR'],
    nair: ['spin', 'body'], fair: ['kick-front', 'footR'], bair: ['hip-check', 'footL'], uair: ['flip-kick', 'footR'], dair: ['stomp', 'footR'],
    nspecial: ['cast-forward', 'handR'], nspecialAir: ['cast-forward', 'handR'], sspecial: ['rush', 'body'], sspecialAir: ['rush', 'body'],
    uspecial: ['rise', 'handR'], uspecialAir: ['rise', 'handR'], dspecial: ['cast-down', 'body'], dspecialAir: ['cast-down', 'body'],
    grab: ['grab', 'handR'], dashgrab: ['grab', 'handR'], pummel: ['pummel', 'handR'], fthrow: ['throw-forward', 'handR'], bthrow: ['throw-back', 'handR'], uthrow: ['throw-up', 'handR'], dthrow: ['throw-down', 'handR'],
    ledgeattack: ['ledge-attack', 'footR'], ledgeattackSlow: ['ledge-attack', 'footR'], getupattack: ['getup-attack', 'footR'], getupattackD: ['getup-attack', 'footR'], taunt: ['taunt', 'body'],
  };
  const [pose, limb] = armed[move] ?? base[move];
  return { pose, limb };
}
/** Strike ray per move: [root height ×height, direction degrees (0 forward, 90 up), reach ×height]. */
const ANCHOR: Record<MoveId, [number, number, number]> = {
  jab1: [.6, 0, .42], jab2: [.6, 0, .42], jab3: [.55, 0, .46], jabRapid: [.6, 0, .45], ftilt: [.45, 0, .5], ftiltHi: [.5, 25, .5], ftiltLw: [.4, -20, .5],
  utilt: [.55, 80, .45], dtilt: [.12, 0, .55], dash: [.45, 0, .45], fsmash: [.55, 0, .55], fsmashHi: [.55, 25, .55], fsmashLw: [.5, -20, .55], usmash: [.6, 90, .5], dsmash: [.12, 0, .55],
  nair: [.5, 0, .3], fair: [.55, -15, .5], bair: [.5, 180, .5], uair: [.6, 90, .5], dair: [.3, -90, .3],
  nspecial: [.6, 0, .5], nspecialAir: [.6, 0, .5], sspecial: [.5, 0, .5], sspecialAir: [.5, 0, .5], uspecial: [.6, 80, .45], uspecialAir: [.6, 80, .45], dspecial: [.35, 0, .45], dspecialAir: [.35, -60, .45],
  grab: [.55, 0, .4], dashgrab: [.55, 0, .42], pummel: [.55, 0, .35], fthrow: [.55, 0, .35], bthrow: [.55, 180, .35], uthrow: [.7, 90, .35], dthrow: [.3, 0, .35],
  ledgeattack: [.3, 0, .5], ledgeattackSlow: [.3, 0, .5], getupattack: [.15, 0, .5], getupattackD: [.15, 0, .5], taunt: [.5, 0, .3],
};
const TWO_SIDED = new Set<MoveId>(['dsmash', 'getupattack', 'getupattackD']);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function build(kind: FighterKind, move: MoveId, source: string, c: Compiled, limb: Limb, pose: Pose): Move {
  const a = ATTRIBUTES[kind], scale = a.model_scaling, h = ROSTER_DATA[kind].height, [rootY, dir, reachFrac] = ANCHOR[move];
  const reach = (reachFrac + (limb === 'weapon' ? .15 : 0)) * h;
  const windows = c.windows.map((w, wi): Window => {
    const bones = w.raw.filter(r => r.bone !== 0).sort((p, q) => p.bone - q.bone || Math.hypot(p.offset.x, p.offset.y, p.offset.z) - Math.hypot(q.offset.x, q.offset.y, q.offset.z));
    return { from: w.from, to: w.to, group: w.group, hitboxes: w.raw.map(r => {
      const s = r.ignoreScale ? 1 : scale, len = Math.hypot(r.offset.x, r.offset.y, r.offset.z) * UNIT * s;
      let x: number, y: number;
      if (r.bone === 0) { x = r.offset.z * UNIT * s; y = r.offset.y * UNIT * s; }
      else {
        const rank = bones.indexOf(r), t = (rank + 1) / bones.length, back = TWO_SIDED.has(move) && (c.windows.length > 1 ? wi % 2 === 1 : rank % 2 === 1);
        const d = reach * (.5 + .5 * t) + len * .35, rad = (back ? 180 - dir : dir) * Math.PI / 180;
        x = Math.cos(rad) * d; y = rootY * h + Math.sin(rad) * d;
      }
      const hit: Hit = { id: r.id, x: r3(x), y: r3(y), r: r3(Math.max(.05, r.size * UNIT * s)), damage: r.damage, angle: r.angle, kbBase: r.baseKnockback, kbGrowth: r.growth, limb,
        effect: ELEMENTS[r.element] ?? 'normal', clank: r.clank, bone: r.bone, onlyGrabbed: r.onlyHitGrabbed, sfx: r.sfxSeverity };
      if (r.weightSetKnockback) hit.fixedKb = r.weightSetKnockback;
      if (r.shieldDamage) hit.shieldDamage = r.shieldDamage;
      if (!r.hitGrounded) hit.hitsGrounded = false;
      if (!r.hitAirborne) hit.hitsAirborne = false;
      return hit;
    }) };
  });
  const out: Move = { name: source, source, pose, limb, total: c.total, windows, intangible: c.intangible, flags: c.flags, shots: c.shots, selfDamage: c.selfDamage };
  if (c.autoCancel.length) out.autoCancel = c.autoCancel;
  if (c.iasa !== undefined && c.iasa < c.total) out.iasa = c.iasa;
  if (c.charge !== undefined) out.charge = { frame: c.charge, max: 60 };
  if (c.throw) out.throw = c.throw;
  if (c.release !== undefined) out.release = c.release;
  if (c.turn !== undefined) out.turn = c.turn;
  if (c.followup !== undefined) out.followup = c.followup;
  const land = ({ nair: a.landingairn_lag, fair: a.landingairf_lag, bair: a.landingairb_lag, uair: a.landingairhi_lag, dair: a.landingairlw_lag } as Partial<Record<MoveId, number>>)[move];
  if (land) out.landingLag = land;
  return out;
}

const SPECIAL_SLOT: Partial<Record<MoveId, [string, boolean]>> = {
  nspecial: ['N', false], nspecialAir: ['N', true], sspecial: ['S', false], sspecialAir: ['S', true], uspecial: ['Hi', false], uspecialAir: ['Hi', true], dspecial: ['Lw', false], dspecialAir: ['Lw', true],
};
/** Melee names outside model.ts MOVE_SOURCES: Marth/Roy's single forward tilt, the Links' two-part forward smash (first swing),
 * Peach's randomized forward smash (the first variant) and Donkey Kong's cargo throw (ThrowF only lifts). */
const ALIASES: Partial<Record<MoveId, string[]>> = { ftilt: ['AttackS31'], fsmash: ['AttackS41', 'AttackS4#2'], fthrow: ['ThrowFF'] };
type Profile = (typeof ACTIONS)[string];
const compiled = new Map<string, Compiled>();
function action(profile: string, data: Profile, name: string): Compiled | undefined {
  const entry = data.actions[name]; if (!entry) return undefined;
  const key = profile + '/' + name;
  if (!compiled.has(key)) compiled.set(key, compile(entry[1], entry[0], data.routines));
  return compiled.get(key);
}
function movesFor(kind: FighterKind): Partial<Record<MoveId, Move>> {
  const profile = ROSTER_DATA[kind].profile as string, data = ACTIONS[profile]!, result: Partial<Record<MoveId, Move>> = {};
  for (const move of Object.keys(MOVE_SOURCES) as MoveId[]) {
    const { pose, limb } = POSE_TABLE[kind]?.[move] ?? defaultPose(kind, move), slot = SPECIAL_SLOT[move];
    if (slot) {
      // Air slots inherit ground phases (Fox's SpecialHiHoldAir lives beside SpecialHi); scripts ending in 'Air' are picked by the special engine when airborne.
      const [key, air] = slot, phases: Record<string, Move> = {};
      for (const re of air ? [new RegExp(`^Special${key}(?!Air)(.*)$`), new RegExp(`^Special(?:Air${key}|${key}Air)(.*)$`)] : [new RegExp(`^Special${key}(?!Air)(.*)$`)])
        for (const name of Object.keys(data.actions)) { const m = re.exec(name); if (m) phases[m[1]!] = build(kind, move, name, action(profile, data, name)!, limb, pose); }
      const list = Object.values(phases); if (!list.length) continue;
      const main = phases[''] ?? phases['Start'] ?? list.find(p => p.windows.length) ?? list[0]!;
      result[move] = { ...main, phases };
      continue;
    }
    const found = [...MOVE_SOURCES[move], ...ALIASES[move] ?? []].map(name => [name, action(profile, data, name)] as const).filter(([, c]) => c);
    // Throws carry their knockback in a throw command rather than hitboxes; taunts have none.
    const pick = found.find(([, c]) => c!.windows.length || c!.throw) ?? (move === 'taunt' ? found[0] : undefined);
    if (pick) result[move] = build(kind, move, pick[0], pick[1]!, limb, pose);
  }
  return result;
}
export const MOVESET = Object.fromEntries(ROSTER.map(kind => [kind, movesFor(kind)])) as Record<FighterKind, Partial<Record<MoveId, Move>>>;

/** Durations and intangibility of common actions (dodges, techs, getups, ledge options), per fighter. */
const TIMING_SOURCES = {
  spotdodge: 'EscapeN', rollF: 'EscapeF', rollB: 'EscapeB', airdodge: 'EscapeAir', tech: 'Passive', techF: 'PassiveStandF', techB: 'PassiveStandB', techWall: 'PassiveWall', techCeil: 'PassiveCeil',
  bound: 'DownBoundU', downWait: 'DownWaitU', getup: 'DownStandU', getupF: 'DownFowardU', getupB: 'DownBackU', ledgeCatch: 'CliffCatch',
  climb: 'CliffClimbQuick', climbSlow: 'CliffClimbSlow', ledgeRoll: 'CliffEscapeQuick', ledgeRollSlow: 'CliffEscapeSlow', ledgeJump: 'CliffJumpQuick1', ledgeJumpSlow: 'CliffJumpSlow1',
  guardOff: 'GuardOff', rebound: 'Rebound', turn: 'Turn', dash: 'Dash', landing: 'Landing', squat: 'Squat', dizzy: 'FuraFura', grabRelease: 'CatchCut', capturedRelease: 'CaptureCut',
} as const;
export type TimingId = keyof typeof TIMING_SOURCES;
export const TIMING = Object.fromEntries(ROSTER.map(kind => {
  const profile = ROSTER_DATA[kind].profile as string, data = ACTIONS[profile]!;
  return [kind, Object.fromEntries(Object.entries(TIMING_SOURCES).map(([id, name]) => {
    const c = action(profile, data, name); return [id, { total: c?.total ?? 20, intangible: c?.intangible ?? [] }];
  }))];
})) as Record<FighterKind, Record<TimingId, Timing>>;

/** Per-fighter physics in meters and frames (Melee attributes × UNIT for lengths and speeds). */
export type Physics = {
  walk: number; walkAccel: number; walkBase: number; friction: number; dashInitial: number; dashAccel: number; dashBase: number; run: number; dashFrames: number;
  jumpsquat: number; jumpH: number; jumpHMax: number; jumpMomentum: number; fullHop: number; shortHop: number; airJumpV: number; airJumpH: number; airJumpDecay: number; jumps: number;
  gravity: number; terminal: number; fastFall: number; drift: number; driftAccel: number; driftBase: number; airFriction: number; airMax: number;
  weight: number; landing: number; turnFrames: number; jabWindow: number; scale: number; shieldSize: number; shieldBreakVy: number; ledgeJumpH: number; ledgeJumpV: number;
  height: number; radius: number;
};
export const PHYSICS = Object.fromEntries(ROSTER.map(kind => {
  const a = ATTRIBUTES[kind], info = ROSTER_DATA[kind], u = UNIT;
  const p: Physics = {
    walk: a.walk_max_vel * u, walkAccel: a.walk_accel_mul * u, walkBase: a.walk_accel_base * u, friction: a.ground_friction * u,
    dashInitial: a.dash_initial_velocity * u, dashAccel: a.dash_accel_mul * u, dashBase: a.dash_accel_base * u, run: a.dash_max_velocity * u, dashFrames: TIMING[kind].dash.total,
    jumpsquat: a.jump_startup_time, jumpH: a.jump_h_initial_velocity * u, jumpHMax: a.jump_h_max_velocity * u, jumpMomentum: a.ground_to_air_jump_momentum_multiplier,
    fullHop: a.jump_v_initial_velocity * u, shortHop: a.hop_v_initial_velocity * u, jumps: a.max_jumps,
    // Multi-jumpers (Kirby, Jigglypuff) read per-jump heights from character tables the dumps do not carry (their multipliers are 0):
    // reconstructed as 90% of the ground jump, each later air jump 10% weaker, with air-drift sideways speed.
    airJumpV: a.jump_v_initial_velocity * (a.air_jump_v_multiplier || .9) * u, airJumpH: (a.air_jump_h_multiplier || a.air_drift_max) * u, airJumpDecay: a.air_jump_v_multiplier ? 0 : .1,
    gravity: a.gravity * u, terminal: a.terminal_velocity * u, fastFall: a.fast_fall_velocity * u, drift: a.air_drift_max * u, driftAccel: a.air_drift_stick_mul * u, driftBase: a.aerial_drift_base * u,
    airFriction: a.aerial_friction * u, airMax: a.air_max_horizontal_velocity * u, weight: a.weight, landing: a.normal_landing_lag, turnFrames: a.standing_turn_frames, jabWindow: a.jab_2_input_window,
    scale: a.model_scaling, shieldSize: a.initial_shield_size * a.model_scaling * u, shieldBreakVy: a.shield_break_initial_velocity * u,
    ledgeJumpH: a.ledge_jump_horizontal_velocity * u, ledgeJumpV: a.ledge_jump_vertical_velocity * u, height: info.height, radius: info.radius,
  };
  return [kind, p];
})) as Record<FighterKind, Physics>;
export const moveOf = (kind: FighterKind, move: MoveId): Move | undefined => MOVESET[kind][move];
