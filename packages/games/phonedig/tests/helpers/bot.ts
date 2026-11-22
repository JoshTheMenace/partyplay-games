/* A digger that plays, for tests, the dev sandbox and the room-bot hook.
 *
 * It sees only what a phone sees — one shaft's decoded view and the ground
 * rebuilt from the seed — and answers with the held input a thumb would send.
 * It is deliberately a competent amateur: it digs to the nearest monster, lines
 * up, pumps, pulls fallen teammates up and steps out from under a loose rock.
 * It does not read a monster's mind or plan a rock drop, so its results are a
 * floor on what a crew can do rather than a ceiling.
 */

import { GRID, idx } from '../../src/worldgen';
import type { Dir, NetInput, State } from '../../src/model';

const { GH } = GRID;

/** The slice of a shaft the bot reads; a decoded shaft view satisfies it. */
export type BotSight = {
  phase: string;
  activeGW: number;
  skyRows: number;
  players: readonly { id: string; x: number; y: number; dir: Dir; downed: boolean; dying: boolean }[];
  monsters: readonly { id: number; kind: string; x: number; y: number; mode: string; dying: boolean; hunting: boolean; telegraph: number; dir: Dir }[];
  rocks: readonly { x: number; y: number; state: string }[];
  harpoons: readonly { ownerId: string; state: string }[];
};

/** What a bot may see of a shaft, read straight off its simulation: for tests
 *  and the sandbox, which have the state in hand and no wire to decode. */
export function sightOf(sim: State): BotSight {
  return {
    phase: sim.phase, activeGW: sim.activeGW, skyRows: sim.skyRows,
    players: sim.players.map(p => ({ id: p.seatId ?? '', x: p.x, y: p.y, dir: p.dir, downed: p.downed, dying: p.dying })),
    monsters: sim.monsters.filter(m => !m.dead),
    rocks: sim.rocks,
    harpoons: sim.players.filter(p => p.harpoon.active).map(p => ({ ownerId: p.seatId ?? '', state: p.harpoon.state })),
  };
}

export type BotMind = {
  pump: number;
  /** Calls made, which is the bot's only clock. */
  n: number;
  lastX: number; lastY: number; still: number;
  /** A detour in progress: a direction and the call it ends on. */
  side: Dir | null; sideUntil: number;
};

export type BotOptions = {
  /** Calls per second, so its timers mean seconds. */
  hz?: number;
  /** 0..1. Lower pumps slower and hesitates more. */
  skill?: number;
  /** Deterministic noise in 0..1; a seeded stream keeps a test repeatable. */
  random?: () => number;
  /** 0..1 across the shaft: the side this digger works, so a crew spreads out
   *  instead of four of them chasing one monster down one tunnel. */
  side?: number;
};

export const newMind = (pump = 0): BotMind =>
  ({ pump, n: 0, lastX: -1, lastY: -1, still: 0, side: null, sideUntil: 0 });

const REACH = 7;            // fine cells, inside the party tune's 8.4
const lane = (v: number) => 2 * Math.round(v / 2);

