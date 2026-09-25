/**
 * Flat 16×16 item sprites (non-block items). Shapes are fill-only ASCII art; `outline` then adds a dark rim in the
 * hue of each edge pixel, so every sprite shares the same crisp silhouette. Tools share five templates recoloured per tier.
 */
import type { ItemName } from '../../shared/ids';
import { hash, mix, Pix, shade, type Palette, type Rgb } from './pixels';
import { paintTexture } from './textures';

/** Dark rim (in the hue of the neighbouring fill) around every opaque pixel. */
function outline(p: Pix, strength = 0.42) {
  const src = p.copy(), edge: [number, number, Rgb][] = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (src.alpha(x, y)) continue;
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx > 15 || ny > 15 || !src.alpha(nx, ny)) continue;
      edge.push([x, y, shade(src.rgb(nx, ny), strength)]);
      break;
    }
  }
  for (const [x, y, c] of edge) p.set(x, y, c);
  return p;
}
const art = (rows: readonly string[], palette: Palette, ox = 0, oy = 0, rim = true) => {
  const p = new Pix().draw(rows, palette, ox, oy);
  return rim ? outline(p) : p;
};

const WOOD = { H: 0x8a6234, h: 0x5a3c1c };
/** Tool heads: W highlight, L light, M mid, D dark; handles H/h. */
const TOOLS: Record<'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword', string[]> = {
  pickaxe: [
    '................',
    '....WLLLL.......',
    '...WLLLLMMM.....',
    '.....MMMMMMD....',
    '.........HMMD...',
    '........Hh.MMD..',
    '.......Hh...MD..',
    '......Hh....MD..',
    '.....Hh.....MD..',
    '....Hh.......D..',
    '...Hh...........',
    '..Hh............',
    '.Hh.............',
    '................',
  ],
  axe: [
    '................',
    '.....WL.........',
    '....WLLLM..Hh...',
    '...WLLLMMMHh....',
    '...WLLMMMHhD....',
    '...LLMMMHhD.....',
    '....MDDHh.......',
    '......Hh........',
    '.....Hh.........',
    '....Hh..........',
    '...Hh...........',
    '..Hh............',
    '.Hh.............',
    '................',
  ],
  shovel: [
    '................',
    '...........WL...',
    '..........WLLM..',
    '.........WLLLMD.',
    '.........LLLMMD.',
    '..........LMMD..',
    '..........HDD...',
    '.........Hh.....',
    '........Hh......',
    '.......Hh.......',
    '......Hh........',
    '.....Hh.........',
    '....Hh..........',
    '...Hh...........',
    '..Hh............',
    '................',
  ],
  hoe: [
    '................',
    '......WLLMM.....',
    '.....WLLMMMD....',
    '.........HMD....',
    '........Hh......',
    '.......Hh.......',
    '......Hh........',
    '.....Hh.........',
    '....Hh..........',
    '...Hh...........',
    '..Hh............',
    '.Hh.............',
    '................',
  ],
  sword: [
    '................',
    '.............WL.',
    '............WLM.',
    '...........WLMD.',
    '..........WLMD..',
    '.........WLMD...',
    '........WLMD....',
    '.......WLMD.....',
    '..MM..WLMD......',
    '...MMWLMD.......',
    '....MLMD........',
    '....hMMM........',
    '...Hh..MM.......',
    '..Hh............',
    '.HH.............',
    '................',
  ],
};
/** Tier materials: W, L, M, D. */
const TIER: Record<'wooden' | 'stone' | 'iron' | 'diamond', [Rgb, Rgb, Rgb, Rgb]> = {
  wooden: [0xecc98c, 0xd0a868, 0xb08648, 0x8a6430],
  stone: [0xb8b8b8, 0x9a9a9a, 0x7c7c7c, 0x5c5c5c],
  iron: [0xffffff, 0xe0e0e0, 0xc2c2c2, 0x8a8a8a],
  diamond: [0xd8fffb, 0x72f2e6, 0x33cabe, 0x1f958b],
};

