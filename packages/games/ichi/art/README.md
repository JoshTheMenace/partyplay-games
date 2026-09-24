# Ichi art

`render.py` builds every Ichi image procedurally in Blender (no external assets) and writes WebP files to `public/games/ichi/`.

```sh
cd game-modules/packages/games/ichi/art
blender -b --python render.py                  # all three, about 35 s on Apple Silicon (Cycles, Metal GPU)
blender -b --python render.py -- table card    # only some: table, portrait, card
```

The script uses Blender 5.2's Python API. Look at the output images after every change. No automated check covers how they look.

| File | Size | Use |
| --- | --- | --- |
| `table.webp` | 1920×1080 | TV table. Orthographic top-down view with 1 unit = 100 px. The oval's outer edge spans 1536×810 px, centred (80% × 75%). The felt ends 72 px inside that edge. Use `background: #05071a url(/games/ichi/table.webp) center / cover`. |
| `table-portrait.webp` | 1080×1920 | Darker, blurred felt for phones. The table's long axis is vertical. Use `center / cover`. |
| `card-back.webp` | 500×700 RGBA | Card back with transparent rounded corners (34 px radius, 6.8% of the width). Do not add a CSS border-radius or box-shadow, because the shadow would not follow the corners. Use `filter: drop-shadow(...)` instead. |

The card back centres a square vermilion seal (hanko), stamped 5° askew, with a gold 一 brush stroke inside it. An earlier bare gold stroke read as a bone at TV size, and a round red seal read as a no-entry sign.

Tweakable constants: `A`, `B`, `N_EXP` (oval size and squareness), `STROKE` (the brush outline of 一, where `'v'` marks a sharp corner), and `CW`, `CH`, `CR` (card size and corner radius).
