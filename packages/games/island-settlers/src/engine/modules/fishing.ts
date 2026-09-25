/**
 * Fishing on Catan (T&B): coastal fishing grounds and the lake hand out secret fish tokens (1–3
 * fish, or the old boot) when their numbers roll. Fish are not cards: they are never discarded,
 * robbed or traded. On your turn you spend them on one favour at a time; overpayment is lost.
 */
import { RESOURCES, type BoardFeature, type Command, type SeatId, type TileId } from '../../model';
import { boardIndex } from '../board/lookup';
import { total, transfer } from '../cards';
import { cardsField, choice, command, pickField } from '../commands';
import { DEV_LABELS } from '../dev';
import { emit, inbox } from '../events';
import { role } from '../flow';
import { targets } from '../legal';
import { need } from '../need';
import { setPirate, setRobber } from '../pieces';
import { robberHeld, steal } from '../prompts';
import { shuffle } from '../rng';
import { bump, gained, publicVp } from '../stats';
import { nextId, random, seatName, type State } from '../state';
import { decorateFishing } from './fishing/board';
import { applyCombo, catches, comboSpends, type ComboSpend } from './fishing/combos';
import type { Answer, Module } from './registry';

export type FishToken = { id: string; value: number };
export type FishState = {
  /** Face-down supply, drawn from the end; 0 is the old boot. */
  deck: number[];
  discard: number[];
  hands: Record<SeatId, FishToken[]>;
  boot: SeatId | null;
};

/** Official mix: 11 one-, 10 two- and 8 three-fish tokens plus the boot; T&B 5–6 adds 14 (43), 7+ doubles. */
const MIX: [number, number][] = [[1, 11], [2, 10], [3, 8]];
/** You may never hold more than 7 fish tokens (the boot excluded). */
export const FISH_CAP = 7;
const BUILD_ROLES = new Set(['main', 'paired', 'round']);

export const fx = (s: State) => s.ext.fishing as FishState;
export const fishTotal = (s: State, seat: SeatId) => fx(s).hands[seat].reduce((n, t) => n + t.value, 0);

/** Cheapest set of tokens worth at least `price` (least overpayment, then fewest tokens). */
export function payment(tokens: readonly FishToken[], price: number): FishToken[] | null {
  let best: FishToken[] | null = null, bestSum = Infinity;
  for (let mask = 1; mask < 1 << tokens.length; mask++) {
    const set = tokens.filter((_, i) => mask & (1 << i)), sum = set.reduce((n, t) => n + t.value, 0);
    if (sum >= price && (sum < bestSum || (sum === bestSum && set.length < best!.length))) {
      best = set;
      bestSum = sum;
    }
  }
  return best;
}

/** Discard the cheapest payment for `price` (to the face-up pile). */
export function payFish(s: State, seat: SeatId, price: number) {
  const x = fx(s), paid = payment(x.hands[seat], price);
  need(paid, `You need ${price} fish.`);
  x.hands[seat] = x.hands[seat].filter(t => !paid.includes(t));
  x.discard.push(...paid.map(t => t.value));
}

const payText = (s: State, seat: SeatId, price: number) =>
  `Pays ${payment(fx(s).hands[seat], price)!.map(t => t.value).join('+')} fish`;

/** Draw `n` tokens for `seat` one at a time, reshuffling the discard pile when the supply is out. */
export function catchFish(s: State, seat: SeatId, n: number) {
  const x = fx(s), caught: number[] = [];
  for (let i = 0; i < n && x.hands[seat].length < FISH_CAP; i++) {
    if (!x.deck.length) [x.deck, x.discard] = [shuffle(x.discard, random(s, 'cards')), []];
    const value = x.deck.pop();
    if (value === undefined) break;
    if (value === 0) {
      x.boot = seat;
      const text = `${seatName(s, seat)} fished up the old boot: 1 more VP needed to win`;
      emit(s, { kind: 'module', module: 'fishing', name: 'boot', seat, target: null, text });
    } else {
      x.hands[seat].push({ id: nextId(s, 'f'), value });
      caught.push(value);
    }
  }
  if (!caught.length) return;
  const text = `${seatName(s, seat)} caught ${caught.length} fish token${caught.length > 1 ? 's' : ''}`;
  emit(s, { kind: 'module', module: 'fishing', name: 'catch', seat, target: null, text });
  inbox(s, seat, { text: `You caught ${caught.join(' + ')} fish`, cards: {}, tone: 'gain', other: null });
}

// ---------------------------------------------------------------- board

