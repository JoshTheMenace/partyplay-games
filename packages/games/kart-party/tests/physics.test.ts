/* Driving model checks (DESIGN.md §3). Uses small synthetic tracks so the numbers don't depend on course authoring. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { angleDelta, clamp, headingOf } from '../src/sim/math';
import { buildTrack, forwardDistance, loopPose, moverPosition, pointAt, sampleAt, signedDistance, type Track } from '../src/sim/track';
import { applyHit, beginRespawn, collideKarts, createKartState, kartParams, loopLength, PHYSICS, respawnSpot, speedOf, startBoost, stepKart, type Drafter, type KartEvent, type StepEnv } from '../src/sim/physics';
import type { Input, KartState, TrackDef, TrackPoint } from '../src/sim/types';

const DT = 1 / 60, p = kartParams(1, 'zoomer', 100), TOP = p.topSpeed;
const def = (points: TrackPoint[], extra: Partial<TrackDef> = {}): TrackDef => ({ id: 'palm-bay', name: 'Test', theme: 'beach', tagline: '', points,
  boostPads: [], ramps: [], itemRows: [], gaps: [], zones: [], obstacles: [], landmarks: [], ...extra });
/** Paperclip: two 700 m straights joined by hairpins of radius r. */
const clip = (r = 20, extra: Partial<TrackDef> = {}, edge: Partial<TrackPoint> = {}) => buildTrack(def([
  ...[0, 100, 200, 300, 400, 500, 600, 700].map(z => ({ x: 0, z, ...edge })), { x: r * .3, z: 700 + r * .95 }, { x: r, z: 700 + r * 1.35 }, { x: r * 1.7, z: 700 + r * .95 },
  ...[700, 600, 500, 400, 300, 200, 100, 0].map(z => ({ x: 2 * r, z })), { x: r * 1.7, z: -r * .95 }, { x: r, z: -r * 1.35 }, { x: r * .3, z: -r * .95 }], extra));
const oval = clip(60);
/** Huge circle with a 90 m wide road: room to drift in circles without touching a wall. */
const arena = buildTrack(def(Array.from({ length: 16 }, (_, i) => ({ x: 250 * Math.sin(i / 16 * Math.PI * 2), z: 250 * Math.cos(i / 16 * Math.PI * 2), w: 90 }))));

const env = (time = 10, drafters: Drafter[] = []): StepEnv => ({ time, phase: time < 0 ? 'countdown' : 'racing', drafters });
const input = (o: Partial<Input> = {}): Input => ({ steer: 0, drift: false, brake: false, item: false, hop: 0, fire: 0, seq: 0, ...o });
function kartAt(track: Track, d: number, lateral = 0, speed = 0) {
  const pt = pointAt(track, d, lateral), k = createKartState(pt.x, pt.y, pt.z, pt.heading, track);
  k.vx = Math.sin(pt.heading) * speed; k.vz = Math.cos(pt.heading) * speed;
  return k;
}
type Control = { steer?: number; drift?: boolean; brake?: boolean; press?: boolean };
/** Drive a kart with a per-step controller; returns every event with its step time. */
function drive(k: KartState, track: Track, seconds: number, ctrl: (k: KartState, t: number) => Control, e: (t: number) => StepEnv = () => env()) {
  const events: (KartEvent & { t: number })[] = [];
  for (let i = 0, hop = k.prevHop; i < Math.round(seconds / DT); i++) {
    const t = i * DT, c = ctrl(k, t);
    if (c.press) hop = (hop + 1) % 256;
    for (const ev of stepKart(k, input({ steer: c.steer ?? 0, drift: c.drift ?? false, brake: c.brake ?? false, hop }), p, track, DT, e(t))) events.push({ ...ev, t });
  }
  return events;
}
/** Steer toward the centre line a little ahead. */
const pursue = (track: Track, k: KartState, look = 18) => { const t = pointAt(track, k.d + look, 0); return clamp(-angleDelta(k.heading, headingOf(t.x - k.x, t.z - k.z)) * 3, -1, 1); };
const along = (track: Track, from: number, to: number) => ((to - from) % track.length + track.length) % track.length;

test('auto-acceleration reaches ~90% of top in about 2.3 s and never overshoots', tc => {
  const k = kartAt(oval, 100);
  let t90 = 0, prev = 0;
  drive(k, oval, 6, (_, t) => { const v = speedOf(k); assert.ok(v >= prev - 1e-9 && v <= TOP + 1e-9); prev = v; if (!t90 && v >= .9 * TOP) t90 = t; return { steer: pursue(oval, k) }; });
  tc.diagnostic(`90% of top after ${t90.toFixed(2)} s`);
  assert.ok(t90 > 2 && t90 < 2.7, `90% of top after ${t90.toFixed(2)} s`);
  assert.ok(Math.abs(speedOf(k) - TOP) < .05, 'settles at top speed');
});

test('braking stops the kart and holding brake reverses slowly', () => {
  const k = kartAt(oval, 100, 0, TOP);
  drive(k, oval, 1.2, () => ({ brake: true }));
  assert.ok(speedOf(k) < 7.5 && Math.abs(speedOf(k)) >= 0);
  drive(k, oval, 3, () => ({ brake: true }));
  const fwd = k.vx * Math.sin(k.heading) + k.vz * Math.cos(k.heading);
  assert.ok(fwd < -6 && fwd >= -PHYSICS.reverseSpeed - 1e-9, `reversing at ${fwd.toFixed(2)}`);
});

test('steer > 0 turns right: heading decreases and the kart moves to the driver\'s right', () => {
  const k = kartAt(arena, 50, 0, 20), h0 = k.heading, lat0 = k.lateral;
  drive(k, arena, .6, () => ({ steer: 1 }));
  assert.ok(angleDelta(h0, k.heading) < -.3, 'heading decreased');
  assert.ok(k.lateral > lat0 + 1, 'moved right');
  const still = kartAt(arena, 50); still.stallT = 1;
  drive(still, arena, .5, () => ({ steer: 1 }));
  assert.ok(Math.abs(angleDelta(still.heading, sampleAt(arena, 50).heading)) < .05, 'no turning when stopped');
});

test('turning circle tightens with speed taper; 200cc needs a wider line than 100cc', () => {
  const radius = (cc: 100 | 200) => {
    const q = kartParams(1, 'zoomer', cc), k = kartAt(arena, 50, -25, q.topSpeed);
    for (let i = 0; i < 120; i++) stepKart(k, input({ steer: 1 }), q, arena, DT, env());
    const h = k.heading; for (let i = 0; i < 60; i++) stepKart(k, input({ steer: 1 }), q, arena, DT, env());
    return speedOf(k) / Math.abs(angleDelta(h, k.heading));
  };
  const r100 = radius(100), r200 = radius(200);
  assert.ok(r100 > 18 && r100 < 28, `100cc grip radius ${r100.toFixed(1)} m`);
  assert.ok(r200 > r100 * 1.3, `200cc grip radius ${r200.toFixed(1)} m`);
});

