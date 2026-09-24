# Sky Clash stages

`src/stages.ts` defines all 30 stages in Melee units and converts them with `UNIT` (0.08 m per unit). Collision is axis-aligned:

- **Blocks** are solid. The top is a floor, the sides are walls and the bottom is a ceiling.
- **Platforms** are one-way.
- **Ledges** sit at top corners whose floor is open above and whose wall is open just outside.

Sloped Melee undersides become stepped `taper` blocks. The steps cover their own corners, so only the real stage edges can be grabbed, and a low recovery hits the steps as walls and ceilings, the way it hits Melee's sloped undersides.

Motion, transformations and hazards are pure functions of `stageTick`. `stageFrame(id, tick, hazards)` returns the same frame to the server and the renderer. Turning hazards off stops damage and wind, but the terrain keeps moving.

**Confidence.** For the six tournament stages, the main width, platform positions and blast zones use community-documented Melee values: Battlefield, Final Destination, Yoshi's Story, Dream Land, Fountain of Dreams and Pokémon Stadium. Every other stage is estimated from the stage's recognizable layout at Melee scale; none of those numbers were measured from the game files. Width is the main block. Blast zones are left/right/top/bottom, in units.

| Id | Name (source) | Main width u (m) | Blast u | Features | Simplifications |
| --- | --- | --- | --- | --- | --- |
| battlefield | Battlefield | 136.8 (10.9) | ±224 / 200 / −108.8 | Platforms at 27.2 and 54.4, jagged six-step underside | The lip is modeled as the first 4-unit step |
| final-destination | Final Destination | 171.1 (13.7) | ±246 / 188 / −140 | No platforms; a deep underside with walls under the ledges | Curved underside is stepped |
| cloudbreak | Cloudbreak (original) | 128 (10.2) | ±220 / 196 / −110 | Battlefield-like: side platforms at 25 and a crown platform at 50 that sways ±10 u | Bonus stage, no hazard |
| yoshi-story | Yoshi's Story | 112 (9.0) | −175.7/173.6 / 168 / −91 | Platforms at 23.45 (overhanging the edges) and 42; Randall rises on the left, passes behind, sinks on the right (21 s loop) | Slanted floor ends are flat; Shy Guys omitted |
| fountain | Fountain of Dreams | 126.7 (10.1) | ±198.75 / 202.5 / −146.25 | Side platforms glide between 5 and 28 u on independent deterministic schedules; top at 42.75; curled underside and pillar | Platforms never sink fully below the floor |
| stadium | Pokémon Stadium | 175.5 (14.0) | ±230 / 180 / −111 | Platforms at 25; after 50 s neutral, a 6.5 s warning, then Fire → Grass → Rock → Water, about 50 s each. Pieces rise out of the floor over 1.5 s and the side platforms leave | Terrain is blocky; the Water windmill does not spin; no ledges on transformation pieces |
| dream-land | Dream Land | 154.5 (12.4) | ±255 / 250 / −123 | Platforms at 30.14 and 51.43; Whispy Woods wind (0.35 u/frame) alternates direction every 30 s | Wind only; no damage |
| peach-castle | Princess Peach's Castle | 250 (20.0) | ±300 / 250 / −170 | Castle roof, solid central tower, two side platforms, bobbing switch platforms outside the edges; Bullet Bill sweeps the roof every 40 s | Switch blocks do not toggle; the bumper is omitted |
| rainbow-cruise | Rainbow Cruise | ship 200 (16.0) | ±240 / 210 / −140 | 25 s aboard the ship (deck, cabin, sails), then 65 s of scrolling rainbow course (platforms plus three solid chunks) before the ship loops back | Fixed camera treadmill instead of a moving camera; horizontal scroll only |
| kongo-jungle | Kongo Jungle | 164 (13.1) | ±240 / 220 / −150 | Deck with tapered underside, side platforms, a circling top platform, a barrel platform patrolling below | The barrel is a platform, not a cannon; Klap Trap bites the water on alternating sides |
| jungle-japes | Jungle Japes | banks 56 (4.5) | ±235 / 200 / −130 | Two banks, the hut floor and roof, high planks; a Klaptrap leaps from the river every 20 s | The river current is not simulated; the low bottom blast zone stands in for it |
| great-bay | Great Bay | 145 (11.6) | ±270 / 230 / −140 | Pier, lab roof, lookout, Tingle's drifting balloon; the turtle surfaces for 20 s, dives, and resurfaces with a warning and a bump | Tingle never pops; the turtle is a solid block |
| temple | Temple | West 135 (10.8) | ±420 / 300 / −230 | Raised west courtyard, bridge, lower east court, cave floor beneath the bridge, five platforms | Arches and slopes are boxes |
| brinstar | Brinstar | 160 (12.8) | ±220 / 200 / −120 | Raised center hump, three flesh platforms; acid rises every 30 s to 14 / −6 / 30 u, hitting every 45 frames | Flesh platforms cannot be destroyed |
| brinstar-depths | Brinstar Depths | 110 (8.8) | ±240 / 220 / −150 | Every 40 s Kraid rises (hazard below the stage) and "turns" the stage: the side platforms swap heights and the top platform slides across | No rotation; the platforms glide to mirrored positions instead |
| yoshi-island | Yoshi's Island | 71 per bank | ±230 / 200 / −130 | West bank and a raised east bank; spinning blocks bridge the gap and flip away 4 s of every 20 s; a drifting cloud | Pipe and Fly Guys omitted |
| green-greens | Green Greens | 200 (16.0) | ±240 / 210 / −120 | Star-block stacks at each side, three platforms; a bomb block falls every 15 s | The stacks are indestructible |
| corneria | Corneria | 195 (15.6) | −260/280 / 230 / −150 | Great Fox hull, tail fin, lower nose; every 25 s one Arwing strafes the deck low and a second one flies over the fin (both rideable) | Great Fox cannon omitted |
| venom | Venom | 280 (22.4) | ±260 / 230 / −150 | Long deck, bridge platform, two wing platforms underneath; Arwings sweep above and below the ship | Buildings and the tunnel are omitted |
| poke-floats | Poké Floats | Squirtle 150 (12.0) | ±260 / 220 / −160 | A looping parade of Squirtle, three-segment Onix, Poliwag, two-block Porygon and Snorlax, each bobbing; the drift speed pulses and briefly pauses | Horizontal treadmill; no vertical sections |
| mute-city | Mute City | 144 (11.5) | ±240 / 210 / −150 | Hover pad and wing platforms; every 45 s the track slides in underneath for 17 s, racers tear through, then the track races away | The pad does not move; one pair of racers per stop |
| big-blue | Big Blue | 130 (10.4) | ±250 / 210 / −160 | Bobbing flyer and top platform, two weaving side cars; the track below drags anyone touching it left at 1.4 u/frame | The track is a wind zone, not a floor; with hazards off it is gone |
| onett | Onett | 350 (28.0) | ±260 / 230 / −120 | Street, drugstore with two awnings, house and roof; a car crosses every 25 s, alternating direction | Awnings do not break |
| fourside | Fourside | 120 (9.6) | ±270 / 240 / −150 | Central tower between a low west roof and a tall east roof; swinging crane platform; the UFO visits for 20 s of every 40 s | The crane does not grab |
| icicle-mountain | Icicle Mountain | 160 (12.8) | ±170 / 190 / −110 | Vertical treadmill: climbs 60 u in 4 s, then rests 6 s; ice blocks and ledges repeat every 540 u | Up-scroll only; no Topi, condor or sliding ice |
| mushroom-kingdom | Mushroom Kingdom | 113 per ground | ±250 / 210 / −130 | Brick grounds, pipes, brick row, ? blocks; balance lifts oscillate opposite each other in the pit | The lifts do not respond to weight; the blocks do not break |
| mushroom-kingdom-ii | Mushroom Kingdom II | 94 per bank | ±250 / 220 / −140 | Two banks and a log bridge, tree platforms, Pidgit's carpet looping overhead; Birdo's egg crosses every 20 s | No falling logs |
| flat-zone | Flat Zone | 220 (17.6) | ±200 / 190 / −110 | The screen cycles Fire, Oil Panic and Helmet scenes every 25 s, each with its own platforms; in Helmet, tools fall in three lanes | Scenes swap platforms instantly |
| yoshi-island-64 | Yoshi's Island 64 | 160 (12.8) | ±220 / 200 / −120 | Three platforms and bobbing side clouds | The clouds do not vanish when stood on |
| kongo-jungle-64 | Kongo Jungle 64 | 140 (11.2) | ±210 / 200 / −120 | Uneven side platforms (20 / 34), a rising and falling top platform, a patrolling barrel platform | The barrel is a platform |

