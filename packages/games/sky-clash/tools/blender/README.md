# Sky Clash fighter pipeline (Blender 5.2, headless)

Each fighter is one Python script that sculpts the model from code, then rigs, skins and exports it. The shared kit does the hard parts.
Reference fighters: `fighters/mario.py` (humanoid), `fighters/fox.py` (animal with ears, tail and a blaster) and `fighters/kirby.py` (round body).

| File | Owner | Purpose |
| --- | --- | --- |
| `common.py` | models-lead | Kit: geometry, face kit, hands/shoes, skeletons, weights, materials, `Model`, posing |
| `validate.py` | models-lead | Reads the GLB bytes back and checks the contract |
| `render_sheet.py` | models-lead | Contact sheets, portraits, full-body renders, lineups |
| `build_all.sh` | models-lead | Build, render and validate one, several or all fighters |
| `fighters/<kind>.py` | that fighter's models agent | Everything specific to one fighter, including its own helpers |

**Do not edit the four shared files.** Put helpers in your own fighter file. If two of your fighters share a helper (Popo/Nana, Mario/Dr. Mario, Fox/Falco), give one script a helper and import it from the other (`from fighters.popo import parka`, after the `sys.path` line), or copy it. If the kit is genuinely missing something, work around it locally and say so in your report.

## Commands

Run these from `packages/games/sky-clash`. `B` below means `/opt/homebrew/bin/blender -b --factory-startup --python-exit-code 1 --python`.

```sh
$B tools/blender/fighters/mario.py                                  # build: GLB, costumes, model JSON, debug .blend
$B tools/blender/render_sheet.py -- mario                           # sheet + portrait + render (--only sheet,portrait,render)
$B tools/blender/validate.py -- mario                               # reimport check -> output/sky-clash-v2/models/mario-validate.json
$B tools/blender/render_sheet.py -- --lineup ../../../../output/sky-clash-v2/models/my-lineup.png mario fox kirby
tools/blender/build_all.sh mario fox                                # all three steps for each kind (no kinds = every script + lineup.png)
```

A build takes a few seconds and a sheet about ten. Every product is rendered from the shipped GLB, so what you inspect is what ships. Temp files go to `output/sky-clash-v2/models/tmp/<kind>/`, so agents can run in parallel. Debug scenes go to `output/sky-clash-v2/models/blend/<kind>.blend`.

Outputs per fighter:

- `assets/fighters/<kind>.glb`: skinned T-pose with no animation, no textures and no UVs.
- `assets/costumes/<kind>.json`: four costumes keyed by material name.
- `assets/models/<kind>.json`: tris, bytes, size, bounds, height, head top, materials, bones, parents, joints, extras and prop info.
- `assets/portraits/<kind>.webp`: 512×512.
- `assets/renders/<kind>.webp`: 640×800.
- `output/sky-clash-v2/models/<kind>-sheet.png` and `<kind>-validate.json`.

## Space and scale

Author in **character space**: meters, +Y up, **+Z forward (the face)**, and **+X is the fighter's own LEFT**, which is screen right in a front view. Feet stand on y=0. This is glTF space, so the numbers you type are the numbers that ship. Blender's Z-up space only exists inside `common.py`.

Author at roughly real size. `Model.finish()` scales everything uniformly so the top of the non-`over` parts lands exactly on `ROSTER_DATA[kind].height`. Pass `over=True` to `m.add` for parts allowed above the head top: ears, hats that exceed the listed height, antennae, props. Mario's cap counts as his head; Fox's ears are `over`. A scale near ×1.0 in the build log means your authored numbers match the game.

`mx(p, s)` mirrors a point to side `s` (+1 left, -1 right). `m.both(fn)` calls `fn(s, S)` with `(1, 'L')` and `(-1, 'R')`.

## Rig contract (model.ts)

