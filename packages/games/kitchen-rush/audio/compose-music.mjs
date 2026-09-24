// Kitchen Rush soundtrack: a small offline synth band (vibes, Rhodes, upright bass, nylon guitar, flute, brush/stick kit)
// playing arranged, humanized parts, mixed through reverb and a glue compressor.
// Original music; no samples. From the platform root: node game-modules/packages/games/kitchen-rush/audio/compose-music.mjs
// Writes preview WAV/MP3s to output/kitchen-rush/music/ and game MP3s (loops carry a 1 s head copy) to public/games/kitchen-rush/music/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const SR = 44100, TAU = Math.PI * 2, OUT = `${process.cwd()}/output/kitchen-rush/music/`;
const PUBLIC = new URL('../../../../public/games/kitchen-rush/music/', import.meta.url).pathname;
let seed = 7; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const jitter = s => (rnd() - .5) * 2 * s;
const mtof = m => 440 * 2 ** ((m - 69) / 12);
const buf = s => new Float32Array(Math.ceil(s * SR));
const env = (t, a, d) => Math.min(1, t / a) * Math.exp(-t / d);
const release = (t, dur, r) => t > dur ? Math.exp(-(t - dur) / r) : 1;
function lowpass(x, hz) { const k = 1 - Math.exp(-TAU * hz / SR); let y = 0; for (let i = 0; i < x.length; i++) x[i] = y += k * (x[i] - y); return x; }
function highpass(x, hz) { const k = 1 - Math.exp(-TAU * hz / SR); let y = 0; for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); x[i] -= y; } return x; }
const band = (x, lo, hi) => lowpass(highpass(x, lo), hi);
/** Highpass that starts from the signal's own end, so a loop's first samples see the same filter state as its seam. */
function loopHighpass(x, hz) { const k = 1 - Math.exp(-TAU * hz / SR), out = new Float32Array(x.length); let y = 0; for (let i = x.length - 4096; i < x.length; i++) y += k * (x[i] - y); for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); out[i] = x[i] - y; } return out; }
function noise(s) { const x = buf(s); for (let i = 0; i < x.length; i++) x[i] = rnd() * 2 - 1; return x; }
const shape = (x, f) => { for (let i = 0; i < x.length; i++) x[i] *= f(i / SR); return x; };

