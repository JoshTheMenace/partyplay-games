/** Rules-level checks: parsing, turns and phases, map generation, events, loot, store, refits, battles, rebuilds and defeat. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSerializable } from '../../../party-contract/src/serializable';
import type { Action, Settings } from '../src/contracts';
import type { ChoiceDef } from '../src/content/types';
import { SECTORS, sectorDef } from '../src/content/sectors';
import { ENEMIES } from '../src/content/enemies';
import { ENEMY_IDS } from '../src/content/types';
import { EVENTS } from '../src/content/events';
import { systemDef, weaponDef } from '../src/defs/catalog';
import { hullDef } from '../src/defs/hulls';
import { rules } from '../src/server';
import { startFight } from '../src/run/combat';
import { badge, eventView, meets, resolveChoice } from '../src/run/events';
import { openStore } from '../src/run/fleet';
import { openEvent } from '../src/run/flow';
import { COLUMNS, SHORT_COLUMNS, generateMap, mapView } from '../src/run/map';
import { living, type State } from '../src/run/state';

const NAMES = ['Mira', 'Oskar', 'Zed', 'Ana'];
const create = (n = 2, settings: Partial<Settings> = {}, seed = 1) =>
  rules.create({ roomId: 'r', roundId: 'r1', players: NAMES.slice(0, n).map((name, i) => ({ id: `p${i}`, name, color: ['#ff5748', '#28c6e7', '#78d955', '#b58aff'][i] })), seed, nowMs: 0 }, rules.validateSettings(settings));
let now = 0;
const act = (s: State, player: string, action: Record<string, unknown>) => rules.applyAction(s, player, rules.parseAction({ turn: s.turn, ...action }), now);
const tick = (s: State, ms = 100) => { for (let t = 0; t < ms; t += 100) { now += 100; rules.tick(s, new Map(), .1, now); } };
/** A fleet on the sector map (hulls in hangar order). */
function launched(n = 2, settings: Partial<Settings> = {}, seed = 1) {
  const s = create(n, settings, seed);
  s.captains.forEach((c, i) => { act(s, c.playerId!, { type: 'hangar', hullId: ['wayfarer', 'lancer', 'bulwark', 'corsair'][i], name: '', paint: c.color }); act(s, c.playerId!, { type: 'ready', ready: true }); });
  tick(s);
  assert.equal(s.phase, 'map');
  return s;
}
const ship = (s: State, i = 0) => s.ships.find(x => x.id === s.captains[i].shipId)!;
const fight = (s: State, enemies: string[] = ['raider-skiff']) => { startFight(s, { kind: 'combat', enemies }, false); tick(s, 3100); };
const killAll = (s: State, faction: 'ally' | 'enemy') => { for (const x of s.ships) if (x.faction === faction && x.status === 'active') { x.hull = 0; x.phases = []; } tick(s, 200); };

test('settings default and reject unknown values', () => {
  assert.deepEqual(rules.validateSettings({}), { difficulty: 'captain', length: 'standard' });
  assert.deepEqual(rules.validateSettings({ difficulty: 'cadet', length: 'short' }), { difficulty: 'cadet', length: 'short' });
  for (const bad of [null, [], 'cadet', { difficulty: 'hard' }, { length: 'epic' }, { difficulty: 'cadet', extra: 1 }]) assert.throws(() => rules.validateSettings(bad));
  assert.equal(rules.parseInput({ anything: 1 }), null); assert.equal(rules.neutralInput(), null);
});

