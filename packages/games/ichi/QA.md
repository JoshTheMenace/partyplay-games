# Ichi acceptance · 2026-11-22 deep pass

This covers the pass that seated 64 players, added the parlor (several tables at once), the Gift card and a graphics and animation pass. Everything was built in isolation and checked in a real (headless) browser. Nothing was committed, pushed or deployed.

## Builds

| Build | Client index SHA-256 | Used for |
| --- | --- | --- |
| `ichi-before` (untouched code) | `fa5672427eb910dbb2d41ce5978b1b8c7fed36df71c8a694799c13c41c31a8b0` | The "before" play-through and screenshots, port 4430. |
| `ichi-a1` … `ichi-a6` | not kept | Rehearsals while the work was in progress, ports 4431–4433. One of their results is quoted below and labelled. |
| `ichi-final` | `36dbc6e094c89ee5c720c78b399b0fbce8d9c13f3bc31f65f9788d48ad8683c0` | A complete run of every scenario. It found one defect (the Gift sheet lost its instruction on short phones), fixed in CSS and one line of markup. Its records are under `rehearsal/ichi-final/`. |
| `ichi-final-b` | `cbe5879e27e21c82f6e1da93c0c0149d8c983d2040ac9423776dcf3a666ddd41` | A second complete run of every scenario, port 4431. Reviewing the bell rule afterwards found that a Reverse inside the final lap could give one player two last turns and another none. That was fixed in `server.ts` only (see below). |
| `ichi-final-c` | `4dcfc39556803d4c13b07ba3b682d761782935a2b42eaa7b471a372effefbdd4` | The final rules, port 4432: the parlor on eight real phones, one table at 2 (with a rematch) and 6, and the full 32- and 64-player matches again. Its screenshots showed two cosmetic flaws, fixed with two CSS rules (see below). |
| `ichi-final-d` | `ef37d666733d0a938524fe7f65d2b372e24f48291b6371d055d24cd82b4ea6fd` | **The source as handed over**, port 4431: one table at 2 (with a rematch) and 10, and a three-table parlor of 12, to confirm the two CSS rules and one more complete flow. |

Between `ichi-final-b` and `ichi-final-c` only the final lap changed: it now tracks which players still have their last turn (so a Reverse cannot give anyone a second), a +2 or +4 played with the lap's last turn lands on the next player, and nobody can jump in after the bell. Ichi's browser code is the same in both: its stylesheet is byte-identical (`client-DmqlrrgA.css`) and its script chunk is identical once the names of shared chunks are normalised (the index hashes differ because other games in the same checkout changed between the two builds). Between `ichi-final-c` and `ichi-final-d` only the stylesheet changed, by two rules: the red "+N incoming" tag on the TV sits higher so it no longer covers the top of the player's name, and a parlor of up to three tables of four lists every name in its floor rail in full. Ichi's script chunk is identical in all three builds and `server.ts` did not change after `ichi-final-c` was built. So the screens checked on `ichi-final-b` and `ichi-final-c` are the screens of the handed-over source apart from those two rules, and each result below names its build.

All servers were stopped and all builds deleted afterwards.

Drivers: `tools/qa-driver.mjs` (a real TV page, real phone pages that tap the DOM, optional socket bots through `scripts/qa/room-bots.ts --hook tools/room-bot.mjs`) and `tools/qa-watch.mjs` (a second display at 1920×1080). Bots think 2.5–7 s a turn unless stated. Evidence is in `output/ichi-pass/` in the platform checkout: `before/`, `rehearsal/`, `final-b/`, `final-c/` and `final-d/`, each run with its `stats.json` and the screenshots that were looked at.

## What playing the old build showed

Played first as a new player would (2 and 10 players, one phone hoarding 23 cards). Ranked:

1. **One table does not scale.** At 10 players a hand is about 75 turns and the wait between your turns is 45 s at the median. Nothing existed above ten.
2. **The TV table was static.** Small name plates with three decorative card backs each and a small pile; nothing showed who held how many cards. A played card flew in from a plate; nothing else moved.
3. **The end of a match was cut off.** The platform's results replaced the table in the same tick as the winning card, so the last play and its splash were never seen.
4. **The Ichi race was a small red box** competing with the color splash.
5. **The phone hand went grey whenever it was not your turn**, and a played card simply vanished.
6. **Every phone received the whole table ten times a second**: 35–44 KiB/s a phone at 2–10 players.
7. The catalogue text described a different game ("secret missions").
8. Nothing in the deck was Ichi's own.

Items 1–7 were done. For 8 the Gift card was added.

