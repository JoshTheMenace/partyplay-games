/**
 * Authored pose library. Keys are written for the model's own frame (see pose.ts). With the fighter facing +X the
 * model's left side is away from the camera, so an orthodox stance leads with the left (far) side and opens the chest
 * toward the camera. Every roster style gets a stance; every Pose in model.ts gets a move family.
 */
import { FIGHTERS, type FighterKind, type Limb, type MoveId, type Pose } from '../../model';
import { PHYSICS, TIMING } from '../../moveset';
import type { Key } from './pose';

export type Body = 'humanoid' | 'round' | 'hand' | 'flat';
export type Grip = 'none' | 'sword' | 'hammer' | 'cannon';
export type Style = {
  kind: FighterKind; family: string; body: Body; grip: Grip; stance: Key;
  /** 0 light → 1 super heavy: slows idle, deepens squash on landing. */ heavy: number;
  /** Idle bounce amplitude and rate (fighting-game "bob"). */ bounce: number; rate: number;
  /** Runs on all fours (Pikachu, Pichu). */ quad: boolean;
  /** Double jump style. */ airJump: 'flip' | 'puff' | 'kick' | 'float';
  /** Melee speeds (m/frame) for gait sync and air poses. */ runSpeed: number; walkSpeed: number; fastFall: number; terminal: number;
  /** Action lengths in frames from the imported scripts. */ frames: { roll: number; spot: number; airdodge: number; tech: number; getup: number; climb: number; jumpsquat: number; bound: number };
};

const GRIPS: Partial<Record<FighterKind, Grip>> = { link: 'sword', 'young-link': 'sword', marth: 'sword', roy: 'sword', popo: 'hammer', nana: 'hammer', samus: 'cannon' };
const FLIPS = new Set(['plumber', 'pilot', 'brawler', 'ninja', 'child', 'sword', 'doctor', 'wire', 'rodent', 'alien']);

// ── Stances ─────────────────────────────────────────────────────────────
const FISTS: Key = {
  hips: [6, -18, 0], spine: [3, -4, 0], chest: [6, -8, 0], neck: [-4, 8, 0], head: [-3, 14, 0], root: [0, -.07, 0],
  hL: [-.1, -.12, .66], hR: [-.26, -.2, .44], eL: [.45, -.7, -.5], eR: [.55, -.8, -.4],
  fL: [.06, 0, .15], fR: [.05, 0, -.15], kL: [.3, 0, 1], kR: [.25, 0, 1],
};
const PILOT: Key = { ...FISTS, root: [0, -.12, 0], hips: [10, -22, 0], chest: [12, -8, 0], neck: [-6, 8, 0], head: [-8, 16, 0],
  hL: [-.05, -.38, .55], hR: [.08, -.6, .22], fL: [.08, 0, .2], fR: [.06, 0, -.18] };
const HEAVY: Key = { ...FISTS, root: [0, -.12, 0], hips: [10, -12, 0], chest: [16, -4, 0], neck: [-10, 4, 0], head: [-12, 8, 0],
  hL: [.12, -.5, .5], hR: [.08, -.55, .36], eL: [.8, -.4, -.4], eR: [.8, -.4, -.4], fL: [.16, 0, .12], fR: [.16, 0, -.14], kL: [.55, 0, 1], kR: [.55, 0, 1] };
const ROUND: Key = { root: [0, -.04, 0], hips: [4, -10, 0], chest: [2, -4, 0], head: [-4, 8, 0],
  hL: [.45, -.35, .35], hR: [.45, -.4, .2], fL: [.1, 0, .08], fR: [.1, 0, -.08], kL: [.3, 0, 1], kR: [.3, 0, 1] };
const SWORD: Key = {
  hips: [5, 14, 0], spine: [2, 4, 0], chest: [5, 8, 0], neck: [-3, -8, 0], head: [-3, -14, 0], root: [0, -.1, 0],
  hR: [-.06, -.4, .64], hL: [.3, -.62, -.18], eR: [.3, -.8, -.3], eL: [.4, -.4, -.8], blade: [0, .4, 1], bw: 1,
  fL: [.05, 0, -.17], fR: [.05, 0, .19], kL: [.25, 0, 1], kR: [.2, 0, 1],
};
const NINJA: Key = { root: [0, -.2, 0], hips: [16, -26, 0], spine: [4, -4, 0], chest: [14, -8, 0], neck: [-8, 10, 0], head: [-14, 16, 0],
  hL: [-.1, -.22, .62], hR: [.1, -.46, .3], eL: [.5, -.6, -.5], eR: [.6, -.6, -.4], fL: [.14, 0, .24], fR: [.12, 0, -.24], kL: [.45, 0, 1], kR: [.4, 0, 1], tR: 20 };
const TINY: Key = { ...FISTS, root: [0, -.06, 0], hips: [4, -10, 0], chest: [2, -4, 0], head: [-6, 8, 0], hL: [.2, -.4, .45], hR: [.28, -.45, .3], fL: [.06, 0, .1], fR: [.06, 0, -.1] };
const ROYAL: Key = { root: [0, -.02, 0], hips: [0, -8, 0], chest: [-3, -6, 0], neck: [2, 4, 0], head: [2, 10, 0],
  hL: [-.28, -.72, .34], hR: [-.3, -.74, .3], eL: [.9, -.3, -.2], eR: [.9, -.3, -.2], fL: [.0, 0, .05], fR: [.03, 0, -.06], kL: [.1, 0, 1], kR: [.1, 0, 1], tR: 10 };
const HAMMER: Key = { ...FISTS, root: [0, -.1, 0], hips: [6, -14, 0], chest: [8, -6, 0],
  hR: [-.12, -.38, .55], hL: [-.3, -.34, .5], eL: [.6, -.6, -.4], eR: [.6, -.6, -.4], blade: [0, .95, .15], bw: 1 };
const RODENT: Key = { root: [0, -.14, 0], hips: [22, -12, 0], chest: [18, -4, 0], neck: [-14, 4, 0], head: [-18, 10, 0],
  hL: [-.08, -.3, .45], hR: [-.02, -.36, .38], eL: [.4, -.8, -.3], eR: [.4, -.8, -.3], fL: [.1, 0, .1], fR: [.1, 0, -.12], kL: [.4, 0, 1], kR: [.4, 0, 1] };
const CANNON: Key = { ...FISTS, root: [0, -.1, 0], hips: [6, -22, 0], chest: [6, -14, 0], head: [-4, 18, 0],
  hR: [-.08, -.42, .66], hL: [.28, -.72, .14], eR: [.3, -.9, -.2], eL: [.6, -.5, -.6], fL: [.1, 0, .18], fR: [.1, 0, -.16] };
const DINO: Key = { root: [0, -.12, 0], hips: [20, -10, 0], chest: [12, 0, 0], neck: [-10, 4, 0], head: [-18, 6, 0],
  hL: [.05, -.38, .42], hR: [.05, -.42, .32], eL: [.5, -.7, -.4], eR: [.5, -.7, -.4], fL: [.08, 0, .1], fR: [.08, 0, -.1], kL: [.4, 0, 1], kR: [.4, 0, 1] };
const FLOAT: Key = { root: [0, -.03, 0], hips: [2, -16, 0], chest: [-2, -8, 0], neck: [0, 6, 0], head: [-2, 12, 0],
  hL: [.5, -.62, .22], hR: [.46, -.66, .1], eL: [.6, -.3, -.7], eR: [.6, -.3, -.7], fL: [.04, 0, .08], fR: [.03, 0, -.06], tL: 15, tR: 20 };
const FLAT: Key = { root: [0, -.05, 0], hips: [0, 0, 0], chest: [0, 0, 0], head: [-6, 0, 0], hL: [.12, -.35, .5], hR: [.18, -.45, .4], eL: [.3, -.8, -.4], eR: [.3, -.8, -.4],
  fL: [.02, 0, .1], fR: [.02, 0, -.1] };
