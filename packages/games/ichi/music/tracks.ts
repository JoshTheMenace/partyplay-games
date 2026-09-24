import { Mix, autopan, bass, bassNote, brush, chipNoise, chorus, clap, clock, ep, filterBus, flute, hat, kick, mallet, midi, mtof, pluck, rim, ride, rng, seedNoise, seq, shaker, shime, snare, synth, taiko, vinyl, voicer, woodblock, type Bus } from './synth';

export type Track = { id: string; title: string; mood: string; bpm: number; render(): Bus };
type Clock = ReturnType<typeof clock>;
/** Places a seq() melody starting at a bar; jitter humanizes timing (seconds). */
function melody(c: Clock, bar: number, s: string, play: (t: number, d: number, f: number, v: number) => void, o: { vel?: number; jitter?: number; transpose?: number; r?: () => number } = {}) {
  const r = o.r ?? Math.random;
  for (const n of seq(s)) if (n.m !== null) {
    const t = c.at(bar, n.at) + ((r() - 0.5) * (o.jitter ?? 0.01)), d = c.at(bar, n.at + n.d) - c.at(bar, n.at);
    play(t, d * 0.95, mtof(n.m + (o.transpose ?? 0)), (o.vel ?? 0.8) * (n.acc ? 1.15 : 0.9 + r() * 0.15));
  }
}

