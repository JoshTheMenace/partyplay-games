/** Tiny synthesized TV effects. Follows the shell's shared mute preference and never throws. */
export type Sfx = 'flick' | 'thud' | 'chime' | 'alarm' | 'swish';
let context: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem('party.sound.muted') === 'true'; } catch { return false; } })();
const onPreference = (event: Event) => { muted = !!(event as CustomEvent<{ muted: boolean }>).detail?.muted; };
if (typeof window !== 'undefined') window.addEventListener('party-sound', onPreference);

function tone(ctx: AudioContext, at: number, type: OscillatorType, from: number, to: number, length: number, gain: number) {
  const osc = ctx.createOscillator(), amp = ctx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(from, at); osc.frequency.exponentialRampToValueAtTime(to, at + length);
  amp.gain.setValueAtTime(gain, at); amp.gain.exponentialRampToValueAtTime(.0001, at + length);
  osc.connect(amp).connect(ctx.destination); osc.start(at); osc.stop(at + length + .02);
}
function noise(ctx: AudioContext, at: number, length: number, gain: number, hz: number) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate), data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain();
  source.buffer = buffer; filter.type = 'bandpass'; filter.frequency.value = hz; amp.gain.value = gain;
  source.connect(filter).connect(amp).connect(ctx.destination); source.start(at);
}
/** n raises the thud's pitch with the penalty size. */
export function play(kind: Sfx, n = 0) {
  if (muted || typeof AudioContext === 'undefined') return;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const t = context.currentTime + .01;
    if (kind === 'flick') noise(context, t, .09, .5, 2600);
    if (kind === 'swish') noise(context, t, .28, .3, 900);
    if (kind === 'thud') { tone(context, t, 'sine', 150 + 12 * Math.min(n, 16), 48, .3, .5); noise(context, t, .08, .25, 400); }
    if (kind === 'chime') [880, 1320, 1760].forEach((hz, i) => tone(context!, t + i * .07, 'triangle', hz, hz * .995, .6, .16));
    if (kind === 'alarm') [0, .13].forEach(d => tone(context!, t + d, 'square', 520, 380, .12, .07));
  } catch { /* Audio is optional. */ }
}
export function disposeSfx() { void context?.close().catch(() => {}); context = null; }
