/* Night Job soundtrack candidates: two directions × three missions, each a seamless loop. */
import { Mix, SR, TAU, attack, autopan, bass, bassNote, biquad, brush, chord, clap, clock, ep, filterBus, flute, gate, hat, kick, len, mallet, mtof, pluck, put, ride, rim, rng, seedNoise, seq, shaker, snare, synth, voicer, white, woodblock, type Bus } from './synth';

export type Track = { id: string; title: string; direction: string; mission: 'velvet' | 'glasshouse' | 'ferry'; mood: string; bpm: number; render(): Bus };
type Clock = ReturnType<typeof clock>;
type Play = (t: number, d: number, f: number, v: number) => void;
/** Places a seq() melody from a bar; jitter humanizes timing (seconds). */
function melody(c: Clock, bar: number, s: string, play: Play, r: () => number, o: { vel?: number; jitter?: number; transpose?: number } = {}) {
  for (const n of seq(s)) if (n.m !== null) {
    const t = c.at(bar, n.at) + (r() - .5) * (o.jitter ?? .01), d = c.at(bar, n.at + n.d) - c.at(bar, n.at);
    play(t, d * .95, mtof(n.m + (o.transpose ?? 0)), (o.vel ?? .8) * (n.acc ? 1.15 : .9 + r() * .15));
  }
}
/** Lays phrases (one seq string per bar) end to end from a bar. */
const phrase = (c: Clock, bar: number, bars: string[], play: Play, r: () => number, o?: Parameters<typeof melody>[5]) => bars.forEach((s, i) => melody(c, bar + i, s, play, r, o));

/* ── extra instruments ─────────────────────────────────────────────────── */
/** Upright piano: inharmonic partials on two slightly detuned strings (honky = cents), hammer thump, damper on release. */
function piano(b: Bus, t: number, dur: number, f: number, vel: number, pan = 0, honky = 4) {
  const tau = Math.max(.5, Math.min(4, 2.8 * Math.sqrt(262 / f))), x = len(Math.min(dur, tau * 3) + .25);
  for (const cents of [-honky, honky]) for (let n = 1; n <= 9; n++) {
    const fn = n * f * 2 ** (cents / 1200) * Math.sqrt(1 + .0004 * n * n); if (fn > SR * .4) break;
    const amp = n ** -1.15 * (n === 1 ? 1 : .35 + .65 * vel), decay = Math.exp(-1 / (tau / n ** .7 * SR)), k = 2 * Math.cos(TAU * fn / SR);
    let y1 = 0, y2 = -Math.sin(TAU * fn / SR), e = amp; // sine by recurrence: cheap and exact
    for (let i = 0; i < x.length && e > 1e-4; i++) { const y = k * y1 - y2; y2 = y1; y1 = y; x[i] += y * e; e *= decay; }
  }
  for (let i = 0; i < x.length; i++) { const s = i / SR; x[i] = x[i] * attack(s, .002) * gate(s, dur, .1) * vel * .11 + white() * .05 * vel * Math.exp(-s / .005); }
  put(b, t, x, pan);
}
/** Cup-muted trumpet: filtered saw with a nasal peak and delayed vibrato. */
const horn = (b: Bus, t: number, d: number, f: number, v: number, pan = 0) => synth(b, t, d, f, v, pan, { wave: 'saw', cutoff: 700, env: 2400, envDecay: .12, res: .2, a: .035, d: .3, s: .75, r: .09, vib: .005, vibRate: 5.2 });
/** Musette accordion: two detuned reeds. */
const reed = (b: Bus, t: number, d: number, f: number, v: number, pan = 0) => synth(b, t, d, f, v, pan, { wave: 'pulse', pw: .32, voices: 2, detune: 14, cutoff: 2600, a: .025, d: .4, s: .85, r: .07, spread: .5 });
/** Fiddle: bowed saw, slow bite, vibrato. */
const fiddle = (b: Bus, t: number, d: number, f: number, v: number, pan = 0) => synth(b, t, d, f, v, pan, { wave: 'saw', cutoff: 3200, a: .06, d: .5, s: .8, r: .12, vib: .007, vibRate: 5.8 });
/** Ocean: two low-passed noise beds swelling on a period that divides the loop. */
function waves(b: Bus, seconds: number, level = 1) {
  const n = Math.round(seconds * SR), l = new Float32Array(n), r = new Float32Array(n), period = seconds / Math.max(1, Math.round(seconds / 7));
  for (let i = 0; i < n; i++) { l[i] = white(); r[i] = white(); }
  biquad(l, 'lp', 520); biquad(r, 'lp', 480); biquad(l, 'lp', 900); biquad(r, 'lp', 900);
  for (let i = 0; i < n; i++) { const p = TAU * i / SR / period, sw = .25 + .75 * Math.max(0, Math.sin(p)) ** 2, sw2 = .25 + .75 * Math.max(0, Math.sin(p + 1.9)) ** 2; b.l[i] += l[i] * sw * level * .5; b.r[i] += r[i] * sw2 * level * .5; }
}
/** Distant foghorn: a slow-swelling low fifth. */
const foghorn = (b: Bus, t: number, v = .5) => { for (const f of [58, 87]) synth(b, t, 2.6, f, v, 0, { wave: 'saw', voices: 3, detune: 8, cutoff: 420, a: .9, d: 2, s: .9, r: 1.4 }); };
/** Tremolo locked to tempo so the loop seam stays clean. */
function tremolo(b: Bus, rate: number, depth: number) { for (let i = 0; i < b.l.length; i++) { const g = 1 - depth * (.5 + .5 * Math.sin(TAU * rate * i / SR)); b.l[i] *= g; b.r[i] *= g; } return b; }
/** Walking bass line over one bar of chords: root, chord tones, then a chromatic approach to the next root. */
function walk(sym: string, next: string, r: () => number) {
  const { root, iv } = chord(sym), base = 40 + ((root - 4 + 12) % 12), to = 40 + ((chord(next).root - 4 + 12) % 12);
  const tones = [base, base + iv[1], base + iv[2], (iv[3] !== undefined && r() < .5) ? base + iv[3] : base + 12];
  return [tones[0], tones[1 + Math.floor(r() * 2)], tones[2 + Math.floor(r() * 2) % 2], to + (r() < .5 ? -1 : 1)];
}

