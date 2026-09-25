/** Pause/help sheet (settings + controls) and the death screen. */
import { useState } from 'react';
import { ToggleRow } from '../../../../../party-ui/src/index';
import { respawn } from '../game/predict';
import { store, type RenderDistance } from '../store';
import { Sheet } from './screens';
import { relockPointer, updateSettings, useStore, useTouchMode } from './state';

const DISTANCES: readonly { value: RenderDistance; label: string }[] = [{ value: 4, label: 'Low' }, { value: 6, label: 'Balanced' }, { value: 8, label: 'High' }];
const close = () => { store.set({ screen: null }); relockPointer(); };

function Range({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format(v: number): string; onChange(v: number): void }) {
  return <label className="bw-range"><span>{label}<output>{format(value)}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))}/></label>;
}

function SettingsPanel() {
  const settings = useStore(store, s => s.settings);
  return <div className="bw-settings-panel">
    <div className="bw-field" role="radiogroup" aria-label="Render distance">
      <span>View distance</span>
      <div className="bw-segment">{DISTANCES.map(d => <button key={d.value} type="button" role="radio" aria-checked={settings.renderDistance === d.value}
        onClick={() => updateSettings({ renderDistance: d.value })}>{d.label}<small>{d.value} chunks</small></button>)}</div>
    </div>
    <Range label="Look sensitivity" value={settings.sensitivity} min={0.2} max={3} step={0.05} format={v => `${v.toFixed(2)}×`} onChange={sensitivity => updateSettings({ sensitivity })}/>
    <Range label="Field of view" value={settings.fov} min={50} max={110} step={1} format={v => `${v}°`} onChange={fov => updateSettings({ fov })}/>
    <ToggleRow label="Invert look up/down" checked={settings.invertY} onChange={invertY => updateSettings({ invertY })}/>
    <ToggleRow label="Auto jump (step up one-block ledges)" checked={settings.autoJump} onChange={autoJump => updateSettings({ autoJump })}/>
    <ToggleRow label="Show next-goal hints" checked={settings.showGoals} onChange={showGoals => updateSettings({ showGoals })}/>
  </div>;
}

const KEYS: readonly [string, string][] = [
  ['Click the world', 'Capture the mouse'], ['W A S D', 'Move'], ['Mouse', 'Look'], ['Space', 'Jump (double-tap to fly in creative)'], ['Shift', 'Sneak / fly down'],
  ['Ctrl or double-tap W', 'Sprint'], ['Left mouse', 'Mine / attack (hold)'], ['Right mouse', 'Place / use / eat'], ['1–9 or wheel', 'Choose hotbar slot'],
  ['E', 'Inventory and crafting'], ['Q', 'Drop item'], ['Esc', 'Free the mouse / menu'],
];
const TOUCH: readonly [string, string][] = [
  ['Left thumb', 'Drag anywhere on the left to walk; push to the edge to sprint'], ['Right thumb', 'Drag empty space to look around'],
  ['Mine', 'Hold to mine blocks or attack'], ['Use', 'Tap to place or open; hold to eat or draw a bow'], ['Jump', 'Tap to jump; in creative double-tap to fly, hold to rise'],
  ['Sneak', 'Toggle to creep along edges without falling'], ['Items', 'Inventory, crafting and the recipe book'], ['Drop', 'Hold to drop one item; keep holding for the stack'],
  ['Slots', 'Tap to pick up or place; hold to split a stack; Quick move sends items across'],
];
const Controls = ({ rows }: { rows: readonly [string, string][] }) => <dl className="bw-controls">{rows.map(([key, text]) => <div key={key}><dt>{key}</dt><dd>{text}</dd></div>)}</dl>;

/** The platform's host-only Room menu sits behind this modal sheet, so hosts get a shortcut that closes the sheet first. */
function openRoomMenu() {
  store.set({ screen: null });
  setTimeout(() => [...document.querySelectorAll<HTMLButtonElement>('.kp-header button')].find(button => button.textContent?.trim() === 'Room menu')?.click());
}

type Tab = 'settings' | 'keys' | 'touch';
const TAB_LABEL: Record<Tab, string> = { settings: 'Settings', keys: 'Keyboard', touch: 'Touch' };
/** The world keeps running while this is open (it is shared), so it is a menu rather than a pause. */
export function PauseSheet({ host }: { host: boolean }) {
  const touchMode = useTouchMode(), [tab, setTab] = useState<Tab>('settings');
  const tabs: Tab[] = touchMode ? ['settings', 'touch', 'keys'] : ['settings', 'keys', 'touch'];
  return <Sheet title="Menu" className="bw-menu-sheet" onClose={close} tools={host && <button type="button" className="bw-chip" onClick={openRoomMenu}>Room menu</button>}>
    <div className="bw-tabs bw-text-tabs" role="tablist">
      {tabs.map(id => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{TAB_LABEL[id]}</button>)}
    </div>
    {tab === 'settings' ? <SettingsPanel/> : <Controls rows={tab === 'keys' ? KEYS : TOUCH}/>}
    <button type="button" className="bw-resume" onClick={close}>Back to the world</button>
  </Sheet>;
}

export function DeathScreen({ message, kept }: { message?: string; kept: boolean }) {
  const pending = useStore(store, s => s.queue.some(cmd => cmd.t === 'respawn'));
  return <div className="bw-death" role="alertdialog" aria-labelledby="bw-death-title" aria-describedby="bw-death-message">
    <h2 id="bw-death-title" className="kp-title">You died!</h2>
    <p id="bw-death-message">{message ?? 'You fell in the wild.'}</p>
    <p className="bw-death-items" data-kept={kept}>{kept ? 'Your items are safe. You keep them when you respawn.' : 'Your items were dropped where you fell. Hurry back for them.'}</p>
    <button type="button" className="bw-resume" disabled={pending} autoFocus onClick={respawn}>{pending ? 'Respawning…' : 'Respawn'}</button>
  </div>;
}