test('parseAction accepts every action shape and rejects malformed payloads', () => {
  const good: Record<string, unknown>[] = [
    { type: 'hangar', hullId: 'wayfarer', name: '  Star Duck  ', paint: '#AABBCC' }, { type: 'ready', ready: false }, { type: 'vote', nodeId: 'n1-0' }, { type: 'choose', choiceId: 'fight' },
    { type: 'target', weapon: 's0-w0', shipId: 'e3', roomId: 'shields' }, { type: 'untarget', weapon: 's0-w0' }, { type: 'autofire', weapon: 's0-w1', auto: false }, { type: 'fire' },
    { type: 'crew', crewIds: ['k1', 'k2'], roomId: 'helm' }, { type: 'stations' }, { type: 'teleport', crewIds: ['k1'], shipId: 'e3', roomId: 'weapons' }, { type: 'recall', shipId: 'e3' },
    { type: 'cloak' }, { type: 'pause', paused: true }, { type: 'jump', vote: true }, { type: 'claim', itemId: 'i4' }, { type: 'buy', offerId: 'o2' }, { type: 'sell', itemId: 'auto-loader' },
    { type: 'repair', amount: 40 }, { type: 'ammo' }, { type: 'upgrade', system: 'shields' }, { type: 'equip', itemId: 'i4', slot: 5 }, { type: 'unequip', slot: 0 },
  ];
  for (const action of good) assert.deepEqual(rules.parseAction({ ...action, turn: 3 }), { ...action, turn: 3, ...action.type === 'hangar' && { name: 'Star Duck' } });
  const bad: unknown[] = [
    null, 7, 'fire', [], { type: 'fire' }, { type: 'fire', turn: -1 }, { type: 'fire', turn: 1.5 }, { type: 'fire', turn: '1' }, { type: 'launch', turn: 1 }, { type: 'toString', turn: 1 },
    { type: 'fire', turn: 1, extra: true }, { type: 'vote', turn: 1 }, { type: 'vote', turn: 1, nodeId: 'n 1' }, { type: 'vote', turn: 1, nodeId: 'x'.repeat(65) }, { type: 'vote', turn: 1, nodeId: 3 },
    { type: 'hangar', turn: 1, hullId: 'wayfarer', name: 'A name far too long', paint: '#aabbcc' }, { type: 'hangar', turn: 1, hullId: 'wayfarer', name: 'Bad\u0007', paint: '#aabbcc' },
    { type: 'hangar', turn: 1, hullId: 'wayfarer', name: 'Ok', paint: 'red' }, { type: 'hangar', turn: 1, hullId: 'wayfarer', name: 'Ok', paint: '#abc' },
    { type: 'crew', turn: 1, crewIds: [], roomId: 'helm' }, { type: 'crew', turn: 1, crewIds: ['a', 'b', 'c', 'd', 'e'], roomId: 'helm' }, { type: 'crew', turn: 1, crewIds: ['a', 'a'], roomId: 'helm' },
    { type: 'repair', turn: 1, amount: 0 }, { type: 'repair', turn: 1, amount: 41 }, { type: 'repair', turn: 1, amount: 2.5 }, { type: 'equip', turn: 1, itemId: 'i1', slot: 6 }, { type: 'unequip', turn: 1, slot: -1 },
    { type: 'ready', turn: 1, ready: 'yes' }, { type: 'hire', turn: 1, species: 'vesk', role: 'pilot' }, { type: 'hire', turn: 1, species: 'human', role: 'captain' }, { type: 'upgrade', turn: 1, system: 'lasers' },
    { type: 'pause', turn: 1, paused: true, when: undefined }, { type: 'jump', turn: 1, vote: NaN },
  ];
  for (const raw of bad) assert.throws(() => rules.parseAction(raw), Error, JSON.stringify(raw));
});

