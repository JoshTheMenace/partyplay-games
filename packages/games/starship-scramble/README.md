# Starship Scramble

Co-op FTL for the living room. One to sixty-four captains each fly their own ship in one fleet: jump across branching sector maps, answer distress calls, shop, and fight real-time battles while the Crimson Armada closes in. Destroy the Armada Flagship to win. Five captains or more fly in wings of up to four that fight side by side. A short run (one sector) takes about 20 minutes, a standard run (three sectors) about 45–60 and a long run (five sectors) 90 minutes or more; at every sector exit the fleet votes on which sector comes next. [DESIGN.md](DESIGN.md) is the rules contract.

## How to play

- **TV**: the shared battle scene (allies left, enemies right), the sector map with the advancing Armada front, event cards, loot and stores. Everyone watches the same screen.
- **Phone** (landscape in battle): your ship big on the left, weapon cards along the bottom, target ships on the right. The ship's computer aims every gun at the nearest enemy; tap a weapon, then a room on an enemy to pick a better target. Switch a weapon's Auto off to hold it, and **Fire** sends a synchronized volley. Tap crew, then a room, to move them. Teleport: crew in your teleporter room → Teleport → ship → room; **Recall** works any time, even while the teleporter recharges. Anyone can pause.
- Between battles, vote on beacons and event choices, claim loot, buy from stores, and upgrade systems or swap weapons. Beyond hostile and distress beacons, maps hold elite fights guarding rare gear, drydocks for repairs, risky derelicts and wormholes that skip a column ahead of the Armada.
- Co-op matters: shields only fall to volleys landing together, support weapons repair and shield allies, and a lost ship is rebuilt from a fleet reserve. The run ends only if the whole fleet dies in one battle.
- **Damage control** (the switch under the crew list; on for Cadet, off for Captain): idle crew answer fires, breaches, damage and boarders by themselves, a couple of seconds slower than an order from you, and walk back afterwards.
- **Big fleets**: from five captains the fleet flies in wings of up to four (Anvil, Beacon, Comet …). Every wing fights its own enemy squad in the same battle, splits its own salvage and has its own store shelf; a wing that wins its fight covers the others with its guns; everyone can shoot the Flagship. The TV becomes a fleet broadcast with a tile per wing, and the fleet is beaten when only about a quarter of its ships are left. Votes and ready-ups do not wait for the last few phones.
- The host can play on the TV itself with the personal view: mouse targeting, keys 1–4 select weapons, Space pauses, F fires.

## Architecture

| Folder | Role |
| --- | --- |
| `src/contracts.ts` | Shared, browser-safe types for state, actions and views, the wing helpers (`wingOf`, `wingCount`, `routLine`) and `overheat(combat)`. |
| `src/wire.ts` | What travels: the packed public and private snapshots and `decode`/`seat`, which turn them back into the `PublicView` the UI reads. |
| `src/defs/` | Browser-safe definitions: hulls and deck plans, weapons, systems, augments, species, geometry. |
| `src/sim/` | The deterministic combat simulation: systems, weapons, projectiles, crew AI, boarding, hazards, boss phases. |
| `src/run/` | The run: map generation, phase flow, events, battles and squads, loot and stores, saves, public view. |
| `src/content/` | Server-only content: enemies, sectors and the event library. |
| `src/server.ts` | `GameRules` for the platform: action parsing, validation and the tick. |
| `src/display/`, `src/phone/`, `src/render/`, `src/audio/` | TV and phone UI, canvas rendering, sound. `render/fleet.ts` and `display/fleet.tsx` are the fleet broadcast, `display/wings.tsx` the crowd layouts, `display/vista.tsx` the beacon scenery and the jump. |
| `art/` | Blender scripts that regenerate the hull sprites, backdrops, icons and beacon sites in `public/games/starship-scramble/`. |
| `tests/` | Sim, run, content and UI tests. `tests/run-bot.ts` holds the scripted captains used for full-run balance checks; `fleet-rules.test.ts` and `wire-assist.test.ts` cover wings, the ship's computer, the wire and saves. |
| `tools/room-bot.ts` | The same scripted captains as socket bots, for filling a real room (see Development). |

## Development

Run from the platform checkout root:

