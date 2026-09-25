# Island Settlers v2: build plan

Companion to [ENGINE.md](ENGINE.md). The contract is `src/model.ts` + `src/geometry.ts`. Paths are
relative to `packages/games/island-settlers/` unless they start with `/` or `output/`.

## 0. Ground rules for every work package (WP)

- **Ownership is exclusive.** A WP edits only the files listed as its own. Everything else is
  read-only for it. New files go only inside the WP's own directories.
- **Contract changes go through the architect/lead.** `model.ts`, `geometry.ts` and the two docs
  are owned by WP-0. Send a change request (the type you need and why); the owner batches
  additive changes, typically once a day, and announces the new contract revision.
- **Boundary.** `src/ui/**` and `src/client.tsx` may import `model.ts`, `geometry.ts`,
  `settings.ts`, `music.ts` and `audio.tsx` at runtime, and nothing from `src/engine/**`,
  `src/cpu/**` or `src/server.ts` (type imports only). `src/cpu/**` imports only `model.ts` and
  `geometry.ts`.
- **Style.** No Prettier ever. Lines under ~110 characters, files under ~300 lines, one concept
  per file, fewest lines that satisfy the requirement.
- **Handoffs** follow the handbook: `editing → source ready → built → verified`, one message per
  batch. WP-qa is the single build and browser-QA owner (at most three visible windows; large
  rosters headless).
- **Git.** No staging, commits or pushes unless the user explicitly asks. Game changes live in the
  `game-modules` submodule.
- **Test command** (focused): `node --import tsx --test packages/games/island-settlers/tests/**/*.test.ts`
  from the repo root. Each WP names its own test files below.

## 1. Work packages and file ownership

| WP | Wave | Owns (exclusive) | EXPERIENCE sections |
| --- | --- | --- | --- |
| **WP-0 contract** (architect + reconciler, done) | 0 | `src/model.ts`, `src/geometry.ts`, `docs/v2/**` | – |
| **WP-core** skeleton, flow, projections, adapter | 1 | `src/manifest.ts`, `src/server.ts`, `src/settings.ts`, `src/engine/{index,state,profile,rng,cards,need,parse,pieces,flow,effects,prompts,clock,auto,actions,events,commands,project,stats}.ts`, `src/engine/modules/{registry,index}.ts`, `tests/helpers.ts`, `tests/core/**` | – |
| **WP-board** map generation | 1 | `src/engine/board/**`, `tests/board/**` | – |
| **WP-fixtures** typed sample views | 1 | `tests/fixtures/**` | – |
| **WP-ui-shared** client shell + shared UI contract | 1 | `src/client.tsx`, `src/ui/shared/**`, `src/ui/settings.tsx`, `src/ui/instructions.tsx`, `src/ui/base.css`, `tests/ui/boundary.test.ts` | §1.6 palette/emblems, §2 bridge, §3.1/§4.9 layout constants, §4.10, §4.2 lobby row, §4.8 |
| **WP-art** Blender models | 1 | `art/**`, `public/games/island-settlers/models/**` | §1.5, §1.8 |
| **WP-sfx** event sounds | 1 | `src/ui/sfx/**`, `tests/ui/sfx.test.ts` | §5, §4.5 phone cues/haptics helpers |
| **WP-rules** base rules | 2 | `src/engine/{build,legal,dev,production,score}.ts`, `tests/rules/**` | – |
| **WP-trade** trading | 2 | `src/engine/trade.ts`, `tests/trade/**` | – |
| **WP-cpu** | 2 | `src/cpu/**`, `tests/cpu/**` | – |
| **WP-scene** TV 3D board | 2 | `src/ui/scene/**` | §1.1–1.7 (code side), §2, §3.5, §6 scene rows |
| **WP-hud** TV HUD frame | 2 | `src/ui/display/**` except `theatre/` | §3.1–3.4, §3.9, §3.12 |
| **WP-theatre** dice, fly-outs, strip, finale | 2 | `src/ui/display/theatre/**` | §3.6–3.8, §3.10, §6 HUD rows |
| **WP-results** results screen | 2 | `src/ui/results/**` | §3.11 |
| **WP-map** phone/host SVG map | 2 | `src/ui/map/**` | §4.3, placement row of §4.2 (map part), §4.1 map sizes |
| **WP-trade-ui** composer + offer cards (phone and host dock) | 2 | `src/ui/trade/**` | §4.7, "Responding to an offer" row of §4.2 |
| **WP-controller** phone controller panels | 2 | `src/ui/controller/**` | §4.1, §4.2 (except trade), §4.4–4.6 |
| **WP-personal** seated host | 3 | `src/ui/personal/**` | §4.9 |
| **WP-seafarers** | 3 | `src/engine/modules/seafarers/**`, `tests/modules/seafarers.test.ts` | – |
| **WP-ck** Cities & Knights | 3 | `src/engine/modules/cities-knights/**`, `tests/modules/cities-knights*.test.ts` | – |
| **WP-tb-a** light T&B + variants | 3 | `src/engine/modules/{fishing,rivers,caravans,friendly-robber,harbormaster}.ts`, `tests/modules/{fishing,rivers,caravans,variants}.test.ts` | – |
| **WP-tb-b** heavy T&B | 3 | `src/engine/modules/{barbarian-attack,deliveries}.ts`, `tests/modules/{barbarian-attack,deliveries}.test.ts` | – |
| **WP-ep** Explorers & Pirates | 3 | `src/engine/modules/explorers/**`, `tests/modules/explorers*.test.ts` | – |
| **WP-qa** integration, matrix, browser, docs | 3–4 | `tests/match/**`, `tests/privacy.test.ts`, `tests/perf.test.ts`, `tests/browser/**`, `README.md`, `QA.md`, `EXPANSIONS.md` | §7 feel checks |

Not owned by anyone in this plan (untouched): `src/music.ts`, `src/audio.tsx`,
`public/games/island-settlers/music/**`, every platform file under `apps/`, `packages/party-*`,
`catalog/`, root tests. Same game id and entry files mean the platform registries need no edits.
A new catalog description is an optional, separate platform request.

**Ownership transfer.** WP-core creates a stub per module file under `src/engine/modules/` in
wave 1 so the registry typechecks; at the wave-1 handoff each stub passes to its module WP.
`src/client.tsx` belongs to WP-ui-shared from the start (it lazy-imports the other UI WPs' entry
components by the fixed paths in §3.1, with placeholders until they land).

