import { useEffect, useRef, useState } from 'react';
import { ArrowBigRight, Check, ChevronLeft, ChevronRight, CircleHelp, Cloud, Coins, Crosshair, Crown, Home, Package, RadioTower, ShoppingBag, UserPlus, Wrench, type LucideIcon } from 'lucide-react';
import { ArcadeButton, Countdown, Panel, TextInput } from '../../../../party-ui/src/index';
import type { CaptainView, ClientProps, NodeKind, Phase, PublicView, ShipView } from '../contracts';
import { PAINTS, augmentDef, systemDef, weaponDef } from '../defs/catalog';
import { PLAYER_HULLS, hullDef } from '../defs/hulls';
import { captainById, Dot, itemInfo, Meter, myCaptain, Notices, Pips, previewShip, shipOf, Spin, type Actions } from './common';
import { KIND_ICON } from './combat';
import { ShipThumb } from './stage';

type Ctx = { props: ClientProps; view: PublicView; me: CaptainView; ship: ShipView | null; actions: Actions };
const Busy = ({ on, children }: { on: boolean; children: React.ReactNode }) => <>{on && <Spin/>}{children}</>;
const Price = ({ value, scrap }: { value: number; scrap: number }) => <span className="sp-price" data-short={value > scrap || undefined}><Coins size={13} aria-hidden="true"/>{value}</span>;
const Voters = ({ view, ids }: { view: PublicView; ids: readonly string[] }) => ids.length ? <span className="sp-voters">{ids.map(id => { const c = captainById(view, id); return c && <Dot key={id} color={c.color} label={c.name}/>; })}</span> : null;
function ReadyButton({ me, actions, label = 'Ready', waiting }: { me: CaptainView; actions: Actions; label?: string; waiting: number }) {
  return <div className="sp-ready"><ArcadeButton tone={me.ready ? 'lime' : 'sun'} size="lg" aria-pressed={me.ready} disabled={actions.busy('ready')} onClick={() => actions.act({ type: 'ready', ready: !me.ready })}>
    <Busy on={actions.busy('ready')}>{me.ready ? <><Check size={18} aria-hidden="true"/> {label}</> : label}</Busy></ArcadeButton>
    <small>{me.ready ? waiting ? `Waiting for ${waiting} captain${waiting > 1 ? 's' : ''} · tap to undo` : 'Everyone is ready' : waiting ? `${waiting} captain${waiting > 1 ? 's' : ''} not ready` : ''}</small></div>;
}
const notReady = (view: PublicView) => view.captains.filter(c => c.connected && !c.ready).length;

