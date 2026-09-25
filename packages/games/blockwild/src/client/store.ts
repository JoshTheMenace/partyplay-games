import type { Slot } from '../shared/items';
import type { Body } from '../shared/physics';
import type { Cmd, CmdBody, ScreenKind } from '../shared/protocol';

/** Framework-free observable store. `set` merges a patch and notifies subscribers synchronously if anything changed. */
export type Store<T extends object> = {
  get(): T;
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void;
  subscribe(listener: (state: T, previous: T) => void): () => void;
};
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<(state: T, previous: T) => void>();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      if (!Object.keys(next).some(key => !Object.is(next[key as keyof T], state[key as keyof T]))) return;
      const previous = state;
      state = { ...state, ...next };
      for (const listener of listeners) listener(state, previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type Target =
  | { kind: 'block'; x: number; y: number; z: number; face: number; cell: number; point: [number, number, number] }
  | { kind: 'mob'; id: number; distance: number };
/** Screens the player can open. 'inventory' uses the 2×2 grid; table/furnace/chest mirror PrivateView.screen. */
export type OpenScreen = 'inventory' | 'creative' | 'pause' | ScreenKind | null;
export type RenderDistance = 4 | 6 | 8;
export type ClientSettings = { renderDistance: RenderDistance; sensitivity: number; invertY: boolean; fov: number; muted: boolean; showGoals: boolean; autoJump: boolean };

export type ClientState = {
  /** Locally predicted body (client-authoritative position). */
  body: Body | null;
  health: number; food: number;
  /** Selected hotbar slot 0..8. */
  selected: number;
  target: Target | null;
  /** Mining progress 0..1 for the target block. */
  mining: number;
  screen: OpenScreen;
  pointerLocked: boolean;
  /** Predicted containers (replaced by the private view once acked). */
  inv: (Slot | null)[]; cursor: Slot | null; grid: (Slot | null)[]; out: Slot | null;
  /** Unacknowledged commands (ascending n) and the last assigned n. */
  queue: Cmd[]; lastN: number;
  /** Quick-move toggle for touch (tap acts as shift-click). */
  quickMove: boolean;
  settings: ClientSettings;
};

/**
 * Touch controls, polled every frame by the game loop (mutated directly, no notifications).
 * move: joystick -1..1 (x right, y forward). lookX/lookY: accumulated drag in CSS pixels; the loop consumes and zeroes them.
 */
export type TouchState = { active: boolean; move: [number, number]; sprint: boolean; lookX: number; lookY: number; jump: boolean; sneak: boolean; flyDown: boolean; mine: boolean; use: boolean };
export const touch: TouchState = { active: false, move: [0, 0], sprint: false, lookX: 0, lookY: 0, jump: false, sneak: false, flyDown: false, mine: false, use: false };
export function resetTouch() {
  Object.assign(touch, { move: [0, 0], sprint: false, lookX: 0, lookY: 0, jump: false, sneak: false, flyDown: false, mine: false, use: false });
}

const SETTINGS_KEY = 'blockwild.settings';
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const defaultSettings = (): ClientSettings => ({ renderDistance: coarse() ? 4 : 6, sensitivity: 1, invertY: false, fov: 75, muted: false, showGoals: true, autoJump: coarse() });
export function loadSettings(): ClientSettings {
  const base = defaultSettings();
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<ClientSettings>;
    return {
      renderDistance: raw.renderDistance === 4 || raw.renderDistance === 6 || raw.renderDistance === 8 ? raw.renderDistance : base.renderDistance,
      sensitivity: typeof raw.sensitivity === 'number' && raw.sensitivity >= 0.2 && raw.sensitivity <= 3 ? raw.sensitivity : base.sensitivity,
      invertY: raw.invertY === true, fov: typeof raw.fov === 'number' && raw.fov >= 50 && raw.fov <= 110 ? raw.fov : base.fov,
      muted: localStorage.getItem('party.sound.muted') === 'true', showGoals: raw.showGoals !== false,
      autoJump: typeof raw.autoJump === 'boolean' ? raw.autoJump : base.autoJump,
    };
  } catch { return base; }
}
export function saveSettings(settings: ClientSettings) {
  store.set({ settings });
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

export const initialClientState = (): ClientState => ({
  body: null, health: 20, food: 20, selected: 0, target: null, mining: 0, screen: null, pointerLocked: false,
  inv: Array<Slot | null>(36).fill(null), cursor: null, grid: Array<Slot | null>(4).fill(null), out: null,
  queue: [], lastN: 0, quickMove: false, settings: typeof localStorage === 'undefined' ? defaultSettings() : loadSettings(),
});
/** The shared client store (SceneView, ControllerView and HUD all read it). */
export const store = createStore<ClientState>(initialClientState());

/** Queue a gameplay command; returns its sequence number. The scene loop sends `queue` with every input. */
export function enqueue(cmd: CmdBody): number {
  const n = store.get().lastN + 1;
  store.set(state => ({ lastN: n, queue: [...state.queue, { ...cmd, n } as Cmd] }));
  return n;
}
/** Drop commands the server acknowledged. */
export function acknowledge(ack: number) {
  const { queue, lastN } = store.get();
  if (queue.length && queue[0]!.n <= ack) store.set({ queue: queue.filter(cmd => cmd.n > ack) });
  if (lastN < ack) store.set({ lastN: ack });
}
/** On (re)connect or a new round: restart numbering after the server's ack and forget pending commands. */
export function resetQueue(ack: number) { store.set({ queue: [], lastN: ack }); }
