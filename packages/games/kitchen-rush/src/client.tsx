import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Coins, Crown, Keyboard, Star, WifiOff } from 'lucide-react';
import { ToggleRow, type GameClientModule, type ResultsViewProps, type SettingsViewProps } from '../../../party-ui/src/index';
import { DEFAULT_SETTINGS, RECIPES, type CharacterId, type Input, type Own, type RecipeId, type Settings, type View } from './model';
import { LEVELS } from './levels';
import { setAssetBase } from './asset-url';
import { bestFor, readCampaign, recordCampaign, totalStars } from './campaign';
import { assignAwards, headline, levelPitch, levelTags, place, starGoal } from './presentation';
import { AudioView } from './audio';
import { CookLobby } from './cook-lobby';
import { Controller, Controls, FullScreenToggle, useChef, useHaptics, useKitchen, type Props } from './controller';
import { Broadcast, Hud, Icon, ItemIcon, LineBadge, lineStyle } from './hud';
import { phoneScene } from './phone-scene';
import { decodeWire, kitchenOf, type Wire } from './wire';
import './style.css';

const Scene = lazy(() => import('./scene'));
const levelOf = (index: number) => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index | 0))];
const StarRow = ({ stars, className = '' }: { stars: number; className?: string }) =>
  <span className={`kr-stars ${className}`} aria-label={`${stars} of 3 stars`}>{[0, 1, 2].map(i => <Star key={i} className={i < stars ? 'kr-got' : ''} aria-hidden="true"/>)}</span>;

/** One kitchen gets its full HUD; a restaurant of several gets the broadcast board. */
function Display(props: Props) {
  const { restaurant, view } = useKitchen(props);
  return restaurant.lines.length > 1 ? <Broadcast restaurant={restaurant}/> : <Hud view={view}/>;
}

/**
 * This seat's kitchen and HUD with the controls laid over the corners: a host playing on the shared screen (keyboard works
 * throughout), or with `handheld` a phone showing its own kitchen in a restaurant of several.
 */
function Play({ handheld = false, ...props }: Props & { handheld?: boolean }) {
  const { restaurant, view } = useKitchen(props), { playerId, connected = true } = props, me = useChef(view, playerId, props.privateView);
  useHaptics(view, playerId);
  const fallen = me.chef.respawnAt > view.now;
  return <Hud view={view} restaurant={restaurant} solo handheld={handheld}>
    <div className={`kr-play kr-solo ${handheld ? 'kr-handheld' : ''}`} style={{ '--chef': me.chef.color } as CSSProperties} data-command-seq={me.chef.seq} data-chef-x={me.chef.x.toFixed(2)} data-chef-z={me.chef.z.toFixed(2)}>
      <Controls view={view} own={props.privateView} playerId={playerId} setInput={props.setInput} releaseInput={props.releaseInput} connected={connected}/>
      <div className="kr-solo-status" role="status">
        <ItemIcon item={me.chef.held}/>
        <span><strong>{me.status?.label ?? 'Walk up to a station'}</strong>{me.status?.detail && <small className={`kr-tone-${me.status.tone}`}>{me.status.detail}</small>}</span>
        {view.now - me.chef.noteAt < 3500 && me.chef.note && <em key={me.chef.noteAt}>{me.chef.note}</em>}
      </div>
      {handheld ? <FullScreenToggle/> : <p className="kr-keys"><Keyboard aria-hidden="true"/>WASD move · Space grab · K chop/throw · Shift dash</p>}
      {handheld && (fallen || !connected) && <div className="kr-phone-alert" role="alert">{!connected ? <><WifiOff aria-hidden="true"/>Reconnecting… controls released</> : <>Splash! Back in {Math.ceil((me.chef.respawnAt - view.now) / 1000)}…</>}</div>}
    </div>
  </Hud>;
}
/**
 * Phones keep the classic controller while one kitchen fills the shared screen. Once the crew is split across several
 * kitchens the shared screen is a broadcast, so each phone shows its own kitchen, unless it could not draw one.
 */
function Phone(props: Props) {
  const failed = useSyncExternalStore(phoneScene.subscribe, phoneScene.failed);
  return props.publicView.base.lines.length > 1 && !failed ? <Play {...props} handheld/> : <Controller {...props}/>;
}

