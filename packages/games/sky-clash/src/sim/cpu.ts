/**
 * CPU fighters: synthetic phone-shaped inputs produced inside tick(), deterministic from the state's RNG.
 * Priority each frame: survive (DI, tech, mash, recover to the nearest ledge or floor) → ledge/getup options → fight.
 * Recovery never fast-falls or air-dodges offstage, and ground movement never walks toward a drop with no floor below.
 */
import type { Buttons, CpuLevel, Input, MoveId } from '../model';
import { MOVESET } from '../moveset';
import { P, PARTY_UP_B, alive, foes, isSpecial, party } from './common';
import { kitOf, phaseOf } from './specials';
import type { Special } from './kits';
import { PRESS_KEYS, type Fighter, type PressKey, type State } from './types';
import { clamp, random, sign } from './util';
import type { Env, Surface } from './world';

type Level = { react: number; jitter: number; aggro: number; shield: number; tech: number; di: number; smash: number; ledge: [number, number]; mash: number; edge: boolean; zone: number };
const LEVELS: Record<CpuLevel, Level> = {
  1: { react: 42, jitter: 30, aggro: .12, shield: .04, tech: 0, di: 0, smash: .15, ledge: [50, 110], mash: 14, edge: false, zone: .02 },
  2: { react: 15, jitter: 12, aggro: .6, shield: .22, tech: .45, di: .55, smash: .3, ledge: [14, 50], mash: 7, edge: false, zone: .1 },
  3: { react: 6, jitter: 6, aggro: .85, shield: .45, tech: .85, di: .95, smash: .38, ledge: [4, 34], mash: 3, edge: true, zone: .16 },
};
const READY = new Set(['idle', 'walk', 'run', 'crouch', 'teeter', 'turn']);
const ZONERS = new Set(['fox', 'falco', 'samus', 'link', 'young-link', 'mario', 'dr-mario', 'luigi', 'pikachu', 'pichu', 'sheik', 'popo', 'nana', 'game-watch', 'mewtwo', 'ness']);
/** Side specials that stay put (no long dash that could carry a CPU off the stage). */
const STAY_SIDE = new Set(['marth', 'roy', 'mario', 'dr-mario', 'kirby', 'bowser', 'giga-bowser', 'donkey-kong', 'ness', 'samus', 'link', 'young-link', 'sheik', 'mewtwo', 'game-watch', 'zelda']);
const SIDE_RECOVERY = new Set(['fox', 'falco', 'pikachu', 'pichu', 'luigi', 'captain-falcon', 'ganondorf', 'peach', 'popo', 'nana']);
/** Does this special gain height (rise, aimed launch, teleport, mash, a self-launching shot or a real stall)? */
const rises = (sp: Special | undefined) => !!sp && ((sp.stall ?? 0) >= .1 || Object.values(sp.phases).some(ph => !!ph.teleport || !!ph.shots?.some(q => q.self !== undefined)
  || !!ph.motion?.some(q => (q.vy ?? 0) > 0 || q.aim !== undefined || q.launch !== undefined || !!q.mash)));
const reachOf = new Map<string, number>();
function reach(f: Fighter): number {
  let r = reachOf.get(f.kind);
  if (r === undefined) {
    const xs = (['jab1', 'ftilt', 'fsmash', 'dtilt'] as MoveId[]).flatMap(m => MOVESET[f.kind][m]?.windows.flatMap(w => w.hitboxes.map(h => h.x + h.r)) ?? []);
    reachOf.set(f.kind, r = Math.max(.6, Math.min(2, xs.length ? Math.max(...xs) : .9)));
  }
  return r;
}
/** A surface under (x, y) within reach of a fall. */
const floorBelow = (list: Surface[], x: number, y: number, pad = .2) => {
  let best: Surface | null = null;
  for (const q of list) if (x >= q.left - pad && x <= q.right + pad && q.y <= y + .05 && (!best || q.y > best.y)) best = q;
  return best;
};
export const offstage = (f: Fighter, list: Surface[]) => !f.grounded && !floorBelow(list, f.x, f.y);

