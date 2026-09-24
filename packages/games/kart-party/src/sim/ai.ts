/* CPU drivers (DESIGN.md §5). botInput returns the same Input a human sends, so CPUs go through the identical
 * physics, drift and item code. Deterministic: randomness comes from raceRandom, per-bot variety from a hash.
 *
 * AiState usage: lane = smoothed personal lane offset (m); mistakeT = seconds of sloppy driving left;
 * itemDelay = seconds until the held item may be used (counts below 0 = seconds it has been ready, -999 = no item);
 * driftHold = > 0 seconds into a hop/drift attempt, < 0 cooldown before the next one;
 * targetD = countdown: planned start-press time (9 = none); racing: > 0 seconds stuck, < 0 reversing out. */
import { angleDelta, clamp, forwardX, forwardZ, headingOf, lerp, smoothstep, wrap } from './math';
import { forwardDistance, gravityScale, moverPosition, pointAt, sampleAt, signedDistance, type Track, type TrackRing, type TrackSample } from './track';
import { bend, PHYSICS, speedOf, turnRate } from './physics';
import { paramsFor, raceRandom } from './race';
import { ITEMS } from './items';
import { getTrack } from '../tracks/index';
import type { AiState, Difficulty, Input, Race, Racer } from './types';

const DT = 1 / 60, NO_ITEM = -999;
type Profile = {
  tier: 1 | 2 | 3; letGo: number; rocket: number; stall: number; trick: number; drift: number; lane: number; look: number;
  itemWait: [number, number]; aim: number; mistakes: number; boxes: boolean; pads: number; springs: number; rings: number;
};
const PROFILE: Record<Difficulty, Profile> = {
  easy: { tier: 1, letGo: .5, rocket: .1, stall: .15, trick: .25, drift: .45, lane: 3, look: .75, itemWait: [1.5, 5], aim: .09, mistakes: 1 / 22, boxes: false, pads: .3, springs: .3, rings: .3 },
  normal: { tier: 2, letGo: .35, rocket: .4, stall: .07, trick: .6, drift: .85, lane: 2.4, look: 1, itemWait: [.8, 3], aim: .06, mistakes: 1 / 60, boxes: true, pads: .7, springs: .6, rings: .6 },
  hard: { tier: 3, letGo: .2, rocket: .7, stall: .03, trick: .9, drift: 1, lane: 1.8, look: 1.25, itemWait: [.4, 1.8], aim: .04, mistakes: 0, boxes: true, pads: 1, springs: .9, rings: .9 },
};

/** Rubber-band multiplier on CPU top speed (around 1): trailing CPUs speed up, runaway leaders ease off. ±8% at most. */
export function botSkill(race: Race, racer: Racer): number {
  if (race.phase !== 'racing' || racer.finishTime !== null) return 1;
  let best = -Infinity;
  for (const r of race.racers) if (!r.bot && r.connected && r.finishTime === null && r.progress > best) best = r.progress;
  // Each CPU's form ebbs and flows a little over the race (its own phase), so the pack reshuffles on its own.
  const i = race.racers.indexOf(racer), form = .015 * Math.sin(i * 2.4 + racer.progress / 260);
  return (best === -Infinity ? 1 : 1 + .08 * Math.tanh((best - racer.progress) / 220)) * (1 + form);
}

/* ---------------- Track knowledge (cached per built track) ---------------- */
/** Curvature of the racing line itself (1/m, > 0 left), lightly smoothed. */
const lineCache = new WeakMap<Track, Float64Array>();
function lineCurvature(track: Track) {
  let k = lineCache.get(track);
  if (k) return k;
  const S = track.samples, n = S.length, px = S.map(s => s.x + s.rx * s.line), pz = S.map(s => s.z + s.rz * s.line), raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = wrap(i - 2, n), b = wrap(i + 2, n), c = wrap(i - 1, n), e = wrap(i + 1, n);
    const h0 = headingOf(px[i] - px[a], pz[i] - pz[a]), h1 = headingOf(px[b] - px[i], pz[b] - pz[i]);
    raw[i] = angleDelta(h0, h1) / (Math.hypot(px[e] - px[c], pz[e] - pz[c]) * 2 || 1);
  }
  k = new Float64Array(n);
  for (let i = 0; i < n; i++) { let sum = 0; for (let j = -3; j <= 3; j++) sum += raw[wrap(i + j, n)]; k[i] = sum / 7; }
  lineCache.set(track, k);
  return k;
}
/** Curvature to brake for: the racing line's, but never much less than the road's own (a line that straightens a tight
 * chicane on paper still has to be driven through it). */
