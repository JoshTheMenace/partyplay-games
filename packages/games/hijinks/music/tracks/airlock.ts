/* Airlock: "Red Button Bossa". Space-age bachelor-pad lounge in D minor (A–B–A′) for a retro starship bridge: a gliding theremin
   tune over a bossa groove, a bouncing analog bass, a twinkling pulse-synth arpeggio like a busy console, random computer bleeps,
   a vibes bridge that lifts to F major, and a red-alert brass stab and riser that loop back to the top. */
import { Mix, bass, chord, clock, hat, kick, mallet, midi, mtof, rim, rng, seedNoise, shaker, synth, voicer } from '../synth';
import { brass, chordsOf, crash, phrase, riser, strings, theremin, walk, type Play, type Track } from '../kit';

const A = ['Dm9', 'Dm9', 'Bbmaj7', 'A7', 'Dm9', 'Gm9', 'Ebmaj7', 'A7#9'];
const B = ['Fmaj9', 'Ebmaj9', 'Dm9', 'Cm9', 'Bbmaj7', 'Gm9', 'Em7b5', 'A7b9'];
const TUNE = [
  'A4:1.5 D5:.5 F5:1 E5:1', 'D5:3 -:1', 'F5:1.5 A5:.5 C6:1 Bb5:1', 'A5:2 C#5:2',
  'D5:1 F5:1 A5:1.5 G5:.5', 'F5:1 E5:.5 D5:.5 Bb4:2', 'G5:1.5 Bb5:.5 D6:1 C6:1', 'C6:1 Bb5:.5 A5:.5 G5:1 -:1',
];
const BRIDGE = [
  'A5:.5 C6:.5 E6:1 -:.5 C6:.5 A5:1', 'G5:.5 Bb5:.5 D6:1 -:.5 Bb5:.5 G5:1', 'F5:.5 A5:.5 C6:1 -:.5 A5:.5 E5:1', 'Eb5:.5 G5:.5 Bb5:1 -:.5 G5:.5 D5:1',
  'D5:1 F5:1 A5:1 Bb5:1', 'A5:2 F5:1 D5:1', 'G5:1 Bb5:1 E5:1 D5:1', 'C#5:1 E5:1 G5:1 Bb5:1',
];
const OUT = [...TUNE.slice(0, 7), 'A5:1 G5:.5 F5:.5 E5:1 C#5:1'];
/** Bossa kick/rim pattern in beats. */
const KICK = [0, 1.5, 2, 3.5], RIM = [0, .75, 1.5, 2.5, 3.25];

