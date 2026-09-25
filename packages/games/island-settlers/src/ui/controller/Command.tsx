/**
 * Generic server-command sheet (EXPERIENCE §4.2 Expansion commands): each field in order, a chosen option's
 * `then` fields after it, map fields on the map, choices as a 2-column grid, cards as the pick grid.
 */
import { ArcadeButton } from '../../../../../party-ui/src/index';
import type { CardPicks, Choice, Command, Field, PickField, Picks, Prompt } from '../../model';
import { spotDetail } from '../map/index';
import { tapText } from '../shared/format';
import { GoodChip, Icon } from '../shared/icons';
import { titleCase, TRACK_META } from '../shared/labels';
import { seatOf } from '../shared/seats';
import { EmblemChip } from '../shared/SeatChip';
import { CostRow } from './Build';
import { CardPick } from './CardPick';
import { useCtl, useDraft } from './context';
import { activeFields, answerOf, fieldsReady, onMap, picked } from './logic';
import { MapView } from './MapView';

type Draft = { picks: Picks; cards: CardPicks };

/** Raw ids ("wood", "science") read as words; server labels win when they are real text. */
const pretty = (o: Choice) => (/^[a-z0-9:/-]+$/.test(o.label) ? titleCase(o.label) : o.label);

function OptionFace({ field, option }: { field: PickField; option: Choice }) {
  const { pub } = useCtl();
  if (field.target === 'seat') {
    return <><EmblemChip index={seatOf(pub, option.value)?.seat ?? 0} size="24px"/>{pretty(option)}</>;
  }
  if (field.target === 'good') return <><GoodChip good={option.value as 'wood'}/>{pretty(option)}</>;
  if (field.target === 'track' && option.value in TRACK_META) {
    return <><Icon name={option.value} size={22}/>{TRACK_META[option.value as 'science'].label}</>;
  }
  return <>{pretty(option)}</>;
}

/** 2-column radio grid, 48px rows, 16px text. */
export function ChoiceGrid({ field, value, onChange }: {
  field: PickField; value: string | undefined; onChange(v: string | undefined): void;
}) {
  return <fieldset className="island-settlers-choices">
    <legend>{field.label}{field.optional && ' (optional)'}</legend>
    {field.options.map(o => <label key={o.value} data-on={value === o.value || undefined}>
      <input type="radio" name={field.key} checked={value === o.value} onChange={() => onChange(o.value)}/>
      <span><b><OptionFace field={field} option={o}/></b>{o.detail && <small>{o.detail}</small>}</span>
    </label>)}
    {field.optional && value !== undefined && <button type="button" className="island-settlers-link"
      onClick={() => onChange(undefined)}>Clear</button>}
  </fieldset>;
}

function MapField({ field, value, onChange, open }: {
  field: PickField; value: string | undefined; onChange(v: string): void; open: boolean;
}) {
  const { pub, me, docked } = useCtl();
  const chosen = field.options.find(o => o.value === value);
  const labels = Object.fromEntries(field.options.map(o =>
    [o.value, o.detail ? `${o.label}. ${o.detail}` : o.label]));
  return <section className="island-settlers-field">
    <h3>{field.label}</h3>
    <p className="island-settlers-note">{chosen ? `${pretty(chosen)}: ${spotDetail(pub, chosen.value, me.seat)}`
      : tapText(`Tap a highlighted spot (${field.options.length} to choose from)`, docked)}</p>
    {open && <MapView spots={field.options.map(o => o.value)} selected={value ?? null} labels={labels}
      onSelect={onChange}/>}
  </section>;
}

/** One command or prompt. Prompts send `answer` and use the command label as the button ("Discard 4 cards"). */
export function CommandSheet({ command, prompt, onBack }: {
  command: Command; prompt?: Prompt; onBack?(): void;
}) {
  const { act, busy, me } = useCtl();
  const [draft, setDraft] = useDraft<Draft>(`command:${prompt?.id ?? command.id}`, { picks: {}, cards: {} });
  const fields = activeFields(command.fields, draft.picks);
  // One map at a time: the first unanswered map field, else the last one (so its ghost stays visible).
  const mapped = fields.filter(onMap), shown = mapped.find(f => !picked(f, draft.picks)) ?? mapped.at(-1);
  const setPick = (key: string, v: string | undefined) => {
    const picks = { ...draft.picks };
    if (v === undefined) delete picks[key]; else picks[key] = v;
    setDraft({ ...draft, picks });
  };
  const ready = fieldsReady(command.fields, draft.picks, draft.cards);
  const send = async () => {
    const answer = answerOf(command.fields, draft.picks, draft.cards);
    const ok = await act(prompt ? { type: 'answer', prompt: prompt.id, ...answer }
      : { type: 'command', command: command.id, ...answer });
    if (ok) { setDraft({ picks: {}, cards: {} }); onBack?.(); }
  };
  const verb = prompt?.kind === 'discard' ? 'Discard' : 'Pick';
  const field = (f: Field) => f.kind === 'cards'
    ? <CardPick key={f.key} field={f} verb={verb} value={draft.cards[f.key] ?? {}}
      onChange={c => setDraft({ ...draft, cards: { ...draft.cards, [f.key]: c } })}/>
    : onMap(f) ? <MapField key={f.key} field={f} value={draft.picks[f.key]} open={f === shown}
      onChange={v => setPick(f.key, v)}/>
      : <ChoiceGrid key={f.key} field={f} value={draft.picks[f.key]} onChange={v => setPick(f.key, v)}/>;
  return <div className="island-settlers-screen island-settlers-command">
    {!prompt && <header className="island-settlers-command-head">
      <h3>{command.label}</h3>
      {onBack && <button type="button" className="island-settlers-link" onClick={onBack}>Back</button>}
    </header>}
    {command.detail !== me.task.text && <p className="island-settlers-note">{command.detail}</p>}
    {fields.map(field)}
    <div className="island-settlers-confirm">
      {command.cost && <CostRow cost={command.cost}/>}
      <ArcadeButton tone={prompt?.kind === 'discard' ? 'coral' : 'lime'} size="lg" disabled={busy || !ready}
        onClick={send}>{command.label}</ArcadeButton>
    </div>
  </div>;
}
