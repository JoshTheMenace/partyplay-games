# Kitchen Rush

A cooperative 3D kitchen campaign for 1–10 players. Play solo on one device or use phone controllers with a shared display. Ten stages across four original restaurant settings introduce chopping, stove cooking, split passes, dish scarcity, whole-pizza baking, a drawbridge, conveyors, ventilation gusts, alternating cooker power and a combined finale. Each service lasts 3, 4 or 5 minutes. Everyone shares points and stars.

## Play

Select Kitchen Rush in the shared launcher. Phones join and ready through the normal room flow. Drag the movement pad, then tap Use to take/place an ingredient or plate; hold Use to chop, wash or extinguish. Drop puts an item at your feet. Toss passes ingredients in your last movement direction; plates are carried safely. Tap Dash for a short burst in your movement direction, or your facing direction when standing still; releasing the controls does not cancel the burst. Dash recharges after 1.6 seconds. Keyboard: focus the pad for WASD/arrows, E to use, Q to drop, F to toss, Shift to dash.

Follow the ticket exactly. Chopped lettuce + chopped tomato makes salad. Chopped tomato and onion each need stove cooking for soup. Burgers need cooked patty, chopped lettuce and a bun. Pizza is assembled as raw dough + chopped tomato + cheese on a plate, then the whole plate goes into an oven. Green means cooked; collect before burning. All recipes need a clean plate. Served plates return dirty after five seconds; take one to the sink and hold Use to wash it. The food bin clears mistakes while preserving plates. Empty-handed Use extinguishes fire.

All ten stages are playable from the start, in any order. Best scores and stars save in the display browser under `party.kitchen-rush.campaign.v1`; they are local to that browser, not an account or server save. Play again returns to the lobby, where Settings opens the campaign map. Practice removes expiry, burning and disruptive hazards without adding campaign stars. Corrupted or unavailable storage does not stop play.

Stations use visible props instead of floating name labels: produce-filled wooden crates, a butcher block and cleaver, a dark cooktop, a brick pizza oven, a deep sink and faucet, clean plate racks, blue dirty-dish tubs, a pedal bin and a striped serving pass with a bell. Your phone still names the nearby station and action. When 80 items fill the floor, crates pause new ingredients until someone picks up or bins dropped food; existing held food and plates remain safe during disconnects.

## Stage tour

| Stage | New challenge |
| --- | --- |
| Fresh Start | Salads, chopping, clean plates and serving |
| Soup’s On | Independent cooking, doneness and fire recovery |
| Lunch Line | Burgers and divided preparation/cooking passes |
| Wash & Dash | Limited plate inventory and dish turnaround |
| Pizza Post | Whole-plate oven baking |
| Clockwork Crossing | Timed central drawbridge; permanent alternate crossings |
| Conveyor Club | Three automatically advancing pass belts |
| Rooftop Gusts | Announced wind slows the central lane |
| Power Lunch | Alternating cooker power; paused heat is retained |
| Grand Opening | Full menu, belts, power and gusts together |

## Code and validation

`model.ts` defines shared vocabulary, public geometry, stage catalogue and exact recipes. `server.ts` owns movement, item ownership, work, heat, tickets, scoring and deadlines. `client.tsx` renders the controller, order HUD, campaign and results; acknowledged command queues preserve short taps through input coalescing. `scene.tsx` lazily mounts only on displays, reuses GPU geometry/materials, animates public snapshots and cleans up through ResourceScope. `campaign.ts` validates local best-score storage; `preferences.ts` reads graphics settings safely when browser storage is blocked.

```sh
node --import tsx --test packages/games/kitchen-rush/tests/*.test.ts
npm run typecheck
npx oxlint packages/games/kitchen-rush
```

The manager owns immutable integration builds. See [current status](../../../output/kitchen-rush/STATUS.md) and [QA evidence](../../../output/kitchen-rush/QA.md) for exact included versions and tested behavior. Build02 proved real two-player salad and soup service, both dishwashing loops, results and replay. Build03 also proved the first two campaign stages through real three-star results, dishwashing, host reload and sequential unlocks. Build04 proved stages 3–5 through actual burgers, scarce-plate washing and whole-plate oven pizzas, with 15 earned stars retained after reload. The ten-stage map fits at 1280×720. Build05 includes deadline/storage hardening and passed the manager's 249 tests, typecheck and lint. Build05 also proved stages 6–8 through bridge closures/end routes, conveyor plate transfers and measured gust slowdown, with 18 saved stars. Stage 9 and a finale replay also earned stars, completing all ten stages with 20 retained stars. Focused quick-input, reconnect, contention, toss/dash, fire-recovery and longest-label checks passed. Build06 reproduced the late washing-step error as a helper placement assumption and recovered the same plate; no washing-rule change was needed. It also completed a ten-controller finale and separate low/balanced, reduced-motion and scene-resource checks. The full-service aggregate telemetry export failed after results; recovered results and repeated short-cycle metrics are reported separately. Build07 verified the ticket/score repair, four phone sizes and complete ten-name results buttons through a real three-minute service. Build08 verified the final footer-spacing repair with ten full names, actual held-food icons and a hazard banner at the supported display sizes; rule tests alone do not prove game feel or visual quality. Physical phones, touch/Wi-Fi contention, TV viewing distance and human group pacing remain separate checks. No music assets, git publication or deployment are included.

### Gameplay polish

Opening orders introduce the enabled menu in order; later orders vary by round seed and avoid a third simultaneous copy when another dish is available. Fresh Start remains salad-only and replaces unused cookers with extra prep boards. The display shows streak bonuses, progress to the next star and service celebrations; results compare the host's score with its previous best.

Phones show the first ticket's recipe and patience, with Use beneath Dash. Cooker feedback distinguishes cooking, ready, near-burning, burnt and power-paused food, using the same timing for phone and scene indicators. Campaign saves and the ten-stage order are unchanged. Scene diagnostics require `?metrics`.

## Authored Blender models

The current source uses an original52-asset Blender kit for chefs, workstations, ingredients and finished dishes. [Asset source and rebuilding](art/README.md) documents the editable `.blend`, exported GLB, budgets and rigid animation pivots. `src/models.ts` owns abortable model loading and shared-resource cleanup; `src/scene.tsx` instances equipment and drives chef walk/carry/work poses from public gameplay state. No gameplay rules changed. The September11 art pass passed43 Kitchen tests, TypeScript, scoped lint, an isolated build and a real ten-controller service with five delivered dishes, plus replay/reload/reduced-motion/loading-failure recovery. Exact local evidence and limits: `output/kitchen-rush/blender/QA.md` in the platform checkout. The existing user runtime was preserved.

## Sound effects

Recorded chopping, cooking, ignition, fire, washing, dish handling, ready/warning bells, delivery and service start/end cues now play on the shared display or solo host. Use the platform's **Sound on/off** button. Phone controllers do not play the room's sound effects. No music is included; the soundtrack can be added separately.

The [audio guide](audio/README.md) explains triggers, source licenses, volume limits and rebuilding. The in-game instructions link to `/games/kitchen-rush/audio/index.html` for individual clip previews and credits. Current focused QA is recorded in `output/kitchen-rush/audio/QA.md` in the consumer workspace.
