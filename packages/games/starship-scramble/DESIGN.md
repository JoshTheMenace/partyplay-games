# Starship Scramble: cooperative fleet expedition

Design and implementation handoff · revised 2026-09-12 · Status: full-game plan for review, no game implementation yet.

Build an original FTL-inspired expedition for one to four players. Every player commands, customizes, and cares for their own ship. The fleet travels together, encounters the same events, fights together, and shares access to reward items. A shared display shows the entire battle. Landscape phones show the task each captain is performing.

This document supersedes the shared-ship proposal, TV inspection-panel sketch, power-allocation rules, and disabled-ship recovery proposal. It records the user's latest requirements and a coordinated multi-subagent build strategy. The user has explicitly requested subagents for the eventual build; the coordinator should use them under section 12's ownership and integration rules. The current task updates the plan only. It does not start game implementation, create user-owned Codex tasks, authorize Claude consultation, or authorize Git publication.

## 1. Decisions and recommended defaults

### Requirements established by the user

- One to four players; one independently customizable ship per player.
- A cooperative fleet journey through shared beacons and events, with fleet battles, exploration, rewards, and stores.
- The TV always presents the overall situation, including every allied ship and every major enemy ship. Teammate representations can be minimal. Full ship interiors do not need to fill the TV.
- Each landscape phone defaults to its player's own ship interior. A persistent ship switcher can show any teammate or encountered enemy vessel. On another ship, the player can command their own crew there. Viewing a ship never grants ownership or control over someone else's crew.
- Weapon selection still supports enemy and system targeting; ordinary ship inspection and visitor control do not require starting an attack.
- There is no power allocation, reactor, power grid, or power-failure mechanic. Installed systems work according to room/system upgrades and damage. For example, upgrading weaponry can unlock a third equipped gun.
- Monetary rewards are either divided evenly or put in a shared wallet. Both were acceptable; no final selection was made.
- Reward items appear in a common loot screen. Tap an item to collect it. No claim/pass/offer workflow, draft, quota, or enforced fair distribution. One captain may collect everything.
- Major reward packages should generally contain multiple items, with roughly one major item per player as the starting idea.
- A teleporter can send a player's crew to an ally's ship to move around, repair, or help defeat boarders. Cross-ship collaboration is part of the game, not just presentation.
- Crew ownership never transfers to the captain of a ship they visit. A friendly guest in an eligible room automatically helps man that system, such as shields or piloting, without giving the host captain command rights over the guest.
- At zero hull a ship blows up. Crew aboard are lost; that player continues through their own surviving crew on other ships. Strategically distributing crew before destruction matters.
- The deliverable is a full, polished game with a large event library, many enemy/weapon/system types, and choose-your-own-adventure beacons. It is not an MVP. Some events have no decision, some a small choice set, and some semi-rare equipment-dependent alternatives.
- Plan parallel implementation using multiple subagents with explicit interfaces, file ownership, and integration gates.

### Defaults recommended for review

| Decision | Proposed full-release rule | Reason |
| --- | --- | --- |
| Scrap | Automatically split monetary rewards evenly into personal wallets | Each captain can customize and shop independently without spending another captain's funds. |
| Crew control | Captain-level orders plus optional direct control of one owned crew member | Preserves FTL-style management while making boarding and rescue hands-on. |
| Time | Real-time combat with shared tactical pause and queued orders | Gives phone users time to target systems and coordinate. |
| Rendering | Authored 2D ship art and room layouts; Canvas 2D battle display, accessible React controls | Room readability and touch accuracy are the priority. Full 3D is unnecessary for this design. |
| Expedition | Five sectors, roughly 25–35 visited beacons, about 75–120 minutes including decisions | Substantial play with a clear destination; saving makes it suitable for multiple sittings. Duration is a playtest target. |
| Ship building | Distinct authored hull layouts, room upgrade tiers, weapon slots, crew, and augments | Supports meaningful builds without a power-management layer. |
| Survival consequences | Crew on a destroyed vessel die; surviving owned crew elsewhere remain playable; no automatic replacement | Implements the user's destruction rule and makes crew distribution a meaningful risk decision. |
| Content scale | 300 distinct encounter scenarios, plus separately counted branches/variants | A substantial design budget; research does not establish an exact FTL encounter total. |
| New players during a run | Reconnect existing captains; new seats wait until a new/resumed expedition | Matches current PartyPlay roster behavior. Mid-run drop-in is not implemented by the platform. |

These defaults are not claims that the user already approved each detail. An implementing agent should use the reviewed version of this document and report any necessary departure.

## 2. The experience

A typical encounter: four ships arrive at a derelict station. The fleet chooses to investigate. A salvage ship's equipment reveals a safer entrance; a different captain contributes crew. Raiders arrive while the extraction is underway. One captain hacks an enemy shield system, another lines up an artillery shot, and a support captain sends a repair drone to a damaged ally. A fourth teleports a crew member over to repel boarders. The TV makes these relationships visible while each phone presents the relevant controls.

Afterward, scrap is credited automatically. Everyone sees the same item pile and taps what they want. The fleet chooses its next beacon, shops or refits where available, and continues. Ship builds and crew injuries carry forward. The finale tests the fleet's complementary capabilities, not just aggregate damage.

The primary loop is:

`Choose ships → choose beacon → resolve event / battle / store → collect rewards → refit → jump together → sector climax → expedition finale → results / replay`

There are two distinct layers of progress: improvement within the expedition and a record of completed expeditions. The first release should include the complete expedition loop and durable run saves. Account-based progression, cross-device unlock synchronization, and a metagame are separate features, not prerequisites for a good run.

Solo uses exactly one ship and the same meaningful systems. Crew automate routine work. Encounters always offer a solo-completable path; no mandatory allied teleporter, simultaneous multi-ship switch, or support-only starting build. Do not add three compulsory AI fleetmates to claim solo support.

## 3. TV and phone responsibilities

### Shared display

The display is a stable battle overview. Allied ships occupy a consistent formation on one side; enemies occupy readable opposing positions. Authored formation anchors make all active major ships visible without uncontrolled camera zoom. Players issue tactical orders rather than fly ships around a physics arena. Formation visuals do not imply collision, range, or interception mechanics unless the rules implement them.

Show each ship's recognizable hull art, owner/name or enemy identifier, hull/shields, current target when useful, and a few urgent conditions. Show moving weapons fire, shield impacts, teleporter links, repair drones, ship destruction, and imminent enemy attacks. Pair status icons with concise readable labels when action is required. Keep long-term statistics, inventory, room labels, and detailed crew bars off the battle overview.

Enemy identifiers remain stable for the whole encounter and match phone targeting. Do not renumber survivors after E2 is destroyed. Teammate formation slots remain stable through damage, reconnect, and destruction; a compact lost-ship marker can show that captain's surviving crew locations. Tiny cosmetic fighters are effects or a counted drone group, not additional hidden major enemies with independent unexplained turns.

Prototype a maximum of four allies and six major enemies, including a large flagship. Reserve room for that configuration at 1280×720. If it fails at TV viewing distance, redesign the arrangement or encounter composition before increasing the cap. Use formations, spacing, silhouette variety, and selective target lines; do not solve density by making all text smaller.

There is no automatic TV interior takeover and no shared inspection panel in the base design. Phone selection must never steer the TV camera or hide another player's battle. Show a compact emergency cue such as “Mira · Boarders in engines” and a matching marker on the ship. Multiple emergencies must coexist without an unreadable ticker or overlapping alerts.

Outside combat the TV changes to the shared event, route map, store overview, reward summary, or expedition results. This is a fleet phase change, not one player's private navigation.

### Personal landscape phone

Own ship is the initial interior view. Keep a persistent ship switcher showing the player's ship, other allied ships, and all encountered enemy ships, with the same identities as the TV. Selecting a ship opens its available interior information without targeting or teleporting anything. Show owned-crew counts and urgent conditions beside vessel names. A player can inspect any encountered enemy, but sensors and onboard crew determine the detail revealed, not whether that vessel can be selected.

Track viewedShipId separately from the captain's currentOwnedShipId, selectedCrewId, and weaponTargetShipId. Own ship and primary ship controls always use currentOwnedShipId, including after a purchased replacement. A crew member's original homeShipId is historical and never selects the primary UI or grants command rights. Switching the view must not change ownership, issue orders, cancel another ship's accepted attacks, or affect the TV. On an ally or enemy vessel, highlight only the viewer's owned crew as controllable. Other crew remain visible as information. Ship controls identify their owning ship; do not show an ally's weapon buttons as though the viewer owns them.

Use a local navigation state machine with a reliable Own ship action and a persistent crew-location shortcut:

| View | Main content | Main interaction | Exit behavior |
| --- | --- | --- | --- |
| Own ship | Room layout, owned and visiting crew, upgrade tiers, room damage | Tap room or owned crew; issue contextual orders; select owned weapon | Default home view while the ship exists |
| Ship switcher / inspected ship | Any allied or encountered enemy ship; permitted interior detail; owned crew there | Switch freely; inspect systems; select and command owned crew on that vessel | Remains on that vessel until changed; Own ship is always available while it exists |
| Weapon selection | Owned installed weapons, readiness, ammunition, current orders | Choose a weapon or defined weapon group | Back restores the previous interior |
| Enemy selection | All legal enemy targets with matching TV identities | Tap a ship | Back preserves weapon selection |
| System targeting | Selected enemy's known room layout and targetable systems | Tap a legal room/system | Accepted order restores the previous interior; normally Own ship |
| Crew direct control | Viewed vessel occupied by the selected owned crew member | Movement on left; contextual actions on right | Changing views releases direct input; the crew remains in its actual location |
| Teleporter | Eligible owned crew and legal destination ships/rooms | Select crew and destination; send once | Accepted transfer opens that crew's destination view |
| Loot | Shared available items and each item's basic value/function | Tap to collect | Pending pickup resolves visibly; no per-item confirmation |
| Store / refit | Personal scrap, items, installation slots, existing loadout | Buy, sell, install, replace where permitted | Return to current fleet phase |
| Event / route | Shared description and personal vote/contribution | Choose, contribute, or mark ready | Fleet resolution drives transition |

