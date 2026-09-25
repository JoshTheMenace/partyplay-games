/**
 * Module commands through the generic command protocol. Paid commands are planner goals (plan.ts);
 * free ones run here by worth (advisor estimate, else hint × persona appetite). Map picks of
 * movable Explorers pieces head toward the mission points of interest.
 */
import { distance, type Point } from '../geometry';
import type { Action, Command } from '../model';
import { worth } from './advice/index';
import { face, positionOf } from './board';
import { total } from './cards';
import { act, type Ctx } from './context';
import { fill } from './prompts';
import type { Needs } from './trade';

const TILE_GOALS = new Set(['lair', 'spice', 'council', 'landing', 'fishing-ground']);

/** Where movable pieces want to go: fog to explore, lairs, spice, the council, depots, landings, grounds. */
function interests(c: Ctx): Point[] {
  const out: Point[] = [];
  const at = (id: string) => { const p = positionOf(c.ix, c.pub.pieces, id); if (p) out.push(p); };
  for (const f of c.pub.board.features) {
    if (f.kind === 'depot') at(f.vertex);
    else if (TILE_GOALS.has(f.kind)) at((f as { tile: string }).tile);
  }
  for (const r of Object.values(c.pub.pieces.reveals)) {
    if (r.feature && 'tile' in r.feature) at(r.feature.tile);
  }
  if (!out.length) out.push(...c.pub.board.tiles.filter(t => face(c.pub.pieces, t).terrain === 'fog'));
  return out;
}

/** The option id closest to any point of interest; null keeps the engine's first (sensible) option. */
export function toward(c: Ctx, ids: string[]): string | null {
  const goals = interests(c);
  if (!goals.length) return null;
  let best: string | null = null, bestD = Infinity;
  for (const id of ids) {
    const p = positionOf(c.ix, c.pub.pieces, id);
    const d = p ? Math.min(...goals.map(g => distance(p, g))) : Infinity;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

const PER_COMMAND = 3, PER_TURN = 12;

/** Run `cmd` with filled answers, counting it against the per-turn budget; null when unanswerable. */
export function commandAction(c: Ctx, cmd: Command, n: Needs): Action | null {
  const answer = fill(c, cmd, n);
  if (!answer) return null;
  c.mem.used[cmd.id] = (c.mem.used[cmd.id] ?? 0) + 1;
  return act(c, { type: 'command', command: cmd.id, ...answer });
}

const spent = (c: Ctx, cmd: Command) => c.mem.used[cmd.id] ?? 0;

/** Still within this turn's budget for `cmd` (guards against a command that changes nothing). */
export const budget = (c: Ctx, cmd: Command) =>
  spent(c, cmd) < PER_COMMAND && Object.values(c.mem.used).reduce((a, b) => a + b, 0) < PER_TURN;

/** Best free module command worth running now (worth ≥ 0.9, about hint 0.45), or null. */
export function moduleAction(c: Ctx, n: Needs): Action | null {
  const ranked = c.me.commands.filter(cmd => !(cmd.cost && total(cmd.cost)) && budget(c, cmd))
    .map(cmd => ({ cmd, v: c.jitter(worth(c, cmd)) })).filter(x => x.v >= 0.9).sort((a, b) => b.v - a.v);
  for (const { cmd } of ranked) {
    const action = commandAction(c, cmd, n);
    if (action) return action;
  }
  return null;
}
