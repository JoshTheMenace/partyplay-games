/* Per-kart arcade physics (DESIGN.md §3). Pure and deterministic: the server steps every kart at 60 Hz
 * and client prediction replays the same function, so no randomness, clocks or hidden state here.
 *
 * Model: velocity is world-space and separate from heading. Each step the engine pushes along the
 * heading, steering yaws the heading, and tyre grip rotates the velocity toward the heading (keeping
 * most of the speed). Low grip while drifting leaves a real slip angle, so drifts look and drive like
 * drifts. The ground comes from queryTrack (road plane + ramp wedges); leaving it faster than gravity
 * can follow makes the kart airborne, which is how ramp lips and crests launch without special cases. */
import { angleDelta, approach, clamp, forwardX, forwardZ, lerp, moveToward, smoothstep, TAU, wrap, wrapAngle } from './math';
import { forwardDistance, gravityScale, loopPose, moverPosition, pointAt, queryTrack, roadHeight, sampleAt, signedDistance, springAt, type Track, type TrackLoop, type TrackQuery } from './track';
import { kartStats, TOP_SPEED } from './stats';
import type { HitKind, Input, KartBodyId, KartState, Phase, RaceEventType, SpeedClass, Surface } from './types';

export type KartParams = { topSpeed: number; accel: number; handling: number; weight: number; traction: number };
/** Resolved per-racer tuning. `skill` scales CPU top speed (1 for humans). */
export function kartParams(character: number, kart: KartBodyId, speedClass: SpeedClass, skill = 1): KartParams {
  const s = kartStats(character, kart);
  return { topSpeed: TOP_SPEED[speedClass] * s.speed * skill, accel: s.accel, handling: s.handling, weight: s.weight, traction: s.traction };
}
export type Drafter = { x: number; z: number; heading: number; speed: number };
export type StepEnv = { time: number; phase: Phase; drafters: readonly Drafter[] };
export type KartEvent = { type: RaceEventType; value?: number };

/** Tuning shared with tests, CPUs and presentation. */
export const PHYSICS = {
  gravity: 28, kartRadius: 1.1, contactRadius: 1.25, bodyRadius: 1.1, bodyHalfLength: .38,
  steerBuild: 9, steerRelease: 24, accel: 18, brake: 28, reverseSpeed: 7, bleed: 6,
  hopSpeed: 4.2, hopMinSpeed: 9, hopKeep: .97, driftMinSpeed: 7,
  driftTiers: [1, 1.6, 3], turboTime: [0, .7, 1.2, 1.7], turboPower: [0, .3, .35, .4], turboKick: [0, 1, 2.5, 4],
  padTime: 1.1, padPower: .4, trickTime: .9, trickPower: .3, trickWindow: .45,
  rocketTime: 1.3, rocketPower: .35, stallTime: .8, slipTime: 1, slipPower: .22, slipCharge: 1.4, slipCooldown: 3,
  respawnTime: 1.6, respawnSpeed: 10, respawnInvuln: 1.5, recoverInvuln: .8,
  spinTime: 1, tumbleTime: 1.4, shockTime: 3, shockSpin: .6, inkTime: 4, starTime: 7.5,
  // Rainbow Road set-pieces (DESIGN §9). Rings also kick +ringKick m/s at once: engines don't push in the air, so an
  // airborne ring would otherwise pay nothing. The ring test uses the kart's body centre (ringCentre above the wheels)
  // with ringSlack for the body's size. Low gravity also lets the flight path bend a little toward the nose (moonGrip).
  // Springs square the kart up with the road (springAlign of its sideways speed and nose angle) so long floats stay fair.
  ringTime: 1, ringPower: .35, ringKick: 4, ringCentre: .7, ringSlack: .4, bumperSpeed: 12, bumperKeep: .7, moonGrip: 1.6, springAlign: .75,
  // Loop-the-loop (DESIGN §9.1): never slower than loopMin × top (a kart that came in, or was knocked, below it is lifted
  // back at loopLift m/s² rather than snapped), loopGravity (m/s² × the climb of the ribbon) trades a little speed on the way
  // up for the same back on the way down, loopSteer m/s of sideways travel at full lock, and a kart that came in wide is eased
  // into the lane at loopPull m/s.
  loopMin: .6, loopLift: 12, loopGravity: 8, loopSteer: 6, loopPull: 8,
} as const;
const P = PHYSICS, G = P.gravity;
/** Lateral grip (1/s) and how much of the scrubbed sideways speed is turned back into forward speed. */
const GRIP: Record<Surface, number> = { road: 14, boost: 14, offroad: 9, water: 10, ice: 2, air: 0 };
const DRIFT_GRIP = 3.5, GRIP_KEEP = .6, DRIFT_KEEP = .8, ICE_KEEP = .9, DRIFT_TOP = .97, DRIFT_YAW = 1.25, AIR_STEER = .35;

export function createKartState(x: number, y: number, z: number, heading: number, track: Track): KartState {
  const q = queryTrack(track, x, z, -1, y);
  return { x, y, z, vx: 0, vy: 0, vz: 0, heading, steer: 0, grounded: true, air: 0, hint: q.index, d: q.d, lateral: q.lateral, surface: q.surface, offroad: false,
    lastSafeD: q.d, drift: 0, driftCharge: 0, driftTier: 0, hopT: 0, boostT: 0, boostPower: 0, slipT: 0, slipCharge: 0, trickT: 0, tricked: false,
    spinT: 0, tumbleT: 0, starT: 0, shieldT: 0, inkT: 0, shockT: 0, respawnT: 0, invulnT: 0, stallT: 0, launch: 0, loop: 0, prevHop: 0, prevFire: 0, prevItem: false };
}
export const speedOf = (k: KartState) => Math.hypot(k.vx, k.vz);
export const forwardSpeed = (k: KartState) => k.vx * forwardX(k.heading) + k.vz * forwardZ(k.heading);

