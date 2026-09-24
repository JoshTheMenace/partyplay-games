/* In-race HUD overlays. scene.tsx positions one ViewportHud per viewport using the same ViewRect as the
 * renderer, and one SharedHud over the whole display. Sizes use container-query units, so a HUD scales
 * with its own viewport (full screen, split in two or four, or a phone). */
import { useRef, type CSSProperties } from 'react';
import { angleDelta, headingOf } from '../sim/math';
import { sampleAt } from '../sim/track';
import { getTrack } from '../tracks/index';
import type { RaceEvent, RaceView, RacerView } from '../sim/types';
import type { ViewRect } from '../render/types';
import { splitRects } from '../render/layout';
import { ItemFace } from './icons';
import { Minimap } from './Minimap';
import { COUNTDOWN_SECONDS, formatTime, ordinalSuffix, Portrait, rankTone } from './common';
import './kart.css';   // the scene mounts the HUD directly, so it brings its own styles

export type ViewportHudProps = { race: RaceView; racer: RacerView; rect: ViewRect; viewports: number; showControlsHint?: boolean };

/** Driving against the course for 0.7 s (ignoring spins, respawns and slow shuffles). */
function useWrongWay(race: RaceView, racer: RacerView) {
  const since = useRef<number | null>(null), speed = Math.hypot(racer.vx, racer.vz);
  let wrong = false;
  if (race.phase === 'racing' && racer.finishTime === null && speed > 4 && racer.grounded && racer.respawnT <= 0 && racer.spinT <= 0 && racer.tumbleT <= 0) {
    const course = sampleAt(getTrack(race.track), racer.d).heading;
    wrong = Math.abs(angleDelta(headingOf(racer.vx, racer.vz), course)) > 1.95;
  }
  if (!wrong) since.current = null; else since.current ??= race.time;
  return wrong && race.time - since.current! > .7;
}

/** This racer's bumper knock while it is still flashing (0.45 s). */
function latestMoment(race: RaceView, racer: RacerView): RaceEvent | null {
  for (let i = race.events.length - 1; i >= 0; i--) {
    const e = race.events[i], age = race.time - e.t;
    if (age > .45) return null;
    if (e.racer === racer.id && age > -.5 && e.type === 'bumper') return e;
  }
  return null;
}

