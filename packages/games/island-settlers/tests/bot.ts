/** QA player: chooses using only the same public/private views available to its phone. */
import { COSTS, RESOURCES, emptyHand, type Action, type Hand, type PrivateView, type PublicView } from '../src/model';
import { COMMODITIES } from '../src/expansion-model';
export function chooseAction(pub: PublicView, own: PrivateView, id: string): Action | null {
  const send = (action: object) => ({ ...action, turnId: pub.turnId }) as Action;
  const take = (count: number, stock: Hand, commodities = false) => { const cards = emptyHand(); for (const r of [...RESOURCES, ...(commodities ? COMMODITIES : [])].sort((a, b) => (stock[b] ?? 0) - (stock[a] ?? 0))) { cards[r] = Math.min(count, stock[r] ?? 0); count -= cards[r]!; } return cards; };
  const yieldAt = (vertexId: string) => pub.board.vertices.find(v => v.id === vertexId)!.tiles.reduce((n, id) => { const t = pub.board.tiles.find(t => t.id === id)!; return n + (t.number ? (6 - Math.abs(t.number - 7)) * (t.terrain === 'ore' || t.terrain === 'grain' ? 1.3 : 1) : 0); }, 0);
  if (own.discardDue) return send({ type: 'discard', cards: take(own.discardDue, own.hand, true) });
  if (own.goldDue) return send({ type: 'gold', cards: take(own.goldDue, own.bank) });
  if (pub.phase === 'robber' && pub.actorId === id) {
    const targets = [...own.legal.robber, ...own.legal.pirate].map(target => ({ target, victims: own.legal.victims[target] ?? [] }));
    const pick = targets.find(t => t.victims.length) ?? targets[0]; return pick ? send({ type: 'robber', target: pick.target, victim: pick.victims[0] ?? null, pirate: own.legal.pirate.includes(pick.target) }) : null;
  }
  if (own.canRoll) return send({ type: 'roll' });
  if (pub.phase === 'setup' && pub.actorId === id) {
    if (own.legal.settlements.length) return send({ type: 'build', kind: 'settlement', target: [...own.legal.settlements].sort((a, b) => yieldAt(b) - yieldAt(a))[0] });
    return send({ type: 'build', kind: own.legal.roads.length ? 'road' : 'ship', target: own.legal.roads[0] ?? own.legal.ships[0] });
  }
  if (!own.canAct) return null;
  if (own.legal.cities.length) return send({ type: 'build', kind: 'city', target: [...own.legal.cities].sort((a, b) => yieldAt(b) - yieldAt(a))[0] });
  if (own.legal.settlements.length) return send({ type: 'build', kind: 'settlement', target: [...own.legal.settlements].sort((a, b) => yieldAt(b) - yieldAt(a))[0] });
  const knight = own.development.find(c => c.playable && c.kind === 'knight');
  if (knight) return send({ type: 'play-development', cardId: knight.id });
  const roads = own.legal.roads;
  if (roads.length) {
    const spots = pub.board.vertices.filter(v => v.tiles.some(id => pub.board.tiles.some(t => t.id === id && t.terrain !== 'sea')) && !pub.buildings.some(b => b.vertex === v.id) && v.edges.every(id => { const e = pub.board.edges.find(e => e.id === id)!; return !pub.buildings.some(b => b.vertex === (e.a === v.id ? e.b : e.a)); }));
    const distance = (edgeId: string) => { const e = pub.board.edges.find(e => e.id === edgeId)!, a = pub.board.vertices.find(v => v.id === e.a)!, b = pub.board.vertices.find(v => v.id === e.b)!; return Math.min(...spots.map(v => Math.min(Math.hypot(v.x - a.x, v.y - a.y), Math.hypot(v.x - b.x, v.y - b.y)) - yieldAt(v.id) / 100)); };
    return send({ type: 'build', kind: 'road', target: [...roads].sort((a, b) => distance(a) - distance(b))[0] });
  }
  if (pub.deckCount && RESOURCES.every(r => own.hand[r] >= COSTS.development[r])) return send({ type: 'buy-development' });
  const me = pub.players.find(p => p.id === id)!;
  const desired = me.pieces.cities > 0 && pub.buildings.some(b => b.playerId === id && b.kind === 'settlement') ? COSTS.city : me.pieces.settlements > 0 ? COSTS.settlement : COSTS.development;
  for (const get of RESOURCES.filter(r => own.bank[r] > 0 && own.hand[r] < desired[r])) {
    const give = [...RESOURCES].sort((a, b) => own.hand[b] - own.hand[a]).find(r => r !== get && own.hand[r] - desired[r] >= own.rates[r]);
    if (give) return send({ type: 'bank', give, get });
  }
  return send({ type: 'end' });
}
