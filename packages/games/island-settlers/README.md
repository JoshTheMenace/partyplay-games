# Island Settlers

A Catan-style trading and building game for PartyPlay, for 1–64 players. The TV (or laptop) shows a 3D
board and public HUD; each player's phone holds their private hand, trades and placements. Up to ten
players share one island (3–10 seats; CPUs fill seats that no human takes, so one person can play
alone). A bigger room is an **archipelago**: islands of four that all play at once under the same dice.

This is **v2**, a from-scratch rewrite of the earlier game. The design lives in
[docs/v2](docs/v2): [ENGINE](docs/v2/ENGINE.md) (rules engine), [EXPERIENCE](docs/v2/EXPERIENCE.md)
(what players see and touch), [BUILD-PLAN](docs/v2/BUILD-PLAN.md), [DATA-NEEDS](docs/v2/DATA-NEEDS.md)
and [CONTRACT-CHANGES](docs/v2/CONTRACT-CHANGES.md). The shared contract is `src/model.ts` +
`src/geometry.ts` for one island and `src/wire.ts` for what travels to the browsers. The big-room
format is described in [ENGINE §20](docs/v2/ENGINE.md). Verification status is in [QA.md](QA.md);
expansion scope and adaptations are in [EXPANSIONS.md](EXPANSIONS.md).

## Features

- Base game: snake setup, production, robber and discards, ports, bank and player trades (offers,
  counteroffers, accept, proposer confirms), development cards, Longest Road, Largest Army.
- Generated boards for 3–4 (19 land hexes), 5–6 (30) and 7–10 seats (37), with fair-number rules
  (no adjacent 6/8, no equal neighbours, no 2 next to 12) and evenly spaced ports.
- Optional balanced dice (a shuffled deck of the 36 rolls).
- Step timers: Off, Relaxed (default) or Brisk. An expired step is played for the seat. A
  disconnected seat is only waited on when it owes a decision (30 s grace, then auto-play).
- Quick start (host option, any room): the game places everyone's starting pieces on the best open
  spots in the usual order, so play begins at the first roll.
- TV: Three.js board built from original Blender models on an animated sea, with real shadows; the
  island rises out of the mist when a round starts. Big dice land on the board for every roll, cards fly
  from hexes to seats and between seats when a trade lands, a point gained pops on the seat rail, and the
  finale reveals hidden points, then drops the winner's card in a shower of confetti. Then a results
  screen with standings, per-seat stats, dice histogram and records. Play again starts a fresh board.
- Phone: SVG map with pan/zoom, hand cards, Build / Trade / Cards / End turn, prompts (discard,
  robber, gold, progress cards and module choices) and a results summary. Portrait and landscape.
- Seated host: a controller dock over the TV board, with a Hide hand toggle for mirrored screens.
- Synthesized sound effects (WebAudio, no files), phone haptics, and a host-only soundtrack.

## Modes

- **Standard.** One turn at a time. With 5–6 seats the 2025 "paired players" rule gives the seat
  halfway round a build turn (no player trades). With 7–10 seats that paired turn runs at the same
  time as the main turn (a PartyPlay adaptation).
- **Connect rounds** (PartyPlay adaptation for big groups). One shared roll pays everyone, then all
  seats trade and build at once for 60, 90 or 120 s. The first confirmed placement wins a contested
  spot. Victory is checked at round end; the highest qualifying total wins and ties share. With five
  or more seats a **horn** sounds once 70% of the table is done, and the rest get 12 seconds.
