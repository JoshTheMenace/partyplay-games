/* Tuning tables and the level generator.
 *
 * Pure data and pure functions. Like engine.js, this file must never touch the
 * DOM, Math.random, or the clock: every level is a deterministic function of
 * (level, seed), which is what makes `?seed=` a usable bug-reproduction tool.
 */

import { THEMES, THEME_BY_ID, themeOf, lightRadiusFor, CRYSTAL_IDS } from './themes';
import type { Theme } from './themes';
import type { MonsterSpec, Pocket } from './model';

/* Re-exported so engine.js keeps a single import line and the pure half of the
 * app has one front door. themes.js imports nothing, so there is no cycle. */
export { THEMES, THEME_BY_ID, themeOf, lightRadiusFor, CRYSTAL_IDS };

/* The dirt grid is at HALF actor resolution: an actor is 2x2 fine cells, and a
 * "lane node" is an even (col,row) pair. Fine resolution is what lets a tunnel
 * end advance continuously instead of popping in 2-cell chunks — see carve() in
 * engine.js.
 *
 * NARROW AND DEEP, because the view scrolls.
 *
 * The old field was 28x56 and fitted entirely on screen, which pinned the cell
 * size to (screen width / 28) and made an actor ~24 CSS pt on a phone — small
 * enough that no amount of art could rescue it. With a vertical camera the
 * height constraint disappears, so the width can shrink and the depth can grow:
 * 20 columns puts an actor at 32 CSS pt from 32 source pixels, and 160 rows
 * makes a level a shaft you descend rather than a board you survey.
 *
 * 20 and not narrower: LW drops with it, and at LW=7 a maximum-length monster
 * corridor (CAVITY_MAX) spans the entire field, CHASE_RANGE exceeds the width,
 * and freeFor()'s separation rule stops being satisfiable. 10 lanes keeps every
 * tuned constant meaningful.
 *
 * SKY_ROWS is NOT here — it is per level (state.skyRows), 4 on level 1 and 0
 * below, so every descent after the first opens underground. */
/** 0 up, 1 right, 2 down, 3 left. -1 means "none pending". */
export type Dir = number;
export type Rng = () => number;
export type LaneNode = { lc: number; lr: number };

/** Fine cells one digger sees across. The shaft grows; the viewport does not. */
export const VIS_COLS = 20;

/** Lanes for a crew of this size: ten, plus 70% of ten for each extra digger.
 *
 * The same curve the monster count uses, so cavity density stays roughly where
 * it was tuned rather than thinning out as the shaft widens. */
export function lanesFor(players: number) {
  const n = Math.max(1, Math.min(10, players | 0));
  return Math.min(73, Math.round(10 * (1 + 0.7 * (n - 1))));
}

export const GRID = Object.freeze({
  /* The MAXIMUM shaft, not the one being played.
   *
   * Storage is always this wide; how much of it is in play is `state.activeGW`,
   * set per run from the roster. Holding the grid at its maximum is what keeps
   * every buffer, every stride and every bounds test a constant — a grid that
   * changed size would have to be re-derived in six modules that snapshot it at
   * import, and the failure mode there is a silently wrong stride rather than
   * an error. The columns beyond the active field are simply never carved, so
   * they stay solid and nothing can walk into them. */
  GW: 146,         // fine columns at ten diggers
  GH: 160,         // fine rows
  BAND_ROWS: 32,   // fine rows per scoring band (5 bands x 32 = 160 = GH)
  BAND_COUNT: 5,
  LW: 73,          // lane columns  (GW / 2)
  LH: 80,          // lane rows     (GH / 2)
  /* Terrain is rasterised one chunk at a time, never whole-field. A full-field
   * buffer here would be 640x5120 device px — past the maximum canvas dimension
   * on iOS Safari before 16, whose failure mode is a silently blank dirt layer
   * that works perfectly on desktop. One chunk is exactly one band. */
  CHUNK_ROWS: 32,
});

/* Source-art resolution. One fine cell is TILE source pixels; an actor is 2x2
 * cells, hence ACTOR = 2 * TILE. Both are consumed by the generated sprite
 * table and by the view's integer-scale fit.
 *
 * 16 rather than 12: at 20 columns a phone affords k=2 at DPR 2 either way, so
 * the larger tile is 78% more pixels in every sprite for no cost in fit. */
export const TILE = 16;
export const ACTOR = 32;

/* Never zoom in so far that the player cannot see a rock coming.
 *
 * Only binds on landscape and low-DPR desktop; on every phone in the matrix the
 * width term wins and this is slack.
 *
 * 22 rather than 30, and the difference is a whole scale step on a laptop: a
 * 1280x800 window has 748 device pixels of stage height, 24 rows at k=2 needs
 * 768, and missing it by twenty pixels drops the fit to k=1 and turns the field
 * into a quarter-width ribbon. 22 rows needs 704 and clears it. Every phone in
 * the matrix is width-bound either way, so this costs them nothing. */
export const MIN_VIS_ROWS = 22;

/* Every magic number in the game lives here and nowhere else. Units are fine
 * cells and seconds throughout. */