const HAND: Key = { root: [0, 0, 0], hips: [0, 0, 0], curl: .08 };
const BAG: Key = { root: [0, -.02, 0], hL: [.35, -.85, .05], hR: [.35, -.85, .05], chest: [-2, 0, 0] };
const STANCES: Record<string, Key> = { plumber: FISTS, doctor: FISTS, brawler: FISTS, wire: FISTS, pilot: PILOT, heavy: HEAVY, round: ROUND, sword: SWORD,
  ninja: NINJA, child: TINY, royal: ROYAL, climber: HAMMER, rodent: RODENT, armored: CANNON, dinosaur: DINO, alien: FLOAT, flat: FLAT, hand: HAND, bag: BAG };

const styles = new Map<FighterKind, Style>();
export function styleOf(kind: FighterKind): Style {
  let s = styles.get(kind);
  if (s) return s;
  const f = FIGHTERS[kind], p = PHYSICS[kind], tm = TIMING[kind], family = f.style as string;
  const body: Body = family === 'round' ? 'round' : family === 'hand' ? 'hand' : family === 'flat' ? 'flat' : 'humanoid';
  const heavy = Math.max(0, Math.min(1, (p.weight - 95) / 30));
  const bounce = { pilot: 1.3, plumber: 1.1, doctor: .9, child: 1.2, rodent: 1.3, round: 1.2, ninja: .8, brawler: .9, wire: .9 }[family] ?? .6;
  s = {
    kind, family, body, grip: GRIPS[kind] ?? 'none', stance: STANCES[family] ?? FISTS, heavy, bounce: bounce * (1 - heavy * .4), rate: 1 + (bounce - .8) * .5 - heavy * .3,
    quad: family === 'rodent', airJump: body === 'round' ? 'puff' : family === 'royal' || family === 'alien' ? 'float' : FLIPS.has(family) ? 'flip' : 'kick',
    runSpeed: p.run, walkSpeed: p.walk, fastFall: p.fastFall, terminal: p.terminal,
    frames: { roll: tm.rollF.total, spot: tm.spotdodge.total, airdodge: tm.airdodge.total, tech: tm.tech.total, getup: tm.getup.total, climb: tm.climb.total, jumpsquat: p.jumpsquat, bound: tm.bound.total },
  };
  styles.set(kind, s);
  return s;
}

// ── Airborne bases, mixed by vertical speed ─────────────────────────────
export const AIR_RISE: Key = { hips: [-4, -8, 0], chest: [-6, -4, 0], head: [-8, 8, 0], hL: [.25, .35, .3], hR: [.35, .15, .05], fL: [.05, .2, -.05], fR: [.05, .38, -.28], kL: [.2, 0, 1], kR: [.2, 0, 1], squash: .08, tL: 35, tR: 45 };
export const AIR_APEX: Key = { hips: [10, -8, 0], chest: [8, -4, 0], head: [-10, 8, 0], hL: [.2, -.35, .5], hR: [.35, -.4, .35], fL: [.05, .45, .22], fR: [.05, .34, .02], kL: [.2, 0, 1], kR: [.2, 0, 1], tL: 25, tR: 25 };
export const AIR_FALL: Key = { hips: [-4, -8, 0], chest: [-8, -4, 0], head: [6, 8, 0], hL: [.6, .28, .1], hR: [.65, .12, -.05], fL: [.05, .1, .14], fR: [.05, .22, -.1], kL: [.2, 0, 1], kR: [.2, 0, 1], squash: .03, tL: 15, tR: 20 };
export const FAST_FALL: Key = { hips: [-2, -6, 0], chest: [-6, -4, 0], head: [10, 6, 0], hL: [.5, .7, .1], hR: [.55, .6, 0], fL: [.03, .02, .06], fR: [.03, .06, -.05], kL: [.1, 0, 1], kR: [.1, 0, 1], squash: .12, tL: 45, tR: 45 };
export const HELPLESS: Key = { hips: [-10, 0, 0], chest: [-14, 0, 0], neck: [10, 0, 0], head: [16, 0, 0], hL: [.4, .75, -.1], hR: [.45, .7, -.15], fL: [.06, .1, .1], fR: [.06, .2, -.12], kL: [.2, 0, 1], kR: [.2, 0, 1], tL: 30, tR: 30 };

/**
 * A move family: wind is reached by the end of startup, strike holds through the active frames (optionally a function
 * of active progress u and seconds s), follow is the early recovery, then the move settles back into its base.
 * side names the limb the keys strike with; a table limb on the other side mirrors the keys. ik: false skips hit aiming.
 */
export type Family = { wind: Key; strike: Key | ((u: number, s: number) => Key); follow?: Key; side?: Limb; ik?: false; air?: boolean; /** Wind-up overshoot (default grows with startup length). */ coil?: number };
const up = (u: number) => Math.sin(Math.min(1, Math.max(0, u)) * Math.PI);
const ramp = (u: number, k = 1.4) => Math.min(1, u * k);
const guardR: Key = { hR: [-.3, -.14, .5] }, guardL: Key = { hL: [-.14, -.05, .6] };
const armsOut: Key = { hL: [.55, -.1, .15], hR: [.55, -.15, .05] };
const tuck: Key = { fL: [.05, .45, .2], fR: [.05, .38, 0], kL: [.2, .2, 1], kR: [.2, .2, 1], tL: 30, tR: 30 };

/**
 * Sword arcs stay in the body's sagittal plane (up ↔ forward ↔ back) with small torso yaw: the model is not mirrored by
 * facing, so lateral components would turn the swing into the screen on one side.
 */
const swordSlash = (hi: number, lo: number): Family => ({ side: 'weapon',
  wind: { hR: [0, .85, -.25], eR: [.5, .2, -.8], blade: [0, .72, -.7], chest: [-12, -6, 0], hips: [0, -4, 0], head: [-6, 4, 0], root: [0, -.08, -.05], hL: [-.2, -.2, .5] },
  strike: u => ({ hR: [-.1, hi - (hi - lo) * u, .96], blade: [0, hi + .45 - (hi - lo + .9) * u, 1], chest: [16, 8, 0], hips: [8, 6, 0], root: [0, -.15, .16], hL: [.4, -.5, -.3], fR: [.05, 0, .3], fL: [.05, 0, -.28] }),
  follow: { hR: [0, lo - .2, .7], blade: [0, -.75, .6], chest: [20, 8, 0] } });