- **Bones** (exact names): `root hips spine chest neck head shoulder_L/R upperarm_L/R forearm_L/R hand_L/R thigh_L/R shin_L/R foot_L/R prop`.
- **Hierarchy**: root→hips→spine→chest→neck→head. chest→shoulder→upperarm→forearm→hand. hips→thigh→shin→foot. hand_R→prop, or hand_L→prop for left-handed fighters.
- The kit builds bones pointing up with zero roll, so every joint ships with an **identity rest rotation**. A pose is then a plain character-space rotation per bone. The renderer and `apply_pose` rely on this. Never add your own armature.
- **Rest pose**: T-pose. Arms lie straight along ±X at shoulder height, legs are straight down and the figure faces +Z.
- **Extras**: `w = m.chain('tail', 'hips', [p0, p1, ..., tip])` adds `extra_tail_0..n-1`, each bone's head at a point, with the last point being the tip. It returns smooth weights (including the parent) to pass as the part's bone. The renderer springs these, stiffer at the root. Names are `[a-zA-Z0-9]+`, for example `earL` and not `ear_L`. Use 1 bone for ears, 2–3 for hair locks and scarves, and 3–5 for tails and capes.

### Joint helpers

- `humanoid(hip, spine, chest, neck, head, arm_y, shoulder, arm, elbow, wrist, leg, leg_y, knee, ankle, clav_y=None, grip=None, parents=None)`. Single numbers are Y heights or left-side X offsets. `grip` is the prop point, defaulting to just past the right wrist. Left-handed fighters (Link, Young Link) use `parents={'prop': 'hand_L'}`.
- `skeleton({bone: (x, y, z), ...}, parents=None)` covers any body plan. Every contract bone must be given, or it raises.
- `P(J, 'forearm_L')` returns a joint position as a Vector. `m.J` is the live joint map, including extras.

### Body plans (what the renderer does with each `style` in roster.ts)

The renderer (`src/scene/fighter`) chooses behaviour from the roster `style`:

- **humanoid** (plumber, pilot, brawler, sword, ninja, child, royal, climber, armored, alien, doctor, heavy, dinosaur, rodent, wire, bag): two-bone IK on all limbs, planted feet and aimed props. Put joints where the real joints are. Put knees and elbows **exactly** at the forearm/shin bone heads.
  - `rodent` (Pikachu, Pichu) is posed partly on all fours (`quad`). Still build the T-pose upright, with arms that reach the ground when rotated down.
  - `heavy` (DK, Bowser, Ganondorf, Giga Bowser): the stance is hunched forward. DK's arms are long, so place the wrist far out.
- **round** (Kirby, Jigglypuff): spine bends turn into a whole-body lean and squash. Put every bone inside the ball. Weight the ball with `m.spine((hips, spine, chest, neck, head), spans=[...])` so it deforms like a soft toy. Make arms and feet nubs. See `kirby.py`.
- **hand** (Master Hand, Crazy Hand): no limb IK. The **four chains upperarm→forearm→hand and thigh→shin→foot are fingers**, and each joint curls about model **X** by up to 55°.
  - Build the glove palm-down (palm facing −Y), fingers pointing **+Z**, knuckles in a row along X. A positive X rotation then folds the fingers down into a fist.
  - Master Hand is a right glove, so its thumb sits at +X. Crazy Hand is left, thumb at −X. Put the thumb on an `extra_thumb` chain. Place `shoulder_*` at the knuckle bases and `hips/spine/chest/neck/head` along the back of the hand.
  - The lowest vertex must sit at y=0 (it floats in game). Its height is the roster height, 1.95 m.
- **flat** (Mr. Game & Watch): the renderer squashes the model to **16% along X** and turns it side-on, so the camera sees its **profile (the Y–Z plane)**. Author a normal-proportioned solid black figure in T-pose; the squash makes it flat.
  - The silhouette **in profile** is what reads, so give him the big round nose, the belly and the pointed hair tuft from the side.
  - Portraits, renders and lineups apply the same squash and a side view automatically. The sheet shows the unsquashed model for QA.
  - Use `dark` for the body. `slab()` suits a flat Chef pan, Judge sign or bell.
