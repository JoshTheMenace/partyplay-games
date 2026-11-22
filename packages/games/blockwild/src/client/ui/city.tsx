/**
 * Caper City's interface: the HUD (coins, the Heat meter, the minimap, the gig in hand, the context button), the shop
 * counter, job board, pockets and map sheets, the TV's panel and the City Ledger. Everything here is the city's own
 * look: a brass-and-enamel street-sign style inside the PartyPlay family (kp- tokens and fonts).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { GameViewProps, ResultsViewProps } from '../../../../../party-ui/src/index';
import { CATALOG, cityAwards, GIGS, heatTier, HEAT_NAMES, HEAT_TIERS, LOOT, scrapValue, type Offer } from '../../shared/city/economy';
import { AIRFIELD, cityPlan, districtAt, CITY, CITY_SIZE, type CityPlan, type PlaceKind } from '../../shared/city/plan';
import { RIDES } from '../../shared/city/vehicles';
import { itemName } from '../../shared/items';
import { decodeLedger, PF, seatsOf, type Action, type CityPrivate, type CityView, type Input, type PrivateView, type View } from '../../shared/protocol';
import { drawMap, MAP, paintCityMap, signUrl, SOFT, type Marker } from '../city/map';
import { cityHud, cityLook } from '../city/scene';
import { feed, readRoster } from '../game/feed';
import { hud } from '../game/hud';
import { closeScreen, sendCommand } from '../game/predict';
import { createStore, store } from '../store';
import { DayClock } from './display';
import { ItemIcon } from './icons';
import { PlayerSlots, QuickMove, Sheet } from './screens';
import { openMenu, relockPointer, useStore } from './state';

/** The scoreboard arrives about once a second in the public view; the newest is kept here with the last few news lines. */
export const cityBoard = createStore<{ board: number[][]; left: number | null; news: { n: number; text: string }[] }>({ board: [], left: null, news: [] });
export function readCity(view: View) {
  const city: CityView | undefined = view.city;
  if (!city) return;
  const state = cityBoard.get(), last = state.news[state.news.length - 1]?.n ?? 0;
  cityBoard.set({ board: city.board, left: city.left ?? null, news: city.news && city.news[0] !== last ? [...state.news, { n: city.news[0], text: city.news[1] }].slice(-4) : state.news });
}
const plans = new Map<number, { plan: CityPlan; base: HTMLCanvasElement | null }>();
function mapOf(seed: number) {
  let entry = plans.get(seed);
  if (!entry) { const plan = cityPlan(seed); plans.clear(); plans.set(seed, entry = { plan, base: paintCityMap(plan) }); }
  return entry;
}
const clock = (time: number) => { const minutes = Math.floor((6000 + time) % 24000 * 0.06); return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; };
const timer = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const closeAndResume = () => { closeScreen(); relockPointer(); };
/** The district a spot is in. The airfield and the strand lie outside the grid of blocks. */
const whereabouts = (x: number, z: number) => x >= AIRFIELD.x0 - 4 ? 'Gullwing Field' : z >= CITY.z0 + CITY_SIZE ? 'Sunny Strand'
  : districtAt(Math.max(0, Math.min(CITY.n - 1, Math.floor((x - CITY.x0 - CITY.road) / CITY.pitch))), Math.max(0, Math.min(CITY.n - 1, Math.floor((z - CITY.z0 - CITY.road) / CITY.pitch))));

/** Do what the context button says: board or leave a vehicle, talk, shop, read a board. */
export function cityAct() {
  const context = cityHud.get().context;
  if (!context || store.get().screen) return;
  if (context.kind === 'exit') sendCommand({ t: 'city', a: 'exit' });
  else if (context.kind === 'board') { const x = context.id % 4096, rest = (context.id - x) / 4096, z = rest % 4096; sendCommand({ t: 'use', x, y: (rest - z) / 4096, z, face: 3 }); }
  else sendCommand({ t: 'interact', id: context.id });
}
const typing = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');
/** F does the context action, H sounds the horn, M opens the map. */
export function useCityKeys(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const key = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      if (event.code === 'KeyF') cityAct();
      else if (event.code === 'KeyH' && cityHud.get().driving) sendCommand({ t: 'city', a: 'horn' });
      else if (event.code === 'KeyM') { if (store.get().screen === 'map') closeAndResume(); else if (!store.get().screen) openMenu('map'); }
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [on]);
}