const curvatureAt = (track: Track, d: number) => {
  const i = Math.floor(wrap(d, track.length) / track.spacing) % track.samples.length;
  return Math.max(Math.abs(lineCurvature(track)[i]), .75 * Math.abs(track.samples[i].curvature));
};
/** Pure-pursuit aim distance at speed v. */
const lookAhead = (v: number) => 6 + Math.max(v, 8) * .45;
/** Signed heading change of the course between two distances ahead (radians, > 0 = turning left). */
const turnBetween = (track: Track, d0: number, d1: number) => angleDelta(sampleAt(track, d0).heading, sampleAt(track, d1).heading);

/** Full-lock yaw rate (rad/s) at speed v, straight from the physics. */
const yawRate = (v: number, top: number, handling: number) => handling * turnRate(v, top);
/** Fastest speed that can still hold curvature k (fixed-point on the speed-dependent yaw rate). */
function cornerSpeed(k: number, top: number, handling: number, drift: boolean) {
  const a = Math.abs(k); if (a < 1e-4) return Infinity;
  let v = top * 1.4;
  for (let i = 0; i < 4; i++) v = yawRate(v, top, handling) * (drift ? 1.05 : .95) / a;
  return v;
}
const hash = (a: number, b: number) => {
  let h = Math.imul(a + 0x9e3779b9 | 0, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab | 0, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2d); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

/* ---------------- Driving ---------------- */
export function botInput(race: Race, racer: Racer): Input {
  const track = getTrack(race.track);
  const ai: AiState = racer.ai ??= { lane: 0, mistakeT: 0, itemDelay: NO_ITEM, driftHold: 0, targetD: 0 };
  const prof = PROFILE[racer.bot ? race.difficulty : 'normal'];
  const out: Input = { steer: 0, drift: false, brake: false, item: false, hop: racer.prevHop, fire: racer.prevFire, seq: racer.lastSeq || 1 };   // seq 0 would read as "no input"
  const press = (key: 'hop' | 'fire') => { out[key] = (racer[key === 'hop' ? 'prevHop' : 'prevFire'] + 1) & 255; };

  if (race.phase === 'countdown') {
    if (ai.targetD === 0) {  // plan the start once: rocket (hit the window), stall (too early) or nothing
      const roll = raceRandom(race), when = raceRandom(race);
      ai.targetD = roll < prof.rocket ? -.3 + when * .28 : roll < prof.rocket + prof.stall ? -1.3 + when * .8 : 9;
    }
    if (race.time >= ai.targetD && ai.targetD < 1) { press('hop'); ai.targetD = 9; }
    return out;
  }
  if (race.time < .5) ai.targetD = 0;
  if (racer.respawnT > 0 || racer.spinT > 0 || racer.tumbleT > 0) { ai.driftHold = Math.min(ai.driftHold, 0); ai.targetD = 0; return out; }
  // Riding a loop-the-loop the ribbon does the driving: drift gently toward the middle of the lane, items as usual.
  if (racer.loop > 0) {
    ai.driftHold = Math.min(ai.driftHold, 0); ai.targetD = 0; out.steer = clamp(-racer.lateral * .3, -.6, .6);
    if (racer.finishTime === null) useItems(race, track, racer, ai, prof, out, press, speedOf(racer));
    return out;
  }

  const idx = race.racers.indexOf(racer), p = paramsFor(race, racer), top = p.topSpeed, v = speedOf(racer), d = racer.d;
  const here = sampleAt(track, d), finished = racer.finishTime !== null;
  const wrongWay = Math.abs(angleDelta(here.heading, racer.heading)) > Math.PI / 2;

  // Personal lane: a slowly wandering offset from the racing line (different per bot), tucked in through corners.
  const look = lookAhead(v);
  const aheadK = Math.max(Math.abs(curvatureAt(track, d + look * .5)), Math.abs(curvatureAt(track, d + look)));
  const laneWant = (hash(idx * 131 + 7, Math.floor((racer.progress + idx * 37) / 140)) * 2 - 1) * prof.lane * (1 - smoothstep(.006, .03, aheadK) * .75);
  ai.lane += clamp(laneWant - ai.lane, -1.1 * DT, 1.1 * DT);

  // Where to be: racing line + lane, pulled toward useful features, then pushed around hazards.
  const aim = sampleAt(track, d + look);
  let lat = keepOn(aim, aim.line + ai.lane), aimDist = look;
  const feature = attractor(race, track, racer, prof, v, lat);
  if (feature) { lat = feature.lat; aimDist = clamp(feature.f, 7, look); }
  // A loop-the-loop ahead: move in near the middle of its lane, then for the last ~0.6 s hold the line and point straight up it
  // (no swerves in the run-in: the ribbon takes the heading from the lane, so a sideways entry would snap round).
  const loopIn = toLoop(track, d), runIn = loopIn < 6 + v * .6;
  if (loopIn < 12 + v * 1.2) { lat = runIn ? clamp(racer.lateral, -2.5, 2.5) : clamp(lat, -1.5, 1.5); aimDist = runIn ? Math.max(look, 30) : Math.max(aimDist, Math.min(loopIn + 12, 25)); }
  const avoid = runIn ? null : dodge(race, track, racer, lat, aimDist, v, prof);
  if (avoid) { lat = avoid.lat; aimDist = clamp(avoid.f, Math.max(6, v * .4), look); }   // a too-near aim point at speed makes the steering slam side to side
  if (!racer.grounded && racer.hopT <= 0) aimDist = look;   // in the air, steering only turns the nose: keep it calm for the landing
  // Jumping a gap: line up straight down the course and aim past the landing, not at the corner beyond it.
  const jump = gapAhead(track, d, v);
  if (jump) {
    const ramp = track.ramps.find(r => forwardDistance(track, r.d0, d + jump) < 90), land = sampleAt(track, d + jump + 10);
    aimDist = Math.min(jump + 10, Math.max(look, 25));   // near enough to correct a drift exit, far enough to fly straight
    lat = keepOn(land, ramp ? clamp(avoid ? lat : racer.lateral, ramp.lat - ramp.halfWidth * .3, ramp.lat + ramp.halfWidth * .3) : land.line);
  }
  // About to leave a ramp lip: settle into the planned lane early and fly straight (a sideways run-up becomes a sideways flight).
  const lip = jump || !racer.grounded ? undefined : track.ramps.find(r => Math.abs(racer.lateral - r.lat) < r.halfWidth && forwardDistance(track, d, r.d1) < v * .5 + 3);
  if (lip) { lat = clamp(lat, lip.lat - lip.halfWidth + 1, lip.lat + lip.halfWidth - 1); aimDist = Math.max(look, 25); }
  // Same for a low-gravity crest about to throw us into a long float: no lane changes at take-off.
  else if (!jump && racer.grounded && moonCrestAhead(track, d, v)) { lat = clamp(lat, racer.lateral - 1, racer.lateral + 1); aimDist = Math.max(look, 25); }

  // Sloppiness: easy mistakes and ink make the line wobble and the reactions late.
  if (ai.mistakeT > 0) ai.mistakeT -= DT;
  else if (!finished && raceRandom(race) < prof.mistakes * DT) ai.mistakeT = .6 + raceRandom(race) * .8;
  const wobble = (ai.mistakeT > 0 ? .9 : 0) + (racer.inkT > 0 ? 1 : 0);
  if (wobble && !avoid && !jump) lat += Math.sin(race.time * 2.3 + idx * 1.7) * wobble * 1.5;

  // Pure pursuit toward the aim point.
  const target = pointAt(track, d + aimDist, lat);
  // Pursue from where the current velocity carries us in 0.25 s, so drift slip and sideways momentum are accounted for.
  const toX = target.x - racer.x - racer.vx * .25, toZ = target.z - racer.z - racer.vz * .25, dist = Math.hypot(toX, toZ) || 1;
  const alpha = angleDelta(racer.heading, headingOf(toX, toZ));
  const omega = 2 * Math.max(v, 6) * Math.sin(alpha) / dist;
  const maxYaw = Math.max(.3, yawRate(Math.max(v, 3), top, p.handling));
  let steer = clamp(-omega / maxYaw * (racer.inkT > 0 ? .75 : 1), -1, 1);
  if (Math.abs(alpha) > 1.2 || wrongWay) steer = alpha > 0 ? -1 : 1;
  if (wobble) steer = clamp(steer + Math.sin(race.time * 5.1 + idx) * .18 * wobble, -1, 1);

  // Drifting: hop into real corners, hold through, release on exit.
  steer = drive(race, track, racer, ai, prof, out, press, steer, omega, v, top, p.handling, alpha, !!avoid);

  // Tricks: a hop press in the air window after a ramp lip or crest (hard bots almost always, easy ones rarely).
  if (!racer.grounded && racer.trickT > 0 && !racer.tricked && raceRandom(race) < 1 - Math.pow(1 - prof.trick, 1 / 10)) press('hop');

  // Braking: only when the upcoming line is tighter than we can hold at this speed. A crest or ramp lip that would launch
  // us brings the braking point for a corner just beyond it forward to the take-off: no brakes or grip in the air.
  const canDrift = racer.drift !== 0;
  let crest = track.ramps.reduce((m, r) => Math.abs(racer.lateral - r.lat) < r.halfWidth ? Math.min(m, forwardDistance(track, d, r.d1)) : m, Infinity);
  for (let s = 4; s < 14 + v * v / 30 && !jump; s += 4) {
    if (s < crest && v * v * bend(track, d + s) < -PHYSICS.gravity * .8) crest = s;
    const flown = s > crest && s < crest + v * 1.1, at = flown ? crest : s;   // landing into a turn needs extra margin
    const vmax = cornerSpeed(curvatureAt(track, d + s), top, p.handling, canDrift) * (flown ? .8 : 1);
    if (v > vmax + 1 && v * v - vmax * vmax > 2 * 5 * at) { out.brake = true; break; }
  }
  if (Math.abs(alpha) > 1 && v > 12 && racer.drift === 0) out.brake = true;

  // Unstick: sitting still for a while (nose in a wall, wedged on another kart) → reverse out, steering the other way.
  if (ai.targetD < 0) { ai.targetD = Math.min(0, ai.targetD + DT); out.brake = true; out.drift = false; steer = -steer || 1; }
  else if (v < 2.5 && racer.grounded && racer.stallT <= 0 && race.time > 1.5) { if ((ai.targetD += DT) > 1.1) ai.targetD = -.8; }
  else ai.targetD = 0;

  out.steer = clamp(steer, -1, 1);
  if (!finished) useItems(race, track, racer, ai, prof, out, press, v);
  return out;
}

/** Hop into drifts for real corners, steer the drift, and release at the corner exit (or at the target tier). */
function drive(race: Race, track: Track, racer: Racer, ai: AiState, prof: Profile, out: Input, press: (k: 'hop') => void,
  steer: number, omega: number, v: number, top: number, handling: number, alpha: number, dodging: boolean) {
  const d = racer.d;
  if (ai.driftHold < 0) { ai.driftHold = Math.min(0, ai.driftHold + DT); return steer; }
  if (racer.drift !== 0) {
    const dir = racer.drift;
    ai.driftHold += DT;
    // Effective drift steer = dir·(0.55 + 0.45·steer·dir) at ~1.25× yaw: invert it for the input we need.
    const want = -omega / (yawRate(v, top, handling) * 1.25);
    const into = want * dir, input = dir * clamp((into - .55) / .45, -1, 1);
    // Remaining turn in the drift's direction, and the room on each side judged where the slide puts us in ~0.35 s.
    const s0 = sampleAt(track, d), hw = s0.halfWidth, drifted = racer.lateral + (racer.vx * s0.rx + racer.vz * s0.rz) * .35;
    const ahead = turnBetween(track, d, d + 4 + v * .45) * -dir, outside = -drifted * dir, inside = hw - drifted * dir;
    // Hold a moment past the exit when the next turbo tier (up to our target) is only a few tenths away.
    const next = (PHYSICS.driftTiers as readonly number[])[racer.driftTier] ?? Infinity, nearlyNext = racer.driftTier < prof.tier && next - racer.driftCharge < .45 && inside > 3;
    // Let go at the exit (not on the straight just before turn-in: the hop comes early), early before a gap jump so the kart
    // lines up on the run-up, at the profile's tier, or when the drift can't follow the line (pinned wide wanting tighter,
    // or sliding across the inside even at full counter-steer).
    const release = (ahead < .08 && !nearlyNext && ai.driftHold > .45) || (toGap(track, d) < v * 2 && ahead < .3) || toLoop(track, d) < v * 1.5 || ahead < -.05 || (racer.driftTier >= prof.tier && ahead < prof.letGo) || (outside > hw - 1.2 && into > 1) || ((inside < 2.5 || dodging) && into < -.1) || (dodging && into > 1.1) || Math.abs(alpha) > 1.1 || ai.driftHold > 6;
    if (release) { ai.driftHold = -.3; return steer; }
    out.drift = true;
    return input;
  }
  if (ai.driftHold > 0) {  // hopped but no drift took hold (or the physics ended it): let go and cool down
    if (ai.driftHold < .5 && !racer.grounded) { ai.driftHold += DT; out.drift = true; return turnBetween(track, d, d + v * 2.2) > 0 ? -1 : 1; }
    ai.driftHold = -.25; return steer;
  }
  if (!racer.grounded || v < 13 || dodging || toGap(track, d) < v * 2.2 || toLoop(track, d) < v * 2.5 || gapAhead(track, d, v) || track.obstacles.some(o => forwardDistance(track, d, o.d) < v * 2.5) || racer.offroad || racer.boostT > 0 && racer.boostPower > .38) return steer;
  // A real corner: noticeable turn right away and a big total heading change ahead.
  const near = turnBetween(track, d + 2, d + 4 + v * .7), total = turnBetween(track, d, d + v * 2.2);
  if (Math.abs(near) < .3 || Math.abs(total) < .75 || Math.sign(near) !== Math.sign(total)) return steer;
  // Corner length decides whether a drift pays; weaker drivers skip some.
  if (hash(race.racers.indexOf(racer) * 977 + racer.lap, Math.floor(d / 60)) > prof.drift) return steer;
  const dir = total > 0 ? -1 : 1;
  if (steer * dir < -.3) return steer;   // still unwinding the previous bend: a drift now would turn the wrong way
  press('hop'); out.drift = true; ai.driftHold = DT;
  return dir;
}

/** Clamp a lateral onto the road, keeping extra room from unguarded drops. */
function keepOn(s: TrackSample, lat: number) {
  const room = (edge: 'wall' | 'drop', runoff: number) => s.halfWidth - (edge === 'drop' && runoff < 5 ? 2.6 : 1.7);
  return clamp(lat, -Math.max(0, room(s.edgeL, s.runoffL)), Math.max(0, room(s.edgeR, s.runoffR)));
}
/** A low-gravity crest within the next ~0.5 s that launches the kart at speed v (the road bends away faster than gravity
 * follows): there a sideways take-off becomes a long sideways float toward the edge. */
const moonCrestAhead = (track: Track, d: number, v: number) => {
  for (let s = 2; s < v * .5 + 2; s += 2) { const g = gravityScale(track, d + s); if (g < 1 && v * v * bend(track, d + s) < -PHYSICS.gravity * g * .9) return true; }
  return false;
};
/** Metres to the next loop-the-loop entry (Infinity when the course has none). */
const toLoop = (track: Track, d: number) => track.loops.reduce((m, l) => Math.min(m, forwardDistance(track, d, l.d0)), Infinity);
/** Metres to the start of the next gap (Infinity when the course has none). */
const toGap = (track: Track, d: number) => track.gaps.reduce((m, g) => Math.min(m, forwardDistance(track, d, g.d0)), Infinity);
/** Metres to the far side of a gap we are about to jump (or are flying over), else 0. */
function gapAhead(track: Track, d: number, v: number) {
  for (const g of track.gaps) {
    const to = forwardDistance(track, d, g.d0), span = forwardDistance(track, g.d0, g.d1);
    if (to < 12 + v * .8 || forwardDistance(track, g.d0, d) < span) return forwardDistance(track, d, g.d1);
  }
  return 0;
}

type Feature = { lat: number; f: number };
/** Only chase a feature when no real corner lies between here and it (never swerve off the line mid-corner). */
const straightTo = (track: Track, d: number, f: number) => Math.abs(turnBetween(track, d, d + f)) < .3 && Math.abs(turnBetween(track, d, d + f * .5)) < .25;
/** Will the kart's body cross ring r's height inside the disc: driving under it, or on its current flight path? */
function ringInReach(track: Track, racer: Racer, r: TrackRing, f: number, v: number) {
  const t = f / Math.max(v, 5), rise = racer.grounded ? 0 : racer.y - (r.y - r.height) + racer.vy * t - PHYSICS.gravity * gravityScale(track, racer.d) * t * t / 2;
  return Math.abs(rise + PHYSICS.ringCentre - r.height) < r.radius + PHYSICS.ringSlack - .6;
}
/** Ramps (always the ones that clear a gap; others for tricks), boost pads and lanes, springs, star rings and item boxes
 * the bot wants to hit. `want` is the lateral it would otherwise drive. */
function attractor(race: Race, track: Track, racer: Racer, prof: Profile, v: number, want: number): Feature | null {
  const d = racer.d, idx = race.racers.indexOf(racer);
  if (racer.starT > .5) {  // invincible: go bowling
    const prey = racerNear(race, track, racer, 3, 35, 8);
    if (prey) return { lat: prey.lateral, f: Math.max(3, signedDistance(track, d, prey.d)) };
  }
  for (const ramp of track.ramps) {
    const f = forwardDistance(track, d, ramp.d0);
    if (f > 90 || f < 1) continue;
    const essential = track.gaps.some(g => forwardDistance(track, ramp.d0, g.d0) < 60);
    const reachable = Math.abs(ramp.lat - racer.lateral) - ramp.halfWidth * .6 < f * .3 && straightTo(track, d, f + v * 1.2);   // straight through the flight too
    if (essential || (f < 60 && reachable && hash(race.racers.indexOf(racer), Math.floor(ramp.d0) + racer.lap * 7) < prof.trick))
      return { lat: ramp.lat + clamp(racer.lateral - ramp.lat, -ramp.halfWidth * (essential ? .2 : .4), ramp.halfWidth * (essential ? .2 : .4)), f };
  }
  for (const pad of track.pads) {
    const f = forwardDistance(track, d, pad.d0);
    if (f > 45 || f < 1 || hash(race.racers.indexOf(racer) + 31, Math.floor(pad.d0) + racer.lap * 13) > prof.pads || Math.abs(pad.lat - racer.lateral) - pad.halfWidth * .6 > Math.min(8, f * .3) || !straightTo(track, d, f)) continue;
    // A pad tucked in behind a rock is a line for brave humans, not for CPUs.
    if (track.obstacles.some(o => forwardDistance(track, o.d, pad.d0) < 30 && Math.abs(o.lateral - pad.lat) < pad.halfWidth + o.radius + 2)) continue;
    return { lat: pad.lat, f };
  }
  // Boost lanes: merge in gently (a lookahead ahead, never a swerve at speed) and ride them to the end, on the side nearest
  // the line we'd drive anyway.
  for (const z of track.zones) {
    const f = forwardDistance(track, d, z.d0), inside = forwardDistance(track, z.d0, d) < forwardDistance(track, z.d0, z.d1) - v * .3;
    const lat = clamp(want, z.latMin + .7, z.latMax - .7);
    if (z.surface !== 'boost' || !inside && (f > 45 || f < 1) || hash(idx + 43, Math.floor(z.d0) + racer.lap * 13) > prof.pads
      || Math.abs(lat - racer.lateral) > (inside ? lookAhead(v) : f + lookAhead(v)) * .2 || !straightTo(track, d, inside ? lookAhead(v) : f)) continue;
    return { lat, f: lookAhead(v) };
  }
  // Star rings: steer through the disc when we'll pass at its height (driving under a low ring, or flying at one), if that
  // needs only a gentle change of lane.
  let ring: (Feature & { r: TrackRing }) | null = null;
  for (const r of track.rings) {
    const f = forwardDistance(track, d, r.d);
    if (f < 2 || f > Math.max(30, v * 1.4) || hash(idx + 71, Math.floor(r.d) + racer.lap * 17) > prof.rings || Math.abs(r.lat - racer.lateral) > f * (racer.grounded ? .12 : .1) + 1
      || !ringInReach(track, racer, r, f, v) || racer.grounded && !straightTo(track, d, f)) continue;
    ring = { lat: r.lat, f: Math.max(f, v * .4), r }; break;
  }
  // Springs: line up in a pad's lane (under its ring, if one hangs over the arc) and launch straight down the road. Aim a
  // lookahead down the lane, not at the pad: a late swerve onto it launches the kart sideways off the edge.
  let spring: (Feature & { lo: number; hi: number; to: number }) | null = null;
  for (const s of track.springs) {
    const f = forwardDistance(track, d, s.d0), over = track.rings.find(r => forwardDistance(track, s.d0, r.d) < 60 && Math.abs(r.lat - s.lat) < 3);
    const lo = s.lat - s.halfWidth + .9, hi = s.lat + s.halfWidth - .9, lat = clamp(over?.lat ?? s.lat, lo, hi);
    if (f > Math.max(50, v * 2.2) || f < 1 || hash(idx + 57, Math.floor(s.d0) + racer.lap * 11) > prof.springs || Math.abs(lat - racer.lateral) > f * .15 + .5 || !straightTo(track, d, f + v * 2)) continue;
    if (!spring || Math.abs(lat - racer.lateral) < Math.abs(spring.lat - racer.lateral)) spring = { lat, f: lookAhead(v), lo, hi, to: f };
  }
  // A ring on the way to a spring: pass it on the side that also lands on the pad, when one lateral serves both.
  if (ring && spring && ring.f < spring.to) {
    const w = ring.r.radius - 1.4, lo = Math.max(ring.lat - w, spring.lo), hi = Math.min(ring.lat + w, spring.hi);
    if (lo <= hi) return { lat: clamp(spring.lat, lo, hi), f: ring.f };
  }
  if (ring ?? spring) return ring ?? spring;
  if (prof.boxes && racer.item === null && racer.rollT <= 0 && race.items !== 'off') {
    let best: Feature | null = null;
    track.boxes.forEach((box, i) => {
      const f = forwardDistance(track, d, box.d);
      if (race.boxes[i] > f / Math.max(v, 10) || f > 40 || f < 3 || Math.abs(box.lateral - racer.lateral) > 6 || !straightTo(track, d, f)) return;
      if (!best || Math.abs(box.lateral - racer.lateral) < Math.abs(best.lat - racer.lateral)) best = { lat: box.lateral, f };
    });
    if (best) return best;
  }
  return null;
}

/** Steer around peels, landed bombs, obstacles and slower karts: walk the hazards nearest-first and sidestep the first one
 * our straight-line path (current lateral → wanted lateral) would clip. Null when the way is clear. */
function dodge(race: Race, track: Track, racer: Racer, want: number, aimDist: number, v: number, prof: Profile): Feature | null {
  const d = racer.d, window = (10 + v * 1.1) * prof.look, blocks: { lo: number; hi: number; f: number; kart: boolean }[] = [];
  const add = (hd: number, hLat: number, clear: number, kart = false, reach = window) => { const f = forwardDistance(track, d, hd); if (f > .5 && f < reach) blocks.push({ lo: hLat - clear, hi: hLat + clear, f, kart }); };
  // Rocks and snowmen are known in advance: line up ~3 s early (before a jump or an icy landing takes the steering away).
  // Faster means a wider berth: small heading errors grow over a long run-up or flight.
  for (const o of track.obstacles) add(o.d, o.lateral, o.radius + Math.min(3.3, 2 + v * .025), false, Math.max(window, v * 3));
  // Sliding bumpers: blocked wherever one will be while we pass it (moverPosition at our arrival time, ± a little).
  for (const m of track.movers) {
    const t = race.time + forwardDistance(track, d, m.d) / Math.max(v, 8), lats = [-.12, 0, .12].map(e => moverPosition(track, m, t + e).lateral);
    add(m.d, (Math.min(...lats) + Math.max(...lats)) / 2, (Math.max(...lats) - Math.min(...lats)) / 2 + m.radius + PHYSICS.kartRadius + .5);
  }
  for (const e of race.entities) {
    if (e.kind !== 'peel' && !(e.kind === 'bomb' && e.bounces === 1)) continue;
    const s = sampleAt(track, e.d); add(e.d, (e.x - s.x) * s.rx + (e.z - s.z) * s.rz, e.kind === 'bomb' ? 3.2 : 2.2);
  }
  if (racer.starT <= 0) for (const o of race.racers) {
    if (o === racer || o.respawnT > 0) continue;
    const f = signedDistance(track, d, o.d), closing = v - speedOf(o);
    if (f > 1.5 && f < 4 + closing * 1.4 && closing > 1.5) add(o.d, o.lateral, 2.7, true);
  }
  blocks.sort((a, b) => a.f - b.f);
  // Plan from where our sideways momentum is taking us: it can't be reversed instantly, and it keeps the choice of side stable.
  const s0 = sampleAt(track, d), from = racer.lateral + (racer.vx * s0.rx + racer.vz * s0.rz) * .25;
  for (const b of blocks) {
    const planned = lerp(from, want, clamp(b.f / aimDist, 0, 1));
    if (planned <= b.lo || planned >= b.hi) continue;
    // A sidestep must stay on the road, clear hazards alongside, and not clip a nearer hazard on the way over.
    // Rather brush a kart than hit a rock: the side of a solid hazard is chosen by the solid hazards alone (letting karts
    // veto a side made the choice flicker in traffic and sent CPUs across the rock's face).
    const s = sampleAt(track, d + b.f), clips = (c: number, karts: boolean) => blocks.some(o => {
      const at = o.f < b.f ? lerp(from, c, o.f / b.f) : o.f - b.f < 10 ? c : NaN;
      return (karts || !o.kart) && at > o.lo && at < o.hi;
    });
    let best = NaN, cost = Infinity;
    for (const c of [b.lo - .1, b.hi + .1]) {
      if (c !== keepOn(s, c) || clips(c, b.kart)) continue;
      const k = Math.abs(c - from) + Math.abs(c - want) * .15;
      if (k < cost) { cost = k; best = c; }
    }
    if (!Number.isNaN(best)) return { lat: best, f: b.f };
  }
  return null;
}

/* ---------------- Items ---------------- */
function useItems(race: Race, track: Track, racer: Racer, ai: AiState, prof: Profile, out: Input, press: (k: 'fire') => void, v: number) {
  const item = racer.item;
  if (item === null) { ai.itemDelay = NO_ITEM; return; }
  if (ai.itemDelay === NO_ITEM) ai.itemDelay = racer.rollT + lerp(prof.itemWait[0], prof.itemWait[1], raceRandom(race));
  ai.itemDelay -= DT;
  if (racer.rollT > 0 || race.phase !== 'racing') return;
  const ready = ai.itemDelay <= 0, d = racer.d;
  const threat = threatBehind(race, track, racer), chaser = racerNear(race, track, racer, -16, -2.5, 3.5);
  const fire = (hold = false) => { press('fire'); out.item = hold; ai.itemDelay = item === 'triple-nitro' && racer.itemCount > 1 ? 1.5 : NO_ITEM; };

  if (ITEMS[item].holdable) {
    if (racer.trailing) {
      let deploy = false;
      if (item === 'peel') deploy = !!chaser || ai.itemDelay < -14;
      else if (item === 'bouncer') deploy = !threat && (aligned(race, track, racer, prof) || ai.itemDelay < -14);
      else deploy = !threat && racer.rank > 1 && ai.itemDelay < -.5;
      out.item = !deploy;
      if (deploy) ai.itemDelay = NO_ITEM;
      return;
    }
    if (!ready && !threat) return;
    if (item === 'bouncer' && aligned(race, track, racer, prof)) return fire();
    if (item === 'seeker' && racer.rank > 1 && !threat) return fire();
    if (item === 'peel' && chaser) return fire();
    return fire(true);  // drag it behind as a rear shield until a use comes up
  }
  // Too slow to clear a gap coming up (after a hit): burn a speed item now, whatever the planned delay.
  if ((item === 'nitro' || item === 'triple-nitro' || item === 'super') && gapAhead(track, d, v) && v < paramsFor(race, racer).topSpeed * .8 && racer.grounded) return fire();
  if (!ready) return;
  const straight = Math.abs(turnBetween(track, d, d + 10 + v * 1.4)) < .3;
  switch (item) {
    case 'nitro': case 'triple-nitro': if (straight || racer.offroad || ai.itemDelay < -8) fire(); return;
    case 'shield': if (threat || ai.itemDelay < -3) fire(); return;
    case 'bomb': if (racerNear(race, track, racer, 16, 45, 6) || ai.itemDelay < -7) fire(); return;
    default: fire(); return;  // star, thunder, comet, ink: short randomised delay, then go
  }
}

/** Unfinished rival within [f0, f1] metres along the track (negative = behind) and `lat` metres sideways. */
function racerNear(race: Race, track: Track, racer: Racer, f0: number, f1: number, lat: number) {
  return race.racers.find(o => {
    if (o === racer || o.finishTime !== null || o.respawnT > 0) return false;
    const f = signedDistance(track, racer.d, o.d);
    return f >= Math.min(f0, f1) && f <= Math.max(f0, f1) && Math.abs(o.lateral - racer.lateral) < lat;
  }) ?? null;
}
/** A rival projectile closing from behind (or a seeker locked on us). */
function threatBehind(race: Race, track: Track, racer: Racer) {
  return race.entities.some(e => {
    if (e.owner === racer.id || (e.kind !== 'bouncer' && e.kind !== 'seeker')) return false;
    const f = signedDistance(track, racer.d, e.d);
    return (e.kind === 'seeker' && e.target === racer.id && f < 0 && f > -120) || (f < 0 && f > -35 && (e.vx * forwardX(racer.heading) + e.vz * forwardZ(racer.heading)) > speedOf(racer));
  });
}
/** A bouncer fired now would run into someone: rival 6–55 m ahead, nearly on our nose, with a straight-ish road between. */
function aligned(race: Race, track: Track, racer: Racer, prof: Profile) {
  return race.racers.some(o => {
    if (o === racer || o.finishTime !== null || o.respawnT > 0) return false;
    const dx = o.x - racer.x, dz = o.z - racer.z, dist = Math.hypot(dx, dz);
    if (dist < 6 || dist > 55 || forwardDistance(track, racer.d, o.d) > 70) return false;
    const off = Math.abs(angleDelta(racer.heading, headingOf(dx, dz)));
    return off < Math.atan2(1.6, dist) + prof.aim && Math.abs(turnBetween(track, racer.d, o.d)) < .35;
  });
}