export const TUNE = Object.freeze({
  // ── player ──
  SPEED_TUNNEL: 8.0,
  SPEED_DIG: 5.0,        // digging is slower on purpose: it's why you plan a
                         // route. NOTE the Shovel ladder now reaches 8.0 at its
                         // top tier, which is parity with base SPEED_TUNNEL —
                         // see the upgrade for why that is intended.
  SNAP_TOL: 0.45,        // how close to a lane boundary a turn is accepted
  TURN_BUFFER: 0.20,     // ...and how long an early turn request is remembered.
                         // The highest-leverage feel constant in the game: a thumb
                         // never releases exactly on a lane boundary.
  CARVE_LEAD: 0.15,      // how far ahead of the AABB digging reaches

  /* Health, not lives. A hit costs 1 HP, buys HIT_INVULN seconds of mercy and a
   * shove to break contact — the player keeps their position, their tunnels and
   * their hopper. Nothing respawns and nothing resets. At 0 HP the run is over.
   *
   * Max HP starts at 1 and is bought at the base, so durability is something you
   * earn across runs rather than something the arcade hands you three of. */
  MAX_HP: 1,
  HIT_INVULN: 1.6,
  HIT_KNOCKBACK: 2.4,    // fine cells shoved away from whatever hit you
  DEATH_TIME: 1.2,

  // ── harpoon ──
  HARPOON_MAX: 6.0,
  HARPOON_OUT: 24.0,
  HARPOON_BACK: 36.0,    // a clean miss costs ~0.45s frozen. That lockout IS the
                         // risk of firing; without it there's no reason not to mash.
  /* Twelve, not four.
   *
   * The base moved because every kind's own `pumpStages` in monsters.js is
   * being scaled up against it, and a per-kind override only means something
   * relative to this number. A pump stage is roughly a quarter-second of
   * standing still holding a harpoon, so 12 is a real commitment rather than a
   * tap — which is the point: firing has to cost something now that there are
   * half again as many monsters in the level.
   *
   * Anything that reduces it must shave a PROPORTION. A flat "-1 per tier" was
   * fine against 4 and is noise against 12, and the version of the pressure
   * upgrade that drove it to a floor of 2 would re-trivialise the whole change
   * for 960 dirt. See UPGRADES.pressure and RELICS.quick-hands. */
  PUMP_STAGES: 12,       // the last stage pops
  DEFLATE_DELAY: 1.0,
  DEFLATE_STEP: 0.7,
  DETACH_STUN: 0.4,
  RELEASE_HOLD: 0.25,    // hold a direction this long to abandon a pump
  /* The Breaching Tip upgrade. BREACH is 0 or 1 — there is deliberately only
   * one tier, because a second would turn the harpoon into a drill.
   *
   * ONE TILE — the visible square, which is 2x2 fine cells. It was a single
   * fine cell for exactly one version, on the reasoning that a quarter-tile
   * peephole is not a route you can walk. That was wrong in play: the harpoon's
   * own collision samples a single fine cell too, so a quarter-tile hole was an
   * invisible permanent gap in the line the harpoon flies down, and repeated
   * shots walked its reach out to HARPOON_MAX through ground that still looked
   * solid. See breakTile() in world.js.
   *
   * A whole tile makes the hole the same KIND of hole as digging, so the
   * terrain never lies about what the harpoon can pass. The cooldown is what
   * keeps it honest: five seconds a tile is far slower than walking into the
   * wall, so this can never become a drill. What it buys is the one thing
   * walking cannot — opening a monster's cavity from outside the range at which
   * the monster can reach you. */
  BREACH: 0,
  BREACH_CD: 5.0,

  // ── monsters ──
  MON_SPEED: 4.6,
  GHOST_SPEED: 3.2,
  GHOST_MAX: 8.0,        // hard cap, then force-materialise; a ghost with nowhere
                         // to land would otherwise soft-lock the level
  GHOST_WIND: 0.45,      // visible wind-up before phasing. Monsters start sealed
                         // in their own cavity, so ghosting is the ONLY way one
                         // reaches you — un-telegraphed it becomes the main
                         // unfair death.
  REMAT_TIME: 0.35,
  STUCK_GHOST: 2.5,
  /* The last survivor does not run for an exit — it comes for the player.
   *
   * Every version of the escape ended up unkillable in practice: it spends its
   * whole run inside dirt, where it has to be intangible or it would be walking
   * through solid rock. Hunting inverts that. It phases only to close the gap,
   * then rematerialises in the open ground next to you, solid and killable,
   * because you are always standing in a tunnel. The level ends when you kill
   * it, which is a thing you can actually do. */
  /* The hunter does NOT walk faster than a normal monster, and that is a hard
   * invariant, not timidity: MON_SPEED * speedMul tops out at 7.36 against the
   * player's 8.0 in a clear tunnel, so running is always an option. Any walk
   * multiplier breaks it — at 1.25 the hunter hit 9.2 by level 13 and simply
   * could not be escaped. Its menace comes from never losing interest and from
   * phasing through rock to reach you, not from out-sprinting you.
   *
   * The ghost leg may be quicker, because a ghost can neither hit nor be hit. */
  HUNT_GHOST_MUL: 1.25,
  HUNT_GHOST_INTERVAL: 3,  // it keeps coming through walls
  HUNT_GHOST_MAX: 10,      // it hops cavity to cavity now, so it never needs
                           // a leash long enough to cross the whole field
  HUNT_MARK: 1.0,          // seconds of "it is coming for you" flash on entry
  REPATH_EVERY: 0.25,
  CHASE_RANGE: 12,       // lane nodes, measured along the BFS gradient

  // ── fygar ──
  // Shortened from 6.0 and lengthened from 0.7: with the sparse layout you meet
  // a Fygar at close range in a one-tile tunnel, and fire deaths nearly tripled
  // in bot trials. They should make you plan a route, not be the main way you die.
  /* Tripled, to 13.5. A Fygar in Dig Dug denies a whole corridor, and at 4.5 —
   * two and a bit lane nodes — this one denied a doorway.
   *
   * The field is only GW=20 fine cells wide, so a clear jet now covers most of
   * it, and that is the point AND the danger: an east-west corridor becomes
   * somewhere you have to leave rather than somewhere you back off in. What
   * makes it survivable is FIRE_GROW below, not a shorter jet — the reach is
   * the feature, the instant appearance was the unfairness. */
  FIRE_RANGE: 13.5,
  FIRE_LEN: 13.5,
  FIRE_TELEGRAPH: 0.9,   // on a phone screen this is the difference between
                         // "hard" and "unfair"
  /* Seconds for the jet to reach full length, during which it damages only as
   * far as it has actually travelled.
   *
   * This is what pays for tripling the range. Spawning 14 cells of hitbox in a
   * single frame gives a player at the far end no frame in which the threat
   * exists but has not yet reached them — the telegraph tells you a Fygar is
   * about to breathe, and the growth tells you where the flame is NOW, which is
   * the part you dodge. It also makes the jet readable as a jet. */
  FIRE_GROW: 0.28,
  FIRE_ACTIVE: 0.55,     // held at full length, after FIRE_GROW has elapsed

  /* ── the vent's wheel ──
   *
   * A basalt vent used to push a 2x2 damage box onto its own tile and hold it
   * there — a Fygar's jet of length zero. It could only ever hurt someone
   * standing on it, which meant it was either ignored or unavoidable and
   * nothing in between. It throws a spinning wheel down a corridor now.
   *
   * SPEED is the whole design, and it is chosen against two numbers that were
   * already here rather than invented: SPEED_DIG is 5.0 and SPEED_TUNNEL is
   * 8.0, so a wheel outruns you while you are cutting and you outrun it down
   * ground you already opened. The counterplay is one sentence — the corridor
   * you cut is the escape, the face you are cutting is not — and a maxed Shovel
   * (which now lands on 8.0) buys you the digging case too.
   *
   * RANGE is deliberately shorter than FIRE_LEN. A jet denies a corridor for
   * its whole length; a wheel is 2x2 at every instant and passes through one,
   * so you can stand behind it and let it go by. Those are different threats
   * and they should not be the same number.
   *
   * MIN_RUN is the gate. Below two lane nodes there is no travel to read and
   * the thing is just the old box again, so the vent holds fire — and, because
   * the telegraph is only emitted once a launch is certain, it does not warn
   * about a wheel that is never coming. */
  WHEEL_SPEED: 6.5,      // fine cells per second
  WHEEL_RANGE: 10,       // fine cells of runway, capped below FIRE_LEN's 13.5
  WHEEL_MIN_RUN: 4,      // two lane nodes; under this the vent stays quiet
  WHEEL_LIFE: 3.0,       // a fuse, never the normal exit: RANGE/SPEED is 1.54s
  WHEEL_RETRY: 1.2,      // wait after a failed attempt, so a vent the player
                         // has just dug beside does not idle out its full cycle
  WHEEL_PER_VENT: 1,
  /* The level-wide ceiling, and it is BELOW the vent count on purpose. Basalt
   * places 6 vents plus hazardBonus, which reaches 4 by the deep levels — so at
   * depth this genuinely bites and some vents wait their turn. That is the
   * intent: one wheel per vent keeps any single corridor readable, and this
   * keeps ten of them from being readable individually and chaos together. */
  WHEEL_MAX: 6,

  // ── rocks ──
  ROCK_WOBBLE: 0.9,      // the player's only warning; must read at phone size
  ROCK_G: 45.0,
  ROCK_VMAX: 28.0,
  ROCK_BREAK: 0.45,
  /* A rock always falls freely through open space. What it can do to *ground*
   * is earned: every ROCK_BUILDUP tiles of open air it crosses buys it
   * ROCK_BREAKTHROUGH tiles of boring. Run out mid-ground and it shatters where
   * it stopped; break through into open air and it starts building again.
   *
   * This replaces a flat distance cap, which made every rock drop the same
   * height regardless of the shaft under it. */
  ROCK_BUILDUP: 5,
  ROCK_BREAKTHROUGH: 3,

  // ── bonus ──
  BONUS_CARVE_REQ: 90,   // fine cells carved before the vegetable appears
  BONUS_TIME: 12.0,
  BONUS_DIRT: 40,        // the pepper is a dirt cache, not points

  /* Pressure. Digging is income, so without a cost you would strip a level bare
   * in perfect safety and the economy would be a chore rather than a gamble.
   *
   * Both of these are consequences of the thing you are rewarded for: excavate
   * and you wake something; linger and the roof starts coming down. */
  WAKE_PER_CELLS: 55,    // cells excavated per monster woken into the hunt
  CAVEIN_AT: 75,         // seconds on a level before the roof starts going
  CAVEIN_EVERY: 9,       // and how often a rock drops unaided, shortening
  CAVEIN_MIN: 3,

  // ── economy ──
  HOPPER: 250,           // dirt carried before the hopper is full; an upgrade
  SIFTER: 0,             // chance a cell pays double
  DEEP_MUL: 1,           // multiplier on the bottom two bands
  HELMET: 0,             // rock hits ignored per run
  LANTERN: 0,            // monsters faintly visible through dirt
  CANARY: 0,             // audible cue when something starts phasing

  /* ── air ──
   * The cave-in clock, made visible. AIR_MAX / AIR_DRAIN is exactly CAVEIN_AT,
   * so on a level where you find no pockets the roof starts coming down at the
   * same 75 seconds it always did. The pressure curve is reproduced rather than
   * replaced; only the player's knowledge of it changes. Tune pocket density
   * afterwards, and never move both numbers at once. */
  AIR_MAX: 75,
  AIR_DRAIN: 1.0,        // units per second underground
  /* 12, down from 18, and the total air in a level went UP not down.
   *
   * The old 18 was priced for three pockets a level of which the player found
   * essentially none. There are now nine to eighteen, they are strata'd so no
   * stretch of the descent is dry, and the damp patch above each one means an
   * attentive route actually collects them — measured at ~8 taken against 0.4
   * before. At 18 apiece that was 220 seconds of slack on top of a 75-second
   * budget, which does not make the cave-in visible, it deletes it. At 12 a
   * careful run roughly triples its stay on a level that now holds three times
   * the monsters, and a run that ignores the tells is back under 100 seconds. */
  AIR_POCKET: 12,        // refill from one sealed pocket
  AIR_LOW: 15,           // below this the HUD goes red and the canary sings

  /* The surface tell above a pocket, in LANE nodes. A pocket is still sealed
   * solid dirt — see step 9 — but the ground above it is now damp, and that
   * damp patch is what the player actually navigates by.
   *
   * HINT_UP is a plume rising from the pocket, because the player is descending
   * and has to see it BEFORE they are level with it. HINT_W is how far it
   * spreads sideways, and it is what makes a pocket findable from a shaft that
   * is not in its column — which every pocket used to need to be, since a
   * one-lane shaft only ever touches one lane column in ten. */
  HINT_UP: 6,
  HINT_W: 2,

  /* ── ore ──
   * Ore is the SHOP currency; dirt stays the volume currency. Value by vein
   * grade 0..3, paid by carve() exactly like dirt — excavation is still the
   * only thing that pays. */
  /* Trimmed from [0, 1, 3, 8] in the same pass that took ORE_RATE from 10 to 2.
   *
   * The two only mean anything against each other. Tripling the vein walkers
   * (themes.js) and lengthening the route (more monsters to clear) had already
   * tripled ore income on its own, so a flat 5x on the sticker price would have
   * netted out at under 2x. Measured: the whole shop is 15133 ore, and a run to
   * level 14 banks about 2700 — five or six deep runs to own everything, where
   * before it was barely one. The ratios inside the table are kept, so grade 3
   * is still five times grade 1 and following a rich seam is still the play. */
  ORE_VALUE: Object.freeze([0, 1, 2, 5]),
  ORE_MUL: 1,            // an upgrade

  /* ── descent ──
   * The 1.6s levelclear beat, split in two: hold on the kill, then drill. */
  CLEAR_HOLD: 0.7,
  DESCEND_TIME: 1.1,
  DESCEND_SPEED: 26.0,   // fine cells per second. NEVER screens per second —
                         // the engine must not learn the size of the viewport.

  /* ── new monster kinds ──
   * Per-kind overrides live in monsters.js; these are the shared knobs the
   * upgrade table and the generator need to reach. */
  MITE_SPEED_MUL: 1.6,
  WARDEN_SPEED_MUL: 0.5,
  GRUB_SPEED: 2.0,
  SAPPER_RADIUS: 3.5,    // fine cells
  SAPPER_CHAIN_MAX: 3,   // a blast may detonate a blast, three deep

  /* ── shark ──
   * Seconds it stays solid after breaching into a tunnel. This is the ONLY
   * window in which it can be harpooned, so it is really the kind's difficulty
   * dial: too short and it is a hazard rather than a monster, too long and it
   * is a Pooka that entered oddly. */
  SHARK_SURFACE: 2.6,

  /* Two clocks under the surface, answering two different questions.
   *
   * MIN is a floor on the dip, and it exists because of a measured bug: the dive
   * sets mode='ghost' while the shark is still standing in the open tunnel it
   * breached into, and the surface test is TERRAIN-driven — so the next frame
   * found the footprint still clear and re-surfaced it with a fresh full
   * SHARK_SURFACE window. Ghost mode lasted 0.02s, twice in twenty seconds.
   *
   * Gating on terrain instead — "it may not surface until its footprint has
   * genuinely been in dirt" — looks more precise and measurably is not: a shark
   * that dives beside a one-cell spur satisfies it on the way past and is back
   * up 0.15s later, which is the same flicker with extra steps. What the player
   * needs to see is a dive that LASTS, so this is a plain floor on the clock.
   * Kept short on purpose: while it is a ghost in open air it wears the
   * intangible silhouette, and that silhouette means one thing.
   *
   * MAX ends a STALEMATE, not the level. The failure it fixes was a shark
   * sitting inside the player's own footprint — intangible, unkillable and
   * harmless — for the full HUNT_GHOST_MAX of ten seconds, which is the exact
   * opposite of the "wait for the window" the whole kind is built on. It only
   * fires when a landing node is within SHARK_BREACH_SNAP, so it can never
   * become a teleport; HUNT_GHOST_MAX stays the real anti-soft-lock leash for a
   * shark with genuinely nowhere to go. */
  SHARK_SUBMERGE_MIN: 1.0,
  SHARK_SUBMERGE_MAX: 3.5,
  SHARK_BREACH_SNAP: 6,     // fine cells; further than this, wait for the leash
  SHARK_BREACH_RETRY: 0.5,  // ...and if the only landing node is the player's
                            // own, give it this long to swim rather than
                            // materialise on top of them

  /* The rail on the swim.
   *
   * GHOST_SPEED * a maxed-frenzy Sandskimmer * HUNT_GHOST_MUL is
   * 3.2 * 1.05 * 1.15 * 1.6 * 1.25 = 7.73, which is past the 7.4 every SOLID
   * monster is held to — and a ghost travels the hypotenuse through rock while
   * the player travels tunnels, so its effective closing speed is far above the
   * player's 8.0. "Back off and wait for the window" has to stay a real answer.
   *
   * 6.0 bites only above about four frenzy stacks, so the frenzy is felt across
   * its whole useful range instead of being flattened by the clamp. */
  SHARK_SWIM_MAX: 6.0,

  /* The frenzy. Every fine cell of dirt carved within SHARK_FRENZY_RADIUS adds
   * a stack, stacks decay at SHARK_FRENZY_DECAY a second, and each one adds
   * SHARK_FRENZY_SPEED to its multiplier.
   *
   * Digging is what wakes it, which makes it the one monster that punishes the
   * drill rather than the walk — and the counterplay is legible without a HUD:
   * stop cutting and it calms down. The speed it reaches is still put through
   * the same tunnel-speed clamp as every other kind, so a frenzied shark can
   * close on you but can never outrun you down clear ground. */
  SHARK_FRENZY_RADIUS: 6,   // fine cells
  SHARK_FRENZY_MAX: 5,
  SHARK_FRENZY_DECAY: 0.5,  // stacks per second
  SHARK_FRENZY_SPEED: 0.12, // multiplier added per stack

  /* ── mole ──
   * Quicker than a Grub, because it is not trying to rewrite the level and so
   * does not need the Grub's rarity to stay fair. */
  MOLE_SPEED: 2.5,
  MOLE_DROP_CD: 4.0,     // seconds between rocks
  MOLE_DROP_RETRY: 0.5,  // ...but do not burn a full cooldown standing on solid
                         // ground with nothing below to drop into

  /* Live rocks ADDED during a level — by a hazard or by a Mole — allowed at
   * once. Measured against those rocks alone and never against the whole array;
   * see spawnedRocks() in world.js for the bug that distinction fixes. */
  ROCK_SPAWN_MAX: 8,

  RELIC_SLOTS: 3,        // relics carried in one run
});

/** The effective tunables for a run: TUNE after upgrades and relics fold in. */
export type Tune = {
  -readonly [K in keyof typeof TUNE]: (typeof TUNE)[K] extends number
    ? number
    : (typeof TUNE)[K];
};

/** Upgrade tiers bought, by upgrade id. */
export type Owned = Record<string, number> | null | undefined;

/** What a cosmetic demands before it can be bought. */
export type CosmeticReq = { depth?: number; level?: number; crystal?: string };

/** The meta progress record, passed in because worldgen may not touch storage. */
export type Progress = {
  bestDepth?: number; bestLevel?: number; crystals?: Record<string, unknown>;
};


/* Permanent upgrades, bought with banked dirt at the base.
 *
 * Almost every one is a single existing tunable, which is the whole reason the
 * list can be this broad: the game was already built out of named constants in
 * one file, so an upgrade is usually one line. `apply` mutates a COPY of TUNE —
 * see applyUpgrades — never TUNE itself.
 */
/** One rung of the shop ladder. `apply` is optional: the Relic Cache buys
 *  nothing the simulation can read. */
