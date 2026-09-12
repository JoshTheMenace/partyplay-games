# Kart Party

Kart Party lives alongside every other game at `packages/games/kart-party/`. It originally had a standalone implementation; the shared-room adapter was added later. Both now live in this one game directory.

## Layout

- `src/manifest.ts`, `src/server.ts`, `src/client.tsx`, `src/scene.tsx`: integration with the shared PartyPlay room, controllers and scene lifecycle.
- `src/engine/`: racing simulation, tracks, rendering, audio and retained standalone UI.
- `src/standalone-server/`, `src/app/`, `src/lib/`, `index.html`: retained standalone reference and its supporting code. The platform does not mount a second Kart lobby or WebSocket service.
- `tests/`: focused racing, networking, rendering, screen routing and asset tests.
- `public/`: Kart music, fonts, icons and their license notices. The collection's `public/games/kart-party` directory is a symlink here, preserving `/games/kart-party/` asset URLs.

## Play and validate

Use the Party Place consumer workspace with this repository initialized as its `game-modules` submodule. From the platform root:

```sh
npm run typecheck
npm run test:kart
npm test
npm run build:isolated -- kart-check
npm run serve:isolated -- kart-check 4340
```

`npm test` discovers Kart tests alongside the other games; `test:kart` is a focused subset. Add Kart Party from Discover to My Library, then press Play. The game uses the same room code and `/ws` connection as the other games. A playing host can race solo with keyboard/touch or invite phone controllers; a watching host uses no player seat. Four tracks and up to ten players are supported.

The isolated build leaves existing live previews undisturbed. `vite.kart.config.ts` remains a separate build option for the original standalone reference; it is not part of the normal platform build.

See [PROVENANCE.md](PROVENANCE.md) and [REFERENCE.md](REFERENCE.md) for historical source information. They describe the original standalone implementation, not the current shared-room launch flow.

## Blender models and course interactions

The live renderer loads `public/models/garage.glb` before reporting scene readiness. It contains ten original animal racers, two interchangeable vehicle bodies, and four course props. `art/garage.blend` is the editable asset-library scene; `art/build_models.py` rebuilds the GLB, reimports it to check the rigs, and renders `art/garage-preview.png`. Run it with Blender's background CLI. Materials are embedded, with no external texture or decoder dependency. The library is 8.04 MiB and contains 331,464 triangles across the complete asset library. A rendered racer uses one character and one vehicle, not the complete library.

Each racer has axle-centred spinning wheels, separate front steering pivots, a steering wheel, head and arm pivots. The existing `kart-animation.ts` smooths steering and head movement and poses arms for jumps and finishes. Geometry and materials are cloned per instance so replay and track disposal cannot invalidate another kart. The procedural rig remains available for engine fixtures; live races wait for the Blender library and show a loading failure if it cannot load.

- **Seabreeze:** alternate around buoy chicanes on the boardwalk; choose the dry lane beside tidal slicks to keep speed and grip.
- **Copper Canyon:** watch the striped boulder crossings, time your pass, then slalom around rocks in the ruins.
- **Starlight:** pass moving delivery traffic and use the green express lanes for sustained boost.
- **Rainbow:** dodge orbiting satellites and choose launch lanes for a boosted jump, alongside the existing magnetic loop.

`course-features.ts` defines obstacle positions from race time and applies lane effects and physical contacts on the server. `course-feature-visuals.ts` uses those same definitions and surface frames, so visible obstacles match collision locations. CPUs choose open lanes but have no obstacle immunity. Jumping above an obstacle clears it; finishers do not interfere with active racers.

`kart-contact.ts` separates overlapping karts and exchanges closing velocity between equal masses with mild restitution. Rear impacts transfer speed; side impacts produce lateral motion. Separating karts gain no extra impulse, and exact overlaps have a stable fallback direction. Loop contacts exchange longitudinal speed while staying in the magnetic road's local coordinates. Collision correction never awards checkpoints.

