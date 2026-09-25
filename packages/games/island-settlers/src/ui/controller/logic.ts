/** Pure controller helpers (no React): hints, payout lines, spots, field readiness. */
import type {
  BuildOption, BuildPiece, CardPicks, Cards, CardsField, Command, Field, Offer, PickField, Picks, PrivateView, Prompt,
  PublicView, Purchase, SeatId, TaskKind,
} from '../../model';
import { tileLabel } from '../shared/board';
import { cardTotal, count, goodsIn, goodText, needText, plural } from '../shared/format';

export const PURCHASE_LABEL: Record<Purchase, string> = {
  road: 'Road', ship: 'Ship', settlement: 'Settlement', city: 'City', development: 'Dev card',
};

/** Tasks that own the action bar (your main, paired or Connect turn). */
export const ACTING: readonly TaskKind[] = ['main', 'paired', 'round'];

/** Affordable, in supply and placeable now (a dev card needs no spot). */
export const usable = (o: BuildOption) => !o.why && (o.piece === 'development' || o.targets.length > 0);

/** Free placements owed now: setup pieces and Road Building. */
export const owed = (me: PrivateView) => me.build.filter(o => o.free > 0 && o.targets.length > 0);

/** Build-menu status on the right of a row: "12 spots", "Need 1 ore", "No legal spot". */
export function buildStatus(o: BuildOption, deck: number) {
  // Several missing goods already show on the cost chips; keep the status short.
  const many = o.why?.code === 'cost' && goodsIn(o.missing).length > 1;
  if (many) return `Need ${plural(cardTotal(o.missing), 'card')}`;
  if (o.why) return o.why.text;
  if (o.piece === 'development') return `${deck} in deck`;
  return `${o.free ? 'Free · ' : ''}${plural(o.targets.length, 'spot')}`;
}

/** Waiting-screen chips, closest first: "City ready", "Settlement: need 1 wool", "Dev card ready". */
export function hintChips(me: PrivateView, max = 3): string[] {
  return me.build.filter(o => o.left !== 0 && cardTotal(o.missing) <= 2)
    .sort((a, b) => cardTotal(a.missing) - cardTotal(b.missing))
    .slice(0, max)
    .map(o => {
      const need = needText(o.missing);
      return need ? `${PURCHASE_LABEL[o.piece]}: ${need.toLowerCase()}` : `${PURCHASE_LABEL[o.piece]} ready`;
    });
}

/** Offers that want an answer from this seat, newest first. */
export const incoming = (pub: PublicView, seat: SeatId): Offer[] => pub.offers
  .filter(o => o.from !== seat && ['pending', 'unable', 'accept'].includes(o.responses[seat] ?? ''))
  .sort((a, b) => b.at - a.at);


export type Payout = { tone: 'gain' | 'blocked' | 'seven' | 'none'; text: string; cards: Cards };

/** The last roll from this seat's point of view: "+1 wool from 10", "Nothing from 6: the robber …". */
export function payout(pub: PublicView, seat: SeatId): Payout | null {
  const roll = pub.lastRoll;
  if (!roll) return null;
  const cards: Cards = {};
  for (const g of roll.grants.filter(x => x.seat === seat)) cards[g.good] = count(cards, g.good) + g.amount;
  if (roll.total === 7) return { tone: 'seven', text: 'Rolled 7: nobody produces', cards };
  if (goodsIn(cards).length) {
    return { tone: 'gain', text: `${goodsIn(cards).map(g => `+${goodText(count(cards, g), g)}`).join(', ')} `
      + `from ${roll.total}`, cards };
  }
  const blocked = roll.blocked.find(b => b.seat === seat);
  if (blocked) {
    const by = blocked.by === 'robber' ? 'the robber sits on' : 'barbarians hold';
    const text = `Nothing from ${roll.total}: ${by} your ${tileLabel(pub, blocked.tile)}`;
    return { tone: 'blocked', text, cards };
  }
  return { tone: 'none', text: `No payout from ${roll.total}`, cards };
}

// ---------------------------------------------------------------- command fields

/** Pick fields answered by tapping the map. */
export const onMap = (f: Field) => f.kind === 'pick' && ['tile', 'vertex', 'edge', 'unit'].includes(f.target ?? '');

/** Fields in order, each chosen option's `then` fields right after it. */
export function activeFields(fields: Field[], picks: Picks): Field[] {
  return fields.flatMap(f => {
    if (f.kind !== 'pick') return [f];
    const choice = f.options.find(o => o.value === picks[f.key]);
    return [f, ...activeFields(choice?.then ?? [], picks)];
  });
}

