import type { Good } from '../../model';
import type { Synth } from './synth';

/** EXPERIENCE §5 recipes. Kept round and low-passed so they sit under the 22% soundtrack. */
export type SoundName =
  | 'dice' | 'seven' | 'resource' | 'route' | 'settlement' | 'city' | 'robber' | 'steal'
  | 'turn' | 'offer' | 'trade' | 'tick' | 'barbarians' | 'victory';

export const GOOD_PITCH: Record<Good, number> = {
  wood: 660, brick: 740, wool: 880, grain: 990, ore: 523, paper: 1175, cloth: 1047, coin: 1319,
};

/** Struck bar: sine fundamental plus a quick fourth-harmonic "tok", like a marimba key. */
const mallet = (s: Synth, hz: number, at: number, len: number, peak: number) => {
  s.tone('sine', hz, at, len, peak);
  s.tone('sine', hz * 4, at, len * 0.25, peak * 0.12);
};
const thock = (s: Synth, at: number, peak: number) => {
  s.tone('sine', 180, at, 0.1, peak, { to: 90, attack: 0.002 });
  s.noise(at, 0.012, peak * 0.2, ['lowpass', 1400]);
};
const growl = (s: Synth, at: number, peak: number) => {
  for (const hz of [110, 116]) {
    s.tone('sawtooth', hz, at, 0.45, peak / 2, { to: 82, attack: 0.03, filter: ['lowpass', 600, 0.5] });
  }
};

export const RECIPES: Record<SoundName, (s: Synth, good?: Good) => void> = {
  dice(s) {
    // Irregular rattle, then the two dice settle on the table at 450 ms.
    let at = 0;
    for (let i = 0; i < 6; i++, at += 0.04 + Math.random() * 0.05) {
      s.noise(at, 0.025, 0.3 + Math.random() * 0.2, ['bandpass', 2500, 1.2]);
    }
    for (const click of [0.45, 0.47]) s.tone('triangle', 1800, click, 0.012, 0.35, { attack: 0.001 });
  },
  seven: s => growl(s, 0, 0.35),
  resource(s, good = 'grain') {
    s.tone('triangle', GOOD_PITCH[good], 0, 0.07, 0.18, { attack: 0.003, filter: ['lowpass', 3200] });
  },
  route(s) {
    s.tone('sine', 220, 0, 0.09, 0.4, { to: 110, attack: 0.002 });
    s.noise(0, 0.01, 0.12, ['bandpass', 2600, 0.9]);
  },
  settlement(s) { thock(s, 0, 0.45); thock(s, 0.08, 0.4); },
  city(s) {
    thock(s, 0, 0.45); thock(s, 0.08, 0.4);
    s.tone('sine', 1047, 0.1, 0.4, 0.22, { attack: 0.006 });
    s.tone('sine', 1568, 0.1, 0.36, 0.14, { attack: 0.006 });
  },
  robber(s) {
    const wobble = s.tone('sine', 98, 0, 0.35, 0.3, { attack: 0.04 });
    s.lfo(wobble.frequency, 7, 12, 0, 0.35);
    s.tone('sine', 120, 0.35, 0.1, 0.35, { to: 48, attack: 0.002 });
    s.noise(0.35, 0.06, 0.12, ['lowpass', 350]);
  },
  steal(s) { s.noise(0, 0.22, 0.25, ['bandpass', 800, 1.4], { attack: 0.09, sweepTo: 3000 }); },
  turn(s) { mallet(s, 523, 0, 0.18, 0.3); mallet(s, 784, 0.09, 0.2, 0.28); },
  offer(s) { s.tone('triangle', 660, 0, 0.12, 0.2, { attack: 0.003, filter: ['lowpass', 2400] }); },
  trade(s) { [523, 659, 784].forEach((hz, i) => mallet(s, hz, i * 0.06, 0.2, 0.3)); },
  tick(s) { s.tone('square', 1000, 0, 0.025, 0.15, { attack: 0.001, filter: ['lowpass', 3000] }); },
  barbarians(s) {
    for (let i = 0; i < 3; i++) s.tone('sine', 72, i * 0.15, 0.2, 0.5, { to: 56, attack: 0.003 });
    growl(s, 0.45, 0.3);
  },
  victory(s) {
    const notes = [523, 659, 784, 1047];
    notes.forEach((hz, i) => {
      s.tone('triangle', hz, i * 0.11, 0.28, 0.4, { filter: ['lowpass', 2800] });
    });
    // The held chord blooms in gently so the fanfare lands soft rather than loud.
    for (const hz of notes) s.tone('sine', hz, 0.44, 1.35, 0.14, { attack: 0.06 });
    s.noise(0.44, 1.2, 0.05, ['highpass', 6000], { attack: 0.3 });
  },
};
