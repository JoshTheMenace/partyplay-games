/* TV HUD over the 3D scene plus the small pieces every Night Job screen shares. */
import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { GameViewProps } from '../../../party-ui/src/index';
import { COINS_PER_CHARGE, ROLES, TOOLS, type Action, type HeistMap, type Input, type PlayerView, type View } from './model';
import { getMap } from './maps';

export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
export const tone = (color: string, extra?: Record<string, string>) => ({ '--nj-color': color, ...extra }) as CSSProperties;
export const objectiveText = (view: View, map: HeistMap) => ({ infiltrate: map.objective, escape: 'Everyone to the getaway!', clear: 'Clean getaway', failed: 'The crew was caught' })[view.phase];
export const alarmSeconds = (view: View) => view.alarm ? Math.max(0, Math.ceil((view.alarm.until - view.now) / 1000)) : 0;
/** Each new server message stays up for a few seconds of game time (the briefing a little longer), then fades out. */
function useFreshMessage(view: View, briefing: string) {
  const shown = useRef({ key: '', at: 0 }), key = view.heistId + view.message;
  if (shown.current.key !== key) shown.current = { key, at: view.now };
  return view.message && view.now - shown.current.at < (view.message === briefing ? 8000 : 6000) ? view.message : '';
}

export type Status = { kind: 'left' | 'offline' | 'down' | 'work' | 'carry' | 'hidden' | 'disguised'; label: string; progress?: number };
/** The single most important thing about a thief right now. */
export function statusOf(p: PlayerView): Status | null {
  if (p.suspended) return { kind: 'left', label: 'Left the job' };
  if (!p.connected) return { kind: 'offline', label: 'Offline' };
  if (p.down) return { kind: 'down', label: 'Down' };
  if (p.work) return { kind: 'work', label: p.work.label, progress: Math.max(0, Math.min(1, p.work.progress)) };
  if (p.carrying) return { kind: 'carry', label: 'Has the goods' };
  if (p.hidden) return { kind: 'hidden', label: 'Hidden' };
  if (p.disguised) return { kind: 'disguised', label: 'Disguised' };
  return null;
}

export const Health = ({ value }: { value: number }) => {
  const v = Math.max(0, Math.min(100, value));
  return <span className="nj-health" role="img" aria-label={`Health ${Math.round(v)}`} data-level={v > 50 ? 'ok' : v > 25 ? 'low' : 'critical'}><i style={{ width: `${v}%` }}/></span>;
};
/** Charge pips; beyond four a count stays readable at TV distance. */
export const Pips = ({ charges }: { charges: number }) => <span className="nj-pips" aria-hidden="true">{charges > 4 ? <><i className="nj-on"/><b className="kp-numeral">×{charges}</b></> : Array.from({ length: Math.max(charges, 2) }, (_, i) => <i key={i} className={i < charges ? 'nj-on' : undefined}/>)}</span>;
/** Coins toward the next tool charge. */
export const CoinMeter = ({ coins }: { coins: number }) => <span className="nj-coin-meter" role="img" aria-label={`${coins} coins, ${COINS_PER_CHARGE - coins % COINS_PER_CHARGE} to the next charge`}><b>◆</b><span><i style={{ width: `${coins % COINS_PER_CHARGE / COINS_PER_CHARGE * 100}%` }}/></span></span>;
export const Chip = ({ status }: { status: Status }) => <em className={`nj-chip nj-chip-${status.kind}`} style={status.progress !== undefined ? { '--p': status.progress } as CSSProperties : undefined}>{status.label}{status.progress !== undefined && <small className="kp-numeral"> {Math.round(status.progress * 100)}%</small>}</em>;

