/**
 * The archipelago on the TV: every island at a glance and the room's leaders in the left rail, and a plate
 * that names the island on screen. A seated host sees their own island (`own`) instead of the featured one.
 */
import type { CSSProperties } from 'react';
import { roomRanks, type IslandCard, type LeagueView } from '../../wire';
import { useSecond } from '../display/hooks';
import { regionStyle, type Rect } from '../shared/layout';
import { EmblemChip } from '../shared/SeatChip';
import { SEATS } from '../shared/seats';

const u = (n: number) => `calc(${n} * var(--u))`;

const PHASE: Record<IslandCard['phase'], string> = {
  setup: 'placing', roll: 'ready', busy: 'rolled a 7', play: 'building', done: 'round in', over: '',
};

/** "Round 6 · 14 of 32 done", the roll countdown, or the horn. */
export function leagueLine(league: LeagueView, now: number) {
  const seats = league.islands.flatMap(c => c.flags), done = seats.filter(f => f > 0).length;
  if (league.phase === 'setup') {
    const left = league.islands.filter(c => c.phase === 'setup').length;
    return `Settling in · ${left} of ${league.islands.length} islands still placing`;
  }
  if (league.results) return 'Final scores';
  const round = `Round ${league.round}`;
  if (league.hornAt !== null && league.phase === 'play') return `${round} · the horn has sounded`;
  if (league.phase === 'roll') {
    const left = league.rollAt === null ? 0 : Math.max(0, Math.ceil((league.rollAt - now) / 1000));
    return left > 0 ? `${round} · dice in ${left}` : `${round} · rolling`;
  }
  return `${round} · ${done} of ${seats.length} done`;
}

function IslandRow({ card, shown, height }: { card: IslandCard; shown: boolean; height: number }) {
  const style = { height: u(height) } as CSSProperties, dense = height < 36;
  const done = card.flags.filter(f => f === 1).length, label = card.phase === 'play' && done ? `${done}/${card.seats.length}` : PHASE[card.phase];
  return <li className="island-settlers-league-island" data-shown={shown || undefined} data-phase={card.phase}
    data-dense={dense || undefined} style={style}>
    <b>{card.name}</b>
    <span className="island-settlers-league-pips">{card.seats.map(([id, name, seat], i) =>
      <i key={id} title={name} data-done={card.flags[i] === 1 || undefined} data-off={card.flags[i] === 2 || undefined}
        style={{ '--pip': SEATS[seat % SEATS.length].body } as CSSProperties}>{card.vp[i]}</i>)}</span>
    {!dense && <small>{label}</small>}
  </li>;
}

/** Left rail panel: one row per island (the one on screen is marked), then the room's leaders. */
export function LeaguePanel({ league, shown, height, serverNowMs }: {
  league: LeagueView; shown: number; height: number; serverNowMs(): number;
}) {
  const now = useSecond(serverNowMs), count = league.islands.length, ranks = roomRanks(league);
  // The rail also holds the ticker (116u and a gap) and this panel's own chrome, which grows a little where
  // the px minimums bite (720p); leaders take what the islands leave, at least three rows.
  const room = height - 166 - 64, row = Math.max(24, Math.min(46, (room - 3 * 34 - 30) / count));
  const leaders = Math.max(3, Math.min(8, Math.floor((room - row * count - 30) / 34)));
  const target = league.settings.targetPoints;
  return <section className="island-settlers-league island-settlers-panel" aria-label="Archipelago">
    <header>
      <h3>Archipelago</h3>
      <p>{leagueLine(league, now)}</p>
    </header>
    <ol className="island-settlers-league-islands">
      {league.islands.map((card, i) => <IslandRow key={card.name} card={card} shown={i === shown} height={row}/>)}
    </ol>
    <h4>Room leaders <small>first to {target}</small></h4>
    <ol className="island-settlers-league-leaders">
      {ranks.slice(0, leaders).map(r => <li key={r.id} data-shown={r.island === shown || undefined}>
        <span className="kp-numeral">{r.rank}</span>
        <EmblemChip index={r.seat} size={u(24)}/>
        <b>{r.name}</b>
        <small>{league.islands[r.island].name.split(' ')[0]}</small>
        <em className="kp-numeral">{r.vp}</em>
      </li>)}
    </ol>
  </section>;
}

/** Names the island on screen. It mounts with each cut, so its drop is part of the cut's transition. */
export function IslandPlate({ league, shown, own, rect }: { league: LeagueView; shown: number; own: boolean; rect: Rect }) {
  const card = league.islands[shown];
  if (!card) return null;
  return <div className="island-settlers-plate" style={regionStyle({ ...rect, height: 64 })} aria-live="polite">
    <p><small>{own ? 'Your island' : `Island ${shown + 1} of ${league.islands.length}`}</small><b>{card.name}</b></p>
  </div>;
}
