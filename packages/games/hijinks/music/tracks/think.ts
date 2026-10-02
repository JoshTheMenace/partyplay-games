/* Think bed: a soft F-major Rhodes groove for writing time. Sparse vibes motifs, round bass, brushed lo-fi beat; stays out of the way. */
import { Mix, autopan, bass, bassNote, brush, clock, ep, kick, mallet, mtof, rim, rng, seedNoise, shaker, voicer } from '../synth';
import { phrase, type Play, type Track } from '../kit';

const P = ['Fmaj9', 'Am7', 'Bbmaj9', 'C9sus4'], Q = ['Dm9', 'Am7', 'Gm9', 'C9sus4'];
const MP = ['A5:1.5 G5:.5 E5:2', '-:4', 'D6:1 C6:.5 A5:.5 F5:2', '-:2 G5:.5 A5:.5 Bb5:1'], MQ = ['F5:1.5 E5:.5 A5:2', '-:4', 'Bb5:1 A5:.5 F5:.5 D5:2', '-:2 C6:.5 Bb5:.5 G5:1'];

export default { id: 'think', title: 'Scribble Time', mood: 'Light Rhodes bed for writing and drawing', bpm: 92, bars: 24, lufs: -19, render() {
  seedNoise(303); const r = rng(303), c = clock(92, .56, .25), mix = new Mix(24 * c.bar);
  const keys = mix.bus(), low = mix.bus(), drums = mix.bus(), mel = mix.bus(), arp = mix.bus();
  const prog = [...P, ...P, ...Q, ...P, ...Q, ...P], v = voicer(62);
  prog.forEach((ch, bar) => {
    const root = bassNote(ch), notes = v(ch);
    notes.forEach((m, k) => { ep(keys, c.at(bar, 0) + k * .008, 1.4 * c.spb, mtof(m), .34, k / 3 - .5); ep(keys, c.at(bar, 2.5) + k * .008, 1.2 * c.spb, mtof(m), .26, k / 3 - .5); });
    bass(low, c.at(bar, 0), 2.2 * c.spb, mtof(root), .75, { drive: 1.1, bright: .1 }); bass(low, c.at(bar, 2.5), 1.2 * c.spb, mtof(root + (bar % 2 ? 12 : 7)), .6, { drive: 1.1, bright: .1 });
    const sec = Math.floor(bar / 4);
    if (sec !== 2) { kick(drums, c.at(bar, 0), .45, { f0: 95, f1: 48, decay: .25, click: .05 }); kick(drums, c.at(bar, 2.5), .32, { f0: 95, f1: 48, decay: .25, click: .05 }); }
    for (const b of [1, 3]) { rim(drums, c.at(bar, b), .28, .15); brush(drums, c.at(bar, b), .2, -.1, .1); }
    for (let s = 0; s < 8; s++) shaker(drums, c.at(bar, s / 2), s % 2 ? .12 : .2, .3);
    // Marimba ripples in the busier sections.
    if (sec === 1 || sec >= 4) [0, .75, 1.5, 3].forEach((b, k) => mallet(arp, c.at(bar, b), .4, mtof(notes[k % notes.length] + 12), .22, .4 - k * .2, 'marimba'));
  });
  const vibes: Play = (t, d, f, vel) => mallet(mel, t, d, f, vel * .6, -.2, 'vibes'), bell: Play = (t, d, f, vel) => mallet(mel, t, d, f, vel * .4, .2, 'bell');
  phrase(c, 4, MP, vibes, r, { jitter: .015 }); phrase(c, 8, MQ, vibes, r, { jitter: .015 });
  phrase(c, 16, MQ, bell, r, { jitter: .01 }); phrase(c, 20, MP, vibes, r, { jitter: .015 });
  mix.add('rhodes', autopan(keys, 1 / (2 * c.spb), .2), { gain: 1, reverb: .3 });
  mix.add('bass', low, { gain: .45 });
  mix.add('drums', drums, { gain: .9, reverb: .1 });
  mix.add('motifs', mel, { gain: 1.1, reverb: .45, echo: .2 });
  mix.add('marimba', arp, { gain: 1.8, reverb: .3 });
  return mix.finish({ lofi: 8500, room: .8, damp: .5, echoTime: c.spb * .75, echoFb: .3, target: .1 });
} } satisfies Track;
