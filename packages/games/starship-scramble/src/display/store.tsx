import { Rocket, Wrench } from 'lucide-react';
import type { PublicView } from '../contracts';
import { Countdown } from '../../../../party-ui/src/index';
import { CaptainChip, Readiness, Scrap, backdrop } from './common';
import { Vista } from './vista';
import { FleetGoods } from './wings';
import { ItemCard } from './loot';

export function StoreScreen({ view, serverNowMs }: { view: PublicView; serverNowMs(): number }) {
  const store = view.store; if (!store) return null;
  /** A shelf of nine or more is three rows of short cards. */ const dense = store.offers.length > 8;
  const services = [[Wrench, 'Hull repair', store.repairPrice, 'per point'], [Rocket, 'Missiles', store.ammoPrice, 'for 3']] as const;
  return <section className="ss-screen ss-store ss-bg" style={backdrop(view.map.sectorId)}>
    <header className="ss-screen-head">
      <div><p className="kp-eyebrow">{view.map.name} · spend your own scrap</p><h1 className="kp-title">Trading Post</h1></div>
      <ul className="ss-services">{services.map(([Icon, name, price, unit]) => <li key={name}><Icon aria-hidden/><span>{name}<small>{unit}</small></span><Scrap n={price}/></li>)}</ul>
    </header>
    <Vista view={view}/>
    {view.fleet ? <FleetGoods view={view}/> : <div className={`ss-cards ss-cards-${Math.min(4, Math.ceil(store.offers.length / (dense ? 3 : 2)))} ${dense ? 'ss-cards-dense' : ''}`}>{store.offers.map(offer => { const buyer = view.captains.find(c => c.id === offer.soldTo);
      return <ItemCard key={offer.id} kind={offer.kind} defId={offer.defId} crew={offer.crew} owner={buyer}>
        <footer className="ss-card-foot">{buyer ? <><b className="ss-sold">Sold</b><CaptainChip captain={buyer}/></> : <span className="ss-price"><Scrap n={offer.price}/></span>}</footer>
      </ItemCard>; })}</div>}
    <Readiness captains={view.captains} prompt={view.fleet ? 'Every wing has its own shelf on the phones · shop, then ready up' : 'Shop, then ready up'}
      closing={view.voteDeadline ? <>Closing in <Countdown deadline={view.voteDeadline} serverNowMs={serverNowMs}/></> : undefined}/>
  </section>;
}
