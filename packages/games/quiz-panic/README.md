# Quiz Panic

A family-friendly quiz-show laboratory for 2–10 players. One shared display, portrait phone controllers, and a watching host who needs no seat. The Bubble Bureau’s machine has gone into overdrive: answer quizzes, repair the machine, and race for the exit. Original questions, host copy, and local SVG/CSS art; no Jackbox assets or dialogue.

## How to play

The room host selects Quiz Panic and starts through the shared platform. The game first explains all scoring and the finale. On your phone, tap one answer to lock it. You cannot replace a locked submission. A visible acknowledgement confirms acceptance; reconnecting restores your seat and accepted answer. Unfinished memory sequences and estimates survive reload in this phone tab; they are not shared with other players or transferred to another device.

1. Eight trivia questions, with 30 seconds each. A correct answer earns 3 charge. There is no speed reward, penalty, or elimination.
2. Every question leads to a rescue challenge. Everyone participates. Players who missed the quiz are the rescue crew: success earns 2 charge. Players who answered correctly are the support crew: success earns 1 charge. An omitted answer counts as a miss. Charge is never deducted.
3. Six rapid escape questions, with 18 seconds each. Every 6 charge gives 1 starting step, capped at 4. A correct answer moves 2 steps. Anyone behind the leading distance when a question opens receives 3 steps for a correct answer instead. Wrong or absent answers add zero. Boost eligibility is fixed before submissions arrive.
4. Most escape steps after the sixth question wins. Equal distance shares the win, even if earlier charge differs. Competition ranks are 1, 1, 3 for two tied leaders. Every participant appears in results, including disconnected players.

A player with zero charge can still win through the finale. Nobody waits through elimination. The room host owns replay and return-to-picker through the shared shell; the game never replaces the socket or lobby.

## Rescue variety and timing

The three families are seeded into a shuffled cycle, so every game includes all three:

- **Memory sequence:** view four labeled symbols for six seconds, then reconstruct their order. Rounds 5–8 use five symbols. Undo is available before locking. The labels make the challenge independent of color or recognizing a particular icon.
- **Closest-number estimate:** estimate a generated tray/jar total, entering an integer from 0–999. The submitted guess with the smallest absolute error succeeds. Equal closest guesses all succeed, across rescue and support crews. No submissions means no success.
- **Simple logic:** choose the one numbered valve satisfying all three stated conditions. The generator guarantees one solution.

Fixed settings: `{ rounds: 8 }`; `{}` selects this default. Each experiment uses 30 seconds quiz, 8 reveal, 6 rescue briefing, 20 rescue, 7 rescue reveal. The introduction is 25 seconds; finale briefing is 15 seconds; each finale reveal is 7 seconds. Using every answer deadline takes **12 minutes 38 seconds**, plus platform preparation. Quiz, rescue, and finale answer phases end early once every participant has submitted, after a six-second minimum. Briefings and reveals keep their full reading time. An exceptionally quick group can finish in **6 minutes 22 seconds**; ordinary pacing depends on answer speed. This deliberately lets quick groups finish below the original 10–15 minute target rather than forcing idle waits. Disconnected non-submitters keep the full deadline so they can reconnect. A late server tick starts the next phase with its full duration rather than skipping unread content, so server stalls can extend play.

## Code walkthrough and decisions

- `src/manifest.ts`: standalone metadata. Advertises shared-display only, portrait controllers, 2–10 players, no solo, and discrete actions.
- `src/types.ts`: public view and action types. Contains no authoritative questions or answers.
- `src/content.server.ts`: 60 original multiple-choice questions across Space, Ocean, Animals, Number lab, Shapes, and Matter. Every entry has four unique choices, one key, a short explanation, and an authoritative reference. NASA, NOAA, Smithsonian’s National Zoo, OpenStax, and the Royal Society of Chemistry support the facts. Arithmetic scenarios are original applications of the cited operations. There are no changing population counts, moon counts, prices, or current officeholders. Questions and options are shuffled on the server; 14 distinct questions are selected per game. No network is required while playing; source links are optional reading after a reveal.
- `src/server.ts`: named/default `rules` implements GameRules 1.0. Injected time controls every deadline, and a stored seeded PRNG controls the deck, options, family order, and generated challenges. `enter` opens a phase, `scoreQuestion` and `scoreRescue` award points, and `tick` guarantees progress. A player’s one non-null answer is the game-level duplicate guard, independent of reliable transport action IDs. Arrays are copied on receipt and projection. The rules allocate no timers, sockets, browser objects, or external resources.
- `src/client.tsx`: named/default `client`, with shared display, portrait controller, instructions, settings, and results. Uses shared ArcadeButton, Panel, Countdown, TextInput, Eyebrow, and StatusNotice. Controls reset on phase identifiers; locked private answers survive reconnect. Sending, success, waiting, and error states are explicit. Display and phone share answer tones and labeled memory symbols. Public standings have player colors and competition ranks; authoritative outcome ranks select the winner cards. The shared shell owns room flow and preparation acknowledgement.
- `src/art.tsx`: original SVG laboratory instruments and Sun/Drop/Bolt/Leaf symbols, shared tone maps, and a display progress needle. No bitmap assets or network requests.
- `src/draft.ts`: optional sessionStorage cache for unfinished memory and estimate input. A per-room/player key stores the exact round, turn, and challenge family. Input changes are written synchronously, restored only for that scope, and removed after acceptance. A delayed acknowledgement cannot clear a later turn’s draft. Malformed or unavailable storage falls back to normal in-memory editing.
- `src/styles.css`: game-prefixed styles using unchanged `kp` colors/fonts/tokens. Controls have a 48px minimum height, visible focus, normal scrolling for the software keyboard, safe-area padding, and reduced-motion overrides. Display-only bubbles and the progress needle use restrained CSS motion, disabled by reduced-motion preferences. Short TV viewports receive denser spacing. No 3D, remote assets, or permanent UI-kit copies.
- `tests/rules.test.ts`: full-round simulations and boundary, scoring, privacy, generation, pacing, and content checks. `tests/draft.test.ts` checks reload restoration, stale/cross-player isolation, acceptance cleanup, cache bounds, and storage failures.

