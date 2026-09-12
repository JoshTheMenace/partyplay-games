# Configurable race views

Implemented and verified in the consumer workspace. Final isolated build: `kart-views-final`. This is local Chromium/emulated-phone evidence, not a physical-phone playtest.

## Behavior

`Race views` defaults to Auto: 1–4 active human racers use TV split views; 5–10 use personal chase views. Explicit TV and Personal settings override that cutoff. CPUs do not count; disconnects cannot change a running round's mode. A playing host sees their own camera in Personal mode. A watching host follows the leading active racer, holding shots for six seconds and leaving finishers/disconnected racers immediately.

TV-mode phone controllers report readiness after two DOM frames and never mount the lazy 3D scene. Personal controllers use the existing first-frame readiness barrier, authoritative snapshots and held inputs. Landscape controls overlay a single camera at performance quality (DPR capped at 1, shadows off). The host remains the sound source.

## Automated checks

- 367 Kart tests pass, including five new screen-policy/settings/director tests.
- 56 shared room, scene lifecycle, registry and unified Kart integration tests pass, including a regression for late readiness after cancelled loading.
- Full typecheck and lint pass.
- Isolated build `kart-views-final`, entry SHA256 `6198e5a8a10529f7afc53cfee5d05f55832a7344de708f2cfe10aea1372667e2`.
- No Prettier, staging, commit, push or publication performed. The requested code-golf skill is unavailable in the installed skill directories; a manual simplification pass kept routing in one pure helper and reused the existing scene/input lifecycle.

Final server SHA256: `24ae2e55c91a8f0f26c2bc434aa194841b24e6bbde6a81c868e63f927641d275`. Client bytes are identical to `kart-views-01`; the final build changes only the server readiness guard. The existing split/personal visual and complete-flow evidence therefore applies to the final client, with failure/retry retested against the final server.

Logs, repeatable CLI scenarios and screenshots: `output/playwright/kart-views/` in the consumer workspace.

## Browser checks

- **10 phones + watching TV, Auto:** all eleven screens became ready in 2.711 seconds. Every phone had one canvas following its own player ID; the TV had one spectator camera. All names were 16 characters. Nine synthetic racers, driven through real keyboard handlers and the normal input transport, finished a one-lap Seabreeze race in 40.48–45.57 seconds. The phone used for reload/rotation checks was interrupted and received DNF; results arrived at race time 73.85 seconds. No hidden clock or race-state mutation was used.
- **Broadcast switching:** the race observation at time 49.15 showed nine finished racers and the TV following the remaining racer. Unit tests cover shot dwell, lead changes, finish/disconnect switching and clock reset.
- **Results → TV override replay with 10:** results removed the canvas; replay rendered ten labelled TV views. Every reloaded phone had zero canvases and no `garage.glb` request. The source lazy-import boundary also keeps the renderer off TV-mode phones.
- **4-player Auto with playing host:** four split views at 1280×720 and 1920×1080, three controls-only phones. Personal override then gave the host and each phone one camera following their own IDs.
- **5-player Auto:** a playing-host retry produced five personal cameras. The final build also passed five phones plus a watching TV, with every phone following its own ID and the TV broadcasting the leading active racer.
- **Touch:** simultaneous steering and drift produced `{steer:1, drift:true}` in the authoritative input stream and changed heading from 0.505 to 0.831 radians in the observation window. Touch cancellation restored `{steer:0, drift:false}` while keeping the game's automatic acceleration.
- **Rotation/reload:** turning upright while holding left/drift sent `input.release` and removed controls. Returning sideways restored neutral steering/drift. Reload retained the same player ID, one personal canvas and neutral first input.
- **Late join:** a fifth human joining the four-player round had zero canvases/controls and a next-round notice. They were included only in the next active roster.
- **Layout:** personal views inspected at 667×375 and 844×390; portrait gates at 320×568 and 390×844. No horizontal overflow. Personal touch targets were 130×130 and approximately 157×67 pixels. Controls-only also fits 568×320, with action targets approximately 156×60. Representative screenshots were inspected, including both TV sizes.
- **Failure/retry:** blocked the model request on one phone through an owned browser route. The room returned to a named, retryable lobby and disposed its scenes. After restoring the request, the final server started five personal phones and one broadcast TV with zero browser/protocol errors and no stale warning.

In the ten-phone run, nine continuously sampled phones plus the TV each recorded roughly 3,130 animation-frame intervals: median 16.7 ms, p95 16.7–16.8 ms. The reloaded phone reset its sample history. All ten phone renderers were active concurrently. Phones rendered at 828×318 pixels for an 844×390 viewport. Snapshots were approximately 20 Hz, up to 10,959 bytes; steady held input was approximately 20 Hz. These are local browser cadence and transport observations, not physical-device GPU throughput or input-to-photon latency.

Rooms `A8R48U`, `XSJG7D`, and `T8YWVP` were closed through UI. Owned browser sessions `kart-views` and `kart-views-final`, phone contexts, and the isolated port 4398 servers were closed. User previews were preserved.

## Repair history

The initial cancelled-load test exposed a sticky host warning when an in-flight `round.ready` arrived after the old round was cleared. The shared server now ignores obsolete readiness and duplicate readiness after preparation. A deterministic test first reproduced the error, then proved old readiness cannot start a replacement round; reliable stale game actions remain rejected. Final browser failure/retry is clean.

Two QA waits were corrected: the failure UI shows the platform's named round-stopped notice rather than the raw fetch error, and a spectator canvas exists during preparation before the first public snapshot. These were harness assumptions; the corrected checks wait for the real room state.

## Device limits

Browser emulation does not establish performance on physical phones, Wi-Fi contention, heat/battery use, touch feel or TV viewing distance. Personal racing still needs a shared PartyPlay host/room; it is not an offline or independently simulated phone game.