**UI rule of thumb.** Each UI WP styles its own components in a CSS file inside its own
directory, scoped under `.island-settlers-*`, and uses only `--kp-*` tokens plus
`src/ui/base.css` variables. Module-specific TV panels are not needed: modules publish `hud`
items and seat `badges` (ENGINE §14.1), which WP-hud renders generically. Module 3D layers
belong to WP-scene (wave 3 follow-up); module commands render through WP-controller's generic
command sheet.

## 2. Waves and milestones

Only `model.ts` and `geometry.ts` are needed to start wave 1. Each later wave starts when the
named inputs land, not when the whole previous wave is done.

```
Wave 0  WP-0 contract ✔ (model.ts, geometry.ts, docs)
Wave 1  start now, in parallel (inputs: model.ts + geometry.ts only)
          WP-core (M1 skeleton)   WP-board   WP-fixtures   WP-ui-shared   WP-art   WP-sfx
Wave 2  UI + CPU: when WP-fixtures v1 and WP-ui-shared's day-1 files land (≈ day 1)
          WP-scene  WP-hud  WP-theatre  WP-results  WP-map  WP-trade-ui  WP-controller  WP-cpu
        engine: when WP-core's M1 handoff lands (state, commit, registry, events)
          WP-rules  WP-trade
Wave 3  when the base engine plays (M2 exit) and WP-controller/WP-scene/WP-hud have entry views
          WP-personal   WP-qa base integration (M3)
          WP-seafarers  WP-ck  WP-tb-a  WP-tb-b  WP-ep  (+ WP-cpu module goals, WP-scene module layers)
Wave 4  WP-qa: combination matrix, perf, 10-seat browser runs, replay, feel checks, docs (M5)
```

What each wave-1/2 package may assume:

- **Wave-1 engine packages** code against `model.ts`. WP-board needs no engine state (its input
  is `BoardInput`, §3). WP-core owns everything the later engine WPs plug into.
- **Wave-2 UI packages** code against `model.ts`, `geometry.ts`, the fixtures and the
  WP-ui-shared day-1 exports in §3.1. They do not wait for the engine: the fixtures are real
  `PublicView`/`PrivateView` values. Integration with the live engine happens in wave 3.
- **WP-cpu** in wave 2 builds `value`, `setup`, `plan`, `trade`, `robber` against fixtures;
  its full-game tests switch on when WP-core + WP-rules + WP-trade play a game.
- **WP-rules / WP-trade** wait for WP-core's `State`, `commit`, `emit`, `hooks` and `Profile`
  (M1 exit), and use WP-board's `boardIndex`.
- **Wave-3 module WPs** need the registry, rules entry points and the harness in §4.

Milestones:

- **M1 (wave 1, WP-core ≈ 1 day).** With the lead's go-ahead, delete the legacy engine and UI
  files in `src/` (every file except `music.ts`, `audio.tsx`, `model.ts`, `geometry.ts`) and the
  legacy `tests/` (a copy is preserved in `output/settlers-v2/legacy/`). `manifest.ts`,
  `server.ts` and `client.tsx` are rewritten in place by their owners. Land `state.ts`,
  `profile.ts`, `rng.ts`, `cards.ts`, `need.ts`, `pieces.ts`, `events.ts`, `commands.ts`,
  `modules/registry.ts` with the full `Module` interface, `modules/index.ts` importing a stub per
  module, `settings.ts` (first, since SettingsView reads it), `parse.ts`, `server.ts` returning a
  valid setup-stage game, and `tests/helpers.ts`. Exit: `npm run typecheck` and
  `tests/registry-contract.test.ts` pass.
- **M2.** Base game in the engine: setup, roll, production, seven, robber, main, paired turns,
  Connect rounds, trade, dev cards, scoring, timers, disconnects, finale, projections.
- **M3.** Base game join → finale → results → replay in the browser with CPUs (Easy is enough),
  UI wired to the live engine.
- **M4.** Modules and their CPU goals and 3D layers.
- **M5.** Matrix, performance, feel checks, docs.

## 3. Package briefs

Each brief lists what the WP **consumes**, what it **provides**, what to **port** from legacy
(`output/settlers-v2/legacy/src/…`), and its **acceptance tests**. "Full-match loop" means the
harness in §4.

### WP-core

- **Consumes:** model.ts, geometry.ts, ENGINE.md §2–7, §12–18.
- **Provides:**
  - `State` and helpers (`seat(s, id)`, `hooks(s, name)`, `openPrompt`, `queueEffect`,
    `emit(s, event)`, `inbox(s, seat, event)`), the `Module` and `PromptSpec` types, `Profile`.
  - `commit(s, now, fn)`: clone-validate-commit used by actions, ticks, CPUs and auto-actions.
  - `flow.advance`, stage transitions, paired and Connect logic, clocks, auto-actions, presence.
  - `project.publicView/privateView` with caches; `Now` (`title`/`detail`) and `Task`; per-seat
    `status`/`deadline`/`discardLimit`/`badges`; `robberChoices`; `intent` (and the `intent`
    action); `hud` from module hooks; `results` from the finale.
  - Seating: palette index `seat` per ENGINE §2; the table grows past `tableSize` to fit humans.
  - The `finale` stage (ENGINE §3.9): `FINALE_MS` hold, `outcome().complete` only in `ended`.
  - `server.ts` `rules` with CPU scheduling calling `cpu.decide` (signature in WP-cpu).
- **Port:** clone-validate-commit (`server.ts` applyAction), `parseAction` bounds, `need`,
  `transfer`/`has`, snake setup formula, `validateCommand` → `validateAnswer` (extend for `then`
  fields and multiple card fields), `expansion-settings.ts` restrictions and targets →
  `settings.ts` (renamed `traders` → `deliveries`, new Seafarers scenarios, missions may be empty).
