# Island Settlers v2: verification

Final check, 24 September 2026, after the wave 4 fix and repair passes. Earlier v1 evidence no longer
applies: the engine, CPU and UI were rewritten.

## Build

- Isolated build `settlers-v2-final-09240107` (non-QA), index SHA-256
  `ad4f7bb5ac920a6583e36d799db85cb64bd4c4502cc6ccbd0c82c4156dd44d67`.
- Source: platform `47dd543` and game-modules `5b5f51e`, both with uncommitted v2 changes in the
  working tree (nothing staged or committed).

## Automated checks (run from the platform root)

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm run lint` (oxlint on apps, packages, game-modules, tests, scripts) | exit 0, no diagnostics |
| `npm test` (full platform suite, includes this game's `tests/all.test.ts`) | 1,911 tests: 1,910 pass, 1 skipped, 0 fail (358 s) |
| `node --import tsx --test tests/registry-contract.test.ts tests/catalog.test.ts` | 36 pass |
| `node --import tsx --test packages/games/island-settlers/tests/all.test.ts` | 415 pass, 0 fail (278 s) |
| `npm run build:isolated -- settlers-v2-final-09240107` | Built |

The game suite covers board generation (50 seeds per map and size; `BOARD_SEEDS=500` for the full
sweep), stage flow, timers and auto-play, Connect rounds, trades, dev cards, scoring, every module and
their combinations, CPU legality sweeps at 3–10 seats in both modes, complete CPU-only games, fuzzing,
UI logic, scene data and model budgets.

## Real browser runs (final build)

Headless Chromium through `tests/browser/driver.mjs`: every move is chosen by the CPU brain from the
phone's own view and executed by pressing the real UI. Nothing is injected.

| Run | Setup | Result |
| --- | --- | --- |
| Full game, room `Q33RS7` (`tests/browser/m3.mjs`) | Watching TV 1920×1080, 2 phones 390×844 (16-character names), 2 Normal CPUs; Standard, Base, 10 VP, Relaxed timers | Join → setup → 14 rounds, 54 opportunities → CPU winner at 11 VP (reason `target`) → finale → results (4 ranked rows) → Play again started a fresh empty setup. 183 accepted phone actions (26 roll, 17 build, 21 offer, 58 respond, 20 withdraw, 9 bank, 1 confirm-trade, 3 buy-dev, 2 answer, 26 end), 0 rejected, 0 UI misses, 0 page/console/server errors. 321 s |
| C&K + Seafarers smoke, room `CA3ZTB` (`output/settlers-v2/w4/final/ck-sea.mjs`) | TV 1920×1080 at 2× pixel ratio, 2 phones 390×844, 2 Normal CPUs; Standard, New Shores + C&K, suggested target 16 | Setup + 3 full rounds (stopped at round 4): 56 accepted actions including 2 module commands and 2 prompt answers, 0 rejected, 0 errors |

Screenshots in `output/settlers-v2/w4/final/` (parent repo, ignored), all inspected:

- `game/a01`–`a15`: lobby, TV and phone setup, roll, offers, midgame, finale ("Theo wins! Revealing
  hidden points"), TV and phone results, replay setup.
- `ck-sea/tv-round1`–`4`, `tv-last`, `phone-last`, `crop-0`–`4`: C&K barbarian track and metropolis
  panel, outer islands, phone commodity hand.
- `tokens-zoom-2x.png`: a 2× crop of the C&K board with cities, settlements and roads beside number
  tokens. Tokens sit at hex centres and cover no piece.

Earlier wave 4 evidence (not rerun on this build): a 10-phone roster on a 1280×720 TV (320 accepted
actions), a seated host at 1280×720, phones at 320×568, 667×375 and 844×390 to results and replay,
and the repair-ui C&K + New Shores phone checks, under
`output/settlers-v2/w4/{qa,fix-ui,repair-ui}/`.

## Observations from this run

- Results "Cities" and "Settlements" columns show points, not counts (4 cities show 8). Readable in
  context, but the header could mislead.
- In the offers capture the TV offer card is dimmed; it may be mid-animation.
- On New Shores the phone map is small because the frame includes every outer island (known;
  refitting as fog is explored is deferred).

## Remaining gaps

- No physical iOS/Android phones, TVs or older laptops; emulated viewports only.
- TV readability at couch distance is untested.
- Human pacing, teaching clarity, negotiation feel and balance (large rosters, combined expansions)
  need human playtests. CPU game lengths are not human durations.
- This build's browser runs cover one full Base game and a short C&K + Seafarers game. Connect,
  Explorers & Pirates, Traders & Barbarians scenarios and 10-seat games rely on the automated suite
  and earlier wave 4 browser runs.
- Deferred rules gaps are listed in [EXPANSIONS.md](EXPANSIONS.md) and ENGINE §19.
