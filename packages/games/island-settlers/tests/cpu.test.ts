import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '../src/server';
import { chooseExpansionAction } from '../src/cpu';
import { RESOURCES, type Settings } from '../src/model';
import { assertSerializable } from '../../../party-contract/src/serializable';
const context = (count = 1) => ({ roomId: 'cpu-room', roundId: 'cpu-round', seed: 42, nowMs: 0, players: Array.from({ length: count }, (_, i) => ({ id: `human-${i}`, name: `Human ${i}`, color: '#ff5748' })) });
const game = (settings: Partial<Settings> = {}, count = 1) => rules.create(context(count), rules.validateSettings(settings));
const viewContext = { nowMs: 0, phase: 'playing' as const };
test('CPU fill is capped at ten, keeps human identities, and sizes supplies for the entire table', () => {
  for (const count of [1, 2, 3, 6, 10]) for (const tableSize of [3, 6, 10]) {
    const s = game({ tableSize }, count), total = Math.max(count, tableSize);
    assert.equal(s.players.length, total); assert.equal(s.players.filter(p => p.cpu).length, total - count);
    assert.deepEqual(s.players.filter(p => !p.cpu).map(p => p.id), context(count).players.map(p => p.id));
    const humans = game({ tableSize }, total); assert.deepEqual(s.board, humans.board); assert.deepEqual(s.bank, humans.bank);
    const pub = rules.publicView(s, viewContext); assertSerializable(pub); assertSerializable(rules.playerView(s, 'human-0', viewContext));
    assert.ok(pub.players.every(p => !('hand' in p))); assert.equal(new Set(s.players.map(p => p.id)).size, total);
  }
  for (const tableSize of [0, 2, 11, 3.5, '4', null]) assert.throws(() => rules.validateSettings({ tableSize }));
});
test('CPUs wait for humans, pace one action per tick, and stop while a human is disconnected', () => {
  const s = game({ tableSize: 10 }); rules.tick(s, new Map(), .1, 1000); assert.equal(s.buildings.length, 0);
  while (s.actorId === 'human-0') rules.applyAction(s, 'human-0', chooseExpansionAction(rules.publicView(s, viewContext), rules.playerView(s, 'human-0', viewContext), 'human-0')!, 1000);
  rules.tick(s, new Map(), .1, 2000); assert.equal(s.buildings.length, 2); assert.equal(s.routes.length, 1);
  const before = structuredClone(s); rules.tick(s, new Map(), .1, 2000); assert.deepEqual(s, before);
  rules.onPresenceChange(s, 'human-0', false, 2100); const disconnected = structuredClone(s); rules.tick(s, new Map(), .1, 10000); assert.deepEqual(s, disconnected);
  rules.onPresenceChange(s, 'cpu:1', false, 11000); assert.equal(s.players.find(p => p.cpu)!.connected, true);
  rules.onPresenceChange(s, 'human-0', true, 12000); rules.tick(s, new Map(), .1, 12000); assert.ok(s.routes.length > before.routes.length);
});
test('CPU offers require affordability, usefulness and fair value; already accepted offers are not repeated', () => {
  const s = game({ expansion: 'base' }), cpu = s.players.find(p => p.cpu)!; s.phase = 'action'; s.turnId++; s.revision++;
  s.buildings.push({ playerId: cpu.id, vertex: s.board.vertices[0].id, kind: 'settlement' }); cpu.hand.wood = 4;
  s.offers.push({ id: 'offer', playerId: 'human-0', give: { wood: 0, brick: 0, wool: 0, grain: 1, ore: 0 }, get: { wood: 1, brick: 0, wool: 0, grain: 0, ore: 0 }, accepts: [] });
  const decide = () => chooseExpansionAction(rules.publicView(s, viewContext), rules.playerView(s, cpu.id, viewContext), cpu.id);
  assert.equal(decide()?.type, 'accept-offer'); s.offers[0].get.wood = 4; s.revision++; assert.equal(decide(), null);
  s.offers[0].get.wood = 1; s.actorId = s.players[2].id; s.revision++; assert.equal(decide(), null, 'Standard trades must involve the active player');
  s.actorId = 'human-0'; s.settings.mode = 'connect'; s.readyIds.push('human-0'); s.revision++; assert.notEqual(decide()?.type, 'accept-offer');
  s.settings.mode = 'standard'; s.readyIds = [];
  s.offers[0].get.wood = 1; s.offers[0].accepts.push(cpu.id); s.revision++; assert.equal(decide(), null);
});
test('An active CPU leaves eight seconds to confirm its accepted trade', () => {
  const s = game({ expansion: 'base' }), cpu = s.players[1]; s.phase = 'action'; s.actorId = cpu.id; s.primary = 1;
  s.buildings.push({ playerId: cpu.id, vertex: s.board.vertices[0].id, kind: 'settlement' }); cpu.hand.wood = 1; s.players[0].hand.grain = 1;
  s.offers.push({ id: 'offer', playerId: 'human-0', give: { wood: 0, brick: 0, wool: 0, grain: 1, ore: 0 }, get: { wood: 1, brick: 0, wool: 0, grain: 0, ore: 0 }, accepts: [] });
  rules.tick(s, new Map(), .1, 1000); assert.deepEqual(s.offers[0].accepts, [cpu.id]);
  const before = structuredClone(s); rules.tick(s, new Map(), .1, 8000); assert.deepEqual(s, before);
  rules.applyAction(s, 'human-0', { type: 'complete-offer', offerId: 'offer', partner: cpu.id, turnId: s.turnId }, 8000);
  assert.equal(s.players[0].hand.wood, 1); assert.equal(s.players[1].hand.grain, 1);
});
test('Connect deadlines advance before a CPU can submit an expired action', () => {
  const s = game({ mode: 'connect', expansion: 'base' }); s.phase = 'action'; s.deadline = 1000;
  rules.tick(s, new Map(), .1, 1000); assert.equal(s.turn, 1); assert.ok(s.deadline! > 1000);
});
for (const mode of ['standard', 'connect'] as const) for (const expansion of ['base', 'seafarers', 'explorers'] as const) test(`CPU scheduler finishes ${mode}/${expansion} with one human and nine CPUs, then creates a fresh replay`, () => {
  const s = game({ mode, expansion, tableSize: 10, targetPoints: 10, citiesKnights: true, scenarios: expansion === 'explorers' ? ['fishing'] : ['fishing', 'rivers', 'caravans', 'barbarian-attack', 'traders'] });
  const totals = RESOURCES.map(r => s.bank[r] + s.players.reduce((n, p) => n + p.hand[r], 0)); let steps = 0;
  while (s.phase !== 'ended' && steps++ < 12000) {
    const now = steps * 1000; rules.tick(s, new Map(), .1, now);
    if (rules.outcome(s).complete) break;
    const pub = rules.publicView(s, viewContext), own = rules.playerView(s, 'human-0', viewContext), action = chooseExpansionAction(pub, own, 'human-0');
    if (action) rules.applyAction(s, 'human-0', action, now);
  }
  assert.equal(s.phase, 'ended', `${s.phase}, turn ${s.turn}, scores ${s.players.map(p => rules.playerView(s, p.id, viewContext).score)}`);
  assert.deepEqual(RESOURCES.map(r => s.bank[r] + s.players.reduce((n, p) => n + p.hand[r], 0)), totals);
  assert.equal(rules.outcome(s).rows.length, 10); assertSerializable(rules.outcome(s));
  const fresh = game({ ...s.settings }); assert.equal(fresh.buildings.length, 0); assert.equal(fresh.turn, 0); assert.equal(fresh.cpuCursor, 0);
});
