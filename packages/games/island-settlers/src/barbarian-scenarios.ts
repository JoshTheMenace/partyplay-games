import {acting, edge, event, has, need, player, random, route, vertex} from './core';
import {COSTS, type DevKind} from './model';
import type {ExpansionAction, ExpansionCommand} from './expansion-model';
import type {State} from './state';
import {shuffled} from './board';
import {announce, choice, command, cost, extra, payCoins, queue, steal} from './expansion-common';
import {moving} from './explorers-pirates';
import {spendFish} from './traders-barbarians';

export function initializeBarbarians(s: State) {
  const m = s.modules; if (!m) return;
  const scenarios = s.settings.scenarios ?? [], v = m.public;
  const coast = s.board.tiles.filter(t => t.island === 0 && s.board.edges.some(e => e.tiles.includes(t.id) && e.sea) && !['lake', 'swamp', 'oasis'].includes(t.terrain));
  if (scenarios.includes('barbarian-attack')) {
    const castle = [...coast].sort((a, b) => b.y - a.y)[0]; castle.terrain = 'castle'; castle.number = 0;
    const barbarians = coast.filter(t => t !== castle && t.number).map(t => ({ tile: t.id, count: [2, 12].includes(t.number) ? 1 : 0 }));
    v.barbarian = null; v.attack = { castle: castle.id, barbarians, guards: [] };
    m.attackDeck = shuffled([...Array(14).fill('knighthood'), ...Array(4).fill('swift-knight'), ...Array(4).fill('capture'), ...Array(4).fill('treason')], () => random(s));
    s.deck = []; s.robber = ''; s.pirate = null;
  }
  if (scenarios.includes('traders')) {
    const depots: NonNullable<typeof v.deliveries>['depots'] = [];
    for (const [i, kind] of (['castle', 'quarry', 'glassworks'] as const).entries()) {
      const angle = Math.PI / 2 + i * 2 * Math.PI / 3, t = kind === 'castle' && v.attack ? s.board.tiles.find(t => t.id === v.attack!.castle)! : coast.filter(t => !depots.some(d => d.tile === t.id)).sort((a, b) => (Math.cos(angle) * b.x + Math.sin(angle) * b.y) - (Math.cos(angle) * a.x + Math.sin(angle) * a.y))[0];
      t.terrain = kind; if (!v.attack && !v.caravans && !v.rivers) t.number = 0;
      const center = { id: `depot${i}`, x: t.x, y: t.y, tiles: [t.id], edges: [] as string[] }; s.board.vertices.push(center);
      const corners = s.board.vertices.filter(v => v.id !== center.id && v.tiles.includes(t.id)).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)).slice(0, 4);
      for (const corner of corners) { const e = { id: `depot${i}edge${center.edges.length}`, a: center.id, b: corner.id, tiles: [t.id], land: true, sea: false }; s.board.edges.push(e); center.edges.push(e.id); corner.edges.push(e.id); }
      depots.push({ tile: t.id, vertex: center.id, kind });
      const cargo = kind === 'castle' ? ['tools', 'sand'] : kind === 'quarry' ? ['sand', 'marble'] : ['glass', 'tools'];
      m.cargoDecks[kind] = shuffled(Array.from({ length: 24 }, (_, n) => cargo[n % 2]), () => random(s)) as typeof m.cargoDecks[string];
    }
    v.deliveries = { depots, barbarians: v.attack ? [] : shuffled(s.board.edges.filter(e => e.land && e.tiles.every(t => s.board.tiles.find(x => x.id === t)?.island === 0)).map(e => e.id), () => random(s)).slice(0, 3), wagons: [] };
    if (v.attack) {
      v.attack.barbarians.forEach(b => b.count = 0);
      for (const d of depots.filter(d => d.kind !== 'quarry')) { s.board.tiles.find(t => t.id === d.tile)!.number = d.kind === 'castle' ? 12 : 2; const b = v.attack.barbarians.find(b => b.tile === d.tile); if (b) b.count = 1; else v.attack.barbarians.push({ tile: d.tile, count: 1 }); }
    }
    for (const p of s.players) extra(s, p.id).coins = v.rivers ? 3 : 5;
    if (!s.settings.citiesKnights && !v.attack) s.deck = shuffled<DevKind>([...Array(16).fill('knight'), ...Array(3).fill('road-building'), ...Array(3).fill('swift-journey'), ...Array(3).fill('victory')], () => random(s));
    s.robber = ''; s.pirate = null;
  }
}
/** In the combined scenario the coastal invaders also obstruct wagon paths. */
export function syncBarbarianPaths(s: State) {
  const m = s.modules, attack = m?.public.attack, deliveries = m?.public.deliveries; if (!m || !attack || !deliveries) return;
  const used = new Set<string>();
  for (const b of attack.barbarians) {
    const paths = (m.barbarianPaths[b.tile] ?? []).slice(0, b.count); paths.forEach(at => used.add(at));
    for (const e of s.board.edges.filter(e => e.land && e.tiles.includes(b.tile))) if (paths.length < b.count && !used.has(e.id)) { paths.push(e.id); used.add(e.id); }
    m.barbarianPaths[b.tile] = paths;
  }
  deliveries.barbarians = [...used];
}
export function invade(s: State, rolls = 3) {
  const attack = s.modules?.public.attack; if (!attack) return;
  const numbers = new Set<number>();
  while (numbers.size < rolls) { const n = 2 + Math.floor(random(s) * 6) + Math.floor(random(s) * 6); if (n !== 7) numbers.add(n); }
  for (const n of numbers) { const eligible = attack.barbarians.filter(b => s.board.tiles.find(t => t.id === b.tile)?.number === n && b.count < 3); if (eligible.length) eligible[Math.floor(random(s) * eligible.length)].count++; }
  syncBarbarianPaths(s); event(s, 'phase', 'Barbarians landed on the coast');
}
export function afterScenarioBuild(s: State, id: string, at: string, kind: string, setup: boolean) {
  const m = s.modules; if (!m) return;
  if (m.public.deliveries && setup && s.setupIndex >= s.players.length && kind === 'settlement') m.public.deliveries.wagons.push({ playerId: id, vertex: at, level: 0, remaining: 0, cargo: null, delivered: 0 });
  if (!setup && ['settlement', 'city', 'harbor'].includes(kind)) invade(s);
}
export function barbarianBlocks(s: State, tiles: string[]) { return tiles.some(id => (s.modules?.public.attack?.barbarians.find(b => b.tile === id)?.count ?? 0) >= 3); }
function guardSites(s: State, id: string, anywhere = false) { const v = s.modules!.public.attack!; if (v.guards.filter(k => k.playerId === id).length >= 6) return []; return s.board.edges.filter(e => e.land && (anywhere || e.tiles.includes(v.castle)) && !v.guards.some(k => k.edge === e.id) && e.tiles.some(t => s.board.tiles.find(x => x.id === t)?.island === 0)).map(e => e.id); }
function guardMoves(s: State, from: string, limit: number, occupied = false) {
  const v = s.modules!.public.attack!, distances = new Map([[from, 0]]), todo = [from];
  for (const at of todo) { const n = distances.get(at)!; if (n >= limit) continue; const e = edge(s, at)!;
    for (const next of s.board.edges.filter(e => e.land && e.tiles.some(t => s.board.tiles.find(x => x.id === t)?.island === 0))) if (!distances.has(next.id) && [next.a, next.b].some(at => at === e.a || at === e.b)) { distances.set(next.id, n + 1); todo.push(next.id); }
  }
  return [...distances.keys()].filter(at => at !== from && !edge(s, at)!.tiles.includes(v.castle) && (occupied || !v.guards.some(k => k.edge === at)));
}
function wagonCost(s: State, id: string, at: string) {
  const r = route(s, at), river = s.modules!.public.rivers, bridge = river?.bridgeSites.includes(at), builtBridge = river?.bridges.includes(at);
  const moves = bridge ? builtBridge ? 1 : 3 : r ? 1 : 2;
  return { moves: moves + (s.modules!.public.deliveries!.barbarians.includes(at) ? 2 : 0), gold: r && r.playerId !== id ? bridge ? 2 : 1 : 0, owner: r?.playerId };
}
export function startScenarioMovement(s: State, id: string) {
  const m = s.modules!; m.guardMoved = m.guardMoved.filter(kid => !m.public.attack?.guards.some(k => k.id === kid && k.playerId === id));
  const wagon = m.public.deliveries?.wagons.find(w => w.playerId === id); if (wagon) wagon.remaining = [4, 5, 6, 7, 7][wagon.level];
}
export function barbarianCommands(s: State, id: string): ExpansionCommand[] {
  const m = s.modules; if (!m) return [];
  const v = m.public, p = player(s, id), x = extra(s, id), result: ExpansionCommand[] = [], act = acting(s, p), moves = moving(s, id);
  if (v.attack) {
    const mine = v.attack.guards.filter(k => k.playerId === id);
    if (act && !s.settings.citiesKnights) result.push(command('guard:buy', 'Barbarians', 'Draw a defense card', 'Buy and resolve one Barbarian Attack development card immediately.', [], COSTS.development));
    if (act && s.settings.citiesKnights) {
      if (mine.filter(k => k.strength === 1).length < 2) result.push(command('guard:recruit', 'Knights', 'Recruit a castle knight', 'Place an inactive basic knight on an empty castle edge.', [choice('target', 'Castle edge', guardSites(s, id), 'edge')], cost({ wool: 1, ore: 1 })));
      for (const k of mine) {
        if (!k.active) result.push(command(`guard:activate:${k.id}`, 'Knights', `Activate knight ${k.id}`, 'Active strength defends nearby coastal hexes.', [], cost({ grain: 1 })));
        if (k.strength < 3 && (k.strength === 1 || x.improvements.politics >= 3) && m.knightTurns[k.id].promoted < p.turns && mine.filter(o => o.strength === k.strength + 1).length < 2) result.push(command(`guard:promote:${k.id}`, 'Knights', `Promote knight ${k.id}`, 'Increase strength by one.', [], cost({ wool: 1, ore: 1 })));
      }
    }
    if (moves) for (const k of mine.filter(k => !m.guardMoved.includes(k.id))) {
      const limit = s.settings.citiesKnights && k.active ? 5 : 3;
      if (s.settings.citiesKnights && k.active) result.push(command(`guard:displace:${k.id}`, 'Knights', 'Displace a weaker coastal knight', 'Move up to three edges, deactivate, and let the displaced knight retreat.', [choice('target', 'Weaker knight', v.attack.guards.filter(g => g.playerId !== id && g.strength < k.strength && guardMoves(s, k.edge, 3, true).includes(g.edge)).map(g => g.edge), 'edge')]));
      result.push(command(`guard:move:${k.id}`, 'Barbarians', `Move knight ${k.id} · ${limit} edges`, s.settings.citiesKnights ? 'Moving an active knight deactivates it.' : 'Knights fight at the end of your movement phase.', [choice('target', 'Destination edge', guardMoves(s, k.edge, limit), 'edge')]));
      if (!s.settings.citiesKnights) result.push(command(`guard:boost:${k.id}`, 'Barbarians', `Move knight ${k.id} · 5 edges`, 'Spend one grain for two extra edges.', [choice('target', 'Destination edge', guardMoves(s, k.edge, 5), 'edge')], cost({ grain: 1 })));
      if (v.fishing && x.fish.reduce((n, f) => n + f.value, 0) >= 2) result.push(command(`guard:fish:${k.id}`, 'Fishing', `Move knight ${k.id} · 2 fish`, 'Spend fish to move up to five edges.', [choice('target', 'Destination edge', guardMoves(s, k.edge, 5), 'edge')]));
    }
  }
  if (v.deliveries) {
    const wagon = v.deliveries.wagons.find(w => w.playerId === id);
    if (wagon && act && wagon.level < 4) result.push(command('wagon:upgrade', 'Deliveries', `Upgrade wagon to level ${wagon.level + 1}`, 'Improve movement, delivery income, and defense. The final upgrade earns 1 VP.', [], cost({ wood: wagon.level < 2 ? 1 : 2, wool: 1, ore: 1 })));
    if (wagon && moves) {
      if (x.wagonJourneys && !wagon.remaining) result.push(command('wagon:journey', 'Deliveries', 'Swift Journey: move again', 'Begin the second movement allowed by your card.'));
      const paths = vertex(s, wagon.vertex)!.edges.map(e => edge(s, e)!).filter(e => (e.land || s.settings.expansion === 'seafarers') && wagonCost(s, id, e.id).moves <= wagon.remaining && wagonCost(s, id, e.id).gold <= x.coins);
      result.push(command('wagon:move', 'Deliveries', `Move wagon · ${wagon.remaining} points`, 'Paths cost two; roads cost one. Pay opponents for using their roads. Arrival at a depot ends movement.', [choice('target', 'Next intersection', paths.map(e => e.a === wagon.vertex ? e.b : e.a), 'vertex')]));
      if (!x.wagonBoost && wagon.remaining > 0) result.push(command('wagon:boost', 'Deliveries', 'Boost wagon · +2 movement', 'Once per turn, spend a grain for two movement points.', [], cost({ grain: 1 })));
      if (wagon.level > 0) for (const at of vertex(s, wagon.vertex)!.edges.filter(e => v.deliveries!.barbarians.includes(e) && !x.wagonAttempts.includes(e))) result.push(command(`wagon:fight:${at}`, 'Deliveries', 'Drive off a barbarian', 'Roll once for this barbarian. Upgrades improve your chance; movement may continue.'));
    }
  }
  return result.filter(c => c.fields.every(f => f.optional || f.options.length) && (!c.cost || has(p.hand, c.cost)));
}
export function moveBarbarianPrompt(s: State, id: string, now: number, stealCard = true, from?: string[]) {
  const v = s.modules!.public.deliveries!;
  const origins = from ?? v.barbarians, attack = s.modules!.public.attack, source = origins.length === 1 ? attack?.barbarians.find(b => s.modules!.barbarianPaths[b.tile]?.includes(origins[0])) : null;
  const targets = s.board.edges.filter(e => (e.land || s.settings.expansion === 'seafarers') && !v.barbarians.includes(e.id) && (!attack || attack.barbarians.some(b => b !== source && b.count < 3 && e.tiles.includes(b.tile)))).map(e => e.id);
  if (!origins.length || !targets.length) return;
  queue(s, { playerId: id, kind: 'barbarian-move', title: 'Move a road barbarian', count: stealCard ? 1 : 0, command: command('', 'Choice', 'Move barbarian', stealCard ? 'Steal one card if you place it on an opponent’s route.' : 'Move it away. This action does not steal.', [choice('from', 'Barbarian to move', origins, 'edge'), choice('target', 'Destination', targets, 'edge')]) }, now);
}
function guardCard(s: State, id: string, now: number) {
  const m = s.modules!, v = m.public.attack!;
  if (!m.attackDeck.length) { m.attackDeck = shuffled(m.attackDiscard, () => random(s)); m.attackDiscard = []; }
  let kind = m.attackDeck.pop()!;
  if (kind === 'capture' && !v.barbarians.some(b => b.count)) { m.attackDiscard.push(kind); if (!m.attackDeck.length) { m.attackDeck = shuffled(m.attackDiscard, () => random(s)); m.attackDiscard = []; } kind = m.attackDeck.find(c => c !== 'capture') ?? 'capture'; m.attackDeck.splice(m.attackDeck.indexOf(kind), 1); }
  m.attackDiscard.push(kind);
  if (kind === 'knighthood' || kind === 'swift-knight') {
    const sites = guardSites(s, id, kind === 'swift-knight'); if (sites.length) queue(s, { playerId: id, kind: 'guard-card', target: kind, title: `Defense card: ${kind}`, command: command('', 'Choice', 'Place knight', 'Place a knight from your supply.', [choice('target', 'Knight edge', sites, 'edge')]) }, now);
  } else if (kind === 'capture') {
    const tiles = v.barbarians.filter(b => b.count).map(b => b.tile); if (tiles.length) queue(s, { playerId: id, kind: 'guard-card', target: kind, title: 'Capture one barbarian', command: command('', 'Choice', 'Capture barbarian', 'Remove a coastal barbarian and keep it as a prisoner.', [choice('target', 'Barbarian hex', tiles, 'tile')]) }, now);
  } else {
    extra(s, id).coins += 2;
    for (let n = 0; n < 2; n++) queue(s, { playerId: id, kind: 'guard-treason', title: 'Treason: relocate a barbarian', command: command('', 'Choice', 'Relocate barbarian', 'Move from one coastal hex to another unconquered coastal hex.', [{ ...choice('from', 'Source (skip to use supply)', v.barbarians.filter(b => b.count).map(b => b.tile), 'tile'), optional: true }, choice('target', 'Destination', v.barbarians.filter(b => b.count < 3).map(b => b.tile), 'tile')]) }, now);
  }
  event(s, 'card', `${player(s, id).name} drew ${kind}`, id);
}
export function applyBarbarian(s: State, id: string, a: ExpansionAction, now: number) {
  const m = s.modules!, v = m.public, x = extra(s, id), [, op, kid] = a.command.split(':'), at = a.choices.target;
  if (a.command.startsWith('guard:')) {
    if (op === 'buy') guardCard(s, id, now);
    else if (op === 'recruit') { const k = { id: `g${++s.serial}`, playerId: id, edge: at, strength: 1, active: false }; v.attack!.guards.push(k); m.knightTurns[k.id] = { activated: -1, promoted: -1 }; }
    else { const k = v.attack!.guards.find(k => k.id === kid)!;
      if (op === 'activate') { k.active = true; m.knightTurns[k.id].activated = player(s, id).turns; }
      if (op === 'promote') { k.strength++; m.knightTurns[k.id].promoted = player(s, id).turns; }
      if (op === 'displace') {
        const other = v.attack!.guards.find(g => g.edge === at)!, targets = guardMoves(s, at, 3).filter(at => at !== k.edge);
        v.attack!.guards = v.attack!.guards.filter(g => g !== other);
        if (targets.length) queue(s, { playerId: other.playerId, kind: 'guard-retreat', title: 'Retreat your displaced coastal knight', knight: { id: other.id, playerId: other.playerId, strength: other.strength as 1 | 2 | 3, active: other.active, vertex: other.edge }, command: command('', 'Choice', 'Retreat coastal knight', 'Move to an empty edge within three edges.', [choice('target', 'Retreat edge', targets, 'edge')]) }, now);
        k.edge = at; k.active = false; m.guardMoved.push(k.id);
      }
      if (op === 'move' || op === 'boost' || op === 'fish') { if (op === 'fish') spendFish(s, id, 2); k.edge = at; m.guardMoved.push(k.id); if (s.settings.citiesKnights) k.active = false; }
    }
  } else {
    const wagon = v.deliveries!.wagons.find(w => w.playerId === id)!;
    if (op === 'upgrade') wagon.level++;
    if (op === 'journey') { x.wagonJourneys--; wagon.remaining = [4, 5, 6, 7, 7][wagon.level]; }
    if (op === 'boost') { x.wagonBoost = true; wagon.remaining += 2; }
    if (op === 'fight') { x.wagonAttempts.push(kid); const roll = 1 + Math.floor(random(s) * 6); event(s, 'roll', `${player(s, id).name} rolled ${roll} against a road barbarian`, id); if (roll >= 7 - wagon.level) moveBarbarianPrompt(s, id, now, false, [kid]); }
    if (op === 'move') {
      const path = vertex(s, wagon.vertex)!.edges.find(e => { const x = edge(s, e)!; return x.a === at || x.b === at; })!, pay = wagonCost(s, id, path);
      payCoins(s, id, pay.gold); if (pay.gold && pay.owner) extra(s, pay.owner).coins += pay.gold;
      wagon.remaining -= pay.moves; wagon.vertex = at;
      const depot = v.deliveries!.depots.find(d => d.vertex === at);
      if (depot) {
        wagon.remaining = 0; const wanted = depot.kind === 'castle' ? ['marble', 'glass'] : depot.kind === 'quarry' ? ['tools'] : ['sand'];
        if (wagon.cargo && wanted.includes(wagon.cargo)) { wagon.delivered++; x.coins += wagon.level + 1; m.deliveredCargo.push(wagon.cargo); wagon.cargo = null; }
        if (!wagon.cargo && m.cargoDecks[depot.kind].length) wagon.cargo = m.cargoDecks[depot.kind].pop()!;
      }
    }
  }
  announce(s, id, `${op} ${a.command.startsWith('guard:') ? 'knight' : 'wagon'}`, at ?? null);
}
export function applyBarbarianPrompt(s: State, a: ExpansionAction) {
  const m = s.modules!, prompt = m.prompts[0], at = a.choices.target, id = prompt.playerId, v = m.public;
  if (prompt.kind === 'barbarian-move') {
    const i = v.deliveries!.barbarians.indexOf(a.choices.from); need(i >= 0 && !v.deliveries!.barbarians.includes(at), 'That barbarian changed.');
    if (v.attack) {
      const from = v.attack.barbarians.find(b => m.barbarianPaths[b.tile]?.includes(a.choices.from)), to = v.attack.barbarians.find(b => edge(s, at)!.tiles.includes(b.tile) && b.count < 3);
      need(from && to && from !== to, 'Choose a path on another unconquered coastal hex.');
      from.count--; to.count++; m.barbarianPaths[from.tile] = m.barbarianPaths[from.tile].filter(e => e !== a.choices.from); (m.barbarianPaths[to.tile] ??= []).push(at); syncBarbarianPaths(s);
    } else v.deliveries!.barbarians[i] = at;
    const victim = route(s, at)?.playerId; if (prompt.count && victim && victim !== id) steal(s, victim, id);
  }
  if (prompt.kind === 'guard-card') {
    if (prompt.target === 'capture') { v.attack!.barbarians.find(b => b.tile === at)!.count--; extra(s, id).prisoners++; }
    else { const k = { id: `g${++s.serial}`, playerId: id, edge: at, strength: 1, active: true }; v.attack!.guards.push(k); m.knightTurns[k.id] = { activated: -1, promoted: -1 }; }
  }
  if (prompt.kind === 'guard-treason') {
    need(a.choices.from !== at, 'Choose a different destination.'); const from = v.attack!.barbarians.find(b => b.tile === a.choices.from), to = v.attack!.barbarians.find(b => b.tile === at)!; need(to.count < 3 && (!from || from.count > 0), 'A coastal hex changed.'); if (from) from.count--; to.count++;
    const next = m.prompts.find(q => q.id !== prompt.id && q.kind === 'guard-treason');
    if (next?.command) next.command.fields = [{ ...choice('from', 'Source (skip to use supply)', v.attack!.barbarians.filter(b => b.count && b.tile !== a.choices.from && b.tile !== at).map(b => b.tile), 'tile'), optional: true }, choice('target', 'Destination', v.attack!.barbarians.filter(b => b.count < 3 && b.tile !== at).map(b => b.tile), 'tile')];
  }
}
export function resolveCoastalBattles(s: State) {
  const m = s.modules!, v = m.public.attack; if (!v) return;
  for (const b of v.barbarians.filter(b => b.count)) {
    const knights = v.guards.filter(k => edge(s, k.edge)!.tiles.includes(b.tile) && (!s.settings.citiesKnights || k.active)), strength = knights.reduce((n, k) => n + k.strength, 0);
    if (strength <= b.count) continue;
    const involved = [...new Set(knights.map(k => k.playerId))], ranked = involved.map(id => ({ id, strength: knights.filter(k => k.playerId === id).reduce((n, k) => n + k.strength, 0), roll: random(s) })).sort((a, b) => b.strength - a.strength || b.roll - a.roll);
    const count = b.count; b.count = 0;
    for (const [i, p] of ranked.entries()) if (i < count) extra(s, p.id).prisoners++; else extra(s, p.id).coins += 3;
    for (let n = ranked.length; n < count; n++) extra(s, ranked[0].id).prisoners++;
    const orientation = Math.floor(random(s) * 3);
    for (const k of knights) { const e = edge(s, k.edge)!, a = vertex(s, e.a)!, b = vertex(s, e.b)!, group = Math.round((Math.atan2(b.y - a.y, b.x - a.x) + Math.PI * 2) / (Math.PI / 3)) % 3; if (group !== orientation) continue;
      const smaller = s.settings.citiesKnights ? [k.strength - 1, k.strength - 2].find(n => n > 0 && v.guards.filter(g => g.playerId === k.playerId && g.strength === n).length < 2) : 0;
      if (smaller) k.strength = smaller; else v.guards = v.guards.filter(g => g.id !== k.id);
      extra(s, k.playerId).coins += 3;
    }
    event(s, 'build', `${count} coastal barbarians captured`, null, b.tile);
  }
}