- **Archipelago** (this game's own big-room format). More than ten players, or any room of five or
  more whose host picks it, are dealt by lot onto islands of four (CPUs fill spare seats). Every island
  has its own board, bank and robber and trades among its own four. Each round the room rolls **three
  times**; the same dice pay every island; then every island trades and builds at once. An island whose
  four are done waits; once 70% of the room is done the horn gives everyone else 12 seconds. The game
  ends for the whole room after a round in which somebody reaches the target: the highest total wins,
  and a tie goes to whoever was ahead a round earlier. The TV features one island at a time (a director
  on the server follows builds, robberies, trades and close races) beside a rail of every island and
  the room's leaders; each phone always shows its own island and its place in the room. Results rank
  the whole room, name each island's winner and hand out room awards.

Every mode works with every legal map and expansion combination. The victory target (8–30) defaults
to a suggested value for the chosen setup.

### How long a phone waits (simulated, `tools/sim.ts`)

Seats that think 2.5–7 s a move, one in ten never tapping Done, target 10:

| Room | Format | Game | Rounds | Wait between things to do (median / 90th / worst) |
| --- | --- | --- | --- | --- |
| 4 | one island, Standard | 26 min | 18 | 18 s / 38 s / 70 s |
| 10 | one island, Standard | 33 min | 8 | 28 s / 51 s / 144 s |
| 10 | one island, Connect, before the horn | 82 min | 52 | 72 s / 90 s / 98 s |
| 10 | one island, Connect | 44 min | 61 | 19 s / 37 s / 73 s |
| 32 | archipelago, 8 islands | 17 min | 20 | 23 s / 38 s / 74 s |
| 64 | archipelago, 16 islands | 14 min | 18 | 24 s / 39 s / 112 s |

A phone's wait does not grow with the room. In an archipelago about two fifths of a player's time has
something to do, a fifth is the shared rolls, and the rest is waiting for the round to close; at a
four-player Standard table those shares are 29%, 11% and 56%. Real-room figures are in [QA.md](QA.md).

## Expansions

- **Maps (pick one):** Base island; **Seafarers** with New Shores, Four Islands or Fog Islands;
  **Explorers & Pirates** with any of the Pirate Lairs, Fish for Catan and Spices missions (Land Ho!
  is always on).
- **Cities & Knights** on any map.
- **Traders & Barbarians scenarios:** Fishing, Rivers, Caravans, Barbarian Attack, Deliveries
  (the T&B scenario). Only Fishing is allowed on Explorers & Pirates.
- **Variants:** Friendly Robber, Harbormaster.

All maps are generated, not the printed scenario boards. Disabled options show a one-line reason in
Settings. See [EXPANSIONS.md](EXPANSIONS.md) for combinations, sources and adaptations.

## CPU opponents

CPUs run on the server and see only public information and their own hand. Nine personas (Maya the
harbor trader, Theo the road builder, Iris, Omar, Lena, Ravi, Nora, Felix, Juno) bias goals and
resources. Three levels:

| Level | Behaviour |
| --- | --- |
| Easy | Noisy choices, never proposes trades, robber only avoids itself |
| Normal (default) | Proposes one trade per turn, refuses a leader near the target, leader-aware robber |
| Sharp | Exact scoring, two proposals and counteroffers, races for contested spots, plans setup further ahead |

CPUs use the same validated actions as humans and support every module's commands and prompts.

## Controls

- **Host:** add the game, **Play on this screen**, then **Watch only** (TV only) or stay seated.
  **Settings → Game rules** holds table size, islands (one island or archipelago), map, turns, target,
  timers, CPU level, quick start, expansions and variants. A
  seated host clicks glowing spots on the 3D board, or uses ←/→ and Enter in the dock; Escape closes
  a sheet.
- **Phone:** join with the room code, **Ready to play**. On your turn roll, then use Build, Trade,
  Cards and End turn. To place, tap a glowing spot, then **Confirm** (or Back). Trade: pick cards to
  give and get, choose recipients, send; accept or counter others' offers. The lobby details list
  the rules for every mode and module.

## Code map

| Path | Contents |
| --- | --- |
| `src/model.ts`, `geometry.ts` | Contract for one island: settings, views, actions, costs, timers; hex geometry |
| `src/wire.ts`, `graph.ts` | What travels to the browsers (the room, compact boards, short and full seat views) and how the client rebuilds island views from it; the board graph both sides build |
| `src/league/` | Server-only: the room as a league of islands (dealing, shared rolls, the horn, the room's winner, awards), the TV director and the wire encoder |
| `src/settings.ts` | Settings validation, combination restrictions, suggested targets |
| `src/manifest.ts`, `server.ts`, `client.tsx` | Platform manifest, room rules (`rules`) over the one-island rules (`island`), lazy view loader |
| `src/engine/` | Server-only rules: state, stage flow, actions, legal moves, production, trade, dev cards, score, timers and auto-play, projections, seeded RNG |
| `src/engine/board/` | Board generation: layouts, terrain, numbers, ports, islands, Seafarers and E&P maps |
| `src/engine/modules/` | One module per expansion, scenario and variant, wired through `registry.ts` hooks |
| `src/cpu/` | CPU `decide`: setup, turn planning, trades, robber, prompts, personas; `advice/` per module |
| `src/ui/scene/` | Three.js TV board, pieces, tokens, overlays, camera |
| `src/ui/display/` | TV HUD: banner, seat rail, left rail, dice theatre |
| `src/ui/controller/`, `personal/` | Phone controller; seated-host dock |
| `src/ui/trade/`, `map/`, `results/`, `shared/`, `sfx/` | Trade sheet, phone SVG map, results, shared labels/help/icons, sound |
| `src/ui/league/` | The wire adapter for every view, the TV's archipelago panel and island plate, the phone strip, room results |
| `src/music.ts`, `audio.tsx` | Host soundtrack rotation |
| `art/` | Blender Python scripts for `public/games/island-settlers/models/*.glb` |
| `tests/` | `board`, `core`, `rules`, `trade`, `modules`, `cpu`, `league`, `ui`, `fixtures`, `browser` |
| `tools/` | `sim.ts` (pacing and traffic in simulated time), `room-bot.mjs` (socket-bot policy), `qa-run.mjs` and `qa-trade.mjs` (real-browser runs) |

## Tests, preview and browser driver

Run from the parent PartyPlay repository root. Never run Prettier.

```sh
node --import tsx --test packages/games/island-settlers/tests/all.test.ts   # whole game suite
node --import tsx --test packages/games/island-settlers/tests/modules/*.test.ts   # one folder
node --import tsx --test packages/games/island-settlers/tests/league/*.test.ts    # the archipelago and the wire
BOARD_SEEDS=500 node --import tsx --test packages/games/island-settlers/tests/board/matrix.test.ts
node --import tsx packages/games/island-settlers/tools/sim.ts 4 10 32 64 --mode connect   # pacing and traffic
npm run typecheck && npm run lint && npm test
```

UI preview on fixtures, no server ([tests/fixtures/preview/README.md](tests/fixtures/preview/README.md));
`&islands=8` shows any fixture as one island of an archipelago:

```sh
npx vite --config packages/games/island-settlers/tests/fixtures/preview/vite.config.ts   # :5390
```

Real-browser game: a watching TV (1920×1080), two phones (390×844) and two CPUs play a full game
through the real UI to results and Play again. The driver reads WebSocket frames to choose moves
with the CPU brain, then presses the real buttons; it never injects actions.

```sh
npm run build:isolated -- settlers-my-run
npm run serve:isolated -- settlers-my-run 4396
PLAYWRIGHT=<playwright index.mjs> CHROME=<chrome-headless-shell> node --import tsx \
  packages/games/island-settlers/tests/browser/m3.mjs http://127.0.0.1:4396 output/my-run [solo]
```

`tests/browser/driver.mjs` exports `observe`, `play` and `execute` for other scenarios. `tools/qa-run.mjs`
is the general runner (any roster, mode and settings; `--bots N` fills the room with socket bots that
play through `tools/room-bot.mjs`), and `tools/qa-trade.mjs` makes two real phones trade with each other:

```sh
node --import tsx packages/games/island-settlers/tools/qa-run.mjs --base http://127.0.0.1:4421 \
  --out output/my-run --phones 2 --bots 30 --seats 4 --target 10
```

## Provenance

- **Art:** original. Pieces, props and landmarks are built by the Python scripts in `art/` (no
  downloaded models, textures or kits); hex tiles and number tokens are built in code. See
  [art/README.md](art/README.md).
- **Sound effects:** synthesized at runtime; no audio files. The ship's horn is the newest one.
- **Archipelago, quick start, the horn, the island names and the room awards** are this game's own
  designs; they come from no other game.
- **Music:** three MP3s supplied by the project owner, kept byte-for-byte with SHA-256 hashes in
  `public/games/island-settlers/music/manifest.json`. No license or artist attribution was provided.
- **Rules:** researched from the official catan.com rulebooks and combination sheets listed in
  [EXPANSIONS.md](EXPANSIONS.md). No official artwork, logos or rulebook text is included.