function Hangar({ props, view, me, ship, actions }: Ctx) {
  const [draft, setDraft] = useState(() => ({ hullId: me.hullId ?? PLAYER_HULLS[0].id, name: ship && ship.name !== hullDef(ship.hullId).name && ship.name !== `${me.name}'s ${hullDef(ship.hullId).name}` ? ship.name : '', paint: ship?.paint ?? PAINTS.find(p => p === me.color) ?? PAINTS[0] }));
  const index = Math.max(0, PLAYER_HULLS.findIndex(h => h.id === draft.hullId)), hull = PLAYER_HULLS[index], locked = me.ready, timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const send = (next: typeof draft) => actions.act({ type: 'hangar', hullId: next.hullId, name: next.name.trim(), paint: next.paint });
  const update = (patch: Partial<typeof draft>, delay = 0) => { const next = { ...draft, ...patch }; setDraft(next); clearTimeout(timer.current); timer.current = setTimeout(() => void send(next), delay); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const preview = previewShip(hull, draft.paint, draft.name || (ship?.hullId === hull.id ? ship.name : hull.name));
  const cycle = (d: number) => { const h = PLAYER_HULLS[(index + d + PLAYER_HULLS.length) % PLAYER_HULLS.length]; update({ hullId: h.id }); };
  const ready = async () => { if (!me.ready) { clearTimeout(timer.current); if (!await send(draft)) return; } void actions.act({ type: 'ready', ready: !me.ready }); };
  return <section className="sp-hangar" aria-label="Hangar">
    <div className="sp-carousel">
      <button type="button" className="sp-icon-btn" aria-label="Previous hull" disabled={locked} onClick={() => cycle(-1)}><ChevronLeft aria-hidden="true"/></button>
      <div className="sp-hull-view"><ShipThumb view={view} ship={preview.ship} crew={preview.crew} serverNowMs={props.serverNowMs} detail="phone"/>
        <p className="sp-hull-index" aria-live="polite">{hull.name} · {index + 1}/{PLAYER_HULLS.length}</p></div>
      <button type="button" className="sp-icon-btn" aria-label="Next hull" disabled={locked} onClick={() => cycle(1)}><ChevronRight aria-hidden="true"/></button>
    </div>
    <div className="sp-hull-info">
      <p className="kp-eyebrow">{hull.role}</p><h2 className="sp-h">{hull.name}</h2><p className="sp-blurb">{hull.blurb}</p>
      <dl className="sp-specs"><div><dt>Hull</dt><dd>{hull.maxHull}</dd></div><div><dt>Weapon slots</dt><dd>{hull.weaponSlots}</dd></div><div><dt>Crew</dt><dd>{hull.startCrew.length}</dd></div><div><dt>Missiles</dt><dd>{hull.startAmmo}</dd></div></dl>
      <p className="sp-kit"><b>Armed with</b> {hull.startWeapons.map(id => weaponDef(id).name).join(' · ')}</p>
      <p className="sp-kit"><b>Systems</b> {hull.rooms.flatMap(r => r.system && hull.startSystems[r.system] ? [`${systemDef(r.system).short} ${hull.startSystems[r.system]}`] : []).join(' · ')}</p>
      {hull.rooms.some(r => r.system && !hull.startSystems[r.system]) && <p className="sp-kit"><b>Room to install</b> {hull.rooms.flatMap(r => r.system && !hull.startSystems[r.system] ? [systemDef(r.system).name] : []).join(' · ')}</p>}
      <label className="sp-field">Ship name<TextInput value={draft.name} placeholder={ship?.hullId === hull.id ? ship.name : hull.name} maxLength={16} disabled={locked} autoComplete="off" onChange={e => update({ name: e.target.value.slice(0, 16) }, 600)}/></label>
      <div className="sp-swatches" role="radiogroup" aria-label="Paint">{PAINTS.map(p => <button key={p} type="button" role="radio" className="kp-swatch" aria-checked={draft.paint === p} aria-label={`Paint ${p}`} disabled={locked} style={{ background: p }} onClick={() => update({ paint: p })}/>)}</div>
      <div className="sp-ready"><ArcadeButton tone={me.ready ? 'lime' : 'sun'} size="lg" aria-pressed={me.ready} disabled={actions.busy('ready') || actions.busy('hangar')} onClick={ready}>
        <Busy on={actions.busy('ready')}>{me.ready ? 'Ready · tap to change' : 'Launch ready'}</Busy></ArcadeButton><small>{notReady(view) ? `${notReady(view)} captain${notReady(view) > 1 ? 's' : ''} still choosing` : 'All captains ready'}</small></div>
      <ul className="sp-fleet">{view.captains.map(c => <li key={c.id}><Dot color={c.color}/>{c.name}<small>{c.hullId ? hullDef(c.hullId).name : 'choosing'}</small>{c.ready && <Check size={14} aria-label="ready"/>}</li>)}</ul>
    </div>
  </section>;
}

const NODE: Record<NodeKind, [LucideIcon, string]> = { start: [Home, 'Start'], unknown: [CircleHelp, 'Unknown beacon'], hostile: [Crosshair, 'Hostile signal'], distress: [RadioTower, 'Distress call'], store: [ShoppingBag, 'Trading post'], nebula: [Cloud, 'Nebula'], exit: [ArrowBigRight, 'Sector exit'], boss: [Crown, 'Armada Flagship'] };
function SectorMap({ props, view, me, actions }: Ctx) {
  const { map } = view, current = map.nodes.find(n => n.id === map.currentId), links = new Set(current?.links ?? []);
  const at = (n: { x: number; y: number }) => ({ x: n.x * 100, y: n.y * 100 }); // run/map.ts positions are normalized 0..1 with margins
  const front = map.armadaCol < 0 ? 0 : Math.min(100, Math.max(0, ...map.nodes.filter(n => n.col <= map.armadaCol).map(n => at(n).x)) + 44 / Math.max(1, map.columns));
  const votes = (id: string) => view.captains.filter(c => c.vote === id).map(c => c.id), voted = view.captains.filter(c => c.vote).length;
  return <section className="sp-map-panel" aria-label="Sector map">
    <div className="sp-panel-head"><div><p className="kp-eyebrow">Sector {view.sectorIndex + 1}/{view.sectorCount}</p><h2 className="sp-h">{map.name}</h2></div>
      <p className="sp-vote-state">{voted}/{view.captains.filter(c => c.connected).length} voted{view.voteDeadline && <> · <Countdown deadline={view.voteDeadline} serverNowMs={props.serverNowMs}/>s</>}</p></div>
    <div className="sp-map">
      <div className="sp-armada" style={{ width: `${front}%` }} aria-hidden="true"/>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{map.nodes.flatMap(n => n.links.map(id => { const m = map.nodes.find(k => k.id === id); if (!m) return null; const a = at(n), b = at(m);
        return <line key={n.id + id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} data-live={n.id === map.currentId || undefined} data-trail={n.visited && m.visited || undefined} vectorEffect="non-scaling-stroke"/>; }))}</svg>
      {map.nodes.map(n => { const [Icon, name] = NODE[n.kind], p = at(n), reach = links.has(n.id), v = votes(n.id), mine = me.vote === n.id;
        const label = `${name}${n.hazard !== 'none' ? `, ${n.hazard.replace('-', ' ')}` : ''}${n.id === map.currentId ? ', fleet is here' : ''}${reach ? `, ${v.length} vote${v.length === 1 ? '' : 's'}${mine ? ', your vote' : ''}` : ''}`;
        return <button key={n.id} type="button" className="sp-node" data-kind={n.kind} data-reach={reach || undefined} data-here={n.id === map.currentId || undefined} data-visited={n.visited || undefined} aria-pressed={reach ? mine : undefined}
          style={{ left: `${p.x}%`, top: `${p.y}%` }} tabIndex={reach ? 0 : -1} aria-disabled={!reach} aria-label={label} title={name}
          onClick={() => reach && !actions.busy('vote') && actions.act({ type: 'vote', nodeId: n.id })}><Icon size={reach ? 20 : 15} aria-hidden="true"/>{n.hazard !== 'none' && <i className="sp-hazard"/>}<Voters view={view} ids={v}/></button>; })}
    </div>
    <p className="sp-legend">{[...new Set(map.nodes.map(n => n.kind))].map(k => { const [Icon, name] = NODE[k]; return <span key={k}><Icon size={14} aria-hidden="true"/>{name}</span>; })}</p>
    <p className="sp-hint">{me.vote ? `You voted for ${NODE[map.nodes.find(n => n.id === me.vote)?.kind ?? 'unknown'][1]}. Tap another beacon to change.` : 'Tap a glowing beacon to vote for the next jump.'} The red wall is the Armada.</p>
  </section>;
}

function EventCard({ props, view, me, actions }: Ctx) {
  const ev = view.event!;
  return <section className="sp-event" aria-label="Event">
    <div className="sp-panel-head"><h2 className="sp-h">{ev.title}</h2>{view.voteDeadline && <span className="sp-vote-state"><Countdown deadline={view.voteDeadline} serverNowMs={props.serverNowMs}/>s</span>}</div>
    <p className="sp-event-text">{ev.result ?? ev.text}</p>
    {ev.result === null ? <div className="sp-choices">{ev.choices.map(ch => { const mine = ch.votes.includes(me.id);
      return <button key={ch.id} type="button" className="sp-choice" data-blue={ch.badge ? true : undefined} aria-pressed={mine} disabled={!ch.available || actions.busy(`choose-${ch.id}`)} onClick={() => actions.act({ type: 'choose', choiceId: ch.id }, `choose-${ch.id}`)}>
        {ch.badge && <span className="sp-badge">{ch.badge}</span>}<span className="sp-choice-label"><Busy on={actions.busy(`choose-${ch.id}`)}>{ch.label}</Busy></span>
        <Voters view={view} ids={ch.votes}/>{!ch.available && <small>Needs {ch.badge ?? 'something the fleet lacks'}</small>}</button>; })}</div>
      : <>{ev.resultLines.length > 0 && <ul className="sp-result-lines">{ev.resultLines.map((l, i) => <li key={i}>{l}</li>)}</ul>}<ReadyButton me={me} actions={actions} label="Continue" waiting={notReady(view)}/></>}
  </section>;
}

function LootTable({ view, me, actions }: Ctx) {
  const loot = view.loot!;
  return <section className="sp-loot" aria-label="Salvage">
    <div className="sp-panel-head"><h2 className="sp-h">Salvage</h2><p className="sp-vote-state"><Coins size={15} aria-hidden="true"/> +{loot.scrapEach} scrap each</p></div>
    <div className="sp-cards">{loot.items.map(item => { const info = itemInfo(item.kind, item.defId), owner = captainById(view, loot.claims[item.id] ?? item.ownerId), Icon = item.kind === 'weapon' ? KIND_ICON[weaponDef(item.defId).kind] : Package;
      return <article key={item.id} className="sp-card" data-claimed={owner ? true : undefined}><h3><Icon size={16} aria-hidden="true"/>{info.name}</h3><p>{info.blurb}</p>
        {owner ? <p className="sp-claimed"><Dot color={owner.color}/>{owner.id === me.id ? 'Yours' : `Claimed by ${owner.name}`}</p>
          : <ArcadeButton size="sm" tone="sky" disabled={actions.busy(`claim-${item.id}`)} onClick={() => actions.act({ type: 'claim', itemId: item.id }, `claim-${item.id}`)}><Busy on={actions.busy(`claim-${item.id}`)}>Claim</Busy></ArcadeButton>}</article>; })}
      {!loot.items.length && <p className="sp-hint">No salvageable gear this time.</p>}</div>
    <p className="sp-hint">Unclaimed items are left behind when the fleet departs.</p>
    <ReadyButton me={me} actions={actions} label="Ready to jump" waiting={notReady(view)}/>
  </section>;
}

function StoreFront({ view, me, ship, actions }: Ctx) {
  const store = view.store!, [tab, setTab] = useState<'buy' | 'services' | 'sell'>('buy');
  const missing = ship ? ship.maxHull - ship.hull : 0, scrap = me.scrap;
  return <section className="sp-store" aria-label="Store">
    <div className="sp-panel-head"><h2 className="sp-h">Trading post</h2><p className="sp-vote-state"><Coins size={15} aria-hidden="true"/> {scrap} scrap</p></div>
    <div className="sp-tabs" role="tablist">{(['buy', 'services', 'sell'] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'buy' ? 'Buy' : t === 'services' ? 'Services' : 'Sell'}</button>)}</div>
    {tab === 'buy' && <div className="sp-cards">{store.offers.map(o => { const info = itemInfo(o.kind, o.defId, o.crew), buyer = captainById(view, o.soldTo), room = o.kind === 'system' ? ship?.rooms.find(r => r.system === o.defId) : null;
      const blocked = o.kind === 'system' ? !room ? 'No room for it on your hull' : room.tier > 0 ? 'Already installed' : null : null, Icon = o.kind === 'weapon' ? KIND_ICON[weaponDef(o.defId).kind] : o.kind === 'system' ? Wrench : o.kind === 'crew' ? UserPlus : Package;
      return <article key={o.id} className="sp-card" data-claimed={buyer ? true : undefined}><h3><Icon size={16} aria-hidden="true"/>{info.name}<Price value={o.price} scrap={scrap}/></h3>{info.tag && <p className="sp-tag">For hire · {info.tag}</p>}<p>{info.blurb}</p>
        {buyer ? <p className="sp-claimed"><Dot color={buyer.color}/>Sold to {buyer.id === me.id ? 'you' : buyer.name}</p> : blocked ? <p className="sp-claimed">{blocked}</p>
          : <ArcadeButton size="sm" tone="sky" disabled={o.price > scrap || actions.busy(`buy-${o.id}`)} onClick={() => actions.act({ type: 'buy', offerId: o.id }, `buy-${o.id}`)}><Busy on={actions.busy(`buy-${o.id}`)}>{o.price > scrap ? `Need ${o.price - scrap} more` : 'Buy'}</Busy></ArcadeButton>}</article>; })}</div>}
    {tab === 'services' && <div className="sp-services">
      <article className="sp-card"><h3><Wrench size={16} aria-hidden="true"/>Hull repair<Price value={store.repairPrice} scrap={scrap}/></h3>{ship && <Meter value={ship.hull} max={ship.maxHull} label={`Hull ${ship.hull} of ${ship.maxHull}`}/>}
        <p>{missing ? `${missing} damage to patch · ${store.repairPrice} per point` : 'Hull is in perfect shape.'}</p>
        <div className="sp-row">{[...new Set([1, 5, missing])].filter(n => n > 0 && n <= missing).map(n => <ArcadeButton key={n} size="sm" tone="lime" disabled={n * store.repairPrice > scrap || actions.busy(`repair-${n}`)} onClick={() => actions.act({ type: 'repair', amount: n }, `repair-${n}`)}>
          <Busy on={actions.busy(`repair-${n}`)}>{n === missing ? 'Full' : `+${n}`} · {n * store.repairPrice}</Busy></ArcadeButton>)}</div></article>
      <article className="sp-card"><h3><KIND_ICON.missile size={16} aria-hidden="true"/>Missiles<Price value={store.ammoPrice} scrap={scrap}/></h3><p>You carry {ship?.ammo ?? 0}. Three per crate.</p>
        <ArcadeButton size="sm" tone="lime" disabled={store.ammoPrice > scrap || actions.busy('ammo')} onClick={() => actions.act({ type: 'ammo' })}><Busy on={actions.busy('ammo')}>Buy 3 missiles</Busy></ArcadeButton></article>

    </div>}
    {tab === 'sell' && <div className="sp-cards">{me.cargo.map(item => { const info = itemInfo(item.kind, item.defId);
      return <article key={item.id} className="sp-card"><h3>{info.name}<Price value={Math.floor(info.price / 2)} scrap={Infinity}/></h3><p>{info.blurb}</p>
        <ArcadeButton size="sm" tone="coral" disabled={actions.busy(`sell-${item.id}`)} onClick={() => actions.act({ type: 'sell', itemId: item.id }, `sell-${item.id}`)}><Busy on={actions.busy(`sell-${item.id}`)}>Sell for {Math.floor(info.price / 2)}</Busy></ArcadeButton></article>; })}
      {!me.cargo.length && <p className="sp-hint">Your cargo hold is empty. Unequip a weapon on the Ship tab to sell it.</p>}</div>}
    <ReadyButton me={me} actions={actions} label="Done shopping" waiting={notReady(view)}/>
  </section>;
}

