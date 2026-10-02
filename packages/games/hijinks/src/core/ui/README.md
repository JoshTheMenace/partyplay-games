# Hijinks UI kit (`src/core/ui`)

Import everything from `../../core/ui` in `minis/<id>/client.tsx`. The kit stylesheet loads with it. Scope your own CSS under `.hj-<id>`.

```tsx
import { Stage, PromptCard, Timer, PlayerStrip, VoteReveal, PhoneShell, PhoneTextEntry, PhoneDone, useTimeline } from '../../core/ui';
```

## Ground rules

- **TV**: your `Display` already renders inside `Stage`, a fixed **1920×1080 px** canvas scaled to fit. Size TV things in px, design for 10 players and maximum-length text, and lay out with flex/grid in the full box. The pack provides the backdrop. `--hj-accent` is your catalog accent.
- **Phone**: wrap every `Controller` screen in `PhoneShell`: one task, big targets, and the primary button in `action`.
- **Time** always comes from `props.now()` (server clock). Drive reveals from server timestamps (`useTimeline`) so a reloaded TV lands on the same beat.
- **Drafts**: use `props.sessionKey` + your turn id as the draft key. After a reload, read your private view to decide whether to show `PhoneDone`.
- Reduced motion is handled: decorative loops stop, confetti and beams hide. Never hide readable text behind an animation.

## TV components

| Export | Props | Notes |
|---|---|---|
| `Stage` | `accent?, fill?, children` | The pack wraps minigame displays for you (with `fill`: the stage covers the whole browser window, letterboxed only by aspect ratio, and the platform header floats on top, hiding after 3.5 s idle). Use it directly only in tests. |
| `Spotlight` | `children` | A spotlight cone and floor pool around centred content. |
| `Enter` | `k, variant?: 'pop'\|'rise'\|'slide'\|'zoom'\|'drop', delay?` | Keyed entrance: change `k` (phase, round) to replay it. |
| `BigTitle` | `children, kicker?, size?=120` | Huge stroked Lilita title. |
| `Callout` | `children, tone?` | Swooping ribbon banner, e.g. "Time's up!". |
| `Confetti` | `burst?, count?=80` | One-shot burst over its positioned parent. Change `burst` to fire it again. |
| `Timer` | `deadline, now, total?, size?=168` | Ring timer that turns urgent under 5 s. Pass `total` (ms) for an exact ring. |
| `PlayerStrip` | `players, done?, vip?, badges?, size?` | Everyone in roster order. With `done` (submitted ids), slots light up and still-working players show thinking faces. |
| `StillWorking` | `players, label?` | Small row of thinking avatars. |
| `PromptCard` | `children, eyebrow?, size?=64` | Big paper card. String text auto-shrinks with length. |
| `AnswerCard` | `text? \| children, label?, author?, showAuthor?, voters?, points?, tag?, state?: 'idle'\|'win'\|'lose', size?` | One answer. `children` can hold a `DrawingRenderer`. |
| `VoteReveal` | `entries: VoteEntry[], step` | Steps are 0 answers, 1 voters fly in, 2 authors, 3 points + winner/loser. Two entries use a VS layout. |
| `Scoreboard` | `players, scores, from?, delay?, highlight?, rowHeight?=84` | Rows slide to new ranks while scores count up. `from` sets the previous scores. |
| `Podium` | `players, scores, winners?, unit?` | Steps for 1st, 2nd and 3rd (tied players share a step), plus everyone else listed below. |
| `Avatar` | `avatar, color, mood?, size?, crown?, label?` | One of 16 characters (`CHARACTERS[i].name`). Moods are `idle`, `happy`, `sad`, `thinking` and `done`. Sizes are `xs` 32, `sm` 48, `md` 72, `lg` 112, `xl` 168, or a number. |
| `AvatarBadge` | `player, mood?, size?, vip?, detail?, layout?` | Avatar plus the full name, underlined in the player's colour. Long names wrap instead of being clipped. |
| `AvatarStack` | `players, size?, max?=8, mood?` | Overlapping voters with a `+N` count. Screen readers get every name. |
| `Trophy` | `className?, label?` | Gold cup icon sized at 1em. |

