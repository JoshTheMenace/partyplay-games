import {syncBarbarianPaths, afterScenarioBuild, barbarianBlocks, initializeBarbarians, moveBarbarianPrompt} from './barbarian-scenarios';
import {queue} from './expansion-common';
import {expeditionPirateTargets, expeditionSetupKind, exploredBuild, initializeExplorers, moving, newShip} from './explorers-pirates';
import {initializeScenarios, scenarioProduction, scenarioAwards, riverBonus, conquered} from './traders-barbarians';
import {COMMODITIES, type Good} from './expansion-model';
import {validateExpansionSettings} from './expansion-settings';
import {initializeExpansions, expansionPublic, expansionPrivate, applyExpansion, resetExpansionTurn, endExpansionTurn} from './expansions';
import {cityEvent} from './cities-knights';
import {GOODS} from './core';
import {total, has, need, player, vertex, edge, building, route, paused, random, transfer, event, phase, acting, preRoutes, domestic, pieceCount, score, awards, finishIfWon} from './core';
import type {Player, State} from './state';
export type { State } from './state';
import { chooseExpansionAction } from './cpu';
export { longestRoute } from './core';
import type {GameRules} from '../../../party-contract/src/index';
import {makeBoard, shuffled} from './board';
import {COSTS, RESOURCES, emptyHand, type Action, type DevKind, type Hand, type Offer, type PrivateView, type PublicView, type Resource, type Route, type Settings} from './model';

