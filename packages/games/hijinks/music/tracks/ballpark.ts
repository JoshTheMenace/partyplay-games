/* Ballpark: a slinky 60s spy-lab lounge in E minor (A–B–A′). A combo organ comps a bossa groove under rim-click clave, a
   reverb-soaked baritone twang states the hook, and a little analogue computer arpeggiates every chord like a data readout.
   In the bridge a muted trumpet and vibes take the tune up through the relative major; the brass brings the hook home and a
   chromatic B7 pickup leads back into bar 0. */
import { Mix, chord, clock, hat, kick, mallet, midi, mtof, pluck, rim, rng, seedNoise, shaker, synth, voicer } from '../synth';
import { brass, chordsOf, crash, horn, organ, phrase, riser, tom, type Play, type Track } from '../kit';

const A = ['Em9', 'Em9', 'Cmaj7', 'Cmaj7', 'Am9', 'B7', 'Em9', 'B7'];
const B = ['Gmaj7', 'F#m7b5 B7', 'Em9', 'Dm7 G7', 'Cmaj7', 'Am7', 'F#m7b5', 'B7'];
const A2 = ['Em9', 'Em9', 'Cmaj7', 'Cmaj7', 'Am9', 'B7', 'Em9', 'F#m7b5 B7'];
const HOOK = [
  'E4:.5 G4:.5 B4:1 A4:.5 G4:.5 F#4:1', 'G4:.75 F#4:.25 E4:1 -:1 B3:.5 E4:.5',
  'G4:.5 B4:.5 E5:1 D5:.5 B4:.5 G4:1', 'B4:1.5 A4:.5 G4:1 -:1',
  'A4:.5 C5:.5 E5:1 D5:.5 C5:.5 B4:1', 'D#5:1 C5:.5 B4:.5 A4:1 F#4:1',
  'G4:.5 F#4:.5 E4:1.5 -:1.5', '-:1 B3:.5 C#4:.5 D#4:.5 F#4:.5 A4:1',
];
const BRIDGE = [
  'B4:1.5 D5:.5 F#5:1 E5:1', 'D5:1 C5:1 B4:1 A4:1', 'G4:1.5 B4:.5 E5:2', 'F5:1 E5:.5 D5:.5 B4:1 G4:1',
  'E5:1.5 G5:.5 B5:1 G5:1', 'A5:1 G5:.5 E5:.5 C5:2', 'E5:1 C5:1 A4:1 F#4:1', 'D#5:1.5 F#5:.5 A5:1 B5:1',
];
const OUT = [...HOOK.slice(0, 7), '-:.5 A4:.5 C5:.5 B4:.5 A4:.5 F#4:.5 D#4:.5 B3:.5'];
/** Data-readout arpeggio: chord-tone index per sixteenth (-1 = rest). */
const BLIPS = [0, 2, 1, 3, -1, 2, 0, 3, 1, -1, 3, 2, 0, 2, -1, 3];

