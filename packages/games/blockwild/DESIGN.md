# Blockwild 2: design contract

This document supersedes every earlier Blockwild design note. The game is a ground-up rebuild: a cooperative first-person voxel survival sandbox for 1–10 players in the shared PartyPlay room. The goal is gameplay quality, not a checklist. Moving, mining and placing must feel instant; the world should look good (smooth lighting, glowing torches, real night, a long view distance); and survival should give casual party players a clear loop from punching trees to diamond tools, then on to villages, armor, redstone and the Nether.

The game id stays `blockwild`, so both registries (`apps/party-server/src/registry.ts` and `apps/party-client/src/registry.ts`) keep working unchanged. `src/manifest.ts`, `src/server.ts` (`rules` plus a default export) and `src/client.tsx` (`client` plus a default export) stay at those paths. Old saves (format versions 1–8) are rejected with a clear message: "This world was made with the previous version of Blockwild and cannot be loaded."

Reuse from the old game: the host music playlist (`public/games/blockwild/music`, `music.ts`, `host-music.ts`), the licensed sounds in `public/games/blockwild/sounds` (keep the LICENSE files), and optionally the old GLB mob models as a fallback reference. Everything else is new. Delete old source, tests and markdown notes that no longer describe the game (BEDROCK-REFERENCE, CHUNKED-WORLDS, FARMING, SURVIVAL, SOUNDS, VERIFICATION) once the replacement exists. README.md is rewritten at the end.

## Platform facts every agent must respect

- Contract: `packages/party-contract/src/index.ts`, `protocol.ts`; UI: `packages/party-ui/src/index.ts`; Three helper: `packages/party-3d/src/index.ts`; runtime helpers (`ResourceScope`, `SnapshotBuffer`, `FrameMetrics`, `FixedStepClock`): `packages/party-runtime/src`. Read the real exports.
- Incoming messages are capped at 32 KiB; 80 messages/s/socket; **256 reliable actions per player per round**. A sandbox session far exceeds 256 actions, so **all gameplay commands travel inside held input** (see Networking). Do not use `sendAction` for gameplay; the `Action` type is only `{ type: 'noop' }`.
- Held input (`setInput`) is coalesced and resent at up to 20 Hz; latest wins. `releaseInput` maps to `rules.neutralInput()`.
- Outgoing views must be JSON-serializable with finite numbers; omit absent optional fields (never assign `undefined`).
- The Vite guard rejects only `src/server.ts` and `src/content.ts` from browser chunks. **Server-only code lives in `src/sim/` and must never be imported by `src/client/`, `src/client.tsx` or `src/shared/`.** A test enforces this (scan import specifiers).
- `parseInput` must tolerate garbage and partial objects (the platform test sends `{x:1,y:0}`): return a sanitized input, never throw on shape problems.
- `validateSettings({})` returns defaults.
- Save hooks: `exportSave`, `loadSave`, `finish`; manifest `sessionControls: ['save','finish']`. Saves must stay under 256 KiB (`MAX_SAVE_BYTES`) in the worst legal case. The server autosaves every 30 s.
- `snapshotCache: { revisionField:'revision', fields:['edits'], keyedPairsFields:['edits'] }`: `edits` is `[cellIndex, cellValue][]`, unique nonnegative integer pairs; bump `revision` on every change.
- Never run Prettier. Match the terse house style, but prefer readable code over code golf: one statement per line in non-trivial logic, meaningful names. No `any` in exported APIs.
- No git staging/commits.

## Manifest

```ts
{ contractVersion:'1.0', id:'blockwild', title:'Blockwild', description:'Survive, mine, craft and build together in a boundless blocky world.',
  assetBase:'/games/blockwild/', modes:['shared-display'], players:{min:1,max:10},
  orientation:{ controller:'landscape', personalView:'landscape' }, timing:'realtime', input:['state','action'],
  sessionControls:['save','finish'], snapshotCache:{ revisionField:'revision', fields:['edits'], keyedPairsFields:['edits'] },
  simulation:{ stepHz:20, snapshotHz:20, maxCatchUpSteps:4 }, privatePlayerViews:true, supportsSolo:true }
```
Client module: `immersivePhone: true`, `sceneRoles: ['display','controller']`.

## World

- Axes: +X east, +Y up, +Z south. 1 unit = 1 block = 1 m.
- `WORLD = 4096` (x,z in [0,4095]), `HEIGHT = 128` (y in [0,127]), `CHUNK = 16`, `SEA_LEVEL = 62`. Bedrock at y=0 (with a ragged layer to y≤3). Outside the world horizontally is an invisible wall; above 127 is air; below 0 is bedrock.
- Cell value = `id | (state << 8)` stored in `Uint16Array`; `id` 0–255 block id, `state` 0–255 block state. Column chunk storage is `Uint16Array(16*16*128)`, local index `lx + 16*(lz + 16*y)`.
- Global linear cell index (edits, saves): `x + WORLD * (z + WORLD * y)` (max < 2^31).
- Terrain is a pure deterministic function of `(seed, cx, cz)` shared by server and browser worker. **Determinism across V8 and JavaScriptCore:** use only `+ - * /`, `Math.floor`, `Math.sqrt`, `Math.abs`, `Math.min/max`, and integer hash functions (`Math.imul`, bit ops). Never use `Math.sin/cos/exp/pow/log/random` in worldgen.
- Edits: a sparse `Map<cellIndex, cellValue>` journal over generated terrain. Writing a cell back to its generated value deletes the entry. `EDIT_LIMIT = 16384` distinct cells; a command that would exceed it is rejected with the toast "This world has reached its building limit."
- World spawn: near (2048, 2048), searched outward (within 512 blocks) for grass with a tree within 12 blocks, else any dry grass/sand above sea level; never within 3 blocks of water or cactus, and eye height is clear for 2 blocks. Players spawn spread within 3 blocks, on the ground (never on a canopy).
- The Nether is a sealed corner of the same storage, not a second world: `x ∈ [3584, 4096), z ∈ [0, 512)` (`NETHER = { x0: 3584, z0: 0, size: 512 }`, `inNether(x, z)` in `shared/constants.ts`). "Dimension" is derived from position, so physics, raycast, edits, saves, lighting, meshing, networking and entities work unchanged. Bedrock walls fill column x = 3584 and row z = 511 at full height, with a ragged bedrock floor (y 0–4) and ceiling (y 123–127). The overworld around that corner is deep ocean (the nearest land is about 170 blocks from the walls).
- Day: `DAY_TICKS = 24000` at 20 ticks/s (20 minutes). Tick 0 = sunrise, 6000 noon, 12000 sunset, 13000–23000 night. New worlds start at tick 1000.

### Biomes and generation (worldgen owner)

