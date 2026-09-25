# Starship Scramble v2 — design contract

A ground-up rebuild (2026-09-24). The old version is gone; this file, `src/contracts.ts`, `src/content/types.ts`, `src/sim/index.ts` (signatures), `src/render/ship.ts` (signatures) and `src/defs/*` are the contract. The user's music in `public/games/starship-scramble/music/` and the four species stats are the only carried-over pieces.

## Pitch

Co-op FTL for the living room. One to four captains, **one ship each**, flying together as a fleet. Jump across branching sector maps, answer distress calls, shop, and fight real-time battles against enemy squadrons while the Crimson Armada closes in behind you. Destroy the Armada Flagship to win. A standard run is ~45 minutes (3 sectors + flagship); a short run is ~20 minutes (1 sector + flagship). Saves are supported.

What makes it better than the old version:
- **Tight, readable combat** with FTL's best decisions: target rooms, break shields with synchronized volleys, move crew to fight fires and boarders, beam crew across the fleet. Nine systems, not nineteen.
- **Co-op moments by design**: shields are broken by *volleys landing together* (lasers from several captains at once), support weapons repair and shield allies, teleporters rescue allies from boarders, and the fleet votes on routes and event choices together.
- **Nobody is eliminated**: a destroyed ship's crew aboard die, but after the battle the captain is rebuilt from a fleet reserve hull (or flies a lifeboat when reserves run out). The run is lost only if the whole fleet dies in one battle.
- **A TV that looks like a space battle**, not a spreadsheet: Blender-rendered hulls, per-sector backdrops, parallax stars, bolts and missiles with trails, rippling shield bubbles, explosions, fires, breaches, screen shake, floating damage numbers.
- **A phone that is quick to use**: your ship big on the left, weapon cards along the bottom, enemy target ships on the right. Two taps to fire, two taps to move crew.

## Run structure

Phases (`State.phase`): `hangar → map ⇄ (event | combat | store) → loot → map … → over`.

