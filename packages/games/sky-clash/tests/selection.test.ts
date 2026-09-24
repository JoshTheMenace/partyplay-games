import assert from 'node:assert/strict';
import test from 'node:test';
import { ROSTER_DATA, neutralInput, type Input, type LobbyChoice } from '../src/model';
import { rules } from '../src/server';
import { STAGE_IDS, getStage } from '../src/stages';
import { tallyStage } from '../src/sim/match';

const seat = (i: number, choice?: Partial<LobbyChoice>) => ({ id: `p${i}`, name: `P${i}`, color: '#28c6e7', ...(choice ? { lobbyChoice: { fighter: null, costume: 0, stage: null, ...choice } } : {}) });
const make = (players: ReturnType<typeof seat>[], settings: object = {}, seed = 5) => rules.create({ roomId: 'r', roundId: 'round-1', seed, nowMs: 1000, players }, rules.validateSettings(settings));

test('a lone human gets a CPU; CPUs are capped at four fighters and named CPU 1…', () => {
  const solo = make([seat(0, { fighter: 'fox' })]);
  assert.deepEqual(solo.fighters.map(f => [f.id, f.name, f.cpu]), [['p0', 'P0', null], ['cpu-1', 'CPU 1', 2]]);
  const crowd = make([seat(0), seat(1), seat(2)], { cpus: 3, cpuLevel: 3 });
  assert.deepEqual(crowd.fighters.map(f => f.id), ['p0', 'p1', 'p2', 'cpu-1']); assert.equal(crowd.fighters[3]!.cpu, 3);
  assert.equal(make([seat(0), seat(1)]).fighters.length, 2);
});
test('chosen fighters and costumes are kept; Random resolves from the seed to a regular fighter; duplicate costumes shift', () => {
  const s = make([seat(0, { fighter: 'marth', costume: 2 }), seat(1, { fighter: 'marth', costume: 2 }), seat(2, { fighter: 'random' }), seat(3)]);
  assert.deepEqual(s.fighters.slice(0, 2).map(f => [f.kind, f.costume]), [['marth', 2], ['marth', 3]]);
  for (const f of s.fighters.slice(2)) assert.equal(ROSTER_DATA[f.kind].bonus, false);
  const again = make([seat(0, { fighter: 'marth', costume: 2 }), seat(1, { fighter: 'marth', costume: 2 }), seat(2, { fighter: 'random' }), seat(3)]);
  assert.deepEqual(again.fighters.map(f => f.kind), s.fighters.map(f => f.kind), 'deterministic from the seed');
});
test('stage: most votes win, ties break by seed among leaders, Random votes resolve, host override wins', () => {
  assert.equal(make([seat(0, { stage: 'fountain' }), seat(1, { stage: 'fountain' }), seat(2, { stage: 'battlefield' })]).stageId, 'fountain');
  const tie = new Set(Array.from({ length: 24 }, (_, k) => make([seat(0, { stage: 'fountain' }), seat(1, { stage: 'yoshi-story' })], {}, k).stageId));
  assert.deepEqual([...tie].sort(), ['fountain', 'yoshi-story']);
  assert.ok(STAGE_IDS.includes(make([seat(0, { stage: 'random' }), seat(1, { stage: 'random' })]).stageId));
  assert.equal(make([seat(0, { stage: 'fountain' }), seat(1, { stage: 'fountain' })], { stage: 'corneria' }).stageId, 'corneria');
  assert.equal(tallyStage([], Math.random), 'battlefield');
  assert.ok(STAGE_IDS.includes(make([seat(0), seat(1)], { stage: 'random' }).stageId));
});
test('teams alternate by seat order; everyone starts on the stage spawns facing the middle', () => {
  const s = make([seat(0), seat(1), seat(2), seat(3)], { teams: true, stage: 'battlefield' }), spawns = getStage('battlefield').spawns;
  assert.deepEqual(s.fighters.map(f => f.team), [0, 1, 0, 1]);
  s.fighters.forEach((f, i) => { assert.deepEqual([f.x, f.y], [...spawns[i]!]); assert.ok(f.grounded); assert.equal(f.stocks, 4); });
  assert.ok(s.fighters.some(f => f.facing === 1) && s.fighters.some(f => f.facing === -1));
  assert.equal(make([seat(0), seat(1)]).fighters[0]!.team, null);
});
test('countdown: three seconds, input ignored, and presses made during it never fire at GO', () => {
  const s = make([seat(0, { fighter: 'fox' }), seat(1, { fighter: 'mario' })]), input: Input = neutralInput();
  assert.equal(s.phase, 'countdown'); assert.equal(s.phaseEndsAt, 4000); assert.equal(s.endsAt, 4000 + 480_000);
  input.presses.jump = 3; input.presses.attack = 2;
  for (let now = 1000; now < 4000; now += 1000 / 60) rules.tick(s, new Map([['p0', input]]), 1 / 60, now);
  assert.equal(s.phase, 'countdown'); assert.equal(s.fighters[0]!.state, 'idle');
  rules.tick(s, new Map([['p0', input]]), 1 / 60, 4001); assert.equal(s.phase, 'fight');
  for (let k = 0; k < 10; k++) rules.tick(s, new Map([['p0', input]]), 1 / 60, 4001 + k * 16);
  assert.equal(s.fighters[0]!.state, 'idle'); assert.equal(s.fighters[0]!.move, null);
});