export function botInput(
  view: BotSight, dirt: Uint8Array, id: string, mind: BotMind, opts: BotOptions = {},
): NetInput {
  const hz = opts.hz ?? 20, skill = opts.skill ?? 1, random = opts.random ?? Math.random;
  const rest = (): NetInput => ({ dir: null, dirHeld: false, pumpSeq: mind.pump });
  const go = (dir: Dir): NetInput => ({ dir, dirHeld: true, pumpSeq: mind.pump });
  const me = view.players.find(q => q.id === id);
  mind.n++;
  if (!me || me.downed || me.dying || view.phase !== 'play') return rest();

  const solid = (c: number, r: number) =>
    c < 0 || c >= view.activeGW || r < view.skyRows || r >= GH || dirt[idx(c, r)] === 1;
  const rockAt = (x: number, y: number) => view.rocks.some(r =>
    (r.state === 'idle' || r.state === 'wobble') && Math.abs(r.x - x) < 2 && Math.abs(r.y - y) < 2);
  /** Can I take one lane step that way without leaving the field or meeting a rock? */
  const open = (dir: Dir) => {
    const x = me.x + [0, 2, 0, -2][dir], y = me.y + [-2, 0, 2, 0][dir];
    return x >= 0 && x <= view.activeGW - 2 && y >= view.skyRows && y <= GH - 2 && !rockAt(x, y);
  };
  /** Nothing but air between me and a point on my row or column. */
  const clear = (tx: number, ty: number) => {
    const x0 = Math.round(me.x) + 1, y0 = Math.round(me.y) + 1;
    const x1 = Math.round(tx) + 1, y1 = Math.round(ty) + 1;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 1; i < steps; i++) {
      const c = Math.round(x0 + (x1 - x0) * i / steps), r = Math.round(y0 + (y1 - y0) * i / steps);
      if (solid(c, r) || solid(c - 1, r - 1)) return false;
    }
    return true;
  };

  // A detour runs to its end, or the bot would dither against the same wall.
  if (mind.side !== null && mind.n < mind.sideUntil && open(mind.side)) return go(mind.side);
  mind.side = null;
  const detour = (dir: Dir, seconds: number) => { mind.side = dir; mind.sideUntil = mind.n + seconds * hz; return go(dir); };
  const sideways = (first: Dir, second: Dir, seconds = 0.45) =>
    open(first) ? detour(first, seconds) : open(second) ? detour(second, seconds) : rest();

  // A loose rock over my head outranks everything, the line included.
  const loose = view.rocks.some(r => (r.state === 'wobble' || r.state === 'falling')
    && Math.abs(r.x - me.x) < 2 && r.y < me.y + 1);
  if (loose) return me.x >= view.activeGW / 2 ? sideways(3, 1) : sideways(1, 3);

  const line = view.harpoons.find(h => h.ownerId === id);
  if (line) {
    // On the line: pump, at a pace a thumb manages. Reeling out or in: wait.
    if (line.state === 'hit' && mind.n % Math.max(2, Math.round(hz / (3 + 6 * skill))) === 0) mind.pump++;
    return rest();
  }
  if (random() > 0.55 + 0.45 * skill) return rest();          // a beat of looking at the screen

  // Standing still against something for too long means it will not give.
  const moved = Math.abs(me.x - mind.lastX) + Math.abs(me.y - mind.lastY) > 0.05;
  mind.still = moved ? 0 : mind.still + 1;
  mind.lastX = me.x; mind.lastY = me.y;

  // A breather winding up down my row: leave the row.
  const jet = view.monsters.some(m => m.telegraph > 0 && Math.abs(m.y - me.y) < 1.5 && Math.abs(m.x - me.x) < 15);
  if (jet) return sideways(0, 2);

  /* Who to go to. A fallen teammate first — the clock on them is shorter than
   * anything else down here — then the nearest thing that can be burst. */
  let tx = 0, ty = 0, found = false, phased = false, best = Infinity;
  for (const q of view.players) {
    if (q.id === id || !q.downed || q.dying) continue;
    const d = Math.abs(q.x - me.x) + Math.abs(q.y - me.y);
    if (d < best) { best = d; tx = q.x; ty = q.y; found = true; }
  }
  if (!found) for (const m of view.monsters) {
    if (m.dying || m.kind === 'geode') continue;
    const d = Math.abs(m.x - me.x) + Math.abs(m.y - me.y) - (m.hunting && Math.abs(m.x - me.x) + Math.abs(m.y - me.y) < 14 ? 6 : 0)
      + (opts.side === undefined ? 0 : Math.abs(m.x - opts.side * view.activeGW) * 1.5);
    if (d < best) { best = d; tx = m.x; ty = m.y; found = true; phased = m.mode === 'ghost' || m.mode === 'remat'; }
  }
  if (!found) return rest();

  const dx = tx - me.x, dy = ty - me.y;
  const sameRow = Math.abs(dy) < 0.7, sameCol = Math.abs(dx) < 0.7;
  const aim: Dir | null = sameRow ? (dx > 0 ? 1 : 3) : sameCol ? (dy > 0 ? 2 : 0) : null;
  const near = Math.abs(dx) + Math.abs(dy);

  if (aim !== null && near <= REACH && !phased && (clear(tx, ty) || near <= 3.5)) {
    if (me.dir !== aim) return go(aim);              // turn to face it
    if (mind.n % Math.max(2, Math.round(hz / 5)) === 0) mind.pump++;   // throw, and again if it missed
    return rest();
  }
  // Something intangible is on top of me: back off rather than stand in it.
  if (phased && near < 4) return sideways(dy > 0 ? 0 : 2, dx > 0 ? 3 : 1, 0.6);

  if (mind.still > 0.5 * hz) {
    mind.still = 0;
    const turn = (me.dir & 1) === 1 ? [dy > 0 ? 2 : 0, dy > 0 ? 0 : 2] : [dx > 0 ? 1 : 3, dx > 0 ? 3 : 1];
    return sideways(turn[0] as Dir, turn[1] as Dir, 0.6);
  }

  // Into its column first, then along it: a corridor is the clear line.
  const want: Dir = Math.abs(lane(tx) - me.x) > 0.6 ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
  if (open(want)) return go(want);
  const around = (want & 1) === 1 ? [dy >= 0 ? 2 : 0, dy >= 0 ? 0 : 2] : [dx >= 0 ? 1 : 3, dx >= 0 ? 3 : 1];
  return sideways(around[0] as Dir, around[1] as Dir, 0.6);
}
