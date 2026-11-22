/* Rooms bigger than one crew.
 *
 * Everything here sits above the engine: how a roster is split into crews, the
 * shift clock and its whistle, what a wipe costs with and without a clock, who
 * is sent which shaft, and what a room of sixty-four costs to run. One crew
 * with no clock is the original game and wire.test.ts covers it.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { MAX_MESSAGE_BYTES, MAX_ROOM_PLAYERS } from '../../../party-contract/src/index';
import type { RoundContext, ViewContext } from '../../../party-contract/src/index';
import { rules, type Round } from '../src/server';
import { manifest } from '../src/manifest';
import { crewSizes, CREWS } from '../src/crews';
import { CREW_STATE, CREW_STRIDE, SHIFT_OPEN } from '../src/model';
import type { NetInput, PrivateView } from '../src/model';
import { COOP, SHIFT } from '../src/tuning';
import { SUITS } from '../src/suits';
import { createGround, createReader, rosterOf } from '../src/viewstate';
import { makeRng } from '../src/worldgen';
import { counts } from '../src/monsters';
import { botInput, newMind, sightOf } from './helpers/bot';

const VIEW: ViewContext = { nowMs: 1000, phase: 'playing' };
const DT = 1 / manifest.simulation.stepHz;

function ctx(players: number, seed = 4242): RoundContext {
  return {
    roomId: 'room', roundId: 'round', seed, nowMs: 1000,
    players: Array.from({ length: players }, (_, i) => ({
      id: `p${i}`, name: `Player ${i}`.padEnd(16, '.').slice(0, 16), color: '#ff5748',
    })),
  };
}

/** A room that is already digging: everyone picks, and the grace runs out. */
function start(players: number, raw: Record<string, unknown> = {}, seed = 4242) {
  const round = rules.create(ctx(players, seed), rules.validateSettings(raw));
  round.seats.forEach((seat, i) => rules.applyAction(round, seat.id, { type: 'kit', turnId: 1, suit: SUITS[i % SUITS.length].id }, 1000));
  while (round.stage === 'kitup') rules.tick(round, new Map(), DT, 1000);
  return round;
}

/** Bots on every seat for `seconds`, calling back once per snapshot (three ticks). */
function play(round: Round, seconds: number, each?: (tick: number) => void, skill = 0.9) {
  const minds = round.seats.map(() => newMind()), random = makeRng(7), inputs = new Map<string, NetInput>();
  for (let tick = 0; tick < seconds * 60 && !rules.outcome(round).complete; tick++) {
    if (tick % 3 === 0) {
      for (const crew of round.crews) {
        if (crew.state !== 'dig') continue;
        const sight = sightOf(crew.sim);
        for (const seat of crew.seats) {
          inputs.set(seat.id, botInput(sight, crew.sim.dirt, seat.id, minds[round.seats.indexOf(seat)],
            { skill, random, side: (seat.slot + 0.5) / crew.seats.length }));
        }
      }
      each?.(tick);
    }
    rules.tick(round, inputs, DT, 1000);
  }
}

/** Bring a crew down for good: no lives, everyone at zero. */
function wipe(round: Round, index: number) {
  const sim = round.crews[index].sim;
  sim.lives = 0;
  for (const p of sim.players) { p.downed = true; p.hp = 0; p.downT = 0; }
  for (let t = 0; t < 60 * 3 && round.crews[index].state === 'dig'; t++) rules.tick(round, new Map(), DT, 1000);
}

/* ── splitting the room ────────────────────────────────────────────────── */

test('a room splits into as few crews as fit, as evenly as they can be', () => {
  assert.deepEqual(crewSizes(1, 4), [1]);
  assert.deepEqual(crewSizes(4, 4), [4]);
  assert.deepEqual(crewSizes(5, 4), [3, 2]);
  assert.deepEqual(crewSizes(9, 4), [3, 3, 3]);
  assert.deepEqual(crewSizes(32, 4), [4, 4, 4, 4, 4, 4, 4, 4]);
  assert.deepEqual(crewSizes(MAX_ROOM_PLAYERS, 4), Array.from({ length: 16 }, () => 4));
  assert.deepEqual(crewSizes(3, 1), [1, 1, 1], 'solo shafts: everyone alone');
  assert.ok(CREWS.length >= MAX_ROOM_PLAYERS / 4, 'a full room of crews must each have a name');
  assert.equal(new Set(CREWS.map(c => c.name)).size, CREWS.length);
  assert.equal(new Set(CREWS.map(c => c.color)).size, CREWS.length);
});

