/* Big rosters: what the game promises when the room holds up to 64 racers (DESIGN §10). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_ROOM_PLAYERS } from '../../../party-contract/src/index';
import { manifest } from '../src/manifest';
import { rules } from '../src/server';
import { boxRespawn, BOX_RESPAWN, fieldCooldown, maxPeels } from '../src/sim/items';
import { kartParams, PHYSICS } from '../src/sim/physics';
import { createRace, MAX_RACERS, pushEvent, stepRace } from '../src/sim/race';
import { resolveViewMode } from '../src/views';
import type { Race, Settings } from '../src/sim/types';

const settings = (o: Partial<Settings> = {}): Settings => rules.validateSettings({ track: 'mesa-rally', laps: 1, speedClass: 150, chaos: 'off', ...o });
const humans = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Racer ${i + 1}`, color: '#f5a' }));
/** Everyone's phone has dropped, so the CPU driver brings every kart home: a whole race with no scripted input. */
function finish(race: Race, cap = 60 * 400) {
  race.racers.forEach(r => { r.connected = false; });
  for (let i = 0; i < cap && race.phase !== 'results'; i++) stepRace(race, new Map(), 1 / 60);
}

test('the game seats the whole room, and the grid setting reaches it', () => {
  assert.equal(manifest.players.max, MAX_ROOM_PLAYERS);
  assert.equal(MAX_RACERS, MAX_ROOM_PLAYERS);
  assert.equal(settings({ gridSize: 64 }).gridSize, 64);
  assert.throws(() => settings({ gridSize: 65 }), /1–64/);
  assert.deepEqual(manifest.snapshotCache, { revisionField: 'rev', fields: ['base', 'players', 'final'] });
  assert.equal(manifest.prepareTimeoutMs, 60_000, 'a full room loading the course over one Wi-Fi gets a minute, not 20 s');
});

test('where races are drawn: four share the TV, forced TV grids stop at ten, crowds race on their phones', () => {
  assert.equal(resolveViewMode('auto', 4), 'tv');
  assert.equal(resolveViewMode('auto', 5), 'personal');
  assert.equal(resolveViewMode('tv', 10), 'tv');
  assert.equal(resolveViewMode('tv', 11), 'personal', 'a TV cannot show eleven tiles');
  assert.equal(resolveViewMode('tv', 64), 'personal');
});

for (const [players, grid] of [[32, 8], [64, 8], [3, 40]]) test(`${players} humans on a grid of ${grid}: everyone starts, everyone is ranked, the race finishes`, () => {
  const race = createRace(settings({ gridSize: grid }), humans(players), 21, resolveViewMode('auto', players)), n = Math.max(players, grid);
  assert.equal(race.racers.length, n);
  assert.equal(race.racers.filter(r => !r.bot).length, players, 'no human is left off the grid');
  assert.deepEqual(race.racers.map(r => r.rank), Array.from({ length: n }, (_, i) => i + 1));
  assert.equal(new Set(race.racers.map(r => r.name)).size, n, 'names stay distinct (CPU twins are numbered)');
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) assert.ok(Math.hypot(race.racers[i].x - race.racers[j].x, race.racers[i].z - race.racers[j].z) > 2.7, 'no two karts share a grid slot');
  finish(race);
  assert.equal(race.phase, 'results');
  assert.deepEqual(race.racers.map(r => r.rank).sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i + 1), 'ranks are a permutation');
  const done = race.racers.filter(r => r.finishTime !== null);
  assert.ok(done.length >= n * .9, `${done.length} of ${n} finished`);
  const outcome = rules.outcome(race);
  assert.equal(outcome.rows.length, players); assert.ok(outcome.complete);
  assert.ok(race.racers.every(r => r.stats.hitsTaken < 40), 'nobody is juggled by hits');
});

test('crowd rules: boxes refill faster, more peels may lie around, thunder and comets wait longer, a hit kart gets a longer grace', () => {
  assert.equal(boxRespawn(8), BOX_RESPAWN); assert.equal(boxRespawn(4), BOX_RESPAWN);
  assert.ok(Math.abs(boxRespawn(32) - .625) < 1e-9 && Math.abs(boxRespawn(64) - .4) < 1e-9);
  assert.deepEqual([8, 24, 40, 64].map(maxPeels), [12, 12, 20, 32]);
  assert.deepEqual([10, 16, 32, 64].map(fieldCooldown), [1, 1, 2, 3]);
  assert.equal(kartParams(1, 'zoomer', 100, 1, 12).mercy, undefined, 'small grids keep the usual grace');
  assert.ok(Math.abs(kartParams(1, 'zoomer', 100, 1, 32).mercy! - (PHYSICS.recoverInvuln + .9)) < 1e-9);
  assert.equal(kartParams(1, 'zoomer', 100, 1, 64).mercy, 3);
});

test('a pile-up on a crowded grid does not flood the event list; small grids keep every event', () => {
  const big = createRace(settings(), humans(32), 3, 'personal'), small = createRace(settings(), humans(8), 3, 'tv');
  for (const race of [big, small]) {
    race.phase = 'racing'; race.time = 5;
    for (let k = 0; k < 10; k++) { pushEvent(race, { type: 'bump', racer: 'p0', other: 'p1' }); pushEvent(race, { type: 'overtake', racer: 'p2', value: 3 }); }
    pushEvent(race, { type: 'bump', racer: 'p0', other: 'p5' });      // p5 had none yet: recorded
    pushEvent(race, { type: 'hit', racer: 'p0', other: 'p1', value: 0 }); pushEvent(race, { type: 'hit', racer: 'p0', other: 'p1', value: 0 });
  }
  assert.deepEqual(big.events.map(e => e.type), ['bump', 'overtake', 'bump', 'hit', 'hit']);
  assert.equal(small.events.length, 23);
  big.time += .6; pushEvent(big, { type: 'bump', racer: 'p0', other: 'p1' }); pushEvent(big, { type: 'overtake', racer: 'p2', value: 3 });
  assert.equal(big.events.length, 7, 'after the quiet window they are recorded again');
});
