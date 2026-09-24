/* Particle presets and shared effect colours. Colours are linear (THREE.Color handles sRGB input). */
import * as THREE from 'three';
import type { ThemeId } from '../../sim/types';
import { SHAPE, type Preset } from './particles';

const C = (hex: number, boost = 1) => new THREE.Color(hex).multiplyScalar(boost);
/** Drift tiers: 0 = charging (white), 1 blue, 2 orange, 3 purple. HDR so additive sparks bloom to white-hot cores. */
export const TIER = [C(0xfff0c8, 1.2), C(0x1f86ff, 1.25), C(0xff5a00, 1.2), C(0xa53dff, 1.35)];
export const COLORS = {
  white: C(0xffffff), hot: C(0xfff1b8, 2.2), flame: C(0xff6410, 1.35), flameEnd: C(0xb3200a, .8), smoke: C(0x8a8f99), darkSmoke: C(0x2e2f33),
  spark: C(0xffc45a, 2.2), zap: C(0xa9e4ff, 2.6), zapCore: C(0xffffff, 3), ink: C(0x1b1030), inkEnd: C(0x0b0612), wind: C(0xe8f6ff, 1.2),
  shield: C(0x7fe8ff, 1.8), fire: C(0xffa030, 1.4), fireEnd: C(0x7a1604, .6), debris: C(0x3a3430), gold: C(0xffd84a, 2), splash: C(0xd8f1ff), ice: C(0xe6f7ff, 1.2),
  pinball: C(0xff4fd8, 2.4), spring: C(0x6dffd0, 2.2),
  shellG: C(0x3dff7a, 1.8), shellR: C(0xff3d57, 1.8), comet: C(0x7fc8ff, 1.6), cometEnd: C(0x7a3dff, 1.1), boxShard: C(0xffffff, 1.4),
};
export const DUST: Record<ThemeId, THREE.Color> = { beach: C(0xe9d4a0), desert: C(0xcf8f5a), city: C(0x8f9a86), snow: C(0xf2f7ff), space: C(0xd8c8ff) };
export const CONFETTI = [0xff4d6d, 0xffd23f, 0x3ddc97, 0x3aa8ff, 0xb57bff, 0xff8a3d, 0xffffff].map(h => C(h));

const p = (o: Partial<Preset> & Pick<Preset, 'life' | 'size'>): Preset => ({ jitter: .3, sizeEnd: o.size, gravity: 0, drag: 0, shape: SHAPE.soft, stretch: 0, alpha: 1, spin: 0, additive: true, ...o });
export const FX = {
  spark: p({ life: .3, jitter: .45, size: .06, sizeEnd: .025, gravity: 14, drag: .4, shape: SHAPE.spark, stretch: .012, bounce: true, additive: false }),
  impact: p({ life: .34, jitter: .45, size: .06, sizeEnd: .02, gravity: 16, drag: 1.5, shape: SHAPE.spark, stretch: .03, bounce: true }),
  tongue: p({ life: .12, jitter: .35, size: .24, sizeEnd: .07, shape: SHAPE.spark, stretch: .008, additive: false }),
  flare: p({ life: .07, jitter: 0, size: .5, sizeEnd: .38, alpha: .75 }),
  burst: p({ life: .45, jitter: .35, size: .08, sizeEnd: .02, gravity: 10, drag: 2.2, shape: SHAPE.spark, stretch: .04, bounce: true }),
  ring: p({ life: .32, jitter: 0, size: .4, sizeEnd: 2.6, shape: SHAPE.ring, alpha: .9 }),
  bigRing: p({ life: .5, jitter: 0, size: 1, sizeEnd: 9, shape: SHAPE.ring, alpha: .8 }),
  smoke: p({ life: .75, jitter: .3, size: .22, sizeEnd: .85, gravity: -1.4, drag: 2.4, alpha: .32, spin: 1, additive: false }),
  puff: p({ life: .6, jitter: .3, size: .12, sizeEnd: .45, gravity: -1, drag: 2, alpha: .4, additive: false }),
  dust: p({ life: .85, jitter: .35, size: .28, sizeEnd: 1.1, gravity: -.4, drag: 2.2, alpha: .42, spin: .8, additive: false }),
  splash: p({ life: .6, jitter: .3, size: .1, sizeEnd: .16, gravity: 17, drag: .6, stretch: .025, alpha: .85, additive: false }),
  snow: p({ life: .7, jitter: .3, size: .1, sizeEnd: .22, gravity: 5, drag: 1.6, alpha: .9, additive: false }),
  ember: p({ life: .28, jitter: .4, size: .08, sizeEnd: .02, gravity: -2, drag: 3, shape: SHAPE.spark, stretch: .015 }),
  wind: p({ life: .38, jitter: .3, size: .022, sizeEnd: .018, stretch: .1, alpha: .45 }),
  sparkle: p({ life: .55, jitter: .4, size: .2, sizeEnd: 0, gravity: -.5, drag: 1, shape: SHAPE.star, spin: 2 }),
  zap: p({ life: .13, jitter: .5, size: .045, sizeEnd: .02, drag: 4, shape: SHAPE.spark, stretch: .018 }),
  bolt: p({ life: .22, jitter: .2, size: .28, sizeEnd: .12, alpha: 1 }),
  ink: p({ life: .9, jitter: .3, size: .1, sizeEnd: .07, gravity: 9, drag: .8, alpha: .95, additive: false, bounce: true }),
  confetti: p({ life: 3.4, jitter: .3, size: .11, sizeEnd: .1, gravity: 2.4, drag: 1.7, shape: SHAPE.rect, spin: 12, additive: false }),
  fire: p({ life: .6, jitter: .35, size: .9, sizeEnd: 2.1, gravity: -3, drag: 3.2, alpha: .95, additive: false, colorEnd: C(0x5a1206, .8) }),
  flash: p({ life: .12, jitter: 0, size: 1, sizeEnd: 1.6, alpha: .9 }),
  blastSmoke: p({ life: 1.5, jitter: .35, size: 1, sizeEnd: 3.2, gravity: -2.2, drag: 2.2, alpha: .55, spin: .6, additive: false }),
  debris: p({ life: 1.1, jitter: .4, size: .12, sizeEnd: .1, gravity: 22, drag: .5, shape: SHAPE.rect, spin: 14, additive: false, bounce: true }),
  shard: p({ life: .75, jitter: .35, size: .13, sizeEnd: .05, gravity: 14, drag: 1.4, shape: SHAPE.rect, spin: 16, bounce: true }),
  trail: p({ life: .35, jitter: .3, size: .22, sizeEnd: .05, drag: 1, alpha: .8 }),
  cometTail: p({ life: .5, jitter: .3, size: .7, sizeEnd: .05, drag: .6, alpha: .8, additive: false }),
  fuse: p({ life: .22, jitter: .4, size: .05, sizeEnd: .01, gravity: 6, drag: 1, shape: SHAPE.spark, stretch: .03 }),
};
/** Scratch colour for per-particle hues (emit() copies the values, so one instance is enough). */
export const scratch = new THREE.Color();
export const rainbow = (h: number, l = .6, boost = 1.8) => scratch.setHSL(((h % 1) + 1) % 1, 1, l).multiplyScalar(boost);
export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
