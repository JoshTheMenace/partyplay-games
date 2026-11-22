import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { CREWS, NIGHT, crewOfSeat, crewSizes, crewStarts, scoreSeconds, type Role, type Tool } from '../src/model';
import { getMap } from '../src/maps';
import { rules } from '../src/server';
import type { NpcSpawn } from '../src/server-levels';
import { heist, STEP, type Heist } from '../src/sim/harness';
import { OUTRO_MS, standings } from '../src/sim/night';
import { hurt, type State } from '../src/sim/state';
import { project } from '../src/sim/view';
import { crewOf, decode, ownView, pack, unpack, type Wire } from '../src/wire';
import { botChoice, crewBot } from '../tools/bot';

const map = getMap('velvet'), exit = map.objects.find(o => o.kind === 'exit')!, ctx = (h: Heist) => ({ nowMs: h.wall, phase: 'playing' as const });
const post = (x: number, y: number, facing = 0): NpcSpawn => ({ kind: 'guard', route: [[x, y, 9999, facing]] });
const secs = (h: Heist, seconds: number, inputs: Parameters<Heist['step']>[0] = {}) => h.step(inputs, Math.round(seconds / STEP));
/** Tests poke state between ticks; a new stamp makes the next snapshot project it again. */
const wire = (h: Heist): Wire => { h.night.stamp++; return rules.publicView(h.night, ctx(h)); };
const own = (h: Heist, id: string) => rules.playerView(h.night, id, ctx(h));
/** Puts a whole crew in the getaway ring with the goods. */
const getaway = (s: State) => { s.crew.forEach(p => Object.assign(p, { x: exit.x, y: exit.y })); s.objective = { x: exit.x, y: exit.y, carrier: s.crew[0].id, taken: true }; s.phase = 'escape'; };

test('rosters split into crews of at most four, as evenly as they go, in seat order', () => {
  assert.deepEqual([1, 2, 4, 5, 6, 7, 9, 10, 13, 32, 63, 64].map(n => crewSizes(n).join('+')), ['1', '2', '4', '3+2', '3+3', '4+3', '3+3+3', '4+3+3', '4+3+3+3', '4+4+4+4+4+4+4+4', `${'4+'.repeat(15)}3`, `${'4+'.repeat(15)}4`]);
  for (let n = 1; n <= 64; n++) {
    const sizes = crewSizes(n), starts = crewStarts(n);
    assert.equal(sizes.reduce((a, b) => a + b), n); assert.ok(sizes.every(s => s >= 1 && s <= 4) && Math.max(...sizes) - Math.min(...sizes) <= 1 && sizes.length <= CREWS.length, `${n}: ${sizes}`);
    assert.ok(n < 5 || Math.min(...sizes) >= 2, 'nobody is dealt a crew of one on a crew night');
    for (let seat = 0; seat < n; seat++) { const crew = crewOfSeat(n, seat); assert.ok(seat >= starts[crew] && seat < starts[crew + 1]); }
  }
  assert.equal(new Set(CREWS.map(c => c.name)).size, 16); assert.equal(new Set(CREWS.map(c => c.color)).size, 16);
});

test('a crew night gives every crew its own heist: its own building, guards, seed and clock; one crew is the classic game', () => {
  const classic = heist(4), night = heist(9).night;
  assert.equal(classic.night.heists.length, 1); assert.equal(classic.night.rival, false); assert.equal(classic.night.ends, 0); assert.equal(classic.s.heistId, 'h1');
  assert.equal(night.heists.length, 3); assert.equal(night.rival, true); assert.equal(night.ends, 1000 + NIGHT.cap * 1000);
  assert.deepEqual(night.heists.map(s => s.heistId), ['h1:0', 'h1:1', 'h1:2']);
  assert.deepEqual(night.heists.map(s => s.crew.map(p => p.seat)), [[0, 1, 2], [3, 4, 5], [6, 7, 8]]);
  assert.deepEqual(night.heists.map(s => s.crew.map(p => p.id)), [['p0', 'p1', 'p2'], ['p3', 'p4', 'p5'], ['p6', 'p7', 'p8']]);
  assert.equal(new Set(night.heists.map(s => s.rng)).size, 3, 'each crew has its own random stream');
  assert.notDeepEqual(night.heists[0].npcs.map(n => n.pauseUntil), night.heists[1].npcs.map(n => n.pauseUntil), 'patrols start out of step');
  for (const s of night.heists) { assert.deepEqual(s.crew.map(p => [p.x, p.y]), map.spawns.slice(0, 3).map(p => [p.x, p.y])); assert.notEqual(s.npcs, night.heists[(s.slot + 1) % 3].npcs); }
  assert.deepEqual(night.base.roster.map(p => p[0]), Array.from({ length: 9 }, (_, i) => `p${i}`));
});

