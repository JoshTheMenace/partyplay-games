/* The seam, not the game.
 *
 * The simulation's own behaviour is the ported engine's business. What is new
 * here is everything between it and the socket: fixed steps in, a serialisable
 * projection out, and terrain sent as a delta against a level the client
 * rebuilds for itself. Each of those can fail silently — a desynced client
 * renders a plausible wrong world rather than throwing — so they are checked
 * against a real client reconstruction rather than against themselves.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { MAX_MESSAGE_BYTES } from '../../../party-contract/src/index';
import type { RoundContext, ViewContext } from '../../../party-contract/src/index';
import { rules, type Round } from '../src/server';
import { manifest } from '../src/manifest';
import { GRID, applyRelics, generateLevel, lanesFor, levelParams, levelSeed } from '../src/worldgen';
import { counts } from '../src/monsters';
import * as engine from '../src/engine';
import { COOP, PARTY_TUNE } from '../src/tuning';
import { SUITS } from '../src/suits';
import type { NetInput, PublicView } from '../src/model';
import { readMonsters, readRocks } from '../src/model';
import { MODE_IDS, ROCK_STATE_IDS, kindName, variantName } from '../src/bestiary';

const VIEW: ViewContext = { nowMs: 1000, phase: 'playing' };
const DT = 1 / manifest.simulation.stepHz;

function ctx(players = 1, seed = 4242): RoundContext {
  return {
    roomId: 'room', roundId: 'round', seed, nowMs: 1000,
    players: Array.from({ length: players }, (_, i) => ({
      id: `p${i}`, name: `Player ${i}`.padEnd(16, '.').slice(0, 16), color: '#ff5748',
    })),
  };
}

/* A round that is already digging.
 *
 * Every round now opens on the kit-up, where the shaft deliberately holds
 * still, so a test about digging has to get through it first. Kitting the crew
 * out is the same thing a real room does: everyone picks, and the drill starts. */
function start(seed = 4242, startLevel = 1, players = 1) {
  const round = rules.create(ctx(players, seed), rules.validateSettings({ startLevel }));
  kitOut(round);
  return round;
}

/** Everyone picks a suit, then run the grace out so the drill starts. */
function kitOut(round: Round) {
  round.seats.forEach((seat, i) => {
    rules.applyAction(round, seat.id, { type: 'kit', turnId: 1, suit: SUITS[i].id }, 1000);
  });
  for (let t = 0; t < Math.ceil(COOP.KIT_GRACE / DT) + 4 && round.stage === 'kitup'; t++) {
    rules.tick(round, new Map(), DT, 1000);
  }
  assert.equal(round.stage, 'dig', 'the crew never got out of the kit-up');
}

/** Exactly what a client does: rebuild the level, then apply the delta. */
function clientGrid(view: PublicView) {
  const data = generateLevel(
    view.level,
    levelSeed(view.runSeed, view.level),
    { lanes: view.lanes, ...(view.entryLc === null ? {} : { entryLc: view.entryLc }) },
  );
  const dirt = data.dirt.slice(), ore = data.ore.slice();
  for (const [start, len] of view.edits) {
    for (let i = start; i < start + len; i++) { dirt[i] = 0; ore[i] = 0; }
  }
  return { dirt, ore };
}

/** A bot that digs toward the nearest live monster and pumps when lined up. */
function drive(round: Round, ticks: number, onTick?: (t: number) => void) {
  let pumpSeq = 0;
  for (let t = 0; t < ticks; t++) {
    const sim = round.sim, p = sim.players[0], h = p.harpoon;
    let net: NetInput = { dir: null, dirHeld: false, pumpSeq };
    let target = null, best = Infinity;
    for (const m of sim.monsters) {
      if (m.dead || m.dying || !counts(m)) continue;
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < best) { best = d; target = m; }
    }
    if (h.state === 'hit') net = { dir: null, dirHeld: false, pumpSeq: ++pumpSeq };
    else if (!h.active && target) {
      const dx = target.x - p.x, dy = target.y - p.y;
      const mx = Math.abs(dx) >= Math.abs(dy);
      const major = mx ? dx : dy, minor = mx ? dy : dx;
      if (Math.abs(minor) > 0.4) {
        net = { dir: mx ? (dy > 0 ? 2 : 0) : (dx > 0 ? 1 : 3), dirHeld: true, pumpSeq };
      } else {
        const dir = mx ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
        const solid = target.mode !== 'ghost' && target.mode !== 'remat';
        net = solid && Math.abs(major) <= 6
          ? { dir, dirHeld: false, pumpSeq: ++pumpSeq }
          : { dir, dirHeld: true, pumpSeq };
      }
    }
    rules.tick(round, new Map([['p0', net]]), DT, 1000 + t * DT * 1000);
    for (const q of sim.players) q.hp = q.maxHp;   // outlive a level's worth of hits
    onTick?.(t);
  }
}

test('a client rebuilds the server grid exactly from seed plus delta', () => {
  const round = start();
  let checks = 0;
  drive(round, 60 * 45, t => {
    if (t % 120) return;
    const view = rules.publicView(round, VIEW);
    const mine = clientGrid(view);
    assert.deepEqual([...mine.dirt], [...round.sim.dirt], `dirt desync at tick ${t}`);
    assert.deepEqual([...mine.ore], [...round.sim.ore], `ore desync at tick ${t}`);
    checks++;
  });
  assert.ok(checks >= 20, `expected many samples, took ${checks}`);
});

