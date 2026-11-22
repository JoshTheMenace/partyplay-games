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

import {
  GRID, RELIC_IDS, generateLevel, levelSeed, skyRowsFor, themeOf,
} from './worldgen';
import { readMonsters, readPlayers, readRocks } from './model';
import type { PlayerId } from '../../../party-contract/src/index';
import type {
  Dir, Edit, LaneNode, NetEvent, NetFire, NetHarpoon, NetMonster, NetPlayer, NetRock,
  NetWheel, Phase, PrivateView, PublicView, RosterEntry, ShaftCuts, ShaftWire, SiteWire,
} from './model';
import type {
  RenderState, ViewFire, ViewHarpoon, ViewMonster, ViewPlayer, ViewRock,
  ViewWheel,
} from './render';
import {
  MODE_IDS, ROCK_STATE_IDS, VARIANT_TINTS, kindName, variantName,
} from './bestiary';
import { SUIT_BY_ID } from './suits';

const { GW, GH } = GRID;

/* ── the roster ───────────────────────────────────────────────────────────
 *
 * Names, colours, suits and crews are sent every couple of seconds rather than
 * every frame, so each screen keeps the last list it was given. One per page:
 * the scene and the HUD are separate React trees looking at the same room. */
export type Roster = { round: string; entries: RosterEntry[]; byCrew: RosterEntry[][] };

let kept: Roster = { round: '', entries: [], byCrew: [] };

export function rosterOf(entries: readonly RosterEntry[], round = ''): Roster {
  const byCrew: RosterEntry[][] = [];
  for (const entry of entries) (byCrew[entry.crew] ??= []).push(entry);
  return { round, entries: [...entries], byCrew };
}

/** The roster for this round: the one just sent if there is one, else the last. */
export function remember(round: string, sent?: readonly RosterEntry[]): Roster {
  if (sent) kept = rosterOf(sent, round);
  else if (kept.round !== round) kept = { round, entries: [], byCrew: [] };
  return kept;
}

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
  /** Bumps whenever a cell is cut here; the lamp and the map repaint on it. */
  revision: number;
  /** The published revision this grid reflects, so a repeat snapshot is free. */
  applied: number;
  /** The newest journal batch applied. See ShaftCuts in model.ts. */
  have: number;
  /** The journal has a hole in it: ask the server for the whole ground. */
  gap: boolean;
  /** The generator's own, kept because the wire does not resend them. */
  skyRows: number;
  theme: string;
  rocks: LaneNode[];
  bonusAt: LaneNode;
  relicSite: { x: number; y: number; pool: string[] } | null;
  crystalAt: (LaneNode & { id: string }) | null;
};

/* A level is a pure function of (level, seed, lanes, entryLc), which is the
 * whole reason terrain does not have to cross the wire. Keyed on exactly those
 * four — and on whose shaft it is, because rival crews start on the same seed —
 * so a descent regenerates and a redelivered snapshot does not. */
type WorldFields = Pick<ShaftWire, 'crew' | 'run' | 'runSeed' | 'level' | 'entryLc' | 'lanes'>;
const keyOf = (v: WorldFields) =>
  `${v.crew}.${v.run}/${v.runSeed}/${v.level}/${v.entryLc}/${v.lanes}`;
/** Whether two snapshots describe the same generated world. */
export const sameWorld = (a: WorldFields, b: WorldFields) => keyOf(a) === keyOf(b);

/** Where a shaft's cut ground comes from: the cached public list, or a journal. */
export type GroundSource = { revision: number; edits: Edit[] } | ShaftCuts;

