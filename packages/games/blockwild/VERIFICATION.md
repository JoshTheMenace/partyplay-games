# Farm toolkit verification — 12 September 2026

Implemented buckets and irrigation, shears and saved sheep coats, grazing/regrowth, bone meal, food values, crop feedback/light caching and animal separation. All implementation and authored assets stay in the games repository. The current platform workspace has unrelated changes; validation used the existing isolated checkout at `/private/tmp/blockwild-publish-20260912`, with only Blockwild source/assets synchronized into it.

- 107 Blockwild tests pass, including 12 toolkit tests. Coverage includes recipes and station requirements, atomic bucket transfer/capacity/edit-limit failures, blocked rays, crop protection, sheep wool capacity/age/grazing/save validation, fertilizer spending, night/light/water cache invalidation, food values, duplicate commands, newborn separation and grass renewal.
- The full isolated suite passes 368 tests. TypeScript, scoped Blockwild oxlint and `git diff --check` pass. No Prettier was run. The unavailable code-golf skill was replaced by a manual simplification pass: the implementation reuses the existing commands, inventory, effect events and context action button.
- Blender 5.2.1 exported and reimported all four animal GLBs. The sheep has 300 triangles and seven meshes, with a removable coat. Both woolly and shorn previews were inspected; the editable blend retains its normal coat. Preview cameras/lights are excluded from GLBs.
- Final frozen build: `blockwild-toolkit-02`, normal catalog with no development fixture. Client index SHA256: `e314c2d60debac058a039bea9c0c2321bab674f6fb4fb0e53e4f15b322632fb1`. Preview: `http://localhost:4399/?game=blockwild`. The user's earlier port 4397 remains untouched.

## Browser evidence

Playwright Chromium, an owned watching host and 390×844 emulated touch phone, using normal join/readiness/start controls. Isolated room FZLRXG used a world loaded through the supported save picker; no hidden game-state API was used. Real touch aiming and buttons collected/poured water with automatic held-bucket changes, applied three bone meal to ripen wheat, sheared a sheep and saved the result. The Grow label and crop status were visually checked. Reload restored three wool, five remaining bone meal and the shorn coat. A prepared save just before the grazing deadline verified the visible coat regrowth transition; deterministic tests cover the full deadline behavior.

A separate maximum-content save contained 48 animals, 128 farms and every inventory entry at its legal capacity. Layouts were inspected at 320×568, 390×844, 667×375 and 844×390, including inventory dialogs. No horizontal page overflow or browser errors occurred. A short 229-frame sample at the last viewport reported p50 8 ms, p95 12.3 ms, one slow frame and a 56 ms scene load; this is local desktop emulation, not a sustained physical-phone performance claim. Earlier ten-player checks below remain the maximum-roster evidence for this refinement.

Finish → results → replay → lobby and room closure passed. Both owned test rooms and the named browser were closed; only the final preview server remains from this toolkit QA. Scripts, saves, logs and screenshots are in the platform workspace under `output/playwright/blockwild-toolkit/`.

Limits: physical phones, Safari, long sessions and subjective touch/audio feel still need device playtesting. Water is static, animal navigation and lighting are simplified, and this update does not add armor, tool durability, flowing liquids, fences or full Bedrock parity. Gameplay differences and code ownership are explained in [FARMING.md](FARMING.md).

---

# Current farming verification, 2026-09-12

Status: implemented in the Blockwild game module; no commit or push performed for this follow-up. Preview: http://localhost:4397/?game=blockwild. [Farming guide and implementation decisions](FARMING.md).

- Stable platform publication checkout: all 356 tests pass, including 95 Blockwild tests. TypeScript and scoped oxlint pass. A new test covers adjacent-animal ray targeting; other added tests cover seed source, hoe crafting, planting, wet/dry growth, obstruction, early/full harvest, food attraction, species/age/cooldown restrictions, caps, duplicate commands and save validation.
- Final isolated build: `blockwild-farming-final`, index SHA256 `fb5b16f8e8197146d1b08023f9a69ff242f3134e8f39f54d024bfffe693b51fe`. Built in `/private/tmp/blockwild-publish-20260912` from the previously published platform plus only the updated Blockwild module/assets. The active shared workspace gained an unfinished Sky Clash registration during work, so its later full build/typecheck failed outside Blockwild. The earlier shared preview also logged catalog 503 responses for that missing game. No unrelated source was modified to work around it.
- Blender generated four animal GLBs, reimported each to check mesh counts, saved editable source and rendered an inspected lineup. Four additional original synthesized calls bring the effect bank to 61 WAVs.
- Real Chromium UI: room QNXS38 joined the advertised ten-player roster (one host plus nine headless emulated phones), started, loaded a maximum-content save, finished and returned to the lobby. The 48-animal/128-crop fixture is about 131 KB. This is labeled fixture coverage, not a claim that all resources were gathered manually.
- Final host/390×844 touch phone, room ZENLLU: used normal inventory, touch-look and action controls to till grass, plant one seed, harvest early (seed count restored), then feed two cows. Exactly two wheat were spent and exactly one baby appeared. Downloaded through Save world, reloaded through Load world; verified three animals, one baby and two parent cooldowns. No game page errors were recorded. Finished, returned to lobby and closed the room through UI.
- Final maximum-content phone screenshots inspected at 320×568, 390×844, 667×375 and 844×390. Display captures at 1280×720 and 1920×1080. No document overflow or observed control crowding. The compact Feed label retains a full species-specific accessible name. Representative emulated-phone metrics at low graphics: p95 10.8 ms, 329 draw calls, 121,346 triangles. These desktop-hosted emulation numbers are not physical-phone performance evidence.
- A first browser check found the broad animal aiming cone could feed a neighboring cow. The final build replaces it with oriented body ray intersections and passed the same feeding scenario. Earlier build/screenshot results are retained as history, not final-code evidence.

