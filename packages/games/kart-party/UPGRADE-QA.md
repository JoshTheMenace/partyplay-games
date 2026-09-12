# Kart model and course upgrade, 2026-09-12

All work is in the games repository. Existing migration and other-game edits were preserved. No staging, commits, pushes, PRs, publishing, or Prettier. The requested code-golf skill was not available in either skills directory or the plugin cache; a manual simplification pass retained the existing animation/effects code, shared obstacle definitions and race clock, and removed a stale comment.

## Source and assets

- Original models authored with Blender 5.2.1 LTS; source, generator and inspected preview in `art/`.
- GLB was reimported in Blender and independently loaded with Three's GLTFLoader. All ten rigs fit gameplay scale and retain head, arm, steering-wheel and axle pivots. The asset test checks wheel-centre stability, eased steering, head movement, jump poses and finish poses on every exported rig.
- `public/models/manifest.json` records the actual 7,132,972-byte library and 289,200 total triangles. No outside artwork was used.
- Final immutable integration build: `kart-models-release`, index SHA256 `3fccf0c4ddcc632c53de4c34d86142cd1163db83dc3896c6d595b31a3aa225d0`. Normal nine-game build; no Scene Lab fixture enabled.

## Automated checks

- `npm run test:kart`: 361 passed, including 11 new collision/course tests. Existing tests complete all four courses with CPUs, deterministic input, ramps and magnetic-loop behavior.
- Additional shipped-asset/articulation test: 1 passed, testing all ten models. 362 passing tests across those runs.
- TypeScript and focused oxlint: passed. Isolated production build: passed.
- New checks cover rear speed transfer, side impulses, separating/exact contacts, vertical separation, finishers, star/shield rules, obstacle positions and collisions, airborne clearance, dry/wet lanes, express/launch behavior and finite ten-player simulation.

## Browser evidence

Evidence is local under `output/playwright/kart-upgrade/` in the consumer workspace. Browser/server sessions and synthetic rooms are owned by this task. The user's runtime was not restarted.

- Real UI launch, host plus nine UI-joined/ready phones: 10 racers, one canvas, 3,019 ms from Start to playing (including shared preparation/start delay), no protocol errors. Host at 1280×720; phone names were 15 characters, not the 16-character limit. `ten-karts.png`, `ready-grid.txt`.
- Emulated phones at 320×568 and 390×844 show the existing rotation gate; 667×375 and 844×390 expose steering/brake/drift/item controls. No horizontal overflow; measured controls exceeded 44 px. `phone-*.png`, `layouts.txt`.
- Ten-camera desktop sample: 300 requestAnimationFrame intervals, median 16.7 ms and p95 16.8 ms. This measures browser frame cadence in this local Chromium session, not physical-phone GPU/thermal performance or input latency.
- Host drove through normal keyboard handlers and held-input transport, finished Seabreeze in 54.7219 seconds, and reached authoritative results at 134.7 seconds after the other racers' grace period. The nine extra phones checked roster/controls; they did not complete actively steered laps. Replay created one fresh canvas, then the owned room was closed. `results.txt`, `results.png`, `replay.png`.
- All four courses and three lane types were captured separately using a deterministic camera fixture with production models, renderer and simulation. These screenshots and the WebM are visual-fixture evidence, not additional real network race completions. `*-obstacle.png`, `*-lane.png`, `camera-checks.txt`, `video/`.

Early QA retries were harness issues: settings require phones to ready again; getByRole selects the settings controls; synthetic keyboard events must originate on an element; teleported camera fixtures need snapped IDs. The erroneous window-target keyboard events generated console errors, then the corrected driver completed the race. Network error observation stayed empty. These errors are not claimed as product failures or as an error-free initial run.

The refinements after the complete flow add boulder rotation and clearer course guidance. The final loading check rendered one canvas at 1280×720 and 1920×1080, downloaded the complete model library and recorded no page errors (`final-build.txt`). A close camera fixture subsequently exposed an added overhead sign blocking the road; the sign was removed entirely, the release rebuilt, and the cleared approach captured (`clear-camera.txt`). The release differs from that loading check only by removal of the extra sign. Physical touch devices, Wi-Fi contention, TV viewing distance and group enjoyment still need human playtests. Course geometry remains the existing road network; this update adds distinct playable obstacles and lane mechanics rather than alternate routes.
