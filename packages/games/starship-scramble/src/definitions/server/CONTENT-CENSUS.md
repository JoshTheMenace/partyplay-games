# Starship Scramble content census

Generated from the registered catalog on 2026-09-12. 300 scenario roots and 30 separately counted followup nodes contain 31,488 words (titles, situations, choice labels, choice explanations and weighted-outcome text).

Equipment: 8 distinct hull layouts; 48 weapons in 8 families; 12 drones; 12 optional systems plus 7 core systems; 24 augments; 24 enemy archetypes; 8 sector themes.

Root categories: 60 travel, 50 distress, 50 hostile, 40 trade, 40 science, 30 faction, 30 quest. 67 roots (22.3%) have special capability choices.

## Selection-only campaign sample

2048 runs: seeds 1–256, rosters 1–4, Relaxed and Standard. Each traverses 5 sectors and 30 connected beacons, selecting a free ordinary option and applying quest flags and reputation. This samples route selection and eligibility; it does not simulate combat, injuries, purchases, reward RNG, human decisions or survival balance.

61,440 beacon visits, 43,008 event instances, 300/300 roots observed. Repeated roots: 0. Unfulfilled scheduled followups: 0. Special options existed at 14.7% of beacons and a starting fleet qualified at 4.5%. Starter ships in this sample use the fixture's default Wayfarer; specialist builds are exercised by separate zero-wallet and capability tests.

Unseen roots in this policy sample: none. Reputation-gated entry is validated separately; lack of sample coverage is not proof of inaccessibility.

Checks: all 330 nodes have a free ordinary resolution on all 8 starter hulls even with no scrap, no ammunition, and fully disabled weaponry; resolution retries emit no effects; all references, supported effects, equipment IDs, room geometry, and followup cycles validate. Scoped tests also cover 512 seeded route runs, fixed-roster scrap/remainders, contested pickup, personal cargo ownership, tagged loot, persistent personal stores, affordable opening offense, explicit recruitment and lethal-event atomicity.

A separate complementary-build eligibility fixture sampled 256 four-captain Standard routes (7,680 beacons). Four ships each carried three distinct optional systems at tier 2, one additional weapon family within tier-3 weaponry capacity, tier-2 shields, and a legal mixed-skill crew. Special choices qualified at 14.2% of visited beacons (1092/7680). This is a capability/selection fixture, not evidence that players earned these upgrades or that the build survives combat.

## Registered inventory

