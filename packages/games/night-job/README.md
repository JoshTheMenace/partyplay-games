# Night Job

A cooperative top-down 3D heist for one to four thieves, inspired by Monaco (2013). The TV shows the building as a navy blueprint; each thief's line of sight reveals the lit room around them. Steal the objective, grab optional loot, and get the whole crew to the getaway. Being spotted starts a chase you can escape, not a game over.

## Play

Pick Night Job in the PartyPlay library, choose a mission and Normal or Relaxed in Settings, and have each player join on a phone, pick one of eight specialists and one of six tools, then Ready. The host screen is a dedicated TV display and never takes a seat.

The phone is a landscape controller: a light push on the stick sneaks silently, a full push runs and leaves noise rings guards can hear, and holding Sneak forces quiet movement. Push into doors, locks, safes, terminals, windows, vents, hiding spots, fallen teammates or the objective to work on them. Tap Tool to use your equipment in the direction you face. Every ten coins you collect refills a tool charge. Results award one to three stars against par (elapsed time plus 3 s per missed coin) and hand out crew awards.

Missions: **The Velvet Ledger** (casino), **Glasshouse Exchange** (glass conservatory), **Last Ferry** (night docks).

## Implementation

[DESIGN.md](DESIGN.md) is the contract for rules, tuning, the level format, networking and the asset kit. `src/model.ts` holds the shared types and constants.

| Area | Files |
| --- | --- |
| Shared, browser-safe | `model.ts`, `geometry.ts` (grid, exact rays, sight polygons, A*), `level.ts` (ASCII level parser), `maps/` |
| Server authority | `server.ts`, `sim/` (crew, NPCs, security, projection; `harness.ts` is the test/bot kit), `server-levels/` (NPC routes, never imported by clients) |
| TV renderer | `scene.tsx`, `render/` (Three.js world, blueprint fog shader, actors, cones, effects, 2D overlay) |
| UI and audio | `client.tsx`, `hud.tsx`, `controller.tsx`, `lobby.tsx`, `results.tsx`, `preview.ts`, `audio.ts`, `style.css` |
| Art | `art/build-kit.py` builds `public/games/night-job/models/night-job-kit.glb` in Blender; see `art/README.md` |
| Music | `music/tracks.ts` composes six original loops in code (synth engine shared with Ichi); `music/export.ts` renders the three chosen ones to `public/games/night-job/music/<mission>.mp3` |

The server owns every result. Public snapshots contain only crew knowledge: NPCs in sight, doors as last seen, crew-made noises and Scout/Wire intel. The host display plays each mission's music loop (Velvet Rope, Orchid Bossa, Last Ferry Shanty) under synthesised effects; it ducks during alarms and fades on a bust.

## Development

From the parent PartyPlay repository:

```sh
node --import tsx --test packages/games/night-job/tests/*.test.ts
node --import tsx --test tests/night-job-room.test.ts tests/registry-contract.test.ts
npm run typecheck && npm run lint
npm run build:isolated -- night-job-<unique-run>
npm run serve:isolated -- night-job-<unique-run> <port>
blender -b --python packages/games/night-job/art/build-kit.py   # rebuild the model kit
node --import tsx packages/games/night-job/music/render.ts output/night-job-music   # audition all six loops
node --import tsx packages/games/night-job/music/export.ts   # re-export the mission loops (needs ffmpeg)
```

Never run Prettier. Maps, models, names, music and sounds are original; no Monaco assets or code are used.
