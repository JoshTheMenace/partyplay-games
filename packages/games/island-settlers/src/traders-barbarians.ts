import {GOODS, acting, building, edge, event, has, need, player, random, route, score, total, transfer, vertex} from './core';
import {RESOURCES} from './model';
import type {ExpansionAction, ExpansionCommand, Good} from './expansion-model';
import type {State} from './state';
import {shuffled} from './board';
import {cardPicker, choice, command, cost, extra, payCoins, queue, seats, steal, take} from './expansion-common';
import {drawProgress} from './cities-knights';
import {moving, newShip, shipBuildSites} from './explorers-pirates';

export function initializeScenarios(s: State) {
  const m = s.modules; if (!m) return;
  const selected = s.settings.scenarios ?? [], v = m.public;
  if (selected.includes('fishing')) {
    const coast = s.board.edges.filter(e => e.land && e.sea && e.tiles.some(t => s.board.tiles.find(x => x.id === t)?.island === 0)), used = new Set<string>();
    const grounds: NonNullable<typeof v.fishing>['grounds'] = [];
    for (const e of shuffled(coast, () => random(s))) if (!used.has(e.a) && !used.has(e.b) && grounds.length < 6) { grounds.push({ id: `fish:${e.id}`, vertices: [e.a, e.b], numbers: [[4, 5, 6, 8, 9, 10][grounds.length]] }); used.add(e.a); used.add(e.b); }
    if (!selected.includes('rivers') && !selected.includes('barbarian-attack')) {
      const lake = s.board.tiles.find(t => t.terrain === 'desert'); if (lake) { lake.terrain = 'lake'; lake.number = 0; grounds.push({ id: lake.id, vertices: s.board.vertices.filter(x => x.tiles.includes(lake.id)).map(x => x.id), numbers: [2, 3, 11, 12] }); }
    }
    v.fishing = { grounds, bootOwner: null }; m.fishDeck = shuffled([...Array(11).fill(1), ...Array(10).fill(2), ...Array(8).fill(3), 0], () => random(s));
  }
  if (selected.includes('rivers')) {
    // Generated rivers trace two separated runs of interior edges; marked crossings require bridges.
    const interior = s.board.edges.filter(e => e.land && !e.sea && e.tiles.every(t => s.board.tiles.find(x => x.id === t)?.island === 0));
    const edges: string[] = [];
    for (const sign of [-1, 1]) {
      let current = [...interior].sort((a, b) => sign * (vertex(s, a.a)!.x - vertex(s, b.a)!.x))[0];
      for (let i = 0; i < 6 && current; i++) { edges.push(current.id); const next = interior.filter(e => !edges.includes(e.id) && [e.a, e.b].some(at => at === current.a || at === current.b)); current = next[Math.floor(random(s) * next.length)]; }
    }
    v.rivers = { edges, bridgeSites: edges.filter((_, i) => i % 2 === 0), bridges: [], wealthiest: null, poorest: s.players.map(p => p.id) };
    for (const t of s.board.tiles.filter(t => t.terrain === 'desert')) { t.terrain = 'swamp'; t.number = 0; }
  }
  if (selected.includes('caravans')) {
    const oasis = s.board.tiles.filter(t => t.island === 0 && !['lake', 'swamp'].includes(t.terrain)).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0];
    oasis.terrain = 'oasis'; oasis.number = 0; v.caravans = { oasis: oasis.id, segments: [], bids: [] };
  }
}
export function scenarioProduction(s: State, value: number) {
  const m = s.modules; if (!m?.public.fishing) return;
  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[(s.primary + i) % s.players.length];
    for (const ground of m.public.fishing.grounds.filter(g => g.numbers.includes(value) && g.id !== s.robber)) for (const b of s.buildings.filter(b => b.playerId === p.id && ground.vertices.includes(b.vertex) && !conquered(s, b.vertex))) {
      for (let n = 0; n < (b.kind === 'city' ? 2 : 1); n++) {
        if (!m.fishDeck.length) { m.fishDeck = shuffled(m.fishDiscard, () => random(s)); m.fishDiscard = []; }
        const value = m.fishDeck.pop(); if (value === undefined) break;
        if (value === 0) { m.public.fishing.bootOwner = p.id; event(s, 'phase', `${p.name} found the old boot: one extra VP needed to win`, p.id); }
        else extra(s, p.id).fish.push({ id: `f${++s.serial}`, value });
      }
    }
  }
}
export function conquered(s: State, at: string): boolean {
  const attack = s.modules?.public.attack; if (!attack) return false;
  const land = vertex(s, at)!.tiles.map(id => s.board.tiles.find(t => t.id === id)!).filter(t => !['sea', 'shoal'].includes(t.terrain));
  return land.length > 0 && land.every(t => (attack.barbarians.find(b => b.tile === t.id)?.count ?? 0) >= 3);
}
export function riverBonus(s: State, id: string, at: string, kind: string, setup: boolean) {
  const m = s.modules; if (!m) return;
  if (m.public.caravans && !setup && ['settlement', 'city', 'harbor'].includes(kind)) extra(s, id).built = true;
  const river = m.public.rivers; if (!river || kind === 'ship') return;
  const tiles = new Set(river.edges.flatMap(e => edge(s, e)!.tiles));
  if (kind === 'bridge') extra(s, id).coins += 3;
  else if (kind === 'road' ? edge(s, at)!.tiles.some(t => tiles.has(t)) : (kind === 'settlement' || setup) && vertex(s, at)!.tiles.some(t => tiles.has(t))) extra(s, id).coins++;
}
export function scenarioAwards(s: State) {
  const m = s.modules; if (!m) return;
  if (m.public.merchant && (m.public.attack?.barbarians.find(b => b.tile === m.public.merchant!.tile)?.count ?? 0) >= 3) m.public.merchant = null;
  if (m.public.rivers) {
    const gold = s.players.map(p => extra(s, p.id).coins), high = Math.max(...gold), low = Math.min(...gold), richest = s.players.filter(p => extra(s, p.id).coins === high);
    m.public.rivers.wealthiest = richest.length === 1 ? richest[0].id : null; m.public.rivers.poorest = s.players.filter(p => extra(s, p.id).coins === low).map(p => p.id);
  }
  if (s.settings.variants?.includes('harbormaster')) {
    const counts = s.players.map(p => ({ id: p.id, n: s.buildings.filter(b => b.playerId === p.id && !conquered(s, b.vertex) && s.board.ports.some(port => port.vertices.includes(b.vertex))).reduce((n, b) => n + (b.kind === 'settlement' ? 1 : 2), 0) })), high = Math.max(...counts.map(c => c.n)), best = counts.filter(c => c.n === high);
    m.public.harborOwner = high < 3 ? null : best.some(p => p.id === m.public.harborOwner) ? m.public.harborOwner : best.length === 1 ? best[0].id : null;
  }
}
export function bridgeSites(s: State, id: string) {
  const river = s.modules?.public.rivers; if (!river || river.bridges.filter(e => route(s, e)?.playerId === id).length >= 3) return [];
  return river.bridgeSites.filter(at => { const e = edge(s, at)!; return !route(s, at) && [e.a, e.b].some(v => building(s, v) ? building(s, v)?.playerId === id : vertex(s, v)!.edges.some(e => route(s, e)?.playerId === id)); });
}
function fishOptions(s: State, id: string, price: number): string[] { return extra(s, id).fish.map(f => f.id).filter(Boolean).length && extra(s, id).fish.reduce((n, f) => n + f.value, 0) >= price ? ['pay'] : []; }
export function spendFish(s: State, id: string, price: number) {
  const m = s.modules!, p = extra(s, id); need(p.fish.reduce((n, f) => n + f.value, 0) >= price, 'You need more fish.');
  // Choose the least total payment, then the fewest tokens; overpayment receives no change.
  const sums = new Map<number, number[]>([[0, []]]);
  // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot prevents spending one token more than once
  p.fish.forEach((f, i) => { for (const [n, indices] of [...sums]) { const sum = n + f.value, prev = sums.get(sum); if (!prev || prev.length > indices.length + 1) sums.set(sum, [...indices, i]); } });
  const best = Math.min(...[...sums.keys()].filter(n => n >= price)), selected = new Set(sums.get(best));
  m.fishDiscard.push(...p.fish.filter((_, i) => selected.has(i)).map(f => f.value)); p.fish = p.fish.filter((_, i) => !selected.has(i));
}
export function scenarioCommands(s: State, id: string): ExpansionCommand[] {
  const m = s.modules; if (!m) return [];
  const p = player(s, id), x = extra(s, id), v = m.public, result: ExpansionCommand[] = [];
  if (!acting(s, p)) {
    if (v.fishing && v.explorers && moving(s, id) && fishOptions(s, id, 7).length && !x.activeShip) {
      const ships = v.explorers.ships.filter(sh => sh.playerId === id && x.finishedShips.includes(sh.id) && !x.shipBoosts.includes(`again:${sh.id}`));
      if (ships.length) result.push(command('fish:journey', 'Fishing', 'Sail a ship again · 7 fish', 'Move a finished ship a second time this turn.', [choice('ship', 'Finished ship', ships.map(sh => sh.id))]));
    }
    return result;
  }
  if (v.fishing) {
    if (v.fishing.bootOwner === id) result.push(command('fish:boot', 'Fishing', 'Pass the old boot', 'Give it to a player with at least your public score.', [seats(s, 'opponent', 'New boot owner', s.players.filter(o => o.id !== id && score(s, o) >= score(s, p)).map(o => o.id))]));
    if (fishOptions(s, id, 2).length && !v.attack && !v.deliveries) result.push(command('fish:remove', 'Fishing', v.explorers ? 'Ignore pirate tribute' : 'Remove a threat', 'Spend at least 2 fish. No change for overpayment.', v.explorers ? [] : [choice('threat', 'Threat', ['robber', ...(s.settings.expansion === 'seafarers' ? ['pirate'] : [])])]));
    if (fishOptions(s, id, 3).length) result.push(command('fish:steal', 'Fishing', 'Steal one card · 3 fish', 'Choose a player. The stolen resource or commodity stays private.', [seats(s, 'opponent', 'Player', s.players.filter(o => o.id !== id && total(o.hand)).map(o => o.id))]));
    if (fishOptions(s, id, 4).length) result.push(command('fish:resource', 'Fishing', 'Take a resource · 4 fish', 'Choose an available resource.', [choice('resource', 'Resource', RESOURCES.filter(r => s.bank[r]))]));
    if (fishOptions(s, id, 5).length) result.push(command('fish:road', 'Fishing', 'Build a free route · 5 fish', 'Gain one free road, or Seafarers ship.'));
    if (fishOptions(s, id, 5).length && v.explorers && v.explorers.ships.filter(sh => sh.playerId === id).length < 3) result.push(command('fish:ship', 'Fishing', 'Build an expedition ship · 5 fish', 'Launch beside your harbor without spending resources.', [choice('target', 'Launch edge', shipBuildSites(s, id), 'edge')]));
    if (fishOptions(s, id, 6).length && v.rivers) result.push(command('fish:bridge', 'Fishing', 'Build a bridge · 6 fish', 'Bridge a marked crossing and receive 3 gold.', [choice('target', 'Bridge site', bridgeSites(s, id), 'edge')]));
    if (fishOptions(s, id, 7).length && (s.settings.citiesKnights || !v.attack && s.deck.length)) result.push(command('fish:card', 'Fishing', s.settings.citiesKnights ? 'Draw progress · 7 fish' : 'Buy development · 7 fish', 'Pay fish instead of resources.', s.settings.citiesKnights ? [choice('track', 'Progress deck', ['science', 'trade', 'politics'])] : []));
  }
  if (v.rivers) result.push(command('river:bridge', 'Rivers', 'Build a bridge', 'Costs 2 brick and 1 wood; earns 3 gold and counts as a road.', [choice('target', 'Bridge site', bridgeSites(s, id), 'edge')], cost({ wood: 1, brick: 2 })));
  if (v.rivers || v.attack || v.deliveries || v.explorers) {
    if (x.coins >= 2 && x.goldTrades < 2) result.push(command('gold:buy', 'Rivers', 'Buy a resource · 2 gold', 'Up to two purchases per turn. Commodities cannot be bought with gold.', [choice('resource', 'Resource', RESOURCES.filter(r => s.bank[r]))]));
    result.push(command('gold:sell', 'Rivers', 'Trade resources for gold', 'Use your current bank rate to buy one gold coin.', [choice('resource', 'Resource to sell', GOODS.filter(r => (p.hand[r] ?? 0) >= goldRate(s, id, r)))]));
    if (x.coins && (s.settings.mode === 'connect' || !s.secondary)) result.push(command('gold:offer', 'Rivers', 'Trade gold for a card', 'The chosen player confirms the exchange. No gifts.', [seats(s, 'opponent', 'Trading partner', s.players.filter(o => o.id !== id).map(o => o.id)), choice('coins', 'Gold to offer', Array.from({ length: Math.min(20, x.coins) }, (_, i) => String(i + 1))), choice('resource', 'Card requested', s.settings.citiesKnights ? [...GOODS] : [...RESOURCES])]));
  }
  return result.filter(c => c.fields.every(f => f.optional || f.options.length) && (!c.cost || has(p.hand, c.cost)));
}
function goldRate(s: State, id: string, r: Good) {
  let rate = s.modules?.public.explorers ? 3 : 4;
  for (const port of s.board.ports) if (port.vertices.some(at => building(s, at)?.playerId === id && !conquered(s, at))) rate = Math.min(rate, port.resource === r ? 2 : port.resource === 'any' ? 3 : 4);
  const x = extra(s, id), merchant = s.modules!.public.merchant;
  if (x.fleet.includes(r) || x.improvements.trade >= 3 && !RESOURCES.includes(r as never) || merchant?.playerId === id && s.board.tiles.find(t => t.id === merchant.tile)?.terrain === r) rate = 2;
  return rate;
}
export function applyScenario(s: State, id: string, a: ExpansionAction, now: number) {
  const m = s.modules!, v = m.public, x = extra(s, id), p = player(s, id), op = a.command, at = a.choices.target;
  if (op.startsWith('fish:') && op !== 'fish:boot') spendFish(s, id, ({ 'fish:remove': 2, 'fish:steal': 3, 'fish:resource': 4, 'fish:road': 5, 'fish:ship': 5, 'fish:bridge': 6, 'fish:card': 7, 'fish:journey': 7 } as Record<string, number>)[op]);
  if (op === 'fish:boot') v.fishing!.bootOwner = a.choices.opponent;
  if (op === 'fish:remove') { if (v.explorers) x.piratePaid.push('all'); else if (a.choices.threat === 'pirate') s.pirate = null; else s.robber = ''; }
  if (op === 'fish:ship') newShip(s, id, at);
  if (op === 'fish:journey') { const ship = v.explorers!.ships.find(sh => sh.id === a.choices.ship)!; ship.remaining = 4 + v.explorers!.spices.filter(f => f.benefit === 'speed' && f.visitors.includes(id)).length; x.finishedShips = x.finishedShips.filter(id => id !== ship.id); x.shipBoosts.push(`again:${ship.id}`); }
  if (op === 'fish:steal') steal(s, a.choices.opponent, id);
  if (op === 'fish:resource') take(s, id, a.choices.resource as Good, 1);
  if (op === 'fish:road') p.freeRoutes++;
  if (op === 'fish:card') { if (s.settings.citiesKnights) drawProgress(s, id, a.choices.track as 'science', now); else { need(s.deck.length, 'No development cards remain.'); p.development.push({ id: `d${++s.serial}`, kind: s.deck.pop()!, bought: p.turns }); } }
  if (op === 'river:bridge' || op === 'fish:bridge') { s.routes.push({ edge: at, playerId: id, kind: 'road' }); v.rivers!.bridges.push(at); riverBonus(s, id, at, 'bridge', false); }
  if (op === 'gold:buy') { payCoins(s, id, 2); x.goldTrades++; take(s, id, a.choices.resource as Good, 1); }
  if (op === 'gold:sell') { const r = a.choices.resource as Good; transfer(p.hand, s.bank, cost({ [r]: goldRate(s, id, r) })); x.coins++; }
  if (op === 'gold:offer') queue(s, { playerId: a.choices.opponent, from: id, kind: 'gold-trade', title: `${p.name} offers ${a.choices.coins} gold for 1 ${a.choices.resource}`, count: Number(a.choices.coins), target: a.choices.resource, command: command('', 'Choice', 'Confirm gold trade', 'Accept exchanges the coins and card together. Decline costs nothing.', [choice('answer', 'Response', ['accept', 'decline'])]) }, now);
  event(s, 'trade', `${p.name} used ${op.replaceAll(':', ' ')}`, id, at ?? null); scenarioAwards(s);
}
export function caravanSites(s: State) {
  const c = s.modules?.public.caravans; if (!c || c.segments.length >= 22 + Math.max(0, s.players.length - 4) * 3) return [];
  const starts = s.board.vertices.filter(v => v.tiles.includes(c.oasis)).filter((_, i) => i % 2 === 0).map(v => v.id), ends = [...starts, ...c.segments.map(x => x.to)].filter(at => !c.segments.some(x => x.from === at) && c.segments.filter(x => x.to === at).length < 2);
  return s.board.edges.filter(e => e.land && !e.tiles.includes(c.oasis) && !c.segments.some(x => x.edge === e.id) && ends.some(at => e.a === at || e.b === at)).map(e => e.id);
}
export function startCaravan(s: State, id: string, now: number) {
  const m = s.modules!; if (!m.public.caravans || !extra(s, id).built || !caravanSites(s).length) return false;
  extra(s, id).built = false; m.caravanBids = []; m.public.caravans.bids = []; m.caravanPending = [id];
  const allowed = s.settings.citiesKnights ? ['wood', 'brick'] as const : ['wool', 'grain'] as const;
  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[(s.players.findIndex(p => p.id === id) + i) % s.players.length];
    queue(s, { playerId: p.id, kind: 'caravan-bid', title: 'Bid to direct the merchant train', command: cardPicker(command('', 'Choice', 'Bid for the caravan', 'Your cards buy votes. All bids are spent; zero cards passes.'), p.hand, 0, allowed.reduce((n, r) => n + p.hand[r], 0), allowed) }, now);
  }
  return true;
}
export function applyCaravanPrompt(s: State, a: ExpansionAction, now: number) {
  const m = s.modules!, prompt = m.prompts[0], id = prompt.playerId;
  if (prompt.kind === 'caravan-bid') {
    const count = total(a.cards!); transfer(player(s, id).hand, s.bank, a.cards!); m.caravanBids.push({ playerId: id, count, target: '' }); m.public.caravans!.bids = [...m.caravanBids];
    if (m.caravanBids.length === s.players.length) {
      const bidders = m.caravanBids.filter(b => b.count);
      for (const b of bidders) queue(s, { playerId: b.playerId, kind: 'caravan-vote', title: 'Agree where the caravan should go', command: command('', 'Choice', 'Assign your votes', `Assign all ${b.count} votes to one route after negotiating.`, [choice('target', 'Caravan edge', caravanSites(s), 'edge')]) }, now);
      if (!bidders.length) queue(s, { playerId: m.caravanPending[0], kind: 'caravan-place', title: 'No bids: choose the caravan route', command: command('', 'Choice', 'Place caravan', 'The active player decides.', [choice('target', 'Caravan edge', caravanSites(s), 'edge')]) }, now);
    }
  }
  if (prompt.kind === 'caravan-vote') {
    m.caravanBids.find(b => b.playerId === id)!.target = a.choices.target; m.public.caravans!.bids = [...m.caravanBids];
    if (m.caravanBids.filter(b => b.count).every(b => b.target)) {
      const tally = new Map<string, number>(); for (const b of m.caravanBids.filter(b => b.count)) tally.set(b.target, (tally.get(b.target) ?? 0) + b.count);
      const best = Math.max(...tally.values()), sites = [...tally].filter(([, n]) => n === best).map(([at]) => at);
      if (sites.length === 1) placeCaravan(s, sites[0]);
      else { const max = Math.max(...m.caravanBids.map(b => b.count)), leaders = m.caravanBids.filter(b => b.count === max); queue(s, { playerId: leaders.length === 1 ? leaders[0].playerId : m.caravanPending[0], kind: 'caravan-place', title: 'Break the tied caravan vote', command: command('', 'Choice', 'Place caravan', 'Choose its next edge.', [choice('target', 'Caravan edge', caravanSites(s), 'edge')]) }, now); }
    }
  }
  if (prompt.kind === 'caravan-place') placeCaravan(s, a.choices.target);
}
function placeCaravan(s: State, at: string) {
  const c = s.modules!.public.caravans!, e = edge(s, at)!, ends = [...s.board.vertices.filter(v => v.tiles.includes(c.oasis)).filter((_, i) => i % 2 === 0).map(v => v.id), ...c.segments.map(c => c.to)], from = [e.a, e.b].find(at => ends.includes(at) && !c.segments.some(x => x.from === at))!;
  c.segments.push({ edge: at, from, to: e.a === from ? e.b : e.a }); event(s, 'build', 'The merchant train extended its route', null, at);
}
