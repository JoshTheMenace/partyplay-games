/* Sketch Bluff: a black-tie gala waltz in F (AABA′). Plucked upright on one, piano "pah-pah", a sighing string tune, harpsichord
   arpeggios in the second strain, a flute bridge in D minor and a cheeky bassoon pickup back to the top. */
import { Mix, brush, chord, clock, flute, kick, mallet, midi, mtof, pluck, rng, seedNoise, synth, voicer } from '../synth';
import { phrase, piano, strings, type Play, type Track } from '../kit';

const A = ['F', 'Dm', 'Gm7', 'C7', 'F', 'A7', 'Dm', 'C7'], A2 = ['F', 'Dm', 'Gm7', 'C7', 'Bb', 'C7', 'F', 'F'], B = ['Dm', 'A7', 'Dm', 'Gm', 'Bb', 'C7', 'F', 'C7'];
const TUNE = ['C5:1 F5:1 A5:1', 'A5:1.5 G5:.5 F5:1', 'Bb5:1 A5:.5 G5:.5 F5:.5 E5:.5', 'E5:2 C5:1', 'C5:1 F5:1 A5:1', 'C#6:1.5 Bb5:.5 A5:1', 'D6:1 A5:1 F5:1', 'G5:1.5 F5:.5 E5:1'];
const TUNE2 = [...TUNE.slice(0, 4), 'D6:1 Bb5:1 F5:1', 'E5:1 G5:1 Bb5:1', 'A5:1.5 G5:.5 F5:1', 'F5:2 -:1'];
const BRIDGE = ['F5:1 E5:1 D5:1', 'C#5:2 E5:1', 'A5:1.5 G5:.5 F5:1', 'G5:2 Bb5:1', 'D6:1 C6:1 Bb5:1', 'G5:1.5 A5:.5 Bb5:1', 'A5:1 C6:1 F6:1', 'E6:1.5 D6:.5 C6:1'];
const TUNE3 = [...TUNE.slice(0, 7), 'G5:.5 F5:.5 E5:.5 D5:.5 C5:1'];
const BARS = 32;

export default { id: 'sketch-bluff', title: 'Velvet Rope Waltz', mood: 'Snooty, sparkling gala waltz with a wink', bpm: 138, bars: BARS, beats: 3, render() {
  seedNoise(717); const r = rng(717), c = clock(138, .5, .5, 3), mix = new Mix(BARS * c.bar);
  const low = mix.bus(), keys = mix.bus(), bow = mix.bus(), pad = mix.bus(), harp = mix.bus(), wind = mix.bus(), perc = mix.bus();
  const prog = [...A, ...A2, ...B, ...A], v = voicer(65), w = voicer(58);
  prog.forEach((sym, bar) => {
    const { root, iv } = chord(sym), base = 36 + (root + 12) % 12, section = Math.floor(bar / 8);
    pluck(low, c.at(bar, 0), .9 * c.spb, mtof(base), .95, 0, { bright: .3, decay: 1.1, body: 110 });
    if (bar % 2) pluck(low, c.at(bar, 2), .6 * c.spb, mtof(base + iv[2]!), .55, 0, { bright: .3, decay: .8, body: 110 });
    const notes = v(sym);
    for (const b of [1, 2]) notes.forEach((m, k) => piano(keys, c.at(bar, b) + k * .005, .32 * c.spb, mtof(m), (b === 1 ? .4 : .32) + r() * .06, .18));
    // Sustained strings under the second strain and the bridge.
    if (section === 1 || section === 2) w(sym).forEach((m, k) => strings(pad, c.at(bar, 0), 2.9 * c.spb, mtof(m), .22, k / 2 - .5, .4));
    // Harpsichord: a rising-then-falling arpeggio in eighths through the second strain.
    if (section === 1) {
      const tones = iv.slice(0, 3).map(i => 72 + ((root + i) % 12));
      [0, 1, 2, 3, 2, 1].forEach((k, e) => pluck(harp, c.at(bar, e / 2), .45 * c.spb, mtof(k === 3 ? tones[0]! + 12 : tones[k]!), .5 + r() * .1, .35, { bright: .95, decay: .5, pick: .2 }));
    }
    kick(perc, c.at(bar, 0), .2, { f0: 80, decay: .18, click: .03 });
    for (const b of [1, 2]) brush(perc, c.at(bar, b), .16 + r() * .05, .2, .1);
    if (bar % 4 === 0) mallet(perc, c.at(bar, 0), 1.2, mtof(midi('F7')), .22, .45, 'bell');
  });
  const violin: Play = (t, d, f, vel) => strings(bow, t, d, f, vel * .9, -.15, .06);
  const harpsi: Play = (t, d, f, vel) => pluck(harp, t, d, f, vel * .85, -.1, { bright: .95, decay: .7, pick: .15 });
  const fl: Play = (t, d, f, vel) => flute(wind, t, d, f, vel, .1, { breath: .08, vib: .005 });
  phrase(c, 0, TUNE, violin, r, { jitter: .008, legato: .98 });
  phrase(c, 8, TUNE2, harpsi, r, { jitter: .004 });
  phrase(c, 8, TUNE2, (t, d, f, vel) => mallet(perc, t, Math.min(d, .4), f * 2, vel * .25, -.3, 'bell'), r, { jitter: .004 });
  phrase(c, 16, BRIDGE, fl, r, { jitter: .01, legato: .97 });
  phrase(c, 24, TUNE3, violin, r, { jitter: .008, legato: .98 });
  phrase(c, 24, TUNE3, fl, r, { jitter: .01, transpose: 12, vel: .45 });
  // The wink: a staccato bassoon climbs back to the top of the form.
  phrase(c, 31, ['C3:.5 D3:.5 E3:.5 F3:.5 G3:1'], (t, d, f, vel) => synth(low, t, d * .6, f, vel * .9, .1, { wave: 'saw', cutoff: 700, env: 900, envDecay: .08, a: .01, d: .12, s: .6, r: .05 }), r, { jitter: .004 });
  mix.add('bass', low, { gain: 1.5 });
  mix.add('piano', keys, { gain: 1.1, reverb: .22 });
  mix.add('violins', bow, { gain: 1.5, reverb: .35 });
  mix.add('pad', pad, { gain: 1.3, reverb: .4 });
  mix.add('harpsichord', harp, { gain: 2.2, reverb: .2 });
  mix.add('flute', wind, { gain: 1, reverb: .35, echo: .08 });
  mix.add('percussion', perc, { gain: 1.3, reverb: .25 });
  return mix.finish({ room: .82, damp: .4, echoTime: c.spb, echoFb: .2, target: .12 });
} } satisfies Track;
