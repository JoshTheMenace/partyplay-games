# Island Settlers v2: what the UI needs from the engine

This is every field and event that the screens in [EXPERIENCE.md](EXPERIENCE.md) read. The engine contract (`src/model.ts`) should be checked against it line by line. The section references (§) point to EXPERIENCE.md.

## 0. Reconciled: read model.ts names, not the names below

Every need below was checked against `src/model.ts`. **Build against model.ts.** The sections after this one keep the designer's original wording as the rationale; this table says where each need lives. "Derive" means the client computes it from the listed fields.

| Need (this doc) | model.ts |
|---|---|
| `revision`; cached `board`, `routes`, `buildings`, `pieces` | `mapRev`; cached `board`, `pieces` (buildings, routes, units, robber, pirate, merchant, reveals), `settings` |
| `settings.timerPreset`, `modules` | `settings.timer`; `PublicView.modules` |
| `discardLimit` | `seats[].discardLimit` |
| tiles `z`, `number: null`, `pips` | `y` (scene maps y → −z); `number: 0` for none; derive with `geometry.pips` |
| edge `river`, fishing/rivers/castle/depots/lairs/spices/oasis | `board.features` (`river`, `bridge-site`, `fishing-ground`, `depot`, `landing`, `lair`, `spice`, `council`); oasis/lake/castle are `terrain` |
| `barbarianPath` | `board.features` kind `barbarian-path` (8 tiles) |
| port `resource`, `seaTile` | `good`, `tile` |
| routes/buildings/`pieces.knights/guards/wagons/ships` | `pieces.routes` (`bridge` flag), `pieces.buildings` (`wall`, `metropolis`), `pieces.units` (kind, `level`, `active`, `cargo`; expedition `level` = cargo slots) |
| seat `seat: 0-9` | `seats[].seat` (index into `SEAT_COLORS`) |
| `cpuLevel` per seat | `settings.cpuLevel` (one level per table) + `seats[].cpu`, `persona` |
| `status`, `statusCount`, `deadline`, `graceUntil` | `seats[].status`, `seats[].deadline`; counts from `prompts[].count`; grace = `!connected && deadline` |
| `vpParts`, `handCount`, `devCount`, `knightsPlayed`, `piecesLeft` | `parts`, `cards`, `dev`, `knights`, `left` |
| `progressCount`, `improvements` | `ext['cities-knights'].seats[id].progress` / `.improvements` |
| `badges` | `seats[].badges` (`Badge`) |
| `phase` | `turn.stage` (adds `finale`) + open `prompts` + `results` |
| `turnId`, `activeId`, `pairedTurn`, `nextId` | `turn.id`, `turn.active`, `turn.partner` (non-null = paired), `turn.next` |
| `setup {round, order, index, piece}` | `turn.setup {seat, piece, round, index, total}`; order = `seats` forward then back |
| `waitingOn` | `prompts: PromptChip[]` (`seat`, `kind`, `count`, `deadline`) + `seats[].status` |
| `connect {deadline, readyIds}`, `blockedBy` | `clock` + `seats[].ready`; blocked = offline seat with a `deadline` |
| `intent` | `intent: Intent` + action `{ type: 'intent', piece }` |
| `dice` | `lastRoll` (`dice[0]` is red in C&K, `eventDie`, `id` = roll id) |
| `robberTile`, `pirateTile`, `merchant` | `pieces.robber`, `pieces.pirate`, `pieces.merchant` |
| `robberLegal`, `robberVictims` | `robberChoices[]` (`tiles[].tile`, `tiles[].victims`) |
| `friendlyRobberSafe` | `ext['friendly-robber'].safe` |
| offer `createdAt`, `get`, `to: null`, `parentId`, `expiresAt`, `reasons` | `at`, `want`, `broadcast: true`, `counterTo`, `expires`, `reasons`; responses add `counter`, `unable` (hide `unable`) |
| events `type`, `atMs` | `kind`, `at`; all events carry server `text` |
| `roll` + `production` + `seven` | one `roll` event (`grants`, `blocked`, `shortages`; nobody = no grants); 7 discards = `discard` prompt chips + `discard` events |
| `robber-moved`, `stole`, `discarded`, `dev-bought`, `dev-played`, `monopoly`, `plenty`/`gold` | `robber` (`from`, `tile`), `steal`, `discard`, `dev-buy`, `dev-play` (`taken` per victim), `take` |
| `setup-payout` | `payout` (`grants`) |
| `move` | `move` (`piece`, `unit`, `from`, `to`) |
| `offer-posted`, `offer-closed`, `offer-response` | `offer` (`change`); responses: diff `offers[].responses`; completed: `trade` with `offer` id |
| `bank-trade`, `award`, `turn`, `auto`, `presence`, `reveal`, `win` | same names (`bank`, `award`, …); `reveal` is one event per tile |
| `upgrade` | `build` (`knight`, `wall`, `metropolis`) or `module` events; the scene diffs `units` by id for level/active changes |
| `barbarians` | `barbarians` event |
| `hud` | `hud: HudItem[]` (`holder.seat` instead of `playerId`) |
| typed layers (barbarian ship, invaders, caravan, fog, lairs, shoals, spices, boot, wealthiest) | `ext.*` typed module state + `pieces.units` + `board.features`; fog = tiles with terrain `fog` not in `pieces.reveals` |
| `finale`, `stats`, `outcome.rows` | `results` (from the finale: `finaleAt`, `completeAt`, `standings` with hidden parts, `stats`), `turn.stage === 'finale'`, `FINALE_MS` |
| private `vp`, `hiddenVp` | `vp`, `parts` (hidden parts flagged `hidden`) |
| `task {kind, deadline, autoAction, count}` | `task {kind, title, text, prompt, deadline, auto}`; prompt specifics from `prompts[].kind` and its `Command` fields (discard count = cards field `min`) |
| `can.trade/bankTrade/buyDev/playDev`, `why` | `can.propose/bank`, `build` entry `development`, `dev[].playable`; `why.propose/bank`, `build[].why`, `dev[].why`, `offers[].why` |
| `legal.*`, `buildHints` | `build[]` (`targets`, `cost`, `missing`, `why`, `free`, `left`), `shipMoves`, prompt/command fields (`PickField.target` = map) |
| `commands` (`map`, `forced`) | `commands` (voluntary; `PickField.target`), forced ones are `prompts[].command` |
| `offers` map, `lastPayout` | `offers: OfferState[]`; derive payout from `lastRoll.grants` for your seat |
| private events | `inbox: PrivateEvent` (`text`, `cards`, `tone`, `other`) |
| `movement.remaining`, `fish`, `coins`, `progress` | `ext.explorers.movesLeft`, `ext.fishing.fish`, public `ext.rivers/explorers.coins`, `ext['cities-knights'].progress` |
| actions `ready`, `buy-development`, `move`, `discard`/`pick`/`robber`, `expansion`, `complete-offer`, `cancel-offer` | `end`, `buy-dev`, `move-ship` (other moves are commands), `answer`, `command`, `confirm-trade`, `withdraw`; `offer.to: []` = everyone |

