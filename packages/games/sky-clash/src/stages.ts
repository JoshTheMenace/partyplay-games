/**
 * Sky Clash stages: Melee layouts rebuilt as axis-aligned collision in meters (+X right, +Y up, 60 ticks per second).
 * Everything is authored in Melee units and converted with UNIT. Blocks are solid (top = floor, sides = walls,
 * bottom = ceiling); platforms are one-way. Motion, transformations and hazards are pure functions of stageTick,
 * so the server and the renderer read the exact same frame. Browser-safe data. STAGES.md lists sources and simplifications.
 */
import { UNIT } from './model';

export const STAGE_IDS = ['cloudbreak', 'peach-castle', 'rainbow-cruise', 'kongo-jungle', 'jungle-japes', 'great-bay', 'temple', 'brinstar', 'brinstar-depths',
  'yoshi-story', 'yoshi-island', 'fountain', 'green-greens', 'corneria', 'venom', 'stadium', 'poke-floats', 'mute-city', 'big-blue', 'onett', 'fourside',
  'icicle-mountain', 'mushroom-kingdom', 'mushroom-kingdom-ii', 'flat-zone', 'dream-land', 'yoshi-island-64', 'kongo-jungle-64', 'battlefield', 'final-destination'] as const;
export type StageId = typeof STAGE_IDS[number];
export type StageChoice = StageId | 'random';
/**
 * Solid box. Moving blocks carry `dx`/`dy`: their top's movement since the previous tick, so riders are carried.
 * A block can also rise out of the floor (Pokémon Stadium): the engine should lift a fighter whose feet it overlaps onto its top.
 * `art` hints the renderer (e.g. 'car', 'turtle', 'pipe').
 */
export type Block = { id: string; left: number; right: number; top: number; bottom: number; ledges: boolean; moving?: boolean; dx?: number; dy?: number; art?: string };
/** One-way platform at its current position, with its movement since the previous tick. Ids may vanish and return (Randall, Arwings). */
export type Platform = { id: string; left: number; right: number; y: number; dx: number; dy: number; art?: string };
/** Grabbable corner. side -1 = the block's left edge (the fighter hangs facing +X). */
export type Ledge = { id: string; block: string; x: number; y: number; side: -1 | 1 };
export type Zone = { left: number; right: number; bottom: number; top: number };
/**
 * Hazard state this tick. While `active`, fighters inside `zones` take `damage` with Melee-formula knockback at world
 * `angle` (degrees, 0 = +X, 90 = up) from `kbBase`/`kbGrowth`, and `push` (m/frame, +X) moves them like wind.
 * `warning` leads each activation and `zones` then show where it will strike. A fighter is hit once per `cycle`,
 * or every `rehit` frames while inside when set (acid, falling tools).
 */
export type HazardFrame = { kind: string; label: string; warning: boolean; active: boolean; zones: Zone[]; push: number; damage: number; angle: number; kbBase: number; kbGrowth: number; cycle: number; rehit?: number };
export type Palette = { skyTop: string; skyBottom: string; fog: string; ground: string; trim: string; accent: string; light: string };
export type StageDef = {
  id: StageId; name: string; blurb: string; family: string; palette: Palette;
  /** Leaving this box loses a stock. */
  blast: Zone;
  /** The camera never frames beyond this box. */
  camera: Zone;
  /** Four starting points (feet on a floor at tick 0) and four respawn halo points. */
  spawns: readonly [number, number][]; respawns: readonly [number, number][];
  /** Melee stage it reproduces ('Original' for Cloudbreak) and its hazard's display label. */
  source: string; hazardLabel?: string;
};

// ── Authoring kit (Melee units) ───────────────────────────────────────────
type Offset = (t: number) => readonly [number, number];
type Piece = { id: string; l: number; r: number; path?: Offset; on?: (t: number) => boolean; art?: string };
/** ledges: true (both top corners), false, or -1/1 for one side only. Covered corners never become ledges. */
type BlockSpec = Piece & { top: number; bottom: number; ledges?: boolean | -1 | 1; grow?: (t: number) => number };
type PlatSpec = Piece & { y: number };
type U4 = readonly [number, number, number, number];
type HazardSpec = {
  kind: string; label: string; period: number; start?: number; warn: number; active: number;
  damage: number; angle: number; kbBase: number; kbGrowth: number; push?: number; rehit?: number;
  /** Zones [left, right, bottom, top] for this occurrence; `p` runs 0→1 through the active window (0 while warning). */
  zones: (cycle: number, p: number) => readonly U4[]; flip?: (cycle: number) => boolean; labels?: readonly string[];
};
type Spec = {
  name: string; source?: string; blurb: string; family: string; palette: string;
  blast: U4; camera?: U4; blocks: BlockSpec[]; platforms?: PlatSpec[];
  spawns?: readonly (readonly [number, number])[]; respawns?: readonly (readonly [number, number])[]; hazard?: HazardSpec;
};
const TAU = Math.PI * 2;
const mod = (a: number, n: number) => ((a % n) + n) % n;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (x: number) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const hash = (a: number, b: number) => (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)) >>> 0;
/** Cycle index and ticks since that cycle began; the same clock drives a hazard and the terrain it moves. */
const clock = (t: number, period: number, start = 0) => { const c = Math.floor((t - start) / period); return [c, t - start - c * period] as const; };
const blk = (id: string, l: number, r: number, top: number, bottom: number, o: Partial<BlockSpec> = {}): BlockSpec => ({ id, l, r, top, bottom, ...o });
const plat = (id: string, l: number, r: number, y: number, o: Partial<PlatSpec> = {}): PlatSpec => ({ id, l, r, y, ...o });
/** Under-stage taper: [halfWidth, bottom] steps narrowing below a floor, so recoveries meet sloped walls and ceilings. */
const taper = (id: string, cx: number, top: number, steps: readonly (readonly [number, number])[], o: Partial<BlockSpec> = {}) =>
  steps.map(([h, bottom], i) => blk(i ? `${id}-${i}` : id, cx - h, cx + h, i ? steps[i - 1][1] : top, bottom, o));
