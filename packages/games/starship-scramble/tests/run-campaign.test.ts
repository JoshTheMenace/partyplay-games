/** Full runs through the public rules API with scripted captains: hangar → votes → events → battles → loot → stores → Flagship. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSerializable } from '../../../party-contract/src/serializable';
import type { Action, PublicView, Settings, ShipView } from '../src/contracts';
import { SYSTEMS, weaponDef } from '../src/defs/catalog';
import { PLAYER_HULLS, hullDef } from '../src/defs/hulls';
import { rules } from '../src/server';
import type { State } from '../src/run/state';

type Move = Action extends infer A ? A extends Action ? Omit<A, 'turn'> : never : never;
const NAMES = ['Mira', 'Oskar', 'Zed', 'Ana'], COLORS = ['#ff5748', '#28c6e7', '#78d955', '#b58aff'];
const roster = (n: number, prefix = 'p') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: NAMES[i], color: COLORS[i] }));

class Run {
  state: State; now = 1000; view!: PublicView; paused = new Set<string>(); orders = new Set<string>(); volley = false; done = new Set<string>(); maxBytes = 0; rejected: string[] = [];
  constructor(players: number, settings: Settings, seed: number) {
    this.state = rules.create({ roomId: 'r', roundId: 'r1', players: roster(players), seed, nowMs: this.now }, rules.validateSettings(settings));
    this.refresh();
  }
  refresh(check = false) {
    this.view = rules.publicView(this.state, { nowMs: this.now, phase: 'playing' });
    if (check) { assertSerializable(this.view); this.maxBytes = Math.max(this.maxBytes, JSON.stringify(this.view).length); for (const c of this.view.captains) if (c.playerId) assertSerializable(rules.playerView(this.state, c.playerId, { nowMs: this.now, phase: 'playing' })); }
    return this.view;
  }
  act(playerId: string, move: Move) { rules.applyAction(this.state, playerId, rules.parseAction({ ...move, turn: this.view.turn }), this.now); this.done.add(move.type); this.refresh(); }
  /** For moves whose validity depends on the sim (e.g. firing): record the reason instead of failing. */
  try(playerId: string, move: Move) { try { this.act(playerId, move); return true; } catch (error) { this.rejected.push((error as Error).message); return false; } }
  step(dt = .1) { this.now += dt * 1000; rules.tick(this.state, new Map(), dt, this.now); }
  me(playerId: string) { const c = this.view.captains.find(x => x.playerId === playerId)!; return { c, ship: this.view.ships.find(s => s.id === c.shipId) ?? null }; }

  /** One decision pass for one scripted captain. */
  play(playerId: string) {
    const v = this.view, { c, ship } = this.me(playerId);
    if (!c.connected) return;
    switch (v.phase) {
      case 'hangar': return !c.shipId ? this.act(playerId, { type: 'hangar', hullId: PLAYER_HULLS[v.captains.indexOf(c) % 5].id, name: '', paint: c.color }) : c.ready ? undefined : this.act(playerId, { type: 'ready', ready: true });
      case 'map': { if (c.scrap >= 100) this.refit(playerId); const node = v.map.nodes.find(n => n.id === v.map.currentId)!, links = v.map.nodes.filter(n => node.links.includes(n.id));
        const choice = links.find(n => n.kind === 'store') ?? links[(v.turn + v.captains.indexOf(c)) % links.length];
        return c.vote ? undefined : this.act(playerId, { type: 'vote', nodeId: choice.id }); }
      case 'event': { const ev = v.event!;
        if (ev.result !== null) return c.ready ? undefined : this.act(playerId, { type: 'ready', ready: true });
        const open = ev.choices.filter(ch => ch.available);
        return c.vote ? undefined : this.act(playerId, { type: 'choose', choiceId: open[v.turn % open.length].id }); }
      case 'combat': return this.fight(playerId, ship!);
      case 'loot': { const loot = v.loot!, free = loot.items.find(i => !loot.claims[i.id] && (i.kind === 'weapon' || !ship!.augments.includes(i.defId)));
        if (free && ship!.augments.length < 4 && this.try(playerId, { type: 'claim', itemId: free.id })) return;
        this.refit(playerId); return c.ready ? undefined : this.act(playerId, { type: 'ready', ready: true }); }
      case 'store': { const store = v.store!;
        if (ship!.hull < ship!.maxHull * .7 && c.scrap >= store.repairPrice) return this.act(playerId, { type: 'repair', amount: 40 });
        if (ship!.ammo < 4 && ship!.weapons.some(w => weaponDef(w.defId).ammo) && c.scrap >= store.ammoPrice + 20) return this.act(playerId, { type: 'ammo' });
        const deal = store.offers.find(o => !o.soldTo && o.price <= c.scrap && (o.kind === 'augment' ? !ship!.augments.includes(o.defId) && ship!.augments.length < 4 : o.kind === 'weapon' && weaponDef(o.defId).tier >= 2 && weaponDef(o.defId).kind !== 'support'));
        if (deal && this.try(playerId, { type: 'buy', offerId: deal.id })) return;
        this.refit(playerId); return c.ready ? undefined : this.act(playerId, { type: 'ready', ready: true }); }
    }
  }
  /** Spend scrap on power for idle weapons, then shields, then engines; mount better cargo weapons over the weakest slot. */
  refit(playerId: string) {
    const { c, ship } = this.me(playerId); if (!ship) return;
    for (const id of ['weapons', 'shields', 'engines'] as const) {
      const room = ship.rooms.find(r => r.system === id), def = SYSTEMS.find(d => d.id === id)!;
      if (!room || room.tier >= def.maxTier || id === 'weapons' && room.tier >= ship.weapons.length) continue;
      if (c.scrap >= def.upgradePrices[room.tier - 1] + 10) return this.act(playerId, { type: 'upgrade', system: id });
    }
    const best = c.cargo.filter(i => weaponDef(i.defId).kind !== 'support').sort((a, b) => weaponDef(b.defId).price - weaponDef(a.defId).price)[0];
    if (!best) return;
    const slots = hullDef(ship.hullId).weaponSlots, worst = ship.weapons.reduce((low, w, i) => weaponDef(w.defId).price < weaponDef(ship.weapons[low].defId).price ? i : low, 0);
    if (ship.weapons.length < slots) this.act(playerId, { type: 'equip', itemId: best.id, slot: ship.weapons.length });
    else if (weaponDef(best.defId).price > weaponDef(ship.weapons[worst].defId).price) this.act(playerId, { type: 'equip', itemId: best.id, slot: worst });
  }
  /** Target enemy weapons rooms (support weapons on the weakest ally), pause once per battle, jump away from long stalemates. */
  fight(playerId: string, ship: ShipView) {
    const v = this.view, combat = v.combat!, { c } = this.me(playerId);
    if (combat.outcome || ship.status !== 'active') return;
    if (combat.paused) { if (combat.pausedBy === c.name) this.act(playerId, { type: 'pause', paused: false }); return; }
    if (combat.t > 8000 && !this.paused.has(combat.id) && v.captains.indexOf(c) === 0) { this.paused.add(combat.id); return this.act(playerId, { type: 'pause', paused: true }); }
    const foes = v.ships.filter(s => s.faction === 'enemy' && s.status === 'active'), friends = v.ships.filter(s => s.faction === 'ally' && s.status === 'active');
    for (const w of ship.weapons) {
      if (w.target && v.ships.find(s => s.id === w.target!.shipId)?.status === 'active') continue;
      const support = weaponDef(w.defId).target === 'ally', to = support ? friends.reduce((a, b) => b.hull / b.maxHull < a.hull / a.maxHull ? b : a) : foes[0];
      if (!to || support && to.id === ship.id) continue;
      const room = to.rooms.find(r => r.system === 'weapons' && r.tier) ?? to.rooms[0];
      return this.act(playerId, { type: 'target', weapon: w.uid, shipId: to.id, roomId: room.id });
    }
    // Every 3 s: rush boarders with everyone aboard, else send a spare hand to the worst damaged system, else man stations.
    const beat = `${combat.id}:${c.id}:${Math.floor(combat.t / 3000)}`;
    if (!this.orders.has(beat)) {
      this.orders.add(beat);
      const mine = v.crew.filter(k => k.ownerId === c.id && k.state !== 'dead' && k.shipId === ship.id && !k.path.length);
      const boarder = v.crew.find(k => k.faction === 'enemy' && k.state !== 'dead' && k.shipId === ship.id), damaged = ship.rooms.filter(r => r.system && r.damage).sort((a, b) => b.damage - a.damage)[0];
      const spare = damaged && !mine.some(k => k.roomId === damaged.id) && mine.find(k => k.role !== 'pilot');
      if (boarder && mine.some(k => k.roomId !== boarder.roomId)) return void this.try(playerId, { type: 'crew', crewIds: mine.filter(k => k.roomId !== boarder.roomId).slice(0, 4).map(k => k.id), roomId: boarder.roomId });
      if (spare) return void this.try(playerId, { type: 'crew', crewIds: [spare.id], roomId: damaged.id });
      if (!boarder && !damaged) return void this.try(playerId, { type: 'stations' });
    }
    // Shield-breaking weapons hold for a volley; missiles and support stay on auto.
    const manual = ship.weapons.filter(w => ['laser', 'ion', 'beam', 'flak'].includes(weaponDef(w.defId).kind));
    const auto = manual.find(w => w.auto); if (auto) return this.act(playerId, { type: 'autofire', weapon: auto.uid, auto: false });
    if (this.volley && manual.some(w => w.powered && w.target)) return void this.try(playerId, { type: 'fire' });
    if (combat.ftl >= 1 && combat.objective !== 'boss' && combat.t > 150000 && !combat.jumpVotes.includes(c.id)) this.act(playerId, { type: 'jump', vote: true });
  }
  /** One 100 ms beat: every captain decides, then the room ticks. The fleet fires together once every held weapon in it is charged. */
  turn(check = false) {
    const held = this.view.combat ? this.view.ships.filter(s => s.faction === 'ally' && s.status === 'active').flatMap(s => s.weapons.filter(w => !w.auto && w.powered && w.target)) : [];
    this.volley = held.length > 0 && held.every(w => w.charge >= .999);
    for (const c of this.view.captains) if (c.playerId) this.play(c.playerId);
    this.step();
    this.refresh(check);
  }
  /** Play until the run ends or the step budget runs out; returns the result. */
  finish(budget = 400000, every = 40) {
    for (let i = 0; i < budget && this.state.result === null; i++) this.turn(i % every === 0);
    return this.state.result;
  }
}

