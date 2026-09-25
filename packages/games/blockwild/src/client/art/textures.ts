/**
 * Every Blockwild block texture, painted as original 16×16 pixel art from seeded noise and hand-made palettes.
 * Partial shapes (torch, lantern, bed, cactus) are authored for positional UVs: a face samples the texels
 * under its block-local rectangle (±Z faces u=x, ±X faces u=z, ±Y faces u=x v=z, image top = y 1).
 */
import { ANIMATION_FRAMES, CRACK_STAGES, frameKey } from './keys';
import { clamp, hash, mix, Pix, pick, rng, seedOf, shade, tnoise, type Palette, type Rgb } from './pixels';

type Painter = (p: Pix) => void;
const floor = Math.floor;

// Palettes, dark → light.
const STONE = [0x535358, 0x606066, 0x6c6c72, 0x78787e, 0x848489, 0x919196];
const DIRT = [0x4f3523, 0x5f412b, 0x6e4d33, 0x7d5a3c, 0x8b6746, 0x997452];
const GRASS = [0x3f6e22, 0x4b7f28, 0x57902e, 0x62a035, 0x70b03e, 0x80c04a];
const SAND = [0xc8b27a, 0xd3be86, 0xdcc891, 0xe4d29c, 0xecdca8, 0xf3e6b8];
const SNOW = [0xd6e2ec, 0xe1eaf2, 0xeaf1f7, 0xf2f7fb, 0xfafcfe];
const OAK = [0x6e4f2b, 0x80603a, 0x957146, 0xa78152, 0xb68f5d, 0xc39c68];
const BIRCH = [0xa99462, 0xbba672, 0xc9b580, 0xd4c18c, 0xdecc99, 0xe8d8a8];
const SPRUCE = [0x42301c, 0x503b23, 0x5e472b, 0x6b5133, 0x785c3b, 0x856743];
const OAK_BARK = [0x3a2a18, 0x48361f, 0x564127, 0x654d2f, 0x735937];
const SPRUCE_BARK = [0x261a0f, 0x332414, 0x3f2d19, 0x4b371f, 0x574025];
const BIRCH_BARK = [0xc9c6ba, 0xd8d5ca, 0xe4e1d7, 0xefede5, 0xf8f7f2];
const COBBLE = [0x4e4e53, 0x5f5f65, 0x707076, 0x808086, 0x909096, 0xa2a2a7];
const MOSS = [0x3c5a24, 0x4a6c2a, 0x587e31, 0x67903a];
const MORTAR = 0x3c3c41;
const IRON = [0x8d9197, 0xa8adb3, 0xc0c4c9, 0xd6d9dd, 0xe8eaed, 0xf8f9fa];
const GOLD = [0xa8700c, 0xc98f16, 0xe4ad22, 0xf4c93a, 0xfbe06a, 0xfff3b0];
const DIAMOND = [0x1b7f7a, 0x27a8a0, 0x3dcac1, 0x68e3da, 0xa4f3ec, 0xe2fffc];

const grain = (p: Pix, ramp: readonly Rgb[], seed: number, cell = 4, low = 0.55) =>
  p.fill((x, y) => pick(ramp, low * tnoise(x, y, seed, cell) + (1 - low) * hash(x, y, seed + 1)));

/** Tileable Voronoi: nearest/second distances and the offset to the nearest point. */
function voronoi(points: readonly [number, number][], x: number, y: number) {
  let d1 = 99, d2 = 99, index = 0, ox = 0, oy = 0;
  points.forEach(([px, py], i) => {
    let dx = x - px, dy = y - py;
    dx -= 16 * Math.round(dx / 16);
    dy -= 16 * Math.round(dy / 16);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < d1) { d2 = d1; d1 = d; index = i; ox = dx; oy = dy; } else if (d < d2) d2 = d;
  });
  return { d1, d2, index, ox, oy };
}
const jitterGrid = (n: number, seed: number, jitter = 0.8) => {
  const r = rng(seed), size = 16 / n, points: [number, number][] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) points.push([(i + 0.5 + (r() - 0.5) * jitter) * size, (j + 0.5 + (r() - 0.5) * jitter) * size]);
  return points;
};

function stone(p: Pix, seed = 7) {
  grain(p, STONE, seed, 4, 0.6);
  const r = rng(seed + 3);
  for (let i = 0; i < 8; i++) {
    const x = floor(r() * 16), y = floor(r() * 16), len = 1 + floor(r() * 3), light = r() < 0.35;
    for (let k = 0; k < len; k++) {
      p.set(x + k, y, light ? STONE[5]! : STONE[0]!);
      p.set(x + k, y + (light ? 1 : -1), light ? STONE[3]! : STONE[2]!);
    }
  }
}

function cobble(p: Pix, ramp = COBBLE, seed = 21, moss = false) {
  const points = jitterGrid(3, seed, 0.9), r = rng(seed), tones = points.map(() => 0.3 + r() * 0.45);
  p.fill((x, y) => {
    const v = voronoi(points, x + 0.5, y + 0.5);
    if (v.d2 - v.d1 < 1.1) return MORTAR;
    const light = -(v.ox * 0.6 + v.oy) / 6, edge = v.d2 - v.d1 < 2.2 ? -0.18 : 0;
    const t = tones[v.index]! + light * 0.35 + edge + (hash(x, y, seed) - 0.5) * 0.18;
    return pick(ramp, t);
  });
  if (moss) p.map((c, x, y) => {
    const m = tnoise(x, y, seed + 9, 4) * 0.75 + hash(x, y, seed + 5) * 0.25;
    return m > 0.6 ? pick(MOSS, (m - 0.6) * 3 + (c === MORTAR ? 0 : 0.3)) : c;
  });
}

function dirt(p: Pix, ramp = DIRT, seed = 31) {
  grain(p, ramp, seed, 4, 0.5);
  const r = rng(seed);
  for (let i = 0; i < 10; i++) {
    const x = floor(r() * 16), y = floor(r() * 16), kind = r();
    if (kind < 0.35) { p.set(x, y, ramp[5]!); p.set(x + 1, y, ramp[4]!); p.set(x, y + 1, ramp[1]!); }
    else if (kind < 0.7) p.set(x, y, ramp[0]!);
    else { p.set(x, y, 0x8a8078); p.set(x + 1, y + 1, 0x5e5650); }
  }
}

/** Grass blades: short light strokes with a shadow tip under them. */
function blades(p: Pix, ramp: readonly Rgb[], seed: number, count: number, y0 = 0, y1 = 16) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = floor(r() * 16), y = y0 + floor(r() * (y1 - y0)), tall = r() < 0.5;
    p.set(x, y, ramp[ramp.length - 1]!);
    if (tall) p.set(x, y - 1, ramp[ramp.length - 2]!);
    p.set(x, y + 1, ramp[1]!);
  }
}
function grassTop(p: Pix) {
  grain(p, GRASS, 41, 4, 0.55);
  blades(p, GRASS, 42, 34);
}
/** Dirt side with a ragged cap (grass or snow) that drips over the edge. */
function cappedSide(p: Pix, cap: readonly Rgb[], seed: number, depth: number, grassy: boolean) {
  dirt(p, DIRT, seed);
  const r = rng(seed + 1);
  for (let x = 0; x < 16; x++) {
    const n = tnoise(x, 0, seed + 2, 2);
    let h = depth + floor(n * 2.2) - (r() < 0.2 ? 1 : 0);
    if (r() < 0.14) h += 2;
    for (let y = 0; y < h; y++) {
      const t = 0.75 - y / (h + 2) * 0.55 + (hash(x, y, seed + 3) - 0.5) * 0.35;
      p.set(x, y, pick(cap, t));
    }
    p.set(x, h - 1, cap[grassy ? 1 : 0]!);
    p.set(x, h, mix(p.rgb(x, h), 0x2a1a0e, 0.35));
  }
  if (grassy) for (let i = 0; i < 6; i++) { const x = floor(r() * 16); p.set(x, 0, cap[cap.length - 1]!); }
}

function planks(p: Pix, ramp: readonly Rgb[], seed: number) {
  const r = rng(seed);
  for (let board = 0; board < 4; board++) {
    const y0 = board * 4, joint = (board * 7 + floor(r() * 5) + 3) % 16, tone = (r() - 0.5) * 0.2;
    for (let y = y0; y < y0 + 4; y++) for (let x = 0; x < 16; x++) {
      if (y === y0 + 3) { p.set(x, y, ramp[0]!); continue; }
      const streak = tnoise(x, y * 4 + board * 4, seed + board, 8, 16) - 0.5;
      let t = 0.5 + tone + streak * 0.55 + (hash(x, y, seed) - 0.5) * 0.12 + (y === y0 ? 0.12 : 0);
      if (hash(x >> 2, y, seed + 7) < 0.12) t -= 0.25;
      p.set(x, y, pick(ramp.slice(1), t));
    }
    for (let y = y0; y < y0 + 3; y++) { p.set(joint, y, ramp[0]!); p.set(joint + 1, y, ramp[4]!); }
  }
}

function bark(p: Pix, ramp: readonly Rgb[], seed: number) {
  p.fill((x, y) => {
    const ridge = tnoise(x, y, seed, 2, 16), fine = tnoise(x, y, seed + 1, 1, 4);
    return pick(ramp, ridge * 0.6 + fine * 0.3 + hash(x, y, seed + 2) * 0.15);
  });
  const r = rng(seed + 5);
  for (let i = 0; i < 6; i++) {
    const x = floor(r() * 16), y = floor(r() * 16), len = 3 + floor(r() * 6);
    for (let k = 0; k < len; k++) p.set(x, y + k, ramp[0]!);
    p.set(x + 1, y, ramp[ramp.length - 1]!);
  }
}
function birchBark(p: Pix) {
  grain(p, BIRCH_BARK, 61, 4, 0.5);
  const r = rng(62);
  for (let i = 0; i < 7; i++) {
    const x = floor(r() * 16), y = floor(r() * 16), len = 2 + floor(r() * 4);
    for (let k = 0; k < len; k++) { p.set(x + k, y, k === 0 || k === len - 1 ? 0x5a5752 : 0x2e2c29); if (r() < 0.4) p.set(x + k, y + 1, 0x6e6a63); }
  }
  for (let i = 0; i < 10; i++) p.set(floor(r() * 16), floor(r() * 16), 0x9d998f);
}
function logTop(p: Pix, wood: readonly Rgb[], rim: readonly Rgb[], seed: number) {
  p.fill((x, y) => {
    const dx = x - 7.5, dy = y - 7.5, d = Math.max(Math.abs(dx), Math.abs(dy)) * 0.55 + Math.sqrt(dx * dx + dy * dy) * 0.45;
    if (x === 0 || y === 0 || x === 15 || y === 15) return pick(rim, hash(x, y, seed) * 0.8 + 0.1);
    const ring = floor(d / 1.55 + tnoise(x, y, seed, 4) * 0.7);
    const t = (ring % 2 ? 0.35 : 0.72) + (hash(x, y, seed + 1) - 0.5) * 0.2 - (d < 1.2 ? 0.25 : 0);
    return pick(wood, t);
  });
}