/** Yaw rate (rad/s) at full lock: grows from zero while creeping, 2.1 at 8 m/s, 1.3 at top speed. */
export function turnRate(v: number, top: number) {
  return v < 8 ? 2.1 * Math.min(1, v / 5) : Math.max(1.1, 2.1 - .8 * (v - 8) / Math.max(1, top - 8));
}
/** How hard a drift turns (0.1 full counter-steer … 0.55 neutral … 1 full lock into it). It shapes the drift's
 * yaw and its charge rate, so a counter-steered drift that runs straight barely charges (no weaving for sparks). */
export const driftBite = (steer: number, dir: number) => .55 + .45 * clamp(steer * dir, -1, 1);
export const driftTierOf = (charge: number): 0 | 1 | 2 | 3 => charge >= P.driftTiers[2] ? 3 : charge >= P.driftTiers[1] ? 2 : charge >= P.driftTiers[0] ? 1 : 0;

// Events are rare, so the per-step result array is only allocated when something happens.
const NO_EVENTS: KartEvent[] = [];
let out: KartEvent[] | null = null;
const emit = (type: RaceEventType, value?: number) => { (out ??= []).push(value === undefined ? { type } : { type, value }); };
const done = () => { const e = out ?? NO_EVENTS; out = null; return e; };

