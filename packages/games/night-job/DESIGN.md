# Night Job v2 design

A cooperative top-down heist for phone controllers and one shared TV: one crew of one to four thieves, or a whole room of up to 64 split into rival crews (see Crew nights). Inspired by Monaco (2013); all code, maps, models, names and sounds are original. This document is the contract between the simulation, levels, renderer, assets and UI. `src/model.ts` holds the exact types and tuning constants.

## Pillars

1. **Sight is the game.** The TV shows the whole building as a navy blueprint. Around each thief, a smooth raycast sight polygon reveals the warmly lit 3D room: furniture, loot and any guard standing there. Walls and closed doors cast hard shadows. Guards outside crew sight do not exist on the client.
2. **Getting spotted is a problem to solve, not a loss.** Guards escalate (? → !), radio friends, and shoot with a visible 0.7 s aim telegraph that you can dodge by breaking line of sight. Doors, smoke, hiding spots, vents and teammates let you recover.
3. **One stick does almost everything.** Push into a door, safe, terminal, window, vent, bush, fallen friend or the objective to work on it. A light push sneaks (silent, slow); a full push runs (fast, leaves visible noise rings guards hear). One Tool button. Hold Sneak to force quiet movement.
4. **Loot is fuel.** Every 10 coins a thief personally collects refills one tool charge. Missed loot costs time on the final board, so greedy detours and fast exits are both valid.
5. **Specialists open routes, never gate them.** Every mission is completable by any single role.

## World

- Units are tiles. `x` grows right, `y` grows down. 3D uses `X = x`, `Z = y`, `Y` up. Wall height 1.6.
- Maps are authored as ASCII grids (≤ 48×32) plus room rectangles, props and a legend. See `src/level.ts` (parser, shared) and `src/maps/*.ts` (public layouts).
- Guard, dog and civilian placement, patrols and reinforcements are server-only in `src/server-levels/*.ts`. Client code must never import them.

### Tile legend (public)

| Char | Meaning | Solid | Blocks sight |
| --- | --- | --- | --- |
| `#` | wall | yes | yes |
| `%` | cracked wall (Breacher digs to floor) | yes | yes |
| `=` | glass (shotgun shatters to floor) | yes | no |
| `~` | water | yes | no |
| ` ` | void outside the map | yes | yes |
| `.` | indoor floor | no | no |
| `,` | outdoor ground | no | no |
| `d` | door (opens when pushed, closes after 2.5 s clear) | when closed | when closed |
| `L` | locked door (pick first; then behaves like `d`) | when closed | when closed |
| `w` | window (climb through, 1 s) | yes | no |
| `$` | floor with one coin | no | no |
| `P` | player spawn (floor) | no | no |
| `E` | exit zone centre (floor, zone radius 1.8) | no | no |
| `O` | objective (solid pedestal) | yes | no |
| `S` | safe (solid, 8 coins) | yes | no |
| `+` | medkit (floor) | no | no |
| `H` | hiding spot (floor; bush or closet) | no | no |
| any other letter | object from the map's `legend` (terminal, camera, laser, vent, …) | per kind | no |

Props (`[kind, x, y, w, h, rotation]`) occupy whole cells. Solid props block movement and pathing but never sight.

## Crew

- Health 100. Run 3.4 tiles/s, sneak 1.6 tiles/s (stick magnitude < 0.6 or Sneak held). Carrying the objective: ×0.85.
- Running emits a noise ring (radius 3) every 0.4 s. Sneaking is silent.
- Crew sight: 360°, radius 10, blocked by opaque cells, closed doors and smoke.
- Pushing into an interactable within 0.9 tiles starts work; moving away pauses it. Progress is stored per target, so a teammate can finish it. Durations are in `WORK` in model.ts.
- Sneak into a hiding spot to hide; push hard, or release and push again, to slip out.
- 0 health → downed. A teammate pushes into you for 2.5 s to revive (Face 1 s), back at 50 health. Everyone downed → job failed. A lone thief gets one second wind per heist: back up at 30 health 6 s after going down, once no guard or dog watches or stands within 2.5 tiles (still watched after 20 s → job failed).
- Heists hold the getaway or bust on screen for 3.5 s before results (`OUTRO_MS`): time for the crew to pile into the van and drive off. The TV may take up to 45 s to prepare its scene before the common start (`prepareTimeoutMs`).
- The objective is carried. A downed carrier drops it; anyone can pick it up again (0.5 s).
- Escape: objective carried, every non-suspended thief alive inside the exit zone.
- Disconnect: body stays for 15 s, then suspended (excluded from escape, drops objective). All disconnected → clock pauses (one crew only; a crew night never pauses).