/* ── Direction A: Ragtime Caper ─────────────────────────────────────────── */
/** Velvet: a sneaky D-minor rag. Stride piano, pizzicato bass, brushes, muted-trumpet answers. */
const velvetRag: Track = { id: 'velvet-rag', title: 'Velvet Rag', direction: 'Ragtime Caper', mission: 'velvet', mood: 'Sneaky stride-piano rag: a casino heist with a wink', bpm: 96, render() {
  seedNoise(31); const r = rng(31), c = clock(96, .56, .5), mix = new Mix(32 * c.bar);
  const lh = mix.bus(), rh = mix.bus(), low = mix.bus(), drums = mix.bus(), tp = mix.bus();
  const A = ['Dm', 'Dm', 'Gm', 'Dm', 'E7', 'A7', 'Dm', 'A7'], B = ['F', 'C7', 'F', 'D7', 'Gm', 'Dm', 'E7', 'Dm'], prog = [...A, ...A, ...B, ...A], v = voicer(58, false);
  prog.forEach((ch, bar) => {
    const root = bassNote(ch), fifth = root + chord(ch).iv[2] - 12, notes = v(ch);
    // Stride: bass on 1 and 3, chord on 2 and 4.
    piano(lh, c.at(bar, 0), .9 * c.spb, mtof(root - 12), .75, -.25); piano(lh, c.at(bar, 0), .9 * c.spb, mtof(root), .45, -.25);
    piano(lh, c.at(bar, 2), .9 * c.spb, mtof(fifth), .65, -.25);
    for (const b of [1, 3]) notes.forEach((m, k) => piano(lh, c.at(bar, b) + k * .004, .45 * c.spb, mtof(m), .5, -.1));
    if (bar >= 8) { pluck(low, c.at(bar, 0), .8 * c.spb, mtof(root), .9, 0, { bright: .25, decay: 1.2, body: 110 }); pluck(low, c.at(bar, 2), .8 * c.spb, mtof(fifth + 12), .75, 0, { bright: .25, decay: 1.2, body: 110 }); }
    brush(drums, c.at(bar, 0), .45, -.2, .3); for (const b of [1, 3]) snare(drums, c.at(bar, b), .22, .15, { tone: 210, snappy: .6, decay: .09 });
    for (const b of [.5, 1.5, 2.5, 3.5]) brush(drums, c.at(bar, b), .18, .2, .08);
  });
  const right: Play = (t, d, f, vel) => piano(rh, t, d, f, vel * .9, .15, 5);
  const a = ['A4:.5 D5:.25 F5:.5 A5:.75 G#5:.25 A5:.75 F5:.5 D5:.5', 'E5:.5 F5:.5 E5:.25 D5:.75 C#5:.5 D5:1.5', 'Bb4:.5 D5:.25 G5:.5 Bb5:.75 A5:.25 G5:.75 D5:.5 Bb4:.5', 'A4:.5 F5:.5 E5:.25 D5:.75 A4:2',
    'G#4:.5 B4:.25 D5:.5 E5:.75 F5:.25 E5:.75 D5:.5 B4:.5', 'C#5:.5 E5:.25 G5:.5 A5:.75 Bb5:.25 A5:.75 G5:.5 E5:.5', 'F5:.5 E5:.5 D5:.25 A4:.75 D5:.5 F5:.5 A5:1', 'G5:.5 E5:.5 C#5:.5 A4:.5 -:2'];
  const b = ['C5:.75 F5:.25 A5:1 G5:.5 F5:.5 A5:1', 'Bb5:.75 A5:.25 G5:1 E5:.5 C5:.5 G5:1', 'A5:.75 C6:.25 A5:.5 F5:.5 C5:1 -:1', 'F#5:.5 A5:.5 C6:.5 D6:.5 C6:.25 A5:.75 F#5:1',
    'G5:.75 Bb5:.25 D6:1 C6:.5 Bb5:.5 G5:1', 'F5:.75 A5:.25 D6:1 A5:.5 F5:.5 D5:1', 'E5:.5 G#5:.5 B5:.5 D6:.5 C#6:.5 A5:.5 G5:.5 E5:.5', 'D5:1 A4:.5 D5:.5 -:2'];
  for (const at of [0, 8, 24]) phrase(c, at, a, right, r, { jitter: .006 });
  phrase(c, 16, b, right, r, { jitter: .006 });
  const trumpet: Play = (t, d, f, vel) => horn(tp, t, d, f, vel * .8, .3);
  for (const bar of [15, 31]) melody(c, bar, '-:2 E5:.5 G5:.5 A5:.5! C#5:.5', trumpet, r);
  for (const bar of [7, 23]) melody(c, bar, '-:2 A4:.5 C5:.5 C#5:.5 E5:.5', trumpet, r);
  phrase(c, 16, b.map(s => s), (t, d, f, vel) => horn(tp, t, d, f / 2, vel * .45, .3), r, { jitter: .012 });
  mix.add('stride', lh, { gain: 1, reverb: .18 });
  mix.add('melody', rh, { gain: 1.05, reverb: .2 });
  mix.add('bass', low, { gain: 1.6 });
  mix.add('brushes', filterBus(drums, 'lp', 8000), { gain: 1.8, reverb: .1 });
  mix.add('trumpet', filterBus(filterBus(tp, 'hp', 350), 'peak', 1500, 1.4, 6), { gain: 1.1, reverb: .3 });
  return mix.finish({ lofi: 11000, room: .7, damp: .5, target: .12 });
} };

