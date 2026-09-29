# Starship Scramble v2 — QA

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
