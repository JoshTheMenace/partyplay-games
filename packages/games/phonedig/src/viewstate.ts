/* The snapshot, turned into something the renderer can draw.
 *
 * Upstream the drawing layer is handed the simulation's own state object. Here
 * it is handed a projection of a simulation running somewhere else, so this
 * module is the join: it rebuilds the ground from the seed, keeps the per-row
 * dirty counters the terrain cache needs, and reshapes the wire's entities into
 * the view types render.ts declares.
 *
 * Two properties of the simulation make the ground half of this work, and both
 * are asserted in tests/wire.test.ts rather than merely believed:
 *
 *   1. Ground is only ever CUT, never filled. So the run list describes the
 *      world as it IS, not as it changed — replaying it over the live grid is
 *      idempotent, a dropped snapshot costs nothing, and a client can never
 *      drift quietly behind.
 *   2. Ore is cleared only inside a carve. So there is no second delta: the
 *      same runs that clear dirt clear ore.
 *
 * Nothing here is allowed to feed back into the simulation, and nothing here
 * may read a clock — the renderer's only time source is the one view.ts injects.
 */

import { GRID, generateLevel, levelSeed } from './worldgen';
import { readMonsters, readRocks } from './model';
import type { PlayerId } from '../../../party-contract/src/index';
import type {
  Dir, NetMonster, NetPlayer, NetRock, PublicView,
} from './model';
import type {
  RenderState, ViewFire, ViewHarpoon, ViewMonster, ViewPlayer, ViewRock,
  ViewWheel,
} from './render';
import {
  MODE_IDS, ROCK_STATE_IDS, VARIANT_TINTS, kindName, variantName,
} from './bestiary';

const { GW, GH } = GRID;

/* ── the ground ───────────────────────────────────────────────────────── */

export type Ground = {
  /** Identity of the LEVEL. A change means regenerate, not patch. */
  key: string;
  /** Counts levels seen on this client. Stands in for state.levelSerial. */
  serial: number;
  dirt: Uint8Array;
  ore: Uint8Array;
  pocketHint: Uint8Array;
  /** Bumped per row as cells are cut; terrain.ts invalidates chunks on it. */
  rowRev: Int32Array;
  /** The revision this grid reflects, so a repeat snapshot is free. */
  revision: number;
  /** The generator's own, kept because the wire does not resend them. */
  skyRows: number;
  theme: string;
};

/* A level is a pure function of (level, seed, lanes, entryLc), which is the
 * whole reason terrain does not have to cross the wire. Keyed on exactly those
 * four so a descent regenerates and a redelivered snapshot does not. */
type WorldFields = Pick<PublicView, 'runSeed' | 'level' | 'entryLc' | 'lanes'>;
const keyOf = (v: WorldFields) =>
  `${v.runSeed}/${v.level}/${v.entryLc}/${v.lanes}`;
/** Whether two snapshots describe the same generated world. */
export const sameWorld = (a: WorldFields, b: WorldFields) => keyOf(a) === keyOf(b);

export function createGround(): { update(view: PublicView): Ground } {
  let g: Ground | null = null;

  return {
    update(view: PublicView): Ground {
      const key = keyOf(view);
      if (!g || g.key !== key) {
        const data = generateLevel(
          view.level,
          levelSeed(view.runSeed, view.level),
          {
            lanes: view.lanes,
            ...(view.entryLc === null ? {} : { entryLc: view.entryLc }),
          },
        );
        g = {
          key,
          serial: (g ? g.serial : 0) + 1,
          dirt: data.dirt,
          ore: data.ore,
          pocketHint: data.pocketHint,
          /* Fresh zeros, exactly as startLevel hands out upstream: every chunk
           * is stale against a cache built for the previous level. */
          rowRev: new Int32Array(GH),
          revision: -1,
          skyRows: data.skyRows,
          theme: data.theme,
        };
      }
      if (g.revision === view.revision) return g;

      /* Applied to the LIVE grid rather than to a fresh copy of the generated
       * one. Both are correct — see property 1 above — but only this way can a
       * row be marked dirty, because only this way is there anything to
       * compare against. A cell that is already cut costs one branch. */
      const { dirt, ore, rowRev } = g;
      for (const [start, len] of view.edits) {
        for (let i = start; i < start + len; i++) {
          if (dirt[i] === 0) continue;
          dirt[i] = 0;
          ore[i] = 0;
          rowRev[(i / GW) | 0]++;
        }
      }
      g.revision = view.revision;
      return g;
    },
  };
}

