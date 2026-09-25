# Island Settlers v2: experience spec

This spec covers what players see, hear and touch. Build to the numbers here. When the numbers and a screenshot disagree, the numbers win and the spec gets updated. [DATA-NEEDS.md](DATA-NEEDS.md) lists the data each screen reads.

The core idea is **quiet land, loud pieces**. The terrain uses muted, painterly colours and the player pieces use bright candy colours on dark bases. Think of a real board game: the map is printed cardboard, and the plastic pieces are what your eye jumps to. Every other choice in this spec follows from that.

Units and conventions:
- **World units (wu).** Hex circumradius = 1 wu, so a pointy-top hex is √3 ≈ 1.732 wu across its flats. One Blender metre = 1 wu.
- **Stage units (u).** The display stage is the `.kp-scene-stage` box: about 1560×980 px in a 1920×1080 window and 1240×620 px in a 1280×720 window. Here 1u = stage height / 980. In CSS the HUD root sets `container-type:size` and `--u: calc(100cqh / 980)`, and every HUD size is written `calc(N * var(--u))`. At 1080p, 1u ≈ 1 px; at 720p, 1u ≈ 0.63 px. Font sizes use `max(<floor>px, calc(N * var(--u)))`, with the floors given below.
- **Phone px** are CSS px. Portrait 390×844 leaves a content box of about 366×770 once the shell's room bar (about 64 px) and safe areas are taken out.

---

## 1. Art direction for the 3D board

### 1.1 Look

- A stylized low-poly tabletop diorama, flat-shaded (`flatShading:true`) with no textures except the token and plaque canvas textures.
- Materials: `MeshStandardMaterial`, roughness 0.85, metalness 0, `NoToneMapping`, sRGB output. Colours below are final sRGB values.
- Lights:
  - Hemisphere: sky `#dcecff`, ground `#2a4f6e`, intensity 1.7.
  - Key directional: `#fff1d6`, intensity 2.2, from (−12, 24, 14).
  - Fill directional: `#9fd6ff`, intensity 0.5, from (16, 10, −12).
  - No shadow maps. Every piece and prop carries a baked blob shadow (see 1.5), which is cheaper and always readable.
- Stage background: a radial gradient from `#1d6b9e` at the board centre to `#0b2d4f` at the corners. It is drawn as the ocean plane's canvas texture, so the sea "is" the background.

### 1.2 Terrain palette (extends the kp tokens and never redefines them)

Land is kept 15–30% less saturated than the seat colours.

| Terrain | Top | Side | Props (colours) |
|---|---|---|---|
| Forest (wood) | `#3f7d4e` | `#2c5a39` | pine trees `#2f6b40`, trunks `#6b4a2e` |
| Hills (brick) | `#b8633f` | `#8a4630` | brick stacks `#c9754c`, kiln `#7a3d28` |
| Pasture (wool) | `#8fbf5f` | `#6a9446` | sheep body `#fff6e5`, faces `#05071a` |
| Fields (grain) | `#d4a843` | `#a8822c` | wheat sheaves `#efc860` |
| Mountains (ore) | `#8d93a6` | `#646a7e` | peaks `#a9aec0`, snow caps `#fff6e5` |
| Desert | `#dcc590` | `#b39d68` | dunes `#e8d6a6`, cactus `#5f8f4e` |
| Gold field | `#e39a2e` | `#b3741a` | nuggets `#ffd24a` (emissive 0.15) |
| Sea hex / shelf | `#2b86b8` | — | foam ring `#dff4ff` at opacity 0.35 |
| Deep ocean plane | `#174f7c` | — | — |
| Fog (E&P) | `#2a3e5c` base | — | clouds `#d9dde8` |
| Lake | `#3b8fc9` | `#25689a` | reeds `#6b8a63` |
| Swamp | `#6b8a63` | `#41583d` | dead trees `#4a3f33` |
| Oasis | `#7fbf9e` | `#4d8f74` | palms `#3f8f55` |
| Spice island | `#c9694f` | `#9a4b37` | spice sacks `#e0a060` |
| Castle / quarry / glassworks | `#b3a489` / `#a99d95` / `#b7d8e8` | 30% darker | see 1.6 |
| Beach rim | `#e8d6a6` | — | — |

UI resource colours (cards, chips, icons) stay brighter than the terrain: wood `#2f9a5f`, brick `#d8683f`, wool `#a3dc6f`, grain `#f0c24d`, ore `#9aa1b8`, paper `#efe3bf`, cloth `#cf95dc`, coin `#ffd24a`.

### 1.3 Hex tiles (built in code, not in Blender)

- **Land tile.** A pointy-top hexagonal prism.
  - Base radius 0.985, which leaves a 0.03 wu seam between neighbours.
  - The top face is at **y = 0.30** (`LAND_TOP`), with a 0.05 wu chamfer bevel around its edge.
  - The side uses the Side colour and the top uses the Top colour.
  - Build it with `ExtrudeGeometry` (`depth 0.30, bevelSize 0.05, bevelThickness 0.04, bevelSegments 1`), or a hand-built 24-triangle prism with an inset top. It is one shared geometry for all land tiles, with one material per terrain.
- **Coast.** Every land edge whose neighbour is sea gets a beach strip: a flat quad 0.10 wu wide at y = 0.301 along the outer rim, in the beach colour. This one detail makes islands read as islands.
- **Sea tiles.** A flat hex at y = 0.02 in the shelf colour, radius 0.99. The deep ocean plane sits at y = 0. Sea hexes that touch land get a foam ring: a hex outline 0.06 wide at y = 0.03 that drifts ±0.02 wu on a 4 s sine. The drift stops under reduced motion.
- **Fog tiles.** A dark base hex at y = 0.02 with 3 `fog_cloud` instances at y 0.35–0.55, placed from a hash of the tile id. On reveal, the clouds scale ×1.4 and fade out over 500 ms while the new land tile rises from y −0.30 to 0 over 600 ms (easeOutBack).
- **Props.** 3–7 instances per land tile, placed by `hashUnit(tileId+i)` in the ring between r = 0.36 and r = 0.74 from the centre. They never go inside the token disc or near the corners. Keep them under 0.22 wu tall and batch them in one `InstancedMesh` per prop type.

### 1.4 Number tokens (explicit user requirement)

A token is a flat disc lying on the hex at its centre. It is a real mesh that is depth-tested, like cardboard on the table, not a sticker on the screen.

| Property | Value |
|---|---|
| Radius | **0.29 wu**. Diameter 0.58 = 33.5% of the 1.732 flat width, inside the 0.28–0.30 band. |
| Thickness | 0.035 wu: a `CylinderGeometry(0.29, 0.29, 0.035, 32)` whose bottom sits on `LAND_TOP` (centre y = 0.3175) |
| Side colour | `#d9ccb0` |
| Top face | a canvas texture at 256×256 px (1 wu = 441 px) on a `CircleGeometry(0.29, 32)` at y = 0.336 with `polygonOffset` −1 |
| Face | cream `#fff6e5` fill, ink `#05071a` rim ring 0.016 wu wide at the edge |
| Numeral | Lilita One. Digit height 0.22 wu, centred 0.035 wu north of the disc centre. Two-digit numbers are scaled horizontally so they are at most 0.40 wu wide. Wait for `document.fonts.load('96px "Lilita One"')` before drawing the canvases. |
| Colour | ink `#05071a`. **6 and 8 use red `#c62a22`** for both the numeral and the pips (contrast 5.6:1 on cream). |
| Pips | one row centred 0.13 wu south of the centre. Pip radius 0.022 wu, pitch 0.058 wu. The counts are 2/12:1, 3/11:2, 4/10:3, 5/9:4, 6/8:5. |
| Orientation | Upright for the camera: the texture's up axis points north (−z). |
| Draw order | depthTest and depthWrite on, `renderOrder 1`. Tile 0, token 1, roads 2, buildings 3, robber/merchant 4, highlights 5. |
| Clearance | Corner piece footprints start 0.78 wu from the hex centre and the robber occupies 0.33–0.67 wu, so nothing ever overlaps a token in plan. With the camera looking north and down, anything north of a token is drawn above it on screen, never on top of it. |
| Robbed | The token face is multiplied to `#9a9486` and the hex top blends 55% toward grey `#7d7f86` over 300 ms. |
| Production flash | The token rises 0.05 wu and its rim turns sun `#ffd24a` for 500 ms (section 5). |

The phone SVG map uses the same proportions: token r = 0.29 in hex units.

