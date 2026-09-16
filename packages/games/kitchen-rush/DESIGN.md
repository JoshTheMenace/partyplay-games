# Kitchen Rush design

Original cooperative cooking campaign for 2–10 chefs, one watching display and phone controllers. Ten stages each run a 180-, 240- or 300-second service. Practice retains the finite service and real scoring, opens all stages and disables expiry, burning and environmental restrictions. It does not earn campaign stars. No music is included.

## Direction

Team17's [official Overcooked 2 overview and gallery](https://www.team17.com/games/overcooked-2) informed the cooperative preparation/cooking/serving loop, overhead kitchen composition, recipe tickets and ingredient throwing. No commercial art, characters, level arrangements or source are shipped. The original settings are Sunrise Diner, Canal Canteen, Clockwork Works and Rooftop Kitchen.

## Space and controls

Coordinates are metres: +X right, +Y up and +Z down-screen. The fixed orthographic camera sits at (0,22,31), looking at the origin. The floor is 18×12 for 2–4 chefs, 24×14 for 5–7 and 28×16 for 8–10. Movement matches the display axes. Chefs have radius .36 and slide against expanded 1.8×1.8 station footprints and world bounds. They pass one another to prevent ten-player deadlocks. Walking is 3.6 m/s; dash is 6.4 m/s for 350 ms with a 1,600 ms recharge. Dash taps use the acknowledged command queue so a quick press/release survives input coalescing. The burst uses normalized facing (updated by steering), continues after movement release and stops at obstacles; cooldown taps are acknowledged without deferring another burst. Disconnect cancels the burst. Spawns occupy the clear front lane.

Ingredients line the rear bank; boards sit left, cookers right, and dish supply/return/wash/bin/serve stations occupy the front. Open layouts have two central assembly counters. Split layouts have three central passes; conveyor stages replace them with belts. The bridge layout has one assembly counter and permanent rear/front crossings, encouraging shared preparation around one plate. Larger rosters receive extra boards, cookers, sinks and ovens. model.ts exports the actual dimensions and station coordinates.

The nearest station within 1.72 m is highlighted and named on the phone; facing adjusts close targeting ties. Tap Use to transfer once. Hold Use to chop, wash or extinguish, including after tap-place and release. Interrupted work is retained. Drop leaves the item on the floor. Toss sends food in the last movement direction and permits an empty-handed teammate to catch it; plates are carried. The controller sends complete held input plus a monotonic command sequence. Its four-entry command queue resends until the server acknowledges each command, preserving quick taps through input coalescing without a reliable-action stream. Blur/unmount releases controls; reconnect starts above the server's acknowledged sequence.

## Ownership and recovery

Every item has an ID and exactly one location: chef, station, floor, flight or pending dish return. Ingredients originate at crates. Plates have a fixed stock. Serving consumes a matching recipe once and returns that same plate dirty after five seconds. Washing restores it. The bin removes food but preserves plates, so mistakes cannot permanently exhaust dish stock. Disconnected chefs release their held item once on walkable ground; cooking and station progress remain authoritative. Reconnect restores the same chef. Sequential station interactions resolve contention without duplicated items.

## Recipes and work

| Recipe | Preparation |
| --- | --- |
| Garden salad | Chop lettuce and tomato; combine on a clean plate |
| Tomato soup | Chop tomato and onion, cook each on a stove, then plate |
| House burger | Cook a patty, chop lettuce, add both and a raw bun to a plate |
| Garden pizza | Plate raw dough, chopped tomato and cheese; bake the whole plate in an oven |

Chopping takes 2.4 seconds, stove cooking 6, oven baking 8 and washing 2.5. Dough cannot cook on a stove. Cooked food burns after another 10 powered seconds; a further 5 starts a contained station fire. Empty-handed Use extinguishes in 2 seconds, then the bin clears ruined food. Wrong plate mixtures can be emptied without discarding the plate. Plates accept at most three components.

Serving requires an exact recipe and a matching ticket whose deadline has not passed at interaction time. The oldest matching order is fulfilled. Rejected dishes stay in the chef's hands. Score combines recipe value, remaining-time tips and a capped consecutive-service bonus. Everyone shares score, stars and rank; individual contribution counts are descriptive.

## Ten-stage campaign

| Stage | New mechanic or combination |
| --- | --- |
| Fresh Start | Salads, chopping, plate assembly and service |
| Soup's On | Independent stove cooking and doneness |
| Lunch Line | Burgers and split preparation/cooking passes |
| Wash & Dash | Stock reduced to max(2, ceil(players / 2)) plates |
| Pizza Post | Whole-plate oven baking |
| Clockwork Crossing | 24-second bridge cycle: warn at 13 seconds, close at 17, reopen at 24; end crossings stay open |
| Conveyor Club | Three pass slots advance items once every three seconds without overwriting |
| Rooftop Gusts | 30-second cycle: warn at 18 seconds, halve speed in the central lane at 23, clear at 30; perimeter stays clear |
| Power Lunch | Cooker banks alternate every 18 seconds with a four-second warning; paused heat and burning clocks are retained |
| Grand Opening | Full menu, belts, alternating power and gusts together |

Normal plate stock is players + 2. Simultaneous tickets scale to 2/3/4 by roster; larger groups receive additional patience. The first-star target is round((seconds / 180) × (160 + players × 35) × (1 + stageIndex × .09)); second and third stars require twice and three times that score. At two players, stage one starts at 230 points. Deterministic cycling introduces every available recipe without requiring random selection.

Completed non-Practice results save best scores and stars in the display browser under party.kitchen-rush.campaign.v1. All ten stages are selectable immediately, regardless of prior completion. Invalid or blocked storage cannot crash a service or restrict stage access. The settings map shows all stages, challenges and earned stars. Play again returns to the lobby for stage selection. A first pass takes 30–50 minutes, with further play for better stars.

## Presentation and budgets

Rounded procedural counters, tiled floors, wooden trim, original chefs with visible hands/held food, colour plus number identity, utensil silhouettes, progress bars, steam, work animation and service feedback provide the visual language. Only the shared display loads Three.js. Reduced motion removes decorative animation while retaining essential work/timer state. Graphics preference reads tolerate blocked storage. Shared geometries/materials and ResourceScope own GPU lifetime.

Targets: p95 frame time ≤33.3 ms, warmup <3 seconds on the development desktop, 60 Hz rules, 20 Hz held inputs/snapshots and ≤500 draw calls. The revised camera, square chef-number textures, larger station labels and Drop contrast were inspected in build03; the ten-stage map fits at 1280×720 in build04. Actual build-specific results and remaining gates live in output/kitchen-rush/QA.md. Compilation and scripted desktop play do not establish physical touch, Wi-Fi, thermal behavior, TV-distance readability or human group enjoyment.