function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  const [campaign] = useState(() => readCampaign()), value = { ...DEFAULT_SETTINGS, ...settings }, set = (patch: Partial<Settings>) => onChange({ ...value, ...patch });
  return <div className="kr-settings">
    <header className="kr-settings-head"><h3>Pick tonight’s kitchen</h3><strong className="kr-total"><Star aria-hidden="true"/>{totalStars(campaign)} / {LEVELS.length * 3}</strong></header>
    <div className="kr-levels" role="radiogroup" aria-label="Kitchen">{LEVELS.map((level, i) => <button type="button" role="radio" key={level.id} aria-checked={value.level === i} disabled={disabled} className={`kr-level kr-theme-${level.theme}`} title={level.blurb} onClick={() => set({ level: i })}>
      <span className="kr-level-top"><b className="kp-numeral">{i + 1}</b><small>{level.location}</small><StarRow stars={bestFor(campaign, level.id).stars}/></span>
      <strong>{level.name}</strong>
      <p>{levelPitch(level)}</p>
      <span className="kr-level-foot"><span className="kr-level-recipes">{level.recipes.map(recipe => <Icon key={recipe} name={`dish_${recipe}`}/>)}</span>
        <span className="kr-tags">{levelTags(level).slice(0, 2).map(tag => <em key={tag}>{tag}</em>)}</span></span>
    </button>)}</div>
    <div className="kr-settings-row">
      <div className="kr-length" role="group" aria-label="Service length"><span>Service</span>{([150, 180, 240] as const).map(seconds => <button type="button" key={seconds} aria-pressed={value.seconds === seconds} disabled={disabled} onClick={() => set({ seconds })}>{seconds === 150 ? '2½' : seconds / 60} min</button>)}</div>
      <ToggleRow label="Relaxed: no burning, no expiring orders" checked={value.relaxed} disabled={disabled} onChange={relaxed => set({ relaxed })}/>
    </div>
    <p className="kr-settings-note">{value.relaxed ? 'Relaxed services are for learning. Stars are not saved.' : campaign.saved ? 'Best stars are saved in this browser.' : 'Browser storage is unavailable; every kitchen is still playable.'}</p>
  </div>;
}

function Instructions() {
  return <div className="kr-instructions">
    <h2>Cook together. Serve fast.</h2>
    <ol><li><b>Grab</b> ingredients from crates.</li><li><b>Chop</b> on boards, <b>cook</b> in pots and pans.</li><li><b>Plate</b> it up and <b>serve</b> at the hatch before the ticket runs out.</li></ol>
    <p>Throw food to teammates, wash dirty plates, and put out fires. Everyone shares one score, and tips double in the last 30 seconds.</p>
    <p>More than ten chefs? You split into kitchens that share the stars and race for Kitchen of the Night. Each phone then shows its own kitchen.</p>
    <p className="kr-muted">Keys: WASD move · Space/J grab · K/E chop or throw · Shift/L dash · <a href="/games/kitchen-rush/audio/index.html" target="_blank" rel="noreferrer">Sound credits</a></p>
  </div>;
}

/** Counts from 0 to `value`; instant under reduced motion. */
function useCountUp(value: number, ms = 1200) {
  const [shown, setShown] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches ? value : 0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); return; }
    const start = performance.now(); let frame = 0;
    const step = (now: number) => { const t = Math.min(1, (now - start) / ms); setShown(Math.round(value * (1 - (1 - t) ** 3))); if (t < 1) frame = requestAnimationFrame(step); };
    frame = requestAnimationFrame(step); return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

/** One chef's award: a portrait card for a single kitchen, a compact row inside a kitchen's panel otherwise. */
function Awards({ view }: { view: View }) {
  const awards = assignAwards(view.players), count = view.players.length;
  return <ol className="kr-awards" data-few={count <= 4 || undefined} style={{ '--cols': count > 5 ? Math.ceil(count / 2) : count } as CSSProperties}>{view.players.map((chef, i) => <li key={chef.id} style={{ '--chef': chef.color, '--i': i } as CSSProperties}>
    <Icon name={`character_${chef.character as CharacterId}`} className="kr-award-face"/>
    <em>{awards[chef.id].title}</em><small>{awards[chef.id].detail}</small>
    <span><b>{view.first + i + 1}</b><strong>{chef.name}</strong></span>
  </li>)}</ol>;
}
/** The kitchens of a restaurant in finishing order, each with its coins, its own star rating and every chef's award. A phone lists its own kitchen first. */
function Kitchens({ lines, ranks, mine, playerId }: { lines: View[]; ranks: number[]; mine: View | null; playerId: string | null }) {
  const order = [...lines].sort((a, b) => +(b === mine) - +(a === mine) || ranks[a.line] - ranks[b.line] || a.line - b.line);
  return <ol className="kr-kitchens" data-lines={lines.length}>{order.map((view, n) => {
    const awards = assignAwards(view.players), rank = ranks[view.line];
    return <li key={view.line} className={`${rank === 1 && view.score > 0 ? 'kr-lead' : ''} ${view === mine ? 'kr-mine' : ''}`} style={{ ...lineStyle(view.line), '--i': n } as CSSProperties}>
      <header><em className="kp-numeral">{rank === 1 && view.score > 0 ? <Crown aria-label="1st"/> : place(rank)}</em><LineBadge line={view.line}/><output className="kp-numeral">{view.score}</output><StarRow stars={view.stars}/>
        <small>{view.served} served{view.failed ? ` · ${view.failed} missed` : ''}</small></header>
      <ul>{view.players.map((chef, i) => <li key={chef.id} className={chef.id === playerId ? 'kr-me-row' : ''} style={{ '--chef': chef.color } as CSSProperties}>
        <Icon name={`character_${chef.character as CharacterId}`}/><b>{view.first + i + 1}</b><strong>{chef.name}</strong><small title={awards[chef.id].detail}>{awards[chef.id].title}</small>
      </li>)}</ul>
    </li>;
  })}</ol>;
}

