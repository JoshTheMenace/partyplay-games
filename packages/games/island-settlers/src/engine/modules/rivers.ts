/**
 * Rivers of Catan (T&B): rivers flow from the coast inland through resource hexes. Every edge a
 * river crosses is a bridge site: no road or ship may go there, only a bridge (2 brick + 1 wood,
 * 3 per seat, counts as a road). Building by a river earns public gold coins; gold buys resources
 * and pays other players. The richest seat is Wealthiest (+1 VP), the poorest are Poor (−2 VP).
 * With Seafarers a ship leaving a river hex edge pays 1 gold (official combination sheet).
 */
import { distance } from '../../geometry';
import {
  COMMODITIES, RESOURCES, type Command, type EdgeId, type Good, type SeatId, type Tile, type TileId,
} from '../../model';
import { boardIndex } from '../board/lookup';
import { centroid } from '../board/islands';
import { spacedSlots } from '../board/ports';
import type { BoardDraft, GenContext } from '../board/types';
import { transfer } from '../cards';
import { cardsField, choice, command, pickField } from '../commands';
import { emit } from '../events';
import { role } from '../flow';
import { moveShip } from '../build';
import { shipMoves, why } from '../legal';
import { need } from '../need';
import { openPrompt } from '../prompts';
import { gained } from '../stats';
import { seatName, type State } from '../state';
import { partners, rates } from '../trade';
import { fishTotal, payFish } from './fishing';
import { BRIDGE_COST, bridgeSites, placeBridge, siteSet } from './rivers/bridges';
import type { Answer, Module } from './registry';

export type RiverState = {
  coins: Record<SeatId, number>; bought: Record<SeatId, number>;
  /** Set only while the paid `rivers-ship` move runs (lifts the river toll veto). */
  toll?: boolean;
};

const BRIDGE_FISH = 6;
const BUY_PRICE = 2;
const BUYS_PER_TURN = 2;

export const rx = (s: State) => s.ext.rivers as RiverState;
export const coins = (s: State, seat: SeatId) => rx(s).coins[seat] ?? 0;

// ---------------------------------------------------------------- board

/** River lengths per size class (the printed 4- and 3-hex rivers; more on bigger islands). */
const LENGTHS = [[4, 3], [4, 4], [4, 4, 3]];

/** Edge shared by two neighbouring tiles. */
const between = (d: BoardDraft, a: TileId, b: TileId) =>
  d.index.tileEdges.get(a)!.find(e => d.index.tileEdges.get(b)!.includes(e));

function decorateRivers(d: BoardDraft, ctx: GenContext) {
  const { index } = d, around = (t: Tile) => index.tileNeighbors.get(t.id)!;
  const home = d.tiles.filter(t => t.island === 0 && RESOURCES.includes(t.terrain as never));
  const mid = centroid(home), taken = new Set<TileId>();
  const free = (t: Tile) => home.includes(t) && !taken.has(t.id);
  const turn = (t: Tile) => Math.atan2(t.y - mid.y, t.x - mid.x);
  const coast = home.filter(t => around(t).some(x => x.terrain === 'sea'))
    .sort((a, b) => turn(a) - turn(b));
  const lengths = LENGTHS[ctx.tier], offset = Math.floor(ctx.random() * coast.length);
  let n = 0;
  // Evenly spaced mouths first, then any coastal hex when a spaced one is walled in.
  for (const first of [...spacedSlots(coast, lengths.length, offset), ...coast]) {
    if (n === lengths.length || !free(first)) continue;
    const path = [first];
    while (path.length < lengths[n]) {
      const last = path[path.length - 1];
      const next = around(last).filter(t => free(t) && !path.includes(t)
        && around(t).every(x => x === last || !path.includes(x)))
        .sort((a, b) => distance(a, mid) - distance(b, mid));
      if (!next.length) break;
      path.push(next[Math.min(next.length - 1, Math.floor(ctx.random() * 2))]);
    }
    if (path.length < 2) continue;
    // The mouth: the outward coast edge, avoiding a planned port.
    const port = (t: Tile) => +d.portSlots.includes(between(d, first.id, t.id)!);
    const sea = around(first).filter(t => t.terrain === 'sea')
      .sort((a, b) => port(a) - port(b) || distance(b, mid) - distance(a, mid))[0];
    const crossings = path.slice(1).map((t, i) => between(d, path[i].id, t.id)!);
    const edges = [between(d, first.id, sea.id)!, ...crossings];
    for (const t of path) for (const x of [t, ...around(t)]) taken.add(x.id);
    d.features.push({ kind: 'river', id: `river-${n}`, edges, tiles: path.map(t => t.id) });
    edges.forEach((edge, i) => d.features.push({ kind: 'bridge-site', id: `bridge-${n}-${i}`, edge }));
    n++;
  }
}

