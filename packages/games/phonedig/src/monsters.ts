/* Monster kinds and monster behaviour.
 *
 * PURE, same contract as engine.js and world.js: no DOM, no clock, no
 * Math.random. Imports downward from world.js and content.js only — never from
 * engine.js, which imports this.
 */

import { GRID, TUNE, DX, DY } from './worldgen';
import {
  tune, clamp, overlaps, laneOf, dirtAt, carve, footprintInDirt, spawnedRocks,
  blockingRockAt, blockingActorAt, passable, emit, particles,
  nearestPlayer, nearestVia,
  distAt, componentOf,
} from './world';
import type {
  State, Monster, MonsterKind, MonsterSpec, Dir, Player, Tune, Variant,
} from './model';
import { KIND_IDS, VARIANT_IDS, VARIANT_TINTS } from './bestiary';

const { GH, LW, LH } = GRID;

/* ── the kind table ───────────────────────────────────────────────────────
 *
 * One row per monster. Everything a monster can differ in lives here, so a new
 * kind is a table entry rather than a branch in stepMonster(). Only reach for a
 * hook when the difference genuinely is not a number.
 *
 * Supported keys:
 *   speedMul       multiplier on MON_SPEED
 *   pumpMul        pumps to burst, as a MULTIPLE of the run's PUMP_STAGES
 *   pumpFixed      pumps to burst, as an absolute (only for kinds the harpoon
 *                  never sticks to, where the number is decoration)
 *   ghostMul       multiplier on the phase-out interval; <1 phases sooner
 *   fireMul        multiplier on the breath cooldown; <1 breathes more often
 *   blastMul       multiplier on SAPPER_RADIUS
 *   canGhost       may phase through rock at all (default true)
 *   harpoonImmune  the harpoon STOPS on it rather than sticking
 *   blocking       solid to the player and to pathing, like a rock
 *   static         never moves, and does NOT count toward clearing the level
 *   digs           cuts its own tunnels; changes what canEnter() allows
 *   breathes       fygar-style fire
 *   blastProof     a Sapper blast cannot pop it
 *   onDeath(state, m, byRock)   fires from popMonster, after the corpse is
 *                  marked. byRock is true when a falling rock did it.
 *   particle       particle kind for its death burst
 *
 * ── pump counts are a MULTIPLE, never a literal ─────────────────────────────
 *
 * `pumpMul` rather than `pumpStages`, because the base is a tunable the PLAYER
 * buys down (Pump Pressure, Quick Hands) and a literal 24 on the Warden would
 * make those upgrades a no-op on precisely the monster they matter most
 * against. A multiplier keeps every kind in proportion to whatever the base
 * currently is: at a base of 12 this table reads mite 3 / standard 12 /
 * warden 24, and the very same rows read 1 / 4 / 8 at a base of 4 — the numbers
 * the game shipped with — without one digit changing here.
 *
 * `pumpStages` survives as a read-only accessor on every kind object, because
 * entities.js (the inflation drawing) and bestiary.js (the stat row) both read
 * it straight off the kind and neither should have to learn about the
 * multiplier to keep telling the truth.
 */

export function pumpStagesFor(k: MonsterKind | null | undefined, base: number) {
  if (!k) return base;
  if (k.pumpFixed) return k.pumpFixed;
  const mul = k.pumpMul === undefined ? 1 : k.pumpMul;
  return Math.max(1, Math.round(base * mul));
}

function makeKind(row: MonsterKind) {
  const k = Object.assign({}, row);
  Object.defineProperty(k, 'pumpStages', {
    enumerable: true,
    get() { return pumpStagesFor(k, tune().PUMP_STAGES); },
  });
  return Object.freeze(k);
}

const KIND_ROWS: Record<string, MonsterKind> = {
  pooka: {
    id: 'pooka', particle: 'pooka',
    speedMul: 1, canGhost: true,
  },
  fygar: {
    id: 'fygar', particle: 'fygar',
    speedMul: 1, canGhost: true, breathes: true,
  },

  /* Mite — the proof that the table is enough on its own.
   *
   * Pure parameters, not one line of behaviour: one pump and it bursts, and it
   * runs at MITE_SPEED_MUL. 1.6 is not arbitrary — MON_SPEED * 1.6 is 7.36,
   * which is the number content.js quotes as the ceiling every monster speed
   * must stay under so the player's 8.0 in a clear tunnel is always an escape.
   * The Mite is the kind that sits ON that ceiling; nothing may go above it.
   *
   * It is meant to arrive several at a time out of one cavity, so the threat is
   * that you cannot reload between them, not that any one of them is hard. */
  mite: {
    id: 'mite', particle: 'mite',
    speedMul: TUNE.MITE_SPEED_MUL, pumpMul: 0.25, canGhost: true,
  },

  /* Sapper — dies loudly. See sapperBlast() for why the crater goes through
   * carve() and nowhere else. A rock-crushed Sapper blasts too, which is the
   * second job this gives boulders. */
  sapper: {
    id: 'sapper', particle: 'rock',
    speedMul: 1, canGhost: true,
    onDeath(state: State, m: Monster) { sapperBlast(state, m); },
  },

  /* Warden — a wall that walks.
   *
   * TWICE the base pump count is a long time to stand still holding a harpoon,
   * so the Warden is not something you fight on a whim; `blocking` means it
   * fills the corridor it is in, for the player and for pathing alike, exactly
   * as a rock does. Half speed is what makes that fair: you can always walk away
   * from it, you just cannot walk PAST it.
   *
   * At the shipped base of 12 that is 24 pumps, and the arithmetic that keeps it
   * a fight rather than an impossibility is DEFLATE_DELAY + DEFLATE_STEP: a pump
   * resets the timer to zero, so as long as taps land closer together than 1.7s
   * the count never falls. A Warden is not a race against deflation, it is a
   * commitment of standing-still seconds against the air and the cave-in clock.
   *
   * canGhost:false so it never phases out of the cavity it was placed to guard —
   * except when hunting, which mayGhost() forces and which must stay forced. */
  warden: {
    id: 'warden', particle: 'warden',
    speedMul: TUNE.WARDEN_SPEED_MUL, pumpMul: 2,
    canGhost: false, blocking: true,
  },

  /* Geode — the reason to bother setting up a rock.
   *
   * Immune to the only weapon you carry and immobile, so the harpoon clangs off
   * (stepHarpoon) and the only thing that kills it is something dropped on it.
   * It does NOT count toward clearing the level, and that is load-bearing twice
   * over: it guards ore rather than gating the descent, and a Geode with no rock
   * anywhere above it would otherwise be an unbreakable permanent soft-lock.
   *
   * blastProof for the same reason — if a Sapper could clear one, "only a rock"
   * would quietly stop being true and the boulder would lose the job again. */
  geode: {
    id: 'geode', particle: 'ore',
    /* pumpFixed, not pumpMul: the harpoon never sticks to a Geode, so this
     * number is never counted against anything. Scaling it with the base would
     * make the bestiary quote a pump count for a thing that cannot be pumped. */
    speedMul: 0, pumpFixed: 1,
    static: true, canGhost: false, harpoonImmune: true,
    blocking: true, blastProof: true,
  },

  /* Grub — it does not use your tunnels, it makes its own.
   *
   * The single most disruptive kind here, because a Grub joins cavities that the
   * generator went to some trouble to keep separate (see freeFor() in
   * content.js). That is deliberate and it is the point: it turns a level of
   * sealed pockets into a level with a hole through it. Keep it SLOW and RARE —
   * GRUB_SPEED is 2.0 against MON_SPEED's 4.6 — or it rewrites the level faster
   * than the player can read it.
   *
   * canGhost:false, and unlike the Warden the hunt does NOT override it: see
   * mayGhost(). A digger is never sealed in anything, so the stall that the
   * override exists to prevent cannot happen to it, and a hunting Grub that
   * phased would stop being a Grub. */
  grub: {
    id: 'grub', particle: 'grub',
    /* GRUB_SPEED is authored in content.js as an absolute cells/second so it
     * reads directly against MON_SPEED; the table takes a multiplier. */
    speedMul: TUNE.GRUB_SPEED / TUNE.MON_SPEED,
    digs: true, canGhost: false,
  },

  /* The shark SWIMS, and swimming is ghosting with the timer taken out.
   *
   * `ghost` mode already means the three things a submerged shark needs and
   * means all three in code that other kinds are already tested against: it
   * moves through solid ground without carving it, the harpoon passes through
   * it, and it cannot touch the player. Writing a fourth mode would mean
   * re-deriving every one of those exclusions in a second place.
   *
   * What is different is WHEN. Everything else ghosts episodically, on a random
   * interval, with a visible GHOST_WIND telegraph — because for them phasing is
   * an event. For a shark it is the resting state: `alwaysGhost` drives the mode
   * off the terrain under it instead, submerged whenever its footprint is in
   * dirt and solid whenever it is in open tunnel. There is no wind-up because
   * there is nothing to announce; it was always down there. The tell is the fin
   * ridge the view draws, not a flash.
   *
   * NO `digs`. That is the whole distinction from the Grub — a Grub cuts a
   * tunnel and permanently rewrites the level, where a shark leaves the ground
   * exactly as it found it and is therefore never a route for the player.
   *
   * SHARK_SURFACE is how long it stays up once it breaches, and the dive it
   * drives is not optional: solid movement goes through passable(), which
   * refuses dirt, so a shark that reached a tunnel could never step back into
   * the ground under its own power and would spend the rest of the level
   * walking a corridor like a slow Pooka. */
  shark: {
    id: 'shark', particle: 'shark',
    speedMul: 1.05, canGhost: true, alwaysGhost: true,
    frenzies: true,
  },

  /* The mole climbs ABOVE you and drops the ceiling on you.
   *
   * `digs` because it is a mole, and because the ability needs it: the rock has
   * to fall into open space, so the mole has to be able to reach the ground over
   * a tunnel you have already cut. `preferAbove` is one extra weight inside
   * chooseTarget(), not a targeting function of its own.
   *
   * canGhost:false for the Grub's reason — a digger is never sealed in, so the
   * stall that ghosting exists to prevent cannot happen to it — and mayGhost()'s
   * existing `!m.k.digs` clause already covers a hunting one. */
  mole: {
    id: 'mole', particle: 'rock',
    speedMul: TUNE.MOLE_SPEED / TUNE.MON_SPEED,
    digs: true, canGhost: false,
    preferAbove: true, dropsRocks: true,
  },
};

export const MONSTERS: Record<string, MonsterKind> = Object.freeze(Object.fromEntries(
  Object.entries(KIND_ROWS).map(([id, row]) => [id, makeKind(row)]),
));