test('packing a crew view for the wire and unpacking it loses nothing a screen draws', () => {
  const h = heist(4, { choices: [{ role: 'scout', tool: 'smoke' }, { role: 'wire', tool: 'tranq' }, { role: 'magpie', tool: 'emp' }, { role: 'breacher', tool: 'decoy' }], seed: 5 }), s = h.s, bots = s.crew.map(p => crewBot(p.id));
  let checked = 0, busy = 0;
  for (let t = 0; t < 30 * 70; t++) {
    const view = project(s);
    if (t % 15 === 0) for (const [i, p] of s.crew.entries()) { p.health = Math.max(p.health, 60); const move = bots[i](view); s.crew[i].input = move.input; if (move.tool) try { h.tool(p.id); } catch { /* no charge */ } }
    h.step(Object.fromEntries(s.crew.map(p => [p.id, p.input])));
    if (t === 30 * 20) { s.smoke.push({ x: 20.5, y: 20.5, radius: 2.5, until: s.now + 4000, born: s.now }); s.alarm = { x: 22.5, y: 20.5, until: s.now + 9000 }; s.spent.push('safe-12-1'); s.circuits.floor = s.now + 20000; s.broken.push(9 * map.width + 34); }
    if (t % 7) continue;
    const before = project(s), after = unpack(pack(before), h.night.base);
    // Times travel as whole milliseconds relative to the crew clock; hints and stats travel separately.
    const plain = (v: typeof before) => { const ms = (at: number) => at && Math.round(at - v.now); return { ...v, players: v.players.map(p => ({ ...p, hint: '' })), stats: {}, smoke: v.smoke.map(c => ({ ...c, until: ms(c.until), born: ms(c.born) })), noises: v.noises.map(n => ({ ...n, at: ms(n.at) })), shots: v.shots.map(x => ({ ...x, at: ms(x.at) })), effects: v.effects.map(e => ({ ...e, at: ms(e.at) })), alarm: v.alarm && { ...v.alarm, until: ms(v.alarm.until) }, objects: v.objects.map(o => ({ ...o, until: ms(o.until) })) }; };
    const sent = plain(after), meant = plain(before);
    for (const key of Object.keys(meant) as (keyof typeof meant)[]) assert.deepEqual(sent[key], meant[key], `${key} at tick ${t}`);
    checked++;
    busy += +(before.npcs.length > 0) + +(before.effects.length > 0) + +(before.noises.length > 0) + +before.players.some(p => p.work) + +(before.objects.some(o => o.state !== 'ready'));
  }
  assert.ok(checked > 250 && busy > 300, `${checked} snapshots, ${busy} busy parts`);
});