export function createGround(): { update(view: ShaftWire, source: GroundSource): Ground } {
  let g: Ground | null = null;

  /* Applied to the LIVE grid rather than to a fresh copy of the generated
   * one. Both are correct — see property 1 above — but only this way can a
   * row be marked dirty, because only this way is there anything to
   * compare against. A cell that is already cut costs one branch. */
  const cut = (ground: Ground, runs: readonly Edit[]) => {
    const { dirt, ore, rowRev } = ground;
    let changed = false;
    for (const [start, len] of runs) {
      for (let i = start; i < start + len; i++) {
        if (dirt[i] === 0) continue;
        dirt[i] = 0;
        ore[i] = 0;
        rowRev[(i / GW) | 0]++;
        changed = true;
      }
    }
    if (changed) ground.revision++;
  };

  return {
    update(view: ShaftWire, source: GroundSource): Ground {
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
          revision: 0,
          applied: -1,
          have: 0,
          gap: false,
          skyRows: data.skyRows,
          theme: data.theme,
          rocks: data.rocks,
          bonusAt: data.bonusAt,
          relicSite: data.relicSite
            ? { x: data.relicSite.at.x, y: data.relicSite.at.y, pool: data.relicSite.pool } : null,
          crystalAt: data.crystalAt
            ? { lc: data.crystalAt.lc, lr: data.crystalAt.lr, id: data.crystalAt.id } : null,
        };
      }
      if ('edits' in source) {
        if (g.applied === source.revision) return g;
        cut(g, source.edits);
        g.applied = source.revision;
        return g;
      }
      /* The journal. A batch is safe to replay, so the only question is whether
       * one was MISSED: the tail has to reach back to the last one applied. */
      if (source.base) { cut(g, source.base); g.have = source.cutTo; g.gap = false; }
      if (g.have >= source.cutFrom - 1) {
        if (source.cutTo > g.have) { cut(g, source.cuts); g.have = source.cutTo; }
        g.gap = false;
      } else {
        cut(g, source.cuts);            // true as far as it goes
        g.gap = true;
      }
      return g;
    },
  };
}

/* ── one shaft, decoded ───────────────────────────────────────────────── */

/* A shaft as every screen reads it: the packed wire turned back into named
 * things, with what the client can work out for itself filled in. Decoding
 * happens once per snapshot — twenty a second — rather than once per draw. */
export type ShaftView = {
  crew: number; run: number;
  runSeed: number; level: number; entryLc: number | null; lanes: number;
  activeGW: number; skyRows: number; theme: string;
  phase: Phase;
  deepest: number;
  shake: number;
  banked: number; oreBanked: number;
  lives: number; livesMax: number;
  left: number;
  /** The crew's hoppers together: what is at risk right now. */
  hopper: number;
  events: NetEvent[];
  players: NetPlayer[];
  monsters: NetMonster[];
  rocks: NetRock[];
  fire: NetFire[];
  wheels: NetWheel[];
  harpoons: NetHarpoon[];
  bonus: { x: number; y: number; value: number } | null;
  relicSite: { x: number; y: number; pool: string[] } | null;
  crystalAt: (LaneNode & { id: string }) | null;
};
/** The old name, kept for the modules that grew up with it. */
export type DecodedView = ShaftView;

const relicsOf = (bits: number) => RELIC_IDS.filter((_, i) => (bits >> i) & 1);

export function decodeShaft(wire: ShaftWire, ground: Ground, roster: Roster): ShaftView {
  const members = roster.byCrew[wire.crew] ?? [];
  const harpoons: NetHarpoon[] = [];
  let hopper = 0;
  const players = readPlayers(wire.players).map((row, i): NetPlayer => {
    const who = members[i];
    // Until the roster lands a digger is still a digger: placed, coloured, unnamed.
    const id = who?.id ?? `#${wire.crew}.${i}`;
    const { harpoon, relicBits, ...body } = row;
    if (harpoon) harpoons.push({ ownerId: id, x: row.x, y: row.y, ...harpoon });
    hopper += row.hopper;
    return {
      ...body, id,
      name: who?.name ?? 'Digger', color: who?.color ?? '#8b8378', suit: who?.suit || null,
      relics: relicsOf(relicBits),
    };
  });
  return {
    crew: wire.crew, run: wire.run,
    runSeed: wire.runSeed, level: wire.level, entryLc: wire.entryLc, lanes: wire.lanes,
    activeGW: wire.lanes * 2, skyRows: skyRowsFor(wire.level), theme: themeOf(wire.level).id,
    phase: wire.phase, deepest: wire.deepest, shake: wire.shake,
    banked: wire.banked, oreBanked: wire.oreBanked,
    lives: wire.lives, livesMax: wire.livesMax, left: wire.left,
    hopper,
    events: wire.events,
    players,
    monsters: readMonsters(wire.monsters, kindName,
      (k, i) => variantName(k, i), i => MODE_IDS[i] ?? 'patrol'),
    rocks: readRocks(wire.rocks, i => ROCK_STATE_IDS[i] ?? 'idle', wire.idle, wire.rock0, ground.rocks),
    fire: wire.fire,
    wheels: wire.wheels,
    harpoons,
    bonus: wire.bonus > 0
      ? { x: ground.bonusAt.lc * 2, y: ground.bonusAt.lr * 2, value: wire.bonus } : null,
    relicSite: wire.buried & 1 ? ground.relicSite : null,
    crystalAt: wire.buried & 2 ? ground.crystalAt : null,
  };
}