/** Glasshouse: a tiptoeing E-minor waltz. Harpsichord and celesta over pizzicato oom-pah-pah, glassy vibes. */
const glassWaltz: Track = { id: 'glass-waltz', title: 'Glasshouse Waltz', direction: 'Ragtime Caper', mission: 'glasshouse', mood: 'Tiptoeing harpsichord waltz under glass', bpm: 138, render() {
  seedNoise(32); const r = rng(32), c = clock(138, .5, .5, 3), mix = new Mix(48 * c.bar);
  const hp = mix.bus(), cel = mix.bus(), pz = mix.bus(), vib = mix.bus(), drums = mix.bus();
  const A = ['Em', 'Am', 'B7', 'Em', 'C', 'Am', 'F#m7b5', 'B7'], B = ['G', 'D', 'Em', 'Bm', 'C', 'Am', 'B7', 'B7'], prog = [...A, ...A, ...B, ...A, ...B, ...A], v = voicer(60, false);
  prog.forEach((ch, bar) => {
    const root = bassNote(ch), notes = v(ch);
    pluck(pz, c.at(bar, 0), .9 * c.spb, mtof(root), .95, -.2, { bright: .3, decay: .9, body: 140 });
    for (const b of [1, 2]) notes.forEach((m, k) => pluck(pz, c.at(bar, b) + k * .005, .3 * c.spb, mtof(m), .45, .2 - k * .1, { bright: .5, decay: .5 }));
    brush(drums, c.at(bar, 0), .35, 0, .25); for (const b of [1, 2]) brush(drums, c.at(bar, b), .16, .25, .06);
    if (bar >= 16 && bar < 24 || bar >= 32 && bar < 40) v(ch).forEach((m, k) => mallet(vib, c.at(bar, 0) + k * .03, 2.8 * c.spb, mtof(m + 12), .35, k / 2 - .5, 'vibes'));
    if (bar % 4 === 3) chord(ch).iv.concat([12]).forEach((iv, k) => mallet(cel, c.at(bar, 1.5 + k * .25), .4, mtof(chord(ch).root + 72 + iv), .22, .4, 'bell'));
  });
  const harpsi: Play = (t, d, f, vel) => { pluck(hp, t, d, f, vel, -.1, { bright: .95, decay: 1.1, pick: .06 }); pluck(hp, t + .002, d, f * 2, vel * .35, .1, { bright: .95, decay: .8, pick: .06 }); };
  const celesta: Play = (t, d, f, vel) => mallet(cel, t, d, f, vel * .7, .15, 'bell');
  const a = ['B5:1.5 A5:.5 G5:1', 'E5:2 C6:1', 'B5:1 A5:.5 G5:.5 F#5:1', 'G5:3', 'E6:1.5 D6:.5 C6:1', 'A5:2 E5:1', 'C6:1 B5:.5 A5:.5 F#5:1', 'D#5:2 -:1'];
  const b = ['D6:1.5 B5:.5 G5:1', 'F#5:1.5 A5:.5 D6:1', 'E6:1 D6:.5 B5:.5 G5:1', 'F#5:3', 'G5:1 E5:.5 G5:.5 C6:1', 'E6:1.5 C6:.5 A5:1', 'F#5:1 A5:.5 B5:.5 D#6:1', 'B5:2 -:1'];
  phrase(c, 0, a, harpsi, r); phrase(c, 8, a, celesta, r); phrase(c, 16, b, harpsi, r); phrase(c, 24, a, harpsi, r);
  phrase(c, 32, b, celesta, r); phrase(c, 32, b, harpsi, r, { vel: .5, transpose: -12 }); phrase(c, 40, a, harpsi, r);
  mix.add('harpsichord', filterBus(hp, 'lp', 7500), { gain: 2.1, reverb: .3 });
  mix.add('celesta', filterBus(cel, 'lp', 6000), { gain: 1.1, reverb: .45, echo: .25 });
  mix.add('pizzicato', filterBus(pz, 'lp', 4500), { gain: 2, reverb: .25 });
  mix.add('vibes', filterBus(vib, 'lp', 6000), { gain: .8, reverb: .5 });
  mix.add('brushes', drums, { gain: 1.4, reverb: .1 });
  return mix.finish({ lofi: 11000, room: .86, damp: .3, echoTime: c.spb, echoFb: .3, target: .11 });
} };

