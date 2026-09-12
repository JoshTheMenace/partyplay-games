import {invade, moveBarbarianPrompt} from './barbarian-scenarios';
import {GOODS, acting, building, edge, event, has, need, phase, player, random, route, score, total, transfer, vertex} from './core';
import {RESOURCES} from './model';
import {COMMODITIES, TRACKS, type ExpansionAction, type ExpansionCommand, type Good, type Knight, type ProgressKind, type Track} from './expansion-model';
import type {State} from './state';
import {adjacentTiles, announce, choice, command, connectedVertices, cost, emptyIntersection, extra, queue, resourceChoice, seats, steal, take} from './expansion-common';

export const PROGRESS_DECKS: Record<Track, [ProgressKind, number][]> = {
  science: [['alchemy', 2], ['crane', 2], ['engineering', 1], ['invention', 2], ['irrigation', 2], ['medicine', 2], ['mining', 2], ['printing', 1], ['road-building', 2], ['smithing', 2]],
  trade: [['commercial-harbor', 2], ['guild-dues', 2], ['merchant', 6], ['merchant-fleet', 2], ['resource-monopoly', 4], ['trade-monopoly', 2]],
  politics: [['diplomacy', 2], ['espionage', 3], ['encouragement', 2], ['intrigue', 2], ['taxation', 2], ['constitution', 1], ['treason', 2], ['wedding', 2], ['sabotage', 2]],
};
export const TRACK_GOOD: Record<Track, Good> = { science: 'paper', trade: 'cloth', politics: 'coin' };
export const allKnights = (s: State): Knight[] => (s.modules!.public.attack?.guards ?? s.modules!.public.knights) as Knight[];
export const knightReady = (s: State, k: Knight) => k.active && (s.modules!.knightTurns[k.id]?.activated ?? -1) < player(s, k.playerId).turns;
export function recruitSites(s: State, id: string) { return s.board.vertices.filter(v => emptyIntersection(s, v.id) && v.edges.some(e => route(s, e)?.playerId === id) && !v.tiles.some(t => s.board.tiles.find(x => x.id === t)?.terrain === 'fog')).map(v => v.id); }
export function promotion(s: State, k: Knight) {
  return k.strength < 3 && (k.strength < 2 || extra(s, k.playerId).improvements.politics >= 3) && (s.modules!.knightTurns[k.id]?.promoted ?? -1) < player(s, k.playerId).turns && allKnights(s).filter(x => x.playerId === k.playerId && x.strength === k.strength + 1).length < 2;
}
export function drawProgress(s: State, id: string, track: Track, now: number) {
  const m = s.modules!, kind = m.progressDecks[track].pop(); if (!kind) return;
  const p = extra(s, id);
  if (kind === 'printing' || kind === 'constitution') { p.progressPoints++; event(s, 'card', `${player(s, id).name} gained a public progress victory point`, id); }
  else { p.progress.push({ id: `pc${++s.serial}`, kind, track }); if (p.progress.length > 4 && s.settings.mode !== 'connect' && s.actorId !== id) queue(s, { playerId: id, kind: 'progress-discard', title: 'Keep four progress cards' }, now); }
}
export function discardProgress(s: State, id: string, cardId: string) {
  const p = extra(s, id), c = p.progress.find(c => c.id === cardId); need(c, 'That progress card is no longer in your hand.');
  p.progress = p.progress.filter(x => x !== c); s.modules!.progressDecks[c.track].unshift(c.kind); return c;
}
export function cityEvent(s: State, now: number) {
  if (!s.settings.citiesKnights) return;
  const m = s.modules!, v = m.public, roll = Math.floor(random(s) * 6), type = roll < 3 ? 'barbarian' : TRACKS[roll - 3];
  v.event = type === 'barbarian' ? 'Barbarian event' : `${type} progress`;
  if (v.barbarian) v.barbarian.event = type;
  if (type !== 'barbarian') {
    for (let i = 0; i < s.players.length; i++) { const p = s.players[(s.primary + i) % s.players.length], level = extra(s, p.id).improvements[type]; if (level && s.dice![0] <= level + 1) drawProgress(s, p.id, type, now); }
    return;
  }
  if (v.attack) { const tile = v.attack.barbarians.find(b => s.board.tiles.find(t => t.id === b.tile)?.number === s.dice![0] + s.dice![1]); if (tile) tile.count = Math.min(3, tile.count + 1); return; }
  const fleet = v.barbarian!; fleet.position++;
  if (fleet.position < 7) return;
  const cities = s.buildings.filter(b => b.kind === 'city'), strengths = s.players.map(p => ({ id: p.id, n: v.knights.filter(k => k.playerId === p.id && k.active).reduce((n, k) => n + k.strength, 0) }));
  if (strengths.reduce((n, p) => n + p.n, 0) >= cities.length) {
    const best = Math.max(...strengths.map(p => p.n)), defenders = strengths.filter(p => p.n === best);
    if (defenders.length === 1) { extra(s, defenders[0].id).defenderPoints++; announce(s, defenders[0].id, 'defended the island and earned 1 VP'); }
    else if (best > 0) for (const p of defenders) queue(s, { playerId: p.id, kind: 'draw', title: 'Shared defense: choose a progress deck' }, now);
  } else {
    const vulnerable = strengths.filter(p => cities.some(c => c.playerId === p.id && !v.metropolises.some(m => m.vertex === c.vertex))), weakest = Math.min(...vulnerable.map(p => p.n));
    for (const p of vulnerable.filter(p => p.n === weakest)) queue(s, { playerId: p.id, kind: 'pillage', title: 'The barbarians won. Choose a city to downgrade.' }, now);
  }
  for (const k of v.knights) k.active = false;
  fleet.position = 0; fleet.attacks++;
  s.robber = s.board.tiles.find(t => t.terrain === 'desert')?.id ?? '';
  if (s.settings.expansion === 'seafarers') s.pirate = s.board.tiles.find(t => t.terrain === 'sea')!.id;
  event(s, 'phase', `Barbarian attack: ${cities.length} attackers, ${strengths.reduce((n, p) => n + p.n, 0)} defenders`);
}
function improve(s: State, id: string, track: Track, at: string, discount: number) {
  const m = s.modules!, p = extra(s, id), level = p.improvements[track] + 1;
  need(level <= 5 && s.buildings.some(b => b.playerId === id && b.kind === 'city'), 'Build a city before improving it.');
  const incumbent = m.public.metropolises.find(x => x.track === track), capture = level >= 4 && (!incumbent || extra(s, incumbent.playerId).improvements[track] < level);
  if (capture && incumbent?.playerId !== id) need(s.buildings.some(b => b.vertex === at && b.playerId === id && b.kind === 'city') && !m.public.metropolises.some(x => x.vertex === at), 'Choose a city without a metropolis.');
  transfer(player(s, id).hand, s.bank, cost({ [TRACK_GOOD[track]]: Math.max(0, level - discount) })); p.improvements[track] = level;
  if (capture && incumbent?.playerId !== id) { m.public.metropolises = m.public.metropolises.filter(x => x.track !== track); m.public.metropolises.push({ track, vertex: at, playerId: id }); }
  invade(s, 1); announce(s, id, `improved ${track} to level ${level}`, at || null);
}
export function cityCommands(s: State, id: string): ExpansionCommand[] {
  if (!s.settings.citiesKnights) return [];
  const m = s.modules!, p = player(s, id), x = extra(s, id), v = m.public, mine = allKnights(s).filter(k => k.playerId === id), result: ExpansionCommand[] = [], act = acting(s, p);
  if (act) {
    const cities = s.buildings.filter(b => b.playerId === id && b.kind === 'city');
    if (v.walls.filter(at => building(s, at)?.playerId === id).length < 3) result.push(command('city:wall', 'Cities', 'Build a city wall', 'Raises your discard limit by two cards.', [choice('target', 'City', cities.filter(b => !v.walls.includes(b.vertex)).map(b => b.vertex), 'vertex')], cost({ brick: 2 })));
    for (const track of TRACKS) if (cities.length && x.improvements[track] < 5) {
      const incumbent = v.metropolises.find(t => t.track === track), capture = x.improvements[track] + 1 >= 4 && (!incumbent || extra(s, incumbent.playerId).improvements[track] < x.improvements[track] + 1) && incumbent?.playerId !== id;
      result.push(command(`city:improve:${track}`, 'Cities', `Improve ${track} to ${x.improvements[track] + 1}`, `Spend ${x.improvements[track] + 1} ${TRACK_GOOD[track]}. Level three unlocks an ability; levels four and five compete for a metropolis.`, capture ? [choice('target', 'Metropolis city', cities.filter(b => !v.metropolises.some(t => t.vertex === b.vertex)).map(b => b.vertex), 'vertex')] : []));
    }
    if (!v.attack) {
      if (mine.filter(k => k.strength === 1).length < 2) result.push(command('knight:recruit', 'Knights', 'Recruit a knight', 'Place an inactive basic knight on your route.', [choice('target', 'Knight position', recruitSites(s, id), 'vertex')], cost({ wool: 1, ore: 1 })));
      for (const k of mine) {
        if (!k.active) result.push(command(`knight:activate:${k.id}`, 'Knights', `Activate level ${k.strength} knight`, 'Ready for defense now; other knight actions begin on your next turn.', [], cost({ grain: 1 })));
        if (promotion(s, k)) result.push(command(`knight:promote:${k.id}`, 'Knights', `Promote level ${k.strength} knight`, 'Increase strength by one. Once per knight per turn.', [], cost({ wool: 1, ore: 1 })));
        if (knightReady(s, k)) {
          const reachable = connectedVertices(s, id, k.vertex);
          result.push(command(`knight:move:${k.id}`, 'Knights', `Move level ${k.strength} knight`, 'Move along your connected routes, then deactivate.', [choice('target', 'Destination', reachable.filter(at => emptyIntersection(s, at)), 'vertex')]));
          result.push(command(`knight:displace:${k.id}`, 'Knights', 'Displace a weaker knight', 'The opponent chooses a retreat along their own routes.', [choice('target', 'Opponent knight', v.knights.filter(o => o.playerId !== id && o.strength < k.strength && reachable.includes(o.vertex)).map(o => o.vertex), 'vertex')]));
          if (vertex(s, k.vertex)!.tiles.some(t => t === s.robber || t === s.pirate)) result.push(command(`knight:chase:${k.id}`, 'Knights', 'Chase away the robber or pirate', 'Deactivate this knight and relocate the adjacent threat.'));
          const barbarians = v.deliveries?.barbarians.filter(e => vertex(s, k.vertex)!.edges.includes(e));
          if (barbarians?.length) result.push(command(`knight:road-chase:${k.id}`, 'Knights', 'Chase a road barbarian', 'Deactivate this knight and move an adjacent barbarian.', [choice('from', 'Adjacent barbarian', barbarians, 'edge')]));
        }
      }
    }
  }
  for (const card of x.progress) {
    if (!(act || card.kind === 'alchemy' && s.phase === 'roll' && s.actorId === id)) continue;
    if (card.kind === 'alchemy' && m.alchemy) continue;
    if (card.kind === 'alchemy' && s.settings.mode === 'standard' && s.phase !== 'roll') continue;
    const c = command(`progress:${card.id}`, 'Progress', card.kind.replaceAll('-', ' '), 'Play this progress card. It returns to the bottom of its deck.');
    if (['resource-monopoly', 'irrigation', 'mining'].includes(card.kind) && card.kind === 'resource-monopoly') c.fields = [resourceChoice()];
    if (card.kind === 'trade-monopoly') c.fields = [choice('resource', 'Commodity', [...COMMODITIES])];
    if (card.kind === 'merchant-fleet') c.fields = [choice('resource', 'Good to trade at 2:1', [...GOODS])];
    if (card.kind === 'merchant') c.fields = [choice('target', 'Merchant hex', adjacentTiles(s, id).filter(t => RESOURCES.includes(t.terrain as never)).map(t => t.id), 'tile')];
    if (card.kind === 'alchemy') { c.detail = s.settings.mode === 'connect' ? 'Set the next shared roll. The first confirmed Alchemy controls it.' : 'Set both production dice before rolling the event die.'; }
    if (card.kind === 'alchemy') c.fields = [choice('red', 'Red die', ['1', '2', '3', '4', '5', '6']), choice('yellow', 'Yellow die', ['1', '2', '3', '4', '5', '6'])];
    if (card.kind === 'crane') c.fields = [choice('track', 'Improvement track', TRACKS.filter(t => x.improvements[t] < 5)), { ...choice('target', 'Metropolis city if needed', s.buildings.filter(b => b.playerId === id && b.kind === 'city' && !v.metropolises.some(x => x.vertex === b.vertex)).map(b => b.vertex), 'vertex'), optional: true }];
    if (card.kind === 'engineering') c.fields = [choice('target', 'Unwalled city', s.buildings.filter(b => b.playerId === id && b.kind === 'city' && !v.walls.includes(b.vertex)).map(b => b.vertex), 'vertex')];
    if (card.kind === 'medicine') c.fields = [choice('target', 'Settlement', s.buildings.filter(b => b.playerId === id && b.kind === 'settlement').map(b => b.vertex), 'vertex'), choice('kind', 'Upgrade', s.settings.expansion === 'explorers' ? ['city', 'harbor'] : ['city'])];
    if (card.kind === 'invention') { const tiles = s.board.tiles.filter(t => t.number && ![2, 6, 8, 12].includes(t.number) && !v.attack?.barbarians.some(b => b.tile === t.id)).map(t => t.id); c.fields = [choice('first', 'First number', tiles, 'tile'), choice('second', 'Second number', tiles, 'tile')]; }
    if (card.kind === 'smithing') c.fields = [choice('first', 'Knight to promote', mine.filter(k => promotion(s, k)).map(k => k.id)), { ...choice('second', 'Second knight', mine.filter(k => promotion(s, k)).map(k => k.id)), optional: true }];
    if (card.kind === 'commercial-harbor') c.detail = 'For this turn, offer each opponent one resource for a commodity of their choice.';
    if (['guild-dues', 'espionage', 'treason'].includes(card.kind)) c.fields = [seats(s, 'opponent', 'Opponent', s.players.filter(o => o.id !== id && (card.kind !== 'guild-dues' || score(s, o) > score(s, p)) && (card.kind !== 'espionage' || extra(s, o.id).progress.length) && (card.kind !== 'treason' || allKnights(s).some(k => k.playerId === o.id))).map(o => o.id))];
    if (card.kind === 'intrigue' && v.attack) c.fields = [choice('target', 'Barbarian to capture', v.attack.barbarians.filter(b => b.count).map(b => b.tile), 'tile')];
    else if (card.kind === 'intrigue') c.fields = [choice('target', 'Opponent knight', v.knights.filter(k => k.playerId !== id && vertex(s, k.vertex)!.edges.some(e => route(s, e)?.playerId === id)).map(k => k.vertex), 'vertex')];
    if (card.kind === 'diplomacy') c.fields = [choice('target', 'Open route', s.routes.filter(r => openRoute(s, r.edge) && !v.rivers?.bridges.includes(r.edge)).map(r => r.edge), 'edge')];
    if (card.kind === 'taxation' && !v.explorers) c.fields = [choice('target', 'Robber hex', s.board.tiles.filter(t => !['sea', 'shoal', 'fog'].includes(t.terrain) && t.id !== s.robber).map(t => t.id), 'tile')];
    result.push(c);
  }
  if (act && x.harborUsed.includes('enabled')) for (const other of s.players.filter(o => o.id !== id && !x.harborUsed.includes(o.id))) result.push(command(`city:harbor:${other.id}`, 'Progress', `Commercial harbor: ${other.name}`, 'Offer one resource; they choose one commodity to return.', [resourceChoice()]));
  if (act && x.progress.length > 4) result.push(command('city:discard', 'Progress', 'Discard a progress card', 'Finish with at most four progress cards.', [choice('card', 'Card', x.progress.map(c => c.id))]));
  return result.filter(c => (!c.id.startsWith('city:improve:') || has(p.hand, cost({ [TRACK_GOOD[c.id.split(':')[2] as Track]]: x.improvements[c.id.split(':')[2] as Track] + 1 }))) && c.fields.every(f => f.optional || f.options.length) && (!c.cost || has(p.hand, c.cost)));
}
function openRoute(s: State, id: string) {
  const e = edge(s, id)!, r = route(s, id)!;
  return [e.a, e.b].some(at => !building(s, at) && !s.modules!.public.knights.some(k => k.vertex === at) && vertex(s, at)!.edges.filter(x => route(s, x)?.playerId === r.playerId).length === 1);
}
export function displace(s: State, k: Knight, now: number) {
  const sites = connectedVertices(s, k.playerId, k.vertex).filter(at => emptyIntersection(s, at));
  s.modules!.public.knights = s.modules!.public.knights.filter(x => x.id !== k.id);
  if (sites.length) queue(s, { playerId: k.playerId, kind: 'retreat', title: 'Choose where your displaced knight retreats', knight: k, command: command('', 'Choice', 'Retreat knight', 'Move along your own connected route.', [choice('target', 'Retreat', sites, 'vertex')]) }, now);
}
export function applyCity(s: State, id: string, a: ExpansionAction, now: number) {
  const m = s.modules!, v = m.public, x = extra(s, id), p = player(s, id), parts = a.command.split(':'), at = a.choices.target;
  if (parts[0] === 'knight') {
    if (parts[1] === 'recruit') { const k: Knight = { id: `k${++s.serial}`, playerId: id, vertex: at, strength: 1, active: false }; v.knights.push(k); m.knightTurns[k.id] = { activated: -1, promoted: -1 }; }
    else {
      const k = v.knights.find(k => k.id === parts[2] && k.playerId === id)!; need(k, 'Knight no longer available.');
      if (parts[1] === 'activate') { k.active = true; m.knightTurns[k.id].activated = p.turns; }
      if (parts[1] === 'promote') { k.strength = k.strength + 1 as Knight['strength']; m.knightTurns[k.id].promoted = p.turns; }
      if (parts[1] === 'move' || parts[1] === 'displace') { const other = v.knights.find(o => o.vertex === at); if (other) displace(s, other, now); k.vertex = at; k.active = false; }
      if (parts[1] === 'chase') { k.active = false; s.actorId = id; s.returnPhase = 'action'; s.interruptedAt = s.deadline === null ? null : now; phase(s, 'robber'); }
      if (parts[1] === 'road-chase') { k.active = false; moveBarbarianPrompt(s, id, now, true, [a.choices.from]); }
    }
    announce(s, id, `${parts[1]} knight`, at ?? null); return;
  }
  if (parts[0] === 'city') {
    if (parts[1] === 'wall') v.walls.push(at);
    if (parts[1] === 'improve') improve(s, id, parts[2] as Track, at, 0);
    if (parts[1] === 'discard') discardProgress(s, id, a.choices.card);
    if (parts[1] === 'harbor') { const other = parts[2], good = a.choices.resource as Good; need(p.hand[good], 'You need that resource.'); x.harborUsed.push(other); if (COMMODITIES.some(c => player(s, other).hand[c])) { transfer(p.hand, player(s, other).hand, cost({ [good]: 1 })); queue(s, { playerId: other, kind: 'harbor', from: id, title: 'Return one commodity for the offered resource' }, now); } }
    return;
  }
  const card = discardProgress(s, id, parts[1]), kind = card.kind;
  if (kind === 'alchemy') { m.alchemy = [Number(a.choices.red), Number(a.choices.yellow)]; }
  if (kind === 'crane') improve(s, id, a.choices.track as Track, at, 1);
  if (kind === 'engineering') { need(v.walls.filter(at => building(s, at)?.playerId === id).length < 3, 'All three walls are already built.'); v.walls.push(at); }
  if (kind === 'medicine') { const b = building(s, at)!; need(!m.pillaged.some(at => building(s, at)?.playerId === id) || m.pillaged.includes(at), 'Rebuild your pillaged city first.'); need(a.choices.kind !== 'harbor' || vertex(s, at)!.edges.some(e => edge(s, e)!.sea), 'Harbors need a coastal settlement.'); need(s.buildings.filter(x => x.playerId === id && x.kind === a.choices.kind).length < 4, 'All four pieces are already built.'); transfer(p.hand, s.bank, cost({ grain: 1, ore: a.choices.kind === 'harbor' ? 1 : 2 })); b.kind = a.choices.kind as 'city' | 'harbor'; m.pillaged = m.pillaged.filter(v => v !== at); if (b.kind === 'harbor') v.explorers!.harbors.push({ vertex: at, cargo: [] }); }
  if (kind === 'invention') { need(a.choices.first !== a.choices.second, 'Choose two different hexes.'); const t = s.board.tiles.find(t => t.id === a.choices.first)!, u = s.board.tiles.find(t => t.id === a.choices.second)!; [t.number, u.number] = [u.number, t.number]; }
  if (kind === 'irrigation' || kind === 'mining') { const r = kind === 'mining' ? 'ore' : 'grain'; take(s, id, r, adjacentTiles(s, id).filter(t => t.terrain === r).length * 2); }
  if (kind === 'road-building') p.freeRoutes += 2;
  if (kind === 'smithing') for (const kid of new Set([a.choices.first, a.choices.second].filter(Boolean))) { const k = allKnights(s).find(k => k.id === kid)!; need(promotion(s, k), 'That knight cannot be promoted.'); k.strength = k.strength + 1 as Knight['strength']; m.knightTurns[k.id].promoted = p.turns; }
  if (kind === 'resource-monopoly' || kind === 'trade-monopoly') for (const other of s.players.filter(o => o.id !== id)) { const good = a.choices.resource as Good; transfer(other.hand, p.hand, cost({ [good]: Math.min(other.hand[good] ?? 0, kind === 'trade-monopoly' ? 1 : 2) })); }
  if (kind === 'merchant') v.merchant = { tile: at, playerId: id };
  if (kind === 'merchant-fleet') x.fleet.push(a.choices.resource);
  if (kind === 'encouragement') for (const k of allKnights(s).filter(k => k.playerId === id && !k.active)) { k.active = true; m.knightTurns[k.id].activated = p.turns; }
  if (kind === 'commercial-harbor') { if (!x.harborUsed.includes('enabled')) x.harborUsed.push('enabled'); }
  if (kind === 'guild-dues') queue(s, { playerId: id, kind: 'guild', from: a.choices.opponent, title: 'Choose two cards from this opponent' }, now);
  if (kind === 'espionage') queue(s, { playerId: id, kind: 'spy', from: a.choices.opponent, title: 'Choose one of this opponent’s progress cards' }, now);
  if (kind === 'treason') queue(s, { playerId: a.choices.opponent, kind: 'treason', from: id, title: 'Treason: choose a knight to remove' }, now);
  if (kind === 'wedding' || kind === 'sabotage') for (const other of s.players.filter(o => o.id !== id && (kind === 'wedding' ? score(s, o) > score(s, p) : score(s, o) >= score(s, p)) && total(o.hand))) queue(s, { playerId: other.id, kind, from: id, count: kind === 'wedding' ? Math.min(2, total(other.hand)) : Math.floor(total(other.hand) / 2), title: kind === 'wedding' ? 'Wedding: give two cards to the celebrating player' : 'Sabotage: discard half your cards' }, now);
  if (kind === 'intrigue') { if (v.attack) { v.attack.barbarians.find(b => b.tile === at)!.count--; x.prisoners++; } else displace(s, v.knights.find(k => k.vertex === at)!, now); }
  if (kind === 'diplomacy') { const r = route(s, at)!; if (v.rivers?.edges.some(e => edge(s, e)!.tiles.some(t => edge(s, at)!.tiles.includes(t)))) { need(x.coins > 0, 'Removing this river road costs one gold.'); x.coins--; } if (r.playerId === id) { p.freeRoutes++; m.freeRouteKind[id] = r.kind; } s.routes = s.routes.filter(r => r.edge !== at); }
  if (kind === 'taxation') {
    if (v.explorers) { s.actorId = id; s.returnPhase = 'action'; s.interruptedAt = s.deadline === null ? null : now; phase(s, 'robber'); }
    else { need(v.attack || (v.barbarian?.attacks ?? 1) > 0, 'Wait until the first barbarian attack.'); if (!v.attack) s.robber = at; for (const victim of new Set(s.buildings.filter(b => b.playerId !== id && vertex(s, b.vertex)!.tiles.includes(at)).map(b => b.playerId))) steal(s, victim, id); }
  }
  event(s, 'card', `${p.name} played ${kind.replaceAll('-', ' ')}`, id, at ?? null);
}