Dropped on purpose (derive instead): `pips`, `nobody`, the setup `order` list, C&K `knights?`/`walls?` left in public rows (the owner sees them in build/command details), `lastPayout`, `blockedBy`.

## Rules for all fields

- **Serializable.** Projections contain no `undefined`, NaN, Map or class instances. Use `null` or leave a field out.
- **Time.** All times are server epoch ms (`nowMs`). The client compares them with `serverNowMs()`, and never uses durations measured from receipt.
- **Ids.** Tile, vertex, edge, player, offer and event ids are stable strings for the whole round. Event ids go up and never repeat.
- **Cost.** Public views are rebuilt once per revision and private views about 10 times per second per socket, so both have to be cheap:
  - Private derived lists such as `legal`, `buildHints` and `commands` are computed once per revision and cached.
  - Stats appear only in the finale.
- **Secrets.** Hidden information stays out of the public view: hands, dev card types, hidden VP, the deck order, the RNG and CPU plans.

## 1. Snapshot cache

- **Cached public fields.** `board`, `routes`, `buildings` and `pieces`. `pieces` holds the expansion board pieces from §1.5 that change rarely: knights, walls, metropolises, bridges, wagons and expedition ships.
- **`revision`** (manifest `revisionField`). A nonnegative integer that is bumped **only** when one of those four fields changes, fog reveals included.
- The four cached fields must always be present, even when empty.

