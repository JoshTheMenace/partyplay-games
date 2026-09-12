# Blockwild release verification

This change includes the Bedrock-inspired survival/crafting overhaul, authored Blender mob assets, clearer mobile controls, scrolling hotbar, spatial effects on playing devices, and the four user-supplied music tracks.

## Publication checkout

Verified from a clean platform checkout based on 61a0e72 and games checkout based on 8ce1be4, containing only the Blockwild changes. No unpublished Kart, Kitchen Rush or shared-platform edits were required.

- All 342 tests from the platform `npm test` pass, including 81 Blockwild tests.
- Full `npm run typecheck`, Blockwild source/test oxlint and `git diff --check` pass.
- `npm run build:isolated -- blockwild-music-01` succeeds. Client index SHA256: `83998b51a4baae10728ad3c280772062cf52d8f5cc7c8800b04ea03dedffecaf`.
- The four MP3 files match the supplied originals byte for byte. The 57 effect WAVs decode successfully; Blender GLBs and editable source scenes are included.

## Focused music browser check, 2026-09-12

Chromium with a watching host and one 390×844 emulated touch phone, isolated room FD8XVE. The test used real join, readiness, start, mute, finish and room-close controls.

All four MP3s produced nonzero Web Audio analyser output and correct durations. The check sought near each track's end, then waited for actual media `ended` events to verify Horizon Dawn → Pastoral Horizons → Pastoral Quiet → Silent Exploration → Horizon Dawn. Only one music element existed throughout. There was no media element before the initial playing-device gesture.

Sound off paused music without advancing its position. Sound on resumed from that position. The watching host created no audio element or context. At results, the phone's media was paused with its source removed and its AudioContext closed. No browser errors were observed. The owned phone context, test room and named browser were closed afterward.

Music tests additionally cover repeated frames, blocked autoplay and retry, missing-track skipping, an entirely unavailable playlist, and disposal. The music gain is 18% before the existing master, using Web Audio rather than relying on phone support for media-element volume.

## Existing gameplay and sound evidence

Earlier focused checks covered mobile portrait/landscape carousel layouts, ten-player rendering and survival flows, crafting/stations, and the four mob models. Sound checks verified actual touch mining, footsteps, crafting/eating, nearby-versus-distant phones, mute, AudioContext suspension/resume, missing effects, playing-host output and results cleanup. Rule tests cover bounded sound events, duplicate/stale suppression, successful versus rejected actions, surface steps, water, mob voices, fuse loops and ten listeners.

Physical-phone listening, Safari autoplay behavior and subjective music/effects balance still need device playtesting. The automated music check accelerated track endings by seeking; it did not listen through the full 16-minute playlist. Detailed local logs and scripts are retained in the platform workspace under `output/blockwild/music/` and `output/playwright/blockwild-music/`; prior evidence lives under `output/blockwild/bedrock/`, `carousel/` and `sound/`.

No Prettier was run. The requested code-golf skill was unavailable; the manual simplification pass kept one media element and the existing per-player audio lifetime, and skipped sound tracking work while audio is inactive.