export const FAMILIES: Record<Pose, Family> = {
  jab: { side: 'handL', wind: { hL: [-.1, -.08, .42], chest: [4, -14, 0], ...guardR },
    strike: { hL: [-.1, .02, 1], chest: [8, -34, 0], hips: [8, -26, 0], head: [-3, 28, 0], root: [0, -.09, .06], ...guardR }, follow: { hL: [-.12, -.04, .72] } },
  'jab-cross': { side: 'handR', wind: { hR: [-.22, -.1, .32], chest: [4, -28, 0], ...guardL },
    strike: { hR: [-.2, .02, 1], hL: [-.2, -.2, .4], chest: [10, 28, 0], hips: [10, 16, 0], head: [-4, -20, 0], root: [0, -.1, .12], fR: [.05, .04, -.2], tR: 25 }, follow: { hR: [-.2, -.05, .72] } },
  'jab-finisher': { side: 'handR', wind: { hR: [.12, -.1, -.25], hL: [-.1, -.1, .5], chest: [-6, -38, 0], hips: [0, -28, 0], root: [0, -.14, -.06] },
    strike: { hR: [-.12, .05, 1.05], hL: [.25, -.45, -.25], chest: [16, 38, 0], hips: [14, 28, 0], head: [-6, -28, 0], root: [0, -.17, .24], fL: [.06, 0, .32], fR: [.05, 0, -.36], tR: 30 },
    follow: { hR: [-.1, 0, .86], chest: [10, 24, 0], root: [0, -.14, .16] } },
  'jab-rapid': { side: 'handL', wind: { hL: [-.1, -.08, .5], hR: [-.2, -.1, .45], chest: [8, 0, 0], root: [0, -.1, 0] },
    strike: (u, s) => { const a = .5 + .5 * Math.sin(s * Math.PI * 2 * 7); return { hL: [-.12, .02 - .1 * a, .5 + .5 * (1 - a)], hR: [-.22, .02 - .1 * (1 - a), .5 + .5 * a], chest: [10, 16 * (a - .5), 0], head: [-4, -8 * (a - .5), 0], root: [0, -.12, .06] }; } },
  'kick-front': { side: 'footR', wind: { fR: [.04, .42, -.02], kR: [.2, .3, 1], chest: [-2, 0, 0], ...armsOut },
    strike: { fR: [.03, .72, .96], kR: [.1, 1, .3], hips: [-12, 20, 0], chest: [-14, 8, 0], head: [8, -12, 0], hL: [.35, -.05, .35], hR: [.45, -.25, -.3], tR: -10 },
    follow: { fR: [.04, .35, .3] } },
  'kick-high': { side: 'footR', wind: { fR: [.04, .5, 0], kR: [.2, .4, 1], hips: [0, 10, 0], ...armsOut },
    strike: { fR: [.02, 1.16, .66], kR: [.1, 1, .2], hips: [-22, 26, 0], chest: [-24, 10, 0], head: [16, -10, 0], root: [0, -.03, -.06], hL: [.5, .1, .3], hR: [.6, -.2, -.3], tR: -15 },
    follow: { fR: [.04, .45, .3], chest: [-10, 6, 0] } },
  'kick-low': { side: 'footR', wind: { fR: [.04, .25, -.1], root: [0, -.12, 0] },
    strike: { fR: [.06, .18, .84], root: [0, -.22, 0], hips: [2, 16, 0], chest: [10, 6, 0], hL: [.2, -.3, .5], hR: [.4, -.5, -.1], tR: -8 }, follow: { fR: [.05, .1, .3] } },
  sweep: { side: 'footR', wind: { root: [0, -.44, 0], hips: [30, -20, 0], chest: [20, -10, 0], fL: [.16, 0, .14], fR: [.1, .05, -.25], hL: [.1, -1, .45], hR: [.2, -.95, .2] },
    strike: u => ({ root: [0, -.48, 0], hips: [34, 10, 0], chest: [22, 6, 0], fL: [.2, 0, .1], fR: [.3, .02, .95], kR: [0, 1, .2], hL: [.1, -1, .5], hR: [.25, -.9, .1], yaw: -40 * up(u) }),
    follow: { root: [0, -.32, 0] } },
  uppercut: { side: 'handR', wind: { root: [0, -.26, 0], chest: [22, -22, 0], hips: [16, -12, 0], hR: [-.05, -.78, .25], ...guardL },
    strike: u => ({ hR: [-.18, .6 + .4 * up(ramp(u, 1.5)), .3], chest: [-14, 22, 10], hips: [-6, 12, 0], head: [-18, -10, 0], root: [0, .04, .06], fR: [.04, .06, -.12], tR: 35, squash: .07 }),
    follow: { hR: [-.12, .72, .32], chest: [-8, 16, 6] } },
  headbutt: { side: 'head', wind: { chest: [-22, 0, 0], neck: [-12, 0, 0], head: [-18, 0, 0], root: [0, -.1, -.06], hL: [.25, -.4, -.3], hR: [.25, -.45, -.35] },
    strike: { chest: [36, 0, 0], neck: [14, 0, 0], head: [24, 0, 0], root: [0, -.13, .2], hL: [.35, -.6, -.4], hR: [.35, -.6, -.45], fR: [.05, 0, -.3] }, follow: { chest: [20, 0, 0] } },
  shoulder: { side: 'body', wind: { chest: [4, -46, 0], hips: [0, -30, 0], root: [0, -.18, -.08], hL: [-.3, -.45, .2], hR: [-.25, -.3, .3] },
    strike: { chest: [16, -62, 0], hips: [8, -40, 0], head: [-10, 50, 0], root: [0, -.15, .3], hL: [-.35, -.5, .15], hR: [-.3, -.3, .3], fL: [.06, 0, .42], fR: [.05, 0, -.36], tR: 25 } },
  stomp: { side: 'footR', wind: { fR: [.05, .55, .16], kR: [.3, .1, 1], chest: [8, 0, 0], ...armsOut, root: [0, -.02, 0] },
    strike: { fR: [.05, -.02, .24], root: [0, -.2, 0], chest: [18, 0, 0], squash: -.08, hL: [.6, -.3, .2], hR: [.6, -.35, .1] }, follow: { root: [0, -.14, 0] } },
  'overhead-slam': { side: 'handR', wind: { hL: [-.2, 1, -.12], hR: [-.2, 1, -.12], eL: [.6, .2, -1], eR: [.6, .2, -1], chest: [-18, 0, 0], head: [-10, 0, 0], root: [0, 0, -.05], squash: .07 },
    strike: { hL: [-.3, -.62, .82], hR: [-.3, -.6, .82], chest: [42, 0, 0], neck: [-10, 0, 0], head: [-18, 0, 0], root: [0, -.28, .1], squash: -.1 },
    follow: { chest: [30, 0, 0], root: [0, -.2, .06] } },
  spin: { side: 'footR', ik: false, wind: { root: [0, -.12, 0], chest: [8, -40, 0], ...armsOut },
    strike: u => ({ yaw: 360 * u, hL: [.95, 0, .1], hR: [.95, 0, .1], fR: [.35, .55, .45], root: [0, -.02, 0], chest: [0, 0, 8] }),
    follow: { yaw: 360, ...armsOut } },
  'flip-kick': { side: 'footR', wind: { hips: [16, 0, 0], chest: [14, 0, 0], fR: [.04, .45, .2], fL: [.04, .35, 0], hL: [.3, -.3, .4], hR: [.3, -.3, .4] },
    strike: u => ({ spin: -330 * Math.min(1, u * 1.1), fR: [.03, 1.05, .45], kR: [.1, 1, .3], fL: [.05, .3, -.05], hL: [.7, 0, -.1], hR: [.7, 0, -.1], chest: [-10, 0, 0], tR: -20 }),
    follow: { spin: -360, fR: [.04, .4, .2] } },
  'dive-kick': { side: 'footR', air: true, wind: { fR: [.04, .45, .15], fL: [.05, .4, .05], chest: [-8, 0, 0], hL: [.4, .3, .1], hR: [.4, .3, .1] },
    strike: { fR: [.05, -.24, .78], fL: [.05, .42, .06], chest: [18, 0, 0], head: [-10, 0, 0], lean: 25, hL: [.45, .4, -.25], hR: [.45, .35, -.3], tR: 40 } },
  knee: { side: 'footR', wind: { fR: [.04, .3, -.1], chest: [-4, 0, 0], hL: [.3, -.1, .3], hR: [.3, -.1, .3] },
    strike: { fR: [.03, .78, .32], kR: [0, .6, 1], chest: [-12, 10, 0], hips: [-18, 14, 0], hL: [.55, .1, .1], hR: [.6, .05, -.1], fL: [.05, .1, -.18], tR: 30 },
    follow: { fR: [.04, .45, .2] } },
  drill: { side: 'footR', ik: false, air: true, wind: { fL: [0, .35, .2], fR: [0, .35, .2], chest: [10, 0, 0], hL: [-.3, -.2, .3], hR: [-.3, -.2, .3] },
    strike: u => ({ yaw: 1080 * u, lean: 35, fL: [-.02, -.3, .16], fR: [-.02, -.3, .16], kL: [0, 0, 1], kR: [0, 0, 1], hL: [-.35, -.25, .3], hR: [-.35, -.25, .3], chest: [8, 0, 0], squash: .1, tL: 60, tR: 60 }) },
  clap: { side: 'handR', wind: { hL: [.9, .1, .15], hR: [.9, .1, .15], chest: [-6, 0, 0], root: [0, -.08, 0] },
    strike: { hL: [-.32, .12, .9], hR: [-.32, .1, .9], chest: [10, 0, 0], root: [0, -.1, .08] } },
  'dash-attack': { side: 'footR', wind: { chest: [20, 0, 0], root: [0, -.12, 0], hL: [.3, -.2, -.4], hR: [.3, -.2, -.4] },
    strike: { fR: [.05, .58, .84], fL: [.05, .4, -.2], chest: [-12, 10, 0], hips: [-10, 14, 0], lift: .16, hL: [.35, .25, -.35], hR: [.4, .2, -.45], tR: -10 },
    follow: { lift: .06, chest: [6, 0, 0] } },
  slide: { side: 'footR', wind: { root: [0, -.2, 0], chest: [16, 0, 0], hL: [.3, -.3, -.3], hR: [.3, -.3, -.3] },
    strike: { root: [0, -.5, -.1], hips: [-24, 10, 0], chest: [-18, 6, 0], head: [16, 0, 0], fR: [.06, .22, 1.02], kR: [0, 1, .2], fL: [.12, .08, -.18], kL: [.3, 1, .3], hL: [.3, -1, -.35], hR: [.35, -1, -.4], tR: -20 },
    follow: { root: [0, -.4, 0] } },
  'body-slam': { side: 'body', wind: { root: [0, -.25, -.06], chest: [18, 0, 0], hL: [.4, .4, -.2], hR: [.4, .4, -.2], squash: -.08 },
    strike: u => ({ spin: 40 + 50 * u, lift: .25 * up(u), root: [0, -.05, .25], hL: [.2, -.1, .9], hR: [.2, -.1, .9], fL: [.05, .5, -.4], fR: [.05, .6, -.5], squash: .06 }),
    follow: { spin: 10, root: [0, -.3, .1], squash: -.1 } },
  'palm-thrust': { side: 'handL', wind: { hL: [.05, .1, .1], chest: [0, 20, 0], hips: [0, 12, 0], root: [0, -.12, -.04], ...guardR },
    strike: { hL: [-.05, .1, 1.02], eL: [.3, -1, -.2], chest: [10, -40, 0], hips: [8, -26, 0], head: [-4, 30, 0], root: [0, -.16, .18], fL: [.06, 0, .3], fR: [.05, 0, -.3], hR: [.1, -.5, -.2] },
    follow: { hL: [-.05, .05, .8] } },
  elbow: { side: 'handR', wind: { hR: [.1, -.1, .1], chest: [0, -30, 0], ...guardL },
    strike: { hR: [-.5, .12, .28], eR: [.1, .2, 1], chest: [10, 40, 0], hips: [6, 24, 0], head: [-4, -20, 0], root: [0, -.12, .14], hL: [-.2, -.2, .3] } },
  'hip-check': { side: 'body', wind: { yaw: 30, root: [0, -.14, 0], chest: [8, 20, 0], hL: [.4, .2, .3], hR: [.4, .2, .3] },
    strike: { yaw: 70, root: [-.18, -.1, .28], hips: [0, 40, -12], chest: [-10, 10, 10], hL: [.7, .5, .2], hR: [.7, .45, .1], fL: [.12, 0, .2], fR: [.12, 0, -.2] } },
  'sword-slash': swordSlash(.1, -.45),
  'sword-rising': { side: 'weapon', wind: { hR: [.12, -.75, -.2], blade: [0, -.6, -.8], chest: [16, -10, 0], root: [0, -.2, 0] },
    strike: u => ({ hR: [-.06, -.2 + 1.2 * ramp(u), .3], blade: [0, -.2 + 1.3 * ramp(u), .9 - .8 * u], chest: [-12, 10, 0], head: [-16, 0, 0], root: [0, .02, .04], squash: .06, tR: 30 }),
    follow: { hR: [-.05, .9, .1], blade: [0, 1, -.2] } },
  'sword-low': { side: 'weapon', wind: { hR: [.3, -.3, -.2], blade: [.2, -.2, -1], root: [0, -.3, 0], hips: [24, -20, 0] },
    strike: { hR: [-.02, -.72, .92], blade: [0, -.18, 1], root: [0, -.36, .1], hips: [28, 10, 0], chest: [16, 10, 0], fL: [.14, 0, -.2], fR: [.12, 0, .3] } },
  'sword-thrust': { side: 'weapon', wind: { hR: [.08, -.12, .12], blade: [0, 0, 1], chest: [-4, -20, 0], root: [0, -.12, -.08] },
    strike: { hR: [-.08, -.04, 1.05], blade: [0, -.05, 1], chest: [12, 24, 0], hips: [10, 18, 0], head: [-6, -18, 0], root: [0, -.16, .28], fR: [.05, 0, .4], fL: [.05, 0, -.38], hL: [.45, -.3, -.4] } },
  'sword-overhead': { side: 'weapon', wind: { hR: [-.06, 1, -.18], blade: [0, .3, -1], chest: [-16, 0, 0], head: [-10, 0, 0], squash: .05 },
    strike: { hR: [-.1, -.12, .9], blade: [0, -.55, 1], chest: [26, 10, 0], root: [0, -.16, .1], squash: -.05 }, follow: { blade: [0, -.8, .6] } },
  'sword-spin': { side: 'weapon', ik: false, wind: { hR: [.6, 0, -.3], blade: [.8, 0, -.4], chest: [0, -40, 0], root: [0, -.12, 0] },
    strike: u => ({ yaw: 360 * u, hR: [.95, 0, .15], blade: [1, .05, .1], hL: [.8, 0, .1], chest: [0, 0, 6] }), follow: { yaw: 360 } },
  'sword-down-stab': { side: 'weapon', air: true, wind: { hR: [-.1, .5, .2], blade: [0, 1, .1], chest: [-10, 0, 0], ...tuck },
    strike: { hR: [-.2, -.72, .32], hL: [-.3, -.6, .3], blade: [0, -1, .08], chest: [18, 0, 0], head: [12, 0, 0], fL: [.05, .5, .12], fR: [.05, .3, -.1], squash: .06 } },
  'hammer-swing': { side: 'weapon', wind: { hR: [.2, .6, -.4], hL: [.05, .55, -.35], blade: [.1, .9, -.4], chest: [-10, -36, 0], hips: [0, -16, 0], root: [0, -.08, -.06] },
    strike: u => ({ hR: [-.18, .2 - .6 * u, .95], hL: [-.34, .16 - .6 * u, .9], blade: [0, .7 - 1.4 * u, 1], chest: [16, 32, 0], hips: [8, 20, 0], root: [0, -.16, .16], fL: [.06, 0, .3], fR: [.05, 0, -.3] }),
    follow: { hR: [-.1, -.5, .7], hL: [-.28, -.5, .66], blade: [0, -.8, .5], chest: [22, 28, 0] } },
  'hammer-overhead': { side: 'weapon', wind: { hR: [-.15, 1, -.25], hL: [-.3, .98, -.2], blade: [0, .3, -1], chest: [-20, 0, 0], head: [-12, 0, 0], squash: .08 },
    strike: { hR: [-.2, -.25, .9], hL: [-.34, -.28, .86], blade: [0, -.7, 1], chest: [34, 0, 0], root: [0, -.22, .1], squash: -.1 }, follow: { blade: [0, -.9, .4], chest: [26, 0, 0] } },
  'item-swing': { side: 'handR', wind: { hR: [.35, .45, -.35], chest: [-4, -30, 0], hL: [-.2, -.2, .5], blade: [.2, .8, -.5] },
    strike: u => ({ hR: [-.15, .3 - .5 * u, .95], blade: [0, .6 - 1.1 * u, 1], chest: [12, 26, 0], hips: [6, 14, 0], root: [0, -.12, .12], hL: [.3, -.5, -.2] }), follow: { hR: [-.05, -.35, .7] } },
  'staff-swing': { side: 'weapon', wind: { hR: [.3, .4, -.3], blade: [.2, .7, -.7], hL: [-.1, .2, .1], chest: [-6, -26, 0] },
    strike: u => ({ hR: [-.1, .15 - .3 * u, .92], blade: [0, .4 - .7 * u, 1], hL: [-.4, -.1, .55], chest: [12, 26, 0], root: [0, -.12, .12] }) },
  'cast-forward': { side: 'handL', wind: { hL: [-.15, -.55, .1], hR: [-.1, -.5, .05], chest: [-6, -26, 0], root: [0, -.12, -.04] },
    strike: { hL: [-.2, .02, 1], hR: [-.3, -.02, .9], chest: [8, -12, 0], root: [0, -.12, .12], fR: [.05, 0, -.26], squash: .03 }, follow: { hL: [-.2, 0, .8], hR: [-.3, -.05, .7] } },
  'cast-up': { side: 'handL', wind: { hL: [-.2, -.55, .3], hR: [-.2, -.55, .25], root: [0, -.2, 0], chest: [14, 0, 0] },
    strike: { hL: [-.22, 1, .18], hR: [-.25, .98, .12], chest: [-14, 0, 0], head: [-22, 0, 0], squash: .08 } },
  'cast-down': { side: 'handL', wind: { hL: [-.2, .8, .1], hR: [-.2, .8, .1], chest: [-12, 0, 0] },
    strike: { hL: [-.2, -.72, .62], hR: [-.25, -.72, .6], chest: [28, 0, 0], head: [10, 0, 0], root: [0, -.2, .06], squash: -.05 } },
  'cast-around': { side: 'handL', ik: false, wind: { hL: [-.3, -.3, .35], hR: [-.3, -.3, .35], root: [0, -.2, 0], chest: [16, 0, 0] },
    strike: u => ({ hL: [.95, .1, .1], hR: [.95, .1, .1], chest: [-8, 0, 0], head: [-10, 0, 0], yaw: 180 * u, squash: .05 }) },
  // Side-on shooting stance: with the torso ~80° off the model's forward, the gun arm reaches across the chest along the screen.
  'gun-shoot': { side: 'handR', wind: { hR: [-.3, -.3, .5], hL: [.3, -.3, .3], chest: [2, -40, 0], hips: [0, -26, 0], head: [-4, 30, 0], root: [0, -.12, 0] },
    strike: u => ({ hR: [-.85 + .1 * up(ramp(u, 3)), .06 + .08 * up(ramp(u, 3)), .4], eR: [.2, -1, 0], hL: [.3, -.5, .1], chest: [-4 - 8 * up(ramp(u, 3)), -48, 0], hips: [0, -32, 0], neck: [0, 20, 0], head: [-4, 26, 0], root: [0, -.12, -.06 * up(ramp(u, 3))] }),
    follow: { hR: [-.1, 0, .9] } },
  'blaster-draw': { side: 'handR', wind: { hR: [.2, -.8, -.1], chest: [4, -20, 0], root: [0, -.1, 0] },
    strike: u => ({ hR: [-.15, -.06 + .04 * Math.sin(u * 30), .98], eR: [.2, -1, 0], hL: [.3, -.5, -.1], chest: [0, 30, 0], hips: [0, 16, 0], head: [-4, -26, 0], root: [0, -.12, -.04] }),
    follow: { hR: [.1, -.6, .1] } },
  rush: { side: 'handL', wind: { chest: [18, -20, 0], root: [0, -.2, -.08], hL: [-.1, -.1, .4], hR: [.2, -.4, -.3] },
    strike: u => ({ chest: [30, -24, 0], hips: [20, -14, 0], head: [-26, 20, 0], root: [0, -.14, .2], hL: [-.1, .02, 1], hR: [.3, -.3, -.45], fL: [.05, .1 + .2 * up(u * 4), .35], fR: [.05, .3, -.42], tR: 30 }) },
  rise: { side: 'handR', wind: { root: [0, -.3, 0], chest: [20, 0, 0], hR: [-.1, -.7, .3], hL: [.3, -.4, .2], squash: -.1 },
    strike: u => ({ hR: [-.1, 1, .15], hL: [.4, -.2, .2], chest: [-12, 0, 8], head: [-20, 0, 0], fL: [.05, .35, .1], fR: [.05, .15, -.1], squash: .12 - .06 * u, tL: 40, tR: 40, yaw: 30 * up(u) }),
    follow: { hR: [-.1, .85, .2], squash: .04 } },
  'rise-spin': { side: 'handR', ik: false, wind: { root: [0, -.26, 0], chest: [12, -30, 0], ...armsOut, squash: -.08 },
    strike: u => ({ yaw: 1080 * u, hL: [.95, .25, 0], hR: [.95, .3, 0], chest: [-6, 0, 0], head: [-12, 0, 0], fL: [.05, .3, 0], fR: [.05, .15, 0], squash: .1 }), follow: { yaw: 1080 } },
  teleport: { side: 'body', ik: false, wind: { root: [0, -.24, 0], squash: -.18, hL: [-.4, -.3, .3], hR: [-.4, -.3, .3], chest: [14, 0, 0] },
    strike: u => ({ squash: .5 * up(u), fade: up(Math.min(1, u * 1.2)) > .3 ? 1 : 0, root: [0, .05, 0], hL: [-.1, .9, 0], hR: [-.1, .9, 0] }), follow: { squash: -.1, root: [0, -.2, 0], fade: 0 } },
  counter: { side: 'weapon', ik: false, wind: { root: [0, -.16, -.04], chest: [8, -30, 0], hL: [-.42, -.08, .5], hR: [-.35, 0, .45], eL: [1, -.3, -.3], eR: [1, -.3, -.3], blade: [0, 1, .2] },
    strike: { root: [0, -.18, -.06], chest: [6, -34, 0], hL: [-.45, -.05, .52], hR: [-.38, .04, .46], eL: [1, -.3, -.3], eR: [1, -.3, -.3], head: [-6, 30, 0], blade: [0, 1, .2] },
    follow: { root: [0, -.14, .2], chest: [14, 30, 0], hR: [-.1, .05, 1], hL: [.3, -.4, -.2], blade: [0, 0, 1] } },
  reflect: { side: 'handL', ik: false, wind: { hL: [-.2, -.2, .4], hR: [-.2, -.2, .4], root: [0, -.12, 0] },
    strike: (u, s) => ({ hL: [-.2, -.05, .5], hR: [-.25, -.1, .45], eL: [.8, -.3, -.3], eR: [.8, -.3, -.3], chest: [10, 0, 0], head: [-8, 0, 0], root: [0, -.2, -.03], squash: -.05, yaw: 6 * Math.sin(s * 40) }) },
  'charge-hold': { side: 'handL', ik: false, wind: { hL: [-.35, -.42, .32], hR: [-.3, -.45, .25], chest: [10, -30, 0], root: [0, -.2, -.04], squash: -.05 },
    strike: { hL: [-.2, 0, .98], hR: [-.3, 0, .9], chest: [8, -10, 0], root: [0, -.12, .12], squash: .04 } },
  hover: { side: 'body', ik: false, wind: { hL: [-.1, .9, 0], hR: [-.1, .9, 0], root: [0, -.1, 0] },
    strike: u => ({ yaw: 1440 * u, hL: [-.08, 1, .05], hR: [-.08, 1, .05], fL: [.05, .1, .05], fR: [.05, .16, -.05], chest: [-4, 0, 0], squash: .05 }) },
  'roll-ball': { side: 'body', ik: false, wind: { root: [0, -.3, 0], chest: [30, 0, 0], head: [20, 0, 0], hL: [-.2, -.5, .4], hR: [-.2, -.5, .4], squash: -.12 },
    strike: (u, s) => ({ spin: s * 900 % 360, root: [0, -.25, 0], chest: [40, 0, 0], head: [30, 0, 0], hL: [-.3, -.6, .45], hR: [-.3, -.6, .45], ...tuck, fL: [.05, .5, .35], fR: [.05, .5, .3], squash: -.08 }),
    follow: { spin: 0 } },
  inflate: { side: 'body', ik: false, wind: { root: [0, -.1, 0], hL: [.6, .1, .1], hR: [.6, .1, .1], squash: -.1 },
    strike: (u, s) => ({ squash: .08 * Math.sin(s * 24), hL: [.8, .3, 0], hR: [.8, .3, 0], lift: .06 * up(u), chest: [-10, 0, 0] }) },
  transform: { side: 'body', ik: false, wind: { root: [0, -.2, 0], hL: [-.2, .9, .1], hR: [-.2, .9, .1], chest: [-14, 0, 0], head: [-20, 0, 0] },
    strike: u => ({ yaw: 720 * u, fade: up(u) > .5 ? .7 : 0, squash: .14 * up(u), hL: [-.1, 1, 0], hR: [-.1, 1, 0], lift: .1 * up(u) }), follow: { yaw: 720 } },
  grab: { side: 'handR', ik: false, wind: { hL: [-.1, -.3, .3], hR: [-.1, -.3, .3], chest: [4, 0, 0] },
    strike: { hL: [-.24, -.05, 1], hR: [-.26, -.06, 1], chest: [18, -4, 0], root: [0, -.12, .16] }, follow: { hL: [-.28, -.1, .66], hR: [-.3, -.1, .66] } },
  pummel: { side: 'handR', wind: { hR: [-.2, -.1, .3], hL: [-.28, -.1, .66] },
    strike: { hR: [-.3, -.02, .82], hL: [-.28, -.1, .66], chest: [14, 10, 0], head: [8, 0, 0] } },
  'throw-forward': { side: 'handR', ik: false, wind: { hL: [-.3, -.1, .45], hR: [-.3, -.1, .45], chest: [-6, 0, 0], root: [0, -.12, -.08] },
    strike: { hL: [-.2, .06, 1.05], hR: [-.22, .04, 1.05], chest: [22, 0, 0], root: [0, -.14, .2], fR: [.05, 0, -.36] } },
  'throw-back': { side: 'handR', ik: false, wind: { hL: [-.3, -.1, .5], hR: [-.3, -.1, .5], chest: [0, -20, 0] },
    strike: u => ({ yaw: 180 * Math.min(1, u * 1.3), hL: [.4, .2, .8], hR: [.4, .2, .8], chest: [-10, 40, 0], root: [0, -.1, -.1] }), follow: { yaw: 180 } },
  'throw-up': { side: 'handR', ik: false, wind: { hL: [-.3, -.5, .4], hR: [-.3, -.5, .4], root: [0, -.24, 0], chest: [16, 0, 0] },
    strike: { hL: [-.24, 1, .2], hR: [-.26, 1, .2], chest: [-14, 0, 0], head: [-24, 0, 0], squash: .08 } },
  'throw-down': { side: 'handR', ik: false, wind: { hL: [-.24, .8, .2], hR: [-.26, .8, .2], chest: [-12, 0, 0] },
    strike: { hL: [-.25, -.8, .7], hR: [-.26, -.8, .7], chest: [38, 0, 0], root: [0, -.28, .08], squash: -.08 } },
  'ledge-attack': { side: 'footR', wind: { root: [0, -.35, 0], hips: [30, 0, 0], hL: [0, -1, .45], hR: [0, -1, .4], fR: [.05, .1, -.2] },
    strike: { root: [0, -.38, 0], hips: [24, 20, 0], fR: [.1, .2, .95], kR: [0, 1, .2], hL: [0, -1, .3], hR: [.2, -.95, .1] }, follow: { root: [0, -.25, 0] } },
  'getup-attack': { side: 'footR', ik: false, wind: { root: [0, -.5, 0], hips: [34, 0, 0], hL: [.1, -1, .2], hR: [.2, -1, 0], fL: [.2, 0, .2], fR: [.1, .1, -.3] },
    strike: u => ({ root: [0, -.5, 0], hips: [36, 0, 0], yaw: 360 * u, fR: [.4, .12, .85], fL: [.25, 0, .1], hL: [.1, -1, .2], hR: [.3, -.95, 0] }), follow: { root: [0, -.3, 0], yaw: 360 } },
  taunt: { side: 'body', ik: false, wind: {}, strike: {} },
};