/**
 * Floors a CPU may count on: inside the camera bounds (1 m in from the sides) and not racing past. Scrolling terrain
 * outside them (Rainbow Cruise, Poké Floats, Icicle Mountain, Mute City's departing track) is carrying riders to a blast zone.
 */
const inView = (env: Env, x: number, y: number) => { const c = env.stage.camera; return x > c.left + 1 && x < c.right - 1 && y >= c.bottom; };
const safeFloors = (env: Env, list: Surface[]) => list.flatMap(q => {
  const c = env.stage.camera, left = Math.max(q.left, c.left + 1), right = Math.min(q.right, c.right - 1);
  return right > left && q.y >= c.bottom && Math.abs(q.dx) < .1 ? [{ ...q, left, right }] : [];
});
/** Near a blast zone, or standing on a floor that is not safe: get back toward the middle now. */
const brink = (env: Env, f: Fighter, safe: Surface[]) => { const b = env.stage.blast; return f.x - b.left < 4 || b.right - f.x < 4 || f.y - b.bottom < 3.5 || (f.grounded && !safe.some(q => q.id === f.ground)); };
export function cpuInput(s: State, f: Fighter, env: Env, all: Surface[]): Input {
  const list = safeFloors(env, all);
  const m = f.cpuMemo, lv = LEVELS[f.cpu ?? 2], hold: Buttons = { attack: false, special: false, jump: false, shield: false, smash: false };
  let x = 0, y = 0; // world stick: +y up
  const press: PressKey[] = [];
  const decide = s.frame >= m.next, schedule = () => { m.next = s.frame + lv.react + Math.floor(random(s) * lv.jitter); };
  const toward = (tx: number) => (Math.abs(tx - f.x) > .15 ? sign(tx - f.x) : 0);
  const home = homeOf(env, list);
  const foe = target(s, f);

  if (f.state === 'respawn') { if (f.stateFrame > 40 + lv.react * 2) { x = toward(home.cx) || 1; y = -.2; } }
  else if (f.state === 'grabbed') { if (s.frame % lv.mash === 0) press.push(s.frame % (2 * lv.mash) ? 'attack' : 'jump'); x = s.frame % 8 < 4 ? 1 : -1; }
  else if (f.hitlag > 0 && f.pending) {
    // Survival DI: hold the perpendicular that points up and back toward the stage; level 3 also SDIs inward.
    if (m.mash === 0) m.mash = random(s) < lv.di ? 1 : -1;
    if (m.mash > 0) {
      const a = f.pending.angle * Math.PI / 180, cx = sign(home.cx - f.x), c1 = [-Math.sin(a), Math.cos(a)] as const, c2 = [Math.sin(a), -Math.cos(a)] as const;
      const score = (c: readonly [number, number]) => c[0] * cx + c[1] * 1.2;
      [x, y] = score(c1) >= score(c2) ? c1 : c2;
      if (f.cpu === 3 && f.hitlag % 4 < 2) { x = cx; y = .4; }
    }
  } else if ((f.state === 'hitstun' || f.state === 'tumble') && !f.grounded) {
    if (m.mash === 0) m.mash = random(s) < lv.di ? 1 : -1;
    x = m.mash > 0 ? sign(home.cx - f.x) : 0; y = m.mash > 0 ? .5 : 0;
    const floor = floorBelow(list, f.x, f.y);
    if (f.tumble && floor && f.vy + f.ky < 0 && f.y - floor.y < .9 + Math.abs(f.vy + f.ky) * 3 && m.recover !== s.frame && m.plan !== 'teched') {
      m.plan = 'teched';
      if (random(s) < lv.tech) { press.push('shield'); x = random(s) < .5 ? 0 : sign(home.cx - f.x); }
    }
    if (f.hitstun <= 0 && offstage(f, list)) ({ x, y } = recover(s, f, env, list, lv, press, home));
  } else {
    if (f.state !== 'hitstun' && f.state !== 'tumble') m.mash = 0;
    if (m.plan === 'teched' && f.grounded) m.plan = '';
    if (f.state === 'ledge') {
      if (!m.until) m.until = s.frame + lv.ledge[0] + Math.floor(random(s) * (lv.ledge[1] - lv.ledge[0]));
      if (s.frame >= m.until) {
        m.until = 0; const r = random(s), side = f.ledgeSide;
        if (f.cpu === 1 || r < .4) x = -side; else if (r < .6) press.push('jump'); else if (r < .8) press.push('shield'); else press.push('attack');
      }
    } else if (f.state === 'knockdown') {
      if (!m.until) m.until = s.frame + 6 + Math.floor(random(s) * lv.react);
      if (s.frame >= m.until) { m.until = 0; const r = random(s); if (r < .35) press.push('jump'); else if (r < .7) x = sign(home.cx - f.x); else press.push('attack'); }
    } else if (f.state === 'grab') {
      if (!m.until) m.until = s.frame + 8 + Math.floor(random(s) * 16);
      if (s.frame >= m.until) {
        m.until = 0; const r = random(s), nearEdge = sign(f.x - home.cx) || f.facing;
        if (r < .15 && f.cpu !== 1) press.push('attack');
        else if (r < .35) y = 1; else if (r < .45) y = -1; else x = nearEdge;
      }
    } else if (offstage(f, list) && f.state !== 'helpless' || f.state === 'helpless') ({ x, y } = recover(s, f, env, list, lv, press, home));
    else if (f.state === 'attack' && isSpecial(f.move) && !f.grounded && f.move?.startsWith('u')) ({ x, y } = recover(s, f, env, list, lv, press, home));
    else if (foe) ({ x, y } = fight(s, f, foe, env, list, lv, press, hold, home, decide, schedule));
    else { x = Math.abs(home.cx - f.x) > 1 ? toward(home.cx) : 0; }
  }
  // Anti-stuck: standing still for four seconds with nothing to do → hop toward the stage center.
  if (Math.abs(f.x - m.lastX) < .01 && f.grounded && (f.state === 'idle' || f.state === 'teeter' || f.state === 'crouch')) { if (++m.stuck > 240) { m.stuck = 0; press.push('jump'); x = toward(home.cx); } }
  else { m.stuck = 0; m.lastX = f.x; }
  for (const k of press) { m.presses[k]++; if (k !== 'grab') hold[k as keyof Buttons] = true; }
  if (f.state === 'jumpsquat' && m.plan === 'full') hold.jump = true;
  if (f.state === 'shield' && m.plan === 'shield' && s.frame < m.until) hold.shield = true;
  if (m.hold.special && f.state === 'attack' && isSpecial(f.move)) hold.special = s.frame < m.until;
  return { x, y: -y, held: hold, presses: { ...m.presses }, aim: { x, y: -y } };
}
/** Frames Nana trails her leader's input: a reconstruction (Melee's exact delay is not in our data) that spaces their hits apart like the original pair. */
export const ECHO = 6;
const EASY = new Set([...READY, 'jumpsquat', 'air', 'land', 'attack', 'shield', 'shieldstun', 'roll', 'spotdodge', 'airdodge', 'grab', 'respawn']);
/**
 * Ice Climbers partner: replays her leader's input ECHO frames late (presses as deltas on her own counters), walks back when
 * she drifts more than a couple of meters from a grounded leader, and uses the CPU brain on her own to survive (DI, tech,
 * mash, recovery, ledge and getup options) or to fight while her leader is disabled.
 */
