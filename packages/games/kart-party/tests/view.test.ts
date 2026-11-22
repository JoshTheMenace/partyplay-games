/* Snapshot projection: serializable in every phase, rounded, lean, and complete enough for prediction. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { createRace, stepRace } from '../src/sim/race';
import { createKartState } from '../src/sim/physics';
import { eventWindow, kartFromView, toOwnView, toRaceView } from '../src/sim/view';
import { hintAt } from '../src/sim/track';
import { getTrack } from '../src/tracks/index';
import { decodeRaceView, encodeRaceView, type RaceWire } from '../src/net/wire';
import { rules } from '../src/server';
import { botInput } from '../src/sim/ai';
import type { Race, RaceView, Settings } from '../src/sim/types';

const settings = (gridSize: number): Settings => ({ track: 'palm-bay', laps: 1, speedClass: 150, difficulty: 'hard', gridSize, items: 'frantic', views: 'tv' });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i + 1}`, color: '#f5a' }));
/** Humans who disconnect are driven by the CPU, so a whole race runs without scripted input. */
function runTo(race: Race, until: (r: Race) => boolean, cap = 60 * 240) {
  for (let i = 0; i < cap && !until(race); i++) stepRace(race, new Map(), 1 / 60);
}
const decimals = (n: number) => { const s = String(n); return s.includes('e') ? 99 : (s.split('.')[1] ?? '').length; };
/** What a screen decodes: the view, with the seat-only prediction fields of every racer but `own` neutral. */
function seen(view: RaceView, own?: string): RaceView {
  const track = getTrack(view.track);
  return { ...view, racers: view.racers.map(r => r.id === own ? r : { ...r, lastSeq: 0, prevHop: 0, prevFire: 0, prevItem: false, prevFly: 0, launch: 0, trickT: 0, air: 0, driftCharge: 0, hint: hintAt(track, r.d) }) };
}
/** Bytes a socket receives per snapshot once it holds the cached roster and settings. */
const steady = (wire: RaceWire) => { const { base: _base, players: _players, final: _final, ...sent } = wire; void _base; void _players; void _final; return JSON.stringify(sent).length; };

for (const size of [1, 10, 64]) test(`serializable and lean in every phase with ${size} racer(s)`, () => {
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
      for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'd', 'lateral', 'steer', 'boostT', 'spinT', 'rollT'] as const) assert.ok(decimals(r[k]) <= 2, `${k}=${r[k]}`);
      assert.ok(decimals(r.heading) <= 3 && !('progress' in r) && !('checkpoint' in r));
    }
    for (const e of view.events) assert.ok(e.t >= view.time - eventWindow(size) - 1e-9, 'old events are left out');
    phases.add(view.phase);
    return view;
  };
  check();
  runTo(race, r => r.time > 1.5 || r.phase === 'results'); check();
  runTo(race, r => r.phase === 'results'); const final = check();
  assert.deepEqual([...phases], ['countdown', 'racing', 'results']);
  assert.ok(final.racers.every(r => r.stats && Number.isFinite(r.stats.topSpeed)));
});

test('10 racers mid-race: the wire form decodes to the identical view, for a watcher and for each seat', t => {
  const race = createRace({ ...settings(10), laps: 3 }, players(2), 9, 'tv');     // humans stay connected (idle) so the race keeps going
  let largest = 0, largestWire = 0;
  runTo(race, r => r.racers.some(x => x.lapTimes.length > 0) && r.time > 50, 60 * 120);
  for (let i = 0; i < 200; i++) {
    stepRace(race, new Map(), 1 / 60);
    if (i % 3) continue;
    const view = toRaceView(race), wire = encodeRaceView(view), json = JSON.stringify(wire);
    assertSerializable(wire);
    assert.deepEqual(decodeRaceView(JSON.parse(json) as RaceWire), seen(view), 'a watching screen decodes every public field exactly');
    assert.deepEqual(decodeRaceView(JSON.parse(json) as RaceWire, JSON.parse(JSON.stringify(toOwnView(race, 'p1')))), seen(view, 'p1'), 'a seat also gets its own prediction fields');
    largest = Math.max(largest, JSON.stringify(view).length); largestWire = Math.max(largestWire, steady(wire));
  }
  const view = toRaceView(race), bytes = JSON.stringify(view).length;
  t.diagnostic(`mid-race keyed JSON: ${bytes} B now, ${largest} B largest over 200 ticks; wire form: ${largestWire} B, ${view.events.length} events, ${view.entities.length} entities`);
  assert.ok(largestWire <= 1500, `wire form ${largestWire} B`);
  assert.equal(view.phase, 'racing');
  assert.ok(view.racers.every(r => r.lapTimes.length === 0) && race.racers.some(r => r.lapTimes.length > 0), 'lap times wait for the results');
  assert.equal(toOwnView(race, 'nobody'), null);
});