/** Upgrades and equipment, available in every non-combat menu phase. */
function Shipyard({ me, ship, actions }: Ctx) {
  if (!ship) return <p className="sp-hint">Your ship is being rebuilt.</p>;
  const hull = hullDef(ship.hullId), powered = ship.levels.weapons ?? 0, free = ship.weapons.length < hull.weaponSlots ? ship.weapons.length : -1;
  const systems = ship.rooms.filter((r, i, all) => r.system && all.findIndex(x => x.system === r.system) === i);
  return <section className="sp-shipyard" aria-label="Ship">
    <div className="sp-panel-head"><div><p className="kp-eyebrow">{hull.name}</p><h2 className="sp-h">{ship.name}</h2></div><p className="sp-vote-state"><Coins size={15} aria-hidden="true"/> {me.scrap} scrap</p></div>
    <div className="sp-stats-row"><Meter value={ship.hull} max={ship.maxHull} label={`Hull ${ship.hull} of ${ship.maxHull}`}/><span className="kp-numeral">{ship.hull}/{ship.maxHull}</span><span><KIND_ICON.missile size={14} aria-hidden="true"/> {ship.ammo}</span></div>
    <h3 className="sp-sub">Systems</h3>
    <ul className="sp-systems">{systems.map(r => { const def = systemDef(r.system!), price = r.tier ? def.upgradePrices[r.tier - 1] : def.installPrice, max = r.tier >= def.maxTier, key = `upgrade-${def.id}`;
      return <li key={def.id}><span><b>{def.name}</b><small>{def.blurb}</small></span><Pips on={r.tier - r.damage} total={def.maxTier} tone="tier" label={`${def.name} tier ${r.tier} of ${def.maxTier}`}/>
        {max ? <span className="sp-max">Max</span> : <button type="button" className="sp-buy" disabled={price === undefined || price > me.scrap || actions.busy(key)} onClick={() => actions.act({ type: 'upgrade', system: def.id }, key)}
          aria-label={`${r.tier ? 'Upgrade' : 'Install'} ${def.name} for ${price} scrap`}>{actions.busy(key) ? <Spin/> : r.tier ? 'Upgrade' : 'Install'}<Price value={price ?? 0} scrap={me.scrap}/></button>}</li>; })}</ul>
    <h3 className="sp-sub">Weapons <small>{powered} of {hull.weaponSlots} slots powered</small></h3>
    <ul className="sp-slots">{Array.from({ length: hull.weaponSlots }, (_, i) => { const w = ship.weapons[i], def = w && weaponDef(w.defId), Icon = def ? KIND_ICON[def.kind] : Package;
      return <li key={i} data-on={i < powered || undefined}><span className="sp-slot-no">{i + 1}</span>{def ? <><span><b><Icon size={14} aria-hidden="true"/> {def.name}</b><small>{i < powered ? 'Powered' : 'Unpowered: upgrade Weapons'}</small></span>
        <button type="button" className="sp-buy" disabled={actions.busy(`unequip-${i}`)} onClick={() => actions.act({ type: 'unequip', slot: i }, `unequip-${i}`)}>{actions.busy(`unequip-${i}`) ? <Spin/> : 'Unequip'}</button></> : <span className="sp-hint">Empty slot</span>}</li>; })}</ul>
    <h3 className="sp-sub">Cargo</h3>
    <ul className="sp-slots">{me.cargo.map(item => { const info = itemInfo(item.kind, item.defId);
      return <li key={item.id}><span><b>{info.name}</b><small>{info.blurb}</small></span>{item.kind === 'weapon' && <button type="button" className="sp-buy" disabled={free < 0 || actions.busy(`equip-${item.id}`)} onClick={() => actions.act({ type: 'equip', itemId: item.id, slot: free }, `equip-${item.id}`)}>
        {actions.busy(`equip-${item.id}`) ? <Spin/> : free < 0 ? 'Slots full' : 'Equip'}</button>}</li>; })}{!me.cargo.length && <li className="sp-hint">Empty hold.</li>}</ul>
    {ship.augments.length > 0 && <><h3 className="sp-sub">Augments</h3><ul className="sp-slots">{ship.augments.map(id => <li key={id}><span><b>{augmentDef(id).name}</b><small>{augmentDef(id).blurb}</small></span></li>)}</ul></>}
  </section>;
}