test('the delta survives a descent, which rebases the level', () => {
  // Start deep enough that the bot clears a level inside the tick budget.
  const round = start(97, 1);
  const levels = new Set<number>();
  let checked = 0;
  drive(round, 60 * 240, t => {
    levels.add(round.sim.level);
    if (t % 90) return;
    const view = rules.publicView(round, VIEW);
    const mine = clientGrid(view);
    assert.deepEqual([...mine.dirt], [...round.sim.dirt], `dirt desync on level ${view.level}`);
    checked++;
  });
  assert.ok(levels.size >= 2, `expected a descent, saw levels ${[...levels]}`);
  assert.ok(checked > 50);
});

test('the public view is serialisable and fits the envelope', () => {
  const round = start();
  let worst = 0, worstEdits = 0;
  drive(round, 60 * 60, t => {
    if (t % 20) return;
    const view = rules.publicView(round, VIEW);
    assertSerializable(view);
    const bytes = Buffer.byteLength(JSON.stringify(view), 'utf8');
    if (bytes > worst) { worst = bytes; worstEdits = view.edits.length; }
  });
  assert.ok(worst < MAX_MESSAGE_BYTES,
    `worst snapshot ${worst} bytes (${worstEdits} edits) exceeds ${MAX_MESSAGE_BYTES}`);
});

test('revision only moves when the terrain actually changes', () => {
  const round = start();
  const before = rules.publicView(round, VIEW).revision;
  // Idle: no direction, no pumps, so nothing is cut.
  for (let t = 0; t < 30; t++) {
    rules.tick(round, new Map([['p0', { dir: null, dirHeld: false, pumpSeq: 0 }]]), DT, 1000);
  }
  assert.equal(rules.publicView(round, VIEW).revision, before, 'idle bumped the revision');

  for (let t = 0; t < 120; t++) {
    rules.tick(round, new Map([['p0', { dir: 2, dirHeld: true, pumpSeq: 0 }]]), DT, 1000);
  }
  const after = rules.publicView(round, VIEW);
  assert.ok(after.revision > before, 'digging did not bump the revision');
  assert.ok(after.edits.length > 0, 'digging produced no edits');
});

test('pumps come from the difference in a cumulative counter', () => {
  const round = start();
  const fire = (pumpSeq: number) =>
    rules.tick(round, new Map([['p0', { dir: null, dirHeld: false, pumpSeq }]]), DT, 1000);

  // A counter that does not move is not a tap, however many ticks pass.
  fire(0); fire(0); fire(0);
  assert.equal(round.sim.players[0].harpoon.active, false, 'a still counter fired the harpoon');

  fire(1);
  assert.equal(round.sim.players[0].harpoon.active, true, 'a counter step did not fire');
});

test('a reloaded client restarting its counter does not replay the gap', () => {
  const round = start();
  const fire = (pumpSeq: number) =>
    rules.tick(round, new Map([['p0', { dir: null, dirHeld: false, pumpSeq }]]), DT, 1000);

  for (let i = 1; i <= 20; i++) fire(i);
  const seatBefore = round.seats[0].pumpSeq;
  assert.ok(seatBefore >= 1);

  // The page reloads: the client's own counter starts again at 1.
  fire(1);
  assert.equal(round.seats[0].pumpSeq, 1, 'the seat did not rebase on a lower counter');
});

test('a neutral input leaves the counter alone rather than resetting it', () => {
  const round = start();
  rules.tick(round, new Map([['p0', { dir: null, dirHeld: false, pumpSeq: 5 }]]), DT, 1000);
  const seen = round.seats[0].pumpSeq;
  rules.tick(round, new Map([['p0', rules.neutralInput()]]), DT, 1000);
  assert.equal(round.seats[0].pumpSeq, seen,
    'neutral clobbered the counter, so the next real value would look like a burst');
});

test('parseInput rejects what a hostile client could send', () => {
  assert.throws(() => rules.parseInput(null));
  assert.throws(() => rules.parseInput({ dir: 9, dirHeld: false, pumpSeq: 0 }));
  assert.throws(() => rules.parseInput({ dir: 1.5, dirHeld: false, pumpSeq: 0 }));
  assert.throws(() => rules.parseInput({ dir: 0, dirHeld: false, pumpSeq: -1 }));
  assert.throws(() => rules.parseInput({ dir: 0, dirHeld: false, pumpSeq: 1.5 }));
  assert.throws(() => rules.parseInput({ dir: 0, dirHeld: false, pumpSeq: NaN }));
  assert.deepEqual(rules.parseInput({ dir: null, dirHeld: true, pumpSeq: 3 }),
    { dir: null, dirHeld: true, pumpSeq: 3 });
});

test('a huge counter jump cannot buy more than a few taps', () => {
  const round = start();
  rules.tick(round, new Map([['p0', { dir: null, dirHeld: false, pumpSeq: 1 }]]), DT, 1000);
  rules.tick(round, new Map([['p0', { dir: null, dirHeld: false, pumpSeq: 1e9 }]]), DT, 1000);
  assert.ok(round.seats[0].pumpSeq < 1e9,
    'the whole jump was honoured, so one message bought a billion taps');
});

test('settings default and clamp', () => {
  const level = (raw: unknown) => rules.validateSettings(raw).startLevel;
  assert.equal(level({}), 1);
  assert.equal(level({ startLevel: 7 }), 7);
  assert.equal(level({ startLevel: -3 }), 1);
  assert.equal(level({ startLevel: 999 }), 30);
  assert.equal(level({ startLevel: 'x' }), 1);
});

