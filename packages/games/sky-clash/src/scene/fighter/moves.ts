/** Frame data for the renderer: pose family, striking limb and phase boundaries per fighter × move (and special phase). */
import type { FighterKind, Limb, MoveId, Pose } from '../../model';
import { MOVESET, type Move } from '../../moveset';
import { KITS, type Phase, type Slot, type Special } from '../../specials';
import type { MoveInfo } from './animate';
import { DEFAULT_MOVE_POSE, PROP_MOVES, SIGNATURES, isPropPose } from './library';

type Def = Pick<Move, 'pose' | 'limb' | 'total' | 'windows' | 'charge'> & { shots?: number[] };
/**
 * Phase roles from the special kit: hold phases freeze the charged wind-up (or the held action: reflectors, rapid blasters, counters),
 * the phase leading into a charge is all anticipation (lead), and the release after it starts wound up (windup).
 */
export type Role = { hold?: 'wind' | 'strike'; windup?: boolean; lead?: boolean; shot?: number };
/** Moves without hit windows (taunts, reflectors, counters) still read as anticipation → action → recovery. */
export function infoOf(def: Def | undefined, id: MoveId, prop?: Pose, role: Role = {}): MoveInfo {
  const fallback = DEFAULT_MOVE_POSE[id], total = Math.max(2, def?.total ?? 30), windows = def?.windows ?? [], shot = role.shot ?? def?.shots?.[0];
  let start = windows.length ? windows[0].from : shot ?? Math.round(total * .25), end = windows.length ? Math.max(...windows.map(w => w.to)) : shot !== undefined ? shot + 4 : Math.round(total * .6);
  if (role.lead) { start = total; end = total + 1; }
  let pose = def?.pose ?? fallback.pose, limb: Limb = def?.limb ?? fallback.limb;
  // A move that brings out a prop swings it, unless its pose already uses one.
  if (prop && !isPropPose(pose)) { pose = prop; limb = prop === 'gun-shoot' || prop === 'rise' ? 'handR' : 'weapon'; }
  const power = Math.min(1, Math.max(0, ...windows.flatMap(w => w.hitboxes.map(h => h.damage))) / 18);
  return { pose, limb, total, start: Math.min(start, total - (role.lead ? 0 : 1)), end: Math.min(Math.max(end, start + 1), total + (role.lead ? 1 : 0)), charge: def?.charge?.frame ?? null,
    power, ...(role.hold ? { hold: role.hold } : {}), ...(role.windup ? { windup: true } : {}) };
}
const SLOT: Partial<Record<MoveId, Slot>> = { nspecial: 'n', nspecialAir: 'n', sspecial: 's', sspecialAir: 's', uspecial: 'hi', uspecialAir: 'hi', dspecial: 'lw', dspecialAir: 'lw' };
/** The kit phase playing a MOVESET phase key, and what it does to the pose. */
function roleOf(sp: Special, phase: string, def: Def | undefined): Role {
  const entry = Object.entries(sp.phases).find(([key, p]) => (p.script ?? key) === phase), kp: Phase | undefined = entry?.[1];
  if (!kp) return {};
  const holdKind = (p: Phase) => p.hold?.charge ? 'wind' : 'strike'; // charges hold the coil; reflectors, blasters, counters hold the action
  const at = kp.shots?.[0]?.at, shot = at === 'script' ? def?.shots?.[0] : at;
  if (kp.hold) return { hold: holdKind(kp) };
  const next = kp.next ? sp.phases[kp.next] : undefined, released = Object.values(sp.phases).some(p => p.hold && (p.hold.release === entry![0] || p.hold.full === entry![0]));
  if (next?.hold && holdKind(next) === 'wind' && !def?.windows.length) return { lead: true };
  return { ...(released ? { windup: true } : {}), ...(shot !== undefined ? { shot } : {}) };
}
const cache = new Map<string, MoveInfo>();
/** Tools may substitute frame data (the Pose Lab's synthetic pose sheets). */
export const overrides: { get: ((kind: FighterKind, id: MoveId) => MoveInfo) | null } = { get: null };
export function moveInfo(kind: FighterKind, id: MoveId, phase?: string): MoveInfo {
  if (overrides.get) return overrides.get(kind, id);
  const key = `${kind}/${id}/${phase ?? ''}`;
  let info = cache.get(key);
  if (!info) {
    // No movePhase means the base script (''); tools asking without one get the move's main phase.
    const def = MOVESET[kind]?.[id], sp = SLOT[id] ? KITS[kind]?.[SLOT[id]!] : undefined;
    const ph = phase ?? Object.entries(def?.phases ?? {}).find(([, p]) => p.total === def?.total && p.windows === def?.windows)?.[0] ?? '', sub = def?.phases?.[ph] ?? def;
    const family = SIGNATURES[kind]?.[id];
    cache.set(key, info = { ...infoOf(sub, id, PROP_MOVES[kind]?.[id], sp ? roleOf(sp, ph, sub) : {}), ...(family ? { family } : {}) });
  }
  return info;
}