```sh
node --import tsx --test packages/games/starship-scramble/tests/*.test.ts   # full suite, ~45 s
SS_BALANCE=1 node --import tsx --test packages/games/starship-scramble/tests/run-balance.test.ts   # 30-seed win-rate sweeps for 1–4 captains, 15–20 min
SS_BALANCE=fleet node --import tsx --test packages/games/starship-scramble/tests/run-balance.test.ts   # big-fleet sweeps, an hour or more
npx tsc --noEmit
npx oxlint game-modules/packages/games/starship-scramble
npm run build:isolated -- <name>
npm run serve:isolated -- <name> <port>
```

Use a fresh build name and an unused port. Never run Prettier. Game source lives in the `game-modules` submodule, reached through the platform's symlinks.

To watch a big room, create it from a real host page on an isolated server, then fill it with captains that really play:

```sh
node --import tsx scripts/qa/room-bots.ts --port <port> --code <ROOM> --players 31 --stats 10 --hook packages/games/starship-scramble/tools/room-bot.ts
```

`SS_BOT_IDLE=1` makes them launch and vote but never give a battle order.

## Balance

Scripted captains (`tests/run-bot.ts`) play whole runs through the public rules API: they focus the weakest enemy, hold weapons for volleys, fix fires and breaches, send hurt crew to the medbay, board through the teleporter while the target's shields are up, recall a losing away team, and flee only when losing. Fight times are combat seconds per battle, Flagship included.

One to four captains, 30 seeds per row (`SS_BALANCE=1`):

| Run | Captains | Wins | Table min (median) | Fight median / p90 (s) | Target |
| --- | --- | --- | --- | --- | --- |
| Cadet · short | 1 (Wayfarer) | 100% | 16 | 73 / 178 | ≥ 70% |
| Cadet · short | 2 | 97% | 15 | 67 / 129 | ≥ 70% |
| Cadet · short | 4 | 100% | 14 | 70 / 98 | ≥ 70% |
| Cadet · short | solo Lancer / Bulwark / Corsair / Halcyon | 100 / 100 / 97 / 100% | 15–17 | 60–96 / 95–179 | ≥ 45% |
| Captain · standard | 1 | 37% | 44 | 61 / 123 | 20–45% |
| Captain · standard | 4 | 50% | 48 | 73 / 179 | 30–55% |
| Captain · long | 1 | 40% | 73 | 58 / 123 | 20–50% |
| Captain · long | 4 | 43% | 79 | 77 / 158 | 25–55% |

Fleets of several wings (`SS_BALANCE=fleet`; fewer seeds, because a 64-captain run takes minutes to simulate). The scripted captains never dawdle and never miss a fire, which a real room of thirty will, so the last two columns let only some captains give battle orders; the rest still vote, shop and refit, and their ships fight on the ship's computer.

| Run | Captains | Everyone plays | One in two gives orders | Nobody gives orders | Table min (median) |
| --- | --- | --- | --- | --- | --- |
| Cadet · short | 8 | 12 / 12 | | | 14 |
| Cadet · short | 32 | 6 / 6 | | 4 / 4 | 14 |
| Cadet · short | 64 | 4 / 4 | | 3 / 3 | 14 |
| Captain · standard | 8 | 9 / 12 | | | 48 |
| Captain · standard | 32 | 6 / 6 | 1 / 4 | 0 / 4 | 48 |
| Captain · standard | 64 | 3 / 4 | 1 / 3 | 0 / 3 | 47 |

Table minutes are combat time plus 25 s per decision screen, medians over every run including early defeats, so a winning table plays longer. Flagship battles run about 1.5–4 minutes (up to 7 for a fleet of several wings on Captain); ordinary battles about a minute. Cadet is the party default and is meant to get a table to the Flagship: scripted captains who give no battle orders, and even ones who also never upgrade, still win a short Cadet run at 1, 4, 32 and 64 captains (11 of 12 solo, every run at the other sizes), because they repair at stores and avoid fights they can. Cadet is lost in a browser by a table that picks every fight and never repairs: seen with one, two and four captains (QA.md). Captain is where a run is lost: a lone captain or a single wing wins under half its runs, and a big fleet wins when most of it is paying attention and breaks at the Flagship when half of it is not. A big fleet that plays perfectly wins Captain more often than a single wing does, because it only breaks when three quarters of it is gone; no room of thirty plays perfectly.

The levers live in `src/run/combat.ts` (depth and fleet-size hull, charge, Flagship depth scaling, the per-beacon and elite threat budgets, escorts, `CADET_BOSS`, `CADET_CHARGE`), `routLine` and `OVERHEAT_MS` in `src/contracts.ts`, and `ASSIST_MS` in `src/sim/combat.ts`. The scripted numbers are not a substitute for human playtests.
