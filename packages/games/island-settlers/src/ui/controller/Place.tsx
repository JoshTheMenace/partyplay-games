/**
 * Placement (EXPERIENCE §4.2): the map fills the task area with legal spots for one piece; a tap shows a ghost
 * and the confirm bar, whose detail sits above its buttons so it never covers what it describes.
 */
import { useEffect, type ReactNode } from 'react';
import { ArcadeButton } from '../../../../../party-ui/src/index';
import type { BuildOption, BuildPiece, IntentPiece } from '../../model';
import { spotDetail } from '../map/index';
import { useCtl, useDraft } from './context';
import { owed, PURCHASE_LABEL } from './logic';
import { MapView } from './MapView';

/** Tells the TV which placement this phone is choosing, once on entry and once on leaving. */
function useIntent(piece: IntentPiece) {
  const { act } = useCtl();
  useEffect(() => {
    void act({ type: 'intent', piece }, true);
    return () => void act({ type: 'intent', piece: null }, true);
  }, [piece]); // eslint-disable-line react-hooks/exhaustive-deps -- once per piece, not per snapshot
}

function ConfirmBar({ detail, label, spot, onConfirm, onBack, extra }: {
  detail: string; label: string; spot: string | null; onConfirm(): void; onBack?(): void; extra?: ReactNode;
}) {
  const { busy, docked } = useCtl();
  // The host's status line already says how to pick on the board.
  const hint = docked ? '' : 'Tap a glowing spot on the map.';
  return <div className="island-settlers-confirm" role="region" aria-label="Confirm placement">
    <p className="island-settlers-detail" aria-live="polite">{spot ? detail : hint}</p>
    <div className="island-settlers-sheet-actions">
      <ArcadeButton tone="lime" size="lg" disabled={busy || !spot} onClick={onConfirm}>{label}</ArcadeButton>
      {onBack && <ArcadeButton tone="ghost" onClick={onBack}>Back</ArcadeButton>}
      {extra}
    </div>
  </div>;
}

/** Road Building owes 2: "Road 1 of 2", then "Road 2 of 2". */
const stepText = (o: BuildOption) => (o.free > 0 && o.free <= 2 && o.piece !== 'settlement'
  && o.piece !== 'city' ? `${PURCHASE_LABEL[o.piece]} ${3 - o.free} of 2` : null);

export function Place({ piece, setup, onDone }: { piece: BuildPiece; setup?: boolean; onDone?(): void }) {
  const { pub, me, act, go } = useCtl();
  const [spot, setSpot] = useDraft<string | null>(`spot:${piece}`, null);
  const option = me.build.find(o => o.piece === piece);
  useIntent(piece);
  const routes = owed(me).filter(o => o.piece === 'road' || o.piece === 'ship');
  if (!option) return null;
  const label = PURCHASE_LABEL[piece].toLowerCase(), step = setup ? null : stepText(option);
  const valid = spot && option.targets.includes(spot) ? spot : null;
  const confirm = async () => {
    if (valid && await act({ type: 'build', piece, at: valid })) {
      setSpot(null);
      onDone?.();
    }
  };
  const back = setup ? (valid ? () => setSpot(null) : undefined) : () => { setSpot(null); onDone?.(); };
  return <div className="island-settlers-screen island-settlers-place">
    {step && <p className="island-settlers-step kp-numeral">{step}</p>}
    {routes.length > 1 && <div className="island-settlers-segment" role="group" aria-label="Route type">
      {routes.map(o => <button key={o.piece} type="button" aria-pressed={o.piece === piece}
        onClick={() => go({ place: o.piece })}>{PURCHASE_LABEL[o.piece]}</button>)}
    </div>}
    <MapView spots={option.targets} selected={valid} ghost={valid ? piece : null} onSelect={setSpot}/>
    <ConfirmBar detail={valid ? spotDetail(pub, valid, me.seat) : ''} label={`Confirm ${label}`} spot={valid}
      onConfirm={confirm} onBack={back}
      extra={step && !setup && me.task.kind !== 'roll' && <ArcadeButton tone="ghost"
        onClick={() => go({ skipFree: true, place: null })}>Skip the rest</ArcadeButton>}/>
  </div>;
}

/** Seafarers ship move: pick a ship (sun ring), then a destination, then confirm. */
export function MoveShip({ onDone }: { onDone(): void }) {
  const { pub, me, act } = useCtl();
  type Pick = { from: string | null; to: string | null };
  const [pick, setPick] = useDraft<Pick>('ship-move', { from: null, to: null });
  useIntent('move');
  const move = me.shipMoves.find(m => m.from === pick.from);
  const confirm = async () => {
    if (move && pick.to && await act({ type: 'move-ship', from: move.from, to: pick.to })) {
      setPick({ from: null, to: null });
      onDone();
    }
  };
  return <div className="island-settlers-screen island-settlers-place">
    <p className="island-settlers-step">{move ? 'Pick where it sails' : 'Pick a ship to move'}</p>
    <MapView spots={move ? move.to : me.shipMoves.map(m => m.from)} selected={move ? pick.to : null}
      ghost={pick.to ? 'ship' : null}
      onSelect={id => setPick(move ? { ...pick, to: id } : { from: id, to: null })}/>
    <ConfirmBar detail={pick.to ? spotDetail(pub, pick.to, me.seat) : ''} label="Confirm move"
      spot={move ? pick.to : null} onConfirm={confirm}
      onBack={() => (move ? setPick({ from: null, to: null }) : onDone())}/>
  </div>;
}