Weapon order submission is the only step that commits an attack. Earlier target selection is local, cancellable UI. Preserve the selected weapon when navigating backward. On accepted acknowledgement, restore the interior the player was using before targeting, normally their own ship, and show the target/order on that weapon. This preserves an intentionally selected boarding view. Match the acknowledgement to the navigation request: it must not overwrite a newer deliberate ship switch, and the return vessel must still exist. Otherwise retain the newer view or fall back to My survivors. If the target died, became inaccessible, or is no longer legal, keep the targeting view open with an explanation and valid alternatives. Never silently target a different system or show success before acknowledgement. Inspecting an enemy can offer a shortcut into targeting with an owned weapon; inspection alone never fires.

Attacks execute when ready. Default weapons retain their chosen valid target and repeat automatically, with a prominent hold-fire toggle; ammunition-consuming weapons show that behavior clearly. Players should not need to repeat the three-screen targeting process for every laser pulse. A destroyed target stops the order and requests retargeting rather than consuming ammunition on an arbitrary replacement.

Targeting and inspection keep a compact own-ship danger strip and crew-location shortcuts. Do not force a navigation change every time damage arrives. If the home ship is destroyed, Own ship becomes My survivors and opens the player's surviving-crew roster/current vessel; unavailable ship controls disappear. If the viewed vessel is destroyed, show its loss, release input, clear dead selections, and offer the surviving owned crew's locations. A fully eliminated player gets a clear spectator view, not an empty or broken ship screen.

Crew room selection needs large actual hit targets, not a transparent full-screen touch layer with inaccurate coordinates. Fit authored layouts using a common geometry definition for art and hit testing. If a room is too small for a 44px target, use an accessible selection list or deliberate local zoom. No mandatory pinch gesture for routine orders. Ordinary inventory and store lists may scroll; movement surfaces alone suppress browser gestures.

The game stays playable with browser bars, safe-area insets, and without fullscreen permission. Lobbies/results can use their shared shell layout. Active phone gameplay is landscape. Test portrait rotation while holding movement, during targeting, and during a pending pickup.

### Solo / playing-host view

Implement PersonalView, not just supportsSolo in the manifest. On a desktop it combines the fleet overview with the selected ship/task controls. On a narrow landscape device it prioritizes the same captain interface and offers a fleet overview tab. Keyboard/mouse can issue crew, weapon, and pause orders without a phone. This uses the existing host-player room flow; it is not a new phones-only transport mode.

## 4. Ships, crew, and combat

### Ship model

Each captain begins with a ship and a starting crew. Ships have hull, shields, piloting, engines/evasion, weaponry, life support, doors, a medical facility, and optional systems such as teleporter, hacking, cloak, drone bay, or repair support. Systems compete for equipment slots, upgrade scrap, ammunition/consumables where applicable, and tactical opportunity. There is no reactor, power budget, battery, power routing, or power-room failure, including a renamed equivalent hidden in the rules.

A room/system's purchased tier defines its capabilities and capacity. Damage lowers its effective function until crew repair it; repair restores the purchased capability and does not buy an upgrade. Upgrading weaponry from tier 2 to tier 3 can unlock a third equipped gun, up to the hull's authored maximum. Higher tiers can also improve durability or specialized performance. Temporary damage may disable weapon slots in a deterministic, visibly indicated order; it never deletes installed equipment or permanently downgrades a purchased tier. Repairing restores disabled slots. The exact upgrade curve is authored data shared by simulation, store descriptions, and UI validation.

Author eight launch hulls with distinct layouts and specializations: balanced explorer, defensive escort, artillery ship, boarding ship, support carrier, evasive scout, salvage specialist, and electronic-warfare ship. Every starting configuration must survive solo. Optional fleet specialization should emerge through upgrades and player choices. Allow duplicate hull selections and make duplicate ships visually distinguishable.

Use roughly 6–12 rooms, 3–5 starting crew, and a maximum of 8 living owned crew per captain as initial production bounds. A recruitment at that cap offers an explicit roster replacement/decline; it cannot silently exceed the cap or delete a guest. Visiting crew do not consume the host captain's recruitment slots: test up to all 32 friendly crew congregating on one ship plus a maximum of 8 hostile boarders there. Give rooms physical occupancy limits and deterministic legal landing positions; reject a full destination before teleporting. Every player hull must have legal standing space for that declared maximum even if its specialist stations have lower manning capacity. Rooms can differ in size and adjacency, but authored hulls must pass phone readability checks before content expansion. Customization includes hull paint/name, weapon mounts, room/system tiers, crew composition, and augments. Arbitrary player-drawn floor plans are outside the planned full release.

### Combat model

- Weapons have explicit charge time, slot/tier requirements, ammunition where applicable, target rules, shield interaction, damage, and secondary effects. Beam, ion, missile, laser, drone, and support families must behave differently. Ion/EMP effects temporarily disrupt a named system; they do not drain an invented power resource.
- Crew travel through a real room/door graph. Occupancy, locked doors, vacuum, enemy boarders, damaged systems, and unreachable destinations affect orders.
- Fires, breaches, oxygen loss, injuries, system damage, repair, and boarding are server-simulated. Visual effects explain actual outcomes.
- Crew follow their owner's standing assignments and safe repair priorities. Only that owner can override them, even on another ship. Opening a target picker does not stop routine crew work.
- Enemy AI has understandable priorities and telegraphed dangerous actions. Scale fleet threat using composition, equipment, targeting, and encounter objectives, not only proportional hull inflation or one enemy per captain.
- Some encounters involve escape, defense, surrender, rescue, or surviving a hazard. Every legal outcome has a defined reward/transition policy and cannot leave the expedition stuck in combat.

Coordinate contract: ship interiors use a bounded 2D tile grid with x increasing right, y increasing down, and one tile as the base movement unit. Room rectangles and door connections come from authored layout data. Crew collision uses simple bounded circles/occupancy and room connectivity, with tested spawn placement. No rigid-body physics dependency. Ship positions on the TV use a separate normalized presentation coordinate system and do not affect room simulation.

### Teleporting and shared work

Crew retain their owning captain and original home-ship reference while their current ship/room changes. A captain can command only their own crew. The host captain cannot select, move, recall, reassign, dismiss, or give orders to guests. Visiting does not grant control over the host's weapons, inventory, doors, or crew. The visiting player's phone can select the destination through the ship switcher and control their own crew there. The ally sees that helper in the same authoritative interior. Captains are player identities, not a special crew avatar whose survival overrides the rest of their roster.

Friendly teleport destinations are available by default when the upgrade is installed, charged, and undamaged enough to operate. Enemy boarding has additional explicit shield/defense rules. The server validates crew ownership, living status, source/destination, upgrade/tier requirements, cooldown, destination capacity, and a valid spawn before atomically moving any unit. Duplicate transfer actions cannot create duplicate crew.

Direct control uses a left-side movement pad and right-side context actions: repair, fight, heal, interact, or recall. Standing room orders remain available as an alternative. Directly controlled crew return to a sensible hold/defend behavior when input stops; losing phone focus must not send them walking indefinitely. Home-ship AI continues routine work while its captain controls a visitor.

The teleporter supports recall of that captain's deployed crew to a valid surviving home vessel. A stranded crew owner can request transport through an operational allied teleporter under a defined friendly-access/cooldown policy. The transporter owner may permit access to the system, but cannot independently relocate the guest; the guest owner's accepted order authorizes movement. Friendly visitors stay where their owner placed them after combat. Never automatically recall everyone at victory or try to return them to a destroyed home ship. Escaping a doomed vessel must happen before it reaches zero hull.

Resolve crew aboard enemy ships before removing an encounter vessel. Surrender opens an owner-controlled extraction opportunity; it does not silently teleport boarders home. Enemy escape is telegraphed and completes only after its explicit timer; owned crew still aboard when it escapes are marked lost/captured and leave the active controllable roster. A later authored rescue can restore those identities, but no such rescue is guaranteed. The fleet's own jump warns of stranded owned crew and requires the affected owner's acknowledgement before abandoning them, with the existing disconnected-player leader fallback. Keep surrendered ships in the encounter until extraction/abandonment resolves. Test a captain whose only survivors are aboard each of these enemy states.

### Automatic manning by friendly crew

A living friendly crew member who is stationary and available in an eligible room automatically mans it, regardless of who owns that crew member. Piloting can improve evasion; shields can improve recharge; weaponry can improve reload; medical or engineering stations can improve their relevant work. These are passive system-stat benefits, not permission for the host to command the guest. A boarder on an enemy ship never boosts the enemy's systems.

Use authored station capacity and capped bonuses. Recommended default: one primary operator per system, with the best eligible skill bonus chosen deterministically; extra crew can repair or fight but do not multiply manning bonuses without a specific upgrade. Movement, fighting, active repair, incapacitation, departure, and death remove that crew member's manning eligibility immediately. Owner-issued orders take priority over automatic manning. Do not let host-issued room priorities rewrite visiting crew orders. Recalculate effective stats from crew location/activity and system state; do not save cached bonus totals that can stack after reconnect.