test('a seat is sent its own crew and the crew on the shared screen, and nothing of a guard neither of them can see', () => {
  // Every crew's copy posts one guard deep in the casino (17,10) and one in the lobby (20,18). Nobody can see either from the lot.
  const h = heist(8, { level: { npcs: [post(17, 10), post(20, 18)] } }), [a, b] = h.night.heists;
  Object.assign(a.npcs[0], { x: 17.77, y: 10.31 }); Object.assign(a.npcs[1], { x: 20.61, y: 18.13 }); Object.assign(b.npcs[0], { x: 17.23, y: 10.89 }); Object.assign(b.npcs[1], { x: 20.47, y: 18.59 });
  // Crew B's first thief walks into the lobby next to its guard; crew A stays outside.
  Object.assign(b.crew[0], { x: 16.5, y: 18.5 });
  for (const cast of [0, 1]) {
    h.night.cast = cast; const w = wire(h), text = JSON.stringify(w), night = decode(w);
    assert.equal(night.cast.crew, cast); assert.deepEqual(night.cast.npcs.map(n => [n.x, n.y]), cast ? [[20.47, 18.59]] : []);
    for (const hidden of ['17.77', '10.31', '20.61', '18.13', '17.23', '10.89']) assert.ok(!text.includes(hidden), `public snapshot leaks ${hidden} with crew ${cast} on screen`);
    for (const p of [...a.crew, ...b.crew]) {
      const mine = own(h, p.id)!, crew = crewOf(night, p.id), view = ownView(w, mine, p.id)!;
      assert.equal(view.crew, crew); assert.equal(mine.live === null, crew === cast, 'a crew already on the shared screen is not sent twice');
      assert.deepEqual(view.npcs.map(n => [n.x, n.y]), crew ? [[20.47, 18.59]] : [], `${p.id} sees only what its own crew sees`);
      assert.deepEqual(view.players.map(q => q.id), h.night.heists[crew].crew.map(q => q.id));
      for (const hidden of ['17.77', '10.31', '20.61', '18.13', '17.23', '10.89']) assert.ok(!JSON.stringify(mine).includes(hidden));
      assert.equal(view.players.find(q => q.id === p.id)!.hint, mine.hint); assert.ok(view.players.every(q => q.id === p.id || q.hint === ''), 'hints are private');
      assertSerializable(mine);
    }
    assertSerializable(w); assert.equal(own(h, 'stranger'), null);
    // The board is the only thing about other crews that always travels, and it holds no positions.
    assert.deepEqual(w.board.map(row => row.length), [7, 7]);
  }
  // A Scout senses guards through walls for its own crew only.
  const scouts = heist(8, { level: { npcs: [post(17, 10)] }, choices: [{}, {}, {}, {}, { role: 'scout' }] }), sw = wire(scouts);
  Object.assign(scouts.night.heists[1].crew[0], { x: 16.5, y: 16.5 });
  assert.deepEqual(ownView(wire(scouts), own(scouts, 'p4'), 'p4')!.intel.map(i => i.kind), ['guard']); assert.deepEqual(ownView(sw, own(scouts, 'p0'), 'p0')!.intel, []);
});

test('tools and input reach only the thief\'s own crew, and an action for another heist is refused', () => {
  const h = heist(8), [a, b] = h.night.heists;
  h.tool('p5');
  assert.equal(b.crew[1].charges, 1); assert.equal(b.smoke.length, 1); assert.equal(a.smoke.length, 0); assert.ok(a.crew.every(p => p.charges === 2));
  assert.throws(() => rules.applyAction(h.night, 'p5', { type: 'tool', heistId: a.heistId }, h.wall), /over/);
  assert.throws(() => rules.applyAction(h.night, 'nobody', { type: 'tool', heistId: a.heistId }, h.wall), /over/);
  const x = b.crew[0].x; secs(h, 1, { p4: { x: 1, y: 0, sneak: false } });
  assert.ok(b.crew[0].x > x + 2); assert.equal(a.crew[0].x, map.spawns[0].x);
});

test('crew night: a wiped crew is hauled back to the start by the van instead of busting, for thirty seconds on its time', () => {
  const h = heist(8, { level: { npcs: [post(20, 18)] } }), [a, b] = h.night.heists, guard = a.npcs[0];
  a.crew.forEach(p => Object.assign(p, { x: 12.5, y: 21.5 })); Object.assign(guard, { state: 'chase', target: 'p0', suspicion: 1 });
  a.objective = { x: 12.5, y: 21.5, carrier: 'p0', taken: true }; a.phase = 'escape';
  for (const p of a.crew) hurt(a, p, 200);
  secs(h, .1); assert.equal(a.phase, 'escape'); assert.match(a.message, /van is coming/); assert.equal(rules.playerView(h.night, 'p0', ctx(h))!.hint, 'Whole crew down. The van is coming to haul you out.');
  secs(h, NIGHT.bailAfter / 1000 - .3); assert.ok(a.crew.every(p => p.down)); assert.equal(a.bails, 0);
  secs(h, .5);
  assert.equal(a.bails, 1); assert.equal(a.phase, 'escape', 'the heist goes on');
  assert.deepEqual(a.crew.map(p => [p.x, p.y, p.down, p.health]), map.spawns.slice(0, 4).map(p => [p.x, p.y, false, NIGHT.bailHealth]));
  assert.equal(guard.state, 'patrol'); assert.equal(a.alarm, null);
  assert.deepEqual(a.objective, { x: 12.5, y: 21.5, carrier: null, taken: true }, 'the goods stay where they fell');
  assert.ok(decode(wire(h)).cast.effects.filter(e => e.kind === 'bail').length === 4); assert.equal(decode(wire(h)).cast.bails, 1);
  assert.equal(b.bails, 0); assert.equal(b.phase, 'infiltrate');
  assert.match(h.night.news.at(-1)!.text, /Foxes got hauled out/);
  assert.equal(scoreSeconds(100, 10, 1), 100 + 30 + NIGHT.bailPenalty);
  // A crew with one member down is not wiped; a revive in time cancels the van.
  hurt(a, a.crew[1], 200); secs(h, 6); assert.equal(a.bails, 1);
  for (const p of a.crew) hurt(a, p, 200);
  secs(h, 1); a.crew[0].down = false; a.crew[0].health = 50; secs(h, 5); assert.equal(a.bails, 1); assert.equal(a.wipedAt, null);
});

