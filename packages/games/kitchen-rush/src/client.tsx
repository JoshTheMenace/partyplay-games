import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Coins, Keyboard, Star } from 'lucide-react';
import { ToggleRow, type GameClientModule, type GameViewProps, type ResultsViewProps, type SettingsViewProps } from '../../../party-ui/src/index';
import { DEFAULT_SETTINGS, RECIPES, type CharacterId, type Input, type RecipeId, type Settings, type View } from './model';
import { LEVELS } from './levels';
import { setAssetBase } from './asset-url';
import { bestFor, readCampaign, recordCampaign, totalStars } from './campaign';
import { assignAwards, headline, levelPitch, levelTags, starGoal } from './presentation';
import { AudioView } from './audio';
import { CookLobby } from './cook-lobby';
import { Controller, Controls, useChef, useHaptics } from './controller';
import { Hud, Icon, ItemIcon } from './hud';
import './style.css';

type Props = GameViewProps<Input, never, View, null>;
const Scene = lazy(() => import('./scene'));
const levelOf = (index: number) => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index | 0))];
const StarRow = ({ stars, className = '' }: { stars: number; className?: string }) =>
  <span className={`kr-stars ${className}`} aria-label={`${stars} of 3 stars`}>{[0, 1, 2].map(i => <Star key={i} className={i < stars ? 'kr-got' : ''} aria-hidden="true"/>)}</span>;

function Display({ publicView }: Props) { return <Hud view={publicView}/>; }

/** Solo host: kitchen and HUD with the phone controls laid over the corners; keyboard works throughout. */
function Solo(props: Props) {
  const view = props.publicView, me = useChef(view, props.playerId);
  useHaptics(view, props.playerId);
  return <Hud view={view} solo>
    <div className="kr-play kr-solo" style={{ '--chef': me.chef.color } as CSSProperties}>
      <Controls {...props}/>
      <div className="kr-solo-status" role="status">
        <ItemIcon item={me.chef.held}/>
        <span><strong>{me.status?.label ?? 'Walk up to a station'}</strong>{me.status?.detail && <small className={`kr-tone-${me.status.tone}`}>{me.status.detail}</small>}</span>
        {view.now - me.chef.noteAt < 3500 && me.chef.note && <em key={me.chef.noteAt}>{me.chef.note}</em>}
      </div>
      <p className="kr-keys"><Keyboard aria-hidden="true"/>WASD move · Space grab · K chop/throw · Shift dash</p>
    </div>
  </Hud>;
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
    <p>Throw food to teammates, wash dirty plates, and put out fires. Everyone shares one score.</p>
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

function Results({ publicView: view, isHost = false }: ResultsViewProps<View>) {
  const level = levelOf(view.settings.level), [campaign, setCampaign] = useState(() => readCampaign()), previous = useRef(bestFor(campaign, level.id));
  const saving = isHost && view.complete && !view.settings.relaxed, score = useCountUp(view.score), awards = assignAwards(view.players);
  useEffect(() => { if (saving) setCampaign(recordCampaign(level.id, view.stars, view.score)); }, [saving, level.id, view.stars, view.score]);
  const recipes = (Object.keys(view.recipeCounts) as RecipeId[]).filter(id => view.recipeCounts[id]), goal = starGoal(view.score, view.thresholds);
  const best = saving && Math.max(view.score, previous.current.score) > 0 && (view.score > previous.current.score ? previous.current.score ? `New best! Previous ${previous.current.score}` : 'First score on the board!' : `Best: ${bestFor(campaign, level.id).score}`);
  return <div className="kr-results">
    <header className="kr-result-head">
      <div className="kr-result-stars" aria-label={`${view.stars} of 3 stars`}>{[0, 1, 2].map(i => <span key={i} className={i < view.stars ? 'kr-got' : ''} style={{ '--i': i } as CSSProperties}><Star aria-hidden="true"/><small className="kp-numeral">{view.thresholds[i]}</small></span>)}</div>
      <div className="kr-result-title">
        <p className="kp-eyebrow">{level.location} · {level.name}</p>
        <h1 className="kp-title">{headline(view)}</h1>
        <p className="kr-goal">{goal ?? 'All three stars!'}{view.settings.relaxed && <em>Relaxed service · stars not saved</em>}</p>
      </div>
      <div className="kr-result-score"><Coins aria-hidden="true"/><output className="kp-numeral">{score}</output><small>coins</small></div>
    </header>
    <div className="kr-result-stats"><span><b className="kp-numeral">{view.served}</b>served</span><span><b className="kp-numeral">{view.failed}</b>missed</span>
      {recipes.map(id => <span key={id} className="kr-tally"><Icon name={`dish_${id}`}/><b className="kp-numeral">×{view.recipeCounts[id]}</b>{RECIPES[id].name}</span>)}
      {best && <span className="kr-best">{best}</span>}</div>
    <ol className="kr-awards" data-few={view.players.length <= 4 || undefined} style={{ '--cols': view.players.length > 5 ? Math.ceil(view.players.length / 2) : view.players.length } as CSSProperties}>{view.players.map((chef, i) => <li key={chef.id} style={{ '--chef': chef.color, '--i': i } as CSSProperties}>
      <Icon name={`character_${chef.character as CharacterId}`} className="kr-award-face"/>
      <em>{awards[chef.id].title}</em><small>{awards[chef.id].detail}</small>
      <span><b>{i + 1}</b><strong>{chef.name}</strong></span>
    </li>)}</ol>
  </div>;
}

export const client: GameClientModule<Input, never, Settings, View, null> = {
  settingsWide: true, immersivePhone: true, LobbyView: CookLobby, AudioView,
  SceneView: props => <Suspense fallback={null}><Scene {...props}/></Suspense>,
  DisplayView: Display, ControllerView: Controller, PersonalView: Solo,
  SettingsView, InstructionsView: Instructions, ResultsView: Results,
  prepare({ assetBase }) { setAssetBase(assetBase); },
  dispose() {},
};
export default client;
