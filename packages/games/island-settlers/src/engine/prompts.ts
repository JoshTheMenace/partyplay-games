/**
 * Prompt life cycle (open, answer, close) and the core prompt specs: discard, robber, gold.
 * Many prompts may be open at once, at most one per seat per kind. `data.count` (a number) is the
 * public chip count (cards to discard, picks owed).
 */
import { pips } from '../geometry';
import {
  GOODS, RESOURCES, type CardPicks, type Cards, type CorePromptKind, type Good, type Picks,
  type PromptKind, type SeatId, type TileId,
} from '../model';
import { resourceTotal, toCards, total, transfer } from './cards';
import { baseDeadline, capped } from './clock';
import { choice, cardsField, command, pickField, validateAnswer } from './commands';
import { emit, inbox } from './events';
import { robberTiles, victims } from './legal';
import { hooks, modulePrompt, type Answer, type PromptSpec } from './modules/registry';
import { need } from './need';
import { setPirate, setRobber } from './pieces';
import { int } from './rng';
import { bump, gained, publicVp } from './stats';
import { nextId, random, seatName, type Json, type OpenPrompt, type State } from './state';
import { boardIndex } from './board/lookup';

type Piece = 'robber' | 'pirate';

export function countOf(p: OpenPrompt): number | null {
  const data = p.data, record = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return typeof record.count === 'number' ? record.count : null;
}

export function promptSpec(s: State, kind: PromptKind): PromptSpec {
  const spec = CORE[kind as CorePromptKind] ?? modulePrompt(s, kind);
  need(spec, 'That decision is not available.');
  return spec;
}

export function openPrompt(
  s: State, p: { seat: SeatId; kind: PromptKind; scope: 'table' | 'self'; data?: Json },
): OpenPrompt {
  const open = Object.values(s.prompts).some(o => o.seat === p.seat && o.kind === p.kind);
  need(!open, 'That decision is already open.');
  const base = baseDeadline(s, promptSpec(s, p.kind).timer);
  const prompt: OpenPrompt = {
    id: nextId(s, 'q'), seat: p.seat, kind: p.kind, scope: p.scope, openedAt: s.now,
    base, deadline: capped(s, p.seat, base), turnId: s.turn.id, data: p.data ?? null,
  };
  s.prompts[prompt.id] = prompt;
  return prompt;
}

export const seatPrompts = (s: State, seat: SeatId) => Object.values(s.prompts).filter(p => p.seat === seat);
export const tablePromptOpen = (s: State) => Object.values(s.prompts).some(p => p.scope === 'table');

/** Close a prompt. A `self` prompt (a Knight's robber) paused its owner's step clock: give that time back. */
export function closePrompt(s: State, p: OpenPrompt) {
  delete s.prompts[p.id];
  const timer = s.timers[p.seat], paused = s.now - p.openedAt;
  if (p.scope !== 'self' || !timer || timer.base === null || paused <= 0) return;
  timer.base += paused;
  timer.deadline = capped(s, p.seat, timer.base);
}

/** Validate and apply an answer (the prompt closes before `apply`, so it may open follow-ups). */
export function answerPrompt(s: State, seat: SeatId, id: string, picks: Picks, cards: CardPicks) {
  const p = s.prompts[id];
  need(p && p.seat === seat, 'That decision is no longer open.');
  const spec = promptSpec(s, p.kind);
  const answer = validateAnswer(spec.command(s, p), picks, cards);
  closePrompt(s, p);
  spec.apply(s, p, answer);
}

export const discardLimit = (s: State, seat: SeatId) =>
  hooks(s, 'discardLimit').reduce((n, m) => n + m.discardLimit(s, seat), 7);

/** Uniform random card from the victim (rng.cards); the public event hides the good. */
export function steal(s: State, thief: SeatId, victim: SeatId): Good | null {
  const hand = s.seats[victim].hand;
  let k = int(random(s, 'cards'), total(hand));
  const good = GOODS.find(g => (k -= hand[g]) < 0);
  if (!good) return null;
  transfer(hand, s.seats[thief].hand, { [good]: 1 });
  const [by, from] = [seatName(s, thief), seatName(s, victim)], cards = { [good]: 1 };
  emit(s, { kind: 'steal', seat: thief, victim, count: 1, text: `${by} stole from ${from}` });
  inbox(s, thief, { text: `You stole 1 ${good} from ${from}`, cards, tone: 'gain', other: victim });
  inbox(s, victim, { text: `${by} stole your ${good}`, cards, tone: 'loss', other: thief });
  bump(s, thief, 'stole');
  bump(s, victim, 'robbed');
  return good;
}

