# Phonedig

A mining arcade game. **You are paid for what you dig, not what you kill.**

Ported from Aaron's single-player roguelike at `dig.ahcomputing.com`. This is a
separate build for Party Place, not an update to that game — the two hard-forked
and are not kept in sync. Do not edit the upstream checkout from here.

## Status

The simulation, the networking, the round lifecycle, the art and the audio are
all ported and running. [DESIGN.md](DESIGN.md) is the short map of how a room
plays and what crosses the wire; this file is the reasoning.

One to four diggers share a shaft that widens with the crew, each with their
own suit, health, air, hopper, harpoon, relics and tune, against a shared bank
and a shared pool of lives.

**A room of five to sixty-four is several of those crews.** Each crew of up to
four gets a shaft of its own, cut from the same seed, and they race a shift
clock: six minutes unless the host says otherwise, then a whistle. Banked haul
counts in full and whatever the whistle catches in the hoppers at half; a crew
wiped on the clock loses its hoppers and is sent back to the top of a fresh
shaft rather than left watching. The shared screen follows one shaft at a time,
moving to wherever the action is, beside a board of the whole race.

`players.max` is the room (64) because of that split, not because a shaft got
bigger. A shaft is still tuned for at most four.

## What the 2026-11 pass changed

- **Rival crews and the shift clock**, above. All of it lives in `server.ts`,
  over the engine, exactly where the kit-up already lived.
- **The shared screen uses the real renderer.** It was a schematic: flat
  boxes, no lamp, no effects, the dirt tiles squeezed to half size. It is now
  the same sprites, lighting and particles a phone draws, framed as a broadcast
  with a camera that goes to the rescue, the fight or the digger whose turn it
  is, and a board beside it instead of chips over it.
- **The goal is on screen.** Every HUD shows how many monsters are left before
  the haul is banked. It was nowhere: "Hopper full — descend to bank it" was
  the only hint, and descending is not something a digger can choose to do.
- **Words on the field.** The engine's popup list never crossed the wire, so
  nothing was ever written in the shaft. Ore, the bonus, a rock chain, a relic's
  name and what it does, a digger going down and standing up, a level cleared
  and its haul, a new biome and the whistle are now said, by `vfx.ts`, from the
  event list.
- **Going down and getting up have a look and a sound.** `down`, `grab`,
  `revive`, `respawn` and `breach` were raised by the engine and had no row in
  either table. Four small voices were added to `audio.ts` in its own style:
  `down`, `revive`, `respawn` and `whistle`.
- **Teammates wear their names**, and one off the screen is a named arrow at
  its edge (with their clock if they are down).
- **The last three monsters are pointed at** from the edge of the screen,
  hunting or not, because clearing the level is the only way to bank and the
  last one in a shaft 160 rows deep was otherwise a search.
- **Ore counts.** It had its own purse and, with the shop gone, no use. Banked
  ore is weighed in at three dirt each.
- **Results** say who won, what each crew earned and how, what the whistle
  caught, and who cut the most ground, burst the most monsters and pulled the
  most people up. The tallies are taken in `server.ts` by comparing the state
  before and after each step.
- **The wire is about a quarter of what it was** (below), which is what made
  the rest affordable.

## The co-op rules

Upstream ends a run on the hit that takes your last health, because there is
nobody else down there. Here:

- **Zero health puts a digger DOWN, not out.** They stay where they fell, out of
  the fight and off every monster's list, with a clock running.
- **Unless there is nobody who could come.** Solo, or as the last one standing,
  the window is skipped and the life is spent there and then. A clock on a
  rescue nobody can make is not a mechanic, it is twenty-five seconds of
  watching. A *disconnected* teammate still counts as a possible rescuer — the
  alternative is teaching the engine about presence, which would put a network
  fact inside the deterministic step and break the parity harness.
