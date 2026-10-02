/* Phone controller kit: one obvious task per screen, ≥48 px targets, drafts that survive reloads, clear send states. */
import { useEffect, useId, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ArcadeButton, DrawingPad, StatusNotice } from '../../../../../party-ui/src/index';
import type { ActionResult, Drawing } from '../../../../../party-contract/src/index';
import type { PackPlayer } from '../contract';
import { Avatar, AvatarBadge, AvatarStack } from './avatar';
import { useDraft, useSend, type SendState } from './hooks';
import { PhoneTimer } from './timer';

/**
 * Portrait screen frame: header (avatar, name, colour, optional server-clock timer), optional kicker + title, main
 * content and a sticky bottom `action` area for the primary button. `accent` tints the frame.
 */
export function PhoneShell({ player, vip, accent, eyebrow, title, timer, action, children, className = '' }: { player?: PackPlayer | null; vip?: boolean; accent?: string; eyebrow?: ReactNode; title?: ReactNode; timer?: { deadline: number; now(): number; total?: number } | null; action?: ReactNode; children?: ReactNode; className?: string }) {
  return <section className={`hj-phone ${className}`} style={{ '--hj-accent': accent ?? 'var(--kp-grape)', '--c': player?.color ?? 'var(--kp-sun)' } as CSSProperties}>
    {(player || timer) && <header className="hj-phone-head">{player && <AvatarBadge player={player} size={44} vip={vip} />}{timer && <PhoneTimer {...timer} />}</header>}
    {(eyebrow || title) && <div className="hj-phone-title">{eyebrow && <p className="hj-kicker">{eyebrow}</p>}{title && <h2>{title}</h2>}</div>}
    <div className="hj-phone-main">{children}</div>
    {action && <footer className="hj-phone-action">{action}</footer>}
  </section>;
}

export const WAIT_LINES = [
  'Stretch those typing thumbs.', 'Practise your gracious-winner face.', 'Hydrate. Comedy is thirsty work.', 'Somebody in this room is about to be hilarious.',
  'Rate the snacks out of ten. Silently.', 'Rehearse an excuse for losing. Just in case.', 'Make eye contact with your rival. Hold it…', 'Your phone believes in you.',
  'Hum the theme tune. Quietly.', 'Strike a pose for the invisible studio audience.', 'Draft a victory speech. Keep it under ten seconds.', 'Blink twice if you are having fun.',
  'Count the ceiling lights. For luck.', 'Crack your knuckles dramatically.', 'Look mysterious. It unsettles people.',
];
/** "While you wait" block: your character, what the room is waiting on, who is still working, and a rotating fun line. */
export function PhoneWaiting({ player, title = 'Sit tight!', detail, waitingFor, lines = WAIT_LINES }: { player?: PackPlayer | null; title?: ReactNode; detail?: ReactNode; waitingFor?: readonly PackPlayer[]; lines?: readonly string[] }) {
  const [line, setLine] = useState(() => Math.floor(Math.random() * lines.length));
  useEffect(() => { const id = setInterval(() => setLine(n => (n + 1) % lines.length), 4500); return () => clearInterval(id); }, [lines.length]);
  return <div className="hj-wait">
    {player && <Avatar avatar={player.avatar} color={player.color} size={120} mood="idle" />}
    <h3>{title}</h3>
    {detail && <p className="hj-wait-detail">{detail}</p>}
    {!!waitingFor?.length && <div className="hj-wait-who"><AvatarStack players={waitingFor} size={40} mood="thinking" /><span>Waiting on {waitingFor.length === 1 ? waitingFor[0]!.name : `${waitingFor.length} players`}</span></div>}
    <p className="hj-wait-line" key={line}>{lines[line % lines.length]}</p>
  </div>;
}