/* ── the variant layer ────────────────────────────────────────────────────
 *
 * A variant is a ROW OF OVERRIDES on top of a base kind, and deliberately not a
 * new kind. `m.k` already resolves every per-kind parameter through one lookup,
 * so a variant is that same mechanism one level down: kindOf(kind, variant)
 * returns a frozen merge, and every consumer — stepMonster, the harpoon, the
 * blast, the bestiary — keeps reading exactly the fields it already read.
 *
 * Consequences of choosing overrides over kinds, all of them the point:
 *   - `m.kind` is unchanged, so anim.js still finds `pooka.walk.R`, the theme
 *     mixes still name seven things, and counts()/kindOf() cannot regress.
 *   - an unknown variant name falls back to the plain base kind in silence,
 *     the same contract kindOf() already had for an unknown kind.
 *   - the sprite sheet may or may not have the tinted set. `sprites.has()`
 *     already falls back, and `tint` below is a real colour so the view has
 *     something to modulate with even when the sheet is missing.
 *
 * ── the scales are RELATIVE ─────────────────────────────────────────────────
 *
 * speedScale/pumpScale/ghostScale/fireScale/blastScale multiply the BASE kind's
 * value rather than replacing it. That is what lets "a faster Grub" be written
 * once as 1.8 instead of as 0.783, and it means retuning GRUB_SPEED moves the
 * variant with it rather than silently making the variant the slow one.
 *
 * ── the ceiling ─────────────────────────────────────────────────────────────
 *
 * base.speedMul * speedScale may never exceed MITE_SPEED_MUL (1.6). content.js
 * documents MON_SPEED * 1.6 = 7.36 as the ceiling every monster speed stays
 * under so the player's 8.0 down a clear tunnel is always an escape, and that
 * is not negotiable — a variant the player cannot run from is not lethal-but-
 * fair, it is a coin flip. tests/monsters.mjs asserts it over the whole table.
 *
 * `minDepth` is in LANE ROWS out of LH=80, and it is the whole reason this is
 * weighted rather than uniform: the nasty ones live in the deep biomes. A
 * variant is rolled per monster in newMonster() from state.rng.
 */
export const VARIANTS: Record<string, readonly Variant[]> = Object.freeze({
  pooka: Object.freeze([
    /* The player's own words: "a blue pooka that's faster". It is the fastest
     * thing that is not a Mite, and it is the introduction to the whole layer,
     * so it is available from the top and it changes exactly one number. */
    { id: 'azure', name: 'Azure Pooka', tint: '#5aa9ff',
      minDepth: 0, weight: 3, speedScale: 1.45, pumpScale: 0.75 },
    { id: 'basalt', name: 'Basalt Pooka', tint: '#8a7f72',
      minDepth: 28, weight: 2, speedScale: 0.85, pumpScale: 1.5 },
    /* Phases at half the interval. The wind-up is untouched — GHOST_WIND is the
     * one thing a variant may never shorten, because an un-telegraphed phase is
     * the main source of deaths that feel unearned. */
    { id: 'wraith', name: 'Wraith Pooka', tint: '#b98cff',
      minDepth: 44, weight: 2, speedScale: 1.1, ghostScale: 0.5 },
  ]),

  fygar: Object.freeze([
    /* The player's other named request: "a red fygar that can tunnel through
     * dirt". A digging firebreather is coherent rather than merely additive —
     * it arrives through the wall and then breathes down the corridor it just
     * cut, and because clipFire measures CLEAR ground it can only breathe once
     * it is actually standing in open tunnel. */
    { id: 'ember', name: 'Ember Fygar', tint: '#ff5a3c',
      minDepth: 18, weight: 2, speedScale: 0.8, over: { digs: true } },
    { id: 'smoulder', name: 'Smoulder Fygar', tint: '#ffb347',
      minDepth: 8, weight: 3, speedScale: 1.15, pumpScale: 0.85, fireScale: 0.45 },
    { id: 'slag', name: 'Slag Fygar', tint: '#6f5a4a',
      minDepth: 40, weight: 2, speedScale: 0.8, pumpScale: 1.75, fireScale: 0.8,
      over: { blastProof: true } },
  ]),

  mite: Object.freeze([
    /* A Mite sits ON the speed ceiling already, so neither of these may be
     * faster — the axis a Mite variant has left is the arithmetic of the swarm.
     * hardshell doubles the pumps each one costs, which against three of them
     * in one corridor is the difference between a reload and a retreat. */
    { id: 'hardshell', name: 'Hardshell Mite', tint: '#7fe0c0',
      minDepth: 12, weight: 3, speedScale: 0.75, pumpScale: 2 },
    { id: 'ashling', name: 'Ashling Mite', tint: '#c8b7ff',
      minDepth: 30, weight: 2, ghostScale: 0.4 },
  ]),

  sapper: Object.freeze([
    { id: 'creeper', name: 'Creeper Sapper', tint: '#ff7b9c',
      minDepth: 6, weight: 3, speedScale: 1.35, pumpScale: 0.5, blastScale: 0.9 },
    { id: 'primed', name: 'Primed Sapper', tint: '#ffd24a',
      minDepth: 20, weight: 2, speedScale: 1.15, blastScale: 1.5 },
    { id: 'deepcharge', name: 'Deep Charge', tint: '#ff4d2e',
      minDepth: 46, weight: 1, speedScale: 0.7, pumpScale: 1.5, blastScale: 1.8 },
  ]),

  warden: Object.freeze([
    { id: 'ironclad', name: 'Ironclad Warden', tint: '#9fb4c9',
      minDepth: 24, weight: 2, speedScale: 0.7, pumpScale: 1.25 },
    /* A blocking digger. It cannot create dirt, only remove it, so it can never
     * seal the player anywhere — what it does is drag its own wall into ground
     * the level did not have a corridor in. */
    { id: 'quarryman', name: 'Quarryman Warden', tint: '#c08a4a',
      minDepth: 38, weight: 1, speedScale: 1.2, over: { digs: true } },
    /* The one variant that turns canGhost back ON for a kind whose table says
     * no. That is a real escalation and it is why it is deep and light: the
     * Warden's promise is "it stays where it was placed", and a Sentinel is the
     * level telling you that promise has expired. */
    { id: 'sentinel', name: 'Sentinel Warden', tint: '#8f7bff',
      minDepth: 32, weight: 1, speedScale: 1.4, pumpScale: 0.75, ghostScale: 0.5,
      over: { canGhost: true } },
  ]),

  geode: Object.freeze([
    /* Still static, still harpoon-immune, still only broken by a dropped rock —
     * but now the rock that opens it sets off a crater. The reward for lining
     * the boulder up is unchanged; the cost is that you do not stand next to it
     * while it lands. */
    { id: 'thunderegg', name: 'Thunderegg', tint: '#ffd76a',
      minDepth: 20, weight: 2, blastScale: 1.15,
      over: { onDeath(state: State, m: Monster) { sapperBlast(state, m); } } },
    /* The opposite trade: it gives up blastProof, so a Sapper chain is a second
     * answer to it. A Geode is scenery either way — counts() is false for both,
     * so neither can ever gate the descent. */
    { id: 'druse', name: 'Druse Geode', tint: '#7fd4ff',
      minDepth: 34, weight: 2, over: { blastProof: false } },
  ]),

  grub: Object.freeze([
    { id: 'borer', name: 'Borer Grub', tint: '#ff9f4a',
      minDepth: 22, weight: 2, speedScale: 1.8, pumpScale: 0.75 },
    { id: 'nacre', name: 'Nacre Grub', tint: '#e8dcff',
      minDepth: 34, weight: 2, speedScale: 0.85, pumpScale: 1.5 },
  ]),

  shark: Object.freeze([
    /* A shark's axis is the surfacing, so its variants trade along it. The
     * Sandskimmer is quick and cheap to burst — it breaches often and dies to
     * one good stand — where the Hammerhead is slower and takes half again as
     * many pumps, so its window is the one you have to be ready for.
     *
     * Neither touches alwaysGhost. A shark that stopped swimming would not be a
     * variant of a shark, it would be a Pooka with a fin. */
    { id: 'sandskimmer', name: 'Sandskimmer', tint: '#7fd8e0',
      minDepth: 40, weight: 3, speedScale: 1.15, pumpScale: 0.7 },
    { id: 'hammerhead', name: 'Hammerhead', tint: '#8d9bb0',
      minDepth: 52, weight: 2, speedScale: 0.85, pumpScale: 1.5 },
    /* The one that breaks the lesson.
     *
     * A player learns a Shark in one sentence: it cannot touch you until it
     * surfaces, so back off and wait for the window. Both variants above trade
     * along that lesson — quicker window, tougher window — and neither is a
     * surprise, because the answer is still "back off and wait".
     *
     * An Emberfin surfaces and BREATHES. Backing off down the corridor is
     * exactly the wrong move, and it is wrong for a reason the player already
     * has a rule for, from a monster four biomes shallower. It only breathes in
     * its short surfaced window and it still telegraphs for the full 0.9s, so
     * it adds a decision rather than removing the counterplay. */
    { id: 'emberfin', name: 'Emberfin', tint: '#e07a4a',
      minDepth: 60, weight: 1, speedScale: 0.85, pumpScale: 1.25,
      over: { breathes: true } },
  ]),

  mole: Object.freeze([
    /* The Pitcher drops more often and moves less; the Deepdelver is a proper
     * digger that rewrites the ceiling on its way to standing over you. */
    { id: 'pitcher', name: 'Pitcher Mole', tint: '#d9a066',
      minDepth: 52, weight: 3, speedScale: 0.8, pumpScale: 0.8 },
    { id: 'deepdelver', name: 'Deepdelver Mole', tint: '#a1745a',
      minDepth: 60, weight: 2, speedScale: 1.4, pumpScale: 1.4 },
    /* Kills you after you have killed it.
     *
     * The Mole's lesson is "it is only dangerous while it is above you", and
     * the natural habit that follows is to stand under one and pump it. A
     * Deadfall lets go of one last rock as it bursts — from exactly where it
     * was standing, under exactly the same guards a living one uses, which
     * includes never spawning one on top of the player. So it is survivable by
     * moving, and it punishes the one position the kind teaches you to take. */
    { id: 'deadfall', name: 'Deadfall Mole', tint: '#8a6a4a',
      minDepth: 66, weight: 1, speedScale: 0.85, pumpScale: 0.8,
      over: { onDeath(state: State, m: Monster) { dropRockFrom(state, m); } } },
  ]),
});

export function variantsOf(name: string) { return VARIANTS[name] || EMPTY_VARIANTS; }
const EMPTY_VARIANTS = Object.freeze([]);

