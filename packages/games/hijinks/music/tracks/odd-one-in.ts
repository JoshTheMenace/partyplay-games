/* Odd One In: a tiptoeing spy-jazz caper in C minor (A–B–A′). Sneaky upright ostinato, baritone twang guitar riff with a muted-horn
   shadow, a vibes line cliché, bongos and finger snaps; the bridge goes lyrical on vibes, then the brass section takes the riff
   with a minor-major "case closed" stab before the turnaround. */
import { Mix, chord, clap, clock, hat, kick, mallet, midi, mtof, pluck, rim, ride, rng, seedNoise, snare, voicer, brush } from '../synth';
import { brass, chordsOf, crash, horn, phrase, tom, walk, type Play, type Track } from '../kit';

const A = ['Cm', 'Cm', 'Cm', 'Cm', 'Fm7', 'Fm7', 'Ab7 G7', 'Cm'], B = ['Abmaj7', 'Abmaj7', 'Fm7', 'G7', 'Ebmaj7', 'Abmaj7', 'Dm7b5', 'G7b9'];
const A2 = ['Cm', 'Cm', 'Cm', 'Cm', 'Fm7', 'Fm7', 'Ab7 G7', 'Cm G7'];
const RIFF = [
  'G4:.75 -:.25 G4:.5 Ab4:.5 G4:.5 -:.5 Eb4:1', 'C4:.5 Eb4:.5 F#4:.5 G4:1 -:1.5',
  'G4:.75 -:.25 G4:.5 Ab4:.5 Bb4:.5 Ab4:.5 G4:.5 F4:.5', 'Eb4:1.5 D4:.5 C4:1 -:1',
  'Ab4:.75 -:.25 Ab4:.5 Bb4:.5 C5:.5 -:.5 Ab4:1', 'F4:.5 Ab4:.5 B4:.5 C5:1 -:1.5',
  'Eb5:.5 C5:.5 Ab4:.5 Gb4:.5 F4:.5 D4:.5 B3:.5 D4:.5', 'C4:2 -:1 G3:.5 B3:.5',
];
const BRIDGE = [
  'C5:1.5 Eb5:.5 G5:1 F5:1', 'Eb5:2 -:1 C5:.5 Eb5:.5', 'Ab5:1.5 G5:.5 F5:1 Eb5:1', 'D5:1.5 F5:.5 B4:2',
  'G5:1.5 Bb5:.5 D6:1 C6:1', 'Bb5:1 Ab5:1 G5:1 Eb5:1', 'F5:1 Ab5:.5 F5:.5 D5:1 C5:1', 'B4:1 D5:1 F5:.5 G5:.5 Ab5:.5 B5:.5',
];
const OUT = [...RIFF.slice(0, 7), 'C4:1 -:1 G3:.5 B3:.5 D4:.5 F4:.5'];
/** Sneaky bass bar on a root (MIDI): bounce, then creep chromatically up to the fifth. */
const sneak = (root: number) => [[0, .5, root], [.75, .25, root], [1, .5, root + 7], [1.5, .5, root], [2, .5, root + 3], [2.5, .5, root + 5], [3, .5, root + 6], [3.5, .5, root + 7]] as const;
/** Vibes line cliché over the four Cm bars: C, B, Bb, A against a held G. */
const CLICHE = ['C5', 'B4', 'Bb4', 'A4'];

