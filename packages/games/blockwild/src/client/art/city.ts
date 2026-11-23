/**
 * Caper City art: the 16×16 textures of the city's own blocks and the sprites of its items, painted at runtime like
 * the rest of the atlas. Families (`stucco_3`, `shop_sign_7`…) are one painter with a palette or an icon per member.
 */
import { hash, mix, Pix, pick, shade, tnoise, type Palette, type Rgb } from './pixels';

type Painter = (p: Pix) => void;
/** A ramp around a base colour, dark to light. */
const ramp = (base: Rgb, spread = 0.1) => [-2, -1, 0, 1, 2].map(k => shade(base, 1 + k * spread));
/** Fine speckle in a ramp, with a soft large-scale mottle. */
const speckle = (p: Pix, colors: readonly Rgb[], seed: number, rough = 0.5, cell = 8) =>
  p.fill((x, y) => pick(colors, 0.5 + (tnoise(x, y, seed, cell) - 0.5) * 0.5 + (hash(x, y, seed + 1) - 0.5) * rough));

// Streets ------------------------------------------------------------------------------------------------------------
const TAR = [0x2d2f36, 0x33353d, 0x393b44, 0x40424b, 0x484a54], PAINT = 0xe9e6da, YELLOW = 0xe6b93a;
const asphalt = (p: Pix, seed = 31) => {
  speckle(p, TAR, seed, 0.75, 4);
  for (let i = 0; i < 5; i++) p.set(Math.floor(hash(i, 3, seed) * 16), Math.floor(hash(i, 7, seed) * 16), 0x5b5d66);
};
const worn = (c: Rgb, x: number, y: number) => hash(x, y, 77) < 0.12 ? mix(c, TAR[3]!, 0.55) : shade(c, 0.94 + hash(x, y, 78) * 0.1);
const ASPHALT: Painter[] = [
  p => asphalt(p),
  // A centre line down the west edge (running north–south), then down the north edge (east–west).
  p => { asphalt(p); for (let y = 0; y < 16; y++) for (const x of [0, 1]) p.set(x, y, worn(YELLOW, x, y)); },
  p => { asphalt(p); for (let x = 0; x < 16; x++) for (const y of [0, 1]) p.set(x, y, worn(YELLOW, x, y)); },
  // Crossing bars lying north–south, then east–west.
  p => { asphalt(p); for (let y = 0; y < 16; y++) for (let x = 3; x < 13; x++) p.set(x, y, worn(PAINT, x, y)); },
  p => { asphalt(p); for (let x = 0; x < 16; x++) for (let y = 3; y < 13; y++) p.set(x, y, worn(PAINT, x, y)); },
  // A parking bay tick.
  p => { asphalt(p, 37); for (let k = 4; k < 12; k++) { p.set(k, 7, worn(PAINT, k, 7)); p.set(k, 8, worn(PAINT, k, 8)); p.set(7, k, worn(PAINT, 7, k)); p.set(8, k, worn(PAINT, 8, k)); } },
];
const STONE = [0x8d8f96, 0x999ba2, 0xa4a6ad, 0xafb1b8, 0xbbbdc4];
const PAVEMENT: Painter[] = [
  // Square pavers, four to a block.
  p => p.fill((x, y) => (x & 7) === 7 || (y & 7) === 7 ? 0x74767d : pick(STONE, 0.45 + hash(x >> 3, y >> 3, 41) * 0.35 + (hash(x, y, 42) - 0.5) * 0.3 + ((x & 7) === 0 || (y & 7) === 0 ? 0.12 : 0))),
  // Warm plaza flagstones.
  p => { const warm = ramp(0xc9bfa8, 0.06); p.fill((x, y) => x === 15 || y === 15 ? 0xa3997f : pick(warm, 0.5 + (tnoise(x, y, 43, 8) - 0.5) * 0.5 + (hash(x, y, 44) - 0.5) * 0.3 + (x === 0 || y === 0 ? 0.15 : 0))); },
  // Kerb stones: long pale blocks.
  p => { const pale = ramp(0xc5c7cc, 0.05); p.fill((x, y) => y === 15 || y === 7 || (x + (y > 7 ? 8 : 0)) % 16 === 15 ? 0x8b8d93 : pick(pale, 0.5 + (hash(x, y, 45) - 0.5) * 0.5)); },
];
const concrete = (base: Rgb, seed: number): Painter => p => {
  const tones = ramp(base, 0.045);
  p.fill((x, y) => y === 15 ? shade(base, 0.82) : pick(tones, 0.5 + (tnoise(x, y, seed, 8) - 0.5) * 0.6 + (hash(x, y, seed + 1) - 0.5) * 0.35));
  for (const [x, y] of [[2, 2], [13, 2], [2, 12], [13, 12]] as const) p.set(x, y, shade(base, 0.78));
};
const CONCRETE = [0xa9abb0, 0x6f7279, 0xe2e1dc];

