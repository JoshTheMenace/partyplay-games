# Sky Clash: design

Sky Clash is PartyPlay's platform fighter. One TV or laptop renders the fight, 1 to 4 phones are the controllers, CPU fighters fill empty seats, and a 60 Hz server simulation is authoritative. This document is the art direction, the cast and the technical design of the 2026-11 visual overhaul. [README.md](README.md) explains how to play and run it, [PIPELINE.md](PIPELINE.md) is the step-by-step guide for building another fighter or stage, [STAGES.md](STAGES.md) lists stage numbers and [QA.md](QA.md) records what was checked.

## Two generations of content

| | The Reaches (new, original) | Legacy |
| --- | --- | --- |
| Fighters | `sola`, `toll`, `kes`, `vesper` (`src/crew/`) | the 33 kinds in `src/roster.ts` |
| Stages | `beacon-rock`, `bellyard` (`src/arenas.ts`) | the 30 ids in `src/stages.ts` |
| Data | authored here: attributes, frame data, hitboxes, specials, animation | imported tables in `fidelity/` |
| Models | textured, rigged GLBs from `tools/blender/crew/` | flat-colour GLBs from `tools/blender/fighters/` |
| Animation | keyframed clips (`src/anim/`, `src/crew/*/`) | procedural pose table (`src/poses-table.ts`, `src/scene/fighter/`) |
| Rendering | lit PBR, shadows, bloom, tone mapping (`src/scene/crew/`, `src/scene/arena/`) | toon and outline (`src/scene/fighter/`, `src/scene/stage/`) |

The Reaches is the game: its fighters and stages come first in every select screen and are the defaults for picks, Random, CPU fill and the stage. The legacy group stays selectable in a second, clearly labelled group and still loads and plays. It is frozen: it is not polished, tuned or used as a design source, and the owner decides when it goes. Nothing in the new cast or stages was derived from it or from any other game; the genre's shared mechanics (percent damage and knockback, ledges, shields, tilt and smash inputs) are the engine's.

## Art direction: storm-lit maquette

The old look was a toy shelf: balloon limbs, mitten hands, glossy plastic, thick ink lines, sticker faces. The new look is a sculpted and painted maquette lit like a stage set.

- **Proportion.** Heroic and stylized, not cute: adults stand about 6.5 heads tall, hands and feet are 15 to 20% oversized so poses read from a couch, and limbs taper through real landmarks (deltoid, elbow, wrist, knee, calf, ankle). Every fighter owns one big shape (a column, a bell, a hook, a blade) and one silhouette breaker (a pole, a kite, a hood, a pipe).
- **Form.** Bodies are lofted from cross-sections and sculpted with soft but visible plane changes. Costumes are layered shells with thickness: coat over tunic over body, cuffs, collars, belts, straps, buckles, plates with bevelled edges. Faces are sculpted (brow, socket, cheek, nose, lips, jaw), with real eyelids over inset eyes, modelled brows and clumped, sculpted hair. Hands have a palm, four fingers and a thumb that open and close.
- **Material.** No ink outline. Surfaces are matte painted cloth and leather, worn brass and steel, glass and lamplight. Each fighter carries two baked textures: a paint map (ambient occlusion, a value gradient that lightens toward the top and the light, warm and cool variation, edge wear on convex edges) and a detail map (tangent normals for weave, grain, stitches and panel lines, plus a pattern mask). Colour comes from a per-costume palette, so four costumes share one bake. Specular is motivated: metal, glass, eyes and polished leather only.
- **Light is the outline.** A warm key from the upper front, a cool sky fill, and a strong back rim that traces every silhouette against the backdrop. Soft real-time shadows fall on the stage and across the fighters themselves; a contact blob grounds the feet. Emissive parts (lantern, furnace vents, glass, storm sigils) bloom.
- **Colour.** A fighter is 60/30/10: a deep or neutral dominant, a secondary, one saturated accent, and one emissive element colour that also tints its effects. Stages sit lower in saturation and contrast around the gameplay plane and fade into atmospheric haze behind it, so fighters always pop. Player colour lives in the ground ring, name tag and shield, never on the costume.
- **Effects.** Shape first, then glow: thick tapered slash arcs, a white-hot impact core with a starburst and shock ring sized to the hit, chunky directional sparks. Each element has its own shapes and palette (ember teardrops and rising cinders, resonance rings, gale crescents and streaks, glass shards and prisms). Hits freeze both fighters, flash the victim, and shake the camera along the launch line.
- **Interface.** Night-sky glass and brass: deep navy panels, thin brass keylines, the platform's display face for names and numerals, each fighter's accent as a colour bar. Portraits and full-body art are rendered by the game's own renderer, so the card and the fight show the same character.

