/**
 * Action-phase commands (E&P rulebook "Build" and "Trade"): harbor settlements, expedition ships,
 * settlers and crews boarding a ship docked at your harbor, 2 gold → 1 resource (twice a turn),
 * 3 resource cards → 1 gold at the bank rate and the Fast Gold spice benefit. Hints rank them above
 * every movement command, so the generic CPU builds before it sails.
 */
import { COMMODITIES, COSTS, RESOURCES, type CargoKind, type Command, type Good, type SeatId, type Unit }
  from '../../../model';
import { boardIndex } from '../../board/lookup';
import { cardsText, toCards, transfer } from '../../cards';
import { cardsField, choice, command, pickField } from '../../commands';
import { emit } from '../../events';
import { need } from '../../need';
import { placeBuilding, placeUnit, updateUnit } from '../../pieces';
import { gained } from '../../stats';
import { nextId, seatName, type State } from '../../state';
import { rates } from '../../trade';
import type { Answer } from '../registry';
import { shipName } from './course';
import { crewDemand, onBuilt, phase } from './rules';
import { navigable } from './sea';
import {
  aboard, addCoins, benefits, coins, CREW_COST, crewsUsed, docked, HARBOR_COST, harborsOf, isWater, LIMITS,
  room, ships, shipsOn, voyage, voyageFor,
} from './state';

const settlementsLeft = (s: State, seat: SeatId) => LIMITS.settlements - aboard(s, seat, 'settler')
  - Object.values(s.pieces.buildings).filter(b => b.seat === seat && b.kind === 'settlement').length;

/** Coastal settlements the seat may upgrade to harbor settlements (also C&K Medicine). */
export function harborSites(s: State, seat: SeatId) {
  const ix = boardIndex(s.board);
  return harborsOf(s, seat).length >= LIMITS.harbors ? [] : Object.values(s.pieces.buildings)
    .filter(b => b.seat === seat && b.kind === 'settlement'
      && (ix.vertex.get(b.vertex)?.tiles ?? []).some(t => isWater(s, t))).map(b => b.vertex);
}

/** Free sea edges beside the seat's harbors, while it has a ship left to build (also 5 fish). */
export function shipSites(s: State, seat: SeatId) {
  const ix = boardIndex(s.board);
  return ships(s, seat).length >= LIMITS.ships ? [] : [...new Set(harborsOf(s, seat)
    .flatMap(v => ix.vertex.get(v)?.edges ?? []))].filter(e => navigable(s, e) && !shipsOn(s, e));
}

export function buildShip(s: State, seat: SeatId, at: string, free = false) {
  const unit: Unit = { id: nextId(s, 'x'), kind: 'expedition', seat, at, level: LIMITS.slots, active: true,
    cargo: [] };
  placeUnit(s, unit);
  emit(s, { kind: 'build', seat, piece: 'expedition', spot: at, free, text: `${seatName(s, seat)} built a ship` });
  onBuilt(s, seat, { kind: 'unit', piece: unit });
}

export function buildHarbor(s: State, seat: SeatId, at: string) {
  const piece = { vertex: at, seat, kind: 'harbor' as const };
  placeBuilding(s, piece);
  const text = `${seatName(s, seat)} built a harbor settlement`;
  emit(s, { kind: 'build', seat, piece: 'harbor', spot: at, free: false, text });
  onBuilt(s, seat, { kind: 'building', piece });
}