Helpers: `fitText(text, base)` returns a font size for player text. `ordinal(n)` returns `1st`, `2nd`, and so on. `rankOf(scores, id, ids)` uses competition ranking (1, 1, 3).

## Phone components

| Export | Props | Notes |
|---|---|---|
| `PhoneShell` | `player?, vip?, accent?, eyebrow?, title?, timer?: {deadline, now, total?}, action?, children` | Header (avatar, name, colour, `PhoneTimer`), title, main area and a sticky `action` footer. |
| `PhoneTextEntry` | `label, draftKey, maxLength, onSubmit(text) => Promise<ActionResult>, multiline?, placeholder?, submitLabel?, hint?, disabled?` | `multiline` gives a wrapping 3-line box where Enter still sends (use it for answers longer than ~30 characters). Live counter, persisted draft and pending/accepted/rejected states. Rejections show the server's reason. Text is trimmed and an empty answer cannot be sent. |
| `PhoneChoices` | `options: PhoneChoice[], onSubmit(ids), multi?, min?, max?, picked?, locked?, submitLabel?, columns?, label?` | Single mode sends on tap. Multi mode toggles options, then sends with the sticky button. `{disabled: true, reason: 'Your answer'}` blocks a player's own entry. |
| `PhoneDraw` | `prompt, draftKey, onSubmit(drawing), submitLabel?, minStrokes?=1, disabled?` | Shared `DrawingPad` with a persisted draft. Send the drawing inside your own action with your turn id. |
| `PhoneWaiting` | `player?, title?, detail?, waitingFor?, lines?` | "While you wait" screen with rotating lines and the players still working. |
| `PhoneDone` | `player?, title?='Locked in!', detail?, children?` | Submitted/locked state. |
| `PhoneTimer` | `deadline, now, total?` | Compact timer pill. `PhoneShell` adds it for you. |

## Hooks

- `useNow(now, ms=250)` re-renders on an interval and returns server time.
- `useTimeline(startAt, [0, 1500, 3000], now)` returns how many reveal steps have started.
- `useCountUp(target, ms=900)` eases a number toward its target.
- `useDraft<T>(key, initial)` returns `[value, set, clear]`, backed by sessionStorage.
- `useSend()` returns `[state, run, reset]`. It ignores taps while a send is pending.
- `sendWithState(send, set)` is the same send flow without React.

## Example

```tsx
import type { MiniClient, MiniViewProps } from '../../core/contract';
import { PhoneDone, PhoneShell, PhoneTextEntry, PlayerStrip, PromptCard, Timer, VoteReveal, useTimeline } from '../../core/ui';
import type { Pub, Priv } from './types';

function Display({ view, players, vip, now }: MiniViewProps<Pub, Priv>) {
  const step = useTimeline(view.revealAt ?? Infinity, [0, 1200, 2600, 4000], now);
  return <div className="hj-myid">
    <PromptCard>{view.prompt}</PromptCard>
    {view.phase === 'write' && <Timer deadline={view.deadline} now={now} />}
    {view.phase === 'reveal' && <VoteReveal step={step} entries={view.entries.map(e => ({ ...e, author: players.find(p => p.id === e.author), voters: players.filter(p => e.voters.includes(p.id)) }))} />}
    <PlayerStrip players={players} vip={vip} done={view.submitted} />
  </div>;
}

function Controller({ view, me, players, playerId, vip, now, send, sessionKey }: MiniViewProps<Pub, Priv>) {
  const player = players.find(p => p.id === playerId)!;
  return <PhoneShell player={player} vip={vip === playerId} timer={{ deadline: view.deadline, now }} title="Make them laugh">
    {me?.answered
      ? <PhoneDone player={player} detail="Eyes on the TV!" />
      : <PhoneTextEntry label={me!.prompt} maxLength={80} draftKey={`${sessionKey}:${view.turn}`} onSubmit={text => send({ turn: view.turn, text })} />}
  </PhoneShell>;
}

export default { Display, Controller } satisfies MiniClient;
```

Register your client in `minis/registry.client.ts`: `'my-id': () => import('./my-id/client')`.
