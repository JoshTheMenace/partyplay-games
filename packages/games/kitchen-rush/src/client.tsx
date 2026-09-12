import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArcadeButton, Countdown, HoldButton, Panel, SteerPad, ToggleRow, type GameClientModule, type ResultsViewProps, type SettingsViewProps, type GameViewProps } from '../../../party-ui/src/index';
import { INGREDIENTS, choppable, KITCHENS, RECIPES, foodLabel, hasBelt, hasPower, itemLabel, neutral, recipeFor, stationLabel, unbakedPizza, type Input, type Item, type Settings, type Ticket, type View } from './model';
import {cookingStatus} from './presentation';
import { readCampaign, recordCampaign, unlockedThrough } from './campaign';
import { KitchenAudio } from './audio';
import './style.css';
let soundingService: number | null = null;
function useKitchenSound(view: View, enabled = true, results = false) {
  const audio = useRef<KitchenAudio | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const opening = results ? soundingService === view.startedAt ? 'end' : null : view.now - view.startedAt < 1500 ? 'start' : null;
    soundingService = results ? null : view.startedAt;
    audio.current = new KitchenAudio(opening);
    return () => { audio.current?.dispose(); audio.current = null; };
  }, [enabled, view.startedAt, results]);
  useEffect(() => { audio.current?.update(view); }, [view]);
}
const Kitchen = lazy(() => import('./scene'));
type Props = GameViewProps<Input, never, View, null>;
function FoodIcons({ item }: { item: Item | null }) { return <span className="kr-food-icons" aria-hidden="true">{!item ? '✋' : item.kind === 'plate' ? <>{item.dirty ? '🫧' : '🍽️'}{item.food.map((food, i) => <span key={i}>{INGREDIENTS[food.kind].icon}</span>)}</> : INGREDIENTS[item.food[0].kind].icon}</span>; }
function OrderCard({ticket,view,index=0}:{ticket:Ticket;view:View;index?:number}){const recipe=RECIPES.find(item=>item.id===ticket.recipe)!,remaining=Math.max(0,(ticket.expiresAt-view.now)/(ticket.expiresAt-ticket.createdAt));return <article className={`kr-ticket ${remaining < .25 && !view.settings.practice ? 'kr-urgent' : ''}`} key={ticket.id}><div><b>{recipe.icon}</b><strong>{recipe.name}<small>ORDER {ticket.id} {index === 0 ? '· FIRST UP' : ''}</small></strong></div><p>{recipe.parts.map(part => <span key={part.kind} title={foodLabel(part)}>{INGREDIENTS[part.kind].icon}<small>{part.stage === 'raw' ? 'add' : part.stage === 'chopped' ? 'chop' : part.kind === 'dough' ? 'bake plate' : 'cook'}</small></span>)}<span className="kr-ticket-plate">→ 🍽️</span></p><progress aria-label={`${recipe.name} patience`} value={view.settings.practice ? 1 : remaining} max={1}/></article>;}
function RecipeGuide({ kitchen }: { kitchen: number }) { return <details className="kr-guide"><summary>Recipe book · what goes on the plate?</summary>{RECIPES.slice(0, KITCHENS[kitchen].recipes).map(recipe => <div key={recipe.id}><strong>{recipe.icon} {recipe.name}</strong><span>{recipe.id === 'pizza' ? 'Raw dough + chopped tomato + cheese → whole plate in oven' : recipe.parts.map(foodLabel).join(' + ')}</span></div>)}<p>Chop: hold Use at a board. Cook: leave food on a stove until green, then collect it. Put ingredients onto a clean plate, then serve. Wash returned dishes.</p></details>; }
function Controller({ publicView: view, playerId, setInput, releaseInput, connected, serverNowMs }: Props) {
  const chef = view.players.find(player => player.id === playerId)!, station = view.stations.find(item => item.id === chef.target);
  const held = useRef(neutral()), queue = useRef<{ command: Input['command']; seq: number }[]>([]), serial = useRef(chef.commandSeq), latest = useRef({ setInput, releaseInput }); latest.current = { setInput, releaseInput };
  const publish = () => { const pending = queue.current[0]; const value = { ...held.current, command: pending?.command ?? null, seq: pending?.seq ?? 0 }; if (!value.x && !value.y && !value.use && !value.dash && !pending) latest.current.releaseInput?.(); else latest.current.setInput(value); };
  const enqueue = (command: Input['command']) => { if (queue.current.length >= 4) return; serial.current = Math.max(serial.current, chef.commandSeq) + 1; queue.current.push({ command, seq: serial.current }); publish(); };
  const change = (part: Partial<Input>) => { held.current = { ...held.current, ...part }; publish(); };
  const use = (down: boolean) => { held.current.use = down; if (down) enqueue('use'); else publish(); };
  const handlers = useRef({ change, enqueue, use }); handlers.current = { change, enqueue, use };
  useEffect(() => { const before = queue.current.length; queue.current = queue.current.filter(command => command.seq > chef.commandSeq); if (queue.current.length !== before) publish(); }, [chef.commandSeq]);
  useEffect(() => {
    const keys = new Set<string>();
    const clear = () => { keys.clear(); queue.current = []; held.current = neutral(); latest.current.releaseInput?.(); };
    const hidden = () => { if (document.hidden) clear(); };
    const key = (event: KeyboardEvent) => { if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName)) return; const down = event.type === 'keydown'; if (event.repeat) return; const name = event.key.toLowerCase(); if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(name) && !(event.target as HTMLElement)?.closest('.kp-steer-pad')) { event.preventDefault(); if (down) keys.add(name); else keys.delete(name); const x = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft')), y = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup')), length = Math.max(1, Math.hypot(x,y)); handlers.current.change({ x:x/length, y:y/length }); } else if (name === 'e') { event.preventDefault(); handlers.current.use(down); } else if (name === 'shift') handlers.current.change({ dash: down }); else if (down && (name === 'q' || name === 'f')) handlers.current.enqueue(name === 'q' ? 'drop' : 'toss'); };
    window.addEventListener('blur', clear); document.addEventListener('visibilitychange', hidden); window.addEventListener('keydown', key); window.addEventListener('keyup', key);
    return () => { clear(); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); };
  }, []);
  const cooker=cookingStatus(station,view.settings.practice),dashWait=Math.max(0,chef.dashReady-view.now);
  const job = station?.fire ? 'Extinguish · hold' : station?.kind === 'board' && choppable(station.item) && !chef.held ? 'Chop · hold' : station?.kind === 'sink' && station.item?.dirty && !chef.held ? 'Wash · hold' : chef.held ? station?.kind === 'serve' ? 'Serve plate' : 'Place / add' : 'Pick up';
  return <Panel className="kr-controller" data-chef-x={chef.x.toFixed(3)} data-chef-z={chef.z.toFixed(3)} data-command-seq={chef.commandSeq}>
    <header className="kr-phone-heading"><span className="kr-number" style={{ background: chef.color }}>{view.players.indexOf(chef) + 1}</span><div><span className="kp-eyebrow">{KITCHENS[view.settings.kitchen].name}</span><strong>{chef.name}</strong></div><Countdown deadline={view.endsAt} serverNowMs={serverNowMs}/></header>
    <div className="kr-held"><FoodIcons item={chef.held}/><div><small>IN YOUR HANDS</small><strong>{itemLabel(chef.held)}</strong>{recipeFor(chef.held) && <span className="kr-ready">Ready to serve!</span>}{unbakedPizza(chef.held) && <span className="kr-ready">Next: bake the whole plate</span>}</div></div>
    <div className="kr-nearby" data-station={station?.id ?? ''}><div><small>NEARBY</small><strong>{station ? stationLabel(station) : 'Walk up to a station'}</strong></div><span>{cooker?cooker.label:station && !station.powered ? 'Power paused · heat saved' : station?.fire ? '🔥 Fire!' : station?.item ? itemLabel(station.item) : station?.kind === 'plates' ? `${view.cleanPlates} clean` : station?.kind === 'return' ? `${view.dirtyPlates} dirty` : 'Ready when you are'}</span>{station && (station.progress > 0 || station.fire > 0) && <progress aria-label={cooker?.label??'Station progress'} style={{color:cooker?.color,accentColor:cooker?.color}} max={1} value={cooker?.progress??(station.fire || station.progress)}/>}</div>
    <div className="kr-controls"><SteerPad onChange={value => change({ x: value.x, y: value.y })} disabled={!connected}/><div className="kr-actions"><div className="kr-secondary"><ArcadeButton tone="ghost" aria-label="Drop item" onClick={() => enqueue('drop')} disabled={!connected}>Drop <small>Q</small></ArcadeButton><ArcadeButton tone="sky" aria-label="Toss ingredient" onClick={() => enqueue('toss')} disabled={!connected}>Toss <small>F</small></ArcadeButton></div><HoldButton label="Dash" onChange={dash => change({ dash })} disabled={!connected}><span>{dashWait?`Dash · ${(dashWait/1000).toFixed(1)}s`:'Dash'} <small>Shift</small></span></HoldButton><div className="kr-use" data-job={station?.fire?'fire':chef.held&&station?.kind==='serve'?'serve':'work'}><HoldButton label="Use station" onChange={use} disabled={!connected}><span>{job}<small>E · hold to work</small></span></HoldButton></div></div></div>
    <p className="kr-feedback" role="status">{view.now - chef.feedbackAt < 5000 ? chef.feedback : 'Move with the pad. Hold Use to chop, wash or put out fire.'}</p>
    <div className="kr-phone-orders">{view.tickets[0]&&<OrderCard ticket={view.tickets[0]} view={view}/>}<div className="kr-other-orders">{view.tickets.slice(1).map(ticket => { const recipe = RECIPES.find(item => item.id === ticket.recipe)!; return <span key={ticket.id}>{recipe.icon} {recipe.name}</span>; })}</div></div><RecipeGuide kitchen={view.settings.kitchen}/>
  </Panel>;
}
function Display({ publicView: view, serverNowMs }: Props) {
  useKitchenSound(view);
  const level = KITCHENS[view.settings.kitchen],previous=useRef({served:view.served,stars:view.stars}),[celebration,setCelebration]=useState<{text:string;id:number}|null>(null);
  useEffect(()=>{const before=previous.current;previous.current={served:view.served,stars:view.stars};if(view.served>before.served||view.stars>before.stars)setCelebration({text:view.stars>before.stars?'★ A new star!':view.event.includes('served!')?view.event:'Order served!',id:view.served});},[view.served,view.stars]);
  useEffect(()=>{if(!celebration)return;const timer=setTimeout(()=>setCelebration(null),2000);return()=>clearTimeout(timer);},[celebration]);
  const floor=view.thresholds[view.stars-1]??0,next=view.thresholds[view.stars]??floor;
  return <div className="kr-hud"><header className="kr-service-heading"><div><span className="kr-brand">KITCHEN RUSH · STAGE {view.settings.kitchen + 1} / 10</span><h1>{level.name}</h1></div>
    <div className="kr-tickets">{view.tickets.map((ticket,index)=><OrderCard key={ticket.id} ticket={ticket} view={view} index={index}/>)}</div>
    <div className="kr-service-stats"><div className="kr-score-stack"><div className="kr-score"><strong>{view.score}</strong><span>{'★'.repeat(view.stars)}{'☆'.repeat(3 - view.stars)} <small>{view.stars === 3 ? 'BEST SERVICE' : `${view.thresholds[view.stars]} next`}</small></span></div><progress className="kr-star-progress" aria-label="Progress to next star" max={next-floor||1} value={view.stars===3?1:Math.max(0,view.score-floor)}/>{view.combo>0&&<span className="kr-combo">{view.combo} in a row · +{Math.min(5,view.combo)*5} next</span>}{celebration&&<div key={celebration.id} className="kr-celebration" role="status">{celebration.text}</div>}</div><Countdown deadline={view.endsAt} serverNowMs={serverNowMs}/></div></header>
    <div className="kr-footer">
    <div className={`kr-banner ${view.hazard !== 'calm' ? 'kr-hazard' : ''}`}>{view.hazard === 'warning' ? level.topology === 'bridge' ? 'Bridge closing soon · use the end crossings' : 'Gust incoming · perimeter stays clear' : view.hazard === 'active' ? level.topology === 'bridge' ? 'Bridge closed · end crossings are open' : 'Ventilation gust · centre lane is slower' : view.powerWarning ? 'Power switches soon · collect ready food' : hasPower(level) ? `Green cookers powered · ${view.served} served` : view.now - view.eventAt < 5000 ? view.event : `${view.served} served · ${view.cleanPlates} clean plates · ${view.dirtyPlates} to wash${view.settings.practice ? ' · PRACTICE' : ''}`}</div>
    <div className="kr-chef-strip">{view.players.map((chef, i) => <span key={chef.id} className={!chef.connected ? 'kr-away' : ''}><b style={{ background: chef.color }}>{i + 1}</b><span>{chef.name}</span><small>{chef.held ? chef.held.kind === 'plate' ? '🍽️' : INGREDIENTS[chef.held.food[0].kind].icon : '·'}</small></span>)}</div>
    </div>
  </div>;
}
function CampaignSettings({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  const [progress] = useState(readCampaign), unlocked = unlockedThrough(progress), stage = settings.kitchen ?? 0;
  return <div className="kr-settings"><div className="kr-campaign-heading"><div><span className="kr-brand">YOUR KITCHEN TOUR</span><h3>Ten stops. One hungry city.</h3></div><strong>{progress.stars.reduce((sum, stars) => sum + stars, 0)} / 30 ★</strong></div>
    <p>Earn one star to open the next stage. Stars stay in this browser. Practice opens all ten stages.</p>
    <ToggleRow label="Practice · all stages, no burning, expiry or hazards" checked={settings.practice ?? false} disabled={disabled} onChange={practice => onChange({ ...settings, practice, kitchen: !practice && stage > unlocked ? unlocked : stage })}/>
    <div className="kr-campaign-map">{KITCHENS.map((level, i) => { const locked = !settings.practice && i > unlocked; return <button type="button" key={level.name} aria-label={`Stage ${i + 1}: ${level.name}${locked ? ' locked' : ''}`} aria-pressed={stage === i} disabled={disabled || locked} className={stage === i ? 'kr-selected' : ''} onClick={() => onChange({ ...settings, kitchen: i })}><b>{i + 1}</b><span><strong>{level.name}</strong><small>{level.subtitle}</small></span><em>{locked ? 'Locked' : progress.stars[i] ? '★'.repeat(progress.stars[i]) : '☆'}</em></button>; })}</div>
    <div className="kr-stage-detail"><span className="kr-brand">{KITCHENS[stage].location}</span><h3>{KITCHENS[stage].name}</h3><p>{KITCHENS[stage].detail}</p>{hasBelt(KITCHENS[stage]) && <p>Belts carry food and plates toward the front. Take items off the last belt to free the line.</p>}</div>
    <label>Service length<select aria-label="Service length" value={settings.seconds ?? 180} disabled={disabled} onChange={event => onChange({ ...settings, seconds: Number(event.target.value) })}><option value={180}>3 minutes</option><option value={240}>4 minutes</option><option value={300}>5 minutes</option></select></label><RecipeGuide kitchen={stage}/>{!progress.saved && <p>Storage unavailable. You can still play every stage in Practice.</p>}</div>;
}
function Results({ publicView: view, playerId, isHost = !playerId }: ResultsViewProps<View>) {
  useKitchenSound(view, isHost || !playerId, true);
  const [progress, setProgress] = useState(readCampaign),previousBest=useRef(progress.scores[view.settings.kitchen]??0);
  useEffect(() => { if (isHost && view.complete && !view.settings.practice) setProgress(recordCampaign(view.settings.kitchen, view.stars, view.score)); }, [isHost, view.complete, view.settings.kitchen, view.settings.practice, view.stars, view.score]);
  return <div className="kr-results"><span className="kr-brand">STAGE {view.settings.kitchen + 1} · {KITCHENS[view.settings.kitchen].name} · SERVICE COMPLETE</span><h1>{view.served ? view.stars === 3 ? 'A three-star crew.' : 'Aprons off, chefs.' : 'The kitchen is still warming up.'}</h1><div className="kr-result-stars" aria-label={`${view.stars} stars out of 3`}>{[0,1,2].map(i=><span key={i} className={i<view.stars?'kr-earned-star':''} style={{animationDelay:`${i*.18}s`}}>{i<view.stars?'★':'☆'}</span>)}</div><div className="kr-result-score">{view.score}<small>TEAM POINTS</small></div>{isHost&&!view.settings.practice&&<p className="kr-best">{view.score>previousBest.current?`New best! Previous: ${previousBest.current}`:`Your best: ${progress.scores[view.settings.kitchen]??0}`}</p>}<div className="kr-result-stats"><span><b>{view.served}</b>orders served</span><span><b>{view.missed}</b>orders missed</span><span><b>{view.waste}</b>food discarded</span><span><b>{view.fires}</b>stove fires</span></div><div className="kr-result-recipes">{RECIPES.filter(recipe => view.recipeCounts[recipe.id]).map(recipe => <span key={recipe.id}>{recipe.icon} {recipe.name} × {view.recipeCounts[recipe.id]}</span>)}</div><p>{view.settings.practice ? 'Practice service: your score is real, but campaign stars stay unchanged.' : view.stars > 0 ? view.settings.kitchen === 9 ? 'All ten stages complete. Replay for three stars in every kitchen.' : `Next stage unlocked: ${KITCHENS[view.settings.kitchen + 1].name}. Play again, then open Settings to choose it.` : `Earn ${view.thresholds[0]} points for one star${view.settings.kitchen < 9 ? ' and the next stage' : ''}. Split up the prep, cooking and dishes.`}</p><p className="kr-storage-note">{progress.saved ? 'Campaign stars are saved in this browser.' : 'Browser storage is unavailable. Practice still opens every stage.'}</p><div className="kr-result-roster">{view.players.map((chef, i) => <span key={chef.id}><b style={{ color: chef.color }}>#{i + 1}</b> {chef.name}<small>{chef.served} served · {chef.worked} prep / wash jobs</small></span>)}</div></div>;
}
function Solo(props: Props) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current!, stage = element.closest<HTMLElement>('.kp-scene-stage')!, header = element.querySelector<HTMLElement>('.kr-service-heading')!, controls = element.querySelector<HTMLElement>('.kr-controller')!;
    const resize = () => { stage.style.setProperty('--solo-head', `${header.offsetHeight + 16}px`); stage.style.setProperty('--solo-controls', `${controls.offsetHeight + 16}px`); };
    const observer = new ResizeObserver(resize); observer.observe(header); observer.observe(controls); resize();
    return () => { observer.disconnect(); stage.style.removeProperty('--solo-head'); stage.style.removeProperty('--solo-controls'); };
  }, []);
  return <div ref={root} className="kr-solo"><Display {...props}/><Controller {...props}/></div>;
}
export const client: GameClientModule<Input, never, Settings, View, null> = {
  settingsWide: true,
  PersonalView: Solo,
  SceneView: props => <Suspense fallback={null}><Kitchen {...props}/></Suspense>, DisplayView: Display, ControllerView: Controller,
  SettingsView: CampaignSettings,
  InstructionsView: () => <div className="kr-instructions"><h2>Good food. Great teamwork.</h2><p>Follow the order tickets. Take ingredients, hold Use to chop, cook on the stove, then combine everything on a clean plate and serve.</p><p>Tap Use to pick up or place. Hold it to chop, wash or extinguish. Toss ingredients to teammates; carry plates. Dirty dishes return after serving. Everyone shares the score.</p><p>Pad / WASD to move · E use · Q drop · F toss · Shift dash</p><p><a href="/games/kitchen-rush/audio/index.html" target="_blank" rel="noreferrer">Sound effects and credits</a></p></div>,
  ResultsView: Results,
  prepare() {}, dispose() {},
};
export default client;
