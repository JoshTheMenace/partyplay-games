# Kitchen Rush — design (v2 rebuild)

A cooperative, chaotic cooking game for 1–10 chefs: one shared 3D display, landscape phone controllers, or a solo host playing on one device. Hand-authored tile kitchens, carried pots and pans, spreading fires, dish stacks, throwing, and level gimmicks. Everyone shares one score and stars.

The contract lives in `src/model.ts` (types, map legend, recipes, timing constants) and `src/levels.ts` (level data, `kitchenMap`, `starThresholds`, `crewScale`). Read both before editing anything. Kitchen maps are **derived**, never sent: every screen calls `kitchenMap(settings.level, players.length)`.

## Feel targets

- **Snappy, physical movement.** Acceleration to 4.4 m/s in ~0.1 s, quick stop. Dash is an impulse (11 m/s, decays over 0.18 s, 0.55 s cooldown) and can be spammed rhythmically. Chefs bump and push each other softly (circle separation) — never deadlock, never pass through (disconnected chefs are the exception: see Presence).
- **Obvious targeting.** A chef uses the tile directly in front of them (probe point 0.75 m along facing). If that tile is not usable, fall back to the best orthogonally/diagonally adjacent usable tile within a 70° cone. The display highlights the target tile in the chef's colour; the phone names it.
- **Low-friction controls.** Three buttons: **Grab** (pick up / put down / combine), **Chop·Throw** (context), **Dash**. Chopping and washing *start with one tap and continue automatically* while the chef stays within reach and does not walk away (moving input > 0.35 or leaving the tile cancels; progress is kept on the tile).
- **Readable chaos.** Every meaningful change emits a `GameEvent` so the display can play particles and sound and the phone can buzz.

## Controls and input

`Input = {x, y, act, cmd, seq}`. Movement is held state. `cmd` is one queued command ('grab' | 'act' | 'dash') with a monotonic `seq`; the server applies it once when `seq > chef.seq`, then sets `chef.seq = seq` (the acknowledgement). The phone keeps a ≤4-entry queue and resends the oldest unacknowledged command. Reconnect starts above `chef.seq`. `act` (held) sprays an extinguisher.

Keyboard (focusable controller / personal view): WASD/arrows move, **Space or J** grab, **K or E** chop/throw, **Shift or L** dash. Keys pressed while a shell control (outside `.kr-play`) has focus belong to the shell, but releasing a held game key anywhere ends its hold; window blur or a hidden tab releases everything.

## Rules

### Interaction table (Grab)

| Holding | Target | Result |
| --- | --- | --- |
| nothing | crate | new raw ingredient |
| nothing | rack with plates | one clean plate (`count--`) |
| nothing | return with plates | the whole dirty stack (`dirty` item, `count`) |
| nothing | surface with item | pick it up (chop/wash progress belongs to the tile and resets when its item leaves) |
| nothing | loose item within 0.8 m (closer than target tile) | pick it up |
| item | empty surface | put it down (board only accepts food; sink only accepts dirty stacks; oven only accepts a plate containing raw dough, or an empty tile otherwise refuses) |
| food | plate / pot / pan on a tile | add if accepted |
| plate | food on a tile | add food onto the held plate |
| plate | cooked pot/pan on a tile | pour contents onto the plate (only when finished and not burnt) |
| pot/pan (cooked) | plate on a tile | pour onto that plate |
| clean empty plate | rack | return it to the stack |
| any food / container | bin | food is destroyed; containers are emptied (plates keep, pots/pans keep) |
| plate matching an order | serving hatch | serve (see scoring) |
| anything | fire tile | refuse: "Put it out first!" (an empty hand may still take an extinguisher off it) |

Acceptance: a pot takes chopped tomato/onion up to 3; a pan takes 1 chopped patty. Adding to a cooking pot scales its cook progress by `(n-1)/n` so a late ingredient needs more time. Plates take up to 4 non-burnt parts; burnt food is never plated. Raw bun, raw dough and chopped/cooked foods may go on plates.

### Chop · Throw (act)

1. Target is a board holding a raw choppable food → start chopping (auto-continue). Done: part becomes `chopped`, `chop` event, `stats.chopped++`.
2. Target is a sink holding a dirty stack → start washing. Every `WASH_SECONDS` one plate moves to the sink's nearest rack (`wash` event, `stats.washed++`); the stack disappears when empty.
3. Holding an extinguisher → spray (also while `act` is held): fires in a 2-tile cone ahead lose `1/EXTINGUISH_SECONDS` intensity per second; reaching 0 → `extinguish` event, `stats.extinguished++`.
4. Holding a single food item → throw it along facing at `THROW_SPEED` with an arc of `THROW_SECONDS`. Plates, pots, pans, dirty stacks and extinguishers cannot be thrown (feedback note).
5. Otherwise a short helpful note.

Thrown food: caught by an empty-handed chef it passes within 0.5 m of (`catch`), dropped into a pot/pan/plate it lands on if accepted, placed on an empty surface it lands on, otherwise rests at the last walkable floor point it flew over. Food landing in void or the bin is lost (`splash`). Items passing over a portal teleport to its pair.

