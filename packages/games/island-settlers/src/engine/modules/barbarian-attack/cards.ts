/**
 * The Barbarian Attack development deck (bought and played at once, reshuffled when empty) and the
 * decisions it and the 7 open: place a knight, capture a barbarian, Treason (2 gold, move two
 * barbarians), and the 7's steal from a player of the roller's choice (there is no robber).
 * Options are ordered best-first so the auto answer and the generic CPU pick sensibly.
 */
import type { Choice, Command, EdgeId, SeatId, TileId } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { total } from '../../cards';
import { choice, command, pickField } from '../../commands';
import { emit } from '../../events';
import { face } from '../../legal';
import { need } from '../../need';
import { openPrompt, steal } from '../../prompts';
import { shuffle } from '../../rng';
import { publicVp } from '../../stats';
import { random, seatName, type Json, type OpenPrompt, type State } from '../../state';
import { addGold, firstAnswer } from '../deliveries/gold';
import type { PromptSpec } from '../registry';
import {
  ba, conquered, facts, invaded, invaders, onBoard, setInvaders, stake, supply, type DefenseCard,
} from './coast';
import { guards, guardsLeft, placeGuard } from './guards';

export const defenseDeck = (): DefenseCard[] => [
  ...Array<DefenseCard>(14).fill('knighthood'), ...Array<DefenseCard>(4).fill('swift-knight'),
  ...Array<DefenseCard>(4).fill('capture'), ...Array<DefenseCard>(4).fill('treason'),
];
const LABEL: Record<DefenseCard, string> = {
  knighthood: 'Knighthood', 'swift-knight': 'Swift Knight', capture: 'Capture', treason: 'Treason',
};

const note = (s: State, seat: SeatId, text: string) =>
  emit(s, { kind: 'module', module: 'barbarian-attack', name: 'card', seat, target: null, text });

/** What the others lose minus what `seat` loses when `tile` holds one more barbarian (or one less). */
function harm(s: State, seat: SeatId, tile: TileId) {
  const others = s.order.filter(id => id !== seat)
    .reduce((n, id) => n + stake(s, id, tile) * (1 + publicVp(s, id) / 10), 0);
  return others - 3 * stake(s, seat, tile) + invaders(s, tile);
}
const ranked = (tiles: TileId[], value: (t: TileId) => number) =>
  [...tiles].sort((a, b) => value(b) - value(a));
const tileChoice = (s: State, t: TileId) =>
  choice(t, `The ${face(s, t).number}`, `${invaders(s, t)} barbarians`);

/** Empty edges for a new knight: castle edges (Knighthood) or any home edge near the invaders (Swift). */
export function knightSpots(s: State, seat: SeatId, swift: boolean): EdgeId[] {
  if (guardsLeft(s, seat) <= 0) return [];
  const taken = new Set(guards(s).map(g => g.at)), f = facts(s);
  const pool = swift ? [...f.walk] : f.castleEdges;
  const near = (e: EdgeId) => (boardIndex(s.board).edge.get(e)?.tiles ?? [])
    .reduce((n, t) => n + invaders(s, t) * 3 + (invaders(s, t) ? stake(s, seat, t) : 0), 0);
  return pool.filter(e => !taken.has(e)).sort((a, b) => near(b) - near(a));
}

const fromOptions = (s: State, used: TileId[]): Choice[] => {
  const tiles = invaded(s).filter(t => !used.includes(t)).map(t => tileChoice(s, t));
  return tiles.length ? tiles : supply(s) > 0 ? [choice('supply', 'From the supply')] : [];
};
const toOptions = (s: State, seat: SeatId, used: TileId[]) =>
  ranked(facts(s).coast.filter(t => !used.includes(t) && !conquered(s, t)), t => harm(s, seat, t));

/** Draw (reshuffling as needed; a Capture with no barbarians is replaced) and play the card at once. */
export function drawDefense(s: State, seat: SeatId) {
  const x = ba(s), rnd = random(s, 'cards');
  let card: DefenseCard = 'knighthood';
  for (let i = 0; i < 60; i++) {
    if (!x.deck.length) [x.deck, x.discard] = [shuffle(x.discard, rnd), []];
    card = x.deck.pop()!;
    x.discard.push(card);
    if (card !== 'capture' || onBoard(s) > 0) break;
  }
  note(s, seat, `${seatName(s, seat)} played ${LABEL[card]}`);
  if (card === 'treason') addGold(s, seat, 2);
  const swift = card === 'swift-knight', [kind, data, open]: [string, Json, boolean] = card === 'capture'
    ? ['capture', null, onBoard(s) > 0]
    : card === 'treason' ? ['treason', [], fromOptions(s, []).length > 0 && toOptions(s, seat, []).length > 1]
      : ['knight', swift, knightSpots(s, seat, swift).length > 0];
  if (open) openPrompt(s, { seat, kind: `barbarian-attack/${kind}`, scope: 'self', data });
  else note(s, seat, `${LABEL[card]} had no effect`);
}

