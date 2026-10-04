/**
 * Builds the Trolley Court SFX library at public/games/trolley-court/sfx/<id>.mp3: organic sounds from ElevenLabs sound
 * generation, tiny UI blips synthesised here. Existing files are skipped (delete one to rebuild it). Every file is trimmed,
 * faded and peak-normalised. Raw ElevenLabs downloads are cached in output/trolley-court-sfx/ (git-ignored), so deleting a
 * public file reprocesses it for free; delete the cached file too to pay for a new take. Spend for the whole library is
 * capped at --cap (default CAP) credits across runs, recorded as tool `trolley-court-sfx`.
 * Usage (platform root): node --import tsx packages/games/trolley-court/tools/sfx.ts [--dry-run] [--cap <credits>] [id…]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SFX_IDS, type SfxId } from '../src/types';
import { client, spentBy } from './elevenlabs';

const TOOL = 'trolley-court-sfx', CAP = 600, SR = 44100, TAU = 2 * Math.PI;
const out = join(import.meta.dirname, '../../../../public/games/trolley-court/sfx'), cache = join(process.cwd(), 'output/trolley-court-sfx');
/** el: ElevenLabs prompt, or synth: a mono design. seconds bounds the result; peak is the normalised peak in dBFS. */
type Spec = { seconds: number; peak?: number } & ({ el: string; influence?: number } | { synth: (b: Float32Array) => void });

/** An oscillator gliding exponentially f0 → f1 with a fast attack and exponential decay. */
function tone(b: Float32Array, t: number, dur: number, f0: number, f1: number, vel: number, wave: 'sine' | 'tri' | 'square' = 'sine', decay = dur / 3) {
  let ph = 0;
  for (let i = 0, i0 = Math.round(t * SR), n = Math.round(dur * SR); i < n && i0 + i < b.length; i++) {
    const s = i / SR; ph = (ph + f0 * (f1 / f0) ** (s / dur) / SR) % 1;
    const y = wave === 'sine' ? Math.sin(TAU * ph) : wave === 'tri' ? 4 * Math.abs(ph - .5) - 1 : ph < .5 ? .6 : -.6;
    b[i0 + i] += y * Math.min(1, s / .003) * Math.exp(-s / decay) * Math.min(1, (dur - s) / .008) * vel * .5;
  }
}
/** A short filtered noise click (one-pole high-pass of white noise). */
function click(b: Float32Array, t: number, dur: number, vel: number) {
  let prev = 0;
  for (let i = 0, i0 = Math.round(t * SR), n = Math.round(dur * SR); i < n && i0 + i < b.length; i++) { const x = Math.random() * 2 - 1; b[i0 + i] += (x - prev) * vel * (1 - i / n) ** 3; prev = x; }
}

const SFX: Record<SfxId, Spec> = {
  tap: { seconds: .12, peak: -10, synth: b => { tone(b, 0, .06, 1500, 1100, .8, 'tri', .02); click(b, 0, .01, .3); } },
  lock: { seconds: .4, peak: -5, synth: b => { tone(b, 0, .08, 300, 110, .9, 'sine', .04); click(b, 0, .02, .6); tone(b, .05, .3, 1047, 1047, .35, 'tri', .08); tone(b, .05, .3, 1568, 1568, .2, 'sine', .1); } },
  'all-locked': { seconds: .9, peak: -5, synth: b => { for (const [t, f] of [[0, 784], [.09, 988], [.18, 1175], [.27, 1568]]) { tone(b, t, .6, f, f, .5, 'tri', .18); tone(b, t, .6, f * 2, f * 2, .15, 'sine', .1); } } },
  tick: { seconds: .1, peak: -8, synth: b => { tone(b, 0, .05, 2200, 1700, .7, 'sine', .012); click(b, 0, .008, .5); } },
  deal: { seconds: 1.5, el: 'Playing cards being shuffled then dealt quickly onto a wooden table, a few crisp card snaps, close up, dry' },
  flip: { seconds: .7, peak: -4, el: 'A single playing card flipped over and slapped down on a table, crisp snap, close up, dry' },
  reveal: { seconds: 1.8, peak: -2, el: 'Short dramatic orchestral stinger, brass and timpani hit, courtroom drama reveal, comedic TV game show' },
  stamp: { seconds: .8, peak: -3, el: 'Rubber stamp thumped hard onto paper on a wooden desk, single stamp, office, dry' },
  hurry: { seconds: 1.5, peak: -4, el: 'Old steam train whistle, two short toots, cartoonish, distant station' },
  timeup: { seconds: 1.2, peak: -4, el: 'Game show time up buzzer, loud short electronic buzz, comedic' },
  gavel: { seconds: 1.2, peak: -2, el: 'Wooden judge gavel banging twice on a sound block in a courtroom, sharp, with slight room echo' },
  lever: { seconds: 1.2, peak: -3, el: 'Heavy iron railway lever pulled with a metal clunk, then the track switch points sliding and locking with a clack' },
  bell: { seconds: 1.6, peak: -4, el: 'Old tram trolley bell, ding ding, brass bell clanging twice, cheerful' },
  rumble: { seconds: 3, peak: -3, el: 'Small trolley cart rolling fast along railway tracks, rattling wheels clacking over rail joints, approaching and getting louder' },
  crash: { seconds: 2, peak: -2, el: 'Cartoon slapstick crash, a rattling trolley smashing through wooden crates and tin cans, boing and clatter, comedic, no voices' },
  gasp: { seconds: 1.2, peak: -3, el: 'Courtroom audience collective shocked gasp, short, crowd of people' },
  aww: { seconds: 2, peak: -3, el: 'Courtroom audience sympathetic disappointed awww, crowd sighing together, short' },
  cheer: { seconds: 3, peak: -3, el: 'Audience cheering and applauding, celebration at the end of a game show, whoops, no music' },
  drumroll: { seconds: 2.5, peak: -3, el: 'Snare drum roll building suspense, steady crescendo, no cymbal at the end, dry studio recording' },
  whoosh: { seconds: .7, peak: -4, el: 'Quick cartoon whoosh, something small zipping past fast, airy swish' },
};