// ── Signature motions: fighter × move families beyond the shared Pose vocabulary ──
/** Bow: the bow arm (left) points along the shot, the near hand draws the string to the cheek; release snaps the hand back. */
const BOW: Family = { side: 'body', ik: false, coil: .02,
  wind: { hL: [.86, .12, .5], eL: [.2, -.6, -.6], hR: [-.5, .14, 0], eR: [-.2, .2, -1], chest: [-2, -60, 0], hips: [2, -40, 0], neck: [0, 22, 0], head: [-4, 36, 0], root: [0, -.12, -.02], fL: [.1, 0, .26], fR: [.08, 0, -.22], bw: 0 },
  strike: { hL: [.86, .18, .5], eL: [.2, -.6, -.6], hR: [.2, .2, -.3], eR: [-.2, .4, -1], chest: [-6, -62, 0], hips: [0, -40, 0], neck: [0, 22, 0], head: [-8, 36, 0], root: [0, -.1, -.06], fL: [.1, 0, .26], fR: [.08, 0, -.22], bw: 0 },
  follow: { hL: [.6, -.2, .5], hR: [.2, -.2, -.1] } };
/** Overhand throw with the near hand (boomerang, bomb, turnip): cock behind the head, whip forward across the body. */
const TOSS: Family = { side: 'handR',
  wind: { hR: [.55, .5, -.6], eR: [.6, .2, -.8], hL: [.2, .05, .7], chest: [-10, -40, 0], hips: [-2, -22, 0], head: [-6, 26, 0], root: [0, -.1, -.1], fL: [.08, .06, .3], fR: [.07, 0, -.2], tL: 10 },
  strike: { hR: [-.2, .12, 1.04], hL: [.35, -.5, -.3], chest: [18, 32, 0], hips: [10, 20, 0], head: [-6, -20, 0], root: [0, -.16, .2], fL: [.08, 0, .36], fR: [.05, .05, -.34], tR: 30 },
  follow: { hR: [-.15, -.45, .75], chest: [22, 28, 0] } };
