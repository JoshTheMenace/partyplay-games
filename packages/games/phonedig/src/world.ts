/* Shared world primitives: the grid, the run's tunables, events, and the
 * queries that both the simulation and the monster AI need.
 *
 * PURE. No DOM, no clock, no Math.random — every source of randomness is
 * state.rng, seeded from the run seed. scripts/check-purity.sh enforces it.
 *
 * This file exists to break a cycle. engine.js needs stepMonster(); monsters.js
 * needs carve(), emit() and passable(). Rather than have the two import each
 * other — which works for hoisted declarations and then stops working the first
 * time someone reaches for a const at module scope — the shared half lives here
 * and both import downward.
 */

import {
  GRID, TUNE, DX, DY, bandOf, dirtValue, oreValue, laneClear, idx,
} from './worldgen';
import type {
  State, Player, Monster, Rock, Dir, Tune, Passable,
} from './model';

const { GW, GH, LW, LH } = GRID;

/* The run's tunables. TUNE is the frozen defaults; T is whatever the player has
 * bought, produced once per run by applyUpgrades() and installed with setTune().
 *
 * A module-level reference rather than threading a tune object through every
 * function: it is read in ~80 places, only one game exists at a time, and it is
 * set from deterministic data before the first step, so seeded replay is
 * unaffected. */
let T: Tune = TUNE;

export function setTune(tune: Tune | null | undefined) { T = tune || TUNE; }
export function tune() { return T; }

/* ── small helpers ────────────────────────────────────────────────────── */

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const overlaps = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) =>
  ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;

/* Aligned = sitting on a lane boundary, i.e. within tolerance of an even
 * coordinate. Turning is only legal at these points. */
export function alignOffset(v: number) {
  return v - 2 * Math.round(v / 2);
}

export function laneOf(v: number) { return Math.round(v / 2); }

export function dirtAt(state: State, c: number, r: number) {
  if (c < 0 || c >= GW || r < 0 || r >= GH) return 1;   // out of bounds reads as solid
  return state.dirt[idx(c, r)];
}

/* ── carving ──────────────────────────────────────────────────────────── */

/* Is the actor about to cut fresh ground?
 *
 * This must look at the first cell BEYOND the leading edge, not at a slightly
 * shifted copy of the AABB. carve() clears everything under the footprint every
 * frame, so the footprint is always already clear by the time we ask — a probe
 * that stays inside it reports "not digging" except on the frames where the
 * fractional position happens to straddle a cell boundary, and the dig-speed
 * penalty then applies only about a third of the time. */
export function diggingAhead(state: State, x: number, y: number, dir: Dir) {
  if ((dir & 1) === 1) {
    const c = dir === 1 ? Math.ceil(x + 2) : Math.floor(x) - 1;
    /* Past the edge of the played field there is nothing to dig — not a wall,
     * the end of the map. Bounding this by the storage array instead would find
     * the masked columns' solid ground out there and charge dig speed for
     * walking into the edge, which is a different game at the right-hand wall. */
    if (c < 0 || c >= state.activeGW) return false;
    const r0 = Math.max(0, Math.floor(y));
    const r1 = Math.min(GH - 1, Math.ceil(y + 2) - 1);
    for (let r = r0; r <= r1; r++) if (state.dirt[idx(c, r)] === 1) return true;
    return false;
  }
  const r = dir === 2 ? Math.ceil(y + 2) : Math.floor(y) - 1;
  if (r < 0 || r >= GH) return false;
  const c0 = Math.max(0, Math.floor(x));
  const c1 = Math.min(state.activeGW - 1, Math.ceil(x + 2) - 1);
  for (let c = c0; c <= c1; c++) if (state.dirt[idx(c, r)] === 1) return true;
  return false;
}

/* Zero every fine cell the AABB covers, reaching CARVE_LEAD ahead in the
 * direction of travel.
 *
 * Carving at fine (half-actor) resolution rather than per lane node is the whole
 * reason the grid is 20x160 instead of 10x80: at x=5.3 the footprint straddles
 * columns 5, 6 and 7, so a lane-resolution carve would have to either pop a
 * whole 2-cell chunk out at the boundary or dig through a wall before touching
 * it. Here the tunnel end just advances with the player.
 *
 * `pay` is false for anything that digs but is not the player — a Grub cutting
 * its own tunnel must not fill the player's hopper, or parking next to one is
 * free income. */
