# Stage reference map

Sky Clash has 30 authored arenas: one counterpart for each of Melee's 29 standard versus stages, plus Cloudbreak. The source roster is pinned to doldecomp/melee commit d504219dba4a5c5350aecd8e2f4969adeacb8b72. [GrKind and StKind](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/gr/forward.h) distinguish regular versus arenas from target tests, adventure routes, debug and unused stages. Neither enum's Max sentinel is a playable-stage count.

The checked-out source references external archives such as /GrIz.dat in grizumi.c, /GrZe.dat in grzebes.c and /GrNBa.dat in grbattle.c. Those archives are absent. No original stage models, textures, collision files or music were imported. Names, coordinates, platform motions, hazard values and procedural artwork below are authored adaptations. These are not equivalent original stage state machines or exact layouts. The source IDs document inspiration, not data extraction.

| Sky Clash arena | Source inspiration | GrKind | Authored layout / mechanic |
| --- | --- | --- | --- |
| Cloudbreak | Original Sky Clash arena | — | A 38-unit sky citadel with outer islands, lookout towers and a drifting bridge. Central platforms retain reachable 1.5-unit steps. |
| Crownkeep | Princess Peach’s Castle | 0x02 | Fight across castle rooftops. A flashing tower warns of a central blast. |
| Prism Voyage | Rainbow Cruise | 0x03 | A skyship deck and a traveling staircase of rainbow platforms. |
| Barrel Falls | Kongo Jungle | 0x04 | A timber bridge above rapids. Ride the rescue barrel platform below the ledge. |
| Canopy Crossing | Jungle Japes | 0x05 | Three separated huts over a river. Low bridges reward careful recoveries. |
| Turtle Lagoon | Great Bay | 0x06 | A coastal jetty, a lookout, and a broad turtle that ferries fighters across the bay. |
| Sunken Temple | Hyrule Temple | 0x07 | A sprawling ruin with high terraces and a lower refuge. The largest arena. |
| Ember Core | Brinstar | 0x08 | A split research cavern. Rising lava periodically swallows the lowest ledges. |
| Titan’s Orbit | Brinstar Depths | 0x09 | Four orbiting stone ledges circle a central fossil. The ledges remain horizontal. |
| Patchwork Parade | Yoshi’s Story | 0x0a | A stitched island chain with stepped platforms and a roaming cloud below. |
| Tilted Garden | Yoshi’s Island | 0x0b | Two grassy shelves and a bobbing central bridge create a changing low route. |
| Moonlit Fountain | Fountain of Dreams | 0x0c | Two independently rising platforms shimmer above a mirrored fountain. |
| Orchard Blocks | Green Greens | 0x0d | A great orchard tree divides three islands. A fruit blast threatens its right flank. |
| Starwing Deck | Corneria | 0x0e | An asymmetric carrier wing with a raised cockpit and a low forward gun deck. |
| Twin Thrusters | Venom | 0x0f | Four engine fins surround a narrow center. Airborne routes connect both sides. |
| Element Stadium | Pokémon Stadium | 0x10 | A wide arena with rising side terraces. The stadium cycles through four elements. |
| Balloon Beasts | Poké Floats | 0x11 | A procession of floating creatures. Their backs bob at different heights. |
| Neon Circuit | Mute City | 0x12 | A racing lift over a neon highway. A warning stripe precedes each passing racer. |
| Velocity Fleet | Big Blue | 0x13 | Battle on a convoy of hovering racers. Outer vehicles weave alongside the flagship. |
| Maple Avenue | Onett | 0x14 | Three neighborhood rooftops above a busy street. Watch for the traffic warning. |
| Midnight Skyline | Fourside | 0x15 | Leap between tall rooftops. A saucer circles above the central tower. |
| Glacier Ascent | Icicle Mountain | 0x16 | A fifteen-unit frozen climb with three elevators and staggered resting shelves. |
| Pixel Pipes | Mushroom Kingdom | 0x18 | Brick islands, twin pipes, and a moving elevator over a central gap. |
| Desert Doors | Mushroom Kingdom II | 0x19 | A desert gateway with a river gap. A flying carpet bridges its two banks. |
| Pocket LCD | Flat Zone | 0x1b | A wide monochrome machine with upper routes. A flashing machinery panel becomes electrified. |
| Breezy Meadow | Dream Land | 0x1c | Three classic platforms beneath a watchful tree. Periodic gusts alter aerial drift. |
| Cloud Garden | Yoshi’s Island (64) | 0x1d | A broad island and three platforms, with cloud stepping stones beyond both edges. |
| Sunset Canopy | Kongo Jungle (64) | 0x1e | A timber clearing with orbiting upper ledges and a low rescue barrel. |
| Astral Battlefield | Battlefield | 0x24 | A central triangular platform arrangement with outer terraces among ancient star rings. |
| Event Horizon | Final Destination | 0x25 | One uninterrupted platform above a cosmic rift. No platforms overhead or stage hazards. |

## Expanded arenas

Every arena spans at least 34 world units; Sunken Temple reaches 60. The `routes` table in `src/stages.ts` authors additional surfaces per map while preserving the original central layouts and fighter physics. Sky citadels have outlying islands and bridges, city maps have outer rooftops, fleet maps have additional ships, and Glacier Ascent climbs to y=15. Temple has a central lift with six units of vertical amplitude. Event Horizon intentionally keeps one continuous floor, now forty units wide. Outer landmarks, additional skyline layers and large arches distinguish the wider views.

Screenshots in `public/games/sky-clash/maps/` are real renders of these authored arenas. Thumbnail rendering freezes motion at frame zero and excludes fighters so layouts remain visible. They do not depict recovered original stage assets.

## Implementation limits

All collisions use horizontal one-way surfaces, with a solid-floor flag preventing deliberate down-drop. There are no ceiling or wall collisions, ledge grabs, walkable slopes, destructible blocks, true rotating terrain, automatic camera scrolling or transformation-specific collision sets. Orbiting ledges replace Brinstar Depths' rotation; elevators replace Icicle Mountain's scrolling course; Element Stadium changes terrace heights and presentation rather than swapping full terrain. Other hazard timings, damage and launch speeds are independently authored and should be playtested alongside the reconstructed fighter mechanics.

Platform motion uses the authoritative fight clock, which is frozen during character selection, map voting and countdown. The renderer samples the same formulas and interpolated clock. Riders are carried before hitstop, falling fighters sweep against each moving surface's previous and current heights, and respawns choose actual solid surfaces even on split floors. Map voting follows fighter selection in the lobby, before Ready. The host’s Start action locks choices; the highest vote count wins and the round seed resolves ties. The legacy timed-round selection and Random setting remain fallbacks for clients without lobby setup. Reduced motion suppresses decorative rotation and warning animation, never gameplay movement. See QA.md for checks and remaining human playtest limits.