const riverTiles = (s: State) =>
  new Set(s.board.features.flatMap(f => (f.kind === 'river' ? f.tiles : [])));

/** Seafarers (official combination): a ship on a river hex edge pays 1 gold to sail away. */
const riverEdge = (s: State, e: EdgeId) => !!boardIndex(s.board).edge.get(e)?.tiles.some(t => riverTiles(s).has(t));
function tollPaid<T>(s: State, fn: () => T): T {
  rx(s).toll = true;
  try { return fn(); } finally { delete rx(s).toll; }
}

// ---------------------------------------------------------------- coins and wealth

function earn(s: State, seat: SeatId, n: number, reason: string) {
  rx(s).coins[seat] = coins(s, seat) + n;
  const text = `${seatName(s, seat)} earned ${n} gold (${reason})`;
  emit(s, { kind: 'module', module: 'rivers', name: 'coins', seat, target: null, text });
}

export const poorest = (s: State) => {
  const low = Math.min(...s.order.map(id => coins(s, id)));
  return s.order.filter(id => coins(s, id) === low);
};

/** Poor costs 2 VP, except with Barbarian Attack or Traders & Barbarians (official sheets). */
const isPoor = (s: State, seat: SeatId) =>
  !s.modules.some(m => m === 'barbarian-attack' || m === 'deliveries') && poorest(s).includes(seat);

/** Spending `n` keeps the seat off the Poor tile and keeps Wealthiest if it holds it. */
function safeSpend(s: State, seat: SeatId, n: number) {
  const left = coins(s, seat) - n, others = s.order.filter(id => id !== seat).map(id => coins(s, id));
  return left > Math.min(...others) && (s.awards.wealthiest !== seat || left > Math.max(...others));
}

const BUILD = new Set(['main', 'paired', 'round']);
/** Cards that may be sold for gold or asked for: commodities too with Cities & Knights. */
const cardGoods = (s: State): readonly Good[] =>
  (s.profile.commodities ? [...RESOURCES, ...COMMODITIES] : RESOURCES);
const canBuild = (s: State, seat: SeatId) => BUILD.has(role(s, seat) ?? '')
  && !(s.profile.movementLocksBuilding && s.seats[seat].moved);