/* Merge a variant row onto a base kind row. Scales multiply, `over` replaces. */
function mergeVariant(row: MonsterKind, v: Variant) {
  const out = Object.assign({}, row, v.over || {});
  out.variant = v.id;
  out.variantName = v.name;
  out.tint = v.tint;
  const num = (x: number | undefined, d: number) => (x === undefined ? d : x);
  if (v.speedScale !== undefined) out.speedMul = num(row.speedMul, 1) * v.speedScale;
  if (v.pumpScale !== undefined) out.pumpMul = num(row.pumpMul, 1) * v.pumpScale;
  if (v.ghostScale !== undefined) out.ghostMul = num(row.ghostMul, 1) * v.ghostScale;
  if (v.blastScale !== undefined) out.blastMul = num(row.blastMul, 1) * v.blastScale;
  if (v.fireScale !== undefined) out.fireMul = num(row.fireMul, 1) * v.fireScale;
  return out;
}

/* One frozen kind object per (kind, variant) pair, built once and shared.
 *
 * Shared identity matters beyond the allocation: `m.k` is compared by reference
 * nowhere today, but a fresh object per monster would make it tempting to, and
 * would put a dozen near-identical frozen objects on the heap per level. */
const VARIANT_CACHE = new Map();

export function kindOf(name: string, variant?: string | null) {
  /* An unknown KIND falls back to the plain Pooka and stops there — it does not
   * then go looking for the variant. The generator has already shipped a mix
   * naming `mites` when the kind was `mite`, and the symptom was nothing at all
   * because the fallback is silent; the last thing that failure mode needs is
   * for a typo to hand back something FASTER than the kind it stood in for. */
  if (!KIND_ROWS[name]) return MONSTERS.pooka;
  const base = name;
  if (!variant) return MONSTERS[base];
  const list = VARIANTS[base];
  const v = list && list.find((q) => q.id === variant);
  if (!v) return MONSTERS[base];        // unknown variant: the plain kind, silently
  const key = base + '/' + v.id;
  let k = VARIANT_CACHE.get(key);
  if (!k) { k = makeKind(mergeVariant(KIND_ROWS[base], v)); VARIANT_CACHE.set(key, k); }
  return k;
}

/* How likely a monster is to be a variant at all, and which one.
 *
 * Depth is the dominant term and level is the secondary one, so the deep biomes
 * are where the nasty ones live — which is also where `minDepth` has let more of
 * the table in, so the two effects compound in the right direction. Capped, so
 * a deep late level still reads as a level of the kinds the player knows with
 * some of them wrong, rather than as a different game.
 *
 * Every draw is from state.rng: this runs inside newMonster, i.e. inside
 * startLevel, so a seed reproduces the whole roster including its tints. */
const VARIANT_CHANCE_MAX = 0.6;

export function rollVariant(state: State, kind: string, lr: number, level: number) {
  const list = VARIANTS[kind];
  if (!list || !list.length) return null;
  const row = lr || 0;
  const depthT = clamp(row / LH, 0, 1);
  const levelT = clamp(((level || 1) - 1) / 12, 0, 1);
  const chance = Math.min(VARIANT_CHANCE_MAX, 0.06 + 0.34 * depthT + 0.2 * levelT);
  if (state.rng() >= chance) return null;
  let total = 0;
  const open = [];
  for (const v of list) {
    if (row < v.minDepth) continue;
    open.push(v);
    total += v.weight;
  }
  if (!open.length) return null;
  let roll = state.rng() * total;
  for (const v of open) { roll -= v.weight; if (roll <= 0) return v.id; }
  return open[open.length - 1].id;
}

/* Which lane nodes this monster may enter.
 *
 * A digger ignores dirt entirely and is stopped only by rock and by the field
 * edge; everything else needs a carved, unoccupied node. This is the single
 * seam that lets a tunnelling monster share chooseTarget() with a walking one. */
export function canEnter(state: State, m: Monster, lc: number, lr: number) {
  /* A blocking kind may not step ONTO the player, and this is not politeness.
   *
   * passable() deliberately knows nothing about the player — the player is not
   * terrain — so nothing else stops a Warden from walking over them. And a
   * blocking monster's node is impassable, so the moment one stands on the
   * player, repath() finds its own seed node impassable, bails on the spot, and
   * the ENTIRE distance field reads -1 for every monster on the level at once.
   * Symptom: every monster in the level simultaneously forgets where the player
   * is and the hunter starts phasing on its timer from arm's length. Cheaper to
   * refuse the step than to make everything downstream tolerate a dead map.
   *
   * Contact damage is unaffected: the engine's overlap test does not care whose
   * lane node is whose, and a Warden pinning you against a wall still hurts. */
  if (m.k && m.k.blocking) {
    for (const q of state.players) {
      if (overlaps(lc * 2, lr * 2, 2, 2, q.x, q.y, 2, 2)) return false;
    }
  }
  if (m.k && m.k.digs) {
    // A digger can enter solid ground, so only the played width stops it.
    if (lc < 0 || lc >= state.activeLanes || lr < 0 || lr >= LH) return false;
    /* Rock AND blocking actors. `blocking` is meant to read as terrain — a
     * Warden fills its corridor and a Geode never moves — so a digger must be
     * stopped by one just as it is by a boulder. Skipping the actor check here
     * was the one seam through which a Grub could walk out the far side of a
     * Geode, which would have made the Geode's whole reason to exist optional.
     * `m` is excluded because a mid-move digger's own footprint straddles two
     * nodes and would otherwise block itself. */
    return !blockingRockAt(state, lc * 2, lr * 2, 2, 2, null) &&
           !blockingActorAt(state, lc * 2, lr * 2, 2, 2, m);
  }
  return passable(state, lc, lr);
}

/* ── the Sapper's blast ───────────────────────────────────────────────────
 *
 * Everything the crater frees goes through carve(), the SAME call the player's
 * own digging makes, and it goes through it PAYING. That is not a convenience:
 * dirt is paid per cell excavated and never per kill (see popMonster), so if the
 * blast had its own dirt-clearing path it would either pay nothing — making a
 * Sapper worth less than the ground it is standing on — or pay a lump per kill,
 * which is the one thing the economy is built to refuse. Routed through carve(),
 * a Sapper is worth exactly the volume it opens: it is a free shift of digging
 * that you have to survive. Ore, air pockets and per-row dirty tracking come
 * along for free, which is the other half of the argument for reusing the call.
 *
 * carve()'s footprint is a fixed 2x2 stamp, so the disc test is applied to the
 * CENTRE of each stamp. Testing the top-left instead dilates the crater one cell
 * down and one cell right, which is visible as an off-centre blast.
 *
 * The damage is a rect pushed into state.fire, because that is already the
 * engine's "this region hurts" path (stepFire) and it carries invulnerability,
 * knockback and death with it. monsters.js cannot call hurtPlayer() — engine.js
 * imports this file, so importing engine.js back would be the exact cycle
 * world.js exists to break. The rect outliving the bang by FIRE_ACTIVE is kept
 * on purpose: the crater stays hot for a beat, so a blast is not a free doorway
 * to sprint through.
 */
/* Drop one rock from where this monster is standing. Returns whether it went.
 *
 * The monster pushes a rock into state.rocks in 'wobble' and then owns none of
 * it — stepRocks() does the fall, the boring, the crush, the chain and the
 * shatter. That is the same shape stepHazards() uses for dripstone, and it is
 * why this is a dozen lines rather than a second physics implementation.
 *
 * The wobble is not decoration. It is the player's only warning, and reusing
 * the existing state means the warning a Mole gives is the warning the player
 * has already been taught by every loose rock in the game.
 *
 * Every guard has a reason: open ground below, or the rock has nothing to fall
 * through; not on the player, because a rock spawned inside someone is a death
 * with no warning at all; no rock already there, or they stack; and the spawn
 * budget, because a Mole left alone in a tunnelled-out level would otherwise
 * fill the array.
 *
 * Shared with the Deadfall Mole's onDeath, which is the whole reason it is a
 * function: a dying Mole must drop exactly the rock a living one would, under
 * exactly the same guards, or the two would drift apart. */
function dropRockFrom(state: State, m: Monster) {
  const T = tune();
  const c = Math.round(m.x), row = Math.round(m.y);
  if (dirtAt(state, c, row + 2) !== 0 || dirtAt(state, c + 1, row + 2) !== 0) return false;
  if (state.players.some((q) => overlaps(c, row, 2, 2, q.x, q.y, 2, 2))) return false;
  if (blockingRockAt(state, c, row, 2, 2, null)) return false;
  if (spawnedRocks(state) >= T.ROCK_SPAWN_MAX) return false;
  state.rocks.push({
    id: state.nextId++,
    x: c, y: row, px: c, py: row,
    state: 'wobble', t: T.ROCK_WOBBLE, vy: 0,
    chain: 0, openRun: 0, crushLeft: 0, lastRow: 0,
    fromMonster: m.id,
  });
  emit(state, 'wobble', c + 1, row + 1);
  return true;
}

function sapperBlast(state: State, m: Monster) {
  const T = tune();
  // blastMul is the variant seam: a Deep Charge opens a crater half again as
  // wide, and because the radius is read ONCE here it also widens the damage
  // rect and the chain test, which is the only way those three stay honest.
  const R = T.SAPPER_RADIUS * ((m.k && m.k.blastMul) || 1);
  const cx = m.x + 1, cy = m.y + 1;          // actor centre, in fine cells
  const rr = R * R;

  const c0 = clamp(Math.floor(cx - R - 1), 0, state.activeGW - 1);
  const c1 = clamp(Math.ceil(cx + R), 0, state.activeGW - 1);
  const r0 = clamp(Math.floor(cy - R - 1), 0, GH - 1);
  const r1 = clamp(Math.ceil(cy + R), 0, GH - 1);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const dx = c + 1 - cx, dy = r + 1 - cy;
      if (dx * dx + dy * dy > rr) continue;
      // dir -1 so no CARVE_LEAD spills out. The crater is excavation and pays
      // the nearest digger, the same way a falling rock's shaft does.
      carve(state, c, r, -1);
    }
  }

  state.fire.push({
    x: cx - R, y: cy - R, w: R * 2, h: R * 2,
    dir: 1, t: T.FIRE_ACTIVE, owner: m, blast: true,
  });
  particles(state, cx, cy, 'rock', 18, 9);
  state.shake = Math.max(state.shake, 0.4);
  emit(state, 'blast', cx, cy, R);

  /* The chain, bounded. popMonster() already refuses a corpse, so mutual
   * neighbours cannot ping-pong; the cap is here because a LINE of Sappers
   * would otherwise unzip the whole level from one harpoon, which is a fun
   * accident exactly once and a wrecked level every time after. `blastDepth` is
   * the generation of the blast that killed it: the original is 1, and a blast
   * only sets off another while it is shallower than SAPPER_CHAIN_MAX. */
  const depth = m.blastDepth || 1;
  if (depth >= T.SAPPER_CHAIN_MAX) return;
  for (const o of state.monsters) {
    if (o === m || o.dead || o.dying) continue;
    if (o.mode === 'ghost' || o.mode === 'remat') continue;   // intangible both ways
    if (o.k && o.k.blastProof) continue;
    const dx = o.x + 1 - cx, dy = o.y + 1 - cy;
    if (dx * dx + dy * dy > rr) continue;
    o.blastDepth = depth + 1;
    popMonster(state, o, false);
  }
}

