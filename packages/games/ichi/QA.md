# Ichi acceptance · 2026-09-20

Current source is implemented, built, and browser-verified. No commit, push, publication or deployment was performed.

## Current build

- Isolated run: `output/builds/ichi-privacy-qa`, built 2026-09-20 23:22:26 UTC. This rebuild contains the same game implementation as the prior `ichi-release` acceptance run.
- Client index SHA-256: `c4e2960ae04f638456dcba988fe4970e9a3350c71ef0dcbc1c95d26abf9fc842`.
- Owned server: port 4347, exec session 49901. Browser session `ichi-privacy`, PID 57233; synthetic room `BUSNLK`. Twelve separate browser contexts: one host, ten phones, one separately joined TV display.
- No user rooms or browser sessions were used. Owned room, browser contexts and server were closed after acceptance.
- Restart this build with `npm run serve:isolated -- ichi-privacy-qa 4347`.

## Follow-up: phone privacy and connected TV

The requested phone/TV separation passed a fresh real-room browser run. No gameplay or UI source fix was needed; one permanent rules regression test was added.

- Each of ten phones received exactly its own private hand. DOM card labels were compared to that phone's actual WebSocket projection. Physical card IDs were disjoint across all current hands.
- Both the host and a separate browser joining with `?display=BUSNLK` received `privateView: null` in every observed snapshot. Public data contained no hand, deck, alternate faces or mission-progress fields. Explicitly revealed faces remained public as designed.
- The TV showed a face-down draw pile, face-up discard matching the authoritative color/value, current turn, next seat, player names and correct card counts. It never rendered phone hand controls.
- A complete ten-player, nine-card, all-packs game reached the 80-turn results. The room recorded 82 accepted UI actions; after the runner correction below, 79 actions were individually followed by a full twelve-context privacy/display check. This included five hand trades, two flips, reveal, decoy, inspection, jump-in, draw/pass and unlocked missions. Drift and mutation were enabled throughout.
- Every trade was checked against the previous physical card-ID sets: each recipient received the predecessor's hand, with the played card removed. Both flip sides were checked. No cross-phone card duplication or private display data occurred.
- Replay preserved ten seats and dealt 90 distinct cards, nine to each phone. Navigating one phone away disconnected it; the TV showed its disconnected status. Returning restored the same seat and exact hand. Reloading the TV restored its public view with no private hand.
- Phones could draw and pass while the optional TV connection was away. Rejoining the TV showed the current synchronized table; the host room remained connected throughout.
- Real hand layouts passed at 320×568, 390×844, 667×375 and 844×390: no horizontal overflow and no targets smaller than 44px. The TV passed at 1920×1080 and 1280×720; at 1280 the complete game panel ended at 634px.
- Browser page errors: zero. Focused tests: 48 passed, including the new private-hand/public-reveal/foreign-card regression. Typecheck and lint passed. The new test changes no runtime behavior.

Evidence and repeatable Playwright CLI scripts: `output/playwright/ichi-privacy/`. Key reports are `verify-live-report.txt`, `play-report-3.txt`, and `reconnect-report.txt`; screenshots include `phone-1.png`, `phone-2.png`, `tv.png`, `tv-1280.png`, `tv-disconnected-phone.png`, and `results-tv.png`.

Runner corrections: the first click loop chose a disabled duplicate of a drawn card; it now selects the enabled matching button. It also attempted a subsequent move before the acknowledged move's new snapshot arrived. The server correctly rejected that stale action with “This turn has closed.” The runner now waits for the authoritative next snapshot. Neither issue required a game change. An earlier attempt to retain runner globals across CLI calls was replaced with bounded, read-only WebSocket observation inside each synthetic browser.

These are desktop Chromium phone/TV emulations, not physical hardware, casting, touch-latency or Wi-Fi certification. The earlier acceptance history below remains applicable.

## Checks

- `npm run typecheck` and `npm run lint`: pass. No Prettier used.
- Full `npm test`: 1,549 passed, 1 existing skip, 0 failures. Subsequent changes were limited to UI state/layout and passed typecheck, lint and focused browser checks.
- 16 game-owned tests include 512 deterministic complete games: all 256 expansion combinations at both 2 and 10 players. Tests cover validation before mutation, draw restrictions, stale actions, jump-in races, mission locks, flip, reveal, decoy unmasking, transfer-to-empty wins, recycling, the hand cap, disconnected timeouts, ties, and clock reversals.
- Two additional integration tests run the actual `assertSerializable` check on every public/private projection through timeout completion at both roster limits. The shared registry contract passes too.
- The frontend build passes the browser dependency-graph guard; server rules and deck state are not shipped in the client.
- Claude Fable was consulted three times using the ask-claude skill: plan/architecture, concrete rule/UI implementation, then screenshots and final interaction review. Its decoy, clock, discard-animation, density and persistent-control-state findings were addressed. Deadline enforcement and documented full disconnected-seat timers were retained deliberately.

## Real room flows