/** Hop into a right-hand drift, steer into it until `tier`, then release. */
function driftTo(tier: number, steerIn = 1) {
  const k = kartAt(arena, 50, -20, TOP);
  let released = false, reached = -1;
  const events = drive(k, arena, 4, (_, t) => {
    if (t === 0) return { steer: 1, drift: true, press: true };
    if (!released && k.driftTier >= tier) { released = true; reached = t; }
    return released ? {} : { steer: steerIn, drift: true };
  });
  return { k, events, reached };
}
test('drift tiers fire the matching mini-turbo', () => {
  for (const tier of [1, 2, 3] as const) {
    const { k, events, reached } = driftTo(tier);
    const mt = events.filter(e => e.type === 'mini-turbo');
    assert.equal(mt.length, 1); assert.equal(mt[0].value, tier);
    const after = k.boostT; void after;
    // Tier thresholds are reached in steer-shaped time: full lock charges 1.8/s once grounded.
    assert.ok(Math.abs(reached - (PHYSICS.driftTiers[tier - 1] / 1.8 + .3)) < .12, `tier ${tier} at ${reached.toFixed(2)} s`);
  }
  const { k } = driftTo(2);
  void k;
  const k2 = kartAt(arena, 50, -20, TOP);
  let boost = { t: 0, p: 0 };
  drive(k2, arena, 3, (_, t) => {
    if (t === 0) return { steer: 1, drift: true, press: true };
    if (k2.driftTier < 3) return { steer: 1, drift: true };
    if (!boost.t) { stepKart(k2, input({ hop: k2.prevHop }), p, arena, DT, env()); boost = { t: k2.boostT, p: k2.boostPower }; }
    return {};
  });
  assert.ok(Math.abs(boost.t - PHYSICS.turboTime[3]) < 2 * DT && boost.p === PHYSICS.turboPower[3], `purple boost ${boost.t}/${boost.p}`);
  // Counter-steering charges slowly; no drift direction → just a hop, no charge.
  const slow = driftTo(1, -1), fast = driftTo(1, 1);
  assert.ok(slow.reached > fast.reached * 1.8, `counter-steer tier 1 at ${slow.reached.toFixed(2)} vs ${fast.reached.toFixed(2)} s`);
  const hopOnly = kartAt(arena, 50, 0, TOP);
  drive(hopOnly, arena, 1.5, (_, t) => ({ press: t === 0, drift: true }));
  assert.equal(hopOnly.drift, 0); assert.equal(hopOnly.driftCharge, 0);
});

test('holding a drift through a proper corner earns orange; a hairpin earns purple', tc => {
  // Neutral stick after the hop, released once the kart's path has turned through the corner.
  const tierAfter = (turn: number) => {
    const k = kartAt(arena, 50, -35, TOP), h0 = headingOf(k.vx, k.vz);
    let done = false;
    const events = drive(k, arena, 6, (_, t) => {
      if (t === 0) return { steer: 1, drift: true, press: true };
      done ||= Math.abs(angleDelta(h0, headingOf(k.vx, k.vz))) >= turn;
      return done ? {} : { drift: true };
    });
    return { tier: events.find(e => e.type === 'mini-turbo')?.value ?? 0 };
  };
  const corner = tierAfter(Math.PI / 2), hairpin = tierAfter(Math.PI * .9), bend = tierAfter(Math.PI / 3), kink = tierAfter(Math.PI / 6);
  tc.diagnostic(`tiers: 30° ${kink.tier}, 60° ${bend.tier}, 90° ${corner.tier}, 162° ${hairpin.tier}`);
  assert.equal(kink.tier, 0, 'a kink is not worth a spark'); assert.equal(bend.tier, 1, 'a 60° bend is worth a blue spark'); assert.equal(corner.tier, 2, 'a 90° corner earns orange'); assert.equal(hairpin.tier, 3, 'a hairpin earns purple');
});

test('a drift really slides: slip angle builds and the drifting line is tighter than grip', () => {
  const g = kartAt(arena, 50, -20, TOP), d = kartAt(arena, 50, -20, TOP);
  drive(g, arena, 1.5, () => ({ steer: 1 }));
  drive(d, arena, 1.5, (_, t) => ({ steer: 1, drift: true, press: t === 0 }));
  const slip = (k: KartState) => Math.abs(angleDelta(headingOf(k.vx, k.vz), k.heading));
  assert.ok(slip(d) > .25 && slip(g) < .12, `slip drift ${slip(d).toFixed(2)} grip ${slip(g).toFixed(2)}`);
  assert.ok(d.drift === 1 && speedOf(d) > TOP * .85, 'drift keeps most of its speed');
});

test('weaving and hop spam on a straight are slower than driving straight', t => {
  const run = (ctrl: (k: KartState, t: number) => Control) => { const k = kartAt(oval, 150, 0, TOP), d0 = k.d; drive(k, oval, 10, ctrl); return along(oval, d0, k.d); };
  const straight = run(k => ({ steer: pursue(oval, k) }));
  const hopSpam = run((k, t) => ({ steer: pursue(oval, k), press: Math.round(t / DT) % 24 === 0 }));
  assert.ok(hopSpam < straight - 10, `hop spam ${hopSpam.toFixed(1)} vs ${straight.toFixed(1)}`);
  // Best of a family of snaking strategies: alternate drifts, fire each blue spark, stay in lane.
  let best = 0;
  for (const into of [0, .5, 1]) for (const hmax of [.05, .15, .3]) for (const latMax of [3, 6]) {
    let dir = 1, rel = 0;
    best = Math.max(best, run(k => {
      const want = pursue(oval, k), err = -angleDelta(oval.samples[k.hint].heading, k.heading);
      if (rel > 0) { rel--; return { steer: want }; }
      if (k.drift === 0 && k.grounded) { dir = -dir; return { steer: dir, drift: true, press: true }; }
      const s = k.drift || dir;
      if (k.driftTier >= 1 || k.lateral * s > latMax) { rel = 1; return { steer: want }; }
      return { steer: err * s > hmax ? -s : s * into, drift: true };
    }));
  }
  t.diagnostic(`10 s on a straight: straight ${straight.toFixed(1)} m, hop spam ${hopSpam.toFixed(1)} m, best weave ${best.toFixed(1)} m`);
  assert.ok(best < straight - 2, `best weave ${best.toFixed(1)} m vs straight ${straight.toFixed(1)} m in 10 s`);
});

test('drifting a hairpin well is clearly faster than gripping it', tc => {
  const track = clip(16);
  const target = (k: KartState, look: number) => { const d = k.d + look, t = pointAt(track, d, sampleAt(track, d).line); return -angleDelta(k.heading, headingOf(t.x - k.x, t.z - k.z)); };
  const time = (ctrl: (k: KartState) => Control) => {
    const k = kartAt(track, 500, 0, TOP); let t = 0, dist = 0, prev = k.d, hop = 0;
    while (dist < 420 && t < 30) {
      const c = ctrl(k); if (c.press) hop++;
      stepKart(k, input({ steer: c.steer ?? 0, drift: c.drift ?? false, brake: c.brake ?? false, hop }), p, track, DT, env());
      dist += along(track, prev, k.d) > track.length / 2 ? along(track, prev, k.d) - track.length : along(track, prev, k.d); prev = k.d; t += DT;
    }
    return t;
  };
  let grip = Infinity, drift = Infinity;
  for (const look of [8, 14]) for (const gain of [3.5, 6]) {
    for (const brakeK of [10, 20, 35, Infinity]) grip = Math.min(grip, time(k => {
      const v = speedOf(k), ahead = Math.max(...[8, 16, 24].map(a => Math.abs(sampleAt(track, k.d + a + v * .3).curvature)));
      return { steer: clamp(target(k, look + v * .3) * gain, -1, 1), brake: v * v * ahead > brakeK };
    }));
    let armed = true;
    drift = Math.min(drift, time(k => {
      const v = speedOf(k), err = target(k, look + v * .3), ahead = sampleAt(track, k.d + 12 + v * .3).curvature, here = sampleAt(track, k.d + 4).curvature;
      if (k.drift === 0) {
        if (Math.abs(ahead) > .025 && k.grounded && armed) { armed = false; return { steer: ahead > 0 ? -1 : 1, drift: true, press: true }; }
        if (Math.abs(ahead) < .01) armed = true;
        return { steer: clamp(err * gain, -1, 1), drift: k.hopT > 0 };
      }
      if (Math.abs(here) < .01 && Math.abs(ahead) < .01) return { steer: clamp(err * gain, -1, 1) };
      return { steer: clamp((clamp(err * gain, -1.2, 1.2) * k.drift - .55) / .45, -1, 1) * k.drift, drift: true };
    }));
  }
  tc.diagnostic(`hairpin section: drift ${drift.toFixed(2)} s vs grip ${grip.toFixed(2)} s`);
  assert.ok(drift < grip - .55, `hairpin section: drift ${drift.toFixed(2)} s vs grip ${grip.toFixed(2)} s`);
});