function blobShade(ramp: readonly Rgb[]) {
  return (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => {
    const t = 0.55 - ((x - cx) / rx) * 0.3 - ((y - cy) / ry) * 0.38 + (hash(x, y, 7) - 0.5) * 0.12;
    return ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(t * ramp.length)))]!;
  };
}
/** Lumpy shaded ellipse (coal, potatoes, eggs...). */
function blob(p: Pix, cx: number, cy: number, rx: number, ry: number, ramp: readonly Rgb[], rough = 0.25, seed = 1) {
  const paint = blobShade(ramp);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
    if (dx * dx + dy * dy + (hash(x >> 1, y >> 1, seed) - 0.5) * rough < 1) p.put(x, y, paint(x, y, cx, cy, rx, ry));
  }
  return p;
}

const IRON_RAMP = [0x7c8086, 0xa6aab0, 0xc8ccd0, 0xe4e6e8, 0xffffff];
const GOLD_RAMP = [0xb07a0c, 0xd8a418, 0xf2c83a, 0xfbe278, 0xfff6c2];
const ingot = (ramp: readonly Rgb[]) => art([
  '......WWWWWL....',
  '....WWLLLLLLM...',
  '..WLLLLLLLLMMD..',
  '..LLLLLLLLMMDD..',
  '..MMMMMMMMMDD...',
  '..DDDDDDDDDD....',
], { W: ramp[4]!, L: ramp[3]!, M: ramp[2]!, D: ramp[1]! }, 1, 5);

const meat = (raw: boolean, base: [Rgb, Rgb, Rgb, Rgb], fat: Rgb) => art([
  '.....LLLL.......',
  '...LLWLLMMM.....',
  '..LWLLMMMMMM....',
  '..LLFLMMMMMMD...',
  '..LLLFMMMFMMD...',
  '..MMMMFFFMMMD...',
  '...MMMMMMMMDDbb.',
  '....DDMMMDDD.bBb',
  '......DDDD...bb.',
], { W: raw ? mix(base[0], 0xffffff, 0.3) : base[0], L: base[0], M: base[1], D: base[2], F: fat, b: 0xe8e2d0, B: 0xfffcf0 }, 0, 4);