/** Heat: a bar that fills through four named tiers, with a lamp that flashes while an officer has eyes on you. */
function Heat({ heat, seen }: { heat: number; seen: boolean }) {
  const tier = heatTier(heat);
  if (heat <= 0) return null;
  return <div className="bw-heat" data-tier={tier} data-seen={seen} role="img" aria-label={`Heat ${heat} of 100: ${HEAT_NAMES[tier]}${seen ? ', the Watch can see you' : ''}`}>
    <i className="bw-heat-lamp" aria-hidden="true"/>
    <span className="bw-heat-bar" aria-hidden="true"><b style={{ width: `${heat}%` }}/>{HEAT_TIERS.map(at => <u key={at} style={{ left: `${at}%` }}/>)}</span>
    <em>{HEAT_NAMES[tier]}</em>
  </div>;
}
function Coins({ coins }: { coins: number }) {
  const [bump, setBump] = useState(0), last = useRef(coins);
  useEffect(() => { if (coins !== last.current) { setBump(coins > last.current ? 1 : -1); last.current = coins; const t = setTimeout(() => setBump(0), 500); return () => clearTimeout(t); } return undefined; }, [coins]);
  return <b className="bw-coins kp-numeral" data-bump={bump} aria-label={`${coins} coins`}><i aria-hidden="true"/>{coins.toLocaleString()}</b>;
}

function markersFor(city: CityPrivate | null, plan: CityPlan, self: { x: number; z: number; yaw: number } | null, selfId: string | null, names: boolean): Marker[] {
  const board = cityBoard.get().board, markers: Marker[] = [];
  for (const player of feed.get().roster) {
    if (player.id === selfId || player.flags & PF.OFFLINE) continue;
    const hot = (board.find(row => row[0] === player.seat)?.[2] ?? 0) >= 2;
    markers.push({ x: player.x, z: player.z, color: player.color, kind: hot ? 'hot' : 'player', ...names ? { label: player.name } : {} });
  }
  if (city && city.flat >= 0) { const lot = plan.lots[city.flat]; if (lot) markers.push({ x: (lot.x0 + lot.x1) / 2, z: (lot.z0 + lot.z1) / 2, color: '#78d955', kind: 'home' }); }
  if (city && city.plot >= 0) { const plot = plan.plots[city.plot]; if (plot) markers.push({ x: (plot.x0 + plot.x1) / 2, z: (plot.z0 + plot.z1) / 2, color: '#b58aff', kind: 'plot' }); }
  if (city?.gig) markers.push({ x: city.gig.x, z: city.gig.z, color: '#ffd24a', kind: 'gig' });
  if (self) markers.push({ x: self.x, z: self.z, yaw: self.yaw, color: '#fff6e5', kind: 'self' });
  return markers;
}
/** A map canvas redrawn a few times a second. `span`: blocks across; `follow`: centre on the player, else show the whole city. */
function MapCanvas({ view, city, playerId, span, follow, signs, names, className }: { view: View; city: CityPrivate | null; playerId: string | null; span: number; follow: boolean; signs: boolean; names: boolean; className: string }) {
  const ref = useRef<HTMLCanvasElement>(null), latest = useRef({ view, city });
  latest.current = { view, city };
  useEffect(() => {
    const canvas = ref.current, { plan, base } = mapOf(view.seed);
    if (!canvas || !base) return;
    let drawn = '';
    const draw = () => {
      const box = canvas.getBoundingClientRect(), ratio = Math.min(2, window.devicePixelRatio || 1), w = Math.max(1, Math.round(box.width)), h = Math.max(1, Math.round(box.height));
      const body = store.get().body, self = playerId && body ? { x: body.x, z: body.z, yaw: cityLook.yaw } : null, gig = latest.current.city?.gig;
      // Redraw only when something on the map moved (to the nearest block or so).
      const state = `${w},${h},${self ? `${Math.round(self.x)},${Math.round(self.z)},${Math.round(self.yaw * 8)}` : ''},${gig ? `${gig.x},${gig.z}` : ''},${latest.current.city?.flat},${latest.current.city?.plot}|${feed.get().roster.map(player => `${player.x},${player.z},${player.flags & PF.OFFLINE}`).join(';')}|${cityBoard.get().board.map(row => row[2]).join('')}`;
      if (state === drawn) return;
      drawn = state;
      if (canvas.width !== w * ratio || canvas.height !== h * ratio) { canvas.width = w * ratio; canvas.height = h * ratio; }
      const ctx = canvas.getContext('2d', SOFT);
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const cx = follow && self ? self.x : MAP.x0 + MAP.w / 2, cz = follow && self ? self.z : MAP.z0 + MAP.h / 2;
      drawMap(ctx, base, plan, w, h, cx, cz, follow ? span : Math.max(MAP.w, MAP.h * w / h), markersFor(latest.current.city, plan, self, playerId, names), signs);
    };
    draw();
    const interval = setInterval(draw, 250);
    return () => clearInterval(interval);
  }, [view.seed, span, follow, signs, names, playerId]);
  return <canvas ref={ref} className={className} aria-hidden="true"/>;
}

