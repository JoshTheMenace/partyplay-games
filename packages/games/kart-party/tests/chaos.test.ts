import assert from 'node:assert/strict';
import test from 'node:test';
import { createRace, stepRace } from '../src/sim/race';
import { CHAOS } from '../src/sim/chaos';
import { CHAOS_OWNER } from '../src/sim/items';
import { collideKarts, kartParams } from '../src/sim/physics';
import { toRaceView } from '../src/sim/view';
import { decodeRaceView, encodeRaceView } from '../src/net/wire';
import type { Race, Settings } from '../src/sim/types';

const settings = (chaos: Settings['chaos']): Settings => ({ track: 'palm-bay', laps: 3, speedClass: 100, difficulty: 'normal', gridSize: 8, items: 'normal', views: 'tv', chaos });
const players = [{ id: 'p0', name: 'You', color: '#f55' }];
const run = (race: Race, seconds: number, each?: (race: Race) => void) => { for (let i = 0; i < seconds * 60; i++) { stepRace(race, new Map(), 1 / 60); each?.(race); } };

test('chaos events start on schedule, rotate kinds, end, and reproduce from the seed', () => {
  const kinds = (seed: number) => { const race = createRace(settings('wild'), players, seed, 'tv'), seen: string[] = []; let was: string | null = null; run(race, 70, r => { if (r.chaos.kind && r.chaos.kind !== was) seen.push(r.chaos.kind); was = r.chaos.kind; }); return seen; };
  const a = kinds(3);
  assert.ok(a.length >= 4, `only ${a.length} wild chaos events in 70 s`);
  for (let i = 1; i < a.length; i++) assert.notEqual(a[i], a[i - 1], 'the same event never repeats back to back');
  assert.deepEqual(kinds(3), a);
  const off = createRace(settings('off'), players, 3, 'tv'); run(off, 40);
  assert.equal(off.events.some(e => e.type === 'chaos'), false);
  assert.equal(createRace({ ...settings(undefined) }, players, 3, 'tv').chaos.mode, 'off');
});

test('each chaos kind changes the race the way its banner says', () => {
  // The first event a seed draws, triggered 4 s into the race.
  const start = (kind: keyof typeof CHAOS) => {
    for (let seed = 1; seed < 200; seed++) { const race = createRace(settings('on'), players, seed, 'tv'); run(race, 4); race.chaos.next = race.time; stepRace(race, new Map(), 1 / 60); if (race.chaos.kind === kind) return race; }
    throw Error(`no seed starts with ${kind}`);
  };
  const frenzy = start('frenzy'); assert.ok(frenzy.racers.every(r => r.item !== null || r.finishTime !== null));
  const underdog = start('underdog'); assert.ok(underdog.racers.filter(r => r.rank > 4).every(r => r.starT > 0) && underdog.racers.filter(r => r.rank <= 4).every(r => r.starT === 0));
  const bananas = start('bananas'); run(bananas, 3); assert.ok(bananas.entities.filter(e => e.owner === CHAOS_OWNER).length >= 5, 'peels rain down');
  run(bananas, CHAOS.bananas.seconds); assert.equal(bananas.chaos.kind, null); assert.equal(bananas.entities.some(e => e.owner === CHAOS_OWNER), false, 'the storm clears');
  const moon = start('moon'), flat = createRace(settings('off'), players, 5, 'tv'); run(flat, 4);
  for (const r of [moon, flat]) { const k = r.racers[0]; k.grounded = false; k.y += 20; k.vy = 0; k.hopT = 0; }
  stepRace(moon, new Map(), 1 / 60); stepRace(flat, new Map(), 1 / 60);
  assert.ok(moon.racers[0].vy > flat.racers[0].vy * .6, 'moon gravity pulls far less');
  const hyper = start('hyper'), cpu = hyper.racers.find(r => r.bot)!;
  run(hyper, 4); assert.ok(Math.max(...hyper.racers.map(r => Math.hypot(r.vx, r.vz))) > kartParams(cpu.character, cpu.kart, 100).topSpeed * 1.08, 'hyper speed beats normal top speed');
});

test('mega karts push apart from farther away and bounce harder', () => {
  const pair = () => { const race = createRace(settings('off'), [...players, { id: 'p1', name: 'Two', color: '#5f5' }], 1, 'tv'); const [a, b] = race.racers.slice(-2); Object.assign(a, { x: 0, z: 0, heading: 0, vx: 0, vz: 10 }); Object.assign(b, { x: 3, y: a.y, z: 0, heading: 0, vx: -6, vz: 10 }); return [a, b]; };
  const p = [kartParams(0, 'zoomer', 100), kartParams(1, 'zoomer', 100)];
  const normal = pair(); collideKarts(normal, p); assert.equal(normal[1].x, 3, '3 m apart: no contact');
  const mega = pair(); collideKarts(mega, p, undefined, true); assert.ok(mega[1].x > 3 && mega[1].vx > 0, 'mega bodies touch and bounce away');
});

test('the active chaos event survives the wire codec', () => {
  const race = createRace(settings('on'), players, 2, 'tv'); race.chaos = { ...race.chaos, kind: 'mega', t: 4.256 };
  assert.deepEqual(decodeRaceView(encodeRaceView(toRaceView(race))).chaos, { mode: 'on', kind: 'mega', last: null, t: 4.26, next: 12 });
});
