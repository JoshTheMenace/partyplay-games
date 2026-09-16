# Routes and garage validation

2026-09-12. This pass changes the four existing courses and adds pre-race character/kart selection. Cups, time trials, battle arenas and an editor are outside this change. Validation was completed before publication; the user subsequently authorized committing and pushing these changes.

## Implementation

Each course has a physical alternate road with a distinct driving interaction: Seabreeze’s tidal causeway, Canyon’s windy ridge, Starlight’s conveyor and dispatch gate, and Rainbow’s elevated current. Routes share canonical lap progress, preserve mandatory gates, and do not collect main-road items while separated from that road. Camera floor sampling and grounded item placement follow the selected road.

The garage offers ten cosmetic characters and three vehicle choices. Roadster is neutral; Arrow has +5% top speed, −8% acceleration and −5% handling; Rover has −4% top speed, +7% acceleration and +7% handling. The authoritative server owns choices and a 45-second selection deadline. All connected racers ready starts the countdown early. Editing clears readiness. Reload retains accepted choices for the current race.

The Blender library includes all ten animated characters, interchangeable Arrow/Rover bodies and 13 selection thumbnails. Its 8,428,508-byte GLB contains 331,464 triangles across the complete library. Asset reimport and all 30 character/vehicle animation combinations pass.

## Checks completed

- Isolated integration suite: 782/782 tests passed on build 1. It includes route entry/traversal for all four courses at 50cc and 200cc with all three karts, closed-gate center/shoulder sweeps, main-road laps, recovery, checkpoint-skip rejection, grounded traps and all existing ramp checks.
- TypeScript and scoped oxlint passed. Prettier was not run. The requested code-golf skill was unavailable in the installed skill directories; a manual simplicity review retained shared road sampling, data-driven course definitions and one authoritative garage state.
- Real UI: a watch-only host and ten emulated landscape phones joined room M6YPH6, chose all three karts, readied, raced one lap on Seabreeze and reached results. All ten finished in 59.7–68.1 seconds. The synthetic drivers sent normal keyboard controls; no hidden race state was injected.
- Replay returned to the garage. A character change, kart change, ready-then-edit and reload retained the expected racer identity and accepted choice. The second garage advanced on timeout without readying everyone.
- Six viewport checks: 667×375, 844×390, 932×430, 1024×768, 1280×720 and 1920×1080. No horizontal overflow; ten character choices reachable and the Ready footer stayed inside the viewport. Short landscape layout was subsequently refined to put kart choices and stats first; final screenshots recorded below.
- Production renderer fixtures sampled three positions on every alternate route. Terrain and buildings cleared the new roads. Fixtures use controlled state and are visual evidence, separate from the real network acceptance flow.
- All eleven network pages reported no browser errors. The recorded host/nine retained phone samples had median frame intervals of 16.7ms and p95 16.8ms; one phone’s frame history was intentionally cleared by reload. Average snapshots were about 8.7KB. These are emulation measurements on one Mac, not physical phone or Wi-Fi evidence.

## Build and evidence

Root owned the browser and both servers. Build 1 used the isolated checkout `/private/tmp/kart-party-publish-20260912`, run `kart-routes-garage-1`, port 4410 and index SHA-256 `8873cc458901738d743fe813653555652c47fd149faafa4fbe09ff6677fdbdd2`. The controlled renderer fixture used port 4411. All build-1 browsers and servers were closed before the repair build.

Evidence is in the consuming workspace’s ignored `output/playwright/kart-routes-garage/`: integration-tests.txt, garage-result.txt, replay-result.txt, timeout-result.txt, metrics.txt, results-tv.png and per-course/per-viewport screenshots. Blender evidence lives in `output/playwright/kart-garage-art/`; physics review evidence lives in `output/playwright/kart-route-rules/`.

## Repairs found during QA

The initial fork integration made CPUs steer toward a branch while airborne after a preceding ramp; route targeting now waits for landing. Simulation review also caught an outer-shoulder gate bypass and grounded traps using the main road height. These regressions have focused passing coverage.