function commands(s: State, seat: SeatId): Command[] {
  const r = role(s, seat);
  if (!r || !BUILD.has(r)) return [];
  const out: Command[] = [], c = coins(s, seat), hand = s.seats[seat].hand;
  const mk = (id: string, label: string, detail: string, rest: Partial<Command>) =>
    out.push(command({ id: `rivers-${id}`, module: 'rivers', group: 'rivers', label, detail, ...rest }));
  const sites = canBuild(s, seat) ? bridgeSites(s, seat) : [];
  const fields = [pickField('edge', 'Bridge site', sites.map(e => choice(e, 'Bridge site')), 'edge')];
  const gain = 'Earns 3 gold; counts as a road';
  if (sites.length) mk('bridge', 'Build a bridge', gain, { cost: BRIDGE_COST, fields, hint: 0.8 });
  if (sites.length && s.modules.includes('fishing') && fishTotal(s, seat) >= BRIDGE_FISH) {
    const label = `Build a bridge · ${BRIDGE_FISH} fish`;
    mk('fish-bridge', label, `${gain}; extra fish are lost`, { fields, hint: 0.75 });
  }
  const off = c ? tollPaid(s, () => shipMoves(s, seat)).filter(m => riverEdge(s, m.from)) : [];
  const to = (list: EdgeId[]) => [pickField('to', 'To', list.map(e => choice(e, 'Sea edge')), 'edge')];
  if (off.length) {
    mk('ship', 'Move a ship off the river · 1 gold', 'Your one ship move this turn', { hint: 0.3,
      fields: [pickField('from', 'Ship', off.map(m => choice(m.from, 'Ship', '', to(m.to))), 'edge')] });
  }
  const bank = Object.fromEntries(RESOURCES.map(g => [g, s.bank[g]]));
  if (c >= BUY_PRICE && rx(s).bought[seat] < BUYS_PER_TURN && RESOURCES.some(g => s.bank[g])) {
    const hint = safeSpend(s, seat, BUY_PRICE) ? 0.6 : 0.2;
    mk('buy', `Buy a resource · ${BUY_PRICE} gold`, 'Up to twice per turn', {
      fields: [cardsField('get', 'Resource', 'bank', bank, 1, 1, RESOURCES)], hint,
    });
  }
  // Largest surplus first: the generic CPU takes the first option of an untargeted pick.
  const rate = rates(s, seat), cards = cardGoods(s), spare = (g: Good) => hand[g] - rate[g];
  const goods = cards.filter(g => spare(g) >= 0).sort((a, b) => spare(b) - spare(a));
  if (goods.length) {
    const options = goods.map(g => choice(g, `${rate[g]} ${g} → 1 gold`));
    mk('sell', 'Sell cards for gold', 'Your bank rate buys 1 gold', {
      fields: [pickField('good', 'Cards to sell', options)], hint: poorest(s).includes(seat) ? 0.7 : 0.25,
    });
  }
  const others = partners(s, seat).filter(id => !Object.values(s.prompts).some(p => p.seat === id));
  if (c && others.length) {
    const amounts = Array.from({ length: Math.min(c, 4) }, (_, i) => choice(String(i + 1), `${i + 1} gold`));
    const fields = [
      pickField('seat', 'Player', others.map(id => choice(id, seatName(s, id))), 'seat'),
      pickField('coins', 'Gold', amounts),
      pickField('good', 'Card wanted', cards.map(g => choice(g, g)), 'good'),
    ];
    mk('offer', 'Offer gold for a card', 'The player accepts or declines', { fields, hint: 0.2 });
  }
  return out;
}

function apply(s: State, seat: SeatId, id: string, a: Answer) {
  const x = rx(s), p = s.seats[seat], name = seatName(s, seat);
  if (id === 'rivers-bridge' || id === 'rivers-fish-bridge') {
    if (id === 'rivers-fish-bridge') payFish(s, seat, BRIDGE_FISH);
    placeBridge(s, seat, a.picks.edge);
    return earn(s, seat, 3, 'bridge');
  }
  if (id === 'rivers-ship') {
    x.coins[seat]--;
    return tollPaid(s, () => moveShip(s, seat, a.picks.from, a.picks.to));
  }
  if (id === 'rivers-buy') {
    const get = a.cards.get;
    x.coins[seat] -= BUY_PRICE;
    x.bought[seat]++;
    transfer(s.bank, p.hand, get, 'The bank does not have that resource.');
    gained(s, seat, get);
    return emit(s, { kind: 'take', seat, cards: get, text: `${name} bought a resource for gold` });
  }
  if (id === 'rivers-sell') {
    const g = a.picks.good as Good;
    transfer(p.hand, s.bank, { [g]: rates(s, seat)[g] }, 'You no longer have those cards.');
    return earn(s, seat, 1, `sold ${g}`);
  }
  const data = { from: seat, coins: Number(a.picks.coins), good: a.picks.good };
  openPrompt(s, { seat: a.picks.seat, kind: 'rivers/offer', scope: 'self', data });
  const text = `${name} offers ${data.coins} gold to ${seatName(s, a.picks.seat)} for 1 ${data.good}`;
  emit(s, { kind: 'module', module: 'rivers', name: 'offer', seat, target: a.picks.seat, text });
}

type OfferData = { from: SeatId; coins: number; good: Good };

