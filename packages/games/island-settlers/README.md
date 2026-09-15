# Island Settlers

An in-progress Catan-inspired game for 1–10 people, with CPUs filling tables to at least three players. The laptop/TV shows the board; players can join with phones for private cards, trading, and placement. A seated host can switch between their hand and the board on one device. Claude Fable authored the frontend and animations; Codex owns rules, integration, and verification.

Players can open **Rules** from their phone header during play. The topic picker covers the base game, this room’s turn style and victory target, and enabled expansions, missions and variants. It preserves unfinished actions and does not pause the room.

## Implemented rules

- Snake-order setup, seeded terrain and number placement, five finite resource supplies, dice production, ports, roads, settlements, cities, and piece limits.
- Robber/discards/theft; Knight, Road Building, Year of Plenty, Monopoly, and hidden victory-point development cards; purchase-turn restrictions; Longest Route and Largest Army.
- Public offers and counteroffers, explicit acceptance, proposer confirmation, bank trades, and atomic exchanges. A spent hand invalidates unaffordable offers/acceptances.
- **Standard:** one main turn, then a paired action turn for five or more players. The paired player is halfway around the roster and cannot trade with players. Games finish when the active player reaches the chosen target.
- **Connect-style:** shared automatic production, simultaneous trading/building, 60/90/120-second action rounds, and a three-second minimum before advancing when everyone is done. Confirmed placements claim contested spots. Victory is checked at round end; equal highest qualifying scores share victory.
- **Seafarers / Open Seas:** a generated home island and six smaller islands, ships and ship movement, pirate, gold production choices, mixed road/ship routes, and two points for the player's first settlement on each new island.
- **Cities & Knights:** commodities, three improvement tracks, metropolises, walls, knight actions, barbarian defense and private progress cards.
- **Traders & Barbarians:** independently selectable fishing, rivers/bridges/gold, merchant-train bidding, coastal barbarian attacks, and wagon deliveries. Friendly Robber and Harbormaster are optional variants.
- **Explorers & Pirates:** hidden exploration, movable cargo ships, harbor settlements, settlers and crews, pirate-lair capture, fish delivery and spice-trade missions. Select the missions individually.
- Phone disconnects pause actions and the Connect clock until every seated player returns. Reload uses the existing room credentials; seats and accepted actions persist for the life of the room.

The default is Standard + Seafarers, 12 points. Every supported map/expansion combination can use either turn style. Cities & Knights works with Base, Seafarers, or Explorers & Pirates. All five Traders & Barbarians scenarios can be stacked on Base or Seafarers; only fishing accompanies Explorers & Pirates. Settings explain incompatible choices. See [EXPANSIONS.md](EXPANSIONS.md) for rules sources and adaptations. The hour target is not established by automated testing. Standard play, larger rosters, and learning games can take longer.

## Deliberate adaptations and current limits

This is not a complete reproduction of all CATAN editions or scenarios. The 3–4-player base uses the familiar 19 land hexes; 5–6 uses 30, and 7–10 uses a custom 37-hex island with increased supplies. The larger paired-turn rule is an adaptation. Open Seas is our generated scenario using Seafarers mechanics, not the complete published scenario campaign.

Connect-style preserves private hands, the shared contested board, classic cards/robber, and a configurable victory target. Suggested targets reflect the selected modules. Official Connect instead has different region, active-side, resource-visibility, robber, and scoring rules. Odd rosters are supported by our adaptation. Do not describe it as exact official Connect.

All bank/card transfers and placements are server-authoritative. Selection previews stay local until confirmed. The server sends explicit public/private projections; the frontend never imports server state or RNG. Actions carry a phase/turn ID and reliable transport IDs. Transactions operate on a copy so rejection cannot partially spend cards or change random state.

Save/resume across server restarts is deferred. Closing the room or losing the host beyond its shared two-minute grace ends the room. The published scenario campaigns, Event Cards and the two-player variant are not implemented. All expansion maps are generated adaptations, including the combined coastal/warehouse layout and river paths. Human balance and physical-device acceptance remain unfinished; automated completion is not a production certification.

## CPU opponents

Choose **Play on this screen**, then start a round alone to face two CPUs. In Settings, **Fill the table with CPUs** sets a total of 3–10 seats; human players always take priority. Three or more humans with the default three-seat setting play without CPUs. For a laptop/TV with one phone, select **Watch only**, join the phone and start. A playing host has **Your hand** and **Board** tabs; switching views preserves unfinished selections.