/** 1. Lo-fi hip-hop with Rhodes, koto and a wooden flute: calm, cosy table talk. */
const lanternLounge: Track = { id: 'lantern-lounge', title: 'Lantern Lounge', mood: 'Chill lo-fi beats with Rhodes, koto and flute', bpm: 78, render() {
  seedNoise(11); const r = rng(11), c = clock(78, 0.57, 0.25), bars = 32, mix = new Mix(bars * c.bar);
  const keys = mix.bus(), low = mix.bus(), drums = mix.bus(), koto = mix.bus(), fl = mix.bus(), vin = mix.bus();
  const A = ['Bbmaj9', 'Am9', 'Gm9', 'C13'], B = ['Dm9', 'Bbmaj7', 'Gm9', 'A7#9'], v = voicer(62);
  const prog = [...A, ...A, ...A, ...B, ...B, ...A, ...A, ...A];
  prog.forEach((ch, bar) => {
    const notes = v(ch), intro = bar < 4, soft = intro ? 0.55 : 0.7;
    for (const [beat, d, vel] of [[0, 1.6, 1], [1.75, 0.6, 0.55], [2.5, 1.4, 0.8]] as const) notes.forEach((m, k) => ep(keys, c.at(bar, beat) + k * 0.006 + r() * 0.01, d * c.spb, mtof(m), soft * vel * (0.85 + r() * 0.2), (k / notes.length - 0.5) * 0.5));
    if (intro) return;
    const root = bassNote(ch, 1), next = bassNote(prog[(bar + 1) % prog.length], 1);
    bass(low, c.at(bar, 0), 1.4 * c.spb, mtof(root), 0.9);
    bass(low, c.at(bar, 2.5), 0.45 * c.spb, mtof(root + 12), 0.55);
    bass(low, c.at(bar, 3.5), 0.4 * c.spb, mtof(next + (next > root ? -1 : 1)), 0.6);
    const breakdown = bar >= 28;
    if (!breakdown) { for (const [b, vel] of [[0, 1], [0.75, 0.45], [2.5, 0.8]] as const) { kick(drums, c.at(bar, b), vel, { f0: 120, decay: 0.28 }); mix.kickAt(c.at(bar, b)); } }
    if (!breakdown) for (const b of [1, 3]) snare(drums, c.at(bar, b) + 0.018, 0.75, 0.05, { tone: 170, decay: 0.16 });
    for (let s = 0; s < 8; s++) hat(drums, c.at(bar, s * 0.5), (s % 2 ? 0.35 : 0.55) * (0.8 + r() * 0.3), 0.25);
    if (bar % 2) hat(drums, c.at(bar, 3.75), 0.3, 0.25);
    if (bar % 4 === 3) rim(drums, c.at(bar, 3.5), 0.5, -0.2);
  });
  const kotoPlay = (t: number, d: number, f: number, vel: number) => pluck(koto, t, d, f, vel, 0.25, { bright: 0.75, decay: 1.4, pick: 0.11, body: 900 });
  melody(c, 12, '-:.5 A5:.5 C6:.5 D6:1 C6:.5 A5:1 G5:.75 A5:.25 F5:1 D5:1 -:1 -:.5 D5:.5 F5:.5 G5:.5 A5:1 C6:.5 A5:.5 G5:1.5 F5:.5 E5:1 C#5:1', kotoPlay, { r });
  melody(c, 16, 'D6:.5 C6:.5 A5:.5 C6:.5 D6:1.5 F6:.5 E6:1 D6:.5 C6:.5 A5:2 -:1 G5:.5 A5:.5 Bb5:.5 A5:.5 G5:.5 F5:.5 E5:1.5 G5:.5 C#6:1 A5:1', kotoPlay, { r });
  const flutePlay = (t: number, d: number, f: number, vel: number) => flute(fl, t, d, f, vel * 0.9, -0.2, { breath: 0.14 });
  melody(c, 20, 'D5:1.5 C5:.5 A4:2 -:.5 G4:.5 A4:.5 C5:.5 E5:2 D5:1 F5:1 A5:1.5 G5:.5 F5:2 E5:1 -:1 D5:.5 F5:.5 A5:1 C6:1.5 A5:.5 G5:2 E5:1 D5:1 F5:1.5 G5:.5 A5:.5 G5:.5 F5:.5 D5:.5 E5:3 -:1', flutePlay, { r });
  for (const bar of [21, 23, 25, 27]) melody(c, bar, '-:3 C6:.25 A5:.25 F5:.25 D5:.25', kotoPlay, { vel: 0.5, r });
  vinyl(vin, 1, r);
  autopan(keys, 3.2, 0.22); chorus(keys, 0.002, 0.3, 0.3);
  mix.add('keys', keys, { gain: 0.75, reverb: 0.25, duck: 0.25 });
  mix.add('bass', low, { gain: 1.1, duck: 0.35 });
  mix.add('drums', filterBus(drums, 'lp', 6500), { gain: 0.9, reverb: 0.05 });
  mix.add('koto', koto, { gain: 2.6, reverb: 0.35, echo: 0.3 });
  mix.add('flute', fl, { gain: 1.1, reverb: 0.4, echo: 0.2 });
  mix.add('vinyl', vin, { gain: 0.8 });
  return mix.finish({ room: 0.8, damp: 0.5, echoTime: c.spb * 0.75, echoFb: 0.35, lofi: 9000, target: 0.13 });
} };

