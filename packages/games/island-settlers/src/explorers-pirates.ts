import {acting, building, edge, event, has, need, phase, player, random, transfer, vertex} from './core';
import {COSTS, RESOURCES, type Tile} from './model';
import type {Cargo, ExpeditionShip, ExpansionAction, ExpansionCommand, Mission} from './expansion-model';
import type {State} from './state';
import {shuffled} from './board';
import {announce, choice, command, cost, extra, payCoins, take} from './expansion-common';

export const sea = (t: Tile) => t.terrain === 'sea' || t.terrain === 'shoal';
export const moving = (s: State, id: string) => !!s.modules?.players[id].movement && !s.readyIds.includes(id) && (s.settings.mode === 'connect' && s.phase === 'action' || s.phase === 'movement' && s.actorId === id);
const size = (cargo: Cargo[]) => cargo.reduce((n, c) => n + (c.kind === 'settler' || c.kind === 'fish' ? 2 : 1), 0);
const shipTiles = (s: State, ship: ExpeditionShip) => { const e = edge(s, ship.edge)!; return [...new Set([e.a, e.b].flatMap(v => vertex(s, v)!.tiles))]; };
export function initializeExplorers(s: State) {
  if (s.settings.expansion !== 'explorers') return;
  const m = s.modules!, hidden = s.board.tiles.filter(t => t.island > 0), missions = s.settings.missions ?? [], specials: Tile['terrain'][] = [];
  for (const mission of missions) specials.push(...Array(6).fill(mission === 'lairs' ? 'gold' : mission === 'fish' ? 'shoal' : 'spice'));
  const kinds = shuffled([...specials, ...Array(4).fill('sea'), ...hidden.slice(specials.length + 4).map((_, i) => RESOURCES[i % 5])], () => random(s));
  let shoals = 0, farms = 0;
  hidden.forEach((t, i) => { const terrain = kinds[i] ?? RESOURCES[i % 5]; m.fog[t.id] = { ...t, terrain, number: terrain === 'shoal' ? ++shoals : terrain === 'spice' ? farms++ % 3 : RESOURCES.includes(terrain as never) || terrain === 'gold' ? [3, 4, 5, 6, 8, 9, 10, 11][i % 8] : 0 }; t.terrain = 'fog'; t.number = 0; t.island = -2; });
  const coast = s.board.edges.filter(e => e.land && e.sea && e.tiles.some(t => s.board.tiles.find(x => x.id === t)?.island === 0)), councilEdge = [...coast].sort((a, b) => vertex(s, a.a)!.x - vertex(s, b.a)!.x)[0];
  m.public.explorers = { ships: [], harbors: [], council: [councilEdge.a, councilEdge.b], pirateOwner: null, lairs: [], shoals: [], spices: [], missionOwners: { lairs: null, fish: null, spices: null } };
  for (const p of s.players) extra(s, p.id).coins = 2;
  if (!s.settings.citiesKnights) s.deck = [];
  s.board.ports = []; s.robber = ''; s.pirate = null; refreshEdges(s);
}
export function refreshEdges(s: State) {
  for (const e of s.board.edges) { const tiles = e.tiles.map(id => s.board.tiles.find(t => t.id === id)!); e.land = tiles.some(t => !sea(t) && t.terrain !== 'fog'); e.sea = tiles.some(sea); }
}
export function exploredBuild(s: State, id: string, tiles: string[]) {
  const v = s.modules?.public.explorers; if (!v) return true;
  return tiles.every(id => s.board.tiles.find(t => t.id === id)!.terrain !== 'fog') && tiles.every(at => !v.lairs.some(l => l.tile === at && !l.captured)) && tiles.every(at => !v.spices.some(f => f.tile === at && !f.visitors.includes(id)));
}
export function expeditionSetupKind(s: State): 'settlement' | 'city' | 'harbor' {
  return s.settings.citiesKnights ? s.setupIndex < s.players.length ? 'city' : 'harbor' : s.setupIndex < s.players.length ? 'harbor' : 'settlement';
}
export function newShip(s: State, id: string, at: string, cargo: Cargo[] = []) {
  const v = s.modules!.public.explorers!; need(v.ships.filter(x => x.playerId === id).length < 3, 'Recall one of your three ships before building another.');
  const ship: ExpeditionShip = { id: `s${++s.serial}`, playerId: id, edge: at, cargo, remaining: 0 }; v.ships.push(ship); return ship;
}
export function shipBuildSites(s: State, id: string, setup = false) {
  const v = s.modules!.public.explorers!;
  return s.board.edges.filter(e => e.sea && e.tiles.every(t => s.board.tiles.find(x => x.id === t)?.terrain !== 'fog') && v.ships.filter(sh => sh.edge === e.id).length < 2 && [e.a, e.b].some(at => setup ? at === s.setupVertex : building(s, at)?.playerId === id && building(s, at)?.kind === 'harbor')).map(e => e.id);
}
export function settlementSites(s: State, id: string, ship: ExpeditionShip) {
  const e = edge(s, ship.edge)!;
  if (s.buildings.filter(b => b.playerId === id && b.kind === 'settlement').length >= 5) return [];
  return [e.a, e.b].filter(at => { const v = vertex(s, at)!; return !building(s, at) && !s.modules!.public.knights.some(k => k.vertex === at) && exploredBuild(s, id, v.tiles) && v.tiles.some(t => !sea(s.board.tiles.find(x => x.id === t)!)) && v.edges.every(e => { const x = edge(s, e)!; return !building(s, x.a === at ? x.b : x.a); }); });
}
function capacity(s: State, id: string, kind: 'settler' | 'crew') {
  const v = s.modules!.public.explorers!, cargo = [...v.ships.filter(x => x.playerId === id).flatMap(x => x.cargo), ...v.harbors.filter(h => building(s, h.vertex)?.playerId === id).flatMap(h => h.cargo)];
  return kind === 'settler' ? 2 - cargo.filter(c => c.kind === kind).length : 9 - cargo.filter(c => c.kind === 'crew').length - v.lairs.reduce((n, l) => n + l.crews.filter(p => p === id).length, 0) - v.spices.filter(f => f.visitors.includes(id)).length;
}
function containers(s: State, id: string) {
  const v = s.modules!.public.explorers!;
  return [...v.harbors.filter(h => building(s, h.vertex)?.playerId === id).map(h => ({ id: h.vertex, cargo: h.cargo })), ...v.ships.filter(sh => sh.playerId === id && [edge(s, sh.edge)!.a, edge(s, sh.edge)!.b].some(at => building(s, at)?.playerId === id && building(s, at)?.kind === 'harbor')).map(sh => ({ id: sh.id, cargo: sh.cargo }))];
}
function allContainers(s: State, id: string) { const v = s.modules!.public.explorers!; return [...v.harbors.filter(h => building(s, h.vertex)?.playerId === id).map(h => ({ id: h.vertex, cargo: h.cargo })), ...v.ships.filter(sh => sh.playerId === id).map(sh => ({ id: sh.id, cargo: sh.cargo }))]; }
export function startExpeditionMovement(s: State, id: string) {
  const v = s.modules?.public.explorers; if (!v) return;
  const speed = v.spices.filter(f => f.benefit === 'speed' && f.visitors.includes(id)).length;
  for (const ship of v.ships.filter(sh => sh.playerId === id)) ship.remaining = 4 + speed;
}
function destinations(s: State, ship: ExpeditionShip) {
  const x = extra(s, ship.playerId), v = s.modules!.public.explorers!, paths = new Map<string, { moves: number; tribute: boolean }>(), todo = [{ at: ship.edge, moves: 0, tribute: false }], visited = new Set([ship.edge]);
  for (const step of todo) {
    if (step.moves >= ship.remaining) continue;
    const e = edge(s, step.at)!;
    for (const next of s.board.edges.filter(n => n.sea && [n.a, n.b].some(at => at === e.a || at === e.b) && !n.tiles.some(t => s.modules!.fog[t]))) {
      if (visited.has(next.id)) continue;
      const tribute = step.tribute || !!(v.pirateOwner !== ship.playerId && s.pirate && [...e.tiles, ...next.tiles].includes(s.pirate) && !x.piratePaid.includes(ship.id) && !x.piratePaid.includes('all'));
      if (tribute && !x.coins) continue;
      visited.add(next.id); const path = { moves: step.moves + 1, tribute };
      if (v.ships.filter(sh => sh.edge === next.id).length < 2) paths.set(next.id, path);
      else if (![next.a, next.b].some(at => vertex(s, at)!.tiles.some(t => s.modules!.fog[t]))) todo.push({ at: next.id, ...path });
    }
  }
  return paths;
}
export function expeditionCommands(s: State, id: string): ExpansionCommand[] {
  const v = s.modules?.public.explorers; if (!v) return [];
  const p = player(s, id), x = extra(s, id), result: ExpansionCommand[] = [], act = acting(s, p), moves = moving(s, id), mine = v.ships.filter(sh => sh.playerId === id);
  if (act) {
    if (s.buildings.filter(b => b.playerId === id && b.kind === 'harbor').length < 4) result.push(command('exp:harbor', 'Expeditions', 'Build a harbor settlement', 'Two VP, one resource per producing hex, and two cargo spaces.', [choice('target', 'Coastal settlement', s.buildings.filter(b => b.playerId === id && b.kind === 'settlement' && vertex(s, b.vertex)!.edges.some(e => edge(s, e)!.sea)).map(b => b.vertex), 'vertex')], cost({ grain: 2, ore: 2 })));
    if (mine.length < 3) result.push(command('exp:build', 'Expeditions', 'Build an expedition ship', 'Build beside your harbor. Ships carry one large or two small pieces.', [choice('target', 'Launch edge', shipBuildSites(s, id), 'edge')], COSTS.ship));
    if (mine.length) result.push(command('exp:recall', 'Expeditions', 'Recall a ship', 'Return this ship and its cargo to your supply.', [choice('ship', 'Ship to recall', mine.map(sh => sh.id))]));
    for (const kind of ['settler', 'crew'] as const) if (capacity(s, id, kind) > 0) result.push(command(`exp:buy:${kind}`, 'Expeditions', `Build ${kind}`, kind === 'settler' ? 'A settler uses both spaces and becomes a coastal settlement.' : 'Crews capture pirate lairs and trade with spice farms.', [choice('container', 'Harbor or docked ship', containers(s, id).filter(c => size(c.cargo) + (kind === 'settler' ? 2 : 1) <= 2).map(c => c.id))], kind === 'settler' ? COSTS.settlement : cost({ wool: 1, ore: 1 })));
    const goldFarms = v.spices.filter(f => f.benefit === 'gold' && f.visitors.includes(id)).length;
    if (x.fastGold < goldFarms) result.push(command('exp:fast-gold', 'Expeditions', 'Fast gold', 'Trade one resource or commodity for one gold per visited Fast Gold farm.', [choice('good', 'Card', [...RESOURCES, ...(s.settings.citiesKnights ? ['paper', 'cloth', 'coin'] : [])].filter(r => p.hand[r as keyof typeof p.hand]))]));
  }
  if (moves) {
    if (!x.fishRolled && s.settings.missions?.includes('fish')) result.push(command('exp:fish-roll', 'Expeditions', 'Find a fish haul', 'Roll once per movement phase. A matching discovered shoal may gain a haul.'));
    for (const ship of mine.filter(sh => !x.finishedShips.includes(sh.id) && (!x.activeShip || x.activeShip === sh.id))) {
      const near = shipTiles(s, ship), e = edge(s, ship.edge)!;
      if (ship.remaining > 0) {
        result.push(command(`exp:move:${ship.id}`, 'Expeditions', `Sail ${ship.id} · ${ship.remaining} moves`, 'Choose the next sea edge. Full edges may be passed; discovering a hex ends movement.', [choice('target', 'Sea edge', [...destinations(s, ship).keys()], 'edge')]));
        if (!x.shipBoosts.includes(ship.id)) result.push(command(`exp:boost:${ship.id}`, 'Expeditions', `Boost ${ship.id} · +2 moves`, 'Spend one wool. Once per ship per turn.', [], cost({ wool: 1 })));
      }
      if (!x.pirateAttempts.includes(ship.id) && v.pirateOwner && v.pirateOwner !== id && s.pirate && near.includes(s.pirate) && !x.activeShip) result.push(command(`exp:fight:${ship.id}`, 'Expeditions', `Chase the pirate with ${ship.id}`, 'Try before moving. A six succeeds; visited pirate farms improve your chance.'));
      if (ship.cargo.some(c => c.kind === 'settler')) result.push(command(`exp:settle:${ship.id}`, 'Expeditions', 'Land your settlers', 'Return the ship and settler, then place a coastal settlement.', [choice('target', 'Settlement site', settlementSites(s, id, ship), 'vertex')]));
      if (ship.cargo.some(c => c.kind === 'crew')) {
        result.push(command(`exp:crew:${ship.id}`, 'Expeditions', 'Land one crew', 'Visit a spice farm or help capture a pirate lair.', [choice('target', 'Destination hex', [...v.lairs.filter(l => !l.captured && l.crews.length < 3).map(l => l.tile), ...v.spices.filter(f => !f.visitors.includes(id)).map(f => f.tile)].filter(t => near.includes(t)), 'tile')]));
      }
      if (!ship.cargo.length) result.push(command(`exp:fish:${ship.id}`, 'Expeditions', 'Load fish haul', 'A haul uses both cargo spaces.', [choice('target', 'Fish shoal', v.shoals.filter(f => f.fish && near.includes(f.tile)).map(f => f.tile), 'tile')]));
      if (size(ship.cargo) < 2) result.push(command(`exp:retrieve:${ship.id}`, 'Expeditions', 'Recover a crew', 'Recover a crew from a captured lair.', [choice('target', 'Captured lair', v.lairs.filter(l => l.captured && l.crews.includes(id) && near.includes(l.tile)).map(l => l.tile), 'tile')]));
      if ([e.a, e.b].some(at => v.council.includes(at)) && ship.cargo.some(c => c.kind === 'spice' || c.kind === 'fish')) result.push(command(`exp:deliver:${ship.id}`, 'Expeditions', 'Deliver to the Council', 'Deliver all fish and spices on this ship for mission progress.'));
      result.push(command(`exp:finish:${ship.id}`, 'Expeditions', `Finish moving ${ship.id}`, 'Move another ship after finishing this one.'));
    }
    for (const h of v.harbors.filter(h => building(s, h.vertex)?.playerId === id)) for (const ship of mine.filter(sh => [edge(s, sh.edge)!.a, edge(s, sh.edge)!.b].includes(h.vertex) && !x.finishedShips.includes(sh.id) && (!x.activeShip || x.activeShip === sh.id))) {
      for (const [from, to] of [[{ id: h.vertex, cargo: h.cargo }, ship], [ship, { id: h.vertex, cargo: h.cargo }]]) {
        const options = from.cargo.map((c, i) => ({ value: String(i), label: c.kind })).filter(o => size(to.cargo) + (['fish', 'settler'].includes(from.cargo[Number(o.value)].kind) ? 2 : 1) <= 2);
        if (options.length) result.push(command(`exp:transfer:${from.id}:${to.id}`, 'Expeditions', 'Transfer cargo at harbor', 'Move one cargo piece without spending movement points.', [{ key: 'cargo', label: 'Cargo', options }]));
      }
    }
  }
  if (act || moves) for (const c of allContainers(s, id).filter(c => c.cargo.length)) result.push(command(`exp:discard:${c.id}`, 'Expeditions', 'Return cargo to supply', 'Make room by removing cargo. This cannot be undone.', [{ key: 'cargo', label: 'Cargo', options: c.cargo.map((x, i) => ({ value: String(i), label: x.kind })) }]));
  return result.filter(c => c.fields.every(f => f.optional || f.options.length) && (!c.cost || has(p.hand, c.cost)));
}
function discover(s: State, ship: ExpeditionShip) {
  const m = s.modules!, v = m.public.explorers!;
  for (const id of shipTiles(s, ship)) {
    const hidden = m.fog[id]; if (!hidden) continue;
    const tile = s.board.tiles.find(t => t.id === id)!; Object.assign(tile, hidden); delete m.fog[id]; ship.remaining = 0;
    if (RESOURCES.includes(tile.terrain as never)) take(s, ship.playerId, tile.terrain as 'wood', 1); else extra(s, ship.playerId).coins += 2;
    if (tile.terrain === 'gold') { v.lairs.push({ tile: id, captured: false, crews: [] }); m.lairNumbers[id] = tile.number; tile.number = 0; }
    if (tile.terrain === 'shoal') { v.shoals.push({ tile: id, number: tile.number, fish: false }); tile.number = 0; }
    if (tile.terrain === 'spice') { v.spices.push({ tile: id, benefit: (['speed', 'pirate', 'gold'] as const)[tile.number], visitors: [] }); tile.number = 0; }
    event(s, 'build', `${player(s, ship.playerId).name} discovered ${tile.terrain}`, ship.playerId, id);
  }
  refreshEdges(s);
}
export function missionProgress(s: State, id: string, mission: Mission, n = 1) {
  const v = s.modules!.public.explorers!, p = extra(s, id); p.missions[mission] = Math.min(mission === 'spices' ? 6 : 7, p.missions[mission] + n);
  const incumbent = v.missionOwners[mission];
  if (!incumbent || p.missions[mission] > extra(s, incumbent).missions[mission]) v.missionOwners[mission] = id;
}
export function expeditionPirateTargets(s: State) {
  return s.board.tiles.filter(t => sea(t) && s.board.edges.filter(e => e.tiles.includes(t.id)).every(e => e.tiles.length === 2) && !s.board.tiles.some(other => other.island === 0 && Math.hypot(t.x - other.x, t.y - other.y) < 1.8) && t.id !== s.pirate).map(t => t.id);
}
export function applyExpedition(s: State, id: string, a: ExpansionAction, now: number) {
  const m = s.modules!, v = m.public.explorers!, p = player(s, id), x = extra(s, id), [, op, shipId, toId] = a.command.split(':'), at = a.choices.target;
  const ship = v.ships.find(sh => sh.id === shipId && sh.playerId === id);
  if (op === 'harbor') { building(s, at)!.kind = 'harbor'; v.harbors.push({ vertex: at, cargo: [] }); }
  if (op === 'build') newShip(s, id, at);
  if (op === 'recall') v.ships = v.ships.filter(sh => sh.id !== a.choices.ship);
  if (op === 'buy') containers(s, id).find(c => c.id === a.choices.container)!.cargo.push({ kind: shipId as 'crew' | 'settler', source: '' });
  if (op === 'fast-gold') { transfer(p.hand, s.bank, cost({ [a.choices.good]: 1 })); x.fastGold++; x.coins++; }
  if (op === 'fish-roll') {
    x.fishRolled = true; const n = 1 + Math.floor(random(s) * 6), shoal = v.shoals.find(f => f.number === n);
    const hauls = v.shoals.filter(f => f.fish).length + v.ships.flatMap(sh => sh.cargo).filter(c => c.kind === 'fish').length + v.harbors.flatMap(h => h.cargo).filter(c => c.kind === 'fish').length;
    if (shoal && !shoal.fish && s.pirate !== shoal.tile && hauls < 6) shoal.fish = true;
    event(s, 'roll', `${p.name} rolled ${n} for fish`, id, shoal?.tile ?? null);
  }
  if (op === 'move') {
    const path = destinations(s, ship!).get(at)!;
    if (path.tribute) { payCoins(s, id, 1); x.piratePaid.push(shipId); }
    x.activeShip = shipId; ship!.edge = at; ship!.remaining -= path.moves; discover(s, ship!);
  }
  if (op === 'boost') { x.shipBoosts.push(shipId); ship!.remaining += 2; }
  if (op === 'fight') {
    x.pirateAttempts.push(shipId); const n = 1 + Math.floor(random(s) * 6), bonus = v.spices.filter(f => f.benefit === 'pirate' && f.visitors.includes(id)).length;
    event(s, 'roll', `${p.name} rolled ${n} against the pirate`, id);
    if (n >= 6 - bonus) { s.actorId = id; s.returnPhase = 'action'; m.resumeMovement = s.phase; s.interruptedAt = s.deadline === null ? null : now; phase(s, 'robber'); }
  }
  if (op === 'settle') { s.buildings.push({ vertex: at, playerId: id, kind: 'settlement' }); v.ships = v.ships.filter(sh => sh !== ship); x.activeShip = null; }
  if (op === 'crew') {
    ship!.cargo.splice(ship!.cargo.findIndex(c => c.kind === 'crew'), 1); const lair = v.lairs.find(l => l.tile === at), farm = v.spices.find(f => f.tile === at);
    if (lair) lair.crews.push(id);
    if (farm) { farm.visitors.push(id); ship!.cargo.push({ kind: 'spice', source: at }); }
  }
  if (op === 'retrieve') { const lair = v.lairs.find(l => l.tile === at)!; lair.crews.splice(lair.crews.indexOf(id), 1); ship!.cargo.push({ kind: 'crew', source: '' }); }
  if (op === 'fish') { v.shoals.find(f => f.tile === at)!.fish = false; ship!.cargo.push({ kind: 'fish', source: at }); }
  if (op === 'deliver') { for (const cargo of ship!.cargo) if (cargo.kind === 'spice' || cargo.kind === 'fish') missionProgress(s, id, cargo.kind === 'spice' ? 'spices' : 'fish'); ship!.cargo = ship!.cargo.filter(c => c.kind !== 'spice' && c.kind !== 'fish'); }
  if (op === 'finish') { x.finishedShips.push(shipId); x.activeShip = null; ship!.remaining = 0; }
  if (op === 'transfer') { const all = allContainers(s, id), from = all.find(c => c.id === shipId)!, to = all.find(c => c.id === toId)!; to.cargo.push(from.cargo.splice(Number(a.choices.cargo), 1)[0]); }
  if (op === 'discard') allContainers(s, id).find(c => c.id === shipId)!.cargo.splice(Number(a.choices.cargo), 1);
  announce(s, id, `${op} expedition`, at ?? ship?.edge ?? null);
}
export function resolveLairs(s: State) {
  const v = s.modules?.public.explorers; if (!v) return;
  for (const lair of v.lairs.filter(l => !l.captured && l.crews.length === 3)) {
    const involved = [...new Set(lair.crews)];
    for (const id of involved) { extra(s, id).coins += 2; missionProgress(s, id, 'lairs'); }
    let tied = involved;
    while (tied.length > 1) { const rolls = tied.map(id => ({ id, n: 1 + Math.floor(random(s) * 6) + lair.crews.filter(p => p === id).length, crew: lair.crews.filter(p => p === id).length })); const best = Math.max(...rolls.map(r => r.n)), crew = Math.max(...rolls.filter(r => r.n === best).map(r => r.crew)); tied = rolls.filter(r => r.n === best && r.crew === crew).map(r => r.id); }
    const hero = tied[0]; missionProgress(s, hero, 'lairs'); lair.crews.splice(lair.crews.indexOf(hero), 1); lair.captured = true; s.board.tiles.find(t => t.id === lair.tile)!.number = s.modules!.lairNumbers[lair.tile];
    event(s, 'build', `${player(s, hero).name} led the capture of a pirate lair`, hero, lair.tile);
  }
}
