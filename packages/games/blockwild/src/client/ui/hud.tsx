/** In-game HUD: crosshair, hotbar, vitals, selected-item name, toasts and the "Next goal" helper. */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { HOTBAR_SIZE } from '../../shared/constants';
import { itemName } from '../../shared/items';
import { MOB, type PrivateView, type PubPlayer, type View } from '../../shared/protocol';
import { hud } from '../game/hud';
import { selectSlot } from '../game/predict';
import { store } from '../store';
import { bubbles, itemHint, meterIcons } from './format';
import { GOALS_KEY, nextGoal, parseReached, serializeReached, shelterDue } from './goals';
import { ItemIcon, MeterSprite, type MeterKind } from './icons';
import { SlotFace, slotLabel } from './slot';
import { toast, ui, updateSettings, useStore } from './state';

export function Crosshair() {
  const using = useStore(hud, s => s.using);
  return <div className="bw-crosshair" aria-hidden="true">
    {using > 0 && <svg className="bw-using" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" pathLength="1" strokeDasharray={`${using} 1`}/></svg>}
  </div>;
}

export function Hotbar() {
  const inv = useStore(store, s => s.inv), selected = useStore(store, s => s.selected);
  return <div className="bw-hotbar" role="toolbar" aria-label="Hotbar">
    {inv.slice(0, HOTBAR_SIZE).map((slot, i) => <button key={i} type="button" className="bw-slot bw-hot" aria-pressed={i === selected} aria-label={`Slot ${i + 1}: ${slotLabel(slot)}`}
      onClick={() => selectSlot(i)}><SlotFace slot={slot}/><small className="bw-key" aria-hidden="true">{i + 1}</small></button>)}
  </div>;
}

/** Fades in the selected item's name (and its one-line hint, for touch players who get no tooltips) whenever the selection changes. */
export function SelectedName() {
  const selected = useStore(store, s => s.selected), id = useStore(store, s => s.inv[s.selected]?.id ?? 0), first = useRef(true);
  useEffect(() => { first.current = false; }, []);
  if (!id || first.current) return null;
  const hint = itemHint(id);
  return <div key={`${selected}:${id}`} className="bw-selname kp-hud-text" aria-hidden="true">{itemName(id)}{hint && <small>{hint}</small>}</div>;
}

function Meter({ kind, icons, flash, label, className = '' }: { kind: MeterKind; icons: ('full' | 'half' | 'empty')[]; flash?: boolean; label: string; className?: string }) {
  return <div className={`bw-meter bw-meter-${kind} ${className}`} role="img" aria-label={label}>
    {icons.map((fill, i) => <span key={i} style={{ '--i': i } as CSSProperties}><MeterSprite kind={kind} fill={fill} flash={flash}/></span>)}
  </div>;
}
/** Armor above the hearts (when worn), hearts (half hearts, white flash on damage, wobble when low), hunger shanks and air bubbles under water. */
export function Vitals({ view }: { view: PrivateView }) {
  const hurt = useStore(hud, s => s.hurt), [flash, setFlash] = useState(false), previous = useRef(hurt);
  useEffect(() => {
    if (hurt === previous.current) return;
    previous.current = hurt;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 420);
    return () => clearTimeout(timer);
  }, [hurt]);
  const air = bubbles(view.air);
  return <div className="bw-vitals">
    <div className="bw-meter-col">
      {view.armorPoints > 0 && <Meter kind="armor" icons={meterIcons(view.armorPoints)} label={`Armor ${view.armorPoints} of 20`}/>}
      <Meter kind="heart" icons={meterIcons(view.health)} flash={flash} label={`Health ${Math.ceil(view.health) / 2} of 10 hearts`} className={view.health <= 4 ? 'bw-low' : ''}/>
    </div>
    {!!view.protectedTicks && <span className="bw-protected" title="Spawn protection is active">Protected</span>}
    <div className="bw-meter-col bw-meter-right">
      {air !== null && <Meter kind="bubble" icons={Array.from({ length: 10 }, (_, i) => i >= 10 - air ? 'full' : 'empty')} label={`Air ${air} of 10`} className="bw-air"/>}
      <Meter kind="shank" icons={meterIcons(view.food).reverse()} label={`Food ${Math.ceil(view.food) / 2} of 10`} className={view.food <= 6 ? 'bw-hungry' : ''}/>
    </div>
  </div>;
}

export function Toasts() {
  const toasts = useStore(ui, s => s.toasts);
  return <div className="bw-toasts" role="status" aria-live="polite">{toasts.map(t => <p key={t.id} className="bw-toast" data-tone={t.tone}>{t.text}</p>)}</div>;
}

let memory: { world: string; reached: Set<string> } | null = null;
/** Goals already reached in a world (read once from localStorage; shared by the chip and screens that complete goals). */
function reachedGoals(worldId: string): Set<string> {
  if (memory?.world !== worldId) {
    let reached = new Set<string>();
    try { reached = parseReached(localStorage.getItem(GOALS_KEY), worldId); } catch { /* no storage */ }
    memory = { world: worldId, reached };
  }
  return memory.reached;
}
const saveReached = (worldId: string, reached: ReadonlySet<string>) => {
  try { localStorage.setItem(GOALS_KEY, serializeReached(worldId, reached)); } catch { /* private mode */ }
};
/** Mark a goal the chip cannot derive from state (trading) as reached. */
export function reachGoal(worldId: string, id: string) {
  const reached = reachedGoals(worldId);
  if (!reached.has(id)) saveReached(worldId, reached.add(id));
}
/** Dismissible survival helper: the next step of the progression, derived from the inventory, armor, position and world stats. */
export function GoalChip({ view, pv, me }: { view: View; pv: PrivateView; me: PubPlayer }) {
  const inv = useStore(store, s => s.inv), show = useStore(store, s => s.settings.showGoals);
  const reached = reachedGoals(view.worldId), before = reached.size;
  const village = view.mobs.some(mob => mob.t === MOB.villager && Math.hypot(mob.x - me.x, mob.z - me.z) < 24);
  // A portal lighting up nearby (its fx) completes "Build a Nether portal" at once, so "Enter the Nether" gets its turn.
  const lit = view.fx.some(fx => fx.k === 'portal' && Math.hypot(fx.x - me.x, fx.y - me.y, fx.z - me.z) < 10);
  const ctx = { inv, day: view.day, time: view.time, placed: view.stats.placed, armor: pv.armor, nether: pv.dimension === 'nether', portal: !!pv.portal || lit, village };
  const goal = nextGoal(ctx, reached);
  useEffect(() => { if (reached.size !== before) saveReached(view.worldId, reached); });
  if (!show || !goal || view.mode !== 'survival') return null;
  return <aside className="bw-goal" aria-label="Next goal" data-urgent={goal.id === 'shelter' && shelterDue(ctx)}>
    <ItemIcon id={goal.icon}/>
    <div><small>Next goal</small><b>{goal.title}</b><span>{goal.hint}</span></div>
    <button type="button" className="bw-goal-close" aria-label="Hide hints" onClick={() => { updateSettings({ showGoals: false }); toast('Hints hidden. Turn them back on in the menu.'); }}>×</button>
  </aside>;
}
