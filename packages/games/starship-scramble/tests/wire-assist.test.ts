/** The ship's computer (auto-aim, damage control), the packed wire and its cache revision, and packed saves. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { SnapshotDecoder, SnapshotEncoder } from '../../../party-contract/src/snapshot-cache';
import type { PublicView } from '../src/contracts';
import { manifest } from '../src/manifest';
import { rules } from '../src/server';
import { expandSave } from '../src/run/save';
import { publicView } from '../src/run/view';
import { applyCombatCommand } from '../src/sim/index';
import { decode, encode, seat } from '../src/wire';
import { Run, roster } from './run-bot';
import { battle, room, run, ship } from './sim-fixtures';

test("the ship's computer aims every weapon and fires those left on Auto; a held weapon waits for the captain's Fire", () => {
  const me = ship('me', 'wayfarer'), foe = ship('foe', 'raider', 'enemy', { weapons: [] }), w = battle([me, foe], {}, true);
  const [laser, missile] = me.weapons;
  run(w, 300);
  assert.deepEqual(laser.target, { shipId: 'foe', roomId: 'shields' }, 'bolts go for the shields');
  assert.equal(missile.target?.shipId, 'foe');
  // The captain's aim stands. A weapon taken off Auto keeps a target (a cleared one is aimed again) but holds its fire.
  applyCombatCommand(w, 'cap-me', { type: 'target', weapon: laser.uid, shipId: 'foe', roomId: 'helm' });
  applyCombatCommand(w, 'cap-me', { type: 'autofire', weapon: missile.uid, auto: false }); applyCombatCommand(w, 'cap-me', { type: 'untarget', weapon: missile.uid });
  run(w, 1000);
  assert.deepEqual(laser.target, { shipId: 'foe', roomId: 'helm' }); assert.equal(missile.target?.shipId, 'foe');
  const hull = foe.hull + foe.shields; run(w, 16000);
  assert.ok(foe.hull + foe.shields < hull || foe.status !== 'active', 'the Auto weapon fired by itself');
  assert.equal(me.ammo, 8, 'the held missile never left its rack'); assert.equal(missile.charge, 1);
  applyCombatCommand(w, 'cap-me', { type: 'fire' }); assert.equal(me.ammo, 7, 'until the captain fired it');
});

test('damage control answers a fire with the nearest free hand and walks them back; orders and the switch override it', () => {
  const me = ship('me', 'wayfarer', 'ally', { assist: true }), w = battle([me, ship('foe', 'raider', 'enemy', { weapons: [] })], {}, true, true);
  const before = new Map(w.crew.map(m => [m.id, m.roomId]));
  room(me, 'oxygen').fire = 1; run(w, 2100); // it looks around every two seconds
  const sent = w.crew.filter(m => m.path.at(-1) === 'oxygen' || m.roomId === 'oxygen');
  // One hand per level of fire, up to two; the pilot is the last to leave the helm.
  assert.equal(sent.length, Math.min(2, room(me, 'oxygen').fire)); assert.ok(sent.every(m => m.back === before.get(m.id) && m.role !== 'pilot'));
  run(w, 30000);
  assert.equal(room(me, 'oxygen').fire, 0); assert.ok(sent.every(m => m.roomId === before.get(m.id) && m.back === undefined), 'back at their posts');
  // A captain's order cancels the errand; with the switch off nobody moves.
  room(me, 'medbay').fire = 1; run(w, 2100);
  const runner = w.crew.find(m => m.back)!; applyCombatCommand(w, 'cap-me', { type: 'crew', crewIds: [runner.id], roomId: 'engines' });
  assert.equal(runner.back, undefined); assert.equal(runner.path.at(-1), 'engines');
  const manual = ship('me', 'wayfarer'), w2 = battle([manual, ship('foe', 'raider', 'enemy', { weapons: [] })], {}, true, true), posts = w2.crew.map(m => m.roomId);
  room(manual, 'oxygen').fire = 1; run(w2, 3000);
  assert.deepEqual(w2.crew.map(m => m.roomId), posts, 'manual crews wait for orders');
});

test('Cadet ships start with damage control on, Captain ships off, and any captain can flip the switch', () => {
  const make = (difficulty: 'cadet' | 'captain') => { const s = rules.create({ roomId: 'r', roundId: 'r1', players: roster(1), seed: 1, nowMs: 0 }, rules.validateSettings({ difficulty }));
    rules.applyAction(s, 'p0', rules.parseAction({ turn: s.turn, type: 'hangar', hullId: 'wayfarer', name: '', paint: '#3fa7ff' }), 0); return s; };
  const cadet = make('cadet'), captain = make('captain');
  assert.deepEqual([cadet.ships[0].assist, captain.ships[0].assist], [true, false]);
  assert.throws(() => rules.applyAction(captain, 'p0', rules.parseAction({ turn: captain.turn, type: 'assist', on: true }), 0), /Launch first/);
  rules.applyAction(captain, 'p0', rules.parseAction({ turn: captain.turn, type: 'ready', ready: true }), 0); rules.tick(captain, new Map(), .1, 100);
  rules.applyAction(captain, 'p0', rules.parseAction({ turn: captain.turn, type: 'assist', on: true }), 100);
  assert.equal(captain.ships[0].assist, true);
  assert.equal(decode(rules.publicView(captain, { nowMs: 100, phase: 'playing' })).ships[0].assist, true);
});

/** What the wire may change: cargo travels privately, stats only once the run is over. */
const shared = (v: PublicView): PublicView => ({ ...v, captains: v.captains.map(c => ({ ...c, cargo: [], stats: v.phase === 'over' || v.result !== null ? c.stats : { damage: 0, kills: 0, repairs: 0, scrapEarned: 0, saves: 0 } })) });