/** Advance one kart by dt. Must be deterministic: the same inputs give the same state on server and client. */
export function stepKart(k: KartState, input: Input, p: KartParams, track: Track, dt: number, env: StepEnv): KartEvent[] {
  out = null;
  let press = input.hop !== k.prevHop;
  k.prevHop = input.hop;
  const hurt = k.spinT > 0 || k.tumbleT > 0;
  // Steering builds smoothly but lets go fast, so releasing a key or thumb stops the turn instead of carrying it on.
  const want = hurt || k.respawnT > 0 ? 0 : clamp(input.steer, -1, 1);
  k.steer += (want - k.steer) * approach(Math.abs(want) < Math.abs(k.steer) || want * k.steer < 0 ? P.steerRelease : P.steerBuild, dt);

  // Countdown: the kart is parked; the first hop press decides a rocket start or a stall.
  if (env.phase === 'countdown' || env.time < 0) {
    if (press && k.launch === 0 && env.time >= -1.4) k.launch = env.time >= -.35 ? 1 : -1;
    k.vx = k.vy = k.vz = 0;
    return done();
  }
  if (k.launch === 1) { startBoost(k, P.rocketTime, P.rocketPower); emit('rocket-start'); k.launch = 0; }
  else if (k.launch === -1) { k.stallT = P.stallTime; emit('stall'); k.launch = 0; }
  else if (press && env.time <= .05 && k.boostT <= 0 && k.stallT <= 0 && speedOf(k) < 1) { startBoost(k, P.rocketTime, P.rocketPower); emit('rocket-start'); press = false; }

  tickTimers(k, dt);
  if (k.respawnT > 0) { stepRespawn(k, track, dt); return done(); }

  // Hit reactions: the kart slides on with decaying speed and no control.
  if (k.spinT > 0) {
    const s = Math.min(dt, k.spinT);
    k.heading -= s * TAU / (k.shockT - k.spinT > 2 ? P.shockSpin : P.spinTime);
    k.spinT -= s;
  }
  if (k.tumbleT > 0) k.tumbleT = Math.max(0, k.tumbleT - dt);
  if (hurt && k.spinT <= 0 && k.tumbleT <= 0) k.invulnT = Math.max(k.invulnT, P.recoverInvuln);
  if (k.loop > 0) {
    const loop = riddenLoop(track, k.d);
    if (loop) { rideLoop(k, input, p, track, loop, dt, hurt); return done(); }
    k.loop = 0;
  }
  if (hurt) { const f = Math.exp(-(k.tumbleT > 0 ? 1.36 : 1.05) * dt); k.vx *= f; k.vz *= f; }

  let fx = forwardX(k.heading), fz = forwardZ(k.heading);
  let fwd = k.vx * fx + k.vz * fz, lat = k.vz * fx - k.vx * fz;
  const speed = Math.hypot(k.vx, k.vz), boosting = k.boostT > 0, star = k.starT > 0, surface = k.grounded ? k.surface : 'air';
  const rough = surface === 'offroad' || surface === 'water';

  // Drift release fires the charged mini-turbo (never when hit).
  if (k.drift !== 0 && (!input.drift || speed < P.driftMinSpeed || hurt || input.brake)) {
    if (!hurt && k.driftTier > 0) { startBoost(k, P.turboTime[k.driftTier], P.turboPower[k.driftTier]); fwd += P.turboKick[k.driftTier]; emit('mini-turbo', k.driftTier); }
    k.drift = 0; k.driftCharge = 0; k.driftTier = 0;
  }
  // Hop press: a trick in a ramp's air window, otherwise a small hop that can start a drift.
  if (press && !hurt) {
    if (!k.grounded && k.trickT > 0 && !k.tricked) { k.tricked = true; k.trickT = 0; emit('trick'); }
    else if (k.grounded && speed > P.hopMinSpeed && k.stallT <= 0) { k.vy = P.hopSpeed; k.grounded = false; k.hopT = .4; fwd *= P.hopKeep; }
  }
  if (k.drift === 0 && k.hopT > 0 && input.drift && !hurt && !input.brake && speed > P.driftMinSpeed && Math.abs(input.steer) > .25) {
    k.drift = input.steer > 0 ? 1 : -1; k.driftCharge = 0; k.driftTier = 0;
  }

  // Longitudinal: auto-accelerate toward the current top speed; excess bleeds off smoothly.
  if (!hurt && k.grounded) {
    let top = p.topSpeed;
    if (!boosting && !star && rough) top *= 1 - (surface === 'offroad' ? .45 : .2) / p.traction;
    if (boosting) top *= 1 + k.boostPower;
    if (star) top *= 1.18;
    if (k.shockT > 0) top *= .7;
    if (k.drift !== 0) top *= DRIFT_TOP;
    if (k.stallT > 0) fwd = Math.max(0, fwd - 10 * dt);
    else if (input.brake) fwd = fwd > 1 ? Math.max(0, fwd - P.brake * dt) : Math.max(-P.reverseSpeed, fwd - 12 * dt);
    else if (fwd < 0) fwd = Math.min(0, fwd + P.brake * dt);
    else if (fwd < top) {
      fwd = Math.min(top, fwd + engine(p, boosting, star) * Math.pow(1 - fwd / top, .6) * dt);
    } else {
      const excess = fwd - top;
      fwd = Math.max(top, fwd - (P.bleed + (rough && !boosting && !star ? 2.5 : .5) * excess) * dt);
    }
  }

  // Steering yaws the heading. Drifts always turn into the drift: steering in tightens, counter-steer widens.
  const bite = driftBite(k.steer, k.drift);
  if (!hurt) {
    const steer = k.drift !== 0 ? k.drift * bite : k.steer;
    const air = k.grounded ? 1 : k.hopT > 0 ? .8 : AIR_STEER;
    k.heading -= steer * turnRate(Math.abs(fwd), p.topSpeed) * p.handling * (k.drift !== 0 ? DRIFT_YAW : 1) * air * Math.sign(fwd) * dt;
  }
  // Re-express the (world-fixed) velocity in the new heading frame, then let grip pull it into line.
  const vx = fx * fwd - fz * lat, vz = fz * fwd + fx * lat;
  fx = forwardX(k.heading); fz = forwardZ(k.heading);
  fwd = vx * fx + vz * fz; lat = vz * fx - vx * fz;
  if (k.grounded && !hurt) {
    const grip = (k.drift !== 0 ? Math.min(DRIFT_GRIP, GRIP[surface]) : GRIP[surface]) * (surface === 'ice' ? 1 : p.traction);
    const nextLat = lat * Math.exp(-grip * dt), keep = surface === 'ice' ? ICE_KEEP : k.drift !== 0 ? DRIFT_KEEP : GRIP_KEEP;
    fwd = (fwd < 0 ? -1 : 1) * Math.sqrt(fwd * fwd + keep * (lat * lat - nextLat * nextLat));
    lat = nextLat;
  } else if (!k.grounded && !hurt && fwd > 0 && track.gravity.length) {
    // Moon air: the flight path slowly swings toward the nose (no speed lost), so a floaty arc can be steered into a ring.
    const nextLat = lat * Math.exp(-P.moonGrip * (1 - gravityScale(track, k.d)) * dt);
    fwd = Math.sqrt(fwd * fwd + lat * lat - nextLat * nextLat); lat = nextLat;
  }
  if (!hurt) { k.vx = fx * fwd - fz * lat; k.vz = fz * fwd + fx * lat; }
  const cap = p.topSpeed * 2.2, v = Math.hypot(k.vx, k.vz);
  if (v > cap) { k.vx *= cap / v; k.vz *= cap / v; }

  // Integrate and resolve the ground.
  const prevX = k.x, prevY = k.y, prevZ = k.z, prevVy = k.vy, prevD = k.d, wasGrounded = k.grounded;
  k.x += k.vx * dt; k.z += k.vz * dt;
  let q = queryTrack(track, k.x, k.z, k.hint, k.y);
  // Airborne past a bridge edge, the nearest road can become another stretch below: that is not this kart's road, so it
  // keeps tracking the stretch it left, finds no ground and falls to a respawn (no landing on a shortcut, no progress jump).
  if (!k.grounded && Math.abs(signedDistance(track, prevD, q.d)) > 30) {
    q = { ...q, index: k.hint, d: prevD, lateral: k.lateral, centerY: sampleAt(track, prevD).y, ground: null, surface: 'air', edge: 'drop', beyond: k.lateral < 0 ? -1 : 1 };
  }
  if (collideEdges(k, q, track) || (track.loops.length && loopExitWall(k, track, prevD, q))) q = queryTrack(track, k.x, k.z, q.index, k.y);
  if (track.movers.length && collideMovers(k, track, env.time, dt, prevX, prevZ, q.tx, q.tz)) q = queryTrack(track, k.x, k.z, q.index, k.y);
  const entry = track.loops.length ? loopEntry(track, k, prevD, q) : undefined;
  if (entry) { enterLoop(k, p, track, entry, q); return done(); }
  // Gravity zones scale gravity in the air and for crest detection; drift hops keep full gravity so drifting feels the same everywhere.
  const g = G * (!k.grounded && k.hopT > 0 ? 1 : gravityScale(track, q.d));
  // A loop's footprint has no road of its own (the ribbon rose into the loop): only a kart that missed the entry gets here, and falls.
  const ground = (q.beyond !== 0 && q.edge === 'drop') || (track.loops.length && loopOver(track, q.d)) ? null : q.ground;
  const along = k.vx * q.tx + k.vz * q.tz, across = k.vz * q.tx - k.vx * q.tz;
  const followVy = along * q.slope - (Math.abs(q.lateral) < q.halfWidth ? across * Math.tan(q.bank) : 0);
  if (k.grounded) {
    // Stay planted over the small slope kinks between samples; leave the ground where there is none,
    // at ledges and ramp lips, and over real crests (the road bends away faster than gravity follows).
    if (ground === null || ground < prevY + prevVy * dt - .5 * g * dt * dt - (along * along * bend(track, q.d) < -g ? 0 : .12)) {
      k.grounded = false;
      // Ramp lip: a sudden step down, measured against the road plane when a gap starts right at the lip.
      if (prevY - (ground ?? roadHeight(track, q.d, q.lateral)) > .4) { k.vy = prevVy * 1.15 + 2; k.trickT = P.trickWindow; }
      else k.vy = prevVy - g * dt;
      k.y = prevY + k.vy * dt;
    } else { k.y = ground; k.vy = followVy; }
  } else {
    k.vy -= g * dt; k.y += k.vy * dt;
    if (ground !== null && k.y <= ground && k.y > ground - 2) {
      k.grounded = true; k.y = ground; k.vy = followVy;
      if (k.tricked) startBoost(k, P.trickTime, P.trickPower);
      if (k.hopT <= 0 && k.air > .25 && input.drift) k.hopT = .15;   // landing drift off a jump
      k.tricked = false; k.trickT = 0;
    } else if (ground !== null && k.hopT <= 0 && k.trickT <= 0 && !k.tricked && k.air < .2 && k.air + dt >= .2 && k.vy > -2) k.trickT = P.trickWindow - .2;   // big crest
  }
  // Springs: touching a pad on the ground launches straight up with a trick window (before lastSafeD, so a respawn never lands on one).
  // The pad also squares the kart up with the road (most sideways speed and nose angle go), so a merge onto it can't float off the edge.
  const spring = k.grounded && track.springs.length ? springAt(track, q.d, q.lateral) : -1;
  if (spring >= 0) {
    const across = (k.vx * q.rx + k.vz * q.rz) * P.springAlign;
    k.vx -= q.rx * across; k.vz -= q.rz * across; k.heading += angleDelta(k.heading, q.heading) * P.springAlign;
    k.vy = track.springs[spring].power; k.grounded = false; k.trickT = P.trickWindow; k.tricked = false; emit('spring', spring);
  }
  k.air = k.grounded ? 0 : wasGrounded ? dt : k.air + dt;
  if (!k.grounded && (k.y < q.centerY - 10 || !Number.isFinite(k.y))) emit('fall');

  // Track state, boost pads, mini-turbo charge and slipstream.
  const prevSurface = k.surface;
  k.hint = q.index; k.d = q.d; k.lateral = q.lateral;
  if (track.rings.length && !hurt) passRings(k, track, prevD, prevX, prevY, prevZ);
  k.surface = k.grounded ? q.surface : 'air';
  k.offroad = k.surface === 'offroad';
  if (k.grounded && ground !== null && Math.abs(q.lateral) <= q.halfWidth && q.surface !== 'air') k.lastSafeD = q.d;
  if (k.surface === 'boost' && !hurt) { if (prevSurface !== 'boost') emit('boost-pad'); startBoost(k, P.padTime, P.padPower); }
  if (k.drift !== 0 && k.grounded && (k.surface === 'road' || k.surface === 'boost' || k.surface === 'ice')) {
    k.driftCharge = Math.min(4, k.driftCharge + dt * (.2 + 1.6 * bite));
  }
  k.driftTier = k.drift !== 0 ? driftTierOf(k.driftCharge) : 0;
  if (drafting(k, env.drafters, p)) {
    k.slipCharge += dt;
    // After a slipstream boost the charge starts below zero: the next one needs a longer tow.
    if (k.slipCharge >= P.slipCharge) { k.slipCharge = -P.slipCooldown; k.slipT = P.slipTime; startBoost(k, P.slipTime, P.slipPower); emit('slipstream'); }
  } else decaySlip(k, dt);
  k.heading = wrapAngle(k.heading);
  return done();
}

