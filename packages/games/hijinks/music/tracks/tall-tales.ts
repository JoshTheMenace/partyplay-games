/* Tall Tales: a newsreel ragtime two-step in F (A–B–A′). Stride piano and tuba oom-pah, clarinet hook, a typewriter breakdown
   (woodblock typing, carriage-return bell, muted-horn calls), then the whole press room takes the hook with brass and banjo. */
import { Mix, bass, bassNote, chord, clock, hat, kick, mallet, mtof, pluck, rng, seedNoise, snare, synth, voicer, woodblock } from '../synth';
import { brass, crash, horn, phrase, piano, tom, type Play, type Track } from '../kit';

const A = ['F6', 'D7', 'Gm7', 'C7', 'F6', 'F7', 'Bb6', 'C7'], B = ['Bb6', 'Bb6', 'F6', 'F6', 'G7', 'G7', 'C7', 'C7'];
const A2 = ['F6', 'D7', 'Gm7', 'C7', 'F6', 'D7', 'Gm7 C7', 'F6 C7'];
const HOOK = [
  'A5:.5 C6:.5 -:.25 A5:.25 C6:.5 F6:1 E6:.5 D6:.5', 'C6:.5 A5:.5 F#5:.75 A5:.25 D6:1 C6:.5 A5:.5',
  'Bb5:.5 D6:.5 -:.25 Bb5:.25 D6:.5 G6:1 F6:.5 D6:.5', 'E6:.75 D6:.25 C6:.5 Bb5:.5 G5:.5 E5:.5 C5:1',
  'A5:.5 C6:.5 -:.25 A5:.25 C6:.5 F6:1 G6:.5 A6:.5', 'A6:.5! G6:.5 Eb6:.75 C6:.25 A5:1 F5:1',
  'D6:.5 F6:.5 -:.25 D6:.25 G6:.5 F6:.5 D6:.5 Bb5:1', 'C6:1.5 -:.5 G5:.5 A5:.5 Bb5:.5 B5:.5',
];
const PRESS = [
  'D5:.5! -:.5 D5:.5! -:.5 F5:.25 E5:.25 D5:.5 Bb4:1', '-:2 G4:.5 Bb4:.5 D5:.5 F5:.5',
  'A5:.5! -:.5 A5:.5! -:.5 C6:.25 Bb5:.25 A5:.5 F5:1', '-:2 D5:.5 F5:.5 A5:.5 C6:.5',
  'B5:.75! A5:.25 G5:.5 F5:.5 D5:.5 F5:.5 B4:1', '-:1 G5:.5 F5:.5 D5:.5 B4:.5 G4:1',
  'E5:.5 G5:.5 Bb5:.5 C6:.5 -:.5 Bb5:.5 G5:.5 E5:.5', 'C5:1 -:2 E5:.25 F5:.25 G5:.5',
];
const OUT = [...HOOK.slice(0, 6), 'Bb5:.5 D6:.5 G6:.5 F6:.5 E6:.5 C6:.5 Bb5:.5 G5:.5', 'A5:1! F5:.5 -:.5 C5:.5 D5:.5 E5:.5 G5:.5'];