export function buildCommands(s: State, seat: SeatId): Command[] {
  if (!phase(s, seat, 'build')) return [];
  const out: Command[] = [], mine = ships(s, seat);
  const cmd = (id: string, label: string, detail: string, rest: Partial<Command>) =>
    out.push(command({ id: `explorers/${id}`, module: 'explorers', group: 'ships', label, detail, ...rest }));
  type Target = 'vertex' | 'edge' | 'unit';
  const on = (key: string, label: string, ids: string[], text: (id: string) => string, target: Target) =>
    [pickField(key, label, ids.map(id => choice(id, text(id))), target)];
  const coastal = harborSites(s, seat);
  if (coastal.length) {
    cmd('harbor', 'Build a harbor settlement', 'Upgrade a coastal settlement: 2 points and a dock for ships',
      { cost: HARBOR_COST, hint: 0.95, fields: on('at', 'Settlement', coastal, () => 'Upgrade', 'vertex') });
  }
  const launch = shipSites(s, seat);
  if (launch.length) {
    const hint = !mine.length ? 0.9 : mine.some(u => docked(s, u) && !u.cargo.length) ? 0.3 : 0.75;
    cmd('ship', 'Build an expedition ship', 'Launch beside your harbor; it carries 2 cargo slots',
      { cost: COSTS.ship, hint, fields: on('at', 'Sea edge', launch, () => 'Sea edge', 'edge') });
  }
  const dock = mine.filter(u => docked(s, u)), name = (id: string) => shipName(s, s.pieces.units[id]);
  const empty = dock.filter(u => !u.cargo.length).map(u => u.id);
  if (empty.length && settlementsLeft(s, seat) > 0 && aboard(s, seat, 'settler') < LIMITS.settlers) {
    cmd('settler', 'Build a settler', 'Boards a docked ship; land it on an explored coast to settle there',
      { cost: COSTS.settlement, hint: 0.9, fields: on('ship', 'Ship', empty, name, 'unit') });
  }
  const spare = dock.filter(u => room(u) >= 1).map(u => u.id);
  if (spare.length && crewsUsed(s, seat) < LIMITS.crews) {
    const hint = aboard(s, seat, 'crew') < Math.min(4, crewDemand(s, seat)) ? 0.8 : 0.2;
    cmd('crew', 'Build a crew', 'Boards a docked ship; crews take pirate lairs and visit spice farms',
      { cost: CREW_COST, hint, fields: on('ship', 'Ship', spare, name, 'unit') });
  }
  const v = voyage(s, seat);
  if (coins(s, seat) >= 2 && v.goldBuys < 2) {
    cmd('buy', 'Buy with gold', `Pay 2 gold for 1 resource (${2 - v.goldBuys} left this turn)`, {
      hint: coins(s, seat) >= 4 ? 0.8 : 0.76,
      fields: [cardsField('get', 'Resource', 'bank', toCards(s.bank), 1, 1, RESOURCES)],
    });
  }
  const rate = rates(s, seat), sellable = RESOURCES.filter(g => s.seats[seat].hand[g] >= rate[g]);
  if (sellable.length) {
    cmd('sell', 'Sell cards for gold', 'Your bank rate buys 1 gold', { hint: 0.15,
      fields: [pickField('good', 'Cards to sell', sellable.map(g => choice(g, `${rate[g]} ${g} → 1 gold`)))] });
  }
  const sell: Good[] = s.profile.commodities ? [...RESOURCES, ...COMMODITIES] : [...RESOURCES];
  if (v.fastGold < benefits(s, seat, 'gold')) {
    cmd('fast-gold', 'Fast gold', 'Spice farm benefit: trade 1 card for 1 gold',
      { hint: 0.2, fields: [cardsField('give', 'Card', 'hand', toCards(s.seats[seat].hand), 1, 1, sell)] });
  }
  return out;
}

function board(s: State, seat: SeatId, ship: string, cargo: CargoKind) {
  const u = s.pieces.units[ship];
  need(u, 'That ship is gone.');
  updateUnit(s, u.id, { cargo: [...u.cargo, cargo] });
  emit(s, { kind: 'module', module: 'explorers', name: cargo, seat, target: u.id,
    text: `${seatName(s, seat)} built a ${cargo}` });
}

export function applyBuild(s: State, seat: SeatId, id: string, a: Answer) {
  const name = seatName(s, seat), at = a.picks.at, v = voyageFor(s, seat);
  if (id === 'harbor') return buildHarbor(s, seat, at);
  if (id === 'ship') return buildShip(s, seat, at);
  if (id === 'settler' || id === 'crew') return board(s, seat, a.picks.ship, id);
  if (id === 'buy') {
    transfer(s.bank, s.seats[seat].hand, a.cards.get);
    gained(s, seat, a.cards.get);
    addCoins(s, seat, -2);
    v.goldBuys++;
    const cards = a.cards.get;
    emit(s, { kind: 'take', seat, cards, text: `${name} paid 2 gold for ${cardsText(cards)}` });
  } else {
    const g = a.picks.good as Good, give = id === 'sell' ? { [g]: rates(s, seat)[g] } : a.cards.give;
    transfer(s.seats[seat].hand, s.bank, give, 'You no longer have those cards.');
    addCoins(s, seat, 1);
    if (id === 'fast-gold') v.fastGold++;
    const text = `${name} sold ${cardsText(give)} for gold`;
    emit(s, { kind: 'module', module: 'explorers', name: id, seat, target: null, text });
  }
}