- **You revive them the way you kill everything else: harpoon them and pump.**
  It reuses the verb the whole game is built on, it works at harpoon range so
  the rescuer need not stand on whatever put them down, and the line still stops
  on dirt — so reaching somebody is digging to them. A monster between you takes
  the shot instead. Banked pumps deflate exactly like a monster's when the line
  comes off, same delay and step: it is the fight's own verb, so it has the
  fight's own feel, including the part where letting go costs you.
- **Nobody reaching them in time costs a team life** and puts them back at the
  entry pocket. Their hopper goes with them — only what was banked survives,
  which is the bet the whole game is built on.
- **The run ends when the crew is down with no lives left.** Solo, that makes
  lives simply how many times you can be killed.
- **A descent carries the fallen.** Anyone still down when the level cleared is
  brought to the next one free: their teammates killed the last monster with
  them lying there, and charging a life for that would punish the success.
- **The roof comes in only when nobody has air.** One digger who finds a pocket
  holds it off for the whole crew, which is what makes "go and find air" worth
  shouting. Pockets are finite, so it still terminates.

An off-screen marker points at a downed teammate and counts down, because a
shaft is 160 rows deep and a teammate you cannot find is one you cannot save.
The phone controller says it too — a player holding one can see the game but not
the room, and the television is not where their eyes are.

## The shaft widens with the crew

Ten lanes for one digger, seventy-three for ten, on the same 0.7-per-extra-digger
curve the monster count uses — so the ground stays about as dense as it was
tuned rather than thinning out as the field grows. Each screen still shows
twenty fine cells across, the width the game was designed at, and the camera
pans sideways as well as down.

**Storage is always the ten-digger maximum; `state.activeLanes` is how much is
in play.** Every bounds test uses the latter and every array index the former.
Mixing them does not error — it produces a game that is subtly wrong at the
right-hand wall, and both bugs that slipped through during this work were
exactly that:

- `diggingAhead` bounded by the storage width found solid ground past the edge
  of the world and charged dig speed for walking into the end of the map.
- `canEnter` bounded by the storage width let a **grub tunnel out of the
  field**, because a digging monster can enter solid ground and there was
  suddenly solid ground out there to enter.

Both were caught by the parity check, not by a test written for them.

### What the measurements actually said

The generator is not the constraint. It places 2.2 monsters per lane across 73
lanes, at every depth, without ever coming up short and without starving
pockets or hazards. Nor is CPU: ten diggers and fifty monsters tick in 0.14 ms
against a 16.7 ms budget.

The wire was the constraint, and is not any more. Worst-case projection after
twenty seconds of digging on level 20, against a 32 KiB envelope:

| Diggers | 4 | 8 | 10 |
|---|---|---|---|
| Before | 25.3 KiB | — | 35.7 KiB |
| Now | **9.4 KiB** | **16.8 KiB** | **20.9 KiB** |

Two encodings did it, and both are in `model.ts` so each layout is written
once and used by both sides:

- **Entities are packed into flat number arrays.** A JSON object repeats its
  key names once per entity, and a hundred monsters is a hundred copies of
  `"telegraph"`. Indices into `bestiary.ts` replace kind, variant and mode
  strings; positions are quantised to a hundredth of a cell, a fifth of a pixel
  at the largest scale anyone plays at.
- **The cut ground is run-length encoded.** Two properties of the simulation
  make this possible, and both now have tests because the encoding is silently
  wrong the moment either stops holding: ground is only ever cut and never
  filled back in, so the delta is a SET rather than a map of values; and ore is
  cleared only inside a carve, so a client that knows a cell is cut knows its
  ore is gone without being told. A tunnel is contiguous, so 1,549 changed
  cells became 408 runs.

The engine and the generator still support a shaft of up to ten diggers, and
those measurements stand. Nothing uses more than four: a bigger room is more
crews, not a wider shaft. See DESIGN.md for what a 64-digger shaft would have
been (902 columns, about 355 monsters a level, a television picture one pixel a
cell) and why it was not built.

