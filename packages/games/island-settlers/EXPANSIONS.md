# Expansion rules and combinations

The existing Base and Seafarers game has completed ten-player browser acceptance. The additional expansion families are implemented in a separate rules/UI batch. [QA.md](QA.md) records its actual verification; this document describes scope and adaptations.

## Scope and combinations

Add Cities & Knights, the five Traders & Barbarians scenarios, and Explorers & Pirates missions. Keep Standard and Connect-style play and 3–10 seats. All generated maps, rosters above six, and simultaneous rounds remain explicit PartyPlay adaptations. Human pacing and balance are separate release gates; an hour is not a promise for a combined game.

Choose one map/sea system: Base, Seafarers, or Explorers & Pirates. Cities & Knights is additive to all three. The two sea systems cannot be combined: Seafarers ships form routes while expedition ships move and carry cargo. On Base/Seafarers, expose individual fishing, rivers, merchant trains, barbarian attack, and wagon-delivery selections. On Explorers & Pirates, fishing is compatible; the other four scenarios are excluded by the official combination notes.

The newer Cities & Knights + Barbarian Attack combination replaces the approaching barbarian fleet with coastal attacks and uses Cities & Knights progress cards/knight strengths. The delivery scenario replaces robber movement with road barbarians. These are explicit rule overrides, not two independent effects triggered together.

## Generated scenarios and limits

These are original generated maps using the expansion mechanics, not reproductions of every published scenario board or campaign. The combined coastal/delivery map uses one castle depot and assigns coastal invaders to adjacent wagon paths automatically. River courses/crossings and merchant-train starts are generated. The 36 hidden expedition hexes form a compact outer discovery region around the home island. Terrain, shoal numbers and spice benefits are seeded before discovery. Seven-to-ten-player supplies, progress-deck duplication and all Connect timing are adaptations.

The selectable Traders & Barbarians variants are Friendly Robber and Harbormaster. Event Cards and CATAN for Two are excluded. Alternate campaigns, scenario-specific victory conditions and the official 5–6-player expansion board layouts are not claimed here.

The legal-command protocol supports every module on the same private phone. Building/trading precede movement; a Connect player can move while another is still building. Mandatory theft, defense, progress and caravan decisions pause shared actions and the deadline. The TV remains the public display.

Approximate one-hour pacing is unverified. Combining multiple expansions increases rules and decision time. Suggested targets are configuration guidance, not human-playtest results.

## Architecture

- `expansion-settings.ts`: shared configuration validation and selection restrictions. Never silently drop an incompatible selection.
- `expansion-model.ts`: public board layers, private progress/token hands, and legal command descriptions. No decks, RNG, or unrevealed terrain.
- Expansion commands use the same room action channel, turn IDs, copy-before-apply transactions, and private projections as the existing game.
- Mandatory choices pause other actions and resume the interrupted phase. Connect timers account for that interruption.
- Fable owns frontend source and animations; Codex owns rule modules, integration, tests, and browser acceptance.

## Official research

Read 12 September 2026. Downloaded PDFs are ignored local research, not distributed assets.

- [Cities & Knights, 2025 rules](https://www.catan.com/sites/default/files/2025-03/CN3087%20CATAN%E2%80%93Cities%26Knights_%20Rulebook.pdf): commodities, progress decks, improvement tracks, metropolises, knights, barbarian attacks.
- [Traders & Barbarians, 2025 rules](https://www.catan.com/sites/default/files/2025-04/CN3089%20CATAN%20%E2%80%93%20T%26B%20Rulebook.pdf): five scenarios and variants.
- [Explorers & Pirates, 2025 rules](https://www.catan.com/sites/default/files/2025-04/CN3085%20CATAN%20%E2%80%93%20E%26P%20Rulebook.pdf) and [mission guide](https://www.catan.com/sites/default/files/2025-04/CN3085%20CATAN%20%E2%80%93%20E%26P%20Missions.pdf): expedition cargo, hidden exploration, settlers, pirate lairs, fish, spices.
- [Explorers & Pirates with Cities & Knights](https://www.catan.com/sites/default/files/2025-08/ExplorersPirates%20w%20CnK.pdf): city/harbor distinction, commodities, island-bound knights, adjusted progress cards.
- [Explorers & Pirates with Traders & Barbarians](https://www.catan.com/sites/default/files/2025-08/ExplorersPirates%20w%20TnB.pdf): fishing integration and explicit exclusions.
- [Official scenario-combination downloads](https://www.catan.com/traders-barbarians): pairwise rules for Cities & Knights, Seafarers and other Traders & Barbarians scenarios.

No official artwork, logos, or rulebook prose is included in the game.