const sine = (ax: number, ay: number, period: number, phase = 0): Offset => t => { const s = Math.sin((t / period + phase) * TAU); return [ax * s, ay * s]; };
const add = (...fs: Offset[]): Offset => t => fs.reduce<readonly [number, number]>(([x, y], f) => { const [a, b] = f(t); return [x + a, y + b]; }, [0, 0]);
/** Treadmill: pieces scroll by travel(t) along x (axis 0) or y (axis 1) and wrap inside [lo, lo + length), always outside the blast zone. */
function scroll<T extends BlockSpec | PlatSpec>(axis: 0 | 1, lo: number, length: number, travel: (t: number) => number, pieces: T[]): T[] {
  return pieces.map(p => {
    const c = axis ? ('y' in p ? p.y : (p.top + p.bottom) / 2) : (p.l + p.r) / 2, own = p.path;
    const move: Offset = t => { const w = lo + mod(c - travel(t) - lo, length) - c; return axis ? [0, w] : [w, 0]; };
    return { ...p, path: own ? add(move, own) : move };
  });
}
/** Recurring horizontal sweep (cars, Bullet Bill, eggs): alternates direction each cycle when `alternate`. */
const sweep = (from: number, half: number, bottom: number, top: number, alternate = true) => (c: number, p: number): U4[] => {
  const x = (alternate && c % 2 ? -1 : 1) * lerp(from, -from, p); return [[x - half, x + half, bottom, top]];
};
const pal = (s: string): Palette => { const [skyTop, skyBottom, fog, ground, trim, accent, light] = s.split(' '); return { skyTop, skyBottom, fog, ground, trim, accent, light }; };

// ── Stage behaviors ───────────────────────────────────────────────────────
/** Pokémon Stadium: 50 s neutral, a 5 s screen warning, then Fire → Grass → Rock → Water terrain for about 50 s each. */
const STADIUM = ['Fire', 'Grass', 'Rock', 'Water'] as const;
function stadium(t: number) {
  const [c, p] = clock(t, 6600, 3000);
  return { kind: c >= 0 ? STADIUM[c % 4] : null, grow: p < 300 ? 0 : p < 390 ? ease((p - 300) / 90) : p < 3420 ? 1 : p < 3510 ? 1 - ease((p - 3420) / 90) : 0, full: p >= 390 && p < 3420 };
}
const neutral = (t: number) => stadium(t).grow === 0;
const terrain = (kind: typeof STADIUM[number], blocks: U4[], platforms: [number, number, number][]) => ({
  blocks: blocks.map(([l, r, top, bottom], i) => blk(`${kind.toLowerCase()}-${i}`, l, r, top, bottom, { ledges: false, art: kind.toLowerCase(), grow: t => { const s = stadium(t); return s.kind === kind ? s.grow : 0; } })),
  platforms: platforms.map(([l, r, y], i) => plat(`${kind.toLowerCase()}-p${i}`, l, r, y, { art: kind.toLowerCase(), on: t => { const s = stadium(t); return s.kind === kind && s.full; } })),
});
const STADIUM_TERRAIN = [
  terrain('Fire', [[-82, -62, 32, 0], [-62, -44, 16, 0], [58, 66, 30, 0]], [[44, 80, 38]]),
  terrain('Grass', [[40, 82, 12, 0], [58, 82, 22, 12]], [[-78, -38, 30], [-66, -46, 55]]),
  terrain('Rock', [[-56, -16, 42, 0], [-16, 4, 20, 0], [48, 70, 14, 0]], []),
  terrain('Water', [[-80, -60, 45, 0], [40, 82, 10, 0]], [[-92, -48, 58]]),
];
/** Fountain of Dreams side platforms hold a height for 12–15 s, then glide to a new one (deterministic sequence). */
const FOUNTAIN_LEVELS = [5, 11, 16.125, 22, 28];
const fountain = (i: number): Offset => t => {
  const len = 720 + i * 180, s = Math.floor(t / len), level = (n: number) => n <= 0 ? 16.125 : FOUNTAIN_LEVELS[hash(n, i) % 5];
  return [0, lerp(level(s - 1), level(s), ease((t - s * len) / 150)) - 16.125];
};
/** Randall rises beside the left edge, passes behind the stage, sinks beside the right edge and passes back (21 s loop). */
const randall = (t: number): readonly [number, number] | null => {
  const f = mod(t, 1260) / 1260;
  return f < .35 ? [-68, -45 + 37 * f / .35] : f < .5 ? null : f < .85 ? [68, -8 - 37 * (f - .5) / .35] : null;
};
/** Great Bay's turtle: surfaced 20 s, dives, stays under 14 s, resurfaces (40 s loop). null = submerged. */
const turtle = (t: number) => { const [, p] = clock(t, 2400); return p < 1200 || p >= 2280 ? 0 : p < 1320 ? -40 * ease((p - 1200) / 120) : p < 2160 ? null : -40 * (1 - ease((p - 2160) / 120)); };
/** Brinstar Depths: every 40 s Kraid turns the stage and the side and top platforms glide to their mirrored positions. */
const kraid = (t: number) => { const [c, p] = clock(t, 2400, 2400); if (c < 0) return 0; const from = c % 2; return lerp(from, 1 - from, ease(p / 150)); };
/** Arwing fly-by: 0→1 across its 5 s pass, null otherwise. */
const arwing = (t: number) => { const [c, p] = clock(t, 1500, 1500); return c >= 0 && p < 300 ? p / 300 : null; };
/** Corneria: a low Arwing strafes the deck from the right and peels away before the fin; a high one clears the fin. */
const CORNERIA = [{ y: 26, from: 330, to: -30 }, { y: 72, from: 370, to: -330 }] as const;
const cornX = (i: number, p: number) => lerp(CORNERIA[i].from, CORNERIA[i].to, p);
/** Mute City: the pad travels 18 s, then the track slides in beneath it for 17 s of racing, then races away. null = no track. */
const track = (t: number) => { const [, p] = clock(t, 2700); return p < 1080 ? null : p < 1320 ? 700 * (1 - ease((p - 1080) / 240)) : p < 2340 ? 0 : p < 2580 ? -700 * ease((p - 2340) / 240) : null; };
/** Rainbow Cruise: 25 s aboard the ship, then 65 s of rainbow course scrolling past before the ship comes back around. */
const cruise = (t: number) => { const [c, p] = clock(t, 5400); return 1560 * (c + ease((p - 1500) / 3900)); };
/** Icicle Mountain climbs 60 units over 4 s, then rests 6 s. */
const climb = (t: number) => { const [c, p] = clock(t, 600); return 60 * (c + ease((p - 360) / 240)); };
/** Poké Floats drift past at a gently pulsing speed (average 0.18 units per tick). */
const floats = (t: number) => .18 * (t - 1200 / TAU * Math.sin(t / 1200 * TAU));
const flatScene = (t: number) => Math.floor(mod(t, 4500) / 1500); // 0 Fire, 1 Oil Panic, 2 Helmet