test('a spectator gets a private view rather than an error', () => {
  const round = start();
  const mine = rules.playerView(round, 'p0', VIEW);
  const theirs = rules.playerView(round, 'nobody', VIEW);
  assert.equal(mine.playing, true);
  assert.equal(theirs.playing, false);
  assertSerializable(theirs);
});

test('the outcome completes only when the run is over', () => {
  const round = start();
  assert.equal(rules.outcome(round).complete, false);
  round.sim.phase = 'gameover';
  const done = rules.outcome(round);
  assert.equal(done.complete, true);
  assert.deepEqual(done.winners, []);
  assert.equal(done.rows.length, 1);
  assertSerializable(done);
});

test('the manifest field size matches what the projection is built against', () => {
  assert.equal(manifest.snapshotCache.revisionField, 'revision');
  assert.deepEqual([...manifest.snapshotCache.keyedPairsFields], ['edits']);
  const round = start();
  const view = rules.publicView(round, VIEW);
  // keyed pairs must be unique nonnegative integer keys with integer values.
  const seen = new Set<number>();
  for (const [k, v] of view.edits) {
    assert.ok(Number.isInteger(k) && k >= 0 && k < GRID.GW * GRID.GH, 'bad run start');
    assert.ok(Number.isInteger(v) && v > 0, 'bad run length');
    assert.ok(!seen.has(k), 'duplicate run start');
    seen.add(k);
  }
});

/* ── the crew ──────────────────────────────────────────────────────────────
 *
 * Everything above runs at one digger, which is the case the port was proved
 * byte-identical against upstream on. These are the properties that only exist
 * once there are several.
 */

test('every seat gets its own digger, in roster order', () => {
  const round = start(11, 1, 4);
  assert.equal(round.sim.players.length, 4);
  assert.deepEqual(round.sim.players.map(p => p.seatId), ['p0', 'p1', 'p2', 'p3']);
  const view = rules.publicView(round, VIEW);
  assert.equal(view.players.length, 4);
  assertSerializable(view);
});

test('inputs go to the right digger and nobody else moves', () => {
  const round = start(11, 1, 4);
  const before = round.sim.players.map(p => ({ x: p.x, y: p.y }));
  for (let t = 0; t < 60; t++) {
    rules.tick(round, new Map([['p2', { dir: 2, dirHeld: true, pumpSeq: 0 }]]), DT, 1000);
  }
  const after = round.sim.players;
  assert.ok(after[2].y > before[2].y + 1, 'the steered digger did not move');
  for (const i of [0, 1, 3]) {
    assert.equal(after[i].y, before[i].y, `digger ${i} moved without input`);
    assert.equal(after[i].x, before[i].x, `digger ${i} moved without input`);
  }
});

test('hoppers are personal and the bank is shared', () => {
  const round = start(11, 1, 4);
  for (let t = 0; t < 200; t++) {
    rules.tick(round, new Map([['p0', { dir: 2, dirHeld: true, pumpSeq: 0 }]]), DT, 1000);
  }
  const [a, b] = round.sim.players;
  assert.ok(a.hopper > 0, 'the digging digger earned nothing');
  assert.equal(b.hopper, 0, 'an idle digger was paid for someone else’s work');
  assert.equal(round.sim.banked, 0, 'nothing is banked before a descent');
});

test('a private view shows each digger only their own state', () => {
  const round = start(11, 1, 4);
  round.sim.players[1].hp = 2;
  round.sim.players[1].hopper = 40;
  const mine = rules.playerView(round, 'p1', VIEW);
  const theirs = rules.playerView(round, 'p0', VIEW);
  assert.equal(mine.hp, 2);
  assert.equal(mine.hopper, 40);
  assert.notEqual(theirs.hp, 2);
  assert.equal(theirs.hopper, 0);
});

test('relics are carried by the finder, not the crew', () => {
  const round = start(11, 1, 4);
  const [a, b] = round.sim.players;
  assert.deepEqual(a.relics, []);
  assert.deepEqual(b.relics, []);
  // Wide Bore reshapes one digger's tunnel; the tune is per digger, not global.
  assert.notEqual(a.tune, undefined);
  assert.equal(a.wide, false);
  assert.equal(b.wide, false);
});

test('a monster hunts the digger nearest through the tunnels, not by line', () => {
  const round = start(11, 1, 4);
  const sim = round.sim;
  // Everyone starts in the same pocket, so the flood has one source region and
  // every monster's target must be a real, living digger.
  for (let t = 0; t < 120; t++) {
    rules.tick(round, new Map([['p0', { dir: 2, dirHeld: true, pumpSeq: 0 }]]), DT, 1000);
  }
  const seats = new Set(sim.players.map(p => p.seatId));
  assert.ok(seats.size === 4);
  // The flood's nearest-digger index must never point outside the crew.
  for (let i = 0; i < sim.nearest.length; i++) {
    const who = sim.nearest[i];
    assert.ok(who === -1 || (who >= 0 && who < sim.players.length),
      `flood named digger ${who}, which does not exist`);
  }
});

test('the outcome reports every digger against the shared bank', () => {
  const round = start(11, 1, 4);
  round.sim.phase = 'gameover';
  const out = rules.outcome(round);
  assert.equal(out.complete, true);
  assert.deepEqual(out.winners, []);
  assert.equal(out.rows.length, 4);
  assert.ok(out.rows.every(r => r.score === round.sim.banked));
  assertSerializable(out);
});