/** 2. City-pop funk: slap-ish synth bass, EP stabs, bright lead. Upbeat and confident. */
const hanafudaFunk: Track = { id: 'hanafuda-funk', title: 'Hanafuda Funk', mood: 'Upbeat city-pop funk, groovy bass and bright synths', bpm: 110, render() {
  seedNoise(22); const r = rng(22), c = clock(110, 0.53, 0.25), bars = 40, mix = new Mix(bars * c.bar);
  const keys = mix.bus(), pad = mix.bus(), low = mix.bus(), drums = mix.bus(), lead = mix.bus();
  const A = [['Cmaj7'], ['B7'], ['Em9'], ['Dm9', 'G13']], B = [['Am9'], ['D9'], ['Gmaj7'], ['Cmaj7'], ['F#m7b5'], ['B7#9'], ['Em9'], ['E9']];
  const prog = [...A, ...A, ...A, ...B, ...A, ...A, ...B, ...A, ...A].slice(0, bars);
  const vk = voicer(64), vp = voicer(60, false);
  prog.forEach((chs, bar) => {
    const intro = bar < 4, outro = bar >= 36, half = chs.length > 1 ? 2 : 4;
    chs.forEach((ch, k) => {
      const at = k * half, notes = vk(ch), root = bassNote(ch, 1);
      const stabs = half === 4 ? [[0, 0.7], [1.5, 0.4], [2.5, 0.25], [3, 0.5]] : [[0, 0.7], [1.5, 0.4]];
      for (const [b, d] of stabs) notes.forEach((m, i) => ep(keys, c.at(bar, at + b) + i * 0.004, d * c.spb, mtof(m), 0.6 + r() * 0.15, (i / notes.length - 0.5) * 0.6));
      if (!intro) for (const m of vp(ch)) synth(pad, c.at(bar, at), half * c.spb * 0.98, mtof(m), 0.35, 0, { wave: 'saw', voices: 3, detune: 14, cutoff: 1400, a: 0.25, d: 1, s: 0.8, r: 0.4 });
      if (intro) return;
      const line = half === 4 ? [[0, 0, 0.5], [0.75, 12, 0.25], [1.5, 0, 0.25], [2, 7, 0.5], [2.75, 0, 0.25], [3.25, 10, 0.25], [3.5, 12, 0.25]] : [[0, 0, 0.5], [0.75, 12, 0.25], [1.5, 7, 0.4]];
      for (const [b, iv, d] of line) {
        const t = c.at(bar, at + b), f = mtof(root + iv);
        bass(low, t, d * c.spb, f, iv === 12 ? 0.75 : 0.95, { drive: 2.2, bright: 0.5 });
        synth(low, t, d * c.spb, f, 0.5, 0, { wave: 'saw', cutoff: 250, env: 2200, envDecay: 0.07, res: 0.35, a: 0.002, d: 0.15, s: 0.4, r: 0.05 });
      }
    });
    if (intro || outro) { for (let s = 0; s < 8; s++) hat(drums, c.at(bar, s * 0.5), 0.35, 0.3); if (outro) { kick(drums, c.at(bar, 0), 0.8); mix.kickAt(c.at(bar, 0)); } return; }
    for (const b of [0, 1.5, 2.5]) { kick(drums, c.at(bar, b), b ? 0.85 : 1, { f0: 140, decay: 0.26 }); mix.kickAt(c.at(bar, b)); }
    if (bar % 2) kick(drums, c.at(bar, 3.75), 0.5);
    for (const b of [1, 3]) { snare(drums, c.at(bar, b), 0.7, 0, { tone: 200 }); clap(drums, c.at(bar, b) + 0.004, 0.55, 0.1); }
    for (let s = 0; s < 16; s++) if (s % 8 !== 7) hat(drums, c.at(bar, s * 0.25), (s % 2 ? 0.16 : s % 4 ? 0.28 : 0.38) * (0.85 + r() * 0.3), 0.3);
    hat(drums, c.at(bar, 3.5), 0.4, 0.3, 0.22);
    if (bar >= 12 && bar < 20 || bar >= 28 && bar < 36) for (let s = 0; s < 16; s++) shaker(drums, c.at(bar, s * 0.25), s % 2 ? 0.25 : 0.4, -0.35);
  });
  const leadPlay = (oct: number) => (t: number, d: number, f: number, vel: number) => synth(lead, t, d, f * oct, vel * 0.75, 0.1, { wave: 'pulse', pw: 0.3, voices: 2, detune: 8, cutoff: 1800, env: 3500, envDecay: 0.18, res: 0.2, a: 0.004, d: 0.3, s: 0.6, r: 0.12, vib: 0.004 });
  const chorusLine = 'E5:.5 G5:.5 A5:.5 B5:1 A5:.5 G5:.5 E5:.5 F#5:1.5 E5:.5 D5:.5 E5:1.5 -:.5 B4:.5 D5:.5 F#5:.5 A5:1 G5:.5 F#5:.5 E5:2 G5:1 B5:1 A5:.75 C6:.75 A5:.5 G5:.5 E5:1.5 D#5:1 F#5:.5 A5:.5 D6:1 C6:.5 B5:.5 B5:1.5 A5:.5 G5:.5 F#5:.5 G5:1 G#5:2 -:2';
  const verseLine = 'G5:.5 E5:.5 B4:.5 C5:.5 D5:1 E5:1 D#5:1.5 F#5:.5 A5:1 F#5:1 G5:.5 F#5:.5 E5:.5 D5:.5 B4:2 F5:1 E5:1 D5:.5 E5:.5 B4:1';
  melody(c, 12, chorusLine, leadPlay(1), { r });
  melody(c, 20, verseLine, leadPlay(1), { r, vel: 0.7 }); melody(c, 24, verseLine.replace(/D5:\.5 E5:\.5 B4:1$/, 'G5:.5 E5:.5 D5:1'), leadPlay(1), { r, vel: 0.75 });
  melody(c, 28, chorusLine, leadPlay(2), { r, vel: 0.7 }); melody(c, 28, chorusLine, leadPlay(1), { r, vel: 0.55 });
  autopan(keys, 4, 0.15); chorus(pad, 0.004, 0.25, 0.5);
  mix.add('keys', filterBus(keys, 'hp', 180), { gain: 0.6, reverb: 0.2 });
  mix.add('pad', pad, { gain: 0.55, reverb: 0.4, duck: 0.5 });
  mix.add('bass', low, { gain: 1.0, duck: 0.3 });
  mix.add('drums', drums, { gain: 0.95, reverb: 0.08 });
  mix.add('lead', lead, { gain: 1.5, reverb: 0.25, echo: 0.3 });
  return mix.finish({ room: 0.78, damp: 0.35, echoTime: c.spb * 0.75, echoFb: 0.3, target: 0.15 });
} };