CPUs act on the server, one action every 700ms, using only public information and their own private projection. They use the same action validation as humans and pause when a human disconnects. They support both turn styles and supported expansion combinations, including required choices, expedition movement and deliveries. They accept affordable, useful offers at fair value; the human proposer still confirms the exchange. On its own Standard turn, a CPU waits eight seconds after accepting to allow confirmation. They do not initiate offers or counteroffers. This is a basic strategy level, without selectable difficulty or expert negotiation. CPU seats are chosen at round start, not substituted for disconnected friends.

## Code map

- `model.ts`: browser-safe geometry, piece, action, public/private-view types and costs.
- `board.ts`: generated maps, unique vertices/edges, resource distribution, nonadjacent red numbers, ports.
- `server.ts`, `state.ts`, `core.ts`: authoritative turns, legal targets, transactions, scoring, and projections.
- `expansion-settings.ts`, `expansion-model.ts`: shared configuration and browser-safe action/view types.
- `expansions.ts`: module initialization, private commands and mandatory-choice continuation.
- `cities-knights.ts`, `traders-barbarians.ts`, `barbarian-scenarios.ts`, `explorers-pirates.ts`: each family’s rules; `expansion-score.ts` composes its scoring.
- `expansion-state.ts`: server-only decks, unrevealed terrain, and per-turn bookkeeping.
- Frontend files: Fable's host scene/HUD, phone map and controls, presentation helpers, and styles.
- `tests/rules.test.ts`, `tests/expansions.test.ts`: deterministic rules, privacy, conservation, combination overrides, clocks, and completed ten-player simulations.
- `cpu-base.ts`, `cpu.ts`: production CPU choices based only on public/own-private views; the QA drivers reuse these policies. `tests/cpu.test.ts` covers filling, pacing, disconnects, trades and complete ten-seat matches.

Game content lives in the games submodule. The parent integrates the two registries, discovery metadata, and a trusted registration setting for 4,096 actions/player with 1 KiB maximum action payloads. Other games keep their existing 256-action allowance. The product of count and size is bounded below the original worst-case retained-payload limit, and old acknowledgements remain available for deduplication.

## Background music

The host plays the three user-supplied tracks in order, repeating after roughly 20 minutes. Phones and guest displays do not fetch or play them. The platform’s Sound on/off control pauses/resumes the current track at a 22% background volume. Playback also stops outside the round, while hidden or disconnected, and is disposed when leaving the game. Browser autoplay restrictions can require a host tap. Failed files are skipped; reconnecting or a user gesture can retry a failed playlist.

`src/music.ts` owns rotation and streaming; `src/audio.tsx` uses the existing shared AudioView hook for host ownership, sound preference and cleanup. Original MP3s and provenance are in `public/games/island-settlers/music/` in the games repository.

## Validation

Base/Seafarers acceptance and expansion-batch evidence are recorded separately in [QA.md](QA.md). It lists build fingerprints, actual UI actions/results/replay, maximum-roster layouts and remaining release work.

Run from the parent PartyPlay repository:

```sh
node --import tsx --test packages/games/island-settlers/tests/*.test.ts
node --import tsx --test tests/registry-contract.test.ts
npm run typecheck
npm run lint
npm test
npm run build:isolated -- settlers-unique-run
npm run serve:isolated -- settlers-unique-run 4387
```

No Prettier. Browser acceptance status and remaining limits belong in `QA.md`; automated rules completion alone is not visual or human pacing evidence. Do not publish as production-ready until that report supports it.

## Research and provenance

Rules researched from the official [base rules and almanac](https://www.catan.com/sites/default/files/2021-06/catan_base_rules_2020_200707.pdf), [FAQ](https://www.catan.com/faq/basegame), [Seafarers rulebook](https://www.catan.com/sites/default/files/2025-03/CN3083%20CATAN%E2%80%93Seafarers%20Rulebook%202025%20secured%20reduced.pdf), [5–6-player rules](https://www.catan.com/sites/default/files/2025-03/CN3082%20CATAN%20%E2%80%93%205-6%20Rulebook%202025%20reduced.pdf), and [Connect event rules](https://www.catan.com/sites/default/files/2025-06/CAT_Connect_Manual_Event_RZ%20ENG%20250514s.pdf). Rulebook downloads are local research material under the parent's ignored output directory, not game assets. Game artwork is procedural and original; shared font licenses remain with PartyPlay. No official artwork, logos, or rulebook text are distributed in the game.
