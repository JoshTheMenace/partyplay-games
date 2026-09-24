# Ichi acceptance · 2026-09-23

This covers the rebuilt Ichi after the creative director's critique (12 items). Everything was built in isolation and checked in a real browser. Nothing was committed, pushed or deployed. `types.ts` did not change.

## Current build: `ichi-qa-k`

- `output/builds/ichi-qa-k`, client index SHA-256 `0a1079c0e5ebb25a6b0e333e8cceeaf79f4553687046fad3693368a029ac4d8f`.
- Served on port 4372 by an owned `npm run serve:isolated -- ichi-qa-k 4372` (npm 45590 → node 45606 → server 45607). It was stopped afterwards and the port is free. Port 4361 and user sessions were not touched.
- Static checks: `npm run typecheck` passes, and `npm run lint` exits 0 with no Ichi warnings. `node --import tsx --test packages/games/ichi/tests/*.test.ts tests/ichi-contract.test.ts tests/registry-contract.test.ts tests/catalog.test.ts` passes 62/62.
- Card-back art re-rendered with `blender -b --python art/render.py -- card`.

### Scenarios (real launcher, room server and UI; headless Chromium only)

The driver is `ICHI_TAG=qa-k node scripts/qa/ichi-play.mjs <a|b|c|d> http://localhost:4372`. Evidence is in `output/playwright/ichi/qa-k/<scenario>/`, with `stats.json` plus screenshots. Bots act only through the QA hooks. Card taps now land on the card's top-left corner, because in a two-row hand the lower half of a first-row card sits under the second row.

| Scenario | Result | Accepted actions | Hands |
| --- | --- | --- | --- |
| a. 2 players, target 200 | Reached platform results (Jonah 246, Mika 0). Each hand end shows the winning card and "<name> goes out!" before the tally fades in (`tv-goes-out-1/2`). **Play again** started Hand 1 with both scores at 0. | 225, 0 rejected | 3 |
| b. 10 players, 16-character names, Chaos, one-hand match; TVs at 1280×720 and 1920×1080 | Reached results. Captured splashes at both sizes: Stack!, color call, Jump in, Reverse, Hands swapped, Hands pass, Challenge failed, Caught!, Ichi!. Also the pending stack, Ichi window, and results with leftover strips. TV results fit both screens, with **Play again** visible at 720p. | 331. Server rejected 7 "Too slow" turn races. 19 UI misses from 10 bots racing the DOM. | 1 |
| c. Phones at 320×568, 390×844, 667×375, 844×390; phone 0 hoards 22 cards | Captured all 34 states: waiting, up-next, your-turn, wild sheet, big hand (20+ cards), catch, urgent Ichi, penalty hint, intermission. | 187, 0 rejected | 1 |
| d. Reload mid-turn, catch race | Seat, hand, turn and selected card (Sky 8) survived the reload. The losing catcher saw "Too slow — that catch window already closed." as an overlay toast, and it cleared by itself (`errorCleared: true`). | 79 | 0 |

Totals on qa-k: 822 accepted actions, 0 console or page errors, and 0 socket closes. Earlier runs on qa-e through qa-i added about 3,500 more accepted actions across the same scenarios.

### Critique items