/** Ferry: an A-minor sea shanty in 6/8. Accordion, fiddle, stomps, waves and a foghorn. */
const ferryShanty: Track = { id: 'ferry-shanty', title: 'Last Ferry Shanty', direction: 'Ragtime Caper', mission: 'ferry', mood: 'Rolling 6/8 accordion shanty on a foggy quay', bpm: 72, render() {
  seedNoise(33); const r = rng(33), c = clock(216, .5, .5, 6), bars = 48, mix = new Mix(bars * c.bar);
  const acc = mix.bus(), fid = mix.bus(), low = mix.bus(), drums = mix.bus(), sea = mix.bus(), comp = mix.bus();
  const A = ['Am', 'G', 'Am', 'Em', 'Am', 'G', 'E7', 'Am'], B = ['C', 'G', 'Am', 'E', 'F', 'C', 'E7', 'Am'], prog = [...A, ...A, ...B, ...A, ...B, ...A], v = voicer(57, false);
  prog.forEach((ch, bar) => {
    const root = bassNote(ch), notes = v(ch);
    pluck(low, c.at(bar, 0), 2.6 * c.spb, mtof(root), .95, 0, { bright: .3, decay: 1.1, body: 120 }); pluck(low, c.at(bar, 3), 2.6 * c.spb, mtof(root + chord(ch).iv[2] - 12), .8, 0, { bright: .3, decay: 1.1, body: 120 });
    for (const b of [1, 2, 4, 5]) notes.forEach(m => reed(comp, c.at(bar, b), .8 * c.spb, mtof(m), .28, -.3));
    if (bar < 4) return;
    for (const b of [0, 3]) { kick(drums, c.at(bar, b), b ? .7 : .9, { f0: 110, f1: 55, decay: .25, click: .4 }); mix.kickAt(c.at(bar, b)); }
    clap(drums, c.at(bar, 3), .35, .1);
    for (let e = 0; e < 6; e++) shaker(drums, c.at(bar, e), e % 3 ? .2 : .45, .35);
  });
  const a = ['E5:1 A5:2 A5:1 B5:1 C6:1', 'B5:2 G5:1 D5:3', 'E5:1 A5:2 A5:1 C6:1 E6:1', 'D6:2 B5:1 G5:3', 'C6:2 B5:1 A5:1 G5:1 A5:1', 'B5:2 A5:1 G5:1 E5:1 D5:1', 'E5:1 G#5:1 B5:1 D6:2 B5:1', 'A5:4 -:2'];
  const b = ['G5:2 E5:1 C5:1 E5:1 G5:1', 'B5:2 A5:1 G5:3', 'A5:2 C6:1 E6:2 C6:1', 'B5:3 G#5:3', 'A5:2 C6:1 F6:2 C6:1', 'E6:2 D6:1 C6:1 B5:1 C6:1', 'B5:1 G#5:1 E5:1 D6:2 B5:1', 'A5:3 E5:1 A5:2'];
  const accordion: Play = (t, d, f, vel) => reed(acc, t, d, f, vel * .9, .15), violin: Play = (t, d, f, vel) => fiddle(fid, t, d, f, vel * .8, -.25);
  phrase(c, 0, a, accordion, r, { transpose: -12 }); phrase(c, 8, a, accordion, r); phrase(c, 16, b, accordion, r); phrase(c, 16, b, violin, r, { transpose: 12, vel: .5 });
  phrase(c, 24, a, violin, r); phrase(c, 32, b, accordion, r); phrase(c, 32, b, violin, r, { vel: .6 }); phrase(c, 40, a, accordion, r); phrase(c, 40, a, violin, r, { transpose: -12, vel: .45 });
  waves(sea, bars * c.bar, 1); foghorn(sea, c.at(22, 0), .45); foghorn(sea, c.at(46, 0), .4);
  mix.add('accordion', acc, { gain: .9, reverb: .25 });
  mix.add('fiddle', filterBus(fid, 'peak', 2800, 1, 3), { gain: 1.9, reverb: .3 });
  mix.add('reeds', comp, { gain: .8, reverb: .15, duck: .2 });
  mix.add('bass', low, { gain: 1.7 });
  mix.add('stomp', drums, { gain: .5, reverb: .15 });
  mix.add('sea', filterBus(sea, 'hp', 40), { gain: .9, reverb: .2 });
  return mix.finish({ lofi: 11000, room: .82, damp: .45, target: .12 });
} };

