import type { ReactNode } from 'react';
import { ArcadeButton, Eyebrow } from '../../../party-ui/src/index';
import { emptyHand, type Hand, type PublicView } from './model';
import type { ExpansionCommand } from './expansion-model';
import { BoardMap, type Hotspot } from './map';
import { HandChips } from './icons';
import { ChoiceList, HandPicker } from './pickers';
import { useMemo } from 'react';
import { canAfford, edgeLabel, handTotal, indexBoard, playerOf, tileLabel, titleCase, vertexLabel, withinLimit } from './presentation';

/** Server labels for progress plays can arrive as raw identifiers; show them as titles without changing what is sent. */
export const prettyLabel = (command: ExpansionCommand) => /^[a-z0-9-]+$/.test(command.label) ? titleCase(command.label) : command.label;
export type CommandDraft = { choices: Record<string, string>; cards: Hand; skipped: string[] };
export const freshCommandDraft = (): CommandDraft => ({ choices: {}, cards: emptyHand(), skipped: [] });
type Send = (command: ExpansionCommand, choices: Record<string, string>, cards?: Hand) => void;

/** Rows for server-provided commands. The server owns legality; the phone only shows cost and affordability. */
export function CommandList({ commands, hand, busy, onOpen, title, empty }: { commands: ExpansionCommand[]; hand: Hand; busy: boolean; onOpen(command: ExpansionCommand): void; title?: string; empty?: string }) {
  if (!commands.length) return empty ? <p className="is-task-note">{empty}</p> : null;
  return <section className="is-task is-build is-commands">{title && <Eyebrow>{title}</Eyebrow>}{commands.map(command => { const affordable = !command.cost || canAfford(hand, command.cost); return <button key={command.id} type="button" className="is-build-option" disabled={busy} data-group={command.group} onClick={() => onOpen(command)}><span className="is-build-name"><strong>{prettyLabel(command)}</strong><small>{command.detail}{command.cost && !affordable ? ' · you may lack the cost' : ''}</small></span>{command.cost ? <span className="is-cost"><HandChips hand={command.cost}/></span> : <span className="is-cost is-cost-free">{command.fields.length ? 'choose' : 'go'}</span>}</button>; })}</section>;
}
/** One command at a time: map fields reuse BoardMap, other fields are radio lists, card specs reuse the goods picker. */
export function CommandRunner({ view, command, draft, update, busy, send, onBack, ghostColor }: { view: PublicView; command: ExpansionCommand; draft: CommandDraft; update(part: Partial<CommandDraft>): void; busy: boolean; send: Send; onBack: () => void; ghostColor: string }) {
  const choose = (key: string, value: string) => update({ choices: { ...draft.choices, [key]: value }, skipped: draft.skipped.filter(item => item !== key) });
  const skip = (key: string) => { const choices = { ...draft.choices }; delete choices[key]; update({ choices, skipped: [...draft.skipped.filter(item => item !== key), key] }); };
  // A saved choice that vanished from the server's current options is stale: show it as unresolved and block confirmation.
  const valid = (key: string) => { const value = draft.choices[key]; return value !== undefined && (command.fields.find(field => field.key === key)?.options.some(option => option.value === value) ?? false); };
  const stale = (key: string) => draft.choices[key] !== undefined && !valid(key);
  const resolved = (key: string) => valid(key) || draft.skipped.includes(key);
  const pendingMap = command.fields.find(field => field.map && !resolved(field.key));
  const cardTotal = handTotal(draft.cards), spec = command.cards;
  const cardsOk = !spec || (cardTotal >= spec.min && cardTotal <= spec.max && withinLimit(draft.cards, spec.available, spec.allowed));
  const complete = command.fields.every(field => field.optional || valid(field.key)) && cardsOk;
  const colorOf = (value: string) => playerOf(view, value)?.color, index = useMemo(() => indexBoard(view.board), [view.board]);
  // Raw board IDs from the server read as terrain and numbers; the submitted value stays the ID.
  const describe = (shape: 'vertex' | 'edge' | 'tile', option: { value: string; label: string }) => { if (option.label && option.label !== option.value) return option.label; if (shape === 'vertex') return `Corner by ${vertexLabel(index, option.value)}`; if (shape === 'edge') return edgeLabel(index, option.value); const tile = index.tiles.get(option.value); return tile ? tileLabel(tile) : option.value; };
  const fieldBlock = (key: string, label: string, body: ReactNode, optional?: boolean) => <div key={key} className="is-field"><div className="is-task-title"><Eyebrow>{label}</Eyebrow>{optional && !draft.skipped.includes(key) && <button type="button" className="is-back" onClick={() => skip(key)}>Skip</button>}</div>{body}</div>;
  return <section className="is-task is-command">
    <div className="is-task-head"><div className="is-task-title"><Eyebrow>{command.group} · {prettyLabel(command)}</Eyebrow><button type="button" className="is-back" onClick={onBack}>‹ Back</button></div><p>{command.detail}</p>{command.cost && <p className="is-task-note">Cost: <HandChips hand={command.cost}/></p>}</div>
    {command.fields.map(field => {
      if (field.map) {
        const chosen = valid(field.key) ? draft.choices[field.key] : null;
        const staleNote = stale(field.key) && <p className="is-task-note is-stale">That spot is no longer available. Choose again.</p>;
        if (pendingMap && pendingMap.key !== field.key) return fieldBlock(field.key, field.label, <p className="is-task-note">{chosen ? (() => { const option = field.options.find(item => item.value === chosen); return option ? describe(field.map!, option) : chosen; })() : 'Waiting for the previous choice.'}</p>, field.optional);
        if (!pendingMap && chosen) return fieldBlock(field.key, field.label, <p className="is-task-note is-chosen">{(() => { const option = field.options.find(item => item.value === chosen); return option ? describe(field.map!, option) : chosen; })()} <button type="button" className="is-back" onClick={() => { const choices = { ...draft.choices }; delete choices[field.key]; update({ choices }); }}>Change</button></p>, field.optional);
        if (draft.skipped.includes(field.key)) return fieldBlock(field.key, field.label, <p className="is-task-note">Skipped. <button type="button" className="is-back" onClick={() => update({ skipped: draft.skipped.filter(item => item !== field.key) })}>Choose instead</button></p>);
        const hotspots: Hotspot[] = field.options.map(option => ({ id: option.value, shape: field.map!, tone: 'target', label: describe(field.map!, option) }));
        return fieldBlock(field.key, field.label, <>{staleNote}<BoardMap view={view} hotspots={hotspots} selected={chosen} onSelect={spot => choose(field.key, spot.id)} ghostColor={ghostColor}/><p className="is-task-note">{hotspots.length ? `Tap a highlighted spot (${hotspots.length} available).` : 'No legal spot right now.'}</p></>, field.optional);
      }
      if (draft.skipped.includes(field.key)) return fieldBlock(field.key, field.label, <p className="is-task-note">Skipped. <button type="button" className="is-back" onClick={() => update({ skipped: draft.skipped.filter(item => item !== field.key) })}>Choose instead</button></p>);
      return fieldBlock(field.key, field.label, <>{stale(field.key) && <p className="is-task-note is-stale">That option is no longer available. Choose again.</p>}{field.options.length ? <ChoiceList label={field.label} options={field.options} value={valid(field.key) ? draft.choices[field.key] : null} onChange={value => choose(field.key, value)} colorOf={colorOf}/> : <p className="is-task-note">No options right now.</p>}</>, field.optional);
    })}
    {spec && <HandPicker title={spec.label} hint={spec.min === spec.max ? `${cardTotal} of ${spec.min}` : `${cardTotal} chosen · ${spec.min} to ${spec.max}`} value={draft.cards} limit={spec.available} goods={spec.allowed} onChange={cards => update({ cards })}/>}
    <div className="is-actionbar"><ArcadeButton tone="lime" size="lg" disabled={busy || !complete} onClick={() => send(command, draft.choices, spec ? draft.cards : undefined)}>Confirm {prettyLabel(command).toLowerCase()}</ArcadeButton>{!complete && <small className="is-task-note">{!cardsOk ? (spec && !withinLimit(draft.cards, spec.available, spec.allowed) ? 'Some picked cards are no longer available. Adjust them.' : 'Adjust the card count.') : command.fields.some(field => stale(field.key)) ? 'A saved choice is no longer offered. Pick again.' : 'Answer every required choice first.'}</small>}</div>
  </section>;
}