export default { id: 'tall-tales', title: 'Hot Off the Press', mood: 'Newsreel ragtime with a typewriter breakdown', bpm: 132, bars: 24, render() {
  seedNoise(303); const r = rng(303), c = clock(132, .56, .5), mix = new Mix(24 * c.bar);
  const low = mix.bus(), drums = mix.bus(), keys = mix.bus(), reed = mix.bus(), horns = mix.bus(), banjo = mix.bus(), press = mix.bus();
  const prog = [...A, ...B, ...A2], v = voicer(62, false);
  prog.forEach((bar, i) => {
    const syms = bar.split(' '), b = i >= 8 && i < 16, out = i >= 16;
    syms.forEach((sym, k) => {
      const span = 4 / syms.length, at = k * span, root = bassNote(sym, 1), { iv } = chord(sym), notes = v(sym);
      // Tuba oom-pah: root then fifth; the breakdown walks up through the chord instead.
      const tuba = b ? [root, root + iv[1]!, root + iv[2]!, root + 12] : span === 4 ? [root, root + 7] : [root];
      tuba.forEach((m, n) => bass(low, c.at(i, at + n * (span / tuba.length)), .7 * c.spb, mtof(m), n ? .78 : .95, { drive: .6, bright: .25 }));
      // Stride piano: low octave on the beat, chord on the off-beat.
      for (let beat = at; beat < at + span; beat += 2) {
        piano(keys, c.at(i, beat), .35 * c.spb, mtof(root + 12), .5, -.2);
        notes.forEach((m, n) => piano(keys, c.at(i, beat + 1) + n * .004, .3 * c.spb, mtof(m), .42 + r() * .08, .15));
      }
      // Banjo strums on every "and" in the closing strain.
      if (out) for (let e = .5; e < span; e += 1) notes.forEach((m, n) => pluck(banjo, c.at(i, at + e) + n * .008, .2 * c.spb, mtof(m + 12), .45, .35, { bright: .85, decay: .35 }));
    });
    // March kit: kick on one and three, brushed snare backbeat, closed hats; the press-room strain swaps hats for woodblock typing.
    for (const beat of [0, 2]) kick(drums, c.at(i, beat), .7, { f0: 110, f1: 48, decay: .22 });
    for (const beat of [1, 3]) snare(drums, c.at(i, beat), b ? .45 : .6, .05, { tone: 210, snappy: .55, decay: .12 });
    if (!b) for (let e = 0; e < 8; e++) hat(drums, c.at(i, e / 2), e % 2 ? .22 : .32, .3, .03);
    if (b && i % 2 === 0) for (let s = 4; s < 16; s++) if (r() < .72) woodblock(press, c.at(i, s / 4) + (r() - .5) * .012, .35 + r() * .25, (r() - .5) * .6, 1900 + r() * 500);
    if (b && i % 2 === 1) { mallet(press, c.at(i, 0), 1.2, mtof(96), .9, .3, 'bell'); snare(press, c.at(i, .5), .2, -.2, { tone: 400, snappy: .9, decay: .25 }); }
    if (i === 0 || i === 16) crash(drums, c.at(i, 0), .7, -.3);
  });
  // Fills: a snare ruff into the breakdown, tom run into the closing strain, ba-dum into the loop.
  [3, 3.25, 3.5, 3.75].forEach((beat, k) => snare(drums, c.at(7, beat), .3 + k * .12, 0, { tone: 220 }));
  [3, 3.25, 3.5, 3.75].forEach((beat, k) => tom(drums, c.at(15, beat), .7, [200, 165, 135, 110][k], k / 2 - .7));
  snare(drums, c.at(23, 3), .6, 0, { tone: 230 }); kick(drums, c.at(23, 3.5), .6);
  const clarinet: Play = (t, d, f, vel) => synth(reed, t, d, f, vel * .8, -.1, { wave: 'square', cutoff: 1700, env: 1400, envDecay: .18, res: .1, a: .025, d: .2, s: .8, r: .08, vib: .006, vibRate: 5.4 });
  const muted: Play = (t, d, f, vel) => horn(horns, t, d, f, vel, .2), section: Play = (t, d, f, vel) => brass(horns, t, d, f / 2, vel * .75, .15);
  phrase(c, 0, HOOK, clarinet, r, { jitter: .008 });
  phrase(c, 8, PRESS, muted, r, { jitter: .01 });
  phrase(c, 16, OUT, clarinet, r, { jitter: .008 }); phrase(c, 16, OUT, section, r, { jitter: .01 });
  phrase(c, 16, OUT, (t, d, f, vel) => mallet(press, t, d, f * 2, vel * .35, -.3, 'bell'), r, { jitter: .004 });
  mix.add('tuba', low, { gain: .55 });
  mix.add('drums', drums, { gain: 1.15, reverb: .1 });
  mix.add('piano', keys, { gain: 1.05, reverb: .18 });
  mix.add('clarinet', reed, { gain: 1.75, reverb: .25, echo: .05 });
  mix.add('horns', horns, { gain: 2.1, reverb: .25 });
  mix.add('banjo', banjo, { gain: 2.2, reverb: .12 });
  mix.add('press', press, { gain: .9, reverb: .2 });
  return mix.finish({ room: .7, damp: .45, echoTime: c.spb * .75, echoFb: .18, target: .12 });
} } satisfies Track;
