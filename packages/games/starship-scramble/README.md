# Starship Scramble

A cooperative fleet expedition for one to four captains. Each captain commands a separate ship and retains ownership of crew deployed aboard other vessels. Shared displays show the fleet; landscape phones show interiors and captain controls. A playing host can use the personal view without another device.

The complete game is integrated with PartyPlay. Actual room play, campaign tests, visual checks and remaining hardware limits are recorded in [QA.md](QA.md). The original scope is in [DESIGN.md](DESIGN.md).

## Architecture

- `src/contracts/index.ts` is the shared entity/action/view schema. Crew owner, historical home ship, current ship, and cargo carrier are separate fields. There is no power allocation model.
- `src/simulation/` owns room movement, crew work, targeting, weapon and system effects, drones, enemy behavior, and destruction. All gameplay timers use simulation time. Destruction kills everyone aboard in one batch and returns events for cargo and participation updates.
- `src/expedition/` owns seeded routes, persistent encounters, capability checks, contribution consent, personal stores and inventory transactions. Event definitions use a finite effect union. Browser modules import only presentation definitions, never outcomes or future content.
- `src/server.ts` composes the rules. Reliable actions run against a candidate state and commit only after successful validation, so a rejected purchase, teleport, or event cannot leave partial mutations. The server owns pause quorum, leader selection, phase changes, and full fleet consequences.
- `src/projections.ts` sends bounded fleet summaries and one additional inspected interior. Enemy detail depends on onboard owned crew or active scanning. Only the captain's own ship exposes weapon controls.
- `src/save.ts` validates versioned saves, definition references, ownership, locations, capacities and numeric bounds before producing a fresh candidate. Saved captain slots are assigned explicitly in the new room. A live reconnect keeps its existing seat.
- `src/ui/`, `src/render/`, `src/client.tsx` and `src/styles.css` implement the game presentation. Local navigation is independent of attack orders; accepted responses restore a previous interior only if the captain has not deliberately navigated elsewhere.
- `src/render/cutaway.ts` fits each hull exterior around its authoritative room grid; `src/ui/cutaway.tsx` draws the painted armor, interior equipment, doors and crew. Hangar previews and live room buttons use the same geometry. Version 2 deck plans use offset compartments and larger machinery rooms. Ordered crew cross real shared doorways; version 1 saves validate against their original layout before remapping positions within the same room.

Crew species live in the browser-safe `src/definitions/presentation/species.ts` catalogue. Simulation reads the same values for health, movement, melee and repair. Skills remain separate from species. Original SVG figures in `src/ui/crew.tsx` use stable crew IDs for appearance, with ownership rings and small names in the cutaway; the roster shows full names, species and traits.

The platform registration opts into bounded action history. The client uses monotonic command sequences and explicitly retires acknowledged or abandoned commands. The server retains a finite recent acknowledgement window and a retired watermark, so old purchases cannot run again after their acknowledgement is removed. Other games keep their existing action policy.

## Play

Choose a hull and mark ready. Vote for a connected beacon, resolve its encounter, then collect equipment or shop. A weapon order selects a weapon, target vessel, and room, and repeats until held or its target is gone. Crew follow room orders; direct movement is optional. Teleportation can use an operational allied transporter, but only the crew owner can authorize their transfer.

On landscape phones, the ship cutaway is the main view. Use the ship selector, Arms, Crew, or the captain menu to open secondary controls; the phase button opens the route, encounter, station or salvage screen. Hull selection opens a full cutaway preview before confirmation. Ship paint is separate from the captain color used to identify crew ownership. Route locations have consistent lane/column codes such as A1 and B1 on both screens; these identify destinations without implying undisclosed encounter risks or rewards.

New ships start with a mixed crew, and stations let you choose a recruit's species and skill independently. Species have modest fixed traits:

| Species | Trait |
| --- | --- |
| Human | 100 health; balanced movement, combat and repair |
| Bastion | 140 health; moves 20% slower |
| Skitter | 85 health; moves 25% faster |
| Ember | 25% more crew-combat damage; repairs 15% slower |

Existing saved crew without a species remain Human with their saved health. Crew bonuses affect that character, including aboard another captain's ship; they do not change ownership or weapon damage.

Any active captain can pause battle. Captains can queue orders and mark ready to resume; the expedition leader can explicitly continue without an idle captain. Disconnection pauses once for that disconnect episode. Spectators do not block active captains. Between battles, hostile damage stops while crew movement, repairs, healing and extraction continue, so reading an event or shopping does not cost lives.

At zero hull, the ship explodes and everyone physically aboard dies. Owned survivors elsewhere remain controllable. Scrap stays with its captain; equipment aboard the lost hull is destroyed. Loot has no allocation quota. The first accepted pickup receives an item personally, and one captain may collect the entire pile. Unclaimed items are discarded when the fleet leaves; there is no shared cargo pool.

Standard expeditions select five sector themes and visit thirty beacons. Training uses a short four-beacon route through store, event, battle and finale. Relaxed difficulty reduces hostile hull durability. The proposed 75–120 minute standard pacing target still needs ordinary human playtesting.

The host plays the supplied SpaceBattle playlist during combat, including tactical pause, and SpaceIdle elsewhere, from lobby through results. Phones retain their sound cues without duplicating the music. The shared Sound control mutes the soundtrack; leaving the game stops it. Music files stream individually from `public/games/starship-scramble/music/`.

## Save and resume

Use the room menu to download a save. Automatic room checkpoints use the platform's existing save service. A fresh room needs the same number of player seats, including eliminated captain slots; each player then chooses an unclaimed saved captain. Combat restores paused. Queued pause edits and held input are cleared on export; already accepted standing crew/weapon orders remain.

Finish session suspends the expedition; it does not declare victory. Permanent saved files are the way to continue after a room expires. Temporary room credentials are not an account or cloud save system.

## Development

Run from the platform checkout:

```sh
node --import tsx --test packages/games/starship-scramble/tests/*.test.ts
npm run typecheck
npm run lint
npm run build:isolated -- starship-unique-run
npm run serve:isolated -- starship-unique-run 4347
```

Use a fresh build name and an unused port. Game source and assets live in `game-modules`, reached through existing platform symlinks. Do not run Prettier or publish Git changes without separate user authorization.
