import { useMemo } from 'react';
import { ArrowBigRight, Crosshair, Crown, HeartHandshake, Hexagon, Skull, Star, Wrench, type LucideIcon } from 'lucide-react';
import { wingCount, type CaptainView, type PublicView } from '../contracts';
import { hullDef } from '../defs/hulls';
import { ShipCanvas, backdrop, previewShip, shipOf, tint } from './common';
import { HullThumb, WingTag, wingTint } from './wings';

const HEADLINE = { victory: ['Victory', 'The Armada is broken'], defeat: ['Defeat', 'The fleet is lost'], suspended: ['Expedition saved', 'The fleet waits at the beacon'] } as const;
const COLUMNS = [['damage', 'Damage'], ['kills', 'Kills'], ['repairs', 'Repairs'], ['scrapEarned', 'Scrap'], ['saves', 'Saves']] as const;
type Stat = typeof COLUMNS[number][0];
/** One commendation per column, to whoever led it (seat order breaks ties; nothing for a column nobody scored in). */
const AWARDS: [Stat, string, string, LucideIcon][] = [['damage', 'Top Gun', 'damage dealt', Crosshair], ['kills', 'Ace', 'ships destroyed', Skull], ['repairs', 'Chief Engineer', 'repairs made', Wrench],
  ['saves', 'Guardian Angel', 'allies patched up', HeartHandshake], ['scrapEarned', 'Scrap Baron', 'scrap hauled', Hexagon]];

function ShipThumb({ view, captain }: { view: PublicView; captain: CaptainView }) {
  const paint = shipOf(view, captain)?.paint ?? captain.color, ship = useMemo(() => previewShip(captain.hullId!, paint, `thumb-${captain.id}`), [captain.hullId, captain.id, paint]);
  return <ShipCanvas ship={ship} crew={[]} colors={{}} className="ss-thumb"/>;
}
/** The sectors the fleet crossed, ending at the Flagship (won, lost, or still ahead). */
function Route({ view }: { view: PublicView }) {
  return <ol className="ss-route" aria-label="Route flown">{view.route.map((name, i) => <li key={i}><span>{name}</span><ArrowBigRight aria-hidden/></li>)}
    <li className={`ss-route-end ss-route-${view.result ?? 'suspended'}`}><Crown aria-hidden/><span>{view.result === 'victory' ? 'Flagship destroyed' : view.sectorIndex + 1 < view.sectorCount ? `${view.sectorCount - view.sectorIndex - 1} sector${view.sectorCount - view.sectorIndex > 2 ? 's' : ''} short of the Flagship` : 'The Flagship still flies'}</span></li></ol>;
}
/**
 * Co-op debrief. Up to eight captains: a row each in seat order (everyone shares the outcome), the best value in each column starred, ties included.
 * A bigger fleet: a row per wing with its totals. Two captains or more also earn commendations. On a wide screen the route, the fleet's numbers and
 * the commendations sit beside the table, so sixteen wings fit a TV without scrolling.
 */
export function Debrief({ view }: { view: PublicView }) {
  const { captains } = view, crowd = captains.length > 8, wings = Array.from({ length: wingCount(captains.length) }, (_, k) => captains.filter(c => c.wing === k));
  const sum = (list: readonly CaptainView[], k: Stat) => list.reduce((n, c) => n + c.stats[k], 0);
  const best = Object.fromEntries(COLUMNS.map(([k]) => [k, Math.max(0, ...(crowd ? wings.map(w => sum(w, k)) : captains.map(c => c.stats[k])))]));
  const fleet = [['Jumps', view.fleetStats.jumps], ['Kills', view.fleetStats.kills], ['Scrap', view.fleetStats.scrap], ['Ships lost', view.fleetStats.lostShips]] as const;
  const hull = (c: CaptainView) => c.hullId ? hullDef(c.hullId).name : '';
  const awards = captains.length < 2 ? [] : AWARDS.flatMap(([k, title, unit, Icon]) => { const top = Math.max(0, ...captains.map(c => c.stats[k])), who = captains.find(c => c.stats[k] === top); return top > 0 && who ? [{ k, title, unit, Icon, who, top }] : []; });
  const Cell = ({ k, value }: { k: Stat; value: number }) => { const top = best[k] > 0 && value === best[k]; return <td className={`kp-numeral ${top ? 'ss-best' : ''}`}>{top && <Star aria-label="best"/>}{value}</td>; };
  return <div className="ss-debrief" data-crowd={captains.length > 4 || undefined}><div className="ss-debrief-side">
    <Route view={view}/>
    <dl className="ss-fleet-stats">{fleet.map(([k, v]) => <div key={k}><dd className="kp-numeral">{v}</dd><dt>{k}</dt></div>)}</dl>
    {awards.length > 0 && <ul className="ss-awards" aria-label="Commendations">{awards.map(({ k, title, unit, Icon, who, top }, i) => <li key={k} style={{ ...tint(who.color), animationDelay: `${.5 + i * .18}s` }}>
      <Icon aria-hidden/><b>{title}</b><span>{who.name}{view.fleet && <WingTag wing={who.wing}/>}</span><small><i className="kp-numeral">{top}</i> {unit}</small></li>)}</ul>}</div>
    <table className="ss-stat-table" data-wide={wings.length > 8 || !crowd && captains.length > 4 || undefined}>
      <thead><tr><th>{crowd ? 'Wing' : 'Captain'}</th>{COLUMNS.map(([k, label]) => <th key={k}>{label}</th>)}</tr></thead>
      <tbody>{crowd ? wings.map((list, k) => <tr key={k} style={wingTint(k)}>
        <th scope="row"><WingTag wing={k}/><span className="ss-wing-hulls">{list.map(c => c.hullId && <HullThumb key={c.id} hullId={c.hullId} paint={c.color}/>)}</span></th>
        {COLUMNS.map(([key]) => <Cell key={key} k={key} value={sum(list, key)}/>)}</tr>)
        : captains.map(c => <tr key={c.id} style={tint(c.color)}>
          <th scope="row"><i/>{c.hullId && (view.fleet ? <HullThumb hullId={c.hullId} paint={c.color} className="ss-thumb"/> : <ShipThumb captain={c} view={view}/>)}<span>{c.name}<small>{hull(c)}{c.status !== 'flying' && ` · ${c.status}`}</small></span></th>
          {COLUMNS.map(([k]) => <Cell key={k} k={k} value={c.stats[k]}/>)}</tr>)}</tbody>
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