- **wire** (the Wireframes): the renderer draws them translucent. Use `wire(bm, thick, tris)` for strut lattices over a decimated body. Combine `emissive` struts with a `dark` or `light` core so they read at TV distance.
- **bag** (Sandbag): a humanoid rig inside a sack. Arms are short nubs, legs are stubs, and the body is soft, so use `m.spine` or `m.env`.

### Props (the `prop` bone)

The prop bone sits at the **grip**. Author the prop in the T-pose with the handle through the fist. The renderer takes the **farthest prop-weighted vertex from the prop bone** as the blade or striking tip, and aims that direction during weapon poses. So the business end must be the far end: sword tip, hammer head, cannon muzzle. The direction is free. Fox's blaster points along the arm; Kirby's hammer points along +Z, out of the thumb side of the fist.

- Weight prop geometry to `'prop'` only.
- `Model(..., prop='always')` is for props always visible: swords, Samus's cannon, Ness's bat if you choose. `prop='move'` is for props only moves show (Fox's blaster, Mario's cape, Kirby's hammer); `render_sheet` hides these by scaling the bone to 0. `prop='none'` means no prop geometry.
  - **Known gap:** the game renderer does not hide `'move'` props yet (it does not read `assets/models/*.json`). It is flagged for fighter-render; until then keep move props compact and hand-hugging.
- Renderer grips: `sword` (Link, Young Link, Marth, Roy), `hammer` (Popo, Nana) and `cannon` (Samus). For Samus, the arm cannon *is* the right forearm and hand. Weight the cannon body to `forearm_R`/`hand_R` and put only a short muzzle on `prop`, or none.

## Materials and costumes

Materials are `primary secondary accent trim skin hair dark light metal emissive eye eye-white`, used by name only.

- `emissive` glows.
- `eye` and `eye-white` get no outline.
- `metal` gets a metallic finish.

Costumes recolor **by material**, so split materials by what Melee's alternates recolor, not by what looks the same in costume 0. Mario's shirt and cap are `primary` and his overalls `secondary`, so the Wario-yellow alternate swaps both. Two parts that always share a color can share a material.

- `Model(kind, J, COLORS, COSTUMES)` has these inputs:
  - `COLORS` is costume 0, the default look, as `{material: '#rrggbb'}`.
  - `COSTUMES` is exactly three `(name, {overrides})` Melee-inspired alternates, for example Mario's Wario Yellow, Black and Blue. Names must be unique.
- Only materials actually used are written to the costume JSON.
- There are no textures: every detail is geometry. Emblems, spots, blush, the M on the cap and belly patches use `stamp()`. Two-tone parts use `split_by()` plus a painter function `lambda c, n: 'light' if f(c) > 0 else 'skin'` as the material.

## The kit (common.py)

All geometry helpers return a `bmesh` in character space. `m.add(bm, material, bone, ...)` registers it.

| Helper | Use |
| --- | --- |
| `sphere(c, r or (rx,ry,rz), seg, rings, rot)` | Eyes, noses, buttons, pads |
| `rbox(c, size, bevel, rot)` | Bevelled boxes: buckles, armor, boots, the Hands' cuffs |
| `capsule(a, b, ra, rb)` | Limbs. Ends are hemispheres centered on a and b, so a limb put joint-to-joint rotates without gaps (a ball joint) |
| `lathe(a, b, [(d, r)...], sq, shape)` | Surfaces of revolution: boots, sleeves, cuffs, bells, lower legs |
| `cyl`, `torus(c, R, r, sq)` | Handles, belts, rings, bracelets |
| `tube(pts, radii)`, `strand(pts, r0, r1)`, `spike(a, b, tip, r)` | Tapered tubes and cones: hair locks, horns, claws, antennae, tails, piping |
| `ribbon(pts, widths, thick)`, `sheet(fn(u, v), nu, nv, thick)` | Straps, scarves, capes, skirts, brims, ears, wings |
| `slab(loops, depth, M)`, `ellipse(rx, ry)` | Flat outlines extruded: blades, emblems, G&W props, a shield face |
| `blob([...], tris, relax)` | **Metaball sculpting** of smooth organic unions: heads, torsos, muscles, paws, snouts, bellies. Elements are `('ball', c, r)`, `('ell', c, radii, rot)`, `('cap', a, b, r)` and `('box', c, half, round, rot)`, with an optional `{'stiff': 2..8, 'neg': True}`. `tris` decimates to a budget and `relax` smooths |
| `subd(bm, levels)` | Catmull-Clark: build a low-poly `rbox`/`lathe` cage, then subdivide for smooth hard-surface forms (armor, Samus's shoulders) |
| `layer(body, keep, inflate, thick)` + `trim(body, keep)` | **Garments**. `layer` copies the body outward, cut cleanly where `keep(p) > 0` (overalls, jacket, tunic, skirt, armor plates), then `trim` deletes the hidden body faces underneath, which saves triangles and stops z-fighting |
| `split_by(bm, f)`, `cut(bm, co, no, keep)` | Clean curved color borders, and plane cuts (flat soles, a cap edge) |
| `push`, `bend`, `xform`, `mirrored`, `merge`, `decimate`, `smooth`, `wire` | Shaping and utilities |
| `Surf(bm)`, `.hit(p, d)`, `.near(p)` | Ray/nearest queries to seat features on a sculpted part |
| `stamp(surf, c, loops, thick, d)` | Raised inlay that hugs a surface: emblems, mouths, blush, spots, sideburns, Kirby's eyes |
| `eye(m, surf, c, w, h, s, ...)` | Sculpted eye: white, iris, pupil, two highlights, optional lid (`lid=(cover, slant)` for determined or angry looks), lash line and brow (`brow=dict(lift, slant, thick, width, arch, mat)`) |
| `smile(m, surf, pts, r)` | Mouth line projected onto the face |
| `hand(m, s, S, wrist, u, mat, curl, fingers, thumb, fist, cuff)` | Cartoon hand or glove. `fingers=3` suits Pikachu, Yoshi and Bowser-style claws. Use `fist=True` for DK. Returns the grip point |
| `shoe(m, s, S, ankle, L, wd, ht, mat, sole_mat, toe, heel, up)` | Rounded shoe or boot with a flat sole at y=0 |
| `m.transform(pivot, scale, loc, rot)` | Context manager. Everything added inside is transformed, which lets you resize a finished head (Fox's is 1.1×), tilt a hat or reuse a builder |

### Weights

| Where | Use |
| --- | --- |
| Rigid parts (forearm, boot, helmet, sword) | One bone name. Make the joint covers **capsules centered on the joints**, so rotation never opens a gap |
| Continuous torsos | `m.spine(('hips', 'spine', 'chest'))`, with each joint's bend spread over the body |
| Soft bodies, blended limbs, paws | `m.env([bones], soft)`, the nearest segment with a soft blend across joints |
| Small attachments that must not warp (buttons, badges, a buckle on a bending torso) | `m.add(..., w, rigid=True)` |
| Extra chains | Weights from `m.chain(...)`. `chain_weights` and `blend((fnA, share), (fnB, share))` mix sources |
| Two-tone parts | Paint a material function **and** pass a weight function; they are independent |

Every vertex must end up weighted (the build asserts this). The validator rotates every joint ±60° on each axis (torso joints ±35°), plus the `TEST_ARMS`/`TEST_LEGS` poses, and fails any edge stretched past ×2.2.

### Budget

The limits are **20,000 triangles and 1.5 MB per GLB**. The three references use 8–20k and about 0.25–0.6 MB. The build log prints the heaviest parts by `tag=`, so spend triangles on the face and silhouette.

- `blob(..., tris=)` is your main dial.
- Mario's head, face and cap use about 7.5k triangles.
- Eyes cost about 1.7k a pair with lids, lashes and brows.
- A capsule limb with 16 segments uses about 300.

## Script template

```python
"""<Name> (Melee): the design notes you are matching."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'primary': '#...', 'skin': '#...', 'dark': '#231a1c', 'eye': '#...', 'eye-white': '#ffffff'}
COSTUMES = [('Red', {'primary': '#...'}), ('Blue', {...}), ('Green', {...})]
J = humanoid(hip=..., ...)                  # or skeleton({...})
HERO = {...}                                 # full-body render pose (below); optional HERO_VIEW, HERO_PROP=False
PORTRAIT = {'pose': {...}}                   # optional: pose, view, shoulders (0.45), fill (0.9), pad
# IDLE = {...}                               # optional override of common.IDLE for the costume row and lineups

def build():
    m = Model('<kind>', J, COLORS, COSTUMES, prop='always' | 'move' | 'none')
    ...                                       # m.add(...) parts
    return m

main(globals())
```

**Pose specs** (for `HERO`, `PORTRAIT['pose']` and `IDLE`) are `{bone: (x, y, z) degrees}` in character space, relative to the parent. With identity rests this is exact.

- `'sym': {'upperarm': r}` fills both sides mirrored.
- `'root_loc': (x, y, z)` lifts or shifts the body.
- For the left arm, `(0, 0, -60)` lowers it toward the body, and `(0, -60, 0)` swings it forward.
- The right side mirrors: y and z are negated.
- The hero view looks at the fighter's front-left, so the fighter faces screen-right.
- Poses are applied only in the render scene. The GLB stays in T-pose.

## Quality loop (mandatory, per fighter)

1. Gather references for the Melee-era design: the silhouette, proportions, costume layers, signature props and the four alternates.
2. Build, then render the sheet. **Open `output/sky-clash-v2/models/<kind>-sheet.png` and look at it.**
   - Row 1: front, side, 3/4 (move props visible), back, arms at 60° and legs/spine at 60°.
   - Row 2: face front, face 3/4 and face profile, then the four costumes.
3. Fix, rebuild and re-render until every item below holds. Then run `validate.py` and render the portrait and render. Look at both.

**Checklist**

- [ ] Instantly recognizable from the silhouette alone. Proportions match the character, not a shared body: head-to-body ratio, limb length, hands and feet size.
- [ ] The face reads at TV distance: sculpted eyes with iris and highlights, brows, nose and mouth. No floating or sunken features, and no dark gashes from features seated too deep.
- [ ] Signature details are present and layered (collars, belts, cuffs, emblems, buckles, hair clumps). Nothing important is only a color change.
- [ ] Forms are smooth: no metaball lumps, facets or z-fighting. `relax` and `tris` are balanced, and garments are trimmed underneath.
- [ ] Deformation at 60° looks clean: no stretched skin, no gaps at elbows, knees, shoulders or hips, and extras bend sensibly.
- [ ] The four costumes are Melee-inspired, distinct and legible, with no material left unrecolored where it should change.
- [ ] The prop sits in the fist with its business end farthest from the grip. `prop` is set correctly to always, move or none.
- [ ] `validate.py` reports OK, and the portrait and render are framed and posed with character.

## Validation (validate.py)

The validator reads the GLB bytes with no Blender state involved. It checks:

- the contract bones, their parents and identity rests, and extra chain names;
- a single skin with at most 4 influences, and every vertex weighted to a sum of 1;
- feet at y=0 and the head top within 3% of the roster height;
- `hand_L` at +X and the eyes on the +Z side;
- triangles and bytes within budget;
- materials from `MATERIALS` only, with no images, textures or animations;
- that the costume JSON has exactly four unique costumes keyed by the GLB's materials, with costume 0 equal to the GLB colors;
- that the model JSON agrees with the GLB;
- the skinning stretch sweep.

It prints `OK` or `FAIL` per fighter and writes `<kind>-validate.json`.