### Cooking, burning and fire

Pots and pans cook only while on a stove, ovens bake a plate inside them; heat is kept when lifted. At `cookSeconds(kind)` contents become `cooked` (`done` event). At `+BURN_WARN` emit `warn`; at `+BURN_AT` contents become `burnt` (`burn`), and the station ignites (`fire`, intensity 1). Fire spreads to one random orthogonally adjacent FLAMMABLE tile every `FIRE_SPREAD_SECONDS`. Burning tiles cannot be used; items on them are safe but locked, except an extinguisher, so fire spreading onto it never locks it away. Burnt contents go in the bin. Relaxed mode disables burning and fire.

### Plates

Initial clean stack on racks: `players + 3` (small maps) split between racks. Serving consumes the plate; it returns after `RETURN_SECONDS` onto the nearest `return` tile as a dirty plate (`count++`). Maps without a sink return plates **clean** to a rack instead. Plates are never destroyed; plates lost to void re-enter as returns.

### Orders and scoring

- Open with 2 orders (3 for 5+ chefs), then add one every `level.patience / 2.6 / crewScale(players)` seconds (authored patience, not the roster-adjusted one), up to a cap of 4 (small) / 6 (large). Whenever fewer than the opening count are open, the next arrives within 2.5 s, so the rail never runs dry for a fast crew. Recipes are drawn from `level.recipes` with a seeded RNG, never more than 2 identical open orders, introducing each recipe once early.
- Patience: `level.patience` × (1.5 solo, 1.25 for 2, 1 for 3+). Relaxed mode: orders never expire.
- Serving: earn `recipe.value + tip`. Tip = `round(8 × remainingFraction) × multiplier`, multiplier = current combo (1–4). Each serve raises the combo by 1 (max 4); serving fulfils the oldest open order of that recipe. An order expiring: −5 points (floor 0), combo resets to 1, `expire` event. Wrong dish at hatch: refused with `wrong` event, item stays in hand.
- Stars by `starThresholds(level, players, seconds)`: the level's two-chef targets × a measured roster curve (`starScale`, capped by `level.crowd` on kitchens that jam) × seconds/180; a `star` event fires on each new star.

### Gimmicks

- **Conveyors** (`> < ^ v`): every `BELT_SECONDS` each belt pushes its item to the next tile in its direction if that tile is an empty surface (belts resolve from the front of a chain backward). Belts only move items between surfaces; a blocked belt waits.
- **Ice** (`*`): acceleration `ICE_ACCEL`, drag `ICE_DRAG` — chefs slide.
- **Drawbridges** (`g` + `level.gates`): open for `open` s, warning `warn` s before closing, closed `closed` s. A chef standing on a gate when it closes falls (`fall`), their held item drops into the gap (food lost; containers/plates go home), and they respawn at a free spawn after `RESPAWN_SECONDS` (`respawn`). Gate state is in `View.gatesOpen/gateWarning`.
- **Portals** (`T`): a chef stepping onto a portal centre appears on its pair (1 s per-chef cooldown, keeps momentum), `portal` event. Thrown food teleports too.
- Void (`~`) is never walkable; chefs are blocked at its edge (except gates closing under them).

### Small rules (as built)

Dash has a 150 ms press buffer. Unsprayed fire regrows at 0.2/s. A held plate at a bun or dough crate adds that raw ingredient; a held pot or pan scoops chopped food off a counter. Dirty stacks merge. Large maps also start with `players + 3` plates. `cooked` counts pours and lifting a baked pizza out; `burnt` goes to the chef who put the item on the heater.

### Presence

Disconnected chefs freeze in place as ghosts that other chefs walk through (a dropped phone never blocks a walkway or portal) and drop whatever they hold onto the floor where anyone can pick it up; reconnect restores the same chef. Never delete seats. Held input is released by the shell on disconnect.

## Presentation