test('stale turns, wrong phases and spectators are rejected without side effects', () => {
  const s = create(2), before = JSON.stringify(s);
  const reject = (player: string, action: Action, message: RegExp) => { assert.throws(() => rules.applyAction(s, player, action, 0), message); assert.equal(JSON.stringify(s), before); };
  reject('p0', { type: 'ready', ready: true, turn: 0 }, /Pick a hull/);
  reject('p0', { type: 'hangar', hullId: 'wayfarer', name: '', paint: '#ffffff', turn: 5 }, /moment has passed/);
  reject('p0', { type: 'hangar', hullId: 'flagship', name: '', paint: '#ffffff', turn: 0 }, /hangar hulls/);
  reject('p0', { type: 'vote', nodeId: 'n1-0', turn: 0 }, /sector map/);
  reject('p0', { type: 'fire', turn: 0 }, /only works in battle/);
  reject('p0', { type: 'buy', offerId: 'o1', turn: 0 }, /trading post/);
  reject('p0', { type: 'upgrade', system: 'shields', turn: 0 }, /between battles/);
  reject('p9', { type: 'ready', ready: true, turn: 0 }, /watching/);
  const m = launched(2);
  assert.throws(() => act(m, 'p0', { type: 'vote', nodeId: 'n6-0' }), /cannot reach/);
  assert.throws(() => act(m, 'p0', { type: 'hangar', hullId: 'lancer', name: '', paint: '#ffffff' }), /already launched/);
  const turn = m.turn; act(m, 'p0', { type: 'vote', nodeId: m.map.nodes[0].links[0] });
  assert.equal(m.turn, turn, 'votes do not bump the turn');
  // A failure deep inside an action (after earlier mutation would have happened) leaves the state untouched.
  m.captains[0].scrap = 1000; const snapshot = JSON.stringify(m);
  assert.throws(() => act(m, 'p0', { type: 'equip', itemId: 'nope', slot: 0 }), /not in your cargo/);
  assert.equal(JSON.stringify(m), snapshot);
});

test('sector maps: 7 columns (9 in a short run), single start and exit, a trading post before the Flagship, every beacon reachable (200 seeds)', () => {
  let hostile = 0, middle = 0;
  for (let seed = 1; seed <= 200; seed++) for (const def of SECTORS) {
    const final = def.id === 'meridian', map = generateMap({ rng: seed }, def, final), byId = new Map(map.nodes.map(n => [n.id, n]));
    assert.equal(map.columns, COLUMNS); assert.equal(map.armadaCol, -1);
    const col = (c: number) => map.nodes.filter(n => n.col === c);
    assert.equal(col(0).length, 1); assert.equal(col(0)[0].kind, 'start'); assert.equal(map.currentId, col(0)[0].id);
    assert.equal(col(COLUMNS - 1).length, 1); assert.equal(col(COLUMNS - 1)[0].kind, final ? 'boss' : 'exit');
    for (let c = 1; c < COLUMNS - 1; c++) assert(final && c === COLUMNS - 2 ? col(c).length === 1 && col(c)[0].kind === 'store' : col(c).length >= 2 && col(c).length <= 4);
    for (const n of map.nodes) {
      assert(n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1);
      for (const l of n.links) assert.equal(byId.get(l)!.col, n.col + 1, 'links go one column forward');
      if (n.col < COLUMNS - 1) assert(n.links.length > 0, 'every beacon leads on');
    }
    const reach = new Set([map.currentId]); for (const n of map.nodes) if (reach.has(n.id)) n.links.forEach(l => reach.add(l));
    assert.equal(reach.size, map.nodes.length, 'every beacon is reachable');
    const stores = map.nodes.filter(n => n.kind === 'store' && n.col < COLUMNS - 2);
    assert(stores.length >= 1 && stores.length <= 2 && stores.every(n => n.col >= 2 && n.col <= 4));
    if (def.id === 'veil') assert(map.nodes.some(n => n.kind === 'nebula' && n.hazard === 'nebula'));
    else assert(!map.nodes.some(n => n.kind === 'nebula'));
    const mids = map.nodes.filter(n => n.col > 0 && n.col < COLUMNS - 2); middle += mids.length; hostile += mids.filter(n => n.kind === 'hostile').length;
  }
  assert(hostile / middle > .3 && hostile / middle < .45, `hostile share ${hostile / middle}`);
  assert.deepEqual(generateMap({ rng: 7 }, sectorDef('veil'), false), generateMap({ rng: 7 }, sectorDef('veil'), false), 'seeded');
  const short = generateMap({ rng: 7 }, sectorDef('rustbelt'), true, SHORT_COLUMNS);
  assert.deepEqual([short.columns, short.nodes.filter(n => n.col >= SHORT_COLUMNS - 2).map(n => n.kind)], [9, ['store', 'boss']]);
});