function Summary({ view }: { view: PublicView }) {
  const s = view.fleetStats;
  return <section className="sp-over" aria-label="Run summary" data-result={view.result ?? undefined}><p className="kp-eyebrow">{view.result === 'victory' ? 'Victory' : view.result === 'defeat' ? 'Defeat' : 'Run suspended'}</p><h2 className="sp-h">{view.result === 'victory' ? 'The Armada is broken' : view.result === 'defeat' ? 'The fleet is lost' : 'Expedition saved'}</h2><p>{view.message}</p>
    <dl className="sp-specs"><div><dt>Jumps</dt><dd>{s.jumps}</dd></div><div><dt>Kills</dt><dd>{s.kills}</dd></div><div><dt>Scrap</dt><dd>{s.scrap}</dd></div><div><dt>Ships lost</dt><dd>{s.lostShips}</dd></div></dl>
    <table className="sp-table"><thead><tr><th>Captain</th><th>Damage</th><th>Kills</th><th>Repairs</th><th>Scrap</th></tr></thead>
      <tbody>{view.captains.map(c => <tr key={c.id}><td><span className="sp-cap"><Dot color={c.color}/>{c.name}</span></td><td>{c.stats.damage}</td><td>{c.stats.kills}</td><td>{c.stats.repairs}</td><td>{c.stats.scrapEarned}</td></tr>)}</tbody></table></section>;
}

