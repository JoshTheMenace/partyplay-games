import { useEffect, useRef, useState } from 'react';
import type { ClientProps } from '../contracts';
import { Controller, containKeys } from './controller';
import { EmergencyRow, FleetCanvas } from './display';
import { phaseContext } from './nav';
/** Playing host: fleet overview beside the captain interface on wide screens; below that the ship takes the whole frame and Fleet opens as an overlay. Keys off playerId/isHost, never viewRole. */
export function Personal(props: ClientProps) {
  const [fleetOpen, setFleetOpen] = useState(false), combat = props.publicView.phase === 'combat', overlay = useRef<HTMLElement>(null);
  // Same lifecycle as Drawer and Popover, but only while the fleet is an overlay: move focus in on open, restore it on close.
  useEffect(() => { if (!fleetOpen) return; const previous = document.activeElement as HTMLElement | null; overlay.current?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, [fleetOpen]);
  return <div className={`ss-personal ${fleetOpen ? 'ss-fleet-open' : ''}`} data-player={props.playerId ?? ''}>
    <section ref={overlay} className="ss-personal-fleet" aria-label="Fleet overview" role={fleetOpen ? 'dialog' : undefined} aria-modal={fleetOpen ? 'true' : undefined} tabIndex={fleetOpen ? -1 : undefined} onKeyDown={fleetOpen ? event => containKeys(event, () => setFleetOpen(false)) : undefined}>
      <button type="button" className="ss-icon-button ss-personal-fleet-close" onClick={() => setFleetOpen(false)} aria-label="Close fleet overview">✕</button>
      {combat ? <FleetCanvas view={props.publicView} serverNowMs={props.serverNowMs} compact/> : <div className="ss-personal-quiet"><span className="kp-eyebrow">{props.publicView.sector.name} · sector {props.publicView.sector.index}/{props.publicView.sector.count}</span><strong>{phaseContext(props.publicView).title}</strong><p>{phaseContext(props.publicView).detail}</p></div>}
      <EmergencyRow view={props.publicView}/>
    </section>
    <section className="ss-personal-captain" aria-label="Captain controls"><Controller {...props} fleet={() => setFleetOpen(true)}/></section>
  </div>;
}