function availableSettlement(s: State, id: string, setup: boolean, p: Player) {
  const v = vertex(s, id);
  return !!v && !s.modules?.public.deliveries?.depots.some(d => d.vertex === id) && !barbarianBlocks(s, v.tiles) && exploredBuild(s, p.id, v.tiles) && (!setup || s.settings.expansion !== 'explorers' || expeditionSetupKind(s) !== 'harbor' || v.edges.some(e => edge(s, e)!.sea)) && !s.modules?.public.knights.some(k => k.vertex === id) && !building(s, id) && v.tiles.some(id => s.board.tiles.some(t => t.id === id && !['sea', 'shoal', 'fog'].includes(t.terrain) && (!setup || t.island === 0))) && v.edges.every(id => {
    const e = edge(s, id)!; return !building(s, e.a === v.id ? e.b : e.a);
  }) && (setup || v.edges.some(id => route(s, id)?.playerId === p.id));
}
function availableRoute(s: State, id: string, kind: Route['kind'], p: Player, setup = false) {
  const e = edge(s, id);
  if (s.settings.expansion === 'explorers' && setup) { const harbor = building(s, s.setupVertex ?? '')?.kind === 'harbor'; if (kind === 'ship') return !!e && harbor && e.sea && e.tiles.every(t => s.board.tiles.find(x => x.id === t)?.terrain !== 'fog') && s.modules!.public.explorers!.ships.filter(sh => sh.edge === id).length < 2 && [e.a, e.b].includes(s.setupVertex ?? ''); if (harbor) return false; }
  if (e && kind === 'road' && barbarianBlocks(s, e.tiles)) return false;
  if (e && !exploredBuild(s, p.id, e.tiles)) return false;
  if (kind === 'road' && s.modules?.public.rivers?.bridgeSites.includes(id)) return false;
  if (!e || route(s, id) || (kind === 'road' ? !e.land : !e.sea || s.settings.expansion !== 'seafarers' || e.tiles.includes(s.pirate ?? ''))) return false;
  if (s.modules?.freeRouteKind[p.id] && p.freeRoutes && s.modules.freeRouteKind[p.id] !== kind) return false;
  if (setup) return [e.a, e.b].includes(s.setupVertex ?? '');
  return [e.a, e.b].some(v => {
    const b = building(s, v), k = s.modules?.public.knights.find(k => k.vertex === v);
    if (k && k.playerId !== p.id) return false;
    return b ? b.playerId === p.id : vertex(s, v)!.edges.some(id => { const r = route(s, id); return r?.playerId === p.id && r.kind === kind; });
  });
}
function openShip(s: State, id: string, p: Player) {
  const e = edge(s, id), r = route(s, id);
  if (!e || r?.playerId !== p.id || r.kind !== 'ship' || p.builtShips.includes(id) || e.tiles.includes(s.pirate ?? '')) return false;
  return [e.a, e.b].some(v => building(s, v)?.playerId !== p.id && !s.modules?.public.knights.some(k => k.vertex === v) && vertex(s, v)!.edges.filter(other => route(s, other)?.playerId === p.id && route(s, other)?.kind === 'ship').length === 1);
}
function resetTurn(s: State, p: Player) { p.turns++; p.played = false; p.freeRoutes = 0; p.moved = false; p.builtShips = []; resetExpansionTurn(s, p.id); }
function actionPhase(s: State, now: number) {
  phase(s, 'action'); s.actionStarted = now;
  if (s.settings.mode === 'connect' && s.deadline === null) s.deadline = now + s.settings.roundSeconds * 1000;
}
function beginTurn(s: State, now: number) {
  s.readyIds = []; s.offers = []; s.deadline = null; s.actorId = s.players[s.primary].id; s.turn++;
  if (s.settings.mode === 'connect') for (const p of s.players) resetTurn(s, p); else resetTurn(s, player(s, s.actorId));
  phase(s, 'roll'); if (finishIfWon(s)) return;
  event(s, 'phase', s.settings.mode === 'connect' ? `Round ${s.turn}: shared production` : `${player(s, s.actorId).name}'s turn`);
  if (s.settings.mode === 'connect') roll(s, now);
}
function nextTurn(s: State, now: number) {
  s.offers = [];
  if (s.settings.mode === 'standard' && s.players.length >= 5 && !s.secondary) {
    s.secondary = true; s.actorId = s.players[(s.primary + Math.floor(s.players.length / 2)) % s.players.length].id;
    resetTurn(s, player(s, s.actorId)); actionPhase(s, now); finishIfWon(s);
    event(s, 'phase', `${player(s, s.actorId).name}: paired build turn. Bank trades only.`); return;
  }
  s.secondary = false; s.primary = (s.primary + 1) % s.players.length; beginTurn(s, now);
}
function production(s: State, value: number) {
  const owed = s.players.map(() => emptyHand());
  for (const b of s.buildings) {
    const i = s.players.findIndex(p => p.id === b.playerId), amount = b.kind === 'city' ? 2 : 1;
    for (const id of vertex(s, b.vertex)!.tiles) {
      const t = s.board.tiles.find(t => t.id === id)!;
      if (t.number !== value || t.id === s.robber || (s.modules?.public.attack?.barbarians.find(b => b.tile === t.id)?.count ?? 0) >= 3) continue;
      if (t.terrain === 'gold') { if (s.modules?.public.explorers) s.modules.players[s.players[i].id].coins += 2; else s.players[i].goldDue += amount; }
      else if (RESOURCES.includes(t.terrain as Resource)) {
        const commodity = s.settings.citiesKnights && amount === 2 ? ({ wood: 'paper', wool: 'cloth', ore: 'coin' } as const)[t.terrain as 'wood'] : null;
        owed[i][t.terrain as Resource] += commodity ? 1 : amount;
        if (commodity) owed[i][commodity] = (owed[i][commodity] ?? 0) + 1;
      }
    }
  }
  for (const r of GOODS) {
    const recipients = owed.map((h, i) => ({ p: s.players[i], n: h[r] ?? 0 })).filter(x => x.n);
    const enough = recipients.reduce((n, x) => n + x.n, 0) <= (s.bank[r] ?? 0);
    if (enough || recipients.length === 1) for (const x of recipients) transfer(s.bank, x.p.hand, { ...emptyHand(), [r]: Math.min(x.n, s.bank[r] ?? 0) });
  }
}
const resourceTotal = (h: Hand) => RESOURCES.reduce((n, r) => n + h[r], 0);
function afterDiscard(s: State, now: number) {
  if (s.modules?.public.attack) { actionPhase(s, now); if (s.players.some(p => p.id !== s.actorId && total(p.hand))) queue(s, { playerId: s.actorId, kind: 'rob', title: 'Steal one card from any opponent' }, now); }
  else if (s.modules?.public.deliveries) { actionPhase(s, now); moveBarbarianPrompt(s, s.actorId, now); }
  else if (s.settings.expansion !== 'explorers' && s.settings.citiesKnights && !s.modules?.public.barbarian?.attacks && !s.modules?.public.attack) actionPhase(s, now);
  else {
    phase(s, 'robber');
    if (s.modules?.public.explorers) for (const p of s.players) if (s.modules.players[p.id].improvements.science >= 3 && resourceTotal(s.bank)) queue(s, { playerId: p.id, kind: 'event-pick', title: 'Aqueduct: choose one resource', count: 1 }, now);
  }
}
function resolveProduction(s: State, now: number) {
  if (s.modules) s.modules.continuation = null;
  const value = s.dice![0] + s.dice![1]; s.returnPhase = 'action';
  if (s.modules?.public.deliveries && s.modules.public.attack && [2, 12].includes(value)) { const depot = s.modules.public.deliveries.depots.find(d => d.kind === (value === 12 ? 'castle' : 'glassworks')); const invaders = s.modules.public.attack.barbarians.find(b => b.tile === depot?.tile); if (invaders) invaders.count = Math.min(3, invaders.count + 1); syncBarbarianPaths(s); }
  if (value === 7) {
    if (s.modules?.public.explorers) for (const p of s.players) s.modules.players[p.id].coins++;
    for (const p of s.players) { const limit = 7 + (s.modules?.public.walls.filter(at => building(s, at)?.playerId === p.id).length ?? 0) * 2; p.discardDue = total(p.hand) > limit ? Math.floor(total(p.hand) / 2) : 0; }
    if (s.players.some(p => p.discardDue)) phase(s, 'discard'); else afterDiscard(s, now);
  } else {
    const before = s.players.map(p => total(p.hand)); production(s, value); scenarioProduction(s, value);
    for (const [i, p] of s.players.entries()) { if (s.modules?.public.explorers && total(p.hand) === before[i]) s.modules.players[p.id].coins++; if ((s.modules?.players[p.id].improvements.science ?? 0) >= 3 && total(p.hand) === before[i] && !p.goldDue) p.goldDue = 1; p.goldDue = Math.min(p.goldDue, resourceTotal(s.bank)); }
    if (s.players.some(p => p.goldDue)) phase(s, 'gold'); else actionPhase(s, now);
  }
}
function roll(s: State, now: number) {
  s.dice = s.modules?.alchemy ?? [1 + Math.floor(random(s) * 6), 1 + Math.floor(random(s) * 6)];
  if (s.modules) s.modules.alchemy = null;
  if (s.modules?.public.deliveries && !s.modules.public.attack && !s.modules.public.caravans && !s.modules.public.rivers) while ([2, 12].includes(s.dice[0] + s.dice[1])) s.dice = [1 + Math.floor(random(s) * 6), 1 + Math.floor(random(s) * 6)];
  event(s, 'roll', `Rolled ${s.dice[0]} + ${s.dice[1]} = ${s.dice[0] + s.dice[1]}`, s.actorId);
  cityEvent(s, now);
  if (s.modules?.prompts.length) s.modules.continuation = 'production'; else resolveProduction(s, now);
}
function rates(s: State, p: Player): Hand {
  const result = Object.fromEntries(GOODS.map(r => [r, s.settings.expansion === 'explorers' ? 3 : 4])) as Hand;
  for (const port of s.board.ports) if (port.vertices.some(id => building(s, id)?.playerId === p.id && !conquered(s, id))) for (const r of GOODS) if (port.resource === 'any' || port.resource === r) result[r] = Math.min(result[r] ?? 4, port.resource === 'any' ? 3 : 2);
  const x = s.modules?.players[p.id], merchant = s.modules?.public.merchant;
  if (x) { for (const r of COMMODITIES) if (x.improvements.trade >= 3) result[r] = 2; for (const r of x.fleet) result[r as Good] = 2; }
  if (merchant?.playerId === p.id) { const r = s.board.tiles.find(t => t.id === merchant.tile)!.terrain; if (RESOURCES.includes(r as Resource)) result[r as Resource] = 2; }
  return result;
}
function legal(s: State, p: Player): PrivateView['legal'] {
  const result: PrivateView['legal'] = { offers: [], roads: [], ships: [], settlements: [], cities: [], shipMoves: [], robber: [], pirate: [], victims: {} };
  if (paused(s)) return result;
  result.offers = s.offers.filter(o => respond(s, p, o)).map(o => o.id);
  const setup = s.phase === 'setup' && s.actorId === p.id, act = acting(s, p), pieces = pieceCount(s, p);
  if (setup || act || preRoutes(s, p)) {
    if (pieces.settlements && (setup && !s.setupVertex || act && has(p.hand, COSTS.settlement))) result.settlements = s.board.vertices.filter(v => availableSettlement(s, v.id, setup, p)).map(v => v.id);
    if (act && (s.settings.expansion !== 'explorers' || s.settings.citiesKnights) && pieces.cities && has(p.hand, COSTS.city)) result.cities = s.buildings.filter(b => b.playerId === p.id && b.kind === 'settlement' && (!s.modules?.pillaged.some(at => building(s, at)?.playerId === p.id) || s.modules.pillaged.includes(b.vertex))).map(b => b.vertex);
    for (const kind of ['road', 'ship'] as const) if (pieces[kind === 'road' ? 'roads' : 'ships'] && (setup && s.setupVertex || preRoutes(s, p) || act && (p.freeRoutes || has(p.hand, COSTS[kind])))) result[kind === 'road' ? 'roads' : 'ships'] = s.board.edges.filter(e => availableRoute(s, e.id, kind, p, setup)).map(e => e.id);
    if (act && !p.moved) for (const r of s.routes.filter(r => openShip(s, r.edge, p))) {
      const without = { ...s, routes: s.routes.filter(item => item !== r) };
      const targets = s.board.edges.filter(e => e.id !== r.edge && availableRoute(without, e.id, 'ship', p)).map(e => e.id);
      if (targets.length) result.shipMoves.push({ from: r.edge, to: targets });
    }
  }
  if (s.phase === 'robber' && s.actorId === p.id) {
    for (const t of s.board.tiles) {
      const pirate = t.terrain === 'sea' || t.terrain === 'shoal';
      if (s.settings.expansion === 'explorers' && (!pirate || !expeditionPirateTargets(s).includes(t.id))) continue;
      if (!pirate && s.settings.variants?.includes('friendly-robber') && s.buildings.some(b => vertex(s, b.vertex)!.tiles.includes(t.id) && score(s, player(s, b.playerId)) <= 2)) continue;
      if (t.id === (pirate ? s.pirate : s.robber) || pirate && s.settings.expansion === 'base') continue;
      result[pirate ? 'pirate' : 'robber'].push(t.id);
      const victims = pirate && s.modules?.public.explorers ? s.modules.public.explorers.ships.filter(sh => { const e = edge(s, sh.edge)!; return [e.a, e.b].some(at => vertex(s, at)!.tiles.includes(t.id)); }).map(sh => sh.playerId) : pirate ? s.routes.filter(r => r.kind === 'ship' && edge(s, r.edge)!.tiles.includes(t.id)).map(r => r.playerId) : s.buildings.filter(b => vertex(s, b.vertex)!.tiles.includes(t.id)).map(b => b.playerId);
      result.victims[t.id] = [...new Set(victims)].filter(id => id !== p.id && (total(player(s, id).hand) > 0 || s.modules?.public.explorers && s.modules.players[id].coins > 0));
    }
  }
  return result;
}
function object(raw: unknown): Record<string, unknown> { need(raw && typeof raw === 'object' && !Array.isArray(raw), 'Expected an object.'); return raw as Record<string, unknown>; }
function text(raw: unknown): string { need(typeof raw === 'string' && raw.length > 0 && raw.length <= 80, 'Invalid identifier.'); return raw; }
function resource(raw: unknown): Good { need(GOODS.includes(raw as Good), 'Unknown resource or commodity.'); return raw as Good; }
function hand(raw: unknown): Hand {
  const value = object(raw), result = emptyHand();
  need(Object.keys(value).every(key => GOODS.includes(key as Good)), 'Unknown resource.');
  for (const r of GOODS) { if (COMMODITIES.includes(r as never) && value[r] === undefined) continue; need(Number.isInteger(value[r]) && Number(value[r]) >= 0 && Number(value[r]) <= 200, 'Invalid resource amount.'); result[r] = Number(value[r]); } return result;
}
export function parseAction(raw: unknown): Action {
  const a = object(raw); need(Number.isSafeInteger(a.turnId) && Number(a.turnId) >= 0, 'Invalid turn.'); const base = { turnId: Number(a.turnId) };
  switch (a.type) {
    case 'expansion': { const choices = object(a.choices); need(Object.keys(choices).length <= 8, 'Too many choices.'); return { ...base, type: 'expansion', command: text(a.command), choices: Object.fromEntries(Object.entries(choices).map(([key, value]) => [text(key), text(value)])), ...(a.cards === undefined ? {} : { cards: hand(a.cards) }) }; }
    case 'roll': case 'end': case 'buy-development': return { ...base, type: a.type };
    case 'build': need(['road', 'ship', 'settlement', 'city'].includes(String(a.kind)), 'Unknown building.'); return { ...base, type: a.type, kind: a.kind as 'road', target: text(a.target) };
    case 'move-ship': return { ...base, type: a.type, from: text(a.from), to: text(a.to) };
    case 'discard': case 'gold': return { ...base, type: a.type, cards: hand(a.cards) };
    case 'robber': need(typeof a.pirate === 'boolean', 'Choose robber or pirate.'); return { ...base, type: a.type, target: text(a.target), victim: a.victim === null ? null : text(a.victim), pirate: a.pirate };
    case 'bank': return { ...base, type: a.type, give: resource(a.give), get: resource(a.get) };
    case 'offer': return { ...base, type: a.type, give: hand(a.give), get: hand(a.get) };
    case 'accept-offer': case 'cancel-offer': return { ...base, type: a.type, offerId: text(a.offerId) };
    case 'complete-offer': return { ...base, type: a.type, offerId: text(a.offerId), partner: text(a.partner) };
    case 'play-development': return { ...base, type: a.type, cardId: text(a.cardId), ...(a.resource === undefined ? {} : { resource: resource(a.resource) as Resource }), ...(a.cards === undefined ? {} : { cards: hand(a.cards) }) };
    default: throw new Error('Unknown action.');
  }
}

