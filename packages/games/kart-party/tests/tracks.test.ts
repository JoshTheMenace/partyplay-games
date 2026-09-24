import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_DEFS, TRACK_IDS, getTrack, isTrackId } from '../src/tracks/index';
import { forwardDistance, gravityScale, gridSlot, loopPose, pointAt, queryTrack, sampleAt, signedDistance, type Track, type TrackSample } from '../src/sim/track';
import { loopLength, PHYSICS, respawnSpot } from '../src/sim/physics';
import { TOP_SPEED } from '../src/sim/stats';
import { createRace, NEUTRAL_INPUT, stepRace } from '../src/sim/race';
import { angleDelta, clamp, headingOf, wrap } from '../src/sim/math';

const GRAVITY = 28, LIP_SPEED = TOP_SPEED[100] * 0.85;
const PROPS: Record<string, string[]> = {
  any: ['cone', 'tire_stack', 'barrier', 'arrow_sign', 'crowd_stand', 'balloon_arch', 'lamp_post', 'flag_pole'],
  beach: ['palm_a', 'palm_b', 'umbrella', 'beach_hut', 'lifeguard_tower', 'rock_beach', 'boat'],
  desert: ['cactus_a', 'cactus_b', 'rock_red_a', 'rock_red_b', 'mesa', 'water_tower', 'windmill'],
  city: ['building_a', 'building_b', 'building_c', 'street_light', 'neon_sign', 'billboard', 'parked_car'],
  snow: ['pine_a', 'pine_b', 'snow_rock', 'cabin', 'snowman', 'ice_crystal'],
  space: ['planet_ringed', 'asteroid_a', 'asteroid_b', 'space_station', 'satellite', 'star_crystal'],
};
/** Ground footprint radius of each prop at scale 1 (trunks for trees, bases for posts; canopies may overhang the apron). */
const FOOT: Record<string, number> = {
  cone: .3, tire_stack: .5, barrier: 2, arrow_sign: 1.4, crowd_stand: 5.5, balloon_arch: 11.3, lamp_post: .5, flag_pole: .5,
  palm_a: 1.2, palm_b: 1.2, umbrella: 1.7, beach_hut: 2.2, lifeguard_tower: 3.6, rock_beach: 2.3, boat: 2.1,
  cactus_a: 1.5, cactus_b: 1.6, rock_red_a: 2.8, rock_red_b: 4.4, mesa: 25.7, water_tower: 2.5, windmill: 3.8,
  building_a: 7.6, building_b: 6.2, building_c: 5.3, street_light: .5, neon_sign: 2.6, billboard: 5.2, parked_car: 2.2,
  pine_a: 1.5, pine_b: 2, snow_rock: 2.4, cabin: 3.2, snowman: 1.2, ice_crystal: 1.7,
  planet_ringed: 63, asteroid_a: 4.5, asteroid_b: 3.3, space_station: 27, satellite: 3.9, star_crystal: 1.8,
};
/** Per-course lap length (m) and hard-CPU single-lap window (s): Rainbow Road is the long finale. */
const PACE = (id: string) => id === 'rainbow-road' ? { len: [1400, 1600], lap: [40, 55] } : { len: [950, 1300], lap: [30, 50] };
const inGap = (t: Track, d: number) => t.gaps.some(g => forwardDistance(t, g.d0, d) <= forwardDistance(t, g.d0, g.d1));
const tracks = TRACK_IDS.map(id => getTrack(id));
const extent = (s: TrackSample, side: number) => s.halfWidth + (side < 0 ? s.runoffL : s.runoffR);
/** Curvature averaged over ±6 m, so spline noise does not read as a kink. */
const smoothK = (t: Track, i: number) => { let k = 0; for (let o = -3; o <= 3; o++) k += t.samples[wrap(i + o, t.samples.length)].curvature; return k / 7; };
const inGrid = (t: Track, d: number) => wrap(d, t.length) > t.length - 45;
/** Ballistic flight from (d0, lat) along the road heading, launched with `vy` (gravity scaled by zones, like the physics).
 * Records the rings whose disc the body centre crosses and where (and whether) it comes down on the course. */
