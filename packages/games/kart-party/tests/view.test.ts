/* Snapshot projection: serializable in every phase, rounded, lean, and complete enough for prediction. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { createRace, stepRace } from '../src/sim/race';
import { createKartState } from '../src/sim/physics';
import { EVENT_WINDOW, kartFromView, toRaceView } from '../src/sim/view';
import { getTrack } from '../src/tracks/index';
import { decodeRaceView, encodeRaceView, type RaceWire } from '../src/net/wire';
import { rules } from '../src/server';
import { botInput } from '../src/sim/ai';
import type { Race, Settings } from '../src/sim/types';

const settings = (gridSize: number): Settings => ({ track: 'palm-bay', laps: 1, speedClass: 150, difficulty: 'hard', gridSize, items: 'frantic', views: 'tv' });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i + 1}`, color: '#f5a' }));
/** Humans who disconnect are driven by the CPU, so a whole race runs without scripted input. */
function runTo(race: Race, until: (r: Race) => boolean, cap = 60 * 240) {
  for (let i = 0; i < cap && !until(race); i++) stepRace(race, new Map(), 1 / 60);
}
const decimals = (n: number) => { const s = String(n); return s.includes('e') ? 99 : (s.split('.')[1] ?? '').length; };

for (const size of [1, 10]) test(`serializable and lean in every phase with ${size} racer(s)`, () => {
  const race = createRace(settings(size), players(Math.min(size, 2)), 5, 'tv');
  race.racers.forEach(r => { r.connected = false; });
  const phases = new Set<string>();
  const check = () => {
    const view = toRaceView(race);
    assertSerializable(view);
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(view))), JSON.stringify(view), 'JSON round-trips exactly');
    assert.ok(!('rng' in view));
    for (const r of view.racers) {
      assert.ok(!('ai' in r));
      assert.equal('stats' in r, view.phase === 'results', 'stats only at results');
      for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'd', 'lateral', 'progress', 'boostT', 'spinT', 'rollT'] as const) assert.ok(decimals(r[k]) <= 2, `${k}=${r[k]}`);
      assert.ok(decimals(r.heading) <= 3 && decimals(r.steer) <= 3);
    }
    for (const e of view.events) assert.ok(e.t >= view.time - EVENT_WINDOW - 1e-9, 'old events are left out');
    phases.add(view.phase);
    return view;
  };
  check();
  runTo(race, r => r.time > 1.5 || r.phase === 'results'); check();
  runTo(race, r => r.phase === 'results'); const final = check();
  assert.deepEqual([...phases], ['countdown', 'racing', 'results']);
  assert.ok(final.racers.every(r => r.stats && Number.isFinite(r.stats.topSpeed)));
});

test('10 racers mid-race: snapshot size and lapTimes', t => {
  const race = createRace({ ...settings(10), laps: 3 }, players(2), 9, 'tv');     // humans stay connected (idle) so the race keeps going
  let largest = 0, largestWire = 0;
  runTo(race, r => r.racers.some(x => x.lapTimes.length > 0) && r.time > 50, 60 * 120);
  for (let i = 0; i < 200; i++) {
    stepRace(race, new Map(), 1 / 60);
    if (i % 3) continue;
    const view = toRaceView(race), wire = encodeRaceView(view);
    assertSerializable(wire);
    assert.deepEqual(decodeRaceView(JSON.parse(JSON.stringify(wire))), view, 'the compact wire form decodes to the identical view');
    largest = Math.max(largest, JSON.stringify(view).length); largestWire = Math.max(largestWire, JSON.stringify(wire).length);
  }
  const view = toRaceView(race), bytes = JSON.stringify(view).length, perRacer = JSON.stringify(view.racers[0]).length;
  t.diagnostic(`mid-race JSON: ${bytes} B now, ${largest} B largest over 200 ticks (compact wire form: ${largestWire} B), ${perRacer} B per racer, ${view.events.length} events, ${view.entities.length} entities`);
  assert.ok(largestWire <= 4500, `compact wire form ${largestWire} B meets the 4.5 KB target`);
  assert.equal(view.phase, 'racing');
  assert.ok(view.racers.some(r => r.lapTimes.length > 0), 'lap times are kept');
  // The frozen RacerView shape has ~60 named fields (~500 B of keys per racer), so 10 racers cannot
  // fit the 4.5 KB DESIGN target as keyed JSON; this guards the achievable budget instead.
  assert.ok(largest <= 9500, `largest snapshot ${largest} B`);
  assert.ok(perRacer <= 820, `per racer ${perRacer} B`);
});

