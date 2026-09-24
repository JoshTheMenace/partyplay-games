# Kitchen Rush art kit

Original models built procedurally in Blender 5.2 (bmesh primitives, bevels, vertex colours). No downloaded meshes or textures. The animal chefs in `public/games/kitchen-rush/models/kitchen-rush.glb` are contributor art by Aaron Hendricks, reused as-is (`extract_characters.py`).

## Rebuild

From the platform root:

```sh
blender --background --factory-startup --python-exit-code 1 --python packages/games/kitchen-rush/art/build_kit.py
blender --background packages/games/kitchen-rush/art/kitchen-kit.blend --python-exit-code 1 --python packages/games/kitchen-rush/art/render_kit.py -- icons sheets
node --import tsx --test packages/games/kitchen-rush/tests/models.test.ts packages/games/kitchen-rush/tests/assets.test.ts
```

- `build_kit.py` writes `kitchen-kit.blend`, `public/games/kitchen-rush/models/kitchen-kit.glb` and `asset-manifest.json` (triangles, materials, bounds, anchors, theme prop lists). It takes about 2 s. Exports have the same content on every run. Only the glTF exporter's accessor order varies, so the byte hash can change.
- `render_kit.py -- icons` renders the 256×256 transparent HUD icons into `public/games/kitchen-rush/icons/`. It uses one 3/4 orthographic camera and one three-light rig, and re-renders the animal portraits the same way.
- `render_kit.py -- sheets` (or `mock` for the kitchen only) writes QA sheets to `output/kitchen-rush/v2/art/` (gitignored): stations, food, dishes and items, props and chefs, plus a mock kitchen. The mock uses a Python port of `scene/layout.ts` `fitCamera`, the scene's item heights and six team-coloured chefs.

## Contract

Everything follows the "Model naming contract" in `../DESIGN.md`. Units are metres, Y is up and fronts face +Z. Each asset is a top-level object at the origin.

| Family | Rules |
| --- | --- |
| Stations | 1×1 m footprint, floor at y 0, worktop top at 0.9. Rest heights match `scene/layout.ts`: board 0.94, stove trivet 0.93, belt 0.915, sink water 0.865 (basin floor 0.78), rack and return flush at 0.9, crate produce floor 0.7. Nothing is taller than 1.55 m, so a front-row station never hides the chef behind it. |
| Oven | Brick dome on a plinth. The stone hearth is at y 0.5 and the arched mouth faces +Z. The scene bakes a plate at (0, 0.5, +0.3) scaled 0.78, half inside the glowing mouth. A test checks that the game camera can see it. |
| Animated children | `stove_flame` (burner ring), `belt_surface` (chevrons repeating every 0.25 m, which slide along +X), `bin_lid` (hinged at the back). |
| Items and food | Base at y 0. Pot floor 0.04, rim 0.25. Pan floor 0.045, red handle along +X. Plate well 0.03, radius 0.25. Food is modelled about 30 % larger than life and stays within 0.44 m, so the scene never shrinks it. |
| Chefs | `chef` and `chef_f` are both 1.6 m tall (the scene's `CHEF_HEIGHT`). Rigid pivots: `Body` (hips) holds `Head`, `ArmL` and `ArmR`. `LegL` and `LegR` hang off the root. Character left is +X. The jacket, sleeves and hat band use the white `TeamColor` material, so a player's colour reads from the high camera. |
| Props | `prop_*` at y 0, theme lists in the manifest. The names include the ones `scene/themes.ts` asks for: plant, stool, topiary, lamp, barrel, buoy, crate_stack, pine, snowman, rock, cactus, lantern, basket, awning, column and window. |

Shared materials carry their colour in vertex colours: `Paint`, `Gloss`, `TeamColor`, `Flame` (emissive), `PortalGlow`, `CrateLabel`, `Floor` and `Wall`. Floor and wall have their own materials so a theme can tint them.

## Art direction

Chunky, toy-like, rounded low-poly. Every box is bevelled, so edges catch the light and each tile reads as a separate block from far away. The palette is warm and saturated: cream worktops with a tan bevel outline, teal cabinets with brass handles, and each station family has its own body colour (red stove, brick oven, blue sink, slate return, copper serve, green bin, wooden crates, grey belt). The game camera shows a tile at only 50–90 px, so every station has a silhouette you can pick out at a glance: burner cross and flames, dome with chimney, basin with water and a sponge, board and red knife, bin with a fish skeleton, a pass with a striped awning, heat lamp and cloche sign, belt chevrons, crates full of their produce.

Food reads by colour first and shape second. Raw foods are whole objects: a lettuce head, a tomato with a leafy top, a striped onion, a joint of beef on the bone, a bun, a dough ball, a cheese wedge. Chopped foods are piles or slices: leaves, slices with pale centres, rings, a minced pink patty, grated shreds. Cooked foods turn brown or golden (grill-marked patty, golden rings, baked base). Every burnt state uses one charred lump with embers.

## Budgets (enforced by `tests/models.test.ts`)

| Budget | Limit | Now |
| --- | --- | --- |
| GLB | ≤ 3.5 MB | ≈ 1.63 MB |
| Chef | ≤ 4000 triangles | 3558 / 3882 |
| Station, environment, prop | ≤ 1500 triangles | max 1460 (sink) |
| Food, item, dish, soup | ≤ 500 triangles | all within |
| Materials per asset | ≤ 3 | all within |