export function carve(state: State, x: number, y: number, dir: Dir, by?: Player | null) {
  /* `by` is the digger who gets paid. Omitted means the nearest one, which is
   * how a falling rock's shaft is credited — nobody owns the rock, but the
   * excavation it bores is real and somebody dug the hole it fell into.
   * Explicit null is the "cuts but earns nothing" case: a Grub's own tunnel and
   * the descent drill, neither of which may fill a hopper. */
  const earner = by === undefined ? nearestPlayer(state, x, y) : by;
  const paying = !!earner;
  let x0 = x, y0 = y, x1 = x + 2, y1 = y + 2;
  const lead = T.CARVE_LEAD;
  if (dir === 1) x1 += lead;
  else if (dir === 3) x0 -= lead;
  else if (dir === 2) y1 += lead;
  else if (dir === 0) y0 -= lead;

  const c0 = Math.max(0, Math.floor(x0)), c1 = Math.min(state.activeGW - 1, Math.ceil(x1) - 1);
  const r0 = Math.max(0, Math.floor(y0)), r1 = Math.min(GH - 1, Math.ceil(y1) - 1);
  let changed = 0;
  let earned = 0;
  let ore = 0;
  let air = 0;
  for (let r = r0; r <= r1; r++) {
    let rowHit = 0;
    for (let c = c0; c <= c1; c++) {
      const i = idx(c, r);
      if (state.dirt[i] === 1) {
        state.dirt[i] = 0;
        changed++;
        rowHit++;
        let v = dirtValue(bandOf(r), state.level, T);
        if (T.SIFTER > 0 && state.rng() < T.SIFTER) v *= 2;
        earned += v;
        const g = state.ore[i];
        if (g > 0) { ore += oreValue(g, T); state.ore[i] = 0; }
      }
    }
    // Per-row revision, so the view can rebuild one terrain chunk instead of
    // the whole shaft. state.dirtRev is global and says nothing about WHERE.
    if (rowHit) state.rowRev[r]++;
  }
  if (changed) {
    state.dirtRev++;
    state.carved += changed;
    /* Where the ground was cut, for anything in the simulation that cares.
     *
     * world.js may not import monsters.js — the dependency runs one way and a
     * cycle here is exactly what the file layout exists to prevent — so carve()
     * RECORDS and the monster step CONSUMES. It stays kind-agnostic: it does not
     * know a shark exists, only that something dug here and how much.
     *
     * Distinct from state.events, which is drained by the view. This one is
     * drained inside step(), before the monsters run, so a cell cut this frame
     * is felt this frame. */
    if (state.carveEvents) state.carveEvents.push({ x, y, cells: changed, pay: paying });
    // The hopper is the whole economy: excavation pays, and this is the only
    // place dirt is ever created. A falling rock routes through here too, which
    // is what makes setting one up worth the trouble.
    if (earner) {
      addDirt(state, earner, earned);
      if (ore > 0) addOre(state, earner, ore, x + 1, y + 1);
      air = takeAirPockets(state, c0, c1, r0, r1);
      if (air > 0) {
        earner.air = Math.min(earner.airMax, earner.air + air);
        emit(state, 'air', x + 1, y + 1, earner.air);
      }
    }
  }
  return changed;
}

/* How many rocks on the field were added DURING the level rather than seeded
 * into it by the generator.
 *
 * The budget for a hazard or a Mole has to be measured against the rocks it is
 * itself responsible for, never against state.rocks.length. The generator seeds
 * 12 rocks at level 1 and 28 by the cap, so a flat "no more than 24 rocks in
 * the array" ceiling quietly tightens with depth and then stops being a budget
 * at all: measured, Crystal's shardfall dropped 23 rocks over twenty runs under
 * the old test and 45 under this one, and at the 28-rock cap it — and the Mole,
 * which is why this was found — could never fire once. A limit that silently
 * becomes "never" at the depth the hazard was written for is worse than a
 * larger number; counting only what was added keeps it meaning what it says. */
export function spawnedRocks(state: State) {
  let n = 0;
  for (const r of state.rocks) if (r.fromHazard || r.fromMonster !== undefined) n++;
  return n;
}