## Crew nights (more than four players)

A building is balanced for four thieves: more bodies in one building means more guards noticing more people, and stealth turns into a brawl. So the cap is the room's (64, `MAX_ROOM_PLAYERS`), but a crew never holds more than four.

- **1–4 players:** one crew, the classic game. Nothing below applies.
- **5–64 players:** `crewSizes(players)` deals the room, in seat order, into `ceil(players / 4)` crews of two to four, sizes within one of each other: 5 → 3 + 2, 9 → 3 + 3 + 3, 32 → 8 × 4, 64 → 16 × 4. Crews are named and coloured from `CREWS` (Foxes, Moths, Otters, …); a crew is always shown with its name, never by colour alone. Seat numbers stay room-wide.
- **Each crew robs its own copy of the mission.** `sim/night.ts` holds one `State` per crew (`Night.heists`): its own guards, doors, loot, alarm and clock. Crews never meet. Each copy has its own seed and a wider first pause on every patrol, so one building's guards say nothing about another's.
- **The race.** The fastest clean getaway takes the night. When the first crew is away, the rest have `NIGHT.lastCall` (120 s) until sunrise; nobody away, the night ends at `NIGHT.cap` (600 s). At sunrise every crew still inside is out. The board (`standings`) ranks crews that got away by adjusted time, then crews holding the goods, then by loot; ties share a place. `Outcome.winners` are the first-placed crew if it got away.
- **No bust on a crew night.** A wiped crew would sit out the rest of the night, so instead the van hauls it out: `NIGHT.bailAfter` (4 s) after the last thief drops, everyone is back on their feet at the start with 60 health, guards return to patrol, the alarm stops, the goods stay where they fell, and the crew's adjusted time grows by `NIGHT.bailPenalty` (30 s). One standing thief (or a revive in time) cancels it.
- **Leaving.** A crew night never pauses. A crew whose phones are all gone for 15 s is out of the night and no longer holds it up.
- **Screens.** The TV is a broadcast: it shows one crew at a time in full, with a board of every crew, and a director cuts between them (`direct` in night.ts: at least 5 s on a crew, at most 12 s while others wait, at once to a getaway, sooner to a chase, an alarm or the goods). The phones carry the map: each phone draws its own crew's floor plan around its thief (`src/tactical.ts`). See Presentation and Networking.

What gives out first beyond this: nothing in the rules (sixteen crews tick in about 4 ms; the server used a third of one core in a 64-seat room), and the room ends at 64. One TV gives each of sixteen crews a sixteenth of the broadcast, which is why the phones do not depend on it.

### Specialists (role ids are stable)

| id | name | ability |
| --- | --- | --- |
| cracker | Cracker | Locks, safes and objective 3× faster. |
| scout | Scout | While still or sneaking, senses guards through walls within 12 tiles (markers with facing). |
| magpie | Magpie | A bird companion collects coins within 3.5 tiles. |
| ghost | Ghost | Walk into an unaware guard or civilian to knock them out silently (25 s). |
| breacher | Breacher | Digs through cracked walls (1.5 s, noisy). Pushes locked doors open by force in 1.2 s (noisy). |
| impostor | Impostor | Disguised: guards detect at 15% rate unless you run within 2 tiles. Lost on tool use or when chased; returns after 6 s unseen. |
| wire | Wire | Hacks terminals 3× faster; circuits stay off twice as long. Senses cameras and lasers through walls. |
| face | Face | Charms the nearest unaware guard within 2.5 tiles for 20 s (10 s cooldown): it follows and ignores the crew. Revives in 1 s. |

### Tools (2 charges at start, +1 per 10 personal coins, max 9)