/**
 * Falcon/Warlock Punch: a long turn-away coil (torso ~90° from the model's forward, where the chest's lateral axis runs
 * along the screen for either facing), fist cocked back, lead hand reaching, then a full lunge.
 */
const MEGA_PUNCH: Family = { side: 'handR',
  wind: { hR: [.85, -.25, 0], eR: [.3, -.6, -.8], hL: [.8, .12, .05], eL: [.3, -.5, -.6], chest: [-4, -60, 0], hips: [4, -40, 0], neck: [0, 30, 0], head: [-6, 44, 0], root: [0, -.22, -.12], fL: [.08, .2, .22], kL: [.3, .3, 1], fR: [.08, 0, -.2] },
  strike: { hR: [-.12, .1, 1.1], hL: [.3, -.4, -.45], chest: [20, 46, 0], hips: [12, 32, 0], head: [-8, -30, 0], root: [0, -.24, .34], fL: [.08, 0, .5], fR: [.05, 0, -.44], tR: 35, squash: .04 },
  follow: { hR: [-.1, .02, .92], chest: [14, 30, 0], root: [0, -.2, .24] } };
/** Rest: flop onto the back, fast asleep. */
const REST: Family = { side: 'body', ik: false, wind: { squash: -.12, root: [0, -.08, 0] },
  strike: { lean: -75, root: [0, -.25, 0], hL: [.5, -.2, .1], hR: [.5, -.25, .05], fL: [.1, .2, .2], fR: [.1, .15, .1], head: [-10, 0, 20], squash: -.06 },
  follow: { lean: -75, root: [0, -.25, 0], hL: [.5, -.2, .1], hR: [.5, -.25, .05], head: [-10, 0, 20] } };