// ── Stages ────────────────────────────────────────────────────────────────
const SPECS: Record<StageId, Spec> = {
  battlefield: {
    name: 'Battlefield', blurb: 'The tournament standard: a floating island with three soft platforms and a jagged underside that catches low recoveries.',
    family: 'space', palette: '#120c33 #3b2d7a #2a2360 #8f93b8 #d4c9ff #7ef0ff #e8e1ff',
    blast: [-224, 224, -108.8, 200], camera: [-160, 160, -70, 150],
    blocks: taper('main', 0, 0, [[68.4, -4], [64, -10], [56, -18], [46, -28], [34, -38], [20, -48]]),
    platforms: [plat('left', -57.6, -20, 27.2), plat('right', 20, 57.6, 27.2), plat('top', -18.8, 18.8, 54.4)],
  },
  'final-destination': {
    name: 'Final Destination', blurb: 'One flat stage drifting through space. No platforms, no hazards, and deep walls under both ledges.',
    family: 'space', palette: '#05031a #28105a #1c0f45 #6c5aa8 #c7a8ff #ff7ae6 #d8ccff',
    blast: [-246, 246, -140, 188], camera: [-180, 180, -90, 140],
    blocks: taper('main', 0, 0, [[85.57, -6], [83, -20], [74, -34], [60, -50], [42, -66], [20, -82]]),
  },
  cloudbreak: {
    name: 'Cloudbreak', source: 'Original', blurb: 'A sunset sky citadel: a Battlefield-sized island, two wide platforms and a crown platform that sways with the wind.',
    family: 'sky', palette: '#2a1a63 #ff9f6e #d890b0 #f4e6cc #ffb347 #6b3d8f #ffe2bf',
    blast: [-220, 220, -110, 196], camera: [-158, 158, -72, 148],
    blocks: taper('main', 0, 0, [[64, -5], [60, -12], [52, -22], [40, -34], [24, -46]]),
    platforms: [plat('left', -54, -18, 25), plat('right', 18, 54, 25), plat('top', -17, 17, 50, { path: sine(10, 0, 900), art: 'crown' })],
  },
  'yoshi-story': {
    name: "Yoshi's Story", blurb: 'A cardboard storybook stage with three platforms. Randall the cloud circles the edges and can save a recovery.',
    family: 'storybook', palette: '#8fd0e8 #fff2c8 #c8e8d8 #b2d88c #f48faf #ffd85a #fffaf0',
    blast: [-175.7, 173.6, -91, 168], camera: [-130, 130, -65, 128],
    blocks: taper('main', 0, 0, [[56, -6], [52, -14], [47, -22], [41, -32]]),
    platforms: [plat('left', -59.5, -28, 23.45), plat('right', 28, 59.5, 23.45), plat('top', -15.75, 15.75, 42),
      plat('randall', -9, 9, 0, { art: 'cloud', path: t => randall(t) ?? [0, -45], on: t => randall(t) !== null })],
  },
  fountain: {
    name: 'Fountain of Dreams', blurb: 'A moonlit fountain whose two side platforms rise and sink on their own, under a fixed top platform.',
    family: 'dream', palette: '#0e0b2e #3a2f78 #282353 #c4c5ed #e8d8ff #d7a3ff #f0e8ff',
    blast: [-198.75, 198.75, -146.25, 202.5], camera: [-150, 150, -100, 155],
    blocks: [...taper('main', 0, 0, [[63.35, -4], [60, -9], [53, -14], [44, -19], [32, -26]]), blk('pillar', -18, 18, -26, -90, { ledges: false })],
    platforms: [plat('left', -49.5, -20, 16.125, { path: fountain(0) }), plat('right', 20, 49.5, 16.125, { path: fountain(1) }), plat('top', -14.25, 14.25, 42.75)],
  },
  stadium: {
    name: 'Pokémon Stadium', blurb: 'A wide arena with two platforms. The big screen warns before it transforms into Fire, Grass, Rock and Water terrain.',
    family: 'city', palette: '#4a8ad8 #d8ecff #9cc0e0 #c9dfd7 #e84a4a #87ed9c #ffffff',
    blast: [-230, 230, -111, 180], camera: [-170, 170, -80, 140],
    blocks: [...taper('main', 0, 0, [[87.75, -8], [84, -20], [76, -32], [64, -44]]), ...STADIUM_TERRAIN.flatMap(k => k.blocks)],
    platforms: [plat('left', -55, -25, 25, { on: neutral }), plat('right', 25, 55, 25, { on: neutral }), ...STADIUM_TERRAIN.flatMap(k => k.platforms)],
    hazard: { kind: 'transform', label: 'Transformation', labels: STADIUM, period: 6600, start: 3390, warn: 390, active: 3030, damage: 0, angle: 0, kbBase: 0, kbGrowth: 0, zones: () => [] },
  },
  'dream-land': {
    name: 'Dream Land', blurb: 'The classic three-platform stage. Whispy Woods takes a breath, then blows everyone sideways.',
    family: 'dream', palette: '#73b5bf #e8f8e0 #a8d8c8 #c5d995 #7a5a3a #a6dd88 #fffbe8',
    blast: [-255, 255, -123, 250], camera: [-190, 190, -85, 190],
    blocks: taper('main', 0, 0, [[77.27, -6], [72, -16], [62, -28], [46, -40], [26, -52]]),
    platforms: [plat('left', -61.39, -31.73, 30.14), plat('right', 31.73, 61.39, 30.14), plat('top', -19.02, 19.02, 51.43)],
    hazard: { kind: 'wind', label: 'Whispy Woods', period: 1800, warn: 150, active: 360, damage: 0, angle: 0, kbBase: 0, kbGrowth: 0, push: .35, flip: c => c % 2 === 1, zones: () => [[-160, 160, -60, 140]] },
  },
  'peach-castle': {
    name: "Princess Peach's Castle", blurb: 'Fight on the castle roof around the central tower. Switch platforms bob at both ends and Bullet Bills fly across.',
    family: 'castle', palette: '#6fa8e8 #cfe8ff #b9d4f0 #d9c7a3 #e05a5a #ffd24a #fff6e0',
    blast: [-300, 300, -170, 250],
    blocks: [...taper('roof', 0, 0, [[125, -20], [110, -45]]), blk('tower', -32, 32, 34, 0, { ledges: false, art: 'tower' })],
    platforms: [plat('tower-top', -22, 22, 62), plat('west', -105, -62, 40), plat('east', 62, 105, 40),
      plat('switch-l', -170, -135, -8, { path: sine(0, 10, 720), art: 'switch' }), plat('switch-r', 135, 170, -8, { path: sine(0, 10, 720, .5), art: 'switch' })],
    spawns: [[-82, 0], [82, 0], [-50, 0], [50, 0]],
    hazard: { kind: 'bullet-bill', label: 'Bullet Bill', period: 2400, warn: 150, active: 150, damage: 18, angle: 45, kbBase: 60, kbGrowth: 90, flip: c => c % 2 === 1, zones: sweep(-320, 18, 14, 30) },
  },
  'rainbow-cruise': {
    name: 'Rainbow Cruise', blurb: 'Ride the sky ship, then keep moving across the scrolling rainbow course until the ship sails back around.',
    family: 'sky', palette: '#7c69ad #f8c6ff #d6b8f0 #e8d2a6 #ff6b9d #7ee8ff #fff0fa',
    blast: [-240, 240, -140, 210],
    blocks: scroll(0, -380, 1560, cruise, [blk('deck', -110, 90, 0, -16, { art: 'ship', path: sine(0, 3, 480) }), blk('cabin', -40, 0, 28, 0, { ledges: false, art: 'ship', path: sine(0, 3, 480) }),
      blk('rb1', 340, 440, 22, 8, { art: 'rainbow-block' }), blk('rb2', 700, 820, 4, -10, { art: 'rainbow-block' }), blk('rb3', 1060, 1160, 16, 2, { art: 'rainbow-block' })]),
    platforms: scroll(0, -380, 1560, cruise, [plat('sail-l', -95, -60, 42, { path: sine(0, 3, 480) }), plat('sail-r', 20, 70, 50, { path: sine(0, 3, 480) }),
      ...([[140, 200, 12], [240, 300, 30], [480, 540, 44], [580, 660, 26], [860, 920, 24], [960, 1020, 42], [1200, 1260, 30], [1300, 1370, 12]] as const)
        .map(([l, r, y], i) => plat(`rainbow-${i}`, l, r, y, { art: 'rainbow', path: sine(0, 5, 360 + i * 40, i / 8) }))]),
    spawns: [[-90, 0], [60, 0], [-60, 0], [30, 0]], respawns: [[-78, 80], [45, 90], [-20, 90], [10, 90]],
  },
  'kongo-jungle': {
    name: 'Kongo Jungle', blurb: 'A wooden deck above the falls with a turning top platform. The barrel below can catch a failed recovery; Klap Trap bites from the water.',
    family: 'jungle', palette: '#123c3a #d88f4a #3f6b4f #8a5a33 #c9a15a #ffcf4a #ffe0a8',
    blast: [-240, 240, -150, 220],
    blocks: taper('main', 0, 0, [[82, -8], [70, -20], [52, -32], [30, -44]]),
    platforms: [plat('left', -72, -40, 25), plat('right', 40, 72, 25), plat('top', -18, 18, 54, { path: t => [6 * Math.cos(t / 480 * TAU), 6 * Math.sin(t / 480 * TAU)] }),
      plat('barrel', -9, 9, -70, { path: sine(100, 0, 1200), art: 'barrel' })],
    hazard: { kind: 'klap-trap', label: 'Klap Trap', period: 1500, warn: 90, active: 45, damage: 12, angle: 80, kbBase: 50, kbGrowth: 90, zones: c => [c % 2 ? [-120, -40, -150, -82] : [40, 120, -150, -82]] },
  },
  'jungle-japes': {
    name: 'Jungle Japes', blurb: "Two riverbanks and Cranky's hut over a rushing river. Klaptraps leap from the water between them.",
    family: 'jungle', palette: '#1a3a2c #6fae6a #3d6e4f #7a5634 #b98a52 #5ad0e8 #e8ffd8',
    blast: [-235, 235, -130, 200],
    blocks: [blk('west', -118, -62, 0, -24), blk('east', 62, 118, 0, -24)],
    platforms: [plat('center', -40, 40, 10, { art: 'hut' }), plat('roof', -24, 24, 46, { art: 'hut' }), plat('west-high', -108, -76, 38), plat('east-high', 76, 108, 38)],
    spawns: [[-90, 0], [90, 0], [-20, 10], [20, 10]],
    hazard: { kind: 'klaptrap', label: 'Klaptrap', period: 1200, warn: 90, active: 50, damage: 15, angle: 85, kbBase: 60, kbGrowth: 80, zones: c => { const x = [-25, 20, 0, -10][mod(c, 4)]; return [[x - 22, x + 22, -90, 2]]; } },
  },
  'great-bay': {
    name: 'Great Bay', blurb: "The lab's pier and lookout. The giant turtle surfaces to the right, and Tingle drifts overhead.",
    family: 'water', palette: '#2a6f9a #9fe0e8 #7ab8c8 #c9b48a #8a5a3b #63e2c0 #fff4d6',
    blast: [-270, 270, -140, 230],
    blocks: [...taper('pier', -47.5, 0, [[72.5, -22], [62, -40]]), blk('turtle', 60, 120, -2, -14, { art: 'turtle', path: t => [0, turtle(t) ?? 0], on: t => turtle(t) !== null })],
    platforms: [plat('lab-roof', -110, -70, 48, { art: 'lab' }), plat('lookout', -50, -15, 28), plat('tingle', -25, 15, 78, { art: 'balloon', path: sine(8, 6, 780) })],
    hazard: { kind: 'turtle', label: 'Turtle surfacing', period: 2400, start: 2160, warn: 180, active: 120, damage: 6, angle: 85, kbBase: 40, kbGrowth: 40, zones: () => [[58, 122, -60, 6]] },
  },
  temple: {
    name: 'Temple', blurb: "Hyrule's sprawling temple: a high west courtyard, the bridge, the lower east court and the cave running beneath.",
    family: 'castle', palette: '#4a4e8a #c9c0e0 #8a88b8 #c8ba99 #8f7f5f #efd07d #fff4dc',
    blast: [-420, 420, -230, 300],
    blocks: [blk('west', -230, -95, 30, -40, { ledges: -1 }), blk('bridge', -95, 95, 0, -18, { ledges: false }), blk('east', 95, 250, -20, -60), blk('cave', -95, 95, -80, -110)],
    platforms: [plat('west-high', -210, -130, 70), plat('peak', -40, 40, 55), plat('east-high', 130, 220, 25), plat('pillar-l', -80, -52, 28), plat('pillar-r', 52, 80, 28)],
    spawns: [[-165, 30], [165, -20], [-30, 0], [30, 0]], respawns: [[-160, 100], [160, 60], [-30, 100], [30, 100]],
  },
  brinstar: {
    name: 'Brinstar', blurb: "Zebes' living rock with a raised center. Acid bubbles up to different heights; watch the warning and get high.",
    family: 'alien', palette: '#1a0a1e #5a2046 #3a1030 #736088 #b85a8a #ff8455 #ffc9a8',
    blast: [-220, 220, -120, 200],
    blocks: [...taper('main', 0, 0, [[80, -8], [72, -20], [58, -32], [40, -44]]), blk('hump', -26, 26, 14, 0, { ledges: false })],
    platforms: [plat('left', -72, -40, 32, { art: 'flesh' }), plat('right', 40, 72, 32, { art: 'flesh' }), plat('top', -22, 22, 50, { art: 'flesh' })],
    spawns: [[-60, 0], [60, 0], [-38, 0], [38, 0]],
    hazard: { kind: 'acid', label: 'Acid rising', period: 1800, warn: 180, active: 600, damage: 16, angle: 90, kbBase: 70, kbGrowth: 70, rehit: 45,
      zones: (c, p) => [[-220, 220, -130, lerp(-60, [14, -6, 30][mod(c, 3)], Math.sin(p * Math.PI))]] },
  },
  'brinstar-depths': {
    name: 'Brinstar Depths', blurb: "A rock island in Kraid's lair. When Kraid rises he turns the stage and every platform swings to a new spot.",
    family: 'alien', palette: '#0a1016 #283a46 #1e2733 #596b56 #8aa06a #b2e357 #d8f0c0',
    blast: [-240, 240, -150, 220],
    blocks: taper('main', 0, 0, [[55, -10], [48, -30], [35, -50]]),
    platforms: [plat('left', -100, -62, -18, { path: t => [0, 40 * kraid(t)] }), plat('right', 62, 100, 22, { path: t => [0, -40 * kraid(t)] }), plat('top', -40, 0, 40, { path: t => [40 * kraid(t), 0] })],
    respawns: [[-30, 70], [30, 70], [-10, 80], [10, 80]],
    hazard: { kind: 'kraid', label: 'Kraid', period: 2400, warn: 180, active: 150, damage: 12, angle: 90, kbBase: 60, kbGrowth: 70, zones: () => [[-70, 70, -150, -60]] },
  },
  'yoshi-island': {
    name: "Yoshi's Island", blurb: 'Two grassy banks around a bridge of spinning blocks that flip away every so often, with a cloud drifting above.',
    family: 'storybook', palette: '#6ba7d0 #d8f0ff #a8d0e8 #b8cf78 #8a5a3b #ffc571 #fff8e0',
    blast: [-230, 230, -130, 200],
    blocks: [blk('west', -105, -34, 0, -30), blk('east', 34, 105, 12, -30)],
    platforms: [plat('blocks', -34, 34, 2, { art: 'spin-block', on: t => mod(t, 1200) < 960 }), plat('cloud', -22, 22, 48, { art: 'cloud', path: sine(45, 0, 900) })],
    spawns: [[-75, 0], [75, 12], [-48, 0], [50, 12]],
  },
  'green-greens': {
    name: 'Green Greens', blurb: "Whispy Woods' orchard with star-block stacks at each side. Bomb blocks drop from the sky after a warning.",
    family: 'dream', palette: '#5aa0d8 #d8f0c0 #9fc8a8 #c9dc90 #8a6a3a #ff6b6b #fff8d8',
    blast: [-240, 240, -120, 210],
    blocks: [...taper('main', 0, 0, [[100, -10], [88, -26], [70, -40]]), blk('stack-l', -84, -64, 18, 0, { ledges: false, art: 'star-block' }), blk('stack-r', 64, 84, 18, 0, { ledges: false, art: 'star-block' })],
    platforms: [plat('left', -80, -46, 40), plat('right', 46, 80, 40), plat('top', -24, 24, 56)],
    hazard: { kind: 'bomb', label: 'Bomb blocks', period: 900, warn: 90, active: 60, damage: 14, angle: 80, kbBase: 50, kbGrowth: 80,
      zones: (c, p) => { const x = [-40, 25, -10, 55, -60, 5][mod(c, 6)], y = 160 - 160 * p; return [[x - 10, x + 10, y, y + 20]]; } },
  },
  corneria: {
    name: 'Corneria', blurb: "Fight on the Great Fox over Corneria City: the long hull, the tail fin and the lower nose. Arwings strafe the deck.",
    family: 'space', palette: '#4a78b8 #c8dcef #8aa8c8 #b8c8d6 #5a6a7a #ff7a3a #ffffff',
    blast: [-260, 280, -150, 230],
    blocks: [blk('hull', -150, 45, 0, -30, { ledges: -1, art: 'ship' }), blk('nose', 45, 160, -22, -34, { art: 'ship' }), blk('fin', -70, -50, 62, 0, { ledges: false, art: 'fin' })],
    platforms: CORNERIA.map(({ y }, i) => plat(`arwing-${i}`, -14, 14, y, { art: 'arwing', path: t => [cornX(i, arwing(t) ?? 0), 0], on: t => arwing(t) !== null })),
    spawns: [[-120, 0], [20, 0], [-95, 0], [-20, 0]],
    hazard: { kind: 'laser', label: 'Arwing lasers', period: 1500, warn: 120, active: 300, damage: 4, angle: 170, kbBase: 30, kbGrowth: 30,
      zones: (_, p) => CORNERIA.map(({ y }, i) => { const x = cornX(i, p); return [x - 150, x - 22, y - 8, y - 2] as const; }) },
  },
  venom: {
    name: 'Venom', blurb: 'The Great Fox in the storms of Venom: the long deck, the bridge above and the two wings underneath. Arwings sweep both levels.',
    family: 'space', palette: '#1a0e1e #6a3048 #3a2030 #9babb3 #5a5a6a #ff897b #ffd0c8',
    blast: [-260, 260, -150, 230],
    blocks: taper('deck', 0, 0, [[140, -16], [110, -26], [80, -35]], { art: 'ship' }),
    platforms: [plat('bridge', -30, 30, 35), plat('wing-l', -120, -60, -55, { art: 'wing' }), plat('wing-r', 60, 120, -55, { art: 'wing' }),
      ...[50, -80].map((y, i) => plat(`arwing-${i}`, -14, 14, y, { art: 'arwing', path: t => [-330 + 660 * (arwing(t) ?? 0) - i * 40, 0], on: t => arwing(t) !== null }))],
    hazard: { kind: 'laser', label: 'Arwing lasers', period: 1500, warn: 120, active: 300, damage: 4, angle: 10, kbBase: 30, kbGrowth: 30,
      zones: (_, p) => [50, -80].map((y, i) => { const x = -330 + 660 * p - i * 40; return [x + 22, x + 150, y - 8, y - 2] as const; }) },
  },
  'poke-floats': {
    name: 'Poké Floats', blurb: 'A parade of giant Pokémon balloons: Squirtle, Onix, Poliwag, Porygon and Snorlax drift by. Keep hopping to the next float.',
    family: 'sky', palette: '#4a6aa8 #ffd8ec #c8b8e0 #efd4ed #7a6aa8 #ffaace #fff6ff',
    blast: [-260, 260, -160, 220],
    blocks: scroll(0, -390, 1000, floats, [
      blk('squirtle', -75, 75, 0, -28, { art: 'squirtle', path: sine(0, 6, 420) }),
      ...([[150, 210, 18, 0, -1], [210, 270, 4, -14, false], [270, 330, -10, -28, 1]] as const).map(([l, r, top, bottom, ledges], i) => blk(`onix-${i}`, l, r, top, bottom, { ledges, art: 'onix', path: sine(0, 6, 480, .3) })),
      blk('poliwag', 390, 510, 12, -20, { art: 'poliwag', path: sine(0, 8, 540, .6) }),
      blk('porygon-0', 570, 630, 26, 6, { ledges: -1, art: 'porygon', path: sine(0, 5, 400, .1) }), blk('porygon-1', 630, 690, 10, -12, { ledges: 1, art: 'porygon', path: sine(0, 5, 400, .1) }),
      blk('snorlax', 750, 900, 6, -30, { art: 'snorlax', path: sine(0, 4, 600, .8) })]),
    platforms: scroll(0, -390, 1000, floats, [plat('squirtle-head', -25, 25, 32, { path: sine(0, 6, 420) }), plat('poliwag-tail', 420, 480, 44, { path: sine(0, 8, 540, .6) }),
      plat('snorlax-belly', 790, 860, 40, { path: sine(0, 4, 600, .8) })]),
  },
  'mute-city': {
    name: 'Mute City', blurb: 'A hover pad flying above the F-Zero track. When it stops, the track slides in below and racers tear through.',
    family: 'city', palette: '#20243b #ff7ab0 #3a2f5a #7783a6 #c0c8e0 #ed86ff #ffe0ff',
    blast: [-240, 240, -150, 210],
    blocks: [...taper('pad', 0, 0, [[72, -10], [52, -18]], { art: 'pad' }),
      blk('track', -320, 320, -48, -62, { ledges: false, art: 'track', path: t => [track(t) ?? 0, 0], on: t => track(t) !== null })],
    platforms: [plat('wing-l', -60, -28, 28), plat('wing-r', 28, 60, 28)],
    hazard: { kind: 'racers', label: 'Racers incoming', period: 2700, start: 1800, warn: 150, active: 100, damage: 20, angle: 145, kbBase: 70, kbGrowth: 90,
      zones: (_, p) => { const x = lerp(340, -340, p); return [[x - 25, x + 25, -48, -26], [x + 175, x + 225, -48, -26]]; } },
  },
  'big-blue': {
    name: 'Big Blue', blurb: 'Stand on hovering racers over a track blasting past at full speed. Touch the road and it drags you away.',
    family: 'water', palette: '#3d81a8 #d8f4ff #8ac0d8 #b3cadc #3a4a6a #64ddfa #ffffff',
    blast: [-250, 250, -160, 210],
    blocks: [...taper('flyer', 0, 0, [[65, -12], [45, -20]], { art: 'car', path: sine(0, 3, 300) }),
      blk('car-l', -170, -110, -8, -18, { art: 'car', path: add(sine(22, 0, 540), sine(0, 5, 380)) }), blk('car-r', 105, 165, 10, 0, { art: 'car', path: add(sine(-22, 0, 600), sine(0, 5, 440, .3)) })],
    platforms: [plat('flyer-top', -28, 28, 30, { path: sine(0, 3, 300) })],
    hazard: { kind: 'track', label: 'The track', period: 600, start: 0, warn: 0, active: 600, damage: 0, angle: 180, kbBase: 0, kbGrowth: 0, push: -1.4, zones: () => [[-260, 260, -125, -95]] },
  },
  onett: {
    name: 'Onett', blurb: "Eagleland's main street between the drugstore and a house. Cars race through after the warning sign flashes.",
    family: 'city', palette: '#748bb7 #ffe0b8 #c8b8b0 #d7a78c #6a5a4a #ffd178 #fff4e0',
    blast: [-260, 260, -120, 230],
    blocks: [...taper('street', 0, 0, [[175, -24], [160, -40]]), blk('drugstore', -150, -70, 62, 0, { ledges: false, art: 'building' }), blk('house', 72, 150, 46, 0, { ledges: false, art: 'house' })],
    platforms: [plat('awning-1', -70, -44, 24, { art: 'awning' }), plat('awning-2', -70, -48, 44, { art: 'awning' }), plat('house-roof', 88, 134, 64, { art: 'roof' })],
    spawns: [[-55, 0], [55, 0], [-22, 0], [22, 0]],
    hazard: { kind: 'car', label: 'Car approaching', period: 1500, warn: 150, active: 100, damage: 16, angle: 40, kbBase: 70, kbGrowth: 80, flip: c => c % 2 === 1, zones: sweep(-270, 22, 0, 22) },
  },
  fourside: {
    name: 'Fourside', blurb: 'Skyscraper rooftops at night: a central tower between a low and a tall building, a crane, and a UFO that drops by.',
    family: 'city', palette: '#060a1e #2a2a5a #141c3c #8990b6 #4a4a6a #a4a2ff #ffe890',
    blast: [-270, 270, -150, 240],
    blocks: [blk('tower', -60, 60, 0, -200, { art: 'building' }), blk('west', -190, -95, -30, -200, { art: 'building' }), blk('east', 100, 200, 28, -200, { art: 'building' })],
    platforms: [plat('crane', -175, -120, 40, { art: 'crane', path: sine(20, 0, 900) }), plat('ufo', -22, 22, 95, { art: 'ufo', path: sine(90, 8, 1500), on: t => mod(t, 2400) >= 1200 })],
    spawns: [[-140, -30], [140, 28], [-25, 0], [25, 0]],
  },
  'icicle-mountain': {
    name: 'Icicle Mountain', blurb: 'An endless climb up the ice. The mountain scrolls upward in bursts, so keep moving to higher ledges.',
    family: 'ice', palette: '#53778e #e0f6ff #a9d0e0 #c3edfa #6a8aa0 #a9eeff #ffffff',
    blast: [-170, 170, -110, 190],
    blocks: scroll(1, -175, 540, climb, [blk('base', -80, 80, 0, -22, { art: 'ice' }),
      ...([[-45, 25, 72], [-20, 60, 140], [-62, 8, 240], [-28, 52, 336], [-55, 15, 436]] as const).map(([l, r, y], i) => blk(`ice-${i}`, l, r, y, y - 12, { art: 'ice' }))]),
    platforms: scroll(1, -175, 540, climb, ([[-75, -35, 34], [30, 72, 40], [-85, -45, 104], [40, 85, 110], [-78, -36, 174], [18, 66, 206], [30, 80, 272],
      [-82, -40, 304], [-72, -30, 370], [20, 70, 402], [35, 82, 470], [-60, 0, 504]] as const).map(([l, r, y], i) => plat(`ledge-${i}`, l, r, y, { art: 'ice' }))),
    respawns: [[-55, 60], [52, 68], [-12, 100], [-62, 135]],
  },
  'mushroom-kingdom': {
    name: 'Mushroom Kingdom', blurb: 'World 1-1: two brick grounds split by a pit, pipes, floating bricks and a pair of balance lifts in the gap.',
    family: 'retro', palette: '#5c94fc #a8c8ff #8cb0f0 #c84c0c #fcbcb0 #00a800 #fff8e0',
    blast: [-250, 250, -130, 210],
    blocks: [blk('west', -165, -52, 0, -40, { art: 'brick' }), blk('east', 52, 165, 0, -40, { art: 'brick' }),
      blk('pipe-l', -145, -122, 30, 0, { ledges: false, art: 'pipe' }), blk('pipe-r', 122, 145, 30, 0, { ledges: false, art: 'pipe' }),
      blk('bricks', -40, 40, 44, 34, { ledges: false, art: 'brick' }), blk('q-l', -100, -88, 44, 34, { ledges: false, art: 'question' }), blk('q-r', 88, 100, 44, 34, { ledges: false, art: 'question' })],
    platforms: [plat('lift-l', -46, -16, -10, { art: 'lift', path: sine(0, 22, 780) }), plat('lift-r', 16, 46, -10, { art: 'lift', path: sine(0, -22, 780) })],
    spawns: [[-110, 0], [110, 0], [-72, 0], [72, 0]],
  },
  'mushroom-kingdom-ii': {
    name: 'Mushroom Kingdom II', blurb: "Subcon's waterfall: two banks joined by a log bridge, Pidgit's flying carpet above, and Birdo spitting eggs.",
    family: 'retro', palette: '#b87e92 #ffd8a8 #d8a8a0 #e4bb84 #8a4a2a #5ab0e8 #fff0d8',
    blast: [-250, 250, -140, 220],
    blocks: [blk('west', -150, -56, 0, -40), blk('east', 56, 150, 0, -40)],
    platforms: [plat('bridge', -56, 56, -6, { art: 'log' }), plat('tree-l', -125, -85, 36), plat('tree-r', 85, 125, 36),
      plat('carpet', -16, 16, 62, { art: 'carpet', path: add(sine(90, 0, 1320), sine(0, 14, 660)) })],
    spawns: [[-100, 0], [100, 0], [-25, -6], [25, -6]],
    hazard: { kind: 'egg', label: 'Birdo', period: 1200, warn: 120, active: 120, damage: 8, angle: 150, kbBase: 40, kbGrowth: 50, flip: c => c % 2 === 1, zones: sweep(150, 8, 6, 20) },
  },
  'flat-zone': {
    name: 'Flat Zone', blurb: 'A Game & Watch screen that flips between Fire, Oil Panic and Helmet scenes. In Helmet, tools rain down.',
    family: 'retro', palette: '#b5c4a0 #c9d6b0 #a8b890 #404d40 #2a342a #353f36 #e8f0d8',
    blast: [-200, 200, -110, 190],
    blocks: taper('main', 0, 0, [[110, -10], [100, -18]], { art: 'lcd' }),
    platforms: [plat('fire-1', -100, -64, 30, { on: t => flatScene(t) === 0 }), plat('fire-2', -100, -64, 60, { on: t => flatScene(t) === 0 }), plat('oil', 40, 90, 38, { on: t => flatScene(t) === 1 }),
      plat('helmet-l', -60, -20, 34, { on: t => flatScene(t) === 2 }), plat('helmet-r', 20, 60, 34, { on: t => flatScene(t) === 2 })],
    hazard: { kind: 'tools', label: 'Falling tools', period: 4500, start: 3120, warn: 120, active: 1260, damage: 6, angle: 70, kbBase: 40, kbGrowth: 40, rehit: 40,
      zones: (_, p) => [-70, 0, 70].map((x, i) => { const y = 150 - 150 * mod(p * 6 + i / 3, 1); return [x - 8, x + 8, y, y + 14] as const; }) },
  },
  'yoshi-island-64': {
    name: "Yoshi's Island 64", blurb: 'The Nintendo 64 island: a main hill, three platforms and clouds at both sides that sink and rise.',
    family: 'storybook', palette: '#8abbd4 #fff0c8 #b8d8e0 #c4df9b #9a6a3a #f8d390 #fffaf0',
    blast: [-220, 220, -120, 200],
    blocks: taper('main', 0, 0, [[80, -12], [66, -26], [44, -38]]),
    platforms: [plat('left', -62, -28, 28), plat('right', 28, 62, 28), plat('top', -20, 20, 52),
      plat('cloud-l', -150, -106, -6, { art: 'cloud', path: sine(0, 12, 840) }), plat('cloud-r', 106, 150, -6, { art: 'cloud', path: sine(0, 12, 840, .5) })],
  },
  'kongo-jungle-64': {
    name: 'Kongo Jungle 64', blurb: 'The Nintendo 64 jungle: uneven side platforms, a top platform that rises and falls, and the barrel below.',
    family: 'jungle', palette: '#82515c #f4b469 #a8705a #b28350 #6a4a2a #ffcf6a #ffe8c8',
    blast: [-210, 210, -120, 200],
    blocks: taper('main', 0, 0, [[70, -10], [58, -24], [36, -36]]),
    platforms: [plat('left', -62, -32, 20), plat('right', 32, 62, 34), plat('top', -16, 16, 52, { path: sine(0, 10, 600) }), plat('barrel', -8, 8, -58, { art: 'barrel', path: sine(88, 0, 960) })],
  },
};

