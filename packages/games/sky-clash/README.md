# Sky Clash

Sky Clash is a party version of Super Smash Bros. Melee for PartyPlay. One TV or laptop shows the fight, and 1 to 4 phones are the controllers. CPU fighters fill empty seats. It keeps Melee's content: all 33 fighter kinds, each regular fighter's own attributes and attack scripts imported from public Melee data dumps, and 30 stages. The engine, models, animation, effects, stage art, camera, phone controls, HUD and menus are new.

This is a fan reconstruction, not a port. No Nintendo code, models, textures or sounds ship with it. See [REFERENCE.md](REFERENCE.md) for sources and what could not be recovered.

## How to play

1. The host opens Sky Clash on the shared screen. Phones scan the QR code or enter the room code.
2. On a phone, pick a fighter (33 plus Random), one of four costumes, and vote for a stage (30 plus Random). Tap Ready. Picks survive a reload.
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

The phone forgives the 20 Hz link: every press is buffered 8 frames, a Jump + Attack pair is a short-hop aerial, you get 5 frames of coyote time off edges, ledge snap is about 30% wider than Melee's, and aerials auto L-cancel. Hosts can turn on Melee L-cancel in Settings. A swipe is 28 px of travel or a quick flick on the button; a still thumb counts as a tap after 60 ms. A swipe's direction beats the pad.

### Settings (host)

| Setting | Options | Default |
| --- | --- | --- |
| Stocks | 1 to 5 | 4 |
| Time limit | 2, 3, 5, 8, 10 minutes or none | 8 minutes |
| CPU fighters | 0 to 3 (capped at 4 fighters) | 0 |
| CPU level | Easy, Normal, Hard | Normal |
| Teams | Two teams by seat, no friendly fire | Off |
| Stage hazards | On or off (terrain still moves when off) | On |
| Stage | Players vote, Random, or a fixed stage | Vote |
| Melee L-cancel | Off: aerials always get the L-canceled landing lag. On: Shield within 7 frames of landing | Off |

## Roster

27 regular fighters with imported Melee data: Mario, Fox, Captain Falcon, Donkey Kong, Kirby, Bowser, Link, Sheik, Ness, Peach, Popo, Nana, Pikachu, Samus, Yoshi, Jigglypuff, Mewtwo, Luigi, Marth, Zelda, Young Link, Dr. Mario, Falco, Pichu, Mr. Game & Watch, Ganondorf and Roy.

Six bonus fighters borrow a regular fighter's data profile and get their own kits: Master Hand, Crazy Hand, Male Wireframe, Female Wireframe, Giga Bowser and Sandbag. Random picks only from the 27 regulars.

Every fighter has its four specials (names in `src/roster.ts`), four costumes, a full-body render and a portrait per costume.

## Stages

Thirty stages with real Melee names: Battlefield, Final Destination, Yoshi's Story, Dream Land, Fountain of Dreams, Pokémon Stadium, Princess Peach's Castle, Rainbow Cruise, Kongo Jungle, Jungle Japes, Great Bay, Temple, Brinstar, Brinstar Depths, Yoshi's Island, Green Greens, Corneria, Venom, Poké Floats, Mute City, Big Blue, Onett, Fourside, Icicle Mountain, Mushroom Kingdom, Mushroom Kingdom II, Flat Zone, Yoshi's Island 64 and Kongo Jungle 64, plus Cloudbreak, an original bonus stage.

The six tournament stages use community-documented Melee widths, platform heights and blast zones. The other 24 are Melee-scale estimates of each stage's layout. Moving pieces, transformations and hazards (Randall, the Great Bay turtle, the Stadium transformations, Whispy's wind, Arwings, cars and so on) warn before they strike. [STAGES.md](STAGES.md) lists every stage's numbers, features and simplifications.

## Architecture

Server code runs in the room server. Browser code never imports it (the Vite build fails if `server.ts` enters the browser graph), and phones never download three.js or models: the display lazy-loads the scene.

