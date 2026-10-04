# Trolley Court acceptance · 2026-10-04

This is browser QA of the real game (launcher, room server, shared lobby/results shell, TV page and phone pages) on isolated builds. Defects found were fixed in `packages/games/trolley-court/` and re-verified on a fresh build. Nothing was staged, committed, pushed or deployed. No other game, the live server on 4390 or `output/builds/partyplay-public*` was touched.

## Current build: `tc-qa-e`

- `output/builds/tc-qa-e`, client index SHA-256 `84dcf962d94f9dc14d2d3e21916604bce7b28b13e813a14bd7b0e86ae5198b48`. It includes every fix below.
- Served by an owned `npm run serve:isolated -- tc-qa-e 4388` and stopped afterwards. Earlier runs used ports 4384–4387 (builds `tc-qa-a`…`tc-qa-d`); all are stopped and the ports are free.
- Static checks on the final source: `npx tsc --noEmit -p <tsconfig including only packages/games/trolley-court>` passes (the full `npx tsc --noEmit` still runs out of memory on this 3.9 GB machine, as in the integration report). `npx oxlint packages/games/trolley-court` exits 0. `node --import tsx --test packages/games/trolley-court/tests/*.test.ts tests/catalog.test.ts tests/registry-contract.test.ts` passes 55/55.
- Not mine and left alone: an orphaned `trolley-qa-2` server on port 4382 (started 03:09 by an earlier session, parent is systemd), and other agents' Hijinks fullscreen drivers. Browser runs took `/tmp/hijinks-heavy.lock` so they did not overlap other heavy jobs.

## Review fixes recheck: `trolley-final`

- `output/builds/trolley-final`, served by an owned `serve:isolated -- trolley-final 4377` and stopped afterwards. Driven by `output/playwright/trolley-court/fixcheck.ts` (headless, under `/tmp/hijinks-heavy.lock`); evidence and `result.json` in `output/playwright/trolley-court/tc-fix-write/` and `tc-fix-audio/`.
- **TV audio across results and replay** (`tc-fix-audio`, 3 socket bots, `laps: 1`): `client.dispose()` no longer destroys the display mixer. With a probe on the TV page, one AudioContext lived from round 1 through results and the replay, with 0 `close()` calls. Buffer starts went 8 (round 1) → 164 (results) → 171 (15 s into the replay), so the replay still plays cues. This is a count, not listening.
- **Write-in drafts reach teammates** (`tc-fix-write`, 5 seats: Ana and Sam on North): Ana typed "A pigeon with a law degree", and Sam's blank card showed it with Ana's pip (`02-sam-sees-ana-draft.png`). Tapping the card filled Sam's text box with the same text and enabled Lock, and Sam's lock placed Ana's text (`03`, `04`).
- **Write-in limit counts code points:** pasting `a` plus 69 emoji kept 60 code points, the counter read 60/60, and Lock stayed enabled (`01-ana-emoji-clamp.png`).
- **Stale twist:** Ana proposed twist X in Twist 2, then Sam locked X in Twist 1. On Twist 2, X is disabled ("In Twist 1"), Lock is disabled, and the status line reads "That card is in Twist 1. Pick another." (`05-ana-stale-twist.png`).
- Bidi/zero-width write-in stripping is covered by a unit test (`cleanWriteIn drops invisible format characters…`), not a browser run.

## How it was driven

`node --import tsx packages/games/trolley-court/tools/qa-driver.ts --port <port> --players N [...]` (headless Chromium from `~/.cache/ms-playwright`, Playwright resolved like the Hijinks driver).

- The TV (1920×1080) adds the game, plays on this screen, applies settings through the real Settings modal and starts the room. Phones (390×844, touch) join through the join form with typed names and tap **Ready to play**. Bots join over WebSockets and play with `src/bot.ts`.
- Phones play with real taps: pick a card (the write-in first, typed in full), aim twists on the target map, **Lock it in**; as Conductor tap the lever switch, **Next speaker / To the lever**, and press-and-hold a verdict for 1.35 s.
- Every new phase/step is shot on the TV, with a 1280×720 sweep per phase kind; every phone is shot per phase, with 320×568, 667×375 and 844×390 sweeps per phase kind and role. The crash is also shot at 3.2 s and 5.9 s. Each shot runs layout checks (horizontal overflow, targets under 44 px, clipped or too-wide TV text) and a **privacy check**: the page text must not contain any card from another team's private hand (for the TV and the Conductor: any hand) that is not already revealed on the tracks. `log.json` in each folder holds phases, accepted/rejected actions, layout findings and console/page errors.

## Scenarios on the final build