- **Display:** full-bleed 3D scene; HUD overlays: order rail (top-left, cards show dish icon, ingredient icons with process badges, a draining patience bar that turns amber/red and shakes when urgent), timer (top-right, pulses in last 30 s), coin score + combo multiplier + star progress (bottom-left), gate/fire banners. Chef nameplates (number + name in team colour) above heads. Floating “+45” coin popups at the hatch, recipe-complete sparkles, fire, smoke, steam, chop flecks, water splashes, dash dust puffs, throw arcs with a shadow, landing thumps.
- **Camera:** perspective (~34° FOV), tilted ~58° down, auto-fit so the kitchen (front slab edge, worktops, back-row gauges) fills the view between the HUD bands; the back wall and scenery may crop under the HUD. The scene reads `--kr-hud-top/-bottom` (capped at 30% of the height) and `--kr-hud-left/-right` (capped at 35% of the width, centred with a lens shift) from its canvas, and refits whenever the canvas or a band changes. Chefs are drawn 1.18× (collision unchanged); the sun's shadow map renders once and chefs use blob shadows. Gentle shake on fire/fall and a small push-in on serve (disabled under reduced motion). Event effects skip events older than 1.5 s, so a display tab returning from hidden does not replay a backlog; after a snapshot stall the scene draws the frame the buffer returns. Each round disposes three's shared Sprite geometry and DFG lookup texture, so ended rounds do not keep their renderer and canvas alive.
- **Phone (landscape):** left SteerPad; right cluster: large **Grab** at the resting thumb, **Chop/Throw** above-left of it (label changes: Chop / Wash / Spray / Throw), **Dash** smaller. Centre strip: what you hold (icon + label), target tile name and its progress, first two orders compact, timer and score. Haptic `navigator.vibrate` on catch/serve/fire (guarded). Reduced motion respected.
- **Solo (PersonalView):** scene plus the same controls overlaid; keyboard works.
- **Results:** stars fly in, score, served/failed, recipe tally, per-chef awards (Knife master = most chopped, Dish hero = most washed, Firefighter, Pitcher = most thrown, Safe hands = most caught, Sauce boss = most cooked, Speedy = most dashes, Butterfingers = most falls, Star server = most served; big crews then get runner-up titles such as Prep cook or Runner, and only chefs with no stats get Moral support) — every chef gets one award.
- **Settings:** level cards with stars (browser-saved under `party.kitchen-rush.campaign.v2`), service length 2.5/3/4 min, Relaxed toggle (no burning, no expiry; no stars saved).

## Model naming contract (Blender kit → scene)

GLB: `public/games/kitchen-rush/models/kitchen-kit.glb`, metres, Y up, each asset a top-level object rooted at its own origin. The scene tints only the materials named `Floor`, `Wall` and `CrateLabel`; others keep their vertex colours. Tile assets fill a 1×1 m footprint centred on the origin, floor at y=0, **work surface top at y=0.9** (`COUNTER_HEIGHT`). Items sit with their base at y=0 so the scene places them on surfaces or in hands.

| Object name | Notes |
| --- | --- |
| `counter` | plain worktop cabinet |
| `board` | counter with chopping board + knife |
| `stove` | counter with burner (object `stove_flame` child optional) |
| `oven` | brick dome oven with an opening facing +Z; stone hearth at y 0.5, mouth centred at z +0.3 |
| `sink` | counter with basin and tap |
| `rack` | counter with plate-rack frame (scene stacks `plate` instances) |
| `return` | counter with a hatch/tray for dirty plates |
| `serve` | serving hatch with bell and a sign |
| `bin` | pedal bin |
| `crate` | open wooden crate (scene puts ingredient models inside) |
| `belt` | conveyor counter; child `belt_surface` ribs are replaced by the scene's scrolling strip at y 0.922 (keep the belt body top below ~0.92); oriented to move +X |
| `wall`, `floor_tile`, `ice_tile`, `gate_plank`, `portal_pad` | environment |
| `pot`, `pan`, `plate`, `plate_dirty`, `extinguisher` | items |
| `soup_tomato`, `soup_onion`, `soup_mixed` | liquid disc for pots/bowls |
| `<ingredient>_<state>` | every ingredient × raw/chopped/cooked where meaningful (tomato_cooked, onion_cooked, patty_cooked, dough_cooked), plus `burnt` (generic charred lump) |
| `dish_<recipeId>` | finished plated dish shown when a plate matches a recipe (without the plate) |
| `chef_body` etc. | human chefs `chef` and `chef_f` as hierarchies with named pivots `Head`, `ArmL`, `ArmR`, `LegL`, `LegR`, `Body`; team-colour material named `TeamColor` |
| `prop_*` | theme decoration |

Animal chefs (cat, dog, iguana, axolotl) keep the contributor meshes in `models/kitchen-rush.glb` (see `art/extract_characters.py`, credit Aaron Hendricks). Icons: `public/games/kitchen-rush/icons/{food_<ing>_<state>, dish_<recipe>, item_plate, item_plate_dirty, item_pot, item_pan, item_extinguisher, character_<id>}.png`, 256×256 transparent. The scene must degrade to simple primitives for any missing object so art and code can land independently.

## File ownership (v2 build)

| Owner | Files |
| --- | --- |
| Coordinator | `src/model.ts`, `src/manifest.ts`, `DESIGN.md` (contract; changes are additive and announced) |
| Levels | `src/levels.ts`, `tests/levels.test.ts` |
| Rules | `src/server.ts`, `src/orders.ts`, `tests/rules.test.ts` |
| Art | `art/**`, `public/games/kitchen-rush/models/**`, `public/games/kitchen-rush/icons/**`, `tests/models.test.ts`, `tests/assets.test.ts` |
| Scene | `src/scene.tsx`, `src/scene/**`, `src/models.ts`, `src/assets.ts`, `src/preferences.ts`, `tests/preferences.test.ts`, `tests/scene*.test.ts` |
| Client | `src/client.tsx`, `src/controller.tsx`, `src/hud.tsx`, `src/cook-lobby.tsx`, `src/style.css`, `src/picker.css`, `src/audio.ts`, `src/campaign.ts`, `src/presentation.ts`, `src/asset-url.ts`, `tests/campaign.test.ts`, `tests/audio.test.ts`, `tests/polish.test.ts`, `README.md` |
