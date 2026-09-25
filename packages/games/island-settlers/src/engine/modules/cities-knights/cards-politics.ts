/** Politics progress cards (Constitution scores on draw and never reaches a hand). */
import type { EdgeId, SeatId } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { total } from '../../cards';
import { choice, pickField } from '../../commands';
import { emit } from '../../events';
import { face, robberTiles, why } from '../../legal';
import { removeRoute, setRobber } from '../../pieces';
import { openPrompt, steal } from '../../prompts';
import { publicVp } from '../../stats';
import { pushEffect, seatName, type State } from '../../state';
import { moduleById } from '../registry';
import { richer } from './cards-trade';
import { activate, displace, displaceable, hurt } from './knights';
import type { Play } from './play';
import { knightAt, knightsOf, note, sx } from './state';

const seats = (s: State, list: SeatId[]) => list.map(id => choice(id, seatName(s, id)));

/** A route with at least one end touching none of its owner's other routes, buildings or knights. */
function openRoutes(s: State): EdgeId[] {
  const ix = boardIndex(s.board);
  const loose = (e: EdgeId, v: string, owner: SeatId) => s.pieces.buildings[v]?.seat !== owner
    && knightAt(s, v)?.seat !== owner
    && !(ix.vertex.get(v)?.edges ?? []).some(x => x !== e && s.pieces.routes[x]?.seat === owner);
  return Object.values(s.pieces.routes).filter(r => !r.bridge).map(r => r.edge).filter(e => {
    const edge = ix.edge.get(e)!, owner = s.pieces.routes[e].seat;
    return loose(e, edge.a, owner) || loose(e, edge.b, owner);
  });
}

/** Opponent knights on a corner touching one of the seat's routes (Intrigue). */
const intrigueTargets = (s: State, seat: SeatId) => knightsOf(s).filter(k => k.seat !== seat && displaceable(s, k)
  && (boardIndex(s.board).vertex.get(k.at)?.edges ?? []).some(e => s.pieces.routes[e]?.seat === seat));

/** Seats that must hand over cards: `count(n)` of their n cards, to `to` (null: the bank). */
function levy(s: State, list: SeatId[], to: SeatId | null, count: (n: number) => number, why: string) {
  for (const id of list) {
    const n = count(total(s.seats[id].hand));
    if (n > 0) openPrompt(s, { seat: id, kind: 'cities-knights/give', scope: 'table', data: { to, count: n, why } });
  }
}

/** E&P + C&K: Bishop activates the pirate fleet instead of moving the (absent) robber. */
const pirateOnly = (s: State) => !s.profile.robber && s.modules.includes('explorers')
  && !!moduleById('explorers')?.effects?.pirate;