const ctx = (players: ReturnType<typeof roster>, nowMs: number) => ({ roomId: 'r', roundId: 'r2', players, seed: 99, nowMs });
/** Play a fresh 4-captain Captain run until a battle is `ms` of combat time old. */
function midBattle(ms = 12000) {
  const run = new Run(4, { difficulty: 'captain', length: 'standard' }, 3);
  while (!(run.state.combat && run.state.combat.t > ms && !run.state.combat.outcome && !run.state.combat.paused)) { run.turn(); assert(run.state.result === null, 'battle reached'); }
  return run;
}

test('cadet short run reaches victory against the Flagship with every kind of order', () => {
  // A fixed seed list keeps the test meaningful if combat tuning shifts which seed wins.
  const needed = ['hangar', 'ready', 'vote', 'choose', 'target', 'autofire', 'fire', 'pause', 'crew', 'stations', 'claim', 'buy', 'upgrade', 'equip'];
  let run: Run | undefined;
  for (let seed = 1; seed <= 12 && !run; seed++) { const r = new Run(4, { difficulty: 'cadet', length: 'short' }, seed); if (r.finish(400000, 1) === 'victory' && needed.every(type => r.done.has(type))) run = r; }
  assert(run, 'some fixed seed wins while using every order (every view checked serializable)');
  assert(run.paused.size > 0, 'captains paused and resumed battles');
  assert(run.maxBytes < 24 * 1024, `views stay under 24 KB (${run.maxBytes})`);
  const outcome = rules.outcome(run.state);
  assertSerializable(outcome);
  assert.equal(outcome.complete, true); assert.deepEqual(outcome.winners.sort(), ['p0', 'p1', 'p2', 'p3']);
  assert(outcome.rows.every(row => /^\d+ dmg · \d+ kills?$/.test(row.label!) && row.score! >= 0));
  assert(run.state.fleetStats.kills > 0 && run.state.fleetStats.jumps > 0 && run.state.captains.some(c => c.stats.damage > 0 && c.stats.repairs > 0));
  assert.equal(run.view.phase, 'over'); assert.throws(() => run.act('p0', { type: 'ready', ready: true }), /over/);
});

