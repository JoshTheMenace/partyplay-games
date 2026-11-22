# Kitchen Rush

A chaotic co-op cooking game for 1–64 chefs. Up to ten share one kitchen on the TV, one score and one set of stars. Bigger groups become a restaurant of parallel kitchens that share the stars and race for Kitchen of the Night. Phones are landscape controllers; a host can also play solo on one device with the keyboard. Kitchens are hand-built tile maps with pots, pans, ovens, spreading fires, dirty dishes, thrown food, conveyors, ice, drawbridges and portals.

## How to play

Read the tickets across the top of the screen. Each shows the dish, its ingredients and how to prepare them (knife = chop, pot = boil, flame = fry, oven = bake). Grab ingredients from crates, chop them on boards, cook them in pots and pans, put everything on a clean plate, and serve it at the hatch before the ticket's patience bar runs out.

| Control | Phone | Keyboard |
| --- | --- | --- |
| Move | Left pad | WASD / arrows |
| Grab: pick up, put down, combine, serve | Big yellow button | Space or J |
| Chop · Throw: chop, wash, spray, throw food | Button above Grab (label changes) | K or E |
| Dash | Small blue button | Shift or L |

Chopping and washing keep going after one tap while you stay put. Throw food to teammates, who catch it empty-handed. Food left cooking starts to burn and sets the stove on fire; grab an extinguisher (even off a burning counter, empty-handed) and hold Chop · Throw to spray. Served plates come back dirty and need washing. Every serve raises a combo (×1 to ×4); the HUD shows it as **Next tip ×N**, the multiplier the next serve's tip gets. A missed order costs 5 coins and resets it. The last 30 seconds are **rush hour**: every tip counts double. **Relaxed** mode turns off burning and expiring orders and saves no stars.

The phone shows what you hold, what you are facing and its progress, the next two orders (dish plus ingredient icons), the timer, score and next tip. Both buttons say exactly what a tap will do, using the same rules as the server: **Grab** reads "Take lettuce", "Add to plate", "Pour soup", "Serve!" or, when a tap would be refused, a short reason in red ("Wash first", "Not ordered"). **Chop · Throw** becomes Chop, Wash, Spray or Throw, and turns dark and dashed with a reason ("Food only", "Find a board") when a tap would do nothing. Server notes pop up briefly over the tickets. The phone buzzes on your catches and serves and on new fires, and remembers your chef (`party.kitchen-rush.cook`), so Play again keeps everyone's look unless they pick a new one.

## Big groups (11–64 chefs)

A kitchen holds at most ten chefs. From eleven, the crew is split in seat order into kitchens of five to eight (11 chefs → 6 + 5, 32 → four kitchens of 8, 64 → eight of 8), named Apple, Blueberry, Citrus, Dill, Eggplant, Fig, Ginger and Honeydew. The lobby shows who shares a kitchen. Every kitchen cooks the same level with its own tickets and score:

- **Stars are shared.** The restaurant's coins are the sum of its kitchens, measured against the sum of their targets.
- **Kitchens race.** The board ranks them by coins; the leader at the bell is Kitchen of the Night.
- **The TV is a broadcast** of every kitchen with the clock, the shared stars and one card per kitchen (coins, stars, open tickets, fires).
- **Each phone shows its own kitchen**, following your chef (a pointer and a second ring mark you), with your kitchen's tickets, clock, coins and place over the picture and the same three buttons. A phone that cannot draw 3D keeps the classic controller.

If a phone drops out, its chef slumps in place with a dimmed name, drops what it held, and teammates can walk straight through it; rejoining takes the same chef back. On a keyboard, keys pressed while a header button has focus go to that button.

Solo play reserves bands for the steer pad (left) and buttons (right) through `--kr-hud-left/right`, so the camera fits the kitchen between them. Results lead with a headline that matches the stars and plates served, the coins still needed for the next star, and a big award card for every chef.

Sound (host only): bells open the service, a soft high chime marks each new ticket after the opening orders, a warning bell rings at 10 seconds left and a tick sounds for each of the last five. Original music follows the room: a bossa nova in the lobby, a swing theme during service that speeds up for the last 30 seconds, and a results fanfare (or a comic trombone when no stars were earned). See `audio/README.md`.

