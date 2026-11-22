# Trolley Court acceptance · 2026-11-22

Browser QA of the deep pass (big rooms up to 64, the reveal showcase and verdict sequence, captions, heckles, new cards) on isolated builds: the real launcher, room server, shared lobby and results shell, a TV page and phone pages. Nothing was staged, committed, pushed or deployed. No other game's folder was touched. The earlier acceptance (2026-10-04, builds `tc-qa-a`…`tc-qa-e` and `trolley-final`) is summarised at the end; its builds no longer exist.

## Final build: `tc-pass-3`

- `output/builds/tc-pass-3`, built 2026-11-22T09:19:52Z, client index SHA-256 `16744aec3be07e6a0e141da248255d705b45339a47581ae7dc42431c82478a0c`. Served by an owned `HOST=127.0.0.1 npm run serve:isolated -- tc-pass-3 4424`; the server was stopped and the build deleted when the runs finished. Every scenario below ran on this build.
- Earlier builds of this pass, all deleted: `tc-pass-base` (the untouched source, for the "before" screenshots, port 4420), `tc-pass-1` (port 4422) and `tc-pass-2` (port 4423). A first 4-player and 32-player night ran on `tc-pass-1`, and 3, 6, 10, 32 and 64 on `tc-pass-2`; the defects they showed are listed below and were fixed before `tc-pass-3`.
- Static checks on the final source: `node --import tsx --test packages/games/trolley-court/tests/*.test.ts` passes 46/46 (deck 4, rules 24, crowd 18). `npm run typecheck` exits 0. `npm run lint` exits 0 with no finding in this game's files. `npm run test:platform` passes 119 of 120 with 1 skipped (the packaged-app test, which needs `PARTY_LOCAL_HOST_APP`); it includes the registry contract at 3 and at 64 players.

## How it was driven

