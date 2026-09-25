/**
 * UI-side state. The UI never calls setInput: container commands go through the game loop's command API
 * (../game/predict: prediction + queue), movement intents go into `touch`, and settings into the shared store.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PrivateView } from '../../shared/protocol';
import { closeScreen, dropSlot, openInventory } from '../game/predict';
import { createStore, resetTouch, saveSettings, store, touch, type ClientSettings, type OpenScreen, type Store } from '../store';

/** `night` toasts (the server's dusk and nightfall warnings) are larger and stay longer. */
export type Toast = { id: number; text: string; tone?: 'night' };
export const ui = createStore<{ toasts: Toast[] }>({ toasts: [] });

const subscribers = new WeakMap<object, (notify: () => void) => () => void>();
/** React binding for a Store. The selector must return a stable value (a field or a primitive). */
export function useStore<T extends object, R>(source: Store<T>, select: (state: T) => R): R {
  let subscribe = subscribers.get(source);
  if (!subscribe) subscribers.set(source, subscribe = notify => source.subscribe(() => notify()));
  return useSyncExternalStore(subscribe, () => select(source.get()), () => select(source.get()));
}

let toastId = 0;
/** Show a short notice at the top of the HUD (at most three at once; duplicates restart). */
export function toast(text: string, ms = 3600, tone?: Toast['tone']) {
  const id = ++toastId;
  ui.set(state => ({ toasts: [...state.toasts.filter(t => t.text !== text), { id, text, tone }].slice(-3) }));
  setTimeout(() => ui.set(state => ({ toasts: state.toasts.filter(t => t.id !== id) })), ms);
}
export const isNightWarning = (text: string) => /sun is setting|night falls/i.test(text);
/** Surface server toasts once each. The first view after mounting may carry an old toast, so it only sets the baseline. */
export function useServerToasts(view: PrivateView | null) {
  const [seen, setSeen] = useState<number | null>(null), n = view?.toast?.n ?? null;
  useEffect(() => {
    if (n === null || n === seen) return;
    if (seen !== null && view?.toast) {
      const night = isNightWarning(view.toast.text);
      toast(view.toast.text, night ? 7000 : 3600, night ? 'night' : undefined);
    }
    setSeen(n);
  }, [n]);
}

/** Open a menu-style screen (pause, creative); container screens come from the server or openInventory. */
export function openMenu(screen: Exclude<OpenScreen, null>) {
  if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
  resetTouch();
  store.set({ screen });
}
/** E key / Inventory button: toggle the inventory (the creative palette in creative mode). */
export function toggleInventory() {
  if (store.get().screen) closeScreen();
  else {
    resetTouch();
    openInventory();
  }
}
/** Drop one item (or the stack) from the selected hotbar slot. */
export function dropSelected(all: boolean) {
  const { selected, inv } = store.get();
  if (inv[selected]) dropSlot(selected, all);
}
/** Desktop: after closing a menu with a click, take the mouse back so play resumes without a second click. */
export function relockPointer() {
  if (touch.active || typeof document === 'undefined') return;
  // Newer browsers return a promise that rejects without a user gesture; staying unlocked is fine then.
  void Promise.resolve(document.querySelector<HTMLCanvasElement>('.kp-scene-surface canvas')?.requestPointerLock?.()).catch(() => {});
}

/** Clamp a settings patch into legal values. */
export function sanitizeSettings(base: ClientSettings, patch: Partial<ClientSettings>): ClientSettings {
  const next = { ...base, ...patch };
  const clamp = (value: number, min: number, max: number, fallback: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    renderDistance: next.renderDistance === 4 || next.renderDistance === 8 ? next.renderDistance : 6,
    sensitivity: Math.round(clamp(next.sensitivity, 0.2, 3, 1) * 100) / 100,
    invertY: next.invertY === true, fov: Math.round(clamp(next.fov, 50, 110, 75)),
    muted: next.muted === true, showGoals: next.showGoals !== false, autoJump: next.autoJump === true,
  };
}
/** Persist and publish settings (store.settings; the game loop applies render distance, sensitivity, invert Y and FOV live). */
export const updateSettings = (patch: Partial<ClientSettings>) => saveSettings(sanitizeSettings(store.get().settings, patch));

const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
/** True while the player uses touch: coarse pointer, or the most recent pointer was a finger. Mirrors into touch.active. */
export function useTouchMode(): boolean {
  const [on, setOn] = useState(coarse);
  useEffect(() => {
    const seen = (event: PointerEvent) => {
      if (event.pointerType === 'touch') setOn(true);
      else if (event.pointerType === 'mouse' && !coarse()) setOn(false);
    };
    window.addEventListener('pointerdown', seen, true);
    return () => window.removeEventListener('pointerdown', seen, true);
  }, []);
  useEffect(() => {
    touch.active = on;
    if (!on) resetTouch();
  }, [on]);
  return on;
}