type Ground = Extract<BoardFeature, { kind: 'fishing-ground' }>;

export const grounds = (s: State) =>
  s.board.features.filter((f): f is Ground => f.kind === 'fishing-ground');

/** Seats with a building on a corner of `tile` or a ship on one of its sides. */
export function touchingSeats(s: State, tile: TileId): SeatId[] {
  const ix = boardIndex(s.board), { buildings, routes } = s.pieces;
  const ships = (ix.tileEdges.get(tile) ?? []).map(e => (routes[e]?.kind === 'ship' ? routes[e].seat : ''));
  return [...(ix.tileVertices.get(tile) ?? []).map(v => buildings[v]?.seat ?? ''), ...ships].filter(x => x);
}

// ---------------------------------------------------------------- spending

type Spend = 'robber' | 'pirate' | 'steal' | 'resource' | 'route' | 'dev' | ComboSpend;
const PRICE: Record<Spend, number> = {
  robber: 2, pirate: 2, tribute: 2, steal: 3, resource: 4, route: 5, ship: 5, dev: 7, progress: 7, voyage: 7,
  wagon: 2,
};
const LABEL: Record<Spend, string> = {
  robber: 'Remove the robber', pirate: 'Remove the pirate', tribute: 'Ignore the pirate this turn',
  steal: 'Steal a card', resource: 'Take a resource', route: 'Build a free road', ship: 'Build a free ship',
  dev: 'Take a development card', progress: 'Take a progress card', voyage: 'Move a ship again',
  wagon: '+2 wagon movement',
};

/** The piece on `tile` touches one of the seat's buildings or ships. */
const hurts = (s: State, seat: SeatId, tile: string | null) =>
  !!tile && touchingSeats(s, tile).includes(seat);

function spends(s: State, seat: SeatId): Command[] {
  const fish = fishTotal(s, seat), others = s.order.filter(id => id !== seat);
  const list: [Spend, number, Command['fields']][] = [];
  const add = (k: Spend, hint: number, fields: Command['fields'] = []) => {
    if (fish >= PRICE[k]) list.push([k, hint, fields]);
  };
  // Before the first C&K attack an off-board robber is held, so removing it then would be final.
  const { robber, pirate } = s.pieces, removable = !robberHeld(s);
  if (removable && s.profile.robber && robber) add('robber', hurts(s, seat, robber) ? 0.8 : 0.15);
  if (removable && s.profile.pirate && pirate) add('pirate', hurts(s, seat, pirate) ? 0.6 : 0.1);
  const victims = others.filter(id => total(s.seats[id].hand) > 0)
    .sort((a, b) => publicVp(s, b) - publicVp(s, a));
  if (victims.length) {
    add('steal', 0.5, [pickField('victim', 'Player', victims.map(v => choice(v, seatName(s, v))), 'seat')]);
  }
  const bank = Object.fromEntries(RESOURCES.map(g => [g, s.bank[g]]));
  if (RESOURCES.some(g => s.bank[g] > 0)) {
    add('resource', 0.55, [cardsField('get', 'Resource', 'bank', bank, 1, 1, RESOURCES)]);
  }
  if (s.profile.routeKinds.some(k => targets(s, seat, k).length)) add('route', 0.5);
  if (s.profile.devCards && s.devDeck.length) add('dev', 0.75);
  for (const [k, hint, fields] of comboSpends(s, seat)) add(k, hint, fields);
  const label = (k: Spend) => (k === 'route' && s.profile.routeKinds.includes('ship') ? 'Build a free road or ship'
    : LABEL[k]);
  return list.map(([k, hint, fields]) => command({
    id: `fishing-${k}`, module: 'fishing', group: 'fishing', label: `${label(k)} · ${PRICE[k]} fish`,
    detail: `${payText(s, seat, PRICE[k])}; extra fish are lost`, fields, hint,
  }));
}

function bootCommand(s: State, seat: SeatId): Command[] {
  const mine = publicVp(s, seat);
  const to = s.order.filter(id => id !== seat && publicVp(s, id) >= mine)
    .sort((a, b) => publicVp(s, b) - publicVp(s, a));
  if (fx(s).boot !== seat || !to.length) return [];
  const options = to.map(id => choice(id, seatName(s, id), `${publicVp(s, id)} VP`));
  const field = pickField('seat', 'New owner', options, 'seat');
  return [command({
    id: 'fishing-boot', module: 'fishing', group: 'fishing', label: 'Pass the old boot',
    detail: 'Give it to a player with at least your points', fields: [field], hint: 0.95,
  })];
}

