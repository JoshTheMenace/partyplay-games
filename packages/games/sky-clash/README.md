# Sky Clash

A playable PartyPlay platform fighter for **2–4 players**, with all **33 internal fighter kinds** found in the Melee decompilation, authored Blender models, and Fable-authored UI and animations. It uses published character attributes and normal attack scripts from Melee research. Missing engine behavior is reconstructed. Twenty-seven regular forms retain imported profiles; six bonus entities use explicitly adapted stock-match profiles. This is not a frame-identical port.

## Play

Open Sky Clash in PartyPlay, create a shared-display room, and join with 2–4 phones. After entering a name, each player chooses a fighter, votes for a map and taps Ready while waiting for friends. Fighter Details opens stats without shrinking the scrollable roster. Not ready unlocks both choices for editing. Draft choices and votes survive reload/reconnect; changing games or replaying clears them.

The host starts when everyone is Ready. The most-voted map wins; the round seed breaks ties among leaders. Selection does not run a second time: scene preparation leads directly to the three-second countdown and combat. The earlier timed selection/voting flow remains a rules fallback for clients without lobby choices.

Matches default to **15 minutes** with three stocks. Settings also offers 1/5/10/30 minutes and **Unlimited**, which ends when one fighter remains. Last survivor wins. At a finite deadline, stocks rank first, then lower damage; eliminated players rank by KOs. Exact ties share the result. Replay starts a fresh lobby in the same room. Disconnects release input; reconnect within 15 seconds to keep the fighter, otherwise forfeit.

Character/map menus work in portrait or landscape. Combat requires landscape. Full screen uses the browser API after a tap when supported; unsupported browsers show Screen tips. Controls follow the visual viewport height/offset, so browser toolbars and the keyboard can shrink the available area. Safari home-screen mode is enabled by the shared page metadata. Physical browser toolbar behavior still needs device testing.

| Control | Behavior | Keyboard |
| --- | --- | --- |
| Move | Walk with a light stick; run at the edge. Down fast-falls or drops through upper platforms. | WASD / arrows |
| Jump | Tap for a short hop, hold for full height; press again for remaining air jumps (six total jumps for Kirby/Jigglypuff). | K / Space |
| Attack | Neutral jab, directional tilts; neutral, forward, back, up or down aerials. Hold to repeat. | J |
| Smash | Side/up/down smash on the ground. Hold to charge, release to strike. In air, directional aerial. | I |
| Special | Neutral/side/up/down selects the four named specials shown on your phone. Up recovery can be aimed during windup. | L |
| Shield | Ground guard; in air, directional dodge followed by freefall. Jump out of guard. | Shift |

Fox runs faster than Falco and fires non-flinching lasers. Falco jumps higher, weighs more, fires stunning lasers, and has different launch angles and damage on several attacks. Air recovery is limited until landing; getting hit restores the recovery opportunity. Shields drain and regenerate, break into stun, and absorb attacks. Blast zones remove stocks; respawn gives brief protection. Attacking cancels that protection.


## Roster

Mario, Fox, Captain Falcon, Donkey Kong, Kirby, Bowser, Link, Sheik, Ness, Peach, Popo, Nana, Pikachu, Samus, Yoshi, Jigglypuff, Mewtwo, Luigi, Marth, Zelda, Young Link, Dr. Mario, Falco, Pichu, Mr. Game & Watch, Ganondorf and Roy use their own published movement profiles and normal attack commands. The count treats alternate forms and the two Ice Climbers separately.

| Adapted bonus choice | Borrowed movement / normal-attack profile |
| --- | --- |
| Master Hand / Crazy Hand | Mewtwo |
| Male Wireframe | Captain Falcon |
| Female Wireframe | Zelda |
| Giga Bowser | Bowser |
| Sandbag | Mario |

All 33 have individual roster metadata and replacement GLBs. `fidelity/roster.json` pins the 27 source dump hashes, archive/node names, source enum indices, authored body dimensions and bonus mappings. `src/roster.ts` is generated from it. `src/specials.ts` contains explicit reconstructed kits: projectile speed/gravity/bounce, rush/recovery travel, reflection, absorption, counters, armor and Pichu recoil differ by fighter. Inhale, egg lay, singing, item/partner systems and transforming are simplified attacks or movement; their original state machines are not reproduced.

## Character assets