export type Upgrade = {
  id: string; name: string; group: string; blurb: string;
  costs: readonly number[];
  apply?: (t: Tune, n: number) => void;
  endgame?: boolean;
};

export const UPGRADES: readonly Upgrade[] = Object.freeze([
  { id: 'shovel', name: 'Shovel', group: 'Excavation',
    blurb: 'Cut fresh ground faster',
    costs: [80, 200, 450, 900, 1350],
    /* The top tier lands SPEED_DIG on 8.0 — exactly base SPEED_TUNNEL. That is
     * deliberate and it does retire the "digging is slower on purpose" rule at
     * zero Boots: a fully-shovelled player cuts fresh ground as fast as they run
     * a clear one, so route planning stops being forced and becomes a choice.
     * Boots restore the gap (8.5 to 9.5), so the trade is "spend on Mobility to
     * get the old feel back". It touches nothing safety-critical — the monster
     * rail is measured off SPEED_TUNNEL, not off SPEED_DIG. */
    apply: (t, n) => { t.SPEED_DIG = 5.0 + n * 0.6; } },

  { id: 'hopper', name: 'Hopper', group: 'Excavation',
    blurb: 'Carry more before it overflows',
    costs: [70, 180, 400, 800],
    apply: (t, n) => { t.HOPPER = 250 + n * 220; } },

  { id: 'sifter', name: 'Sifter', group: 'Excavation',
    blurb: 'Some cells pay double',
    costs: [150, 380, 820],
    apply: (t, n) => { t.SIFTER = n * 0.12; } },

  { id: 'seams', name: 'Deep Seams', group: 'Excavation',
    blurb: 'The bottom bands pay more',
    costs: [220, 540, 1100],
    apply: (t, n) => { t.DEEP_MUL = 1 + n * 0.25; } },

  { id: 'boots', name: 'Boots', group: 'Mobility',
    blurb: 'Move faster through open tunnel',
    costs: [90, 240, 520],
    // Capped deliberately: monsters top out at 7.36 and the player must always
    // be able to outrun them down a clear tunnel.
    apply: (t, n) => { t.SPEED_TUNNEL = 8.0 + n * 0.5; } },

  { id: 'grease', name: 'Grease', group: 'Mobility',
    blurb: 'Turns register earlier',
    costs: [110, 280],
    apply: (t, n) => { t.TURN_BUFFER = 0.20 + n * 0.06; } },

  { id: 'health', name: 'Health', group: 'Survival',
    blurb: 'Survive another hit',
    /* Seven tiers, so MAX_HP tops out at 8. The last two were added because
     * runs were consistently ending around 1000-1200m — deep enough to see the
     * next biome, not deep enough to bank its crystals and come back. */
    costs: [120, 300, 650, 1300, 2400, 3600, 5400],
    apply: (t, n) => { t.MAX_HP = 1 + n; } },

  { id: 'fuse', name: 'Long Fuse', group: 'Survival',
    blurb: 'Longer mercy after a hit',
    costs: [100, 260],
    apply: (t, n) => { t.HIT_INVULN = 1.6 + n * 0.5; } },

  { id: 'helmet', name: 'Helmet', group: 'Survival',
    blurb: 'Shrug off falling rock',
    costs: [200, 520],
    apply: (t, n) => { t.HELMET = n; } },

  /* A PROPORTION, not a flat subtraction, and the floor is 6 rather than 2.
   *
   * Against the old base of 4 a flat "-1 per tier" was a third of the fight per
   * tier and bottomed out at 2. Carried onto a base of 12 unchanged it would
   * have been a rounding error at tier 1 and, at its floor, a 6x discount for
   * 960 dirt — which would have undone the whole reason the base moved. 15% a
   * tier is felt at every tier and never cheapens a monster past half. */
  /* The fourth tier needed no change to the curve: 0.85^n rounds to 10, 9, 7, 6,
   * so tier 4 is a whole pump better than tier 3 and lands exactly on the floor.
   * It is also the LAST tier this formula can carry — a fifth rounds to 6 as
   * well and would sell nothing. Adding one means changing the curve, which
   * means rebalancing every tier below it. */
  { id: 'pressure', name: 'Pump Pressure', group: 'Combat',
    blurb: 'Fewer pumps to burst',
    costs: [260, 700, 1500, 2800],
    apply: (t, n) => { t.PUMP_STAGES = Math.max(6, Math.round(12 * Math.pow(0.85, n))); } },

  /* Breaching Tip. One tier, and the COOLDOWN rather than the price is what
   * balances it — see BREACH_CD. Priced between Quick Reel and Longer Harpoon
   * because it buys position, not damage: it opens a hole into a cavity from
   * outside the range at which the thing inside can reach you. */
  { id: 'breach', name: 'Breaching Tip', group: 'Combat',
    blurb: 'Punches one cell of dirt, then needs a moment',
    costs: [420],
    apply: (t, n) => { t.BREACH = n; } },

  { id: 'harpoon', name: 'Longer Harpoon', group: 'Combat',
    blurb: 'Strike from further back',
    /* A fourth tier reaches 10.8 fine cells, which is over half the 20-wide
     * field from a standing start. Nothing enforces a ceiling on this — the AI
     * suite measures reachability against the BASE 6.0 — so it is worth saying
     * out loud that this is now the longest reach in the game. */
    costs: [140, 340, 720, 1100],
    apply: (t, n) => { t.HARPOON_MAX = 6.0 + n * 1.2; } },

  { id: 'reel', name: 'Quick Reel', group: 'Combat',
    blurb: 'Recover faster from a miss',
    costs: [130, 320],
    apply: (t, n) => { t.HARPOON_BACK = 36 + n * 18; } },

  { id: 'lantern', name: 'Lantern', group: 'Instinct',
    blurb: 'See them through the dirt',
    costs: [300],
    apply: (t, n) => { t.LANTERN = n; } },

  { id: 'seismo', name: 'Seismograph', group: 'Instinct',
    blurb: 'Rocks wobble longer before they drop',
    costs: [160, 400],
    apply: (t, n) => { t.ROCK_WOBBLE = 0.9 + n * 0.35; } },

  /* Two tiers now, and the second one is about AIR rather than about monsters.
   *
   * A canary is a gas detector before it is anything else, so "it also tells you
   * where the good air is" is the same bird doing the same job. Tier 2 sets
   * CANARY = 2, which the HUD reads as: point at the nearest untaken pocket.
   * That is the last rung of the discoverability ladder — the damp patches make
   * air findable by looking, and this makes it findable on purpose. */
  /* ── the end of the ladder ──
   *
   * The only upgrade that buys no number at all, and the only one you interact
   * with after buying: tap it and choose a relic, and every run from then on
   * starts carrying it.
   *
   * `endgame` marks it as a terminal purchase rather than a rung. tests/world
   * measures the grind against the LADDER — how long to work through the tiers
   * — and one 10,000-ore capstone is not that. It is priced to be the thing you
   * are still saving for once the tiers are done.
   *
   * The picker is restricted to relics already FOUND, which is what keeps this
   * from being a shortcut to the strongest item in the game: Wide Bore reshapes
   * every tunnel and Barbed Head deletes line-of-sight as a constraint, and
   * both have to be met underground before they can be equipped forever. It
   * also gives the Depths tab a second job — the discovery log becomes the
   * thing that decides what this can offer.
   *
   * `costs` is in the old dirt scale and divided by ORE_RATE, so 20000 here is
   * exactly 10,000 ore at tier 0. */
  { id: 'cache', name: 'Relic Cache', group: 'Instinct',
    blurb: 'Go down carrying one relic you have already found',
    costs: [20000], endgame: true },

  { id: 'canary', name: 'Canary', group: 'Instinct',
    blurb: 'Hear one start to phase, then smell the good air',
    costs: [180, 620],
    apply: (t, n) => { t.CANARY = n; } },
]);

export const UPGRADE_BY_ID = Object.freeze(
  Object.fromEntries(UPGRADES.map((u) => [u.id, u])));

/* Derive the run's tunables from what has been bought.
 *
 * Returns a frozen COPY. TUNE stays the immutable single source of defaults, so
 * a bad `apply` can never leak into the next run, and the engine keeps reading
 * one flat object rather than consulting an upgrade list on every frame. */
export function applyUpgrades(owned: Owned) {
  const t = { ...TUNE };
  for (const u of UPGRADES) {
    const tier = Math.min(Math.max(0, (owned?.[u.id] ?? 0) | 0), u.costs.length);
    /* `apply` is OPTIONAL. Every upgrade used to buy a number, so calling it
     * unconditionally was safe; the Relic Cache buys nothing the simulation can
     * read — what it changes is which relic a run STARTS with, which is meta and
     * belongs to save.js. An upgrade with no tunable is a legitimate shape and
     * this is the one line that has to admit it. */
    if (tier > 0 && u.apply) u.apply(t, tier);
  }
  return Object.freeze(t);
}

/* ── relics ───────────────────────────────────────────────────────────────
 *
 * Found in a sealed chamber below the midpoint of a level, carried for the rest
 * of THAT RUN, and lost the moment you die. A run that finds Wide Bore plays
 * differently from every other run and then that run ends, and that is what
 * lets a relic be far stronger than anything the shop is allowed to sell.
 *
 * The Relic Cache upgrade bends this and is worth being precise about, because
 * the loose version of the old claim — "nothing about a relic is ever written
 * to storage" — is no longer true. What is stored is a CHOICE, not a relic:
 * one id, chosen from the ones the player has already found underground, which
 * seeds state.relics at the start of a run. Everything else holds exactly as
 * before. It is still lost on death, the run still ends, it still occupies one
 * of RELIC_SLOTS, and no relic effect is ever persisted — the tune is rebuilt
 * from the live list every time it changes. The Cache buys a starting hand, not
 * a permanent power.
 *
 * Most of them are one tunable, for the same reason the upgrade table is: the
 * game was already built out of named constants in one file. The four that are
 * not — rock immunity, harpoon pierce, fire immunity, the wider bore — set a
 * FLAG rather than a number, because each is a branch in the simulation and
 * pretending otherwise would mean inventing a constant nobody reads.
 *
 * `apply` mutates a COPY (see applyRelics), never TUNE.
 */
/** A relic either folds a number onto the tune or sets a behaviour flag. */
export type Relic = {
  id: string; name: string; blurb: string;
  apply?: (t: Tune) => void;
  flag?: 'rockproof' | 'fireproof' | 'pierce' | 'wide';
};

export const RELICS: readonly Relic[] = Object.freeze([
  { id: 'drill-bit', name: 'Tungsten Bit',
    blurb: 'Fresh ground gives way faster',
    apply: (t) => { t.SPEED_DIG += 1.4; } },

  { id: 'long-lungs', name: 'Long Lungs',
    blurb: 'A deeper breath before the roof goes',
    apply: (t) => { t.AIR_MAX += 30; } },

  { id: 'still-air', name: 'Still Air',
    blurb: 'What you have lasts longer',
    apply: (t) => { t.AIR_DRAIN *= 0.6; } },

  { id: 'iron-skull', name: 'Iron Skull',
    blurb: 'Falling rock cannot touch you',
    flag: 'rockproof' },

  { id: 'emberproof', name: 'Emberproof Hide',
    blurb: 'Flame washes over you',
    flag: 'fireproof' },

  { id: 'barbed-head', name: 'Barbed Head',
    blurb: 'The harpoon bites through dirt, and through anything',
    flag: 'pierce' },

  { id: 'wide-bore', name: 'Wide Bore',
    blurb: 'You cut a corridor, not a crawlway',
    flag: 'wide' },

  { id: 'ore-lens', name: "Prospector's Lens",
    blurb: 'Every seam pays half again',
    apply: (t) => { t.ORE_MUL *= 1.5; } },

  { id: 'deep-pockets', name: 'Deep Pockets',
    blurb: 'The hopper takes a great deal more',
    apply: (t) => { t.HOPPER += 300; } },

  /* A quarter off, not one off — same reasoning as the pressure upgrade. It
   * folds onto whatever the shop already bought, so the two stack multiplica-
   * tively and neither can drive the fight below four pumps on its own. */
  { id: 'quick-hands', name: 'Quick Hands',
    blurb: 'A quarter fewer pumps, and a faster reel',
    apply: (t) => {
      t.PUMP_STAGES = Math.max(4, Math.round(t.PUMP_STAGES * 0.75));
      t.HARPOON_BACK += 18;
    } },

  { id: 'feather-step', name: 'Feather Step',
    blurb: 'Open tunnel goes by quicker',
    apply: (t) => { t.SPEED_TUNNEL += 1.0; } },

  { id: 'stone-sense', name: 'Stone Sense',
    blurb: 'Rock warns you for longer, and the dark pulls back',
    apply: (t) => { t.ROCK_WOBBLE += 0.6; t.LANTERN += 1; } },
]);

