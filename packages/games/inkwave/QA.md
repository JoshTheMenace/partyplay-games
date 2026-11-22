# Inkwave validation

## Deep pass: big rooms, broadcast, phone presentation

Validated 2026-11-22 on the shared Linux development box (12 cores, load average 10–30 from other work), headless Chromium 1.63 with **software WebGL (SwiftShader)**, emulated touch phones. No physical phone or TV, and no frame rate here says anything about real devices. Final build `iw-pass-a11` (built 2026-11-22T19:16:50Z, index SHA-256 `660a6159…2e0da7`); earlier builds of the same day are named where a check ran on them. The isolated builds and servers were removed afterwards. Evidence: `output/inkwave-pass/` in the platform checkout (37 screenshots under `shots/`, test summaries). Each real page ran in its own browser process; the rest of a roster were socket bots that pick a loadout, run, aim and fire (`tools/room-bot.mjs`).

### What changed and how it was checked

| Change | Check |
| --- | --- |
| A room of up to 64 is dealt into 4v4 arenas that play at once for two room-wide teams (`public/arenas.js`, `src/server.ts`) | Rule tests deal every size from 1 to 64 in both team layouts and Cargo; a 17-seat (three arenas) and a 64-seat (eight arenas) round run to results. Browser: 32 seats (four arenas, build a5) and 64 seats (eight arenas, builds a8, a9 and Boss Battle on a10), one real TV, one real phone, the rest bots. |
| TV broadcast: camera eases in on the action, name tags, splat feed, call-outs, countdown, line-up card, arena chips and cuts | `shots/base-turf-tv-000.png` (before: one static shot of the whole stage, no names) against `A-tv-tv-038.png`, `a2-turf-tv-036.png` (final count), `B-tv32-tv-036.png`, `F-64-tv-043.png`, `K-32-tv-084.png`, `L-final-tv-*.png`. |
| Phone presentation from the original game, never wired in the first port: fly-in, READY/GO, hit markers, damage direction, splat card and death camera, kill feed, last minute, final count, crane at time | `C-phone-phone-035.png`, `C-phone-phone-103.png` (count and feed). In the two-phone match the phones' own HUD text was read every four seconds: seat A's card read "SPLATTED BY Benedict Appleby · Twinfire Pistols · 5 RESPAWN", seat B's "SPLATTED BY Marisol Quinn · SPECIAL · Twister Zooka" (the other human seat), with feed lines on both. Hit markers and the damage flash are wired the same way and covered by the server test of the damage record, but were not caught in a screenshot. |
| Characters and effects replay on the server's clock (they were stamped with arrival time, so network jitter became motion stutter and shots left the barrel before the character got there) | Code and rule test (`every event reaches a screen…`). Not measurable as smoothness under software rendering. |
| Traffic: events once per two or three snapshots instead of for a second; run-length paint baselines; roster and result cached per socket | `tools/measure.mjs` and live bots, table below. |
| A socket drop no longer rebuilds the 3D arena | The phone's socket was cut by the server during a slow frame; the same iframe element was still there, loaded, afterwards (frame identity unchanged across the drop, build a2), and `H-boss64-tv-000.png` shows the TV's arena still on screen under the shell's "Reconnecting" notice. |
| Short landscape phones get a usable loadout (the picker was a 32 px strip at 568×320) | `shots/base-03-phone-lobby-568.png` against `C-00-phone-lobby-568.png`; `tests/mobile.test.ts`. |
| Lobby shows teams and arenas on the TV and each phone's own seat | `A-00-tv-lobby-8.png`, `H-64-00-tv-lobby.png` and `-1080.png`, `a3-02-phone-lobby-568.png`. |

### Measurements

Server and traffic, in process (`node --import tsx packages/games/inkwave/tools/measure.mjs 8,32,64`, Tidewater, Turf War, scripted seats, 20 s, loaded box; ranges are two runs). "On connect" is the one message a socket receives when it joins or rejoins, with the roster and the paint; the platform caps messages from clients at 32 KiB, not those from the server, but every message stays under it:

| Players | Arenas | Server tick mean / p95 | Round creation | TV | Phone | Largest message | Paint baseline |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 8 before this pass | 1 | 1.7 / 4.6 ms | 1.4 s | about 340 KB/s | about 340 KB/s | 57–73 KB each second | 57–73 KB |
| 8 | 1 | 1.9–2.5 / 4.8–7.6 ms | 1.4 s | 56 KiB/s | 56 KiB/s | 12 KB (22 KB on connect) | 3–9 KB |
| 32 | 4 | 6.0 / 14 ms | 1.2–1.5 s | 69 KiB/s | 137 KiB/s | 18 KB (27 KB on connect) | 3–6 KB |
| 64 | 8 | 6.2–7.7 / 12–14 ms | 1.1–1.7 s (6.2 s before arenas shared their stage) | 67 KiB/s | 129 KiB/s | 18 KB (31 KB on connect) | 3–6 KB |

Live rooms on the isolated server (bots' own counters and the server process's CPU time, sampled every five seconds):

| Room | Per-bot traffic in play | Snapshots received | Server process |
| --- | --- | --- | --- |
| 8 bots, one arena (a4) | 52–55 KiB/s | 19–20 /s | not sampled |
| 31 bots and one phone, four arenas (a10) | 89–120 KiB/s | 19–20 /s | 36–49% of one core while playing |
| 63 bots and one phone, eight arenas (a8, a9) | 88–131 KiB/s | 14–20 /s | 54–89% of one core while playing |

The 16.7 ms tick is the first thing to give out. At 64 seats the simulation takes about half of it on average here, 14 ms at the 95th percentile, and the bots saw the snapshot rate dip below 20 a second during the heaviest moments; a quieter server has headroom this box does not. Beyond 64 the single simulation thread, not traffic or phones, is the wall. A phone's cost is flat: it draws eight characters and receives two arenas however large the room is.

The platform re-sends the results snapshot at the snapshot rate for as long as the room stays on the results screen. Inkwave's part of it is now a still view under 1.5 KB with the result cached per socket, but the platform's outcome rows repeat: 64 bots received about 140 KiB/s each while idle on results (190 before the result was cached). That is a platform behaviour and is reported, not changed.

### Browser flows

Every flow is a real join through the shell, the original loadout screen, a match, the results screen and, where noted, the host's Play again. `a11` is the final build. `a10` differs from it by two display-only lines (the TV camera eases by the wall clock so a slow browser is back on the whole stage for the count; the splat feed sits under the arena chips), rechecked on a11 with 32 bots and the TV (`L-final-tv-mid.png`, `L-final-tv-count.png`). `a7`–`a9` differ further only in lobby and results styling, two lint-only edits and the cached result.

| Flow | Build | Result |
| --- | --- | --- |
| Turf War solo: one phone (568×320) with seven CPUs, TV; 30 s match, Play again, second match | a10 | Both matches reached results on TV and phone; no page errors (`S-solo2-tv-results.png`). Same flow with 60 s and 180 s matches on a3–a7. |
| Turf War, two phones on opposite teams (568×320 and 844×390, held touch stick and fire), six bots, TV | a7 | Both painted (seat A 482p on its own HUD, 492p on the TV strip), each phone showed splats by and of the other seats, results on all three screens. |
| Turf War, eight bots, TV only | a4 | `A-tv-tv-000.png`, `A-tv-tv-038.png`; results. |
| Turf War, 31 bots and a phone, TV, 90 s (four arenas) | a10 | Phone seat "Tangerine · Arena A"; arena chips, on-air tag and name tags on the TV (`K-32-tv-084.png`), the phone in play with its feed (`K-32-phone-059.png`); "Cobalt win the room!" by 11.7% to 11.6% of combined turf with the arenas split two each; the phone's results show the room verdict, the four arenas with its own highlighted, then its own arena's original results screen (`K-32-phone-results-390x844.png`). TV-only runs with 32 bots on a5 (`B-tv32-*.png`) and a11. |
| Turf War, 63 bots and a phone, TV, three minutes (eight arenas); the phone reloads mid-match | a8, a9 | Line-up of 64 above the fold at 1280×720; phone seat "Tangerine · Arena A"; a phone reloaded at 0:35 was back in its arena 49 s later with paint, HUD and 148p (`G-64-phone-reloaded-095.png`) while the room played on; room results with 64 names and Play again on one screen (`G-64-tv-results.png`). |
| Boss Battle, 63 bots and a phone, TV, 60 s (eight squads) | a10 | Phone seat "Squad A"; eight squads fought their own boss; all ran out of time: "0 of 8 bosses sunk", every squad listed with damage (`H-boss64-tv-results.png`). The TV kept its arena on screen through a dropped socket (`H-boss64-tv-000.png`). |
| Zone Control, one phone and seven bots, TV, five minutes plus overtime | a10 | 659 s to results; original zone HUD on the phone, counts and zone outlines on the TV (`Z-zones-tv-171.png`, `Z-zones-phone-045.png`). The bots do not play the objective, so the count stayed 100–100 into overtime. |