const INK_BLOBS = [{ x: 18, y: 30, s: 34, r: 10 }, { x: 64, y: 22, s: 28, r: -30 }, { x: 44, y: 58, s: 40, r: 50 }, { x: 82, y: 66, s: 30, r: 120 }, { x: 10, y: 74, s: 24, r: -80 }];
function Ink({ t }: { t: number }) {
  return <div className="kp2-ink" style={{ opacity: Math.min(1, t / 1.2) }} aria-hidden="true">
    {INK_BLOBS.map((b, i) => <svg key={i} viewBox="0 0 64 64" style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.s}cqmax`, transform: `translate(-50%,-50%) rotate(${b.r}deg)` }}>
      <path d="M32 7c9 0 12 9 20 10 7 1 7 11 1 14 5 5 3 14-5 13-2 8-11 12-17 6-7 5-17 1-16-8-8-2-9-12-2-15-5-6 0-15 8-13 1-5 5-7 11-7z"/>
      <circle cx="56" cy="52" r="4"/><circle cx="8" cy="54" r="3"/><ellipse cx="24" cy="21" rx="5" ry="2.6" fill="#fff" opacity=".25"/>
    </svg>)}
  </div>;
}

export function ViewportHud({ race, racer, rect, viewports, showControlsHint }: ViewportHudProps) {
  const wrongWay = useWrongWay(race, racer), finished = racer.finishTime !== null, moment = finished ? null : latestMoment(race, racer);
  const lap = Math.max(1, Math.min(race.laps, racer.lap)), sinceLap = race.time - racer.lapStart;
  const banner = finished || racer.lap < 2 || sinceLap > 2.6 ? null : racer.lap === race.laps ? 'Final lap!' : sinceLap < 1.8 ? `Lap ${racer.lap}` : null;
  const time = finished ? racer.finishTime! : Math.max(0, race.time);
  // In split screen the HUD hugs each view's outer edges so the centre stays free for the shared map.
  const bottom = viewports > 1 && rect.y > .01, right = viewports > 1 && rect.x > .01;
  return <div className={`kp2-hud ${bottom ? 'is-bottom' : ''} ${right ? 'is-right' : ''}`} aria-hidden={viewports > 1 || undefined}
    style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, '--me': racer.color } as CSSProperties}>
    {racer.inkT > 0 && !finished && <Ink t={racer.inkT}/>}
    {moment?.type === 'bumper' && <div key={moment.id} className="kp2-hud-bump"/>}
    <div className="kp2-hud-top">
      <div className="kp2-hud-left">
        <div className={`kp2-hud-slot ${racer.item || racer.rollT > 0 ? '' : 'is-empty'} ${racer.trailing ? 'is-trailing' : ''}`}><ItemFace racer={racer}/></div>
        <div className="kp2-hud-lap kp-numeral"><small>Lap</small>{lap}<span>/{race.laps}</span></div>
      </div>
      <div className="kp2-hud-right">
        <div className={`kp2-hud-rank kp-numeral kp2-rank-${rankTone(racer.rank)}`} aria-label={`Position ${racer.rank} of ${race.racers.length}`}>{racer.rank}<sup>{ordinalSuffix(racer.rank)}</sup></div>
        <div className="kp2-hud-time kp-numeral">{formatTime(time)}</div>
      </div>
    </div>
    {viewports > 1 && <div className="kp2-hud-tag"><i style={{ background: racer.color }}/>{racer.name}</div>}
    {banner && !wrongWay && <div className={`kp2-hud-banner ${racer.lap === race.laps ? 'is-final' : ''}`} key={banner}>{banner}</div>}
    {wrongWay && <div className="kp2-hud-alert" role="alert"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-5 7.5h10v3H7z" fill="currentColor"/></svg>Wrong way!</div>}
    {racer.respawnT > 0 && !finished && <div className="kp2-hud-note">Back on track in a sec…</div>}
    {finished && <div className="kp2-hud-finish"><span>Finish!</span><b className={`kp-numeral kp2-rank-${rankTone(racer.rank)}`}>{racer.rank}<sup>{ordinalSuffix(racer.rank)}</sup></b><small className="kp-numeral">{formatTime(racer.finishTime)}</small></div>}
    {showControlsHint && race.time < 6 && <div className="kp2-hud-hint"><span><kbd>←</kbd><kbd>→</kbd> steer</span><span><kbd>Shift</kbd> drift</span><span><kbd>E</kbd> item</span><span><kbd>S</kbd> brake</span><span><kbd>H</kbd> honk</span></div>}
  </div>;
}

/** Countdown, standings tower and minimap for the shared display (and spectator). */
export type SharedHudProps = { race: RaceView; followId: string | null; mode: 'split' | 'spectator' | 'personal' };

function CountdownBig({ time }: { time: number }) {
  if (time >= 1.1) return null;
  const text = time < -(COUNTDOWN_SECONDS - .5) ? 'Ready' : time < 0 ? String(Math.ceil(-time)) : 'GO!';
  return <div className="kp2-count" role="status" aria-live="assertive">
    <span key={text} className={`kp2-count-num n-${text === 'GO!' ? 'go' : text.toLowerCase()}`}>{text}</span>
    {time < 0 && <small>Press drift just before GO for a rocket start!</small>}
  </div>;
}

function Tower({ race, highlight }: { race: RaceView; highlight: readonly string[] }) {
  const rows = [...race.racers].sort((a, b) => a.rank - b.rank);
  return <ol className="kp2-tower" aria-label="Standings">
    {rows.map(r => <li key={r.id} className={`${highlight.includes(r.id) ? 'is-me' : ''} ${r.bot ? 'is-cpu' : ''}`} style={{ '--c': r.color } as CSSProperties}>
      <b className={`kp-numeral kp2-rank-${rankTone(r.rank)}`}>{r.rank}</b><Portrait index={r.character}/><span>{r.name}</span>
      {r.finishTime !== null ? <em className="kp2-tower-flag" aria-label="Finished"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1v14" stroke="currentColor" strokeWidth="2"/><path d="M4 2h10v8H4z" fill="#fff6e5"/><path d="M4 2h2.5v2H4zM9 2h2.5v2H9zM6.5 4H9v2H6.5zM11.5 4H14v2h-2.5zM4 6h2.5v2H4zM9 6h2.5v2H9zM6.5 8H9v2H6.5zM11.5 8H14v2h-2.5z" fill="#05071a"/></svg></em> : r.lap === race.laps && race.laps > 1 ? <em className="kp2-tower-final" aria-label="Final lap">F</em> : null}
    </li>)}
  </ol>;
}

export function SharedHud({ race, followId, mode }: SharedHudProps) {
  const humans = race.racers.filter(r => !r.bot), follow = race.racers.find(r => r.id === followId);
  const views = mode === 'split' ? humans.length : 1;
  // Tower + map fill the spare cells at the end of the grid's last row (3, 5, 7, 8 or 10 views); otherwise the map sits on a seam.
  const first = views >= 3 ? splitRects(views)[views] : undefined, spare = first && { ...first, w: 1 - first.x };
  const layout = mode === 'personal' ? 'personal' : views <= 1 ? 'full' : spare ? 'spare' : views === 2 ? 'duo' : views === 9 ? 'grid' : 'four';
  const highlight = mode === 'split' ? humans.map(r => r.id) : follow ? [follow.id] : [];
  return <div className={`kp2-shared kp2-shared-${layout}`}>
    <CountdownBig time={race.time}/>
    {layout === 'full' && <Tower race={race} highlight={highlight}/>}
    {spare && <div className="kp2-spare" style={{ left: `${spare.x * 100}%`, top: `${spare.y * 100}%`, width: `${spare.w * 100}%`, height: `${spare.h * 100}%` }}>
      <Tower race={race} highlight={highlight}/><Minimap race={race} highlight={highlight} className="kp2-minimap-spare"/>
    </div>}
    {!spare && layout !== 'grid' && <Minimap race={race} highlight={highlight} className={`kp2-minimap-${layout}`}/>}
    {mode === 'spectator' && follow && <div className="kp2-follow" style={{ '--c': follow.color } as CSSProperties}>
      <Portrait index={follow.character}/><span><small>Following</small><b>{follow.name}</b></span>
      <b className={`kp-numeral kp2-rank-${rankTone(follow.rank)}`}>{follow.rank}<sup>{ordinalSuffix(follow.rank)}</sup></b>
    </div>}
  </div>;
}
