# Island Settlers verification

12 September 2026. The expansion families are playable, with human balance, teaching clarity and physical-device testing still required before a production release. See [EXPANSIONS.md](EXPANSIONS.md) for the supported combinations, generated-map adaptations and excluded campaigns/variants.

## Current expansion candidate

`settlers-expansions-20260912-e`, index SHA-256 `8095b95b6211177ad4e018c27cebfdb7b75e96e523a0bef1d5b0f479f12d8545`.

Fable authored the host/phone UI and animations, then repaired the maximum-roster layout and Council landmark label from screenshots. Codex implemented rules, integration and verification. Objects remain procedural geometry; no Blender assets were needed. The final source includes the compact 36-hex expedition discovery ring, per-seat city-improvement strips, paged status panels and the shared private command UI. E also repairs the pinned phone footer so its hint has an opaque background and every action can scroll above it.

- Full-project TypeScript and scoped game lint passed on the final source.
- Full repository suite on expansion build B source: **871 passed, 1 skipped, 0 failed**. The first sandboxed attempt stalled in network tests; it was stopped and rerun with local networking enabled. No networking code was changed for that test-environment issue.
- Final game and registry checks: **111 passed**, including 89 Island Settlers tests and 22 registry projection checks. Covers complete seeded ten-player matches with Base, Seafarers and Explorers & Pirates in both Standard and Connect, finite inventories, privacy, cargo, missions, progress choices, coastal displacement, compatibility and deadline continuation.
- No Prettier, commits, pushes, PRs, deployment or global browser cleanup.
- The requested code-golf skill was not installed. A manual simplification pass removed unused expansion scaffolding/imports and shared the browser driver between base and expansion tests.

## Real UI acceptance

All joins, settings, readiness, placements, choices and replay actions below went through the UI. WebSockets were observed for snapshots and acknowledgements, never used to inject actions or hidden state. Ten-player runs used separate headless phone contexts, emulated touch and 16-character names.

| Run | Result |
| --- | --- |
| A: Standard, ten players, Seafarers + Cities & Knights + all five Traders & Barbarians scenarios | Room `UQHPXU`: **1,239 accepted UI actions**, no rejected game actions or game errors, a real 10-point winner, ten ranked results, host reload retained results, replay reset the board and expansion state. Includes caravan decisions, commodity trades, improvements, progress plays, knights and wagon movement/upgrades. |
| B: Standard, ten players, Explorers & Pirates + Cities & Knights + fishing | Room `36Z67N`: **1,433 accepted UI actions**, no game errors, real 10-point results and clean replay. Includes 219 ship moves, 9 settler landings, 9 harbor upgrades, cargo purchases/transfers, crew landing, fish loading and a Council delivery. Peak observed snapshot 210,521 bytes. |
| C: Connect, ten players, final compact expedition map + Cities & Knights + fishing | Room `5Z4X3F`: **120 accepted UI actions** across three rounds, including discoveries, landings and movement while other phones were still building. Phone disconnect paused play; returning retained the same seat/hand and restored elapsed clock time. Host reload retained the round. Full Connect completion is covered by simulation, not a complete Connect browser match. |
| D: Council-label repair, three-player Standard expedition smoke | Room `W3CSQU`: **40 accepted UI actions** through real joins, setup and four turns, including movement, three landings, a city improvement and knight actions. Corrected Council label verified; no game errors. |
| E: Final compiled candidate, three-player expedition smoke and phone-footer check | Room `3D5YNX`: **40 accepted UI actions**, no errors. At 320×568 and 390×844 the complete footer is opaque, its hint stays inside the panel, and the last action scrolls fully above it. Screenshots inspected. |

The UI driver required repairs for changed button labels, duplicate progress-card labels and the two different ship-purchase buttons. Those selector failures sent no rejected game actions and were resumed in the existing rooms. Browser repair history is distinct from game-rule failures.

