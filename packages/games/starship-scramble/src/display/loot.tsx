import type { ReactNode } from 'react';
import type { CaptainView, Offer, PublicView } from '../contracts';
import { CaptainChip, ItemIcon, Readiness, Scrap, backdrop, itemInfo, tint } from './common';

/** One catalog card, shared by the loot table and the store shelf. */
export function ItemCard({ kind, defId, crew, owner, children }: { kind: Offer['kind']; defId: string; crew?: Offer['crew']; owner?: CaptainView | null; children?: ReactNode }) {
  const info = itemInfo(kind, defId, crew);
  return <article className={`ss-card ss-card-${kind} ${owner ? 'ss-card-taken' : ''}`} style={owner ? tint(owner.color) : undefined}>
    <header><ItemIcon info={info}/><div><h3>{info.name}</h3><p className="ss-card-tag">{info.tag}</p></div></header>
    <p className="ss-card-blurb">{info.blurb}</p>
    {info.stats.length > 0 && <ul className="ss-card-stats">{info.stats.map(s => <li key={s}>{s}</li>)}</ul>}
    {children}
  </article>;
}

export function LootScreen({ view }: { view: PublicView }) {
  const loot = view.loot; if (!loot) return null;
  const owner = (itemId: string, fallback: string | null) => view.captains.find(c => c.id === (loot.claims[itemId] ?? fallback)) ?? null;
  return <section className="ss-screen ss-loot ss-bg" style={backdrop(view.map.sectorId)}>
    <header className="ss-screen-head">
      <div><p className="kp-eyebrow">Victory · salvage recovered</p><h1 className="kp-title">Spoils of battle</h1></div>
      <div className="ss-loot-scrap"><Scrap n={loot.scrapEach} sign/><span>scrap to every captain</span></div>
    </header>
    {loot.items.length ? <div className={`ss-cards ss-cards-${Math.min(4, Math.ceil(loot.items.length / 2))}`}>{loot.items.map(item => { const who = owner(item.id, item.ownerId);
      return <ItemCard key={item.id} kind={item.kind} defId={item.defId} owner={who}>
        <footer className="ss-card-foot">{who ? <CaptainChip captain={who}><em>claimed</em></CaptainChip> : <span className="ss-claim">Up for grabs</span>}</footer>
      </ItemCard>; })}</div>
      : <p className="ss-empty">Nothing worth hauling aboard this time. The scrap will have to do.</p>}
    <Readiness captains={view.captains} prompt="Unclaimed salvage is left behind · ready up to leave"/>
  </section>;
}