export const RELIC_BY_ID = Object.freeze(
  Object.fromEntries(RELICS.map((r) => [r.id, r])));

export const RELIC_IDS = Object.freeze(RELICS.map((r) => r.id));

/* Fold the relics carried this run onto the run's bought tunables.
 *
 * Takes the UPGRADED tune as its base rather than TUNE, so the two stack in one
 * direction only and there is exactly one place the effective numbers come
 * from. Returns a frozen copy plus the flags, because a flag is not a number
 * and hiding it inside the tune object would make every reader of TUNE wonder
 * what a boolean is doing in there. */
export function applyRelics(base: Tune | null | undefined, ids: readonly string[] | null | undefined) {
  const t = { ...(base || TUNE) };
  const flags = { rockproof: false, fireproof: false, pierce: false, wide: false };
  for (const id of (ids || [])) {
    const r = RELIC_BY_ID[id];
    if (!r) continue;
    if (r.apply) r.apply(t);
    if (r.flag) flags[r.flag] = true;
  }
  return { tune: Object.freeze(t), flags: Object.freeze(flags) };
}

/* The shop is priced in ORE, but `costs` above is authored in the old dirt
 * scale — where the numbers are tuned against each other, which is the part
 * worth keeping. One rate converts the whole table, so rebalancing an upgrade
 * against its neighbours stays a one-line edit and the currency change stays a
 * single constant.
 *
 * 2 rather than 10: exactly the 5x the shop was asked for. At 10 the entire
 * table — every tier of every one of the fifteen upgrades — came to 1703 ore,
 * and a single run to level 12 banks close to a thousand. "After a halfway
 * decent run I can pretty much buy out the entire shop" was a measurement, not
 * a mood.
 *
 * NOT the rate storage.js's v2->v3 migration uses. That one is pinned at the
 * historical 10 on purpose: it is converting a balance that was banked while
 * the game meant 10, and it must not follow this constant when it moves, or a
 * player who happens to upgrade across this release is paid five times over. */
export const ORE_RATE = 2;

/* ...and the curve steepens on top of the flat rate.
 *
 * A flat 5x makes the top tier of Health five times a small number, which is
 * still not an ambition — it is one extra run. Multiplying by TIER_STEEP per
 * tier leaves the entry tier of everything at exactly 5x (1.25^0 = 1) so the
 * shop still opens with something affordable, and puts the last tier of the
 * long ladders at ~12x, which is a target you save toward across a whole
 * evening rather than a box you tick on the way past.
 *
 * It is applied here rather than baked into `costs` so the authored table stays
 * readable as relative worth: Deep Seams tier 1 is still "about three times a
 * Shovel", and that stays true at every rate. */
const TIER_STEEP = 1.25;

/* Cost of the next tier in ORE, or null when it is maxed. */
export function nextCost(id: string, owned: Owned) {
  const u = UPGRADE_BY_ID[id];
  if (!u) return null;
  const tier = Math.max(0, (owned?.[id] ?? 0) | 0);
  if (tier >= u.costs.length) return null;
  return Math.max(1, Math.round(u.costs[tier] / ORE_RATE * Math.pow(TIER_STEEP, tier)));
}

/* Everything still unbought, in ore. The base screen wants it to draw "how far
 * off is the whole shop", and the world suite asserts the total against what a
 * run actually banks — a shop nobody can finish is as broken as one that is
 * bought out in an evening, and neither shows up in a unit test of nextCost. */
export function shopRemaining(owned: Owned) {
  let sum = 0;
  for (const u of UPGRADES) {
    const from = Math.max(0, (owned?.[u.id] ?? 0) | 0);
    for (let t = from; t < u.costs.length; t++) {
      sum += Math.max(1, Math.round(u.costs[t] / ORE_RATE * Math.pow(TIER_STEEP, t)));
    }
  }
  return sum;
}

/* Dirt is the only currency, and it is paid for EXCAVATION — never for kills.
 *
 * That inverts the arcade: monsters are not income, they are what stands
 * between you and the seam. They still have to be cleared to descend, so the
 * reward for killing is access rather than currency, and the richest ground is
 * where they are sitting.
 *
 * A falling rock's bored cells pay exactly like your own digging, which is what
 * keeps rock play worth setting up now that there is no score.
 */
const DIRT_BAND = Object.freeze([1, 2, 3, 5, 8]);   // per cell, by depth band

/* Shallow ground stops being worth stripping once you have been deeper. The
 * expected band for a level is roughly one per two levels; anything shallower
 * decays hard, so farming the top of level 8 earns almost nothing. */
export function dirtValue(band: number, level: number, tune: Tune) {
  const expected = Math.min(GRID.BAND_COUNT - 1, Math.floor((Math.max(1, level) - 1) / 2));
  const gap = Math.max(0, expected - band);
  let v = DIRT_BAND[band] * Math.pow(0.45, gap);
  if (tune && band >= 2) v *= tune.DEEP_MUL;
  return v;
}

/* Ore pays like dirt — per cell excavated — but into a separate purse, and it
 * is the only thing the shop accepts. `grade` is 0..3 from the vein map. */
export function oreValue(grade: number, tune: Tune) {
  const t = tune || TUNE;
  return (t.ORE_VALUE[grade] || 0) * (t.ORE_MUL || 1);
}

/* ── cosmetics: what dirt is FOR ───────────────────────────────────────────
 *
 * Dirt buys suits and camp decoration and NOTHING ELSE. Not a tunable, not a
 * relic slot, not a discount, not a starting depth. That is a hard rule and it
 * is the only reason the two currencies can coexist: ore is the budget you
 * agonise over and dirt is the volume you have moved, so a dirt price can never
 * compete with an ore price for the same decision. The moment a suit is worth
 * one extra pump, every one of these tables has to be balanced against UPGRADES
 * and the shop stops being a single ladder.
 *
 * `apply` is deliberately absent from both tables. There is nothing to apply.
 *
 * ── the prices ────────────────────────────────────────────────────────────
 *
 * Priced against what a run actually banks, measured on the descent model at
 * these densities: a short run to level 6 banks about 9,000 dirt and a deep one
 * to level 18 about 22,000. So the first suit lands inside the first run, the
 * middle of the ladder is a run or two apiece, and the top of it is a season.
 * Dirt accumulates across runs and is never lost on death, so these are
 * cumulative targets rather than per-run ones.
 *
 * ── locks ─────────────────────────────────────────────────────────────────
 *
 * `req` is a plain predicate over the progress record, never over the price:
 * something you cannot buy yet is a different feeling from something you cannot
 * afford yet, and the good half of the table is gated on having BEEN somewhere.
 *
 *   depth    metres, against meta.bestDepth
 *   crystal  a crystal id from CRYSTAL_IDS, against meta.crystals
 *   level    against stats.bestLevel
 *
 * Fields the art pass owns: `sprite` names the sheet row it wants drawn. It is
 * a name here and not a URL, because content.js may not know what a file is.
 */
export const SKINS = Object.freeze([
  { id: 'standard', name: 'Standard Issue', sprite: 'player',
    blurb: 'The suit they hand you at the gate', dirt: 0, req: null },

  { id: 'hi-vis', name: 'Hi-Vis', sprite: 'player-hivis',
    blurb: 'Orange, and glad of it', dirt: 1500, req: null },

  { id: 'sunday', name: 'Sunday Best', sprite: 'player-sunday',
    blurb: 'Pressed, for a job that will ruin it', dirt: 3000, req: null },

  { id: 'copper', name: 'Copper Diver', sprite: 'player-copper',
    blurb: 'Riveted brass and a little round window',
    dirt: 6000, req: Object.freeze({ depth: 400 }) },

  { id: 'lichen', name: 'Lichen Weave', sprite: 'player-lichen',
    blurb: 'Something grew on it down there and you kept it',
    dirt: 10000, req: Object.freeze({ crystal: 'shard-of-loam' }) },

  /* ── the wardrobe ─────────────────────────────────────────────────────
   *
   * Ten suits at one price and no lock at all: this block is what dirt is for
   * once the gated half of the ladder has been worked through. They sit here
   * rather than at the top because a wardrobe is not a rank — nothing about
   * Carbon is meant to read as better than Amethyst.
   *
   * The prices step by 200 rather than all being 10,000 flat because array
   * order IS price order here and the ladder is asserted strictly ascending;
   * the step is small enough that they read as one shelf and large enough to
   * keep that invariant honest. Four of the ten are purple on purpose. */
  { id: 'amethyst', name: 'Amethyst', sprite: 'player-amethyst',
    blurb: 'Violet, and no apology for it', dirt: 10200, req: null },

  { id: 'orchid', name: 'Orchid', sprite: 'player-orchid',
    blurb: 'The loudest thing for four hundred metres', dirt: 10400, req: null },

  { id: 'plum', name: 'Plum Shift', sprite: 'player-plum',
    blurb: 'Almost black until the lamp catches it', dirt: 10600, req: null },

  { id: 'heather', name: 'Heather', sprite: 'player-heather',
    blurb: 'Soft grey-purple, worn soft to match', dirt: 10800, req: null },

  { id: 'tangerine', name: 'Tangerine', sprite: 'player-tangerine',
    blurb: 'Findable from the surface', dirt: 11000, req: null },

  { id: 'glacier', name: 'Glacier', sprite: 'player-glacier',
    blurb: 'Cold blue, for a job that never is', dirt: 11200, req: null },

  { id: 'rust', name: 'Rust Bucket', sprite: 'player-rust',
    blurb: 'It was this colour before the dig, honestly', dirt: 11400, req: null },

  { id: 'mustard', name: 'Mustard', sprite: 'player-mustard',
    blurb: 'Ochre canvas, older than the company', dirt: 11600, req: null },

  { id: 'verdigris', name: 'Verdigris', sprite: 'player-verdigris',
    blurb: 'Copper left out in the weather and improved by it', dirt: 11800, req: null },

  { id: 'carbon', name: 'Carbon', sprite: 'player-carbon',
    blurb: 'Matte black and one red eye', dirt: 12000, req: null },

  { id: 'ashfall', name: 'Ashfall', sprite: 'player-ashfall',
    blurb: 'Scorched to the weave and still airtight',
    dirt: 18000, req: Object.freeze({ level: 12 }) },

  { id: 'geode', name: 'Geode Shell', sprite: 'player-geode',
    blurb: 'Grown, not made',
    dirt: 30000, req: Object.freeze({ crystal: 'blue-heart' }) },

  { id: 'cinder', name: 'Cinder Core', sprite: 'player-cinder',
    blurb: 'Lit from the inside. Nobody asks about it twice',
    dirt: 50000, req: Object.freeze({ crystal: 'cinder-core', depth: 1200 }) },
]);

/* The base camp. Same currency, same rules, no effect on anything.
 *
 * A second table rather than a `slot` field on one, because the base screen
 * places these and the player wears those, and one list that has to be filtered
 * by slot everywhere it is read is the shape that grows a bug. */
/* Twenty-three pieces across THREE rows of the yard rather than one.
 *
 * The original eight were a single line of props along the front. That reads as
 * a shelf once there are twenty-three of them, so basecamp.js now sorts by a
 * `row` on each placement — back behind the buildings, mid among them, front
 * along the duckboards. Which row a piece is in is an art decision and lives
 * there; the price and the lock live here.
 *
 * The array order IS the price order and the test asserts it strictly ascends,
 * so the new pieces are slotted into the gaps in the old ladder rather than
 * stacked on the end. That matters for more than the test: appending them all
 * above 35,000 would have meant a player saw nothing new to buy until the very
 * top of the ladder, when the point of this pass is that there is something to
 * want at every price. */