function arc(t: Track, d0: number, lat: number, speed: number, vy: number, y0 = pointAt(t, d0, lat).y) {
  const p0 = pointAt(t, d0, lat), h = sampleAt(t, d0).heading, fx = Math.sin(h), fz = Math.cos(h), rings = new Set<number>();
  let x = p0.x, z = p0.z, y = y0, d = wrap(d0, t.length), hint = Math.round(d / t.spacing) % t.samples.length, time = 0;
  for (let k = 0; k < 4000; k++) {
    const dt = 1 / 240, px = x, py = y, pz = z, pd = d;
    x += fx * speed * dt; z += fz * speed * dt; vy -= GRAVITY * gravityScale(t, d) * dt; y += vy * dt; time += dt;
    const q = queryTrack(t, x, z, hint, y); hint = q.index; d = q.d;
    const moved = forwardDistance(t, pd, d);
    t.rings.forEach((r, i) => {
      const to = forwardDistance(t, pd, r.d), f = to / moved;
      if (to <= 0 || to > moved || moved > 5) return;
      const across = (px + (x - px) * f - r.x) * -Math.cos(r.heading) + (pz + (z - pz) * f - r.z) * Math.sin(r.heading), up = py + (y - py) * f + PHYSICS.ringCentre - r.y;
      if (Math.hypot(across, up) <= r.radius) rings.add(i);
    });
    if (q.beyond) return { landed: false, d, lateral: q.lateral, time, beyond: true, rings };
    if (q.ground !== null && y <= q.ground && time > 0.05) return { landed: true, d, lateral: q.lateral, time, beyond: false, surface: q.surface, rings };
  }
  return { landed: false, d: -1, lateral: 0, time, beyond: false, rings };
}
/** Ballistic flight off a ramp lip at `speed`, following DESIGN §3: vy = v·slope·1.15 + 2. */
function flight(t: Track, lipD: number, lat: number, speed: number) {
  const before = pointAt(t, lipD - 0.3, lat), q0 = queryTrack(t, before.x, before.z, Math.round(lipD / t.spacing) % t.samples.length, before.y);
  assert.ok(q0.ramp >= 0, `${t.def.id}: no ramp under the lip at ${lipD.toFixed(1)}`);
  return arc(t, lipD, lat, speed, speed * q0.slope * 1.15 + 2, q0.ground!);
}
/** Launch speeds to check: every class at top speed, and 100/150cc on a boost. */
const SPEEDS = [TOP_SPEED[50], TOP_SPEED[100], TOP_SPEED[150], TOP_SPEED[200], TOP_SPEED[100] * 1.4, TOP_SPEED[150] * 1.4];

test('registry exposes the five courses in display order, Rainbow Road last', () => {
  assert.deepEqual(TRACK_IDS, ['palm-bay', 'mesa-rally', 'neon-drive', 'frost-peak', 'rainbow-road']);
  assert.ok(isTrackId('neon-drive') && isTrackId('rainbow-road') && !isTrackId('nope') && !isTrackId(3));
  assert.equal(getTrack('palm-bay'), getTrack('palm-bay'));
  for (const id of TRACK_IDS) assert.equal(TRACK_DEFS[id].id, id);
  assert.deepEqual(TRACK_IDS.map(id => TRACK_DEFS[id].theme), ['beach', 'desert', 'city', 'snow', 'space']);
});

