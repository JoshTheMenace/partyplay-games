/* Big rooms (11–64 players): the bench, the Gallery's standing places, its twist, heckles, scoring and what travels on the wire. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MESSAGE_BYTES, MAX_ROOM_PLAYERS } from '../../../party-contract/src/index';
import { SnapshotDecoder, SnapshotEncoder } from '../../../party-contract/src/snapshot-cache';
import { manifest } from '../src/manifest';
import { rules, type State } from '../src/server';
import { CACHED, COUNSEL, SHOUTS, SIDES, TIMING, courtIdFor, defaults, isCrowd, opposite, roundCount, type PublicView, type Side } from '../src/types';
import { act, check, cues, finished, galleryOf, game, me, play, rejects, stock, tick, to, view } from './harness';

const lockAll = (s: State, at = s.now + 1) => { for (const side of SIDES) s.slots[side].forEach((_, slot) => act(s, s.teams[side][0], { kind: 'lock', slot, cardId: stock(s, side, s.slots[side][slot].kind).find(c => !s.slots[side].some(x => x.locked?.cardId === c.id))!.id, ...(s.phase === 'modifier' ? { target: { side, slot: 0 as const } } : {}) }, at)); };
const heads = (s: State, side: Side) => Object.values(s.stand).filter(x => x === side).length;

test('the manifest seats a full room and caches the heavy public fields', () => {
  assert.deepEqual(manifest.players, { min: 3, max: MAX_ROOM_PLAYERS });
  assert.deepEqual(manifest.snapshotCache, { revisionField: 'rev', fields: CACHED });
  assert.throws(() => rules.create({ roomId: 'r', roundId: 'r', nowMs: 0, seed: 1, players: Array.from({ length: 65 }, (_, i) => ({ id: `p${i}`, name: 'x', color: '#fff' })) }, defaults), /3–64/);
});

test('a crowd plays a set night and small rooms keep their laps', () => {
  assert.deepEqual([10, 11].map(isCrowd), [false, true]);
  for (const [n, auto] of [[11, 8], [32, 8], [56, 8], [57, 9], [63, 9], [64, 10]]) assert.deepEqual([roundCount(n, 'auto'), roundCount(n, 1), roundCount(n, 2)], [auto, 6, 12], `${n} players`);
  assert.deepEqual([roundCount(10, 'auto'), roundCount(10, 2), roundCount(4, 'auto')], [10, 20, 8]);
  assert.equal(game(10).crowd, false); assert.equal(view(game(10)).gallery, ''); assert.equal(game(11).crowd, true);
});

for (const n of [11, 32, 64]) test(`${n} players: a Conductor, two counsel teams of three, and everyone else in the Gallery`, () => {
  const s = game(n, {}, n), conductors: string[] = [];
  for (let r = 1; r <= s.rounds; r++) {
    to(s, 'deal', r);
    const cast = [s.conductor, ...s.teams.north, ...s.teams.south], v = view(s);
    assert.deepEqual([s.teams.north.length, s.teams.south.length, new Set(cast).size, galleryOf(s).length], [COUNSEL, COUNSEL, 7, n - 7]);
    assert.deepEqual([v.tracks.north.team, v.tracks.south.team, v.conductor], [s.teams.north, s.teams.south, s.conductor]);
    assert.equal(v.gallery, s.players.map(p => cast.includes(p.id) ? '-' : '?').join(''));
    // Counsel are always the seats that have sat on the bench least.
    const before = (id: string) => s.turns[id] - (cast.includes(id) ? 1 : 0), least = Math.min(...s.players.filter(p => p.id !== s.conductor).map(p => before(p.id)));
    assert.ok([...s.teams.north, ...s.teams.south].every(id => before(id) <= least + 1));
    conductors.push(s.conductor);
    assert.equal(me(s, s.conductor).role, 'conductor'); assert.equal(me(s, s.teams.south[2]).role, 'team'); assert.equal(me(s, galleryOf(s)[0]).role, 'gallery');
    for (const side of SIDES) assert.equal(s.hands[side].modifier.length, 3);
    check(s);
  }
  assert.equal(new Set(conductors).size, s.rounds, 'nobody conducts twice');
  if (s.rounds * 7 >= n) assert.ok(Object.values(s.turns).every(t => t >= 1), 'every seat reaches the bench');
  assert.ok(Math.max(...Object.values(s.turns)) - Math.min(...Object.values(s.turns)) <= 2);
});

test('the lever goes to whoever has died most and not conducted yet', () => {
  const s = game(20, {}, 3); to(s, 'crash');
  const first = s.conductor;
  s.players.forEach((p, i) => { p.deaths = i === 4 || i === 9 || p.id === first ? 7 : i % 3; });
  tick(s);
  assert.equal(s.round, 2); assert.ok(['p4', 'p9'].includes(s.conductor)); assert.notEqual(s.conductor, first);
  // Underdog counts counsel only: the Gallery plays no cards.
  const u = game(20, { catchUp: true }, 3); to(u, 'crash');
  u.players.forEach((p, i) => { p.deaths = i; }); tick(u);
  const counsel = [...u.teams.north, ...u.teams.south], top = Math.max(...counsel.map(id => Number(id.slice(1))));
  assert.deepEqual(u.underdogs, [`p${top}`]);
  assert.deepEqual(SIDES.map(side => u.hands[side].modifier.length), SIDES.map(side => u.teams[side].includes(`p${top}`) ? 6 : 3));
});

test('standing: Gallery only, live until the lever opens, then feet are glued', () => {
  const s = game(12, {}, 2), [a, b, c, d, e] = galleryOf(s), court = courtIdFor(1);
  rejects(s, () => act(s, a, { kind: 'stand', side: 'north', turnId: court }), /Wait for the tracks/);
  to(s, 'innocent');
  rejects(s, () => act(s, s.conductor, { kind: 'stand', side: 'north' }), /Only the Gallery/);
  rejects(s, () => act(s, s.teams.north[0], { kind: 'stand', side: 'south' }), /Only the Gallery/);
  rejects(s, () => act(s, a, { kind: 'stand', side: 'north', turnId: courtIdFor(2) }), /Too late/);
  assert.throws(() => rules.parseAction({ kind: 'stand', turnId: 't', side: 'east' })); assert.throws(() => rules.parseAction({ kind: 'stand', turnId: 't', side: 'north', slot: 0 }));
  const rev = s.rev;
  act(s, a, { kind: 'stand', side: 'north' }); act(s, b, { kind: 'stand', side: 'north', turnId: court }); act(s, c, { kind: 'stand', side: 'north' });
  assert.deepEqual([me(s, a).side, me(s, d).side, s.rev], ['north', null, rev]);
  const seat = (id: string) => view(s).gallery[Number(id.slice(1))];
  assert.deepEqual([a, d, s.conductor, s.teams.south[0]].map(seat), ['n', '?', '-', '-']);
  to(s, 'plead'); act(s, a, { kind: 'stand', side: 'south', turnId: court }); assert.equal(seat(a), 's'); act(s, a, { kind: 'stand', side: 'north' }); assert.equal(seat(a), 'n');
  tick(s); tick(s); assert.equal(s.phase, 'lever');
  // d and e never chose: the Clerk shoves them onto the emptier track.
  assert.deepEqual([s.stand[d], s.stand[e]], ['south', 'south']); assert.deepEqual(s.jury.shoved.sort(), [d, e].sort());
  assert.deepEqual([me(s, d).jury!.shoved, me(s, a).jury!.shoved], [true, false]); assert.equal(view(s).gallery.includes('?'), false);
  assert.equal(cues(s, 'line').at(-1), 'gallery.glue');
  rejects(s, () => act(s, a, { kind: 'stand', side: 'north', turnId: court }), /glued/);
  check(s);
  // Everyone on the struck track dies: counsel and the Gallery standing there. Everyone else but the Conductor is spared.
  const pulled = s.defaultSide === 'north', struck = 'south';
  act(s, s.conductor, { kind: 'decide', pull: pulled });
  assert.equal(s.struck, struck);
  const dead = [...s.teams.south, d, e].sort(), row = s.history[0];
  assert.deepEqual(s.players.filter(p => p.deaths).map(p => p.id).sort(), dead); assert.deepEqual(row.victims.map(i => `p${i}`).sort(), dead);
  assert.deepEqual(s.players.filter(p => p.spared).map(p => p.id).sort(), [...s.teams.north, a, b, c].sort());
  assert.deepEqual(s.players.find(p => p.id === s.conductor), { id: s.conductor, name: `Player ${s.conductor.slice(1)}`, color: '#ff5748', connected: true, deaths: 0, spared: 0, conducted: 1 });
  tick(s); assert.deepEqual(s.stand, {}); assert.deepEqual(s.jury.shoved, []);
});

test('a Gallery that never moves is split evenly by the Clerk', () => {
  for (const n of [11, 32, 64]) {
    const s = game(n, {}, n + 1); to(s, 'lever');
    assert.ok(Math.abs(heads(s, 'north') - heads(s, 'south')) <= 1); assert.equal(heads(s, 'north') + heads(s, 'south'), n - 7);
    assert.equal(s.jury.shoved.length, n - 7);
  }
});

test('the Gallery votes in one twist and aims it; counsel never see the ballot', () => {
  const s = game(13, {}, 5), g = galleryOf(s);
  assert.equal(s.jury.options.length, 3); assert.ok(s.jury.options.every(c => c.kind === 'modifier' && !c.blank));
  assert.deepEqual(me(s, g[0]).jury, { options: [], vote: null, tally: [], card: null, aim: null, aims: [], shoved: false });
  rejects(s, () => act(s, g[0], { kind: 'vote', cardId: s.jury.options[0].id }), /isn’t voting/);
  to(s, 'guilty');
  const [x, y, z] = s.jury.options;
  assert.deepEqual(me(s, g[0]).jury!.options, [x, y, z]); assert.equal(view(s).ballots, 0); assert.deepEqual(cues(s, 'line').slice(-2), ['pick.guilty', 'gallery.vote']);
  rejects(s, () => act(s, s.teams.north[0], { kind: 'vote', cardId: x.id }), /Only the Gallery/);
  rejects(s, () => act(s, s.conductor, { kind: 'vote', cardId: x.id }), /Only the Gallery/);
  rejects(s, () => act(s, g[0], { kind: 'vote', cardId: stock(s, 'north', 'modifier')[0].id }), /isn’t on the ballot/);
  rejects(s, () => act(s, g[0], { kind: 'aim', target: { side: 'north', slot: 0 } }), /isn’t aiming/);
  const rev = s.rev;
  act(s, g[0], { kind: 'vote', cardId: x.id }); act(s, g[1], { kind: 'vote', cardId: y.id }); act(s, g[2], { kind: 'vote', cardId: y.id }); act(s, g[0], { kind: 'vote', cardId: z.id }); act(s, g[3], { kind: 'vote', cardId: z.id }); act(s, g[4], { kind: 'vote', cardId: z.id });
  assert.deepEqual([me(s, g[0]).jury!.vote, me(s, g[0]).jury!.tally, view(s).ballots, s.rev], [z.id, [0, 2, 3], 5, rev]);
  check(s);
  // Counsel locking early never cuts the ballot short: the pick stays open for juryMs.
  lockAll(s, s.startedAt + 1000); assert.equal(s.deadline, s.startedAt + TIMING.juryMs);
  to(s, 'guiltyReveal');
  assert.deepEqual(s.jury.card, z); assert.deepEqual(me(s, g[5]).jury!.card, z); assert.deepEqual(me(s, g[5]).jury!.options, []);
  rejects(s, () => act(s, g[0], { kind: 'vote', cardId: x.id }), /isn’t voting/);
  check(s);
  to(s, 'modifier');
  assert.deepEqual(cues(s, 'line').slice(-2), ['pick.modifier', 'gallery.aim']);
  act(s, g[0], { kind: 'aim', target: { side: 'south', slot: 2 } }); act(s, g[1], { kind: 'aim', target: { side: 'south', slot: 2 } }); act(s, g[2], { kind: 'aim', target: { side: 'north', slot: 1 } }); act(s, g[2], { kind: 'aim', target: { side: 'north', slot: 0 } });
  assert.deepEqual(me(s, g[2]).jury, { options: [], vote: null, tally: [], card: z, aim: { side: 'north', slot: 0 }, aims: [1, 0, 0, 0, 0, 2], shoved: false });
  assert.equal(view(s).ballots, 3); check(s);
  lockAll(s, s.startedAt + 2000); assert.equal(s.deadline, s.startedAt + TIMING.juryMs);
  to(s, 'modifierReveal');
  // One twist a team, then the Gallery's, last.
  assert.deepEqual(s.queue.map(q => q.placed.from), ['north', 'south', 'gallery']); assert.deepEqual(s.queue[2], { target: { side: 'south', slot: 2 }, placed: { card: z, from: 'gallery' }, mod: true });
  assert.ok(!cues(s, 'sfx').includes('timeup'));
  tick(s); tick(s); assert.deepEqual(me(s, g[0]).jury!.card, z); check(s);
  tick(s); assert.deepEqual(s.tracks.south.slots[2]!.mods.at(-1), { card: z, from: 'gallery' }); assert.deepEqual(s.spotlight, { side: 'south', slot: 2, mod: s.tracks.south.slots[2]!.mods.length - 1 });
  assert.equal(me(s, g[0]).jury!.card, null); check(s);
});

test('with no Gallery votes the Clerk picks its twist and marks it auto', () => {
  const s = game(11, {}, 8); to(s, 'modifierReveal');
  const last = s.queue.at(-1)!;
  assert.ok(s.jury.options.some(c => c.id === last.placed.card.id)); assert.deepEqual([last.placed.from, last.placed.auto, last.mod], ['gallery', true, true]);
  assert.equal(s.steps, 1 + s.queue.length); assert.equal(s.queue.length, 3);
  // Ties go by lot, but always to one of the tied options.
  for (let seed = 1; seed < 12; seed++) {
    const t = game(11, {}, seed), g = galleryOf(t); to(t, 'guilty');
    act(t, g[0], { kind: 'vote', cardId: t.jury.options[0].id }); act(t, g[1], { kind: 'vote', cardId: t.jury.options[2].id });
    to(t, 'guiltyReveal'); assert.ok([t.jury.options[0].id, t.jury.options[2].id].includes(t.jury.card!.id));
  }
});

test('heckles: anyone but the Conductor, during the pleas and the decision, one at a time', () => {
  assert.throws(() => rules.parseAction({ kind: 'shout', turnId: 't', shout: 'yell' })); assert.deepEqual(rules.parseAction({ kind: 'shout', turnId: 't', shout: 'mercy' }), { kind: 'shout', turnId: 't', shout: 'mercy' });
  const s = game(12, {}, 4), g = galleryOf(s);
  to(s, 'modifier'); rejects(s, () => act(s, g[0], { kind: 'shout', shout: 'boo' }), /Wait for the pleas/);
  to(s, 'plead');
  rejects(s, () => act(s, s.conductor, { kind: 'shout', shout: 'boo' }), /above it/);
  const rev = s.rev, t = s.now;
  act(s, g[0], { kind: 'shout', shout: 'objection' }, t + 10); act(s, s.teams.north[1], { kind: 'shout', shout: 'hear', turnId: courtIdFor(1) }, t + 20);
  rejects(s, () => act(s, g[0], { kind: 'shout', shout: 'boo' }, t + 10 + TIMING.shoutMs - 1), /One at a time/);
  act(s, g[0], { kind: 'shout', shout: 'boo' }, t + 10 + TIMING.shoutMs);
  const seat = (id: string) => Number(id.slice(1));
  assert.deepEqual(view(s).shouts, [[1, seat(g[0]), SHOUTS.indexOf('objection')], [2, seat(s.teams.north[1]), 0], [3, seat(g[0]), SHOUTS.indexOf('boo')]]);
  assert.equal(s.rev, rev);
  for (let i = 0; i < 12; i++) act(s, g[1 + i % 4], { kind: 'shout', shout: 'mercy' }, s.now + TIMING.shoutMs);
  assert.equal(view(s).shouts.length, 8); assert.deepEqual(view(s).shouts.map(x => x[0]), [8, 9, 10, 11, 12, 13, 14, 15]);
  to(s, 'lever'); act(s, g[2], { kind: 'shout', shout: 'hear' }, s.now + TIMING.shoutMs);
  to(s, 'crash'); rejects(s, () => act(s, g[2], { kind: 'shout', shout: 'hear' }, s.now + TIMING.shoutMs), /Wait for the pleas/);
  // Small rooms heckle too.
  const small = game(4); to(small, 'plead'); act(small, 'p3', { kind: 'shout', shout: 'objection' });
  assert.deepEqual(view(small).shouts, [[1, 3, 1]]); rejects(small, () => act(small, 'p0', { kind: 'shout', shout: 'boo' }), /above it/);
});

/** Replays a game through the room's own snapshot cache: what a phone decodes must equal the full view at every step. */
function wire(n: number, seed: number) {
  const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder(), policy = manifest.snapshotCache;
  let revision = 0, full = 0, light = 0, sends = 0, resends = 0, privateMax = 0, last = -1;
  const { s } = play(n, {}, seed, true, s => {
    const v = view(s), encoded = encoder.encode('round', v, policy), decoded = decoder.decode({ roundId: 'round', revision: ++revision, serverTime: s.now, privateView: null, ...encoded }, policy);
    assert.deepEqual(decoded?.publicView, v);
    const bytes = JSON.stringify(encoded).length; sends++; if (encoded.publicCache!.reused) light = Math.max(light, bytes); else { full = Math.max(full, bytes); resends++; }
    assert.ok(v.rev >= last); last = v.rev;
    for (const p of s.players) privateMax = Math.max(privateMax, JSON.stringify(me(s, p.id)).length);
  });
  return { s, full, light, sends, resends, privateMax };
}

