/** The room as a league of islands: dealing, shared rolls, the horn, the room's winner, results and privacy. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_ROOM_PLAYERS } from '../../../../party-contract/src/index';
import { assertSerializable } from '../../../../party-contract/src/serializable';
import { manifest } from '../../src/manifest';
import { commit } from '../../src/engine/actions';
import { emptyHand } from '../../src/engine/cards';
import { privateView, publicView } from '../../src/engine/index';
import { best, HORN_MS, HORN_SHARE, ROLLS_PER_ROUND } from '../../src/league/index';
import { rules, type League } from '../../src/server';
import {
  FULL_TIMES, ISLAND_NAMES, ISLAND_SEATS, islandCount, islandOf, islandSizes, roomRanks, seatView,
} from '../../src/wire';
import { act, ctx, humans, play, room, shared, START, tick } from './helpers';

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

/** Tick until `done`; the game's own deadlines drive it (nobody acts). */
function run(l: League, done: (l: League) => boolean, from = START, max = 40 * 60_000) {
  let now = from;
  while (!done(l) && now < from + max) tick(l, now += 100);
  assert.ok(done(l), 'the room never got there');
  return now;
}
const windowsOpen = (l: League) => l.islands.every(s => s.turn.stage === 'round' && !s.turn.closed);

test('the manifest seats the whole room and every size has an island plan', () => {
  assert.equal(manifest.players.max, MAX_ROOM_PLAYERS);
  assert.ok(ISLAND_NAMES.length * ISLAND_SEATS >= MAX_ROOM_PLAYERS, 'an island name for every island at the cap');
  assert.equal(new Set(ISLAND_NAMES).size, ISLAND_NAMES.length);
  for (let n = 1; n <= 10; n++) assert.equal(islandCount(n, { islands: 'one' }), 1, `${n} players share one island`);
  for (let n = 11; n <= MAX_ROOM_PLAYERS; n++) {
    const count = islandCount(n, { islands: 'one' }), sizes = islandSizes(n, count);
    assert.equal(count, Math.ceil(n / ISLAND_SEATS));
    assert.equal(sizes.reduce((a, b) => a + b, 0), n);
    assert.ok(Math.max(...sizes) <= ISLAND_SEATS && Math.max(...sizes) - Math.min(...sizes) <= 1, `${n}: ${sizes}`);
    assert.ok(Math.min(...sizes) >= 2, `${n}: no island is mostly CPUs`);
  }
  assert.equal(islandCount(4, { islands: 'many' }), 1, 'four players are one island whatever the host picked');
  assert.deepEqual(islandSizes(5, islandCount(5, { islands: 'many' })), [3, 2]);
  assert.deepEqual(islandSizes(11, 3), [4, 4, 3]);
});

test('a big room is dealt onto full four-seat islands in rounds, with unique seats', () => {
  for (const n of [11, 13, 32, 64]) {
    const l = room(n), all = l.islands.flatMap(s => s.order);
    assert.equal(l.islands.length, Math.ceil(n / 4));
    assert.ok(l.islands.every(s => s.order.length === ISLAND_SEATS && s.league && s.settings.mode === 'connect'));
    assert.equal(new Set(all).size, all.length, 'seat ids are unique across the room');
    assert.equal(humans(l).length, n);
    const cpus = l.islands.flatMap(s => s.order.filter(id => s.seats[id].cpu).map(id => s.seats[id].name));
    assert.equal(cpus.length, l.islands.length * 4 - n);
    assert.equal(new Set(cpus).size, cpus.length, 'CPUs in one room have different names');
    assert.equal(new Set(l.islands.map(s => JSON.stringify(s.board.tiles))).size, l.islands.length, 'every island has its own board');
  }
  const off = room(12, { timer: 'off' });
  assert.ok(off.islands.every(s => s.settings.timer === 'relaxed'), 'an archipelago is always timed');
  const first = off.islands[0], placer = first.turn.active!;
  assert.equal(first.timers[placer].deadline, START + 30_000, 'and its opening placements get 30 s at most');
});

test('ten or fewer play one island exactly as the engine does', () => {
  for (const mode of ['standard', 'connect'] as const) {
    const l = room(6, { mode }), s = l.islands[0], view = shared(l, START).league;
    assert.equal(l.shared, false);
    assert.equal(s.league, false);
    assert.equal(s.settings.mode, mode);
    const { mapRev: _a, ...decoded } = islandOf(view, view.island), { mapRev: _b, ...engine } = publicView(s);
    assert.deepEqual(JSON.parse(JSON.stringify(decoded)), JSON.parse(JSON.stringify(engine)));
    const id = s.order[0], seat = seatView('r', id, { rev: 1, league: view }, rules.playerView(l, id, ctx(START)));
    assert.deepEqual(seat.view?.me, privateView(s, id));
    assert.equal(seat.view?.pub, islandOf(view, view.island), 'one island: the phone uses the shared copy');
  }
});