/** 3. Summer festival: taiko, shime, chanchiki bell, shamisen riffs and a shinobue flute. Festive. */
const matsuriNights: Track = { id: 'matsuri-nights', title: 'Matsuri Nights', mood: 'Festive Japanese summer festival: taiko, shamisen and flute', bpm: 124, render() {
  seedNoise(33); const r = rng(33), c = clock(124, 0.5, 0.5), bars = 40, mix = new Mix(bars * c.bar);
  const drums = mix.bus(), sham = mix.bus(), fl = mix.bus(), low = mix.bus(), koto = mix.bus(), bell = mix.bus();
  const A = ['D', 'Bm', 'G', 'A'], B = ['G', 'A', 'Bm', 'D'], prog = [...A, ...A, ...A, ...A, ...B, ...A, ...A, ...B, ...A, ...A];
  const riff: Record<string, string> = { D: 'D4 A4 D5 A4 B4 A4 F#4 E4', Bm: 'B3 F#4 B4 F#4 A4 F#4 D4 E4', G: 'G3 D4 G4 D4 E4 D4 B3 A3', A: 'A3 E4 A4 E4 F#4 E4 D4 B3' };
  prog.forEach((ch, bar) => {
    const intro = bar < 4, calm = bar >= 32 && bar < 36;
    if (intro) { for (const [b, v] of [[0, 1], [1, 0.7], [2, 1], [3, 0.6], [3.5, 0.7]] as const) taiko(drums, c.at(bar, b), v * (0.6 + bar * 0.1)); if (bar === 3) for (let s = 0; s < 8; s++) shime(drums, c.at(bar, 2 + s * 0.25), 0.4 + s * 0.06); return; }
    for (const [b, v] of [[0, 1], [1.5, 0.6], [2, 0.9], [3, 0.6], [3.5, 0.5]] as const) if (!calm || b === 0) { taiko(drums, c.at(bar, b), v); mix.kickAt(c.at(bar, b)); }
    for (const b of [2.5, 3.75]) if (!calm) woodblock(drums, c.at(bar, b), 0.45, 0.3, 1250);
    for (let s = 0; s < 8; s++) shime(drums, c.at(bar, s * 0.5), (s % 2 ? 0.35 : 0.5) * (0.85 + r() * 0.3), -0.3);
    for (const b of [0.5, 1.5, 2.5, 3.25, 3.5]) mallet(bell, c.at(bar, b), 0.1, 1480, b === 3.25 ? 0.35 : 0.5, 0.4, 'kane');
    bass(low, c.at(bar, 0), 1.8 * c.spb, mtof(bassNote(ch, 1)), 0.8); bass(low, c.at(bar, 2), 1.8 * c.spb, mtof(bassNote(ch, 1) + 7), 0.6);
    if (!calm) riff[ch].split(' ').forEach((n, k) => pluck(sham, c.at(bar, k * 0.5), 0.35 * c.spb, mtof(midi(n)), k % 2 ? 0.7 : 0.9, -0.15, { bright: 0.95, decay: 0.6, pick: 0.06, body: 2600 }));
    if (bar >= 20 && bar < 28 || bar >= 36) { const root = bassNote(ch, 4), third = ch.endsWith('m') ? 3 : 4; [0, third, 7, 12, 7 + 12, 12 + third, 12, 7].forEach((iv, k) => pluck(koto, c.at(bar, k * 0.5 + 0.25), 0.4 * c.spb, mtof(root + iv), 0.45, 0.35, { bright: 0.7, decay: 1.2, pick: 0.12 })); }
  });
  const fluteLine = 'A5:1 B5:.5 A5:.5 F#5:1 E5:1 D5:1.5 E5:.5 F#5:1 A5:1 B5:1 D6:1 B5:.5 A5:.5 F#5:1 E5:3 -:1 F#5:.5 A5:.5 B5:1 D6:1 E6:1 D6:1 B5:.5 A5:.5 F#5:2 E5:1 F#5:1 A5:1 E5:1 D5:3 -:1';
  const fp = (t: number, d: number, f: number, vel: number) => flute(fl, t, d, f, vel, 0.1, { breath: 0.1, vib: 0.008 });
  melody(c, 12, fluteLine, fp, { r, vel: 0.75 });
  melody(c, 24, fluteLine, fp, { r, transpose: 12, vel: 0.6 });
  melody(c, 32, 'A5:2 F#5:2 B5:2 A5:2 D6:3 B5:1 A5:4', fp, { r, vel: 0.6 });
  mix.add('drums', drums, { gain: 0.6, reverb: 0.2 });
  mix.add('bell', filterBus(bell, 'hp', 800), { gain: 0.35, reverb: 0.2 });
  mix.add('bass', low, { gain: 0.7, duck: 0.3 });
  mix.add('shamisen', sham, { gain: 1.05, reverb: 0.15 });
  mix.add('koto', koto, { gain: 1.3, reverb: 0.3, echo: 0.25 });
  mix.add('flute', fl, { gain: 1.0, reverb: 0.35, echo: 0.15 });
  return mix.finish({ room: 0.8, damp: 0.3, echoTime: c.spb * 0.75, echoFb: 0.25, target: 0.15 });
} };

