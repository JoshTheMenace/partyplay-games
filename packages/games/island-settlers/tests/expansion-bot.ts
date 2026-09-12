/** Deterministic QA decisions from phone-visible data; no server state access. */
import { chooseAction } from './bot';
import { COSTS, RESOURCES, emptyHand, type Action, type PrivateView, type PublicView } from '../src/model';
import { COMMODITIES, type ExpansionCommand, type Good } from '../src/expansion-model';
export function commandAction(pub: PublicView, c: ExpansionCommand): Action {
  const choices: Record<string, string> = {};
  for (const f of c.fields) {
    if (f.optional && f.key !== 'target') continue;
    const option = f.options.find(o => !Object.values(choices).includes(o.value)) ?? f.options[0];
    if (option) choices[f.key] = option.value;
  }
  const cards = emptyHand(); let count = c.cards?.min ?? 0;
  if (c.cards) for (const r of c.cards.allowed) { cards[r] = Math.min(count, c.cards.available[r] ?? 0); count -= cards[r]!; }
  return { type: 'expansion', command: c.id, choices, ...(c.cards ? { cards } : {}), turnId: pub.turnId };
}
export function chooseExpansionAction(pub: PublicView, own: PrivateView, id: string): Action | null {
  const commands = own.expansion?.commands ?? [], send = (a: object) => ({ ...a, turnId: pub.turnId }) as Action;
  if (pub.phase === 'choice') return commands[0] ? commandAction(pub, commands[0]) : null;
  if (pub.phase === 'setup' || own.canRoll || own.discardDue || own.goldDue || pub.phase === 'robber') return chooseAction(pub, own, id);
  if (own.expansion?.movement) {
    const expeditions = pub.expansions?.explorers;
    if (expeditions) {
      const load = commands.find(c => c.id.startsWith('exp:transfer:') && expeditions.ships.some(sh => c.id.endsWith(':' + sh.id))); if (load) return commandAction(pub, load);
      const settle = commands.find(c => c.id.startsWith('exp:settle:') && c.fields[0].options.some(o => pub.board.vertices.find(v => v.id === o.value)!.tiles.every(t => pub.board.tiles.find(x => x.id === t)!.island !== 0)));
      if (settle) return send({ type: 'expansion', command: settle.id, choices: { target: settle.fields[0].options.find(o => pub.board.vertices.find(v => v.id === o.value)!.tiles.every(t => pub.board.tiles.find(x => x.id === t)!.island !== 0))!.value } });
      const cargo = commands.find(c => /^exp:(deliver|crew|fish|retrieve):/.test(c.id)); if (cargo) return commandAction(pub, cargo);
      const fish = commands.find(c => c.id === 'exp:fish-roll'); if (fish) return commandAction(pub, fish);
      const sail = commands.find(c => c.id.startsWith('exp:move:'));
      if (sail) {
        const ship = expeditions.ships.find(sh => sail.id.endsWith(':' + sh.id))!, cargo = ship.cargo.map(c => c.kind), delivery = cargo.includes('fish') || cargo.includes('spice');
        const known = pub.board.tiles.filter(t => cargo.includes('crew') && (expeditions.spices.some(f => f.tile === t.id && !f.visitors.includes(id)) || expeditions.lairs.some(l => l.tile === t.id && !l.captured && l.crews.length < 3)));
        const goals = known.length ? known : pub.board.tiles.filter(t => t.terrain === 'fog'), vertices = new Map(pub.board.vertices.map(v => [v.id, v])), tiles = new Map(pub.board.tiles.map(t => [t.id, t]));
        const water = pub.board.edges.filter(e => e.sea && e.tiles.every(t => tiles.get(t)!.terrain !== 'fog')), adjacent = new Map<string, string[]>();
        for (const e of water) for (const at of [e.a, e.b]) adjacent.set(at, [...(adjacent.get(at) ?? []), e.id]);
        const targets = water.filter(e => [e.a, e.b].some(at => delivery ? expeditions.council.includes(at) : vertices.get(at)!.tiles.some(t => goals.some(g => g.id === t)))), distances = new Map(targets.map(e => [e.id, 0])), todo = [...targets], edges = new Map(water.map(e => [e.id, e]));
        for (const e of todo) for (const at of [...(adjacent.get(e.a) ?? []), ...(adjacent.get(e.b) ?? [])]) if (!distances.has(at)) { distances.set(at, distances.get(e.id)! + 1); todo.push(edges.get(at)!); }
        const target = [...sail.fields[0].options].sort((a, b) => (distances.get(a.value) ?? 9999) - (distances.get(b.value) ?? 9999))[0];
        if (target && distances.has(target.value)) return send({ type: 'expansion', command: sail.id, choices: { target: target.value } });
      }
    }
    const wagon = pub.expansions?.deliveries?.wagons.find(w => w.playerId === id), move = commands.find(c => c.id === 'wagon:move');
    if (wagon && move) {
      const wanted = wagon.cargo === 'marble' || wagon.cargo === 'glass' ? ['castle'] : wagon.cargo === 'tools' ? ['quarry'] : wagon.cargo === 'sand' ? ['glassworks'] : ['castle', 'quarry', 'glassworks'];
      const goals = pub.expansions!.deliveries!.depots.filter(d => wanted.includes(d.kind) && d.vertex !== wagon.vertex).map(d => d.vertex), distances = new Map(goals.map(at => [at, 0])), todo = [...goals];
      for (const at of todo) for (const e of pub.board.edges.filter(e => e.land && (e.a === at || e.b === at))) { const next = e.a === at ? e.b : e.a; if (!distances.has(next)) { distances.set(next, distances.get(at)! + 1); todo.push(next); } }
      const target = [...move.fields[0].options].sort((a, b) => (distances.get(a.value) ?? 999) - (distances.get(b.value) ?? 999))[0];
      if (target && (distances.get(target.value) ?? 999) < (distances.get(wagon.vertex) ?? 999)) return send({ type: 'expansion', command: move.id, choices: { target: target.value } });
    }
    return own.canEnd ? send({ type: 'end' }) : null;
  }
  if (!own.canAct) return null;
  const priority = commands.find(c => c.id.startsWith('city:improve:')) ?? commands.find(c => /^(knight|guard):activate:/.test(c.id)) ?? commands.find(c => c.id === 'knight:recruit' || c.id === 'guard:recruit') ?? commands.find(c => c.id === 'wagon:upgrade');
  if (priority) return commandAction(pub, priority);
  const safe = own.expansion?.progress.find(c => ['printing', 'constitution', 'irrigation', 'mining', 'resource-monopoly', 'trade-monopoly', 'encouragement', 'wedding', 'sabotage', 'commercial-harbor'].includes(c.kind));
  const progress = safe && commands.find(c => c.id === `progress:${safe.id}`); if (progress) return commandAction(pub, progress);
  const harbor = commands.find(c => c.id === 'exp:harbor'); if (harbor) return commandAction(pub, harbor);
  const ship = !pub.expansions?.explorers?.ships.some(sh => sh.playerId === id) && commands.find(c => c.id === 'exp:build'); if (ship) return commandAction(pub, ship);
  const cargo = (pub.buildings.filter(b => b.playerId === id && b.kind === 'harbor').length < 4 && commands.find(c => c.id === 'exp:buy:settler')) || commands.find(c => c.id === 'exp:buy:crew'); if (cargo) { const action = commandAction(pub, cargo); if (action.type === 'expansion') action.choices.container = cargo.fields[0].options.find(o => pub.expansions!.explorers!.ships.some(sh => sh.id === o.value))?.value ?? action.choices.container; return action; }
  const normal = chooseAction(pub, own, id); if (normal && normal.type !== 'end') return normal;
  const desired = COSTS.city, goods: Good[] = [...RESOURCES, ...COMMODITIES];
  for (const get of RESOURCES.filter(r => own.bank[r] && own.hand[r] < desired[r])) {
    const give = goods.find(r => r !== get && (own.hand[r] ?? 0) - (desired[r] ?? 0) >= (own.rates[r] ?? 4));
    if (give) return send({ type: 'bank', give, get });
    const gold = commands.find(c => c.id === 'gold:buy'); if (gold) return send({ type: 'expansion', command: gold.id, choices: { resource: get } });
  }
  return normal;
}
