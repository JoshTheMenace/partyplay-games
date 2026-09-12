# Driving polish — 2026-09-12

This pass implements the requested driving, camera, contact-feedback and course-readability stage. Cups, arenas, ghosts, vehicle customization, route branches and an editor remain future work. The existing Blender rigs and course interactions are retained.

## Changes and reasons

- `engine/input.ts` exports `worldSteer`; both the shared-room controller and original standalone controls use it. A camera looking along +Z has screen-right along -X. The shared controller previously sent the opposite yaw for keyboard and touch. Conversion happens when sending a complete held state, so adding drift or brake cannot reverse steering a second time.
- `engine/driving.ts` lets speed above the current maximum decay at 12 units/s times the engine-class multiplier, or 30 units/s off-road. Previously boost expiry and slower surfaces clipped speed in one tick. Brakes still subtract acceleration immediately; frost and stun retain their immediate caps. No extra input smoothing or control delay was added.
- `engine/chase-camera.ts` smooths heading with an exponential 10/s response and boost FOV with 5/s response. Each viewport has independent state. Subject changes, respawns and loop transitions cut to the correct view instead of flying from the old subject. Existing terrain clearance and inverted loop camera geometry remain. Reduced motion disables boost zoom and the new contact recoil.
- `engine/contact-feedback.ts` records a separate `bump` event and the last impact's time/strength. Kart, loop and obstacle contacts share this feedback. Closing speed below 4 units/s is ignored; each kart has a 250 ms feedback cooldown. The existing 24-event queue stays bounded. Contact produces gold sparks, a brief body recoil and a short 110 Hz tone for the followed racer. Contact feedback itself never applies stun, consumes shields or awards progress.
- `engine/course-markings.ts` derives turn directions from real route geometry. Three raised chevrons mark each selected bend's outside edge. The loop is excluded from planar bend signage. Launch lanes are cyan, matching the course guide. Static lane paint and signs are merged by material to avoid a draw call for every stripe or arrow.

The requested code-golf skill was not available in the installed skill directories. A manual simplification review reused one steering conversion, one contact-feedback helper and one static geometry batching pass. No formatter was run.

## Frozen build and automated checks

The shared checkout contains unrelated work. Browser QA used the existing isolated checkout `/private/tmp/kart-party-publish-20260912`, based on platform `2fc45560b983e718c3e87ea282610758ea1b17c6` and games `654fd7dafc80d21401b75ace35ca159700ad8914`, with only this pass's Kart files copied in.

- Final build: `kart-driving-release`, normal production configuration, `qa: false`.
- Client index SHA-256: `99daa747d18527dadfa13304deaf716489ff32f588b0419f039035e1e233a264`.
- `npm run test:kart`: **379 passed**. Includes all four courses at all four engine classes, ramp landings, loop inversion, collision rules, frame-rate-independent camera response, boost expiry, contact cooldown, obstacle feedback, sound deduplication and replay.
- `npm test` in the isolated checkout: **693 passed**, including ten-player Kart adapter completion/replay on every course.
- `npm run typecheck` in the shared checkout: passed.
- Kart source/test Oxlint: passed.
- Isolated production build: passed. Existing bundle-size advice remains.

The first sandboxed socket suite stalled without localhost permission and was stopped; the final suite ran with localhost access. An intermediate frost test caught unintended gradual item slowdown; frost/stun caps were restored before final checks.

Logs and screenshots are in the consumer checkout's `output/playwright/kart-driving/`. No test fixture or browser hook was added to the production build.

## Browser evidence

The real-room run used frozen build `kart-driving-steering` (index SHA-256 `37db6a8baaafae90a1e7cffa462296a9189e05d0905d6af444090af0356238f1`). A final renderer-only adjustment moved bump particles from inside the body to a 2-unit ring at wheel height and shortened their lifetime to 450 ms. This was inspected in `impact-visible.png` using a freshly bundled production-renderer fixture; typecheck, lint and the final release build passed afterward. The real-room flow was not repeated for that particle-only change.

Headless Chrome 152 on macOS, synthetic players over localhost. A single owned browser session was used, with ten emulated landscape phones and one host. No physical phone or Wi-Fi performance claim is made.

- Room DYPMWV, Seabreeze, one lap, 200cc, Auto views: ten personal phone views and one watching TV. Required views became available in **2.973 s**.
- Right-arrow input sent world steer `-1`. A real emulated touch on the pad's right side plus a second touch on Drift sent negative steer with drift held, and authoritative heading moved in the correct direction. Touch cancel cleared both steering and drift.
- Drivers were guided by the engine's bot steering decisions translated into normal keyboard events every 50 ms. No state/position writes or direct socket-input injection were used in this room.
- At race time 34.35 s, the host had observed **78 distinct bump events**, with no browser/runtime errors.
- At 35 s, all eleven windows measured median/p95 animation-frame intervals of approximately **33.3/33.4 ms** under this combined emulated workload. Snapshot cadence was approximately **20 Hz**, maximum observed snapshot **11,212 bytes**; phone input cadence was approximately **20 Hz**. These are browser animation-frame intervals, not GPU timing or physical-device input-latency measurements.
- Eight automated drivers finished in **37.30–42.10 s**; two reached the normal DNF timeout. All ten received results. This demonstrates the full flow, not a guarantee that this coarse keyboard bot can recover from every collision or missed gate.
- Play again with the explicit TV override rendered ten labels/views. All ten reloaded phones had **zero canvases and no garage GLB request**, with no runtime errors.
- Production-renderer fixtures inspected all four courses' bend signage, four-way and ten-way splits at 1280×720, and an 844×390 personal phone view with reduced motion. Cyan launch markings and raised chevrons were visibly readable in the four-way and phone views. The ten-way override remains visually dense, as expected; Auto avoids it.
- `impact-visible.png` is a controlled two-kart contact fixture using production simulation and rendering. Course fixtures are presentation checks, separate from the real-room flow above.

Existing complete-flow, portrait/orientation, reconnect and view-policy evidence remains in `VIEWS-QA.md`. This pass focused new browser checks on the changed behavior; it did not repeat every earlier viewport and failure scenario. Human testing is still needed for steering feel, camera comfort, audio balance, TV viewing distance and phone thermal performance.

## Publication

Validation was completed before publication. The user subsequently authorized committing and pushing this driving pass together with the routes and garage changes. The platform repository has no new source changes from this pass; all implementation and documentation belong in the games repository.