/* ── Direction B: Midnight Noir ─────────────────────────────────────────── */
/** Velvet: cool C-minor spy swing. Walking bass, ride, muted trumpet, vibes second chorus. */
const velvetNoir: Track = { id: 'velvet-noir', title: 'Velvet Rope', direction: 'Midnight Noir', mission: 'velvet', mood: 'Cool minor spy-jazz swing: walking bass and a muted trumpet', bpm: 116, render() {
  seedNoise(41); const r = rng(41), c = clock(116, .66, .5), mix = new Mix(32 * c.bar);
  const low = mix.bus(), drums = mix.bus(), tp = mix.bus(), vb = mix.bus(), keys = mix.bus();
  const form = [['Cm9'], ['Cm9'], ['Fm9'], ['Fm9'], ['Cm9'], ['Cm9'], ['Dm7b5'], ['G7b9'], ['Ebmaj7'], ['Abmaj7'], ['Dm7b5'], ['G7b9'], ['Cm9'], ['Ab7'], ['Dm7b5', 'G7b9'], ['Cm9']], prog = [...form, ...form], v = voicer(62);
  prog.forEach((chs, bar) => {
    const next = prog[(bar + 1) % prog.length][0];
    if (chs.length === 1) walk(chs[0], next, r).forEach((m, b) => bass(low, c.at(bar, b), .9 * c.spb, mtof(m), b ? .8 : .95, { drive: 1.3, bright: .45 }));
    else chs.forEach((ch, k) => [bassNote(ch), bassNote(ch) + chord(ch).iv[1] - (k ? 12 : 0)].forEach((m, b) => bass(low, c.at(bar, k * 2 + b), .9 * c.spb, mtof(m), .85, { drive: 1.3, bright: .45 })));
    for (const b of [0, 1, 1.5, 2, 3, 3.5]) ride(drums, c.at(bar, b), (b % 1 ? .35 : .55) * (.85 + r() * .3), .35);
    for (const b of [1, 3]) hat(drums, c.at(bar, b), .35, -.3, .02);
    if (r() < .6) snare(drums, c.at(bar, [1.5, 2.5, 3.5][Math.floor(r() * 3)]), .12 + r() * .1, -.1, { tone: 220, snappy: .5, decay: .08 });
    if (bar % 4 === 3) kick(drums, c.at(bar, 3.5), .35, { f0: 100, decay: .2 });
    chs.forEach((ch, k) => { const hit = k * 2 + (r() < .5 ? 1.5 : .5); v(ch).forEach((m, i) => ep(keys, c.at(bar, hit) + i * .004, .6 * c.spb, mtof(m), .38, i / 3 - .5)); });
  });
  const a = ['G4:1.5 Bb4:.5 C5:1 Eb5:1', 'D5:3 -:1', 'C5:1.5 Eb5:.5 F5:1 Ab5:1', 'G5:3 -:1', 'Eb5:.5 D5:.5 C5:.5 Bb4:.5 C5:2', '-:2 G4:.5 Bb4:.5 C5:.5 D5:.5', 'Eb5:1.5 D5:.5 C5:1 Ab4:1', 'B4:3 -:1',
    'Bb4:1.5 D5:.5 G5:1 Bb5:1', 'C6:2 G5:1 Eb5:1', 'F5:1.5 Ab5:.5 C6:1 Ab5:1', 'G5:1 F5:.5 D5:.5 B4:2', 'C5:1.5 Eb5:.5 G5:1 D5:1', 'C5:3 -:1', 'Ab4:1 F4:1 B4:1 D5:1', 'C5:3 -:1'];
  phrase(c, 0, a, (t, d, f, vel) => horn(tp, t, d, f, vel, .2), r, { jitter: .015 });
  phrase(c, 16, a, (t, d, f, vel) => mallet(vb, t, d, f * 2, vel * .8, -.2, 'vibes'), r, { jitter: .01 });
  for (const bar of [17, 21, 25, 29]) melody(c, bar, '-:2.5 G4:.5 Bb4:.5 C5:.5!', (t, d, f, vel) => horn(tp, t, d, f, vel * .7, .25), r);
  mix.add('bass', low, { gain: .45 });
  mix.add('drums', filterBus(drums, 'lp', 9000), { gain: 1.6, reverb: .12 });
  mix.add('trumpet', filterBus(filterBus(tp, 'hp', 380), 'peak', 1400, 1.5, 7), { gain: 1.25, reverb: .35, echo: .12 });
  mix.add('vibes', filterBus(vb, 'lp', 6500), { gain: 1.1, reverb: .4 });
  mix.add('keys', autopan(keys, 1 / (2 * c.spb), .15), { gain: .8, reverb: .25 });
  return mix.finish({ lofi: 11000, room: .78, damp: .45, echoTime: c.spb * .75, echoFb: .25, target: .12 });
} };

