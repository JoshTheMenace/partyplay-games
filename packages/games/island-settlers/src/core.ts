import type { Player, State } from './state';
import { RESOURCES, type GameEvent, type Hand, type Phase, type Route } from './model';
import { COMMODITIES } from './expansion-model';
import { expansionScore } from './expansion-score';
export const GOODS = [...RESOURCES, ...COMMODITIES];

export const total = (hand: Hand) => GOODS.reduce((n, r) => n + (hand[r] ?? 0), 0);
export const has = (hand: Hand, cost: Hand) => GOODS.every(r => (hand[r] ?? 0) >= (cost[r] ?? 0));
export function need(condition: unknown, reason: string): asserts condition { if (!condition) throw new Error(reason); }
export const player = (s: State, id: string) => { const p = s.players.find(p => p.id === id); need(p, 'This seat is not in the game.'); return p; };
export const vertex = (s: State, id: string) => s.board.vertices.find(v => v.id === id);
export const edge = (s: State, id: string) => s.board.edges.find(e => e.id === id);
export const building = (s: State, id: string) => s.buildings.find(b => b.vertex === id);
export const route = (s: State, id: string) => s.routes.find(r => r.edge === id);
export const paused = (s: State) => s.players.some(p => !p.connected);
export function random(s: State) { let x = s.random | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s.random = x >>> 0; return s.random / 4294967296; }
export function transfer(from: Hand, to: Hand, cards: Hand) { need(has(from, cards), 'Those resources are no longer available.'); for (const r of GOODS) if (cards[r]) { from[r] = (from[r] ?? 0) - cards[r]!; to[r] = (to[r] ?? 0) + cards[r]!; } }
export function event(s: State, kind: GameEvent['kind'], text: string, playerId: string | null = null, target: string | null = null) { s.events.push({ id: ++s.serial, kind, text, playerId, target }); s.events = s.events.slice(-24); }
export function phase(s: State, value: Phase) { s.phase = value; s.turnId++; }
export function acting(s: State, p: Player) { return s.phase === 'action' && !s.modules?.players[p.id].movement && !s.readyIds.includes(p.id) && (s.settings.mode === 'connect' || s.actorId === p.id); }
export function preRoutes(s: State, p: Player) { return s.phase === 'roll' && s.actorId === p.id && p.freeRoutes > 0; }
export function domestic(s: State, p: Player) { return s.phase === 'action' && !s.modules?.players[p.id].movement && !s.readyIds.includes(p.id) && (s.settings.mode === 'connect' || !s.secondary); }
export function pieceCount(s: State, p: Player) {
  return { roads: 15 - s.routes.filter(r => r.playerId === p.id && r.kind === 'road' && !s.modules?.public.rivers?.bridges.includes(r.edge)).length, ships: s.modules?.public.explorers ? 3 - s.modules.public.explorers.ships.filter(sh => sh.playerId === p.id).length : 15 - s.routes.filter(r => r.playerId === p.id && r.kind === 'ship').length, settlements: Math.max(0, 5 - s.buildings.filter(b => b.playerId === p.id && b.kind === 'settlement').length), cities: 4 - s.buildings.filter(b => b.playerId === p.id && b.kind === 'city').length };
}
export function score(s: State, p: Player, hidden = false) {
  return s.buildings.filter(b => b.playerId === p.id).reduce((n, b) => n + (b.kind === 'settlement' ? 1 : 2), 0) + p.islands.length * 2 + (s.longestOwner === p.id ? 2 : 0) + (s.armyOwner === p.id ? 2 : 0) + expansionScore(s, p.id) + (hidden ? p.development.filter(c => c.kind === 'victory').length : 0);
}
export function longestRoute(s: State, id: string) {
  const owned = s.routes.filter(r => r.playerId === id), adjacency = new Map<string, { to: string; bit: bigint; weight: number; kind: Route['kind'] }[]>();
  owned.forEach((r, i) => { const e = edge(s, r.edge)!; for (const [a, b] of [[e.a, e.b], [e.b, e.a]]) adjacency.set(a, [...(adjacency.get(a) ?? []), { to: b, bit: 1n << BigInt(i), weight: s.modules?.public.caravans?.segments.some(c => c.edge === r.edge) ? 2 : 1, kind: r.kind }]); });
  function walk(v: string, used: bigint, previous: Route['kind'] | null): number {
    const b = building(s, v), k = s.modules?.public.knights.find(k => k.vertex === v);
    if (used && (b && b.playerId !== id || k && k.playerId !== id)) return 0;
    let best = 0;
    for (const step of adjacency.get(v) ?? []) if (!(used & step.bit) && (!previous || previous === step.kind || b?.playerId === id)) best = Math.max(best, step.weight + walk(step.to, used | step.bit, step.kind));
    return best;
  }
  return Math.max(0, ...[...adjacency.keys()].map(v => walk(v, 0n, null)));
}
export function awards(s: State) {
  for (const p of s.players) p.longestRoute = longestRoute(s, p.id);
  function owner(field: 'longestRoute' | 'knights', threshold: number, incumbent: string | null) {
    const max = Math.max(...s.players.map(p => p[field]));
    if (max < threshold) return null;
    const tied = s.players.filter(p => p[field] === max);
    return tied.some(p => p.id === incumbent) ? incumbent : tied.length === 1 ? tied[0].id : null;
  }
  s.longestOwner = owner('longestRoute', 5, s.longestOwner); s.armyOwner = s.settings.citiesKnights || s.settings.expansion === 'explorers' || s.modules?.public.attack ? null : owner('knights', 3, s.armyOwner);
  if (s.settings.expansion === 'explorers' || s.modules?.public.deliveries) s.longestOwner = null;
}
export function finishIfWon(s: State, roundEnd = false) {
  if (s.phase === 'setup' || s.phase === 'choice' || s.settings.mode === 'connect' && !roundEnd) return false;
  const candidates = s.players.filter(p => (s.settings.mode === 'connect' || p.id === s.actorId) && score(s, p, true) >= s.settings.targetPoints + (s.modules?.public.fishing?.bootOwner === p.id ? 1 : 0));
  if (!candidates.length) return false;
  const high = Math.max(...candidates.map(p => score(s, p, true)));
  s.winners = candidates.filter(p => score(s, p, true) === high).map(p => p.id); s.deadline = null; s.offers = []; phase(s, 'ended'); return true;
}