- `tools/qa-driver.ts` (headless Chromium through `playwright-core`): the TV (1920×1080) adds the game, plays on this screen, applies settings through the real Settings → Game rules modal and starts the room. Phones (390×844, touch) join through the join form with typed names and tap **Ready to play**; the rest of the roster are socket bots that play with `src/bot.ts` and heckle. Phones play with real taps: propose, write in, aim and lock as counsel; lean (from the first reveal), **Next speaker**, and press-and-hold a verdict as Conductor; in the Gallery take a track, vote, aim, heckle and hop once per case.
- Every new phase and step is shot on the TV (plus a 1280×720 sweep per phase kind) and on each phone (plus 320×568, 667×375 and 844×390 sweeps per phase kind and role). Each shot runs layout checks and a privacy check: the page text must not contain a hand card of another team (any hand, on the TV, a Conductor's or a Gallery phone), nor the Gallery's ballot anywhere but a Gallery phone, unless the card is already on the tracks. `log.json` in each folder also holds case lengths taken from the TV's own snapshots, bytes received per seat (average and the busiest 5 s), and for each real phone the longest stretch with no enabled control on screen.
- `tools/sandbox.ts` renders any phase at any roster from fixtures the real rules and bots produce, with no room. It was used to judge the densest legal content (`10max`, `64max`: 16-character names, every card padded to its 70 or 60 character limit, Accomplices + Underdog with every twist piled on one card), each moment of the crash, reduced motion, settings and how-to. Its shots are in `output/trolley-pass/after/`.

## Scenarios on the final build

| Run (`output/trolley-pass/…`) | Roster and settings | Result | Accepted actions |
| --- | --- | --- | --- |
| `final-3p` | 3 real phones, `laps: 1` (3 cases), defaults | Full game to results (Mika walks free, 0 deaths), **Play again**, all three re-readied through the UI, and the replay reached case 1's Innocent pick with deaths 0/0/0 and empty history. Each phone was counsel twice and Conductor once. 0 errors, 0 privacy findings in 422 shots. | 82 (propose 37, lock 18, shout 12, lean 6, next 6, decide 3), 0 rejected |
| `final-6p` | 6 seats: 3 phones + 3 bots, defaults (6 cases) | Full game to results (four joint winners on 2 deaths), **Play again**, phones re-readied through the UI and bots over their sockets, replay at case 1 of 6 with all deaths 0. 0 errors, 0 privacy findings in 501 shots. | 225; 10 rejected (9 "already locked this" races between teammates, 1 heckle throttle) |
| `final-10p` | 10 seats with 16-character names: 2 phones + 8 bots; Accomplices + Underdog; `--pile` aims every twist at North's Bystander; timers 30/45/30/15, read-aloud off | Full 10-case game to results (two joint winners on 3 deaths), **Play again**, replay at case 1 of 10. Nine to eleven twists landed on one card in most cases. 0 errors, 0 privacy findings in 522 shots. | 751; 45 rejected (42 lock races, 3 heckle throttle) |
| `final-32p` | 32 seats: 2 phones + 30 bots, defaults (8 cases) | Full night to results (two joint winners on 1 death; deaths spread 1–6). Both phones were mostly Gallery and each sat on the bench. 0 errors, 0 lost taps, 0 layout or privacy findings in 381 shots. | 1,080 (stand 268, vote 200, aim 200, shout 245, propose 91, lock 48, next 16, decide 8, lean 4); 13 rejected, all races with a phase change or a teammate |
| `final-64p` | 64 seats with 16-character names: 2 phones + 62 bots, defaults (10 cases) | Full night to results (three joint winners on 1 death; deaths spread 1–9; ten different Conductors). The lobby wall listed 64 ready seats. 0 errors, 0 lost taps, 0 privacy findings in 409 shots. | 2,669 (stand 720, vote 570, aim 570, shout 611, propose 105, lock 60, next 20, decide 10, lean 3); 80 rejected (55 heckle throttle or late heckles, 13 stands after the glue or the bell, 12 lock races) |
| `final-32p-short`, `final-64p-short` | 32 and 64 seats, `laps: 1` (the Short night, 6 cases) | Both full nights to results in 10.7 and 10.8 min (nine joint winners at 32, one at 64). 0 errors, 0 privacy findings. These runs split the traffic into play and the results screen. | not tallied |

Remaining layout-check entries on the final build are one kind only: a twist chip measured mid-way through its 0.5 s drop-in (`wide tc-mods … 432>376`), on reveal beats and each time a crowded card cycles its chips.

## Pacing, idle time and traffic

Case length is what the driver measured with bots and scripted phones, which decide in seconds. People take longer: a pick is about 20–30 s rather than 5–15, a floor 30–50 s rather than 7–10. The last column is every timer running out at the default settings (deal 12.5 s, picks 50 + 50 + 75 s, reveals about 40 s, floors 2 × 50 s, lever 30 s, crash 9.5 s).

| Players | Cases | Measured case (bots) | Measured night (bots) | Expected with people | Every timer runs out |
| --- | --- | --- | --- | --- | --- |
| 3 (`laps: 1`) | 3 (6 official) | 109–133 s | 6 min for 3 | about 20 min for 6 | 37 min |
| 6 | 6 | 86–99 s | 10 min | about 22 min | 37 min |
| 10 | 10 | 90–99 s (short timers) | 16 min | 35–40 min | 61 min |
| 32 | 8 | 98–106 s | 14 min | 28–32 min | 49 min |
| 64 | 10 | 96–103 s | 17 min | 35–40 min | 61 min |

A case does not grow with the roster: the bench is always seven people and the Gallery acts in parallel.

**Nothing to do.** The longest stretch a real phone had no enabled control was 21.5–23 s at every size: the crash (9.5 s) and the next deal (12.5 s). The one exception was 27.6 s for counsel at 10 players with Accomplices on, during an eleven-twist reveal. A Gallery phone had a live control 73–74% of the time at 32 and 64 (the stand bar is live from the first pick to the lever); counsel in small rooms 39–59% (they watch reveals and wait for the other team). The Conductor now has the lever from the first pick on.

**Traffic**, bytes received per seat (driver, real sockets). The mean is over the whole game; the busiest 5 s is split into play and the results screen for the big rooms.

| Players | Mean per seat | Busiest 5 s in play | Results screen | Whole room (mean) |
| --- | --- | --- | --- | --- |
| 3 | 10.6 KiB/s | 18 KiB/s | not split | 32 KiB/s |
| 6 | 12.0 KiB/s | 21 KiB/s | not split | 72 KiB/s |
| 10 (Accomplices) | 17.3 KiB/s | 51 KiB/s | not split | 173 KiB/s |
| 32 | 12.6–12.8 KiB/s | 20–24 KiB/s | 44–45 KiB/s | 404–409 KiB/s |
| 64 | 14.7 KiB/s | 20–22 KiB/s | 74–76 KiB/s | 942–943 KiB/s |

Before this pass the whole public view travelled in every snapshot: computed from the untouched source, 46 KiB/s a phone at 4 players and 66 at 10. With the snapshot cache a 64-player full public view is 11.4 KB and is sent about 23 times a case; the per-snapshot part is 0.56 KB plus the private view (0.2–0.45 KB Gallery, up to 1.2 KB counsel). Sixty-two bots heckling far more than people will did not push a phone past 22 KiB/s in play. The busiest traffic of a big night is the results screen, where the platform attaches the outcome rows (9 KB at 64 seats) to every snapshot at 10 Hz; that is shell behaviour, not this game's view. The largest single message is the 64-player results snapshot, about 25 KB, or 28 KB if every seat were a joint winner: inside the 32 KiB cap (unit test).

## Viewports inspected

TV 1920×1080 and 1280×720; phones 390×844, 320×568, 667×375 and 844×390. Looked at, not only measured: lobby (3 and 64 seats), deal, every pick (empty, half locked, all locked), every reveal with the showcase, plead with heckles, lever, the crash at 0.4 s, 3 s, 5.3 s and 7 s, results (3, 6, 10, 32, 64 seats, TV and phone), replay; phone screens for counsel, Conductor (including the early lean) and Gallery (stand, vote, aim, plead, hop, heckle, glued, crash); reduced motion on the crash; the fullest legal track at 10 and at 64.

## Before and after

- `output/trolley-pass/before/`: 18 shots of the untouched game (build `tc-pass-base`): a 4-player game on TV and phone including 320×568, and the 10-player fullest track (`10p-fullest-track-plead-tv.png`, `10p-plead-tv-1280x720.png`).
- `output/trolley-pass/after/`: 30 sandbox shots of the final source at the same moments plus the big-room ones, including `tv-10max-fullest-track(-720).png`, `tv-64max-plead(-720).png`, `phone-64max-gallery-*-320.png` and `results-64max-*`.
- `output/trolley-pass/final-*/`: `log.json` for every final-build run and a dozen of its screenshots (the lobby, a reveal, plead, lever, crash, results at 1280×720, a phone at 390 and at 320×568, the replay). The run folders were trimmed to these afterwards; the shot counts above are what each run took and checked. `p2-10p/log.json` is kept for the false privacy entries described below.

## Defects found and fixed during the pass

Found on `tc-pass-1` and `tc-pass-2` and absent on `tc-pass-3`:

1. **Gallery strip overflow.** Waiting Gallery dots were absolutely positioned and slid into the standings box as people stood. They now flow in a row.
2. **Floor flag pushed the plate off the row** at 64 players with long names. It is now a tag on the plate's corner.
3. **Twists over the Gallery band / past the row.** A long card with three twists reached 6–8 px past its row. Three or more twists on one card now step down a size (and one more in a crowd).
4. **Board overflow.** The Clerk's board was 4 px too tall with three progress rows.
5. **Heckle storms hid the cards** in a 64-seat room. A crowd shows the newest six bubbles, smaller, low on the track.
6. **Gallery phone in short landscape** put the stand bar in half the width. Now full width with the intro text hidden.
7. **Caption lag.** With instant bot picks the caption trailed two phases behind; a line that has waited 8 s is dropped, as the mixer already does with its audio.
8. **Gallery dots reshuffled on every hop.** Newcomers now join the end of the line.
9. **Dimmed track showed the rails through the cards** (present before this pass). The quiet track is darkened, not made transparent.

Driver fixes (`tools/qa-driver.ts`, QA only): Playwright found at `$PLAYWRIGHT_CORE` or `~/.local/opt/pw`; the Settings → Game rules step; snapshots decoded through the cache; 127.0.0.1; bots ready again for a replay (the first 6-player replay attempt failed on this, not on the game); phase times from snapshots instead of the screenshot loop; optional taps give up after 3 s and are counted as `lostTaps`; and a race in the privacy check that briefly reported a phone's own hand as foreign when the game started between the screenshot and the text read (`p2-10p`, 10 false entries, all cards of that phone's own team).

