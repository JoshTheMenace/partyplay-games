import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules, roomResult } from '../src/server';
import { manifest } from '../src/manifest';
import { MAPS, WEAPON_ORDER, TEAM_PALETTES } from '../src/options.js';
import { ARENA_SEATS, arenaCount, dealArenas, dealSeat, packInk, unpackInk } from '../public/arenas.js';
import type { Choice, Input, PublicView, RoomResult, Settings } from '../src/model';
import { assertSerializable } from '../../../../../apps/party-server/src/room-server';
import { MAX_ROOM_PLAYERS } from '../../../../../packages/party-contract/src/index';
import { STAGES, TEAMS } from '../src/labels';

const players = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `Player00000000${String(index).padStart(2, '0')}`, color: '#ff5748', lobbyChoice: { weapon: WEAPON_ORDER[index % WEAPON_ORDER.length] } }));
function create(count = 8, settings: Partial<Settings> = {}, seed = 123) { return rules.create({ roomId: 'inkwave-test', roundId: 'test-round', players: players(count), seed, nowMs: 1000 }, rules.validateSettings({ duration: 30, ...settings })); }
type State = ReturnType<typeof create>;
const ctx = (state: State) => ({ nowMs: state.lastNow, phase: 'playing' as const });
const view = (state: State): PublicView => rules.publicView(state, ctx(state));
function advance(state: State, seconds: number, inputs = new Map<string, Input>()) {
  for (let step = 0; step < seconds * 60 && !rules.outcome(state).complete; step++) rules.tick(state, inputs, 1 / 60, state.lastNow + 1000 / 60);
}
/** Every seat runs at the other base and fires, like a clumsy human. */
function charge(state: State) {
  return new Map(state.players.map(player => { const seat = state.seats.get(player.id)!; return [player.id, { ...rules.neutralInput(), hasAim: true, yaw: seat.team ? Math.PI : 0, pitch: -.25, moveY: seat.team ? -1 : 1, fire: true, sub: true }]; }));
}

test('validates settings, loadouts and bounded finite controls', () => {
  assert.equal(rules.validateSettings({}).duration, 180);
  for (const raw of [{ map: 'missing' }, { map: 'cargo', mode: 'boss' }, { mode: 'unknown' }, { duration: 0 }]) assert.throws(() => rules.validateSettings(raw));
  assert.equal((rules.parseLobbyChoice!({ weapon: 'bow', style: { hat: 3 } }, true) as { weapon: string }).weapon, 'bow');
  assert.throws(() => rules.parseLobbyChoice!({ weapon: 'unknown' }, true));
  const look = { hair: 7, skin: 8, outfit: 9, hat: 3, eyes: 7, brows: 3 };
  assert.deepEqual((rules.parseLobbyChoice!({ style: look }, true) as Choice).style, look);
  for (const key of Object.keys(look)) assert.throws(() => rules.parseLobbyChoice!({ style: { [key]: 99 } }, true));
  for (const bad of [NaN, Infinity, 2, '1']) assert.throws(() => rules.parseInput({ ...rules.neutralInput(), moveX: bad }));
  assert.throws(() => rules.parseInput({ ...rules.neutralInput(), fire: 'true' }));
  const input = rules.parseInput({ ...rules.neutralInput(), moveX: 1, moveY: 1 });
  assert.ok(Math.hypot(input.moveX, input.moveY) <= 1);
});

test('the lobby names stages and teams as the engine does', () => {
  assert.deepEqual(STAGES, Object.fromEntries(MAPS.map(map => [map.id, map.name])));
  assert.deepEqual(TEAMS, [{ name: TEAM_PALETTES[0].names[0], color: TEAM_PALETTES[0].a }, { name: TEAM_PALETTES[0].names[1], color: TEAM_PALETTES[0].b }]);
});

