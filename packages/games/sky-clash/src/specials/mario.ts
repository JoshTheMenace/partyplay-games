/** Mushroom Kingdom, Yoshi's Island and DK specials: Mario, Dr. Mario, Luigi, Peach, Bowser, Giga Bowser, Yoshi, Donkey Kong. */
import type { FighterKind } from '../model';
import { hit, one, rise, shot, still, weighted, type Kit, type Shot } from './types';

const fireball = (damage: number, bounce: number, o: Partial<Shot> = {}) => shot('script', 'fireball', damage, .11, { angle: -25, gravity: .007, bounce, life: 80, r: .26, kbAngle: 361, kbBase: 18, kbGrowth: 22, effect: 'fire', reflectable: true, absorbable: true, ...o });
/** Mario and Dr. Mario: bouncing fireball/pill, Cape (reflects and turns foes, small stall), Super Jump Punch (coins), Tornado (mash to rise, once per airtime). */
const plumber = (fire: Shot, jump: number): Kit => ({
  n: one({ shots: [fire] }),
  s: one({ reflect: [6, 34], reverse: true }, { stall: .02 }),
  hi: one({ motion: rise(3, 21, jump, .011, .03), ledge: 16 }, { helpless: true, lag: 18, once: true }),
  lw: one({ motion: [{ gravity: .45, fall: .05, steer: .045, mash: .045 }] }, { once: true }),
});
const hold = { brake: .8, gravity: .3, fall: .03 };
const turnip = (damage: number, growth: number) => ({ script: '', total: 40, shots: [shot(20, 'turnip', damage, .22, { angle: 10, gravity: .006, life: 80, r: .25, kbAngle: 361, kbBase: 10, kbGrowth: growth })] });
const klaw = (from: number) => ({ from, up: 'Bite', side: 'EndF', down: 'Bite', back: 'EndB', neutral: 'Bite' });
/** Bowser's kit; Giga Bowser plays it harder and bigger. Klaw is a command grab: bite (Special), throw forward or back (Special + direction). */
const koopa = (power: number, size: number): Kit => ({
  n: { start: 'Start', power, phases: { Start: { next: '' }, '': { total: 120, hold: { max: 120, release: 'End' }, motion: [{ brake: .8, gravity: .5, fall: .06 }],
    // Melee's flame weakens as its fuel runs down: flames stop after 1.6 s of breathing.
    shots: [shot(0, 'flame', 1.6, .1, { every: 6, until: 96, life: 16 * size, r: .45 * size, kbAngle: 40, kbBase: 5, kbGrowth: 30, effect: 'fire' })] }, End: {} } },
  s: { start: 'Start', power, phases: {
    Start: { grab: 'Hold' },
    Hold: { total: 70, next: 'EndF', combo: klaw(4), motion: [still] },
    Bite: { script: 'Hit', pummel: true, next: 'Hold', combo: klaw(22), motion: [still] },
    EndF: { release: { at: 18, damage: 10, angle: 45, kbBase: 60, kbGrowth: 55 }, motion: [still] },
    EndB: { release: { at: 18, damage: 10, angle: 45, kbBase: 60, kbGrowth: 55, back: true }, motion: [still] },
  } },
  hi: one({ motion: [{ when: 'ground', steer: .1, drift: 0 }, { when: 'air', from: 0, to: 5, ...still }, { when: 'air', from: 5, to: 6, vy: .16 }, { when: 'air', from: 6, steer: .075, ay: -.005, gravity: 0, fall: .06 }] }, { helpless: true, lag: 25, once: true, power }),
  lw: { start: '', air: 'Air', power, phases: {
    '': { land: 'Landing', motion: [{ from: 0, to: 12, vy: .22, gravity: 0, brake: .9 }, { from: 12, to: 18, ...still }, { from: 18, vy: -.55, vx: 0, gravity: 0 }], hits: [hit(2, 10, 7, 80, 50, 60, .5, 1, .7 * size), hit(18, 999, 20, 80, 50, 80, 0, .2, .9 * size)] },
    Air: { script: '', land: 'Landing', motion: [{ from: 0, to: 8, ...still }, { from: 8, vy: -.55, vx: 0, gravity: 0 }], hits: [hit(8, 999, 20, 80, 50, 80, 0, .2, .9 * size)] },
    Landing: {},
  } },
});