/** Sprite painters for every non-block item, keyed by item key. */
const SPRITES: Record<string, () => Pix> = {
  stick: () => art(['...........Hh', '..........Hh.', '.........Hh..', '........Hh...', '.......Hh....', '......Hh.....', '.....Hh......', '....Hh.......', '...Hh........', '..Hh.........', '.Hh..........'], WOOD, 1, 2),
  coal: () => outline(blob(new Pix(), 8, 8.5, 5.2, 4.6, [0x151517, 0x222226, 0x303036, 0x46464e, 0x5c5c66], 0.5, 3)),
  charcoal: () => outline(blob(new Pix(), 8, 8.5, 5.4, 4.2, [0x1e1812, 0x2c241a, 0x3c3226, 0x524636, 0x6a5c48], 0.5, 4)),
  iron_ingot: () => ingot(IRON_RAMP),
  gold_ingot: () => ingot(GOLD_RAMP),
  iron_nugget: () => outline(blob(new Pix(), 8, 9, 3.4, 2.8, IRON_RAMP, 0.4, 5)),
  diamond: () => art([
    '....WWLLLL....',
    '...WLWWLLLM...',
    '..WLLLLLLLMM..',
    '..DDDDDDDDDD..',
    '...LLLLMMMD...',
    '....LLMMMD....',
    '.....LMMD.....',
    '......MD......',
  ], { W: 0xe2fffc, L: 0x7ef0e6, M: 0x3cc8be, D: 0x1f8f88 }, 1, 4),
  clay_ball: () => outline(blob(new Pix(), 8, 8.5, 4.4, 4, [0x7e8490, 0x9298a4, 0xa6acb6, 0xbac0c8, 0xccd1d8], 0.2, 6)),
  brick: () => ingot([0x7a3020, 0x9a4030, 0xb25038, 0xc8664a, 0xda8264]),
  flint: () => art(['.....LL.....', '....LWLM....', '...LLLMMD...', '..LLMMMMD...', '..MMMMMDD...', '...MMDDD....', '....DD......'], { W: 0x8c8c90, L: 0x5e5e64, M: 0x44444a, D: 0x2e2e34 }, 2, 5),
  wheat_seeds: () => art(['...L.......', '..LM...L...', '.......LM..', '....L......', '.L..LM..L..', '.LM.....LM.', '.....L.....', '..L..LM....', '..LM.......'], { L: 0x7cb04a, M: 0x4e7a2a }, 2, 4),
  wheat: () => art([
    '.......Y.Y.....',
    '....Y.YGYGY....',
    '....YGYGYGY.Y..',
    '..Y.YGYGYGYGY..',
    '..YGYGYGYGYGY..',
    '...YGYgYgYGY...',
    '....g.gggg.....',
    '.....bBBBb.....',
    '......gggg.....',
    '.....g.gg.g....',
    '....g..gg..g...',
    '...g...g.g..g..',
  ], { Y: 0xe8c85a, G: 0xb08a24, g: 0xa89030, b: 0x7a5a1a, B: 0x9a7424 }, 0, 2),
  bread: () => art([
    '.....LLLLLL.....',
    '...LLWLLWLLLM...',
    '..LWLLWLLWLLMM..',
    '.LLLLLLLLLLLMMD.',
    '.MMMMMMMMMMMMDD.',
    '..DDDDDDDDDDDD..',
  ], { W: 0xf0d090, L: 0xc88a3c, M: 0xa86c28, D: 0x7c4c18 }, 0, 6),
  apple: () => appleSprite([0x7a0e0e, 0xa81818, 0xd02a22, 0xe84a3a, 0xff8a7a]),
  golden_apple: () => appleSprite(GOLD_RAMP),
  carrot: () => art([
    '...........g.g..',
    '..........gGgG..',
    '.........LGGg...',
    '........LLMg....',
    '.......LLMM.....',
    '......LWMM......',
    '.....LLMMD......',
    '....LLMMD.......',
    '...LMMMD........',
    '..LMMD..........',
    '..MD............',
  ], { W: 0xffc07a, L: 0xf8a038, M: 0xe07818, D: 0xa84e0c, g: 0x3f8424, G: 0x6cb63a }, 0, 2),
  potato: () => { const p = blob(new Pix(), 8, 8.5, 5, 3.8, [0x8a6a34, 0xa88448, 0xc4a060, 0xd8b878, 0xe8cc94], 0.3, 8); p.put(6, 7, 0x8a6a34); p.put(10, 9, 0x8a6a34); return outline(p); },
  baked_potato: () => { const p = blob(new Pix(), 8, 8.5, 5, 3.8, [0x7a4a18, 0x9c6424, 0xbc8034, 0xd49c48, 0xe8bc6a], 0.3, 9); for (let x = 5; x < 11; x++) p.put(x, 7 + (x & 1), 0xf8e8a0); return outline(p); },
  sugar_cane: () => outline(paintTexture('sugar_cane').copy()),
  sugar: () => art(['......WW......', '....WLWWLW....', '...WLWLLWLW...', '..LWLLWLLWLM..', '.LLMLLMLLMLMM.'], { W: 0xffffff, L: 0xeceef2, M: 0xc8ccd4 }, 1, 8),
  paper: () => art([
    '....WWWWWWWW...',
    '...WWLLLLLLWM..',
    '...WLllllllLM..',
    '..WWLLLLLLLWM..',
    '..WLllllllLMM..',
    '..WLLLLLLLLWM..',
    '.WWLllllllLM...',
    '.WLLLLLLLLWM...',
    '.MMMMMMMMMMM...',
  ], { W: 0xffffff, L: 0xf0ece0, l: 0xc8c0ac, M: 0xb0a890 }, 0, 3),
  book: () => art([
    '...CCCCCCCCC...',
    '..CcCCCCCCCCP..',
    '..CcCCGGCCCCP..',
    '..CcCCCCCCCCP..',
    '..CcCCCCCCCCP..',
    '..CcCCCCCCCCP..',
    '..CcCCCCCCCCP..',
    '..CcddddddddP..',
    '...PPPPPPPPP...',
  ], { C: 0x8a3a1e, c: 0x5e2410, G: 0xf0c83a, d: 0x6a2c14, P: 0xf4ecd8 }, 0, 3),
  melon_slice: () => art([
    '..............G.',
    '............GgG.',
    '..........GgrR..',
    '........GgrRRR..',
    '......GgrRkRRR..',
    '....GgrRRRRkR...',
    '..GgrRkRRRRR....',
    '.GgrRRRRkRR.....',
    '.GrRRRRRRR......',
    '..rRRRR.........',
  ], { G: 0x3a6e1c, g: 0x8cc24a, r: 0xf0a8a0, R: 0xe03a3a, k: 0x1a1a1a }, 0, 3),
  beef: () => steak(true, [0xe05050, 0xc02a2a, 0x8a1818, 0x5a0c0c], 0xf4d0c8),
  cooked_beef: () => steak(false, [0xa86a3c, 0x7c4420, 0x5a2e14, 0x3a1c0a], 0xc89060),
  porkchop: () => chop([0xf4a8a0, 0xe68a84, 0xc0645e, 0x8a3e3a], 0xfff0ea),
  cooked_porkchop: () => chop([0xd8a870, 0xb88048, 0x8c5a2c, 0x5e3a18], 0xf0d0a0),
  chicken: () => chickenSprite([0xfad8c8, 0xf0b8a4, 0xd89080, 0xa86a5a]),
  cooked_chicken: () => chickenSprite([0xe8b060, 0xc8883a, 0x9c6024, 0x6a3c12]),
  mutton: () => meat(true, [0xd84a4a, 0xb42e30, 0x84181c, 0x5a0c10], 0xf8e8e0),
  cooked_mutton: () => meat(false, [0xb87848, 0x8c5028, 0x643418, 0x40200c], 0xd8a878),
  rotten_flesh: () => art([
    '...LLL..LL......',
    '..LWLLLLLMM.....',
    '.LLLGGLLMMMM....',
    '.LLGGLLMMRMMD...',
    '..LLLLMMRRMMD...',
    '...MMMMMMMDD....',
    '....DD.DDDD.....',
  ], { W: 0xa8a060, L: 0x8a8a4a, M: 0x6e6a36, D: 0x4e4a24, G: 0x5a8a3a, R: 0x8a4a3a }, 1, 5),
  bone: () => art(['..........WL.', '.........WLLM', '..........LMD', '.........LM..', '........LM...', '.......LM....', '......LM.....', '.....LM......', '....LM.......', '..LLM........', '.WLLM........', '..LM.........'], { W: 0xffffff, L: 0xe8e4d4, M: 0xc4bea8, D: 0x9a947e }, 1, 2),
  bone_meal: () => art(['......W.......', '.....WLW......', '....WLLLW.....', '...WLLWLLM....', '..LLWLLLLMM...', '.LLLLLMLLLMM..'], { W: 0xffffff, L: 0xeae8f0, M: 0xc4c2cc }, 1, 8),
  string: () => art(['.......WW.....', '......W..W....', '.....W....W...', '....W.....W...', '...W...WWW....', '...W..W.......', '....WW........', '.....W........', '......W.......', '.......WWW....'], { W: 0xf4f4f4 }, 1, 3),
  feather: () => art(['...........WW.', '.........WWLLW', '........WLLLM.', '.......WLLLM..', '......WLLLM...', '.....WLLLM....', '....WLLLM.....', '...WLLMM......', '...LLMM.......', '..qMM.........', '.q............'], { W: 0xffffff, L: 0xe8eaee, M: 0xb8bcc6, q: 0x8a8a90 }, 1, 2),
  gunpowder: () => { const p = art(['......LL......', '....LLMLLM....', '...LMLLMLLM...', '..LLMLLLMLMM..', '.LMLLMLLLMLMM.'], { L: 0x7a7a7e, M: 0x505054 }, 1, 8); p.put(6, 10, 0x2a2a2e); p.put(9, 11, 0x2a2a2e); p.put(4, 12, 0x2a2a2e); return p; },
  leather: () => art(['..LLL....LLL..', '..LWLLLLLLML..', '...LLLLLLLM...', '..LLLLLLLLMM..', '..LLLLLLLLMM..', '...LLLLLLMM...', '..LLLMMMMMMD..', '..LLD....MDD..'], { W: 0xc88a50, L: 0xa86a34, M: 0x8a5024, D: 0x6a3a18 }, 1, 4),
  egg: () => outline(blob(new Pix(), 8, 8.8, 3.8, 4.8, [0xb8a078, 0xd4be94, 0xe8d6b0, 0xf4e8cc, 0xfff8e8], 0, 10)),
  arrow: () => art([
    '..........WW.',
    '.........WLLW',
    '..........LMW',
    '.........s.M.',
    '........s....',
    '.......s.....',
    '......s......',
    '.....s.......',
    '..F.s........',
    '..FFs........',
    '.FfFF........',
    '..fF.........',
  ], { W: 0xd0d0d4, L: 0x8a8a90, M: 0x5a5a60, s: 0x9a7040, F: 0xf4f4f4, f: 0xb8bcc6 }, 1, 2),
  bow: () => art([
    '......HHHH....',
    '....Hh....s...',
    '...Hh....s....',
    '..Hh....s.....',
    '..H....s......',
    '.Hh...s.......',
    '.H...s........',
    '.H..s.........',
    '.Hhs..........',
    '.Hs...........',
    '..s...........',
    '..............',
  ], { ...WOOD, s: 0xe8e8e8 }, 1, 2),
  bucket: () => bucketSprite(0x3a3a40),
  water_bucket: () => bucketSprite(0x3a6ed8),
  lava_bucket: () => { const p = bucketSprite(0xf07818); p.put(6, 7, 0xffd24a); p.put(9, 7, 0xffd24a); p.put(8, 7, 0xc84010); return p; },
  shears: () => art([
    '..........WL..',
    '.........WLM..',
    '.....WL.WLM...',
    '....WLMWLM....',
    '.....LMLM.....',
    '......MM......',
    '.....RRRR.....',
    '....RR..RR....',
    '...RR....RR...',
    '...RR....RR...',
    '....RR..RR....',
  ], { W: 0xffffff, L: 0xd8d8d8, M: 0x9a9a9a, R: 0xb83a2a }, 1, 2),
  bed: () => art([
    '..SSS...........',
    '.SSSSRRRRRRRRRR.',
    '.SSSSRRRRRRRRRR.',
    '.WWWWWWWWWWWWWW.',
    '.ww..........ww.',
    '.ww..........ww.',
  ], { S: 0xf4f0e8, R: 0xc02a26, W: 0xa87c48, w: 0x7a5a30 }, 0, 6),
  oak_door: () => art([
    '....WWWWWW....',
    '....W.WW.W....',
    '....W.WW.W....',
    '....WWWWWW....',
    '....WLWLWW....',
    '....WLWLWW....',
    '....WLWLkW....',
    '....WLWLWW....',
    '....WLWLWW....',
    '....WWWWWW....',
  ], { W: 0x9c7240, L: 0x74502a, k: 0x2a2a2e }, 1, 3),
};