Harbour plaques follow the same rules. A plaque is a flat rounded rectangle, 0.72×0.40 wu and 0.03 thick, lying on the water 0.55 wu out from the port edge's midpoint, turned to face the camera. It has a cream face, a 0.10 wu band on the left in the resource colour (or ink for 3:1), and the ratio "2:1"/"3:1" in Lilita One at a digit height of 0.18 wu. Two ink dock planks, 0.07 wu wide, run from the plaque to the port's two corner vertices at y = 0.035.

### 1.5 Pieces

Every player piece follows the same rules:
- **Seat colour covers the body**, including walls, roofs and hulls. The `seat_dark` slot (the seat colour at −22% lightness) is used only for roof planes and shading faces.
- An **ink outline**: a baked inverted hull 0.014 wu thick (see 1.8).
- An **ink plinth** under every building: a flat base 0.025 wu tall that separates the piece from any terrain.
- A **blob shadow**: a radial-gradient quad at y = 0.302, opacity 0.35, radius = footprint × 1.25.

Pieces are sized for about 80 px/wu (the base board at 1080p). Section 2 adds a scale factor for big boards.

| Piece | Node name | Footprint (w × d) | Height | Silhouette and notes |
|---|---|---|---|---|
| Settlement | `settlement` | 0.34 × 0.30 | 0.38 | A house with a gable roof and a seat-coloured body. The roof ridge runs east–west so the gable faces the camera. Plinth radius 0.22. |
| City | `city` | 0.52 × 0.36 | 0.60 | An L shape: a hall 0.46 × 0.32 × 0.26 with a gable, plus a tower 0.20 × 0.20 up to 0.60 with a pyramid roof. Plinth: a rounded rectangle 0.58 × 0.42. |
| Road | `road` | 0.54 long × 0.12 wide | 0.10 | A rounded bar with an ink outline and a seat-coloured top, centred on the edge midpoint along the edge (+X = edge direction). |
| Ship | `ship` | 0.52 × 0.18 | 0.46 | A seat-coloured hull 0.10 tall, a mast of 0.34, and a cream sail with a seat stripe and the seat emblem decal. It sits on the edge midpoint over the sea, at y = 0.02. |
| Robber | `robber` | radius 0.17 | 0.60 | A hooded figure in slate plum `#463a5c` with a **cream** outline (the only piece with a light outline) and emissive sun eyes. It sits 0.50 wu from the hex centre toward the upper-left edge midpoint (120°). |
| Pirate | `pirate` | 0.60 × 0.22 | 0.62 | A `#2a2433` hull and black sail with a cream skull decal and a cream outline. It sits 0.35 wu toward 120° on its sea hex. |
| Knight L1/L2/L3 | `knight_1` `knight_2` `knight_3` | radius 0.15 | 0.28 / 0.34 / 0.40 | A pawn with a shield and a seat body. It carries **1/2/3 cream bands** on its base, and L3 wears a crown. The child node `active` (a raised sun banner) is visible only while active. Active knights also get an emissive sun halo disc, radius 0.20, at y = 0.303. Inactive knights use `seat_dark` for the body and show no halo. |
| City wall | `wall` | ring, outer radius 0.38 | 0.09 | A crenellated stone `#c9c2b3` ring with a seat-coloured top band. It is placed under the city. |
| Metropolis | `metropolis_science` `_trade` `_politics` | 0.56 × 0.40 | 0.78 | The city body plus a keep topped by a track dome or spire: science `#78d955` aqueduct dome, trade `#ffd24a` market dome, politics `#28c6e7` fortress spire. It replaces `city`. |
| Merchant | `merchant` | radius 0.14 | 0.40 | A gold `#e8b23a` figure with a seat-coloured hat and sash. It sits 0.50 wu toward 300°, opposite the robber. |
| Wagon (T&B) | `wagon` | 0.36 × 0.20 | 0.26 | A cart with a seat-coloured bed and ink wheels. Its level is shown by 1–3 cream pennants (`level_1..3` child nodes). The cargo crate child `cargo` is tinted tools `#8d93a6`, sand `#e3c98f`, marble `#f3f0ea` or glass `#b7d8e8`. |
| Harbor settlement (E&P) | `harbor` | 0.40 × 0.34 | 0.46 | The settlement body, a pier plank of 0.22 toward the sea, and a lantern mast with a sun emissive top. |
| Settler (cargo) | `settler` | radius 0.05 | 0.14 | A cream figure with a seat-coloured hat. It rides in a ship slot. |
| Crew (cargo) | `crew` | radius 0.05 | 0.14 | An ink figure with a seat-coloured bandana. |
| Fish / spice cargo | `crate_fish` `sack_spice` | 0.10 cube | 0.10 | A blue crate with a fish decal, or a rust sack. |
| Fishing ground | `fishing_sign` | disc radius 0.20 | 0.03 | A flat driftwood disc lying on the water 0.45 wu out from the coastal edge midpoint. It shows a fish glyph and its numbers at 0.12 wu digits. It lies flat, so it never blocks anything. |
| River | code | 0.12 wide ribbon | recessed to 0.28 | A water ribbon `#4fa6d9` with a `#bfe4f7` centre line along interior edges. Its texture offset scrolls 0.05 wu/s and stops under reduced motion. |
| Bridge | `bridge` | 0.40 × 0.16 | 0.12 | A stone arch with a seat-coloured deck. It is a road on a river edge. |
| Castle (BA) | `castle` | 1.00 × 0.90 | 0.95 | A stone keep with four towers and a sun flag, sitting on the castle hex centre (that hex has no token). |
| Barbarian invader (BA/T&B) | `invader` | radius 0.07 | 0.22 | A rust `#8c3b2a` figure with a horned helmet. Up to 3 stand on a 0.45 wu ring around the hex centre. Beyond 3, the HUD shows a "×n" badge instead. |
| Barbarian ship (C&K) | `barbarian_ship` | 0.80 × 0.26 | 0.60 | A dark red longship `#5a1f22` with a striped sail and a cream outline. It sits at one of 8 fixed sea waypoints (track positions 0–7) along the south-west coast and sails between them. |
| Depots (T&B) | `depot_castle` `depot_quarry` `depot_glassworks` | 0.70 | 0.50 | Neutral landmarks on their tiles. |
| Dice | `die` | 0.36 cube | — | Rounded, cream, with ink pip geometry. Used on the TV only for the finale; the in-play dice are DOM (section 3.6). |
| Terrain props | `prop_pine` `prop_round_tree` `prop_sheep` `prop_wheat` `prop_rock` `prop_peak` `prop_bricks` `prop_kiln` `prop_dune` `prop_cactus` `prop_nugget` `prop_palm` `prop_reeds` `prop_spice` `fog_cloud` | ≤0.30 | ≤0.22 (`prop_peak` ≤0.30) | Static and instanced. |

### 1.6 Seat colours and emblems

The room assigns platform colours (`room-server.ts:18`). Several are close to each other (coral/orange/pink, sky/teal/periwinkle, lime/pale lime). The game maps each seat to its own piece colour. The mapping keeps the colour family so players still recognise "their" colour from the lobby, and it adds an emblem as a non-colour cue. The engine gives every player a unique `seat` index from 0 to 9 (see DATA-NEEDS), and all UI reads `SEATS[seat]`.

| Seat | Platform colour | Piece colour | `seat_dark` | Light band | Emblem |
|---|---|---|---|---|---|
| 0 | `#ff5748` coral | Red `#d8352e` | `#a3231e` | dark | Triangle ▲ |
| 1 | `#28c6e7` sky | Blue `#2563d9` | `#1a47a0` | dark | Circle ● |
| 2 | `#78d955` lime | Green `#3fae47` | `#2c7f33` | mid | Square ■ |
| 3 | `#b58aff` grape | Purple `#8a4fe0` | `#6334aa` | dark | Diamond ◆ |
| 4 | `#ffd24a` sun | Yellow `#ffd23a` | `#c9a01c` | light | Star ★ |
| 5 | `#ff90ba` pink | Pink `#ff7ac2` | `#d04f93` | light | Heart ♥ |
| 6 | `#56decd` teal | Teal `#1fc0ad` | `#12887a` | mid | Wave ≈ |
| 7 | `#ffa260` orange | Orange `#ff8a1f` | `#c96410` | mid | Bolt ⚡ |
| 8 | `#97aeff` periwinkle | Frost `#e6ecff` | `#aab6d9` | light | Crescent ☾ |
| 9 | `#e2ef93` pale lime | Chartreuse `#c6dc2c` | `#93a61a` | light | Cross ✚ |