for (const t of tracks) {
  const id = t.def.id, S = t.samples, n = S.length, L = t.length;

  test(`${id}: closed loop with a lap length in its pacing window`, () => {
    const a = S[0], b = S[n - 1], [lo, hi] = PACE(id).len;
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < t.spacing * 1.5, 'loop is not closed');
    assert.ok(L >= lo && L <= hi, `lap length ${L.toFixed(0)} m`);
    for (const s of S) assert.ok([s.x, s.y, s.z, s.line, s.curvature].every(Number.isFinite));
  });

  test(`${id}: corners are drivable and include drift hairpins`, () => {
    let min = Infinity, tight = 0, inTight = false;
    for (let i = 0; i < n; i++) {
      const r = 1 / Math.max(1e-9, Math.abs(smoothK(t, i)));
      min = Math.min(min, r);
      if (r < 36 && !inTight) tight++;
      inTight = r < 36;
    }
    assert.ok(min >= 18, `minimum radius ${min.toFixed(1)} m`);
    assert.ok(tight >= 2, `only ${tight} tight corners`);
    // Grades stay kart-friendly (over a gap there is no road to drive).
    for (const s of S) assert.ok(Math.abs(s.ty) < 0.2 || inGap(t, s.d), `grade ${(s.ty * 100).toFixed(0)}% at ${s.d.toFixed(0)}`);
  });

  test(`${id}: road width varies deliberately within 13–20 m (a loop's lane may narrow to 12 m from run-in to run-out)`, () => {
    const lane = (d: number) => t.loops.some(l => forwardDistance(t, l.d0 - 20, d) < loopLength(t, l) + 48);
    for (const s of S) if (lane(s.d)) assert.ok(s.halfWidth * 2 >= 12 - 1e-6, `loop lane ${(s.halfWidth * 2).toFixed(1)} m at ${s.d.toFixed(0)}`);
    const widths = S.filter(s => !lane(s.d)).map(s => s.halfWidth * 2), lo = Math.min(...widths), hi = Math.max(...widths);
    assert.ok(lo >= 13 - 1e-6 && hi <= 20 + 1e-6, `width ${lo}–${hi}`);
    assert.ok(hi - lo >= 3, 'width barely varies');
  });

  test(`${id}: separate stretches never overlap unless stacked ≥ 7 m apart`, () => {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = S[i], b = S[j], dx = b.x - a.x, dz = b.z - a.z, dist = Math.hypot(dx, dz);
      const sideA = Math.sign(dx * a.rx + dz * a.rz) || 1, sideB = Math.sign(-dx * b.rx - dz * b.rz) || 1;
      const reach = extent(a, sideA) + extent(b, sideB), along = Math.abs(signedDistance(t, a.d, b.d));
      if (along < Math.max(60, 3 * reach)) continue;
      assert.ok(dist > reach + 1 || Math.abs(a.y - b.y) >= 7, `${a.d.toFixed(0)} m and ${b.d.toFixed(0)} m overlap (${dist.toFixed(1)} ≤ ${reach.toFixed(1)}, Δy ${(a.y - b.y).toFixed(1)})`);
    }
  });

  test(`${id}: racing line stays inside the road`, () => {
    for (const s of S) assert.ok(Math.abs(s.line) <= s.halfWidth - 2.4, `line ${s.line.toFixed(1)} at ${s.d.toFixed(0)}`);
  });

  test(`${id}: start straight fits the full grid`, () => {
    for (let d = -48; d <= 40; d += 2) {
      const i = Math.round(wrap(d, L) / t.spacing) % n;
      assert.ok(Math.abs(smoothK(t, i)) < 1 / 300, `start area bends at ${d} m`);
      assert.ok(S[i].halfWidth * 2 >= 15, 'grid road too narrow');
      if (d <= 0) assert.ok(Math.abs(S[i].ty) < 0.03, `grid is on a slope at ${d} m`);
    }
    for (let slot = 0; slot < 10; slot++) {
      const g = gridSlot(t, slot), q = queryTrack(t, g.x, g.z, -1, g.y);
      assert.equal(q.surface, 'road', `grid slot ${slot} is on ${q.surface}`);
    }
  });

  test(`${id}: item rows, boxes and boost pads sit on the course`, () => {
    assert.ok(t.def.itemRows.length >= 3 && t.def.itemRows.length <= 4, 'item rows');
    assert.ok(t.pads.length >= 2 && t.pads.length <= 4, 'boost pads');
    for (const b of t.boxes) {
      const s = sampleAt(t, b.d), q = queryTrack(t, b.x, b.z, Math.round(b.d / t.spacing) % n, b.y);
      assert.ok(Math.abs(b.lateral) <= s.halfWidth - 1.5 && q.ground !== null && q.ramp < 0 && !inGrid(t, b.d), `box at ${b.d.toFixed(0)}`);
    }
    for (const p of t.pads) {
      const s = sampleAt(t, p.d0), side = Math.sign(p.lat) || 1;
      assert.ok(Math.abs(p.lat) + p.halfWidth <= extent(s, side) - 0.5, `pad at ${p.d0.toFixed(0)} leaves the course`);
      assert.ok(!t.gaps.some(g => forwardDistance(t, g.d0, p.d0) < forwardDistance(t, g.d0, g.d1)) && !inGrid(t, p.d0), `pad at ${p.d0.toFixed(0)}`);
    }
    for (const z of t.zones) assert.ok(!inGrid(t, z.d0) && !inGrid(t, z.d1), 'surface zone on the grid');
  });

  test(`${id}: ramps sit on the road and every jump lands cleanly`, () => {
    assert.ok(t.ramps.length >= 1, 'needs a ramp');
    for (const r of t.ramps) {
      const s = sampleAt(t, r.d0);
      assert.ok(Math.abs(r.lat) + r.halfWidth <= s.halfWidth + 0.01 && r.height > 0, `ramp at ${r.d0.toFixed(0)} leaves the road`);
      for (const lat of [r.lat - r.halfWidth + 1.2, r.lat, r.lat + r.halfWidth - 1.2]) for (const speed of [LIP_SPEED, TOP_SPEED[100], TOP_SPEED[200]]) {
        const f = flight(t, r.d1 - 0.05, lat, speed);
        assert.ok(f.landed, `${speed.toFixed(0)} m/s off the ramp at ${r.d0.toFixed(0)} (lat ${lat.toFixed(1)}) does not land: ${JSON.stringify(f)}`);
        assert.ok(Math.abs(f.lateral) <= sampleAt(t, f.d).halfWidth + 1, `ramp at ${r.d0.toFixed(0)} lands off the road`);
      }
    }
  });

  test(`${id}: every gap has a full-width ramp and is clearable at 85% of top speed`, () => {
    for (const g of t.gaps) {
      // A short lip ledge (0.5–3 m) between the ramp top and the gap, so the kart leaves solid ground and gets the lip kick.
      const r = t.ramps.find(r => { const lip = signedDistance(t, r.d1, g.d0); return lip >= 0.5 && lip <= 3; });
      assert.ok(r, `gap at ${g.d0.toFixed(0)} has no ramp ending just before its edge`);
      const s = sampleAt(t, r.d1);
      assert.ok(r.lat - r.halfWidth <= -s.halfWidth + 0.01 && r.lat + r.halfWidth >= s.halfWidth - 0.01, 'gap ramp must span the road');
      for (const lat of [-s.halfWidth + 1.2, 0, s.halfWidth - 1.2]) {
        const f = flight(t, r.d1 - 0.05, lat, LIP_SPEED), margin = signedDistance(t, g.d1, f.d);
        assert.ok(f.landed && margin >= 3, `gap at ${g.d0.toFixed(0)}–${g.d1.toFixed(0)}: lands ${margin.toFixed(1)} m past it`);
      }
    }
  });

  test(`${id}: obstacles leave a clear lane`, () => {
    for (const o of t.obstacles) {
      const s = sampleAt(t, o.d), blocked = t.obstacles.filter(p => Math.abs(signedDistance(t, p.d, o.d)) < p.radius + o.radius + 2.5)
        .map(p => [p.lateral - p.radius - 1.3, p.lateral + p.radius + 1.3]).sort((a, b) => a[0] - b[0]);
      let edge = -s.halfWidth, widest = 0;
      for (const [a, b] of blocked) { widest = Math.max(widest, a - edge); edge = Math.max(edge, b); }
      widest = Math.max(widest, s.halfWidth - edge);
      assert.ok(widest >= 5, `obstacles at ${o.d.toFixed(0)} leave only ${widest.toFixed(1)} m`);
      assert.ok(Math.abs(o.lateral) < extent(s, Math.sign(o.lateral)) - o.radius && !inGrid(t, o.d), `obstacle at ${o.d.toFixed(0)}`);
    }
  });

  test(`${id}: landmarks are themed props well clear of every stretch of road`, () => {
    assert.ok(t.def.landmarks.length >= 6, 'too few landmarks');
    for (const lm of t.def.landmarks) {
      assert.ok([...PROPS.any, ...PROPS[t.def.theme]].includes(lm.kind), `unknown prop ${lm.kind}`);
      const s = sampleAt(t, lm.at * L), lat = lm.side * (extent(s, lm.side) + lm.offset), x = s.x + s.rx * lat, z = s.z + s.rz * lat;
      // Space props float, so only grounded themes need a wall between the road and a landmark.
      if (t.def.theme !== 'space') assert.equal(lm.side < 0 ? s.edgeL : s.edgeR, 'wall', `${lm.kind} at ${(lm.at * L).toFixed(0)} m would stand in the pit beyond a drop`);
      const r = FOOT[lm.kind] * (lm.scale ?? 1) + 1;
      for (const c of S) {
        const dx = x - c.x, dz = z - c.z, side = Math.sign(dx * c.rx + dz * c.rz) || 1;
        assert.ok(Math.hypot(dx, dz) > extent(c, side) + r, `${lm.kind} at ${(lm.at * L).toFixed(0)} m intrudes on the course near ${c.d.toFixed(0)} m`);
      }
    }
  });
  test(`${id}: springs, star rings, gravity zones and bumpers are fair and reachable`, () => {
    for (const g of t.gravity) assert.ok(g.scale > 0 && g.scale <= 1 && !inGrid(t, g.d0) && !inGrid(t, g.d1), 'gravity zone off the grid');
    for (const sp of t.springs) {
      const s = sampleAt(t, sp.d0);
      assert.ok(Math.abs(sp.lat) + sp.halfWidth <= s.halfWidth + 1e-6 && !inGap(t, sp.d0) && !inGap(t, sp.d1) && !inGrid(t, sp.d0), `spring at ${sp.d0.toFixed(0)} sits on the road`);
      for (const lat of [sp.lat - sp.halfWidth + .5, sp.lat, sp.lat + sp.halfWidth - .5]) for (const v of SPEEDS) {
        const f = arc(t, sp.d0 + .3, lat, v, sp.power);
        assert.ok(f.landed && f.surface !== 'air', `spring at ${sp.d0.toFixed(0)} (lat ${lat.toFixed(1)}, ${v.toFixed(0)} m/s) lands off the course: ${JSON.stringify({ ...f, rings: [...f.rings] })}`);
      }
    }
    // Every ring hangs clear above the road and is reachable: driven through, or on a spring/ramp arc for every launch speed.
    t.rings.forEach((r, i) => {
      const s = sampleAt(t, r.d);
      assert.ok(r.height - r.radius >= .2 && Math.abs(r.lat) <= s.halfWidth, `ring ${i} at ${r.d.toFixed(0)} is not above the road`);
      if (Math.abs(r.height - PHYSICS.ringCentre) < r.radius - .3 && !inGap(t, r.d)) return;   // low enough to drive through
      const sources = [...t.springs.filter(sp => forwardDistance(t, sp.d0, r.d) < 120).map(sp => (v: number) => arc(t, sp.d0 + .3, sp.lat + clamp(r.lat - sp.lat, -sp.halfWidth + .5, sp.halfWidth - .5), v, sp.power)),
        ...t.ramps.filter(rp => forwardDistance(t, rp.d1, r.d) < 60).map(rp => (v: number) => flight(t, rp.d1 - .05, clamp(r.lat, rp.lat - rp.halfWidth + 1, rp.lat + rp.halfWidth - 1), v))];
      assert.ok(sources.some(fly => SPEEDS.every(v => fly(v).rings.has(i))), `ring ${i} at ${r.d.toFixed(0)} is not on a drive line or on its spring/ramp arc at every speed`);
    });
    for (const [i, m] of t.movers.entries()) {
      for (const dd of [-m.radius, 0, m.radius]) assert.ok(Math.abs(m.lat) + m.amp + m.radius <= sampleAt(t, m.d + dd).halfWidth + 1e-6, `bumper ${i} sweeps off the road`);
      assert.ok(!inGrid(t, m.d) && !inGap(t, m.d) && m.period > 0, `bumper ${i}`);
      for (const o of t.obstacles) if (Math.abs(signedDistance(t, o.d, m.d)) < o.radius + m.radius + 1) assert.ok(Math.abs(o.lateral - m.lat) > o.radius + m.radius + m.amp, `bumper ${i} sweeps through an obstacle`);
      // At every moment a kart-wide lane stays open through the bumpers alongside this one.
      const s = sampleAt(t, m.d), mates = t.movers.filter(o => Math.abs(signedDistance(t, o.d, m.d)) < o.radius + m.radius + 2);
      for (let k = 0; k < 48; k++) {
        const time = m.period * k / 48, spans = mates.map(o => { const c = o.lat + o.amp * Math.sin(2 * Math.PI * (time / o.period + o.phase)); return [c - o.radius, c + o.radius]; }).sort((a, b) => a[0] - b[0]);
        let edge = -s.halfWidth - s.runoffL, widest = 0;
        for (const [a, b] of spans) { widest = Math.max(widest, a - edge); edge = Math.max(edge, b); }
        assert.ok(Math.max(widest, s.halfWidth + s.runoffR - edge) >= 3.5, `bumpers at ${m.d.toFixed(0)} close the road at t=${time.toFixed(2)}`);
      }
    }
    // Respawns always land on solid road, never on a spring pad or inside a bumper's sweep.
    for (let d = 0; d < L; d += 5) {
      const r = respawnSpot(t, d), p = pointAt(t, r.d, r.lateral), q = queryTrack(t, p.x, p.z, Math.round(r.d / t.spacing) % n, p.y);
      assert.ok(q.ground !== null && q.beyond === 0 && Math.abs(q.lateral) <= q.halfWidth, `respawn from ${d} m lands off the road`);
      assert.ok(t.springs.every(sp => Math.abs(r.lateral - sp.lat) > sp.halfWidth || forwardDistance(t, sp.d0 - 2, r.d) > forwardDistance(t, sp.d0 - 2, sp.d1 + 2)), `respawn from ${d} m is on a spring`);
      assert.ok(t.movers.every(m => Math.abs(signedDistance(t, r.d, m.d)) > m.radius + 2 || Math.abs(r.lateral - m.lat) > m.amp + m.radius + 1), `respawn from ${d} m is in a bumper sweep`);
      assert.ok(t.loops.every(l => forwardDistance(t, l.d0 - 2, r.d) > loopLength(t, l) + 4), `respawn from ${d} m is on a loop's footprint`);
    }
  });
}

