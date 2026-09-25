/**
 * Phone controller (EXPERIENCE §4.1–4.6). The frame is header, duty cards, hand, task area and action bar;
 * the task area is picked by `me.task` (private duties first) and the tab the player pressed.
 * Panels are exported for WP-personal's host dock.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Action } from '../../model';
import { BoardMap } from '../map/index';
import { TradePanel } from '../trade/index';
import { useSfx } from '../sfx/index';
import { ActionBar } from './ActionBar';
import { BuildMenu } from './Build';
import { CardsTab } from './Cards';
import { CommandSheet } from './Command';
import { CtlContext, HOME, useCtl, useDraftIn, type Ctl, type Move, type Props, type Screen } from './context';
import { useCues } from './cues';
import { Duty, useNotices } from './Duty';
import { Finale } from './Finale';
import { HandStrip } from './Hand';
import { AutoLine, Header, Readiness, Reconnect } from './Header';
import { route } from './logic';
import { MapHost } from './MapView';
import { NowPanel, Roll, Waiting } from './Overview';
import { MoveShip, Place } from './Place';
import { Robber } from './Robber';
import './controller.css';
import './screens.css';

export { ActionBar } from './ActionBar';
export { BuildMenu, BuyDevSheet, CostRow } from './Build';
export { CardsTab } from './Cards';
export { CommandSheet } from './Command';
export { CtlContext, useCtl, type Ctl } from './context';
export { Duty } from './Duty';
export { GoodCard, HandStrip } from './Hand';
export { Header } from './Header';
export { MoveShip, Place } from './Place';
export { Robber } from './Robber';

type SeatedProps = Props & { privateView: NonNullable<Props['privateView']> };

/** Builds the shared controller state; the host dock calls it with `docked` and provides CtlContext itself. */
export function useController(props: SeatedProps, docked = false): Ctl & {
  notices: ReturnType<typeof useNotices>['live'];
} {
  const { publicView: pub, privateView: me, serverNowMs: now } = props;
  const scope = { roomId: props.roomId, roundId: props.roundId, playerId: me.seat, turnId: pub.turn.id };
  const [screen, setScreen] = useDraftIn<Screen>(scope, 'screen', HOME);
  const [busy, setBusy] = useState(false);
  const { live, notify, clearErrors } = useNotices(`${me.task.kind}:${me.task.prompt}:${pub.turn.id}`,
    pub.turn.id, now);
  const sfx = useSfx();
  useCues(pub, me, now, sfx, notify);
  const act = useCallback(async (move: Move, quiet = false) => {
    if (!quiet) { setBusy(true); clearErrors(); }
    try {
      const result = await props.sendAction({ ...move, turnId: pub.turn.id } as Action);
      if (!result.accepted && !quiet) notify('error', result.reason ?? 'That move was refused.');
      return result.accepted;
    } catch {
      if (!quiet) notify('error', 'Could not reach the room. Try again.');
      return false;
    } finally { if (!quiet) setBusy(false); }
  }, [props.sendAction, pub.turn.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    pub, me, props, now, act, busy, docked, screen, sfx, scope, notify, notices: live,
    go: next => setScreen({ ...screen, ...next }),
  };
}

/** The screen for the current task (EXPERIENCE §4.2), chosen by `route`. */
function Task() {
  const ctl = useCtl(), { me, pub, screen, go } = ctl, v = route(me, screen);
  const home = () => go(HOME);
  switch (v.view) {
    case 'finale': return <Finale/>;
    case 'robber': return <Robber key={v.prompt.id} prompt={v.prompt}/>;
    case 'prompt': return <CommandSheet key={v.prompt.id} command={v.prompt.command} prompt={v.prompt}/>;
    case 'setup': return <Place piece={v.piece} setup/>;
    case 'command':
      return <CommandSheet key={v.command.id} command={v.command} onBack={() => go({ command: null })}/>;
    case 'move': return <MoveShip onDone={home}/>;
    case 'place': return <Place piece={v.piece} onDone={home}/>;
    case 'free': return <Place piece={v.piece}/>;
    case 'trade': return <TradePanel {...ctl.props} publicView={pub} privateView={me}/>;
    case 'cards': return <CardsTab/>;
    case 'build': return <BuildMenu/>;
    case 'roll': return <Roll/>;
    case 'now': return <NowPanel/>;
    default: return <Waiting/>;
  }
}

const LANDSCAPE = '(orientation: landscape) and (max-height: 500px)';
const media = () => (typeof matchMedia === 'function' ? matchMedia(LANDSCAPE) : null);
/** Short landscape moves the map into a left column (EXPERIENCE §4.1 other sizes). */
function useLandscape() {
  return useSyncExternalStore(fn => {
    media()?.addEventListener('change', fn);
    return () => media()?.removeEventListener('change', fn);
  }, () => media()?.matches ?? false, () => false);
}

function Frame({ ctl }: { ctl: ReturnType<typeof useController> }) {
  const wide = useLandscape(), [slot, setSlot] = useState<HTMLElement | null>(null);
  const main = useRef<HTMLDivElement>(null), task = `${ctl.me.task.kind}:${ctl.me.task.prompt}`;
  // Short landscape: each new task starts with the column at the top, hand fully below the sticky header.
  useEffect(() => { if (wide) main.current?.scrollIntoView({ block: 'start' }); }, [wide, task]);
  return <CtlContext.Provider value={ctl}>
    <MapHost.Provider value={wide ? slot : null}>
      <div className="island-settlers-ctl" data-landscape={wide || undefined} data-task={ctl.me.task.kind}>
        {wide && <aside className="island-settlers-ctl-map" ref={setSlot}>
          <BoardMap pub={ctl.pub} seat={ctl.me.seat} serverNowMs={ctl.now} className="island-settlers-board"/>
        </aside>}
        <div className="island-settlers-ctl-main" ref={main}>
          <Header/>
          <Readiness/>
          <Reconnect/>
          <Duty notices={ctl.notices}/>
          <HandStrip/>
          <main className="island-settlers-task"><AutoLine/><Task/></main>
          <ActionBar/>
        </div>
      </div>
    </MapHost.Provider>
  </CtlContext.Provider>;
}

function Seated(props: SeatedProps) {
  return <Frame ctl={useController(props)}/>;
}

export function ControllerView(props: Props) {
  if (!props.privateView) {
    return <div className="island-settlers-ctl" data-spectator>
      <header className="island-settlers-head"><div className="island-settlers-head-text">
        <h2>{props.publicView.now.title}</h2><p>{props.publicView.now.detail || 'Watching this round'}</p>
      </div></header>
    </div>;
  }
  return <Seated {...props} privateView={props.privateView}/>;
}
