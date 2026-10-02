/**
 * Builds the Hijinks SFX library at public/games/hijinks/sfx/<id>.mp3: organic sounds from ElevenLabs sound generation,
 * UI blips synthesised with music/synth.ts. Existing files are skipped (delete one to regenerate it). Every file is
 * trimmed, faded and peak-normalised. Raw ElevenLabs downloads are cached in output/hijinks-sfx/ (git-ignored), so
 * deleting a public file reprocesses it for free; delete the cached file too to pay for a new take. ElevenLabs spend for
 * the whole library is capped at CAP credits across runs.
 * Usage (platform root): flock /tmp/hijinks-heavy.lock node --import tsx packages/games/hijinks/tools/sfx.ts [--dry-run] [id…]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SFX_IDS, type SfxId } from '../src/core/contract';
import { SR, TAU, biquad, bus, chipNoise, clap, hat, kick, mallet, midi, mtof, pluck, reverb, rng, snare, synth, white, woodblock, wav, type Bus } from '../music/synth';
import { brass, crash, strings, timpani, tom } from '../music/kit';
import { client, spentBy } from './elevenlabs';

const CAP = 1200, out = join(import.meta.dirname, '../../../../public/games/hijinks/sfx'), cache = join(process.cwd(), 'output/hijinks-sfx');
/** el: ElevenLabs prompt (seconds), or synth: a design rendered into a stereo bus. peak: normalised peak in dBFS. */
type Spec = { peak?: number; stereo?: boolean; wet?: number } & ({ el: string; seconds: number; influence?: number } | { synth: (b: Bus) => void; seconds: number });

/* ── synth helpers ─────────────────────────────────────────────────────── */
type Wave = 'sine' | 'square' | 'tri' | 'saw';
/** An oscillator gliding exponentially f0 → f1, with attack and exponential decay. */
function tone(b: Bus, t: number, dur: number, f0: number, f1: number, vel: number, wave: Wave = 'sine', decay = dur / 3, pan = 0) {
  const n = Math.round(dur * SR), i0 = Math.round(t * SR); let ph = 0;
  for (let i = 0; i < n && i0 + i < b.l.length; i++) {
    const s = i / SR, f = f0 * (f1 / f0) ** (s / dur); ph = (ph + f / SR) % 1;
    const y = wave === 'sine' ? Math.sin(TAU * ph) : wave === 'square' ? (ph < .5 ? .6 : -.6) : wave === 'tri' ? 4 * Math.abs(ph - .5) - 1 : (2 * ph - 1) * .6;
    const v = y * Math.min(1, s / .004) * Math.exp(-s / decay) * Math.min(1, (dur - s) / .01) * vel * .5;
    b.l[i0 + i] += v * (1 - pan); b.r[i0 + i] += v * (1 + pan);
  }
}
/** Noise through a band-pass whose centre follows fc(k) for k in 0..1, shaped by env(k); pan(k) moves it across. */
function sweep(b: Bus, t: number, dur: number, fc: (k: number) => number, env: (k: number) => number, vel: number, q = 1.2, pan: (k: number) => number = () => 0) {
  const n = Math.round(dur * SR), i0 = Math.round(t * SR), k2 = 1 / q; let ic1 = 0, ic2 = 0;
  for (let i = 0; i < n && i0 + i < b.l.length; i++) {
    const k = i / n, g = Math.tan(Math.PI * Math.min(fc(k), SR * .45) / SR), a1 = 1 / (1 + g * (g + k2)), a2 = g * a1, a3 = g * a2;
    const x = white(), v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3; ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    const v = v1 * env(k) * vel, p = pan(k); b.l[i0 + i] += v * (1 - p); b.r[i0 + i] += v * (1 + p);
  }
}
const bell = (b: Bus, t: number, f: number, vel: number, dur = 1, pan = 0) => mallet(b, t, dur, f, vel, pan, 'bell');
const n = (note: string) => mtof(midi(note));

