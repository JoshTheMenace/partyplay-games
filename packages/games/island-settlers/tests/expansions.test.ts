import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rules, type State} from '../src/server';
import {GOODS, score} from '../src/core';
import {emptyHand, type Settings} from '../src/model';
import {cityEvent, drawProgress} from '../src/cities-knights';
import {assertSerializable} from '../../../party-contract/src/serializable';

const ctx = { nowMs: 0, phase: 'playing' as const };
export function game(count = 4, settings: Partial<Settings> = {}, seed = 42) { return rules.create({ players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Explorer0000000${i}`, color: '#ff5748' })), seed, nowMs: 0, roomId: 'expansions', roundId: 'round' }, rules.validateSettings({ expansion: 'base', citiesKnights: true, ...settings })); }
export function act(s: State, id: string, action: Record<string, unknown>, now = 0) { rules.applyAction(s, id, rules.parseAction({ ...action, turnId: s.turnId }), now); }
export function view(s: State, id = s.actorId) { return rules.playerView(s, id, ctx); }
export function setup(s: State) { for (let i = 0; s.phase === 'setup'; i++) { assert.ok(i < 50); const legal = view(s).legal, kind = legal.settlements.length ? 'settlement' : legal.roads.length ? 'road' : 'ship'; act(s, s.actorId, { type: 'build', kind, target: kind === 'settlement' ? legal.settlements[0] : kind === 'road' ? legal.roads[0] : legal.ships[0] }); } }
export function grant(s: State, id: string, cards: Record<string, number>) { for (const [key, n] of Object.entries(cards)) { const r = key as typeof GOODS[number]; assert.ok((s.bank[r] ?? 0) >= n); s.bank[r] = (s.bank[r] ?? 0) - n; s.players.find(p => p.id === id)!.hand[r] = (s.players.find(p => p.id === id)!.hand[r] ?? 0) + n; } s.revision++; }
export function cmd(s: State, id: string, command: string, choices: Record<string, string> = {}, cards?: Record<string, number>) { act(s, id, { type: 'expansion', command, choices, ...(cards ? { cards: { ...emptyHand(), ...cards } } : {}) }); }
const inventory = (s: State) => GOODS.map(r => (s.bank[r] ?? 0) + s.players.reduce((n, p) => n + (p.hand[r] ?? 0), 0));
function actionState(count = 4, settings: Partial<Settings> = {}) { const s = game(count, settings); setup(s); s.phase = 'action'; s.revision++; return s; }
function unchanged(s: State, fn: () => void) { const before = structuredClone(s); assert.throws(fn); assert.deepEqual(s, before); }

test('configuration accepts C&K with either sea system and rejects incompatible expedition scenarios', () => {
  assert.equal(rules.validateSettings({ expansion: 'explorers', citiesKnights: true }).citiesKnights, true);
  for (const scenario of ['rivers', 'caravans', 'barbarian-attack', 'traders']) assert.throws(() => rules.validateSettings({ expansion: 'explorers', scenarios: [scenario] }));
  assert.throws(() => rules.validateSettings({ scenarios: ['fishing', 'fishing'] }));
  assert.throws(() => rules.validateSettings({ citiesKnights: 'yes' }));
});
for (const count of [3, 6, 10]) for (const mode of ['standard', 'connect'] as const) test(`C&K ${count}/${mode}: city setup, finite supplies and private projections`, () => {
  const s = game(count, { mode }), before = inventory(s); setup(s);
  assert.equal(s.buildings.filter(b => b.kind === 'city').length, count); assert.equal(s.deck.length, 0); assert.equal(s.robber, ''); assert.deepEqual(inventory(s), before);
  assertSerializable(rules.publicView(s, ctx)); for (const p of s.players) assertSerializable(view(s, p.id));
  const pub = JSON.stringify(rules.publicView(s, ctx)); assert.ok(!pub.includes('progressDecks')); assert.ok(!pub.includes('knightTurns')); assert.ok(!pub.includes('fishDeck'));
});
test('commodity bank trades and domestic trades conserve resources and commodities', () => {
  const s = actionState(), before = inventory(s); grant(s, 'p0', { paper: 4, cloth: 2 }); grant(s, 'p1', { coin: 1 });
  act(s, 'p0', { type: 'bank', give: 'paper', get: 'coin' }); assert.equal(s.players[0].hand.paper, 0);
  act(s, 'p0', { type: 'offer', give: { ...emptyHand(), cloth: 1 }, get: { ...emptyHand(), coin: 1 } });
  const offerId = s.offers[0].id; act(s, 'p1', { type: 'accept-offer', offerId }); act(s, 'p0', { type: 'complete-offer', offerId, partner: 'p1' }); assert.deepEqual(inventory(s), before);
});
test('knight recruitment, promotion and activation enforce readiness and limits atomically', () => {
  const s = actionState(), before = inventory(s); grant(s, 'p0', { wool: 3, ore: 3, grain: 2 });
  const target = view(s).expansion!.commands.find(c => c.id === 'knight:recruit')!.fields[0].options[0].value;
  cmd(s, 'p0', 'knight:recruit', { target }); const k = s.modules!.public.knights[0];
  cmd(s, 'p0', `knight:activate:${k.id}`); assert.equal(view(s).expansion!.commands.some(c => c.id === `knight:move:${k.id}`), false);
  cmd(s, 'p0', `knight:promote:${k.id}`); unchanged(s, () => cmd(s, 'p0', `knight:promote:${k.id}`)); assert.deepEqual(inventory(s), before);
});
test('city walls and improvements require valid cities; level three provides commodity trade rates', () => {
  const s = actionState(); grant(s, 'p0', { cloth: 6, brick: 2 }); const city = s.buildings.find(b => b.kind === 'city' && b.playerId === 'p0')!.vertex;
  cmd(s, 'p0', 'city:wall', { target: city }); unchanged(s, () => cmd(s, 'p0', 'city:wall', { target: city }));
  for (let n = 0; n < 3; n++) cmd(s, 'p0', 'city:improve:trade');
  assert.equal(view(s).rates.paper, 2); assert.equal(view(s).rates.cloth, 2); assert.equal(s.modules!.players.p0.improvements.trade, 3);
});
test('metropolis ownership requires an available city and changes only when surpassed', () => {
  const s = actionState(); grant(s, 'p0', { paper: 10 }); const city = s.buildings.find(b => b.kind === 'city' && b.playerId === 'p0')!.vertex;
  for (let n = 0; n < 3; n++) cmd(s, 'p0', 'city:improve:science');
  unchanged(s, () => cmd(s, 'p0', 'city:improve:science', { target: 'v-does-not-exist' }));
  cmd(s, 'p0', 'city:improve:science', { target: city }); assert.equal(score(s, s.players[0]), 5); assert.equal(s.modules!.public.metropolises[0].playerId, 'p0');
});
test('progress draw keeps identities private and resolves public VP cards immediately', () => {
  const s = actionState(); s.modules!.progressDecks.science = ['printing', 'alchemy']; drawProgress(s, 'p1', 'science', 0); s.revision++;
  assert.equal(view(s, 'p1').expansion!.progress[0].kind, 'alchemy'); assert.ok(!JSON.stringify(view(s, 'p0')).includes('alchemy')); assert.ok(!JSON.stringify(rules.publicView(s, ctx)).includes('alchemy'));
  drawProgress(s, 'p1', 'science', 0); s.revision++; assert.equal(rules.publicView(s, ctx).players[1].score, 4);
});
test('barbarian defeat prompts vulnerable players; choices pause all other actions', () => {
  const s = actionState(); s.modules!.public.barbarian!.position = 6; s.random = 1; s.dice = [2, 3]; cityEvent(s, 0); s.revision++;
  assert.equal(s.phase, 'choice'); assert.equal(s.modules!.prompts.length, 4);
  unchanged(s, () => act(s, 'p0', { type: 'end' }));
  while (s.modules!.prompts.length) { const q = s.modules!.prompts[0], c = view(s, q.playerId).expansion!.commands[0]; cmd(s, q.playerId, c.id, { method: 'pillage', target: c.fields.find(f => f.key === 'target')!.options[0].value }); }
  assert.equal(s.buildings.filter(b => b.kind === 'city').length, 0); assert.equal(s.phase, 'action'); assert.ok(s.robber);
});
test('Wedding and Guild Dues show only authorized choices and transfer atomically', () => {
  const s = actionState(); grant(s, 'p1', { wood: 3 }); s.modules!.players.p1.defenderPoints = 2;
  s.modules!.players.p0.progress.push({ id: 'guild-test', kind: 'guild-dues', track: 'trade' }); s.revision++;
  cmd(s, 'p0', 'progress:guild-test', { opponent: 'p1' }); const c = view(s, 'p0').expansion!.commands[0];
  assert.equal(view(s, 'p1').expansion!.commands.length, 0); const before = inventory(s); cmd(s, 'p0', c.id, {}, { wood: 2 }); assert.deepEqual(inventory(s), before); assert.equal(s.phase, 'action');
});

for (const expansion of ['base', 'seafarers', 'explorers'] as const) for (const citiesKnights of [false, true]) test(`ten-player combined ${expansion}/${citiesKnights}: legal setup, transport, and movement boundary`, () => {
  const s = game(10, { expansion, citiesKnights, scenarios: expansion === 'explorers' ? ['fishing'] : ['fishing', 'rivers', 'caravans', 'barbarian-attack', 'traders'] }); setup(s);
  assert.equal(s.buildings.length, 20); assertSerializable(rules.publicView(s, ctx)); for (const p of s.players) assertSerializable(view(s, p.id));
  s.phase = 'action'; s.revision++; act(s, 'p0', { type: 'end' }); assert.equal(s.phase, 'movement'); assert.equal(view(s, 'p0').expansion!.movement, true); assert.equal(view(s, 'p0').canEnd, true);
  act(s, 'p0', { type: 'end' }); assert.equal(s.actorId, 'p5');
  if (expansion === 'explorers') { assert.equal(s.modules!.public.explorers!.ships.length, 10); assert.equal(s.modules!.public.explorers!.harbors.length, 10); assert.equal(s.modules!.public.explorers!.ships[0].cargo[0].kind, 'settler'); assert.ok(Object.keys(s.modules!.fog).length >= 30); const pub = JSON.stringify(rules.publicView(s, ctx)); assert.ok(!pub.includes('lairNumbers')); assert.ok(!pub.includes('"fog":')); }
  else assert.equal(s.modules!.public.deliveries!.wagons.length, 10);
});

import { chooseExpansionAction, commandAction } from './expansion-bot';
for (const mode of ['standard', 'connect'] as const) for (const expansion of ['base', 'seafarers', 'explorers'] as const) test(`complete ten-player ${mode}/${expansion} expansion match from legal phone views`, () => {
  const settings: Partial<Settings> = { mode, expansion, citiesKnights: true, targetPoints: 10, scenarios: expansion === 'explorers' ? ['fishing'] : ['fishing', 'rivers', 'caravans', 'barbarian-attack', 'traders'] }, s = game(10, settings), stock = inventory(s); let now = 0, accepted = 0;
  for (let step = 0; step < 15000 && s.phase !== 'ended'; step++) {
    const pub = rules.publicView(s, ctx); let acted = false;
    for (const p of s.players) {
      const action = chooseExpansionAction(pub, view(s, p.id), p.id); if (!action) continue;
      try { rules.applyAction(s, p.id, action, now); } catch (e) { throw new Error(`${s.phase}/${s.turn}/${p.id}: ${JSON.stringify(action)}: ${e}`); }
      accepted++; acted = true; break;
    }
    now += acted ? 20 : 3100; rules.tick(s, new Map(), .1, now); assert.deepEqual(inventory(s), stock);
    if (step % 100 === 0) { assertSerializable(rules.publicView(s, ctx)); for (const p of s.players) assertSerializable(view(s, p.id)); }
  }
  assert.equal(s.phase, 'ended', `Unfinished after ${s.turn} turns: ${s.players.map(p => view(s, p.id).score)}`); assert.ok(accepted > 100); assertSerializable(rules.outcome(s));
  const replay = game(10, settings); assert.equal(replay.phase, 'setup'); assert.equal(replay.modules!.public.knights.length, 0); assert.equal(replay.modules!.prompts.length, 0);
  console.log(`${mode}/${expansion}: ${accepted} accepted actions, ${s.turn} turns, winners ${s.winners}`);
});

import {expeditionPirateTargets, missionProgress, resolveLairs} from '../src/explorers-pirates';
import {syncBarbarianPaths} from '../src/barbarian-scenarios';

test('every expedition roster has a legal pirate destination before any discovery', () => {
  for (let count = 3; count <= 10; count++) { const s = game(count, { expansion: 'explorers' }); assert.ok(expeditionPirateTargets(s).length); }
});
test('fish buy an expedition ship and one second journey without creating resources', () => {
  const s = actionState(4, { expansion: 'explorers', scenarios: ['fishing'] }), x = s.modules!.players.p0, before = inventory(s);
  x.fish = Array.from({ length: 8 }, (_, i) => ({ id: `fish${i}`, value: 3 })); s.revision++;
  const build = view(s).expansion!.commands.find(c => c.id === 'fish:ship')!; assert.ok(build); cmd(s, 'p0', build.id, { target: build.fields[0].options[0].value });
  assert.equal(s.modules!.public.explorers!.ships.filter(sh => sh.playerId === 'p0').length, 2); assert.deepEqual(inventory(s), before);
  act(s, 'p0', { type: 'end' }); const ship = s.modules!.public.explorers!.ships.find(sh => sh.playerId === 'p0')!;
  cmd(s, 'p0', `exp:finish:${ship.id}`); cmd(s, 'p0', 'fish:journey', { ship: ship.id }); assert.equal(s.modules!.public.explorers!.ships.find(sh => sh.id === ship.id)!.remaining, 4);
  cmd(s, 'p0', `exp:finish:${ship.id}`); unchanged(s, () => cmd(s, 'p0', 'fish:journey', { ship: ship.id }));
});
test('a crew sharing cargo with spice can visit another farm without exceeding capacity', () => {
  const s = actionState(4, { expansion: 'explorers' }); act(s, 'p0', { type: 'end' });
  const v = s.modules!.public.explorers!, sh = v.ships.find(sh => sh.playerId === 'p0')!, e = s.board.edges.find(e => e.id === sh.edge)!, tile = s.board.vertices.find(v => v.id === e.a)!.tiles[0];
  sh.cargo = [{ kind: 'crew', source: '' }, { kind: 'spice', source: 'old-farm' }]; v.spices.push({ tile, benefit: 'speed', visitors: [] }); s.revision++;
  cmd(s, 'p0', `exp:crew:${sh.id}`, { target: tile }); assert.deepEqual(s.modules!.public.explorers!.ships.find(x => x.id === sh.id)!.cargo.map(c => c.kind), ['spice', 'spice']);
});
test('mission capture awards contributors, consumes the hero crew and caps progress', () => {
  const s = actionState(4, { expansion: 'explorers' }), v = s.modules!.public.explorers!, tile = s.board.tiles[0].id;
  v.lairs.push({ tile, captured: false, crews: ['p0', 'p0', 'p1'] }); s.modules!.lairNumbers[tile] = 9; const coins = s.modules!.players.p0.coins;
  resolveLairs(s); assert.equal(v.lairs[0].captured, true); assert.equal(v.lairs[0].crews.length, 2); assert.equal(s.modules!.players.p0.coins, coins + 2); assert.equal(s.modules!.players.p0.missions.lairs + s.modules!.players.p1.missions.lairs, 3);
  missionProgress(s, 'p0', 'fish', 100); missionProgress(s, 'p0', 'spices', 100); assert.equal(s.modules!.players.p0.missions.fish, 7); assert.equal(s.modules!.players.p0.missions.spices, 6); assert.ok(Number.isFinite(score(s, s.players[0])));
});
test('combined coastal and delivery barbarians share pieces and blocked paths', () => {
  const s = actionState(4, { scenarios: ['barbarian-attack', 'traders'] }), v = s.modules!.public;
  v.attack!.barbarians.forEach(b => b.count = 0); const b = v.attack!.barbarians[0]; b.count = 3; syncBarbarianPaths(s);
  assert.equal(v.deliveries!.barbarians.length, 3); for (const at of v.deliveries!.barbarians) assert.ok(s.board.edges.find(e => e.id === at)!.tiles.includes(b.tile));
  b.count = 1; syncBarbarianPaths(s); assert.equal(v.deliveries!.barbarians.length, 1);
});
test('Connect timeout resolves mandatory progress and caravan choices before advancing', () => {
  const s = actionState(10, { mode: 'connect', scenarios: ['caravans', 'traders'] }); s.deadline = 1000;
  s.modules!.players.p0.progress = Array.from({ length: 6 }, (_, i) => ({ id: `progress${i}`, kind: 'alchemy' as const, track: 'science' as const })); s.modules!.players.p0.built = true;
  rules.tick(s, new Map(), .1, 1001); assert.equal(s.phase, 'choice'); let now = 1001, choices = 0;
  while (s.phase === 'choice' || s.turn === 1) {
    if (s.phase === 'choice') { const q = s.modules!.prompts[0], c = view(s, q.playerId).expansion!.commands[0]; rules.applyAction(s, q.playerId, commandAction(rules.publicView(s, ctx), c), now); choices++; }
    now += 100; rules.tick(s, new Map(), .1, now); assert.ok(choices < 30);
  }
  assert.ok(choices >= 13); assert.equal(s.modules!.players.p0.progress.length, 4); assert.equal(s.modules!.public.caravans!.segments.length, 1); assert.equal(s.turn, 2);
});
test('ending movement allows trading on a later primary turn and keeps player clocks independent', () => {
  const s = actionState(4, { scenarios: ['traders'] }); act(s, 'p0', { type: 'end' }); act(s, 'p0', { type: 'end' });
  assert.equal(s.modules!.players.p0.movement, false); s.phase = 'action'; s.revision++; assert.equal(view(s, 'p0').canTrade, true);
});

test('progress monopoly, merchant, fleet, irrigation and mining obey their resource effects', () => {
  for (const [kind, choices] of [['resource-monopoly', { resource: 'wood' }], ['trade-monopoly', { resource: 'coin' }], ['merchant-fleet', { resource: 'paper' }], ['irrigation', {}], ['mining', {}]] as const) {
    const s = actionState(), before = inventory(s); grant(s, 'p1', { wood: 4, coin: 3 }); grant(s, 'p2', { wood: 1, coin: 1 });
    s.modules!.players.p0.progress.push({ id: 'card', kind, track: kind === 'irrigation' || kind === 'mining' ? 'science' : 'trade' }); s.revision++;
    cmd(s, 'p0', 'progress:card', choices); assert.deepEqual(inventory(s), before); assert.equal(s.modules!.players.p0.progress.length, 0);
    if (kind === 'resource-monopoly') assert.equal(s.players[1].hand.wood, 2);
    if (kind === 'trade-monopoly') assert.equal(s.players[1].hand.coin, 2);
    if (kind === 'merchant-fleet') assert.equal(view(s).rates.paper, 2);
  }
});
test('Espionage exposes selected opponent progress only to the card player', () => {
  const s = actionState(); s.modules!.players.p0.progress = [{ id: 'spy', kind: 'espionage', track: 'politics' }]; s.modules!.players.p1.progress = [{ id: 'secret', kind: 'crane', track: 'science' }]; s.revision++;
  cmd(s, 'p0', 'progress:spy', { opponent: 'p1' }); assert.ok(JSON.stringify(view(s)).includes('secret')); assert.ok(!JSON.stringify(view(s, 'p2')).includes('secret')); assert.ok(!JSON.stringify(rules.publicView(s, ctx)).includes('secret'));
  cmd(s, 'p0', s.modules!.prompts[0].id, { card: 'secret' }); assert.equal(s.modules!.players.p1.progress.length, 0); assert.equal(s.modules!.players.p0.progress[0].kind, 'crane');
});
test('city pillage accepts river-gold protection and rejects spending gold twice', () => {
  const s = actionState(4, { scenarios: ['rivers'] }); s.modules!.players.p0.coins = 5; s.modules!.public.barbarian!.position = 6; s.random = 1; s.dice = [2, 3]; cityEvent(s, 10); s.revision++;
  const prompt = s.modules!.prompts[0]; cmd(s, 'p0', prompt.id, { method: 'pay-5-gold' }); assert.equal(s.modules!.players.p0.coins, 0); assert.equal(s.buildings.filter(b => b.playerId === 'p0' && b.kind === 'city').length, 1);
  unchanged(s, () => cmd(s, 'p0', prompt.id, { method: 'pay-5-gold' }));
});

test('settings reject empty expeditions and unreachable victory targets', () => {
  assert.throws(() => rules.validateSettings({ expansion: 'explorers', missions: [] }));
  assert.throws(() => rules.validateSettings({ expansion: 'explorers', missions: ['fish'], targetPoints: 18 }));
  assert.equal(rules.validateSettings({ expansion: 'explorers', citiesKnights: true, missions: ['fish'], targetPoints: 22 }).targetPoints, 22);
  assert.throws(() => rules.validateSettings({ expansion: 'base', targetPoints: 30 }));
});

test('coastal displacement preserves the displaced knight and requires its owner to retreat', () => {
  const s = actionState(4, { scenarios: ['barbarian-attack'] }), v = s.modules!.public.attack!;
  const at = s.board.edges.find(e => e.land && !e.tiles.includes(v.castle))!, to = s.board.edges.find(e => e.land && e.id !== at.id && !e.tiles.includes(v.castle) && [e.a, e.b].some(x => x === at.a || x === at.b))!;
  v.guards = [{ id: 'strong', playerId: 'p0', edge: at.id, strength: 2, active: true }, { id: 'weak', playerId: 'p1', edge: to.id, strength: 1, active: false }];
  s.modules!.knightTurns = { strong: { activated: -1, promoted: -1 }, weak: { activated: -1, promoted: -1 } }; s.revision++;
  act(s, 'p0', { type: 'end' }); cmd(s, 'p0', 'guard:displace:strong', { target: to.id }); assert.equal(s.phase, 'choice'); assert.equal(s.modules!.prompts[0].playerId, 'p1');
  const c = view(s, 'p1').expansion!.commands[0]; rules.applyAction(s, 'p1', commandAction(rules.publicView(s, ctx), c), 10);
  assert.equal(s.modules!.public.attack!.guards.length, 2); assert.equal(s.modules!.public.attack!.guards.find(g => g.id === 'strong')!.active, false); assert.equal(s.phase, 'movement');
});
