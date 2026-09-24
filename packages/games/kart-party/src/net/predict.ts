/* Local-kart prediction (DESIGN §1, §6).
 *
 * Think of it as "rewind and replay": every snapshot gives the true kart at race time T_s plus the
 * last input sequence the server applied (racer.lastSeq). We copy that kart, then replay the inputs
 * the server has not applied yet with the real `stepKart` at fixed 1/60 s steps up to the race time
 * the server will be at when an input sent *now* arrives. That lead is measured, not guessed: when
 * input k (sent at local time t_k) is first acknowledged by a snapshot at race time T, the server
 * applied it no later than T, so race time ≈ local time + min(T − t_k) over recent acks. Clock sync
 * errors cancel out of that estimate. The platform sends held input on a 50 ms cadence, so inputs are
 * assumed to leave `sendDelayMs` (25 ms, the average wait) after they are set. The estimate moves in
 * steps (a first ack, a faster one, snapshot jitter before any ack), so the lead actually drawn follows
 * it at ±5% of real time, like RaceBuffer's clock: a 50 ms step never skips the kart 1.5 m in a frame.
 *
 * Corrections never pop: when a new snapshot changes the predicted pose, the difference becomes a
 * visual offset that decays at ~8/s. Respawns, hits and large errors snap instead. Prediction turns
 * itself off when it cannot be right: no snapshot, results, a finished/autopiloted or disconnected
 * racer, an acknowledged input it never saw, or inputs the server has not acknowledged for 1.5 s.
 * Then sample() returns null, or the caller's interpolated pose blended in from the last predicted
 * one (a speed-aware decay, so the kart eases back by the round-trip distance instead of jumping). */
import { angleDelta, clamp } from '../sim/math';
import { kartParams, startBoost, stepKart, type Drafter, type KartParams } from '../sim/physics';
import type { Track } from '../sim/track';
import { kartFromView } from '../sim/view';
import { lerpKart } from './interpolate';
import { ITEM_IDS } from '../sim/items';
import type { Input, KartState, Phase, RaceEventType, RaceView, RacerView } from '../sim/types';

/** A kart event (mini-turbo, boost pad, wall…) the replay produced for a tick it simulated for the first time. */
export type PredictedEvent = { type: RaceEventType; t: number; value?: number };

export const PREDICT_DT = 1 / 60;
const MAX_AHEAD = .4;                // seconds of replay at most (RTT beyond this shows a lagging kart, never a runaway one)
const ERROR_DECAY = 8;               // per second
const SNAP_METERS = 5, SNAP_RADIANS = 1, HANDOFF_METERS = 15;
const STALE_UNACKED_MS = 1500, MAPPING_WINDOW_MS = 10000, ASSUMED_UPLINK = .05;
const MAX_STEPS_PER_SAMPLE = 60;
const LEAD_SLEW = .05, LEAD_SNAP = .25;   // drawn lead follows the estimate at ±5% of real time; bigger gaps jump
const NO_EVENTS: PredictedEvent[] = [];
/** The platform resends the held input on a 50 ms cadence, so a change leaves on average 25 ms after setInput. */
export const PLATFORM_SEND_DELAY_MS = 25;

type Sent = { input: Input; at: number; sampled: boolean };
type Auth = { kart: KartState; time: number; phase: Phase; racer: RacerView; params: KartParams; drafters: (Drafter & { x0: number; z0: number; vx: number; vz: number })[]; snapshotTime: number; at: number };
type Pose = { x: number; y: number; z: number; heading: number };

