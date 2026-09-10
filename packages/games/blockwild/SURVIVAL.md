# Survival sandbox

Survival is the default. It starts with empty pockets in a seeded landscape of forest, hills, desert, rivers, shoreline and caves. There are no quests, required routes, region unlocks, score targets or automatic ending. The host decides when to save or finish. Creative is a separate optional mode.

Players choose how to live in the world:

- Gather earth, timber and leaves by hand. Leaves supply building foliage, berries and seeds. Ore occurs throughout the map; a named mine or landmark is never required.
- Craft basic supplies wherever you are. A placed workbench supports advanced tools. Copper and iron offer different tool recipes; equipment is automatically used for mining and combat.
- Place a furnace near your base. Smelting consumes ingredients and coal or timber once, takes time, and leaves its output in the furnace until someone collects it. Furnaces process ore, glass and cooked berries. Stocked furnaces cannot be mined accidentally.
- Plant seeds on grass or earth. Crops grow in three minutes, or90 seconds beside water. Harvest grain and reusable seeds; make bread or expand the farm. Trees remain renewable through Grow tree.
- Place shared chests and transfer supplies in batches of up to64. Each chest holds16 item types with999 per stack. Empty it before moving it. Chest contents are shown only to an explorer aiming at it within reach.
- Place a bed to set home. At night, all connected players may rest to bring morning. Moving wakes you. A removed or blocked bed falls back to a safe world spawn.
- Manage hunger, health and air. Sprinting and work consume food faster than idling; a full food meter gradually heals. Starvation stops at one health, while falls, brambles and drowning can kill. New Survival deaths leave all inventory, including equipment, in a persistent recovery crate. Repeated deaths merge unrecovered supplies rather than erasing them.
- Build walls, lanterns and campfires for protection. Nighttime brambles appear around explorers throughout the world. A day/night cycle lasts20 minutes. The Sunwell is a decorative craftable landmark.

Every recipe is visible and searchable from the beginning. Material and workstation requirements are physical crafting mechanics, not objective completion gates.

## World and save boundaries

The current finite world is128×48×128 blocks, with16,384 changed cells. It is freely explorable and destructible, but does not generate infinite chunks. A world supports128 crops,32 stocked chests and32 active furnace jobs. The shared runtime supports2–10 players and preserves validated autosaves and manual downloads. Furnace jobs, farms, storage and bed homes survive save/load. The maximum accepted homestead plus edited terrain is tested against the256KiB save envelope.

New worlds use terrain generation3. Existing generation1/2 saves retain their original terrain and legacy timing/resource behavior; they are not silently reshaped. New home systems remain available when placed. Existing worlds and new worlds use the same shared room and recovery runtime. No separate server or music was added.

The implementation draws on Minecraft's [Survival description](https://www.minecraft.net/en-us/article/creative-vs-survival-mode) and [first-night guide](https://www.minecraft.net/en-us/article/how-survive-your-first-night-minecraft). This is an original, smaller game with its own art and recipes. It does not implement Minecraft's complete creature roster, automation, enchantments, dimensions or infinite terrain.

## Controls and presentation refinement

Desktop shortcuts:1–9 selects the matching hotbar slot, E uses the aimed station, C opens crafting, M opens the atlas and R eats available food. Settings → Surprise me chooses a different seed; it does not change an existing saved world. The seed is also shown in the display and world journal.

Crafting search shows matching recipes first; the pack is collapsible and chest storage separates your pack from shared contents. Balanced graphics adds up to four nearby lantern/campfire/beacon/furnace lights; low graphics omits these local lights. The overview slowly orbits, with a fixed camera under reduced motion. Diagnostics are available with `?metrics`.