test('what the server sends: 10 humans with platform UUID ids stay under 4.5 KB for a whole race', t => {
  const humans = Array.from({ length: 10 }, (_, i) => ({ id: `0f3c2a4e-7b1d-4c8e-9a6f-2d5b8e1c7a${String(i).padStart(2, '0')}`, name: `Racer ${i + 1}`, color: '#f5a' }));
  const race = createRace({ ...settings(10), track: 'neon-drive', items: 'normal', speedClass: 100, difficulty: 'normal' }, humans, 7, 'personal');
  let largest = 0, sum = 0, n = 0;
  for (let i = 0; i < 60 * 120 && race.phase !== 'results'; i++) {
    stepRace(race, new Map(race.racers.map(r => [r.id, botInput(race, r)])), 1 / 60);     // connected humans, driven like CPUs
    if (i % 3 || race.phase !== 'racing') continue;
    const wire = rules.publicView(race, { nowMs: 0, phase: 'playing' }), json = JSON.stringify(wire);
    largest = Math.max(largest, json.length); sum += json.length; n++;
    if (i % 300 === 0) assert.deepEqual(decodeRaceView(JSON.parse(json) as RaceWire), toRaceView(race), 'racer ids in events and entities decode back');
  }
  t.diagnostic(`10 humans, UUID ids: ${Math.round(sum / n)} B average, ${largest} B largest over ${n} snapshots`);
  assert.equal(race.phase, 'results', 'the race finished');
  assert.ok(largest <= 4500, `largest snapshot ${largest} B`);
});

test('kartFromView rebuilds exactly the KartState shape from a snapshot', () => {
  const race = createRace(settings(3), players(1), 2, 'tv');
  race.racers.forEach(r => { r.connected = false; });
  runTo(race, r => r.time > 3);
  const racer = race.racers[0], view = toRaceView(race), kart = kartFromView(view.racers[0]);
  const shape = createKartState(0, 0, 0, 0, getTrack('palm-bay'));
  assert.deepEqual(Object.keys(kart).sort(), Object.keys(shape).sort());
  for (const [k, v] of Object.entries(kart)) {
    const truth = (racer as unknown as Record<string, unknown>)[k];
    if (typeof v === 'number') assert.ok(Math.abs(v - (truth as number)) <= .0051, `${k}: ${v} vs ${truth}`);
    else assert.equal(v, truth, k);
  }
  assert.deepEqual(kartFromView(toRaceView({ ...race, racers: [{ ...racer, ...kart }] }).racers[0]), kart, 'a second projection is stable');
});

test('wire codec: results stats survive, decoded views are memoized, plain views pass through', () => {
  const race = createRace(settings(4), players(1), 3, 'tv');
  race.racers.forEach(r => { r.connected = false; });
  runTo(race, r => r.phase === 'results');
  const view = toRaceView(race), wire = encodeRaceView(view);
  assert.deepEqual(decodeRaceView(wire), view);
  assert.equal(decodeRaceView(wire), decodeRaceView(wire));
  assert.equal(decodeRaceView(view), view);
  assert.equal(decodeRaceView(null), null);
});

test('server publicView: the wire form, with human racer ids, decodes to toRaceView; results size', t => {
  const race = createRace(settings(10), players(2), 3, 'tv');
  race.racers.forEach(r => { r.connected = false; });
  const sent = () => rules.publicView(race, { nowMs: 0, phase: 'playing' });
  assert.deepEqual([...sent().players].sort(), ['p0', 'p1'], 'players: human ids only (disconnected humans still count)');
  runTo(race, r => r.phase === 'results');
  const wire = sent(), json = JSON.stringify(wire);
  assertSerializable(wire);
  assert.deepEqual(decodeRaceView(JSON.parse(json) as RaceWire), toRaceView(race));
  t.diagnostic(`10-racer results snapshot: ${json.length} B (keyed JSON: ${JSON.stringify(toRaceView(race)).length} B)`);
  assert.ok(json.length <= 6500, `results snapshot ${json.length} B`);
});