export const rivers: Module<RiverState> = {
  id: 'rivers',
  board: { decorate: decorateRivers },
  init: s => {
    const zero = () => Object.fromEntries(s.order.map(id => [id, 0]));
    return { coins: zero(), bought: zero() };
  },
  legal: {
    route: (s, _seat, e) => (siteSet(s).has(e) ? why('rule', 'Bridge site: only a bridge goes here') : null),
    shipMove: (s, _seat, e) => (riverEdge(s, e) && !rx(s).toll ? why('cost', 'Leaving a river costs 1 gold') : null),
  },
  /** 1 gold per road or ship on a river hex edge and per settlement on its corner (any setup building). */
  onBuild(s, seat, placed) {
    const tiles = riverTiles(s), ix = boardIndex(s.board), setup = s.turn.stage === 'setup';
    const on = (list?: string[]) => !!list?.some(t => tiles.has(t));
    if (placed.kind === 'route' && !placed.piece.bridge) {
      if (on(ix.edge.get(placed.piece.edge)?.tiles)) earn(s, seat, 1, 'river route');
    } else if (placed.kind === 'building' && (setup || placed.piece.kind === 'settlement')) {
      if (on(ix.vertex.get(placed.piece.vertex)?.tiles)) earn(s, seat, 1, 'river settlement');
    }
  },
  onOpportunityStart: (s, seat) => { rx(s).bought[seat] = 0; },
  commands,
  apply,
  prompts: {
    offer: {
      timer: 'prompt', autoText: 'Declines', label: 'Answering a gold offer',
      command(s, p) {
        // A fair price (what the bank charges) puts Accept first, which the generic CPU takes.
        const d = p.data as OfferData, fair = d.coins >= BUY_PRICE, can = s.seats[p.seat].hand[d.good] > 0;
        const yes = choice('accept', `Give 1 ${d.good} for ${d.coins} gold`);
        const no = choice('decline', 'Decline');
        const options = !can ? [no] : fair ? [yes, no] : [no, yes];
        return command({
          id: p.id, module: 'rivers', group: 'rivers', label: `${seatName(s, d.from)} offers gold`,
          detail: `${d.coins} gold for 1 ${d.good}`, fields: [pickField('answer', 'Answer', options)],
        });
      },
      apply(s, p, a) {
        const d = p.data as OfferData, x = rx(s);
        if (a.picks.answer !== 'accept') return;
        need(coins(s, d.from) >= d.coins, 'The gold is no longer available.');
        transfer(s.seats[p.seat].hand, s.seats[d.from].hand, { [d.good]: 1 }, `You have no ${d.good}.`);
        x.coins[d.from] -= d.coins;
        x.coins[p.seat] = coins(s, p.seat) + d.coins;
        const text = `${seatName(s, p.seat)} sold 1 ${d.good} to ${seatName(s, d.from)} for ${d.coins} gold`;
        emit(s, { kind: 'module', module: 'rivers', name: 'gold-trade', seat: p.seat, target: d.from, text });
      },
      auto: () => ({ picks: { answer: 'decline' }, cards: {} }),
    },
  },
  awards(s) {
    const best = Math.max(...s.order.map(id => coins(s, id)));
    const top = s.order.filter(id => coins(s, id) === best);
    const from = s.awards.wealthiest ?? null, next = top.length === 1 ? top[0] : null;
    if ('wealthiest' in s.awards && next === from) return;
    s.awards.wealthiest = next;
    if (next === from) return;
    const text = `${next ? seatName(s, next) : 'Nobody'} is the Wealthiest Catanian`;
    emit(s, { kind: 'award', award: 'wealthiest', seat: next, from, text });
  },
  score(s, seat) {
    const rich = s.awards.wealthiest === seat, poor = isPoor(s, seat);
    return [
      ...(rich ? [{ key: 'wealthiest', label: 'Wealthiest Catanian', points: 1, count: 1 }] : []),
      ...(poor ? [{ key: 'poor', label: 'Poor Catanian', points: -2, count: 1 }] : []),
    ];
  },
  publicView: s => ({
    coins: Object.fromEntries(s.order.map(id => [id, coins(s, id)])),
    wealthiest: s.awards.wealthiest ? [s.awards.wealthiest] : [], poorest: poorest(s),
  }),
  hud: s => [{
    kind: 'holder', key: 'wealthiest', label: 'Wealthiest Catanian', icon: 'coin',
    seat: s.awards.wealthiest ?? null,
  }],
  badges: (s, seat) => {
    const poor = { key: 'poor', icon: 'poor', value: -2, label: 'Poor Catanian (-2 VP)' };
    return [{ key: 'coins', icon: 'coin', value: coins(s, seat), label: 'Gold coins' },
      ...(isPoor(s, seat) ? [poor] : [])];
  },
};