test('one roll sequence pays every island and the rounds stay together', () => {
  const l = room(12, { roundSeconds: 60 });
  let rounds = 0;
  run(l, x => {
    const r = x.islands.map(s => s.turn.round);
    assert.ok(Math.max(...r) - Math.min(...r) === 0, `islands drifted: ${r}`);
    if (x.dice && x.dice.round > rounds) { rounds = x.dice.round; assert.equal(x.dice.rolls.length, ROLLS_PER_ROUND); }
    return x.islands[0].turn.round >= 4 && windowsOpen(x);
  });
  assert.ok(rounds >= 4);
  const dice = l.islands.map(s => JSON.stringify(s.stats.dice));
  assert.equal(new Set(dice).size, 1, 'every island saw the same totals');
  assert.equal(l.islands[0].stats.dice.reduce((a, b) => a + b, 0), 4 * ROLLS_PER_ROUND);
  const rolls = shared(l, START).league.island.events.filter(e => e.kind === 'roll');
  assert.ok(rolls.length && rolls.every(e => e.kind === 'roll' && e.seat === null), 'the room rolled, not a captain');
});

test('the shared dice are plain dice: 2 and 12 turn up unless Deliveries rerolls them for the whole room', () => {
  const totals = (settings: Parameters<typeof room>[1]) => {
    const l = room(12, { ...settings, quickStart: true, timer: 'brisk', roundSeconds: 60 }), seen = new Set<number>();
    run(l, x => { for (const d of x.dice?.rolls ?? []) seen.add(d[0] + d[1]); return x.islands[0].turn.round >= 40; }, START, 3 * 3600_000);
    return seen;
  };
  const plain = totals({});
  assert.ok(plain.has(2) || plain.has(12), `120 rolls without a 2 or 12: ${[...plain]}`);
  const wagons = totals({ scenarios: ['deliveries'] });
  assert.ok(!wagons.has(2) && !wagons.has(12), 'Deliveries on four-seat islands never shows a 2 or 12');
});

test('nobody can roll or play before the shared roll; a closed island waits for the room', () => {
  const l = room(12, { quickStart: true }), s = l.islands[0], captain = s.turn.active!;
  assert.equal(s.turn.stage, 'roll');
  assert.throws(() => act(l, captain, { type: 'roll', turnId: s.turn.id }, START + 50), /cannot roll/);
  const now = run(l, windowsOpen);
  for (const id of s.order) if (!s.seats[id].ready) act(l, id, { type: 'end', turnId: s.turn.id }, now);
  tick(l, now + 2100);
  assert.equal(s.turn.closed, true);
  assert.equal(s.turn.round, l.islands[1].turn.round, 'it does not start the next round alone');
  assert.equal(shared(l, now).league.islands[0].phase, 'done');
  assert.throws(() => act(l, s.order[0], { type: 'buy-dev', turnId: s.turn.id }, now + 2200));
});

test('the horn: once most of the room is done every open window closes soon', () => {
  const l = room(12, { quickStart: true, roundSeconds: 120 }), all = l.islands.flatMap(s => s.order);
  const now = run(l, windowsOpen), need = Math.ceil(HORN_SHARE * all.length);
  const island = (id: string) => l.islands[l.home[id]];
  let done = all.filter(id => island(id).seats[id].ready).length;
  for (const id of all) {
    if (done >= need - 1) break;
    if (!island(id).seats[id].ready) { act(l, id, { type: 'end', turnId: island(id).turn.id }, now); done++; }
  }
  tick(l, now + 100);
  assert.equal(l.hornAt, null, 'one short of the share: no horn yet');
  const last = all.find(id => !island(id).seats[id].ready)!;
  act(l, last, { type: 'end', turnId: island(last).turn.id }, now + 200);
  tick(l, now + 300);
  assert.equal(l.hornAt, now + 300);
  const deadlines = l.islands.flatMap(s => Object.values(s.timers).map(t => t.deadline!));
  assert.ok(deadlines.length && deadlines.every(d => d <= now + 300 + HORN_MS), 'every clock is pulled in');
  assert.equal(shared(l, now + 300).league.hornAt, now + 300);
  const round = l.islands[0].turn.round;
  run(l, x => x.islands[0].turn.round > round, now + 300, HORN_MS + 5000);
});