export default { id: 'odd-one-in', title: 'Trench Coat Tiptoe', mood: 'Sneaky spy-jazz caper with a wink', bpm: 124, bars: 24, render() {
  seedNoise(616); const r = rng(616), c = clock(124, .6, .5), mix = new Mix(24 * c.bar);
  const low = mix.bus(), drums = mix.bus(), gtr = mix.bus(), comp = mix.bus(), vb = mix.bus(), horns = mix.bus();
  const prog = [...A, ...B, ...A2], spans = chordsOf(prog), v = voicer(62);
  // Bass: the sneak ostinato in the A sections, a swung walk through the bridge.
  spans.forEach((s, i) => {
    const bridge = s.bar >= 8 && s.bar < 16, root = 36 + ((chord(s.sym).root + 12) % 12);
    if (!bridge && s.beats === 4) for (const [at, d, m] of sneak(root)) pluck(low, c.at(s.bar, at), d * .9 * c.spb, mtof(m), at ? .8 : .95, 0, { bright: .32, decay: 1.1, body: 110 });
    else walk(s.sym, spans[(i + 1) % spans.length]!.sym, s.beats, r).forEach((m, k) => pluck(low, c.at(s.bar, s.beat + k), .85 * c.spb, mtof(m), k ? .8 : .95, 0, { bright: .3, decay: 1.2, body: 110 }));
    // Comp: muted "chk" chords on the offbeats in A; soft vibes chords in the bridge.
    const notes = v(s.sym);
    if (bridge) notes.forEach((m, k) => mallet(vb, c.at(s.bar, s.beat) + k * .01, s.beats * .9 * c.spb, mtof(m), .32, .3, 'vibes'));
    else for (const b of s.beats === 4 ? [1.5, 3.5] : [1.5]) notes.forEach((m, k) => pluck(comp, c.at(s.bar, s.beat + b - (s.beats === 4 ? 0 : 1)) + k * .004, .18 * c.spb, mtof(m), .4, .35, { bright: .8, decay: .25, pick: .2 }));
  });
  for (const start of [0, 16]) CLICHE.forEach((n, k) => [midi('G4'), midi(n)].forEach(m => mallet(vb, c.at(start + k, 0), 3.6 * c.spb, mtof(m), .3, -.2, 'vibes')));
  // Drums: brushed swing ride, snaps on 2 and 4, tiptoe bongos, a soft kick; a tom fill out of the bridge.
  for (let bar = 0; bar < 24; bar++) {
    for (const b of [0, 1, 1.5, 2, 3, 3.5]) ride(drums, c.at(bar, b), (b % 1 ? .25 : .42) * (.85 + r() * .3), .35);
    for (const b of [1, 3]) { clap(drums, c.at(bar, b), .22, -.25); brush(drums, c.at(bar, b), .25, .1, .1); hat(drums, c.at(bar, b), .2, .3, .02); }
    kick(drums, c.at(bar, 0), .4, { f0: 85, decay: .22, click: .04 }); if (r() < .5) kick(drums, c.at(bar, 2.5), .22, { f0: 85, decay: .18 });
    for (const [b, f, vel] of [[.5, 420, .3], [1.5, 330, .26], [2.5, 420, .3], [2.75, 420, .18], [3.5, 330, .28]] as const) tom(drums, c.at(bar, b), vel * (.85 + r() * .3), f, .45);
    if (bar % 4 === 3) rim(drums, c.at(bar, 3.5), .4, -.2);
  }
  [[15, 2, 200], [15, 2.5, 170], [15, 3, 140], [15, 3.5, 115]].forEach(([bar, b, f]) => tom(drums, c.at(bar!, b!), .55, f!, -.2));
  crash(drums, c.at(16, 0), .45, .3, .9); snare(drums, c.at(7, 3.5), .35, 0, { tone: 230, snappy: .4 });
  // Melody: baritone twang riff (an octave down) with a muted-horn shadow; bridge on vibes; brass takes the last A.
  const twang: Play = (t, d, f, vel) => pluck(gtr, t, d, f / 2, vel * .95, -.3, { bright: .75, decay: 1.6, pick: .35, body: 180 });
  const muted: Play = (t, d, f, vel) => horn(horns, t, d, f, vel * .75, .25);
  const vibes: Play = (t, d, f, vel) => mallet(vb, t, d, f, vel, -.1, 'vibes');
  const section: Play = (t, d, f, vel) => brass(horns, t, d, f, vel * .8, 0);
  phrase(c, 0, RIFF, twang, r, { jitter: .008 }); phrase(c, 4, RIFF.slice(4), muted, r, { jitter: .012, vel: .7 });
  phrase(c, 8, BRIDGE, vibes, r, { jitter: .008, vel: .9 }); phrase(c, 8, BRIDGE, twang, r, { jitter: .01, vel: .35, transpose: -12 });
  phrase(c, 16, OUT, twang, r, { jitter: .008, vel: .8 }); phrase(c, 16, OUT, section, r, { jitter: .012, vel: .72 });
  // The minor-major "case closed" stab under the final Cm.
  ['C4', 'Eb4', 'G4', 'B4', 'D5'].forEach((n, k) => brass(horns, c.at(23, 0) + k * .006, .9 * c.spb, mtof(midi(n)), .5, k / 4 - .5));
  mix.add('bass', low, { gain: 1.5 });
  mix.add('drums', drums, { gain: 1.6, reverb: .12 });
  mix.add('guitar', gtr, { gain: 2.4, reverb: .25, echo: .18 });
  mix.add('comp', comp, { gain: 3.4, reverb: .2 });
  mix.add('vibes', vb, { gain: 1, reverb: .35 });
  mix.add('horns', horns, { gain: 2.1, reverb: .3, echo: .06 });
  return mix.finish({ room: .78, damp: .45, echoTime: c.spb * .75, echoFb: .25, target: .12 });
} } satisfies Track;