Evidence and scripts: `output/playwright/blockwild-farming/` in the main platform workspace. Files include `final-play-result.txt`, `final-layout-result.txt`, `bred-save.json`, maximum-content fixtures, screenshots and copied test/build logs. All owned QA rooms and browser sessions were closed; only the final preview server remains. Older user preview servers were preserved.

Limits: crop/water timing, baby maturation and full inventory failures have deterministic rule coverage. Browser checks use fixture farms and accelerated prepared states, not a six-minute manual growing cycle. Physical phones, Safari, subjective audio quality and long-session animal enclosure/pathfinding still need playtesting. See FARMING.md for the intentionally smaller ruleset.

---

# Blockwild release verification

This change includes the Bedrock-inspired survival/crafting overhaul, authored Blender mob assets, clearer mobile controls, scrolling hotbar, spatial effects on playing devices, and the four user-supplied music tracks.

## Publication checkout

Verified from a clean platform checkout based on 61a0e72 and games checkout based on 8ce1be4, containing only the Blockwild changes. The publication also includes the optional SceneViewProps.isHost field and its platform forwarding, so both watching and playing hosts can own the music. No other unpublished Kart, Kitchen Rush or shared-platform edits are required.

- All 342 tests from the platform `npm test` pass, including 81 Blockwild tests.
- Full `npm run typecheck`, Blockwild source/test oxlint and `git diff --check` pass.
- `npm run build:isolated -- blockwild-host-music-02` succeeds. Client index SHA256: `54191f3e106ff9921ad176bca07bf282b3cb7e01ee0beb51e5031d28aca7ce9a`.
- The four MP3 files match the supplied originals byte for byte. The 57 effect WAVs decode successfully; Blender GLBs and editable source scenes are included.

## Focused music browser check, 2026-09-12

Chromium with a watching host and one 390×844 emulated touch phone, isolated room ANTUP4 plus a fresh solo room. The test used real join, readiness, start, mute, finish and room-close controls.

All four MP3s produced nonzero Web Audio analyser output and correct durations. The check sought near each track's end, then waited for actual media `ended` events to verify Horizon Dawn → Pastoral Horizons → Pastoral Quiet → Silent Exploration → Horizon Dawn. Only one host music element existed throughout. The watching host started music after its Start gesture without another tap; the phone never created a music element.

The host's Sound off paused music without advancing its position; Sound on resumed it. Muting the phone left host music playing, and muting the host left phone effects working. The watching host created one music context and no effect sources. A solo playing host created one music element plus its own effect context. Results and server-confirmed room closure paused music, removed its source and closed all contexts. No browser errors were observed. Both owned rooms, phone context and named browser were closed afterward.

Music tests additionally cover repeated frames, blocked autoplay and retry, missing-track skipping, an entirely unavailable playlist, and disposal. The host music gain is 18%, using Web Audio independently of each playing device's effects mix.

## Existing gameplay and sound evidence

Earlier focused checks covered mobile portrait/landscape carousel layouts, ten-player rendering and survival flows, crafting/stations, and the four mob models. Sound checks verified actual touch mining, footsteps, crafting/eating, nearby-versus-distant phones, mute, AudioContext suspension/resume, missing effects, playing-host output and results cleanup. Rule tests cover bounded sound events, duplicate/stale suppression, successful versus rejected actions, surface steps, water, mob voices, fuse loops and ten listeners.

Physical-phone listening, Safari autoplay behavior and subjective music/effects balance still need device playtesting. The automated music check accelerated track endings by seeking; it did not listen through the full 16-minute playlist. Detailed local logs and scripts are retained in the platform workspace under `output/blockwild/music/` and `output/playwright/blockwild-music/`; prior evidence lives under `output/blockwild/bedrock/`, `carousel/` and `sound/`.

No Prettier was run. The requested code-golf skill was unavailable; the manual simplification pass kept one host music element and the existing per-player effects lifetime, and skipped sound tracking work while audio is inactive.
