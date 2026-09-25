# Blockwild

A cooperative first-person voxel survival sandbox for 1–10 players in a shared PartyPlay room. Every playing seat (phone, tablet, computer, or a host who plays) gets its own first-person world. A watching TV shows a cinematic spectator camera with player cards (a slim side column from six players), the day clock and world stats. Every start grows a new random world unless the host picks a fixed seed in Settings. Survival starts empty-handed next to a tree on a 4096×4096×128 world and leads from punching trees to diamond tools, then on to villages, armor, redstone and the Nether. A **Next goal** chip guides new players. Creative gives flight, instant breaking and a block palette. Sessions never end on their own: the host saves, loads and finishes them from the Room menu.

The design contract is [DESIGN.md](DESIGN.md) (protocol, block/item ids, rules, file ownership).

## Playing

The world has 12 biomes: ocean, beach, river, plains, forest, birch forest, taiga, snowy tundra, desert, mountains and snowy peaks. It also has winding caves and ravines, ores by depth (coal, iron, gold, diamond), trees that never break at chunk borders, flowers, sugar cane, pumpkins and melons. Days last 20 minutes; nights are dark, and hostile mobs spawn in darkness. Torches, lanterns and lit furnaces glow with smooth light.

- Survival: health, hunger, air, fall damage, cactus, drowning. Toasts warn at dusk and nightfall. Death shows a message; respawn at your bed or the world spawn (keep inventory is on by default). Spawning, respawning and reconnecting give 5 s of protection, and monsters camping the respawn point despawn. On the first day no monster spawns within 32 blocks of the world spawn.
- Crafting: MC-style shaped/shapeless recipes in the 2×2 inventory grid or a 3×3 crafting table, plus a recipe book with tabs, search, a "Can craft" filter, tap-to-craft and craft-all. Furnaces smelt while nobody watches; chests hold 27 shared slots. Beds skip the night once everyone is asleep (Leave bed, Jump or Sneak gets up).
- Building: slabs merge, stairs, logs and furnaces orient by the face you click or the way you look, doors and beds take two blocks, torches attach to walls. Farming uses a hoe, seeds, watering and bone meal; saplings grow into the same trees worldgen makes, and buckets move water.
- Mobs: zombies, skeletons, spiders and creepers at night or in caves; cows, pigs, sheep (shear them) and chickens that follow food and breed.
- Exploring: villages (oak, spruce or sandstone) with houses, a blacksmith, a library, farms and lamp posts; desert temples with a hidden TNT trap under the treasure room; mineshafts with cobwebs and spider spawners; mossy dungeons with monster spawners. Their chests roll loot once, the first time anyone opens them.
- Villagers: five professions with their own outfits and 3–5 emerald trades each (a rare diamond deal for some armorers and toolsmiths). They wander by day, go home at night, run from monsters, and restock at dawn. Zombies hunt them.
- Armor: leather, gold, iron and diamond with Minecraft's damage reduction and wear, shown on your player, in the inventory and as a HUD bar.
- Redstone: levers, buttons, pressure plates, dust, torches, repeaters, lamps, pistons and sticky pistons, iron doors and TNT, close enough to Minecraft that its tutorials work.
- The Nether: pour water on lava for obsidian, build a frame (2×3 to 21×21 inside), light it with flint and steel and stand in it for 4 seconds. The other side is a lava-sea cavern world (8 blocks of overworld per Nether block) with glowstone, quartz, zombified piglins that mob you if you hit one, and ghasts whose fireballs you can hit back.

### Desktop controls

Click the world to capture the mouse. **WASD** move, **Space** jump (double-tap to fly in creative), **Shift** sneak, **Ctrl** or double-tap **W** sprint. Hold **left mouse** to mine or attack; **right mouse** places or uses (hold to eat or draw a bow). **1–9** or the wheel pick a hotbar slot, **Q** drops (Ctrl+Q drops the stack), **E** opens the inventory (the creative palette in creative), **Esc** releases the mouse and opens the menu. If the browser refuses pointer lock for two world clicks in a row (some embedded frames or policies), play continues with a free cursor (a later successful lock returns to normal play): drag with any mouse button held to look, and use the middle button to look without acting.

### Touch controls (landscape)

A floating joystick appears wherever the left thumb lands; push it to the rim while moving forward to sprint. Drag anywhere else to look. Buttons: **Jump** (double-tap to fly in creative, hold to rise), **Sneak** (a toggle; in creative it is **Down**), **Mine** (hold), **Use** (tap to place or use, hold to eat or draw), **Items**, **Drop** (hold: one item after a moment, the whole stack if you keep holding; taps do nothing) and **☰** menu. Tap hotbar slots to select. In containers, tap to pick up or place, long-press to split, and switch on **Quick move** for shift-click.

## Architecture

Server-only code lives in `src/sim/`. The browser never imports it, and `tests/boundaries.test.ts` enforces that.

