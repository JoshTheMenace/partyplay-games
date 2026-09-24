import test from 'node:test';
import assert from 'node:assert/strict';
import { botInput, botSkill } from '../src/sim/ai';
import { createRace, stepRace, type RacePlayer } from '../src/sim/race';
import { speedOf } from '../src/sim/physics';
import { angleDelta } from '../src/sim/math';
import { pointAt, queryTrack, sampleAt } from '../src/sim/track';
import { getTrack, TRACK_IDS } from '../src/tracks/index';
import type { Difficulty, Entity, Race, Racer, SpeedClass, TrackId } from '../src/sim/types';

const DT = 1 / 60;
const newRace = (track: TrackId, difficulty: Difficulty, seed: number, players: RacePlayer[] = [], gridSize = 8, speedClass: SpeedClass = 100) =>
  createRace({ track, laps: 3, speedClass, difficulty, gridSize, items: 'normal', views: 'tv' }, players, seed, 'tv');

type Report = { race: Race; stall: number; leadChanges: number; mean: number; tiers: number[]; walls: number; falls: number; events: Record<string, number> };
/** Run a whole race; track the longest time any unhurt racer sat below walking pace, how often the lead changed,
 * mini-turbo tiers, wall impacts, falls and every event count (by type, and by `type:value`). */
function runRace(race: Race): Report {
  const slow = new Map<string, number>(), tiers = [0, 0, 0, 0]; let stall = 0, leadChanges = 0, leader = '', seen = 0, walls = 0, falls = 0;
  const events: Record<string, number> = {}, count = (k: string) => { events[k] = (events[k] ?? 0) + 1; };
  while (race.phase !== 'results' && race.time < 400) {
    stepRace(race, new Map(), DT);
    for (const e of race.events) if (e.id > seen) { seen = e.id; if (e.type === 'mini-turbo') tiers[e.value!]++; if (e.type === 'wall') walls++; if (e.type === 'fall') falls++; count(e.type); if (e.value !== undefined) count(`${e.type}:${e.value}`); }
    if (race.phase !== 'racing' || race.time < 2) continue;
    for (const r of race.racers) {
      const stuck = r.finishTime === null && speedOf(r) < 2.5 && r.respawnT <= 0 && r.spinT <= 0 && r.tumbleT <= 0 && r.stallT <= 0;
      const s = stuck ? (slow.get(r.id) ?? 0) + DT : 0; slow.set(r.id, s); stall = Math.max(stall, s);
    }
    const first = race.racers.find(r => r.rank === 1)!.id;
    if (race.time > 5 && leader && first !== leader) leadChanges++;
    leader = first;
  }
  const mean = race.racers.reduce((s, r) => s + r.finishTime!, 0) / race.racers.length;
  return { race, stall, leadChanges, mean, tiers, walls, falls, events };
}

const results = new Map<string, Report>();
for (const track of TRACK_IDS) for (const difficulty of ['easy', 'normal', 'hard'] as Difficulty[]) {
  void test(`CPUs finish ${track} on ${difficulty}: no stalls, drifting, items, position changes`, () => {
    const rep = runRace(newRace(track, difficulty, 4242));
    results.set(`${track}/${difficulty}`, rep);
    const { race, stall, leadChanges } = rep, sum = (k: 'miniTurbos' | 'itemsUsed' | 'overtakes' | 'hitsTaken' | 'tricks') => race.racers.reduce((s, r) => s + r.stats[k], 0);
    assert.equal(race.phase, 'results');
    for (const r of race.racers) assert.equal(r.lapTimes.length, 3, `${r.id} drove all three laps`);
    assert.ok(stall < 2, `longest stall ${stall.toFixed(2)} s`);
    assert.ok(sum('miniTurbos') >= 8, `mini-turbos ${sum('miniTurbos')}`);
    assert.ok(sum('itemsUsed') >= 8, `items used ${sum('itemsUsed')}`);
    assert.ok(sum('overtakes') > 0 && leadChanges + sum('overtakes') > 8, `overtakes ${sum('overtakes')}, lead changes ${leadChanges}`);
    const laps = race.racers.flatMap(r => r.lapTimes.slice(1)), mean = laps.reduce((a, b) => a + b, 0) / laps.length;
    console.log(`  ${track} ${difficulty}: mean lap ${mean.toFixed(2)} s, best ${Math.min(...laps).toFixed(2)} s, stall ${stall.toFixed(2)} s, lead changes ${leadChanges}, MT ${sum('miniTurbos')}, tricks ${sum('tricks')}, items ${sum('itemsUsed')}, hits ${sum('hitsTaken')}`);
  });
}