| id | effect |
| --- | --- |
| smoke | Cloud radius 2.5 for 8 s at your feet. Blocks all sight; guards inside lose their target. |
| tranq | Silent dart in facing direction, soft auto-aim ±25° to the nearest visible NPC within 9: knockout 20 s. |
| shotgun | 60° cone, range 4.5: knockout 12 s, shatters glass. Loud (noise radius 14). |
| emp | Disables every circuit device within 10 tiles for 12 s and silences guard radios nearby. |
| medkit | Heals you and teammates within 2.5 by 60 and revives the downed. |
| decoy | Throws a noisemaker up to 5 tiles ahead (stops at walls); after 0.6 s it makes noise radius 8. |

## Security

- **Guards** patrol waypoint loops with seeded pauses and glances. Vision cone 100° × 7 tiles plus a 1.2-tile all-round near sense. A suspicion meter fills faster when close, when the thief runs, and during an alarm; sneaking halves it. Full meter → `chase`; noticing never takes less than about 0.55 s, so the `?` always reads. States: `patrol → suspicious → chase → search → patrol`, plus `investigate` (heard noise/radio), `stunned`, `charmed`.
- Chasing guards run (3.1 tiles/s), radio every guard within 10 tiles to investigate, and shoot: with line of sight within 6.5 tiles they aim for 0.7 s (visible red line), then fire for 34 damage only if sight still holds. Only one guard aims at a thief at a time, and a thief is shot or bitten at most once per 1.3 s. Glass and windows stop one bullet or dart and shatter. A target unseen for 3 s, or unreachable, turns the chase into a search.
- Lost target → search around the last known point for 8 s, then return to patrol.
- Guards open unlocked doors and hear running, breaking, shotguns and decoys.
- **Dogs** run fast, cannot open doors, smell hidden thieves within 1.6 tiles, bite for 25 on contact.
- **Civilians** wander. On spotting a thief they panic: scream (noise radius 6) and run to the nearest guard, who investigates.
- **Cameras** sweep ±40° around their facing (period 6 s), 6-tile range. 0.8 s of seeing a thief raises the alarm at that spot. **Lasers** are beams from their emitter until a wall; crossing one raises the alarm. Both belong to named circuits that terminals (and EMP) switch off.
- **Alarm** lasts 15 s (refreshed by new triggers). Every guard investigates the alarm spot; suspicion fills 1.5× as fast.
- **Reinforcements** (optional per map): after the objective is taken, a server-defined sweep squad enters from a staff door.
- Hiding: a hidden thief is invisible unless a guard saw them enter (that guard will pull them out) or a dog smells them.

## Scoring

Adjusted time = elapsed seconds + 3 s per missed coin (+ 30 s per bail-out on a crew night; `scoreSeconds`). Each map has par times for 1–3 stars (clear required). Results also show personal stats and playful awards (Most Wanted, Light Fingers, Guardian Angel, Silent Partner). A crew night's results rank every crew with its time, stars, loot and thieves, and hand the awards out across the whole room.

## Presentation

