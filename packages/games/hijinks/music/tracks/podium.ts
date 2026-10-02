/* Podium: a G-major victory-lap disco. Four-on-the-floor, octave bass, offbeat piano, a brass fanfare tune and soaring strings. */
import { Mix, bass, bassNote, clap, clock, hat, kick, mallet, mtof, rng, seedNoise, shaker, voicer } from '../synth';
import { brass, crash, phrase, piano, strings, tom, type Play, type Track } from '../kit';

const A = ['G', 'D', 'Em7', 'C', 'G', 'D', 'C', 'D'], B = ['C', 'D', 'Bm7', 'Em7', 'Am7', 'D', 'G', 'D7'];
const FANFARE = ['D5:.5 G5:.5 B5:.5 D6:1.5 B5:.5 D6:.5', 'C#6:.5 D6:.5 A5:1 F#5:1 A5:1', 'G5:.5 B5:.5 E6:1.5 D6:.5 B5:.5 G5:.5', 'A5:1 G5:.5 E5:.5 G5:2',
  'D5:.5 G5:.5 B5:.5 D6:1.5 E6:.5 F#6:.5', 'G6:1 F#6:.5 E6:.5 D6:1 A5:1', 'E6:.5 D6:.5 C6:.5 B5:.5 C6:1 E6:1', 'D6:2 -:1 D5:.25 E5:.25 F#5:.5'];
const SOAR = ['G5:1.5 E5:.5 G5:1 C6:1', 'A5:2 F#5:1 D5:1', 'F#5:1.5 D5:.5 F#5:1 B5:1', 'G5:2 E5:1 G5:1', 'C6:1.5 A5:.5 C6:1 E6:1', 'D6:2 C6:1 A5:1', 'B5:1.5 A5:.5 G5:1 D5:1', 'F#5:1 A5:1 C6:1 -:.5 D5:.5'];

export default { id: 'podium', title: 'Victory Lap', mood: 'Celebratory disco fanfare for the podium', bpm: 126, bars: 24, render() {
  seedNoise(707); const r = rng(707), c = clock(126, .5, .5), mix = new Mix(24 * c.bar);
  const drums = mix.bus(), low = mix.bus(), keys = mix.bus(), horns = mix.bus(), st = mix.bus(), gl = mix.bus();
  const prog = [...A, ...B, ...A], v = voicer(64), sv = voicer(60, false);
  prog.forEach((ch, bar) => {
    const root = bassNote(ch), notes = v(ch);
    for (let e = 0; e < 8; e++) bass(low, c.at(bar, e / 2), .42 * c.spb, mtof(root + (e % 2 ? 12 : 0)), e % 2 ? .7 : .95, { drive: 2, bright: .4 });
    for (let b = 0; b < 4; b++) { kick(drums, c.at(bar, b), .95, { f0: 150, f1: 48, decay: .3 }); mix.kickAt(c.at(bar, b)); hat(drums, c.at(bar, b + .5), .45, .25, .14); }
    for (const b of [1, 3]) clap(drums, c.at(bar, b), .7, 0);
    for (let s = 0; s < 16; s++) shaker(drums, c.at(bar, s / 4), s % 2 ? .18 : .3, -.3);
    if (bar % 8 === 0) crash(drums, c.at(bar, 0), .8, .3);
    if (bar === 23) [2, 2.5, 3, 3.5].forEach((b, k) => tom(drums, c.at(bar, b), .7, [220, 180, 145, 115][k], .5 - k / 3));
    for (const b of [.5, 1.5, 2.5, 3.5]) notes.forEach((m, k) => piano(keys, c.at(bar, b) + k * .004, .3 * c.spb, mtof(m), .5, -.15));
    sv(ch).forEach((m, k) => strings(st, c.at(bar, 0), c.bar * .97, mtof(m), .26, k / 2 - .5, .15));
  });
  const fan: Play = (t, d, f, vel) => brass(horns, t, d, f, vel, .1), fan8: Play = (t, d, f, vel) => brass(horns, t, d, f / 2, vel * .7, -.1);
  const soar: Play = (t, d, f, vel) => strings(st, t, d, f, vel * .8, .2, .08), glock: Play = (t, d, f, vel) => mallet(gl, t, Math.min(d, .5), f * 2, vel * .45, .3, 'bell');
  phrase(c, 0, FANFARE, fan, r, { jitter: .004 }); phrase(c, 0, FANFARE, fan8, r, { jitter: .006 });
  phrase(c, 8, SOAR, soar, r, { jitter: .008 }); phrase(c, 8, SOAR, glock, r, { jitter: .004, transpose: -12 });
  phrase(c, 16, FANFARE, fan, r, { jitter: .004 }); phrase(c, 16, FANFARE, fan8, r, { jitter: .006 }); phrase(c, 16, FANFARE, glock, r, { jitter: .004 });
  mix.add('drums', drums, { gain: .5, reverb: .08 });
  mix.add('bass', low, { gain: .5, duck: .35 });
  mix.add('piano', keys, { gain: .9, reverb: .18, duck: .2 });
  mix.add('brass', horns, { gain: 1.6, reverb: .25 });
  mix.add('strings', st, { gain: 1.1, reverb: .35, duck: .25 });
  mix.add('glock', gl, { gain: 1, reverb: .35 });
  return mix.finish({ room: .78, damp: .4, target: .13 });
} } satisfies Track;
