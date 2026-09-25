import { Rocket, Wrench } from 'lucide-react';
import type { PublicView } from '../contracts';
import { CaptainChip, Readiness, Scrap, backdrop } from './common';
import { ItemCard } from './loot';

export function StoreScreen({ view }: { view: PublicView }) {
  const store = view.store; if (!store) return null;
  const services = [[Wrench, 'Hull repair', store.repairPrice, 'per point'], [Rocket, 'Missiles', store.ammoPrice, 'for 3']] as const;
  return <section className="ss-screen ss-store ss-bg" style={backdrop(view.map.sectorId)}>
    <header className="ss-screen-head">
      <div><p className="kp-eyebrow">{view.map.name} · spend your own scrap</p><h1 className="kp-title">Trading Post</h1></div>
      <ul className="ss-services">{services.map(([Icon, name, price, unit]) => <li key={name}><Icon aria-hidden/><span>{name}<small>{unit}</small></span><Scrap n={price}/></li>)}</ul>
    </header>
    <div className={`ss-cards ss-cards-${Math.min(4, Math.ceil(store.offers.length / 2))}`}>{store.offers.map(offer => { const buyer = view.captains.find(c => c.id === offer.soldTo);
      return <ItemCard key={offer.id} kind={offer.kind} defId={offer.defId} crew={offer.crew} owner={buyer}>
        <footer className="ss-card-foot">{buyer ? <><b className="ss-sold">Sold</b><CaptainChip captain={buyer}/></> : <span className="ss-price"><Scrap n={offer.price}/></span>}</footer>
      </ItemCard>; })}</div>
    <Readiness captains={view.captains} prompt="Shop, then ready up"/>
  </section>;
}