/** 4. Late-night jazz trio: walking bass, brushes and ride, Rhodes comping, vibraphone head. Classy. */
const teaHouseSwing: Track = { id: 'tea-house-swing', title: 'Tea House Swing', mood: 'Late-night jazz trio: walking bass, brushes, vibraphone', bpm: 132, render() {
  seedNoise(44); const r = rng(44), c = clock(132, 0.64, 0.5), bars = 64, mix = new Mix(bars * c.bar);
  const keys = mix.bus(), low = mix.bus(), drums = mix.bus(), vib = mix.bus();
  const A1 = [['Bbmaj7', 'G7'], ['Cm7', 'F7'], ['Dm7', 'G7'], ['Cm7', 'F7'], ['Fm7', 'Bb7'], ['Ebmaj7', 'Ab7'], ['Dm7', 'G7'], ['Cm7', 'F7']];
  const A2 = [...A1.slice(0, 7), ['Bb6']], Br = [['D7'], ['D7'], ['G7'], ['G7'], ['C7'], ['C7'], ['F7'], ['F7']];
  const form = [...A1, ...A2, ...Br, ...A1], prog = [...form, ...form];
  const segs = prog.flatMap((chs, bar) => chs.map((ch, k) => ({ ch, bar, at: k * (4 / chs.length), len: 4 / chs.length })));
  const v = voicer(60);
  let bassPrev = midi('Bb1');
  const near = (n: number, not = -1) => { const ok = [n - 24, n - 12, n, n + 12].filter(m => m >= midi('A1') && m <= midi('D3')), pool = ok.filter(m => m !== not); return (pool.length ? pool : ok).reduce((a, m) => Math.abs(m - bassPrev) < Math.abs(a - bassPrev) ? m : a); };
  segs.forEach((s, i) => {
    const root = bassNote(s.ch, 2), next = bassNote(segs[(i + 1) % segs.length].ch, 2), third = /m/.test(s.ch.replace('maj', '')) ? 3 : 4;
    const tones = [third, 7, s.ch.includes('maj') ? 11 : s.ch.endsWith('6') ? 9 : 10];
    for (let b = 0; b < s.len; b++) {
      // Root on the downbeat, chord tones in between, a chromatic step into the next chord.
      const m = b === 0 ? near(root) : b === s.len - 1 ? near(next) + (r() < 0.5 ? 1 : -1) : near(root + tones[Math.floor(r() * tones.length)], bassPrev);
      pluck(low, c.at(s.bar, s.at + b), c.spb * 0.9, mtof(m), 0.9 + r() * 0.1, 0, { bright: 0.25, decay: 1.1, pick: 0.2, body: 110 });
      bass(low, c.at(s.bar, s.at + b), c.spb * 0.8, mtof(m), 0.35, { drive: 1.2, bright: 0 });
      bassPrev = m;
    }
    const notes = v(s.ch), hits = s.len === 4 ? (r() < 0.6 ? [[0, 0.9], [1.5, 0.45]] : [[-0.5, 1.2], [2.5, 0.45]]) : r() < 0.5 ? [[0, 0.9]] : [[-0.5, 1]];
    for (const [b, d] of hits) notes.forEach((n, k) => ep(keys, c.at(s.bar, s.at + b) + k * 0.007, d * c.spb, mtof(n), 0.5 + r() * 0.15, (k / notes.length - 0.5) * 0.4));
  });
  for (let bar = 0; bar < bars; bar++) {
    for (const [b, vel] of [[0, 0.7], [1, 0.8], [1.5, 0.45], [2, 0.7], [3, 0.8], [3.5, 0.45]] as const) ride(drums, c.at(bar, b), vel * (0.85 + r() * 0.25));
    for (const b of [1, 3]) hat(drums, c.at(bar, b), 0.35, -0.3, 0.05);
    for (let b = 0; b < 4; b++) { brush(drums, c.at(bar, b), 0.22 + r() * 0.08, -0.15, c.spb * 0.9); kick(drums, c.at(bar, b), 0.18, { f0: 90, decay: 0.2, click: 0 }); }
    if (r() < 0.35) snare(drums, c.at(bar, 3.5), 0.25, -0.1, { snappy: 0.5, decay: 0.08 });
    if (bar % 8 === 7) for (const b of [2.5, 3, 3.5]) snare(drums, c.at(bar, b), 0.35, -0.1, { snappy: 0.6 });
  }
  const headA = 'D5:1 F5:.5 A5:1.5 G5:.5 F5:.5 Eb5:1.5 D5:.5 C5:1 A4:1 -:.5 F5:.5 A5:.5 C6:.5 B5:1.5 A5:.5 G5:1 Eb5:1 A5:1.5 F5:.5 Ab5:1 C6:.5 Ab5:.5 F5:1 D5:1 G5:1.5 Bb5:.5 C6:1 Eb6:1 D6:.5 C6:.5 A5:.5 F5:.5 B5:1 G5:1';
  const bridge = 'F#5:1.5 A5:.5 C6:2 B5:1 A5:1 F#5:1 D5:1 B5:1.5 D6:.5 F6:2 E6:1 D6:1 B5:1 G5:1 E5:1.5 G5:.5 Bb5:2 A5:1 G5:1 E5:1 C5:1 A5:1.5 C6:.5 Eb6:2 D6:1 C6:1 A5:1 F5:1';
  const vp = (t: number, d: number, f: number, vel: number) => mallet(vib, t, d, f, vel * 0.85, 0.15, 'vibes');
  // Chorus 1: vibes carry the head. Chorus 2: the Rhodes takes it an octave down; vibes return for the bridge.
  const epLead = mix.bus(), kp = (t: number, d: number, f: number, vel: number) => ep(epLead, t, d, f, vel * 0.8, -0.1);
  melody(c, 0, headA + ' A5:1.5 G5:.5 F5:1 Eb5:1', vp, { r });
  melody(c, 8, headA + ' D5:3 -:1', vp, { r });
  melody(c, 16, bridge, vp, { r });
  melody(c, 24, headA + ' A5:1.5 G5:.5 F5:1 Eb5:1', vp, { r });
  melody(c, 32, headA + ' A5:1.5 G5:.5 F5:1 Eb5:1', kp, { r, transpose: -12 });
  melody(c, 40, headA + ' D5:3 -:1', kp, { r, transpose: -12 });
  melody(c, 48, bridge, vp, { r, vel: 0.75 });
  melody(c, 56, headA + ' A5:1.5 G5:.5 F5:1 Eb5:1', kp, { r, transpose: -12 });
  mix.add('rhodes lead', epLead, { gain: 1.2, reverb: 0.3 });
  chorus(keys, 0.002, 0.4, 0.3);
  mix.add('keys', filterBus(keys, 'hp', 150), { gain: 0.65, reverb: 0.3 });
  mix.add('bass', low, { gain: 1.0, reverb: 0.05 });
  mix.add('drums', drums, { gain: 0.8, reverb: 0.2 });
  mix.add('vibes', vib, { gain: 0.9, reverb: 0.35 });
  return mix.finish({ room: 0.84, damp: 0.45, target: 0.12 });
} };

