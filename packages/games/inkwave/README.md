# INKWAVE for PartyPlay

A port of [amiaoapp/inkwave](https://github.com/amiaoapp/inkwave), preserving the original Three.js stages, characters, ink rendering, HUD, menus, character showcases, fonts, touch controls, soundtrack and sound effects. The platform supplies rooms, player seats, readiness, loading, reconnection and replay.

## Play

Add INKWAVE from Discover, open a room, and share its QR code. One to 64 players join with phones in landscape. A host can watch the arena or occupy a player seat; one player can play against CPUs.

An arena is 4v4, as the stages, weapons and spawn decks were built. Up to eight players share one arena: teams alternate by join order and CPUs fill both teams to four. A bigger room keeps its two room-wide teams, Tangerine and Cobalt, and is dealt into one arena per eight people (nine players are two arenas, 64 are eight). All arenas play the same stage and mode at once, each phone draws and receives only its own, and the lobby shows every player their team and arena before the match.

- **Turf War:** every arena's paint counts. The room goes to the team with the most turf across all arenas, then to the team that took more arenas.
- **Zone Control:** the room goes to the team that wins more arenas, then to the lower total countdown, then to turf.
- **Boss Battle:** each arena is one squad of eight against its own HULLBREAKER. The room wins if at least half the squads sink it; the results credit the squads that did.

Cargo Terminal follows the original human-only rule: at least two players, no CPU fill or takeover. A disconnected seat elsewhere is played by a CPU until its player returns.

Move with the left thumb. Drag the right side to aim, or drag the large fire button to shoot while aiming. SQUID swims and refills in friendly ink; JUMP, SUB, SP and MAP retain the original abilities. Keyboard/mouse: WASD, mouse aim, click, Shift, Space, E, F, Tab. On the tactical map, drag to a teammate and tap Fire to Super Jump; tap MAP to close it.

The phone has the original match presentation, driven by the server's events: the fly-in over the stage with READY and GO, hit markers, a flash from the side the ink came from, the splat card with its respawn clock and the camera on whoever got you, the kill feed, the last-minute call, the final ten-second count, and the crane up over the stage at time. A phone whose arena is decided while others play on is told so and pointed at the TV.

The shared display is a broadcast. It lays each stage's long axis across the screen (team 0's base on the left, like its score), opens on the whole stage with the two line-ups, then eases in on wherever the players are and back out for the final count. Every character carries a name tag (a squid hidden in its own ink is hidden from the audience too). The scoreboard shows the timer, both teams, each player's turf and splats with splatted players dimmed, a who-splatted-whom feed, lead and zone changes, "one minute left", the countdown and the result. In a room of several arenas it shows the room's combined score, one chip per arena with its live score, the name of the arena on air, and cuts to the next live arena every fourteen seconds, stays four seconds on an arena that has just finished, and holds on the closest Turf War for the last twenty seconds. A watching screen's results name the winning team; a big room's results show the room verdict, the top scorers and every arena with its eight names.

All eight stages, day/dusk, Turf War, Zone Control and Boss Battle are available. Cargo Terminal supports Turf War and Zone Control; the other seven stages also support HULLBREAKER. All twelve main weapons, fifteen subs, nineteen specials and all six locker appearance categories are exposed. Match lengths are 30, 60, 90, 180, 240 or 300 seconds; the original Zone Control setup uses five minutes plus possible overtime.

## Code map