Biomes from low-frequency temperature/humidity/continentalness noise: ocean, beach, plains, forest (oak+birch), birch forest, taiga (spruce, ferns), snowy tundra (snowy grass, ice on water, sparse spruce), desert (sand, sandstone underneath, cactus, dead bush), mountains/hills (stone peaks, snow caps above y≈105, exposed ores), swamp-ish river banks optional. Rivers carve through land. Smooth biome blending for height (no cliffs at biome borders). 3D cave systems (noodle/cheese style from 3D noise, plus a few ravines), ores by depth: coal (y 5–110, common, larger veins), iron (y 5–64), gold (y 5–32, rare), diamond (y 5–16, rare, small veins), clay patches in shallow water, gravel patches. Decorations: tall grass, ferns, flowers, sugar cane at water edges, pumpkins rare, melons rare in forests, trees per biome with varied heights and leaf shapes (oak balloon, birch tall, spruce cone). Trees must not be cut at chunk borders: decorate using a deterministic per-chunk feature pass that also considers features from neighbouring chunks within a 3-block margin. Expansion terrain: deep caves (y ≤ 9) fill with lava in about three regions out of four and water in the rest (never spilling into air); single emerald ores in mountain stone (y 5–100); redstone ore (y 5–16); rare sealed lava lakes in deserts and mountains, never near trees, villages or temples; world spawn avoids lava. `generateChunk` dispatches Nether chunks (`cx >= 224 && cz < 32`) to `generateNetherChunk` (shared/nether.ts) and paints structures into overworld chunks (`paintStructures`, shared/structures). Target: `generateChunk` ≤ 6 ms median in Node on a laptop (Nether chunks ≤ 8 ms; about 1.1 ms measured).

## Blocks

IDs are fixed; the foundation implements this table in `src/shared/blocks.ts` with `name`, `shape`, `opaque`, `solid`, `transparent` render mode (`'opaque'|'cutout'|'translucent'`), `light` emission 0–15, `hardness` (seconds by hand baseline, MC-like; -1 = unbreakable), `tool` (`'pickaxe'|'axe'|'shovel'|'hoe'|'shears'|null`), `tier` required to get drops (0 none, 1 wood, 2 stone, 3 iron, 4 diamond), `drops` (function or table), `sound` group (`stone|wood|grass|gravel|sand|glass|wool|snow|metal`), texture keys per face (`top/bottom/side/front`), `replaceable` (tall grass etc.), and `flammable` (unused, reserved).

