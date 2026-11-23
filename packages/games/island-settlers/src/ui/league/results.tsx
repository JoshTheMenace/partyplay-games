/**
 * Archipelago results: the room's champion, every seat by points in columns that fit sixty-four names on a
 * 720p TV, each island's own winner, and the room awards. Phones get one scrolling list with their row marked.
 */
import type { CSSProperties } from 'react';
import type { Outcome } from '../../../../../party-contract/src/index';
import { roomRanks, type LeagueView } from '../../wire';
import { durationText } from '../results/data';
import { EmblemChip } from '../shared/SeatChip';
import { SEATS } from '../shared/seats';

const seatCss = (seat: number) => ({ '--seat': SEATS[seat % SEATS.length].body }) as CSSProperties;

export function LeagueResults({ league, outcome, playerId }: {
  league: LeagueView; outcome: Outcome; playerId: string | null;
}) {
  const ranks = roomRanks(league), res = league.results, winners = new Set(res?.winners ?? outcome.winners);
  const champions = ranks.filter(r => winners.has(r.id)), you = ranks.find(r => r.id === playerId);
  const byId = new Map(ranks.map(r => [r.id, r]));
  const facts = [
    champions[0] && `${champions[0].vp} VP`, res && durationText(res.durationMs), res && `${res.rounds} rounds`,
    `${league.islands.length} islands`,
  ].filter(Boolean).join(' · ');
  const tie = (rank: number) => (ranks.filter(r => r.rank === rank).length > 1 ? '=' : '#');
  const shared = you && tie(you.rank) === '=';
  // Up to four columns, about eight names to a column before another one opens.
  const columns = Math.min(4, Math.max(1, Math.ceil(ranks.length / 8)));
  return <div className="island-settlers-results island-settlers-league-results" data-seats={ranks.length > 32 ? 'many' : undefined}>
    <header className="island-settlers-results-hero">
      <p className="kp-eyebrow">{res?.reason === 'round-limit' ? 'Round limit reached' : champions.length > 1 ? 'Shared victory' : 'Champion of the archipelago'}</p>
      <div className="island-settlers-results-winners" data-count={champions.length}>
        {champions.length ? champions.slice(0, 4).map(w => <div key={w.id} style={seatCss(w.seat)}>
          <EmblemChip index={w.seat} size="var(--hero-chip)"/>
          <span><h1 className="kp-title">{w.name}</h1><small>of {league.islands[w.island].name}</small></span>
        </div>) : <h1 className="kp-title">Game over</h1>}
      </div>
      <p className="island-settlers-results-facts kp-numeral">{facts}</p>
    </header>
    {you && <p className="island-settlers-league-you" style={seatCss(you.seat)}>
      <b className="kp-numeral">{tie(you.rank)}{you.rank}</b>
      <span>You placed {shared ? 'joint ' : ''}#{you.rank} of {ranks.length} with {you.vp} points, on {league.islands[you.island].name}.</span>
    </p>}
    <section>
      <h2>Room standings</h2>
      <ol className="island-settlers-league-table" style={{ '--columns': columns } as CSSProperties}>
        {ranks.map(r => <li key={r.id} style={seatCss(r.seat)} data-winner={winners.has(r.id) || undefined}
          data-you={r.id === playerId || undefined}>
          <span className="kp-numeral">{tie(r.rank)}{r.rank}</span>
          <EmblemChip index={r.seat} size="1.35em"/>
          <b>{r.name}{r.cpu && <i> CPU</i>}</b>
          <small>{league.islands[r.island].name}</small>
          <em className="kp-numeral">{r.vp}</em>
        </li>)}
      </ol>
    </section>
    <section className="island-settlers-league-extras">
      <div>
        <h2>Island winners</h2>
        <ul className="island-settlers-league-winners">
          {league.islands.map(card => {
            const top = Math.max(...card.vp), best = card.seats.filter((_, k) => card.vp[k] === top);
            return <li key={card.name}><small>{card.name}</small>
              <b>{best.map(([id, name]) => <span key={id} style={seatCss(byId.get(id)?.seat ?? 0)}>{name}</span>)}</b>
              <em className="kp-numeral">{top}</em></li>;
          })}
        </ul>
      </div>
      {!!res?.awards.length && <div>
        <h2>Room awards</h2>
        <ul className="island-settlers-league-awards">
          {res.awards.map(a => <li key={a.key}>
            <b>{a.title}</b>
            <span>{a.seats.map(id => byId.get(id)?.name ?? 'Someone').join(', ')}</span>
            <small>{a.text}</small>
          </li>)}
        </ul>
      </div>}
    </section>
  </div>;
}