| Area | Files | Role |
|---|---|---|
| Platform entry | `src/manifest.ts`, `src/server.ts`, `src/client.tsx` | Manifest (20 Hz sim, snapshot cache of `edits`, save/finish), `rules`, and the client module (lazy `SceneView`, HUD, TV, lobby views). |
| Shared rules | `src/shared/` | Block and item tables, shapes, physics (`stepBody`), raycast, protocol (Input/View/PrivateView, `parseInput`), mining, placement, inventory clicks and recipes. The server runs these authoritatively and the client runs the same functions for prediction. |
| World generation | `src/shared/{noise,worldgen,trees,nether,loot}.ts`, `src/shared/structures/` | Deterministic `generateChunk(seed, cx, cz)` (integer hashes and `+ - * /` only, so V8 and JavaScriptCore agree) and `findSpawn(seed)`, memoized. The server and the scene use the same spawn. The Nether is a sealed corner of the same world (`x ≥ 3584, z < 512`) with its own generator; structures are planned once per seed and painted chunk by chunk. |
| Simulation | `src/sim/` | `game.ts` (create/tick/presence), players and movement validation, commands, mobs and pathfinding, combat, containers, growth, views and saves, plus one module per expansion system: `structures` (loot, spawners), `villagers`, `armor`, `redstone`, `portals`, `fire` and `nether-mobs`. |
| Engine | `src/client/engine/` | `VoxelEngine`: a Web Worker generates chunks, floods sky/block light and builds meshes with AO. The main thread streams columns nearest-first within a per-frame upload budget. Custom shaders give smooth light, fog, water, sway, sky dome, clouds, the block outline and cracks. |
| Art | `src/client/art/`, `art/` | 16×16 pixel-art textures and item icons painted at runtime into a texture array. Blender scripts (`art/build_models.py`) build the GLB rigs in `public/games/blockwild/models/`, which face -Z with pivot nodes at the joints. |
| Game client | `src/client/scene.tsx`, `src/client/game/`, `src/client/audio/` | The frame loop owns the only `setInput` call and the command queue. Local physics at 1/60 s steps, targeting, mining, optimistic edits (overlay reverts on reject), predicted containers, first-person hand, remote entities through `SnapshotBuffer`, particles, positional sound and host music. The TV gets a spectator camera. The world is cached by seed, so a reconnect, a loaded save or a replay of the same seed reuses its chunks. |
| UI | `src/client/ui/`, `src/client/style.css` | HUD, containers, recipe book, creative palette, menus, touch controls, TV overlay, settings, instructions and the results journal. It talks to the game only through `src/client/store.ts` and `game/predict.ts`. |

**Networking in one paragraph.** Your own position is client-authoritative: the server checks each claimed move against speed and collision and teleports you back (`tp`) if it is impossible. Every action (break, place, click, craft) is a numbered command carried inside held input, because reliable actions are capped at 256 per round. The server runs each command once, in order, and reports the highest number it handled (`ack`). The client shows the result immediately and drops its guess once the ack arrives, so a rejected edit quietly snaps back.

**Saves.** Format `blockwild` version 9: seed (always the real one)/worldId/mode/difficulty/keepInventory, time, packed edits (at most 16,384 distinct cells), up to 24 players matched by exact unique name (with worn armor), chests (≤ 64), furnaces (≤ 32), animals, villagers (≤ 64, with trade uses), a populated-chunk bitset and stats. Redstone, portals and fire rebuild from the edits on load. The worst legal save stays under the 256 KiB limit. Older saves (versions 1–8, made before the current terrain generator) are rejected with "This world was made with the previous version of Blockwild and cannot be loaded."

## Validation

```sh
node --import tsx --test packages/games/blockwild/tests/*.test.ts
npm run typecheck
npx oxlint packages/games/blockwild
npm run test:platform
npm test
```

Browser QA uses a fresh isolated build per change (never rebuild a served run) and headless Chromium with software WebGL:

```sh
npm run build:isolated -- <unique-name>
npm run serve:isolated -- <unique-name> <free-port>
node output/playwright/qa-flow.mjs <port> output/playwright/<unique-name>    # solo: walk, look, chop, craft, place, use table
node output/playwright/qa-phone.mjs <port> output/playwright/<unique-name>   # 844×390 touch: HUD, joystick, look, Mine, inventory
node output/playwright/qa-coop.mjs <port> output/playwright/<unique-name>    # host + joined player see each other and each other's edits
node output/playwright/qa-tv.mjs <port> output/playwright/<unique-name>      # watching TV: spectator camera and overlay
```

Expansion flows (villages, trading, armor, dungeons, mineshafts, the temple trap, redstone, portals, the Nether and the TV) are easiest to set up by editing a downloaded save and loading it from the Room menu. `output/playwright/bw3-int-1/` has a persistent driver (`driver.mjs`) plus `facts.ts` (structure, chest, plate and spawner coordinates for a seed) and `ground.ts` (standing heights). Seed 11 has a village 226 blocks from spawn, a desert temple, mineshafts and dungeons nearby.

Headless Chromium refuses pointer lock, so the scripts click the world twice to enter the free-cursor fallback; that mode then lasts for the whole page, so after a load use a middle click to focus. Software rendering runs at roughly 2–15 fps, so it can judge visuals but not frame rate or feel. Real phones, night-time play and ten-player rosters still need human or larger-roster sessions.
