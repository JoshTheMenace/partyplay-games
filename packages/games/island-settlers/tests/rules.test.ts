import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules, longestRoute, type State } from '../src/server';
import { RESOURCES, emptyHand, COSTS, type Action, type Hand, type Settings } from '../src/model';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { chooseAction } from './bot';

const ctx = { nowMs: 0, phase: 'playing' as const };
function game(count = 4, settings: Partial<Settings> = {}, seed = 42) { return rules.create({ players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player000000000${i}`, color: '#ff5748' })), seed, nowMs: 0, roomId: 'test', roundId: 'round' }, rules.validateSettings(settings)); }
function act(s: State, id: string, action: Omit<Action, 'turnId'> | Record<string, unknown>, now = 0) { rules.applyAction(s, id, rules.parseAction({ ...action, turnId: s.turnId }), now); }
function view(s: State, id = s.actorId) { return rules.playerView(s, id, ctx); }
function setup(s: State) {
  let steps = 0;
  while (s.phase === 'setup') { const v = view(s), kind = v.legal.settlements.length ? 'settlement' : 'road', target = (kind === 'settlement' ? v.legal.settlements : v.legal.roads)[0]; assert.ok(target); act(s, s.actorId, { type: 'build', kind, target }); assert.ok(++steps <= 40); }
}
function actionState(count = 4, settings: Partial<Settings> = {}) { const s = game(count, settings); setup(s); s.phase = 'action'; s.revision++; return s; }
function grant(s: State, id: string, cards: Hand) { const p = s.players.find(p => p.id === id)!; for (const r of RESOURCES) { assert.ok(s.bank[r] >= cards[r]); p.hand[r] += cards[r]; s.bank[r] -= cards[r]; } s.revision++; }
function resources(s: State) { return RESOURCES.map(r => s.bank[r] + s.players.reduce((n, p) => n + p.hand[r], 0)); }
function unchanged(s: State, action: () => void) { const before = structuredClone(s); assert.throws(action); assert.deepEqual(s, before); }

for (const count of [3, 4, 5, 6, 7, 8, 9, 10]) for (const expansion of ['base', 'seafarers'] as const) for (const mode of ['standard', 'connect'] as const) test(`${count} players: ${expansion}/${mode} setup, geometry and transport`, () => {
  const s = game(count, { expansion, mode }); const expected = resources(s);
  assert.deepEqual(s, game(count, { expansion, mode }));
  assert.equal(new Set(s.board.vertices.map(v => `${v.x}:${v.y}`)).size, s.board.vertices.length);
  assert.equal(new Set(s.board.edges.map(e => [e.a, e.b].sort().join(':'))).size, s.board.edges.length);
  for (const e of s.board.edges) { assert.ok(e.tiles.length <= 2); assert.ok(s.board.vertices.some(v => v.id === e.a && v.edges.includes(e.id))); }
  const productive = s.board.tiles.filter(t => t.number);
  for (const t of productive.filter(t => [6, 8].includes(t.number))) for (const other of productive.filter(o => o !== t && [6, 8].includes(o.number))) assert.ok(Math.hypot(t.x - other.x, t.y - other.y) > 1.8);
  setup(s); assert.equal(s.buildings.length, count * 2); assert.equal(s.routes.length, count * 2); assert.deepEqual(resources(s), expected);
  assertSerializable(rules.publicView(s, ctx)); for (const p of s.players) assertSerializable(view(s, p.id)); assertSerializable(rules.outcome(s));
  for (const p of s.players) { assert.equal(s.buildings.filter(b => b.playerId === p.id).length, 2); assert.equal(p.turns, mode === 'connect' || p.id === 'p0' ? 1 : 0); }
});

test('snake setup locks settlement before its adjacent route, rejects stale and illegal placement atomically', () => {
  const s = game(), target = view(s).legal.settlements[0], stale = s.turnId;
  act(s, 'p0', { type: 'build', kind: 'settlement', target });
  unchanged(s, () => rules.applyAction(s, 'p0', { turnId: stale, type: 'build', kind: 'road', target: view(s).legal.roads[0] }, 0));
  unchanged(s, () => act(s, 'p0', { type: 'build', kind: 'settlement', target }));
  unchanged(s, () => act(s, 'p1', { type: 'build', kind: 'road', target: view(s).legal.roads[0] }));
  setup(s); assert.equal(s.actorId, 'p0');
});
test('server projections omit every opponent hand, deck and RNG; private scores stay private', () => {
  const s = actionState(); s.players[1].development.push({ id: 'secret-card', kind: 'victory', bought: 0 }); s.revision++;
  const pub = rules.publicView(s, ctx), priv = view(s, 'p0');
  assert.equal(pub.players[1].score, 2); assert.equal(view(s, 'p1').score, 3);
  const text = JSON.stringify({ pub, priv }); assert.ok(!text.includes('secret-card')); assert.ok(!text.includes('"random"')); assert.ok(!text.includes('"deck"'));
});
test('paid builds conserve resources; duplicate placements cannot spend twice', () => {
  const s = actionState(), before = resources(s); grant(s, 'p0', COSTS.road);
  const target = view(s).legal.roads[0]; act(s, 'p0', { type: 'build', kind: 'road', target });
  unchanged(s, () => act(s, 'p0', { type: 'build', kind: 'road', target })); assert.deepEqual(resources(s), before);
});
test('standard pairing visits the opposite player without player trading, then next primary rolls', () => {
  const s = actionState(10); act(s, 'p0', { type: 'end' }); assert.equal(s.actorId, 'p5'); assert.equal(s.secondary, true); assert.equal(view(s).canTrade, false);
  act(s, 'p5', { type: 'end' }); assert.equal(s.actorId, 'p1'); assert.equal(s.phase, 'roll'); assert.equal(s.secondary, false);
});
test('trade offers support off-turn proposals, select one acceptor, and reject unauthorized or repeated execution', () => {
  const s = actionState(), before = resources(s); grant(s, 'p1', { ...emptyHand(), wood: 2 }); grant(s, 'p0', { ...emptyHand(), ore: 2 });
  act(s, 'p1', { type: 'offer', give: { ...emptyHand(), wood: 1 }, get: { ...emptyHand(), ore: 1 } }); const offerId = s.offers[0].id;
  unchanged(s, () => act(s, 'p2', { type: 'accept-offer', offerId }));
  act(s, 'p0', { type: 'accept-offer', offerId });
  unchanged(s, () => act(s, 'p0', { type: 'complete-offer', offerId, partner: 'p1' }));
  act(s, 'p1', { type: 'complete-offer', offerId, partner: 'p0' });
  unchanged(s, () => act(s, 'p1', { type: 'complete-offer', offerId, partner: 'p0' })); assert.deepEqual(resources(s), before);
});
test('failed trades, forged card counts, development IDs and bank depletion are atomic', () => {
  const s = actionState(); s.bank.ore = 0; s.revision++;
  unchanged(s, () => act(s, 'p0', { type: 'bank', give: 'wood', get: 'ore' }));
  unchanged(s, () => act(s, 'p0', { type: 'play-development', cardId: 'not-owned' }));
  assert.throws(() => rules.parseAction({ type: 'discard', turnId: s.turnId, cards: { ...emptyHand(), wood: -1 } }));
  assert.throws(() => rules.parseAction({ type: 'gold', turnId: s.turnId, cards: { ...emptyHand(), unknown: 1 } }));
  unchanged(s, () => act(s, 'p0', { type: 'offer', give: emptyHand(), get: { ...emptyHand(), ore: 1 } }));
});
test('seven requires exact private discards before robber selection and theft', () => {
  const s = actionState(); grant(s, 'p0', { ...emptyHand(), wood: 10 }); s.phase = 'discard'; s.players[0].discardDue = Math.floor(RESOURCES.reduce((n, r) => n + s.players[0].hand[r], 0) / 2); s.revision++;
  unchanged(s, () => act(s, 'p0', { type: 'bank', give: 'wood', get: 'ore' }));
  unchanged(s, () => act(s, 'p0', { type: 'discard', cards: emptyHand() }));
  act(s, 'p0', { type: 'discard', cards: { ...emptyHand(), wood: s.players[0].discardDue } }); assert.equal(s.phase, 'robber');
  const target = view(s).legal.robber.find(id => view(s).legal.victims[id].length)!; assert.ok(target);
  const before = resources(s); act(s, 'p0', { type: 'robber', target, victim: view(s).legal.victims[target][0], pirate: false }); assert.equal(s.phase, 'action'); assert.deepEqual(resources(s), before);
});
test('Knight before rolling preserves roll and does not discard; once per turn and purchase delay enforced', () => {
  const s = actionState(); s.phase = 'roll'; s.players[0].development = [{ id: 'k', kind: 'knight', bought: 0 }, { id: 'new', kind: 'monopoly', bought: 1 }]; s.revision++;
  unchanged(s, () => act(s, 'p0', { type: 'play-development', cardId: 'new', resource: 'wood' }));
  act(s, 'p0', { type: 'play-development', cardId: 'k' }); assert.equal(s.phase, 'robber'); assert.ok(s.players.every(p => p.discardDue === 0));
  const target = view(s).legal.robber[0]; act(s, 'p0', { type: 'robber', target, victim: view(s).legal.victims[target][0] ?? null, pirate: false }); assert.equal(s.phase, 'roll');
  assert.equal(view(s).development[0].playable, false);
});
test('Road Building supplies up to two free roads or ships without consuming resources', () => {
  const s = actionState(); s.players[0].development = [{ id: 'r', kind: 'road-building', bought: 0 }]; s.revision++;
  const before = structuredClone(s.players[0].hand); act(s, 'p0', { type: 'play-development', cardId: 'r' });
  for (let i = 0; i < 2; i++) act(s, 'p0', { type: 'build', kind: 'road', target: view(s).legal.roads[0] });
  assert.equal(s.players[0].freeRoutes, 0); assert.deepEqual(s.players[0].hand, before);
});
test('pre-roll Road Building resolves only free routes, then preserves the dice roll', () => {
  const s = actionState(); s.phase = 'roll'; s.players[0].development = [{ id: 'r', kind: 'road-building', bought: 0 }]; s.revision++;
  act(s, 'p0', { type: 'play-development', cardId: 'r' });
  assert.equal(view(s).canRoll, false); assert.equal(view(s).canAct, true);
  assert.deepEqual(view(s).legal.cities, []); assert.deepEqual(view(s).legal.settlements, []);
  unchanged(s, () => act(s, 'p0', { type: 'roll' }));
  unchanged(s, () => act(s, 'p0', { type: 'buy-development' }));
  act(s, 'p0', { type: 'build', kind: 'road', target: view(s).legal.roads[0] });
  act(s, 'p0', { type: 'end' });
  assert.equal(s.phase, 'roll'); assert.equal(s.actorId, 'p0'); assert.equal(view(s).canRoll, true);
});
test('private bank availability guides scarce gold and Year of Plenty choices', () => {
  const s = actionState(); s.bank = { ...emptyHand(), ore: 1 }; s.phase = 'gold'; s.players[0].goldDue = 2; s.revision++;
  assert.equal(view(s).goldDue, 1); assert.equal(view(s).bank.ore, 1);
  act(s, 'p0', { type: 'gold', cards: { ...emptyHand(), ore: 1 } }); assert.equal(s.phase, 'action');
  s.players[0].development = [{ id: 'p', kind: 'plenty', bought: 0 }]; s.revision++;
  act(s, 'p0', { type: 'play-development', cardId: 'p', cards: emptyHand() });
  assert.equal(s.players[0].development.length, 0);
});
test('Connect waits for all ready with a readable minimum; deadline closes action acceptance', () => {
  const s = actionState(10, { mode: 'connect' }); s.deadline = 90000; s.actionStarted = 0;
  for (const p of s.players) act(s, p.id, { type: 'end' });
  rules.tick(s, new Map(), .1, 2999); assert.equal(s.turn, 1);
  rules.tick(s, new Map(), .1, 3000); assert.equal(s.turn, 2);
  s.phase = 'action'; s.deadline = 4000; s.revision++;
  unchanged(s, () => act(s, s.actorId, { type: 'end' }, 4000)); rules.tick(s, new Map(), .1, 4000); assert.equal(s.turn, 3);
});
test('Connect awards simultaneous equal winners only at round boundary', () => {
  const s = actionState(4, { mode: 'connect', targetPoints: 10 });
  for (const p of s.players.slice(0, 2)) p.development = Array.from({ length: 8 }, (_, i) => ({ id: `${p.id}-${i}`, kind: 'victory', bought: 0 }));
  s.deadline = 1000; s.revision++; assert.equal(rules.outcome(s).complete, false);
  rules.tick(s, new Map(), .1, 1000); assert.deepEqual(s.winners, ['p0', 'p1']); assert.equal(rules.outcome(s).complete, true);
});
test('phone disconnect pauses actions and preserves remaining Connect time through multiple disconnects', () => {
  const s = actionState(10, { mode: 'connect' }); s.deadline = 90000;
  rules.onPresenceChange(s, 'p1', false, 10000); rules.onPresenceChange(s, 'p2', false, 20000);
  unchanged(s, () => act(s, 'p0', { type: 'end' }, 30000)); rules.tick(s, new Map(), .1, 100000); assert.equal(s.turn, 1);
  rules.onPresenceChange(s, 'p1', true, 100000); assert.equal(s.deadline, 90000);
  rules.onPresenceChange(s, 'p2', true, 110000); assert.equal(s.deadline, 190000); assert.deepEqual(rules.publicView(s, ctx).pausedPlayers, []);
});
test('Longest Route counts loops once and requires a building to join ship and road', () => {
  const s = game(), tile = s.board.tiles.find(t => t.terrain !== 'sea')!, ring = s.board.edges.filter(e => e.tiles.includes(tile.id));
  s.routes = ring.map(e => ({ edge: e.id, playerId: 'p0', kind: 'road' })); assert.equal(longestRoute(s, 'p0'), 6);
  s.routes = [{ edge: ring[0].id, playerId: 'p0', kind: 'road' }, { edge: ring[1].id, playerId: 'p0', kind: 'ship' }]; assert.equal(longestRoute(s, 'p0'), 1);
  const common = [ring[0].a, ring[0].b].find(id => [ring[1].a, ring[1].b].includes(id))!;
  s.buildings = [{ vertex: common, playerId: 'p0', kind: 'settlement' }]; assert.equal(longestRoute(s, 'p0'), 2);
  s.buildings[0].playerId = 'p1'; assert.equal(longestRoute(s, 'p0'), 1);
});

test('Seafarers builds coastal ships, moves only an old open ship, and blocks pirate edges', () => {
  const s = game(4), p = s.players[0]; s.phase = 'action'; p.turns = 1; s.pirate = null;
  const coast = s.board.edges.find(e => e.sea && e.land && !e.tiles.includes(s.pirate!))!;
  s.buildings = [{ vertex: coast.a, kind: 'settlement', playerId: p.id }]; grant(s, p.id, { ...emptyHand(), wood: 4, wool: 4 });
  assert.ok(view(s).legal.ships.includes(coast.id)); act(s, p.id, { type: 'build', kind: 'ship', target: coast.id });
  assert.equal(view(s).legal.shipMoves.length, 0);
  s.players[0].builtShips = []; s.revision++;
  const move = view(s).legal.shipMoves.find(m => m.from === coast.id)!; assert.ok(move);
  act(s, p.id, { type: 'move-ship', from: move.from, to: move.to[0] }); assert.equal(view(s).legal.shipMoves.length, 0);
  s.pirate = s.board.tiles.find(t => t.terrain === 'sea' && s.board.edges.some(e => e.tiles.includes(t.id) && view(s).legal.ships.includes(e.id)))!.id; s.revision++;
  for (const id of view(s).legal.ships) assert.ok(!s.board.edges.find(e => e.id === id)!.tiles.includes(s.pirate));
});

test('new islands award points once; gold choice and bank shortages cannot create resources', () => {
  const s = game(), p = s.players[0]; s.phase = 'action'; p.turns = 1;
  const tile = s.board.tiles.find(t => t.island === 1)!, v = s.board.vertices.find(v => v.tiles.includes(tile.id))!;
  s.routes = [{ edge: v.edges[0], playerId: p.id, kind: 'ship' }]; grant(s, p.id, COSTS.settlement);
  act(s, p.id, { type: 'build', kind: 'settlement', target: v.id }); assert.equal(view(s).score, 3); assert.deepEqual(s.players[0].islands, [1]);
  s.phase = 'gold'; s.players[0].goldDue = 2; s.revision++; const before = resources(s);
  unchanged(s, () => act(s, 'p0', { type: 'gold', cards: { ...emptyHand(), wood: 3 } }));
  act(s, 'p0', { type: 'gold', cards: { ...emptyHand(), wood: 1, ore: 1 } }); assert.equal(s.phase, 'action'); assert.deepEqual(resources(s), before);
});

for (const mode of ['standard', 'connect'] as const) test(`ten-player ${mode}: complete seeded match from legal views, conserve all resources, replay fresh`, () => {
  const s = game(10, { mode, targetPoints: 10 }), expected = resources(s); let now = 0, accepted = 0, rejected = 0;
  for (let step = 0; step < 15000 && s.phase !== 'ended'; step++) {
    const pub = rules.publicView(s, ctx); let acted = false;
    for (const p of s.players) {
      const action = chooseAction(pub, view(s, p.id), p.id); if (!action) continue;
      try { rules.applyAction(s, p.id, action, now); accepted++; }
      catch { rejected++; if (view(s, p.id).canEnd) act(s, p.id, { type: 'end' }, now); else throw new Error(`Unresolved ${s.phase} action ${JSON.stringify(action)}`); }
      acted = true; break;
    }
    now += acted ? 20 : 3100; rules.tick(s, new Map(), .1, now);
    assert.deepEqual(resources(s), expected);
  }
  assert.equal(s.phase, 'ended', `Unfinished after ${s.turn} turns, scores ${s.players.map(p => view(s, p.id).score)}`);
  assert.ok(accepted > 100); assert.ok(s.winners.length); assertSerializable(rules.outcome(s));
  const replay = game(10, { mode }); assert.equal(replay.phase, 'setup'); assert.equal(replay.routes.length, 0); assert.equal(replay.offers.length, 0);
  console.log(`${mode} legal-view QA: ${s.turn} turns, ${accepted} accepted, ${rejected} bank-stock races/rejections`);
});
