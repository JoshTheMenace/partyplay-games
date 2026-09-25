/** Original synthesized combat cues. Silent until the shell has unlocked audio through a user gesture; honors the shell's stored mute preference. */
import { useEffect, useRef } from 'react';
import type { CombatEvent, Projectile, PublicView, WeaponKind } from '../contracts';

export type Cue = WeaponKind | 'hit' | 'bigHit' | 'shield' | 'miss' | 'intercept' | 'explode' | 'teleport' | 'alarm' | 'phase' | 'repair' | 'cloak' | 'warp';
type Tone = [type: OscillatorType, from: number, to: number, ms: number, gain: number, delay?: number];
type Hiss = [filter: BiquadFilterType, from: number, to: number, ms: number, gain: number, delay?: number];
const CUES: Record<Cue, { tones?: Tone[]; noise?: Hiss[] }> = {
  laser: { tones: [['square', 1500, 240, 150, .07], ['triangle', 760, 190, 120, .08]] },
  missile: { tones: [['sine', 190, 80, 320, .16]], noise: [['bandpass', 1100, 260, 520, .22]] },
  beam: { tones: [['sawtooth', 210, 520, 700, .05], ['sine', 440, 700, 700, .07]], noise: [['bandpass', 2400, 1200, 600, .05]] },
  ion: { tones: [['sine', 620, 1250, 260, .11], ['square', 1900, 2600, 70, .03, 40], ['square', 2100, 2800, 70, .03, 130]] },
  flak: { noise: [['lowpass', 2400, 400, 90, .3], ['lowpass', 2200, 400, 90, .26, 70], ['lowpass', 2000, 400, 90, .24, 140]] },
  support: { tones: [['triangle', 660, 660, 90, .08], ['triangle', 880, 880, 90, .08, 70], ['triangle', 1170, 1170, 140, .08, 140]] },
  hit: { tones: [['sine', 130, 40, 300, .3]], noise: [['lowpass', 1900, 180, 360, .34]] },
  bigHit: { tones: [['sine', 90, 28, 700, .45]], noise: [['lowpass', 1600, 90, 800, .5]] },
  shield: { tones: [['sine', 900, 1350, 240, .1], ['triangle', 1360, 1900, 200, .05]], noise: [['bandpass', 3200, 2400, 160, .08]] },
  miss: { noise: [['highpass', 1600, 3200, 260, .06]] },
  intercept: { tones: [['square', 2100, 900, 60, .04], ['square', 2100, 900, 60, .04, 70], ['square', 2100, 900, 60, .04, 140]], noise: [['lowpass', 2600, 300, 200, .18, 140]] },
  explode: { tones: [['sine', 72, 24, 1400, .55]], noise: [['lowpass', 1300, 70, 1700, .6], ['lowpass', 900, 60, 1200, .4, 260]] },
  teleport: { tones: [['sine', 300, 1200, 600, .1], ['sine', 450, 1800, 600, .07, 60]] },
  alarm: { tones: [['square', 720, 720, 120, .05], ['square', 540, 540, 120, .05, 140], ['square', 720, 720, 120, .05, 280], ['square', 540, 540, 120, .05, 420]] },
  phase: { tones: [['sawtooth', 110, 52, 1300, .16], ['sine', 55, 40, 1300, .3]], noise: [['lowpass', 900, 100, 1000, .3]] },
  repair: { tones: [['triangle', 523, 523, 110, .08], ['triangle', 659, 659, 110, .08, 90], ['triangle', 784, 784, 180, .08, 180]] },
  cloak: { tones: [['sine', 1300, 280, 520, .08]], noise: [['highpass', 4000, 1500, 500, .05]] },
  warp: { tones: [['sine', 180, 900, 650, .1]], noise: [['bandpass', 300, 3200, 650, .12]] },
};
const ALARMS = new Set<CombatEvent['type']>(['fire', 'breach', 'system-down']);
const CUE: Partial<Record<CombatEvent['type'], Cue>> = { shield: 'shield', miss: 'miss', intercept: 'intercept', explode: 'explode', teleport: 'teleport', phase: 'phase', repair: 'repair', heal: 'repair', cloak: 'cloak', flee: 'warp' };
const hitCue = (e: CombatEvent): Cue => (e.amount ?? 1) >= 3 ? 'bigHit' : 'hit';