for (const [humans, budget] of [[10, 1300], [32, 3000], [64, 6000]]) test(`what the server sends: ${humans} humans with platform UUID ids stay under ${budget} B a snapshot for a whole race`, t => {
  const roster = Array.from({ length: humans }, (_, i) => ({ id: `0f3c2a4e-7b1d-4c8e-9a6f-2d5b8e1c7a${String(i).padStart(2, '0')}`, name: `Racer ${i + 1}`, color: '#f5a' }));
  const race = createRace({ ...settings(humans), track: 'neon-drive', items: 'normal', speedClass: 100, difficulty: 'normal' }, roster, 7, 'personal');
  let largest = 0, sum = 0, n = 0, own = 0;
  for (let i = 0; i < 60 * 150 && race.phase !== 'results'; i++) {
    stepRace(race, new Map(race.racers.map(r => [r.id, { ...botInput(race, r), seq: i + 1 }])), 1 / 60);     // connected humans, driven like CPUs
    if (i % 2 || race.phase !== 'racing') continue;
    const wire = rules.publicView(race, { nowMs: 0, phase: 'playing' }), size = steady(wire), mine = rules.playerView(race, roster[0].id, { nowMs: 0, phase: 'playing' });
    largest = Math.max(largest, size); sum += size; n++; own = Math.max(own, JSON.stringify(mine).length);
    if (i % 300 === 0) assert.deepEqual(decodeRaceView(JSON.parse(JSON.stringify(wire)) as RaceWire, mine), seen(toRaceView(race), roster[0].id), 'racers, events and entities decode back');
  }
  t.diagnostic(`${humans} humans, UUID ids: ${Math.round(sum / n)} B average, ${largest} B largest over ${n} snapshots (+ ${own} B private, + ${JSON.stringify(rules.publicView(race, { nowMs: 0, phase: 'results' }).base).length} B roster once per socket)`);
  assert.equal(race.phase, 'results', 'the race finished');
  assert.ok(largest <= budget, `largest snapshot ${largest} B`);
  assert.ok(own <= 80, `private view ${own} B`);
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
  const view = toRaceView(race), wire = encodeRaceView(view), own = toOwnView(race, 'p0');
  assert.deepEqual(decodeRaceView(wire), seen(view));
  assert.ok(decodeRaceView(wire).racers.every(r => r.stats) && decodeRaceView(wire).racers.some(r => r.lapTimes.length === 1), 'stats and lap times arrive with the results');
  assert.equal(decodeRaceView(wire), decodeRaceView(wire));
  assert.equal(decodeRaceView(wire, own), decodeRaceView(wire, own));
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
  assert.deepEqual(decodeRaceView(JSON.parse(json) as RaceWire), seen(toRaceView(race)));
  t.diagnostic(`10-racer results: ${json.length} B once per socket, then ${steady(wire)} B a snapshot (keyed JSON: ${JSON.stringify(toRaceView(race)).length} B)`);
  assert.ok(json.length <= 4500 && steady(wire) <= 400, `results snapshot ${json.length} B, ${steady(wire)} B repeated`);
  assert.ok(wire.rev > rules.publicView(createRace(settings(2), players(1), 1, 'tv'), { nowMs: 0, phase: 'playing' }).rev, 'results step the cache revision');
});