function GigChip({ gig }: { gig: NonNullable<CityPrivate['gig']> }) {
  const body = useStore(store, s => s.body), d = body ? Math.round(Math.hypot(body.x - gig.x, body.z - gig.z)) : 0, kind = GIGS[gig.k]!;
  return <p className="bw-gig" data-late={gig.left < 15} role="status">
    <b>{kind.key === 'cab' && gig.stage === 0 ? 'Pick up the fare' : kind.key === 'cab' ? 'Drop the fare off' : `${kind.name}${gig.drops > 1 ? ' · 2 doors' : ''}`}</b>
    <span>{d} blocks · {timer(gig.left)} · {gig.pay} coins</span>
  </p>;
}

/** The city HUD on a playing seat (laid over the usual crosshair, hotbar and hearts). */
export function CityHud({ view, pv, playerId, touchMode }: { view: View; pv: PrivateView; playerId: string | null; touchMode: boolean }) {
  const city = pv.city!, context = useStore(cityHud, s => s.context), focus = useStore(cityHud, s => s.focus), driving = useStore(cityHud, s => s.driving), left = useStore(cityBoard, s => s.left);
  const body = useStore(store, s => s.body);
  useEffect(() => readCity(view), [view.city]);
  useEffect(() => readRoster(view), [view.roster]);
  return <>
    <div className="bw-city-corner">
      <button type="button" className="bw-minimap" aria-label="Open the city map" onClick={() => openMenu('map')}>
        <MapCanvas view={view} city={city} playerId={playerId} span={150} follow signs names={false} className="bw-minimap-canvas"/>
        <small>{body ? whereabouts(body.x, body.z) : 'Caper City'}</small>
      </button>
      <div className="bw-city-stats">
        <Coins coins={city.coins}/>
        <span className="bw-city-clock kp-numeral">{left !== null ? <em data-soon={left < 60}>{timer(left)} left</em> : clock(view.time)}</span>
        <Heat heat={city.heat} seen={!!city.seen}/>
        {city.gig && <GigChip gig={city.gig}/>}
      </div>
    </div>
    {city.grab !== undefined && <p className="bw-grab kp-hud-text" role="alert">An officer has hold of you! Get away!<i style={{ width: `${city.grab * 100}%` }}/></p>}
    {city.dizzy !== undefined && <p className="bw-dizzy kp-hud-text" aria-live="polite">★ Seeing stars ★</p>}
    {focus && !driving && <p className="bw-focus" data-prompt={!!context} aria-live="polite"><b>{focus.name}</b>{focus.line && <span>{focus.line}</span>}</p>}
    {/* Riding, the way out sits beside the speedometer: the middle of the screen is the vehicle's. */}
    {driving && <div className="bw-ridebar">
      <p className="bw-speedo" aria-label={`${RIDES[driving.k]!.name}, ${driving.speed} blocks a second`}><b className="kp-numeral">{driving.speed}</b><span>{RIDES[driving.k]!.name}{driving.seat ? ' · passenger' : ''}</span></p>
      {context && <button type="button" className="bw-context" data-kind={context.kind} aria-label={context.label} onClick={cityAct}>{!touchMode && <kbd>F</kbd>}Leave</button>}
    </div>}
    {context && !driving && <button type="button" className="bw-context" data-kind={context.kind} onClick={cityAct}>{!touchMode && <kbd>F</kbd>}{context.label}</button>}
    {driving && touchMode && <div className="bw-drive-buttons">
      <button type="button" className="bw-tbtn bw-tbtn-small" aria-label="Horn" onClick={() => sendCommand({ t: 'city', a: 'horn' })}>Horn</button>
    </div>}
  </>;
}