const engine = (p: KartParams, boosting: boolean, star: boolean) => P.accel * Math.sqrt(p.topSpeed / TOP_SPEED[100]) * p.accel * (boosting ? 3 : 1) * (star ? 1.5 : 1);
const decaySlip = (k: KartState, dt: number) => { k.slipCharge = k.slipCharge > 0 ? Math.max(0, k.slipCharge - dt * 2) : Math.min(0, k.slipCharge + dt); };

/* ---------------- Loop-the-loop (DESIGN §9.1) ---------------- */
/** Footprint length of a loop along the lap (m). While riding, d = d0 + loopLength·θ/2π. */
export const loopLength = (track: Track, loop: TrackLoop) => forwardDistance(track, loop.d0, loop.d1);
/** The loop whose footprint (d0, d1 + after) contains d, if any. */
export const loopOver = (track: Track, d: number, after = 0) => track.loops.find(l => { const f = forwardDistance(track, l.d0, d); return f > 0 && f < loopLength(track, l) + after; });
/** The loop a kart in loop mode is on, from its d (a metre of slack either side for snapshot rounding). */
const riddenLoop = (track: Track, d: number) => track.loops.find(l => { const s = signedDistance(track, l.d0, d); return s > -1 && s < loopLength(track, l) + 1; });
/** The loop whose entry this step crossed going forward, on the course and on (or within a hop of) the road. */
function loopEntry(track: Track, k: KartState, prevD: number, q: TrackQuery) {
  const moved = forwardDistance(track, prevD, q.d);
  if (moved <= 0 || moved > 8 || q.beyond !== 0 || k.y - roadHeight(track, q.d, q.lateral) > 2) return undefined;
  return track.loops.find(l => forwardDistance(track, l.d0, q.d) < moved);
}
/** Loops are ridden forward only: a kart backing off the exit onto the footprint meets a wall at d1 instead of dropping into the void. */
function loopExitWall(k: KartState, track: Track, prevD: number, q: TrackQuery) {
  const l = track.loops.find(l => { const b = forwardDistance(track, q.d, l.d1); return b > 0 && b < 4 && forwardDistance(track, l.d1, prevD) < 4; });
  if (!l) return false;
  const back = forwardDistance(track, q.d, l.d1) + .01;
  k.x += q.tx * back; k.z += q.tz * back; bounce(k, q.tx, q.tz, q.tx, q.tz);
  return true;
}
/** Put a kart on a loop at θ / lateral moving at v along the ribbon; x/y/z, velocity, heading and d all follow loopPose. */
function placeOnLoop(k: KartState, track: Track, loop: TrackLoop, theta: number, lateral: number, v: number) {
  const pose = loopPose(loop, theta, lateral), d = wrap(loop.d0 + loopLength(track, loop) * theta / TAU, track.length);
  k.loop = theta; k.x = pose.x; k.y = pose.y; k.z = pose.z; k.heading = wrapAngle(pose.heading);
  k.vx = pose.tx * v; k.vy = pose.ty * v; k.vz = pose.tz * v;
  k.grounded = true; k.air = 0; k.d = d; k.lateral = lateral; k.hint = Math.round(d / track.spacing) % track.samples.length; k.surface = 'road'; k.offroad = false;
}
/** Entry: a charged drift fires its mini-turbo, drift and hop end, and the kart carries on up the ribbon at its own speed. */
function enterLoop(k: KartState, p: KartParams, track: Track, loop: TrackLoop, q: TrackQuery) {
  let v = Math.max(0, k.vx * q.tx + k.vz * q.tz);
  if (k.driftTier > 0) { startBoost(k, P.turboTime[k.driftTier], P.turboPower[k.driftTier]); v += P.turboKick[k.driftTier]; emit('mini-turbo', k.driftTier); }
  k.drift = 0; k.driftCharge = 0; k.driftTier = 0; k.hopT = 0; k.trickT = 0; k.tricked = false;
  placeOnLoop(k, track, loop, Math.max(.002, forwardDistance(track, loop.d0, q.d) / loopPose(loop, 0, 0).dsdTheta), q.lateral, v);
  emit('loop');
}
/** One step on the ribbon: the engine (boosts, star, shock) drives speed along it, the climb trades a little, hits slow it, and it
 * never drops below loopMin × top. Steering slides the kart across the lane. Speed, lateral and θ are read back from the world
 * state, so kart contacts (which move x/y/z and trade velocity) carry over. At θ ≥ 2π the kart rejoins the road at d1 at the
 * same speed (the engine then takes over, so braking in the loop costs what it costs anywhere). */