test('rainbow-road: a descending corkscrew passes ≥ 7 m under the start straight, and every set-piece is there', () => {
  const t = getTrack('rainbow-road'), S = t.samples, n = S.length, L = t.length, at = (d: number) => S[Math.round(wrap(d, L) / t.spacing) % n];
  for (let d = 0; d <= 80; d += 2) assert.ok(Math.abs(smoothK(t, Math.round(d / t.spacing))) < 1 / 300, `start straight bends at ${d} m`);
  // Comet Corkscrew: the longest same-direction turn winds ≥ 360° while descending.
  let best = { turn: 0, i0: 0, i1: 0 };
  for (let i = 0, run = 0, i0 = 0; i < n; i++) {
    const k = smoothK(t, i);
    if (Math.abs(k) > 1 / 60 && (run === 0 || Math.sign(k) === Math.sign(run))) { if (run === 0) i0 = i; run += k * t.spacing; } else run = 0;
    if (Math.abs(run) > Math.abs(best.turn)) best = { turn: run, i0, i1: i };
  }
  assert.ok(Math.abs(best.turn) >= 2 * Math.PI, `corkscrew winds only ${(Math.abs(best.turn) * 180 / Math.PI).toFixed(0)}°`);
  assert.ok(S[best.i0].y - S[best.i1].y >= 10, 'corkscrew descends');
  let cross = { dist: Infinity, dy: 0, a: 0, b: 0 };
  for (let a = 0; a < 100 / t.spacing; a++) for (let b = best.i0; b <= best.i1 + 20; b++) {
    const dist = Math.hypot(S[a].x - S[b].x, S[a].z - S[b].z);
    if (dist < cross.dist) cross = { dist, dy: S[a].y - S[b].y, a, b };
  }
  assert.ok(cross.dist < 3 && cross.dy >= 7, `corkscrew crossing ${cross.dist.toFixed(1)} m off the start straight, ${cross.dy.toFixed(1)} m below`);
  // Hinted lookups follow both decks through the crossing and the corkscrew's stacked loops.
  for (const [d0, d1] of [[S[cross.a].d - 40, S[cross.a].d + 40], [S[best.i0].d - 20, S[best.i1].d + 40]]) for (const lat of [-5, 0, 5]) {
    let hint = -1, y: number | undefined;
    for (let d = d0; d <= d1; d += 0.5) {
      const p = pointAt(t, d, lat), q = queryTrack(t, p.x, p.z, hint, hint < 0 ? p.y : y);
      assert.ok(Math.abs(signedDistance(t, q.d, d)) < 1.5, `lost at ${wrap(d, L).toFixed(0)} m (lat ${lat}): located ${q.d.toFixed(0)} m`);
      hint = q.index; y = q.ground ?? p.y;
    }
  }
  for (const k of [cross.a, cross.b]) { const p = pointAt(t, S[k].d, 0); assert.ok(Math.abs(signedDistance(t, queryTrack(t, p.x, p.z, -1, p.y).d, S[k].d)) < 1.5, 'cold lookup picked the wrong deck'); }
  // Moon Hop: a low-gravity stretch with spring pads and rings on their arcs.
  const moon = t.gravity.find(g => Math.abs(g.scale - .45) < .05)!, inMoon = (d: number) => forwardDistance(t, moon.d0, d) <= forwardDistance(t, moon.d0, moon.d1);
  assert.ok(moon && t.springs.filter(sp => inMoon(sp.d0)).length >= 2 && t.rings.filter(r => inMoon(r.d) && r.height > 5).length >= 2, 'Moon Hop: springs and air rings in low gravity');
  // Pinball Nebula: star bumpers round a central obstacle on a walled stretch.
  const rock = t.obstacles.find(o => Math.abs(o.lateral) < 1)!;
  assert.ok(rock && t.movers.filter(m => m.kind === 'star_bumper' && Math.abs(signedDistance(t, m.d, rock.d)) < 70).length >= 3 && at(rock.d).edgeL === 'wall' && at(rock.d).edgeR === 'wall', 'Pinball Nebula');
  // Hyperspace Gap: the jump onto the lower ribbon flies through a ring.
  const gap = t.gaps[0], ramp = t.ramps.find(r => signedDistance(t, r.d1, gap.d0) < 3)!;
  assert.ok(ramp && at(gap.d1 + 20).y < at(ramp.d0).y - 3 && flight(t, ramp.d1 - .05, 0, TOP_SPEED[100]).rings.size === 1, 'Hyperspace Gap: ring in the flight path onto a lower ribbon');
  // Warp Stretch: a centre boost lane between open drops, with rings over the racing line after it.
  const lane = t.zones.find(z => z.surface === 'boost' && z.latMin < 0 && z.latMax > 0)!;
  assert.ok(lane && at((lane.d0 + lane.d1) / 2).edgeL === 'drop' && at((lane.d0 + lane.d1) / 2).edgeR === 'drop', 'Warp Stretch lane between drops');
  assert.ok(t.rings.filter(r => { const f = forwardDistance(t, lane.d1, r.d); return f < 80 && Math.abs(r.lat - sampleAt(t, r.d).line) < 1.5; }).length >= 2, 'Warp rings over the racing line');
  // Aurora Esses: banked both ways in the run home.
  const home = S.filter(s => s.d > L * .75);
  assert.ok(home.some(s => s.bank > .1) && home.some(s => s.bank < -.1), 'Aurora Esses bank both ways');
});

