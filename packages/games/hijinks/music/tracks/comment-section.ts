/* Comment Section: "Doomscroll", a bubbly city-pop groove in F (A–B–A′) for a parody social app. Syncopated octave bass, Rhodes stabs
   on the off-beats, a glassy square-lead hook doubled by a notification bell, and "ding-ding" alert motifs at every section. The
   bridge drops to a half-time scroll: plucked sixteenth arpeggios and vibes trading phrases with the bell, then a riser brings the
   whole feed back for A′, whose last bar turns around into bar 0. */
import { Mix, bass, bassNote, chord, clap, clock, ep, hat, kick, mallet, mtof, pluck, rng, seedNoise, shaker, snare, voicer } from '../synth';
import { chordsOf, crash, lead, phrase, riser, type Play, type Track } from '../kit';

const A = ['Fmaj7', 'Em7 A7', 'Dm7', 'Cm7 F7', 'Bbmaj7', 'Am7 Dm7', 'Gm7', 'C7sus4'];
const B = ['Bbmaj7', 'C7sus4', 'Am7', 'Dm9', 'Gm7', 'Am7', 'Bbmaj7', 'C7sus4 C7'];
const A2 = ['Fmaj7', 'Em7 A7', 'Dm7', 'Cm7 F7', 'Bbmaj7', 'Am7 Dm7', 'Gm7 C7', 'Fmaj7 C7'];
const HOOK = [
  'A5:.5 C6:.5 E6:.75 D6:.25 C6:.5 A5:.5 -:1', 'G5:.5 A5:.5 C#6:.5 E6:.5 -:.5 D6:.5 C#6:.5 A5:.5',
  'F5:.75 A5:.25 D6:.5 C6:.5 A5:1 -:1', 'Eb6:.5 D6:.5 C6:.5 Bb5:.5 A5:.5 F5:.5 -:1',
  'D6:.5 F6:.5 A6:.75 G6:.25 F6:.5 D6:.5 -:1', 'E6:.5 C6:.5 A5:.5 E6:.5 F6:.5 E6:.5 D6:1',
  'Bb5:.5 D6:.5 F6:.5 E6:.5 D6:.5 Bb5:.5 G5:1', 'C6:1.5 -:.5 F6:.25 E6:.25 D6:.25 C6:.25 Bb5:1',
];
const SCROLL = [
  'D6:1 C6:.5 Bb5:.5 A5:1 -:1', 'G5:.5 Bb5:.5 C6:.5 F6:.5 E6:1 -:1', 'C6:1 A5:.5 G5:.5 E5:1 -:1', 'F5:.5 A5:.5 D6:.5 E6:.5 F6:1 -:1',
  'D6:1 Bb5:.5 A5:.5 G5:1 -:1', 'E5:.5 G5:.5 C6:.5 E6:.5 G6:1 -:1', 'F6:.75 E6:.25 D6:.5 C6:.5 A5:1 -:1', 'G5:.5 A5:.5 Bb5:.5 C6:.5 E6:1 G6:1',
];
const OUT = [...HOOK.slice(0, 7), 'F6:1 C6:.5 A5:.5 -:1 G5:.5 E5:.5'];