Builds A/B establish full gameplay and replay. C retests the subsequent map and layout refinements. D changes only the Council label relative to C’s game rules; E changes only action-bar CSS relative to D. Both have compiled smoke checks, and E has focused phone reachability checks.

## Rendering evidence

- Real host screenshots inspected at **1280×720 and 1920×1080**; phone screenshots at **320×568 and 390×844**. Phones use the lightweight SVG map with no Three canvas and no horizontal document overflow.
- A labeled, hydrated maximum-content HUD fixture checks ten seats with city tracks, awards, defenders, coins, fish, prisoners and wagon status. It is separate from real-room acceptance. At 1280px all ten seat cards measured 111px client/scroll width; at 1920px all measured 143px. No protruding improvement strips.
- The status list automatically pages at both host sizes, pauses while focused, and displays the last partial page correctly. The ticker retains 143.5px height at 720p and 295.4px at 1080p in that fixture. Maximum content takes several pages by design.
- Initial observed defects were clipped city tracks/sidebar panels, an oversized expedition map span, and a Council vertex/player-ID label mix-up. Current evidence covers their repairs.

Current ignored artifacts in the parent repository:

- `output/playwright/island-settlers/exp-current.json`, `exp-results-1280.png`: A results/replay.
- `exp-b-ep-current.json`, `exp-b-ep-results-1280.png`: B results/replay and action counts.
- `exp-c-connect-final.txt`, `exp-c-recovery-result.txt`, `exp-c-ep-host-board-1280.png`, `exp-c-ep-host-board-1920.png`: compact map, Connect overlap and recovery.
- `exp-c-fixture-result.txt`, `exp-c-fixture-1280.png`, `exp-c-fixture-1920.png`: maximum-content layout and paging.
- `exp-d-smoke-result.txt`, `exp-d-inspect.txt`, `exp-d-final-host.png`, `exp-d-final-phone.png`: Council-label repair.
- `exp-e-smoke-result.txt`, `exp-e-footer-result.txt`, `exp-e-footer-320.png`, `exp-e-footer-390.png`: final candidate and footer reachability.
- `output/island-settlers/expansion-final-tests.txt`, `expansion-full-suite-network.txt`, `expansion-d-types.txt`, `expansion-d-lint.txt`: checks.

Reproduce through `tests/browser-expansions.js` and `tests/prepare-browser.mjs expansions`; the base driver reuses that implementation. Configure only the QA driver’s options, then let it select those settings through the UI. Use isolated builds/owned rooms and bounded batches. It is a test player, not a shipped AI opponent.

## Remaining release gates

Human playtests must establish teaching clarity, negotiation feel, large-roster balance, combined-expansion pacing and couch-distance readability. Physical iOS/Android phones, older laptops and real Wi-Fi disruptions remain untested. Do not equate emulation or automated game completion with those checks. Approximately one hour remains a goal, especially uncertain with many expansions.

This implementation provides the major mechanics and supported combinations on generated maps. It does not include every published scenario/campaign, Event Cards, CATAN for Two, music, production AI opponents, or durable save/resume across server restarts. The official combination guidance is supplemented by documented PartyPlay map and 7–10-player adaptations. The compatibility matrix was not exhaustively human-playtested.

Owned QA sessions A–E and servers on ports 4347–4351 were closed after verification; other user sessions/servers were preserved.

---

The following is retained history from the earlier Base/Seafarers batch, not the current candidate’s status.

# Earlier Base/Seafarers verification

2026-09-12. **Playable first version, still in progress.** Standard and Connect-style, base island and the Open Seas Seafarers scenario support 3–10 human players. Human pacing, balance and physical-device testing remain release gates.

## Current source and build status

Claude Fable finished the frontend and successive repairs; Codex implemented rules, integration and verification. The last frontend change fixes the final partial offer-page label and pauses automatic scrolling during mouse/keyboard reading. That exact source passed a hydrated browser component check, scoped TypeScript and lint.

