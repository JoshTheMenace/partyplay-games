/** Scenery for the screens between battles: the fleet under way with what it found at the beacon, and the jump that takes it there. */
import { useEffect, useRef, useState } from 'react';
import type { NodeKind, PublicView } from '../contracts';
import { hullDef } from '../defs/hulls';
import { hash } from '../render/hullart';
import { ASSET } from './common';
import { HullThumb } from './wings';

/** Rendered sites (art/sites.py) by beacon kind; wormholes and unknown beacons are drawn in CSS. */
const SITES: Partial<Record<NodeKind, string>> = { store: 'outpost', drydock: 'drydock', derelict: 'derelict', distress: 'beacon' };
/** The hulls a sector's hostile and elite beacons show, lead ship first. */
const HOSTILES: Record<string, string[]> = { rustbelt: ['raider', 'skiff'], veil: ['hive', 'skiff'], glasswater: ['cantor', 'shard'], meridian: ['drone', 'drone'], cinder: ['gunship', 'raider'], sanctum: ['cathedral', 'shard'], marches: ['dreadnought', 'gunship'] };
const fleetHulls = (view: PublicView) => (view.fleet?.ships ?? view.ships).filter(s => s.faction === 'ally').map(s => ({ id: s.id, hullId: s.hullId, paint: s.paint }));

/** Up to twelve of the fleet's hulls in a loose formation, nose right. */
function Formation({ view }: { view: PublicView }) {
  const all = fleetHulls(view), ships = all.slice(0, 12);
  return <div className="ss-vista-fleet" data-n={ships.length > 4 ? 'many' : ships.length}>
    {ships.map((s, i) => <span key={s.id} style={{ animationDelay: `${-hash(i + 3) * 5}s` }}><HullThumb hullId={s.hullId} paint={s.paint}/></span>)}
    {all.length > ships.length && <em>+{all.length - ships.length} more</em>}</div>;
}
/** What is at this beacon: a site, a hostile contact closing in, a wormhole, or an open scan. */
export function Vista({ view }: { view: PublicView }) {
  const node = view.map.nodes.find(n => n.id === view.map.currentId), id = view.event?.id;
  const kind: NodeKind = view.phase === 'store' ? 'store' : id === 'flagship-hail' ? 'boss' : node?.kind ?? 'unknown', site = SITES[kind];
  const contact = id === 'armada-ambush' ? ['dreadnought', 'skiff'] : kind === 'boss' ? ['flagship'] : kind === 'hostile' || kind === 'elite' ? HOSTILES[view.map.sectorId] ?? HOSTILES.rustbelt : null;
  return <div className="ss-vista" data-kind={contact ? 'contact' : kind} aria-hidden>
    <Formation view={view}/>
    <div className="ss-vista-site">
      {contact ? contact.map((hullId, i) => <span key={i} className="ss-vista-foe"><HullThumb hullId={hullId} paint={id === 'armada-ambush' || kind === 'boss' ? '#b01e32' : hullDef(hullId).paint}/></span>)
        : site ? <img src={`${ASSET}sites/${site}.png`} alt=""/> : kind === 'wormhole' ? <span className="ss-vista-anomaly"><i/><i/><i/><i/></span> : <span className="ss-vista-scan"><i/></span>}
    </div>
  </div>;
}

/** A jump is a moment: the fleet stretches into light for a second and a half over whatever screen it arrives at. */
export function JumpCurtain({ view }: { view: PublicView }) {
  const jumps = view.fleetStats.jumps, seen = useRef(jumps), [at, setAt] = useState<number | null>(null);
  useEffect(() => { const fresh = jumps > seen.current; seen.current = jumps; if (!fresh) return; setAt(jumps); const timer = setTimeout(() => setAt(null), view.phase === 'combat' ? 1000 : 1500); return () => clearTimeout(timer); }, [jumps]);
  if (at === null) return null;
  return <div key={at} className="ss-jump" data-quick={view.phase === 'combat' || undefined} aria-hidden>
    {Array.from({ length: 28 }, (_, i) => <i key={i} style={{ top: `${hash(i * 3.7) * 100}%`, left: `${hash(i * 9.1) * 70}%`, animationDelay: `${hash(i) * .35}s`, width: `${4 + hash(i * 5) * 9}%` }}/>)}
    <div className="ss-jump-fleet">{fleetHulls(view).slice(0, 8).map((s, i) => <span key={s.id} style={{ animationDelay: `${i * .05}s` }}><HullThumb hullId={s.hullId} paint={s.paint}/></span>)}</div>
    <p>Jump {at}</p>
  </div>;
}
