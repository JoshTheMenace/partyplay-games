import { useEffect, useState } from 'react';
import { Maximize, Smartphone } from 'lucide-react';
import { ArcadeButton, Eyebrow, Panel } from './primitives';

export type Orientation = {
  /** Viewport is taller than it is wide. */
  portrait: boolean;
  /** Coarse pointer and a short side under 600px: a phone rather than a tablet or laptop touch screen. */
  phone: boolean;
  fullscreen: boolean;
};

const PHONE_MAX_SHORT_SIDE = 600;
const IDLE: Orientation = { portrait: false, phone: false, fullscreen: false };

function read(): Orientation {
  if (typeof window === 'undefined') return IDLE;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  return {
    portrait: window.matchMedia('(orientation: portrait)').matches,
    phone: coarse && shortSide < PHONE_MAX_SHORT_SIDE,
    fullscreen: document.fullscreenElement != null,
  };
}

/** Live orientation, phone class, and fullscreen state. Updates on rotation, resize, and fullscreen changes. */
export function useOrientation(): Orientation {
  const [state, setState] = useState<Orientation>(IDLE);
  useEffect(() => {
    const update = () =>
      setState((previous) => {
        const next = read();
        return previous.portrait === next.portrait && previous.phone === next.phone && previous.fullscreen === next.fullscreen ? previous : next;
      });
    const media = window.matchMedia('(orientation: portrait)');
    update();
    media.addEventListener('change', update);
    window.addEventListener('resize', update);
    document.addEventListener('fullscreenchange', update);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('fullscreenchange', update);
    };
  }, []);
  return state;
}

export function fullscreenAvailable() {
  return typeof document !== 'undefined' && Boolean(document.fullscreenEnabled) && typeof document.documentElement.requestFullscreen === 'function';
}

export type LandscapeResult = 'locked' | 'fullscreen' | 'unsupported';

/**
 * Call only from a user gesture. Enters fullscreen first, because Android browsers only honour an orientation lock while
 * fullscreen, then asks for a landscape lock. Safari and desktop Firefox do not expose the lock; they still get fullscreen
 * where available and the caller falls back to asking the player to turn the phone.
 */
export async function requestLandscape(): Promise<LandscapeResult> {
  if (!fullscreenAvailable()) return 'unsupported';
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    return 'unsupported';
  }
  const orientation = (screen as Screen & { orientation?: { lock?: (value: string) => Promise<void> } }).orientation;
  if (!orientation?.lock) return 'fullscreen';
  try {
    await orientation.lock('landscape');
    return 'locked';
  } catch {
    return 'fullscreen';
  }
}

export async function exitFullscreen() {
  if (typeof document === 'undefined' || !document.fullscreenElement) return;
  try {
    await document.exitFullscreen();
  } catch {
    // Leaving fullscreen is best effort; the browser may already have left it.
  }
}

const RESULT_TEXT: Record<LandscapeResult, string> = {
  locked: 'Full screen is on and rotation is locked to landscape.',
  fullscreen: 'Full screen is on. This browser leaves the rotation to you, so turn the phone.',
  unsupported: 'Full screen is not available in this browser. Just turn the phone.',
};

/**
 * Blocking prompt shown while a phone is held upright during a race. The real controls sit underneath, disabled by
 * GameClient.setControlsEnabled(false), so this never fakes a rotated layout with CSS.
 */
export function RotatePrompt({ mode, connected }: { mode: GameMode; connected: boolean }) {
  const [result, setResult] = useState<LandscapeResult | null>(null);
  const canFullscreen = fullscreenAvailable();
  const body =
    mode === 'solo'
      ? 'The race is paused. Turn the phone sideways, then tap Resume to carry on.'
      : connected
        ? 'Your kart is coasting on its own. Nobody lost connection; the controls come back the moment you turn.'
        : 'Reconnecting to the host as well. Turn the phone sideways and check your connection.';
  return (
    <section className="kp-touch fixed inset-0 z-50 flex items-center justify-center bg-kp-ink/95 p-5 text-center" aria-labelledby="kp-rotate-title">
      <Panel className="kp-anim-pop flex w-full max-w-sm flex-col items-center gap-4 p-6">
        <span className="flex size-20 items-center justify-center rounded-full bg-kp-sun/15">
          <Smartphone className="kp-anim-rotate size-11 text-kp-sun" strokeWidth={2.25} aria-hidden="true" />
        </span>
        <div>
          <Eyebrow>Landscape only</Eyebrow>
          <h2 id="kp-rotate-title" className="kp-display mt-1 text-3xl text-kp-cream">Turn your phone sideways</h2>
        </div>
        <p className="text-sm font-bold text-kp-cream/75">{body}</p>
        {canFullscreen ? (
          <ArcadeButton
            tone="sun"
            size="md"
            icon={<Maximize />}
            onClick={() => {
              void requestLandscape().then(setResult);
            }}
          >
            Go full screen
          </ArcadeButton>
        ) : null}
        <p className="text-xs font-bold text-kp-cream/55" aria-live="polite">
          {result ? RESULT_TEXT[result] : 'Sideways gives the steering pad and the buttons the most room.'}
        </p>
      </Panel>
    </section>
  );
}

type GameMode = 'solo' | 'party' | 'controller' | 'display';