test('the wire decodes back to the same view in every phase, and a seat gets its cargo back', () => {
  const phases = new Set<string>(); let game!: Run;
  for (let seed = 1; seed <= 6 && !['combat', 'event', 'loot', 'map', 'store'].every(p => phases.has(p)); seed++) {
    game = new Run(3, { difficulty: 'cadet', length: 'short' }, seed * 7919);
    for (let i = 0; i < 60000 && game.state.result === null; i++) {
      game.turn();
      // Every seventh beat, and the first beat of every phase.
      if (i % 7 && phases.has(game.state.phase)) continue;
      const view = publicView(game.state), wire = rules.publicView(game.state, { nowMs: game.now, phase: 'playing' }); phases.add(view.phase);
      assertSerializable(wire); assert.deepEqual(decode(JSON.parse(JSON.stringify(wire))), shared(view));
      const own = rules.playerView(game.state, 'p1', { nowMs: game.now, phase: 'playing' }), mine = seat(decode(wire), JSON.parse(JSON.stringify(own)));
      assert.deepEqual(mine.captains[1].cargo, view.captains[1].cargo); assert.equal(own.captainId, 'c1'); assert.equal(own.wing, null, 'a single wing shares its whole battle');
    }
  }
  assert.ok(['hangar', 'combat', 'event', 'loot', 'map', 'store'].every(p => phases.has(p)), `phases seen: ${[...phases]}`);
  // The run is over: the same check once more, and now the captains' stats travel too.
  const over = publicView(game.state), wire = rules.publicView(game.state, { nowMs: game.now, phase: 'results' });
  assert.equal(over.phase, 'over'); assert.deepEqual(decode(JSON.parse(JSON.stringify(wire))), shared(over));
  assert.deepEqual(decode(wire).captains.map(c => c.stats), game.state.captains.map(c => c.stats));
});

test('a fleet of several wings shares only the fleet summary; each phone adds its own wing and nothing of the others', () => {
  const game = new Run(9, { difficulty: 'cadet', length: 'short' }, 7919);
  for (let i = 0; i < 30000 && !(game.state.combat && game.state.combat.t > 12000); i++) game.turn();
  const s = game.state, at = { nowMs: game.now, phase: 'playing' as const }, wire = rules.publicView(s, at), tv = decode(JSON.parse(JSON.stringify(wire)));
  assert.deepEqual([tv.ships.length, tv.crew.length, tv.combat!.projectiles.length, tv.combat!.events.length], [0, 0, 0, 0], 'no interiors in public');
  assert.equal(tv.fleet!.ships.length, s.ships.length);
  assert.deepEqual(tv.fleet!.ships.map(x => [x.id, x.wing, x.hull, x.status]), s.ships.map(x => [x.id, x.wing, x.hull, x.status]));
  assert.equal(tv.fleet!.shots.length, s.combat!.projectiles.length);
  for (const c of [s.captains[0], s.captains[4], s.captains[8]]) {
    const own = JSON.parse(JSON.stringify(rules.playerView(s, c.playerId!, at))), mine = seat(tv, own);
    assert.deepEqual(mine.ships.map(x => x.id).sort(), s.ships.filter(x => x.wing === c.wing || x.wing < 0).map(x => x.id).sort());
    assert.ok(mine.crew.every(k => mine.ships.some(x => x.id === k.shipId)) && mine.crew.some(k => k.ownerId === c.id));
    assert.ok(mine.combat!.projectiles.every(p => mine.ships.some(x => x.id === p.fromShipId) && mine.ships.some(x => x.id === p.toShipId)));
    assert.equal(mine.fleet, tv.fleet, 'and keeps the fleet summary');
  }
  assert.equal(rules.playerView(s, 'nobody', at).wing, null);
  // Wingmates share one built engagement per snapshot; anything the room does to the state builds a fresh one.
  const first = rules.playerView(s, 'p0', at).wing; assert.equal(rules.playerView(s, 'p1', at).wing, first); assert.notEqual(rules.playerView(s, 'p4', at).wing, first);
  game.step(); const later = rules.playerView(s, 'p0', { ...at, nowMs: game.now }).wing; assert.notEqual(later, first);
  const mine = s.ships.find(x => x.id === 's0')!; rules.applyAction(s, 'p0', rules.parseAction({ turn: s.turn, type: 'assist', on: !mine.assist }), game.now);
  assert.notEqual(rules.playerView(s, 'p1', { ...at, nowMs: game.now }).wing, later, 'an order shows at once');
  assert.equal(seat(tv, rules.playerView(s, 'p1', { ...at, nowMs: game.now })).ships.find(x => x.id === 's0')!.assist, mine.assist);
});

