/**
 * Fixtures on the wire: a room around a hand-built island view, for the previews and UI tests. `islands`
 * above one makes it an archipelago whose other islands are copies with shuffled scores, enough to fill
 * the rail and the room standings at any size.
 */
import type { PrivateView, PublicView } from '../../src/model';
import {
  adoptView, encodeBoard, ISLAND_NAMES, type IslandCard, type IslandWire, type LeagueResults, type RoomView,
  type SeatView,
} from '../../src/wire';

const NAMES = ['Ana', 'Bo', 'Cy', 'Di', 'Eli', 'Flo', 'Gus', 'Hana', 'Ira', 'Jo', 'Kit', 'Lu', 'Mo', 'Nia', 'Oz', 'Pia'];

export function wireOf(pub: PublicView, index = 0): IslandWire {
  const { mapRev, board, settings: _settings, ...rest } = pub;
  const wire: IslandWire = { ...rest, index, rev: mapRev, board: encodeBoard(board) };
  adoptView(wire, pub);
  return wire;
}

const cardOf = (pub: PublicView, index: number): IslandCard => ({
  name: ISLAND_NAMES[index], phase: pub.turn.stage === 'setup' ? 'setup' : pub.results ? 'over' : 'play',
  seats: pub.seats.map(s => [index ? `${s.id}-${index}` : s.id,
    index ? `${NAMES[(index * 3 + s.seat) % NAMES.length]} Longname${index}${s.seat}`.slice(0, 16) : s.name, s.seat, s.cpu && !index]),
  vp: pub.seats.map((s, i) => (index ? Math.max(2, (s.vp + index * 3 + i * 5) % (pub.settings.targetPoints - 1))
    : pub.results?.standings.find(r => r.seat === s.id)?.vp ?? s.vp)),
  flags: pub.seats.map((s, i) => (index ? (index + i) % 3 === 0 ? 0 : 1 : s.ready ? 1 : 0)),
});

export function roomOf(pub: PublicView, o: { islands?: number; featured?: number; horn?: boolean } = {}): RoomView {
  const count = o.islands ?? 1, shared = count > 1, featured = o.featured ?? 0;
  const islands = Array.from({ length: count }, (_, i) => cardOf(pub, i));
  const over = pub.turn.stage === 'finale' || pub.turn.stage === 'ended';
  let results: LeagueResults | null = null;
  if (shared && pub.results) {
    const ids = islands.flatMap(c => c.seats.map(([id]) => id));
    results = {
      winners: pub.results.winners, reason: pub.results.reason, rounds: pub.results.rounds, durationMs: pub.results.durationMs,
      finaleAt: pub.results.finaleAt, completeAt: pub.results.completeAt,
      awards: [
        { key: 'harvest', title: 'Harvest Monarch', text: '41 cards from rolls', seats: [ids[1]] },
        { key: 'market', title: 'Market Maven', text: '9 trades with players', seats: [ids[2], ids[5 % ids.length]] },
        { key: 'warden', title: 'Road Warden', text: '9 pieces in one route', seats: [ids[0]] },
      ],
    };
  }
  return {
    rev: pub.mapRev,
    league: {
      settings: pub.settings, shared, islands, featured, island: wireOf(pub, featured),
      phase: pub.turn.stage === 'setup' ? 'setup' : pub.turn.stage === 'ended' ? 'ended' : over ? 'finale' : 'play',
      round: pub.turn.round, rollAt: null,
      dice: shared && pub.lastRoll ? { at: pub.lastRoll.at, round: pub.turn.round, rolls: [pub.lastRoll.dice] } : null,
      hornAt: o.horn ? pub.lastRoll?.at ?? 1 : null, results,
    },
  };
}

export const seatOf = (pub: PublicView, me: PrivateView | null, shared = false, home = 0): SeatView | null =>
  (me ? { rev: pub.mapRev, home, me, ...(shared ? { island: wireOf(pub, home) } : {}) } : null);
