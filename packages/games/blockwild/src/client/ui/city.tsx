/**
 * Caper City's interface: the HUD (coins, the Heat meter, the minimap, the gig in hand, the context button), the shop
 * counter, job board, pockets and map sheets, the TV's panel and the City Ledger. Everything here is the city's own
 * look: a brass-and-enamel street-sign style inside the PartyPlay family (kp- tokens and fonts).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { GameViewProps, ResultsViewProps } from '../../../../../party-ui/src/index';
import { BIZ, CATALOG, cityAwards, GIGS, HATS, heatTier, HEAT_NAMES, HEAT_TIERS, scrapValue, sellPrice, shopPrice, tunePrice, type Offer } from '../../shared/city/economy';
import { AIRFIELD, cityPlan, districtAt, CITY, CITY_SIZE, type CityPlan, type PlaceKind } from '../../shared/city/plan';
import { cityExtras } from '../../shared/city/extras';
import { titleFor } from '../../shared/city/passport';
import { RIDES } from '../../shared/city/vehicles';
import { itemName } from '../../shared/items';
import { decodeLedger, PF, seatsOf, type Action, type CityPrivate, type CityView, type Input, type PrivateView, type View } from '../../shared/protocol';
import { drawMap, MAP, paintCityMap, signUrl, SOFT, type Marker } from '../city/map';
import { cityHud, cityLook, EVENT_COLORS, GIFT, spots } from '../city/scene';
import { feed, readRoster } from '../game/feed';
import { hud } from '../game/hud';
import { closeScreen, sendCommand } from '../game/predict';
import { createStore, store } from '../store';
import { DayClock } from './display';
import { ItemIcon } from './icons';
import { careerNow, ErrandChip, stallAt, TodoCard, useCareer } from './city-extra';
import { PlayerSlots, QuickMove, Sheet } from './screens';
import { openMenu, relockPointer, useStore } from './state';

/** The scoreboard arrives about once a second in the public view; the newest is kept here with the last few news lines. */
export const cityBoard = createStore<{ board: number[][]; left: number | null; news: { n: number; text: string }[]; ev: number[][]; races: number[][] }>({ board: [], left: null, news: [], ev: [], races: [] });
export function readCity(view: View) {
  const city: CityView | undefined = view.city;
  if (!city) return;
  const state = cityBoard.get(), last = state.news[state.news.length - 1]?.n ?? 0;
  cityBoard.set({ board: city.board, left: city.left ?? null, ev: city.ev ?? [], races: city.races ?? [], news: city.news && city.news[0] !== last ? [...state.news, { n: city.news[0], text: city.news[1] }].slice(-4) : state.news });
}
const plans = new Map<number, { plan: CityPlan; base: HTMLCanvasElement | null }>();
function mapOf(seed: number) {
  let entry = plans.get(seed);
  if (!entry) { const plan = cityPlan(seed); plans.clear(); plans.set(seed, entry = { plan, base: paintCityMap(plan) }); }
  return entry;
}
/** What goes on in the city, by EV kind: the name on a map and the colour of its mark. */
export const EVENT_NAMES = ['Parcels!', 'Crate', 'Fire!', 'The Gull', 'Sale', 'Blackout', 'Bounty', 'Bank job', 'Race'];
const EVENT_CSS = EVENT_COLORS.map(color => `#${color.toString(16).padStart(6, '0')}`);
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
  else if (context.kind === 'give') sendCommand({ t: 'city', a: 'give', i: context.id, j: GIFT });
  else if (context.kind === 'spot') {
    // A stall or the prize booth opens its own sheet; every other spot is one command.
    const spot = spots.list[context.id];
    if (spot?.kind === 'stall' || spot?.kind === 'prize') { stallAt.set({ stall: spot.kind === 'prize' ? 3 : spot.a }); openMenu('stall'); }
    else sendCommand({ t: 'city', a: 'spot', i: context.id });
  }
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
      else if (event.code === 'KeyG' && cityHud.get().spot) sendCommand({ t: 'city', a: 'spot', i: cityHud.get().spot!.id });
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
  for (const event of cityBoard.get().ev) markers.push({ x: event[1]!, z: event[2]!, color: EVENT_CSS[event[0]!] ?? '#fff6e5', kind: 'event', ...names ? { label: EVENT_NAMES[event[0]!] ?? '' } : {} });
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
      const state = `${w},${h},${self ? `${Math.round(self.x)},${Math.round(self.z)},${Math.round(self.yaw * 8)}` : ''},${gig ? `${gig.x},${gig.z}` : ''},${latest.current.city?.flat},${latest.current.city?.plot}|${feed.get().roster.map(player => `${player.x},${player.z},${player.flags & PF.OFFLINE}`).join(';')}|${cityBoard.get().board.map(row => row[2]).join('')}|${cityBoard.get().ev.map(event => `${event[0]},${event[1]},${event[2]}`).join(';')}`;
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