/* ── the entities ─────────────────────────────────────────────────────── */

/* Seat ids are strings and the animation layer keys its tracks by number, so
 * each seat is given a small integer the first time it is seen. Stable for the
 * life of the view, which is what a track needs: reusing a number would hand a
 * new digger the previous one's walk cycle mid-stride. */
function seatNumbers() {
  const seen = new Map<PlayerId, number>();
  return (id: PlayerId) => {
    let n = seen.get(id);
    if (n === undefined) { n = seen.size + 1; seen.set(id, n); }
    return n;
  };
}

const IDLE_HARPOON: ViewHarpoon = Object.freeze({
  active: false, dir: 1 as Dir, len: 0, state: 'idle' as const,
});

/** The renderer that turns one decoded snapshot into one drawable state. */
export type Adapter = ReturnType<typeof createAdapter>;

export function createAdapter() {
  const ground = createGround();
  const numberFor = seatNumbers();

  return {
    /* `raw` is the snapshot as it arrived — the terrain and the level identity
     * come from it. `shown` is the same snapshot interpolated toward the next
     * one, and is where every position is read from. They differ by a fraction
     * of a tick and never by a level, because blend() refuses to mix two. */
    build(
      raw: PublicView,
      shown: DecodedView,
      localId: PlayerId | null,
    ): RenderState {
      const g = ground.update(raw);

      const harpoons = new Map<PlayerId, ViewHarpoon>();
      for (const h of shown.harpoons) {
        harpoons.set(h.ownerId, {
          active: true, dir: h.dir, len: h.len, state: h.state,
        });
      }

      const players = shown.players.map(
        (q): ViewPlayer => toPlayer(q, numberFor(q.id), harpoons.get(q.id)));
      /* The followed digger's own readouts, not the lead's. The top-level fields
       * are the crew summary a shared screen shows; a phone shows its own. */
      const mine = Math.max(0, shown.players.findIndex(q => q.id === localId));
      const followed = shown.players[mine];
      const me = players[mine] ?? ABSENT_PLAYER;

      return {
        phase: shown.phase,
        theme: shown.theme,
        levelSerial: g.serial,
        worldKey: g.key,
        level: shown.level,
        skyRows: shown.skyRows,
        shake: shown.shake,
        depth: shown.depth,
        deepest: shown.deepest,

        dirt: g.dirt,
        ore: g.ore,
        pocketHint: g.pocketHint,
        dirtRev: g.revision,
        rowRev: g.rowRev,
        activeGW: shown.activeGW,
        activeLanes: shown.lanes,

        lightRadius: followed?.lightRadius ?? shown.lightRadius,
        air: followed?.air ?? shown.air,
        airMax: followed?.airMax ?? shown.airMax,
        relics: followed?.relics ?? shown.relics,

        player: me,
        players,
        monsters: shown.monsters.map(toMonster),
        rocks: shown.rocks.map(toRock),
        fire: shown.fire.map(toFire),
        wheels: shown.wheels.map(toWheel),
        bonus: shown.bonus
          ? { active: true, x: shown.bonus.x, y: shown.bonus.y, value: shown.bonus.value }
          : null,
        pockets: shown.pockets,

        /* Empty, and staying empty. Upstream the engine owns the particle and
         * popup lists; here they are made on the client by vfx.ts off the event
         * channel, so that every phone shows its own dust and none of it has to
         * cross the wire sixty times a second. */
        particles: [],
        popups: [],

        relicSite: shown.relicSite,
        crystalAt: shown.crystalAt,
      };
    },
  };
}

/* The snapshot with its packed entities unpacked. Decoding happens once per
 * snapshot — twenty a second — rather than once per draw. */
export type DecodedView = Omit<PublicView, 'monsters' | 'rocks'> & {
  monsters: NetMonster[];
  rocks: NetRock[];
};

export const decode = (v: PublicView): DecodedView => ({
  ...v,
  monsters: readMonsters(v.monsters, kindName,
    (k, i) => variantName(k, i), i => MODE_IDS[i] ?? 'patrol'),
  rocks: readRocks(v.rocks, i => ROCK_STATE_IDS[i] ?? 'idle'),
});

/* Past this many fine cells between two snapshots a thing was MOVED, not
 * walked: a respawn, a revive pull, a descent. The fastest digger covers under
 * half a cell in a 50 ms gap and knockback is 2.4, so 4 never clips real motion
 * and a teleport is drawn where it landed rather than sliding across the shaft. */