The final successful collection build is `settlers-20260912-e`, index SHA-256 `35f892404a653031962ef80233a2a102d49f2d29bd24c0672ac83b6c0cbac913`. It includes the final offer-paging repair. Full-project TypeScript and lint passed. A three-player base-mode smoke test checked that final bundle; complete-match and maximum-roster evidence from earlier builds remains applicable to the unchanged rules and phone flows, with focused checks for the later visual repairs.

An intermediate build (`settlers-20260912-d`) was blocked while concurrent Sky Clash work referenced a client file that did not yet exist. Once that separate file appeared, the final build and static checks passed. No Sky Clash files or registrations were reverted. During those edits the older QA server also logged `Catalog unavailable: Unknown room game: sky-clash`; existing rooms continued working, but catalog refreshes returned 503. This resolved build interruption is kept here to explain the intermediate logs.

## Automated checks

- Full project suite passed before the concurrent incomplete Sky Clash registration: **775 passed, 1 skipped, 0 failed** (776 total).
- Final Island Settlers rules run: **51 passed**, including all roster sizes 3–10 with both expansions and both turn styles, transport serialization, atomic rejection, privacy, scoring, trades, robber/discards, gold/bank shortages, pre-roll cards, ships, pause/reconnect and fresh state.
- Seeded ten-player simulations complete in Standard and Connect-style using public/private phone projections only, with resource conservation checked after every action. These are simulations, not human-duration evidence.
- Shared WebSocket tests verify more than 256 actions, retained deduplication acknowledgements, payload limits and bounded registration configuration.
- Final full and scoped TypeScript and lint passed. Diff whitespace checks passed. No Prettier was run.

## Real multiplayer browser acceptance

All acceptance actions used the UI. The driver observed WebSocket snapshots and acknowledgements to choose legal moves; it did not inject hidden state or send game actions directly. The maximum roster used ten separate headless phone contexts and 16-character player names.

| Check | Evidence |
| --- | --- |
| Standard + Seafarers, ten players | Room `MBNRDH`, build A: joined, readied, placed both starting settlements/routes, played to a real 10-point winner at turn 133. **881 accepted acknowledgements, zero rejected moves**, including focused barter checks. All 50 development cards were bought during play. |
| Results and replay | Ten ranked results, results survive host reload, Play again readies all ten seats and starts with zero roads/buildings/offers. |
| Negotiation | Off-turn proposal, active-player acceptance and proposer confirmation transfer exactly the chosen cards. Ten simultaneous offers posted through phones. |
| Recovery | Phone reload retains its seat and exact hand; host reload retains the round and board. |
| Base + Standard, three players | Build E: real joins, readiness, snake setup and active turns in the final compiled client. |
| Connect + Seafarers, ten players | Builds B and C: complete snake setup, 20 ready submissions across two active rounds, shared automatic production, ship placement and a confirmed old-ship move. Connect trades and phone/host reloads passed. A full Connect browser match was not repeated; its full completion is covered by the rules simulation. |
| Game switching | Build C: Island Settlers → Quip Clash → Island Settlers preserves all ten seats, removes the old scene and starts a clean board. |
| Phone interaction | Real emulated touch cancellation does not select a ship; a normal tap selects it and confirmation moves it. Measured target width 43.93 CSS px (44px rounding). |
| Phone rendering | 320×568 and 390×844: no horizontal document overflow; zero Three canvases on phones. |
| Host rendering | 1280×720 and 1920×1080, ten seats. Upright number tokens, visible islands and wrapped HUD text inspected in screenshots. |
| Ten-offer containment | Final integrated layout: scrollable list bottom 539.61px, player rail begins 557.39px. Offers remain inside their panel. |
| Final paging repair | Hydrated component fixture from the final source: automatically advances, identifies the last partial page correctly, holds position while focused, resumes after blur, and remains above the player rail. No component runtime errors. |

