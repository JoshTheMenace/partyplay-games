# Contract changes

Additive edits to `src/model.ts` / `src/geometry.ts` made during the build waves (who, what, why).

- WP-rules: `GameEvent` `build` gains `spot?: string` (the vertex or edge built on). Its `at: string`
  collides with `EventBase.at` (the event time), so the intersection is `never` and `emit` overwrites
  it with the time; the location was lost. Read `spot` for the placement (WP-scene `drops`,
  fixtures). Optional only so existing fixture builders keep compiling; the engine always sets it.
- WP-seafarers (registry, additive): `Module.legal.shipMove?(s, seat, from): Why | null`, called by
  `legal.ts` `shipMoves` for each otherwise-movable ship. Seafarers uses it for the official "you may
  not move a ship you built this turn" rule (ships built this opportunity live in `s.ext.seafarers`).
- WP-seafarers (coordination, no code change): the Seafarers `produce` hook turns **every** producing,
  unblocked gold hex into `roll.gold` (1 per settlement, 2 per city) and merges with
  `Math.max(existing, own)` per seat. Any other module that owes gold for gold hexes (Rivers gold on
  a Seafarers map) must merge the same way (`Math.max`, not `+`), so a hex is never paid twice
  whichever hook runs first.
- WP-integration (engine state, additive): `Seat.shipsBuilt: EdgeId[]`, the ships placed this
  opportunity. `pieces.placeRoute` records ship placements and `flow.startOpportunity` clears the list
  (ship moves use `moveRoute`, so a moved ship is not "built"). WP-seafarers may read it instead of its
  own copy in `s.ext.seafarers`.
- WP-integration (engine behaviour): a `self` prompt (a Knight's robber) pauses its owner's step clock.
  `prompts.closePrompt` (used by answers and autos) adds the time the prompt was open to the seat's
  timer `base` and recomputes its capped `deadline`.
- WP-integration (registry doc only): `Module.init(s)` runs after the bank is stocked, so a module may
  set starting stock there (commodities start at 0, e.g. `s.bank.paper = 12`).
- WP-integration (fixtures): the hidden victory-card score part uses the engine key `vp-cards`
  ("Victory point cards", ENGINE §11) instead of `victory`, matching results columns.
- WP-integration (UI): the TV left rail mounts WP-trade-ui's `OfferRail` (the HUD's own offers.tsx is
  gone). The seat rail exposes `[data-seat-gains=<id>]` on each row's stats line and
  `[data-bank="table"]` on the Table card; the theatre looks for `[data-bank="table"]` (the phone
  composer's bank pill also carries `data-bank`). In the finale the rail reads the theatre's per-frame
  clock, so totals and the rank re-sort land on their slot instead of up to 1 s late.
- WP-ck (profile, additive + one call site): `Profile.roundLimitScale: number` (default 1) multiplies
  `flow.ROUND_LIMIT` in `closeRound`. Cities & Knights sets 1.5 (Standard 225, Connect 150 rounds):
  at the 13-point target a C&K game needs ~30% more rolls than base, and CPU-only Connect games
  averaged ~86 rounds (some over 100) even though they were progressing, so the 100-round net cut
  healthy games short.
- WP-ck (coordination, no code change): C&K reads `profile.coastalBarbarians` (set by Barbarian
  Attack) to switch off its barbarian ship track and its own knight commands (castle knights replace
  them). The pirate is held and released by Seafarers from `ext['cities-knights'].barbarian.attacks`;
  C&K itself only holds the robber (off the board until the first attack). Knights are units of kind
  `knight` (`level` = strength, `at` = vertex) and block opponents' routes (`blocksRoute`) and every
  settlement site (`legal.settlement`).
- WP-tb-a (registry, additive + one call site): `Module.robbable?(s, thief, victim): boolean`, checked
  by `legal.ts` `victims` for the robber and pirate. Friendly Robber uses it so a seat with 2 VP or less
  is never robbed, even when every hex is protected and the core falls back to "any hex".
- WP-tb-a (engine behaviour, `prompts.ts` `robberOptions`): an off-board robber or pirate (`null`) now
  still enters play on a 7 or a Knight (official Fishing, Merchant Trains and Seafarers: "the robber
  starts next to the board"), unless `profile.robberWaitsForFirstAttack` (C&K holds it until the first
  attack). Needed because the Fishing lake and the Caravans oasis may take the only desert, and 2 fish
  remove the robber. WP-ck: with Fishing or Caravans `start.robber` can be `null`, so after the first
  attack the robber must be placed somewhere (any desert or land hex) to enter play; Fishing hides its
  "remove the robber/pirate" spends while `robberWaitsForFirstAttack` is set, since removal would be final.
- WP-tb-a (fixture note, `tests/rules/production.test.ts`): that WP-rules test borrows the
  `friendly-robber` module object as a host for a temporary `discardLimit`. With the real Friendly Robber
  the hex it robs (seat with 1 VP) is protected, so the test now fails; it should borrow `harbormaster`
  (no robber rules) instead.
- WP-tb-b (registry, additive + one call site): `Module.onDevPlay?(s, seat, kind: DevKind)`, called at the
  end of `dev.ts` `playDev` after the card's own effect. Deliveries uses it for the scenario Knight (move
  a road barbarian and rob its road owner), since the scenario has no robber.