function rideLoop(k: KartState, input: Input, p: KartParams, track: Track, loop: TrackLoop, dt: number, hurt: boolean) {
  const at = loopPose(loop, k.loop, 0), lane = sampleAt(track, loop.d0).halfWidth - P.kartRadius, boosting = k.boostT > 0, star = k.starT > 0;
  const top = p.topSpeed * (boosting ? 1 + k.boostPower : 1) * (star ? 1.18 : 1) * (k.shockT > 0 ? .7 : 1);
  // Offset from the pose at (θ, 0) split into along the tangent and across the lateral axis (not quite perpendicular while the lean eases).
  const ox = k.x - at.x, oy = k.y - at.y, oz = k.z - at.z, c = at.tx * loop.rx + at.tz * loop.rz, ot = ox * at.tx + oy * at.ty + oz * at.tz, or = ox * loop.rx + oz * loop.rz;
  const v0 = k.vx * at.tx + k.vy * at.ty + k.vz * at.tz, shift = (ot - c * or) / (1 - c * c);
  let v = v0, lat = (or - c * ot) / (1 - c * c);
  if (hurt) v *= Math.exp(-(k.tumbleT > 0 ? 1.36 : 1.05) * dt);
  else if (input.brake) v -= P.brake * dt;
  else if (v < top) v = Math.min(top, v + engine(p, boosting, star) * Math.pow(1 - v / top, .6) * dt);
  else v = Math.max(top, v - (P.bleed + .5 * (v - top)) * dt);
  v = Math.max(Math.min(p.topSpeed * P.loopMin, v0 + P.loopLift * dt), v - P.loopGravity * at.ty * dt);
  lat = moveToward(lat, clamp(lat, -lane, lane), P.loopPull * dt);                                          // came in wide: eased in
  lat = clamp(lat + k.steer * P.loopSteer * p.handling * dt, Math.min(lat, -lane), Math.max(lat, lane));   // steering never widens it
  decaySlip(k, dt);
  const theta = Math.max(1e-3, k.loop + (shift + v * dt) / at.dsdTheta);
  if (theta < TAU) { placeOnLoop(k, track, loop, theta, lat, v); return; }
  const d = wrap(loop.d1 + (theta - TAU) * at.dsdTheta, track.length), pt = pointAt(track, d, lat), speed = v;
  const q = queryTrack(track, pt.x, pt.z, Math.round(d / track.spacing) % track.samples.length, pt.y);
  k.loop = 0; k.x = pt.x; k.y = q.ground ?? pt.y; k.z = pt.z; k.heading = wrapAngle(pt.heading);
  k.vx = forwardX(pt.heading) * speed; k.vy = 0; k.vz = forwardZ(pt.heading) * speed;
  k.grounded = true; k.air = 0; k.hint = q.index; k.d = q.d; k.lateral = q.lateral; k.surface = q.surface; k.offroad = false; k.lastSafeD = q.d;
}

