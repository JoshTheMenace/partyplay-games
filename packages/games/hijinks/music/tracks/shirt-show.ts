/* Shirt Show: a ring-entrance runway anthem in E minor (A–A′–B–breakdown). Four-on-the-floor kick and claps, a pumping
   overdriven bass, chugging power chords, a square-lead hook, a brass "title belt" chorus, then a tom-and-clap breakdown
   with crowd stabs and a riser that slams back into the top of the loop. */
import { Mix, bass, chord, clap, clock, hat, kick, mtof, rng, seedNoise, snare, synth } from '../synth';
import { brass, crash, lead, phrase, riser, tom, type Play, type Track } from '../kit';

const A = ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'C', 'B7'], B = ['C', 'D', 'Em', 'Em', 'C', 'D', 'B7', 'B7'], DOWN = ['Em', 'Em', 'Em', 'Em', 'C', 'C', 'D', 'B7'];
const HOOK = [
  'E5:.75! E5:.25 G5:.5 E5:.5 B5:1 A5:.5 G5:.5', 'E5:1.5 D5:.5 E5:1 -:1', 'E5:.75! E5:.25 G5:.5 E5:.5 C6:1 B5:.5 A5:.5', 'A5:1.5 F#5:.5 D5:1 -:1',
  'E5:.75! E5:.25 G5:.5 E5:.5 B5:1 A5:.5 G5:.5', 'E5:.5 G5:.5 B5:.5 D6:.5 E6:1 -:1', 'C6:.5 B5:.5 A5:.5 G5:.5 E5:1 G5:.5 A5:.5', 'B5:1.5 A5:.5 F#5:.5 D#5:.5 B4:1',
];
const BELT = [
  'G5:1! G5:.5 E5:.5 G5:1 C6:1', 'A5:1! A5:.5 F#5:.5 A5:1 D6:1', 'B5:1.5 G5:.5 E5:1 G5:.5 B5:.5', 'E6:2! -:1 B5:.5 D6:.5',
  'E6:1 D6:.5 C6:.5 G5:1 C6:1', 'F#6:1 E6:.5 D6:.5 A5:1 D6:1', 'D#6:1.5 B5:.5 F#5:1 A5:1', 'B5:2! -:2',
];
/** Answer phrase for A′: the hook's second bar each time, an octave down on brass. */
const ANSWER = ['-:4', '-:2 B4:.5 D5:.5 E5:1', '-:4', '-:2 A4:.5 B4:.5 D5:1', '-:4', '-:2 B4:.5 D5:.5 G5:1', '-:4', '-:2 F#4:.5 A4:.5 B4:1'];

