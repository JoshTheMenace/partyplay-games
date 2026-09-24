import type { CSSProperties } from 'react';
import { Eyebrow, type ResultsViewProps } from '../../../../party-ui/src/index';
import { FIGHTERS, type View } from '../model';
import { getStage } from '../stages';
import { Portrait, costumeOf, costumeTone } from './assets';
import { TEAM_COLORS, TEAM_NAMES } from './data';
import { finishWord, highlight, placements, seats } from './standings';
const CONFETTI = ['var(--kp-sun)', 'var(--kp-coral)', 'var(--kp-sky)', 'var(--kp-lime)', 'var(--kp-grape)', 'var(--sc-costume)', 'var(--sc-costume-2)'];
export function ResultsView({ outcome, publicView, playerId }: ResultsViewProps<View>) {
  const view = seats(publicView);
  // Every declared winner (a whole team, or a shared Sudden Death win) places first.
  const ranks = new Map(outcome.rows.flatMap(r => r.rank ? [[r.playerId, outcome.winners.includes(r.playerId) ? 1 : r.rank] as const] : [])), rows = placements(view, ranks);
  const winners = outcome.winners.length ? outcome.winners.flatMap(id => view.fighters.filter(f => f.id === id)) : rows.filter(r => r.place === 1).map(r => r.f);
  const team = view.teams && winners.length && winners.every(f => f.team !== null && f.team === winners[0].team) ? winners[0].team : null;
  const hero = winners[0], solo = team === null && winners.length === 1, timed = finishWord(view) === 'TIME!';
  const headline = team !== null ? `${TEAM_NAMES[team]} wins!` : solo ? `${hero.name} wins!` : winners.length ? 'It’s a tie!' : 'No contest';
  return <section className="sky-clash-results" style={hero ? costumeTone(hero.fighter, hero.costume) : undefined}>
    <div className="sc-res-hero">
      <div className="sc-confetti" aria-hidden="true">{Array.from({ length: 30 }, (_, i) => <i key={i} style={{ '--x': `${(i * 37) % 100}%`, '--y': `${(i * 59) % 92}%`, '--d': `${(i * .23) % 2.6}s`, '--r': `${(i * 67) % 360}deg`, '--c': CONFETTI[i % CONFETTI.length] } as CSSProperties}/>)}</div>
      <div className="sc-res-renders" data-count={Math.min(winners.length, 3)}>{winners.slice(0, 3).map(f => <Portrait key={f.id} kind={f.fighter} costume={f.costume} render className="sc-res-render"/>)}</div>
      <div className="sc-res-copy">
        <Eyebrow>{getStage(view.stageId).name}{solo ? ` · ${FIGHTERS[hero.fighter].name}` : ''}</Eyebrow>
        <h1 className="kp-title" style={team !== null ? { color: TEAM_COLORS[team] } : undefined}>{headline}</h1>
        {winners.length > 1 && <p className="sc-res-sub">{winners.map(f => f.name).join(' & ')}{team === null ? ' share the win.' : ''}</p>}
        {timed && <p className="sc-res-sub">Time! Most stocks left wins, then the lowest damage.</p>}
        <p className="sc-highlight">★ {highlight(view.fighters, winners)}</p>
      </div>
    </div>
    <ol className="sc-res-list">{rows.map(({ f, place }) => <li key={f.id} className={`${place === 1 ? 'sc-res-win' : ''}${f.id === playerId ? ' sc-res-you' : ''}`} style={costumeTone(f.fighter, f.costume, { '--sc-player': f.color })}>
      <b className="sc-res-rank kp-numeral" aria-label={`Place ${place}`}>#{place}</b>
      <Portrait kind={f.fighter} costume={f.costume} className="sc-res-portrait"/>
      <div className="sc-res-name"><strong>{f.name}{f.id === playerId && <small> (you)</small>}</strong>
        <span>{FIGHTERS[f.fighter].name} · {costumeOf(f.fighter, f.costume).name}{view.teams && f.team !== null ? ` · ${TEAM_NAMES[f.team]}` : ''}{f.cpu ? ' · CPU' : ''}</span></div>
      <dl className="sc-res-stats">{timed && <div><dt>Stocks</dt><dd className="kp-numeral">{f.stocks}</dd></div>}<div><dt>KOs</dt><dd className="kp-numeral">{f.kos}</dd></div><div><dt>Falls</dt><dd className="kp-numeral">{f.falls}</dd></div>
        {f.dealt !== undefined ? <div><dt>Dealt</dt><dd className="kp-numeral">{Math.round(f.dealt)}%</dd></div> : <div><dt>Damage</dt><dd className="kp-numeral">{Math.round(f.damage)}%</dd></div>}</dl>
    </li>)}</ol>
  </section>;
}