- WP-tb-b (profile, additive): `Profile.coastalBarbarians: boolean` (default false), set by Barbarian
  Attack. WP-ck already reads it (entry above). Both scenarios also set `pirate: false` (official
  Seafarers combination sheets: neither the robber nor the pirate is used).
- WP-tb-b (data for WP-scene / WP-map / WP-cpu, no contract change): Barbarian Attack invaders are
  `barbarian` units `inv-<tile>` on numbered coastal hexes of the home island (`level` = count, 3 =
  conquered); guards are `guard` units on edges (`level` = strength, `active`); the castle is terrain
  `castle`. There are no `landing` features: official landings may hit any numbered coastal hex, and
  board `reserve()` keeps ports off landing hexes, which would remove every coastal port. Deliveries:
  `depot` features on inland home corners, `wagon` units `w-<seat>` (`level` 1–5, `cargo` holds at
  most one `CargoKind`), `raider` units on edges. With both scenarios on, the invaders stand in for the
  raiders (first `count` sides of each invaded hex, in `tileEdges` order).
- WP-tb-b (note for WP-core `settings.ts`): the official combined targets are Barbarian Attack +
  Deliveries 14, Deliveries + C&K 15 and "+3" for either scenario on Seafarers; `suggestedTarget`
  currently gives 13 for the first two and the Seafarers target for the third.
- WP-ep (profile, additive + two call sites in `legal.ts`): `Profile.cities: boolean` (default true).
  Explorers & Pirates sets it to `settings.citiesKnights` (official: no cities unless C&K joins). When
  false, `buildOptions` omits the `city` row and `targets(…, 'city')` is empty, so the build action is
  rejected and CPUs never save grain and ore for a city they can never build.
- WP-ep (model, additive): `ModulePublic.explorers` gains `hauls?: TileId[]` (shoals holding a fish
  haul) and `pirate?: SeatId | null` (owner of the pirate ship at `pieces.pirate`). The engine always
  sets both; optional only so existing fixture builders keep compiling.
- WP-ep (data for WP-scene / WP-map / WP-cpu, no contract change): expedition ships are `expedition`
  units on sea edges (`level` 2 = cargo slots; settler and fish haul take both, crew and spice sack
  one). Lairs, spice farms and shoals are hidden faces until discovered (`Reveal.feature` carries the
  `lair` / `spice` feature; a lair shows number 0 until captured). The Council of Catan is a public
  `council` tile + feature. The E&P pirate reuses `pieces.pirate` (Seafarers' `profile.pirate` stays
  false); its prompt kind is `explorers/pirate`. Starting ships come from the self prompt
  `explorers/launch` opened when a setup harbor is placed (the setup plan drops the route step after it).
- WP-ep (notes for others, no change made): (1) WP-core `auto.ts` `dueAt`/`expireDue`: a step timer that
  expires while its seat has an open `self` prompt is skipped but stays "due", so every tick commits (and
  `fastForward` spins) until the prompt closes — seen when the C&K round-2 harbor's launch prompt overlaps
  the first roll. (2) WP-trade `invalidateOffers` keeps an `accept` from a seat that has started moving
  (`pairOk` false), so the proposer's `confirm-trade` is rejected; E&P now answers "no" for a seat when
  it starts sailing, but the generic fix (reset to `pending` when `pairOk` fails) also covers Deliveries.
  (3) WP-ck: E&P + C&K knights may not travel by ship or stand next to fog, Medicine's harbor price
  (1 grain 1 ore) and Taxation → pirate are not wired; `cornerWhy` in `modules/explorers/rules.ts` is the
  fog/lair check to reuse. (4) WP-tb-a: E&P + Fishing spends (2 fish ignore the pirate, 5 fish a free
  road or ship, 7 fish a second move) need the E&P ship helpers in `modules/explorers/sea.ts`.