// ── Runtime ───────────────────────────────────────────────────────────────
const m = (u: number) => u * UNIT;
const zone = ([left, right, bottom, top]: U4): Zone => ({ left: m(left), right: m(right), bottom: m(bottom), top: m(top) });
type Raw = { blocks: Block[]; platforms: Platform[]; corners: (-1 | 1)[][] };
function raw(spec: Spec, t: number): Raw {
  const out: Raw = { blocks: [], platforms: [], corners: [] };
  for (const b of spec.blocks) {
    const k = b.grow ? b.grow(t) : 1;
    if (k <= 0 || (b.on && !b.on(t))) continue;
    const [x, y] = b.path?.(t) ?? [0, 0], sides = b.ledges === false ? [] : b.ledges === -1 || b.ledges === 1 ? [b.ledges] : [-1, 1] as (-1 | 1)[];
    out.blocks.push({ id: b.id, left: m(b.l + x), right: m(b.r + x), top: m(b.bottom + (b.top - b.bottom) * k + y), bottom: m(b.bottom + y), ledges: sides.length > 0,
      ...(b.path || b.grow || b.on ? { moving: true } : {}), ...(b.art ? { art: b.art } : {}) });
    out.corners.push(sides);
  }
  for (const p of spec.platforms ?? []) {
    if (p.on && !p.on(t)) continue;
    const [x, y] = p.path?.(t) ?? [0, 0];
    out.platforms.push({ id: p.id, left: m(p.l + x), right: m(p.r + x), y: m(p.y + y), dx: 0, dy: 0, ...(p.art ? { art: p.art } : {}) });
  }
  return out;
}
const inside = (blocks: Block[], x: number, y: number) => blocks.some(b => x > b.left && x < b.right && y > b.bottom && y < b.top);
/** A top corner is grabbable when its floor is open above and its wall is open just below, outside. */
function ledgesOf({ blocks, corners }: Raw): Ledge[] {
  const e = 1e-3;
  return blocks.flatMap((b, i) => corners[i].flatMap(side => {
    const x = side < 0 ? b.left : b.right;
    return inside(blocks, x + side * e, b.top - e) || inside(blocks, x - side * e, b.top + e) ? [] : [{ id: `${b.id}:${side < 0 ? 'L' : 'R'}`, block: b.id, x, y: b.top, side }];
  }));
}
function hazardOf(h: HazardSpec, t: number): HazardFrame {
  const since = t - (h.start ?? h.period) + h.warn, cycle = Math.floor(since / h.period), phase = since - cycle * h.period, flip = h.flip?.(cycle) ?? false;
  const warning = since >= 0 && phase < h.warn, active = since >= 0 && phase >= h.warn && phase < h.warn + h.active;
  return { kind: h.kind, label: h.labels && (warning || active) ? h.labels[mod(cycle, h.labels.length)] : h.label, warning, active,
    zones: warning || active ? h.zones(cycle, active ? (phase - h.warn) / h.active : 0).map(zone) : [], push: active ? m(h.push ?? 0) * (flip ? -1 : 1) : 0,
    damage: h.damage, angle: flip ? 180 - h.angle : h.angle, kbBase: h.kbBase, kbGrowth: h.kbGrowth, cycle, ...(h.rehit ? { rehit: h.rehit } : {}) };
}