test('nebulae hide neighboring beacon kinds until revealed', () => {
  const map = generateMap({ rng: 3 }, sectorDef('veil'), false), nebula = map.nodes.find(n => n.kind === 'nebula')!;
  const next = map.nodes.find(n => nebula.links.includes(n.id) && !['exit', 'nebula'].includes(n.kind));
  if (next) assert.equal(mapView(map, false).nodes.find(n => n.id === next.id)!.kind, 'unknown');
  assert.equal(mapView(map, true), map);
});

test('content the engine relies on is complete and sane', () => {
  for (const id of ['armada-ambush', 'flagship-hail']) assert.deepEqual(EVENTS.find(e => e.id === id)?.kinds, [], id);
  for (const e of EVENTS) {
    assert(!e.choices.length || e.choices.some(c => !c.requires), `${e.id} keeps a choice any fleet can take`);
    for (const effect of e.choices.flatMap(c => c.outcomes.flatMap(o => o.effects))) if (effect.kind === 'event') assert(EVENTS.some(x => x.id === effect.eventId), `${e.id} chains to ${effect.eventId}`);
  }
  assert.deepEqual(ENEMIES.map(e => e.id).sort(), [...ENEMY_IDS].sort());
  for (const e of ENEMIES) {
    const hull = hullDef(e.hullId);
    for (const w of e.weapons) weaponDef(w);
    assert(e.weapons.length <= hull.weaponSlots && e.scrap[0] <= e.scrap[1] && e.threat > 0, e.id);
    for (const room of hull.rooms) if (room.system) assert(room.system in e.systems, `${e.id} lists ${room.system}`);
    for (const [id, tier] of Object.entries(e.systems)) assert(hull.rooms.some(r => r.system === id) && tier! <= systemDef(id).maxTier, `${e.id} ${id}`);
    assert(!hull.automated || !e.crew.length);
  }
  const boss = ENEMIES.find(e => e.id === 'flagship')!;
  assert.equal(boss.phases!.length, 3); assert(boss.phases!.every((p, i, all) => i === 0 || p.maxHull > all[i - 1].maxHull));
  assert.deepEqual(SECTORS.map(s => [s.id, s.tier]), [['rustbelt', 1], ['veil', 2], ['meridian', 3]]);
});

test('requirement badges and availability follow the fleet', () => {
  const s = launched(2); // Wayfarer (burst laser, missile) and Lancer (laser, ion, pike beam)
  const cases: [Parameters<typeof badge>[1], string, boolean][] = [
    [{ kind: 'system', system: 'teleporter', tier: 1 }, 'Teleporter', false], [{ kind: 'system', system: 'engines', tier: 3 }, 'Engines 3', true],
    [{ kind: 'weapon', weaponKind: 'beam' }, 'Beam weapon', true], [{ kind: 'weapon', weaponKind: 'flak' }, 'Flak weapon', false],
    [{ kind: 'species', species: 'bastion' }, 'Bastion crew', true], [{ kind: 'species', species: 'ember' }, 'Ember crew', false],
    [{ kind: 'role', role: 'engineer' }, 'Engineer crew', true], [{ kind: 'augment', augment: 'hull-welders' }, 'Hull Welders', false],
    [{ kind: 'scrap', amount: 20 }, '20 scrap each', true], [{ kind: 'scrap', amount: 21 }, '21 scrap each', false],
  ];
  for (const [req, text, ok] of cases) { assert.equal(badge(s, req), text); assert.equal(meets(s, req), ok, text); }
  s.captains[0].scrap = 42; s.captains[1].scrap = 0;
  assert.equal(meets(s, { kind: 'scrap', amount: 21 }), true, 'richer captains cover poorer ones');
  s.sectorIndex = 1; assert.equal(badge(s, { kind: 'scrap', amount: 20 }), '26 scrap each', 'costs scale with sector tier');
  const blue = EVENTS.find(e => e.kinds.length && e.choices.some(c => c.requires))!;
  openEvent(s, blue.id);
  const view = eventView(s)!;
  assertSerializable(view);
  for (const [i, ch] of blue.choices.entries()) { assert.equal(view.choices[i].badge, ch.requires ? badge(s, ch.requires) : null); assert.equal(view.choices[i].available, !ch.requires || meets(s, ch.requires)); }
  const locked = view.choices.find(c => !c.available);
  if (locked) assert.throws(() => act(s, 'p0', { type: 'choose', choiceId: locked.id }), /needs/);
});

