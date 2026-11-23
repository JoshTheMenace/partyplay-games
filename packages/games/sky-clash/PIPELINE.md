# Sky Clash: building a fighter or a stage of the Reaches

This is the working guide for adding to the crew of the Reaches. It records what the four built fighters (Sola, Toll, Kes, Vesper) and two stages (Beacon Rock, Bellyard) taught, in the order you do the work. [DESIGN.md](DESIGN.md) has the art direction and the planned cast; read its "storm-lit maquette" section first.

Everything is made here. No downloaded models, textures, rigs or animation, and no other game as a reference: not for shapes, not for names, not for numbers.

## What a fighter is

| Piece | File | Made by |
| --- | --- | --- |
| Model script | `tools/blender/crew/<id>.py` | you |
| Model, maps, rig description | `assets/fighters/<id>.glb`, `assets/models/<id>.json`, `assets/costumes/<id>.json`, `src/crew/<id>/rig.ts` | the script (never edit by hand) |
| Stance and state clips | `src/crew/<id>/states.ts` | you, through `makeStates` in `src/crew/lib.ts` |
| Moves, specials, kit | `src/crew/<id>/moves.ts` | you |
| Physics, element, springs | `src/crew/<id>/index.ts` | you |
| Roster entry | `src/crew/roster.ts`, `src/crew/index.ts` | you (two lines each) |
| Portraits and full-body art | `assets/portraits/<id>[-1..3].webp`, `assets/renders/<id>[-1..3].webp` | `tools/crew-art.sh` |

Nothing else changes. The simulation, the renderer, the lobby, the CPU and the tests pick a fighter up from `CREW` and `CREW_DEFS`.

## 0. The sheet

Before any code, write the fighter's row in DESIGN.md: trade and identity, one big shape, one silhouette breaker, archetype, palette (a dominant, a secondary, one accent, one emissive element colour) and the four specials by name and idea. Check it against the cast: no shared big shape, no shared element colour, no shared weapon handling. If two rows could swap silhouettes, redesign one.

## 1. The model (`tools/blender/crew/<id>.py`)

Blender 5.2, headless, CPU. A script builds `Part`s in character space (meters, +X the fighter's left, +Y up, +Z forward, feet at y = 0), each with a material slot, UVs and bone weights painted by rule. `kit.py` is the toolbox; `body.py` and `head.py` are the humanoid builders. Read `sola.py` (weapon, coat, sculpted face), `kes.py` (unarmed, kite and ribbons), `vesper.py` (robe that follows the legs) and `toll.py` (hard-surface, no sculpted face) and start from the nearest.

```
blender -b --factory-startup --python-exit-code 1 --python packages/games/sky-clash/tools/blender/crew/<id>.py -- --stage color   # 15 s: flat colours, four views, output/skyclash-pass/models/<id>-color-body.png
... -- --stage clay --view face     # modelling review without colour
... -- --stage full                 # 45 s: UV pack, bake (Cycles), GLB, metadata, rig.ts
... -- --stage rig                  # 10 s: rewrite metadata, costumes and rig.ts only (after changing colours, glow, joints or anchors)
```

Rules that held for all four:

- **Skeleton.** `humanoid(...)` gives the contract bones from left-side joints. Arms rest 40 degrees below horizontal. Add `face_joints` (jaw, lids, brows) and `hand_joints` (two finger bones and a thumb per hand) even on a machine: Toll's lids are shutters and his jaw is a grille, and the same face channels drive them. `prop` is required; with no weapon, put it in the right palm.
- **Proportion.** About 6.5 heads; hands and feet 15 to 20 percent large. Stand the script's numbers against a built fighter: Sola 1.72 m, Kes 1.60 m, Vesper 1.82 m, Toll 2.0 m.
- **Form in layers.** Body first (`torso`, `loft` limbs), then clothing as `shell`s with thickness that sit a centimetre off it, then belts, straps, trims (`strip`, `torus`), then hard details (`box`, `disc`, `lathe`). Every hem and cuff gets a turned lip or a trim. A single smooth tube reads as a toy; two overlapping layers with an edge between them read as a costume.
- **Slots are the palette.** One slot per material you want to recolour, at most 20, each with a `surface` from `SURFACES` (cloth, wool, leather, skin, hair, metal, iron, bronze, wood, glass, eye, glow, flat). The bake writes neutral value (ambient occlusion, gradient, wear, weave) and the game multiplies the costume's colour in, so four costumes share one bake. `mask` builders put a second colour where you want pattern (`mask_ellipsoids` for lips and blush, `mask_noise` for patina, or your own nodes as on Kes's kite).
- **One emissive slot** carries the element colour. Keep `glow` between 1.0 and 1.5: above that large areas burn to white. Only emissive slots may bloom; the shader holds everything else just under white.
- **Weights by rule.** `chain([...bones], [...joints], soft)` for limbs, `by_height` for the trunk, `mix` to blend two rules, `.bone(name)` for rigid parts. Clothing that crosses a joint takes the same rule as the body under it. Skirts that must not clip are split and weighted to each leg (Vesper's robe), or cut short and given spring tails (Sola's coat).
- **Secondary motion.** Any bone named `extra_<chain>_<n>` becomes a damped pendulum in the game. Give every fighter at least two chains (tails, scarf, ribbons, braid, a hanging tool). Tune them in `index.ts` under `springs`: `[stiffness, damping, gravity, max swing in degrees]`.
- **Anchors** name the points the moves will use: hitboxes, trails and effect cues attach to them. Put one on everything that strikes (weapon tip, mid and butt; fists, elbows, knees, feet, crown).
- **Costumes.** Four, by overriding slot colours with `costume(name, slot='#hex', slot_p='#hex')`; `swatch=(slot, slot, slot)` picks the three colours the menus show. Change the dominant and the element colour in each; keep skin except where a costume is plainly another person's look.
- **Budgets** (tests enforce): 50,000 triangles, 3 MB, two 1024 px maps. The four built fighters are 28k to 49k triangles and 1.4 to 2.1 MB.