for (const players of [1, 4]) test(`captain standard runs always end (${players} captain${players > 1 ? 's' : ''}, 20 seeds)`, () => {
  for (let seed = 1; seed <= 20; seed++) {
    const run = new Run(players, { difficulty: 'captain', length: 'standard' }, seed * 7919);
    const result = run.finish();
    assert(result === 'victory' || result === 'defeat', `seed ${seed} ended with ${result} in phase ${run.state.phase}`);
    assert(run.maxBytes < 24 * 1024, `seed ${seed} view ${run.maxBytes} bytes`);
    assertSerializable(rules.outcome(run.state));
  }
});

test('save → load mid-battle reseats new players, pauses the battle and plays on', () => {
  const run = midBattle(), save = JSON.parse(JSON.stringify(rules.exportSave!(run.state)));
  assert.equal(run.state.combat!.paused, false, 'exporting does not touch the live state');
  const fresh = roster(2, 'q'), { state, settings } = rules.loadSave!(ctx(fresh, run.now), save, { difficulty: 'cadet', length: 'short' });
  assert.deepEqual(settings, { difficulty: 'captain', length: 'standard' });
  assert.equal(state.combat!.paused, true); assert.equal(state.phase, 'combat');
  assert.deepEqual(state.captains.map(c => c.playerId), ['q0', 'q1', null, null]);
  assert.deepEqual(state.captains.map(c => state.ships.find(s => s.id === c.shipId)!.autopilot), [false, false, true, true]);
  assert.equal(state.captains[0].name, 'Mira');
  assert.throws(() => rules.applyAction(state, 'p0', { type: 'pause', paused: false, turn: state.turn }, run.now), /watching/);
  const resumed = Object.assign(run, { state }); resumed.refresh();
  resumed.act('q0', { type: 'pause', paused: false });
  assert.equal(resumed.finish() === null, false, 'the loaded run still reaches an end');
});