export function partnerInput(s: State, f: Fighter, leader: Fighter, raw: Input, env: Env, list: Surface[]): Input {
  const e = f.echo, dx = leader.x - f.x, dy = leader.y - f.y, presses = { ...f.seen }, safe = safeFloors(env, list);
  do e.unshift({ ...raw, held: { ...raw.held }, presses: { ...raw.presses }, aim: { ...raw.aim } }); while (e.length < ECHO + 2); // a fresh echo starts as the leader's baseline
  e.length = ECHO + 2;
  if (!EASY.has(f.state) || !EASY.has(leader.state) && leader.state !== 'helpless' || offstage(f, safe) || brink(env, f, safe)) { f.cpuMemo.presses = presses; return cpuInput(s, f, env, list); }
  if (leader.grounded && (Math.abs(dx) > 2.4 || Math.abs(dy) > 2.2)) {
    if (READY.has(f.state) && dy > 1) presses.jump++;
    const drop = f.grounded && dy < -1; // down drops through a soft platform
    return { x: drop || Math.abs(dx) < .5 ? 0 : sign(dx), y: drop ? 1 : 0, held: { attack: false, special: false, jump: false, shield: false, smash: false }, presses, aim: { x: 0, y: 0 } };
  }
  const late = e[ECHO]!, prev = e[ECHO + 1]!;
  for (const k of PRESS_KEYS) if (late.presses[k] > prev.presses[k]) presses[k]++;
  return { ...late, presses };
}
type Home = { cx: number; left: number; right: number; top: number };
/** The main stage: the widest safe floor, ledged blocks first (so a stage scrolling out of view is not home). */
function homeOf(env: Env, list: Surface[]): Home {
  const ledged = new Set(env.blocks.filter(b => b.ledges).map(b => b.id)), w = (q: Surface) => q.right - q.left + (ledged.has(q.id) ? 1e3 : 0);
  const p = [...list].sort((a, b) => w(b) - w(a))[0], c = env.stage.camera;
  return p ? { cx: (p.left + p.right) / 2, left: p.left, right: p.right, top: p.y } : { cx: (c.left + c.right) / 2, left: -5, right: 5, top: 0 };
}
function nearestFloorX(list: Surface[], f: Fighter): number {
  let bx = f.x, bd = Infinity;
  for (const q of list) if (q.y <= f.y + .5) { const x = Math.max(q.left + .4, Math.min(q.right - .4, f.x)), d = Math.abs(x - f.x) + (f.y - q.y) * .2; if (d < bd) { bd = d; bx = x; } }
  return bx;
}
function target(s: State, f: Fighter): Fighter | undefined {
  let best: Fighter | undefined, d = Infinity;
  for (const o of foes(s, f)) { if (o.state === 'respawn') continue; const k = Math.hypot(o.x - f.x, (o.y - f.y) * 1.5) + (o.stocks <= 0 && !o.leader ? 99 : 0); if (k < d) { d = k; best = o; } }
  const id = f.cpuMemo.target, cur = id ? s.fighters.find(o => o.id === id && alive(o) && o.state !== 'respawn') : undefined;
  if (cur && best && Math.hypot(cur.x - f.x, cur.y - f.y) < d + 2) return cur;
  f.cpuMemo.target = best?.id ?? null;
  return best;
}
/** Head for the nearest ledge (or floor edge): drift in, double jump when below, up-special (aimed) when out of jumps. */
function recover(s: State, f: Fighter, env: Env, list: Surface[], lv: Level, press: PressKey[], home: Home): { x: number; y: number } {
  const p = P(f), m = f.cpuMemo;
  let tx = home.cx, ty = home.top, best = Infinity, catchable = false;
  for (const l of env.ledges) if (inView(env, l.x, l.y)) {
    const d = Math.hypot(l.x - f.x, l.y - f.y); if (d < best) { best = d; tx = l.x + l.side * (f.y > l.y + .2 ? -.6 : .45); ty = l.y; }
    if ((f.x - l.x) * l.side > 0 && (f.x - l.x) * l.side < 1.2 && f.y > l.y - .3) catchable = true; // just outside and above a ledge: falling grabs it
  } // above the ledge: land on the stage instead
  for (const q of list) {
    if (env.blocks.some(b => b.id !== q.id && Math.abs(b.bottom - q.y) < .05 && b.left <= q.left + .01 && b.right >= q.right - .01)) continue; // a step buried under the stage is no floor
    const cx = Math.max(q.left + .3, Math.min(q.right - .3, f.x)), d = Math.hypot(cx - f.x, q.y - f.y) + (q.y > f.y + 1 ? 1.5 : 0); if (d < best) { best = d; tx = cx; ty = q.y; }
  }
  // Under a solid block: drift out past its nearer edge before rising, instead of jumping into its ceiling.
  const over = env.blocks.find(b => f.x > b.left && f.x < b.right && f.y < b.bottom && b.bottom - f.y < 6);
  if (over) { const side = f.x - over.left < over.right - f.x ? -1 : 1; tx = (side < 0 ? over.left : over.right) + side * 1.2; ty = over.top; }
  const dx = tx - f.x, dy = ty - f.y, falling = f.vy + f.ky < .02;
  let x = Math.abs(dx) > .1 ? sign(dx) : 0, y = 0;
  const bolt = f.state === 'attack' ? s.projectiles.find(q => q.owner === f.id && q.self !== undefined && q.steer) : undefined;
  if (bolt) {
    // PK Thunder: loop the bolt round (on the side away from the stage) to a point behind Ness, then steer it into him,
    // so the self-hit launches him along u, at the target (`along` = the bolt's progress along u from Ness).
    if (s.frame - (bolt.born ?? 0) < 2) { m.plan = 'bolt'; m.x = tx; m.y = ty; } // the target is fixed when the bolt appears
    const hx = f.x, hy = f.y + p.height / 2, gx = m.x - hx, gy = m.y + .6 - hy, gd = Math.hypot(gx, gy) || 1, ux = gx / gd, uy = gy / gd, nx = -uy, ny = ux;
    const along = (bolt.x - hx) * ux + (bolt.y - hy) * uy, side = Math.abs(hx + nx * 1.5 - home.cx) > Math.abs(hx - nx * 1.5 - home.cx) ? 1 : -1;
    const wx = hx - ux * 3.6 + nx * side * .8, wy = hy - uy * 3.6 + ny * side * .8, across = Math.abs((bolt.x - hx) * nx + (bolt.y - hy) * ny);
    if (Math.hypot(bolt.x - wx, bolt.y - wy) < 1.2 || (along < -2.4 && across < 1.2)) m.plan = 'bolt-in';
    const [ax, ay] = m.plan === 'bolt-in' ? [hx, hy] : [wx, wy], d = Math.hypot(ax - bolt.x, ay - bolt.y) || 1;
    return { x: (ax - bolt.x) / d, y: (ay - bolt.y) / d };
  }
  if (f.state === 'helpless' || (f.state === 'attack' && isSpecial(f.move))) {
    if (f.state === 'attack' && s.frame % 4 === 0 && phaseOf(f)?.motion?.some(q => q.mash)) press.push('special'); // mash Squall Hammer / tornadoes upward
    if (over && f.y < over.bottom) return { x: sign(tx - f.x), y: .2 }; // under the stage: aim out past its edge, not into its underside
    // Teleports cover a fixed distance: aim so the exit lands above the target instead of overshooting past it.
    const tp = f.state === 'attack' && f.move?.startsWith('u') ? Object.values(kitOf(f.kind).hi?.phases ?? {}).find(q => q.teleport)?.teleport : undefined;
    if (tp) { const ux = clamp(dx / (tp.dist * (party(s) ? PARTY_UP_B : 1)), -1, 1); return { x: ux, y: Math.sqrt(1 - ux * ux) }; }
    const d = Math.hypot(dx, dy + .6) || 1; return { x: f.state === 'helpless' && Math.abs(dx) > .1 ? sign(dx) : dx / d, y: (dy + .6) / d };
  }
  if (f.state === 'attack' || f.state === 'airdodge') return { x, y };
  const kit = kitOf(f.kind), usedHi = f.used.includes('hi');
  if (f.jumpsLeft > 0 && falling && (dy > -.4 || Math.abs(dx) > 3) && m.recover < s.frame - 12 && (!over || f.y < over.bottom - 3.5)) { press.push('jump'); m.recover = s.frame; return { x, y: 0 }; }
  const need = dy > -.3 || Math.abs(dx) > 1.5, high = dy < -.6 && Math.abs(dx) > 1.5; // still well above the target: drift in first
  // Party up-specials travel farther: from far out, keep drifting in until well below the target (or near the bottom blast zone).
  const late = party(s) && Math.abs(dx) > 2.2 && dy < 1.5 && f.y - env.stage.blast.bottom > 4;
  if (!usedHi && f.jumpsLeft <= 0 && falling && need && !high && !late && !(party(s) && catchable) && (dy > p.height * .2 || f.vy < -.08 || Math.abs(dx) > 2.2)) {
    if (SIDE_RECOVERY.has(f.kind) && !f.used.includes('s') && kit.s && Math.abs(dx) > 3.2 && dy > (kit.s.helpless ? -.5 : -1) && dy < 1.2) { press.push('special'); m.hold.special = false; return { x: sign(dx), y: 0 }; }
    if (!rises(kit.hi)) { // an up-special that gains no height (Sing): stall with the side special once instead
      if (kit.s && !f.used.includes('s!')) { press.push('special'); m.hold.special = false; return { x: sign(dx), y: 0 }; }
      return { x, y };
    }
    // Party mode reads up generously, so a far CPU aims its up-special across; Jump (out of jumps) also fires it.
    const pm = party(s); press.push(pm && f.cpu !== 1 && random(s) < .5 ? 'jump' : 'special'); m.hold.special = false;
    return { x: sign(dx) * (pm ? Math.min(1, .35 + Math.abs(dx) / 5) : .35), y: 1 };
  }
  if (f.fastFall) y = 0;
  return { x, y };
}
function fight(s: State, f: Fighter, foe: Fighter, env: Env, list: Surface[], lv: Level, press: PressKey[], hold: Buttons, home: Home,
  decide: boolean, schedule: () => void): { x: number; y: number } {
  const m = f.cpuMemo, dx = foe.x - f.x, dy = foe.y - f.y, dist = Math.abs(dx), r = reach(f) + P(foe).radius * .6, face = sign(dx);
  const safe = (dir: number) => !!floorBelow(list, f.x + dir * (P(f).radius + .5 + Math.abs(f.vx) * 10), f.y, 0);
  let x = 0, y = 0;
  // Toward the foe; at a gap (Big Blue's racers, Venom's wings) with a floor within a full hop beyond it, jump across.
  const go = (dir: number) => {
    x = safe(dir) ? dir : 0;
    if (x || !dir || !READY.has(f.state) || dist < r || m.plan === 'full') return;
    if (list.some(q => (dir > 0 ? q.left > f.x && q.left - f.x < 5 : q.right < f.x && f.x - q.right < 5) && q.y - f.y < 1.5 && q.y - f.y > -3 && Math.abs(foe.x - q.left - (q.right - q.left) / 2) < Math.abs(foe.x - f.x))) { press.push('jump'); m.plan = 'full'; x = dir; }
  };
  // Scrolling and moving stages: never ride terrain into a blast zone, or stay on a floor that is racing away.
  if (brink(env, f, list)) {
    const cx = (env.stage.camera.left + env.stage.camera.right) / 2; x = sign(cx - f.x);
    if (f.grounded && READY.has(f.state)) { press.push('jump'); m.plan = 'full'; } // an emergency: no reaction delay, even for level 1
    return { x, y: 0 };
  }
  if (!f.grounded) {
    // On-stage air: drift at the foe and throw an aerial in range; never drift, attack or fast-fall away from the floor.
    if (f.state === 'attack' && !floorBelow(list, f.x + f.vx * 20, f.y)) return { x: sign(nearestFloorX(list, f) - f.x), y: 0 };
    if (f.state === 'air' || f.state === 'tumble') {
      go(dist > .3 ? face : 0);
      if (!floorBelow(list, f.x + f.vx * 20, f.y)) x = sign(nearestFloorX(list, f) - f.x);
      if (decide && dist < r + .5 && Math.abs(dy + .4) < 1.4 && floorBelow(list, f.x, f.y) && floorBelow(list, f.x + f.vx * 20, f.y) && random(s) < lv.aggro) {
        schedule(); press.push('attack');
        const up = dy > .8, down = dy < -.8;
        return { x: up || down ? 0 : face, y: up ? 1 : down ? -1 : 0 };
      }
      if (f.cpu === 3 && f.vy < 0 && f.vy > -.1 && floorBelow(list, f.x, f.y) && dy < -.5 && s.frame % 3 === 0) y = -1;
    }
    return { x, y };
  }
  const threat = foe.state === 'attack' && !!foe.move && dist < r + 1.2 && Math.abs(dy) < 1.5;
  // Edge-guard (level 3): wait near the edge the foe is recovering to, then swing when they come close.
  if (lv.edge && offstage(foe, list)) {
    const edge = foe.x < home.cx ? home.left + .6 : home.right - .6;
    if (Math.abs(edge - f.x) > .4) go(sign(edge - f.x));
    else if (decide && dist < 2.2 && dy > -1.6 && dy < .8) { schedule(); if (f.facing === face) press.push('smash'); else x = face; if (dy < -.4) y = -1; }
    return { x, y };
  }
  if (!READY.has(f.state) && f.state !== 'shield') return { x: 0, y: 0 };
  if (m.plan === 'shield' && s.frame < m.until) { hold.shield = true; if (f.state === 'shield' && !threat && dist < r && random(s) < .25) { press.push('attack'); m.plan = ''; } return { x: 0, y: 0 }; }
  if (!decide) {
    // Between decisions keep closing distance (or holding position) without walking off an edge.
    if (m.plan === 'approach' && dist > r * .8) go(face);
    else if (m.plan === 'retreat') go(-face);
    if (f.state === 'crouch') y = -1;
    return { x, y };
  }
  schedule();
  const rnd = random(s);
  if (threat && rnd < lv.shield) { m.plan = 'shield'; m.until = s.frame + 10 + Math.floor(random(s) * 16); press.push('shield'); hold.shield = true; return { x: 0, y: 0 }; }
  if (dist < r && Math.abs(dy) < 1.2 && rnd < lv.aggro + (f.cpu === 1 ? 0 : .15)) {
    m.plan = 'attack';
    const k = random(s), smashy = lv.smash + Math.min(.3, foe.damage / 400);
    if (dy > .7) { press.push(k < smashy ? 'smash' : 'attack'); return { x: 0, y: 1 }; }
    if (foe.state === 'shield' || (k < .18 && foe.damage < 80)) { press.push('grab'); return { x: face * .2, y: 0 }; }
    if (k < smashy) { press.push('smash'); return { x: face, y: 0 }; }
    if (k > .88 && f.cpu !== 1) { // specials up close: neutral or down, side only well away from the edges
      const room = Math.min(f.x - home.left, home.right - f.x) > 3.5, pick = random(s);
      if (f.facing !== face) return { x: face * .5, y: 0 };
      press.push('special'); m.hold.special = false;
      return pick < .4 ? { x: 0, y: 0 } : pick < .75 || !room || !STAY_SIDE.has(f.kind) ? { x: 0, y: -1 } : { x: face, y: 0 };
    }
    if (k < smashy + .15) { press.push('attack'); return { x: 0, y: -1 }; }
    if (f.facing !== face) return { x: face, y: 0 };
    press.push('attack'); return { x: random(s) < .5 ? face : 0, y: 0 };
  }
  if (f.cpu !== 1 && dist < r + 2.2 && Math.abs(dy) < 1.6 && rnd < lv.aggro * .5 && safe(face)) { // short-hop aerial approach
    m.plan = 'approach'; press.push('jump', 'attack'); return { x: face, y: 0 };
  }
  if (ZONERS.has(f.kind) && dist > 3 && Math.abs(dy) < 1 && rnd < lv.zone + .08) { // neutral special: face first so the stick stays neutral
    m.plan = 'zone'; if (f.facing !== face) return { x: face * .5, y: 0 };
    press.push('special'); m.hold.special = false; return { x: 0, y: 0 };
  }
  if (dy > 1.3 && dist < 3.5 && rnd < .6) { m.plan = 'up'; if (dy > 2.5 || f.cpu !== 1) m.plan = 'full'; press.push('jump'); return { x: face * .4, y: 0 }; }
  if (dy < -1 && dist < 2 && f.ground && !env.blocks.some(b => b.id === f.ground)) return { x: 0, y: -1 }; // drop through the platform
  if (f.cpu === 1 && rnd > .45) { m.plan = 'wait'; return { x: 0, y: 0 }; }
  if (dist < r * .6 && rnd < .2) { m.plan = 'retreat'; go(-face); return { x, y: 0 }; }
  m.plan = 'approach'; go(face);
  if (dist > 3.5 && x && f.state !== 'run' && random(s) < .6) { m.plan = 'approach'; return { x: x * 1, y: 0 }; }
  return { x, y };
}