Browser captures found original guardrails crossing branch exits, plus a short landscape garage that hid kart selection below a scroll. Both were repaired in the final isolated builds. Those repairs passed focused visual checks in the final build. The compact garage also anchors to its actual scene container, preventing clipping on a playing host’s short screen.

Physical-device input latency, mobile thermals and long-session balance remain unmeasured. Route tradeoffs and vehicle multipliers are intentionally modest and can be tuned after human playtesting.

## Final state

Saved source → built → browser verified. The final build is `kart-routes-garage-release`, index SHA-256 `2ec8ed15694ce3b54cc3a7dcc08299681ff5e97146cee98b788f3cebceb1e169`. Final Kart tests: 472/472 passed. The earlier complete integration run passed 782/782; subsequent edits were confined to course barrier geometry and garage presentation and received focused regression tests and browser checks.

Final UI checks in real room SVL4CR confirmed all three karts and all three stats visible at every listed viewport, no horizontal overflow, the full panel inside the scene, functional Kart/Character switching, and Jade + Rover entering a race. The smallest landscape character list can scroll while retaining 44px controls. Screenshots were inspected after the choices were acknowledged. Final evidence: `release-garage-result.txt`, `final-garage-*.png`, `final-characters-*.png`, `courses-final-result.txt` and `final-{course}-*.png`. The corrected entrance fixture uses ramp height for static placement; it does not change racing physics.

The final merge captures show clear main-road barrier openings on all four courses. Entrance arrows/status signs, the lowered dry/wet causeway and the closed dispatch gate were inspected from production chase cameras. All owned browsers and isolated servers were closed after verification; the user’s existing runtime was preserved. Validation itself made no staging, commit, push or PR changes.

## Mobile garage follow-up — 2026-09-13

A physical-phone report exposed a case the earlier viewport matrix missed. At 568×240, representing a landscape phone with browser chrome, the previous scene-constrained panel left only 6.47px for its contents and collapsed the kart fieldset to zero height. The earlier 667×375 minimum did not cover this failure.

The mobile garage now occupies the viewport within safe areas. Header and Ready remain outside one scrolling contents area; choices and stats use natural height instead of nested, constrained scrollers. Kart/Character tabs keep choices compact, selection labels use 16px text, and touch controls retain a 44px minimum. Only `src/garage.css` changes production behavior.

The controlled production-component fixture passed every kart, all ten characters and Ready at 568×240, 667×280, 844×300, 667×375, 844×390, 320×568, 390×844, 1280×720 and 1920×1080. Portrait checks cover the component layout only: the actual phone runtime still requires landscape for this game. At the shortest height, contents scroll to expose the remaining choices and stats. A separate emulated touch check used 44px side safe areas and a 21px bottom safe area, swiped the list, selected Jade and readied successfully. Reconnecting disabled Ready as expected. Screenshots were visually inspected.

Seven focused garage tests passed and the isolated production build succeeded. The requested code-golf skill was unavailable; manual review retained a CSS-only fix with fewer lines than the old responsive rules. No Prettier was run. Evidence is in the consuming workspace’s ignored `output/playwright/kart-garage-mobile/`, including `before.txt`, `layouts-final.txt`, `touch.txt`, `tests.txt`, `build-final.txt` and viewport screenshots. Build: `kart-garage-mobile-final-20260913`, index SHA-256 `268dc8ab83760531ed8d0abc6aec30cd65ac55153c2684fda280484170a6a7da`.

Real room Z34WT7 used a watching host and an emulated touch phone. At 568×240, tapping Arrow, Rover and Jade produced authoritative server acknowledgements; the panel occupied (8,8)–(560,232), its contents had 111px of scrolling space, and there was no horizontal overflow. After resizing to 844×390, Ready started racing with Jade and Rover retained. Neither page reported browser errors. See `live-check.txt`, `live-initial.png`, `live-jade.png` and `live-wide.png`. The previous complete ten-player race/results/replay evidence remains applicable to this CSS-only follow-up. The named browser and both isolated servers were closed after verification.

These are browser-emulation checks, not physical-device evidence. The reporting phone/browser is not yet known. Validation preceded the user's authorization to commit and push this Kart Party follow-up.
