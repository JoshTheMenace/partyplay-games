# Trolley Court — design and build contract

Trolley Court (`id: trolley-court`) is an original party game about the trolley problem, built on the mechanics of a published
argue-and-judge card game. Each round, one player is the **Conductor**. The others split into two teams, **North** and
**South**, and each team owns one branch of a split track. The teams load the tracks with people and things worth saving
(**Innocents**) and worth flattening (**Guilty**), then pile on **Twists** (modifiers). They argue their case out loud, and
the Conductor decides whether to pull the lever. Every member of the struck team gains a death. Fewest deaths wins.

The game uses the shared room runtime. A watching TV runs `DisplayView`, the phones are portrait controllers
(`ControllerView`), and the lobby, readiness, reconnect and results shell are shared. The title, card text, art, narrator
("the Clerk"), names and sounds are all original. Never reproduce the published game's title, logo, art, mascots or card
text. The UI may use the generic terms Conductor, Innocent, Guilty and Twist.

Theme: a courtroom held at a railway junction. The Conductor is "Your Honour" and wears a conductor's cap with a judge's
wig. The teams are counsel. The Clerk is a dry, unflappable court clerk who narrates on the TV. Colours: North `--kp-sky`,
South `--kp-coral`, Conductor `--kp-sun`. Seat colours are kept on every name chip.

## Roster, roles and rounds

- Manifest: 3–10 players, `shared-display`, `turn-based`, `input: ['action']`, private views on, no solo play, portrait
  controller. The watching host takes no seat. The roster is fixed for the game, because the platform seats newcomers
  only in the next round (Play again).
- **Conductor rotation:** round `r` (1-based) is conducted by seat `(r - 1) % n`, in roster order.
- **Teams** come from `seatTeams(seats, round)` in `types.ts`. Starting with the seat after the Conductor and following
  seat order, the first `ceil(k/2)` of the `k = n - 1` other players form North and the rest form South. The teams
  reshuffle every round, as the physical game's seat-relative teams do.
- **Rounds:** `roundCount(n, laps)` is `n × lapsFor(n, laps)`. With `laps: 'auto'` (official), each player conducts
  twice with 3–4 players and once with 5–10. The setting can also be forced to 1 or 2 laps. Every player conducts the
  same number of times.
- **Default track:** at each deal the server picks the trolley's default heading (`defaultSide`) with a seeded coin flip,
  so teams know before building whether they sit in the trolley's path. Doing nothing sends the trolley that way, and
  pulling the lever diverts it. This keeps the trolley-problem flavour, because action and inaction are different choices.

| Players | Others | North | South | Twists per team (N/S) | Rounds (auto) |
|---|---|---|---|---|---|
| 3 | 2 | 1 | 1 | 1/1 | 6 |
| 4 | 3 | 2 | 1 | 1/1 | 8 |
| 5 | 4 | 2 | 2 | 1/1 | 5 |
| 6 | 5 | 3 | 2 | 1/1 | 6 |
| 7 | 6 | 3 | 3 | 1/1 | 7 |
| 8 | 7 | 4 | 3 | 2/1 | 8 |
| 9 | 8 | 4 | 4 | 2/2 | 9 |
| 10 | 9 | 5 | 4 | 3/2 | 10 |

The number of twists per team is `modifierSlots(size, accomplices, underdog)`. Officially that is one twist, plus one for
each member beyond three. With **Accomplices** on, it is one per member. **Underdog** (catch-up) adds one twist to the
team of any non-Conductor player tied for the most deaths (more than 0). Those players are listed in
`PublicView.underdogs`, and a team gets at most +1. Twists per team are capped at `MAX_MODIFIER_SLOTS = 6`.

## Cards and the deck