/** Leaves: clumps of shaded foliage with see-through gaps between them (plus a few pinholes), sunlit rims on top. */
function leaves(p: Pix, ramp: readonly Rgb[], seed: number, holes: number) {
  p.fill((x, y) => {
    const clump = tnoise(x, y, seed, 2), gap = hash(x, y, seed + 1);
    if (clump < 0.55 && gap < holes || gap < 0.06) return null;
    return pick(ramp, clump * 0.55 + tnoise(x, y, seed + 2, 4) * 0.25 + gap * 0.3);
  });
  const light = shade(ramp[ramp.length - 1]!, 1.18);
  p.map((c, x, y) => {
    if (!p.alpha(x - 1, y - 1) || !p.alpha(x, y - 1)) return mix(c, light, 0.55);
    if (!p.alpha(x + 1, y + 1) || !p.alpha(x, y + 1)) return mix(c, ramp[0]!, 0.45);
    return hash(x, y, seed + 3) < 0.07 ? mix(c, light, 0.4) : c;
  });
}

/** Stamp ore fleck clusters with lit top-left, dark rim and a shadow in the host rock (stone unless given). */
function ore(p: Pix, ramp: readonly Rgb[], seed: number, clusters: number, rim: Rgb, host: Painter = stone, shadow = STONE[0]!) {
  host(p);
  const shapes = [['.xx.', 'xxxx', '.xx.'], ['xx.', 'xxx', '.xx'], ['.xx', 'xxx', 'xx.'], ['xxx', 'xxx'], ['.x.', 'xxx', 'xx.'], ['xx..', 'xxxx', '..x.']];
  const r = rng(seed), placed: [number, number][] = [];
  for (let tries = 0; placed.length < clusters && tries < 200; tries++) {
    const x = floor(r() * 16), y = floor(r() * 16);
    if (placed.some(([px, py]) => { const dx = Math.abs(px - x), dy = Math.abs(py - y); return Math.min(dx, 16 - dx) < 5 && Math.min(dy, 16 - dy) < 5; })) continue;
    placed.push([x, y]);
    const shape = shapes[floor(r() * shapes.length)]!;
    shape.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch !== 'x') return;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]] as const) p.set(x + i + dx, y + j + dy, shade(shadow, dx + dy > 0 ? 0.7 : 0.9));
    }));
    shape.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch !== 'x') return;
      const light = 1 - (i + j) / (row.length + shape.length - 2);
      p.set(x + i, y + j, pick(ramp, light * 0.8 + hash(x + i, y + j, seed) * 0.3));
    }));
    p.set(x + shape[0]!.indexOf('x'), y, ramp[ramp.length - 1]!);
    const last = shape[shape.length - 1]!;
    p.set(x + last.lastIndexOf('x'), y + shape.length - 1, rim);
  }
}

/** Metal/gem storage block: beveled frame, brushed face. */
function metalBlock(p: Pix, ramp: readonly Rgb[], seed: number, gem = false) {
  p.fill((x, y) => {
    const band = tnoise(x, y, seed, 16, 2);
    let t = 0.45 + band * 0.25 + (hash(x, y, seed) - 0.5) * 0.08;
    if (gem) { const d = (Math.abs(x - 7.5) + Math.abs(y - 7.5)) % 8; t = 0.35 + (d < 4 ? d / 4 : (8 - d) / 4) * 0.45 + band * 0.1; }
    return pick(ramp, t);
  });
  for (let i = 0; i < 16; i++) {
    p.set(i, 0, ramp[ramp.length - 1]!); p.set(0, i, ramp[ramp.length - 2]!);
    p.set(i, 15, ramp[0]!); p.set(15, i, ramp[1]!);
  }
  p.set(0, 15, ramp[1]!); p.set(15, 0, ramp[2]!);
  for (const [x, y] of [[2, 2], [3, 2], [2, 3]] as const) p.set(x, y, ramp[ramp.length - 1]!);
  for (const [x, y] of [[13, 13], [12, 13], [13, 12]] as const) p.set(x, y, ramp[1]!);
}

function wool(p: Pix, base: Rgb) {
  const ramp = [shade(base, 0.8), shade(base, 0.88), shade(base, 0.95), base, shade(base, 1.06), shade(base, 1.12)];
  p.fill((x, y) => {
    const knit = (((x >> 1) + (y >> 1)) & 1 ? 0.14 : -0.1) + ((x + y) & 1 ? 0.06 : -0.06);
    return pick(ramp, 0.5 + knit + (tnoise(x, y, 81, 4) - 0.5) * 0.4 + (hash(x, y, 82) - 0.5) * 0.45);
  });
}

const RED_BRICK = [0x7c3326, 0x8e3d2d, 0x9d4735, 0xab523e, 0xb85e48], RED_MORTAR = [0x9c9388, 0xb1a89c, 0xc2baae];
function bricks(p: Pix, RED = RED_BRICK, MORT = RED_MORTAR, seed = 91) {
  const r = rng(seed);
  const tones = Array.from({ length: 16 }, () => r() * 0.5 + 0.2);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = y >> 2, local = y & 3, bx = (x + (row & 1 ? 4 : 0)) & 15, id = row * 2 + (((x + (row & 1 ? 4 : 0)) & 15) >> 3);
    if (local === 3 || (bx & 7) === 7) { p.set(x, y, pick(MORT, hash(x, y, seed + 1))); continue; }
    const t = tones[id]! + (local === 0 ? 0.2 : local === 2 ? -0.12 : 0) + (hash(x, y, seed + 2) - 0.5) * 0.25;
    p.set(x, y, pick(RED, t));
  }
}
function stoneBricks(p: Pix, mossy = false) {
  grain(p, STONE, 101, 4, 0.5);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const course = y >> 3, local = y & 7, lx = (x + (course ? 8 : 0)) & 15;
    if (local === 7 || lx === 15) p.set(x, y, MORTAR);
    else if (local === 0 || lx === 0) p.set(x, y, STONE[5]!);
    else if (local === 6 || lx === 14) p.set(x, y, STONE[1]!);
  }
  p.set(4, 3, STONE[0]!); p.set(5, 4, STONE[0]!); p.set(5, 3, STONE[4]!); p.set(11, 11, STONE[0]!); p.set(12, 11, STONE[0]!);
  if (mossy) p.map((c, x, y) => tnoise(x, y, 103, 4) > 0.6 ? pick(MOSS, hash(x, y, 104)) : c);
}

function sandstone(p: Pix, part: 'side' | 'top' | 'bottom') {
  grain(p, SAND, 111, 4, 0.6);
  if (part === 'top') return;
  if (part === 'bottom') { for (let i = 0; i < 6; i++) p.set(floor(hash(i, 1, 112) * 16), floor(hash(i, 2, 112) * 16), SAND[0]!); return; }
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 3; y++) p.set(x, y, pick(SAND, 0.65 + hash(x, y, 113) * 0.35));
    p.set(x, 3, SAND[0]!);
    p.set(x, 11, SAND[1]!);
    p.set(x, 12, SAND[0]!);
    p.set(x, 14, pick(SAND, 0.2 + hash(x, 14, 114) * 0.3));
    p.set(x, 15, SAND[0]!);
  }
}

function gravel(p: Pix) {
  const points = jitterGrid(5, 121, 1), r = rng(122);
  const colors = points.map(() => pick([0x6a6460, 0x7d7671, 0x8c8580, 0x9b958f, 0x7a6f63, 0xa8a29c, 0x5c5652], r()));
  p.fill((x, y) => {
    const v = voronoi(points, x + 0.5, y + 0.5);
    if (v.d2 - v.d1 < 0.9) return 0x4a4542;
    const light = -(v.ox + v.oy) / 3;
    return shade(colors[v.index]!, 1 + light * 0.18 + (hash(x, y, 123) - 0.5) * 0.1);
  });
}

/** Soft drifts with cool shadows and a few bright sparkles. */
function snow(p: Pix) {
  const COOL = [0xc4d2e2, 0xd2deea, 0xdfe8f2, 0xebf1f8, 0xf5f8fc, 0xffffff];
  p.fill((x, y) => pick(COOL, 0.35 + tnoise(x, y, 45, 8, 4) * 0.45 + (hash(x, y, 46) - 0.5) * 0.25));
  const r = rng(47);
  for (let i = 0; i < 6; i++) { const x = floor(r() * 16), y = floor(r() * 16); p.set(x, y, 0xffffff); p.set(x + 1, y + 1, COOL[1]!); }
}
/** Blue-grey clay: smooth mottling, faint sediment bands and a few pebbles. */
function clay(p: Pix) {
  const CLAY = [0x7f8592, 0x8a909c, 0x949aa6, 0x9ea4af, 0xa8aeb8, 0xb4b9c2];
  p.fill((x, y) => pick(CLAY, 0.3 + tnoise(x, y, 55, 8) * 0.4 + tnoise(x, y, 56, 16, 4) * 0.2 + (hash(x, y, 57) - 0.5) * 0.18));
  const r = rng(58);
  for (let i = 0; i < 5; i++) { const x = floor(r() * 16), y = floor(r() * 16); p.set(x, y, CLAY[0]!); p.set(x + 1, y, CLAY[5]!); }
}
/** Fired clay: warm mottled orange-brown with darker specks. */
function terracotta(p: Pix) {
  const FIRED = [0x7a4230, 0x844a33, 0x8f533a, 0x985b40, 0xa06346, 0xa96c4e];
  p.fill((x, y) => pick(FIRED, 0.25 + tnoise(x, y, 59, 4) * 0.45 + (hash(x, y, 60) - 0.5) * 0.3));
  const r = rng(61);
  for (let i = 0; i < 7; i++) p.set(floor(r() * 16), floor(r() * 16), i % 3 ? FIRED[0]! : FIRED[5]!);
}

