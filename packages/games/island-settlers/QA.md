# Island Settlers: verification

Deep pass, 22–23 November 2026: the archipelago (rooms up to 64), the wire format, quick start, the horn
and the graphics and animation pass. This replaces the September v2 report; what it measured on one
island of four still holds (the rules of one island did not change) but none of it was rerun as such.

Everything below was run headless on a shared, heavily loaded development box (load average 13–29 on 12
cores, software WebGL). No physical phone or TV was used.

## Builds

All browser runs used isolated builds made from a private copy of the committed tree (platform
`e018700`, game-modules `23ec774`) with only this game's folder and its catalogue lines laid over,
because other agents' uncommitted work in the shared checkout did not build.

| Build | Contents | Used for |
| --- | --- | --- |
| `settlers-pass-base` | the game as it was | "before" screenshots, a 4-seat baseline game |
| `settlers-pass-final` | the whole pass up to 22 Nov 22:20 | nine full rooms (first table below) |
| `settlers-pass-final2` | + compact results, held seat views, results layout and ticker fixes | trade, 64 and 32 again, 3 and 10 again |
| `settlers-pass-final3` | + the cut wipe under the HUD, standings names, cheaper size check. **The source as delivered**, except one line of phone text added afterwards (the game-over line names the island in an archipelago), which was checked in the fixture preview at 320×568 and by typecheck and the UI tests, not in a room | trade, a six-player archipelago, 64, six seats |

## Automated checks (from the platform root)

| Check | Result |
| --- | --- |
| `node --import tsx --test packages/games/island-settlers/tests/all.test.ts` | 435 tests: 431 pass, 4 fail (26 min at load average 21–29). All four are one timing budget, see below |
| `node --import tsx --test packages/games/island-settlers/tests/league/*.test.ts` | 20 pass, 0 fail (188 s) |
| `npm run typecheck` (whole repository, on the final source) | exit 0, 0 errors (3 min 26 s) |
| `npm run lint` | exit 0; no diagnostic in this game's files |
| `tests/ui/*.test.ts` after the last text change | 86 pass, 0 fail |
| `npm run test:platform` | 122 tests: 121 pass, 1 skipped, 0 fail (34 s) |

The four failures are `tests/board/matrix.test.ts` "generation p95 < 30 ms of CPU time" on New Shores
7–10 seats (39.4 ms), Four Islands 7–10 (30.0), Explorers 5–6 (31.1) and 7–10 (97.8), measured while the
platform suite and other agents' browser runs shared the machine. Run alone straight afterwards (load
average 18–25) that file failed two budgets on this tree (33.7 and 34.1 ms) and three on the untouched
baseline at `/home/secondDevBox/partyplace-baseline` (41.7, 45.9 and 38.9 ms). Board generation was not
changed in this pass (`engine/board/graph.ts` moved to `src/graph.ts` unchanged). They are load noise.
435 is the September suite's 415 plus the 20 new league tests.

`tests/league/` is new (20 tests): dealing at every size from 1 to 64, the shared rolls, the Deliveries
reroll made once for the room, nothing playable before the dice, the horn (room-wide and on one island),
idle seats done at once, the room's winner and its tie-break, seat views whole twice then short and `sync`,
the one cached field, full games at 11, 32 and 64 seats, the TV director, the board wire on every map
and size, quick start, every map and expansion in an archipelago, the panel and results at every size.
The full games assert privacy on every sampled frame (no hand, inbox, rate, command, build option or
`can` flag in the shared view; a seat's snapshot holds only its own private view and its own island;
the rail never shows a hidden point before the finale), that no move chosen on a current view is
refused, and that the largest message any phone would be sent stays under 32 KiB.

## Real rooms, build `settlers-pass-final`