## The Reaches and its crew

A scatter of islands hangs above a sea of cloud. The people who work that sky (lighting its beacons, casting its bells, running its kites, blowing its glass) settle their rivalries in the Sky Clash. Every fighter is a trade, wears its work gear and fights with its tools. Ten are planned; the finished game ships the ones that reach the bar.

| # | Fighter | Trade and identity | Silhouette | Archetype | Palette and element | Specials (neutral / side / up / down) | Built |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Sola** | Lamplighter of Beacon Rock. Steady, wry, first up the ladder. | Long split-tail coat, scarf, a lantern-pike taller than she is | All-rounder with reach | Deep teal, bone, brass; ember orange | Cinder Lob / Pike Vault / Updraft / Kindle (air: Plummet) | yes |
| 2 | **Toll** | The Bellyard's old casting automaton, still on shift. | A walking bell: huge shoulders, short legs, barrel fists | Heavy with armour | Verdigris bronze, soot iron; furnace amber | Knell / Ram / Steam Hoist / Bell Drop | yes |
| 3 | **Kes** | Kite-runner, courier of the upper winds. Never lands for long. | Lean, a folded kite on the back, two ribbon tails | Fast and light | Saffron, cream, indigo; gale mint | Gale Dart / Tailwind / Kite Lift / Downdraft | yes |
| 4 | **Vesper** | Glasswright. Patient, exacting, sees the fight in reflections. | Tall robe and apron, blowpipe staff, round smoked lenses | Zoner and trickster | Plum, rose glass, pewter; prism white-cyan | Glass Bulb / Shard Fan / Bubble Lift / Kiln Mirror | yes |
| 5 | Harrow | Rigger. Hauls anchors for a living. | Barrel chest, anchor on a chain over one shoulder | Grappler | Oilskin green, rope, rust; tide teal | Cast Anchor / Haul / Winch / Keel Drop | planned |
| 6 | Bramble | Cloud-shepherd. Small, stubborn, never alone. | Short, a tall crook, a puff of cloud at heel | Floaty, many jumps | Wool white, moss, clay; mist white | Send Lamb / Crook Hook / Flock Lift / Fold | planned |
| 7 | Tamber | Storm-smith. Forges with caught lightning. | Square, apron, a long-handled hammer | Slow, huge hits | Charcoal, copper; storm cyan | Charge Rod / Hammer Throw / Bolt Leap / Quench | planned |
| 8 | Quill | Cartographer. Fights on lines only she can see. | Narrow, map tube, compass-blade | Trapper | Ink, parchment, red wax; ink blue | Draw Line / Fold / Plot Course / Blot | planned |
| 9 | Scree | Roost-warden with a clockwork hawk. | Feather mantle, bird mask, hawk on the fist | Puppet fighter | Slate, bone, rust; brass glint | Loose / Stoop / Carry / Recall | planned |
| 10 | Dredge | Hail-miner from the ice shelves. | Fur ruff, twin picks, pack | Mid-heavy, ice | Glacier blue, fur, orange cord; frost white | Hail Shot / Pick Climb / Ice Spire / Freeze Vent | planned |

Each built fighter has its own attributes, frame data, hitboxes, specials, animation set, effects, four costumes, portraits, renders and CPU play, all authored in `src/crew/<id>/` and `tools/blender/crew/<id>.py`. No fighter starts from a legacy fighter's data.

## Stages of the Reaches