| Kind | UI name | Goes to | Hand per team | Stock bank (minimum) |
|---|---|---|---|---|
| `innocent` | Innocent | slot 0 of each track at random from the deck; slot 1 on the team's **own** track | 3 | 120 (`i001`…) |
| `guilty` | Guilty | slot 2 of the **opponent's** track | 3 | 90 (`g001`…) |
| `modifier` | Twist | attached to any one of the 6 track cards (own or opponent's) | `min(12, 3 × twists)` | 120 (`m001`…) |

- Card shape: `Card = { id, kind, text, figure?, spicy?, blank? }`. Innocent and Guilty cards carry a `figure` (one of
  `FIGURES`), which the UI draws as a silhouette. Twists have no figure.
- Three server-side decks are shuffled with the seeded RNG. Every card played or dealt in a round goes to its kind's
  discard pile when the round ends. A deck that runs short reshuffles its discard pile, so a card never appears twice in
  one round. With `family` on, cards marked `spicy` are excluded from the deck.
- **Write-ins** (`blanks`, on by default): each round, each team gets one blank card in the hand chosen by
  `blankKind(round)`, which rotates Innocent → Guilty → Twist. It replaces one dealt card. Its id is
  `w<round><n|s>`, its text is `''` and it has `blank: true`. To play it, a teammate types text on the phone. The
  server validates the text with `cleanWriteIn` from `types.ts`: whitespace is collapsed and trimmed, the text must
  contain a letter or digit, control characters are rejected, and the limit is 60 characters. The Clerk reads write-ins
  with browser speech synthesis. The host can turn write-ins off. They are not filtered, which the instructions note.
- **Content tone:** absurd and dark-comic, kept within platform norms. Not allowed: real people living or recently
  dead, brands, real tragedies, slurs, attacks on protected groups, any sexual content, and graphic gore. Guilty cards
  are petty sins up to cartoon villainy. Mark darker cards (crime, mortality jokes) as `spicy`, and keep at least 90
  Innocent, 68 Guilty and 90 Twist cards that are not spicy.
- **Style:** Innocent and Guilty cards are noun phrases in sentence case with an article and no final period, for
  example "A lighthouse keeper who still waves at every boat". A Twist begins in lowercase, has no final period and must
  read naturally after any track card or after one person on it. Prefer forms that avoid verb agreement:
  "who…", "holding…", "but…", "with…", "after…". For example: "who owes you forty dollars" or "holding the only cure for
  hiccups". Stock text limits are `TEXT_MAX`: 70/70/60. Each text should fit on a TV card at two or three lines.

### `src/deck.server.ts` (deck builder) — exact exports

```ts
import type { Card } from './types';
export const INNOCENT: readonly Card[];   // ≥ 120, kind 'innocent', ids i001…, figure required
export const GUILTY: readonly Card[];     // ≥ 90,  kind 'guilty',   ids g001…, figure required
export const MODIFIERS: readonly Card[];  // ≥ 120, kind 'modifier', ids m001…, no figure
```

Ids are three-digit, zero-padded and unique. They are **stable forever**, because the server, voice recordings
(`card.<id>`) and tests key on them. Never renumber. A retired card leaves a gap, and new cards are appended. Text is
trimmed, at most `TEXT_MAX[kind]` and unique within its kind. No stock card has `blank`. `spicy` is either `true` or
omitted. The file may export nothing else that the server needs. The rules builder's tests assert every constraint
above.

## Settings (`types.ts`: `Settings`, `defaults`, `options`, `toggles`, `parseSettings`)

| Key | Values | Default | Meaning |
|---|---|---|---|
| `laps` | `'auto'`, 1, 2 | `'auto'` | conductor laps (auto: 2 laps with 3–4 players, else 1) |
| `pickSeconds` | 20/30/45/60 | 30 | Innocent and Guilty pick timers |
| `modifierSeconds` | 30/45/60/90 | 45 | Twist pick timer |
| `floorSeconds` | 20/30/45/60 | 30 | each team's floor |
| `leverSeconds` | 10/15/20/30 | 20 | the Conductor's decision window |
| `accomplices` | bool | off | every teammate plays a twist |
| `catchUp` | bool | off | Underdog: +1 twist for the team of the most-killed player(s) |
| `blanks` | bool | on | write-in cards |
| `family` | bool | off | removes `spicy` cards |
| `readAloud` | bool | on | the Clerk reads every revealed card, and reveal beats lengthen to fit |

`parseSettings` is strict. It throws on unknown keys and on out-of-range or mistyped values, and `parseSettings({})`
returns the defaults. The server's `validateSettings` is `parseSettings`.

## Phase machine (server-authoritative)

`PublicView.phase` runs `deal → innocent → innocentReveal → guilty → guiltyReveal → modifier → modifierReveal → plead →
lever → crash`, then either the next round's `deal` or `complete`. Each phase sets `startedAt` and `deadline` on the
server clock. `turnId = turnIdFor(round, phase)` (for example `"3.guilty"`). Every action carries that id, and the
server rejects stale ids ("Too late — the court has moved on."). Beat-based phases advance `step` within the phase. The
phone and TV time everything from `deadline`, `step` and `startedAt`, and never from local timers alone.

| Phase | Length | What happens | Accepted actions | Cues |
|---|---|---|---|---|
| `deal` | `dealMs` (+`welcomeMs` in round 1) intro beat, then one `revealMs` beat per track (`steps` = 3) | New Conductor, teams, `underdogs` and `defaultSide` are set; hands are dealt privately. Step 1 reveals North slot 0 (random Innocent), step 2 South slot 0. | none | line `welcome` (round 1) or `round` / `final-round`; line `heading.<defaultSide>`; sfx `deal`; per beat sfx `flip` + `card` |
| `innocent` | `pickSeconds` | Each team locks one Innocent for its own slot 1. Picks stay hidden; only `progress` is public. | `propose`, `lock` | line `pick.innocent`; sfx `lock` per lock; `all-locked`; `hurry` sfx+line at `hurryMs` left; `timeup` if any auto-pick |
| `innocentReveal` | `introMs` + one beat per card (`steps` = 3) | North slot 1, then South slot 1, flip face-up. | none | line `reveal.innocent`; sfx `flip` + `card` per beat |
| `guilty` | `pickSeconds` | Each team locks one Guilty for the **opponent's** slot 2. | `propose`, `lock` | as `innocent` with `pick.guilty` |
| `guiltyReveal` | `introMs` + 2 beats | North slot 2 (South's Guilty), then South slot 2 (North's). | none | line `reveal.guilty`; sfx `drumroll` (intro), `reveal` + `card` |
| `modifier` | `modifierSeconds` | Each team locks one twist per slot, each with a target card (`Target = {side, slot}`). One card fills at most one slot. | `propose`, `lock` | as above with `pick.modifier` |
| `modifierReveal` | `introMs` + one beat per twist | Twists attach one at a time, interleaved North 0, South 0, North 1, South 1 … and then the rest. `spotlight` = target + `mod` index. | none | line `reveal.modifier`; sfx `stamp` + `card` per twist |
| `plead` | two floors × `floorSeconds` (`steps` = 2) | Floor 0 goes to the team **in the trolley's path** (`defaultSide`), floor 1 to the other team. Arguing happens out loud. The Conductor may `lean` the lever live (shown on the TV) and may tap **Next** once a floor has run `floorMinMs`. | `lean`, `next` (Conductor) | line `floor.<side>` + sfx `gavel` per floor; sfx `lever` on each lean change |
| `lever` | `leverSeconds` | Open floor: everyone shouts while the Conductor decides. **PULL** diverts to `opposite(defaultSide)`; **DO NOTHING** keeps `defaultSide`. On timeout the lever stays where it is, and `timedOut` is set. | `lean`, `decide` (Conductor) | line `lever`; sfx `tick` in the last 5 s; line `pull` / `nothing` / `dither` at the decision |
| `crash` | `crashMs` (`lastCrashMs` in the final round) | `struck` is set. Each player on the struck team gets `deaths +1`, each player on the other team gets `spared +1`, and the Conductor gets `conducted +1`. A `RoundRecord` is appended. The TV plays the trolley run. | none | sfx `lever` (if pulled), `bell`, `rumble`, `crash`, `gasp`/`aww`; line `struck` |
| `complete` | — | Every player tied for the fewest deaths is a winner. `outcome().complete` is true. | none | line `end` or `tie` |

- **Reveal beats:** each beat lasts `revealMs(card.text, settings.readAloud)`. With read-aloud on, a beat is 2.6–6.5 s,
  long enough for the card to be read. With it off, a beat is 2.2 s. During a reveal, `step` advances one beat at a time.
  The card revealed at a step is added to `tracks` at that step, never earlier.
- **Early advance:** a pick phase ends early once every slot of every team that has at least one connected member is
  locked. Its deadline becomes `max(lastLock + settleMs, startedAt + minPickMs)`, giving a readable "All locked" moment.
- **Pending auto-picks:** teams with no connected members are auto-picked when the phase ends (see "Missing input").
- After `crash`, the next round begins at `deal`. After the last round, the phase is `complete`. The platform round
  then ends (`outcome.complete`), and the shared results shell shows `ResultsView` with replay.

## Team collaboration: propose, then the first lock wins

Every teammate sees the team's shared hands and current slots on their own phone (`PrivateView.hands` and `slots`).
The flow is kept simple and robust:

1. **Propose.** Tapping a card sends `propose {slot, cardId}`. For a twist, the proposal also carries a `target`, and
   for a blank it carries a `text` draft. Each player has at most one proposal per slot. A new proposal replaces the old
   one, and `cardId: null` withdraws it. Teammates see proposal pips (colour dot plus initial) on the card and on the
   target. Proposals are never shown to the other team or the Conductor.
2. **Lock.** Any connected teammate can send `lock {slot, cardId, text?, target?}`. The first valid lock wins and is
   final; there is no unlock. A locked slot shows "Locked by <name>" to the team, and a later lock is rejected with
   "<name> already locked this." In the modifier phase a card locked in one slot cannot be locked in another.
3. Locks are hidden from the other team until the reveal. The TV shows only "North 1/2 locked".

**Validation** (the server throws Error with a short player-facing message, and the state is unchanged):

- The sender must be on a team; the Conductor and anyone outside the team are rejected.
- The phase must be a pick phase, and the slot index must be within range.
- The card must be in the team's hand of the current kind.
- `text` is allowed only for a blank card, and it is required (through `cleanWriteIn`) to lock one. A propose text of up
  to 60 characters is stored, and an empty text is allowed as a draft.
- `target` is allowed only in the modifier phase and is required to lock there. `slot` must be 0, 1 or 2.

Every rejected action leaves the state unchanged. A duplicate transport id is deduplicated by the platform.

## Missing input, disconnects and timers

- **Auto-pick on timeout:** each unlocked slot is filled in slot order. The server prefers the card with the most
  eligible proposals; ties go to the earliest proposal. A proposal is eligible if its card is still in the hand and
  unused, and if a blank has valid text. For a twist, the target is the one most proposed for that card; ties go to the
  earliest, and if none was proposed the target is random. With no eligible proposals, the server picks a random card
  that isn't blank, and a random target among the six. Auto-picks are revealed with `auto: true` and no `by`, the phone
  shows "Auto-picked", and the `timeup` cue plays. A round can never stall.
- **Disconnected players** keep their seat and team, and still score deaths or spared. Teammates simply play on.
  A team with no connected members gets auto-picks when the phase ends. A pick phase ends early once every team with a
  connected member has locked. If no team has a connected member, it ends at `startedAt + minPickMs`.
- **Disconnected Conductor:** building phases continue normally. In `plead` and `lever`, the current floor or window is
  shortened to at most `now + awayMs` when the Conductor disconnects or a floor or window starts during the absence. In
  `lever` the result is the lever's current position, which is the default track unless the Conductor leaned it before
  leaving, with `timedOut: true`. Reconnecting restores the Conductor's controls but never extends a deadline.
- **Reconnects** are handled entirely from views. Proposals and locks live on the server, so a reload shows the same
  locked state. The only local draft is the write-in text box. It is kept in `sessionStorage` under
  `trolley-court:<roomId>:<roundId>:<turnId>:<slot>` and is also mirrored through `propose`.

## Scoring, ties and outcome

- Faithful to the original: every player on the struck team gets +1 death (counted in `deaths`), whether they are
  connected or not. The Conductor never scores. There is no other scoring.
- Winners are every player tied for the fewest deaths, a shared win with no tie-breaker. On the results screen, rank is
  `1 + (number of players with fewer deaths)`.
- `outcome()` returns `{ complete, winners, rows }`. While the game is in progress, `complete` is false and `winners` is
  `[]`. Each row is `{ playerId, score: deaths, rank, label }`. The label reads `"<d> death(s) · spared <s>"`, for example
  `"2 deaths · spared 4"`. Rows are sorted by rank, then by seat.

## Privacy and projections

- **Public** (`PublicView`): revealed track cards and twists only, plus `progress` counts, phase, deadline, step,
  `spotlight`, lever position, teams, `underdogs`, players with deaths, history, cues and settings. Locked or proposed
  picks, hands and unrevealed write-in text are never public. Twists enter `tracks` only on their reveal beat.
- **Private** (`PrivateView`): for a team member, the team's hands and current slots, including teammates' proposals
  and locks. The Conductor gets `role: 'conductor'`, `side: null`, empty hands and `slots: []`. Hands of a kind empty
  once that kind's phase ends.
- Views are explicit projections. Optional fields are omitted, never set to `undefined`. Tests run `assertSerializable`
  on every phase. They also assert that the serialized public view contains no unrevealed card id or text, and that a
  player view never contains the other team's hands.
- Client code (`client.tsx`, `display.tsx`, `phone.tsx`, `cards.tsx`, `audio.tsx`) imports `types.ts`, `manifest.ts`,
  `narration.ts` and `vo-manifest.ts` only. It never imports `server.ts`, `deck.server.ts` or `bot.ts`.

## TV layout (DisplayView, 1920×1080 stage scaled to fit)

- **Top bar:** "Round 4 of 9", the Conductor's chip ("Your Honour: <name>", sun-coloured cap icon), the phase banner
  ("North & South pick an Innocent", "North has the floor", …) and the shared `Countdown` against `deadline`.
- **Left third: the junction.** The trolley sits on the single track, the switch and lever stand beside it, and the
  Conductor's avatar is at the lever. A large arrow shows where the trolley is heading. It follows `lever.pulled` live,
  so the room sees which way the Conductor leans, and a lever move animates with a clunk. A "DEFAULT" tag marks
  `defaultSide`.
- **Right two-thirds: two tracks,** North on top and South below. The tracks branch from the junction, with rails
  running behind the cards. Each track row has:
  - a team plate: team name, roster chips (seat colour, name up to 16 characters, skull pips for deaths, an
    "Underdog" badge when it applies), and the "IN THE PATH" tag on `defaultSide`;
  - three large card slots, labelled "Bystander", "Their pick" and "Planted by South/North". An empty slot is a dashed
    outline. A hidden locked pick shows a face-down card back with a "LOCKED" stamp, and a revealed card flips face-up
    (figure silhouette, text at 2–3 lines and at least 30px on the stage);
  - twists, stacked under their target card as caption chips in the author team's colour, each beginning with "+".
    At most three chips are visible per card. Beyond that, the font shrinks one step and the chip list scrolls
    vertically within the card column with a "+N more" chip that cycles. Text is never clipped. The layout must stay
    readable at the maximum of 11 twists (Accomplices 5+4 plus two Underdog extras).
- **Spotlight:** the spotlit card or twist scales up about 1.15×, gets a glow and an author tag ("by Sam" or
  "auto-picked"), and is read aloud.
- **Plead:** the speaking team's track brightens with a large "<TEAM> HAS THE FLOOR" plate and a big countdown, and the
  other track dims. In `lever`, both tracks are lit under "YOUR HONOUR DECIDES" with the Conductor's chip and the live heading arrow.
- **Crash (about 8 s):** the switch locks, the trolley rolls down the struck track, and each card gets a black "STRUCK"
  overlay in turn (`crash` sfx). The spared track gets a soft "SPARED" ribbon. The death tally then ticks up with
  skull pips falling onto the victims' chips. The trolley is cartoonish and nothing is gory.
- **Bottom strip:** the death tally for every player, in seat order, with colour chip, name, skull count and a cap
  icon for the current Conductor. It fits 10 seats in one row at 1280×720.
- The layout must be checked at 1280×720 and 1920×1080, with 10 players, 16-character names, 70-character cards,
  60-character twists and write-ins, and the maximum number of twists on one card.

## Phone layouts (ControllerView, portrait first; also short landscape)

Every screen has a header showing the role chip ("NORTH · with Sam, Ana" / "CONDUCTOR"), the phase and a `Countdown`.
Controls are at least 48px, card text at least 16px, and states (draft, pending, locked, time up, reconnecting) are
always explicit.

**Team member**

- **`deal` and reveal phases:** "Watch the TV" with a compact two-row track map below, showing revealed cards
  abbreviated and the team's own track highlighted. Under it, the team's three hands are collapsible and grouped by
  kind, with the next kind open, so the team can plan quietly.
- **Pick phases:**
  - A slot strip at the top shows "Innocent", "Guilty" or "Twist 1 / 2 / 3", each with its lock state.
  - The current hand is a vertical list of large card buttons (`aria-pressed` when it is your proposal) showing
    teammates' proposal pips. Tapping a card proposes it. The selected card shows a sticky **Lock it in** button
    (`ArcadeButton` lg) that never covers the selection.
  - **Twists:** after choosing a card, a two-row, three-column target map shows the six track cards (own track marked
    "yours"), with teammates' target pips. Lock is enabled once a target is chosen.
  - **Blank card:** opens a `TextInput` (`maxLength` 60, a counter, and the draft kept in `sessionStorage`).
    `cleanWriteIn` checks the text before lock.
  - **After locking:** a big "LOCKED by <name>" stamp appears on the card, followed by "Waiting for the other team…".
  - **Rejections** appear in a `StatusNotice`.
- **`plead`:** on your floor, "YOUR FLOOR — argue out loud!" with the big countdown and a cheat sheet of your track
  (three cards plus twists) and the opposing track. Otherwise, "<TEAM> has the floor". A live lever indicator shows where
  the trolley is heading.
- **`lever`:** "The Conductor is deciding — shout now!" with the live lever indicator.
- **`crash`:** "SPARED" (team colour) or "STRUCK — +1 death" with your new death total.

**Conductor**

- **Building phases:** "You're the Conductor". A read-only view of both tracks fills in as cards are revealed, with
  "North ✓ / South …" lock progress and the default heading. The Conductor never sees hands or proposals.
- **`plead`:** a large lever control (a toggle of at least 120px with `role="switch"` and the label "Trolley heading:
  SOUTH") sends `lean`. A **Next speaker ▶** button is enabled after `floorMinMs` and sends `next {step}`. Both full
  tracks with twists are shown for reference and scroll as needed.
- **`lever`:** two big press-and-hold buttons (1 s, with a progress fill; keyboard: hold Enter or Space). **PULL THE
  LEVER → hits <opposite>** and **DO NOTHING → hits <default>** each send `decide {pull}`. The lever toggle stays
  visible. After a decision the screen shows "Verdict delivered".

## Audio (host display only)

`audio.tsx` exports the final API. It is currently a stub with no-op bodies:

```ts
export function AudioView(props: GameAudioProps<PublicView>): null; // GameClientModule.AudioView; active only when isHost && viewRole === 'display'
export function cue(id: SfxId, gain?: number): void;                // play one effect now on this device (phone tap / local feedback)
export function sayLine(id: LineId): void;                          // queue a Clerk line (random recorded variant), ducking music
export function sayCard(card: Card): void;                          // queue a card read-aloud: recording `card.<id>` if present, else speech synthesis
export function disposeAudio(): void;                               // stop speech, close contexts (client.dispose calls it)
```

- **Server cues drive the TV.** The server appends `Cue`s to `PublicView.cues` (last `CUE_LIMIT`, with `seq` rising
  for the whole game) as listed in the phase table. `AudioView` plays each cue once, drops cues more than about 4 s
  old, and plays narration in a queue that ducks other sound. A `card` cue's id refers to a card visible in
  `tracks`, and the mixer looks the card up there and calls `sayCard`. Display and phone views never call `sayLine` or
  `sayCard` for these moments. Phones may call `cue('tap' | 'lock' | 'lever')` for local feedback; it respects the
  shared mute.
- **The narrator (the Clerk)** uses ElevenLabs (`eleven_turbo_v2_5`), with one premade voice chosen by the audio
  builder that is not Hijinks' George. Lines are generated only through `tools/narrate.ts`, which uses the existing
  capped-ledger pattern: the key is read from `output/secrets/elevenlabs.key` and never printed, and spend is recorded
  in `output/secrets/el-ledger.json`.
  - `src/narration.ts` exports `LINES: Record<string, string>` with an entry for every `LineId` in `types.ts`. It may
    add variants `<id>.2` and `<id>.3`. The total budget is 1,500 characters.
  - `src/vo-manifest.ts` is generated and exports `VO: Record<string, number>`, mapping a recorded id to its length in
    ms. Recorded ids include `card.<id>` when card recordings exist.
- **Card read-aloud:** stock cards use a recording when one is present. Generating `card.<id>` recordings for the deck
  (about 330 cards, roughly 15k characters) is optional and needs the coordinator's approval of a dry-run cost first.
  Without recordings, and always for write-ins, `sayCard` uses the browser's `speechSynthesis` with the best English
  voice. With `readAloud` off, no card cues are emitted.
- **SFX** (`SFX_IDS`) are files at `public/games/trolley-court/sfx/<id>.mp3`. They are original, synthesised or
  generated under a cap, and may be adapted from this repo's own Hijinks library. Every effect is cartoonish, with no
  realistic screams or impacts on people.
- Music is reserved for the user, so there are no music beds in v1. `AudioView` should keep a single bus where a bed
  can be added later.

## Files and ownership (parallel builders)

| Owner | Files | Contract |
|---|---|---|
| Designer / contract owner | `DESIGN.md`, `src/types.ts`, `src/manifest.ts` | Changes go through the contract owner, and builders request them rather than editing. |
| Deck builder | `src/deck.server.ts` | `INNOCENT`, `GUILTY`, `MODIFIERS` as specified above. Imports only `types.ts`. |
| Rules builder | `src/server.ts`, `src/bot.ts`, `tests/` | See "Server", "Bot" and "Tests" below. |
| UI builder | `src/client.tsx`, `src/display.tsx`, `src/phone.tsx`, `src/cards.tsx`, `src/styles.css`, `public/games/trolley-court/art/` | See "Client" below. CSS is scoped under `.tc` with a `tc-` prefix. Art is original SVG or webp. |
| Audio builder | `src/audio.tsx`, `src/narration.ts`, `src/vo-manifest.ts`, `tools/`, `public/games/trolley-court/{sfx,vo}/` | Implements the API above. `tools/` may import `deck.server.ts` (Node only). |
| Platform / integration owner | `apps/party-server/src/registry.ts`, `apps/party-client/src/registry.ts`, catalog/launcher art | Server entry: `{ manifest, rules, actionLimits: { perPlayer: 1024, maxBytes: 1024, history: 'window' } }`. Client lazy entry: `import('…/trolley-court/src/client').then(m => m.client)`. |

`README.md` and `QA.md` are written by whoever runs acceptance at the end.

- **Server** (`src/server.ts`) exports `type State`, `rules: GameRules<State, Input, Action, Settings, PublicView,
  PrivateView>` and `export default rules`.
  - It imports `deck.server.ts` and `types.ts` and never imports client files.
  - `validateSettings` is `parseSettings`. `create` requires 3–10 unique players and a finite `nowMs`, and starts
    round 1 at `deal`.
  - `parseInput` accepts only `null`, and `neutralInput()` returns `null`.
  - `parseAction` strictly validates the `Action` union: it rejects unknown kinds or fields, accepts only string ids up
    to 32 characters and integer `slot`/`step` values, and caps `text` at 60 characters and `target` at the valid shape.
  - Time is monotonic, as in Ichi's `clock`. All randomness comes from the seeded RNG in state. `tick` advances
    deadlines and steps. `onPresenceChange` applies the disconnect rules.
  - `outcome` follows the "Scoring, ties and outcome" section, and `dispose` does nothing.
- **Bot** (`src/bot.ts`, tests and QA only) exports `botAction(view: PublicView, mine: PrivateView, playerId: PlayerId,
  random: () => number): Action | null`.
  - In pick phases it proposes, then locks a random legal card. A blank is written as "A suspiciously calm robot"
    (cut to fit). A twist gets a random target.
  - As Conductor it waits `floorMinMs` before sending `next`, then sends `decide` with a random pull.
  - It returns `null` when there is nothing to do.
- **Client** (`src/client.tsx`) exports `client: GameClientModule<Input, Action, Settings, PublicView, PrivateView>`
  and `export default client`, with:
  - `DisplayView` (from `display.tsx`) and `ControllerView` (from `phone.tsx`);
  - `SettingsView`, which uses `options` and `toggles` with shared `ToggleRow` and selects (`settingsWide: true`);
  - `InstructionsView` for both roles, in about 5 bullets;
  - `ResultsView`, a fewest-deaths podium with joint winners, a table of deaths, spared and conducted counts, and a
    compact per-round history of struck tracks and pulled or not;
  - `AudioView` from `audio.tsx`;
  - `prepare`, which decodes art from `assetBase` and waits two frames;
  - `dispose`, which calls `disposeAudio()`.
- **Tests** (`tests/*.test.ts`, run with `node --import tsx --test packages/games/trolley-court/tests/*.test.ts`):
  - settings defaults, merging and rejection;
  - `seatTeams` and round counts for 3–10 players; every player conducts equally;
  - deck constraints;
  - the full phase order with controlled time;
  - reveal beats, `step` and `spotlight`;
  - propose, lock, first-lock-wins, cross-slot reuse, blank and target validation; actions from the Conductor or the
    other team are rejected;
  - stale, duplicate and out-of-phase actions, each leaving the state unchanged;
  - auto-pick order (most proposed → earliest → random);
  - early advance (`settleMs`/`minPickMs`) and a disconnected team;
  - Conductor away and lever timeout with and without a lean;
  - scoring, ties and outcome rows;
  - deck reshuffle, the family filter, Underdog and Accomplices slot counts;
  - privacy, using `assertSerializable` and a search for unrevealed ids and text;
  - full bot games at 3 and 10 players reaching `complete`.
