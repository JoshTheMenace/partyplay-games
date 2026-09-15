/* Level themes: five biomes, each with its own palette, monster mix, hazard and
 * crystal.
 *
 * PURE DATA. Imported by content.js (which needs the mix and the vein density
 * to generate a level) and by view.js (which needs the palette), so it must not
 * import either — and must not import anything that touches the DOM.
 *
 * themeOf() is a pure function of LEVEL and nothing else. Crystals unlock
 * ACCESS — a deeper starting level, a run mode chosen at the base — never the
 * level-to-theme mapping itself. That is what keeps generateLevel(level, seed)
 * reproducible and `?level=` honest: the same level number is always the same
 * biome, whatever the player has collected.
 *
 * ── the shape of a theme ────────────────────────────────────────────────
 *
 *   bands[5]     one colour per depth band, top to bottom. Deeper is DARKER and
 *                COLDER across the whole set, so descending reads as a single
 *                continuous gradient rather than five unrelated skins: topsoil's
 *                bottom band is already the violet that basalt's top band picks
 *                up. bandOf() indexes this directly.
 *   sky / cave   the band above row 0 (level 1 only) and the colour a carved
 *                cell shows. `cave` darkens with depth for the same reason.
 *   ambient      0..1, how much of the field is lit without a lamp. This is the
 *                number LANTERN is bought against — see lightRadiusFor().
 *   veins        ore generation: how many walkers, how far each walks, the base
 *                grade it writes, the chance of a richer step, and how hard the
 *                start row is pushed toward the bottom of the field.
 *   pockets      sealed air bubbles per level — the BASE count. levelParams()
 *                adds a depth bonus on top, so a biome gets denser the deeper
 *                the run has gone into it rather than being flat.
 *   relicChance  probability this level hides a relic chamber at all.
 *   crystal      the id banked by save.takeCrystal() when it is carried out.
 *   signature    the kind whose cavity the crystal is buried in.
 *   mix          weighted kinds for every monster past the guaranteed fygars.
 *   hazard       one per theme; the engine steps it, see stepHazards().
 *
 * The mix names grub, geode, mite, sapper and warden, all of which are real
 * kinds in monsters.js. Three of them are not simply "another monster" and the
 * generator has to know it — see the kind pass in generateLevel():
 *
 *   mite    arrives as a SWARM out of one corridor. A single Mite is a one-pump
 *           weakling that reads as a bad Pooka; the fight is the number of them.
 *   grub    digs, which joins cavities and rewrites the layout. One per level,
 *           and not near the surface. Two rewrite it faster than a player reads.
 *   geode   is static and only dies to a dropped rock, so it is only ever placed
 *           where a rock is already seated above it in the same column.
 *
 * A weight here is therefore a weight on an EVENT, not on a head count.
 *
 * ── density, and why every count here went up ────────────────────────────
 *
 * The field doubled — 28x56 to 20x160, 392 lane nodes to 800 — and the content
 * counts did not follow it. The symptom was reported as "most of the game is
 * just digging down, there aren't many enemies/rocks/whatever going on", which
 * is exactly what a doubled field with the old counts produces: a long empty
 * corridor with a fight at the bottom.
 *
 * Veins, pockets and hazards all roughly doubled here, and all three take a
 * further per-level bonus from levelParams(). Density is a curve, not a
 * constant: the bottom of a run should be crowded in a way the top is not.
 */