test('choices pay pooled costs, apply effects with plain lines, then Continue chains onward', () => {
  const s = launched(2);
  openEvent(s, EVENTS.find(e => e.kinds.length)!.id);
  s.captains[0].scrap = 50; s.captains[1].scrap = 4;
  const choice: ChoiceDef = { id: 'x', label: 'Test', requires: { kind: 'scrap', amount: 10 }, outcomes: [{ weight: 1, text: 'Done.', effects: [
    { kind: 'scrap', amount: 30 }, { kind: 'hull', amount: -4, who: 'weakest' }, { kind: 'crew', species: 'bastion', role: 'soldier' }, { kind: 'item', item: 'weapon', id: 'flak-cannon' },
    { kind: 'armada', amount: 2 }, { kind: 'reserves', amount: 1 }, { kind: 'flag', flag: 'met-test' }, { kind: 'reveal' }, { kind: 'store' },
  ] }] };
  ship(s, 1).hull = 20;
  resolveChoice(s, choice, now);
  assert.deepEqual(s.captains.map(c => c.scrap), [34 + 30, 30], 'Oskar pays 4, Mira covers the other 16');
  assert.deepEqual(s.event!.outcome!.lines, ['−10 scrap each', '+30 scrap each', "Oskar's Lancer −4 hull", 'A Bastion soldier joins Mira', 'Flak Cannon added to the spoils', 'The Armada gains 2 beacons', '+1 fleet reserve hull', 'Sector map revealed']);
  assert.equal(ship(s, 1).hull, 16); assert.equal(s.map.armadaCol, 1); assert.equal(s.reserves, 3); assert.deepEqual(s.flags, ['met-test']); assert.equal(s.revealed, true);
  assert.equal(living(s, 'c0').length, 4);
  act(s, 'p0', { type: 'ready', ready: true }); tick(s);
  assert.equal(s.phase, 'event', 'waits for every connected captain');
  act(s, 'p1', { type: 'ready', ready: true }); tick(s);
  assert.equal(s.phase, 'store', 'the store effect opens a store');
  assert.equal(s.pending.length, 1, 'event spoils wait for the next loot screen');
  s.captains.forEach(c => act(s, c.playerId!, { type: 'ready', ready: true })); tick(s);
  assert.equal(s.phase, 'map');
});

test('fleet votes: plurality after the deadline, seeded ties, Continue auto-advances after 20 s', () => {
  const s = launched(3), [a, b] = s.map.nodes[0].links.length > 1 ? s.map.nodes[0].links : [s.map.nodes[0].links[0], s.map.nodes[0].links[0]];
  act(s, 'p0', { type: 'vote', nodeId: a }); const deadline = s.deadline!;
  act(s, 'p1', { type: 'vote', nodeId: b }); act(s, 'p2', { type: 'vote', nodeId: b });
  tick(s); assert(s.deadline! < deadline, 'all voted: jump after 1.5 s');
  tick(s, 1500); assert.equal(s.map.currentId, b); assert.equal(s.fleetStats.jumps, 1); assert.equal(s.map.armadaCol, 0);
  const tie = () => { const t = launched(2, {}, 4), links = t.map.nodes[0].links; act(t, 'p0', { type: 'vote', nodeId: links[0] }); act(t, 'p1', { type: 'vote', nodeId: links.at(-1)! }); tick(t, 1700); return t.map.currentId; };
  assert.equal(tie(), tie(), 'ties break by the seeded roll');
  const e = launched(2); openEvent(e, EVENTS.find(x => x.kinds.includes('distress'))!.id);
  act(e, 'p0', { type: 'choose', choiceId: eventView(e)!.choices.find(c => c.available)!.id });
  tick(e, 19000); assert.equal(e.event!.outcome, null, 'waits for the absent vote');
  tick(e, 1100); assert(e.event?.outcome || e.phase !== 'event', 'resolves 20 s after the first vote');
  if (e.phase === 'event') { tick(e, 20100); assert.notEqual(e.phase, 'event', 'Continue times out after 20 s'); }
});

