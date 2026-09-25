/**
 * What the production strip says (EXPERIENCE §3.8), derived from the view alone so a reload or a
 * late joiner reads the same payout: the last roll, then what happened after it (discards, robber).
 */
import { GOODS, type Good, type PublicView, type RollEvent, type SeatId } from '../../../model';
import { tileLabel } from '../../shared/board';
import { GOOD_META } from '../../shared/labels';

/** Note text and seat mentions (drawn as emblem + name); '·' separates clauses. */
export type Part = string | { seat: SeatId };
export type StripChip =
  | { kind: 'gain'; seat: SeatId; cards: Good[]; total: number }
  | { kind: 'blocked'; seat: SeatId; goods: Good[] };
export type StripModel = {
  roll: RollEvent; tone: 'hot' | 'seven' | 'plain'; chips: StripChip[]; notes: Part[];
};

/** Most card icons fanned in one chip; the "+n" total always shows the full count. */
const FAN = 3;

const bySeat = <T extends { seat: SeatId }>(pub: PublicView, list: T[]) =>
  pub.seats.map(s => [s.id, list.filter(x => x.seat === s.id)] as const).filter(([, xs]) => xs.length);

const goodsOrder = (goods: Good[]) => [...new Set(goods)].sort((a, b) => GOODS.indexOf(a) - GOODS.indexOf(b));

export const rollTone = (total: number) =>
  (total === 7 ? 'seven' : total === 6 || total === 8 ? 'hot' : 'plain');

/** The seven's follow-up: who still discards, who moves the robber, where it went. */
function sevenNotes(pub: PublicView, roll: RollEvent): Part[] {
  const moved = pub.events.find(e => e.id > roll.id && e.kind === 'robber');
  if (moved?.kind === 'robber') {
    const where = `${moved.piece === 'pirate' ? 'Pirate' : 'Robber'} moved to ${tileLabel(pub, moved.tile)}`;
    return [where, '·', ...(moved.victim ? [{ seat: moved.victim }, 'robbed'] : ['nobody robbed'])];
  }
  const discarding = pub.prompts.filter(p => p.kind === 'discard');
  if (discarding.length) {
    return ['Discarding', ...discarding.flatMap((p): Part[] => [{ seat: p.seat }, `${p.count ?? ''}`])];
  }
  const mover = pub.robberChoices[0]?.seat ?? roll.seat;
  return mover ? [{ seat: mover }, 'moves the robber'] : ['The robber moves'];
}

export function stripModel(pub: PublicView): StripModel | null {
  const roll = pub.lastRoll;
  if (!roll) return null;
  const tone = rollTone(roll.total);
  if (roll.total === 7) return { roll, tone, chips: [], notes: sevenNotes(pub, roll) };
  const gains = bySeat(pub, roll.grants).map(([seat, grants]): StripChip => {
    const cards = [...grants].sort((x, y) => GOODS.indexOf(x.good) - GOODS.indexOf(y.good))
      .flatMap(g => Array<Good>(g.amount).fill(g.good));
    return { kind: 'gain', seat, cards: cards.slice(0, FAN), total: cards.length };
  });
  const blocked = bySeat(pub, roll.blocked)
    .map(([seat, list]): StripChip => ({ kind: 'blocked', seat, goods: goodsOrder(list.map(b => b.good)) }));
  const short = roll.shortages.map(g => GOOD_META[g].label.toLowerCase()).join(', ');
  const notes: Part[] = [...(gains.length ? [] : ['Nobody produced']),
    ...(short ? [...(gains.length ? [] : ['·']), `Bank short: no ${short} paid`] : [])];
  return { roll, tone, chips: [...gains, ...blocked], notes };
}