export const THEMES = Object.freeze([
  Object.freeze({
    id: 'topsoil',
    name: 'Topsoil',
    // Rich earth over clay. The band a player learns the game in.
    bands: Object.freeze(['#9c6531', '#7a4b23', '#5c3619', '#412510', '#2a1a3a']),
    sky: '#1d3a5c',
    cave: '#0d0805',
    ambient: 0.55,
    veins: Object.freeze({ count: 7, len: 12, grade: 1, rich: 0.16, depthBias: 0.35 }),
    pockets: 9,
    relicChance: 0.15,
    crystal: 'shard-of-loam',
    signature: 'fygar',
    mix: Object.freeze([
      { kind: 'pooka', weight: 5 },
      { kind: 'fygar', weight: 1 },
      { kind: 'grub', weight: 1 },
    ]),
    /* Water, not gas. The gentlest hazard in the game: it costs air and nothing
     * else, so the first thing that ever punishes you is legible and survivable. */
    hazard: Object.freeze({ kind: 'seep', count: 4, radius: 3.5, drain: 1.8 }),
  }),

  Object.freeze({
    id: 'clay',
    name: 'Red Clay',
    bands: Object.freeze(['#a05437', '#83402a', '#66301f', '#4a2216', '#301a2e']),
    sky: '#2a2036',
    cave: '#0b0604',
    ambient: 0.44,
    veins: Object.freeze({ count: 7, len: 13, grade: 1, rich: 0.22, depthBias: 0.32 }),
    pockets: 10,
    relicChance: 0.18,
    crystal: 'clot-of-ochre',
    signature: 'grub',
    mix: Object.freeze([
      { kind: 'pooka', weight: 4 },
      { kind: 'fygar', weight: 1 },
      { kind: 'grub', weight: 2 },
      { kind: 'mite', weight: 1 },
    ]),
    // Same machinery as the seep, three times as hungry: clay traps pockets of
    // foul air, and the same room you were told to breathe in now empties you.
    hazard: Object.freeze({ kind: 'gas', count: 5, radius: 3.0, drain: 3.0 }),
  }),

  Object.freeze({
    id: 'stone',
    name: 'Cracked Stone',
    bands: Object.freeze(['#7d7a74', '#63605b', '#4b4844', '#343230', '#22212a']),
    sky: '#1c2028',
    cave: '#08090c',
    ambient: 0.34,
    veins: Object.freeze({ count: 8, len: 14, grade: 1, rich: 0.42, depthBias: 0.30 }),
    pockets: 11,
    relicChance: 0.22,
    crystal: 'stone-eye',
    signature: 'warden',
    mix: Object.freeze([
      { kind: 'pooka', weight: 3 },
      { kind: 'fygar', weight: 1 },
      { kind: 'mite', weight: 2 },
      { kind: 'geode', weight: 2 },
      { kind: 'sapper', weight: 1 },
    ]),
    // Reuses the rock system whole, so its warning is the wobble the player
    // already knows and the helmet already covers it.
    hazard: Object.freeze({ kind: 'dripstone', count: 6, every: 6.0 }),
  }),

  Object.freeze({
    id: 'crystal',
    name: 'Crystal Seam',
    bands: Object.freeze(['#5f7488', '#4c5f72', '#3b4b5c', '#2a3746', '#1a2434']),
    sky: '#12202e',
    cave: '#060b12',
    ambient: 0.26,
    veins: Object.freeze({ count: 8, len: 15, grade: 2, rich: 0.20, depthBias: 0.28 }),
    pockets: 12,
    relicChance: 0.26,
    crystal: 'blue-heart',
    signature: 'geode',
    mix: Object.freeze([
      { kind: 'pooka', weight: 2 },
      { kind: 'fygar', weight: 1 },
      { kind: 'geode', weight: 3 },
      { kind: 'mite', weight: 2 },
      { kind: 'sapper', weight: 2 },
      { kind: 'warden', weight: 1 },
    ]),
    hazard: Object.freeze({ kind: 'shardfall', count: 7, every: 4.5 }),
  }),

  Object.freeze({
    id: 'basalt',
    name: 'Basalt',
    bands: Object.freeze(['#3a3340', '#2e2833', '#231e28', '#19151d', '#0f0c13']),
    sky: '#0d0812',
    cave: '#040207',
    ambient: 0.16,
    veins: Object.freeze({ count: 9, len: 16, grade: 2, rich: 0.30, depthBias: 0.25 }),
    pockets: 13,
    relicChance: 0.30,
    crystal: 'cinder-core',
    signature: 'sapper',
    mix: Object.freeze([
      { kind: 'fygar', weight: 1 },
      { kind: 'sapper', weight: 3 },
      { kind: 'warden', weight: 3 },
      { kind: 'geode', weight: 2 },
      { kind: 'mite', weight: 2 },
    ]),
    /* A wheel of fire thrown down a corridor. It telegraphs for exactly as
     * long as a Fygar does, because the player has already been taught to read
     * that beat — and the wind-up now draws the corridor it is about to take,
     * so the warning says which way to move rather than only that something is
     * coming. `every` is the interval between launch ATTEMPTS: a vent with no
     * open run of four cells holds fire and says nothing. See stepHazards(). */
    hazard: Object.freeze({ kind: 'vent', count: 6, every: 5.0, warn: 0.9 }),
  }),

  /* Flooded ground. Cold blue-green against basalt's near-black, because the
   * two deepest bands were otherwise both "dark" and stopped being places.
   *
   * ambient rises rather than falls here, breaking the downward trend on
   * purpose: the shark is a thing you need to SEE the ridge of, and a biome
   * lit like basalt would have hidden its only tell. */
  Object.freeze({
    id: 'aquifer',
    name: 'Aquifer',
    bands: Object.freeze(['#1c3f4a', '#183640', '#122a33', '#0d1f27', '#08151b']),
    sky: '#0a1a22',
    cave: '#03080b',
    ambient: 0.20,
    veins: Object.freeze({ count: 9, len: 16, grade: 2, rich: 0.32, depthBias: 0.24 }),
    pockets: 14,
    relicChance: 0.32,
    crystal: 'drowned-pearl',
    signature: 'shark',
    mix: Object.freeze([
      { kind: 'fygar', weight: 1 },
      { kind: 'shark', weight: 3 },
      { kind: 'mite', weight: 2 },
      { kind: 'sapper', weight: 1 },
      { kind: 'warden', weight: 1 },
    ]),
    // Water, again, but at twice topsoil's bite. It rhymes with the biome the
    // player learned seeps in, which is the point: the same hazard read at a
    // depth where the air budget no longer has slack in it.
    hazard: Object.freeze({ kind: 'seep', count: 5, radius: 3.5, drain: 2.2 }),
  }),

  /* Dry, root-threaded limestone. Warm browns after the aquifer's blue, so the
   * deepest two bands do not blur into each other either.
   *
   * The dripstone hazard is deliberate company for the mole: by the time a
   * player meets a monster that drops rocks on them, this biome has already
   * spent a level teaching them that the ceiling here does that on its own. */
  Object.freeze({
    id: 'karst',
    name: 'Karst',
    /* Lifted off near-black. The first ramp bottomed out at #14100b against a
     * cave of #050402 and an ambient of 0.14, and the lower half of the biome
     * went to mud on a phone: the moles standing in it were lumps of the floor
     * and the strata stopped reading as strata. The bottom two bands come up,
     * the spread between them widens, and the ambient comes up a notch — Karst
     * is dry limestone with iron in it, not the inside of a closed eye.
     *
     * It stays the darkest biome, which is what a bottom band is for; it is
     * just no longer black on black. */
    bands: Object.freeze(['#5c4c39', '#4a3d2e', '#3a3023', '#2c2419', '#211a11']),
    sky: '#1c1509',
    cave: '#0a0805',
    ambient: 0.19,
    veins: Object.freeze({ count: 10, len: 17, grade: 2, rich: 0.34, depthBias: 0.22 }),
    pockets: 15,
    relicChance: 0.34,
    crystal: 'root-of-iron',
    signature: 'mole',
    mix: Object.freeze([
      { kind: 'fygar', weight: 1 },
      { kind: 'mole', weight: 2 },
      { kind: 'warden', weight: 2 },
      { kind: 'geode', weight: 2 },
      { kind: 'sapper', weight: 2 },
    ]),
    hazard: Object.freeze({ kind: 'dripstone', count: 7, every: 5.0 }),
  }),
]);