const HYLIAN_SIG = { nspecial: BOW, nspecialAir: BOW, sspecial: TOSS, sspecialAir: TOSS, dspecial: TOSS, dspecialAir: TOSS };
export const SIGNATURES: Partial<Record<FighterKind, Partial<Record<MoveId, Family>>>> = {
  link: HYLIAN_SIG, 'young-link': HYLIAN_SIG,
  'captain-falcon': { nspecial: MEGA_PUNCH, nspecialAir: MEGA_PUNCH }, ganondorf: { nspecial: MEGA_PUNCH, nspecialAir: MEGA_PUNCH },
  peach: { dspecial: TOSS }, jigglypuff: { dspecial: REST, dspecialAir: REST },
};

/** Per-style taunts (roster "style" field), keyed like moves. */
const T = Math.PI * 2;
export const TAUNTS: Record<string, Family> = {
  plumber: { wind: { hR: [.2, .2, .2] }, strike: u => ({ yaw: 360 * ramp(u, 2), hR: [-.05, 1, .1], hL: [.3, -.6, .1], lift: .25 * up(ramp(u, 2)), squash: .06 * up(u), head: [-14, 0, 0] }), follow: { hR: [-.1, .9, .2] } },
  doctor: { wind: {}, strike: u => ({ hR: [-.3, .15 + .05 * Math.sin(u * T * 3), .3], hL: [-.3, -.4, .4], head: [-10, -20, 0], chest: [-6, 0, 0] }) },
  pilot: { wind: { hR: [.1, -.2, .3] }, strike: u => ({ hR: [-.3, .2, .55], hL: [.4, -.7, -.1], chest: [-4, 24, 0], head: [-6, -24, 0], root: [0, -.06, 0], lift: .1 * up(ramp(u * 3 % 1)) }) },
  brawler: { wind: { hR: [.3, .1, 0] }, strike: u => ({ hR: [-.1, .98, .1], chest: [-12, 30, 0], head: [-18, -20, 0], root: [0, -.1, 0], fL: [.1, 0, .25], hL: [.4, -.6, -.1], squash: .05 * up(u) }) },
  wire: { wind: {}, strike: u => ({ hL: [.9, .1, 0], hR: [.9, .1, 0], chest: [0, 60 * Math.sin(u * T), 0], head: [0, -30 * Math.sin(u * T), 0] }) },
  heavy: { wind: { hL: [.3, .2, .2], hR: [.3, .2, .2], chest: [-10, 0, 0] }, strike: u => { const b = Math.abs(Math.sin(u * Math.PI * 4)); return { hL: [-.35, -.2 + .15 * b, .35], hR: [-.35, -.2 + .15 * (1 - b), .35], chest: [-16, 0, 0], head: [-20, 0, 0], root: [0, -.12, 0], squash: -.04 * b }; } },
  round: { wind: { root: [0, -.2, 0], squash: -.12 }, strike: u => ({ lift: .5 * Math.abs(Math.sin(u * Math.PI * 3)), squash: .14 * Math.cos(u * Math.PI * 6), hL: [.6, .6, .2], hR: [.6, .6, .2], yaw: 360 * u }) },
  sword: { wind: { hR: [-.1, .2, .8], blade: [0, 1, .2] }, strike: u => ({ hR: [-.12, .6 - .9 * ramp(u, 1.3), .4], blade: [0, 1 - 2 * ramp(u, 1.2), .3], hL: [.2, -.4, .3], head: [-6, -30, 0], chest: [-4, -20, 0] }) },
  ninja: { wind: {}, strike: u => ({ hL: [-.35, .1, .5], hR: [-.35, .12, .45], chest: [-4, 0, 0], head: [-6, 0, 0], root: [0, -.02, 0], fade: u > .4 && u < .6 ? .5 : 0 }) },
  child: { wind: { root: [0, -.1, 0] }, strike: u => ({ hR: [-.2, .9, .2], hL: [.5, -.6, 0], lift: .2 * Math.abs(Math.sin(u * Math.PI * 2)), yaw: 40 * Math.sin(u * T * 2), head: [-16, 0, 0] }) },
  royal: { wind: {}, strike: u => ({ hL: [.5, .1 + .1 * Math.sin(u * T * 2), .3], hR: [.2, -.7, .3], yaw: 360 * u, chest: [-8, 0, 0], head: [-10, 0, 0], tL: 40 }) },
  climber: { wind: {}, strike: u => ({ hR: [-.1, .9, .2], blade: [0, 1, 0], bw: 1, lift: .3 * Math.abs(Math.sin(u * Math.PI * 2)), yaw: 60 * Math.sin(u * T), head: [-14, 0, 0] }) },
  rodent: { wind: { root: [0, -.2, 0] }, strike: u => ({ hL: [-.3, .6, .3], hR: [-.3, .6, .3], chest: [-16, 0, 0], head: [-20, 30 * Math.sin(u * T * 2), 0], lift: .15 * up(u) }) },
  armored: { wind: {}, strike: u => ({ hR: [-.2, .1 + .6 * up(u), .6], hL: [.4, -.6, .1], chest: [-6, 30, 0], head: [-10, -30 * up(u), 0] }) },
  dinosaur: { wind: {}, strike: u => ({ head: [-30, 0, 0], neck: [-20, 0, 0], chest: [-14, 0, 0], hL: [.3, .3, .4], hR: [.3, .3, .4], lift: .12 * Math.abs(Math.sin(u * T * 2)) }) },
  alien: { wind: {}, strike: u => ({ lift: .15 * up(u), hL: [.7, .2, .2], hR: [.7, .2, .2], chest: [-10, 0, 0], head: [-14, 0, 0], yaw: 20 * Math.sin(u * T) }) },
  flat: { wind: {}, strike: u => ({ hR: [.1, .2 + .4 * (Math.floor(u * 6) % 2), .5], hL: [.1, -.4, .5], head: [-10, 0, 0] }) },
  hand: { wind: { curl: 0 }, strike: u => ({ curl: .5 + .5 * Math.sin(u * T * 3), yaw: 30 * Math.sin(u * T), lift: .1 * up(u) }) },
  bag: { wind: {}, strike: u => ({ lean: 20 * Math.sin(u * T * 2), squash: .06 * Math.sin(u * T * 4) }) },
};