/** Vertical curvature (1/m) of the centre line around d, over ±4 m so sample kinks don't count as crests. */
export function bend(track: Track, d: number) {
  const S = track.samples, n = S.length, h = (x: number) => { const f = wrap(x, track.length) / track.spacing, i = Math.floor(f) % n; return lerp(S[i].y, S[(i + 1) % n].y, f - Math.floor(f)); };
  return (h(d + 4) - 2 * h(d) + h(d - 4)) / 16;
}

function tickTimers(k: KartState, dt: number) {
  k.boostT = Math.max(0, k.boostT - dt); if (k.boostT === 0) k.boostPower = 0;
  k.slipT = Math.max(0, k.slipT - dt); k.hopT = Math.max(0, k.hopT - dt); k.trickT = Math.max(0, k.trickT - dt);
  k.starT = Math.max(0, k.starT - dt); k.shieldT = Math.max(0, k.shieldT - dt); k.inkT = Math.max(0, k.inkT - dt);
  k.shockT = Math.max(0, k.shockT - dt); k.invulnT = Math.max(0, k.invulnT - dt); k.stallT = Math.max(0, k.stallT - dt);
}

/** Walls reflect the into-wall velocity and keep most of the tangential speed; obstacles act like round walls. */
function collideEdges(k: KartState, q: ReturnType<typeof queryTrack>, track: Track) {
  let moved = false;
  const side = q.lateral < 0 ? -1 : 1, limit = Math.abs(q.edgeLateral) - P.kartRadius;
  if (q.edge === 'wall' && Math.abs(q.lateral) > limit) {
    // Airborne karts that flew wide of a rail are eased back over a few ticks rather than snapped through the fence.
    const push = Math.min(Math.abs(q.lateral) - limit, k.grounded ? Infinity : .35);
    k.x -= side * q.rx * push; k.z -= side * q.rz * push; moved = true;
    bounce(k, -side * q.rx, -side * q.rz, q.tx, q.tz);
  }
  for (const o of track.obstacles) {
    const reach = o.radius + P.kartRadius, dx = k.x - o.x, dz = k.z - o.z;
    if (Math.abs(dx) > reach || Math.abs(dz) > reach || Math.abs(k.y - o.y) > 3) continue;
    const dist = Math.hypot(dx, dz);
    if (dist >= reach || dist < 1e-6) continue;
    k.x = o.x + dx / dist * reach; k.z = o.z + dz / dist * reach; moved = true;
    bounce(k, dx / dist, dz / dist, q.tx, q.tz);
  }
  return moved;
}
function bounce(k: KartState, nx: number, nz: number, tfx: number, tfz: number) {
  const vn = k.vx * nx + k.vz * nz;
  if (vn >= 0) return;
  const impact = -vn, keep = (1 - .08 * smoothstep(1, 4, impact)) * (impact > 6 ? .85 : 1);
  k.vx = (k.vx - vn * nx) * keep + nx * impact * .25;
  k.vz = (k.vz - vn * nz) * keep + nz * impact * .25;
  const fx = forwardX(k.heading), fz = forwardZ(k.heading);
  if (fx * nx + fz * nz < 0) {
    // Turn toward the wall tangent nearest the nose (ties go down the track) so the kart slides off.
    const s = (fx * -nz + fz * nx) + .01 * (tfx * -nz + tfz * nx) >= 0 ? 1 : -1;
    k.heading += angleDelta(k.heading, Math.atan2(-nz * s, nx * s)) * clamp(impact / 10, .15, .6);
  }
  if (impact > 6) emit('wall', Math.round(impact));
}

function drafting(k: KartState, drafters: readonly Drafter[], p: KartParams) {
  if (!k.grounded || k.boostT > 0 || Math.hypot(k.vx, k.vz) < p.topSpeed * .8) return false;
  for (const o of drafters) {
    if (o.speed < p.topSpeed * .8 || Math.abs(angleDelta(k.heading, o.heading)) > .44) continue;
    const dx = k.x - o.x, dz = k.z - o.z, ofx = Math.sin(o.heading), ofz = Math.cos(o.heading), behind = -(dx * ofx + dz * ofz);
    if (behind > 1.5 && behind < 16 && Math.abs(dz * ofx - dx * ofz) < 2.5) return true;
  }
  return false;
}

/** Star rings: crossing a ring's d this step with the body centre inside its disc boosts once (the crossing is the pass). */
function passRings(k: KartState, track: Track, prevD: number, px: number, py: number, pz: number) {
  const moved = forwardDistance(track, prevD, k.d);
  if (moved <= 0 || moved > 8) return;                                     // reversing, or a teleport
  for (let i = 0; i < track.rings.length; i++) {
    const r = track.rings[i], to = forwardDistance(track, prevD, r.d);
    if (to <= 0 || to > moved) continue;
    const t = to / moved, x = lerp(px, k.x, t), y = lerp(py, k.y, t) + P.ringCentre, z = lerp(pz, k.z, t);
    const across = (x - r.x) * -Math.cos(r.heading) + (z - r.z) * Math.sin(r.heading), up = y - r.y, reach = r.radius + P.ringSlack;
    if (across * across + up * up > reach * reach) continue;
    const v = Math.hypot(k.vx, k.vz) || 1;
    k.vx += k.vx / v * P.ringKick; k.vz += k.vz / v * P.ringKick;
    startBoost(k, P.ringTime, P.ringPower); emit('ring', i);
  }
}

