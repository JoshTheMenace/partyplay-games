# Sky Clash verification

This file covers the v2 rebuild after the polish pass. Older records are in git history.

## Final check, 2026-09-24

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