const HOLD_NAMES: Record<string, string> = { 'Stop cracking': 'Cracking the vault…', 'Let go of the bell': 'Holding the alarm bell', 'Leave the lock': 'Working the lock…' };
const ORDINALS = ['', '1st', '2nd', '3rd'];
/** The race in hand: when it starts, or flags taken, place and time. */
function RaceChip({ race, seed }: { race: number[]; seed: number }) {
  const [, lap, place, field, secs, course] = race as [number, number, number, number, number, number], track = cityExtras(seed).courses[course];
  if (!track) return null;
  return <p className="bw-gig bw-race" data-late={secs < 0 && secs > -6} role="status">
    <b>{track.name}</b>
    <span>{secs < 0 ? `Starts in ${-secs}s · ${field} at the flag` : `Flag ${Math.min(lap + 1, track.points.length)}/${track.points.length}${field > 1 ? ` · ${ORDINALS[place] ?? `${place}th`} of ${field}` : ''} · ${timer(secs)}`}</span>
  </p>;
}
function GigChip({ gig }: { gig: NonNullable<CityPrivate['gig']> }) {
  const body = useStore(store, s => s.body), d = body ? Math.round(Math.hypot(body.x - gig.x, body.z - gig.z)) : 0, kind = GIGS[gig.k]!;
  return <p className="bw-gig" data-late={gig.left < 15} role="status">
    <b>{kind.key === 'cab' ? gig.stage === 0 ? 'Pick up the fare' : 'Drop the fare off' : kind.key === 'medic' ? gig.stage === 0 ? 'Fetch the patient' : 'Back to the clinic' : kind.key === 'bus' ? `Bus route · ${gig.drops} stop${gig.drops > 1 ? 's' : ''} to go`
      : kind.key === 'fire' ? 'Fire call · put it out' : `${kind.name}${gig.drops > 1 ? ' · 2 doors' : ''}`}</b>
    <span>{d} blocks · {timer(gig.left)} · {gig.pay} coins</span>
  </p>;
}