/** Sliding bumpers: a fresh contact knocks the kart sideways across the road, away from the bumper (at least bumperSpeed,
 * faster if the bumper is sliding into it harder), while it keeps most of its speed down the track and turns partly toward
 * the new path; no spin, no item hit. The per-kart cooldown is the contact itself: a kart that was already touching last
 * step (pinned, or just knocked) is only held outside the bumper, keeping its velocity, so each touch knocks once and a
 * dead-centre hit slides round the bumper instead of stopping on it. */
function collideMovers(k: KartState, track: Track, time: number, dt: number, px: number, pz: number, tfx: number, tfz: number) {
  let moved = false;
  for (let i = 0; i < track.movers.length; i++) {
    const m = track.movers[i], reach = m.radius + P.kartRadius;
    if (Math.abs(signedDistance(track, k.d, m.d)) > reach + 6) continue;
    const at = moverPosition(track, m, time), dx = k.x - at.x, dz = k.z - at.z, dist = Math.hypot(dx, dz);
    if (dist >= reach || Math.abs(k.y - at.y) > 2) continue;
    const nx = dist > 1e-6 ? dx / dist : -tfz, nz = dist > 1e-6 ? dz / dist : tfx;
    const was = moverPosition(track, m, time - dt), mvx = (at.x - was.x) / dt, mvz = (at.z - was.z) / dt;
    k.x = at.x + nx * reach; k.z = at.z + nz * reach; moved = true;
    if (Math.hypot(px - was.x, pz - was.z) < reach + .02) continue;        // still in contact: only held outside, it slides round
    // Track frame: r = driver-right of the road. Knock toward the bumper-free side (a dead-centre hit goes the way the bumper isn't moving).
    const rx = -tfz, rz = tfx, nr = nx * rx + nz * rz, mr = mvx * rx + mvz * rz;
    const side = Math.abs(nr) > .05 ? Math.sign(nr) : mr > 0 ? -1 : 1;
    const along = Math.max(0, k.vx * tfx + k.vz * tfz) * P.bumperKeep, across = side * Math.max(P.bumperSpeed, side * mr + 2);
    k.vx = tfx * along + rx * across; k.vz = tfz * along + rz * across;
    k.heading += angleDelta(k.heading, Math.atan2(k.vx, k.vz)) * .4;
    emit('bumper', i);
  }
  return moved;
}

/** Where a respawn puts the kart: lastSafeD on the racing line, skipping past gaps (and the ramps that jump them) so a
 * slow restart never drops straight back in, and never on a spring pad, inside a bumper's sweep or on a loop's footprint. */
export function respawnSpot(track: Track, lastSafeD: number) {
  let d = lastSafeD;
  for (let pass = 0; pass < 3; pass++) {
    for (const g of track.gaps) if (forwardDistance(track, d, g.d0) < 60 || forwardDistance(track, g.d0, d) <= forwardDistance(track, g.d0, g.d1)) d = g.d1 + 6;
    const line = sampleAt(track, d).line;
    for (const r of track.ramps) {
      if (Math.abs(line - r.lat) < r.halfWidth + 1.5 && forwardDistance(track, r.d0 - 3, d) <= forwardDistance(track, r.d0, r.d1) + 5) d = r.d1 + 4;
    }
    for (const s of track.springs) {
      if (Math.abs(line - s.lat) < s.halfWidth + 1.5 && forwardDistance(track, s.d0 - 4, d) <= forwardDistance(track, s.d0, s.d1) + 7) d = s.d1 + 4;
    }
    for (const m of track.movers) {
      if (Math.abs(line - m.lat) < m.amp + m.radius + 2 && Math.abs(signedDistance(track, d, m.d)) < m.radius + 5) d = m.d + m.radius + 5;
    }
    for (const l of track.loops) if (forwardDistance(track, l.d0 - 3, d) <= loopLength(track, l) + 6) d = l.d1 + 6;
  }
  d = ((d % track.length) + track.length) % track.length;
  return { d, lateral: sampleAt(track, d).line };
}

function stepRespawn(k: KartState, track: Track, dt: number) {
  k.respawnT = Math.max(0, k.respawnT - dt);
  k.vx = k.vy = k.vz = 0; k.grounded = false; k.drift = 0; k.driftCharge = 0; k.driftTier = 0; k.surface = 'air'; k.offroad = false;
  if (k.respawnT > P.respawnTime / 2) { k.y += 5 * dt; return; }            // lifted out of the pit
  // Carried to the restart point and lowered; d stays put until release so race progress counts one teleport.
  const spot = respawnSpot(track, k.lastSafeD), pt = pointAt(track, spot.d, spot.lateral);
  k.x = pt.x; k.z = pt.z; k.y = pt.y + 5 * k.respawnT; k.heading = pt.heading;
  if (k.respawnT > 0) return;
  const q = queryTrack(track, k.x, k.z, Math.round(spot.d / track.spacing) % track.samples.length, pt.y);
  k.y = q.ground ?? pt.y; k.grounded = true; k.air = 0;
  k.vx = forwardX(k.heading) * P.respawnSpeed; k.vz = forwardZ(k.heading) * P.respawnSpeed;
  k.hint = q.index; k.d = q.d; k.lateral = q.lateral; k.surface = q.surface; k.lastSafeD = q.d;
  k.invulnT = Math.max(k.invulnT, P.respawnInvuln);
  emit('respawn');
}

