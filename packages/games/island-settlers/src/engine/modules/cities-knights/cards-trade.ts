/** Trade progress cards. Forced gifts and hand peeks open prompts (see play.ts). */
import { pips } from '../../../geometry';
import {
  COMMODITIES, GOODS, RESOURCES, type Good, type Resource, type SeatId,
} from '../../../model';
import { boardIndex } from '../../board/lookup';
import { resourceTotal, total, transfer } from '../../cards';
import { choice, pickField } from '../../commands';
import { emit, inbox } from '../../events';
import { role } from '../../flow';
import { face, isLandTile, why } from '../../legal';
import { setMerchant } from '../../pieces';
import { openPrompt } from '../../prompts';
import { publicVp } from '../../stats';
import { seatName, type State } from '../../state';
import type { Play } from './play';
import { note, sx } from './state';

/** Each other seat hands over up to `each` of `good` (Resource / Trade Monopoly). */
function monopoly(s: State, seat: SeatId, good: Good, each: number) {
  let n = 0;
  for (const id of s.order.filter(id => id !== seat)) {
    const k = Math.min(each, s.seats[id].hand[good]);
    if (!k) continue;
    transfer(s.seats[id].hand, s.seats[seat].hand, { [good]: k });
    inbox(s, id, { text: `${seatName(s, seat)} took ${k} ${good}`, cards: { [good]: k }, tone: 'loss', other: seat });
    n += k;
  }
  emit(s, { kind: 'take', seat, cards: n ? { [good]: n } : {}, text: `${seatName(s, seat)} collected ${n} ${good}` });
}

const goods = (list: readonly Good[]) => list.map(g => choice(g, g));

/** Resource hexes next to the seat's buildings (the Merchant may stand there; never gold). */
function merchantHexes(s: State, seat: SeatId) {
  const ix = boardIndex(s.board);
  return s.board.tiles.map(t => t.id).filter(t => RESOURCES.includes(face(s, t).terrain as Resource)
    && isLandTile(s, t) && t !== s.pieces.merchant?.tile
    && (ix.tileVertices.get(t) ?? []).some(v => s.pieces.buildings[v]?.seat === seat))
    .sort((a, b) => pips(face(s, b).number) - pips(face(s, a).number));
}

export const richer = (s: State, seat: SeatId, orEqual = false) => s.order.filter(id => id !== seat
  && (orEqual ? publicVp(s, id) >= publicVp(s, seat) : publicVp(s, id) > publicVp(s, seat)));

export const TRADE: Play[] = [
  { kind: 'commercial-harbor', text: 'This turn, offer each player 1 resource for 1 commodity of their choice.',
    hint: (s, seat) => (resourceTotal(s.seats[seat].hand) ? 0.55 : 0.05),
    fields: (s, seat) => (role(s, seat) === 'paired' ? why('rule', 'Build turns trade with the bank only') : []),
    apply(s, seat) { sx(s, seat).harbor = []; } },
  { kind: 'master-merchant', text: 'Look at the hand of a player with more points and take 2 cards.', hint: () => 0.8,
    fields(s, seat) {
      const list = richer(s, seat).filter(id => total(s.seats[id].hand));
      if (!list.length) return why('rule', 'Nobody with more points has cards');
      return [pickField('seat', 'Player', list.map(id => choice(id, seatName(s, id))), 'seat')];
    },
    apply(s, seat, a) {
      openPrompt(s, { seat, kind: 'cities-knights/take', scope: 'self', data: { from: a.picks.seat } });
    } },
  { kind: 'merchant', text: 'Place the merchant next to your building: its resource trades 2:1 (+1 point).',
    hint: () => 0.8,
    fields(s, seat) {
      const tiles = merchantHexes(s, seat);
      if (!tiles.length) return why('no-spot', 'No resource hex next to your buildings');
      const hex = (t: string) => choice(t, `${face(s, t).terrain} ${face(s, t).number}`);
      return [pickField('tile', 'Hex', tiles.map(hex), 'tile')];
    },
    apply(s, seat, a) {
      setMerchant(s, { tile: a.picks.tile, seat });
      note(s, 'merchant', seat, a.picks.tile, `${seatName(s, seat)} placed the merchant`);
    } },
  { kind: 'merchant-fleet', text: 'This turn, trade one good of your choice 2:1 with the bank.', hint: () => 0.35,
    fields: () => [pickField('good', 'Good', goods(GOODS), 'good')],
    apply(s, seat, a) { sx(s, seat).fleet.push(a.picks.good as Good); } },
  { kind: 'resource-monopoly', text: 'Name a resource: every player gives you 2 of it.', hint: () => 0.7,
    fields: () => [pickField('good', 'Resource', goods(RESOURCES), 'good')],
    apply: (s, seat, a) => monopoly(s, seat, a.picks.good as Good, 2) },
  { kind: 'trade-monopoly', text: 'Name a commodity: every player gives you 1 of it.', hint: () => 0.6,
    fields: () => [pickField('good', 'Commodity', goods(COMMODITIES), 'good')],
    apply: (s, seat, a) => monopoly(s, seat, a.picks.good as Good, 1) },
];
