/* Whole-race checks: CPUs (and a CPU-driven "human") race real courses from the grid to the results screen. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTDOWN_SECONDS, createRace, NEUTRAL_INPUT, racerOutcome, stepRace } from '../src/sim/race';
import { botInput } from '../src/sim/ai';
import { forwardDistance, pointAt, queryTrack, signedDistance } from '../src/sim/track';
import { loopLength, loopOver } from '../src/sim/physics';
import { getTrack, TRACK_IDS } from '../src/tracks/index';
import type { Input, Race, Settings, SpeedClass, TrackId } from '../src/sim/types';

const DT = 1 / 60;
const settings = (track: TrackId, o: Partial<Settings> = {}): Settings => ({ track, laps: 3, speedClass: 100, difficulty: 'normal', gridSize: 8, items: 'normal', views: 'auto', ...o });
function run(race: Race, human: (race: Race) => Input | null = r => botInput(r, r.racers.find(x => !x.bot)!), limit = 900) {
  const events = new Map<string, number>();
  let seen = 0, seq = 0;
  while (race.phase !== 'results' && race.time < limit) {
    const inputs = new Map<string, Input>();
    seq++;   // seq 0 reads as "no input" to the race loop
    for (const r of race.racers) if (!r.bot) { const i = human(race); if (i) inputs.set(r.id, { ...i, seq }); }
    stepRace(race, inputs, DT);
    for (const e of race.events) if (e.id > seen) { seen = e.id; events.set(e.type, (events.get(e.type) ?? 0) + 1); if (e.type === 'finish') events.set(`finish:${e.racer}`, e.value!); }
    for (const r of race.racers) assert.ok(Number.isFinite(r.x + r.y + r.z + r.vx + r.vz + r.heading), `${r.id} state is finite`);
  }
  return events;
}

for (const id of TRACK_IDS) test(`${id}: a full 100cc CPU race finishes with sane laps, times and ranks`, () => {
  const race = createRace(settings(id), [], 11, 'tv'), track = getTrack(id);
  const events = run(race);
  assert.equal(race.phase, 'results');
  assert.deepEqual(race.racers.map(r => r.rank).sort((a, b) => a - b), race.racers.map((_, i) => i + 1), 'ranks are 1..n');
  const byRank = [...race.racers].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) assert.ok(byRank[i].finishTime! >= byRank[i - 1].finishTime!, 'finish times follow ranks');
  const finishers = race.racers.filter(r => r.lapTimes.length === race.laps);
  assert.ok(finishers.length >= race.racers.length - 1, `${finishers.length} of ${race.racers.length} crossed the line`);
  for (const r of race.racers) assert.ok(r.finishTime !== null && r.finishTime > 0, 'every CPU has a time');
  for (const r of finishers) {
    assert.equal(r.lap, race.laps + 1);
    const total = r.lapTimes.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - r.finishTime!) < .003, `${r.id}: laps sum ${total.toFixed(3)} vs finish ${r.finishTime}`);
    assert.equal(events.get(`finish:${r.id}`), r.rank, `${r.id}: finish event announces the final place`);
    for (const lap of r.lapTimes) assert.ok(lap > track.length / 45 && lap < track.length / 20, `${id} ${r.id}: lap ${lap.toFixed(1)} s on ${track.length.toFixed(0)} m`);
  }
  const best = Math.min(...finishers.flatMap(r => r.lapTimes.slice(1))), [fast, slow] = id === 'rainbow-road' ? [38, 55] : [28, 48];
  assert.ok(best > fast && best < slow, `${id}: best flying lap ${best.toFixed(1)} s`);
  assert.equal(events.get('finish'), finishers.length);
  assert.equal(events.get('final-lap'), race.racers.length);
  assert.ok((events.get('mini-turbo') ?? 0) > 20, 'CPUs drift');
  assert.equal(events.get('fall') ?? 0, events.get('respawn') ?? 0, 'every fall respawns');
  assert.ok((events.get('fall') ?? 0) < race.racers.length * .5, `${events.get('fall')} falls: under half a fall per racer`);
  if (track.rings.length) assert.ok((events.get('ring') ?? 0) > race.racers.length, 'CPUs fly and drive through star rings');
  if (track.movers.length) assert.ok((events.get('bumper') ?? 0) > 0, 'bumpers knock karts about');
  assert.ok(race.time < COUNTDOWN_SECONDS + race.laps * track.length / 8 + 60, 'ended well before the time cap');
});

test('a human driven like a CPU finishes; results follow the celebration and slower CPUs get estimated times', () => {
  const race = createRace(settings('palm-bay'), [{ id: 'p0', name: 'You', color: '#f00' }], 11, 'tv');
  run(race);
  assert.equal(race.phase, 'results');
  const human = race.racers.find(r => !r.bot)!;
  assert.ok(human.finishTime !== null && human.lap === race.laps + 1 && human.lapTimes.length === race.laps);
  assert.ok(race.time - human.finishTime < 3.5 + .5, 'results start after the celebration');
  for (const r of race.racers) assert.ok(r.finishTime !== null && (r.lapTimes.length === race.laps || r.finishTime > human.finishTime), `${r.id} timed`);
  const outcome = racerOutcome(race);
  assert.equal(outcome.complete, true); assert.equal(outcome.rows[0].rank, human.rank); assert.notEqual(outcome.rows[0].label, 'Did not finish');
});

test('every speed class finishes, and faster classes lap faster', () => {
  const times = ([50, 100, 150, 200] as SpeedClass[]).map(cc => {
    const race = createRace(settings('palm-bay', { speedClass: cc, laps: 1, gridSize: 4, items: 'off' }), [], 3, 'tv');
    run(race);
    assert.equal(race.phase, 'results');
    return Math.min(...race.racers.map(r => r.finishTime ?? Infinity));
  });
  for (let i = 1; i < times.length; i++) assert.ok(times[i] < times[i - 1], `class times ${times.map(t => t.toFixed(1)).join(' / ')}`);
});

test('the time cap ends a race nobody can finish; stuck humans are DNF', () => {
  const race = createRace(settings('palm-bay', { laps: 1, gridSize: 1 }), [{ id: 'p0', name: 'Parked', color: '#0f0' }], 5, 'tv');
  const cap = COUNTDOWN_SECONDS + getTrack('palm-bay').length / 8 + 60;
  run(race, () => ({ ...NEUTRAL_INPUT, brake: true, steer: 1 }), cap + 5);
  assert.equal(race.phase, 'results');
  assert.ok(Math.abs(race.time - cap) < 2 * DT, `ended at ${race.time.toFixed(2)} (cap ${cap.toFixed(1)})`);
  assert.equal(race.racers[0].finishTime, null);
  assert.equal(racerOutcome(race).rows[0].label, 'Did not finish');
});

test('driving off a drop edge mid-race falls, respawns on the road and keeps lap progress honest', () => {
  const race = createRace(settings('mesa-rally', { gridSize: 2, items: 'off' }), [{ id: 'p0', name: 'Diver', color: '#00f' }], 9, 'tv'), track = getTrack('mesa-rally');
  const edge = track.samples.find(s => s.edgeR === 'drop' && s.d > 100)!, me = race.racers.find(r => !r.bot)!;
  while (race.phase === 'countdown') stepRace(race, new Map(), DT);
  const start = pointAt(track, edge.d, 0);
  Object.assign(me, { x: start.x, y: start.y, z: start.z, heading: edge.heading - .6, vx: Math.sin(edge.heading - .6) * 25, vz: Math.cos(edge.heading - .6) * 25, hint: -1 });
  stepRace(race, new Map(), DT);
  const progress0 = me.progress;
  let seen = race.serial, fell = 0, respawned = 0, seq = 0;
  for (let i = 0; i < 60 * 6 && !respawned; i++) {
    stepRace(race, new Map([[me.id, { ...NEUTRAL_INPUT, steer: .6, seq: ++seq }]]), DT);
    for (const e of race.events) if (e.id > seen && e.racer === me.id) { seen = e.id; if (e.type === 'fall') fell++; if (e.type === 'respawn') respawned++; }
  }
  assert.equal(fell, 1, 'one fall event'); assert.equal(respawned, 1, 'respawned');
  assert.ok(me.grounded && Math.abs(me.lateral) < track.samples[me.hint].halfWidth && me.invulnT > 1, 'back on the road, invulnerable');
  assert.ok(Math.abs(me.progress - progress0 - ((me.d - edge.d + track.length * 1.5) % track.length - track.length / 2)) < 12, 'progress follows the respawn point');
});

test('rainbow-road: the railed start straight keeps a kart steering hard into either side on the course', () => {
  const track = getTrack('rainbow-road');
  for (const d of [10, 40, 80]) for (const side of [-1, 1]) {
    const race = createRace(settings('rainbow-road', { gridSize: 2, items: 'off' }), [{ id: 'p0', name: 'Diver', color: '#00f' }], 9, 'tv'), me = race.racers.find(r => !r.bot)!;
    while (race.phase === 'countdown') stepRace(race, new Map(), DT);
    const p = pointAt(track, d, 0), h = p.heading + side * 1.1;
    Object.assign(me, { x: p.x, y: p.y, z: p.z, heading: h, vx: Math.sin(h) * 25, vz: Math.cos(h) * 25, hint: -1, d, lastSafeD: d, progress: d });
    let seen = race.serial, fell = 0, seq = 0;
    for (let i = 0; i < 60 * 2; i++) {
      stepRace(race, new Map([[me.id, { ...NEUTRAL_INPUT, steer: side, seq: ++seq }]]), DT);
      for (const e of race.events) if (e.id > seen && e.racer === me.id) { seen = e.id; if (e.type === 'fall') fell++; }
    }
    assert.ok(fell === 0 && me.grounded && me.respawnT === 0, `d ${d} side ${side}: ${fell} falls`);
  }
});

test('rainbow-road: every racer rides the loop-the-loop once a lap; progress and ranks run smoothly through it; items wait for the exit', () => {
  const race = createRace(settings('rainbow-road', { gridSize: 8, items: 'frantic' }), [], 5, 'tv'), track = getTrack('rainbow-road'), loop = track.loops[0];
  const loops = new Map<string, number>(), prev = new Map<string, { progress: number; loop: number }>();
  let seen = 0, ridden = 0;
  while (race.phase !== 'results' && race.time < 400) {
    stepRace(race, new Map(), DT);
    for (const e of race.events) if (e.id > seen) {
      seen = e.id;
      const r = race.racers.find(x => x.id === e.racer)!;
      if (e.type === 'loop' && r.finishTime === null) loops.set(r.id, (loops.get(r.id) ?? 0) + 1);
      assert.ok(e.type !== 'fall' && e.type !== 'respawn' || r.loop === 0, `${e.type} inside the loop`);
    }
    for (const r of race.racers) {
      const was = prev.get(r.id);
      if (was && (r.loop > 0 || was.loop > 0) && r.finishTime === null) {
        ridden++;
        assert.ok(r.progress - was.progress >= 0 && r.progress - was.progress < 1, `${r.id}: progress ${was.progress.toFixed(2)} → ${r.progress.toFixed(2)} at θ ${r.loop.toFixed(2)}`);
      }
      if (r.loop > 0) assert.ok(r.grounded && r.respawnT === 0 && Math.abs(signedDistance(track, loop.d0, r.d)) <= loopLength(track, loop), `${r.id} on the loop`);
      prev.set(r.id, { progress: r.progress, loop: r.loop });
    }
    for (const e of race.entities) if (e.kind === 'peel' || e.kind === 'bomb') assert.ok(!loopOver(track, e.d) || e.y < pointAt(track, e.d, 0).y - .5 || e.vy !== 0, `a ${e.kind} resting on the loop footprint`);
  }
  assert.equal(race.phase, 'results');
  for (const r of race.racers) if (r.lapTimes.length === race.laps) assert.equal(loops.get(r.id), race.laps, `${r.id} rode the loop ${loops.get(r.id)} times`);
  assert.ok(ridden > race.racers.length * race.laps * 100, `${ridden} racer-steps on the loop`);
});

test('rainbow-road items on the loop: shells ride round it, a press inside waits for the exit, a bomb stays in the slot', () => {
  const track = getTrack('rainbow-road'), loop = track.loops[0];
  const race = createRace(settings('rainbow-road', { gridSize: 1 }), [{ id: 'p0', name: 'You', color: '#f00' }], 3, 'tv'), me = race.racers[0];
  let seq = 0, fire = 0;
  const step = () => stepRace(race, new Map([['p0', { ...NEUTRAL_INPUT, fire, seq: ++seq }]]), DT);
  const start = (back: number, item: 'bouncer' | 'bomb') => {
    const d = loop.d0 - back, p = pointAt(track, d, 0);
    Object.assign(race, { time: 20, phase: 'racing', entities: [] });
    Object.assign(me, { x: p.x, y: p.y, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * 28, vy: 0, vz: Math.cos(p.heading) * 28, hint: -1, d, lastSafeD: d, progress: d, lap: 1, loop: 0, item, itemCount: 1, rollT: 0, trailing: false });
  };
  start(20, 'bouncer');
  while (me.loop < 1) step();
  fire++; step();
  assert.ok(me.trailing && me.item === 'bouncer' && race.entities.length === 0, 'a tap on the loop holds the shell');
  while (me.loop > 0) step();
  for (let i = 0; i < 20; i++) step();
  const out = race.entities.find(e => e.kind === 'bouncer');
  assert.ok(out && me.item === null && forwardDistance(track, loop.d1, out.d) < 60, 'released once back on the road');
  start(20, 'bomb');
  while (me.loop < 1) step();
  fire++; step();
  assert.ok(me.item === 'bomb' && !race.entities.some(e => e.kind === 'bomb'), 'no bomb lobbed off the loop');
  start(12, 'bouncer');
  fire++; step();
  const shell = race.entities.find(e => e.kind === 'bouncer')!;
  let top = -Infinity, prev = { ...shell };
  for (let i = 0; i < 120 && race.entities.includes(shell); i++) {
    step();
    top = Math.max(top, shell.y);
    assert.ok(Math.hypot(shell.x - prev.x, shell.y - prev.y, shell.z - prev.z) < Math.hypot(prev.vx, prev.vy, prev.vz) * DT * 1.2 + .8, 'the shell moves smoothly');
    prev = { ...shell };
  }
  assert.ok(top > pointAt(track, loop.d0, 0).y + 2 * loop.radius - 1 && forwardDistance(track, loop.d1, shell.d) < 60, `the shell rode over the top (${top.toFixed(1)} m) and out (${forwardDistance(track, loop.d1, shell.d).toFixed(0)} m past it, ${race.entities.includes(shell)})`);
});

for (const id of ['palm-bay', 'rainbow-road'] as const) test(`${id}: races are reproducible from the seed`, () => {
  const once = () => { const race = createRace(settings(id, { laps: 1 }), [{ id: 'p0', name: 'You', color: '#f00' }], 42, 'tv'); run(race); return race.racers.map(r => `${r.id}:${r.finishTime}:${r.rank}:${r.x}`).join(); };
  assert.equal(once(), once());
});

test('a brief disconnect does not end the race: the reconnected solo human still finishes', () => {
  const race = createRace(settings('palm-bay', { laps: 1 }), [{ id: 'p0', name: 'Blip', color: '#f00' }], 7, 'tv'), me = race.racers.find(r => !r.bot)!;
  let blipped = false;
  run(race, r => { if (r.time > 6.5 && !blipped) { me.connected = false; if (r.time > 6.6) { me.connected = blipped = true; } } return botInput(r, me); });
  assert.ok(me.finishTime !== null && race.time > me.finishTime, `finished at ${me.finishTime}, results at ${race.time.toFixed(1)}`);
  assert.notEqual(racerOutcome(race).rows[0].label, 'Did not finish');
});

test('overtaking at the line: each finish event carries the place after ranking', () => {
  const track = getTrack('palm-bay'), L = track.length;
  const race = createRace(settings('palm-bay', { laps: 1, speedClass: 200, gridSize: 2, items: 'off' }), [{ id: 'A', name: 'A', color: '#f00' }, { id: 'B', name: 'B', color: '#0f0' }], 1, 'tv');
  race.phase = 'racing'; race.time = 40;
  const place = (id: string, d: number, lateral: number, v: number) => { const r = race.racers.find(x => x.id === id)!, p = pointAt(track, d, lateral), q = queryTrack(track, p.x, p.z, -1, p.y);
    Object.assign(r, { x: p.x, y: q.ground, z: p.z, hint: q.index, d: q.d, lateral: q.lateral, heading: p.heading, vx: Math.sin(p.heading) * v, vz: Math.cos(p.heading) * v, progress: d, grounded: true }); };
  place('A', L - .7, -3, 50); place('B', L - .3, 3, 6);   // A starts behind but crosses earlier within the tick
  const inputs = new Map(['A', 'B'].map(id => [id, { ...NEUTRAL_INPUT, seq: 1 }]));
  for (let i = 0; i < 6; i++) stepRace(race, inputs, DT);
  assert.equal(race.racers.find(r => r.id === 'A')!.rank, 1);
  for (const r of race.racers) {
    assert.ok(r.finishTime !== null && r.lapTimes.at(-1)! <= r.finishTime, `${r.id}: last lap within the race time`);
    assert.equal(race.events.find(e => e.type === 'finish' && e.racer === r.id)?.value, r.rank, `${r.id} announced as rank ${r.rank}`);
  }
});

test('airtime counts real jumps only: drift hops and tumbles on flat ground add nothing', () => {
  const race = createRace(settings('palm-bay', { laps: 1, gridSize: 1, items: 'off' }), [{ id: 'p0', name: 'Hopper', color: '#f00' }], 3, 'tv'), me = race.racers[0];
  let seq = 0, hop = 0;
  run(race, r => ({ ...botInput(r, me), hop: r.time > 0 && ++seq % 40 === 0 ? ++hop : hop }), 120);
  assert.ok(me.stats.airTime < 1, `palm-bay hopping: ${me.stats.airTime.toFixed(2)} s`);
});