- **Acceptance (`tests/core/**`):**
  - `validateSettings({})` equals `DEFAULT_SETTINGS`; each restriction in ENGINE §14.4 rejects
    with its reason; targets match the suggestion table.
  - Stale and duplicate `turnId` rejected; prompts do not change `turn.id`.
  - Simultaneous prompts: three `discard` prompts open together and resolve in any order; the
    robber prompt opens only after the last one. `self` prompts block only their owner; stage
    transitions wait for all prompts.
  - Every timed step and every core prompt auto-resolves at its deadline with an injected clock,
    for Relaxed and Brisk; Off never expires except under disconnect grace.
  - Disconnect: a seat that owes nothing never delays anyone; an owing seat gets its grace, then
    auto-play at 30 s (`GRACE_SECONDS`); two auto-played opportunities mark it away (5 s); reconnect
    restores ≥ 15 s.
  - Connect window closes on all-ready after the minimum, or at the deadline; a Knight in Connect
    does not block other seats' builds.
  - Round-limit safety net ends a stalled game with reason `round-limit`.
  - A win enters `finale` with `results` public, `outcome().complete` false until
    `completeAt`, then `ended`; only emotes are accepted in the finale.
  - `seats[].seat` is unique 0–9 and matches `SEAT_COLORS.indexOf(color)` for humans.
  - Atomicity: every rejected action leaves `structuredClone`-equal state (`unchanged` helper).
  - `mapRev` changes if and only if `pieces` changed (diff JSON across 2,000 random commits).
  - A CPU whose `decide` throws gets the fallback, an `auto` event with reason `error`, and the
    round continues.

### WP-rules

- **Consumes:** WP-core state/helpers, `BoardIndex` from WP-board, Profile, module hooks.
- **Provides:** `legal.ts` (targets + `Why` per piece, robber tiles, victims, ship moves via
  hooks), `build.ts` handlers, `production.ts` (`grants`, shortage rule, `RollEvent`), `dev.ts`,
  `score.ts` (`scoreParts`, `longestRoute`, `updateAwards`, `winCheck`); events `payout` (setup
  round 2), `robber` with `from`, `move` for ship moves, `dev-play` with Monopoly `taken`.
- **Port:** `production` + shortage rule, `longestRoute` (bitmask DFS, road/ship joints),
  `awards` tie logic, `rates` port logic (to WP-trade), dev deck counts (updated per ENGINE §8.1),
  `pieceCount`.