export type Theme = (typeof THEMES)[number];

export const THEME_BY_ID = Object.freeze(
  Object.fromEntries(THEMES.map((t) => [t.id, t])));

export function themeOf(level: number) {
  const i = Math.floor((Math.max(1, level | 0) - 1) / 3);
  return THEMES[Math.min(THEMES.length - 1, i)];
}

/* Every crystal id, in theme order. The base reads this to know how many there
 * are to collect without having to walk THEMES itself. */
export const CRYSTAL_IDS = Object.freeze(THEMES.map((t) => t.crystal));

/* The helmet lamp's reach, in FINE CELLS.
 *
 * A radius and not a screen fraction: the engine must never learn the size of
 * the viewport, and light.js can turn cells into pixels itself because it
 * already has the layout. Ambient carries most of it — topsoil is nearly lit
 * and basalt is nearly black — so LANTERN buys progressively more the deeper
 * you go, which is exactly when a player would want to have bought it.
 *
 * This is the whole of what the LANTERN upgrade purchases, and until now it
 * purchased nothing at all. */
export function lightRadiusFor(theme: Theme | null | undefined, lanternTier: number) {
  const amb = theme && typeof theme.ambient === 'number' ? theme.ambient : 0.55;
  return 6 + amb * 10 + Math.max(0, lanternTier | 0) * 7;
}
