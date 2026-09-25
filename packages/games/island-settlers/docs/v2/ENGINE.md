# Island Settlers v2: engine design

Status: authoritative design for the v2 rewrite. `src/model.ts` (wire contract) and `src/geometry.ts`
(hex math) are the compiled companions of this document. Where this document and `model.ts`
disagree, `model.ts` wins and this document gets fixed.

Legacy code (for reference only) lives in `output/settlers-v2/legacy/`. "Port" below means: keep the
rule semantics of the named legacy function, rewrite it readably against the v2 state.

## 0. Principles

1. **One state machine, one interruption model.** The game is a small set of *stages* (setup, roll,
   main, paired, round, finale, ended) plus a queue of *effects* and a set of open *prompts*. Nothing else
   stores "where to go back to".
2. **Only wait for the people who must act.** Prompts are per-seat and simultaneous. A disconnect
   or an idle player only delays the table when that seat owes a decision, and never past a
   deadline.
3. **The core never names an expansion.** Core code reads a `Profile` (rule switches) and calls
   hooks from a typed module registry. No `s.modules?.x` checks, no string-prefix dispatch.
4. **The board is immutable after `create`.** Hidden hexes are revealed through `pieces.reveals`;
   scenario features are generated with the board.
5. **Server-authored legality.** Phones and CPUs choose from the same legal lists, costs and
   "why not" reasons that the validator uses.
6. **Readable code.** Files under ~300 lines, lines under ~110 characters, one concept per file.

## 1. File layout

All paths are under `packages/games/island-settlers/`. Browser-safe files may be imported by the
client at runtime; server-only files must never be (the client may use `import type` only).

### Entry points and shared (browser-safe)

| File | Purpose |
| --- | --- |
| `src/manifest.ts` | Standalone `GameManifest` (same id, portrait, turn-based, snapshotCache on `mapRev`). |
| `src/server.ts` | Thin `GameRules` adapter over `engine/`; wires the CPU scheduler into `tick`. Exports `rules` + default. |
| `src/client.tsx` | `GameClientModule` wiring for `ui/`. Exports `client` + default. |
| `src/model.ts` | Wire contract: settings, board, pieces, actions, events, views, commands, results. |
| `src/geometry.ts` | Pointy-top axial hex math, token and footprint sizes, pips. |
| `src/settings.ts` | `validateSettings`, combination restrictions with reasons, suggested/max targets. Shared by the SettingsView and the server. |
| `src/music.ts`, `src/audio.tsx` | Kept from legacy unchanged. |

### Engine (server-only, `src/engine/`)

| File | Purpose |
| --- | --- |
| `index.ts` | Public engine API: `createGame`, `applyAction`, `tick`, `presence`, `publicView`, `privateView`, `outcome`. |
| `state.ts` | `State`, `Seat`, `Effect`, `OpenPrompt`, `OpenOffer` types; `createState`. |
| `profile.ts` | `Profile` type and `buildProfile(settings, modules)`. |
| `rng.ts` | Seeded streams (splitmix32 seeding, sfc32 generator), `shuffle`, `pick`, dice (plain and balanced deck). |
| `cards.ts` | Card math on full `Record<Good, number>` hands: `add`, `has`, `total`, atomic `transfer`, sparse `toCards`. |
| `need.ts` | `need(cond, reason)` assertion with player-readable messages (port legacy `need`). |
| `parse.ts` | `parseAction`: shape, id lengths (≤80), card counts (≤200), byte budget. |
| `board/index.ts` | `makeBoard(settings, seatCount, rng, modules)`: layout → terrain → numbers → ports → module decorations → graph. |
| `board/layouts.ts` | Base land shapes (3–4 / 5–6 / 7–10) and the shared seeded island-growth helper. |
| `board/graph.ts` | Vertices/edges from tiles by corner-key merge (port legacy), coast flags, bounds. |
| `board/terrain.ts` | Terrain mixes per size and the clustered-terrain check. |
| `board/numbers.ts` | Constrained number placement with scored retries. |
| `board/ports.ts` | Perimeter walk and evenly spaced port slots. |
| `board/lookup.ts` | `BoardIndex` (id maps, adjacency, vertex neighbours, coast order) cached in a `WeakMap<Board, …>`. |
| `pieces.ts` | The only functions that mutate `pieces` (`placeBuilding`, `placeRoute`, `moveUnit`, `reveal`, …); each sets `mapDirty`. |
| `flow.ts` | Stage machine: setup order, `beginOpportunity`, paired turns, Connect rounds, `advance()` resolve loop. |
| `effects.ts` | `Effect` handlers for core effects (`roll`, `produce`, `seven`, `robber`, `end-opportunity`, `end-round`). |
| `prompts.ts` | Open/answer/expire prompts; the core prompt specs (`discard`, `robber`, `gold`). |
| `clock.ts` | Deadlines from timer presets, disconnect grace, away handling, deadline expiry in `tick`. |
| `auto.ts` | Deterministic, always-legal auto-actions for every timed step and prompt. |
| `actions.ts` | `applyAction` dispatcher: turnId check, per-type handler, post-commit invariants. |
| `build.ts` | Build/upgrade/move-ship handlers; setup placements; free routes. |
| `legal.ts` | Legal targets and `Why` reasons: settlement, road, ship, city, ship moves, robber hexes, victims. |
| `trade.ts` | Offers, responses, counters, confirmation, invalidation, expiry, bank trades, `rates`. |
| `dev.ts` | Development deck, buy/play, knight, Road Building, Year of Plenty, Monopoly. |
| `production.ts` | Grant computation with the bank-shortage rule; roll event assembly; gold owed. |
| `score.ts` | Score parts, `longestRoute` (port), awards with tie logic (port), win checks. |
| `stats.ts` | Stat accumulation hooks and `buildResults`. |
| `events.ts` | Public event ring buffer, private inbox, stable ids, text helpers. |
| `commands.ts` | `Command`/`Field` builders and `validateAnswer` (port and extend legacy `validateCommand`). |
| `project.ts` | `publicView` / `privateView` with per-revision caches; `Now` headline; `Task`. |
| `modules/registry.ts` | `Module` interface, registry order, `hooks(state, name)` runner, combined profile. |
| `modules/index.ts` | The ordered module list (one import per module). |
| `modules/seafarers/index.ts` | Ships, ship moves, pirate, gold, island bonus, fog reveal (Fog Islands). |
| `modules/seafarers/maps.ts` | New Shores, Four Islands and Fog Islands cell plans (board hook). |
| `modules/cities-knights/index.ts` | Module object: profile, hooks, projections. |
| `modules/cities-knights/progress.ts` | Progress decks, drawing, hand limit, the 54 card effects. |
| `modules/cities-knights/knights.ts` | Recruit, activate, promote, move, displace, chase robber. |
| `modules/cities-knights/barbarians.ts` | Event die, barbarian track, attack resolution, improvements, metropolises, walls. |
| `modules/fishing.ts` | Grounds, lake, fish deck, old boot, fish spending. |
| `modules/rivers.ts` | Rivers, bridges, coins, wealthiest/poorest. |
| `modules/caravans.ts` | Oasis, camels, simultaneous bid/vote, placement, route weight. |
| `modules/barbarian-attack.ts` | Castle, landings, invaders, guards, battles, prisoners. |
| `modules/deliveries.ts` | Depots, wagons, cargo, tolls, road raiders. |
| `modules/friendly-robber.ts` | Robber-hex filter for low-score seats. |
| `modules/harbormaster.ts` | Harbor points and the Harbormaster award. |
| `modules/explorers/index.ts` | Module object: profile, setup plan, hooks, projections. |
| `modules/explorers/ships.ts` | Expedition ships, movement budget, cargo, discovery. |
| `modules/explorers/missions.ts` | Land Ho!, pirate lairs, fish, spices, council, mission scoring. |
| `modules/explorers/board.ts` | Hidden region, council/lair/spice/shoal placement (board hook). |

### CPU (server-only, `src/cpu/`)

