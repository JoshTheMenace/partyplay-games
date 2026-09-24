/* Network presentation: snapshot interpolation (RaceBuffer) and local-kart prediction (KartPredictor),
 * driven through a simulated room: 60 Hz server, 20 Hz snapshots, the platform's 20 Hz held-input
 * channel, and configurable one-way latencies with jitter. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { HeldInputChannel } from '../../../party-client/src/held-input';
import { angleDelta, clamp, nextRandom } from '../src/sim/math';
import { pointAt, queryTrack, sampleAt } from '../src/sim/track';
import { createRace, NEUTRAL_INPUT, stepRace } from '../src/sim/race';
import { beginRespawn } from '../src/sim/physics';
import { toRaceView } from '../src/sim/view';
import { getTrack } from '../src/tracks/index';
import { RaceBuffer, lerpKart, teleported } from '../src/net/interpolate';
import { KartPredictor } from '../src/net/predict';
import type { Input, Race, RaceView, Settings, TrackId } from '../src/sim/types';

const TICK = 1000 / 60, FINE = TICK / 4;
const settings = (gridSize = 1, track: TrackId = 'palm-bay'): Settings => ({ track, laps: 3, speedClass: 150, difficulty: 'normal', gridSize, items: 'normal', views: 'personal' });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

type Pose = { time: number; x: number; y: number; z: number; heading: number };
type Frame = { local: number; target: number; shown: Pose | null; truth?: Pose; error?: number; offset: number };
type Harness = {
  race: Race; frames: Frame[]; history: Pose[]; predictor: KartPredictor;
  /** Measured race time − local time at which each input actually took effect on the server. */
  trueLeads: number[];
  /** Kart events the predictor reported (with the local time it reported them) and the server's own. */
  predictedEvents: { type: string; t: number; local: number }[]; serverEvents: { type: string; t: number; local: number }[];
  poseAt(time: number): Pose | undefined;
};

/** Steer toward the road ahead from the server's true state (just a way to make sensible, changing inputs). */
function driver(race: Race, t: number, input: Input): Input {
  const r = race.racers[0], track = getTrack(race.track), q = queryTrack(track, r.x, r.z, r.hint, r.y);
  const want = q.heading + clamp(q.lateral / 25, -.4, .4);
  const steer = Math.round(clamp(-angleDelta(r.heading, want) * 2.2 + Math.sin(t * 1.7) * .35, -1, 1) * 20) / 20;
  const ahead = sampleAt(track, q.d + 12).curvature, drifting = Math.abs(ahead) > .012 && t > 1;      // drift through corners: mini-turbos
  return { ...input, steer: drifting ? clamp(Math.round((steer - Math.sign(ahead) * .3) * 20) / 20, -1, 1) : steer, drift: drifting, hop: drifting && !input.drift ? (input.hop + 1) % 256 : input.hop };
}