test('a four-digger snapshot still fits the envelope', () => {
  const round = start(11, 1, 4);
  let worst = 0;
  for (let t = 0; t < 60 * 30; t++) {
    rules.tick(round, new Map([
      ['p0', { dir: 2, dirHeld: true, pumpSeq: 0 }],
      ['p1', { dir: 1, dirHeld: true, pumpSeq: 0 }],
      ['p2', { dir: 3, dirHeld: true, pumpSeq: 0 }],
      ['p3', { dir: 2, dirHeld: true, pumpSeq: 0 }],
    ]), DT, 1000);
    for (const q of round.sim.players) q.hp = q.maxHp;
    if (t % 20) continue;
    const bytes = Buffer.byteLength(JSON.stringify(rules.publicView(round, VIEW)), 'utf8');
    if (bytes > worst) worst = bytes;
  }
  assert.ok(worst < MAX_MESSAGE_BYTES, `worst four-digger snapshot ${worst} bytes`);
});

test('each digger is credited with what they personally cut', () => {
  const round = start(11, 1, 4);
  for (let t = 0; t < 200; t++) {
    rules.tick(round, new Map([['p0', { dir: 2, dirHeld: true, pumpSeq: 0 }]]), DT, 1000);
  }
  const [a, b] = round.sim.players;
  assert.ok(a.carved > 0, 'the digging digger was credited with nothing');
  assert.equal(b.carved, 0, 'an idle digger was credited with someone else’s cut');
  // The crew total drives the bonus and must not be one digger's tally.
  assert.equal(round.sim.playerCarved, a.carved);
});

/* ── down, and getting back up ─────────────────────────────────────────────
 *
 * None of this exists upstream, so the parity harness cannot cover it — and it
 * cannot cover it twice over, because that harness pins health to keep a bot
 * alive. These are the rules that turn "you died" into "can they reach you".
 */

/** Put a digger on the floor the way the game would: take their last health. */
function knockDown(round: Round, index: number) {
  engine.setTune(PARTY_TUNE);
  const p = round.sim.players[index];
  p.hp = 1;
  p.invuln = 0;
  engine.hurtPlayer(round.sim, p, p.x, p.y);
  return p;
}

const idle = (round: Round, ticks: number, inputs: [string, NetInput][] = []) => {
  for (let t = 0; t < ticks; t++) rules.tick(round, new Map(inputs), DT, 1000 + t * 16);
};

test('zero health puts a digger down, it does not end the run', () => {
  const round = start(11, 1, 2);
  const p = knockDown(round, 0);
  assert.equal(p.downed, true);
  assert.equal(p.hp, 0);
  assert.equal(round.sim.phase, 'play', 'the run ended on one digger going down');
  assert.equal(round.sim.lives, round.sim.livesMax, 'a life was spent immediately');
  assert.equal(rules.outcome(round).complete, false);
});

test('a downed digger ignores input and is no longer a target', () => {
  const round = start(11, 1, 2);
  const p = knockDown(round, 0);
  const at = { x: p.x, y: p.y };
  idle(round, 30, [['p0', { dir: 2, dirHeld: true, pumpSeq: 5 }]]);
  assert.equal(p.x, at.x, 'a downed digger moved');
  assert.equal(p.y, at.y, 'a downed digger moved');
  assert.equal(p.harpoon.active, false, 'a downed digger fired');
  // The flood must not path monsters toward someone already out of the fight.
  const lane = Math.round(p.y / 2) * 10 + Math.round(p.x / 2);
  const who = round.sim.nearest[lane];
  assert.notEqual(who, 0, 'the flood still leads monsters to a downed digger');
});

/** Open the ground between two points so a harpoon can actually fly down it. */
function clearColumn(round: Round, x: number, y0: number, y1: number) {
  const sim = round.sim;
  for (let r = Math.floor(y0); r <= Math.ceil(y1) + 1; r++) {
    for (let c = Math.floor(x); c <= Math.floor(x) + 1; c++) {
      if (c >= 0 && c < GRID.GW && r >= 0 && r < GRID.GH) sim.dirt[r * GRID.GW + c] = 0;
    }
  }
  sim.dirtRev++;
}

/* Stand a helper above a downed digger with a clear line, facing down.
 *
 * Both are placed explicitly rather than left where they spawned: the arrival
 * pocket is two cells tall, so "five above" would put them in the same square
 * and prove nothing about the harpoon's reach. */
function lineUpRescue(round: Round, downedIndex = 0, helperIndex = 1, gap = 6) {
  const sim = round.sim;
  const a = sim.players[downedIndex], b = sim.players[helperIndex];
  const col = a.x, top = sim.skyRows + 1;
  b.x = col; b.y = top; b.px = b.x; b.py = b.y; b.dir = 2;
  a.x = col; a.y = top + gap; a.px = a.x; a.py = a.y;
  clearColumn(round, col, top, a.y);
  return { a, b };
}

/** Tap the pump. The counter is cumulative and starts where a client's does. */
function pumper(round: Round, seat: string) {
  let seq = 0;
  return {
    tap(settle = 6) {
      rules.tick(round, new Map([[seat, { dir: null, dirHeld: false, pumpSeq: ++seq }]]), DT, 1000);
      for (let t = 0; t < settle; t++) {
        rules.tick(round, new Map([[seat, { dir: null, dirHeld: false, pumpSeq: seq }]]), DT, 1000);
      }
    },
    hold(ticks: number) {
      for (let t = 0; t < ticks; t++) {
        rules.tick(round, new Map([[seat, { dir: null, dirHeld: false, pumpSeq: seq }]]), DT, 1000);
      }
    },
  };
}

