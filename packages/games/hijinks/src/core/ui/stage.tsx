/* The TV stage and its showbiz dressing: scaled 1920×1080 canvas, spotlights, entrances, titles, banners, confetti. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export const STAGE_W = 1920, STAGE_H = 1080;
const PALETTE = ['var(--kp-sun)', 'var(--kp-coral)', 'var(--kp-sky)', 'var(--kp-lime)', 'var(--kp-grape)', 'var(--kp-cream)'];

/**
 * TV canvas. Children lay out in a fixed 1920×1080 px box that is uniformly scaled (letterboxed) to the space left in the
 * viewport. `accent` tints the lights and floor; `--hj-accent` is available to everything inside. `fill` (the pack's host
 * display) covers the whole browser viewport and floats the platform header over the top, hiding it while idle.
 */
export function Stage({ accent = '#b58aff', children, className = '', fill = false }: { accent?: string; children: ReactNode; className?: string; fill?: boolean }) {
  const frame = useRef<HTMLDivElement>(null), [fit, setFit] = useState({ scale: .5, left: 0, top: 0 });
  useLayoutEffect(() => {
    const el = frame.current!;
    const measure = () => {
      const width = el.clientWidth, height = fill ? el.clientHeight : Math.max(240, document.documentElement.clientHeight - (el.getBoundingClientRect().top + window.scrollY) - 12);
      const scale = Math.min(width / STAGE_W, height / STAGE_H), left = (width - STAGE_W * scale) / 2, top = fill ? (height - STAGE_H * scale) / 2 : 0;
      setFit(old => old.scale === scale && old.left === left && old.top === top ? old : { scale, left, top });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(el);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [fill]);
  const full = useTvChrome(fill);
  return <div ref={frame} className={`hj-stage-frame${fill ? ' hj-stage-fill' : ''}`} style={fill ? undefined : { height: STAGE_H * fit.scale }}>
    <div className={`hj-stage ${className}`} style={{ '--hj-accent': accent, transform: `translate(${fit.left}px, ${fit.top}px) scale(${fit.scale})` } as CSSProperties}>
      <Backdrop />
      <div className="hj-stage-content">{children}</div>
    </div>
    {fill && full && <button type="button" className="hj-fullscreen" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}>{full === 'on' ? 'Exit full screen' : 'Full screen'}</button>}
  </div>;
}

/** Marks <html data-hj-tv> while a filling stage is mounted and sets data-hj-idle after 3.5 s without input. Returns the full-screen state. */
function useTvChrome(on: boolean) {
  const [full, setFull] = useState<'on' | 'off' | null>(null);
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement, events = ['pointermove', 'pointerdown', 'keydown'] as const;
    let timer = 0;
    const wake = () => { delete root.dataset.hjIdle; clearTimeout(timer); timer = window.setTimeout(() => { root.dataset.hjIdle = ''; }, 3500); };
    const screen = () => setFull(document.fullscreenEnabled ? document.fullscreenElement ? 'on' : 'off' : null);
    root.dataset.hjTv = ''; wake(); screen();
    events.forEach(type => window.addEventListener(type, wake, { passive: true }));
    document.addEventListener('fullscreenchange', screen);
    return () => { clearTimeout(timer); events.forEach(type => window.removeEventListener(type, wake)); document.removeEventListener('fullscreenchange', screen); delete root.dataset.hjTv; delete root.dataset.hjIdle; };
  }, [on]);
  return full;
}

/** Animated late-night backdrop: sweeping beams, marquee bulbs and a glowing floor in the accent colour. */
export function Backdrop() {
  return <div className="hj-backdrop" aria-hidden="true">
    <div className="hj-backdrop-glow" />
    <div className="hj-beam hj-beam-l" /><div className="hj-beam hj-beam-r" />
    <div className="hj-bulbs hj-bulbs-top">{Array.from({ length: 32 }, (_, i) => <i key={i} />)}</div>
    <div className="hj-floor" />
  </div>;
}

/** A spotlight cone that lands on its children (centre stage). */
export function Spotlight({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <div className={`hj-spotlight ${className}`}><div className="hj-spotlight-cone" aria-hidden="true" /><div className="hj-spotlight-pool" aria-hidden="true" /><div className="hj-spotlight-subject">{children}</div></div>;
}

/** Keyed entrance: whenever `k` changes the children remount with the chosen animation. `delay` in ms. */
export function Enter({ k, variant = 'pop', delay = 0, className = '', children }: { k?: string | number; variant?: 'pop' | 'rise' | 'slide' | 'zoom' | 'drop'; delay?: number; className?: string; children: ReactNode }) {
  return <div key={k} className={`hj-enter hj-enter-${variant} ${className}`} style={delay ? { animationDelay: `${delay}ms` } : undefined}>{children}</div>;
}

/** Giant stroked display title with an optional kicker line above. */
export function BigTitle({ children, kicker, size = 120, className = '' }: { children: ReactNode; kicker?: ReactNode; size?: number; className?: string }) {
  return <div className={`hj-bigtitle ${className}`} style={{ '--size': `${size}px` } as CSSProperties}>
    {kicker && <p className="hj-kicker">{kicker}</p>}
    <h1 className="kp-title">{children}</h1>
  </div>;
}

/** Ribbon banner for punchy moments ("Time's up!", "Jinx!"). Swoops in; tone picks the ribbon colour. */
export function Callout({ children, tone = 'sun', className = '' }: { children: ReactNode; tone?: 'sun' | 'coral' | 'sky' | 'lime' | 'grape'; className?: string }) {
  return <div className={`hj-callout hj-tone-${tone} ${className}`} role="status"><span>{children}</span></div>;
}

/** One-shot confetti burst over its container. Change `burst` to fire again. Hidden under reduced motion. */
export function Confetti({ burst = 0, count = 80 }: { burst?: string | number; count?: number }) {
  return <div key={burst} className="hj-confetti" aria-hidden="true">{Array.from({ length: count }, (_, i) => {
    const r = (n: number) => ((Math.sin((i + 1) * n) * 10000) % 1 + 1) % 1;
    return <i key={i} style={{ left: `${r(12.9898) * 100}%`, background: PALETTE[i % PALETTE.length], animationDelay: `${r(78.233) * 900}ms`, animationDuration: `${2200 + r(37.719) * 1600}ms`, '--spin': `${r(4.1414) * 1440 - 720}deg`, '--drift': `${(r(9.17) - .5) * 260}px`, width: 10 + r(3.3) * 12, height: 14 + r(5.5) * 10, borderRadius: i % 3 ? 3 : '50%' } as CSSProperties} />;
  })}</div>;
}
