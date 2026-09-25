/** Scripted captains that play full runs through the public rules API, plus the balance metrics the campaign tests assert. */
import { assertSerializable } from '../../../party-contract/src/serializable';
import type { Action, PublicView, RoomState, Settings, ShipView } from '../src/contracts';
import { SYSTEMS, weaponDef } from '../src/defs/catalog';
import { PLAYER_HULLS, hullDef } from '../src/defs/hulls';
import { rules } from '../src/server';
import type { State } from '../src/run/state';

export type Move = Action extends infer A ? A extends Action ? Omit<A, 'turn'> : never : never;
const NAMES = ['Mira', 'Oskar', 'Zed', 'Ana'], COLORS = ['#ff5748', '#28c6e7', '#78d955', '#b58aff'];
/** Seconds a table spends on each non-combat decision screen (map vote, event, event result, loot, store). */
export const SCREEN_S = 25;
export const roster = (n: number, prefix = 'p') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: NAMES[i], color: COLORS[i] }));
const frac = (s: ShipView) => s.hull / s.maxHull;
const sys = (s: ShipView, id: RoomState['system']) => s.rooms.find(r => r.system === id && r.tier);

export class Run {
  state: State; now = 1000; view!: PublicView; paused = new Set<string>(); beats = new Set<string>(); volley = false; done = new Set<string>(); maxBytes = 0; rejected: string[] = [];
  /** Combat ms of every finished battle (bosses: Flagship battles only), and the number of non-combat decision screens seen. */
  fights: number[] = []; bosses: number[] = []; screens = 0; private seen = '';
  constructor(players: number, settings: Settings, seed: number, public hulls = PLAYER_HULLS.map(h => h.id)) {
    this.state = rules.create({ roomId: 'r', roundId: 'r1', players: roster(players), seed, nowMs: this.now }, rules.validateSettings(settings));
    this.refresh();
  }
  refresh(check = false) {
    this.view = rules.publicView(this.state, { nowMs: this.now, phase: 'playing' });
    if (check) { assertSerializable(this.view); this.maxBytes = Math.max(this.maxBytes, JSON.stringify(this.view).length); for (const c of this.view.captains) if (c.playerId) assertSerializable(rules.playerView(this.state, c.playerId, { nowMs: this.now, phase: 'playing' })); }
    const v = this.view, key = `${v.turn}:${v.event?.result !== null && v.event ? 'r' : ''}`;
    if (key !== this.seen && ['map', 'event', 'loot', 'store'].includes(v.phase)) this.screens++;
    this.seen = key;
    return v;
  }
  act(playerId: string, move: Move) { rules.applyAction(this.state, playerId, rules.parseAction({ ...move, turn: this.view.turn }), this.now); this.done.add(move.type); this.refresh(); }
  /** For moves whose validity depends on the sim (e.g. firing): record the reason instead of failing. */
  try(playerId: string, move: Move) { try { this.act(playerId, move); return true; } catch (error) { this.rejected.push((error as Error).message); return false; } }
  step(dt = .1) {
    const battle = this.state.combat;
    this.now += dt * 1000; rules.tick(this.state, new Map(), dt, this.now);
    if (battle && this.state.combat !== battle) { this.fights.push(battle.t); if (battle.objective === 'boss') this.bosses.push(battle.t); }
  }
  me(playerId: string) { const c = this.view.captains.find(x => x.playerId === playerId)!; return { c, ship: this.view.ships.find(s => s.id === c.shipId) ?? null }; }
  /** Estimated table time: combat plus SCREEN_S per decision screen. */
  get minutes() { return (this.fights.reduce((a, b) => a + b, 0) / 1000 + this.screens * SCREEN_S) / 60; }

