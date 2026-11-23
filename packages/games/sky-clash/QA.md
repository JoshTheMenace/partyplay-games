# Sky Clash verification

The newest record is first. The 2026-09-24 record further down describes the legacy group before the overhaul and is kept for reference.

## Visual overhaul: the crew of the Reaches, 2026-11-22 and 23

Four original fighters (Sola, Toll, Kes, Vesper) and two original arenas (Beacon Rock, Bellyard), with a new render pipeline, keyframed animation and authored movesets. Evidence is under `output/skyclash-pass/`. Everything here ran on a shared machine with no GPU (WebGL through SwiftShader, load average 15 to 35), so nothing below says anything about frame rate or how it feels to play.

### Static checks (working tree at the end of the pass)

| Check | Result |
| --- | --- |
| `node --import tsx --test packages/games/sky-clash/tests/*.test.ts` | 217 tests, 216 pass, 1 fail: `tick cost stays far under 1 ms with four CPUs`, a timing budget that also failed on the untouched tree before the pass (baseline 203 tests, 202 pass, same failure). `final-game-tests.log` |
| `npm run test:platform` | 122 tests, 121 pass, 0 fail, 1 skipped. `final-platform-tests.log` (run because of the two optional hooks added to `packages/party-3d`) |
| `npx oxlint packages/games/sky-clash packages/party-3d` | Exit 0, no warnings |
| `npx tsc -p game-modules/packages/games/sky-clash/tools/tsconfig.json` (Sky Clash source, tests and tools) | Exit 0 |
| `python3 packages/games/sky-clash/tools/blender/crew/validate.py` | 6 of 6 models pass (four fighters, two arenas) |