### Ship destruction and surviving players

Zero hull destroys the ship permanently and kills all crew physically aboard at the destruction step, including allied guests and enemy boarders. Remove its active systems and targetability, show the explosion, and retain a compact tombstone for saved IDs and outcome history. There is no disabled grace state, automatic replacement hull, free rescue drone, or post-explosion evacuation. Crew already on a different surviving vessel live and remain controllable by their original owner. Their ownership and home-ship reference do not transfer to the host captain.

Centralize destruction in one simulation rule. Define the step ordering before parallel work: process accepted orders and activity changes; resolve movement/teleport completions; recompute manning before any attack uses derived stats; resolve combat/hazard damage and destruction; recompute eligibility after casualties; then commit economy/encounter consequences and outcomes. A transfer completed before damage survives elsewhere; an unfinished transfer does not. Animation timing never decides survival. Launched projectiles may finish their trajectory after the firing ship dies, but cancel that ship's unlaunched attacks, queued orders, room effects, and invalid destinations. Resolve simultaneous destruction as a batch before deciding victory or defeat.

Recommended consequence policy: installed equipment and physical cargo aboard the destroyed vessel are lost. Keep cargo location separate from item ownership so survivors can store later pickups on a surviving allied vessel without transferring ownership. Personal scrap remains a captain-held currency, not a physical cargo item. Each active captain has a persistent cargo destination: default to their own surviving ship, otherwise the first surviving ally in stable formation order, with a visible option to change it at a safe phase. Crew presence on that carrier is not required, so survivors aboard an enemy can still collect into the allied fleet. The host cannot seize personally owned cargo merely by carrying it. A pickup uses this destination atomically without adding a per-item dialog. If no friendly carrier exists, do not award rewards before resolving fleet defeat.

Shared cargo has its own explicit carrier, defaulting to the first surviving allied ship. The expedition leader can designate a different carrier at a safe phase; personally owned cargo transfers require its owner's action. Removing items from shared cargo still uses unrestricted tap-to-collect. UI shows carrier location and destruction risk. These physical-cargo rules are proposed defaults beyond the user's loot instructions and must be reviewed consistently with the desired loss severity.

A shipless captain with living owned crew remains an active participant: switch to those vessels, move/repair/fight/man rooms, use authorized transport, collect items, and participate in choices. They cannot remotely use destroyed weapons or take command of an ally's ship. Recommended full-release policy: optional ship purchase/salvage events may provide a new vessel for that same captain slot, with an explicit cost or event consequence; this is not automatic resurrection and does not restore dead crew or the old ship.

If a captain has no living, available owned crew, they become a spectator; they cannot borrow command of someone else's crew. They do not block readiness, pause-resume, or votes, and leader succession excludes them. Their slot, wallet, cargo ownership, and result history remain saved. Optional recruitment/rescue events can explicitly restore participation by assigning newly acquired/recovered crew to that slot; there is no guaranteed immediate recovery. During such an explicit recovery choice the recipient may accept the cost from their own wallet without unlocking unrelated spectator actions. This elimination policy is a proposed consequence to review, not a reason to weaken the user's zero-hull rule.

A surviving ship whose owning captain is eliminated does not change owner. It follows conservative existing defensive/flight automation, makes no new discretionary purchases or attacks, and travels with the fleet if a living friendly pilot/crew can operate it. Guests can man and repair it under their own owners' commands, but cannot retarget its weapons or inherit captain controls. An uncrewed intact vessel waits for friendly crew transfer; abandonment is an explicit fleet decision. Recruitment can restore its original captain slot. This rule avoids both ghost player control and an unexplained mid-run transfer of ship ownership.

Recommended expedition defeat rule: the run ends when every allied ship is destroyed/explicitly lost, or no available player-owned crew survive. Temporarily damaged engines, missing pilots that surviving crew can replace, or repairable systems are not automatic defeat; resolve repairs and crew transfers before travel. Crew stranded on enemy vessels do not by themselves provide a jump-capable fleet when all allied hulls are gone; capturing ships would require a separate explicit ownership-transfer mechanic. End-of-combat recovery cannot invent one. Results emphasize the fleet outcome and contributions, including help provided before loss, rather than ranking only surviving ships by damage.

## 5. Time, pause, and cooperation

Real-time combat advances a game-owned simulation clock. Pausing freezes that clock, including movement, projectiles, charge, fire, oxygen, AI, teleporter cooldowns, and timed combat objectives. Wall time continues for connection health and UI. Never use serverNowMs directly to finish a weapon charge while the simulation is paused.

Any active captain can request tactical pause. Show who paused and each connected captain's readiness. Everyone can queue target, crew, and system-ability orders; queued commands take effect under the deterministic ordering in section 4 when play resumes. Editing a queued order clears that captain's ready state. Keep queues bounded by storing the latest intended order per weapon/crew/system rather than an unlimited command script. Eliminated spectators cannot block or repeatedly pause active players.

Resume when all eligible connected captains are ready. In solo, Pause/Resume is one action. Do not use a silent deadline that resumes underneath a player. A visible expedition-leader fallback may resume without an idle captain; this is a proposed recovery rule, not host authority inferred from client props. Record the leader's captain ID in game state and validate any leader-only action server-side. A watching host is not automatically a GameRules player and cannot send game.action as one.

When an active player's phone disconnects in combat, pause once for that disconnect episode and clear its direct-control input. Connected captains can explicitly continue with that player's crew following conservative standing orders; this never transfers command to another player. Automation does not spend scrap, collect items, teleport, or choose routes on the absent player's behalf. Returning players reclaim their original captain slot and surviving owned crew through existing seat credentials, even if their home ship was destroyed. At noncombat phases, disconnected captains cannot block all-ready forever; show that they are absent and allow the connected roster to continue deliberately. If nobody active remains connected, stay paused until room teardown/recovery.

Do not implement global slow motion, pause tokens, or simultaneous ten-second turns in the first release. Evaluate those only if group testing shows the proposed pause model is routinely frustrating. Whether strategic screens are timed is a separate rule: default events, loot, shops, and refits have no countdown.

## 6. Beacons, rewards, stores, and customization

### Shared travel and events

All captains visit one selected beacon together. Generate a seeded branching route with reachable exits, varied encounter types, sector themes, and bounded backtracking. A visible pursuit/threat track provides route pressure through jumps and decisions, not real-world time spent reading or shopping. It cannot advance while the group is taking a break.

Route and event choices, when there is a choice, use private phone votes shown collectively on the TV. Resolve on agreement or an explicit leader tie-break; do not silently award the choice to the fastest tap. A captain may change their vote before commitment. Contributions of a ship system, crew, or personal scrap require that owner's accepted contribution action. Another captain's vote cannot spend it. Participation follows surviving captains, not the original number of ships. A lost ship's equipment cannot unlock an option, while that captain's surviving specialist on an ally can.

Every newly visited beacon has an event instance, even when it is only quiet travel, a discovery, or an unavoidable encounter. Generate and persist it once on arrival. Reloading, pausing, changing a vote, or reopening an event must not reroll the outcome. An already resolved beacon does not generate new loot on a repeat visit. Conditional options reveal enough information to understand the requirement without sending future branches or random results to clients.

### FTL-style event structure and special options

Follow FTL's compact encounter grammar: short situation text, zero or a few actions, optional capability-based alternatives, consequences, and sometimes a follow-up node or combat. A zero-choice event applies its authoritative result once and provides Continue after readable feedback; do not invent a meaningless vote. Common decision events have one or two ordinary choices, occasionally three where the situation warrants it. A selected branch can produce deterministic or weighted consequences, change a later beacon, start combat, or award loot. It need not always become a multi-page story.

Use zero to two special capability options per event. Eligibility can depend on an actual room tier, installed weapon family, operational teleporter, drone, hacking system, carried item, living crew trait, or deliberate combination across the fleet. Evaluate the real supplying ship/crew/item and revalidate at commitment. Do not turn the whole team's possession of a teleporter into a special answer at every beacon. Losing or consuming the required capability invalidates the option with an explanation rather than charging a different captain.

Initial rarity targets for balance testing: author special options in roughly 15–25% of scenario roots and aim for a fitting build to encounter an available special solution at roughly 10–20% of visited beacons. These are measured distribution targets, not a runtime quota or a promise of FTL's exact probabilities. Some runs/builds will differ. Do not select events just to guarantee a matching option or force a perfect counter. A special option should feel like equipment paying off; it can provide a safer outcome, different reward, shortcut, or new risk, not invariably the single correct answer. Keep normal options viable.

Use declarative, versioned event definitions with root ID, region/faction tags, weight, repeat/uniqueness policy, entry conditions, text IDs, choices, capability predicates, owner-consented contributions, effects, and follow-ups. Conditions and effects reference a finite typed registry implemented by the rules; no arbitrary eval or client-side outcome logic. Keep capabilities such as weapons.tier, teleporter.range, crew.skill, and item.tag independent of UI wording. Unsupported predicates/effects fail validation. Freeze choice IDs per instance and record resolved outcomes so retries, load, and changed equipment cannot duplicate or reroll them.

### Scrap

Recommended default: each reward has a total monetary amount that is divided evenly among expedition ship slots, credited once when the reward is created. Generate ordinary totals as multiples of the fixed expedition roster size. For unusual odd amounts, retain an integer remainder in the expedition and carry it into the next distribution; never drop or duplicate currency.

Disconnected and shipless captains retain their equal share. Recommended default also preserves the original slot's share after elimination for a possible later recruitment; neither the denominator nor already-earned wallets change mid-battle. Spectators cannot spend or collect until explicitly restored to participation. Each active captain spends their own wallet in stores and upgrades. Solo receives the full solo-scaled reward. Reward generation scales its total for fleet size, so a four-player run does not give each captain a quarter of the intended upgrade curve.