## Conventions for consumers

- `blocks[0]` at tick 0 is the stage's main floor. Default spawns spread across it, at −55%, 55%, −20% and 20% of its half width. Stages with split floors author their spawns. Default respawns hover 40 u above the highest surface near each spawn.
- Moving blocks carry `moving: true` and `dx`/`dy`: the top's movement since the previous tick. Treadmill pieces wrap only outside the blast zone, and report `0` on the wrap tick.
- A Stadium piece grows upward from the floor. The engine lifts any fighter whose feet it overlaps onto its top.
- `art` names a piece's look ('ship', 'turtle', 'car', 'arwing', 'fire', 'pipe', …). `palette` and `family` set the stage's art direction.
- `hazard.zones` shows the upcoming strike while `warning` is set, and deals damage only while `active`. A fighter is hit once per `cycle`, or every `rehit` frames while it stays inside. `push` is wind in m/frame. The Stadium hazard (`transform`) is informational: it has zero damage, and its label names the upcoming terrain.

## Art and map cards

`src/scene/stage/` builds each stage's art from these same blocks and platforms, so floors sit at block tops and walls at block sides. `tests/scene-stage.test.ts` fails if art crosses collision in the fighters' plane at sampled ticks. Every stage has its own backdrop and hazard telegraphs on top of that kit. The 30 map cards in `public/games/sky-clash/maps/` are 640×360 screenshots from the real renderer (`tools/stage-lab/shoot.mjs all card`), and `maps/manifest.json` records their sizes and hashes. None of the art comes from the original game.
