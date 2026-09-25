# Starship Scramble

Co-op FTL for the living room. One to four captains each fly their own ship in one fleet: jump across branching sector maps, answer distress calls, shop, and fight real-time battles while the Crimson Armada closes in. Destroy the Armada Flagship to win. A short run (one sector) takes about 15–20 minutes; a standard run (three sectors) about 30–45. [DESIGN.md](DESIGN.md) is the rules contract.

## How to play

- **TV**: the shared battle scene (allies left, enemies right), the sector map with the advancing Armada front, event cards, loot and stores. Everyone watches the same screen.
- **Phone** (landscape in battle): your ship big on the left, weapon cards along the bottom, target ships on the right. Tap a weapon, then a room on an enemy to aim; **Fire** sends a synchronized volley. Tap crew, then a room, to move them. Teleport: crew in your teleporter room → Teleport → ship → room; **Recall** works any time, even while the teleporter recharges. Anyone can pause.
- Between battles, vote on beacons and event choices, claim loot, buy from stores, and upgrade systems or swap weapons.
- Co-op matters: shields only fall to volleys landing together, support weapons repair and shield allies, and a lost ship is rebuilt from a fleet reserve. The run ends only if the whole fleet dies in one battle.
- The host can play on the TV itself with the personal view: mouse targeting, keys 1–4 select weapons, Space pauses, F fires.

## Architecture

| Folder | Role |
| --- | --- |
| `src/contracts.ts` | Shared, browser-safe types for state, actions and views, plus `overheat(combat)`. |
| `src/defs/` | Browser-safe definitions: hulls and deck plans, weapons, systems, augments, species, geometry. |
| `src/sim/` | The deterministic combat simulation: systems, weapons, projectiles, crew AI, boarding, hazards, boss phases. |
| `src/run/` | The run: map generation, phase flow, events, battles and squads, loot and stores, saves, public view. |
| `src/content/` | Server-only content: enemies, sectors and the event library. |
| `src/server.ts` | `GameRules` for the platform: action parsing, validation and the tick. |
| `src/display/`, `src/phone/`, `src/render/`, `src/audio/` | TV and phone UI, canvas rendering, sound. |
| `art/` | Blender scripts that regenerate the hull sprites and backdrops in `public/games/starship-scramble/`. |
| `tests/` | Sim, run, content and UI tests. `tests/run-bot.ts` holds the scripted captains used for full-run balance checks. |

## Development

Run from the platform checkout root:

```sh
node --import tsx --test packages/games/starship-scramble/tests/*.test.ts   # full suite, ~45 s
SS_BALANCE=1 node --import tsx --test packages/games/starship-scramble/tests/run-balance.test.ts   # 30-seed win-rate sweeps, a few minutes
npx tsc --noEmit
npx oxlint game-modules/packages/games/starship-scramble
npm run build:isolated -- <name>
npm run serve:isolated -- <name> <port>
```

Use a fresh build name and an unused port. Never run Prettier. Game source lives in the `game-modules` submodule, reached through the platform's symlinks.

## Balance

Scripted captains (`tests/run-bot.ts`) play whole runs through the public rules API: they focus the weakest enemy, hold weapons for volleys, fix fires and breaches, send hurt crew to the medbay, board through the teleporter while the target's shields are up, recall a losing away team, and flee only when losing. 30 seeds per row. Fight times are combat seconds per battle, Flagship included.

| Run | Captains | Wins | Fight median / p90 (s) | Target |
| --- | --- | --- | --- | --- |
| Cadet · short | 1 (Wayfarer) | 97% | 60 / 184 | ≥ 70% |
| Cadet · short | 2 | 100% | 61 / 116 | ≥ 70% |
| Cadet · short | 3 | 100% | 54 / 102 | |
| Cadet · short | 4 | 100% | 59 / 145 | ≥ 70% |
| Cadet · short | solo Lancer | 97% | 56 / 103 | ≥ 45% |
| Cadet · short | solo Bulwark | 100% | 61 / 204 | ≥ 45% |
| Cadet · short | solo Corsair | 87% | 71 / 173 | ≥ 45% |
| Cadet · short | solo Halcyon | 100% | 92 / 159 | ≥ 45% |
| Captain · standard | 1 | 30% | 74 / 174 | 15–35% |
| Captain · standard | 2 | 27% | 74 / 190 | |
| Captain · standard | 3 | 47% | 69 / 245 | |
| Captain · standard | 4 | 40% | 74 / 190 | 30–50% |

Flagship battles run about 1.5–4 minutes; ordinary battles about a minute. The levers live in `src/run/combat.ts` (fleet-size hull, charge and Flagship scaling, the per-beacon threat budget, escorts) and `OVERHEAT_MS` in `src/contracts.ts`. The bots are stronger than a new table in a crowded room, so Cadet is deliberately generous; the scripted numbers are not a substitute for human playtests.