function Results({ publicView, playerId, isHost = false }: ResultsViewProps<Wire>) {
  const restaurant = decodeWire(publicView), { lines } = restaurant, first = lines[0], many = lines.length > 1, level = levelOf(first.settings.level);
  const [campaign, setCampaign] = useState(() => readCampaign()), previous = useRef(bestFor(campaign, level.id));
  // A restaurant saves its shared stars and its best kitchen's coins, so the saved best stays comparable with a single kitchen's.
  const top = Math.max(...lines.map(view => view.score)), leaders = lines.filter(view => view.score === top && top > 0);
  const saving = isHost && first.complete && !first.settings.relaxed, score = useCountUp(restaurant.score);
  useEffect(() => { if (saving) setCampaign(recordCampaign(level.id, restaurant.stars, top)); }, [saving, level.id, restaurant.stars, top]);
  const counts = (id: RecipeId) => lines.reduce((sum, view) => sum + (view.recipeCounts[id] ?? 0), 0), recipes = (Object.keys(RECIPES) as RecipeId[]).filter(counts), goal = starGoal(restaurant.score, restaurant.thresholds);
  const best = saving && Math.max(top, previous.current.score) > 0 && (top > previous.current.score ? previous.current.score ? `New best! Previous ${previous.current.score}` : 'First score on the board!' : `Best: ${bestFor(campaign, level.id).score}`);
  return <div className="kr-results" data-many={many || undefined}>
    <header className="kr-result-head">
      <div className="kr-result-stars" aria-label={`${restaurant.stars} of 3 stars`}>{[0, 1, 2].map(i => <span key={i} className={i < restaurant.stars ? 'kr-got' : ''} style={{ '--i': i } as CSSProperties}><Star aria-hidden="true"/><small className="kp-numeral">{restaurant.thresholds[i]}</small></span>)}</div>
      <div className="kr-result-title">
        <p className="kp-eyebrow">{level.location} · {level.name}{many && ` · ${lines.length} kitchens`}</p>
        <h1 className="kp-title">{headline(restaurant)}</h1>
        <p className="kr-goal">{goal ?? 'All three stars!'}{first.settings.relaxed && <em>Relaxed service · stars not saved</em>}</p>
      </div>
      <div className="kr-result-score"><Coins aria-hidden="true"/><output className="kp-numeral">{score}</output><small>coins</small></div>
    </header>
    <div className="kr-result-stats"><span><b className="kp-numeral">{restaurant.served}</b>served</span><span><b className="kp-numeral">{restaurant.failed}</b>missed</span>
      {recipes.map(id => <span key={id} className="kr-tally"><Icon name={`dish_${id}`}/><b className="kp-numeral">×{counts(id)}</b>{RECIPES[id].name}</span>)}
      {many && leaders.length > 0 && <span className="kr-night"><Crown aria-hidden="true"/>Kitchen of the night{leaders.map(view => <LineBadge key={view.line} line={view.line}/>)}</span>}
      {best && <span className="kr-best">{best}</span>}</div>
    {many ? <Kitchens lines={lines} ranks={restaurant.ranks} mine={playerId && !isHost ? kitchenOf(restaurant, playerId) : null} playerId={playerId}/> : <Awards view={first}/>}
  </div>;
}

export const client: GameClientModule<Input, never, Settings, Wire, Own> = {
  settingsWide: true, immersivePhone: true, LobbyView: CookLobby, AudioView,
  // Phones mount the scene too: it stays empty while one kitchen fills the shared screen and draws their own kitchen in a restaurant of several.
  sceneRoles: ['display', 'controller'],
  SceneView: props => <Suspense fallback={null}><Scene {...props}/></Suspense>,
  DisplayView: Display, ControllerView: Phone, PersonalView: Play,
  SettingsView, InstructionsView: Instructions, ResultsView: Results,
  prepare({ assetBase }) { setAssetBase(assetBase); },
  dispose() {},
};
export default client;
