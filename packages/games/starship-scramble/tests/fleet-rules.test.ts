/** Big fleets: wings and their engagements, the fleet-scale Flagship, the rout line, per-wing loot and shelves, crowd timers and pauses. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ROOM_PLAYERS, MAX_SAVE_BYTES } from '../../../party-contract/src/index';
import { WING_SIZE, routLine, wingCount, wingOf, type Settings, type Ship } from '../src/contracts';
import { manifest } from '../src/manifest';
import { rules } from '../src/server';
import { startFight } from '../src/run/combat';
import { EVENTS } from '../src/content/events/index';
import { pickEvent, resolveChoice } from '../src/run/events';
import { openLoot, openStore } from '../src/run/fleet';
import { openEvent } from '../src/run/flow';
import { wing, type State } from '../src/run/state';
import { Run } from './run-bot';

const create = (n: number, settings: Partial<Settings> = {}, seed = 1) =>
  rules.create({ roomId: 'r', roundId: 'r1', players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Captain ${i + 1}`, color: '#3fa7ff' })), seed, nowMs: 0 }, rules.validateSettings({ difficulty: 'captain', ...settings }));
let now = 0;
const act = (s: State, player: string, action: Record<string, unknown>) => rules.applyAction(s, player, rules.parseAction({ turn: s.turn, ...action }), now);
const tick = (s: State, ms = 100) => { for (let t = 0; t < ms; t += 100) { now += 100; rules.tick(s, new Map(), .1, now); } };
/** A fleet on the sector map: every captain readied the hull the hangar gave them. */
function launched(n: number, settings: Partial<Settings> = {}, seed = 1) {
  const s = create(n, settings, seed);
  s.captains.forEach((c, i) => { act(s, c.playerId!, { type: 'hangar', hullId: ['wayfarer', 'lancer', 'bulwark', 'corsair', 'halcyon'][i % 5], name: '', paint: '#3fa7ff' }); act(s, c.playerId!, { type: 'ready', ready: true }); });
  tick(s); assert.equal(s.phase, 'map');
  return s;
}
const fight = (s: State, enemies: string[] | 'sector' = ['raider-skiff']) => { startFight(s, { kind: 'combat', enemies }, false); tick(s, 3100); };
const allies = (s: State, k?: number) => s.ships.filter(x => x.faction === 'ally' && (k === undefined || x.wing === k)), foes = (s: State, k?: number) => s.ships.filter(x => x.faction === 'enemy' && (k === undefined || x.wing === k));
const kill = (s: State, list: Ship[]) => { for (const x of list) { x.hull = 0; x.phases = []; } tick(s, 200); };

test('the manifest seats the whole room and wings split any fleet into balanced groups of at most four', () => {
  assert.equal(manifest.players.max, MAX_ROOM_PLAYERS);
  for (let n = 1; n <= MAX_ROOM_PLAYERS; n++) {
    const sizes = Array.from({ length: wingCount(n) }, (_, k) => Array.from({ length: n }, (_, i) => wingOf(i, n)).filter(w => w === k).length);
    assert.equal(sizes.reduce((a, b) => a + b, 0), n, `${n}: every seat has a wing`);
    assert.ok(Math.max(...sizes) <= WING_SIZE && Math.max(...sizes) - Math.min(...sizes) <= 1 && (n < 5 || Math.min(...sizes) >= 2), `${n}: ${sizes}`);
    assert.deepEqual(Array.from({ length: n }, (_, i) => wingOf(i, n)), Array.from({ length: n }, (_, i) => wingOf(i, n)).sort((a, b) => a - b), `${n}: wings fill in seat order`);
  }
  assert.deepEqual([1, 4, 5, 7, 8, 9, 32, 64].map(wingCount), [1, 1, 2, 2, 2, 3, 8, 16]);
  assert.deepEqual([1, 4, 5, 8, 9, 32, 64].map(routLine), [0, 0, 1, 1, 2, 7, 15]);
});

test('a full room launches: every captain has a ship in their wing, reserves scale with the wings', () => {
  const s = launched(64), cadet = create(64, { difficulty: 'cadet' });
  assert.equal(s.captains.length, 64); assert.equal(s.reserves, 2 * 16); assert.equal(cadet.reserves, 3 * 16);
  for (const c of s.captains) { const ship = s.ships.find(x => x.id === c.shipId)!; assert.equal(ship.wing, c.wing); assert.equal(ship.slot, wing(s, c.wing).indexOf(c)); assert.equal(ship.assist, false); }
  assert.deepEqual(s.ships.map(x => x.id), s.captains.map(c => c.shipId), 'ships stay in seat order');
});