function simulate(opts: { seconds: number; upMs: () => number; downMs: () => number; frameJitter?: () => number;
  perturb?: (race: Race, time: number) => void; gridSize?: number; immediate?: boolean; presented?: boolean; track?: TrackId; setup?: (race: Race) => void }): Harness {
  const race = createRace(settings(opts.gridSize, opts.track), [{ id: 'p0', name: 'You', color: '#f55' }], 11, 'personal');
  opts.setup?.(race);
  const track = getTrack(race.track), predictor = new KartPredictor(track, 'p0', opts.immediate ? { sendDelayMs: 0 } : {}), buffer = new RaceBuffer();
  const history: Pose[] = [], frames: Frame[] = [];
  const toServer: { at: number; input: Input }[] = [], toClient: { at: number; view: RaceView; time: number }[] = [];
  let upLast = 0, downLast = 0, held: Input = { ...NEUTRAL_INPUT }, clientInput: Input = { ...NEUTRAL_INPUT }, tick = 0, nextFrame = 0, nextFlush = 50;
  const serverOffset = 123456;          // server clock = local clock + offset: the predictor must not care
  const channel = new HeldInputChannel((kind, value) => {
    if (kind !== 'state') return;
    upLast = Math.max(upLast, now + opts.upMs()); toServer.push({ at: upLast, input: value as Input });
  });
  let now = 0, appliedSeq = 0;
  const publishedAt = new Map<number, number>(), trueLeads: number[] = [], predictedEvents: Harness['predictedEvents'] = [], serverEvents: Harness['serverEvents'] = [];
  let lastServerEvent = 0;
  for (let step = 0; now <= opts.seconds * 1000; step++) {
    now = step * FINE;
    while (toServer.length && toServer[0].at <= now + 1e-6) held = toServer.shift()!.input;
    if (step % 4 === 0) {
      stepRace(race, new Map([['p0', held]]), 1 / 60); tick++;
      if (held.seq !== appliedSeq) { appliedSeq = held.seq; const at = publishedAt.get(held.seq); if (at !== undefined) trueLeads.push(race.time - at / 1000); }
      opts.perturb?.(race, race.time);
      for (const e of race.events) if (e.id > lastServerEvent) { lastServerEvent = e.id; if (e.racer === 'p0') serverEvents.push({ type: e.type, t: e.t, local: now }); }
      const r = race.racers[0]; history.push({ time: race.time, x: r.x, y: r.y, z: r.z, heading: r.heading });
      if (tick % 3 === 0) { downLast = Math.max(downLast, now + opts.downMs()); toClient.push({ at: downLast, view: clone(toRaceView(race)), time: now + serverOffset }); }
    }
    while (toClient.length && toClient[0].at <= now + 1e-6) { const s = toClient.shift()!; predictor.reconcile(s.view, s.time, now + serverOffset, now); buffer.push(s.view, s.time, now); }
    if (now >= nextFlush) { channel.flush(now); nextFlush += 50; }
    if (now >= nextFrame) {
      nextFrame += TICK + (opts.frameJitter?.() ?? 0);
      const next = driver(race, now / 1000, clientInput);
      if (next.steer !== clientInput.steer || next.drift !== clientInput.drift || next.hop !== clientInput.hop) {
        clientInput = { ...next, seq: clientInput.seq + 1 }; predictor.input(clientInput, now); publishedAt.set(clientInput.seq, now);
        if (opts.immediate) { upLast = Math.max(upLast, now + opts.upMs()); toServer.push({ at: upLast, input: clientInput }); } else channel.set(clientInput, now);
      }
      const k = predictor.sample(now, opts.presented ? buffer.sample(now)?.racers[0] ?? null : null);
      for (const e of predictor.takeEvents()) predictedEvents.push({ type: e.type, t: e.t, local: now });
      frames.push({ local: now, target: now / 1000 + predictor.lead(), shown: k && { time: 0, x: k.x, y: k.y, z: k.z, heading: k.heading }, offset: predictor.errorMeters });
    }
  }
  const poseAt = (time: number) => {
    const i = history.findIndex(h => h.time >= time - 1e-9);
    if (i <= 0) return i === 0 ? history[0] : undefined;
    const a = history[i - 1], b = history[i], t = (time - a.time) / (b.time - a.time);
    return { time, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, heading: a.heading + angleDelta(a.heading, b.heading) * t };
  };
  for (const f of frames) if (f.shown) { f.truth = poseAt(f.target); if (f.truth) f.error = Math.hypot(f.shown.x - f.truth.x, f.shown.y - f.truth.y, f.shown.z - f.truth.z); }
  return { race, frames, history, predictor, poseAt, trueLeads, predictedEvents, serverEvents };
}
const rng = (seed: number) => { const s = { rng: seed }; return () => nextRandom(s); };
const racing = (h: Harness, from = .5) => h.frames.filter(f => f.error !== undefined && f.truth!.time > from);
const percentile = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];

test('zero latency: prediction replays the exact server simulation (within 1 cm for 5 s)', t => {
  const h = simulate({ seconds: 8.5, upMs: () => 0, downMs: () => 0, immediate: true });
  const frames = racing(h, 0);
  assert.ok(frames.length > 280, `predicted on most frames (${frames.length})`);
  const moved = Math.hypot(h.history.at(-1)!.x - h.history[0].x, h.history.at(-1)!.z - h.history[0].z);
  assert.ok(moved > 60, `the kart actually drove (${moved.toFixed(1)} m)`);
  const worst = Math.max(...frames.map(f => f.error!));
  t.diagnostic(`moved ${moved.toFixed(0)} m, max error ${(worst * 100).toFixed(2)} cm`);
  assert.ok(worst < .01, `max error ${(worst * 100).toFixed(2)} cm`);
});