// ---------------------------------------------------------------- robber / pirate

/** C&K: the robber and pirate stay out of play until the first barbarian attack (then they may enter). */
export const robberHeld = (s: State) => s.profile.robberWaitsForFirstAttack
  && !(s.ext['cities-knights'] as { attacks: number } | undefined)?.attacks;

/** Pieces this seat could move now, each with its legal hexes. */
export function robberOptions(s: State, seat: SeatId): { piece: Piece; tiles: TileId[] }[] {
  const pieces: Piece[] = [];
  // Off the board (null) still enters play, unless it is held for the first C&K attack.
  const held = robberHeld(s);
  if (s.profile.robber && (s.pieces.robber || !held)) pieces.push('robber');
  if (s.profile.pirate && (s.pieces.pirate || !held)) pieces.push('pirate');
  return pieces.map(piece => ({ piece, tiles: robberTiles(s, seat, piece) })).filter(o => o.tiles.length);
}

/** Opens the robber prompt, or does nothing when no piece has a legal hex. */
export function openRobber(s: State, seat: SeatId, scope: 'table' | 'self') {
  if (robberOptions(s, seat).length) openPrompt(s, { seat, kind: 'robber', scope });
}

function robberCommand(s: State, p: OpenPrompt) {
  const tileField = (piece: Piece, tiles: TileId[]) => pickField('tile', 'Hex', tiles.map(tile => {
    const who = victims(s, p.seat, tile, piece);
    const pick = pickField('victim', 'Player to rob', who.map(v => choice(v, seatName(s, v))), 'seat');
    const detail = who.length ? `Rob ${who.map(v => seatName(s, v)).join(' or ')}` : 'Nobody to rob';
    return choice(tile, tile, detail, who.length > 1 ? [pick] : []);
  }), 'tile');
  const options = robberOptions(s, p.seat);
  const label = (piece: Piece) => (piece === 'robber' ? 'Robber' : 'Pirate');
  const fields = options.length === 1 ? [tileField(options[0].piece, options[0].tiles)]
    : [pickField('piece', 'Piece',
      options.map(o => choice(o.piece, label(o.piece), '', [tileField(o.piece, o.tiles)])))];
  const detail = 'Pick a hex and a player to rob';
  return command({ id: p.id, module: 'core', group: 'cards', label: 'Move the robber', detail, fields });
}

function applyRobber(s: State, p: OpenPrompt, a: Answer) {
  const piece = (a.picks.piece ?? robberOptions(s, p.seat)[0]?.piece) as Piece, tile = a.picks.tile;
  const who = victims(s, p.seat, tile, piece), victim = a.picks.victim ?? (who.length === 1 ? who[0] : null);
  const from = piece === 'robber' ? s.pieces.robber : s.pieces.pirate;
  (piece === 'robber' ? setRobber : setPirate)(s, tile);
  const text = `${seatName(s, p.seat)} moved the ${piece}`;
  emit(s, { kind: 'robber', seat: p.seat, piece, from, tile, victim, text });
  if (victim) steal(s, p.seat, victim);
}

/** Leader-aware choice: hurt the points leader most without touching the mover; rob the leader. */
function autoRobber(s: State, p: OpenPrompt): Answer {
  const others = s.order.filter(id => id !== p.seat);
  const score = new Map(others.map(id => [id, publicVp(s, id) * 100 + total(s.seats[id].hand)]));
  const leader = others.reduce((a, b) => (score.get(b)! > score.get(a)! ? b : a), others[0]);
  const index = boardIndex(s.board);
  let best: { piece: Piece; tile: TileId; value: number } | null = null;
  for (const { piece, tiles } of robberOptions(s, p.seat)) for (const tile of tiles) {
    const owners = (index.tileVertices.get(tile) ?? []).map(v => s.pieces.buildings[v]).filter(b => !!b);
    const hit = owners.filter(b => b.seat === leader).reduce((n, b) => n + (b.kind === 'city' ? 2 : 1), 0);
    const cards = victims(s, p.seat, tile, piece).reduce((n, v) => n + total(s.seats[v].hand), 0);
    const mine = owners.some(b => b.seat === p.seat) ? -1e6 : 0;
    const value = mine + hit * pips(index.tile.get(tile)?.number ?? 0) * 1000 + cards;
    if (!best || value > best.value) best = { piece, tile, value };
  }
  if (!best) return { picks: {}, cards: {} };
  const who = victims(s, p.seat, best.tile, best.piece);
  const cards = (id: SeatId) => total(s.seats[id].hand);
  const victim = who.includes(leader) ? leader : who.reduce((a, b) => (cards(b) > cards(a) ? b : a), who[0]);
  const picks: Picks = { tile: best.tile };
  if (robberOptions(s, p.seat).length > 1) picks.piece = best.piece;
  if (who.length > 1) picks.victim = victim;
  return { picks, cards: {} };
}