const SNAP_CELLS = 4;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function slide<T extends { x: number; y: number }>(was: T | undefined, now: T, k: number): T {
  if (!was || Math.abs(now.x - was.x) > SNAP_CELLS || Math.abs(now.y - was.y) > SNAP_CELLS) return now;
  return { ...now, x: lerp(was.x, now.x, k), y: lerp(was.y, now.y, k) };
}

const byId = <T extends { id: unknown }>(list: T[]) => new Map(list.map(e => [e.id, e]));

/* Interpolate between two authoritative frames. Positions only; state snaps.
 *
 * Only a new WORLD breaks continuity. A terrain revision does not: dirt changes
 * under a digger precisely while it is moving, and snapping on it turned every
 * dig into a stutter. */
export function blend(a: DecodedView, b: DecodedView, k: number): DecodedView {
  if (!sameWorld(a, b)) return b;
  const people = byId(a.players), monsters = byId(a.monsters), rocks = byId(a.rocks), wheels = byId(a.wheels);
  return {
    ...b,
    players: b.players.map(p => slide(people.get(p.id), p, k)),
    monsters: b.monsters.map(m => slide(monsters.get(m.id), m, k)),
    rocks: b.rocks.map(r => slide(rocks.get(r.id), r, k)),
    wheels: b.wheels.map(w => {
      const was = wheels.get(w.id), moved = slide(was, w, k);
      return was && moved !== w ? { ...moved, travel: lerp(was.travel, w.travel, k) } : moved;
    }),
  };
}

/* px/py are set equal to x/y throughout: the client has already interpolated
 * between two authoritative frames by the time it gets here, so the renderer's
 * own lerp has nothing left to do. See the note in render.ts. */

function toPlayer(q: NetPlayer, id: number, harpoon?: ViewHarpoon): ViewPlayer {
  return {
    id,
    x: q.x, y: q.y, px: q.x, py: q.y,
    dir: q.dir,
    digging: q.digging, moving: q.moving,
    dying: q.dying, dyingT: q.dyingT,
    invuln: q.invuln,
    suit: q.suit,
    harpoon: harpoon ?? IDLE_HARPOON,
    lightRadius: q.lightRadius,
    downed: q.downed,
    downT: q.downT,
    reviveProgress: q.reviveProgress,
  };
}

function toMonster(m: NetMonster): ViewMonster {
  return {
    id: m.id,
    kind: m.kind,
    variant: m.variant,
    /* Resolved here rather than sent: a variant's tint never changes, so it is
     * a table lookup on both sides and twelve bytes a monster saved. */
    tint: m.variant ? VARIANT_TINTS[m.variant] ?? null : null,
    x: m.x, y: m.y, px: m.x, py: m.y,
    dir: m.dir,
    mode: m.mode,
    hunting: m.hunting,
    markT: m.markT,
    pump: m.pump, stages: m.stages,
    alpha: m.alpha,
    telegraph: m.telegraph,
    dying: m.dying,
  };
}

function toRock(r: NetRock): ViewRock {
  return { id: r.id, x: r.x, y: r.y, px: r.x, py: r.y, state: r.state, t: r.t };
}

function toFire(f: PublicView['fire'][number]): ViewFire {
  return {
    x: f.x, y: f.y, w: f.w, h: f.h,
    dir: f.dir,
    t: f.t,
    ...(f.blast ? { blast: true } : {}),
    ...(f.ox === undefined ? {} : { ox: f.ox }),
    ...(f.oy === undefined ? {} : { oy: f.oy }),
    ...(f.growT === undefined ? {} : { growT: f.growT }),
    owner: f.owner,
  };
}

function toWheel(w: PublicView['wheels'][number]): ViewWheel {
  return {
    id: w.id,
    x: w.x, y: w.y, px: w.x, py: w.y,
    dir: w.dir,
    travel: w.travel, pTravel: w.travel,
  };
}

/* A state with no diggers in it at all is a real thing — a spectator who joins
 * between a wipe and the results screen — and every draw call reads `player`.
 * Parked off the field, dead, and carrying nothing. */
const ABSENT_PLAYER: ViewPlayer = Object.freeze({
  id: 0,
  x: 0, y: 0, px: 0, py: 0,
  dir: 2 as Dir,
  digging: false, moving: false,
  dying: false, dyingT: 0,
  invuln: 0,
  suit: null,
  harpoon: IDLE_HARPOON,
  lightRadius: 0,
  downed: false,
  downT: 0,
  reviveProgress: 0,
});

export { GW, GH };
