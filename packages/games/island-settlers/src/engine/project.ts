/**
 * Projections (ENGINE §17): `publicView` cached per `rev`, `privateView` per (`rev`, seat), computed
 * lazily. Views hold absolute deadlines only and share unchanged objects with the state (commits
 * replace objects rather than mutating them), so they stay cheap and never go stale by time alone.
 */
import {
  PIECE_LIMITS, type BuildPiece, type Clock, type ModulePrivate, type ModulePublic, type Now, type Offer,
  type PrivateView, type PromptChip, type PublicSeat, type PublicView, type RobberChoice, type SeatId,
  type SeatStatus, type Task, type Turn,
} from '../model';
import { toCards, total } from './cards';
import { seatDeadline } from './clock';
import { devCards } from './dev';
import { concurrent, role, type Role } from './flow';
import { buildOptions, shipMoves, targets, victims } from './legal';
import { activeModules, hooks } from './modules/registry';
import { need } from './need';
import {
  countOf, discardLimit, goldCount, promptSpec, robberOptions, seatPrompts, tablePromptOpen,
} from './prompts';
import { scoreParts, target } from './score';
import { vpOf } from './stats';
import { seatName, type State } from './state';
import { offerState, partners, rates, tradeWhy } from './trade';

type Entry = { rev: number; pub: PublicView | null; priv: Map<SeatId, PrivateView> };
const cache = new WeakMap<State, Entry>();

function entry(s: State): Entry {
  let e = cache.get(s);
  if (!e || e.rev !== s.rev) cache.set(s, (e = { rev: s.rev, pub: null, priv: new Map() }));
  return e;
}

export const dropViews = (s: State) => { cache.delete(s); };

export function publicView(s: State): PublicView {
  const e = entry(s);
  return (e.pub ??= buildPublic(s));
}

export function privateView(s: State, id: SeatId): PrivateView {
  need(s.seats[id], 'Unknown seat.');
  const e = entry(s);
  let view = e.priv.get(id);
  if (!view) e.priv.set(id, (view = buildPrivate(s, id)));
  return view;
}

// ---------------------------------------------------------------- banner and task

const names = (s: State, ids: SeatId[]) => ids.map(id => seatName(s, id)).join(', ');
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/** Server-authored banner (EXPERIENCE §3.3); never time-dependent, clients add countdowns. */
function headline(s: State): Now {
  const t = s.turn, a = t.active!, partner = t.partner, who = (id: SeatId | null) => seatName(s, id);
  const say = (seats: SeatId[], title: string, detail = ''): Now => ({ seats, title, detail });
  if (s.results) {
    const w = s.results.winners, title = `${names(s, w)} ${plural(w.length, 'wins', 'win')}!`;
    return say(w, title, t.stage === 'finale' ? 'Revealing hidden points' : 'Final scores');
  }
  const table = Object.values(s.prompts).filter(p => p.scope === 'table');
  if (table.length) {
    const seats = [...new Set(table.map(p => p.seat))], kind = table[0].kind;
    if (kind === 'discard') {
      return say(seats, 'Rolled 7!', `Discarding: ${table.map(p => `${who(p.seat)} (${countOf(p)})`).join(', ')}`);
    }
    if (kind === 'robber') return say(seats, `${who(seats[0])} moves the robber`, 'Pick a hex and a player to rob');
    const gold = `${names(s, seats)} ${plural(seats.length, 'chooses', 'choose')} gold`;
    return say(seats, kind === 'gold' ? gold : 'Waiting on decisions', `Waiting on: ${names(s, seats)}`);
  }
  const offline = t.stage === 'round' ? null : Object.keys(s.timers).find(id => !s.seats[id].connected);
  if (offline) {
    return say([offline], `Waiting for ${who(offline)} to reconnect`, `${who(offline)}'s move auto-plays soon`);
  }
  switch (t.stage) {
    case 'setup': {
      const { piece, round } = t.setup!, pays = round === 2 && piece !== 'road' && piece !== 'ship';
      const detail = pays ? 'Round 2: this one pays out' : `Setup round ${round} of 2`;
      return say([a], `${who(a)} places a ${piece}`, detail);
    }
    case 'roll': {
      const title = s.settings.mode === 'connect' ? `Round ${t.round}: ${who(a)} rolls` : `${who(a)} rolls`;
      return say([a], title, partner ? `${who(partner)} builds next` : '');
    }
    case 'main': {
      const both = !!partner && role(s, partner) === 'paired', open = Object.keys(s.offers).length;
      const offers = open ? `${open} ${plural(open, 'offer', 'offers')} open` : '';
      return say(both ? [a, partner] : [a], `${who(a)} is building and trading`,
        both ? `${who(partner)} builds too (bank trades only)` : offers);
    }
    case 'paired': return say([partner!], `${who(partner)}'s build turn`, 'Build and trade with the bank only');
    case 'round': {
      const waiting = s.order.filter(id => !s.seats[id].ready), done = s.order.length - waiting.length;
      return say(waiting, `Round ${t.round}: everyone plays`, `${done} of ${s.order.length} done`);
    }
    default: return say([], 'Game over');
  }
}