test('a loop-the-loop: prediction replays it exactly at zero latency, and stays close and smooth at 60–120 ms RTT', t => {
  const track = getTrack('rainbow-road'), loop = track.loops[0], looped: number[] = [];
  const setup = (race: Race) => {   // racing, 70 m before the loop at 150cc top speed
    const me = race.racers[0], d = loop.d0 - 70, p = pointAt(track, d, 1), v = 35;
    Object.assign(race, { time: 20, phase: 'racing' });
    Object.assign(me, { x: p.x, y: p.y, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * v, vz: Math.cos(p.heading) * v, hint: -1, d, lastSafeD: d, progress: d, lap: 1, lapTimes: [], lapStart: 0 });
  };
  const perturb = (race: Race, time: number) => { if (race.racers[0].loop > 0) looped.push(time); };
  const exact = simulate({ seconds: 6.5, upMs: () => 0, downMs: () => 0, immediate: true, track: 'rainbow-road', setup, perturb });
  const inLoop = (f: Frame) => f.truth!.time > looped[0] - .5 && f.truth!.time < looped.at(-1)! + .5, frames = racing(exact, 20).filter(inLoop);
  assert.ok(looped.length > 120 && frames.length > 150, `rode the loop for ${looped.length} ticks, ${frames.length} predicted frames`);
  assert.ok(exact.predictedEvents.some(e => e.type === 'loop') && exact.serverEvents.some(e => e.type === 'loop'), 'the entry is predicted');
  const worst = Math.max(...frames.map(f => f.error!));
  assert.ok(worst < .02, `max error through the loop ${(worst * 100).toFixed(2)} cm`);   // replay starts from rounded snapshot values
  looped.length = 0;
  const jitter = rng(7), h = simulate({ seconds: 6.5, upMs: () => 30 + jitter() * 30, downMs: () => 30 + jitter() * 30, frameJitter: () => (jitter() - .5) * 4, track: 'rainbow-road', setup, perturb });
  const near = racing(h, 20).filter(inLoop), errors = near.map(f => f.error!);
  let pop = 0;
  for (let i = 1; i < near.length; i++) {
    const a = near[i - 1], b = near[i];
    pop = Math.max(pop, Math.abs(Math.hypot(b.shown!.x - a.shown!.x, b.shown!.y - a.shown!.y, b.shown!.z - a.shown!.z) - Math.hypot(b.truth!.x - a.truth!.x, b.truth!.y - a.truth!.y, b.truth!.z - a.truth!.z)));
  }
  t.diagnostic(`zero latency max ${(worst * 100).toFixed(2)} cm; 60–120 ms: p95 ${percentile(errors, .95).toFixed(3)} m, max ${Math.max(...errors).toFixed(3)} m, per-frame deviation ${pop.toFixed(3)} m`);
  assert.ok(near.length > 150 && percentile(errors, .95) < .35 && Math.max(...errors) < 1.2 && pop < .25, 'close and smooth through the loop');
});