test('saves are validated strictly', () => {
  const run = midBattle(), good = () => JSON.parse(JSON.stringify(rules.exportSave!(run.state))), load = (raw: unknown) => rules.loadSave!(ctx(roster(4), 5), raw, { difficulty: 'captain', length: 'standard' });
  load(good());
  const broken: ((save: any) => void)[] = [
    save => { save.v = 2; }, save => { save.state.ships[0].hullId = 'x-wing'; }, save => { save.state.ships[0].weapons[0].defId = 'death-ray'; },
    save => { save.state.captains.push({ ...save.state.captains[0], id: 'c9' }); }, save => { save.state.captains = []; }, save => { save.state.crew[0].shipId = 'nowhere'; },
    save => { save.state.ships[0].hull = 'lots'; }, save => { save.state.extra = 1; }, save => { save.state.map.nodes[0].links.push('n9-9'); }, save => { save.state.phase = 'loot'; },
    save => { save.state.combat.projectiles = Array(300).fill(save.state.combat.projectiles[0] ?? {}); }, save => { save.state.captains[0].cargo.push({ id: 'i1', kind: 'weapon', defId: 'ion-cannon-9000', ownerId: null }); },
    save => { save.state.event = { defId: 'not-an-event', outcome: null, next: null }; }, save => { delete save.state.ships[1].rooms; },
    // Review findings: prototype keys, runaway loot bonus, bad boss phase, empty enemy lists, missing hull/enemy refs, reused id counter.
    save => { save.state.crew[0].constructor = 'x'; }, save => { save.state.fight.bonus = 1e9; }, save => { save.state.ships.at(-1).phase = -2; },
    save => { save.state.event = { defId: 'armada-ambush', outcome: null, next: { kind: 'combat', enemies: [] } }; }, save => { save.state.captains[0].hullId = null; },
    save => { save.state.ships.find((x: any) => x.faction === 'enemy').enemyId = null; }, save => { save.state.nextId = 0; },
  ];
  for (const [i, breakIt] of broken.entries()) { const save = good(); breakIt(save); assert.throws(() => load(save), Error, `broken save ${i} rejected`); }
  assert.throws(() => load({ v: 1, state: { ...good().state, rng: Infinity } }), /serializable/);
  assert.throws(() => load(null));
});