test('the cached fields always arrive: a decoded snapshot equals the full view through whole games', () => {
  for (const [n, seed] of [[4, 3], [12, 6]]) { const { s, sends, resends } = wire(n, seed); finished(s, n); assert.ok(resends < sends / 3, `${n}: ${resends}/${sends} full sends`); }
});

test('64 players: a full night stays far inside the message cap and the per-tick part stays small', () => {
  const { s, full, light, sends, resends, privateMax } = wire(64, 9);
  finished(s, 64); assert.equal(s.history.length, 10);
  assert.ok(full < MAX_MESSAGE_BYTES / 2, `largest full snapshot ${full} B`); assert.ok(light < 1200, `largest light snapshot ${light} B`); assert.ok(privateMax < 2500, `largest private view ${privateMax} B`);
  assert.ok(resends < sends / 4, `${resends}/${sends} full sends`);
  // The same night with the room's real ids (UUIDs) and 16-character names still fits one message with room to spare.
  const long = rules.create({ roomId: 'r', roundId: 'r', nowMs: 0, seed: 2, players: Array.from({ length: 64 }, (_, i) => ({ id: `0f8fad5b-d9cb-469f-a165-7086768814${String(i).padStart(2, '0')}`, name: `Wilhelmina Wob${String(i).padStart(2, '0')}`.slice(0, 16), color: 'hsl(123 70% 60%)' })) }, defaults);
  long.round = long.rounds - 1; long.history = Array.from({ length: 9 }, (_, r) => ({ round: r + 1, conductor: long.players[r].id, defaultSide: 'north' as const, pulled: true, timedOut: false, struck: 'south' as const, victims: Array.from({ length: 60 }, (_, i) => i) }));
  to(long, 'lever', long.rounds); act(long, long.conductor, { kind: 'decide', pull: true });
  for (const p of long.players) p.deaths = 3;
  tick(long); assert.equal(long.phase, 'complete');
  const size = JSON.stringify({ publicView: view(long), outcome: rules.outcome(long) }).length;
  assert.equal(view(long).winners.length, 64); assert.ok(size < MAX_MESSAGE_BYTES, `results snapshot ${size} B`);
});