These used actual browser join forms, Ready buttons, settings, card buttons, inline choices, draw/pass controls and room controls. No hidden-state injection or server shortcuts were used.

- Initial build `ichi-first`, room `A8BKRT`: ten 16-character synthetic names, nine starting cards, all eight packs. A complete game reached an empty-hand win after 69 automated UI actions. Results showed all ten ranks and tied places. Replay retained ten seats and reset readiness. This complete-flow evidence remains relevant; final builds retested the changed controls and projections.
- Build `ichi-verified`, room `Z7NVAM`: two players, Strategy preset, five cards. 43 accepted actions, zero rejected actions and zero page errors; empty-hand win. Reload preserved the hand. Replay dealt five cards and zero-progress mission cards.
- Final build `ichi-release`, room `QYWZAX`: two players, Strategy preset, five cards and 45-second turns. 124 accepted actions, zero rejected actions and zero page errors. Reached the 80-turn cap with authoritative 5-versus-6-card standings. Reload preserved the exact private hand.
- Final replay rejoined neither phone: both retained their seats, received five fresh cards and a locked mission at 0/3 colors.
- Ichi → Quiz Panic → Ichi: loaded and started the other game, then returned to Ichi. Both names and the room code stayed unchanged. Ichi restarted with seven fresh cards and no old round state.

## Layout and interaction fixtures

The fixture renders the real client components with synthetic maximum-content views, separately from the real game evidence above.

- Displays: 1280×720 and 1920×1080; ten 16-character names, 30 cards and 30 exposed faces per player, all eight pack labels and full log. The conservative 300-exposed-card stress case displays every face. At 1280×720 the complete game panel ends at 706px; outer shell padding produces a 722px document. No essential game content is below the viewport, clipped or concealed.
- Phones: 320×568, 390×844, 667×375 and 844×390; 30-card hand, visible-card notes, new/mutated labels and a decoy. All buttons/selects meet the 44px target floor, with no horizontal descendant overflow. Large hands intentionally scroll; the draw/pass action remains reachable.
- Ten-way tied results and all-pack settings: 320×568, no horizontal overflow. Both are scrollable.
- Wild-color draft survived reload with the chosen color. A delayed rejection after the fixture changed the turn stayed visible, proving controls no longer discard asynchronous results on turn changes.
- Offline fixture disabled gameplay and showed the saved-hand reconnect notice. Real-room reload separately verified restored state.
- Reduced-motion emulation returned animation name `none`. Keyboard focus and Enter opened the wild choice; screenshots were inspected alongside layout metrics.

Local evidence: `output/playwright/ichi/first-host-10.png`, `final-host-2.png`, `final-phone.png`, `final-results.png`, `replay-host.png`, `switch-back.png`, `layout-host-1280.png`, `layout-phone-320.png`, `final-inline-choice.png`, plus `release-game-report.txt`, `release-replay-report.txt`, `switch-report.txt`, `layout-final-report.txt` and `focus-report.txt`. Source scripts live alongside these artifacts.

## Limits and repair history

Physical phones, native touch, screen-reader testing, viewing distance, ten-device Wi-Fi performance and human pacing/balance were not tested. Browser checks used desktop Chromium with emulated viewport sizes. Jump-in races have deterministic server tests, but no two-physical-phone latency measurement. Flip/trade animations have render/reduced-motion checks and were exercised in the earlier all-pack game; their feel still needs human playtesting.

The first full suite failed only because catalog counts still expected fourteen games; those assertions were updated and the full suite passed. Dense exposed hands initially made the host page too tall; the final density-specific three-column roster fixed it. A fixture initially read the asynchronous error before its delayed response; the assertion now waits for the rejection and passes. Earlier build artifacts remain historical evidence, not the current build.

The requested code-golf skill was not installed in the available skill roots. A manual simplification pass removed unused CSS, kept the eight packs in one typed settings map, and kept all card effects in one validated turn pipeline.

## Desktop shortcut / main verification — 2026-09-20

The desktop PartyPlay.app launches `/Users/joshthemenace/Documents/ChatGPT/partyplay/scripts/launch-dashboard.mjs` on port 4361. Updated that platform checkout and its games submodule to their current `main` branches, then added Ichi. Typecheck, lint, and 51 focused game/catalog/registry/serialization tests passed. The isolated `ichi-desktop-main-20260920` build produced the same index SHA-256 as the privacy QA build above.

With no established client connections, restarted the old desktop server through the actual shortcut. Its health endpoint now includes Ichi among 15 games. Playwright session `ichi-desktop` verified Discover → Add Ichi to library → Ichi details → Play on this screen opens the Ichi lobby. Inspected the 1280×720 lobby screenshot. Closed the synthetic room LV8GVB and the owned browser; left the desktop server running. Screenshot: `/Users/joshthemenace/.codex/worktrees/fc0a/partyplay/output/playwright/ichi-desktop/lobby.png`. The previous complete-game and phone/TV privacy evidence applies to this unchanged game implementation.