// Walls and roofs ----------------------------------------------------------------------------------------------------
const STUCCO = [0xe9dcbc, 0xe6b89c, 0xa9c7dd, 0xb5d6bd, 0xe0a9ae, 0xead58c, 0xc3b3d8, 0xd9d6cf];
const stucco = (base: Rgb, seed: number): Painter => p => {
  const tones = ramp(base, 0.035);
  p.fill((x, y) => pick(tones, 0.5 + (tnoise(x, y, seed, 4, 2) - 0.5) * 0.7 + (hash(x, y, seed + 1) - 0.5) * 0.3));
};
const BRICKS: readonly (readonly [Rgb, Rgb])[] = [[0xc19a6b, 0xe3d8c4], [0x7f858f, 0xb9bcc2], [0x7a4f3a, 0xbfb09c], [0xe4e0d6, 0xbcb8ae]];
const cityBricks = ([base, mortar]: readonly [Rgb, Rgb], seed: number): Painter => p => {
  const tones = ramp(base, 0.07);
  p.fill((x, y) => {
    const row = y >> 2, bx = (x + (row & 1 ? 4 : 0)) & 15;
    if ((y & 3) === 3 || (bx & 7) === 7) return shade(mortar, 0.94 + hash(x, y, seed) * 0.1);
    return pick(tones, 0.3 + hash(row, bx >> 3, seed + 1) * 0.45 + ((y & 3) === 0 ? 0.12 : 0) + (hash(x, y, seed + 2) - 0.5) * 0.2);
  });
};
/** A window in a frame: glass shaded from the sky down, a glint, and a sill. */
const windowPane = (glass: readonly [Rgb, Rgb], frame: Rgb, style: 'plain' | 'cross' | 'blind', seed: number): Painter => p => {
  p.fill((x, y) => {
    if (x === 0 || x === 15 || y === 0 || y >= 14) return y >= 14 ? shade(frame, y === 15 ? 0.7 : 1.08) : frame;
    if (style === 'cross' && (x === 7 || x === 8 || y === 7)) return shade(frame, 0.92);
    if (style === 'blind' && y < 6) return y % 2 ? 0xe9e2cf : 0xd3cab3;
    return mix(glass[0], glass[1], y / 14 + (hash(x, y, seed) - 0.5) * 0.08);
  });
  for (let k = 0; k < 4; k++) { p.set(3 + k, 5 - k, mix(glass[0], 0xffffff, 0.45)); p.set(9 + k, 11 - k, mix(glass[1], 0xffffff, 0.25)); }
};
const WINDOWS: Painter[] = [
  windowPane([0x4d6f93, 0x24364f], 0x3a3f4a, 'plain', 51), windowPane([0x4f8478, 0x1f3d3a], 0x39423f, 'plain', 52),
  windowPane([0xa9c4d8, 0x5a7896], 0x8d949c, 'plain', 53), windowPane([0x5a7ea3, 0x2a3f5c], 0xe8e4d8, 'cross', 54),
];
const LIT: Painter[] = [
  windowPane([0xffe9a6, 0xf2b95a], 0x3a3f4a, 'cross', 55), windowPane([0xe9f4ff, 0xb5d2ee], 0x8d949c, 'plain', 56), windowPane([0xffd08a, 0xe98f4c], 0xe8e4d8, 'blind', 57),
];
const ROOFS = [0xb5503a, 0x56606e, 0x4f7f5c];
const roofTiles = (base: Rgb, seed: number): Painter => p => p.fill((x, y) => {
  const row = y >> 2, tx = (x + (row & 1 ? 2 : 0)) & 3, ty = y & 3;
  return shade(base, (ty === 3 ? 0.68 : ty === 0 ? 1.15 : 1) * (tx === 3 ? 0.84 : 1) * (0.92 + hash(row, (x + (row & 1 ? 2 : 0)) >> 2, seed) * 0.18));
});
const METALS = [0x8f959d, 0xb84a3c, 0x3f6fae, 0x4f8f55, 0xe0b23c, 0xe6e8ea];
const metalSheet = (base: Rgb, seed: number): Painter => p => p.fill((x, y) => shade(base, [0.78, 0.95, 1.12, 1.0][x & 3]! * (0.96 + hash(x, y, seed) * 0.08) * (y === 0 ? 0.85 : 1)));
const BANDS = [0xe0503f, 0xf2c23e, 0x3aa8dc, 0x6cc04f, 0x9b6ee0, 0x2fa69a, 0x2b3f73, 0xf1ead6];
const signBand = (base: Rgb): Painter => p => p.fill((x, y) => y === 0 || y === 15 ? shade(base, 0.62) : y === 1 ? shade(base, 1.18) : shade(base, 0.97 + hash(x, y, 61) * 0.06));