Validation and limits: [UPGRADE-QA.md](UPGRADE-QA.md).

## Where race views appear

Choose **Race views** in the lobby settings before starting:

- **Auto** (default): 1–4 human racers share the TV split screen; 5–10 get personal views on their own phones/devices.
- **TV views**: keep the split screen at any supported player count. Joined phones show controls without downloading the 3D scene.
- **Personal views**: each racer sees one chase camera on their own device, including a playing host. A watch-only host/TV follows the race leader, holds each shot for at least six seconds, and immediately leaves a racer who finishes or disconnects.

Auto uses the active round roster, excluding CPUs and late joiners. It stays fixed through disconnects and reconnects. Personal phones use the existing landscape controls over the course, capped at 1× resolution without shadows. Sound remains on the host to avoid ten overlapping music tracks. All screens use the same authoritative room snapshots and held-input channel; phone rendering does not simulate a separate race.

`views.ts` owns the routing policy and broadcast director. The server records the resolved mode in each race; `client.tsx` handles settings and skips scene loading for TV controllers, while `scene.tsx` selects camera targets. The shared scene props forward host status so a playing host can be distinguished from a joined controller. The room server ignores readiness arriving after a cancelled load, preventing stale warnings without allowing an old message to ready a new round.

Screen-mode validation and device limits: [VIEWS-QA.md](VIEWS-QA.md).

## Driving polish

Shared-room keyboard and touch steering use the same screen-to-world conversion as the standalone controls. Boost expiry and slower road surfaces now shed speed gradually; brakes, frost and stun retain their immediate effects. Chase cameras ease turning and boost zoom, with immediate cuts for a changed subject or recovery. Ordinary kart and obstacle contact produces a short bump sound, gold sparks and body recoil without an item stun. Raised bend chevrons and cyan launch lanes make the racing line easier to read; static guidance is batched by material.

Implementation decisions, measured checks and playtest limits: [DRIVING-QA.md](DRIVING-QA.md).

## Garage and alternate routes

Before each shared-room race, everyone has up to 45 seconds to select one of ten characters and three Blender-authored karts. Characters change appearance. The Roadster is balanced; Arrow trades acceleration and handling for 5% more top speed; Rover trades 4% top speed for 7% better acceleration and handling. The screen shows these comparisons before confirming. All-ready starts the shared countdown early; timeout uses the current choices. Changing a ready choice clears readiness, and reconnect retains the last saved choice for that race. There are no separate wheel selections.

Every existing course now has a physical fork with its own elevation, width, driving line and interaction:

- Seabreeze’s **Tidal Causeway** drops below the clifftop. The dry shortcut is fast, but timed sea spray slows its narrow deck.
- Copper Canyon’s **Eagle Ridge** climbs a narrow trestle around the boulder crossing. Periodic crosswinds reward careful steering.
- Starlight’s **Freight Express** leaves the traffic lane for a conveyor road with a timed dispatch gate. The entrance signal shows whether to commit or brake.
- Rainbow’s **Starwind Orbit** rises outside the main road. Its cycling current adds speed and outward drift before it descends to rejoin.

Course definitions live in `src/engine/courses/`. `course-routes.ts` maps each fork to shared lap progress, and `course-interactions.ts` applies its surfaces, gates and CPU route choice. The renderer uses the same samples for road geometry and camera clearance. Forks keep mandatory checkpoints and pass up main-road item pickups; jumping does not accidentally select a fork.

`engine/garage.ts` defines the modest vehicle multipliers. `server.ts` owns selection and readiness; `garage-view.tsx` shows accepted choices. `kart.ts` swaps a vehicle chassis and wheel pivots while retaining the character’s steering, head and arm animation. The Blender source and all 30 character/vehicle combinations are checked by the asset tests.

Current validation: [ROUTES-GARAGE-QA.md](ROUTES-GARAGE-QA.md). No cups, ghosts, battle mode or track editor were added.
