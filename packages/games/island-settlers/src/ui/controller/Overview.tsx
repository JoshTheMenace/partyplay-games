/** Glanceable screens (EXPERIENCE §4.2): waiting, the roll, and the main-turn "Now" panel. */
import { useState } from 'react';
import { ArcadeButton, Modal } from '../../../../../party-ui/src/index';
import { EMOTES, type Emote } from '../../model';
import { CardChips, Die, Icon } from '../shared/icons';
import { EMOTE_LABEL } from '../shared/labels';
import { useCtl } from './context';
import { hintChips, payout, PURCHASE_LABEL, usable } from './logic';
import { MapView } from './MapView';
import { BuyDevSheet } from './Build';

export function PayoutCard() {
  const { pub, me } = useCtl();
  const line = payout(pub, me.seat), roll = pub.lastRoll;
  if (!line || !roll) return null;
  return <section className="island-settlers-payout" data-tone={line.tone} aria-label="Last roll">
    <span className="island-settlers-dice">{roll.dice.map((d, i) => <Die key={i} value={d} size={34}/>)}</span>
    <p>{line.text}</p>
    {line.tone === 'gain' && <CardChips cards={line.cards}/>}
  </section>;
}

function Log() {
  const { pub } = useCtl();
  const [open, setOpen] = useState(false);
  const lines = [...pub.events].reverse();
  if (!lines.length) return null;
  return <section className="island-settlers-log" aria-label="Recent moves">
    <ol>{lines.slice(0, 5).map(e => <li key={e.id}>{e.text}</li>)}</ol>
    <button type="button" className="island-settlers-link" onClick={() => setOpen(true)}>Full log</button>
    {open && <Modal title="Game log" onClose={() => setOpen(false)}>
      <ol className="island-settlers-log-full">{lines.map(e => <li key={e.id}>{e.text}</li>)}</ol>
    </Modal>}
  </section>;
}

function Emotes() {
  const { act } = useCtl();
  const [sent, setSent] = useState<Emote | null>(null);
  const send = (emote: Emote) => {
    setSent(emote);
    void act({ type: 'emote', emote }, true);
    setTimeout(() => setSent(null), 2000);
  };
  return <div className="island-settlers-emotes" role="group" aria-label="Emotes">
    {EMOTES.map(e => <button key={e} type="button" disabled={sent !== null} aria-pressed={sent === e}
      onClick={() => send(e)}>{EMOTE_LABEL[e]}</button>)}
  </div>;
}

function SkipPaired() {
  const { pub, me, act, busy } = useCtl();
  if (!me.can.skipPaired) return null;
  const skip = pub.seats.find(s => s.id === me.seat)?.ready ?? false;
  return <label className="island-settlers-skip">
    <input type="checkbox" checked={skip} disabled={busy}
      onChange={e => void act({ type: 'skip-paired', skip: e.target.checked })}/>
    Skip my next build turn
  </label>;
}

/** "City ready", "Settlement: need 1 wool": what is close, without being buttons. */
function Hints() {
  const chips = hintChips(useCtl().me);
  return chips.length > 0 && <ul className="island-settlers-hints" aria-label="What you can build">
    {chips.map(c => <li key={c} data-ready={c.endsWith('ready') || undefined}>{c}</li>)}</ul>;
}

export function Waiting() {
  return <div className="island-settlers-screen">
    <PayoutCard/>
    <MapView mini/>
    <Hints/>
    <SkipPaired/>
    <Log/>
    <Emotes/>
  </div>;
}

export function Roll() {
  const { me, act, busy, go } = useCtl();
  return <div className="island-settlers-screen">
    <ArcadeButton tone="sun" size="xl" className="island-settlers-roll" disabled={busy || !me.can.roll}
      onClick={() => void act({ type: 'roll' })}><Icon name="dice" size={40}/> Roll</ArcadeButton>
    {me.dev.some(d => d.playable) && <ArcadeButton tone="grape" onClick={() => go({ tab: 'cards' })}>
      Play a card first</ArcadeButton>}
    <PayoutCard/>
    <MapView mini/>
  </div>;
}

/** Main turn: what you can build right now as buttons that jump straight into placement. */
export function NowPanel() {
  const { me, go } = useCtl();
  const [buying, setBuying] = useState(false);
  const ready = me.build.filter(usable);
  return <div className="island-settlers-screen">
    {ready.length ? <div className="island-settlers-now" role="group" aria-label="Build now">
      {ready.map(o => <ArcadeButton key={o.piece} tone="lime" size="sm"
        onClick={() => o.piece === 'development' ? setBuying(true) : go({ place: o.piece })}>
        <Icon name={o.piece} size={22}/> {PURCHASE_LABEL[o.piece]}</ArcadeButton>)}
    </div> : <><p className="island-settlers-note">Nothing to build yet. Trade, or {me.task.kind === 'round'
      ? 'tap Done' : 'end your turn'}.</p><Hints/></>}
    <MapView mini/>
    <PayoutCard/>
    {buying && <BuyDevSheet onClose={() => setBuying(false)}/>}
  </div>;
}
