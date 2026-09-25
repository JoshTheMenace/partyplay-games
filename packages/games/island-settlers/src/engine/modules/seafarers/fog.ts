/**
 * Fog Islands discovery (Seafarers 2025, scenario 3): a road or ship placed so that one of its
 * corners touches a fog hex turns that hex face up. Land pays 1 card of its resource (bank
 * permitting); gold pays 1 resource of choice through a `gold` prompt; sea pays nothing.
 */
import { RESOURCES, type EdgeId, type Grant, type Resource, type SeatId } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { cardsText, transfer } from '../../cards';
import { emit } from '../../events';
import { openPrompt } from '../../prompts';
import { reveal } from '../../pieces';
import { gained } from '../../stats';
import { seatName, type State } from '../../state';

/** Fog hexes still face down that touch a corner of `edge`. */
export function fogAt(s: State, edge: EdgeId): string[] {
  const ix = boardIndex(s.board), e = ix.edge.get(edge);
  const tiles = e ? [e.a, e.b].flatMap(v => ix.vertex.get(v)?.tiles ?? []) : [];
  return [...new Set(tiles)].filter(t => s.hidden[t] && !s.pieces.reveals[t]);
}

/** Gold owed outside a roll: add to an open gold prompt, else open one (table scope during setup). */
function owe(s: State, seat: SeatId, count: number) {
  const open = Object.values(s.prompts).find(p => p.seat === seat && p.kind === 'gold');
  const data = open?.data as { count: number } | undefined;
  const scope = s.turn.stage === 'setup' ? 'table' : 'self';
  if (data) data.count += count;
  else openPrompt(s, { seat, kind: 'gold', scope, data: { count } });
}

export function discover(s: State, seat: SeatId, edge: EdgeId) {
  const grants: Grant[] = [];
  let gold = 0;
  for (const tile of fogAt(s, edge)) {
    const face = { ...s.hidden[tile] }, good = face.terrain as Resource;
    reveal(s, tile, face);
    const text = `${seatName(s, seat)} found ${face.terrain}`;
    emit(s, { kind: 'reveal', seat, tile, terrain: face.terrain, text });
    if (face.terrain === 'gold') gold++;
    else if (RESOURCES.includes(good) && s.bank[good] > 0) {
      transfer(s.bank, s.seats[seat].hand, { [good]: 1 });
      grants.push({ seat, tile, good, amount: 1 });
    }
  }
  if (grants.length) {
    const cards: Record<string, number> = {};
    for (const g of grants) cards[g.good] = (cards[g.good] ?? 0) + 1;
    gained(s, seat, cards);
    emit(s, { kind: 'payout', seat, grants, text: `${seatName(s, seat)} discovered ${cardsText(cards)}` });
  }
  if (gold) owe(s, seat, gold);
}