function respond(s: State, p: Player, offer: Offer) {
  return s.phase === 'action' && !s.readyIds.includes(p.id) && !s.readyIds.includes(offer.playerId) && !s.modules?.players[p.id].movement && !s.modules?.players[offer.playerId].movement && p.id !== offer.playerId && (s.settings.mode === 'connect' || !s.secondary && [p.id, offer.playerId].includes(s.actorId));
}
function apply(s: State, id: string, a: Action, now: number) {
  const p = player(s, id); need(a.turnId === s.turnId, 'The turn changed. Choose again.'); need(!paused(s), 'Waiting for disconnected players to return.'); need(s.phase !== 'ended', 'The game has finished.');
  if (s.settings.mode === 'connect' && s.phase === 'action' && s.deadline !== null) need(now < s.deadline, 'This round has ended.');
  const act = acting(s, p), setup = s.phase === 'setup' && s.actorId === id;
  switch (a.type) {
    case 'expansion': applyExpansion(s, id, a, now); awards(s); finishIfWon(s); break;
    case 'roll': need(s.phase === 'roll' && s.actorId === id && !preRoutes(s, p), 'Finish your free routes before rolling.'); roll(s, now); break;
    case 'build': {
      need(setup || act || preRoutes(s, p), 'Wait for your building turn.'); const allowed = legal(s, p);
      const list = { road: allowed.roads, ship: allowed.ships, settlement: allowed.settlements, city: allowed.cities }[a.kind];
      need(list.includes(a.target), 'That spot is unavailable, or you cannot afford this piece.');
      const isRoute = a.kind === 'road' || a.kind === 'ship';
      if (!setup) { if (isRoute && p.freeRoutes) p.freeRoutes--; else transfer(p.hand, s.bank, COSTS[a.kind]); }
      if (a.kind === 'city') { building(s, a.target)!.kind = 'city'; if (s.modules) s.modules.pillaged = s.modules.pillaged.filter(at => at !== a.target); }
      else if (isRoute && s.modules?.public.explorers && a.kind === 'ship') newShip(s, id, a.target, setup ? [{ kind: 'settler', source: '' }] : []);
      else if (isRoute) { s.routes.push({ edge: a.target, playerId: id, kind: a.kind as Route['kind'] }); if (a.kind === 'ship') p.builtShips.push(a.target); }
      else {
        s.buildings.push({ vertex: a.target, playerId: id, kind: setup && s.settings.expansion === 'explorers' ? expeditionSetupKind(s) : setup && s.setupIndex >= s.players.length && (s.settings.citiesKnights || s.modules?.public.attack || s.modules?.public.deliveries) ? 'city' : 'settlement' });
        if (s.modules?.public.explorers && building(s, a.target)?.kind === 'harbor') s.modules.public.explorers.harbors.push({ vertex: a.target, cargo: [] });
        if (!setup && s.settings.expansion === 'seafarers') for (const t of vertex(s, a.target)!.tiles.map(id => s.board.tiles.find(t => t.id === id)!)) if (t.island > 0 && !p.islands.includes(t.island)) p.islands.push(t.island);
      }
      afterScenarioBuild(s, id, a.target, a.kind, setup); riverBonus(s, id, a.target, a.kind, setup); scenarioAwards(s);
      event(s, 'build', `${p.name} built a ${a.kind}`, id, a.target);
      if (setup) {
        if (!isRoute) {
          s.setupVertex = a.target;
          if (s.setupIndex >= s.players.length) for (const tileId of vertex(s, a.target)!.tiles) {
            const t = s.board.tiles.find(t => t.id === tileId)!;
            if (RESOURCES.includes(t.terrain as Resource) && s.bank[t.terrain as Resource]) transfer(s.bank, p.hand, { ...emptyHand(), [t.terrain]: 1 });
          }
          s.turnId++;
        } else {
          s.setupVertex = null; s.setupIndex++;
          if (s.setupIndex === s.players.length * 2) beginTurn(s, now);
          else { s.actorId = s.players[s.setupIndex < s.players.length ? s.setupIndex : 2 * s.players.length - 1 - s.setupIndex].id; s.turnId++; }
        }
      }
      awards(s); finishIfWon(s); break;
    }
    case 'move-ship': {
      need(act, 'Wait for your building turn.'); need(legal(s, p).shipMoves.some(m => m.from === a.from && m.to.includes(a.to)), 'That ship cannot move there.');
      route(s, a.from)!.edge = a.to; p.moved = true; event(s, 'build', `${p.name} moved a ship`, id, a.to); awards(s); finishIfWon(s); break;
    }
    case 'discard': {
      need(s.phase === 'discard' && p.discardDue > 0 && total(a.cards) === p.discardDue, `Choose exactly ${p.discardDue} resources to discard.`);
      transfer(p.hand, s.bank, a.cards); p.discardDue = 0;
      if (s.players.every(p => !p.discardDue)) afterDiscard(s, now); break;
    }
    case 'gold': {
      need(s.phase === 'gold' && p.goldDue > 0 && COMMODITIES.every(r => !a.cards[r]) && total(a.cards) === Math.min(p.goldDue, resourceTotal(s.bank)), `Choose ${Math.min(p.goldDue, resourceTotal(s.bank))} gold-field resources.`);
      transfer(s.bank, p.hand, a.cards); p.goldDue = 0;
      for (const other of s.players) other.goldDue = Math.min(other.goldDue, resourceTotal(s.bank));
      if (s.players.every(p => !p.goldDue)) actionPhase(s, now); break;
    }
    case 'robber': {
      need(s.phase === 'robber' && s.actorId === id, 'You are not moving the robber.'); const targets = legal(s, p);
      need(targets[a.pirate ? 'pirate' : 'robber'].includes(a.target), 'Choose a different valid hex.');
      const victims = targets.victims[a.target] ?? [];
      need(victims.length ? a.victim !== null && victims.includes(a.victim) : a.victim === null, 'Choose an eligible opponent.');
      if (a.pirate) { s.pirate = a.target; if (s.modules?.public.explorers) { s.modules.public.explorers.pirateOwner = id; const shoal = s.modules.public.explorers.shoals.find(f => f.tile === a.target); if (shoal) shoal.fish = false; } } else s.robber = a.target;
      if (a.victim) {
        const victim = player(s, a.victim); if (!total(victim.hand) && s.modules?.public.explorers) { s.modules.players[a.victim].coins--; s.modules.players[id].coins++; } let chosen = Math.floor(random(s) * total(victim.hand));
        for (const r of GOODS) { if (chosen < (victim.hand[r] ?? 0)) { transfer(victim.hand, p.hand, { ...emptyHand(), [r]: 1 }); break; } chosen -= victim.hand[r] ?? 0; }
      }
      event(s, 'robber', `${p.name} moved the ${a.pirate ? 'pirate' : 'robber'}${a.victim ? ` and stole from ${player(s, a.victim).name}` : ''}`, id, a.target);
      if (s.interruptedAt !== null && s.deadline !== null) s.deadline += now - s.interruptedAt;
      s.interruptedAt = null;
      if (s.modules?.resumeMovement) { phase(s, s.modules.resumeMovement); s.modules.resumeMovement = null; } else if (s.returnPhase === 'roll') phase(s, 'roll'); else actionPhase(s, now);
      finishIfWon(s); break;
    }
    case 'bank': {
      need(act && a.give !== a.get, 'Bank trades are available on your action turn.');
      need((s.bank[a.get] ?? 0) > 0, 'The bank has none of that resource.');
      transfer(p.hand, s.bank, { ...emptyHand(), [a.give]: rates(s, p)[a.give] }); transfer(s.bank, p.hand, { ...emptyHand(), [a.get]: 1 });
      event(s, 'trade', `${p.name} traded ${rates(s, p)[a.give]} ${a.give} for 1 ${a.get} with the bank`, id); break;
    }
    case 'offer': {
      need(domestic(s, p), 'Player trades are not available now.');
      need(total(a.give) > 0 && total(a.get) > 0 && GOODS.every(r => !a.give[r] || !a.get[r]), 'Offer different resources on each side. Gifts are not allowed.');
      need(has(p.hand, a.give), 'You do not have those resources.');
      s.offers = s.offers.filter(o => o.playerId !== id); s.offers.push({ id: `o${++s.serial}`, playerId: id, give: a.give, get: a.get, accepts: [] }); break;
    }
    case 'accept-offer': case 'cancel-offer': case 'complete-offer': {
      const offer = s.offers.find(o => o.id === a.offerId); need(offer, 'This offer is no longer available.');
      if (a.type === 'cancel-offer') { need(offer.playerId === id, 'Only the proposer can cancel this offer.'); s.offers = s.offers.filter(o => o !== offer); break; }
      const proposer = player(s, offer.playerId);
      if (a.type === 'accept-offer') {
        need(respond(s, p, offer) && has(p.hand, offer.get) && has(proposer.hand, offer.give), 'You cannot accept this offer now.');
        need(!offer.accepts.includes(id), 'You already accepted this offer.'); offer.accepts.push(id);
      } else if (a.type === 'complete-offer') {
        const partner = player(s, a.partner);
        need(offer.playerId === id && domestic(s, p) && respond(s, partner, offer) && offer.accepts.includes(a.partner), 'Choose a player who accepted this offer.');
        need(has(p.hand, offer.give) && has(partner.hand, offer.get), 'One of the hands changed. Make a new offer.');
        transfer(p.hand, partner.hand, offer.give); transfer(partner.hand, p.hand, offer.get);
        const describe = (h: Hand) => GOODS.filter(r => h[r]).map(r => `${h[r]} ${r}`).join(', ');
        event(s, 'trade', `${p.name} gave ${describe(offer.give)} to ${partner.name} for ${describe(offer.get)}`, id); s.offers = s.offers.filter(o => o !== offer);
      }
      break;
    }
    case 'buy-development': {
      need(act && s.deck.length, 'Development cards are not available.'); transfer(p.hand, s.bank, COSTS.development);
      p.development.push({ id: `d${++s.serial}`, kind: s.deck.pop()!, bought: p.turns }); event(s, 'card', `${p.name} bought a development card`, id); finishIfWon(s); break;
    }
    case 'play-development': {
      need(act || s.phase === 'roll' && s.actorId === id, 'You cannot play a development card now.');
      const card = p.development.find(c => c.id === a.cardId);
      need(card && card.kind !== 'victory' && card.bought < p.turns && !p.played, 'That development card cannot be played this turn.');
      if (card.kind === 'plenty') { need(a.cards && total(a.cards) === Math.min(2, total(s.bank)), 'Choose two available resources.'); transfer(s.bank, p.hand, a.cards); }
      if (card.kind === 'monopoly') { need(a.resource, 'Choose a resource.'); for (const other of s.players) if (other !== p) transfer(other.hand, p.hand, { ...emptyHand(), [a.resource]: other.hand[a.resource] }); }
      if (card.kind === 'road-building') p.freeRoutes = 2;
      if (card.kind === 'swift-journey') s.modules!.players[id].wagonJourneys++;
      if (card.kind === 'knight' && s.modules?.public.deliveries) { p.knights++; moveBarbarianPrompt(s, id, now); }
      else if (card.kind === 'knight') { p.knights++; s.returnPhase = s.phase === 'roll' ? 'roll' : 'action'; s.actorId = id; s.interruptedAt = s.deadline === null ? null : now; phase(s, 'robber'); }
      p.played = true; p.development = p.development.filter(c => c !== card); event(s, 'card', `${p.name} played ${card.kind}`, id); awards(s); finishIfWon(s); break;
    }
    case 'end': {
      need(act || moving(s, id) || preRoutes(s, p), 'Your action turn is not active.'); const beforeRoll = preRoutes(s, p); p.freeRoutes = 0;
      if (beforeRoll) break;
      if (endExpansionTurn(s, id, now)) break;
      if (s.modules) s.modules.players[id].movement = false;
      if (s.settings.mode === 'standard') { if (!finishIfWon(s)) nextTurn(s, now); }
      else { s.readyIds.push(id); s.offers = s.offers.filter(o => o.playerId !== id); } break;
    }
  }
  if (s.modules && !s.modules.prompts.length && s.modules.continuation === 'production') resolveProduction(s, now);
  syncBarbarianPaths(s); scenarioAwards(s); if (s.modules) finishIfWon(s);
  s.offers = s.offers.filter(o => has(player(s, o.playerId).hand, o.give));
  for (const o of s.offers) o.accepts = o.accepts.filter(id => has(player(s, id).hand, o.get) && !s.readyIds.includes(id));
}

