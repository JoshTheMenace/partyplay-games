# Island Settlers art

Python scripts that build the 3D board bundles in Blender. Everything here is original work made for
this game: no downloaded models, textures or kits. The authoritative spec is
[EXPERIENCE §1.5 and §1.8](../docs/v2/EXPERIENCE.md#15-pieces).

## Regenerate

```sh
packages/games/island-settlers/art/build.sh            # the three GLBs
packages/games/island-settlers/art/build.sh --preview  # plus art/preview/*.png
BLENDER=/path/to/blender packages/games/island-settlers/art/build.sh
```

Output goes to `public/games/island-settlers/models/`. Builds are byte-stable: the same scripts
produce the same files (seeded randomness only). Each run prints triangles per node against its
budget. `node --import tsx --test packages/games/island-settlers/tests/ui/models.test.ts` checks the
result.

| File | Role |
| --- | --- |
| `common.py` | Palette and material slots, the `Part` mesh builder (extrude, loft, lathe, convex hull), outline hulls, decals, blob shadows, `export()` |
| `pieces.py` | `pieces.glb` |
| `props.py` | `props.glb` |
| `expansions.py` + `landmarks.py` | `expansions.glb` (landmarks holds the bridge, castle, longship and depots) |
| `preview.py` | Preview renders: the lineup under the board lights and 32° camera, and a TV-scale vignette |

## Conventions

- Units are world units (1 wu = hex circumradius = 1 m). The origin is the bottom centre of the
  footprint, +Y up, figures face +Z (the camera). Road, ship, wagon, bridge, barbarian ship and the
  harbour pier run along +X.
- Every root node sits at the origin with no transform.
- **No normals are exported.** The materials must use `flatShading: true` (EXPERIENCE §1.1), which
  derives face normals in the shader. This keeps the files well under budget.
- UVs exist only on `<name>_decal` meshes.

## Nodes

Each piece root has an `<name>_outline` child, and most have a `<name>_shadow` child. Props have
shadows but no outlines.

| Bundle | Roots | Extra children |
| --- | --- | --- |
| `pieces.glb` (52 KB, 1,792 tris) | `settlement` 178, `city` 234, `road` 52, `ship` 166, `robber` 478, `pirate` 238, `harbor` 262, `die` 184 | `_decal` on settlement, city (roof), ship (sail), harbor |
| `props.glb` (36 KB, 762 tris) | `prop_pine` 32, `prop_round_tree` 38, `prop_sheep` 68, `prop_wheat` 51, `prop_rock` 26, `prop_peak` 66, `prop_bricks` 36, `prop_kiln` 82, `prop_dune` 24, `prop_cactus` 61, `prop_nugget` 30, `prop_palm` 42, `prop_reeds` 38, `prop_spice` 72, `fog_cloud` 96 | shadows only |
| `expansions.glb` (145 KB, 6,006 tris) | `knight_1` 316, `knight_2` 332, `knight_3` 380, `wall` 264, `metropolis_science` / `_trade` 418, `metropolis_politics` 278, `merchant` 360, `wagon` 372, `settler` 92, `crew` 100, `crate_fish` 29, `sack_spice` 52, `fishing_sign` 58, `invader` 186, `bridge` 104, `castle` 1052, `barbarian_ship` 272, `depot_castle` 352, `depot_quarry` 272, `depot_glassworks` 299 | `knight_N_active` (banner + glow halo), `knight_N_decal` (shield emblem), wagon `cargo` and `level_1..3`, `fishing_sign_decal` |

Triangle counts include every child (outline, decal, shadow, toggles). All are within the §1.8
budgets.

## Materials

The slot names from §1.8: `seat`, `seat_dark`, `ink`, `cream`, `stone`, `wood`, `metal`, `sail`,
`glow`, `outline`, `decal`. Additions:

- `outline_cream`: the light outline on `robber`, `pirate` and `barbarian_ship`.
- `shadow`: blob shadows. The alpha lives in the vertex colours (`COLOR_0`, 0.35 at the centre, 0 at
  the rim), so it needs `vertexColors`, `transparent` and `depthWrite: false`.
- `cargo`: the wagon crate, tinted at runtime (tools, sand, marble, glass).
- Fixed colours named after what they paint (`plum`, `hull`, `gold`, `slate`, `pine`, `wheat` …).
  `nugget` is emissive at 0.15.

## Runtime notes (for WP-scene)

- **Outline hulls keep outward normals.** Draw every `*_outline` material with `side: BackSide`, as
  §1.8 says. §1.8 also says to flip the normals, but flipped normals drawn with BackSide would cover
  the piece, so the hull is left unflipped. Hull vertices never go below y = 0.004, so closed bases
  leave an ink rim on the table.
- **Decals** are quads laid on the roof, sail, shield or sign plane and shaped so the emblem shows as
  an upright square from the fixed 32° camera. Their UVs span 0..1; swap in the atlas cell.
- **Settlement gable faces the camera** (ridge north–south). §1.5 says the ridge runs east–west "so
  the gable faces the camera". Those two statements conflict, and the renders read far better as a
  house with the gable forward. The city hall keeps its ridge east–west, with the emblem on the south
  slope.
- **Knight toggles** are named `knight_N_active`, not `active`, because three.js renames duplicate
  node names (`active_1` …). Level pennants are one per child. Show `level_1..k` for level k.
- **Ship sails** face +Z. Keep ship yaw within ±90° so the sail and emblem stay toward the camera.
- **Die faces**: 1 on +Y, 6 on −Y, 2 on +Z, 5 on −Z, 3 on +X, 4 on −X.
- **Spec interactions seen in the vignette.** A ship at y = 0.02 on a coast edge midpoint is half
  inside the land prism. Nudge it about 0.15 wu seaward. Roads end 0.23 wu from a corner, and the
  0.58 × 0.42 city plinth reaches further, so roads overlap city plinths in plan.

## Previews

`build.sh --preview` writes these. The second row of each lineup recolours `seat` / `seat_dark` per
seat, and a stand-in triangle marks the emblem decals.

- `preview/pieces.png`, `preview/pieces-tv.png`: pieces on four hexes at the board's 80 px/wu
- `preview/props.png`
- `preview/expansions.png`