test('crew night: the first clean getaway starts a two-minute last call; at sunrise crews still inside are out and the board decides', () => {
  const h = heist(11), [a, b, c] = h.night.heists;
  secs(h, 30); assert.ok(Math.abs(decode(wire(h)).left - (NIGHT.cap - 30)) <= 1); assert.equal(decode(wire(h)).lastCall, false);
  b.collected = 40; getaway(b); secs(h, .1);
  assert.equal(b.phase, 'clear'); assert.equal(h.night.ends, b.endedAt! + NIGHT.lastCall * 1000);
  assert.match(h.night.news.at(-1)!.text, /Moths are away first/); assert.equal(decode(wire(h)).lastCall, true);
  assert.equal(rules.outcome(h.night).complete, false, 'the night goes on for the others');
  c.objective = { x: 30.5, y: 12.5, carrier: 'p8', taken: true }; c.phase = 'escape'; a.collected = 60; c.collected = 5;
  secs(h, 60); assert.ok(a.phase === 'infiltrate' && c.phase === 'escape');
  assert.deepEqual(standings(h.night).map(l => l.place), [3, 1, 2], 'away first, then the crew holding the goods, then loot');
  secs(h, 60.2);
  assert.deepEqual([a.phase, c.phase], ['failed', 'failed']); assert.match(a.message, /Sunrise/);
  assert.equal(rules.outcome(h.night).complete, false); secs(h, OUTRO_MS / 1000 + .1);
  const out = rules.outcome(h.night);
  assert.equal(out.complete, true); assert.deepEqual(out.winners, b.crew.map(p => p.id));
  assert.deepEqual(out.rows.map(r => r.rank), [3, 3, 3, 3, 1, 1, 1, 1, 2, 2, 2]); assert.match(out.rows[4].label!, /^Moths · Escaped/);
  const final = wire(h); assert.equal(final.rev, 2); assert.equal(final.final!.stats.length, 11); assertSerializable(final); assertSerializable(out);
  assert.equal(final.ends - final.now < 0, true);
  // Nobody away: the night still ends at its cap.
  const slow = heist(8); secs(slow, NIGHT.cap - 1); assert.ok(slow.night.heists.every(s => s.phase === 'infiltrate'));
  secs(slow, 1.2); assert.ok(slow.night.heists.every(s => s.phase === 'failed')); assert.deepEqual(rules.outcome(slow.night).winners, []);
  // A later getaway never lengthens the last call, and equal results share a place.
  const pair = heist(8), [x, y] = pair.night.heists; secs(pair, 10); getaway(x); secs(pair, 20); const ends = pair.night.ends; getaway(y); secs(pair, .1);
  assert.equal(pair.night.ends, ends); assert.deepEqual(standings(pair.night).map(l => l.place), [1, 2]);
  y.elapsed = x.elapsed; assert.deepEqual(standings(pair.night).map(l => l.place), [1, 1]);
});

test('crew night: no pausing; a crew whose phones all leave is out and never holds the night up', () => {
  const h = heist(8), [a, b] = h.night.heists;
  for (const p of a.crew) rules.onPresenceChange(h.night, p.id, false, h.wall);
  secs(h, 5); assert.equal(a.pauseAt, null); assert.ok(a.elapsed > 4.9, 'the clock runs on');
  secs(h, 11); assert.equal(a.phase, 'failed'); assert.match(a.message, /left the job/); assert.equal(b.phase, 'infiltrate');
  getaway(b); secs(h, OUTRO_MS / 1000 + .2); assert.equal(rules.outcome(h.night).complete, true);
  assert.deepEqual(wire(h).final!.left, [0, 1, 2, 3]);
  // The classic game still pauses when its whole crew is away.
  const solo = heist(2); rules.onPresenceChange(solo.night, 'p0', false, solo.wall); rules.onPresenceChange(solo.night, 'p1', false, solo.wall);
  secs(solo, 30); assert.ok(solo.s.elapsed < .1 && solo.s.phase === 'infiltrate');
});

