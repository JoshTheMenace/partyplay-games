# Trolley Court — design and build contract

Trolley Court (`id: trolley-court`) is an original party game about the trolley problem, built on the mechanics of a published
argue-and-judge card game. Each round ("case"), one player is the **Conductor**. The others split into two teams, **North**
and **South**, and each team owns one branch of a split track. The teams load the tracks with people and things worth
saving (**Innocents**) and worth flattening (**Guilty**), then pile on **Twists** (modifiers). They argue their case out
loud, and the Conductor decides whether to pull the lever. Everyone on the struck track gains a death. Fewest deaths wins.
A room of more than ten is a **crowd**: three counsel a side argue each case and everyone else is the **Gallery**, who
choose which track to stand on (see "Big rooms").

The game uses the shared room runtime. A watching TV runs `DisplayView`, the phones are portrait controllers
(`ControllerView`), and the lobby, readiness, reconnect and results shell are shared. The title, card text, art, narrator
("the Clerk"), names and sounds are all original. Never reproduce the published game's title, logo, art, mascots or card
text. The UI may use the generic terms Conductor, Innocent, Guilty and Twist.

Theme: a courtroom held at a railway junction. The Conductor is "Your Honour" and wears a conductor's cap with a judge's
wig. The teams are counsel. The Clerk is a dry, unflappable court clerk who narrates on the TV. Colours: North `--kp-sky`,
South `--kp-coral`, Conductor `--kp-sun`. Seat colours are kept on every name chip.

## Roster, roles and rounds

- Manifest: 3–64 players (`MAX_ROOM_PLAYERS`), `shared-display`, `turn-based`, `input: ['action']`, private views on, no
  solo play, portrait controller, and a `snapshotCache` (see "Privacy and projections"). The watching host takes no seat.
  The roster is fixed for the game, because the platform seats newcomers only in the next round (Play again).
- Everything in this section up to "Big rooms" describes 3–10 players (`COSY`); a crowd keeps all of it except who sits
  where and how many cases are played.
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

## Big rooms (11–64 players)

`isCrowd(n)` is `n > COSY` (10). Thirty people cannot share one hand or all argue, so a crowd changes who does what, and
nothing else: the phases, cards, timers and the lever are the same. Rooms of ten or fewer never see any of this.

- **The bench.** Each case seats a Conductor and `COUNSEL` = 3 counsel a side (`bench()` in `server.ts`). The lever goes
  to whoever has conducted least and, among those, has died most (ties by lot): the most-flattened seat gets the one safe
  chair, which also evens out the round a Conductor sits out. The six counsel are the seats that have spent the fewest
  cases on the bench (`State.turns`), ties by lot, then split by lot. Counsel play exactly as teams do in a small room:
  shared hand, propose, first lock wins, one twist a team (three with Accomplices), and they plead out loud.
- **Cases.** `roundCount(n, laps)`: 8 with `auto`, or `ceil(n / 7)` when that is more (9 from 57 players, 10 at 64), so
  every seat reaches the bench at least once; 6 with `laps: 1`, 12 with `laps: 2`. Nobody conducts twice.
- **The Gallery** is everyone else (`n − 7` seats). Their game is the trolley problem itself:
  - **Stand.** From the first pick until the lever window opens (`standOpen`), a Gallery member stands on North or South
    (`stand {side}`) and may hop as often as they like. The TV lines them up along the track and shows the head count on
    each plate, so the Conductor is looking at real people on real tracks. When `lever` begins, feet are glued: anyone who
    never chose is shoved onto the emptier track by the Clerk (ties by lot; `JuryView.shoved`). Everyone standing on the
    struck track gets a death with its counsel; everyone else but the Conductor is spared. A disconnected seat stays where
    it stood, or is shoved like any other.
  - **The Gallery's twist.** Each case deals the Gallery three twists (the same three on every Gallery phone, never on
    the TV or a counsel phone). During `guilty` each seat votes for one (`vote {cardId}`); the most-voted wins, ties by
    lot. During `modifier` each seat votes for the card it lands on (`aim {target}`). It is revealed last, as a twist
    `from: 'gallery'`. With no votes at all the Clerk picks and it is marked `auto`. A new vote replaces the old one.
  - A crowd's `guilty` and `modifier` picks stay open for at least `juryMs` (12 s) even if counsel lock at once, so the
    ballot is never cut short. Counsel locks still end the phase; the Gallery never holds it open.