| id | name | notes |
|---|---|---|
|0|air||
|1|stone|drops cobblestone; pickaxe t1|
|2|grass_block|drops dirt|
|3|dirt||
|4|cobblestone||
|5|oak_planks||
|6|bedrock|unbreakable|
|7|sand||
|8|gravel|10% flint? no: drops gravel|
|9|oak_log|state: axis 0=Y 1=X 2=Z|
|10|oak_leaves|cutout; drops sapling 5%, apple 0.5%; state bit0 = player-placed (no decay; decay is optional)|
|11|glass|cutout; drops nothing|
|12|coal_ore|drops coal; t1|
|13|iron_ore|drops itself; t2|
|14|gold_ore|t3|
|15|diamond_ore|drops diamond; t3|
|16|crafting_table|3×3 crafting|
|17|furnace|state: facing 0–3 (N,E,S,W front)|
|18|furnace_lit|light 13; same as furnace, drops furnace|
|19|chest|state: facing; 27 slots|
|20|torch|shape torch; light 14; state 0 floor, 1–4 wall attached facing N,E,S,W|
|21|water|translucent, not solid, not targetable; source only (no flow simulation); swimmable|
|22|sandstone||
|23|birch_log|axis|
|24|birch_leaves|cutout|
|25|birch_planks||
|26|spruce_log|axis|
|27|spruce_leaves|cutout|
|28|spruce_planks||
|29|snow_block||
|30|snowy_grass|drops dirt; snow top texture|
|31|ice|translucent, slippery (friction .98)|
|32|cactus|shape cactus (inset 1/16), damages on contact, t0|
|33|clay|drops 4 clay_ball|
|34|bricks||
|35|stone_bricks||
|36|mossy_cobblestone||
|37|short_grass|cross, replaceable, drops wheat_seeds 12%|
|38|fern|cross, replaceable|
|39|dandelion|cross|
|40|poppy|cross|
|41|cornflower|cross|
|42|dead_bush|cross, replaceable, drops stick 0–2|
|43|sugar_cane|cross; drops sugar_cane item; must stand on grass/dirt/sand next to water or on sugar cane|
|44|oak_sapling|cross; state = growth 0–3|
|45|birch_sapling|cross|
|46|spruce_sapling|cross|
|47|wheat|crop shape; state 0–7; drops wheat+seeds at 7, seeds otherwise|
|48|carrots|crop; state 0–7; drops carrot items|
|49|potatoes|crop; state 0–7|
|50|farmland|15/16 tall; state 0 dry 1 wet (water within 4)|
|51|bed|shape bed (9/16 tall); state: facing 0–3 + 4 if head part; two-block|
|52|ladder|shape ladder; state facing; climbable|
|53|oak_door|shape door; state: facing 0–3, +4 open, +8 upper half; two-block|
|54|oak_slab|state 0 bottom 1 top 2 double|
|55|cobblestone_slab||
|56|stone_brick_slab||
|57|oak_stairs|state: facing 0–3, +4 upside-down|
|58|cobblestone_stairs||
|59|stone_brick_stairs||
|60|lantern|shape lantern (small), light 15|
|61|white_wool||
|62|red_wool||
|63|yellow_wool||
|64|blue_wool||
|65|green_wool||
|66|black_wool||
|67|bookshelf||
|68|pumpkin|state facing|
|69|jack_o_lantern|light 15; state facing|
|70|melon|drops 3–7 melon_slice|
|71|hay_bale|axis|
|72|iron_block||
|73|gold_block||
|74|diamond_block||
|75|coal_block||
|76|terracotta||
|77|obsidian|hardness very high; diamond pickaxe (t4)|
|78|netherrack|hardness 0.4, pickaxe t1; fire on top burns forever|
|79|soul_sand|collision 14/16 tall; slows walking ×0.4|
|80|glowstone|light 15, drops 2–4 glowstone_dust, any tool|
|81|nether_quartz_ore|drops quartz, t1|
|82|nether_gold_ore|drops 2–6 gold_nugget, t1|
|83|lava|liquid, light 15, static source (no flow), slows; 4 damage / 0.5 s + burning 15 s; buckets pick it up; water and lava meeting make obsidian|
|84|magma_block|light 3; 1 damage/s when standing on it unless sneaking|
|85|nether_bricks|t1|
|86|quartz_block|t1|
|87|nether_portal|shape portal; state axis (0 plane spans X, 1 spans Z); thin 4/16 slab, not solid, light 11, translucent animated; breaking any frame or portal cell removes the whole connected portal|
|88|fire|shape fire; light 15, not solid, replaceable; burns out after 2–6 s unless on netherrack or magma; 1 damage/s + burning 8 s|
|89|red_mushroom|cross|
|90|brown_mushroom|cross, light 1|
|91|cobweb|cross, not solid; movement inside ×0.15, falls slowed; sword or shears break it fast and drop string|
|92|oak_fence|shape fence; state bits 0–3 = connections N, E, S, W (kept up to date by the server and worldgen); collision 1.5 tall|
|93|monster_spawner|shape cage; state = mob type; hardness 5, pickaxe t1, drops nothing|
|94|emerald_ore|drops emerald; t3|
|95|emerald_block||
|96|chiseled_sandstone||
|97|cut_sandstone||
|98|sandstone_stairs|stairs|
|99|sandstone_slab|slab|
|100|dirt_path|15/16 tall; a shovel on grass makes it|
|101|cracked_stone_bricks||
|102|mossy_stone_bricks||
|103|redstone_ore|drops 4–5 redstone, t3|
|104|redstone_wire|shape wire; state = power 0–15; not solid, breaks instantly, drops redstone|
|105|redstone_torch|torch states; light 7; power source|
|106|redstone_torch_off|unlit variant|
|107|lever|bits 0–2 attached face (the supporting block's face it sits on), bit 3 on, bits 4–5 horizontal facing for floor/ceiling levers|
|108|stone_button|bits 0–2 attached face, bit 3 pressed; pressed 1 s|
|109|oak_button|pressed 1.5 s|
|110|stone_pressure_plate|bit 0 pressed; players and mobs press it|
|111|oak_pressure_plate|also dropped items and primed TNT|
|112|redstone_lamp||
|113|redstone_lamp_lit|light 15; drops redstone_lamp|
|114|repeater|bits 0–1 facing (output direction), bits 2–3 delay − 1 (1–4 redstone ticks), bit 4 powered; using it cycles the delay|
|115|piston|bits 0–2 facing (0..5, the face the head extends from), bit 3 extended; an extended base collides 12/16 deep|
|116|sticky_piston|same; pulls one block back on retract|
|117|piston_head|bits 0–2 facing, bit 3 sticky; never an item; breaking it breaks the base|
|118|iron_door|oak_door states; only redstone opens it|
|119|tnt|redstone, fire, flint and steel or an explosion primes it|
|120|redstone_block|constant power 15 (not strong)|

The chest state carries loot bits: bits 0–1 facing, bits 2–4 = generated loot table (0 none, 1 village_house, 2 village_smith, 3 desert_temple, 4 mineshaft, 5 dungeon). Only worldgen writes nonzero loot bits.

Shapes: `cube, cross, crop, torch, slab, stairs, ladder, door, bed, cactus, lantern, farmland, liquid, portal, fire, fence, cage, wire, lever, button, plate, repeater, piston, piston_head` (wire, plate, button, lever, fire and portal are non-solid). `src/shared/shapes.ts` exposes `collisionBoxes(cellValue): Box[]` (local 0–1 boxes, empty for non-solid) and `selectionBoxes(cellValue): Box[]` used by physics, raycast and the outline.

## Items

`src/shared/items.ts`. Item ids 1–255 are the block of the same id (placeable, stack 64). Non-block items start at 256. Fields: `name` (display, e.g. "Stone Pickaxe"), `stack` (64/16/1), `tool?: { kind, tier, speed, durability, damage }`, `food?: { hunger, saturation }`, `places?: blockId` (seeds→wheat, carrot→carrots, potato→potatoes, sugar_cane→sugar_cane, bed→bed, oak_door→oak_door), `fuel?: seconds`, `icon` key for the art atlas.

Non-block items: stick, coal, charcoal, iron_ingot, gold_ingot, iron_nugget, diamond, clay_ball, brick, flint, wheat_seeds, wheat, bread, apple, golden_apple, carrot, potato, baked_potato, sugar_cane, sugar, paper, book, melon_slice, beef, cooked_beef, porkchop, cooked_porkchop, chicken, cooked_chicken, mutton, cooked_mutton, rotten_flesh, bone, bone_meal, string, feather, gunpowder, leather, egg, arrow, bow, bucket, water_bucket, shears, bed, oak_door, and tools: wooden/stone/iron/diamond × pickaxe/axe/shovel/hoe/sword (MC tiers: speeds 2/4/6/8, durability 59/131/250/1561, sword damage 4/5/6/7 + 1 for hand=1).

Expansion items (322+): glowstone_dust, quartz, gold_nugget, nether_brick, emerald, flint_and_steel (durability 64), lava_bucket (fuel 1000 s, leaves a bucket), redstone (places wire), repeater, iron_door, and armor: leather / golden / iron / diamond × helmet, chestplate, leggings, boots (stack 1). Armor points (MC) helmet/chest/legs/boots: leather 1/3/2/1, gold 2/5/3/1, iron 2/6/5/2, diamond 3/8/6/3 (diamond toughness 2 each); durability = material multiplier (leather 5, gold 7, iron 15, diamond 33) × base (helmet 11, chest 16, legs 15, boots 13). Recipes cover all of them (standard MC patterns; sticky piston = piston + 2 string, shapeless, because Blockwild has no slimes), plus fences, nether bricks, quartz, glowstone, emerald/redstone/gold-nugget blocks, sandstone variants, and smelting for the Nether ores, netherrack → nether brick, stone bricks → cracked, redstone and emerald ore. Obsidian only comes from water meeting lava.

Slot type everywhere: `type Slot = { id: number; n: number; d?: number }` (`d` = damage used for tools). Empty slot is `null`.

## Player physics (shared, `src/shared/physics.ts`)

Used identically by client prediction and server validation. AABB 0.6×1.8 (sneaking 0.6×1.5), eye height 1.62 (sneak 1.27). Gravity 32 m/s², jump velocity 9.0 (≈1.25 block jump), terminal velocity 78. Ground acceleration model with friction; walk 4.3 m/s, sprint 5.6, sneak 1.3 (sneak prevents walking off edges), creative flying 10.9 horizontal, fly up/down 7.5. Auto step-up is **off** (MC style: jump to climb), except slabs/half-height stairs (step height 0.6 is OK). Water: slow movement, sink slowly, hold jump to swim up; drowning handled by server. Ladders: climb at 2.35 m/s when moving into them or holding jump; sneak holds position. Axis-separated sweep against `collisionBoxes`, with sub-steps so nothing tunnels at terminal velocity. Deterministic given `(state, input, dt, getCell)`.

```ts
type Body = { x:number; y:number; z:number; vx:number; vy:number; vz:number; onGround:boolean; inWater:boolean; onLadder:boolean; sneaking:boolean; flying:boolean };
type MoveIntent = { forward:number; strafe:number; jump:boolean; sneak:boolean; sprint:boolean; flyDown:boolean; yaw:number };
function stepBody(body:Body, intent:MoveIntent, dt:number, getCell:(x:number,y:number,z:number)=>number, mode:'survival'|'creative'): void;
```

## Networking model (the core of "feels instant")

Server tick 20 Hz, snapshots 20 Hz. The server is authoritative for the world, inventories, health, mobs, items and every rule. The client is authoritative-with-validation for its **own position** so movement has zero latency.

### Input (held; `src/shared/protocol.ts`)

```ts
type Input = {
  p: [number,number,number]; v: [number,number,number]; yaw:number; pitch:number;
  f: number;           // flags: 1 onGround, 2 sneak, 4 sprint, 8 flying, 16 using-item (eating / drawing bow), 32 swinging
  slot: number;        // selected hotbar slot 0–8
  mine: [number,number,number] | null;   // block currently being mined (crack progress + timing validation)
  tpAck: number;       // last server teleport sequence this client applied
  cmds: Cmd[];         // every not-yet-acknowledged command, ascending n, at most 32
};
type Cmd = { n:number } & (
  | { t:'break'; x:number; y:number; z:number }
  | { t:'place'; x:number; y:number; z:number; face:number; slot:number }     // x,y,z = the clicked block; face 0..5 = -X,+X,-Y,+Y,-Z,+Z
  | { t:'use'; x:number; y:number; z:number; face:number }                     // interact with a block (table, furnace, chest, bed, door, crop with bone meal, till with hoe, bucket)
  | { t:'useItem'; slot:number }                                               // finish eating, release bow, use bucket on air
  | { t:'attack'; id:number }                                                  // mob id
  | { t:'interact'; id:number }                                                // shear / feed / breed a mob
  | { t:'click'; w:'inv'|'grid'|'out'|'screen'; i:number; b:0|1|2 }           // left, right, shift-click (MC container semantics)
  | { t:'craft'; r:string; max?:boolean }                                      // recipe-book craft straight into the inventory
  | { t:'close' }                                                              // close screen; grid + cursor contents return to inventory
  | { t:'drop'; slot:number; all?:boolean }
  | { t:'respawn' }
  | { t:'wake' }                                                               // leave a bed
  | { t:'creative'; id:number; slot:number }                                   // creative: put a full stack of id into slot
  | { t:'trade'; i:number; max?:boolean }                                      // run offer i of the open trade screen once, or as often as possible
);
// click targets also include 'armor' (i = 0 head .. 3 feet); useItem with armor in hand equips it (swapping); attack also takes a ghast fireball's id (hitting sends it back)
```
`neutralInput()` keeps the last position semantics: the server ignores `p` from a neutral input (flag it with `f & 64` "no position" or compare with a sentinel) and treats it as standing still with no commands.

Rules for commands: the client keeps an ordered queue; each command gets `n = lastN + 1`; the server executes, in order, every command with `n > player.ack`, rejects invalid ones (still advancing `ack`), and reports `ack` in the private view. The client drops queued commands with `n <= ack`. Commands are never executed twice. Client state resets its sequence from the private view's `ack` on (re)connect.

**Optimistic prediction.** For `break`/`place` the client immediately applies the edit to a local overlay (`Map<cellIndex, {value, n}>`) and plays the effect; the overlay entry is removed once `ack >= n`, at which point the authoritative `edits` (same snapshot) already contain the accepted result. A rejected command therefore visually reverts on its own. Inventory clicks/crafts are predicted with the same pure functions from `src/shared/inventory.ts` / `recipes.ts` over a local copy, replaced by the private view once acked.

**Movement validation.** Server accepts `p` when `tpAck >= player.tp.n`, the AABB is not inside solid collision boxes (0.05 tolerance), and the horizontal displacement fits a movement budget that refills at 1.35× top speed and holds at most a 1.1 s lag burst (spent per move, never re-granted per update), falls stay within terminal velocity, and survival players never rise more than 1.6 blocks above where they last stood, swam, climbed or flew. Otherwise it issues a teleport `tp = { n: n+1, x,y,z }` back to the last valid position. Respawn, bed wake-up and `/`-free admin moves also use `tp`. Server-caused velocity (knockback, explosions) is sent as `imp = { n, vx, vy, vz }`; the client adds it once per new `n`. Fall damage is computed server-side from accepted positions (track the highest y since last on ground/in water/ladder; damage = floor(fall − 3)).

**Mining validation.** The server records when `mine` changes to a new target. A `break` is accepted if the target is within reach (4.5 survival / 5 creative from the eye, to the nearest point of the block), the block is breakable, and `elapsed >= breakTime(block, heldItem, onGround, inWater) * 0.6 − 0.15 s`, or the mode is creative (instant, but rate-limited to 5/s). `breakTime` lives in `src/shared/mining.ts` so the client's crack animation matches.

### Public view (to everyone, every snapshot)

```ts
type View = {
  seed:number;       // always the real seed (never 0)
  worldId:string;    // stable for a world across saves and loads, e.g. `${seed}-${base36 time}`
  mode:'survival'|'creative'; difficulty:'peaceful'|'easy'|'normal'; time:number; day:number;
  revision:number; edits:[number,number][];
  players: PubPlayer[]; mobs: PubMob[]; items: PubItem[]; arrows: PubArrow[]; fx: Fx[];
  sleeping:number;   // players in bed
  stats: { mined:number; placed:number; crafted:number; mobs:number; deaths:number; days:number };
};
type PubPlayer = { id:string; name:string; color:string; x:number; y:number; z:number; yaw:number; pitch:number; held:number; swing:number; hurt:number; health:number; flags:number; mine?:[number,number,number,number]; armor:[number,number,number,number] };
// flags: 1 sneaking, 2 sleeping, 4 dead, 8 flying, 16 eating/drawing, 32 disconnected, 64 burning. swing/hurt are monotonic counters. armor: worn item ids (0 = none).
type PubMob = { id:number; t:number; x:number; y:number; z:number; yaw:number; hurt:number; a:number; s?:number; p?:number };
// t index into MOB_TYPES (zombie, skeleton, spider, creeper, cow, pig, sheep, chicken, villager, zombified_piglin, ghast, tnt); a: 0 idle 1 walk 2 attack 3 fuse/charging
// (ghast: 3 charging, 2 just fired; primed TNT: fuse ticks / 4 for the flash); s: 1 sheared, 2 baby, 4 angry, 8 burning; p: villager profession
type PubItem = { id:number; item:number; n:number; x:number; y:number; z:number };
type PubArrow = { id:number; x:number; y:number; z:number; vx:number; vy:number; vz:number; k?:number };   // k 1 = ghast fireball
type Fx = { id:number; k:FxKind; x:number; y:number; z:number; a?:number };   // monotonic id; client plays each once; kept ~1.5 s
// FxKind: 'break'(a=cell value) 'place'(a=cell value) 'hit' 'explode' 'mob'(a=mob type: ambient sound) 'hurtMob' 'die' 'pickup' 'eat' 'splash' 'bow' 'door' 'chest' 'furnace' 'craft' 'levelup'
//   'portal' 'travel' 'ignite' 'fizz' 'lever'(a 1 on/0 off) 'button'(a 1 press/0 release; plates and repeater clicks too) 'lamp' 'tnt'(primed) 'trade'(a=sold item)
//   'spawner'(a=mob type) 'ghast'(warning cry) 'fireball'(launch); 'piston' sits at the base centre with a = travel face + 8 × moved blocks (retracting: facing ^ 1).
//   A broken armor piece is a 'break' at non-integer coordinates whose a is a material block (terracotta, gold, iron, diamond block).
```
Quantize positions to 2 decimals and angles to 3 decimals. Caps: hostile mobs ≤ 2 + 6×players (max 50; halved on easy, ×0.6 on day 0), animals ≤ 48, items ≤ 128 (merge nearby identical stacks), arrows ≤ 32, fx ≤ 64.

### Private view (per player)

```ts
type PrivateView = {
  ack:number; tp:{ n:number; x:number; y:number; z:number; yaw?:number }; imp:{ n:number; vx:number; vy:number; vz:number };
  inv:(Slot|null)[];        // 36: 0–8 hotbar, 9–35 main
  cursor:Slot|null;         // item held on the mouse/finger in an open screen
  grid:(Slot|null)[];       // crafting grid: 4 (inventory 2×2) or 9 (crafting table)
  out:Slot|null;            // crafting output preview
  screen: null | { kind:'table'|'furnace'|'chest'|'trade'; x:number; y:number; z:number; slots:(Slot|null)[]; burn?:number; burnMax?:number; cook?:number; cookMax?:number;
    offers?:{ buy:Slot; buyB?:Slot; sell:Slot; left:number }[]; villager?:number; profession?:number };   // trade: no slots, x/y/z = the villager's cell
  health:number; food:number; saturation:number; air:number;   // air 0–300 ticks
  dead:boolean; deathMessage?:string; spawn:[number,number,number];
  toast?:{ n:number; text:string };
  mode:'survival'|'creative';
  keepInventory:boolean;
  protectedTicks?:number;   // spawn/respawn/reconnect protection left; omitted when 0
  armor:(Slot|null)[]; armorPoints:number;        // worn head, chest, legs, feet
  burning?:number;          // burning ticks left; omitted at 0
  portal?:number;           // 0..1 charge while standing in a portal; omitted at 0
  dimension:'overworld'|'nether';
};
// tp.yaw (portal arrivals) also turns the client's view.
```

### Settings

```ts
type Settings = { mode:'survival'|'creative'; seed:number; difficulty:'peaceful'|'easy'|'normal'; keepInventory:boolean };
// defaults: survival, seed 0 = random each world (the server maps RoundContext.seed into 1–999999; a fixed seed is 1–999999 and the Settings UI offers "New seed"), normal, keepInventory true (party-friendly). loadSave returns the saved real seed.
```

## Gameplay rules (server owner)

- Survival: health 20, food 20, saturation 5, exhaustion from sprinting/jumping/mining/attacking. Food ≥ 18 regenerates 1 health / 4 s; food 0 starves to 1 health on easy, 0 on normal (peaceful regenerates and never drains). Fall damage, drowning (air 300 ticks, 2 damage/s at 0), cactus contact 1/0.5 s, zombie burning in daylight, creeper explosions (radius 3, block destruction except bedrock/obsidian, damage by distance, knockback), skeleton arrows, spider leap. Damage invulnerability 0.5 s; knockback via `imp`.
- Death: drop inventory unless `keepInventory`; death message; respawn command → bed spawn if valid, else world spawn; full health/food. Spawning, respawning and reconnecting give 5 s of protection (no damage, monsters ignore you), and hostile mobs within 16 blocks of the respawn point despawn.
- Mobs: zombie, skeleton, spider, creeper (hostile; spawn at night or in dark caves where sky/block light is low, at least 24 blocks from every player and out of their line of sight by day, never within 32 blocks of the world spawn on day 0, despawn beyond 96 blocks or randomly when far; peaceful removes hostiles). Cow, pig, sheep (shearable, regrows by grazing), chicken (lays eggs). Animals spawn with terrain in grassy biomes (deterministic per chunk when first loaded near players, bounded total), follow a player holding wheat/carrot/seeds, breed with food (baby grows in 5 min). AI: wander, flee when hit (animals), chase within 16 blocks with line-of-sight or recent aggro (hostiles), simple grid pathfinding (A* over walkable cells within 24 blocks, recomputed ≤ 2×/s) with jumping and water swimming, no mob-through-wall movement. Drops per MC.
- Item entities: dropped by mining/death/drop command; bob and spin; 0.5 s pickup delay for player-thrown items; magnet within 1.5 blocks; merge stacks; despawn after 10 minutes.
- Crafting: MC-style shaped and shapeless recipes (mirrorable) matched from the 2×2 grid (inventory) or 3×3 grid (crafting table screen). Recipe book command `craft` crafts directly from inventory ingredients (needs a nearby crafting table within 4 blocks for 3×3 recipes). Furnaces: input/fuel/output slots, 10 s per item, fuel times as MC, lit block state while burning; smelting continues when nobody is watching (tick loaded furnaces). Chests: 27 slots shared by everybody; breaking drops contents.
- Blocks: placement faces the player (furnace/chest/pumpkin/stairs/door/bed), logs orient by clicked face, slabs merge into double slabs, torches attach to walls, doors/beds place two blocks, hoe tills grass/dirt into farmland, seeds on farmland, bone meal advances crops/saplings, crops grow on random ticks (faster when watered), saplings grow into trees (same tree generator as worldgen via a shared function), water bucket places/picks up source blocks, sugar cane grows up to 3 tall. Placing may not intersect any player or mob AABB.
- Sleep: using a bed at night sets spawn and lays the player down (`wake`, Jump or Sneak gets up); when every connected, alive player is sleeping, skip to morning (tick 0 of the next day). Survival toasts warn at dusk (tick 11500) and nightfall (13000, not in peaceful).
- Creative: instant break, no drops, infinite blocks (placing doesn't consume), flight (double-tap jump), no damage, creative palette command.
- Stats for results: per player mined, placed, crafted, mob kills, deaths, distance walked; world days survived.
- Outcome: `complete` only after the host finishes; winners = everyone (cooperative); rows show each player's highlights.

## Exploration, armor, villagers, the Nether and redstone (server owner unless noted)

Each system is one server module with hooks called from `game.ts`, `commands.ts`, `combat.ts`, `mobs.ts`, `views.ts`, `world.ts` and `save.ts`. The fixed tick order is: players → redstone → portals → burning → fire blocks → spawners → mobs (villagers, Nether mobs, primed TNT) → fireballs → arrows → items → furnaces → growth.

### Structures (`shared/structures/**`, `shared/loot.ts`, `sim/structures.ts`)

- Placement uses MC region grids (spacing / separation in chunks): village 32/8, desert temple 32/8, mineshaft 13/3; each start sits at a hashed chunk and is kept if its planner accepts the biome and terrain. Structures stay 24 blocks clear of the world rim and the Nether region, and temples never overlap villages. Dungeons are per-chunk features (about 1 chunk in 20) set beside cave floors.
- Each start is planned once per seed into paint operations bucketed by chunk and cached (64 plans per seed, for up to `SEED_CACHE` = 32 worlds, the most a room hub runs). `generateChunk` replays only its own bucket, so pieces join across chunk borders; every operation reads at most its own column, so the result never depends on load order. Painting costs about 0.03 ms per chunk; planning a village about 5–10 ms, once. Trees rooted inside a surface structure are removed whole, cacti inside are cleared, and nothing lava-lake-shaped lands inside.
- Villages (plains, forest, taiga, desert palettes): a well, 3-wide dirt-path streets (gravel over water), gabled houses and cottages, a large two-bed house, a blacksmith (furnace, village_smith chest), a library, 2–3 farms with water channels and ripe crops, and lamp posts. Buildings face their street on foundations filled down to the ground, with air cleared above. House doors are generated **open** because villagers walk only through open doors. `villagesNear(seed, cx, cz)` returns `{ center, houses: { bed, bounds }[], bounds }`: `center` is a standable path cell beside the well, `bed` is each bed's foot cell.
- Desert temples: a stepped sandstone pyramid with two towers and terracotta patterns; a hidden shaft drops to a sealed chamber with 4 desert_temple chests and the trap (a stone pressure plate on sandstone above a 3×3 of TNT).
- Mineshafts (y 8–60): corridors with plank floors over caves, fence posts and plank beams every 4 blocks, crossings, stairs, cobwebs, torches, chests in niches and rare spider spawners. Dungeons: a mossy cobblestone room with a zombie, skeleton or spider spawner and 1–2 chests (Blockwild's caves are narrow, so up to 12 floor and 3 ceiling holes are paved over).
- Loot is rolled once from the world seed and the chest's cell (`rollLoot(table, lootSeed(seed, index))`) the first time a generated chest is opened or broken; the roll clears the loot bits with an edit first (if the edit limit refuses, the chest stays sealed). Worldgen torches and lit furnaces count as light for monster spawning.
- Spawners register as their chunk generates. They wake for an unprotected player within 16 blocks, spawn 1–4 mobs on free floor within 4 blocks every 10–40 s, hold off while 6+ of that mob are within 9 blocks, ignore the daylight and first-day rules, sleep in peaceful and are forgotten when broken. Only generated spawners run.

### Armor (`sim/armor.ts`)

Damage after armor = `damage × (1 − min(20, max(points / 5, points − damage / (2 + toughness / 4))) / 25)` (MC). Armor reduces mob, arrow, fireball, explosion, cactus, fire and lava damage, not fall, drowning, starvation or magma. Each reduced hit costs every worn piece `max(1, floor(damage / 4))` durability in survival; a worn-out piece breaks with a toast and chips. Explosions deal half of MC's `7 × 2·power` so point-blank blasts stay survivable for unarmored party players; armor cuts that further.

### Villagers and trading (`sim/villagers.ts`, `shared/trades.ts`)

- One villager (0.6 × 1.95, 20 health, persistent) spawns beside each house bed when its chunk is first populated; profession (0 farmer, 1 librarian, 2 armorer, 3 toolsmith, 4 cleric) and seed hash from the bed, capped at 64.
- Routine, re-planned every ~0.5 s: stand still facing a player who has its trade screen open; flee monsters within 8 blocks (angry piglins only); panic after a hit; from tick 12000 to 23500 walk home and stand by the bed; otherwise stroll within 32 blocks of the village centre, preferring paths. Idle villagers look at players within 6 blocks. Zombies hunt villagers they can see within 16 blocks.
- `offersFor(profession, seed)` gives 3–5 deterministic offers with MC-like prices: buys first (every villager earns emeralds), then sells, then at most one rare diamond deal (40% of armorers and toolsmiths). Uses: buys 16, sells 12 (some 16), rare deals 3; everything restocks at dawn. A trade runs on a copy of the inventory, so goods that would not fit change nothing.

### The Nether (`shared/nether.ts`, `sim/portals.ts`, `sim/fire.ts`, `sim/nether-mobs.ts`)

- Terrain comes from one 3D "solidness" field (floor and ceiling heights roughened by noise, large blobs for walls and floating islands, hourglass pillars), thickened near the walls. Open cells at y ≤ 31 are the lava sea. Soul sand valleys, gravel and soul sand shores, magma by the lava, quartz and gold veins, fire (only on netherrack), mushrooms, hanging glowstone and lava "eyes" follow. Same cross-engine math rules as worldgen.
- Portals: an obsidian frame with a 2–21 wide × 3–21 tall interior (either plane, corners optional) lights with flint and steel or fire. Standing in it for 4 s (1 s in creative) travels 8:1 (overworld (x, z) → (3584 + ⌊x/8⌋, ⌊z/8⌋) clamped to [x0 + 8, x0 + 503] × [8, 503]; back → (8·(x − 3584), 8·z) clamped to [16, 4079], nudged out of the Nether's own corner). Arrivals reuse a portal within 128 blocks (overworld) or 16 (Nether), else build a 4 × 5 portal on firm dry ground with room on both sides within 16 blocks (closest to the player's height in the Nether, the surface in the overworld), else carve one in place on an obsidian platform. The player stands in the arrival portal facing its roomier side (`tp.yaw`) and cannot re-enter until stepping out. Breaking any frame or portal cell unlights the whole portal; the portal index rebuilds from edits on load. Items and mobs don't travel.
- Fire and burning: fire never spreads and burns out after 2–6 s unless on netherrack or magma; fire touching TNT primes it. Players and mobs burn on one timer at 1 damage/s: lava 15 s (plus 4 damage per 0.5 s while inside), fire blocks 8 s, fireballs 5 s, zombies and skeletons in daylight 8 s (so they keep burning briefly in shade). Water puts it out (`fizz`). Creative players, piglins, ghasts and primed TNT never burn. Monsters don't spawn in or path through lava.
- In the Nether, beds explode (power 5) and water cannot be placed (it fizzes and the bucket empties).
- Mobs spawn only inside the region, never within 24 blocks of a player: zombified piglins in groups of 2–4 on the floor (cap 4 + 4 per player there, max 20; neutral, and hitting one angers every piglin within 24 blocks for 30 s; they hit for 5), ghasts in 5×5×5 air pockets (cap 1 + 1 per player, max 4) that lock onto a visible player within 48 blocks, cry for 1 s and fire. Fireballs fly straight at 14 m/s, hit for 6 plus 5 s of burning, then make a power-1 explosion that lights about a third of the open floor. Hitting a fireball (the crosshair targets it; `attack` with its id within reach + 1.5) sends it back along your look, and a returned fireball kills a ghast outright.

### Redstone (`shared/redstone.ts`, `sim/redstone.ts`)

Server-simulated; the client only renders states and uses the shared `wireShape` for dust meshes. Semantics follow MC closely enough that tutorials work:
- A redstone tick is 2 game ticks. Sources: lever, button, pressure plate, lit torch, redstone block (15). Levers and buttons strongly power their support, plates the block below, a lit torch the block above (its other sides power components only, never blocks, and never its own support), a repeater the block in front.
- Conductors are opaque full blocks except pistons and redstone blocks. Dust powers the block beneath and the block it points into weakly; weak power reaches lamps, doors, pistons and TNT but not dust. A lone dot powers all four sides, a single join runs straight through; dust steps up and down unless a conductor cuts the step. A dust network (≤ 8192 cells) is rebuilt at once, so lines turn off instantly.
- Timings: torches 1 redstone tick, repeaters 1–4 (short pulses extended), lamps 2 to go dark, buttons 1 s (stone) / 1.5 s (oak), plates release 1 s after the last touch. A torch that toggles more than 8 times in 60 game ticks (checked on turn-off) burns out for 3 s.
- Plates sense bodies each tick in the inner 14/16 of the footprint, 0.25 tall (stone: players and mobs; oak: also items and primed TNT), so generated plates like the temple trap need no registration. Doors follow power only when it switches, so oak doors still open by hand.
- Pistons push up to 12 blocks (failing on bedrock, obsidian, chests, furnaces, spawners, portals, extended pistons, unloaded chunks and the world edge), break the first fragile block in the way with drops, move blocks with their state, pause 2 ticks after each move and shove players (by teleport), mobs and items one block. Sticky pistons pull one block back. Breaking the head breaks the base and vice versa. The client slides moved blocks from the `piston` fx.
- TNT primes into a `tnt` mob (80-tick fuse; a = fuse / 4 for the flash) that pops up, falls and explodes at power 4, chain-priming nearby TNT with a short random fuse.
- Everything runs only in loaded chunks and nothing is saved: loaded edits are marked dirty, so lamps stay lit, pressed buttons release and clocks resume. Budget ≤ 1 ms per tick (a 52-dust clock plus a 12-piston door measures about 0.03 ms mean).

## Saves (server owner)

Format version 9 (versions 1–8 are refused with the old-save message: edits are differences from generated terrain, so a version 8 world would silently change under the expansion generator). `{ format:'blockwild', version:9, seed, worldId, mode, difficulty, keepInventory, time, day, edits: base64 of packed little-endian (uint32 cellIndex, uint16 value) entries, players:[{ name, x,y,z, yaw, pitch, health, food, saturation, inv (compact), spawn }], chests:[{ i, slots }], furnaces:[{ i, slots, burn, burnMax, cook }], animals:[{ t, x,y,z, s }], stats }`. Players match by exact unique name on load; unmatched players spawn fresh. Validate everything; `loadSave` never mutates live state. Add a test that builds the worst legal save (16384 edits, 10 full inventories, 64 full chests) and asserts < 256 KiB; cap chests/furnaces accordingly. Version 9 adds `armor` per player and `villagers: [{ x, y, z, p, home?, uses, seed }]` (≤ 64; offers derive from profession and seed, so only uses are stored). Chest and furnace records may sit on unedited cells (generated village chests and furnaces); `createState` drops any whose terrain no longer holds that block. Generated containers gain state only when first opened, and past the caps (64 chests, 32 furnaces) they stay shut with a toast, so a save always loads. Redstone, portal and fire indexes are not saved: they rebuild from the loaded edits.

## Client architecture

- `src/client.tsx`: the `GameClientModule`. `SceneView` lazy-loads `src/client/scene.tsx`. `DisplayView` (watching host, TV), `ControllerView` (every playing seat, including a playing host; no separate PersonalView needed) render HTML HUD/menus layered above the scene canvas.
- SceneView and ControllerView are mounted separately by the shell; they communicate through a tiny module-level store `src/client/store.ts` (subscribe/get/set, no React dependency in the store itself) holding: local predicted player state (body, health), selected slot, targeted block/mob, open screen, pointer-lock state, touch control state, predicted inventory, pending command queue, settings like render distance and sensitivity. **The command queue and the single `setInput` call live in the scene's game loop** so exactly one component sends input.
- Rendering (engine owner) runs in `src/client/engine/`: a Web Worker (`worker.ts`, loaded with `new Worker(new URL('./worker.ts', import.meta.url), { type:'module' })`) generates chunks with the shared worldgen, applies edits, computes sky light and block light (BFS flood fill, 0–15, across chunk borders), and builds meshes per 16×16×16 section with face culling, per-vertex ambient occlusion and smooth lighting. It returns transferable typed arrays (positions, uvs/texture layer, normals or face ids, AO+sky+block light) and a copy of the chunk cells for the main thread (physics/raycast). Separate opaque, cutout (leaves/plants/glass) and translucent (water/ice) meshes; translucent sorted per section by distance. A custom shader applies a texture array (or padded atlas) with nearest filtering and mipmaps, smooth light as `max(sky * daylight, block * warmTorchColor)` with a gamma curve, AO, distance fog blended to the sky colour, underwater tint, gentle leaf/plant sway, animated water. Sky dome shader with sunrise/sunset gradient, sun and moon, stars, drifting blocky cloud layer at y≈140. Render distance presets: low 4 chunks, balanced 6, high 8 (default: balanced on desktop, low on coarse-pointer devices), with fog at the edge. Chunk load order spirals from the player and prioritizes the view frustum; budget worker results per frame (≤ 4 ms upload) to avoid hitches. Target 60 fps on a mid-range phone at low.
- Engine public API (`src/client/engine/index.ts`):
  ```ts
  class VoxelEngine {
    constructor(opts:{ scene:THREE.Scene; seed:number; atlas:BlockAtlas; renderDistance:number; scope:ResourceScope; onError(e:unknown):void });
    readonly world: ClientWorld;              // main-thread cells for physics/raycast: getCell(x,y,z), isLoaded(x,z)
    setEdits(edits:[number,number][], overlay:ReadonlyMap<number,number>): void;   // authoritative edits + optimistic overlay; rebuilds only affected sections (+ neighbours on borders)
    update(camera:THREE.PerspectiveCamera, dt:number): void;   // streaming, uploads, sorting, animation uniforms
    setTime(dayTicks:number): void;           // sky, sun, light uniforms
    lightAt(x:number,y:number,z:number): number;   // 0–1 combined light for entity tinting
    setRenderDistance(chunks:number): void;
    setUnderwater(on:boolean): void;
    ready(): Promise<void>;                   // resolves when chunks around the spawn are meshed
    dispose(): void;
  }
  ```
  Plus `BlockOutline` (selection box from `selectionBoxes`), `CrackOverlay` (10 stages), `SkyRenderer` inside the engine.
  Expansion members: `shared` (atlas uniforms, including the current lava, portal and fire animation layers), `inNether` (the Nether look follows the camera: no sky, sun, moon, stars or clouds; dense dark-red fog `#2a0b08` → `#4a1410`; a warm ambient floor; 0.6 s fade; the TV switches with its subject), `setGlows(data, count)` (up to 4 point lights for fireballs and TNT) and `slide(x, y, z, cell, dx, dy, dz, seconds, veil)` (piston animation; the destination is hidden from the meshes only). The mesher has a shape for every block (fence posts and bars, dust from `wireShape` tinted by power, lever handles, repeater torches by delay, piston base/rod/head, thin portal slabs, MC's crossed fire planes, the two-sided spawner cage, lava as a self-lit 14/16 surface).
- Art (art owner): `src/client/art/atlas.ts` paints every block face texture as 16×16 pixel art into canvases at runtime (deterministic, hand-designed palettes, no external images), builds the texture array/atlas, the 10 crack stages, water/lava-free animated water frames, and `itemIcon(id): string` (data URL) for UI: isometric mini cubes for blocks, flat 16×16 sprites for items (tools, food, ingots, etc.), cached. Mob, animal and player models are built with Blender (`/Applications/Blender.app/Contents/MacOS/Blender -b --python art/<script>.py`) into `public/games/blockwild/models/*.glb`: blocky MC-proportioned rigs with pixel-art textures and **named pivot nodes** (`head`, `body`, `arm_l`, `arm_r`, `leg_l`, `leg_r`, spider `leg_0..7`, quadrupeds `leg_fl/fr/bl/br`) placed at the joints so code can animate rotations. The player model is tinted by player colour (shirt). Commit the Blender generator scripts and a lineup render (`art/lineup.png`). Keep each GLB ≤ 80 KB. Models face −Z. Expansion art: 45 more block textures; lava, nether_portal and fire animate like water (16 frames each at 4, 12 and 16 fps, `atlas.animations[key]`); greyscale dust tinted by `redstoneTint(power)`; armor skins (`armorSheet(material)`, `ARMOR_BOXES`, `armorGeometry(box)` in `art/armor.ts`) attached to the rig's pivots; one GLB per villager profession (`villager` is the farmer, plus `villager_librarian`, `_armorer`, `_toolsmith`, `_cleric`; crossed `arms` node, no arm pivots), `zombified_piglin` (gold sword on an `item` node), `ghast` (`tentacle_0..8`, a `face_shoot` panel shown while charging) and `tnt`.
- Game client (gameplay-client owner) in `src/client/game/`: local player controller using `stepBody` at display frame rate with fixed 1/60 sub-steps; desktop input (pointer lock, WASD, Space jump / double-tap to fly, Shift sneak, Ctrl or double-tap W sprint, LMB break/attack hold, RMB place/use, wheel and 1–9 hotbar, E inventory, Q drop, Esc release); touch input state from the store; raycast targeting (blocks via `selectionBoxes`, mobs via AABBs, nearest wins); mining progress with crack stages and particles; placement using the shared placement rules; command queue and `setInput` at 20 Hz; teleport/impulse handling; first-person arm and held item (extruded item sprite or mini block) with swing, bob, place, eat and bow-draw animations; view bob, sprint FOV kick, hurt tilt and red vignette, underwater fog; remote players/mobs/items/arrows rendered through `SnapshotBuffer` interpolation (~100 ms), with limb animation from speed, hurt red flash, name tags for players, sheep wool state, baby scale, creeper fuse flash; particles (block break chips from the texture, footstep dust, explosion puffs, torch flame and smoke, crit sparks, splash); positional audio from `public/games/blockwild/sounds` (material footsteps, break/place per sound group, mob ambient/hurt/death, eat, pickup, explosion, bow, door, chest), unlocked on gesture and respecting the `party-sound` mute event and `localStorage['party.sound.muted']`. Expansion: every new fx has a sound (synthesized where no file fits) and a visual (portal motes, dust particles, lava pops, villager sparkles); burning players and mobs show flames; first-person overlays draw fire at the bottom of the screen and the portal swirl (a plain purple fade under reduced motion) with a flash on arrival; the crosshair also targets ghast fireballs; prediction covers levers, buttons, repeater delays, shovel paths, flint and steel, buckets (including obsidian and lava), broken supports and two-block parts, fence joins, and armor clicks and right-click equips (published as `hud.armor`); a new `tp.yaw` turns the view.
- UI (UI owner) in `src/client/ui/`: HUD (crosshair, 9-slot hotbar with icons/counts/durability bars, hearts with half hearts and damage flash, hunger shanks, air bubbles underwater, selected item name tooltip, toast notifications, "Next goal" helper chip for new players derived from inventory/stats: punch a tree → planks → crafting table → wooden pickaxe → build a shelter (shown urgently from dusk on the first night) → mine stone → stone tools → furnace → torches → iron → diamonds; progress is remembered per `worldId`; dismissible), inventory screen (MC layout: 27 + 9 slots, 2×2 grid + output, recipe book panel with category tabs, search, "can craft" filter, tap-to-craft and shift/craft-all), crafting table screen (3×3), furnace screen (input/fuel/output with flame + arrow progress), chest screen (27 + inventory), creative palette (tabbed, searchable), death screen (message + Respawn), pause/help sheet with controls and settings (render distance, sensitivity, invert Y, FOV, sound), touch controls (landscape: left floating joystick with sprint when pushed to the rim, right-side drag-to-look anywhere not covered by a button, buttons: Jump (double-tap = fly in creative, hold = fly up), Sneak toggle / fly down, Mine/Attack (hold), Use/Place (tap; hold to eat or draw a bow), Inventory, Drop; the hotbar is tappable), desktop tooltips on hover, touch-friendly slot interaction (tap to pick up/place, long-press = right-click split, a "Quick move" toggle for shift-click). Watching display (`DisplayView`): TV overlay with player cards (colour, name, hearts, held item, what they're doing), the day clock, world stats and a "join on your phone" hint. The display SceneView renders a cinematic spectator camera that eases between players every ~20 s (third-person over-the-shoulder, occlusion-aware) and shows a slow flyover when nobody is connected. SettingsView, InstructionsView and ResultsView (world journal with per-player highlights) round it out. Use the shared `kp-` primitives and tokens, scope CSS under `.bw-`, Lilita One / Nunito, 44 px minimum targets, safe-area insets, reduced-motion. Expansion UI: an armor column (4 slots with ghost icons) and a small player doll in the inventory, reading the predicted `hud.armor`; a HUD armor bar (10 chestplates) above the hearts when armor > 0; a trade screen titled by profession (offer rows buy (+ buyB) → sell with uses left, ready/short/sold-out states, Trade and All, a "You have" line); Redstone tabs in the recipe book and creative palette (plus Nether); one-line hints for redstone items (tooltips, palette titles and under the HUD item name for touch players); the Next-goal chain continues after the diamond pickaxe with Build a Nether portal → Enter the Nether → Mine nether quartz, then soft side goals (Find a village, Trade with a villager, Wear full iron armor, Build a redstone lamp). Goal progress lives in one per-world copy in `hud.tsx` (`reachGoal`), since trading can't be read from the inventory. TV cards show an armor badge and a dark-red "In the Nether" state.

## File ownership

| Owner | Files |
|---|---|
| Foundation | `src/manifest.ts`, `src/shared/{constants,ids,blocks,shapes,items,coords,chunk,raycast,physics,protocol}.ts`, `src/client/store.ts`, `tests/foundation.test.ts`, `tests/expansion-foundation.test.ts`, `tests/boundaries.test.ts`, `tests/integration.test.ts` |
| Worldgen | `src/shared/{noise,worldgen,trees,nether,loot}.ts`, `src/shared/structures/**`, `tests/worldgen.test.ts`, `tests/nether.test.ts`, `tests/structures.test.ts` |
| Engine | `src/client/engine/**`, `tests/engine*.test.ts` |
| Art | `src/client/art/**`, `art/**`, `public/games/blockwild/models/**`, `tests/art*.test.ts` |
| Server | `src/server.ts`, `src/sim/**`, `src/shared/{mining,inventory,recipes,placement,redstone,trades}.ts`, `tests/server*.test.ts`, `tests/save.test.ts`, `tests/rules*.test.ts`, `tests/{armor,villagers,redstone,nether-portals,nether-fire,nether-mobs}.test.ts` |
| Client game | `src/client/scene.tsx`, `src/client/game/**`, `src/client/audio/**` (reuse/move `music.ts`, `host-music.ts`), `tests/client-game*.test.ts` |
| UI | `src/client.tsx`, `src/client/ui/**`, `src/client/style.css`, `tests/ui.test.ts` |

An owner may read everything but edits only its files. If an owner needs a change in another owner's file, it records the request in its final report (the integrator applies it) instead of editing.

## Quality bar and validation

- `node --import tsx --test packages/games/blockwild/tests/*.test.ts`, `npm run typecheck`, `npx oxlint packages/games/blockwild` (scoped), and `npm test` for the platform contract tests must pass.
- Browser QA uses `npm run build:isolated -- <unique-name>` and `npm run serve:isolated -- <name> <port>`; headless Chromium via the Playwright library at `/Users/joshthemenace/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs` with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` (software WebGL is slow; judge visuals, not fps). Evidence under `output/playwright/<name>/`. Never touch the user's live server on port 4361.
- Real acceptance: a solo host plays (walk, mine a tree, craft planks/table/pickaxe, mine stone, place blocks, night falls, torch glows), 2-player co-op sees each other and each other's edits, and a 10-player headless roster keeps the HUD/TV readable. Results and replay work.