### The wire after the 2026-11 pass

A four-digger snapshot was about 4.6 KB before its ground, twenty times a
second, most of it things that had not changed. Per snapshot:

| | Before | Now |
|---|---|---|
| Diggers (four) | 1,370 B of named objects | about 300 B, packed like the monsters |
| Events | 1,150 B: the last 24, however old | the last quarter second, usually under 300 B |
| Rocks | 640–840 B | one bit per seated rock; only loose ones in full |
| Hazards, pockets, relic pool | 600–800 B | nothing: the client generates all three |

Names, colours, suits and crews go out on a change and every two seconds, not
every frame. The cut ground is unchanged for one crew (the snapshot cache's
keyed pairs); with several crews each phone's own shaft is in its private view
and its ground is a journal, described in DESIGN.md.

## Controls

Stick and a pump button on a phone; **WASD and space** on anything with a
keyboard, bound on the document rather than on the pad. The shared pad already
answered arrow keys, but only while focused — so a player on a laptop had to
find and click a joystick before the keyboard did anything, which is not
something anyone should have to discover. Keys are held as an ordered list, so
pressing D while still holding S turns east at once rather than waiting for S
to come up, and they are released on blur and on tab-hide because a key held
when the window goes away never gets its keyup.

## Kitting up

A round opens on a suit picker and the shaft holds completely still behind it —
no ticks, so nothing moves, drains or drifts while the crew chooses. It ends
when everyone has picked, after a short beat so the last person to tap still
gets a second look, or when the clock runs out; anyone who said nothing is
dressed by seat order so two silent diggers never match. A disconnected phone
does not hold the crew up.

This lives in `server.ts`, deliberately **above** the engine rather than as a
simulation phase. The engine is the ported single-player game and every line of
it is covered by a parity check against upstream; a pre-round phase is a
property of the room, not of the digging.

The seventeen suits in `suits.ts` are exactly the set the sprite atlas contains.
A suit's `swatch` is the colour that stands for its wearer everywhere a sprite
does not fit — a name tag, an off-screen arrow, a dot beside a teammate's name —
and every surface has to use it, because a dot in the room's colour beside a
body in the suit's reads as two different people.

In a race the picker also says which crew a digger is in and who else is in it,
and the shared screen shows every crew's muster: who you are with is the first
thing a crew needs to know and nothing else would tell it.

## Layout

| Path | |
|---|---|
| `src/engine.ts`, `world.ts`, `monsters.ts` | the simulation. Pure: no DOM, no clock, no `Math.random` |
| `src/worldgen.ts` | tuning tables and the level generator. **Pure, and imported by the browser** — clients rebuild terrain from a seed |
| `src/themes.ts` | biome palettes |
| `src/model.ts` | shared types, including everything that crosses the wire |
| `src/crews.ts` | how a room splits into crews, and their names and colours. Browser-safe |
| `src/tuning.ts` | the one upgrade preset every room runs, the co-op numbers and the shift's |
| `src/suits.ts` | the wardrobe. Browser-safe: the picker imports it directly |
| `src/server.ts` | `GameRules`: crews, the kit-up, the shift, every projection. Never reaches the browser |
| `src/scene.tsx` | the canvas, on a phone and on the shared screen, and the broadcast's director |
| `src/client.tsx` | the phone's HUD and controls, the television's board, kit-up, settings, results |
| `src/viewstate.ts` | the join: snapshot in, something the renderer can draw out. The roster and ground live here |
| `src/render.ts` | the drawing layer's types — `ViewPlayer`, `ViewMonster`, … |
| `src/view.ts` | composition: measure, drive the camera, call the draw passes |
| `src/entities.ts` | everything that moves, and the procedural fallbacks |
| `src/terrain.ts` | the ground, rasterised in chunks and cached |
| `src/light.ts` | lamp, ambient, ambient occlusion, ore glint |
| `src/anim.ts`, `vfx.ts`, `sprites.ts`, `camera.ts`, `palette.ts` | the rest of the art layer |
| `src/bestiary.ts` | browser-safe monster tables: wire order, and variant tints |
| `src/audio.ts`, `music.ts` | the mixer and the generative score. Procedural WebAudio, no asset files |
| `src/sound.ts` | the join: unlock, the shell's mute, events in, ambient out |
| `art/make-pump.py` | bakes the controller's Pump label into `public/games/phonedig/pump.png` (Lilita One, OFL), so rapid taps cannot select button text |
| `dev/` | a sandbox: the real rules and playing bots in one page, no room server. Never shipped |
| `tools/room-bot.ts` | the hook that makes the platform's socket bots dig, fight and bank |
| `tests/helpers/bot.ts` | the bot itself, shared by the tests, the sandbox and the hook |

