/**
 * Guards (Barbarian Attack knights): `guard` units on home-island edges. After building, a seat may
 * move each guard up to 3 edges (5 for 1 grain or 2 fish; with C&K active knights 5, and moving deactivates).
 * Guards ignore everything while moving, never end on a castle edge or another guard, and a guard on
 * a castle edge must leave it this turn (moved automatically at the end of the turn otherwise).
 */
import type { Command, EdgeId, SeatId, TileId, Unit } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { transfer } from '../../cards';
import { choice, command, pickField } from '../../commands';
import { emit } from '../../events';
import { need } from '../../need';
import { placeUnit, removeUnit, updateUnit } from '../../pieces';
import { nextId, seatName, type State } from '../../state';
import { mayMove } from '../deliveries/gold';
import { fishTotal, payFish } from '../fishing';
import type { Answer, PromptSpec } from '../registry';
import { ba, ck, facts, invaders, stake } from './coast';

export const guards = (s: State, seat?: SeatId) => Object.values(s.pieces.units)
  .filter(u => u.kind === 'guard' && (!seat || u.seat === seat));

/** Battle strength: one per guard; with C&K the active knight's level. */
export const power = (s: State, g: Unit) => (ck(s) ? (g.active ? g.level : 0) : 1);

/** Guards on the sides of `tile` (from `list`, so plans can use moved copies). */
export const around = (s: State, list: Unit[], tile: TileId) => {
  const edges = boardIndex(s.board).tileEdges.get(tile) ?? [];
  return list.filter(g => edges.includes(g.at));
};

export const moveLimit = (s: State, g: Unit) => (ck(s) && g.active ? 5 : 3);

/** Edges within `limit` steps of `from` along the home island, with their distance. */
export function reach(s: State, from: EdgeId, limit: number): Map<EdgeId, number> {
  const ix = boardIndex(s.board), walk = facts(s).walk, dist = new Map([[from, 0]]), todo = [from];
  for (const e of todo) {
    const d = dist.get(e)!, edge = ix.edge.get(e)!;
    if (d >= limit) continue;
    for (const v of [edge.a, edge.b]) for (const n of ix.vertex.get(v)!.edges) {
      if (walk.has(n) && !dist.has(n)) { dist.set(n, d + 1); todo.push(n); }
    }
  }
  return dist;
}

/** Where a guard may end its move: in reach, off the castle, not on another guard. */
export function destinations(s: State, g: Unit, limit: number, list = guards(s)): EdgeId[] {
  const castle = new Set(facts(s).castleEdges), taken = new Set(list.map(x => x.at));
  return [...reach(s, g.at, limit).keys()].filter(e => !castle.has(e) && !taken.has(e));
}

/** Value of guard `g` standing on `e` for this turn's battles (10+ when it tips one). */
function worth(s: State, list: Unit[], g: Unit, e: EdgeId, strength: number): number {
  let v = 0;
  for (const t of boardIndex(s.board).edge.get(e)!.tiles) {
    const b = invaders(s, t), others = around(s, list, t).filter(x => x.id !== g.id);
    if (!b) continue;
    const k = others.reduce((n, x) => n + power(s, x), 0), mine = stake(s, g.seat!, t);
    const joins = !others.some(x => x.seat === g.seat);
    if (!strength) v += b + mine + (b >= 3 ? 3 : 0);
    else if (k <= b && k + strength > b) v += 10 * b + (b >= 3 ? 10 : 0) + 3 * mine;
    else if (k > b) v += joins ? 4 : 0.5;
    else v += 2 * strength + b + mine;
  }
  return v;
}

export type Move = { guard: string; to: EdgeId; win: boolean };

/** Greedy march: castle guards first, each to the edge that helps this turn's battles most. */
export function plan(s: State, seat: SeatId, only?: string[]): Move[] {
  const castle = new Set(facts(s).castleEdges), moved = new Set(ba(s).moved);
  const list = guards(s).map(g => ({ ...g })), out: Move[] = [];
  const keep = (g: Unit) => ck(s) && g.active && !castle.has(g.at); // moving would deactivate it
  const free = (g: Unit) => !moved.has(g.id) && !keep(g) && (only ?? [g.id]).includes(g.id);
  const mine = list.filter(g => g.seat === seat && free(g))
    .sort((a, b) => Number(castle.has(b.at)) - Number(castle.has(a.at)));
  for (const g of mine) {
    const forced = castle.has(g.at), after = ck(s) ? 0 : 1;
    let best: EdgeId | null = null, value = forced ? -Infinity : worth(s, list, g, g.at, power(s, g)) + 0.01;
    for (const e of destinations(s, g, moveLimit(s, g), list)) {
      const v = worth(s, list, g, e, after);
      if (v > value) { best = e; value = v; }
    }
    if (!best) continue;
    out.push({ guard: g.id, to: best, win: value >= 10 && after > 0 });
    Object.assign(g, { at: best, active: ck(s) ? false : g.active });
  }
  return out;
}