test('the room is dealt into balanced arenas of eight at every size up to the platform ceiling', () => {
  assert.equal(manifest.players.max, MAX_ROOM_PLAYERS);
  for (let count = 1; count <= MAX_ROOM_PLAYERS; count++) for (const mode of ['turf', 'boss'] as const) {
    const settings = rules.validateSettings({ mode }), arenas = dealArenas(players(count), settings, WEAPON_ORDER, false), teams = [0, 0];
    assert.equal(arenas.length, arenaCount(count)); assert.equal(arenas.length, Math.ceil(count / ARENA_SEATS));
    assert.deepEqual(arenas.flat().filter(seat => !seat.bot).map(seat => seat.seat).sort((a, b) => a - b), Array.from({ length: count }, (_, index) => index));
    for (const [index, roster] of arenas.entries()) {
      assert.equal(roster.length, ARENA_SEATS); assert.deepEqual(roster.map(seat => seat.nid), [0, 1, 2, 3, 4, 5, 6, 7]); assert.ok(roster.every(seat => seat.arena === index));
      const humans = roster.filter(seat => !seat.bot), side = [0, 1].map(team => humans.filter(seat => seat.team === team).length);
      // Humans are spread evenly over the arenas, then evenly over the two teams inside each one.
      assert.ok(Math.abs(humans.length - count / arenas.length) < 1);
      if (mode === 'boss') assert.ok(roster.every(seat => seat.team === 0));
      else { assert.ok(Math.abs(side[0] - side[1]) <= 1); assert.deepEqual([0, 1].map(team => roster.filter(seat => seat.team === team).length), [4, 4]); teams[0] += side[0]; teams[1] += side[1]; }
      for (const team of [0, 1]) assert.deepEqual(roster.filter(seat => seat.team === team).map(seat => seat.slot).sort(), mode === 'boss' ? team ? [] : [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3]);
      for (const seat of humans) assert.deepEqual(dealSeat(seat.seat, count, mode), { arena: index, place: seat.nid, team: seat.team, slot: seat.slot });
    }
    if (mode === 'turf') assert.ok(Math.abs(teams[0] - teams[1]) <= 1, `${count} players split ${teams}`);
  }
  // Up to eight players is the game as it always was: one arena, teams alternating by join order.
  for (let count = 1; count <= 8; count++) assert.deepEqual(dealArenas(players(count), rules.validateSettings({}), WEAPON_ORDER, false)[0].map(seat => [seat.team, seat.slot]), [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3]]);
  // Cargo Terminal never adds CPUs, and every arena still has both teams.
  for (const count of [2, 9, 17, 64]) for (const roster of dealArenas(players(count), rules.validateSettings({ map: 'cargo' }), WEAPON_ORDER, true)) { assert.ok(roster.every(seat => !seat.bot)); assert.ok([0, 1].every(team => roster.some(seat => seat.team === team))); }
});

test('a paint baseline survives packing, and a damaged one is refused', () => {
  const grid = new Uint8Array(70000); let seed = 7; const random = () => (seed = seed * 1103515245 + 12345 >>> 0) / 2 ** 32;
  for (let at = 0; at < grid.length;) { const length = 1 + Math.floor(random() ** 4 * 9000), value = Math.floor(random() * 3); grid.fill(value, at, at + length); at += length; }
  const packed = packInk(grid);
  assert.match(packed, /^[\w-]+$/); assert.ok(packed.length < grid.length / 20);
  assert.deepEqual(unpackInk(packed, new Uint8Array(grid.length)), grid);
  assert.deepEqual(unpackInk(packInk(new Uint8Array(5)), new Uint8Array(5).fill(2)), new Uint8Array(5));
  assert.throws(() => unpackInk(packed, new Uint8Array(grid.length - 1))); assert.throws(() => unpackInk(packed.slice(0, -1), new Uint8Array(grid.length)));
});