- **TV**: Three.js scene through `SceneView`. Perspective camera looking down with a slight tilt, framing every active thief (min ~14 tiles tall, max the whole map), smoothly damped. Unseen space is a navy blueprint (fragment shader samples a visibility texture built from crew sight polygons). Seen space is lit: floor textures, soft light pools, a shadow under every solid prop, glowing lamps, low-poly props from the Blender kit, guard flashlight cones clipped by walls, smoke, noise rings, coin sparkles, aim lines, alarm pulse. The sight polygons carry brightness (full around a thief, `RIM_LIGHT` at the edge of sight), so a lit room is brightest and warmest where the crew stands and cools toward the blueprint. A 2D overlay canvas draws seat badges, names, progress rings, ?/! icons and floating text. React HUD: objective, clock, loot, alarm banner, crew cards, a soft vignette.
- **Characters**: every figure wears an ink outline and a little of its own light so it reads on any floor. They lean into a run, breathe at rest, flop with a bounce when knocked down and jump back up when revived; a guard hops when a chase starts and a bystander when the panic does. A taken coin hops and shrinks; a cracked safe swings its door open and shows its gold for a moment.
- **Endings**: on a clean getaway the crew jumps into the vehicle parked by the exit (the van, or the boat on Last Ferry; `World.ride`) and it pulls away down the street. A bust washes the screen in alternating red and blue.
- **TV on a crew night (broadcast)**: the same scene shows the crew the director picked. The top-left plate reads LIVE with the crew's name in its colour; the clock is the countdown to sunrise; a board on the right lists every crew in standing order (place, name, who is standing, what it is up to, loot) and marks the one on screen; the latest headline (first away, alarm, the goods, a bail-out) sits in the top bar. Above eight crews a board row is one line with a shorter status, so sixteen rows fit a 720p screen with every crew's name whole. A cut is a hard cut: actors, fog and camera snap to the new crew, and loot or safes that crew already took show as taken without replaying their animation. The board reports its width (`--nj-hud-right`) and the lens frames the crew in what is left.
- **Phone, one crew (classic)**: landscape controller. Left: analog stick with an inner sneak ring. Right: large Tool button, smaller Sneak hold. Middle: seat, role, health, charges, coins-to-next-charge and the server's contextual hint. Vibrates on damage and when spotted where supported.
- **Phone on a crew night**: the TV is a broadcast, so the phone draws its own crew's floor plan in 2D (`tactical.ts`, canvas only: phones still never load three.js). It follows this seat's thief. Unseen rooms are the blueprint; what the crew sees is drawn lit, cut off by walls and closed doors and fading at the edge of sight. It shows doors, loot, safes, terminals, cameras and beams, guards with their cones and ?/! gauges, aim lines, smoke, noise rings, work rings and floating words. Arrows at the screen edge point to the goods, the getaway and teammates who are off screen; your own thief wears a second ring and a marker. The same stick, Sneak and Tool float over the picture, with a bar for crew, seat, health, charges, place and the sunrise clock, and the hint at the bottom. Once the crew is away (or out) the phone shows its place and the live board.
- **Lobby**: phones pick a specialist and a tool; the TV shows the briefing, the blueprint and the crew. Above four players the TV groups everyone into their crews and each phone is told which crew it is in and with whom.
- **Results**: stars, the adjusted-time sum and awards for one crew. A crew night ranks every crew (place, stars, adjusted time and how it adds up, loot, thieves and awards); a phone lists its own crew first and adds its own stats.
- Reduced motion removes camera shake and decorative loops, keeps state cues.

## Networking

`src/wire.ts` is the wire form. The server projects one `View` per crew (`sim/view.ts`: only what that crew could know) and packs it (`pack` → `Live`: positions to the centimetre, states and kinds as indices, flags as bits, the coin bitstring as hex, only objects that are not in their resting state, times as offsets from the crew clock). Every screen unpacks back to a `View` (`unpack`, `decode`, `ownView`), so the HUD, renderers, audio and tests work on `View`.

- **Public** (`Wire`, every socket): `base` (mission, difficulty and the roster in seat order: id, name, colour, role, tool) and `final` (per-seat stats and who left, attached when the night is over) ride once per socket through the manifest's `snapshotCache` (`rev` 1 → 2). Every snapshot carries the night clock and sunrise time, the board (seven numbers a crew, no positions), up to four recent headlines, which crew is on the shared screen (`cast`) and that crew's `Live`.
- **Private** (`Own`, per seat): the seat's own hint, and its own crew's `Live` unless that crew is the one on the shared screen (then the public snapshot already carries it and `live` is null). With one crew that is always the case.
- **Who may see what.** A crew's `View` holds only the guards in that crew's sight, doors as it last saw them, noises it made or saw, and its own Scout/Wire intel. A phone is sent its own crew's view and the view of the crew on the TV (which the whole room is watching anyway), and nothing else about any crew but the board. Guards outside both crews' sight never leave the server. `tests/night.test.ts` checks this at two crews and at sixteen.
- Measured (`tools/night-sim.ts`, `tests`, real rooms with socket bots): a snapshot is about 1.1–1.5 KiB public plus 0.7 KiB private at 32 and 64 thieves (the old four-player public view was up to 7.6 KiB), so a phone receives roughly 12–20 KiB/s with one crew and 35–50 KiB/s in a full room at 20 Hz. The simulation costs about 0.3 ms a tick for one crew, 1.5–2 ms at 32 thieves and 2.5–6 ms at 64. While results are up the platform repeats its `outcome` (a row per player) with every snapshot, about 120 KiB/s at 32 and 200 KiB/s at 64 until the host moves on; the row labels are kept short for that reason, and the rest is the platform's to change.

