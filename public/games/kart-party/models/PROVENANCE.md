# Kart Party model provenance

All models in this directory are project-owned original procedural assets generated with Blender 5.2 LTS. They use meters, export Y-up for Three.js, and are licensed with the Party Place project. Generation source and review evidence are maintained separately from this game repository.

| Runtime asset | Generator | Stable roots / pivots | Rebuild command |
| --- | --- | --- | --- |
| `kart_chassis.glb` | `tools/kart-party-assets/build_kart_chassis.py` | `KartChassis`, `KartBody`, four wheel-spin nodes, two front-wheel pivots, `SteeringPivot`; ground contact at Y=0, visible front +Z | `render_offload.sh tools/kart-party-assets/build_kart_chassis.py` |
| `kart_driver.glb` | `tools/kart-party-assets/build_kart_driver.py` | `KartDriver`, body/head pivot and named two-segment arm/hand hooks; seated against the chassis steering grips | `render_offload.sh tools/kart-party-assets/build_kart_driver.py` |
| `kart_powerups.glb` | `tools/kart-party-assets/build_powerups.py` | `KartPowerups` plus the 12 item identifiers; held-object scale/origin | `render_offload.sh tools/kart-party-assets/build_powerups.py` |
| `kart_pickups.glb` | `tools/kart-party-assets/build_course_pickups.py` | `KartPickups`, `field_coin`, `item_box`; centered for surface-frame instancing | `render_offload.sh tools/kart-party-assets/build_course_pickups.py` |
| `seabreeze_reference.glb` | `tools/kart-party-assets/build_seabreeze_reference.py` | `SeabreezeReferenceKit`; three palms, three cliffs, two harbor houses, dock, crane, two containers and `Lighthouse`; each asset origin is its placement root | `render_offload.sh tools/kart-party-assets/build_seabreeze_reference.py SAMPLES=40` |

The reference pack was rendered on an RTX 3090 and structurally checked in `packages/games/kart-party/tests/kart-asset.test.ts`. Its current SHA-256 is `5b6fe23789d296f7a77587bc0d75e71ca4cab930c35f4c4c838a5896c60d4254`.
