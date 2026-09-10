# 3D Scene Lab

A copyable development slice for the party platform: 2–10 players steer numbered pucks, hold Boost, collect stars, collide with the pillar/walls, and reach scored results in 20 or 45 seconds. Players pass through each other deliberately. It has no music and is excluded from the normal game catalogue.

Run commands and platform APIs: [3D guide](../../../docs/party-platform/3D-READINESS.md). Evidence: [QA report](../../../output/3d-prerequisites/QA.md).

## Adapt into a new game

- `manifest.ts`: supported modes, roster, orientation and opt-in 60 Hz simulation / 20 Hz snapshots.
- `model.ts`: shared public types, metres/+Y up/+Z down-screen, bounds/collision sizes, and interpolation. No server state or random seed enters the client.
- `server.ts`: seeded spawns/collectibles, input parsing, authoritative movement/collision/scoring, disconnect behavior, deadline and results.
- `client.tsx`: shared controller primitives, settings, HUD, instructions; lazy SceneView keeps Three.js out of the phone download path.
- `scene.tsx`: camera, owned procedural assets, snapshot interpolation, compile/render readiness, low/balanced graphics and metrics. Change art here without changing rules.

Create a new package ID and register its manifest/rules in `apps/party-server/src/registry.ts` and its lazy client in `apps/party-client/src/registry.ts`. Scene Lab's environment gate is for the development fixture; register a requested finished game normally. Add launcher art in `apps/party-client/src/art.tsx`; generic fallback art is only scaffolding. Follow the shared UI skill and add rule tests plus real UI-to-results/replay evidence.

Reference budgets: one shared camera, 10 players, frame p95 ≤33.3 ms on the development desktop, scene startup <3 seconds after the module arrives, 20 Hz held input/snapshots. The 100 ms interpolation delay is visible-latency smoothing, not client prediction. Measure on the target TV/laptop and Wi-Fi before adopting these budgets. Low caps device pixel ratio at 1; balanced at 2. Heavy scene imports are display-only.