/** Submitted/locked state: happy character with a stamp. Optional extra content (e.g. what you sent). */
export function PhoneDone({ player, title = 'Locked in!', detail, children }: { player?: PackPlayer | null; title?: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return <div className="hj-done" role="status">
    {player && <Avatar avatar={player.avatar} color={player.color} size={132} mood="done" />}
    <h3><span className="hj-done-stamp" aria-hidden="true">✓</span>{title}</h3>
    {detail && <p>{detail}</p>}
    {children}
  </div>;
}

function SendNotice({ state, sentLabel }: { state: SendState; sentLabel: string }) {
  if (state.status === 'rejected') return <StatusNotice tone="error">{state.reason}</StatusNotice>;
  return state.status === 'accepted' ? <StatusNotice tone="success">{sentLabel}</StatusNotice> : null;
}

type TextEntryProps = {
  label: ReactNode; draftKey: string; maxLength: number; onSubmit(text: string): Promise<ActionResult>;
  multiline?: boolean; placeholder?: string; submitLabel?: string; hint?: ReactNode; disabled?: boolean; autoFocus?: boolean;
};
/**
 * Text answer (`multiline`: a wrapping box where Enter still sends, so long answers stay fully visible) with a live length counter, a sessionStorage draft under `draftKey`, and pending/accepted/rejected states
 * (rejections show the server's reason). Trims before sending; empty answers cannot be sent. After a reload, show
 * PhoneDone from your private view instead: this component only knows what it sent itself.
 */
export function PhoneTextEntry(props: TextEntryProps) { return <TextEntry key={props.draftKey} {...props} />; }
function TextEntry({ label, draftKey, maxLength, onSubmit, multiline, placeholder = 'Type here…', submitLabel = 'Send it', hint, disabled, autoFocus }: TextEntryProps) {
  const [text, setText] = useDraft(draftKey, ''), [state, run] = useSend(), id = useId();
  const value = text.trim(), pending = state.status === 'pending', sent = state.status === 'accepted', locked = disabled || pending || sent;
  const submit = async (event?: FormEvent) => { event?.preventDefault(); if (value && !locked) await run(() => onSubmit(value)); };
  const field = { id, value: text, maxLength, placeholder, disabled: locked, autoFocus, autoComplete: 'off', spellCheck: true, 'aria-describedby': `${id}-n`, onChange: (e: { target: { value: string } }) => setText(e.target.value.slice(0, maxLength)) };
  return <form className="hj-entry" data-state={state.status} onSubmit={submit}>
    <label htmlFor={id} className="hj-entry-label">{label}</label>
    {multiline
      ? <textarea {...field} rows={3} enterKeyHint="send" autoCapitalize="sentences" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
      : <input {...field} type="text" enterKeyHint="send" autoCapitalize="sentences" />}
    <div className="hj-entry-meta">{hint && <span>{hint}</span>}<span id={`${id}-n`} className="kp-numeral" data-warn={maxLength - text.length <= 10 || undefined} aria-label={`${text.length} of ${maxLength} characters`}>{text.length}/{maxLength}</span></div>
    <SendNotice state={state} sentLabel="Sent! Look at the big screen." />
    <div className="hj-sticky"><ArcadeButton type="submit" tone="lime" size="lg" disabled={!value || locked}>{pending ? 'Sending…' : sent ? 'Sent ✓' : submitLabel}</ArcadeButton></div>
  </form>;
}

export type PhoneChoice = { id: string; label: ReactNode; detail?: ReactNode; disabled?: boolean; /** Why it is disabled, e.g. 'Your answer'. */ reason?: string; color?: string; ariaLabel?: string };
/**
 * Big tappable options. Single mode sends on tap; `multi` toggles up to `max` then sends with the sticky button.
 * `picked` is the server-confirmed selection (shown as chosen); `locked` disables everything.
 */
export function PhoneChoices({ options, onSubmit, multi, min = 1, max, picked, locked, submitLabel = 'Lock it in', columns = 1, label, className = '' }: { options: readonly PhoneChoice[]; onSubmit(ids: string[]): Promise<ActionResult>; multi?: boolean; min?: number; max?: number; picked?: readonly string[] | null; locked?: boolean; submitLabel?: string; columns?: 1 | 2; label?: string; className?: string }) {
  const [selection, setSelection] = useState<string[]>([]), [state, run] = useSend();
  const pending = state.status === 'pending', chosen = multi ? selection : pending || !picked ? selection : [...picked];
  const tap = (id: string) => {
    if (locked || pending) return;
    if (!multi) { setSelection([id]); void run(() => onSubmit([id])).then(ok => { if (!ok) setSelection([]); }); return; }
    setSelection(s => s.includes(id) ? s.filter(x => x !== id) : max && s.length >= max ? (max === 1 ? [id] : s) : [...s, id]);
  };
  return <div className={`hj-choices ${className}`}>
    <div className="hj-choice-list" data-cols={columns} role={multi ? 'group' : 'radiogroup'} aria-label={label}>
      {options.map(o => { const on = chosen.includes(o.id); return <button key={o.id} type="button" className="hj-choice" style={o.color ? { '--c': o.color } as CSSProperties : undefined}
        role={multi ? undefined : 'radio'} aria-checked={multi ? undefined : on} aria-pressed={multi ? on : undefined} aria-label={o.ariaLabel}
        disabled={locked || o.disabled || (multi && state.status === 'accepted')} data-on={on || undefined} data-busy={(pending && on) || undefined} onClick={() => tap(o.id)}>
        <span className="hj-choice-label">{o.label}</span>{o.detail && <small>{o.detail}</small>}{o.disabled && o.reason && <em>{o.reason}</em>}
      </button>; })}
    </div>
    <SendNotice state={state} sentLabel={multi ? 'Locked in!' : 'Got it!'} />
    {multi && <div className="hj-sticky"><ArcadeButton tone="lime" size="lg" disabled={locked || pending || state.status === 'accepted' || selection.length < min} onClick={() => void run(() => onSubmit(selection))}>{pending ? 'Sending…' : state.status === 'accepted' ? 'Locked ✓' : `${submitLabel}${max && max > 1 ? ` (${selection.length}/${max})` : ''}`}</ArcadeButton></div>}
  </div>;
}

type DrawProps = { prompt: ReactNode; draftKey: string; onSubmit(drawing: Drawing): Promise<ActionResult>; submitLabel?: string; minStrokes?: number; disabled?: boolean };
/** Shared DrawingPad with the prompt above, a persisted draft and a sticky submit (needs `minStrokes`, default 1). */
export function PhoneDraw(props: DrawProps) { return <Draw key={props.draftKey} {...props} />; }
function Draw({ prompt, draftKey, onSubmit, submitLabel = 'Submit drawing', minStrokes = 1, disabled }: DrawProps) {
  const [drawing, setDrawing] = useDraft<Drawing>(draftKey, { strokes: [] }), [state, run] = useSend();
  const pending = state.status === 'pending', sent = state.status === 'accepted';
  return <div className="hj-draw">
    <div className="hj-draw-prompt">{prompt}</div>
    <DrawingPad value={drawing} onChange={setDrawing} disabled={disabled || pending || sent} label="Your drawing" />
    <SendNotice state={state} sentLabel="Masterpiece delivered!" />
    <div className="hj-sticky"><ArcadeButton tone="lime" size="lg" disabled={disabled || pending || sent || drawing.strokes.length < minStrokes} onClick={() => void run(() => onSubmit(drawing))}>{pending ? 'Sending…' : sent ? 'Sent ✓' : submitLabel}</ArcadeButton></div>
  </div>;
}