function farmland(p: Pix, moist: boolean) {
  const ramp = moist ? [0x2c1c10, 0x362315, 0x40291a, 0x4b311f, 0x573a25] : [0x4a3220, 0x5a3e28, 0x694931, 0x78553a, 0x876244];
  p.fill((x, y) => {
    const furrow = y % 4, t = (furrow === 0 ? 0.1 : furrow === 1 ? 0.75 : 0.5) + (hash(x, y, 131) - 0.5) * 0.35 + (tnoise(x, y, 132, 4) - 0.5) * 0.3;
    return pick(ramp, t);
  });
}

function glass(p: Pix) {
  const FRAME = [0x9fc4cf, 0xc4e2ea, 0xe9f7fb];
  for (let i = 0; i < 16; i++) {
    p.set(i, 0, FRAME[2]!); p.set(0, i, FRAME[2]!);
    p.set(i, 15, FRAME[0]!); p.set(15, i, FRAME[0]!);
  }
  p.set(15, 0, FRAME[1]!); p.set(0, 15, FRAME[1]!);
  for (const [x, y] of [[3, 4], [4, 3], [5, 2], [3, 6], [4, 5], [5, 4], [6, 3], [10, 12], [11, 11], [12, 10]] as const) p.set(x, y, FRAME[2]!);
}

function ice(p: Pix) {
  const ramp = [0x7ea7e2, 0x8cb3ea, 0x9bbfef, 0xacccf3, 0xbed8f6];
  p.fill((x, y) => pick(ramp, tnoise(x, y, 141, 8) * 0.6 + hash(x, y, 142) * 0.25 + ((x + y) % 7 === 0 ? 0.3 : 0)), 210);
  const r = rng(143);
  for (let i = 0; i < 4; i++) {
    let x = floor(r() * 16), y = floor(r() * 16);
    for (let k = 0; k < 5; k++) { p.set(x, y, 0xe8f3ff, 225); x += r() < 0.5 ? 1 : 0; y += 1; }
  }
}

function water(p: Pix, frame: number, frames: number) {
  const ramp = [0x2a5cc0, 0x3064ca, 0x376dd2, 0x3f77da, 0x4a83e1, 0x5d93e8], t = frame / frames;
  p.fill((x, y) => {
    const swell = tnoise(x + 16 * t, y + 16 * t, 151, 8, 4), ripple = tnoise(x - 16 * t, y, 152, 4, 2), fine = tnoise(x, y - 16 * t, 153, 2, 4);
    const v = swell * 0.45 + ripple * 0.35 + fine * 0.2;
    return v > 0.7 ? mix(ramp[5]!, 0xa8c8f4, (v - 0.7) * 2.5) : pick(ramp, (v - 0.2) * 1.8);
  }, 190);
}

function bedrock(p: Pix) {
  const ramp = [0x1e1e1e, 0x333333, 0x4a4a4a, 0x626262, 0x7c7c7c, 0x969696];
  p.fill((x, y) => pick(ramp, hash(x >> 1, y >> 1, 161) * 0.55 + hash(x, y, 162) * 0.3 + tnoise(x, y, 163, 4) * 0.25));
}
function obsidian(p: Pix) {
  const ramp = [0x0c0814, 0x150e21, 0x1e142e, 0x2a1d40, 0x3b2958];
  p.fill((x, y) => {
    const streak = tnoise(x + y, y, 171, 4) > 0.7 ? 0.35 : 0;
    return pick(ramp, tnoise(x, y, 172, 4) * 0.5 + hash(x, y, 173) * 0.3 + streak);
  });
  for (const [x, y] of [[3, 3], [11, 6], [6, 12], [13, 13]] as const) p.set(x, y, 0x6a4a9a);
}

function craftingTop(p: Pix) {
  planks(p, OAK, 201);
  const DARK = OAK[0]!, EDGE = shade(OAK[0]!, 0.75);
  for (let i = 0; i < 16; i++) { p.set(i, 0, EDGE); p.set(0, i, EDGE); p.set(i, 15, EDGE); p.set(15, i, EDGE); p.set(i, 1, OAK[4]!); p.set(1, i, OAK[4]!); }
  for (let i = 2; i < 15; i++) { p.set(i, 5, DARK); p.set(i, 10, DARK); p.set(5, i, DARK); p.set(10, i, DARK); }
  for (const x of [1, 14]) for (const y of [1, 14]) p.set(x, y, 0x9aa0a6);
}
/** Crafting table side: tool-hung planks under a thick top rim. */
function craftingSide(p: Pix, front: boolean) {
  planks(p, OAK, front ? 211 : 212);
  const EDGE = shade(OAK[0]!, 0.75);
  for (let x = 0; x < 16; x++) { p.set(x, 0, OAK[5]!); p.set(x, 1, OAK[3]!); p.set(x, 2, OAK[2]!); p.set(x, 3, EDGE); }
  for (let y = 4; y < 16; y++) { p.set(0, y, EDGE); p.set(15, y, EDGE); }
  const tools = front
    ? ['.ooooooo......', 'oWWMMMMMo..oo.', 'oo.oHo.oo.oWo.', '....Ho....oMo.', '....ho....oMo.', '....ho....oko.', '....ho....oHo.', '....ho....oHo.', '....ho....oho.', '.....o.....o..']
    : ['.ooooo....ooo.', 'oWWWMMo..oHHho', '.ooHoo...oHooo', '...Ho....oWMo.', '...Ho....oWMMo', '...ho....oWMo.', '...ho....oWMMo', '...ho....oWMo.', '...ho....oWMMo', '....o.....oo..'];
  p.draw(tools, { o: 0x2e2e32, W: 0xdfe3e6, M: 0x9ca2a8, H: 0x9a7040, h: 0x6b4a26, k: 0x5a5a60 }, 1, 5);
}

function furnaceTop(p: Pix) {
  grain(p, STONE.slice(1), 221, 4, 0.5);
  for (let i = 0; i < 16; i++) { p.set(i, 0, STONE[5]!); p.set(0, i, STONE[5]!); p.set(i, 15, STONE[0]!); p.set(15, i, STONE[0]!); }
}
function furnaceSide(p: Pix) {
  furnaceTop(p);
  for (let x = 1; x < 15; x++) { p.set(x, 4, STONE[0]!); p.set(x, 5, STONE[5]!); }
}
function furnaceFront(p: Pix, lit: boolean) {
  furnaceTop(p);
  for (let x = 3; x < 13; x++) for (let y = 3; y < 7; y++) p.set(x, y, y === 3 || y === 6 ? STONE[1]! : (y === 4 ? STONE[0]! : STONE[1]!));
  for (let x = 4; x < 12; x += 2) { p.set(x, 4, lit ? 0xffa235 : 0x2a2a2e); p.set(x, 5, lit ? 0xd9661c : 0x1c1c20); }
  for (let x = 3; x < 13; x++) { p.set(x, 8, STONE[5]!); p.set(x, 14, STONE[0]!); }
  for (let y = 8; y < 15; y++) { p.set(3, y, STONE[5]!); p.set(12, y, STONE[0]!); }
  const FIRE = [0x7a1e05, 0xc4410c, 0xf07a18, 0xffb43a, 0xffe08a, 0xfff6d0];
  for (let y = 9; y < 14; y++) for (let x = 4; x < 12; x++) {
    if (!lit) { p.set(x, y, y === 9 ? 0x121214 : mix(0x1a1a1e, 0x2e2e33, (y - 9) / 5)); continue; }
    const flame = (13 - y) / 4 - Math.abs(x - 7.5) / 5 + hash(x, y, 223) * 0.45;
    p.set(x, y, pick(FIRE, flame * 0.9 + 0.1));
  }
  if (!lit) for (const x of [5, 7, 9]) p.set(x, 13, 0x3a2a1e);
}

function chest(p: Pix, part: 'top' | 'side' | 'front') {
  const WOOD = [0x5a3a1a, 0x734c24, 0x8a5e2f, 0x9c6d38, 0xab7b42, 0xb98a4d];
  planks(p, WOOD, part === 'top' ? 231 : 232);
  const EDGE = 0x3a2410;
  for (let i = 0; i < 16; i++) { p.set(i, 0, EDGE); p.set(0, i, EDGE); p.set(i, 15, EDGE); p.set(15, i, EDGE); }
  if (part === 'top') return;
  for (let x = 1; x < 15; x++) { p.set(x, 5, EDGE); p.set(x, 4, WOOD[1]!); p.set(x, 6, WOOD[5]!); }
  if (part === 'front') p.draw(['oWWo', 'oMMo', 'oMDo', 'oDDo', '.oo.'], { o: 0x26262b, W: 0xeef0f2, M: 0xb7bcc2, D: 0x7c8187 }, 6, 3);
}

function bookshelf(p: Pix) {
  planks(p, OAK, 241);
  const BOOKS = [0x9b2f2a, 0x2f4f9b, 0x3b7a36, 0x7a4a1e, 0x6b3a8a, 0xb8964a, 0x2a6e6e, 0xa04a1a], r = rng(242);
  const shelf = (y0: number) => {
    let x = 1;
    while (x < 15) {
      const w = Math.min(15 - x, 1 + floor(r() * 3)), top = y0 + (r() < 0.35 ? 1 + floor(r() * 2) : 0), color = BOOKS[floor(r() * BOOKS.length)]!;
      for (let bx = x; bx < x + w; bx++) for (let y = y0; y < y0 + 5; y++) {
        if (y < top) { p.set(bx, y, 0x2a1c10); continue; }
        const c = bx === x ? shade(color, 1.25) : bx === x + w - 1 && w > 1 ? shade(color, 0.72) : color;
        p.set(bx, y, y === top + 1 || y === y0 + 3 ? shade(c, 1.35) : c);
      }
      x += w;
    }
  };
  shelf(2);
  shelf(9);
  for (let x = 0; x < 16; x++) { p.set(x, 7, OAK[4]!); p.set(x, 8, OAK[0]!); p.set(x, 0, OAK[5]!); p.set(x, 1, OAK[1]!); p.set(x, 14, OAK[4]!); p.set(x, 15, OAK[0]!); }
  for (let y = 2; y < 14; y++) { if (y === 7 || y === 8) continue; p.set(0, y, OAK[1]!); p.set(15, y, OAK[0]!); }
}

