/* Final board: stars, the adjusted-time sum and playful per-thief awards. A crew night ranks every crew instead. */
import type { CSSProperties } from 'react';
import type { ResultsViewProps } from '../../../party-ui/src/index';
import { COIN_PENALTY, CREWS, NIGHT, ROLES, TOOLS, scoreSeconds, starsFor, type CrewLine, type CrewStats, type View } from './model';
import { getMap } from './maps';
import { clock, tone } from './hud';
import { crewOf, decode, type Night, type Wire } from './wire';

const AWARDS: [keyof CrewStats, string][] = [['spotted', 'Most Wanted'], ['coins', 'Light Fingers'], ['revives', 'Guardian Angel'], ['takedowns', 'Silent Partner']];
const NONE: CrewStats = { coins: 0, spotted: 0, takedowns: 0, revives: 0, downs: 0, tools: 0 };
/** Awards per player id. Ties share the award; an award nobody earned is skipped. */
export function awardsFor(stats: View['stats']): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [stat, title] of AWARDS) {
    const best = Math.max(0, ...Object.values(stats).map(s => s[stat]));
    if (best > 0) for (const [id, s] of Object.entries(stats)) if (s[stat] === best) (out[id] ??= []).push(title);
  }
  return out;
}
const Stars = ({ count, small }: { count: number; small?: boolean }) => <div className={`nj-stars${small ? ' nj-stars-small' : ''}`} role="img" aria-label={`${count} of 3 stars`}>{[0, 1, 2].map(i => <span key={i} className={i < count ? 'nj-on' : undefined} style={{ animationDelay: `${.25 + i * .22}s` }}>★</span>)}</div>;

/** Every crew in finishing order: the crew of the night on top, then a row per crew with its thieves. A phone sees its own crew marked. */
function NightResults({ night, playerId }: { night: Night; playerId: string | null }) {
  const { base, final } = night.wire, map = getMap(base.mission), total = night.cast.totalLoot, mine = crewOf(night, playerId);
  const ranked = [...night.lines].sort((a, b) => a.place - b.place || a.crew - b.crew), away = ranked.filter(l => l.phase === 'clear'), best = ranked[0];
  // A phone lists its own crew first (with its real place), then everyone in finishing order.
  const rows = mine < 0 ? ranked : [night.lines[mine], ...ranked.filter(l => l.crew !== mine)];
  const stats = Object.fromEntries(base.roster.map(([id], seat) => [id, final ? { coins: final.stats[seat][0], spotted: final.stats[seat][1], takedowns: final.stats[seat][2], revives: final.stats[seat][3], downs: final.stats[seat][4], tools: final.stats[seat][5] } : NONE])), awards = awardsFor(stats);
  const score = (l: CrewLine) => scoreSeconds(l.seconds, total - l.collected, l.bails), won = best.phase === 'clear';
  const verdict = (l: CrewLine) => l.phase === 'clear' ? <><b className="kp-numeral">{clock(score(l))}</b><small>{clock(l.seconds)} + {(total - l.collected) * COIN_PENALTY}s loot{l.bails ? ` + ${l.bails * NIGHT.bailPenalty}s bail` : ''}</small></> : <><b>{l.taken ? `Had the ${map.objectiveKind}` : 'Still inside'}</b><small>{l.bails ? `${l.bails} bail${l.bails > 1 ? 's' : ''} · ` : ''}no getaway</small></>;
  return <div className={`night-job nj-results nj-night nj-results-${won ? 'clear' : 'failed'}`} data-phase={won ? 'clear' : 'failed'} data-crews={rows.length} data-away={away.length}>
    <header className="nj-results-head" style={tone(CREWS[best.crew].color)}>
      <small className="nj-kicker">{map.title} · crew night</small>
      <h1>{won ? <>The <span>{CREWS[best.crew].name}</span> take the night.</> : 'Sunrise. Nobody got away.'}</h1>
      <p className="nj-sub">{away.length} of {rows.length} crews made a clean getaway · {rows.reduce((sum, l) => sum + l.collected, 0)} coins lifted across town</p>
    </header>
    <ol className="nj-ranking" aria-label="Crews in finishing order">{rows.map(l => <li key={l.crew} style={tone(CREWS[l.crew].color)} data-away={l.phase === 'clear'} data-mine={l.crew === mine || undefined}>
      <b className="nj-place kp-numeral">{l.place}</b>
      <div className="nj-rank-crew"><strong>{CREWS[l.crew].name}{l.crew === mine && <small> · your crew</small>}</strong><Stars count={starsFor(map.parTimes, score(l), l.phase === 'clear')} small/></div>
      <div className="nj-rank-time">{verdict(l)}</div>
      <span className="nj-take kp-numeral">{l.collected}<small>/{total}</small></span>
      <ul className="nj-rank-crewmates">{night.crews[l.crew].map(seat => { const [id, name, color, role] = base.roster[seat]; return <li key={id} style={{ '--nj-color': color } as CSSProperties} data-you={id === playerId || undefined} data-left={final?.left.includes(seat) || undefined}>
        <b className="nj-seat kp-numeral">{seat + 1}</b><span className="nj-name">{name}</span><i aria-hidden="true" style={{ color: ROLES[role].color }} title={ROLES[role].name}>{ROLES[role].icon}</i>
        {awards[id]?.map(a => <em key={a}>{a}</em>)}
      </li>; })}</ul>
    </li>)}</ol>
    {playerId && stats[playerId] && <dl className="nj-stats-row nj-own-stats" aria-label="Your night">{([['Coins', 'coins'], ['Spotted', 'spotted'], ['Takedowns', 'takedowns'], ['Revives', 'revives'], ['Downs', 'downs'], ['Tools', 'tools']] as const).map(([label, key]) => <div key={key}><dt>{label}</dt><dd className="kp-numeral">{stats[playerId][key]}</dd></div>)}</dl>}
  </div>;
}

export function ResultsView({ publicView, playerId }: ResultsViewProps<Wire>) {
  const night = decode(publicView), view = night.cast;
  if (night.rival) return <NightResults night={night} playerId={playerId}/>;
  const map = getMap(view.mission), clear = view.phase === 'clear', missed = Math.max(0, view.totalLoot - view.collected), adjusted = view.elapsed + missed * COIN_PENALTY;
  const stars = starsFor(map.parTimes, adjusted, clear), awards = awardsFor(view.stats);
  return <div className={`night-job nj-results nj-results-${clear ? 'clear' : 'failed'}`} data-phase={view.phase} data-adjusted={Math.round(adjusted)} data-stars={stars}>
    <header className="nj-results-head">
      <small className="nj-kicker">{map.title}</small>
      <h1>{clear ? 'Clean getaway.' : 'Busted.'}</h1>
      <p className="nj-sub">{clear ? 'The whole crew made it out with the goods.' : view.message || 'The crew didn’t make it out.'}</p>
      <Stars count={stars}/>
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
      const s = view.stats[p.id] ?? NONE;
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