- `public/arenas.js` is shared by the server, the arena iframe and the shell views: how a room is dealt into arenas and teams (`dealSeat`, `dealArenas`) and the run-length packing of a paint baseline.
- `src/manifest.ts` and `src/server.ts` implement the shared game contract. `server.ts` owns the room: one `Engine` per arena, the broadcast director that picks the arena on the TV, the room result (`roomResult`) and the projections. Controls are bounded and validated; map actions carry the current match ID. The server owns movement, hits, ink, clocks and results.
- `src/engine.server.js` runs the original simulation for one arena at 60 Hz without a browser or WebGL. Original collision and CPU paint grids determine scoring. Arenas of one room share the static stage (collision, navigation, the paint grid's buried-cell map), so eight arenas start in about the time of two. Boss state and hazards are authoritative.
- `src/client.tsx` holds the lobby line-up, the TV scoreboard and commentary, the big-room results and the bridge to the original screens (`src/labels.ts`: the stage and team names it shows before a match exists). `public/menus.js` retains the original loadout, locker, stage picker and podium results; `public/sound.js` owns one persistent host soundtrack. Messages must match the iframe, origin and round ID; no iframe opens a socket.
- `public/platform.js` is the arena iframe: it reconstructs the scene, interpolates authoritative actor snapshots on the server's clock, replays original effects on the same timeline, drives the phone's match presentation and the TV's broadcast camera and name tags, and forwards input at 20 Hz. The camera responds locally.
- `upstream/src/core/ctx.js` isolates the upstream global context, event listeners, kit pools and seeded randomness per arena. Kit modules register their live arrays/maps; scratch geometry and immutable definitions remain shared.
- `tools/measure.mjs` prints server tick time and per-screen traffic for any roster; `tools/room-bot.mjs` is the hook for `scripts/qa/room-bots.ts` (seats that pick a loadout, run, aim and fire).

### What travels

The TV's arena rides in the public view (`live`); in a room of several arenas each seat privately gets its own arena instead. Per snapshot that is the eight packed actors, a few numbers of score, and the events of the last 0.11 s. Every event carries a sequence number and the simulation time, appears in two or three consecutive snapshots, and is replayed on the client at the same delay as the interpolated characters it belongs to. The roster, settings and team colours are cached fields whose revision never moves, so a socket receives them once.

Paint baselines are the 0/1/2 gameplay grid as run lengths (3–9 KB against the earlier 57–73 KB of packed bits). Each arena retakes one every two seconds; the public view carries the featured arena's newest for a screen that connects now, and announces each retaken one once (`fresh`), which is also how the TV repaints when the broadcast cuts. A screen that notices it has missed events (`eventBase` is past the last one it played) repaints from the next baseline; otherwise splats keep the original organic shapes.

Measured on the loaded development machine with scripted seats (`tools/measure.mjs`, Tidewater, Turf War): eight players cost the server about 2 ms a tick and a phone 56 KiB/s (about 340 KB/s before this pass); 32 players 6 ms and 137 KiB/s; 64 players 6–8 ms (p95 12–14 ms of the 16.7 ms tick) and about 130 KiB/s. The largest message in play is 18 KB at 64; the one message a socket gets when it (re)connects, with the roster and paint, reaches 31 KB there. A phone's traffic and drawing do not grow past two arenas' worth (its own and the TV's) however large the room is. The finished round is a still view under 1.5 KB with the result cached per socket, because the platform keeps re-sending the results snapshot.

### Loading and reconnecting

Both phones and the watching display use the original low graphics tier. `build.mjs` bundles the original module graph, and the manifest allows 120 seconds for every screen to prepare; the game still waits for actual scene readiness before starting. The arena iframe belongs to the shell's stage element, not to the React scene component, so a socket that drops and returns finds its arena as it left it (loaded or still loading) instead of rebuilding it; it goes when the stage does. Sound effects and the original procedural menu, battle, boss-phase and results music obey the platform Sound toggle after a browser gesture. Optional recorded songs are absent from the upstream repository; the original synth soundtrack is used.

Phones additionally cap rendering at one pixel per CSS pixel, skip SMAA, and allow the original adaptive-resolution controller to lower density to 0.75 during sustained slow frames. The minimap uses 3 rather than 7 pixels per world unit. Menu showcases render at 30 Hz and stop drawing while ready or hidden. `public/mobile.css` contains the phone layout (portrait frames put the preview above a scrolling picker; landscape frames, including the 544×236 frame of a 568×320 phone, put it beside the choices); `tests/mobile.test.ts` guards the rendering budget.

## Validation

From the platform checkout:

```sh
npm run typecheck
node --import tsx --test packages/games/inkwave/tests/*.test.ts tests/registry-contract.test.ts tests/catalog.test.ts tests/curated-catalog.test.ts
node --import tsx packages/games/inkwave/tools/measure.mjs 8,32,64
npm run build:isolated -- inkwave-check
HOST=127.0.0.1 npm run serve:isolated -- inkwave-check 4410
node --import tsx scripts/qa/room-bots.ts --port 4410 --code <ROOM> --players 31 --stats 10 --hook packages/games/inkwave/tools/room-bot.mjs
```

Use a fresh build name and unused port. See [QA.md](QA.md) for the tested build, browser evidence and device limits.

## Provenance and patches

Source snapshot: `7c970e65beea8f54ca94d2ac326674e0c2e7279b`. Copyright 2026 Jayden Davis, MIT; see [upstream/LICENSE](upstream/LICENSE). Three.js r186 retains its MIT license under `public/vendor/three/LICENSE`. Titan One and Rubik retain their OFL notices in `public/assets/fonts/`.

The upstream source is vendored deliberately: it is the renderer and gameplay implementation, not a visual approximation. Changes are limited to exporting the bootstrap/actor encoder, suppressing automatic standalone boot for `?party`, per-room context and kit state, deterministic gameplay randomness, headless character-icon guards, local special targeting on a remote-rendered actor, accessible touch buttons, SP/YEAH spacing so no touch buttons overlap, an optional results title, responsive embedded menus, and PartyPlay setup/result hooks. The 2026-11 pass changed no file under `upstream/src`: arenas, the event timeline, the phone presentation and the broadcast are all in the platform layer. `public/engine` links to `upstream/src`; the repository's `public/games/inkwave` links to this game's public directory. Game code and assets belong in the `partyplay-games` submodule.
