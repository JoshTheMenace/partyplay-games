import { SCRIPTS } from '../fidelity/scripts';
import { decodeHitbox } from '../fidelity/commands';
import type { FighterKind, Move } from './model';
import { ROSTER, ROSTER_DATA } from './roster';
import { SPECIALS } from './specials';
export type Hitbox = ReturnType<typeof decodeHitbox>;
export type Window = { from: number; to: number; group: number; hitboxes: Hitbox[] };
export type MoveSpec = { startup: number; active: number; end: number; chargeFrame: number; windows: Window[]; autocancel: [number, boolean][] };
const names = { jab: 'Attack11', side: 'AttackS3S', upper: 'AttackHi3', sweep: 'AttackLw3', smash: 'AttackS4', upsmash: 'AttackHi4', downsmash: 'AttackLw4', aerial: 'AttackAirN', forwardair: 'AttackAirF', backair: 'AttackAirB', upair: 'AttackAirHi', downair: 'AttackAirLw' } as const;
/** Expand waits, bounded loops and calls. Animation/bone commands stay presentation-only. */
export function compileScript(events: readonly string[], frames: number, routines: Readonly<Record<string, readonly string[]>>): MoveSpec {
  let frame = 0, end = frames, chargeFrame = 0, group = 0;
  const active = new Map<number, Hitbox>(), windows: Window[] = [], autocancel: [number, boolean][] = [[0, true]];
  const advance = (next: number) => { if (next > frame && active.size) windows.push({ from: frame, to: next, group, hitboxes: [...active.values()] }); frame = next; };
  let budget = 2000;
  function run(script: readonly string[], depth = 0) {
    if (depth > 8) throw new Error('Recursive attack script');
    const loops: { start: number; remaining: number }[] = [];
    for (let i = 0; i < script.length; i++) {
      if (--budget < 0) throw new Error('Unbounded attack script');
      const hex = script[i], word = parseInt(hex.slice(0, 8), 16), op = word >>> 26, arg = word & 0x3ffffff;
      if (op === 0 || op === 6) break;
      if (op === 1) advance(frame + arg);
      else if (op === 2) advance(Math.max(frame, arg));
      else if (op === 3) loops.push({ start: i, remaining: arg });
      else if (op === 4) { const loop = loops.at(-1); if (!loop) throw new Error('Unmatched attack loop'); if (--loop.remaining > 0) i = loop.start; else loops.pop(); }
      else if (op === 5 || op === 7) { const offset = String(parseInt(hex.slice(8, 16), 16)); if (!routines[offset]) throw new Error('Missing attack subroutine'); run(routines[offset], depth + 1); if (op === 5) break; }
      else if (op === 11) { const hit = decodeHitbox(hex); active.set(hit.id, hit); }
      else if (op === 12 || op === 13) { const id = arg >>> 23, hit = active.get(id); if (hit) active.set(id, { ...hit, ...(op === 12 ? { damage: arg & 0x7fffff } : { size: (arg & 0x7fffff) * .003906 }) }); }
      else if (op === 15) active.delete(arg & 7);
      else if (op === 16) { active.clear(); group++; }
      else if (op === 19) autocancel.push([frame, !(arg & 1)]);
      else if (op === 23) end = frame;
      else if (op === 56) chargeFrame = frame;
      // Selected normal streams do not contain animation timer resets or collision-mask edits.
      else if ([8, 14].includes(op)) throw new Error(`Unsupported combat opcode ${op}`);
    }
  }
  run(events); advance(Math.max(frame, end));
  const startup = windows[0]?.from ?? 0, last = windows.at(-1)?.to ?? startup;
  return { startup, active: last - startup, end: Math.max(1, end), windows, chargeFrame, autocancel };
}
const normal = Object.fromEntries(ROSTER.map(kind => {
  const profile = ROSTER_DATA[kind].profile as keyof typeof SCRIPTS, data = SCRIPTS[profile];
  return [kind, Object.fromEntries(Object.entries(names).map(([move, name]) => {
    const aliases = name === 'AttackS3S' ? [name, 'AttackS3'] : name === 'AttackS4' ? [name, 'AttackS4S', 'AttackS41'] : [name];
    const action = data.actions.find(a => aliases.includes(a.name));
    if (!action) throw new Error(`Missing ${kind} ${name}`);
    return [move, compileScript(action.events, action.frames, data.subroutines)];
  }))];
})) as Record<FighterKind, Record<keyof typeof names, MoveSpec>>;
// Missing special parameter banks: explicit reconstructed timing, travel and hitboxes.
const special = (startup: number, active: number, end: number, damage: number, angle: number, growth: number, baseKnockback: number): MoveSpec => ({ startup, active, end, chargeFrame: 0, autocancel: [[0, true]], windows: damage ? [{ from: startup, to: startup + active, group: 0, hitboxes: [{ ...decodeHitbox('2c00c804035404a8000000002319001300000007'), damage, angle, growth, baseKnockback, size: 7, hitGrounded: true, hitAirborne: true }] }] : [] });
const pilots = {
  fox: { dash: special(21, 4, 64, 7, 361, 60, 68), rise: special(43, 30, 83, 14, 80, 60, 60), laser: special(10, 1, 23, 0, 0, 0, 0), reflect: special(1, 3, 24, 5, 0, 100, 0) },
  falco: { dash: special(17, 4, 60, 7, 270, 60, 60), rise: special(43, 24, 83, 16, 80, 60, 80), laser: special(16, 1, 42, 0, 0, 0, 0), reflect: special(1, 3, 24, 8, 90, 100, 0) },
};
const specials = Object.fromEntries(ROSTER.map(kind => [kind, kind === 'fox' || kind === 'falco' ? pilots[kind] : Object.fromEntries((['laser', 'dash', 'rise', 'reflect'] as const).map(move => {
  const a = SPECIALS[kind][move]; return [move, special(a.startup, a.active, a.end, a.projectile ? 0 : a.damage, a.angle, a.growth, a.base)];
}))])) as Record<FighterKind, Record<'laser' | 'dash' | 'rise' | 'reflect', MoveSpec>>;
export const getMove = (kind: FighterKind, move: Move): MoveSpec => move in names ? normal[kind][move as keyof typeof names] : specials[kind][move as keyof typeof pilots.fox];
export const aerialMoves = new Set<Move>(['aerial', 'forwardair', 'backair', 'upair', 'downair']);