// Sheets ---------------------------------------------------------------------------------------------------------------
const PLACE_BLURB: Record<PlaceKind, string> = {
  food: 'Food mends your hearts. Hold Use to eat.', gizmo: 'Tools of the trade for mischief-makers.', hardware: 'Blocks for building on a plot of your own.', pawn: 'Loot bought, no questions asked.',
  realtor: 'A flat is a home (heat drains fast there). A plot is yours to build on.', hall: 'A flat is a home (heat drains fast there). A plot is yours to build on.', cabs: 'Fares wait on the job board outside.',
  depot: 'Parcel rounds are on the job board outside.', dealer: 'Bought vehicles are yours for good: no heat for driving them, and they come when called.', scrap: 'Drive a vehicle into the yard and sell it for scrap.',
  clinic: 'Patched up while you wait.', watch: 'Settle up before they come looking.', bank: 'Your coins are safe in your pocket. Probably.', airfield: 'Aircraft are delivered to the pads outside.',
};
function offerText(offer: Offer, city: CityPrivate): { name: string; note: string; price: number; icon?: number; done?: boolean } {
  switch (offer.t) {
    case 'item': return { name: `${offer.n > 1 ? `${offer.n} × ` : ''}${itemName(offer.id)}`, note: '', price: offer.price, icon: offer.id };
    case 'ride': { const kind = RIDES[offer.k]!, owned = (city.own >> offer.k & 1) === 1; return { name: kind.name, note: owned ? 'Yours: bring it round' : `${kind.seats} seat${kind.seats > 1 ? 's' : ''} · top speed ${kind.top}`, price: owned ? 0 : offer.price, done: false }; }
    case 'flat': return { name: 'A flat of your own', note: city.flat >= 0 ? 'You have one' : 'A home to lie low in', price: offer.price, done: city.flat >= 0 };
    case 'plot': return { name: 'A plot of land', note: city.plot >= 0 ? 'You have one' : '12 × 12 blocks to build on', price: offer.price, done: city.plot >= 0 };
    case 'heal': return { name: 'Full patch-up', note: 'All ten hearts', price: offer.price };
    case 'cool': return { name: 'Pay off your heat', note: city.heat > 0 ? `${HEAT_NAMES[heatTier(city.heat)]}: ${Math.round(city.heat)} points` : 'Your slate is clean', price: Math.max(10, Math.ceil(city.heat) * offer.price), done: city.heat <= 0 };
  }
}
/** A shop counter or a job board: whichever the server has open for this seat. */
export function CityCounter({ view, pv }: { view: View; pv: PrivateView }) {
  const city = pv.city!, { plan } = mapOf(view.seed), place = plan.places[city.open ?? -1], inv = useStore(store, s => s.inv), driving = useStore(cityHud, s => s.driving);
  if (!place) return null;
  const sign = signUrl(place.kind);
  const head = <span className="bw-counter-coins"><Coins coins={city.coins}/></span>;
  if (city.offers) return <Sheet title="Job board" className="bw-counter-sheet" onClose={closeAndResume} tools={head}>
    <p className="bw-note">{place.name} · pick one. A new batch goes up every minute.</p>
    <ul className="bw-offers">{city.offers.map((offer, i) => {
      const body = store.get().body, d = body ? Math.round(Math.hypot(body.x - offer.x, body.z - offer.z)) : 0, kind = GIGS[offer.k]!;
      return <li key={i} className="bw-offer" data-state="ready">
        <span className="bw-offer-deal"><b className="bw-gig-pay kp-numeral">{offer.pay}</b><span className="bw-offer-name">{kind.name} to {whereabouts(offer.x, offer.z)}<small>{d} blocks · {timer(offer.secs)}{offer.k === 2 ? ' · needs a vehicle' : d > 220 ? ' · best on wheels' : ''}</small></span></span>
        <button type="button" className="bw-offer-go" onClick={() => { sendCommand({ t: 'city', a: 'gig', i }); store.set({ screen: null }); relockPointer(); }}>Take it</button>
      </li>;
    })}</ul>
    {!city.offers.length && <p className="bw-empty">Nothing on the board right now.</p>}
  </Sheet>;
  const offers = CATALOG[place.kind], loot = inv.map((slot, i) => ({ slot, i })).filter(({ slot }) => slot && LOOT[slot.id]);
  return <Sheet title={place.name} className="bw-counter-sheet" onClose={closeAndResume} tools={head}>
    <p className="bw-note">{sign && <img className="bw-sign" src={sign} alt=""/>}{PLACE_BLURB[place.kind]}</p>
    {offers.length > 0 && <ul className="bw-offers">{offers.map((offer, i) => {
      const text = offerText(offer, city), short = city.coins < text.price;
      return <li key={i} className="bw-offer" data-state={text.done ? 'sold' : short ? 'short' : 'ready'}>
        <span className="bw-offer-deal">{text.icon !== undefined && <span className="bw-deal"><ItemIcon id={text.icon}/></span>}<span className="bw-offer-name">{text.name}{text.note && <small>{text.note}</small>}</span></span>
        <button type="button" className="bw-offer-go" disabled={text.done || short} aria-label={`${text.name} for ${text.price} coins`} onClick={() => sendCommand({ t: 'city', a: 'buy', i })}>{text.price ? `${text.price}` : 'Fetch'}<i aria-hidden="true"/></button>
      </li>;
    })}</ul>}
    {place.kind === 'pawn' && (loot.length ? <ul className="bw-offers">{loot.map(({ slot, i }) => <li key={i} className="bw-offer" data-state="ready">
      <span className="bw-offer-deal"><span className="bw-deal"><ItemIcon id={slot!.id}/></span><span className="bw-offer-name">{slot!.n} × {itemName(slot!.id)}</span></span>
      <button type="button" className="bw-offer-go" onClick={() => sendCommand({ t: 'city', a: 'sell', i })}>Sell for {LOOT[slot!.id]! * slot!.n}<i aria-hidden="true"/></button>
    </li>)}</ul> : <p className="bw-empty">You have nothing to sell. Purses, watches and swag bags fetch a price here.</p>)}
    {place.kind === 'scrap' && <p className="bw-empty">{driving ? `Your ${RIDES[driving.k]!.name} is worth ${scrapValue(driving.k)} coins in the yard.` : 'Drive in and press the Scrap button on your map to sell what you are driving.'}</p>}
  </Sheet>;
}
/** Pockets: what the player carries (no crafting in the city). */
export function CityPockets({ pv }: { pv: PrivateView }) {
  const city = pv.city!;
  return <Sheet title="Pockets" className="bw-counter-sheet" onClose={closeAndResume} tools={<><span className="bw-counter-coins"><Coins coins={city.coins}/></span><QuickMove/></>}>
    <section className="bw-slots-panel"><PlayerSlots/></section>
    <p className="bw-note">Food heals. Loot sells at pawn shops. Blocks are for a plot of your own.</p>
  </Sheet>;
}
/** The whole city, with everyone on it, what you own and what you can call. */
export function CityMap({ view, pv, playerId }: { view: View; pv: PrivateView; playerId: string | null }) {
  const city = pv.city!, owned = RIDES.map((kind, k) => ({ kind, k })).filter(({ k }) => city.own >> k & 1), driving = useStore(cityHud, s => s.driving);
  const kinds = useMemo(() => [...new Set(mapOf(view.seed).plan.places.map(place => place.kind))], [view.seed]);
  const act = (cmd: Parameters<typeof sendCommand>[0]) => { sendCommand(cmd); store.set({ screen: null }); relockPointer(); };
  return <Sheet title="Caper City" className="bw-map-sheet" onClose={closeAndResume} tools={<span className="bw-counter-coins"><Coins coins={city.coins}/></span>}>
    <div className="bw-map-layout">
      {/* Names beside the dots only while they can be read: a big room is a cloud of labels. */}
      <MapCanvas view={view} city={city} playerId={playerId} span={MAP.w} follow={false} signs names={view.who.length <= 12} className="bw-map-canvas"/>
      <div className="bw-map-side">
        <ul className="bw-legend" aria-label="Places">{kinds.map(kind => <li key={kind}><img className="bw-sign" src={signUrl(kind)} alt=""/>{LEGEND[kind]}</li>)}</ul>
        <div className="bw-map-actions">
          {city.gig && <button type="button" className="bw-chip" onClick={() => act({ t: 'city', a: 'quit' })}>Drop the gig</button>}
          {driving && !driving.seat && <button type="button" className="bw-chip" onClick={() => act({ t: 'city', a: 'scrap' })}>Scrap this vehicle</button>}
          {!driving && owned.map(({ kind, k }) => <button key={k} type="button" className="bw-chip" onClick={() => act({ t: 'city', a: 'call', i: k })}>Call my {kind.name}</button>)}
        </div>
      </div>
    </div>
  </Sheet>;
}
const LEGEND: Record<PlaceKind, string> = {
  food: 'Food', gizmo: 'Gadgets', hardware: 'Building blocks', pawn: 'Pawn shop', realtor: 'Flats and plots', hall: 'Town hall', cabs: 'Cab stand', depot: 'Zip Post depot', dealer: 'Vehicle dealer',
  scrap: 'Scrapyard', clinic: 'Clinic', watch: 'Watch House', bank: 'Bank', airfield: 'Airfield',
};
/** Knocked out: the city's take on the death screen. */
export function KnockedOut({ message }: { message?: string }) {
  const pending = useStore(store, s => s.queue.some(cmd => cmd.t === 'respawn'));
  return <div className="bw-death bw-knocked" role="alertdialog" aria-labelledby="bw-death-title">
    <h2 id="bw-death-title" className="kp-title">Knocked out!</h2>
    <p>{message ? message.replace(/ (fell|hit|was|died|drowned).*/, ' is seeing stars.') : 'You are seeing stars.'}</p>
    <p className="bw-death-items" data-kept="true">The clinic will patch you up for a small bill. You keep what you carry.</p>
    <button type="button" className="bw-resume" disabled={pending} autoFocus onClick={() => sendCommand({ t: 'respawn' })}>{pending ? 'Coming round…' : 'Wake at the clinic'}</button>
  </div>;
}