`View.doors` holds door states as the crew last saw them, so unseen guards opening doors reveal nothing. `View.message` clears after 7 s. `Effect.player` names the thief an effect concerns (phones vibrate on it). Wire senses lasers as Intel kind `laser`. All `at`/`until`/`born` fields and `cameraAngle` use the game clock `View.now`, which stops while every thief is disconnected; animate from interpolated `view.now`, not raw server time. `View.objects` covers every object except the exit, windows and unlocked doors: safes/medkits become `empty`, a terminal is `used` while its circuit is off, cameras/lasers are `disabled` until `until` (a camera's `progress` is its detection meter), the objective is `empty` once taken, and a picked locked door is `open`. Laser beams pass glass and stop at the first opaque cell. Vehicles (car, van, boat) are modelled with their long axis on +X. Guards and civilians reuse `thief_leg`.

30 Hz simulation, 20 Hz snapshots. Static layout lives in the client map module; the view carries only dynamic state.

## Shell layering

The shell mounts `SceneView` in `.kp-scene-surface` (full stage) and `DisplayView` in `.kp-scene-overlay` above it. The HUD sets `--nj-hud-top`, `--nj-hud-bottom` and, with a crew night's board, `--nj-hud-right` (px) on the closest `.kp-scene-stage`; the renderer reads them and frames the crew inside the uncovered part. The canvas always fills the stage.

## Tools

- `dev/` is a sandbox that never ships: the real rules, crew bots and every screen in one page with no room server (`dev/sandbox.tsx` lists its parameters; `dev/scenes.ts` stages fixed moments for before-and-after screenshots).
- `tools/bot.ts` is a thief that plays from its crew's `View` alone: it routes around beams, times cameras, darts guards, revives, loots and gets away. `tools/room-bot.ts` plugs it into the platform's socket-bot harness; `tools/night-sim.ts` runs whole nights headlessly and prints completion, tick cost and bytes.

## Asset kit contract

`art/build-kit.py` (Blender, run headless) writes `public/games/night-job/models/night-job-kit.glb` (≤ 1.5 MB, served at `${assetBase}models/night-job-kit.glb`). 1 unit = 1 tile, Y up, flat-shaded low poly, one material per mesh using vertex colours (no textures). Every mesh is a top-level node named exactly as below, origin at the centre of its footprint on the floor (y = 0), front facing +Z. The renderer falls back to simple procedural shapes for any missing name.

- Props `prop_<PropKind>` for every `PropKind` in model.ts. Canonical footprint 1×1 except: car 2×1, van 2×2, boat 3×2, bed 1×2, sofa 2×1, bench 2×1, piano 2×1, roulette 2×2, cards 2×1, fountain 2×2, container 3×1, desk 2×1, table 1×1. Tileable kinds (repeated once per cell by the renderer): bar, counter, shelf, bookcase, slot, locker, flowerbed. Others are scaled to their placed footprint. Map `rot` is quarter turns clockwise seen from above. `painting` hangs on a wall face (origin at the wall face, facing +Z); `rug` is ≤ 0.02 tall.
- Objects `obj_safe`, `obj_terminal`, `obj_camera` (wall mount, origin at the wall face 1.3 up, lens toward +Z), `obj_laser` (wall emitter, same convention), `obj_vent` (floor grate), `obj_medkit`, `obj_bush` (outdoor hiding spot), `obj_closet` (indoor hiding spot), `obj_door` (slab spanning x −0.5…0.5, 0.12 thick, 1.45 tall), `obj_window` (frame and glass spanning x −0.5…0.5), `obj_pedestal`, `obj_ledger`, `obj_jewel`, `obj_manifest` (objectives, sit on the pedestal top at y = 0.75), `obj_coin` (0.22 wide).
- Characters (≈ 0.9 tall): `thief_torso` (with arms; light grey vertex colours where the role tint should show), `thief_head`, `thief_leg` (one leg, origin at the hip joint), `guard_torso`, `guard_head` (cap), `civilian_torso`, `civilian_head`, `dog_body`, `dog_leg`, `bird` (Magpie companion). Accessories sit on `thief_head`'s origin: `hat_cracker` (beanie), `hat_scout` (goggles), `hat_magpie` (feathered cap), `hat_ghost` (hood), `hat_breacher` (hard hat), `hat_impostor` (bowler), `hat_wire` (headset), `hat_face` (beret).