test('rainbow-road: the loop-the-loop has a straight, clean run-in; its halves pass ≥ 1 m apart and it clears the rest of the course', () => {
  const t = getTrack('rainbow-road'), S = t.samples, n = S.length, [l] = t.loops, len = loopLength(t, l), W = sampleAt(t, l.d0).halfWidth * 2;
  const tilt = Math.asin(Math.abs(l.fx * l.rx + l.fz * l.rz)) * 180 / Math.PI;
  assert.ok(t.loops.length === 1 && len >= 40 && len <= 45 && l.radius >= 11 && l.radius <= 13 && tilt >= 28 && tilt <= 32, `loop ${len.toFixed(1)} m, radius ${l.radius}, tilt ${tilt.toFixed(1)}°`);
  // A straight, level approach; guard rails and one lane width from just before the entry to just past the exit.
  for (let d = l.d0 - 50; d <= l.d1 + 10; d += 2) assert.ok(Math.abs(smoothK(t, Math.round(wrap(d, t.length) / t.spacing) % n)) < 1 / 300, `loop approach bends at ${d.toFixed(0)} m`);
  for (let d = l.d0 - 8; d <= l.d1 + 8; d += 2) {
    const s = sampleAt(t, d);
    assert.ok(Math.abs(s.halfWidth * 2 - W) < .05 && s.edgeL === 'wall' && s.edgeR === 'wall' && s.runoffL <= 1.5 && s.runoffR <= 1.5 && Math.abs(s.ty) < .02, `loop lane at ${d.toFixed(0)} m`);
  }
  // Nothing in the run-in or on the footprint: no boxes, rings, pads, lanes, ramps, springs, gaps, bumpers or rocks.
  const near = (d: number) => forwardDistance(t, l.d0 - 30, d) <= len + 35;
  assert.ok(t.boxes.every(b => !near(b.d)) && t.rings.every(r => !near(r.d)) && t.movers.every(m => !near(m.d)) && t.obstacles.every(o => !near(o.d)), 'boxes, rings, bumpers or rocks by the loop');
  for (const s of [...t.pads, ...t.zones, ...t.ramps, ...t.springs, ...t.gaps]) assert.ok(!near(s.d0) && !near(s.d1) && !near((s.d0 + s.d1) / 2), `a feature at ${s.d0.toFixed(0)} m is by the loop`);
  // Every jump (200cc on a boost, the longest flight) has come down well before the entry.
  for (const r of t.ramps) {
    const f = flight(t, r.d1 - .05, r.lat, TOP_SPEED[200] * 1.4);
    assert.ok(f.landed && forwardDistance(t, r.d1, f.d) < forwardDistance(t, r.d1, l.d0) - 60, `the ramp at ${r.d0.toFixed(0)} m lands ${forwardDistance(t, f.d, l.d0).toFixed(0)} m before the loop`);
  }
  // The rising and falling halves, as lane-wide strips across the loop's lateral axis, keep ≥ 1 m of clearance except where
  // they merge over the top (±0.5 rad); where they cross in side view their centres are ≥ lane width + 1 m apart.
  const strip = (a: number, b: number) => {
    const p = loopPose(l, a, 0), q = loopPose(l, b, 0), dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z, lat = Math.abs(dx * l.rx + dz * l.rz);
    return { lat, perp: Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - lat * lat)) };
  };
  for (let i = 0; i <= 240; i++) for (let j = 0; j <= 240; j++) {
    const a = i / 240 * (Math.PI - .5), b = Math.PI + .5 + j / 240 * (Math.PI - .5), { lat, perp } = strip(a, b);
    assert.ok(Math.hypot(perp, Math.max(0, lat - W)) >= 1, `loop strips at θ ${a.toFixed(2)} / ${b.toFixed(2)} only ${Math.hypot(perp, Math.max(0, lat - W)).toFixed(2)} m apart`);
  }
  let cross = { perp: Infinity, lat: 0 };
  for (let i = 1; i < 600; i++) { const a = i / 600 * (Math.PI - .5), c = strip(a, 2 * Math.PI - a); if (c.perp < cross.perp) cross = c; }
  assert.ok(cross.perp < .5 && cross.lat >= W + 1, `side-view crossing: centres ${cross.lat.toFixed(2)} m apart for a ${W} m lane`);
  // Clear of every other stretch of road: ≥ 2 m outside its apron, or ≥ 7 m above or below it.
  for (let th = 0; th <= 2 * Math.PI; th += .05) for (const lat of [-W / 2, 0, W / 2]) {
    const p = loopPose(l, th, lat);
    for (const s of S) {
      if (forwardDistance(t, l.d0 - 40, s.d) < len + 80) continue;
      assert.ok(Math.hypot(p.x - s.x, p.z - s.z) > s.halfWidth + Math.max(s.runoffL, s.runoffR) + 2 || Math.abs(p.y - s.y) >= 7, `loop at θ ${th.toFixed(2)} hits the road at ${s.d.toFixed(0)} m`);
    }
  }
});

