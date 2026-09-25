# Night Job asset kit

Original low-poly kit generated from code (no textures, no third-party assets). Rebuild, check and preview from the game folder:

```sh
blender -b --factory-startup --python-exit-code 1 --python art/build-kit.py && python3 art/check-kit.py && blender -b --factory-startup --python-exit-code 1 --python art/render-preview.py
```

- `build-kit.py` writes `public/games/night-job/models/night-job-kit.glb`: 63 top-level mesh nodes named per DESIGN.md "Asset kit contract", identity transforms, one single-sided material each, flat normals, `COLOR_0` as normalized RGBA (alpha is 1 except the window glass at 0.35).
- `check-kit.py` reads the required names from DESIGN.md and `PropKind` in `src/model.ts`, then checks bounds, origins, footprints, triangles (≤ 60k) and size (≤ 1.5 MB).
- `render-preview.py` writes top-down and 3/4 contact sheets plus a game-scale tableau to `../output/nj-rebuild/assets/` (outside the repository).

Renderer facts:

- Characters share the floor origin. Legs (`thief_leg`, also used for guards and civilians) pivot at the hip `(±0.085, 0.30, 0)` and hang to y = −0.30. Torso spans y 0.23–0.60. The head centre is at y 0.71 (guard 0.735), and the top of the hair is 0.88. Hats are modelled in the same space as `thief_head`, so give them the head's transform. `thief_torso` light greys (#dadada and #a8a8a8 stripes) are the role-tint areas. Its gloves, belt and backpack are dark, so a multiply tint barely changes them.
- Dog legs pivot at `(±0.075, 0.22, ±0.16)` and hang 0.22. `bird` sits 0.04–0.16 above its origin with its wings spread.
- Cars, the van and the boat have their nose at +X (their long axis). Bar, counter, slot and locker face customers toward +Z. The piano keyboard is at −X.
- Downward-facing faces are removed because the camera is always above the kit. If you use shadow maps, set `shadowSide = FrontSide`.

`public/games/night-job/cover.png` (1280×800, 256-colour PNG because the room server types `.png` but not `.jpg`/`.webp`) is the catalog hero still: a TV frame from a real Velvet Ledger round (Impostor on the casino floor, guard and casino camera cones, blueprint around), with the DOM HUD hidden and a centred 16:10 crop.