function hay(p: Pix, top: boolean) {
  const STRAW = [0x8a6a14, 0xa88418, 0xc49e22, 0xd8b632, 0xe8ca4a, 0xf2da6c], BAND = [0x5e3a16, 0x7a4c1e];
  if (top) {
    p.fill((x, y) => pick(STRAW, hash(x, y, 251) * 0.7 + tnoise(x, y, 252, 4) * 0.35));
    for (let i = 0; i < 16; i++) { p.set(i, 0, BAND[1]!); p.set(i, 15, BAND[0]!); p.set(0, i, BAND[1]!); p.set(15, i, BAND[0]!); }
    return;
  }
  p.fill((x, y) => pick(STRAW, tnoise(x, y, 253, 1, 8) * 0.6 + hash(x, y, 254) * 0.35));
  for (let x = 0; x < 16; x++) for (const y of [2, 3, 12, 13]) p.set(x, y, pick(BAND, (y === 2 || y === 12 ? 0.8 : 0.2)));
}

const PUMPKIN = [0x9a4c08, 0xb65c0c, 0xcc6c12, 0xdd7c1a, 0xea8e28, 0xf4a23e];
function pumpkinSide(p: Pix) {
  p.fill((x, y) => {
    const rib = (x + 2) % 5, groove = rib === 0, t = groove ? 0.08 : 0.35 + (rib === 2 ? 0.3 : rib === 3 ? 0.2 : 0.05) + (hash(x, y, 261) - 0.5) * 0.2;
    return pick(PUMPKIN, t - (y === 0 || y === 15 ? 0.2 : 0));
  });
}
function pumpkinTop(p: Pix) {
  p.fill((x, y) => {
    const dx = x - 7.5, dy = y - 7.5, ang = Math.abs(dx) > Math.abs(dy) ? dy / (Math.abs(dx) + 0.01) : dx / (Math.abs(dy) + 0.01);
    return pick(PUMPKIN, 0.5 + Math.abs(ang) * 0.25 - Math.max(Math.abs(dx), Math.abs(dy)) / 30 + (hash(x, y, 262) - 0.5) * 0.2);
  });
  p.draw(['.oo.', 'oGGo', 'oGgo', '.oo.'], { o: 0x3c3010, G: 0x6b7a22, g: 0x4e5a18 }, 6, 6);
}
function carvedFace(p: Pix, lit: boolean) {
  pumpkinSide(p);
  const IN = lit ? 0xffd24a : 0x3a1c04, CORE = lit ? 0xfff2a8 : 0x2a1403, RIM = lit ? 0xd97a14 : 0x5c2e06;
  p.draw([
    '...R........R...',
    '..RIR......RIR..',
    '.RICIR....RICIR.',
    'RIIIIIR..RIIIIIR',
    '.......RR.......',
    '.......II.......',
    '................',
    'RR............RR',
    'RIRRRRRRRRRRRRIR',
    'RICCICCIICCICCIR',
    '.RIICIIRRIICIIR.',
    '..RRIRR..RRIRR..',
  ], { R: RIM, I: IN, C: CORE }, 0, 2);
}

function melon(p: Pix, top: boolean) {
  const GREEN = [0x355a14, 0x42701a, 0x508422, 0x5f982c, 0x70ac38, 0x86c24c];
  if (top) {
    p.fill((x, y) => { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); return pick(GREEN, (floor(d) % 3 === 0 ? 0.25 : 0.65) + (hash(x, y, 271) - 0.5) * 0.3); });
    p.rect(7, 7, 2, 2, 0x5a4a1a);
    return;
  }
  p.fill((x, y) => pick(GREEN, ((x >> 1) % 3 === 0 ? 0.15 : 0.6) + tnoise(x, y, 272, 2, 8) * 0.3 + (hash(x, y, 273) - 0.5) * 0.15));
}

const CACTUS = [0x1f4a16, 0x28601b, 0x327420, 0x3d8828, 0x4c9c32, 0x62b242];
function cactus(p: Pix, part: 'side' | 'top' | 'bottom') {
  if (part !== 'side') {
    p.fill((x, y) => {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 7 || d < 1) return null;
      return pick(CACTUS, (d > 6 ? 0.2 : floor(d) % 2 ? 0.55 : 0.75) - (part === 'bottom' ? 0.2 : 0) + (hash(x, y, 281) - 0.5) * 0.15);
    });
    if (part === 'top') p.rect(7, 7, 2, 2, CACTUS[3]!);
    return;
  }
  p.fill((x, y) => {
    if (x === 0 || x === 15) return null;
    const rib = x % 4, t = rib === 1 ? 0.15 : rib === 2 ? 0.75 : 0.5;
    return pick(CACTUS, t + (hash(x, y, 282) - 0.5) * 0.2);
  });
  const r = rng(283);
  for (let i = 0; i < 12; i++) {
    const x = [1, 5, 9, 13][i % 4]!, y = floor(r() * 16);
    p.set(x, y, 0xe8e2a6);
    p.set(x, y + 1, CACTUS[0]!);
    if (r() < 0.5) { p.set(x === 1 ? 0 : x === 13 ? 15 : x, y, 0xd4cc8a); }
  }
}

// ---------- plants and small props (cutout, transparent background) ----------

function shortGrass(p: Pix, ramp = GRASS, seed = 301, count = 13, minH = 6, maxH = 14) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const base = 1 + floor(r() * 14), height = minH + floor(r() * (maxH - minH)), lean = (r() - 0.5) * 0.7;
    for (let k = 0; k < height; k++) {
      const x = Math.round(base + lean * k * k / height), y = 15 - k, t = 0.1 + (k / height) * 0.85;
      p.put(x, y, pick(ramp, t + (hash(x, y, seed) - 0.5) * 0.15));
    }
  }
}

const STEM = { g: 0x3d7a22, G: 0x5a9e32, d: 0x2a5a18 };
const FLOWERS: Record<string, { rows: string[]; palette: Palette }> = {
  dandelion: {
    rows: ['......yYy.......', '.....yYWYy......', '.....YWOWY......', '.....yYOYy......', '......yYy.......', '.......g........', '.......g..Gg....', '..gG...g.Gg.....', '...gGg.gGg......', '.....ggg........', '.......g........', '.......d........'],
    palette: { y: 0xe0a800, Y: 0xffd21e, W: 0xfff08a, O: 0xd88a00, ...STEM },
  },
  poppy: {
    rows: ['.....rR.Rr......', '....rRRRRRr.....', '....RRkkRRR.....', '....rRkkRRr.....', '.....rRRRr......', '......rgr.......', '.......g........', '...Gg..g........', '....gG.g..gG....', '......gg.Gg.....', '.......gg.......', '.......d........'],
    palette: { r: 0x9e1414, R: 0xde2a1e, k: 0x2a1410, ...STEM },
  },
  cornflower: {
    rows: ['......b.b.......', '....b.BBB.b.....', '.....BLwLB......', '....BBwnwBB.....', '.....BLwLB......', '....b.BBB.b.....', '......bgb.......', '.......g........', '..g....g..g.....', '...gG..g.Gg.....', '....gG.gGg......', '......gg........'],
    palette: { b: 0x2a3e9e, B: 0x4262d8, L: 0x7a98ff, w: 0xb8c8ff, n: 0x1a1a4a, ...STEM },
  },
};
function flower(p: Pix, name: string) {
  const f = FLOWERS[name]!;
  p.draw(f.rows, f.palette, 0, 4);
}

function fern(p: Pix) {
  const RAMP = [0x2a5a1c, 0x356c22, 0x40802a, 0x4c9232, 0x5aa43a];
  const fronds: [number, number, number][] = [[7, 1, 0], [3, 5, -1], [12, 4, 1], [1, 9, -1], [14, 8, 1]];
  for (const [tipX, tipY, dir] of fronds) {
    const steps = 15 - tipY;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, x = Math.round(7.5 + (tipX - 7.5) * t * t), y = 15 - Math.round((15 - tipY) * t);
      p.put(x, y, pick(RAMP, 0.2 + t * 0.4));
      if (k % 2 === 0 && k > 1) { p.put(x - 1, y, pick(RAMP, 0.6 + t * 0.3)); p.put(x + 1, y, pick(RAMP, 0.5 + t * 0.3)); if (dir !== 0) p.put(x + dir * 2, y + 1, RAMP[1]!); }
    }
  }
}

function deadBush(p: Pix) {
  p.draw([
    '..b.........b...',
    '...b...b...b....',
    '.B..b..b..b..B..',
    '..B..b.b.b..B...',
    '...B..bbb..B....',
    '....BB.b.BB.....',
    '..b...BbB...b...',
    '...bb..B..bb....',
    '.....bbBbb......',
    '.......B........',
    '.......B........',
    '......BBB.......',
  ], { b: 0x9a6a30, B: 0x6e4a1e }, 0, 4);
}

function sugarCane(p: Pix) {
  const CANE = [0x6a9a3a, 0x88b84a, 0xa6d066, 0xc2e08a], NODE = 0xd8e8a8;
  for (const [x0, offset] of [[2, 0], [7, 2], [12, 1]] as const) for (let y = 0; y < 16; y++) {
    const node = (y + offset) % 5 === 0;
    p.set(x0, y, node ? NODE : CANE[2]!);
    p.set(x0 + 1, y, node ? CANE[3]! : CANE[1]!);
    if (!node && (y + offset) % 5 === 2) p.set(x0 + 2, y, CANE[0]!);
  }
  for (const [x, y, dx] of [[4, 3, 1], [9, 9, 1], [1, 12, -1], [14, 6, 1], [6, 13, -1]] as const) { p.put(x, y, 0x5a8a2a); p.put(x + dx, y - 1, 0x6e9e34); }
}