The user also allowed a shared wallet. If they choose it during review, replace this rule consistently in reward, spending, store, save, and concurrency tests. Do not implement both economy modes just to avoid choosing a default. A shared wallet would still require atomic purchases against one balance, without inventing purchase voting unless requested.

### Items and the loot screen

The shared pile contains unique item instances. A normal major victory generates about one major item per expedition ship, plus appropriate consumables/materials. Small events may give scrap only or fewer items; rare encounters can give more. This is reward generation guidance, not an allocation limit.

All phones see the same currently available items. Tap once to collect. The card shows pending feedback, then the receiving captain's inventory updates and the item leaves the pile for everyone. No Claim, Pass, Offer, distribution vote, rarity draft, per-player collection limit, or first-pick rotation. One captain collecting the entire pile is a supported behavior and an acceptance test.

If two people tap the same instance, the first valid server-processed action receives it. The other gets a brief “Collected by Alex” result and remains able to collect other items. Honest simultaneous taps are expected, not errors that should disrupt the phase. Inventory ownership and pool removal must be one atomic mutation; transport deduplication alone does not protect two different action IDs collecting the same item.

Picking up an item does not force equipment replacement. Store it in personally owned cargo on a living carrier; install later. Physical weapon/system slots limit equipped builds, not the number of reward items someone is allowed to take. Uncollected items move into shared cargo on the designated surviving fleet carrier when the fleet leaves and remain available through the same tap-to-collect interface. Ownership and carrier location are separate. The carrier and its destruction risk are visible, and active players can explicitly transfer cargo at safe phases under owner-valid rules. Mark Ready at the phase level, not on each item. No automatic conversion or disappearance of uncollected equipment merely because the loot screen closed.

Bound the amount of generated content over a finite expedition and keep save size within the platform limit. Stack consumables by type, reference definitions by ID, and avoid recording every historical pickup. Validate the densest legal inventory, including one player collecting all rewards and buying heavily. Do not introduce a small hidden cargo cap that contradicts unrestricted pickup.

### Stores and refit

All active players enter the same store event, but browse and buy simultaneously on their phones. Common repair, ammunition, room upgrades, and weaponry-capacity upgrades are available as appropriate to the store. Recommended default: personal equipment stock drawn from the shared store theme, with comparable budgets/rarities and no race for essential repairs. Store inventories are generated once, persist on reopening, and cannot be rerolled by reconnecting. Scarce shared stock can be an explicitly authored event type.

Show actual price, available scrap, compatibility, and what installing a replacement changes. Buying spends scrap and creates the item once. Installed equipment cannot be sold twice, equipped in two ships, or sold while an order still depends on it. Combat locks refitting and purchases; safe phases allow installation, crew assignments, naming/paint, and loadout changes. Do not impose a countdown while another player is reading equipment.

## 7. Expedition content and presentation

The full content budget is part of the deliverable. The first playable battle proves integration; it is not an MVP release or a reason to quietly drop systems and scenarios. Use these targets to plan authoring, validation, assets, and balance from the start, without padding counts with cosmetic variants:

| Area | First full-release target | Required distinction |
| --- | --- | --- |
| Player hulls | 8 | Layout, room upgrades, slots, and tactical strengths |
| Weapons | At least 48 across 8 families | Different shield, timing, ammunition, targeting, and secondary-effect decisions |
| Drone types | At least 12 | Attack, intercept, repair, boarding, scouting, or support behaviors; not just skins |
| Optional systems | 12 | Distinct control and tactical effects; see the system matrix below |
| Augments / specialist equipment | At least 24 | Build interactions and occasional event capabilities |
| Enemy archetypes | At least 24, with authored layout/loadout variants | Distinct AI behavior, threats, and readable counterplay |
| Events | 300 distinct scenario roots, plus separately counted branches and variants | Zero-choice outcomes, ordinary decisions, rare capability solutions, quests, and consequences |
| Sector library | 8 themes, with 5 selected per standard expedition | Different event pools, hazards, factions, and threat combinations |
| Major encounters | Sector climaxes plus a multi-stage finale | More than higher hull and faster fire |
| Difficulty | Relaxed and Standard once balanced | Changes threat pressure while preserving zero-hull destruction and ownership rules |

Weapon families should include lasers, beams, missiles, flak, ion/disruptors, incendiary/plasma, boarding payloads, and repair/shield-support emitters. Distinction requires actual rules, targeting feedback, audio/visual identity, and counterplay; stat increments alone do not establish a new family. Test both all-offense and support-heavy fleets, mixed crew deployment, drone builds, hacking/boarding combinations, evasion, and solo alternatives.

| Optional system | What the player can do | Upgrade / damage / counterplay dimension |
| --- | --- | --- |
| Teleporter | Deploy and retrieve owned crew | Capacity, cooldown, reach, jamming and destroyed destinations |
| Drone bay | Deploy chosen combat/support drones | Active capacity, consumables, drone targeting and interceptors |
| Hacking suite | Disrupt a specific enemy system or door network | Duration, cooldown, resistance; never grants command of another player's crew |
| Cloaking | Temporarily avoid detection/attacks | Duration, charge, detection counters, firing tradeoff |
| Point defense | Intercept projectiles or hostile drones | Tracking capacity, coverage, saturation |
| Shield projector | Protect a designated ally | Strength, duration, cooldown, disruption |
| Repair relay | Support a damaged allied room/hull | Repair rate, charges/range, vulnerable delivery mechanism |
| Tractor system | Interfere with hostile drones, boarding craft, or salvage | Target classes, hold strength, disruption |
| Advanced scanner | Reveal interior threats and some event opportunities | Detail, scan time, obscuring hazards |
| Decoy emitter | Redirect eligible enemy attacks | Decoy durability, cooldown, smart-target counters |
| Boarding defense | Contain or suppress hostile boarders | Door/security improvements, trap cooldown, sabotage |
| Medical support | Heal or stabilize living crew on permitted vessels | Throughput, access and capacity; no resurrection after hull destruction |

Every system needs an authored tier curve, damage behavior, manning rule where applicable, input/view contract, AI use or counter, save state, and tests. A purchasable card with an unimplemented effect does not count toward completion.

### FTL event-count research and our content commitment