Colour-blind handling:
- **Luminance bands.** Neighbouring hues fall in different lightness bands (dark / mid / light), so red, orange and pink, and likewise blue, teal and frost, still separate under protanopia and deuteranopia.
- **Emblems everywhere a seat is named.** Emblems are ink glyphs inside a seat-coloured chip:
  - seat rail rows, VP pawns, offer chips, production chips, the phone header, ticker names, and the results screen;
  - in 3D, as a decal on settlement and city roofs (0.12 wu, ink at 70%) and on ship sails (0.14 wu);
  - on the phone map, inside the building icons.
- **Emblem glyphs.** 24×24 SVG paths in `ui/shared/emblems.ts` (with the palette in `ui/shared/seats.ts`). The scene draws them onto a 512×256 atlas canvas at load.
- **QA check.** Screenshot the 10-seat board through a deuteranopia and a protanopia filter (for example Chrome DevTools "Emulate vision deficiencies"), and confirm every piece's owner can be named using colour plus emblem.

Text on a filled seat colour: ink `#05071a` on every seat (the lowest contrast is 4.0:1 on Purple, which passes the 3:1 large-text rule because the names are ≥20u bold).

### 1.7 Board-size scale

- The camera fit (section 2) gives `pxPerWu`. Every piece, ghost, halo and blob shadow is scaled by `pieceScale = clamp(80 / pxPerWu, 1, 1.2)`.
- **Tokens never scale** (the user requirement). At 1.2 a settlement is 0.41 wide, which still clears the corners 1 wu apart and the token.
- **The robber, pirate and merchant never scale either.** A 1.2× city (clearance 0.43) next to a 1.2× robber would touch it; unscaled, the robber keeps 0.02 wu of clearance. Clearance radii live in `geometry.ts` `FOOTPRINT` and `ROBBER_OFFSET`.

### 1.8 Blender asset pipeline

- **Sources.** Python scripts in `packages/games/island-settlers/art/`:
  - `common.py`: palette, materials, `outline(obj)`, `blob()`, `export(nodes, path)`
  - `pieces.py`, `expansions.py`, `props.py`
  - `build.sh`, which runs `/opt/homebrew/bin/blender -b --factory-startup -P art/<file>.py -- <out>` for each bundle.
- **Output.** `public/games/island-settlers/models/`:

| Bundle | Nodes | Budget (tris) | File budget |
|---|---|---|---|
| `pieces.glb` | settlement 300, city 520, road 60, ship 620, robber 800, pirate 900, harbor 520, die 300 | total ≤ 4.5k | ≤ 120 KB |
| `props.glb` | pine 60, round_tree 80, sheep 120, wheat 60, rock 40, peak 150, bricks 60, kiln 120, dune 40, cactus 80, nugget 40, palm 120, reeds 60, spice 80, fog_cloud 200 | ≤ 1.5k | ≤ 60 KB |
| `expansions.glb` | knight_1/2/3 380 each, wall 300, metropolis_* 800 each, merchant 500, wagon 600, settler 120, crew 120, crate_fish 60, sack_spice 60, fishing_sign 60, bridge 200, castle 1500, invader 200, barbarian_ship 900, depot_* 600 each | ≤ 12k | ≤ 250 KB |

- **Loading.** `expansions.glb` is fetched only when the settings enable C&K, T&B scenarios or E&P. All bundles load inside SceneView before `onReady` (they are local, so this is well inside the 20 s preparation limit). If a load fails, SceneView calls `onError(new Error('Island Settlers models failed to load. Return to the lobby and try again.'))`.
- **Conventions.**
  - Units are wu. The origin is at the **bottom centre of the footprint** (y = 0 is the ground contact), +Y is up, and +X is the long axis for road, ship, wagon, bridge and barbarian ship.
  - Figures face +Z, toward the camera.
  - Apply all transforms. Flat shading (no smooth normals). No UVs except decal quads.
  - Export with `export_format='GLB', export_yup=True, export_apply=True, export_texcoords` only where decals exist, and no Draco.
- **Material slot names** (exact; the runtime swaps them):
  - `seat`: base colour replaced per seat.
  - `seat_dark`: replaced by the seat's dark shade.
  - `ink` `#05071a`, `cream` `#fff6e5`, `stone` `#c9c2b3`, `wood` `#8a5a36`, `metal` `#8d93a6`, `sail` `#fff6e5`.
  - `glow`: emissive sun; its visibility is toggled.
  - `outline`: ink, or cream for the robber, pirate and barbarian ship.
  - `decal`: an emblem-atlas quad whose UVs are set at runtime.
- **Outlines.** Every piece node has a child `<name>_outline`: a copy of the mesh with a Solidify modifier (thickness −0.014, flip normals, rim off) and material `outline`. At runtime it is set to `side: BackSide`. Props get no outline.
- **Runtime recolouring.** The runtime creates 10 `seat` and 10 `seat_dark` materials once and shares them. Pieces are individual `Object3D`s sharing geometry. Props are instanced. Budget at the 10-seat late game: ≤ 700 draw calls, ≤ 250k triangles, 60 fps on balanced quality on an M1 laptop, and ≥ 30 fps on low.

---

## 2. Camera and focus

- **Camera.** Orthographic, looking north, **tilted 32° from straight down**, with azimuth fixed at 0. There is no pan, zoom, orbit or follow.
- **Fit.**
  - The camera fits the land bounding box, plus a 0.9 wu margin for plaques and fishing signs, plus the piece height allowance (0.6 × sin 32° wu at the north edge), into the **board window** of the current role (section 3.1 / 4.13).
  - The board window comes from layout constants, not from measuring the DOM. So the board can never jump when a panel appears, because panels only ever draw inside regions that were reserved from the start. That fixes live critique D5.
  - Recompute only on resize, and on the first view of a round. The land box already includes fog hexes, so fog reveals never refit the camera.
- **Shared bridge.** `ui/shared/bridge.ts` is a tiny module-level store (in shared so the HUD and host view never import the scene bundle). The scene publishes:
  - `tileScreen(id)`, `vertexScreen(id)` → stage px, updated on resize;
  - `pxPerWu`.
  
  The HUD reads it for fly-out origins. The host PersonalView publishes `pickSpot(id)` back to the scene.
- **Active-player spotlight.** At turn start, every building of the active seat gets a cream halo ring (inner 0.24, outer 0.34 wu, at y = 0.303) that pulses between opacity 0.25 and 0.55 on a 1.6 s sine. Under reduced motion it holds a static 0.45. In Connect rounds no spotlight is shown; the seat rail carries turn state.
- **Legal-target glow on the TV.**
  - **Robber (and pirate) placement.** Every legal hex gets a sun `#ffd24a` rim along its border, 0.05 wu wide at y = 0.305, breathing between opacity 0.5 and 1 over 1.2 s. The current robber hex gets a coral rim. Seats that could be robbed get a small emblem pin over their adjacent buildings.
  - **Setup and "intent" placement** (when the active phone reports the piece kind it is choosing; see DATA-NEEDS `intent`). Legal corners get cream dots (radius 0.08) and legal edges get cream dashes (0.20 × 0.05), both breathing. This fixes live critique D7, where watchers saw a frozen board.
  - **Knight, wagon and ship moves.** Legal destinations use the same dots or dashes.
- **Placement feedback.** A new piece drops from y + 0.8 over 420 ms (easeOutBack 1.4) and fires a seat-coloured ring burst from radius 0.2 to 0.6 wu over 480 ms. Roads and ships grow along +X from scale 0 to 1 over 320 ms.
- **Reduced motion** (`matchMedia('(prefers-reduced-motion: reduce)')`, checked live):
  - No drops, hops or bursts; pieces appear with a 120 ms opacity fade.
  - Pulses become static opacities.
  - Foam, river and cloud drift stop.
  - Dice show their final faces at once.
  - Fly-outs are replaced by the seat-row "+n" chips alone.

---

## 3. TV display (DisplayView over SceneView)

### 3.1 Regions (seatless display)

All values are in u, measured from the stage edges. The regions are fixed for the whole round.

```
+--------------------------------------------------------------+-----------+
| DICE 248x88 |           TURN BANNER (flex) 88                 |  SEAT     |
+-------------+-------------------------------------------------+  RAIL     |
| LEFT RAIL   |                                                 |  360 wide |
| 300 wide    |               BOARD WINDOW                      |           |
| A expansion |          (land fitted inside)                   |  race     |
| B trade     |                                                 |  track    |
| C ticker    |                                                 |  + rows   |
+-------------+-------------------------------------------------+           |
|  PRODUCTION SUMMARY STRIP  64 high                            |           |
+---------------------------------------------------------------+-----------+
```