/** Robber screen fields: leading choices (robber or pirate), then the hex field, top level or under the piece. */
export function robberFields(fields: Field[], picks: Picks) {
  const isHex = (f: Field): f is PickField => f.kind === 'pick' && f.target === 'tile';
  const lead = fields.filter((f): f is PickField => f.kind === 'pick' && !isHex(f));
  return { lead, hexes: activeFields(fields, picks).find(isHex) };
}

export function cardsOk(cards: Cards, f: CardsField) {
  const n = cardTotal(cards);
  return n >= f.min && n <= f.max
    && goodsIn(cards).every(g => f.allowed.includes(g) && count(cards, g) <= count(f.available, g));
}

export const picked = (f: Field, picks: Picks) =>
  f.kind === 'pick' && f.options.some(o => o.value === picks[f.key]);

/** Every active field answered (optional picks may stay empty). */
export const fieldsReady = (fields: Field[], picks: Picks, cards: CardPicks) => activeFields(fields, picks)
  .every(f => (f.kind === 'pick' ? f.optional || picked(f, picks) : cardsOk(cards[f.key] ?? {}, f)));

/** The answer for the active fields only, so stale dependent picks are never sent. */
export function answerOf(fields: Field[], picks: Picks, cards: CardPicks) {
  const active = activeFields(fields, picks);
  return {
    picks: Object.fromEntries(active.filter(f => picked(f, picks)).map(f => [f.key, picks[f.key]])),
    cards: Object.fromEntries(active.filter(f => f.kind === 'cards').map(f => [f.key, cards[f.key] ?? {}])),
  };
}

/** "Discard 4 more" → "Ready: discard 4"; ranges read "2 chosen · pick 1–3". */
export function counterText(n: number, f: CardsField, verb: string) {
  if (f.min === f.max) return n < f.min ? `${verb} ${f.min - n} more` : `Ready: ${verb.toLowerCase()} ${n}`;
  return `${n} chosen · ${verb.toLowerCase()} ${f.min}–${f.max}`;
}

// ---------------------------------------------------------------- screen routing

type Screen = { tab: string; place: string | null; command: string | null; skipFree: boolean };
export type View =
  | { view: 'finale' | 'move' | 'trade' | 'cards' | 'build' | 'roll' | 'now' | 'wait' }
  | { view: 'robber' | 'prompt'; prompt: Prompt }
  | { view: 'setup' | 'place' | 'free'; piece: BuildPiece }
  | { view: 'command'; command: Command };

/** Views that bring their own confirm bar, so the action bar steps aside. */
export const FOCUSED = new Set<View['view']>(['setup', 'place', 'free', 'move', 'command']);

/** The task-area screen (EXPERIENCE §4.2): private duties first, then placement, then the pressed tab. */
export function route(me: PrivateView, screen: Screen): View {
  const kind = me.task.kind;
  const prompt = me.prompts.find(p => p.id === me.task.prompt) ?? (kind === 'prompt' ? me.prompts[0] : null);
  if (kind === 'finale' || kind === 'ended') return { view: 'finale' };
  if (prompt) return { view: prompt.kind === 'robber' ? 'robber' : 'prompt', prompt };
  const free = owed(me) as (BuildOption & { piece: BuildPiece })[];
  const chosen = me.build.find(o => o.piece === screen.place && o.piece !== 'development');
  if (kind === 'setup') {
    // A city step also accepts a settlement; show the piece the header names ("Place a city").
    const named = free.find(o => me.task.title.endsWith(` ${o.piece}`));
    const piece = (free.find(o => o === chosen) ?? named ?? free[0])?.piece;
    return piece ? { view: 'setup', piece } : { view: 'wait' };
  }
  const acting = ACTING.includes(kind), turn = acting || kind === 'roll';
  const command = me.commands.find(c => c.id === screen.command);
  if (turn && command) return { view: 'command', command };
  if (turn && screen.place === 'move' && me.shipMoves.length) return { view: 'move' };
  if (turn && chosen) return { view: 'place', piece: chosen.piece as BuildPiece };
  if (turn && free[0] && !screen.skipFree && screen.tab === 'now') return { view: 'free', piece: free[0].piece };
  if (screen.tab === 'trade' && (acting || kind === 'respond')) return { view: 'trade' };
  if (turn && screen.tab === 'cards') return { view: 'cards' };
  if (acting && screen.tab === 'build') return { view: 'build' };
  return { view: kind === 'roll' ? 'roll' : acting ? 'now' : 'wait' };
}