export default { id: 'ballpark', title: 'Dead Reckoning', mood: 'Slinky spy-lab lounge with a wink and a ticking computer', bpm: 112, bars: 24, render() {
  seedNoise(4711); const r = rng(4711), c = clock(112, .54, .5), mix = new Mix(24 * c.bar);
  const low = mix.bus(), drums = mix.bus(), gtr = mix.bus(), keys = mix.bus(), cpu = mix.bus(), vb = mix.bus(), horns = mix.bus(), fx = mix.bus();
  const prog = [...A, ...B, ...A2], spans = chordsOf(prog), v = voicer(60), hi = voicer(76, false);
  spans.forEach(s => {
    const bridge = s.bar >= 8 && s.bar < 16, { root, iv } = chord(s.sym), r0 = 40 + ((root - 4 + 12) % 12), fifth = r0 + iv[2]!;
    // Bossa bass: root, a push on the and-of-two, the fifth (two-chord bars: root then fifth).
    const notes = s.beats === 4 ? [[0, 1.4, r0], [1.5, .45, r0], [2, 1.4, fifth], [3.5, .45, r0 + (iv[1] === 3 ? 10 : 12)]] as const : [[0, 1.4, r0], [1.5, .45, fifth]] as const;
    for (const [at, d, m] of notes) pluck(low, c.at(s.bar, s.beat + at), d * c.spb, mtof(m), at ? .78 : .95, 0, { bright: .28, decay: 1.4, body: 100 });
    // Combo organ stabs in the A sections; held, softer chords in the bridge.
    const chordNotes = v(s.sym);
    if (bridge) chordNotes.forEach(m => organ(keys, c.at(s.bar, s.beat), s.beats * .92 * c.spb, mtof(m), .2, .15));
    else for (const [b, d] of (s.beats === 4 ? [[0, .4], [1.5, .4], [3, .7]] : [[0, .4], [1.5, .4]]) as [number, number][]) chordNotes.forEach((m, k) => organ(keys, c.at(s.bar, s.beat + b) + k * .003, d * c.spb, mtof(m), .24, -.15));
    // The computer: quiet square-wave blips over the chord, two octaves up, in the A sections.
    if (!bridge) {
      const tones = hi(s.sym);
      for (let k = 0; k < s.beats * 4; k++) {
        const idx = BLIPS[(k + s.beat * 4) % 16]!; if (idx < 0) continue;
        synth(cpu, c.at(s.bar, s.beat + k / 4), .09, mtof(tones[idx % tones.length]! + 12), .18 + (k % 4 === 0 ? .08 : 0), k % 2 ? .45 : -.45, { wave: 'square', cutoff: 2600, a: .002, d: .07, s: .15, r: .04 });
      }
    }
  });
  // Drums: soft kick, bossa clave on the rim, shaker eighths, offbeat hats; tom fills into each section.
  for (let bar = 0; bar < 24; bar++) {
    kick(drums, c.at(bar, 0), .55, { f0: 70, decay: .26, click: .05 }); kick(drums, c.at(bar, 2), .38, { f0: 70, decay: .22 });
    if (r() < .4) kick(drums, c.at(bar, 3.5), .22, { f0: 70, decay: .18 });
    for (const b of bar % 2 ? [1, 2.5] : [0, 1.5, 3]) rim(drums, c.at(bar, b), .42, -.2);
    for (let k = 0; k < 8; k++) shaker(drums, c.at(bar, k / 2), (k % 2 ? .22 : .32) * (.85 + r() * .3), .35);
    for (const b of [.5, 1.5, 2.5, 3.5]) hat(drums, c.at(bar, b), .16, .25, .03);
  }
  for (const bar of [7, 15]) [[3, 330], [3.25, 280], [3.5, 230], [3.75, 190]].forEach(([b, f]) => tom(drums, c.at(bar, b!), .5, f!, -.15));
  crash(drums, c.at(8, 0), .4, .3, .9); crash(drums, c.at(16, 0), .45, -.3, 1.1);
  riser(fx, c.at(15, 0), 4 * c.spb, .6);
  // Melody: baritone twang (an octave down) for the hook; muted trumpet + vibes in the bridge; brass joins the last A.
  const twang: Play = (t, d, f, vel) => pluck(gtr, t, d, f / 2, vel, -.25, { bright: .7, decay: 1.8, pick: .3, body: 170 });
  const muted: Play = (t, d, f, vel) => horn(horns, t, d, f, vel * .85, .2);
  const vibes: Play = (t, d, f, vel) => mallet(vb, t, d, f, vel * .7, -.2, 'vibes');
  const section: Play = (t, d, f, vel) => brass(horns, t, d, f / 2, vel * .7, .1);
  phrase(c, 0, HOOK, twang, r, { jitter: .008 });
  phrase(c, 8, BRIDGE, muted, r, { jitter: .01, vel: .85 }); phrase(c, 8, BRIDGE, vibes, r, { jitter: .006 });
  phrase(c, 16, OUT, twang, r, { jitter: .008, vel: .85 }); phrase(c, 16, OUT, section, r, { jitter: .012, vel: .75 });
  // A sly B7♭9 brass stab under the end of the bridge, pushing back into the hook.
  ['B3', 'D#4', 'F#4', 'A4', 'C5'].forEach((n, k) => brass(horns, c.at(15, 0) + k * .005, 1.6 * c.spb, mtof(midi(n)), .34, k / 4 - .5));
  mix.add('bass', low, { gain: 1.9 });
  mix.add('drums', drums, { gain: 1.5, reverb: .12 });
  mix.add('guitar', gtr, { gain: 2.6, reverb: .35, echo: .25 });
  mix.add('organ', keys, { gain: 2.7, reverb: .25 });
  mix.add('computer', cpu, { gain: 2.6, reverb: .2, echo: .3 });
  mix.add('vibes', vb, { gain: 1, reverb: .4 });
  mix.add('horns', horns, { gain: 2.2, reverb: .3, echo: .08 });
  mix.add('fx', fx, { gain: .8, reverb: .4 });
  return mix.finish({ room: .8, damp: .4, echoTime: c.spb * .75, echoFb: .28, target: .12 });
} } satisfies Track;