const SFX: Record<SfxId, Spec> = {
  tap: { seconds: .2, peak: -9, synth: b => { mallet(b, 0, .06, n('G6'), .8, 0, 'marimba'); tone(b, 0, .03, 2600, 1800, .25); } },
  submit: { seconds: .6, peak: -4, wet: .15, synth: b => { tone(b, 0, .09, 500, 1300, .7, 'sine', .05); mallet(b, .05, .3, n('E6'), .7, 0, 'marimba'); bell(b, .11, n('B6'), .5, .5); } },
  lock: { seconds: .45, peak: -4, synth: b => { kick(b, 0, .6, { f0: 400, f1: 120, decay: .04, click: .5 }); woodblock(b, .0, .8, 0, 1400); tone(b, .06, .25, n('C6'), n('C6'), .35, 'tri', .08); tone(b, .06, .25, n('G6'), n('G6'), .25, 'sine', .1); } },
  tick: { seconds: .1, peak: -10, synth: b => woodblock(b, 0, 1, 0, 1800) },
  'tick-fast': { seconds: .12, peak: -7, synth: b => { woodblock(b, 0, 1, 0, 2400); tone(b, 0, .03, 2000, 2000, .25, 'square', .01); } },
  timeup: { seconds: 1.3, peak: -3, synth: b => { for (const t of [0, .22]) tone(b, t, .13, 880, 880, .7, 'square', .2); tone(b, .44, .75, 1760, 1760, .6, 'square', .4); tone(b, .44, .75, 880, 880, .4, 'tri', .5); } },
  whoosh: { seconds: .6, peak: -4, stereo: true, synth: b => sweep(b, 0, .55, k => 350 + 2800 * Math.sin(Math.PI * k) ** 2, k => Math.sin(Math.PI * k) ** 1.6, 1.4, 1.5, k => k * 1.4 - .7) },
  'swoosh-in': { seconds: .7, peak: -4, stereo: true, wet: .2, synth: b => { sweep(b, 0, .38, k => 300 * 14 ** k, k => k ** 2, 1.4, 1.8, k => .7 - k * .7); bell(b, .36, n('E7'), .35, .4, .2); tone(b, .36, .05, 2000, 900, .3); } },
  pop: { seconds: .2, peak: -5, synth: b => { tone(b, 0, .06, 380, 1200, .9, 'sine', .03); sweep(b, 0, .015, () => 3000, () => 1, .4); } },
  ding: { seconds: 1.4, peak: -5, wet: .2, synth: b => { bell(b, 0, n('A6'), .8, 1.2); tone(b, 0, 1.3, n('A6'), n('A6'), .3, 'sine', .45); } },
  correct: { seconds: 1.1, peak: -3, wet: .2, synth: b => { for (const [t, f] of [[0, n('E6')], [.11, n('B6')]] as const) { bell(b, t, f, .7, .8); tone(b, t, .9, f, f, .35, 'sine', .25); mallet(b, t, .3, f / 2, .5, 0, 'marimba'); } } },
  wrong: { seconds: .7, peak: -3, synth: b => { for (const [t, f, d] of [[0, 196, .16], [.19, 147, .42]] as const) synth(b, t, d, f, .9, 0, { wave: 'square', voices: 2, detune: 18, cutoff: 1300, a: .005, d: .2, s: .8, r: .05 }); } },
  buzzer: { seconds: .9, peak: -3, synth: b => { synth(b, 0, .75, 110, 1, 0, { wave: 'saw', voices: 3, detune: 30, cutoff: 2400, res: .2, a: .005, s: 1, r: .05 }); synth(b, 0, .75, 165, .6, 0, { wave: 'square', cutoff: 2000, a: .005, s: 1, r: .05 }); } },
  drumroll: { seconds: 2.5, peak: -3, el: 'Snare drum roll building suspense, steady crescendo, no cymbal at the end, dry studio recording' },
  reveal: { seconds: 1.8, peak: -2, stereo: true, wet: .3, synth: b => { sweep(b, 0, .4, k => 500 * 12 ** k, k => k ** 2, 1, 1.4); for (const f of ['C5', 'E5', 'G5', 'C6']) brass(b, .4, .7, n(f), .8); bell(b, .4, n('C7'), .5, 1.2, .3); bell(b, .45, n('G7'), .3, 1, -.3); crash(b, .4, .7, 0, 1); } },
  applause: { seconds: 3, peak: -3, el: 'Studio audience applause, enthusiastic clapping from a medium crowd at a TV game show, no music, no voices' },
  cheer: { seconds: 3, peak: -3, el: 'Excited studio audience cheering and whooping with applause, game show winner moment, no music' },
  laugh: { seconds: 2.5, peak: -3, el: 'Studio audience bursting into big hearty laughter, sitcom crowd laughing, no music' },
  gasp: { seconds: 1.2, peak: -3, el: 'Studio audience collective shocked gasp, short, crowd of people' },
  boo: { seconds: 2.5, peak: -3, el: 'Playful studio audience booing, comedic crowd boo at a game show, no music' },
  aww: { seconds: 2, peak: -3, el: 'Studio audience sympathetic disappointed awww, crowd sighing together, short' },
  ooh: { seconds: 2, peak: -3, el: 'Studio audience impressed ooooh, crowd reaction rising in pitch, short' },
  fanfare: { seconds: 2.2, peak: -2, wet: .3, synth: b => {
    [['G4', 0], ['C5', .13], ['E5', .26]].forEach(([f, t]) => brass(b, t as number, .1, n(f as string), .9));
    for (const f of ['G5', 'E5', 'C5']) brass(b, .4, 1.1, n(f), .85); for (const f of ['C4', 'G4']) strings(b, .4, 1.1, n(f), .6, 0, .02);
    timpani(b, .4, .8, n('C3')); crash(b, .4, .6, .2, 1.2);
  } },
  win: { seconds: 1.6, peak: -2, stereo: true, wet: .25, synth: b => { ['C5', 'E5', 'G5', 'C6', 'E6'].forEach((f, k) => { mallet(b, k * .07, .3, n(f), .8, k / 4 - .5, 'marimba'); bell(b, k * .07, n(f) * 2, .3, .4, k / 4 - .5); }); for (const f of ['C6', 'E6', 'G6']) bell(b, .38, n(f), .5, 1.1); for (const f of ['C5', 'G5']) brass(b, .38, .5, n(f), .6); } },
  lose: { seconds: 2.5, peak: -2, el: 'Sad trombone, wah wah wah waaah, comedic failure sound, solo trombone, no other instruments' },
  'score-up': { seconds: .5, peak: -5, synth: b => { ['C6', 'E6', 'G6', 'C7'].forEach((f, k) => { tone(b, k * .05, .09, n(f), n(f), .45, 'square', .05); tone(b, k * .05, .2, n(f), n(f), .35, 'sine', .08); }); } },
  coin: { seconds: .5, peak: -5, synth: b => { tone(b, 0, .07, n('B5'), n('B5'), .5, 'square', 1); tone(b, .07, .4, n('E6'), n('E6'), .5, 'square', .15); } },
  vote: { seconds: .4, peak: -5, synth: b => { tone(b, 0, .08, 420, 900, .6, 'sine', .05); mallet(b, .03, .25, n('D6'), .7, 0, 'marimba'); kick(b, 0, .25, { f0: 200, f1: 90, decay: .05, click: .1 }); } },
  join: { seconds: .8, peak: -4, wet: .2, synth: b => { for (const [t, f] of [[0, 'G5'], [.09, 'D6']] as const) { mallet(b, t, .4, n(f), .8, 0, 'marimba'); bell(b, t, n(f) * 2, .3, .5); } } },
  slide: { seconds: .35, peak: -6, synth: b => sweep(b, 0, .3, k => 3200 - 1800 * k, k => Math.min(1, k / .15) * (1 - k) ** 1.5, 2, .8) },
  stamp: { seconds: .45, peak: -3, synth: b => { kick(b, 0, 1, { f0: 190, f1: 55, decay: .09, click: .6 }); sweep(b, 0, .08, () => 900, k => 1 - k, 1.5, .7); clap(b, .005, .35); } },
  sparkle: { seconds: 1.3, peak: -5, stereo: true, wet: .3, synth: b => { const r = rng(5), scale = ['C7', 'D7', 'E7', 'G7', 'A7', 'C8']; for (let k = 0; k < 10; k++) bell(b, k * .055, n(scale[Math.floor(r() * scale.length)]), .35 + r() * .2, .5, r() * 1.4 - .7); } },
  boing: { seconds: .8, peak: -3, synth: b => {
    let ph = 0; for (let i = 0; i < .7 * SR; i++) { const s = i / SR, f = (180 + 220 * (1 - Math.exp(-s / .15))) * (1 + .35 * Math.sin(TAU * 13 * s) * Math.exp(-s / .25)); ph += f / SR; const v = Math.sin(TAU * ph) * Math.exp(-s / .22) * .5; b.l[i] += v; b.r[i] += v; }
    pluck(b, 0, .5, 82, .7, 0, { bright: .9, decay: .4 });
  } },
  splat: { seconds: 1, peak: -2, el: 'Wet cartoon splat, a cream pie hitting a face, comedic' },
  scribble: { seconds: 1.5, peak: -4, el: 'Marker pen scribbling quickly on paper, close up' },
  camera: { seconds: 1, peak: -3, el: 'Camera shutter click with a flash, single photo snapshot' },
  spooky: { seconds: 2, peak: -3, el: 'Playful spooky ghost moan with an eerie theremin wail, Halloween haunted house' },
  thunder: { seconds: 2.5, peak: -2, el: 'Loud thunder crack with a rolling rumble, dramatic' },
  heartbeat: { seconds: .9, peak: -2, synth: b => { kick(b, 0, 1, { f0: 75, f1: 38, decay: .12, click: .05 }); kick(b, .26, .7, { f0: 70, f1: 36, decay: .14, click: .03 }); biquad(b.l, 'lp', 300); biquad(b.r, 'lp', 300); } },
  alarm: { seconds: 1.1, peak: -4, synth: b => { for (let k = 0; k < 8; k++) synth(b, k * .13, .12, k % 2 ? 720 : 960, .8, 0, { wave: 'square', cutoff: 3200, a: .003, s: 1, r: .01 }); } },
  bell: { seconds: 1.8, peak: -3, wet: .15, synth: b => { for (const t of [0, .3]) { for (const [ratio, amp, dec] of [[1, 1, .9], [2.4, .6, .6], [3.9, .4, .35], [5.6, .25, .2], [7.1, .15, .12]]) tone(b, t, 1.5, 1180 * ratio, 1180 * ratio, amp * .7, 'sine', dec); sweep(b, t, .01, () => 5000, () => 1, .5); } } },
  gong: { seconds: 2.5, peak: -2, el: 'Large orchestral gong hit with a long shimmering resonance' },
  kazoo: { seconds: 1.5, peak: -3, el: 'Silly kazoo playing a short comedic toot, novelty' },
  'record-scratch': { seconds: 1, peak: -3, el: 'Vinyl record scratch, abrupt stop, comedic' },
  rimshot: { seconds: 1.3, peak: -2, wet: .1, synth: b => { snare(b, 0, .8, 0, { tone: 230 }); tom(b, .14, .8, 115); kick(b, .14, .6); crash(b, .38, .8, 0, .55); hat(b, .38, .5, 0, .3); } },
  airhorn: { seconds: 1.5, peak: -3, el: 'Air horn blast, two short honks then one long honk, party celebration' },
  typewriter: { seconds: 1.5, peak: -4, el: 'Fast mechanical typewriter typing, loud clacking keys, close up, ending with a small bell ding' },
  glitch: { seconds: .6, peak: -4, synth: b => { const r = rng(7); for (let k = 0; k < 9; k++) { const t = k * .055; if (r() < .5) chipNoise(b, t, .9, .04, 2000 + r() * 12000, r() < .5); else tone(b, t, .045, 200 + r() * 2500, 200 + r() * 2500, .5, 'square', 1); } } },
  crash: { seconds: 1.5, peak: -2, el: 'Comedic crash of pots, pans and junk falling over, cartoon slapstick' },
  sting: { seconds: 2.2, peak: -2, wet: .3, synth: b => {
    for (const [t, d, notes] of [[0, .18, ['C3', 'G3']], [.28, .18, ['C3', 'G3']], [.56, 1.3, ['F#3', 'C4', 'D#4']]] as const) for (const f of notes) { brass(b, t, d, n(f), .9); strings(b, t, d, n(f) / 2, .6, 0, .01); }
    timpani(b, 0, .6, n('C2')); timpani(b, .28, .6, n('C2')); timpani(b, .56, 1, n('F#2'));
  } },
};