export class KartPredictor {
  private sent: Sent[] = [];
  private auth: Auth | null = null;
  private acks: { at: number; m: number }[] = [];
  private fallback = 0;                 // race time − local seconds before any acknowledgement
  private sim: Auth | null = null;      // the snapshot the cached lo/hi replay started from
  private lo: KartState | null = null; private hi: KartState | null = null; private hiTime = 0;
  private nitroUsed = 0;
  private frontier = -Infinity;         // latest race time ever simulated: events are reported once, when first reached
  private pending: PredictedEvent[] = [];
  private dirty = true;
  private offset: Pose = { x: 0, y: 0, z: 0, heading: 0 };
  private decayRate = ERROR_DECAY;
  private shown: Pose | null = null;    // the last pose returned, for blending source switches
  private wasPredicted = false;
  private lastNow: number | null = null;
  private drawnLead: number | null = null;
  private readonly sendDelay: number;
  /** options.sendDelayMs: average delay between setInput and the input leaving the device (default: the platform's). */
  constructor(readonly track: Track, readonly racerId: string, options: { sendDelayMs?: number } = {}) { this.sendDelay = (options.sendDelayMs ?? PLATFORM_SEND_DELAY_MS) / 1000; }

  /** Record the complete input just sent to the server, at local time `atMs` (performance.now()). */
  input(input: Input, atMs: number = performance.now()) {
    const last = this.sent.at(-1);
    if (last && input.seq < last.input.seq) this.sent = [];            // the controller restarted its sequence
    if (last && input.seq === last.input.seq) last.input = { ...input };
    else this.sent.push({ input: { ...input }, at: atMs, sampled: false });
    if (this.sent.length > 256) this.sent.shift();
    this.dirty = true;
  }

  /** Reconcile with an authoritative snapshot taken at server time `snapshotTime`. `serverNowMs` (the
   * session's server clock now) and `nowMs` (local performance.now()) only seed the lead estimate until
   * the first input is acknowledged. Repeated calls with the same snapshot are ignored. */
  reconcile(view: RaceView, snapshotTime: number, serverNowMs: number, nowMs: number = performance.now()) {
    if (this.auth && snapshotTime === this.auth.snapshotTime) return;
    const racer = view.racers.find(r => r.id === this.racerId);
    if (!racer) { this.auth = null; return; }
    if (this.auth && view.time < this.auth.time - 1) this.softReset();          // a new race on the same predictor
    const acked = racer.lastSeq, hit = this.sent.find(s => s.input.seq === acked && !s.sampled);
    if (hit) this.acks.push({ at: nowMs, m: view.time - hit.at / 1000 });
    for (const s of this.sent) if (s.input.seq <= acked) s.sampled = true;
    while (this.acks.length > 1 && nowMs - this.acks[0].at > MAPPING_WINDOW_MS) this.acks.shift();
    const keep = this.sent.findIndex(s => s.input.seq >= acked);                     // keep the acknowledged (held) input and newer
    this.sent = keep < 0 ? [] : this.sent.slice(keep);
    this.fallback = view.time + clamp((serverNowMs - snapshotTime) / 1000, 0, .5) + ASSUMED_UPLINK - nowMs / 1000;
    const drafters = view.racers.filter(r => r.id !== this.racerId).map(r => ({ x: r.x, z: r.z, x0: r.x, z0: r.z, vx: r.vx, vz: r.vz, heading: r.heading, speed: Math.hypot(r.vx, r.vz) }));
    this.auth = { kart: kartFromView(racer), time: view.time, phase: view.phase, racer, params: kartParams(racer.character, racer.kart, view.speedClass, 1), drafters, snapshotTime, at: nowMs };
    this.dirty = true;
  }