test('the manifest seats a whole room', () => {
  assert.equal(manifest.players.min, 1);
  assert.equal(manifest.players.max, MAX_ROOM_PLAYERS);
});

test('four or fewer are one crew with no clock, exactly as before', () => {
  for (const players of [1, 2, 4]) {
    const round = start(players);
    assert.equal(round.crews.length, 1);
    assert.equal(round.shiftLeft, null);
    const view = rules.publicView(round, VIEW);
    assert.equal(view.crewCount, 1);
    assert.equal(view.shiftLeft, null);
    // The shaft rides in the public view, so no phone is sent a second copy.
    assert.equal(rules.playerView(round, 'p0', VIEW).shaft, undefined);
  }
});

test('five split into two crews on a clock, seats filled in roster order', () => {
  const round = start(5);
  assert.deepEqual(round.crews.map(crew => crew.seats.map(seat => seat.id)), [['p0', 'p1', 'p2'], ['p3', 'p4']]);
  assert.equal(round.shiftLeft, SHIFT.AUTO_MINUTES * 60);
  assert.deepEqual(round.crews.map(crew => crew.sim.players.map(p => p.seatId)), [['p0', 'p1', 'p2'], ['p3', 'p4']]);
  assert.equal(rules.publicView(round, VIEW).crewCount, 2);
});

test('equal crews start on the same ground, so the race is fair', () => {
  const round = start(8);
  const [a, b] = round.crews;
  assert.equal(a.sim.runSeed, b.sim.runSeed);
  assert.deepEqual([...a.sim.dirt], [...b.sim.dirt]);
  assert.deepEqual(a.sim.monsters.map(m => [m.kind, m.x, m.y]), b.sim.monsters.map(m => [m.kind, m.x, m.y]));
});

test('the settings validate crew size and shift, and default to automatic', () => {
  const s = (raw: unknown) => rules.validateSettings(raw);
  assert.deepEqual(s({}), { startLevel: 1, lives: COOP.LIVES, crewSize: 4, shift: 0 });
  assert.equal(s({ crewSize: 9 }).crewSize, 4);
  assert.equal(s({ crewSize: 0 }).crewSize, 4, 'zero is no answer, so the default');
  assert.equal(s({ crewSize: 2 }).crewSize, 2);
  assert.equal(s({ shift: 600 }).shift, 15);
  assert.equal(s({ shift: 1 }).shift, 2);
  assert.equal(s({ shift: SHIFT_OPEN }).shift, SHIFT_OPEN);
  assert.equal(s({ shift: 'x' }).shift, 0);
  // Solo shafts: four people, four crews, and therefore a race on a clock.
  const round = start(4, { crewSize: 1 });
  assert.equal(round.crews.length, 4);
  assert.equal(round.shiftLeft, SHIFT.AUTO_MINUTES * 60);
  // A clock on one crew is the host's to ask for.
  assert.equal(start(2, { shift: 3 }).shiftLeft, 180);
});

/* ── who is sent what ──────────────────────────────────────────────────── */

test('with rival crews each phone gets its own shaft and the public view is the television’s', () => {
  const round = start(8);
  const view = rules.publicView(round, VIEW);
  assert.equal(view.crew, round.spot);
  const mine = rules.playerView(round, 'p5', VIEW);
  assert.equal(mine.crew, 1);
  assert.ok(mine.shaft, 'a digger in a race was sent no shaft');
  assert.equal(mine.shaft.crew, 1);
  assertSerializable(view);
  assertSerializable(mine);
  // A spectator, or a seat the round never took up, is told so and sent nothing.
  const none = rules.playerView(round, 'nobody', VIEW);
  assert.equal(none.playing, false);
  assert.equal(none.shaft, undefined);
});

test('a phone rebuilds its crew’s ground exactly from the journal, across a descent', () => {
  const round = start(8, {}, 97);
  const ground = createGround();
  let checked = 0, levels = new Set<number>();
  play(round, 200, tick => {
    const mine = rules.playerView(round, 'p4', VIEW);
    assert.ok(mine.shaft);
    const g = ground.update(mine.shaft, mine.shaft);
    assert.equal(g.gap, false, `the journal had a hole at tick ${tick}`);
    levels.add(mine.shaft.level);
    if (tick % 90) return;
    assert.deepEqual([...g.dirt], [...round.crews[1].sim.dirt], `dirt desync at tick ${tick}`);
    assert.deepEqual([...g.ore], [...round.crews[1].sim.ore], `ore desync at tick ${tick}`);
    checked++;
  });
  assert.ok(checked > 30);
  assert.ok(levels.size >= 2, `expected a descent, saw levels ${[...levels]}`);
});