export class StarshipAudio {
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private noise: AudioBuffer | null = null;
  private seen = new Set<string>();
  private primed = false;
  private last = new Map<Cue, number>();
  private voices = 0;
  private cleanup: (() => void)[] = [];
  constructor(private volume = .7) {
    if (typeof window === 'undefined') return;
    const unlock = () => this.unlock();
    for (const type of ['pointerdown', 'keydown', 'party-sound']) { window.addEventListener(type, unlock, true); this.cleanup.push(() => window.removeEventListener(type, unlock, true)); }
    if (navigator.userActivation?.hasBeenActive) this.unlock();
  }
  private muted() { try { return localStorage.getItem('party.sound.muted') === 'true'; } catch { return false; } }
  private unlock() {
    if (this.muted() || typeof AudioContext === 'undefined') return;
    try {
      if (!this.ctx) {
        const ctx = this.ctx = new AudioContext(), comp = ctx.createDynamicsCompressor(), gain = ctx.createGain(); gain.gain.value = this.volume; gain.connect(comp).connect(ctx.destination); this.out = gain;
        const buf = this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
    } catch { /* audio is optional */ }
  }
  play(cue: Cue) {
    const ctx = this.ctx, out = this.out, spec = CUES[cue];
    if (!ctx || !out || ctx.state !== 'running' || this.muted() || this.voices > 28) return;
    const now = ctx.currentTime, ms = performance.now(); if (ms - (this.last.get(cue) ?? -1e9) < 45) return; this.last.set(cue, ms);
    const env = (node: AudioNode, gain: number, start: number, dur: number) => { const g = ctx.createGain(); g.gain.setValueAtTime(.0001, start); g.gain.exponentialRampToValueAtTime(gain, start + .008); g.gain.exponentialRampToValueAtTime(.0001, start + dur); node.connect(g).connect(out); };
    const track = (src: AudioScheduledSourceNode, start: number, dur: number) => { this.voices++; src.onended = () => this.voices--; src.start(start); src.stop(start + dur + .02); };
    try {
      for (const [type, from, to, dur, gain, delay = 0] of spec.tones ?? []) { const t = now + delay / 1000, d = dur / 1000, o = ctx.createOscillator();
        o.type = type; o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + d); env(o, gain, t, d); track(o, t, d); }
      for (const [type, from, to, dur, gain, delay = 0] of spec.noise ?? []) { const t = now + delay / 1000, d = dur / 1000, src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
        src.buffer = this.noise; src.loop = true; f.type = type; f.Q.value = type === 'bandpass' ? 2.2 : .7; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + d);
        src.connect(f); env(f, gain, t, d); track(src, t, d); }
    } catch { /* audio is optional */ }
  }
  /**
   * Plays each new projectile launch and combat event once; whatever is present on the first update is skipped.
   * With `own` given (a phone, null without a ship) only that ship's own weapon fire and the hits it takes make a sound.
   */
  update(view: PublicView, own?: string | null) {
    const all: (Projectile | CombatEvent)[] = [...view.combat?.projectiles ?? [], ...view.combat?.events ?? []];
    for (const x of all) {
      if (this.seen.has(x.id)) continue; this.seen.add(x.id);
      if (!this.primed) continue;
      const cue = 'launchMs' in x ? (own === undefined || x.fromShipId === own ? x.kind : null) : own !== undefined ? (x.type === 'hit' && x.shipId === own ? hitCue(x) : null)
        : x.type === 'hit' ? hitCue(x) : ALARMS.has(x.type) ? (view.ships.find(s => s.id === x.shipId)?.faction === 'ally' ? 'alarm' : null) : CUE[x.type] ?? null;
      if (cue) this.play(cue);
    }
    this.primed = true; if (this.seen.size > 800) this.seen = new Set(all.map(x => x.id));
  }
  dispose() { for (const off of this.cleanup) off(); this.cleanup = []; void this.ctx?.close().catch(() => {}); this.ctx = this.out = null; }
}

/** One StarshipAudio per mounted battle view. The TV or host scene hears everything; a phone passes its ship id and a low volume. */
export function useCombatAudio(view: PublicView, own?: string | null, volume = .7) {
  const audio = useRef<StarshipAudio | null>(null);
  useEffect(() => { const a = audio.current = new StarshipAudio(volume); return () => { a.dispose(); audio.current = null; }; }, [volume]);
  useEffect(() => { audio.current?.update(view, own); }, [view, own]);
}