Research on 2026-09-12 did not establish a reliable exact number of distinct encounters in the original 2012 FTL release. The creators' postmortem reports nearly 20,000 words of event content at release and discusses repetition despite expanding the library. It does not give a final encounter count. [Justin Ma and Matthew Davis's postmortem](https://www.gamedeveloper.com/business/a-mini-postmortem-roundup).

Advanced Edition must be distinguished from that release: writer Tom Jubert describes new events both in the new sector and across existing sectors, without giving an exact total. [Writer's announcement](https://tom-jubert.blogspot.com/2013/11/announcement-ftl-advanced-edition.html). The community wiki's Random Events category shows a 369-item index that includes categories/templates/overview material; it is not a verified count of distinct playable scenarios and mixes the game's later content. Do not call it “369 original FTL events” or derive a base total by subtraction. [Community event index](https://ftl.fandom.com/wiki/Category:Random_Events).

Our explicit budget is 300 original scenario roots, not a claim of verified numeric parity with FTL. A root is one independently selectable premise with a materially distinct situation or decision structure. Its choices, random outcome nodes, text variants, and additional stops in the same quest chain are tracked separately and do not inflate that headline count. A no-choice event can count if it is a distinct designed situation; reskinning an otherwise identical generic ambush does not create ten scenarios.

Suggested root allocation, with one primary category per root: 60 travel/discovery, 50 distress/rescue, 50 hostile/ambush, 40 trade/social, 40 science/anomaly, 30 faction/diplomacy, and 30 multi-beacon quest roots. These sum to 300. Cross-tags do not double-count. Design a comparable breadth of concise encounter writing, with a planning budget of at least about 20,000 edited event words across roots and branches, but do not lengthen phone text to meet a quota. Original writing and art should use FTL's compact event structure and consequence patterns as reference.

If exact numerical parity remains necessary, the missing work is a version-pinned census from a legitimately owned installation, separating reachable scenario roots, base/Advanced Edition availability, follow-ups, and text variants. Until that exists, report parity as unverified. Neither raw XML node counts nor mod event totals answer the user's original-game question.

### Content pipeline and variety verification

Maintain a generated content inventory listing root IDs, primary category, tags/sector eligibility, ordinary-choice count, special-option count, conditions/effects used, follow-up references, word count, and implementation/test status. Use distinct files per event pack so additional content workers can author independently after the schema is frozen. Keep one owner for any given pack, and one coordinator-owned registration/index file. Do not author 300 events before a representative batch has been reviewed and played.

Validate missing/cyclic references, impossible entry predicates, unsupported effects, invalid weights, unreachable exits, stale or duplicate IDs, unintended repeatable rewards, crew/ship ownership in contributions, and illegal destinations after destruction. Sample seeded campaigns at every roster/difficulty and report root coverage, repeat rate, eligible-pool size by sector, pacing, reward economy, and how often special options actually appear and qualify. Prevent identical roots repeating within a run unless explicitly marked repeatable; recurring generic travel/combat can reuse mechanics without being miscounted as new authored scenarios. Review the text and consequences manually; generated counts alone do not prove variety or quality.

Write an encounter composition system with threat budgets and legality checks for every roster size. A four-person battle may feature a support vessel, two raiders, and an artillery ship rather than four identical enemies. Teach recognizable threats before combining them. New players should discover mechanics through low-risk early events and contextual hints, without a long mandatory tutorial before controlling their ship.

Use original hull art, silhouettes, portraits, names, effects, descriptions, events, and audio cues. Aim for an approachable illustrated space adventure: clear machinery and ship character, restrained HUD text, satisfying weapon/repair feedback, and readable damage. Preserve PartyPlay fonts, controls, safe areas, and accessibility conventions around the game. Scope game CSS to starship-scramble; do not redefine shared tokens globally.

Sound cues should identify targeting acceptance, denied action, shields breaking, boarding, teleport arrival, repairs, and incoming danger. Respect the shell's audio unlock/mute behavior and reduced motion. Leave music slots and transition hooks for the user to supply music; do not block gameplay completion on composition. No Claude review is currently requested for this game. If requested later, use the actual ask-claude skill with current screenshots and scoped source.

## 8. Fit with the actual PartyPlay architecture

Source was checked on 2026-09-12. The current registries contain ten games, including Island Settlers; some handbook prose still says nine. Re-read source before implementation because the workspace contains unrelated work in progress.

### Reuse these implemented pieces

| Need | Existing location/API | Application here |
| --- | --- | --- |
| Game manifest and rules | `packages/party-contract/src/index.ts` | Typed manifest; authoritative create/action/tick/projection/save/outcome hooks |
| One room connection | `packages/party-client/src/session.ts`, `apps/party-server/src/room-server.ts` | Join, ready, acknowledgements, held input, reconnect, roster, preparation |
| Multi-room host | `apps/party-server/src/room-hub.ts`, `app.ts` | Existing room isolation and HTTP/WS service |
| Game views | `packages/party-ui/src/index.ts` | DisplayView, ControllerView, PersonalView, SettingsView, InstructionsView, ResultsView |
| Scene readiness | Optional SceneView and prepare/dispose | Preload TV art; confirm a visible usable scene before common start |
| Timing | Manifest simulation; `packages/party-runtime/src/fixed-step.ts` | Start with 30 Hz simulation, 10 Hz snapshots, maxCatchUpSteps 4; profile before tuning |
| Input | setInput/releaseInput and shared SteerPad/HoldButton | Direct crew movement only; discrete choices stay reliable actions |
| Resource lifetime | ResourceScope, FrameMetrics, SnapshotBuffer | Owned resources, bounded metrics, snapshot interpolation |
| Saved expeditions | sessionControls, exportSave/loadSave/finish | Existing 256 KiB file API, fresh-round restore, room autosaves |
| Dashboard | `catalog/sources.json`, `apps/party-client/src/catalog.ts` | Discover/My Library listing and room-picker metadata |
| Module registration | Both `apps/party-server/src/registry.ts` and `apps/party-client/src/registry.ts` | Explicit trusted module imports and lazy client loading |

The shared runtime is sufficient for the basic game, but does not already contain fleet combat, ship ownership, tactical pause, inventory transactions, event generation, save-slot assignment, or durable account identities. Implement those game rules explicitly.

### Repository ownership

Canonical game source belongs at `game-modules/packages/games/starship-scramble/` in the games submodule. The platform's `packages/games/starship-scramble/` path resolves through its existing symlink. Game art/audio belongs at `game-modules/public/games/starship-scramble/`, served through the existing `public/games` symlink at `/games/starship-scramble/`, matching the current Kitchen Rush asset arrangement. Do not replace symlinks with copied files.

The platform repository owns this design, registries, catalog listings, shell changes, and integration tests. Shared runtime packages also physically live in the games repository through the current symlinks. If a later user authorizes Git publication, follow docs/REPOSITORIES.md. No commits, staging, pushes, or PRs are authorized by this handoff itself.

Suggested game-owned organization, splitting only when responsibility justifies it:

```text
src/
  manifest.ts             standalone manifest
  contracts/              IDs, entities, definitions, actions, views and module APIs
  model.ts                compatibility/type re-exports if useful, no second schema
  server.ts               GameRules wiring and phase transitions
  simulation/             ships, weapons, crew, boarding, hazards, AI
  expedition/             seeded routes, events, economy and rewards
  definitions/server/     encounter packs, AI/loadout data and hidden outcomes
  definitions/presentation/ safe public descriptions, geometry and asset IDs
  projections.ts          explicit public and per-player views
  save.ts                 versioned validation, ownership mapping, restore
  client.tsx              GameClientModule exports
  ui/                     phone task views, shared display, personal view
  render/                 battle art, room layout presentation, effects
  styles.css              scoped game styles
tests/                    owned simulation, expedition/content, UI and integration suites
tests/fixtures/           coordinator-owned typed state and legitimate view fixtures
README.md                 run instructions, controls and current status
```

Export manifest from manifest.ts, and named/default rules and client from their existing entry conventions. Browser code must not runtime-import server rules, event outcome tables, future encounters, or RNG state. Shared presentation definitions may contain public descriptions, art IDs, and room geometry; keep their import graph separate from server-only content. Do not name a new shared service or helper as though it already exists.

### Proposed manifest

```ts
{
  contractVersion: '1.0',
  id: 'starship-scramble',
  title: 'Starship Scramble',
  description: 'Command your own ship. Explore, upgrade, and fight together as a fleet.',
  assetBase: '/games/starship-scramble/',
  modes: ['shared-display'],
  players: { min: 1, max: 4 },
  orientation: { controller: 'landscape', personalView: 'landscape' },
  timing: 'realtime',
  input: ['state', 'action'],
  privatePlayerViews: true,
  supportsSolo: true,
  sessionControls: ['save', 'finish'],
  simulation: { stepHz: 30, snapshotHz: 10, maxCatchUpSteps: 4 }
}
```

Do not opt into snapshotCache initially. It is a specific public-field baseline mechanism, not general interest management, and it never caches private projections. Add it only for measured repeated static fields after correct complete projections exist. Do not register Scene Lab in a normal build.

### View composition and source-specific traps

- DisplayView renders the fleet overview and shared phase UI. ControllerView renders phone task views. PersonalView composes captain controls with a battle overview for a playing host.
- Prefer DOM/React room controls and Canvas 2D display rendering. The optional SceneView barrier is renderer-neutral; a Canvas scene must report readiness after assets and a real visible frame. mountThreeScene is for Three.js only and is not needed here.
- A playing host currently receives the same controller-style context role from the shell even when PersonalView is selected. Use playerId and isHost appropriately; do not depend on receiving viewRole equal to personal.
- The round seed is only available in server create. Preparation can load authored assets from settings, but cannot generate the hidden future campaign on phones.
- Use scene roles only if actual per-controller scenes are introduced. Do not mount a heavy background renderer on every phone merely because the API allows it.
- The current catalog derives some capabilities and explicitly lists cooperative games. Update its co-op mapping as well as the curated listing; a manifest alone will not put this game in the co-op filter correctly.
- Do not advertise TV-required for the implemented solo PersonalView. Advertise shared-display multiplayer, landscape phone controllers, solo, co-op, strategy, and save/resume accurately. The runtime still uses shared-display mode; this is not the unimplemented phones-only mode.

## 9. Authoritative state, commands, and projections

### State boundaries

Use one authoritative expedition state per PartyPlay round. Game phases are hangar, route, event, combat, rewards, store/refit, sector transition, and finale. Keep the platform in playing through all of these. Only completion, defeat, or an explicit session suspension produces a platform outcome. Do not trigger PartyPlay replay or throw away room seats between beacons.

State includes schema/content version, expedition ID, seed and serializable RNG state, stable captain slots, current owned ship IDs or destroyed-ship tombstones, bindings to current room player IDs, participation status, sector/route, current encounter instance and phase epoch, game simulation time, pause/readiness state, ships and purchased/damaged room tiers, crew, projectiles, installed equipment, cargo ownership/carriers, wallets/remainder, loot instances, store stock, event decisions, and terminal/suspended status. Transient view requests live in a separate explicit per-player context and are not campaign progress.

Ownership and location are separate. A crew member has an immutable owner slot, original home ship ID (which may refer to a tombstone), current ship ID, room/tile position, health, skill, and owner-issued order/activity. A purchased replacement ship gets a new ID; it does not silently rewrite history or crew ownership. An item has a unique instance ID and exactly one location: encounter loot, shared/personally owned cargo with a carrier ship ID, installed slot, store stock, or consumed/sold/destroyed tombstone where needed for the transaction scope. Never infer identity from names, current vessel, or shifting array positions. Effective manning bonuses are derived, not stored independently as authoritative totals.

### Commands

Use reliable actions for one-time intentions such as queueWeaponTarget, upgradeRoom, activateSystem, orderCrew, selectControlledCrew, teleportCrew, recallCrew, collectItem, transferCargo, purchaseItem, installItem, voteRoute, contributeToEvent, pause, and ready. These names are proposed game actions, not existing PartyPlay APIs. There is no power-allocation action. Every crew command validates immutable owner slot, including friendly transports and any automated order helper; ship ownership is never sufficient to command guests.

Every action carries the game's current phase epoch and encounter/event instance where relevant; transport carries roundId. Check ownership, location, legality, resources, target existence, caps, and phase before any mutation. Use narrow expected-version checks on contested entities such as loot/store instances. Do not demand the entire rapidly changing combat snapshot revision, which would reject normal human input continually.

Held input contains only the complete desired movement/action hold for the selected controlled crew member, with a control-context epoch. Returning home, changing controlled crew, teleporting, pausing, rotating, or disconnecting must invalidate old held context and release input. Client-supplied crew/ship IDs do not grant ownership. Repeated weapon fire is server behavior from an accepted target order, not a stream of reliable action IDs.

UI-only panel navigation and target drafting stay local. Ship inspection needs one bounded exception: a proposed inspectShip action requests permitted detail for the selected vessel through the existing per-player projection. It changes only the viewer's transient inspection context, never battle orders, RNG, readiness, or the TV. Validate encounter and visible ship ID; coalesce rapid changes; include a view-request ID so a late response cannot populate the wrong ship. This consumes the existing reliable channel and must be covered by the long-session history policy. Do not introduce a second socket or pretend a shared inspection API already exists.

A pending action has visible feedback; rejected actions leave the player in a usable state. All economic mutations and transfers are validated before changing balances or ownership. Throwing after half a purchase has mutated state is not a rollback mechanism.

### Public and per-player views

The public view is a transport projection, not a mandate to draw every included field on the TV. It contains phase, simulation time, pause/ready status, current route/event text/options, fleet summaries, visible enemy summaries/targetable room geometry and system information, shared loot, and bounded recent combat effects. Future encounters, hidden outcomes, RNG state, and unobserved enemy information stay server-side.

The per-player view contains the ship referenced by that captain's currentOwnedShipId, or a loss record when none survives, plus owned-crew locations, inventory/carriers, wallet, legal actions, pending/queued orders, and details for at most one additionally inspected vessel. Include inspectedShipId and view-request ID in the response. Default to the current owned ship, or a survivor's vessel if shipless. Acquiring a replacement updates currentOwnedShipId and the primary projection atomically; historical crew home references remain unchanged. Friendly interiors may be inspected without a visitor; enemy interiors reveal only sensor-authorized information and information exposed by owned crew aboard. All encountered enemies remain selectable even if parts of their interior are unknown. Do not expose hidden AI plans, unseen defenders, or cargo simply because a view was requested. Foreign crew are visible where known but have no actionable owner controls.

The UI may render cached permitted geometry while waiting for fresh details, but it must not show stale crew positions as current or allow actions from a different vessel's response. Enemy target validation matches the displayed knowledge and targeting rules. Switching views releases direct held input and leaves standing owner-issued crew orders intact. Inspection context resets on reconnect/load as needed without changing the world.

Do not send the full expedition or every allied interior to every phone at 10 Hz. Use bounded entity lists and shared presentation definition IDs. Every projection and save must pass assertSerializable, with finite values and absent optional fields omitted. A destroyed target or changed phase must invalidate stale local navigation safely.

### Long-session action history: a required integration decision

Current source stores every unique action acknowledgement for the lifetime of a round. The default limit is 256 per player; RegisteredGame.actionLimits allows at most 4096, with an associated payload-size/memory bound. Island Settlers currently opts into 4096 actions of at most 1024 bytes. Rejected unique actions consume the allowance too. The older documentation's 256-only description is incomplete.

For the vertical slice, register a bounded allowance such as 4096 / 1024 bytes and test it. This is not a permanent solution for long FTL-style command sessions. Before full release, add or select a measured, safe long-session policy in the shared transport. Required properties: bounded acknowledgement memory, reconnect-safe retries, no duplicate purchases/pickups, old commands cannot execute again after history is compacted, and no arbitrary loss of controls after extended play.

A suitable design direction is an opt-in per-player ordered command sequence with a bounded recent acknowledgement window and a retired-sequence watermark. Retired commands must never re-execute; payload mismatch remains an error for retained entries. The implementation must specify handling for gaps, out-of-order delivery, the current maximum 16 pending actions, reconnect, sequence reset on new round, and changed payloads. This would require a reviewed shared protocol/client/server change; it does not exist today. Do not merely delete old action IDs or remove limits globally. Do not hide action-limit resets behind automatic save/load that changes the room round during combat.

## 10. Saves, identity, and recovery

Use the implemented save hooks and 256 KiB limit. Serialize finite game state with definition IDs, compact positions, bounded active effects, item instances, simulation time, RNG state, and event/reward resolution flags. Do not serialize browser navigation, credentials, socket objects, renderer resources, or unbounded logs. Do not rely on a seed alone to reconstruct already modified worlds.

Store persistent captain slots independently of PartyPlay player IDs. A new room has new identities. Restoring presents a game-owned captain assignment screen after normal shell preparation: each connected player taps an unoccupied saved captain slot, with atomic assignment, then the eligible active captains ready. A slot can own a living ship, be shipless with surviving crew, or be eliminated; show that status and do not hide it from assignment just because the ship is gone. Preserve the saved roster size in the planned release; require the same number of player seats to resume, including eliminated slots. Changing that rule later requires an explicit absent-slot policy, not dropping crew or reallocating wallets. Display a useful error for a mismatched roster size.

When returning to the same live room, ordinary reconnect restores the current binding without an assignment picker. When loading a file or creating a fresh round from a save, do not trust saved player IDs as authentication. Rebind crew ownership, wallets, cargo ownership, votes, and leader identity through stable captain slots. Keep currentOwnedShipId, destroyed-ship tombstones, current crew locations, purchased room tiers/damage, and physical cargo carriers valid. Do not remap a visitor's owner or historical home to their current host. Recompute manning bonuses after restore and derive participant eligibility from living and available owned crew using the same predicate as normal play; captured/unavailable crew do not reactivate a spectator. A malicious save cannot assign arbitrary current players' credentials or mutate the existing world on validation failure.

Resume into an assignment/paused state before any simulation advances. Clear transient held input and transport readiness. Keep accepted weapon/crew orders where appropriate, and reconcile or clear queued tactical-pause edits under a documented rule. Rebase any wall-clock UI timestamps; gameplay timers are simulation-relative. Restore combat, stores, unfinished loot, and already resolved events without rerolls or duplication.

Distinguish session suspension from victory/defeat. finish(state, nowMs) marks a recoverable suspended outcome with an explicit “Expedition paused” result; it must not fabricate a win or destroy the campaign. The same hook can be used by platform error recovery. Preserve an already terminal victory/defeat if finish is called then. loadSave recognizes suspended runs and removes only the suspension wrapper, retaining their actual game phase for paused restoration.

Current autosaves are room-scoped and run periodically; a server crash can lose changes since the last completed checkpoint. Temporary room credentials are not accounts. Do not promise that an expired room can be rediscovered from My Library. Expose clear manual download guidance for continuing in another room. Shared UI currently calls the feature Save world; a small game-neutral wording improvement to Save game/session may be appropriate if scoped and tested by the integration owner.

## 11. Implementation stages and acceptance gates

These are integration gates for the complete game, not successive reductions of the promised scope. Parallel workers can author systems, scenarios, and assets after their contracts are agreed while the coordinator proves early playable builds. The first playable battle does not satisfy the assignment. All production targets, implemented system families, full runs, and polish gates remain required.

| Stage | Deliverable | Exit gate |
| --- | --- | --- |
| 0. Parallel contracts | Typed actions/views/entities/definitions, agreed effects and module APIs, fixture pack, ownership map | Workers compile independently against the same contracts; no competing game-state schemas |
| 1. Complete fleet battle | Registered module; 1–4 ships; one enemy composition; real phone targeting/switching; room damage/upgrades; crew orders; destruction; simple loot; replay | Real join → ready → battle → loot → results → replay at 1 and 4 players; all enemies remain visible |
| 2. Crew deployment | Rooms/doors, damage/fire/oxygen, boarding, direct control, teleporter, guest manning, permanent loss | Surviving guests remain owned/controllable after home destruction; host cannot command them; no phantom bonuses |
| 3. Representative expedition | Branching route, zero-choice/ordinary/conditional events, battles, stores, upgrades, loot, final encounter, every system family represented | Complete short QA expedition integrates every family; the 300-root library and full art continue in parallel |
| 4. Durable long play | Save/restore and slot assignment; pause/disconnect policies; safe action-history policy | Midcombat and mid-loot saves; changed room identities; long command stream; no duplicate rewards or lost controls |
| 5. Full content | Full route generator, 300 roots, 48 weapons, 12 drones, 12 optional systems, hulls, augments, enemies, sectors, bosses | Content inventory proves counts and implemented effects; full-length solo/four-player expeditions show viable different builds and no blocked progression |
| 6. Release polish | Final art/effects/sound cues, accessibility, load/performance work, controller refinements | Inspected maximum-density scenes, real game flows, measured budgets, documented device and group-play evidence |

The first full-length run must not be the first time four ships and six enemies are rendered together. Stress the maximum UI and control context transitions during stage 1. Make loot collection and targeting real multiplayer transactions early, not a local mockup replaced late in development.

### Rules and integration tests

- Controlled seeds and clocks: route reachability, deterministic event persistence, threat scaling, all legal fleet sizes, terminal conditions, pause freezing every subsystem.
- Weapon/room pipeline: tier 2 → 3 unlocks the third gun; damage reduces effective capacity; repair restores purchased tier without losing equipment; accepted target, stale/destroyed target, ammunition, cooldown, shield/room effects, hold fire, no silent retarget; no reactor/power model in settings, definitions, actions or UI.
- Crew: immutable ownership vs location; host-command denial for guests; automatic manning by friendly visitors; capacity/stacking limits; loss of bonus on movement/fighting/death; unreachable room, door changes, fire/vacuum, boarding, teleporter duplicates, landing capacity, recall, source/destination destruction, disconnect while visiting.
- Destruction: all aboard die regardless of owner; guests elsewhere survive; home tombstones remain; same-step teleport/damage ordering; simultaneous kills; no replacement/evacuation after zero hull; lost physical cargo, surviving wallet, spectator quorum, leader succession, explicit fleet-defeat cases.
- Economy: automatic scrap credited once; remainder conservation; shipless/disconnected slot shares; two players pick the same item; one player collects everything; shipless pickup to valid carrier; carrier destruction; pickup during navigation/reconnect; duplicate purchases; insufficient funds; buy/sell/equip/upgrade races.
- Phases/content: zero-choice Continue is not a vote; route ties, owner-required event contribution, lost capability before commitment, rare-option frequency, supported predicates/effects, 300 genuine roots rather than branch counts, disconnected/eliminated readiness, repeated ready, stale phase actions, no reroll or double reward after reload.
- Saves: strict schema/content validation, size at maximum legal content, fresh state on success, untouched state on failure, stable captain-slot remapping after home destruction/elimination, restored visitors and derived manning, cargo carriers, resolved loot/store transactions, expired room limitations.
- Transport: existing duplicate/mismatched/stale protections; action-history retirement and retry behavior if changed; thousands of commands; bounded memory across rooms; long pause without charge/cooldown drift.
- Projections/navigation: switch freely among all allies/enemies; enemy sensor rules; stale inspection responses; controlling only owned crew on an inspected vessel; destroyed selected vessel; min/max rosters in every phase; serializability; absence of hidden event banks; no private inventory/wallet accidentally required by TV rendering.
- Lifecycle: preparation abort, failure, reconnect, replay, results, and switching Starship → another game → Starship with retained seats and no stale input, scene, music, or commands.

### Browser, performance, and human acceptance

Use real UI joins/actions for acceptance. Deterministic fixtures can stress a dense scene but cannot substitute for a complete battle and expedition. Test 1, 2, and 4 captains, including a playing host and a watching display. Run additional phones headlessly rather than opening four visible phone windows.

Inspect TV at 1280×720 and 1920×1080; phones at 667×375 and 844×390; portrait rotation/recovery at 320×568 and 390×844. Include four 16-character names, six enemies, multiple urgent conditions, the largest hull, all 32 friendly crew on one vessel plus legal boarders, maximum legal items, repair drones, and long localized-like item/event text. Test home destruction while inspecting an enemy, a guest selected while the host tries to issue an order, and repeated view changes under snapshot latency. Verify every essential control remains reachable with Safari-style browser chrome and safe areas.

Starting performance targets, to be measured rather than advertised as achieved: responsive local selection feedback within 100 ms; typical LAN accepted-command feedback within 200 ms; 60 fps target on the TV and usable 30 fps minimum on supported phones; non-overlapping 44px controls; normal initial scene readiness within five seconds on declared test hardware and below the platform's 20-second preparation timeout. Record p50/p95 frame time and latency, snapshot bytes/cadence, save size, memory, and repeated-round resource counts. Network/CPU budgets must cover four phones plus the display, not one local tab.

Run an extended maximum-roster command/memory soak and a full ordinary-paced expedition. Physical iPhone Safari and Android touch tests, Wi-Fi behavior, TV viewing distance, and group enjoyment need real hardware/humans. Label emulation accurately. Key group questions: can a captain notice a teammate's trouble, switch among ships without losing context, control only their own deployed crew, understand guest manning, recognize a rare equipment-based solution, and continue through surviving crew after their ship is destroyed? Record scenario repetition and distinct viable builds across complete runs, not just one successful battle.

Follow isolated build commands from the handbook, choosing a new run name and a verified unused port. Run focused game tests first, then relevant platform tests, typecheck, lint, and a coherent integration build. Inspect scripts and never execute Prettier. Use no more than three visible owned QA windows and one active QA owner. Preserve the user's running server, room, browser windows, and existing assets. Record build hash, actual accepted actions, results/replay evidence, screenshots inspected, resource ownership, and unrun gates.

## 12. Parallel build architecture and coordination

Use a coordinator plus three active implementation subagents as the default execution shape, matching the current four-agent concurrency limit. Reuse workers across waves. The coordinator owns integration and can progress contracts, projections, saves, transport, and acceptance while the workers build independently. This is an explicitly requested multi-subagent workflow; do not turn it into a single worker implementing everything serially or a set of unrelated game implementations merged at the end.

### Exclusive file ownership

Paths below are relative to the canonical game root `game-modules/packages/games/starship-scramble/` unless stated otherwise. Symlink aliases address the same files and do not create separate ownership.

| Owner | Exclusive write scope | Responsibility |
| --- | --- | --- |
| Coordinator / integration | `src/contracts/**`, `src/model.ts`, `src/manifest.ts`, `src/server.ts`, `src/projections.ts`, `src/save.ts`, `src/definitions/index.ts`, `tests/fixtures/**`, `tests/integration-*.test.ts`, `tests/save-*.test.ts`, `tests/projection-*.test.ts`, game README and integration status | Single authoritative contract, rules wiring, projection/privacy, save/identity integrity, transaction ordering, full-game acceptance |
| Simulation worker | `src/simulation/**`, `tests/simulation-*.test.ts` | Crew movement/orders, room tiers/damage, automatic manning, weapons, system abilities, drones, enemy AI, teleportation, destruction |
| Expedition/content worker | `src/expedition/**`, `src/definitions/server/**`, `src/definitions/presentation/**`, `tests/expedition-*.test.ts`, `tests/content-*.test.ts` | Route/events, typed content, economy/stores/cargo, authored equipment and enemies, root census, balance and content validators |
| UI/art worker | `src/client.tsx`, `src/ui/**`, `src/render/**`, `src/styles.css`, `tests/ui-*.test.ts`, canonical `game-modules/public/games/starship-scramble/**` | TV, phone switching/targeting, visitor controls, PersonalView, original art/effects/audio hooks, accessibility and local view state |

The coordinator alone owns any required platform edits: both registries, catalog metadata/listing, shared action-history work in party-contract/party-client/room-server, root scripts/dependencies, integration tests outside the game, and any small save-menu wording change. Shared packages physically belong to the games submodule; check the repository boundary before editing. The root Node test scripts currently discover game `tests/*.test.ts`, so the flat test prefixes above are deliberate. If nested suites are introduced, the coordinator must wire discovery and prove those tests run.

Workers can read each other's saved files but cannot patch outside their assignment, including a shared barrel, schema, fixture, or another worker's test. Ask the coordinator for a narrow contract change with the desired type/example and why it is needed. The coordinator either implements it or hands over a named file after its previous owner stops editing. Do not have several workers change server.ts, model.ts, or client.tsx opportunistically.

### Freeze the integration contracts before feature work

The coordinator supplies a compileable contract package and representative fixtures, then asks every worker to check that their assigned feature can be expressed. Freeze the following before parallel implementation begins:

1. IDs and entities: CaptainSlotId, ShipId, CrewId, ItemInstanceId, room/system IDs, encounter instance and phase/control/view epochs; immutable crew owner, optional destroyed home reference, current vessel, participation status, item owner and carrier; no power fields.
2. Data ownership: simulation owns live ship/crew/combat state; expedition owns route/events/economy; coordinator owns player bindings, pause/quorum, transitions and the overall transaction boundary. Only documented commands/effects cross these boundaries.
3. Typed commands and errors: common actor/epoch envelope, target and inspection requests, crew permissions, transports, upgrades, capability contributions, purchases/loot, pause/readiness, and explicit failure reasons the UI can display.
4. Definitions: room geometry and tier curves, weapon/system/drone/AI definitions, event conditions/effects, original content IDs, safe presentation fields, asset keys, and bounded entity/text/content limits. One capability registry connects content predicates to implemented mechanics.
5. Projections: public fleet summaries, permitted inspected-interior data, owned-crew locations, room damage/tier/manning, target knowledge, cargo carriers, pending-action feedback, shipless/eliminated views, and event choice shapes including zero choices.
6. Simulation contract: tick ordering from section 4, deterministic RNG streams, units, collision/occupancy, control cancellation, destruction events, room upgrade/damage curves, and derived manning eligibility/caps.
7. Save contract: schema/content versions, stable captain reassignment, lost ships/crew/items, captured crew where supported, event resolution/seen-root history, RNG state, cargo carrier IDs, and no persisted inspection caches or duplicate manning bonuses.
8. Module entry points: functions for creating/advancing combat, validating/applying actor commands, entering/resolving events, applying economy transactions, and emitting domain events. Freeze signatures and examples in `src/contracts/`; these are newly implemented game interfaces, not presumed platform exports.

### Dependency direction and atomic integration

Contracts depend only on stable PartyPlay types and plain serializable types. Simulation imports contracts and receives validated definitions; it does not import React, server.ts, save.ts, or event packs. Expedition imports contracts and authored server definitions; it requests combat or fleet changes through typed effects rather than mutating simulation internals. UI imports contracts, safe presentation definitions, and party-ui; it never imports event effects, hidden outcomes, or server code. Coordinator-owned server.ts composes simulation and expedition. Projections and saves use the same contracts and validators.

Use explicit returned domain events such as ShipDestroyed, CrewLost, EncounterResolved, and CargoCarrierLost where another subsystem must react. The coordinator applies their dependent effects synchronously before publishing a snapshot or acknowledging the complete transaction. For example, destruction invalidates room/crew controls, destroys carrier cargo, removes manning, and updates participant quorum before the next view. No worker implements a second partial destruction handler in its own module.

Keep route/event random generation and combat AI randomness in separate deterministic streams so an extra simulation tick does not unexpectedly reroll future loot. Rendering never advances either stream. Event effects are validated against supported capabilities before authoring at scale; unsupported definitions fail loudly instead of becoming dead buttons or silently ignored content.

### Shared fixtures that unblock independent work

The coordinator owns a typed fixture builder and legitimate projected examples for: solo; four captains/six enemies; duplicate hulls and long names; tier-2 versus tier-3 weaponry; damaged weapon slots; a guest manning shields; a host attempting to command the guest; all 32 friendly crew plus 8 boarders on one hull; zero hull with a survivor elsewhere; an eliminated captain with a surviving hull; crew stranded on an enemy; rapid inspection requests; tactical pause; contested loot; a shipless cargo recipient; full store; zero-choice event; one/two ordinary choices; zero/one/two special options; and save-slot assignment with lost ships.

Fixtures derive from the same validated model and projection builders used by production. UI workers receive only legitimate views; fixture-only server data cannot leak through client imports. Keep the fixture harness out of normal registration/build routes. A contract revision updates the fixtures and affected consumer tests in the same coordinated batch. Fixture screenshots and rule tests unblock parallel work but do not replace actual joins and playthroughs.

### Work waves and dependencies

| Wave | Simulation worker | Expedition/content worker | UI/art worker | Coordinator's useful parallel work |
| --- | --- | --- | --- | --- |
| A. Contract-backed foundations | Rooms/crew, upgrades/damage, basic weapons, central destruction | Event/economy schemas and validators; 12 representative roots; equipment definitions | Maximum-density TV and phone ship switcher against fixtures; room hit geometry | Contracts/fixtures, registration, projection skeleton, test discovery, owned build setup |
| B. First integrated combat | Boarding/teleport, friendly manning, full command validation | Loot/store/route loop and event contribution rules | Real targeting/crew controls/loot with acknowledgements; first authored hull art | Compose real round, 1/4-player join-to-replay, inspect permission/transaction failures |
| C. Complete systems | All 12 optional systems, 12 drones, AI/counters, destruction edge cases | All weapon families, sector generator, quest/effect engine; initial 60 reviewed roots | Every system's real controls and feedback; PersonalView; visitor/survivor/spectator flows | Saves/captain remapping, bounded action history, complete representative expedition |
| D. Full content and polish | Balance, interactions, deterministic campaign simulations | Grow the edited catalog to 300 roots and full equipment/enemy targets | Eight hulls, complete art/effects/audio cues, every strategic screen, accessibility | Content inventory, full-run acceptance, latency/memory and lifecycle regressions |
| E. Final acceptance | Repair observed simulation defects | Repair content/balance defects; seeded repeat/coverage reports | Repair observed visual/touch defects | Full solo/four-player runs, stable release candidate, actual evidence and remaining human gates |

The 12-root and 60-root batches are review checkpoints within the 300-root commitment. They are never a smaller substitute deliverable. Phase timing follows dependencies rather than forcing a worker to wait while another writes hundreds of events.

After the shared event schema/interpreter is proven, use spare worker capacity for parallel authoring or review. Split packs by named paths, for example `definitions/server/events/travel/**`, `distress/**`, `hostile/**`, `trade/**`, `science/**`, `faction/**`, and `quests/**`. A worker gets one or more specific packs and matching `tests/content-<pack>-*.test.ts`, not ownership of the whole event directory. Transfer ownership explicitly before reassigning an existing worker's subtree. The original content worker remains the schema/editorial owner unless reassigned; the coordinator maintains the central index. Keep at most three workers active, rotating finished specialists into content/review tasks rather than spawning an unbounded tree.

### Task briefs, changes, and build gates

Each subagent brief includes the reviewed plan path, exact deliverable and phase, exclusive paths, contract version, dependencies/fixtures, required tests, forbidden shared edits, and a definition of completion. Use a bounded brief with `fork_turns: "none"`; project instructions reject full-history forks. Workers do not create new user-owned Codex tasks or recursively delegate without the coordinator assigning available slots and paths.

Record owner, state, contract version, tests and blockers in one coordinator-owned `output/starship-scramble/STATUS.md`. States are `editing → source ready → built → verified`. Workers report coherent saved source and targeted test evidence; that does not imply browser acceptance. A contract change requires a proposal, impacted-consumer list, coordinator update, fixture update, consumer acknowledgement, and focused rechecks. Do not publish a new central contract halfway through an active build.

Because workers share the workspace, integration means composing coherent saved source, not expecting isolated branches to merge themselves. Preserve unrelated dirty files. Only the coordinator performs shared builds after all included owners report source ready and freeze their files. Follow the handbook's cancellation/acknowledgement rule before resuming edits. Publish the exact included features and immutable build fingerprint, run bounded acceptance, then release the batch and route concrete defects back to the owner. Reserve Git merges/commits for separately authorized work.

Only the coordinator owns browser QA. Workers may supply test scenarios, fixture renders, and scripts for that owner; they do not open extra Chrome windows or restart the user's runtime. Use one host and at most two visible phone windows, with remaining roster headless, isolated asset roots, and named owned sessions. Outside a QA window, stop only owned idle sessions. Peer review can run in a freed worker slot against frozen source/evidence; report untested claims explicitly.

### Full-game completion rule

Maintain a feature/content acceptance matrix linking each system family, enemy behavior, scenario pack, phone view, save path, and failure state to implemented code plus tests or actual play evidence. A placeholder, card description, mocked effect, unregistered event pack, or inaccessible choice is incomplete. Check root counts using the counting definition in section 7, and inspect a representative sample from every author/pack for repeated premises and weak consequences.

The coordinator's final acceptance requires the full production inventory, functioning save/reconnect and long command sessions, meaningful solo and four-player full expeditions, polished maximum-density UI, and no unresolved core ownership/destruction/economy bugs. Keep physical-device and group-play gates honest if hardware or people are unavailable. Do not call the project complete because stage 1 runs or because generating more scenarios is time-consuming.

## 13. Builder handoff

After the user approves/revises this plan, give the next agent this brief with the document:

> Coordinate and build the complete Starship Scramble game with multiple subagents, using docs/game-plans/starship-scramble.md as the reviewed design. It is an original one-to-four-player FTL-style fleet expedition, not an MVP. Each captain starts with a ship and permanently owns their own crew. Landscape phones default to their own ship interior and can switch freely to any allied/encountered enemy vessel; players control only their own crew there. The TV always shows the clean overall battle. Remove all power/reactor management: room tiers, equipment capacity, damage and repairs govern systems. At zero hull ships explode and kill all aboard; players continue through owned survivors elsewhere, and friendly guests automatically man eligible systems without granting the host command rights. Include unrestricted tap-to-collect loot, the reviewed scrap rule, 300 distinct scenario roots with zero/few choices and semi-rare capability options, and the full weapon/drone/system/enemy targets. FTL's exact event total remains unverified; 300 is our explicit production budget. Use section 12's coordinator/three-worker ownership, frozen contracts, fixtures, work waves and integration gates. The early battle is a validation step, not the deliverable. Reuse PartyPlay rooms, input, simulation, saves and view contracts; solve long-session command history, inspection projection, destruction/save ownership and participant recovery explicitly. Read current AGENTS.md, handbook, UI skill, 3D readiness, repository boundaries and source exports. Keep game code/assets in the games submodule and shared changes coordinator-owned. Preserve unrelated dirty work and live sessions. Browser QA is authorized; use one owner, isolated builds and at most three visible QA windows. Subagent delegation is requested; new user-owned Codex tasks, Git publication and Claude consultation are not. Never run Prettier. Record decisions, code walkthrough, content inventory, actual full-run/browser evidence, current QA report and remaining limitations.

The next agent should act as the coordinator and follow the explicit multi-subagent plan rather than asking again whether to delegate. The current task only prepared this handoff; implementation begins when the user hands off/requests the build. Preserve the user's reviewed requirements when refining recommended defaults.

## 14. References and source basis

Research informs the design; proposed rules above are our design choices, not claims about the reference games.

- [FTL official gameplay description](https://store.steampowered.com/app/212680/FTL_Faster_Than_Light/): ship/crew decisions, weapon targeting, pausable combat, and randomized encounters. Starship deliberately omits FTL's power allocation under the user's revised direction.
- [FTL creators' postmortem](https://www.gamedeveloper.com/business/a-mini-postmortem-roundup), [writer's Advanced Edition announcement](https://tom-jubert.blogspot.com/2013/11/announcement-ftl-advanced-edition.html), and [community event index](https://ftl.fandom.com/wiki/Category:Random_Events): event-library evidence and counting limitations are recorded in section 7; no exact original/Advanced Edition event total is claimed.
- [Subset Games FAQ](https://subsetgames.com/faq.html): FTL's single-player design and the difficulty of its existing interface on small touch screens.
- [Cosmoteer](https://cosmoteer.net/): customizable ships, crew simulation, system targeting, and cooperative exploration. [Classic interface history](https://cosmoteer.net/history.html) documents minimap/picture-in-picture approaches; this plan does not adopt that TV inspection layout after the user's correction.
- [EmptyEpsilon official guide](https://daid.github.io/EmptyEpsilon/): shared main screen and specialized personal stations; its usual crew-per-ship arrangement differs from this game's captain-per-ship model.
- [Nintendo Land](https://www.nintendo.com/en-gb/Games/Wii-U-games/Nintendo-Land-524069.html): different perspectives/information on personal and shared displays.
- Local authority: [handbook](../party-platform/AGENT-HANDBOOK.md), [implementation guide](../party-platform/IMPLEMENTATION.md), [3D/input/save guide](../party-platform/3D-READINESS.md), [repository boundaries](../REPOSITORIES.md), [game brief](../party-platform/GAME-BRIEF.md), [UI skill](../../.agents/skills/party-platform-ui/SKILL.md), [rules contract](../../packages/party-contract/src/index.ts), [view contract](../../packages/party-ui/src/index.ts), and current room-server/session/registry/catalog source. Source takes precedence over stale historical game counts and capability prose.