/* Zero the whole LANE TILE containing (c, r), paying nothing.
 *
 * A tile, not a fine cell, and that distinction was a shipped bug rather than a
 * preference. Breaching Tip first cleared a single fine cell — a quarter of a
 * tile — on the reasoning that a peephole you can shoot through is not a route
 * you can walk. But the harpoon's own collision test samples ONE fine cell too,
 * so a quarter-tile hole is a permanent gap in exactly the line the harpoon
 * flies down, and it is far too small to read on a phone. Measured: firing at
 * the same wall every five seconds walked the harpoon's reach from 1.2 cells to
 * the full HARPOON_MAX of 6.0, through ground that still looked solid. The
 * player's report was "I can fire my hose through the dirt", which is precisely
 * what it was.
 *
 * Clearing the aligned tile makes the breach the same KIND of hole as digging:
 * whatever the terrain draws as open is what the harpoon can pass, with no
 * invisible state in between. It also makes repeated use pointless rather than
 * exploitable — one tile per five seconds is far slower than simply walking
 * into the wall, so it can never become a drill.
 *
 * Lives here, next to carve(), so the rowRev rule has exactly one home: anything
 * that clears dirt must bump state.rowRev[r] or the terrain chunk covering that
 * row never rebuilds and the dirt stays on screen after it is gone.
 *
 * The tile's ore goes with it, unpaid, matching a non-paying carve. Leaving it
 * behind would strand a grade in open air where nothing can ever collect it. */
export function breakTile(state: State, c: number, r: number) {
  // Snap to the lane grid so the hole lines up with tunnels rather than
  // straddling two tiles and leaving slivers of dirt on both sides.
  const c0 = Math.floor(c / 2) * 2;
  const r0 = Math.floor(r / 2) * 2;
  let cleared = 0;
  for (let rr = r0; rr <= r0 + 1; rr++) {
    if (rr < 0 || rr >= GH) continue;
    let rowHit = 0;
    for (let cc = c0; cc <= c0 + 1; cc++) {
      if (cc < 0 || cc >= state.activeGW) continue;
      const i = idx(cc, rr);
      if (state.dirt[i] !== 1) continue;
      state.dirt[i] = 0;
      state.ore[i] = 0;
      cleared++;
      rowHit++;
    }
    if (rowHit) state.rowRev[rr]++;
  }
  if (cleared) { state.carved += cleared; state.dirtRev++; }
  return cleared;
}

/* Sealed air pockets are found only by carving into them. Returns the refill. */
function takeAirPockets(state: State, c0: number, c1: number, r0: number, r1: number) {
  let got = 0;
  for (const q of state.pockets) {
    if (q.taken) continue;
    const c = q.lc * 2, r = q.lr * 2;
    if (c + 1 < c0 || c > c1 || r + 1 < r0 || r > r1) continue;
    q.taken = true;
    got += q.amount || T.AIR_POCKET;
  }
  return got;
}

/* Does this actor's 2x2 footprint overlap any solid dirt? */
export function footprintInDirt(state: State, x: number, y: number) {
  const c0 = Math.max(0, Math.floor(x)), c1 = Math.min(state.activeGW - 1, Math.ceil(x + 2) - 1);
  const r0 = Math.max(0, Math.floor(y)), r1 = Math.min(GH - 1, Math.ceil(y + 2) - 1);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) if (state.dirt[idx(c, r)] === 1) return true;
  }
  return false;
}