export const DECOR = Object.freeze([
  { id: 'fern', name: 'Potted Fern', sprite: 'decor-fern',
    blurb: 'It has no business surviving here', dirt: 400, req: null },

  { id: 'lamp', name: 'Hurricane Lamp', sprite: 'decor-lamp',
    blurb: 'Warm light on the spoil heap', dirt: 800, req: null },

  { id: 'deckchair', name: 'Deck Chair', sprite: 'decor-deckchair',
    blurb: 'Striped canvas, pointed away from the shaft', dirt: 1100, req: null },

  { id: 'kettle', name: 'Billy Can', sprite: 'decor-kettle',
    blurb: 'Always just off the boil', dirt: 1600, req: null },

  { id: 'dog', name: 'Camp Dog', sprite: 'decor-dog',
    blurb: 'Came with the site. Will not go down the hole', dirt: 2000, req: null },

  { id: 'lights', name: 'String Lights', sprite: 'decor-lights',
    blurb: 'Strung pithead to bunkhouse, on all night', dirt: 2400, req: null },

  { id: 'noticeboard', name: 'Notice Board', sprite: 'decor-notice',
    blurb: 'Two safety posters and a rota nobody reads', dirt: 2800, req: null },

  { id: 'bench', name: 'Work Bench', sprite: 'decor-bench',
    blurb: 'Somewhere to put the harpoon down', dirt: 3200, req: null },

  { id: 'brazier', name: 'Brazier', sprite: 'decor-brazier',
    blurb: 'The one warm place above ground', dirt: 3800, req: null },

  { id: 'laundry', name: 'Washing Line', sprite: 'decor-laundry',
    blurb: 'Four suits, none of them clean', dirt: 4400, req: null },

  { id: 'canary-cage', name: "Canary's Cage", sprite: 'decor-cage',
    blurb: 'She has earned the perch',
    dirt: 5000, req: Object.freeze({ depth: 300 }) },

  { id: 'toolshed', name: 'Tool Shed', sprite: 'decor-toolshed',
    blurb: 'Everything you own that is not a harpoon', dirt: 6000, req: null },

  { id: 'generator', name: 'Diesel Generator', sprite: 'decor-generator',
    blurb: 'It is why the lights stay on', dirt: 7000, req: null },

  { id: 'core-rack', name: 'Core Rack', sprite: 'decor-cores',
    blurb: 'One cylinder of every band you have cut',
    dirt: 8000, req: Object.freeze({ depth: 640 }) },

  { id: 'conveyor', name: 'Spoil Conveyor', sprite: 'decor-conveyor',
    blurb: 'Takes the fines up the heap so you do not have to',
    dirt: 9500, req: Object.freeze({ depth: 500 }) },

  { id: 'trailer', name: 'Survey Trailer', sprite: 'decor-trailer',
    blurb: 'Green screens, a humming rack, and nobody in it',
    dirt: 11000, req: null },

  { id: 'vitrine', name: 'Crystal Vitrine', sprite: 'decor-vitrine',
    blurb: 'Glass, felt, and room for five',
    dirt: 12000, req: Object.freeze({ crystal: 'stone-eye' }) },

  { id: 'mast', name: 'Radio Mast', sprite: 'decor-mast',
    blurb: 'A red light for aircraft that never come',
    dirt: 14000, req: Object.freeze({ depth: 900 }) },

  { id: 'watertower', name: 'Water Tower', sprite: 'decor-watertower',
    blurb: 'Riveted, rusted, and still holding',
    dirt: 17000, req: Object.freeze({ depth: 1100 }) },

  { id: 'awning', name: 'Striped Awning', sprite: 'decor-awning',
    blurb: 'The camp starts to look like somewhere you live',
    dirt: 20000, req: Object.freeze({ level: 15 }) },

  /* ── the two that go in the SKY ──
   * Everything above stands on the ground and is read against the buildings.
   * These two are read against the moon, which is why they are late on the
   * ladder: they change the horizon rather than dressing the yard, and that is
   * a bigger thing to hand a player than another crate. */
  { id: 'blimp', name: 'Survey Blimp', sprite: 'decor-blimp',
    blurb: 'Drifts the ridge all night, mapping what you have not dug',
    dirt: 22000, req: Object.freeze({ depth: 1300 }) },

  { id: 'silo', name: 'Grain Silo', sprite: 'decor-silo',
    blurb: 'Nobody remembers what was farmed here',
    dirt: 25000, req: Object.freeze({ crystal: 'drowned-pearl' }) },

  { id: 'gantry', name: 'Gantry Crane', sprite: 'decor-gantry',
    blurb: 'It could lift the whole rig, if the rig came up',
    dirt: 30000, req: Object.freeze({ crystal: 'root-of-iron' }) },

  { id: 'headframe', name: 'Pit Headframe', sprite: 'decor-headframe',
    blurb: 'A wheel over the shaft, turning for nobody',
    dirt: 35000, req: Object.freeze({ depth: 1600 }) },

  /* The top of the ladder, and the only piece that is not man-made. Whatever
   * you have been digging through, it was never Earth. */
  { id: 'planet', name: 'The Ringed One', sprite: 'decor-planet',
    blurb: 'Low in the east, banded and tilted. It has always been there',
    dirt: 42000, req: Object.freeze({ depth: 2000 }) },
]);

export const SKIN_BY_ID = Object.freeze(
  Object.fromEntries(SKINS.map((s) => [s.id, s])));
export const DECOR_BY_ID = Object.freeze(
  Object.fromEntries(DECOR.map((d) => [d.id, d])));

export const DEFAULT_SKIN = 'standard';

/* Why this one cannot be bought yet, or null if it can.
 *
 * Returns a REASON rather than a boolean, because the shop wants to print it
 * and a boolean would send the UI back here to work out which clause failed.
 * `progress` is `{ bestDepth, crystals, bestLevel }` — the meta record, passed
 * in rather than read, because content.js may not touch storage. */
export function cosmeticLock(item: { req?: CosmeticReq } | null | undefined, progress: Progress | null | undefined) {
  const r = item && item.req;
  if (!r) return null;
  const pr = progress || {};
  if (r.depth && !(((pr.bestDepth ?? 0) | 0) >= r.depth)) {
    return `Reach ${r.depth} m`;
  }
  if (r.level && !((((pr.bestLevel ?? 0) | 0)) >= r.level)) {
    return `Reach level ${r.level}`;
  }
  if (r.crystal && !(pr.crystals && pr.crystals[r.crystal])) {
    const t = THEMES.find((th) => th.crystal === r.crystal);
    return `Bring up the ${t ? t.name : r.crystal} crystal`;
  }
  return null;
}

/* Directions are plain ints 0..3 = up, right, down, left. Two properties the
 * code leans on: (d & 1) tells you the axis, and (d + 2) & 3 is the reverse. */
export const DX = Object.freeze([0, 1, 0, -1]);
export const DY = Object.freeze([-1, 0, 1, 0]);

/* mulberry32. Small, fast, and good enough for level layout. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Derive a per-level seed from the run seed, so that jumping straight to level 9
 * with ?level=9 lays out exactly as it would have if you'd played there. */