| Region | Left | Top | Width | Height |
|---|---|---|---|---|
| Gutter | 16 on every edge and between regions | | | |
| Dice chip | 16 | 16 | 248 | 88 |
| Turn banner | 280 | 16 | stage − 280 − 392 | 88 |
| Seat rail | stage − 376 | 16 | 360 (min 250px) | stage − 32 |
| Left rail | 16 | 120 | 300 (min 200px) | stage − 120 − 96 |
| Production strip | 16 | stage − 80 | stage − 16 − 392 | 64 |
| **Board window** | 332 | 120 | stage − 332 − 392 | stage − 120 − 96 |

The resulting board scale, the same at both window sizes because the layout scales with u:

| Board | Stage 1560×980 (1080p window) | Stage 1240×620 (720p window) |
|---|---|---|
| Base 3–4 (19 hexes) | about 80 px/wu. Settlement 27 px, token 46 px, digit 18 px. | about 56 px/wu |
| 5–6 (30 hexes) | about 68 px/wu | about 46 px/wu |
| 7–10 (37 hexes) | about 60 px/wu, pieceScale 1.2 | about 40 px/wu |

The 3 m legibility target applies to 1920×1080. 1280×720 is a laptop-distance target. HUD panels are kp-navy `#0b1030` at 90% opacity, with a 2u cream-at-14% border and an 18u radius. The sea shows through wherever a region is empty. No panel is drawn when there is no content.

**Font floors.** Anything a player needs is ≥ 20u (20 px at 1080p, 13 px floor at 720p). Secondary labels are ≥ 18u (12 px floor). Numbers use `kp-numeral`.

### 3.2 Seat rail

The rail is a stack of three parts:
1. The race track header (96u).
2. One row per seat.
3. At ≤ 6 seats only, a "Table" card (120u) showing dev cards left, bank piles at 3 or fewer (for example "Bank low: ore 2"), and the award holders.

Row height = `min(168, (railHeight − 96 − 8 − table) / seats)`. That gives 84u at 10 seats, 119u at 6 and 168u at 3 on a 980u stage.

**Row anatomy:**
- **Chip** (56u circle): a seat-colour fill, a 3u ink border and a 28u ink emblem.
  - **Timer ring:** a 5u arc at radius 33u that drains clockwise from the seat's deadline. It is cream, turns sun under 25% remaining, and turns coral in the last 10 s. It is drawn from `serverNowMs()` each frame and is hidden when the seat has no deadline.
  - **Status badge** at bottom-right (22u): three animated dots while a CPU is "thinking", a coral plug-slash when offline, a lime check when "done" (Connect).
- **Line 1:** the name at 24u (22u when there are more than 6 seats), Nunito 800, cream. Names are never truncated: at a 360u rail a 16-character name fits at 22u, and at the 250px floor the font steps down to 18u. After the name come a "CPU" pill (16u, ghost) and a level letter (E/N/S).
- **Line 2** (stats, 20u, icons 22u):
  - resource cards `▢ 7` (coral background when above the discard limit);
  - dev cards `✦ 2`;
  - knights played `⚔ 3`;
  - award ribbons: Longest Road (sky ribbon showing its length) and Largest Army (grape shield);
  - module badges (fish, coins, improvements as three 5-segment bars 6u × 10u in the track colours, missions and cargo).
  - Where space runs out, module badges move to line 3 (≤ 6 seats) or collapse into a "+2" pill whose `title` and `aria-label` list them.
- **Line 3** (≤ 6 seats only, 18u):
  - the status text: "Rolling…", "Discarding 4", "Choosing a hex", "Offline: auto-plays in 0:42", "Thinking…", "Build turn", "Done";
  - otherwise, the pieces left: "Roads 11, Settlements 3, Cities 2".
- **VP** on the right: Lilita One, 48u (40u when there are more than 6 seats), with the public VP only.
- **Active seat:** the row is filled with the seat colour, its text turns ink, and it slides 14u toward the board (200 ms ease-out). The previous active row slides back. In paired turns the paired seat gets a 4u seat-colour outline and the tag "Build turn". "Next up" gets a 16u chevron on its chip.
- **Production "+n" chips:** they appear at the right of line 2 when fly-outs land (section 3.7).

**Race track header:**
- The label reads "Race to 10" (20u).
- A horizontal track, 328u wide, runs from 0 to the target, with ticks every point and bold ticks every 5.
- Pawns are 26u emblem chips at the public VP. Up to 3 tied pawns stack vertically; beyond that a "+n" pill shows.
- When a seat is one point from winning publicly, its pawn pulses and a sun label "1 to win" appears above it.
- During setup the header becomes the **snake order strip**: chips in the order 1…n, n…1, with a sun caret on the current placement.

### 3.3 Turn banner

The banner answers "whose turn is it and what is happening" at a glance. Title and subline come from the server's `now.title` / `now.detail`; the client only adds countdowns.

- **Layout:** the active seat chip (56u) at the left. Title in Lilita One at 44u (36u if it would wrap). A subline in Nunito 800 at 22u. On the right, the timer as a 32u numeral "0:42" (only while a deadline applies).
- **Transition:** the old text fades out and moves up 12u over 140 ms, then the new text fades in over 220 ms.
- `aria-live="polite"` on the title.