/** Shop sign icons, 12 × 12 on a dark plate: # is the bright shape, + a shade of it. */
const ICONS: readonly (readonly string[])[] = [
  // food: a fork and a spoon
  ['.#.#.#...##.', '.#.#.#..####', '.#.#.#..####', '.#####..####', '..###....##.', '...#.....##.', '...#.....##.', '...#.....##.', '...#.....##.', '...#.....##.', '...#.....##.', '............'],
  // gizmo: a cog
  ['....##......', '.#..##..#...', '..######....', '..##++##....', '###+..+###..', '###+..+###..', '..##++##....', '..######....', '.#..##..#...', '....##......', '............', '............'],
  // hardware: a hammer
  ['..#######...', '.#########..', '.##++++###..', '..##..###...', '......##....', '.....##.....', '....##......', '...##.......', '..##........', '.##.........', '.#..........', '............'],
  // pawn: a cut gem
  ['...######...', '..#++##++#..', '.#+++##+++#.', '############', '.#++####++#.', '..#++##++#..', '...#+##+#...', '....####....', '.....##.....', '............', '............', '............'],
  // realtor: a key
  ['..####......', '.##++##.....', '.#+..+#.....', '.#+..+#.....', '.##++##.....', '..####......', '...##.......', '...##.......', '...####.....', '...##.......', '...####.....', '............'],
  // cabs: a little car
  ['............', '...######...', '..#++##++#..', '.##++##++##.', '############', '############', '##+######+##', '.#++....++#.', '..##....##..', '............', '............', '............'],
  // depot: an envelope
  ['............', '############', '##+......+##', '#.#+....+#.#', '#..#+..+#..#', '#...#++#...#', '#....##....#', '#..........#', '#..........#', '############', '............', '............'],
  // dealer: a wheel
  ['...######...', '..##+##+##..', '.##..##..##.', '.#+..##..+#.', '.#########..', '.#########..', '.#+..##..+#.', '.##..##..##.', '..##+##+##..', '...######...', '............', '............'],
  // scrap: a horseshoe magnet
  ['.###....###.', '.###....###.', '.+++....+++.', '.###....###.', '.###....###.', '.###....###.', '.####..####.', '..########..', '...######...', '............', '............', '............'],
  // clinic: a cross
  ['....####....', '....####....', '....####....', '############', '############', '############', '############', '....####....', '....####....', '....####....', '............', '............'],
  // watch: a badge
  ['.....##.....', '.....##.....', '.##########.', '..########..', '...######...', '..########..', '..###..###..', '.###....###.', '.#........#.', '............', '............', '............'],
  // bank: a coin
  ['...######...', '..########..', '.###++++###.', '.##+####+##.', '.##+##......', '.##+####+##.', '.##....+###.', '.##+####+##.', '.###++++###.', '..########..', '...######...', '............'],
  // hall: a temple front
  ['.....##.....', '...######...', '.##########.', '############', '.#.##.##.#..', '.#.##.##.#..', '.#.##.##.#..', '.#.##.##.#..', '.#.##.##.#..', '############', '############', '............'],
  // airfield: a plane
  ['.....##.....', '.....##.....', '....####....', '..########..', '############', '############', '....####....', '.....##.....', '....####....', '...######...', '............', '............'],
  // cinema: a star
  ['.....##.....', '.....##.....', '....####....', '############', '.##########.', '..########..', '..########..', '.####..####.', '.##......##.', '............', '............', '............'],
  // hotel: a bell
  ['.....##.....', '....####....', '...######...', '..########..', '..########..', '.##########.', '.##########.', '############', '....####....', '............', '............', '............'],
  // fish (the bait hut and the fishmonger)
  ['............', '............', '....####...#', '..########.#', '.###+#######', '############', '.###########', '..########.#', '....####...#', '............', '............', '............'],
  // hats: a top hat
  ['............', '...######...', '...######...', '...######...', '...######...', '...++++++...', '...######...', '.##########.', '.##########.', '............', '............', '............'],
  // bus
  ['............', '.##########.', '############', '#++#++#++#+#', '#++#++#++#+#', '############', '############', '############', '.##+####+##.', '..++....++..', '............', '............'],
  // fire: a flame
  ['.....#......', '....##......', '....###.....', '...####..#..', '..#####.##..', '..########..', '.###+#####..', '.##+++####..', '.##++++###..', '..##++###...', '...#####....', '............'],
  // ambulance: a heart
  ['............', '..###..###..', '.##########.', '############', '############', '############', '.##########.', '..########..', '...######...', '....####....', '.....##.....', '............'],
  // race: a chequered flag
  ['#...........', '#.##..##..#.', '#.##..##..#.', '#...##..##..', '#...##..##..', '#.##..##..#.', '#.##..##..#.', '#...........', '#...........', '#...........', '#...........', '#...........'],
  // marina: an anchor
  ['.....##.....', '....#..#....', '.....##.....', '...######...', '.....##.....', '.....##.....', '#....##....#', '##...##...##', '.##..##..##.', '..########..', '....####....', '............'],
  // paint: a roller
  ['.#########..', '.#########.#', '.#########.#', '.#########.#', '...........#', '.....#######', '.....#......', '.....#......', '....###.....', '....###.....', '....###.....', '............'],
  // fair: a ticket
  ['............', '############', '#..........#', '#.##.##.##.#', '..##.##.##..', '..##.##.##..', '#.##.##.##.#', '#..........#', '############', '............', '............', '............'],
  // lock-up: a padlock
  ['....####....', '...##..##...', '...#....#...', '...#....#...', '.##########.', '.##########.', '.####..####.', '.####..####.', '.#####.####.', '.##########.', '.##########.', '............'],
  // alarm: a bell with a clapper
  ['.....##.....', '....####....', '...######...', '...######...', '..########..', '..########..', '.##########.', '############', '............', '.....##.....', '.....##.....', '............'],
  // music: a note
  ['....#######.', '....#######.', '....#.....#.', '....#.....#.', '....#.....#.', '....#.....#.', '..###...###.', '.####..####.', '.####..####.', '..##....##..', '............', '............'],
  // bicycle
  ['............', '...##....#..', '....#...##..', '..#######...', '..#.#...#...', '.###.#.###..', '#...#.#...#.', '#...##....#.', '#...#.#...#.', '.###...###..', '............', '............'],
  // somebody with something to say
  ['....####....', '....####....', '....####....', '....####....', '....####....', '....####....', '.....##.....', '.....##.....', '............', '....####....', '....####....', '............'],
  // a target (stalls)
  ['...######...', '..#......#..', '.#..####..#.', '#..#....#..#', '#.#..##..#.#', '#.#.####.#.#', '#.#.####.#.#', '#.#..##..#.#', '#..#....#..#', '.#..####..#.', '..#......#..', '...######...'],
  // monorail and trains: a rail car
  ['............', '.##########.', '############', '#+++#++#+++#', '#+++#++#+++#', '############', '############', '.##########.', '............', '############', '.#..#..#..#.', '............'],
];
const SIGN_PLATE = 0x1c2140;
const shopSign = (icon: readonly string[], accent: Rgb): Painter => p => {
  p.fill((x, y) => x === 0 || y === 0 || x === 15 || y === 15 ? accent : SIGN_PLATE);
  p.draw(icon as string[], { '#': 0xfff6e5, '+': mix(0xfff6e5, accent, 0.55) }, 2, 2);
};
/** The accent of each sign: the band colour of its trade (the order of buildings.ts SIGNS), then the cinema and hotel. */
const SIGN_ACCENTS = [0, 4, 1, 5, 3, 1, 2, 0, 6, 0, 2, 3, 7, 2, 0, 1, 2, 4, 3, 0, 0, 7, 2, 4, 1, 6, 0, 5, 3, 1, 0, 5].map(band => BANDS[band]!);