## 2. Public view

### 2.1 Settings echo: `settings`

| Field | Used by |
|---|---|
| `mode: 'standard' \| 'connect'` | banner copy, Connect UI (§4.2) |
| `map: 'base' \| 'seafarers' \| 'explorers'` | camera fit, assets |
| `targetPoints` | race track (§3.2) |
| `timerPreset: 'off' \| 'relaxed' \| 'brisk'` | timer display |
| `cpuLevel: 'easy' \| 'normal' \| 'sharp'` | seat rail E/N/S letter |
| `modules: string[]` (for example `'cities-knights'`, `'fishing'`, `'rivers'`, `'caravans'`, `'barbarian-attack'`, `'traders'`, `'friendly-robber'`, `'harbormaster'`, and the E&P missions) | asset bundle choice, HUD slot A |
| `discardLimit` | 7 plus wall bonuses. Coral card counts on the TV (§3.2). Per-player limits live in `seats[].discardLimit`. |

### 2.2 Board (cached, static after setup except fog reveals)

- **`board.tiles[]`:**
  - `{ id, q, r, x, z, terrain, number: number | null, pips: 0-5, island: number }`
  - `terrain` is one of the §1.2 names, plus `'fog'` until it is revealed.
  - `number` is null for the desert, sea, fog, castle and lake.
- **`board.vertices[]`:** `{ id, x, z, tiles: string[], edges: string[] }`
- **`board.edges[]`:** `{ id, a, b, tiles: string[], land: boolean, sea: boolean, river: boolean }`
- **`board.ports[]`:** `{ id, edge, vertices: [string, string], resource: Resource | 'any', ratio: 2 | 3, seaTile }`. The UI needs `seaTile` to place the plaque (§1.4).
- **Static expansion features**, part of `board` so they are never added after setup:
  - `fishing: { grounds: { id, seaTile, edge, vertices: string[], numbers: number[] }[], lakeTile: string | null } | null`
  - `rivers: { edges: string[], bridgeSites: string[] } | null`
  - `castleTile: string | null`
  - `depots: { tile, vertex, kind: 'castle' | 'quarry' | 'glassworks' }[]`
  - `barbarianPath: string[]`. These are 8 sea tile ids in track order for the C&K ship waypoints. It may be empty, in which case the client falls back to a derived coastline path.
  - `oasisTile`, `spices`, `shoals` and `lairs` tiles (E&P). The dynamic state of these goes in §2.9.

### 2.3 Pieces (cached)

- **`routes[]`:** `{ edge, playerId, kind: 'road' | 'ship' | 'bridge' }`
- **`buildings[]`:** `{ vertex, playerId, kind: 'settlement' | 'city' | 'harbor', wall: boolean, metropolis: 'science' | 'trade' | 'politics' | null }`
- **`pieces`:**
  - `knights: { id, playerId, vertex, level: 1 | 2 | 3, active: boolean }[]`
  - `guards: { id, playerId, edge, level, active }[]` (Barbarian Attack)
  - `wagons: { id, playerId, vertex, level: 1 | 2 | 3, cargo: 'tools' | 'sand' | 'marble' | 'glass' | null }[]`
  - `ships: { id, playerId, edge, cargo: ('settler' | 'crew' | 'fish' | 'spice')[], slots: number }[]` (E&P expedition ships; `slots` for the empty-slot visuals)

