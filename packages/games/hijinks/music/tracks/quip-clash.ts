/* Quip Clash: a comedy-club swing on Bb rhythm changes (AABA). Walking upright, brushes and ride, comping piano, muted trumpet head, ba-dum-tss turnaround. */
import { Mix, brush, chord, clock, hat, kick, mallet, mtof, pluck, rim, ride, rng, seedNoise, snare, synth, voicer } from '../synth';
import { chordsOf, crash, horn, phrase, piano, tom, walk, type Play, type Track } from '../kit';

const A = ['Bb6 G7', 'Cm7 F7', 'Dm7 G7', 'Cm7 F7', 'Fm7 Bb7', 'Ebmaj7 Ab7', 'Dm7 G7', 'Cm7 F7'], BRIDGE = ['D7', 'D7', 'G7', 'G7', 'C7', 'C7', 'F7', 'F7'];
const HEAD = ['D5:.5 F5:.5 G5:.5 F5:.5 -:.5 D5:.5 B4:.5 D5:.5', 'C5:.5 Eb5:.5 G5:.5 Bb5:1 A5:.5 G5:.5 F5:.5', 'F5:.5 D5:.5 -:.5 A5:.5 B5:.5 G5:.5 F5:.5 D5:.5', 'Eb5:1.5 D5:.5 C5:.5 A4:.5 -:1',
  'Ab5:.5 F5:.5 C5:.5 Ab5:.5 -:.5 D5:.5 F5:.5 Ab5:.5', 'G5:1 Bb5:.5 G5:.5 Gb5:1 Eb5:.5 C5:.5', 'F5:.5 E5:.5 F5:.5 A5:.5 B5:.5 D6:.5 B5:.5 G5:.5', 'Bb5:1 -:1 F4:.5 G4:.5 A4:.5 C5:.5'];
const MIDDLE = ['F#5:1.5 A5:.5 C6:1 A5:1', 'F#5:.5 E5:.5 D5:1 -:2', 'B5:1.5 D6:.5 F6:1 D6:1', 'B5:.5 A5:.5 G5:1 -:2', 'E5:1.5 G5:.5 Bb5:1 G5:1', 'E5:.5 D5:.5 C5:1 -:2',
  'A5:.5 C6:.5 Eb6:.5 C6:.5 A5:.5 F5:.5 Eb5:.5 C5:.5', 'Eb5:.5 D5:.5 -:1 F4:.5 G4:.5 A4:.5 C5:.5'];

export default { id: 'quip-clash', title: 'Open Mic Swing', mood: 'Comedy-club jazz swing with a wink', bpm: 152, bars: 32, render() {
  seedNoise(202); const r = rng(202), c = clock(152, .66, .5), mix = new Mix(32 * c.bar);
  const low = mix.bus(), drums = mix.bus(), keys = mix.bus(), tp = mix.bus(), vb = mix.bus();
  const spans = chordsOf([...A, ...A, ...BRIDGE, ...A]), v = voicer(60);
  spans.forEach((s, i) => {
    const next = spans[(i + 1) % spans.length].sym;
    walk(s.sym, next, s.beats, r).forEach((m, k) => pluck(low, c.at(s.bar, s.beat + k), .85 * c.spb, mtof(m), k ? .82 : .95, 0, { bright: .3, decay: 1.3, body: 110 }));
    // Comping: on the chord, or a swung push into it.
    const hit = s.beats === 2 ? (s.beat ? -.5 : 0) : r() < .5 ? 0 : 1.5, notes = v(s.sym);
    notes.forEach((m, k) => piano(keys, c.at(s.bar, s.beat + hit) + k * .006, .45 * c.spb, mtof(m), .42 + r() * .1, .15));
    if (s.beats === 4 && r() < .6) notes.forEach((m, k) => piano(keys, c.at(s.bar, 3.5) + k * .006, .3 * c.spb, mtof(m), .32, .15));
  });
  for (let bar = 0; bar < 32; bar++) {
    for (const b of [0, 1, 1.5, 2, 3, 3.5]) ride(drums, c.at(bar, b), (b % 1 ? .3 : .5) * (.85 + r() * .3), .35);
    for (const b of [1, 3]) { hat(drums, c.at(bar, b), .3, -.3, .02); brush(drums, c.at(bar, b), .35, -.1, .12); }
    for (const b of [0, 2]) brush(drums, c.at(bar, b), .22, .1, .3);
    kick(drums, c.at(bar, 0), .22, { f0: 90, decay: .2, click: .05 });
    if (r() < .5) snare(drums, c.at(bar, [1.5, 2.5, 3.5][Math.floor(r() * 3)]), .1 + r() * .08, -.1, { tone: 220, snappy: .45, decay: .07 });
  }
  // Ba-dum-tss into the top of the form.
  snare(drums, c.at(31, .5), .6, 0, { tone: 230 }); tom(drums, c.at(31, 1), .6, 120, -.2); kick(drums, c.at(31, 1), .55); crash(drums, c.at(31, 2), .5, .3, .7);
  rim(drums, c.at(15, 3.5), .5, .2); kick(drums, c.at(15, 3.5), .4);
  const muted: Play = (t, d, f, vel) => horn(tp, t, d, f, vel, .2);
  const open: Play = (t, d, f, vel) => synth(tp, t, d, f, vel * .9, .2, { wave: 'saw', cutoff: 1300, env: 2600, envDecay: .15, res: .15, a: .03, d: .3, s: .75, r: .1, vib: .006, vibRate: 5.4 });
  const vibes: Play = (t, d, f, vel) => mallet(vb, t, d, f, vel * .8, -.25, 'vibes');
  phrase(c, 0, HEAD, muted, r, { jitter: .014 }); phrase(c, 8, HEAD, vibes, r, { jitter: .008 });
  phrase(c, 16, MIDDLE, open, r, { jitter: .014 }); phrase(c, 24, HEAD, muted, r, { jitter: .014 }); phrase(c, 24, HEAD, vibes, r, { jitter: .008, transpose: -12, vel: .5 });
  // A walk-up piano answer under the bridge.
  for (const bar of [17, 19, 21]) { const root = chord(BRIDGE[bar - 16]).root + 72; [0, 4, 7, 10].forEach((iv, k) => piano(keys, c.at(bar, 2 + k * .5), .4 * c.spb, mtof(root + iv - 12), .45, .25)); }
  mix.add('bass', low, { gain: 1.4 });
  mix.add('drums', drums, { gain: 1.8, reverb: .12 });
  mix.add('piano', keys, { gain: 1.3, reverb: .2 });
  mix.add('trumpet', tp, { gain: 2, reverb: .3, echo: .08 });
  mix.add('vibes', vb, { gain: .6, reverb: .35 });
  return mix.finish({ room: .74, damp: .45, echoTime: c.spb * .75, echoFb: .2, target: .12 });
} } satisfies Track;