The CPU is a pure function of `PublicView`, its own `PrivateView` and its own small memory. It
imports only `model.ts` and `geometry.ts` types/helpers.

| File | Purpose |
| --- | --- |
| `index.ts` | `decide(pub, priv, brain) → { action, memory }` entry; routes by `priv.task`. |
| `personas.ts` | Named personalities and difficulty knobs. |
| `value.ts` | Resource values, spot scores (pips, diversity, ports, scarcity), victory-race estimate. |
| `setup.ts` | Paired first/second placement planning. |
| `plan.ts` | Goal selection (city, settlement, road race, dev, army, module goals) and build ordering. |
| `trade.ts` | Proposals, responses, counters, bank/port conversion. |
| `robber.ts` | Leader-aware robber, victims, knights. |
| `prompts.ts` | Per-kind prompt answers with a generic `Command` fallback. |
| `modules.ts` | Module-specific goals (C&K improvements, knights, E&P missions, wagons, fish). |

### UI (browser, `src/ui/`) — owned by UI work packages, listed here for the import boundary

`ui/shared/` (seats, emblems, layout, bridge, timeline, labels, drafts, help), `ui/scene/` (Three.js
board, tokens, pieces, highlights), `ui/display/` (TV HUD; `theatre/` = DOM dice, fly-outs, strip,
finale), `ui/results/`, `ui/map/` (SVG map), `ui/trade/`, `ui/controller/` (phone),
`ui/personal/` (seated host), `ui/sfx/`, `ui/settings.tsx`, `ui/instructions.tsx`, `ui/base.css`.
Ownership: BUILD-PLAN §1.
3D art sources are under `art/`, GLB output under `public/games/island-settlers/models/`.

## 2. State shape

`State` is plain JSON-like data plus the immutable `board`. Functions never live in state.

```ts
type State = {
  // Fixed at create. Never cloned for clone-validate-commit; never mutated.
  board: Board;
  settings: Settings;
  modules: ModuleId[];            // registry order
  profile: Profile;
  hidden: Record<TileId, Reveal>; // fog faces, server-only

  // Mutable. Everything below is cloned by applyAction's clone-validate-commit.
  rev: number;                    // bumps on every committed change
  mapRev: number;                 // bumps only when `pieces` changes (snapshotCache revision)
  mapDirty: boolean;
  serial: number;                 // event / prompt / offer / card id counter
  rng: { dice: number[]; cards: number[]; auto: number[]; cpu: number[] }; // sfc32 states
  diceDeck: [number, number][] | null;  // balanced dice
  lastTotal: number | null;

  order: SeatId[];                // seating order (humans then CPUs, shuffled once)
  seats: Record<SeatId, Seat>;
  bank: Record<Good, number>;
  devDeck: DevKind[];
  pieces: Pieces;                 // model.ts shape, public

  turn: TurnState;                // model Turn + opportunity bookkeeping
  clock: Clock | null;            // the main step deadline (model shape)
  queue: Effect[];                // pending effects, FIFO
  prompts: Record<string, OpenPrompt>;
  offers: Record<string, OpenOffer>;

  awards: Partial<Record<AwardId, SeatId | null>>;
  events: GameEvent[];            // ring buffer, VIEW_LIMITS.events
  lastRoll: RollEvent | null;
  stats: Stats;
  results: Results | null;
  startedAt: number;
  ext: Partial<Record<ModuleId, unknown>>; // module-owned state, typed by each module
};

type Seat = {
  id: SeatId; name: string; color: string; seat: number; // palette index (see above)
  cpu: { level: CpuLevel; persona: string; nextAt: number; memory: unknown; budget: number } | null;
  connected: boolean; away: boolean; autoStreak: number;
  hand: Record<Good, number>;
  dev: { id: string; kind: DevKind; boughtAt: number }[]; // boughtAt = opportunity number
  devPlayedAt: number;            // opportunity number of the last non-VP card played
  opportunity: number;            // increments at the start of each of this seat's opportunities
  knights: number;                // knights played (Largest Army)
  longestRoute: number;
  freeRoutes: number;             // Road Building / module grants
  moved: boolean;                 // made a movement command this opportunity (locks building)
  ready: boolean;                 // Connect done / Standard pre-skip of the paired turn
  inbox: PrivateEvent[];
};

type TurnState = Turn & {         // Turn from model.ts: id, stage, round, active, partner, setup
  setupPlan: SetupStep[];         // full snake order, computed at create
  setupIndex: number;
  anchor: VertexId | null;        // settlement the setup route must touch
  captain: number;                // Connect roller index
  openedAt: number;               // when the current window opened
  partnerDone: boolean;           // 7–10 concurrent paired turn finished
  opportunities: number;          // total opportunities so far (results)
};

type Effect =
  | { type: 'roll'; seat: SeatId | null }
  | { type: 'produce'; total: number }
  | { type: 'seven'; seat: SeatId | null }
  | { type: 'robber'; seat: SeatId; scope: 'table' | 'self' }
  | { type: 'end-opportunity' }
  | { type: 'end-round' }
  | { type: 'module'; module: ModuleId; name: string; data: Json };

type OpenPrompt = {
  id: string; seat: SeatId; kind: PromptKind; scope: 'table' | 'self';
  openedAt: number; deadline: number | null; turnId: number; data: Json;
};

type OpenOffer = Offer; // model shape; responses kept per seat and published as stored
```

**Seating and CPUs.** `create` seats every room player, then adds CPU seats up to
`settings.tableSize` (ids `cpu-1`…, names from personas). With more humans than `tableSize` the
table grows to fit (the platform allows 1–10 players; 1–2 humans get CPUs up to at least 3).
Every seat gets a unique palette index `seat` (0–9, `PublicSeat.seat`): a human takes
`SEAT_COLORS.indexOf(player.color)` when free, otherwise the lowest unused index; CPUs take the
remaining indices in order. `color` is `SEAT_COLORS[seat]`. The order is shuffled once with
`rng.cards`.

**RNG streams.** Four independent sfc32 streams seeded from `ctx.seed` with splitmix32:
`dice`, `cards` (deck shuffles, steals, auto discards), `auto` (tie-breaks in auto-actions) and
`cpu` (think delays, persona noise). Board generation uses a fifth, throwaway stream. Separate
streams mean CPU thinking never changes the dice, so tests and replays stay deterministic.

## 3. Stage machine

Think of the flow as a conveyor belt (the effect queue) and a set of "hold" buttons (prompts).
Effects move along the belt one at a time. A table prompt presses hold for everyone; a self prompt
only stops the person who owes it. Stage changes wait until every hold is released.

```
            ┌────────────── setup (snake) ──────────────┐
create ───▶ │ settlement → route → … → last route       │
            └─────────────┬─────────────────────────────┘
                          ▼
Standard:  roll ──▶ [produce | seven → discards → robber] ──▶ main ──▶ (paired, 5–6) ──▶ next seat
Connect:   round: captain rolls ──▶ [produce | seven …] ──▶ window (everyone) ──▶ end-round
                          │
                   any win check ──▶ finale (9 s) ──▶ ended
```

### 3.1 The resolve loop (`flow.advance`)

```
advance(s, now):
  loop:
    if any open prompt has scope 'table': return          // wait for simultaneous answers
    effect = s.queue[0]; if none: return                  // interactive stage
    if effect is a stage transition and any prompt is open: return
    shift it; run its handler (core or module); handlers may push effects or open prompts
```

`advance` runs after every committed action and every tick. Handlers are small and synchronous.
Everything a handler needs is in the effect record, so the queue survives clone-commit.

### 3.2 turnId