  /** Kart to draw at local time `nowMs`: the prediction, or null when prediction is unavailable.
   * Pass `presented` (this racer's interpolated snapshot pose) to get it back instead of null while
   * prediction is off, with the switch between the two blended so finishing, results or a lost input
   * link never jumps the kart back by the round-trip distance. */
  sample(nowMs: number = performance.now(), presented: KartState | null = null): KartState | null {
    const frame = this.lastNow === null ? 0 : clamp(nowMs - this.lastNow, 0, 250) / 1000; this.lastNow = nowMs;
    const want = this.estimatedLead(), was = this.drawnLead;
    this.drawnLead = was === null || Math.abs(want - was) > LEAD_SNAP ? want : was + clamp(want - was, -LEAD_SLEW * frame, LEAD_SLEW * frame);
    const o = this.offset, decay = Math.exp(-this.decayRate * frame);
    o.x *= decay; o.y *= decay; o.z *= decay; o.heading *= decay;
    const auth = this.auth, heldInput = auth ? this.acknowledgedInput(nowMs) : null, predicted = !!heldInput;
    let raw: KartState | null = presented;
    if (auth && heldInput) raw = this.predict(auth, heldInput, nowMs);
    else if (this.hi) { this.sim = null; this.lo = this.hi = null; this.dirty = true; }
    if (!raw) { this.shown = null; this.clearOffset(); return null; }
    const last = this.shown;
    if (predicted !== this.wasPredicted && last && raw.respawnT <= 0) {                       // hand over between sources
      const dx = last.x + raw.vx * frame - raw.x - o.x, dy = last.y + raw.vy * frame - raw.y - o.y, dz = last.z + raw.vz * frame - raw.z - o.z, dist = Math.hypot(dx, dy, dz);   // keep moving
      if (dist < HANDOFF_METERS) { o.x += dx; o.y += dy; o.z += dz; o.heading += angleDelta(raw.heading + o.heading, last.heading); this.decayRate = clamp(.6 * Math.hypot(raw.vx, raw.vz) / Math.max(dist, 1e-3), 1.5, ERROR_DECAY); }
    }
    this.wasPredicted = predicted;
    const out = o.x || o.y || o.z || o.heading ? { ...raw, x: raw.x + o.x, y: raw.y + o.y, z: raw.z + o.z, heading: raw.heading + o.heading } : raw;
    this.shown = { x: out.x, y: out.y, z: out.z, heading: out.heading };
    return out;
  }

  /** Events from newly predicted ticks since the last call (for instant local sound); call once per frame. */
  takeEvents(): PredictedEvent[] { if (!this.pending.length) return NO_EVENTS; const e = this.pending; this.pending = []; return e; }

  /** Metres of correction still being blended out (debug/QA). */
  get errorMeters() { return Math.hypot(this.offset.x, this.offset.y, this.offset.z); }
  /** Race time − local time (s) the local kart is drawn at: the moment an input set now takes effect on the server. */
  lead() { return this.drawnLead ?? this.estimatedLead(); }
  private estimatedLead() { let m = Infinity; for (const a of this.acks) if (a.m < m) m = a.m; return (m === Infinity ? this.fallback : m) + this.sendDelay; }

  reset() { this.softReset(); this.sent = []; this.acks = []; this.auth = null; }
  private softReset() { this.frontier = -Infinity; this.pending = []; this.sim = null; this.lo = this.hi = null; this.lastNow = null; this.drawnLead = null; this.shown = null; this.wasPredicted = false; this.clearOffset(); this.dirty = true; }
  private clearOffset() { const o = this.offset; o.x = o.y = o.z = o.heading = 0; }

