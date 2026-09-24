/* Which sounds a frame should play. Pure (no WebAudio), so the rules are unit-tested in Node.
 *
 * Inputs are the presented RaceView, the racers this device voices ("focus", each with a stereo pan)
 * and any new events. Events are deduplicated by id — snapshots resend recent events — and events
 * already present on the first view are treated as history, never replayed. Countdown beeps come from
 * race.time crossing −3/−2/−1/0, so they stay in time even if an event is late or missing. */
import { clamp } from '../sim/math';
import { HIT_KINDS, ITEM_IDS } from '../sim/items';
import type { KartState, RaceEvent, RaceEventType, RaceView } from '../sim/types';

export type AudioRole = 'display' | 'solo' | 'controller';
export type Focus = { id: string; pan: number };
/** The locally predicted kart: its state and the kart events its replay just produced (KartPredictor.takeEvents),
 * voiced at once instead of a round trip later. The server's copies of those events are then skipped. */
export type LocalKart = { id: string; kart: KartState; events: readonly { type: RaceEventType; t: number; value?: number }[] };
export type SoundId = 'countdown' | 'go' | 'tier' | 'mini-turbo' | 'boost-pad' | 'rocket-start' | 'stall' | 'slipstream' | 'trick' | 'wall' | 'bump'
  | 'pickup' | 'roulette-tick' | 'item-ready' | 'item' | 'hit' | 'hit-dealt' | 'shield-pop' | 'explode' | 'thunder' | 'comet' | 'lap' | 'final-lap'
  | 'finish' | 'respawn' | 'fall' | 'honk' | 'overtake' | 'ring' | 'spring' | 'bumper' | 'loop';
/** `value` meaning per sound: tier/mini-turbo → tier, item → item id, hit → hit kind, finish → rank, honk → character. */
export type Cue = { sound: SoundId; racer: string | null; value: number | string; pan: number; gain: number };

const PER_RACER: Partial<Record<RaceEvent['type'], SoundId>> = {
  'mini-turbo': 'mini-turbo', 'boost-pad': 'boost-pad', 'rocket-start': 'rocket-start', stall: 'stall', slipstream: 'slipstream', trick: 'trick',
  wall: 'wall', bump: 'bump', pickup: 'pickup', lap: 'lap', 'final-lap': 'final-lap', respawn: 'respawn', fall: 'fall', overtake: 'overtake', 'shield-pop': 'shield-pop',
  ring: 'ring', spring: 'spring', bumper: 'bumper', loop: 'loop',
};
/** Minimum seconds (race time) between two identical cues for the same racer. */
const REPEAT: Partial<Record<SoundId, number>> = { wall: .15, bump: .12, overtake: .5, pickup: .1, 'boost-pad': .2, ring: .15, spring: .3, bumper: .2, loop: 1 };
const COUNTDOWN_MARKS = [-3, -2, -1, 0];
/** Kart events prediction reproduces exactly; a server event within this many seconds of a predicted one is its echo. */
const PREDICTABLE = new Set<RaceEventType>(['mini-turbo', 'boost-pad', 'rocket-start', 'stall', 'slipstream', 'trick', 'wall', 'item', 'ring', 'spring', 'bumper', 'loop']), ECHO_WINDOW = .35;

type Memory = { tier: number; rollT: number; tickAt: number };

export class CueTracker {
  private lastEvent = -1;
  private primed = false;
  private lastTime: number | null = null;
  private memory = new Map<string, Memory>();
  private recent = new Map<string, number>();
  private globalFinal = false;
  private globalFinish = false;
  private predicted: { type: RaceEventType; t: number }[] = [];
  constructor(readonly role: AudioRole) {}

  reset() { this.lastEvent = -1; this.primed = false; this.lastTime = null; this.memory.clear(); this.recent.clear(); this.globalFinal = this.globalFinish = false; this.predicted = []; }