test('rainbow-road: every class can take either Moon Hop spring after the crest, merged late or not, and lands before the nebula corner', () => {
  const t = getTrack('rainbow-road'), corner = t.samples.find(s => s.d > t.springs[0].d1 && s.edgeL === 'wall')!.d;
  for (const cc of [50, 100, 150, 200] as const) for (const boost of [1, 1.25]) for (const sp of t.springs) for (const late of [false, true]) {
    const race = createRace({ track: 'rainbow-road', laps: 3, speedClass: cc, difficulty: 'normal', gridSize: 1, items: 'off', views: 'tv' }, [{ id: 'h', name: 'h', color: '#fff' }], 1, 'tv'), me = race.racers[0];
    const d0 = t.gravity[0].d0 - 10, lane = (d: number) => late && d < sp.d0 - 35 ? 0 : sp.lat, p = pointAt(t, d0, lane(d0)), v = TOP_SPEED[cc] * boost;
    Object.assign(race, { time: 20, phase: 'racing' });
    Object.assign(me, { x: p.x, y: p.y, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * v, vz: Math.cos(p.heading) * v, hint: -1, d: d0, lastSafeD: d0, progress: d0 });
    const tag = `${cc}cc ×${boost} spring ${sp.lat}${late ? ' merged late' : ''}`;
    let seen = race.serial, sprung = false, landed = -1, seq = 0;
    for (let i = 0; i < 60 * 8 && me.d < corner + 20; i++) {
      const aim = pointAt(t, me.d + 14, lane(me.d)), was = me.grounded;
      stepRace(race, new Map([['h', { ...NEUTRAL_INPUT, steer: clamp(-angleDelta(me.heading, headingOf(aim.x - me.x, aim.z - me.z)) * 3, -1, 1), seq: ++seq }]]), 1 / 60);
      for (const e of race.events) if (e.id > seen) { seen = e.id; assert.notEqual(e.type, 'fall', `${tag}: fell at ${me.d.toFixed(0)} m`); if (e.type === 'spring') sprung = true; }
      if (sprung && landed < 0 && !was && me.grounded) landed = me.d;
    }
    assert.ok(sprung && landed > sp.d1 && landed < corner, `${tag}: sprung ${sprung}, landed at ${landed.toFixed(0)} m (corner at ${corner.toFixed(0)} m)`);
  }
});