### 2.4 Seats: `seats[]` (ordered by seat order around the table)

| Field | Used by |
|---|---|
| `id, name` | everywhere |
| `seat: 0-9` | unique palette and emblem index (§1.6). Humans map from their platform colour index and CPUs take the unused indices. |
| `cpu: boolean, cpuLevel: 'easy' \| 'normal' \| 'sharp' \| null` | CPU pill, level letter |
| `connected: boolean` | offline badge |
| `status` | seat status line and badge (§3.2). One of `'idle' \| 'rolling' \| 'acting' \| 'building' \| 'discarding' \| 'choosing' \| 'robbing' \| 'moving' \| 'thinking' \| 'done' \| 'offline'`. `'thinking'` is a CPU with a scheduled step. |
| `statusCount: number \| null` | "Discarding 4", gold picks owed |
| `deadline: number \| null` | timer ring. It is set when this seat is currently required to act. |
| `graceUntil: number \| null` | "Offline: auto-plays in 0:42" |
| `vp: number` | **public** VP only |
| `vpParts: { settlements, cities, longestRoad, largestArmy, islands, harbors, metropolis, defender, modules: { key, label, value }[] }` | results breakdown, finale |
| `handCount, devCount` | stats line. `devCount` counts all unplayed dev cards, VP cards included, as face-down cards. |
| `progressCount: number \| null` | C&K replaces the dev count |
| `knightsPlayed, longestRoute` | stats and ribbons |
| `discardLimit` | coral warning on the hand count |
| `piecesLeft: { roads, ships, settlements, cities, knights?, walls? }` | line 3 (≤ 6 seats), build hints. Use `0` rather than leaving a count out when the module is on. Leave it out when the module is off. |
| `badges: { key, icon, value, label }[]` | module stats on seat rows: fish count, coins, improvements (`value` as three digits or a separate `improvements` field), mission counts, deliveries, captured barbarians. `icon` is a client icon key. |
| `improvements: { science, trade, politics } \| null` | C&K 3-bar widget |

### 2.5 Turn and step

| Field | Used by |
|---|---|
| `phase` | top-level screen routing. One of `'setup' \| 'roll' \| 'action' \| 'discard' \| 'robber' \| 'prompt' \| 'movement' \| 'connect' \| 'finale' \| 'ended'`. |
| `turnId: number` | stale-turn guard in actions, draft keys |
| `turn: number, round: number` | results ("23 rounds"), Connect "Round 4" |
| `activeId: string \| null` | banner, spotlight, active row |
| `pairedTurn: boolean` | "Build turn" copy, trade restriction (5+ seats) |
| `nextId: string \| null` | "Next up" chevron |
| `setup: { round: 1 \| 2, order: string[], index: number, piece: 'settlement' \| 'road' \| 'ship' \| 'harbor' } \| null` | snake strip, banner (§3.9) |
| `waitingOn: { playerId, kind, count: number \| null, deadline: number \| null }[]` | banner subline "Discarding: Ana (4), Bo (5)", the "Waiting on" lists. `kind` is `'discard' \| 'gold' \| 'robber' \| 'offer-choice' \| 'prompt' \| 'reconnect'`. This one list drives every prompts-in-progress indicator. |
| `connect: { deadline, readyIds: string[] } \| null` | Connect round timer and readiness |
| `blockedBy: { playerId, until } \| null` | disconnect banner (only when the table actually waits on that player) |
| `intent: { playerId, kind: 'settlement' \| 'city' \| 'road' \| 'ship' \| 'knight' \| 'move' \| 'robber', legal: string[] } \| null` | TV legal-target dots while the active player is choosing (§2). `legal` is the public legal set for that kind. It is set by the `intent` action and cleared on the next build or end. This is optional P1; without it the TV shows dots only during setup and the robber. |

