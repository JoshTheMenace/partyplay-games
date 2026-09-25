/**
 * Flat-colour stand-in for the painted art atlas: one lightly noised colour per texture key, with simple cut-outs for
 * plants, leaves, torches, ladders, glass, dust, fire and cages so every shape reads correctly, and eight noise frames
 * for each animated texture. Used by tests, the dev harness and as a safety net if the real atlas fails.
 */
import { DataArrayTexture, NearestFilter, NearestMipmapLinearFilter, SRGBColorSpace } from 'three';
import { TEXTURE_KEYS } from '../../shared/blocks';
import type { BlockAtlas } from './types';

const SIZE = 16, FRAMES = 8, ANIMATED = ['water', 'lava', 'nether_portal', 'fire'];
const COLORS: [RegExp, number][] = [
  [/lava|fire|magma/, 0xe0701c], [/portal/, 0x7a2ad8], [/soul/, 0x5a4232], [/glow|lamp/, 0xe8c05a], [/quartz/, 0xe8e2d8], [/emerald/, 0x2ea85a],
  [/redstone|nether|tnt|repeater/, 0xa8261e], [/piston|cobweb|spawner|lever/, 0x8a8a8a],
  [/grass_block_top|short_grass|fern|sapling|sugar_cane|_stage/, 0x5fa13a], [/leaves/, 0x3f7f2a], [/snow/, 0xf2f6fa], [/grass_block_side|dirt|farmland/, 0x7a5436],
  [/sandstone|sand/, 0xdccf9a], [/water/, 0x3a6fd8], [/ice/, 0x9cc4f4], [/glass/, 0xd6ecf5], [/gravel|clay/, 0x8e8a86], [/bedrock|coal|obsidian/, 0x2a2630],
  [/dead_bush/, 0x8a6a3a], [/birch/, 0xd8d2b8], [/spruce/, 0x5a3f24], [/log|door|ladder|chest|crafting|bookshelf|planks|bed_.*_side/, 0x9c7446], [/cactus|melon|green/, 0x4f8a2c],
  [/pumpkin|jack|torch|gold/, 0xe39a26], [/poppy|red|bricks|bed/, 0xb23a2c], [/dandelion|yellow|hay/, 0xe8c43a], [/cornflower|blue|diamond/, 0x4a78d8],
  [/iron|stone|cobble|furnace|lantern|ore/, 0x8a8a8a], [/wool|white/, 0xe8e8e8], [/terracotta/, 0x985b40], [/black/, 0x222226],
];
const PLANT = /short_grass|fern|sapling|flower|dandelion|poppy|cornflower|dead_bush|sugar_cane|mushroom|_stage/;

const hash = (x: number, y: number, seed: number) => {
  let h = Math.imul(x * 374761393 + y * 668265263 + seed * 2147483647, 1274126177);
  h = Math.imul(h ^ h >>> 13, 1103515245);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
};

/** Alpha of a pixel for see-through shapes (255 = solid). */
function alpha(key: string, x: number, y: number, seed: number) {
  if (key.includes('leaves')) return hash(x, y, seed + 1) < 0.22 ? 0 : 255;
  if (key === 'torch') return x >= 7 && x <= 8 && y >= 6 ? 255 : 0;
  if (key === 'ladder') return x === 2 || x === 13 || y % 4 === 1 ? 255 : 0;
  if (key === 'glass') return x === 0 || y === 0 || x === 15 || y === 15 || (x === y && x > 3 && x < 9) ? 255 : 0;
  if (key.startsWith('water')) return 190;
  if (key.startsWith('nether_portal')) return 150 + (hash(x, y, seed) * 90 | 0);
  if (key.startsWith('fire')) return y > 3 + hash(x, 0, seed) * 9 && (x + y) % 3 !== 0 ? 255 : 0;
  if (key === 'redstone_dust_line') return y >= 6 && y <= 9 ? 255 : 0;
  if (key === 'redstone_dust_dot') return (x - 7.5) ** 2 + (y - 7.5) ** 2 < 10 ? 255 : 0;
  if (key.startsWith('redstone_torch') || key === 'lever') return x >= 7 && x <= 8 && y >= 6 ? 255 : 0;
  if (key === 'cobweb') return x === y || x === 15 - y || x === 8 || y === 8 ? 255 : 0;
  if (key === 'monster_spawner') return x % 5 === 0 || y % 5 === 0 ? 255 : 0;
  if (key === 'ice') return 200;
  if (PLANT.test(key)) return (x * 5 + 3) % 4 === 0 && y > 4 + hash(x, 0, seed) * 8 ? 255 : 0;
  return 255;
}

export function createFallbackAtlas(): BlockAtlas {
  const frames = ANIMATED.flatMap(key => Array.from({ length: FRAMES - 1 }, (_, i) => `${key}_${i + 1}`));
  const keys = [...TEXTURE_KEYS, ...frames, ...Array.from({ length: 10 }, (_, i) => `crack_${i}`), 'missing'];
  const layers = new Map(keys.map((key, i) => [key, i])), data = new Uint8Array(SIZE * SIZE * 4 * keys.length);
  keys.forEach((key, layer) => {
    const seed = layer * 7919, color = COLORS.find(([pattern]) => pattern.test(key))?.[1] ?? 0xff00ff, crack = key.startsWith('crack_') ? +key.slice(6) : -1;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const at = (layer * SIZE * SIZE + y * SIZE + x) * 4, shade = crack >= 0 ? 0.1 : 0.88 + hash(x, y, seed) * 0.24;
      // Torch flames and grass tops get their own colours so the silhouettes read.
      const tone = key === 'torch' && y < 8 ? 0xffd860 : key === 'grass_block_side' && y < 3 ? 0x5fa13a : color;
      data[at] = Math.min(255, (tone >> 16) * shade);
      data[at + 1] = Math.min(255, (tone >> 8 & 255) * shade);
      data[at + 2] = Math.min(255, (tone & 255) * shade);
      data[at + 3] = crack >= 0 ? (hash(x, y, 99) < (crack + 1) / 14 ? 220 : 0) : key === 'missing' ? 255 : alpha(key, x, y, seed);
    }
  });
  const texture = new DataArrayTexture(data, SIZE, SIZE, keys.length);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return { texture, layerOf: key => layers.get(key) ?? keys.length - 1 };
}
