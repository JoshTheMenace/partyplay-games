# Phonedig: design

What the game is, how a room of any size plays it, and the contract between the
server and the screens. [README.md](README.md) is the history and the reasoning
behind the port; this is the map.

## The game in one paragraph

You are paid for what you dig, not what you kill. A crew shares a shaft 160 rows
deep and a pool of lives. Every cell cut pays into the digger's hopper, and the
hopper is only safe once the level is clear: burst every monster and the crew
drops to the next level, which banks the haul. Until then it is at risk. A
digger at zero health is down, not out, and a teammate brings them back by
harpooning them and pumping. Air runs down, and when nobody has any the roof
starts coming in.

## Rosters: one crew, or a race between crews

`players.max` is the room (64). A shaft, though, is tuned for one to four
diggers, and nothing stretches it further.

| Room | What it is |
| --- | --- |
| 1–4 | One crew, one shaft, no clock. The run lasts until the crew is wiped. This is the original game. |
| 5–64 | Rival crews of up to four (`crewSizes` in `src/crews.ts`), each in a shaft of its own, on a shift clock. |

- **Splitting.** As few crews as fit, as even as they can be made, filled in
  roster order so people who joined together dig together: 5 is 3+2, 9 is 3+3+3,
  32 is eight fours, 64 is sixteen. The host's *Crews* setting changes the size;
  1 is "solo shafts", which makes any room of two or more a race.
- **Same ground.** Every crew's first shaft is cut from the room's seed, so
  equal crews race over identical levels.
- **The shift clock.** A race needs an end everybody reaches together.
  Automatic is no clock for one crew and six minutes for several; the host can
  set 3–15 minutes or none.
- **The whistle.** When the clock runs out everything stops. Banked haul counts
  in full; what is still in the hoppers comes up at half (`SHIFT.SALVAGE`).
  Three seconds of "tools down", then the results.
- **A wipe on a clock** costs the hoppers and the relics and sends the crew
  back to the top of a fresh shaft after four seconds. The bank is kept. Nobody
  spends the rest of the round watching.
- **A wipe with no clock** ends that crew's shift. With several crews and no
  clock (the host asked for it) the round ends when they are all out.
- **Scoring.** A crew earns `banked + 3 × ore banked + salvage`. Crews are
  ranked on each digger's *share* of that, because a crew of three and a crew
  of two are not the same size; depth breaks a tie. With one crew nobody wins:
  the run is the score.
- **Lives** are per crew.

Why not one enormous shaft: measured before this design, a 64-digger shaft
would be 902 columns wide with about 355 monsters to clear per level, a
television picture one pixel per cell, and every phone sent every digger. Crews
keep the tuned game intact and make the cost of a room proportional to its
size rather than to its square.

## Who is sent what

All of it is in `src/model.ts`; the server side is `src/server.ts`, the client
side `src/viewstate.ts`.

**One shaft on the wire is a `ShaftWire`.** It carries the world's identity
(`crew`, `run`, `runSeed`, `level`, `entryLc`, `lanes`), the crew's shared
numbers and everything that moves, packed:

- diggers, monsters and loose rocks are flat number arrays (`packPlayers`,
  `packMonsters`, `packRocks`);
- a rock still seated where the generator put it is one bit of `idle`;
- events are kept for a quarter of a second and replayed by sequence number;
- nothing a client can derive is sent: the ground, the biome, the sky, where
  the rocks, relic, crystal and bonus lie are all functions of the identity.

**The public view** is a `ShaftWire` plus the room: the kit-up, the shift
clock, `crewCount`, and two things sent only now and then: `roster` (names,
colours, suits, crews; on a change, every two seconds, and always at the
results) and `site` (eight numbers per crew, one per digger and the `feed` of
what has just happened around the site; five times a second). Screens keep the last of each (`remember`,
`recall`).

- With **one crew** the public view *is* everyone's shaft and no phone is sent
  anything else. Its cut ground is the cached `edits` field, diffed by the
  platform's snapshot cache.
- With **several**, the public view is the shaft the television is on
  (`round.spot`, chosen by `direct()`), and each phone's own crew's shaft rides
  in its **private view**. Private views are not cached by the platform, so the
  ground travels as a journal (`ShaftCuts`): every snapshot repeats the cells
  cut in the last second, numbered. Ground is only ever cut, so replaying is
  harmless. A phone that missed more than the tail (`Ground.gap`) sends the
  `sync` action once and gets the whole list back as `base`; a reconnecting
  phone gets it unasked.

So a phone's traffic is its own shaft plus the television's, whatever the room
holds: about 62 KiB/s at 32 and at 64 (`tests/crews.test.ts` prints it).

**At the results** the room projects the public view once and re-sends that
frame until the host moves on, so it is built to be whole and small: no shaft
arrays, no roster, and instead `cast` (names and suit indices, in the same
order as the outcome's rows) and a `site` that also carries each crew's and
each digger's tallies. The outcome rows are only id, score and rank. A phone's
private view carries no shaft at the results.

## The screens

One renderer (`view.ts`, `entities.ts`, `terrain.ts`, `light.ts`, `vfx.ts`) with
two framings, chosen in `scene.tsx` by whether the screen holds a seat:

- **A phone** follows its own digger. `fit()` shows twenty cells across.
- **The shared screen** is a broadcast. `fitBroadcast()` shows the whole shaft
  across when it can; the server picks the shaft, and a client-side director
  (`createDirector`) picks who in it to follow: a rescue, a digger down, a
  fight, otherwise each in turn. The board beside the picture (`Board` in
  `client.tsx`) is the race, the crew on screen, and the feed.

The HUD's first job is the goal: `left`, the monsters still between the crew
and the bank, is on every screen.

Effects, popups, banners and sound are made on each client from the event
list. A new event is a row in `FX` (`vfx.ts`) and a row in `VOICES`
(`audio.ts`); an event with no row is ignored.

## Adding to it

- **A setting**: `Settings` in `model.ts`, `validateSettings` in `server.ts`
  (it must accept `{}`), `SettingsView` in `client.tsx`.
- **A site-level moment** for the television's feed: `say()` in `server.ts`,
  `SiteEvent['type']` in `model.ts`, a line in `FEED` in `client.tsx`.
- **Anything in the engine** (`engine.ts`, `world.ts`, `monsters.ts`): it is the
  ported single-player simulation. The room's own rules live above it in
  `server.ts` and read the state before and after a step rather than reaching
  in. Keep it that way.
- **A wire field**: add it to `ShaftWire`, to `shaftOf()` and to
  `decodeShaft()`. If a client can derive it, do not send it.

## Tools

- `dev/` is a sandbox: the real rules with playing bots in one page, no room
  server. `npx vite --config packages/games/phonedig/dev/vite.config.mjs --host
  127.0.0.1 --port <port>`, then `?players=32&role=display&t=40`. Parameters are
  listed at the top of `dev/sandbox.tsx`.
- `tools/room-bot.ts` is the hook for the platform's socket bots: phones that
  really dig, fight and bank.
- `tests/helpers/bot.ts` is the bot both of them use.
