/* Menu phase: the TV game wall and the phone ballot. */
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArcadeButton, StatusNotice } from '../../../../../party-ui/src/index';
import type { MiniInfo } from '../contract';
import { MINIS } from '../../minis/catalog';
import { AvatarStack, BigTitle, PhoneChoices, PhoneShell, PlayerStrip, Trophy, useNow, useSend, type PhoneChoice } from '../ui';
import { Logo, TileArt } from './brand';
import { blocked, playersLabel, type PhoneProps, type ScreenProps } from './shared';

function useMenu({ view, now }: ScreenProps) {
  const menu = view.menu ?? { votes: {}, lockAt: null }, t = useNow(now, 200), count = view.players.length;
  // Playable games first (stable catalog order inside each group), so big catalogs lead with what this room can start.
  const games = useMemo(() => [...MINIS].sort((a, b) => +!!blocked(a, count) - +!!blocked(b, count)), [count]);
  const voters = (id: string) => view.players.filter(p => menu.votes[p.id] === id);
  const top = Math.max(0, ...games.map(m => voters(m.id).length));
  return { games, menu, voters, top, lockIn: menu.lockAt === null ? null : Math.max(0, Math.ceil((menu.lockAt - t) / 1000)), voted: view.players.filter(p => menu.votes[p.id]).map(p => p.id) };
}

export type WallDensity = 'roomy' | 'medium' | 'dense' | 'micro';
/** Largest tile that fits `n` tiles in a w×h wall (stage px): tries every column count; tiles stay between 4:5 and 8:5. */
export function wallFit(n: number, w: number, h: number) {
  const gap = n <= 8 ? 28 : n <= 24 ? 18 : 14;
  let best = { cols: 1, tw: 0, th: 0 };
  for (let cols = 1; cols <= Math.min(n, 12); cols++) {
    const rows = Math.ceil(n / cols), ch = (h - (rows - 1) * gap) / rows, tw = Math.floor(Math.min(560, (w - (cols - 1) * gap) / cols, ch * 1.6)), th = Math.floor(Math.min(ch, tw * 1.25));
    if (tw * th > best.tw * best.th) best = { cols, tw, th };
  }
  const density: WallDensity = best.th >= 380 ? 'roomy' : best.th >= 230 ? 'medium' : best.th >= 135 ? 'dense' : 'micro';
  return { ...best, gap, density, width: best.cols * best.tw + (best.cols - 1) * gap + 1 };
}
const STACKS: Record<WallDensity, [number, number]> = { roomy: [64, 6], medium: [52, 4], dense: [40, 3], micro: [30, 2] };

