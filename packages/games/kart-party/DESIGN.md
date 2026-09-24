# Kart Party 2 — design and build contract

A ground-up rebuild of Kart Party (id `kart-party`) on the shared PartyPlay room runtime. The goal is a racer that *feels* like a real kart game: a weighty-but-responsive drift with steer-shaped mini-turbos, meaningful boosts, readable courses with line choices, items that create comebacks, CPUs that race, and a TV presentation that looks alive. Nothing from the previous engine is reused except the music files and fonts.

## 1. Architecture

```
src/
  manifest.ts server.ts            platform entry points (GameRules) — thin
  client.tsx                       GameClientModule (views, lobby, settings, results)
  scene.tsx                        SceneView glue: renderer + buffer + prediction + audio + HUD
  views.ts                         which screen draws what (split / personal / spectator / controls)
  input-bus.ts                     controller → scene channel so prediction sees the exact inputs sent
  sim/   (pure, deterministic, runs on server AND in the browser for prediction)
    types.ts math.ts track.ts stats.ts race.ts   foundation (frozen, see §8)
    physics.ts items.ts ai.ts view.ts
  tracks/  palm-bay.ts mesa-rally.ts neon-drive.ts frost-peak.ts index.ts
  net/     interpolate.ts predict.ts
  render/  types.ts renderer.ts camera.ts layout.ts world/* assets.ts actors.ts actors/*
  ui/      Hud.tsx Controller.tsx Lobby.tsx Results.tsx Settings.tsx ... kart.css
  audio/   audio.ts ...
art/     karts/ props/                  Blender build scripts (+ .blend)
public/  models/karts.glb props.glb previews/   music/ (reserved: do not change)   fonts/
dev/     sandbox (local race → real SceneView), not part of the platform build
tests/   node:test files (run by `npm test` and `npm run test:kart`)
```

Data flow: phones send held `Input` (≤20 Hz, coalesced) → server `tick` at 60 Hz runs `stepRace` → `publicView` = `toRaceView(race)` at 20 Hz to every screen → `scene.tsx` interpolates other karts (`RaceBuffer`), predicts the local kart (`KartPredictor`, same `stepKart` code), renders viewports, plays audio and overlays the HUD.

World axes: +Y up, metres, heading `h` with forward `(sin h, cos h)` and driver-right `(-cos h, sin h)`. **Steering right (steer > 0) decreases heading.** Track positions are `(d, lateral)`: metres along the lap from the start line, metres to the driver's right. Track curvature > 0 is a left turn.

## 2. Pacing targets

- Lap 35–45 s at 100cc (tracks ~950–1300 m); default race 3 laps ≈ 2–2.5 min.
- Base top speed m/s: 50cc 23, 100cc 29, 150cc 35, 200cc 41 (`stats.ts`). Stats differ by a few percent only.
- A skilled human drifting well should beat Normal CPUs by a few seconds; Hard CPUs should be a real fight; items and rubber-banding keep the pack together (positions change during a race).

## 3. Driving (physics.ts — `stepKart`) — target feel

Arcade, deterministic, fixed dt = 1/60. Velocity is separate from heading so drifts have a real slip angle.

