# Farming, wildlife and exploration

Farming terrain was introduced in version 5. New worlds use version 6, which additionally moves diamonds deeper. This update adds a connected food loop without adding another persistent HUD panel. The existing action button reads Till, Plant, Harvest or Feed; its accessible label names the animal. Desktop right-click uses the selected item, and E handles the aimed interaction. The aiming caption names animals as well as blocks.

## Play loop

- Break short grass for a 12.5% chance of wheat seeds. Breaking the grass *block* gives dirt. Leaves give saplings or occasional apples, never seeds in modern worlds.
- Craft a wooden, stone or iron hoe at a crafting table: two head materials and two sticks. Clear the vegetation, select the hoe and Till the top of grass or dirt.
- Select wheat seeds, a carrot or a potato and Plant on farmland. Dry crops take six minutes; water within four blocks horizontally, at soil level or one block above, doubles growth. Crops need an unobstructed block above and daylight under open sky or a torch/campfire within seven blocks. This is a simplified lighting model, not Minecraft light-level simulation.
- Harvest using Mine or Harvest. Ripe wheat yields one wheat and two seeds; roots yield three carrots or potatoes. Early harvesting returns only the planting item. Full inventory leaves the crop intact. Plant again after harvesting.
- Cows and sheep follow wheat, chickens follow seeds, and pigs follow carrots or potatoes. Hold the food within eight blocks to lead them; aim and Feed within four blocks. Feeding spends one item.
- Feed two nearby adults of the same species within 30 seconds. They approach one another and produce one baby, then each waits five minutes before breeding again. Babies grow in five minutes and cannot breed or drop items. Hearts identify recently fed animals. At most 48 animals and 128 crop plots are supported.
- Adults provide meat; cows also provide leather, sheep wool, and chickens feathers. Furnace recipes cook the meat and bake potatoes. Food can be eaten through the existing inventory/keyboard controls.

Four small herds spawn in different regions of new islands: cows near the central grassland, sheep in the north, pigs in the southwest and chickens in the southeast. Wild carrot patches appear in southwestern grassland; potatoes appear in northern grassland. Forest timber, river clay and underground ores remain exploration resources. Exact placement follows the world seed and available grassy ground.

Wild root patches are a Blockwild exploration shortcut. Minecraft commonly supplies carrots and potatoes through villages or mob loot; this update does not add villages. The world remains 128×128×48, and this is not full Bedrock parity. Animals use simple wandering, food following, obstacle checks and single-block stepping, not full pathfinding. There are no fences, leads, egg laying or animal respawning in this update. Growth and mating timings deliberately fit shorter sessions.

## Farm toolkit

- Craft a bucket from three iron ingots at a table. Fill it from reachable water and Pour beside a solid block to irrigate crops. The active hotbar slot switches between the empty and filled forms when its current form runs out. Empty buckets stack to 16; the inventory supports one filled bucket. Both water and inventory changes are checked before either is changed.
- Water occupies one static cell. There is no fluid flow, source-block distinction or infinite-water generation. This gives farms portable irrigation within the existing bounded world simulation.
- Craft shears from two iron ingots in the pocket grid. An adult sheep gives three wool and visibly loses its coat. After at least 60 seconds, grazing a grass block restores wool and turns that block to dirt. Dirt can slowly regrow next to grass when uncovered. Shears are reusable; tool durability is not simulated. A shorn sheep drops meat, without extra wool, if killed.
- One bone makes three bone meal. Each Grow action advances a growing crop by two dry-growth minutes. Bone meal on clear grass blocks grows one short-grass tuft, making seed gathering renewable. Ripe or covered crops reject fertilizer without spending it.
- The aiming caption shows ripe crops, dry/watered growth, blocked planting space and missing light. Unlit crops pause at night. Environmental checks are reused across ticks until the terrain changes or the next second begins.
- Cooked beef/pork restores four food icons; cooked chicken/mutton restores three. Raw meats provide less, and potatoes restore half an icon until baked. Food is not consumed at full hunger; health recovers over time.
- Adults keep some distance while moving. Newborn placement checks solid footing, free space and separation from nearby animals before spending the parents' breeding opportunity.

`toolkit.ts` owns bucket transfers, fertilizer, shearing and grazing. `model.ts` appends four item IDs and the recipes without renumbering older saves. Sheep coat state and its grazing deadline are optional, validated save fields. The renderer toggles the authored coat mesh from the server state; clients do not decide drops or growth. The existing action button supplies Fill, Pour, Grow and Shear, so the HUD gains no extra buttons. In-game help explains these rules.

## Implementation decisions

`farming.ts` owns tilling, planting, hydration, growth and harvest. `animals.ts` owns passive animal placement, movement, diet, breeding, drops, body-based ray targeting and save validation. `server.ts` invokes these through the existing authoritative actions and projects their state to clients. Invalid actions and repeated command sequences cannot spend inventory twice. Animal targeting uses oriented body bounds, avoiding the old broad aiming cone that could choose an adjacent animal.

`model.ts` appends IDs without shifting existing inventory IDs. Historical inventory-only IDs remain rejected as world blocks. `terrain.ts` adds plants only for version 5; versions 1–4 regenerate their previous terrain. Version 4 retains seed drops from grass blocks because its original terrain has no short-grass plants. Its farming controls gain hoes and crop planting; older version 1–3 rules remain supported. Saved herds retain babies, love windows and breeding cooldowns. Saves without animal data seed herds only in version 5. Crop extensions are optional for old wheat saves and are validated before any world mutation.

`scene.tsx` reuses the existing creature rendering/cleanup path with separate animal IDs, named leg animation, baby scale and heart sprites. `art/build_animals.py` creates the four original GLBs, reimports them to verify mesh counts, renders a preview and saves `blockwild-animals.blend`. Each asset has 168–300 triangles and 4–7 meshes. Sheep have a separate removable coat mesh. `art/build_animal_sounds.py` adds four original synthesized calls to the existing per-player spatial effects bank. Music routing is unchanged: host music, player-local effects.

No platform implementation changes are required. No Prettier was run. The requested code-golf skill was not installed; a manual simplification pass reused the existing action protocol, rendering lifecycle and sound tracker rather than introducing parallel systems.

## Reference checks

Checked 12 September 2026. Official Minecraft articles informed the hoe → farmland → seeds sequence and food-driven animal interactions:

- [Seeds](https://www.minecraft.net/en-us/article/taking-inventory--seeds): prepare farmland, irrigate, provide light and plant.
- [Hoe](https://www.minecraft.net/de-de/article/taking-inventory--hoe): use the tool on grass blocks.
- [Wheat](https://www.minecraft.net/en-us/article/taking-inventory--wheat): attracts grazing animals.
- [Chicken](https://www.minecraft.net/en-us/article/chicken): seeds breed chickens.
- [Bone](https://www.minecraft.net/en-us/article/taking-inventory--bone): crafting bone meal for crop growth.
- [Shears](https://www.minecraft.net/pl-pl/article/taking-inventory--shears): reusable wool gathering.
- [Carrot](https://www.minecraft.net/de-de/article/taking-inventory--carrot): attracts and breeds pigs.

These describe the interaction conventions; they are not evidence that every Blockwild timing, drop quantity or world-generation choice exactly matches current Bedrock.