test('finish suspends the run; loading resumes it', () => {
  const run = midBattle(4000);
  rules.finish!(run.state, run.now);
  assert.equal(rules.outcome(run.state).complete, true); assert.equal(run.state.result, 'suspended'); assert.deepEqual(rules.outcome(run.state).winners, []);
  const { state } = rules.loadSave!(ctx(roster(4), run.now), JSON.parse(JSON.stringify(rules.exportSave!(run.state))), run.state.settings);
  assert.equal(state.result, null); assert.equal(rules.outcome(state).complete, false);
});

test('disconnected captains fly on autopilot and never block votes or readiness', () => {
  const run = new Run(2, { difficulty: 'cadet', length: 'short' }, 5);
  run.act('p0', { type: 'hangar', hullId: 'bulwark', name: '  Rock  ', paint: '#AABBCC' });
  rules.onPresenceChange(run.state, 'p1', false, run.now); run.refresh();
  assert.equal(run.view.captains[1].connected, false);
  run.act('p0', { type: 'ready', ready: true }); run.step(); run.refresh();
  assert.equal(run.view.phase, 'map', 'launches without the absent captain');
  assert.equal(run.view.ships[0].name, 'Rock'); assert.equal(run.view.ships[0].paint, '#aabbcc');
  assert.equal(run.view.ships[1].hullId, PLAYER_HULLS[1].id, 'absent captains get a default hull');
  assert.deepEqual(run.view.ships.map(s => s.autopilot), [false, true]);
  const node = run.view.map.nodes.find(n => n.id === run.view.map.currentId)!;
  run.act('p0', { type: 'vote', nodeId: node.links[0] });
  assert.equal(run.view.voteDeadline, run.now + 20000);
  run.step(); run.refresh(); assert.equal(run.view.voteDeadline, run.now + 1500, 'every connected captain voted: jump in 1.5 s');
  for (let i = 0; i < 15; i++) run.step();
  run.refresh(); assert.equal(run.view.map.currentId, node.links[0]); assert(run.view.phase !== 'map' || run.view.map.nodes.find(n => n.id === node.links[0])!.visited);
  rules.onPresenceChange(run.state, 'p1', true, run.now); run.refresh();
  assert.deepEqual(run.view.ships.map(s => s.autopilot), [false, false]);
  rules.onPresenceChange(run.state, 'stranger', true, run.now);
});

test('a 4v4 battle view stays under the 24 KB snapshot budget', async () => {
  const [{ startFight }, { enemyDef }, { createShip }] = await Promise.all([import('../src/run/combat'), import('../src/content/enemies'), import('../src/sim')]);
  const run = new Run(4, { difficulty: 'captain', length: 'standard' }, 11), squad = ['armada-dreadnought', 'vesk-brood', 'raider-gunship', 'warden-sentinel'];
  while (run.view.phase !== 'map') run.turn();
  startFight(run.state, { kind: 'combat', enemies: squad }, true);
  assert.deepEqual(run.state.ships.filter(s => s.faction === 'enemy').map(s => s.enemyId), ['vesk-brood', 'raider-gunship', 'armada-dreadnought'], 'explicit squads are trimmed, weakest first, to the fleet-size count');
  // Real squads top out at 3 enemies; add the fourth by hand to measure the 4v4 worst case.
  const d = enemyDef(squad[3]);
  run.state.ships.push(createShip({ id: 'e-extra', faction: 'enemy', captainId: null, enemyId: d.id, hullId: d.hullId, name: d.name, paint: '#6a7688', slot: 3, systems: d.systems, weapons: d.weapons, ammo: 6, augments: [], ai: d.ai, fleeBelow: 0, phases: [] }));
  run.refresh();
  for (let i = 0; i < 1500 && !run.state.combat!.outcome; i++) run.turn(true);
  assert(run.maxBytes < 24 * 1024, `peak ${run.maxBytes} bytes`);
});