const views = new WeakMap<State, { revision: number; public: PublicView; private: Map<string, PrivateView> }>();
function projections(s: State) {
  const cached = views.get(s); if (cached?.revision === s.revision) return cached;
  const publicView: PublicView = {
    ...(s.modules ? { expansions: expansionPublic(s)! } : {}), ...(s.phase === 'setup' ? { setupPiece: s.settings.expansion === 'explorers' ? expeditionSetupKind(s) : (s.settings.citiesKnights || s.modules?.public.attack || s.modules?.public.deliveries) && s.setupIndex >= s.players.length ? 'city' as const : 'settlement' as const } : {}), settings: s.settings, board: s.board, revision: s.revision, turnId: s.turnId, turn: s.turn, phase: s.phase, actorId: s.actorId, secondary: s.secondary,
    activeIds: s.phase === 'choice' ? [s.modules!.prompts[0].playerId] : s.phase === 'setup' || s.phase === 'roll' || s.phase === 'robber' ? [s.actorId] : s.phase === 'discard' ? s.players.filter(p => p.discardDue).map(p => p.id) : s.phase === 'gold' ? s.players.filter(p => p.goldDue).map(p => p.id) : s.players.filter(p => acting(s, p) || moving(s, p.id)).map(p => p.id),
    readyIds: s.readyIds, pausedPlayers: s.players.filter(p => !p.connected).map(p => p.id), deadline: s.deadline, dice: s.dice,
    robber: s.robber, pirate: s.pirate, routes: s.routes, buildings: s.buildings, offers: s.offers, events: s.events,
    players: s.players.map(p => ({ id: p.id, name: p.name, color: p.color, cpu: p.cpu, score: score(s, p, s.phase === 'ended'), handCount: total(p.hand), developmentCount: p.development.length, knights: p.knights, longestRoute: p.longestRoute, connected: p.connected, pieces: pieceCount(s, p) })),
    longestOwner: s.longestOwner, armyOwner: s.armyOwner, deckCount: s.deck.length, winners: s.winners,
  };
  const privateViews = new Map(s.players.map(p => [p.id, {
    ...(s.modules ? { expansion: expansionPrivate(s, p.id)! } : {}), bank: s.bank, hand: p.hand, development: p.development.map(c => ({ id: c.id, kind: c.kind, playable: !paused(s) && c.kind !== 'victory' && !p.played && c.bought < p.turns && (acting(s, p) || s.phase === 'roll' && s.actorId === p.id) })), score: score(s, p, true),
    discardDue: p.discardDue, goldDue: Math.min(p.goldDue, resourceTotal(s.bank)), freeRoutes: p.freeRoutes,
    canRoll: !paused(s) && s.phase === 'roll' && s.actorId === p.id && !preRoutes(s, p), canAct: !paused(s) && (acting(s, p) || moving(s, p.id) || preRoutes(s, p)), canEnd: !paused(s) && (acting(s, p) || moving(s, p.id) || preRoutes(s, p)), canTrade: !paused(s) && domestic(s, p), legal: legal(s, p), rates: rates(s, p),
  } satisfies PrivateView]));
  const value = { revision: s.revision, public: publicView, private: privateViews }; views.set(s, value); return value;
}
export const rules: GameRules<State, null, Action, Settings, PublicView, PrivateView> = {
  validateSettings(raw) {
    return validateExpansionSettings(object(raw));
  },
  parseInput(raw) { need(raw === null, 'This game uses discrete actions.'); return null; }, neutralInput: () => null, parseAction,
  create(ctx, settings) {
    need(ctx.players.length >= 1 && ctx.players.length <= 10, 'Island Settlers needs 1–10 human players.');
    const roster = ctx.players.map(p => ({ ...p, cpu: false })), colors = ['#ff5748', '#28c6e7', '#78d955', '#b58aff', '#ffd24a', '#fb8cd0', '#41dbcb', '#ffab57', '#9eaaff', '#d9f282'];
    for (let i = 1; roster.length < (settings.tableSize ?? 3); i++) {
      const id = `cpu:${i}`; if (roster.some(p => p.id === id)) continue;
      roster.push({ id, name: `CPU ${i}`, color: colors.find(color => !roster.some(p => p.color === color)) ?? colors[roster.length], cpu: true });
    }
    const s: State = {
      cpuAt: ctx.nowMs + 700, cpuCursor: 0, modules: null, settings, board: { tiles: [], vertices: [], edges: [], ports: [] }, players: roster.map(p => ({ ...p, hand: emptyHand(), development: [], turns: 0, played: false, freeRoutes: 0, moved: false, builtShips: [], knights: 0, longestRoute: 0, islands: [], connected: true, discardDue: 0, goldDue: 0 })),
      bank: Object.fromEntries(RESOURCES.map(r => [r, roster.length <= 4 ? 19 : roster.length <= 6 ? 24 : Math.ceil(roster.length * 4.75)])) as Hand,
      random: (ctx.seed >>> 0) || 1, deck: [], routes: [], buildings: [], offers: [], events: [], serial: 0, revision: 0,
      phase: 'setup', returnPhase: 'action', actorId: ctx.players[0].id, primary: 0, secondary: false, setupIndex: 0, setupVertex: null,
      turnId: 1, turn: 0, deadline: null, actionStarted: ctx.nowMs, readyIds: [], pausedAt: null, interruptedAt: null, dice: null, robber: '', pirate: null, longestOwner: null, armyOwner: null, winners: [],
    };
    s.board = makeBoard(roster.length, settings.expansion, () => random(s));
    s.robber = s.board.tiles.find(t => t.terrain === 'desert')!.id;
    s.pirate = settings.expansion === 'seafarers' ? s.board.tiles.find(t => t.terrain === 'sea')!.id : null;
    const copies = roster.length <= 4 ? 1 : roster.length <= 6 ? 1.4 : 2;
    s.deck = shuffled<DevKind>([...Array(Math.round(14 * copies)).fill('knight'), ...Array(Math.round(5 * (copies === 1.4 ? 1 : copies))).fill('victory'), ...(['road-building', 'plenty', 'monopoly'] as const).flatMap(k => Array(Math.round(2 * copies)).fill(k))], () => random(s));
    s.modules = initializeExpansions(s); initializeScenarios(s); initializeBarbarians(s); initializeExplorers(s); syncBarbarianPaths(s); scenarioAwards(s);
    event(s, 'phase', 'Place starting settlements and routes. The second placement goes in reverse order.'); return s;
  },
  applyAction(state, id, action, now) {
    // A rejected action must not spend cards, alter RNG, or partly execute a trade.
    const next = structuredClone(state); apply(next, id, action, now); next.revision++; Object.assign(state, next);
  },
  tick(s, _inputs, _dt, now) {
    if (paused(s) || s.phase === 'ended') return;
    if (now >= s.cpuAt && !(s.phase === 'action' && s.deadline !== null && now >= s.deadline)) {
      s.cpuAt = now + 700;
      for (let n = 0; n < s.players.length; n++) {
        const index = (s.cpuCursor + n) % s.players.length, p = s.players[index]; if (!p.cpu) continue;
        const view = projections(s), action = chooseExpansionAction(view.public, view.private.get(p.id)!, p.id);
        if (!action) continue;
        rules.applyAction(s, p.id, action, now); s.cpuCursor = (index + 1) % s.players.length;
        if (action.type === 'accept-offer' && s.settings.mode === 'standard' && s.actorId === p.id) s.cpuAt = now + 8000;
        break;
      }
    }
    if (s.phase !== 'action' || s.settings.mode !== 'connect') return;
    if (s.deadline !== null && now >= s.deadline || s.readyIds.length === s.players.length && now >= s.actionStarted + 3000) {
      for (const p of s.players.filter(p => !s.readyIds.includes(p.id))) { if (endExpansionTurn(s, p.id, now, true)) { s.revision++; return; } p.freeRoutes = 0; if (s.modules) s.modules.players[p.id].movement = false; s.readyIds.push(p.id); }
      syncBarbarianPaths(s); scenarioAwards(s); awards(s); if (!finishIfWon(s, true)) nextTurn(s, now); s.revision++;
    }
  },
  onPresenceChange(s, id, connected, now) {
    const p = s.players.find(p => p.id === id); if (!p || p.cpu || p.connected === connected) return;
    p.connected = connected;
    if (!connected && s.pausedAt === null) s.pausedAt = now;
    if (!paused(s) && s.pausedAt !== null) { const elapsed = now - s.pausedAt; if (s.deadline !== null) s.deadline += elapsed; if (s.interruptedAt !== null) s.interruptedAt += elapsed; if (s.modules?.choiceStarted !== null && s.modules?.choiceStarted !== undefined) s.modules.choiceStarted += elapsed; s.actionStarted += elapsed; s.pausedAt = null; }
    s.revision++;
  },
  publicView: s => projections(s).public,
  playerView(s, id) { const value = projections(s).private.get(id); need(value, 'Unknown seat.'); return value; },
  outcome(s) { const rows = s.players.map(p => ({ playerId: p.id, score: score(s, p, true) })).sort((a, b) => b.score - a.score); return { complete: s.phase === 'ended', winners: s.winners, rows: rows.map(row => ({ ...row, rank: 1 + rows.filter(other => other.score > row.score).length })) }; },
  dispose(s) { views.delete(s); },
};
export default rules;
