/** Sticky action bar (EXPERIENCE §4.1 row 5): [Build] [Trade] [Cards], a gap, then End (no confirm). */
import { ArcadeButton } from '../../../../../party-ui/src/index';
import { waitingOnMe } from '../trade/logic';
import { useCtl, type Tab } from './context';
import { ACTING, FOCUSED, route, usable } from './logic';

function TabButton({ tab, label, badge }: { tab: Tab; label: string; badge?: string | number }) {
  const { screen, go } = useCtl(), on = screen.tab === tab;
  return <ArcadeButton tone={on ? 'sky' : 'ghost'} aria-pressed={on} className="island-settlers-tab"
    onClick={() => go({ tab: on ? 'now' : tab, place: null, command: null, card: null })}>
    {label}{badge !== undefined && <i className="island-settlers-badge" data-dot={badge === '' || undefined}
      aria-label={badge === '' ? ', something to build' : `, ${badge} waiting`}>{badge}</i>}
  </ArcadeButton>;
}

export function ActionBar() {
  const { pub, me, busy, screen, act, go } = useCtl();
  const kind = me.task.kind, acting = ACTING.includes(kind);
  if ((!acting && kind !== 'roll') || FOCUSED.has(route(me, screen).view)) return null;
  const waiting = waitingOnMe(pub, me.seat).length;
  const buildable = me.build.some(usable);
  return <nav className="island-settlers-bar" aria-label="Turn actions">
    {acting && <TabButton tab="build" label="Build" badge={buildable ? '' : undefined}/>}
    {acting && <TabButton tab="trade" label="Trade" badge={waiting || undefined}/>}
    <TabButton tab="cards" label="Cards"/>
    {acting && <ArcadeButton tone="ghost" className="island-settlers-end" disabled={busy || !me.can.end}
      onClick={async () => { if (await act({ type: 'end' })) go({ tab: 'now', place: null, command: null, card: null }); }}>
      {kind === 'round' ? 'Done' : 'End turn'}</ArcadeButton>}
  </nav>;
}
