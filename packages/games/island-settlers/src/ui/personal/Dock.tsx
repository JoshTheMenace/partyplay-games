/**
 * The seated host's controller dock (EXPERIENCE §4.9): one collapsed row (status line, hand, actions,
 * timer) in the fixed dock region, a sheet that rises over the lower board for menus and prompts, and
 * placement on the 3D board. The board window never moves: the dock only ever overlays it.
 */
import { useEffect, useRef, useState } from 'react';
import { ArcadeButton } from '../../../../../party-ui/src/index';
import {
  ActionBar, BuildMenu, CardsTab, CommandSheet, CtlContext, Duty, HandStrip, MoveShip, Place, Robber,
  useController,
} from '../controller/index';
import { HOME, type Props } from '../controller/context';
import { Finale } from '../controller/Finale';
import { AutoLine } from '../controller/Header';
import { route, type View } from '../controller/logic';
import { MapHost } from '../controller/MapView';
import { PayoutCard } from '../controller/Overview';
import { TimerRing } from '../controller/Timer';
import { useSize } from '../display/hooks';
import { tapText } from '../shared/format';
import { regions, STAGE_U, unit } from '../shared/layout';
import { Icon } from '../shared/icons';
import { seatLabel, seatOf } from '../shared/seats';
import { EmblemChip } from '../shared/SeatChip';
import { TradePanel, waitingOnMe } from '../trade/index';
import { layerOf, sheetTitle } from './logic';
import { useBoardPick } from './pick';

type Seated = Props & { privateView: NonNullable<Props['privateView']> };
type Ctl = ReturnType<typeof useController>;

const HIDE_KEY = 'island-settlers:hide-hand';
/** Hide hand survives reloads, so a mirrored laptop never flashes the cards. */
function useHideHand(): [boolean, () => void] {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
  });
  const toggle = () => setHidden(h => {
    try { localStorage.setItem(HIDE_KEY, h ? '0' : '1'); } catch { /* private mode */ }
    return !h;
  });
  return [hidden, toggle];
}

/** The controller's task screens, host edition: menus and prompts in the sheet, placement in the dock. */
function Task({ v, ctl }: { v: View; ctl: Ctl }) {
  const home = () => ctl.go(HOME), back = () => ctl.go({ command: null });
  switch (v.view) {
    case 'robber': return <Robber key={v.prompt.id} prompt={v.prompt}/>;
    case 'prompt': return <CommandSheet key={v.prompt.id} command={v.prompt.command} prompt={v.prompt}/>;
    case 'setup': return <Place piece={v.piece} setup/>;
    case 'command': return <CommandSheet key={v.command.id} command={v.command} onBack={back}/>;
    case 'move': return <MoveShip onDone={home}/>;
    case 'place': return <Place piece={v.piece} onDone={home}/>;
    case 'free': return <Place piece={v.piece}/>;
    case 'trade': return <TradePanel {...ctl.props} publicView={ctl.pub} privateView={ctl.me} variant="dock"/>;
    case 'cards': return <CardsTab/>;
    case 'build': return <BuildMenu/>;
    case 'finale': return <Finale/>;
    default: return null;
  }
}

/** Collapsed-dock buttons: [Roll] or the controller's action bar, else offers waiting or your last payout. */
function Actions({ ctl }: { ctl: Ctl }) {
  const { me, pub, act, busy, go } = ctl;
  const offers = waitingOnMe(pub, me.seat).length;
  return <>
    {me.task.kind === 'roll' && <ArcadeButton tone="sun" className="island-settlers-dock-roll"
      disabled={busy || !me.can.roll} onClick={() => void act({ type: 'roll' })}>
      <Icon name="dice" size="1.3em"/> Roll</ArcadeButton>}
    <ActionBar/>
    {me.task.kind === 'respond' && offers > 0 && <ArcadeButton tone="sky"
      onClick={() => go({ tab: 'trade' })}>Offers · {offers}</ArcadeButton>}
    {me.task.kind === 'wait' && <PayoutCard/>}
  </>;
}

export function Dock(props: Seated) {
  const ctl = useController(props, true), { me, pub, screen, go } = ctl;
  const [source, setSource] = useState<HTMLElement | null>(null), board = useBoardPick(source);
  const [hidden, toggleHidden] = useHideHand();
  const wrap = useRef<HTMLDivElement>(null), size = useSize(wrap);
  const v = route(me, screen), layer = layerOf(v), title = sheetTitle(v, me.task.title);
  const closable = v.view === 'trade' || v.view === 'cards' || v.view === 'build';
  useEffect(() => {
    if (!closable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof Element && e.target.closest('dialog'))) go(HOME);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closable, go]);

  const rect = size && size.height > 0 ? regions(size, true).dock : null;
  const u = size ? unit(size) : 1, open = layer === 'sheet';
  // The sheet: 420u, at least 380px so 720p menus (a 10-seat Trade sheet) fit; never above the banner.
  const height = rect ? (open ? Math.min(Math.max(420, 380 / u), STAGE_U - 136) : rect.height) : 0;
  const style = rect && {
    left: `calc(${rect.left} * var(--u))`, width: `calc(${rect.width} * var(--u))`,
    bottom: `calc(${STAGE_U - rect.top - rect.height} * var(--u))`, height: `calc(${height} * var(--u))`,
  };
  const status = tapText(layer === 'pick' && board.count ? board.hint : me.task.text || pub.now.detail, true);
  const eye = hidden ? 'Show hand' : 'Hide hand';
  return <div ref={wrap} className="island-settlers-personal">
    <CtlContext.Provider value={ctl}><MapHost.Provider value={source}>
      <div ref={setSource} className="island-settlers-pick-source" aria-hidden="true" inert/>
      {style && source && <section className="island-settlers-dock island-settlers-panel" style={style}
        data-layer={layer} data-task={me.task.kind} aria-label="Your controls">
        <div className="island-settlers-dock-duties"><Duty notices={ctl.notices} limit={1} offers={!open}/></div>
        {open && <div className="island-settlers-dock-sheet">
          {title && <header className="island-settlers-dock-sheet-head">
            <h3>{title}</h3><AutoLine/>
            {closable && <ArcadeButton tone="ghost" size="sm" onClick={() => go(HOME)}>Close</ArcadeButton>}
          </header>}
          <div className="island-settlers-dock-scroll"><Task v={v} ctl={ctl}/></div>
        </div>}
        <p className="island-settlers-dock-status" aria-live="polite">
          <EmblemChip index={seatOf(pub, me.seat)?.seat ?? 0} size="var(--is-chip)"
            label={seatLabel(pub, me.seat)}/>
          <b>{me.task.title}</b>{status && <span>{status}</span>}
          <button type="button" className="island-settlers-dock-eye" aria-pressed={hidden}
            onClick={toggleHidden} aria-label={eye} title={eye}><Icon name="eye" size="1.2em"/></button>
        </p>
        <div className="island-settlers-dock-row">
          <div className="island-settlers-dock-me" data-hidden={hidden || undefined}><HandStrip/></div>
          <div className="island-settlers-dock-actions">
            {layer === 'pick' || v.view === 'finale' ? <Task v={v} ctl={ctl}/> : <Actions ctl={ctl}/>}
          </div>
          {me.task.deadline ? <TimerRing deadline={me.task.deadline}/> : null}
        </div>
      </section>}
    </MapHost.Provider></CtlContext.Provider>
  </div>;
}