test('a room result adds its arenas up: turf by total paint, zones by arenas won, bosses by squads', () => {
  const arena = (winner: number, coverage: number[], count?: number[]): RoomResult['arenas'][number] => ({ coverage, zones: count ? { count, penalty: [0, 0], overtime: false } : null, stats: [], result: { winner, coverage } });
  // One arena: its own result, and the only case that can be a draw.
  assert.deepEqual(roomResult('turf', [arena(1, [.3, .4])]), { winner: 1, tie: false, coverage: [.3, .4], wins: [0, 1], arenas: [arena(1, [.3, .4])] });
  assert.equal(roomResult('turf', [arena(0, [.35, .35])]).tie, true);
  // Turf War: the paint of every arena counts, so a team can lose more arenas and still take the room.
  const split = roomResult('turf', [arena(0, [.6, .2]), arena(1, [.3, .35]), arena(1, [.3, .35])]);
  assert.equal(split.winner, 0); assert.deepEqual(split.wins, [1, 2]); assert.deepEqual(split.coverage, [.4, .3]);
  assert.equal(roomResult('turf', [arena(0, [.4, .2]), arena(1, [.2, .4]), arena(1, [.1, .1])]).winner, 1, 'equal paint falls back to arenas won');
  // Zone Control: arenas won, then the lower total countdown, then paint.
  assert.equal(roomResult('zones', [arena(0, [.1, .5], [0, 40]), arena(0, [.1, .5], [10, 30]), arena(1, [.1, .5], [90, 0])]).winner, 0);
  assert.equal(roomResult('zones', [arena(0, [.3, .3], [0, 40]), arena(1, [.3, .3], [20, 0])]).winner, 0);
  assert.equal(roomResult('zones', [arena(0, [.2, .3], [0, 20]), arena(1, [.3, .3], [20, 0])]).winner, 1);
  // Boss Battle is one cause: the room wins when at least half its squads sink their boss.
  assert.equal(roomResult('boss', [arena(0, [.5, 0]), arena(1, [.5, 0])]).winner, 0);
  assert.equal(roomResult('boss', [arena(0, [.5, 0]), arena(1, [.5, 0]), arena(1, [.5, 0])]).winner, 1);
});

test('real input paints turf, release stops firing, and results rank the winning team', () => {
  const state = create(1), input = { ...rules.neutralInput(), hasAim: true, yaw: 0, pitch: -.3, aimX: 0, aimY: 0, aimZ: 0, moveY: 1, fire: true };
  try {
    advance(state, 15, new Map([['p0', input]]));
    assert.ok(view(state).live.stats[0][0] > 0);
    advance(state, 1);
    assert.equal(view(state).live.actors[0][10] & 4096, 0);
    assert.deepEqual(rules.outcome(state), { complete: false, winners: [], rows: [] });
    advance(state, 30);
    const final = view(state), outcome = rules.outcome(state);
    assert.equal(outcome.complete, true); assert.equal(final.arenas.length, 1); assert.equal(rules.playerView(state, 'p0', ctx(state)), null);
    assert.equal(outcome.rows[0].rank, final.result!.winner === 0 ? 1 : 2); assert.equal(outcome.rows[0].score, final.result!.arenas[0].stats[0][0]);
    assert.deepEqual(final.result!.coverage, final.live.coverage); assert.equal(final.live.result!.winner, final.result!.winner);
    assertSerializable(final); assertSerializable(outcome);
  } finally { rules.dispose(state); }
});

test('weapon state and seeded randomness stay isolated between simultaneous rooms', () => {
  const a = create(1), b = create(1), reference = create(1);
  try {
    advance(reference, 15);
    for (let step = 0; step < 900; step++) { advance(a, 1 / 60); advance(b, 1 / 60); }
    assert.deepEqual(view(a), view(reference)); assert.deepEqual(view(b), view(reference));
    rules.dispose(a); advance(b, 15); advance(reference, 15);
    assert.deepEqual(view(b), view(reference));
  } finally { rules.dispose(b); rules.dispose(reference); }
});

test('disconnect takes over with a bot and reconnect restores the same seat', () => {
  const state = create();
  try {
    rules.onPresenceChange(state, 'p0', false, state.lastNow); advance(state, 14);
    assert.ok(view(state).live.stats[0][0] > 0);
    const id = view(state).roster[0][0].id;
    rules.onPresenceChange(state, id, true, state.lastNow); advance(state, 2);
    assert.equal(view(state).roster[0][0].id, id); assert.equal(view(state).live.actors[0][10] & 4096, 0);
  } finally { rules.dispose(state); }
});

test('stale, enemy and duplicate Super Jumps cannot alter a match', () => {
  const state = create();
  try {
    advance(state, 5);
    assert.throws(() => rules.applyAction(state, 'p0', { type: 'superjump', turnId: 'old-round', target: 2 }, state.lastNow));
    assert.throws(() => rules.applyAction(state, 'p0', { type: 'superjump', turnId: 'test-round', target: 1 }, state.lastNow));
    assert.throws(() => rules.applyAction(state, 'nobody', { type: 'superjump', turnId: 'test-round', target: 2 }, state.lastNow));
    const action = { type: 'superjump' as const, turnId: 'test-round', target: 2 };
    rules.applyAction(state, 'p0', action, state.lastNow);
    assert.throws(() => rules.applyAction(state, 'p0', action, state.lastNow));
  } finally { rules.dispose(state); }
});