// Fittings -----------------------------------------------------------------------------------------------------------
const WOODS = [0x7a5230, 0x8c6038, 0x9d6e42, 0xae7d4e, 0xbf8c5b];
const planks = (p: Pix, seed: number, tones: readonly Rgb[] = WOODS) => p.fill((x, y) => (y & 3) === 3 ? tones[0]! : pick(tones, 0.35 + hash(y >> 2, 0, seed) * 0.3 + (hash(x >> 1, y, seed + 1) - 0.5) * 0.3));
const shelf = (goods: readonly Rgb[], seed: number): Painter => p => {
  planks(p, seed);
  for (let row = 0; row < 3; row++) for (let x = 1; x < 15; x++) {
    const item = Math.floor(x / 2 + row * 3), color = goods[Math.floor(hash(item, row, seed + 2) * goods.length)]!, tall = 2 + Math.floor(hash(item, row, seed + 3) * 2);
    if (hash(item, row, seed + 4) < 0.14) continue;
    for (let k = 0; k < tall; k++) p.set(x, row * 5 + 4 - k, shade(color, x & 1 ? 1 : 0.86));
    p.set(x, row * 5 + 5 > 15 ? 15 : row * 5 + 5, WOODS[1]!);
  }
};
const steel: Painter = p => {
  speckle(p, ramp(0x8b929c, 0.05), 71, 0.35);
  for (let k = 0; k < 16; k++) { p.set(k, 0, 0xb4bac2); p.set(k, 15, 0x5d636c); p.set(0, k, 0xa6acb5); p.set(15, k, 0x666c75); }
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]] as const) p.set(x, y, 0x4f555e);
};
const crate = (top: boolean): Painter => p => {
  planks(p, 73, [0x8b6a3c, 0x9c7948, 0xad8855, 0xbd9763, 0xcda672]);
  for (let k = 0; k < 16; k++) for (const e of [0, 15]) { p.set(k, e, 0x6b4f2a); p.set(e, k, 0x6b4f2a); }
  if (!top) for (let k = 1; k < 15; k++) { p.set(k, k, 0x7a5c33); p.set(15 - k, k, 0x7a5c33); }
};
const FITTINGS: Record<string, Painter> = {
  steel,
  awning: p => p.fill((x, y) => shade((x >> 2) & 1 ? 0xe0503f : 0xf5efe2, y > 13 ? 0.8 : 0.96 + hash(x, y, 81) * 0.06)),
  light_panel: p => p.fill((x, y) => x === 0 || y === 0 || x === 15 || y === 15 ? 0x9ea4ad : x % 5 === 0 ? 0xf3ecc8 : mix(0xfffbe8, 0xfff1b8, hash(x, y, 82))),
  counter_side: p => { planks(p, 83); for (let x = 0; x < 16; x++) { p.set(x, 0, 0xe6dfcf); p.set(x, 1, 0xb9b09d); } },
  counter_top: p => speckle(p, ramp(0xe9e2d2, 0.03), 84, 0.3),
  crate_side: crate(false), crate_top: crate(true),
  bin_side: p => p.fill((x, y) => y < 3 ? shade(0x3d4a44, y === 0 ? 1.3 : 1.05) : shade(0x4f6157, [0.8, 1, 1.12, 0.95][x & 3]!)),
  bin_top: p => p.fill((x, y) => Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) > 6 ? 0x4f6157 : 0x1c211f),
  mailbox_side: p => { p.fill((x, y) => shade(0x2f66b5, y < 2 ? 1.25 : 0.95 + hash(x, y, 85) * 0.08)); for (let x = 3; x < 13; x++) { p.set(x, 5, 0x12233f); p.set(x, 9, 0xf3efe4); p.set(x, 10, 0xf3efe4); } },
  mailbox_top: p => p.fill((x, y) => shade(0x3a74c6, 0.95 + hash(x, y, 86) * 0.1)),
  job_board: p => {
    p.fill((x, y) => x === 0 || y === 0 || x === 15 || y === 15 ? 0x6b4f2a : pick(ramp(0xc59a62, 0.06), 0.5 + (hash(x, y, 87) - 0.5) * 0.8));
    for (const [x, y, w, h, c] of [[2, 2, 5, 6, 0xf6f1e1], [8, 3, 6, 4, 0xffe38a], [3, 9, 4, 5, 0xbfe3f2], [9, 8, 5, 6, 0xf6f1e1]] as const) {
      p.rect(x, y, w, h, c);
      for (let k = 1; k < h - 1; k += 2) for (let i = 1; i < w - 1; i++) p.set(x + i, y + k, shade(c, 0.6));
      p.set(x + (w >> 1), y, 0xd8403a);
    }
  },
  till_side: p => { p.fill((x, y) => y < 7 ? 0 : shade(0x4a5568, 0.9 + hash(x, y, 88) * 0.15), 255); for (let y = 0; y < 7; y++) for (let x = 0; x < 16; x++) p.set(x, y, x > 3 && x < 12 && y > 0 ? (y < 5 ? 0x9fe3b4 : 0x2d3340) : 0x394252); },
  till_top: p => p.fill((x, y) => (x & 3) === 1 && (y & 3) === 1 ? 0xe9e6da : shade(0x4a5568, 0.95 + hash(x, y, 89) * 0.1)),
  vault_door: p => {
    steel(p);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const r = Math.hypot(x - 7.5, y - 7.5); if (r < 6.5) p.set(x, y, r > 5.4 ? 0x565c66 : r < 1.6 ? 0xd9b24a : shade(0x9aa1ab, 0.9 + hash(x, y, 90) * 0.15)); }
    for (let k = 3; k < 13; k++) { p.set(k, 7, 0xd9b24a); p.set(7, k, 0xd9b24a); }
  },
  cone: p => p.draw(['.......oo.......', '.......oo.......', '......oooo......', '......oooo......', '......wwww......', '.....wwwwww.....', '.....oooooo.....', '.....oooooo.....', '....oooooooo....', '....wwwwwwww....', '....wwwwwwww....', '...oooooooooo...', '...oooooooooo...', '..oooooooooooo..', '.kkkkkkkkkkkkkk.', '.kkkkkkkkkkkkkk.'], { o: 0xf07a1c, w: 0xf5f0e6, k: 0x2b2b30 }),
};