test('boosts stack by longest time and strongest power, then bleed off smoothly', () => {
  const k = kartAt(oval, 150, 0, TOP);
  startBoost(k, .7, .3); startBoost(k, 1.1, .4);
  assert.equal(k.boostT, 1.1); assert.equal(k.boostPower, .4);
  startBoost(k, 2, .2);
  assert.equal(k.boostT, 2); assert.equal(k.boostPower, .4);
  let peak = 0, prev = speedOf(k), worstDrop = 0;
  drive(k, oval, 5, () => { const v = speedOf(k); peak = Math.max(peak, v); worstDrop = Math.max(worstDrop, prev - v); prev = v; return { steer: pursue(oval, k) }; });
  assert.ok(peak > TOP * 1.35 && peak <= TOP * 1.4 + 1e-6, `peak ${peak.toFixed(1)}`);
  assert.ok(worstDrop < .3, `largest per-step speed drop ${worstDrop.toFixed(3)} m/s`);
  assert.equal(k.boostPower, 0, 'expired boost clears its power');
  startBoost(k, .5, .1); assert.equal(k.boostPower, .1);
});

test('boost pads fire once per pad and push past top speed', () => {
  const track = clip(60, { boostPads: [{ at: .2, lat: 0, width: 8 }] });
  const k = kartAt(track, track.length * .2 - 60, 0, TOP);
  const events = drive(k, track, 3, () => ({ steer: pursue(track, k) }));
  assert.equal(events.filter(e => e.type === 'boost-pad').length, 1);
  assert.ok(Math.max(...[k].map(speedOf)) > TOP, 'still above top after the pad');
});

test('offroad is slower, but boosting and stars ignore it', () => {
  const track = clip(60, { zones: [{ from: .05, to: .45, latMin: -30, latMax: 30, surface: 'offroad' }] });
  const k = kartAt(track, 150, 0, TOP);
  drive(k, track, 3, () => ({ steer: pursue(track, k) }));
  assert.ok(k.offroad && speedOf(k) < TOP * .6 && speedOf(k) > TOP * .5, `offroad ${speedOf(k).toFixed(1)}`);
  const heavy = kartParams(2, 'tank', 100), t = kartAt(track, 150, 0, TOP);
  for (let i = 0; i < 180; i++) stepKart(t, input(), heavy, track, DT, env());
  assert.ok(speedOf(t) / heavy.topSpeed > speedOf(k) / TOP + .05, 'traction softens the penalty');
  const b = kartAt(track, 150, 0, TOP);
  drive(b, track, 3, () => { startBoost(b, .5, .3); return { steer: pursue(track, b) }; });
  assert.ok(speedOf(b) > TOP * 1.25, `boosting offroad ${speedOf(b).toFixed(1)}`);
  const s = kartAt(track, 150, 0, TOP); s.starT = 5;
  drive(s, track, 2, () => ({ steer: pursue(track, s) }));
  assert.ok(speedOf(s) > TOP * 1.1, 'star is dirt-proof');
});

test('walls keep most tangential speed, bounce the rest and never stick', () => {
  // 30° into the right wall (no apron) at top speed.
  const walled = clip(60, {}, { runoffR: .5 });
  const k = kartAt(walled, 150, 5, TOP), h = sampleAt(walled, 150).heading - Math.PI / 6;
  k.heading = h; k.vx = Math.sin(h) * TOP; k.vz = Math.cos(h) * TOP;
  const tangential0 = TOP * Math.cos(Math.PI / 6);
  const events = drive(k, walled, .4, () => ({}));
  const wall = events.find(e => e.type === 'wall');
  assert.ok(wall && wall.value! > 6, 'hard impact reported');
  const s = sampleAt(walled, k.d), tangential = k.vx * s.tx + k.vz * s.tz;
  assert.ok(tangential > tangential0 * .7, `kept ${(tangential / tangential0 * 100).toFixed(0)}% of tangential speed`);
  assert.ok(Math.abs(k.lateral) <= s.halfWidth + s.runoffR, 'stays inside');
  // Head-on and still pressing into the wall: the kart slides off and keeps going.
  const head = kartAt(walled, 150, 6, TOP), n = sampleAt(walled, 150).heading - Math.PI / 2;
  head.heading = n; head.vx = Math.sin(n) * TOP; head.vz = Math.cos(n) * TOP;
  const d0 = head.d;
  drive(head, walled, 3, () => ({ steer: .3 }));
  assert.ok(along(walled, d0, head.d) > 25 && speedOf(head) > 12, `head-on: moved ${along(walled, d0, head.d).toFixed(1)} m, ${speedOf(head).toFixed(1)} m/s`);
  // Scraping along a wall barely costs speed.
  const scrape = kartAt(walled, 150, 7, TOP);
  const scrapes = drive(scrape, walled, 3, () => ({ steer: .2 }));
  assert.ok(speedOf(scrape) > TOP * .85 && Math.abs(scrape.lateral) > 6.5, `scraping ${speedOf(scrape).toFixed(1)}`);
  assert.equal(scrapes.filter(e => e.type === 'wall').length, 0, 'scrapes are not impacts');
});

test('obstacles are solid and deflect the kart', () => {
  const track = clip(60, { obstacles: [{ at: .12, lat: 0, radius: 1.5, kind: 'cone' }] });
  const k = kartAt(track, track.length * .12 - 40, .3, TOP);
  const events = drive(k, track, 2.5, () => ({}));
  const o = track.obstacles[0];
  assert.ok(events.some(e => e.type === 'wall'));
  assert.ok(along(track, track.length * .12 - 40, k.d) > 30, 'kept going past it');
  assert.ok(Math.hypot(k.x - o.x, k.z - o.z) > o.radius, 'not inside');
});

test('ramps launch; a trick press in the window lands a boost, plain landings give nothing', () => {
  const track = clip(60, { ramps: [{ at: .2, lat: 0, width: 10, length: 8, height: 1.6 }] });
  const run = (pressAt: number | null) => {
    const k = kartAt(track, track.length * .2 - 50, 0, TOP);
    let launched = -1, vy = 0, air = 0, landed = false, boostAtLand = 0, prevGrounded = true;
    const events = drive(k, track, 3, (_, t) => {
      if (prevGrounded && !k.grounded && launched < 0) { launched = t; vy = k.vy; }
      if (!prevGrounded && k.grounded && !landed) { landed = true; boostAtLand = k.boostT; }
      if (!k.grounded) air = Math.max(air, k.air);
      prevGrounded = k.grounded;
      return { steer: pursue(track, k), press: pressAt !== null && launched >= 0 && Math.abs(t - launched - pressAt) < DT / 2 };
    });
    return { launched, vy, air, boostAtLand, events };
  };
  const plain = run(null);
  assert.ok(plain.launched > 0, 'left the lip');
  const slope = 1.6 / 8, expected = TOP * slope * 1.15 + 2;
  assert.ok(Math.abs(plain.vy - expected) < 1.2, `launch vy ${plain.vy.toFixed(2)} ≈ ${expected.toFixed(2)}`);
  assert.ok(plain.air > .6, `air time ${plain.air.toFixed(2)} s`);
  assert.equal(plain.boostAtLand, 0); assert.ok(!plain.events.some(e => e.type === 'trick'));
  const trick = run(.2);
  assert.equal(trick.events.filter(e => e.type === 'trick').length, 1);
  assert.ok(Math.abs(trick.boostAtLand - PHYSICS.trickTime) < .05, `trick boost ${trick.boostAtLand}`);
  const late = run(.55);
  assert.ok(!late.events.some(e => e.type === 'trick') && late.boostAtLand === 0, 'too late for a trick');
});

