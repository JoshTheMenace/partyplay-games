# Sky Clash

Sky Clash is PartyPlay's platform fighter. One TV or laptop shows the fight, and 1 to 4 phones are the controllers. CPU fighters fill empty seats.

The game's cast is the **crew of the Reaches**, Sky Clash's own characters, on its own stages:

| New and original (the game) | Built |
| --- | --- |
| Fighters | Sola the lamplighter, Toll the bell-foundry automaton, Kes the kite-runner, Vesper the glasswright (six more are designed in [DESIGN.md](DESIGN.md)) |
| Stages | Beacon Rock, Bellyard |

Each of these was designed and made here: model, textures, rig, keyframed animation, frame data, hitboxes, specials, effects, costumes and portraits. They come first in every select screen and are the defaults for picks, Random, CPU fill and the stage.

A **legacy group** is still in the repository and still selectable in a separate, folded section of the select screens: the 33 fighters of `src/roster.ts` and the 30 stages after the arenas in `src/stages.ts`. That content came from an earlier version that reconstructed another game's roster from imported data ([REFERENCE.md](REFERENCE.md), `fidelity/`). It is frozen: nothing new is derived from it, it is not being polished, and the owner decides when it is removed. It still loads and plays, with its original look.

[DESIGN.md](DESIGN.md) holds the art direction, the planned cast and the technical design. [PIPELINE.md](PIPELINE.md) is the guide for building another fighter or stage.

## How to play

1. The host opens Sky Clash on the shared screen. Phones scan the QR code or enter the room code.
2. On a phone, pick a fighter of the crew (or Random), one of four costumes, and vote for an arena (or Random). Tap a picked fighter again for its stats and specials. Tap Ready. Picks survive a reload.
3. The host taps Start. The display loads models and the stage, counts down 3-2-1-GO, and the fight starts. Turn the phone sideways.
4. Hits raise damage. The higher it is, the farther you fly. Knock a rival past the blast zone to take a stock. The last fighter or team standing wins. GAME! (or TIME!) holds for two seconds, then the results show placements, KOs, falls and damage dealt.
5. Play again returns everyone to fighter select.

A lone player with no CPUs set gets one CPU rival. A disconnected fighter stands idle and forfeits after 20 seconds offline. At time up, the most stocks wins, then the lowest damage. Players still tied go to Sudden Death at 300% with one stock for 60 seconds, and share the win if nobody falls.

### Controls

| Action | Phone (landscape) | Keyboard |
| --- | --- | --- |
| Move, crouch, drop through a platform | Left pad | WASD or arrows |
| Attack (tilts and aerials by direction) | Tap Attack, the big bottom-right button | J |
| Smash attack (hold to charge) | Swipe across Attack in a direction, or flick the pad and tap Attack | I |
| Special (neutral, side, up, down) | Tap Special with the pad direction, or swipe across Special (swipe up = recovery) | L |
| Jump, air jump | Jump (tap for a short hop) | K or Space |
| Shield, dodge, air dodge | Shield (with a direction to roll or dodge) | Shift |
| Grab (with the pad held for a dash grab) | Grab, or Shield + Attack | U |
| Fast fall | Pad down while falling | S or Down |

The phone forgives the 20 Hz link: every press is buffered 8 frames, a Jump + Attack pair is a short-hop aerial, you get 5 frames of coyote time off edges, ledge snap is generous, and aerials land with their short landing lag automatically. A swipe is 28 px of travel or a quick flick on the button; a still thumb counts as a tap after 60 ms. A swipe's direction beats the pad.

### Settings (host)

| Setting | Options | Default |
| --- | --- | --- |
| Stocks | 1 to 5 | 4 |
| Time limit | 2, 3, 5, 8, 10 minutes or none | 8 minutes |
| CPU fighters | 0 to 3 (capped at 4 fighters) | 0 |
| CPU level | Easy, Normal, Hard | Normal |
| Teams | Two teams by seat, no friendly fire | Off |
| Stage hazards | On or off (legacy stages only; the arenas have none) | On |
| Stage | Players vote, Random arena, a fixed arena, or a fixed legacy stage | Vote |
| Manual landing cancel | Off: aerials always get the short landing lag. On: Shield within 7 frames of landing | Off |
| Recovery | Party (stronger air jumps and up specials) or Strict (exactly as each fighter is tuned) | Party |

