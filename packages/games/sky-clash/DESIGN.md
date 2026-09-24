# Sky Clash v2: design and build contract

Sky Clash is being rebuilt as a polished party version of Melee for PartyPlay. It uses one shared TV or laptop display, 1–4 phones as controllers, and optional CPU fighters. **Keep the Melee content:**

- all 33 fighters (`src/roster.ts`, `fidelity/roster.json`);
- the imported per-character attributes (`fidelity/attributes.ts`) and attack command streams (`fidelity/scripts.ts`, `fidelity/commands.ts`, `fidelity/physics.ts`);
- the 30 stages (ids in `src/stages.ts`);
- the user's music and sound in `public/games/sky-clash/audio`.

**Rebuild everything else** much better: the engine and game feel, the full move import, CPUs, all 33 character models (new Blender pipeline), animation, effects, stage art, camera, phone controls, the TV HUD and the menus.

The quality bar is a polished commercial party fighter. Movement should be crisp and responsive, and hits should land with weight: hitlag, shake, sparks and sound. Silhouettes must read on a TV from the couch. Phone controls should work without looking. Characters should be instantly recognizable and appealing.

## Fixed contract (read first)

| File | Contents |
| --- | --- |
| `src/manifest.ts` | 1–4 players, landscape phones, 60 Hz simulation, 30 Hz snapshots |
| `src/model.ts` | Rig/material/costume contract, move ids with their Melee source names, poses, hitbox shape, `Input`, `LobbyChoice`, `Settings`, `View` and every public field |
| `src/roster.ts` | Generated roster (name, color, height, radius, special names, style, bonus profile) |

Contract files are coordinator-owned. You may **add optional fields** to `model.ts` types if you need them (note it in your report). Do not rename or remove fields.

## Local sources

- **Melee fighter dumps**, one JSON per regular character: `/Users/joshthemenace/Documents/ChatGPT/partyplay/output/melee-fidelity/*.json`. `nodes[0].data` has 97 `attributes`, about 300 `subactions` (`shortName`, decoded `events` with hitbox fields) and `subroutines`. These include SpecialN/S/Hi/Lw (plus air variants), AttackDash, Catch/CatchDash/CatchAttack, ThrowF/B/Hi/Lw, CliffAttack*, DownAttack*, Appeal and more, beyond the normals already in `fidelity/scripts.ts`.
- **Melee decompilation**, pinned: `/private/tmp/partyplay-melee-reference/` (`src/melee/ft/...`, `lb/...`) for formulas and constants.
- **The previous implementation** in git: `git -C <root>/game-modules show HEAD:packages/games/sky-clash/<path>`. It is deleted piece by piece as owners replace it. Read it for what is worth keeping, such as the lobby choice validation and the audio mixer safety.

## Ownership (edit only your files)