## Complete matches on real pages

"Accepted" counts server-acknowledged actions sent by the real phone pages; socket bots are counted separately. The TV was 1280×720 unless stated; phones were 390×844, 320×568, 844×390 and 667×375.

| Room | Flow | Build | Result |
| --- | --- | --- | --- |
| 2 players, one hand | join → match → results → **Play again** → rematch → results | final-d | First match 1:13, rematch 5:33; both reached results. 178 actions accepted, none refused. Layout problems: none. |
| 10 players (4 real phones + 6 bots), one hand, one table | join → match → results | final-d | Reached results after 6:13. 55 actions accepted from the four real phones, none refused. Layout problems: none. |
| 12 players (2 real phones + 10 bots), three tables of four, one round | join → round → bell → final lap → results | final-d | Reached results after 6:31. 63 actions accepted from the two real phones, none refused. Layout problems: none. |
| 2 players, one hand | join → match → results → **Play again** → rematch → results; one phone reloaded mid-turn | final-c | First match 4:36, rematch 5:28; both reached results. 106 actions accepted, none refused. Layout problems: none. Reload: 7 cards before, 8 after, still in the hand. |
| 6 players, first to 200, one table | join → match → results | final-c | Reached results after 6:37. 163 actions accepted, none refused. Layout problems: none. |
| 8 players, two tables of four, Chaos preset, one round | join → round → bell → final lap → results; a phone reloaded at 60 s | final-c | Reached results after 7:04. 42 actions accepted, 1 refused (“Time’s up for this turn.” ×1). Layout problems: none. Reload: 8 cards before, 8 after, still in the hand. |
| 2 players, one hand | join → match → results → **Play again** → rematch → results; one phone reloaded mid-turn | final-b | First match 4:27, rematch 2:00; both reached results. 138 actions accepted, none refused. Layout problems: none. Reload: 5 cards before, 5 after, still in the hand. |
| 2 players, first to 200 | join → hands and intermissions → results | final-b | 5 hands with intermissions, results after 7:15. 308 actions accepted, 1 refused (“Too slow — that catch window already closed.” ×1). Layout problems: none. |
| 6 players, first to 200, one table, TV at 1920×1080 | join → match → results → **Play again** → rematch → results; a seventh phone joined 25 s into the first match | final-b | First match 4:07, rematch 9:23 with seven seats (Mika, Jonah, Priya, Teo, Wren, Sol, Latecomer); both reached results. 239 actions accepted, 1 refused (“Too slow — that catch window already closed.” ×1). Layout problems: none. During the first match the late phone showed the shell's "You are watching this round…" and held 0 cards. |
| 10 players (4 real phones + 6 bots), first to 200, one table | join → match → results → **Play again** → rematch → results | final-b | First match 8:04, rematch 24:45; both reached results and the rematch dealt with every score at 0. 218 actions accepted, 1 refused (“Too slow — that catch window already closed.” ×1) from the four real phones. Layout problems: none. |
| 8 players, two tables of four, Chaos preset, one round | join → round → bell → final lap → results; a phone reloaded at 60 s | final-b | Reached results after 6:50. 204 actions accepted, none refused. Layout problems: none. Reload: 6 cards before, 6 after, still in the hand. |
| 2 players, both hoarding to 23 cards | hands of 20+ cards at 320×568 and 390×844 | final-b | Hands grew to 27 cards; the match still finished (10:08). 474 actions accepted, none refused. Layout problems: none. |
| 2 players, one hand, `prefers-reduced-motion` on every page | join → match → results | final-b | Reached results after 1:25. 50 actions accepted, none refused. Layout problems: none. |

