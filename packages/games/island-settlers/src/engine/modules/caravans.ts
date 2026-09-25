/**
 * Merchant Trains (T&B "Caravans"): building anything on your turn earns a camel. When the turn
 * ends, every seat bids wool and grain (brick and wood with C&K) at once and in secret, naming the
 * edge its votes go to. The most-voted edge gets the camel; on a tie the biggest bidder places it,
 * else the camel's owner. Bids are paid to the bank. Camels form trains from the oasis that never
 * branch; a camel doubles a route edge for the longest route, and a building touching two camels
 * earns +1 VP.
 */
import { RESOURCES, type Cards, type EdgeId, type Good, type SeatId, type Tile, type TileId, type VertexId }
  from '../../model';
import { distance } from '../../geometry';
import { boardIndex } from '../board/lookup';
import { centroid } from '../board/islands';
import type { BoardDraft } from '../board/types';
import { isLand } from '../board/util';
import { total, transfer } from '../cards';
import { cardsField, choice, command, pickField } from '../commands';
import { emit } from '../events';
import { need } from '../need';
import { placeUnit } from '../pieces';
import { openPrompt } from '../prompts';
import { seatName, type OpenPrompt, type State } from '../state';
import type { Module } from './registry';

export type Segment = { edge: EdgeId; from: VertexId; to: VertexId };
type Bid = { cards: Cards; edge: EdgeId | null };
export type CaravanState = {
  oasis: TileId | null;
  /** Oasis corners where a train may start (three alternate corners). */
  starts: VertexId[];
  trains: Segment[];
  /** Seats that built during their current opportunity. */
  built: SeatId[];
  /** Camel owners waiting for their voting round, in order. */
  owed: SeatId[];
  vote: { owner: SeatId; bids: Record<SeatId, Bid> } | null;
  lastWinner: SeatId | null;
};

export const cx = (s: State) => s.ext.caravans as CaravanState;
/** 22 camels for 3–4 seats, 3 more per extra seat (adaptation). */
export const camelSupply = (s: State) => 22 + 3 * Math.max(0, s.order.length - 4);
const bidGoods = (s: State): Good[] =>
  (s.modules.includes('cities-knights') ? ['brick', 'wood'] : ['wool', 'grain']);

// ---------------------------------------------------------------- board and trains

/** The oasis replaces the desert nearest the island centre (else the most central resource hex). */
function decorateCaravans(d: BoardDraft) {
  const land = d.tiles.filter(t => isLand(t.terrain)), home = land.filter(t => t.island === 0);
  const mid = centroid(home.length ? home : land);
  const near = (a: Tile, b: Tile) => distance(a, mid) - distance(b, mid);
  const oasis = home.filter(t => t.terrain === 'desert').sort(near)[0]
    ?? home.filter(t => RESOURCES.includes(t.terrain as never)).sort(near)[0];
  if (oasis) Object.assign(oasis, { terrain: 'oasis', number: 0 });
}

const touching = (x: CaravanState, v: VertexId) => x.trains.filter(t => t.from === v || t.to === v).length;

/** Open train ends: unused starts and fronts that no other train has merged into. */
function ends(x: CaravanState): VertexId[] {
  const fronts = x.trains.map(t => t.to)
    .filter(v => !x.trains.some(t => t.from === v) && touching(x, v) === 1);
  return [...x.starts.filter(v => !touching(x, v)), ...fronts];
}

/** Edges a new camel may take (no camel yet, off the oasis, joined nose to tail). */
export function camelSites(s: State): EdgeId[] {
  const x = cx(s), open = ends(x), sea = s.modules.includes('seafarers');
  if (!x.oasis || x.trains.length >= camelSupply(s)) return [];
  return s.board.edges.filter(e => (e.land || sea) && !e.tiles.includes(x.oasis!)
    && !x.trains.some(t => t.edge === e.id) && (open.includes(e.a) || open.includes(e.b))).map(e => e.id);
}