export function moveGuard(s: State, seat: SeatId, id: string, to: EdgeId) {
  const g = s.pieces.units[id];
  need(g?.kind === 'guard' && g.seat === seat && !ba(s).moved.includes(id), 'That guard cannot move.');
  const from = g.at, text = `${seatName(s, seat)} moved a guard`;
  updateUnit(s, id, { at: to, active: ck(s) ? false : g.active });
  ba(s).moved.push(id);
  s.seats[seat].moved = true;
  emit(s, { kind: 'move', seat, piece: 'guard', unit: id, from, to, text });
}

export const march = (s: State, seat: SeatId, only?: string[]) => {
  for (const m of plan(s, seat, only)) moveGuard(s, seat, m.guard, m.to);
};

export function placeGuard(s: State, seat: SeatId, at: EdgeId, active: boolean) {
  placeUnit(s, { id: nextId(s, 'g'), kind: 'guard', seat, at, level: 1, active, cargo: [] });
  const text = `${seatName(s, seat)} placed a guard`;
  emit(s, { kind: 'build', seat, piece: 'guard', spot: at, free: true, text });
}

/** C&K: at most two knights of each level per seat. */
export const levelCount = (s: State, seat: SeatId, level: number, skip?: string) =>
  guards(s, seat).filter(g => g.level === level && g.id !== skip).length;
export const guardsLeft = (s: State, seat: SeatId) => 6 - guards(s, seat).length;

/** Knight loss after a victory: removed, or with C&K stepped down a level when that level has room. */
export function demote(s: State, g: Unit) {
  const room = (l: number) => l > 0 && levelCount(s, g.seat!, l, g.id) < 2;
  const lower = ck(s) ? [g.level - 1, g.level - 2].find(room) : 0;
  if (lower) updateUnit(s, g.id, { level: lower }); else removeUnit(s, g.id);
}

const unmoved = (s: State, seat: SeatId) => guards(s, seat).filter(g => !ba(s).moved.includes(g.id));

export function guardCommands(s: State, seat: SeatId): Command[] {
  if (!mayMove(s, seat)) return [];
  const ready = unmoved(s, seat).filter(g => destinations(s, g, ck(s) ? moveLimit(s, g) : 5).length);
  if (!ready.length) return [];
  const moves = plan(s, seat), castle = new Set(facts(s).castleEdges);
  const forced = ready.some(g => castle.has(g.at)), win = moves.some(m => m.win);
  const base = { module: 'barbarian-attack' as const, group: 'barbarians' as const };
  const out = [command({
    ...base, id: 'ba-move', label: 'Move a guard', hint: 0.2, detail: 'Pick a guard, then its new edge.',
    fields: [pickField('guard', 'Guard', ready.map(g => choice(g.id, `Guard ${g.level}`)), 'unit')],
  })];
  if (moves.length) {
    const detail = forced ? 'Castle guards must head out this turn.' : win ? 'Your guards can win a battle.'
      : 'Moves every guard toward the invaders.';
    out.unshift(command({
      ...base, id: 'ba-march', label: 'March guards to the coast', detail, hint: forced || win ? 0.9 : 0.5,
    }));
  }
  return out;
}

/** Ways to pay for a long move: 1 grain, or 2 fish (official Fishing combination). */
const payments = (s: State, seat: SeatId) => [
  ...(s.seats[seat].hand.grain > 0 ? [choice('grain', '1 grain')] : []),
  ...(s.modules.includes('fishing') && fishTotal(s, seat) >= FAR_FISH ? [choice('fish', `${FAR_FISH} fish`)] : []),
];
const FAR_FISH = 2;

/** `move` prompt: the chosen guard's destinations (4–5 edges cost 1 grain or 2 fish without C&K). */
export const movePrompt: PromptSpec = {
  timer: 'prompt', autoText: 'Keeps the guard where it is', label: 'Moving a guard',
  command(s, p) {
    const g = s.pieces.units[String(p.data)], pay = ck(s) ? [] : payments(s, p.seat), far = pay.length ? 5 : 0;
    const near = g ? reach(s, g.at, moveLimit(s, g)) : new Map<EdgeId, number>();
    const all = g ? destinations(s, g, Math.max(moveLimit(s, g), far)) : [];
    const how = pay.length > 1 ? [pickField('pay', 'Pay with', pay)] : [];
    const cost = pay.map(c => c.label).join(' or ');
    const options = all.map(e => (near.has(e) ? choice(e, 'Edge') : choice(e, `Edge (${cost})`, '', how)));
    return command({
      id: p.id, module: 'barbarian-attack', group: 'barbarians', label: 'Move the guard', hint: 0.2,
      detail: 'Pick its new edge, or stay.',
      fields: [pickField('edge', 'New edge', [choice('stay', 'Stay'), ...options], 'edge')],
    });
  },
  apply(s, p, a: Answer) {
    const g = s.pieces.units[String(p.data)], to = a.picks.edge;
    if (!g || to === 'stay') return;
    if (!reach(s, g.at, moveLimit(s, g)).has(to)) {
      if ((a.picks.pay ?? payments(s, p.seat)[0].value) === 'fish') payFish(s, p.seat, FAR_FISH);
      else transfer(s.seats[p.seat].hand, s.bank, { grain: 1 }, 'Moving that far costs 1 grain.');
    }
    moveGuard(s, p.seat, g.id, to);
  },
  auto: () => ({ picks: { edge: 'stay' }, cards: {} }),
};