The server constructs explicit projections instead of serializing state. The public projection has the current question without its key; its answer/explanation/source appears only during intentional reveal. Future questions, RNG state, future challenges, and rescue solutions are omitted. A memory sequence is intentionally public in its briefing, then omitted during answers; players can of course remember or record previously displayed information. Private projections contain only the requesting player’s submission and eligibility. Watching hosts use the public view and have no privileged access to answer keys.

Action parsing rejects unknown fields/kinds, missing or stale phase IDs, invalid seats, disconnected seats, duplicate submissions, malformed arrays, out-of-range numbers, NaN, wrong challenge payloads, and arrivals at or after the deadline. Reliable action IDs and round IDs remain platform-owned. Disconnect does not erase an answer, pause the room, or exclude a participant from results. All-disconnected games finish on deadlines.

## Validation

Run from the repository root. Verified 2026-09-08:

```sh
node --import tsx --test packages/games/quiz-panic/tests/*.test.ts
node_modules/.bin/tsc --noEmit --pretty false
node_modules/.bin/oxlint packages/games/quiz-panic
node_modules/.bin/esbuild packages/games/quiz-panic/src/client.tsx --bundle --format=esm --platform=browser --external:react --external:react-dom --outdir=/private/tmp/quiz-panic-client-check --metafile=/private/tmp/quiz-panic-client-check.json
git diff --check -- packages/games/quiz-panic
```

- **39 tests passed.** Includes complete 2-, 3-, and 10-player games; every phase/deadline edge; before/exactly-at-deadline submission; malformed, duplicate and stale actions; all-wrong and all-disconnected cases; reconnect privacy; tied estimate and final scores; zero-charge comeback; both memory lengths; 100 seeds of generated challenge checks; serialization privacy across all phases; six-second early progression; full reconnect/reading opportunities; and isolated draft restoration.
- Root TypeScript check passed at validation time. Focused Oxlint passed without warnings.
- Browser entry bundled successfully. The inspected esbuild input graph excludes both `server.ts` and `content.server.ts`. The platform rebuilt the final responsive client; its coordinated collection checks passed 151 tests, TypeScript, lint, build, and health verification.
- Whitespace check passed. The repository has no initial commit, so this does not imply a tracked or published diff.
- The `tsx` CLI wrapper initially failed because its IPC pipe was blocked by the sandbox. `node --import tsx --test` ran the same tests successfully without that wrapper.

## Integration and pending gates

No new shared API, dependencies, assets, configuration, or registry shape are required. Registry imports are the standard `src/manifest.ts` / `src/server.ts` / `src/client.tsx` entries. Shared contract and UI are imported from `../../../party-contract/src/index` and `../../../party-ui/src/index`. The platform must retain its separate allowlisted server and lazy client registries and include shared token/font CSS. The game owns no root/shared files.

Root-owned Chromium browser QA completed a three-player game, all rescue families, results, reload recovery, replay, and the repaired phone layouts. See the browser evidence below and the [collection browser QA report](../../../docs/party-platform/BROWSER-QA.md). Still unverified: physical touch devices/native software keyboards, TV readability at room distance, ten-device Wi-Fi load, hardware performance, complete screen-reader accessibility, family difficulty/pacing playtests, and audio-device behavior. The platform owns cross-game switching and transport fault coverage; do not infer a Quiz-specific acknowledgement-loss test from ordinary reload recovery. No dependencies were installed by this game owner and no git publication actions were taken.

## Later music integration

The game runs silently with no microphone or music dependency. Nothing is generated or downloaded. Suggested later cues, keyed by public `turnId` so each phase transition plays once:

| Phase/event | Suggested cue |
| --- | --- |
| `instructions` | Friendly laboratory welcome |
| `quiz` | Light question bed |
| `quiz-reveal` | Short answer reveal |
| `rescue-preview` | Repair briefing sting |
| `rescue` | Playful ticking tools; memory must remain playable silently |
| `rescue-reveal` | Charge gauge fill |
| `finale-intro` | Hatch opens |
| `finale` | Faster escape bed |
| `finale-reveal` | Footsteps or a short boost accent |
| `results` | Shared celebration |

Any future audio belongs behind the shared gesture-unlock/mute and lifecycle cleanup. Use the public deadline for countdown presentation; audio must never determine scoring.

## Pre-refinement browser QA

Evidence is from the root task’s local Chromium host plus three isolated phone contexts on the authorized port 4320 runtime. This game owner inspected root screenshots and repaired game-owned code; it did not launch a separate browser. The rejected port 4325 launch was not retried. The [collection browser QA report](../../../docs/party-platform/BROWSER-QA.md) records the integrated flow, shared shell tests, screenshots, and evidence limits.

The root completed eight experiments and the six-question finale. Early questions missed during inspection progressed on deadlines; later phases used real submissions. All three rescue families worked, including 2-charge rescue/1-charge support scoring and a 3-step finale catch-up. Estimate draft `30`, a five-symbol memory draft, and an accepted trivia answer survived reload appropriately. Results were Casey 8 steps/13 charge, Alex 4/7, Blair 4/8, correctly sharing rank 2 for the tied runners-up. Replay preserved all seats. The live match console reported zero errors and warnings.

Screenshot inspection prompted the final repairs: larger nonwrapping countdown badge; two-column portrait answer grid; full-width prompt/control columns in short landscape; compact memory recall and side-by-side Undo/Lock controls; clear singular step/jar wording. The root retested these final layouts with the rebuilt client. Labels remain 16px and targets are at least 48px portrait or 44px landscape.

| Phone viewport | Last trivia button bottom | Last memory control bottom | Final result |
| --- | --- | --- | --- |
| 320×568 | 394px | 546.83px | All controls visible; no horizontal overflow |
| 390×844 | 411px | 569.36px | All controls visible; no horizontal overflow |
| 844×390 | 256px | 358.48px | All controls visible; no horizontal overflow |
| 667×375 | 256px | 358.48px | All controls visible; no horizontal overflow |

Root inspected the final question and memory images, confirmed readable prompts/countdown, exercised Sun then Undo through actual controls, and measured zero running animations with reduced motion enabled. This game owner also viewed the final 320×568 and 667×375 memory screenshots. No further code changes remain from those findings.

Representative root artifacts:

- [Final portrait memory](../../../output/playwright/quiz-final-memory-320x568.png)
- [Final landscape memory](../../../output/playwright/quiz-final-memory-667x375.png)
- [Final portrait question](../../../output/playwright/quiz-fixed-question-320x568.png)
- [Final landscape question](../../../output/playwright/quiz-fixed-question-667x375.png)
- [Shared question display](../../../output/playwright/quiz-fixed-question-display.png)
- [1920px rescue display](../../../output/playwright/quiz-fixed-rescue-display-1920.png)
- [Final logic landscape](../../../output/playwright/quiz-final-logic-landscape.png)
- [Full-match results](../../../output/playwright/quiz-results.png)

These are desktop browser emulations and local runtime checks. Physical phones, native keyboards, distant TV viewing, maximum-device network load, hardware performance, and human pacing assessment remain separate gates.

## Claude UI refinement

The subsequent approved `ask-claude` review used the paired default main Opus session and informed the final UI. Shared A–D colors now match display and phone; labeled SVG memory symbols replace ambiguous glyphs. Public score cards use player colors, competition ranks, and semantic meters. Results promote the authoritative winner(s), including ties. Instrument art, a progress needle, phase rails, and restrained motion stay inside the game’s CSS/SVG scope. Rules and draft behavior are unchanged.

A dedicated Chromium session on port 4336 completed a two-phone match and replay. Bea finished with 8 escape steps / 15 charge; Ada with 2 steps / 15 charge. All rescue types, both memory lengths, estimate/memory draft reloads, and accepted-answer reloads worked. Across 72 active phone layouts, every button stayed inside the viewport with no horizontal overflow:48px portrait/44px landscape minimum heights. Reduced motion had zero running animations; keyboard focus showed the intended 3px cream outline. Host console had zero errors/warnings. The rebuilt question and reveal fit at 1280×720 and 1920×1080; root also verified the final ten-player reveal with long names: document height 720px, standings bottom 695.15px, all ten cards visible.

See [refinement advice and evidence](../../../output/claude-refinement/quiz-panic/ADVICE-AND-EVIDENCE.md) for build provenance, final spacing verification, screenshots, and remaining physical-device/room-distance limitations. The pre-refinement results above remain historical evidence, not the current visual baseline.