/** Every city texture by atlas key. */
export const CITY_PAINTERS: Record<string, Painter> = { ...FITTINGS };
const family = (name: string, painters: readonly Painter[]) => painters.forEach((painter, i) => { CITY_PAINTERS[`${name}_${i}`] = painter; });
family('asphalt', ASPHALT);
family('pavement', PAVEMENT);
family('concrete', CONCRETE.map((base, i) => concrete(base, 91 + i * 3)));
family('stucco', STUCCO.map((base, i) => stucco(base, 101 + i * 3)));
family('city_bricks', BRICKS.map((pair, i) => cityBricks(pair, 131 + i * 3)));
family('window', WINDOWS);
family('window_lit', LIT);
family('roof_tiles', ROOFS.map((base, i) => roofTiles(base, 141 + i)));
family('metal_sheet', METALS.map((base, i) => metalSheet(base, 151 + i)));
family('sign_band', BANDS.map(signBand));
family('shop_sign', ICONS.map((icon, i) => shopSign(icon, SIGN_ACCENTS[i]!)));
family('shelf', [shelf([0xd8403a, 0xf2c23e, 0x3aa8dc, 0x6cc04f, 0xf5efe2], 161), shelf([0x8f959d, 0xe0503f, 0x4a5568, 0xd9b24a], 162), shelf([0x9b6ee0, 0x3aa8dc, 0xf1ead6, 0xe0a9ae], 163), shelf([0x7a4f3a, 0x2b3f73, 0x4f7f5c, 0xb5503a], 164)]);
/** The band colours and the sign icons as CSS colours and pixel rows, for the map and the HUD. */
export const SIGN_COLORS = BANDS.map(c => `#${c.toString(16).padStart(6, '0')}`);
export const SIGN_ICONS = ICONS;