## The crew

| Fighter | Archetype | Specials (neutral / side / up / down) | What sets it apart |
| --- | --- | --- | --- |
| **Sola** | All-rounder with reach | Cinder Lob / Pike Vault / Updraft / Kindle | A lantern-pike taller than she is: fast thrusts with the blade, slow burning arcs with the lantern |
| **Toll** | Heavy with armour | Knell / Ram / Steam Hoist / Bell Drop | A walking bell. Long wind-ups, armoured specials, every heavy hit rings |
| **Kes** | Fast and light | Gale Dart / Tailwind / Kite Lift / Downdraft | Three jumps, kicks with long lines, a kite that lifts him out of trouble; flies far when hit |
| **Vesper** | Zoner | Glass Bulb / Shard Fan / Bubble Lift / Kiln Mirror | A blowpipe with a molten gather: the longest reach, a slow drifting trap, a counter |

Every fighter has four costumes, a portrait and a full-body picture per costume (captured from the game's own renderer), and CPU play at three levels.

## The arenas

| Arena | Layout | Look |
| --- | --- | --- |
| **Beacon Rock** | A main floor with three platforms | A stone terrace at dusk under a turning lighthouse beam, a cloud sea below |
| **Bellyard** | One long flat deck with a single platform above the middle | A foundry deck in a storm: rain, furnace vents, great bells overhead, a cargo pallet on chains |

Both use genre-staple layouts and have no hazards. [STAGES.md](STAGES.md) has the numbers.

## Architecture

Server code runs in the room server. Browser code never imports it (the Vite build fails if `server.ts` enters the browser graph), and phones never download three.js or models: the display lazy-loads the scene.

| Path | What it does |
| --- | --- |
| `src/manifest.ts`, `src/model.ts` | The contract: 1 to 4 players, 60 Hz steps and 30 Hz snapshots, move ids, `Input`, `Settings`, `View`. `ROSTER` lists the crew first, then the legacy group. |
| `src/crew/` | The crew of the Reaches. `roster.ts` display data; `<id>/` each fighter's rig, stance, state clips, moves, specials and physics; `lib.ts` the shared authoring kit and state library; `build.ts` compiles authored data into what the simulation reads. |
| `src/anim/core.ts` | Keyframed poses, clips and the solver (two-bone IK, weapon aim, face, squash and stretch). Runs in the display and on the server, which is how hitboxes ride the animation. |
| `src/arenas.ts` | Collision for the arenas of the Reaches, in meters. |
| `src/server.ts` | `GameRules`: strict settings, input, action and lobby-choice parsing, create, tick, presence, public view and outcome. |
| `src/sim/` | Server-only engine shared by both generations. `fighter.ts` the state machine, `combat.ts` hits, clanks, grabs and throws, `common.ts` the single place damage and knockback apply, `formulas.ts`, `projectiles.ts`, `specials.ts` the data-driven specials runner, `cpu.ts`, `match.ts`, `harness.ts` a scripted arena for tests and tools. Seeded RNG, no clock reads. |
| `src/moveset.ts` | `MOVESET`, `TIMING` and `PHYSICS` for every fighter: the crew from `src/crew`, the legacy group from `fidelity/`. Browser-safe. |
| `src/specials.ts`, `src/specials/` | The special-kit types and runner data; the legacy kits. |
| `src/stages.ts` | Every stage. `stageFrame(id, tick, hazards)` gives server and renderer the same blocks, platforms, ledges and hazard. |
| `src/client.tsx`, `src/ui/` | Phone lobby, controller, host lobby board, settings, TV HUD and results. |
| `src/scene/` | The display scene. `index.tsx` mounts it and buffers snapshots; `pipeline.ts` is the HDR, bloom and tone-curve pass; `crew/` loads, colours, poses and animates crew fighters; `arena/` is the arena art, sky, light rigs, haze and rain; `camera.ts` frames the fight; `fx/` draws sparks, trails, shields, KO blasts and projectiles. `fighter/` and `stage/` are the legacy fighter and stage renderers. |
| `src/audio.ts`, `src/audio-view.tsx` | Host-only music and cue mixer. |
| `assets/` | Per fighter: `fighters/<id>.glb`, `costumes/<id>.json`, `models/<id>.json`, `portraits/<id>[-n].webp`, `renders/<id>[-n].webp`. Per arena: `stages/<id>.glb`, `models/<id>.json`. |
| `fidelity/`, `src/roster.ts`, `src/poses-table.ts`, `tools/blender/fighters/`, `tools/import_*.py` | The legacy group's data and tools. Frozen; do not run the importers. |

## Asset pipelines

Run these from the PartyPlay root. [PIPELINE.md](PIPELINE.md) explains each step.

```sh
# A crew fighter or an arena (Blender 5.2, headless): flat preview, then bake and export
blender -b --factory-startup --python-exit-code 1 --python packages/games/sky-clash/tools/blender/crew/<id>.py -- --stage color
blender -b --factory-startup --python-exit-code 1 --python packages/games/sky-clash/tools/blender/crew/<id>.py -- --stage full
python3 packages/games/sky-clash/tools/blender/crew/validate.py
# Labs: filmstrips with hitboxes, the display scene, every UI screen
npx vite --config packages/games/sky-clash/tools/lab.vite.config.ts --port 4430 --strictPort
node packages/games/sky-clash/tools/lab-shoot.mjs <out-dir> '<name>|<path?query>|<width>x<height>|ready|0'
# Portraits, full-body art and stage cards from the game renderer
packages/games/sky-clash/tools/crew-art.sh fighter <id> <head y> <portrait half-height> <body centre y> <body half-height>
packages/games/sky-clash/tools/crew-art.sh stage <id>
# Headless CPU balance and recovery report for the crew (--legacy for the old group)
node --import tsx packages/games/sky-clash/tools/balance.ts --seeds=8
```

Music was supplied by the user. Two sound effects are Kenney CC0 samples and the rest are generated by `tools/build_audio.py`. See [public/games/sky-clash/audio/CREDITS.md](../../../public/games/sky-clash/audio/CREDITS.md). The overhaul added no audio.

## Checks

```sh
node --import tsx --test packages/games/sky-clash/tests/*.test.ts
npx tsc -p game-modules/packages/games/sky-clash/tools/tsconfig.json      # Sky Clash only, about 20 s; `npx tsc --noEmit` for the whole repository
npx oxlint packages/games/sky-clash
npm run build:isolated -- <run> && HOST=127.0.0.1 npm run serve:isolated -- <run> <port>
node packages/games/sky-clash/tools/ui-lab/crew-flow.mjs http://127.0.0.1:<port> output/<dir> duel|solo|quad|legacy
```

`crew-flow.mjs` plays a real room: a display and phone pages join, pick fighters of the crew and an arena, fight (two human seats hit each other, or one phone against three CPUs), reach the results and play again. [QA.md](QA.md) records the latest results.

## Limits

- Four of the ten designed fighters and two arenas are built. Until more are, a four-player match of the crew has no spare picks.
- The look has been judged from software-rendered frames and filmstrips. Nobody has seen it on a real GPU, a real TV or physical phones, and frame rate there is reasoned, not measured.
- Faces are sculpted and animated (blink, brow, jaw) but simple, and cloth is rigid shells on spring bones, not simulated.
- CPUs play the crew with the general fighter brain: they rarely use specials well, and Vesper's zoning in particular is better in human hands.
- The legacy group keeps every limit it had (see git history of this file), including its reliance on imported data.
- The engine accepts a taunt action, but the controller has no taunt button yet.