test('60–120 ms RTT with jitter: predicted pose stays close to the server and moves smoothly', t => {
  const jitter = rng(5);
  const h = simulate({ seconds: 24, upMs: () => 30 + jitter() * 30, downMs: () => 30 + jitter() * 30, frameJitter: () => (jitter() - .5) * 4 });
  const frames = racing(h, 1);
  assert.ok(frames.length > 400);
  const errors = frames.map(f => f.error!), p95 = percentile(errors, .95), worst = Math.max(...errors);
  assert.ok(p95 < .35, `p95 error ${p95.toFixed(3)} m`);
  assert.ok(worst < 1.2, `max error ${worst.toFixed(3)} m`);
  // Smoothness: frame-to-frame motion of the drawn kart follows the true motion (no pops).
  let pop = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    const shown = Math.hypot(b.shown!.x - a.shown!.x, b.shown!.z - a.shown!.z), truth = Math.hypot(b.truth!.x - a.truth!.x, b.truth!.z - a.truth!.z);
    pop = Math.max(pop, Math.abs(shown - truth));
  }
  const trueLead = h.trueLeads.reduce((a, b) => a + b, 0) / h.trueLeads.length, leadError = Math.abs(h.predictor.lead() - trueLead) * 1000;
  t.diagnostic(`p95 ${p95.toFixed(3)} m, max ${worst.toFixed(3)} m, largest per-frame deviation ${pop.toFixed(3)} m, lead error vs measured mean ${leadError.toFixed(1)} ms`);
  assert.ok(leadError < 20, `the kart is drawn at the moment inputs take effect (off by ${leadError.toFixed(1)} ms)`);
  assert.ok(pop < .25, `largest per-frame deviation ${pop.toFixed(3)} m`);
  // The drawn lead follows its estimate at ±5% of real time: a better ack never skips the kart forward or back.
  let slew = 0;
  for (let i = 1; i < h.frames.length; i++) { const a = h.frames[i - 1], b = h.frames[i]; if (a.shown && b.shown) slew = Math.max(slew, Math.abs(b.target - b.local / 1000 - a.target + a.local / 1000) / ((b.local - a.local) / 1000)); }
  assert.ok(slew <= .05 + 1e-6, `drawn lead changed at ${(slew * 100).toFixed(1)}% of real time`);
  // Kart events are reported by prediction once each, at the right race time, well before the server's copy arrives.
  const kinds = new Set(['mini-turbo', 'boost-pad', 'trick', 'slipstream', 'wall', 'rocket-start', 'stall']), server = h.serverEvents.filter(e => kinds.has(e.type) && e.t > 1);
  const matched = server.map(e => h.predictedEvents.find(p => p.type === e.type && Math.abs(p.t - e.t) < .35)).filter(p => p !== undefined);
  const earlier = server.filter(e => { const p = h.predictedEvents.find(q => q.type === e.type && Math.abs(q.t - e.t) < .35); return p && p.local < e.local + 60; });
  t.diagnostic(`server kart events ${server.length} (${[...new Set(server.map(e => e.type))].join(', ')}), predicted ${matched.length}, predicted ${h.predictedEvents.length} total`);
  assert.ok(server.length >= 2 && matched.length >= server.length - 1, 'prediction reports the kart events the server produces');
  assert.ok(h.predictedEvents.length <= server.length + 2, 'no duplicates from replays');
  assert.ok(earlier.length >= matched.length - 1, 'reported before the snapshot carrying the server event arrives');
});

test('240 ms RTT with bursty delivery: still bounded and smooth', t => {
  const jitter = rng(21);
  const h = simulate({ seconds: 16, upMs: () => 100 + jitter() * 40, downMs: () => 90 + (jitter() < .15 ? 60 : jitter() * 20), frameJitter: () => (jitter() - .5) * 6 });
  const frames = racing(h, 1), errors = frames.map(f => f.error!);
  let pop = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    pop = Math.max(pop, Math.abs(Math.hypot(b.shown!.x - a.shown!.x, b.shown!.z - a.shown!.z) - Math.hypot(b.truth!.x - a.truth!.x, b.truth!.z - a.truth!.z)));
  }
  t.diagnostic(`p95 ${percentile(errors, .95).toFixed(3)} m, max ${Math.max(...errors).toFixed(3)} m, largest per-frame deviation ${pop.toFixed(3)} m`);
  assert.ok(frames.length > 650, `prediction stays on (${frames.length} frames of ${h.frames.filter(f => f.truth && f.truth.time > 1).length})`);
  assert.ok(percentile(errors, .95) < .6 && pop < .35);
});

test('a server-side correction is blended out, not popped', t => {
  const jitter = rng(9);
  let shoved = false;
  const h = simulate({ seconds: 6, upMs: () => 40 + jitter() * 10, downMs: () => 40 + jitter() * 10,
    perturb: (race, time) => { if (!shoved && time > 1.5) { shoved = true; const r = race.racers[0]; r.x += Math.cos(r.heading) * 1.5; r.z -= Math.sin(r.heading) * 1.5; } } });
  const after = h.frames.filter(f => f.truth && f.truth.time > 1.55);
  const peak = Math.max(...after.slice(0, 20).map(f => f.error!));
  assert.ok(peak > .8, `the shove is visible as error at first (${peak.toFixed(2)} m)`);
  const settled = after.filter(f => f.truth!.time > 2.2).map(f => f.error!);
  assert.ok(Math.max(...settled) < .2, `settled within ~0.6 s (${Math.max(...settled).toFixed(3)} m)`);
  let jump = 0;
  for (let i = 1; i < after.length; i++) jump = Math.max(jump, Math.hypot(after[i].shown!.x - after[i - 1].shown!.x, after[i].shown!.z - after[i - 1].shown!.z)
    - Math.hypot(after[i].truth!.x - after[i - 1].truth!.x, after[i].truth!.z - after[i - 1].truth!.z));
  t.diagnostic(`peak ${peak.toFixed(2)} m, settled max ${Math.max(...settled).toFixed(3)} m, worst extra per-frame motion ${jump.toFixed(3)} m`);
  assert.ok(jump < .3, `no single-frame pop (${jump.toFixed(3)} m)`);
});

