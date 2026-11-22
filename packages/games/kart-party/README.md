# Kart Party

A ground-up rebuild (2026-09-23) of the PartyPlay kart racer: 1–64 racers (32 at once is the size that is tested end to end; 64 is the room's ceiling), five courses (the last is the Rainbow Road finale), eight Blender-made characters and four karts (including the thruster-equipped Roadster), drift mini-turbos, items and CPU rivals. [DESIGN.md](DESIGN.md) is the design, tuning targets and module map.

## Layout

- `src/manifest.ts`, `src/server.ts`, `src/client.tsx`, `src/scene.tsx`: platform entry points.
- `src/sim/`: deterministic simulation (physics, race, items, CPU drivers, snapshot projection). It runs on the server and, for the local kart, in the browser.
- `src/tracks/`: course definitions; `sim/track.ts` turns them into shared geometry.
- `src/net/`: snapshot interpolation, local-kart prediction and the compact wire codec.
- `src/render/`: Three.js world, cameras, split viewports, karts and effects.
- `src/ui/`, `src/audio/`: HUD, controller, lobby, settings, results; synthesized sound and music playback.
- `art/karts/`, `art/props/`: Blender build scripts for `public/models/karts.glb` and `props.glb`.
- `dev/`: local sandbox that runs a race straight into the real scene, plus actor and UI harnesses. It is not part of the platform build.
- `tools/`: `bench.ts` prints simulation and snapshot cost at 10, 32 and 64 racers; `room-bot.ts` is the hook that makes the platform's socket bots pick racers, steer, drift and fire items.

## Play and validate

From the platform root:

```sh
npm run typecheck
npm run test:kart
npm test
npm run build:isolated -- kart-check
npm run serve:isolated -- kart-check 4340
```

Sandbox: `npx vite --config packages/games/kart-party/dev/vite.config.mjs --port 5190`, then open `http://localhost:5190/games/kart-party/?track=palm-bay&players=1&cpus=7` (`cpus` up to 63, `kart=roadster`, `tier=0|1|2` to pin graphics quality, `metrics=1` for draw calls and triangles). Rebuild models with `blender --background --python art/karts/build_karts.py` (`-- --only=roadster` re-renders one kart's preview) or `art/props/build_props.py`.

A crowd, from the platform root with an isolated server running and a room created from a real host page:

```sh
node --import tsx scripts/qa/room-bots.ts --port 4421 --code ABCDEF --players 31 --stats 5 --hook packages/games/kart-party/tools/room-bot.ts
node --import tsx packages/games/kart-party/tools/bench.ts palm-bay 60
```

## How to race

Open **Settings** in the PartyPlay header, then toggle **Tilt steering**. Sound and game-specific device preferences share this panel. This preference is saved only in that device's browser; it never changes room settings. Tilt uses the phone's motion sensors, calibrates to your holding position, and keeps drift, brake and item buttons. **Center steering** recalibrates. Motion access needs HTTPS and, on some browsers, a permission tap; touch remains available if permission or sensor data is missing. Opening Settings, returning from a hidden tab, rotation or reconnect clears and recalibrates steering.

The kart accelerates by itself. Steer, then hop into a drift: holding it through a corner charges blue, orange and purple mini-turbos. Tap drift on GO for a rocket start, and again off a ramp lip for a trick boost. Item boxes give position-weighted items; hold the item button to drag a peel or shell behind you as a shield. Keyboard: arrows or A/D steer, Space or Shift drift, E item, S brake, H honk, F fly (Roadster).

**The Roadster** is modelled on the next-generation Tesla Roadster: a low closed-wheel body with tall haunches, thin LED blades on a smooth nose, a full-width light bar and four thruster nozzles across the tail. It drives like an electric car: instant torque off the line and out of slow corners, planted and heavy, with no exhaust (its boosts are cold-gas jets). Tap **FLY** for a one-second burst that lifts the car over shells and karts; the tank holds five bursts (the ~5 s of thrust reported at the reveal) and refills while the wheels are down.

**Chaos** (a race setting: Off, Chaos, Total chaos) drops a surprise on the whole field every ~20 s (or ~10 s): Moon Gravity, Banana Storm, Item Frenzy, Mega Karts, Hyper Speed or Underdog Stars, each with a banner, a colour wash and a siren.

Rainbow Road adds its own tricks: fly or drive through a star ring for a boost, hit a spring pad to launch (tap drift in the air for a trick), float through the low-gravity Moon Hop, and dodge the sliding pinball bumpers.

Up to four humans share the TV in split screen. With five or more (or **Own phone**), each racer sees their own phone while the TV follows the race. More than ten always race on their own phones.

**Big rooms.** A room of up to 64 can race together. The start grid widens to five or six lanes, item boxes refill faster so the pack is armed, a kart that was just hit is left alone a little longer, and thunder and comets come less often. Phones name the nearest rivals above their karts. The TV becomes a broadcast: it cuts between the leader, the closest fight and a spotlight that visits everyone, with a standings tower that pages through the field, the leader's lap and a feed of who hit whom. Full-quality displays also get bloom (boost jets, sparks, neon and the rainbow glow); phones skip it. [DESIGN.md §10](DESIGN.md) has the rules and the measured costs.

Music files in `public/music` are supplied by the project owner and are unchanged.
