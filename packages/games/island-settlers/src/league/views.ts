/**
 * The league on the wire (server-only): the shared room view with the island the TV features, and each
 * seat's own island and private view. Formats and the reasons for them are in ../wire.ts.
 */
import type { GameEvent, PrivateView, SeatId } from '../model';
import {
  encodeBoard, FULL_TIMES, type BoardWire, type IslandCard, type IslandWire, type LeaguePhase, type LeagueResults,
  type LeagueView, type RoomView, type SeatView,
} from '../wire';
import { privateView, publicView } from '../engine/index';
import type { State } from '../engine/state';
import { seatName, type League } from './index';

/** Events an island carries on the wire: every animation and the ticker need only the newest few. */
const EVENTS = { one: 24, shared: 16, over: 8 } as const;
/** The rail of island cards refreshes this often (at once when an island's phase changes). */
const CARDS_MS = 2000;
/**
 * In an archipelago a shared view and a full seat view that together pass this many bytes go out in two
 * snapshots, not one: the platform's 32 KiB, less the envelope, room for multi-byte names and the few kB a
 * private view can grow between two sends (it is weighed by its last one)...
 */
const MESSAGE_BYTES = 26_000;
/** ...unless the shared view keeps changing: a full seat view waits this many snapshots at most. */
const HOLD_TIMES = 5;

const boards = new WeakMap<State, BoardWire>();
const sizes = new WeakMap<IslandWire, number>();
const wires = new WeakMap<State, { rev: number; key: string; wire: IslandWire }>();

const over = (s: State) => s.turn.stage === 'finale' || s.turn.stage === 'ended';
const waiting = (s: State) => s.turn.stage === 'roll' && !s.queue.length && !Object.keys(s.prompts).length;

function phaseOf(l: League): LeaguePhase {
  const all = l.islands;
  if (all.some(over)) return all.every(s => s.turn.stage === 'ended') ? 'ended' : 'finale';
  if (all.some(s => s.turn.stage === 'setup')) return 'setup';
  return l.shared && all.every(waiting) ? 'roll' : 'play';
}

/** The league's own headline where an island's would mislead: waiting on other islands, and the room's winner. */
function headline(l: League, s: State, phase: LeaguePhase) {
  if (l.results) {
    const here = l.results.winners.filter(id => s.seats[id]), names = l.results.winners.map(id => seatName(l, id));
    const who = names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ');
    const title = `${who} ${names.length > 1 ? 'win' : 'wins'} the archipelago!`;
    return { seats: here, title, detail: phase === 'finale' ? 'Revealing hidden points' : 'Final scores' };
  }
  if (phase === 'setup' && waiting(s)) {
    const left = l.islands.filter(x => x.turn.stage === 'setup').length;
    return { seats: [], title: 'All set', detail: `Waiting for ${left} more ${left > 1 ? 'islands' : 'island'} to finish placing` };
  }
  return null;
}

/** One island's public view for the wire; rebuilt only when the island or the league's headline changes. */
export function islandWire(l: League, i: number): IslandWire {
  const s = l.islands[i], phase = phaseOf(l), now = l.shared ? headline(l, s, phase) : null;
  const key = now ? `${now.title}|${now.detail}` : '', hit = wires.get(s);
  if (hit && hit.rev === s.rev && hit.key === key) return hit.wire;
  const { mapRev: _rev, board: _board, settings: _settings, ...rest } = publicView(s);
  const board = boards.get(s) ?? boards.set(s, encodeBoard(s.board)).get(s)!;
  // The room rolled, not this island's captain.
  const shared = (e: GameEvent): GameEvent => (e.kind === 'roll' ? { ...e, seat: null } : e);
  const events = rest.events.slice(-(s.results ? EVENTS.over : l.shared ? EVENTS.shared : EVENTS.one));
  const wire: IslandWire = l.shared ? {
    ...rest, index: i, rev: s.rev, board, events: events.map(shared),
    lastRoll: rest.lastRoll && { ...rest.lastRoll, seat: null }, ...(now ? { now } : {}),
  } : { ...rest, index: i, rev: s.rev, board, events };
  wires.set(s, { rev: s.rev, key, wire });
  return wire;
}

function card(l: League, i: number): IslandCard {
  const s = l.islands[i], pub = publicView(s), final = new Map(s.results?.standings.map(r => [r.seat, r.vp]) ?? []);
  const phase = s.turn.stage === 'setup' ? 'setup' : over(s) ? 'over' : s.turn.closed ? 'done'
    : s.turn.stage === 'round' || s.turn.stage === 'main' || s.turn.stage === 'paired' ? 'play' : waiting(s) ? 'roll' : 'busy';
  return {
    name: l.names[i], phase, seats: pub.seats.map(p => [p.id, p.name, p.seat, p.cpu]),
    vp: pub.seats.map(p => final.get(p.id) ?? p.vp),
    flags: pub.seats.map(p => (!p.connected ? 2 : p.ready && s.turn.stage === 'round' ? 1 : 0)),
  };
}