Build A reported no browser/runtime or game-protocol errors. Later game checks likewise had no game runtime or rejected-action errors; the unrelated catalog HTTP errors above are not counted as a clean browser console.

## Dense layout fixtures

Separate synthetic rendered fixtures tested ten offers with nine acceptors, five resource types split across maximum-size trade requests, a 240-resource hand, 40 non-victory development cards, and a 120-card discard. Host fixtures fit 1280px, phone fixtures fit 320px, and offer lists remain above the player rail. These verify rendering, not normal match balance or acceptance of fabricated room actions. They never connect to or change a game room.

A headless host sample recorded 4,474 rendered frames, p95 frame interval 16.7ms, zero sampled slow frames, 535 draw calls, 29,974 triangles, 12 geometries and 35 textures at pixel ratio 1. This is a development-machine observation, not a performance guarantee for TVs or older laptops.

## Evidence and reproduction

Parent-repository evidence is under `output/playwright/island-settlers/` (ignored local artifacts):

- `acceptance-a.txt`, `flow-14-results.txt`, `results-1280.png`: complete match and replay.
- `c-flow.txt`, `c-trade.txt`, `switch-games.txt`: final integrated multiplayer checks.
- `c-host-board-1280.png`, `c-host-board-1920.png`, `c-host-offers-1280.png`: inspected host renders.
- `touch-metrics.txt`, `b-phone-actions-320.png`, `b-phone-actions-390.png`: touch, layout and rendering measurements.
- `fixtures-final.txt`, `fixture-*.png`: dense layout evidence.
- `live-paging.txt`, `final-offer-paging.png`: final-source interactive component verification.
- `e-base.txt`, `acceptance-e.txt`: final collection build smoke test.

The game-owned `tests/browser-flow.js` records the repeatable Standard UI driver. From the parent, run `node packages/games/island-settlers/tests/prepare-browser.mjs` to prepare `output/playwright/island-settlers/flow.js`. Open a uniquely named Playwright CLI session on an isolated server's Island Settlers details page, add the game to that browser's library, then run the file in bounded batches until it reports `complete` and `replayed`. It creates synthetic phones and must only be used in an owned QA room. The additional focused scripts remain with the local evidence.

QA browser sessions: `settlers-0912`, `settlers-0912-b`, `settlers-0912-c`, `settlers-final-fixture`, `settlers-final-build`. Owned server port: 4387. All owned QA rooms, browser sessions and servers were closed after checks; the user's other servers were preserved.

## Remaining release work

- Human playtests at small and large rosters: teaching clarity, negotiation feel, turn waiting, starting-position balance, island incentives and the approximate one-hour target. Ten-player Standard may run substantially longer.
- Physical iOS/Android devices, older phones/laptops, real Wi-Fi interruptions and couch-distance TV readability. Browser emulation is not physical-device evidence.
- More Seafarers scenarios and the other expansions. Open Seas is one generated scenario, not the published scenario campaign. Connect-style and seven-to-ten-player Standard are documented adaptations.
- Durable host save/resume remains deferred. Reload recovery works while the existing room survives; server restarts lose the room. Disconnected seats pause play until they return.
- Promote a build through the normal project workflow after human acceptance. No commits, pushes, PRs or deployment were performed.

## Repair history

The first TV render had small, sideways number tokens and HUD overlap. Fable replaced the cap textures with upright labels, measured the available HUD space and enlarged pieces. Real ten-offer testing exposed vertical overflow; Fable bounded and paginated that column. The harbour legend then exposed intrinsic-width overflow in the right grid, which Fable repaired. Final partial-page numbering and automatic-scroll interruption were checked in the independent live component fixture.

Early browser-runner attempts needed corrected selectors for the actual results component and a wait for game revisions rather than the platform's ticking revision. A later paging attempt crossed a Connect deadline, which correctly cleared offers; another checked keyboard scrolling before its animation settled. These runner failures are not counted as accepted gameplay checks.