export default { id: 'airlock', title: 'Red Button Bossa', mood: 'Retro space-age lounge with a theremin, a bossa beat and blinking consoles', bpm: 116, bars: 24, render() {
  seedNoise(2477); const r = rng(2477), c = clock(116, .56, .25), mix = new Mix(24 * c.bar);
  const low = mix.bus(), drums = mix.bus(), arp = mix.bus(), pad = mix.bus(), th = mix.bus(), vb = mix.bus(), bleep = mix.bus(), horns = mix.bus();
  const prog = [...A, ...B, ...A], spans = chordsOf(prog), v = voicer(60);
  spans.forEach((s, i) => {
    const { root, iv } = chord(s.sym), bridge = s.bar >= 8 && s.bar < 16, base = 38 + ((root - 2 + 12) % 12);
    // Bass: bossa root-fifth bounce in A, a walking line through the bridge.
    if (!bridge) for (const [at, m, d] of [[0, base, 1.3], [1.5, base + 7, .45], [2, base + 7, 1], [3.5, base + 12, .4]] as const) bass(low, c.at(s.bar, at), d * c.spb, mtof(m), at ? .78 : .95, { drive: 1.4, bright: .45 });
    else walk(s.sym, spans[(i + 1) % spans.length]!.sym, s.beats, r).forEach((m, k) => bass(low, c.at(s.bar, s.beat + k), .85 * c.spb, mtof(m), k ? .78 : .92, { drive: 1.3, bright: .35 }));
    // Pads: soft strings hold the voicing; the console arpeggio ripples chord tones in sixteenths (A sections only).
    const notes = v(s.sym);
    notes.forEach((m, k) => strings(pad, c.at(s.bar, 0) + k * .01, c.bar * .97, mtof(m), bridge ? .26 : .2, k / 2 - .6, .5));
    if (!bridge) for (let e = 0; e < 16; e++) {
      const m = 64 + ((root + 8) % 12) + iv[[0, 1, 2, 3, 2, 1][e % 6]! % iv.length]!;
      synth(arp, c.at(s.bar, e / 4), .11, mtof(m), e % 4 ? .32 : .45, e % 2 ? .45 : -.45, { wave: 'pulse', pw: .25, cutoff: 1800, env: 2400, envDecay: .05, a: .002, d: .08, s: .3, r: .04 });
    }
    if (bridge) notes.forEach((m, k) => mallet(vb, c.at(s.bar, 1.5) + k * .008, 1.4 * c.spb, mtof(m + 12), .2, .3, 'vibes'));
  });
  // Drums: bossa kick and cross-stick, swung hats, a soft shaker bed; crashes at each section.
  for (let bar = 0; bar < 24; bar++) {
    for (const b of KICK) kick(drums, c.at(bar, b), b ? .5 : .7, { f0: 110, f1: 45, decay: .24, click: .08 });
    for (const b of RIM) rim(drums, c.at(bar, b), .32 * (.85 + r() * .3), -.2);
    for (let e = 0; e < 8; e++) hat(drums, c.at(bar, e / 2), e % 2 ? .16 : .26, .3, .03);
    for (let e = 0; e < 16; e++) shaker(drums, c.at(bar, e / 4), e % 4 ? .08 : .14, -.35);
  }
  crash(drums, c.at(8, 0), .4, .3, 1); crash(drums, c.at(16, 0), .45, -.3, 1);
  // Computer bleeps: seeded high blips on chord tones, twice a bar, off the beat.
  for (let bar = 0; bar < 24; bar++) for (let k = 0; k < 2; k++) {
    const { root, iv } = chord(prog[bar]!), at = [.75, 1.75, 2.25, 3.25][Math.floor(r() * 4)]! + k * .01;
    mallet(bleep, c.at(bar, at), .12, mtof(84 + root + iv[Math.floor(r() * 3)]!), .22 + r() * .1, r() * 1.4 - .7, 'bell');
  }
  // Melody: theremin glides through A; vibes carry the bridge with a soft theremin echo; A′ doubles the theremin with a pulse lead.
  let from = 0;
  const glide: Play = (t, d, f, vel) => { theremin(th, t, d, f, vel * .95, -.1, from || f); from = f; };
  phrase(c, 0, TUNE, glide, r, { jitter: .008, legato: .97 });
  phrase(c, 8, BRIDGE, (t, d, f, vel) => mallet(vb, t, Math.min(d, .6), f, vel * .95, -.15, 'vibes'), r, { jitter: .005 });
  from = 0; phrase(c, 16, OUT, glide, r, { jitter: .008, legato: .97 });
  phrase(c, 16, OUT, (t, d, f, vel) => synth(vb, t, d, f / 2, vel * .35, .25, { wave: 'pulse', pw: .4, voices: 2, detune: 8, cutoff: 1600, a: .01, d: .2, s: .6, r: .1 }), r, { jitter: .01 });
  // Red alert: a brass stab and a riser at the end of A′ that lands back on bar 0.
  ['D4', 'F4', 'A4', 'C5', 'E5'].forEach((n, k) => brass(horns, c.at(15, 3) + k * .006, .45 * c.spb, mtof(midi(n)), .4, k / 4 - .5));
  ['A3', 'C#4', 'G4', 'C5'].forEach((n, k) => { brass(horns, c.at(23, 2) + k * .006, .4 * c.spb, mtof(midi(n)), .45, k / 3 - .5); brass(horns, c.at(23, 3) + k * .006, .7 * c.spb, mtof(midi(n)), .5, k / 3 - .5); });
  riser(drums, c.at(22, 2), c.bar * 1.5, .35);
  mix.add('bass', low, { gain: .75 });
  mix.add('drums', drums, { gain: 1, reverb: .1 });
  mix.add('arp', arp, { gain: 1.55, reverb: .25, echo: .25 });
  mix.add('pads', pad, { gain: 1.6, reverb: .45 });
  mix.add('theremin', th, { gain: 1.1, reverb: .4, echo: .2 });
  mix.add('vibes', vb, { gain: 1.1, reverb: .35, echo: .1 });
  mix.add('bleeps', bleep, { gain: 1.35, reverb: .4, echo: .3 });
  mix.add('horns', horns, { gain: 2.8, reverb: .3 });
  return mix.finish({ room: .84, damp: .4, echoTime: c.spb * .75, echoFb: .3, target: .12 });
} } satisfies Track;
