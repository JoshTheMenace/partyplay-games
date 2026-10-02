/* Think bed two: a tiptoeing D-major pizzicato bounce. Oom-pah plucks, glockenspiel tune, a goofy bassoon answer, finger snaps. */
import { Mix, bassNote, chord, clap, clock, kick, mallet, mtof, pluck, rng, seedNoise, shaker, synth, voicer, woodblock } from '../synth';
import { phrase, type Play, type Track } from '../kit';

const A = ['D', 'Bm7', 'Em7', 'A7', 'D', 'F#m7', 'G', 'A7sus4'], B = ['G', 'A', 'F#m7', 'Bm7', 'Em7', 'A7', 'D', 'A7sus4'];
const TUNE = ['F#5:.5 A5:.5 D6:1 -:1 A5:.5 F#5:.5', 'B5:.5 A5:.5 F#5:1 -:2', 'G5:.5 B5:.5 E6:1 -:1 D6:.5 B5:.5', 'C#6:1 A5:.5 G5:.5 E5:2',
  'F#5:.5 A5:.5 D6:1 -:1 E6:.5 F#6:.5', 'E6:.5 C#6:.5 A5:1 -:2', 'B5:.5 D6:.5 G6:1 F#6:.5 E6:.5 D6:1', 'E6:1 D6:1 -:2'];
const BASSOON = ['G3:.5 B3:.5 D4:.5 B3:.5 G3:1 -:1', 'A3:.5 C#4:.5 E4:.5 C#4:.5 A3:1 -:1', 'F#3:.5 A3:.5 C#4:.5 E4:.5 -:2', 'D4:.5 C#4:.5 B3:1 F#3:1 -:1',
  'E3:.5 G3:.5 B3:.5 D4:.5 E4:1 -:1', 'C#4:.5 E4:.5 G4:.5 E4:.5 C#4:1 A3:1', 'D4:1 F#3:.5 A3:.5 D4:2', '-:2 A3:.5 B3:.5 C#4:.5 E4:.5'];

export default { id: 'think-2', title: 'Doodle Hop', mood: 'Playful pizzicato bed for writing and drawing', bpm: 104, bars: 24, lufs: -19, render() {
  seedNoise(404); const r = rng(404), c = clock(104, .55, .5), mix = new Mix(24 * c.bar);
  const pz = mix.bus(), gl = mix.bus(), bn = mix.bus(), drums = mix.bus();
  const prog = [...A, ...B, ...A], v = voicer(64, false);
  prog.forEach((ch, bar) => {
    const root = bassNote(ch), notes = v(ch);
    for (const [b, m] of [[0, root], [2, root + chord(ch).iv[2] - 12]] as const) pluck(pz, c.at(bar, b), .5 * c.spb, mtof(m + 12), .95, -.15, { bright: .3, decay: .7, body: 150 });
    for (const b of [1, 3]) notes.forEach((m, k) => pluck(pz, c.at(bar, b) + k * .006, .25 * c.spb, mtof(m), .4, .2 - k * .12, { bright: .55, decay: .4 }));
    kick(drums, c.at(bar, 0), .35, { f0: 100, f1: 50, decay: .2, click: .05 });
    for (const b of [1, 3]) clap(drums, c.at(bar, b), .16, .25);
    for (let s = 0; s < 8; s++) shaker(drums, c.at(bar, s / 2), s % 2 ? .1 : .18, -.3);
    if (bar % 4 === 3) { woodblock(drums, c.at(bar, 3), .35, .4, 1250); woodblock(drums, c.at(bar, 3.5), .3, .4, 950); }
    // In the bassoon section the glockenspiel answers with two chord tones.
    if (bar >= 8 && bar < 16 && bar % 2 === 0) [2.5, 3].forEach((b, k) => mallet(gl, c.at(bar, b), .3, mtof(notes[notes.length - 1 - k] + 12), .35, .3, 'bell'));
  });
  const glock: Play = (t, d, f, vel) => mallet(gl, t, Math.min(d, .4), f, vel * .55, .25, 'bell');
  const bassoon: Play = (t, d, f, vel) => synth(bn, t, d, f, vel * .9, -.1, { wave: 'pulse', pw: .4, cutoff: 650, env: 900, envDecay: .08, res: .25, a: .02, d: .2, s: .7, r: .06, vib: .004 });
  phrase(c, 0, TUNE, glock, r, { jitter: .008 }); phrase(c, 8, BASSOON, bassoon, r, { jitter: .012, legato: .7 });
  phrase(c, 16, TUNE, glock, r, { jitter: .008 }); phrase(c, 16, TUNE, (t, d, f, vel) => pluck(pz, t, d, f / 2, vel * .45, .1, { bright: .6, decay: .5 }), r, { jitter: .01 });
  mix.add('pizzicato', pz, { gain: 2.1, reverb: .25 });
  mix.add('glock', gl, { gain: 1, reverb: .35, echo: .15 });
  mix.add('bassoon', bn, { gain: 1, reverb: .2 });
  mix.add('percussion', drums, { gain: 1.1, reverb: .12 });
  return mix.finish({ lofi: 10000, room: .75, damp: .45, echoTime: c.spb * .5, echoFb: .25, target: .1 });
} } satisfies Track;