The TV's overlays were also recorded from the DOM through a 30 s eight-bot match on a10, because most last a few seconds and a screenshot here takes longer: the line-up card ("Turf War · Tidewater Plaza", four names a side, VS; 1240×205 at y 193), a feed line, the count from 10 and "Time!". `I-intro-card-markup-review.png` is that card's recorded markup put back over a still of the stage to judge its styling; it is not a capture of the live moment.

### Tests

On the final source: `node --import tsx --test packages/games/inkwave/tests/*.test.ts tests/registry-contract.test.ts tests/catalog.test.ts tests/curated-catalog.test.ts tests/session-stall.test.ts` 67 pass, 0 fail (the same files without the new session test were 57 pass before the pass). `npm run typecheck` clean. `npm run lint` warnings only, none left in the files this pass wrote. `npm run test:platform` 121 pass, 1 skipped, 0 fail of 122. Full `npm test` 2,095 pass, 25 skipped, 4 fail of 2,124, run while 32- and 64-seat rooms were also running on the box: the four are timing budgets in other games (Blockwild mean tick and two chunk-generation medians, Night Job average tick), no functional failure and none in code this pass touched.

### What this environment could not show

- Software WebGL runs this renderer at seconds per frame whenever paint is flushed, and a full-page screenshot blocks a page for 5–50 s. A page blocked for more than ten seconds while snapshots arrive is disconnected by the server's heartbeat (close code 1006). That happened to the real pages in most runs; with the arena now surviving a socket drop they carried on, but it is why few in-play screenshots exist per match and why none shows a hit marker.
- The loading barrier: one real page loads the arena in 25–40 s here, two in sequence. The harness loads the TV first and each phone after it (the phone's JavaScript is paused through the debugger until then). Real phones load in parallel on their own GPUs; that was not exercised.
- Not seen: the "arena decided, others still playing" card on a phone (every big-room match here ended all arenas together), the broadcast's cut card (cuts themselves are in the TV shots: arena A, then D or E), a hit marker, and the intro card as live pixels.
- Not checked: physical phones and TVs, real Wi-Fi with many phones, audio by ear, thermal behaviour, notch safe areas, iOS Safari, a host playing on the TV device in a room of several arenas, Cargo Terminal and stages other than Tidewater Plaza in the browser (all eight stages run to results in the rule tests). The 1920×1080 TV was checked for the 64-seat lobby only.

## Polish pass (2026-10-17)

Validated 2026-10-17. Build `inkwave-polish-03` is running on **4394** (`npm run serve:isolated -- inkwave-polish-03 4394`). Evidence: `output/playwright/inkwave-polish/`. Headless Chromium on the development Mac, emulated touch phones; no physical phone.

| Change | Check |
| --- | --- |
| Arena fills the phone; Full screen/Sound stack top-left; minimap and map title move below | Turf, Zones and Boss at 568×320, 667×375 and 844×390, map closed and open: no HUD/button overlap (`yxw-sheet.png`, `z-phone-*`, `k-phone-*`). |
| SP no longer overlaps SQUID (0.17-step overlap in the original table), YEAH clear of MAP, special gauge under MAP | Same screenshots; two-thumb move+fire still scores turf (100–151p per 30 s run). |
| Held input releases on rotation, not on every resize (iOS toolbar resizes no longer drop fire) | Code review; touch.js already uses `orientationchange`. |
| TV camera lays the stage sideways and starts framed (it used to freeze on a ground-level shot while loading, because the rig blended from the origin) | Contact sheets `i-sheet.png` (before) and `j-sheet.png` (after); 1280×720 and 1920×1080. |
| TV scoreboard uses original type, team names/colours; compact eight-player strip; boss HP bar | `c-host-play.png`, `t-host-play2.png`, `k-host-play2.png`, `z-host-play.png`. |
| TV results say “COBALT WINS!” instead of “VICTORY!”, and fit the screen with Play again visible | `c-host-results.png`, `t-host-results.png`; boss results keep VICTORY/DEFEAT for the one squad. |
| Locker chip shows avatar/name at ≤600px; Bot Skill pips no longer clip labels; landscape lobby shows more weapons | `m-sheet.png`, `l-stage-1280.png`. Removed 8 overridden menu.css rules; 320/390 renders unchanged. |
| Store copy rewritten for players | Catalog tests pass. |

Typecheck, scoped lint and 57 Inkwave/registry/catalog tests pass. The full suite showed 1,799 pass and 1 fail: a Blockwild spawner timing test that passes 18/18 on its own and shares no changed files. No browser errors in any run. Not checked: physical phones, notch safe areas on a real iPhone, and iOS standalone mode (Sound only).

## Earlier mobile build

Validated 2026-10-17. Build `inkwave-mobile-11` is running on **4387**, using `npm run serve:isolated -- inkwave-mobile-11 4387`. The older user preview on 4377 was preserved. Build time: `2026-10-17T22:02:16.932Z`; client entry SHA-256: `c089d1f697eb5a344e32a881db6178617eee30ed44a252451dcdca3d4eddc4c5`. Game bundle SHA-256: `4983c2e989d174e4d6e4353b78676cfc0057e960b07b86a2385fbdbe1c053894`; mobile stylesheet: `a78006c4e9e2a2a9f4f7c06eed5b461a01d1e8e17c309ae0ad04ed15a241cf32`. Served game HTML, CSS and bundle match the immutable build byte for byte.

One browser owner used headless Playwright session `inkwave-mobile`, one watching display and one emulated touch phone with seven CPUs. Evidence is in `output/playwright/inkwave-mobile/`. T3 preview evaluation timed out twice before switching to the documented Playwright workflow. No physical phone was available.

| Check | Result |
| --- | --- |
| Static checks | Typecheck, scoped lint and whitespace checks passed. All 22 Inkwave tests pass, including phone rendering limits, unchanged desktop presets and the replicated Super Jump camera regression. |
| Equipment layouts | Build 10: 320×568, 390×844, 667×375, 844×390, 1280×720 and 1920×1080. All 12 weapons, 15 subs and 19 specials present; last option selectable in every category. No card/name width overflow. Phone cards are at least 100px tall. These layouts are unchanged in build 11. `layouts-10.txt` and representative screenshots. |
| Locker | Real touch taps at 320px select the last option in each of the four tabs, covering six appearance fields. Tab targets are 129×48px. Server roster preserves the selected style. `controls-10.txt`, `results-10.txt`. |
| Touch and reconnect | Simultaneous movement/fire produces 63 combined input messages and 96.65 turf during the check. Cancellation, blur and rotation return all held controls to neutral. Buttons measure 45–75px including borders. Reload during play preserves the seat; the completed round records 101.10 turf. `controls-10.txt`, `results-10.txt`. |
| Reduced motion | All 15 sub cards report no animation under reduced motion; selection/readiness still work. `replay-10.txt`. |
| Super Jump regression | Build 10 reproduced a camera exception after a map jump, confirmed by a failing unit test. Build 11 follows replicated position when local flight endpoints are absent. Real touch drag plus Fire selects a teammate, charges, flies and lands; camera coordinates stay finite. `jump-red.txt`, `jump-green.txt`, `jump-11.txt`, `map-11.png`. |
| Final complete flow and replay | Build 11 room HYDNHT completed two Turf matches with eight actors. The second round ends with coverage 10.15% / 11.24%, no browser errors and no remaining arena iframe. Settled results/podium screenshots inspected. `finish-11.txt`, `results-11.png`, `replay-results-11.png`. |

Performance samples use Tidewater, an 844×390 emulated phone at device scale 3, a watching host and seven CPUs on one development Mac. They are comparative observations, not a deterministic benchmark or physical-device measurements:

| Workload | Original build 07 | Mobile changes |
| --- | --- | --- |
| Render pixels | 1242×477 | 828×318 normally (56% fewer); 621×238 at adaptive floor (75% fewer) |
| Minimap pixels | 392×658 | 168×282 (82% fewer) |
| 4× CPU, 12-second sample | Mean frame 17.29ms; minimap 1.24ms | Build 10: mean frame 17.10ms (~58 fps), p95 16.8ms, worst 149.9ms; minimap 0.33ms |
| 12× CPU, 12-second sample | Mean frame 85.98ms; minimap 11.44ms | Build 08: mean frame 78.11ms; minimap 3.20ms |

The rendering changes measured in builds 08/10 remain in build 11. Extreme CPU throttling still produces poor frame rates; no claim of universally smooth phones is made. Physical iOS/Android, Wi-Fi contention, thermal behavior and human control feel remain untested. Previous eight-human Cargo and Boss acceptance below is reused for unchanged modes, server authority and maximum human roster.

Important implementation choices: preserve original models/cards/showcase; reduce render density and minimap work on phones; reuse the original adaptive resolution loop and held-input system; keep Ready outside the scrolling picker. The code-golf pass retained existing validation, keyboard controls, desktop presets and all equipment choices, removed redundant selection reassignment, and fixed remote jumping with a camera guard instead of duplicating flight simulation. Tactical map UI now mounts under the original HUD so it inherits its sizing/font variables, with touch-specific instructions.

Owned test rooms and phone contexts were closed. Intermediate QA servers were stopped; the new preview on 4387 and original user runtime on 4377 remain available. No Prettier, staging, commits, pushes or PRs.

## Earlier complete-port evidence

Validated 2026-10-17. This completes the earlier port with Cargo Terminal, cooperative Boss Battle, original menus/locker/podium results and the original procedural soundtrack. Game source/assets remain in the game-modules repository. No staging, commits, pushes or publication were performed. No Prettier commands were used.

## Deliverable and ownership

Build `inkwave-complete-07`, built at `2026-10-17T21:12:10.919Z`, is served on port 4377. Entry SHA-256: `4592ee2116c8169fa7a4618d1fe79f07d27937772ac9b90f764c21eb99096506`. Start command: `npm run serve:isolated -- inkwave-complete-07 4377`. Assets were frozen for each build; source edits never changed a running build.

Browser QA used owned synthetic rooms in headless Playwright session `inkwave-finish`, Chromium on the development Mac. T3 preview was exercised first; the documented Playwright workflow supplied independent phone contexts and CPU/network throttling. One agent owned browser QA. The final preview replaces the old development watcher, so ongoing source edits no longer reset user rooms.

## Executed checks

| Check | Result |
| --- | --- |
| Original timeout reproduction | The old build timed out after 20.5 seconds with empty cache, 100 ms latency, 5 Mbps download and 4× CPU throttling. Artifact: `cold-load.txt`. |
| Constrained load | Build 06 watching host prepared Boss Battle in 18.351 seconds under those same restrictions, with one phone and seven CPUs. The phone and host proceeded to the match; this build completed the first Boss round. Build 07 additionally fixes the paint-baseline race discovered on replay/reload. Artifact: `final-cold-06.txt`. |
| Readiness regression | Socket test verifies the game-specific 60-second allowance survives 22 seconds, still waits for every required screen, and only then starts. Roster preflight rejects an invalid round before loading. |
| Rules and full platform suite | 127 passed, 0 failed, 1 skipped. Includes 19 Inkwave tests; the skipped test requires a separately packaged macOS app. Artifact: `tests-06.txt`. |
| Final typecheck, scoped lint, rules/catalog/registry | Passed: 53 tests, no failures. Artifact: `checks-05.txt`. |
| Stage and mode simulation | All eight stages reach results at eight players. Cargo requires two humans, never inserts a CPU, disables a disconnected seat and restores it on reconnect. Cargo Zone Control also completes. |
| Audio-before-touch regression | An emulated phone exposed the original boss audio director mutating a frozen silent handle. A failing test reproduced it; inactive loop handles are now skipped. The test passes for sweep, charge and frenzy. Artifacts: `audio-red.txt`, `audio-green.txt`. |
| Boss authority | Permanent regression covers phases 2 and 3, weak-point scoring, cooperative victory, defeat on timeout and isolation between rooms. A separate diagnostic drove phase changes and victory on all seven boss stages. Those victories are controlled simulation evidence. |
| Eight-player Cargo | Build 03: eight independent phone browser joins, 16-character names, varied weapons, six-part locker styles, readiness, match, scoring and results. Two-thumb movement/fire scored 84.124 turf; touch cancellation released input; phone reload restored its seat. No browser/protocol errors. Build 04 repeated eight joins through results. |
| Loading at maximum roster | Nine views prepared in 10.220 seconds in build 03 and 20.660 seconds in build 04. These are shared-desktop GPU measurements; the latter illustrates why a strict 20-second barrier is unsuitable here. |
| Final complete flow and replay | Build 07: one human plus seven CPUs completed Boss Battle, including a phone reload during play that preserved the seat. A second full match reached results. No browser/protocol errors; no arena iframes remained at results. Artifacts: `final-flow-07.txt`, `finish-07.txt`, `boss-results-phone-final-07.png`, `replay-results-final.png`. |
| Original UI | Actual stage cards/day-night controls, weapon cards, sub/special choices, live 3D locker portraits and podium characters render. Six appearance categories survive server validation. Final 320px locker no longer clips the last row. |
| Results layout | Eight maximum-length names, score columns, podium and XP checked at 320×568, 390×844, 667×375 and 844×390; desktop at 1280×720. Phone content fits its iframe width. Build 07 also corrects watching-team/tied-result badges and wraps the boss results summary on narrow phones. |
| Audio | One host music iframe persists across phases. Web Audio context was running with synthesized voices; Sound off reduced master gain to zero through its fade, Sound on resumed. Phones retain local effects without duplicating the soundtrack. Audio was not assessed by listening. |

Served HTML, loader, platform bundle and responsive stylesheet were byte-checked against build 07. QA rooms, phone contexts and test servers were closed; the user preview remains running on 4377.

The original broader Turf/Zone controller checks remain in `output/inkwave/`: full matches, replay, cross-game switching, keyboard/mouse, multi-touch, blur/cancellation, rotation, all eight touch targets ≥44px, and reconnect. Current work retains that input path. The final completion artifacts are under `output/playwright/inkwave-finish/`.

## Implementation and limits

The host timeout fix bundles the engine's module graph, uses the original low graphics tier, repeats the iframe readiness handshake, reports import errors, waits for a full paint baseline on reconnect, and allows 60 seconds for actual preparation. It does not start simulation early or bypass required screens. Cargo's original no-CPU/no-boss restrictions are preserved. Other stages fill an eight-player roster with CPUs; Boss Battle puts all eight on one team and replicates boss state and active hazards for reconnect.

Original menus are embedded behind a source/origin/instance-checked bridge. PartyPlay owns names, rooms, readiness and replay. Original XP is stored locally once per round. Music uses the original synth arrangements because optional recorded songs are absent from the upstream repository. The code-golf pass removed a shadowed duplicate Showcase method, kept renderer resizing conditional, and reduced music messages to the fields it needs; validation, cleanup, reconnect and all requested modes remain intact.

No physical-phone, Wi-Fi-contention, thermal-soak, input-to-visible-latency, TV-distance or human group-playtest evidence is claimed. Seven boss maps have simulation coverage; complete browser acceptance concentrates on Tidewater Plaza and Cargo Terminal. Other visual event history remains bounded, and old ink is restored at gameplay-grid resolution. GPU load from nine views on one Mac is not physical-device performance evidence.