- **Hangar**: each captain picks a hull (Wayfarer, Lancer, Bulwark, Corsair, Halcyon), a name (≤16 chars; blank means "<captain>'s <hull>" when that fits, else the hull name) and a paint color, then readies. Duplicate hulls are allowed. Starts when every connected captain is ready.
- **Map**: a sector map of 7 columns (9 for a short run's single sector) × 2–4 rows of beacons with forward links; the final sector funnels into one trading post just before the Flagship. Captains vote for a linked next beacon on their phones. When all connected captains have voted the fleet jumps after 1.5 s; after the first vote there is a 20 s deadline (plurality, ties broken by seeded random). Node kinds are visible on the map except `unknown`. The Armada front (`armadaCol`) starts at −1 and advances one column per jump; entering a beacon at or behind the front triggers an Armada ambush fight (harder, less loot). The last column is the exit (next sector) — the final sector's exit is the Flagship.
- **Beacon arrival**: `hostile` → a short hostile intro event whose choices usually lead to combat; `distress`/`unknown`/`nebula` → an event from the library; `store` → a store; `exit` → next sector; `boss` → the Flagship fight.
- **Events**: text + choices; blue choices need a fleet capability (badge text like "Teleporter" or "Bastion crew"). Fleet vote with the same rules as the map. The result text and a list of plain effect lines ("+24 scrap each", "Wayfarer −3 hull") are shown, then everyone taps Continue (all connected ready, or 20 s).
- **Combat**: see below. Victory → **loot**. Escape (fleet FTL jump) → map, no loot. Defeat (every allied ship destroyed) → `over`.
- **Loot**: scrap is split evenly (remainder carries). Item cards (about one per captain) are tap-to-claim, first come first served, no quota; unclaimed items are lost on departure. Advance when all connected captains are ready.
- **Store**: shared stock of 2 + captains weapons (max 6, no duplicates, weapons the fleet already carries are rarer), 2–3 augments, an optional system only if some hull can still install it, and — at about 60% of posts — 1–2 named recruits with a fixed species and role. Services: hull repair (per point) and missiles (3 per purchase). Each captain pays from their own scrap. Selling returns half price. Advance when all ready.
- **Ship management** (map, event, loot and store phases — never in combat): upgrade system tiers with scrap, install an optional system in its empty room, equip/unequip weapons from cargo. Weapon slots are limited by `hull.weaponSlots`; powered weapons are the first `weapons level` slots.
- **Rebuild**: after a battle the fleet survives, each destroyed captain returns in a rebuilt ship: same hull, upgrades and equipped weapons kept, hull at 50%, surviving crew teleported home, topped up to 2 crew with fresh recruits. Costs one fleet reserve (Cadet 3, Captain 2). With no reserves the captain flies the `lifeboat` hull with their survivors. Cargo aboard a destroyed ship is lost.
- **Over**: victory after the Flagship's final phase dies; defeat if the whole fleet is destroyed. `finish` suspends. Outcome: every captain wins on victory.

## Combat rules

Time is combat time (`combat.t`, ms). Pause stops it. Any captain can pause/resume at any time; orders can be given while paused. A 3 s intro (ships warp in) runs before the first tick. Ships fight until every enemy is destroyed or fled (victory), the survive timer ends (victory), the fleet jumps away (escaped) or all allies are destroyed (defeat).

- **Systems** live in rooms. Effective level = tier − damage, or 0 while ionized.
  - **Helm**: the ship can dodge only while a living crew member is in the helm (automated hulls always count as crewed). Evasion = engines level × 5 + helm level × 3 + 5 (pilot role) + augments; 0 if helm uncrewed or helm level 0. Cap 60%. Cloak adds +60% (cap 90%).
  - **Engines**: evasion (above) and fleet FTL charge: the fleet FTL meter fills at (sum of allied engine levels) / (allies × 90 s) per second; at 1.0 captains can vote to jump (majority of connected captains). Never in boss fights.
  - **Shields**: layers = level (+ temporary Aegis layers, max 1 extra). A missing layer recharges in 2.0 s (×0.8 when crewed by an engineer, ×0.7 with Shield Capacitor).
  - **Weapons**: the first `level` installed weapons are powered and charge; unpowered weapons lose charge. Crewed by a gunner: charge 10% faster. Auto-Loader: 12% faster.
  - **Oxygen**: rooms refill 8%/s per level; with level 0 every room loses 3%/s. Breaches drain their room 12%/s. Crew below 15% oxygen lose 6 hp/s.
  - **Medbay**: heals crew inside by 8 hp/s per level. Medic role heals others in the same room 3 hp/s.
  - **Teleporter**: send up to 2 (level 1), 3, or 4 crew (never more than the pad has cells) to any room of any ship (ally or enemy). Crew already on the pad leave at once; selected crew elsewhere aboard walk to the pad and depart together when all have arrived and the teleporter is ready (a new move order cancels the queue); recall your crew from any ship back to your teleporter. Cooldown 20/15/10 s. Needs level ≥1. Recall is the panic button: it works during the cooldown (and restarts it).
  - **Cloak**: activate for 5/7/9 s, cooldown 25 s.
  - **Point defense**: shoots down one incoming missile/flak fragment every 6/4/3 s.
- **Weapons fire** when charged if they have a target and `auto` is on (default on); with auto off they hold charge until the captain's **Fire** (fires every charged, targeted weapon of that captain at once — the volley button). Targets persist between volleys until changed or the target is destroyed.
- **Projectiles** fly for 1.2–2.0 s (missiles slower). On arrival: evasion roll (miss) → if shield layers and the shot does not pierce: laser/flak bolt pops one layer (no damage); beam damage per room is reduced by layers; ion removes `ion` layers and locks shield recharge 4 s; missiles ignore shields. Otherwise hull −damage, target room system +damage (max tier), crew in room −crewDamage × damage, fire/breach rolls. Ion on an unshielded ship ionizes the room system for 6 s per ion. Support shots never miss and never hit shields.
- **Fire**: intensity 0–3 in a room; damages the system 1 level per 8 s at ≥1, crew 5 hp/s per intensity, burns oxygen, spreads through doors with small chance. Crew extinguish.
- **Crew AI**: crew stand on cell slots. Priority in their current room: fight hostile crew → extinguish → patch breach → repair system damage → man the system. Repair speed 1 damage level per 6 s per crew (engineer ×1.5, species factor). Melee 12 hp/s (soldier ×1.3, species factor). Movement 1.6 cells/s × species speed through doors. Captains order crew by room; **Stations** sends every owned crew on their current ship to their station.
- **Boarding**: teleported crew fight defenders; unopposed boarders damage the room's system and then move toward other systems. A crewed enemy (not the Flagship) whose last crew member aboard dies is scuttled: allied boarders beam home, their captain takes the kill, and it explodes. Enemy crew kill all your crew on a ship → nothing special; allied crew aboard a destroyed ship die.
- **Enemy AI** (`EnemyAi`): picks weapon targets among allied ships (`hunter` focuses the weakest, `weapons`/`shields` prefer those rooms, `boarder` teleports crew aboard), re-targets on destruction, moves its crew to fires/boarders, fires volleys together. Disconnected captains' ships run `autopilot`: auto-target the nearest enemy's shields or weapons.
- **Enemies flee** when hull/maxHull < `fleeBelow`: 15 s countdown (`fleeAtMs`) shown on the TV; destroy it first for the loot.
- **Hazards**: `asteroids` (random 1-damage rocks hit any ship every ~6 s, shields block), `solar` (every 20 s a flare starts fires on a random ship), `ion-storm` (all shield recharge 50% slower), `nebula` (evasion +10% for everyone, the map hides adjacent node kinds).
- **Boss**: the Flagship has 3 phases (`phases`); it never boards a lone captain, and fleets of 3–4 also face one or two Armada Gunship escorts (Cadet: one, for 4 captains). At 0 hull in a non-final phase it heals to the next phase's maxHull, swaps weapons/systems, clears fires, and the TV shows its line. The final phase at 0 hull wins the run.
- **Capacitors overheat** (stalemate breaker): after 60 s of fighting (post-intro) every ship's shield recharge slows linearly and stops entirely at 150 s, so a fight between armed ships always resolves; `overheat(combat)` in `contracts.ts` gives the 0..1 level for display.
- **Scaling**: enemies per fight by fleet size — 1 captain: 1 (sometimes 2 small); 2: 2; 3: 2–3; 4: 3. Each enemy's threat fits a budget that grows with sector tier and beacon column (sectors open gently; event squads are trimmed weakest-first and softened outside ambushes). Enemy hull scales with sector tier and fleet size and enemy weapons charge faster against bigger fleets (a lone captain lacks the fleet's combined volleys); Cadet −10% enemy hull (−25% for the Flagship, with no escorts) and 30% slower enemy charge.

