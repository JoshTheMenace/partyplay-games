/** The archipelago on a phone: one line above the header with your island, the round and your place in the room. */
import { createContext, useContext } from 'react';
import type { SeatId } from '../../model';
import { roomRanks, type LeagueView } from '../../wire';
import { EmblemChip } from '../shared/SeatChip';

/** Null with one island. */
export const LeagueContext = createContext<{ league: LeagueView; home: number } | null>(null);

/**
 * Something to read while the room finishes its round: the leaders, your own row and how many are done.
 * Shown only on a phone that is waiting.
 */
export function RoomBoard({ seat }: { seat: SeatId }) {
  const ctx = useContext(LeagueContext);
  if (!ctx) return null;
  const { league, home } = ctx, ranks = roomRanks(league), mine = ranks.find(r => r.id === seat);
  const top = ranks.slice(0, 5), rows = mine && !top.includes(mine) ? [...top.slice(0, 4), mine] : top;
  const done = league.islands.flatMap(c => c.flags).filter(f => f > 0).length;
  return <section className="island-settlers-room" aria-label="The room">
    <h3>The room <small>{league.phase === 'play' ? `${done} of ${ranks.length} done` : `first to ${league.settings.targetPoints}`}</small></h3>
    <ol>{rows.map(r => <li key={r.id} data-you={r.id === seat || undefined} data-home={r.island === home || undefined}>
      <span className="kp-numeral">{r.rank}</span>
      <EmblemChip index={r.seat} size="22px"/>
      <b>{r.id === seat ? 'You' : r.name}</b>
      <small>{league.islands[r.island].name}</small>
      <em className="kp-numeral">{r.vp}</em>
    </li>)}</ol>
  </section>;
}

export function LeagueStrip({ seat, now }: { seat: SeatId; now(): number }) {
  const ctx = useContext(LeagueContext);
  if (!ctx) return null;
  const { league, home } = ctx, ranks = roomRanks(league), mine = ranks.find(r => r.id === seat);
  const horn = league.hornAt !== null && league.phase === 'play' && !league.results;
  const state = league.phase === 'setup' ? 'Settling in' : league.results ? 'Final' : `Round ${league.round}`;
  return <p className="island-settlers-league-strip" data-horn={horn || undefined} data-now={now() > 0 || undefined}>
    <b>{league.islands[home]?.name}</b>
    <span>{horn ? 'Horn! Last moves' : state}</span>
    {mine && <em>#{mine.rank} of {ranks.length}</em>}
  </p>;
}