test('the cached fields are resent only when they change: a battle tick keeps the revision, a jump moves it', () => {
  const game = new Run(2, { difficulty: 'cadet', length: 'short' }, 3), at = () => ({ nowMs: game.now, phase: 'playing' as const }), cached = manifest.snapshotCache.fields;
  for (let i = 0; i < 30000 && !(game.state.combat && game.state.combat.t > 6000); i++) game.turn();
  const a = rules.publicView(game.state, at()); for (let i = 0; i < 20; i++) game.step(); const b = rules.publicView(game.state, at());
  assert.equal(a.rev, b.rev); assert.notDeepEqual(a.ships, b.ships);
  // Through the room's own cache: the second snapshot omits the cached fields and still decodes to the full view.
  const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder(), send = (wire: typeof a) => { const enc = encoder.encode('r1', wire, manifest.snapshotCache); return { packet: enc, back: decoder.decode({ v: '1.0', type: 'game.snapshot', roundId: 'r1', ...enc } as never, manifest.snapshotCache)! }; };
  const first = send(a), second = send(b);
  assert.ok(cached.every(f => f in (first.packet.publicView as object)) && cached.every(f => !(f in (second.packet.publicView as object))));
  assert.deepEqual(decode(second.back.publicView as typeof b), decode(b));
  const size = (x: unknown) => JSON.stringify(x).length; assert.ok(size(second.packet.publicView) < size(b), 'the cached fields are real weight');
  while (game.state.phase !== 'map') game.turn();
  const map = rules.publicView(game.state, at()), jumps = game.state.fleetStats.jumps; while (game.state.fleetStats.jumps === jumps) game.turn();
  assert.notEqual(rules.publicView(game.state, at()).rev, map.rev);
  // The same content always hashes the same, so a loaded save cannot leave a phone holding stale cached fields under a reused number.
  assert.equal(encode(decode(a)).rev, encode(decode(JSON.parse(JSON.stringify(a)))).rev);
});

test('saves are packed (version 2), expand to the keyed shape, and a version 1 save still loads into wings', () => {
  const game = new Run(6, { difficulty: 'captain', length: 'standard' }, 5);
  for (let i = 0; i < 30000 && !(game.state.combat && game.state.combat.t > 9000); i++) game.turn();
  const save = JSON.parse(JSON.stringify(rules.exportSave!(game.state))), ctx = { roomId: 'r', roundId: 'r2', players: roster(6, 'q'), seed: 1, nowMs: 5 };
  assert.equal(save.v, 2); assert.ok(Array.isArray(save.state.ships[0]) && Array.isArray(save.state.crew[0]), 'ships and crew travel as rows');
  const { state } = rules.loadSave!(ctx, save, game.state.settings);
  assert.deepEqual(state.ships.map(x => [x.id, x.wing, x.hull, x.assist, x.scale]), game.state.ships.map(x => [x.id, x.wing, x.hull, x.assist, x.scale]));
  assert.deepEqual(state.crew.map(k => [k.id, k.shipId, k.roomId, Math.round(k.hp)]), game.state.crew.map(k => [k.id, k.shipId, k.roomId, Math.round(k.hp)]));
  assert.equal(state.combat!.paused, true);
  // A version 1 save (keyed objects, no wings): the same state without the fields this version added.
  const old = expandSave(save) as { v: number; state: any };
  for (const c of old.state.captains) delete c.wing; for (const x of old.state.ships) { delete x.wing; delete x.assist; delete x.scale; } delete old.state.fight.resumeAt; delete old.state.fight.paused;
  old.state.captains.length = 3; old.state.ships = old.state.ships.filter((x: any) => !x.captainId || Number(x.captainId.slice(1)) < 3); old.state.crew = old.state.crew.filter((k: any) => old.state.ships.some((x: any) => x.id === k.shipId) && (!k.ownerId || Number(k.ownerId.slice(1)) < 3));
  old.state.combat.projectiles = [];
  const loaded = rules.loadSave!({ ...ctx, players: roster(3, 'q') }, old, game.state.settings).state;
  assert.deepEqual(loaded.captains.map(c => c.wing), [0, 0, 0]); assert.ok(loaded.ships.every(x => x.wing === 0 && x.scale === 1 && x.assist === false));
});
