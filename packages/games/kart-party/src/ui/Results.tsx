/* Results: podium, full table and party awards (stats arrive with the results snapshot). */
import type { CSSProperties } from 'react';
import type { ResultsViewProps } from '../../../../party-ui/src/index';
import { TRACK_DEFS } from '../tracks/index';
import type { RaceView, RacerStats, RacerView } from '../sim/types';
import { formatTime, ordinal, ordinalSuffix, Portrait, rideLabel } from './common';

type Award = { title: string; blurb: (v: number) => string; score: (s: RacerStats) => number; min: number };
const AWARDS: Award[] = [
  { title: 'Drift Royalty', blurb: v => `${v} mini-turbos`, score: s => s.miniTurbos + s.purpleTurbos, min: 3 },
  { title: 'Sharpshooter', blurb: v => `${v} ${v === 1 ? 'hit' : 'hits'} landed`, score: s => s.hitsDealt, min: 1 },
  { title: 'Overtake Machine', blurb: v => `${v} overtakes`, score: s => s.overtakes, min: 3 },
  { title: 'Sky Surfer', blurb: v => `${(v / 10).toFixed(1)} s airborne`, score: s => Math.round(s.airTime * 10), min: 20 },
  { title: 'Trick Star', blurb: v => `${v} ${v === 1 ? 'trick' : 'tricks'}`, score: s => s.tricks, min: 1 },
  { title: 'Rocket Starter', blurb: () => 'perfect launch', score: s => Number(s.rocketStart), min: 1 },
  { title: 'Speed Demon', blurb: v => `${(v * 3.6 / 10).toFixed(0)} km/h top speed`, score: s => Math.round(s.topSpeed * 10), min: 1 },
  { title: 'Item Hoarder', blurb: v => `${v} items used`, score: s => s.itemsUsed, min: 4 },
  { title: 'Magnet for Trouble', blurb: v => `hit ${v} times`, score: s => s.hitsTaken, min: 3 },
  { title: 'Wall Whisperer', blurb: v => `${v} wall kisses`, score: s => s.wallHits, min: 6 },
];
/** Up to `limit` awards, humans first, at most one per racer, skipping titles nobody really earned. */
export function partyAwards(racers: readonly RacerView[], limit = 4) {
  const eligible = racers.filter(r => r.stats), humans = eligible.filter(r => !r.bot), pool = humans.length ? humans : eligible, used = new Set<string>(), out: { award: Award; racer: RacerView; value: number }[] = [];
  for (const award of AWARDS) {
    if (out.length >= limit) break;
    const best = pool.filter(r => !used.has(r.id)).map(r => ({ racer: r, value: award.score(r.stats!) })).sort((a, b) => b.value - a.value || a.racer.rank - b.racer.rank)[0];
    if (best && best.value >= award.min) { used.add(best.racer.id); out.push({ award, racer: best.racer, value: best.value }); }
  }
  return out;
}
const bestLap = (r: RacerView) => r.lapTimes.length ? Math.min(...r.lapTimes) : null;

export function Results({ publicView, playerId }: ResultsViewProps<RaceView>) {
  const race = publicView, rows = [...race.racers].sort((a, b) => a.rank - b.rank), podium = rows.slice(0, 3);
  const me = rows.find(r => r.id === playerId), fastest = Math.min(...rows.map(r => bestLap(r) ?? Infinity));
  const awards = partyAwards(rows), def = TRACK_DEFS[race.track], mine = awards.find(a => a.racer.id === playerId);
  return <section className="kp2-results" aria-label="Race results">
    <header className="kp2-results-head">
      <small>{def?.name ?? 'Race'} · {race.laps} {race.laps === 1 ? 'lap' : 'laps'} · {race.speedClass}cc</small>
      <h1>{me ? me.finishTime === null ? 'Did not finish' : me.rank === 1 ? 'You win!' : `You finished ${ordinal(me.rank)}` : `${rows[0]?.name ?? 'Nobody'} wins!`}</h1>
      {me && <p className="kp2-results-me" style={{ '--c': me.color } as CSSProperties}>
        <span><small>Time</small><b className="kp-numeral">{me.finishTime === null ? 'DNF' : formatTime(me.finishTime)}</b></span>
        <span><small>Best lap</small><b className="kp-numeral">{formatTime(bestLap(me))}</b></span>
        {mine && <span className="kp2-results-me-award"><small>{mine.award.title}</small><b>{mine.award.blurb(mine.value)}</b></span>}
      </p>}
    </header>
    <ol className="kp2-podium" aria-label="Podium">
      {[podium[1], podium[0], podium[2]].map((r, i) => r && <li key={r.id} className={`kp2-step kp2-step-${r.rank} ${r.id === playerId ? 'is-me' : ''}`} style={{ '--c': r.color, order: i } as CSSProperties}>
        <Portrait index={r.character}/><b>{r.name}</b><small>{rideLabel(r)}</small>
        <span className="kp2-step-block kp-numeral"><span>{r.rank}<sup>{ordinalSuffix(r.rank)}</sup></span></span>
      </li>)}
    </ol>
    <div className="kp2-results-body">
      <table className="kp2-table">
        <thead><tr><th scope="col">#</th><th scope="col">Racer</th><th scope="col">Time</th><th scope="col">Best lap</th></tr></thead>
        <tbody>{rows.map(r => { const lap = bestLap(r); return <tr key={r.id} className={`${r.id === playerId ? 'is-me' : ''} ${r.bot ? 'is-cpu' : ''}`} style={{ '--c': r.color } as CSSProperties}>
          <td className="kp-numeral">{r.rank}</td>
          <td><span className="kp2-table-racer"><Portrait index={r.character}/><span><b>{r.name}{r.bot && <em> CPU</em>}</b><small>{rideLabel(r)}</small></span></span></td>
          <td className="kp-numeral">{r.finishTime === null ? 'DNF' : formatTime(r.finishTime)}</td>
          <td className={`kp-numeral ${lap !== null && lap === fastest ? 'is-fastest' : ''}`}>{lap === null ? '—' : formatTime(lap)}</td>
        </tr>; })}</tbody>
      </table>
      {awards.length > 0 && <ul className="kp2-awards" aria-label="Party awards">{awards.map(({ award, racer, value }) => <li key={award.title} className={racer.id === playerId ? 'is-me' : ''} style={{ '--c': racer.color } as CSSProperties}>
        <Portrait index={racer.character}/><span><small>{award.title}</small><b>{racer.name}</b><em>{award.blurb(value)}</em></span>
      </li>)}</ul>}
    </div>
  </section>;
}