// ---------------------------------------------------------------- discard / gold choosers

/** Largest piles first (ties in GOODS order). */
export function largestFirst(hand: Cards, count: number): Cards {
  const left = { ...hand }, out: Cards = {};
  for (let i = 0; i < count; i++) {
    const g = GOODS.reduce((a, b) => ((left[b] ?? 0) > (left[a] ?? 0) ? b : a), GOODS[0]);
    if (!left[g]) break;
    left[g]! -= 1;
    out[g] = (out[g] ?? 0) + 1;
  }
  return out;
}

/** Goods the seat holds fewest of, bank permitting. */
export function fewestFirst(hand: Cards, bank: Cards, count: number): Cards {
  const out: Cards = {};
  for (let i = 0; i < count; i++) {
    const open = RESOURCES.filter(g => (bank[g] ?? 0) > (out[g] ?? 0));
    if (!open.length) break;
    const g = open.reduce((a, b) => ((hand[b] ?? 0) + (out[b] ?? 0) < (hand[a] ?? 0) + (out[a] ?? 0) ? b : a));
    out[g] = (out[g] ?? 0) + 1;
  }
  return out;
}

/** Gold picks still owed, bounded by the bank's resources. */
export const goldCount = (s: State, p: OpenPrompt) => Math.min(countOf(p) ?? 0, resourceTotal(s.bank));

const CORE: Record<CorePromptKind, PromptSpec> = {
  discard: {
    timer: 'discard', autoText: 'Auto-discards biggest piles first', label: 'Discarding',
    command: (s, p) => command({
      id: p.id, module: 'core', group: 'cards', label: `Discard ${countOf(p)}`,
      detail: 'Rolled 7: discard half your cards',
      fields: [cardsField('cards', 'Discard', 'hand', s.seats[p.seat].hand, countOf(p) ?? 0, countOf(p) ?? 0,
        s.profile.commodities ? GOODS : RESOURCES)],
    }),
    apply(s, p, a) {
      const cards = a.cards.cards, n = total(cards);
      transfer(s.seats[p.seat].hand, s.bank, cards);
      bump(s, p.seat, 'discarded', n);
      emit(s, { kind: 'discard', seat: p.seat, count: n, text: `${seatName(s, p.seat)} discarded ${n}` });
    },
    auto: (s, p) => ({ picks: {}, cards: { cards: largestFirst(s.seats[p.seat].hand, countOf(p) ?? 0) } }),
  },
  robber: {
    timer: 'robber', autoText: "Picks the leader's best hex", label: 'Moving the robber',
    command: robberCommand, apply: applyRobber, auto: autoRobber,
  },
  gold: {
    timer: 'prompt', autoText: 'Takes what you hold fewest of', label: 'Choosing gold',
    command: (s, p) => command({
      id: p.id, module: 'core', group: 'cards', label: `Pick ${goldCount(s, p)} from the bank`,
      detail: 'Gold field',
      fields: [cardsField('cards', 'Gold', 'bank', toCards(s.bank), goldCount(s, p), goldCount(s, p), RESOURCES)],
    }),
    apply(s, p, a) {
      const cards = a.cards.cards;
      transfer(s.bank, s.seats[p.seat].hand, cards);
      gained(s, p.seat, cards);
      const text = `${seatName(s, p.seat)} took ${total(cards)} from gold`;
      emit(s, { kind: 'take', seat: p.seat, cards, text });
    },
    auto: (s, p) => ({ picks: {}, cards: { cards: fewestFirst(s.seats[p.seat].hand, s.bank, goldCount(s, p)) } }),
  },
};