`worldgen.ts` is not called `content.ts` and the rules are not importable from
the client because `vite.config.ts` blocks any game's `src/content.ts` or
`src/server.ts` from the browser graph **by filename**. Renaming either back
will fail the build.

## One renderer, two framings

A **landscape phone** gets sprites, lighting, particles and a camera following its own digger. The viewport uses the available width, with movement on the left and pump on the right. Both controller and personal-view manifests require landscape.

The framing follows whether the screen holds a seat (`props.playerId`), so a playing host gets the phone's view too. The **shared screen** runs the same renderer as a broadcast: `fitBroadcast` in `fit.ts` shows the whole shaft from wall to wall when a whole multiple allows it and otherwise keeps thirty rows in view and pans, and the camera goes to whoever `createDirector` in `scene.tsx` picks. Which SHAFT it shows in a race is the server's decision (`direct` in `server.ts`), because the server has to send it. The board beside the picture is DOM, in `client.tsx`.

It used to be a second, schematic renderer in `scene.tsx`. That is gone: one integer-scaled shaft with the lamp on reads better from a sofa than a zoomed-out diagram, and it is one renderer to keep right instead of two.

Three things about the art layer differ from upstream and are load-bearing:

- **The draw calls are typed against `render.ts`, not against the simulation.**
  A client has a projection of the world, not the world: no kind table, no lane
  graph, no pathing sets. Typing against `Monster` would compile — it is a
  superset — and fail at runtime the first time a snapshot arrived without the
  field. A new field in a draw call is now a compile error in `viewstate.ts`,
  which is where it should be.
- **Particles and popups never cross the wire.** Every phone makes its own from
  the event channel. Sixty frames a second of dust would dwarf the rest of the
  snapshot, and each screen wants its own anyway.
- **Terrain chunks are rasterised at the PLAYED width, not the stride.** The
  grids are allocated at the ten-digger maximum; a four-digger shaft uses 62 of
  those 146 columns, so the full stride would cost 2.4x the pixels and the
  memory to hold them for ground nobody can reach. The width is part of the
  cache key alongside the theme — both are baked into a chunk, and a stale one
  is invisible until you dig into it.

The atlas loads in `prepare()`, so the platform's readiness barrier waits for
it: a phone that starts drawing first spends its opening seconds in the
procedural silhouettes and then pops into the real art mid-dig. A missing or
stale sheet is a normal state and drops to those silhouettes rather than
failing the round — `sprites.ts` refuses an atlas its frame table was not
written against, which is otherwise the most confusing bug this project has
produced.

## The ears

`audio.ts` and `music.ts` are ported whole and know nothing about the platform;
`sound.ts` is the join. Four things are worth knowing:

- **Every screen renders its own mix.** The events are already on every client
  for the particles, the synthesis is procedural with no asset files, and a mix
  made on the device can follow *that* player's air — which is what the ambient
  bed's intensity is, and it is personal. The shared screen gets one too: it has
  no digger, so its bed follows whoever is worst off.