  /** The input the server is currently holding for us, or null when prediction must be off. */
  private acknowledgedInput(nowMs: number): Input | null {
    const auth = this.auth, r = auth?.racer;
    if (!auth || !r || auth.phase === 'results' || r.bot || !r.connected || r.finishTime !== null) return null;
    const acked = this.sent[0]?.input.seq === r.lastSeq ? this.sent[0].input : r.lastSeq === 0 ? { steer: 0, drift: false, brake: false, item: false, hop: r.prevHop, fire: r.prevFire, seq: 0 } : null;
    if (!acked) return null;
    for (const s of this.sent) if (s.input.seq > r.lastSeq && nowMs - s.at > STALE_UNACKED_MS) return null;
    return acked;
  }
  /** The replayed pose at `nowMs`; a new snapshot's change to it becomes a decaying visual offset. */
  private predict(auth: Auth, heldInput: Input, nowMs: number): KartState {
    const target = Math.min(nowMs / 1000 + this.lead(), auth.time + MAX_AHEAD);
    if (!this.dirty && this.hi) return this.advance(target, heldInput);
    const prev = this.hi ? this.advance(target, heldInput) : null;     // the old replay, at the same moment
    this.rebuild(auth);
    const raw = this.advance(target, heldInput), o = this.offset;
    if (!prev) return raw;
    const dx = prev.x - raw.x, dy = prev.y - raw.y, dz = prev.z - raw.z, dh = angleDelta(raw.heading, prev.heading);
    if (this.mustSnap(prev, raw) || Math.hypot(dx, dy, dz) > SNAP_METERS || Math.abs(dh) > SNAP_RADIANS) this.clearOffset();
    else { o.x += dx; o.y += dy; o.z += dz; o.heading += dh; this.decayRate = ERROR_DECAY; }
    return raw;
  }
  private rebuild(auth: Auth) {
    this.sim = auth; this.hi = this.lo = { ...auth.kart }; this.hiTime = auth.time; this.nitroUsed = 0; this.dirty = false;
  }
  /** Step the cached simulation forward so that hiTime ≥ target, and return the pose at target. */
  private advance(target: number, heldInput: Input): KartState {
    const auth = this.sim!;
    let lo = this.lo!, hi = this.hi!;
    const lead = this.lead();
    for (let n = 0; this.hiTime < target - 1e-9 && n < MAX_STEPS_PER_SAMPLE; n++) {
      const end = this.hiTime + PREDICT_DT;
      let input = heldInput;
      for (const s of this.sent) { if (s.input.seq <= heldInput.seq) continue; if (Math.max(s.at / 1000 + lead, auth.time) <= end + 1e-9) input = s.input; else break; }
      lo = hi; hi = { ...hi }; this.step(hi, end, input); this.hiTime = end;
    }
    this.lo = lo; this.hi = hi;
    if (lo === hi) return hi;
    return lerpKart(lo, hi, clamp((target - (this.hiTime - PREDICT_DT)) / PREDICT_DT, 0, 1), this.track.length);
  }
  /** One server tick for our kart: the same order as stepRace (clock, item input, stepKart). */
  private step(k: KartState, time: number, input: Input) {
    const auth = this.sim!, r = auth.racer, since = time - auth.time;
    const phase: Phase = auth.phase === 'racing' || time >= -1e-6 ? 'racing' : 'countdown';
    if (phase === 'racing') {
      // Nitro is the one item whose effect is purely on our own kart, so it is predicted too
      // (not while spun, tumbling or respawning: the server swallows that press, see handleItemInput).
      if (input.fire !== k.prevFire && k.respawnT <= 0 && k.spinT <= 0 && k.tumbleT <= 0 && (r.item === 'nitro' || r.item === 'triple-nitro') && r.rollT - since <= 0 && this.nitroUsed < Math.max(1, r.itemCount)) { startBoost(k, 1.4, .4); this.nitroUsed++; this.report(time, 'item', ITEM_IDS.indexOf(r.item)); }
      k.prevFire = input.fire; k.prevItem = input.item;
    }
    for (const d of auth.drafters) { d.x = d.x0 + d.vx * since; d.z = d.z0 + d.vz * since; }
    for (const e of stepKart(k, input, auth.params, this.track, PREDICT_DT, { time, phase, drafters: auth.drafters })) this.report(time, e.type, e.value);
    if (time > this.frontier) this.frontier = time;
  }
  private report(t: number, type: RaceEventType, value?: number) {
    if (t <= this.frontier + 1e-9) return;
    this.pending.push(value === undefined ? { type, t } : { type, t, value });
    if (this.pending.length > 32) this.pending.shift();
  }
  private mustSnap(prev: KartState, next: KartState) {
    return (prev.respawnT > 0) !== (next.respawnT > 0) || (next.tumbleT > 0 && prev.tumbleT <= 0) || (next.spinT > 0 && prev.spinT <= 0);
  }
}