function define(id: StageId, s: Spec): StageDef {
  const blast = zone(s.blast), camera = zone(s.camera ?? [s.blast[0] + 50, s.blast[1] - 50, s.blast[2] + 30, s.blast[3] - 45]);
  const start = raw(s, 0), main = start.blocks[0], cx = (main.left + main.right) / 2, half = (main.right - main.left) / 2;
  const spawns = s.spawns?.map(([x, y]) => [m(x), m(y)] as [number, number]) ?? [-.55, .55, -.2, .2].map(f => [cx + f * half, main.top] as [number, number]);
  const floorAt = (x: number) => Math.max(main.top, ...[...start.blocks.map(b => [b.left, b.right, b.top]), ...start.platforms.map(p => [p.left, p.right, p.y])]
    .filter(([l, r]) => x > l - m(16) && x < r + m(16)).map(([, , y]) => y));
  const respawns = s.respawns?.map(([x, y]) => [m(x), m(y)] as [number, number])
    ?? spawns.map(([x]) => [cx + (x - cx) * .8, Math.min(camera.top - m(20), floorAt(cx + (x - cx) * .8) + m(40))] as [number, number]);
  return { id, name: s.name, blurb: s.blurb, family: s.family, palette: pal(s.palette), blast, camera, spawns, respawns, source: s.source ?? s.name, ...(s.hazard ? { hazardLabel: s.hazard.label } : {}) };
}
export const STAGES = Object.fromEntries(STAGE_IDS.map(id => [id, define(id, SPECS[id])])) as Record<StageId, StageDef>;
export const getStage = (id: StageId): StageDef => STAGES[id];
export const resolveStage = (choice: StageId | 'random' | undefined, seed: number): StageId =>
  choice === 'random' ? STAGE_IDS[(seed >>> 0) % STAGE_IDS.length] : choice && Object.hasOwn(STAGES, choice) ? choice : 'battlefield';

/**
 * Collision, ledges and hazard at `tick` (the View's stageTick). dx/dy compare against tick − 1; a piece that wraps around
 * a treadmill outside the blast zone reports 0 instead of a jump. With hazards off, damage and wind stop but terrain still moves.
 */
export function stageFrame(id: StageId, tick: number, hazards = true): { stage: StageDef; blocks: Block[]; platforms: Platform[]; ledges: Ledge[]; hazard: HazardFrame | null } {
  const spec = SPECS[id], now = raw(spec, tick), prev = raw(spec, tick - 1), step = (a: number) => Math.abs(a) < 1 ? a : 0;
  for (const b of now.blocks) if (b.moving) { const p = prev.blocks.find(q => q.id === b.id); b.dx = p ? step(b.left - p.left) : 0; b.dy = p ? step(b.top - p.top) : 0; }
  for (const p of now.platforms) { const q = prev.platforms.find(o => o.id === p.id); if (q) { p.dx = step(p.left - q.left); p.dy = step(p.y - q.y); } }
  return { stage: STAGES[id], blocks: now.blocks, platforms: now.platforms, ledges: ledgesOf(now), hazard: hazards && spec.hazard ? hazardOf(spec.hazard, tick) : null };
}