- **Underdog** counts counsel only (the Gallery plays no cards).
- **What every phone has to do:** counsel pick and plead; the Gallery stands (innocent), votes (guilty), aims
  (modifier), hops and heckles (plead), heckles (lever); the Conductor may lean the lever from the first pick on. The
  only stretches with nothing to tap are the reveal beats, the crash and the next deal.

| Players | Cases (auto) | Gallery | Seats that never reach the bench |
|---|---|---|---|
| 11 | 8 | 4 | 0 |
| 32 | 8 | 25 | 0 |
| 56 | 8 | 49 | 0 |
| 64 | 10 | 57 | 0 |

**Heckles** work at every size: during `plead` and `lever` anyone but the Conductor may `shout` one of `SHOUTS` (Hear,
hear! / Objection! / Boo! / Mercy!), at most once per `shoutMs`. The TV floats them up from the heckler's plate or track.

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
| `laps` | `'auto'`, 1, 2 | `'auto'` | conductor laps (auto: 2 laps with 3–4 players, else 1); a crowd plays 8+ / 6 / 12 cases |
| `pickSeconds` | 30/50/75/90 | 50 | Innocent and Guilty pick timers |
| `modifierSeconds` | 45/75/90/120 | 75 | Twist pick timer |
| `floorSeconds` | 30/50/75/90 | 50 | each team's floor |
| `leverSeconds` | 15/30/45/60 | 30 | the Conductor's decision window |
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
server rejects stale ids ("Too late — the court has moved on."). `lean`, `stand` and `shout` stay legal across phases, so
they may carry `courtIdFor(round)` (`"3.court"`) instead and survive a phase change mid-tap. Beat-based phases advance
`step` within the phase. The phone and TV time everything from `deadline`, `step` and `startedAt`, and never from local
timers alone.