/** Sites ordered by what they are worth to `seat`: camels beside its buildings, then under its roads. */
function preferred(s: State, seat: SeatId, sites: EdgeId[]): EdgeId[] {
  const ix = boardIndex(s.board), x = cx(s);
  const value = (id: EdgeId) => {
    const e = ix.edge.get(id)!, mine = (v: VertexId) => s.pieces.buildings[v]?.seat === seat;
    return [e.a, e.b].reduce((n, v) => n + (mine(v) ? 1 + 2 * Math.min(1, touching(x, v)) : 0), 0)
      + (s.pieces.routes[id]?.seat === seat ? 0.5 : 0);
  };
  return [...sites].sort((a, b) => value(b) - value(a));
}

export function placeCamel(s: State, seat: SeatId, edge: EdgeId) {
  const x = cx(s), e = boardIndex(s.board).edge.get(edge)!, from = ends(x).includes(e.a) ? e.a : e.b;
  x.trains.push({ edge, from, to: from === e.a ? e.b : e.a });
  x.lastWinner = seat;
  const unit = { id: `camel-${x.trains.length}`, kind: 'camel' as const, seat: null, at: edge, level: 0 };
  placeUnit(s, { ...unit, active: true, cargo: [] });
  const text = `${seatName(s, seat)} placed a camel`;
  emit(s, { kind: 'module', module: 'caravans', name: 'camel', seat, target: edge, text });
}

// ---------------------------------------------------------------- voting rounds

/** Opens the next voting round (sealed, simultaneous bids) while camels are owed. */
export function nextVote(s: State) {
  const x = cx(s), placing = () => Object.values(s.prompts).some(q => q.kind === 'caravans/place');
  while (!x.vote && x.owed.length && !placing()) {
    const owner = x.owed.shift()!;
    if (!camelSites(s).length) { x.owed = []; return; }
    x.vote = { owner, bids: {} };
    const goods = bidGoods(s), bidders = s.order.filter(id => goods.some(g => s.seats[id].hand[g] > 0));
    const text = `${seatName(s, owner)} collected a camel: everyone bids ${goods.join(' and ')}`;
    emit(s, { kind: 'module', module: 'caravans', name: 'vote', seat: owner, target: null, text });
    for (const seat of bidders) openPrompt(s, { seat, kind: 'caravans/bid', scope: 'table' });
    if (!bidders.length) resolve(s);
  }
}

/** Reveal and pay the bids, then place: top edge, else top bidder's edge, else the owner decides. */
function resolve(s: State) {
  const x = cx(s), vote = x.vote!, sites = camelSites(s), votes = new Map<EdgeId, number>();
  const paid: Record<SeatId, number> = {};
  for (const [seat, bid] of Object.entries(vote.bids)) {
    // Bids were sealed, not escrowed: a seat pays what it still holds (trades may run meanwhile).
    const hand = s.seats[seat].hand, held = ([g, n]: [string, number]) => [g, Math.min(n, hand[g as Good])];
    const cards: Cards = Object.fromEntries(Object.entries(bid.cards).map(held));
    transfer(hand, s.bank, cards);
    paid[seat] = total(cards);
    if (!paid[seat] || !bid.edge || !sites.includes(bid.edge)) continue;
    votes.set(bid.edge, (votes.get(bid.edge) ?? 0) + paid[seat]);
  }
  const shown = s.order.map(id => `${seatName(s, id)} ${paid[id] ?? 0}`).join(', ');
  const text = `Caravan bids: ${shown}`;
  emit(s, { kind: 'module', module: 'caravans', name: 'bids', seat: vote.owner, target: null, text });
  const top = (m: Map<string, number>) => {
    const best = Math.max(0, ...m.values()), list = [...m].filter(([, n]) => n === best && n > 0);
    return list.length === 1 ? list[0][0] : null;
  };
  const edge = top(votes), bidder = top(new Map(Object.entries(paid)));
  x.vote = null;
  if (edge) {
    const lead = Object.keys(paid).filter(id => vote.bids[id].edge === edge)
      .sort((a, b) => paid[b] - paid[a])[0];
    return placeCamel(s, lead, edge);
  }
  const placer = bidder ?? vote.owner, own = vote.bids[placer]?.edge;
  if (own && paid[placer] && sites.includes(own)) return placeCamel(s, placer, own);
  openPrompt(s, { seat: placer, kind: 'caravans/place', scope: 'table' });
}