test('rolling hills keep the kart planted; only a real crest launches it (with a trick window)', () => {
  // Heights change linearly between control points 25 m apart, like authored courses: slope kinks everywhere.
  const hilly = (bumps: number[]) => clip(60, { points: [...Array.from({ length: 29 }, (_, i) => ({ x: 0, z: i * 25, y: bumps[i - 4] ?? 0 })), ...clip(60).def.points.slice(8)] });
  const ride = (track: Track) => {
    const k = kartAt(track, 20, 0, TOP * 1.3); k.boostT = 30; k.boostPower = .3;
    let frames = 0, launches = 0, window = 0;
    for (let i = 0; i < 60 * 18 && k.d < 690; i++) {
      const was = k.grounded; stepKart(k, input({ steer: pursue(track, k) }), p, track, DT, env());
      if (!k.grounded) frames++; if (was && !k.grounded) launches++; window = Math.max(window, k.trickT);
    }
    return { frames, launches, window };
  };
  const rolling = ride(hilly([2, 5, 9, 12, 13, 12, 9, 7, 6, 6, 7, 8, 8, 6, 3, 1]));
  assert.equal(rolling.frames, 0, `airborne for ${rolling.frames} frames on rolling hills`);
  const crest = ride(hilly([0, 0, 0, 0, 0, 0, 0, 8, 0]));
  assert.ok(crest.launches === 1 && crest.frames > 12 && crest.window > 0, `crest: ${crest.launches} launches, ${crest.frames} frames, trick window ${crest.window.toFixed(2)}`);
});

test('driving off a drop edge falls, then respawns at lastSafeD on the racing line with invulnerability', () => {
  const track = clip(60, {}, { edgeL: 'drop', y: 20 });
  const k = kartAt(track, 300, 0, TOP);
  let fell = false, safe = 0, respawned = false;
  for (let i = 0; i < 600 && !respawned; i++) {
    const evs = stepKart(k, input({ steer: -.5 }), p, track, DT, env());
    if (evs.some(e => e.type === 'fall') && !fell) { fell = true; safe = k.lastSafeD; beginRespawn(k); assert.ok(k.respawnT > 0); }
    if (evs.some(e => e.type === 'respawn')) respawned = true;
  }
  assert.ok(fell && respawned, 'fell and came back');
  assert.ok(Math.abs(k.d - safe) < .5, `placed at lastSafeD ${safe.toFixed(1)} (now ${k.d.toFixed(1)})`);
  assert.ok(Math.abs(k.lateral - sampleAt(track, k.d).line) < .5, 'on the racing line');
  assert.ok(k.grounded && Math.abs(angleDelta(k.heading, sampleAt(track, k.d).heading)) < .05, 'facing forward on the ground');
  assert.ok(Math.abs(speedOf(k) - PHYSICS.respawnSpeed) < .01 && k.invulnT > 1.4, 'rolling and invulnerable');
  assert.equal(applyHit(k, 'spin'), false);
});

test('a gap without a jump drops the kart; respawn lands past the gap', () => {
  const track = clip(60, { gaps: [{ from: .2, to: .22 }] });
  const g = track.gaps[0], k = kartAt(track, g.d0 - 30, 0, 15);
  let fell = false, respawned = false, beforeD = 0;
  for (let i = 0; i < 600 && !respawned; i++) {
    const evs = stepKart(k, input({ steer: pursue(track, k) }), p, track, DT, env());
    if (evs.some(e => e.type === 'fall') && !fell) { fell = true; beforeD = k.d; beginRespawn(k); }
    if (fell && !respawned) assert.ok(k.respawnT <= 0 || Math.abs(k.d - beforeD) < 1e-9, 'd holds still until release');
    if (evs.some(e => e.type === 'respawn')) respawned = true;
  }
  assert.ok(fell && respawned);
  assert.ok(k.d > g.d1 && k.d < g.d1 + 10, `respawned at ${k.d.toFixed(1)} after gap end ${g.d1.toFixed(1)}`);
  // Jumping it with a ramp clears it.
  const L = track.length, jump = clip(60, { gaps: [{ from: .2, to: .2 + 12 / L }], ramps: [{ at: .2 - 10 / L, lat: 0, width: 12, length: 8, height: 1.6 }] });
  const j = kartAt(jump, jump.length * .2 - 70, 0, TOP);
  const evs = drive(j, jump, 4, () => ({ steer: pursue(jump, j) }));
  assert.ok(!evs.some(e => e.type === 'fall') && j.d > jump.gaps[0].d1, 'cleared the gap');
  // A lip that ends right at the gap (no road under the first airborne frame) still launches with a trick window and landing boost.
  const flush = clip(60, { gaps: [{ from: .2, to: .2 + 12 / L }], ramps: [{ at: .2 - 8 / L, lat: 0, width: 12, length: 8, height: 1.6 }] });
  const f = kartAt(flush, flush.length * .2 - 70, 0, TOP);
  let window = 0, pressed = false, landBoost = 0;
  const fe = drive(f, flush, 4, () => {
    window = Math.max(window, f.trickT);
    if (f.tricked && f.grounded === false) landBoost = -1; else if (landBoost === -1 && f.grounded) landBoost = f.boostT;
    const press = !pressed && !f.grounded && f.trickT > 0; if (press) pressed = true;
    return { steer: pursue(flush, f), press };
  });
  assert.ok(window > .3 && fe.some(e => e.type === 'trick') && !fe.some(e => e.type === 'fall'), `flush lip: window ${window.toFixed(2)}, events ${fe.map(e => e.type).join()}`);
  assert.ok(landBoost > PHYSICS.trickTime - .1, `tricked landing boosts (${landBoost.toFixed(2)} s)`);
});

test('rocket start and stall windows; nothing moves before GO', () => {
  const start = (pressAt: number[]) => {
    const k = kartAt(oval, 100), x0 = k.x, z0 = k.z, events: string[] = [];
    let hop = 0, speedAt1 = 0;
    for (let t = -3.5 + DT; t < 1.5; t += DT) {
      if (pressAt.some(pt => Math.abs(pt - t) < DT / 2)) hop++;
      for (const e of stepKart(k, input({ hop }), p, oval, DT, env(t))) events.push(e.type);
      if (t < 0) assert.ok(k.x === x0 && k.z === z0, 'parked during the countdown');
      if (Math.abs(t - 1) < DT / 2) speedAt1 = speedOf(k);
    }
    return { events, speedAt1 };
  };
  const plain = start([]), rocket = start([-.2]), stall = start([-1]), early = start([-2.5, -.1]), grace = start([.03]), spam = start(Array.from({ length: 30 }, (_, i) => -3 + i * .1));
  assert.deepEqual(plain.events, []);
  assert.deepEqual(rocket.events, ['rocket-start']);
  assert.deepEqual(stall.events, ['stall']);
  assert.deepEqual(early.events, ['rocket-start'], 'presses before the window are ignored');
  assert.deepEqual(grace.events, ['rocket-start'], 'a hair after GO still counts');
  assert.deepEqual(spam.events, ['stall'], 'mashing stalls');
  assert.ok(rocket.speedAt1 > plain.speedAt1 + 8, `rocket ${rocket.speedAt1.toFixed(1)} vs ${plain.speedAt1.toFixed(1)}`);
  assert.ok(stall.speedAt1 < plain.speedAt1 - 5, `stall ${stall.speedAt1.toFixed(1)}`);
});