function sapling(p: Pix, kind: 'oak' | 'birch' | 'spruce') {
  const TRUNK = kind === 'birch' ? { t: 0xe4e1d7, T: 0x3a3833 } : { t: 0x6b4d2a, T: 0x4a341c };
  const LEAF = kind === 'oak' ? [0x2f6420, 0x3f7e28, 0x55a034] : kind === 'birch' ? [0x4e7a2c, 0x62943a, 0x7cb04a] : [0x1e4a2e, 0x2a5e3a, 0x3a7448];
  const crown = kind === 'spruce'
    ? ['.......a........', '......aba.......', '.....abcba......', '......aba.......', '....abcbcba.....', '.....abcba......', '...abcbcbcba....', '....abcbcba.....', '..aabbcbcbbaa...']
    : ['......aab.......', '....abbccba.....', '...abccbccba....', '..abbcccbbcba...', '..abcbbccbcba...', '...abbcbbcba....', '....aabbbaa.....', '......a.a.......'];
  p.draw(crown, { a: LEAF[0]!, b: LEAF[1]!, c: LEAF[2]! }, 0, kind === 'spruce' ? 1 : 2);
  for (let y = kind === 'spruce' ? 10 : 9; y < 16; y++) { p.put(7, y, TRUNK.t); p.put(8, y, TRUNK.T); }
}

/** Wheat: stalks rise with the stage and turn gold, with ears at the top when ripe. */
function wheat(p: Pix, stage: number) {
  const green = [0x2e6a1c, 0x3f8424, 0x55a02e, 0x6cb63a], gold = [0x8a6a1a, 0xb08a24, 0xd0aa34, 0xe8c85a];
  const ripe = stage / 7, stalks = [1, 3, 4, 6, 8, 9, 11, 13, 14], r = rng(311);
  for (const x0 of stalks) {
    const height = Math.max(2, Math.round(2 + stage * 1.75 + (r() - 0.5) * 2)), lean = r() < 0.5 ? -1 : 1;
    for (let k = 0; k < height; k++) {
      const x = x0 + (k > height * 0.6 && stage > 3 ? lean : 0), y = 15 - k;
      const base = pick(green, 0.15 + (k / height) * 0.8), c = stage >= 6 ? mix(base, pick(gold, k / height), stage === 7 ? 0.9 : 0.45) : base;
      p.put(x, y, c);
      if (stage >= 5 && k >= height - 3) p.put(x + (k % 2 ? 1 : -1), y, stage === 7 ? gold[3]! : mix(green[3]!, gold[2]!, ripe * 0.6));
    }
  }
}
function rootCrop(p: Pix, stage: number, root: Rgb, rootDark: Rgb) {
  const LEAF = [0x2e6a1c, 0x3f8424, 0x55a02e, 0x6cb63a, 0x82c64a], r = rng(321 + (root & 255));
  for (const x0 of [2, 6, 10, 13]) {
    const height = 3 + stage * 2 + floor(r() * 2);
    for (let k = 0; k < height; k++) {
      const y = 15 - k, spread = floor(k / 2.5);
      p.put(x0, y, pick(LEAF, 0.1 + k / height * 0.5));
      if (k > 1 && k % 2 === 0) { p.put(x0 - 1 - (spread > 1 ? 1 : 0), y - 1, pick(LEAF, 0.6 + k / height * 0.4)); p.put(x0 + 1 + (spread > 1 ? 1 : 0), y - 1, pick(LEAF, 0.5 + k / height * 0.4)); }
    }
    if (stage === 3) { p.put(x0, 15, root); p.put(x0 + 1, 15, rootDark); p.put(x0, 14, root); }
  }
}

const TORCH_HEAD = { W: 0xfff8d0, Y: 0xffd84a, O: 0xffa028, R: 0xd8641a, C: 0x6e3a14 };
function torch(p: Pix, head: Palette = TORCH_HEAD) {
  p.draw([
    '.......WY.......',
    '.......YO.......',
    '.......RC.......',
    '.......hH.......', '.......hH.......', '.......hH.......', '.......hH.......', '.......hH.......', '.......hH.......', '.......kK.......',
  ], { ...head, h: 0x9c7440, H: 0x6e4f28, k: 0x7a5a32, K: 0x543a1e }, 0, 6);
}
function lantern(p: Pix) {
  p.draw([
    '.......oo.......',
    '......o..o......',
    '......o..o......',
    '.......oo.......',
    '......oMMo......',
    '......oLMo......',
    '.....ooooOo.....',
    '.....oYWWOo.....',
    '.....oYWWYo.....',
    '.....oOYYOo.....',
    '.....oRRRRo.....',
    '.....oMMMMo.....',
    '.....oooooo.....',
  ], { o: 0x2a2c33, M: 0x4a4e58, L: 0x6e737e, O: 0xf0a030, Y: 0xffd060, W: 0xfff4c0, R: 0xd87a24 }, 0, 3);
}
function ladder(p: Pix) {
  const RAIL = [0x5a3e1e, 0x7a5a30, 0x9a7440], RUNG = [0x6a4a24, 0x8e6a3a, 0xa8824e];
  for (let y = 0; y < 16; y++) for (const x of [2, 13]) { p.set(x - 1, y, RAIL[2]!); p.set(x, y, RAIL[1]!); p.set(x + 1, y, RAIL[0]!); }
  for (const y of [1, 5, 9, 13]) for (let x = 3; x < 12; x++) { p.set(x, y, RUNG[2]!); p.set(x, y + 1, RUNG[0]!); }
}

function door(p: Pix, upper: boolean) {
  const WOOD = [0x5a3c1c, 0x74502a, 0x8a6236, 0x9c7240, 0xae824c];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const board = floor((x - 1) / 3.5), seam = x > 1 && x < 15 && (x - 1) % 4 === 3;
    let t = 0.45 + (board % 2 ? 0.12 : 0) + (tnoise(x, y, 331 + board, 8, 16) - 0.5) * 0.35 + (hash(x, y, 332) - 0.5) * 0.12;
    if (seam) t = 0.05;
    p.set(x, y, pick(WOOD, t));
  }
  for (let i = 0; i < 16; i++) { p.set(0, i, WOOD[0]!); p.set(15, i, WOOD[0]!); p.set(1, i, WOOD[4]!); }
  if (upper) {
    for (let x = 0; x < 16; x++) p.set(x, 0, WOOD[0]!);
    for (const x0 of [3, 9]) for (let y = 2; y < 8; y++) for (let x = x0; x < x0 + 4; x++) p.set(x, y, 0, 0);
    for (let x = 2; x < 14; x++) { p.set(x, 8, WOOD[4]!); p.set(x, 9, WOOD[0]!); }
  } else {
    for (let x = 0; x < 16; x++) p.set(x, 15, WOOD[0]!);
    for (let x = 2; x < 14; x++) { p.set(x, 6, WOOD[4]!); p.set(x, 7, WOOD[0]!); }
    p.draw(['oo', 'oW', 'oM', 'oo'], { o: 0x2a2a2e, W: 0xd8dce0, M: 0x8e949a }, 12, 1);
  }
}

const BED = { red: [0x7a1616, 0x9a1e1e, 0xb82828, 0xd03a36], sheet: [0xc8c4bc, 0xdedad2, 0xf0ede6, 0xffffff], wood: OAK };
function bed(p: Pix, part: 'head' | 'foot', face: 'top' | 'side' | 'end') {
  if (face === 'top') {
    p.fill((x, y) => {
      const edge = x === 0 || x === 15;
      if (part === 'head' && y < 7) return y === 0 || y === 6 || edge ? BED.sheet[1]! : pick(BED.sheet, 0.55 + (hash(x, y, 341) - 0.5) * 0.3 + (y === 1 ? 0.3 : 0));
      const fold = part === 'head' && y === 7 ? 0.95 : 0;
      return pick(BED.red, (edge ? 0.1 : 0.55) + fold + (tnoise(x, y, 342, 4) - 0.5) * 0.3 + ((x + y) % 4 === 0 ? 0.12 : 0));
    });
    if (part === 'foot') for (let x = 1; x < 15; x++) { p.set(x, 13, BED.red[3]!); p.set(x, 14, BED.red[0]!); }
    return;
  }
  for (let x = 0; x < 16; x++) {
    for (let y = 7; y < 10; y++) {
      const pillow = face === 'end' && part === 'head', sheet = face === 'side' && part === 'head' && y === 7;
      let c = pillow || sheet ? pick(BED.sheet, y === 7 ? 0.9 : 0.5) : pick(BED.red, y === 7 ? 0.9 : 0.5 + (hash(x, y, 343) - 0.5) * 0.3);
      if (face === 'side' && y === 8 && x % 4 === 1) c = BED.red[0]!; // quilt stitching
      if (face === 'end' && part === 'foot' && y === 9) c = BED.red[1]!; // tucked hem
      p.set(x, y, c);
    }
    for (let y = 10; y < 13; y++) p.set(x, y, pick(BED.wood, y === 10 ? 0.9 : y === 12 ? 0.1 : 0.55 + (hash(x, y, 344) - 0.5) * 0.3));
    for (let y = 13; y < 16; y++) if (x < 3 || x > 12) p.set(x, y, pick(BED.wood, x === 0 || x === 13 ? 0.8 : 0.3));
  }
}

/** Cracks grow from the centre; stage 0..9 reveals a growing prefix of one deterministic crack network. */
const CRACK_PATH: readonly [number, number][] = (() => {
  const r = rng(351), path: [number, number][] = [], seen = new Set<number>();
  const add = (x: number, y: number) => { const key = x + y * 16; if (x < 0 || y < 0 || x > 15 || y > 15 || seen.has(key)) return false; seen.add(key); path.push([x, y]); return true; };
  const heads: [number, number, number, number][] = [[7, 8, 1, -1], [8, 7, -1, 1], [7, 7, -1, -1], [8, 8, 1, 1]];
  for (let step = 0; step < 26; step++) {
    for (const head of heads) {
      const [x, y, dx, dy] = head, move = r();
      const nx = x + (move < 0.6 ? dx : 0), ny = y + (move > 0.4 ? dy : 0);
      add(nx, ny);
      head[0] = Math.max(0, Math.min(15, nx)); head[1] = Math.max(0, Math.min(15, ny));
      if (r() < 0.12 && heads.length < 9) heads.push([head[0], head[1], r() < 0.5 ? dx : -dx, r() < 0.5 ? -dy : dy]);
    }
  }
  return path;
})();
function crack(p: Pix, stage: number) {
  // Drawn with MC's multiply blend: dark lines carve the block, a light rim below-right catches the light.
  const lines = new Set(CRACK_PATH.slice(0, Math.max(6, Math.round(CRACK_PATH.length * (stage + 1) / 10))).map(([x, y]) => x + y * 16));
  for (const key of lines) {
    const x = key & 15, y = key >> 4, rim = x + 1 + (y + 1) * 16;
    p.set(x, y, hash(x, y, 352) < 0.3 ? 0x303030 : 0x161616);
    if (x < 15 && y < 15 && !lines.has(rim)) p.set(x + 1, y + 1, 0x9a9a9a);
  }
}

