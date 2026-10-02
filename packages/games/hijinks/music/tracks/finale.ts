/* Finale: a big C-major anthem. Driving strings and taiko, then a brass theme over I–V–vi–IV, a choir bridge, and a full-band climax. */
import { Mix, bass, bassNote, biquad, clap, clock, hat, kick, mtof, pluck, rng, seedNoise, snare, synth, taiko, voicer, type Bus } from '../synth';
import { brass, crash, phrase, riser, strings, tom, type Play, type Track } from '../kit';

const A = ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G'], B = ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'G'];
const THEME = ['E5:1.5 G5:.5 C6:2', 'B5:1 A5:.5 G5:.5 D5:2', 'C6:1.5 B5:.5 A5:1 E5:1', 'F5:1 A5:1 C6:2', 'E6:1.5 D6:.5 C6:1 G5:1', 'D6:1.5 B5:.5 G5:2', 'A5:1 C6:1 F6:1.5 E6:.5', 'D6:3 G5:.5 B5:.5'];
const BRIDGE = ['A5:2 C6:1 E6:1', 'F6:2 E6:1 C6:1', 'G5:2 C6:1 E6:1', 'D6:3 B5:1', 'C6:2 E6:1 A6:1', 'A6:2 G6:1 F6:1', 'G6:2 F6:1 D6:1', 'B5:1 D6:1 G6:1 -:1'];

export default { id: 'finale', title: 'Curtain Call', mood: 'Big anthem for the end of the night', bpm: 140, bars: 32, lufs: -15, render() {
  seedNoise(808); const r = rng(808), c = clock(140, .5, .5), mix = new Mix(32 * c.bar);
  const drums = mix.bus(), low = mix.bus(), st = mix.bus(), horns = mix.bus(), choir = mix.bus(), ost = mix.bus();
  const prog = [...A, ...A, ...B, ...A], v = voicer(64), cv = voicer(62, false);
  prog.forEach((ch, bar) => {
    const root = bassNote(ch), sec = bar >> 3, notes = v(ch), full = sec !== 0;
    for (let e = 0; e < 8; e++) bass(low, c.at(bar, e / 2), .45 * c.spb, mtof(root + (e === 3 || e === 7 ? 12 : 0)), e % 2 ? .75 : .95, { drive: 2.2, bright: .45 });
    // Strings ostinato: driving eighths on the chord's top tones.
    for (let e = 0; e < 8; e++) pluck(ost, c.at(bar, e / 2), .4 * c.spb, mtof(notes[[0, 2, 1, 2][e % 4] % notes.length] + 12), e % 2 ? .4 : .55, (e % 2 ? .35 : -.35), { bright: .65, decay: .5 });
    for (const b of full ? [0, 1.5, 2, 3.5] : [0, 2]) kick(drums, c.at(bar, b), 1, { f0: 140, f1: 45, decay: .35 });
    for (const b of [1, 3]) { snare(drums, c.at(bar, b), full ? .9 : .5, 0, { tone: 190, decay: .16 }); if (full) clap(drums, c.at(bar, b), .5, .1); }
    for (let e = 0; e < 8; e++) hat(drums, c.at(bar, e / 2), e % 2 ? .3 : .45, .3, full ? .05 : .03);
    if (sec === 0 || sec === 3) taiko(drums, c.at(bar, 0), .8, -.2, { f: 70 });
    if (bar % 4 === 0) crash(drums, c.at(bar, 0), sec === 3 ? 1 : .7, bar % 8 ? .4 : -.4);
    if (bar % 8 === 7) [2, 2.5, 3, 3.25, 3.5, 3.75].forEach((b, k) => tom(drums, c.at(bar, b), .7 + k * .05, [200, 170, 150, 130, 110, 95][k], .6 - k / 4));
    if (sec === 0) for (const b of [0, 2.5]) notes.forEach((m, k) => brass(horns, c.at(bar, b) + k * .004, (b ? .9 : 1.6) * c.spb, mtof(m), .6, k / 2 - .5));
    if (sec >= 1) cv(ch).forEach((m, k) => strings(st, c.at(bar, 0), c.bar * .97, mtof(m), .3, k / 2 - .5, .12));
    if (sec === 2) cv(ch).forEach((m, k) => synth(choir, c.at(bar, 0), c.bar * .98, mtof(m + 12), .4, k / 2 - .5, { wave: 'saw', voices: 5, detune: 22, cutoff: 1500, a: .3, d: .6, s: .9, r: .4, vib: .005, vibRate: 5 }));
  });
  riser(drums, c.at(23, 0), c.bar, .8);
  const theme: Play = (t, d, f, vel) => brass(horns, t, d, f, vel, .1), low8: Play = (t, d, f, vel) => brass(horns, t, d, f / 2, vel * .75, -.15);
  const soar: Play = (t, d, f, vel) => strings(st, t, d, f, vel * .9, .2, .06);
  phrase(c, 8, THEME, theme, r, { jitter: .004 }); phrase(c, 8, THEME, low8, r, { jitter: .006 });
  phrase(c, 16, BRIDGE, soar, r, { jitter: .006 }); phrase(c, 16, BRIDGE, soar, r, { jitter: .006, transpose: -12, vel: .5 });
  phrase(c, 24, THEME, theme, r, { jitter: .004 }); phrase(c, 24, THEME, low8, r, { jitter: .006 }); phrase(c, 24, THEME, soar, r, { jitter: .006, transpose: 12, vel: .55 });
  mix.add('drums', drums, { gain: .55, reverb: .15 });
  mix.add('bass', low, { gain: .45 });
  mix.add('ostinato', ost, { gain: 2.4, reverb: .2 });
  mix.add('strings', st, { gain: 1.1, reverb: .35 });
  mix.add('brass', horns, { gain: 1.5, reverb: .3 });
  mix.add('choir', choirFormants(choir), { gain: 2.2, reverb: .5 });
  return mix.finish({ room: .85, damp: .35, target: .14 });
} } satisfies Track;

/** Vowel formants turn the detuned saws into an "aah" choir. */
function choirFormants(b: Bus) {
  for (const x of [b.l, b.r]) { const o = biquad(x.slice(), 'bp', 1150, 3); biquad(x, 'bp', 800, 4); for (let i = 0; i < x.length; i++) x[i] += o[i] * .7; }
  return b;
}