test('a teammate pulls them up by harpooning and pumping them', () => {
  const round = start(11, 1, 2);
  knockDown(round, 0);
  const { a } = lineUpRescue(round);

  const pump = pumper(round, 'p1');

  pump.tap(14);                             // the shot flies and takes hold
  assert.ok(a.revivePumps >= 1, 'the harpoon did not take hold of them');
  assert.equal(a.downed, true, 'one pump stood them straight up');

  for (let i = 0; i < COOP.REVIVE_PUMPS; i++) pump.tap(2);
  assert.equal(a.downed, false, 'pumping did not bring them back');
  assert.equal(a.hp, COOP.REVIVE_HP);
  assert.ok(a.invuln > 0, 'stood up with no grace at all');
  assert.equal(round.sim.lives, round.sim.livesMax, 'a revive cost a life');
});

test('a harpooned friend deflates when the line comes off, like a monster', () => {
  const round = start(11, 1, 2);
  knockDown(round, 0);
  const { a, b } = lineUpRescue(round);

  pumper(round, 'p1').tap(14);
  const banked = a.revivePumps;
  assert.ok(banked > 0, 'the shot never attached');

  // The rescuer is dragged away and the line comes off.
  b.harpoon = { active: false, dir: 1, len: 0, state: 'idle', mon: null, ally: null };
  idle(round, 240);
  assert.ok(a.revivePumps < banked, 'banked pumps never deflated');
});

test('a monster in the way takes the shot instead of the friend', () => {
  const round = start(11, 1, 2);
  knockDown(round, 0);
  const { a, b } = lineUpRescue(round, 0, 1, 6);
  const m = round.sim.monsters.find(q => !q.dead && !q.k.harpoonImmune);
  assert.ok(m, 'the level had nothing to stand in the way');
  m!.x = a.x; m!.y = a.y - 3; m!.mode = 'patrol';

  pumper(round, 'p1').tap(14);
  assert.equal(b.harpoon.ally, null, 'the harpoon reached past a monster');
  assert.equal(a.revivePumps, 0, 'the friend was grabbed through a monster');
  assert.equal(b.harpoon.mon?.id, m!.id, 'the monster in the way was not hit');
});

test('nobody reaching them costs a life and puts them back at the pocket', () => {
  const round = start(11, 1, 2);
  const a = knockDown(round, 0);
  a.hopper = 90;                            // a haul that is about to be lost
  round.sim.players[1].x = a.x + 60;        // the helper is nowhere near
  idle(round, Math.ceil(COOP.DOWN_WINDOW / DT) + 4);
  assert.equal(a.downed, false);
  assert.equal(round.sim.lives, round.sim.livesMax - 1, 'no life was spent');
  assert.equal(a.hp, COOP.RESPAWN_HP);
  assert.equal(a.hopper, 0, 'the hopper survived a death, which is the whole bet');
  assert.equal(Math.round(a.x), round.sim.spawn.lc * 2);
  assert.equal(round.sim.phase, 'play');
});

test('the run ends when the crew is down with no lives left', () => {
  const round = start(11, 1, 2);
  round.sim.lives = 0;
  knockDown(round, 0);
  assert.equal(round.sim.phase, 'play', 'one digger down ended it while another stood');
  knockDown(round, 1);
  assert.equal(round.sim.phase, 'dying', 'the whole crew went down and the run continued');
  idle(round, 120);
  assert.equal(round.sim.phase, 'gameover');
  assert.equal(rules.outcome(round).complete, true);
});

test('solo, lives are simply how many times you can go down', () => {
  const round = rules.create(ctx(1, 11), rules.validateSettings({ lives: 2 }));
  kitOut(round);
  assert.equal(round.sim.livesMax, 2);
  knockDown(round, 0);
  idle(round, Math.ceil(COOP.DOWN_WINDOW / DT) + 4);
  assert.equal(round.sim.lives, 1);
  assert.equal(round.sim.phase, 'play');

  knockDown(round, 0);
  idle(round, Math.ceil(COOP.DOWN_WINDOW / DT) + 4);
  assert.equal(round.sim.lives, 0);
  assert.equal(round.sim.phase, 'play', 'the last life was spent AND the run ended');

  knockDown(round, 0);
  assert.equal(round.sim.phase, 'dying', 'going down with no lives did not end it');
});

test('settings clamp lives and default to the house rule', () => {
  assert.equal(rules.validateSettings({}).lives, COOP.LIVES);
  assert.equal(rules.validateSettings({ lives: 0 }).lives, COOP.LIVES);
  assert.equal(rules.validateSettings({ lives: 99 }).lives, 9);
  assert.equal(rules.validateSettings({ lives: 5 }).lives, 5);
});

test('the down clock and revive progress reach the client', () => {
  const round = start(11, 1, 2);
  knockDown(round, 0);
  lineUpRescue(round);
  pumper(round, 'p1').tap(14);
  const view = rules.publicView(round, VIEW);
  const me = view.players[0];
  assert.equal(me.downed, true);
  assert.ok(me.downT > 0 && me.downT <= COOP.DOWN_WINDOW);
  assert.ok(me.reviveProgress > 0 && me.reviveProgress <= 1);
  assertSerializable(view);

  const priv = rules.playerView(round, 'p0', VIEW);
  assert.equal(priv.downed, true);
  assert.equal(priv.beingRevived, true);
  assertSerializable(priv);
});