1. **Hand fit.** Cards size themselves by column count (`--cols`), with a 1.6em minimum strip. Past 10 cards the hand wraps into two overlapping rows. A 7-card hand at 390 px no longer scrolls, and neither do 20–24 cards at 390, 667 and 844. Short landscape adds a height bound through `--rows`. Unplayable cards are dimmed to `brightness(.78) saturate(.75)`.
2. **Stacks.** `stack` events fly in from the seat, flick, and appear under the pile, with a "Stack! +N" splash. The badge grows with the count and moved to the pile's top-right, so it no longer covers "Stack, challenge or draw N". The current seat shows a red "+N incoming" tag, and the thud pitch rises with the penalty.
3. **Splash.** A dark wood ribbon with a gold border at 3.2em, `top:74.5%`. It clears the color chip and the 10-player lower seats. From 9 seats the detail line is hidden, because it sat on the lower-corner plates and the ticker already shows it. Grape text is lightened for contrast.
4. **Ichi/Catch phone.** The hint lines are correct. A 6 px bar drains over the window, measured once per window: coral on Ichi!, sun on Catch!.
5. **Active color.** The felt washes in the active color. The pile chip is at .8em, and color calls splash "<Color>!" (skipped when the same batch already has a Stack! splash).
6. **Phone feedback.** Arriving cards rise in. A "+N from <name>" pill (credited to the last +2/+4 or challenge, or to the catcher) replaces the prompt's sub-line for 2.6 s, with a buzz. The top card lands with a turn.
7. **Card faces.** A round crest medallion with a double ring replaces the tilted oval. The suit emblem is a faint watermark behind numbers. +2 and +4 use stacked crests, and the mirrored bottom corner was dropped. The card back is now a square vermilion seal with a tapered gold 一. A first try with a round red seal read as a no-entry sign.
8. **Going out.** A sun burst at the winner's seat and a "<name> goes out!" splash. The tally and the final overlay fade in after 1.5 s, and the count-up waits for them (no delay under reduced motion).
9. **Seat plates.** At most 3 backs, and a 1.8em card-count badge. Points are hidden in one-hand matches.
10. **Waiting phone.** "You’re next!" in the highlight style, with a buzz only at 3+ players (in a 2-player game you are always next). Otherwise the sub-line is the latest table event.
11. **Errors.** Auto-clear after 3.5 s, shown as an overlay toast at the top of the sheet.
12. **Results.** TV results scale with the screen, bounded by height for the row count. Standings are in em. One-hand matches show leftover strips instead of "0 hands" and hide the redundant "Last hand" list. Names stay on one line. Intermission leftovers are .55em for 6 players or fewer.

Deviations from the literal critique:
- The hand floor is 13 px, not 15 px, so a 20-card hand fits a 320 px phone.
- The second-row offset is `-4.9em - .7rem`, not `-3.6em`, because each row keeps its own lift padding. Either way the second row covers the lower half of the first. The second row's padding is click-through.
- The wash fades in with a keyframe rather than `transition:background`, because gradients don't transition.
- The penalty hint sits in the prompt line instead of the toast, because it overlapped the prompt on short phones.
- `vibrate()` waits for the first user activation. Chrome logged an intervention error after a reload.

### Screenshots inspected by eye

- TV: `b/tv720-mid`, `b/tv1080-mid`, `b/tv720-stack`, `b/tv1080-stack`, `b/tv720-splash-stack`, `b/tv1080-splash-stack`, `b/tv720-splash-caught`, `b/tv720-ichi-window`, `b/tv-results`, `b/tv1080-results`, `a/tv-goes-out-1`, `a/tv-intermission-1`, `a/tv-results` (qa-g through qa-k).
- Phones: every `c/<viewport>-<state>`, plus `d/rejected-catch`, `b/phone-stack` and `b/p0-results`.

## Remaining limits

- Everything was emulated in headless Chromium. There were no physical phones, TVs or Safari, no human pacing or couch-distance test, and nobody has listened to the sounds.
- At 320×568, a two-row hand plus Catch! and Draw can scroll about 70 px during the 5 s window. The sticky action bar keeps Catch! visible, and the tops of the row-2 cards remain tappable. At 320×568 the intermission scrolls 12 px.
- More than 20 cards at 320 px (or 28+ at 390 px) reach the 13 px floor and scroll sideways a little.
- Phone results scroll at 10 players (about 90 px).
- A splash is still briefly semi-transparent while it pops, and flying cards can pass under it.
- The reconnect notice after a network drop is still only covered by the reload path.
- `catalog/sources.json` still describes the old game. It is a platform file outside this package.
- Open rules questions are unchanged: whether a +4 answering a stack counts as a bluff, and a disconnect keeping the 5 s turn.

## History

- `ichi-qa-a`, `ichi-qa-b`, `ichi-qa-c` (the pre-critique rebuild): 1,294 accepted actions on qa-c across a/b/c/d, and 8 repairs. These were the double-press lock, the lost-catch reason, splash and results fitting, the 320 px wild sheet, Catch! space, drawn-card focus and art wiring. Evidence is in `output/playwright/ichi/{a,b,b-qa-b,c,c-run1,d}/`.
- `ichi-qa-d`: name collision, never served.
- `ichi-qa-e`: the first critique pass. Its c run found that landscape two-row hands overflowed the strip and that the penalty toast overlapped the prompt.
- `ichi-qa-f`: its b run found that the stack badge covered the turn text, grape was low-contrast, and 16-character names wrapped so TV results scrolled.
- `ichi-qa-g`: verified those fixes and the goes-out moment. Its 720p splashes touched the color chip.
- `ichi-qa-h`, `ichi-qa-i`: a/b/c/d on each. These runs found the 10-player splash detail on the corner seats, the 320×568 catch scroll, and the vibrate intervention.