test('spins and tumbles: lose control and speed, recover facing forward, then brief invulnerability', () => {
  const k = kartAt(oval, 150, 0, TOP), h0 = k.heading;
  assert.equal(applyHit(k, 'spin'), true);
  assert.equal(applyHit(k, 'tumble'), false, 'no hit-lock while reeling');
  drive(k, oval, PHYSICS.spinTime, () => ({ steer: 1 }));
  assert.equal(k.spinT, 0);
  assert.ok(Math.abs(angleDelta(h0, k.heading)) < .05, 'spun a full turn');
  assert.ok(speedOf(k) > TOP * .28 && speedOf(k) < TOP * .45, `after spin ${speedOf(k).toFixed(1)}`);
  assert.ok(k.invulnT > .6, 'post-hit invulnerability');
  assert.equal(applyHit(k, 'spin'), false);
  drive(k, oval, 1, () => ({}));
  assert.equal(k.invulnT, 0);
  assert.equal(applyHit(k, 'tumble'), true);
  assert.ok(!k.grounded && k.vy > 5, 'tumble pops up');
  const v0 = speedOf(k);
  drive(k, oval, PHYSICS.tumbleTime, () => ({}));
  assert.ok(k.grounded && speedOf(k) < v0 * .2, `after tumble ${speedOf(k).toFixed(1)}`);
  assert.ok(k.invulnT > .6);
  drive(k, oval, 1, () => ({ steer: pursue(oval, k) }));
  assert.ok(speedOf(k) > 10, 'drives away');
  // Shock: a short spin plus a 3 s speed cut; shield absorbs; star and respawn block.
  const s = kartAt(oval, 150, 0, TOP), hs = s.heading;
  assert.equal(applyHit(s, 'shock'), true);
  drive(s, oval, PHYSICS.shockSpin + DT, () => ({}));
  assert.ok(Math.abs(angleDelta(hs, s.heading)) < .06, 'shock spin completes a turn');
  drive(s, oval, 1.5, () => ({ steer: pursue(oval, s) }));
  assert.ok(s.shockT > 0 && speedOf(s) <= TOP * .7 + .01);
  const sh = kartAt(oval, 150); sh.shieldT = 5;
  assert.equal(applyHit(sh, 'tumble'), false); assert.equal(sh.shieldT, 0); assert.equal(sh.tumbleT, 0);
  const st = kartAt(oval, 150); st.starT = 3; assert.equal(applyHit(st, 'spin'), false);
  const ink = kartAt(oval, 150); assert.equal(applyHit(ink, 'ink'), true); assert.equal(ink.inkT, PHYSICS.inkTime); assert.equal(ink.spinT, 0);
});

test('kart contact separates, roughly conserves momentum, and pushes the lighter kart more', () => {
  const light = kartParams(0, 'zoomer', 100), heavy = kartParams(2, 'tank', 100);
  const a = kartAt(arena, 50, -.9, 0), b = kartAt(arena, 50, .9, 0);
  a.vx = 0; a.vz = 0; b.vx = 8 * Math.cos(sampleAt(arena, 50).heading); b.vz = -8 * Math.sin(sampleAt(arena, 50).heading);   // b moves left into a
  const before = { ax: a.vx, az: a.vz, bx: b.vx, bz: b.vz };
  const pairs = collideKarts([a, b], [light, heavy]);
  assert.deepEqual(pairs, [[0, 1]]);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 2 * PHYSICS.bodyRadius - 1e-6, 'separated');
  const px = light.weight * a.vx + heavy.weight * b.vx, pz = light.weight * a.vz + heavy.weight * b.vz;
  const px0 = light.weight * before.ax + heavy.weight * before.bx, pz0 = light.weight * before.az + heavy.weight * before.bz;
  assert.ok(Math.hypot(px - px0, pz - pz0) < 1e-9, 'momentum conserved');
  const dvA = Math.hypot(a.vx - before.ax, a.vz - before.az), dvB = Math.hypot(b.vx - before.bx, b.vz - before.bz);
  assert.ok(dvA > dvB * 1.5, `light Δv ${dvA.toFixed(2)} vs heavy ${dvB.toFixed(2)}`);
  // Gentle rubbing is not a bump; star contact tumbles the other kart.
  const c = kartAt(arena, 80, -1, 20), d = kartAt(arena, 80, 1, 20);
  assert.deepEqual(collideKarts([c, d], [p, p]), []);
  const e = kartAt(arena, 80, -1, 20), f = kartAt(arena, 80, 1, 20);
  e.starT = 3; collideKarts([e, f], [p, p]);
  assert.ok(f.tumbleT > 0 && e.tumbleT === 0);
  // Bodies are longer than wide: nose-to-tail contact happens further out than side-by-side, and a
  // diagonal neighbour whose corner overlaps is pushed out even though the centres are > 2.5 m apart.
  const tail = kartAt(arena, 140, 0, 0), nose = kartAt(arena, 137.2, 0, 0);
  collideKarts([tail, nose], [p, p]);
  assert.ok(Math.abs(Math.hypot(tail.x - nose.x, tail.z - nose.z) - 2 * (PHYSICS.bodyRadius + PHYSICS.bodyHalfLength)) < .05, 'nose to tail');
  assert.ok(2 * (PHYSICS.bodyRadius + PHYSICS.bodyHalfLength) < PHYSICS.contactRadius * 2 + .5, 'items star-contact radius still covers a nose-to-tail ram');
  const g = kartAt(arena, 170, 0, 0), h = kartAt(arena, 172.2, 1.5, 0), gap0 = Math.hypot(g.x - h.x, g.z - h.z);
  collideKarts([g, h], [p, p]);
  assert.ok(gap0 > 2.5 && Math.hypot(g.x - h.x, g.z - h.z) > gap0 + .05, 'diagonal overlap pushed apart');
  const up = kartAt(arena, 110, 0, 0), air = kartAt(arena, 110, .5, 0); air.y += 3;
  assert.deepEqual(collideKarts([up, air], [p, p]), []); assert.ok(Math.abs(up.x - kartAt(arena, 110).x) < 1e-9, 'no contact across heights');
});

test('slipstream: tucked in behind a fast kart charges, then boosts', () => {
  const k = kartAt(oval, 150, 0, TOP);
  const events = drive(k, oval, 2, () => ({ steer: pursue(oval, k) }), () => {
    const lead = pointAt(oval, k.d + 8, 0);
    return env(10, [{ x: lead.x, z: lead.z, heading: lead.heading, speed: TOP }]);
  });
  const slip = events.find(e => e.type === 'slipstream');
  assert.ok(slip && Math.abs(slip.t - PHYSICS.slipCharge) < .05, `slipstream at ${slip?.t}`);
  assert.ok(k.slipT > 0 || k.boostT > 0);
  const off = kartAt(oval, 150, 0, TOP);
  const none = drive(off, oval, 2, () => ({ steer: pursue(oval, off) }), () => { const lead = pointAt(oval, off.d + 8, 5); return env(10, [{ x: lead.x, z: lead.z, heading: lead.heading, speed: TOP }]); });
  assert.ok(!none.some(e => e.type === 'slipstream'), 'no draft when off the line');
});

/* ---------------- Rainbow Road mechanics (DESIGN §9) ---------------- */
const LAP = oval.length, at = (d: number) => d / LAP;
/** Steer toward a fixed lateral a little ahead (a lane holder). */
const lane = (track: Track, k: KartState, lat: number) => { const t = pointAt(track, k.d + 18, lat); return clamp(-angleDelta(k.heading, headingOf(t.x - k.x, t.z - k.z)) * 3, -1, 1); };
/** Run a kart down the straight from d=150 in a lane; per-step speed and height above the road are recorded. */
function run(track: Track, lat: number, seconds: number, o: { speed?: number; air?: (k: KartState) => Control; time?: boolean } = {}) {
  const k = kartAt(track, 150, lat, o.speed ?? TOP), log: { v: number; h: number; vy: number; grounded: boolean; lat: number; d: number; boostT: number }[] = [];
  const events = drive(k, track, seconds, kk => { log.push({ v: speedOf(kk), h: kk.y - pointAt(track, kk.d, kk.lateral).y, vy: kk.vy, grounded: kk.grounded, lat: kk.lateral, d: kk.d, boostT: kk.boostT });
    return kk.grounded || !o.air ? { steer: lane(track, kk, lat) } : o.air(kk); }, o.time ? t => env(10 + t) : undefined);
  const landing = log.findIndex((l, j) => j > 0 && l.grounded && !log[j - 1].grounded);
  return { k, events, log, landing: log[landing], air: log.filter(l => !l.grounded).length * DT, apex: Math.max(...log.map(l => l.h)) };
}

