import { LifeBuoy } from 'lucide-react';
import type { ClientProps, PublicView } from '../contracts';
import { CombatScene } from './combat';
import { Scrap, shipOf, tint } from './common';
import { EventScreen } from './event';
import { Hangar } from './hangar';
import { LootScreen } from './loot';
import { MapScreen } from './map';
import { OverScreen } from './over';
import { StoreScreen } from './store';
import './display.css';

/** Slim fleet status for the non-combat screens: who is here, how hurt, how rich, and whether they have acted. */
function TopBar({ view }: { view: PublicView }) {
  const voting = view.phase === 'map' || view.phase === 'event' && !view.event?.result;
  return <header className="ss-topbar">
    <div className="ss-topbar-sector"><small>Sector {view.sectorIndex + 1}/{view.sectorCount}</small><b>{view.map.name}</b></div>
    <ul className="ss-topbar-crew">{view.captains.map(c => {
      const ship = shipOf(view, c), voted = view.phase === 'map' ? !!c.vote : !!view.event?.choices.some(ch => ch.votes.includes(c.id));
      const [label, tone] = !c.connected ? ['Autopilot', 'off'] : voting ? voted ? ['Voted', 'ok'] : ['Deciding', ''] : c.ready ? ['Ready', 'ok'] : [view.phase === 'store' ? 'Shopping' : 'Not ready', ''];
      const hp = ship ? ship.hull / ship.maxHull : 0;
      return <li key={c.id} style={tint(c.color)} className={c.connected ? '' : 'ss-away'}>
        <i className="ss-swatch"/><b>{c.name}</b>
        {ship && <span className="ss-hullbar" data-low={hp < .35 || undefined} aria-label={`Hull ${ship.hull} of ${ship.maxHull}`}><i style={{ width: `${hp * 100}%` }}/></span>}
        <Scrap n={c.scrap}/>
        <em className={`ss-tag ss-tag-${tone}`}>{c.status === 'flying' ? label : c.status}</em>
      </li>; })}</ul>
    <div className="ss-topbar-fleet" aria-label={`${view.reserves} reserve hulls`}><LifeBuoy aria-hidden/><b className="kp-numeral">{view.reserves}</b><small>reserves</small></div>
  </header>;
}

export function Display(props: ClientProps) {
  const view = props.publicView, { phase } = view;
  const screen = phase === 'combat' ? <CombatScene view={view} serverNowMs={props.serverNowMs}/>
    : phase === 'hangar' ? <Hangar view={view}/> : phase === 'map' ? <MapScreen view={view} serverNowMs={props.serverNowMs}/>
    : phase === 'event' ? <EventScreen view={view} serverNowMs={props.serverNowMs}/> : phase === 'loot' ? <LootScreen view={view}/>
    : phase === 'store' ? <StoreScreen view={view}/> : <OverScreen view={view}/>;
  const bar = phase === 'map' || phase === 'event' || phase === 'loot' || phase === 'store';
  return <div className={`ss-display ss-phase-${phase}`}>
    {bar && <TopBar view={view}/>}
    <div key={`${phase}:${view.map.sectorId}:${view.event?.id ?? ''}`} className="ss-stage">{screen}</div>
    {bar && view.message && <p key={view.message} className="ss-toast" role="status">{view.message}</p>}
  </div>;
}