/** Untransformed size of an element (the stage scale does not affect layout px). */
function useBox() {
  const ref = useRef<HTMLDivElement>(null), [box, setBox] = useState({ w: 1792, h: 560 });
  useLayoutEffect(() => {
    const el = ref.current!, measure = () => setBox(b => b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, box] as const;
}

export function MenuDisplay(props: ScreenProps) {
  const { view } = props, { games, voters, top, lockIn, voted } = useMenu(props), vip = view.players.find(p => p.id === view.vip);
  const many = games.length > 8, [box, size] = useBox(), fit = wallFit(games.length, size.w, size.h - 20), [stack, stackMax] = STACKS[fit.density];
  return <div className="hj-menu" data-many={many || undefined} data-locking={lockIn !== null || undefined}>
    <header className="hj-menu-head">
      <Logo size={many ? .68 : .85} />
      <BigTitle kicker={view.played.length ? `Game ${view.played.length + 1} of the night` : 'Welcome to the show!'} size={many ? 76 : 92}>Pick the next game!</BigTitle>
      {lockIn !== null
        ? <div className="hj-lock" role="status"><span>Locking in</span><b className="kp-title" key={lockIn}>{lockIn}</b></div>
        : <div className="hj-menu-count"><b className="kp-numeral">{voted.length}<small>/{view.players.length}</small></b><span>voted</span></div>}
    </header>
    <div className="hj-wall-box" ref={box}>
      <ul className="hj-wall" data-density={fit.density} style={{ '--gap': `${fit.gap}px`, '--tw': `${fit.tw}px`, '--th': `${fit.th}px`, width: fit.width } as CSSProperties}>
        {games.map((info, i) => { const reason = blocked(info, view.players.length), votes = voters(info.id), plays = view.played.filter(id => id === info.id).length;
          return <li key={info.id} className="hj-tile" data-off={!!reason || undefined} data-lead={(top > 0 && votes.length === top) || undefined} style={{ '--accent': info.accent, '--word': Math.max(...info.title.split(/\s+/).map(word => word.length)), animationDelay: `${Math.min(i, 24) * 40}ms` } as CSSProperties}>
            <TileArt info={info}>{reason && <span className="hj-tile-reason">{reason}</span>}</TileArt>
            <div className="hj-tile-text"><h2>{info.title}</h2><p>{info.tagline}</p>
              <span className="hj-chips"><span>{playersLabel(info)}</span><span>{info.minutes} min</span></span></div>
            {plays > 0 && <span className="hj-tile-played">Played{plays > 1 ? ` ×${plays}` : ''}</span>}
            {votes.length > 0 && <span className="hj-tile-votes"><AvatarStack players={votes} size={stack} max={stackMax} /><b className="kp-numeral">{votes.length}</b></span>}
          </li>; })}
      </ul>
    </div>
    <footer className="hj-menu-foot">
      <PlayerStrip players={view.players} done={voted} vip={view.vip} size={many ? 60 : view.players.length > 8 ? 72 : 84}
        badges={Object.fromEntries(view.players.filter(p => (view.trophies[p.id] ?? 0) > 0).map(p => [p.id, <><Trophy />{view.trophies[p.id]}</>]))} />
      <p className="hj-menu-hints">
        {vip ? <span><b>{vip.name}</b> is the VIP: lock in the pick or end the night from your phone.</span> : <span>Vote on your phone!</span>}
        <span>New friends join after <b>End the night</b> → <b>Play again</b>.</span>
      </p>
    </footer>
  </div>;
}

/** Phone sections for big catalogs: games grouped by their first tag; one-off tags share a "More games" group. */
function byTag(list: readonly MiniInfo[]): [string, MiniInfo[]][] {
  const groups = new Map<string, MiniInfo[]>();
  for (const info of list) { const tag = info.tags[0] ?? ''; groups.set(tag, [...groups.get(tag) ?? [], info]); }
  const big = [...groups].filter(([tag, g]) => tag && g.length > 1), rest = list.filter(info => !big.some(([, g]) => g.includes(info)));
  return [...big.map(([tag, g]): [string, MiniInfo[]] => [tag[0]!.toUpperCase() + tag.slice(1), g]), ...rest.length ? [[big.length ? 'More games' : 'All games', rest] as [string, MiniInfo[]]] : []];
}

export function MenuController(props: PhoneProps & { vote: string | null }) {
  const { view, me, send, vote } = props, { games, voters, lockIn, voted } = useMenu(props), isVip = view.vip === me.id, count = view.players.length;
  const vip = view.players.find(p => p.id === view.vip), [state, run] = useSend(), [confirmEnd, setConfirmEnd] = useState(false);
  const action = isVip && <div className="hj-vip-actions">
    <ArcadeButton tone="sun" size="lg" disabled={!voted.length || state.status === 'pending'} onClick={() => void run(() => send({ k: 'lock' }))}>{voted.length ? 'Lock it in' : 'Vote first, then lock it in'}</ArcadeButton>
    <ArcadeButton tone={confirmEnd ? 'coral' : 'ghost'} size="sm" disabled={state.status === 'pending'} onClick={() => { if (!confirmEnd) setConfirmEnd(true); else void run(() => send({ k: 'end' })); }} onBlur={() => setConfirmEnd(false)}>{confirmEnd ? 'Tap again to end the night' : 'End the night'}</ArcadeButton>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
  </div>;
  // Up to six games: rich one-column cards. More: a two-column compact grid in sections (room favourites, then by tag);
  // games this room cannot start fold into a closed section at the end.
  const compact = games.length > 6;
  const option = (info: MiniInfo): PhoneChoice => { const reason = blocked(info, count), votes = voters(info.id), meta = `${playersLabel(info)} · ${info.minutes} min`; return {
    id: info.id, color: info.accent, disabled: !!reason, reason: reason ?? undefined, ariaLabel: `${info.title}. ${info.tagline} ${meta}. ${votes.length} votes.${reason ? ` ${reason}.` : ''}`,
    label: <><b className="hj-choice-title">{info.title}</b>{votes.length > 0 && (compact ? <span className="hj-choice-votes kp-numeral">{votes.length}</span> : <AvatarStack players={votes} size={28} max={5} />)}</>,
    detail: compact ? <span className="hj-choice-meta"><span>{playersLabel(info)}</span> · <span>{info.minutes} min</span></span> : <>{info.tagline}<span className="hj-choice-meta">{meta}{vote === info.id ? ' · Your vote ✓' : ''}</span></>,
  }; };
  const choices = (list: readonly MiniInfo[], label: string) => <PhoneChoices label={label} columns={compact ? 2 : 1} className={compact ? 'hj-ballot-grid' : ''} picked={vote ? [vote] : null}
    onSubmit={([game]) => send({ k: 'vote', game: game! })} options={list.map(option)} />;
  const open = games.filter(info => !blocked(info, count)), off = games.filter(info => blocked(info, count));
  const hot = open.filter(info => voters(info.id).length).sort((a, b) => voters(b.id).length - voters(a.id).length);
  return <PhoneShell player={me} vip={isVip} eyebrow={lockIn !== null ? `Locking in ${lockIn}…` : `${voted.length}/${view.players.length} voted`} title={vote ? 'Vote locked. Change it?' : 'Vote for the next game'} action={action || undefined}>
    {!compact ? choices(games, 'Games') : <div className="hj-ballot">
      {hot.length > 0 && <section><h3 className="hj-ballot-head">Room favourites</h3>{choices(hot, 'Room favourites')}</section>}
      {byTag(open).map(([tag, list]) => <section key={tag}><h3 className="hj-ballot-head">{tag}<small>{list.length}</small></h3>{choices(list, tag)}</section>)}
      {off.length > 0 && <details className="hj-ballot-off"><summary>{off.length} more {off.length === 1 ? 'game isn’t' : 'games aren’t'} playable right now</summary>{choices(off, 'Not available now')}</details>}
    </div>}
    {!isVip && vip && <p className="hj-note">When everyone has voted the pick locks in by itself. <b>{vip.name}</b> (VIP) can lock it in early.</p>}
  </PhoneShell>;
}