/** [title, text, auto copy] per step duty. */
const DUTY: Record<Role, [string, string, string]> = {
  setup: ['Place your piece', 'Tap a glowing spot', 'Places the best spot for you'],
  roll: ['Roll the dice', 'Or play a card first', 'Rolls for you'],
  main: ['Your turn', 'Build, trade and play cards', 'Ends your turn'],
  paired: ['Your build turn', 'Build and trade with the bank only', 'Passes your build turn'],
  round: ['Everyone plays', 'Build and trade, then tap Done', 'Marks you done'],
};

/** The one thing this seat should do now; private duties come first. */
function task(s: State, id: SeatId): Task {
  const none = { prompt: null, deadline: null, auto: null };
  if (s.results) {
    const rank = s.results.standings.find(r => r.seat === id)?.rank ?? 0;
    const title = s.results.winners.includes(id) ? 'You win!' : headline(s).title;
    return { kind: s.turn.stage === 'finale' ? 'finale' : 'ended', title, text: `You placed #${rank}`, ...none };
  }
  const q = seatPrompts(s, id).sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity))[0];
  if (q) {
    const spec = promptSpec(s, q.kind), c = spec.command(s, q), auto = q.deadline === null ? null : spec.autoText;
    const title = q.kind === 'discard' ? 'Discard now' : c.label;
    return { kind: 'prompt', title, text: c.detail, prompt: q.id, deadline: q.deadline, auto };
  }
  const r = role(s, id), deadline = s.timers[id]?.deadline ?? null;
  if (r) {
    const [title, text, auto] = DUTY[r];
    const named = r === 'setup' ? `Place a ${s.turn.setup!.piece}` : r === 'round' ? `Round ${s.turn.round}` : title;
    return { kind: r, title: named, text, prompt: null, deadline, auto: deadline === null ? null : auto };
  }
  const offer = Object.values(s.offers).find(o => o.responses[id] === 'pending');
  if (offer) {
    const title = `Answer ${seatName(s, offer.from)}'s offer`;
    const text = 'Accept, decline or counter';
    return { kind: 'respond', title, text, prompt: null, deadline: offer.expires, auto: null };
  }
  const now = headline(s);
  return { kind: 'wait', title: now.title, text: now.detail, ...none };
}

// ---------------------------------------------------------------- public parts

const turnView = ({ id, stage, round, active, partner, next, setup }: State['turn']): Turn =>
  ({ id, stage, round, active, partner, next, setup });

function clockView(s: State): Clock | null {
  const t = s.turn, main = t.stage === 'paired' ? t.partner : t.active;
  const seats = t.stage === 'round' ? s.order.filter(id => !s.seats[id].ready) : main && s.timers[main] ? [main] : [];
  const timers = seats.map(id => s.timers[id]).filter(x => x && x.deadline !== null);
  if (!timers.length) return null;
  const first = timers.reduce((a, b) => (b.deadline! < a.deadline! ? b : a));
  return { step: first.step, seats, startedAt: first.startedAt, deadline: first.deadline! };
}

const STATUS: Record<Role, SeatStatus> = {
  setup: 'placing', roll: 'rolling', main: 'acting', paired: 'paired', round: 'acting',
};

function status(s: State, id: SeatId): SeatStatus {
  const p = s.seats[id], prompt = seatPrompts(s, id)[0], r = role(s, id);
  if (!p.connected) return 'offline';
  if (prompt) return prompt.kind === 'discard' ? 'discarding' : prompt.kind === 'robber' ? 'robbing' : 'choosing';
  if (r) return p.cpu ? 'thinking' : r === 'main' && p.moved ? 'moving' : STATUS[r];
  return p.ready ? 'ready' : 'idle';
}

