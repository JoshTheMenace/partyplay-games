/** Small WebAudio voice kit. Times are seconds relative to the sound's start; peaks are pre-master. */
export type Filter = [type: BiquadFilterType, hz: number, q?: number];
export type ToneOptions = { to?: number; attack?: number; filter?: Filter };
export type NoiseOptions = { attack?: number; sweepTo?: number };

export type Synth = {
  tone(
    type: OscillatorType, hz: number, at: number, len: number, peak: number, o?: ToneOptions,
  ): OscillatorNode;
  noise(at: number, len: number, peak: number, filter: Filter, o?: NoiseOptions): void;
  /** Vibrato: an oscillator at `rate` Hz swinging `param` by ±`depth`. */
  lfo(param: AudioParam, rate: number, depth: number, at: number, len: number): void;
};

/** Hard cap on live sources so a backlog can never pile up into mush. */
export const MAX_VOICES = 48;

export function noiseBuffer(ctx: BaseAudioContext) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), data = buffer.getChannelData(0);
  let seed = 917;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = seed / 2147483648 - 1;
  }
  return buffer;
}

/** A synth whose times start at absolute context time `start`, scaled by `level`. */
export function synth(
  ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, start: number, level: number,
  live: Set<AudioScheduledSourceNode>,
): Synth {
  const run = (source: AudioScheduledSourceNode, chain: AudioNode[], at: number, len: number) => {
    if (live.size >= MAX_VOICES) return;
    live.add(source);
    [source, ...chain].reduce((from, to) => from.connect(to));
    chain[chain.length - 1].connect(out);
    source.onended = () => { live.delete(source); for (const node of [source, ...chain]) node.disconnect(); };
    source.start(start + at);
    source.stop(start + at + len + 0.03);
  };
  // Soft linear attack, then an exponential tail: plucked and struck, never a square gate.
  const envelope = (at: number, len: number, peak: number, attack = 0.004) => {
    const gain = ctx.createGain(), t = start + at;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak * level, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(len, attack + 0.01));
    return gain;
  };
  const filter = ([type, hz, q = 0.7]: Filter) => {
    const node = ctx.createBiquadFilter();
    node.type = type; node.frequency.value = hz; node.Q.value = q;
    return node;
  };
  return {
    tone(type, hz, at, len, peak, o = {}) {
      const osc = ctx.createOscillator(), t = start + at;
      osc.type = type;
      osc.frequency.setValueAtTime(hz, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + len);
      const chain = [...(o.filter ? [filter(o.filter)] : []), envelope(at, len, peak, o.attack)];
      run(osc, chain, at, len);
      return osc;
    },
    noise(at, len, peak, spec, o = {}) {
      const source = ctx.createBufferSource(), band = filter(spec), t = start + at;
      source.buffer = noise;
      if (o.sweepTo) band.frequency.exponentialRampToValueAtTime(o.sweepTo, t + len);
      run(source, [band, envelope(at, len, peak, o.attack)], at, len);
    },
    lfo(param, rate, depth, at, len) {
      if (live.size >= MAX_VOICES) return;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = rate; gain.gain.value = depth;
      osc.connect(gain).connect(param);
      live.add(osc);
      osc.onended = () => { live.delete(osc); osc.disconnect(); gain.disconnect(); };
      osc.start(start + at);
      osc.stop(start + at + len + 0.03);
    },
  };
}
