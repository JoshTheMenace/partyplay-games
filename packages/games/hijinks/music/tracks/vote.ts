/* Vote bed: playful A-minor tension. A tick-tock clock, staccato pizzicato ostinato, pulsing bass, then a sneaky lead that climbs an octave. */
import { Mix, bass, bassNote, chord, clap, clock, hat, kick, mtof, pluck, rim, rng, seedNoise, snare, synth, woodblock } from '../synth';
import { phrase, riser, strings, type Play, type Track } from '../kit';

const PROG = ['Am', 'Am', 'F', 'F', 'Dm', 'Dm', 'E7', 'E7'];
const SNEAK = ['A4:.5 -:.5 C5:.5 -:.5 E5:.5 D5:.5 C5:.5 B4:.5', 'A4:1 E4:1 -:2', 'F4:.5 -:.5 A4:.5 -:.5 C5:.5 B4:.5 A4:.5 G4:.5', 'A4:1 C5:1 -:2',
  'D5:.5 -:.5 F5:.5 -:.5 A5:.5 G5:.5 F5:.5 E5:.5', 'D5:1 A4:1 -:2', 'G#4:.5 B4:.5 D5:.5 E5:.5 F5:.5 E5:.5 D5:.5 B4:.5', 'G#4:1 B4:1 E5:1 -:1'];

export default { id: 'vote', title: 'Ballot Bounce', mood: 'Playful ticking tension for voting', bpm: 124, bars: 24, lufs: -17, render() {
  seedNoise(505); const r = rng(505), c = clock(124, .5, .5), mix = new Mix(24 * c.bar);
  const os = mix.bus(), low = mix.bus(), drums = mix.bus(), ld = mix.bus(), st = mix.bus(), tick = mix.bus();
  const prog = [...PROG, ...PROG, ...PROG];
  prog.forEach((ch, bar) => {
    const { root, iv } = chord(ch), sec = Math.floor(bar / 8), b2 = bassNote(ch), pc = 57 + ((root - 9 + 12) % 12);
    const cell = [pc + 12, pc + iv[2], pc + iv[1] + 12, pc + iv[2]];
    for (let e = 0; e < 8; e++) pluck(os, c.at(bar, e / 2), .2 * c.spb, mtof(cell[e % 4]), e % 4 ? .45 : .6, (e % 2 ? .3 : -.3), { bright: .7, decay: .35 });
    for (let e = 0; e < 8; e++) bass(low, c.at(bar, e / 2), .4 * c.spb, mtof(b2 + (e === 7 && bar % 2 ? 12 : 0)), e % 2 ? .6 : .85, { drive: 1.8, bright: .35 });
    for (let b = 0; b < 4; b++) woodblock(tick, c.at(bar, b), b % 2 ? .25 : .32, b % 2 ? .3 : -.3, b % 2 ? 1100 : 1500);
    for (const b of sec === 2 ? [0, 1, 2, 3] : [0, 2]) kick(drums, c.at(bar, b), .8, { f0: 130, f1: 50, decay: .25 });
    if (sec) for (const b of [1, 3]) { clap(drums, c.at(bar, b), .45, 0); rim(drums, c.at(bar, b), .3, .2); }
    if (sec === 2) { for (let s = 0; s < 16; s++) hat(drums, c.at(bar, s / 4), s % 4 === 2 ? .35 : .15, .3, .025); strings(st, c.at(bar, 0), c.bar * .98, mtof(pc + 12 + iv[1]), .3, .2, .1); strings(st, c.at(bar, 0), c.bar * .98, mtof(pc + 12), .3, -.2, .1); }
    else for (let s = 0; s < 8; s++) hat(drums, c.at(bar, s / 2 + .5), .2, .3, .02);
  });
  for (const k of [0, 1, 2, 3, 4, 5, 6, 7]) snare(drums, c.at(23, 2 + k / 4), .2 + k * .07, 0, { tone: 210 });
  riser(drums, c.at(15, 0), c.bar, .5);
  const sneak: Play = (t, d, f, vel) => synth(ld, t, d, f, vel, .1, { wave: 'pulse', pw: .3, voices: 2, detune: 9, cutoff: 1500, env: 2200, envDecay: .07, res: .2, a: .003, d: .1, s: .5, r: .05 });
  phrase(c, 8, SNEAK, sneak, r, { jitter: .005, legato: .6 }); phrase(c, 16, SNEAK, sneak, r, { jitter: .005, legato: .6, transpose: 12, vel: .7 });
  mix.add('ostinato', os, { gain: 3.3, reverb: .18 });
  mix.add('bass', low, { gain: .35 });
  mix.add('clock', tick, { gain: 3.5, reverb: .1 });
  mix.add('drums', drums, { gain: .55, reverb: .08 });
  mix.add('lead', ld, { gain: 1.1, reverb: .2, echo: .15 });
  mix.add('strings', st, { gain: 1.6, reverb: .35 });
  return mix.finish({ room: .7, damp: .45, echoTime: c.spb * .5, echoFb: .25, target: .12 });
} } satisfies Track;