export function newMonster(state: State, spec: MonsterSpec, i: number): Monster {
  const x = spec.lc * 2, y = spec.lr * 2;
  const T = tune();
  /* `spec.variant === null` means "plainly this kind, roll nothing" and is what
   * the harness uses to keep a scenario deterministic; `undefined` means the
   * caller has not thought about it, which is the generator, and gets a roll.
   * The two must stay distinguishable or every test in tests/monsters.mjs
   * becomes a measurement of the variant table instead of of the kind. */
  const variant = spec.variant === undefined
    ? rollVariant(state, spec.kind, spec.lr, state.level)
    : spec.variant;
  const k = kindOf(spec.kind, variant);
  return {
    id: state.nextId++,
    kind: spec.kind,
    variant: k.variant || null,
    tint: k.tint || null,
    k,
    x, y, px: x, py: y,
    home: { lc: spec.lc, lr: spec.lr },
    tc: spec.lc, tr: spec.lr,
    dir: 3,
    mode: 'patrol',            // patrol | chase | ghostwind | ghost | remat | pumped | dying
    hunting: false,            // last one standing: comes for the player
    markT: 0,                  // "it is coming for you" flash on becoming the hunter
    windT: 0,                  // ghost wind-up remaining
    ghostGoal: null,           // open ground this ghost is migrating toward
    ghostFrom: null,           // the area it left, so it lands in a NEW one
    ghostComp: null,           // a hunter's commute: the player's component,
                               // snapshotted at phase-out. Null for everyone else.
    pump: 0, pumpT: 0,
    stun: 0,
    ghostT: T.GHOST_MAX,
    ghostTimer: 0,
    stuckT: 0,
    rematT: 0,
    alpha: 1,
    telegraph: 0,
    fireCd: (1.5 + i * 0.4) * ((k.fireMul) || 1),
    /* Staggered by index for the same reason fireCd is: a level that spawns
     * three moles should not have all three drop on the same frame forever. */
    dropCd: k.dropsRocks ? 1.0 + i * 0.3 : 0,
    // A shark starts in the ground, so it starts with no surface time left.
    surfaceT: 0,
    frenzy: 0,
    // Set only on frames a digger's carve() actually cut ground; read by anim.
    digging: false,
    // A submerged shark that has arrived on the player and is committed to a
    // clear node it can actually come up on. See the ghost branch.
    breaching: false,
    dying: false, dyingT: 0, dead: false,
    crushed: false,
    blastDepth: 0,             // generation of the Sapper blast that killed it
  };
}

/* How many pumps this one takes. Reads the accessor on the kind, which scales
 * with whatever PUMP_STAGES the player's upgrades have left the run on. */
export function pumpStages(m: Monster) {
  return (m && m.k && m.k.pumpStages) || tune().PUMP_STAGES;
}

/* Kills pay NO dirt — that is the pillar the whole economy rests on. You are
 * paid to excavate, so a monster is not income, it is what stands between you
 * and the seam it is sitting on. Clearing the level is what opens the way down;
 * that access is the reward. */
export function popMonster(state: State, m: Monster, byRock?: boolean) {
  if (m.dying || m.dead) return;
  m.dying = true;
  m.dyingT = 0.3;
  m.mode = 'dying';
  particles(state, m.x + 1, m.y + 1, (m.k && m.k.particle) || 'pooka', 10, 6);
  emit(state, 'pop', m.x + 1, m.y + 1);
  if (m.k && m.k.onDeath) m.k.onDeath(state, m, byRock);
}

/* Monsters that count toward clearing the level. A static kind is scenery with
 * a grudge — it guards ground rather than gating the descent, so leaving one
 * alive must not strand the player. */
export function counts(m: Monster) {
  return !m.dead && !(m.k && m.k.static);
}

/* Which digger this monster is coming for.
 *
 * The flood already answered it: repath() carries, alongside the distance, the
 * index of the digger each node's shortest path leads to. So "nearest through
 * the tunnels" is a lookup rather than a search, and it is the RIGHT question —
 * a digger two cells away through solid rock is not close.
 *
 * Falls back to straight-line only when the monster is off the flood entirely,
 * which is every monster sealed in its own cavity at the start of a level. */
function targetOf(state: State, m: Monster): Player | null {
  const lc = clamp(laneOf(m.x), 0, state.activeLanes - 1), lr = clamp(laneOf(m.y), 0, LH - 1);
  const via = nearestVia(state, lc, lr);
  if (via && !via.dying && !via.downed) return via;
  return nearestPlayer(state, m.x, m.y);
}

/* ── the hunt ─────────────────────────────────────────────────────────── */

/* The last survivor stops patrolling and comes for the player.
 *
 * It replaces an escape state that never worked. A monster running for the
 * surface spends the whole trip inside dirt, and anything inside dirt has to be
 * intangible or it is visibly walking through rock — so it was never killable,
 * however the exit was arranged. Hunting inverts the geometry: it phases only to
 * close the distance and then rematerialises in open ground beside the player,
 * where it is solid, lethal and killable. The player always stands in a tunnel,
 * so there is always somewhere for it to land.
 *
 * Termination no longer needs a timer. The level ends when you kill it, and it
 * is coming to you to make that possible. */
export function beginHunt(state: State, m: Monster) {
  m.hunting = true;
  m.markT = tune().HUNT_MARK;
  m.ghostTimer = 0;
  m.stuckT = 0;
  m.alpha = 1;
  emit(state, 'hunt', m.x + 1, m.y + 1);
}

/* A hunter may ALWAYS phase, whatever its kind says.
 *
 * Without this a non-ghosting kind that becomes the last survivor is sealed in
 * its own cavity with no route to the player and no way for the player to reach
 * it before the roof falls — the level stalls with nothing on screen to explain
 * why. Hunting is the one state where mobility is a correctness requirement. */
function mayGhost(m: Monster) {
  if (!m.k) return true;
  if (m.k.canGhost !== false) return true;
  /* WEDGED is not GUARDING, and this second override is the difference.
   *
   * stuckT only accrues on a frame where chooseTarget() found no legal step at
   * all — every neighbour dirt, rock, blocking actor or field edge — and it
   * decays the moment one appears. So STUCK_GHOST seconds of it does not mean
   * "pacing a small cavity", it means "has had nowhere to go, continuously, for
   * two and a half seconds". A monster in that state is not defending the
   * ground it was placed on; it is scenery with a hitbox, and the level has one
   * fewer monster in it than it says it has.
   *
   * This showed up the moment the generator raised rock density (5 -> 12 at
   * level 1, 10 -> 28 at the cap): a Warden is `blocking`, passable() excludes
   * rock nodes AND other blocking actors, and canEnter() refuses a step onto
   * the player — so a Warden seeded in a short cavity on a deep level could
   * find all four neighbours closed and sit out the entire level. Not a
   * soft-lock, because the hunt override below frees it once it is the last one
   * alive, but inert for everything before that.
   *
   * It costs canGhost:false very little of what it promises. A Warden with room
   * to pace never accrues stuckT and so still never phases — tests 4b and 4c
   * both pin exactly that — and a Grub, which cannot be wedged by dirt because
   * it eats dirt, only reaches this when it is boxed in by boulders on all four
   * sides, at which point "it has its own way through" has stopped being true. */
  if (m.stuckT >= tune().STUCK_GHOST) return true;
  /* One exemption from the HUNT override, and only one: a DIGGER is never
   * sealed in anything. The stall this forcing exists to prevent is "no route
   * to the player", and a Grub always has a route — it cuts one. Letting the
   * hunt override it would have a Grub phase through rock it was about to
   * tunnel through anyway, which is both redundant and the wrong monster. */
  return m.hunting && !m.k.digs;
}

/* Distance along the BFS gradient at this monster's OWN node.
 *
 * A `blocking` kind is solid to pathing, and passable() consults actorOnNode(),
 * so it is solid to pathing including to itself: repath() never floods the node
 * a Warden is standing on and distAt() reads -1 under its own feet, forever.
 * Uncorrected that breaks it twice — it never enters 'chase' and so never walks
 * toward the player, and as a hunter canWalkToPlayer is false even when it is
 * touching them, so it re-phases on its timer and flickers between intangible
 * and solid. That flicker is exactly the failure the hunt comment above records
 * having already fixed once. Rebuild the value from nearby ground instead.
 *
 * TWO nodes of relaxation, not one. Its immediate neighbours are not enough,
 * because repath() only runs every REPATH_EVERY and the map is therefore up to a
 * quarter of a second stale: in a one-wide corridor the node the BFS believes
 * the Warden is standing on is the node it was standing on last repath, so BOTH
 * its own node and the neighbour it just came from read -1 and the whole
 * corridor beyond it is unreachable. Two nodes covers that, and cannot fail to:
 * the slowest thing that may be `blocking` moves well under one lane node
 * between repaths. Beyond two the Manhattan term stops being a fair stand-in for
 * the path, so this does not want to grow. */
const BLOCK_RELAX = 2;
function hereDist(state: State, m: Monster) {
  const lc = laneOf(m.x), lr = laneOf(m.y);
  const d = distAt(state, lc, lr);
  if (d >= 0 || !m.k || !m.k.blocking) return d;
  let best = -1;
  for (let dr = -BLOCK_RELAX; dr <= BLOCK_RELAX; dr++) {
    for (let dc = -BLOCK_RELAX; dc <= BLOCK_RELAX; dc++) {
      const away = Math.abs(dc) + Math.abs(dr);
      if (away === 0 || away > BLOCK_RELAX) continue;
      const n = distAt(state, lc + dc, lr + dr);
      if (n < 0) continue;
      if (best < 0 || n + away < best) best = n + away;
    }
  }
  return best;
}

/* ── movement ─────────────────────────────────────────────────────────── */