function publicSeat(s: State, id: SeatId): PublicSeat {
  const p = s.seats[id], parts = scoreParts(s, id);
  const count = (list: Record<string, { seat: SeatId; kind: string }>, kind: string) =>
    Object.values(list).filter(x => x.seat === id && x.kind === kind).length;
  const { routes, buildings } = s.pieces;
  return {
    id, name: p.name, color: p.color, seat: p.seat, cpu: !!p.cpu, persona: p.cpu?.label ?? null,
    connected: p.connected, away: p.away, status: status(s, id), deadline: seatDeadline(s, id),
    vp: vpOf(parts, false), parts: parts.filter(x => !x.hidden), cards: total(p.hand), dev: p.dev.length,
    knights: p.knights, longestRoute: p.longestRoute, discardLimit: discardLimit(s, id),
    left: {
      roads: PIECE_LIMITS.roads - count(routes, 'road'), ships: PIECE_LIMITS.ships - count(routes, 'ship'),
      settlements: PIECE_LIMITS.settlements - count(buildings, 'settlement'),
      cities: PIECE_LIMITS.cities - count(buildings, 'city'),
    },
    badges: hooks(s, 'badges').flatMap(m => m.badges(s, id)), ready: p.ready,
  };
}

/** Offers in post order. Responses stay as stored: whether a seat can pay is private (PrivateView.offers). */
const offersView = (s: State): Offer[] => Object.values(s.offers).sort((a, b) => a.at - b.at);

const chips = (s: State): PromptChip[] => Object.values(s.prompts).map(p => ({
  id: p.id, seat: p.seat, kind: p.kind, label: promptSpec(s, p.kind).label ?? 'Choosing',
  count: p.kind === 'gold' ? goldCount(s, p) : countOf(p), deadline: p.deadline,
}));

const robberChoices = (s: State): RobberChoice[] => Object.values(s.prompts).filter(p => p.kind === 'robber')
  .flatMap(p => robberOptions(s, p.seat).map(({ piece, tiles }) => ({
    seat: p.seat, piece, tiles: tiles.map(tile => ({ tile, victims: victims(s, p.seat, tile, piece) })),
  })));

function intentView(s: State): PublicView['intent'] {
  if (!s.intent) return null;
  const { seat, piece } = s.intent;
  const spots = piece === 'move' ? shipMoves(s, seat).flatMap(m => m.to)
    : piece === 'knight' ? [] : targets(s, seat, piece as BuildPiece);
  return { seat, piece, targets: spots };
}

function buildPublic(s: State): PublicView {
  const ext: Record<string, unknown> = {};
  for (const m of activeModules(s.modules)) if (m.publicView) ext[m.id] = m.publicView(s);
  return {
    mapRev: s.mapRev, board: s.board, pieces: s.pieces, settings: s.settings, modules: s.modules,
    turn: turnView(s.turn), now: headline(s), clock: clockView(s), seats: s.order.map(id => publicSeat(s, id)),
    bank: toCards(s.bank), devDeck: s.devDeck.length, awards: s.awards, offers: offersView(s),
    prompts: chips(s), robberChoices: robberChoices(s), intent: intentView(s), lastRoll: s.lastRoll,
    events: s.events, ext: ext as ModulePublic, hud: hooks(s, 'hud').flatMap(m => m.hud(s)), results: s.results,
  };
}

// ---------------------------------------------------------------- private view

function buildPrivate(s: State, id: SeatId): PrivateView {
  const p = s.seats[id], parts = scoreParts(s, id), r = role(s, id), t = s.turn, why = tradeWhy(s, id);
  const free = !tablePromptOpen(s) && !seatPrompts(s, id).length;
  const owesRoutes = p.freeRoutes > 0 && s.profile.routeKinds.some(k => targets(s, id, k).length);
  const upcoming = t.partner === id && r === null && (t.stage === 'roll' || (t.stage === 'main' && !concurrent(s)));
  const ext: Record<string, unknown> = {};
  for (const m of activeModules(s.modules)) if (m.privateView) ext[m.id] = m.privateView(s, id);
  const prompts = seatPrompts(s, id).map(q => {
    const spec = promptSpec(s, q.kind), { id: pid, kind, scope, deadline } = q;
    return { id: pid, kind, scope, deadline, auto: spec.autoText, command: spec.command(s, q) };
  });
  return {
    seat: id, hand: toCards(p.hand), dev: devCards(s, id), vp: vpOf(parts, true), parts, target: target(s, id),
    rates: rates(s, id), task: task(s, id),
    can: {
      roll: free && r === 'roll' && !owesRoutes, end: free && (r === 'main' || r === 'paired' || r === 'round'),
      bank: why.bank === null, propose: why.propose === null, skipPaired: upcoming,
    },
    why, build: buildOptions(s, id), shipMoves: shipMoves(s, id), offers: offerState(s, id),
    partners: partners(s, id), prompts, commands: hooks(s, 'commands').flatMap(m => m.commands(s, id)),
    inbox: p.inbox, ext: ext as ModulePrivate,
  };
}
