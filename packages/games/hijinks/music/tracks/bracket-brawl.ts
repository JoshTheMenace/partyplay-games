/* Bracket Brawl: a neon stadium broadcast anthem in D minor at 138 bpm (A–B–breakdown–A′). A pumping octave bass, rock
   drums with big claps, an off-beat saw-stab riff and a brass fanfare hook; B lifts to F major on a square lead over a neon
   sixteenth arpeggio; the breakdown gallops on floor toms under crowd "hey!" stabs, then a riser and a snare roll slam back
   into the top of the loop. */
import { Mix, bass, chord, clap, clock, hat, kick, mtof, rng, seedNoise, snare, synth, voicer } from '../synth';
import { brass, crash, lead, phrase, riser, strings, tom, type Play, type Track } from '../kit';

const A = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'A7'], B = ['F', 'C', 'Dm', 'Bb', 'F', 'C', 'Gm', 'A7'];
const DOWN = ['Dm', 'Dm', 'Dm', 'Dm', 'Bb', 'Bb', 'A7', 'A7'], A2 = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Bb', 'A7', 'A7'];
/** The fanfare: a rising call, a held answer, then a climb to the high D. */
const HOOK = [
  'A4:.5! D5:.5 F5:.5 A5:1 G5:.5 F5:.5 E5:.5', 'D5:1.5 -:.5 A4:.5 D5:.5 F5:1', 'G5:.5! F5:.5 D5:.5 Bb4:1 C5:.5 D5:1', 'E5:1.5 C5:.5 G5:2',
  'A4:.5! D5:.5 F5:.5 A5:1 G5:.5 F5:.5 E5:.5', 'F5:.5 A5:.5 D6:1 C6:.5 A5:.5 F5:1', 'G5:.75 F5:.25 G5:.5 Bb5:.5 A5:1 G5:1', 'C#5:1! E5:.5 G5:.5 A5:2',
];
const HOOK2 = [...HOOK.slice(0, 5), 'F5:.5 A5:.5 D6:1 C6:.5 Bb5:.5 F5:1', 'E5:.75 F5:.25 G5:.5 A5:.5 C#6:1 E6:1', 'E6:2! -:1 A5:.5 C#6:.5'];
/** B: the major-key lift on a square lead. */
const LIFT = [
  'C6:1! A5:.5 F5:.5 G5:1 A5:1', 'G5:1.5 E5:.5 C5:1 -:1', 'D5:.5 F5:.5 A5:.5 D6:.5 C6:1 A5:1', 'Bb5:1.5 A5:.5 F5:2',
  'C6:1! A5:.5 F5:.5 G5:1 A5:1', 'G5:.5 A5:.5 G5:.5 E5:.5 C6:2', 'D6:1 Bb5:.5 G5:.5 A5:.5 Bb5:.5 C6:1', 'C#6:1.5! A5:.5 E5:1 -:1',
];
/** Brass answers the lift at the end of each bar. */
const UPDOWN = [0, 1, 2, 3, 4, 3, 2, 1];
const ANSWER = ['-:3 F4:.5 A4:.5', '-:3 E4:.5 G4:.5', '-:3 F4:.5 A4:.5', '-:3 D4:.5 F4:.5', '-:3 F4:.5 A4:.5', '-:3 G4:.5 C5:.5', '-:3 G4:.5 Bb4:.5', '-:2 A4:.5 C#5:.5 E5:1'];

