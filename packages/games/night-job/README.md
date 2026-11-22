# Night Job

A cooperative top-down 3D heist, inspired by Monaco (2013): one crew of one to four thieves, or a room of up to 64 split into rival crews. The TV shows the building as a navy blueprint; each thief's line of sight reveals the lit room around them. Steal the objective, grab optional loot, and get the whole crew to the getaway. Being spotted starts a chase you can escape, not a game over.

## Play

Pick Night Job in the PartyPlay library, choose a mission and Normal or Relaxed in Settings, and have each player join on a phone, pick one of eight specialists and one of six tools, then Ready. The host screen is a dedicated TV display and never takes a seat.

The phone is a landscape controller: a light push on the stick sneaks silently, a full push runs and leaves noise rings guards can hear, and holding Sneak forces quiet movement. Push into doors, locks, safes, terminals, windows, vents, hiding spots, fallen teammates or the objective to work on them. Tap Tool to use your equipment in the direction you face. Every ten coins you collect refills a tool charge. Results award one to three stars against par (elapsed time plus 3 s per missed coin) and hand out crew awards.

Missions: **The Velvet Ledger** (casino), **Glasshouse Exchange** (glass conservatory), **Last Ferry** (night docks).

**Crew night.** With five or more players the room is dealt, in seat order, into crews of up to four (5 → 3 + 2, 32 → eight crews, 64 → sixteen). Every crew robs its own copy of the building and sees its map on its own phones, around its own thief; the TV becomes a broadcast that cuts between crews and keeps the board. The fastest clean getaway takes the night. Once one crew is away the rest have two minutes until sunrise, and a night never runs longer than ten. A crew that is wiped out is hauled back to the start by the van for thirty seconds on its time, so nobody sits out.

## Implementation

[DESIGN.md](DESIGN.md) is the contract for rules, tuning, the level format, networking and the asset kit. `src/model.ts` holds the shared types and constants.

| Area | Files |
| --- | --- |
| Shared, browser-safe | `model.ts` (types, tuning, crews), `geometry.ts` (grid, exact rays, sight polygons, A*), `level.ts` (ASCII level parser, floors), `maps/`, `wire.ts` (the packed snapshot and how every screen unpacks it) |
| Server authority | `server.ts`, `sim/` (crew, NPCs, security, projection; `night.ts` runs every crew's heist, the board, the sunrise clock and the broadcast director; `harness.ts` is the test kit), `server-levels/` (NPC routes, never imported by clients) |
| TV renderer | `scene.tsx`, `render/` (Three.js world, blueprint fog shader, actors, cones, effects, 2D overlay) |
| Phone map | `tactical.ts` (2D canvas floor plan a phone draws on a crew night; no three.js) |
| UI and audio | `client.tsx`, `hud.tsx` (TV HUD and the crew board), `controller.tsx`, `lobby.tsx`, `results.tsx`, `preview.ts`, `audio.ts`, `style.css` |
| Dev and QA | `dev/` (sandbox page: real rules, bots, every screen, staged scenes), `tools/` (`bot.ts` crew bot, `room-bot.ts` socket-bot hook, `night-sim.ts` headless nights) |
| Art | `art/build-kit.py` builds `public/games/night-job/models/night-job-kit.glb` in Blender; see `art/README.md` |
| Music | `music/tracks.ts` composes six original loops in code (synth engine shared with Ichi); `music/export.ts` renders the three chosen ones to `public/games/night-job/music/<mission>.mp3` |

The server owns every result. Snapshots contain only crew knowledge: NPCs in sight, doors as last seen, crew-made noises and Scout/Wire intel. On a crew night a phone is sent its own crew's view and the view of the crew on the TV, never another crew's unseen guards. The host display plays each mission's music loop (Velvet Rope, Orchid Bossa, Last Ferry Shanty) under synthesised effects for the crew on screen; it ducks during alarms and fades on a bust.

## Development

From the parent PartyPlay repository:

```sh
node --import tsx --test packages/games/night-job/tests/*.test.ts
node --import tsx --test tests/night-job-room.test.ts tests/registry-contract.test.ts
npm run typecheck && npm run lint
npm run build:isolated -- night-job-<unique-run>
npm run serve:isolated -- night-job-<unique-run> <port>
npx vite --config packages/games/night-job/dev/vite.config.mjs --host 127.0.0.1 --port 4422   # sandbox: /?players=32&role=display, /?players=32&role=phone&seat=5, /?scene=chase
node --import tsx packages/games/night-job/tools/night-sim.ts --players 32 --mission velvet --runs 3   # headless nights: completion, tick cost, bytes
node --import tsx scripts/qa/room-bots.ts --port <port> --code <ROOM> --players 31 --stats 5 --hook packages/games/night-job/tools/room-bot.ts   # fill a real room with playing bots
blender -b --python packages/games/night-job/art/build-kit.py   # rebuild the model kit
node --import tsx packages/games/night-job/music/render.ts output/night-job-music   # audition all six loops
node --import tsx packages/games/night-job/music/export.ts   # re-export the mission loops (needs ffmpeg)
```

Never run Prettier. Maps, models, names, music and sounds are original; no Monaco assets or code are used.