`turn.id` changes only when the *turn* changes: each setup placement, each opportunity (main or
paired; a concurrent 7–10 partner shares Player 1's id), and each Connect round. Every action must
echo the current id. Prompts do not change the id, so a discard or knight never invalidates other
seats' in-flight actions (fixes legacy "The turn changed"). Prompt answers are matched by prompt id
*and* the current turn id; prompts cannot outlive their turn because stage transitions wait for them.

### 3.3 Setup

- **Order.** Snake over `order`: seats 0…n−1 then n−1…0. `setupPlan` lists every step as
  `{ seat, piece, anchorRequired }`. Setup is sequential in both modes (spot contention makes a
  blind simultaneous draft unfair). Each step has the `setup` timer.
- **Base.** Round 1: settlement + road. Round 2: settlement + road; the second settlement pays
  one resource per adjacent producing hex (not gold, not desert).
- **Cities & Knights.** Round 2 places a **city** instead of a settlement; the city pays one
  *resource* per adjacent hex (no commodities).
- **Seafarers.** The route after a coastal settlement may be a road or a ship. New Shores and Fog
  Islands: setup only on the home island. Four Islands: any island; the islands you start on never
  earn the island bonus.
- **Explorers & Pirates.** Round 1: harbor settlement (2 VP) plus an expedition ship on an
  adjacent sea edge. Round 2: settlement + road, which pays the starting resources. With C&K the
  round-1 piece is a city and round 2 a harbor settlement (per the official E&P + C&K sheet). Ports
  do not exist; bank rate is 3:1 (legacy adaptation, kept).
- **Placement legality.** Distance rule (no building on a neighbouring vertex); round 2 in base
  has no connection requirement; the route must touch `anchor`. Modules filter spots
  (`legal.settlement` hook: e.g. no settling on fog, the Explorers home-region rule).
- **Auto on timeout.** Settlement: highest `pips + 2·new resource types + port bonus` legal spot;
  route: the legal edge that points toward the best open spot two steps away (`auto.ts`).
- Setup ends → Standard: the first seat's `roll`. Connect: round 1.

### 3.4 Roll and production

1. Stage `roll` for the active seat (Standard) or the captain (Connect). Before rolling, the seat
   may play one development card (Knight, Road Building, …) or a module pre-roll command
   (Alchemist). `roll` is refused while `freeRoutes > 0` from a pre-roll Road Building.
2. `roll` effect: draw dice (plain or balanced deck), then run `beforeProduce` hooks
   (C&K event die and barbarian track; deliveries' reroll-of-2/12 rule; E&P coin rules). Hooks may
   open table prompts (barbarian defeat choices); the loop waits for them.
3. `produce` effect, if total ≠ 7:
   - Every building on a hex with the number, not blocked (robber; module `blocksTile`), yields
     1 (settlement/harbor) or 2 (city). Modules adjust grants (`produce` hook: C&K cities yield
     1 resource + 1 commodity on forest/pasture/mountains; gold becomes `goldOwed`).
   - **Shortage rule (port):** per good, if the bank cannot pay every recipient in full, nobody
     gets that good, unless only one seat is owed it, in which case that seat gets what is left.
   - Grants, blocked yields and shortages go into one `RollEvent` (see §13). It also becomes
     `lastRoll`, the persistent production summary, until the next roll.
   - `afterProduce` hooks (C&K Aqueduct, E&P "no production" coin).
   - Gold owed → one `gold` table prompt per owed seat, all at once (`prompt` timer; auto takes
     the goods the seat holds fewest of, bank permitting).
4. Stage becomes `main` (Standard) or the Connect window. **The active player can act as soon as
   the roll commits**; the ~1.5 s dice and fly-out animation is presentation only, and it never
   blocks input. The TV reads `RollEvent.grants` to fly cards from each hex to each seat chip.

### 3.5 Seven: simultaneous discards, then robber or pirate

1. `seven` effect: every seat whose resource+commodity total exceeds its limit
   (`7 + discardLimit hooks`, e.g. +2 per C&K wall) gets a `discard` prompt for `floor(total/2)`,
   **all at once** (`discard` timer). Auto: discard from the largest piles first.
2. When all discards resolve, the loop continues to a `robber` effect for the roller, unless a
   module replaces it (`onSeven` hook returns `replace`: C&K before the first barbarian attack
   skips the robber; Barbarian Attack and Deliveries substitute their own effects).
3. `robber` prompt (scope `table` after a 7, `self` for a Knight). Field 1 picks the piece
   (`robber` or `pirate`, only when both exist), field 2 the hex (legal hexes exclude the current
   one; modules filter, e.g. Friendly Robber), field 3 (in `then`) the victim among adjacent seats
   with cards. One victim is auto-selected; zero victims skips the steal. Auto: the hex that removes
   the most expected production from the current points leader without touching the roller,
   tie-break by most cards; victim = leader, else most cards.
4. Steal: uniform random card from the victim (`rng.cards`). Public event hides the good; both
   inboxes show it.

### 3.6 Main (Standard)

The active seat may, in any order: trade (§9), build, buy and play development cards, run module
commands, and move ships. Modules with a movement phase (Explorers, Deliveries, Barbarian Attack
guards) set `moved = true` on the first movement command; building and trading then say "You
started moving" until the opportunity ends (official build-then-move order without a separate
stage). `end` queues `end-opportunity`, which waits for open prompts, clears the seat's offers,
resets per-opportunity flags and advances the flow.

### 3.7 Paired turns (Standard, 5+ seats)

The adopted rule is the 2025 CATAN 5–6 player "paired players" rule, replacing the old Special
Building Phase:

- Player 1 (the active seat) rolls, resolves production and takes a normal main turn.
- Player 2 (the partner) is the seat `floor(n/2)` places after Player 1 in seating order (5 → +2,
  6 → +3). After Player 1 ends, Player 2 takes a paired opportunity: **build, trade with the bank
  and ports, buy and play one development card (a Knight moves the robber and steals, no
  discards), run module build commands, and win**. Player 2 does **not** roll and does **not**
  trade with players; nobody trades with players during the paired opportunity.
- Each opportunity (main or paired) is a separate "turn" for development cards: a card bought in
  one opportunity can be played from the next opportunity on, one non-VP card per opportunity.
- Then the markers move one seat: the next Player 1 is the seat after the previous Player 1. Every
  seat gets exactly one main and one paired opportunity per round.
- Timer: `paired`. The partner can pre-commit "skip my build turn" (`skip-paired`) during Player
  1's turn; a skipped or CPU partner with nothing to do resolves instantly.

**7–10 seats (adaptation).** Same pairing (`floor(n/2)` places ahead), but the partner's paired
opportunity opens **concurrently** with Player 1's main step, as soon as Player 1's roll and any
seven resolve. The partner still cannot trade with players and Player 1 cannot trade with the
partner. Contested spots go to the first committed action. The turn advances when both have ended
(or timed out). This halves the waiting at 10 seats without changing what each opportunity may do.

### 3.8 Connect-style rounds (adaptation)

Official CATAN Connect uses even rosters, alternating active sides and visible hands. Ours keeps
private hands and a shared board for 3–10 seats:

1. Setup: the normal snake.
2. Each round the **captain** (rotating one seat per round) rolls; production goes to everyone. A
   7 opens simultaneous discards, then the captain's robber prompt.
3. Then one **action window** for every seat (`roundSeconds`): build, trade with any seat that is
   still in the window, buy/play development cards, module commands. One non-VP card per seat per
   round; a card bought this round is playable next round. A Knight opens a `self` robber prompt:
   the knight player chooses while everyone else keeps playing.
4. `end` marks the seat ready. The window closes when every seat is ready and at least
   `CONNECT_MIN_OPEN_SECONDS` have passed, or at the deadline. Ready seats can still answer
   prompts and trade responses; they cannot build.
5. `end-round` waits for open prompts, resolves module round-end hooks (C&K progress hand limits),
   then checks victory for **all** seats: everyone at or above their target qualifies, the highest
   total wins, ties share the win.
6. There is no paired rule in Connect.

### 3.9 Victory and end

- Standard: a seat wins the moment its total (including hidden VP cards) reaches its target during
  its own opportunity (main or paired), including at the start of the opportunity. Scores gained
  on someone else's turn are checked when your next opportunity starts.
- Connect: at `end-round` only (above).
- **Safety net:** after `roundLimit(s)` rounds (15 per target point in Standard, 12 in Connect, times
  `profile.roundLimitScale`) the game ends with reason
  `round-limit` and the highest total wins. This guarantees completion even if a module stalls.
- **Finale.** A win moves the stage to `finale`: all prompts and offers are cleared, clocks stop,
  the `win` event is emitted and `results` is built (§12) with `finaleAt = now` and
  `completeAt = now + FINALE_MS` (9 s). Only `emote` is accepted. Ticks keep running (the
  platform stops ticking only after completion), and the first tick with `now ≥ completeAt` sets
  stage `ended`. `outcome().complete` is true only in `ended`. This hold exists because SceneView
  unmounts at results, so the TV's hidden-VP reveal must play while the round is still running.

## 4. The interruption model: effects and prompts

### 4.1 Prompt life cycle

```
open(s, { seat, kind, scope, data })   // deadline from clock.ts (prompt/discard/robber timer)
answer(s, seat, promptId, picks, cards) // validateAnswer(command(s, prompt), picks, cards); spec.apply
expire(s, now)                          // spec.auto(s, prompt) → apply as the seat, event 'auto'
```

Each prompt kind has one `PromptSpec`, registered by the core or a module:

```ts
type PromptSpec = {
  command(s: State, p: OpenPrompt): Command;       // fields + options for the phone/CPU
  apply(s: State, p: OpenPrompt, a: Answer): void; // after validateAnswer
  auto(s: State, p: OpenPrompt): Answer;           // always legal
  timer: TimedStep;                                // which preset entry sets its deadline
  autoText: string;                                // "Random discard", shown on the phone
};
```

Rules:
- Many prompts may be open at once, for different seats (and at most one per seat per kind).
- `table` prompts stop the resolve loop and block every seat's non-prompt actions, except trade
  responses and emotes.
- `self` prompts block only their owner's non-prompt actions.
- Stage transitions wait for **all** prompts. Deadlines guarantee this always ends.
- `validateAnswer` checks every pick is an offered option (walking `then` for dependent fields),
  card fields are within `available`, `min`/`max` and `allowed`, and charges `command.cost`.

### 4.2 Prompt catalogue

| Kind | Who | Scope | Trigger | Auto |
| --- | --- | --- | --- | --- |
| `discard` | each seat over its limit | table | 7 | largest piles first |
| `robber` | roller / knight player | table / self | 7, Knight, fish, C&K Bishop | leader-aware hex, leader or richest victim |
| `gold` | each seat owed gold | table | gold field produced | goods held fewest of |
| `cities-knights/pillage` | each weakest seat with a city | table | barbarians win | city with lowest production |
| `cities-knights/defense-draw` | each tied top defender | table | defense tie | deck of highest improvement |
| `cities-knights/keep` | holder of 5 progress cards | self | drew off-turn | discard lowest `hint` |
| `cities-knights/retreat` | displaced knight's owner | self | displacement | best reachable vertex, else removed |
| `cities-knights/give` | each targeted seat | table | Wedding, Commercial Harbor, Saboteur, Master Merchant | cheapest legal cards |
| `cities-knights/deserter` | targeted seat | table | Deserter | weakest knight |
| `caravans/bid` | every seat | table | caravan trigger | bid 0 |
| `caravans/place` | bid winner | table | after bids | segment that helps the winner most |
| `barbarian-attack/losses` | each losing guard owner | table | lost battle | weakest guard |
| `deliveries/raider` | roller | table | 7 (replaces robber) | edge nearest the leader's wagon |
| `explorers/pirate` | roller | table | 7 (pirate fleet) | sea hex nearest the leader's ships |

Module work packages add rows here when they port the remaining legacy prompt kinds
(`expansion-state.ts` lists 23). A decision that only the actor makes during their own turn is a
**command with fields**, not a prompt.

## 5. Timers and auto-actions

Values are in `model.ts` `TIMERS` (seconds; `off` = no deadline).

| Step | Off | Relaxed | Brisk | On expiry |
| --- | --- | --- | --- | --- |
| setup | – | 60 | 30 | best-pips settlement / route toward best spot |
| roll | – | 15 | 8 | roll |
| main | – | 120 | 60 | withdraw own offers, place owed free routes, `end` |
| paired | – | 45 | 25 | `end` (pass) |
| discard | – | 40 | 20 | largest piles first |
| robber | – | 30 | 15 | leader-aware robber |
| prompt | – | 40 | 20 | the prompt spec's `auto` |
| offer | – | 45 | 25 | offer expires |

- Connect windows always use `roundSeconds`; the preset governs setup, roll, prompts and offers.
- One `clock` (the main step: who, since when, until when) is public; each prompt carries its own
  deadline. Projections send absolute server times; the client counts down with `serverNowMs()`,
  so views never change just because time passes.
- Timeouts apply equally to humans and CPUs (CPUs never reach them in practice).
- An expired step waits behind any open table prompt and the seat's own prompts, exactly as actions
  do; the auto-action runs when they close (placing owed free routes stops at a new prompt, such as
  a fog gold reveal, and resumes later). A sweep that still throws is logged and retried once with
  the due seats' owed free routes dropped, so one bad step never ends the room.
- These values are final; EXPERIENCE.md §4.4 mirrors them (reconciled).
- `stats.seats[x].timeouts` counts auto-actions; results show it.

## 6. Disconnect policy

Legacy paused the whole table on any disconnect. v2 waits only for seats that owe a decision.

1. A disconnected seat keeps playing the game's clock. Nothing pauses.
2. If that seat owes a decision (active step, partner step, open prompt), its deadline becomes
   `min(deadline, now + GRACE_SECONDS.disconnected)` (30 s), even with the Off preset.
3. On expiry the auto-action runs (event `auto`, reason `disconnected`). The seat's own open offers
   are withdrawn when it disconnects; responses to others' offers stay pending.
4. After two consecutive auto-played opportunities the seat is `away`: later decisions use
   `GRACE_SECONDS.away`. Reconnecting clears `away`.
5. On reconnect, any running deadline becomes at least `now + GRACE_SECONDS.reconnect`; with the
   Off preset, deadlines set only by the disconnect grace are removed.
6. Connect: a disconnected seat counts as ready for closing the window.
7. Presence changes are public (`presence` event, `PublicSeat.connected`).

## 7. RNG and dice

- Generator: sfc32 (four uint32 words per stream), seeded by splitmix32 from `ctx.seed` and the
  stream name. `shuffle` is Fisher–Yates. No `Math.random` anywhere in engine or CPU.
- **Plain dice:** two independent d6 from `rng.dice`.
- **Balanced dice (setting, default off):** a deck of all 36 ordered pairs, shuffled; reshuffled
  when 6 cards remain. If a draw repeats the previous total, it is put back and redrawn once with
  probability 0.3. The deck lives in state (`diceDeck`), never in views.
- C&K's event die and Alchemist use the same stream; `dice[0]` is the red die.
- `stats.dice` records every total; results show the histogram.

## 8. Board generation

Pipeline (`board/index.ts`): layout cells → terrain → numbers → sea frame → module `board`
decorations → graph (vertices/edges) → ports → bounds. The result is frozen.

### 8.1 Base layouts

| Seats | Land | Shape | Terrain | Tokens | Ports |
| --- | --- | --- | --- | --- | --- |
| 3–4 | 19 | hexagon radius 2 | 4 wood, 4 wool, 4 grain, 3 brick, 3 ore, 1 desert | 2, 3×2, 4×2, 5×2, 6×2, 8×2, 9×2, 10×2, 11×2, 12 | 9: 4 × 3:1, one 2:1 of each resource |
| 5–6 | 30 | rows 3-4-5-6-5-4-3 | 6 wood, 6 wool, 6 grain, 5 brick, 5 ore, 2 deserts | 2×2, 3–6 ×3, 8–11 ×3, 12×2 (28) | 11: 5 × 3:1, 2 wool, one each other |
| 7–10 | 37 | hexagon radius 3 | 8 wood, 7 wool, 7 grain, 6 brick, 6 ore, 3 deserts | 2×2, 3×3, 4–6 ×4, 8–10 ×4, 11×3, 12×2 (34) | 13: 6 × 3:1, 2 wood, 2 wool, one each other |

- **5–6 shape (fixes the jagged board).** Row `r` in `-3..3` has width `6 − |r|` (3-4-5-6-5-4-3)
  and starts at `q = max(-3, -3 - r)`. Row centres then sit at a constant offset, so
  each row is centred on the one above, like the printed frame.
- **Supplies.** Bank per resource: 19 (3–4), 24 (5–6), 30 (7–8), 35 (9–10). Development deck:
  3–4: 14 knight, 5 VP, 2 each of the rest (25). 5–6: 20, 5, 3 each (34). 7–8: 24, 6, 3 each (39).
  9–10: 28, 7, 4 each (47). Pieces per seat: 15 roads, 15 ships, 5 settlements, 4 cities.
- The robber starts on the desert nearest the centre.

### 8.2 Terrain and numbers (`board/terrain.ts`, `board/numbers.ts`)

Deterministic scored retries: up to 300 attempts from the board stream; keep the best score.

Hard constraints (any violation rejects the attempt):
1. No two 6/8 tokens on adjacent hexes.
2. No two equal numbers on adjacent hexes.
3. No 2 next to 12, no three-hex junction worth more than 12 pips (catches "6-8-5" corners).
4. No connected cluster of more than 2 hexes of the same terrain (3 on 7–10).
5. Deserts at least 2 hexes apart (5–6, 7–10).

Soft score (lower is better): variance of total pips per resource type, plus a penalty when one
resource type holds both of the highest-pip hexes. Every token appears exactly its count; there is
no cycling of a short list, so no repeating pattern (fixes 7–10).

Reds are placed first on a shuffled greedy pass, then the rest, then a swap-repair pass removes
equal-neighbour violations before scoring.

### 8.3 Ports (`board/ports.ts`)

1. Walk the coast of the home island (or of every island, weighted by coast length, for Four
   Islands) as a cyclic list of land/sea edges in clockwise order.
2. Split that cycle into `N` gaps as evenly as possible (e.g. 30 edges / 9 ports → gaps
   3,3,4,3,3,4,3,3,4), rotated by a random offset. Every gap is ≥ 3 edges, so ports never share or
   neighbour a vertex (fixes clumping).
3. Skip an edge whose vertices touch a feature that forbids ports (lake, landing); slide one edge.
4. Assign types from a shuffled list with the rule that identical 2:1 types are never consecutive.

### 8.4 Seafarers scenarios (generated, per size)

| Scenario | Home island | Outer islands | Special | Suggested target |
| --- | --- | --- | --- | --- |
| `new-shores` | 16 / 24 / 30 hexes (3–4 / 5–6 / 7–10) | 4 / 5 / 7 small islands (10 / 14 / 20 hexes), 2 / 3 / 4 gold | +2 VP for the first settlement on each outer island | 13 |
| `four-islands` | none | 4 / 6 / 8 islands of 5–7 hexes | start on any island; +2 VP per new island (not starting islands) | 13 |
| `fog-islands` | as new-shores | a fog region of 12 / 18 / 24 hidden hexes | revealing land by placing an adjacent route grants 1 of its resource (gold: any) | 12 |

- Islands grow as seeded blobs from seeds placed around the home island at distance ≥ 2 sea hexes;
  attempts that touch another island are rejected.
- Outer island tokens come from a second token set with the same constraints; gold hexes never
  hold 6 or 8.
- The pirate starts on a sea hex not adjacent to any land.
- One sea ring frames all land; Four Islands adds a second ring for navigation.

### 8.5 Explorers & Pirates board

Home island (the 3–4 shape minus the desert, scaled to 5–6 / 7–10), then a hidden region of 36 /
48 / 60 hexes around it, then two sea rings. The hidden region's faces (land, sea, gold, spice
islands, fish shoals, pirate lairs, council placement) are drawn at create into `state.hidden`
according to the selected missions (port legacy `initializeExplorers` proportions). The council of
Catan sits in the region for the Spices and Fish missions. Public tiles in the region show terrain
`fog` until revealed.

