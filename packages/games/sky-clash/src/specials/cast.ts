/**
 * The rest of the cast: Fox, Falco, Captain Falcon, Ganondorf, Kirby, Ness, Popo, Nana, Samus, Marth, Roy, Mr. Game & Watch.
 * Fox, Marth and Kirby were reconstructed first (engine) and are kept with small fixes.
 */
import type { FighterKind } from '../model';
import { charged, counter, dancing, hit, one, reflector, rise, shot, still, type Kit, type Shot, type Special } from './types';

const laser = (damage: number, speed: number, flinch: boolean) => shot(5, 'laser', damage, speed, { flinch, life: 50, r: .14, kbAngle: 361, kbBase: flinch ? 5 : 0, kbGrowth: flinch ? 40 : 0, effect: 'electric', reflectable: true, absorbable: true });
const blaster = (damage: number, speed: number, flinch: boolean): Special => ({ start: 'Start', phases: {
  Start: { next: 'Loop' }, Loop: { hold: { max: 99999, release: 'End' }, shots: [laser(damage, speed, flinch)] }, End: { repress: { from: 4, to: 'Loop' } },
} });
/** Fire Fox / Fire Bird: burn in place (script hits), then fly where the stick points. */
const firefox = (speed: number, travel: number): Special => ({ start: 'Hold', helpless: true, lag: 20, once: true, phases: {
  Hold: { next: '', motion: [{ brake: .85, gravity: .12, fall: .03 }] },
  '': { total: travel, next: 'Fall', land: 'Landing', ledge: 0, motion: [{ from: 0, to: 1, aim: speed }, { from: 1, gravity: 0 }] },
  Landing: {}, Fall: { motion: [{ from: 0, to: 1, damp: .3 }] },
} });
/** Fox Illusion / Falco Phantasm: a 4-frame dash with its own hit (the scripts carry none). */
const illusion = (speed: number, damage: number, angle: number): Special => ({ start: 'Start', helpless: true, lag: 10, once: true, phases: {
  Start: { next: '', motion: [still] },
  '': { total: 4, next: 'End', motion: [{ vx: speed, vy: 0, gravity: 0 }], hits: [hit(0, 4, damage, angle, 40, 60, .2, .9, .55)] },
  End: { motion: [{ from: 0, to: 12, brake: .75, gravity: 0, vy: 0 }, { from: 12, brake: .95 }] },
} });
/** Captain Falcon and Ganondorf: punch, a lunge that uppercuts (or meteors in the air) on contact, the grabbing dive, a kick that dives in the air. */
export const falcon = (dive: number, kick: number, power = 1): Kit => ({
  n: one({ motion: [{ from: 0, to: 45, gravity: .2, fall: .02 }] }, { power }),
  s: { start: 'Start', helpless: true, lag: 20, once: true, power, phases: {
    Start: { onHit: '', motion: [{ from: 0, to: 15, brake: .7, gravity: .2 }, { from: 15, to: 35, vx: .21, gravity: .1 }, { from: 35, brake: .85 }] }, '': {},
  } },
  hi: { start: '', helpless: true, lag: 20, once: true, power, phases: {
    '': { grab: 'Catch', ledge: 20, motion: [{ from: 0, to: 13, brake: .5, vy: .02, gravity: 0 }, { from: 13, to: 34, vy: dive, ay: -.006, steer: .03, gravity: 0 }, { from: 34, to: 35, damp: .2 }] },
    Catch: { next: 'Throw', pummel: true, motion: [still] },
    Throw: { release: { at: 2, damage: 10, angle: 45, kbBase: 70, kbGrowth: 60, effect: 'fire' }, motion: [{ from: 0, to: 10, ...still }, { from: 10, vy: .2, vx: -.04, gravity: 1 }] },
  } },
  lw: { start: '', air: 'Air', power, phases: {
    '': { land: 'End', motion: [{ from: 0, to: 14, brake: .6 }, { from: 14, to: 34, vx: kick, gravity: 0, vy: 0 }, { from: 34, brake: .8 }] },
    Air: { script: '', land: 'End', motion: [{ from: 0, to: 14, brake: .8, gravity: .2 }, { from: 14, to: 34, vx: kick * .8, vy: -kick * .8, gravity: 0 }, { from: 34, brake: .9 }] },
    End: { motion: [{ brake: .8 }] },
  } },
});
/** Popo and Nana (each climber runs this kit; the pair and its desyncs come from the engine's partner echo): Ice Shot, Squall Hammer (mash to rise, once per airtime), Belay (the solo climber still reaches a paired height), Blizzard. */
const climber = (): Kit => ({
  n: one({ shots: [shot(18, 'ice', 4, .14, { ground: true, life: 70, r: .25, kbAngle: 361, kbBase: 5, kbGrowth: 30, effect: 'ice', reflectable: true, absorbable: true })] }),
  s: { start: '1', once: true, phases: { '1': { motion: [{ vx: .07, steer: .02, gravity: .6, fall: .06, mash: .08 }] } } },
  hi: { start: 'Start', helpless: true, lag: 30, once: true, phases: { Start: { next: 'Throw', motion: [still] }, Throw: { next: 'Throw2', motion: [...rise(0, 22, .21, .012, .045), { from: 23, steer: .045 }], ledge: 8 }, Throw2: { ledge: 0 } } },
  lw: one({ shots: [shot(6, 'blizzard', 1, .1, { every: 4, until: 50, life: 14, r: .4, kbAngle: 361, kbBase: 0, kbGrowth: 30, effect: 'ice' })] }),
});
const missile = (damage: number, o: Partial<Shot>) => shot('script', 'missile', damage, .12, { life: 110, r: .25, kbAngle: 361, kbBase: 25, kbGrowth: 40, effect: 'fire', reflectable: true, max: 2, ...o });