/** Glasshouse: an A-minor bossa nova. Nylon guitar, flute, vibes and a soft clave. */
const glassBossa: Track = { id: 'glass-bossa', title: 'Orchid Bossa', direction: 'Midnight Noir', mission: 'glasshouse', mood: 'Hushed bossa nova: nylon guitar and breathy flute among the palms', bpm: 132, render() {
  seedNoise(42); const r = rng(42), c = clock(132, .54, .25), mix = new Mix(32 * c.bar);
  const gtr = mix.bus(), low = mix.bus(), fl = mix.bus(), vb = mix.bus(), drums = mix.bus();
  const A = ['Am9', 'Am9', 'Dm9', 'Dm9', 'Bm7b5', 'E7b9', 'Am9', 'Am9'], B = ['Fmaj7', 'Fmaj7', 'Em7', 'A7', 'Dm9', 'G13', 'Cmaj7', 'E7b9'], prog = [...A, ...B, ...A, ...B], v = voicer(58);
  prog.forEach((ch, bar) => {
    const root = bassNote(ch), fifth = root + 7, notes = v(ch);
    for (const [b, m] of [[0, root], [1.5, fifth - 12], [2, fifth - 12], [3.5, root]] as const) pluck(low, c.at(bar, b), .45 * c.spb, mtof(m), .8, -.05, { bright: .2, decay: 1, body: 100 });
    for (const b of bar % 2 ? [.5, 1.5, 2.25, 3] : [0, .75, 1.5, 2.5, 3.25]) notes.forEach((m, k) => pluck(gtr, c.at(bar, b) + k * .008, .5 * c.spb, mtof(m), .42, .25 - k * .12, { bright: .35, decay: 1.3, pick: .2, body: 220 }));
    for (const b of bar % 2 ? [.5, 2, 3] : [0, 1.5, 3]) rim(drums, c.at(bar, b), .35, .2);
    for (let s = 0; s < 8; s++) shaker(drums, c.at(bar, s * .5), s % 2 ? .22 : .38, -.3);
    kick(drums, c.at(bar, 0), .35, { f0: 90, f1: 50, decay: .22, click: .05 }); kick(drums, c.at(bar, 2), .3, { f0: 90, f1: 50, decay: .22, click: .05 });
  });
  const a = ['E5:1.5 E5:.5 D5:.5 E5:1.5', 'C5:.5 B4:.5 A4:1 -:2', 'F5:1.5 F5:.5 E5:.5 F5:1.5', 'D5:.5 C5:.5 A4:1 -:2', 'D5:1 F5:.5 A5:1.5 G5:1', 'G#5:1.5 F5:.5 E5:1 D5:1', 'C5:1 B4:.5 C5:.5 E5:2', '-:4'];
  const b = ['A5:1.5 G5:.5 E5:1 C5:1', 'E5:4', 'G5:1.5 F#5:.5 D5:1 B4:1', 'C#5:3 -:1', 'F5:1.5 E5:.5 D5:1 A4:1', 'B4:1 D5:1 E5:1 F5:1', 'E5:2 G5:1 B5:1', 'G#5:2 -:2'];
  const flutePlay: Play = (t, d, f, vel) => flute(fl, t, d, f, vel * .85, .15, { breath: .16 });
  phrase(c, 0, a, flutePlay, r, { jitter: .02 }); phrase(c, 8, b, flutePlay, r, { jitter: .02 });
  phrase(c, 16, a, (t, d, f, vel) => mallet(vb, t, d, f, vel * .75, -.2, 'vibes'), r); phrase(c, 24, b, flutePlay, r, { jitter: .02 });
  phrase(c, 24, b, (t, d, f, vel) => mallet(vb, t, d, f, vel * .35, -.3, 'vibes'), r, { transpose: -12 });
  mix.add('guitar', gtr, { gain: 1.8, reverb: .25 });
  mix.add('bass', low, { gain: 1.7 });
  mix.add('flute', fl, { gain: 1.2, reverb: .4, echo: .15 });
  mix.add('vibes', filterBus(vb, 'lp', 6500), { gain: 1, reverb: .45 });
  mix.add('percussion', filterBus(drums, 'lp', 9000), { gain: .75, reverb: .15 });
  return mix.finish({ lofi: 11000, room: .8, damp: .4, echoTime: c.spb * .75, echoFb: .3, target: .11 });
} };