/* ── processing ────────────────────────────────────────────────────────── */
/** Trims leading/trailing silence, fades the tail, peak-normalises and writes an mp3 (mono unless the channels differ). */
function encode(id: string, l: Float32Array, r: Float32Array, spec: Spec) {
  let peak = 0; for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
  if (!peak) throw Error(`${id} is silent`);
  // Start at the first sample above -50 dB of peak; end after the last 10 ms window whose RMS is above -50 dB.
  const w = Math.round(.01 * SR), floor = peak * .003, start = Math.max(0, l.findIndex((x, i) => Math.max(Math.abs(x), Math.abs(r[i])) > floor) - Math.round(.003 * SR));
  let end = l.length;
  for (; end > start + w; end -= w) { let e = 0; for (let i = end - w; i < end; i++) e += l[i] * l[i] + r[i] * r[i]; if (Math.sqrt(e / w / 2) > floor) break; }
  end = Math.min(l.length, end + Math.round(.02 * SR), start + Math.round(spec.seconds * 1.15 * SR));
  const len = end - start, fade = Math.min(Math.round(.04 * SR), len >> 2), g = 10 ** ((spec.peak ?? -1) / 20) / peak, o = bus(len);
  let side = 0;
  for (let i = 0; i < len; i++) { const e = (i < 64 ? i / 64 : 1) * (i > len - fade ? (len - i) / fade : 1) * g; o.l[i] = l[start + i] * e; o.r[i] = r[start + i] * e; side = Math.max(side, Math.abs(o.l[i] - o.r[i])); }
  const tmp = join(out, `${id}.wav`), stereo = spec.stereo || side > .05;
  writeFileSync(tmp, wav(o));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-ac', stereo ? '2' : '1', '-codec:a', 'libmp3lame', '-b:a', stereo ? '128k' : '96k', join(out, `${id}.mp3`)]); rmSync(tmp);
  return len / SR;
}
function decode(mp3: Buffer) {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '2', '-ar', String(SR), 'pipe:1'], { input: mp3, maxBuffer: 64 << 20 });
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength >> 2), l = new Float32Array(all.length >> 1), r = new Float32Array(all.length >> 1);
  for (let i = 0; i < l.length; i++) { l[i] = all[2 * i]; r[i] = all[2 * i + 1]; }
  return { l, r };
}

