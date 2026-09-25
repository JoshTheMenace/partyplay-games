# Expansions: scope, combinations and adaptations

Each expansion, scenario and variant is one engine module under `src/engine/modules/`, wired
through the hooks in `registry.ts`. Settings validation and suggested targets live in
`src/settings.ts`; the in-game rules text is `src/ui/shared/help.ts`. Engine details are in
[ENGINE §14 and §19](docs/v2/ENGINE.md).

## Scope

| Module | Implemented |
| --- | --- |
| Seafarers | Ships and ship moves, pirate, gold fields, mixed road/ship routes. Scenarios: New Shores (start on the main island, +2 per new island), Four Islands (start anywhere; +2 per island without a starting building), Fog Islands (routes reveal fog for 1 resource, no island bonus) |
| Explorers & Pirates | Fog exploration, harbor settlements, ships carrying settlers and crews, 3:1 bank, gold. Missions: Pirate Lairs, Fish for Catan, Spices; Land Ho! alone has no pirate ship |
| Cities & Knights | Commodities, Science/Trade/Politics tracks and metropolises, knights, walls, barbarian ship and event die, progress cards (hand limit 4); robber held until the first attack |
| Fishing | Coastal grounds and lake, fish spends 2–7, the old boot |
| Rivers | Bridges, river gold, Wealthiest (+1) and Poor (−2), gold for resources |
| Caravans | Oasis camel trains, secret bids, doubled roads and camel points |
| Barbarian Attack | Coastal landings and conquest, knights and prisoners, defense cards, no robber |
| Deliveries | Wagon, castle/quarry/glassworks depots, road tolls, upgrades, road barbarians, own dev deck |
| Friendly Robber | No blocking or robbing seats with 2 or fewer points |
| Harbormaster | Harbor points per port building; first to 3 takes +2 |

Not implemented: the published scenario campaigns and printed boards, Event Cards, CATAN for Two,
Swift Journey (Deliveries dev card), and save/resume across server restarts.

## Combinations

1. Maps are exclusive: Base, Seafarers or Explorers & Pirates.
2. Cities & Knights combines with all three maps.
3. Explorers & Pirates allows only Fishing among the scenarios, and neither variant (no land robber,
   no ports).
4. Barbarian Attack and Deliveries each replace the land robber, so Friendly Robber is rejected.
5. Four Islands rejects Rivers, Caravans, Barbarian Attack and Deliveries (they need a home island).
6. Barbarian Attack + C&K: coastal attacks replace the barbarian ship track; ship rolls and
   improvements land barbarians, 3 prisoners score 1 point.
7. Barbarian Attack + Deliveries: coastal invaders also block wagon paths beside their hex.
8. Official pair rules also applied: E&P + C&K (Medicine, Aqueduct on a 7, island-bound knights,
   Taxation activates the pirate), Fishing with C&K / E&P / Barbarian Attack spends, Rivers + C&K
   pillage ransom, Seafarers + Rivers ship-off-river move, no lake with Deliveries or Fog Islands,
   2 fish for +2 wagon movement, no Poor penalty with Barbarian Attack or Deliveries.

A rejected choice always shows its reason; nothing is dropped silently.

**Suggested targets** (the host can change them): Base 10; New Shores 14, Four Islands 13, Fog
Islands 12; Explorers 8 + Lairs 4, Fish 3, Spices 2 (so 8/12/15/17). C&K adds 3 on Base, 2 on
Seafarers and 5 on Explorers. Scenario floors: Fishing 10, Rivers 10, Caravans 12, Barbarian Attack
12, Deliveries 13. Official pair targets replace both floors: BA + Deliveries 14, Caravans +
Deliveries 15, Fishing + Deliveries 12, Fishing + Rivers 10, C&K + Caravans 15, C&K + Deliveries
15. On Seafarers, Caravans adds 2 and Deliveries 3 to the map target. Harbormaster adds 1.

## PartyPlay adaptations

- All maps are generated per table size; 5–10 seat supplies, dev decks and port counts are scaled.
- 7–10 seats: the paired build turn runs at the same time as the main turn.
- Connect rounds keep private hands and a shared board for 3–10 seats; setup stays sequential.
- A safety-net round limit (15 rounds per target point in Standard, 12 in Connect, scaled per
  module) ends a stalled game with the highest total winning.
- Fog Islands accepts Barbarian Attack, Caravans and Deliveries on the home island, and Four Islands
  rejects Caravans; the official sheets say the opposite for both.
- Barbarian Attack: the castle replaces the central desert; every landing number 2–6 and 8–12 is
  placed on the coast, and a number on two coastal hexes lands a barbarian on each.
- Deliveries dev deck is 16 Knight, 3 Road Building, 3 VP (×1.5 at 5–6, ×2 at 7+), without Swift
  Journey. At 3–4 seats the 2 and 12 hexes take the nearest legal number and 2/12 rolls are
  rerolled; 5+ seats keep them.
- Fishing: 44 tokens at 5–6 seats but one lake (the sheet adds a second); no "replace one token at
  the 7 limit" option; with Caravans the lake replaces a forest instead of stacking 12 on the 2.
- Rivers + T&B scenarios: no bridge gold, river-crossing wagon costs or 3 starting gold.
- Deliveries on Seafarers: wagons do not cross sea edges.

## Official sources

Read from catan.com, September 2026. Downloaded PDFs are local research under the parent's ignored
`output/`, not game assets.

- [Base rules and almanac](https://www.catan.com/sites/default/files/2021-06/catan_base_rules_2020_200707.pdf),
  [5–6-player rules](https://www.catan.com/sites/default/files/2025-03/CN3082%20CATAN%20%E2%80%93%205-6%20Rulebook%202025%20reduced.pdf)
- [Seafarers](https://www.catan.com/sites/default/files/2025-03/CN3083%20CATAN%E2%80%93Seafarers%20Rulebook%202025%20secured%20reduced.pdf)
- [Cities & Knights](https://www.catan.com/sites/default/files/2025-03/CN3087%20CATAN%E2%80%93Cities%26Knights_%20Rulebook.pdf)
- [Traders & Barbarians](https://www.catan.com/sites/default/files/2025-04/CN3089%20CATAN%20%E2%80%93%20T%26B%20Rulebook.pdf)
  and its 5–6 extension
- [Explorers & Pirates](https://www.catan.com/sites/default/files/2025-04/CN3085%20CATAN%20%E2%80%93%20E%26P%20Rulebook.pdf),
  [mission guide](https://www.catan.com/sites/default/files/2025-04/CN3085%20CATAN%20%E2%80%93%20E%26P%20Missions.pdf),
  [with C&K](https://www.catan.com/sites/default/files/2025-08/ExplorersPirates%20w%20CnK.pdf),
  [with T&B](https://www.catan.com/sites/default/files/2025-08/ExplorersPirates%20w%20TnB.pdf)
- [Scenario combination sheets](https://www.catan.com/traders-barbarians): Fishing, Rivers, Merchant
  Trains (Caravans), Barbarian Attack and T&B, each with C&K, Seafarers and the other scenarios
- [Connect event rules](https://www.catan.com/sites/default/files/2025-06/CAT_Connect_Manual_Event_RZ%20ENG%20250514s.pdf)
  (inspiration only; our Connect rounds are not the official rules)
