/* The Hijinks signature theme: an F-major funk game-show hook over I–VI7–ii–V, a clavinet breakdown, then the horn section takes the hook. */
import { Mix, bass, bassNote, chord, clap, clock, hat, kick, mallet, mtof, rng, seedNoise, snare, voicer } from '../synth';
import { brass, clav, crash, lead, organ, phrase, riser, tom, type Play, type Track } from '../kit';

const A = ['F6', 'D7', 'Gm7', 'C7', 'F6', 'D7', 'Gm7', 'C7'], B = ['Bb9', 'Bb9', 'Am7', 'D7#9', 'Gm7', 'Gm7', 'C7sus4', 'C7'];
const HOOK = [
  'C5:.5 F5:.5 -:.25 A5:.5 G5:.25 F5:.5 A5:.5 C6:1', 'Bb5:.5! A5:.25 F#5:.75 D5:.5 -:.5 F#5:.5 A5:.5 C6:.5',
  'Bb5:.75 A5:.25 G5:.5 F5:.5 G5:.5 Bb5:.5 D6:1', 'C6:.5 Bb5:.5 G5:.5 E5:.5 -:.5 C5:.25 D5:.25 E5:.5 G5:.5',
  'C5:.5 F5:.5 -:.25 A5:.5 G5:.25 F5:.5 A5:.5 C6:1', 'Bb5:.5! A5:.25 F#5:.75 D5:.5 -:.5 A5:.5 C6:.5 D6:.5',
  'D6:.75 C6:.25 Bb5:.5 G5:.5 Bb5:.5 A5:.5 G5:1', 'E5:.5 G5:.5 Bb5:.5 C6:.5! -:.5 G5:.5 A5:.5 Bb5:.5',
];
const BREAK = [
  '-:1 D6:.25 C6:.25 Bb5:.5 C6:.5 D6:.5 F6:1', '-:2 F5:.5 G5:.5 Ab5:.25 A5:.75', '-:1 C6:.25 Bb5:.25 A5:.5 G5:.5 A5:.5 E5:1', '-:2 F#5:.5 A5:.5 C6:.5 Eb6:.5',
  'D6:1.5 C6:.5 Bb5:.5 A5:.5 G5:1', '-:1 Bb4:.5 D5:.5 F5:.5 G5:.5 Bb5:.5 A5:.5', 'G5:1.5 F5:.5 G5:2', '-:.5 C5:.5! C5:.5 -:.5 E5:.5 G5:.5 Bb5:.5 C6:.5',
];

export default { id: 'menu', title: 'Hijinks!', mood: 'Signature funky game-show theme', bpm: 116, bars: 24, render() {
  seedNoise(101); const r = rng(101), c = clock(116, .54, .25), mix = new Mix(24 * c.bar);
  const drums = mix.bus(), low = mix.bus(), keys = mix.bus(), horns = mix.bus(), ld = mix.bus(), pad = mix.bus(), sparkle = mix.bus();
  const prog = [...A, ...B, ...A], hv = voicer(65), pv = voicer(58, false);
  prog.forEach((ch, bar) => {
    const root = bassNote(ch), { iv } = chord(ch), next = bassNote(prog[(bar + 1) % prog.length]), brk = bar >= 8 && bar < 16, fill = bar % 8 === 7;
    for (const [b, m, d, vel] of [[0, root, .45, 1], [.75, root + 12, .2, .7], [1.5, root, .25, .8], [2, root + iv[2], .45, .9], [2.75, root + 12, .2, .7], [3, root + iv[3 % iv.length], .3, .8], [3.5, root + iv[2], .2, .75], [3.75, next - 1, .2, .8]])
      bass(low, c.at(bar, b), d * c.spb, mtof(m), vel, { drive: 2.2, bright: .5 });
    // Drums: sixteenth hats, backbeat with ghosts; the breakdown thins out.
    for (const b of brk ? [0, 2.5] : [0, 1.5, 2.5, ...(bar % 2 ? [3.75] : [])]) kick(drums, c.at(bar, b), b ? .8 : 1, { f0: 140, f1: 50, decay: .28 });
    for (const b of [1, 3]) { snare(drums, c.at(bar, b), .85, .05, { tone: 200 }); if (!brk) clap(drums, c.at(bar, b) + .004, .45, -.1); }
    for (const b of [1.75, 2.25, 3.5]) snare(drums, c.at(bar, b), .14, .1, { snappy: .6, decay: .07 });
    for (let s = 0; s < 16; s++) if (!(s === 14 && !brk) && !(brk && s % 2)) hat(drums, c.at(bar, s / 4), [.5, .2, .35, .22][s % 4], .3, .03);
    if (!brk) hat(drums, c.at(bar, 3.5), .4, .3, .22);
    if (bar % 8 === 0) crash(drums, c.at(bar, 0), .9, -.3);
    if (fill) [3, 3.25, 3.5, 3.75].forEach((b, k) => bar === 23 ? tom(drums, c.at(bar, b), .8, [210, 170, 135, 105][k], k / 2 - .7) : snare(drums, c.at(bar, b), .35 + k * .15, 0, { tone: 210 }));
    // Keys: organ pad on the hooks, clavinet chops in the breakdown.
    const pvn = pv(ch);
    if (brk) { for (const b of [0, .5, .75, 1.5, 2, 2.75, 3.25, 3.5]) pvn.forEach((m, k) => clav(keys, c.at(bar, b) + k * .002, .16 * c.spb, mtof(m + 12), .5, k / 3 - .4)); pvn.forEach(m => organ(pad, c.at(bar, 0), c.bar * .97, mtof(m), .22, 0)); }
    else pvn.forEach((m, k) => organ(pad, c.at(bar, 0), c.bar * .97, mtof(m), .38, k / 3 - .5));
    // Horn stabs answer the hook in the first section and punctuate the breakdown.
    const stab = (b: number, d: number, vel: number) => hv(ch).forEach((m, k) => brass(horns, c.at(bar, b) + k * .003, d * c.spb, mtof(m), vel, k / 2 - .5));
    if (bar < 8) { stab(1.5, .3, .6); stab(3, .45, .7); }
    else if (brk && bar % 2) stab(3.5, .4, .75);
  });
  const hook: Play = (t, d, f, vel) => lead(ld, t, d, f, vel, .1), section: Play = (t, d, f, vel) => brass(horns, t, d, f / 2, vel * .85, -.15);
  phrase(c, 0, HOOK, hook, r, { jitter: .004 });
  phrase(c, 8, BREAK, hook, r, { jitter: .006, vel: .75 });
  phrase(c, 16, HOOK, hook, r, { jitter: .004 }); phrase(c, 16, HOOK, section, r, { jitter: .006 });
  phrase(c, 16, HOOK, (t, d, f, vel) => mallet(sparkle, t, d, f * 2, vel * .5, .35, 'bell'), r, { jitter: .003 });
  riser(drums, c.at(15, 0), c.bar, .7);
  mix.add('drums', drums, { gain: .85, reverb: .08 });
  mix.add('bass', low, { gain: .6 });
  mix.add('clav', keys, { gain: .9, reverb: .12 });
  mix.add('organ', pad, { gain: 1.3, reverb: .2 });
  mix.add('horns', horns, { gain: 1.8, reverb: .22 });
  mix.add('lead', ld, { gain: 1, reverb: .18, echo: .12 });
  mix.add('glock', sparkle, { gain: 1.2, reverb: .35 });
  return mix.finish({ room: .7, damp: .45, echoTime: c.spb * .75, echoFb: .25, target: .13 });
} } satisfies Track;
