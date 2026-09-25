/** ControllerView: the playing seat's HUD and menus, layered over its own first-person SceneView. */
import { useEffect, useRef } from 'react';
import type { GameViewProps } from '../../../../../party-ui/src/index';
import { PF, type Action, type Input, type PrivateView, type PubPlayer, type View } from '../../shared/protocol';
import { hud } from '../game/hud';
import { closeScreen, sendCommand } from '../game/predict';
import { store, touch } from '../store';
import { Crosshair, GoalChip, Hotbar, SelectedName, Toasts, Vitals } from './hud';
import { DeathScreen, PauseSheet } from './menus';
import { ChestScreen, CreativeScreen, FurnaceScreen, InventoryScreen, TableScreen, TradeScreen } from './screens';
import { openMenu, relockPointer, toggleInventory, useServerToasts, useStore, useTouchMode } from './state';
import { TouchControls } from './touch';

const typing = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');

/**
 * The UI owns E (toggle inventory) and Escape-without-pointer-lock (menu). It listens in the window capture phase and
 * stops propagation, so the game loop's key handlers never see these keys twice.
 */
function useMenuKeys(dead: boolean) {
  const latest = useRef(dead);
  latest.current = dead;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      const screen = store.get().screen;
      if (event.code === 'KeyE') {
        if (screen) {
          closeScreen();
          relockPointer();
        } else if (!latest.current) toggleInventory();
      } else if (event.code === 'Escape' && !screen && !latest.current && !document.pointerLockElement) openMenu('pause');
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
}

function Screens({ view, me, worldId, host }: { view: PrivateView; me: PubPlayer; worldId: string; host: boolean }) {
  const screen = useStore(store, s => s.screen), armor = useStore(hud, s => s.armor);
  if (view.dead) return <DeathScreen message={view.deathMessage} kept={view.keepInventory}/>;
  switch (screen) {
    case 'inventory': return <InventoryScreen armor={armor} color={me.color}/>;
    case 'table': return <TableScreen/>;
    case 'furnace': return <FurnaceScreen/>;
    case 'chest': return <ChestScreen/>;
    case 'trade': return <TradeScreen worldId={worldId}/>;
    case 'creative': return <CreativeScreen/>;
    case 'pause': return <PauseSheet host={host}/>;
    default: return null;
  }
}

/** In bed: who is still awake, and a way out (MC's "Leave bed"; Jump or Sneak also work). */
function Sleeping({ view }: { view: View }) {
  const leaving = useStore(store, s => s.queue.some(cmd => cmd.t === 'wake'));
  return <div className="bw-sleep">
    <p className="kp-hud-text">Sleeping… {view.sleeping} of {view.players.filter(p => !(p.flags & (PF.OFFLINE | PF.DEAD))).length} in bed</p>
    <button type="button" className="bw-chip" disabled={leaving} onClick={() => sendCommand({ t: 'wake' })}>Leave bed</button>
  </div>;
}

export function ControllerView({ publicView, privateView, playerId, connected, isHost }: GameViewProps<Input, Action, View, PrivateView>) {
  const screen = useStore(store, s => s.screen), locked = useStore(store, s => s.pointerLocked), touchMode = useTouchMode();
  const dead = !!privateView?.dead, wasLocked = useRef(locked);
  useServerToasts(privateView);
  useMenuKeys(dead);
  // Death closes every container (the server returns grid/cursor items); the menu may stay open.
  useEffect(() => { if (dead && screen && screen !== 'pause') closeScreen(); }, [dead, screen]);
  // Desktop MC feel: losing the pointer lock (Esc, alt-tab) with nothing open shows the menu.
  useEffect(() => {
    if (wasLocked.current && !locked && !store.get().screen && !touch.active && !dead) openMenu('pause');
    wasLocked.current = locked;
  }, [locked]);
  // Leaving the round: never strand an open screen or a held touch in the next one.
  useEffect(() => () => store.set({ screen: null, quickMove: false }), []);

  const me = publicView.players.find(player => player.id === playerId);
  if (!privateView || !me) return <div className="bw-hud"><p className="bw-waiting kp-hud-text">Joining the world…</p></div>;
  const playing = !screen && !dead, sleeping = !!(me.flags & PF.SLEEPING);
  // The touch look layer fills the screen, so it renders first and every later control sits above it.
  return <div className="bw-hud" data-touch={touchMode}>
    {playing && touchMode && <TouchControls creative={privateView.mode === 'creative'}/>}
    {playing && !sleeping && <Crosshair/>}
    {playing && <GoalChip view={publicView} pv={privateView} me={me}/>}
    {!screen && <Toasts/>}
    {playing && !touchMode && !locked && <p className="bw-clickplay kp-hud-text">Click the world to play · <kbd>E</kbd> inventory · <kbd>Esc</kbd> menu</p>}
    {sleeping && !screen && <Sleeping view={publicView}/>}
    <div className="bw-bottom">
      <SelectedName/>
      {privateView.mode === 'survival' && <Vitals view={privateView}/>}
      <Hotbar/>
    </div>
    {connected === false && <p className="bw-reconnect" role="status">Reconnecting… your controls are paused.</p>}
    <Screens view={privateView} me={me} worldId={publicView.worldId} host={isHost}/>
  </div>;
}