test('a respawn teleport snaps instead of sliding across the map', () => {
  const jitter = rng(3);
  let fell = false;
  const h = simulate({ seconds: 8, upMs: () => 40 + jitter() * 10, downMs: () => 40 + jitter() * 10,
    perturb: (race, time) => { if (!fell && time > 1) { fell = true; beginRespawn(race.racers[0]); } } });
  const late = h.frames.filter(f => f.truth && f.truth.time > 3);
  assert.ok(late.length > 60);
  assert.ok(Math.max(...late.map(f => f.error!)) < .3, 'tracks the placed kart after the respawn');
  const after = h.frames.filter(f => f.truth && f.truth.time > 1.25);
  assert.ok(Math.max(...after.map(f => f.offset)) < .5, 'the multi-metre respawn correction snapped instead of being blended');
});

test('prediction turns off when it cannot be right', () => {
  const race = createRace(settings(), [{ id: 'p0', name: 'You', color: '#f55' }], 1, 'personal'), track = getTrack(race.track);
  for (let i = 0; i < 300; i++) stepRace(race, new Map([['p0', { ...NEUTRAL_INPUT, seq: 4 }]]), 1 / 60);
  const p = new KartPredictor(track, 'p0');
  assert.equal(p.sample(0), null, 'no snapshot yet');
  p.reconcile(toRaceView(race), 1000, 1000, 0);
  assert.equal(p.sample(10), null, 'the server applied input seq 4, which this page never saw');
  p.input({ ...NEUTRAL_INPUT, seq: 4 }, -20);
  p.reconcile(toRaceView(race), 1050, 1050, 50);
  assert.ok(p.sample(60), 'known held input → predicted');
  p.input({ ...NEUTRAL_INPUT, steer: 1, seq: 5 }, 70);
  p.reconcile(toRaceView(race), 1100, 1100, 100);
  assert.ok(p.sample(1000));
  assert.equal(p.sample(1700), null, 'an input unacknowledged for 1.5 s: the server is not hearing us');
  const done = toRaceView(race); done.racers[0].finishTime = 12;
  p.reconcile(done, 1150, 1150, 1700);
  assert.equal(p.sample(1710), null, 'finished racers are autopiloted by the server');
  const results = { ...toRaceView(race), phase: 'results' as const };
  p.reset(); p.reconcile(results, 1200, 1200, 1800);
  assert.equal(p.sample(1810), null);
});

test('a nitro press is predicted, except while spun, tumbling or respawning (the server swallows it)', () => {
  for (const state of [{}, { spinT: .8 }, { tumbleT: .8 }, { respawnT: .8 }]) {
    const race = createRace(settings(), [{ id: 'p0', name: 'You', color: '#f55' }], 1, 'personal'), track = getTrack(race.track);
    for (let i = 0; i < 300; i++) stepRace(race, new Map([['p0', { ...NEUTRAL_INPUT, seq: 1 }]]), 1 / 60);
    Object.assign(race.racers[0], { item: 'nitro', itemCount: 1, rollT: 0, boostT: 0 }, state);
    const p = new KartPredictor(track, 'p0', { sendDelayMs: 0 });
    p.input({ ...NEUTRAL_INPUT, seq: 1 }, -20); p.reconcile(toRaceView(race), 1000, 1000, 0);
    p.input({ ...NEUTRAL_INPUT, fire: 1, seq: 2 }, 10);
    const k = p.sample(40)!, used = p.takeEvents().some(e => e.type === 'item');
    assert.equal(used, !Object.keys(state).length, `predicted nitro with ${JSON.stringify(state)}`);
    assert.equal(k.boostT > 0, used);
  }
});

