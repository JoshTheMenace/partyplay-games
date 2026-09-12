# Sky Clash playable build verification

## Current build

2026-09-12: **Fox/Falco playable slice**, registered in PartyPlay for 2–4 players. The current immutable build is `sky-clash-playable-0912-b`, built at `2026-09-12T21:25:50.264Z`, without the development Scene Lab. Client index SHA-256:

`5efb07e256db5854d761db1192b3bf93e094b99c58a4a6d1d09d010428e78769`

Local preview: `http://localhost:4391/games/sky-clash`. The matching isolated server is left running for the user. The earlier reference viewer on port 4386 remains untouched. Build A used port 4390 and its server/room were closed after testing. Browser QA used the owned headless Playwright session `sky-clash-playable-0912`; it and all synthetic rooms/phone contexts are now closed. No user browser windows were closed.

Evidence paths below are relative to the PartyPlay consumer repository, under ignored `output/playwright/sky-clash-playable/`. This report records a reconstructed game, not numerical parity with Melee.

## Static and rules checks

- **33 game/catalog tests pass**: input validation, stale/duplicate choices, readable selection/countdown, short-tap preservation through the real HeldInputChannel, jump resources, startup/one-hit/trades, shields, platforms, KO credit/respawn, disconnect/reconnect/forfeit, ties, clean replay, sustained four-player combat, original-data preservation, 320 native-C scalar helper vectors, signed raw hitbox decoding, per-character jumps, early/late/multihit scripts, smash charge, non-flinching/stunning lasers, reflection, fire recovery, air dodge, landing lag, knockback dependencies and actual serializable transport projections. Production animation tests parse both GLBs, exercise every move in both facings, verify clone independence and skeleton disposal. Evidence: `game-tests-b.txt`.
- **59 relevant platform/room/3D integration tests pass**, including registry projections and shared lifecycle behavior. Evidence: `platform-tests.txt`.
- **Root typecheck passes** at final verification (`typecheck-final.txt`). An intermediate concurrent Kart Party boolean typing error is retained in `typecheck-b.txt`; it was not changed by this task and cleared before the final check.
- Focused game typecheck passes (`typecheck-game.txt`): `node_modules/.bin/tsc -p game-modules/packages/games/sky-clash/tsconfig.playable.json --noEmit`. Use the physical `game-modules` path for this config's consumer-relative `extends`, not the shorter directory symlink.
- Focused lint passes (`lint-b.txt`). Both repository `git diff --check` checks pass. No Prettier, staging, commits, pushes or publication.
- Falco GLB reimport verified 20 bones, finite dimensions and weighted limb deformation (`output/melee-fidelity/falco-verify.log`). Fox retains its preceding reimport and regression evidence. Both are authored models.
- The requested code-golf skill is not installed in the searched skill directories. A manual simplification review retained shared imported attributes, one script compiler, one unit conversion and the existing room lifecycle rather than adding parallel systems.

## Real browser flows

| Check | Result and evidence |
| --- | --- |
| Four real UI joins, 16-character names, five stocks | Pass on A and B, alternating Fox/Falco picks. `setup-a2.txt`, `setup-b.txt`. |
| Four-player active combat | Real keyboard input changed authoritative damage. B totals after the scenario: 36%, 40%, 84%, 48%. No hidden state injection. `play-b.txt`. |
| Four-player results and replay | Pass on both builds; results reload without a canvas, same-room replay restores zero damage/KOs and five stocks. `results-a.txt`, `results-b.txt`. |
| Two-player active duel and stock ending | Fox and Falco each dealt laser damage. One player then crossed the blast zone through actual movement; the survivor won and received recent-attacker KO credit. `duel-replay-a.txt`, `results-two.png`. The forced walk-off is not evidence that the final KO was caused by knockback. |
| A → B → A game switching | Sky Clash → running Quiz Panic → fresh Sky Clash preserved both seat IDs, disposed the arena during Quiz Panic, reset fighter state on return. `switch-a.txt`, `switch-back-a.txt`, `switch-return-a.txt`. |
| Touch and reconnect | Two CDP touch pointers combined movement and attack; touch cancellation and blur released input; phone reload retained the fighter. `input-a2.txt`. Emulated touch, not physical phones. |
| Rotation during a hold | Simultaneous movement/attack released when rotated upright. Portrait showed the shared landscape gate and returning sideways produced no phantom input. `rotation-resources-b.txt`, `rotation-held-release.png`. |
| Charged smash | Real held I input raised the server's charge value; release completed the move. `retry-b.txt`. |
| Model failure and retry | A synthetic HTTP 503 for Falco returned all players to the lobby with the shared retry notice. Restoring the route and readying again successfully rebuilt a four-player arena. `loading-recovery-b.txt` records an initial harness timeout looking for overly specific wording; the actual generic message and successful retry are in `retry-b.txt`, `model-failure.png`. The expected HTTP error is not an unexplained browser error. |

