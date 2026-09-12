# Bedrock reference and Blockwild implementation

Research checked 11 September 2026. This is a focused comparison of the systems changed in this pass, not a claim of complete Bedrock parity. The game uses original code, geometry and colors; no Minecraft textures, sounds or model files are bundled.

## Controls and inventory

Bedrock offers multiple touch schemes, including **Joystick & aim crosshair**, **Joystick & tap to interact**, and **D-Pad & tap to interact**. That choice was released in the [1.19.50 Bedrock update](https://www.minecraft.net/nb-no/article/1-19-50-update-available-bedrock); it is evidence of supported approaches, not a statement about today's default setting. The [official controls guide](https://www.minecraft.net/en-us/article/minecraft-controls) describes movement, camera control, inventory, jumping, sneaking, attacking and using items.

Blockwild targets the joystick/crosshair approach: left movement, drag the world to look, right action controls, nine hotbar slots in a carousel showing about five at a time, sprint at the forward rim of the joystick, a touch Sneak toggle, and an Items button for inventory access. Compact labeled actions sit at the edges, leaving the central view clear; secondary menus are inside inventory. Portrait and landscape are supported. Desktop uses WASD, mouse look, Space jump, Ctrl sprint, Shift sneak, 1–9 hotbar, C crafting, E inventory/use, R food; Creative retains F flight and Q descent. Sneaking slows movement and guards ledges. The server uses the selected hotbar tool, not the strongest tool anywhere in the inventory.

## Crafting and early progression

The [official crafting guide](https://www.minecraft.net/en-us/article/how-craft) distinguishes the inventory's 2×2 grid from a crafting table's 3×3 grid. The recipe book supports categories and search, shows ingredients, and marks missing materials. Logs produce four planks; four planks make a table. Blockwild now represents recipes with ingredient patterns, derives resource costs from those patterns, and supplies them to a compact recipe book and selected-recipe preview. Table recipes require a nearby placed table. Smelting requires a nearby furnace.

The [pickaxe guide](https://www.minecraft.net/en-us/article/taking-inventory-pickaxe) describes wooden, stone, iron and diamond progression, with three head materials and two sticks. Blockwild follows that chain: stone yields cobblestone, coal ore yields fuel, iron ore yields raw iron for smelting, and diamond ore yields diamonds. Fictional Sunwell crafting, copper-pick progression, instant berry trees and invented decorative recipes are absent from new worlds. Familiar materials retain stable numeric IDs so old saves still load.

The [furnace article](https://www.minecraft.net/de-de/article/block-week-furnace) establishes fuel-driven, timed processing of materials. Blockwild separates furnace jobs from inventory, reserves their inputs atomically, and requires collection of finished output. In new worlds coal/charcoal supply 80 seconds of burn time and logs/planks 15; common recipes take 10 seconds. Remaining burn time continues against world time and survives saves. A furnace cannot be mined while holding output. Coal and charcoal are separate inventory items.

## Mobs and survival

The [official mob guide](https://www.minecraft.net/en-us/article/minecraft-mobs) identifies zombies, ranged skeletons and explosive creepers among hostile threats. The [first-night guide](https://www.minecraft.net/en-us/article/how-survive-your-first-night-minecraft) explains shelter, lighting and the hazards of darkness. Blockwild has separate behavior for these enemies: zombies chase and strike, skeletons fire simulated arrows and keep their distance, and creepers charge a cancellable fuse before an area blast. Solid walls block melee, arrows and blast damage. Torches prevent nearby spawning instead of making every monster flee from light. Exposed zombies and skeletons burn during daytime.

Mojang's [Bedrock spider entity definition](https://raw.githubusercontent.com/Mojang/bedrock-samples/main/behavior_pack/entities/spider.json) specifies climbing, a wide low collision box, brightness-sensitive hostility and 16 health points. Blockwild uses a separate wide/low collision shape, wall climbing, eight hearts and daytime neutrality until attacked. Its light model is simplified to day/night for spider aggression.

All four mobs were authored with Blender 5.2.1, exported to GLB, reimported to check mesh counts and bounds, and preview-rendered. The exported meshes have named rigid pivots for limb animation, one vertex-color material per model, and 336–540 triangles. See [the generator](art/build_mobs.py), [source scene](art/blockwild-mobs.blend), [lineup](art/mob-lineup.png), and [measured manifest](art/mob-manifest.json).

## Compatibility and deliberate limits

New worlds use terrain/rules version 5. Version 4 terrain is preserved when loading existing saves. Versions 1–3 retain their terrain generators, recipe tables, inventory capacity and legacy enemy rules. Existing IDs are never shifted; inventory-only IDs are rejected as world edits and cannot be placed. The current save format remains version 2, with the terrain/rules version selecting behavior. Fuel state is an optional validated extension.

This remains a small multiplayer sandbox, with significant differences from Bedrock:

- Inventory is pooled by item type, capped at 64 per type (one per tool), rather than 36 independent stack slots. Crafting uses a recipe-book preview; arbitrary manual ingredient placement is not implemented.
- Tool durability, armor, enchantments, full recipes, item dropping, complete biome systems/dimensions, redstone and liquid flow are not implemented.
- Terrain remains a bounded 128×128×48 world. Mining with an inadequate tool is prevented rather than destroying the block without a drop. Glass breaks without a drop.
- Farms, one-block beds, chest capacity, automatic one-block stepping, tree-growth timing and loot are simplified. Version 5 supplies seeds from short-grass tufts; version 4 retains grass-block gathering for its existing terrain. Food uses a ten-unit meter with fractional values, and rotten flesh has no hunger status effect.
- Mob navigation follows nearby players with collision handling rather than full pathfinding. Spawning uses night and nearby placed lights; it does not compute a full propagated light field. Creeper blasts destroy a bounded set of softer blocks and preserve stored station contents. Mob state is transient across save/load.
- Touch behavior still needs physical-device and human gameplay testing; browser emulation cannot establish Bedrock-like feel by itself.

## Farming and passive animals, 12 September 2026

See [the farming implementation and sources](FARMING.md) for hoes, short-grass seed drops, wheat and root crops, wandering herds, food attraction, breeding, babies and deliberate timing/world-generation differences.

The farm toolkit adds portable static water, shearing and grazing, bone meal, daylight/torch crop checks and differentiated food values. These follow familiar interactions while keeping simplified growth, wool quantities, stack storage and lighting. See [farm toolkit rules](FARMING.md#farm-toolkit).