test('a seat with nothing it could do is done at once; others are not', () => {
  const l = room(12, { quickStart: true }), s = l.islands[0], [poor, rich] = s.order;
  commit(s, START, n => { n.seats[poor].hand = emptyHand(); n.seats[rich].hand = { ...emptyHand(), wood: 3, brick: 3 }; });
  run(l, x => x.islands[0].turn.stage === 'round');
  tick(l, l.islands[0].now + 100);
  // Production may have paid the poor seat; it is only auto-done while its hand is empty.
  const empty = Object.values(s.seats[poor].hand).every(n => !n);
  assert.equal(s.seats[poor].ready, empty && !s.seats[poor].dev.length);
  assert.equal(s.seats[rich].ready, false);
});

test('the room winner: highest total, then whoever led a round earlier', () => {
  assert.deepEqual(best([{ id: 'a', vp: 10, past: [4, 8] }, { id: 'b', vp: 11, past: [4, 5] }]), ['b']);
  assert.deepEqual(best([{ id: 'a', vp: 10, past: [4, 8] }, { id: 'b', vp: 10, past: [5, 7] }]), ['a']);
  assert.deepEqual(best([{ id: 'a', vp: 10, past: [4, 8] }, { id: 'b', vp: 10, past: [5, 8] }]), ['b']);
  assert.deepEqual(best([{ id: 'a', vp: 10, past: [5, 8] }, { id: 'b', vp: 10, past: [5, 8] }]), ['a', 'b']);
  assert.deepEqual(best([]), []);
});

test('seat views go out whole twice per change, then short; sync asks again', () => {
  const l = room(12, { quickStart: true }), id = humans(l)[0], other = humans(l).find(x => l.home[x] !== l.home[id])!;
  const read = () => rules.playerView(l, id, ctx(START));
  for (let i = 0; i < FULL_TIMES; i++) assert.ok(read().me, 'whole at the start');
  assert.equal(read().me, undefined);
  act(l, id, { type: 'sync', turnId: 0 }, START);
  const first = read();
  assert.ok(first.me && first.island, 'whole after a sync');
  assert.equal(first.island!.index, l.home[id]);
  for (let i = 1; i < FULL_TIMES; i++) assert.ok(read().me);
  const short = read();
  assert.deepEqual(short, { rev: first.rev, home: l.home[id] });
  assert.ok(bytes(short) < 40);
  const now = run(l, windowsOpen);
  const mine = read();
  assert.ok(mine.me && mine.rev > first.rev, 'a change on my island sends it whole again');
  while (read().me) { /* drain */ }
  const before = read().rev, s = l.islands[l.home[other]];
  act(l, other, { type: 'emote', turnId: s.turn.id, emote: 'nice' }, now);
  assert.deepEqual(read(), { rev: before, home: l.home[id] }, 'another island does not touch my views');
});

test('a quiet room costs a revision number; the shared view is one cached field', () => {
  const l = room(32, { quickStart: true });
  tick(l, START + 100);
  const a = shared(l, START + 100);
  assert.deepEqual(Object.keys(a).sort(), [...manifest.snapshotCache.fields, manifest.snapshotCache.revisionField].sort());
  tick(l, START + 200);
  tick(l, START + 300);
  const b = shared(l, START + 300);
  assert.equal(b.rev, a.rev, 'nothing happened, nothing to resend');
  assert.equal(b.league, a.league);
});

