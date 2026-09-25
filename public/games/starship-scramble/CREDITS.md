# Starship Scramble assets

Ship sprites, paint masks, sector backdrops and UI icons are original renders (see Artwork below). Fonts come from the shared PartyPlay bundle.

Background music supplied by the user for this game, copied without transcoding:

- SpaceBattle: Fleet Engagement, Misión Silenciosa, Starfield Clash.
- SpaceIdle: Cosmic Discovery, Quiet Discovery, Weightless Drift, Weightless Drift(1). The two Drift recordings are distinct files.

Original titles are retained here; asset filenames use lowercase ASCII slugs. No additional authorship or redistribution license was supplied.

## Artwork

All rendered art is original and procedural, made for this game in Blender 5.2 (Cycles) by the scripts in `packages/games/starship-scramble/art/` (see its README to regenerate). No third-party models, textures, HDRIs or photographs are used.

- `ships/`: one top-down sprite per hull. Silhouettes are generated from the game's own deck plans in `src/defs/hulls.ts`, with a matching white `-paint.png` mask for captain and faction tints.
- `backdrops/`: 1920×1080 starfields, nebulae and set pieces for the Rustbelt, the Veil, Meridian, the Armada Reach, the hangar and the sector map.
- `icons/`: 128×128 renders for weapon kinds, augments, scrap, crew, repair and missiles.

Scripts and renders were authored by Claude (Anthropic) for this project.