test('a phone that missed more than the journal’s tail asks once and is sent the whole ground', () => {
  const round = start(8, {}, 97);
  const ground = createGround();
  const read = () => { const v = rules.playerView(round, 'p0', VIEW); return ground.update(v.shaft!, v.shaft!); };
  read();
  // Six seconds of digging this phone never heard about, while a crewmate's phone kept listening.
  play(round, 6, () => { rules.playerView(round, 'p1', VIEW); });
  assert.ok(round.crews[0].sim.carved > 0, 'the crew cut nothing, so there is nothing to miss');
  let g = read();
  assert.equal(g.gap, true, 'a hole in the journal went unnoticed');
  rules.applyAction(round, 'p0', rules.parseAction({ type: 'sync', turnId: 1 }), 1000);
  const answer = rules.playerView(round, 'p0', VIEW);
  assert.ok(answer.shaft?.base, 'the sync was not answered with the whole ground');
  g = ground.update(answer.shaft, answer.shaft);
  assert.equal(g.gap, false);
  assert.deepEqual([...g.dirt], [...round.crews[0].sim.dirt]);
  assert.equal(rules.playerView(round, 'p0', VIEW).shaft?.base, undefined, 'the baseline was sent twice');
  // A reconnect gets it without asking.
  rules.onPresenceChange(round, 'p1', false, 1000);
  rules.onPresenceChange(round, 'p1', true, 1000);
  assert.ok(rules.playerView(round, 'p1', VIEW).shaft?.base);
});

test('the television moves between shafts, and its ground follows through the snapshot cache', () => {
  const round = start(12);
  const reader = createReader();
  const seen = new Set<number>();
  let revision = -1, moves = 0, last = -1;
  play(round, 60, tick => {
    const view = rules.publicView(round, VIEW);
    assert.ok(view.revision >= revision, 'the cache revision ran backwards');
    revision = view.revision;
    if (view.crew !== last) { moves++; last = view.crew; }
    seen.add(view.crew);
    const shaft = reader.read(view, null, rosterOf(view.roster ?? []));
    if (tick % 90 === 0) assert.deepEqual([...reader.ground()!.dirt], [...round.crews[view.crew].sim.dirt], `the television’s ground desynced on crew ${shaft.crew}`);
  });
  assert.equal(seen.size, 3, `the television only ever showed crews ${[...seen]}`);
  assert.ok(moves <= 60 / SHIFT.SPOT_MIN + 1, `it changed shaft ${moves} times in a minute`);
});

test('a crew with someone down takes the television', () => {
  const round = start(12);
  for (let t = 0; t < 60 * (SHIFT.SPOT_MIN + 1); t++) rules.tick(round, new Map(), DT, 1000);
  const far = (round.spot + 2) % 3;
  const fallen = round.crews[far].sim.players[0];
  fallen.downed = true; fallen.hp = 0; fallen.downT = 20;
  for (let t = 0; t < 60 * (SHIFT.SPOT_MIN + 1) && round.spot !== far; t++) rules.tick(round, new Map(), DT, 1000);
  assert.equal(round.spot, far);
});

test('names go out on a change and now and then, never every frame', () => {
  const round = start(8);
  let withRoster = 0, withSite = 0, frames = 0;
  play(round, 20, () => {
    const view = rules.publicView(round, VIEW);
    frames++;
    if (view.roster) withRoster++;
    if (view.site) withSite++;
  });
  assert.ok(withRoster >= 5 && withRoster < frames / 10, `${withRoster} rosters in ${frames} frames`);
  assert.ok(withSite >= frames / 8 && withSite <= frames / 2, `${withSite} site summaries in ${frames} frames`);
  /* The room projects the results once and re-sends that frame while people
   * read them, so it is whole — everybody named, every tally — and nothing that
   * moved is in it. */
  const results = rules.publicView(round, { nowMs: 20_000, phase: 'results' });
  assert.deepEqual(results.cast?.names, round.seats.map(seat => seat.name));
  assert.deepEqual(results.cast?.suits.map(i => SUITS[i].id), round.seats.map(seat => seat.suit));
  assert.equal(results.roster, undefined);
  assert.equal(results.site?.crews.length, 2 * CREW_STRIDE);
  assert.equal(results.site?.diggers?.length, 8 * 4);
  assert.deepEqual([results.site?.marks, results.site?.feed], [[], []]);
  assert.deepEqual([results.players, results.monsters, results.rocks, results.events], [[], [], [], []]);
  assert.equal(rules.playerView(round, 'p5', { nowMs: 20_000, phase: 'results' }).shaft, undefined, 'a phone was still sent its shaft at the results');
  const { edits: _edits, ...frame } = results;
  assert.ok(Buffer.byteLength(JSON.stringify(frame)) < 900, `the results frame is ${Buffer.byteLength(JSON.stringify(frame))} bytes of game view for eight diggers`);
});