test('wall-clock deadline survives a stalled scheduler', () => {
  const state = create();
  try { advance(state, 5); rules.tick(state, new Map(), 1 / 60, state.lastNow + 40000); advance(state, 3); assert.equal(rules.outcome(state).complete, true); }
  finally { rules.dispose(state); }
});

for (const map of MAPS) test(`${map.name}: a full arena reaches serializable results`, () => {
  const state = create(8, { map: map.id });
  try {
    advance(state, 40, charge(state));
    assert.equal(rules.outcome(state).complete, true); assertSerializable(view(state));
    assert.ok(Buffer.byteLength(JSON.stringify(view(state))) < 32 * 1024);
  } finally { rules.dispose(state); }
});

test('Zone Control reaches an authoritative result, including possible overtime', () => {
  const state = create(1, { mode: 'zones' });
  try { advance(state, 350); assert.equal(rules.outcome(state).complete, true); assert.ok(view(state).live.zones); assert.ok(view(state).arenas[0].count); assertSerializable(view(state)); }
  finally { rules.dispose(state); }
});

test('Cargo Terminal requires two humans and never fills or replaces seats with CPUs', () => {
  assert.throws(() => create(1, { map: 'cargo' }), /two human/);
  const state = create(2, { map: 'cargo' });
  try {
    assert.equal(view(state).roster[0].length, 2); assert.ok(view(state).roster[0].every(p => !p.bot));
    advance(state, 5); rules.onPresenceChange(state, 'p0', false, state.lastNow); advance(state, 8);
    assert.equal(view(state).live.actors[0][10] & 1, 0); assert.equal(view(state).live.stats[0][0], 0);
    rules.onPresenceChange(state, 'p0', true, state.lastNow); advance(state, 1);
    assert.equal(view(state).live.actors[0][10] & 1, 1); assertSerializable(view(state));
  } finally { rules.dispose(state); }
});

test('Boss Battle puts humans and CPUs in one squad and replicates an authoritative defeat', () => {
  const state = create(2, { mode: 'boss' });
  try {
    assert.equal(view(state).roster[0].length, 8); assert.ok(view(state).roster[0].every(p => p.team === 0));
    advance(state, 20); assert.ok(view(state).live.boss); assert.ok(view(state).live.bossMoves.length); assert.equal(view(state).arenas[0].boss!.length, 2); assertSerializable(view(state));
    advance(state, 30); assert.equal(rules.outcome(state).complete, true);
    assert.equal(view(state).result!.winner, 1); assert.deepEqual(rules.outcome(state).winners, []);
  } finally { rules.dispose(state); }
});

// Drive real boss damage in the room context to exercise phase changes and cooperative victory.
test('boss phases, weak-point scoring and victory stay isolated between rooms', () => {
  const a = create(2, { mode: 'boss', duration: 180 }), b = create(2, { mode: 'boss', duration: 180 });
  const engine = a.arenas[0].engine as unknown as { run(fn: () => void): void; context: { actors: unknown[]; boss: { maxHp: number; invuln: boolean; applyDamage(actor: unknown, amount: number, weak: boolean, point: null): void } } };
  const damage = (fraction: number) => engine.run(() => { const { boss, actors } = engine.context; boss.invuln = false; boss.applyDamage(actors[0], boss.maxHp * fraction, true, null); });
  try {
    advance(a, 15); advance(b, 15); const before = structuredClone(view(b));
    damage(.4); advance(a, 10); assert.equal(view(a).live.boss![8], 2);
    damage(.4); advance(a, 10); assert.equal(view(a).live.boss![8], 3);
    damage(1); advance(a, 8);
    assert.equal(view(a).result!.winner, 0); assert.deepEqual(rules.outcome(a).winners, ['p0', 'p1']);
    assert.ok(view(a).live.stats[0][4] > 0); assert.equal(view(a).live.stats[0][5], 3);
    assert.deepEqual(view(b), before); assertSerializable(view(a));
  } finally { rules.dispose(a); rules.dispose(b); }
});