Normal match, results, replay and switch scenarios recorded no JavaScript or server error messages. Browser selectors were corrected after two harness mistakes: an early visibility check before the detail screen rendered, and an up-special assertion during an already occupied action. An initial two-player melee chase bot missed because it stopped/attacked while drifting past; the subsequent explicit ranged duel proved active damage and results. This is a test-harness history, not a claim that human close-combat feel is validated.

## Layout and rendering

- Displays: **1280×720 and 1920×1080**, four fighters/HUD cards, no horizontal page overflow or offscreen cards. Real gameplay screenshots: `fight-1280x720.png`, `fight-1920x1080.png`, `current-arena.png`.
- Phone play: **667×375 and 844×390**, six reachable surfaces (move pad plus five actions), all at least 44 px. The smallest action measured 52.5×52.5 px. Screenshots: `controller-667x375.png`, `controller-844x390.png`.
- **320×568 and 390×844** during play show the landscape gate with controls released. These are orientation fallback checks, not portrait gameplay claims. Portrait/landscape result screenshots are recorded separately.
- Maximum-content HUD fixture: four 16-character all-wide names, **999%, five stocks and 20 KOs**, at 1280×720. Initial name clipping was repaired by Fable. B shows complete names in two lines with no card overflow. `max-content-b.txt`, `max-content-fixture.png`. This is an explicitly labeled static layout fixture, not a real 999% match.
- A natural four-way tie with four 16-character names showed all four result rows and both replay/picker actions at 1280×720. The document has five pixels of bottom padding overflow (725 px total); essential content remains visible. `tied-results-b.txt`, `tied-results-four.png`.
- Reduced motion and low graphics were exercised; gameplay telegraphs remain visible. The retry round runs with `party.sceneQuality=low`. Both models are present before readiness. Phones construct no WebGL world.
- B four-player metrics: 134 draw calls, 40,942 triangles, 33 geometries, 44 textures; the retained 600-frame sample had p50 about 16.7 ms, p95 about 16.7 ms, maximum about 16.8 ms, with no slow frames in that run. After replay and replacing the default Falco actors with Fox, textures stayed bounded at 46 rather than A's observed 66. `play-b.txt`, `rotation-resources-b.txt`.
- The observed fight snapshot rate was about **29.99/s**; largest snapshot in that 200-snapshot sample was **2,105 bytes**. It is not a measured worst-case 24-projectile transport maximum.

These are headless Chromium results on the local Mac, device scale factor 1. They do not establish physical touch feel, Wi-Fi contention, thermal performance, TV viewing distance, competitive balance or original-engine parity. The complete original roster, original mesh/animation fidelity, bone-attached collision, advanced Melee systems and rollback remain outside this playable slice; see [README.md](README.md).

## Earlier work

The reference lab remains independently inspectable and its six foundation tests still pass. Its UI/asset checks live under `output/playwright/melee-reference/`. The former Bolt/Atlas experiment and its screenshots under `output/playwright/sky-clash/` are superseded; they are not acceptance evidence for the current fighters.