test('star rings: flying or driving through the disc boosts once with a kick; beside, under or backwards gives nothing', () => {
  const ring = (lat: number, height: number) => clip(60, { rings: [{ at: at(200), lat, height }] });
  const through = run(ring(0, 2.6), 0, 3), hits = through.events.filter(e => e.type === 'ring');
  assert.equal(hits.length, 1, 'one ring per pass'); assert.equal(hits[0].value, 0);
  const i = Math.round(hits[0].t / DT);
  assert.ok(through.log[i + 1].v - through.log[i].v > PHYSICS.ringKick - .5, `kick ${(through.log[i + 1].v - through.log[i].v).toFixed(2)} m/s`);
  assert.ok(Math.max(...through.log.map(l => l.v)) > TOP * 1.3, 'boosted past top speed');
  for (const [lat, height] of [[5, 2.6], [0, 8]]) assert.ok(!run(ring(lat, height), 0, 3).events.some(e => e.type === 'ring'), `ring at lat ${lat}, ${height} m up is missed`);
  // Reversing back through it never counts.
  const track = ring(0, 2.6), back = kartAt(track, 206, 0, 0);
  const rev = drive(back, track, 3, () => ({ brake: true }));
  assert.ok(back.d < 200 && !rev.some(e => e.type === 'ring'), 'reversing through is not a pass');
});

test('springs launch a grounded kart with a trick window; a trick lands a boost; missing the pad does nothing', () => {
  const track = clip(60, { springs: [{ at: at(200), lat: 0, width: 6 }] });
  const plain = run(track, 0, 4), spring = plain.events.filter(e => e.type === 'spring');
  assert.equal(spring.length, 1); assert.equal(spring[0].value, 0);
  const i = Math.round(spring[0].t / DT);
  assert.ok(Math.abs(plain.log[i + 1].vy - 15) < .6, `launch vy ${plain.log[i + 1].vy.toFixed(2)}`);
  assert.ok(Math.abs(plain.apex - 15 ** 2 / (2 * PHYSICS.gravity)) < .4, `apex ${plain.apex.toFixed(2)} m`);
  assert.ok(Math.abs(plain.air - 2 * 15 / PHYSICS.gravity) < .12, `air ${plain.air.toFixed(2)} s`);
  let pressed = false;
  const trick = run(track, 0, 4, { air: kk => { const press = !pressed && kk.trickT > 0; pressed ||= press; return { press }; } });
  assert.equal(trick.events.filter(e => e.type === 'trick').length, 1, 'trick in the spring window');
  assert.ok(Math.abs(trick.landing.boostT - PHYSICS.trickTime) < .05 && plain.landing.boostT === 0, `tricked landing boost ${trick.landing.boostT.toFixed(2)} s`);
  assert.ok(!run(track, 5, 4).events.some(e => e.type === 'spring'), 'beside the pad');
});

test('gravity zones: low gravity stretches flights and crests, drift hops stay snappy, and the air path can be steered', () => {
  const moon = { gravity: [{ from: at(100), to: at(500), scale: .45 }] };
  const norm = run(clip(60, { springs: [{ at: at(200), lat: 0, width: 6 }] }), 0, 6), low = run(clip(60, { ...moon, springs: [{ at: at(200), lat: 0, width: 6 }] }), 0, 6);
  assert.ok(Math.abs(low.air / norm.air - 1 / .45) < .15, `air ${norm.air.toFixed(2)} → ${low.air.toFixed(2)} s`);
  assert.ok(Math.abs(low.apex - norm.apex / .45) < .8, `apex ${norm.apex.toFixed(2)} → ${low.apex.toFixed(2)} m`);
  // A hump that full gravity holds the kart onto launches it in the zone.
  const hump = (extra: Partial<TrackDef>) => clip(60, { points: [...Array.from({ length: 29 }, (_, i) => ({ x: 0, z: i * 25, y: i === 11 ? 5 : 0 })), ...clip(60).def.points.slice(8)], ...extra });
  const full = run(hump({}), 0, 5).air, floaty = run(hump(moon), 0, 5).air;
  assert.ok(full <= .1 && floaty > .5, `hump air: ${full.toFixed(2)} s at full gravity, ${floaty.toFixed(2)} s in the zone`);
  // A drift hop lasts the same in and out of the zone.
  const hopAir = (track: Track) => { const k = kartAt(track, 300, 0, TOP); let air = 0; drive(k, track, 1, (_, t) => { if (!k.grounded) air += DT; return { press: t === 0 }; }); return air; };
  assert.ok(Math.abs(hopAir(clip(60, moon)) - hopAir(oval)) < 2 * DT, 'drift hop unchanged');
  // Holding a steer in the air bends a moon flight; outside a zone the flight path stays ballistic.
  const drift = (extra: Partial<TrackDef>) => {
    const track = clip(60, { ...extra, springs: [{ at: at(200), lat: 0, width: 6 }] });
    const lat = (steer: number) => run(track, 0, 6, { air: () => ({ steer }) }).landing.lat;
    return lat(1) - lat(0);
  };
  assert.ok(drift(moon) > 1.5, `moon air control ${drift(moon).toFixed(2)} m`);
  assert.ok(Math.abs(drift({})) < .3, `normal air control ${drift({}).toFixed(2)} m`);
});

test('bumpers knock karts sideways once per touch, keep most of their speed, never spin them and are seen where they hit', () => {
  const bumper = (o: Partial<{ amp: number; period: number }> = {}) => clip(60, { movers: [{ at: at(200), lat: 0, amp: o.amp ?? 0, period: o.period ?? 3, radius: 1.6, kind: 'star_bumper' }] });
  const track = bumper(), m = track.movers[0];
  for (const lat of [1, -1, 0]) {
    const k = kartAt(track, 150, lat, TOP);
    let after = { lat: 0, fwd: 0 }, hits: KartEvent[] = [];
    for (let i = 0; i < 180; i++) for (const e of stepKart(k, input(), p, track, DT, env())) {
      if (e.type !== 'bumper') continue;
      if (!hits.length) { const s = sampleAt(track, k.d); after = { lat: k.vx * s.rx + k.vz * s.rz, fwd: k.vx * s.tx + k.vz * s.tz }; }
      hits.push(e);
    }
    assert.equal(hits.length, 1, `lat ${lat}: one knock per touch`); assert.equal(hits[0].value, 0);
    assert.ok(Math.abs(Math.abs(after.lat) - PHYSICS.bumperSpeed) < 1.5 && (lat === 0 || Math.sign(after.lat) === Math.sign(lat)), `lat ${lat}: knocked ${after.lat.toFixed(1)} m/s sideways, away from the bumper`);
    assert.ok(after.fwd > TOP * (PHYSICS.bumperKeep - .1), `lat ${lat}: kept ${(after.fwd / TOP * 100).toFixed(0)}% of its speed`);
    assert.ok(k.spinT === 0 && k.tumbleT === 0 && forwardDistance(track, m.d, k.d) > 20, `lat ${lat}: no spin, drove on past it`);
  }
  // A sliding bumper catches a slow kart standing in its sweep: one knock, faster than the bumper, and it ends outside it.
  const slide = bumper({ amp: 6, period: 3 }), sm = slide.movers[0], k = kartAt(slide, 200, -4, 4);   // the bumper starts at +5.2 m, sliding left
  const events: (KartEvent & { t: number })[] = [];
  for (let i = 0; i < 90; i++) {
    const time = 10 + i * DT;
    for (const e of stepKart(k, input({ brake: true }), p, slide, DT, env(time))) events.push({ ...e, t: time });
    const b = moverPosition(slide, sm, time);
    assert.ok(Math.hypot(k.x - b.x, k.z - b.z) >= sm.radius + PHYSICS.kartRadius - 1e-6, 'never inside the bumper');
  }
  assert.equal(events.filter(e => e.type === 'bumper').length, 1, 'one knock');
});