test('loot: first come first served, scrap split with remainder carried, unclaimed items lost', () => {
  const s = launched(3);
  fight(s); killAll(s, 'enemy'); tick(s, 2600);
  assert.equal(s.phase, 'loot');
  const loot = s.loot!, each = loot.scrapEach;
  assert(each > 0 && loot.items.length >= 1 && s.scrapCarry < 3);
  assert(s.captains.every(c => c.stats.scrapEarned === each));
  const [first] = loot.items;
  act(s, 'p1', { type: 'claim', itemId: first.id });
  assert.throws(() => act(s, 'p2', { type: 'claim', itemId: first.id }), /already claimed/);
  assert.equal(s.loot!.claims[first.id], 'c1');
  assert(first.kind === 'augment' ? ship(s, 1).augments.includes(first.defId) : [...ship(s, 1).weapons.map(w => w.defId), ...s.captains[1].cargo.map(i => i.defId)].includes(first.defId));
  s.captains.forEach(c => act(s, c.playerId!, { type: 'ready', ready: true })); tick(s);
  assert.equal(s.phase, 'map'); assert.equal(s.loot, null);
});

test('store and refits: buy, sell, repair, missiles, recruits, upgrade, install, equip and unequip', () => {
  // Accepted actions commit a fresh copy of the state, so always read through the state root.
  const s = launched(2), c = () => s.captains[0], w = () => ship(s), room = (id: string) => w().rooms.find(r => r.system === id)!;
  openStore(s);
  const kinds = (kind: string) => s.offers!.filter(o => o.kind === kind);
  assert.equal(kinds('weapon').length, 4, 'two weapons plus one per captain'); assert.equal(new Set(kinds('weapon').map(o => o.defId)).size, 4, 'no duplicate weapons');
  assert.equal(kinds('augment').length, 2); assert.ok(kinds('crew').length <= 1); assert.ok(kinds('crew').every(o => o.crew?.role === o.defId));
  assert.ok(kinds('system').every(o => s.ships.some(x => x.rooms.some(r => r.system === o.defId && !r.tier))), 'only installable systems');
  c().scrap = 1000;
  const weapon = s.offers!.find(o => o.kind === 'weapon')!;
  act(s, 'p0', { type: 'buy', offerId: weapon.id });
  assert.equal(c().scrap, 1000 - weapon.price); assert.equal(s.offers!.find(o => o.id === weapon.id)!.soldTo, 'c0');
  assert.throws(() => act(s, 'p1', { type: 'buy', offerId: weapon.id }), /already bought/);
  assert.equal(w().weapons.length, 3, 'a free slot mounts the weapon'); assert.equal(w().weapons[2].defId, weapon.defId);
  w().hull = 20; c().scrap = 9;
  act(s, 'p0', { type: 'repair', amount: 40 }); assert.equal(w().hull, 24); assert.equal(c().scrap, 1, 'repairs as much as you can afford');
  assert.throws(() => act(s, 'p0', { type: 'repair', amount: 1 }), /per hull point/);
  c().scrap = 500;
  act(s, 'p0', { type: 'ammo' }); assert.equal(w().ammo, hullDef('wayfarer').startAmmo + 3);
  s.offers!.push({ id: 'o-crew', kind: 'crew', defId: 'soldier', price: 50, soldTo: null, crew: { name: 'Wren', species: 'ember', role: 'soldier' } });
  act(s, 'p0', { type: 'buy', offerId: 'o-crew' }); assert.equal(living(s, 'c0').length, 4); assert.ok(living(s, 'c0').some(k => k.name === 'Wren' && k.species === 'ember' && k.role === 'soldier'));
  const price = systemDef('shields').upgradePrices[0], scrap = c().scrap;
  act(s, 'p0', { type: 'upgrade', system: 'shields' }); assert.equal(room('shields').tier, 2); assert.equal(c().scrap, scrap - price); assert.equal(w().shields, 2);
  room('shields').tier = systemDef('shields').maxTier; assert.throws(() => act(s, 'p0', { type: 'upgrade', system: 'shields' }), /already at tier/);
  assert.throws(() => act(s, 'p0', { type: 'upgrade', system: 'defense' }), /no Point Defense room/);
  act(s, 'p0', { type: 'upgrade', system: 'cloak' }); assert.equal(room('cloak').tier, 1, 'optional systems install into their empty room');
  act(s, 'p0', { type: 'unequip', slot: 0 });
  assert.equal(w().weapons.length, 2); assert.equal(c().cargo[0].defId, 'burst-laser'); assert.deepEqual(w().weapons.map(x => x.uid), [`${w().id}-w0`, `${w().id}-w1`]);
  act(s, 'p0', { type: 'equip', itemId: c().cargo[0].id, slot: 1 });
  assert.equal(w().weapons[1].defId, 'burst-laser'); assert.equal(c().cargo.length, 1, 'the displaced weapon goes to cargo');
  assert.throws(() => act(s, 'p0', { type: 'equip', itemId: c().cargo[0].id, slot: 3 }), /3 weapon slots/);
  const sold = c().cargo[0], before = c().scrap;
  act(s, 'p0', { type: 'sell', itemId: sold.id }); assert.equal(c().scrap, before + Math.floor(weaponDef(sold.defId).price / 2)); assert.equal(c().cargo.length, 0);
  w().augments = ['reinforced-plating']; w().maxHull += 6;
  act(s, 'p0', { type: 'sell', itemId: 'reinforced-plating' }); assert.equal(w().maxHull, 30); assert.deepEqual(w().augments, []);
  assert.throws(() => act(s, 'p0', { type: 'sell', itemId: 'nothing' }), /can be sold/);
  const system = s.offers!.find(o => o.kind === 'system')!, target = w().rooms.find(r => r.system === system.defId);
  if (!target || target.tier) assert.throws(() => act(s, 'p0', { type: 'buy', offerId: system.id }), /no room|already have/);
  else { act(s, 'p0', { type: 'buy', offerId: system.id }); assert.equal(room(system.defId).tier, 1); }
});