export const MARIO_KITS: Partial<Record<FighterKind, Kit>> = {
  mario: plumber(fireball(5, .85), .26),
  'dr-mario': plumber(fireball(7, .95, { kind: 'pill', effect: 'normal', life: 95, speed: .1 }), .245),
  luigi: {
    n: one({ shots: [shot('script', 'fireball', 6, .12, { life: 70, r: .25, kbAngle: 361, kbBase: 20, kbGrowth: 20, effect: 'fire', reflectable: true, absorbable: true })] }),
    // Green Missile: charge, then launch; one launch in eight misfires (the script's 25% '#2') and flies much farther.
    s: { start: 'Start', once: true, phases: {
      Start: { next: 'Hold', motion: [hold] }, Hold: { hold: { max: 60, release: 'Fire', min: 1, charge: true }, motion: [hold] },
      Fire: { random: weighted(['', 7], ['#2', 1]) },
      '': { scale: 2.2, next: 'End', onHit: 'End', motion: [{ from: 0, to: 22, vx: .3, vy: .02, gravity: 0 }, { from: 22, brake: .9 }] },
      '#2': { next: 'End', onHit: 'End', motion: [{ from: 0, to: 28, vx: .48, vy: .03, gravity: 0 }, { from: 28, brake: .9 }] },
      End: { motion: [{ brake: .95 }] },
    } },
    hi: one({ motion: rise(5, 22, .36, .018, .015), ledge: 18 }, { helpless: true, lag: 30, once: true }),
    lw: one({ motion: [{ gravity: .4, fall: .05, steer: .06, mash: .05 }] }, { once: true }),
  },
  peach: {
    float: 150,
    // Toad: a counter that answers with a burst of spores.
    n: { start: '', phases: { '': { counter: [4, 24, 'Spore'], motion: [{ gravity: .4, fall: .04 }] },
      Spore: { total: 30, hits: [hit(2, 6, 4, 80, 30, 40, .9, .9, .9, 'grass'), hit(8, 12, 4, 80, 30, 40, .9, .9, .9, 'grass'), hit(14, 18, 5, 70, 50, 70, .9, .9, 1, 'grass')] } } },
    s: { start: 'Start', once: true, phases: {
      Start: { next: 'Jump', motion: [{ brake: .7, gravity: .3 }] },
      Jump: { next: 'End', onHit: 'Bounce', motion: [{ vx: .22, vy: .03, gravity: 0 }], hits: [hit(0, 10, 12, 60, 40, 70, .4, .9, .6)] },
      Bounce: { script: 'End', motion: [{ from: 0, to: 6, vx: -.08, vy: .08, gravity: 0 }, { from: 6, brake: .9 }] },
      End: { motion: [{ brake: .9 }] },
    } },
    // Parasol: rise, then drift down under the open parasol until landing (4 s at most), ledges grabbable.
    hi: { start: 'Start', helpless: true, lag: 20, once: true, phases: {
      Start: { next: 'End', motion: rise(4, 24, .25, .01, .02), ledge: 18 },
      End: { total: 240, ledge: 0, motion: [{ fall: .045, drift: 1, gravity: .5 }] },
    } },
    // Vegetable: pull a random turnip and throw it (smile, wink, dot eyes, the rare stitch face).
    lw: { start: 'Pull', groundOnly: true, phases: {
      Pull: { random: weighted(['Smile', 13], ['Wink', 4], ['Dot', 2], ['Stitch', 1]) },
      Smile: turnip(6, 60), Wink: turnip(10, 60), Dot: turnip(17, 70), Stitch: turnip(34, 90),
    } },
  },
  bowser: koopa(1, 1),
  'giga-bowser': { ...koopa(1, 1.35), power: 1.3, weight: 170 },
  yoshi: {
    // Egg Lay: the tongue grabs and traps the foe in an egg they mash out of.
    n: { start: '1', phases: { '1': { grab: '2' }, '2': { release: { at: 20, damage: 7, angle: 45, kbBase: 30, kbGrowth: 30, stuck: 70 } } } },
    // Egg Roll: rolls along the floor until Special is pressed again; in the air it slows and falls.
    s: { start: 'Start', once: true, phases: { Start: { next: 'Loop', motion: [{ brake: .8 }] }, Loop: { total: 90, next: 'End', repress: { from: 10, to: 'End' }, motion: [{ when: 'ground', vx: .19, steer: .01 }, { when: 'air', brake: .95, steer: .03 }] }, End: { motion: [{ brake: .9 }] } } },
    hi: one({ shots: [shot(18, 'egg', 0, .2, { aimed: true, angle: 55, gravity: .008, life: 70, r: .3, blast: { r: .7, damage: 6, kbBase: 30, kbGrowth: 60, angle: 70 } })] }, { stall: .16 }),
    lw: { start: '', air: 'Air', phases: {
      '': { land: 'Landing', motion: [{ from: 0, to: 12, vy: .22, gravity: 0 }, { from: 12, to: 20, ...still }, { from: 20, vy: -.5, vx: 0, gravity: 0 }], hits: [hit(20, 999, 14, 80, 40, 80, 0, .2, .8)] },
      Air: { script: '', land: 'Landing', motion: [{ from: 0, to: 8, ...still }, { from: 8, vy: -.5, vx: 0, gravity: 0 }], hits: [hit(8, 999, 14, 80, 40, 80, 0, .2, .8)] },
      Landing: { shots: [shot(1, 'star', 4, .12, { life: 20, r: .3, kbAngle: 45, kbBase: 20, kbGrowth: 50 }), shot(1, 'star', 4, -.12, { life: 20, r: .3, kbAngle: 45, kbBase: 20, kbGrowth: 50 })] },
    } },
  },
  'donkey-kong': {
    n: { start: 'Start', charge: { max: 120, fire: '#2' }, phases: {
      Start: { next: 'Loop' }, Loop: { hold: { max: 120, release: '', full: '#2', charge: true, store: true } }, '': { scale: 2.5 }, '#2': {},
    } },
    // Headbutt: plants grounded foes (they mash free); meteors airborne ones (script angle 270).
    s: one({ bury: 80 }),
    hi: one({ motion: [{ when: 'ground', steer: .1, drift: 0 }, { when: 'air', from: 0, to: 1, vy: .12 }, { when: 'air', from: 1, steer: .08, gravity: .6, fall: .04 }] }, { helpless: true, lag: 25, once: true }),
    lw: { start: 'Start', groundOnly: true, phases: { Start: { next: 'Loop' }, Loop: { repress: { from: 4, to: 'Loop' }, next: 'End' }, End: {} } },
  },
};
