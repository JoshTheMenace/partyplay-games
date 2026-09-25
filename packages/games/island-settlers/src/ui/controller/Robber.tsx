/**
 * Robber or pirate (EXPERIENCE §4.2): pick a hex on the map (sun rims, victim emblems with card counts),
 * then a victim in a sheet. Leading fields (robber vs pirate) render as choices first.
 */
import { useState } from 'react';
import { ArcadeButton } from '../../../../../party-ui/src/index';
import type { PickField, Picks, Prompt, SeatId } from '../../model';
import { tileDetail } from '../shared/board';
import { plural } from '../shared/format';
import { nameOf, seatOf } from '../shared/seats';
import { EmblemChip } from '../shared/SeatChip';
import { ChoiceGrid } from './Command';
import { useCtl, useDraft } from './context';
import { robberFields } from './logic';
import { MapView } from './MapView';
import { Sheet } from './Sheet';

/** Face-down fan: up to 5 card backs and the count. */
const Fan = ({ n }: { n: number }) => <span className="island-settlers-fan" aria-label={plural(n, 'card')}>
  {Array.from({ length: Math.min(n, 5) }, (_, i) => <i key={i}/>)}<b className="kp-numeral">{n}</b></span>;

function VictimSheet({ tile, victims, onRob, onClose }: {
  tile: string; victims: SeatId[]; onRob(victim: SeatId | null): void; onClose(): void;
}) {
  const { pub, busy } = useCtl();
  const [pick, setPick] = useState<SeatId | null>(victims.length === 1 ? victims[0] : null);
  const safe = pub.ext['friendly-robber'];
  return <Sheet title={tileDetail(pub, tile)} onClose={onClose}>
    {safe && <p className="island-settlers-note">Friendly robber: players with 2 VP or less are safe.</p>}
    {victims.length ? <div className="island-settlers-victims" role="radiogroup" aria-label="Steal from">
      {victims.map(id => {
        const seat = seatOf(pub, id);
        return <button key={id} type="button" role="radio" aria-checked={pick === id} onClick={() => setPick(id)}>
          <EmblemChip index={seat?.seat ?? 0} size="32px"/><b>{nameOf(pub, id)}</b>
          <Fan n={seat?.cards ?? 0}/><span>{seat?.vp ?? 0} VP</span>
        </button>;
      })}
    </div> : <p className="island-settlers-note">Nobody to rob here.</p>}
    <div className="island-settlers-sheet-actions">
      <ArcadeButton tone="coral" size="lg" disabled={busy || (victims.length > 0 && !pick)}
        onClick={() => onRob(pick)}>{pick ? `Rob ${nameOf(pub, pick)}` : 'Move robber here'}</ArcadeButton>
      <ArcadeButton tone="ghost" onClick={onClose}>Back</ArcadeButton>
    </div>
  </Sheet>;
}

export function Robber({ prompt }: { prompt: Prompt }) {
  const { pub, me, act } = useCtl();
  const [picks, setPicks] = useDraft<Picks>(`robber:${prompt.id}`, {});
  const { lead, hexes } = robberFields(prompt.command.fields, picks);
  const leadDone = lead.every(f => f.optional || picks[f.key] !== undefined);
  const option = (id: string) => hexes?.options.find(o => o.value === id);
  const piece = picks[lead[0]?.key] === 'pirate' ? 'pirate' : 'robber';
  const tile = hexes && option(picks[hexes.key]) ? picks[hexes.key] : null;
  const setTile = (id: string | null) => {
    const { [hexes!.key]: _, ...rest } = picks;
    setPicks(id ? { ...rest, [hexes!.key]: id } : rest);
  };
  const victimField = (id: string) =>
    option(id)?.then?.find(f => f.kind === 'pick' && f.target === 'seat') as PickField | undefined;
  const victims = (id: string) => pub.robberChoices.find(c => c.seat === me.seat && c.piece === piece)
    ?.tiles.find(t => t.tile === id)?.victims ?? victimField(id)?.options.map(o => o.value) ?? [];
  const rob = async (victim: SeatId | null) => {
    const field = tile && victimField(tile), all = { ...picks };
    if (field && victim) all[field.key] = victim;
    if (await act({ type: 'answer', prompt: prompt.id, picks: all, cards: {} })) setPicks({});
  };
  return <div className="island-settlers-screen">
    {lead.map(f => <ChoiceGrid key={f.key} field={f} value={picks[f.key]}
      onChange={v => setPicks({ ...picks, [f.key]: v! })}/>)}
    {leadDone && hexes && <>
      {prompt.command.detail !== me.task.text && <p className="island-settlers-note">{prompt.command.detail}</p>}
      <MapView spots={hexes.options.map(o => o.value)} selected={tile} ghost={piece}
        onSelect={setTile}/>
    </>}
    {tile && <VictimSheet tile={tile} victims={victims(tile)} onRob={rob} onClose={() => setTile(null)}/>}
  </div>;
}