// ---------- expansion: the Nether ----------

const NETHERRACK = [0x3a1010, 0x4a1616, 0x5a1c1c, 0x6a2222, 0x7a2a28, 0x8c3430];
function netherrack(p: Pix) {
  p.fill((x, y) => pick(NETHERRACK, 0.2 + tnoise(x, y, 401, 4) * 0.35 + tnoise(x, y, 402, 2) * 0.2 + (hash(x, y, 403) - 0.5) * 0.5));
  const r = rng(404);
  for (let i = 0; i < 14; i++) {
    const x = floor(r() * 16), y = floor(r() * 16);
    p.set(x, y, NETHERRACK[0]!); p.set(x + 1, y, NETHERRACK[1]!); p.set(x, y - 1, NETHERRACK[5]!);
  }
}

/** Soul sand: dark grains with a few wailing faces pressed into it. */
function soulSand(p: Pix) {
  const SOUL = [0x2a1e16, 0x36281d, 0x433224, 0x503c2c, 0x5d4634, 0x6b523e];
  p.fill((x, y) => pick(SOUL, 0.35 + tnoise(x, y, 411, 4) * 0.3 + (hash(x, y, 412) - 0.5) * 0.45));
  const FACE = ['.lll.', 'lDlDl', 'ldldl', '.lDl.', '.ldl.'];
  for (const [x, y] of [[1, 1], [9, 4], [3, 10], [11, 11]] as const) p.draw(FACE, { l: SOUL[4]!, D: 0x120a06, d: SOUL[0]! }, x, y);
}

function glowstone(p: Pix) {
  const GLOW = [0x7a4a1a, 0xa86a26, 0xd09438, 0xecbc56, 0xfad884, 0xfff2c0], points = jitterGrid(4, 421, 0.9), r = rng(422), tones = points.map(() => r());
  p.fill((x, y) => {
    const v = voronoi(points, x + 0.5, y + 0.5);
    if (v.d2 - v.d1 < 0.9) return GLOW[hash(x, y, 423) < 0.5 ? 0 : 1]!;
    return pick(GLOW, 0.3 + tones[v.index]! * 0.5 - v.d1 * 0.05 + (hash(x, y, 424) - 0.5) * 0.3);
  });
}

function lava(p: Pix, frame: number, frames: number) {
  const LAVA = [0x9a2406, 0xc0400a, 0xdc600e, 0xf08418, 0xfaa82a, 0xffcc4a, 0xffec94], s = 16 * frame / frames;
  p.fill((x, y) => {
    const flow = tnoise(x + s, y, 431, 8), churn = tnoise(x, y + s, 432, 4), spark = tnoise(x - s, y - s, 433, 2);
    return pick(LAVA, (flow * 0.4 + churn * 0.35 + spark * 0.25 - 0.25) * 2);
  });
}

function magma(p: Pix) {
  const CRUST = [0x2a0e08, 0x3a140a, 0x4a1b0c, 0x5c2410], GLOW = [0xa83008, 0xe0600e, 0xfb9a24, 0xffd060];
  const points = jitterGrid(3, 441, 0.9), r = rng(442), tones = points.map(() => r());
  p.fill((x, y) => {
    const v = voronoi(points, x + 0.5, y + 0.5), gap = v.d2 - v.d1;
    if (gap < 1.2) return pick(GLOW, 1 - gap / 1.2 + (hash(x, y, 443) - 0.5) * 0.4);
    if (gap < 2) return mix(CRUST[3]!, GLOW[0]!, 0.45);
    return pick(CRUST, tones[v.index]! * 0.6 + (hash(x, y, 444) - 0.5) * 0.5 - (v.ox + v.oy) * 0.03);
  });
}

const QUARTZ = [0xc9c0b6, 0xd8d0c7, 0xe4ddd5, 0xede7e1, 0xf5f1ec, 0xfcfaf7];
/** Quartz block: smooth, faintly veined stone with a soft bevel (the top adds an inner frame). */
function quartzBlock(p: Pix, top: boolean) {
  p.fill((x, y) => pick(QUARTZ, 0.45 + tnoise(x, y, top ? 451 : 452, 8, top ? 8 : 16) * 0.3 + (hash(x, y, 453) - 0.5) * 0.12));
  for (let i = 0; i < 16; i++) { p.set(i, 0, QUARTZ[5]!); p.set(0, i, QUARTZ[4]!); p.set(i, 15, QUARTZ[0]!); p.set(15, i, QUARTZ[1]!); }
  if (top) for (let i = 3; i < 13; i++) { p.set(i, 3, QUARTZ[1]!); p.set(3, i, QUARTZ[1]!); p.set(i, 12, QUARTZ[5]!); p.set(12, i, QUARTZ[5]!); }
}

/** Nether portal: a translucent violet swirl that drifts and loops over the frames. */
function portal(p: Pix, frame: number, frames: number) {
  const PORTAL = [0x2c0860, 0x440e94, 0x5c18c0, 0x7626e0, 0x9444f6, 0xb878ff, 0xe0c4ff], s = 16 * frame / frames;
  p.fill((x, y) => {
    const warp = tnoise(x, y + s, 461, 8) * 8, v = tnoise(x + warp + s, y - warp, 462, 4) * 0.65 + tnoise(x - s, y + warp, 463, 2) * 0.35;
    return pick(PORTAL, (v - 0.2) * 1.7);
  });
  p.map((c, x, y) => { p.set(x, y, c, 150 + floor(((c & 255) / 255) * 90)); return c; });
}

/** Fire: flame tongues rising from a hot base, transparent above; loops over the frames. */
function fire(p: Pix, frame: number, frames: number) {
  const FIRE = [0x8a1a04, 0xc43a08, 0xec6410, 0xfb9420, 0xffc040, 0xffe890], s = 16 * frame / frames;
  p.fill((x, y) => {
    const heat = y / 15 * 1.1 + (tnoise(x, y + s, 471, 2, 8) - 0.5) * 1.1 + (tnoise(x, y + 2 * s, 472, 4, 4) - 0.5) * 0.5;
    return heat < 0.5 || y < 2 ? null : pick(FIRE, (heat - 0.5) * 1.6);
  });
}

function mushroom(p: Pix, red: boolean) {
  const rows = red
    ? ['....rRRRRr....', '...rRWRRRWRr...', '..rRRRRRRRRRr..', '..rWRRRWRRRRr..', '..dddddddddd...', '......sS......', '......sS......', '......sS......', '.....ssSS.....']
    : ['...bBBBBBBb....', '.bBBLBBBBLBBb..', 'bBBBBBBBBBBBBb.', 'dddddddddddddd.', '......sS.......', '......sS.......', '.....ssSS......'];
  p.draw(rows, { r: 0x9a1812, R: 0xd02a1e, W: 0xf4ece0, d: 0x6a1410, b: 0x7a5a3e, B: 0x9a7452, L: 0xb89270, s: 0xd8cfbc, S: 0xb8ae98 }, red ? 1 : 1, 16 - rows.length);
  if (!red) p.map((c, x, y) => y === 16 - rows.length + 3 ? 0x5a4230 : c);
}

/** Cobweb: silk spokes from the centre plus two rings, transparent between the threads. */
function cobweb(p: Pix) {
  const SILK = 0xe4e6ea, DIM = 0xb8bcc4;
  for (let k = 0; k < 8; k++) {
    const dx = [1, 1, 0, -1, -1, -1, 0, 1][k]!, dy = [0, 1, 1, 1, 0, -1, -1, -1][k]!;
    for (let i = 1; i < 8; i++) p.put(7 + dx * i + (dx < 0 ? 1 : 0), 7 + dy * i + (dy < 0 ? 1 : 0), i % 3 ? SILK : DIM);
  }
  for (const radius of [3, 6]) for (let a = 0; a < 48; a++) {
    const angle = a / 48 * Math.PI * 2, x = Math.round(7.5 + Math.cos(angle) * radius), y = Math.round(7.5 + Math.sin(angle) * radius * 0.9);
    if (hash(a, radius, 481) < 0.85) p.put(x, y, hash(x, y, 482) < 0.3 ? DIM : SILK);
  }
  p.set(7, 7, SILK).set(8, 8, SILK).set(7, 8, DIM).set(8, 7, DIM);
}

// ---------- expansion: structures ----------

/** Spawner cage: dark iron bars in a grid with see-through gaps. */
function spawnerCage(p: Pix) {
  const IRON_BARS = [0x16181c, 0x24272d, 0x363a42, 0x4e535e, 0x6a707c];
  p.fill((x, y) => {
    const bar = (v: number) => v < 2 || v > 13 || v === 5 || v === 10;
    if (!bar(x) && !bar(y)) return null;
    const lit = (bar(x) && !bar(y) ? (x === 0 || x === 5 || x === 10 ? 0.85 : 0.35) : (y === 0 || y === 5 || y === 10 ? 0.7 : 0.25));
    return pick(IRON_BARS, lit + (hash(x, y, 491) - 0.5) * 0.3);
  });
  for (const x of [5, 10]) for (const y of [5, 10]) p.set(x, y, IRON_BARS[4]!);
}

/** Sandstone variants: cut (smooth, framed, two courses) and chiseled (framed with a carved sun glyph). */
function carvedSandstone(p: Pix, chiseled: boolean) {
  const CARVE = 0xa88c58, LIT = 0xfaf2d4;
  grain(p, SAND, chiseled ? 116 : 117, 4, 0.4);
  for (let i = 0; i < 16; i++) { p.set(i, 0, LIT); p.set(i, 1, SAND[3]!); p.set(i, 15, CARVE); p.set(i, 14, SAND[1]!); }
  if (!chiseled) { for (let x = 0; x < 16; x++) { p.set(x, 7, CARVE); p.set(x, 8, LIT); } return; }
  for (let x = 0; x < 16; x++) { p.set(x, 3, CARVE); p.set(x, 12, LIT); }
  p.draw([
    '......dd......',
    '..d...dd...d..',
    '...dddlldddl..',
    '...dl....dl...',
    'ddddl.dd.dlddd',
    '...dl....dl...',
    '...dllllldl...',
    '..d...dd...d..',
  ], { d: CARVE, l: LIT }, 1, 4);
}