/** The nearest digger still on their feet, or null if the crew is all down. */
export function nearestPlayer(state: State, x: number, y: number): Player | null {
  let best: Player | null = null, bestD = Infinity;
  for (const q of state.players) {
    if (q.dying || q.downed) continue;
    const d = Math.hypot(q.x - x, q.y - y);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

/* ── occupancy ────────────────────────────────────────────────────────── */

/* Idle and wobbling rocks are solid to everything: player, monsters, harpoon. */
export function blockingRockAt(state: State, x: number, y: number, w: number, h: number, skip: Rock | null) {
  for (const r of state.rocks) {
    if (r === skip) continue;
    if (r.state !== 'idle' && r.state !== 'wobble') continue;
    if (overlaps(x, y, w, h, r.x, r.y, 2, 2)) return r;
  }
  return null;
}

export function rockOnNode(state: State, lc: number, lr: number) {
  for (const r of state.rocks) {
    if (r.state !== 'idle' && r.state !== 'wobble') continue;
    if (laneOf(r.x) === lc && laneOf(r.y) === lr) return true;
  }
  return false;
}

/* Some monsters are terrain. A Warden fills the corridor it is standing in and
 * a Geode never moves at all, so both have to be solid to the player and to
 * pathing — the same treatment a rock gets, and for the same reason. */
/* Diggers are deliberately NOT in here.
 *
 * Monsters walk through you — contact is damage, not a wall — and making the
 * crew solid would let one digger seal another into a dead-end tunnel they cut
 * themselves, which is the worst thing co-op can do to a player. They pass
 * through each other. */
export function blockingActorAt(state: State, x: number, y: number, w: number, h: number, skip: Monster | Player | null) {
  for (const m of state.monsters) {
    if (m === skip || m.dead || m.dying) continue;
    if (!m.k || !m.k.blocking) continue;
    if (m.mode === 'ghost' || m.mode === 'remat') continue;
    if (overlaps(x, y, w, h, m.x, m.y, 2, 2)) return m;
  }
  return null;
}

export function actorOnNode(state: State, lc: number, lr: number) {
  for (const m of state.monsters) {
    if (m.dead || m.dying) continue;
    if (!m.k || !m.k.blocking) continue;
    if (m.mode === 'ghost' || m.mode === 'remat') continue;
    if (laneOf(m.x) === lc && laneOf(m.y) === lr) return true;
  }
  return false;
}

/* LW is the STORAGE stride and never changes; state.activeLanes is how much of
 * it is in play. Every bounds test below uses the latter and every index the
 * former — mixing them is the one way to get this wrong, and the symptom is a
 * digging monster quietly tunnelling out of the map. */
export function passable(state: State, lc: number, lr: number) {
  if (lc < 0 || lc >= state.activeLanes || lr < 0 || lr >= LH) return false;
  return laneClear(state.dirt, lc, lr) && !rockOnNode(state, lc, lr) &&
         !actorOnNode(state, lc, lr);
}

/* ── events and ephemera ──────────────────────────────────────────────── */

export function emit(state: State, type: string, x?: number, y?: number, value?: number | string) {
  state.events.push({ type, x, y, value });
}

export function drainEvents(state: State) {
  const out = state.events;
  state.events = [];
  return out;
}

export function particles(state: State, x: number, y: number, kind: string, n: number, spread: number) {
  for (let i = 0; i < n; i++) {
    const ang = state.rng() * Math.PI * 2;
    const spd = spread * (0.35 + state.rng() * 0.9);
    state.particles.push({
      x, y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - spread * 0.3,
      life: 0.35 + state.rng() * 0.45,
      max: 0.8,
      size: 0.3 + state.rng() * 0.4,
      kind,
    });
  }
}

export function popup(state: State, x: number, y: number, text: string) {
  state.popups.push({ x, y, text, life: 0.9, max: 0.9 });
}

/* Add to the hopper, capped. Fractional cell values accumulate in `hopperFrac`
 * so a shallow-decayed cell worth 0.2 is not silently rounded away to nothing. */
export function addDirt(state: State, p: Player, amount: number, x?: number, y?: number, text?: string) {
  if (!(amount > 0)) return 0;
  const room = p.hopperMax - p.hopper;
  if (room <= 0) { p.hopperFull = true; return 0; }
  p.hopperFrac += Math.min(amount, room);
  const whole = Math.floor(p.hopperFrac);
  if (whole > 0) {
    p.hopperFrac -= whole;
    p.hopper = Math.min(p.hopperMax, p.hopper + whole);
    if (p.hopper >= p.hopperMax) p.hopperFull = true;
  }
  if (x !== undefined && y !== undefined) popup(state, x, y, text === undefined ? '+' + Math.round(amount) : text);
  return whole;
}

/* Ore rides in its own purse and is NOT capped by the hopper — the hopper holds
 * spoil, and a pocketful of gems weighs nothing. */
export function addOre(state: State, p: Player, amount: number, x: number, y: number) {
  if (!(amount > 0)) return 0;
  p.oreFrac += amount;
  const whole = Math.floor(p.oreFrac);
  if (whole > 0) {
    p.oreFrac -= whole;
    p.oreHeld += whole;
    if (x !== undefined) {
      popup(state, x, y, '+' + whole);
      emit(state, 'ore', x, y, whole);
    }
  }
  return whole;
}

/* ── pathing ──────────────────────────────────────────────────────────── */

const queue = new Int16Array(LW * LH);

/* Flood the lane grid from EVERY living digger at once.
 *
 * One breadth-first pass gives two things: the distance to the nearest digger,
 * and — carried alongside it — which digger that shortest path actually leads
 * to. A monster reads both, so "who is closest through the tunnels" costs the
 * same as it did with one player, rather than one flood per digger.
 *
 * Distance is through PASSABLE ground, not straight-line: a digger two cells
 * away through solid rock is not close, and that distinction is the whole of
 * the monster AI.
 *
 * Note the fill(-1) happens before the sources are checked, so a frame where
 * nobody is standing on a passable node leaves the map empty rather than stale.
 * That matches the original and the monsters already cope with it — distAt()
 * reading -1 is the same "cannot reach" answer a sealed cavity gives. */
export function repath(state: State) {
  const dist = state.dist, near = state.nearest;
  dist.fill(-1);
  near.fill(-1);

  let head = 0, tail = 0;
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    // A downed digger is not a source: monsters have no reason to path to
    // someone who is already out of the fight, and every step they take toward
    // one is a step away from the teammate coming to help.
    if (p.dying || p.downed) continue;
    const lc = clamp(laneOf(p.x), 0, state.activeLanes - 1);
    const lr = clamp(laneOf(p.y), 0, LH - 1);
    if (!passable(state, lc, lr)) continue;   // mid-carve: not a source this frame
    const n = lr * LW + lc;
    if (dist[n] !== -1) continue;             // two diggers sharing a node
    dist[n] = 0; near[n] = i;
    queue[tail++] = n;
  }

  while (head < tail) {
    const cur = queue[head++];
    const cc = cur % LW, cr = (cur - cc) / LW;
    const d = dist[cur], who = near[cur];
    for (let k = 0; k < 4; k++) {
      const nc = cc + DX[k], nr = cr + DY[k];
      if (!passable(state, nc, nr)) continue;
      const ni = nr * LW + nc;
      if (dist[ni] !== -1) continue;
      dist[ni] = d + 1;
      near[ni] = who;
      queue[tail++] = ni;
    }
  }
}

/** Which digger the shortest path from this node leads to, or null. */
export function nearestVia(state: State, lc: number, lr: number): Player | null {
  if (lc < 0 || lc >= state.activeLanes || lr < 0 || lr >= LH) return null;
  const i = state.nearest[lr * LW + lc];
  return i >= 0 ? (state.players[i] ?? null) : null;
}

export function distAt(state: State, lc: number, lr: number) {
  if (lc < 0 || lc >= state.activeLanes || lr < 0 || lr >= LH) return -1;
  return state.dist[lr * LW + lc];
}

/* Every lane node this actor can currently reach on foot, as a Set of node
 * indices. Small in practice — usually just its own cavity.
 *
 * `enter` lets a digging monster flood through solid ground; everything else
 * passes nothing and gets plain passability. */
export function componentOf(state: State, lc0: number, lr0: number, enter?: Passable) {
  const can: Passable = enter || ((s, lc, lr) => passable(s, lc, lr));
  const seen = state.seenScratch;
  seen.fill(0);
  const set = new Set<number>();
  let head = 0, tail = 0;
  if (can(state, lc0, lr0)) {
    const i0 = lr0 * LW + lc0;
    seen[i0] = 1; set.add(i0); queue[tail++] = i0;
  }
  while (head < tail) {
    const cur = queue[head++];
    const cc = cur % LW, cr = (cur - cc) / LW;
    for (let k = 0; k < 4; k++) {
      const nc = cc + DX[k], nr = cr + DY[k];
      if (nc < 0 || nc >= state.activeLanes || nr < 0 || nr >= LH) continue;
      const ni = nr * LW + nc;
      if (seen[ni] || !can(state, nc, nr)) continue;
      seen[ni] = 1; set.add(ni); queue[tail++] = ni;
    }
  }
  return set;
}