const PANELS: Partial<Record<Phase, [string, (ctx: Ctx) => React.ReactNode]>> = { map: ['Map', SectorMap], event: ['Event', EventCard], loot: ['Salvage', LootTable], store: ['Store', StoreFront] };
/** Every non-combat phase: the phase panel plus a Ship tab for upgrades and equipment. */
export function MenuController(props: ClientProps & { actions: Actions }) {
  const view = props.publicView, me = myCaptain(props), ship = shipOf(view, me), [tab, setTab] = useState<{ phase: Phase; ship: boolean }>({ phase: view.phase, ship: false });
  const panel = PANELS[view.phase], View = panel?.[1], onShip = !!panel && tab.phase === view.phase && tab.ship;
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollTo(0, 0); root.current?.scrollTo(0, 0); }, [view.phase, view.turn]); // each new screen starts at its heading (window on phones, the drawer on the host screen)
  if (view.phase === 'over') return <div className="ss-phone sp-menu"><Summary view={view}/></div>;
  if (!me) return <div className="ss-phone sp-menu"><Panel className="sp-watch"><p className="kp-display">Watching the run</p><p>You are not captaining a ship. Follow the fleet on the TV; you can join the next run.</p></Panel></div>;
  const ctx: Ctx = { props, view, me, ship, actions: props.actions };
  return <div ref={root} className="ss-phone sp-menu">
    {panel && <div className="sp-tabs sp-tabs-main" role="tablist">{[false, true].map(s => <button key={String(s)} type="button" role="tab" aria-selected={onShip === s} onClick={() => setTab({ phase: view.phase, ship: s })}>{s ? 'Ship' : panel[0]}</button>)}</div>}
    <Notices actions={props.actions} connected={props.connected}/>
    {view.phase === 'hangar' ? <Hangar {...ctx}/> : onShip ? <Shipyard {...ctx}/> : View && <View {...ctx}/>}
  </div>;
}