function bidCommand(s: State, p: OpenPrompt) {
  const goods = bidGoods(s), hand = s.seats[p.seat].hand, owner = seatName(s, cx(s).vote?.owner ?? null);
  const have: Cards = Object.fromEntries(goods.map(g => [g, hand[g]]));
  return command({
    id: p.id, module: 'caravans', group: 'caravans', label: 'Bid for the camel',
    detail: `${owner}'s camel: each ${goods.join(' or ')} is one vote, paid at the reveal`,
    fields: [cardsField('bid', 'Bid', 'hand', have, 0, total(have), goods),
      pickField('edge', 'Your votes go to', siteChoices(s, p.seat), 'edge', true)],
  });
}

const siteChoices = (s: State, seat: SeatId) =>
  preferred(s, seat, camelSites(s)).map(e => choice(e, 'Camel edge'));

/** The seat's buildings touching two camels (+1 VP each). */
const betweenCamels = (s: State, seat: SeatId) =>
  Object.values(s.pieces.buildings).filter(b => b.seat === seat && touching(cx(s), b.vertex) >= 2).length;

export const caravans: Module<CaravanState> = {
  id: 'caravans',
  board: { decorate: decorateCaravans },
  init(s) {
    // Alternate corners with a way out (two on a coastal oasis, as the official combination notes).
    const oasis = s.board.tiles.find(t => t.terrain === 'oasis')?.id ?? null, ix = boardIndex(s.board);
    const corners = oasis ? ix.tileVertices.get(oasis)! : [];
    const out = (v: VertexId) => ix.vertex.get(v)!.edges.some(e => !ix.edge.get(e)!.tiles.includes(oasis!));
    const [even, odd] = [0, 1].map(k => corners.filter((v, i) => i % 2 === k && v && out(v)));
    const starts = odd.length > even.length ? odd : even;
    return { oasis, starts, trains: [], built: [], owed: [], vote: null, lastWinner: null };
  },
  onBuild(s, seat, placed) {
    const x = cx(s);
    if (s.turn.stage !== 'setup' && placed.kind === 'building' && !x.built.includes(seat)) x.built.push(seat);
  },
  onOpportunityEnd(s, seat) {
    const x = cx(s);
    if (!x.built.includes(seat)) return;
    x.built = x.built.filter(id => id !== seat);
    x.owed.push(seat);
    nextVote(s);
  },
  prompts: {
    bid: {
      timer: 'prompt', autoText: 'Bids nothing', label: 'Bidding', command: bidCommand,
      apply(s, p, a) {
        const cards = a.cards.bid ?? {}, edge = a.picks.edge ?? null;
        need(!total(cards) || edge, 'Choose where your votes go.');
        cx(s).vote!.bids[p.seat] = { cards, edge };
        if (!Object.values(s.prompts).some(q => q.kind === 'caravans/bid')) resolve(s);
        nextVote(s);
      },
      auto: () => ({ picks: {}, cards: { bid: {} } }),
    },
    place: {
      timer: 'prompt', autoText: 'Places it where it helps you most', label: 'Placing the camel',
      command: (s, p) => command({
        id: p.id, module: 'caravans', group: 'caravans', label: 'Place the camel',
        detail: 'Nobody won the vote outright',
        fields: [pickField('edge', 'Camel edge', siteChoices(s, p.seat), 'edge')],
      }),
      apply(s, p, a) { placeCamel(s, p.seat, a.picks.edge); nextVote(s); },
      auto: (s, p) => ({ picks: { edge: preferred(s, p.seat, camelSites(s))[0] }, cards: {} }),
    },
  },
  routeWeight: (s, edge) => (cx(s).trains.some(t => t.edge === edge) ? 2 : 1),
  score(s, seat) {
    const n = betweenCamels(s, seat);
    return n ? [{ key: 'caravans', label: 'Between two camels', points: n, count: n }] : [];
  },
  publicView: s => ({ bidding: !!cx(s).vote, lastWinner: cx(s).lastWinner }),
  hud: s => [{
    kind: 'track', key: 'camels', label: 'Camels', value: cx(s).trains.length, max: camelSupply(s),
    alert: !!cx(s).vote, icon: 'camel',
  }],
  badges(s, seat) {
    const n = betweenCamels(s, seat);
    return n ? [{ key: 'camels', icon: 'camel', value: n, label: 'Buildings between two camels' }] : [];
  },
};