test('battles: pause and resume, jump votes, escape costs a beacon', () => {
  const s = launched(2);
  fight(s);
  act(s, 'p1', { type: 'pause', paused: true }); assert.equal(s.combat!.pausedBy, 'Oskar');
  const t = s.combat!.t; tick(s, 500); assert.equal(s.combat!.t, t, 'paused battles stand still');
  act(s, 'p0', { type: 'target', weapon: ship(s).weapons[0].uid, shipId: s.ships.find(x => x.faction === 'enemy')!.id, roomId: 'weapons' });
  assert.equal(ship(s).weapons[0].target!.roomId, 'weapons', 'orders work while paused');
  act(s, 'p0', { type: 'pause', paused: false }); assert.equal(s.combat!.pausedBy, null);
  assert.throws(() => act(s, 'p0', { type: 'jump', vote: true }), /still charging/);
  assert.throws(() => act(s, 'p0', { type: 'upgrade', system: 'shields' }), /between battles/);
  s.combat!.ftl = 1;
  act(s, 'p0', { type: 'jump', vote: true }); tick(s); assert.equal(s.combat!.outcome, null, 'one of two is not a majority');
  act(s, 'p1', { type: 'jump', vote: true }); tick(s); assert.equal(s.combat!.outcome, 'escaped');
  tick(s, 2600);
  assert.equal(s.phase, 'map'); assert.equal(s.map.armadaCol, 0); assert(s.ships.every(x => x.faction === 'ally'));
  startFight(s, { kind: 'combat', enemies: ['flagship'] }, false); tick(s, 3100);
  s.combat!.ftl = 1; assert.throws(() => act(s, 'p0', { type: 'jump', vote: true }), /no running/);
});