/* ── kitting up ────────────────────────────────────────────────────────────
 *
 * A pre-round phase that lives above the simulation: it must hold the shaft
 * completely still, end when the crew is ready, and never leave anyone without
 * a suit however little they said.
 */

const kitAction = (suit: string, turnId = 1) => ({ type: 'kit' as const, turnId, suit });

test('a round opens on the kit-up with the shaft holding still', () => {
  const round = rules.create(ctx(2, 11), rules.validateSettings({}));
  assert.equal(round.stage, 'kitup');
  const before = {
    tick: round.sim.tick,
    x: round.sim.players[0].x, y: round.sim.players[0].y,
    air: round.sim.players[0].air,
    monsters: round.sim.monsters.map(m => `${m.x},${m.y}`).join('|'),
  };
  for (let t = 0; t < 120; t++) {
    rules.tick(round, new Map([['p0', { dir: 2, dirHeld: true, pumpSeq: 5 }]]), DT, 1000);
  }
  assert.equal(round.sim.tick, before.tick, 'the simulation advanced during kit-up');
  assert.equal(round.sim.players[0].y, before.y, 'a digger moved during kit-up');
  assert.equal(round.sim.players[0].air, before.air, 'air drained during kit-up');
  assert.equal(round.sim.monsters.map(m => `${m.x},${m.y}`).join('|'), before.monsters,
    'monsters moved during kit-up');

  const view = rules.publicView(round, VIEW);
  assert.ok(view.kitup, 'the kit-up was not published');
  assert.ok(view.kitup!.secondsLeft < COOP.KIT_SECONDS);
  assertSerializable(view);
});

test('the drill starts once everyone has picked, after a beat to change', () => {
  const round = rules.create(ctx(2, 11), rules.validateSettings({}));
  rules.applyAction(round, 'p0', kitAction('cobalt'), 1000);
  for (let t = 0; t < 60; t++) rules.tick(round, new Map(), DT, 1000);
  assert.equal(round.stage, 'kitup', 'it started with one digger still choosing');

  rules.applyAction(round, 'p1', kitAction('moss'), 1000);
  rules.tick(round, new Map(), DT, 1000);
  assert.equal(round.stage, 'kitup', 'it started the instant the last person tapped');

  for (let t = 0; t < Math.ceil(COOP.KIT_GRACE / DT) + 4; t++) rules.tick(round, new Map(), DT, 1000);
  assert.equal(round.stage, 'dig');
  assert.equal(rules.publicView(round, VIEW).kitup, null);
});

test('changing your mind restarts the beat rather than being ignored', () => {
  const round = rules.create(ctx(1, 11), rules.validateSettings({}));
  rules.applyAction(round, 'p0', kitAction('cobalt'), 1000);
  for (let t = 0; t < Math.ceil(COOP.KIT_GRACE / DT) - 8; t++) rules.tick(round, new Map(), DT, 1000);
  assert.equal(round.stage, 'kitup');

  rules.applyAction(round, 'p0', kitAction('carbon'), 1000);
  assert.equal(round.kitGrace, 0, 'a change did not restart the beat');
  for (let t = 0; t < 8; t++) rules.tick(round, new Map(), DT, 1000);
  assert.equal(round.stage, 'kitup', 'the drill started before the new pick settled');
  assert.equal(round.seats[0].suit, 'carbon');
});

test('the drill starts anyway when the clock runs out, and nobody is bare', () => {
  const round = rules.create(ctx(3, 11), rules.validateSettings({}));
  rules.applyAction(round, 'p1', kitAction('rust'), 1000);
  for (let t = 0; t < Math.ceil(COOP.KIT_SECONDS / DT) + 4; t++) rules.tick(round, new Map(), DT, 1000);
  assert.equal(round.stage, 'dig');
  assert.equal(round.seats[1].suit, 'rust', 'a real pick was overwritten by the default');
  assert.ok(round.seats.every(s => s.suit), 'someone went down without a suit');
  const worn = round.seats.map(s => s.suit);
  assert.equal(new Set(worn).size, worn.length, 'two silent diggers got the same suit');
});

test('a disconnected seat does not hold the crew up', () => {
  const round = rules.create(ctx(2, 11), rules.validateSettings({}));
  rules.onPresenceChange(round, 'p1', false, 1000);
  rules.applyAction(round, 'p0', kitAction('glacier'), 1000);
  for (let t = 0; t < Math.ceil(COOP.KIT_GRACE / DT) + 4; t++) rules.tick(round, new Map(), DT, 1000);
  assert.equal(round.stage, 'dig', 'one dropped phone stalled the whole crew');
  assert.ok(round.seats[1].suit, 'the absent digger went down bare');
});

test('a pick is rejected once the drill has started', () => {
  const round = start(11, 1, 2);
  assert.throws(() => rules.applyAction(round, 'p0', kitAction('bone'), 1000),
    /already started/);
});

test('parseAction refuses anything that is not a real suit for this kit-up', () => {
  assert.throws(() => rules.parseAction(null));
  assert.throws(() => rules.parseAction({ type: 'nope', turnId: 1, suit: 'bone' }));
  assert.throws(() => rules.parseAction({ type: 'kit', turnId: 2, suit: 'bone' }), /over/);
  assert.throws(() => rules.parseAction({ type: 'kit', turnId: 1, suit: 'gold' }), /No such suit/);
  assert.throws(() => rules.parseAction({ type: 'kit', turnId: 1, suit: 42 }));
  assert.deepEqual(rules.parseAction({ type: 'kit', turnId: 1, suit: 'bone' }),
    { type: 'kit', turnId: 1, suit: 'bone' });
});