test('events ride for a quarter of a second and then stop being repeated', () => {
  const round = start(1);
  rules.tick(round, new Map([['p0', { dir: 2, dirHeld: true, pumpSeq: 0 }]]), DT, 1000);
  for (let t = 0; t < 20; t++) rules.tick(round, new Map([['p0', { dir: 2, dirHeld: true, pumpSeq: 0 }]]), DT, 1000);
  assert.ok(rules.publicView(round, VIEW).events.some(e => e.type === 'dig'));
  for (let t = 0; t < 60; t++) rules.tick(round, new Map(), DT, 1000);
  const view = rules.publicView(round, VIEW);
  assert.ok(!view.events.some(e => e.type === 'dig'), 'a second-old event is still being sent');
});

/* ── the shift ─────────────────────────────────────────────────────────── */

test('the whistle ends the shift: banked in full, hoppers at half, then the results', () => {
  const round = start(8, { shift: 2 });
  const [a, b] = round.crews;
  a.sim.banked = 800; a.sim.oreBanked = 10;
  a.sim.players[0].hopper = 101; a.sim.players[1].oreHeld = 5;
  b.sim.banked = 900;
  round.shiftLeft = 0.05;
  for (let t = 0; t < 10; t++) rules.tick(round, new Map(), DT, 1000);
  assert.equal(round.stage, 'whistle');
  assert.equal(rules.outcome(round).complete, false, 'the results cut the whistle off');
  assert.equal(rules.publicView(round, VIEW).whistle, true);
  assert.ok(rules.publicView(round, VIEW).events.some(e => e.type === 'whistle'));
  assert.equal(rules.playerView(round, 'p0', VIEW).message, 'Whistle! Tools down.');
  // 101 dirt and 5 ore at triple weight were in the hoppers: 116, salvaged at half.
  assert.equal(a.caught, 116);
  assert.equal(a.salvage, 58);
  assert.equal(a.sim.players[0].hopper, 0);
  const frozen = a.sim.tick;
  for (let t = 0; t < 60 * (SHIFT.WHISTLE_HOLD + 1); t++) rules.tick(round, new Map(), DT, 1000);
  assert.equal(a.sim.tick, frozen, 'the shaft kept moving after the whistle');
  const out = rules.outcome(round);
  assert.equal(out.complete, true);
  // Crew A: (800 + 3 * 10 + 58) / 4 = 222. Crew B: 900 / 4 = 225.
  assert.deepEqual(out.rows.map(r => r.score), [222, 222, 222, 222, 225, 225, 225, 225]);
  assert.deepEqual(out.rows.map(r => r.rank), [2, 2, 2, 2, 1, 1, 1, 1]);
  assert.deepEqual(out.winners, ['p4', 'p5', 'p6', 'p7']);
  assertSerializable(out);
});

test('crews of different sizes are ranked on each digger’s share', () => {
  const round = start(5, { shift: 2 });
  round.crews[0].sim.banked = 900;        // three diggers: 300 each
  round.crews[1].sim.banked = 700;        // two diggers: 350 each
  const out = rules.outcome(round);
  assert.deepEqual(out.rows.map(r => r.score), [300, 300, 300, 350, 350]);
  assert.deepEqual(out.rows.map(r => r.rank), [2, 2, 2, 1, 1]);
});