export default { id: 'shirt-show', title: 'Title Belt Strut', mood: 'Wrestling-entrance runway anthem: big kick, chugging riff, brass chorus', bpm: 128, bars: 32, render() {
  seedNoise(808); const r = rng(808), c = clock(128), mix = new Mix(32 * c.bar);
  const low = mix.bus(), drums = mix.bus(), gtr = mix.bus(), hook = mix.bus(), horns = mix.bus(), fx = mix.bus();
  const prog = [...A, ...A, ...B, ...DOWN];
  prog.forEach((sym, bar) => {
    const { root } = chord(sym), bassRoot = 28 + ((root - 4 + 12) % 12), down = bar >= 24, chorus = bar >= 16 && bar < 24;
    // Pumping eighth-note bass with an octave kick on the "and" of four; the breakdown holds long notes.
    if (down && bar < 28) for (const beat of [0, 2]) bass(low, c.at(bar, beat), 1.6 * c.spb, mtof(bassRoot), .9, { drive: .7, bright: .35 });
    else for (let e = 0; e < 8; e++) bass(low, c.at(bar, e / 2), .42 * c.spb, mtof(bassRoot + (e === 7 ? 12 : 0)), e % 2 ? .72 : .92, { drive: .85, bright: .5 });
    // Palm-muted power chords (root, fifth, octave): chug on eighths, open accents on 1 and the "and" of 2.
    const power = [bassRoot + 12, bassRoot + 19, bassRoot + 24];
    if (!down || bar >= 28) for (let e = 0; e < 8; e++) {
      const open = e === 0 || e === 3, d = (open ? .9 : .32) * c.spb;
      power.forEach((m, k) => synth(gtr, c.at(bar, e / 2) + k * .004, d, mtof(m), open ? .5 : .32, k ? .35 : -.35, { wave: 'saw', voices: 2, detune: 9, cutoff: open ? 2200 : 900, env: 1800, envDecay: .08, res: .2, a: .003, d: .2, s: .6, r: .06 }));
    }
    // Drums: four on the floor, claps on 2 and 4, off-beat open hats, sixteenth closed hats in the chorus.
    if (!down) for (const beat of [0, 1, 2, 3]) { kick(drums, c.at(bar, beat), .95, { f0: 120, f1: 45, decay: .28, click: .25 }); mix.kickAt(c.at(bar, beat)); }
    else for (const beat of bar < 28 ? [0, 2.5] : [0, 1, 2, 3]) { kick(drums, c.at(bar, beat), .9, { f0: 120, f1: 45, decay: .3 }); mix.kickAt(c.at(bar, beat)); }
    for (const beat of [1, 3]) { clap(drums, c.at(bar, beat), down && bar < 28 ? .7 : .6, 0); if (!down) snare(drums, c.at(bar, beat), .35, 0, { tone: 200, snappy: .6, decay: .1 }); }
    if (!down || bar >= 28) for (let e = 0; e < 4; e++) hat(drums, c.at(bar, e + .5), .4, .25, .09);
    if (chorus) for (let s = 0; s < 16; s++) if (s % 4 !== 2) hat(drums, c.at(bar, s / 4), s % 2 ? .14 : .2, -.25, .025);
    // Breakdown: tom gallop and crowd "hey!" stabs on the brass.
    if (down && bar < 28) {
      for (const [beat, f] of [[0, 110], [.75, 110], [1.5, 140], [2, 110], [2.75, 110], [3.5, 165]] as const) tom(drums, c.at(bar, beat), .6 + r() * .1, f, (f - 130) / 80);
      if (bar % 2) for (const m of [52, 59, 64]) brass(horns, c.at(bar, 3), .35 * c.spb, mtof(m), .8, .1);
    }
  });
  // Fills, crashes and the riser back into the top.
  for (const bar of [0, 8, 16, 24]) crash(drums, c.at(bar, 0), .75, bar % 16 ? .3 : -.3);
  for (const bar of [7, 15, 23]) [3, 3.25, 3.5, 3.75].forEach((beat, k) => tom(drums, c.at(bar, beat), .75, [200, 165, 135, 110][k]!, k / 2 - .7));
  riser(fx, c.at(30, 0), 2 * c.bar, .7);
  for (let s = 0; s < 16; s++) snare(drums, c.at(31, s / 4), .2 + s * .035, 0, { tone: 210, snappy: .7, decay: .07 });
  const sq: Play = (t, d, f, v) => lead(hook, t, d, f, v * .85, -.12);
  const belt: Play = (t, d, f, v) => brass(horns, t, d, f, v * .8, .12);
  const low8: Play = (t, d, f, v) => brass(horns, t, d, f, v * .7, .2);
  phrase(c, 8, HOOK, sq, r, { jitter: .006 }); phrase(c, 8, ANSWER, low8, r, { jitter: .008 });
  phrase(c, 16, BELT, belt, r, { jitter: .008 }); phrase(c, 16, BELT, sq, r, { jitter: .004, transpose: -12, vel: .55 });
  // The first eight bars tease the hook's opening call so the loop has a melody from the downbeat.
  for (const bar of [0, 2, 4, 6]) phrase(c, bar, ['E5:.75! E5:.25 G5:.5 E5:.5 -:2'], sq, r, { vel: .65 });
  mix.add('bass', low, { gain: .5, duck: .35 });
  mix.add('drums', drums, { gain: .55, reverb: .08 });
  mix.add('guitar', gtr, { gain: 1.1, duck: .4, reverb: .1 });
  mix.add('lead', hook, { gain: 1.35, reverb: .22, echo: .12 });
  mix.add('brass', horns, { gain: 2.2, reverb: .25 });
  mix.add('riser', fx, { gain: .45, reverb: .2 });
  return mix.finish({ room: .7, damp: .4, echoTime: c.spb * .75, echoFb: .25, target: .13 });
} } satisfies Track;