## Presentation

### TV (display) — 1280×720 and 1920×1080, TV viewing distance
- Full-bleed canvas scene per sector backdrop (Blender renders) with parallax star layers. Allies on the left facing right, enemies on the right facing left (mirrored sprites), in loose formations with gentle drift/bob. Up to 4 allies + 3–4 enemies (+ boss, which dominates the right half).
- Each ship: Blender hull sprite tinted with paint mask, translucent interior rooms with system icons, crew figures (species color, owner ring), room damage (red hatch), fire (animated flames), breach (dark vent + particles), low oxygen (pink tint), ionized (blue sparks). Shield bubble ellipse around the hull with layer count; ripples/flash on block.
- Compact plate per ship: captain color + ship name, segmented hull bar, shield pips, weapon charge pips; enemies show name and flee countdown.
- Projectiles fly from the actual mount on the hull (weapon slot) with kind-specific visuals: laser bolts, missiles with smoke trails, beam sweeps, ion orbs, flak fragments, support nanite streams (green). Impacts: explosions, sparks, floating damage numbers, MISS text, screen shake on big hits, ship explosion with debris chunks.
- Header: sector name, objective, fleet FTL meter, pause banner "PAUSED by <name>". Footer only for urgent callouts.
- Non-combat phases: hangar bays (each captain's chosen ship large, stats, ready), sector map (nodes with icons, links, visited trail, Armada front as a red advancing wall, captain vote chips, countdown), event card over the backdrop (title, text, choices with badges and vote chips, result lines), loot table (item cards with claim chips, scrap split), store (stock + purchases feed). Results screen: victory/defeat, per-captain stats.
- Motion respects `prefers-reduced-motion` (no shake, fewer particles).

### Phone (controller) — landscape 568×320 up to 932×430; portrait shows RotatePrompt except hangar/map/event/loot/store menus (use `allowPortraitController`).
- Combat: left 60% — own ship large (canvas `drawShip` + transparent room buttons ≥44 px). Tap crew (or a room's crew chip) to select, tap a room to send. Right column — enemy/ally target ships as thumbnails; tapping one expands it for room targeting. Bottom — weapon cards (name, charge bar, target label, auto toggle); tap a card → tap a room on a target ship. Top bar — hull/shields/evasion, Pause, Fire volley, Stations, Cloak, Teleport. Teleport flow: select crew standing in your teleporter room → Teleport → pick ship → pick room. Recall button appears when you have crew on another ship.
- Own crew on other ships appear as a "Away team" chip; tapping it opens that ship for crew orders.
- Map: tappable reachable beacons + a Ship tab (upgrades, equipment). Event: choices as big buttons with badges and vote counts; Continue. Loot: claim buttons. Store: tabs Buy / Services / Sell. Hangar: hull carousel with the rendered sprite, stats, name input, paint swatches, Ready.
- States always shown: pending (action sent), accepted, rejected (server message), paused, wrecked/lifeboat, disconnected.
- PersonalView (host playing on the same screen): the TV scene with a docked control deck and mouse targeting; keyboard 1–4 select weapons, Space pause, F fire volley.

### Art (Blender)
- Top-down orthographic renders, transparent background, nose facing +x, following the sprite convention in `src/defs/geometry.ts` (SPRITE_PPC 64, margins 2 × 1.5 cells). Hull silhouettes wrap the room grid; the interior is darkened decking (rooms are drawn by the game on top). Engines at x<0, cockpit/nose past the helm. Separate white paint mask PNG per hull for captain tint. Enemy factions have distinct shape language: raiders (angular, welded plates, rust red), Vesk (organic chitin, green), Wardens (grey automated monoliths, blue lights), Armada (crimson, sharp, gold trim), Flagship (huge, layered).
- Files: `public/games/starship-scramble/ships/<hullId>.png`, `<hullId>-paint.png`; `backdrops/<sectorId>.jpg` (1920×1080); `art/` holds the Blender scripts that regenerate them.

## Content

- ~70 authored events across sectors: travel, distress, traders, science, factions and 2–3 multi-part quest chains. Many have blue options; some have no choice. Tone: wry, warm, readable in 10 seconds on a TV (≤ 280 characters of body text per screen).
- Sectors: `rustbelt` (Scrap Raiders, tier 1), `veil` (Vesk Hive, nebula, tier 2), `meridian` (Warden drones, tier 3). Standard runs visit all three; short runs visit only `rustbelt`. The last sector's exit column is a single `boss` node (the Flagship, in the `armada-reach` backdrop). Armada ambush ships can appear in any sector.
- ~16 enemy definitions + the 3-phase Flagship.
