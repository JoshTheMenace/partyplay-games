/**
 * Expelling the barbarians (end of each turn), coastal hexes clockwise: guards win a hex when their
 * strength beats its invaders. The invaders become prisoners of the involved seats (1 each; a spare
 * one to the strongest, a tie decided by dice with 3 gold to the tied loser; too few: dice order and
 * 3 gold for the empty-handed). The hex is liberated, then a die picks one edge orientation: guards
 * on it are lost (C&K: stepped down) for 3 gold each.
 */
import type { SeatId, TileId, Unit } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { emit } from '../../events';
import { face } from '../../legal';
import { int, shuffle } from '../../rng';
import { random, seatName, type State } from '../../state';
import { addGold } from '../deliveries/gold';
import { ba, facts, invaders, setInvaders } from './coast';
import { around, demote, guards, power } from './guards';

/** Prisoners per seat for one victory; seats in `dice` order break ties. */
function share(s: State, count: number, by: Map<SeatId, number>, dice: SeatId[]): Map<SeatId, number> {
  const got = new Map<SeatId, number>();
  if (dice.length === 1) return got.set(dice[0], count);
  if (count < dice.length) { for (const id of dice.slice(0, count)) got.set(id, 1); return got; }
  for (const id of dice) got.set(id, 1);
  if (count > dice.length) {
    const top = Math.max(...by.values()), tied = dice.filter(id => by.get(id) === top);
    got.set(tied[0], 2);
    for (const id of tied.slice(1)) addGold(s, id, 3);
  }
  return got;
}

function battle(s: State, tile: TileId) {
  const b = invaders(s, tile), fighters = around(s, guards(s), tile).filter(g => power(s, g) > 0);
  const defense = fighters.reduce((n, g) => n + power(s, g), 0);
  if (!b || defense <= b) return;
  const rnd = random(s, 'cards'), by = new Map<SeatId, number>();
  for (const g of fighters) by.set(g.seat!, (by.get(g.seat!) ?? 0) + power(s, g));
  const dice = shuffle([...by.keys()], rnd), got = share(s, b, by, dice);
  for (const id of dice) {
    const n = got.get(id) ?? 0;
    if (n) ba(s).prisoners[id] += n; else addGold(s, id, 3);
  }
  setInvaders(s, tile, 0);
  const edges = boardIndex(s.board).tileEdges.get(tile)!, side = int(rnd, 3), lost: Unit[] = [];
  for (const g of fighters) if (edges.indexOf(g.at) % 3 === side) lost.push(g);
  for (const g of lost) { demote(s, g); addGold(s, g.seat!, 3); }
  const names = dice.map(id => seatName(s, id)).join(', '), losers = [...new Set(lost.map(g => g.seat!))];
  const text = `${names} drove ${b} barbarian${b > 1 ? 's' : ''} off the ${face(s, tile).number}`;
  emit(s, { kind: 'barbarians', strength: b, defense, result: 'defended', defenders: dice, losers, text });
}

export const expel = (s: State) => { for (const t of facts(s).coast) battle(s, t); };
