/** Environment collision against stageFrame(): solid blocks (floor/walls/ceiling), one-way platforms, ledges, carry. */
import { stageFrame, type Ledge, type StageId } from '../stages';
import { PHYSICS } from '../moveset';
import type { Fighter } from './types';

export type Env = ReturnType<typeof stageFrame>;
export type Surface = { id: string; left: number; right: number; y: number; dx: number; dy: number; solid: boolean };
export const envAt = (id: StageId, tick: number, hazards: boolean): Env => stageFrame(id, tick, hazards);
const EPS = 1e-4, STEP = .2;

export function surfaces(env: Env): Surface[] {
  return [...env.blocks.map(b => ({ id: b.id, left: b.left, right: b.right, y: b.top, dx: b.dx ?? 0, dy: b.dy ?? 0, solid: true })),
    ...env.platforms.map(p => ({ id: p.id, left: p.left, right: p.right, y: p.y, dx: p.dx, dy: p.dy, solid: false }))];
}
export const bodyHalf = (f: Fighter) => PHYSICS[f.kind].radius * .8;
export const bodyTop = (f: Fighter) => PHYSICS[f.kind].height * (f.state === 'crouch' ? .55 : .85);

export type MoveResult = { landed: Surface | null; wall: -1 | 0 | 1; ceiling: boolean };
/** Sweep a fighter by (dx, dy) in substeps. Platforms are skipped while dropping through. */
export function sweepAir(f: Fighter, env: Env, dx: number, dy: number, list = surfaces(env)): MoveResult {
  const res: MoveResult = { landed: null, wall: 0, ceiling: false }, w = bodyHalf(f), top = bodyTop(f);
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / STEP));
  for (let i = 0; i < n && !res.landed; i++) {
    const nx = f.x + dx / n;
    let x = nx;
    for (const b of env.blocks) {
      if (!(f.y + .05 < b.top && f.y + top > b.bottom)) continue;
      if (f.x + w <= b.left + EPS && nx + w > b.left) { x = Math.min(x, b.left - w); res.wall = 1; }
      else if (f.x - w >= b.right - EPS && nx - w < b.right) { x = Math.max(x, b.right + w); res.wall = -1; }
    }
    f.x = x;
    const ny = f.y + dy / n;
    if (dy <= 0) {
      let best: Surface | null = null;
      // Landing forgives a little overhang (Melee's ECB is wider than its center point) and snaps the feet onto the surface.
      const tol = w * .6;
      for (const s of list) if ((s.solid || f.dropThrough <= 0) && f.y >= s.y - Math.max(0, s.dy) - EPS && ny <= s.y && f.x >= s.left - tol && f.x <= s.right + tol && (!best || s.y > best.y)) best = s;
      if (best) { f.y = best.y; f.x = Math.max(best.left, Math.min(best.right, f.x)); res.landed = best; break; }
    } else {
      for (const b of env.blocks) if (f.y + top <= b.bottom + EPS && ny + top > b.bottom && f.x > b.left - w * .5 && f.x < b.right + w * .5) { res.ceiling = true; f.y = b.bottom - top; }
      if (res.ceiling) break;
    }
    f.y = ny;
  }
  return res;
}
/** Walls while grounded: raised blocks beside the floor stop horizontal motion. */
export function groundWalls(f: Fighter, env: Env, nx: number): number {
  const w = bodyHalf(f), top = bodyTop(f);
  for (const b of env.blocks) {
    if (!(f.y + .05 < b.top && f.y + top > b.bottom)) continue;
    if (f.x + w <= b.left + EPS && nx + w > b.left) nx = b.left - w;
    else if (f.x - w >= b.right - EPS && nx - w < b.right) nx = b.right + w;
  }
  return nx;
}
/** The surface a grounded fighter stands on this tick (moving surfaces carry by dx first), or an adjoining one at the same height. */
export function supportAt(list: Surface[], x: number, y: number, prefer: string | null): Surface | null {
  const own = prefer ? list.find(s => s.id === prefer) : undefined;
  if (own && x + own.dx >= own.left - EPS && x + own.dx <= own.right + EPS) return own; // judged where the surface carries the fighter
  return list.find(s => Math.abs(s.y - y) < .03 && x >= s.left && x <= s.right) ?? null;
}
/** Is there floor just ahead (for teetering and CPUs)? */
export const floorAhead = (list: Surface[], x: number, y: number) => list.some(s => Math.abs(s.y - y) < .03 && x >= s.left && x <= s.right);
export const isOccupied = (ledge: Ledge, fighters: Fighter[], self: Fighter) => fighters.find(o => o !== self && o.ledge === ledge.id && o.state === 'ledge');
/** Ledge snap box around the hang point, about 30% more generous than Melee. */
export function ledgeInReach(f: Fighter, ledge: Ledge): boolean {
  const p = PHYSICS[f.kind], out = (f.x - ledge.x) * ledge.side, rise = ledge.y - f.y;
  return out >= -p.radius * .6 && out <= (p.radius + .45) * 1.3 && rise >= p.height * .25 && rise <= p.height * 1.3;
}
export const hangPoint = (f: Fighter, ledge: Ledge) => ({ x: ledge.x + ledge.side * PHYSICS[f.kind].radius * .7, y: ledge.y - PHYSICS[f.kind].height * .8 });
/** Main-stage extents (the widest ledge-bearing block) for CPUs, respawns and offstage checks. */
export function mainStage(env: Env): { left: number; right: number; top: number } {
  const main = env.blocks.filter(b => b.ledges).sort((a, b) => (b.right - b.left) - (a.right - a.left))[0] ?? env.blocks[0];
  return main ? { left: main.left, right: main.right, top: main.top } : { left: -5, right: 5, top: 0 };
}
/** Moving or rising blocks (Pokémon Stadium, moving stages) never bury a fighter: feet inside a block pop onto its top. */
export function unstick(f: Fighter, env: Env) {
  if (f.state === 'ledge' || f.state === 'ledgeclimb' || f.state === 'respawn' || f.grabbedBy) return;
  for (const b of env.blocks) if (f.x > b.left + .02 && f.x < b.right - .02 && f.y < b.top - .01 && f.y > b.bottom) {
    f.y = b.top; f.vy = Math.max(0, f.vy); if (f.grounded) f.ground = b.id;
  }
}