const args = process.argv.slice(2), dry = args.includes('--dry-run'), only = args.filter(a => !a.startsWith('--'));
for (const id of only) if (!(SFX_IDS as readonly string[]).includes(id)) throw Error(`Unknown SFX id ${id}`);
mkdirSync(out, { recursive: true }); mkdirSync(cache, { recursive: true });
const todo = SFX_IDS.filter(id => (!only.length || only.includes(id)) && !existsSync(join(out, `${id}.mp3`)));
const prior = spentBy('sfx'), el = todo.filter(id => 'el' in SFX[id] && !existsSync(join(cache, `${id}.mp3`))), elSeconds = el.reduce((s, id) => s + SFX[id].seconds, 0);
console.log(`${todo.length} to build (${el.length} from ElevenLabs, ${elSeconds.toFixed(1)} s ≈ ${Math.ceil(elSeconds * 10)} credits at 10/s); ${prior} of ${CAP} SFX credits already spent.`);
if (dry) process.exit(0);
const api = el.length ? client('sfx', CAP, prior) : null;
let rate = 10; // credits per second, raised to the highest rate actually observed
for (const id of todo) {
  const spec = SFX[id];
  if ('el' in spec) {
    const raw = join(cache, `${id}.mp3`), before = api?.spent ?? 0;
    if (!existsSync(raw)) {
      writeFileSync(raw, await api!.post('/v1/sound-generation?output_format=mp3_44100_128', { text: spec.el, duration_seconds: spec.seconds, prompt_influence: spec.influence ?? .45 }, Math.ceil(spec.seconds * rate), `sfx/${id}`));
      rate = Math.max(rate, (api!.spent - before) / spec.seconds);
    }
    const { l, r } = decode(readFileSync(raw));
    console.log(`${id}: ElevenLabs (${(api?.spent ?? 0) - before} credits this run) → ${encode(id, l, r, spec).toFixed(2)} s`);
  } else {
    const b = bus(Math.round((spec.seconds + 1) * SR)); spec.synth(b);
    if (spec.wet) { const w = reverb(b, .7, .4, spec.wet); for (let i = 0; i < b.l.length; i++) { b.l[i] += w.l[i]; b.r[i] += w.r[i]; } }
    console.log(`${id}: synth → ${encode(id, b.l, b.r, spec).toFixed(2)} s`);
  }
}
if (api) console.log(`SFX credits spent: ${api.spent} of ${CAP} (ledger: output/secrets/el-ledger.json)`);