No run logged a console error or a page error. The driver's own misses (a tap on a card or button that had already moved on) are in each `stats.json` under `ui`; none of them reached the server. The first 10-player attempt on final-b finished its first match in 7:42 and started the rematch with ten seats and every score at 0, but the driver's own 850 s allowance ran out during the rematch; the row above is the second attempt with a longer allowance. Its rematch took 24:45 because the machine was at a load average of about 60 by then, where the four DOM-driven phones act far slower than a person (a median of 25 s between a phone's turns at a ten-seat table).

## Big rooms

Two real phones (390×844, 320×568), the rest socket bots, default settings (three six-minute rounds, tables of four), TV at 1280×720 plus a second display at 1920×1080.

On `ichi-final-c` (the final rules; the handed-over source differs from it by two CSS rules). The two matches ran at the same time on one server process, together with the small rooms above, while the machine's load average was 50 to 64 on 12 cores (other agents' work plus this pass's own typecheck and tests). The server was short of CPU time and delivered a median of 6 snapshots a second instead of 10, so these runs show that the matches complete correctly; the `ichi-final-b` table below is the better guide to pacing and cost:

| | 32 players (8 tables) | 64 players (16 tables) |
| --- | --- | --- |
| Match length | 19:48 (rounds ended at 6:31, 13:10) | 19:58 (rounds ended at 6:30, 13:15) |
| Bot actions accepted / refused | 1,780 / 7 (plus 115 from the two real phones, 0 refused) | 3,639 / 16 (plus 106 from the two real phones, 0 refused) |
| Hands ended by going out / at the bell | 22 / 21 | 36 / 39 |
| Wait between a bot's turns, median / 90th / max | 16 s / 29 s / 82 s | 16 s / 29 s / 117 s |
| Traffic to one phone while playing, median / 90th | 16 / 21 KiB/s | 21 / 28 KiB/s |
| Clipped plates or tiles, horizontal overflow | none | none |

Server process while both rooms and the small rooms played: 17% of one core at the median, 22% at the 90th percentile, 202 MB.

On `ichi-final-b`, one match at a time (the small-room runs shared the server; load average 5 to 35):

| | 32 players (8 tables) | 64 players (16 tables) |
| --- | --- | --- |
| Match length | 19:48 (rounds ended at 6:29, 13:07) | 19:49 (rounds ended at 6:29, 13:08) |
| Bot actions accepted / refused | 1,908 / 2 (plus 151 from the two real phones, 0 refused) | 3,887 / 8 (plus 152 from the two real phones, 0 refused) |
| Hands ended by going out / at the bell | 12 / 22 | 38 / 40 |
| Wait between a bot's turns, median / 90th / max | 15 s / 25 s / 104 s | 15 s / 26 s / 109 s |
| Traffic to one phone while playing, median / 90th | 24 / 26 KiB/s | 30 / 35 KiB/s |
| Server process CPU (median / 90th) and memory | 15% / 18% of one core, 199 MB | 24% / 29% of one core, 195 MB |
| Clipped plates or tiles, horizontal overflow | none | none |

Notes on these numbers:

- The longest waits are single cases: a table holding one of the two DOM-driven phones, or a table whose break between hands fell inside the wait. The 90th percentile is the fairer picture.
- Refused bot actions were all lost races: a catch or an Ichi! press after the window had closed, and once a catch that arrived after the hand had ended.
- For comparison the old build sent every phone 35–44 KiB/s at 2–10 players (its whole view in every snapshot; computed from its view sizes). One table now costs a phone about 5 KiB/s.
- With five-minute rounds (rehearsal build `ichi-a4`, 64 players) 31 hands ended by going out and 42 at the bell, which is why rounds are six minutes.
- In these matches about a quarter of a 64-player room finished on 0 points. The winner of a hand takes its whole pot, as at one table, so players who never win a hand share last place.

`tools/sim.ts` (rules only, simulated time, the same think times, three seeded matches a row; `10:5` is ten players at tables of five):

```
think 2500–7000 ms a turn, 3 seeded matches each, target 200, 7-card hands
players  tables  match     hands  out/bell  turn wait median/p90/max  KiB/s a phone (shared+own)  changes/s  server ms/frame  scorers
      2       1   16:15      5.0   5.0/0.0                5s / 10s / 24s                5.0 (0.6+4.4)       0.22             0.11     2/2
      4       1   15:06      3.3   3.3/0.0               15s / 23s / 48s                5.4 (0.7+4.7)       0.21             0.12     3/4
      6       1   12:38      2.0   2.0/0.0               26s / 37s / 80s                5.4 (0.7+4.7)       0.20             0.14     2/6
     10       1   13:30      1.0   1.0/0.0              46s / 73s / 138s                5.5 (0.9+4.6)       0.22             0.20     1/10
     10       2   19:35      9.3   4.3/5.0               20s / 30s / 66s              17.0 (2.4+14.6)       0.59             0.61     7/10
     11       3   19:27     16.3  10.3/6.0               13s / 21s / 64s              17.0 (2.8+14.1)       0.67             0.62     9/11
     16       4   19:45     20.3  10.0/10.3               15s / 24s / 57s              17.9 (3.7+14.2)       0.71             0.91    12/16
     32       8   19:42     44.3  24.7/19.7               15s / 23s / 60s              21.0 (6.6+14.3)       0.82             1.73    26/32
     64      16   19:46     85.0  44.3/40.7               15s / 23s / 62s             27.3 (13.0+14.4)       0.92             3.71    49/64
```

## Before and after

Screenshots that were looked at, in `output/ichi-pass/`:

| What | Before (`before/`) | After (`final-b/`, same browser code as the handed-over source) |
| --- | --- | --- |
| TV, 2 players mid-hand | `p2/tv-mid.png` | `p2/tv-mid.png` |
| TV, Ichi race | `p2/tv-window.png` | `p2/tv-window.png` |
| TV, 10 players | `p10/tv-mid.png` | `p10/tv-mid.png` |
| TV, results at 10 | `p10/tv-results.png` | `p10/tv-results.png` |
| TV, hand tally | `p2/tv-intermission.png` | `p2-200/tv-intermission.png` |
| Phone 390×844, your turn | `p2/phone-390x844-turn.png` | `p2/phone-390x844-turn.png` |
| Phone 320×568, 20+ cards | `hoard/phone-320x568-hand20.png` | `hoard20/phone-320x568-hand20.png` |

New screens with no "before", in `final-b/` and again in `final-c/` (the two fixed spots are `final-d/p10/tv-stack.png` and `final-d/p12-parlor/tv-mid.png`): the parlor TV at 32 and 64 players (`p32/tv-mid.png`, `p64/tv-mid.png`, `p64/tv1080/playing.png`), the seating chart (`p64/tv1080/seating.png`), the final lap (`p64/tv1080/bell.png`), the match-over hold (`p64/tv1080/finale.png`), results at 64 on TV at both sizes and on a phone, the lobby at 64 (`p64/tv-ready.png`), and the phone's seating, last-turn and Gift screens.

## Static checks on the final source

- `node --import tsx --test packages/games/ichi/tests/*.test.ts`: **40 of 40** pass (24 before this pass).
- With `tests/ichi-contract.test.ts` and `tests/registry-contract.test.ts`: **70 of 70**.
- `npm run typecheck`: exit 0, no errors.
- `npm run lint`: exit 0, no warning in `packages/games/ichi`, as before this pass. The 6,550 warnings it prints are elsewhere: 6,548 in vendored Inkwave files and 2 in Hijinks.
- `npm run test:platform`: **120 tests, 119 pass, 0 fail, 1 skipped**.

These ran on the source of `ichi-final-c`. The only change after them is the two CSS rules of `ichi-final-d`, which none of these commands read.

Two earlier runs of these commands did not come back clean, for reasons outside Ichi. One `npm run typecheck` reported a single error in `packages/games/trolley-court/src/client.tsx`, a file another agent was editing at the time; it was gone on the next run. One `npm run test:platform`, run while the machine's load average was about 60, failed two timing tests (a 30 ms heartbeat timeout and the 64-seat reconnect test); both passed when run again, and the suite has been clean on every run since.

## Remaining limits

- Everything ran in headless Chromium on one machine. No physical phones, TVs or Safari, no human pacing, nobody at couch distance, and nobody has listened to the new bell sound.
- 64 real devices on one Wi-Fi network were not tested; bots are sockets on the same host.
- The pacing figures come from bots that think 2.5–7 s a turn. Slower or faster people change how many hands a round holds, not how the round works.
- Results at 64 players on a 1280×720 TV use about 11 px type. Every name is there, but it is small from a couch; at 1080p it is about 17 px.
- In a room of nine or more tables the floor rail shows each seat as a colored dot and a count, not a name, and with four to eight tables (or tables of five or six) it shortens long names. Full names are on the stage for the featured table, on the seating chart and on each phone.
- A splash ("Coral!", "Stack! +4") is up for 1.8 s and, as before, covers the line under the pile and part of the bottom seat's hand while it shows.
- A phone that joins mid-match is held by the platform shell until the next lobby, so Ichi's own "You're watching" screen was not reached.
- At one big table the first hand can pass 200 points (usually at ten players, sometimes at six), so the default match can be a single hand. The old build scored the same way; tables of four or five avoid it.
- More than 20 cards at 320 px reach the 13 px floor and the hand scrolls sideways a little, as before.
- On a 320×568 phone the Seven-O and Gift lists fit three players; a table of five or more scrolls that list.
- The reconnect notice after a network drop is covered by the reload path only.

## History

The 2026-09-23 acceptance of the earlier rebuild (builds `ichi-qa-a` to `ichi-qa-k`, twelve critique items) is in this file's git history. Its open rules questions are unchanged: whether a +4 answering a stack should count as a bluff, and a disconnected player keeping a 5 s turn.