### 8.6 Module decorations (board hook, create time only)

Every scenario feature is part of the immutable `Board.features`. Priority for deserts when
several modules want one: Barbarian Attack castle > Deliveries castle > Caravans oasis > Fishing
lake. The 5–6 and 7–10 boards have more deserts; a module that finds none adapts (Fishing without a
lake keeps its six coastal grounds).

| Module | Decoration |
| --- | --- |
| fishing | 6 coastal grounds numbered 4, 5, 6, 8, 9, 10, evenly spaced by the port walker (offset from ports); the lake (2, 3, 11, 12) replaces a desert |
| rivers | 2 rivers (3 on 7–10) from coast to centre as edge paths, bridge sites where routes must cross, gold on river hexes per legacy |
| caravans | oasis on a desert; camel start segments |
| barbarian-attack | castle on the centre desert; 3 / 4 / 5 landing hexes on the coast with their paths to the castle |
| deliveries | castle, quarry, glassworks depots on existing vertices spread across the island (no synthetic vertices) |

## 9. Trade protocol

### 9.1 Offers

- `offer { give, want, to, counterTo }`. `to: []` means "everyone eligible". The server expands it
  to an explicit list. Both sides must be non-empty, no good may appear on both sides (no gifts),
  and the proposer must hold `give` now.