test('on a clock a wiped crew loses its hoppers, keeps its bank and is sent back to the top', () => {
  const round = start(8);
  const crew = round.crews[0], seed = crew.sim.runSeed;
  crew.sim.banked = 500;
  crew.sim.players[0].hopper = 300;
  crew.sim.players[0].relics = ['wide-bore'];
  wipe(round, 0);
  assert.equal(crew.state, 'wiped');
  assert.equal(rules.playerView(round, 'p0', VIEW).message, 'Crew wiped. Back to the top…');
  assert.equal(rules.outcome(round).complete, false);
  for (let t = 0; t < 60 * (SHIFT.WIPE_HOLD + 1); t++) rules.tick(round, new Map(), DT, 1000);
  assert.equal(crew.state, 'dig');
  assert.equal(crew.run, 2);
  assert.notEqual(crew.sim.runSeed, seed, 'the second shaft is the one they already saw');
  assert.equal(crew.sim.phase, 'play');
  assert.equal(crew.sim.level, 1);
  assert.equal(crew.sim.lives, COOP.LIVES);
  assert.deepEqual(crew.sim.players.map(p => p.hopper), [0, 0, 0, 0]);
  assert.deepEqual(crew.sim.players[0].relics, [], 'a relic survived the wipe');
  assert.equal(rules.outcome(round).rows[0].score, 125, 'the bank did not survive the wipe');
  assert.equal(crew.wipes, 1);
  // The other crew never noticed.
  assert.equal(round.crews[1].run, 1);
  // A new shaft is a new world to every screen: the phone regenerates rather than patching.
  const shaft = rules.playerView(round, 'p0', VIEW).shaft!;
  assert.equal(shaft.run, 2);
  assert.equal(createGround().update(shaft, shaft).gap, false);
});

test('with no clock a wiped crew is out, and the round ends when they all are', () => {
  const round = start(8, { shift: SHIFT_OPEN });
  assert.equal(round.shiftLeft, null);
  round.crews[0].sim.banked = 400;
  wipe(round, 0);
  assert.equal(round.crews[0].state, 'out');
  assert.equal(rules.outcome(round).complete, false);
  assert.equal(rules.publicView(round, { nowMs: 0, phase: 'results' }).site?.crews[6], CREW_STATE.out);
  wipe(round, 1);
  const out = rules.outcome(round);
  assert.equal(out.complete, true);
  assert.deepEqual(out.winners, ['p0', 'p1', 'p2', 'p3']);
});

test('ore is weighed in at triple when it is banked', () => {
  const round = start(2);
  round.sim.banked = 100; round.sim.oreBanked = 20;
  assert.equal(rules.outcome(round).rows[0].score, (100 + SHIFT.ORE_PAY * 20) / 2);
});

test('the shift keeps each digger’s own tally: ground cut, bursts, rescues, falls', () => {
  const round = start(4);
  play(round, 150);
  const cut = round.seats.reduce((n, seat) => n + seat.cut, 0);
  const pops = round.seats.reduce((n, seat) => n + seat.pops, 0);
  assert.ok(cut > 500, `only ${cut} cells credited`);
  assert.ok(pops > 3, `only ${pops} bursts credited`);
  // A fall and a rescue, staged: one down, a teammate one tunnel along with a clear line.
  const sim = round.sim, [down, helper] = sim.players;
  /* One monster kept, far away, so the level does not clear itself under the test. */
  const keep = sim.monsters.find(m => counts(m) && !m.dying)!;
  keep.x = keep.px = 0; keep.y = keep.py = 150; keep.mode = 'patrol'; keep.hunting = false;
  sim.monsters = [keep]; sim.rocks.length = 0; sim.fire.length = 0; sim.hazards.length = 0;
  for (const p of sim.players) { p.harpoon = { active: false, dir: 1, len: 0, state: 'idle', mon: null, ally: null }; p.hp = p.maxHp; p.downed = false; }
  sim.players[2].x = 60; sim.players[3].x = 60; sim.players[2].y = 100; sim.players[3].y = 100;
  down.x = 20; down.y = 40; helper.x = 26; helper.y = 40; helper.dir = 3;
  for (let c = 18; c < 30; c++) for (let r = 40; r < 42; r++) sim.dirt[r * 146 + c] = 0;
  const before = { downs: round.seats[0].downs, rescues: round.seats[1].rescues };
  down.hp = 1; down.invuln = 0;
  // The engine's own hurt path, so the fall is one the bookkeeping has to notice by itself.
  sim.fire.push({ x: down.x, y: down.y, w: 2, h: 2, dir: 1, t: 0.2, owner: null, blast: true });
  let pump = round.seats[1].pumpSeq;
  for (let t = 0; t < 60 * 6 && round.seats[1].rescues === before.rescues; t++) {
    rules.tick(round, new Map([['p1', { dir: null, dirHeld: false, pumpSeq: t % 6 === 0 ? ++pump : pump }]]), DT, 1000);
  }
  assert.equal(round.seats[0].downs, before.downs + 1, 'the fall was not counted');
  assert.equal(round.seats[1].rescues, before.rescues + 1, 'the rescue was not credited to the one holding the line');
  /* The results read the tallies from the site summary — each crew's once, each
   * digger's once — not from the outcome the room re-sends with every frame. */
  const site = rules.publicView(round, { nowMs: 0, phase: 'results' }).site;
  assert.deepEqual(site?.tallies, [round.sim.banked + SHIFT.ORE_PAY * round.sim.oreBanked, round.crews[0].levels, 0, 0, 0, Math.round(round.sim.deepest)]);
  assert.deepEqual(site?.diggers, round.seats.flatMap(seat => [seat.cut, seat.pops, seat.rescues, seat.downs]));
  assert.deepEqual(Object.keys(rules.outcome(round).rows[0]).sort(), ['playerId', 'rank', 'score']);
  assert.equal(rules.publicView(round, VIEW).site?.tallies, undefined, 'the tallies went out during play');
});

