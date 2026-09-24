/** Pokémon specials: Pikachu, Pichu, Jigglypuff, Mewtwo. Pichu's self-damage comes from its own scripts. */
import type { FighterKind } from '../model';
import { one, shot, still, type Kit } from './types';

const hold = { brake: .8, gravity: .3, fall: .03 };
/** Pikachu and Pichu: ground-hugging Thunder Jolt, charged Skull Bash, two-zip Quick Attack/Agility, and Thunder, whose bolt striking the caster sets off the big hit. */
const rodent = (jolt: number, bash: number, zip: number, bolt: number, r: number): Kit => ({
  n: one({ shots: [shot(16, 'thunder-jolt', jolt, .1, { ground: true, angle: -30, gravity: .004, life: 90, r, kbAngle: 361, kbBase: 20, kbGrowth: 30, effect: 'electric', reflectable: true, absorbable: true })] }),
  s: { start: 'Start', helpless: true, lag: 20, once: true, phases: {
    Start: { next: 'Hold', motion: [hold] }, Hold: { hold: { max: 90, release: '', min: 1, charge: true }, motion: [hold] },
    '': { scale: bash, next: 'End', motion: [{ from: 0, to: 30, vx: .25, vy: 0, gravity: .1 }] }, End: { motion: [{ brake: .9 }] },
  } },
  // The second zip only happens when the stick is held (Melee: a new direction); neutral ends after one.
  hi: { start: 'Start', helpless: true, lag: 20, once: true, phases: {
    Start: { next: 'End', motion: [{ from: 0, to: 13, ...still }, { from: 13, to: 14, aim: zip }] },
    End: { ledge: 0, motion: [{ from: 0, to: 6, gravity: 0, drift: 0 }, { from: 6, to: 7, aim: zip * .85, stick: true }, { from: 7, to: 14, gravity: 0, drift: 0 }, { from: 14, to: 15, damp: .15 }, { from: 15, brake: .8 }] },
  } },
  lw: { start: 'Start', phases: {
    Start: { next: 'Loop', motion: [{ gravity: .3, fall: .03 }], shots: [shot(8, 'thunder', bolt, .45, { angle: -90, x: 0, y: 6.5, life: 18, r: .45, kbAngle: 80, kbBase: 40, kbGrowth: 70, effect: 'electric', pierce: true, reflectable: false, self: 'Loop#2' })] },
    Loop: { total: 30, next: 'End', tether: ['thunder', 'End'], motion: [{ gravity: .3, fall: .03 }] },
    'Loop#2': { next: 'End' }, End: {},
  } },
});

export const POKEMON_KITS: Partial<Record<FighterKind, Kit>> = {
  pikachu: rodent(6, 5, .5, 8, .25),
  pichu: rodent(5, 5, .52, 7, .22),
  jigglypuff: {
    // Rollout: charge, roll (turns back off a hit), keeps rolling along the floor and slows in the air.
    n: { start: 'StartR', phases: {
      StartR: { next: '', motion: [{ brake: .85, gravity: .3, fall: .04 }] }, '': { hold: { max: 60, release: '#3', charge: true }, motion: [{ brake: .85, gravity: .3, fall: .04 }] },
      '#3': { scale: 2, next: 'EndR', onHit: 'Bump', motion: [{ when: 'ground', vx: .26 }, { when: 'air', brake: .97 }] },
      Bump: { script: 'EndR', motion: [{ from: 0, to: 1, vx: -.1, vy: .12 }, { from: 1, brake: .97 }] }, EndR: { motion: [{ brake: .9 }] },
    } },
    s: one({ motion: [{ vx: .08, gravity: .5, fall: .05 }] }, { stall: .06 }),
    hi: { start: 'L', phases: { L: { sleep: 150, motion: [{ gravity: .3, fall: .03 }] } } },
    lw: { start: 'L', phases: { L: { total: 20, rest: 230, motion: [{ vx: 0, gravity: .5, fall: .05 }] } } }, // Rest: the hit on frame 1, then asleep for the rest of the 250-frame script
  },
  mewtwo: {
    n: { start: 'Start', charge: { max: 120, fire: 'End' }, phases: {
      Start: { next: 'Loop' }, Loop: { hold: { max: 120, release: 'End', charge: true, store: true } },
      End: { shots: [shot(6, 'shadow-ball', 25, .2, { charge: true, life: 80, r: .5, kbAngle: 361, kbBase: 30, kbGrowth: 60, effect: 'darkness', reflectable: true, absorbable: true })] },
    } },
    s: one({ reflect: [12, 39], reverse: true, motion: [{ gravity: .4, fall: .04 }] }, { stall: .04 }),
    hi: { start: 'Start', helpless: true, lag: 20, once: true, phases: { Start: { next: '', motion: [still] }, '': { teleport: { at: 0, dist: 5.2 }, intangible: [0, 12], next: 'Lost', motion: [still] }, Lost: {} } },
    // Disable: freezes a grounded foe who is facing Mewtwo.
    lw: one({ shots: [shot(12, 'disable', 0, .12, { life: 18, r: .45, effect: 'psychic', flinch: false, reflectable: true, stun: 100 })], motion: [{ gravity: .5 }] }),
  },
};