- **Auto-accelerate.** `a = baseAccel(18 m/s²)·accel·(1 − v/top)^0.6`: ~90% of top in ~2.3 s. Brake 28 m/s²; holding brake below 1 m/s reverses up to 7 m/s. Coasting never happens (no throttle input).
- **Steering** builds toward the input at ~9/s and lets go at ~24/s, so releasing stops the turn instead of carrying it on. Keyboard steering eases in (a tap ≈ 35% lock, full lock after 0.4 s); touch and sticks use a soft curve near centre. Yaw rate ≈ `steer · handling · turnRate(v)`, turnRate ~2.1 rad/s at 8 m/s tapering to ~1.3 at top speed (so 200cc genuinely demands drifting). No turning when stopped.
- **Grip**: lateral (sideways) velocity decays toward 0 at a rate: road 14/s, offroad 9/s, ice 2/s, drifting 3.5/s.
- **Hop & drift**: a `hop` press (counter change) while grounded and > 9 m/s → small hop (vy ≈ 4.2, ~0.28 s). Drift direction = sign of steer (|steer| > 0.25) during the hop; none → just a hop. Drift continues while `drift` is held, speed > 7 m/s and not hit. While drifting the kart always turns into the drift: effective steer = `dir·(0.55 + 0.45·steer·dir)` (steer into = tight, counter-steer = wide), yaw × ~1.25.
- **Mini-turbo charge** only while grounded and not offroad, proportional to how hard the kart bites into the drift: `bite = 0.55 + 0.45·clamp(steer·dir, −1, 1)`, charge `+dt·(0.2 + 1.6·bite)`. Tiers at 1.0 (blue ≈ 50° of drifting), 1.6 (orange ≈ a held 90° corner), 3.0 (purple ≈ a hairpin). Releasing drift fires the tier: 0.7 s / 1.2 s / 1.7 s at +30/35/40% plus an instant kick of +1 / +2.5 / +4 m/s (event `mini-turbo`, value = tier). A good orange drift gains ~0.6 s through a tight hairpin. Weaving on straights must NOT be profitable (a hop costs a little speed; charge needs time).
- **Boosts** raise top speed by `boostPower` and triple acceleration; offroad penalty is ignored while boosting. Overlapping boosts keep the longer time and stronger power (`startBoost`). After a boost, excess speed bleeds off smoothly (~6 m/s²) — never a hard drop.
- **Boost pads** (surface `boost`): 1.1 s at +40%, event `boost-pad` once per pad.
- **Surfaces**: offroad top × ~0.55 (traction stat softens), water × 0.8, ice low grip.
- **Ramps**: the ground height includes ramp wedges, so leaving the lip launches naturally: vy ≈ `v·slope·1.15 + 2`. Gravity 28 m/s², 35% air steering. **Trick**: a hop press within 0.45 s after leaving a ramp lip (or a big crest) → `tricked`, event `trick`; landing tricked → 0.9 s boost at +30%. Plain landings give nothing. A ramp ending flush at a gap still opens the trick window (measured against the road surface).
- **Walls**: push back inside, reflect the into-wall velocity at −0.25, keep ~92% tangential; impacts > 6 m/s lose 15% more and emit `wall`; heading turns partly toward the wall tangent. Never "grind to a stop".
- **Drops & gaps**: past a `drop` edge or over a gap without ground, the kart falls; ~10 m below the road emit `fall` (race.ts starts `beginRespawn`). Respawn 1.6 s: lifted away, then placed at `lastSafeD` on the racing line facing forward at ~10 m/s with 1.5 s invulnerability. `lastSafeD` only updates on solid ground inside the road.
- **Slipstream**: within 16 m behind another kart, < 2.5 m off its line, heading within 25°, both fast: `slipCharge += dt`; at 1.4 → boost 1.0 s +22% (event `slipstream`, `slipT` for visuals). Otherwise charge decays.
- **Rocket start**: the first hop press during the countdown: in [−0.35, +0.05] s of GO → `launch = 1` → boost 1.3 s +35% at GO (event `rocket-start`); in [−1.4, −0.35) → `launch = −1` → 0.8 s stall at GO (event `stall`).
- **Hits** (`applyHit`): `spin` 1.0 s (no steering, speed decays to ~35%, spins 360°); `tumble` 1.4 s (pop vy 6, speed to ~15%); `shock` 3 s at 70% top plus a 0.6 s spin; `ink` 4 s visual-only (CPUs steer worse). Air-time stats only count flights longer than 0.5 s (drift hops don't). Blocked by star, invulnerability, respawn; a shield absorbs one non-ink hit. After recovering: 0.6–1.0 s invulnerability (no hit-lock chains).
- **Star**: 7.5 s, top × 1.18, accel × 1.5, offroad-proof, invulnerable; karts it touches tumble.
- **Kart contact** (`collideKarts`): radius 1.25, |Δy| < 1.5, separate by inverse weight, exchange normal velocity with restitution 0.4 (heavier pushes lighter), star touches tumble the other kart; return pairs with relative speed > 3 for `bump` events.

## 4. Items (items.ts)

One slot. Item boxes sit in rows across the road (`track.boxes`); a box breaks when a kart passes within 2 m and reappears after 2.5 s. A kart with an empty slot gets a roulette (`rollT` = 1.4 s) and its item is decided **server-side immediately** from position-weighted tables; it becomes usable when `rollT` reaches 0. Items mode `off` → no boxes; `frantic` → shift all racers toward the back-of-pack table.

| Item | Use | Weighting |
|---|---|---|
| Nitro / Triple Nitro | 1.4 s boost +40% per use | mid/back; triple back |
| Peel (holdable) | Dropped behind; hold `item` to drag it as a rear shield | front |
| Bouncer (holdable) | Fires straight at 1.9× top (≥ 45 m/s), follows the ground, ricochets off walls ≤ 6×, 8 s, spins the first kart it touches (owner immune for 0.5 s) | front/mid |
| Seeker (holdable) | Chases the racer ranked directly ahead along the track, homes in within 30 m, tumbles | mid |
| Bubble | Absorbs the next hit (up to 12 s) | front/mid |
| Boom Bomb | Lobbed ahead in an arc, lands, explodes after 1.2 s or on contact, radius 7 → tumble | mid |
| Ink | Everyone ahead gets `ink` | mid/back |
| Super Star | Star (see §3) | back |
| Thunder | Everyone ahead gets `shock`; global cooldown 20 s | far back only |
| Comet | Streaks along the course at 2.2× top toward 1st place, explodes radius 8 → tumble; ≥ 4 racers, global cooldown 25 s | far back only |

Input edges: a `fire` counter change = press. If the item is holdable and `item` is held at the press, the kart starts `trailing` it (blocks one projectile arriving from behind); releasing `item` deploys it. Otherwise the press uses it immediately. `handleItemInput` updates `prevFire`/`prevItem`; `stepKart` updates `prevHop`. At most 12 peels on course (oldest removed). Stats: `itemsUsed`, `hitsDealt`, `hitsTaken`. Events: `pickup`, `item` (value = item index), `hit` (racer = victim, other = attacker), `shield-pop`, `explode`, `thunder`, `comet`.

## 5. CPU drivers (ai.ts)

`botInput(race, racer)` returns the same `Input` a human sends (so CPUs use the identical physics, drift and item paths). Required behaviour: follow the racing line (`sample.line`) with a speed-scaled lookahead and a smoothly varying personal lane offset (no conga lines); dodge peels, bombs, obstacles and karts ahead; brake only when the upcoming curvature demands it; **drift through real corners** (target tier: easy 1, normal 2, hard 3) and release on exit; hop off ramps for tricks (hard often, easy rarely); rocket starts (hard ~70%, normal ~40%, easy ~10%); use items deliberately (hold peels/shells behind when threatened, fire bouncers/bombs when aligned with a target, seekers when someone is ahead, stars/thunder/comet/ink after a short randomised delay, nitro on straights or to cut offroad). `botSkill` rubber-bands top speed subtly around 1 (±8%) based on the gap to the best human. Everything uses `race.rng` via `raceRandom` — never `Math.random` — so races are reproducible. Disconnected or finished humans are driven by `botInput` too; a disconnected human never ends the race early — the autopilot brings them home (the first-finish timeout and time cap still apply).

## 6. Presentation

**Renderer (render-world)**: own WebGLRenderer lifecycle modelled on `party-3d` (compile, first visible frame before ready, context-loss → `onError`), ACES tone mapping, sRGB, PMREM environment from the sky so paint and metal read well, one sun with soft shadows re-fitted per viewport (tier 0/1), fog, gradient sky dome with sun and clouds, distant silhouette ring (mountains/skyline) so the terrain edge never shows. Track mesh from `track.samples` with UVs: textured asphalt (procedural canvas textures), painted edges, red/white curbs on tight corners (from curvature), themed aprons (sand/dirt/grass/snow), walls/barriers along wall edges, visible drop-offs, bridges/pillars under elevated road, ramps as wedges with stripes, animated boost-pad chevrons, start/finish gantry and grid. Themed scenery scattered off the course (never inside the apron) plus `landmarks` from the track def, instanced by prop kind. Performance: ≤ ~400 draw calls per viewport, 60 fps with 4 viewports at 1280×720 on the host.

**Camera**: chase ~6.5 m behind, ~2.6 m up, looking ~6 m ahead; follows heading with lag, blended toward the velocity direction while drifting so the kart shows its side; FOV 68 → +8 at top speed, +6 kick on boosts (none with reduced motion); slight roll into turns; shake from `Actors.cues`; countdown intro swoops from in front of the kart to behind; after finishing, swing around to the front for the celebration.

**Actors (render-actors)**: karts + drivers from `karts.glb` (wheels spin, front wheels steer, driver leans/looks into turns, hop squash, drift body yaw ~25° plus counter-steer, tumble/spin animations, arms-up on finish), coloured name tags in split views, drift sparks by tier (blue/orange/purple, burst on release), boost flames from exhaust empties, slipstream wind lines, dust/snow/splash by surface, skid marks, speed lines at high speed, item entities (peel, shells with trails, bomb with fuse flash, comet with tail, blasts), item boxes (rainbow, spinning, shatter on pickup, respawn pop), shield bubble, star rainbow shimmer, shock sparks, respawn drone, confetti on finish. All effects GPU-cheap (instanced/points, pooled, no per-frame allocation).

**Views (views.ts, scene.tsx)**: Auto puts 1–4 humans on the TV split screen (1 full, 2 stacked, 3 = 2×2 with an overview camera in the 4th, 4 = 2×2; forced TV mode with 5–10 uses a grid at low quality) and 5–10 humans on their own devices (TV follows the race with a director camera). A playing host in TV mode is one of the split views; its kart is predicted locally. TV-mode phones draw no 3D (controls only).

**HUD (ui)**: per viewport — big position ordinal, lap `2/3`, item slot with roulette, race timer, final-lap banner, wrong-way warning, respawn text, ink splats, finish placement. Shared display — countdown (Ready · 3 · 2 · 1 · GO!), standings tower, minimap, "Following …" label in spectator. Phone controller (landscape) — floating steering zone on the left half (touch-down point is centre; horizontal drag steers), large DRIFT button at the right thumb (glows blue/orange/purple with charge), ITEM button above it (icon, roulette, trailing state), small BRAKE, HONK; position/lap/item status between. Keyboard: arrows/A-D steer, Space or Shift drift/hop, E or Enter item (hold to trail), S/Down brake, H honk. Gamepad on the host: left stick steer, A drift, X/RB item, B brake. **Lobby** (`LobbyView` + `parseLobbyChoice`): pick one of 8 racers and 3 karts with stat bars, then Ready; readying without a pick means "surprise me". **Results**: podium (top 3 with portraits), full table (time, best lap, kart), party awards from stats, the viewer's row highlighted. **Settings**: course cards with the track outline drawn from its points, laps, cc, CPU difficulty, grid size, items, race views.

**Audio (net-audio)**: WebAudio-synthesised engine per focused kart (pitch/filter by speed, boost growl), drift screech + tier-up chimes, boost whoosh, pad zing, item/hit/explosion/shield sounds, countdown beeps, lap chime, final-lap sting, finish fanfare, honk; split-screen racers panned by viewport. Music streams the existing `public/music` tracks on the TV or playing host only (personal-view phones get engines and effects, no music) (reserved assets: don't edit or add music). Respect the platform mute preference (`localStorage['party.sound.muted']` and the `party-sound` window event).

**Network (net-audio)**: `toRaceView` rounds (positions/velocities 2 dp, angles 3 dp, timers 2 dp) and drops `rng`, `ai`, and `stats` until results; the compact wire codec (`net/wire.ts`: row arrays, racer ids as row indices, plus a `players` list of human ids) keeps 10 racers mid-race at ~3.5–4.2 KB; clients decode before rendering. `RaceBuffer` interpolates by server snapshot time with `PresentationDelay` (75–150 ms), angle-aware, snapping teleports. `KartPredictor` replays locally recorded inputs over the latest authoritative kart with the same `stepKart`, and hides corrections by decaying the visual error (snap on respawn/large errors).

## 7. Blender asset contracts

glTF is Y-up, karts face **+Z**, driver-right is **−X**, metres, origins on the ground. Materials embedded, no textures required (vertex colours / flat PBR). Every node below must exist; the runtime falls back to primitives if one is missing.

`public/models/karts.glb` (≤ 5 MB):
- `kart_<id>` for `zoomer`, `bolt`, `tank` (≈2.2 m wide, ≈3 m long, collision radius 1.25). Children: `kart_<id>_body`; steering pivots `kart_<id>_steer_fl`/`_fr` (rotate about Y) each containing wheel spin pivots `kart_<id>_wheel_fl`/`_fr`; rear spin pivots `kart_<id>_wheel_rl`/`_rr` (spin about local X, pivot at the axle centre); `kart_<id>_steering` (steering wheel pivot); empties `kart_<id>_seat` (driver hips), `kart_<id>_exhaust_l`/`_r` (flame origins, pointing −Z). The recolourable body paint uses a material named `kart_paint`.
- `char_<i>` for i = 0…7 in `CHARACTERS` order (hamster, fox, bear, frog, cat, penguin, bunny, dino), origin at the hips (placed on the seat). Children `char_<i>_body`, `char_<i>_head` (neck pivot), `char_<i>_arm_l`/`_r` (shoulder pivots; hands rest on the wheel).
- Previews: `public/models/previews/char-<i>.png`, `kart-<id>.png`, 256×256 RGBA, transparent background.

`public/models/props.glb` (≤ 4 MB), each a root node with origin at ground contact facing +Z: `item_box`, `start_gantry` (~24 m span), `cone`, `tire_stack`, `barrier`, `arrow_sign`, `crowd_stand`, `balloon_arch`, `lamp_post`, `flag_pole`; items `peel`, `bouncer_shell`, `seeker_shell`, `bomb`, `comet`, `drone`; beach `palm_a`, `palm_b`, `umbrella`, `beach_hut`, `lifeguard_tower`, `rock_beach`, `boat`; desert `cactus_a`, `cactus_b`, `rock_red_a`, `rock_red_b`, `mesa`, `water_tower`, `windmill`; city `building_a`, `building_b`, `building_c` (emissive windows), `street_light`, `neon_sign`, `billboard`, `parked_car`; snow `pine_a`, `pine_b`, `snow_rock`, `cabin`, `snowman`, `ice_crystal`. Track `landmarks[].kind` and obstacle kinds use these names.

## 8. Build rules for agents

- **Status (2026-09-23):** the parallel build is complete; ownership below applied to the build agents and remains a useful map for future work.
- **Ownership is exclusive.** Edit only your files (see your brief). Foundation files (`sim/types.ts`, `sim/math.ts`, `sim/track.ts`, `sim/stats.ts`, `sim/race.ts`, `server.ts`, `manifest.ts`, `views.ts`, `input-bus.ts`, `render/types.ts`, `DESIGN.md`) are frozen: if one truly blocks you, make the smallest additive edit and report it exactly in your final answer.
- Keep every exported signature that another module imports. Add new files freely inside your area.
- Validate: `npx tsc --noEmit` from the repo root (fix errors in your files; others may be mid-edit), your tests with `node --import tsx --test packages/games/kart-party/tests/<file>.test.ts`, and — for anything visual — the sandbox: `npx vite --config packages/games/kart-party/dev/vite.config.mjs --port <your port> --strictPort` then `node /tmp/kartqa/shot.cjs "http://localhost:<port>/games/kart-party/?track=palm-bay&players=2" /tmp/kartqa/<you>-1.png 5000` and **look at the PNG** (Read tool). Stop your own vite server when done (kill only its PID).
- No `Math.random` in `sim/`. No `undefined` values in anything sent over the network. Browser code must never import `server.ts` at runtime.
- Never run Prettier. No git staging/commits. Don't touch `public/music`.

## 9. Rainbow Road (`rainbow-road`, theme `space`) — the grand finale

The fifth course, and it should be the most fun: a glowing rainbow ribbon floating through space, packed with set-pieces no other course has. Longer than the others (≈1.4–1.6 km, laps ≈45–52 s at 100cc), 3 laps. Section plan (the course designer may improve it, but every mechanic below must appear and be readable at speed):

1. **Launch** — starfield straight past a huge ringed planet, start gantry made of light.
2. **Comet Corkscrew** — a banked helix of 360°+ descending under the start straight (≥ 7 m vertical separation at the crossing), guard-railed.
3. **Moon Hop** — a low-gravity zone (scale ≈0.45): spring pads and floating crests send karts on long floaty arcs; star rings hang on alternative air lines — steer through them in the air for boosts.
4. **Pinball Nebula** — a wide section with star bumpers sliding across the road (movers) that knock karts sideways, plus a central obstacle splitting two lanes.
5. **Hyperspace Gap** — a ramp jump across the void onto a lower ribbon, with a ring in the flight path (trick + ring = big boost).
6. **Warp Stretch** — a straight with a centre boost lane and open drop edges (risk vs. reward), rings over the racing line.
7. **Aurora Esses** — banked S-curves with drift lines back to the start.

Edges: guard rails (`wall`) on every corner tighter than ~50 m radius and on the start and finish straights; open `drop` edges where they are part of the challenge (Moon Hop, the gap run-up, the Warp Stretch) with a ≥ 2 m apron. Falling must feel fair: Normal CPUs should average < 0.5 falls per racer per race, and respawns are quick.

New mechanics (`TrackDef` fields resolved in `sim/track.ts`; physics in `sim/physics.ts`):
- **Star rings** (`rings`): passing through the ring disc (within `radius` of its centre as the kart crosses the ring's `d`) gives a 1.0 s boost at +35%, event `ring` (value = ring index), once per pass.
- **Springs** (`springs`, `springAt`): touching one while grounded launches `vy = power` (default 15) with a trick window, event `spring`.
- **Gravity zones** (`gravity`, `gravityScale`): gravity × scale while airborne and for crest detection inside the zone.
- **Movers** (`movers`, `moverPosition(track, m, race.time)`): round bumpers that slide across the road. Contact knocks the kart away along the contact normal (≈12 m/s, keeping most of its speed), event `bumper`, no spin, no item hit, short per-kart cooldown. Everyone (physics, CPUs, renderer) positions them with `moverPosition`, so they are seen exactly where they hit.

Presentation: no terrain — a violet-black nebula sky with dense stars, a giant ringed planet, a galaxy swirl, a distant space station, drifting asteroids and shooting stars. The road glows with seven colour bands across its width and a flowing sparkle; wall edges get glowing rails; drop edges get a bright edge line; the underside glows so the ribbon reads against space. Rings are pulsing glowing tori, springs are star-shaped glowing pads, bumpers are pinball stars that flash and ring on contact, low-g zones shimmer with floating sparkles, boost lanes flow with chevrons. Music: `rainbow-lap-rush.mp3`.

### 9.1 Loop-the-loop (`loops`, `loopPose`)

Rainbow Road gets a full vertical loop, the course's signature moment. A `Loop` sits over a straight footprint (`length` ≈ 40–45 m) at `at`; karts ride a circle of `radius` ≈ 11–13 m whose plane leans `tilt` ≈ 28–32° toward the driver's left, so the rising and falling halves pass side by side. The lean eases in and out over the first and last quarter turn (no heading kink at the joins), and the drift along the footprint slows over the top and bottom (`u' = (1 − 0.5 cos 2θ)/2π`), which keeps the upside-down part round instead of a tight curl. Rainbow Road's loop: 40 m footprint, radius 13, tilt 32°, 12 m lane at the end of the Warp Stretch. `loopPose(loop, θ, lateral)` (in `sim/track.ts`) is the single source of truth for position, tangent, up vector (toward the loop centre), heading and arc length; physics, prediction, camera, karts and the loop mesh all use it.

- **Entry:** a grounded kart moving forward that crosses `loop.d0` inside the lane enters loop mode (`KartState.loop` = θ > 0). Any charged drift fires its mini-turbo; drifting and hopping pause inside the loop.
- **Inside:** the kart is held to the ribbon (magnetic). Speed follows the engine toward top speed (boosts, star and items still work), gains and loses a little on the way up and down, and never drops below a minimum (≈ 0.6 × top), so nobody stalls upside down. Steering moves `lateral` within the lane; heading comes from the loop. `d` advances along the footprint (`d0 + length·θ/2π`), so progress, laps and ranks just work. `x, y, z`, velocity and `grounded` are kept consistent for collisions and drafting. Hits slow the kart but keep it in the loop. There is no respawn inside a loop.
- **Exit:** at θ ≥ 2π the kart is placed back on the road at `d1` with the same lateral, heading along the track, keeping its speed (the engine takes over); event `loop` fires on entry. Kart contacts inside a loop are tested in 3D.
- **Presentation:** the loop is a glowing rainbow ribbon (the footprint below is not drawn as road); karts are oriented by the pose frame; the chase camera rolls with the up vector and stays locked behind the kart (turn cap 8 rad/s, 4 with reduced motion) so the world turns over while the kart stays steady; a whoosh on entry.