| Stage | Place | Layout | Art |
| --- | --- | --- | --- |
| **Beacon Rock** | Sola's lighthouse isle at dusk | A main floor with three platforms | Weathered stone terrace, brass lamp posts, the beacon tower turning its beam behind, a cloud sea and far islands in haze |
| **Bellyard** | Toll's foundry deck, mid-storm | One long flat deck, a cargo pallet hung on chains above the middle | Riveted deck between two casting towers, three great bells on a gantry, furnace vents glowing along the rail, rain |

Both use only genre-staple layouts. Collision is authored in `src/arenas.ts`; the art is modelled in Blender to those numbers and a test checks they agree.

## Rendering

Only the display renders the fight, so the budget is a mid-range laptop GPU at 1080p, with a low tier for integrated graphics.

- **Pipeline per stage.** A Reaches stage turns on the new pipeline (`src/scene/pipeline.ts`): an HDR scene target (4× MSAA), a key light with a 2048² PCF-soft shadow map fitted to the stage, hemisphere fill, a back rim light, an environment map prefiltered once from the stage's own sky for metal and glass, exponential haze, up to four lamp point lights, then one composite pass (bloom from a five-level half-resolution chain, ACES-style tone curve, grade, vignette, dither). Each arena has a `Look` (`src/scene/arena/index.ts`): Beacon Rock is a warm key with a cool rim, the Bellyard a cold key with a hot rim and rain. A legacy stage renders exactly as before (direct to the canvas, no tone mapping), so old stages keep their look.
- **Only emissive parts bloom.** Lit surfaces are held just under white in the fighter shader and the bloom threshold sits above it, so lanterns, furnace doors, eyes and glass glow and brass does not turn to neon.
- **Fighters of the crew** use one skinned mesh and one material: palette × paint map, tangent normal map, per-slot roughness, metalness and emission, a fresnel rim tinted by the stage, hit flash, charge and intangibility glows and dithered fade as uniforms. Legacy fighters keep their toon and outline materials and are lit by whichever stage they stand on.
- **Cost per frame at 1080p, four crew fighters on an arena (reasoned from what is submitted, not measured: this was built on a machine with no GPU):** about 40 to 60 draw calls (the arena is one mesh; sky, cloud sea, motes, rain and beam one each; a fighter is one skinned mesh plus ring, contact shadow and trails; the shadow pass redraws the arena and fighters; effects are two particle batches and a few projectile meshes; post is ten small passes). Triangles: 28k to 49k per fighter and about 20k per arena, so up to 190k in view and about 380k with the shadow pass. GPU memory: about 45 MB for four fighters' maps, 45 MB for the arena's two 2048² maps, 16 MB of shadow map, and about 90 MB for the 4× MSAA half-float target, its resolve and the bloom chain: roughly 200 MB. Fill rate: one MSAA scene pass with per-pixel PBR, shadow lookups and up to four point lights, then about 1.4× the screen in post. A mid-range laptop GPU should hold 60 Hz at 1080p; integrated graphics should use the low tier.
- **Low tier** (`party.sceneQuality = low`): no MSAA, a 1024² shadow map with a tighter filter, no bloom chain (the tone curve stays), normal maps off, no lamp point lights, a third of the motes and rain. That removes the multisampled target (about 65 MB), most of the post passes and the costliest lighting terms. The look holds; the gloss goes.

## Models

`tools/blender/crew/` is a scripted, headless Blender 5.2 pipeline (see [PIPELINE.md](PIPELINE.md)):

1. **Build** from a character sheet in Python: lofted limbs and torso, a sculpted head, hair clumps, hands, layered clothing and gear, all as named parts with material slots.
2. **UV and bake** on the CPU with Cycles: ambient occlusion, painted gradients, curvature wear and patterns into the paint map; bump detail into the tangent normal map.
3. **Rig**: the contract skeleton (`src/model.ts` `BONES`) with world-aligned rest frames, plus face (`jaw`, `lid_L/R`, `brow_L/R`), hands (`fingers1/2_L/R`, `thumb_L/R`) and `extra_*` spring chains. Weights are painted by rule from the build, then smoothed.
4. **Export** one GLB (WebP textures), `assets/models/<id>.json` (joints, slots, bounds, anchors), `assets/costumes/<id>.json` and `src/crew/<id>/rig.ts`, then **validate** (`tools/blender/crew/validate.py`): bones and world-aligned rest frames, weights, UVs, maps, triangle and byte budgets, material slots, costumes.
5. **Review** flat-colour or clay sheets rendered in Blender while modelling. Turnarounds, portraits and full-body art are captured from the game renderer (`tools/pose-lab/crew.html`, `tools/crew-art.sh`), so the cards match the fight.