  /** One decision pass for one scripted captain. */
  play(playerId: string) {
    const v = this.view, { c, ship } = this.me(playerId), seat = v.captains.indexOf(c);
    if (!c.connected) return;
    switch (v.phase) {
      case 'hangar': return !c.shipId ? this.act(playerId, { type: 'hangar', hullId: this.hulls[seat % this.hulls.length], name: '', paint: c.color }) : c.ready ? undefined : this.act(playerId, { type: 'ready', ready: true });
      case 'map': { this.refit(playerId); if (c.vote) return;
        const node = v.map.nodes.find(n => n.id === v.map.currentId)!, links = v.map.nodes.filter(n => node.links.includes(n.id)), hurt = frac(ship!) < .5;
        // Hurt captains head for a store or a quiet beacon; the rest wander.
        const choice = hurt || c.scrap >= 120 ? links.find(n => n.kind === 'store') ?? (hurt ? links.find(n => n.kind !== 'hostile') : undefined) : undefined;
        return this.act(playerId, { type: 'vote', nodeId: (choice ?? links[(v.turn + seat) % links.length]).id }); }
      case 'event': { const ev = v.event!;
        if (ev.result !== null) { this.refit(playerId); return c.ready ? undefined : this.act(playerId, { type: 'ready', ready: true }); }
        // Blue options (a fleet capability, not a bribe) two times in three.
        const open = ev.choices.filter(ch => ch.available), blue = open.filter(ch => ch.badge && !ch.badge.endsWith('scrap each')), pool = blue.length && (v.turn + seat) % 3 ? blue : open;
        return c.vote ? undefined : this.act(playerId, { type: 'choose', choiceId: pool[v.turn % pool.length].id }); }
      case 'combat': return this.fight(playerId, ship!);
      case 'loot': { const loot = v.loot!, free = loot.items.find(i => !loot.claims[i.id] && (i.kind === 'weapon' || !ship!.augments.includes(i.defId)));
        if (free && ship!.augments.length < 4 && this.try(playerId, { type: 'claim', itemId: free.id })) return;
        this.refit(playerId); return c.ready ? undefined : this.act(playerId, { type: 'ready', ready: true }); }
      case 'store': { const store = v.store!;
        if (ship!.hull < ship!.maxHull * .8 && c.scrap >= store.repairPrice) return this.act(playerId, { type: 'repair', amount: 40 });
        if (ship!.ammo < 4 && ship!.weapons.some(w => weaponDef(w.defId).ammo) && c.scrap >= store.ammoPrice + 20) return this.act(playerId, { type: 'ammo' });
        if (this.refit(playerId)) return;
        const deal = store.offers.find(o => !o.soldTo && o.price <= c.scrap && (o.kind === 'augment' ? !ship!.augments.includes(o.defId) && ship!.augments.length < 4 : o.kind === 'weapon' && weaponDef(o.defId).tier >= 2 && weaponDef(o.defId).kind !== 'support'));
        if (deal && this.try(playerId, { type: 'buy', offerId: deal.id })) return;
        return c.ready ? undefined : this.act(playerId, { type: 'ready', ready: true }); }
    }
  }
  /** Power idle weapons first, then shields, then engines; mount better cargo weapons over the weakest slot. Returns true if it acted. */
  refit(playerId: string) {
    const { c, ship } = this.me(playerId); if (!ship) return false;
    for (const id of ['weapons', 'shields', 'engines'] as const) {
      const room = ship.rooms.find(r => r.system === id), def = SYSTEMS.find(d => d.id === id)!;
      if (!room || room.tier >= def.maxTier || id === 'weapons' && room.tier >= ship.weapons.length || id === 'engines' && room.tier >= 3) continue;
      if (c.scrap >= def.upgradePrices[room.tier - 1] + 10) { this.act(playerId, { type: 'upgrade', system: id }); return true; }
    }
    // Ion only strips shields, so it counts half: a ship never trades its damage for a second ion gun.
    const value = (id: string) => weaponDef(id).price * (weaponDef(id).kind === 'ion' ? .5 : 1);
    const best = c.cargo.filter(i => weaponDef(i.defId).kind !== 'support').sort((a, b) => value(b.defId) - value(a.defId))[0];
    if (!best) return false;
    const slots = hullDef(ship.hullId).weaponSlots, worst = ship.weapons.reduce((low, w, i) => value(w.defId) < value(ship.weapons[low].defId) ? i : low, 0);
    if (ship.weapons.length < slots) this.act(playerId, { type: 'equip', itemId: best.id, slot: ship.weapons.length });
    else if (value(best.defId) > value(ship.weapons[worst].defId)) this.act(playerId, { type: 'equip', itemId: best.id, slot: worst });
    else return false;
    return true;
  }
  /**
   * The fleet focuses the weakest enemy: bolts and ion at its shields until they are down, then at its weapons; beams and missiles at weapons.
   * Crew rush boarders, fires, breaches and damage; soldiers board through a teleporter; captains pause once, escape when losing.
   */
  fight(playerId: string, ship: ShipView) {
    const v = this.view, combat = v.combat!, { c } = this.me(playerId);
    if (combat.outcome || ship.status !== 'active') return;
    if (combat.paused) { if (combat.pausedBy === c.name) this.act(playerId, { type: 'pause', paused: false }); return; }
    if (combat.t > 8000 && !this.paused.has(combat.id) && v.captains.indexOf(c) === 0) { this.paused.add(combat.id); return this.act(playerId, { type: 'pause', paused: true }); }
    const foes = v.ships.filter(s => s.faction === 'enemy' && s.status === 'active'), friends = v.ships.filter(s => s.faction === 'ally' && s.status === 'active');
    if (!foes.length) return;
    const focus = foes.reduce((a, b) => b.hull < a.hull ? b : a), up = focus.levels.shields ?? 0, manual = ship.weapons.filter(w => ['laser', 'ion', 'beam', 'flak'].includes(weaponDef(w.defId).kind));
    const bolts = (list: typeof manual) => list.reduce((n, w) => { const d = weaponDef(w.defId); return n + (d.kind === 'ion' ? d.ion : d.kind === 'beam' ? 0 : d.shots); }, 0);
    for (const w of ship.weapons) {
      const def = weaponDef(w.defId), ally = friends.reduce((a, b) => frac(b) < frac(a) ? b : a);
      // Missiles knock out the shield room when this ship's own bolts cannot break the layers.
      const room = def.support ? (ally.rooms.filter(r => r.damage).sort((a, b) => b.damage - a.damage)[0] ?? sys(ally, 'shields') ?? ally.rooms[0])
        : (def.kind === 'missile' ? up >= 2 || bolts(manual.filter(x => x.powered)) <= up : up && def.kind !== 'beam') ? sys(focus, 'shields')! : sys(focus, 'weapons') ?? focus.rooms[0];
      const to = def.support ? ally : focus;
      if (w.target?.shipId !== to.id || w.target.roomId !== room.id) return this.act(playerId, { type: 'target', weapon: w.uid, shipId: to.id, roomId: room.id });
    }
    if (this.crew(playerId, ship, focus)) return;
    // Shield-breaking weapons hold for a volley; missiles and support stay on auto.
    const auto = manual.find(w => w.auto); if (auto) return this.act(playerId, { type: 'autofire', weapon: auto.uid, auto: false });
    // Fire with the fleet, or alone when this ship's own charged bolts already outnumber the target's layers.
    const mine = manual.filter(w => w.powered && w.charge >= .999);
    if (mine.length && (this.volley || mine.length === manual.filter(w => w.powered).length && bolts(mine) > focus.shields + focus.tempShield)) return void this.try(playerId, { type: 'fire' });
    const losing = frac(ship) < .3 || friends.reduce((n, s) => n + frac(s), 0) / friends.length < .4;
    if (combat.ftl >= 1 && combat.objective !== 'boss' && losing && !combat.jumpVotes.includes(c.id)) this.try(playerId, { type: 'jump', vote: true });
  }
  /**
   * Crew orders once per 1.5 s: boarders → badly hurt crew to the medbay → fires → breaches → damage → recall hurt boarders →
   * board the focus's least-defended shields/weapons room while its shields are up → stations. Returns true if it acted.
   */
  crew(playerId: string, ship: ShipView, focus: ShipView) {
    const v = this.view, combat = v.combat!, { c } = this.me(playerId), beat = `${combat.id}:${c.id}:${Math.floor(combat.t / 1500)}`;
    if (this.beats.has(beat)) return false;
    this.beats.add(beat);
    const mine = v.crew.filter(k => k.ownerId === c.id), home = mine.filter(k => k.shipId === ship.id && !k.path.length), away = mine.filter(k => k.shipId !== ship.id);
    const boarder = v.crew.find(k => k.faction === 'enemy' && k.shipId === ship.id), tp = sys(ship, 'teleporter'), med = sys(ship, 'medbay');
    const hurt = !boarder && med && ship.levels.medbay ? home.filter(k => k.hp < k.maxHp * (k.role === 'soldier' && tp ? .7 : .35) && k.roomId !== med.id) : [];
    if (hurt.length && this.try(playerId, { type: 'crew', crewIds: hurt.map(k => k.id), roomId: med!.id })) return true;
    const job = boarder ? ship.rooms.find(r => r.id === boarder.roomId) : ship.rooms.find(r => r.fire) ?? ship.rooms.find(r => r.breach) ?? ship.rooms.filter(r => r.system && r.damage).sort((a, b) => b.damage - a.damage)[0];
    const hands = job && home.filter(k => k.roomId !== job.id && (boarder || k.role !== 'pilot' && k.hp > k.maxHp * .5)).slice(0, boarder ? 4 : job.fire ? 2 : 1);
    if (hands?.length) return this.try(playerId, { type: 'crew', crewIds: hands.map(k => k.id), roomId: job!.id });
    if (!tp || !ship.levels.teleporter) return !job && !boarder && home.some(k => k.state === 'idle') && this.try(playerId, { type: 'stations' });
    // Recall a losing away team (less health left than the crew aboard with them) or before their ship blows.
    const there = away.length ? v.crew.filter(k => k.shipId === away[0].shipId && k.faction === 'enemy') : [], hp = (list: typeof there) => list.reduce((n, k) => n + k.hp, 0);
    if (away.length && (hp(away) < hp(there) * .8 || frac(v.ships.find(s => s.id === away[0].shipId)!) < .3)) return this.try(playerId, { type: 'recall', shipId: away[0].shipId });
    const team = mine.filter(k => k.shipId === ship.id && k.role !== 'pilot' && k.hp > k.maxHp * .7).sort((a, b) => +(b.role === 'soldier') - +(a.role === 'soldier')).slice(0, Math.min(ship.levels.teleporter, 3) + 1);
    if (!away.length && team.filter(k => k.role === 'soldier').length >= 2 && focus.levels.shields && frac(focus) > .4) {
      const defenders = (id: string) => v.crew.filter(k => k.shipId === focus.id && k.faction === 'enemy' && k.roomId === id).length;
      const free = (id: string) => { const r = hullDef(focus.hullId).rooms.find(x => x.id === id)!; return r.w * r.h - v.crew.filter(k => k.shipId === focus.id && k.faction === 'ally' && k.roomId === id).length; };
      const room = [sys(focus, 'shields'), sys(focus, 'weapons'), ...focus.rooms.filter(r => r.tier)].filter(r => r && free(r.id) >= 2).sort((a, b) => defenders(a!.id) - defenders(b!.id))[0];
      if (room && !ship.teleportCooldownMs && team.every(k => k.roomId === tp.id && !k.path.length)) return this.try(playerId, { type: 'teleport', crewIds: team.slice(0, free(room.id)).map(k => k.id), shipId: focus.id, roomId: room.id });
      const go = team.filter(k => k.path.at(-1) !== tp.id && k.roomId !== tp.id); if (go.length) return this.try(playerId, { type: 'crew', crewIds: go.map(k => k.id), roomId: tp.id });
    }
    return !job && !boarder && home.some(k => k.state === 'idle') && this.try(playerId, { type: 'stations' });
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

export type Row = { players: number; settings: Settings; seeds: number; wins: number; median: number; fightMedian: number; fightP90: number; longestFight: number; slowFights: number };
const at = (list: number[], q: number) => [...list].sort((a, b) => a - b)[Math.floor(list.length * q)] ?? 0;
/** Play `seeds` runs and summarize: wins, median table minutes, and battle combat seconds (median, 90th percentile, longest, count over 4 minutes). */
export function campaign(players: number, settings: Settings, seeds: number, hulls?: string[]): Row {
  const runs = Array.from({ length: seeds }, (_, i) => { const run = new Run(players, settings, (i + 1) * 7919, hulls); run.finish(400000, 400); return run; }), fights = runs.flatMap(r => r.fights).map(t => t / 1000);
  return { players, settings, seeds, wins: runs.filter(r => r.state.result === 'victory').length, median: at(runs.map(r => r.minutes), .5),
    fightMedian: at(fights, .5), fightP90: at(fights, .9), longestFight: Math.max(...fights), slowFights: fights.filter(t => t > 240).length };
}