test('neon-drive: the figure eight crosses with a ≥ 7 m overpass that locate() never confuses', () => {
  const t = getTrack('neon-drive'), S = t.samples;
  let best = { dist: Infinity, i: 0, j: 0 };
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
    if (Math.abs(signedDistance(t, S[i].d, S[j].d)) < 100) continue;
    const dist = Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z);
    if (dist < best.dist) best = { dist, i, j };
  }
  assert.ok(best.dist < 3, 'the course does not cross itself');
  assert.ok(Math.abs(S[best.i].y - S[best.j].y) >= 7, 'overpass clearance below 7 m');
  for (const k of [best.i, best.j]) for (const lat of [-5, 0, 5]) {
    let hint = -1, y: number | undefined;
    for (let d = S[k].d - 50; d <= S[k].d + 50; d += 0.5) {
      const p = pointAt(t, d, lat), q = queryTrack(t, p.x, p.z, hint, hint < 0 ? p.y : y);
      assert.ok(Math.abs(signedDistance(t, q.d, d)) < 1.5, `lost at ${wrap(d, t.length).toFixed(0)} m (lat ${lat}): located ${q.d.toFixed(0)} m`);
      hint = q.index; y = q.ground ?? p.y;
    }
    // A cold lookup that knows its height also picks the right deck.
    const p = pointAt(t, S[k].d, lat);
    assert.ok(Math.abs(signedDistance(t, queryTrack(t, p.x, p.z, -1, p.y).d, S[k].d)) < 1.5, 'cold lookup picked the wrong deck');
  }
});