### 2.6 Dice, robber, pirate, merchant

- `dice: { a, b, total, red: number | null, event: 'ship' | 'science' | 'trade' | 'politics' | null, rollId: number } | null`. `red` and `event` are for C&K.
- `robberTile: string | null`, `pirateTile: string | null`
- `robberLegal: string[]`. This is public during the robber phase only, for the TV rims. Otherwise `[]`.
- `robberVictims: Record<tileId, string[]>`. Public during the robber phase, for the TV emblem pins. Otherwise `{}`.
- `merchant: { tile, playerId } | null`
- `friendlyRobberSafe: string[]`. The seat ids protected by Friendly Robber, used for the phone and TV copy.

### 2.7 Offers: `offers[]` (open offers only; a completed or withdrawn one leaves an event)

| Field | Used by |
|---|---|
| `id, from, createdAt` | card order |
| `give: Hand, get: Hand` | card body |
| `to: string[] \| null` | `null` means everyone, used for the audience label |
| `parentId: string \| null` | counter-offer nesting |
| `responses: Record<playerId, 'pending' \| 'accept' \| 'decline' \| 'counter'>` | response chips. It includes only eligible players who can afford the offer; the rest are auto-declined and left out. |
| `reasons: Record<playerId, string>` | CPU decline reasons, one line each ("not while you're at 8 VP") |
| `expiresAt: number \| null` | expiry bar |

### 2.8 Events: `events[]` (last 40, each `{ id, atMs, type, ... }`)

Animations, sounds, the ticker, the production strip and phone duty cards all key off `id`. The text is written by the client from the structured fields.

| type | Fields | Drives |
|---|---|---|
| `roll` | `playerId, dice: {a, b, red?, event?}, total, rollId` | dice theatre, roll sound |
| `production` | `rollId, total, gains: {playerId, tileId, resource, count}[], blocked: {tileId, playerId, resource, count}[], short: Resource[], nobody: boolean` | token flash, fly-outs, the strip, phone payout card |
| `seven` | `rollId, discards: {playerId, count}[]` | the strip's 7 state |
| `discarded` | `playerId, count` | the waiting list shrinking, ticker |
| `robber-moved` | `playerId, from, to, pirate: boolean` | robber hop, desaturation |
| `stole` | `thiefId, victimId, count` (no resource type in public) | steal flight, ticker |
| `build` | `playerId, kind: 'road' \| 'ship' \| 'settlement' \| 'city' \| 'harbor' \| 'wall' \| 'knight' \| 'bridge' \| 'metropolis' \| 'wagon', target, setup: boolean` | drop/grow, burst, build sounds |
| `setup-payout` | `playerId, gains: {tileId, resource, count}[]` | round-2 fly-outs |
| `upgrade` | `playerId, kind: 'knight-promote' \| 'knight-activate' \| 'improve' \| 'wagon', target, level` | piece swap, ticker |
| `move` | `playerId, piece: 'ship' \| 'knight' \| 'wagon' \| 'expedition' \| 'guard', from, to` (one per step) | glide or sail |
| `dev-bought` | `playerId` | ticker, deck count |
| `dev-played` | `playerId, kind` (public: knight, road-building, plenty, monopoly; VP cards are never played publicly) | ticker, banner |
| `monopoly` | `playerId, resource, taken: {playerId, count}[]` | flights from each victim, ticker |
| `plenty` / `gold` | `playerId, count` (public) | flights from the bank icon |
| `offer-posted` | `offerId, from, to` | offer card enter, pluck sound |
| `offer-response` | `offerId, playerId, response` | chip change |
| `trade` | `offerId, from, partnerId, give: Hand, get: Hand` | complete flash, arpeggio, ticker |
| `offer-closed` | `offerId, reason: 'withdrawn' \| 'expired' \| 'invalid'` | card collapse |
| `bank-trade` | `playerId, give: Hand, get: Hand, ratio` | ticker |
| `award` | `kind: 'longest-road' \| 'largest-army' \| 'metropolis' \| 'harbormaster' \| 'wealthiest' \| 'mission', playerId: string \| null, previousId: string \| null, detail: string \| null` | ribbon change, ticker |
| `turn` | `playerId, paired: boolean, round` | banner, turn start sound, phone "Your turn" haptic |
| `auto` | `playerId, action: 'roll' \| 'end' \| 'discard' \| 'robber' \| 'setup' \| 'decline' \| 'pick', reason: 'timer' \| 'offline'` | ticker "Auto-ended Bo's turn (timer)" |
| `presence` | `playerId, connected` | ticker |
| `barbarians` | `position, attacked: boolean, knights: number, cities: number, result: 'defended' \| 'pillaged' \| null, losers: string[], defenders: string[]` | HUD track, attack banner, drum sound |
| `reveal` | `tiles: string[]` (fog) | fog reveal |
| `module` | `module, key, playerId: string \| null, text: string` | fallback ticker line for rare module events (fish spends, caravan votes, deliveries, lair captures). The server writes plain text for these only. |
| `win` | `winnerIds: string[]` | finale start, victory sound |