- **Eligible partners** (`partners` in PrivateView):
  - Standard main: the active seat may trade with every seat except a concurrent 7–10 partner.
    A non-active seat may only offer to the active seat.
  - Paired opportunity (5–6): nobody trades with players.
  - Connect window: any two seats that are both in the window (not ready, not disconnected).
- Limits: one live offer per proposer (a new one replaces the old; the old is withdrawn), one live
  counter per seat per parent, at most 12 open offers. Offers expire after the `offer` timer and
  when the proposer's opportunity or round ends.
- **Counter-offers:** any recipient may answer with `offer { counterTo: parentId }`, targeted at
  the parent's proposer. Counters appear nested under the parent on the TV.

### 9.2 Responses and completion

- Per recipient, `responses[seat]` is `pending`, `accept`, `decline` or `counter` (set when that
  seat posts a counter to this offer). The public projection never reveals whether a recipient
  can pay (that would expose hand contents); each recipient learns it privately through
  `PrivateView.offers` (`canAccept`, `why`). The model's `unable` state is unused by the engine.
- Declining is always allowed, even for a seat that can no longer trade (it started moving):
  it moves no cards.
- `respond accept` requires the recipient to hold `want` at that moment. A seat may change its
  answer (accept ↔ decline) until the trade completes; the phone's "Cancel" after accepting is a
  `respond decline`. `respond` may carry a one-line `reason` (≤ 80 chars, CPUs use it), shown in
  `Offer.reasons`.
- `Offer.broadcast` records whether the proposer chose "everyone" (audience label only);
  `Offer.at` is the post time.
- **Completion:**
  - An offer (or counter) whose expanded recipient list has exactly one seat completes the moment
    that seat accepts; both sides have consented, so there is no extra confirm step. This includes
    a broadcast from a non-active seat, whose only eligible partner is the active seat.
  - A broadcast offer completes when the proposer sends `confirm-trade { partner }` for a seat
    whose response is `accept`.
  - The exchange re-checks both hands and is atomic. Other offers are then re-validated.
- **Auto-invalidation after every commit:** offers whose proposer can no longer pay are removed
  (event text "offer withdrawn"); `accept` responses whose seat can no longer pay revert to
  `pending`.
- The TV shows per-seat response chips from `responses`; phones show only offers they can act on.
- Humans and CPUs are treated identically by the protocol.

### 9.3 Bank and port trades

- `bank { give, get }` executes any number of lots at once. `rates(s, seat)` gives the best ratio
  per good: `profile.bankRate` (4, or 3 in Explorers), 3:1 and 2:1 ports where the seat has a
  building on a port vertex, then module modifiers in registry order (C&K trade level 3, Merchant,
  Merchant Fleet; Harbormaster does not change rates).