function dirtPath(p: Pix, top: boolean) {
  const PATH = [0x6a5230, 0x7a5f38, 0x896b42, 0x96784c, 0xa38456, 0xae9062];
  if (top) {
    p.fill((x, y) => pick(PATH, 0.35 + tnoise(x, y, 501, 4) * 0.35 + (hash(x, y, 502) - 0.5) * 0.4));
    const r = rng(503);
    for (let i = 0; i < 7; i++) { const x = floor(r() * 16), y = floor(r() * 16); p.set(x, y, 0x9a948a); p.set(x + 1, y, 0x6e6860); }
    return;
  }
  dirt(p, DIRT, 504);
  for (let x = 0; x < 16; x++) {
    const h = 3 + (hash(x, 0, 505) < 0.3 ? 1 : 0);
    for (let y = 0; y < h; y++) p.set(x, y, pick(PATH, 0.7 - y * 0.12 + (hash(x, y, 506) - 0.5) * 0.3));
    p.set(x, h, mix(p.rgb(x, h), 0x2a1a0e, 0.35));
  }
}

function crackedStoneBricks(p: Pix) {
  stoneBricks(p);
  const r = rng(511);
  for (const [x0, y0, len] of [[3, 1, 7], [11, 8, 8], [6, 10, 5]] as const) {
    let x = x0, y = y0;
    for (let k = 0; k < len; k++) { p.set(x, y, 0x2e2e32); p.set(x + 1, y, STONE[1]!); y++; x += r() < 0.35 ? 1 : r() < 0.5 ? -1 : 0; }
  }
}

// ---------- expansion: redstone ----------

const REDSTONE = [0x5a0604, 0x7e0c08, 0xa81410, 0xd0201a, 0xf04a32, 0xff9a80];
const RED_TORCH_ON = { W: 0xffe0d0, Y: 0xff5a3a, O: 0xe82014, R: 0xa80c06, C: 0x5a0a04 };
const RED_TORCH_OFF = { W: 0x7a2a22, Y: 0x6a1c16, O: 0x541410, R: 0x3e0e0a, C: 0x2e0a06 };

/**
 * Redstone dust, greyscale so the mesher can multiply it by the power colour (see `redstoneTint`). The dot is the
 * centre blob; the line runs along u (x) through rows 6–9 and is drawn in halves/rotated for each connection.
 */
function redstoneDust(p: Pix, line: boolean) {
  p.fill((x, y) => {
    const d = line ? Math.abs(y - 7.5) : Math.hypot(x - 7.5, y - 7.5), edge = line ? 2 : 3.8;
    if (d > edge + hash(x, y, 521) * 0.8) return null;
    return mix(0x9a9a9a, 0xffffff, clamp(1.2 - d / (edge + 1) + (hash(x, y, 522) - 0.5) * 0.5));
  });
  if (line) return;
  for (const [x, y] of [[3, 6], [12, 9], [6, 12], [9, 3], [4, 11], [11, 4]] as const) p.set(x, y, 0xb4b4b4);
}

function lever(p: Pix) {
  p.draw(['.......WM.......', '.......LM.......', ...Array.from({ length: 8 }, () => '.......hH.......')], { W: 0xc8c8cc, L: 0x9a9aa0, M: 0x6a6a70, h: 0x9c7440, H: 0x6e4f28 }, 0, 6);
}

function redstoneLamp(p: Pix, lit: boolean) {
  const CELL = lit ? [0xc87a26, 0xe8a03a, 0xf8c85a, 0xffe490, 0xfff6d0] : [0x3a2416, 0x4a2e1a, 0x5c3a20, 0x6e4628, 0x7e5230];
  const FRAME = lit ? [0x7a4a22, 0xa06830, 0xc88a42] : [0x241810, 0x34241a, 0x463222];
  const points = jitterGrid(3, 531, 0.8);
  p.fill((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return FRAME[x === 0 || y === 0 ? 2 : 0]!;
    if (x === 1 || y === 1 || x === 14 || y === 14) return FRAME[1]!;
    const v = voronoi(points, x + 0.5, y + 0.5);
    return v.d2 - v.d1 < 0.9 ? FRAME[1]! : pick(CELL, 0.75 - v.d1 * 0.1 + (hash(x, y, 532) - 0.5) * 0.3);
  });
}

/** Repeater top: smooth stone, a dust trail and two torch sockets; the output points to the image top (north). */
function repeater(p: Pix, powered: boolean) {
  const SMOOTH = [0x8e8e94, 0x9c9ca2, 0xa8a8ae, 0xb4b4ba];
  p.fill((x, y) => pick(SMOOTH, 0.5 + (hash(x, y, 541) - 0.5) * 0.5 + (x === 0 || y === 0 ? 0.4 : x === 15 || y === 15 ? -0.4 : 0)));
  const dust = powered ? [0xb81410, 0xf0341e] : [0x4a0a06, 0x6a100a];
  for (let y = 1; y < 15; y++) { p.set(7, y, dust[1]!); p.set(8, y, dust[y & 1]!); }
  for (const [x, y] of [[7, 0], [8, 0], [6, 1], [9, 1]] as const) p.set(x, y, dust[1]!);
  const head = powered ? RED_TORCH_ON : RED_TORCH_OFF;
  for (const y of [3, 10]) p.draw(['oWYo', 'oYOo', 'oooo'], { o: 0x3a3a40, ...head }, 6, y);
  for (const y of [9, 11, 13]) { p.set(4, y, SMOOTH[0]!); p.set(11, y, SMOOTH[0]!); p.set(4, y + 1, SMOOTH[3]!); p.set(11, y + 1, SMOOTH[3]!); }
}

/** Piston parts. The side's top four rows are the wooden head (toward the facing); the rest is the stone body. */
function piston(p: Pix, part: 'side' | 'top' | 'sticky' | 'bottom' | 'inner') {
  if (part === 'side') {
    cobble(p, COBBLE, 551);
    const wood = new Pix();
    planks(wood, OAK, 552);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) p.set(x, y, y === 3 ? OAK[0]! : wood.rgb(x, y + 1));
    for (let x = 0; x < 16; x++) p.set(x, 4, 0x2e2e32);
    return;
  }
  if (part === 'bottom' || part === 'inner') {
    cobble(p, COBBLE, part === 'bottom' ? 553 : 554);
    p.rect(4, 4, 8, 8, (x, y) => pick(STONE, x === 4 || y === 4 ? 0.1 : x === 11 || y === 11 ? 0.9 : 0.45 + (hash(x, y, 555) - 0.5) * 0.3));
    if (part === 'inner') p.rect(6, 6, 4, 4, (x, y) => pick(OAK, x === 6 || y === 6 ? 0.9 : 0.4 + (hash(x, y, 556) - 0.5) * 0.3));
    return;
  }
  planks(p, OAK, 557);
  for (let i = 0; i < 16; i++) { p.set(i, 0, 0x2e2e32); p.set(0, i, 0x2e2e32); p.set(i, 15, 0x2e2e32); p.set(15, i, 0x2e2e32); }
  if (part === 'top') { p.rect(6, 6, 4, 4, (x, y) => pick(IRON, x === 6 || y === 6 ? 0.9 : 0.4)); return; }
  const SLIME = [0x3e8a2a, 0x58a83a, 0x74c450, 0x94dc6e, 0xc4f4a4];
  p.map((c, x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5) + (tnoise(x, y, 558, 4) - 0.5) * 3;
    return d < 6.5 ? pick(SLIME, 0.75 - d / 9 + (x + y < 12 ? 0.15 : 0) + (hash(x, y, 559) - 0.5) * 0.2) : c;
  });
}

/** Iron door: riveted steel panels (the upper half has two small windows). */
function ironDoor(p: Pix, upper: boolean) {
  p.fill((x, y) => pick(IRON, 0.35 + tnoise(x, y, upper ? 561 : 562, 16, 2) * 0.35 + (hash(x, y, 563) - 0.5) * 0.12));
  for (let i = 0; i < 16; i++) { p.set(0, i, IRON[0]!); p.set(15, i, IRON[0]!); p.set(1, i, IRON[4]!); p.set(14, i, IRON[1]!); }
  for (let x = 0; x < 16; x++) p.set(x, upper ? 0 : 15, IRON[0]!);
  for (const y of upper ? [2, 13] : [2, 13]) for (const x of [3, 12]) { p.set(x, y, IRON[5]!); p.set(x + 1, y + 1, IRON[0]!); }
  if (upper) for (const x0 of [4, 9]) {
    for (let y = 4; y < 9; y++) for (let x = x0; x < x0 + 3; x++) p.set(x, y, 0, 0);
    for (let x = x0 - 1; x < x0 + 4; x++) { p.set(x, 3, IRON[0]!); p.set(x, 9, IRON[5]!); }
  } else for (let x = 2; x < 14; x++) { p.set(x, 7, IRON[0]!); p.set(x, 8, IRON[5]!); }
}

/** TNT: a bundle of red sticks (side: a paper band with the label; top: stick ends and the fuse). */
function tnt(p: Pix, part: 'side' | 'top' | 'bottom') {
  const RED = [0x7a1810, 0x9e2216, 0xbc2e1e, 0xd43c28, 0xe85a40];
  if (part !== 'side') {
    p.fill((x, y) => {
      const cx = (x & 7) - 3.5, cy = (y & 7) - 3.5, d = Math.hypot(cx, cy);
      return d > 3.6 ? RED[0]! : pick(RED, 0.8 - d / 5 + (hash(x, y, 571) - 0.5) * 0.2 - (part === 'bottom' ? 0.25 : 0));
    });
    if (part === 'top') p.draw(['.kk.', 'kFFk', 'kFFk', '.kk.'], { k: 0x2a2220, F: 0xd8ccb0 }, 6, 6);
    return;
  }
  p.fill((x, y) => pick(RED, (x % 4 === 3 ? 0.1 : x % 4 === 0 ? 0.75 : 0.5) + (hash(x, y, 572) - 0.5) * 0.25));
  for (let x = 0; x < 16; x++) for (let y = 4; y < 12; y++) p.set(x, y, y === 4 || y === 11 ? 0xb8b0a4 : pick([0xe0dad0, 0xece8e0, 0xf6f4ee], hash(x, y, 573)));
  p.draw(['TTT.N..N.TTT', '.T..NN.N..T.', '.T..N.NN..T.', '.T..N..N..T.'], { T: 0x1e1a1a, N: 0x1e1a1a }, 2, 6);
}