void test('hard CPUs beat easy CPUs on average, and the lead changes hands', () => {
  let hard = 0, easy = 0, leads = 0;
  for (const track of TRACK_IDS) {
    const h = results.get(`${track}/hard`) ?? runRace(newRace(track, 'hard', 4242)), e = results.get(`${track}/easy`) ?? runRace(newRace(track, 'easy', 4242));
    hard += h.mean; easy += e.mean; leads += h.leadChanges + e.leadChanges + (results.get(`${track}/normal`)?.leadChanges ?? 0);
    assert.ok(h.mean < e.mean, `${track}: hard ${h.mean.toFixed(1)} s vs easy ${e.mean.toFixed(1)} s`);
  }
  assert.ok(hard / easy < .95, `hard is clearly faster (${(hard / easy).toFixed(3)})`);
  assert.ok(leads > 0);
});

void test('drift tiers follow difficulty: hard CPUs earn orange often and purple sometimes, easy ones mostly blue', tc => {
  const share = (difficulty: Difficulty) => {
    const t = [0, 0, 0, 0];
    for (const track of TRACK_IDS) (results.get(`${track}/${difficulty}`) ?? runRace(newRace(track, difficulty, 4242))).tiers.forEach((n, i) => { t[i] += n; });
    const all = t[1] + t[2] + t[3];
    return { blue: t[1] / all, orange: t[2] / all, purple: t[3] / all };
  };
  const easy = share('easy'), hard = share('hard'), pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  tc.diagnostic(`easy b/o/p ${pct(easy.blue)}/${pct(easy.orange)}/${pct(easy.purple)}, hard ${pct(hard.blue)}/${pct(hard.orange)}/${pct(hard.purple)}`);
  assert.ok(hard.orange > .3 && hard.purple > .05 && hard.orange + hard.purple > .5, 'hard: orange often, purple sometimes');
  assert.ok(easy.blue > .55 && easy.purple < hard.purple, 'easy: mostly blue');
});

void test('200cc hard CPUs anticipate crests, jumps and chicanes: few wall hits, no falls', tc => {
  for (const track of ['neon-drive', 'frost-peak', 'mesa-rally'] as TrackId[]) {
    const rep = runRace(newRace(track, 'hard', 4242, [], 8, 200));
    tc.diagnostic(`${track} 200cc hard: ${rep.walls} wall hits, ${rep.falls} falls`);
    assert.ok(rep.walls < (track === 'mesa-rally' ? 16 : 12), `${track}: ${rep.walls} wall hits`);
    assert.ok(rep.falls <= 1, `${track}: ${rep.falls} falls`);
  }
});

