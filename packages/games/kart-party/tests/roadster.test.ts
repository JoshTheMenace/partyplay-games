import assert from 'node:assert/strict';
import test from 'node:test';
import { createRace, NEUTRAL_INPUT, stepRace } from '../src/sim/race';
import { PHYSICS } from '../src/sim/physics';
import { toRaceView, kartFromView } from '../src/sim/view';
import { decodeRaceView, encodeRaceView } from '../src/net/wire';
import { rules } from '../src/server';
import { InputComposer, keyBinding } from '../src/ui/input';
import type { Input, KartBodyId, Race } from '../src/sim/types';

const race = (kart: KartBodyId) => createRace({ track: 'palm-bay', laps: 3, speedClass: 100, difficulty: 'normal', gridSize: 1, items: 'off', views: 'tv' },
  [{ id: 'p0', name: 'A', color: '#f00', lobbyChoice: { character: 1, kart } }], 1, 'tv');
let seq = 1;
const drive = (r: Race, input: Partial<Input>, seconds: number) => { for (let i = 0; i < seconds * 60; i++) stepRace(r, new Map([['p0', { ...NEUTRAL_INPUT, fly: 0, ...input, seq: ++seq }]]), 1 / 60); };

test('a thruster burst lifts the Roadster several metres, costs one second of air, and the compressor refills it on the ground', () => {
  const r = race('roadster'), k = r.racers[0];
  drive(r, {}, 5.5);
  const ground = k.y; let peak = ground;
  drive(r, { fly: 1 }, 1 / 60);
  assert.equal(r.events.filter(e => e.type === 'thrust').length, 1);
  assert.equal(k.tank, PHYSICS.flyTank - PHYSICS.flyBurst);
  for (let i = 0; i < 90; i++) { drive(r, { fly: 1 }, 1 / 60); peak = Math.max(peak, k.y); }
  assert.ok(peak - ground > 4, `peak ${(peak - ground).toFixed(1)} m`);
  drive(r, { fly: 1 }, 3);
  assert.ok(k.grounded && k.tank > PHYSICS.flyTank - PHYSICS.flyBurst, 'back down and refilling');
});

test('the tank allows five bursts in a row, then the Roadster must land to refill', () => {
  const r = race('roadster'), k = r.racers[0];
  drive(r, {}, 5.5);
  for (let n = 1; n <= 6; n++) { drive(r, { fly: n }, 1 / 60); drive(r, { fly: n }, PHYSICS.flyBurst + .05); }
  assert.equal(r.events.filter(e => e.type === 'thrust').length, 5);
  assert.ok(k.tank < PHYSICS.flyBurst);
});

test('only the Roadster flies, and a missing fly counter is never a press', () => {
  const z = race('zoomer'); drive(z, {}, 5.5); drive(z, { fly: 1 }, 1);
  assert.equal(z.events.some(e => e.type === 'thrust'), false);
  const r = race('roadster'); drive(r, {}, 5.5); r.racers[0].prevFly = 7;
  stepRace(r, new Map([['p0', { ...NEUTRAL_INPUT, seq: ++seq }]]), 1 / 60);
  assert.equal(r.events.some(e => e.type === 'thrust'), false);
  assert.equal('fly' in rules.parseInput({ steer: 0, hop: 0, fire: 0, seq: 3 }), false);
  assert.equal(rules.parseInput({ fly: 258, seq: 3 }).fly, 2);
});

test('flight state survives the wire so prediction replays it, and the controls send presses', () => {
  const r = race('roadster'); drive(r, {}, 5.5); drive(r, { fly: 1 }, .3);
  const k = kartFromView(decodeRaceView(encodeRaceView(toRaceView(r))).racers[0]);
  assert.ok(k.flyT > 0 && k.tank === PHYSICS.flyTank - PHYSICS.flyBurst && k.prevFly === 1);
  const sent: Input[] = [], c = new InputComposer(i => sent.push(i));
  c.hold('fly', 'k:f', true); c.hold('fly', 'k:f', false); c.hold('fly', 'k:f', true);
  assert.equal(sent.at(-1)!.fly, 2);
  assert.deepEqual(keyBinding('f'), { hold: 'fly' });
});

test('Roadster CPUs fire their thrusters during a race', () => {
  const r = createRace({ track: 'palm-bay', laps: 1, speedClass: 100, difficulty: 'hard', gridSize: 8, items: 'normal', views: 'tv' }, [], 4, 'tv');
  for (const cpu of r.racers) cpu.kart = 'roadster';
  let bursts = 0;
  for (let i = 0; i < 60 * 40; i++) { const last = r.serial; stepRace(r, new Map(), 1 / 60); bursts += r.events.filter(e => e.id > last && e.type === 'thrust').length; }
  assert.ok(bursts >= 3, `${bursts} CPU thruster bursts in 40 s`);
  assert.ok(r.racers.every(cpu => cpu.respawnT <= 0 || cpu.progress > 0), 'flying CPUs keep racing');
});