// The TV ---------------------------------------------------------------------------------------------------------------
/** The watching display in the city: the clock, the round timer, the map with everyone on it, the wanted and the rich, and the news. */
export function CityDisplay({ publicView: view }: GameViewProps<Input, Action, View, PrivateView>) {
  const roster = useStore(feed, s => s.roster), board = useStore(cityBoard, s => s.board), left = useStore(cityBoard, s => s.left), news = useStore(cityBoard, s => s.news), focus = useStore(hud, s => s.focus);
  useEffect(() => readRoster(view), [view.roster]);
  useEffect(() => readCity(view), [view.city]);
  const seats = seatsOf(view.who), online = roster.filter(player => !(player.flags & PF.OFFLINE)).length, row = (seat: number) => seats[seat];
  const wanted = board.filter(entry => entry[2]! >= 1).sort((a, b) => b[2]! - a[2]!).slice(0, 3), rich = [...board].sort((a, b) => b[3]! - a[3]!).slice(0, 5), subject = roster.find(player => player.id === focus);
  return <div className="bw-tv bw-city-tv" data-density={view.who.length > 12 ? 'crowd' : 'row'}>
    <header className="bw-tv-top">
      <DayClock time={view.time} day={view.day}/>
      <div className="bw-tv-world">
        <b className="bw-city-title kp-display">Caper City</b>
        <span className="bw-tv-meta">{left !== null ? <em data-soon={left < 60}>{timer(left)} left · </em> : ''}{online} of {view.who.length} out and about · {clock(view.time)} · seed {view.seed}</span>
      </div>
    </header>
    <aside className="bw-city-panel">
      <MapCanvas view={view} city={null} playerId={null} span={MAP.w} follow={false} signs names={view.who.length <= 12} className="bw-city-tvmap"/>
      {wanted.length > 0 && <section className="bw-city-list" data-kind="wanted"><h3>Most wanted</h3><ol>{wanted.map(entry => <li key={entry[0]} style={{ '--player': row(entry[0]!)?.color } as CSSProperties}><i/><b>{row(entry[0]!)?.name}</b><em>{HEAT_NAMES[entry[2]!]}</em></li>)}</ol></section>}
      <section className="bw-city-list"><h3>Richest</h3><ol>{rich.map(entry => <li key={entry[0]} style={{ '--player': row(entry[0]!)?.color } as CSSProperties}><i/><b>{row(entry[0]!)?.name}</b><em className="kp-numeral">{entry[3]!.toLocaleString()}</em></li>)}</ol></section>
    </aside>
    {subject && <p className="bw-city-oncam kp-hud-text" style={{ '--player': subject.color } as CSSProperties}><i/>On camera: <b>{subject.name}</b> · {whereabouts(subject.x, subject.z)}</p>}
    {news.length > 0 && <ul className="bw-city-news" aria-live="polite">{news.slice(-3).map(line => <li key={line.n}>{line.text}</li>)}</ul>}
    {roster.length > 0 && !online && <p className="bw-tv-hint kp-hud-text">Everyone stepped away. Rejoin on your phone with the room code to get back to the city.</p>}
  </div>;
}