test('reconnecting after autopilot: the fresh controller\'s first input is not read as a hop or item press', () => {
  const race = createRace(settings(), [{ id: 'p0', name: 'You', color: '#f55' }], 1, 'personal'), me = race.racers[0];
  const run = (ticks: number, input?: Input) => { for (let i = 0; i < ticks; i++) stepRace(race, new Map(input ? [['p0', input]] : []), 1 / 60); };
  run(300, { ...NEUTRAL_INPUT, seq: 1 });
  const before = { hop: me.prevHop, fire: me.prevFire };       // what a stale snapshot seeds the remounted controller with
  me.connected = false; run(60 * 20);                            // autopilot hops for drifts (and could fire items)
  assert.notEqual(me.prevHop, before.hop, 'the autopilot pressed hop while we were away');
  me.connected = true; run(1);                                   // the platform holds neutral (seq 0) until the page sends
  Object.assign(me, { item: 'shield', itemCount: 1, rollT: 0, shieldT: 0, hopT: 0, spinT: 0, tumbleT: 0, respawnT: 0 });
  run(1, { ...NEUTRAL_INPUT, ...before, seq: 1 });
  assert.equal(me.item, 'shield', 'the held item was not used'); assert.ok(me.grounded && me.hopT === 0, 'no hop');
  run(1, { ...NEUTRAL_INPUT, ...before, fire: (before.fire + 1) & 255, seq: 2 });
  assert.equal(me.item, null, 'the next real press uses it');
});

test('handing over to the interpolated pose (finish line) eases back instead of jumping', t => {
  const jitter = rng(4);
  const h = simulate({ seconds: 9, upMs: () => 45 + jitter() * 15, downMs: () => 45 + jitter() * 15, presented: true,     // GO at local ≈ 3.5 s
    perturb: (race, time) => { const r = race.racers[0]; if (time > 2.5 && r.finishTime === null) r.finishTime = time; } });
  const frames = h.frames.filter(f => f.shown && f.local > 5000);
  let slowest = Infinity, fastest = 0, largest = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].shown!, b = frames[i].shown!, dt = (frames[i].local - frames[i - 1].local) / 1000;
    const along = ((b.x - a.x) * Math.sin(b.heading) + (b.z - a.z) * Math.cos(b.heading)) / dt;
    slowest = Math.min(slowest, along); fastest = Math.max(fastest, along); largest = Math.max(largest, Math.hypot(b.x - a.x, b.z - a.z));
  }
  const settled = frames.filter(f => f.local > 8500).map(f => f.offset);
  t.diagnostic(`drawn speed ${slowest.toFixed(1)}–${fastest.toFixed(1)} m/s across the handoff, largest step ${largest.toFixed(2)} m`);
  assert.ok(frames.some(f => f.local > 6000 && f.local < 6400 && f.offset > 2), 'the switch to the interpolated pose is blended');
  assert.ok(slowest > 6, `never rolls backward or stalls (${slowest.toFixed(1)} m/s)`);
  assert.ok(largest < 1.2, `no single-frame jump (${largest.toFixed(2)} m)`);
  assert.ok(Math.max(...settled) < .05, `settles onto the interpolated pose (${Math.max(...settled).toFixed(3)} m, ${settled.length})`);
});

/* ---------------- RaceBuffer ---------------- */
function baseView(racers = 3): RaceView {
  const race = createRace(settings(racers), [{ id: 'p0', name: 'You', color: '#f55' }], 2, 'tv');
  for (let i = 0; i < 260; i++) stepRace(race, new Map([['p0', NEUTRAL_INPUT]]), 1 / 60);
  return clone(toRaceView(race));
}
/** A view whose racer 0 moves along +x at 20 m/s with heading sweeping across ±π. */
function movingView(base: RaceView, tSec: number): RaceView {
  const v = clone(base);
  v.time = tSec; v.racers[0].x = 20 * tSec; v.racers[0].z = 0; v.racers[0].heading = Math.PI - .05 + tSec * .5;
  v.events = [{ id: Math.round(tSec * 20), t: tSec, type: 'honk', racer: 'p0' }];
  return v;
}