| Owner | Files |
| --- | --- |
| engine | `src/server.ts`, `src/sim/**`, `src/moves.ts`, `src/moveset.ts`, `fidelity/**` (extend only; keep existing data valid), `tools/import_roster.py` and `tools/import_*.py`, `tests/sim-*.test.ts`, `tests/rules.test.ts`, `tests/fidelity*.test.ts`, `tests/combat.test.ts`, `tests/mechanics.test.ts`, `tests/roster.test.ts`, `tests/selection.test.ts` |
| content (after engine) | `src/specials.ts`, `src/specials/**`, `src/poses-table.ts` (fighter × move → pose/limb), `tools/balance.ts`, `tests/balance.test.ts`, `tests/specials.test.ts`; may extend `src/sim/**` special behaviors |
| stages | `src/stages.ts`, `tests/stages.test.ts`, `STAGES.md` |
| models-lead, then models-a/b/c | `tools/blender/**` (lead owns `common.py`, `validate.py`, `render_sheet.py`, `build_all.sh`; each models agent owns only its fighters' `tools/blender/fighters/<kind>.py`), `assets/fighters/<kind>.glb`, `assets/portraits/<kind>.webp`, `assets/renders/<kind>.webp`, `assets/costumes/<kind>.json`, `assets/models/<kind>.json` |
| fighter-render | `src/scene/fighter/**`, `src/scene/fx/**`, `tests/scene-fighter*.test.ts`, `tests/scene-fx*.test.ts`, `tools/pose-lab/**` |
| stage-render | `src/scene/index.tsx`, `src/scene/camera.ts`, `src/scene/tags.ts`, `src/scene/stage/**`, `tests/scene-camera*.test.ts`, `tests/scene-stage*.test.ts`, `tools/stage-lab/**`, `public/games/sky-clash/maps/*.webp` (regenerated) |
| ui | `src/client.tsx`, `src/ui/**`, `src/style.css`, `src/art.tsx`, `src/audio.ts`, `src/audio-view.tsx`, `tools/build_audio.py`, `tools/ui-lab/**`, `tests/ui-*.test.ts`, `tests/audio.test.ts` |
| integration (later) | Deleting obsolete files (`src/scene.tsx`, `src/rig.ts`, `src/animation.ts`, `src/stage-scene.ts`, `src/lobby.tsx`, `src/selection.tsx`, `lab/`, old `assets/*-replacement.*` and `*-portrait.png`, old tools, `tests/animation.test.ts`, `tests/fidelity-rig.test.ts`), `README.md`, `QA.md`, `REFERENCE.md`, platform files outside `game-modules` |

All owners work in the same checkout at the same time.

- Never run git commands that change state (no checkout, stash, reset, restore, add or commit), and never run Prettier.
- Never delete or rewrite another owner's files. Obsolete old files are deleted by integration.
- The root `npx tsc --noEmit` covers the whole repository. Filter it to your own paths, since other owners' work in progress may not compile yet.

Imports from `src/`:

- `../../../party-contract/src/index`
- `../../../party-ui/src/index`
- `../../../party-runtime/src/index`
- `../../../party-3d/src/index`

Browser code (client, ui, scene) must never import `src/server.ts` or `src/sim/**`; the Vite build fails if `server.ts` enters the browser graph. `src/moveset.ts`, `src/specials.ts`, `src/poses-table.ts`, `src/stages.ts`, `src/roster.ts` and `fidelity/**` are browser-safe data.

## Game design

### Match flow

1. **Lobby (phone, portrait or landscape).** Each player chooses a fighter (all 33 plus Random, with search and series-style grouping), one of four costumes, and votes for a stage (all 30 plus Random), then taps Ready. Drafts persist via `lobbyChoice`. The display shows every seat's render, costume and vote. The host's Settings view contains stocks, time, CPUs, CPU level, teams, hazards and stage mode.
2. **Preparation.** The display scene loads models and the stage, then reports ready.
3. **Countdown.** "3-2-1-GO" over three seconds. Input is ignored, but press counters are absorbed so nothing fires at GO.
4. **Fight.** A stock battle; the last fighter (or team) standing wins.
5. **Time up.** The most stocks wins, then the lowest damage. Players still tied go to **Sudden Death**: 300%, one stock, 60 seconds, then a shared win if still tied.
6. **Results.** Placements, KOs, falls and damage dealt, plus a highlight line. Replay returns to the lobby.

Defaults: 4 stocks, 8 minutes, 0 CPUs, normal CPUs, free-for-all, hazards on, stage vote. A lone human with 0 CPUs automatically gets one CPU. A disconnected fighter stands idle and forfeits after 20 seconds offline.

### Engine and feel

**Keep Melee's character.** Use each fighter's own attributes for:

- walk and dash speed, initial dash, friction and traction;
- jumpsquat, full and short hop, double-jump multipliers, air speed, drift, gravity, terminal and fast-fall speed;
- weight and landing lag.

Use each fighter's imported move data: damage, angles, base, growth and weight-set knockback, hitbox size, windows, autocancel, IASA and charge frame. Use Melee's knockback formula and constants from the decompilation (`ftcommon.c`, `ft_*` knockback helpers): hitstun ×0.4, launch speed ×0.03 decaying 0.051 per frame, the tumble threshold, Sakurai angle 361, DI of up to 18°, and the hitlag formula.

Convert lengths with `UNIT` only; never rescale character tuning. Where Melee behavior is unrecoverable, reconstruct it deliberately and say so in code comments.

**Make it play well on phones.** Everything a phone sends crosses a 20 Hz coalesced link, and the display interpolates about 50–100 ms behind, so be forgiving where Melee is frame-tight:

- an 8-frame input buffer for every press;
- short hop if Jump is released by the end of jumpsquat, or when Jump + Attack share a buffer (short-hop aerial);
- 5 frames of coyote time;
- ledge snap range about 30% more generous than Melee;
- shield-drop with a longer window;
- no wavedash/L-cancel requirement. Aerials auto L-cancel halfway: landing lag uses Melee's L-canceled value, which reduces the barrier without flattening characters. Setting `lcancel: 'auto'` is the default. You may add a Melee-strict toggle later.

**Mechanics** (implement all of them):

- **Ground movement:** walk, dash and run, dash-dance, turnaround skid, crouch, teeter at edges, and platform drop-through (down, or down + jump).
- **Air:** fast fall with a spark event, air jumps (Kirby and Jigglypuff get 6 total), and Melee-style directional air dodge into helpless fall, 10 frames landing lag.
- **Ledges:** grab with intangibility frames on the first grab after landing or being hit, 5 s hang, and options for climb, jump, roll and attack (quick and slow variants after 100% damage), or drop. One fighter per ledge, and the arriving grab trumps the hanging one.
- **Shield:** bubble shield with 100 HP; it depletes while held and regenerates when released. Shieldstun, and powershield/parry in the first 4 frames plus a 2-frame buffer, which reflects projectiles. Shield break sends the fighter upward, then into dizzy. From shield: jump, grab, roll, spot dodge.
- **Grabs:** standing and dash grabs from the Catch scripts, pummel, four throws using their real scripts and throw knockback, mash-out, and grab release.
- **Hits:**
  - simultaneous-contact resolution (trades);
  - clank rebound when damages are within 9% (`clank` flags);
  - hitlag with SDI;
  - hitstun and tumble;
  - tech in place/roll, wall tech and ceiling tech (shield within a 20-frame window before contact);
  - knockdown with getup options and getup attacks;
  - the stale-move queue.
- **Charged smashes:** hold 60 frames, ×1.367 damage.
- **Specials:** real hitbox windows from the SpecialN/S/Hi/Lw scripts, with behaviors reconstructed per character: projectiles, rush, recovery trajectories, reflectors, absorbers, counters, armor, transforms (Zelda↔Sheik), rest, inhale-as-attack and so on. Up-specials lead to helpless fall.
- **Respawn:** a halo platform, invulnerability, and drop or act to leave it.
- **Blast zones:** per stage, with a KO event carrying the angle. Star KOs are optional flair for top blast zone KOs.
- **Hazards** as the stage defines them, with a warning.
- **Teams:** no friendly fire.
- **CPU fighters (levels 1–3):** synthetic inputs inside `tick()`, deterministic from the seed. Level 1 is slow and passive. Level 2 is competent and recovers. Level 3 reacts quickly, spaces, DIs, techs, edge-guards and mixes ledge options. CPUs always try to recover and never self-destruct. Names are `CPU 1`, `CPU 2`… and ids `cpu-1`….
- **Determinism:** a seeded RNG in state, and no `Math.random` in the simulation.

Publish `hits` (live hitbox world positions and limb) for active frames, so animation reaches toward what actually hits.

### Stages

Thirty stages, keeping the current ids. Rebuild each layout as a faithful approximation of the real Melee stage at Melee scale, converted with `UNIT`. For example:

- **Battlefield:** a main platform about 137 units wide, with three soft platforms at about 27 and 54 units.
- **Final Destination:** about 170 units wide.
- **Yoshi's Story, Dream Land, Fountain of Dreams and Pokémon Stadium:** their real platform layouts and moving behavior.
- **Blast zones:** from each stage's known values where available.

Use real Melee stage names for display (for example "Battlefield", "Final Destination", "Princess Peach's Castle"). Keep Cloudbreak as the bonus original stage.

Solid ground is **blocks** (floor top, walls on the sides, ceiling beneath) with grabbable ledges at exposed top corners. Soft platforms are one-way. Moving platforms and transformations use deterministic functions of `stageTick`. Hazards are simplified but recognizable (Randall the cloud, Great Bay turtle, Pokémon Stadium transformations and so on), each with a warning and a hazards-off switch. `stageFrame(id, tick, hazards)` returns blocks, platforms (with per-tick dx/dy for carry), ledges and the hazard state for both the server and the renderer.

**Stage API** (the stages owner lands this API first, with Battlefield, Final Destination and Cloudbreak, before converting the rest; the engine and stage-render code against it):

```ts
export const STAGE_IDS: readonly StageId[];              // the existing 30 ids
export type Block = { id: string; left: number; right: number; top: number; bottom: number; ledges: boolean; moving?: boolean };
export type Platform = { id: string; left: number; right: number; y: number; dx: number; dy: number };   // one-way, current position
export type Ledge = { id: string; block: string; x: number; y: number; side: -1 | 1 };                  // -1 = block's left edge
export type Zone = { left: number; right: number; bottom: number; top: number };
export type HazardFrame = { kind: string; label: string; warning: boolean; active: boolean; zones: Zone[]; push: number; damage: number; angle: number; kbBase: number; kbGrowth: number; cycle: number };
export type StageDef = { id: StageId; name: string; blurb: string; family: string; palette: { skyTop: string; skyBottom: string; fog: string; ground: string; trim: string; accent: string; light: string };
  blast: Zone; camera: Zone; spawns: readonly [number, number][]; respawns: readonly [number, number][]; /* 4 each */ };
export const getStage: (id: StageId) => StageDef;
export const resolveStage: (choice: StageId | 'random' | undefined, seed: number) => StageId;
export function stageFrame(id: StageId, tick: number, hazards?: boolean): { stage: StageDef; blocks: Block[]; platforms: Platform[]; ledges: Ledge[]; hazard: HazardFrame | null };
```

Moving solid blocks are allowed (`moving: true`, positions from `stageFrame`). Riders are carried by the block's change between ticks.

### Fighters and models

All 33 fighters get **new** Blender models: recognizable, appealing and faithful to their Melee-era designs, but with a premium stylized finish. The target is a modern stylized party-fighter look:

- bold readable silhouettes and correct proportions per character;
- expressive faces and eyes;
- bevelled, smooth-shaded forms;
- layered costume details;
- signature props (Link's sword and shield, Marth's Falchion, Samus's arm cannon, Peach's crown and dress, Popo and Nana's hammers and so on).

Follow the rig contract in `model.ts` exactly: bone names and hierarchy, T-pose rest, facing +Z, feet at 0 and height from `ROSTER_DATA`. Each fighter has four costumes (Melee-inspired alternates) in `assets/costumes/<kind>.json`, keyed by material name. Budget: each GLB at most 1.5 MB and 20k triangles, with no image textures. Deliverables per fighter:

- a 512² portrait WebP (head and shoulders, transparent background);
- a 640×800 full-body render WebP (dynamic pose, transparent background).

The whole roster is rendered consistently, with a validation report.

### Controls (ui)

Landscape phone, thumbs only.

- **Left:** the shared `SteerPad` (large, with a visible deadzone) with **flick detection** (from under 0.3 to over 0.85 within about 80 ms). A flick plus Attack within 150 ms, or Attack within 80 ms before the flick, counts as `presses.smash`.
- **Right cluster** of shared `HoldButton`s:
  - **Attack:** the biggest, under the resting thumb;
  - **Special:** left of Attack;
  - **Jump:** above Attack;
  - **Shield:** top-right; Shield + Attack sends `presses.grab`;
  - **Smash:** small, for players who prefer a button over flicking.
- **Top strip:** your damage, stocks, fighter and costume color, and a Reconnecting badge.
- Optional short haptics.
- **Keyboard:** WASD or arrows move, J attack, K or Space jump, L special, I smash, Shift shield, U grab.

Counters and `aim` follow `model.ts`; the client never lowers a counter below the server echo.

### Presentation

- **Camera:** a single perspective camera that frames living fighters plus a margin and the main floor. It is smooth, stays inside the stage camera bounds, and punch-zooms and shakes on strong hits (event `power` > 0.6) and KOs. No shake under reduced motion.
- **Fighters:**
  - toon shading with a 3–4 step gradient;
  - inverted-hull outlines scaled with camera distance;
  - costume colors applied by material name;
  - player-color ground ring, name tag and offscreen bubble.
- **Animation** (procedural, from snapshot state):
  - a pose for every `FighterState`;
  - every move pose keyed anticipation → strike → follow-through against the move's frame data;
  - two-bone IK aiming the hitbox limb at `hits` during active frames;
  - 4–6 frame blends, squash and stretch, spring motion on `extra_*` bones, hitlag shake and tumble spin.
- **Effects:**
  - hit sparks per effect, sized by damage;
  - launch trails;
  - shield bubble in the player color, shrinking with HP;
  - parry flash;
  - dust;
  - fast-fall glint and charge glow;
  - KO blast column with screen flash;
  - respawn halo;
  - projectile visuals per kind.
- **Stages:** thirty stage arts built from a data-driven kit, so collision and art always match: floors at block tops, walls at block sides, thin readable soft platforms. On top of the kit, each stage gets its own art direction evoking the Melee stage: backdrop, parallax background, ambient animation and hazard telegraphs. Regenerate the map card images.
- **Performance:** a laptop integrated GPU at 1080p holds 60 fps with 4 fighters. Stay under about 150 draw calls and 300k triangles, and honor low quality.

### Display HUD (ui)

- **Bottom strip:** Melee-style fighter cards with portrait, name, stock icons (small portrait heads), and a big damage % that shakes and reddens.
- **Top:** timer (or ∞), stage name and hazard warning.
- **Center:** countdown, GO!, GAME!/TIME!/SUDDEN DEATH banners and the KO feed.
- **Results:** the winner's render shown large, placements, stats and a highlight.

## Integration interfaces

- **Engine (`src/moveset.ts`):** exports `MOVESET: Record<FighterKind, Partial<Record<MoveId, MoveDef & {...}>>>` built from fidelity data, and `PHYSICS` per fighter. `src/server.ts` exports `rules` (and default) implementing `GameRules<State, Input, Action, Settings, View, null>` with `parseLobbyChoice`.
- **Content (`src/poses-table.ts`):** exports `POSE_TABLE: Record<FighterKind, Partial<Record<MoveId, { pose: Pose; limb: Limb }>>>`. The engine uses it for `hits[].limb`, and the renderer for poses. Until content writes it, the engine provides a sensible default mapping inside `moveset.ts`.
- **Scene entry (`src/scene/index.tsx`):** default-exports the `SceneView` component and exports `loadSceneAssets(signal)`. `client.tsx` lazy-imports it for the display role only, so phones never download three.js or models.
- **fighter-render, `src/scene/fighter/index.ts`:**
  - `loadFighterModels(kinds, signal)`;
  - `class FighterActor { constructor(opts: {view: FighterView; model; cache}); readonly group; readonly height; update(view: FighterView, prev: FighterView | undefined, ctx: {dt: number; seconds: number; reduced: boolean; cameraDistance: number; platforms}); dispose() }`.
- **fighter-render, `src/scene/fx/index.ts`:** `createFx(scene, scope)`, which returns `{ event(e: GameEvent, view: View), projectiles(list, seconds), update(dt, reduced), cameraKick(): {x, y, zoom}, dispose() }`.
- **stage-render:** owns the scene mount, frame loop, snapshot buffering (`SnapshotBuffer` with `adaptive: {minMs: 45, maxMs: 120}` and `monotonic: true`), fighter/projectile interpolation, camera, stage art, name tags and offscreen bubbles. It calls the fighter and fx APIs. Use `mountThreeScene` for readiness.
- **Assets for the UI:** portraits, renders and costumes are loaded through `import.meta.glob` with eager url/JSON imports from `../assets/portraits/*.webp`, `../assets/renders/*.webp` and `../assets/costumes/*.json`.

## Validation

- **Game tests:** `node --import tsx --test packages/games/sky-clash/tests/*.test.ts` from the repository root.
- **Typecheck:** `npx tsc --noEmit`, filtered to your paths.
- **Lint:** `npx oxlint packages/games/sky-clash` (never Prettier).
- **Browser QA:** `npm run build:isolated -- <unique-run>` then `npm run serve:isolated -- <unique-run> <port>`.
  - Use headless Playwright, with at most three visible windows.
  - Use only your own sessions, and close them afterwards.
  - Save evidence under `output/sky-clash-v2/`.
