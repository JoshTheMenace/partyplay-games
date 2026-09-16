import type { CSSProperties, ReactNode } from 'react';
import type { PublicView } from './model';
import { MISSIONS, TRACKS, type Improvements, type Track } from './expansion-model';
import { SCENARIO_NAMES } from './expansion-settings';
import { MISSION_META, TRACK_META, WAGON_CARGO, indexBoard, nameOf, playerOf, vertexLabel, withDefaults } from './presentation';

const Name = ({ view, id }: { view: PublicView; id: string | null | undefined }) => id ? <em style={{ color: playerOf(view, id)?.color }}>{nameOf(view, id)}</em> : <em className="is-none">nobody yet</em>;
/** Third die result. Resolved immediately by the server, so it simply shows the last event face. */
export function EventDie({ view }: { view: PublicView }) {
  const event = view.expansions?.barbarian?.event; if (!event) return null;
  const track = event === 'barbarian' ? null : TRACK_META[event as Track];
  return <span className="is-event-die" data-event={event} style={track ? { '--track': track.color } as CSSProperties : undefined} aria-label={`Event die: ${track ? track.label : 'barbarian ship'}`}>{track ? track.label.slice(0, 3) : '☠'}</span>;
}
export function BarbarianPanel({ view }: { view: PublicView }) {
  const b = view.expansions?.barbarian; if (!b) return null;
  return <div className="is-panel is-barbarians" aria-label="Barbarian fleet"><header><strong>Barbarians</strong><small>{b.attacks} attack{b.attacks === 1 ? '' : 's'} so far</small></header><ol className="is-track-line" aria-label={`Fleet position ${b.position} of 7`}>{Array.from({ length: 8 }, (_, i) => <li key={i} data-reached={i <= b.position || undefined} data-here={i === b.position || undefined}>{i === 7 ? '⚔' : ''}</li>)}</ol><small>{b.position >= 7 ? 'Landing! Knights defend the coast.' : `${7 - b.position} step${7 - b.position === 1 ? '' : 's'} from the coast.`}</small></div>;
}
/** Three 5-segment bars, one per improvement track, small enough for a seat card at ten players. */
export function ImprovementStrip({ levels, defender }: { levels: Improvements; defender: number }) {
  return <div className="is-improve-strip" data-defender={defender > 0 || undefined} aria-label={`Improvements: ${TRACKS.map(track => `${TRACK_META[track].label} ${levels[track]}`).join(', ')}${defender ? `, ${defender} defender points` : ''}`}>{TRACKS.map(track => <span key={track} className="is-improve-bar" style={{ '--track': TRACK_META[track].color } as CSSProperties} title={`${TRACK_META[track].label} ${levels[track]} of 5`}>{Array.from({ length: 5 }, (_, i) => <i key={i} data-on={i < levels[track] || undefined}/>)}</span>)}{defender > 0 && <small>{defender} def</small>}</div>;
}
/** Metropolises and defender leaders as one compact footer under the bank panel. */
export function AwardsFooter({ view }: { view: PublicView }) {
  const exp = view.expansions; if (!exp || !view.settings.citiesKnights) return null;
  const defenders = exp.players.filter(player => player.defenderPoints > 0).sort((a, b) => b.defenderPoints - a.defenderPoints).slice(0, 3);
  if (!exp.metropolises.length && !defenders.length) return null;
  return <>{exp.metropolises.map(m => <span key={m.vertex}><i className="is-dot" style={{ background: TRACK_META[m.track].color }}/>{TRACK_META[m.track].metropolis} · <Name view={view} id={m.playerId}/></span>)}{defenders.length > 0 && <span>Defenders · {defenders.map(player => <span key={player.id}><Name view={view} id={player.id}/> {player.defenderPoints}</span>)}</span>}</>;
}
export function ScenarioPanel({ view }: { view: PublicView }) {
  const exp = view.expansions, settings = withDefaults(view.settings); if (!exp) return null;
  const lines: { key: string; title: string; body: ReactNode }[] = [];
  if (exp.fishing) lines.push({ key: 'fishing', title: SCENARIO_NAMES.fishing, body: <>Old boot · <Name view={view} id={exp.fishing.bootOwner}/></> });
  if (exp.rivers) lines.push({ key: 'rivers', title: SCENARIO_NAMES.rivers, body: <>Wealthiest · <Name view={view} id={exp.rivers.wealthiest}/>{exp.rivers.poorest.length > 0 && <> · Poorest · {exp.rivers.poorest.map(id => <Name key={id} view={view} id={id}/>)}</>} · {exp.rivers.bridges.length} bridge{exp.rivers.bridges.length === 1 ? '' : 's'}</> });
  if (exp.caravans) lines.push({ key: 'caravans', title: SCENARIO_NAMES.caravans, body: <>{exp.caravans.segments.length} camel{exp.caravans.segments.length === 1 ? '' : 's'} on the road{exp.caravans.bids.length > 0 && <> · bids: {exp.caravans.bids.map(bid => <span key={bid.playerId}><Name view={view} id={bid.playerId}/> {bid.count}</span>)}</>}</> });
  if (exp.attack) lines.push({ key: 'attack', title: SCENARIO_NAMES['barbarian-attack'], body: <>{exp.attack.barbarians.reduce((sum, item) => sum + item.count, 0)} barbarians on the coast · {exp.attack.guards.filter(g => g.active).length} active guards</> });
  if (exp.deliveries) lines.push({ key: 'deliveries', title: SCENARIO_NAMES.traders, body: <>{exp.deliveries.wagons.map(wagon => <span key={wagon.playerId} className="is-wagon-line"><Name view={view} id={wagon.playerId}/> · wagon {wagon.level}{wagon.cargo ? ` carrying ${WAGON_CARGO[wagon.cargo].label.toLowerCase()}` : ''} · {wagon.delivered} delivered</span>)}{exp.deliveries.barbarians.length > 0 && <span>{exp.deliveries.barbarians.length} road barbarian{exp.deliveries.barbarians.length === 1 ? '' : 's'}</span>}</> });
  if (exp.explorers) lines.push({ key: 'explorers', title: 'Missions', body: <>{(settings.missions ?? MISSIONS).map(mission => <span key={mission}>{MISSION_META[mission].label} · <Name view={view} id={exp.explorers!.missionOwners[mission]}/></span>)}<span>Pirate ships · <Name view={view} id={exp.explorers.pirateOwner}/></span>{exp.explorers.council.length > 0 && (() => { const index = indexBoard(view.board), spots = exp.explorers!.council.map(id => vertexLabel(index, id)); return <span>Council · {spots.length} marked harbour{spots.length === 1 ? '' : 's'} · {spots.slice(0, 2).join('; ')}{spots.length > 2 ? ' …' : ''}</span>; })()}<span>{exp.explorers.lairs.filter(l => l.captured).length} of {exp.explorers.lairs.length} lairs captured</span></> });
  if (exp.harborOwner) lines.push({ key: 'harbormaster', title: 'Harbormaster', body: <Name view={view} id={exp.harborOwner}/> });
  if (exp.event) lines.push({ key: 'event', title: 'Event', body: exp.event });
  if (!lines.length) return null;
  return <div className="is-panel is-scenarios" aria-label="Scenario status">{lines.map(line => <section key={line.key}><strong>{line.title}</strong><div>{line.body}</div></section>)}</div>;
}