test('RaceBuffer interpolates smoothly under jitter, behind the newest snapshot by the presentation delay', () => {
  const base = baseView(), buf = new RaceBuffer(), jitter = rng(7), shown: { now: number; x: number; server: number }[] = [];
  let next = 0, last = 0, lead = 0;
  for (let now = 0; now < 4000; now += 1000 / 60 + (jitter() - .5) * 3) {
    while (next * 50 <= now - 40) {             // snapshot k sent at 50k (server clock = local + 5000), 40–100 ms latency
      const arrive = Math.max(last, next * 50 + 40 + jitter() * 60); if (arrive > now) break;
      last = arrive; buf.push(movingView(base, next * .05), next * 50 + 5000, arrive); lead = Math.max(lead, next * 50 + 5000 - arrive); next++;
    }
    const v = buf.sample(now); if (v) shown.push({ now, x: v.racers[0].x, server: buf.presentedTime! });
  }
  const steady = shown.filter(s => s.now > 1500);
  for (let i = 1; i < steady.length; i++) {
    const speed = (steady[i].x - steady[i - 1].x) / ((steady[i].now - steady[i - 1].now) / 1000);
    assert.ok(speed > 17 && speed < 23, `steady speed ${speed.toFixed(1)} m/s at ${steady[i].now.toFixed(0)}`);
  }
  const behind = steady.map(s => s.now + 5000 - 40 - s.server);
  assert.ok(Math.min(...behind) > 60 && Math.max(...behind) < 200, `presentation lag ${Math.min(...behind).toFixed(0)}–${Math.max(...behind).toFixed(0)} ms`);
  assert.ok(buf.delayMs >= 75 && buf.delayMs <= 150);
});

test('RaceBuffer: angle-aware heading, teleport snaps, entities by id, newer events, bounded extrapolation', () => {
  const base = baseView(), buf = new RaceBuffer({ initialDelayMs: 100 });
  const a = movingView(base, 0), b = movingView(base, .05);
  a.racers[0].heading = 3.1; b.racers[0].heading = -3.1;                           // across ±π: the short way is through π
  a.racers[1].x = 0; b.racers[1].x = 500;                                          // a teleport
  a.entities = [{ id: 1, kind: 'bouncer', owner: 'p0', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 1, hint: 0, d: 10, target: null, bounces: 0, fuse: 0 },
    { id: 2, kind: 'peel', owner: 'p0', x: 5, y: 0, z: 5, vx: 0, vy: 0, vz: 0, t: 1, hint: 0, d: 10, target: null, bounces: 0, fuse: 0 }];
  b.entities = [{ ...a.entities[0], x: 2, t: 1.05 }, { id: 3, kind: 'bomb', owner: 'p0', x: 9, y: 0, z: 9, vx: 0, vy: 0, vz: 0, t: 0, hint: 0, d: 10, target: null, bounces: 0, fuse: 1 }];
  buf.push(a, 1000, 0); buf.push(b, 1050, 50);                                     // lead = 1000
  const mid = buf.sample(125)!;                                  // now + lead(1000) − delay(100) = server 1025: halfway
  assert.ok(Math.abs(Math.abs(mid.racers[0].heading) - Math.PI) < .01, `heading ${mid.racers[0].heading}`);
  assert.equal(mid.racers[1].x, 500, 'teleported racer snaps to the newer snapshot');
  assert.ok(Math.abs(mid.racers[0].x - .5) < 1e-6);
  assert.deepEqual(mid.entities.map(e => e.id), [1, 3], 'entities follow the newer snapshot');
  assert.ok(Math.abs(mid.entities[0].x - 1) < 1e-6, 'matched entity is interpolated by id');
  assert.deepEqual(mid.events, [], 'an event waits for the presented clock to reach it');
  assert.equal(buf.sample(125), mid, 'same timestamp → same view (several viewports per frame)');
  // Snapshots stop: extrapolate at most 60 ms, then hold.
  let x = 0; for (let now = 141; now < 700; now += 16) x = buf.sample(now)!.racers[0].x;
  assert.ok(x <= 1 + 20 * .06 + 1e-6 && x > 1, `held at ${x}`);
  assert.equal(buf.sample(701)!.events[0]?.id, b.events[0].id, 'then passes through from the newer snapshot');
  assert.equal(buf.sample(2000)!.phase, b.phase);
  buf.reset(); assert.equal(buf.sample(2100), null);
});

test('lerpKart wraps d across the start line and teleported() catches respawns', () => {
  const base = baseView().racers[0], length = getTrack('palm-bay').length;
  const a = { ...base, d: length - 1 }, b = { ...base, d: 1 };
  assert.ok(Math.abs(lerpKart(a, b, .5, length).d) < 1e-9 || Math.abs(lerpKart(a, b, .5, length).d - length) < 1e-9);
  assert.equal(teleported({ ...base, respawnT: 0 }, { ...base, respawnT: 1.2 }, .05), true);
  assert.equal(teleported(base, { ...base, x: base.x + 2 }, .05), false);
});