// ── Instruments ─────────────────────────────────────────────────────────────
/** Vibraphone: tuned bar partials (1, 4, 10), a felt-mallet click, and the motor tremolo shared by every bar (t0 = song time). */
function vibes(f, dur, v, t0) {
  const x = buf(dur + 2.2), bright = .6 + .8 * v;
  for (const [r, a, d] of [[1, 1, 1.9], [4, .22 * bright, .45], [10, .05 * bright, .1]]) if (f * r < 15000) { const w = TAU * f * r / SR; for (let i = 0; i < x.length; i++) x[i] += a * Math.sin(w * i) * Math.exp(-i / SR / d); }
  const click = band(noise(.02), 1500, 6000);
  for (let i = 0; i < click.length; i++) x[i] += click[i] * .1 * bright * Math.exp(-i / SR / .003);
  return shape(x, t => v * Math.min(1, t / .002) * release(t, dur, .22) * (1 - .14 * (.5 + .5 * Math.sin(TAU * 4.6 * (t0 + t)))));
}
/** Rhodes-style FM electric piano; velocity adds bark. Two slightly detuned voices are panned apart by the caller. */
function rhodes(f, dur, v, detune = 0) {
  const x = buf(dur + 1.6), w = TAU * f * (1 + detune) / SR, tine = f * 14 < 15000;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR, index = (.6 + 1.6 * v) * Math.exp(-t / .35) + .15;
    x[i] = v * (Math.sin(w * i + index * Math.sin(w * i)) + (tine ? .07 * Math.sin(w * 14 * i) * Math.exp(-t / .03) : 0)) * Math.min(1, t / .003) * Math.exp(-t / 2.2) * release(t, dur, .12);
  }
  return x;
}
/** Karplus–Strong string. `tone` sets the pluck brightness; `body` adds a sine fundamental (upright bass). */
function string(f, dur, v, { tone = 900, loss = .998, body = 0, damp = .05 } = {}) {
  const n = Math.round(SR / f), ring = lowpass(noise(n / SR), tone), x = buf(dur + .6), w = TAU * f / SR, mean = ring.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i++) ring[i] -= mean; // DC-free, or low strings rumble.
  for (let i = 0, j = 0; i < x.length; i++, j = (j + 1) % n) {
    const t = i / SR, s = ring[j]; ring[j] = .5 * (s + ring[(j + 1) % n]) * loss;
    x[i] = v * release(t, dur, damp) * (.8 * s + body * Math.sin(w * i) * Math.exp(-t / 1.2) * Math.min(1, t / .004));
  }
  return x;
}
const bass = (f, dur, v) => {
  const x = string(f, dur, v, { tone: 800, body: .7, damp: .04 });
  for (let i = 0; i < SR * .03; i++) x[i] += v * .35 * Math.sin(TAU * f * .5 * i / SR) * Math.exp(-i / SR / .012); // finger thump
  return highpass(lowpass(x, 1400), 38);
};
const guitar = (f, dur, v) => lowpass(string(f, dur, v, { tone: 3200, loss: .997, damp: .09 }), 4200);
/** Flute: soft harmonics, breath noise and delayed vibrato. */
function flute(f, dur, v) {
  const x = buf(dur + .4), breath = band(noise(dur + .4), f * .8, f * 3);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR; ph += TAU * f * (1 + .004 * Math.sin(TAU * 5.2 * t) * Math.min(1, Math.max(0, t - .25) / .3)) / SR;
    const a = Math.min(1, t / .07) * release(t, dur, .09);
    x[i] = v * a * (Math.sin(ph) + .18 * Math.sin(2 * ph) + .06 * Math.sin(3 * ph) + breath[i] * (.08 + .25 * Math.exp(-t / .06)));
  }
  return x;
}
function brass(f, dur, v) {
  const x = buf(dur + .3);
  for (const detune of [-.005, 0, .006]) { let ph = rnd(); const inc = f * (1 + detune) / SR; for (let i = 0; i < x.length; i++) { ph = (ph + inc) % 1; x[i] += (2 * ph - 1) / 3; } }
  let a = 0, b = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR, k = 1 - Math.exp(-TAU * (500 + 2200 * Math.min(1, t / .05) * Math.exp(-t / .5)) / SR); a += k * (x[i] - a); b += k * (a - b);
    x[i] = v * b * Math.min(1, t / .03) * release(t, dur, .1);
  }
  return x;
}
/** Plunger-muted trombone for the "no stars" sting. */
function trombone(f, dur, v, vibrato = 0) {
  const x = buf(dur + .3); let ph = 0, a = 0, b = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR; ph = (ph + f * (1 + vibrato * .014 * Math.sin(TAU * 5 * t) * Math.min(1, t / .5)) / SR) % 1;
    const open = Math.min(1, t / .12) * (vibrato ? .55 + .45 * Math.sin(TAU * 2.5 * t) : 1), k = 1 - Math.exp(-TAU * (260 + 1100 * open) / SR);
    a += k * (2 * ph - 1 - a); b += k * (a - b);
    x[i] = v * b * Math.min(1, t / .04) * release(t, dur, .1);
  }
  return x;
}
// Kit
function kick(v) { const x = buf(.4); let ph = 0; for (let i = 0; i < x.length; i++) { const t = i / SR; ph += TAU * (46 + 70 * Math.exp(-t / .02)) / SR; x[i] = v * Math.sin(ph) * Math.exp(-t / .14); } return x; }
/** A brush stirred round the snare head: a soft swell, not a hit. */
const sweep = (v, len) => shape(band(noise(len + .1), 1800, 7000), t => v * Math.sin(Math.PI * Math.min(1, t / len)) ** 1.5);
const slap = v => shape(band(noise(.2), 900, 6500), t => v * (env(t, .003, .05) + .25 * Math.sin(TAU * 185 * t) * Math.exp(-t / .03)));
const snare = v => shape(band(noise(.25), 700, 8000), t => v * (env(t, .001, .06) + .45 * Math.sin(TAU * 195 * t) * Math.exp(-t / .045)));
function ride(v) { const x = highpass(noise(1.1), 5500), a = TAU * 3150 / SR, b = TAU * 4870 / SR, c = TAU * 7110 / SR; for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = v * (.45 * x[i] * env(t, .001, .3) + .16 * (Math.sin(a * i) + .6 * Math.sin(b * i) + .3 * Math.sin(c * i)) * env(t, .001, .55)); } return x; }
const chick = v => shape(highpass(noise(.08), 6500), t => v * env(t, .001, .022));
const crash = v => shape(band(noise(2.6), 3500, 12000), t => v * env(t, .003, .9));
function tambourine(v) { const x = highpass(noise(.2), 7000); return shape(x, t => v * (env(t, .001, .03) + (t > .012 ? .5 * env(t - .012, .001, .04) : 0))); }
function ding(f, v) { const x = buf(2.5); for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = v * (Math.sin(TAU * f * t) + .4 * Math.sin(TAU * f * 2.76 * t) * Math.exp(-t / .3)) * env(t, .001, 1.1); } return x; }
function block(f, v) { const x = buf(.12); for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = v * (Math.sin(TAU * f * t) + .35 * Math.sin(TAU * f * 2.8 * t)) * env(t, .0005, .022); } return x; }
function rim(v) { const x = highpass(noise(.06), 2500); for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = v * (x[i] * env(t, .0003, .008) + .55 * Math.sin(TAU * 1750 * t) * env(t, .0003, .016)); } return x; }
const shaker = v => shape(highpass(noise(.12), 5000), t => v * env(t, .014, .03));