function steak(raw: boolean, ramp: [Rgb, Rgb, Rgb, Rgb], fat: Rgb) {
  return art([
    '.....LLLLL......',
    '...LLWLLLMMM....',
    '..LWLFFLMMMMM...',
    '..LLFLLFMMMMMD..',
    '..LLLLMMFMMMMD..',
    '..MMMMMMFFMMDD..',
    '...MMMMMMMMDD...',
    '....DDDDDDDD....',
  ], { W: raw ? mix(ramp[0], 0xffffff, 0.3) : ramp[0], L: ramp[0], M: ramp[1], D: ramp[2], F: fat }, 0, 4);
}
function chop(ramp: [Rgb, Rgb, Rgb, Rgb], fat: Rgb) {
  return art([
    '....FFFFFF......',
    '..FFLLLLLLFF....',
    '.FLLWLLLLMMMF...',
    '.FLWLLLLMMMMF...',
    '.FLLLLMMMbbMF...',
    '..FLLMMMbBBF....',
    '...FFMMMMbF.....',
    '.....FFFFF......',
  ], { W: mix(ramp[0], 0xffffff, 0.3), L: ramp[0], M: ramp[1], D: ramp[2], F: fat, b: 0xd8d0bc, B: 0xfffcf0 }, 1, 4);
}
function appleSprite(ramp: readonly Rgb[]) {
  const p = blob(new Pix(), 8, 9.5, 5, 4.6, ramp, 0.05, 11);
  p.put(7, 5, ramp[1]!); p.put(8, 5, ramp[1]!);
  p.draw(['h..', 'hGG', '.G.'], { h: 0x5a3a18, G: 0x4e8a2a }, 8, 2);
  p.put(5, 7, ramp[4]!); p.put(5, 8, ramp[4]!);
  return outline(p);
}
function chickenSprite(ramp: [Rgb, Rgb, Rgb, Rgb]) {
  return art([
    '....LLLLL.......',
    '...LWLLLLM......',
    '..LWLLLLLMM.....',
    '..LLLLLLMMM.....',
    '..MLLLLMMMD.....',
    '...MMMMMMDDbb...',
    '....DDDDD..bBb..',
    '............bb..',
  ], { W: mix(ramp[0], 0xffffff, 0.4), L: ramp[0], M: ramp[1], D: ramp[2], b: 0xe8e2d0, B: 0xfffcf0 }, 1, 5);
}
function bucketSprite(fill: Rgb) {
  return art([
    '....hhhhhh....',
    '...h......h...',
    '..h........h..',
    '..MWWWWWWWWM..',
    '..MqqqqqqqqM..',
    '..LWLLLLLLMD..',
    '...WLLLLLMD...',
    '...LLLLLLMD...',
    '...LLLLLMMD...',
    '....LLLMMD....',
    '....MMMMDD....',
  ], { h: 0x6a6a70, W: 0xffffff, L: 0xd8d8dc, M: 0xa8a8ae, D: 0x78787e, q: fill }, 1, 3);
}