export function levelSeed(runSeed: number, level: number) {
  let h = (runSeed >>> 0) ^ Math.imul(level >>> 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/* Depth band, straight from the row. No SKY_ROWS term any more: the sky is just
 * pre-carved cells inside band 0 on level 1, and on every level below there is
 * no sky at all. That keeps the band arithmetic independent of which level you
 * are on, which is what lets the same row mean the same depth everywhere. */
export function bandOf(fineRow: number) {
  const b = Math.floor(fineRow / GRID.BAND_ROWS);
  return b < 0 ? 0 : b > GRID.BAND_COUNT - 1 ? GRID.BAND_COUNT - 1 : b;
}

/* How many fine rows of sky this level opens with. Level 1 starts at the
 * surface; everything below picks up where the drill left off. */
export function skyRowsFor(level: number) { return (level | 0) <= 1 ? 4 : 0; }

/* Depth in metres, for the gauge and the "furthest depth" stat. One lane node
 * is one metre, and each level is stacked below the last. */
export const DEPTH_PER_LEVEL = GRID.LH;
export function depthOf(level: number, fineRow: number) {
  return (Math.max(1, level | 0) - 1) * DEPTH_PER_LEVEL + Math.floor(fineRow / 2);
}

/* Per-level counts, and the density curve is the whole point of this function.
 *
 * The field went from 28x56 to 20x160 — 392 lane nodes to 800 — and the counts
 * went up by nothing like that, which is what "most of the game is just digging
 * down, there aren't many enemies/rocks/whatever going on" describes. Every
 * count below roughly doubled.
 *
 * More important than the doubling: the SLOPES got steeper, so a level is
 * denser the deeper the run has gone rather than a flat sprinkle that happens
 * to have more of it. Level 1 is 8 monsters and 13 rocks — populated but
 * legible. Level 15 is the cap on both, and a shaft down it should never be
 * quiet for eighty rows at a time.
 *
 * The caps exist because `freeFor()` has to stay satisfiable: 16 cavities of up
 * to 7 nodes each, every one needing a solid ring, is most of a 10x75 region
 * once the rocks and the relic chamber have taken their margins. `placeFails`
 * is returned from generateLevel and asserted on over 1000 levels precisely so
 * that raising these can never silently become "the deep levels got easier". */
export function levelParams(level: number, lanes: number = GRID.LW) {
  const n = Math.max(1, level | 0);
  /* The cap is spatial, not a matter of taste.
   *
   * Every monster needs a sealed cavity of three to seven lane nodes with a
   * solid ring around it, and at ten lanes sixteen of those already burn about
   * thirteen rejected placements a level to fit. The ceiling therefore has to
   * move with the width — measured at roughly 1.6 monsters per lane, which
   * reproduces the known 16 at ten lanes. Ask for more than the field can hold
   * and the failure is silent: the level simply comes out thinner, which reads
   * as "the deep levels got easier" rather than as a bug. See tests/world. */
  const wide = Math.max(1, lanes / 10);
  const cap = Math.round(1.6 * lanes);
  const monsters = Math.min(Math.round((7 + Math.floor(n * 0.9)) * wide), cap);
  return {
    monsters,
    fygars: Math.min(Math.min(Math.max(1 + Math.floor(n / 3), 1), Math.round(5 * wide)), monsters - 1),
    rocks: Math.min(Math.round((12 + Math.floor(n * 0.9)) * wide), Math.round(28 * wide)),
    /* Added to the theme's base count. Both are per level rather than per
     * biome, so the third level of a biome is meaningfully thicker than its
     * first — a biome should tighten as you go through it, not reset. */
    pocketBonus: Math.round(Math.min(Math.floor(n / 3), 6) * wide),
    hazardBonus: Math.round(Math.min(Math.floor(n / 4), 4) * wide),
    veinBonus: Math.round(Math.min(Math.floor(n / 3), 5) * wide),
    speedMul: Math.min(1 + 0.05 * (n - 1), 1.6),
    ghostInterval: Math.max(4, 12 - 0.6 * n),
    fireCooldown: Math.max(1.6, 3.5 - 0.15 * n),
    bonusDirt: Math.round(TUNE.BONUS_DIRT * (1 + 0.35 * (n - 1))),
    oreMul: 1,
    airDrainMul: 1,
  };
}

/* ── grid helpers ─────────────────────────────────────────────────────────
 * Shared with engine.js so "what counts as carved" has exactly one definition.
 * idx() is deliberately unguarded — callers bounds-check first. */
export const idx = (c: number, r: number) => r * GRID.GW + c;

/* A lane node is passable iff all four of its fine cells are carved. This is the
 * whole of enemy pathing: a "tunnel" needs no separate representation, it's just
 * the connected component of passable nodes. */
export function laneClear(dirt: Uint8Array, lc: number, lr: number) {
  const c = lc * 2, r = lr * 2;
  if (c < 0 || r < 0 || c + 1 >= GRID.GW || r + 1 >= GRID.GH) return false;
  return dirt[idx(c, r)] === 0 && dirt[idx(c + 1, r)] === 0 &&
         dirt[idx(c, r + 1)] === 0 && dirt[idx(c + 1, r + 1)] === 0;
}

function carveNode(dirt: Uint8Array, lc: number, lr: number) {
  const c = lc * 2, r = lr * 2;
  if (c < 0 || r < 0 || c + 1 >= GRID.GW || r + 1 >= GRID.GH) return;
  dirt[idx(c, r)] = 0; dirt[idx(c + 1, r)] = 0;
  dirt[idx(c, r + 1)] = 0; dirt[idx(c + 1, r + 1)] = 0;
}

/* Solid dirt, with solid dirt beneath: a rock may only be seeded somewhere it
 * isn't already unsupported, or it would start falling on frame one. */
function rockSeat(dirt: Uint8Array, lc: number, lr: number, gw: number = GRID.GW) {
  const c = lc * 2, r = lr * 2;
  if (c + 1 >= gw || r + 3 >= GRID.GH) return false;
  for (let dc = 0; dc < 2; dc++) {
    for (let dr = 0; dr < 4; dr++) {
      if (dirt[idx(c + dc, r + dr)] !== 1) return false;
    }
  }
  return true;
}

function shuffle<T>(arr: T[], rng: Rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

const laneDist = (a: LaneNode, b: LaneNode) => Math.abs(a.lc - b.lc) + Math.abs(a.lr - b.lr);
const chebDist = (a: LaneNode, b: LaneNode) => Math.max(Math.abs(a.lc - b.lc), Math.abs(a.lr - b.lr));

/* All four fine cells of a lane node are solid, and it is on the field. Out of
 * bounds is NOT solid here — a site touching the edge cannot be sealed, which
 * is what keeps every pocket, chamber and hazard off row 0 without any of them
 * needing to know about skyRows. */
function solidNode(dirt: Uint8Array, lc: number, lr: number, gw: number = GRID.GW) {
  const c = lc * 2, r = lr * 2;
  if (lc < 0 || lr < 0 || c + 1 >= gw || r + 1 >= GRID.GH) return false;
  return dirt[idx(c, r)] === 1 && dirt[idx(c + 1, r)] === 1 &&
         dirt[idx(c, r + 1)] === 1 && dirt[idx(c + 1, r + 1)] === 1;
}

/* A w x h block of lane nodes at (lc,lr) AND the one-node ring around it are
 * all solid. The ring is the seal: without it a chamber can open into a
 * monster's corridor and stop being something you have to dig to. */
function blockSealed(dirt: Uint8Array, lc: number, lr: number, w: number, h: number, gw: number = GRID.GW) {
  for (let dc = -1; dc <= w; dc++) {
    for (let dr = -1; dr <= h; dr++) {
      if (!solidNode(dirt, lc + dc, lr + dr, gw)) return false;
    }
  }
  return true;
}

/* One weighted draw. Exactly one rng() call, whatever the list length — which
 * matters, because the call COUNT is part of the generator's fixed order. */
function pickWeighted<T extends { weight: number }>(list: readonly T[], rng: Rng): T {
  let total = 0;
  for (const e of list) total += e.weight;
  let r = rng() * total;
  for (const e of list) { r -= e.weight; if (r <= 0) return e; }
  return list[list.length - 1];
}

/* ── ore veins ────────────────────────────────────────────────────────────
 *
 * Seeded random walkers, not per-cell noise.
 *
 * Noise was the first thing tried and it is unreadable: scattered single cells
 * pay out at random as you dig and teach nothing, so there is no such thing as
 * following a seam. A walker with DIRECTIONAL MOMENTUM — the heading turns by
 * at most a small jitter per step — draws a continuous streak, and a 2x2 brush
 * makes it thick enough to survive being crossed by a 2-cell-wide tunnel. The
 * result is something a player can chase: hit one cell of grade 3 and the next
 * one is probably a step further along the same heading.
 *
 * The start row is depth-weighted (rng ** (1 - depthBias) skews toward 1, i.e.
 * toward the bottom of the field), so the richest ground is the ground the
 * cave-in clock is trying to stop you reaching.
 *
 * Ore is only ever written into SOLID cells. A grade sitting in air can never
 * be paid out — carve() collects it on the 1->0 transition — so writing one
 * would be invisible bookkeeping that inflates every total. */
function layVeins(dirt: Uint8Array, ore: Uint8Array, rng: Rng, theme: Theme, level: number, bonus: number, gw: number) {
  const { GH } = GRID;
  const GW = gw;
  const spec = theme.veins;
  // The theme's base plus levelParams().veinBonus, so a deep run in a shallow
  // biome is still worth stripping. Capped, or the field turns into solid ore.
  const count = spec.count + Math.max(0, bonus | 0);
  let cells = 0;

  for (let v = 0; v < count; v++) {
    const d = Math.pow(rng(), 1 - spec.depthBias);
    let y = 4 + d * (GH - 10);
    let x = rng() * (GW - 2);
    let ang = rng() * Math.PI * 2;
    const steps = Math.round(spec.len * 2);

    for (let s = 0; s < steps; s++) {
      // Momentum: a small turn per step, so the heading persists.
      ang += (rng() - 0.5) * 0.7;
      x += Math.cos(ang) * 0.85;
      y += Math.sin(ang) * 0.85;
      // Reflect rather than clamp — a clamped walker smears along the wall.
      if (x < 0) { x = -x; ang = Math.PI - ang; }
      if (x > GW - 2) { x = 2 * (GW - 2) - x; ang = Math.PI - ang; }
      if (y < 2) { y = 4 - y; ang = -ang; }
      if (y > GH - 2) { y = 2 * (GH - 2) - y; ang = -ang; }

      /* Grade per STEP, not per cell: a vein is one mineral, so its four
       * brushed cells should agree.
       *
       * The bottom band — and only the bottom band — adds a grade of its own.
       * It was band 3 and below at first, which sounds like a small difference
       * and is not: bands 3 and 4 are 40% of the field, the walkers are already
       * pushed downward, and the result was a topsoil level whose mean cell was
       * worth 2.9 with almost nothing to find in the two bands the player
       * actually digs on level 1. Depth should be a bonus at the bottom, not
       * the only place ore is worth anything. */
      let g = spec.grade + (rng() < spec.rich ? 1 : 0);
      if (bandOf(Math.floor(y)) >= GRID.BAND_COUNT - 1) g++;
      if (g > 3) g = 3;

      const c0 = Math.floor(x), r0 = Math.floor(y);
      for (let dc = 0; dc < 2; dc++) {
        for (let dr = 0; dr < 2; dr++) {
          const c = c0 + dc, r = r0 + dr;
          if (c < 0 || c >= GW || r < 0 || r >= GH) continue;
          const i = idx(c, r);
          if (dirt[i] !== 1 || ore[i] !== 0) continue;
          ore[i] = g;
          cells++;
        }
      }
    }
  }
  return cells;
}

/* Monster cavity length, in lane tiles. A one-tile pocket is nearly impossible
 * to fight in — nowhere to line up a shot, nowhere to retreat to. */
const CAVITY_MIN = 3;
const CAVITY_MAX = 7;


/* Build a level. Returns plain data; engine.js turns it into entities.
 *
 * The field starts almost entirely solid: a one-node pocket at the surface for
 * the player, and one sealed cavity per monster. There are no galleries, no
 * connectors and no shaft — every route in the level is one the player cut.
 *
 * That is the whole game. The previous generator pre-dug 16% of the field, which
 * let monsters roam long corridors from the first second and meant the player
 * was navigating someone else's maze rather than making their own. Bot trials
 * went from 31-second games to 108-second games on this change alone.
 *
 * Because monsters begin sealed in, they cannot reach the player until either
 * the player digs to them or they phase out on their ghost timer. Both are
 * intended: digging toward a cavity is the risk, and ghosting is the pressure.
 *
 * Reachability needs no validation — the player digs, so everything is reachable
 * by definition. The invariants worth enforcing are that each spawned actor has
 * a clear 2x2 and that nothing is stacked on anything else.
 *
 * ── THE RNG CALL ORDER IS FIXED. CHANGING IT VOIDS EVERY SEED. ───────────
 *
 *   1. start column        one call, and ONLY when no entryLc was handed in
 *   2. monster cavities    five calls per attempt, including rejected attempts
 *   3. rock seats          the Fisher-Yates shuffle over every legal seat
 *   4. bonus guard         one call, if any monster was placed
 *   5. monster kinds       one call per monster past the guaranteed fygars,
 *                          plus one more on any slot that rolls a mite swarm
 *   6. relic chamber       one roll, then two per placement attempt, then the
 *                          relic-pool shuffle — all skipped if the roll fails
 *   7. crystal             no calls (it is derived from the monster list)
 *   8. ore veins           three per walker plus two per step
 *   9. air pockets         three per attempt, in depth strata
 *  10. hazards             three per attempt
 *
 * The SEQUENCE is the invariant; add new work at the end, never in the middle.
 *
 * ── this pass DID void every existing seed, and could not avoid it ───────
 *
 * Step 2 draws five numbers per attempt including rejected ones, so raising
 * p.monsters moves the stream for every step after it. There is no version of
 * "substantially more monsters" that leaves an old seed alone, so the density
 * pass and the air-pocket rewrite were done together rather than paying the
 * cost twice. Screenshot scenes will all have moved; that is expected exactly
 * once, here. The discipline resumes from this commit. */
export function generateLevel(
  level: number, seed: number,
  opts?: { entryLc?: number; lanes?: number; monsters?: number },
) {
  const rng = makeRng(seed);
  /* `lanes` is the width actually in play; GRID.LW is the storage maximum.
   * Everything the generator places is bounded by `lanes`, so the columns past
   * it are never carved and stay solid for the whole run. `monsters` is a
   * test-only override used by the density sweep; absent, it changes nothing
   * and every existing seed still reproduces. */
  const lanes = Math.max(4, Math.min(GRID.LW, (opts?.lanes ?? GRID.LW) | 0));
  const gw = lanes * 2;
  const p = levelParams(level, lanes);
  const wantMonsters = Math.max(1, (opts?.monsters ?? p.monsters) | 0);
  const { GW, GH, LH } = GRID;
  const LW = lanes;
  const skyRows = skyRowsFor(level);
  const theme = themeOf(level);

  /* Solid everywhere, then the sky opened over the PLAYED width only.
   *
   * The columns past the active field are the edge of the world, and the edge
   * has to read as rock. Carving the sky across the whole storage array instead
   * would leave open air out there — which nothing can walk into, but which a
   * harpoon, a jet or a falling rock would happily sample, and they would find
   * a hole where the original found the end of the map. */
  const dirt = new Uint8Array(GW * GH);
  dirt.fill(1);
  for (let r = 0; r < skyRows; r++) {
    for (let c = 0; c < gw; c++) dirt[idx(c, r)] = 0;
  }

  /* The player stands in a pocket exactly their own size. No shaft: there is
   * deliberately no pre-made way down.
   *
   * Below level 1 there is no sky, so row 0 is solid everywhere except this
   * pocket — which is what preserves the protection SKY_ROWS used to give. The
   * old clamp existed because a pre-carved sky band let the player surface and
   * then cross the whole map carving nothing; with no sky band, travelling
   * along the top means digging like anywhere else.
   *
   * `entryLc` carries the column the drill came down in, so the shaft you cut
   * at the end of one level is the shaft you arrive in at the top of the next. */
  const startLr = skyRows > 0 ? skyRows / 2 : 0;
  const entryLc = opts && opts.entryLc;
  const startLc = entryLc === undefined || entryLc === null
    ? 2 + Math.floor(rng() * (LW - 4))
    : Math.min(LW - 1, Math.max(0, entryLc | 0));
  carveNode(dirt, startLc, startLr);
  const start = { lc: startLc, lr: startLr };

  /* One sealed cavity per monster: a straight corridor, CAVITY_MIN..CAVITY_MAX
   * lane tiles long, horizontal or vertical.
   *
   * Length is the point. A one-tile pocket gives the monster nowhere to go and
   * the player nowhere to stand, so the fight is decided by whoever happens to
   * be facing the right way — there is no room to line up a harpoon or to back
   * off. A corridor lets the monster patrol and lets you approach from either
   * end and shoot down it. */
  const monsters = [];
  const cavities: LaneNode[] = [];   // every carved node, for later separation checks
  // Deep enough that the last survivor's run to the surface is worth watching:
  // at startLr + 3 a shallow monster escaped in under a second.
  const minLr = startLr + 5;

  // A corridor may be cut only if it and its immediate surroundings are still
  // solid, so two cavities can never merge into one big pre-dug chamber.
  const freeFor = (nodes: LaneNode[]) => nodes.every((n) => {
    if (n.lc < 0 || n.lc >= LW || n.lr < minLr || n.lr >= LH) return false;
    if (laneDist(n, start) < 6) return false;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (cavities.some((o) => o.lc === n.lc + dc && o.lr === n.lr + dr)) return false;
      }
    }
    return true;
  });

  /* A narrow field cannot host a 7-long HORIZONTAL corridor with a one-node
   * margin on both sides — LW is 10 — so bias strongly vertical. Without this
   * the loop below burns its guard on rejections and the level silently ends up
   * with fewer monsters than params asked for, which reads as "the game got
   * easier at depth" rather than as a bug. `placeFails` is returned so the
   * harness can assert on it. */
  let placeFails = 0;
  for (let guard = 0; guard < 4000 && monsters.length < wantMonsters; guard++) {
    const lc = Math.floor(rng() * LW);
    const lr = minLr + Math.floor(rng() * (LH - minLr));
    const horiz = rng() < 0.25;
    const maxLen = horiz ? Math.min(CAVITY_MAX, LW - 2) : CAVITY_MAX;
    const len = CAVITY_MIN + Math.floor(rng() * (maxLen - CAVITY_MIN + 1));
    const back = Math.floor(rng() * len);           // where along it the monster sits

    const nodes = [];
    for (let k = 0; k < len; k++) {
      nodes.push(horiz ? { lc: lc - back + k, lr } : { lc, lr: lr - back + k });
    }
    if (!freeFor(nodes)) { placeFails++; continue; }

    for (const n of nodes) { carveNode(dirt, n.lc, n.lr); cavities.push(n); }
    const home = nodes[back];
    monsters.push({
      lc: home.lc, lr: home.lr,
      kind: monsters.length < p.fygars ? 'fygar' : 'pooka',
      cavity: nodes,
    });
  }

  // Rocks sit in solid ground with solid ground beneath, so none of them is
  // unsupported on frame one. Keeping them clear of the cavities stops a rock
  // from dropping on a monster before the player has done anything.
  const seats = [];
  for (let lr = startLr + 2; lr < LH - 1; lr++) {
    for (let lc = 0; lc < LW; lc++) {
      if (!rockSeat(dirt, lc, lr, gw)) continue;
      if (cavities.some((o) => laneDist(o, { lc, lr }) < 3)) continue;
      seats.push({ lc, lr });
    }
  }
  shuffle(seats, rng);
  const rocks: LaneNode[] = [];
  for (const s of seats) {
    if (rocks.length >= p.rocks) break;
    if (rocks.some((o) => Math.abs(o.lc - s.lc) < 2 && Math.abs(o.lr - s.lr) < 3)) continue;
    rocks.push(s);
  }

  /* The vegetable is stashed at the far end of a random monster's corridor, so
   * that monster ends up guarding it. It has no special hold on the bonus and
   * does not react to it — it is simply in the way, which is the point: the
   * reward is somewhere you have to dig to and fight for, rather than sitting
   * on the surface where the arcade put it. */
  let bonusAt = { lc: startLc, lr: startLr };
  if (monsters.length) {
    const guard = monsters[Math.floor(rng() * monsters.length)];
    let far = guard.cavity[0];
    for (const n of guard.cavity) {
      if (laneDist(n, guard) > laneDist(far, guard)) far = n;
    }
    bonusAt = { lc: far.lc, lr: far.lr };
  }

  /* ── 5. monster kinds ───────────────────────────────────────────────────
   *
   * The first p.fygars stay fygars whatever the theme asks for, and that is a
   * safety rule rather than a taste one: a static kind (Geode, Warden) does not
   * count toward clearing the level, so a mix that happened to roll all-static
   * would clear itself the instant the level loaded. Guaranteeing at least one
   * mobile, killable monster makes that impossible by construction rather than
   * by hoping the weights are kind.
   *
   * Three kinds are not interchangeable with the rest and this pass owns the
   * difference. A weight in theme.mix is a weight on an EVENT — "a swarm here",
   * "the level's grub here" — not on a head count.
   *
   * RNG: one pickWeighted per slot, plus one extra call on a slot that rolls a
   * swarm. Deterministic given the same rolls, which is what the fixed order
   * needs; it does not need a fixed call COUNT. */
  /* ── the Geode's rock, and why "somewhere in the column" was not enough ──
   *
   * A Geode dies to one thing: a rock dropped on it. The old rule was that some
   * rock existed in its column, anywhere above it — which on a field 80 lane
   * rows deep can be sixty rows up. Undermining a rock sixty rows above a
   * monster is not a plan, it is a second level; in practice the player dug
   * around the Geode and left it, which makes the ore salted underneath it
   * (step 8) unclaimable and the kind pointless.
   *
   * GEODE_ROCK_REACH lane rows is the guarantee now, and it is a HARD one: if
   * the level did not happen to seat a rock in reach, one is seated here, and
   * only if that also fails does the slot fall back to a Pooka. Seating scans
   * upward from just above the Geode, so the answer is as close as the terrain
   * allows rather than as far as it is permitted.
   *
   * No rng: the scan is deterministic, so this adds nothing to the call order
   * and can sit inside step 5 without moving the stream. */
  const GEODE_ROCK_REACH = 10;
  const rockAbove = (m: LaneNode) => rocks.some(
    (r) => r.lc === m.lc && r.lr < m.lr && m.lr - r.lr <= GEODE_ROCK_REACH);

  /* The nearest legal seat above `m` within reach, or null. A seat is legal on
   * the same terms every other rock's is — solid ground with solid ground under
   * it, and not stacked on another rock — with one deliberate exception: the
   * cavity clearance is 2 rather than 3, because the whole point is to put this
   * rock over a monster. It still cannot fall on frame one; a seated rock does
   * not move until the player digs its footing out. */
  const rockSeatAbove = (m: LaneNode) => {
    for (let d = 2; d <= GEODE_ROCK_REACH; d++) {
      const lr = m.lr - d;
      if (lr < startLr + 2) break;
      if (!rockSeat(dirt, m.lc, lr, gw)) continue;
      if (rocks.some((o) => Math.abs(o.lc - m.lc) < 2 && Math.abs(o.lr - lr) < 3)) continue;
      if (cavities.some((o) => laneDist(o, { lc: m.lc, lr }) < 2)) continue;
      return { lc: m.lc, lr };
    }
    return null;
  };
  // Can this monster be a Geode at all — either the rock is already there, or a
  // seat exists for one. Asked before the kind is committed, and again by the
  // crystal pass, which must not stamp a Geode onto something unkillable.
  const geodeOk = (m: LaneNode) => rockAbove(m) || !!rockSeatAbove(m);
  const ensureRock = (m: LaneNode) => {
    if (rockAbove(m)) return true;
    const s = rockSeatAbove(m);
    if (!s) return false;
    rocks.push(s);
    return true;
  };
  // The Grub joins cavities on purpose, so it is the one kind that can rewrite
  // a layout out from under the player. One, and never near the surface.
  const GRUB_MIN_LR = Math.max(startLr + 10, 20);
  let grubs = 0;

  for (let i = p.fygars; i < monsters.length; i++) {
    const m = monsters[i];
    let kind = pickWeighted(theme.mix, rng).kind;

    if (kind === 'grub' && (grubs >= 1 || m.lr < GRUB_MIN_LR)) kind = 'pooka';
    /* A Geode dies only to a dropped rock. It does not gate the descent, so one
     * without a rock above it is not a soft-lock — it is a permanent wall in a
     * corridor, which is a thing the player can dig around but can never clear,
     * and that is not what a monster slot is for. ensureRock() either finds the
     * answer within GEODE_ROCK_REACH or seats it; a slot that cannot have one
     * either way is not allowed to be a Geode. */
    if (kind === 'geode' && !ensureRock(m)) kind = 'pooka';

    if (kind === 'grub') grubs++;

    /* A swarm needs room in the budget to BE a swarm. On the last slot of the
     * level there is none, and a lone Mite is a one-pump weakling that reads as
     * a broken Pooka — so it becomes one instead. */
    if (kind === 'mite' && monsters.length - i < 2) kind = 'pooka';

    if (kind === 'mite') {
      /* A swarm out of ONE corridor. It spends the slots it occupies rather
       * than adding to the count, so p.monsters still means what it says and
       * the placement assertion still holds; the corridors those slots would
       * have used are simply left empty, which reads as cave structure.
       *
       * They are spread along the host corridor rather than stacked, because
       * three actors on one node resolve by walking apart and the first second
       * of the fight is the one that has to be legible. */
      const swarm = Math.min(2 + Math.floor(rng() * 2), monsters.length - i);
      for (let k = 0; k < swarm; k++) {
        const s = monsters[i + k];
        const node = m.cavity[(k * 2) % m.cavity.length];
        s.kind = 'mite';
        s.lc = node.lc;
        s.lr = node.lr;
        s.cavity = m.cavity;
      }
      // The loop steps over the slots the swarm just spent, so they are never
      // rolled a second time and no marker has to be carried to say so.
      i += swarm - 1;
      continue;
    }

    m.kind = kind;
  }

  /* ── 6. the relic chamber ───────────────────────────────────────────────
   *
   * Rare, sealed, and always below the midpoint of the field, so a relic is
   * something you commit to the bottom of a level for while the air runs down.
   *
   * It is PRE-CARVED, unlike an air pocket. A 2x2 room is a place, and it wants
   * to read as one the moment your tunnel breaks into it. It is also kept clear
   * of every rock seat by a Chebyshev margin of 3 — a rock seated before this
   * pass would find its footing carved out from under it and fall on frame one,
   * which looked exactly like a physics bug the two times it happened. */
  let relicSite = null;
  if (rng() < theme.relicChance) {
    const minLr = Math.floor(LH / 2);
    for (let guard = 0; guard < 400; guard++) {
      const lc = 1 + Math.floor(rng() * (LW - 3));
      const lr = minLr + Math.floor(rng() * (LH - minLr - 2));
      const nodes = [
        { lc, lr }, { lc: lc + 1, lr }, { lc, lr: lr + 1 }, { lc: lc + 1, lr: lr + 1 },
      ];
      if (!blockSealed(dirt, lc, lr, 2, 2, gw)) continue;
      if (nodes.some((n) => rocks.some((r) => chebDist(r, n) <= 3))) continue;
      if (nodes.some((n) => cavities.some((o) => chebDist(o, n) <= 2))) continue;
      for (const n of nodes) { carveNode(dirt, n.lc, n.lr); cavities.push(n); }
      /* A shuffled POOL rather than one id: the engine takes the first relic
       * the player is not already carrying, so a second chamber in the same run
       * can never hand out a duplicate — and the choice is still made here,
       * where the rng lives, rather than at pickup time off state.rng. */
      const pool = shuffle(RELIC_IDS.slice(), rng);
      relicSite = { lc, lr, nodes, pool, at: { x: lc * 2 + 1, y: lr * 2 + 1 } };
      break;
    }
  }

  /* ── 7. the crystal ─────────────────────────────────────────────────────
   *
   * One per theme, on the levels where level % 3 === 0 — which, with themeOf()
   * advancing every three levels, is exactly one level per biome.
   *
   * Buried at the far end of a monster's corridor, the same way the vegetable
   * is and for the same reason: the reward has to be somewhere you dig to and
   * fight for. The guard is forced to the theme's signature kind, so the thing
   * sitting on the Blue Heart is always a Geode.
   *
   * The DEEPEST monster is chosen rather than a random one in the bottom band,
   * because the placement loop samples rows uniformly and a level can quite
   * legitimately contain no monster in band 4 at all. Picking the deepest gives
   * the bottom band about seven levels in ten and never fails, where filtering
   * to band 4 would sometimes leave a crystal level with no crystal — and "a
   * crystal present exactly when level % 3 === 0" is an assertion, not a hope. */
  let crystalAt = null;
  if (level % 3 === 0 && monsters.length) {
    /* The guard has to be DEEP, but it also has to be a monster the signature
     * kind can legally be stamped onto — and the first version of this stamped
     * it on the deepest monster unconditionally, which quietly broke all three
     * of the step 5 rules on exactly the levels that matter most: it made a
     * second Grub, it made a Geode with no rock to drop on it, and when the
     * deepest monster happened to be in a Mite swarm it left the swarm with one
     * member. Eligibility is checked here rather than repaired afterwards. */
    const sig = theme.signature;
    const eligible = (m: MonsterSpec) => {
      if (m.kind === 'mite') return false;            // never break up a swarm
      if (sig === 'geode') return geodeOk(m);         // ...and killable within 10
      return true;
    };
    let gi = -1;
    for (let i = 0; i < monsters.length; i++) {
      if (eligible(monsters[i]) && (gi < 0 || monsters[i].lr > monsters[gi].lr)) gi = i;
    }
    /* Fall back to the deepest non-Mite and a kind that is always a real fight
     * and always killable. Better a Fygar on the Blue Heart than a Geode with
     * nothing in the level able to break it. */
    let kind = sig;
    if (gi < 0) {
      kind = 'fygar';
      for (let i = 0; i < monsters.length; i++) {
        if (monsters[i].kind !== 'mite' && (gi < 0 || monsters[i].lr > monsters[gi].lr)) gi = i;
      }
    }
    if (gi < 0) gi = 0;                               // every monster is a mite
    const guard = monsters[gi];
    guard.kind = kind;
    // eligible() only promised a seat existed; take it, or the crystal ends up
    // behind the one Geode in the level nothing can break.
    if (kind === 'geode' && !ensureRock(guard)) guard.kind = 'fygar';
    // Still exactly one Grub: if the guard became it, whichever one step 5
    // handed out stands down.
    if (kind === 'grub') {
      for (const m of monsters) if (m !== guard && m.kind === 'grub') m.kind = 'pooka';
    }
    // Far end of the corridor, and not the node the vegetable already claimed.
    let far = guard.cavity[0];
    for (const n of guard.cavity) {
      const better = laneDist(n, guard) > laneDist(far, guard);
      const clash = n.lc === bonusAt.lc && n.lr === bonusAt.lr;
      if (better && !clash) far = n;
    }
    if (far.lc === bonusAt.lc && far.lr === bonusAt.lr) far = guard;
    crystalAt = { lc: far.lc, lr: far.lr, id: theme.crystal, guard: guard.kind };
  }

  /* ── 8. ore veins ───────────────────────────────────────────────────── */
  const ore = new Uint8Array(GW * GH);
  let oreCells = layVeins(dirt, ore, rng, theme, level, p.veinBonus, gw);

  /* A Geode sits ON ore, and that is the entire reason to bother killing one.
   *
   * It is static, it does not gate the descent, and it takes a dropped rock to
   * break — so left alone it is just a wall you dig around, and the player is
   * right to ignore it. Salting the solid ground beneath it with grade 3 turns
   * it into a deliberate set-up: line the rock up, break the Geode, and the
   * shaft the rock bores on its way through pays out the seam underneath it.
   *
   * Stamped after the walkers so it is never overwritten, and only into cells
   * that are still solid — its own node is carved, being a cavity. */
  for (const m of monsters) {
    if (m.kind !== 'geode') continue;
    const c = m.lc * 2, r = m.lr * 2;
    /* Search for solid ground rather than assuming it is at r+2. A Geode sits
     * somewhere along a corridor, and if that corridor runs VERTICALLY the four
     * rows under it are its own carved cavity — which is where the first
     * version of this stamped, so a third of all Geodes sat on nothing at all.
     * Scan down past the corridor, and fall back to scanning up for the ones
     * standing on the floor of the field. */
    const want = 8;
    let got = 0;
    const stamp = (cc: number, rr: number) => {
      if (cc < 0 || cc >= GW || rr < 0 || rr >= GH || got >= want) return;
      const i = idx(cc, rr);
      if (dirt[i] !== 1 || ore[i] !== 0) return;
      ore[i] = 3;
      oreCells++;
      got++;
    };
    for (let dr = 2; dr < 16 && got < want; dr++) {
      stamp(c, r + dr);
      stamp(c + 1, r + dr);
    }
    for (let dr = 1; dr < 16 && got < want; dr++) {
      stamp(c, r - dr);
      stamp(c + 1, r - dr);
    }
  }

  /* ── 9. air pockets ─────────────────────────────────────────────────────
   *
   * A pocket is still a SEALED node that stays SOLID in the dirt grid. It is
   * not carved out: carve() collects one by rectangle overlap the moment a dig
   * reaches it, and pre-carving would punch a hole in solid ground, make the
   * node passable to pathing, and hand a landing spot to any ghost that
   * wandered past.
   *
   * ── what changed, and the measurement that forced it ──────────────────
   *
   * Twelve runs at level 5 generated 48 pockets and the player took ONE. The
   * reported symptom was "I feel like I'm not getting air every time I enter a
   * pocket"; the truth was worse — they were almost never touching one. The
   * pickup code was never the problem. The arithmetic was: a shaft is one lane
   * wide, a pocket is one lane node, and the field is ten lanes across, so a
   * pocket placed uniformly is found about one time in ten per row it shares
   * with the route. Hiding it perfectly was hiding it from the game.
   *
   * Three changes, and it needed all three:
   *
   *   DENSITY   the theme's base roughly tripled, plus levelParams().pocketBonus.
   *   STRATA    one pocket per depth stratum instead of `wantPockets` uniform
   *             draws, so the descent can never contain a dead sixty rows —
   *             uniform sampling routinely left the whole bottom third dry.
   *   ROUTE     half of them are drawn near a monster's column rather than
   *             anywhere. The monsters are the one part of the level the player
   *             is FORCED to visit, so biasing toward them puts air on the route
   *             the level itself imposes, without the generator having to guess
   *             at a shaft it cannot see.
   *
   * and then the tell, below, which is what turns "there is air near your route"
   * into "you can see where the air is". AIR_MAX and AIR_DRAIN are untouched —
   * a level where you find nothing still reproduces the old invisible 75-second
   * cave-in timer to the second, which is the property that makes any of this
   * safe to tune.
   *
   * RNG: exactly three calls per attempt on both branches of the route roll, so
   * the call count does not depend on which branch is taken. */
  const pockets: Pocket[] = [];
  const wantPockets = theme.pockets + p.pocketBonus;
  const pocketMinLr = startLr + 4;
  const stratum = Math.max(1, (LH - pocketMinLr) / wantPockets);
  for (let i = 0; i < wantPockets; i++) {
    const lo = pocketMinLr + Math.floor(i * stratum);
    const hi = Math.min(LH, Math.max(lo + 1, pocketMinLr + Math.floor((i + 1) * stratum)));
    // The monster nearest this stratum, i.e. the traffic that passes through it.
    const mid = (lo + hi) / 2;
    let anchor = null;
    for (const m of monsters) {
      if (!anchor || Math.abs(m.lr - mid) < Math.abs(anchor.lr - mid)) anchor = m;
    }
    for (let guard = 0; guard < 120; guard++) {
      const route = rng() < 0.5 ? anchor : null;
      const lc = route
        ? Math.min(LW - 1, Math.max(0, route.lc - 2 + Math.floor(rng() * 5)))
        : Math.floor(rng() * LW);
      const lr = lo + Math.floor(rng() * (hi - lo));
      const n = { lc, lr };
      if (!blockSealed(dirt, lc, lr, 1, 1, gw)) continue;
      if (laneDist(n, start) < 8) continue;
      if (cavities.some((o) => chebDist(o, n) <= 1)) continue;
      // Separation is 4 rather than 6: at three times the count the old spacing
      // could not be satisfied, and an unsatisfiable guard fails SILENTLY as a
      // level with less air than it asked for.
      if (pockets.some((o) => laneDist(o, n) < 4)) continue;
      pockets.push({
        lc, lr, amount: TUNE.AIR_POCKET, taken: false,
        hint: { up: TUNE.HINT_UP, w: TUNE.HINT_W },
      });
      break;
    }
  }

  /* A stratum that could not seat its pocket gives it back to the field.
   *
   * At nineteen pockets the strata are four lane rows deep, and four rows that
   * happen to be full of cavity can genuinely have nowhere legal in them. The
   * strata exist to stop the descent having a dry stretch, not to be a quota
   * per four rows — so a stratum that fails hands its pocket to a free draw
   * over the whole field rather than the level quietly coming out thinner.
   * Separation drops to 3 here for the same reason: this pass only runs when
   * the strict one has already proved unsatisfiable. Without this the world
   * suite counted 55 thin levels in 1020, all of them deep ones. */
  for (let guard = 0; guard < 2000 && pockets.length < wantPockets; guard++) {
    const lc = Math.floor(rng() * LW);
    const lr = pocketMinLr + Math.floor(rng() * (LH - pocketMinLr));
    const n = { lc, lr };
    if (!blockSealed(dirt, lc, lr, 1, 1, gw)) continue;
    if (laneDist(n, start) < 8) continue;
    if (cavities.some((o) => chebDist(o, n) <= 1)) continue;
    if (pockets.some((o) => laneDist(o, n) < 3)) continue;
    pockets.push({
      lc, lr, amount: TUNE.AIR_POCKET, taken: false,
      hint: { up: TUNE.HINT_UP, w: TUNE.HINT_W },
    });
  }

  /* ── 9b. the surface tell ───────────────────────────────────────────────
   *
   * `pocketHint` is a fine-cell grid parallel to `dirt` and `ore`: 0 nothing,
   * 1 a faint damp, 2 a wet patch with the bubbles in it. terrain.js blits it
   * into the band fill; nothing in the simulation reads it.
   *
   * The shape is a PLUME rising from the pocket rather than a halo around it,
   * because the player is descending and has to see the tell before they are
   * level with the thing it points at. It widens as it rises — water spreading
   * as it seeps up through ground — which is also what makes a pocket visible
   * from a shaft that is not in its column, and a one-lane shaft is otherwise
   * only ever in one column out of ten.
   *
   * Strength 2 is reserved for the pocket's own node and the row above it, so
   * "damp" reads as a direction and "wet" reads as arrival. Written only into
   * cells that are solid right now: a hint in carved space would be a stain in
   * mid-air, and the renderer would have to filter it out again.
   *
   * This is the deliberate reversal of the old rule that nothing about the
   * terrain may give a pocket away. It gives it away on purpose. The hidden
   * version was measured at one pickup in forty-eight. */
  const pocketHint = new Uint8Array(GW * GH);
  const markHint = (lc: number, lr: number, v: number) => {
    if (lc < 0 || lc >= LW || lr < 0 || lr >= LH) return;
    const c = lc * 2, r = lr * 2;
    for (let dc = 0; dc < 2; dc++) {
      for (let dr = 0; dr < 2; dr++) {
        const i = idx(c + dc, r + dr);
        if (dirt[i] !== 1) continue;             // never stain open air
        if (pocketHint[i] < v) pocketHint[i] = v;
      }
    }
  };
  for (const q of pockets) {
    for (let d = -1; d <= TUNE.HINT_UP; d++) {
      // Width grows with height: 1 lane either side to start, TUNE.HINT_W once
      // the plume has had room to spread.
      const half = d <= 1 ? 1 : Math.min(TUNE.HINT_W, 1 + Math.floor((d - 1) / 2));
      for (let dc = -half; dc <= half; dc++) {
        const strong = d >= 0 && d <= 1 && Math.abs(dc) <= 1;
        markHint(q.lc + dc, q.lr - d, strong ? 2 : 1);
      }
    }
  }

  /* ── 10. hazards ────────────────────────────────────────────────────────
   *
   * One kind per theme, all five built out of machinery that already exists:
   * the seep and the gas pocket lean on the air drain, dripstone and shardfall
   * push a rock into state.rocks and let stepRocks do the rest (so the warning
   * is the wobble the player already reads and the helmet already covers it),
   * and the basalt vent throws a spinning wheel of fire down a corridor it has
   * already telegraphed, at a speed between digging and running — so the tunnel
   * you cut is the escape and the face you are cutting is not.
   *
   * Every one of them is seeded in SOLID ground and does nothing at all until
   * the player's digging exposes it. A hazard that fires into sealed rock would
   * be a noise with no cause. */
  const hazards: (LaneNode & { kind: string; phase0: number })[] = [];
  const hz = theme.hazard;
  if (hz) {
    const hazMinLr = startLr + 4;
    const wantHazards = hz.count + p.hazardBonus;
    // Separation was 5 and could not be met at the new counts; an unmeetable
    // guard is the same silent shortfall placeFails exists to catch.
    for (let guard = 0; guard < 1600 && hazards.length < wantHazards; guard++) {
      const lc = Math.floor(rng() * LW);
      const lr = hazMinLr + Math.floor(rng() * (LH - hazMinLr));
      const n = { lc, lr };
      if (!solidNode(dirt, lc, lr, gw)) continue;
      if (laneDist(n, start) < 8) continue;
      if (hazards.some((o) => laneDist(o, n) < 4)) continue;
      if (pockets.some((o) => chebDist(o, n) <= 1)) continue;
      // Stagger the timers so a themeful of vents never fires in unison.
      hazards.push({ ...hz, lc, lr, phase0: rng() * (('every' in hz ? hz.every : 0) || 1) });
    }
  }

  return {
    dirt,
    playerStart: start,
    monsters,
    rocks,
    bonusAt,
    params: p,
    skyRows,
    theme: theme.id,
    ore,
    oreCells,
    pockets,
    /* Fine-cell grid parallel to `dirt`: 0 none, 1 damp, 2 wet. The renderer's
     * half of the air fix — see step 9b, and INTEGRATION.md for the contract.
     * Nothing in the simulation reads it. */
    pocketHint,
    relicSite,
    crystalAt,
    hazards,
    placeFails,
  };
}