- **The same event list drives the ears and the eyes**, in the same loop, read
  off the RAW snapshot rather than an interpolated one — a blended frame is a
  copy of the newer of two and would replay its events. An event with no entry
  in either table is silently ignored, so a new event type is one row in
  `VOICES` and one in `FX` and nothing else.
- **The shell owns the volume.** One sound control, in the header. It writes
  `party.sound.muted` and fires `party-sound`; this game reads both and adds no
  control of its own. Browsers need a gesture before audio starts, so `unlock`
  rides on the first pointer or key event.
- **Nothing in the audio path may throw.** Both schedulers refuse a non-finite
  number and log once instead of passing it to a parameter, and both render
  loops catch and carry on. This is not defensiveness for its own sake: these
  are called from inside `requestAnimationFrame`, and a throw there does not
  stop the music, it stops the GAME — the exception unwinds past the reschedule
  at the bottom of the loop, the loop never runs again, and the canvas freezes
  on its last painted frame while React carries on updating the HUD from live
  snapshots. It reads exactly like the simulation hanging, which is the one
  place it is not. `tests/audio.test.ts` fails if a guard so much as fires.
- **`hunt`, `wobble` and `airlow` bypass ducking and duck everything else on the
  way past.** They tell the player about something they cannot see — the field
  is 160 rows deep and the view scrolls — and the sound *is* the tell. Anything
  that can bury them is a bug, not a mix preference.

## How the wire works

Terrain is a pure function of `(level, seed, entryLc)`, so the client rebuilds
each level itself and only changed cells cross the socket, as
`snapshotCache.keyedPairsFields`. Three things about that are easy to get wrong:

- A seat's pump counter starts at **0, not -1**. -1 means "this seat reconnected
  and is mid-count", where rebasing onto the next value is right; using it for a
  fresh seat silently swallowed the first tap of every round.
- The delta is measured against a **pristine copy** of the generated grid, not
  by hooking the code that writes to it. `carve()` and `breakTile()` are not the
  only writers — the descent drill writes `state.dirt` directly — and a missed
  writer desyncs clients silently.
- `entryLc` must be read **before** the step that changes level. `startLevel`
  consumes `state.exitLc` and nulls it in the same call, so reading it afterwards
  publishes the wrong shaft column.
- Two properties of the simulation are what let terrain be a run list at all:
  ground is only ever **cut**, never filled, and ore is cleared **only inside a
  carve**. Together they make the list a description of the world as it *is*
  rather than as it changed — so replaying it is idempotent, a dropped snapshot
  costs nothing, and a client cannot drift quietly behind. Both are asserted in
  `tests/wire.test.ts` rather than believed.
- Pumps ride in **held input as a cumulative counter**, never as reliable
  actions: a dig session fires far more taps than the 256-action round budget,
  and 20 Hz coalescing would drop a per-frame tally. A counter that goes
  backwards is a reloaded client, not a tap.

`releaseInput` is for leaving, not for standing still — it bypasses coalescing,
so calling it whenever the stick re-enters the deadzone spends the socket's
80-messages-per-second budget in moments. Rest is published as ordinary held
state.

The engine keeps its tunables in a module-level object, which a server shares
across rooms, so every room reinstalls its base tune before it steps. On top of
that the engine installs each DIGGER's own tune around their step and restores
the base afterwards, because relics are carried rather than shared — Wide Bore
reshapes one player's tunnel, not everyone's. Neither swap is optional.

Two more things the crew changed:

- **Monsters target through the tunnels, not by line of sight.** `repath` floods
  from every living digger at once and carries, alongside the distance, which
  digger each node's shortest path leads to. A digger two cells away through
  solid rock is not close, and that distinction is the whole of the AI.
- **Diggers do not block each other.** Monsters already walk through you, and
  making the crew solid would let one player seal another into a dead-end tunnel
  they cut themselves.

A scene reports readiness the moment its canvas exists, NOT from inside the
animation loop: `requestAnimationFrame` does not fire in a hidden tab, and the
preparation barrier waits for every screen, so one phone with its screen off
would otherwise fail the round for the whole room.