export const POLITICS: Play[] = [
  { kind: 'bishop', text: 'Move the robber and steal 1 card from each player on its hex.', hint: () => 0.65,
    fields(s, seat) {
      if (pirateOnly(s)) return [];
      if (!s.pieces.robber) return why('rule', 'The robber enters after the first barbarian attack');
      const tiles = robberTiles(s, seat, 'robber').sort((a, b) => hurt(s, seat, b) - hurt(s, seat, a));
      const hex = (t: string) => choice(t, `${face(s, t).terrain} ${face(s, t).number}`);
      return [pickField('tile', 'Hex', tiles.map(hex), 'tile')];
    },
    apply(s, seat, a) {
      if (!a.picks.tile) return pushEffect(s, { type: 'module', module: 'explorers', name: 'pirate', data: seat });
      const from = s.pieces.robber, tile = a.picks.tile, ix = boardIndex(s.board);
      setRobber(s, tile);
      const text = `${seatName(s, seat)} moved the robber`;
      emit(s, { kind: 'robber', seat, piece: 'robber', from, tile, victim: null, text });
      const owners = new Set((ix.tileVertices.get(tile) ?? []).map(v => s.pieces.buildings[v]?.seat));
      for (const id of s.order) if (id !== seat && owners.has(id) && total(s.seats[id].hand)) steal(s, seat, id);
    } },
  { kind: 'deserter', text: 'A player removes one of their knights; you may place one of yours of that strength.',
    hint: () => 0.6,
    fields(s, seat) {
      const list = s.order.filter(id => id !== seat && knightsOf(s, id).length);
      return list.length ? [pickField('seat', 'Player', seats(s, list), 'seat')] : why('rule', 'Nobody has a knight');
    },
    apply(s, seat, a) {
      openPrompt(s, { seat: a.picks.seat, kind: 'cities-knights/deserter', scope: 'table', data: { by: seat } });
    } },
  { kind: 'diplomat', text: 'Remove an open road. If it is yours, build 1 road for free.', hint: () => 0.35,
    fields(s, seat) {
      const lead = (e: EdgeId) => { const o = s.pieces.routes[e].seat; return o === seat ? -1 : publicVp(s, o); };
      const list = openRoutes(s).sort((a, b) => lead(b) - lead(a));
      if (!list.length) return why('no-spot', 'No open road');
      const road = (e: EdgeId) => choice(e, `${seatName(s, s.pieces.routes[e].seat)}'s road`);
      return [pickField('edge', 'Road', list.map(road), 'edge')];
    },
    apply(s, seat, a) {
      const owner = s.pieces.routes[a.picks.edge].seat;
      removeRoute(s, a.picks.edge);
      if (owner === seat) s.seats[seat].freeRoutes++;
      note(s, 'diplomat', seat, a.picks.edge, `${seatName(s, seat)} removed ${seatName(s, owner)}'s road`);
    } },
  { kind: 'intrigue', text: 'Displace an opponent knight standing on one of your routes.', hint: () => 0.55,
    fields(s, seat) {
      const list = intrigueTargets(s, seat).sort((a, b) => b.level - a.level);
      if (!list.length) return why('no-spot', 'No opponent knight on your routes');
      const opts = list.map(k => choice(k.at, `${seatName(s, k.seat)}'s level ${k.level}`));
      return [pickField('at', 'Knight', opts, 'vertex')];
    },
    apply(s, seat, a) {
      const k = knightAt(s, a.picks.at)!;
      note(s, 'intrigue', seat, k.at, `${seatName(s, seat)} displaced ${seatName(s, k.seat)}'s knight`);
      displace(s, k);
    } },
  { kind: 'saboteur', text: 'Everyone with at least your points discards half their cards.',
    hint: (s, seat) => (richer(s, seat, true).some(id => total(s.seats[id].hand) >= 2) ? 0.6 : 0.05),
    fields: () => [],
    apply: (s, seat) => levy(s, richer(s, seat, true), null, n => Math.floor(n / 2), 'Saboteur') },
  { kind: 'spy', text: "Look at a player's progress cards and take one.", hint: () => 0.6,
    fields(s, seat) {
      const list = s.order.filter(id => id !== seat && sx(s, id).progress.length);
      if (!list.length) return why('rule', 'Nobody holds progress cards');
      return [pickField('seat', 'Player', seats(s, list), 'seat')];
    },
    apply(s, seat, a) {
      openPrompt(s, { seat, kind: 'cities-knights/spy', scope: 'self', data: { from: a.picks.seat } });
    } },
  { kind: 'warlord', text: 'Activate all your knights for free.',
    hint(s, seat) {
      const n = knightsOf(s, seat).filter(k => !k.active).length;
      return n ? 0.5 + 0.1 * n : 0.05;
    },
    fields: () => [],
    apply(s, seat) { for (const k of knightsOf(s, seat).filter(k => !k.active)) activate(s, k); } },
  { kind: 'wedding', text: 'Everyone with more points gives you 2 cards of their choice.',
    hint: (s, seat) => (richer(s, seat).some(id => total(s.seats[id].hand)) ? 0.8 : 0.05), fields: () => [],
    apply: (s, seat) => levy(s, richer(s, seat), seat, n => Math.min(2, n), 'Wedding') },
];