function chooseTarget(state: State, m: Monster) {
  const lc = laneOf(m.x), lr = laneOf(m.y);
  const back = (m.dir + 2) & 3;
  const here = hereDist(state, m);
  const p = targetOf(state, m);
  if (!p) return;
  /* A digger is almost always INSIDE dirt, where the BFS gradient does not
   * reach — repath() floods only passable nodes, so distAt() reads -1
   * everywhere and the "toward the player" weighting below would never fire.
   * It would wander at random, which looks like a dumb monster rather than
   * like a bug. Steer it by Manhattan bias instead. Running a second flood
   * fill per digger per repath is not worth LW*LH per monster.
   *
   * The blind weight is 6 where the sighted one is 3, and that gap is measured,
   * not aesthetic. With 3 against two rival directions a blind digger is only
   * ~58% likely to close, which over the ~50 decisions a slow Grub gets in a
   * level is a random walk with a lean — the distance-to-player trend was inside
   * the noise. It also matters more here than for a walker: every step a digger
   * takes is a PERMANENT tunnel, so a Grub that keeps changing its mind webs the
   * level with galleries nobody asked for. A digger commits.
   *
   * ── ALWAYS, for a digger, not only when the gradient is missing ─────────────
   *
   * This used to read `here < 0 && digs`, and the `here < 0` was a bug with a
   * long fuse. A digger carves as it goes, so its own tunnel is passable; the
   * moment that tunnel touches anything the player has dug, repath() floods into
   * it and `here` stops being -1. The Manhattan bias then switched OFF — and the
   * BFS bias that replaced it is useless to a digger, because every direction it
   * actually cares about is unexcavated dirt, which is not passable, which reads
   * distAt() = -1, which never satisfies `d < here`. So the one monster in the
   * game that ignores terrain lost its steering precisely when it got close
   * enough to the player's workings to matter, and every option collapsed to
   * w = 1: a pure random walk.
   *
   * Manhattan is not an approximation for a digger, it is exact. Distance
   * through dirt IS |dc| + |dr| when dirt does not stop you, and only rock and
   * the field edge do. So a digger uses it unconditionally and never consults
   * the gradient at all. */
  const digger = !!(m.k && m.k.digs);
  const pc = laneOf(p.x), pr = laneOf(p.y);
  const nowFar = Math.abs(lc - pc) + Math.abs(lr - pr);
  const opts = [];
  let total = 0;
  for (let k = 0; k < 4; k++) {
    const nc = lc + DX[k], nr = lr + DY[k];
    if (!canEnter(state, m, nc, nr)) continue;
    const d = distAt(state, nc, nr);
    let w = 1;
    let toward = false;
    if (digger) {
      if (Math.abs(nc - pc) + Math.abs(nr - pr) < nowFar) { w = 6; toward = true; }
    } else if (here >= 0 && d >= 0 && d < here) {
      w = 3; toward = true;                          // toward the player
    }
    /* `preferAbove` is the mole's whole plan, and it is one weight rather than a
     * targeting function of its own: get OVER the player and stay there, because
     * its attack only works downward. Getting level with you is no use to it.
     *
     * Ranked deliberately above the digger's plain closing weight of 6, so when
     * "closer" and "higher" disagree the mole climbs. rows increase downward, so
     * strictly above is nr < pr. The horizontal test is <=, not <: once it is
     * lined up over your column, holding that column IS progress. */
    if (m.k && m.k.preferAbove && nr < pr &&
        Math.abs(nc - pc) <= Math.abs(lc - pc)) {
      w = 10; toward = true;
    }
    /* Reversing is a last resort — but only into a corridor. A digger has no
     * corridor: every direction is fresh ground, so "back" is a fact about the
     * gallery it has already cut and says nothing about where the player is.
     * Crushing a CLOSING direction to 0.15 because the digger happened to
     * overshoot on the other axis is how it used to circle its own tunnel. The
     * exemption is scoped to diggers so no other kind's tuning moves. */
    if (k === back && !(digger && toward)) w = 0.15;
    opts.push({ k, nc, nr, w });
    total += w;
  }
  if (!opts.length) { m.tc = lc; m.tr = lr; return false; }

  /* The gradient shortcut takes the strictly-closest step and ignores every
   * weight above it, which is right for a chaser and wrong for the mole: the
   * shortest route to the player is the one that ends up NEXT to them, and a
   * mole next to you is harmless. It has to arrive over your head instead, so
   * it keeps the weighted roll even while chasing. */
  const gradientChase = !(m.k && m.k.preferAbove);
  if (gradientChase && m.mode === 'chase' && here >= 0) {
    let best = null;
    for (const o of opts) {
      const d = distAt(state, o.nc, o.nr);
      if (d < 0) continue;
      if (!best || d < best.d) best = { d, o };
    }
    if (best) { m.tc = best.o.nc; m.tr = best.o.nr; m.dir = best.o.k; return true; }
  }

  let roll = state.rng() * total;
  for (const o of opts) {
    roll -= o.w;
    if (roll <= 0) { m.tc = o.nc; m.tr = o.nr; m.dir = o.k; return true; }
  }
  const last = opts[opts.length - 1];
  m.tc = last.nc; m.tr = last.nr; m.dir = last.k;
  return true;
}

function moveToTarget(state: State, m: Monster, speed: number, dt: number) {
  const tx = m.tc * 2, ty = m.tr * 2;
  const dx = tx - m.x, dy = ty - m.y;
  const d = Math.abs(dx) + Math.abs(dy);
  const step = speed * dt;
  if (d <= step || d === 0) { m.x = tx; m.y = ty; return true; }
  if (Math.abs(dx) >= Math.abs(dy)) {
    m.x += Math.sign(dx) * step;
    m.dir = dx > 0 ? 1 : 3;
  } else {
    m.y += Math.sign(dy) * step;
    m.dir = dy > 0 ? 2 : 0;
  }
  return false;
}

/* Open ground this monster cannot already reach on foot.
 *
 * Used by everything that is NOT hunting: it takes the nearest node outside its
 * own component and drifts toward whatever the player has been digging. Falls
 * back to the player if all open ground is already reachable. */
function nearestForeignOpen(state: State, m: Monster) {
  const own = componentOf(state, clamp(laneOf(m.x), 0, state.activeLanes - 1), clamp(laneOf(m.y), 0, LH - 1));
  let best = null;
  for (let lr = 0; lr < LH; lr++) {
    for (let lc = 0; lc < state.activeLanes; lc++) {
      const i = lr * LW + lc;
      if (own.has(i) || !passable(state, lc, lr)) continue;
      const x = lc * 2, y = lr * 2;
      const d = Math.hypot(x - m.x, y - m.y);
      if (!best || d < best.d) best = { d, x, y };
    }
  }
  const p = targetOf(state, m);
  return best || (p ? { x: p.x, y: p.y } : { x: m.x, y: m.y });
}

/* ── the hunter's commute ─────────────────────────────────────────────────
 *
 * A hunter's phase is a COMMUTE, not a chase. It picks the nearest node in the
 * PLAYER'S OWN connected component, phases to that, rematerialises, and from
 * there hunts on foot — solid, lethal and killable — for as long as a walking
 * route to the player exists.
 *
 * This replaces a stepping-stone heuristic that scored open ground by
 * (distance to it) + (distance onward to the player). That was a proxy for
 * "somewhere on the way", and like most proxies it was wrong in the case that
 * mattered: a node in a THIRD sealed pocket that happened to sit between the
 * two scored better than the near end of the player's own tunnel, so the hunter
 * landed in a room with no exit and immediately phased again. What the player
 * saw was a thing that spent its approach intangible and only went solid at
 * arm's length. componentOf() answers the question the heuristic was estimating,
 * exactly, and for the cost of one flood fill per phase-out.
 *
 * Two things this must never do, both already true above and both easy to lose:
 * it may not land ON the player (a life with no counterplay), and it may not
 * skip GHOST_WIND (an un-telegraphed phase is the main unearned death).
 *
 * ── it must not give up when the player is mid-carve ────────────────────────
 *
 * The obvious implementation floods from the player's own lane node and returns
 * null if that node is not passable, which is what repath() does. Measured, that
 * threw the commute away most of the time: a lane node is passable only once all
 * FOUR of its fine cells are clear, and a player who is walking is a player who
 * is digging, so their node reads impassable for most of the frames they are
 * moving. The hunter fell back to the old nearest-foreign-open rule on 10 phases
 * in 18 — the commute was correct and almost never used, which is the most
 * expensive kind of correct.
 *
 * So it seeds from the nearest passable node instead, spiralling out. The player
 * is always ADJACENT to carved ground — they just walked out of it — so this
 * terminates within a node or two, and the component it finds is the one they
 * are about to be standing in. Still returns null in the genuinely degenerate
 * case (nothing carved anywhere near them), and the caller still falls back. */
const PLAYER_SEED_RADIUS = 3;
function playerComponent(state: State, m: Monster) {
  const p = targetOf(state, m);
  if (!p) return null;
  const pc = clamp(laneOf(p.x), 0, state.activeLanes - 1);
  const pr = clamp(laneOf(p.y), 0, LH - 1);
  let sc = -1, sr = -1;
  if (passable(state, pc, pr)) { sc = pc; sr = pr; }
  else {
    for (let rad = 1; rad <= PLAYER_SEED_RADIUS && sc < 0; rad++) {
      for (let dr = -rad; dr <= rad && sc < 0; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          if (!passable(state, pc + dc, pr + dr)) continue;
          sc = pc + dc; sr = pr + dr;
          break;
        }
      }
    }
  }
  if (sc < 0) return null;
  const comp = componentOf(state, sc, sr);
  return comp.size ? comp : null;
}

function nearestInComponent(state: State, m: Monster, comp: Set<number>) {
  const p = targetOf(state, m);
  if (!p) return null;
  let best = null;
  for (const i of comp) {
    const lc = i % LW, lr = (i - lc) / LW;
    // Never aim at the node the player is standing on.
    if (overlaps(lc * 2, lr * 2, 2, 2, p.x, p.y, 2, 2)) continue;
    const x = lc * 2, y = lr * 2;
    const d = Math.hypot(x - m.x, y - m.y);
    if (!best || d < best.d) best = { d, x, y };
  }
  return best;
}

/* Where this monster is going, and what counts as having arrived.
 *
 * Sets m.ghostGoal for both cases and m.ghostComp for the hunter, which is the
 * landing test: a snapshot rather than a live query because carving only ever
 * MERGES components, so a stale snapshot is a subset of the truth and landing
 * in it is still landing somewhere the player can be walked to. */