/* The crew of a shaft and nothing else, for the HUD: it needs names, health and
 * hoppers twenty times a second and has no use for the ground. */
export function crewIn(wire: ShaftWire, roster: Roster): NetPlayer[] {
  const members = roster.byCrew[wire.crew] ?? [];
  return readPlayers(wire.players).map((row, i): NetPlayer => {
    const who = members[i];
    const { harpoon: _harpoon, relicBits, ...body } = row;
    return {
      ...body, id: who?.id ?? `#${wire.crew}.${i}`,
      name: who?.name ?? 'Digger', color: who?.color ?? '#8b8378', suit: who?.suit || null,
      relics: relicsOf(relicBits),
    };
  });
}

/* The site summary arrives a few times a second rather than every frame, so —
 * like the roster — each screen keeps the last one. */
let site: { round: string; view: SiteWire | null } = { round: '', view: null };
export function recall(round: string, sent?: SiteWire): SiteWire | null {
  if (sent) site = { round, view: sent };
  else if (site.round !== round) site = { round, view: null };
  return site.view;
}

/* Which shaft a screen shows, and where its ground comes from.
 *
 * With one crew the public view is the shaft. With several it is the one the
 * television is on, and a phone's own arrives in its private view. */
export function shaftFor(view: PublicView, mine: PrivateView | null): { wire: ShaftWire; source: GroundSource } {
  return mine?.shaft ? { wire: mine.shaft, source: mine.shaft } : { wire: view, source: view };
}

/* One screen's reader: keeps the ground and turns each snapshot into a view. */
export function createReader() {
  const ground = createGround();
  let g: Ground | null = null;
  return {
    read(view: PublicView, mine: PrivateView | null, roster: Roster): ShaftView {
      const { wire, source } = shaftFor(view, mine);
      g = ground.update(wire, source);
      return decodeShaft(wire, g, roster);
    },
    /** The ground as of the last read. Null before the first. */
    ground: () => g,
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
  const numberFor = seatNumbers();

  return {
    /* `g` is the ground as of the newest snapshot. `shown` is a snapshot
     * interpolated toward the next one, and is where every position is read
     * from. They differ by a fraction of a tick and never by a level, because
     * blend() refuses to mix two and the buffer is cleared on a new world.
     *
     * `follow` is the digger the camera is on: this screen's own on a phone,
     * and whoever the television has picked out. */
    build(g: Ground, shown: ShaftView, follow: PlayerId | null, localId: PlayerId | null = follow): RenderState {
      const harpoons = new Map<PlayerId, ViewHarpoon>();
      for (const h of shown.harpoons) {
        harpoons.set(h.ownerId, {
          active: true, dir: h.dir, len: h.len, state: h.state,
        });
      }

      const players = shown.players.map((q): ViewPlayer => toPlayer(
        // Negative so a digger's track can never collide with a monster's id.
        q, -1 - numberFor(q.id), harpoons.get(q.id), q.id === localId));
      /* The followed digger's own readouts, not the crew's. */
      const mine = Math.max(0, shown.players.findIndex(q => q.id === follow));
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
        depth: (Math.max(1, shown.level) - 1) * GRID.LH + Math.floor((followed?.y ?? 0) / 2),
        deepest: shown.deepest,
        left: shown.left,

        dirt: g.dirt,
        ore: g.ore,
        pocketHint: g.pocketHint,
        dirtRev: g.revision,
        rowRev: g.rowRev,
        activeGW: shown.activeGW,
        activeLanes: shown.lanes,

        lightRadius: followed?.lightRadius ?? 0,
        air: followed?.air ?? 0,
        airMax: followed?.airMax ?? 0,
        relics: followed?.relics ?? [],

        player: me,
        players,
        monsters: shown.monsters.map(toMonster),
        rocks: shown.rocks.map(toRock),
        fire: shown.fire.map(toFire),
        wheels: shown.wheels.map(toWheel),
        bonus: shown.bonus
          ? { active: true, x: shown.bonus.x, y: shown.bonus.y, value: shown.bonus.value }
          : null,
        pockets: [],

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
export function blend(a: ShaftView, b: ShaftView, k: number): ShaftView {
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

function toPlayer(q: NetPlayer, id: number, harpoon: ViewHarpoon | undefined, local: boolean): ViewPlayer {
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
    // Everyone but this screen's own digger wears their name.
    ...(local ? {} : { label: q.name, tint: (q.suit && SUIT_BY_ID[q.suit]?.swatch) || q.color }),
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

function toFire(f: NetFire): ViewFire {
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

function toWheel(w: NetWheel): ViewWheel {
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
