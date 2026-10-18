# Kart Party

A ground-up rebuild (2026-09-23) of the PartyPlay kart racer: 1–10 racers, five courses (the last is the Rainbow Road finale), eight Blender-made characters and four karts (including the thruster-equipped Roadster), drift mini-turbos, items and CPU rivals. [DESIGN.md](DESIGN.md) is the design, tuning targets and module map.

## Layout

- `src/manifest.ts`, `src/server.ts`, `src/client.tsx`, `src/scene.tsx`: platform entry points.
- `src/sim/`: deterministic simulation (physics, race, items, CPU drivers, snapshot projection). It runs on the server and, for the local kart, in the browser.
- `src/tracks/`: course definitions; `sim/track.ts` turns them into shared geometry.
- `src/net/`: snapshot interpolation, local-kart prediction and the compact wire codec.
- `src/render/`: Three.js world, cameras, split viewports, karts and effects.
- `src/ui/`, `src/audio/`: HUD, controller, lobby, settings, results; synthesized sound and music playback.
- `art/karts/`, `art/props/`: Blender build scripts for `public/models/karts.glb` and `props.glb`.
- `dev/`: local sandbox that runs a race straight into the real scene, plus actor and UI harnesses. It is not part of the platform build.

## Play and validate

From the platform root:

```sh
npm run typecheck
npm run test:kart
npm test
npm run build:isolated -- kart-check
npm run serve:isolated -- kart-check 4340
```

Sandbox: `npx vite --config packages/games/kart-party/dev/vite.config.mjs --port 5190`, then open `http://localhost:5190/games/kart-party/?track=palm-bay&players=1&cpus=7`. Rebuild models with `blender --background --python art/karts/build_karts.py` or `art/props/build_props.py`.

## How to race

Open **Settings** in the PartyPlay header, then toggle **Tilt steering**. Sound and game-specific device preferences share this panel. This preference is saved only in that device's browser; it never changes room settings. Tilt uses the phone's motion sensors, calibrates to your holding position, and keeps drift, brake and item buttons. **Center steering** recalibrates. Motion access needs HTTPS and, on some browsers, a permission tap; touch remains available if permission or sensor data is missing. Opening Settings, returning from a hidden tab, rotation or reconnect clears and recalibrates steering.

The kart accelerates by itself. Steer, then hop into a drift: holding it through a corner charges blue, orange and purple mini-turbos. Tap drift on GO for a rocket start, and again off a ramp lip for a trick boost. Item boxes give position-weighted items; hold the item button to drag a peel or shell behind you as a shield. Keyboard: arrows or A/D steer, Space or Shift drift, E item, S brake, H honk, F fly (Roadster).

**The Roadster** is modelled on the next-generation Tesla Roadster revealed on 2026-10-15: the fiercest launch, slightly less grip, and cold-gas thrusters. Tap **FLY** for a one-second burst that lifts the car over shells and karts; the tank holds five bursts (the ~5 s of thrust reported at the reveal) and refills while the wheels are down.

**Chaos** (a race setting: Off, Chaos, Total chaos) drops a surprise on the whole field every ~20 s (or ~10 s): Moon Gravity, Banana Storm, Item Frenzy, Mega Karts, Hyper Speed or Underdog Stars, each with a banner, a colour wash and a siren.

Rainbow Road adds its own tricks: fly or drive through a star ring for a boost, hit a spring pad to launch (tap drift in the air for a trick), float through the low-gravity Moon Hop, and dodge the sliding pinball bumpers.

Up to four humans share the TV in split screen. With five or more (or **Personal views**), each racer sees their own phone while the TV follows the race.

Music files in `public/music` are supplied by the project owner and are unchanged.
