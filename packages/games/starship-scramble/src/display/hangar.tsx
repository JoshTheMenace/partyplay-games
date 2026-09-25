import { useMemo } from 'react';
import { Smartphone } from 'lucide-react';
import type { CaptainView, PublicView } from '../contracts';
import { hullDef } from '../defs/hulls';
import { Readiness, ShipCanvas, backdrop, itemInfo, previewCrew, previewShip, shipOf, tint } from './common';

function Bay({ view, captain }: { view: PublicView; captain: CaptainView }) {
  const live = shipOf(view, captain), hullId = live?.hullId ?? captain.hullId, paint = live?.paint ?? captain.color;
  const ship = useMemo(() => hullId ? previewShip(hullId, paint, `bay-${captain.id}`) : null, [hullId, paint, captain.id]);
  const crew = useMemo(() => ship ? previewCrew(ship, captain.id) : [], [ship, captain.id]);
  const colors = useMemo(() => ({ [captain.id]: captain.color }), [captain.id, captain.color]);
  const status = !captain.connected ? <em className="ss-tag">Autopilot</em> : captain.ready ? <em className="ss-tag ss-tag-ok">Ready</em> : <em className="ss-tag">Choosing…</em>;
  if (!ship) return <article className="ss-bay ss-bay-empty" style={tint(captain.color)}>
    <header><i className="ss-bay-swatch"/><h3>{captain.name}</h3>{status}</header>
    <div className="ss-bay-wait"><Smartphone aria-hidden/><p>Choosing a ship…</p></div>
  </article>;
  const hull = hullDef(ship.hullId), levels = ship.levels;
  const stats = [['Hull', hull.maxHull], ['Shields', levels.shields ?? 0], ['Slots', hull.weaponSlots], ['Crew', hull.startCrew.length]] as const;
  return <article className={`ss-bay ${captain.ready ? 'ss-bay-ready' : ''}`} style={tint(captain.color)}>
    <header><i className="ss-bay-swatch"/><h3>{live?.name ?? captain.name}</h3>{status}</header>
    <div className="ss-bay-stage"><ShipCanvas ship={ship} crew={crew} colors={colors}/></div>
    <div className="ss-bay-info">
      <p className="ss-bay-hull"><b>{hull.name}</b> · {hull.role}{live && <span className="ss-muted"> · {captain.name}</span>}</p>
      <dl className="ss-bay-stats">{stats.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="kp-numeral">{v}</dd></div>)}</dl>
      <ul className="ss-bay-loadout">{hull.startWeapons.map((id, i) => { const info = itemInfo('weapon', id); return <li key={i}><info.Glyph aria-hidden/>{info.name}</li>; })}</ul>
    </div>
  </article>;
}

export function Hangar({ view }: { view: PublicView }) {
  const n = view.captains.length;
  return <section className="ss-screen ss-hangar ss-bg" style={backdrop('hangar')}>
    <header className="ss-screen-head">
      <div><p className="kp-eyebrow">Fleet hangar · {view.settings.difficulty === 'cadet' ? 'Cadet' : 'Captain'} difficulty · {view.settings.length === 'short' ? 'Short run' : 'Standard run'}</p>
        <h1 className="kp-title">Choose your ships</h1></div>
      <p className="ss-head-note">Pick a hull, name it and paint it.<br/>Launch when every captain is ready.</p>
    </header>
    <div className={`ss-bays ss-bays-${Math.min(n, 4)}`}>{view.captains.map(c => <Bay key={c.id} view={view} captain={c}/>)}</div>
    <Readiness captains={view.captains} prompt="Waiting for captains…"/>
  </section>;
}
