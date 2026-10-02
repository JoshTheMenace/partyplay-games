/* Spooky: a swinging E-minor creep. Tiptoe pizzicato boogie, wobbly organ, xylophone "bones", a gliding theremin tune and a cold wind. */
import { Mix, TAU, SR, biquad, chord, clock, kick, mallet, midi, mtof, pluck, rim, rng, seedNoise, shaker, white, woodblock, type Bus } from '../synth';
import { organ, phrase, theremin, type Play, type Track } from '../kit';

const A = ['Em', 'Em', 'Am', 'Em', 'C7', 'B7', 'Em', 'B7'];
const TUNE = ['B4:1.5 E5:.5 G5:1 F#5:1', 'E5:3 -:1', 'C5:1.5 E5:.5 A5:1 G5:1', 'B4:3 -:1', 'E5:1 G5:1 Bb5:1.5 A5:.5', 'A5:1 F#5:1 D#5:2', 'E5:1 G5:.5 B5:.5 E6:2', 'D#6:1.5 C6:.5 B5:2'];
const BONES = 'B5:.25 Bb5:.25 A5:.25 G#5:.25 G5:.5 E5:.5';

export default { id: 'spooky', title: 'Creepy Crawl', mood: 'Eerie but fun swing for horror trivia', bpm: 112, bars: 24, lufs: -17, render() {
  seedNoise(909); const r = rng(909), c = clock(112, .63, .5), mix = new Mix(24 * c.bar);
  const low = mix.bus(), org = mix.bus(), xy = mix.bus(), th = mix.bus(), drums = mix.bus(), air = mix.bus();
  const prog = [...A, ...A, ...A];
  prog.forEach((ch, bar) => {
    const { root, iv } = chord(ch), base = 40 + ((root - 4 + 12) % 12);
    // Creeping quarter-note boogie: root, third, fifth, then a chromatic sixth.
    [base, base + iv[1], base + iv[2], base + iv[2] + 1].forEach((m, b) => pluck(low, c.at(bar, b), .55 * c.spb, mtof(m), b ? .8 : .95, 0, { bright: .35, decay: .9, body: 120 }));
    const top = 64 + ((root - 4 + 12) % 12);
    for (const b of [1, 3]) iv.slice(0, 3).map(i => top + i).forEach((m, k) => organ(org, c.at(bar, b) + k * .004, .45 * c.spb, mtof(m), .5, k / 2 - .5, [0, 1, 0, .8, 0, .4]));
    kick(drums, c.at(bar, 0), .5, { f0: 90, decay: .22, click: .05 }); kick(drums, c.at(bar, 2), .4, { f0: 90, decay: .22, click: .05 });
    for (const b of [1, 3]) { rim(drums, c.at(bar, b), .4, .25); woodblock(drums, c.at(bar, b + .5), .18, -.35, 700); }
    for (let e = 0; e < 8; e++) shaker(drums, c.at(bar, e / 2), e % 2 ? .12 : .22, .3);
    if (bar % 4 === 3) phrase(c, bar, [`-:2 ${BONES}`], (t, d, f, vel) => mallet(xy, t, Math.min(d, .25), f, vel * .7, .35, 'marimba'), r, { jitter: .004 });
  });
  // Theremin: each note glides in from the last.
  let from = 0;
  const glide: Play = (t, d, f, vel) => { theremin(th, t, d, f, vel, -.15, from || f); from = f; };
  phrase(c, 8, TUNE, glide, r, { jitter: .01, legato: .98 }); from = 0; phrase(c, 16, TUNE, glide, r, { jitter: .01, legato: .98 });
  phrase(c, 16, TUNE, (t, d, f, vel) => mallet(xy, t, Math.min(d, .3), f * 2, vel * .35, .3, 'bell'), r, { jitter: .004 });
  wind(air, 24 * c.bar, c.bar * 4);
  mallet(xy, c.at(0, 0), 2, mtof(midi('E7')), .3, .5, 'bell'); mallet(xy, c.at(0, .02), 2, mtof(midi('Bb6')), .2, -.5, 'bell');
  mix.add('bass', low, { gain: 1.7 });
  mix.add('organ', org, { gain: 1.6, reverb: .3 });
  mix.add('xylophone', xy, { gain: 1, reverb: .3, echo: .15 });
  mix.add('theremin', th, { gain: .6, reverb: .45, echo: .2 });
  mix.add('drums', drums, { gain: 1, reverb: .15 });
  mix.add('wind', air, { gain: 1, reverb: .3 });
  return mix.finish({ room: .88, damp: .35, echoTime: c.spb * .75, echoFb: .35, target: .12 });
} } satisfies Track;

/** A howling wind: band-passed noise whose swell period divides the loop, so the seam is invisible. */
function wind(b: Bus, seconds: number, period: number) {
  const n = Math.round(seconds * SR), l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) { l[i] = white(); r[i] = white(); }
  biquad(l, 'bp', 600, 3); biquad(r, 'bp', 750, 3);
  for (let i = 0; i < n; i++) { const p = TAU * i / SR / period, g = .15 + .85 * Math.max(0, Math.sin(p)) ** 3; b.l[i] += l[i] * g * .5; b.r[i] += r[i] * (.15 + .85 * Math.max(0, Math.sin(p + 2)) ** 3) * .5; }
}
