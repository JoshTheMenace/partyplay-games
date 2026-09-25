import { useEffect, useRef, useState } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { ClientProps } from '../contracts';
import { Display } from '../display';
import { CombatScene, pauser } from '../display/combat';
import { useActions } from './common';
import { Banner, CrewRoster, FireButton, StatusStrip, TargetList, Tools, useCombat, WeaponRack } from './combat';
import { MenuController } from './menus';
import { useSize } from './stage';

function PersonalCombat(props: ClientProps) {
  const actions = useActions(props), c = useCombat(props, actions), { mode, candidates, crewShip, selected, ship } = c, latest = useRef(c), [root, size] = useSize<HTMLDivElement>(); latest.current = c;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { const c = latest.current, k = e.key.toLowerCase();
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      const w = /^[1-9]$/.test(k) ? c.ship?.weapons[Number(k) - 1] : undefined;
      const run = w ? () => c.pickWeapon(w.uid) : ({ ' ': c.pause, f: c.fire, s: c.stations, t: c.teleport, c: c.cloak, escape: () => c.openShip(null) } as Record<string, () => unknown>)[k];
      if (run && !e.repeat) { e.preventDefault(); run(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const highlight = mode.kind !== 'crew' ? candidates.map(s => ({ shipId: s.id, roomIds: s.rooms.map(r => r.id) })) : selected.length && crewShip ? [{ shipId: crewShip.id, roomIds: crewShip.rooms.map(r => r.id) }] : [];
  const paused = c.combat?.paused && !c.combat.outcome, by = pauser(c.view);
  const caption = paused ? `${by ? `Paused by ${by}` : 'Paused'} · orders still work · Space resumes` : mode.kind === 'weapon' ? 'Click a highlighted room to aim · Esc cancels' : mode.kind === 'teleport' ? `Click a room on any ship to beam ${selected.length} across · Esc cancels`
    : selected.length ? `${selected.length} crew selected · click a room on ${crewShip?.name} to send them` : 'Click a room with your crew to select them · 1–4 weapons · Space pause · F fire · S stations';
  // The deck is laid out in phone px; on a TV-sized screen it zooms up with the height so it reads from the couch.
  return <div ref={root} className="ss-personal ss-personal-combat" data-mode={mode.kind} style={{ '--deck': Math.min(1.5, Math.max(1, size.h / 800)) } as React.CSSProperties}>
    <div className="sp-scene"><CombatScene view={props.publicView} serverNowMs={props.serverNowMs} onRoomClick={c.room} highlight={highlight} selectedCrew={selected}/><Banner c={c}/>
      <p className="sp-caption" aria-live="polite" data-paused={paused || undefined}>{caption}</p>{(props.connected === false || actions.error) && <p className="sp-toast" role="alert">{props.connected === false ? 'Reconnecting… orders resume when the link returns.' : actions.error}</p>}</div>
    {c.me && ship ? <div className="sp-deck">
      <div className="sp-deck-top"><StatusStrip c={c}/><Tools c={c}/></div>
      <div className="sp-deck-side">{mode.kind === 'crew' ? <CrewRoster c={c}/> : <TargetList c={c} pick={false}/>}</div>
      <WeaponRack c={c} keys/><FireButton c={c}/>
    </div> : <p className="sp-deck sp-watch">Watching the battle.</p>}
  </div>;
}
/** Host playing on the shared screen: the TV scene with a docked control deck in combat, or the TV plus a console drawer. */
export function Personal(props: ClientProps) {
  const [open, setOpen] = useState(true);
  if (props.publicView.phase === 'combat' && props.publicView.combat) return <PersonalCombat {...props}/>;
  return <div className="ss-personal" data-open={open || undefined}>
    <div className="ss-personal-display"><Display {...props}/></div>
    <aside className="sp-drawer" aria-label="Captain's console">
      <button type="button" className="sp-drawer-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <PanelRightClose size={18} aria-hidden="true"/> : <PanelRightOpen size={18} aria-hidden="true"/>}<span>{open ? 'Hide console' : 'Console'}</span></button>
      {open && <MenuDrawer {...props}/>}
    </aside>
  </div>;
}
function MenuDrawer(props: ClientProps) { return <MenuController {...props} actions={useActions(props)}/>; }