Then `blender -b --factory-startup --python-exit-code 1 --python packages/games/sky-clash/tools/blender/crew/validate.py -- <id>` (bones and world-aligned rest frames, four or fewer normalised weights per vertex, UVs inside the square, slots match the metadata, budgets).

## 2. Stance and states (`src/crew/<id>/states.ts`)

Animation is keyframed pose data solved by `src/anim/core.ts`; the display and the server run the same solver. A pose is a handful of channels:

| Channel | Meaning |
| --- | --- |
| `hips: [x, y, z]`, `lean`, `turn`, `roll` | pelvis offset in meters and tilt in degrees; the legs follow through the foot targets |
| `spine`, `chest`, `neck`, `head`: `[bend, twist, side]` | degrees per bone |
| `armL`, `armR` | by angles `{ fwd, out, bend, twist }` (follows the body), by wrist target `{ to: [x, y, z], pole }` (strikes and holds), or `{ grip: d }` for the off hand on the weapon |
| `aim: [pitch, yaw, roll]` | where the weapon points (0 forward, 90 up) |
| `footL`, `footR`: `[x, y, z, toe pitch, toe yaw]` | ankle offset from its rest spot; two-bone IK does the knee |
| `gripL`, `gripR`, `face: [blink, brow, jaw]`, `stretch` | hands, expression, squash and stretch |
| `spin: [pitch, yaw, roll]`, `lift` | the whole figure about its hips: flips, rolls, lying down |

Write the `STANCE` first and look at it. It is the base every clip's keys merge over, and it carries the character: Sola's pike guard, Toll's low boxer's guard, Kes on the balls of his feet, Vesper upright with a hand behind her back.