## Remaining limits and notes

- **Not physical devices.** Phones were emulated in headless Chromium; touch, keyboard over the write-in box, notches, real Wi-Fi with 32 or 64 phones and long sessions on real iOS and Android are untested. Bots stand in for all but two or three seats.
- **Audio not heard.** No run listened to the mix. Changed and unheard: the lever sound now triggered from the view, heckles reusing `cheer`, `gasp` and `aww` quietly, `gavel` on the verdict stamp, and the crash sounds re-timed to the longer sequence. The 139 new cards and the four `gallery.*` lines have no recordings: the cards are read by browser speech synthesis like write-ins, the lines are captions only.
- **Timeouts and disconnects in the browser** were not re-run in this pass (the 2026-10-04 `--idle` scenario). The rules for them are unchanged up to ten players and unit-tested for a crowd (a 32-player night with no input, a disconnected Gallery seat).
- **Absolute worst-case twist stack.** With every text padded to its legal maximum (a four-line card under two three-line twists and a "+7 more" chip) the stack reaches 12 px into the gap between the rows (`after/tv-10max-last-twist-reveal.png`). Real cards did not do this in the ten-case pile run.
- **Pacing with people** is an estimate; only bot-speed nights were measured.
- The newly pressed stand button plays a 0.35 s pop that starts from transparent, so a screenshot taken on that frame shows one button (`final-64p/141-…-hopped.png`).

## Earlier acceptance (2026-10-04)

Builds `tc-qa-a`…`tc-qa-e` and `trolley-final` covered the ten-seat game: full games at 3 and 10 players with replay, an idle run with every timer expiring, a team phone and the Conductor's phone going offline, write-in drafts, the emoji clamp and stale-twist handling, and TV audio surviving results and replay (counted, not heard). Eleven layout defects were fixed then. That evidence was under `output/playwright/trolley-court/`.