test('a private message names the goal: how many are left before the haul is safe', () => {
  const round = start(1);
  const p = round.sim.players[0];
  assert.equal(rules.playerView(round, 'p0', VIEW).message, 'Dig.');
  p.hopper = p.hopperMax; p.hopperFull = true;
  const left = rules.publicView(round, VIEW).left;
  assert.ok(left > 1);
  assert.equal(rules.playerView(round, 'p0', VIEW).message, `Hopper full. Clear the last ${left} to bank it.`);
  p.air = 0;
  assert.equal(rules.playerView(round, 'p0', VIEW).message, 'No air left. The roof is coming in!');
});

/* ── a full room ───────────────────────────────────────────────────────── */

for (const players of [32, MAX_ROOM_PLAYERS]) {
  test(`a room of ${players}: every crew digs and banks, and one phone’s traffic does not grow with the room`, () => {
    const round = start(players);
    assert.equal(round.crews.length, players / 4);
    let frames = 0, publicBytes = 0, privateBytes = 0, worst = 0, steps = 0, spent = 0;
    const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
    const t0 = performance.now();
    play(round, 150, () => {
      const began = performance.now();
      const view = rules.publicView(round, VIEW);
      const mine: PrivateView[] = round.seats.map(seat => rules.playerView(round, seat.id, VIEW));
      spent += performance.now() - began; steps++;
      // The transport diffs `edits` for us; what a phone is actually sent each frame is the rest.
      const { edits: _edits, ...frame } = view;
      const pub = size(frame), own = size(mine[players - 1]);
      publicBytes += pub; privateBytes += own; frames++;
      worst = Math.max(worst, size(view) + own);
      if (frames % 50 === 0) { assertSerializable(view); assertSerializable(mine[0]); }
    });
    const tick = (performance.now() - t0 - spent) / (150 * 60);
    const perPhone = (publicBytes + privateBytes) / frames * manifest.simulation.snapshotHz / 1024;
    const banked = round.crews.filter(crew => crew.sim.banked + crew.bankedBefore > 0).length;
    console.log(`  ${players} diggers: ${tick.toFixed(3)} ms a tick, ${(spent / steps).toFixed(2)} ms to project every screen, `
      + `${perPhone.toFixed(1)} KiB/s a phone (worst full snapshot ${worst} B), ${banked}/${round.crews.length} crews banked in 150 s`);
    assert.ok(worst < MAX_MESSAGE_BYTES, `a full snapshot was ${worst} bytes`);
    // A phone is sent its own shaft and the television's, whatever the room holds.
    assert.ok(perPhone < 110, `${perPhone.toFixed(1)} KiB/s a phone`);
    assert.ok(banked >= round.crews.length * 0.75, `only ${banked} of ${round.crews.length} crews banked anything in two and a half minutes`);
    assert.ok(round.seats.every(seat => seat.cut > 0), 'a digger never cut a cell');
  });
}

test('a full shift at 32 plays through to the whistle and names a winning crew', () => {
  const round = start(32, { shift: 3 });
  play(round, 60 * 4);
  const out = rules.outcome(round);
  assert.equal(out.complete, true, 'the shift never ended');
  assert.equal(out.rows.length, 32);
  assert.ok(out.winners.length >= 1 && out.winners.length % 4 === 0, `winners: ${out.winners}`);
  const top = Math.max(...out.rows.map(r => r.score ?? 0));
  assert.ok(top > 0);
  assert.ok(out.winners.every(id => out.rows.find(r => r.playerId === id)?.score === top));
  assert.equal(Math.min(...out.rows.map(r => r.rank ?? 0)), 1);
});