## Performance

"The game stutters" is three unrelated problems that look identical on screen,
and each has a different fix. `src/perf.ts` tells them apart.

### The probe

Off unless asked for, and free when off. Turn it on with `?pdperf` in the URL,
or on a phone with `localStorage.setItem('pd.perf', '1')` and a reload. An
overlay appears top-right; `window.__pdPerf.report()` returns the same as JSON.

| counter | climbing means | usual fix |
|---|---|---|
| `dropped/10s`, `fps` | **slow frames** — the renderer misses 16.7 ms | fewer pixels per pass |
| `FROZEN (buffer underrun)` | **starved buffer** — the renderer ran past its newest snapshot, so digger, monsters and rocks all hold still, then jump. Frames can be perfectly fast | bigger interpolation delay, or a better network |
| long `interval` with low `js work` | **raster or a busy main thread** — the cost is after the JavaScript returns | check GPU acceleration; see below |

Passes can be switched off, because JavaScript timers cannot see raster time —
the honest way to price a pass is to remove it and watch the frame rate:
`?pdperf&pdskip=light,vfx,gutters` and `?pdperf&pddpr=1` (or `pd.skip` /
`pd.dpr` in localStorage). The query string does not survive the shell's
in-app navigation, so localStorage is the reliable route.

### What it found

Measured in headless Chrome at level 20, laptop-sized window, server on the
same machine:

- **The server is not it.** Worst case, four diggers at level 20: 0.23 ms a
  tick, 12 KiB snapshots.
- **Snapshots arrived on time** at 1x: median 49 ms apart, never over 68 ms.
- **The non-canvas client pipeline is not it.** Decode, blend and adapter:
  0.02 ms a frame, ~0.5 MB/s allocation.
- **Pixel density is.** The same round ran a locked 60 fps at 1x and dropped to
  25-45 fps at 2x, with hundreds of frozen frames — slow frames also delay the
  WebSocket handler, which starves the buffer, which is why enemies froze too.

Two passes scaled with device pixels and were fixed without changing the look:

- **Lighting mask sized in CSS pixels, not device pixels.** It is a blurred
  gradient composited with smoothing on; a 2x screen gains nothing from four
  times its pixels. Interleaved A/B at 2x: 4.4 ms to 1.5 ms a frame, total
  JavaScript work 5.5 ms to 2.0 ms.
- **Terrain chunks rasterised at source-art resolution** and upscaled by a whole
  number with smoothing off, which is pixel-identical for 16 px art. A chunk is
  rebuilt whenever a cell in it is cut, and rebuilds had spiked to 10-66 ms at
  2x in earlier runs. Honestly: the clean A/B runs happened not to trigger
  rebuild spikes in either build, so this one rests on a 9x reduction in pixels
  per rebuild rather than on a measured before-and-after.

### Caveats worth knowing

- **Headless Chrome rendered with SwiftShader** — pure CPU. With both fixes it
  still only reached ~49 fps at 2x on 2 ms of JavaScript, and that gap is the
  test rig's rasteriser. A real GPU-composited browser should do far better;
  **a browser that has fallen back to software rendering will not.** On Linux
  that happens when the GPU is blocklisted: check `chrome://gpu` for
  "Canvas: Software only".
- This machine's timings swung by 2x between identical runs. Single A/B pairs
  were misleading; only interleaved repeats (old, new, old, new) agreed.
- Not yet tried, if 2x is still slow on real hardware: rendering the field at 1x
  and letting CSS scale it with `image-rendering: pixelated`. It works, but the
  integer-scale fit then lands on a different cell size, so the shaft looks
  zoomed out on a HiDPI laptop — a visual trade-off rather than a free fix.

## One bug worth remembering

The game froze around level 20 and never at level 1. The cause was one `>>`.