// Item sprites -------------------------------------------------------------------------------------------------------
const sprite = (rows: readonly string[], palette: Palette, oy = 0) => () => new Pix().draw(rows as string[], palette, 0, oy);
export const CITY_SPRITES: Record<string, () => Pix> = {
  bopper: sprite(['..........RRRR..', '.........RrRRRR.', '........RRrRRRRR', '........RRRrRRRR', '........RRRRrRRR', '.........RRRRrR.', '........YRRRRR..', '.......YyY......', '......YyY.......', '.....YyY........', '....YyY.........', '...YyY..........', '..YyY...........', '.KKY............', '.KK.............'], { R: 0xe0503f, r: 0xf58a7b, Y: 0xf2c23e, y: 0xffe38a, K: 0x2b3f73 }),
  cream_pie: sprite(['................', '......WW........', '....WWWWWW......', '...WWWwWWWWW....', '..WWwWWWWWwWW...', '..WWWWWRWWWWW...', '.TWWWWWWWWWWWT..', '.TTTTTTTTTTTTT..', '..tTTTTTTTTTt...', '...ttttttttt....'], { W: 0xfffbf0, w: 0xe9dfc9, R: 0xd8403a, T: 0xd9a25a, t: 0xa9743a }, 3),
  disguise_kit: sprite(['................', '..KKKK....KKKK..', '.KkkkkKKKKkkkkK.', '.KkkkkK..KkkkkK.', '..KKKK....KKKK..', '......PPPP......', '.....PPPPPP.....', '......PPPP......', '...BBBBBBBBBB...', '..BBBbBBBBbBBB..', '..BB.BBBBBB.BB..'], { K: 0x23232a, k: 0x8fd0ee, P: 0xe9b08f, B: 0x5a3c1c, b: 0x7a5230 }, 2),
  burger: sprite(['................', '....BBBBBBBB....', '...BBbBBBBbBB...', '..BBBBBbBBBBBB..', '..GGGGGGGGGGGG..', '..RRYYRRRRYYRR..', '..MMMMMMMMMMMM..', '..mMMMMMMMMMMm..', '..BBBBBBBBBBBB..', '...bBBBBBBBBb...'], { B: 0xd9953e, b: 0xf5e0a8, G: 0x6cc04f, R: 0xd8403a, Y: 0xf2c23e, M: 0x6b3f24, m: 0x4f2d18 }, 3),
  donut: sprite(['................', '....PPPPPPPP....', '...PPPpPPPPPP...', '..PPyPPPPPPbPP..', '..PPPPP..PPPPP..', '..PPPP....PPPP..', '..PPrPP..PPPPP..', '..DPPPPPPPPgPD..', '...DDPPPPPPDD...', '....DDDDDDDD....'], { P: 0xf08fb5, p: 0xfbc6da, D: 0xc98a4a, y: 0xf2c23e, b: 0x3aa8dc, r: 0xd8403a, g: 0x6cc04f }, 3),
  fizz_pop: sprite(['........SS......', '.......SS.......', '....CCCCCCC.....', '....CcccccC.....', '....BBBBBBB.....', '....BbBBBBB.....', '....BbBWWBB.....', '....BbWBBWB.....', '....BbBWWBB.....', '....BbBBBBB.....', '....BBBBBBB.....', '....CCCCCCC.....'], { S: 0xf5efe2, C: 0xc4c9d1, c: 0xe6e8ea, B: 0x3aa8dc, b: 0x8fd0ee, W: 0xfff6e5 }, 2),
  coin: sprite(['................', '.....YYYYYY.....', '....YyyyyyYY....', '...YyYYYYYyYY...', '...YyYYyYYyDY...', '...YyYYyYYyDY...', '...YyYYyYYyDY...', '...YyYYYYYyDY...', '....YyyyyyDY....', '.....DDDDDD.....'], { Y: 0xf2c23e, y: 0xffe38a, D: 0xb8860b }, 3),
  coin_purse: sprite(['................', '......GGGG......', '.....GgGGgG.....', '....LLLLLLLL....', '...LLlLLLLLLL...', '..LLlLLLLLLLLL..', '..LLLLLYYLLLLL..', '..LLLLYyyYLLLL..', '..LLLLLYYLLLLL..', '...LLLLLLLLLL...', '....DDDDDDDD....'], { G: 0xd9b24a, g: 0xffe38a, L: 0x8a4f2e, l: 0xb5714a, Y: 0xf2c23e, y: 0xffe38a, D: 0x5a3018 }, 2),
  gold_watch: sprite(['......BBBB......', '......BbbB......', '.....YYYYYY.....', '....YyyyyyYY....', '...YyWWWWWyDY...', '...YyWWKWWyDY...', '...YyWWKKWyDY...', '...YyWWWWWyDY...', '....YyyyyyDY....', '.....DDDDDD.....', '......BbbB......', '......BBBB......'], { Y: 0xf2c23e, y: 0xffe38a, D: 0xb8860b, W: 0xfffbf0, K: 0x23232a, B: 0x5a3c1c, b: 0x7a5230 }, 2),
  water_balloon: sprite(['................', '......KK........', '.....BBBB.......', '....BBbbBBB.....', '...BBbbBBBBB....', '...BbbBBBBBB....', '...BbBBBBBBB....', '...BBBBBBBDB....', '...BBBBBBDDB....', '....BBBBDDB.....', '.....BBBBB......', '......BBB.......'], { B: 0x3aa8dc, b: 0xbfe6f7, D: 0x2a7fb0, K: 0x2b3f73 }, 2),
  banana_peel: sprite(['................', '.......KK.......', '.......YY.......', '......YYYY......', '......YyyY......', '.....YYyyYY.....', '....YYY..YYY....', '...YYY....YYY...', '..YYD......DYY..', '.YYD........DYY.', '.YD..........DY.', '................'], { Y: 0xf2c23e, y: 0xfff1b0, D: 0xc99a2e, K: 0x5a4632 }, 2),
  smoke_puff: sprite(['................', '.....GGG........', '...GGgggGG.GG...', '..GgggggggGggG..', '..GggGggggggggG.', '.GggggggGgggggG.', '.GgggggggggggG..', '..GGgggGgggGG...', '....GGGGGGG.....', '......RRR.......', '......RrR.......', '......RRR.......'], { G: 0x9aa0aa, g: 0xd6dae0, R: 0xd8403a, r: 0xf58a7b }, 2),
  parasol: sprite(['.......K........', '....RRRWRRR.....', '..RRRRWWWRRRR...', '.RRRRWWWWWRRRR..', 'RRRRWWWWWWWRRRR.', 'R..R...K...R..R.', '.......K........', '.......K........', '.......K........', '.......K........', '.......K..K.....', '.......KKKK.....'], { R: 0xd8403a, W: 0xfff6e5, K: 0x5a4632 }, 2),
  kazoo: sprite(['................', '................', '................', '.......YYY......', '......YyyyY.....', '.BBBBBBBBBBBBB..', 'BbbbbbbbbbbbbBB.', 'BBBBBBBBBBBBBBBD', '.DDDDDDDDDDDDD..', '................', '................', '................'], { B: 0xe98f4c, b: 0xffc79a, D: 0xa85f2a, Y: 0xf2c23e, y: 0xfff1b0 }, 2),
  fishing_rod: sprite(['.............BB.', '............BB.S', '...........BB..S', '..........BB...S', '.........BB....S', '........BB.....S', '.......BB......S', '......BB.......S', '.....BB.......RR', '....BB........RW', '...KK...........', '..KK............', '.KK.............'], { B: 0x8a5a3a, K: 0x2b2f3a, S: 0xd6dae0, R: 0xd8403a, W: 0xfff6e5 }, 1),
  tiddler: sprite(['................', '................', '................', '......SSSS....S.', '....SSSsSSSS.SS.', '...SKSSSSSSSSS..', '....SSSSSSSS.SS.', '......SSSS....S.', '................', '................', '................', '................'], { S: 0x9fb4c4, s: 0xd9e6ee, K: 0x1d1d2a }, 2),
  silver_dab: sprite(['................', '................', '.....SSSSSS.....', '...SSSssssSS...S', '..SSsssssssSS.SS', '.SKSssssssssSSS.', '..SSsssssssSS.SS', '...SSSssssSS...S', '.....SSSSSS.....', '................', '................', '................'], { S: 0xc4c9d1, s: 0xf1f3f5, K: 0x1d1d2a }, 2),
  stripey_mullet: sprite(['................', '................', '.....OOOOOO.....', '...OOWOWOWOO...O', '..OOOWOWOWOOO.OO', '.OKOOWOWOWOOOOO.', '..OOOWOWOWOOO.OO', '...OOWOWOWOO...O', '.....OOOOOO.....', '................', '................', '................'], { O: 0xe98f4c, W: 0xfff6e5, K: 0x1d1d2a }, 2),
  moon_carp: sprite(['................', '......PPPP......', '....PPPppPPP....', '...PPppppppPP..P', '..PPppppppppPPPP', '.PKPpppppppppPP.', '..PPppppppppPPPP', '...PPppppppPP..P', '....PPPppPPP....', '......PPPP......', '................', '................'], { P: 0x4a63c8, p: 0xa9b8f0, K: 0xfff6e5 }, 2),
  golden_guppy: sprite(['................', '................', '......YYYY...Y..', '....YYYyyYYY.YY.', '...YYyyyyyyYYYY.', '..YKYyyyyyyyYY..', '...YYyyyyyyYYYY.', '....YYYyyYYY.YY.', '......YYYY...Y..', '................', '................', '................'], { Y: 0xe6b93a, y: 0xfff1b0, K: 0x1d1d2a }, 2),
  old_boot: sprite(['................', '.....BBBB.......', '.....BbbB.......', '.....BbbB.......', '.....BbbB.......', '.....BbbBB......', '.....BbbbBBB....', '.....BbbbbbBB...', '.....BBBBBBBB...', '.....DDDDDDDD...', '................', '................'], { B: 0x6b4a2f, b: 0x8a6a4a, D: 0x2b2f3a }, 2),
  lost_parcel: sprite(['................', '...BBBBBBBBBB...', '...BbbbTTbbbB...', '...BbbbTTbbbB...', '...BTTTTTTTTB...', '...BTTTTTTTTB...', '...BbbbTTbbbB...', '...BbbbTTbbbB...', '...BbbbTTbbbB...', '...BBBBBBBBBB...', '................', '................'], { B: 0xa9743a, b: 0xd9a25a, T: 0x2fa69a }, 2),
  gold_bar: sprite(['................', '................', '.....YYYYYYYY...', '....YyyyyyyyYD..', '...YyyyyyyyYDD..', '..YYYYYYYYYDDD..', '..YyYYYYYYYDD...', '..YyYYYYYYYD....', '..YYYYYYYYY.....', '................', '................', '................'], { Y: 0xe6b93a, y: 0xfff1b0, D: 0xa9812a }, 2),
  fair_ticket: sprite(['................', '................', '.RRRRRRRRRRRRRR.', '.RWWWWWWWWWWWWR.', '..WRRWWRWRWRRW..', '..WRWWWRWRWRWW..', '..WRRWWRWRWRRW..', '.RWWWWWWWWWWWWR.', '.RRRRRRRRRRRRRR.', '................', '................', '................'], { R: 0xd8403a, W: 0xfff6e5 }, 2),
  ice_cream: sprite(['................', '......PPPP......', '.....PPpPPP.....', '....PPPPPPPP....', '....WWWWWWWW....', '....WWWwWWWW....', '.....TTTTTT.....', '.....TtTtTT.....', '......TTTT......', '......TtTT......', '.......TT.......', '.......TT.......'], { P: 0xe07ab0, p: 0xf7b8d6, W: 0xfff6e5, w: 0xe9dfc9, T: 0xd9a25a, t: 0xa9743a }, 2),
  hot_dog: sprite(['................', '................', '................', '...BBBBBBBBBB...', '..BbbbbbbbbbbB..', '..RRRRRRRRRRRR..', '.RRYYRRYYRRYYRR.', '..RRRRRRRRRRRR..', '..BBBBBBBBBBBB..', '...BBBBBBBBBB...', '................', '................'], { B: 0xd9a25a, b: 0xf0c98a, R: 0xb5503a, Y: 0xf2c23e }, 2),
  candy_floss: sprite(['................', '.....PPPPP......', '...PPPpPPPPP....', '..PPpPPPPpPPP...', '..PPPPPpPPPPP...', '..PpPPPPPPpPP...', '...PPPPpPPPP....', '....PPPPPPP.....', '.......W........', '.......W........', '.......W........', '.......W........'], { P: 0xf29ac0, p: 0xfad0e2, W: 0xfff6e5 }, 2),
  plush_gull: sprite(['................', '......WWWW......', '.....WWWWWW.....', '.....WKWWKW.....', '.....WWYYWW.....', '....GWWWWWWG....', '...GGWWWWWWGG...', '...GGWWWWWWGG...', '....WWWWWWWW....', '.....WWWWWW.....', '......Y..Y......', '.....YY..YY.....'], { W: 0xfff6e5, K: 0x1d1d2a, Y: 0xe98f4c, G: 0x9aa0aa }, 2),
  swag_bag: sprite(['................', '......TTTT......', '.....TtTTtT.....', '......SSSS......', '....SSSSSSSS....', '...SSsSSSSSSS...', '..SSsSSKKSSSSS..', '..SSSSKSSKSSSS..', '..SSSSSKKSSSSS..', '..SSSSKSSKSSSS..', '...SSSSKKSSSS...', '....DDDDDDDD....'], { T: 0x8f8266, t: 0xb5a888, S: 0xb5a888, s: 0xd6cbb0, K: 0x3a3a40, D: 0x6f6550 }, 2),
};
