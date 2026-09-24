// Landscape phone controller and the shared input layer (command queue, keyboard, haptics) used by solo play too.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Droplets, HandGrab, Maximize2, Minimize2, Redo2, Slice, SprayCan, WifiOff, Zap } from 'lucide-react';
import { HoldButton, SteerPad, type GameViewProps, type StickValue } from '../../../party-ui/src/index';
import { itemLabel, matchRecipe, type Chef, type Command, type Input, type View } from './model';
import { kitchenMap } from './levels';
import { actHint, clock, grabHint, nextTip, shortLabel, tileStatus } from './presentation';
import { ItemIcon, OrderCard } from './hud';

type Props = GameViewProps<Input, never, View, null>;
const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
const KEY_COMMAND: Record<string, 'grab' | 'act' | 'dash'> = { ' ': 'grab', j: 'grab', k: 'act', e: 'act', shift: 'dash', l: 'dash' };

/**
 * Held movement plus a ≤4-entry queue of taps. The oldest unacknowledged command rides along with the held state
 * (the shell resends it every flush) until `chef.seq` catches up, so quick taps survive snapshot coalescing.
 */
export function useChefInput(chef: Chef, setInput: Props['setInput'], releaseInput: Props['releaseInput'], connected = true) {
  const pad = useRef<StickValue>({ x: 0, y: 0 }), keys = useRef<StickValue>({ x: 0, y: 0 }), act = useRef(false);
  const queue = useRef<{ cmd: Command; seq: number }[]>([]), serial = useRef(chef.seq), acked = useRef(chef.seq);
  const io = useRef({ setInput, releaseInput }); io.current = { setInput, releaseInput }; acked.current = chef.seq;
  const publish = () => {
    const next = queue.current[0], stick = pad.current.x || pad.current.y ? pad.current : keys.current;
    if (!stick.x && !stick.y && !act.current && !next) io.current.releaseInput?.();
    else io.current.setInput({ x: stick.x, y: stick.y, act: act.current, cmd: next?.cmd ?? null, seq: next?.seq ?? 0 });
  };
  const command = (cmd: Command) => {
    if (queue.current.length >= 4) return;
    serial.current = Math.max(serial.current, acked.current) + 1;
    queue.current.push({ cmd, seq: serial.current }); publish();
  };
  const controls = {
    move(value: StickValue) { pad.current = value; publish(); },
    grab(down: boolean) { if (down) command('grab'); },
    act(down: boolean) { act.current = down; if (down) command('act'); else publish(); },
    dash(down: boolean) { if (down) command('dash'); },
  };
  const latest = useRef(controls); latest.current = controls;
  useEffect(() => {
    const before = queue.current.length;
    queue.current = queue.current.filter(entry => entry.seq > chef.seq);
    if (queue.current.length !== before) publish();
  }, [chef.seq]);
  useEffect(() => {
    const held = new Set<string>();
    const clear = () => { held.clear(); queue.current = []; pad.current = keys.current = { x: 0, y: 0 }; act.current = false; io.current.releaseInput?.(); };
    const hidden = () => { if (document.hidden) clear(); };
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null, name = event.key.toLowerCase(), down = event.type === 'keydown';
      if (!MOVE_KEYS.has(name) && !KEY_COMMAND[name]) return;
      // Keys pressed while the shell has focus are the shell's, but a game key released there still ends its hold.
      if (target && target !== document.body && !target.closest('.kr-play') && (down || !held.has(name))) return;
      // Capture phase: the game owns these keys, so focused pad/buttons do not double-handle them.
      event.preventDefault(); event.stopPropagation();
      if (down) held.add(name); else held.delete(name);
      if (MOVE_KEYS.has(name)) {
        const has = (a: string, b: string) => held.has(a) || held.has(b);
        const x = Number(has('d', 'arrowright')) - Number(has('a', 'arrowleft')), y = Number(has('s', 'arrowdown')) - Number(has('w', 'arrowup')), length = Math.hypot(x, y) || 1;
        keys.current = { x: x / length, y: y / length }; publish();
      } else if (!event.repeat) latest.current[KEY_COMMAND[name]](down);
    };
    window.addEventListener('blur', clear); document.addEventListener('visibilitychange', hidden);
    window.addEventListener('keydown', key, true); window.addEventListener('keyup', key, true);
    return () => {
      clear(); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true);
    };
  }, []);
  useEffect(() => { if (!connected) { queue.current = []; pad.current = keys.current = { x: 0, y: 0 }; act.current = false; io.current.releaseInput?.(); } }, [connected]);
  return latest.current;
}

/** Short buzzes for my catches and serves, my falls, and any new fire. */
export function useHaptics(view: View, playerId: string | null) {
  const seen = useRef<number | null>(null);
  useEffect(() => {
    const latest = view.events.reduce((max, event) => Math.max(max, event.id), -1);
    if (seen.current === null) { seen.current = latest; return; }
    let pattern: number[] | null = null;
    for (const event of view.events) {
      if (event.id <= seen.current) continue;
      const mine = event.player === playerId;
      if (event.type === 'fire') pattern = [90, 60, 90];
      else if (mine && event.type === 'fall') pattern ??= [160];
      else if (mine && (event.type === 'serve' || event.type === 'catch')) pattern ??= [25, 35, 25];
    }
    seen.current = Math.max(seen.current, latest);
    if (pattern && typeof navigator.vibrate === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches) try { navigator.vibrate(pattern); } catch { /* Unsupported. */ }
  }, [view.events, playerId]);
}