/** The standings stay behind: the cards already carry every seat's final total. */
function wireResults(l: League): LeagueResults | null {
  if (!l.results) return null;
  const { standings: _standings, ...results } = l.results;
  return results;
}

/**
 * Run at the end of every entry into the rules: stamps the islands that changed (for the seat views) and
 * bumps the shared revision exactly when the shared JSON changed, so no path can forget to.
 */
export function sync(l: League, now: number) {
  const phase = phaseOf(l);
  l.islands.forEach((s, i) => {
    const text = l.shared ? headline(l, s, phase) : null, key = `${s.rev}|${text?.title}|${text?.detail}`;
    if (key !== l.keys[i]) { l.keys[i] = key; l.revs[i]++; }
  });
  // An archipelago's shared view is final from the finale on (results, final totals, the champion's island),
  // so the results frame, which carries the outcome for every seat, does not carry the room again.
  if (l.shared && phase === 'ended' && l.results && l.view) return;
  let cards = l.islands.map((_, i) => card(l, i));
  const old = l.cards as IslandCard[] | null;
  const same = old && old.length === cards.length && old.every((c, i) => c.phase === cards[i].phase);
  if (same && now - l.cardsAt < CARDS_MS && !l.results) cards = old;
  else if (JSON.stringify(cards) !== JSON.stringify(old)) Object.assign(l, { cards, cardsAt: now });
  else cards = old!;
  const featured = l.shared ? l.director.island : 0;
  const view: LeagueView = {
    settings: l.settings, shared: l.shared, islands: cards, featured, island: islandWire(l, featured), phase,
    round: l.islands[0].turn.round, rollAt: l.rollAt, dice: l.dice,
    hornAt: l.hornAt, results: wireResults(l),
  };
  const sig = JSON.stringify(view);
  if (sig === l.sig) return;
  Object.assign(l, { sig, view, rev: l.rev + 1 });
}

export const roomView = (l: League): RoomView => ({ rev: l.rev, league: l.view as LeagueView });

/** The room's verdict on the phone: place in the room and on the island. */
function verdict(l: League, id: SeatId, me: PrivateView): PrivateView {
  const row = l.results?.standings.find(r => r.seat === id);
  if (!row || !l.results) return me;
  const title = l.results.winners.includes(id) ? 'You win the archipelago!' : me.task.title;
  const text = `#${row.rank} of ${l.results.standings.length} in the room · #${row.islandRank} on ${l.names[row.island]}`;
  return { ...me, task: { ...me.task, title, text } };
}

/**
 * The platform asks once per seat and snapshot. A changed view goes out whole FULL_TIMES snapshots in a
 * row and as `{rev, home}` after that; `sync` (or a reconnect) starts the count again. In an archipelago,
 * when the shared view changed in the same snapshot and the two would make one oversized message, the page
 * keeps the revision it holds for a snapshot (HOLD_TIMES at most) and gets the new one whole in the next:
 * its island and its private view travel together, so what it shows stays consistent. With one island the
 * island is the shared copy, so the private view always goes with it.
 */
export function seatView(l: League, id: SeatId): SeatView {
  const home = l.home[id], s = l.islands[home], rev = l.revs[home];
  const sent = l.sent[id] ??= { rev, times: 0, whole: null, shared: -1, held: 0, mine: 0 };
  if (sent.rev !== rev) Object.assign(sent, { rev, times: 0 });
  const moved = sent.shared !== l.rev;
  sent.shared = l.rev;
  if (sent.times >= FULL_TIMES) return { rev, home };
  if (!l.shared) {
    sent.times++;
    return { rev, home, me: privateView(s, id) };
  }
  // Weighed without building anything: the island copy is shared by its four seats and measured once, and a
  // private view is about the size of the last one this seat was sent.
  const island = islandWire(l, home), size = sizes.get(island) ?? sizes.set(island, JSON.stringify(island).length).get(island)!;
  if (moved && sent.whole !== null && sent.held < HOLD_TIMES && l.sig.length + size + sent.mine > MESSAGE_BYTES) {
    sent.held++;
    return { rev: sent.whole, home };
  }
  const me = verdict(l, id, privateView(s, id));
  Object.assign(sent, { times: sent.times + 1, whole: rev, held: 0, mine: sent.times ? sent.mine : JSON.stringify(me).length });
  return { rev, home, me, island };
}