One real TV page (software WebGL) and two real phone pages (390×844 and 320×568, 16-character names)
that press the real UI (`tools/qa-run.mjs` over `tests/browser/driver.mjs`: the CPU brain picks each
move from the phone's own view, the driver taps it). Other seats are the game's CPUs or socket bots
(`scripts/qa/room-bots.ts` with `tools/room-bot.mjs`) that think 2.5–7 s a move (0.6–1.5 s in the
10-seat and 6-seat rooms), one in ten never tapping Done. Every run went lobby → settings → start →
full game → finale → results; "replay" means Play again started a fresh game with new boards.

| Room | TV | Run | Real-phone moves | Refused | Replay | A phone receives | Largest message |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3 seats, Standard, 1 CPU, phone reloaded mid-game | 1280×720 | 7.0 min, 23 rounds | 212 | 0 | fresh | not recorded | not recorded |
| 3 seats, Connect, 1 CPU | 1920×1080 | 10.1 min, 59 rounds | 418 | 0 | fresh | 18–19 KiB/s | 16.6 kB |
| 6 seats, Standard, 4 bots | 1920×1080 | 4.3 min, 5 rounds | 65 | 0 | fresh | 21 KiB/s | 22.6 kB |
| 6 seats, Connect, 4 bots | 1280×720 | 8.2 min, 47 rounds | 364 | 0 | fresh | 48–51 KiB/s | 24.8 kB |
| 10 seats, Standard, 8 bots | 1280×720 | 7.6 min, 7 rounds | 143 | 0 | fresh | 45–47 KiB/s | 35.9 kB |
| 10 seats, Connect, 8 bots (the horn) | 1280×720 | 5.4 min, 21 rounds | 151 | 0 | fresh | 60–61 KiB/s | 27.2 kB |
| 6 players, Archipelago by the host's choice, quick start: 2 islands, 2 CPUs | 1280×720 | 4.7 min, 14 rounds | 84 | 0 | fresh | 35 KiB/s | 27.1 kB |
| 32 players: 8 islands | 1920×1080 | 14.0 min, 17 rounds | 128 | 0 | not tried | 26–27 KiB/s | 35.4 kB |
| 64 players: 16 islands | 1280×720 | 7.8 min, 9 rounds | 79 | 0 | not tried | 29–30 KiB/s | 43.6 kB |

No page error, console error or server error in any run; no move the driver could not find in the UI.
The 30 and 62 bots sent 2,230 and 2,447 moves with none refused and never needed `sync`; in the
one-island rooms the bots had 8 of 2,084 moves refused, all a move on something that had just closed
(an offer answered or withdrawn, a partner who had left the round). Server CPU
for the nine rooms together was 7 min 16 s over 71 minutes; the 64-player room used 98 s of CPU in
8.5 minutes (0.19 of a core).

The short six-seat and ten-seat Standard games (5 and 7 rounds to 8 points) are bots trading freely with
fast thinking, not a human pace. The 64-player game ended in 9 rounds because the best of 64 players
got there quickly (3 cities, 2 settlements and Longest Road); the second run below took 14.

## Real rooms, build `settlers-pass-final2`

The first table's largest messages (36–44 kB) led to three changes (ENGINE §21.5): the room standings no
longer travel twice, a full seat view waits a snapshot when the shared view changed with it, and an
archipelago's results frame no longer carries the room again. Rerun with a phone reloaded mid-game:

| Room | Run | Real-phone moves | Refused | Replay | A phone receives | Largest message | Bots: wait with nothing to do (median / 90th / worst) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 64 players: 16 islands, 1280×720 | 12.8 min, 14 rounds | 120 | 1 | not tried | 30–31 KiB/s | 28.4 kB | 26 s / 42 s / 92 s |
| 32 players: 8 islands, 1920×1080 | 16.1 min, 21 rounds | 165 | 1 | fresh, at 32 | 29–30 KiB/s | 28.2 kB | 22 s / 37 s / 63 s |
| 3 seats, Standard, 1 CPU, 1280×720 | 7.7 min, 17 rounds | 185 | 1 | fresh | 13 KiB/s | 16.6 kB | — |
| 10 seats, Connect, 8 bots (think 0.6–1.5 s), 1280×720 | 14.6 min, 36 rounds | 308 | 1 | fresh | 48 KiB/s | 30.3 kB | 16 s / 21 s / 30 s |

- Every refusal on a real phone, one in each of these four rooms, was the same thing: Decline pressed on
  an offer its sender had withdrawn a moment before ("That offer is no longer open"). The phone shows
  that line and carries on. The first table had none in 463 answers. In an archipelago a held view (up
  to half a second) makes it likelier; in the two one-island rooms nothing on that path changed, so it
  is put down to slower page rendering under the load at the time. That is a belief, not a finding.
- The bots: 4,176 moves at 64 with 3 refused, 2,774 at 32 with 3 refused, 1,286 at ten seats with 5
  refused, all of the same kind (an offer just closed, a spot just taken, a move after the round or the
  game had ended). No `sync` was needed.
- In all three rooms with a reload the phone got its island and hand back by itself (2 `sync` requests each).
- At 32, Play again dealt a new archipelago and started a fresh game. "Run" in both tables is the
  whole run from the lobby to the results (and the replay's start); for 32 and 64 it is the game itself,
  first snapshot to last, from the bots' record.
- First run of the 64 (build `final`): waits 25 s / 39 s / 51 s; of the 32: 24 s / 40 s / 90 s.
- Server CPU: 4 min 8 s for the 64-player room's 13.9 minutes (0.30 of a core), 2 min 41 s for the
  32-player room's 17.4 minutes (0.15); 215 MB resident. The size check weighed views again on every
  snapshot in this build; `final3` weighs each once.

## Real rooms, build `settlers-pass-final3` (the source as delivered)

| Room | Run | Real-phone moves | Refused | Replay | A phone receives | Largest message | Bots: wait with nothing to do (median / 90th / worst) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 64 players: 16 islands, phone reloaded, 1280×720 | 16.6 min, 21 rounds | 176 | 1 | not tried | 36–37 KiB/s | 26.2 kB | 23 s / 39 s / 116 s |
| 6 players, Archipelago by choice, quick start, 2 islands, phone reloaded, 1280×720 | 8.5 min, 20 rounds | 140 | 0 | fresh | 36–37 KiB/s | 27.5 kB | 15 s / 24 s / 34 s (bots think 0.6–1.5 s) |
| 6 seats, Standard, 4 bots (think 0.6–1.5 s), 1920×1080 | 10.5 min, 11 rounds | 157 | 0 | fresh | 20–21 KiB/s | 26.0 kB | 8 s / 23 s / 39 s |

The 62 bots sent 5,673 moves with 2 refused (an offer just closed, a partner just out of the round) and
never needed `sync`; the reloaded phones recovered by themselves. The one refusal on a real phone was
again Decline on an offer withdrawn a moment before. Server CPU for the 64-player room: 4 min 1 s in
17.4 minutes (0.23 of a core), 42 ms per bot move against 59 ms on `final2` and 40 ms on `final`.
`final3/league64/tv-10-round-12.png` happens to catch a cut to another island: the wipe covers the board
and the banner, island list, ticker and seat rail stay up. `final3/league64/tv-21-results.png`: all 64
names whole.

**Two phones trading with each other** (`tools/qa-trade.mjs`, 3 seats, Connect, quick start): one phone
composes "1 wool for 1 ore" to the other by name, the other taps Accept, both hands change and the TV
log reads "Ana Longname1234 gave 1 wool to Bo Navigator5678 for 1 ore". Passed on `final` (rerun after
the fix below), `final2` and `final3`. It failed twice in the first matrix: the script, not the
game. A Connect partner list only holds seats still in the round; when the CPU tapped Done the last
partner's pill became fixed (pressed and disabled) and the driver waited for it to become clickable.
The driver now asks the page instead of the view it started with.

## Screenshots looked at

Under `output/settlers-pass/` in the parent repository (ignored by git):

- Before and after, TV 1920×1080 and 1280×720 and phone 320×568 and 390×844: `before/` against `pv/`
  (fixture previews of the same position) and the room runs. After: an animated sea with shallows and
  crests, real shadows, the island's shadow on the water, mottled tile tops, denser and larger terrain
  props; `pv/g3-throw-*` the big dice landing on the board; `pv/g3-finale_*` the winner's card and
  confetti; `pv/g4-phone*`, `pv/g6-phone-wait*` the phone.
- Every run folder (`final/`, `final2/`, `final3/`) keeps its summary, the bots' record and the same
  moments: an offer on the phone, the horn banner on the TV and the coral strip on the phone, a round
  mid-game on both, the phone after its reload, the finale and the results on both, the replay's first
  screen. `final3/league64/` also keeps the lobby with 64 names and the settings sheet. The other
  screenshots the runs took (setup, first roll, a seven, the robber, building, more rounds) were deleted
  to keep the folder small; of those only some rounds had been looked at.
- `final2/league64/tv-09-horn.png`: sixteen islands in the rail at 720p with the room's leaders, the
  two-line ticker and the payout strip clear of each other. `final2/league64/tv-21-results.png` and
  `phone-21-results.png`: 64 names in four columns, the champion's island under the name.
- `final2/trade/`: the offer on both phones and the trade on the TV.

Seen and left: when a round ends within about two seconds of the horn, the horn banner is still up as
the next round's dice land on it (`final3/arch6/tv-10-round-09.png`); it clears a moment later.

Defects found in these screenshots and fixed: the champion's island line was hidden under the title's
shadow on the room results; with an archipelago's panel in the left rail the event ticker grew over the
payout strip (worst with sixteen islands at 720p); at 320 px the tab badges sat on the last letter of
"Build" and "Trade" (also in the original game); long names were cut in the standings while the island
name beside them was not; a cut to another island wiped the banner and the island list for a fifth of
a second with the board.

## Pacing in simulation (`tools/sim.ts`)

Whole games against the room rules in simulated time, seats thinking 2.5–7 s a move, one in ten never
tapping Done, target 10 (rerun on the final source; the README has the table). At 32: 17 minutes, 20
rounds, a wait of 23 s median, 38 s at the 90th percentile and 74 s at worst, 24 KiB/s to a phone,
largest message 28.7 kB, rules 4.4 ms a tick. At 64: 14 minutes, 18 rounds, 24 s / 39 s / 112 s,
29 KiB/s, 28.7 kB, 7.7 ms a tick. A phone has something to do 39–41% of the time, watches the shared
dice 18–19% and waits for the round to close 36–37% (four seats, Standard: 29%, 11%, 56%).

## Not verified

- No physical iOS or Android phone, no real TV, no real network: emulated viewports on one machine.
  Frame rates were not measured (software WebGL here says nothing about a TV or a phone).
- No human played. Bots trade more readily and decide faster or slower than people; game lengths and
  waits are bot figures. Whether three shared rolls a round feel right to people is untested.
- An archipelago was played in real rooms on the Base map only. Every map and expansion in an
  archipelago is covered by `tests/league/wire.test.ts` for a few rounds, not to the end, and not in a
  browser.
- 11–31 and 33–63 players: dealing and island plans are tested at every size, full games in tests at 11,
  32 and 64, real rooms at 6 (by choice), 12 (an earlier build), 32 and 64.
- The seated host (PersonalView) in an archipelago, and landscape phones, were not driven in a browser
  in this pass (unit and render tests only).
- Reduced motion: implemented for every new animation, not looked at in a browser.
- The results screen with 64 names was looked at on 1280×720 and on phones; the island winners and
  awards below the standings need a scroll at 720p.
- Largest message: 28.4 kB or less in every archipelago room on `final2` and `final3`. A one-island
  room of ten still sends more on a snapshot where the island and a private view change together: 36 kB
  seen in a real room, 45 kB in simulation at the very end (the original game's frames there were
  larger). The platform does not limit outgoing messages; nothing was done about it.
- While the results screen is up the platform repeats the outcome in every frame (7.4 kB at 64 seats,
  ten times a second, for every game); that is platform behaviour and was left alone.
- Deferred rules gaps are listed in [EXPANSIONS.md](EXPANSIONS.md) and ENGINE §19.