`scoreFor` gives a biome with no authored score one derived from a hash of its
id, and picks its tension interval with `[6, 10, 13, 14][(h >> 4) % 4]`. But
`hash()` returns an **unsigned** 32-bit value, and `>>` coerces to a signed
int32 — so any id whose hash has the top bit set yields a negative index, an
`undefined` interval, `root + undefined` = NaN, and a parameter write that
throws. Karst is such an id, which is why it took a descent to reach. The
tension tone is also stacked more often as the air runs out, so it took a while
to fire even once you were down there.

Three things made it worse than it had to be, and all three are now fixed: the
render loop rescheduled only on success, so one throw ended rendering for the
round; the frame reported the fault to the shell, which stopped the round
outright; and the offline audio harness used a permissive stub that accepted
NaN, so it passed the very bug it existed to catch.

## Checks

```sh
node --import tsx --test packages/games/phonedig/tests/*.test.ts
```

`tests/crews.test.ts` covers everything above the engine that a bigger room
adds: the split, the clock, the whistle and its salvage, a wipe with and
without a clock, who is sent which shaft, a phone's ground rebuilt from the
journal across a descent and after a gap, the television moving between
shafts, and a room of 32 and of 64 played by bots with the tick cost, the
projection cost and one phone's traffic printed.

`tests/audio.test.ts` builds every voice and scores a ten-minute descent in
every biome against a stub graph that **throws on a non-finite float exactly as
a browser does**, and fails if the modules' own guards fire — a guard that
fires is a bug that was caught, not a bug that was fixed.

`tests/wire.test.ts` covers the seam, not the game: a client reconstruction
compared cell-by-cell against the server's grid across a descent, snapshot size
against the 32 KiB envelope, the pump counter's reset and cap behaviour, and
input validation.

The simulation's own behaviour is verified against the upstream JavaScript by
hashing 500 generated levels and 12 bot runs of 100 simulated seconds — dirt,
ore, every monster's position and mode, rocks, harpoon, hazards and economy.

**That comparison is the multi-player refactor's safety net and it still passes.**
One digger must behave exactly as the single-player game did, bit for bit; if a
change to the crew logic breaks that, it broke something. Re-run it before
trusting any change to `engine.ts`, `world.ts` or `monsters.ts`.

Porting upstream's own test suite across is still outstanding.

## Measured

Before the 2026-11 pass, at one player and a 20-cell shaft: worst full baseline
6.0 KB (529 edits), mean delta frame 2.3 KB, about 44 KiB/s per socket at
20 Hz. Entities dominated, not terrain.

After it, from `tests/crews.test.ts` on a loaded development machine with a bot
on every seat (so the tick figure includes the bots): 32 diggers in eight crews
cost about 0.8 ms a tick and 0.5 ms to project every screen; 64 in sixteen
about 1.5 ms and 0.9 ms. One phone is sent about 62 KiB/s at either size — its
own shaft and the television's — and the largest single snapshot was 11.5 KB.

On the real room server with socket bots digging on every seat, one real
television page and one real phone page: at 32 the server process used 21–27%
of one core and each phone received 46–68 KiB/s at 17.5–20 snapshots a second;
at 64 it used 30–50% of a core and each phone received 45–75 KiB/s. That
machine was shared and overloaded (load average 25–45 on 12 cores), and at 64
the snapshot rate was the first thing to slip: 16–20 a second at a load of 25,
as low as 9–15 for stretches at a load of 40. Nothing else gave way — no
dropped seats, no desynced ground, every crew banked and the results were
right — but it means 64 wants a core that is actually free.

At the results the room re-sends one frozen frame to every phone twenty times
a second for as long as people read it. Phonedig's part of that frame is 3 KB
at 64 diggers (names, suits and tallies, with no shaft); the platform's own
outcome is another 7 KB, which is why a phone still receives about 167 KiB/s
on the results screen of a full room. That is the platform's to change.

Physical phones, a real television at viewing distance and sixty-four devices
on one access point have not been tried.