Budgets per fighter: 50k triangles, 3 MB, two 1024² textures (the four built fighters are 28k to 49k triangles and 1.4 to 2.1 MB). `tools/blender/crew/validate.py` and `tests/crew.test.ts` enforce them.

## Animation

Keyframed clips, authored as data and evaluated by one shared, dependency-free evaluator (`src/anim/`) that runs in the renderer and on the server.

- A **pose** is a small set of readable channels: root offset, lean and twist; spine, chest, neck and head bends; arms by raise, swing, twist and elbow, or by a hand target; legs by foot targets solved with two-bone IK; hand grip; face (blink, brow, jaw); squash and stretch. A **clip** is a list of keyed poses with an ease per key (in, out, overshoot, snap, hold).
- **Moves are keyed on the simulation's own frame counter**, so wind-up, contact and recovery sit on the same frames as the hit windows. Hitlag freezes the clip; a charge holds the wind-up key and trembles.
- **Overlap and secondary motion** are layered at run time: the chest, head and arms sample the clip a frame or two late (drag and follow-through), and `extra_*` chains (coat tails, scarf, hair, ribbons, the lantern) are damped springs.
- **States** (idle, walk, run, turn, crouch, jump, fall, land, hurt, tumble, shield, dodge, ledge, grab, thrown, knockdown, getup, dizzy, win, lose: 38 clips) are clips too; walk and run advance by distance travelled, so feet do not slide. Changes cross-fade over a few frames, shorter into attacks. Sola's set is written by hand; `makeStates` in `src/crew/lib.ts` builds the set for the others from a stance, a carriage (how the fighter holds its arms and gear in each family of states) and a few style numbers, scaled to the fighter's legs, and any clip can be replaced.
- **Accents are authored with the move:** weapon and limb smears between two rig anchors, one-shot cues (dust, a flare, a burst, crescents, resonance rings) and a glassy aura, all tinted by the fighter's element.
- **Hitboxes follow the animation.** A crew hitbox is attached to a bone (hand, foot, head, a point along the weapon). At load the server evaluates the same clips and records each hitbox's path, and sweeps between frames so fast swings leave no gaps. Pose Lab draws those hitboxes over the model in every filmstrip.

## Engine

The simulation in `src/sim/` is shared by both generations. `src/moveset.ts` assembles `MOVESET`, `TIMING` and `PHYSICS` from `fidelity/` for legacy kinds and from `src/crew/` for the crew. The crew's numbers are authored in meters and frames. Special moves use the phase kits in `src/specials/types.ts`. CPU play, the lobby contract, snapshots and settings are unchanged in shape; `src/model.ts` remains the contract.

## Validation

- `node --import tsx --test packages/games/sky-clash/tests/*.test.ts`
- `npx tsc --noEmit`, `npx oxlint packages/games/sky-clash`, `npm run test:platform`
- `python3 packages/games/sky-clash/tools/blender/crew/validate.py` for the models; `node --import tsx packages/games/sky-clash/tools/balance.ts --seeds=8` for the balance and recovery report.
- Labs (`npx vite --config packages/games/sky-clash/tools/lab.vite.config.ts --port 4430 --strictPort`): `/pose-lab/crew.html` for filmstrips with hitboxes and turnarounds, `/stage-lab/scene.html` for the real display scene, `/ui-lab/` for every screen.
- Rooms: `npm run build:isolated -- <run>`, `HOST=127.0.0.1 npm run serve:isolated -- <run> <port>`, then `node packages/games/sky-clash/tools/ui-lab/crew-flow.mjs http://127.0.0.1:<port> <out> duel|solo|quad|legacy`.