test('course identities: sea and sand at Palm Bay, a canyon gap at Mesa, ice and cliffs at Frost', () => {
  const palm = getTrack('palm-bay'), mesa = getTrack('mesa-rally'), frost = getTrack('frost-peak');
  assert.ok(palm.zones.some(z => z.surface === 'water') && palm.pads.some(p => Math.abs(p.lat) + p.halfWidth > sampleAt(palm, p.d0).halfWidth + 2), 'Palm Bay: surf and a sand-cut pad');
  assert.ok(mesa.gaps.length >= 1 && mesa.samples.some(s => s.edgeL === 'drop' || s.edgeR === 'drop') && mesa.obstacles.length >= 3, 'Mesa: gap, drops, rocks');
  const ys = mesa.samples.map(s => s.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) >= 20, 'Mesa: big elevation');
  assert.ok(frost.zones.some(z => z.surface === 'ice') && frost.samples.filter(s => s.edgeL === 'drop' || s.edgeR === 'drop').length > 100, 'Frost: ice and cliffs');
});

/** Shakedown: a lap of hard CPUs per course (items off) must finish in the pacing window without anyone
 * getting stuck or falling off, so every corner, jump and hazard is actually drivable by the AI. */
for (const id of TRACK_IDS) test(`${id}: CPUs lap cleanly in the pacing window`, () => {
  const race = createRace({ track: id, laps: 1, speedClass: 100, difficulty: 'hard', gridSize: 6, items: 'off', views: 'auto' }, [], 11, 'tv');
  const slow = new Map<string, number>();
  let falls = 0, seen = 0;
  for (let n = 0; n < 60 * 90 && race.phase !== 'results' && race.racers.some(r => r.finishTime === null); n++) {
    stepRace(race, new Map(), 1 / 60);
    for (const e of race.events) if (e.id > seen) { seen = e.id; if (e.type === 'fall') falls++; }
    if (race.phase !== 'racing') continue;
    for (const r of race.racers) {
      const stuck = r.finishTime === null && r.respawnT <= 0 && Math.hypot(r.vx, r.vz) < 3 ? (slow.get(r.id) ?? 0) + 1 / 60 : 0;
      slow.set(r.id, stuck);
      assert.ok(stuck < 3, `${r.name} stuck at ${r.d.toFixed(0)} m`);
    }
  }
  assert.ok(falls <= 1, `${falls} falls`);
  for (const r of race.racers) {
    assert.ok(r.lapTimes.length === 1, `${r.name} did not finish the lap`);
    assert.ok(r.lapTimes[0] >= PACE(id).lap[0] && r.lapTimes[0] <= PACE(id).lap[1], `${r.name} lapped in ${r.lapTimes[0]} s`);
  }
});
