/** Hyrule specials: Link, Young Link, Zelda and Sheik (Ganondorf shares Captain Falcon's kit shape in cast.ts). */
import type { FighterKind } from '../model';
import { hit, one, shot, still, type Kit } from './types';

/**
 * Link and Young Link: charged bow, returning boomerang, Spin Attack (slides on the ground, rises in the air), thrown bomb.
 * `size` scales spawn points from Link's: arrows leave the bow held forward at chest height, the boomerang and bomb the throwing hand.
 */
const hylian = (arrow: string, power: number, lift: number, frames: number, size: number): Kit => ({
  n: { start: 'Start', phases: { Start: { total: 18, next: 'Loop' }, Loop: { hold: { max: 60, release: 'End', charge: true } },
    End: { shots: [shot(0, arrow, 11 * power, .35, { charge: true, gravity: .003, life: 90, r: .14, x: .55 * size, y: 1.15 * size, kbAngle: 361, kbBase: 10, kbGrowth: 60, ...(arrow === 'fire-arrow' ? { effect: 'fire' as const } : {}) })] } } },
  s: { start: '1', phases: { '1': { shots: [shot('script', 'boomerang', 9 * power, .3, { boomerang: true, aimed: true, life: 110, r: .3, x: .5 * size, y: 1.3 * size, kbAngle: 361, kbBase: 20, kbGrowth: 40, max: 1, pierce: true })] } } },
  hi: one({ ledge: 16, motion: [
    { when: 'ground', from: 0, to: 8, brake: .6 }, { when: 'ground', from: 8, steer: .06 },
    { when: 'air', from: 0, to: 8, brake: .6, gravity: .3 }, { when: 'air', from: 8, to: 8 + frames, vy: lift, steer: .075, gravity: 0 }, { when: 'air', from: 8 + frames, steer: .06, gravity: 1 },
  ] }, { helpless: true, lag: 30, once: true }),
  lw: one({ shots: [shot('script', 'bomb', 0, .06, { angle: 60, gravity: .008, bounce: .4, life: 150, r: .28, x: .5 * size, y: 1.3 * size, max: 1, blast: { r: .8, damage: 8 * power, kbBase: 30, kbGrowth: 60, angle: 70 } })] }),
});

export const ZELDA_KITS: Partial<Record<FighterKind, Kit>> = {
  link: hylian('arrow', 1, .12, 14, 1),
  'young-link': hylian('fire-arrow', .85, .15, 16, 1.45 / 1.98),
  zelda: {
    n: one({ reflect: [4, 28], motion: [{ gravity: .6, fall: .06 }] }, { stall: .04 }),
    // Din's Fire: steer the flame with the stick while holding Special; release (or its fuse) detonates it, stronger the longer it flew.
    s: { start: 'Start', helpless: true, lag: 20, phases: {
      Start: { next: 'Loop', motion: [{ brake: .8, gravity: .4, fall: .04 }], shots: [shot(20, 'dins-fire', 0, .14, { steer: .07, life: 50, r: .3, effect: 'fire', blast: { r: 1, damage: 16, kbBase: 40, kbGrowth: 70, angle: 70 } })] },
      Loop: { hold: { max: 60, release: 'End' }, tether: ['dins-fire', 'End'], motion: [{ brake: .8, gravity: .4, fall: .04 }] },
      End: { detonate: 'dins-fire' },
    } },
    hi: { start: 'Start', helpless: true, lag: 20, once: true, phases: { Start: { next: '', motion: [still] }, '': { teleport: { at: 0, dist: 4.6 }, motion: [still] } } },
    lw: one({ transform: 'sheik', motion: [still] }),
  },
  sheik: {
    // Needle Storm: charge up to six needles (Shield stores the charge); a stored full charge throws at once.
    n: { start: 'Start', charge: { max: 90, fire: 'End' }, phases: { Start: { next: 'Loop' }, Loop: { hold: { max: 90, release: 'End', charge: true, store: true } },
      End: { shots: [shot(4, 'needle', 2.4, .55, { every: 3, until: 19, count: 6, life: 40, r: .1, kbAngle: 361, kbBase: 0, kbGrowth: 40 })] } } },
    s: { start: 'Start', phases: { Start: { next: '' }, '': { next: 'End', hits: [hit(0, 6, 3, 361, 10, 60, 1.5, 1, .35, 'slash'), hit(8, 14, 3, 361, 10, 60, 1.9, .8, .35, 'slash'), hit(16, 22, 4, 70, 30, 70, 1.7, 1.2, .4, 'slash')] }, End: {} } },
    // Vanish: the deku nut bursts, Sheik vanishes (script intangibility) and reappears along the stick.
    hi: { start: 'Start', helpless: true, lag: 20, once: true, phases: { Start: { next: '', motion: [still], hits: [hit(14, 18, 12, 80, 50, 80, 0, .9, .8)] }, '': { teleport: { at: 0, dist: 4.4 }, motion: [still] } } },
    lw: one({ transform: 'zelda', motion: [still] }),
  },
};