const cmd = (p: OpenPrompt, label: string, detail: string, fields: Command['fields']) =>
  command({ id: p.id, module: 'barbarian-attack', group: 'barbarians', label, detail, fields, hint: 0.8 });


const knight: PromptSpec = {
  timer: 'prompt', autoText: 'Places the knight near the invaders', label: 'Placing a knight',
  command: (s, p) => cmd(p, 'Place your knight', p.data ? 'Any empty edge' : 'An empty castle edge',
    [pickField('edge', 'Edge', knightSpots(s, p.seat, !!p.data).map(e => choice(e, 'Edge')), 'edge')]),
  apply: (s, p, a) => placeGuard(s, p.seat, a.picks.edge, true),
  auto: (s, p) => firstAnswer(knight)(s, p),
};

const capture: PromptSpec = {
  timer: 'prompt', autoText: 'Captures the barbarian that hurts you most', label: 'Capturing',
  command: (s, p) => cmd(p, 'Capture a barbarian', 'It becomes your prisoner.', [pickField('tile', 'Hex',
    ranked(invaded(s), t => 3 * stake(s, p.seat, t) + invaders(s, t)).map(t => tileChoice(s, t)), 'tile')]),
  apply(s, p, a) {
    setInvaders(s, a.picks.tile, invaders(s, a.picks.tile) - 1);
    ba(s).prisoners[p.seat]++;
    note(s, p.seat, `${seatName(s, p.seat)} captured a barbarian`);
  },
  auto: (s, p) => firstAnswer(capture)(s, p),
};

/**
 * Treason, one pick per prompt: data lists the hexes used so far (from, to, from, to), so sources
 * and destinations stay distinct. The move happens when its destination is chosen.
 */
const treason: PromptSpec = {
  timer: 'prompt', autoText: 'Moves barbarians away from your buildings', label: 'Treason',
  command(s, p) {
    const used = p.data as TileId[], n = Math.floor(used.length / 2) + 1, mine = (c: Choice) =>
      (c.value === 'supply' ? -99 : -harm(s, p.seat, c.value));
    const field = used.length % 2 === 0
      ? pickField('tile', 'From', fromOptions(s, used).sort((a, b) => mine(b) - mine(a)), 'tile')
      : pickField('tile', 'To', toOptions(s, p.seat, used).map(t => tileChoice(s, t)), 'tile');
    return cmd(p, `Treason: barbarian ${n} of 2, ${field.label.toLowerCase()}`,
      'From one coastal hex to another unconquered one.', [field]);
  },
  apply(s, p, a) {
    const used = [...(p.data as TileId[]), a.picks.tile], from = used.at(-2)!, to = a.picks.tile;
    if (used.length % 2 === 0) {
      if (from !== 'supply') setInvaders(s, from, invaders(s, from) - 1);
      setInvaders(s, to, invaders(s, to) + 1);
      note(s, p.seat, `${seatName(s, p.seat)} moved a barbarian to the ${face(s, to).number}`);
    }
    const more = used.length % 2 ? toOptions(s, p.seat, used).length : fromOptions(s, used).length;
    if (used.length < 4 && more && toOptions(s, p.seat, used).length) {
      openPrompt(s, { seat: p.seat, kind: 'barbarian-attack/treason', scope: 'self', data: used });
    }
  },
  auto: (s, p) => firstAnswer(treason)(s, p),
};

/** The 7 (no robber): the roller robs one player of their choice. */
const robbable = (s: State, seat: SeatId) => s.order.filter(id => id !== seat && total(s.seats[id].hand) > 0)
  .sort((a, b) => publicVp(s, b) - publicVp(s, a) || total(s.seats[b].hand) - total(s.seats[a].hand));

export const openSteal = (s: State, seat: SeatId) => {
  if (robbable(s, seat).length) openPrompt(s, { seat, kind: 'barbarian-attack/steal', scope: 'table' });
};

const robber: PromptSpec = {
  timer: 'robber', autoText: 'Robs the leader', label: 'Choosing whom to rob',
  command: (s, p) => cmd(p, 'Rob a player', 'Rolled 7: steal 1 random card', [pickField('victim',
    'Player to rob', robbable(s, p.seat).map(id => choice(id, seatName(s, id))), 'seat')]),
  apply(s, p, a) {
    need(robbable(s, p.seat).includes(a.picks.victim), 'Pick a player with cards.');
    steal(s, p.seat, a.picks.victim);
  },
  auto: (s, p) => firstAnswer(robber)(s, p),
};

export const PROMPTS: Record<string, PromptSpec> = { knight, capture, treason, steal: robber };