- Validation: each `give[g]` is a multiple of `rates[g]`; total lots equal the total `get`; no good
  on both sides; the bank holds `get`. Allowed whenever the seat may build (main, paired, window).
- PrivateView `rates` lets the phone pre-fill the best ratio ("tap wool: 2 wool → 1 ?").

## 10. Development cards

- Buy: `COSTS.development`, from the shuffled deck (hidden), when the seat may build and the deck
  is not empty (`why: deck-empty`). Profile flag `devCards` is false with Cities & Knights.
- Play: one non-VP card per opportunity (Connect: per round), never a card bought in the current
  opportunity (`boughtAt === opportunity` → `why: bought-this-turn`). Cards may be played in the
  roll stage before rolling.
- Knight: +1 to `knights`, opens a `robber` prompt (`self` scope), no discards. Largest Army
  re-evaluated.
- Road Building: `freeRoutes += 2` (roads or ships). Build options show `free: 2`; free placement
  is consumed first. Before a roll, the roll waits until the routes are placed or no legal spot is
  left. At the end of the opportunity unplaced free routes are lost.
- Year of Plenty: two resources from the bank (`goods` of length 1–2 bounded by bank stock).
- Monopoly: every other seat gives all of that resource; public event carries the count.
- Victory Point: never "played"; counts as a hidden score part.

## 11. Scoring, awards and victory

- Score parts (`ScorePart { key, label, points, count, hidden? }`), core: `settlements` (1 each),
  `cities` (2), `harbors` (2, Explorers), `longest-road` (2), `largest-army` (2), `vp-cards` (1
  each, hidden). Modules add parts through the `score` hook (islands, metropolis, defender,
  progress points, merchant, wealthiest/poorest, harbormaster, missions, deliveries, prisoners…).
- Public VP = sum of non-hidden parts. PrivateView and results include hidden parts.
- **Longest route (port `longestRoute`).** DFS with a bitmask over the seat's routes; an opponent
  building or blocking unit ends the walk; switching between road and ship needs the seat's own
  building at the joint; module `routeWeight` (caravan segments count 2) and `blocksRoute` hooks.
  Recompute only for seats whose network or neighbourhood changed in the commit.
- **Awards (port `awards` tie logic).** Longest Road needs ≥ 5, Largest Army ≥ 3. A tie with the
  holder keeps the holder; if the holder falls behind and the new leaders tie, nobody holds it.
  Profile switches disable awards (C&K: no Largest Army; Explorers and Deliveries: no Longest Road).
- **Targets.** `target(seat) = settings.targetPoints + Σ module target hooks` (Fishing: +1 while
  holding the old boot).
- Win checks: §3.9.

## 12. Stats and results

Accumulated as the game runs, in `stats` (model `Stats`):

- `dice[total]` for every roll.
- Per seat: `gained` (by good), `produced` (cards from rolls), `blocked` (cards the robber or
  barbarians withheld), `robbed`, `stole`, `discarded`, `trades`, `bankTrades`, `devBought`,
  `knights`, `longestRoute` (max reached), `largestHand`, `timeouts`, `opportunities`.
- `vpByRound[seat]`: public VP at each round end (for a race chart).

`results` (built when the finale starts): winners, reason, rounds, opportunities, duration, standings with the
full score breakdown including hidden VP cards (the UI reveals them one seat at a time), and the
stats. Present in `PublicView.results` from the finale on.

`outcome()`: `complete` once `ended` (after the finale); `winners`; rows `{ playerId, score, rank, label }` for every
seat, CPUs included, label = "CPU · persona" or the top two score parts.

## 13. Events

- Public events (`model.ts` `GameEvent`) have a stable, monotonically increasing `id` from
  `serial`, the server time `at`, a short server-authored `text` for tickers and screen readers,
  and a typed payload that drives animation. The view carries the last 40; animation code keys on
  `id` and ignores ids it has already played.