/** The city HUD on a playing seat (laid over the usual crosshair, hotbar and hearts). */
export function CityHud({ view, pv, playerId, touchMode }: { view: View; pv: PrivateView; playerId: string | null; touchMode: boolean }) {
  const city = pv.city!, context = useStore(cityHud, s => s.context), focus = useStore(cityHud, s => s.focus), driving = useStore(cityHud, s => s.driving), left = useStore(cityBoard, s => s.left), spot = useStore(cityHud, s => s.spot);
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
        {city.race && <RaceChip race={city.race} seed={view.seed}/>}
        {city.errand && !city.gig && !city.race && <ErrandChip errand={city.errand}/>}
        {/* With nothing pressing, three things worth trying next. */}
        {!city.gig && !city.race && !city.errand && !city.heat && !driving && <TodoCard/>}
      </div>
    </div>
    {city.grab !== undefined && <p className="bw-grab kp-hud-text" role="alert">An officer has hold of you! Get away!<i style={{ width: `${city.grab * 100}%` }}/></p>}
    {city.dizzy !== undefined && <p className="bw-dizzy kp-hud-text" aria-live="polite">★ Seeing stars ★</p>}
 {city.hold !== undefined && <p className="bw-hold kp-hud-text" role="progressbar" aria-valuenow={Math.round(city.hold * 100)} aria-valuemin={0} aria-valuemax={100}>{context?.kind === 'spot' ? HOLD_NAMES[context.label] ?? 'Working…' : 'Working…'}<i style={{ width: `${city.hold * 100}%` }}/></p>}
    {city.fish && <p className="bw-fish kp-hud-text" data-bite={city.fish[0] === 2} role="status">{city.fish[0] === 2 ? 'A bite! Use, now!' : 'Line out. Watch the float…'}</p>}
    {driving && spot && <button type="button" className="bw-context bw-spot" onClick={() => sendCommand({ t: 'city', a: 'spot', i: spot.id })}>{!touchMode && <kbd>G</kbd>}{spot.label}</button>}
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
  hats: 'A hat says who you are. Yours to keep.', fire: 'Fire calls are on the board outside. Take an engine.', bus: 'Routes are on the board outside. Take a bus.', bait: 'Cast from the pier or any shore. The hut buys what you land.',
};
function offerText(offer: Offer, city: CityPrivate): { name: string; note: string; price: number; icon?: number; done?: boolean } {
  switch (offer.t) {
    case 'item': return { name: `${offer.n > 1 ? `${offer.n} × ` : ''}${itemName(offer.id)}`, note: '', price: offer.price, icon: offer.id };
    case 'ride': { const kind = RIDES[offer.k]!, owned = (city.own >> offer.k & 1) === 1; return { name: kind.name, note: owned ? 'Yours: bring it round' : `${kind.seats} seat${kind.seats > 1 ? 's' : ''} · top speed ${kind.top}`, price: owned ? 0 : offer.price, done: false }; }
    case 'flat': return { name: 'A flat of your own', note: city.flat >= 0 ? 'You have one' : 'A home to lie low in', price: offer.price, done: city.flat >= 0 };
    case 'plot': return { name: 'A plot of land', note: city.plot >= 0 ? 'You have one' : '12 × 12 blocks to build on', price: offer.price, done: city.plot >= 0 };
    case 'heal': return { name: 'Full patch-up', note: 'All ten hearts', price: offer.price };
    case 'cool': return { name: 'Pay off your heat', note: city.heat > 0 ? `${HEAT_NAMES[heatTier(city.heat)]}: ${Math.round(city.heat)} points` : 'Your slate is clean', price: Math.max(10, Math.ceil(city.heat) * offer.price), done: city.heat <= 0 };
    case 'hat': { const worn = (careerNow().look & 15) === offer.k; return { name: HATS[offer.k]!.name, note: worn ? 'You are wearing it' : '', price: offer.price, done: worn }; }
  }
}
/** The price a counter shows this seat: the town's friends pay less, anyone its shopkeepers are wary of pays more. */
const shown = (offer: Offer, price: number, city: CityPrivate) => offer.t === 'item' || offer.t === 'hat' || offer.t === 'heal' ? shopPrice(price, careerNow().rep & 127, !!city.wary) : price;
/** A shop counter or a job board: whichever the server has open for this seat. */
export function CityCounter({ view, pv, playerId }: { view: View; pv: PrivateView; playerId: string | null }) {
  const city = pv.city!, { plan } = mapOf(view.seed), place = plan.places[city.open ?? -1], inv = useStore(store, s => s.inv), driving = useStore(cityHud, s => s.driving), career = useCareer();
  if (!place) return null;
  const sign = signUrl(place.kind);
  const head = <span className="bw-counter-coins"><Coins coins={city.coins}/></span>;
  if (city.offers) return <Sheet title="Job board" className="bw-counter-sheet" onClose={closeAndResume} tools={head}>
    <p className="bw-note">{place.name} · pick one. A new batch goes up every minute.</p>
    <ul className="bw-offers">{city.offers.map((offer, i) => {
      const body = store.get().body, d = body ? Math.round(Math.hypot(body.x - offer.x, body.z - offer.z)) : 0, kind = GIGS[offer.k]!;
      return <li key={i} className="bw-offer" data-state="ready">
        <span className="bw-offer-deal"><b className="bw-gig-pay kp-numeral">{offer.pay}</b><span className="bw-offer-name">{kind.name} {offer.k === 5 ? 'in' : 'to'} {whereabouts(offer.x, offer.z)}<small>{d} blocks · {timer(offer.secs)}{GIG_NOTES[offer.k] ?? (d > 220 ? ' · best on wheels' : '')}</small></span></span>
        <button type="button" className="bw-offer-go" onClick={() => { sendCommand({ t: 'city', a: 'gig', i }); store.set({ screen: null }); relockPointer(); }}>Take it</button>
      </li>;
    })}</ul>
    {!city.offers.length && <p className="bw-empty">Nothing on the board right now.</p>}
  </Sheet>;
  const magpies = career.rep >> 14 & 127, offers = CATALOG[place.kind], loot = inv.map((slot, i) => ({ slot, i })).filter(({ slot }) => slot && sellPrice(magpies, place.kind, slot.id) > 0);
  const deal = BIZ[place.kind], mine = city.owner !== undefined && view.who[city.owner]?.[0] === playerId, tunable = place.kind === 'dealer' || place.kind === 'airfield' || place.kind === 'bait' ? RIDES.map((kind, k) => ({ kind, k })).filter(({ kind, k }) => kind.price > 0 && city.own >> k & 1 && !(career.look >> 7 >> k & 1) && offers.some(offer => offer.t === 'ride' && offer.k === k)) : [];
  return <Sheet title={place.name} className="bw-counter-sheet" onClose={closeAndResume} tools={head}>
    <p className="bw-note">{sign && <img className="bw-sign" src={sign} alt=""/>}{PLACE_BLURB[place.kind]}</p>
    {offers.length > 0 && <ul className="bw-offers">{offers.map((offer, i) => {
      const base = offerText(offer, city), text = { ...base, price: shown(offer, base.price, city) }, short = city.coins < text.price;
      return <li key={i} className="bw-offer" data-state={text.done ? 'sold' : short ? 'short' : 'ready'}>
        <span className="bw-offer-deal">{text.icon !== undefined && <span className="bw-deal"><ItemIcon id={text.icon}/></span>}<span className="bw-offer-name">{text.name}{text.note && <small>{text.note}</small>}</span></span>
        <button type="button" className="bw-offer-go" disabled={text.done || short} aria-label={`${text.name} for ${text.price} coins`} onClick={() => sendCommand({ t: 'city', a: 'buy', i })}>{text.price ? `${text.price}` : 'Fetch'}<i aria-hidden="true"/></button>
      </li>;
    })}</ul>}
    {tunable.length > 0 && <ul className="bw-offers">{tunable.map(({ kind, k }) => <li key={k} className="bw-offer" data-state={city.coins < tunePrice(k) ? 'short' : 'ready'}>
      <span className="bw-offer-deal"><span className="bw-offer-name">Tune-up: {kind.name}<small>A quicker top speed, for good</small></span></span>
      <button type="button" className="bw-offer-go" disabled={city.coins < tunePrice(k)} aria-label={`Tune the ${kind.name} for ${tunePrice(k)} coins`} onClick={() => sendCommand({ t: 'city', a: 'tune', i: k })}>{tunePrice(k)}<i aria-hidden="true"/></button>
    </li>)}</ul>}
    {(place.kind === 'pawn' || place.kind === 'bait' || loot.length > 0) && (loot.length ? <ul className="bw-offers">{loot.map(({ slot, i }) => <li key={i} className="bw-offer" data-state="ready">
      <span className="bw-offer-deal"><span className="bw-deal"><ItemIcon id={slot!.id}/></span><span className="bw-offer-name">{slot!.n} × {itemName(slot!.id)}</span></span>
      <button type="button" className="bw-offer-go" onClick={() => sendCommand({ t: 'city', a: 'sell', i })}>Sell for {sellPrice(magpies, place.kind, slot!.id) * slot!.n}<i aria-hidden="true"/></button>
    </li>)}</ul> : <p className="bw-empty">{place.kind === 'bait' ? 'Bring what you catch here: every fish has its price.' : 'You have nothing to sell. Purses, watches and swag bags fetch a price here.'}</p>)}
    {deal && <p className="bw-biz" data-mine={mine}>
      {mine ? <span><b>Your business.</b> It pays {deal[1]} coins a minute and a cut of what others spend here.</span>
        : city.owner !== undefined ? <span><b>{view.who[city.owner]?.[1] ?? 'Somebody'}</b> owns this business.</span>
        : <><span><b>For sale.</b> Pays {deal[1]} coins a minute and a cut of what others spend.</span><button type="button" className="bw-offer-go" disabled={city.coins < deal[0]} aria-label={`Buy ${place.name} for ${deal[0]} coins`} onClick={() => sendCommand({ t: 'city', a: 'biz' })}>{deal[0]}<i aria-hidden="true"/></button></>}
    </p>}
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
          <button type="button" className="bw-chip" onClick={() => store.set({ screen: 'passport' })}>Passport</button>
          {city.gig && <button type="button" className="bw-chip" onClick={() => act({ t: 'city', a: 'quit' })}>Drop the gig</button>}
          {driving && !driving.seat && <button type="button" className="bw-chip" onClick={() => act({ t: 'city', a: 'scrap' })}>Scrap this vehicle</button>}
          {!driving && owned.map(({ kind, k }) => <button key={k} type="button" className="bw-chip" onClick={() => act({ t: 'city', a: 'call', i: k })}>Call my {kind.name}</button>)}
        </div>
      </div>
    </div>
  </Sheet>;
}
/** What a gig needs, by kind, for the lines on a job board. */
const GIG_NOTES: Record<number, string> = { 2: ' · fetch the fare first, in anything with a spare seat', 3: ' · take a bus from the yard', 4: ' · take the Patch Wagon', 5: ' · take an engine, or water balloons' };
const LEGEND: Record<PlaceKind, string> = {
  food: 'Food', gizmo: 'Gadgets', hardware: 'Building blocks', pawn: 'Pawn shop', realtor: 'Flats and plots', hall: 'Town hall', cabs: 'Cab stand', depot: 'Zip Post depot', dealer: 'Vehicle dealer',
  scrap: 'Scrapyard', clinic: 'Clinic', watch: 'Watch House', bank: 'Bank', airfield: 'Airfield', hats: 'Hat shop', fire: 'Fire brigade', bus: 'Bus depot', bait: 'Bait hut and boats',
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
/** The boards the TV turns through under the map: [title, column of the scoreboard row, unit, the least worth showing]. Richest is always there. */
const BOARDS: readonly (readonly [string, number, string, number])[] = [['Richest', 3, '', 0], ['Most stamps', 4, ' stamps', 1], ['Best angler', 5, ' fish', 1], ['Race wins', 6, ' wins', 1], ['Longest jump', 7, ' blocks', 6]];
const BOARD_SECONDS = 9, BANNER_SECONDS = 7;
/** The watching display in the city: the clock, the round timer, the map with everyone on it, what is going on, the wanted and a board that turns, and the news. */
export function CityDisplay({ publicView: view }: GameViewProps<Input, Action, View, PrivateView>) {
  const roster = useStore(feed, s => s.roster), board = useStore(cityBoard, s => s.board), left = useStore(cityBoard, s => s.left), news = useStore(cityBoard, s => s.news), events = useStore(cityBoard, s => s.ev), races = useStore(cityBoard, s => s.races);
  const focus = useStore(hud, s => s.focus), cutting = useStore(hud, s => s.cutting);
  useEffect(() => readRoster(view), [view.roster]);
  useEffect(() => readCity(view), [view.city]);
  const seats = seatsOf(view.who), online = roster.filter(player => !(player.flags & PF.OFFLINE)).length, row = (seat: number) => seats[seat];
  const wanted = board.filter(entry => entry[2]! >= 1).sort((a, b) => b[2]! - a[2]!).slice(0, 3), subject = roster.find(player => player.id === focus);
  // A board at a time: the ones with nothing on them yet are skipped.
  const [turn, setTurn] = useState(0), live = BOARDS.filter(([, column, , least], k) => !k || board.some(entry => (entry[column] ?? 0) >= least));
  useEffect(() => { const timer = setInterval(() => setTurn(n => n + 1), BOARD_SECONDS * 1000); return () => clearInterval(timer); }, []);
  const [title, column, unit, least] = live[turn % live.length] ?? BOARDS[0]!, top = [...board].filter(entry => (entry[column] ?? 0) >= least).sort((a, b) => b[column]! - a[column]!).slice(0, wanted.length || events.length > 2 ? 4 : 5);
  // The newest line of news is a banner for a few seconds, then joins the ticker.
  const newest = news[news.length - 1], [banner, setBanner] = useState<{ n: number; text: string } | null>(null);
  useEffect(() => { if (!newest) return undefined; setBanner(newest); const timer = setTimeout(() => setBanner(null), BANNER_SECONDS * 1000); return () => clearTimeout(timer); }, [newest?.n]);
  const going = events.filter(event => event[0] !== 6).slice(0, 4), courses = cityExtras(view.seed).courses;
  return <div className="bw-tv bw-city-tv" data-density={view.who.length > 12 ? 'crowd' : 'row'}>
    <header className="bw-tv-top">
      <DayClock time={view.time} day={view.day}/>
      <div className="bw-tv-world">
        <b className="bw-city-title kp-display">Caper City</b>
        <span className="bw-tv-meta">{left !== null ? <em data-soon={left < 60}>{timer(left)} left · </em> : ''}{online} of {view.who.length} out and about · {clock(view.time)} · seed {view.seed}</span>
      </div>
    </header>
    {/* A cut to a far corner arrives before that corner is drawn: the map covers for it. */}
    {cutting && subject && <div className="bw-city-cut" role="status"><p className="kp-display">Over to {subject.name}</p><span>{whereabouts(subject.x, subject.z)}</span></div>}
    {banner && <p className="bw-city-banner" role="status" key={banner.n}><b>Caper City News</b><span>{banner.text}</span></p>}
    <aside className="bw-city-panel">
      <MapCanvas view={view} city={null} playerId={null} span={MAP.w} follow={false} signs names={view.who.length <= 12} className="bw-city-tvmap"/>
      {(going.length > 0 || races.length > 0) && <section className="bw-city-list" data-kind="now"><h3>Happening now</h3><ol>
        {races.map(race => <li key={`r${race[0]}`}><i style={{ background: '#fff6e5' }}/><b>{courses[race[1]!]?.name}</b><em>{race[2] === 0 ? `starts in ${race[3]}s` : race.slice(4, 6).map(seat => row(seat)?.name).filter(Boolean).join(', ')}</em></li>)}
        {going.map((event, k) => <li key={k}><i style={{ background: `#${(EVENT_COLORS[event[0]!] ?? 0xffffff).toString(16).padStart(6, '0')}` }}/><b>{eventLine(event, row)}</b><em>{event[0] === 7 ? `${event[4]}%` : timer(event[3]!)}</em></li>)}
      </ol></section>}
      {wanted.length > 0 && <section className="bw-city-list" data-kind="wanted"><h3>Most wanted</h3><ol>{wanted.map(entry => <li key={entry[0]} style={{ '--player': row(entry[0]!)?.color } as CSSProperties}><i/><b>{row(entry[0]!)?.name}</b><em>{HEAT_NAMES[entry[2]!]}{events.some(event => event[0] === 6 && event[5] === entry[0]) ? ` · ${events.find(event => event[0] === 6)![4]} bounty` : ''}</em></li>)}</ol></section>}
      <section className="bw-city-list"><h3>{title}</h3><ol>{top.map(entry => <li key={entry[0]} style={{ '--player': row(entry[0]!)?.color } as CSSProperties}><i/><b>{row(entry[0]!)?.name}</b><em className="kp-numeral">{entry[column]!.toLocaleString()}{unit}</em></li>)}</ol></section>
    </aside>
    {subject && !cutting && <p className="bw-city-oncam kp-hud-text" style={{ '--player': subject.color } as CSSProperties}><i/>On camera: <b>{subject.name}</b> · {whereabouts(subject.x, subject.z)}</p>}
    {news.length > 0 && <ul className="bw-city-news" aria-live="polite">{news.slice(-3).map(line => <li key={line.n}>{line.text}</li>)}</ul>}
    {roster.length > 0 && !online && <p className="bw-tv-hint kp-hud-text">Everyone stepped away. Rejoin on your phone with the room code to get back to the city.</p>}
  </div>;
}
/** One line for something going on: what and where (or who has it). */
function eventLine(event: number[], row: (seat: number) => { name: string } | undefined): string {
  const [k, x, z, , a] = event as [number, number, number, number, number], where = whereabouts(x, z);
  return k === 3 ? a ? `The Gull: ${row(a - 1)?.name ?? 'somebody'}` : `The Golden Gull · ${where}` : k === 7 ? 'Bank job · Brasswick Savings' : `${['Parcel spill', 'Crate drop', 'Fire', '', 'Half price', 'Blackout', '', '', 'Race forming'][k] ?? 'Something'} · ${where}`;
}

/** The City Ledger: everyone ranked by what they are worth, with what the round made of them. */
export function CityResults({ publicView: view, playerId }: ResultsViewProps<View>) {
  // (Ranked from the ledger itself: the outcome's rows are empty once a round is over, because the room repeats them.)
  const ledger = decodeLedger(view), players = seatsOf(view.who), won = cityAwards(ledger);
  const rows = [...ledger].sort((a, b) => b.worth - a.worth).map((entry, rank) => ({ entry, rank, player: players.find(p => p.id === entry.id) }));
  return <div className="bw-results bw-ledger">
    <p className="kp-eyebrow">The City Ledger</p>
    <h1>{view.day === 0 ? 'One day in Caper City' : `${view.day + 1} days in Caper City`}</h1>
    <ol className="bw-journal">
      {rows.map(({ rank, player, entry }) => <li key={entry.id} data-me={entry.id === playerId} style={{ '--player': player?.color ?? 'var(--kp-sky)' } as CSSProperties}>
        <b className="bw-journal-name"><small className="kp-numeral">#{rank + 1}</small> {player?.name ?? 'Player'}<small className="bw-ledger-title"> · {titleFor(entry.stamps)}</small></b>
        {won.filter(award => award.ids.includes(entry.id)).map(award => <span key={award.key} className="bw-award">{award.title}</span>)}
        <dl>
          <div><dt>Worth</dt><dd>{entry.worth.toLocaleString()}</dd></div><div><dt>Stamps</dt><dd>{entry.stamps}</dd></div><div><dt>Gigs</dt><dd>{entry.gigs}</dd></div>
          <div><dt>Nabbed</dt><dd>{entry.busts}</dd></div><div><dt>Fish</dt><dd>{entry.fish}</dd></div><div><dt>Driven</dt><dd>{entry.drove.toLocaleString()} m</dd></div>
        </dl>
      </li>)}
    </ol>
  </div>;
}