test('respawns never land on a spring, inside a bumper sweep or just before a gap', () => {
  const track = clip(60, { springs: [{ at: at(200), lat: 0 }], movers: [{ at: at(300), lat: 1, amp: 4, period: 3, radius: 1.6, kind: 'star_bumper' }],
    gaps: [{ from: at(420), to: at(434) }], ramps: [{ at: at(410), lat: 0, width: 16, length: 8 }] });
  for (let d = 150; d < 480; d++) {
    const s = respawnSpot(track, d);
    for (const sp of track.springs) assert.ok(Math.abs(s.lateral - sp.lat) > sp.halfWidth + 1 || forwardDistance(track, sp.d0 - 3, s.d) > forwardDistance(track, sp.d0 - 3, sp.d1 + 3), `from ${d}: respawn at ${s.d.toFixed(1)} is on the spring`);
    for (const m of track.movers) assert.ok(Math.abs(signedDistance(track, s.d, m.d)) >= m.radius + 3 || Math.abs(s.lateral - m.lat) >= m.amp + m.radius + 1, `from ${d}: respawn at ${s.d.toFixed(1)} is in the bumper sweep`);
    for (const g of track.gaps) assert.ok(forwardDistance(track, s.d, g.d0) >= 50 && forwardDistance(track, g.d0, s.d) > forwardDistance(track, g.d0, g.d1), `from ${d}: respawn at ${s.d.toFixed(1)} before the gap`);
    assert.ok(forwardDistance(track, d, s.d) < 90, 'never pushed far ahead');
  }
});

/* ---------------- Loop-the-loop (DESIGN §9.1) ---------------- */
const looped = clip(60, { loops: [{ at: at(300), length: 44, radius: 13, tilt: 32 }] }), LOOP = looped.loops[0];
const LANE = sampleAt(looped, LOOP.d0).halfWidth - PHYSICS.kartRadius, v3 = (k: KartState) => Math.hypot(k.vx, k.vy, k.vz);
/** Drive with a per-step controller, recording the state before every step (and the final one). */
function record(k: KartState, seconds: number, ctrl: (k: KartState, t: number) => Control = () => ({})) {
  const log: KartState[] = [], events = drive(k, looped, seconds, (s, t) => { log.push({ ...s }); return ctrl(s, t); });
  log.push({ ...k });
  return { log, events };
}

test('loop: entry, ride and exit are continuous in position, heading and speed; d only moves forward; out on the same lateral', () => {
  const k = kartAt(looped, LOOP.d0 - 40, 1.5, TOP), { log, events } = record(k, 6);
  assert.equal(events.filter(e => e.type === 'loop').length, 1, 'one loop event, on entry');
  const ride = log.filter(s => s.loop > 0);
  assert.ok(ride.length > 90 && Math.max(...ride.map(s => s.y)) > log[0].y + 2 * LOOP.radius - .5, `rode ${ride.length} steps, over the top`);
  for (let i = 1; i < log.length; i++) {
    const a = log[i - 1], b = log[i], step = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    assert.ok(step <= Math.max(v3(a), v3(b)) * DT * 1.1 + .01, `jump of ${step.toFixed(2)} m at θ ${b.loop.toFixed(2)}`);
    assert.ok(Math.abs(v3(b) - v3(a)) < .5, `speed ${v3(a).toFixed(1)} → ${v3(b).toFixed(1)} at θ ${b.loop.toFixed(2)}`);
    const moved = signedDistance(looped, a.d, b.d);
    assert.ok(moved > 0 && moved < 1, `d moved ${moved.toFixed(2)} m at θ ${b.loop.toFixed(2)}`);
    if ((a.loop > 0) !== (b.loop > 0)) assert.ok(Math.abs(angleDelta(a.heading, b.heading)) < .03, `heading kink ${angleDelta(a.heading, b.heading).toFixed(3)} at the ${b.loop > 0 ? 'entry' : 'exit'}`);
    if (b.loop > 0) {
      const pose = loopPose(LOOP, b.loop, b.lateral);
      assert.ok(b.grounded && Math.hypot(pose.x - b.x, pose.y - b.y, pose.z - b.z) < 1e-9 && Math.abs(angleDelta(pose.heading, b.heading)) < 1e-9, 'held on the ribbon');
      assert.ok(Math.abs(signedDistance(looped, LOOP.d0 + loopLength(looped, LOOP) * b.loop / (2 * Math.PI), b.d)) < 1e-6, 'd = d0 + length·θ/2π');
    }
  }
  const out = log.find(s => s.loop === 0 && forwardDistance(looped, LOOP.d1, s.d) < 5)!;
  assert.ok(out && Math.abs(out.lateral - 1.5) < .01 && out.grounded && v3(out) >= TOP - .01, `exit lateral ${out?.lateral.toFixed(2)}, ${v3(out).toFixed(1)} m/s`);
  assert.ok(Math.abs(angleDelta(out.heading, sampleAt(looped, out.d).heading)) < .01 && !events.some(e => e.type === 'fall' || e.type === 'respawn'));
});

test('loop: a crawler is lifted to 0.6 × top without a pop, then never drops below it — braking, tumbled — and exits at its own speed', () => {
  const k = kartAt(looped, LOOP.d0 - 3, 0, 6), floor = PHYSICS.loopMin * TOP;
  let low = Infinity, hit = false, reached = false;
  const { log, events } = record(k, 7, s => {
    if (s.loop > 0 && reached) low = Math.min(low, v3(s));
    reached ||= s.loop > 0 && v3(s) >= floor - 1e-9;
    if (!hit && s.loop > 2) hit = applyHit(s, 'tumble');
    return { brake: s.loop > 0 };
  });
  for (let i = 1; i < log.length; i++) {
    const a = log[i - 1], b = log[i];
    if (b.loop > 0 && v3(b) < floor) assert.ok(v3(b) >= v3(a) - 1e-9 && v3(b) - v3(a) < 1, `below the floor: ${v3(a).toFixed(2)} → ${v3(b).toFixed(2)} m/s`);
    if ((a.loop > 0) !== (b.loop > 0)) assert.ok(Math.abs(v3(b) - v3(a)) < .5, `${b.loop > 0 ? 'entry' : 'exit'} ${v3(a).toFixed(1)} → ${v3(b).toFixed(1)} m/s`);
  }
  assert.ok(hit && reached && low >= floor - 1e-9, `slowest ${low.toFixed(2)} m/s (min ${floor.toFixed(2)})`);
  assert.ok(log.every(s => s.loop === 0 || s.grounded), 'the tumble never lifts it off the ribbon');
  assert.ok(!events.some(e => e.type === 'fall' || e.type === 'respawn') && k.loop === 0 && forwardDistance(looped, LOOP.d1, k.d) < 200, 'came out the other side');
});

test('loop: steering slides across the lane but never out of it; a kart that came in wide is eased in', () => {
  const k = kartAt(looped, LOOP.d0 - 2, LANE + 1.5, TOP);
  let t0 = -1, widest = 0, left = 0;
  record(k, 4, (s, t) => {
    if (s.loop > 0 && t0 < 0) t0 = t;
    if (s.loop > 0 && t - t0 > .3) widest = Math.max(widest, Math.abs(s.lateral));
    if (s.loop > 0) left = Math.min(left, s.lateral);
    if (s.loop > 0) assert.ok(Math.abs(angleDelta(s.heading, loopPose(LOOP, s.loop, s.lateral).heading)) < 1e-9, 'heading comes from the loop');
    return { steer: s.loop > .8 ? -1 : 1 };
  });
  assert.ok(widest <= LANE + 1e-6 && left < -LANE + .01, `lane ±${LANE.toFixed(2)}: widest ${widest.toFixed(2)}, left ${left.toFixed(2)}`);
});