/** Moves the tables may leave out still get a sensible family and striking limb. */
export const DEFAULT_MOVE_POSE: Record<MoveId, { pose: Pose; limb: Limb }> = {
  jab1: { pose: 'jab', limb: 'handL' }, jab2: { pose: 'jab-cross', limb: 'handR' }, jab3: { pose: 'jab-finisher', limb: 'handR' }, jabRapid: { pose: 'jab-rapid', limb: 'handL' },
  ftilt: { pose: 'kick-front', limb: 'footR' }, ftiltHi: { pose: 'kick-high', limb: 'footR' }, ftiltLw: { pose: 'kick-low', limb: 'footR' }, utilt: { pose: 'uppercut', limb: 'handR' },
  dtilt: { pose: 'sweep', limb: 'footR' }, dash: { pose: 'dash-attack', limb: 'footR' },
  fsmash: { pose: 'jab-finisher', limb: 'handR' }, fsmashHi: { pose: 'jab-finisher', limb: 'handR' }, fsmashLw: { pose: 'jab-finisher', limb: 'handR' },
  usmash: { pose: 'headbutt', limb: 'head' }, dsmash: { pose: 'sweep', limb: 'footR' },
  nair: { pose: 'knee', limb: 'footR' }, fair: { pose: 'overhead-slam', limb: 'handR' }, bair: { pose: 'kick-front', limb: 'footL' }, uair: { pose: 'flip-kick', limb: 'footR' }, dair: { pose: 'dive-kick', limb: 'footR' },
  nspecial: { pose: 'cast-forward', limb: 'handL' }, nspecialAir: { pose: 'cast-forward', limb: 'handL' }, sspecial: { pose: 'rush', limb: 'handL' }, sspecialAir: { pose: 'rush', limb: 'handL' },
  uspecial: { pose: 'rise', limb: 'handR' }, uspecialAir: { pose: 'rise', limb: 'handR' }, dspecial: { pose: 'reflect', limb: 'body' }, dspecialAir: { pose: 'reflect', limb: 'body' },
  grab: { pose: 'grab', limb: 'handR' }, dashgrab: { pose: 'grab', limb: 'handR' }, pummel: { pose: 'pummel', limb: 'handR' },
  fthrow: { pose: 'throw-forward', limb: 'handR' }, bthrow: { pose: 'throw-back', limb: 'handR' }, uthrow: { pose: 'throw-up', limb: 'handR' }, dthrow: { pose: 'throw-down', limb: 'handR' },
  ledgeattack: { pose: 'ledge-attack', limb: 'footR' }, ledgeattackSlow: { pose: 'ledge-attack', limb: 'footR' }, getupattack: { pose: 'getup-attack', limb: 'footR' }, getupattackD: { pose: 'getup-attack', limb: 'footR' },
  taunt: { pose: 'taunt', limb: 'body' },
};

