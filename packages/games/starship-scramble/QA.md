# Starship Scramble v2 — QA

## Big-fleet and graphics pass (2026-11-22)

Final build `ss-pass-13` (isolated, built 2026-11-22T16:35:20Z, client index SHA-256 `78e9fc068ddf95ea11a892a902784315206f237bbe1283c0f7484997ddc6b110`), served on 127.0.0.1:4431; headless Chromium (software rendering) driven through real UI clicks, no state injection. The build was made from this game's working tree against the committed state of every other game, because another game's edits in progress broke the shared build at the time. Everything under "Real-room flows", "Measurements", "TV layout at full content" and "Phone layout" ran on this build unless a line says otherwise. Evidence (local, ignored): `output/starship-pass/` in the platform checkout: `before/` (the untouched game on build `ss-pass-base`) and `final/` (this build; each room's `report.json` holds its screens, timings, traffic and server CPU). Owned servers, browsers and bots are closed and the builds deleted.

### Playtest of the untouched game, ranked

Played solo on the TV page and with a TV plus two phones before changing anything.

1. Four captains is the cap; a bigger room cannot play.
2. The first battle punishes newcomers: weapons do nothing until aimed, fires rage unless crew are sent, and the default difficulty is Captain. Two passive captains lost the fleet at their third beacon.
3. A jump has no animation: the vote ends and the next screen is simply there.
4. Events are a small card on an empty, dark backdrop; nothing shows where the fleet is or what it met.
5. The TV hangar bay stays empty until a phone changes hull; on the host's console the hangar's stat boxes overlap and the paint swatches are clipped; on a landscape phone Launch is below the fold.
6. A single salvage card stretches the full height of the TV; store cards are mostly empty space.
7. The battle itself is good, but flat: no light from fires, no sign of a hull in trouble, a static backdrop.
8. Results are a plain table.
9. Salvage and store wait forever for the last captain.

All nine were addressed (see README and DESIGN); 7 is polish rather than a rebuild.

A second look at every TV screen at its fullest, on the builds of this pass, found six more, all fixed before the final build:

1. A full trading post for four captains (12 offers) ran its third row of cards off the bottom of the TV; with eight offers the second line of a description hid behind the stat chips; the docked fleet peeked out from behind the cards. (The untouched game overlapped the text in the same case instead.)
2. The new debrief was taller than a 720p TV: two of four captains' rows sat under the Play again bar, and at 64 captains the last wings did at 1080p too.
3. With five to eight captains the debrief drew each hull thumbnail three times too large.
4. On the host's console the new Damage control switch was below the crew panel's fold with three crew.
5. In a wing's shelf on the TV a long item name pushed the buyer and the price past the card's edge.
6. With the ten new fleet events in the pool, four scripted captains won 7 of 30 Captain long runs instead of 13; the events now appear only in fleets of several wings.

### Real-room flows on the final build

Seven rooms on `ss-pass-13`, each from the launcher through join, lobby settings, the run, the ending, results and **Play again** back to the lobby with every seat kept. No page error or console error in any of them. The real pages played the way a newcomer might: vote, pick an event choice (a fight when one is offered), claim, buy once, ready up, and in a battle press Fire when it lights; they never repair, upgrade or move crew.

| Room | Pages | Run | Ending | Seen on the way | Debrief at 1280×720: last row / left column / Play again |
| --- | --- | --- | --- | --- | --- |
| Solo | host playing on the shared screen, 1920×1080 | Cadet, short | **Victory**, 5.9 min | 9 jump votes, 8 events, 2 battles, 2 stores, 3 claims, 2 purchases, the Flagship (3.6 min), replay 1/64 | 337 / 360 / 412 |
| Solo, Captain | host playing, 1280×720 | Captain, short | **Defeat** in the second battle, 3.8 min | 1 battle won, a store, replay | 337 / 360 / 412 |
| Two captains | TV 1280×720 + 2 phones 844×390 | Cadet, short | **Defeat** in the second battle, 3.6 min | both captains in the same battles (their volleys land on one squad), 12 votes, 10 event choices, 2 stores, replay 2/64 | 449 / 526 / 578 |
| Four captains | TV 1280×720 + 4 phones | Cadet, short | **Victory**, 4.5 min | 2 battles and the Flagship (107 s) with four captains against one squad, a 10-offer store, 22 claims, 8 purchases, replay 4/64 | 508 / 526 / 578 |
| Eight, host playing | host on the shared screen, 1920×1080 + 7 scripted socket captains | Cadet, short | **Victory**, 3.7 min | two wings; the host sees their own wing's battle with the fleet's strength above it; 1 battle, the Flagship, replay 8/64 | 571 / 607 / 645 |
| 32 | TV 1920×1080 + 1 phone + 31 scripted socket captains | Cadet, short | **Victory**, 3.7 min | eight wings; a fleet battle (68 s) and the Flagship (89 s) on the broadcast, per-wing salvage and store shelves, replay 32/64 | 573 / 624 / 645 |
| 64 | TV 1920×1080 + 1 phone + 63 scripted socket captains | Cadet, short | **Victory**, 6.6 min | sixteen wings; a fleet battle (70 s) and the Flagship (127 s), three stores, replay 64/64 | 606 / 624 / 645 |

The scripted socket captains (`tools/room-bot.ts`) are the test suite's captains reading the same snapshots a phone gets; they answer within one snapshot, so these run lengths are a floor, not what a room of people will take. Most of these rooms also ran on five earlier builds of this pass (`ss-pass-8` to `ss-pass-12`) while the fixes listed above went in; across them the real pages lost Cadet runs alone (at the Flagship), as two (between the second and the fourth battle) and as four (in the fourth battle), and won them at each of those sizes too. After `ss-pass-10` only TV styles and a few lines of TV markup changed (the store shelf and the debrief).

### Measurements

Real rooms on `ss-pass-13` (server CPU is the room process's own clock ticks over 5 s windows, as a share of one core; traffic is what each scripted socket captain received, uncompressed). The machine had 12 cores and a load average of 26–38 from other work throughout, so these are pessimistic.

| Room | Start to first screen | Server CPU in battle (mean / peak) | Server CPU in menus (mean / peak) | Per captain, mean / peak | Snapshots a second, mean (range) | Server memory |
| --- | --- | --- | --- | --- | --- | --- |
| Solo | 1.9 s | 14% / 49% | 9% / 12% | | | 201 MB |
| Two captains | 2.5 s | 7% / 12% | 6% / 8% | | | 204 MB |
| Four captains | 2.9 s | 7% / 14% | 8% / 11% | | | 186 MB |
| Eight | 2.3 s | 15% / 32% | 9% / 13% | 74 / 97 KiB/s | 11.4 (7.9–12.9) | 218 MB |
| 32 | 4.3 s | 28% / 38% | 25% / 36% | 96 / 156 KiB/s | 12.6 (6.5–16.1) | 214 MB |
| 64 | 5.2 s | 56% / 70% | 39% / 67% | 122 / 182 KiB/s | 15.1 (7.3–18.6) | 218 MB |

- The room sends a fresh snapshot to every seat whenever any seat's order is accepted, on top of its ten a second. With 63 scripted captains that is 15 a second on average and up to 19 (22 on an earlier build); it is why the server works nearly as hard in a 64-seat menu as in a battle, and it is what gives out first (see DESIGN, "What a big room costs"). The same rooms on `ss-pass-10` to `ss-pass-12`, which share this build's server, measured within a few points of these (64 captains: 54% / 78% and 54% / 74% in battle; 137 and 126 KiB/s).
- Rules API, scripted captains (`SS_BALANCE=fleet` rows and one Long run each on Cadet and Captain at 64): the uncached public part of a snapshot peaks at 3.4 KB at 32 captains and 6.2 KB at 64; a captain's private part at 11.4 KB; the save at 84 KB (32, standard) and 175 KB (64, long) of the room's 256 KiB; a battle tick (100 ms of battle) costs 3–7 ms at 64 on the loaded machine.
- Building a 64-captain snapshot: public part 3 ms, all 64 private parts 6.5 ms including the JSON, measured in isolation on the same machine. Before wingmates shared one built engagement the private parts cost 67 ms, and the same 64-seat room on `ss-pass-8` ran its battles at 67% of a core (peak 85%) while falling to 8.5 snapshots a second.
- Four captains, one wing: about 10 KB a snapshot uncached (20–28 KB before this pass).
- Run length with scripted captains at 25 s a decision screen: short 14 min at 8, 32 and 64 captains; standard 47–48 min. Balance: README.

### TV layout at full content

Measured from the TV page on `ss-pass-13`, resizing it to each size.

- **Trading post, four captains, a full shelf (12 offers)**, reached by four phone pages voting for it, at 1280×720 and 1920×1080: twelve cards in three rows, every price on screen, no card below the stage, no clipped text; the scenery steps aside. Two captains (8 offers, two rows with two-line descriptions) were checked the same way on `ss-pass-12`; the store's styles did not change after it.
- **Debrief.** Bottom of the table / bottom of the left column / top of the Play again bar, in px, at 1280×720, 1366×768 and 1920×1080:

| Fleet | 1280×720 | 1366×768 | 1920×1080 |
| --- | --- | --- | --- |
| 4 captains, worst case | 553 / 607 / 645 | 587 / 641 / 693 | 598 / 654 / 707 |
| 8 captains (a row each) | 579 / 624 / 645 | 616 / 660 / 693 | 623 / 673 / 727 |
| 32 captains (8 wing rows) | 573 / 624 / 645 | 609 / 660 / 693 | 619 / 673 / 727 |
| 64 captains (16 wing rows) | 606 / 624 / 645 | 641 / 660 / 693 | 651 / 673 / 727 |

  These four pages came from sessions ended from the room menu just after launch (real rooms, real results pages), so their own numbers were small. To fill them, five commendations with wing chips were written into each page, and for four captains also 16-character names, wrecked ships and a starred three-digit number in every column. That is page editing for a layout test, not gameplay. The played rooms' own debriefs at 1280×720 are in the flows table above.

### Phone layout

One emulated phone (touch, device pixel ratio 1), measured from the page at 320×568, 390×844, 568×320, 667×375, 844×390 and 932×430: the hangar, the map, an event, a battle and the salvage table in a one-captain room, and a battle in a six-captain, two-wing room. At every size: no sideways overflow, no control past the right edge, no enabled control under 44 px, and Launch in view on arrival. In a battle an upright phone shows the platform's turn-sideways card, as before. All of that ran on `ss-pass-13`. The two-wing hangar (upright sizes only; the crowd timer launches the fleet within seconds of five idle captains readying) and a two-wing event were measured the same way on `ss-pass-10`; the phone's code and styles did not change after it. One thing to know: at 568×320 with three crew, and at 667×375 with four, the Damage control switch sits below the visible part of the crew list and needs a scroll. Screenshots: `final/phone/`.

### Checks

Run from the platform checkout on the final code (2026-11-22), on a machine other agents were loading heavily:

- Game tests (`node --import tsx --test packages/games/starship-scramble/tests/*.test.ts`): 135 tests, 111 pass, 0 fail, 24 skipped (the opt-in balance sweeps: 12 for one to four captains, 12 for fleets). Before the pass: 104 tests, 92 pass, 12 skipped. One earlier run in this pass failed `a 4v4 battle with ~30 crew steps in well under 0.3 ms` at 0.39 ms while three sweeps were running; alone it measures 0.09–0.10 ms, the same as the untouched game (0.09). That test is a time budget and the only failure seen.
- `SS_BALANCE=1` (30 seeds a row): 12 of 12 rows inside their windows (README Balance). The Captain rows are the untouched game's win rates (37 / 50 / 40 / 43% for one and four captains on standard and long): the ship's computer and the other rule changes are neutral for scripted captains who aim for themselves, and the new fleet events are kept out of single-wing rooms because they were not (four captains won 7 of 30 Captain long runs with them in the pool, 13 without).
- `SS_BALANCE=fleet`: 12 of 12 rows inside their windows (README Balance, second table): fleets of 8, 32 and 64 with everyone playing, with one captain in two giving battle orders and with nobody giving any. Both sweeps ran on the final rules; only TV styles and markup changed after them.
- `npm run typecheck`: clean on the final code. A run an hour earlier reported 77 errors, every one in Inkwave (another agent's edits in progress at that moment), none here.
- `npm run lint`: 0 errors; 6554 warnings, none in this game (other games' folders, mostly Inkwave's vendored three.js seen twice through the symlink).
- `npm run test:platform`: 122 tests, 121 pass, 0 fail, 1 skipped (121 tests earlier in the day; another agent added one). It includes `tests/starship-room.test.ts` (two phones launch, vote, jump, save and reload into new seats through a real room server) and the 1- and 64-player projection contract tests.
- The full `npm test` was not run: no shared code changed.

### Not verified

Physical phones, Safari/iOS, a real TV at viewing distance, audio by ear, a real room of people (pacing, how readable sixteen tiles are from a sofa, whether wings find each other), Wi-Fi with dozens of devices, and frame rates (rendering here is software). The 32- and 64-captain rooms were one real TV page, one real phone page and scripted socket captains; the scripted captains play well and never dawdle, so human runs will be slower and lose more. Standard and Long runs were played only through the rules API, not in a browser. A host playing on the shared screen in a fleet of several wings sees their own wing's battle there instead of the broadcast; that was run at eight captains, not at 32 or 64. Cadet with a big fleet was never lost by scripted captains, even ones who give no orders, so a big-fleet defeat was seen only through the rules API on Captain. How many orders a room of people sends a second, which sets the snapshot rate and so the server load and the traffic, is a guess until a real room plays. Save → load through the room menu in a big fleet was covered by tests (`wire-assist.test.ts`, the platform room test), not a browser flow.

## Earlier QA (history)

The sections below describe builds from September 2026, before this pass. Their numbers (snapshot sizes, test counts, Cadet tuning) are superseded by the section above.

Current build `ss-root-4` (2026-09-24T16:06:49Z, `qa:false`), client index SHA-256 `862a70853f93f812f0a8226723b0098b7f7668e6610fa267dcf8007495ab1ed4`. Evidence (local, ignored): `output/ss-dev/root/shots/` in the platform checkout. Isolated port 4532, headless Chromium driven through real UI clicks (no state injection). Owned servers and browsers are closed.

## Longer runs update (2026-09-28)

Build `ss-long-2` (isolated, port 4541, headless Chromium, real UI clicks; owned server and browsers closed). Evidence (local, ignored): `output/ss-dev/qa-long/` in the platform checkout.

- Lobby: Settings shows the Run length select; Long applied through the real dialog.
- TV host (watching) + 4 phones at 844×390 with 16-character names: join, ready, hangar, launch into a Long run (Sector 1 of 5). Dense 11-column map with every new beacon kind, wormhole arcs and named exits at 1280×720 and 1920×1080. All four phones voted through the jump list and the fleet jumped into an event.
- Phone map at 844×390, 932×430, 568×320, 390×844 and 320×568: no horizontal overflow; every jump button at least 44 px.
- Route choice: a real save exported by the scripted captains one jump before the Rustbelt exits, loaded through Room menu → Load world → Replace world. The TV showed both route cards, the phones showed "Exit to …" buttons with lanes; the fleet voted into Glasswater Drift (new map and backdrop), played two events and started a battle.
- Choir battle: a scripted save mid-fight against a Cantor and two Shards, loaded the same way; TV at 1280×720 and 1920×1080 and the phone battle view. Cloaking, beams, Lumen crew and the painted crystal hulls render; no console errors in any flow.
- Checks: `npx tsc --noEmit` and `npx oxlint` clean; game tests 92 pass (12 balance sweeps pass with `SS_BALANCE=1`, see README); platform `tests/starship-room.test.ts`, `tests/registry-contract.test.ts` and `tests/catalog.test.ts` pass.
- Limits: a full human-played Standard or Long run was not played in the browser (the scripted captains play complete runs through the rules API); Flagship battles with four upgraded captains and two escorts can reach ~25 KB per snapshot (under the 32 KB cap, over the 24 KB target); physical phones and human pacing are unverified.

## Checks

- `npx tsc --noEmit`, `npx oxlint game-modules/packages/games/starship-scramble`: clean.
- Game tests: 88 pass, 10 balance sweeps skipped unless `SS_BALANCE=1` (see README Balance).
- Platform tests: 110 (109 pass, 1 packaged-app test skipped), including `tests/registry-contract.test.ts` (1 and 4 players) and `tests/starship-room.test.ts` (real room: launch, vote, jump, save, reload into new seats).

## Real-room flows

| Flow | Roster / viewports | Result |
| --- | --- | --- |
| Cadet · short, full run | TV 1920×1080 + 4 phones 844×390 (Wayfarer, Lancer, Corsair, Halcyon; one custom name) | Hangar → 8 jumps → events, 4 battles, loot, store, upgrades → Flagship → **Victory** screen. 0 console errors. |
| Same, earlier builds | 4 phones | Two full runs to **Defeat** at the Flagship (led to the Cadet boss softening below); Play again returned all 4 seats to the lobby. |
| Reconnect | 4 phones | Reloading a phone mid-battle restored its captain into combat. |
| Solo on one screen | PersonalView 1920×1080 | Hangar → map vote in console → hostile event → battle; mouse aiming, keys 1/Space/F, crew moved and repaired. |
| Phone extremes | 568×320 and 932×430 in battle | No document overflow; no enabled control under 44 px. |

The scripted phone bot aims every weapon at enemy shields, fires volleys, votes, claims loot and buys upgrades; it does not manage crew or teleport, so it approximates a new table.

## Fixes from this QA

Map toast overlapped the legend (moved and auto-fades, also under reduced motion); phone menus kept the previous screen's scroll; TV copy said "on your phones" in solo; TV screens overflowed beside the solo console (container-relative sizing); phone map crosshair icons were erased by a link-line CSS rule; system offers requested a missing icon (404); results screen repeated its message; ship names defaulted to the bare hull name (now `<captain>'s <hull>`); first solo beacon could spawn an Armada Gunship (threat budget per column); short runs too short to upgrade (9 columns, guaranteed pre-boss store); Cadet Flagship too hard for a novice table (−25% hull, no escort, 30% slower enemy fire).

Review fixes: save validation now rejects prototype keys, loot bonus > 2, bad boss phase, empty enemy lists, missing hull/enemy ids and a reused id counter (regression cases in `tests/run-campaign.test.ts`); destroying the Flagship's final phase wins even with escorts alive; hazard damage no longer counts toward a captain's score; backdrop loading aborted during preparation is retried; effects queued while a tab is hidden no longer burst on return; combat toast/banner timers and the readiness frame are cancelled on unmount.

## Remaining limits

Physical phones, Safari/iOS, a real TV at viewing distance, audio by ear, ten-device Wi-Fi and human pacing/balance are unverified; browser evidence is Chromium touch emulation. The host PersonalView aims and moves crew by mouse only (keyboard selects weapons but cannot choose rooms). The largest possible boss roster can reach ~28 KB per snapshot (under the 32 KB platform cap, over the 24 KB target). Save → load through the room menu UI was covered by the platform room test, not a browser flow.
