import { useMemo } from 'react';
import { Star } from 'lucide-react';
import type { CaptainView, PublicView } from '../contracts';
import { hullDef } from '../defs/hulls';
import { ShipCanvas, backdrop, previewShip, shipOf, tint } from './common';

const HEADLINE = { victory: ['Victory', 'The Armada is broken'], defeat: ['Defeat', 'The fleet is lost'], suspended: ['Expedition saved', 'The fleet waits at the beacon'] } as const;
const COLUMNS = [['damage', 'Damage'], ['kills', 'Kills'], ['repairs', 'Repairs'], ['scrapEarned', 'Scrap'], ['saves', 'Saves']] as const;

function ShipThumb({ view, captain }: { view: PublicView; captain: CaptainView }) {
  const paint = shipOf(view, captain)?.paint ?? captain.color, ship = useMemo(() => previewShip(captain.hullId!, paint, `thumb-${captain.id}`), [captain.hullId, captain.id, paint]);
  return <ShipCanvas ship={ship} crew={[]} colors={{}} className="ss-thumb"/>;
}
/** Co-op debrief: captains keep seat order (everyone shares the outcome); the best value in each column is starred, ties included. */
export function Debrief({ view }: { view: PublicView }) {
  const best = Object.fromEntries(COLUMNS.map(([k]) => [k, Math.max(0, ...view.captains.map(c => c.stats[k]))]));
  const fleet = [['Jumps', view.fleetStats.jumps], ['Kills', view.fleetStats.kills], ['Scrap', view.fleetStats.scrap], ['Ships lost', view.fleetStats.lostShips]] as const;
  const hull = (c: CaptainView) => c.hullId ? hullDef(c.hullId).name : '';
  return <div className="ss-debrief">
    <dl className="ss-fleet-stats">{fleet.map(([k, v]) => <div key={k}><dd className="kp-numeral">{v}</dd><dt>{k}</dt></div>)}</dl>
    <table className="ss-stat-table">
      <thead><tr><th>Captain</th>{COLUMNS.map(([k, label]) => <th key={k}>{label}</th>)}</tr></thead>
      <tbody>{view.captains.map(c => <tr key={c.id} style={tint(c.color)}>
        <th scope="row"><i/>{c.hullId && <ShipThumb captain={c} view={view}/>}<span>{c.name}<small>{hull(c)}{c.status !== 'flying' && ` · ${c.status}`}</small></span></th>
        {COLUMNS.map(([k]) => { const top = best[k] > 0 && c.stats[k] === best[k]; return <td key={k} className={`kp-numeral ${top ? 'ss-best' : ''}`}>{top && <Star aria-label="best"/>}{c.stats[k]}</td>; })}
      </tr>)}</tbody>
    </table>
  </div>;
}

export function OverScreen({ view }: { view: PublicView }) {
  const [title, subtitle] = HEADLINE[view.result ?? 'suspended'];
  return <section className={`ss-screen ss-over ss-over-${view.result ?? 'suspended'} ss-bg`} style={backdrop(view.result === 'victory' ? 'armada-reach' : view.map.sectorId)}>
    <header className="ss-over-head"><p className="kp-eyebrow">{subtitle}</p><h1 className="kp-title">{title}</h1>{view.message && <p>{view.message}</p>}</header>
    <Debrief view={view}/>
  </section>;
}
