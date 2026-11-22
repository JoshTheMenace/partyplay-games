/* TV HUD over the 3D scene plus the small pieces every Night Job screen shares. */
import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { GameViewProps } from '../../../party-ui/src/index';
import { COINS_PER_CHARGE, CREWS, ROLES, TOOLS, type Action, type CrewLine, type HeistMap, type Input, type PlayerView, type View } from './model';
import { getMap } from './maps';
import { decode, type Night, type Own, type Wire } from './wire';

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

/** What a crew is up to, in two or three words (the board and the phones share it). `short` is for a long board's one-line rows. */
export function lineStatus(line: CrewLine, noun: string, short = false) {
  if (line.phase === 'clear') return `Away ${clock(line.seconds)}`;
  if (line.phase === 'failed') return 'Out';
  if (line.down === line.size) return short ? 'All down' : 'Whole crew down';
  return line.chased ? 'Spotted!' : line.alarm ? 'Alarm!' : line.taken ? short ? 'Has it' : `Has the ${noun}` : 'Inside';
}
export const lineMood = (line: CrewLine) => line.phase === 'clear' ? 'away' : line.phase === 'failed' ? 'out' : line.chased || line.alarm || line.down === line.size ? 'hot' : line.taken ? 'goods' : 'quiet';
export const sunrise = (night: Night) => `${night.lastCall ? 'Sunrise' : 'Night ends'} ${clock(night.left)}`;
/** Every crew, best placed first. The crew on screen is marked; `mine` marks a phone's own crew. */
export function Board({ night, mine = -1 }: { night: Night; mine?: number }) {
  const noun = getMap(night.wire.base.mission).objectiveKind, rows = [...night.lines].sort((a, b) => a.place - b.place || a.crew - b.crew);
  // Above eight crews a row is one line: the status shortens so a crew's name never has to.
  const long = rows.length > 8;
  return <ol className={`nj-board${long ? ' nj-board-long' : ''}`} style={{ '--nj-rows': rows.length } as CSSProperties} aria-label="Crews">{rows.map(line => <li key={line.crew} style={tone(CREWS[line.crew].color)} data-mood={lineMood(line)} data-on={line.crew === night.wire.cast || undefined} data-mine={line.crew === mine || undefined}>
    <b className="nj-place kp-numeral">{line.place}</b>
    <span className="nj-crew-name">{CREWS[line.crew].name}</span>
    <span className="nj-dots" aria-label={`${line.size - line.down} of ${line.size} standing`}>{Array.from({ length: line.size }, (_, i) => <i key={i} className={i < line.down ? 'nj-off' : undefined}/>)}</span>
    <em>{lineStatus(line, noun, long)}</em>
    <span className="nj-take kp-numeral">{line.collected}</span>
  </li>)}</ol>;
}

/** Slim top bar and crew strip over the scene. Their measured edges tell the renderer which part stays uncovered. */
export function DisplayView({ publicView }: GameViewProps<Input, Action, Wire, Own>) {
  const night = decode(publicView), view = night.cast, crew = CREWS[view.crew];
  const map = getMap(view.mission), root = useRef<HTMLDivElement>(null), alarm = alarmSeconds(view), message = useFreshMessage(view, map.briefing), briefing = message === map.briefing, ended = view.phase === 'clear' || view.phase === 'failed';
  useLayoutEffect(() => {
    const element = root.current, stage = element?.closest<HTMLElement>('.kp-scene-stage');
    if (!element || !stage) return;
    const top = element.querySelector<HTMLElement>('.nj-top')!, strip = element.querySelector<HTMLElement>('.nj-bottom')!, board = element.querySelector<HTMLElement>('.nj-board');
    const fit = () => {
      const box = stage.getBoundingClientRect();
      stage.style.setProperty('--nj-hud-top', `${Math.ceil(top.getBoundingClientRect().bottom - box.top)}px`);
      stage.style.setProperty('--nj-hud-bottom', `${Math.ceil(box.bottom - strip.getBoundingClientRect().top)}px`);
      stage.style.setProperty('--nj-hud-right', `${board ? Math.ceil(box.right - board.getBoundingClientRect().left) : 0}px`);
    };
    const observer = new ResizeObserver(fit); [stage, top, strip, board].forEach(e => e && observer.observe(e)); fit();
    return () => { observer.disconnect(); for (const side of ['top', 'bottom', 'right']) stage.style.removeProperty(`--nj-hud-${side}`); };
  }, [night.rival]);
  const chip = view.alarm && !ended ? 'Alarm' : { infiltrate: 'Quiet', escape: 'Escape', clear: 'Clear', failed: night.rival ? 'Out' : 'Busted' }[view.phase], news = night.news.at(-1);
  return <div ref={root} className={`night-job nj-hud${view.alarm && !ended ? ' nj-alarm-on' : ''}${night.rival ? ' nj-broadcast' : ''}`} style={tone(crew.color)} data-phase={view.phase} data-elapsed={Math.floor(view.elapsed)} data-collected={view.collected} data-total={view.totalLoot} data-alarm={!!view.alarm} data-heist-id={view.heistId} data-crews={night.crews.length} data-cast={view.crew}>
    <header className="nj-top">
      <div className="nj-plate nj-mission">
        {night.rival ? <small key={view.crew} className="nj-live"><i aria-hidden="true"/>Live · The {crew.name}</small> : <small>{map.title}</small>}
        <strong key={`${view.crew}${view.phase}`} className={`nj-objective nj-objective-${view.phase}`}>{objectiveText(view, map)}</strong>
      </div>
      {view.alarm && !ended ? <div className="nj-alarm" role="alert"><b>Alarm</b><span className="kp-numeral">{alarm}s</span></div>
        : night.rival ? news ? <p key={news.at} className="nj-message nj-news" style={tone(CREWS[news.crew].color)} role="status">{news.text}</p> : <span/>
          : message && !briefing && !ended ? <p key={message} className="nj-message" role="status">{message}</p> : <span/>}
      <div className="nj-plate nj-stats">
        {night.rival ? <span className={`nj-stat${night.lastCall ? ' nj-last-call' : ''}`}><small>{night.lastCall ? 'Sunrise in' : 'Night ends'}</small><b className="kp-numeral">{clock(night.left)}</b></span>
          : <span className="nj-stat"><small>Time</small><b className="kp-numeral">{clock(view.elapsed)}</b></span>}
        <span className="nj-stat nj-loot"><small>Loot</small><b className="kp-numeral">{view.collected}<span>/{view.totalLoot}</span></b></span>
        <span key={chip} className={`nj-phase nj-phase-${view.alarm && !ended ? 'alarm' : view.phase}`} role="status">{chip}</span>
      </div>
    </header>
    {night.rival && <Board night={night}/>}
    {ended && <p key={view.crew} className={`nj-outro nj-outro-${view.phase}`} role="status">{view.phase === 'clear' ? night.rival ? `The ${crew.name} are away!` : 'Clean getaway!' : night.rival ? view.message || 'Out of the night' : 'Busted'}</p>}
    <footer className="nj-bottom">
      {briefing && !night.rival && <p className="nj-briefing-card"><b>{map.title}</b>{message}</p>}
      <div className="nj-crew">{view.players.map(p => <CrewCard key={p.id} p={p}/>)}</div>
    </footer>
  </div>;
}