test('the director keeps a crew on the shared screen for five seconds, cuts to trouble, and gives every crew a turn', () => {
  const h = heist(12, { level: { npcs: [post(20, 18)] } }), night = h.night;
  secs(h, 4); assert.equal(night.cast, 0);
  Object.assign(night.heists[2].npcs[0], { state: 'chase', target: 'p8', lastKnown: { x: 6.5, y: 25.5 }, seenAt: night.heists[2].now });
  secs(h, .5); assert.equal(night.cast, 0, 'never cut within five seconds');
  secs(h, 1); assert.equal(night.cast, 2, 'a chase takes the screen');
  const seen = new Set<number>(); let cuts = 0, last = night.cast, since = h.wall, shortest = Infinity;
  for (let i = 0; i < 30 * 60; i++) { h.step(); seen.add(night.cast); if (night.cast !== last) { shortest = Math.min(shortest, h.wall - since); since = h.wall; last = night.cast; cuts++; } }
  assert.deepEqual([...seen].sort(), [0, 1, 2]); assert.ok(shortest >= 4990 && cuts >= 4, `${cuts} cuts, shortest ${shortest} ms`);
  // A crew that just got away is shown; one that is finished is not returned to.
  getaway(night.heists[1]); secs(h, .2); assert.equal(night.cast, 1, 'a getaway cuts in at once'); secs(h, 4.5); assert.equal(night.cast, 1); secs(h, 8); assert.notEqual(night.cast, 1);
  assert.equal(heist(4).night.cast, 0);
});

test('a full room of sixteen bot crews: ticks, snapshots and the hiding rule hold at 64 thieves', () => {
  const choices = Array.from({ length: 64 }, (_, i) => botChoice(i % 4) as { role: Role; tool: Tool }), h = heist(64, { choices, seed: 11 }), night = h.night, bots = Array.from({ length: 64 }, (_, i) => crewBot(`p${i}`));
  const held: Record<string, { x: number; y: number; sneak: boolean }> = {}; let spent = 0, ticks = 0, largest = 0, own64 = 0, snapshots = 0, seenNpcs = 0;
  for (let t = 0; t < 30 * 45; t++) {
    if (t % 6 === 0) {
      const w = wire(h), cast = decode(w); largest = Math.max(largest, Buffer.byteLength(JSON.stringify({ ...w, base: undefined }))); snapshots++;
      for (let i = 0; i < 64; i++) {
        const mine = own(h, `p${i}`)!, view = ownView(w, mine, `p${i}`)!, state = night.heists[view.crew]; own64 = Math.max(own64, Buffer.byteLength(JSON.stringify(mine)));
        // Whatever a phone is sent about guards, its crew can see: every sent NPC is within sight range of one of its thieves.
        for (const n of view.npcs) { seenNpcs++; assert.ok(state.crew.some(p => !p.suspended && Math.hypot(p.x - n.x, p.y - n.y) <= 10.01), `crew ${view.crew} was sent a guard out of sight`); }
        const move = bots[i](view); held[`p${i}`] = rules.parseInput(move.input); if (move.tool) try { h.tool(`p${i}`); } catch { /* no charge */ }
      }
      if (t === 0) { assertSerializable(w); assert.equal(cast.crews.length, 16); assert.equal(w.board.length, 16); }
    }
    const at = performance.now(); h.step(held); spent += performance.now() - at; ticks++;
  }
  assert.ok(seenNpcs > 50, `${seenNpcs} guard sightings`); assert.ok(night.heists.some(s => s.collected > 0));
  assert.ok(largest < 4 * 1024, `largest public snapshot ${largest} bytes`); assert.ok(own64 < 3 * 1024, `largest private view ${own64} bytes`);
  assert.ok(Buffer.byteLength(JSON.stringify(wire(h).base)) < 8 * 1024, 'the roster, sent once, fits a message many times over');
  assert.ok(spent / ticks < 12, `average tick ${(spent / ticks).toFixed(2)} ms`);
  console.log(`# 64 thieves, 16 crews: tick avg ${(spent / ticks).toFixed(2)} ms, public max ${largest} B, private max ${own64} B over ${snapshots} snapshots`);
});
