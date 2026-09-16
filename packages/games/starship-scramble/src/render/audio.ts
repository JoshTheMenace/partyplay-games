import type { CombatEffect, PublicView } from '../contracts';
export type Cue = 'accept' | 'deny' | 'shieldDown' | 'boarding' | 'teleport' | 'repair' | 'danger' | 'destroyed' | 'collect';
const TONES: Record<Cue, { freq: number[]; type: OscillatorType; ms: number; gain: number }> = {
  accept: { freq: [660, 880], type: 'triangle', ms: 120, gain: .18 }, deny: { freq: [220, 160], type: 'square', ms: 160, gain: .12 },
  shieldDown: { freq: [520, 260], type: 'sawtooth', ms: 260, gain: .16 }, boarding: { freq: [330, 330, 440], type: 'square', ms: 320, gain: .14 },
  teleport: { freq: [440, 880, 1320], type: 'sine', ms: 360, gain: .16 }, repair: { freq: [523, 659, 784], type: 'triangle', ms: 260, gain: .14 },
  danger: { freq: [392, 311], type: 'sawtooth', ms: 420, gain: .14 }, destroyed: { freq: [200, 90, 50], type: 'sawtooth', ms: 700, gain: .22 }, collect: { freq: [784, 1046], type: 'triangle', ms: 140, gain: .16 },
};
/** Original synthesized cues. Silent until the shell has unlocked audio through a user gesture; honors the shell's stored mute preference. */
export class StarshipAudio {
  private context: AudioContext | null = null;
  private seen = new Set<string>();
  private muted() { try { return localStorage.getItem('party.sound.muted') === 'true'; } catch { return false; } }
  play(cue: Cue) {
    if (this.muted() || typeof AudioContext === 'undefined') return;
    try {
      this.context ??= new AudioContext(); if (this.context.state !== 'running') return;
      const { freq, type, ms, gain } = TONES[cue], now = this.context.currentTime, node = this.context.createGain(), osc = this.context.createOscillator();
      osc.type = type; freq.forEach((f, i) => osc.frequency.setValueAtTime(f, now + (ms / 1000) * i / freq.length));
      node.gain.setValueAtTime(gain, now); node.gain.exponentialRampToValueAtTime(.001, now + ms / 1000);
      osc.connect(node).connect(this.context.destination); osc.start(now); osc.stop(now + ms / 1000);
    } catch { /* audio is optional */ }
  }
  /** Maps new server effects to cues once each; ownShipId narrows danger cues to the listener's vessel on phones. */
  update(view: PublicView, ownShipId: string | null = null) {
    for (const effect of view.effects) {
      if (this.seen.has(effect.id)) continue; this.seen.add(effect.id);
      const mine = !ownShipId || effect.targetShipId === ownShipId || effect.sourceShipId === ownShipId;
      const cue = cueFor(effect); if (cue && mine) this.play(cue);
    }
    if (this.seen.size > 400) this.seen = new Set(view.effects.map(e => e.id));
  }
  dispose() { this.context?.close().catch(() => {}); this.context = null; }
}
export const cueFor = (effect: CombatEffect): Cue | null => effect.kind === 'shield' ? 'shieldDown' : effect.kind === 'teleport' ? 'teleport' : effect.kind === 'repair' ? 'repair' : effect.kind === 'destroyed' ? 'destroyed' : effect.kind === 'warning' ? (effect.text.toLowerCase().includes('board') ? 'boarding' : 'danger') : null;
