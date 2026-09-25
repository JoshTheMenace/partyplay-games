# Starship Scramble art

Blender scripts that regenerate every rendered asset in `public/games/starship-scramble/`: ship sprites and paint masks, sector backdrops and UI icons. Everything is procedural (no external models, textures or HDRIs), seeded and deterministic.

## Regenerate

Requires Blender 5.2 (Cycles; uses Metal on Apple GPUs, otherwise the CPU) and the repository's Node toolchain (for the hull export).

```sh
sh packages/games/starship-scramble/art/render-all.sh            # everything, about 2 minutes on an M-series GPU
sh packages/games/starship-scramble/art/render-all.sh ships      # or any of: ships backdrops icons
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender sh …/render-all.sh
```

The `ships` stage first re-exports `hulls.json` from `src/defs/hulls.ts`, then renders and writes alignment contact sheets to `output/ss-dev/art/` (ignored by git). Single scripts run directly too: `blender -b --factory-startup -P art/ships.py -- public/games/starship-scramble wayfarer lancer`.

## Files

| Script | Output |
| --- | --- |
| `lib.py` | Shared scene/Cycles setup, materials (plated armor, chitin, glows, halo cards), mesh helpers, raster morphology/contour tracing, numpy PNG IO, a terse shader-node builder. |
| `ships.py` | `ships/<hullId>.png` and `ships/<hullId>-paint.png` for every hull in `hulls.json`. |
| `contact.py` | `contact-<hullId>.png` (tinted sprite with room rectangles, the paint mask, a half-scale TV preview) and `gallery.png`. |
| `backdrops.py` | `backdrops/{rustbelt,veil,meridian,armada-reach,hangar,map}.jpg`, 1920×1080, JPEG quality 80. |
| `icons.py` | `icons/{laser,missile,beam,ion,flak,support,augment,scrap,crew,repair,ammo}.png`, 128×128. |
| `hulls.json` | Export of `HULLS` (generated; do not edit). |

## Ship sprite contract

The convention in `src/defs/geometry.ts`: the sprite is `(gridW + 4) × (gridH + 3)` cells at 64 px per cell, grid cell (0,0) at pixel (128, 96), y down, nose toward +x, top-down orthographic, transparent background. Enemies face +x too; the game mirrors them.

How `ships.py` builds a hull. Grid coordinates (x, y down) map to Blender world (x, −y).

1. **Body.** Each design passes `Ship.body()` a hand-drawn outer envelope (a polygon with per-corner radii, often mirrored with `sym`) that is not the room outline: a shaped nose, tapers, chamfers and a stern. It is extruded as a darker painted lower tier plus an upper plate deck (a raster offset of the envelope) split by transverse gaps. Booleans cut a dark, desaturated deck recess under the rooms, ringed by a thin metal lip. A grid-space panel texture adds edge bands, seams, hatches, per-panel tone and a pillow height that rounds armor into its edges.
2. **Design function.** Each hull has one (`DESIGNS`). It adds the secondary masses that break the silhouette (wings, prongs, fins, nacelles, sponsons, skirt plates, keels, ribs, mandibles), darker accent paint panels, engine blocks and nozzles with emissive cores, canopies, gold or colored trims, radiators, welded plates with rivets, hazard stripes, running lights and a few greebles.
3. **Guards.** A build fails if the body misses a room or a turret mount, or if any raised part covers a room or leaves the sprite. The weapons room's outer top and bottom edges are kept free of greebles, because the game draws turrets there. Part tops never sit at a hull tier's height, which would z-fight and speckle the mask. After rendering, a warning fires if anything touches the image border or pokes more than about 12% past the inscribed shield ellipse (wing tips near the sprite corners usually do).
4. **Two passes.** The beauty pass is followed by a soft 2 px dark outline. The paint-mask pass swaps every `paint`-tagged material to pure white emission, turns everything else into holdout, and hides glow cards. The mask is opaque white exactly where captain or faction paint applies (the neutral light-grey armor plates, skirts and wings), so a multiply tint keeps the shading. The structural frame, engines, trim, glass and deck stay untinted.

Palettes per faction live in `PAL`: explorer blues and oranges for players; rust and hazard yellow for Raiders; organic chitin for the Vesk; grey with blue light bars for the Wardens; black, crimson and gold for the Armada.

## Adding or changing a hull

Edit the deck plan in `src/defs/hulls.ts`, run the `ships` stage, and add or adjust its function in `ships.py` (register it in `DESIGNS`). The overlap and bounds guards tell you which part to move. Check `output/ss-dev/art/contact-<id>.png`: room rectangles must sit inside the dark recess, and the half-scale preview approximates the TV at 32 px per cell.

## Backdrops and icons

Backdrops put an emission sky plane (edge-weighted nebula noise, three 2D-Voronoi star layers, soft glares) behind 3D set pieces:

- Rustbelt: displaced asteroids.
- Meridian: a spoked ring station and a self-lit banded gas giant.
- Armada Reach: fleet silhouettes and a red giant.
- Hangar: a dock gantry with light shafts, the deck and pillars.

The middle band stays calm for ships and text. Icons share one studio rig with a 3/4 orthographic camera that auto-fits the object. They render at 256 px, get a navy outline, and are downsampled to 128 px.