export const CAST_KITS: Partial<Record<FighterKind, Kit>> = {
  fox: { n: blaster(3, .5, false), s: illusion(18 * .08, 7, 361), hi: firefox(.25, 30), lw: reflector() },
  falco: { n: blaster(3, .36, true), s: illusion(18 * .08, 7, 270), hi: firefox(.22, 24), lw: reflector() },
  'captain-falcon': falcon(.21, .22),
  ganondorf: falcon(.19, .2),
  kirby: {
    n: { start: '', phases: {
      '': { next: 'Loop', grab: 'Eat' }, Loop: { grab: 'Eat', hold: { max: 90, release: 'End' } }, End: {},
      Eat: { total: 120, next: 'Spit', repress: { from: 4, to: 'Spit', attack: true }, motion: [{ gravity: .6, fall: .05, steer: .025 }] },
      Spit: { release: { at: 8, damage: 10, angle: 35, kbBase: 60, kbGrowth: 60, effect: 'star' } },
    } },
    s: one({ motion: [{ gravity: .45, fall: .06 }] }, { stall: .03 }),
    hi: { start: '1', phases: {
      '1': { next: '2', motion: [{ from: 0, to: 6, ...still }, { from: 6, to: 23, vx: .07, vy: .25, ay: -.016, gravity: 0 }] }, // rises carrying forward
      '2': { next: '3', land: '4', ledge: 12, motion: [{ from: 0, to: 12, vx: 0, vy: 0, gravity: 0 }, { from: 12, vy: -.34, vx: 0, gravity: 0 }] },
      '3': { next: '3', land: '4', ledge: 0, motion: [{ vy: -.34, vx: 0, gravity: 0 }], hits: [hit(0, 5, 2, 275, 0, 100, .35, .45, .45, 'slash')] },
      '4': { shots: [shot(1, 'wave', 4, .15, { ground: true, life: 32, r: .32, kbAngle: 60, kbBase: 30, kbGrowth: 50, reflectable: true })] },
    } },
    // Stone: heavy armor that gives way after soaking 25%; Special exits after a moment.
    lw: { start: '1', phases: {
      '1': { next: '2', motion: [still] },
      '2': { total: 180, next: '2#2', armor: [0, 999], armorHp: 25, land: '2', repress: { from: 20, to: '2#2' }, motion: [{ vx: 0, vy: -.4, gravity: 0 }] },
      '2#2': {},
    } },
  },
  ness: {
    // PK Flash: the orb drifts where the stick steers it; releasing Special (or its 2 s fuse) detonates it, bigger the longer it grew.
    n: { start: 'Start', phases: {
      Start: { next: 'Hold', motion: [{ gravity: .4, fall: .04 }], shots: [shot(14, 'pk-flash', 0, .07, { angle: 70, gravity: .0012, steer: .05, life: 120, r: .3, effect: 'psychic', blast: { r: 1.5, damage: 30, kbBase: 30, kbGrowth: 90 } })] },
      Hold: { hold: { max: 120, release: 'End' }, tether: ['pk-flash', 'End'], motion: [{ gravity: .4, fall: .04 }] }, End: { detonate: 'pk-flash' },
    } },
    // PK Fire: the spark becomes a pillar that traps and re-hits (angled down in the air).
    s: { start: '', air: 'Air', phases: {
      '': { shots: [shot('script', 'pk-fire', 5, .28, { angle: -8, life: 22, r: .3, kbAngle: 50, kbBase: 25, kbGrowth: 40, effect: 'fire', reflectable: true, absorbable: true, pillar: [45, 1.5] })] },
      Air: { script: '', shots: [shot('script', 'pk-fire', 5, .28, { angle: -35, life: 26, r: .3, kbAngle: 50, kbBase: 25, kbGrowth: 40, effect: 'fire', reflectable: true, absorbable: true, pillar: [45, 1.5] })] },
    } },
    // PK Thunder: steer the bolt with the stick; hitting Ness launches him along the bolt's path (PK Thunder 2).
    hi: { start: 'Start', helpless: true, lag: 30, once: true, phases: {
      Start: { next: 'Hold', land: 'keep', motion: [{ brake: .9, gravity: .3, fall: .03, drift: 0 }], shots: [shot(12, 'pk-thunder', 8, .24, { angle: 90, x: 0, y: 1.9, steer: .2, self: '', life: 100, r: .3, kbAngle: 70, kbBase: 30, kbGrowth: 50, effect: 'electric', reflectable: true, absorbable: true })] },
      Hold: { total: 100, next: 'End', land: 'keep', tether: ['pk-thunder', 'End'], motion: [{ brake: .92, gravity: .25, fall: .03, drift: 0 }] },
      '': { ledge: 4, motion: [{ from: 0, to: 1, launch: .3 }, { from: 1, to: 22, gravity: 0, drift: 0 }, { from: 22, to: 23, damp: .25 }, { from: 23, brake: .9, gravity: .6 }] },
      End: {},
    } },
    lw: { start: 'Start', phases: { Start: { next: 'Hold', absorb: [4, 99] }, Hold: { hold: { max: 90, release: 'End' }, absorb: [0, 999], motion: [{ gravity: .3, fall: .04 }] }, End: {} } },
  },
  popo: climber(),
  nana: climber(),
  samus: {
    n: { start: 'Start', charge: { max: 90, fire: '' }, phases: {
      Start: { next: 'Hold' }, Hold: { hold: { max: 90, release: '', charge: true, store: true } },
      '': { shots: [shot(4, 'charge-shot', 25, .26, { charge: true, life: 90, r: .5, kbAngle: 361, kbBase: 35, kbGrowth: 60, effect: 'electric', reflectable: true, absorbable: true })] },
    } },
    // Missile: homing by default; flicking the stick fires the straight, faster Super Missile.
    s: { start: '', smash: 'Super', phases: { '': { shots: [missile(6, { homing: .006 })] }, Super: { script: '', shots: [missile(10, { speed: .24, life: 80 })] } } },
    hi: one({ motion: rise(4, 22, .23, .007, .03), ledge: 16 }, { helpless: true, lag: 25, once: true }),
    lw: { start: '#2', stall: .05, phases: { '#2': { motion: [{ gravity: .8 }], shots: [shot('script', 'bomb', 0, 0, { life: 55, r: .3, gravity: .004, max: 3, effect: 'fire', blast: { r: .9, damage: 5, kbBase: 20, kbGrowth: 50, angle: 90 } })] } } },
  },
  marth: {
    n: charged('Start', 'Loop', 'End', 72, { scale: 4 }, 'End#2'),
    s: dancing(),
    hi: one({ motion: rise(5, 20, .42, .018, 0, 18), ledge: 14 }, { helpless: true, lag: 30 }),
    lw: counter([5, 30]),
  },
  roy: {
    n: charged('Start', 'Loop', 'End', 72, { scale: 8 }, 'End#2'),
    s: dancing(),
    hi: one({ motion: rise(9, 22, .38, .02, .015, 14), ledge: 16 }, { helpless: true, lag: 30 }),
    lw: counter([8, 21], 1.5),
  },
  'game-watch': {
    n: one({ repress: { from: 22, to: '' }, shots: [shot(20, 'sausage', 4, .12, { angle: 60, gravity: .007, life: 60, r: .22, kbAngle: 361, kbBase: 20, kbGrowth: 30, effect: 'fire', max: 5 })] }),
    // Judgment: a seeded 1–9 (Judge 1 costs Game & Watch 12%, straight from its script).
    s: { start: 'pick', phases: { pick: { random: ['', '#2', '#3', '#4', '#5', '#6', '#7', '#8', '#9'] }, '': {}, '#2': {}, '#3': {}, '#4': {}, '#5': {}, '#6': {}, '#7': {}, '#8': {}, '#9': {} } },
    hi: one({ motion: rise(0, 16, .4, .02, .03), ledge: 12 }, { helpless: true, lag: 20, once: true }),
    // Oil Panic: three absorbed shots fill the bucket; the next use throws the oil for twice their damage.
    lw: { start: '', bucket: { count: 3, fire: 'Shoot', mult: 2 }, phases: { '': { absorb: [3, 40], bucket: true, motion: [{ gravity: .5, fall: .05 }] },
      Shoot: { script: '-', total: 50, hits: [hit(4, 16, 1, 361, 40, 90, .9, .8, 1.1)], motion: [{ gravity: .5, fall: .05 }] } } },
  },
};