function missing(p: Pix) { p.fill((x, y) => ((x >> 2) + (y >> 2)) & 1 ? 0xff00ff : 0x101010); }
/** A lightly noised flat colour (from the key's hash) for texture keys without a painter. */
function placeholder(key: string): Painter {
  const seed = seedOf(key), base = mix(0x6a6a6a, seed & 0xffffff, 0.45);
  return p => p.fill((x, y) => shade(base, 0.88 + hash(x, y, seed) * 0.24));
}

const WOOL: Record<string, Rgb> = { white_wool: 0xe6e8e8, red_wool: 0xa52a26, yellow_wool: 0xf0c22c, blue_wool: 0x3446a0, green_wool: 0x547a1e, black_wool: 0x222226 };

/** Painters keyed by atlas texture key. Staged/animated keys are resolved in `paintTexture`. */
const PAINTERS: Record<string, Painter> = {
  stone: p => stone(p), cobblestone: p => cobble(p), mossy_cobblestone: p => cobble(p, COBBLE, 21, true),
  dirt: p => dirt(p), grass_block_top: grassTop, grass_block_side: p => cappedSide(p, GRASS, 43, 3, true),
  snow, clay, terracotta,
  snowy_grass_side: p => cappedSide(p, SNOW, 47, 4, false),
  sand: p => { grain(p, SAND, 51, 2, 0.35); for (let i = 0; i < 8; i++) p.set(floor(hash(i, 0, 52) * 16), floor(hash(i, 1, 52) * 16), i % 2 ? SAND[0]! : 0xfaf0cc); },
  sandstone: p => sandstone(p, 'side'), sandstone_top: p => sandstone(p, 'top'), sandstone_bottom: p => sandstone(p, 'bottom'),
  gravel,
  bedrock, obsidian, ice, glass,
  farmland: p => farmland(p, false), farmland_moist: p => farmland(p, true),
  coal_ore: p => ore(p, [0x121214, 0x1e1e22, 0x2c2c30, 0x3e3e44], 71, 5, 0x0a0a0c),
  iron_ore: p => ore(p, [0x8a6246, 0xae8060, 0xcfa482, 0xe8c8a8], 72, 4, 0x5a3e2a),
  gold_ore: p => ore(p, [0xb88a10, 0xe0b020, 0xf8d848, 0xfff2a0], 73, 4, 0x7a5a08),
  diamond_ore: p => ore(p, [0x1a9a94, 0x3cd2c8, 0x7ef0e6, 0xd4fffa], 74, 3, 0x0e5a56),
  oak_log: p => bark(p, OAK_BARK, 63), oak_log_top: p => logTop(p, OAK, OAK_BARK, 64),
  birch_log: birchBark, birch_log_top: p => logTop(p, BIRCH, BIRCH_BARK, 65),
  spruce_log: p => bark(p, SPRUCE_BARK, 66), spruce_log_top: p => logTop(p, SPRUCE, SPRUCE_BARK, 67),
  oak_planks: p => planks(p, OAK, 68), birch_planks: p => planks(p, BIRCH, 69), spruce_planks: p => planks(p, SPRUCE, 70),
  oak_leaves: p => leaves(p, [0x285a1c, 0x326a22, 0x3d7c28, 0x498f30, 0x57a239, 0x68b544], 75, 0.62),
  birch_leaves: p => leaves(p, [0x48762c, 0x578a34, 0x659c3d, 0x74ae47, 0x86c054], 76, 0.62),
  spruce_leaves: p => leaves(p, [0x1a3a28, 0x224831, 0x2a563a, 0x336544, 0x3e7550], 77, 0.5),
  crafting_table_top: craftingTop, crafting_table_side: p => craftingSide(p, false), crafting_table_front: p => craftingSide(p, true),
  furnace_top: furnaceTop, furnace_side: furnaceSide, furnace_front: p => furnaceFront(p, false), furnace_front_on: p => furnaceFront(p, true),
  chest_top: p => chest(p, 'top'), chest_side: p => chest(p, 'side'), chest_front: p => chest(p, 'front'),
  bookshelf, bricks, stone_bricks: p => stoneBricks(p),
  hay_bale_side: p => hay(p, false), hay_bale_top: p => hay(p, true),
  pumpkin_side: pumpkinSide, pumpkin_top: pumpkinTop, carved_pumpkin: p => carvedFace(p, false), jack_o_lantern: p => carvedFace(p, true),
  melon_side: p => melon(p, false), melon_top: p => melon(p, true),
  cactus_side: p => cactus(p, 'side'), cactus_top: p => cactus(p, 'top'), cactus_bottom: p => cactus(p, 'bottom'),
  iron_block: p => metalBlock(p, IRON, 81), gold_block: p => metalBlock(p, GOLD, 82), diamond_block: p => metalBlock(p, DIAMOND, 83, true),
  coal_block: p => metalBlock(p, [0x0e0e10, 0x17171a, 0x202024, 0x2a2a2f, 0x36363c, 0x46464d], 84, true),
  short_grass: p => shortGrass(p), fern, dandelion: p => flower(p, 'dandelion'), poppy: p => flower(p, 'poppy'), cornflower: p => flower(p, 'cornflower'),
  dead_bush: deadBush, sugar_cane: sugarCane,
  oak_sapling: p => sapling(p, 'oak'), birch_sapling: p => sapling(p, 'birch'), spruce_sapling: p => sapling(p, 'spruce'),
  torch, lantern, ladder, oak_door_top: p => door(p, true), oak_door_bottom: p => door(p, false),
  // Expansion.
  netherrack, soul_sand: soulSand, glowstone, magma_block: magma, nether_bricks: p => bricks(p, [0x301418, 0x3e1a1f, 0x4c2027, 0x5a272e, 0x6a3036], [0x140a0c, 0x1c0e11], 581),
  nether_quartz_ore: p => ore(p, [0xb8aea4, 0xdcd4cc, 0xf0ebe6, 0xffffff], 582, 5, 0x8a8078, netherrack, NETHERRACK[0]),
  nether_gold_ore: p => ore(p, [0xb88a10, 0xe0b020, 0xf8d848, 0xfff2a0], 583, 6, 0x7a5a08, netherrack, NETHERRACK[0]),
  quartz_block_side: p => quartzBlock(p, false), quartz_block_top: p => quartzBlock(p, true),
  red_mushroom: p => mushroom(p, true), brown_mushroom: p => mushroom(p, false), cobweb,
  monster_spawner: spawnerCage, emerald_ore: p => ore(p, [0x0f7a3a, 0x1eae56, 0x4cdc84, 0xb4ffd2], 584, 3, 0x0a4a24),
  emerald_block: p => metalBlock(p, [0x0b5e2c, 0x138040, 0x1ea554, 0x3cc870, 0x7ee6a2, 0xc8ffdc], 585, true),
  chiseled_sandstone: p => carvedSandstone(p, true), cut_sandstone: p => carvedSandstone(p, false),
  dirt_path_top: p => dirtPath(p, true), dirt_path_side: p => dirtPath(p, false),
  cracked_stone_bricks: crackedStoneBricks, mossy_stone_bricks: p => stoneBricks(p, true),
  redstone_ore: p => ore(p, [0x8a0c08, 0xc41a12, 0xf23a26, 0xff9a80], 586, 5, 0x4a0604), redstone_block: p => metalBlock(p, REDSTONE, 587, true),
  redstone_dust_dot: p => redstoneDust(p, false), redstone_dust_line: p => redstoneDust(p, true),
  redstone_torch: p => torch(p, RED_TORCH_ON), redstone_torch_off: p => torch(p, RED_TORCH_OFF), lever,
  redstone_lamp: p => redstoneLamp(p, false), redstone_lamp_on: p => redstoneLamp(p, true), repeater: p => repeater(p, false), repeater_on: p => repeater(p, true),
  piston_side: p => piston(p, 'side'), piston_top: p => piston(p, 'top'), piston_top_sticky: p => piston(p, 'sticky'), piston_bottom: p => piston(p, 'bottom'), piston_inner: p => piston(p, 'inner'),
  iron_door_top: p => ironDoor(p, true), iron_door_bottom: p => ironDoor(p, false),
  tnt_side: p => tnt(p, 'side'), tnt_top: p => tnt(p, 'top'), tnt_bottom: p => tnt(p, 'bottom'),
  missing,
};
for (const [key, color] of Object.entries(WOOL)) PAINTERS[key] = p => wool(p, color);
for (let s = 0; s < 8; s++) PAINTERS[`wheat_stage${s}`] = p => wheat(p, s);
for (let s = 0; s < 4; s++) {
  PAINTERS[`carrots_stage${s}`] = p => rootCrop(p, s, 0xf08a1c, 0xb85c0c);
  PAINTERS[`potatoes_stage${s}`] = p => rootCrop(p, s, 0xd8b064, 0xa07a3a);
}
for (const part of ['head', 'foot'] as const) for (const face of ['top', 'side', 'end'] as const) PAINTERS[`bed_${part}_${face}`] = p => bed(p, part, face);

const ANIMATED_PAINTERS: Record<string, (p: Pix, frame: number, frames: number) => void> = { water, lava, nether_portal: portal, fire };
for (const [key, paint] of Object.entries(ANIMATED_PAINTERS)) for (let f = 0; f < ANIMATION_FRAMES; f++) PAINTERS[frameKey(key, f)] = p => paint(p, f, ANIMATION_FRAMES);
for (let s = 0; s < CRACK_STAGES; s++) PAINTERS[`crack_${s}`] = p => crack(p, s);

export const hasTexture = (key: string) => key in PAINTERS;
/** Suggested redstone dust colour for power 0..15 (multiply the greyscale dust textures by it). */
export const redstoneTint = (power: number): Rgb => mix(0x4a0402, 0xff3a1c, clamp(power / 15));
const cache = new Map<string, Pix>();
/** Painted 16×16 texture for an atlas key (a flat placeholder colour for keys without a painter yet). Cached; do not mutate. */
export function paintTexture(key: string): Pix {
  let pix = cache.get(key);
  if (!pix) {
    pix = new Pix();
    (PAINTERS[key] ?? placeholder(key))(pix);
    cache.set(key, pix);
  }
  return pix;
}