function CrewCard({ p }: { p: PlayerView }) {
  const role = ROLES[p.role], tool = TOOLS[p.tool], status = statusOf(p);
  return <article className={`nj-card nj-card-${status?.kind ?? 'ok'}${p.carrying ? ' nj-carrying' : ''}`} style={tone(p.color)} aria-label={`Seat ${p.seat + 1}, ${p.name}, ${role.name}`} data-player-id={p.id} data-health={Math.round(p.health)} data-down={p.down} data-charges={p.charges} data-coins={p.coins}>
    <b className="nj-seat kp-numeral">{p.seat + 1}</b>
    <span className="nj-name">{p.name}</span>
    <span className="nj-role"><i aria-hidden="true">{role.icon}</i>{role.name}</span>
    <span className="nj-kit" aria-label={`${tool.name}, ${p.charges} charges`}><i aria-hidden="true">{tool.icon}</i><Pips charges={p.charges}/></span>
    <span className="nj-foot">{status && <Chip status={status}/>}<Health value={p.health}/><CoinMeter coins={p.coins}/></span>
  </article>;
}

/** Slim top bar and crew strip over the scene. Their measured heights tell the renderer which band stays uncovered. */
export function DisplayView({ publicView: view }: GameViewProps<Input, Action, View, null>) {
  const map = getMap(view.mission), root = useRef<HTMLDivElement>(null), alarm = alarmSeconds(view), message = useFreshMessage(view, map.briefing), briefing = message === map.briefing, ended = view.phase === 'clear' || view.phase === 'failed';
  useLayoutEffect(() => {
    const element = root.current, stage = element?.closest<HTMLElement>('.kp-scene-stage');
    if (!element || !stage) return;
    const top = element.querySelector<HTMLElement>('.nj-top')!, crew = element.querySelector<HTMLElement>('.nj-bottom')!;
    const fit = () => {
      const box = stage.getBoundingClientRect();
      stage.style.setProperty('--nj-hud-top', `${Math.ceil(top.getBoundingClientRect().bottom - box.top)}px`);
      stage.style.setProperty('--nj-hud-bottom', `${Math.ceil(box.bottom - crew.getBoundingClientRect().top)}px`);
    };
    const observer = new ResizeObserver(fit); [stage, top, crew].forEach(e => observer.observe(e)); fit();
    return () => { observer.disconnect(); stage.style.removeProperty('--nj-hud-top'); stage.style.removeProperty('--nj-hud-bottom'); };
  }, []);
  const chip = view.alarm ? 'Alarm' : { infiltrate: 'Quiet', escape: 'Escape', clear: 'Clear', failed: 'Busted' }[view.phase];
  return <div ref={root} className={`night-job nj-hud${view.alarm ? ' nj-alarm-on' : ''}`} data-phase={view.phase} data-elapsed={Math.floor(view.elapsed)} data-collected={view.collected} data-total={view.totalLoot} data-alarm={!!view.alarm} data-heist-id={view.heistId}>
    <header className="nj-top">
      <div className="nj-plate nj-mission"><small>{map.title}</small><strong key={view.phase} className={`nj-objective nj-objective-${view.phase}`}>{objectiveText(view, map)}</strong></div>
      {view.alarm ? <div className="nj-alarm" role="alert"><b>Alarm</b><span className="kp-numeral">{alarm}s</span></div> : message && !briefing && !ended ? <p key={message} className="nj-message" role="status">{message}</p> : <span/>}
      <div className="nj-plate nj-stats">
        <span className="nj-stat"><small>Time</small><b className="kp-numeral">{clock(view.elapsed)}</b></span>
        <span className="nj-stat nj-loot"><small>Loot</small><b className="kp-numeral">{view.collected}<span>/{view.totalLoot}</span></b></span>
        <span key={chip} className={`nj-phase nj-phase-${view.alarm ? 'alarm' : view.phase}`} role="status">{chip}</span>
      </div>
    </header>
    {ended && <p className={`nj-outro nj-outro-${view.phase}`} role="status">{view.phase === 'clear' ? 'Clean getaway!' : 'Busted'}</p>}
    <footer className="nj-bottom">
      {briefing && <p className="nj-briefing-card"><b>{map.title}</b>{message}</p>}
      <div className="nj-crew">{view.players.map(p => <CrewCard key={p.id} p={p}/>)}</div>
    </footer>
  </div>;
}