### 2.9 Module public state (dynamic, not cached)

- **`hud: HudItem[]`** (generic, for slot A in §3.4). A `HudItem` is one of:
  - `{ kind: 'track', key, label, value, max, alert: boolean, icon }` (C&K barbarians, caravan camels)
  - `{ kind: 'versus', key, label, left: {label, value}, right: {label, value} }` ("Knights 5 vs cities 6")
  - `{ kind: 'table', key, label, rows: {label, values: Record<playerId, number>, max: number \| null}[] }` (E&P missions, deliveries)
  - `{ kind: 'holder', key, label, playerId: string \| null, icon }` (metropolis per track, harbormaster, pirate lairs, old boot)
- **Typed layers the scene needs:**
  - `barbarianShip: { position: 0-7 } | null`
  - `invaders: { tile, count }[]`
  - `caravan: { segments: {edge, from, to}[], bids: {playerId, count}[] } | null`
  - `fogTiles: string[]`
  - `lairs: { tile, captured, crews: string[] }[]`
  - `shoals: { tile, number, fish }[]`
  - `harbors: { vertex, cargo: string[] }[]`
  - `spices: { tile, benefit, visitors: string[] }[]`
  - `bootOwner: string | null`
  - `wealthiest: string | null`, `poorest: string[]`

### 2.10 Finale and outcome

- `finale: { winnerIds, startedAt, endsAt, hiddenVp: Record<playerId, number>, finalVp: Record<playerId, number>, ranking: string[] } | null`. It is present only in the `finale` and `ended` phases.
  - The engine holds `finale` for about 9 s (`endsAt`), with ticks continuing.
  - `outcome().complete` becomes true only once `nowMs >= endsAt`, because SceneView unmounts at results (§3.10).
- `stats` is present only in `finale` and `ended`:
  - `durationMs, rounds, dice: number[13]` (index = total)
  - `perPlayer: Record<playerId, { gained: Hand, stolenFrom: number, stoleCards: number, robbedTimes: number, discarded: number, playerTrades: number, bankTrades: number, devBought: number, longestRouteMax: number, knightsPlayed: number }>`
- `outcome.rows`: `{ playerId, score, rank, label }`. `label` is, for example, "10 VP". ResultsView reads the breakdown from `seats[].vpParts` plus `finale`.

## 3. Private view (the owner's phone only)

