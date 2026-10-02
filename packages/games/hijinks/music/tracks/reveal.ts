/* Reveal bed: D-minor suspense. Swelling low strings, a pulsing synth eighth, heartbeat kick, timpani, and a high line that creeps upward to a snare-roll turnaround. */
import { Mix, bassNote, clock, hat, kick, mallet, midi, mtof, seedNoise, snare, synth, voicer } from '../synth';
import { crash, strings, timpani, type Track } from '../kit';

const PROG = ['Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A7b9', 'A7b9'];

export default { id: 'reveal', title: 'Envelope, Please', mood: 'Suspense bed for reveals', bpm: 90, bars: 16, lufs: -18, render() {
  seedNoise(606); const c = clock(90, .5, .5), mix = new Mix(16 * c.bar);
  const pad = mix.bus(), pulse = mix.bus(), drums = mix.bus(), hi = mix.bus(), twinkle = mix.bus();
  const prog = [...PROG, ...PROG], v = voicer(57, false);
  prog.forEach((ch, bar) => {
    const root = bassNote(ch), half = bar >= 8;
    if (bar % 2 === 0) { v(ch).forEach((m, k) => strings(pad, c.at(bar, 0), 2 * c.bar - .3, mtof(m), .32, k / 2 - .5, 1.2)); strings(pad, c.at(bar, 0), 2 * c.bar - .3, mtof(root), .38, 0, 1.2); timpani(drums, c.at(bar, 0), .7, mtof(root)); }
    for (let e = 0; e < 8; e++) synth(pulse, c.at(bar, e / 2), .3 * c.spb, mtof(root + (e === 6 ? 12 : 0)), e % 2 ? .45 : .7, 0, { wave: 'saw', voices: 2, detune: 10, cutoff: 380, env: half ? 1600 : 900, envDecay: .08, res: .3, a: .003, d: .12, s: .4, r: .05 });
    kick(drums, c.at(bar, 0), .5, { f0: 85, f1: 42, decay: .3, click: .02 }); kick(drums, c.at(bar, .375), .35, { f0: 85, f1: 42, decay: .25, click: .02 });
    for (let s = 0; s < 16; s += half ? 1 : 2) hat(drums, c.at(bar, s / 4), half && s % 4 ? .1 : half ? .22 : .12, .25, .02);
    if (!half && bar % 2) mallet(twinkle, c.at(bar, 2.5), .8, mtof([74, 77, 81, 76][(bar >> 1) % 4]), .3, .4, 'bell');
  });
  // The high line creeps up, then sits on the dominant's third so the loop resolves.
  for (const [bar, n, bars] of [[8, 'A5', 2], [10, 'D6', 2], [12, 'D6', 1], [13, 'Eb6', 1], [14, 'E6', 1], [15, 'C#6', 1]] as const)
    synth(hi, c.at(bar, 0), bars * c.bar - .1, mtof(midi(n)), .45, .2, { wave: 'saw', voices: 3, detune: 12, cutoff: 3000, a: .6, d: 1, s: .9, r: .4, vib: .006, vibRate: 7 });
  for (let k = 0; k < 16; k++) snare(drums, c.at(15, 2 + k / 8), .05 + k * .03, 0, { tone: 200, snappy: .9, decay: .08 });
  crash(drums, c.at(0, 0), .4, .3, 1.6);
  mix.add('strings', pad, { gain: 1.2, reverb: .4 });
  mix.add('pulse', pulse, { gain: 1.8, reverb: .1 });
  mix.add('drums', drums, { gain: .7, reverb: .15 });
  mix.add('high', hi, { gain: 1.6, reverb: .5 });
  mix.add('twinkle', twinkle, { gain: 1.6, reverb: .5, echo: .3 });
  return mix.finish({ room: .85, damp: .4, echoTime: c.spb * .75, echoFb: .35, target: .11 });
} } satisfies Track;