test('only a seated digger can kit up', () => {
  const round = rules.create(ctx(1, 11), rules.validateSettings({}));
  assert.throws(() => rules.applyAction(round, 'nobody', kitAction('bone'), 1000),
    /seated digger/);
});

test('the chosen suit reaches every screen', () => {
  const round = rules.create(ctx(2, 11), rules.validateSettings({}));
  rules.applyAction(round, 'p0', kitAction('verdigris'), 1000);
  const view = rules.publicView(round, VIEW);
  assert.equal(view.players[0].suit, 'verdigris');
  assert.equal(view.players[1].suit, null, 'an unchosen suit was invented');
  assertSerializable(view);
});

/* ── the wider shaft ───────────────────────────────────────────────────────
 *
 * Storage is always the ten-digger maximum; how much of it is in play is the
 * active width. The dangerous failure is not an error — it is something
 * quietly using the storage bound where it meant the played one, which lets a
 * digging monster tunnel out of the map or charges dig speed for walking into
 * the edge of the world.
 */

test('the shaft widens with the crew, on the same curve as the monsters', () => {
  assert.equal(lanesFor(1), 10);
  assert.equal(lanesFor(2), 17);
  assert.equal(lanesFor(4), 31);
  assert.equal(lanesFor(10), 73);
  // Monsters scale on the same multiplier, so density stays where it was tuned.
  const solo = levelParams(1, lanesFor(1)).monsters;
  const four = levelParams(1, lanesFor(4)).monsters;
  assert.ok(Math.abs(four / solo - lanesFor(4) / lanesFor(1)) < 0.2,
    `monsters (${solo} → ${four}) did not scale with the width`);
});

test('a round is as wide as its roster and says so to the client', () => {
  for (const players of [1, 2, 4]) {
    const round = start(11, 1, players);
    assert.equal(round.sim.activeLanes, lanesFor(players));
    assert.equal(round.sim.activeGW, lanesFor(players) * 2);
    const view = rules.publicView(round, VIEW);
    assert.equal(view.lanes, lanesFor(players));
    assert.equal(view.activeGW, lanesFor(players) * 2);
  }
});

test('nothing is ever generated outside the played width', () => {
  for (const players of [1, 2, 4]) {
    const lanes = lanesFor(players);
    for (let lv = 1; lv <= 6; lv++) {
      const d = generateLevel(lv, levelSeed(4242 + lv, lv), { lanes });
      const within = (n: { lc: number }) => n.lc >= 0 && n.lc < lanes;
      assert.ok(d.monsters.every(within), `monster outside ${lanes} lanes`);
      assert.ok(d.rocks.every(within), `rock outside ${lanes} lanes`);
      assert.ok(d.pockets.every(within), `pocket outside ${lanes} lanes`);
      assert.ok(d.hazards.every(within), `hazard outside ${lanes} lanes`);
      assert.ok(within(d.playerStart), 'the arrival pocket is outside the played width');
      // And the ground out there is solid, so nothing can walk or dig into it.
      for (let r = 0; r < GRID.GH; r++) {
        for (let c = lanes * 2; c < GRID.GW; c++) {
          assert.equal(d.dirt[r * GRID.GW + c], 1,
            `column ${c} row ${r} is not solid outside the played width`);
        }
      }
    }
  }
});

test('a digging monster cannot tunnel out of the played field', () => {
  const round = start(11, 1, 2);
  const sim = round.sim;
  const digger = sim.monsters.find(m => m.k.digs);
  assert.ok(digger, 'the level had nothing that digs');
  // Put it hard against the right edge and let it run.
  digger!.x = sim.activeGW - 2;
  digger!.y = 40;
  for (let t = 0; t < 60 * 20; t++) {
    rules.tick(round, new Map([['p0', { dir: null, dirHeld: false, pumpSeq: 0 }]]), DT, 1000);
    for (const q of sim.players) q.hp = q.maxHp;
    assert.ok(digger!.x <= sim.activeGW - 2, `a digger reached x=${digger!.x}`);
  }
  for (let r = 0; r < GRID.GH; r++) {
    for (let c = sim.activeGW; c < GRID.GW; c++) {
      assert.equal(sim.dirt[r * GRID.GW + c], 1, `cell ${c},${r} was cut outside the field`);
    }
  }
});

test('diggers are clamped to the played width, not the storage width', () => {
  const round = start(11, 1, 2);
  const sim = round.sim;
  for (let t = 0; t < 60 * 30; t++) {
    rules.tick(round, new Map([['p0', { dir: 1, dirHeld: true, pumpSeq: 0 }]]), DT, 1000);
    for (const q of sim.players) q.hp = q.maxHp;
  }
  assert.ok(sim.players[0].x <= sim.activeGW - 2,
    `a digger walked to x=${sim.players[0].x} in a ${sim.activeGW}-wide field`);
  assert.ok(sim.players[0].x > sim.activeGW - 4, 'the digger never reached the right wall');
});