- **Acceptance (`tests/rules/**`):** distance rule and connectivity; setup round-2 starting
  resources (base and C&K profile); city upgrade and piece limits; shortage rule (enough, short
  with two recipients, short with one recipient); robber blocks production and appears in
  `blocked`; discard count `floor(n/2)` with limits from hooks; steal conserves cards; dev timing
  (bought-this-opportunity, one per opportunity, before roll, paired opportunity counts as a new
  one, Connect next round); Road Building before roll blocks the roll; Year of Plenty and Monopoly
  bounded by the bank; Longest Road with loops, forks, an opponent settlement splitting it, and
  road/ship joints; awards: incumbent keeps a tie, holder falls behind into a tie → nobody; win at
  opportunity start and by hidden VP; paired rules (no player trades, may win, Knight allowed);
  7–10 concurrent partner contention (first commit wins, loser's legal list updates).

### WP-trade

- **Consumes:** WP-core state, `partners` rules from ENGINE §9.1, rates hooks.
- **Provides:** handlers for `offer`, `respond` (answers may change until completion; optional
  `reason` into `Offer.reasons`; posting a counter sets the parent response to `counter`),
  `confirm-trade`, `withdraw`, `bank`; `offer` events (posted / withdrawn / expired / invalid) and
  `trade` events carrying the offer id;
  `invalidateOffers(s)` (called by commit); `rates(s, seat)`; `partners(s, seat)`;
  `offerState(s, seat)` for projections.
- **Port:** offer validation (no gifts, both sides non-empty), acceptance re-check, bank rates.
- **Acceptance (`tests/trade/**`):** eligibility per stage and mode; targeted offer completes on
  accept; broadcast needs `confirm-trade` with an accepting seat; counter to the proposer completes
  on the proposer's accept; one live offer per seat (replacement withdraws the old); 12-offer cap;
  expiry by timer and by opportunity end; auto-invalidation (proposer spends cards → removed;
  acceptor spends → `unable`); multi-lot bank trade with 4:1, 3:1 and 2:1 mixes; bank short on
  `get` rejected; goods conserved in every case; CPU and human offers behave identically.

### WP-board

- **Consumes:** model.ts board types, geometry.ts, a `random: () => number`.
- **Provides:**
  - `makeBoard(input): BoardResult` with `BoardInput = { seatCount, settings, random, cells,
    decorators }` and `BoardResult = { board, hidden, robber, pirate }`.
  - `boardIndex(board): BoardIndex` (cached): maps, vertex neighbours, tile vertices, coast cycle.
  - Helpers for module board hooks: `growIsland`, `coastCycle`, `spacedSlots(cycle, n, offset)`,
    `placeNumbers(tiles, tokens, random)`.
- **Port:** corner-key vertex/edge merge (`board.ts`), `shuffled`.
- **Acceptance (`tests/board/**`):** for seats 3–10, every map and Seafarers scenario, 500
  seeds each: exact terrain and token counts per ENGINE §8.1; hard constraints 1–5 of §8.2 hold;
  every port gap ≥ 3 coast edges and no two ports share or neighbour a vertex; 5–6 row centres
  line up (constant offset); vertices and edges unique; every edge has ≤ 2 tiles; same seed →
  deep-equal board; generation < 30 ms p95.

### Module WPs (WP-seafarers, WP-ck, WP-tb-a, WP-tb-b, WP-ep)

- **Consume:** the `Module` interface, `PromptSpec`, command builders, WP-board helpers, WP-rules
  legality and scoring entry points (through hooks only; a module never edits core files).
- **Provide:** one `Module` object per id, its `ModulePublic`/`ModulePrivate` projection matching
  model.ts, `hud` items and seat `badges` for every public counter it adds (so the TV needs no
  module panel), typed events (`barbarians`, `move`, `payout`) where they apply and `module`
  events otherwise, `Command.hint` values for every command, and a short plain-text rules summary sent
  to WP-ui-shared, which owns the help text in `src/ui/shared/help.ts` (the client must not import
  anything under `src/engine`).
- **Port** (semantics, rewritten readably):
  - Seafarers: legacy `server.ts` ship legality and `move-ship`, gold (`goldDue`), island bonus.
  - C&K: `PROGRESS_DECKS` counts, `cityEvent`, `improve` (metropolis capture at 4/5),
    `promotion`, `drawProgress`, knights (`recruitSites`, activation, displacement), progress
    card effects in `cities-knights.ts`.
  - Fishing: fish deck composition, `fishOptions`/`spendFish`, grounds and lake numbers.
  - Rivers: river generation idea, bridges, `riverBonus`.
  - Caravans: `startCaravan`, `applyCaravanPrompt` (now simultaneous sealed bids), placement.
  - Harbormaster block in `traders-barbarians.ts`; friendly robber rule.
  - Barbarian Attack: `invade`, `resolveCoastalBattles`, guard deck, `syncBarbarianPaths`.
  - Deliveries: wagon costs, cargo decks, tolls, raiders (depots on real vertices, no synthetic
    board surgery).
  - Explorers: `initializeExplorers` proportions, `capacity`, `destinations` BFS, `discover`,
    `resolveLairs`, `missionProgress`, harbor settlements, coins.
- **Acceptance (`tests/modules/**`):**
  - Rule unit tests for every command and prompt kind (legal, illegal with the right `Why`,
    atomic rejection, conservation including module stores such as fish and coins).
  - Board decorations deterministic and within constraints (e.g. fishing grounds spaced from
    ports, rivers connected coast to centre).
  - **Full-match loop, this module alone**, at the suggested target: 3 seats and 4 seats Standard,
    10 seats Standard and Connect, 3 seeds each, all CPU Normal. Every game ends with reason
    `target` (not `round-limit`); goods conserved at every step; views serializable; no prompt
    ever past its deadline by more than one tick.
  - WP-ep additionally: each mission alone and all three together finish at default targets
    (the legacy stall regression).

### WP-cpu

- **Consumes:** `PublicView`, `PrivateView`, `Command`/`Prompt` shapes, `geometry.ts`.
- **Provides (fixed signature for WP-core):**

  ```ts
  export type Brain = { level: CpuLevel; persona: string; memory: unknown; random: () => number };
  export type Decision = { action: Action | null; memory: unknown; pace: 'think' | 'forced' | 'respond' };
  export function decide(pub: PublicView, me: PrivateView, brain: Brain): Decision;
  export const PERSONAS: readonly { id: string; name: string; label: string }[];
  ```

  `action: null` means "nothing to do now". `decide` must be pure apart from `brain.random`.
- **Port:** discard-largest-first, gold-from-largest-bank-piles, BFS movement toward targets
  (E&P ships, wagons), `commandAction` generic fallback (now using `Command.hint` instead of
  "first option").
- **Acceptance (`tests/cpu/**`):**
  - Legal-only: 200 seeded full games across modes and modules, `decide` never throws and never
    produces a rejected action (the harness counts rejections; target 0).
  - Strength: 4 Normal CPUs on Base at 10 VP finish in a median ≤ 70 opportunities over 20 seeds
    (legacy: 91 turns); 1 Sharp vs 2 Easy wins ≥ 60 % over 40 seeds; Normal CPUs propose ≥ 1
    trade per 8 opportunities and complete CPU-to-CPU trades.
  - Robber: when the leader can be hit, the CPU hits the leader ≥ 80 % of the time; never places
    on a hex where it is the only affected seat; never prefers humans (swap human/CPU flags in the
    same position → same choice).
  - Trade fairness: identical offers from a human and a CPU get identical answers; declines any
    offer from a seat at ≥ target − 2 VP (Normal/Sharp).
  - Setup: second settlement adds at least one new resource type in ≥ 90 % of seeds.
  - `decide` p95 < 5 ms on a 10-seat E&P + C&K state.

### WP-fixtures (wave 1, day 1)

- **Consumes:** model.ts, geometry.ts.
- **Provides:** `tests/fixtures/*.ts` exporting typed `PublicView` and `PrivateView` values built
  by small hand-written builders (not the engine): 4-seat base mid-game, 10-seat 7–10 late game
  with every vertex and edge occupied (max pieces), a 7 with three open discard prompts and a
  robber choice, open offers (12, with every response state including `counter` and `unable`),
  a paired turn (5–6) and a concurrent 7–10 partner, a Connect window, the finale with `results`,
  plus one private view per `TaskKind` and per core prompt kind, and one C&K, Seafarers and E&P
  sample with `ext`, `hud` and `badges`. Every fixture passes `assertSerializable`. A
  `fixtures/index.ts` names them so UI WPs can switch between them in a dev harness.
- **Later:** WP-qa regenerates the same names from real engine states in wave 3.
- **Acceptance:** `tsc` clean against model.ts; every fixture JSON-round-trips unchanged.

### 3.1 Shared UI contract (WP-ui-shared, day-1 exports)

Wave-2 UI packages code against these signatures from the first hour. WP-ui-shared lands them
first, then the rest of its brief.

```ts
// ui/shared/seats.ts: EXPERIENCE §1.6 table, index = PublicSeat.seat
export type SeatStyle = { body: string; dark: string; band: 'dark' | 'mid' | 'light'; emblem: EmblemId };
export const SEATS: readonly SeatStyle[];
export const seatStyle: (pub: PublicView, id: SeatId) => SeatStyle;
// ui/shared/emblems.ts
export type EmblemId = 'triangle' | 'circle' | 'square' | 'diamond' | 'star'
  | 'heart' | 'wave' | 'bolt' | 'crescent' | 'cross';
export const EMBLEM_PATHS: Record<EmblemId, string>; // 24×24 SVG path data
// ui/shared/SeatChip.tsx: emblem in a seat-coloured circle (sizes in px or u)
export function SeatChip(p: { pub: PublicView; seat: SeatId; size: string }): JSX.Element;
// ui/shared/layout.ts: EXPERIENCE §3.1 and §4.9, values in u (stage height = 980u)
export type Rect = { left: number; top: number; width: number; height: number };
export type RegionName = 'dice' | 'banner' | 'rail' | 'left' | 'strip' | 'board' | 'dock';
export function regions(stage: { width: number; height: number }, host: boolean): Record<RegionName, Rect | null>;
// ui/shared/bridge.ts: scene ⇄ HUD/host store (no three.js import)
export type ScreenPoint = { x: number; y: number }; // stage px
export const bridge: {
  tileScreen(id: TileId): ScreenPoint | null; vertexScreen(id: VertexId): ScreenPoint | null;
  pxPerWu(): number; publish(next: BridgeState): void; subscribe(fn: () => void): () => void;
  pick: { spots: string[]; focus: string | null; onPick: ((id: string) => void) | null };
};
// ui/shared/timeline.ts: one clock for scene and HUD animations (EXPERIENCE §3.6)
export const ROLL_MS: { land: 450; flash: 450; flyStart: 600; settle: 1440 };
export const BACKLOG_MS = 2500; export const REPLAY_WINDOW_MS = 3000;
export function freshEvents(events: GameEvent[], lastSeen: number, now: number): GameEvent[];
// ui/shared/format.ts, labels.ts, icons.tsx: goods, pieces, cards ("1 resource"), time "0:42"
```

### WP-ui-shared (wave 1)

- **Consumes:** model.ts, geometry.ts, settings.ts, party-ui primitives, rules summaries from
  module WPs.
- **Provides:** the day-1 exports above; `client.tsx` (`GameClientModule`: lazy `SceneView` from
  `ui/scene/index.tsx`, `DisplayView` from `ui/display/index.tsx`, `ControllerView` from
  `ui/controller/index.tsx`, `PersonalView` from `ui/personal/index.tsx`, `ResultsView` from
  `ui/results/index.tsx`, `SettingsView`, `InstructionsView`, the kept `AudioView`; placeholders
  until each lands); `ui/shared/` also holds the client board index, drafts (port
  `readDraft/saveDraft`), labels and colour meta (port `presentation.ts`), `help.ts` (rules text);
  `settings.tsx` (EXPERIENCE §4.10), `instructions.tsx` (§4.2 lobby row), `base.css`.
- **Acceptance:** settings view shows every restriction reason from `settings.ts` and the
  suggested target updates live; timer preset (with the §4.4 table), CPU difficulty, balanced
  dice and table size with the "You + 2 phones + 1 CPU" preview are selectable; instructions stay
  under 60 words before the details; `tests/ui/boundary.test.ts` fails on any runtime import of
  `src/engine`, `src/cpu` or `src/server.ts` from `src/client.tsx` or `src/ui/**`.

### WP-sfx (wave 1)

- **Consumes:** `GameEvent` kinds, `party.sound.muted` / `party-sound` conventions (see the kept
  `audio.tsx`).
- **Provides:** `ui/sfx/index.ts`: `createSfx()` with one lazily created `AudioContext`, the
  EXPERIENCE §5 chain and recipes, `play(event: GameEvent)` deduplicated by event id,
  `cue(kind)` for phone personal cues at 0.6×, `haptic(kind)` (§4.5 table), suspension while
  hidden, mute sync. WP-hud (TV/host) and WP-controller (phone) call it; it never reads views.
- **Acceptance:** unit test with a fake AudioContext: each event kind maps to its recipe, a
  duplicate id plays once, resource blips are rate-limited to 6 per 200 ms, mute silences.

### WP-scene (wave 2)

- **Consumes:** `PublicView` (via refs, never rebuilding the renderer on snapshots), geometry.ts,
  GLB bundles from WP-art (placeholder primitives until they land), `ui/shared` seats, layout,
  bridge and timeline.
- **Provides:** `ui/scene/index.tsx` `SceneView`: tiles, coast, sea, fog; flat depth-tested number
  tokens of radius `TOKEN_RADIUS` at the hex centre (never scaled); render order tile 0 < token 1
  < routes 2 < buildings 3 < robber/merchant 4 < highlights 5; seat-coloured pieces with ink
  outlines and emblem decals; the cream-outlined robber at `ROBBER_OFFSET`; robber rims and
  victim pins from `robberChoices`; setup and `intent` dots; spotlight; token flash and robbed-hex
  desaturation on the roll timeline; piece drops keyed by event id; `move` glides; fog reveal;
  camera fit to the board window from `layout.regions` (no DOM measuring); publishes screen
  points to `bridge`; host picking (raycast spot discs, `bridge.pick`); module layers with a keyed
  diff (port the `ExpansionLayers` pattern) in wave 3; instanced props; reduced motion.
- **Acceptance:** screenshots at 1280×720 and 1920×1080 of the 10-seat max-pieces fixture: no
  token overlaps any settlement, city or road (automated check of projected token discs vs
  projected footprints); token diameter 30–36% of the flat width; ownership readable at 25%
  scale including under deuteranopia/protanopia emulation; ≤ 700 draw calls; p95 frame < 20 ms.

### WP-hud (wave 2)

- **Consumes:** `PublicView` (`now`, `clock`, `turn`, `seats`, `offers`, `prompts`, `hud`,
  `events`, `settings`), `ui/shared`, WP-trade-ui offer cards, WP-theatre overlay, WP-sfx.
- **Provides:** `ui/display/index.tsx` `DisplayView` and the reusable TV frame (also mounted by
  WP-personal): fixed regions from `layout.regions`, turn banner from `now.title`/`now.detail`
  plus countdowns, seat rail (rows, timer rings from `seats[].deadline`, status badges, badges,
  race track, snake strip in setup, Table card), left rail (generic `hud` widgets, trade rail
  using WP-trade-ui `OfferCard`, ticker), `data-seat-chip` attributes for fly-out targets.
- **Acceptance:** fixtures at 3, 6 and 10 seats with 16-character names at 1280×720 and 1920×1080
  without clipping or overlap; 12 open offers with response chips; every stage's banner; the
  board window is identical across all fixtures (no jump).

### WP-theatre (wave 2)

- **Consumes:** `events`, `lastRoll`, `results`, `turn.stage`, `ui/shared` bridge and timeline.
- **Provides:** `ui/display/theatre/index.tsx` `Theatre` overlay (mounted by WP-hud and
  WP-personal): the one animation queue ordered by event id with the 2.5 s backlog rule and 3 s
  replay window; DOM dice (2 or 3 dice, total pop); resource fly-outs from
  `bridge.tileScreen` to `[data-seat-chip]`, one per (seat, good), capped at 14; steal card
  flights; "+n" chips; the persistent production strip (roll, blocked, shortage, 7 states); the
  finale reveal (hidden VP flips from `results.standings`, rank re-sort) between
  `results.finaleAt` and `completeAt`.
- **Acceptance:** roll to last fly-out ≤ 1.5 s at 10 seats with every seat producing (recorded);
  strip readable by 700 ms; reload mid-game replays nothing older than 3 s; reduced motion shows
  end states only.

### WP-results (wave 2)

- **Consumes:** `Outcome`, `PublicView.results`, `seats`, `ui/shared`.
- **Provides:** `ui/results/index.tsx` `ResultsView` (EXPERIENCE §3.11): hero, standings table
  with per-module columns from `ScorePart.key`, dice histogram with expected line, resources
  gained bars, robber and trade tables, awards; phone single-column variant marking "· you".
- **Acceptance:** 10 rows with ties and two-digit ranks fit at 1280×720; each row's parts sum to
  its total; renders with only `Outcome` if `results` is missing (shell fallback case).

### WP-map (wave 2)

- **Consumes:** `Board`, `Pieces`, geometry.ts, `ui/shared` seats/emblems/board index.
- **Provides:** `ui/map/index.tsx` `BoardMap` (port legacy `map.tsx`): SVG board with tokens at
  r 0.29, piece icons with emblems, harbour plaques, read-only mini mode (366×230), full-screen
  pan/pinch, auto-zoom to ≥ 48 px spot separation, hotspots (`role="button"`, `aria-label`,
  `data-spot`) for vertex/edge/tile/unit targets, ghost preview, the scoped focus-ring fix.
- **Acceptance:** the 10-seat max-pieces fixture at 320×568 and 390×844: every legal spot ≥ 48 px
  apart after auto-zoom; keyboard focus shows the small ring only.

### WP-trade-ui (wave 2)

- **Consumes:** `offers`, `partners`, `rates`, `hand`, `bank`, `why`, `ui/shared`.
- **Provides:** `ui/trade/index.tsx`: `TradePanel` (Players/Bank segments, tap-to-add composer,
  quick offers, recipients, bank shortcut, pinned "Your offer" with **Trade with Bo**, incoming
  offers with Accept/Decline/Counter), and `OfferCard` (the TV card with response chips, nesting,
  expiry bar, reasons) used by WP-hud. Both the phone and the host dock mount `TradePanel`.
- **Acceptance:** ≤ 5 taps for a 2-for-1 targeted offer from a fresh tab; 1 tap to accept; ≤ 3
  taps for a bank 3:1; paired-turn fixture disables Players with the `why.propose` text.

### WP-controller (wave 2)

- **Consumes:** `PrivateView` (`task`, `build`, `can`, `why`, `offers`, `prompts`, `commands`,
  `dev`, `rates`, `inbox`, `ext`) and `PublicView`; WP-map, WP-trade-ui, WP-sfx.
- **Provides:** `ui/controller/index.tsx` `ControllerView` (EXPERIENCE §4.1–4.6) and the panels
  WP-personal reuses: status header, duty cards, hand strip, task router by `task.kind`, build
  menu from `build[]` plus build-group `commands`, placement + confirm sheet, discard grid,
  robber hex/victim flow, pick grids (gold, plenty, monopoly), dev and progress cards, the
  generic `Command` sheet (fields in order, `then` dependents, map targets), movement, Connect
  readiness, End-turn confirm sheet, finale card, reconnect notice.
- **Acceptance:** every `Task` kind fixture at 320×568, 390×844, 667×375 and 844×390; primary
  action visible on arrival; the confirm sheet never covers its detail; End never adjacent to
  Build/Trade without the gap; drafts survive reload per player/round/turn; rejection messages
  shown.

### WP-personal (wave 3)

- **Consumes:** WP-hud frame, WP-theatre, WP-controller panels, WP-trade-ui, `bridge.pick`.
- **Provides:** `ui/personal/index.tsx` `PersonalView` (EXPERIENCE §4.9): TV frame with the host
  regions, the controller dock (collapsed/expanded sheet), placement on the 3D board via
  `bridge.pick` and ←/→ keys, **Hide hand** toggle.
- **Acceptance:** at 1280×720 the host completes roll, bank trade, road by clicking the 3D board,
  and end without the board being hidden or its bounds moving.

### WP-art (wave 1)

- **Consumes:** EXPERIENCE §1.5 and §1.8 (authoritative for art), geometry.ts `FOOTPRINT`.
- **Provides:** `art/common.py`, `art/pieces.py`, `art/props.py`, `art/expansions.py`,
  `art/build.sh` (`/opt/homebrew/bin/blender -b --factory-startup -P art/<file>.py -- <out>`),
  producing `pieces.glb`, `props.glb` and `expansions.glb` in
  `public/games/island-settlers/models/` with the §1.8 node names, material slot names (`seat`,
  `seat_dark`, `ink`, `cream`, `stone`, `wood`, `metal`, `sail`, `glow`, `outline`, `decal`),
  `<name>_outline` children, and the per-bundle triangle and file budgets. `art/README.md` lists
  nodes and a preview render per bundle.
- **Acceptance:** rebuild from source is byte-stable for unchanged inputs; budgets met; WP-scene
  loads every node with `GLTFLoader` and recolours `seat`/`seat_dark`.

### WP-qa (waves 3–4)

- **Consumes:** everything; the single owner of builds and browser sessions.
- **Provides:** fixture regeneration from real engine states (same names as WP-fixtures), the
  full-match harness in `tests/match/harness.ts`, the combination matrix, privacy and performance
  tests, the headless Playwright driver ported from legacy `tests/browser-expansions.js` +
  `prepare-browser.mjs` (reading WebSocket frames, acting through the UI with the CPU `decide`
  for moves), README.md, QA.md, EXPANSIONS.md, and the EXPERIENCE §7 feel checks with evidence.
- **Acceptance:**
  - `tests/match/**`: the matrix in §4.2 green.
  - `tests/privacy.test.ts`: no view ever contains another seat's hand, dev kinds, progress cards,
    fish values, deck order, fog faces, RNG state or CPU memory (deep scan against the state).
  - `tests/perf.test.ts`: budgets in ENGINE §16.
  - Browser: base 4-seat (2 phones + 2 CPUs) and 10-seat (headless phones) join → finale →
    results → replay; one Seafarers, one C&K and one E&P game to results; screenshots at the UI
    viewports; §7 feel checks recorded with build hash, viewport, roster and evidence path.

## 4. Shared test harness

### 4.1 Helpers (`tests/helpers.ts`, WP-core)

Port from legacy `tests/rules.test.ts` and `tests/expansions.test.ts`, rewritten for v2:

- `game(seats, settings?, seed?)`: `rules.create` with ids `p0…`, 16-character names.
- `act(s, seat, action, now?)`: `parseAction` + `applyAction` with the current `turn.id`.
- `view(s, seat)`, `pub(s)`: projections with `{ nowMs, phase: 'playing' }`.
- `grant(s, seat, cards)`: move cards from the bank (conservation-safe).
- `answer(s, seat, promptKind, picks, cards?)`, `command(s, seat, id, picks, cards?)`.
- `unchanged(s, fn)`: asserts `fn` throws and the state is deep-equal afterwards.
- `inventory(s)`: bank + hands + module stores per good, for conservation checks.
- `serializable(s)`: `assertSerializable` over the public view and every private view.
- `clock()`: an injectable `now` that tests advance explicitly.

### 4.2 Full-match loop (`tests/match/harness.ts`, WP-qa)

```
runMatch({ seats, settings, seed, maxSteps }):
  s = game(seats, settings, seed); stock = inventory(s); now = 0
  loop until ended or maxSteps:
    for each seat (humans driven by cpu.decide at Normal, CPUs by the scheduler in tick):
      action = decide(pub(s), view(s, seat), brain(seat))
      if action: act(s, seat, action, now); count accepted; on rejection record and fail
    now += 100; rules.tick(s, new Map(), 0.1, now)
    assert inventory(s) == stock
    every 100 steps: serializable(s); no prompt past deadline + 100 ms
  assert ended with reason 'target'; assert outcome complete; replay: fresh game(seed+1) in setup
```

Matrix (M5): each module alone and the heaviest legal stacks (Base + C&K + all five T&B;
Seafarers + C&K + Fishing + Rivers; Explorers + C&K + Fishing, all missions), at the suggested
target, × {3, 4, 6, 10} seats × {Standard, Connect} × 2 seeds, plus one Brisk-timer run per mode
where no action is taken for human seats (timeout-driven game reaches results).

## 5. Legacy pieces to port (checklist)

| Legacy | v2 home | Owner |
| --- | --- | --- |
| `core.ts` `longestRoute`, `awards` | `engine/score.ts` | WP-rules |
| `core.ts` `transfer`, `has`, `total`, `need` | `engine/cards.ts`, `engine/need.ts` | WP-core |
| `server.ts` applyAction clone-validate-commit | `engine/actions.ts` + `server.ts` | WP-core |
| `server.ts` `parseAction` bounds | `engine/parse.ts` | WP-core |
| `server.ts` `production` shortage rule | `engine/production.ts` | WP-rules |
| `server.ts` `rates` | `engine/trade.ts` | WP-trade |
| `server.ts` snake setup, dev deck | `engine/flow.ts`, `engine/dev.ts` | WP-core, WP-rules |
| `board.ts` vertex/edge merge, `shuffled` | `engine/board/graph.ts`, `engine/rng.ts` | WP-board, WP-core |
| `expansion-common.ts` `validateCommand`, `steal`, `cardPicker`, `connectedVertices` | `engine/commands.ts`, `engine/legal.ts` | WP-core, WP-rules |
| `expansion-settings.ts` restrictions, targets | `src/settings.ts` | WP-core |
| `cities-knights.ts` | `modules/cities-knights/**` | WP-ck |
| `traders-barbarians.ts` | `modules/{fishing,rivers,caravans,harbormaster}.ts` | WP-tb-a |
| `barbarian-scenarios.ts` | `modules/{barbarian-attack,deliveries}.ts` | WP-tb-b |
| `explorers-pirates.ts` | `modules/explorers/**` | WP-ep |
| `cpu-base.ts`, `cpu.ts` (BFS, discard, gold) | `cpu/**` | WP-cpu |
| `presentation.ts` labels/meta, drafts | `ui/shared/**` | WP-ui-shared |
| `map.tsx` BoardMap | `ui/map/**` | WP-map |
| `scene.tsx` camera fit (from layout constants, not `measureHud`), prop scatter; `scene-layers.ts` keyed diff | `ui/scene/**` | WP-scene |
| `scene.tsx` dice faces | `ui/display/theatre/**` (DOM dice) | WP-theatre |
| `tests/*` helpers and full-match loop | `tests/helpers.ts`, `tests/match/**` | WP-core, WP-qa |
| `tests/browser-expansions.js`, `prepare-browser.mjs` | `tests/browser/**` | WP-qa |
| `music.ts`, `audio.tsx` | unchanged | – |

## 6. Risks

- **Typecheck gap.** The new `model.ts` breaks the legacy files until WP-core's M1 deletion lands.
  Keep M1 short and do it first.
- **Module scope.** Full T&B and E&P are large (legacy estimate 20+ days together). The registry
  lets each land independently; a module that misses acceptance stays disabled in `settings.ts`
  with a reason rather than shipping half-done.
- **Model churn.** Module WPs will need projection fields; batch contract changes daily to avoid
  parallel edits to `model.ts`.
- **Human pacing.** Automated completion is not playtest evidence. QA.md must record real
  sessions separately from simulations.

## Reconciliation log

The reconciler checked DATA-NEEDS against model.ts, the plan against EXPERIENCE and the vision,
and resolved every contradiction it found. model.ts still wins; DATA-NEEDS §0 maps every
designer name to its model.ts field.

### model.ts (additive; standalone `tsc --strict` clean, no project errors in model/geometry)

- Constants: `FINALE_MS = 9000`; `SEAT_COLORS` (room colour order); `GRACE_SECONDS.disconnected`
  20 → **30**.
- `Settings.tableSize` doc: the table grows to fit more humans.
- `BoardFeature` `barbarian-path` (C&K ship waypoints). `Unit.level` doc: expedition cargo slots.
- `Stage` and `TaskKind` gain `finale`. `SetupInfo.round`. `Turn.next`.
- `Now` is `{ seats, title, detail }` (was `text`) for the two-line banner.
- `PublicSeat`: `seat` (0–9 palette/emblem index), `status: SeatStatus`, `deadline`,
  `discardLimit`, `badges: Badge[]`.
- `PromptChip.count` (discard counts, picks owed).
- `Offer`: `at`, `broadcast`, `reasons`; `OfferResponse` gains `counter`.
- `PublicView`: `robberChoices: RobberChoice[]`, `intent: Intent | null`, `hud: HudItem[]`;
  `results` documented as present from the finale. `Results.finaleAt`, `completeAt`.
- New types: `SeatStatus`, `Badge`, `HudItem`, `RobberChoice`, `Intent`, `IntentPiece`.
- `ModulePublic['friendly-robber'] = { safe }`; C&K `progress` documented as a card count.
- Actions: `respond.reason?` (≤ 80 chars); new `intent` action.
- Events: `robber.from`; `trade.offer`; new `offer`, `payout`, `move`, `barbarians`;
  `dev-play.taken`; `PieceKind` gains `metropolis`.
- `PrivateEvent.other`; `Task` gains `title` and `auto`; `PrivateView.why`; `BuildOption.left`.
- `SeatStats.robbed/stole` documented (cards stolen from / by the seat).

### geometry.ts

- `FOOTPRINT` now matches EXPERIENCE §1.5 plinths: settlement 0.22, city 0.36, road 0.54 × 0.12,
  robber 0.17 (was 0.24 / 0.30 / 0.62 × 0.16). New `ROBBER_OFFSET = 0.5`. `TOKEN_RADIUS` stays
  0.29.

### Contradictions resolved

| Topic | Before | Decision |
| --- | --- | --- |
| Timer values | EXPERIENCE §4.4 (Relaxed 90/20/120/45/45/40/30) vs model `TIMERS` (60/15/120/45/40/30/40/45) | model `TIMERS` kept; EXPERIENCE table rewritten to mirror it, with the missing "other prompts" column |
| Disconnect grace | 20 s (ENGINE) vs 45 s (EXPERIENCE, feel check 12) | **30 s** everywhere; away 5 s and reconnect ≥ 15 s unchanged |
| Default timer | open question | Relaxed kept (both designers agree) |
| Piece footprints | geometry 0.24 / 0.30 / 0.62 × 0.16 vs EXPERIENCE plinths | EXPERIENCE values; robber, pirate and merchant never take `pieceScale` (a 1.2× city would touch a 1.2× robber) |
| Snapshot cache | DATA-NEEDS: `revision` + board/routes/buildings/pieces | model: `mapRev` + `board`/`pieces`/`settings` (robber moves bump it; rare enough) |
| Game end | ENGINE: results + complete at `ended` | new `finale` stage holds 9 s with results public; complete only at `ended` (SceneView unmounts at results) |
| Seat colours | ENGINE: CPU palette avoiding humans | unique `seat` index = `SEAT_COLORS.indexOf(color)`, CPUs take free indices |
| Targeted trade | EXPERIENCE: "after you accept, waiting for Bo to choose" | a single-recipient offer completes on accept; the wait + Cancel (= decline) copy applies to multi-recipient offers only |
| Response states | model had no `counter`; DATA-NEEDS hid `unable` | `counter` added; `unable` stays in the view and the TV hides it |
| Event text | DATA-NEEDS: client writes text; ENGINE: server `text` | server always writes `text`; clients render core kinds from fields and fall back to `text` |
| Dice and fly-outs | WP-scene brief (3D) vs EXPERIENCE (DOM dice, DOM fly-outs) | DOM, owned by WP-theatre; the scene does token flash, robbed-hex tint, drops |
| Camera fit | WP-scene port of `measureHud` / `data-is-reserve` | fit to `layout.regions` constants; no DOM measuring (EXPERIENCE §2) |
| Bridge / emblems paths | `ui/scene/bridge.ts`, `ui/emblems.ts` | `ui/shared/bridge.ts`, `ui/shared/emblems.ts`, `ui/shared/seats.ts` (keeps three.js out of HUD bundles) |
| Art pipeline | BUILD-PLAN: `art/build.py`, 1,500 tris / 60 KB per model, 2 material slots | EXPERIENCE §1.8: three bundles, `build.sh` + 4 scripts, 11 material slots, per-bundle budgets |
| Connect setup timer | EXPERIENCE: "longer" | same setup timer as Standard |
| Results ownership | WP-hud owned `results.tsx` | new WP-results owns `ui/results/**` |

### Build plan

- Ownership table rewritten with waves and EXPERIENCE section assignments.
- New packages: **WP-fixtures** (split from WP-qa so UI and CPU start on day 1), **WP-sfx**,
  **WP-theatre**, **WP-results**, **WP-map**, **WP-trade-ui**, **WP-personal**.
- WP-art brief aligned to EXPERIENCE §1.8. WP-ui-shared owns `client.tsx` from the start (no
  WP-core stub) and publishes the day-1 shared UI contract (§3.1).
- WP-core brief: finale, seat index, table growth, new projections, `intent`, 30 s grace.
- WP-trade brief: counters, changeable answers, reasons, `offer` events. WP-rules brief: new
  events. Module WP brief: `hud` and `badges` hooks (added to ENGINE §14.1) so modules never
  touch UI files.
- §2 replaced by the wave plan. Port checklist: BoardMap → WP-map, dice faces → WP-theatre.

### Other doc edits

- ENGINE: seating/palette rule, `Seat.seat`, finale (§3.9, §12), trade response rules (§9.2),
  event list and text policy (§13), `hud`/`badges` hooks (§14.1), projection notes (§17), grace
  30 s (§6), main-timeout auto places owed free routes, open question 2 marked resolved.
- EXPERIENCE: timer table, grace, Connect setup, trade accept copy, robber no-scale rule, 7–10
  paired banner note, banner source (`now`), shared-file paths.
- DATA-NEEDS: new §0 mapping table and the list of needs dropped in favour of derivation.

### Scope check

Covered: base 3–4 / 5–6 / 7–10 (WP-board), Standard with paired turns and Connect (WP-core),
Seafarers (3 generated scenarios), Cities & Knights, Fishing, Rivers, Caravans, Barbarian
Attack, Deliveries, Friendly Robber, Harbormaster, Explorers & Pirates with all three missions,
3–10 seats (CPUs fill; 1–2 humans get CPUs), CPU Easy/Normal/Sharp with personas, Off/Relaxed/
Brisk timers, kept music. Not in scope (never requested): T&B event-card deck, two-player
variant, printed scenario boards.