function planPhase(state: State, m: Monster) {
  m.ghostComp = null;
  if (m.hunting) {
    const comp = playerComponent(state, m);
    const goal = comp && nearestInComponent(state, m, comp);
    if (goal) { m.ghostComp = comp; m.ghostGoal = goal; return; }
  }
  m.ghostGoal = nearestForeignOpen(state, m);
}

/* Nearest lane node whose 2x2 is entirely clear. A digger always stands in
 * carved space, so at worst the spiral finds the node under their feet — which
 * is what guarantees a ghost can always come back.
 *
 * It refuses to land on ANY digger, not just the one it is hunting. Landing on
 * a bystander would be a hit nobody could have avoided, which is the exact
 * failure the single-player version of this rule existed to prevent. */
function nearestClearNode(state: State, m: Monster) {
  const free = (lc: number, lr: number) => passable(state, lc, lr) &&
    !state.players.some((q) => overlaps(lc * 2, lr * 2, 2, 2, q.x, q.y, 2, 2));
  const lc0 = clamp(laneOf(m.x), 0, state.activeLanes - 1);
  const lr0 = clamp(laneOf(m.y), 0, LH - 1);
  if (free(lc0, lr0)) return { lc: lc0, lr: lr0 };
  for (let rad = 1; rad < Math.max(LW, LH); rad++) {
    for (let dc = -rad; dc <= rad; dc++) {
      for (let dr = -rad; dr <= rad; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
        const lc = lc0 + dc, lr = lr0 + dr;
        if (free(lc, lr)) return { lc, lr };
      }
    }
  }
  const p = targetOf(state, m);
  return p ? { lc: laneOf(p.x), lr: laneOf(p.y) } : { lc: lc0, lr: lr0 };
}

/* Breach: put a submerged shark on a lane node, solid and killable.
 *
 * One function because there are two ways up — swimming into open ground, and
 * the stalemate breaker — and they must produce the same monster. They did not:
 * the forced path set the same fields but emitted nothing, so a shark that came
 * up that way did so in total silence, with no dirt burst, in the one moment of
 * its life the player is supposed to react to. A cue that is only usually there
 * is worse than no cue, because the player learns to distrust it.
 *
 * Clearing `breaching` here matters for the same reason: a shark that came up
 * mid-commute must not still be steering at a node it no longer needs. */
function surfaceShark(state: State, m: Monster, lc: number, lr: number, T: Tune) {
  m.x = lc * 2; m.y = lr * 2;
  m.mode = 'remat'; m.rematT = T.REMAT_TIME; m.alpha = 0;
  m.tc = lc; m.tr = lr;
  m.surfaceT = T.SHARK_SURFACE * (1 + 0.15 * m.frenzy);
  m.ghostGoal = null; m.ghostFrom = null; m.ghostComp = null;
  m.breaching = false;
  emit(state, 'surface', m.x + 1, m.y + 1);
}

/* How far a jet from this monster would actually reach, in fine cells, along
 * `dir` (defaulting to the direction it is facing).
 *
 * Now answers for the VERTICAL axis too, and that is not a flourish. The
 * generator cuts about three corridors in four vertical, because the field is
 * only LW=10 lanes wide against LH=80 deep — so a horizontal-only firebreather
 * spends most of its life somewhere its one distinguishing move is unreachable,
 * and the kind quietly degrades into a Pooka that occasionally flashes. */
export function clipFire(state: State, m: { x: number; y: number; dir: Dir }, dir?: Dir): number;
export function clipFire(state: State, m: { x: number; y: number }, dir: Dir): number;
export function clipFire(state: State, m: { x: number; y: number; dir?: Dir }, dir?: Dir) {
  const T = tune();
  // One of the two is always present; the overloads above are what enforce it.
  const d = (dir === undefined ? m.dir : dir) as Dir;
  const dx = DX[d], dy = DY[d];
  let len = 0;
  if (dx !== 0) {
    const r0 = Math.max(0, Math.round(m.y));
    const startX = dx > 0 ? m.x + 2 : m.x;
    while (len < T.FIRE_LEN) {
      const c = dx > 0 ? Math.floor(startX + len) : Math.ceil(startX - len) - 1;
      if (c < 0 || c >= state.activeGW) break;
      if (dirtAt(state, c, r0) === 1 || dirtAt(state, c, r0 + 1) === 1) break;
      len += 1;
    }
    return len;
  }
  const c0 = Math.max(0, Math.round(m.x));
  const startY = dy > 0 ? m.y + 2 : m.y;
  while (len < T.FIRE_LEN) {
    const r = dy > 0 ? Math.floor(startY + len) : Math.ceil(startY - len) - 1;
    if (r < 0 || r >= GH) break;
    if (dirtAt(state, c0, r) === 1 || dirtAt(state, c0 + 1, r) === 1) break;
    len += 1;
  }
  return len;
}

/* The damage rect a jet of `len` from `m` along `dir` occupies. One definition,
 * because the telegraph gate and the fire that follows it must agree about
 * geometry or the telegraph goes back to meaning nothing. */
export function fireRect(m: { x: number; y: number }, dir: Dir, len: number) {
  const dx = DX[dir], dy = DY[dir];
  if (dx !== 0) {
    return { x: dx > 0 ? m.x + 2 : m.x - len, y: m.y, w: len, h: 2 };
  }
  return { x: m.x, y: dy > 0 ? m.y + 2 : m.y - len, w: 2, h: len };
}

/* ── the wind-up gate ─────────────────────────────────────────────────────
 *
 * Returns the direction this Fygar should rear up in, or -1 for "do not".
 *
 * MEASURED BUG, and this function is the fix. Over 525 fygar-seconds the old
 * gate produced 70 telegraphs and 2 fires. Three separate things were wrong and
 * all three had to go:
 *
 *  1. The gate and the shot disagreed. The gate asked for
 *     clipFire() > |dxp| - 2, but the shot only spawned on clipFire() > 0.5 —
 *     and with the player close, |dxp| - 2 goes NEGATIVE, so a clearance of
 *     exactly ZERO passed. A Fygar standing in a one-lane vertical corridor,
 *     with no horizontal room whatsoever, wound up for 0.9s and fizzled. The
 *     gate now demands BOTH: max(0.5, gap - 2).
 *
 *  2. It kept walking through its own telegraph. The old branch ran AFTER
 *     moveToTarget() and only then returned with the comment "cannot move while
 *     winding up" — so it moved, and worse, moveToTarget() REWRITES m.dir. It
 *     routinely turned a corner mid-wind-up and arrived at the shot facing an
 *     axis clipFire() had never been asked about. The wind-up is now handled
 *     before movement, which is what that comment always claimed.
 *
 *  3. It could only ever breathe left or right — see clipFire above.
 *
 * The `facing` precondition is gone, replaced by turning to face. A Fygar that
 * had to already be pointing at you fired almost never once (1) and (2) were
 * fixed and the honest gate started refusing; turning is what gives the kind its
 * teeth back. It is fair because turning is the FIRST frame of a 0.9s wind-up in
 * which it is frozen, solid and unable to turn again — the bestiary's advice to
 * come at it from behind while it rears is now literally true rather than
 * approximately true. */
function fireDirToward(state: State, m: Monster) {
  const T = tune();
  const p = targetOf(state, m);
  if (!p) return -1;
  const dx = p.x - m.x, dy = p.y - m.y;
  const cands = [];
  if (Math.abs(dy) < 1) cands.push({ dir: dx > 0 ? 1 : 3, gap: Math.abs(dx) });
  if (Math.abs(dx) < 1) cands.push({ dir: dy > 0 ? 2 : 0, gap: Math.abs(dy) });
  for (const c of cands) {
    if (c.gap > T.FIRE_RANGE) continue;
    // The one condition, asked once: does the jet clear real ground AND does
    // that reach cover the gap? The shot below re-derives nothing.
    if (clipFire(state, m, c.dir) > Math.max(0.5, c.gap - 2)) return c.dir;
  }
  return -1;
}

/* ── step ─────────────────────────────────────────────────────────────── */