The 33 authored Blender replacements use smooth curved surfaces, rounded joint covers, beveled costume edges, layered clothing, modeled facial details, and separate cloth/metal material finishes. Accessories include cap letters, uniform stitching, buckles, gauntlets, shield crests, shell plates, hood fur and glove details. Character-select portraits are rendered at 512×512. The original 20-bone rigs, animation code, fighter dimensions, stats and hit detection are retained.

`tools/build_roster.py` builds the shared forms with profile-ring meshes and character-specific details; `tools/build_fox.py` builds the two pilots. Smooth normals and omission of unused UVs keep the full uncompressed GLB roster below 20 MiB, with no model texture downloads. The display preloads it with four concurrent requests; phones use portraits only. Reimport validation checks all weights, finite geometry and scale, and actor tests exercise every fighter's moves in both directions. These remain stylized replacements, not recovered original models.

## Maps

The 29 standard versus stages in the pinned decompilation each have an authored counterpart, alongside Cloudbreak. Target tests, adventure routes, debug rooms and unused entries are outside this versus roster. [STAGES.md](STAGES.md) maps all 30 choices to their references.

Cloudbreak’s original central side platforms are 1.5 world units above the floor, with the central upper platform at 3.0. Every roster profile can climb these steps with a held full jump, preserving imported character physics. Tap Jump still produces a short hop.

All thirty arenas now span 34–60 world units. Twenty-nine have 14–23 surfaces, including outer islands, rooftops, stepped routes and moving crossings. Sunken Temple spans sixty units with a central twelve-unit-travel lift, courtyards and an upper ridge; Glacier Ascent reaches a fifteen-unit summit with three lifts. Event Horizon remains a single forty-unit dueling platform. These are authored expansions, not scaled original coordinates.

During combat the camera frames the living fighters, then smoothly pulls back as they separate. This keeps nearby fighters readable without losing access to the wider routes. Preparation and map screenshots show the full arena.

Each arena has its own geometry, scenery, bounds and safe spawn surfaces. Features include a wide temple with a lower refuge, split rooftops, orbiting ledges, ferries, rescue platforms, a vertical glacier, moving fountain platforms, racing vehicles, pixel scenery and a single cosmic platform. Lava, wind, traffic, pulse blasts and geysers follow deterministic cycles; harmful hazards have a two-second warning and a one-second per-fighter hit cooldown. Hazards off removes damage and wind; platforms keep moving.

`src/stages.ts` is the shared stage definition and simulation clock. The server uses its surfaces for landing, platform carry, projectiles, respawns and blast zones. Fable's scene uses those same surfaces for the camera, feet and landing cues; `src/stage-scene.ts` builds the original Three.js scenery. Visual and physical movement stay aligned in reduced-motion mode. Validated per-seat lobby choices and the resolved stage ID travel through the existing room runtime. Map cards use WebP screenshots rendered from this same stage geometry and production lighting, not diagrams.

Original stage DAT assets, exact collision coordinates, full scrolling/rotating terrain, destructible scenery, stadium terrain transformations and original hazard state machines are unavailable or not reproduced. These maps preserve broad layout ideas and visual motifs, with explicitly authored mechanics. The orbital ledges stay horizontal; the glacier uses elevators rather than a scrolling kill plane; the stadium cycles colors and ledge heights rather than replacing terrain.

## What is reused

`fidelity/attributes.ts` contains **53 scalar attributes for each of 27 regular fighter forms**, mapped by offsets in the pinned decompilation header. Movement preserves per-character run/walk, jump startup, full/short/double-jump velocities, air drift, gravity, fast-fall, weight and landing-lag values. World units are converted with one scale (`UNIT = .08`), rather than replacing the character tuning.

`src/moves.ts` expands the preserved raw normal-attack commands into frame windows. It preserves hitbox damage, radii, launch angles, base/growth/fixed knockback, ground/air masks, early/late changes, interruptibility, autocancel windows and repeated-hit groups. Twelve normal attack families per fighter are accessible. Nana retains her own command stream and borrows Popo’s animation names/durations; Peach uses the first damaging forward-smash weapon variant. Fox's seven drill hits and Falco's early/late down-air are different scripts.

