# INKWAVE for PartyPlay

A port of [amiaoapp/inkwave](https://github.com/amiaoapp/inkwave), preserving the original Three.js stages, characters, ink rendering, HUD, menus, character showcases, fonts, touch controls, soundtrack and sound effects. The platform supplies rooms, player seats, readiness, loading, reconnection and replay.

## Play

Add INKWAVE from Discover, open a room, and share its QR code. Up to eight players join with phones in landscape. A host can watch the arena or occupy a player seat; one player can play against CPUs. Teams alternate by join order, and CPUs fill both teams to four. Boss Battle puts everyone in one squad of eight. Cargo Terminal follows the original human-only rule: at least two players, no CPU fill or takeover.

Move with the left thumb. Drag the right side to aim, or drag the large fire button to shoot while aiming. SQUID swims and refills in friendly ink; JUMP, SUB, SP and MAP retain the original abilities. Keyboard/mouse: WASD, mouse aim, click, Shift, Space, E, F, Tab.

The phone's movement stick is visible at rest and reaches full speed with a 50px drag. Accepted touch gestures capture their pointer; cancellation, rotation, backgrounding and disconnect release held controls. Equipment uses the original cards and character showcase with direct Weapon, Sub and Special tabs. Portrait phones put the preview above a scrolling picker; landscape keeps it beside the choices. The Ready action stays outside the scrolling equipment list.

During play the arena fills the phone screen. The shell's Full screen and Sound buttons stack in the top-left corner, beside the squad icons and above both thumb zones; the minimap and the stage-map title sit below them. Short landscape phones keep Ready over the character preview so the loadout uses the full height.

The shared display lays each stage's long axis across the screen (team 0's base on the left, matching its score), with the original Titan type, live team colours and names, and every player's turf or boss damage along the bottom. A watching screen's results name the winning team rather than claiming a victory.

On the tactical map, drag to a teammate and tap Fire to Super Jump; tap MAP to close it. The camera follows the server's replicated flight position, including when the client has no local flight endpoints.

All eight stages, day/dusk, Turf War, Zone Control and Boss Battle are available. Cargo Terminal supports Turf War and Zone Control; the other seven stages also support HULLBREAKER. All twelve main weapons, fifteen subs, nineteen specials and all six locker appearance categories are exposed. Match lengths are 30, 60, 90, 180, 240 or 300 seconds; the original Zone Control setup uses five minutes plus possible overtime. The platform owns joining, names, readiness and replay.

## Code map

- `src/manifest.ts` and `src/server.ts` implement the shared game contract. Controls are bounded and validated; map actions carry the current match ID. The server owns movement, hits, ink, clocks and results.
- `src/engine.server.js` runs the original simulation at 60 Hz without a browser or WebGL. Original collision and CPU paint grids determine scoring. Disconnected seats become CPUs until their player returns, except Cargo seats, which stay inactive. Boss state and hazards are authoritative and included in reconnect snapshots.
- `src/client.tsx` connects the original loadout, locker, stage picker and results screens to the platform. `public/menus.js` retains the original podium animations, medals and local XP; `public/sound.js` owns one persistent host soundtrack. The scene iframe contains the original renderer and controls. Messages must match the iframe, origin and round ID; it opens no second socket.
- `public/platform.js` reconstructs the scene, interpolates authoritative actor snapshots, replays original visual effects and forwards input at 20 Hz. The camera responds locally. A packed paint baseline restores a rejoining screen; zone ownership and beacons also synchronize.
- `upstream/src/core/ctx.js` isolates the upstream global context, event listeners, kit pools and seeded randomness per server room. Kit modules register their live arrays/maps; scratch geometry and immutable definitions remain shared.

Paint baselines use two bits per grid cell and the platform snapshot cache. Splats between baselines preserve the original organic visual shapes. Reconnection rebuilds older ink from the coarser gameplay grid; short-lived effects resume from recent events. Both phones and the watching display use the original low graphics tier to reduce first-frame loading. `build.mjs` bundles the original module graph, and the manifest allows 60 seconds for every screen to prepare. The game still waits for actual scene readiness before starting. Sound effects and the original procedural menu, battle, boss-phase and results music obey the platform Sound toggle after a browser gesture. Optional recorded songs are absent from the upstream repository; the original synth soundtrack is used.

Phones additionally cap rendering at one pixel per CSS pixel, skip SMAA, and allow the original adaptive-resolution controller to lower density to 0.75 during sustained slow frames. This removes the upstream touch override that forced 1.5× density even on Low. The minimap uses 3 rather than 7 pixels per world unit, keeping its original colors and markers with 82% fewer pixels to update. Menu showcases render at 30 Hz and stop drawing while ready or hidden. Desktop rendering presets, authoritative simulation and input cadence remain unchanged. `public/mobile.css` contains the phone layout; `tests/mobile.test.ts` guards the rendering budget.

## Validation

From the platform checkout:

```sh
npm run typecheck
node --import tsx --test packages/games/inkwave/tests/*.test.ts tests/registry-contract.test.ts tests/catalog.test.ts tests/curated-catalog.test.ts
npm run build:isolated -- inkwave-check
npm run serve:isolated -- inkwave-check 4377
```

Use a fresh build name and unused port. See [QA.md](QA.md) for the tested build, browser evidence and device limits.

## Provenance and patches

Source snapshot: `7c970e65beea8f54ca94d2ac326674e0c2e7279b`. Copyright 2026 Jayden Davis, MIT; see [upstream/LICENSE](upstream/LICENSE). Three.js r186 retains its MIT license under `public/vendor/three/LICENSE`. Titan One and Rubik retain their OFL notices in `public/assets/fonts/`.

The upstream source is vendored deliberately: it is the renderer and gameplay implementation, not a visual approximation. Changes are limited to exporting the bootstrap/actor encoder, suppressing automatic standalone boot for `?party`, per-room context and kit state, deterministic gameplay randomness, headless character-icon guards, local special targeting on a remote-rendered actor, accessible touch buttons, SP/YEAH spacing so no touch buttons overlap, an optional results title, responsive embedded menus, and PartyPlay setup/result hooks. `public/engine` links to `upstream/src`; the repository's `public/games/inkwave` links to this game's public directory. Game code and assets belong in the `partyplay-games` submodule.