| Phase | Length | What happens | Accepted actions | Cues |
|---|---|---|---|---|
| `deal` | `dealMs` (+`welcomeMs` in round 1) intro beat, then one `revealMs` beat per track (`steps` = 3) | New Conductor, teams, `underdogs` and `defaultSide` are set; hands are dealt privately. Step 1 reveals North slot 0 (random Innocent), step 2 South slot 0. | none | line `welcome` (round 1) or `round` / `final-round`; line `heading.<defaultSide>`; sfx `deal`; per beat sfx `flip` + `card` |
| `innocent` | `pickSeconds` | Each team locks one Innocent for its own slot 1. Picks stay hidden; only `progress` is public. Crowd: the Gallery starts to stand. | `propose`, `lock`; `lean`; crowd `stand` | line `pick.innocent` (crowd: then `gallery.stand`); sfx `lock` per lock; `all-locked`; `hurry` sfx+line at `hurryMs` left; `timeup` if any counsel auto-pick |
| `innocentReveal` | `introMs` + one beat per card (`steps` = 3) | North slot 1, then South slot 1, flip face-up. | none | line `reveal.innocent`; sfx `flip` + `card` per beat |
| `guilty` | `pickSeconds` | Each team locks one Guilty for the **opponent's** slot 2. Crowd: the Gallery votes for its twist. | `propose`, `lock`; `lean`; crowd `stand`, `vote` | as `innocent` with `pick.guilty` (crowd: `gallery.vote`) |
| `guiltyReveal` | `introMs` + 2 beats | North slot 2 (South's Guilty), then South slot 2 (North's). | none | line `reveal.guilty`; sfx `drumroll` (intro), `reveal` + `card` |
| `modifier` | `modifierSeconds` | Each team locks one twist per slot, each with a target card (`Target = {side, slot}`). One card fills at most one slot. Crowd: the Gallery aims its twist. | `propose`, `lock`; `lean`; crowd `stand`, `aim` | as above with `pick.modifier` (crowd: `gallery.aim`) |
| `modifierReveal` | `introMs` + one beat per twist | Twists attach one at a time, interleaved North 0, South 0, North 1, South 1 … and then the rest; the Gallery's twist comes last. `spotlight` = target + `mod` index. | `lean`; crowd `stand` | line `reveal.modifier`; sfx `stamp` + `card` per twist |
| `plead` | two floors × `floorSeconds` (`steps` = 2) | Floor 0 goes to the team **in the trolley's path** (`defaultSide`), floor 1 to the other team. Arguing happens out loud. The Conductor may `lean` the lever live (shown on the TV) and may tap **Next** once a floor has run `floorMinMs`. | `lean`, `next` (Conductor); `shout` (anyone else); crowd `stand` | line `floor.<side>` + sfx `gavel` per floor |
| `lever` | `leverSeconds` | Open floor: everyone shouts while the Conductor decides. Crowd: `glue()` places the undecided and nobody hops again. **PULL** diverts to `opposite(defaultSide)`; **DO NOTHING** keeps `defaultSide`. On timeout the lever stays where it is, and `timedOut` is set. | `lean`, `decide` (Conductor); `shout` | line `lever` (crowd: then `gallery.glue`); sfx `tick` in the last 5 s; line `pull` / `nothing` / `dither` at the decision |
| `crash` | `crashMs` (`lastCrashMs` in the final round) | `struck` is set. Everyone on the struck track (its team and, in a crowd, the Gallery standing there) gets `deaths +1`, everyone else but the Conductor gets `spared +1`, and the Conductor gets `conducted +1`. A `RoundRecord` is appended (`victims` are seat indexes). The TV plays the verdict stamp and the trolley run (`CRASH` in `types.ts` times both picture and sound). | none | sfx `lever` (if pulled), `gavel`, `bell`, `rumble`, `crash`, `gasp`/`aww`; line `struck` |
| `complete` | — | Every player tied for the fewest deaths is a winner. `outcome().complete` is true. | none | line `end` or `tie` |

- **The live lever:** the Conductor may `lean` from the first pick until the decision (`leverOpen`), so the room can read
  the bench while the tracks fill. A lean changes only `PublicView.lever`: it emits no cue (the TV's mixer hears the
  lever move from the view) and does not touch the cached fields, so it costs every phone a few hundred bytes.
- **Reveal beats:** each beat lasts `revealMs(card.text, settings.readAloud)`. With read-aloud on, a beat is 2.6–6.5 s,
  long enough for the card to be read. With it off, a beat is 2.2 s. During a reveal, `step` advances one beat at a time.
  The card revealed at a step is added to `tracks` at that step, never earlier.