function spend(s: State, seat: SeatId, k: Spend, a: Answer) {
  payFish(s, seat, PRICE[k]);
  const p = s.seats[seat], name = seatName(s, seat), text = `${name}: ${LABEL[k]} (fish)`;
  emit(s, { kind: 'module', module: 'fishing', name: k, seat, target: null, text });
  if (k === 'robber') setRobber(s, null);
  else if (k === 'pirate') setPirate(s, null);
  else if (k === 'steal') steal(s, seat, a.picks.victim);
  else if (k === 'route') p.freeRoutes++;
  else if (k === 'resource') {
    transfer(s.bank, p.hand, a.cards.get, 'The bank does not have that resource.');
    gained(s, seat, a.cards.get);
    emit(s, { kind: 'take', seat, cards: a.cards.get, text: `${name} took a resource for fish` });
  } else if (k === 'dev') {
    const kind = s.devDeck.pop();
    need(kind, 'The deck is empty.');
    p.dev.push({ id: nextId(s, 'd'), kind, boughtAt: p.opportunity });
    bump(s, seat, 'devBought');
    emit(s, { kind: 'dev-buy', seat, text: `${name} took a dev card for fish` });
    inbox(s, seat, { text: `You drew ${DEV_LABELS[kind]}`, cards: {}, tone: 'gain', other: null });
  } else applyCombo(s, seat, k, a);
}

export const fishing: Module<FishState> = {
  id: 'fishing',
  board: { decorate: decorateFishing },
  init(s) {
    const scale = s.order.length >= 7 ? 2 : s.order.length >= 5 ? 1.5 : 1;
    const tokens = MIX.flatMap(([v, n]) => Array<number>(Math.floor(n * scale)).fill(v));
    return { deck: shuffle([...tokens, 0], random(s, 'cards')), discard: [], boot: null,
      hands: Object.fromEntries(s.order.map(id => [id, []])) };
  },
  afterProduce(s, roll) {
    const live = grounds(s).filter(g => g.numbers.includes(roll.total)
      && g.tile !== s.pieces.robber && g.tile !== s.pieces.pirate);
    const start = Math.max(0, s.order.indexOf(roll.seat ?? ''));
    for (let i = 0; i < s.order.length; i++) {
      const seat = s.order[(start + i) % s.order.length];
      const n = live.flatMap(g => g.vertices).map(v => s.pieces.buildings[v])
        .filter(b => b?.seat === seat && catches(s, b.vertex))
        .reduce((sum, b) => sum + (b.kind === 'city' ? 2 : 1), 0);
      if (n) catchFish(s, seat, n);
    }
  },
  onBuild(s, seat, placed) {
    const second = s.turn.stage === 'setup' && s.turn.setup?.round === 2 && placed.kind === 'building';
    if (second && grounds(s).some(g => g.vertices.includes(placed.piece.vertex))) catchFish(s, seat, 1);
  },
  commands(s, seat) {
    const r = role(s, seat);
    return r && BUILD_ROLES.has(r) ? [...bootCommand(s, seat), ...spends(s, seat)] : [];
  },
  apply(s, seat, id, a) {
    if (id !== 'fishing-boot') return spend(s, seat, id.slice('fishing-'.length) as Spend, a);
    fx(s).boot = a.picks.seat;
    const text = `${seatName(s, seat)} passed the old boot to ${seatName(s, a.picks.seat)}`;
    emit(s, { kind: 'module', module: 'fishing', name: 'pass-boot', seat, target: a.picks.seat, text });
  },
  target: (s, seat) => (fx(s).boot === seat ? 1 : 0),
  publicView: s => ({
    fish: Object.fromEntries(s.order.map(id => [id, fx(s).hands[id].length])), deck: fx(s).deck.length,
    boot: fx(s).boot,
  }),
  privateView: (s, seat) => ({ fish: fx(s).hands[seat] }),
  hud: s => [{ kind: 'holder', key: 'old-boot', label: 'Old boot (+1 VP to win)', seat: fx(s).boot,
    icon: 'boot' }],
  badges(s, seat) {
    const n = fx(s).hands[seat].length, boot = fx(s).boot === seat;
    return [
      ...(n ? [{ key: 'fish', icon: 'fish', value: n, label: 'Fish tokens' }] : []),
      ...(boot ? [{ key: 'boot', icon: 'boot', value: 1, label: 'Old boot: needs 1 more VP' }] : []),
    ];
  },
};