// ── Master Hand and Crazy Hand: every family maps onto one whole-hand motion ──
type HandMotion = 'thrust' | 'swipe' | 'slam' | 'rise' | 'low' | 'spin' | 'grab' | 'brace';
const HAND_OF: Partial<Record<Pose, HandMotion>> = {
  'sword-slash': 'swipe', 'hammer-swing': 'swipe', 'item-swing': 'swipe', 'staff-swing': 'swipe', 'kick-front': 'swipe', 'kick-high': 'swipe', clap: 'swipe', 'hip-check': 'swipe', shoulder: 'swipe',
  'overhead-slam': 'slam', 'hammer-overhead': 'slam', 'sword-overhead': 'slam', stomp: 'slam', 'body-slam': 'slam', 'cast-down': 'slam', 'throw-down': 'slam', 'dive-kick': 'slam', 'sword-down-stab': 'slam', drill: 'slam',
  uppercut: 'rise', rise: 'rise', 'sword-rising': 'rise', 'cast-up': 'rise', 'throw-up': 'rise', 'flip-kick': 'rise',
  sweep: 'low', 'kick-low': 'low', 'sword-low': 'low', slide: 'low', 'ledge-attack': 'low', 'getup-attack': 'low',
  spin: 'spin', 'sword-spin': 'spin', 'cast-around': 'spin', 'rise-spin': 'spin', 'roll-ball': 'spin', hover: 'spin', 'throw-back': 'spin',
  grab: 'grab', pummel: 'grab', 'throw-forward': 'grab',
  counter: 'brace', reflect: 'brace', 'charge-hold': 'brace', inflate: 'brace', transform: 'brace', teleport: 'brace', taunt: 'brace',
};
const HAND_MOTIONS: Record<HandMotion, Family> = {
  thrust: { side: 'body', ik: false, wind: { root: [0, .05, -.35], lean: -12, curl: 1 }, strike: { root: [0, 0, .9], lean: 14, curl: 1, squash: .08 }, follow: { root: [0, 0, .5], curl: .6 } },
  swipe: { side: 'body', ik: false, wind: { yaw: -55, lift: .25, root: [0, 0, -.2], curl: .1 }, strike: u => ({ yaw: -55 + 120 * u, root: [0, -.05, .6], lean: 20, curl: 0 }), follow: { yaw: 50 } },
  slam: { side: 'body', ik: false, wind: { lift: .7, spin: -35, curl: 0 }, strike: { lift: -.08, spin: 80, squash: -.12, root: [0, 0, .4], curl: 0 }, follow: { spin: 70, lift: 0 } },
  rise: { side: 'body', ik: false, wind: { lift: -.2, spin: 30, curl: 1 }, strike: u => ({ lift: .2 + 1.1 * u, spin: -60, curl: 1, squash: .1 }), follow: { lift: .8, spin: -30 } },
  low: { side: 'body', ik: false, wind: { lift: .2, spin: -20 }, strike: { lift: -.2, spin: 60, root: [0, 0, .7], yaw: 25 }, follow: { spin: 30 } },
  spin: { side: 'body', ik: false, wind: { yaw: -30, curl: .3 }, strike: u => ({ yaw: 720 * u, curl: .3, lean: 10 }), follow: { yaw: 720 } },
  grab: { side: 'body', ik: false, wind: { root: [0, 0, -.2], curl: 0 }, strike: { root: [0, 0, .7], curl: 1, lean: 10 }, follow: { root: [0, 0, .4], curl: 1 } },
  brace: { side: 'body', ik: false, wind: { lift: .1, curl: .5 }, strike: (u, s) => ({ lift: .1 + .05 * Math.sin(s * 30), curl: .5 + .5 * Math.sin(s * 12), yaw: 12 * Math.sin(s * 20) }) },
};
export const handFamily = (pose: Pose): Family => HAND_MOTIONS[HAND_OF[pose] ?? 'thrust'];

// ── Props shown only by moves (model prop mode 'move') ──
const PROP_POSES = new Set<Pose>(['sword-slash', 'sword-rising', 'sword-low', 'sword-thrust', 'sword-overhead', 'sword-spin', 'sword-down-stab', 'hammer-swing', 'hammer-overhead', 'item-swing', 'staff-swing', 'gun-shoot', 'blaster-draw']);
const specials = (pose: Pose, ...slots: string[]) => Object.fromEntries(slots.flatMap(s => [[s, pose], [s + 'Air', pose]])) as Partial<Record<MoveId, Pose>>;
/**
 * Moves that bring out the prop beyond weapon-limb moves and prop pose families (Fox's blaster, Mario's cape, Kirby's
 * hammer...), with the prop pose used until src/poses-table.ts assigns one.
 */
export const PROP_MOVES: Partial<Record<FighterKind, Partial<Record<MoveId, Pose>>>> = {
  mario: specials('item-swing', 'sspecial'), 'dr-mario': specials('item-swing', 'sspecial'), fox: specials('gun-shoot', 'nspecial'), falco: specials('gun-shoot', 'nspecial'),
  kirby: specials('hammer-swing', 'sspecial'), ness: { fsmash: 'item-swing' }, peach: { fsmash: 'item-swing', ...specials('rise', 'uspecial') },
  'game-watch': { ftilt: 'item-swing', fsmash: 'item-swing', dsmash: 'hammer-swing', fair: 'item-swing', ...specials('item-swing', 'nspecial', 'dspecial'), ...specials('hammer-overhead', 'sspecial') },
};
export const isPropPose = (pose: Pose) => PROP_POSES.has(pose);
export const showsProp = (kind: FighterKind, move: MoveId, info: { pose: Pose; limb: Limb }) => info.limb === 'weapon' || PROP_POSES.has(info.pose) || !!PROP_MOVES[kind]?.[move];