/** Small powder heap with sparkles (glowstone dust, redstone). */
const dust = (ramp: readonly Rgb[], spark: Rgb) => {
  const p = art(['.......L......', '.....LLWL.....', '....LMLLML.L..', '..L.LLMLLMLM..', '.LLMLLLMLLLMM.', 'LMLLMLLMLLMLMM'], { W: ramp[3]!, L: ramp[2]!, M: ramp[1]! }, 1, 7);
  for (const [x, y] of [[4, 5], [11, 6], [7, 3]] as const) p.put(x, y, spark);
  return p;
};
/** Armor icons: W highlight, L light, M mid, D dark; recoloured per material. */
const ARMOR: Record<'helmet' | 'chestplate' | 'leggings' | 'boots', [string[], number, number]> = {
  helmet: [['....WWWLLL....', '..WWLLLLLLLM..', '.WLLLLLLLLLLM.', '.LLLLLLLLLLMM.', '.LLMDDDDDDLMD.', '.LLD......MMD.', '.LMD......MMD.', '.MMD......MDD.'], 1, 4],
  chestplate: [['..WLL....LLM...', '.WLLLL..LLLMM..', '.LLLLLLLLLLLMD.', '.LLMLLLLLLLMMD.', '..DMLLLLLLLMD..', '...MLLLLLLMMD..', '...MLLWLLLMMD..', '...MLLLLLLMMD..', '...MLLLLLMMMD..', '...MMMMMMMMDD..'], 1, 3],
  leggings: [['..WWLLLLLLLM..', '..LLLLLLLLLMD.', '..LLLLMMLLLMD.', '..LLLM..LLLMD.', '..LLLM..LLMMD.', '..LLMD..LLMMD.', '..LLMD..LLMMD.', '..LLMD..LMMMD.', '..LMMD..LMMDD.', '..MMDD..MMDDD.'], 1, 3],
  boots: [['..WLM.....WLM..', '..LLM.....LLM..', '..LLM.....LLM..', '.LLLM....LLLM..', 'WLLLMD..WLLLMD.', 'MMMMDD..MMMMDD.'], 0, 6],
};
const ARMOR_TONES: Record<'leather' | 'golden' | 'iron' | 'diamond', [Rgb, Rgb, Rgb, Rgb]> = {
  leather: [0xd49a62, 0xa86a34, 0x8a5024, 0x5e3416], golden: [0xfff6c2, 0xf2c83a, 0xd8a418, 0xa06e0a], iron: TIER.iron, diamond: TIER.diamond,
};
for (const [material, [W, L, M, D]] of Object.entries(ARMOR_TONES)) for (const [piece, [rows, ox, oy]] of Object.entries(ARMOR)) {
  SPRITES[`${material}_${piece}`] = () => art(rows, { W, L, M, D }, ox, oy);
}
Object.assign(SPRITES, {
  glowstone_dust: () => dust([0x8a5a1a, 0xc88a2a, 0xf0c050, 0xfff0a0], 0xffffff),
  redstone: () => dust([0x5a0604, 0xa81410, 0xe8281a, 0xff8a70], 0xffd0c0),
  quartz: () => art(['......W......', '.....WL..W...', '..W..WLM.LM..', '..LM.LLM.LM..', '.WLM.LLMMLM..', '.LLMMLLMMLMD.', '.LLMMLLMMMMD.', '..MMMMMMMMD..', '...DDDDDDD...'], { W: 0xffffff, L: 0xeee8e2, M: 0xd0c6bc, D: 0xa89c90 }, 2, 4),
  gold_nugget: () => { const p = blob(new Pix(), 6.5, 9, 3, 2.5, GOLD_RAMP, 0.4, 12); blob(p, 10, 10.5, 2.4, 2, GOLD_RAMP, 0.3, 13); return outline(p); },
  nether_brick: () => ingot([0x2a1216, 0x4a2026, 0x5e2a31, 0x74363e, 0x8e4a52]),
  emerald: () => art(['.....WL.....', '....WLLM....', '...WLLLMM...', '..WLLLLMMD..', '..LLLWLMMD..', '..LLLLMMDD..', '..LLLMMMDD..', '...MMMMDD...', '....MMDD....', '.....DD.....'], { W: 0xd8ffe6, L: 0x4cdc84, M: 0x1eae56, D: 0x0f7a3a }, 2, 3),
  flint_and_steel: () => art([
    '...SSSSSS.......',
    '..SWsssssS......',
    '.SW......sS.....',
    '.Ss.......S.....',
    '.Ss.............',
    '.Ss......LL.....',
    '..SsS...LWLM....',
    '...SS..LLLMMD...',
    '.......LMMMMD...',
    '........MMDD....',
  ], { S: 0x9a9aa2, s: 0x6a6a72, W: 0xffffff, L: 0x6e6e74, M: 0x4a4a50, D: 0x2e2e34 }, 1, 3),
  repeater: () => art(['...W......W....', '..rRr....rRr...', '...R......R....', '...h......h....', 'SSSSSSSSSSSSSSS', 'LLLLLLLLLLLLLLM', 'MMMMMMMMMMMMMMD'], { W: 0xffe0d0, R: 0xe82014, r: 0xa80c06, h: 0x8a6436, S: 0xd0d0d4, L: 0xa8a8ae, M: 0x7c7c82, D: 0x5a5a60 }, 0, 6),
  iron_door: () => art(['....WWWWWW....', '....W.WW.W....', '....W.WW.W....', '....WWWWWW....', '....WLLLLW....', '....WMMMMW....', '....WLLLkW....', '....WLLLLW....', '....WMMMMW....', '....WWWWWW....'], { W: 0xd8dce0, L: 0xb4b8be, M: 0x8d9197, k: 0x3a3a40 }, 1, 3),
  lever: () => art(['..........W.....', '.........Hh.....', '........Hh......', '.......Hh.......', '......Hh........', '..CCCCCCCCCC....', '..CcCCCCcCCc....', '..cccccccccc....'], { W: 0xe8e8ec, H: 0x9c7440, h: 0x6e4f28, C: 0x8c8c92, c: 0x5e5e64 }, 1, 4),
});

