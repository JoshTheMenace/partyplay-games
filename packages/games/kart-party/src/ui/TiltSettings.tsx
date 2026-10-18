import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArcadeButton, ToggleRow } from '../../../../party-ui/src/index';
import type { InputComposer } from './input';
import { screenAngle, steerFromTilt, tiltAngle } from './tilt';

const KEY = 'party.kart-party.tilt';
type OrientationAPI = typeof DeviceOrientationEvent & { requestPermission?(): Promise<string> };
const orientationAPI = () => typeof DeviceOrientationEvent === 'undefined' ? null : DeviceOrientationEvent as OrientationAPI;
const readPreference = () => { try { return localStorage.getItem(KEY) === 'true'; } catch { return false; } };
let state = { enabled: readPreference(), armed: false, pending: false, open: false, error: '' }, attempt = 0;
state.armed = state.enabled && !!orientationAPI() && !orientationAPI()?.requestPermission;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;
const update = (change: Partial<typeof state>) => { state = { ...state, ...change }; for (const listener of listeners) listener(); };
const save = (enabled: boolean) => { update({ enabled }); try { localStorage.setItem(KEY, String(enabled)); } catch { /* Retain this session's choice. */ } };
async function select(tilt: boolean) {
  const id = ++attempt;
  update({ armed: false, pending: false, error: '' });
  if (!tilt) { save(false); return; }
  if (!window.isSecureContext) { update({ error: 'Tilt needs HTTPS. Touch steering is available.' }); return; }
  const api = orientationAPI();
  if (!api) { update({ error: 'Motion sensors are unavailable. Use touch steering.' }); return; }
  update({ pending: true });
  try {
    // Call directly from the tap so Safari can show its motion permission prompt.
    const permission = await api.requestPermission?.();
    if (id !== attempt) return;
    if (permission && permission !== 'granted') throw new Error('permission');
    save(true); update({ armed: true });
  } catch { if (id === attempt) update({ error: 'Motion permission was denied. Allow motion in browser settings or use touch.' }); }
  finally { if (id === attempt) update({ pending: false }); }
}

/** Shared only within this page: header settings and the controller never send preferences to the room. */
export function useTiltSteering(composer: InputComposer, connected: boolean) {
  const { armed, open } = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [active, setActive] = useState(false);
  const centre = useRef<number | null>(null);
  useEffect(() => {
    if (open) composer.clear();
    if (!armed || !connected || open) return;
    let suspended = document.hidden || !document.hasFocus(), last = performance.now(), received = false, filtered = 0, facing = 0;
    const reset = () => { centre.current = null; filtered = 0; composer.clear('m:'); setActive(false); };
    const blur = () => { suspended = true; reset(); };
    const resume = () => { suspended = document.hidden || !document.hasFocus(); last = performance.now(); received = false; reset(); };
    const read = (event: DeviceOrientationEvent) => {
      if (suspended || document.hidden) return;
      if (event.beta === null || event.gamma === null) return;
      // Facing is fixed at calibration so a hard turn can never flip it; rotating the phone recalibrates.
      if (centre.current === null) facing = screenAngle(event.beta, event.gamma, screen.orientation?.angle ?? window.orientation ?? 0, innerWidth > innerHeight);
      const angle = tiltAngle(event.beta, event.gamma, facing);
      if (angle === null) return;
      last = performance.now(); received = true;
      if (centre.current === null) { centre.current = angle; filtered = 0; composer.clear('t:steer'); }
      filtered += (steerFromTilt(angle, centre.current) - filtered) * .3;
      composer.steer('m:tilt', filtered); setActive(true);
    };
    const timer = setInterval(() => {
      if (!suspended && !document.hidden && performance.now() - last > (received ? 1500 : 4000)) {
        reset(); update({ armed: false, error: 'No motion data. Enable motion again or turn off Tilt steering to use touch.' });
      }
    }, 500);
    addEventListener('deviceorientation', read); addEventListener('blur', blur); addEventListener('focus', resume);
    addEventListener('orientationchange', resume); screen.orientation?.addEventListener('change', resume); document.addEventListener('visibilitychange', resume);
    return () => {
      clearInterval(timer); removeEventListener('deviceorientation', read); removeEventListener('blur', blur); removeEventListener('focus', resume);
      removeEventListener('orientationchange', resume); screen.orientation?.removeEventListener('change', resume); document.removeEventListener('visibilitychange', resume); reset();
    };
  }, [composer, armed, connected, open]);
  return active && armed && connected && !open;
}

export function TiltSettings({ onClose }: { onClose(): void }) {
  const { enabled, armed, pending, error } = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { update({ open: true }); return () => { attempt++; update({ open: false, pending: false }); }; }, []);
  return <>
    <ToggleRow label="Tilt steering" checked={enabled} disabled={pending} onChange={value => void select(value)}/>
    {enabled && !armed && <ArcadeButton size="sm" tone="sky" disabled={pending} onClick={() => void select(true)}>Enable motion</ArcadeButton>}
    {enabled && armed && <ArcadeButton size="sm" tone="sky" onClick={onClose}>Center steering</ArcadeButton>}
    <p role="status">{error || (pending ? 'Allow motion access in your browser.' : enabled ? 'Saved only on this device. Hold comfortably when closing to center steering.' : 'Touch steering is on. Saved only on this device.')}</p>
  </>;
}
