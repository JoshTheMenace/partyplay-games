# Kitchen Rush Blender kit

Original models authored for this game in Blender 5.2.1. No downloaded meshes, textures or third-party asset licenses. Rebuild with:

```sh
blender --background --factory-startup --python-exit-code 1 --python game-modules/packages/games/kitchen-rush/art/build_models.py
```

The script writes the editable `kitchen-kit.blend`, exported `public/games/kitchen-rush/models/kitchen-kit.glb` in the games repository, and `asset-manifest.json`. Preview renders go to the platform's ignored `output/kitchen-rush/blender/` directory. The `.blend` contains a presentation arrangement; exports contain only individual assets rooted at the origin, without preview cameras or lighting.

The GLB uses metres, Y up and Z forward. Stations fit the existing 1.85 m work-cell footprint. Four chef appearances have rigid shoulder/hip/head pivots. The renderer animates those joints from authoritative movement, carrying and station work, with reduced-motion poses. No baked animation timeline or skeleton retargeting is needed; Blender's joint hierarchy remains editable. Chef team-color materials are copied per player; mesh geometry and other materials are shared.

The kit includes eleven station types, seven ingredients with raw/chopped/cooked/burnt states, four finished recipes, clean/dirty plates, bell, planter and fan. Flat environment tiles, HUD labels and transient fire/steam retain their existing lightweight rendering. Exported vertex colors preserve the palette without texture downloads; painted and metal surfaces use separate materials. The exported kit is about3MB and chef meshes use7,680triangles each. Static station meshes are instanced by geometry/material in the game. Models load before scene readiness, and their shared GPU resources are released at round teardown.

Run `node --import tsx --test packages/games/kitchen-rush/tests/models.test.ts` from the platform root to verify actual GLB loading, every station/ingredient, chef joint independence, team colors, bounds, size budget and shared geometry disposal. See `output/kitchen-rush/blender/QA.md` for the current render/browser evidence and limits.