// ── Harmony ─────────────────────────────────────────────────────────────────
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const QUALITY = { '6': [4, 7, 9, 14], '7': [4, 7, 10, 14], m7: [3, 7, 10, 14], maj7: [4, 7, 11, 14], '7b9': [4, 7, 10, 13], '13': [4, 7, 10, 21] };
function chord(name) { const [, root, q] = /^([A-G][b#]?)(.*)$/.exec(name); const [third, fifth, seventh, ninth] = QUALITY[q]; return { root: PC[root], third, fifth, seventh, ninth }; }
const note = name => { const [, l, acc, oct] = /^([A-G])([b#]?)(\d)$/.exec(name); return (+oct + 1) * 12 + PC[l + acc]; };
const nearest = (pc, target, lo, hi) => { let best = lo; for (let m = lo; m <= hi; m++) if (((m % 12) + 12) % 12 === pc && Math.abs(m - target) < Math.abs(best - target)) best = m; return best; };
/** Rootless voicing (3rd, 7th/6th, 9th or 13th, 5th) in lo..lo+11. */
const voicing = (c, lo = 55) => [c.third, c.seventh, c.ninth, c.fifth].map(i => nearest((c.root + i) % 12, lo + 6, lo, lo + 11)).sort((a, b) => a - b);
/** Guitar shape: root below, then the upper chord tones. */
const guitarShape = c => [nearest(c.root, 45, 40, 51), ...voicing(c, 57)].slice(0, 4);
const phrase = (bar, text) => text.split(',').map(s => s.trim().split(/\s+/)).map(([b, d, n]) => [bar, +b, +d, note(n)]);

// ── Rendering ───────────────────────────────────────────────────────────────
/** Micro-timing per player [offset, spread] in seconds: bass leans ahead, backbeat and comping sit back, the melody breathes. */
const FEEL = { bass: [-.006, .004], ride: [0, .003], back: [.007, .004], kick: [0, .002], comp: [.01, .008], lead: [.004, .012], perc: [0, .004] };
function session(song) {
  const beat = 60 / song.bpm, bars = song.bars.map(b => b.map(chord)), loop = bars.length * 4 * beat, n = Math.round(loop * SR), tr = song.transpose ?? 0;
  const dry = [buf(loop + 4), buf(loop + 4)], wet = [buf(loop + 4), buf(loop + 4)];
  /** Mono buffer into the stereo mix at time t; anything pushed before 0 wraps to the loop's end. */
  const put = (x, t, pan = 0, send = .2) => {
    const i0 = Math.round(t * SR), l = Math.cos((pan + 1) * Math.PI / 4), r = Math.sin((pan + 1) * Math.PI / 4);
    for (let i = 0; i < x.length; i++) { let j = i0 + i; if (j < 0) j += n; if (j >= dry[0].length) break; dry[0][j] += x[i] * l; dry[1][j] += x[i] * r; wet[0][j] += x[i] * l * send; wet[1][j] += x[i] * r * send; }
  };
  const swing = b => { const whole = Math.floor(b), f = b - whole; return Math.abs(f - .5) < 1e-6 ? whole + song.swing : b; };
  const at = (bar, b, who) => (bar * 4 + swing(b)) * beat + FEEL[who][0] + jitter(FEEL[who][1]);
  const chordAt = (bar, q) => bars[bar][bars[bar].length === 2 && q >= 2 ? 1 : 0];
  return { beat, bars, tr, put, at, chordAt, mix: () => master(dry, wet, loop) };
}
/** Section of the 32-bar AABA chorus: A1 light, A2 fuller, B bridge, A3 fullest. */
const sectionOf = bar => bar < 8 ? 'A1' : bar < 16 ? 'A2' : bar < 24 ? 'B' : 'A3';
const LIFT = { A1: .82, A2: .94, B: 1, A3: 1.08 };

function swingTune(song) {
  const s = session(song), rush = song.style === 'rush', put = s.put;
  let low = 41;
  for (let bar = 0; bar < s.bars.length; bar++) {
    const sec = sectionOf(bar), lift = LIFT[sec], two = s.bars[bar].length === 2, next = s.bars[(bar + 1) % s.bars.length][0];
    const stop = !rush && (bar === 16 || bar === 17), fill = bar % 8 === 7, top = bar % 8 === 0;
    // Bass: walking quarters (root, chord tone, fifth or second root, chromatic approach); stop-time bars hit with the band.
    if (stop) for (const b of [0, 1.5]) put(bass(mtof(nearest((s.chordAt(bar, b).root + s.tr) % 12, 40, 31, 50)), s.beat * .5, .55), s.at(bar, b, 'bass'), 0, .06);
    else for (let q = 0; q < 4; q++) {
      const c = s.chordAt(bar, q);
      const pc = q === 0 || (two && q === 2) ? c.root : q === 3 ? next.root + (rnd() < .6 ? -1 : 1) : c.root + (two ? c.fifth : q === 1 ? (rnd() < .5 ? c.third : 2) : c.fifth);
      const m = nearest(((pc + s.tr) % 12 + 12) % 12, low + (q === 3 ? 0 : 2), 31, 50); low = m;
      put(bass(mtof(m), s.beat * (.86 + jitter(.05)), (q % 2 ? .42 : .5) * (.94 + jitter(.06))), s.at(bar, q, 'bass'), 0, .06);
      // A raked triplet pickup into some phrases.
      if (q === 3 && bar % 4 === 3 && rnd() < .7) put(bass(mtof(m + 2), s.beat * .3, .28), (bar * 4 + 3 + 2 / 3) * s.beat + FEEL.bass[0], 0, .06);
    }
    // Comping: Rhodes (two chorused voices) on Charleston figures; sparse in A1, busier later.
    const hits = stop ? [[0, .45], [1.5, .45]] : two ? [[0, .9], [2, .9]] : sec === 'A1' ? (bar % 2 ? [[1.5, .45]] : [[0, 1.4]]) : bar % 2 ? [[.5, .4], [2, .9], [3.5, .4]] : [[0, .9], [1.5, .4]];
    for (const [b, d] of hits) {
      const t = s.at(bar, b, 'comp'), v = (.09 + (b % 1 ? .03 : 0)) * lift * (.9 + jitter(.1));
      voicing(s.chordAt(bar, b)).forEach((m, i) => { const f = mtof(m + s.tr); put(rhodes(f, d * s.beat, v, .0017), t + i * .004, -.45, .3); put(rhodes(f, d * s.beat, v * .8, -.0017), t + i * .004, .05, .3); });
    }
    if (rush) {
      // Sticks: straight-ish ride 8ths, backbeat snare with tambourine, feathered four, and a kitchen-timer woodblock.
      for (const b of [0, .5, 1, 1.5, 2, 2.5, 3, 3.5]) put(ride((b % 1 ? .09 : .15) * (.9 + jitter(.1))), s.at(bar, b, 'ride'), .35, .15);
      for (const b of [1, 3]) { put(snare(.3 * (.92 + jitter(.08))), s.at(bar, b, 'back'), -.1, .2); put(chick(.24), s.at(bar, b, 'back'), .3, .05); put(tambourine(.1), s.at(bar, b, 'perc'), .55, .12); }
      for (let q = 0; q < 4; q++) { put(kick(.3), s.at(bar, q, 'kick'), 0, 0); put(block(q % 2 ? 1250 : 1650, .06), s.at(bar, q, 'perc'), -.55, .1); }
      if (rnd() < .5) put(snare(.07), s.at(bar, 2.5, 'back'), -.1, .1);
    } else if (!stop) {
      // Brushes stirred on every beat pair plus a slap on 2 & 4; the ride joins after the first section.
      for (const b of [0, 2]) put(sweep(.05 * lift, s.beat * 1.9), s.at(bar, b, 'back') - .02, -.25, .15);
      for (const b of [1, 3]) { put(slap(.24 * lift * (.9 + jitter(.1))), s.at(bar, b, 'back'), -.1, .2); put(chick(.2), s.at(bar, b, 'back'), .3, .05); }
      if (sec !== 'A1') for (const b of [0, 1, 1.5, 2, 3, 3.5]) put(ride((b % 1 ? .08 : .13) * lift * (.88 + jitter(.12))), s.at(bar, b, 'ride'), .35, .15);
      for (const b of [0, 2]) put(kick(.2 + (b ? 0 : .06)), s.at(bar, b, 'kick'), 0, 0);
      for (const b of [.5, 2.5]) if (rnd() < .4) put(slap(.05), s.at(bar, b, 'back'), -.1, .1);
    } else for (const b of [0, 1.5]) { put(slap(.3), s.at(bar, b, 'back'), -.1, .25); put(kick(.3), s.at(bar, b, 'kick'), 0, 0); if (bar === 16 && !b) put(crash(.1), s.at(bar, b, 'ride'), -.35, .3); }
    if (top && bar) put(crash(rush ? .12 : .08), s.at(bar, 0, 'ride'), -.35, .3);
    if (top) put(ding(mtof(89 + s.tr), .045), s.at(bar, 0, 'perc'), .45, .5);
    if (fill) for (const [b, v] of [[3, .16], [3 + 1 / 3, .22], [3 + 2 / 3, .3]]) put(rush ? snare(v) : slap(v), (bar * 4 + b) * s.beat + FEEL.back[0], -.1, .2);
  }
  // Melody: phrase-shaped dynamics, panned by pitch; A3 (and all of the rush) is doubled an octave down on Rhodes.
  for (const [bar, b, d, m] of song.melody) {
    const sec = sectionOf(bar), arc = .9 + .14 * Math.sin(Math.PI * ((bar % 4) * 4 + b) / 16), v = .24 * LIFT[sec] * arc * (d >= 1 ? 1.05 : .95) * (.93 + jitter(.07)), t = s.at(bar, b, 'lead');
    put(vibes(mtof(m + s.tr), d * s.beat * (d < 1 ? .8 : .95), v, t), t, -.2 + (m - 60) / 40, .4);
    if (sec === 'A3' || rush) put(rhodes(mtof(m + s.tr - 12), d * s.beat * .85, .05, .001), t + .004, .25, .3);
  }
  // Rhodes answers where the vibes hold a note.
  for (const [bar, b, n] of song.fills ?? []) put(rhodes(mtof(note(n) + s.tr), s.beat * .45, .08, .001), s.at(bar, b, 'comp'), .35, .35);
  return s.mix();
}

function bossa(song) {
  const s = session(song), put = s.put;
  let low = 41;
  for (let bar = 0; bar < s.bars.length; bar++) {
    for (const [b, d, fifth] of [[0, 1.4, 0], [1.5, .45, 1], [2, 1.4, 1], [3.5, .45, 0]]) {
      const c = s.chordAt(bar, b), m = nearest((c.root + (fifth ? c.fifth : 0) + s.tr) % 12, low, 31, 50); low = m;
      put(bass(mtof(m), d * s.beat * .9, .42 * (.94 + jitter(.06))), s.at(bar, b, 'bass'), 0, .05);
    }
    // Nylon guitar: gentle strums (low to high, 14 ms apart) on the bossa syncopation.
    for (const [b, d, v] of bar % 2 ? [[.5, .9, .8], [2, .4, .6], [2.5, 1.3, .9]] : [[0, 1.4, 1], [1.5, .4, .6], [3, .9, .8]]) {
      const t = s.at(bar, b, 'comp');
      guitarShape(s.chordAt(bar, b)).forEach((m, i) => put(guitar(mtof(m + s.tr), d * s.beat, .17 * v * (.9 + jitter(.1))), t + i * .014, -.35 + i * .08, .3));
    }
    for (const b of bar % 2 ? [1, 2.5] : [0, 1.5, 3]) put(rim(.22 * (.9 + jitter(.1))), s.at(bar, b, 'perc'), .25, .15);
    for (let e = 0; e < 8; e++) put(shaker((e % 2 ? .13 : .08) * (.85 + jitter(.15))), s.at(bar, e / 2, 'perc'), .5, .1);
    for (const b of [0, 2]) put(kick(.2), s.at(bar, b, 'kick'), 0, 0);
    // Second time round, a Rhodes 9th sparkles above the guitar.
    if (bar >= 8) for (const b of [0, 1.5, 2.5]) { const c = s.chordAt(bar, b); put(rhodes(mtof(nearest((c.root + c.ninth + s.tr) % 12, 76, 72, 84)), s.beat * .6, .035), s.at(bar, b, 'comp') + .02, .45, .5); }
  }
  for (const [bar, b, d, m] of song.melody) {
    const t = s.at(bar, b, 'lead'), v = .16 * (bar >= 8 ? 1.05 : .95) * (.93 + jitter(.07));
    put(flute(mtof(m + s.tr), d * s.beat * .92, v), t, .15, .45);
    if (bar >= 8) put(vibes(mtof(m + s.tr - 12), d * s.beat * .9, .07, t), t + .01, -.3, .4);
  }
  return s.mix();
}

// ── Reverb, glue and loop folding ───────────────────────────────────────────
function reverb([l, r], room = .83, damp = .32) {
  return [[l, 0], [r, 23]].map(([input, spread]) => {
    const o = new Float32Array(input.length);
    for (const d0 of [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]) {
      const d = d0 + spread, line = new Float32Array(d); let idx = 0, store = 0;
      for (let i = 0; i < input.length; i++) { const y = line[idx]; store = y * (1 - damp) + store * damp; line[idx] = input[i] * .015 + store * room; idx = (idx + 1) % d; o[i] += y; }
    }
    for (const a0 of [556, 441, 341, 225]) {
      const d = a0 + spread, line = new Float32Array(d); let idx = 0;
      for (let i = 0; i < o.length; i++) { const b = line[idx], v = o[i]; line[idx] = v + b * .5; o[i] = b - v; idx = (idx + 1) % d; }
    }
    return o;
  });
}
/** Gentle bus compression (2:1 over -20 dB). Loops run the detector once first, so the seam sees the steady-state gain. */
function glue([l, r], warm) {
  const th = 10 ** (-20 / 20), att = Math.exp(-1 / (.015 * SR)), rel = Math.exp(-1 / (.2 * SR));
  let e = 0;
  for (const write of warm ? [false, true] : [true]) for (let i = 0; i < l.length; i++) {
    const x = Math.max(Math.abs(l[i]), Math.abs(r[i])); e = x > e ? att * e + (1 - att) * x : rel * e + (1 - rel) * x;
    if (write && e > th) { const g = (e / th) ** -.5; l[i] *= g; r[i] *= g; }
  }
}
/** Mix, fold the tail onto the start (seamless loop), glue, add a touch of air, and level to about -15 LUFS. */
function master(dry, wet, loop, level = .15) {
  for (const ch of [...dry, ...wet]) highpass(ch, 30);
  const verb = reverb(wet), n = loop ? Math.round(loop * SR) : dry[0].length, out = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 2; c++) for (let i = 0; i < dry[c].length; i++) out[c][loop ? i % n : i] += dry[c][i] + 2 * verb[c][i];
  for (const ch of out) { const air = loopHighpass(ch, 6000); for (let i = 0; i < n; i++) ch[i] += .25 * air[i]; }
  glue(out, !!loop);
  let sum = 0; for (let i = 0; i < n; i++) sum += out[0][i] ** 2 + out[1][i] ** 2;
  const gain = level / Math.sqrt(sum / (2 * n));
  for (const ch of out) for (let i = 0; i < n; i++) ch[i] = Math.tanh(ch[i] * gain * 1.1) / 1.1;
  return out;
}
function wav(path, [l, r]) {
  const data = Buffer.alloc(44 + l.length * 4);
  data.write('RIFF', 0); data.writeUInt32LE(36 + l.length * 4, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(l.length * 4, 40);
  for (let i = 0; i < l.length; i++) { data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), 44 + i * 4); data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), 46 + i * 4); }
  writeFileSync(path, data);
}
const mp3 = (from, to, quality) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', from, '-c:a', 'libmp3lame', '-q:a', quality, to]);
/** Preview MP3 of the pure loop, plus a game copy with the first second appended: any loopStart in (decoder padding, 1 s) is gapless. */
function save(name, audio, loop) {
  wav(`${OUT}${name}.wav`, audio); mp3(`${OUT}${name}.wav`, `${OUT}${name}.mp3`, '2');
  const head = loop ? SR : 0, game = audio.map(ch => { const x = new Float32Array(ch.length + head); x.set(ch); x.set(ch.subarray(0, head), ch.length); return x; });
  wav(`${OUT}${name}-game.wav`, game); mp3(`${OUT}${name}-game.wav`, `${PUBLIC}${name}.mp3`, '5');
  console.log(`${name}: ${(audio[0].length / SR).toFixed(2)} s`);
}

// ── Compositions ────────────────────────────────────────────────────────────
const A = (o, ending) => [
  ...phrase(o, '0 .5 C5, .5 .5 D5, 1 1 F5, 2 .5 D5, 2.5 .5 C5, 3 1 A4'),
  ...phrase(o + 1, '0 .5 A4, .5 .5 F#4, 1 .5 A4, 1.5 .5 C5, 2 1.5 D5'),
  ...phrase(o + 2, '0 .5 Bb4, .5 .5 A4, 1 .5 G4, 1.5 .5 Bb4, 2 1 D5, 3 1 F5'),
  ...phrase(o + 3, '0 1.5 E5, 1.5 .5 D5, 2 .5 C5, 2.5 .5 Bb4, 3 1 G4'),
  ...phrase(o + 4, '0 .5 C5, .5 .5 D5, 1 1 F5, 2 1 A5, 3 .5 G5, 3.5 .5 F5'),
  ...phrase(o + 5, '0 1 F#5, 1 .5 D5, 1.5 .5 C5, 2 1 A4, 3 1 F#4'),
  ...phrase(o + 6, '0 .5 G4, .5 .5 Bb4, 1 .5 D5, 1.5 .5 F5, 2 .5 E5, 2.5 .5 D5, 3 .5 C5, 3.5 .5 Bb4'),
  ...phrase(o + 7, ending === 'bridge' ? '0 1.5 F5, 1.5 .5 C5, 2 2 A4' : '0 1 A4, 1 1 F4, 2.5 .5 E4, 3 .5 G4, 3.5 .5 Bb4'),
];
const BRIDGE = [
  ...phrase(16, '0 1 E5, 1 .5 C#5, 1.5 .5 E5, 2 2 A5'), ...phrase(17, '0 1.5 G5, 1.5 .5 E5, 2 1 C#5, 3 1 A4'),
  ...phrase(18, '0 1 F#5, 1 .5 E5, 1.5 .5 F#5, 2 2 A5'), ...phrase(19, '0 1.5 C5, 1.5 .5 A4, 2 1 F#4, 3 1 D5'),
  ...phrase(20, '0 1 D5, 1 .5 B4, 1.5 .5 D5, 2 2 G5'), ...phrase(21, '0 1.5 F5, 1.5 .5 D5, 2 1 B4, 3 1 G4'),
  ...phrase(22, '0 1 E5, 1 .5 G5, 1.5 .5 Bb5, 2 .5 A5, 2.5 .5 G5, 3 1 E5'),
  ...phrase(23, '0 .5 G5, .5 .5 E5, 1 .5 C5, 1.5 .5 Bb4, 2 .5 G4, 2.5 .5 E4, 3 .5 G4, 3.5 .5 Bb4'),
];
const aBars = last => [['F6'], ['D7'], ['Gm7'], ['C7'], ['F6'], ['D7b9'], ['Gm7', 'C7'], last ? ['F6'] : ['F6', 'C7']];
const serviceBars = [...aBars(false), ...aBars(true), ['A7'], ['A7'], ['D7'], ['D7'], ['G7'], ['G7'], ['C13'], ['C7'], ...aBars(false)];
const serviceMelody = [...A(0), ...A(8, 'bridge'), ...BRIDGE, ...A(24)];
const serviceFills = [[9, 3.5, 'A5'], [11, 3.5, 'Bb5'], [13, 3.5, 'A5'], [15, 2.5, 'C6'], [15, 3, 'A5'], [15, 3.5, 'G5']];
const bossaBars = [['Fmaj7'], ['Fmaj7'], ['Gm7'], ['C7'], ['Am7'], ['D7'], ['Gm7'], ['C7']];
const bossaA = o => [
  ...phrase(o, '0 1.5 A4, 1.5 .5 C5, 2 2 E5'), ...phrase(o + 1, '0 1 E5, 1 .5 D5, 1.5 2.5 C5'),
  ...phrase(o + 2, '0 1.5 Bb4, 1.5 .5 D5, 2 2 F5'), ...phrase(o + 3, '0 1 E5, 1 .5 D5, 1.5 .5 C5, 2 2 Bb4'),
  ...phrase(o + 4, '0 1.5 C5, 1.5 .5 E5, 2 2 G5'), ...phrase(o + 5, '0 1 F#5, 1 .5 E5, 1.5 .5 D5, 2 2 C5'),
  ...phrase(o + 6, '0 1 Bb4, 1 .5 A4, 1.5 .5 G4, 2 2 D5'),
];
const lobbyMelody = [...bossaA(0), ...phrase(7, '0 1 C5, 1 1 Bb4, 2 2 G4'), ...bossaA(8), ...phrase(15, '0 1 C5, 1 .5 E5, 1.5 2.5 G5')];

mkdirSync(PUBLIC, { recursive: true }); mkdirSync(OUT, { recursive: true });
save('service', swingTune({ bpm: 132, swing: .64, style: 'swing', bars: serviceBars, melody: serviceMelody, fills: serviceFills }), true);
save('rush', swingTune({ bpm: 152, swing: .58, style: 'rush', transpose: 2, bars: serviceBars, melody: serviceMelody }), true);
save('lobby', bossa({ bpm: 100, swing: .5, bars: [...bossaBars, ...bossaBars], melody: lobbyMelody }), true);

// ── Stingers ────────────────────────────────────────────────────────────────
function sting(seconds, build) {
  const dry = [buf(seconds + 2.5), buf(seconds + 2.5)], wet = [buf(seconds + 2.5), buf(seconds + 2.5)];
  build((x, t, pan = 0, send = .3) => { const i0 = Math.round(t * SR), l = Math.cos((pan + 1) * Math.PI / 4), r = Math.sin((pan + 1) * Math.PI / 4); for (let i = 0; i < x.length && i0 + i < dry[0].length; i++) { dry[0][i0 + i] += x[i] * l; dry[1][i0 + i] += x[i] * r; wet[0][i0 + i] += x[i] * l * send; wet[1][i0 + i] += x[i] * r * send; } });
  return master(dry, wet, 0, .085);
}
save('win', sting(4.5, put => {
  const b = 60 / 140;
  for (let i = 0; i < 8; i++) put(snare(.08 + i * .025), i * b / 4, -.1, .2);
  ['F4', 'A4', 'C5', 'F5', 'A5'].forEach((n, i) => put(vibes(mtof(note(n)), b * .6, .26, i * b / 3), b * 2 + i * b / 3, -.3 + i * .15, .4));
  const t = b * 4;
  for (const n of ['F3', 'A3', 'C4', 'D4']) put(brass(mtof(note(n)), b * 2.6, .06), t, -.2, .35);
  voicing(chord('F6'), 60).forEach((m, i) => { put(rhodes(mtof(m), b * 3, .1, .0017), t + i * .006, -.4, .4); put(rhodes(mtof(m), b * 3, .08, -.0017), t + i * .006, .3, .4); });
  put(vibes(mtof(note('C6')), b * 3, .22, t), t, .2, .5); put(bass(mtof(note('F2')), b * 3, .6), t, 0, .1);
  put(kick(.45), t); put(crash(.2), t, -.3, .4); put(ding(mtof(note('F6')), .1), t + .03, .4, .6);
}), false);
save('no-stars', sting(4, put => {
  const b = 60 / 96;
  [['G4', .9, 0], ['F#4', .9, 0], ['F4', .9, 0], ['E4', 2.6, 1]].forEach(([n, d, vib], i) => put(trombone(mtof(note(n)), d * b, .4, vib), i * b, 0, .3));
  put(bass(mtof(note('C2')), b * 2.5, .45), 3 * b, 0, .1); put(slap(.3), 3 * b, -.1, .2); put(ding(mtof(note('E5')), .04), 3 * b + .05, .3, .5);
}), false);