`src/server.ts` runs the fight at 60 Hz. It uses the original scalar air helpers, sourced move windows, reconstructed 2D collision anchors and knockback/common constants. It owns hit resolution, stock loss, projectiles and results. All simultaneous contacts are captured before resolution so roster order does not prevent trades. The existing PartyPlay room handles joins, readiness, reconnect and replay.

`src/model.ts` defines the shared view and inputs. Press counters preserve taps through the platform's 20 Hz input coalescing; public snapshots are 30 Hz. This is server-authoritative networking without rollback. `src/client.tsx`, `scene.tsx`, `rig.ts` and `animation.ts` are Fable's UI/rendering/animation implementation. The phones do not construct a 3D world. Models load before the shared scene reports ready.

## Music and sound

The host display plays `smashlobby` continuously during the lobby, scene preparation, fighter selection, map voting and countdown. Matches rotate through Adventure Forward, Adventure's Final Frontier, 冒険の序曲 and Triumph of the Brave (Remastered). Songs crossfade at phase changes and advance when they end. The round's track choice survives reload; results fade out the music and play a short result cue.

The existing Sound button controls the entire mix. Music and effects pause when muted, backgrounded, disconnected or missing current snapshots. Phones and secondary displays do not download or play this audio. A browser may require a click or keypress before playback. Original MP3 audio frames are preserved; full-length songs stream through media elements instead of being decoded into large Web Audio buffers.

`src/audio.ts` derives confirmed hit, swing, jump, landing, projectile, shield, KO, selection, countdown and hazard cues from snapshots. Duplicate/reconnect snapshots are silent. The mixer uses stereo panning, per-effect throttles, a 12-voice limit and a compressor. `AudioView` uses the optional shared audio lifecycle hook to retain one mixer across lobby, preparation, play and results, independently of renderer teardown. `tools/build_audio.py` creates ten small cues; impact and swing samples are CC0 Kenney sounds. Track hashes and credits are in `public/games/sky-clash/audio/` in the games repository.

## Reconstruction limits

The public data's exact game revision is unverified. Original costume meshes, bone animation samples and common/special parameter banks were unavailable. Every fighter uses a newly authored replacement mesh. Popo and Nana fight independently; Zelda and Sheik are separate choices with a burst replacing transformation. Bosses, wireframes and Sandbag use documented borrowed profiles. The stages, collision anchors/hurt capsules, visual attack poses, special travel/timing, laser behavior, shields, DI, hitlag/hitstun and common knockback constants include reconstruction. Sourced attack values do not make the resulting balance identical.

The current slice omits grabs/throws, jab chains/rapid jab, dash attacks, ledge grabbing/options, techs, L-canceling, grounded rolls, stale-move queue, crouch canceling, hitbox clanks and full original collision-state flags. It includes stock/time play on 30 authored stages; no items, CPU opponents or single-player campaign. See [REFERENCE.md](REFERENCE.md) for provenance and [QA.md](QA.md) for actual checks and hardware limits.

## Build and test

From the PartyPlay root (never rebuild a directory serving a live session):

```sh
node --import tsx --test packages/games/sky-clash/tests/*.test.ts tests/registry-contract.test.ts tests/catalog.test.ts
npm run typecheck
# Optional game-only check (physical submodule path):
node_modules/.bin/tsc -p game-modules/packages/games/sky-clash/tsconfig.playable.json --noEmit
npm run build:isolated -- sky-clash-your-unique-run
npm run serve:isolated -- sky-clash-your-unique-run 4390
```

The isolated reference viewer under `lab/` remains available separately; it is not included as a development fixture in the normal game catalog. `tools/build_fox.py` generates Fox by default and Falco with `-- --falco`; `tools/verify_fox.py` reimports either export. `tools/build_roster.py` generates the other 31 rigs and all portraits; `tools/verify_roster.py` reimports the entire roster and renders `assets/roster-review.png`. Game source and assets belong to the `game-modules` repository. No staging, commits, pushes or publication are part of this change.

`tools/map-preview.ts` is an asset-authoring entry, separately bundled into an ignored fixture. It renders each stage at 640×360 using production geometry and lighting. Captures are exported as WebP under the games repository’s `public/games/sky-clash/maps/`; the fixture itself is excluded from the normal catalog build. `src/selection.tsx` shares portraits, map images and detail dialogs between lobby and legacy selection. `src/lobby.tsx` implements the two-step setup UI; `parseLobbyChoice` validates drafts and complete ready choices on the server.
