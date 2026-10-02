/* Split Decision: retro space-age synth-pop in D minor (A–B–A′) for the Dilemma Dimension. The hook is a split argument: a bright
   pulse lead on the left (the YES side) asks, a theremin on the right (the NO side) answers. In the bridge they finally agree and
   sing in thirds over lush strings; in A′ they trade bar by bar, then land in unison on an A7♭9 that falls back into bar 0. An
   arpeggiator ping-pongs every chord left to right, under an octave-pumping synth bass, four-on-the-floor kick and claps. */
import { Mix, bass, chord, clap, clock, hat, kick, mallet, mtof, rng, seedNoise, snare, synth, voicer } from '../synth';
import { chordsOf, crash, lead, phrase, riser, strings, theremin, type Play, type Track } from '../kit';

const A = ['Dm9', 'Bbmaj7', 'Gm9', 'A7sus4 A7', 'Dm9', 'Bbmaj7', 'Em7b5', 'A7b9'];
const B = ['Fmaj7', 'Cadd9', 'Bbmaj9', 'Am7', 'Gm9', 'C9', 'Fmaj7', 'A7sus4 A7'];
const A2 = ['Dm9', 'Bbmaj7', 'Gm9', 'A7sus4 A7', 'Bbmaj9', 'Gm9', 'Em7b5', 'A7b9'];
/** A: two-bar calls (lead) and answers (theremin). '-' bars belong to the other voice. */
const CALL = ['D5:.5 F5:.5 A5:1 G5:.5 F5:.5 E5:1', 'F5:1.5 D5:.5 -:2', '-:4', '-:4', 'D5:.5 F5:.5 A5:1 C6:.5 A5:.5 F5:1', 'D6:1.5 A5:.5 -:2', '-:4', '-:4'];
const ANSWER = ['-:4', '-:4', 'Bb4:1.5 A4:.5 G4:1 D5:1', 'E5:2 C#5:2', '-:4', '-:4', 'G5:1 E5:.5 Bb4:.5 D5:1 C#5:1', 'E5:1 G5:1 Bb5:1 A5:1'];
/** B: they agree. The lead sings the tune, the theremin a third below. */
const TUNE = ['A5:1.5 G5:.5 F5:1 E5:1', 'D5:1.5 E5:.5 G5:2', 'F5:1 D5:1 C5:1 A4:1', 'C5:2 E5:2', 'Bb5:1.5 A5:.5 G5:1 F5:1', 'E5:1 G5:1 Bb5:1 D6:1', 'C6:2 A5:2', 'D5:1 E5:1 C#5:1 E5:1'];
const THIRDS = ['F5:1.5 E5:.5 D5:1 C5:1', 'A4:1.5 C5:.5 E5:2', 'D5:1 Bb4:1 A4:1 F4:1', 'A4:2 C5:2', 'G5:1.5 F5:.5 E5:1 D5:1', 'C5:1 E5:1 G5:1 Bb5:1', 'A5:2 F5:2', 'A4:1 C#5:1 A4:1 C#5:1'];
/** A′: bar-by-bar trading, then both voices in unison for the last two bars. */
const TRADE_LEAD = ['D5:.5 F5:.5 A5:1 G5:.5 F5:.5 E5:1', '-:4', 'Bb5:.5 A5:.5 G5:1 F5:.5 G5:.5 A5:1', '-:4', 'D6:1 C6:.5 A5:.5 F5:1 D5:1', '-:4', 'G5:1 Bb5:1 E5:1 G5:1', 'C#5:1 E5:.5 G5:.5 Bb5:1 A5:1'];
const TRADE_THEREMIN = ['-:4', 'F5:.5 D5:.5 Bb4:1 A4:.5 Bb4:.5 D5:1', '-:4', 'D5:2 C#5:2', '-:4', 'Bb4:1 D5:1 F5:1 A5:1', 'G5:1 Bb5:1 E5:1 G5:1', 'C#5:1 E5:.5 G5:.5 Bb5:1 A5:1'];
/** Arpeggiator: chord-tone index per sixteenth. */
const ARP = [0, 1, 2, 3, 2, 1, 0, 2, 1, 3, 2, 0, 3, 1, 2, 1];