- **Roll event.** `{ kind: 'roll', seat, dice, total, eventDie, grants, blocked, shortages }`.
  `grants` lists `{ seat, tile, good, amount }` per producing building-hex pair, so the TV can fly
  each card from its hex to the seat chip and the phone can toast "+2 grain from the 8". It is also
  `PublicView.lastRoll`, the summary that stays on screen until the next roll ("8: Ana +2 grain,
  Bo +1 brick. Robber blocked Cy").
- Kinds: `roll`, `turn`, `build`, `robber` (with `from` for the hop), `steal` (good hidden),
  `discard` (count), `trade` (full contents, public by rule, with the `offer` id), `offer`
  (posted / withdrawn / expired / invalid), `bank`, `take` (gold, Year of Plenty, module gains
  from the bank), `payout` (hex grants outside a roll: setup round 2, fog discoveries), `move`
  (one event per step of a ship, knight, wagon, expedition or guard), `dev-buy`, `dev-play`
  (Monopoly carries `taken` per victim), `award`, `reveal`, `barbarians` (C&K attack or Barbarian
  Attack battle: strength, defense, result, losers, defenders), `auto` (timeouts and CPU
  fallbacks), `presence`, `emote`, `module` (typed by `module` + `name`), `win`.
- **Text policy.** The server always writes a short `text` (ticker fallback, phone log, screen
  readers). Clients render core kinds from the structured fields (emblem chips, icons) and use
  `text` for `module` events and anything they do not special-case.
- Offer response changes are not events; the TV diffs `offers[].responses` to animate chips.
- **Private inbox.** Owner-only `PrivateEvent { id, at, text, cards, tone, other }`: what you stole or
  lost, what you drew, Monopoly losses, fish values, revealed exact amounts. Last 12 per seat.
- Emotes are rate-limited to one per seat per 3 s.

## 14. Expansion module registry

### 14.1 Interface (`modules/registry.ts`)

```ts
export interface Module<X = unknown> {
  id: ModuleId;
  /** Rule switches applied in registry order before create. */
  profile?(p: Profile, s: Settings): void;
  /** Create-time only. Retypes tiles, adds features, hidden faces and noPorts. */
  board?: { decorate?(draft: BoardDraft, ctx: GenContext): void };
  init?(s: State): X;                                  // stored in s.ext[id]
  setupPlan?(plan: SetupStep[], s: State): SetupStep[];
  devDeck?(seats: number): DevKind[];                  // Deliveries: the scenario's own deck

  // Production
  beforeProduce?(s: State, roll: RollDraft): void;     // may open table prompts / queue effects
  produce?(s: State, roll: RollDraft): void;           // edit grants before the shortage rule
  afterProduce?(s: State, roll: RollDraft): void;
  onSeven?(s: State, seat: SeatId | null): 'replace' | void;
  blocksTile?(s: State, tile: TileId): 'robber' | 'barbarians' | null;

  // Legality and economy
  legal?: {
    settlement?(s: State, seat: SeatId, v: VertexId): Why | null;
    route?(s: State, seat: SeatId, e: EdgeId, kind: RouteKind): Why | null;
    city?(s: State, seat: SeatId, v: VertexId): Why | null;
    robberTile?(s: State, seat: SeatId, t: TileId): Why | null;
  };
  rates?(s: State, seat: SeatId, rates: Record<Good, number>): void;
  discardLimit?(s: State, seat: SeatId): number;       // added to 7

  // Commands and prompts
  commands?(s: State, seat: SeatId): Command[];        // voluntary, available now
  apply?(s: State, seat: SeatId, commandId: string, a: Answer): void;
  prompts?: Record<string, PromptSpec>;                // keys become `${id}/${key}`
  effects?: Record<string, (s: State, data: Json) => void>;

  // Lifecycle
  onBuild?(s: State, seat: SeatId, piece: PlacedPiece): void;
  onOpportunityStart?(s: State, seat: SeatId): void;
  onOpportunityEnd?(s: State, seat: SeatId): void;

  // Scoring
  score?(s: State, seat: SeatId): ScorePart[];
  target?(s: State, seat: SeatId): number;
  awards?(s: State): void;
  routeWeight?(s: State, edge: EdgeId): number;
  blocksRoute?(s: State, seat: SeatId, v: VertexId): boolean;

  // Projections
  publicView?(s: State): ModulePublic[ModuleId];
  privateView?(s: State, seat: SeatId): ModulePrivate[keyof ModulePrivate];
  hud?(s: State): HudItem[];                           // generic TV widgets (left rail slot A)
  badges?(s: State, seat: SeatId): Badge[];            // seat-rail badges (fish, coins, missions)
}
```

- The registry is a fixed array in `MODULE_IDS` order. `hooks(s, 'produce')` returns the
  implementations of the active modules only, so the core loops `for (const h of hooks(s, …))`.
- `apply` receives commands whose `Command.module` equals its id; the dispatcher routes by that
  field, never by string prefix.
- **UI without per-module panels.** `hud` and `badges` let a module appear on the TV through
  generic widgets, so module WPs never edit UI files. Only 3D layers (WP-scene) and rules help
  text (WP-ui-shared) are per-module on the client, and both read the typed `ModulePublic`.
- CPU hints travel inside views: every `Command.hint` (0..1) is the module's own usefulness
  estimate, and module projections expose the facts a CPU plans with. The CPU never calls modules.

### 14.2 Profile (core rule switches)

```ts
type Profile = {
  devCards: boolean; largestArmy: boolean; longestRoad: boolean;
  robber: boolean; pirate: boolean;
  robberWaitsForFirstAttack: boolean;       // C&K
  bankRate: 3 | 4; ports: boolean;
  routeKinds: RouteKind[];                  // ['road'] or ['road', 'ship']
  commodities: boolean;
  movementLocksBuilding: boolean;
  setupPieces: [BuildingKind, BuildingKind];// round 1, round 2
};
```

Core reads the profile only. Example: `devCards` false hides the dev purchase and deck count.

### 14.3 How each family maps onto the hooks

| Module | Main hooks | Notes |
| --- | --- | --- |
| seafarers | board plan (settings.map), profile (routeKinds, pirate), legal.route, produce (gold owed), score (islands), onBuild (claim island, fog reveal) | Ships: one move per opportunity of an open-ended ship not built this opportunity (official). Pirate blocks ship building/moving next to its hex and steals like the robber. |
| cities-knights | profile (no dev cards/army, commodities, setup city, robber waits), beforeProduce (event die, barbarians, progress draws), produce (commodities), afterProduce (aqueduct), commands (improve, wall, knights, progress cards), prompts (§4.2), discardLimit (walls), rates (trade 3, merchant fleet), score (metropolis, defender, printer/constitution, merchant) | Barbarian strength = cities + metropolises; defense = active knight strength. Loss: weakest contributors with a non-metropolis city each pick a city to lose (simultaneous). Win: unique top defender gets 1 VP; tied top defenders each pick a progress deck (simultaneous). All knights deactivate. |
| fishing | board.decorate, init (fish deck), produce (fish on ground/lake numbers), commands (spend 2–7), target (+1 boot), privateView (fish values) | Drawing the boot: it passes to a seat with at least as many VP via a command. |
| rivers | board.decorate, commands (bridges, via the shared onBuild hooks), onBuild (coins for river routes and settlements), commands (coin trades), score (wealthiest/poorest, port legacy `riverBonus` values), awards | Coins are public. |
| caravans | board.decorate, onBuild (trigger), prompts (bid, place), routeWeight (2 per camel segment), score (camel bonus per legacy) | Bids are simultaneous and sealed; revealed together in one module event. |
| barbarian-attack | board.decorate, profile (no robber on land, no army), onSeven (replace: invaders), commands (guards), prompts (losses), blocksTile (3 barbarians), score (prisoners) | With C&K the coastal attacks replace the barbarian ship track (official combination). |
| deliveries | board.decorate, profile (no robber, no longest road), onSeven (replace: raider prompt), commands (wagon move/upgrade/deliver), score (deliveries) | Movement locks building. |
| friendly-robber | legal.robberTile | Hexes touching a seat with ≤ 2 public VP are illegal unless no other hex exists. |
| harbormaster | score, awards | Harbor points: 1 per settlement and 2 per city on a port vertex; first to 3 takes the award (+2 VP), taken only by strictly more. |
| explorers | board plan (settings.map), board.decorate, profile (no robber, bankRate 3, no ports/longest road, movement locks building, setup pieces), init, commands (ships, cargo, crews, fish/spice delivery, coins), prompts (pirate), onBuild, score (missions), privateView (moves left) | Fixes the legacy stall: CPU mission goals, plus the round-limit safety net. |

### 14.4 Combination rules (`settings.ts`, shared with the SettingsView)

Every rejected combination carries a one-line reason; nothing is silently dropped.

1. Maps are exclusive: Base, Seafarers or Explorers & Pirates. Seafarers ships and E&P expedition
   ships never combine (official E&P exclusion).
2. Cities & Knights combines with all three maps.
3. On Explorers & Pirates only Fishing is allowed among the T&B scenarios (official E&P + T&B
   sheet); Rivers, Caravans, Barbarian Attack and Deliveries are rejected. Friendly Robber (no
   land robber) and Harbormaster (no ports) are rejected.
4. Barbarian Attack and Deliveries each replace the land robber, so Friendly Robber is rejected
   with either.
5. Four Islands has no home island, so Rivers, Caravans, Barbarian Attack and Deliveries (which
   need one) are rejected with it. Fog Islands and New Shores accept them on the home island.
   Both are PartyPlay adaptations (§19): the official sheets allow Four Islands with Caravans and
   reject Fog Islands with Barbarian Attack, Caravans and Traders & Barbarians.
6. Barbarian Attack + Cities & Knights: coastal attacks replace the barbarian ship track.
7. Deliveries + Barbarian Attack: coastal invaders also block wagon paths next to their hex
   (legacy combined layout).
8. At least 0 missions may be chosen on E&P (Land Ho! alone targets 8 VP).

**Suggested targets** (applied when `targetPoints` is absent; the host may change them within
`TARGET_RANGE` and `maxTarget`): base 10; Seafarers New Shores 14, Four Islands 13, Fog Islands 12
(Caravans +2, Deliveries +3 over the map); Explorers 8 + Pirate Lairs 4, Fish 3, Spices 2 (the
mission guide's 8 / 12 / 15 / 17; + 5 with C&K); C&K adds 3 on Base and 2 on Seafarers; each T&B
scenario sets a floor (Fishing 10, Rivers 10, Caravans 12, Barbarian Attack 12, Deliveries 13) and
official pair sheets set an exact pair target that replaces both floors (BA + Deliveries 14,
Caravans + Deliveries 15, Fishing + Deliveries 12, Fishing + Rivers 10, C&K + Caravans 15,
C&K + Deliveries 15); Harbormaster adds 1.

## 15. CPU scheduling

- Each CPU seat has `nextAt`. In `tick`, `server.ts` collects CPU seats that have something to
  do (open prompt, their stage, an offer awaiting their response, their own offer awaiting
  responses) and `nextAt ≤ now`, sorted by `nextAt`, and runs at most 3 per tick.
- For each: build `publicView` and that seat's `privateView` (from the per-revision cache), call
  `cpu.decide`, then apply the action through the same `parseAction` + clone-validate-commit path
  as humans.
- **Never crash the round.** `decide` and the apply are wrapped in `try/catch`. On any error the
  engine applies `auto.fallback(seat)` (the prompt's auto answer, else `end`), logs one `auto`
  event with reason `error`, and continues. The fallback is itself validated; if even that fails,
  the seat is marked `away` so timeouts take over.
- **Pacing.** Think delay from `rng.cpu`: 0.6–1.2 s for turn actions, 0.4–0.8 s for forced prompts
  (discard, gold), 0.8–1.6 s for trade responses; Easy adds 0.3 s. In Connect every CPU runs on
  its own clock, so CPUs act in parallel. A CPU's own offer waits up to 6 s for responses.
- **Budget.** At most 40 actions per CPU per opportunity (Connect: per round); then it ends.
- Standard: while a human holds the stage, CPUs only answer prompts and offers.
- CPU memory (`seat.cpu.memory`) is returned by `decide` and stored; it holds only facts derived
  from the CPU's own views (plan, trade attempts this turn).

**Strength summary** (details in the WP-cpu brief): setup scores pips, resource diversity, port
fit and the planned second settlement; a goal planner (city, settlement, road race, army,
module goals) with a victory-race estimate; leader-aware robber (never prefers humans); trade
proposals and responses by value with a leader embargo at `target − 2` VP, identical for humans
and CPUs; never offers a trade it would not accept. Personas bias goals (e.g. "Harbor trader",
"Road builder", "Knight captain", "City planner"). Difficulty: Easy (noise, no trades proposed,
naive robber), Normal (full planner, 1 proposal per turn), Sharp (counters, 2 proposals, embargo,
blocking placements).

## 16. Performance plan

- **Immutable board + cached index.** `BoardIndex` (id → tile/vertex/edge, vertex neighbours,
  tile → vertices, coast order) is built once and kept in a `WeakMap<Board, BoardIndex>`.
- **Id-indexed pieces.** `pieces.buildings`/`routes`/`units` are records keyed by vertex, edge and
  unit id: O(1) lookups, no `.find` scans.
- **Cheap clone-commit.** `applyAction` structured-clones the mutable part only (the board,
  settings, profile and hidden faces are shared). Measured budget: < 1 ms per action at 10 seats.
- **Incremental derived values.** Longest route recomputed only for affected seats; the "open
  vertex" set (distance rule) recomputed once per revision and shared by every seat.
- **Projection caches.** `publicView` is cached per `rev`. `privateView` is cached per `(rev, seat)`
  and computed lazily, so 10 sockets × 10 snapshots/s cost one computation per seat per change.
  Views contain absolute deadlines, never "seconds left", so time passing does not invalidate them.
- **Quiet ticks.** A tick that changes nothing does not bump `rev`.
- **Budgets tested:** 10-seat E&P + C&K projections < 2 ms each; public view (excluding cached
  board/pieces) < 12 KB; private view < 8 KB.

## 17. Projections and snapshotCache

- Manifest: `snapshotCache: { revisionField: 'mapRev', fields: ['board', 'pieces', 'settings'] }`.
  These three fields are always present. `board` and `settings` never change; `pieces` changes
  only through `pieces.ts`, which sets `mapDirty`; commit bumps `mapRev` when dirty. `mapRev` is a
  non-negative integer and is not itself cached.
- Everything in `PublicView`/`PrivateView` is JSON: records, arrays, numbers, strings, booleans,
  null. Optional properties are omitted, never `undefined`. Tests run `assertSerializable` on
  every view during full matches.
- **Privacy.** Public: board, pieces, revealed tiles, hand and dev counts, bank counts, deck count,
  public score parts, offers, prompt chips (seat + kind, no contents), events. Private (owner only):
  hand, dev cards, hidden VP, rates, legal targets, prompts with options, commands, inbox, module
  private data. Never projected: deck order, fog faces, RNG, CPU memory, other seats' prompts.
- `Now` headline (server-authored, never time-dependent): `title` "Maya rolls" / "Rolled 7!",
  `detail` "Discarding: Theo (4), Ana (5)" / "Build and trade with the bank only". Clients append
  countdowns from deadlines.
- `Task` per seat: the one thing to do now (`title`, `text`, prompt id, deadline, `auto` copy).
- `PublicSeat.status` / `deadline`: per-seat state for the rail (`thinking` = CPU owing a step).
  A disconnected seat with a deadline is the "waiting for Bo to reconnect" case.
- `robberChoices`: every open robber/pirate prompt with its legal hexes and victims (public: the
  board already reveals who touches each hex). `intent`: set by the optional `intent` action while
  a phone is choosing a placement; cleared on the next build, end or turn change.
- `hud`: concatenated module `hud` hooks. `seats[].badges`: module `badges` hooks.
- `results` appears at the finale (it is where stats and hidden VP become public).

## 18. Server adapter (`server.ts`)

- `validateSettings` → `settings.ts`. `parseInput` → `null`. `parseAction` → `engine/parse.ts`.
- `create(ctx, settings)` → `engine.createGame` (seats CPUs, board, setup plan, first deadline).
- `applyAction(s, seat, a, now)`: clone mutable state, `actions.apply`, `flow.advance`, post-commit
  invariants (offer invalidation, awards, win check), `rev++`, `mapRev++` if dirty, then
  `Object.assign` back. Throws readable errors; the state is untouched on throw.
- `tick(s, _, _, now)`: expire deadlines (auto-actions), `advance`, Connect window close, CPU step.
  Each auto-action or CPU action uses the same commit path.
- `onPresenceChange` → `clock.presence` (§6). `publicView`/`playerView` → `project.ts` caches.
- `outcome` → §12. `dispose` → no-op (caches are weak).

## 19. Adaptations and open questions

Adopted adaptations (documented for players in the rules help):

- 7–10 boards, supplies, dev decks, port counts and the concurrent paired turn.
- Connect-style rounds with private hands, a rotating captain and 3–10 seats.
- Generated Seafarers, E&P and T&B maps (not the printed scenario boards).
- Explorers & Pirates bank rate 3:1 without ports (legacy).
- Setup stays sequential in Connect.
- Round-limit safety net.
- Seafarers × T&B playability: Fog Islands accepts Barbarian Attack, Caravans and Deliveries on the
  home island, and Four Islands rejects Caravans (the official sheets say the opposite for both).
- Barbarian Attack on generated boards: the castle replaces the central desert and the coast may
  hold more than the printed 10 hexes. Every landing number 2–6, 8–12 is placed on the coast
  (inland swaps), and a number shared by two coastal hexes lands on each (as 5 and 9 do in the
  5–6 rules).
- Deliveries (T&B scenario) development deck: 16 Knight, 3 Road Building, 3 Victory Point (× 1.5
  at 5–6, × 2 at 7+). Swift Journey is not implemented yet (it needs a new `DevKind` contract
  entry). At 3–4 seats the 2 and 12 hexes take the nearest legal number instead of being removed
  with their hexes; 7+ seats keep 2 and 12 like 5–6.
- Fishing: 5–6 seats get the extra 14 tokens but still one lake (the sheet adds a second on the
  second desert); 7+ doubles the tokens. The once-per-turn "replace one token at the 7-token
  limit" option is not offered (it is a real choice, since the draw may be the old boot, so it
  needs a prompt). With Caravans the lake replaces a forest and drops its number disc (the sheet
  stacks 12 on the 2 hex instead).
- Rivers + Traders & Barbarians: the sheet's bridge gold (2), river-crossing wagon costs and 3
  starting gold are not implemented; Poor still costs no VP (implemented).
- Traders & Barbarians + Seafarers: wagons do not cross sea edges (the sheet allows 2 MP, or 1 MP
  along a ship).

Open questions for the lead:

1. **Paired partner offset.** This design uses `floor(n/2)` seats ahead (legacy). Please confirm
   against the 2025 5–6 rulebook (p. 1–4); if the official partner is a different seat, only
   `flow.partnerOf` changes.
2. **Default timer preset.** `DEFAULT_SETTINGS.timer` is `relaxed` because idle players stalling
   the table is a named problem; the earlier research proposed no forced timer in faithful mode.
   *Reconciler: kept Relaxed (EXPERIENCE §4.10 agrees; Off stays one tap away).*
3. **Concurrent paired turns for 7–10.** Adopted for pace; drop to sequential if playtests find
   it confusing.
4. **Seafarers scenario set.** Three generated scenarios (New Shores, Four Islands, Fog Islands).
   Confirm this set, or name others.
5. **Legacy typecheck break.** Replacing `model.ts` breaks the legacy `src/` files until WP-core
   removes them. The build plan schedules that removal first; it needs the lead's go-ahead since it
   deletes legacy source from the game package (a preserved copy exists under `output/`).