test('every event reaches a screen that reads each snapshot or skips one, and hits are reported to the seats involved', () => {
  const state = create(8, { map: 'cargo', duration: 60 });
  try {
    const inputs = charge(state), every = new Set<number>(), skipping = new Set<number>(); let head = 0, damage = 0, last = { every: 0, skipping: 0 }, snapshots = 0, repeats = 0, baselines = 0;
    for (let step = 1; step <= 20 * 60; step++) {
      rules.tick(state, inputs, 1 / 60, state.lastNow + 1000 / 60);
      if (step % 3) continue;
      const feed = view(state).live; snapshots++; if (view(state).fresh) baselines++;
      // A screen has a gap when events it never saw have already left the window.
      assert.ok(feed.eventBase <= last.every, `gap for a screen reading every snapshot at step ${step}`);
      if (snapshots % 5) assert.ok(feed.eventBase <= last.skipping, `gap for a screen that skips every fifth snapshot at step ${step}`);
      for (const event of feed.events) {
        const [sequence, time, kind] = event as [number, number, string];
        assert.ok(sequence > feed.eventBase); assert.ok(time <= feed.t && time > feed.t - .2);
        if (every.has(sequence)) repeats++; else { every.add(sequence); if (kind === 'd') damage++; }
        if (snapshots % 5) skipping.add(sequence); head = Math.max(head, sequence);
      }
      last = { every: head, skipping: snapshots % 5 ? head : last.skipping };
    }
    assert.equal(every.size, head, 'no sequence number is ever missing'); assert.deepEqual(skipping, every);
    assert.ok(head > 500); assert.ok(repeats < head * 2.5, 'an event is not resent for long'); void damage;
    // Baselines are retaken about every two seconds and announced once each.
    assert.ok(baselines >= 9 && baselines <= 12, `${baselines} baselines in 20 s`);
    const grid = (state.arenas[0].engine as unknown as { world: { paint: { grid: Uint8Array } } }).world.paint.grid;
    assert.ok(unpackInk(view(state).ink, new Uint8Array(grid.length)).some(cell => cell > 0)); assert.ok(view(state).ink.length < 16 * 1024);
  } finally { rules.dispose(state); }
});

test('a hit is reported to the screens of the seats involved, and never for two CPUs', () => {
  const state = create(2);
  try {
    advance(state, 6);
    const engine = state.arenas[0].engine as unknown as { run(fn: () => void): void; match: { actors: { hp: number; invuln: number; damage(amount: number, attacker: unknown): void }[] } };
    const hit = (victim: number, attacker: number, amount: number) => engine.run(() => { const actors = engine.match.actors; actors[victim].invuln = 0; actors[victim].hp = 100; actors[victim].damage(amount, actors[attacker]); });
    const reported = () => view(state).live.events.filter(event => event[2] === 'd').map(event => event.slice(3));
    hit(0, 3, 30); hit(0, 3, 12); hit(5, 0, 20); hit(4, 7, 25);
    // p0 was hit by CPU 3 twice within a tenth of a second (one merged record) and hit CPU 5; CPU 7 hitting CPU 4 concerns no phone.
    assert.deepEqual(reported(), [[0, 3, 42], [5, 0, 20]]);
    advance(state, .5); assert.deepEqual(reported(), [], 'the record leaves the wire with its event window');
  } finally { rules.dispose(state); }
});