const TOOL_KINDS = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword'] as const;
for (const tier of ['wooden', 'stone', 'iron', 'diamond'] as const) for (const kind of TOOL_KINDS) {
  const [W, L, M, D] = TIER[tier];
  SPRITES[`${tier}_${kind}`] = () => art(TOOLS[kind], { W, L, M, D, ...WOOD }, 0, kind === 'pickaxe' || kind === 'hoe' || kind === 'axe' ? 1 : 0);
}

/** Every non-block item key has a sprite (checked by tests). */
export const hasSprite = (key: string) => key in SPRITES;
export const SPRITE_KEYS = Object.keys(SPRITES) as ItemName[];
const cache = new Map<string, Pix>();
/** Stand-in for items without a sprite yet: a shaded, outlined gem in the key's placeholder colour. */
function placeholderSprite(key: string): Pix {
  const tile = paintTexture(key), p = new Pix();
  return p.fill((x, y) => {
    const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
    return d > 7 ? null : d > 6 ? 0x26262a : shade(tile.rgb(x, y), 1.15 - (x + y) / 40);
  });
}
/** 16×16 sprite for a non-block item key; a placeholder gem if it has no sprite yet. Cached; do not mutate. */
export function paintSprite(key: string): Pix {
  let pix = cache.get(key);
  if (!pix) cache.set(key, pix = SPRITES[key]?.() ?? placeholderSprite(key));
  return pix;
}