export function stepMonster(state: State, m: Monster, dt: number) {
  const T = tune();
  /* A dead monster is done. Without this it keeps being stepped: `dying` has
   * already cleared, and 'dying' matches none of the mode branches below, so it
   * falls through into patrol/chase — which REASSIGNS m.mode and resurrects the
   * corpse. It then wanders invisibly (view skips m.dead) and, if it is a Fygar,
   * winds up and breathes fire. Killing one and being burned by it several
   * seconds later was exactly this. */
  if (m.dead) return;

  m.px = m.x; m.py = m.y;
  if (m.markT > 0) m.markT -= dt;
  /* Cleared every frame so it can only ever be set by the carve below. Most of
   * the paths through this function return early, and a `digging` left standing
   * from the last frame would hold the dig pose through a death or a phase. */
  m.digging = false;

  if (m.dying) {
    m.dyingT -= dt;
    if (m.dyingT <= 0) { m.dead = true; m.dying = false; }
    return;
  }
  if (m.mode === 'pumped') {
    // Frozen while inflated. Deflation is driven from stepHarpoon.
    return;
  }
  if (m.stun > 0) { m.stun -= dt; return; }

  // A static kind never moves, never phases and never chases. It is an obstacle
  // with a hitbox; the only thing that gets past it is a rock.
  if (m.k && m.k.static) return;

  const p = targetOf(state, m);
  if (!p) return;
  /* No hunter walk bonus — see HUNT_GHOST_MUL in content.js. The player must
   * always be able to outrun it down a clear tunnel.
   *
   * The clamp is the variant layer's safety rail, and it caught a bug that
   * predates it. content.js documents MON_SPEED * speedMul <= 7.36 as the
   * ceiling, but that is only the KIND multiplier: state.params.speedMul is a
   * second, independent scaler that reaches 1.6 by level 13, so a Mite has been
   * running at 4.6 * 1.6 * 1.6 = 11.8 against the player's 8.0 since the level
   * curve was written. Uncatchable is one thing; uncatchable and unoutrunnable
   * is the failure the invariant exists to forbid.
   *
   * Clamping HERE rather than lowering the multipliers keeps every kind's
   * relative pace intact and keeps the rail in one place, where a new variant
   * inherits it for free. The margin is constant, so buying SPEED_TUNNEL buys
   * real distance rather than being eaten by the cap. */
  let kindMul = (m.k && m.k.speedMul !== undefined) ? m.k.speedMul : 1;
  /* Frenzy multiplies the KIND multiplier, deliberately on this side of the
   * clamp below. Applied after it, a frenzied shark would sail straight past
   * the "the player can always outrun it down a clear tunnel" invariant — and
   * the variant test only ever checks the static table value, so nothing would
   * have caught it. Here it buys real speed right up to the rail and no
   * further. */
  if (m.frenzy > 0) kindMul *= 1 + T.SHARK_FRENZY_SPEED * m.frenzy;
  const speed = Math.min(T.MON_SPEED * state.params.speedMul * kindMul,
                         Math.max(0, T.SPEED_TUNNEL - 0.6));

  // Frenzy cools whatever the mode, including while submerged: it is a state of
  // the animal, not of the chase.
  if (m.frenzy > 0) m.frenzy = Math.max(0, m.frenzy - T.SHARK_FRENZY_DECAY * dt);

  if (m.mode === 'remat') {
    m.rematT -= dt;
    m.alpha = 1 - m.rematT / T.REMAT_TIME;
    if (m.rematT <= 0) { m.alpha = 1; m.mode = 'patrol'; m.ghostTimer = 0; chooseTarget(state, m); }
    return;
  }

  /* Wind-up. Monsters start sealed in their own cavity, so phasing out is the
   * only way one ever reaches the player — an un-telegraphed phase is therefore
   * the main source of deaths that feel unearned. It stays solid, killable and
   * stationary while it flashes. */
  if (m.mode === 'ghostwind') {
    m.windT -= dt;
    m.alpha = 0.45 + 0.55 * Math.abs(Math.sin(m.windT * 18));
    if (m.windT <= 0) {
      m.alpha = 1;
      m.mode = 'ghost'; m.ghostT = 0; m.ghostTimer = 0; m.stuckT = 0;
      m.ghostFrom = componentOf(state, clamp(laneOf(m.x), 0, state.activeLanes - 1),
                                       clamp(laneOf(m.y), 0, LH - 1));
      planPhase(state, m);
      emit(state, 'ghost', m.x + 1, m.y + 1);
    }
    return;
  }

  if (m.mode === 'ghost') {
    m.ghostT += dt;
    /* A hunter is COMMUTING to the near end of the player's own tunnel;
     * everything else drifts toward open ground it cannot already walk to.
     * Phasing through solid rock is only fair because a ghost can neither be
     * hit nor kill — the danger starts when it lands. */
    if (!m.ghostGoal) planPhase(state, m);
    const goal = m.ghostGoal;
    /* planPhase always assigns one before mode becomes 'ghost', and
     * nearestForeignOpen falls back to the player's own position rather than
     * returning null, so this cannot fire today. It is here because the field
     * is nullable at rest: a future route into 'ghost' that skipped planPhase
     * would otherwise dereference null a frame later, off-screen, silently. */
    if (!goal) { m.mode = 'patrol'; return; }
    /* The swim carries the kind multiplier; the commute does not.
     *
     * A shark's frenzy is earned BY DIGGING, and digging happens while it is
     * submerged — so a multiplier that only fed the solid `speed` above paid out
     * for at most SHARK_SURFACE seconds of the duty cycle it was earned in.
     * Measured: a Sandskimmer (1.15) and a Hammerhead (0.85) swam identically,
     * and the bestiary's promise that it "comes faster" was simply untrue.
     *
     * Scoped to alwaysGhost deliberately. Every other kind's speedMul is
     * calibrated against MON_SPEED, not GHOST_SPEED — a hunting Mite ghost would
     * come out at 3.2 * 1.6 * 1.25 = 6.4. state.params.speedMul stays out for
     * the same reason squared: the level scaler reaches 1.6 by level 13, and a
     * ghost cannot be outrun by geometry, so there is no corridor answer to it.
     *
     * Clamped AFTER the hunt multiplier, because that is the term that pushes it
     * over the rail. See SHARK_SWIM_MAX. */
    const gm = (m.k && m.k.alwaysGhost) ? kindMul : 1;
    const gs = Math.min(T.GHOST_SPEED * gm * (m.hunting ? T.HUNT_GHOST_MUL : 1),
                        T.SHARK_SWIM_MAX);
    const cx = goal.x - m.x, cy = goal.y - m.y;
    const len = Math.hypot(cx, cy) || 1;
    m.x = clamp(m.x + (cx / len) * gs * dt, 0, state.activeGW - 2);
    m.y = clamp(m.y + (cy / len) * gs * dt, 0, GH - 2);
    m.dir = Math.abs(cx) > Math.abs(cy) ? (cx > 0 ? 1 : 3) : (cy > 0 ? 2 : 0);

    /* Solidify the moment the commute is over.
     *
     * For a HUNTER, "over" means it has reached the player's own connected
     * component — the exact question, asked against the snapshot planPhase()
     * took. It only has to get into the player's tunnel, not all the way onto
     * them; from there it hunts on foot, solid and killable. Phasing the whole
     * distance meant it spent most of the chase intangible, which is exactly as
     * un-fightable as the escape the hunt replaced.
     *
     * For everything else it is still "a different connected component", not
     * "any passable node": the node one step outside its own cavity is
     * passable, so a plain passability check made it bounce straight back home
     * and never travel.
     *
     * Landing on the player is excluded in both cases — that is a life with no
     * counterplay, and it is the one thing the commute makes MORE likely,
     * because the whole point is that it is aiming at ground the player is
     * standing in. */
    const lc = laneOf(m.x), lr = laneOf(m.y);
    const near = Math.abs(m.x - lc * 2) < 0.5 && Math.abs(m.y - lr * 2) < 0.5;
    const node = lr * LW + lc;

    /* A shark surfaces on TERRAIN, not on arrival at a planned node.
     *
     * The test above asks "have I reached a different connected component",
     * which is the right question for a monster commuting between cavities and
     * the wrong one for something that lives in the ground. A shark breaches
     * the moment its footprint is clear of dirt — which is to say, the moment it
     * swims into a tunnel you cut, wherever that happens to be. Landing on the
     * player is excluded here for the same reason it is excluded below: it is a
     * life with no counterplay. */
    if (m.k && m.k.alwaysGhost) {
      const inDirt = footprintInDirt(state, m.x, m.y);

      /* A dive lasts a minimum length of time, full stop.
       *
       * Without a floor the surface test passed on the frame AFTER the dive: the
       * shark was still standing in the tunnel it had breached into, ghost
       * movement had carried it all of 0.05 cells, so the terrain-driven test
       * still read "clear" and put it straight back up with a fresh full window.
       * Submerged lasted 0.02s.
       *
       * A latch — "it may not surface until its footprint has genuinely been in
       * dirt" — looks like the more precise fix and measurably is not: a shark
       * that dives beside a one-cell spur latches on the way past and is back up
       * 0.15s later, which is the same flicker with extra steps. What the player
       * actually needs to see is a dive that LASTS, so time is the honest gate.
       *
       * Frenzy divides it, so a wound-up shark dips more briefly — "comes
       * faster, stays up longer", as the bestiary promises. */
      const under = m.ghostT >= T.SHARK_SUBMERGE_MIN / (1 + 0.15 * m.frenzy);
      if (under && !inDirt &&
          !overlaps(m.x, m.y, 2, 2, p.x, p.y, 2, 2) && passable(state, lc, lr)) {
        surfaceShark(state, m, lc, lr, T);
        return;
      }

      /* Two clocks, two jobs.
       *
       * SHARK_SUBMERGE_MAX ends a STALEMATE — it is submerged, open ground is a
       * step away, and something (usually the player's own footprint) keeps
       * refusing the surface test above. It only fires when a landing node is
       * within SHARK_BREACH_SNAP, so it is a breach and never a teleport.
       *
       * HUNT_GHOST_MAX is the leash, unchanged: the level is not clear until
       * this thing is dead, so a shark circling in rock forever would be a
       * soft-lock rather than a monster. That one ignores the distance bound,
       * because at that point a pop-in beats a stuck level. */
      if (m.ghostT >= T.SHARK_SUBMERGE_MAX) {
        const n = nearestClearNode(state, m);
        const far = Math.hypot(n.lc * 2 - m.x, n.lr * 2 - m.y);
        const onPlayer = overlaps(n.lc * 2, n.lr * 2, 2, 2, p.x, p.y, 2, 2);
        if (!onPlayer && (far <= T.SHARK_BREACH_SNAP || m.ghostT >= T.HUNT_GHOST_MAX)) {
          surfaceShark(state, m, n.lc, n.lr, T);
          return;
        }
        /* Refused, and the leash has run out: there is nowhere to land that is
         * not the player. Keep swimming rather than materialise on top of them.
         * nearestClearNode's own fallback returns exactly the player's node when
         * the field offers nothing free, and a solid shark appearing inside the
         * player from intangibility is a free hit with no counterplay — the one
         * thing the !overlaps guard above exists to forbid. */
        if (m.ghostT >= T.HUNT_GHOST_MAX) {
          m.ghostT = T.HUNT_GHOST_MAX - T.SHARK_BREACH_RETRY;
        }
      }

      /* Two aims, and which one is live depends on whether it has arrived.
       *
       * CHASING, it re-aims at the player every frame — it is hunting, not
       * commuting, and the player has moved since planPhase() last ran. Aiming
       * at the player specifically, and not at a standoff ring a few cells
       * short: the ring was the obvious way to stop it ending up inside the
       * player, and it parks the shark in SOLID ROCK just outside the tunnel
       * instead, where !inDirt is never true. Measured — it hovered at 3.05
       * cells for the whole leash and then popped twenty cells away. The player
       * is the one thing guaranteed to be standing in carved ground, so the
       * player is the only aim that reliably ends somewhere it can breach.
       *
       * BREACHING, it aims at a clear node instead. Arriving means it is now
       * inside the player, where the surface test's !overlaps clause refuses —
       * and with the player as its aim it had no reason to ever leave, which is
       * exactly the ten-second intangible stalemate this whole block exists to
       * kill. So on arrival it picks the nearest node it could actually surface
       * on and commits to it. nearestClearNode already excludes the player's own
       * footprint, so that node is somewhere it can legally come up.
       *
       * The commit is what keeps this cheap: one flood per arrival, not one per
       * frame, and it also stops the shark oscillating between the two aims as
       * it steps on and off the player. */
      const onPlayerNow = overlaps(m.x, m.y, 2, 2, p.x, p.y, 2, 2);
      if (m.breaching) {
        const g = m.ghostGoal;
        const arrivedAtGoal = !g ||
          (Math.abs(m.x - g.x) < 0.25 && Math.abs(m.y - g.y) < 0.25);
        if (arrivedAtGoal) m.breaching = false;
      }
      if (!m.breaching && onPlayerNow) {
        const n = nearestClearNode(state, m);
        if (!overlaps(n.lc * 2, n.lr * 2, 2, 2, p.x, p.y, 2, 2)) {
          m.breaching = true;
          m.ghostGoal = { x: n.lc * 2, y: n.lr * 2 };
        }
      }
      if (!m.breaching) m.ghostGoal = { x: p.x, y: p.y };
      return;
    }
    const arrivedHere = m.ghostComp
      ? m.ghostComp.has(node)
      : (m.ghostFrom ? !m.ghostFrom.has(node) : true);
    const onPlayer = overlaps(lc * 2, lr * 2, 2, 2, p.x, p.y, 2, 2);
    if (near && arrivedHere && !onPlayer && passable(state, lc, lr)) {
      m.x = lc * 2; m.y = lr * 2;
      m.mode = 'remat'; m.rematT = T.REMAT_TIME; m.alpha = 0;
      m.tc = lc; m.tr = lr;
      m.ghostGoal = null; m.ghostFrom = null; m.ghostComp = null;
      return;
    }
    // Hard cap. A ghost that can never find clear space would be immortal and
    // would soft-lock the level, so force it to the nearest clear node. The
    // hunter gets a longer leash because it may have the whole field to cross.
    if (m.ghostT >= (m.hunting ? T.HUNT_GHOST_MAX : T.GHOST_MAX)) {
      const n = nearestClearNode(state, m);
      m.x = n.lc * 2; m.y = n.lr * 2;
      m.mode = 'remat'; m.rematT = T.REMAT_TIME; m.alpha = 0;
      m.tc = n.lc; m.tr = n.lr;
      m.ghostGoal = null; m.ghostFrom = null; m.ghostComp = null;
    }
    return;
  }

  // Solid: patrol / chase. A hunter is always in chase — it has no interest in
  // wandering and no range at which it loses interest.
  const here = hereDist(state, m);
  m.mode = (m.hunting || (here >= 0 && here <= T.CHASE_RANGE)) ? 'chase' : 'patrol';

  /* A surfaced shark is on a clock, and this is the only part of its life in
   * which it can be hit. It cannot dive under its own power — solid movement
   * goes through passable(), which refuses dirt — so without this it would
   * breach once and then spend the rest of the level walking a tunnel like a
   * slow Pooka, which is neither what it is nor what it was priced as.
   *
   * Frenzy extends the window rather than shortening it: a shark you have been
   * digging next to stays up and commits, where one you left alone takes its
   * pass and goes. */
  if (m.k && m.k.alwaysGhost) {
    m.surfaceT -= dt;
    /* An Emberfin does not dive mid-wind-up. Without this the surface clock can
     * expire between the telegraph and the shot, and m.telegraph survives the
     * dive — so it would submerge, swim somewhere else, surface, and only then
     * fire, along an axis it committed to at the old position. The rule the
     * telegraph teaches is "it is about to breathe THERE", and this keeps it. */
    if (m.surfaceT <= 0 && !(m.telegraph > 0)) {
      m.mode = 'ghost';
      m.ghostT = 0;
      m.breaching = false;
      m.ghostGoal = { x: p.x, y: p.y };
      m.ghostFrom = null; m.ghostComp = null;
      emit(state, 'ghost', m.x + 1, m.y + 1);
      return;
    }
  }

  m.ghostTimer += dt;
  // stuckT is now the resting state, not an exception: a monster sealed in a
  // one-node cavity has no passable neighbour and can never make progress. The
  // random interval is what actually paces ghosting; measured, the two together
  // give ~4.6 phase-outs per monster per minute.
  // ghostMul is the variant seam: a Wraith Pooka phases at half the interval.
  // It scales the INTERVAL and never GHOST_WIND, which stays a full visible
  // wind-up for every variant of every kind — that is not a tunable.
  const interval = (m.hunting ? T.HUNT_GHOST_INTERVAL
                              : state.params.ghostInterval + (m.home.lc % 3) * 0.8)
                   * ((m.k && m.k.ghostMul) || 1);
  /* A hunter phases only to get TO you. While it can WALK to you it does not
   * phase at all — it chases down the tunnels like anything else, solid the
   * whole way. `here >= 0` is exactly that question: hereDist() is the BFS
   * gradient flooded from the player's node, so a non-negative reading under
   * the monster's feet IS a walking route, and it is the same fact the commute
   * above is trying to buy.
   *
   * Without this it kept phasing on its timer even while standing next to the
   * player, flickering between intangible and solid — which both looked broken
   * and cut its killable time to about three seconds in every forty-five. */
  const canWalkToPlayer = m.hunting && here >= 0;
  /* alwaysGhost kinds are excluded from the TIMER, not from ghosting. A shark
   * dives on its own surface clock a few lines above, with no wind-up, because
   * for it submerging is going home rather than an attack being announced.
   * Left in, it would also phase on the shared interval — and emit the phase
   * telegraph while doing it, teaching the player to read a flash that means
   * something else entirely. */
  const timerGhost = !(m.k && m.k.alwaysGhost);
  if (timerGhost && mayGhost(m) && !canWalkToPlayer &&
      (m.ghostTimer >= interval || m.stuckT >= T.STUCK_GHOST)) {
    m.mode = 'ghostwind';
    m.windT = T.GHOST_WIND;
    emit(state, 'telegraph', m.x + 1, m.y + 1);
    return;
  }

  /* ── the wind-up, BEFORE movement ──────────────────────────────────────
   *
   * This block used to sit at the very bottom of the function and return with
   * the comment "rearing up: cannot move while winding up" — after
   * moveToTarget() had already run. So it moved for all 0.9s of the wind-up,
   * and moveToTarget() rewrites m.dir, so it also TURNED. That is most of the
   * 70-telegraphs-to-2-fires the player measured: the gate was answered for one
   * direction and the shot was fired in another. Order is the fix; the comment
   * was right all along.
   *
   * `m.telegraph` is decremented here and nowhere else, and a Fygar mid-wind-up
   * takes no other action this frame: it does not walk, it does not turn, it
   * does not re-target. That immobility is the counterplay the bestiary already
   * promises — go round it, or come at it from behind while it rears. */
  if (m.k && m.k.breathes && m.telegraph > 0) {
    m.telegraph -= dt;
    if (m.telegraph <= 0) {
      const len = clipFire(state, m);
      /* The wind-up committed to a direction and to a clearance, and dirt is
       * only ever REMOVED, so a gate that passed cannot have closed by now:
       * this branch fires every time. It is kept as a guard rather than an
       * assertion because a rock can arrive in the corridor, and a jet through
       * a boulder would be a worse lie than a rare fizzle. */
      if (len > 0.5) {
        /* The jet EXTENDS. It is pushed at zero length with the origin, the
         * direction and the full reach it earned, and stepFire() grows the rect
         * from the mouth outward over FIRE_GROW before holding it for
         * FIRE_ACTIVE. At FIRE_LEN 13.5 a jet that appeared whole would put a
         * hitbox on a player fourteen cells away in the same frame it became
         * visible — the growth is what keeps a tripled range dodgeable.
         *
         * `len` is fixed at the moment of the shot and never re-measured:
         * clipFire already refused a blocked corridor, and re-clipping mid-jet
         * would let a rock landing behind the flame retract it. */
        const r = fireRect(m, m.dir, 0.001);
        state.fire.push({
          x: r.x, y: r.y, w: r.w, h: r.h,
          dir: m.dir, t: T.FIRE_ACTIVE, owner: m,
          ox: m.x, oy: m.y, len, grow: T.FIRE_GROW, growT: 0,
        });
        emit(state, 'fire', m.x + 1, m.y + 1);
      }
      m.fireCd = state.params.fireCooldown * ((m.k.fireMul) || 1);
    }
    return;
  }

  const arrived = moveToTarget(state, m, speed, dt);
  /* A digger pays for its own tunnel out of nobody's hopper.
   *
   * carve() already returns the cell count, so `digging` is free: it means "this
   * frame actually cut ground", not "this kind can dig". The distinction is the
   * whole point — a Mole crossing a tunnel it already opened is walking, and
   * only the frames that bite should play the dig cycle. anim.js reads it; the
   * atlas has had five *.dig clip families sitting unreachable because nothing
   * on a monster ever set this. */
  m.digging = !!(m.k && m.k.digs) && carve(state, m.x, m.y, m.dir, null) > 0;
  if (arrived) {
    const moved = chooseTarget(state, m);
    if (!moved) m.stuckT += dt; else m.stuckT = Math.max(0, m.stuckT - dt);
  }

  // Fygar breath. One question — fireDirToward() — and it is the same question
  // the shot above will ask, which is the whole of the fix.
  if (m.k && m.k.breathes) {
    m.fireCd -= dt;
    if (m.fireCd <= 0) {
      const fd = fireDirToward(state, m);
      if (fd >= 0) {
        m.dir = fd;                       // turn to face; the wind-up starts here
        m.telegraph = T.FIRE_TELEGRAPH;
        emit(state, 'telegraph', m.x + 1, m.y + 1);
      }
    }
  }

  // The mole drops the ceiling. See dropRockFrom().
  if (m.k && m.k.dropsRocks) {
    m.dropCd -= dt;
    if (m.dropCd <= 0) {
      m.dropCd = dropRockFrom(state, m) ? T.MOLE_DROP_CD : T.MOLE_DROP_RETRY;
    }
  }
}