/** The City Ledger: everyone ranked by what they are worth, with what the round made of them. */
export function CityResults({ outcome, publicView: view, playerId }: ResultsViewProps<View>) {
  const ledger = decodeLedger(view), players = seatsOf(view.who), won = cityAwards(ledger);
  const rows = [...outcome.rows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((row, rank) => ({ row, rank, player: players.find(p => p.id === row.playerId), entry: ledger.find(e => e.id === row.playerId) }));
  return <div className="bw-results bw-ledger">
    <p className="kp-eyebrow">The City Ledger</p>
    <h1>{view.day === 0 ? 'One day in Caper City' : `${view.day + 1} days in Caper City`}</h1>
    <ol className="bw-journal">
      {rows.map(({ row, rank, player, entry }) => <li key={row.playerId} data-me={row.playerId === playerId} style={{ '--player': player?.color ?? 'var(--kp-sky)' } as CSSProperties}>
        <b className="bw-journal-name"><small className="kp-numeral">#{rank + 1}</small> {player?.name ?? 'Player'}</b>
        {won.filter(award => award.ids.includes(row.playerId)).map(award => <span key={award.key} className="bw-award">{award.title}</span>)}
        {entry ? <dl>
          <div><dt>Worth</dt><dd>{entry.worth.toLocaleString()}</dd></div><div><dt>Gigs</dt><dd>{entry.gigs}</dd></div><div><dt>Bonks</dt><dd>{entry.bonks}</dd></div>
          <div><dt>Nabbed</dt><dd>{entry.busts}</dd></div><div><dt>Escapes</dt><dd>{entry.escapes}</dd></div><div><dt>Driven</dt><dd>{entry.drove.toLocaleString()} m</dd></div>
        </dl> : <p className="kp-muted">{row.label ?? ''}</p>}
      </li>)}
    </ol>
  </div>;
}