test('every wing meets its own squad, sized for it; a single wing fights as before', () => {
  const s = launched(7); fight(s, 'sector');
  assert.deepEqual([allies(s, 0).length, allies(s, 1).length], [4, 3]);
  assert.equal(foes(s, 0).length, 3); assert.ok(foes(s, 1).length >= 2 && foes(s, 1).length <= 3);
  assert.ok(foes(s).every(x => x.wing === 0 || x.wing === 1) && foes(s).every(x => x.scale === 1));
  const one = launched(4); fight(one, 'sector'); assert.ok(foes(one).every(x => x.wing === 0) && foes(one).length === 3);
});

test('captains aim inside their own engagement until it is won, then their guns cover the other wings', () => {
  const s = launched(8); fight(s, ['raider-skiff']);
  const [near] = foes(s, 0), [far] = foes(s, 1), mine = s.ships.find(x => x.id === 's0')!, mate = s.ships.find(x => x.id === 's4')!;
  for (const x of foes(s)) x.weapons = [];
  assert.equal(mine.weapons[0].target?.shipId !== undefined && foes(s, 0).some(x => x.id === mine.weapons[0].target!.shipId), true, 'the computer aims Auto weapons at the own squad');
  assert.throws(() => act(s, 'p0', { type: 'target', weapon: mine.weapons[0].uid, shipId: far.id, roomId: 'shields' }), /own wing's fight/);
  assert.throws(() => act(s, 'p0', { type: 'teleport', crewIds: [s.crew.find(k => k.ownerId === 'c0')!.id], shipId: far.id, roomId: 'shields' }), /teleporter|another wing/);
  act(s, 'p0', { type: 'target', weapon: mine.weapons[0].uid, shipId: near.id, roomId: 'weapons' });
  assert.deepEqual(mine.weapons[0].target, { shipId: near.id, roomId: 'weapons' }, "a captain's own aim stands");
  const halcyon = s.ships.find(x => x.hullId === 'halcyon' && x.wing === 1)!, lance = halcyon.weapons.find(w => w.defId === 'nanite-lance')!, pilot = s.captains.find(c => c.id === halcyon.captainId)!;
  assert.throws(() => act(s, pilot.playerId!, { type: 'target', weapon: lance.uid, shipId: mine.id, roomId: 'helm' }), /another wing/);
  // Wing 0 wins its fight: its ships may now aim anywhere, and even weapons held for a volley join the cover fire.
  for (const w of mine.weapons) w.auto = false;
  kill(s, foes(s, 0)); assert.equal(s.combat!.outcome, null, 'the battle goes on while another wing fights');
  tick(s, 400);
  assert.ok(mine.weapons.filter(w => w.powered).every(w => foes(s, 1).some(x => x.id === w.target?.shipId)), 'a clear wing covers the others');
  act(s, 'p0', { type: 'target', weapon: mine.weapons[0].uid, shipId: far.id, roomId: 'shields' });
  const before = foes(s, 1).reduce((n, x) => n + x.hull + x.shields, 0); tick(s, 30000);
  assert.ok(foes(s, 1).reduce((n, x) => n + x.hull + x.shields, 0) < before || s.combat === null, 'cover fire lands');
  void mate;
});

test('enemies hunt their own wing, then whoever is left; the fleet breaks at its rout line, not at the last ship', () => {
  const s = launched(8); fight(s, ['raider-brawler']);
  tick(s, 1000);
  for (const k of [0, 1]) assert.ok(foes(s, k).flatMap(x => x.weapons).every(w => !w.target || allies(s, k).some(a => a.id === w.target!.shipId)), `squad ${k} fights wing ${k}`);
  kill(s, allies(s, 1)); assert.equal(s.combat!.outcome, null, 'half the fleet is still flying');
  tick(s, 600);
  assert.ok(foes(s, 1).flatMap(x => x.weapons).filter(w => w.powered).every(w => allies(s, 0).some(a => a.id === w.target?.shipId)), 'a squad with no wing left turns on the others');
  kill(s, allies(s, 0).slice(0, 3)); assert.equal(s.combat?.outcome ?? s.result, 'defeat', 'one ship of eight is at the rout line');
  const four = launched(4); fight(four); kill(four, allies(four).slice(0, 3)); assert.equal(four.combat!.outcome, null, 'a single wing fights to the last ship');
});

test('one Flagship fights every wing: fleet-scale hull and shields, a volley into each wing, its share of internal damage', () => {
  const s = launched(12), lone = launched(4);
  fight(s, ['flagship']); fight(lone, ['flagship']);
  const boss = foes(s).find(x => x.hullId === 'flagship')!, small = foes(lone).find(x => x.hullId === 'flagship')!;
  assert.equal(foes(s).filter(x => x.hullId === 'flagship').length, 1); assert.equal(boss.wing, -1); assert.equal(boss.scale, 3); assert.equal(small.scale, 1);
  assert.equal(foes(s).filter(x => x.hullId !== 'flagship').length, 3 * foes(lone).filter(x => x.hullId !== 'flagship').length, 'every wing gets the escorts a lone wing would');
  assert.ok(Math.abs(boss.maxHull / small.maxHull - (-.1 + .6 * 12) / (-.1 + .6 * 4)) < .1, 'hull grows with the whole fleet');
  assert.equal(boss.shields, small.shields * 3);
  // A volley: one shot at its target and one more ship in each other wing.
  s.combat!.projectiles = []; const gun = boss.weapons[0]; gun.charge = 1; gun.target = { shipId: 's0', roomId: 'shields' };
  tick(s, 100);
  const shots = s.combat!.projectiles.filter(p => p.fromShipId === boss.id && p.launchMs >= s.combat!.t - 150), wings = new Set(shots.map(p => s.ships.find(x => x.id === p.toShipId)!.wing));
  assert.deepEqual([...wings].sort(), [0, 1, 2]);
  // Captains of every wing may aim at it.
  for (const c of [s.captains[0], s.captains[5], s.captains[11]]) { const mine = s.ships.find(x => x.id === c.shipId)!; act(s, c.playerId!, { type: 'target', weapon: mine.weapons[0].uid, shipId: boss.id, roomId: 'shields' }); }
});

test('salvage and store shelves belong to wings; scrap is split across the whole fleet', () => {
  const s = launched(8); s.pending = [{ id: 'i-gift', kind: 'augment', defId: 'scrap-magnet', ownerId: null }];
  openLoot(s, 80, [2, 1]);
  assert.equal(s.loot!.scrapEach, 10);
  assert.deepEqual([0, 1].map(k => s.loot!.items.filter(i => i.wing === k).length), [3, 2], 'each wing gets a copy of the event item plus its own pieces');
  const theirs = s.loot!.items.find(i => i.wing === 1)!, ours = s.loot!.items.find(i => i.wing === 0)!;
  assert.throws(() => act(s, 'p0', { type: 'claim', itemId: theirs.id }), /another wing/);
  act(s, 'p0', { type: 'claim', itemId: ours.id }); assert.equal(s.loot!.claims[ours.id], 'c0');
  openStore(s);
  assert.ok([0, 1].every(k => s.offers!.filter(o => o.wing === k && o.kind === 'weapon').length === 6));
  s.captains[0].scrap = 999;
  assert.throws(() => act(s, 'p0', { type: 'buy', offerId: s.offers!.find(o => o.wing === 1)!.id }), /another wing/);
  act(s, 'p0', { type: 'buy', offerId: s.offers!.find(o => o.wing === 0 && o.kind === 'augment')!.id });
});

test('events touch every wing: one ship or recruit each, in one plain line', () => {
  const s = launched(12);
  openEvent(s, 'armada-ambush'); const hulls = () => allies(s).map(x => x.hull);
  const before = hulls(); resolveChoice(s, { id: 'x', label: 'x', outcomes: [{ weight: 1, text: 'Ouch.', effects: [{ kind: 'hull', amount: -3, who: 'random' }, { kind: 'crew' }, { kind: 'hull', amount: -1, who: 'fleet' }] }] }, now);
  const hit = hulls().map((h, i) => before[i] - h);
  assert.deepEqual([0, 1, 2].map(k => allies(s, k).filter((_, i) => hit[allies(s).indexOf(allies(s, k)[i])] === 4).length), [1, 1, 1], 'a random ship in each wing');
  assert.deepEqual(s.event!.outcome!.lines, ['One ship in every wing −3 hull', '3 recruits join the fleet, one to a wing', 'Every ship −1 hull']);
});

test('a big fleet does not wait for its last captain: half ready starts a countdown, four in five cut it short', () => {
  const s = create(10);
  const ready = (i: number) => { act(s, `p${i}`, { type: 'hangar', hullId: 'wayfarer', name: '', paint: '#3fa7ff' }); act(s, `p${i}`, { type: 'ready', ready: true }); };
  for (let i = 0; i < 4; i++) ready(i);
  tick(s, 40000); assert.equal(s.phase, 'hangar', 'four of ten is not half');
  ready(4); tick(s); const at = now;
  assert.equal(s.deadline, at + 30000); tick(s, 29000); assert.equal(s.phase, 'hangar');
  tick(s, 1100); assert.equal(s.phase, 'map'); assert.ok(s.captains.every(c => c.shipId), 'captains who never chose fly the hangar default');
  // A map vote: the first vote opens 20 s; the eighth of ten closes it in 5.
  const link = s.map.nodes.find(n => n.id === s.map.currentId)!.links[0];
  act(s, 'p0', { type: 'vote', nodeId: link }); const opened = now; tick(s, 1000); assert.equal(s.deadline, opened + 20000);
  for (let i = 1; i < 8; i++) act(s, `p${i}`, { type: 'vote', nodeId: link });
  tick(s); assert.ok(s.deadline !== null && s.deadline <= now + 5000); tick(s, 5100); assert.equal(s.map.currentId, link);
  // A single wing still waits for everyone.
  const four = create(4); for (let i = 0; i < 3; i++) { rules.applyAction(four, `p${i}`, rules.parseAction({ turn: four.turn, type: 'hangar', hullId: 'wayfarer', name: '', paint: '#3fa7ff' }), now); rules.applyAction(four, `p${i}`, rules.parseAction({ turn: four.turn, type: 'ready', ready: true }), now); }
  tick(four, 60000); assert.equal(four.phase, 'hangar');
});

test('in a fleet of several wings a pause is a 20 s breather and each captain has one per battle', () => {
  const s = launched(8); fight(s);
  act(s, 'p0', { type: 'pause', paused: true }); assert.equal(s.combat!.paused, true);
  assert.throws(() => act(s, 'p1', { type: 'pause', paused: true }), /already paused/);
  const t = s.combat!.t; tick(s, 19000); assert.equal(s.combat!.t, t, 'time stands still'); tick(s, 1200); assert.equal(s.combat!.paused, false, 'and resumes by itself');
  assert.throws(() => act(s, 'p0', { type: 'pause', paused: true }), /used your pause/);
  act(s, 'p1', { type: 'pause', paused: true }); act(s, 'p5', { type: 'pause', paused: false }); assert.equal(s.combat!.paused, false, 'anyone may resume early');
  const one = launched(2); fight(one);
  for (let i = 0; i < 3; i++) { act(one, 'p0', { type: 'pause', paused: true }); tick(one, 25000); assert.equal(one.combat!.paused, true, 'a single wing pauses as long and as often as it likes'); act(one, 'p0', { type: 'pause', paused: false }); }
});

test('64 captains fit the wire and the save: a public snapshot, a phone\'s own wing and a mid-battle save stay small', () => {
  const run = new Run(64, { difficulty: 'cadet', length: 'short' }, 7919);
  for (let i = 0; i < 20000 && !(run.state.combat && run.state.combat.t > 30000); i++) run.turn(i % 10 === 0);
  assert.ok(run.state.combat, 'reached a battle');
  for (let i = 0; i < 300 && run.state.combat; i++) run.turn(true);
  assert.ok(run.maxLive < 9000, `uncached public snapshot ${run.maxLive} B`);
  assert.ok(run.maxOwn < 16000, `a phone's private snapshot ${run.maxOwn} B`);
  assert.ok(run.maxBytes < 32 * 1024, `a full public snapshot (cached fields included) ${run.maxBytes} B`);
  assert.ok(run.maxSave < MAX_SAVE_BYTES * .8, `save ${run.maxSave} B`);
  const mean = run.ticks.reduce((a, b) => a + b, 0) / run.ticks.length;
  console.log(`# 64 captains: live ${run.maxLive} B, own ${run.maxOwn} B, full ${run.maxBytes} B, save ${run.maxSave} B, battle tick ${mean.toFixed(2)} ms mean`);
});

test('fleet-life events are drawn for fleets of several wings, never for a single wing', () => {
  const life = EVENTS.filter(e => e.fleet);
  assert.ok(life.length >= 10 && life.every(e => e.fleet === 5 && e.id.startsWith('f-')));
  const drawn = (n: number) => { const ids = new Set<string>(); for (let seed = 1; seed <= 60; seed++) { const s = launched(n, {}, seed); for (const kind of ['unknown', 'hostile', 'distress', 'derelict'] as const) { const e = pickEvent(s, kind); if (e) ids.add(e.id); } } return [...ids].filter(id => id.startsWith('f-')); };
  assert.deepEqual(drawn(1), []); assert.deepEqual(drawn(4), []); assert.ok(drawn(5).length >= 3, 'two wings meet them');
});