## Kitchens

| # | Kitchen | Location | Menu | Twist |
| --- | --- | --- | --- | --- |
| 1 | First Shift | Sunny Side Diner | side salad, salad | Classic |
| 2 | Soup Kitchen | Harbour Galley | tomato soup, onion soup | Dishwashing |
| 3 | Burger Bar | Route 66 Grill | burger, salad, cheeseburger | Dishwashing |
| 4 | Conveyor Cafe | Night Market | salad, burger, cheeseburger | Conveyors |
| 5 | Slippery Summit | Glacier Lodge | tomato soup, salad, onion soup | Ice |
| 6 | Drawbridge Deli | Red Rock Canyon | burgers of all kinds | Drawbridges, conveyors |
| 7 | Portal Pizzeria | Canal Street Market | pizza, salads | Portals |
| 8 | Grand Opening | The Grand Hotel | full menu | Portals, conveyors |

Every kitchen is open from the start. Services last 2½, 3 or 4 minutes. Star targets scale with roster size and service length; a restaurant's targets are the sum of its kitchens'. The host browser saves best stars and scores per kitchen under `party.kitchen-rush.campaign.v2`.

## Code map

| File | Role |
| --- | --- |
| `DESIGN.md` | Rules, feel targets and file ownership (the contract) |
| `src/model.ts`, `src/levels.ts` | Shared types, recipes, timing, map legend; level data, `kitchenMap`, `starThresholds` |
| `src/server.ts`, `src/orders.ts` | Authoritative simulation of each kitchen, orders and scoring; a service is one kitchen or several lines |
| `src/wire.ts` | Packed network form of a service and its decoder (`Wire` ⇄ one `View` per kitchen plus restaurant totals) |
| `src/scene.tsx`, `src/scene/**`, `src/models.ts` | Three.js kitchen, chefs, effects and camera |
| `src/client.tsx` | Client module: settings, instructions, results, host and phone kitchen views, scene hook-up |
| `src/controller.tsx` | Classic phone controller, command queue with acknowledgements, keyboard, haptics |
| `src/hud.tsx` | Display HUD: order rail, timer, score and stars, banners, chef strip, kitchen badges and the broadcast board, icons with fallbacks |
| `src/cook-lobby.tsx`, `src/picker.css` | Chef picker and crew board (grouped by kitchen above ten chefs) |
| `src/audio.ts` | Event-driven sound and music on the host only (`AudioView`) |
| `src/presentation.ts` | Pure labels, statuses, Grab and Chop · Throw hints (mirroring the server), results copy, level tags and pitches, awards |
| `src/campaign.ts` | Browser-saved best stars and scores; this phone's remembered chef |
| `dev/` | Browser sandbox, never part of a build: the real rules with crew bots and any screen (display, phone, host, lobby, results) at any roster |
| `tools/room-bot.ts` | Crew bots for the platform's `scripts/qa/room-bots.ts`, so a big room can be filled with phones that really cook |

## Validation

```sh
node --import tsx --test packages/games/kitchen-rush/tests/*.test.ts
npx tsc --noEmit -p .
npx oxlint packages/games/kitchen-rush
# Any screen at any roster, no room server (parameters are listed at the top of dev/sandbox.tsx):
npx vite --config packages/games/kitchen-rush/dev/vite.config.mjs --host 127.0.0.1 --port 4421
#   http://127.0.0.1:4421/?players=32&level=2&role=display     http://127.0.0.1:4421/?players=32&role=phone&seat=11
# A real room filled with cooking bots (create the room from a host page first):
node --import tsx scripts/qa/room-bots.ts --port <port> --code <ROOM> --players 31 --stats 5 --hook packages/games/kitchen-rush/tools/room-bot.ts
```

Sound clips and credits: `public/games/kitchen-rush/audio/` (preview page at `/games/kitchen-rush/audio/index.html`). Animal chefs use Aaron Hendricks' character meshes (see `art/extract_characters.py`).