for (const [n, seed] of [[11, 2], [32, 7], [64, 12]]) test(`bots play a full ${n}-player night to an outcome`, () => {
  const stats = { hops: 0, last: '' };
  const { s, accepted, rejected } = play(n, {}, seed, true, s => { const v: PublicView = view(s); if (stats.last && v.phase === 'plead' && v.gallery !== stats.last) stats.hops++; stats.last = v.gallery; });
  assert.deepEqual(rejected, []); assert.ok(accepted > 0); finished(s, n);
  assert.ok(stats.hops > 0, 'somebody hopped'); assert.ok(s.history.some(h => h.victims.length > COUNSEL), 'the Gallery died too');
  for (const h of s.history) assert.ok(h.victims.length >= COUNSEL && h.victims.length <= n - 1 - COUNSEL);
  assert.equal(rules.outcome(s).rows.length, n);
});

test('a 32-player night with no input at all still completes: the Clerk picks, shoves and the lever stays put', () => {
  const { s, accepted } = play(32, { pickSeconds: 30, modifierSeconds: 45, floorSeconds: 30, leverSeconds: 15, accomplices: true, catchUp: true }, 3, false);
  assert.equal(accepted, 0); finished(s, 32);
  assert.ok(s.history.every(h => h.timedOut && !h.pulled && h.struck === h.defaultSide && Math.abs(h.victims.length - 15.5) <= 1));
});

test('a disconnected Gallery seat keeps its place and still scores', () => {
  const s = game(11, {}, 6), [a, b] = galleryOf(s); to(s, 'innocent');
  act(s, a, { kind: 'stand', side: 'north' }); rules.onPresenceChange(s, a, false, s.now + 1); rules.onPresenceChange(s, b, false, s.now + 1);
  to(s, 'lever'); assert.equal(s.stand[a], 'north'); assert.ok(s.stand[b]);
  act(s, s.conductor, { kind: 'decide', pull: s.defaultSide !== 'north' });
  assert.equal(s.players.find(p => p.id === a)!.deaths, 1); assert.equal(s.players.find(p => p.id === b)!.deaths, s.stand[b] === 'north' ? 1 : 0);
  assert.equal(opposite(s.struck!), 'south');
});