/** Ferry: E-minor surf-spy dub. Tremolo twang guitar, deep bass, one-drop, fog and water. */
const ferryDub: Track = { id: 'ferry-dub', title: 'Fog Dub', direction: 'Midnight Noir', mission: 'ferry', mood: 'Dark surf-spy dub: tremolo twang, deep bass and foghorns', bpm: 84, render() {
  seedNoise(43); const r = rng(43), c = clock(84, .58, .25), bars = 24, mix = new Mix(bars * c.bar);
  const tw = mix.bus(), low = mix.bus(), drums = mix.bus(), sk = mix.bus(), sea = mix.bus(), riff = mix.bus();
  const A = ['Em', 'Em', 'C', 'B7', 'Em', 'Em', 'Am', 'B7'], B = ['C', 'C', 'G', 'D', 'Am', 'Am', 'B7', 'B7'], prog = [...A, ...B, ...A], v = voicer(62, false);
  prog.forEach((ch, bar) => {
    const root = bassNote(ch);
    for (const [b, iv, d] of [[0, 0, 1.4], [1.5, 0, .4], [2, 7, .9], [3, 12, .4], [3.5, 10, .45]] as const) bass(low, c.at(bar, b), d * c.spb, mtof(root + iv), b ? .8 : 1, { drive: 1.1, bright: .15 });
    for (const b of [1, 3]) v(ch).forEach((m, k) => synth(sk, c.at(bar, b) + k * .003, .18 * c.spb, mtof(m), .45, .3, { wave: 'square', cutoff: 1800, a: .003, d: .08, s: .3, r: .04 }));
    kick(drums, c.at(bar, 2), 1, { f0: 120, f1: 45, decay: .35 }); mix.kickAt(c.at(bar, 2)); rim(drums, c.at(bar, 2), .6, .1);
    for (let s = 0; s < 8; s++) hat(drums, c.at(bar, s * .5), s % 2 ? .18 : .3, .3, .03);
    if (bar % 4 === 3) { for (const b of [3, 3.25, 3.5, 3.75]) rim(drums, c.at(bar, b), .4, -.2); woodblock(drums, c.at(bar, 3.75), .3, .4, 700); }
    if (ch === 'Em' && bar % 2 === 0) melody(c, bar, 'E3:.5 E3:.5 G3:.5 E3:.5 A3:.5 E3:.5 Bb3:.25 A3:.25 G3:.5', (t, d, f, vel) => pluck(riff, t, d, f, vel * .6, -.35, { bright: .7, decay: 1.4, pick: .18 }), r);
  });
  const twang: Play = (t, d, f, vel) => pluck(tw, t, d, f, vel, .2, { bright: .85, decay: 2.4, pick: .22 });
  const a = ['B4:2 G4:1 E4:1', 'F#4:1.5 G4:.5 B4:2', 'C5:2 B4:1 G4:1', 'A4:2 D#4:2', 'B4:1 E5:1 D5:1 B4:1', 'G4:4', 'A4:1 C5:1 E5:1.5 D5:.5', 'B4:2 -:2'];
  const b = ['E5:2 D5:1 C5:1', 'G4:4', 'D5:2 B4:1 G4:1', 'A4:2 F#4:2', 'E5:1.5 D5:.5 C5:1 A4:1', 'C5:4', 'D#5:2 F#5:2', 'B4:4'];
  phrase(c, 0, a, twang, r, { jitter: .01 }); phrase(c, 8, b, twang, r, { jitter: .01 }); phrase(c, 16, a, twang, r, { jitter: .01, transpose: 12, vel: .6 });
  waves(sea, bars * c.bar, .8); foghorn(sea, c.at(7, 2), .5); foghorn(sea, c.at(15, 2), .35); foghorn(sea, c.at(23, 2), .5);
  mix.add('twang', filterBus(tremolo(tw, 2 / c.spb, .45), 'lp', 5000), { gain: 3.2, reverb: .45, echo: .35 });
  mix.add('riff', riff, { gain: 1.4, reverb: .2, echo: .15 });
  mix.add('bass', filterBus(low, 'lp', 900), { gain: .55, duck: .25 });
  mix.add('skank', filterBus(sk, 'hp', 300), { gain: .9, echo: .3, reverb: .2 });
  mix.add('drums', drums, { gain: .85, echo: .1, reverb: .1 });
  mix.add('sea', filterBus(sea, 'hp', 40), { gain: .8, reverb: .25 });
  return mix.finish({ lofi: 11000, room: .88, damp: .35, echoTime: c.spb * .75, echoFb: .45, target: .12 });
} };

export const tracks: Track[] = [velvetRag, glassWaltz, ferryShanty, velvetNoir, glassBossa, ferryDub];
