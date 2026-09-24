/**
 * Bonus fighters: adapted kits on their borrowed profile's scripts (the hands borrow Mewtwo, the wireframes Captain Falcon
 * and Zelda, Sandbag Mario; Giga Bowser lives with Bowser in mario.ts). `script: '-'` drops the borrowed script's windows
 * where the bonus move is its own attack. The hands borrow a light, floaty frame, so they hit harder and weigh more (kit
 * `power`/`weight`, like Giga Bowser); tools/balance.ts keeps every bonus fighter fun but not dominant.
 */
import type { FighterKind } from '../model';
import { falcon } from './cast';
import { hit, one, rise, shot, still, type InlineHit, type Kit, type Motion, type Shot, type Special } from './types';

/** Hop (on the ground) then drive down; landing sets off a ground wave both ways. */
const slam = (damage: number, wave: number, effect?: InlineHit['effect']): Special => {
  const drop = (at: number) => [hit(at, 999, damage, 80, 50, 70, .2, .2, .8, effect)], fall = (from: number, at: number): Motion[] => [{ from, to: at, ...still }, { from: at, vy: -.5, vx: 0, gravity: 0 }];
  return { start: '', air: 'Air', phases: {
    '': { script: '-', total: 60, land: 'Slam', motion: [{ from: 0, to: 10, vy: .16, gravity: 0, brake: .8 }, ...fall(10, 16)], hits: drop(16) },
    Air: { script: '-', total: 60, land: 'Slam', motion: fall(0, 8), hits: drop(8) },
    Slam: { script: '-', total: 26, motion: [still], shots: [1, -1].map(d => shot(1, 'wave', wave, .14 * d, { ground: true, life: 24, r: .3, kbAngle: 70, kbBase: 30, kbGrowth: 50, ...(effect ? { effect } : {}) })) },
  } };
};
/** Multi-hit crawl forward (Finger Walk, Spider Rush). */
const crawl = (speed: number, damage: number, effect?: InlineHit['effect']): Special => one({ script: '-', total: 44,
  motion: [{ from: 0, to: 8, brake: .6 }, { from: 8, to: 36, vx: speed, gravity: .5 }, { from: 36, brake: .8 }],
  hits: [10, 17, 24].map(at => hit(at, at + 4, damage, 361, 15, 30, .6, .35, .55, effect)).concat(hit(31, 36, damage * 2, 45, 50, 70, .7, .4, .6, effect)) });
/** Ascend: the hand floats straight up under stick control. */
const ascend: Special = { start: 'Start', helpless: true, lag: 20, once: true, phases: { Start: { next: 'Up', motion: [still] }, Up: { total: 30, ledge: 0, motion: rise(0, 30, .14, .01, .05) } } };
const fingerShot = (kind: string, damage: number, speed: number, o: Partial<Shot> = {}): Special => ({ start: 'Start', phases: { Start: { next: 'End' }, End: { shots: [shot(4, kind, damage, speed, { life: 60, r: .16, kbAngle: 361, kbBase: 8, kbGrowth: 40, reflectable: true, absorbable: true, ...o })] } } });

export const BONUS_KITS: Partial<Record<FighterKind, Kit>> = {
  'master-hand': { power: 1.25, weight: 110,
    n: fingerShot('finger-bullet', 4, .38, { every: 6, until: 16 }),
    s: crawl(.14, 3),
    hi: ascend,
    lw: slam(14, 5),
  },
  'crazy-hand': { power: 1.25, weight: 110,
    n: fingerShot('spark-shot', 8, .16, { r: .3, gravity: .006, bounce: .8, life: 90, effect: 'electric', kbBase: 20, kbGrowth: 50 }),
    s: crawl(.2, 2, 'electric'),
    hi: ascend,
    // Crush: grab whoever is in front and squeeze them up and away.
    lw: { start: '', phases: {
      '': { script: '-', total: 36, grab: 'Crush', hits: [hit(10, 18, 0, 0, 0, 0, .8, .7, .6)], motion: [{ brake: .7, gravity: .5 }] },
      Crush: { script: '-', total: 30, release: { at: 18, damage: 13, angle: 80, kbBase: 60, kbGrowth: 70 }, motion: [still] },
    } },
  },
  // Male Wireframe: Captain Falcon's lunge, dive and kick at 80%, with a quick Energy Strike in place of the Falcon Punch.
  'male-wireframe': { ...falcon(.21, .2, .8), n: one({ script: '-', total: 46, hits: [hit(18, 22, 13, 361, 30, 85, .8, 1.1, .5, 'electric')], motion: [{ from: 0, to: 30, gravity: .2, fall: .02 }] }) },
  'female-wireframe': {
    n: one({ script: '-', total: 40, shots: [shot(14, 'energy-orb', 8, .14, { life: 80, r: .3, kbAngle: 361, kbBase: 20, kbGrowth: 50, effect: 'magic', reflectable: true, absorbable: true })], motion: [{ gravity: .6, fall: .06 }] }),
    s: { start: 'Start', helpless: true, lag: 20, phases: {
      Start: { next: 'Loop', motion: [{ brake: .8, gravity: .4, fall: .04 }], shots: [shot(18, 'dins-fire', 0, .16, { steer: .05, life: 30, r: .28, effect: 'fire', blast: { r: .8, damage: 11, kbBase: 40, kbGrowth: 60, angle: 60 } })] },
      Loop: { hold: { max: 40, release: 'End' }, tether: ['dins-fire', 'End'], motion: [{ brake: .8, gravity: .4, fall: .04 }] }, End: { detonate: 'dins-fire' },
    } },
    hi: { start: 'Start', helpless: true, lag: 20, once: true, phases: { Start: { next: '', motion: [still] }, '': { teleport: { at: 0, dist: 4.2 }, motion: [still] } } },
    lw: one({ script: '-', total: 36, reflect: [4, 20], hits: [hit(4, 8, 6, 361, 50, 60, 0, .9, 1, 'magic')], motion: [{ gravity: .5, fall: .05 }] }),
  },
  sandbag: { power: .9, // a touch softer: its tanky Mario frame and strong rise already carry it
    n: one({ shots: [-8, 8, 24].map(angle => shot(12, 'sand', 3, .2, { angle, life: 14, r: .3, kbAngle: 361, kbBase: 10, kbGrowth: 30 })) }),
    s: one({ script: '-', total: 36, motion: [{ from: 0, to: 8, brake: .6 }, { from: 8, to: 22, vx: .2, gravity: .3 }, { from: 22, brake: .8 }], hits: [hit(8, 22, 9, 45, 40, 70, .4, .7, .55)] }, { once: true }),
    hi: one({ script: '-', total: 40, ledge: 12, motion: rise(4, 22, .3, .012, .035), hits: [hit(4, 10, 6, 80, 50, 60, 0, 1, .6)] }, { helpless: true, lag: 16, once: true }),
    lw: slam(12, 4),
  },
};