New tests: `tests/crew.test.ts` (11 tests over every crew fighter: complete moves and special phases, rig bones and anchors, budgets, every clip solving on every frame, hitbox tracks equal to the clip's anchor, every attack and special connecting with a body in its way, a counter answering a hit, the display playing the authored clip, recovery from six offstage spots on each arena, CPU matches to a finish) and `tests/arenas.test.ts` (3 tests: definitions, the model built to the collision numbers, floors, platforms, drop-through, both ledges, the blast zone).

### Balance (headless, level-3 CPUs, `tools/balance.ts matches --seeds=8`, 48 one-on-one matches on the two arenas)

| Fighter | Win rate | Average KO percent taken | Falls | Self-destructs | Longest single state (frames) |
| --- | --- | --- | --- | --- | --- |
| Sola | 46% | 143 | 36 | 0 | 195 |
| Toll | 46% | 168 | 36 | 0 | 199 |
| Kes | 54% | 133 | 33 | 0 | 199 |
| Vesper | 54% | 164 | 35 | 0 | 197 |

No special carries more than 20% of a fighter's damage. Recovery drill: every fighter reaches the stage from 12 of 12 standard offstage spots. This is CPU against CPU with the general fighter brain; it does not measure how the fighters balance in human hands (Vesper's zoning and Kes's movement are the least well played by the CPU).

### Real rooms (build `skyclash-pass-b`, `HOST=127.0.0.1 npm run serve:isolated -- skyclash-pass-b 4432`, headless Chromium, emulated touch phones)

Driven by `tools/ui-lab/crew-flow.mjs`. Each run is a fresh room; the reports are `room/<scenario>-flow.json` and the screenshots `room/<scenario>-*.png`. All four finished with no failure and no console or page errors.

| Scenario | What happened |
| --- | --- |
| `duel` (display 1280×720, low tier) | Two phones joined, each saw the four crew fighters first and the legacy roster folded, picked Sola and Toll, voted Beacon Rock, readied; the fight ran on Beacon Rock; both seats hit each other with real touches (Sola landed 2, Toll 1; 13% and 6%); player 1 walked off; results listed both; Play again returned the host to the lobby and the phones to selection with their picks kept; both readied again and a second fight started in the same room. |
| `solo` (display 1920×1080, balanced tier) | One phone picked Kes; the host fixed the Bellyard with three CPUs, all dealt from the crew; CPUs landed 17 hits, 11 KOs in the match; the phone moved and used specials but landed none; results listed four; Play again returned to selection. |
| `quad` (display 1280×720, balanced tier) | One phone picked Vesper on Beacon Rock with three CPUs of the crew (Toll, Vesper, Toll): 52 CPU hits, 1 by the phone, 11 KOs; results; Play again. |
| `legacy` (display 1280×720, low tier) | One phone opened the folded legacy roster, picked Mario on Battlefield against one CPU (dealt Vesper): the old fighter and stage load and play beside a crew fighter; 10 hits by the phone, 12 by the CPU; results; Play again. |

The emissive-colour fix, the lift for crew fighters on legacy stages and the retuned glow values were made after these runs, so two scenarios were repeated on the final build.

**Final build `skyclash-pass-c`** (port 4433, the working tree as it stands; `room-final/`): `duel` passed all 11 checks again (Sola landed 2, Toll 1; results; Play again; second fight), and `solo` passed all 8 at 1920×1080 on the balanced tier (Kes on a phone, CPUs dealt Kes, Toll, Kes on the Bellyard; 94 CPU hits, 2 by the phone; results; Play again). No console or page errors in either. `quad` and `legacy` were not repeated on this build.

Things the first attempts taught (all environmental or in the driver, none in the game): the host's settings dialog now reaches the rules through a "Game rules" button; a one-stock match against three CPUs is over before a software-rendered session can act; steering from the host page's snapshots lags by seconds, so the driver reads a phone's; at the balanced tier the host socket was dropped once at the results screen (`first-pass/`).

### Looked at, in the game's own renderer

- Turnarounds and close-ups of each fighter (`turnarounds/`), four costumes each as portraits and full-body art (`art/`).
- Filmstrips at fixed simulation ticks with hitboxes drawn, per fighter: locomotion, being hit, ground attacks, smashes, aerials, specials (`strips/<id>-*.png`; earlier iterations in `hero/`, `toll/`, `kes/`, `vesper/`).
- The display scene with four fighters on each arena at 1280×720 and 1920×1080, and a legacy stage with crew and legacy fighters together (`stages/`).
- Every lobby, board, HUD and results screen in the UI lab with the crew (`ui/`), before and after from the same fixtures (`before/`).

### Not checked

- Frame rate, shader compile time or memory on any real GPU; the cost figures in DESIGN.md are reasoned from what is submitted per frame.
- Physical phones, a real TV, audio, or how any of it feels to play. No human has played the new fighters.
- Teams, Sudden Death and time-out endings with the crew (covered by the shared engine's tests with legacy fighters, not re-run in a room).
- The throw animations in a room (clips exist and solve; the tests check the grab connects, not how the throw looks with a victim).
- More than four fighters, which the engine does not allow yet.

## Legacy group, final check of 2026-09-24

Build `sc-final-1` (`npm run build:isolated -- sc-final-1`), served with `npm run serve:isolated -- sc-final-1 4393` and left running for the user. Evidence is in `output/sky-clash-v2/final/`.

### Static checks

| Check | Result |
| --- | --- |
| Full-repo `npx tsc --noEmit` | Exit 0 |
| `npx oxlint packages/games/sky-clash apps tests` | Exit 0, no warnings |
| `node --import tsx --test packages/games/sky-clash/tests/*.test.ts` | 194/194 pass (`final-gametests.log`) |
| `npm test` | 1676 pass, 0 fail, 1 skipped (the packaged-app test needs `PARTY_LOCAL_HOST_APP`) (`final/npm-test.log`) |
| `npm run build:isolated -- sc-final-1` | Exit 0 (`final/build.log`) |

### Browser runs (headless Chromium, Metal GPU, one owner, run one after another)

| Run | Roster and viewports | Result |
| --- | --- | --- |
| `a-match` (`tools/ui-lab/smoke.mjs`) | 1280×720 display, two 844×390 touch phones (Marth, Link), 2 Hard CPUs, Battlefield, 1 stock, 2 min | 14/14 assertions, no page or console errors. Played lobby → countdown → fight → GAME! → results → Play again → fighter select. 91 s fight: 95 hits, 3 KOs, 21 grabs, 11 throws. The phones landed 10 and 20 hits and made 4 grabs each with the Grab button. |
| `b-stages` (`final/check.mjs`) | 1920×1080 display, one 844×390 phone plus 3 Hard CPUs. Popo on Battlefield, Zelda on Rainbow Cruise, Fox on Big Blue. | All three started on the first try, with no page errors and no console warnings. 12 frames per stage. A random CPU Popo also brought a CPU Nana. |
| `c-hud4` (`playtest/scripts/c-roster.mjs`) | 1280×720 display, four 844×390 phones with 16-character names (Popo, Bowser, Ness, Roy), Onett, 1 stock | 86 s to results with no errors, 3 KOs, and hazard warnings seen. Five fighters were on stage and there were four HUD cards and four results rows. |
| `payload` (`final/payload.mjs`) | 1280×720 display and one 844×390 phone, Popo plus 3 CPUs | See numbers below. |

I looked at the screenshots from every run: HUD frames, GAME!, results on the display and the phones, the replay lobby, and the controller.

### Numbers

- **Display frame time** (scene metrics, 600 samples per run): p50 8.1–8.3 ms, p95 8.9–9.1 ms, max 11.1 ms, 0 slow frames across the three stages at 1080p and the 720p payload run. 170k–343k triangles and 33–46 draw calls. This was measured on an Apple GPU in headless Chrome, not on a TV or a low-end laptop.
- **Transfer after the first fight starts:** the display loaded 5.0 MB in 47 requests. Four GLBs made up 2.2 MB, and three.js was loaded. The phone loaded 1.8 MB in 43 requests, with no three.js and no GLBs. All 33 GLBs total 16 MB, and the display loads only the fighters in the match.
- **Snapshots:** about 4.5 KB median (p95 5.3 KB) with 4 fighters plus 2 Nanas, and 4.7 KB median (p95 8.5 KB, max 9.5 KB) with 4 phones plus Nana, at 30 Hz. Phones get the same snapshot size as the display.

## Playtest issues: status

The playtest `REPORT.md` was not on disk. This list comes from the three polish notes (`output/sky-clash-v2/polish-*.md`) and was re-checked on `sc-final-1`.

**Fixed and seen in this build**

- Zelda/Sheik crash (blocker): Zelda, a random Zelda CPU and Popo all started on the first try.
- Camera too far out: fighters read at a good size in bunched play at 720p and 1080p.
- Ice Climbers pairing: Nana spawns with Popo, for both a phone and a CPU. Both climbers share one tag ("P1" / "CPU 1").
- **New in this pass:** Nana no longer takes a HUD card, a results row or a place on the phone. `seats()` in `src/ui/standings.ts` drops partner fighters in `hud.tsx`, `results.tsx` and `controller.tsx`, with a test in `ui-lobby.test.ts`. I also updated README's Nana line.
- Grab button: phones grabbed in the real room.
- GAME! banner: readable on its first captured frame. KO toasts are bold.
- HUD places for knocked-out fighters: #4/#3/#2 matched the results screen.
- CPU labels ("CPU 1/2/3") match the cards. Crowded tags stack instead of overlapping (Battlefield frames).
- No THREE.Material console warnings.

**Fixed per the polish notes, not re-checked here:** fair/bair direction (engine test), CPU self-destructs on scrolling stages (headless soak), pink-on-pink outlines, G&W/Kirby/Young Link portraits, the 2-column phone stage vote at 320 px, the 720p host lobby, and the time-out results explanation.

**Remaining**

- The offscreen magnifier bubble can sit under the top-right KO feed. A 16-character name makes the feed long enough to reach it (`c-hud4/hud-3-0.png`). I did not reproduce the "stale bubble on an eliminated fighter" report. Eliminated fighters are `out` and hidden.
- On phone results at 844×390 the list is visible, but the winner headline sits below the fold and needs a scroll (`a-match/phone2-results-844x390.png`).
- Phones receive the full 30 Hz public view (about 4–9 KB per snapshot). This is a server/platform projection issue.
- Platform shell: the room code chip on the phone is clipped by a 16-character name (`c-hud4/phone1-controller.png`).
- Pichu still reads as a small Pikachu. There is no paired belay, grab or wobbling for Ice Climbers, and Nana's CPU brain is fixed at level 2.
- The phone bots on Big Blue self-destruct. That is the scripted bot, not the CPUs.

## Not verified

- Physical phones, Safari/iOS, a TV at couch distance, audible audio, and screen readers. All phones were emulated in Chromium.
- No human playtest. Game feel and balance were judged only from scripted bots, CPUs and screenshots.
- Frame rate on weaker GPUs, and network conditions other than localhost.