`makeStates(RIG, STANCE, carriage, style)` then builds all 38 state clips. You give it the **carriage** (how the arms and gear sit in each family of states: breathing, walking, running, crouched, rising, falling, hurt, shielding, tucked, hanging, grabbing, held, down, dazed, plus the personal win, lose and select poses) and a few **style** numbers (leg length relative to 0.83 m, run lean, bounce, heaviness, loop lengths). The library supplies legs, hips, trunk, timing, squash and stretch, scaled to the fighter. Both arms of a carriage pair must be posed the same way (both by angles or both by target) so they blend. Replace any single clip afterwards if the fighter needs its own (Sola's whole set is hand-written and is the reference for what a clip looks like).

## 3. Moves (`src/crew/<id>/moves.ts`)

One `CrewMove` per move id: `jab1` (and `jab2`, `jab3` if the jab chains), `ftilt`, `utilt`, `dtilt`, `dash`, `fsmash`, `usmash`, `dsmash`, `nair`, `fair`, `bair`, `uair`, `dair`, `grab`, `dashgrab`, `pummel`, `fthrow`, `bthrow`, `uthrow`, `dthrow`, `ledgeattack`, `getupattack`, `taunt`. Each has a name of its own, a `total` in frames, a `clip`, and `hits`:

```ts
fsmash: { name: 'Great Knell', total: 62, iasa: 58, charge: 9, hits: [h(24, 29, 'fistR', .5, 22, 40, 35, 100)], trail: FR([21, 30]), cues: [{ f: 24, kind: 'ring', at: 'fistR' }],
  clip: clip([k(1, windUpStart), k(9, coiled, 'out'), k(21, coiledDeeper, 'out'), k(24, contact, 'snap'), k(30, followThrough, 'out'), k(44, settle), k(62, {}, 'io')]) },
```

- `h(from, to, anchor, radius, damage, angle, base knockback, growth)`: the hitbox rides that anchor through the clip; the server samples the same clip, so the hitbox is wherever the fist or blade is on that frame, swept between frames. Never place a hitbox by hand in space; move the pose.
- **Key the clip on the move's own frames.** Frame 1 is the first frame. The contact key sits on the first active frame with ease `'snap'`; the key before it is the deepest point of the wind-up with `'out'`; hold the contact pose (a second, nearly identical key) through the active frames; end with `k(total, {}, 'io')` back to the stance. `charge` is the frame a smash holds on, so put the coiled key there.
- **Every attack has three poses you could draw:** anticipation that leans away from the target, a contact pose with one clean line from the back foot through the striking point, and a follow-through that overshoots before settling. If the contact pose is not readable as a silhouette, fix the pose before touching timing.
- **Weight.** Hips lead: shift and turn the pelvis into the hit a key before the limb arrives. Squash on the wind-up and on landings (`stretch: -.05`), stretch on the reach (`+.05`). Heavies get longer wind-ups and held contacts; light fighters get one-frame snaps and long recoveries of the limb.
- `trail` draws a smear between two anchors over a frame range; `cues` fire one-shot accents (`step` dust, `flare` at an anchor, `burst` from the ground, `swish` crescents, `ring`s); `aura` draws a glassy sphere at an anchor. Tint comes from the fighter's `element`.
- Frame data is yours to author: decide the archetype's speed and reward and write numbers that fit it. As a scale, among the built fighters jabs start on frame 3 to 6 and deal 2 to 5, tilts start on 5 to 11 and deal 6 to 12, smashes start on 13 to 24 and deal 13 to 22 with growth 80 to 100.

**Specials** live in `SPECIALS` (scripts per phase, same shape as a move) and `KIT` (phase flow, movement, projectiles, armour, counters: see `src/specials/types.ts`). Each fighter has four of its own, and the up special must bring it back to the stage: the recovery test parks a CPU at six offstage spots per arena. New projectile kinds need a look in `src/scene/fx/projectiles.ts` (a test fails if one falls back to the generic orb).

## 4. Look at it

Start the lab server once (`npx vite --config packages/games/sky-clash/tools/lab.vite.config.ts --port 4430 --strictPort`; after adding a new GLB, `touch src/scene/crew/model.ts` so the glob sees it) and shoot filmstrips of the real simulation in the real renderer with the hitboxes drawn:

```
node packages/games/sky-clash/tools/lab-shoot.mjs output/skyclash-pass/<id> \
  '<id>-view|/pose-lab/crew.html?kinds=<id>&mode=turn&clip=idle&frame=20&yaws=-72,-30,20,150&cam=0,.95,1.15&cell=440x640|1760x680|ready|0' \
  '<id>-ground|/pose-lab/crew.html?kinds=<id>,sola&do=0:0.place(-1,1);0:1.place(.3,-1);4:0.press(attack,0,0);5:0.free();60:0.press(attack,1,0);61:0.free()&ticks=8,11,66,70,74&cam=-.3,1.2,1.8&cell=300x360&cols=8|2420x780|ready|0'
```

Script verbs per fighter index: `place(x, facing[, height])`, `press(attack|smash|special|jump|grab, aimX, aimY)`, `hold(x, y)`, `free()` (always free the stick after a press, or the fighter walks off), `dmg(percent)`. Shoot the turnaround, locomotion, ground attacks, smashes, aerials and specials. Judge motion from these strips, not from a live browser on a box without a GPU.

What to look for, in order: the silhouette at game size (the fighter is about 150 px tall at 720p), the contact pose of every attack, feet that slide or legs that hyperextend, cloth passing through the body, hitboxes that are not on the thing that hits.

## 5. Register, test, art

1. Add the id to `CREW` and its display row to `CREW_DATA` in `src/crew/roster.ts`; add the definition to `CREW_DEFS` in `src/crew/index.ts`.
2. `npx tsc -p game-modules/packages/games/sky-clash/tools/tsconfig.json` (20 s, Sky Clash only) and `node --import tsx --test packages/games/sky-clash/tests/crew.test.ts`. The crew tests cover every fighter in `CREW` with no per-fighter code: complete moves and phases, anchors, budgets, every clip solving on every frame, hitboxes on their anchors, every attack and special connecting, recovery, and CPU matches to a finish.
3. `packages/games/sky-clash/tools/crew-art.sh fighter <id> <head y> <portrait half-height> <body centre y> <body half-height>` for the portraits and full-body art of all four costumes.
4. `node --import tsx packages/games/sky-clash/tools/balance.ts --seeds=4` and tune until no fighter of the crew wins much more than six in ten or much less than four in ten of its CPU matches, and no special carries most of a fighter's damage.
5. A real room: join from a phone page, pick the fighter, play a match against CPUs to the results screen and replay.

## A stage

`src/arenas.ts` holds the collision in meters (blocks, platforms, spawns, blast zone, camera box); keep to genre-staple layouts. `tools/blender/crew/<id>.py` models the art to the same numbers (`beacon_rock.py`, `bellyard.py`): walkable tops and walls exact, everything else dressing, one mesh, at most 16 slots, a 2048 px bake, under 60,000 triangles and 4 MB. Stage surfaces (`stone`, `rock`, `planks`, `plate`, `grate`) pick a tiling pattern the arena shader draws in world space, so courses and planks stay crisp. Then give the stage a `Look` in `src/scene/arena/index.ts`: light rig (a key, a sky fill, a rim that outlines the fighters), haze, sky and cloud-sea colours, lamp colour and power, motes, rain, and the grade. Keep the gameplay plane lower in contrast than the fighters and let the rim light do the separating. `tests/arenas.test.ts` checks the model against the collision, the ledges and the platforms; `tools/crew-art.sh stage <id>` shoots the card.

Commands: `... bellyard.py -- --stage color` (flat preview), `--stage full` (bake and export, about 90 s), `--stage meta` (palette, glow and anchors only).

## The bar

A fighter is done when, in the lab strips and in a room:

- the silhouette is recognisable at 150 px and unlike every other fighter's;
- the portrait holds up at 512 px: the face reads as a person, the eyes are alive, the costume has edges and layers;
- idle, walk, run, jump and land each look like this character and no other;
- every attack shows a wind-up, a contact pose and a settle, with the hitbox on the striking part;
- every special has its own shapes and colour;
- all crew and arena tests pass, and the CPU can play it to a finish.

If it reads as a toy (smooth tubes, one layer, glossy plastic), the fix is almost always more layers and edges in the model, not more shader.

## Effort

For someone who has read this guide and one existing fighter end to end, in this environment:

| Step | First pass | With review and fixes |
| --- | --- | --- |
| Sheet | 15 min | 30 min |
| Model script to a baked GLB | 1 h | 2 to 3 h (two or three look-and-fix rounds at 45 s a build) |
| Stance and carriage | 20 min | 45 min |
| 23 normals with clips | 1 h | 2 h |
| Four specials, kit, projectile looks | 40 min | 1.5 h |
| Strips, tests, art, balance, a room | 40 min | 1.5 h |

So half a day for a fighter that passes, a full day for one that has been looked at hard. A stage is about two to three hours. Hard-surface characters (Toll) are quicker to model than cloth-and-face characters; fighters with long robes or capes take longer because of clipping.

## Working in parallel

Fighters are independent: one agent per fighter can work at once if each owns only `tools/blender/crew/<id>.py`, `src/crew/<id>/`, and its files under `assets/`. The shared touch points are four one-line additions (`CREW`, `CREW_DATA`, `CREW_DEFS`, and a `case` per new projectile kind in `src/scene/fx/projectiles.ts`); have one owner merge those. `kit.py`, `body.py`, `head.py`, `src/crew/lib.ts`, `src/anim/core.ts` and the renderer are shared: change them only for something every fighter gains from, and rebuild and re-shoot the existing fighters when you do. Stages are independent of fighters and of each other (`src/arenas.ts` and the `LOOKS` table take one entry each). Each agent needs its own lab port (4430 to 4439) and should not run more than one Blender bake at a time on this machine.