| State | Title | Subline |
|---|---|---|
| Setup | "Ana places a settlement" / "…a road" | "Setup round 1 of 2" / "Round 2: this settlement pays out" |
| Roll | "Ana rolls" | "Auto-rolls in 0:08" (only with timers on) |
| Main turn | "Ana is building and trading" | "Offers go to everyone" / "2 offers open" |
| Paired turn (5+ seats) | "Bo's build turn" | "Build and trade with the bank only" (7–10: shown alongside Player 1's turn, both rows highlighted) |
| 7 and discards | "Rolled 7!" | "Discarding: Ana (4), Bo (5)" (shrinks as people finish) |
| Robber | "Ana moves the robber" | "Pick a hex and a player to rob" |
| Gold / plenty / prompts | "Ana chooses gold" | "Waiting on: Ana, Cy" |
| Blocked by disconnect | "Waiting for Bo to reconnect" | "Bo's move is auto-played in 0:40" |
| Connect round | "Round 4: everyone plays" | "0:42 left · 3 of 6 done" |
| Barbarian attack | "Barbarians attack!" | "Knights 5 vs cities 6" |
| Finale | "Ana wins!" | "Revealing hidden points" |

### 3.4 Left rail

The left rail holds three slots stacked top to bottom:
- **A. Expansion HUD** (only when a module is active, up to 220u).
- **B. Trade rail** (flex).
- **C. Ticker** (fixed 116u at the bottom).

An empty slot is not drawn.

**B. Trade rail (offer card, 300u wide):**
- **Header:** the proposer chip (32u), their name (20u), and the audience (18u): "to everyone" or "to Bo, Cy".
- **Body:** give icons (32u) with "×2" (22u), a 28u arrow, then the get icons.
- **Footer:** one 30u response chip per eligible seat.

| Chip state | Look |
|---|---|
| Pending | dashed cream outline |
| Accepts | lime ring and a check |
| Declined | 40% opacity and a strike |
| Countered | grape ring and ⇄ |
| Can't afford | hidden, since it is auto-declined |

- A CPU decline reason shows as a one-line 18u note under the chips, for example "CPU 2: not while you're at 8 VP."
- **Counter-offers** nest under their parent, indented 16u, with a grape "counter" tag.
- **Expiry:** a 3u progress bar along the card bottom.
- **Overflow:** up to 3 cards are shown in full. Any more collapse to one-line rows (22u), for example "Bo: 1 ore for 2 wool (2 accept)". Nothing auto-pages.
- **Completed trade:** the card flashes lime and says "Traded with Bo" for 1.2 s, then collapses (240 ms).
- **Bank trades:** they appear in the ticker only.

**C. Ticker:**
- The three newest public events at 20u, newest on top. Older lines fade to 60% and then 35%.
- Names are shown as emblem chips (18u) followed by the name.
- The full log lives on the phone.

**A. Expansion HUD.** It is rendered generically from `hud` descriptors in the public view (see DATA-NEEDS), with a small set of typed widgets:
- **C&K barbarian track:** 8 cells (0–7) at 32u each, with a longship icon in the current cell. Below it, "Knights 5 vs cities 6" with shield and city icons. At cell ≥ 6 the text turns coral: "Attack on the next ship roll".
- **Metropolis holders:** one track-coloured crown per track, with the holder's emblem.
- **E&P missions:** one row per mission (Pirate lairs, Fish for the council, Spices). Each row shows a 5-cell progress bar per seat as emblem-pip columns, and the leader's emblem.
- **Barbarian Attack:** "Invaders 7 on 4 hexes", plus the castle garrison.
- **Caravans:** the camel count and the current bids (as pending chips).
- **Deliveries:** the open demands per depot, shown as icons.
- **Harbormaster and wealthiest/poorest:** shown as award-style ribbons.

### 3.5 Board overlays drawn by the scene

These are summarised here and covered in sections 1 and 2:
- robber and pirate rims;
- setup and intent dots;
- the spotlight;
- the production token flash;
- the barbarian-ship waypoint path (a dotted line drawn on the water at opacity 0.25).

### 3.6 Dice theatre

The dice are DOM elements inside the dice chip. They are crisp and can be read from the couch. In C&K the chip holds three dice at 52u (yellow, red and the event die with its gate or ship face); otherwise two dice at 60u. The total uses Lilita One at 56u.

| t (ms) | What happens |
|---|---|
| 0 | A new `roll` event arrives. The dice tumble: faces shuffle every 60 ms, with rotation keyframes ±25° and scale 1.0 to 1.12. The roll sound starts. |
| 450 | The dice land on their true faces with a 120 ms squash (scale Y 0.88 to 1). |
| 450–710 | The total pops from scale 0.6 to 1.08 to 1 (easeOutBack). 6 and 8 are red; a 7 is coral with the ⚠ robber glyph. |
| 450–950 | The producing tokens flash on the board (section 1.4). The robbed hex flashes grey with a robber icon ping. |
| 600–1440 | Resource fly-outs (3.7). |
| 1440 | Everything settles. The production strip is filled in (it appears at 600 ms and stays until the next roll). |

The active phone is never blocked by this sequence. The engine accepts actions at once; the theatre is presentation only. **Backlog rule:** DisplayView runs one animation queue ordered by event id. If the queued work exceeds 2.5 s, it skips straight to the end state of the older items. After a reload it plays only events whose `atMs` is within 3 s of `serverNowMs()`, so it never replays history.

### 3.7 Resource fly-outs (batched per player)

- **One flight per (player, resource).** It starts at the screen centre of the highest-pip producing hex for that pair (from `bridge.tileScreen`) and ends at that seat's row chip.
- **Card:** a 36u resource card icon with a "+2" count badge (20u).
- **Path:** a quadratic arc with its control point 80u above the midpoint, duration 480 ms, `cubic-bezier(.2,.8,.2,1)`.
- **Stagger:** 40 ms, in seat order.
- **Cap:** at most 14 concurrent flights. Past that, each player's flights merge into a single multi-icon flight, so the worst case is 10 flights.
- **Arrival:**
  - the seat chip bumps (scale 1.12, 160 ms);
  - a "+2 grain" chip (20u, resource colour) appears in the row for 1600 ms, then fades over 240 ms;
  - the coin sound plays (rate-limited to 6 per 200 ms).
- **Gold and plenty picks:** they fly from the bank icon in the seat rail header, not from hexes.
- **Steals:** a face-down card (navy with a sun emblem, 40u) flies from the victim's row to the thief's row over 600 ms. The TV never shows the resource type.

### 3.8 Production summary strip (persistent)

- **Layout:** a 48u number disc for the roll on the left (red for 6/8, coral for 7). Then one chip per producing player: emblem (28u), a fanned stack of resource icons (22u, overlapping by 10u), and a total "+3" (22u).
- **Blocked chip:** a robber icon plus the emblem and the resource it blocked, for example "[robber] Cy ore".
- **Nobody produced:** the text "Nobody produced".
- **Shortage:** "Bank short: no ore paid".
- **A 7:** the strip reads "7: discarding Ana 4, Bo 5", and then "Robber moved to Hills 8 · Bo robbed".
- Width worst case: 10 chips × 110u = 1100u, which fits the 1152u strip at 1080p. There is no wrapping.
- The strip stays until the next roll event.

### 3.9 Setup phase

- The snake strip is in the rail header (3.2), with legal corner dots on the board (2).
- The banner shows the current step.
- A settlement drops in, and in round 2 its starting resources fly out from the adjacent hexes.
- In Connect setup, the order and the setup step timer are the same as Standard.

### 3.10 End-game reveal (in the `finale` phase, before results)

SceneView unmounts at results, so the reveal must play while the engine holds a `finale` phase. It lasts at most 9 s, after which the outcome completes (see DATA-NEEDS).

| t (s) | Beat |
|---|---|
| 0 | Victory sound. Banner "Ana wins!". The winner's buildings flash their halos at full opacity. Seat rail crown on the winner. |
| 0.8 | Hidden VP reveal, one seat at a time in seat order, 0.5 s each (0.3 s at more than 6 seats). A card flips over the VP numeral, and the VP counts up by the number revealed. |
| ≤ 6.3 | The rail re-sorts into final rank (a FLIP animation, 500 ms), and rank numerals (#1…#10, 28u) appear on the chips. |
| 9 | The outcome completes and the shell shows ResultsView. |

Under reduced motion the final state shows at t = 0.8 s, and the rest of the hold still runs so everyone can read it.

### 3.11 Results (ResultsView, DOM, no scene)

- **Layout:** two columns at ≥ 1100px width, stacked below that.
- **Hero:**
  - the winner's emblem chip (96px);
  - their name in `kp-title` at 64px, set in the seat colour with an ink stroke;
  - "10 VP · 58 min · 23 rounds" at 22px;
  - shared winners appear side by side.
- **Left column, standings table** (rows 40px at 1080p, 32px at 720p):
  - columns: rank, chip+name, Settlements, Cities, Longest Road, Largest Army, VP cards, Expansion (one column per active module source: metropolis, defender, harbour, missions, and so on), Total;
  - zero values are shown as "–";
  - the winner's row is tinted in their seat colour;
  - "· you" marks the viewer's row on phones;
  - 10 rows plus the header fit in 480px.
- **Right column, stats:**
  - **Dice histogram:** bars for 2–12 showing the actual counts, with a dotted line for the expected count (n × probability). 7 is coral, 6/8 red. The axis labels are 16px.
  - **Resources gained:** one horizontal stacked bar per player, segmented by resource colour, with the total at the end.
  - **Robber:** times each player was robbed, and cards stolen from and by them (a small table).
  - **Trades:** player trades completed and bank trades per player.
  - **Awards:** the longest road ever reached and the most knights played.
- **Phones:** ResultsView shows your rank, your breakdown and the same stats, scrolling in one column.
- **Buttons:** the shell adds "Play again" and "Choose another game" below the panel. The game must not add its own.

### 3.12 Roster density checks

- **3 seats:** rows 168u with 3 lines and the Table card.
- **6 seats:** rows 119u.
- **10 seats with 16-character names:** rows 84u, 2 lines, with module badges collapsing into "+n".

Each must be verified at both 1920×1080 and 1280×720 with no clipping.

---

## 4. Phone controller

### 4.1 Frame (portrait 390×844)

The content box is 366 wide. From top to bottom:

| # | Part | Height | Behaviour |
|---|---|---|---|
| 1 | **Status header** | 64 | Sticky. Your emblem chip (40), a 20px Lilita title ("Your turn", "Discard now", "Bo's turn", "Round 4"), a 16px subline stating the next job ("Roll the dice", "Build, trade or end", "Waiting for Bo"), and a 44px timer ring with seconds on the right when a deadline applies to you. The VP ("7 VP, 1 hidden") is on the right when there is no timer. `aria-live="polite"`. |
| 2 | **Duty cards** | auto | Incoming offers, "Bo robbed your ore", "You got +2 grain from 8". Newest first, at most 2 visible, with "+n more" below. Notices auto-clear after 3.5 s or when the task changes. Errors stay until your next action or the turn changes (fixes live critique P3). |
| 3 | **Hand strip** | 104 | 5 resource cards, 64×88 with 8px gaps (see 4.6). C&K adds a second row of 3 commodity cards (64×64). |
| 4 | **Task area** | flex, scrolls | The screen for the current state (4.2). |
| 5 | **Action bar** | 72 + safe area | Sticky. [Build] [Trade] [Cards] as 80×56 ArcadeButtons (sky/ghost), a 14px gap, then **End turn** (100×56, coral outline ghost, never filled coral). It shows only during your main or build turn. |

- **End turn.** Tapping End ends the turn immediately; there is no confirm sheet (user decision, 2026-09-25).
- **Selection.** The tab you pick in the bar is shown as pressed (`aria-pressed`). It swaps the task area and never changes route.
- **Badges.** The Build tab shows a lime dot when something is affordable and placeable. The Trade tab shows a count of offers waiting on you.

**Other sizes:**
- **320×568** (content 296): the hand cards are 52×72, the bar buttons 64×56 with 16px labels, the header title 18px, and the map 296×220.
- **667×375 and 844×390 (landscape):**
  - Two columns: the map on the left (50%, full height minus the header) and the header, hand, task and bar on the right, with the right column scrolling and the bar sticky.
  - Hand cards are 56×76.
  - The status header stays one line (44 high).

### 4.2 Screens by state

The screen is picked by `me.task` from the server (see DATA-NEEDS). Private duties come first.

| State | Task area contents |
|---|---|
| **Lobby** (InstructionsView, controller role) | Three lines: "1. Roll: every hex with that number pays the buildings on its corners. 2. Build and trade with the cards you have. 3. First to 10 points wins." Then a `<details>` "More rules" with sections by expansion, collapsed by default. Keep the whole thing under 60 words before the details. |
| **Waiting** (someone else's turn) | (a) The last payout card: "+1 wool from 10" with the resource icon, or "Nothing from 6: the robber sits on your 8", or "No payout". (b) The **mini map**: 366×230, read-only, with your pieces at full colour, others at 75%, the robber shown, and the last roll's hexes glowing for 1.5 s. Tapping it opens the full-screen map in pan and zoom mode. (c) Can-build hints as chips: "City ready", "Settlement: need 1 wool", "Dev card ready". (d) The last 5 log lines, with "Full log" opening a modal. |
| **Roll** | A full-width **Roll** ArcadeButton (sun, xl, 120px tall). If a knight or other pre-roll card is playable, a secondary "Play a card first" (grape, md) below it. Auto-roll text "Rolls for you in 8 s" when timers are on. The action bar shows only Cards. After rolling, the dice result appears in the payout card within 450 ms. |
| **Main turn** | A "Now" panel: can-build hints as **buttons** (tap "City" and you go straight into placement), then the mini map, then the last payout. The Build, Trade and Cards tabs swap this area. |
| **Build menu** (Build tab) | One row per item: Road, Settlement, City, Dev card, plus Ship, Wall, Knight, Improve and so on from modules. Each row has an icon (32), a name (18px 800), a cost row of cost chips (each chip is green when you have enough and has a coral ring and "need 1" when you don't), and a status on the right: "12 spots", "No legal spot", "No settlements left" or "Need 1 ore". Tapping an affordable row opens placement, or buys directly for a dev card (with a confirm sheet). Rows you can't use stay visible, dimmed to 60%, with the reason. |
| **Placement** | The map fills the task area (366×~480). Legal spots are shown as **cream rings, radius 0.15 hex units, with an ink stroke**, breathing, and only for the chosen piece. At least 44px hit circles are ensured by auto-zoom (48px separation). Pinch and pan use `touch-action:none` on the map only. Tapping shows a **ghost** piece in your colour at 70% opacity and opens the **confirm sheet**: a detail line first, for example "Corner: Forest 6 (5 pips), Hills 8 (5), Pasture 3 (2). 3:1 harbour", then **Confirm settlement** (lime, lg) and **Back** (ghost). The details sit inside the sheet above the buttons, so the sheet never covers what it describes (fixes live critique P7). Tapping another spot moves the ghost. Road Building shows "Road 1 of 2" and a "Skip the rest" ghost button. |
| **Trade** | See 4.7. |
| **Responding to an offer** | A duty card on any screen, and a full card on the Trade tab: "Bo offers 1 ore for your 2 wool". Buttons: **Accept** (lime; if you can't afford it, it is disabled with the reason "You have 1 wool"), **Decline** (ghost), **Counter** (grape; opens the composer mirrored and prefilled). An offer sent only to you completes the moment you accept. For an offer sent to several players, after you accept: "Waiting for Bo to choose" plus a Cancel button (sends a decline). |
| **Discard** | The header says "Discard now". A 5-card grid (big cards, 96×120 in portrait). Tap a card to move one to the discard pile below it; tap the pile chip to return one. A live counter at 24px Lilita: "Discard 4 more", then "Ready: discard 4". **Discard 4 cards** (coral, lg) is enabled at an exact count. The timer ring shows the auto-discard: "Auto-discards in 18 s: biggest piles first". There are no +/- steppers on top of the cards. |
| **Robber: pick a hex** | The map shows legal hexes with sun rims. Each legal hex shows its token and pips plus the **emblems of the players who could be robbed there**, with their card counts ("Bo · 5"). Your own hexes carry the warning "Yours too". Tap a hex and a sheet opens. |
| **Robber: pick a victim** | The sheet lists the hex ("Hills 8, 5 pips") and one row per victim: chip, name, a face-down card fan with the count, and VP. Tap a row, then **Rob Bo** (coral). With one victim it is preselected. With no victims the button reads **Move robber here**. Friendly Robber excludes hexes and says "Friendly robber: players with 2 VP or less are safe". |
| **Dev cards** (Cards tab) | Card tiles 170×96 in 2 columns: name, a one-line effect, and **Play** (sun) or a reason: "Bought this turn: play next turn", "You already played a card this turn", "Victory point: counts at the end (hidden)". Knight goes into the robber flow. Road Building goes into placement ×2. Year of Plenty opens a 5-resource grid where you pick 2 (a counter shows, bank stock appears on each card, and empty piles are disabled). Monopoly opens a pick-1 grid. **Buy dev card** sits at the top with its cost chips. |
| **Gold / Year of Plenty picks** | The same pick grid: "Pick 2 from the bank". |
| **Expansion commands** | Rendered generically from `me.commands`. Commands are grouped in the Build tab (build-type groups) or the Cards tab (card-type groups). Opening one gives a sheet with each field in order. A `map` field uses the map with that field's options as hotspots. A choice field is a 2-column radio grid (48px rows, 16px text). A `cards` field uses the discard-style card grid with a min/max counter. Then the cost row and **Confirm \<label\>**. Forced prompts (for example "Choose a progress card to discard") take over the task area with a timer and are never hidden behind a tab. |
| **Movement** (ships, E&P ships, wagons, knight moves) | The map shows your movable pieces with a sun ring. Tap one to highlight its destinations, tap a destination to see a ghost, then the confirm sheet. The header shows "Moves left: 3". |
| **Connect round** | The header reads "Round 4" with the round timer. The bar's End becomes **Done**, which marks you ready at once. A readiness row of emblem chips with checks appears under the header. |
| **Finale / ended** | "Ana wins!" or "You win!" (kp-title, 40px), your rank, and your breakdown. The phone stays on this until results. |
| **Blocked / reconnecting** | The shell handles offline with a disabled fieldset. The game adds, under the header, "Reconnecting… your move auto-plays in 0:40" whenever you are the one blocking the table. |

### 4.3 Map (phone SVG)

- Same proportions as the 3D board: tokens r 0.29, pieces as flat icons with a 0.04 ink stroke, and harbour plaques.
- **Focus.** Keyboard focus draws its own 3px ring with `vector-effect: non-scaling-stroke`. Add `.island-settlers-hotspot:focus-visible { outline: none }`, which fixes the giant cream ring bug (live critique P1).
- **Labels.** Every hotspot is a `<g role="button" tabindex="0" aria-label="Corner by Forest 6, Hills 8, 3:1 harbour" data-spot="v12">`. The `data-spot` attribute stays as the QA selector.
- **Robber rims.** Robber mode shows sun rims only on legal hexes, not red outlines on every hex (fixes live critique P8).

### 4.4 Timers on the phone

- The header ring (44px) drains from your deadline. It shows seconds when 30 or fewer remain, and pulses sun at 10 s or fewer. A line under the task title explains what happens at zero: "At 0 we'll roll for you", "…end your turn", "…discard your biggest piles", "…pick the leader's best hex".
- **Presets** (settings):

| Preset | Setup step | Roll | Main turn | Paired turn | Discard | Robber | Other prompts | Offer open |
|---|---|---|---|---|---|---|---|---|
| Off | none | none | none | none | none | none | none | none |
| Relaxed | 60 s | 15 s | 120 s | 45 s | 40 s | 30 s | 40 s | 45 s |
| Brisk | 30 s | 8 s | 60 s | 25 s | 20 s | 15 s | 20 s | 25 s |

These mirror `TIMERS` in `src/model.ts` (reconciled; model.ts wins). Connect action windows use the round length (60/90/120 s) whatever the preset.

- **Disconnects.** Even with timers Off, a disconnected player who must act gets a **30 s grace** (`GRACE_SECONDS`; 5 s once marked away, and at least 15 s left after reconnecting), and then their move is auto-played. Nobody else is blocked unless they are waiting on that player.

### 4.5 Notices, haptics and sounds on the phone

- **Notices.** `role="status"`, stacked in the duty area, auto-cleared as in 4.1. Rejections quote the server's message.
- **Haptics.** `navigator.vibrate` where it exists (Android). iOS gets the sound alone.

| Moment | Vibration (ms) |
|---|---|
| Your turn | [30, 60, 30] |
| Production received | 15 |
| You were robbed | 80 |
| Trade completed | [20, 40, 20] |
| 10 s left | 10 |

- **Phone sounds.** These are personal cues only: your turn chime, resources received, robbed, offer received. They play at 0.6× the TV levels and follow the same `party.sound.muted` key and `party-sound` event as the shell. They are triggered from ControllerView, because AudioView has no private view.

### 4.6 Hand cards

- **Card:** 64×88, radius 10, in the resource colour.
- **Icon:** a 30px ink icon. The icons are pine tree, bricks, sheep, wheat and rock (replacing the arrow glyph for wood).
- **Name:** 16px 800 ink.
- **Count:** Lilita 28px in an ink bubble at the bottom-right, cream text.
- **Ratio badge:** top-left in sun, 16px, for example "3:1" or "2:1", shown only when better than 4:1.
- **Zero count:** a dashed-outline card with the icon at 45% opacity. The count "0" is still shown.
- **Change:** when a count changes, the card bumps (scale 1.15, 180 ms) and a "+2"/"−1" floats up 20px and fades over 700 ms.
- **Total:** "7 resources" under the strip (16px), with the correct singular "1 resource" (fixes live critique P2). Dev cards are always called "dev cards".

### 4.7 Trade composer

The trade tab has two segments: **Players** and **Bank** (a 48px segmented control).

**Players:**
- **Give row:** your 5 cards (same card component). Tap to add 1. A small "−" chip (44px) appears on any card with a count above 0.
- **Get row:** all 5 resources. Tap to add 1, with the same "−" chip.
- **Summary** (18px): "You give 2 wool, you get 1 ore".
- **Quick offers:** when Get holds exactly one resource and Give is empty, the composer shows up to 3 suggestion chips built from your largest piles, for example "1 wool for 1 ore". Tapping one fills Give.
- **Recipients:** "Everyone" (default) or individual emblem chips (multi-select). Players who can't afford it are shown dimmed with "can't afford".
- **Buttons:** **Offer** (sky, lg) and **Clear** (ghost).
- **Bank shortcut:** if the Give selection exactly matches a bank or harbour ratio for the Get amount, a second button **Trade with bank (3:1)** appears (lime), so players don't post an offer that the bank would fill.
- **After posting:** the composer collapses into a pinned **Your offer** card at the top. The card shows live response chips. Each acceptor gets a **Trade with Bo** button (lime). The card also has **Edit** and **Withdraw**. The phone scrolls to the card (fixes live critique P6).
- **Incoming offers and counters:** listed under the composer, newest first.
- **Draft:** saved in sessionStorage keyed by room/round/player/turnId.
- **Paired turns:** the Players segment is disabled with the reason "Build turns trade with the bank only".

**Bank:**
- Five give cards, each showing your best rate ("4:1", "3:1", "2:1") and "have 5".
- Tap one to fill Give with exactly its rate. If you can't afford any rate, the text says so: "You need 4 of one resource (or a harbour)".
- Then tap a Get resource (bank stock is shown, empty piles are disabled).
- **Trade 3 wool for 1 ore** (lime). Repeated taps on Get add multiples when you have enough.

### 4.8 Accessibility

- Every control has a text label; icons are always paired with text or an `aria-label`.
- Colour is never the only cue: emblems, "✓/✕" glyphs and state words are always present.
- Focus order follows the frame order. Sheets use the Modal primitive (Escape, focus trap, focus restoration).
- Text is at least 16px for compact choices, and targets are at least 48px in portrait.
- Live regions: the header (polite) and notices (status).
- Reduced motion follows section 2, plus: no card bumps, and sheets appear without sliding.

### 4.9 Seated host (PersonalView)

The host sees the full TV board and HUD with a **controller dock** at the bottom, so there is no longer a tab that hides the board.

Regions (u, fixed for the round, so the board never jumps):
- **Dock:** left 16, width stage − 16 − 392, height 150, bottom 16.
- **Production strip:** moves to just above the dock (48 high).
- **Board window bottom:** stage − 16 − 150 − 8 − 48 − 8 = the board window ends 230u above the stage bottom. At 1080p the base board fits at about 73 px/wu.

**Dock (collapsed, the default):**
- the status header (one line, 22u);
- the hand as cards (72×96u, min 56×76px);
- action buttons [Roll] or [Build] [Trade] [Cards] [End turn] on the right, with End separated by a 24u gap;
- a timer ring;
- a **Hide hand** toggle (eye icon, persisted in localStorage), which blurs the card faces to counts when the laptop is mirrored to the TV.

**Dock (expanded):**
- Opening Build, Trade or Cards raises a sheet to 420u (60% of the stage at 720p) that overlays the lower board. The board itself does not move.
- **Close** or Escape collapses it.

**Placement on the host:**
- The sheet collapses to the dock, and the legal spots render **on the 3D board** as hotspots.
- The mouse hovers to show a ghost and clicks to select (a raycast against invisible spot discs 0.25 wu).
- The keyboard uses ←/→ in the dock ("Spot 3 of 12: Forest 6, Hills 8") with a sun focus ring drawn on the board, and Enter selects.
- The confirm bar appears in the dock with details, **Confirm** and **Back**.

At 1280×720 everything scales with u. The dock is at least 120px tall, and card and button minimums still apply.

### 4.10 Settings (host modal, `settingsWide`)

Order:
1. **Table:** size 3–10, with a live preview row of emblem chips labelled "You + 2 phones + 1 CPU = 4 seats". This fixes the lobby not showing CPUs.
2. **Map:** Base island (default), Seafarers, Explorers & Pirates.
3. **Turns:** Standard or Connect rounds (60/90/120 s).
4. **Victory target:** with the suggested value marked.
5. **Timers:** Off, Relaxed or Brisk. Default Relaxed; the preset table (4.4) is shown inline.
6. **CPU difficulty:** Easy, Normal or Sharp.
7. **Expansions and scenarios:** toggles, with the reason shown when a toggle is disabled, for example "Explorers & Pirates can't combine with Rivers".
8. **Variants:** Friendly Robber, Harbormaster.

---

## 5. Sound design (WebAudio, synthesized, no files)

- **Owners.**
  - Public SFX play only from the host device (DisplayView or PersonalView). They share `party.sound.muted` and `party-sound` with the kept `Soundtrack`, and suspend while the document is hidden.
  - The music keeps its HTMLAudio volume of 0.22 and is left untouched.
- **Signal chain:** SFX voices → master `GainNode` 0.35 → `DynamicsCompressorNode` (threshold −18 dB, ratio 4, attack 3 ms, release 150 ms) → destination.
- **Timing:** one `AudioContext`, created on the first trusted gesture. Every sound is scheduled from event arrival and deduplicated by event id.

| Sound | Recipe | Peak | Length |
|---|---|---|---|
| Dice roll | 6 noise bursts (bandpass 2.5 kHz, Q 1.2, 25 ms each) at irregular 40–90 ms gaps, ending in two clicks (triangle 1.8 kHz, 8 ms) at 450 ms | 0.5 | 480 ms |
| Seven | After the dice, two detuned saws at 110/116 Hz through lowpass 600 Hz, gliding to 82 Hz | 0.35 | 450 ms |
| Resource arrival | Triangle blip, 70 ms exponential decay, pitch by resource: wood 660, brick 740, wool 880, grain 990, ore 523 Hz (paper 1175, cloth 1047, coin 1319) | 0.18 | 70 ms each, at most 6 per 200 ms |
| Build (road/ship) | Sine 220 to 110 Hz over 90 ms plus a 10 ms noise click | 0.4 | 110 ms |
| Build (settlement) | Two "thocks" (sine 180 to 90 Hz), 80 ms apart | 0.45 | 200 ms |
| Build (city/metropolis) | The settlement thocks, then a chime (sine 1047 + 1568 Hz, 400 ms decay) | 0.45 | 500 ms |
| Robber move | Low wobble (sine 98 Hz with LFO 7 Hz depth 12 Hz), 350 ms, followed by a landing thud | 0.35 | 450 ms |
| Steal | Whoosh: noise through a bandpass swept 800 to 3000 Hz | 0.25 | 220 ms |
| Turn start | Marimba pair: sine 523 then 784 Hz, 90 ms apart, 180 ms decay each | 0.3 | 300 ms |
| Offer posted | Pluck (triangle 660 Hz, 120 ms) | 0.2 | 120 ms |
| Trade completed | Arpeggio 523-659-784 Hz, 60 ms apart | 0.3 | 300 ms |
| Timer warning | Tick (square 1 kHz through lowpass 3 kHz, 25 ms) at 10, 5, 4, 3, 2 and 1 s, for the blocking seat only | 0.15 | 25 ms |
| Barbarian attack | Drum: 3 sine hits at 60 Hz, 150 ms apart, plus the seven's saw | 0.5 | 900 ms |
| Victory | C-major arpeggio 523-659-784-1047 Hz (triangle, 110 ms apart), then a held chord for 1.2 s with a noise shimmer (highpass 6 kHz, 0.05) | 0.5 | 1.8 s |

Phone personal cues reuse the turn start, resource arrival, steal and offer recipes at 0.6×.

---

## 6. Motion timing table

| Motion | Duration | Easing | Reduced motion |
|---|---|---|---|
| Dice tumble | 450 ms (face swap every 60 ms) | linear | final faces at once |
| Dice land squash | 120 ms | ease-out | none |
| Roll total pop | 260 ms | easeOutBack (1.7) | fade 120 ms |
| Token flash (lift 0.05 wu, sun rim) | 500 ms | ease-in-out | rim colour only |
| Fly-out | 480 ms, 40 ms stagger, start at 600 ms | cubic-bezier(.2,.8,.2,1) | none; "+n" chips only |
| Seat "+n" chip | in 160 ms, hold 1600 ms, out 240 ms | ease-out | in 1 ms |
| Seat chip bump | 160 ms | ease-out | none |
| Piece drop + ring burst | 420 ms / 480 ms | easeOutBack 1.4 / ease-out | fade 120 ms |
| Road/ship grow | 320 ms | easeOutCubic | fade 120 ms |
| Robber/pirate hop | 520 ms, arc 0.6 wu | easeInOutSine | teleport |
| Hex desaturate | 300 ms | linear | instant |
| Steal card flight | 600 ms | cubic-bezier(.3,.7,.2,1) | none; ticker only |
| Ship sail (per edge) | 700 ms | easeInOutSine | teleport |
| Knight/wagon move (per edge) | 450 ms | easeInOutCubic | teleport |
| Fog reveal | clouds 500 ms, tile rise 600 ms | ease-out / easeOutBack | instant |
| Banner swap | out 140 ms, in 220 ms (12u slide) | ease-out | cross-fade 1 ms |
| Active seat slide | 200 ms | ease-out | instant |
| Offer card enter / collapse | 220 ms / 240 ms | ease-out | instant |
| Response chip change | 160 ms | ease-out | instant |
| Trade complete flash | 1200 ms | — | static tint 1200 ms |
| Spotlight pulse | 1.6 s loop | sine | static 0.45 |
| Legal target breathe | 1.2 s loop | sine | static 0.8 |
| Timer ring | continuous, frame-driven from `serverNowMs()` | linear | unchanged (never animation-dependent) |
| Phone sheet up / down | 220 ms / 180 ms | cubic-bezier(.2,.8,.2,1) | instant |
| Phone card bump | 180 ms (scale 1.15) | ease-out | none |
| Phone "+2" float | 700 ms | ease-out | none |
| Toast in / hold / out | 160 / 3500 / 200 ms | ease-out | in 1 ms |
| Finale VP flip | 500 ms per seat (300 ms at >6 seats) | ease-in-out | final values at once |
| Rank re-sort | 500 ms FLIP | ease-in-out | instant |

---

## 7. "Feel" acceptance checks for browser QA

Record the build hash, viewport, roster and evidence path for each. Emulated phones are not physical-device evidence.

1. **Tokens never hide pieces.** On a 10-seat late-game board at 1920×1080, zoom the screenshot on 5 random hexes. Every corner settlement and edge road is fully visible, and the token diameter measures 30–36% of the hex flat width.
2. **Owners readable at a glance.** From a 1080p screenshot scaled to 25%, which approximates 3 m, a reviewer names the owner of 10 random pieces. Repeat with deuteranopia and protanopia emulation using colour plus emblem. The target is 10/10.
3. **The robber stands out.** In the 25% screenshot, find the robber within 2 s; it must not be confused with any settlement.
4. **No board jump.** Record the board's screen bounding box during setup, an open offer, three open offers, a 7 with discards, a C&K barbarian alert, and the finale. It must be identical to the pixel.
5. **Roll to payout ≤ 1.5 s.** Record video of the TV. The time from the dice starting to the last fly-out landing is ≤ 1500 ms at 10 seats with every seat producing, and the production strip is readable by 700 ms.
6. **Who got what.** After a roll, a reviewer who looked away reads the full payout from the strip alone, including blocked and nobody-produced cases.
7. **Whose turn / what now.** On every screenshot of the TV and phone across all states, a reviewer can say in one glance whose turn it is and what the viewer can do. The phone header's subline is never empty.
8. **Trade speed.** Post a 2-for-1 targeted offer from a fresh Trade tab in ≤ 5 taps. Accept an incoming offer in 1 tap. A bank 3:1 trade takes ≤ 3 taps. The posted offer card is visible without scrolling.
9. **Responses on the TV.** Each eligible seat's chip changes within 200 ms of the ack, and a CPU decline shows its reason.
10. **Simultaneous discards.** On a 7 with 3 humans over the limit, all 3 phones show the discard grid at the same time and the TV subline lists all 3, shrinking as each finishes.
11. **Timers.** With Brisk and one idle human, the roll, turn end, discard and robber each auto-resolve at the stated times ±300 ms, and the phone explained each auto-action beforehand.
12. **Disconnect scope.** Disconnect a non-active phone and play continues with no pause. Disconnect the active phone and the banner shows the grace countdown, and the move auto-plays at 30 s.
13. **CPU pacing.** CPU steps land 0.6–1.2 s apart and the "thinking…" dots show on the chip. No CPU turn at 10 seats takes more than 8 s without a visible action.
14. **Density.** At 10 seats with 16-character names at 1280×720 and 1920×1080, there is no clipped text, no `overflow:hidden` hiding content, and every seat row shows VP, cards, dev cards and status.
15. **Phone sizes.** At 320×568, 390×844, 667×375 and 844×390: the primary action is visible on arrival, the confirm sheet never overlaps the detail it confirms, End turn is never adjacent to Trade or Build without the gap, and all targets are ≥ 44px (≥ 48px in portrait).
16. **Placement.** Every legal spot is tappable at ≥ 48px separation after auto-zoom. Keyboard Enter focus shows the small ring, not the giant cream band.
17. **Reduced motion.** With the OS setting on, no loops move (compare 5 screenshots taken 300 ms apart) and every state is still reachable and understandable.
18. **Seated host.** At 1280×720 the host completes a turn (roll, bank trade, build a road by clicking the 3D board, end) without the board ever being hidden, and the board bounds never move.
19. **Finale.** The reveal plays in full on the TV before results, hidden VP counts up correctly, and the results table's breakdown sums to each total.
20. **Replay.** "Play again" gives a fresh board, fresh stats and no replayed animations.
21. **Sound balance.** With music on, the dice, the build sounds and the victory are clearly audible and never clip (compressor gain reduction ≤ 6 dB). Mute silences both music and SFX on that device.
22. **Frame budget.** In a 10-seat late game on balanced quality, `onMetrics` reports ≤ 700 draw calls, ≤ 250k triangles and a p95 frame under 20 ms on the QA laptop.