/** Trims silence, fades the tail, peak-normalises and writes a mono mp3. Returns the length in seconds. */
function encode(id: SfxId, x: Float32Array, spec: Spec) {
  const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (!peak) throw Error(`${id} is silent`);
  // Start just before the first sample above -50 dB of peak; end after the last 10 ms window whose RMS clears it.
  const w = Math.round(.01 * SR), floor = peak * .003, start = Math.max(0, x.findIndex(v => Math.abs(v) > floor) - Math.round(.003 * SR));
  let end = x.length;
  for (; end > start + w; end -= w) { let e = 0; for (let i = end - w; i < end; i++) e += x[i] * x[i]; if (Math.sqrt(e / w) > floor) break; }
  end = Math.min(x.length, end + Math.round(.02 * SR), start + Math.round(spec.seconds * 1.15 * SR));
  const len = end - start, fade = Math.min(Math.round(.04 * SR), len >> 2), g = 10 ** ((spec.peak ?? -1) / 20) / peak, o = new Float32Array(len);
  for (let i = 0; i < len; i++) o[i] = x[start + i] * g * (i < 64 ? i / 64 : 1) * (i > len - fade ? (len - i) / fade : 1);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', '96k', join(out, `${id}.mp3`)], { input: Buffer.from(o.buffer) });
  return len / SR;
}
const decode = (mp3: Buffer) => { const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', String(SR), 'pipe:1'], { input: mp3, maxBuffer: 64 << 20 }); return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength >> 2); };

const args = process.argv.slice(2), dry = args.includes('--dry-run'), capAt = args.indexOf('--cap'), cap = capAt < 0 ? CAP : Number(args[capAt + 1]);
const only = args.filter((a, i) => !a.startsWith('--') && i !== capAt + 1);
if (!(cap >= 0)) throw Error('--cap needs a number of credits.');
for (const id of only) if (!(SFX_IDS as readonly string[]).includes(id)) throw Error(`Unknown SFX id ${id}`);
mkdirSync(out, { recursive: true }); mkdirSync(cache, { recursive: true });
const todo = SFX_IDS.filter(id => (!only.length || only.includes(id)) && !existsSync(join(out, `${id}.mp3`)));
const prior = spentBy(TOOL), el = todo.filter(id => 'el' in SFX[id] && !existsSync(join(cache, `${id}.mp3`))), elSeconds = el.reduce((s, id) => s + SFX[id].seconds, 0);
console.log(`${todo.length} to build (${el.length} from ElevenLabs, ${elSeconds.toFixed(1)} s ≈ ${Math.ceil(elSeconds * 10)} credits at 10/s); ${prior} of ${cap} SFX credits already spent.`);
if (dry) process.exit(0);
const api = el.length ? client(TOOL, cap, prior) : null;
let rate = 10; // credits per second, raised to the highest rate actually observed
for (const id of todo) {
  const spec = SFX[id];
  if ('el' in spec) {
    const raw = join(cache, `${id}.mp3`), before = api?.spent ?? 0;
    if (!existsSync(raw)) {
      writeFileSync(raw, await api!.post('/v1/sound-generation?output_format=mp3_44100_128', { text: spec.el, duration_seconds: Math.max(.5, spec.seconds), prompt_influence: spec.influence ?? .45 }, Math.ceil(Math.max(.5, spec.seconds) * rate), `sfx/${id}`));
      rate = Math.max(rate, (api!.spent - before) / spec.seconds);
    }
    console.log(`${id}: ElevenLabs (${(api?.spent ?? 0) - before} credits this run) → ${encode(id, decode(readFileSync(raw)), spec).toFixed(2)} s`);
  } else {
    const b = new Float32Array(Math.round((spec.seconds + .5) * SR)); spec.synth(b);
    console.log(`${id}: synth → ${encode(id, b, spec).toFixed(2)} s`);
  }
}
if (api) console.log(`SFX credits spent: ${api.spent} of ${cap} (ledger: output/secrets/el-ledger.json)`);