test('a room of seventeen plays three arenas at once for two room-wide teams', () => {
  const state = create(17, { duration: 60 });
  try {
    const first = view(state); assert.equal(first.arenas.length, 3); assert.equal(first.roster.length, 3); assert.equal(first.feature, 0); assert.equal(first.revision, 0); assert.equal(first.result, null);
    assert.deepEqual(manifest.snapshotCache, { revisionField: 'revision', fields: ['ink', 'inkSequence', 'roster', 'settings', 'colors', 'teams', 'result'] });
    assert.deepEqual(first.colors, [TEAM_PALETTES[0].a, TEAM_PALETTES[0].b]);
    // Each seat privately gets its own arena, with that arena's paint the first time and then only when it is retaken.
    const own = rules.playerView(state, 'p4', ctx(state))!; assert.equal(own.arena, 1); assert.equal(typeof own.ink, 'string'); assert.equal(own.feed.actors.length, 8);
    assert.equal(rules.playerView(state, 'p1', ctx(state)), own, 'seats of one arena share one projection'); assert.equal(rules.playerView(state, 'stranger', ctx(state)), null);
    const inputs = charge(state); let inks = 0, cuts = 0, feature = 0, cutPaint = 0;
    for (let step = 1; step <= 70 * 60 && !rules.outcome(state).complete; step++) {
      rules.tick(state, inputs, 1 / 60, state.lastNow + 1000 / 60);
      if (step % 3) continue;
      const now = view(state), mine = rules.playerView(state, 'p4', ctx(state))!;
      if (now.result) { assert.equal(now.revision, 1); assert.equal(rules.playerView(state, 'p4', ctx(state)), null); break; }
      assert.equal(now.revision, 0, 'the roster is sent once per socket, never again'); assert.equal(mine.arena, 1);
      if (mine.ink !== undefined) { inks++; assert.equal(mine.inkSequence, state.arenas[1].engine.inkSequence); }
      if (now.feature !== feature) { cuts++; feature = now.feature; if (now.fresh && now.fresh.inkSequence === now.inkSequence && now.live.eventBase <= now.inkSequence) cutPaint++; }
      assertSerializable(now); assertSerializable(mine);
      assert.ok(Buffer.byteLength(JSON.stringify(now)) + Buffer.byteLength(JSON.stringify(mine)) < 32 * 1024, 'a snapshot with both arenas fits one 32 KiB message');
    }
    assert.ok(inks >= 28 && inks <= 40, `${inks} private baselines in a 60 s match`);
    assert.ok(cuts >= 2, 'the broadcast visits other arenas'); assert.equal(cutPaint, cuts, 'every cut carries a baseline the new arena can be painted from');
    const outcome = rules.outcome(state), result = view(state).result!;
    assert.equal(outcome.complete, true); assert.equal(outcome.rows.length, 17); assert.equal(result.arenas.length, 3);
    assert.deepEqual(result.wins, [0, 1].map(team => result.arenas.filter(arena => arena.result.winner === team).length));
    for (const row of outcome.rows) { const seat = state.seats.get(row.playerId)!; assert.equal(row.rank, result.tie || seat.team === result.winner ? 1 : 2); assert.equal(row.score, result.arenas[seat.arena].stats[seat.nid][0]); }
    assert.equal(outcome.winners.length, outcome.rows.filter(row => row.rank === 1).length); assert.ok(outcome.winners.length >= 8);
    assertSerializable(outcome); assertSerializable(view(state));
    // The finished round is a still, small view: what repeats in every results snapshot is the scoreboard, not the result.
    const { ink, roster, settings, colors, teams, result: cached, ...still } = view(state);
    assert.equal(view(state), view(state)); assert.deepEqual([still.live.actors, still.live.events, ink], [[], [], '']); assert.ok(Buffer.byteLength(JSON.stringify(still)) < 1500);
    assert.ok(outcome.rows.every(row => row.label === undefined)); void [roster, settings, colors, teams, cached];
  } finally { rules.dispose(state); }
});

test('sixty-four seats are eight full arenas with no CPU, one roster message and bounded snapshots', () => {
  const state = create(MAX_ROOM_PLAYERS, { duration: 30 });
  try {
    const first = view(state); assert.equal(first.arenas.length, 8); assert.ok(first.roster.flat().every(seat => !seat.bot)); assert.equal(first.roster.flat().length, 64);
    assert.deepEqual([0, 1].map(team => first.roster.flat().filter(seat => seat.team === team).length), [32, 32]);
    const inputs = charge(state); let largest = 0;
    for (let step = 1; step <= 10 * 60; step++) {
      rules.tick(state, inputs, 1 / 60, state.lastNow + 1000 / 60);
      if (step % 3) continue;
      const { ink, inkSequence, roster, settings, colors, teams, ...body } = view(state);
      for (const player of [state.players[0], state.players[63]]) largest = Math.max(largest, Buffer.byteLength(JSON.stringify(body)) + Buffer.byteLength(JSON.stringify(rules.playerView(state, player.id, ctx(state)))));
      void [ink, inkSequence, roster, settings, colors, teams];
    }
    assert.ok(largest < 24 * 1024, `largest snapshot ${largest} bytes`);
    assert.ok(Buffer.byteLength(JSON.stringify(view(state))) + largest < 48 * 1024, 'a seat that connects mid-match gets the roster and paint in one message');
    assert.ok(view(state).arenas.every(arena => arena.coverage[0] + arena.coverage[1] > 0), 'every arena is being played');
  } finally { rules.dispose(state); }
});