- **Early advance:** a pick phase ends early once every slot of every team that has at least one connected member is
  locked. Its deadline becomes `max(lastLock + settleMs, startedAt + minPickMs)`, giving a readable "All locked" moment
  (`juryMs` replaces `minPickMs` in a crowd's `guilty` and `modifier`).
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
  connected or not. The Conductor never scores. There is no other scoring. In a crowd "the struck team" is everyone on
  the struck track: its three counsel and the Gallery standing there.
- Winners are every player tied for the fewest deaths, a shared win with no tie-breaker. On the results screen, rank is
  `1 + (number of players with fewer deaths)`.
- `outcome()` returns `{ complete, winners, rows }`. While the game is in progress, `complete` is false and `winners` is
  `[]`. Each row is `{ playerId, score: deaths, rank, label }`. The label reads `"<d> death(s) · spared <s>"`, for example
  `"2 deaths · spared 4"`. Rows are sorted by rank, then by seat.

## Privacy and projections

- **Public** (`PublicView`): revealed track cards and twists only, plus `progress` counts, phase, deadline, step,
  `spotlight`, lever position, teams, `underdogs`, players with deaths, history, cues and settings. Locked or proposed
  picks, hands and unrevealed write-in text are never public. Twists enter `tracks` only on their reveal beat. Crowd:
  `gallery` (one character per seat: `-` on the bench, `?` undecided, `n`/`s` standing), `ballots` (how many have voted
  this phase, never what for) and `shouts` (the last eight heckles as `[seq, seat, kind]`).
- **Private** (`PrivateView`): for a team member, the team's hands and current slots, including teammates' proposals
  and locks. The Conductor gets `role: 'conductor'`, `side: null`, empty hands and `slots: []`. Hands of a kind empty
  once that kind's phase ends. A Gallery member gets `role: 'gallery'`, `side` = the track they stand on, no hands, and
  `jury` (`JuryView`): the three ballot twists and tallies during `guilty`, the chosen twist until it is revealed, their
  aim and the aim tallies during `modifier`. The ballot never appears in the public view or on a counsel or Conductor
  phone, and no hand ever appears on a Gallery phone.
- **Wire cost.** The room sends every snapshot at 10 Hz and again after every action, so the manifest declares
  `snapshotCache: { revisionField: 'rev', fields: CACHED }`. `players`, `tracks`, `history`, `cues`, `settings`,
  `underdogs` and `winners` travel only when `rev` changes; `rev` is bumped in `begin`, `reveal`, `cue` and on presence
  changes, which is every place those fields change (a test replays whole games through the real encoder and decoder to
  prove it). What is left per snapshot is about 0.5 KB public plus the private view (0.2–0.45 KB for the Gallery, up
  to 1.2 KB for counsel holding hands, 2.2 KB with Accomplices at ten players). Leans, stands, votes, aims and heckles
  change only uncached fields. `history` stores victims as seat indexes: 64 players' ids would not fit a message. The
  largest message is the 64-player results snapshot: about 25 KB with the platform's outcome rows, 28 KB if every seat
  were a joint winner, inside the 32 KiB cap. While the results screen is up the platform attaches those outcome rows
  (9 KB at 64 seats) to every snapshot, which is the busiest traffic of the night.
- Views are explicit projections. Optional fields are omitted, never set to `undefined`. Tests run `assertSerializable`
  on every phase. They also assert that the serialized public view contains no unrevealed card id or text, and that a
  player view never contains the other team's hands.
- Client code (`client.tsx`, `display.tsx`, `phone.tsx`, `cards.tsx`, `audio.tsx`) imports `types.ts`, `manifest.ts`,
  `narration.ts` and `vo-manifest.ts` only. It never imports `server.ts`, `deck.server.ts` or `bot.ts`.

## TV layout (DisplayView, 1920×1080 stage scaled to fit)

- **Top bar:** "Case 4 of 9", the phase banner ("Counsel: tie an Innocent to your own track", "North has the floor", …)
  with the **Clerk's caption** under it, the Conductor's chip ("Your Honour: <name>") and the shared `Countdown` against
  `deadline`. The caption prints every Clerk line while it is spoken (`clerkLine` in `cards.tsx`: lines run one after
  another, each for its recording's length or a reading time), so the narration survives a muted TV or a loud room.
- **Left third: the junction.** The trolley idles on the single track (it revs during `lever`), the switch signal's lit
  lamp and the gold rails show where it is heading, and the Conductor's avatar stands at the lever with eyes on the
  heading. The lever follows `lever.pulled` live from the first pick on. A "DEFAULT" tag marks `defaultSide`. The
  Clerk's board above shows the phase title, pick progress (in a crowd also "Gallery 14/25 standing / voted / aimed")
  and the big floor or lever clock.
- **Right two-thirds: two tracks,** North on top and South below, with rails running behind the cards. Each row has:
  - a team plate: team name, counsel chips (seat colour, name up to 16 characters, skull pips for deaths, an
    "Underdog" badge when it applies), the "IN THE PATH" tag on `defaultSide`, and in a crowd the **head count**
    ("17 on this track · 3 counsel + 14 standing");
  - three card slots, labelled "Bystander", "North's pick" and "Planted by South". Card faces carry their figure
    twice: small in the header and large and faint in the corner. An empty slot is a dashed outline; a hidden locked
    pick is dealt in face-down and stamped "LOCKED"; a revealed card flips face-up;
  - twists, pinned under their target card as tags in the author's colour (N, S, or gold G for the Gallery). At most
    three are visible per card (one size smaller when there are three); beyond that two cycle with a "+N more" chip.
    The layout stays readable at 11 twists;
  - in a crowd, the **band** along the bottom edge: one seat-coloured dot with an initial for every Gallery member
    standing on that track (up to 57; they overlap evenly when there are many, and hop in when someone changes track).
- **Reveal showcase:** the card being revealed (or a twist with the card it lands on) flies out of its slot, sits big
  and centre stage for the beat with its author ("by Sam", "from the deck", "voted in by the Gallery"), then flies back.
  The slot keeps a gold ring meanwhile.
- **Plead:** the speaking team's track glows with a "HAS THE FLOOR" tag, and the other track darkens (brightness, not
  opacity, so rails never show through cards). In `lever`, both tracks are lit and the hot rails pulse.
- **Heckles** float up as speech bubbles with the heckler's name: from the team plate for counsel, from the track for
  the Gallery standing on it. At most ten are on screen, six (smaller, low on the track) in a crowd.
- **Verdict (`crash`, 9.5 s, `CRASH` timings):** the ruling is stamped across a darkened stage with a gavel
  ("YOUR HONOUR MIKA · PULLS THE LEVER! · The trolley takes SOUTH, with 17 on the track") and the stage shakes. At 1.7 s
  the trolley winds up and runs the struck track: each card is knocked flat in turn with a comic burst, tread marks, a
  "STRUCK" stamp and another shake, and each Gallery dot on that track is flattened as the trolley passes it. At 4.7 s
  the spared track gets a "SPARED" ribbon, confetti and cheering dots. At 5.4 s the death tally ticks up (falling skulls
  up to ten players; the struck plate's head count turns red in a crowd). Nothing is gory. Animations are offset by time
  already elapsed, so a reload mid-crash stays in sync, and every one of them collapses under reduced motion.
- **Bottom strip:** up to ten players, the death tally for every seat (colour chip, name, skull count, a cap for the
  Conductor). In a crowd: the Gallery members still deciding (dots), then who has the fewest and the most deaths (names
  and "+N more"); the numbers move only once the trolley has passed.
- Checked at 1280×720 and 1920×1080, with 10 and 64 players, 16-character names, 70-character cards, 60-character
  twists and write-ins, and the maximum number of twists on one card.

## Phone layouts (ControllerView, portrait first; also short landscape)

Every screen has a header showing the role chip ("NORTH · with Sam, Ana" / "CONDUCTOR" / "GALLERY · on South"), the
case and phase, and a `Countdown`. Controls are at least 48px, card text at least 16px, and states (draft, pending,
locked, time up, reconnecting) are always explicit.

**Team member (counsel)**

- **`deal` and reveal phases:** "Watch the TV" with a compact two-row track map below, showing revealed cards and the
  team's own track highlighted. Under it, the team's three hands are collapsible and grouped by kind, with the next
  kind open, so the team can plan quietly.
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
- **`plead`:** on your floor, "YOUR FLOOR — argue out loud!"; otherwise "<TEAM> has the floor". Below it the **heckle
  bar** (four buttons, rested for `shoutMs` after a tap), a live lever indicator and both tracks in full.
- **`lever`:** "Shout now!" with the heckle bar and the live lever indicator.
- **`crash`:** "SPARED" (team colour) or "STRUCK — +1 death" with your new death total.

**Gallery member (crowd only)**

- One task a phase, always at the top: "Pick a track" (`innocent`), the three-card ballot with live vote counts
  (`guilty`), the chosen twist and a six-card target map with vote counts (`modifier`), "<TEAM> has the floor" (`plead`),
  "Shout now!" (`lever`). During reveals: "Watch the TV" and the Gallery's chosen twist, which only they can see.
- **Stand bar** from the first pick: two large buttons, "You're standing on NORTH · 14 heads" and "Hop to SOUTH · 9
  heads", with "Trolley heading here" on the hot one. Disabled, with "Feet are glued", once the lever opens.
- The heckle bar during `plead` and `lever`, then both tracks with their head counts. `crash` shows "Struck!" or
  "Spared!" for the track they stood on.

**Conductor**

- **Building phases:** "You're the Conductor", lock progress, the lever switch (live from the first pick), and a
  read-only view of both tracks filling in. The Conductor never sees hands, proposals or the Gallery's ballot.
- **`plead`:** a large lever control (a toggle of at least 120px with `role="switch"` and the label "Trolley heading:
  SOUTH") sends `lean`. A **Next speaker ▶** button is enabled after `floorMinMs` and sends `next {step}`. Both full
  tracks with twists are shown for reference and scroll as needed; in a crowd the head count on each track sits above.
- **`lever`:** two big press-and-hold buttons (1 s, with a progress fill; keyboard: hold Enter or Space). **PULL THE
  LEVER → hits <opposite>** and **DO NOTHING → hits <default>** each send `decide {pull}`. The lever toggle stays
  visible. After a decision the screen shows "Verdict delivered".

**Results (`ResultsView`).** Up to ten players: a fewest-deaths podium with joint winners, a table of deaths, spared
and conducted counts, and the case history. A crowd gets the podium (ten winners named, then "+N more"), "You finished
#12 with 3 deaths" on phones, the standings as a wall of one-line rows (three or four columns on the TV, sized to keep
**Play again** on screen at 1280×720 with 64 seats) and a history that counts the flattened instead of naming them.

## Audio (host display only)

`audio.tsx` exports:

```ts
export function AudioView(props: GameAudioProps<PublicView>): null; // GameClientModule.AudioView; active only when isHost && viewRole === 'display'
export function cue(id: SfxId, gain?: number): void;                // play one effect now on this device (phone tap / local feedback)
export function sayLine(id: LineId): void;                          // queue a Clerk line if it has a recording, ducking music
export function sayCard(card: Card): void;                          // queue a card read-aloud: recording `card.<id>` if present, else speech synthesis
export function disposeAudio(): void;                               // stop speech, close contexts (client.dispose calls it)
```

- **Server cues drive the TV.** The server appends `Cue`s to `PublicView.cues` (last `CUE_LIMIT`, with `seq` rising
  for the whole game) as listed in the phase table. `AudioView` plays each cue once, drops cues more than about 4 s
  old, and plays narration in a queue that ducks other sound. A `card` cue's id refers to a card visible in
  `tracks`, and the mixer looks the card up there and calls `sayCard`. Display and phone views never call `sayLine` or
  `sayCard` for these moments. Phones may call `cue('tap' | 'lock' | 'lever')` for local feedback; it respects the
  shared mute.
- **Heard from the view, not cued:** a lever lean (`lever` sfx when `lever.pulled` changes outside `deal` and `crash`)
  and heckles (`cheer`, `gasp` or `aww`, quietly and rate-limited). Neither bumps `rev`.
- **Captions.** A `line` cue picks its variant by `seq` (`lineVariant`), so the caption on the TV and the recording the
  mixer plays are the same line. A line with no recording is a caption only: the mixer never falls back to speech
  synthesis for the Clerk's own lines. The four `gallery.*` lines are unrecorded today.
- **The narrator (the Clerk)** uses ElevenLabs (`eleven_turbo_v2_5`), with one premade voice chosen by the audio
  builder that is not Hijinks' George. Lines are generated only through `tools/narrate.ts`, which uses the existing
  capped-ledger pattern: the key is read from `output/secrets/elevenlabs.key` and never printed, and spend is recorded
  in `output/secrets/el-ledger.json`.
  - `src/narration.ts` exports `LINES: Record<string, string>` with an entry for every `LineId` in `types.ts`. It may
    add variants `<id>.2` and `<id>.3`. The total budget is 1,750 characters (1,666 used).
  - `src/vo-manifest.ts` is generated and exports `VO: Record<string, number>`, mapping a recorded id to its length in
    ms. Recorded ids include `card.<id>` when card recordings exist.
- **Card read-aloud:** stock cards use a recording when one is present. The first 491 cards are recorded; the 139 added
  in 2026-11 (`i174`–`i219`, `g173`–`g219`, `m146`–`m191`, about 6,500 characters) are not, and neither are the four
  `gallery.*` lines. Recording them needs the owner's approval of a dry-run cost first. Without recordings, and always
  for write-ins, `sayCard` uses the browser's `speechSynthesis` with the best English voice. With `readAloud` off, no
  card cues are emitted.
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
| QA | `tools/qa-driver.ts`, `tools/sandbox.ts`, `tools/sandbox-page.tsx` | The live driver (3–64 seats) and the render sandbox: fixtures from the real rules for every phase and roster, bundled with esbuild, for layout work without a room. Node only. |
| Platform / integration owner | `apps/party-server/src/registry.ts`, `apps/party-client/src/registry.ts`, catalog/launcher art | Server entry: `{ manifest, rules, actionLimits: { perPlayer: 1024, maxBytes: 1024, history: 'window' } }`. Client lazy entry: `import('…/trolley-court/src/client').then(m => m.client)`. |

`README.md` and `QA.md` are written by whoever runs acceptance at the end.

- **Server** (`src/server.ts`) exports `type State`, `rules: GameRules<State, Input, Action, Settings, PublicView,
  PrivateView>` and `export default rules`.
  - It imports `deck.server.ts` and `types.ts` and never imports client files.
  - `validateSettings` is `parseSettings`. `create` requires 3–64 unique players (the manifest's range) and a finite
    `nowMs`, and starts round 1 at `deal`.
  - `parseInput` accepts only `null`, and `neutralInput()` returns `null`.
  - `parseAction` strictly validates the `Action` union (`propose`, `lock`, `lean`, `next`, `decide`, `stand`, `vote`,
    `aim`, `shout`): it rejects unknown kinds or fields, accepts only string ids up to 32 characters and integer
    `slot`/`step` values, and caps `text` at 60 characters and `target` at the valid shape.
  - Time is monotonic, as in Ichi's `clock`. All randomness comes from the seeded RNG in state. `tick` advances
    deadlines and steps. `onPresenceChange` applies the disconnect rules.
  - `outcome` follows the "Scoring, ties and outcome" section, and `dispose` does nothing.
- **Bot** (`src/bot.ts`, tests and QA only) exports `botAction(view: PublicView, mine: PrivateView, playerId: PlayerId,
  random: () => number): Action | null`.
  - In pick phases it proposes, then locks a random legal card. A blank is written as "A suspiciously calm robot"
    (cut to fit). A twist gets a random target.
  - As Conductor it waits `floorMinMs` before sending `next`, then sends `decide` with a random pull.
  - In the Gallery it votes, aims, takes a track and now and then hops during the pleas.
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
  - full bot games at 3 and 10 players reaching `complete`;
  - `crowd.test.ts`: case counts, the bench at 11, 32 and 64 (nobody conducts twice, every seat reaches the bench),
    the lever going to the most-flattened seat, standing, hopping, glue and scoring, the Gallery's ballot and its
    privacy, `juryMs`, heckles and their throttle, whole games replayed through the real snapshot encoder and decoder,
    the size of a 64-player night on the wire, full bot nights at 11, 32 and 64, and a 32-player night with no input.
  `tests/harness.ts` holds the shared game driver and the projection checks (`check`) both files use.