| Field | Used by |
|---|---|
| `hand: Hand` (resources plus commodities when C&K) | hand strip, trade, discard |
| `vp: number, hiddenVp: number` | header "7 VP, 1 hidden" |
| `rates: Record<Good, 2 \| 3 \| 4>` | ratio badges, Bank segment (§4.7) |
| `bank: Hand` | Bank get availability, plenty/gold grids |
| `task: { kind, deadline: number \| null, autoAction: string \| null, count: number \| null }` | screen router (§4.2) and the header subline. `kind` is `'wait' \| 'setup' \| 'roll' \| 'act' \| 'build-turn' \| 'discard' \| 'robber' \| 'victim' \| 'gold' \| 'plenty' \| 'monopoly' \| 'free-roads' \| 'prompt' \| 'movement' \| 'connect' \| 'done' \| 'ended'`. `autoAction` is plain copy such as "roll for you". Private duties come first. |
| `can: { roll, end, trade, bankTrade, buyDev, playDev }`: booleans | action bar enabling |
| `why: Record<string, string>` | reasons for disabled controls ("Build turns trade with the bank only") |
| `legal: { settlements, cities, roads, ships, harbors, walls, knights, robber, pirate, bridges: string[], shipMoves, knightMoves, wagonMoves: { from, to: string[] }[], victims: Record<tileId, { playerId, handCount }[]> }` | placement hotspots, robber flow. All lists are always present (empty arrays). |
| `buildHints: { kind, label, cost: Hand, affordable: boolean, missing: Hand, spots: number, piecesLeft: number \| null, reason: string \| null }[]` | Build menu rows, can-build chips, the Build tab dot, the End confirm sheet reminders |
| `dev: { id, kind, playable: boolean, reason: string \| null }[]` | Cards tab |
| `progress: { id, kind, track, playable, reason }[]` (C&K) | Cards tab |
| `fish: { id, value }[]`, `coins: number` | module command costs |
| `commands: ExpansionCommand[]` | the generic command UI (§4.2). Keep the legacy shape `{ id, group, label, detail, fields: CommandField[], cost?, cards? }` with the field `map: 'vertex' \| 'edge' \| 'tile'`. It includes forced prompts marked `forced: true`. |
| `offers: Record<offerId, { canAccept: boolean, reason: string \| null, mine: boolean }>` | Accept enabling and reasons |
| `lastPayout: { rollId, total, gains: { resource, count, tileId, number }[], blocked: { resource, count, tileId }[] } \| null` | waiting "+1 wool from 10" card |
| `private events: { id, atMs, type: 'stolen' \| 'stole' \| 'monopolized' \| 'received', resource, count, otherId }[]` (last 10) | "Bo robbed your ore" duty card and haptic, thief's "You stole 1 ore" |
| `discardDue: number, pickDue: number` | discard and pick counters |
| `movement: { remaining: number } \| null` | "Moves left: 3" |

## 4. Actions the UI sends (payload ≤ 1024 bytes; every one carries `turnId`)

- **Turn:** `roll`, `end`, `ready` (Connect "Done"), `buy-development`
- **Building and moving:** `build {kind, target}`, `move {piece, from, to}`
- **Discards and picks:** `discard {cards}`, `pick {cards}` (gold, plenty), `monopoly {resource}`, `play-development {cardId}`
- **Robber:** `robber {target, victim | null, pirate}`
- **Bank:** `bank {give: Hand, get: Hand}`. Multiples are allowed; the server checks the rates.
- **Offers:**
  - `offer {give, get, to: string[] | null, parentId: string | null}`
  - `respond {offerId, response: 'accept' | 'decline'}`
  - `complete-offer {offerId, partner}`
  - `cancel-offer {offerId}`
- **Expansions:** `expansion {command, choices, cards?}`
- **Optional:** `intent {kind | null}`, sent once when entering or leaving placement mode and never while hovering.

Budget: a typical 60-minute game with an active trader stays under about 900 actions, well within the 4096 limit.

## 5. Derived on the client (not needed from the server)

- Hex geometry, corners, edge angles and screen projections (`src/geometry.ts`).
- Seat palette, emblems, and the text of every copy line built from structured events.
- Animation queue state and the "already played" event id watermark.
- Quick-offer suggestions and bank auto-fill (computed from `hand` plus `rates`).
- Mini-map layout and zoom.