test('loop: a charged drift fires its mini-turbo at the entry; hops do nothing inside', () => {
  const k = kartAt(looped, LOOP.d0 - 1, 0, TOP);
  Object.assign(k, { drift: 1, driftCharge: 1.8, driftTier: 2 });
  const { log, events } = record(k, 1.5, (s, t) => ({ drift: true, steer: .3, press: s.loop > 0 && Math.round(t * 60) % 10 === 0 }));
  const turbo = events.find(e => e.type === 'mini-turbo'), entry = events.find(e => e.type === 'loop');
  assert.ok(turbo && entry && turbo.value === 2 && turbo.t === entry.t, 'orange turbo at the entry');
  assert.ok(log.filter(s => s.loop > 0).every(s => s.drift === 0 && s.grounded && s.hopT === 0) && log.find(s => s.loop > 0)!.boostT > 1);
});

test('loop: kart contact inside pushes riders apart across the lane and keeps them on it', () => {
  const a = kartAt(looped, LOOP.d0 - 4, -.6, TOP), b = kartAt(looped, LOOP.d0 - 4, .6, TOP), pair = [a, b];
  for (let i = 0; i < 240; i++) {
    for (const k of pair) stepKart(k, input(), p, looped, DT, env());
    if (a.loop > .5 && b.loop > .5) collideKarts(pair, [p, p]);
    if (a.loop > 1 && b.loop > 1) assert.ok(Math.abs(a.lateral) <= LANE + 1e-9 && Math.abs(b.lateral) <= LANE + 1e-9, 'inside the lane');
    if (a.loop > 1.2 && a.loop < 5) assert.ok(b.lateral - a.lateral > 2 * PHYSICS.bodyRadius - .05, `side by side ${(b.lateral - a.lateral).toFixed(2)} m apart`);
  }
  assert.ok(pair.every(k => k.loop === 0 && forwardDistance(looped, LOOP.d1, k.d) < 150 && Number.isFinite(k.x + k.y + k.z)), 'both came out');
});

test('loop: riders one behind the other on the steep and upside-down parts collide along the ribbon instead of passing through', () => {
  for (const theta of [1.3, Math.PI, 4.2]) {
    const a = kartAt(looped, LOOP.d0 - 4, 0, TOP), b = kartAt(looped, LOOP.d0 - 4, .3, TOP), pair = [a, b];
    for (const [k, gap] of [[a, 0], [b, 1.2]] as const) {
      const th = theta + gap / loopPose(LOOP, theta, 0).dsdTheta, pose = loopPose(LOOP, th, k.lateral);
      Object.assign(k, { loop: th, x: pose.x, y: pose.y, z: pose.z, vx: pose.tx * TOP, vy: pose.ty * TOP, vz: pose.tz * TOP, heading: pose.heading, d: LOOP.d0 + loopLength(looped, LOOP) * th / (2 * Math.PI) });
    }
    b.vx *= .8; b.vy *= .8; b.vz *= .8;                                    // a is catching b
    assert.ok(Math.abs(a.y - b.y) > .3 || theta === Math.PI, 'far apart in height');
    let closest = Infinity;
    for (let i = 0; i < 30; i++) {
      collideKarts(pair, [p, p]);
      for (const k of pair) stepKart(k, input(), p, looped, DT, env());
      if (a.loop > 0 && b.loop > 0) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
    assert.ok(closest > 2 * PHYSICS.bodyRadius - .15, `θ ${theta.toFixed(2)}: centres ${closest.toFixed(2)} m apart`);
    assert.ok(pair.every(k => k.loop > 0 && k.grounded) && b.loop > a.loop, 'both still on the ribbon, in order');
  }
});

test('loop: backing off the exit meets a wall at the mouth instead of falling onto the footprint', () => {
  const k = kartAt(looped, LOOP.d1 + 6, 0, 0);
  const { log, events } = record(k, 4, () => ({ brake: true }));
  assert.ok(!events.some(e => e.type === 'fall' || e.type === 'respawn') && log.every(s => s.grounded && forwardDistance(looped, LOOP.d1, s.d) < 7), events.map(e => e.type).join());
});

test('loop: missing the entry (flying over it) falls into the void; respawns never land on the footprint', () => {
  const k = kartAt(looped, LOOP.d0 - 5, 0, TOP); k.grounded = false; k.y += 4;
  const { events } = record(k, 3);
  assert.ok(!events.some(e => e.type === 'loop') && events.some(e => e.type === 'fall'), events.map(e => e.type).join());
  for (let d = LOOP.d0 - 10; d < LOOP.d1 + 10; d++) { const r = respawnSpot(looped, d); assert.ok(forwardDistance(looped, LOOP.d0 - 2, r.d) > loopLength(looped, LOOP) + 4, `from ${d.toFixed(0)}: ${r.d.toFixed(1)}`); }
});

test('loop: deterministic, and a replay from a rounded snapshot mid-loop stays on the same path', () => {
  const run = () => { const k = kartAt(looped, LOOP.d0 - 30, 0, TOP); record(k, 5, (s, t) => { if (Math.abs(t - 2) < DT / 2) applyHit(s, 'spin'); return { steer: Math.sin(t * 3), brake: t > 3 && t < 3.3 }; }); return JSON.stringify(k); };
  assert.equal(run(), run());
  const k = kartAt(looped, LOOP.d0 - 10, 2, TOP);
  record(k, 1.2);
  assert.ok(k.loop > 1, 'mid-loop');
  const r = (n: number, f: number) => Math.round(n * f) / f, copy: KartState = { ...k, x: r(k.x, 100), y: r(k.y, 100), z: r(k.z, 100), vx: r(k.vx, 100), vy: r(k.vy, 100), vz: r(k.vz, 100), d: r(k.d, 100), lateral: r(k.lateral, 100), loop: r(k.loop, 1000), heading: r(k.heading, 1000) };
  for (let i = 0; i < 90; i++) { stepKart(k, input({ steer: .4 }), p, looped, DT, env()); stepKart(copy, input({ steer: .4 }), p, looped, DT, env()); }
  assert.ok(Math.hypot(k.x - copy.x, k.y - copy.y, k.z - copy.z) < .05, `replay drifted ${Math.hypot(k.x - copy.x, k.y - copy.y, k.z - copy.z).toFixed(3)} m`);
});

test('deterministic: identical inputs give identical states', () => {
  const track = clip(18, { ramps: [{ at: .3, lat: 0, width: 10 }], boostPads: [{ at: .1, lat: 0 }], springs: [{ at: .2, lat: 0, width: 8 }], rings: [{ at: .22, lat: 0, height: 6 }],
    gravity: [{ from: .15, to: .28, scale: .45 }], movers: [{ at: .4, lat: 0, amp: 5, period: 2.5, radius: 1.6, kind: 'star_bumper' }] });
  const script = () => {
    const k = kartAt(track, 20, 0, 0), log: string[] = [];
    drive(k, track, 25, (_, t) => {
      const phase = Math.floor(t * 3) % 11;
      if (Math.abs(t - 7) < DT / 2) applyHit(k, 'spin');
      return { steer: phase < 4 ? pursue(track, k) : phase < 7 ? Math.sin(t * 2) : pursue(track, k, 9), drift: phase >= 4 && phase < 7, press: phase === 4 && Math.floor(t * 60) % 20 === 0 };
    }, t => env(t - 1));
    log.push(JSON.stringify(k));
    return log.join();
  };
  assert.equal(script(), script());
});

test('cost: stepping 10 karts is cheap enough for 60 Hz servers and client replays', tc => {
  const karts = Array.from({ length: 10 }, (_, i) => kartAt(oval, 100 + i * 12, (i % 3 - 1) * 4, TOP)), params = karts.map(() => p);
  const inputs = karts.map(() => input());
  const steps = 1200, t0 = performance.now();
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < karts.length; i++) { inputs[i].steer = pursue(oval, karts[i]); stepKart(karts[i], inputs[i], params[i], oval, DT, env()); }
    collideKarts(karts, params);
  }
  const perTick = (performance.now() - t0) / steps;
  tc.diagnostic(`${perTick.toFixed(3)} ms per 10-kart tick`);
  assert.ok(perTick < .5, `${perTick.toFixed(3)} ms per 10-kart tick`);
});
