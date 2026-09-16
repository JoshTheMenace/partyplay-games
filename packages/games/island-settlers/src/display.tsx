import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type React from 'react';
import { Countdown, type GameViewProps } from '../../../party-ui/src/index';
import type { Action, GameEvent, PrivateView, PublicView } from './model';
import { Die, HandChips } from './icons';
import { describeSettings, describeStep, expansionPlayer, isConnect, nameOf, names, playerOf, withDefaults } from './presentation';
import { AwardsFooter, BarbarianPanel, EventDie, ImprovementStrip, ScenarioPanel } from './panels';

type Props = GameViewProps<null, Action, PublicView, PrivateView>;
const MOMENT_MS = 4200;
const PAGE_MS = 5000;
/** TV lists page themselves: measured page count, last partial page labelled as the end, paused while hovered or focused, instant under reduced motion. */
function useAutoPager(list: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  const [pages, setPages] = useState({ count: 1, page: 1 }), [paused, setPaused] = useState(false), pausedRef = useRef(false);
  useEffect(() => {
    const element = list.current; if (!element) return;
    const measure = () => { const height = Math.max(1, element.clientHeight), overflow = element.scrollHeight > height + 2, count = overflow ? Math.max(1, Math.ceil((element.scrollHeight - 2) / height)) : 1, atEnd = element.scrollTop + height >= element.scrollHeight - 2, page = !overflow ? 1 : atEnd ? count : Math.min(count, Math.floor((element.scrollTop + 2) / height) + 1); setPages(previous => previous.count === count && previous.page === page ? previous : { count, page }); };
    const observer = new ResizeObserver(measure); observer.observe(element); measure(); element.addEventListener('scroll', measure);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const pause = (value: boolean) => () => { pausedRef.current = value; setPaused(value); };
    const enter = pause(true), leave = pause(false); element.addEventListener('pointerenter', enter); element.addEventListener('pointerleave', leave); element.addEventListener('focusin', enter); element.addEventListener('focusout', leave);
    const timer = setInterval(() => { if (pausedRef.current || element.scrollHeight <= element.clientHeight + 2) return; const atEnd = element.scrollTop + element.clientHeight >= element.scrollHeight - 2; element.scrollTo({ top: atEnd ? 0 : element.scrollTop + element.clientHeight, behavior: reduced.matches ? 'auto' : 'smooth' }); }, PAGE_MS);
    return () => { observer.disconnect(); element.removeEventListener('scroll', measure); element.removeEventListener('pointerenter', enter); element.removeEventListener('pointerleave', leave); element.removeEventListener('focusin', enter); element.removeEventListener('focusout', leave); clearInterval(timer); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { pages, paused };
}
const PageNote = ({ pages, paused }: { pages: { count: number; page: number }; paused: boolean }) => pages.count > 1 ? <span>page {pages.page} of {pages.count} · {paused ? 'auto-turn paused while you read' : `turns every ${PAGE_MS / 1000}s`}</span> : null;
function OffersColumn({ view }: { view: PublicView }) {
  const list = useRef<HTMLDivElement>(null), { pages, paused } = useAutoPager(list, [view.offers.length]);
  if (!view.offers.length) return <aside className="is-side is-side-left" aria-label="Open trade offers"/>;
  return <aside className="is-side is-side-left" aria-label="Open trade offers"><div className="is-offers-host">
    <header className="is-offers-head"><strong>{view.offers.length} open offer{view.offers.length === 1 ? '' : 's'}</strong><PageNote pages={pages} paused={paused}/></header>
    <div ref={list} className="is-offers-list" tabIndex={0} aria-label="Offer list, scrollable">{view.offers.map(offer => { const proposer = playerOf(view, offer.playerId); return <article key={offer.id} className="is-offer" style={{ '--seat': proposer?.color } as CSSProperties}><header><b className="is-swatch"/><strong>{proposer?.name ?? 'Someone'}</strong><span>offers</span></header><div className="is-offer-hands"><HandChips hand={offer.give}/><span className="is-offer-for">for</span><HandChips hand={offer.get}/></div><footer>{offer.accepts.length ? <>{offer.accepts.length} accepted: {offer.accepts.map(id => <em key={id} style={{ color: playerOf(view, id)?.color }}>{nameOf(view, id)}</em>)}</> : 'Waiting for takers…'}</footer></article>; })}</div>
  </div></aside>;
}
/** Bank, barbarians and scenario status share one bounded, self-paging stack so the ticker below always keeps its height. */
function StatusStack({ view }: { view: PublicView }) {
  const list = useRef<HTMLDivElement>(null), exp = view.expansions, { pages, paused } = useAutoPager(list, [view.players.length, !!exp, exp?.barbarian?.position, exp?.metropolises.length, view.longestOwner, view.armyOwner, exp?.harborOwner, exp?.event]);
  // The bank pill renders only when it has a line to show; Explorers with Cities & Knights can start with none.
  const showDeck = !view.settings.citiesKnights && view.settings.expansion !== 'explorers', showLegend = view.settings.expansion !== 'explorers', showAwards = !!exp && !!view.settings.citiesKnights && (exp.metropolises.length > 0 || exp.players.some(player => player.defenderPoints > 0));
  return <div className="is-status-host"><div ref={list} className="is-status" tabIndex={0} aria-label="Game status, scrollable">
    {(showDeck || showLegend || view.longestOwner || view.armyOwner || showAwards) && <div className="is-bank">{showDeck && <span><b className="kp-numeral">{view.deckCount}</b> development cards left</span>}{showLegend && <span className="is-legend">Ports · <b>2:1</b> shown · <b>3:1</b> any</span>}{view.longestOwner && <span>Longest route · <em style={{ color: playerOf(view, view.longestOwner)?.color }}>{nameOf(view, view.longestOwner)}</em></span>}{view.armyOwner && <span>Largest army · <em style={{ color: playerOf(view, view.armyOwner)?.color }}>{nameOf(view, view.armyOwner)}</em></span>}{showAwards && <AwardsFooter view={view}/>}</div>}
    <BarbarianPanel view={view}/><ScenarioPanel view={view}/>
  </div>{pages.count > 1 && <footer className="is-status-page"><PageNote pages={pages} paused={paused}/></footer>}</div>;
}
/** Host HUD layered over the 3D board. Reads the step, offers, dice, ticker and the ten-seat rail from the public view. */
export function Display({ publicView: view, serverNowMs }: Props) {
  const step = describeStep(view), settings = withDefaults(view.settings), connect = isConnect(view);
  const seen = useRef<number | null>(null), [moment, setMoment] = useState<GameEvent | null>(null);
  useEffect(() => { const last = view.events.at(-1)?.id ?? 0; if (seen.current === null) { seen.current = last; return; } const fresh = view.events.filter(event => event.id > seen.current!); seen.current = Math.max(seen.current, last); if (fresh.length) setMoment(fresh[fresh.length - 1]); }, [view.events]);
  useEffect(() => { if (!moment) return; const timer = setTimeout(() => setMoment(null), MOMENT_MS); return () => clearTimeout(timer); }, [moment]);
  const away = view.players.filter(player => !player.connected), paused = view.pausedPlayers.length > 0;
  return <div className="is-hud" data-phase={view.phase} data-players={view.players.length}>
    <header className="is-top">
      <div className="is-brand"><span className="is-wordmark kp-display">Island Settlers</span><small>{settings.mode === 'connect' ? 'Connect-style rounds' : 'Standard turns'} · {describeSettings(settings, true)} · first to {settings.targetPoints} VP{connect ? ` · round ${view.turn}` : ` · turn ${view.turn}`}</small></div>
      <div className="is-step" role="status" aria-live="polite"><span className="is-step-eyebrow">{view.phase === 'ended' ? 'Final' : 'Now'}</span><strong className="kp-hud-text">{step.title}</strong><small>{paused ? `Paused while ${names(view, view.pausedPlayers)} reconnect${view.pausedPlayers.length === 1 ? 's' : ''}.` : step.detail}</small></div>
      <div className="is-dice" aria-label={view.dice ? `Dice: ${view.dice[0]} and ${view.dice[1]}, total ${view.dice[0] + view.dice[1]}` : 'Dice not rolled yet'}>{view.dice ? <><Die value={view.dice[0]} size={40}/><Die value={view.dice[1]} size={40}/><strong className="kp-numeral is-dice-total" data-seven={view.dice[0] + view.dice[1] === 7 || undefined}>{view.dice[0] + view.dice[1]}</strong><EventDie view={view}/></> : <span className="is-dice-empty">—</span>}{view.deadline !== null && <span className="is-clock" data-urgent={view.deadline - serverNowMs() <= 10000 || undefined}><Countdown deadline={view.deadline} serverNowMs={serverNowMs}/><small>s</small></span>}</div>
    </header>
    <OffersColumn view={view}/>
    <aside className="is-side is-side-right" aria-label="Recent events">
      <StatusStack view={view}/>
      <ol className="is-ticker">{view.events.slice(-6).reverse().map(event => <li key={event.id} data-kind={event.kind}><b className="is-swatch" style={{ background: playerOf(view, event.playerId)?.color ?? '#a9b3e6' }}/><span>{event.text}</span></li>)}</ol>
    </aside>
    {moment && <div key={moment.id} className="is-moment kp-hud-text" data-kind={moment.kind} role="status"><b className="is-swatch" style={{ background: playerOf(view, moment.playerId)?.color ?? '#ffd24a' }}/>{moment.text}</div>}
    {away.length > 0 && <p className="is-away-note">Reconnecting: {away.map(player => player.name).join(', ')}</p>}
    <footer className="is-rail" aria-label="Players">
      {view.players.map((player, i) => { const active = view.activeIds.includes(player.id) || (view.phase !== 'ended' && player.id === view.actorId && !connect), ready = view.readyIds.includes(player.id), winner = view.winners.includes(player.id); return <article key={player.id} className="is-seat" data-active={active || undefined} data-away={!player.connected || undefined} data-ready={ready || undefined} data-winner={winner || undefined} style={{ '--seat': player.color } as CSSProperties}>
        <div className="is-seat-head"><b className="is-swatch">{i + 1}</b><span className="is-seat-name">{player.name}</span></div>
        <div className="is-seat-score"><strong className="kp-numeral">{player.score}</strong><small>VP</small></div>
        <div className="is-seat-stats"><span>{player.handCount} card{player.handCount === 1 ? '' : 's'}</span>{(player.developmentCount > 0 || !settings.citiesKnights) && <span>{player.developmentCount} dev</span>}{player.knights > 0 && <span>{player.knights} knight{player.knights === 1 ? '' : 's'}</span>}{player.longestRoute > 0 && <span>route {player.longestRoute}</span>}{(() => { const row = expansionPlayer(view, player.id); if (!row) return null; const missions = Object.values(row.missions).reduce((sum, value) => sum + value, 0); return <>{row.progressCount > 0 && <span>{row.progressCount} progress</span>}{row.coins > 0 && <span>{row.coins} coin{row.coins === 1 ? '' : 's'}</span>}{row.fishCount > 0 && <span>{row.fishCount} fish</span>}{row.prisoners > 0 && <span>{row.prisoners} prisoner{row.prisoners === 1 ? '' : 's'}</span>}{missions > 0 && <span>{missions} mission pt{missions === 1 ? '' : 's'}</span>}</>; })()}</div>
        {(() => { const row = expansionPlayer(view, player.id); return row && settings.citiesKnights ? <ImprovementStrip levels={row.improvements} defender={row.defenderPoints}/> : null; })()}
        <div className="is-seat-flags">{view.longestOwner === player.id && <em>Longest route</em>}{view.armyOwner === player.id && <em>Largest army</em>}{view.expansions?.harborOwner === player.id && <em>Harbormaster</em>}{view.expansions?.metropolises.filter(m => m.playerId === player.id).map(m => <em key={m.vertex} className="is-flag-metro">{m.track}</em>)}{connect && view.phase === 'action' && <em data-ready={ready || undefined}>{ready ? 'Ready' : 'Building…'}</em>}{!player.connected && <em className="is-flag-away">Away</em>}</div>
      </article>; })}
    </footer>
  </div>;
}