| ID | Category | Node | Ordinary / special | Effects | Capabilities | Followups | Words |
| --- | --- | --- | --- | --- | --- | --- | --- |
| silent-orchard | travel | root | 0 / 0 | scrap, items |  |  | 69 |
| broken-lifeline | distress | root | 2 / 1 | damage, recruit, threat | system:teleporter |  | 96 |
| toll-of-ash | hostile | root | 2 / 0 | threat, combat |  |  | 93 |
| glasswake | travel | root | 2 / 1 | threat, damage, items | system:scanner |  | 103 |
| borrowed-dawn | distress | root | 2 / 0 | combat, flag, threat |  |  | 91 |
| copper-ledger | trade | root | 0 / 0 | store |  |  | 70 |
| bulkhead-echo | science | root | 2 / 0 | repair, combat, threat |  |  | 112 |
| magnetic-funeral | science | root | 2 / 1 | damage, items, scrap | system:tractor |  | 109 |
| captain-without-hull | trade | root | 2 / 0 | replacement, store |  |  | 96 |
| unfinished-map | quest | root | 2 / 0 | flag, followup, threat |  | survey-answer | 92 |
| terms-of-surrender | faction | root | 2 / 0 | combat, repair, flag |  |  | 95 |
| last-mirror | hostile | root | 1 / 0 | combat |  |  | 86 |
| travel-lantern-account | travel | root | 2 / 0 | damage, scrap, threat |  |  | 103 |
| travel-unclaimed-weather | travel | root | 2 / 0 | threat, ammo |  |  | 107 |
| travel-stowaway-mural | travel | root | 2 / 0 | repair, threat, scrap |  |  | 112 |
| travel-folded-bridge | travel | root | 2 / 1 | damage, items | system:tractor |  | 123 |
| travel-last-postbox | travel | root | 2 / 0 | threat, repair |  |  | 108 |
| travel-cold-regatta | travel | root | 2 / 0 | scrap, timed-status, threat |  |  | 102 |
| travel-spare-shadow | travel | root | 2 / 0 | crew-health, threat |  |  | 105 |
| travel-three-permits | travel | root | 3 / 0 | threat, timed-status |  |  | 123 |
| travel-thin-morning | travel | root | 2 / 1 | hazard, damage | system:life-support |  | 124 |
| travel-table-for-nobody | travel | root | 0 / 0 | crew-health |  |  | 85 |
| travel-dogleg-monument | travel | root | 2 / 0 | reputation, threat, damage |  |  | 102 |
| travel-scrap-dividend | travel | root | 2 / 0 | scrap, items |  |  | 123 |
| travel-dress-rehearsal | travel | root | 2 / 0 | scrap, crew-health |  |  | 103 |
| travel-memory-braid | travel | root | 2 / 1 | items, timed-status | system:hacking |  | 121 |
| travel-coolant-comet | travel | root | 2 / 0 | hazard, crew-health, scrap |  |  | 102 |
| travel-antenna-whales | travel | root | 2 / 0 | threat, scrap |  |  | 105 |
| travel-airlock-tunnel | travel | root | 2 / 0 | hazard |  |  | 106 |
| travel-family-frequency | travel | root | 2 / 0 | repair, threat, scrap |  |  | 108 |
| travel-reverse-tug | travel | root | 2 / 1 | damage, scrap, reputation | crew-skill:pilot |  | 126 |
| travel-amber-reading-room | travel | root | 0 / 0 | repair |  |  | 84 |
| travel-border-hum | travel | root | 2 / 0 | reputation, threat, timed-status |  |  | 106 |
| travel-surveyor-wager | travel | root | 2 / 0 | damage, scrap |  |  | 129 |
| travel-painted-constellation | travel | root | 2 / 0 | scrap, crew-health, reputation, threat |  |  | 106 |
| travel-shield-rain | travel | root | 2 / 1 | items, damage | system:shields |  | 127 |
| travel-runaway-conveyor | travel | root | 2 / 0 | ammo, scrap, reputation, threat |  |  | 109 |
| travel-drum-of-names | travel | root | 2 / 0 | ammo, threat |  |  | 110 |
| travel-weather-quilts | travel | root | 2 / 0 | scrap, timed-status, reputation |  |  | 109 |
| travel-empty-escort | travel | root | 2 / 0 | combat, scrap |  |  | 105 |
| travel-vacuum-honey | travel | root | 2 / 1 | repair, crew-health, scrap | system:drone-bay |  | 127 |
| travel-forgotten-apology | travel | root | 0 / 0 | scrap |  |  | 82 |
| travel-tilted-cylinder | travel | root | 2 / 0 | damage, scrap, reputation |  |  | 109 |
| travel-coolant-hymn | travel | root | 2 / 0 | hazard, threat, reputation |  |  | 108 |
| travel-navigation-auction | travel | root | 2 / 0 | ammo, threat |  |  | 108 |
| travel-broken-palindrome | travel | root | 2 / 1 | scrap, threat | crew-skill:scientist |  | 127 |
| travel-ice-carousel | travel | root | 2 / 0 | items, damage, scrap |  |  | 110 |
| travel-sealed-witness | travel | root | 2 / 0 | scrap, threat, reputation |  |  | 112 |
| travel-paper-sails | travel | root | 2 / 0 | ammo, timed-status, reputation |  |  | 109 |
| travel-laundry-quarantine | travel | root | 2 / 0 | hazard, timed-status, reputation |  |  | 108 |
| travel-compressed-grove | travel | root | 2 / 1 | ammo, scrap, items | weapon-family:beam |  | 128 |
| travel-veterans-marker | travel | root | 0 / 0 | repair |  |  | 84 |
| travel-turbine-reef | travel | root | 2 / 0 | ammo, repair, threat |  |  | 106 |
| travel-ring-exchange | travel | root | 2 / 0 | damage, scrap, crew-health, threat |  |  | 103 |
| travel-ticket-to-yesterday | travel | root | 2 / 0 | reputation, damage |  |  | 111 |
| travel-charged-footsteps | travel | root | 2 / 1 | damage, items, threat | system:point-defense |  | 123 |
| travel-harbor-abacus | travel | root | 2 / 0 | crew-health, scrap, reputation |  |  | 107 |
| travel-ghost-traffic | travel | root | 2 / 0 | ammo, scrap, threat |  |  | 103 |
| travel-ceramic-river | travel | root | 2 / 0 | damage, repair, scrap |  |  | 110 |
| travel-green-flare | travel | root | 2 / 0 | crew-health, threat, reputation |  |  | 108 |
| travel-folded-warehouse | travel | root | 2 / 1 | items, damage, scrap | system:teleporter |  | 123 |
| travel-sky-burial | travel | root | 0 / 0 | reputation |  |  | 82 |
| travel-radiator-bells | travel | root | 2 / 0 | hazard, timed-status, crew-health |  |  | 104 |
| travel-thermal-contest | travel | root | 2 / 0 | damage, scrap, hazard |  |  | 101 |
| travel-exit-signs | travel | root | 2 / 0 | scrap, threat |  |  | 105 |
| travel-map-under-skin | travel | root | 2 / 1 | damage, scrap, reputation | system:scanner |  | 129 |
| travel-launch-rehearsal | travel | root | 2 / 0 | ammo, scrap, reputation |  |  | 108 |
| travel-soup-transmission | travel | root | 0 / 0 | crew-health |  |  | 87 |
| travel-harbor-credit | travel | root | 2 / 0 | ammo, repair |  |  | 107 |
| travel-lantern-sentry | travel | root | 2 / 1 | threat, timed-status | system:cloak |  | 125 |
| distress-missed-shift | distress | root | 2 / 0 | damage, scrap, reputation |  |  | 109 |
| distress-spinning-cradle | distress | root | 2 / 0 | damage, reputation, ammo, scrap |  |  | 112 |
| distress-pressure-choir | distress | root | 2 / 1 | hazard, reputation | crew-skill:medic |  | 130 |
| distress-anchor-tenant | distress | root | 2 / 0 | damage, recruit, reputation |  |  | 114 |
| distress-empty-alarm | distress | root | 0 / 0 | ammo |  |  | 80 |
| distress-salt-lungs | distress | root | 2 / 0 | scrap, timed-status, reputation |  |  | 111 |
| distress-unlit-miner | distress | root | 2 / 0 | threat, reputation, damage, items |  |  | 110 |
| distress-tether-classroom | distress | root | 2 / 1 | damage, items, threat, reputation | system:teleporter |  | 130 |
| distress-counterfeit-flares | distress | root | 2 / 0 | ammo, scrap, reputation, threat |  |  | 107 |
| distress-furnace-crossing | distress | root | 2 / 0 | hazard, scrap, threat, reputation |  |  | 113 |
| distress-sealed-greenhouse | distress | root | 2 / 0 | damage, scrap, timed-status |  |  | 113 |
| distress-stalled-elevator | distress | root | 2 / 0 | crew-health, scrap, reputation |  |  | 111 |
| distress-drifting-infirmary | distress | root | 2 / 1 | timed-status, reputation, threat, crew-health | system:medical-support |  | 128 |
| distress-oxygen-debt | distress | root | 2 / 0 | hazard, items, reputation |  |  | 114 |
| distress-lifeboat-garden | distress | root | 0 / 0 | crew-health, reputation |  |  | 82 |
| distress-two-rescue-claims | distress | root | 2 / 0 | damage, scrap, threat, reputation |  |  | 110 |
| distress-pressure-wedding | distress | root | 2 / 0 | ammo, items, crew-health, scrap |  |  | 113 |
| distress-blind-recovery-tug | distress | root | 2 / 1 | damage, scrap, threat, reputation | system:scanner |  | 132 |
| distress-burned-chartroom | distress | root | 2 / 0 | hazard, scrap, crew-health |  |  | 116 |
| distress-flooded-magazine | distress | root | 2 / 0 | damage, items, ammo |  |  | 109 |
| distress-orphaned-maintenance | distress | root | 2 / 0 | ammo, scrap, threat, reputation |  |  | 117 |
| distress-quarantine-meal | distress | root | 3 / 0 | crew-health, scrap, reputation, threat |  |  | 128 |
| distress-cracked-cupola | distress | root | 2 / 1 | damage, scrap, reputation | system:shield-projector |  | 130 |
| distress-radiation-bakery | distress | root | 2 / 0 | hazard, scrap, reputation |  |  | 118 |
| distress-returned-courier | distress | root | 0 / 0 | crew-health |  |  | 78 |
| distress-exhausted-relay | distress | root | 2 / 0 | crew-health, scrap, threat |  |  | 121 |
| distress-stranded-picket | distress | root | 2 / 0 | ammo, scrap, reputation, threat |  |  | 118 |
| distress-brake-cable | distress | root | 2 / 1 | damage, items, reputation | crew-skill:engineer |  | 138 |
| distress-forgotten-cycle | distress | root | 2 / 0 | hazard, items, reputation |  |  | 119 |
| distress-moving-reservoir | distress | root | 2 / 0 | damage, scrap, threat, reputation |  |  | 111 |
| distress-utility-hostages | distress | root | 2 / 0 | combat, threat, reputation |  |  | 114 |
| distress-lost-storyteller | distress | root | 1 / 0 | crew-health, reputation |  |  | 101 |
| distress-cinder-pilgrims | distress | root | 2 / 1 | hazard, items, reputation | system:repair-relay |  | 137 |
| distress-silent-nursery | distress | root | 2 / 0 | threat, reputation, damage, scrap |  |  | 111 |
| distress-blanket-line | distress | root | 0 / 0 | crew-health |  |  | 83 |
| distress-severed-service-collar | distress | root | 1 / 0 | scrap, reputation |  |  | 102 |
| distress-signal-monopoly | distress | root | 2 / 0 | reputation, threat |  |  | 110 |
| distress-isolated-medics | distress | root | 2 / 1 | damage, recruit, reputation | system:teleporter |  | 135 |
| distress-caustic-freight | distress | root | 2 / 0 | damage, scrap, reputation |  |  | 109 |
| distress-rescue-certificates | distress | root | 0 / 0 | ammo, reputation |  |  | 85 |
| distress-leaking-museum | distress | root | 2 / 0 | damage, items, hazard |  |  | 116 |
| distress-unbolted-home | distress | root | 2 / 0 | damage, scrap, reputation |  |  | 114 |
| distress-falling-radiator | distress | root | 2 / 1 | hazard, scrap, reputation | system:tractor |  | 135 |
| distress-wrong-clock | distress | root | 2 / 0 | scrap, threat, reputation |  |  | 114 |
| distress-last-responder | distress | root | 0 / 0 | crew-health |  |  | 87 |
| distress-evacuation-guns | distress | root | 2 / 0 | combat, threat, reputation |  |  | 120 |
| distress-cooks-hatch | distress | root | 2 / 0 | timed-status, scrap, crew-health |  |  | 114 |
| distress-survivors-survey | distress | root | 2 / 1 | replacement, reputation | crew-skill:engineer |  | 133 |
| tug-of-war | hostile | root | 2 / 0 | damage, reputation, combat |  |  | 82 |
| false-quarantine | hostile | root | 2 / 1 | combat, threat, reputation | crew-skill:medic |  | 98 |
| hull-auction | hostile | root | 2 / 0 | combat, threat, timed-status |  |  | 86 |
| mine-lullaby | hostile | root | 2 / 1 | damage, ammo, combat, scrap | system:decoy |  | 98 |
| stolen-beacon | hostile | root | 2 / 0 | combat, reputation, threat |  |  | 86 |
| boarding-school | hostile | root | 1 / 1 | combat, ammo, items | system:boarding-defense |  | 85 |
| escort-reversal | hostile | root | 2 / 0 | threat, combat, scrap |  |  | 88 |
| oxygen-ransom | hostile | root | 2 / 0 | hazard, combat, reputation |  |  | 83 |
| signal-duelist | hostile | root | 1 / 1 | combat, reputation, timed-status, scrap | system:scanner |  | 87 |
| weapon-recall | hostile | root | 2 / 0 | ammo, combat |  |  | 89 |
| hostage-clock | hostile | root | 2 / 0 | threat, reputation, combat |  |  | 85 |
| plasma-fisher | hostile | root | 2 / 1 | damage, hazard, combat, timed-status, scrap | system:shield-projector |  | 94 |
| witness-protection | hostile | root | 2 / 0 | combat, reputation, threat, recruit |  |  | 84 |
| scrap-camouflage | hostile | root | 2 / 0 | combat, damage, threat |  |  | 86 |
| racing-blockade | hostile | root | 2 / 0 | combat, threat, crew-health |  |  | 89 |
| debt-magnet | hostile | root | 2 / 1 | reputation, combat, scrap | system:tractor |  | 103 |
| friendly-fire-code | hostile | root | 2 / 0 | combat, threat |  |  | 80 |
| vacuum-hounds | hostile | root | 2 / 0 | combat, recruit, reputation, threat |  |  | 86 |
| duplex-ambush | hostile | root | 2 / 1 | items, combat, threat | system:hacking |  | 101 |
| court-martial | hostile | root | 2 / 0 | combat, reputation |  |  | 85 |
| needle-customs | hostile | root | 2 / 0 | hazard, threat, combat |  |  | 81 |
| amnesty-trap | hostile | root | 2 / 0 | combat, reputation, threat, scrap |  |  | 87 |
| engine-tax | hostile | root | 2 / 1 | crew-health, threat, combat | system:cloak |  | 98 |
| salvage-vultures | hostile | root | 2 / 0 | reputation, combat |  |  | 89 |
| blackbox-bounty | hostile | root | 2 / 0 | combat, flag, scrap, reputation |  |  | 88 |
| mirror-mutiny | hostile | root | 2 / 0 | combat, recruit, threat |  |  | 93 |
| live-target-range | hostile | root | 2 / 0 | combat, damage, ammo |  |  | 92 |
| photon-poachers | hostile | root | 1 / 1 | combat, reputation, timed-status, scrap | system:shield-projector |  | 85 |
| painted-neutrality | hostile | root | 2 / 0 | reputation, threat, crew-health |  |  | 88 |
| tethered-artillery | hostile | root | 2 / 0 | combat, damage, reputation |  |  | 83 |
| beacon-blackmail | hostile | root | 2 / 1 | combat, reputation, threat, scrap | system:hacking |  | 99 |
| cold-storage | hostile | root | 2 / 0 | combat, damage, repair |  |  | 85 |
| abandoned-squadron | hostile | root | 2 / 0 | ammo, reputation, combat |  |  | 86 |
| redemption-coupon | hostile | root | 2 / 0 | combat, reputation, threat |  |  | 87 |
| sleeper-turrets | hostile | root | 2 / 0 | damage, threat, combat |  |  | 88 |
| insurance-adjuster | hostile | root | 2 / 0 | threat, combat, repair |  |  | 85 |
| lantern-snuffers | hostile | root | 1 / 1 | combat, reputation, timed-status | system:scanner |  | 87 |
| fragile-truce | hostile | root | 2 / 0 | ammo, reputation, combat |  |  | 87 |
| cargo-choir | hostile | root | 2 / 0 | combat, damage, items |  |  | 86 |
| welding-war | hostile | root | 2 / 0 | combat, repair |  |  | 88 |
| hollow-victory | hostile | root | 2 / 1 | threat, ammo, scrap, damage | system:hacking |  | 98 |
| border-with-wheels | hostile | root | 2 / 0 | combat, reputation |  |  | 84 |
| reflected-distress | hostile | root | 2 / 0 | combat, reputation, threat, crew-health |  |  | 86 |
| probationary-pirate | hostile | root | 1 / 1 | combat, ammo, reputation | system:point-defense |  | 86 |
| emergency-lien | hostile | root | 2 / 0 | reputation, combat |  |  | 96 |
| weaponized-sunshade | hostile | root | 2 / 0 | combat, damage, hazard, reputation |  |  | 85 |
| last-warning-loop | hostile | root | 1 / 1 | combat, reputation, items | system:decoy |  | 93 |
| siege-kitchen | hostile | root | 2 / 0 | combat, reputation, crew-health |  |  | 97 |
| tea-at-apogee | trade | root | 2 / 0 | crew-health, threat |  |  | 84 |
| honest-counterfeit | trade | root | 2 / 0 | items, reputation, threat |  |  | 87 |
| weight-of-water | trade | root | 2 / 1 | hazard, crew-health, scrap, reputation | crew-skill:scientist |  | 104 |
| repair-by-applause | trade | root | 2 / 0 | repair, threat |  |  | 86 |
| ammunition-library | trade | root | 2 / 0 | ammo, reputation |  |  | 89 |
| blind-auction | trade | root | 2 / 1 | items, scrap, store, reputation | system:scanner |  | 126 |
| clockmaker-rate | trade | root | 2 / 0 | repair, crew-health, threat |  |  | 92 |
| secondhand-air | trade | root | 3 / 0 | ammo, hazard |  |  | 95 |
| portrait-payment | trade | root | 1 / 1 | crew-health, reputation, scrap | system:tractor |  | 93 |
| guild-examination | trade | root | 2 / 0 | repair, reputation, threat, store |  |  | 89 |
| empty-vending-machine | trade | root | 2 / 1 | items, reputation | crew-skill:engineer |  | 102 |
| fuel-for-news | trade | root | 2 / 0 | repair, threat |  |  | 82 |
| union-break | trade | root | 2 / 0 | crew-health, repair, threat, store, reputation |  |  | 87 |
| suit-exchange | trade | root | 2 / 0 | crew-health, hazard, reputation, threat |  |  | 84 |
| misprinted-map | trade | root | 2 / 0 | scrap, threat, reputation |  |  | 91 |
| lease-a-lens | trade | root | 2 / 0 | repair, scrap |  |  | 85 |
| floating-bakery | trade | root | 3 / 0 | ammo, crew-health, reputation |  |  | 106 |
| memory-deposit | trade | root | 1 / 1 | items, scrap, threat | crew-skill:pilot |  | 91 |
| sealed-warranty | trade | root | 2 / 0 | repair, flag, store |  |  | 85 |
| weather-broker | trade | root | 2 / 1 | timed-status, threat | system:scanner |  | 102 |
| crew-chess | trade | root | 2 / 0 | items, threat, crew-health |  |  | 89 |
| used-shield-lot | trade | root | 2 / 1 | items, timed-status | system:shields |  | 98 |
| quiet-contract | trade | root | 2 / 0 | scrap, threat |  |  | 92 |
| spare-nameplates | trade | root | 3 / 0 | reputation, ammo |  |  | 102 |
| synchronized-sale | trade | root | 2 / 0 | items, threat, store |  |  | 86 |
| compressed-holiday | trade | root | 2 / 1 | crew-health, timed-status | system:repair-relay |  | 103 |
| parcel-too-large | trade | root | 2 / 0 | ammo, scrap, reputation |  |  | 94 |
| solar-dry-cleaner | trade | root | 2 / 0 | hazard, repair, timed-status |  |  | 86 |
| off-brand-doctor | trade | root | 2 / 1 | crew-health, reputation | crew-skill:medic |  | 97 |
| rent-a-warehouse | trade | root | 2 / 0 | items, reputation, store |  |  | 80 |
| scrap-for-seeds | trade | root | 3 / 0 | reputation, crew-health, ammo, scrap |  |  | 104 |
| reverse-tipping | trade | root | 2 / 0 | scrap, crew-health, threat, reputation |  |  | 89 |
| museum-deaccession | trade | root | 3 / 0 | items |  |  | 99 |
| quiet-frequency | trade | root | 2 / 1 | threat, timed-status | system:scanner |  | 104 |
| lost-and-found-sale | trade | root | 2 / 0 | items, reputation, threat |  |  | 91 |
| wholesale-silence | trade | root | 3 / 0 | repair, crew-health, timed-status |  |  | 105 |
| common-toolbox | trade | root | 2 / 0 | repair, reputation, store |  |  | 93 |
| open-account | trade | root | 2 / 0 | scrap, repair, reputation |  |  | 85 |
| backward-rain | science | root | 1 / 1 | damage, scrap | system:scanner |  | 90 |
| sleeping-compass | science | root | 0 / 0 | items, threat |  |  | 61 |
| living-insulation | science | root | 2 / 0 | repair, hazard, scrap |  |  | 87 |
| timing-flower | science | root | 1 / 1 | scrap, items, threat | weapon-family:ion |  | 91 |
| wrong-shadow | science | root | 2 / 0 | threat, damage, scrap |  |  | 88 |
| choir-of-valves | science | root | 0 / 0 | items, repair |  |  | 66 |
| borrowed-gravity | science | root | 2 / 0 | items, timed-status, threat, scrap |  |  | 89 |
| oxygen-lace | science | root | 1 / 1 | hazard, scrap | system:medical-support |  | 84 |
| vanishing-ink | science | root | 2 / 0 | threat, items |  |  | 84 |
| warm-vacuum | science | root | 2 / 0 | damage, recruit, reputation, threat |  |  | 95 |
| pollen-antenna | science | root | 0 / 0 | threat, hazard |  |  | 62 |
| unburning-cinder | science | root | 1 / 1 | scrap, hazard | system:shield-projector |  | 93 |
| signal-fossil | science | root | 2 / 0 | scrap, threat, reputation |  |  | 85 |
| maze-in-a-droplet | science | root | 2 / 1 | items | crew-skill:medic |  | 103 |
| pressure-garden | science | root | 0 / 0 | hazard, reputation |  |  | 63 |
| silent-pendulum | science | root | 1 / 1 | crew-health, scrap, items | system:tractor |  | 90 |
| echo-lung | science | root | 2 / 0 | hazard, crew-health, scrap |  |  | 92 |
| star-in-a-cup | science | root | 2 / 0 | scrap, ammo, reputation, threat |  |  | 95 |
| glass-memory | science | root | 2 / 1 | repair, ammo | weapon-family:laser |  | 98 |
| sleep-cycle | science | root | 0 / 0 | crew-health |  |  | 65 |
| magnetic-snow | science | root | 2 / 0 | scrap, timed-status, threat |  |  | 86 |
| three-minute-moon | science | root | 2 / 0 | crew-health, items, scrap, threat |  |  | 91 |
| blue-noise | science | root | 2 / 0 | timed-status, scrap, reputation |  |  | 83 |
| vacuum-weaver | science | root | 2 / 0 | repair, hazard |  |  | 92 |
| false-dawn | science | root | 0 / 0 | items, reputation |  |  | 64 |
| resonant-anchor | science | root | 1 / 1 | damage, scrap | system:hacking |  | 87 |
| paper-observatory | science | root | 2 / 0 | scrap, threat, reputation, crew-health |  |  | 95 |
| slow-light | science | root | 1 / 1 | items, crew-health, scrap | system:medical-support |  | 89 |
| forgotten-control-group | science | root | 0 / 0 | crew-health, hazard |  |  | 64 |
| thermal-footprints | science | root | 2 / 0 | threat, scrap |  |  | 82 |
| clockless-laboratory | science | root | 2 / 0 | timed-status, scrap, threat |  |  | 94 |
| metal-bloom | science | root | 1 / 1 | repair, scrap | system:repair-relay |  | 91 |
| tide-table | science | root | 0 / 0 | threat, ammo |  |  | 62 |
| sterile-comet | science | root | 2 / 1 | ammo, scrap, crew-health | weapon-family:beam |  | 94 |
| uncertain-battery | science | root | 1 / 1 | scrap, timed-status | crew-skill:engineer |  | 87 |
| floating-diagnostic | science | root | 2 / 0 | repair, threat, reputation |  |  | 90 |
| scent-of-rain | science | root | 0 / 0 | crew-health, hazard |  |  | 65 |
| one-more-decimal | science | root | 2 / 0 | scrap, threat |  |  | 85 |
| public-tribunal | faction | root | 2 / 0 | threat, reputation, scrap |  |  | 90 |
| shared-calendar | faction | root | 2 / 1 | reputation | crew-skill:scientist |  | 101 |
| convoy-ballot | faction | root | 2 / 0 | reputation, threat, scrap |  |  | 88 |
| border-feast | faction | root | 2 / 0 | crew-health, reputation, threat |  |  | 92 |
| unclaimed-monument | faction | root | 2 / 0 | reputation, scrap |  |  | 86 |
| open-channel-charter | faction | root | 2 / 0 | items, reputation, threat, store |  |  | 85 |
| debt-pardon | faction | root | 2 / 0 | reputation |  |  | 90 |
| dock-strike | faction | root | 1 / 1 | reputation, crew-health, threat | crew-skill:medic |  | 86 |
| inheritance-fleet | faction | root | 2 / 0 | reputation, threat, scrap |  |  | 90 |
| returning-deserter | faction | root | 2 / 0 | reputation, threat |  |  | 86 |
| neutral-chart | faction | root | 2 / 0 | threat, reputation |  |  | 91 |
| pilgrim-vigil | faction | root | 2 / 1 | damage, reputation | system:scanner |  | 101 |
| freehold-water | faction | root | 2 / 0 | reputation, threat |  |  | 95 |
| guild-seal | faction | root | 2 / 0 | store, reputation, repair |  |  | 92 |
| election-relay | faction | root | 1 / 1 | reputation, crew-health, scrap | system:repair-relay |  | 83 |
| wounded-truce | faction | root | 3 / 0 | crew-health, ammo, reputation |  |  | 99 |
| language-clinic | faction | root | 2 / 0 | crew-health, reputation, threat |  |  | 87 |
| confiscated-ambulance | faction | root | 3 / 0 | reputation, ammo |  |  | 97 |
| cemetery-lane | faction | root | 2 / 0 | reputation, threat, scrap |  |  | 92 |
| refugee-charter | faction | root | 2 / 0 | reputation, threat |  |  | 91 |
| treaty-archive | faction | root | 1 / 1 | reputation, scrap, threat | system:hacking |  | 83 |
| watch-rotation | faction | root | 2 / 0 | items, reputation, threat, ammo |  |  | 90 |
| broken-oath | faction | root | 2 / 0 | reputation, crew-health, scrap |  |  | 94 |
| flag-lesson | faction | root | 2 / 0 | reputation, threat |  |  | 96 |
| migrant-library | faction | root | 2 / 0 | reputation, threat |  |  | 89 |
| narrows-common | faction | root | 2 / 0 | threat, reputation |  |  | 85 |
| sponsor-engineer | faction | root | 2 / 0 | reputation, items, threat |  |  | 87 |
| annual-audit | faction | root | 2 / 0 | repair, reputation |  |  | 91 |
| empty-throne | faction | root | 2 / 0 | reputation, threat, ammo |  |  | 97 |
| last-letter | quest | root | 2 / 0 | flag, followup |  | last-letter-arrival | 90 |
| missing-spool | quest | root | 2 / 0 | threat, flag, followup |  | missing-spool-arrival | 93 |
| lost-choir | quest | root | 2 / 0 | flag, followup |  | lost-choir-arrival | 90 |
| warm-seeds | quest | root | 2 / 1 | flag, followup, threat | crew-skill:engineer | warm-seeds-arrival, warm-seeds-arrival | 111 |
| stolen-bell | quest | root | 2 / 0 | flag, followup |  | stolen-bell-arrival | 88 |
| surveyor-footsteps | quest | root | 2 / 0 | flag, followup |  | surveyor-footsteps-arrival | 92 |
| quiet-engine | quest | root | 2 / 0 | flag, followup |  | quiet-engine-arrival | 91 |
| sister-stations | quest | root | 2 / 0 | flag, followup |  | sister-stations-arrival | 88 |
| unpaid-rescue | quest | root | 2 / 0 | flag, followup |  | unpaid-rescue-arrival | 96 |
| ice-translator | quest | root | 2 / 0 | flag, followup |  | ice-translator-arrival | 91 |
| missing-night-shift | quest | root | 2 / 0 | flag, followup |  | missing-night-shift-arrival | 84 |
| broken-weather-chain | quest | root | 2 / 0 | flag, followup |  | broken-weather-chain-arrival | 93 |
| wandering-toolkit | quest | root | 2 / 0 | flag, followup |  | wandering-toolkit-arrival | 89 |
| long-distance-birthday | quest | root | 2 / 0 | flag, followup |  | long-distance-birthday-arrival | 88 |
| unopened-ballot-box | quest | root | 2 / 0 | flag, followup |  | unopened-ballot-box-arrival | 92 |
| rescuer-reunion | quest | root | 2 / 0 | flag, followup |  | rescuer-reunion-arrival | 90 |
| leaking-library | quest | root | 2 / 0 | flag, followup |  | leaking-library-arrival | 86 |
| false-shipwreck | quest | root | 2 / 0 | flag, followup |  | false-shipwreck-arrival | 89 |
| night-garden | quest | root | 2 / 0 | flag, followup |  | night-garden-arrival | 87 |
| echo-return | quest | root | 2 / 0 | flag, followup |  | echo-return-arrival | 93 |
| apprentice-exchange | quest | root | 2 / 0 | flag, followup |  | apprentice-exchange-arrival | 88 |
| missing-keel | quest | root | 2 / 0 | flag, followup |  | missing-keel-arrival | 93 |
| pilgrim-recipe | quest | root | 2 / 0 | flag, followup |  | pilgrim-recipe-arrival | 92 |
| unfinished-rescue-drill | quest | root | 2 / 0 | flag, followup |  | unfinished-rescue-drill-arrival | 89 |
| sealed-observation | quest | root | 2 / 0 | flag, followup |  | sealed-observation-arrival | 86 |
| replacement-window | quest | root | 2 / 0 | flag, followup |  | replacement-window-arrival | 89 |
| honest-distress-log | quest | root | 2 / 0 | flag, followup |  | honest-distress-log-arrival | 94 |
| paired-beacons | quest | root | 2 / 0 | flag, followup |  | paired-beacons-arrival | 88 |
| homeward-tools | quest | root | 2 / 0 | flag, followup |  | homeward-tools-arrival | 92 |
| survey-answer | quest | followup | 0 / 0 | repair, items, flag |  |  | 72 |
| last-letter-arrival | quest | followup | 2 / 0 | flag, items, reputation, scrap |  |  | 75 |
| missing-spool-arrival | quest | followup | 2 / 0 | flag, repair, threat, ammo, scrap |  |  | 80 |
| lost-choir-arrival | quest | followup | 2 / 1 | flag, reputation, items, scrap | crew-skill:scientist |  | 81 |
| warm-seeds-arrival | quest | followup | 2 / 0 | flag, repair, crew-health, reputation |  |  | 75 |
| stolen-bell-arrival | quest | followup | 2 / 0 | flag, ammo, items, reputation, threat |  |  | 75 |
| surveyor-footsteps-arrival | quest | followup | 2 / 0 | flag, recruit, threat, scrap |  |  | 81 |
| quiet-engine-arrival | quest | followup | 1 / 1 | flag, items, repair, threat | crew-skill:engineer |  | 79 |
| sister-stations-arrival | quest | followup | 2 / 0 | flag, repair, ammo, crew-health, reputation, threat |  |  | 75 |
| unpaid-rescue-arrival | quest | followup | 2 / 0 | flag, reputation, threat, repair, scrap |  |  | 69 |
| ice-translator-arrival | quest | followup | 1 / 1 | flag, items, reputation, threat | crew-skill:scientist |  | 78 |
| missing-night-shift-arrival | quest | followup | 2 / 0 | flag, combat, reputation, crew-health |  |  | 80 |
| broken-weather-chain-arrival | quest | followup | 2 / 0 | flag, threat, scrap, ammo |  |  | 79 |
| wandering-toolkit-arrival | quest | followup | 2 / 0 | flag, items, threat, combat, reputation |  |  | 80 |
| long-distance-birthday-arrival | quest | followup | 2 / 0 | flag, crew-health, threat, ammo, repair |  |  | 82 |
| unopened-ballot-box-arrival | quest | followup | 2 / 0 | flag, combat, reputation, threat |  |  | 76 |
| rescuer-reunion-arrival | quest | followup | 2 / 0 | flag, repair, items |  |  | 81 |
| leaking-library-arrival | quest | followup | 1 / 1 | flag, items, reputation, scrap, threat | system:medical-support |  | 69 |
| false-shipwreck-arrival | quest | followup | 2 / 0 | flag, scrap, items, threat, reputation |  |  | 78 |
| night-garden-arrival | quest | followup | 2 / 0 | flag, items, reputation, scrap, threat |  |  | 82 |
| echo-return-arrival | quest | followup | 2 / 0 | flag, ammo, repair, scrap |  |  | 79 |
| apprentice-exchange-arrival | quest | followup | 1 / 1 | flag, items, reputation, threat | crew-skill:engineer |  | 80 |
| missing-keel-arrival | quest | followup | 2 / 0 | flag, ammo, items, reputation, scrap, threat |  |  | 73 |
| pilgrim-recipe-arrival | quest | followup | 2 / 0 | flag, crew-health, reputation, threat, scrap |  |  | 80 |
| unfinished-rescue-drill-arrival | quest | followup | 2 / 0 | flag, combat, recruit, reputation |  |  | 82 |
| sealed-observation-arrival | quest | followup | 2 / 0 | flag, reputation, scrap, items, threat |  |  | 86 |
| replacement-window-arrival | quest | followup | 2 / 0 | flag, repair, threat, reputation |  |  | 80 |
| honest-distress-log-arrival | quest | followup | 2 / 0 | flag, reputation, threat, ammo, repair |  |  | 76 |
| paired-beacons-arrival | quest | followup | 2 / 0 | flag, reputation, scrap, threat |  |  | 78 |
| homeward-tools-arrival | quest | followup | 2 / 0 | flag, repair, hazard, items |  |  | 79 |