| Path | What it does |
| --- | --- |
| `src/manifest.ts`, `src/model.ts`, `src/roster.ts` | The contract: 1 to 4 players, 60 Hz steps and 30 Hz snapshots, rig and costume rules, move ids with their Melee script names, `Input`, `Settings`, `View`. `roster.ts` is generated. |
| `src/server.ts` | `GameRules`: strict settings, input, action and lobby-choice parsing, create, tick, presence, public view and outcome. |
| `src/sim/` | Server-only engine. `fighter.ts` is the state machine, `combat.ts` hits, clanks, grabs and throws, `common.ts` the single place damage and knockback apply, `formulas.ts` the Melee formulas, `projectiles.ts`, `specials.ts` the data-driven specials runner, `cpu.ts` CPUs, `match.ts` match flow and views, `harness.ts` a scripted arena for tests and tools. Seeded RNG, no clock reads. |
| `fidelity/` | Imported Melee data: attributes, physics helpers, attack command streams (`scripts.ts`, `actions.ts`) and the pinned dump hashes (`roster.json`). |
| `src/moveset.ts` | Compiles the command streams into `MOVESET` (frame windows, hitboxes, throws, charge, IASA), `TIMING` and `PHYSICS`. Browser-safe. |
| `src/specials.ts`, `src/specials/` | Every fighter's special kit as data on its real SpecialN/S/Hi/Lw windows. |
| `src/poses-table.ts` | Fighter by move pose and striking limb, used by the engine for `hits[].limb` and by the renderer. |
| `src/stages.ts` | All 30 stages. `stageFrame(id, tick, hazards)` gives server and renderer the same blocks, platforms, ledges and hazard. |
| `src/client.tsx`, `src/ui/` | Phone lobby, controller, host lobby board, settings, TV HUD and results. |
| `src/scene/` | The display scene. `index.tsx` mounts it and buffers snapshots, `camera.ts` frames the fight, `stage/` builds collision-exact stage art, `fighter/` loads, recolors, poses and animates the GLBs, `fx/` draws sparks, trails, shields, KO blasts and projectiles. |
| `src/audio.ts`, `src/audio-view.tsx` | Host-only music and cue mixer. |
| `assets/` | Per fighter: `fighters/<kind>.glb`, `costumes/<kind>.json`, `models/<kind>.json` (prop visibility, extra bones), `portraits/<kind>[-n].webp`, `renders/<kind>[-n].webp`. |

## Asset pipelines

Run these from the PartyPlay root.

```sh
# Fighters (Blender 5.2): build, render, validate. No kinds = all 33 plus a lineup.
game-modules/packages/games/sky-clash/tools/blender/build_all.sh [kind ...]
# Portraits and renders only, one per costume
blender -b --factory-startup --python-exit-code 1 --python game-modules/packages/games/sky-clash/tools/blender/render_sheet.py -- <kind ...> --only portrait,render
# Re-import move data from the pinned dumps in output/melee-fidelity
python3 packages/games/sky-clash/tools/import_moves.py
# Audio cues
python3 packages/games/sky-clash/tools/build_audio.py
# Stage map cards: start the Stage Lab, then shoot the "card" variant
npx vite --config packages/games/sky-clash/tools/stage-lab/vite.config.ts
node packages/games/sky-clash/tools/stage-lab/shoot.mjs all card
# Pose Lab for animation sheets
npx vite --config packages/games/sky-clash/tools/pose-lab/vite.config.ts
# Headless CPU balance and recovery report
node --import tsx packages/games/sky-clash/tools/balance.ts all
```

`tools/blender/README.md` is the model guide: rig contract, body plans, costumes, budget (20k triangles, 1.5 MB, no textures) and the quality checklist.

Music was supplied by the user. Two sound effects are Kenney CC0 samples and the rest are generated by `tools/build_audio.py`. See [public/games/sky-clash/audio/CREDITS.md](../../../public/games/sky-clash/audio/CREDITS.md).

## Checks

```sh
node --import tsx --test packages/games/sky-clash/tests/*.test.ts
npx tsc --noEmit
npx oxlint packages/games/sky-clash
npm run build:isolated -- <run> && npm run serve:isolated -- <run> <port>
PLAYWRIGHT=<playwright/index.mjs> node packages/games/sky-clash/tools/ui-lab/smoke.mjs http://localhost:<port> output/<dir>
```

`smoke.mjs` plays a real room: a display and two touch phones pick fighters, costumes and a stage, fight 2 Hard CPUs with real touches until GAME!, then replay. `flow.mjs` in the same folder checks lobby reload, audio and input release. [QA.md](QA.md) records the latest results.

## Limits

- It is not frame-exact Melee. Hitboxes on non-root bones sit on an authored anchor model instead of real bone transforms. Common constants are Melee's documented values, not read from `PlCo.dat`. There is no original executable to compare against.
- Specials for Mario, Fox, Marth and Kirby are the most faithful. The rest are reconstructions on real script windows, with estimates labelled in the kit files. Picking Popo or Nana brings the other as a partner who echoes the leader's inputs 6 frames late and shares the leader's stock; there is no paired belay, grab or wobbling. Kirby's Inhale does not copy abilities.
- Only the six tournament stages use Melee's documented numbers. Scrolling stages use a fixed camera over a looping treadmill.
- Hard CPUs still self-destruct in about 4 to 5% of KOs on moving stages (0 found on the six tournament stages). CPUs rarely use specials.
- Costume variants recolor materials only. Alternates that add accessories in Melee (Pikachu's hats, Pichu's goggles) are tints here.
- The engine accepts a taunt action, but the controller has no taunt button yet.
- Play again clears lobby picks. This is platform behaviour for every game.
- Evidence so far is headless Chromium with emulated touch and software GL. Nobody has checked physical phones, a real TV, frame rate on a real GPU or how it feels to play.