test('full games at 11, 32 and 64 seats finish with one ranked room and stay private and small', () => {
  for (const n of [11, 32, 64]) {
    const l = room(n, { targetPoints: 8 });
    let largestShared = 0, largestSeat = 0, checks = 0, freshChecks = 0;
    const { now, rejected, largest } = play(l, {
      seed: n, every: 40,
      watch(x, at, view, seats) {
        const json = JSON.stringify(view);
        largestShared = Math.max(largestShared, Buffer.byteLength(json));
        // Hands, private options and inboxes never reach the shared view.
        for (const key of ['"hand":', '"inbox":', '"rates":', '"command":', '"build":', '"can":']) {
          assert.ok(!json.includes(key), `shared view leaks ${key}`);
        }
        // The rail refreshes every two seconds, so it may trail the island (a lost award shows a moment longer);
        // one that has stood that long was compared with the islands on this frame's last move, so it is exact.
        // `view` was taken before this frame's moves; the rail is checked on the room as it stands now.
        const ranks = roomRanks(shared(x, at).league), fresh = at - x.cardsAt >= 2000;
        for (const s of x.islands) for (const id of s.order) {
          const pub = publicView(s).seats.find(p => p.id === id)!;
          const hidden = privateView(s, id).vp - pub.vp;
          const shown = ranks.find(r => r.id === id)!.vp;
          if (x.results) assert.equal(shown, pub.vp + hidden);
          else if (fresh) { assert.equal(shown, pub.vp, 'hidden points stay hidden until the finale'); freshChecks++; }
          if (!x.results) assert.ok(pub.parts.every(p => !p.hidden));
        }
        for (const [id, seat] of seats) {
          largestSeat = Math.max(largestSeat, bytes(seat));
          assert.equal(seat.home, x.home[id]);
          if (!seat.me) continue;
          checks++;
          assert.equal(seat.me.seat, id, 'a seat only ever receives its own private view');
          assert.equal(seat.island!.index, x.home[id], 'and its own island');
          const text = JSON.stringify(seat.island);
          assert.ok(!text.includes('"hand":') && !text.includes('"inbox":'), 'the island copy is the public one');
        }
      },
    });
    const out = rules.outcome(l), res = l.results!;
    assert.ok(out.complete, `${n} seats: finished`);
    assert.deepEqual(rejected, [], `${n} seats: no move chosen on a current view is refused`);
    assert.ok(checks > 0 && freshChecks > 0);
    assert.equal(out.rows.length, l.islands.length * 4);
    assert.ok(out.winners.length >= 1 && out.winners.length <= 3, `${n}: ${out.winners.length} winners`);
    const top = Math.max(...out.rows.map(r => r.score!));
    assert.ok(out.winners.every(id => out.rows.find(r => r.playerId === id)!.score === top));
    assert.ok(top >= 8 || res.reason === 'round-limit');
    assert.deepEqual(out.rows.map(r => r.rank), out.rows.map(r => r.rank).sort((a, b) => a! - b!));
    assert.ok(l.islands.every(s => s.results && s.turn.stage === 'ended'), 'every island ended together');
    assert.equal(new Set(l.islands.map(s => s.results!.rounds)).size, 1, 'after the same number of rounds');
    assert.ok(res.awards.length >= 3, 'room awards were handed out');
    assert.ok(largestShared < 32 * 1024, `${n} seats: shared view ${largestShared} B fits one 32 KiB message`);
    assert.ok(largestSeat < 32 * 1024, `${n} seats: seat view ${largestSeat} B`);
    assert.ok(largest < 32 * 1024, `${n} seats: the largest message to a phone, ${largest} B, fits 32 KiB`);
    const final = shared(l, now);
    assertSerializable(final);
    assert.equal(final.league.phase, 'finale', 'the shared view is final from the finale: the results frame resends nothing');
    assert.ok(final.league.results && !('standings' in final.league.results), 'the cards carry the final totals');
    assert.equal(final.league.island.index, l.home[res.winners[0]], 'the finale shows the champion\'s island');
    const me = humans(l)[0];
    act(l, me, { type: 'sync', turnId: 0 }, now);
    const mine = rules.playerView(l, me, ctx(now)).me!;
    assert.match(mine.task.text, new RegExp(`^#\\d+ of ${l.islands.length * 4} in the room · #\\d on `));
  }
});

test('the director: stays a while, follows the action, never cuts mid-roll, ends on the champion', () => {
  const l = room(16, { targetPoints: 8 }), shots: { island: number; at: number; rolling: boolean }[] = [];
  let last = -1;
  play(l, { seed: 5, every: 1, watch(x, now, view) {
    if (view.league.featured === last) return;
    const rolling = !!x.dice && x.dice.round === x.islands[0].turn.round && x.islands.some(s => s.turn.stage === 'roll');
    shots.push({ island: last = view.league.featured, at: now, rolling });
  } });
  // The finale cuts to the champion at once, so the shot before it may be short.
  const lengths = shots.slice(1, -2).map((s, i) => shots[i + 2].at - s.at);
  assert.ok(shots.length >= 8, `${shots.length} shots in a game`);
  assert.ok(new Set(shots.map(s => s.island)).size === l.islands.length, 'every island gets air time');
  assert.ok(Math.min(...lengths) >= 7000, `shortest shot ${Math.min(...lengths)} ms`);
  assert.ok(shots.slice(1, -1).every(s => !s.rolling), 'no cut while the dice are rolling');
  assert.equal(shots.at(-1)!.island, l.home[l.results!.winners[0]]);
});