/** 5. Chiptune: pulse lead with echo, fast arpeggios, triangle bass, noise drums. Arcade energy. */
const pixelParlor: Track = { id: 'pixel-parlor', title: 'Pixel Parlor', mood: 'Retro 8-bit arcade chiptune', bpm: 140, render() {
  seedNoise(55); const r = rng(55), c = clock(140, 0.5, 0.5), bars = 40, mix = new Mix(bars * c.bar);
  const lead = mix.bus(), arp = mix.bus(), low = mix.bus(), drums = mix.bus();
  const A = ['Am', 'F', 'C', 'G'], B = ['Dm', 'Em', 'F', 'G', 'Dm', 'Em', 'F', 'E'], prog = [...A, ...A, ...A, ...A, ...A, ...A, ...B, ...A, ...A].slice(0, bars);
  prog.forEach((ch, bar) => {
    const root = bassNote(ch, 3), third = ch.endsWith('m') ? 3 : 4, tones = [0, third, 7, 12];
    for (let s = 0; s < 16; s++) synth(arp, c.at(bar, s * 0.25), c.spb * 0.22, mtof(root + 12 + tones[s % 4]), 0.35, (s % 2 ? 0.3 : -0.3), { wave: 'pulse', pw: 0.125, chip: true, a: 0.001, d: 0.05, s: 0.6, r: 0.01 });
    if (bar < 4) return;
    const br = bassNote(ch, 2);
    for (let s = 0; s < 8; s++) synth(low, c.at(bar, s * 0.5), c.spb * 0.42, mtof(br + (s % 2 ? 12 : 0)), 1, 0, { wave: 'tri', chip: true, a: 0.001, d: 1, s: 1, r: 0.01 });
    const breakdown = bar >= 32 && bar < 36;
    if (breakdown) { for (let s = 0; s < 8; s++) chipNoise(drums, c.at(bar, s * 0.5), 0.3, 0.03, 20000, true, 0.2); return; }
    for (const b of bar >= 24 && bar < 32 ? [0, 2, 2.5] : [0, 2]) { synth(drums, c.at(bar, b), 0.08, 110, 1.2, 0, { wave: 'tri', chip: true, a: 0.001, d: 0.04, s: 0, r: 0.01 }); chipNoise(drums, c.at(bar, b), 0.5, 0.05, 3000); mix.kickAt(c.at(bar, b)); }
    for (const b of [1, 3]) chipNoise(drums, c.at(bar, b), 0.9, 0.16, 9000);
    for (let s = 0; s < 8; s++) chipNoise(drums, c.at(bar, s * 0.5), s % 2 ? 0.25 : 0.4, 0.03, 20000, true, 0.2);
  });
  const lp = (t: number, d: number, f: number, vel: number) => { synth(lead, t, d, f, vel, -0.1, { wave: 'pulse', pw: 0.25, chip: true, a: 0.002, d: 0.3, s: 0.7, r: 0.03, vib: 0.006, vibRate: 6 }); synth(lead, t + c.spb * 0.75, d, f, vel * 0.35, 0.5, { wave: 'pulse', pw: 0.25, chip: true, a: 0.002, d: 0.3, s: 0.7, r: 0.03 }); };
  const mA = 'A5:.5 C6:.5 E6:.5 A5:.5 G5:.5 A5:.5 C6:1 A5:.75 G5:.75 F5:.5 A5:1 C6:1 E6:.5 D6:.5 C6:.5 G5:.5 E5:1 G5:1 D6:1.5 B5:.5 G5:1 -:1 A5:.5 C6:.5 E6:.5 A6:.5 G6:.5 E6:.5 C6:1 F6:.75 E6:.75 C6:.5 A5:1 C6:1 G6:.5 E6:.5 C6:.5 E6:.5 D6:.5 C6:.5 B5:.5 C6:.5 D6:2 G5:.5 A5:.5 B5:1';
  const mB = 'F5:1 A5:1 D6:1.5 C6:.5 B5:1 G5:1 E5:1.5 G5:.5 A5:.5 C6:.5 F6:1 E6:.5 D6:.5 C6:1 B5:1.5 D6:.5 G6:2 F6:.5 E6:.5 D6:1 A5:1 D6:1 E6:.5 D6:.5 B5:1 G5:1 B5:1 C6:1 A5:1 F5:1 A5:1 G#5:1.5 B5:.5 E6:2';
  melody(c, 8, mA, lp, { r, jitter: 0 }); melody(c, 16, mA, lp, { r, jitter: 0 }); melody(c, 24, mB, lp, { r, jitter: 0 }); melody(c, 36, mA.split(' ').slice(0, 20).join(' '), lp, { r, jitter: 0 });
  mix.add('lead', lead, { gain: 0.8 });
  mix.add('arp', arp, { gain: 0.5, duck: 0.3 });
  mix.add('bass', low, { gain: 0.9 });
  mix.add('drums', drums, { gain: 1.4 });
  return mix.finish({ room: 0.5, damp: 0.5, lofi: 12000, target: 0.14 });
} };

export const tracks = [lanternLounge, hanafudaFunk, matsuriNights, teaHouseSwing, pixelParlor];