  frame(view: RaceView, focus: readonly Focus[], events: readonly RaceEvent[] = [], local?: LocalKart | null): Cue[] {
    if (view.serial < this.lastEvent || (this.lastTime !== null && view.time < this.lastTime - 2)) this.reset();   // a new race
    const cues: Cue[] = [], screen = this.role !== 'controller', spectator = screen && focus.length === 0;
    const push = (sound: SoundId, racer: string | null, value: number | string = 0, pan = 0, gain = 1) => {
      const gap = REPEAT[sound], key = `${sound}:${racer}`;
      if (gap !== undefined) { const last = this.recent.get(key); if (last !== undefined && Math.abs(view.time - last) < gap) return; this.recent.set(key, view.time); }
      cues.push({ sound, racer, value, pan, gain });
    };
    const find = (id: string | undefined) => id === undefined ? undefined : focus.find(f => f.id === id);
    const mine = local && screen ? find(local.id) : undefined;
    if (this.predicted.length) this.predicted = this.predicted.filter(p => p.t > view.time - 2);
    if (mine && local) for (const e of local.events) if (PREDICTABLE.has(e.type)) {
      this.predicted.push({ type: e.type, t: e.t });
      if (e.type === 'item') { const item = ITEM_IDS[e.value ?? -1]; if (item) push('item', local.id, item, mine.pan); }
      else push(PER_RACER[e.type]!, local.id, e.value ?? 0, mine.pan);
    }

    if (screen && this.lastTime !== null && view.phase !== 'results')
      for (const mark of COUNTDOWN_MARKS) if (this.lastTime < mark && view.time >= mark && view.time - mark < .35) push(mark === 0 ? 'go' : 'countdown', null);
    this.lastTime = view.time;

    // Events, oldest first, each once.
    const fresh = new Map<number, RaceEvent>();
    for (const e of events) if (e.id > this.lastEvent) fresh.set(e.id, e);
    for (const e of view.events) if (e.id > this.lastEvent) fresh.set(e.id, e);
    const ordered = [...fresh.values()].sort((a, b) => a.id - b.id);
    if (ordered.length) this.lastEvent = ordered.at(-1)!.id;
    if (!this.primed) { this.primed = true; ordered.length = 0; }
    for (const e of ordered) {
      if (mine && e.racer === local!.id && PREDICTABLE.has(e.type)) {           // already voiced by prediction?
        const echo = this.predicted.findIndex(p => p.type === e.type && Math.abs(p.t - e.t) < ECHO_WINDOW);
        if (echo >= 0) { this.predicted.splice(echo, 1); continue; }
      }
      const f = find(e.racer), other = find(e.other);
      if (!screen) {                                                    // phones in TV mode: only their own feedback
        if (!f) continue;
        if (e.type === 'honk') push('honk', e.racer, this.character(view, e.racer), 0, .8);
        else if (e.type === 'hit') push('hit', e.racer, HIT_KINDS[e.value ?? 0] ?? 'spin', 0, .7);
        else if (e.type === 'pickup') push('pickup', e.racer, 0, 0, .6);
        continue;
      }
      switch (e.type) {
        case 'honk': push('honk', e.racer, this.character(view, e.racer), f?.pan ?? 0, f ? 1 : .55); break;
        case 'hit':
          if (f) push('hit', e.racer, HIT_KINDS[e.value ?? 0] ?? 'spin', f.pan);
          else if (other) push('hit-dealt', e.other!, 0, other.pan);
          else if (spectator) push('hit', e.racer, HIT_KINDS[e.value ?? 0] ?? 'spin', 0, .5);
          break;
        case 'explode': case 'thunder': case 'comet': {
          const near = this.nearest(view, focus, e);
          push(e.type, e.racer, e.value ?? 0, near.pan, e.type === 'explode' ? near.gain : 1); break;
        }
        case 'item': {
          const item = ITEM_IDS[e.value ?? -1];
          if (f && item && item !== 'thunder' && item !== 'comet') push('item', e.racer, item, f.pan);
          break;
        }
        case 'finish':
          if (f) push('finish', e.racer, e.value ?? 9, f.pan);
          else if (spectator && !this.globalFinish) { this.globalFinish = true; push('finish', e.racer, 1, 0, .8); }
          break;
        case 'final-lap':
          if (f) push('final-lap', e.racer, 0, f.pan);
          else if (spectator && !this.globalFinal) { this.globalFinal = true; push('final-lap', e.racer, 0, 0, .8); }
          break;
        case 'bump':
          if (f) push('bump', e.racer, 0, f.pan); else if (other) push('bump', e.other!, 0, other.pan);
          break;
        default: { const sound = PER_RACER[e.type]; if (sound && f) push(sound, e.racer, e.value ?? 0, f.pan, e.type === 'shield-pop' && e.value === 1 ? .7 : 1); }
      }
    }

    // State changes that have no event: drift tier-ups and the item roulette.
    const live = new Set<string>();
    for (const fo of focus) {
      const r = view.racers.find(x => x.id === fo.id); if (!r) continue;
      live.add(r.id);
      const k = local?.id === r.id ? local.kart : r;                     // drift state from the predicted kart when there is one
      const m = this.memory.get(r.id) ?? { tier: k.driftTier, rollT: r.rollT, tickAt: view.time };
      if (screen && k.drift !== 0 && k.driftTier > m.tier) push('tier', r.id, k.driftTier, fo.pan);
      if (r.rollT > 0 && view.phase === 'racing') {
        if (view.time >= m.tickAt) { push('roulette-tick', r.id, 0, fo.pan, screen ? 1 : .7); m.tickAt = view.time + .045 + .11 * clamp(1 - r.rollT / 1.4, 0, 1) ** 2; }
      } else if (m.rollT > 0 && r.item) push('item-ready', r.id, r.item, fo.pan, screen ? 1 : .8);
      m.tier = k.drift !== 0 ? k.driftTier : 0; m.rollT = r.rollT; if (r.rollT <= 0) m.tickAt = view.time;
      this.memory.set(r.id, m);
    }
    for (const id of this.memory.keys()) if (!live.has(id)) this.memory.delete(id);
    return cues;
  }

  private character(view: RaceView, id: string) { return view.racers.find(r => r.id === id)?.character ?? 0; }
  /** Pan and loudness of a world event from the closest focused kart (full within 12 m, ¼ beyond ~150 m). */
  private nearest(view: RaceView, focus: readonly Focus[], e: RaceEvent) {
    if (e.x === undefined || e.z === undefined || !focus.length) return { pan: 0, gain: .8 };
    let best = { pan: 0, gain: .25, dist: Infinity };
    for (const f of focus) {
      const r = view.racers.find(x => x.id === f.id); if (!r) continue;
      const dist = Math.hypot(e.x - r.x, e.z - r.z);
      if (dist < best.dist) best = { pan: f.pan, gain: clamp(1 - (dist - 12) / 180, .25, 1), dist };
    }
    return best;
  }
}

/** Default stereo placement of split-screen viewports: stacked pair gently apart, 2×2 grid by column. */
export function viewportPan(index: number, count: number) {
  if (count <= 1) return 0;
  if (count === 2) return index === 0 ? -.25 : .25;
  const cols = count <= 4 ? 2 : Math.ceil(Math.sqrt(count));
  return -.55 + 1.1 * (index % cols) / (cols - 1);
}