export default { id: 'bracket-brawl', title: 'Main Event Neon', mood: 'Neon stadium broadcast anthem: pumping bass, brass fanfare, arena drums, tom breakdown', bpm: 138, bars: 32, render() {
  seedNoise(4474); const r = rng(4474), c = clock(138), mix = new Mix(32 * c.bar);
  const low = mix.bus(), drums = mix.bus(), stab = mix.bus(), arp = mix.bus(), pad = mix.bus(), hook = mix.bus(), horns = mix.bus(), fx = mix.bus();
  const prog = [...A, ...B, ...DOWN, ...A2], voice = voicer(64), hey = voicer(58);
  prog.forEach((sym, bar) => {
    const { root, iv } = chord(sym), pc = (root - 2 + 12) % 12, b0 = 38 + pc - (pc > 5 ? 12 : 0);
    const lift = bar >= 8 && bar < 16, down = bar >= 16 && bar < 24, build = bar >= 20 && bar < 24, notes = voice(sym);
    // Bass: octave-pumping eighths; the breakdown holds whole notes until the build.
    if (down && !build) bass(low, c.at(bar, 0), 3.6 * c.spb, mtof(b0), .95, { drive: .6, bright: .3 });
    else for (let e = 0; e < 8; e++) bass(low, c.at(bar, e / 2), .44 * c.spb, mtof(b0 + (e % 2 ? 12 : 0)), e % 2 ? .7 : .95, { drive: .8, bright: .45 });
    // Drums: arena rock (kick 1, 3 and the "and" of 3; snare and clap on 2 and 4), sixteenth hats in the lift.
    if (!down) {
      for (const beat of [0, 2, 2.5]) { kick(drums, c.at(bar, beat), .95, { f0: 130, f1: 46, decay: .3, click: .3 }); mix.kickAt(c.at(bar, beat)); }
      for (const beat of [1, 3]) { snare(drums, c.at(bar, beat), .6, 0, { tone: 190, snappy: .75, decay: .16 }); clap(drums, c.at(bar, beat), .45, 0); }
      for (let s = 0; s < (lift ? 16 : 8); s++) hat(drums, c.at(bar, s * (lift ? .25 : .5)), (lift ? s % 2 : 1) ? .22 : .32, s % 2 ? .3 : -.3, s % 4 === 2 ? .12 : .03);
    } else if (!build) {
      for (const [beat, f] of [[0, 98], [.5, 98], [.75, 98], [1.5, 130], [2, 98], [2.5, 98], [2.75, 98], [3.5, 160]] as const) tom(drums, c.at(bar, beat), .55 + r() * .12, f, (f - 120) / 90);
      for (const beat of [1, 3]) clap(drums, c.at(bar, beat), .65, 0);
      kick(drums, c.at(bar, 0), .9, { f0: 120, f1: 44, decay: .4 }); mix.kickAt(c.at(bar, 0));
    } else {
      for (const beat of [0, 1, 2, 3]) { kick(drums, c.at(bar, beat), .9, { f0: 125, f1: 45, decay: .28 }); mix.kickAt(c.at(bar, beat)); }
      for (const beat of [1, 3]) clap(drums, c.at(bar, beat), .55, 0);
      for (let e = 0; e < 8; e++) hat(drums, c.at(bar, e / 2 + .25), .18 + (bar - 20) * .04, e % 2 ? .3 : -.3, .03);
    }
    // Off-beat saw stabs: the arena riff under the fanfare.
    if (!lift && !down) for (const beat of [.5, 1.5, 2.5, 3.5]) notes.forEach((m, k) => synth(stab, c.at(bar, beat) + k * .003, .16 * c.spb, mtof(m), .38, k % 2 ? .4 : -.4, { wave: 'saw', voices: 2, detune: 12, cutoff: 1400, env: 2600, envDecay: .07, res: .25, a: .002, d: .12, s: .4, r: .05 }));
    // Neon arpeggio: chord tones up two octaves in sixteenths through the lift and the breakdown's build.
    if (lift || down) {
      const tones = [0, iv[1]!, iv[2]!, 12, 12 + iv[1]!].map(i => b0 + 24 + i);
      for (let s = 0; s < 16; s++) synth(arp, c.at(bar, s / 4), .2 * c.spb, mtof(tones[UPDOWN[s % 8]!]!), (s % 4 ? .32 : .45) * (down && !build ? .7 : 1), Math.sin(s * .8) * .5, { wave: 'pulse', pw: .25, cutoff: 3200, env: 1800, envDecay: .05, a: .002, d: .08, s: .3, r: .04 });
    }
    // Pads hold the harmony in the lift and the final A.
    if (lift || bar >= 24) notes.forEach((m, k) => strings(pad, c.at(bar, 0), c.bar * .98, mtof(m), .28, (k - 1) * .35, .12));
    // Crowd "hey!": unison brass stabs on beat 3 of every other breakdown bar.
    if (down && bar % 2) hey(sym).forEach((m, k) => brass(horns, c.at(bar, 2) + k * .004, .3 * c.spb, mtof(m), .9, (k - 1) * .3));
  });
  for (const bar of [0, 8, 16, 24]) crash(drums, c.at(bar, 0), .8, bar % 16 ? .35 : -.35);
  for (const bar of [7, 15]) [3, 3.25, 3.5, 3.75].forEach((beat, k) => tom(drums, c.at(bar, beat), .75, [190, 160, 130, 100][k]!, k / 2 - .7));
  riser(fx, c.at(30, 0), 2 * c.bar, .7);
  for (let s = 0; s < 16; s++) snare(drums, c.at(31, s / 4), .18 + s * .035, 0, { tone: 200, snappy: .8, decay: .07 });
  const fanfare: Play = (t, d, f, v) => brass(horns, t, d, f, v * .85, -.1);
  const sq: Play = (t, d, f, v) => lead(hook, t, d, f, v * .8, .12);
  const low8: Play = (t, d, f, v) => brass(horns, t, d, f, v * .65, .25);
  phrase(c, 0, HOOK, fanfare, r, { jitter: .006 });
  phrase(c, 8, LIFT, sq, r, { jitter: .004 }); phrase(c, 8, ANSWER, low8, r, { jitter: .008 });
  phrase(c, 24, HOOK2, fanfare, r, { jitter: .006 }); phrase(c, 24, HOOK2, sq, r, { jitter: .004, transpose: 12, vel: .45 });
  // The breakdown teases the hook's opening call on the lead, an octave down.
  for (const bar of [17, 19, 21, 23]) phrase(c, bar, ['-:2 A4:.5! D5:.5 F5:.5 A5:.5'], sq, r, { vel: .6, transpose: -12 });
  mix.add('bass', low, { gain: .5, duck: .35 });
  mix.add('drums', drums, { gain: .55, reverb: .08 });
  mix.add('stabs', stab, { gain: 2.8, duck: .3, reverb: .12 });
  mix.add('arp', arp, { gain: 1.8, reverb: .18, echo: .15 });
  mix.add('pad', pad, { gain: 1.5, duck: .25, reverb: .3 });
  mix.add('lead', hook, { gain: 1.3, reverb: .2, echo: .1 });
  mix.add('brass', horns, { gain: 2.1, reverb: .22 });
  mix.add('riser', fx, { gain: .8, reverb: .2 });
  return mix.finish({ room: .72, damp: .4, echoTime: c.spb * .75, echoFb: .25, target: .13 });
} } satisfies Track;