export default { id: 'split-decision', title: 'Two Minds, One Rift', mood: 'Retro space-age synth-pop: a lead and a theremin argue, then agree', bpm: 118, bars: 24, render() {
  seedNoise(5050); const r = rng(5050), c = clock(118, .52, .25), mix = new Mix(24 * c.bar);
  const low = mix.bus(), drums = mix.bus(), arp = mix.bus(), pad = mix.bus(), yes = mix.bus(), no = mix.bus(), sparkle = mix.bus(), fx = mix.bus();
  const spans = chordsOf([...A, ...B, ...A2]), v = voicer(60), hi = voicer(72, false);
  spans.forEach(s => {
    const bridge = s.bar >= 8 && s.bar < 16, { root, iv } = chord(s.sym), r0 = 38 + ((root - 2 + 12) % 12), fifth = r0 + iv[2]!;
    // Octave-pumping synth bass in eighths; the fifth lands on beat 3 of full bars.
    for (let k = 0; k < s.beats * 2; k++) {
      const m = k % 2 ? r0 + 12 : s.beats === 4 && k === 4 ? fifth : r0;
      bass(low, c.at(s.bar, s.beat + k / 2), .42 * c.spb, mtof(m), k % 2 ? .62 : .9, { drive: 2, bright: .45 });
    }
    // Ping-pong arpeggio: left for even sixteenths, right for odd (the split runs through everything).
    const tones = hi(s.sym);
    for (let k = 0; k < s.beats * 4; k++) {
      const idx = ARP[(k + s.beat * 4) % 16]!;
      synth(arp, c.at(s.bar, s.beat + k / 4), .1, mtof(tones[idx % tones.length]!), (bridge ? .16 : .22) + (k % 4 === 0 ? .06 : 0), k % 2 ? .55 : -.55,
        { wave: 'tri', cutoff: 3200, a: .002, d: .08, s: .2, r: .05 });
    }
    // Strings bloom in the bridge and the last A; a soft pad holds the first A.
    v(s.sym).forEach(m => strings(pad, c.at(s.bar, s.beat), s.beats * .96 * c.spb, mtof(m), s.bar < 8 ? .14 : bridge ? .3 : .22, 0, bridge ? .5 : .3));
  });
  // Drums: four on the floor, claps on 2 and 4, sixteenth hats with open offbeats; fills and crashes at the seams.
  for (let bar = 0; bar < 24; bar++) {
    for (let b = 0; b < 4; b++) { kick(drums, c.at(bar, b), b % 2 ? .62 : .72, { f0: 120, f1: 46, decay: .24, click: .12 }); mix.kickAt(c.at(bar, b)); }
    for (const b of [1, 3]) { clap(drums, c.at(bar, b), .5, .05); snare(drums, c.at(bar, b), .22, 0, { tone: 210, snappy: .6, decay: .1 }); }
    for (let k = 0; k < 16; k++) hat(drums, c.at(bar, k / 4), (k % 4 === 2 ? .3 : k % 2 ? .12 : .18) * (.85 + r() * .3), k % 2 ? .3 : -.2, k % 4 === 2 ? .12 : .03);
  }
  for (const bar of [7, 15, 23]) for (let k = 0; k < 8; k++) snare(drums, c.at(bar, 2 + k / 4), .2 + k * .06, (k % 2 ? .2 : -.2), { tone: 230, decay: .08 });
  crash(drums, c.at(8, 0), .45, -.3, 1.2); crash(drums, c.at(16, 0), .5, .3, 1.2); crash(drums, c.at(0, 0), .35, 0, 1);
  riser(fx, c.at(14, 0), 8 * c.spb, .5);
  // Portal zips: a theremin swooping down from the stratosphere into each section.
  for (const bar of [7, 15, 23]) theremin(fx, c.at(bar, 3), .9 * c.spb, mtof(57), .45, 0, mtof(93));
  // Bell sparkles every other bar in the A sections, alternating sides.
  for (const bar of [0, 2, 4, 6, 16, 18, 20]) mallet(sparkle, c.at(bar, 0), 1.5 * c.spb, mtof(86 + (bar % 4 ? 3 : 0)), .35, bar % 4 ? .5 : -.5, 'bell');
  // The voices: a bright pulse lead hard-ish left (YES), a singing theremin right (NO).
  const asks: Play = (t, d, f, vel) => lead(yes, t, d, f, vel * .9, -.55);
  const says: Play = (t, d, f, vel) => theremin(no, t, d, f, vel * 1.1, .55, f * (r() < .5 ? .94 : 1.06));
  phrase(c, 0, CALL, asks, r, { jitter: .006 }); phrase(c, 0, ANSWER, says, r, { jitter: .01, legato: 1 });
  phrase(c, 8, TUNE, asks, r, { jitter: .006, vel: .8 }); phrase(c, 8, THIRDS, says, r, { jitter: .01, legato: 1, vel: .85 });
  phrase(c, 16, TRADE_LEAD, asks, r, { jitter: .006 }); phrase(c, 16, TRADE_THEREMIN, says, r, { jitter: .01, legato: 1 });
  mix.add('bass', low, { gain: .68, duck: .35 });
  mix.add('drums', drums, { gain: 1, reverb: .1 });
  mix.add('arp', arp, { gain: 4.6, reverb: .2, echo: .35, duck: .3 });
  mix.add('pad', pad, { gain: 1.5, reverb: .5, duck: .45 });
  mix.add('lead', yes, { gain: 1.25, reverb: .25, echo: .2 });
  mix.add('theremin', no, { gain: .8, reverb: .45, echo: .15 });
  mix.add('sparkle', sparkle, { gain: 1.8, reverb: .5, echo: .3 });
  mix.add('fx', fx, { gain: .9, reverb: .5 });
  return mix.finish({ room: .82, damp: .35, echoTime: c.spb * .75, echoFb: .3, target: .13 });
} } satisfies Track;