export default { id: 'comment-section', title: 'Doomscroll', mood: 'Bubbly city-pop groove with notification-bell hooks', bpm: 116, bars: 24, render() {
  seedNoise(808); const r = rng(808), c = clock(116, .53, .25), mix = new Mix(24 * c.bar);
  const low = mix.bus(), drums = mix.bus(), keys = mix.bus(), hook = mix.bus(), bells = mix.bus(), arps = mix.bus();
  const v = voicer(63);
  for (const { sym, bar, beat, beats } of chordsOf([...A, ...B, ...A2])) {
    const scroll = bar >= 8 && bar < 16, root = bassNote(sym, 1), { iv } = chord(sym), notes = v(sym);
    // Bass: root, octave pop on the "e", root, fifth and a passing seventh; half the notes in the half-time bridge.
    const line: [number, number, number][] = beats === 4 ? [[0, 0, .6], [.75, 12, .2], [1.5, 0, .35], [2.5, iv[2]!, .35], [3.25, iv[3] ?? 12, .2]] : [[0, 0, .6], [.75, 12, .2], [1.5, iv[2]!, .35]];
    for (const [at, step, d] of scroll ? line.filter((_, k) => k % 2 === 0) : line) bass(low, c.at(bar, beat + at), d * c.spb * 1.6, mtof(root + step), at ? .78 : .95, { drive: .5, bright: .45 });
    // Rhodes: off-beat stabs in the A sections, long washes in the bridge.
    if (scroll) notes.forEach((m, n) => ep(keys, c.at(bar, beat) + n * .006, beats * c.spb * .95, mtof(m), .45, (n - 1.5) * .25));
    else for (let s = .5; s < beats; s += 2) notes.forEach((m, n) => ep(keys, c.at(bar, beat + s) + n * .004, .55 * c.spb, mtof(m), .5 + r() * .08, (n - 1.5) * .3));
    // Bridge arpeggio: sixteenths climbing through the chord, the "scroll" of the title.
    if (scroll) for (let s = 0; s < beats * 4; s++) pluck(arps, c.at(bar, beat + s / 4), .22 * c.spb, mtof(notes[s % notes.length]! + 12 * (Math.floor(s / notes.length) % 2)), .38 + (s % 4 ? 0 : .12), s % 2 ? .45 : -.45, { bright: .8, decay: .45 });
  }
  for (let bar = 0; bar < 24; bar++) {
    const scroll = bar >= 8 && bar < 16;
    for (const beat of scroll ? [0, 2.5] : [0, 1.75, 2, 3.5]) { kick(drums, c.at(bar, beat), beat % 1 ? .6 : .9, { f0: 130, f1: 46, decay: .26 }); mix.kickAt(c.at(bar, beat)); }
    for (const beat of scroll ? [2] : [1, 3]) { snare(drums, c.at(bar, beat), .55, 0, { tone: 200, snappy: .7, decay: .14 }); clap(drums, c.at(bar, beat) + .004, .5, .1); }
    for (let s = 0; s < 16; s++) hat(drums, c.at(bar, s / 4), s % 4 === 2 ? .38 : s % 2 ? .14 : .24, .25, s % 8 === 6 ? .09 : .03);
    if (!scroll) for (let e = 1; e < 8; e += 2) shaker(drums, c.at(bar, e / 2), .22, -.35);
  }
  // Notification motif ("ding-ding") opens every section and answers the hook's long notes.
  const ding = (bar: number, beat: number, vel = .7) => { mallet(bells, c.at(bar, beat), .9, mtof(84), vel, .35, 'bell'); mallet(bells, c.at(bar, beat + .5), 1.4, mtof(89), vel, .35, 'bell'); };
  for (const bar of [0, 8, 16]) ding(bar, 0, .8);
  for (const bar of [2, 6, 18, 22]) ding(bar, 3);
  crash(drums, c.at(0, 0), .55, -.3); crash(drums, c.at(16, 0), .7, .3);
  riser(drums, c.at(14, 0), 2 * c.bar, .8);
  [3, 3.25, 3.5, 3.75].forEach((beat, k) => snare(drums, c.at(15, beat), .35 + k * .14, 0, { tone: 230 }));
  snare(drums, c.at(23, 3.5), .5, 0, { tone: 220 });
  const square: Play = (t, d, f, vel) => lead(hook, t, d, f, vel * .75, -.1), bell: Play = (t, d, f, vel) => mallet(bells, t, d, f * 2, vel * .3, .25, 'bell');
  const vibes: Play = (t, d, f, vel) => mallet(hook, t, d + .3, f, vel * .9, .15, 'vibes');
  phrase(c, 0, HOOK, square, r, { jitter: .006 }); phrase(c, 0, HOOK, bell, r, { jitter: .004 });
  phrase(c, 8, SCROLL, vibes, r, { jitter: .008 });
  phrase(c, 16, OUT, square, r, { jitter: .006 }); phrase(c, 16, OUT, bell, r, { jitter: .004 });
  phrase(c, 16, OUT, (t, d, f, vel) => lead(hook, t, d, f / 2, vel * .35, .3), r, { jitter: .008 });
  mix.add('bass', low, { gain: .7 });
  mix.add('drums', drums, { gain: .9, reverb: .08 });
  mix.add('keys', keys, { gain: .75, reverb: .22, duck: .3 });
  mix.add('hook', hook, { gain: .95, reverb: .22, echo: .12 });
  mix.add('bells', bells, { gain: 1, reverb: .35, echo: .18 });
  mix.add('arps', arps, { gain: 2.4, reverb: .25, echo: .15, duck: .35 });
  return mix.finish({ room: .7, damp: .4, echoTime: c.spb * .75, echoFb: .25, target: .12 });
} } satisfies Track;