| Run (evidence) | Roster and settings | Result | Accepted actions |
| --- | --- | --- | --- |
| `tc-qa-e-3p` | 3 real phones (Mika, Jonah, Ana), `laps: 1` (3 rounds), write-ins on, read-aloud on | Full game to the shared results (Jonah walks free, 0 deaths); **Play again** from results, all three phones re-readied through the UI, and the replay reached round 1's Innocent pick with deaths 0/0/0 and empty history. Every phone was a team member twice and Conductor once; write-ins were typed and locked by both teams (`*-write-in.png`). 0 console or page errors, 0 privacy findings in 418 shots. | 66 (propose 36, lock 18, lean 3, next 6, decide 3), 0 rejected |
| `tc-qa-e-10p` | 10 seats with 16-character names: 2 real phones + 8 bots; Accomplices + Underdog on; `--pile` aims every twist at North's Bystander; timers 20/30/20/10, read-aloud off | Full 10-round game to results (5 joint winners at 4 deaths). The maximum twist load, 11 twists on one card (Accomplices 5+4 plus two Underdog extras), occurred in rounds 5, 6 and 8 (logged; the driver shoots rounds 1–3 and the last) and round 2 had 10 on one card (`174-r2-modifierReveal-10-tv.png`); the 11-twist reveal was shot with the same layout in `tc-qa-d-10p/160-r2-modifierReveal-11-tv.png`. Two 5-member plates with Underdog badges and death pips fit; TV results at 1280×720 keep **Play again** on screen. 0 privacy findings in 476 shots. | 651 accepted; 50 rejected, all "<name> already locked this." races between teammates (first-lock-wins working as designed) |
| `tc-qa-e-idle` | 4 seats: 3 phones + 1 bot, default timers, `--idle --rounds 2` | Round 1: nobody acts, so every timer ran out: Innocent/Guilty 30 s and Twist 45 s auto-picks ("auto-picked" credit on the TV), both 30 s floors, and the 20 s lever window ("Your Honour dithered. The lever stayed put." / "Left as it was"). Round 2: a team phone went offline for 16 s during the Innocent pick; the other team locked alone and the phase ended early once the server dropped the dead socket (~11 s). The Conductor's phone went offline for 24 s during floor 1: floor 1 was cut from 30 s to 21.7 s, floor 2 lasted 8 s (`awayMs`), the reconnected Conductor got a full lever window, and the timeout kept the lever where it was. Seats and picks survived both reconnects. | 5 (by design: idle) |

Viewports seen and inspected: TV 1920×1080 and 1280×720; phones 390×844, 320×568, 667×375 and 844×390, for the team and Conductor roles in deal, every pick phase (including chosen/aimed/write-in/locked states), every reveal, plead, lever (including the hold-in-progress state), crash and results.

Earlier evidence (before fixes, kept for history): `tc-qa-a-3p` (first full 3-player game + replay, build `tc-qa-a`), `tc-qa-b-10p` (first full 10-player game), `tc-qa-c-idle`, and the re-verification runs `tc-qa-d-3p` / `tc-qa-d-10p`. `smoke/` predates this pass.

## Defects found and fixed

1. **Settings select clipped.** "Official (twice with 3–4 players)" was cut off in the Length select. Now "Official (twice at 3–4)".
2. **North DEFAULT tag hidden** under the Clerk's board whenever the trolley defaulted North (board grows with the progress list and big clock). Moved down to clear it (`display.tsx`).
3. **Pick dock text over cards.** The dock's status line ("Tap a card to suggest it…") was printed on top of the card text scrolling beneath it at 320×568 and 390×844. The dock is now opaque behind its text, with a short fade above.
4. **Conductor header wrapped** ("CONDUCTOR · YOUR HONOUR" over two lines at 390 px). Now "Conductor" with the cap icon.
5. **Conductor controls below the fold in landscape.** At 667×375 and 844×390 the lever filled the screen and **Next speaker** needed a scroll. The explanatory line is hidden and the lever is shorter in short landscape; the lever and Next are both on screen.
6. **TV plates overflowed at 10 players.** Seat dots wrapped onto their own line, and with Underdog badges and death pips the South roster ran under the tally strip. Chips now flow inline (dot stays with the name, pips and badge follow), and 4–5-member plates use a compact size.
7. **Write-in preview.** The blank card kept saying "Blank card: write your own" while typing; it now shows the draft text.
8. **Small TV text at 720p.** Plate names, twist counts, card-back minis, twist chips and tally names were enlarged; card-back slot labels ("Planted by South") got a backing pill so they no longer run into the card-back art.
9. **Edge spotlights** on the first and last slot scaled over the team plate and stage edge; they now grow inward.
10. **Results.** Phone standings broke names letter by letter ("An a", "Jon ah") and overflowed at 320 px: number columns are now content-width with icon headers on narrow screens. TV results scale with the screen and row count, victims are hidden on short TVs with more than 6 rounds, and more than three joint winners use a compact podium, so 10-player results fit at 1280×720.
11. Minor: banner line height, phone lever spacing, twist target buttons keep clear of the sticky header and dock.

Driver fixes (`tools/qa-driver.ts`, QA only): the settings select locator, a 60 s action timeout instead of hanging forever, a TypeScript definite-assignment error, the privacy check, a 24 s Conductor outage (the server needs 10–15 s to notice a dead socket) and the round-1 proposal by the first team phone.

## Remaining limits and notes

- **Not physical devices.** Phones were emulated in headless Chromium; touch, keyboard-over-input, notches, real network loss and long sessions on real iOS/Android are untested. Offline was emulated with `context.setOffline`.
- **Audio not heard.** The `trolley-final` recheck counted AudioContext/buffer-start activity only. Headless runs cannot judge narration, card read-aloud (recorded or speech synthesis), SFX mix or ducking on real TV speakers.
- In both idle runs (`tc-qa-c-idle`, `tc-qa-e-idle`) the TV and the always-online phone logged one "WebSocket connection … failed" per offline episode and reconnected without losing their seat or phase. It did not reproduce in a two-context test and never happened in runs without offline toggles; it looks like a harness/shared-session artefact, not Trolley Court code.
- Remaining layout-check entries are transient: the spotlit twist chip measured mid-scale (`421>376`) and the falling-skull tally animation during the crash. Both were checked visually.
- Driver step timeouts (1–3 per 10-player run) are a phone trying to tap a card just as the slot was locked or the timer ended; the server and UI were consistent afterwards.
- The full `npx tsc --noEmit` and full `npm test` were not re-run here (memory); the integration report covers them.