test('destroyed captains are rebuilt from reserves, then fly lifeboats', () => {
  const s = launched(2), w = ship(s);
  w.rooms.find(r => r.system === 'shields')!.tier = 2; s.captains[0].cargo.push({ id: 'i99', kind: 'weapon', defId: 'flak-cannon', ownerId: 'c0' });
  fight(s);
  const away = living(s, 'c0')[0]; Object.assign(away, { shipId: ship(s, 1).id, roomId: ship(s, 1).rooms[0].id });
  w.hull = 0; tick(s, 200);
  assert.equal(w.status, 'destroyed'); assert.equal(rules.publicView(s, { nowMs: now, phase: 'playing' }).captains[0].status, 'wrecked');
  killAll(s, 'enemy'); tick(s, 2600);
  const rebuilt = ship(s);
  assert.equal(s.phase, 'loot'); assert.equal(s.reserves, 1); assert.equal(s.fleetStats.lostShips, 1);
  assert.equal(rebuilt.hullId, 'wayfarer'); assert.equal(rebuilt.hull, 15); assert.equal(rebuilt.rooms.find(r => r.system === 'shields')!.tier, 2, 'upgrades kept');
  assert.deepEqual(rebuilt.weapons.map(x => x.defId), ['burst-laser', 'swift-missile']); assert.deepEqual(s.captains[0].cargo, [], 'cargo is lost');
  const crew = living(s, 'c0');
  assert.equal(crew.length, 2, 'the survivor plus one fresh recruit'); assert(crew.some(k => k.id === away.id && k.shipId === rebuilt.id), 'survivors elsewhere come home');
  s.reserves = 0; leaveLoot(s);
  fight(s); ship(s).hull = 0; tick(s, 200); killAll(s, 'enemy'); tick(s, 2600);
  const boat = ship(s);
  assert.equal(boat.hullId, 'lifeboat'); assert.equal(boat.hull, hullDef('lifeboat').maxHull); assert.equal(living(s, 'c0').length, 2);
  assert.equal(rules.publicView(s, { nowMs: now, phase: 'playing' }).captains[0].status, 'lifeboat');
});
const leaveLoot = (s: State) => { s.captains.forEach(c => act(s, c.playerId!, { type: 'ready', ready: true })); tick(s); };

test('losing every ship in one battle ends the run in defeat', () => {
  const s = launched(2);
  fight(s); killAll(s, 'ally'); tick(s, 2600);
  assert.equal(s.phase, 'over'); assert.equal(s.result, 'defeat'); assert.equal(s.fleetStats.lostShips, 2);
  assert.deepEqual(rules.outcome(s), { complete: true, winners: [], rows: s.captains.map(c => ({ playerId: c.playerId!, score: c.stats.damage + 25 * c.stats.kills, label: `${c.stats.damage} dmg · ${c.stats.kills} kills` })) });
});

test('the Flagship scales with the fleet and its final phase wins the run', () => {
  const solo = launched(1, { length: 'short', difficulty: 'cadet' }), four = launched(4);
  for (const s of [solo, four]) startFight(s, { kind: 'combat', enemies: ['flagship'] }, false);
  const boss = (s: State) => s.ships.find(x => x.enemyId === 'flagship')!;
  assert.deepEqual(four.ships.filter(x => x.faction === 'enemy').map(x => x.enemyId), ['flagship', 'armada-gunship', 'armada-gunship'], 'two escorts join 4 captains');
  assert.equal(solo.ships.filter(x => x.faction === 'enemy').length, 1);
  assert(boss(four).maxHull > boss(solo).maxHull * 2);
  assert(boss(solo).phases.every(p => p.systems.shields === 1 && p.systems.weapons! <= 2 && !p.systems.teleporter), 'solo: one shield layer, two powered weapons, no boarders');
  assert.equal(solo.combat!.objective, 'boss');
  tick(solo, 3100);
  for (let phase = 0; phase < 3; phase++) { boss(solo).hull = 0; tick(solo, 200); }
  assert.equal(boss(solo).status, 'destroyed'); tick(solo, 2600);
  assert.equal(solo.result, 'victory'); assert.deepEqual(rules.outcome(solo).winners, ['p0']);
});