/* ── the wire's view of this file ─────────────────────────────────────────
 *
 * bestiary.ts carries the kind and variant ids in the order the wire encodes
 * them, because the client cannot see this file. If the two ever disagree,
 * every monster on every screen is drawn as something else and nothing throws.
 * So they are checked against each other at load: this costs one pass over
 * nine short arrays, once, and turns a silent repaint into a startup failure.
 */
{
  const kinds = Object.keys(MONSTERS);
  if (kinds.length !== KIND_IDS.length || kinds.some((k, i) => k !== KIND_IDS[i])) {
    throw new Error(`bestiary.ts kinds do not match MONSTERS: ${kinds.join(',')}`);
  }
  for (const k of kinds) {
    const mine = (VARIANTS[k] ?? []).map(v => v.id);
    const theirs = VARIANT_IDS[k] ?? [];
    if (mine.length !== theirs.length || mine.some((v, i) => v !== theirs[i])) {
      throw new Error(`bestiary.ts variants for ${k} do not match: ${mine.join(',')}`);
    }
    /* And the colours, for the same reason. A variant missing from
     * VARIANT_TINTS renders as an untinted copy of its base kind, which is
     * exactly the silent failure the id check above exists to prevent. */
    for (const v of VARIANTS[k] ?? []) {
      if (VARIANT_TINTS[v.id] !== v.tint) {
        throw new Error(`bestiary.ts tint for ${v.id} is ${VARIANT_TINTS[v.id]}, not ${v.tint}`);
      }
    }
  }
}
