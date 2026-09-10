# Blockwild design

An original open-ended cooperative voxel sandbox for 2–10 players. Gather, craft, build, swim, explore and survive. New worlds default to Survival, with no quests, required steps or region unlocks. Natural resource gathering, building, farming, cooking, storage and bed homes support player-chosen plans. Creative remains optional. See [SURVIVAL.md](SURVIVAL.md) for the current mechanics; historical terrain details below apply to generation1/2. The Sunwell is a decorative landmark; placing it leaves the session running, and only the host deliberately finishes. Music is reserved for the user.

## World, authority and controls

One metre per block, +Y up, X east, Z south. The expanded world is128×48×128, divided into64 mesh chunks of16×48×16. The original64×32×64 island is preserved in the center for version-one save migration. Outer regions have pine woods, snowy highlands, dunes, ruins and bridges. Camp connects to an exposed copper mine and underground crystal grotto. Eighteen selectable building materials and fifteen recipes support shelters, gardens, roofs, windows, lamps and colored masonry.

Player collision is a0.6×1.75m grounded AABB; eyes1.55m above feet. Walking4.5m/s, sprint8m/s, jump7m/s, gravity20m/s². Axis-separated motion with bounded vertical substeps prevents tunnelling. Grounded players step one block. Placement cannot intersect a connected player. Players pass through one another. Safe spawn searches for footing if camp is built over; deaths retain tools and leave a recoverable material cache. Disconnected players keep world state/inventory and do not simulate actions.

First-person devices use mouse/WASD/Space, Shift sprint, F flight toggle and Q descent, or left movement pad/right drag-look with touch actions and flight/descent buttons. Pointer lock requires clicking the canvas; Escape releases it. Server raycasts use the first solid hit, bounded5m reach, with a camera-centered outline. Yaw/pitch updates are explicit so neutral input does not reset aim. The TV shows the whole island or the selected player's first-person view, avoiding foliage hiding a distant follow camera.

## Networking and long sessions

30Hz fixed server simulation,10Hz snapshots and up to20Hz held input. Seeded terrain is shared pure code. The server owns its grid, inventory, collision, hits, resources and objectives. Client geometry contains visible voxel faces with a procedural pixel atlas, never a Mesh per terrain block. Changed chunks and boundary neighbours rebuild. Rendering smooths position without authoritative extrapolation.

Public projections contain seed, terrainVersion, monotonic revision and sparse `[linearIndex, blockId]` edits, alongside players/creatures/time. The platform's optional keyed-pair cache sends changed pairs and removed keys; clients reconstruct a complete View. Reconnect/missing baseline gets a full snapshot.16,384 distinct edits are allowed; returning a block to its generated value releases capacity. Player movement never broadcasts a full voxel grid.

Mining/placing use validated holds and server cooldowns. Craft/eat/Grow tree use a game-owned monotonic command sequence carried in held input, with private authoritative ack/result. Commands resend until ack and execute once; accepted and rejected commands both advance the counter. Recovery only accepts the next sequence, clears stale/future/corrupt commands and treats browser storage as optional. This avoids the platform's256 reliable-action-ID limit without raising a global limit.

Grow tree validates a complete footprint before any mutation or resource cost. Survival costs one berry plus one earth; Creative is free. Bounds, occupied cells, player overlap or insufficient sparse-edit capacity reject atomically. It creates ordinary timber/leaves recorded through the existing sparse world edits, so renewable forestry needs no new save schema or terrain-generator change. Inventory and cache item keys must be canonical numeric strings.

## Saves and identity

Host-only HTTP save/load/finish is platform-owned. Version2 JSON stores dimensions, terrainVersion, seed, mode, time, bounded edits, beacon, named inventories/stats/positions and recovery caches. Version1 imports remap old64-wide coordinates and old tool IDs into the expanded world. Import fully validates a fresh candidate before the platform atomically swaps it under a new round ID and scene-preparation barrier.

Imported player data is explicitly whitelisted; roster ID/color/presence/command counters remain live authority. Inventories and recovery caches match exact unique names in both saved and current roster. Ambiguous or unmatched names receive fresh inventories/spawns, while the world still loads. Saves with ten maximally full inventories/caches,16,384 largest-index edits and large legal counters measured203,072 bytes under the256KiB cap. Reproduce with `node --import tsx output/blockwild/measure-budget.mjs`.

## Art, performance and evidence

Original pixel face atlas: warm grass, teal shores, amber timber/copper, cream limestone, purple crystal, pine, slate and colored tiles. Fog, warm directional light, daylight/night changes, restrained chips and a Sunwell beam. No commercial game assets. Low quality caps DPR1, balanced caps DPR2. Reduced motion disables tool bob and mining chips.

Expanded seed38471 creates76,180 visible terrain triangles across64 chunks, about36ms CPU generation in the recorded local run. This is not a GPU frame-rate claim. Build02 (the smaller world) passed actual two-player gather/craft/reload, four device layout viewports and ten-player HUD/follow/results checks. Expanded-world browser acceptance remains pending in the current source-ready status.

References: [Minecraft overview](https://www.minecraft.net/en-us/about-minecraft) for gathering/crafting/survival/cooperation; [provided screenshot](https://pic.clubic.com/183367e01697572/1414x809/smart/minecraft.png) for first-person scale, layered terrain and hotbar composition. All code, textures, characters and region arrangements are original.