/** Apply an item hit. Returns false when blocked (star, invulnerable, respawning, already reeling, or a shield absorbs it). */
export function applyHit(k: KartState, kind: HitKind): boolean {
  if (k.starT > 0 || k.invulnT > 0 || k.respawnT > 0) return false;
  if (kind === 'ink') { k.inkT = P.inkTime; return true; }
  if (k.spinT > 0 || k.tumbleT > 0) return false;
  if (k.shieldT > 0) { k.shieldT = 0; return false; }
  if (kind === 'spin') k.spinT = P.spinTime;
  else if (kind === 'tumble') { k.tumbleT = P.tumbleTime; if (k.loop <= 0) { k.vy = 6; k.grounded = false; } }   // on a loop the ribbon holds it
  else { k.shockT = P.shockTime; k.spinT = P.shockSpin; }
  k.drift = 0; k.driftCharge = 0; k.driftTier = 0; k.boostT = 0; k.boostPower = 0; k.slipCharge = 0; k.tricked = false; k.trickT = 0;
  return true;
}
/** Start or extend a boost; overlapping boosts keep the stronger power and the longer time. */
export function startBoost(k: KartState, seconds: number, power: number) {
  k.boostPower = k.boostT > 0 ? Math.max(k.boostPower, power) : power;
  k.boostT = Math.max(k.boostT, seconds);
}
/** A kart's spine direction for contacts: its heading on the road, its 3D travel direction (the ribbon tangent) on a loop. */
const spine = (k: KartState, v = Math.hypot(k.vx, k.vy, k.vz) || 1) => k.loop > 0 ? [k.vx / v, k.vy / v, k.vz / v] : [forwardX(k.heading), 0, forwardZ(k.heading)];
/** Resolve kart-to-kart overlaps in place. Each kart is a capsule along its heading (≈ the 2.2 × 3 m body, so
 * diagonal neighbours don't interpenetrate the way circles would): inverse-weight separation, restitution 0.4,
 * and a star tumbles whoever it touches (via `onStar(victim, star)`, so the race can route it through strike()).
 * Road pairs compare flat positions within 1.5 m of height. When either kart rides a loop the test is in 3D along the
 * ribbon (steep and upside-down riders can be far apart in height yet touching); only looping karts move in y, and
 * rideLoop reads the push back as θ and lateral. Returns contact pairs (indices) closing faster than 3 m/s. */
export function collideKarts(karts: KartState[], params: KartParams[], onStar = (victim: number, _star: number): unknown => applyHit(karts[victim], 'tumble')): [number, number][] {
  const pairs: [number, number][] = [], r = P.bodyRadius, h = P.bodyHalfLength, reach = 2 * r, far = 2 * (r + h);
  for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) {
    const a = karts[i], b = karts[j], loop = a.loop > 0 || b.loop > 0;
    if (a.respawnT > 0 || b.respawnT > 0 || (!loop && Math.abs(a.y - b.y) >= 1.5)) continue;
    const cx = b.x - a.x, cy = loop ? b.y - a.y : 0, cz = b.z - a.z;
    if (cx * cx + cy * cy + cz * cz >= far * far) continue;
    // Closest points of the two spine segments a ± h·fwd and b ± h·fwd (unit directions, so |d|² = 1).
    const [ax, ay, az] = spine(a), [bx, by, bz] = spine(b);
    const dot = ax * bx + ay * by + az * bz, ca = ax * cx + ay * cy + az * cz, cb = bx * cx + by * cy + bz * cz, denom = 1 - dot * dot;
    let s = denom > 1e-6 ? clamp((ca - dot * cb) / denom, -h, h) : 0, t = dot * s - cb;
    if (t < -h || t > h) { t = clamp(t, -h, h); s = clamp(ca + dot * t, -h, h); }
    const dx = cx + bx * t - ax * s, dy = cy + by * t - ay * s, dz = cz + bz * t - az * s, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= reach * reach) continue;
    const dist = Math.sqrt(d2), cd = Math.hypot(cx, cy, cz);
    const nx = dist > 1e-6 ? dx / dist : cd > 1e-6 ? cx / cd : -Math.cos(a.heading), nz = dist > 1e-6 ? dz / dist : cd > 1e-6 ? cz / cd : Math.sin(a.heading);
    const ny = dist > 1e-6 ? dy / dist : cd > 1e-6 ? cy / cd : 0;
    const ia = 1 / (params[i]?.weight ?? 1), ib = 1 / (params[j]?.weight ?? 1), sum = ia + ib, overlap = reach - dist;
    a.x -= nx * overlap * ia / sum; a.z -= nz * overlap * ia / sum;
    b.x += nx * overlap * ib / sum; b.z += nz * overlap * ib / sum;
    if (a.loop > 0) a.y -= ny * overlap * ia / sum;
    if (b.loop > 0) b.y += ny * overlap * ib / sum;
    const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
    if (closing < 0) {
      const impulse = -1.4 * closing / sum;
      a.vx -= impulse * ia * nx; a.vz -= impulse * ia * nz;
      b.vx += impulse * ib * nx; b.vz += impulse * ib * nz;
      if (a.loop > 0) a.vy -= impulse * ia * ny;
      if (b.loop > 0) b.vy += impulse * ib * ny;
    }
    if (a.starT > 0 && b.starT <= 0) onStar(j, i);
    if (b.starT > 0 && a.starT <= 0) onStar(i, j);
    if (closing < -3) pairs.push([i, j]);
  }
  return pairs;
}
/** Begin a respawn (fell off / out of bounds): lifted away, then placed at lastSafeD after the timer. */
export function beginRespawn(k: KartState) {
  k.respawnT = P.respawnTime; k.vx = k.vz = k.vy = 0; k.drift = 0; k.driftCharge = 0; k.driftTier = 0;
  k.spinT = 0; k.tumbleT = 0; k.boostT = 0; k.boostPower = 0; k.slipCharge = 0; k.trickT = 0; k.tricked = false; k.hopT = 0; k.loop = 0;
}