void test('races are reproducible from the seed', () => {
  const a = newRace('palm-bay', 'normal', 99), b = newRace('palm-bay', 'normal', 99);
  for (let i = 0; i < 60 * 25; i++) { stepRace(a, new Map(), DT); stepRace(b, new Map(), DT); }
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

void test('rocket starts follow difficulty (hard ~70%, normal ~40%, easy ~10%)', () => {
  const rate = (difficulty: Difficulty) => {
    let rockets = 0, n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const race = newRace('palm-bay', difficulty, seed * 31);
      while (race.time < .2) stepRace(race, new Map(), DT);
      rockets += race.racers.filter(r => r.stats.rocketStart).length; n += race.racers.length;
    }
    return rockets / n;
  };
  const easy = rate('easy'), normal = rate('normal'), hard = rate('hard');
  assert.ok(easy < .2 && normal > .28 && normal < .52 && hard > .58, `easy ${easy} normal ${normal} hard ${hard}`);
});

void test('botSkill rubber-bands subtly around the best human', () => {
  const race = newRace('palm-bay', 'normal', 5, [{ id: 'h', name: 'Human', color: '#fff' }], 3);
  race.phase = 'racing';
  const human = race.racers.find(r => !r.bot)!, [ahead, behind] = race.racers.filter(r => r.bot);
  human.progress = 1000; ahead.progress = 1400; behind.progress = 500;
  const a = botSkill(race, ahead), b = botSkill(race, behind);
  assert.ok(a < .98 && a >= .9, `leader eases off (${a})`); assert.ok(b > 1.02 && b <= 1.1, `trailer catches up (${b})`);
  behind.progress = 999; assert.ok(Math.abs(botSkill(race, behind) - 1) < .02, 'level with the human: only its own small form swing');
  human.connected = false; assert.ok(Math.abs(botSkill(race, behind) - 1) < .02, 'no connected humans: no rubber band');
  race.phase = 'countdown'; assert.equal(botSkill(race, behind), 1);
});

void test('a disconnected human is driven home by the CPU logic', () => {
  const race = newRace('palm-bay', 'normal', 17, [{ id: 'h', name: 'Human', color: '#fff' }, { id: 'gone', name: 'Gone', color: '#fff' }], 4);
  const human = race.racers.find(r => r.id === 'h')!, gone = race.racers.find(r => r.id === 'gone')!;
  gone.connected = false;
  while (race.phase !== 'results' && race.time < 300) stepRace(race, new Map([['h', botInput(race, human)]]), DT);
  // The race ends shortly after the last connected human finishes; the autopiloted seat keeps pace until then.
  assert.ok(gone.lapTimes.length >= 2, `kept racing (${gone.lapTimes.length} laps)`);
  assert.ok(gone.stats.miniTurbos > 0, 'drives like a CPU, drifts included');
});

/** Put one CPU on a straight at speed, facing down the course. */
function soloOnStraight(extra: (race: Race, d: number, lateral: number) => void = () => {}) {
  const race = newRace('palm-bay', 'hard', 3, [], 1), track = getTrack('palm-bay'), bot = race.racers[0];
  const S = track.samples; let best = 0, run = 0, bestRun = 0;
  for (let i = 0; i < S.length * 2; i++) { if (Math.abs(S[i % S.length].curvature) < .003) { if (++run > bestRun) { bestRun = run; best = i - run + 1; } } else run = 0; }
  const d = S[best % S.length].d + 6, lateral = sampleAt(track, d + 30).line, p = pointAt(track, d, lateral), q = queryTrack(track, p.x, p.z, -1, p.y);
  race.time = 20; race.phase = 'racing';
  Object.assign(bot, { x: p.x, y: p.y, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * 28, vz: Math.cos(p.heading) * 28, hint: q.index, d: q.d, lateral: q.lateral, progress: race.time * 20 });
  extra(race, d, lateral);
  return { race, track, bot };
}

void test('CPUs steer around a peel lying on their line', () => {
  const { race, bot } = soloOnStraight((race, d, lateral) => {
    const track = getTrack('palm-bay'), p = pointAt(track, d + 45, lateral), q = queryTrack(track, p.x, p.z, -1, p.y);
    const peel: Entity = { id: 900, kind: 'peel', owner: 'nobody', x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, t: 5, hint: q.index, d: q.d, target: null, bounces: 0, fuse: 0 };
    race.entities.push(peel);
  });
  for (let i = 0; i < 60 * 3; i++) stepRace(race, new Map(), DT);
  assert.equal(bot.stats.hitsTaken, 0, 'no spin-out'); assert.equal(race.entities.length, 1, 'peel still lying there');
});

void test('CPUs use items deliberately: defend with a peel against a chaser, fire nitro on a straight', () => {
  const { race, bot } = soloOnStraight();
  bot.item = 'nitro'; bot.itemCount = 1; bot.rollT = 0;
  for (let i = 0; i < 60 * 6 && bot.item; i++) stepRace(race, new Map(), DT);
  assert.equal(bot.item, null); assert.ok(bot.stats.itemsUsed === 1);
  // A peel is trailed as a rear shield and dropped once a rival sits right behind.
  bot.item = 'peel'; bot.itemCount = 1; bot.rollT = 0;
  for (let i = 0; i < 60 * 3; i++) stepRace(race, new Map(), DT);
  assert.equal(bot.trailing, true, 'drags the peel behind');
  const chaser = { ...race.racers[0], id: 'chaser', bot: false, connected: true, ai: null, lapTimes: [], stats: { ...bot.stats } };
  const track = getTrack('palm-bay'), p = pointAt(track, bot.d - 8, bot.lateral);
  Object.assign(chaser, { x: p.x, y: p.y, z: p.z, d: bot.d - 8, progress: bot.progress - 8 });
  race.racers.push(chaser);
  for (let i = 0; i < 20; i++) stepRace(race, new Map([['chaser', { steer: 0, drift: false, brake: false, item: false, hop: 0, fire: 0, seq: 0 }]]), DT);
  assert.equal(bot.item, null); assert.ok(race.entities.some(e => e.kind === 'peel'), 'dropped it in the chaser\'s path');
});

void test('ink makes CPU steering sloppier', () => {
  const wander = (ink: boolean) => {
    const { race, track, bot } = soloOnStraight();
    let dev = 0;
    for (let i = 0; i < 60 * 3; i++) { if (ink) bot.inkT = 2; stepRace(race, new Map(), DT); dev += Math.abs(bot.lateral - sampleAt(track, bot.d).line); }
    return dev;
  };
  assert.ok(wander(true) > wander(false) * 1.5);
});

/* ---------------- Rainbow Road set-pieces ---------------- */
const RR = getTrack('rainbow-road');
/** One CPU (no items) rolling at v down Rainbow Road's racing line from distance d, on a given lap (per-lap choices are fixed). */
function soloRainbow(d: number, v: number, difficulty: Difficulty = 'hard', { time = 20, speedClass = 100 as SpeedClass, lap = 2 } = {}) {
  const race = newRace('rainbow-road', difficulty, 5, [], 1, speedClass), track = getTrack('rainbow-road'), bot = race.racers[0];
  const p = pointAt(track, d, sampleAt(track, d).line), q = queryTrack(track, p.x, p.z, -1, p.y);
  Object.assign(race, { time, phase: 'racing', items: 'off' });
  Object.assign(bot, { x: p.x, y: p.y, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * v, vz: Math.cos(p.heading) * v, hint: q.index, d: q.d, lateral: q.lateral, progress: track.length * lap + d, lastSafeD: d, lap });
  return { race, bot };
}
/** Step until the bot passes distance `to` (or 20 s pass); returns its events as `type` or `type:value`. */
function driveTo(race: Race, bot: Racer, to: number, each = () => {}) {
  const out: string[] = [], t0 = race.time; let seen = race.serial;
  while (bot.d < to && race.time < t0 + 20) {
    stepRace(race, new Map(), DT); each();
    for (const e of race.events) if (e.id > seen) { seen = e.id; out.push(e.value === undefined ? e.type : `${e.type}:${e.value}`); }
  }
  return out;
}

void test('Rainbow Road (100cc, 8 CPUs): few falls; springs and off-line rings used by difficulty; bumpers dodged', tc => {
  const rep = (difficulty: Difficulty) => results.get(`rainbow-road/${difficulty}`) ?? runRace(newRace('rainbow-road', difficulty, 4242));
  const n = (r: Report, k: string) => r.events[k] ?? 0, offLine = (r: Report) => n(r, 'ring:0') + n(r, 'ring:1') + n(r, 'ring:2');
  const all = { easy: rep('easy'), normal: rep('normal'), hard: rep('hard') }, maxFalls = { easy: 1, normal: .5, hard: .25 };
  for (const [name, r] of Object.entries(all) as [Difficulty, Report][]) {
    tc.diagnostic(`${name}: falls/racer ${(r.falls / 8).toFixed(3)}, springs ${n(r, 'spring')}, rings ${n(r, 'ring')} (off-line ${offLine(r)}), bumper knocks ${n(r, 'bumper')}`);
    assert.ok(r.falls / 8 < maxFalls[name], `${name}: ${r.falls} falls`);
    assert.ok(n(r, 'spring') >= 6 && offLine(r) >= 6, `${name}: springs ${n(r, 'spring')}, off-line rings ${offLine(r)}`);
    assert.ok(n(r, 'bumper') < 15, `${name}: ${n(r, 'bumper')} bumper knocks (CPUs driving blind took 30–40)`);
  }
  assert.ok(n(all.hard, 'spring') > n(all.easy, 'spring') && offLine(all.hard) > offLine(all.easy), 'hard CPUs take the air lines more often');
});

void test('Rainbow Road: CPUs time the sliding star bumpers through the Pinball Nebula', tc => {
  for (const difficulty of ['normal', 'hard'] as Difficulty[]) {
    let knocks = 0;
    for (let k = 0; k < 28; k++) {   // every 0.1 s of the bumpers' cycle
      const { race, bot } = soloRainbow(RR.movers[0].d - 71, 27, difficulty, { time: 20 + k * .1 });
      knocks += driveTo(race, bot, RR.movers[3].d + 29).filter(e => e.startsWith('bumper')).length;
    }
    tc.diagnostic(`${difficulty}: ${knocks} knocks in 28 runs`);
    assert.ok(knocks <= 3, `${difficulty}: ${knocks} knocks in 28 runs`);
  }
});

void test('Rainbow Road: a hard CPU springs through the ring above the pad, rides the Warp lane and clears the gap from any speed', tc => {
  let springRings = 0;
  for (let lap = 1; lap <= 4; lap++) {
    const { race, bot } = soloRainbow(RR.gravity[0].d0 - 12, 27, 'hard', { lap }), ev = driveTo(race, bot, RR.springs[0].d0 + 74), spring = ev.findIndex(e => e.startsWith('spring'));
    assert.ok(!ev.includes('fall'), `lap ${lap}: ${ev.join(' ')}`);
    if (spring >= 0 && ev.slice(spring).some(e => e === 'ring:0' || e === 'ring:1')) springRings++;
  }
  tc.diagnostic(`spring + ring on ${springRings} of 4 laps`);
  assert.ok(springRings >= 2, `spring + ring on ${springRings} of 4 laps`);
  const lane = RR.zones.find(z => z.surface === 'boost')!, warp = soloRainbow(lane.d0 - 49, 27);
  let on = 0, frames = 0;
  driveTo(warp.race, warp.bot, lane.d1, () => { if (warp.bot.d > lane.d0 + 10) { frames++; if (warp.bot.surface === 'boost') on++; } });
  tc.diagnostic(`on the boost lane ${(on / frames * 100).toFixed(0)}% of it (${frames} frames)`);
  assert.ok(on / frames > .8, `on the boost lane ${(on / frames * 100).toFixed(0)}% of it`);
  for (const [speedClass, v] of [[50, 8], [50, 22], [100, 12], [100, 27], [150, 32], [200, 38]] as [SpeedClass, number][]) {
    const { race, bot } = soloRainbow(RR.gaps[0].d0 - 46, v, 'easy', { speedClass }), ev = driveTo(race, bot, RR.gaps[0].d0 + 64);
    assert.ok(!ev.includes('fall') && ev.includes('ring:3'), `${speedClass}cc from ${v} m/s: ${ev.join(' ')}`);
  }
});

void test('Rainbow Road: CPUs line up for the loop-the-loop — centred, straight, no drift or hop at the entry — and hold the lane round it', tc => {
  const loop = RR.loops[0], lane = sampleAt(RR, loop.d0).halfWidth - 1.1;
  let worstLat = 0, worstOff = 0;
  for (const difficulty of ['easy', 'normal', 'hard'] as Difficulty[]) for (const speedClass of [50, 100, 150, 200] as SpeedClass[]) for (const shift of [-4, 0, 4]) {
    const { race, bot } = soloRainbow(loop.d0 - 110, 20 + speedClass / 10, difficulty, { speedClass }), tag = `${difficulty} ${speedClass}cc from ${shift}`;
    const p = pointAt(RR, bot.d, bot.lateral + shift); Object.assign(bot, { x: p.x, z: p.z, lateral: bot.lateral + shift });
    let before = { ...bot }, entered = false;
    const ev = driveTo(race, bot, loop.d1 + 30, () => {
      if (bot.loop > 0 && !entered) {
        entered = true;
        const off = Math.abs(angleDelta(sampleAt(RR, before.d).heading, before.heading));
        worstLat = Math.max(worstLat, Math.abs(before.lateral)); worstOff = Math.max(worstOff, off);
        assert.ok(before.drift === 0 && before.grounded && before.hopT === 0, `${tag}: entered drifting ${before.drift} / airborne`);
        assert.ok(Math.abs(before.lateral) < 2.6 && off < .09, `${tag}: entered at lateral ${before.lateral.toFixed(2)}, ${(off * 180 / Math.PI).toFixed(1)}° off`);
      }
      if (bot.loop > 0) assert.ok(Math.abs(bot.lateral) <= lane + 1e-6, `${tag}: left the lane`);
      before = { ...bot };
    });
    assert.ok(entered && !ev.includes('fall') && bot.d > loop.d1 + 20, `${tag}: ${ev.join(' ')}`);
  }
  tc.diagnostic(`widest entry ${worstLat.toFixed(2)} m, most off-straight ${(worstOff * 180 / Math.PI).toFixed(1)}°`);
});
