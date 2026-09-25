/* Final board: stars, the adjusted-time sum and playful per-thief awards. */
import type { ResultsViewProps } from '../../../party-ui/src/index';
import { COIN_PENALTY, ROLES, TOOLS, starsFor, type CrewStats, type View } from './model';
import { getMap } from './maps';
import { clock, tone } from './hud';

const AWARDS: [keyof CrewStats, string][] = [['spotted', 'Most Wanted'], ['coins', 'Light Fingers'], ['revives', 'Guardian Angel'], ['takedowns', 'Silent Partner']];
/** Awards per player id. Ties share the award; an award nobody earned is skipped. */
export function awardsFor(stats: View['stats']): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [stat, title] of AWARDS) {
    const best = Math.max(0, ...Object.values(stats).map(s => s[stat]));
    if (best > 0) for (const [id, s] of Object.entries(stats)) if (s[stat] === best) (out[id] ??= []).push(title);
  }
  return out;
}

export function ResultsView({ publicView: view, playerId }: ResultsViewProps<View>) {
  const map = getMap(view.mission), clear = view.phase === 'clear', missed = Math.max(0, view.totalLoot - view.collected), adjusted = view.elapsed + missed * COIN_PENALTY;
  const stars = starsFor(map.parTimes, adjusted, clear), awards = awardsFor(view.stats);
  return <div className={`night-job nj-results nj-results-${clear ? 'clear' : 'failed'}`} data-phase={view.phase} data-adjusted={Math.round(adjusted)} data-stars={stars}>
    <header className="nj-results-head">
      <small className="nj-kicker">{map.title}</small>
      <h1>{clear ? 'Clean getaway.' : 'Busted.'}</h1>
      <p className="nj-sub">{clear ? 'The whole crew made it out with the goods.' : view.message || 'The crew didn’t make it out.'}</p>
      <div className="nj-stars" role="img" aria-label={`${stars} of 3 stars`}>{[0, 1, 2].map(i => <span key={i} className={i < stars ? 'nj-on' : undefined} style={{ animationDelay: `${.25 + i * .22}s` }}>★</span>)}</div>
    </header>
    <dl className="nj-tally">
      <div><dt>{clear ? 'Time on the job' : 'Time survived'}</dt><dd className="kp-numeral">{clock(view.elapsed)}</dd></div>
      <div><dt>Loot</dt><dd className="kp-numeral">{view.collected}<span>/{view.totalLoot}</span></dd></div>
      {clear ? <>
        <div><dt>Missed loot</dt><dd className="kp-numeral">+{missed * COIN_PENALTY}s<span> {missed}×{COIN_PENALTY}s</span></dd></div>
        <div className="nj-adjusted"><dt>Adjusted time</dt><dd className="kp-numeral">{clock(adjusted)}</dd></div>
      </> : <div><dt>The {map.objectiveKind}</dt><dd>{view.objectiveTaken ? 'Grabbed' : 'Untouched'}</dd></div>}
    </dl>
    <p className="nj-par">{clear ? 'Par' : 'No stars without a clean getaway · par'} {map.parTimes.map((t, i) => <span key={i} className={clear && adjusted <= t ? 'nj-beat' : undefined}>{'★'.repeat(i + 1)} {clock(t)}</span>)}</p>
    <ul className="nj-crew-results" aria-label="Crew">{[...view.players].sort((a, b) => Number(b.id === playerId) - Number(a.id === playerId)).map(p => {
      const s = view.stats[p.id] ?? { coins: 0, spotted: 0, takedowns: 0, revives: 0, downs: 0, tools: 0 };
      return <li key={p.id} style={tone(p.color)}>
        <b className="nj-seat kp-numeral">{p.seat + 1}</b>
        <span className="nj-name">{p.name}{p.id === playerId && <small> · you</small>}</span>
        <span className="nj-role"><i aria-hidden="true" style={{ color: ROLES[p.role].color }}>{ROLES[p.role].icon}</i>{ROLES[p.role].name} · {TOOLS[p.tool].name}{p.suspended ? ' · left early' : ''}</span>
        <span className="nj-awards">{awards[p.id]?.map(a => <em key={a}>{a}</em>)}</span>
        <dl className="nj-stats-row">{([['Coins', s.coins], ['Spotted', s.spotted], ['Takedowns', s.takedowns], ['Revives', s.revives], ['Downs', s.downs], ['Tools', s.tools]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="kp-numeral">{v}</dd></div>)}</dl>
      </li>;
    })}</ul>
  </div>;
}
