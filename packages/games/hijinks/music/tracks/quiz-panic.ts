/* Quiz Panic: "Checkout Waltz". A macabre D-minor waltz for a haunted hotel: pizzicato oom-pah, music-box tune, a creeping
   harpsichord counterline, then the pipe organ takes the B section over strings before the music box sneaks back in. */
import { Mix, bassNote, chord, clock, kick, mallet, midi, mtof, pluck, rng, seedNoise, shaker, voicer, woodblock } from '../synth';
import { organ, phrase, riser, strings, timpani, type Play, type Track } from '../kit';

const A = ['Dm', 'Dm', 'A7', 'A7', 'Dm', 'Dm', 'Gm', 'A7', 'Dm', 'Dm', 'Bb', 'Gm', 'Dm', 'A7', 'Dm', 'A7'];
const B = ['F', 'F', 'C7', 'C7', 'F', 'F', 'Bb', 'Bb', 'Gm', 'Gm', 'Dm', 'Dm', 'Bb', 'A7', 'Dm', 'A7'];
const BOX = [
  'A5:1 D6:.5 E6:.5 F6:1', 'E6:1 D6:1 A5:1', 'C#6:1 E6:.5 F6:.5 G6:1', 'F6:1.5 E6:.5 -:1',
  'A5:1 D6:.5 E6:.5 F6:1', 'A6:1 G6:.5 F6:.5 E6:1', 'D6:1 Bb5:1 G5:1', 'A5:2 -:1',
  'D6:1 F6:.5 A6:.5 D7:1', 'C#7:1 A6:1 F6:1', 'Bb6:1 A6:.5 G6:.5 F6:1', 'G6:1 D6:1 Bb5:1',
  'A5:1 F6:1 E6:1', 'G6:1 E6:1 C#6:1', 'D6:2 -:1', 'E5:1 G5:1 C#6:1',
];
const HYMN = ['A5:3', 'C6:1.5 A5:1.5', 'G5:2 Bb5:1', 'E5:3', 'F5:1 A5:1 C6:1', 'F6:3', 'D6:1.5 Bb5:1.5', 'F5:3', 'G5:1 Bb5:1 D6:1', 'G6:2 F6:1', 'F6:1.5 E6:1.5', 'D6:3'];
const RETURN = ['D6:1 F6:1 Bb6:1', 'A6:1.5 G6:.5 E6:1', 'F6:1 D6:1 A5:1', 'C#6:1 E6:1 A5:1'];

export default { id: 'quiz-panic', title: 'Checkout Waltz', mood: 'Macabre music-box waltz for a haunted hotel quiz', bpm: 138, bars: 32, beats: 3, render() {
  seedNoise(1313); const r = rng(1313), c = clock(138, .5, .5, 3), mix = new Mix(32 * c.bar);
  const low = mix.bus(), org = mix.bus(), box = mix.bus(), harp = mix.bus(), pad = mix.bus(), lead = mix.bus(), drums = mix.bus();
  const v = voicer(62), prog = [...A, ...B];
  prog.forEach((sym, bar) => {
    const { root, iv } = chord(sym), bassRoot = bassNote(sym, 2), b = bar >= 16 && bar < 28;
    // Oom-pah: pizzicato root (fifth on even bars of a pair), organ stabs on two and three.
    pluck(low, c.at(bar, 0), .7 * c.spb, mtof(bar % 2 ? bassRoot + iv[2]! - 12 : bassRoot), .95, 0, { bright: .4, decay: .8, body: 110 });
    const notes = v(sym);
    for (const beat of [1, 2]) notes.forEach((m, k) => organ(org, c.at(bar, beat) + k * .004, .32 * c.spb, mtof(m), b ? .32 : .42, k / 2 - .5, [0, 1, .3, .6, 0, .25]));
    kick(drums, c.at(bar, 0), b ? .3 : .42, { f0: 80, decay: .25, click: .03 });
    for (const beat of [1, 2]) shaker(drums, c.at(bar, beat), .18 + r() * .05, .25);
    if (bar % 4 === 3) woodblock(drums, c.at(bar, 2.5), .22, -.3, 820);
    // Creeping harpsichord arpeggio in the second half of each A.
    if (bar >= 8 && bar < 16) [0, 1, 2, 1, 0, 1].forEach((k, e) => pluck(harp, c.at(bar, e / 2), .4 * c.spb, mtof(root + 60 + iv[k]! - (root > 5 ? 12 : 0)), .5, .35, { bright: .85, decay: .35, body: 900 }));
    if (b) notes.forEach(m => strings(pad, c.at(bar, 0), c.bar * .98, mtof(m - 12), .28, 0, .4));
  });
  const musicBox: Play = (t, d, f, vel) => mallet(box, t, Math.min(d, .5), f, vel * .85, -.15, 'bell');
  const pipe: Play = (t, d, f, vel) => organ(lead, t, d, f, vel * .9, .1, [.3, 1, .7, .8, .35, .45]);
  phrase(c, 0, BOX, musicBox, r, { jitter: .006 });
  phrase(c, 16, HYMN, pipe, r, { jitter: .008, legato: .97 });
  phrase(c, 16, HYMN, musicBox, r, { jitter: .006, transpose: 12, vel: .35 });
  phrase(c, 28, RETURN, musicBox, r, { jitter: .006 });
  // Dramatic hinges: timpani and a swell into the B section and back to the top.
  for (const bar of [15, 31]) { riser(drums, c.at(bar, 0), c.bar, .5); timpani(drums, c.at(bar, 2), .5, mtof(midi('A2'))); }
  timpani(drums, c.at(16, 0), .6, mtof(midi('F2'))); timpani(drums, c.at(0, 0), .45, mtof(midi('D2')));
  mix.add('bass', low, { gain: 2.4 });
  mix.add('organ', org, { gain: 2.8, reverb: .25 });
  mix.add('musicbox', box, { gain: 1.1, reverb: .35, echo: .15 });
  mix.add('harpsichord', harp, { gain: 2, reverb: .2 });
  mix.add('strings', pad, { gain: 1.4, reverb: .4 });
  mix.add('pipe', lead, { gain: 2, reverb: .5 });
  mix.add('drums', drums, { gain: 1.1, reverb: .15 });
  return mix.finish({ room: .86, damp: .38, echoTime: c.spb, echoFb: .3, target: .12 });
} } satisfies Track;