const ACT_ICON: Record<string, typeof Slice> = { Chop: Slice, Wash: Droplets, Spray: SprayCan, Throw: Redo2 };
/** Everything the phone and solo overlay need to know about "me" this frame. */
export function useChef(view: View, playerId: string | null) {
  const chef = view.players.find(player => player.id === playerId) ?? view.players[0];
  const map = kitchenMap(view.settings.level, view.players.length), tile = chef.target >= 0 ? map.tiles[chef.target] : undefined;
  const state = tile && view.tiles.find(entry => entry.at === tile.index);
  return { chef, number: view.players.indexOf(chef) + 1, tile, state, status: tileStatus(tile, state, view.settings.relaxed), act: actHint(chef, tile, state), grab: grabHint(chef, tile, state, view) };
}

/** Steer pad on the left, action cluster on the right: Grab under the resting thumb, Chop·Throw above-left, Dash below-left. */
export function Controls({ publicView: view, playerId, setInput, releaseInput, connected = true }: Props) {
  const me = useChef(view, playerId), input = useChefInput(me.chef, setInput, releaseInput, connected), { act, grab } = me, Glyph = ACT_ICON[act.label];
  const off = !connected || me.chef.respawnAt > view.now, working = me.chef.work !== 'none';
  return <>
    <div className="kr-steer"><SteerPad label="Move" onChange={input.move} disabled={off}/></div>
    <div className="kr-cluster" data-act={act.kind}>
      {/* A refused act stays tappable (the server explains why); it only looks disabled. */}
      <div className={`kr-action kr-action-act ${working ? 'kr-working' : ''}`}><HoldButton label={act.reason ? `${act.label}: ${act.reason}` : act.label} onChange={input.act} disabled={off}><Glyph aria-hidden="true"/><strong>{working ? `${act.label}…` : act.label}</strong>{act.reason && <small>{act.reason}</small>}</HoldButton></div>
      <div className="kr-action kr-action-dash"><HoldButton label="Dash" onChange={input.dash} disabled={off}><Zap aria-hidden="true"/><strong>Dash</strong></HoldButton></div>
      <div className={`kr-action kr-action-grab ${grab.label === 'Serve!' ? 'kr-serve' : ''} ${grab.ok ? '' : 'kr-nope'}`}><HoldButton label={`Grab: ${grab.label}`} onChange={input.grab} disabled={off}><HandGrab aria-hidden="true"/><strong>Grab</strong><small>{grab.label}</small></HoldButton></div>
    </div>
  </>;
}

/** The shell header is hidden during play, so the controller carries its own full-screen toggle (where the browser allows one). */
function FullScreenToggle() {
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const update = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', update); return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  if (!document.fullscreenEnabled) return null;
  const toggle = () => {
    if (full) return void document.exitFullscreen().catch(() => {});
    // Android can also pin landscape once full screen; browsers that refuse keep the normal rotation gate.
    void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => (screen.orientation as { lock?(o: string): Promise<void> }).lock?.('landscape')).catch(() => {});
  };
  const Icon = full ? Minimize2 : Maximize2;
  return <button type="button" className="kr-fullscreen" aria-label={full ? 'Exit full screen' : 'Full screen'} onClick={toggle}><Icon aria-hidden="true"/>{!full && <span>Full screen</span>}</button>;
}

export function Controller(props: Props) {
  const { publicView: view, playerId, connected = true } = props, me = useChef(view, playerId);
  useHaptics(view, playerId);
  const { chef, status } = me, note = view.now - chef.noteAt < 3500 && chef.note, fallen = chef.respawnAt > view.now;
  return <div className="kr-play kr-phone" style={{ '--chef': chef.color } as CSSProperties} data-command-seq={chef.seq} data-chef-x={chef.x.toFixed(2)} data-chef-z={chef.z.toFixed(2)}>
    <Controls {...props}/>
    <section className="kr-strip" aria-label="Your station">
      <header className="kr-strip-top">
        <b className="kr-me">{me.number}</b>
        <FullScreenToggle/>
        <span className="kr-strip-time kp-numeral">{clock(view.endsAt - Math.max(view.now, view.startedAt))}</span>
        <span className="kr-strip-score kp-numeral">{view.score}{view.combo > 1 && <small>{nextTip(view.combo)}</small>}</span>
      </header>
      <div className={`kr-card kr-held ${matchRecipe(chef.held) ? 'kr-ready' : ''}`} aria-label={`Holding ${itemLabel(chef.held)}`}>
        <ItemIcon item={chef.held}/><span><small>Holding</small><strong>{shortLabel(chef.held)}</strong></span>
      </div>
      <div className={`kr-card kr-target kr-tone-${status?.tone ?? 'idle'}`}>
        <span><small>{status?.label ?? 'Facing'}</small><strong>{status?.detail || 'Walk up to a station'}</strong></span>
        {status?.progress !== undefined && <span className="kr-meter"><i style={{ width: `${status.progress * 100}%` }}/></span>}
      </div>
      <div className="kr-strip-orders" aria-label="Next orders">{view.orders.slice(0, 2).map(order => <OrderCard key={order.id} order={order} now={view.now} relaxed={view.settings.relaxed} compact/>)}</div>
      <p className="kr-note" role="status" key={chef.noteAt}>{note}</p>
    </section>
    {(fallen || !connected) && <div className="kr-phone-alert" role="alert">{!connected ? <><WifiOff aria-hidden="true"/>Reconnecting… controls released</> : <>Splash! Back in {Math.ceil((chef.respawnAt - view.now) / 1000)}…</>}</div>}
  </div>;
}