test('a wider shaft still fits the envelope at the advertised maximum', () => {
  const round = start(11, 1, manifest.players.max);
  let worst = 0;
  for (let t = 0; t < 60 * 60; t++) {
    rules.tick(round, new Map(round.seats.map((s, i) =>
      [s.id, { dir: [2, 1, 3, 2][i % 4], dirHeld: true, pumpSeq: 0 }])), DT, 1000);
    for (const q of round.sim.players) q.hp = q.maxHp;
    if (t % 60) continue;
    worst = Math.max(worst, Buffer.byteLength(JSON.stringify(rules.publicView(round, VIEW)), 'utf8'));
  }
  assert.ok(worst < MAX_MESSAGE_BYTES,
    `worst snapshot at ${manifest.players.max} diggers is ${worst} bytes, over the ${MAX_MESSAGE_BYTES} envelope`);
});

/* ── what the encodings rest on ────────────────────────────────────────────
 *
 * The cut ground is sent as runs of "this is dug", with no values, because of
 * two properties of the simulation. Neither is enforced by a type, and if
 * either stops holding the wire is silently wrong rather than broken — so they
 * are checked here rather than trusted.
 */

test('ground is only ever cut, never filled back in', () => {
  const round = start(11, 1, 2);
  const seen = new Uint8Array(round.sim.dirt.length);
  seen.set(round.sim.dirt);
  drive(round, 60 * 60, () => {
    const dirt = round.sim.dirt;
    for (let i = 0; i < dirt.length; i++) {
      assert.ok(dirt[i] <= seen[i], `cell ${i} went from ${seen[i]} back to ${dirt[i]}`);
      seen[i] = dirt[i];
    }
  });
});

test('ore is only ever taken where the ground was cut', () => {
  const round = start(97, 1, 2);
  const sim = round.sim;
  let dirt = Uint8Array.from(sim.dirt), ore = Uint8Array.from(sim.ore);
  let level = sim.level;
  drive(round, 60 * 90, () => {
    if (sim.level !== level) {                  // a descent regenerates both
      level = sim.level;
      dirt = Uint8Array.from(sim.dirt); ore = Uint8Array.from(sim.ore);
      return;
    }
    for (let i = 0; i < ore.length; i++) {
      if (ore[i] === sim.ore[i]) continue;
      assert.equal(sim.dirt[i], 0, `ore at ${i} changed while the ground stood`);
      assert.ok(sim.ore[i] < ore[i], `ore at ${i} increased`);
      ore[i] = sim.ore[i];
    }
    dirt.set(sim.dirt);
  });
});

test('packed entities survive the round trip exactly', () => {
  const round = start(11, 1, 2);
  drive(round, 60 * 20);
  const view = rules.publicView(round, VIEW);
  const monsters = readMonsters(view.monsters, kindName,
    (k, i) => variantName(k, i), i => MODE_IDS[i] ?? 'patrol');
  const live = round.sim.monsters.filter(m => !m.dead);
  assert.equal(monsters.length, live.length, 'a monster was lost in the encoding');
  for (let i = 0; i < live.length; i++) {
    const a = live[i], b = monsters[i];
    assert.equal(b.id, a.id);
    assert.equal(b.kind, a.kind, 'kind index decoded to the wrong creature');
    assert.equal(b.variant, a.variant, 'variant index decoded to the wrong strain');
    assert.equal(b.mode, a.mode, 'mode index decoded to the wrong state');
    assert.ok(Math.abs(b.x - a.x) <= 0.005, `x drifted: ${a.x} -> ${b.x}`);
    assert.ok(Math.abs(b.y - a.y) <= 0.005, `y drifted: ${a.y} -> ${b.y}`);
    assert.equal(b.hunting, a.hunting);
    assert.equal(b.dying, a.dying);
  }
  const rocks = readRocks(view.rocks, i => ROCK_STATE_IDS[i] ?? 'idle');
  assert.equal(rocks.length, round.sim.rocks.length);
  for (let i = 0; i < rocks.length; i++) {
    assert.equal(rocks[i].state, round.sim.rocks[i].state, 'rock state index decoded wrongly');
    assert.ok(Math.abs(rocks[i].x - round.sim.rocks[i].x) <= 0.005);
  }
  assertSerializable(view);
});


test('Still Air reduces only its carrier’s air drain by forty percent', () => {
  const sim = start(4242, 1, 2).sim;
  sim.players[0].relics = ['still-air'];
  sim.players[0].tune = applyRelics(PARTY_TUNE, sim.players[0].relics).tune;
  sim.players.forEach(player => { player.air = 50; });
  for (let i = 0; i < 60; i++) engine.step(sim, 1 / 60, []);
  const [carrier, teammate] = sim.players.map(player => 50 - player.air);
  assert(teammate > 0);
  assert(Math.abs(carrier / teammate - .6) < 1e-6);
});

test('the private pump acknowledgement resumes the first tap after rotation and reconnect', () => {
  const round = start();
  round.seats[0].pumpSeq = 20;
  for (const reconnect of [false, true]) {
    if (reconnect) { rules.onPresenceChange(round, 'p0', false, 1000); rules.onPresenceChange(round, 'p0', true, 1100); }
    const before = round.seats[0].pumpSeq, resumed = rules.playerView(round, 'p0', VIEW).pumpSeq;
    assert.equal(resumed, before);
    rules.tick(round, new Map([['p0', { dir: null, dirHeld: false, pumpSeq: resumed + 1 }]]), DT, 1200);
    assert.equal(round.seats[0].input.pumps, 1);
    assert.equal(round.seats[0].pumpSeq, before + 1);
  }
});
